const https = require('https');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  const { adresse, prix, surface, type_bien, annee, dpe_classe, notes_client } = req.body;

  if (!adresse) {
    return res.status(400).json({ error: 'Adresse manquante' });
  }

  const prompt = `Tu es l'agent pré-audit AQYMO. Tu analyses un bien immobilier avant visite d'architecte.

BIEN À ANALYSER :
- Adresse : ${adresse}
- Prix annoncé : ${prix ? prix + ' €' : 'non renseigné'}
- Surface : ${surface ? surface + ' m²' : 'non renseignée'}
- Type : ${type_bien || 'non renseigné'}
- Année construction : ${annee || 'non renseignée'}
- Classe DPE : ${dpe_classe || 'inconnue'}
- Notes client : ${notes_client || 'aucune'}

Réponds UNIQUEMENT en JSON valide, sans backticks ni markdown :
{"score_alerte":"ÉLEVÉ","resume_bien":"texte","prix_m2_annonce":null,"estimation_marche":"2500-3000 €/m²","ecart_marche":"dans la moyenne","points_vigilance":[{"niveau":"ALERTE","categorie":"Structure","detail":"texte"}],"focus_visite":["point1","point2","point3","point4","point5"],"questions_vendeur":["q1","q2","q3"],"potentiel_energetique":"texte","risques_detectes":"texte"}`;

  const payload = JSON.stringify({
    model: 'claude-sonnet-4-6',
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }]
  });

  return new Promise((resolve) => {
    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const request = https.request(options, (response) => {
      let data = '';
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            res.status(500).json({ error: parsed.error.message });
            return resolve();
          }
          const text = parsed.content.map(b => b.text || '').join('');
          const clean = text.replace(/```json|```/g, '').trim();
          const result = JSON.parse(clean);
          res.status(200).json(result);
        } catch (e) {
          res.status(500).json({ error: 'Erreur parsing: ' + e.message });
        }
        resolve();
      });
    });

    request.on('error', (e) => {
      res.status(500).json({ error: 'Erreur réseau: ' + e.message });
      resolve();
    });

    request.write(payload);
    request.end();
  });
};
