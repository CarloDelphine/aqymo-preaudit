const https = require('https');

function httpGet(url) {
  return new Promise((resolve) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: { 'User-Agent': 'AQYMO/1.0', 'Accept': 'application/json' },
      timeout: 8000
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve({ ok: true, data: JSON.parse(data) }); }
        catch (e) { resolve({ ok: false, error: 'Parse error' }); }
      });
    });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'Timeout' }); });
    req.end();
  });
}

async function collectGovData(lat, lon, codeInsee, adresse) {
  const results = {};
  await Promise.all([
    httpGet(`https://georisques.gouv.fr/api/v1/gaspar/risques?rayon=1000&latlon=${lon},${lat}&page=1&page_size=5`)
      .then(r => { results.georisques = r.ok ? r.data : null; }),
    httpGet(`https://data.ademe.fr/data-fair/api/v1/datasets/dpe-v2-logements-existants/lines?q=${encodeURIComponent(adresse)}&size=2&select=numero_dpe,classe_consommation_energie,annee_construction,surface_habitable_logement`)
      .then(r => { results.dpe = r.ok ? r.data : null; }),
    httpGet(`https://georisques.gouv.fr/api/v1/argiles?latlon=${lon},${lat}`)
      .then(r => { results.argiles = r.ok ? r.data : null; }),
    httpGet(`https://georisques.gouv.fr/api/v1/radon?code_insee=${codeInsee}`)
      .then(r => { results.radon = r.ok ? r.data : null; }),
    httpGet(`https://georisques.gouv.fr/api/v1/installations_classees?rayon=500&latlon=${lon},${lat}&page=1&page_size=3`)
      .then(r => { results.icpe = r.ok ? r.data : null; }),
  ]);
  return results;
}

function buildPrompt(adresse, prix, surface, type_bien, annee, dpe_classe, notes_client, prixM2, lat, lon, label, codeInsee, govDataSummary, fichiers) {
  const hasFichiers = fichiers && fichiers.length > 0;
  return `Tu es l'agent pré-audit AQYMO, architecte expert bâtiment. Briefing technique avant visite, sois CONCIS.

BIEN : ${adresse}${label ? ` (${label})` : ''}
GPS : ${lat},${lon} | Commune : ${label || adresse} | Code INSEE : ${codeInsee || 'nr'}
Prix : ${prix || 'nr'}€${prixM2 ? ` (${prixM2}€/m²)` : ''} | Surface : ${surface || 'nr'}m² | Type : ${type_bien || 'nr'} | Année : ${annee || 'nr'} | DPE : ${dpe_classe || '?'}
Notes client : ${notes_client || 'aucune'}
${hasFichiers ? `Documents joints : ${fichiers.map(f => f.nom).join(', ')}` : ''}

DONNÉES OFFICIELLES :
${govDataSummary}

IMPORTANT MARCHÉ : Aucune transaction DVF disponible via API pour cette analyse. Estime le prix marché à partir du type de bien, de la commune, de l'année de construction, de la classe DPE, et de ta connaissance des prix immobiliers français 2024-2025 pour ce secteur géographique. Indique clairement dans estimation_marche que c'est une estimation experte et non des transactions notariales réelles.

${hasFichiers ? 'DOCUMENTS JOINTS : Analyse les images fournies — cohérence DPE vs année construction, pathologies visibles, points absents de l\'annonce.' : ''}

Réponds UNIQUEMENT en JSON strict, champs courts (1-2 phrases max par champ texte) :
{
  "score_alerte": "ÉLEVÉ|MODÉRÉ|FAIBLE",
  "resume_bien": "2 phrases",
  "prix_m2_annonce": ${prixM2 || 'null'},
  "estimation_marche": "ex: 2200-2500€/m² (estimation experte, pas de DVF disponible)",
  "ecart_marche": "ex: +8% vs marché estimé",
  "points_vigilance": [
    {"niveau": "ALERTE|ATTENTION|OK", "categorie": "nom court", "detail": "1 phrase"}
  ],
  "focus_visite": ["priorité 1", "priorité 2", "priorité 3", "priorité 4", "priorité 5"],
  "questions_vendeur": ["question 1", "question 2", "question 3"],
  "potentiel_energetique": "2 phrases",
  "risques_detectes": "1 phrase",
  "analyse_documents": "${hasFichiers ? '2 phrases' : 'aucun document fourni'}",
  "donnees_officielles": {
    "transactions_dvf": "Pas de données DVF disponibles via API — estimation experte utilisée",
    "dpe_officiel": "1 phrase sur DPE officiel trouvé ou non",
    "risques_principaux": "1 phrase sur risques géorisques"
  }
}`;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const { adresse, prix, surface, type_bien, annee, dpe_classe, notes_client, fichiers } = req.body;
  if (!adresse) return res.status(400).json({ error: 'Adresse manquante' });

  // Géolocalisation BAN
  let lat, lon, codeInsee, label;
  try {
    const ban = await httpGet(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(adresse)}&limit=1`);
    if (ban.ok && ban.data.features?.length > 0) {
      const f = ban.data.features[0];
      [lon, lat] = f.geometry.coordinates;
      codeInsee = f.properties.citycode;
      label = f.properties.label;
    }
  } catch (e) {}

  // Données gouvernementales
  let govData = {};
  if (lat && lon) govData = await collectGovData(lat, lon, codeInsee, adresse);
  const govDataSummary = JSON.stringify(govData, null, 0).slice(0, 2500);

  const prixM2 = prix && surface ? Math.round(parseInt(prix) / parseInt(surface)) : null;

  // Construction du message
  const promptText = buildPrompt(adresse, prix, surface, type_bien, annee, dpe_classe, notes_client, prixM2, lat, lon, label, codeInsee, govDataSummary, fichiers || []);

  let messages;
  if (fichiers && fichiers.length > 0) {
    const content = [];
    for (const f of fichiers) {
      if (f.type === 'image' && f.data) {
        content.push({ type: 'image', source: { type: 'base64', media_type: f.mediaType, data: f.data } });
      }
    }
    content.push({ type: 'text', text: promptText });
    messages = [{ role: 'user', content }];
  } else {
    messages = [{ role: 'user', content: promptText }];
  }

  // Appel Anthropic en streaming
  const body = JSON.stringify({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    stream: true,
    messages
  });

  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  await new Promise((resolve) => {
    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (apiRes) => {
      let fullText = '';

      apiRes.on('data', (chunk) => {
        for (const line of chunk.toString().split('\n')) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6));
              if (event.type === 'content_block_delta' && event.delta?.text) {
                fullText += event.delta.text;
              }
            } catch (e) {}
          }
        }
      });

      apiRes.on('end', () => {
        try {
          const clean = fullText.replace(/```json|```/g, '').trim();
          const start = clean.indexOf('{');
          const end = clean.lastIndexOf('}');
          if (start === -1) throw new Error('Pas de JSON trouvé');

          let jsonStr = clean.slice(start, end + 1);

          // Si tronqué, tente de refermer
          if (end === -1 || !clean.slice(start).endsWith('}')) {
            jsonStr = clean.slice(start);
            let open = 0;
            for (const c of jsonStr) { if (c === '{') open++; else if (c === '}') open--; }
            jsonStr += '}'.repeat(Math.max(0, open));
          }

          const result = JSON.parse(jsonStr);
          result._meta = { lat, lon, codeInsee, label, apisInterrogees: Object.keys(govData) };
          res.end(JSON.stringify(result));
        } catch (e) {
          res.end(JSON.stringify({
            error: 'Erreur parsing: ' + e.message,
            raw: fullText.slice(0, 400)
          }));
        }
        resolve();
      });
    });

    req.on('error', (e) => {
      res.end(JSON.stringify({ error: e.message }));
      resolve();
    });

    req.write(body);
    req.end();
  });
};
