export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  const { adresse, prix, surface, type_bien, annee, dpe_classe, notes_client } = req.body;

  if (!adresse) {
    return res.status(400).json({ error: 'Adresse manquante' });
  }

  const prompt = `Tu es l'agent pré-audit AQYMO. Tu analyses un bien immobilier avant visite d'architecte pour détecter les anomalies et produire un briefing structuré.

BIEN À ANALYSER :
- Adresse : ${adresse}
- Prix annoncé : ${prix ? prix + ' €' : 'non renseigné'}
- Surface : ${surface ? surface + ' m²' : 'non renseignée'}
- Type : ${type_bien || 'non renseigné'}
- Année construction : ${annee || 'non renseignée'}
- Classe DPE : ${dpe_classe || 'inconnue'}
- Notes client : ${notes_client || 'aucune'}

Produis un briefing pré-visite en JSON STRICT (sans backticks, sans markdown, sans commentaires) avec cette structure exacte :
{
  "score_alerte": "ÉLEVÉ" ou "MODÉRÉ" ou "FAIBLE",
  "resume_bien": "2-3 phrases synthétisant le bien et son contexte marché local",
  "prix_m2_annonce": nombre ou null,
  "estimation_marche": "fourchette estimée ex: 2800-3200 €/m²",
  "ecart_marche": "surcoté de X%" ou "dans la moyenne" ou "sous-coté de X%" ou "à vérifier sur place",
  "points_vigilance": [
    {"niveau": "ALERTE" ou "ATTENTION" ou "OK", "categorie": "string", "detail": "string actionnable pour l'architecte"}
  ],
  "focus_visite": ["point 1 à inspecter en priorité", "point 2", "point 3", "point 4", "point 5"],
  "questions_vendeur": ["question 1 à poser impérativement", "question 2", "question 3"],
  "potentiel_energetique": "analyse du potentiel de rénovation énergétique et aides possibles (MPR, CEE)",
  "risques_detectes": "synthèse des risques géographiques, administratifs ou techniques détectés"
}

Sois précis, factuel, orienté architecte terrain. Les points_vigilance doivent être actionnables sur place.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();
    const text = data.content.map(b => b.text || '').join('');
    const clean = text.replace(/```json|```/g, '').trim();
    const result = JSON.parse(clean);

    return res.status(200).json(result);

  } catch (error) {
    console.error('Erreur API:', error);
    return res.status(500).json({ error: "Erreur lors de l'analyse. Réessayez." });
  }
}
