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

async function collectGovData(adresse, lat, lon, codeInsee) {
  const results = {};
  const tasks = [
    httpGet(`https://georisques.gouv.fr/api/v1/gaspar/risques?rayon=1000&latlon=${lon},${lat}&page=1&page_size=10`)
      .then(r => { results.georisques = r.ok ? r.data : { error: r.error }; }),
    httpGet(`https://api.prix-immo.data.gouv.fr/search?lat=${lat}&lon=${lon}&rayon=500&limit=20`)
      .then(r => { results.dvf = r.ok ? r.data : { error: r.error }; }),
    httpGet(`https://data.ademe.fr/data-fair/api/v1/datasets/dpe-v2-logements-existants/lines?q=${encodeURIComponent(adresse)}&size=3&select=numero_dpe,classe_consommation_energie,classe_estimation_ges,annee_construction,surface_habitable_logement,adresse_ban`)
      .then(r => { results.dpe = r.ok ? r.data : { error: r.error }; }),
    httpGet(`https://georisques.gouv.fr/api/v1/argiles?latlon=${lon},${lat}`)
      .then(r => { results.argiles = r.ok ? r.data : { error: r.error }; }),
    httpGet(`https://georisques.gouv.fr/api/v1/radon?code_insee=${codeInsee}`)
      .then(r => { results.radon = r.ok ? r.data : { error: r.error }; }),
    httpGet(`https://georisques.gouv.fr/api/v1/installations_classees?rayon=500&latlon=${lon},${lat}&page=1&page_size=5`)
      .then(r => { results.icpe = r.ok ? r.data : { error: r.error }; }),
  ];
  await Promise.all(tasks);
  return results;
}

function buildPrompt(adresse, prix, surface, type_bien, annee, dpe_classe, notes_client, prixM2, lat, lon, label, govDataSummary, fichiers) {
  const hasFichiers = fichiers && fichiers.length > 0;
  const fichiersList = hasFichiers ? fichiers.map(f => f.nom).join(', ') : 'aucun';
  return `Tu es l'agent pré-audit AQYMO, architecte expert bâtiment. Produis un briefing technique précis et actionnable avant visite.

BIEN :
- Adresse : ${adresse}${label ? ` (${label})` : ''}
- GPS : ${lat ? `${lat}, ${lon}` : 'non disponible'}
- Prix : ${prix ? prix + ' €' : 'nr'}${prixM2 ? ` (${prixM2} €/m²)` : ''}
- Surface : ${surface ? surface + ' m²' : 'nr'}
- Type : ${type_bien || 'nr'}
- Année : ${annee || 'nr'}
- DPE déclaré : ${dpe_classe || 'inconnu'}
- Notes client : ${notes_client || 'aucune'}
- Documents : ${fichiersList}

DONNÉES OFFICIELLES :
${govDataSummary}

${hasFichiers ? 'ANALYSE DOCUMENTS : Les images jointes sont fournies. Analyse-les : cohérence DPE vs année construction, pathologies visibles, points absents de l\'annonce.' : ''}

Réponds UNIQUEMENT en JSON valide sans backticks :
{"score_alerte":"ÉLEVÉ" ou "MODÉRÉ" ou "FAIBLE","resume_bien":"3-4 phrases contexte marché et points saillants","prix_m2_annonce":${prixM2 || 'null'},"estimation_marche":"fourchette €/m² DVF ou estimation","ecart_marche":"positionnement prix","points_vigilance":[{"niveau":"ALERTE" ou "ATTENTION" ou "OK","categorie":"nom","detail":"observation actionnable architecte"}],"focus_visite":["priorité 1","priorité 2","priorité 3","priorité 4","priorité 5"],"questions_vendeur":["question 1","question 2","question 3"],"potentiel_energetique":"analyse MPR/CEE et gain DPE","risques_detectes":"risques officiels identifiés","analyse_documents":"${hasFichiers ? 'synthèse documents vs données officielles' : 'aucun document fourni'}","donnees_officielles":{"transactions_dvf":"prix DVF secteur si disponible","dpe_officiel":"DPE officiel si trouvé","risques_principaux":"risques ERRIAL/Géorisques"}}`;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const { adresse, prix, surface, type_bien, annee, dpe_classe, notes_client, fichiers } = req.body;
  if (!adresse) return res.status(400).json({ error: 'Adresse manquante' });

  // Géolocalisation
  let lat, lon, codeInsee, label;
  try {
    const banResult = await httpGet(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(adresse)}&limit=1`);
    if (banResult.ok && banResult.data.features?.length > 0) {
      const feature = banResult.data.features[0];
      [lon, lat] = feature.geometry.coordinates;
      codeInsee = feature.properties.citycode;
      label = feature.properties.label;
    }
  } catch (e) {
  res.end(JSON.stringify({ 
    error: 'Erreur parsing JSON: ' + e.message,
    raw: fullText.slice(0, 500)  // ← ajoute ça pour débugger
  }));
}

  // Données gouvernementales
  let govData = {};
  if (lat && lon) govData = await collectGovData(adresse, lat, lon, codeInsee);

  const prixM2 = prix && surface ? Math.round(parseInt(prix) / parseInt(surface)) : null;
  const govDataSummary = JSON.stringify(govData, null, 0).slice(0, 3000);

  // Construction du message avec images éventuelles
  const messages = [];
  if (fichiers && fichiers.length > 0) {
    const content = [];
    for (const f of fichiers) {
      if (f.type === 'image' && f.data) {
        content.push({ type: 'image', source: { type: 'base64', media_type: f.mediaType, data: f.data } });
      }
    }
    content.push({ type: 'text', text: buildPrompt(adresse, prix, surface, type_bien, annee, dpe_classe, notes_client, prixM2, lat, lon, label, govDataSummary, fichiers) });
    messages.push({ role: 'user', content });
  } else {
    messages.push({ role: 'user', content: buildPrompt(adresse, prix, surface, type_bien, annee, dpe_classe, notes_client, prixM2, lat, lon, label, govDataSummary, []) });
  }

  // STREAMING — pas de timeout Vercel
  const body = JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 4000, stream: true, messages });

  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  await new Promise((resolve, reject) => {
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
        const lines = chunk.toString().split('\n');
        for (const line of lines) {
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
        // Envoie le JSON complet une fois le stream terminé
        try {
          const clean = fullText.replace(/```json|```/g, '').trim();
          const jsonStart = clean.indexOf('{');
          const jsonEnd = clean.lastIndexOf('}');
          const result = JSON.parse(clean.slice(jsonStart, jsonEnd + 1));
          result._meta = { lat, lon, codeInsee, label, apisInterrogees: Object.keys(govData) };
          res.end(JSON.stringify(result));
        } catch (e) {
          res.end(JSON.stringify({ error: 'Erreur parsing JSON: ' + e.message }));
        }
        resolve();
      });
    });
    req.on('error', (e) => { res.end(JSON.stringify({ error: e.message })); resolve(); });
    req.write(body);
    req.end();
  });
};
