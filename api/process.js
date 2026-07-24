const https = require('https');

function upstashGet(path) {
  return new Promise((resolve) => {
    const url = new URL(process.env.KV_REST_API_URL);
    const options = {
      hostname: url.hostname,
      path,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${process.env.KV_REST_API_TOKEN}` }
    };
    const req = https.request(options, (r) => {
      let data = '';
      r.on('data', c => data += c);
      r.on('end', () => {
        try { resolve({ ok: true, data: JSON.parse(data) }); }
        catch (e) { resolve({ ok: false }); }
      });
    });
    req.on('error', () => resolve({ ok: false }));
    req.end();
  });
}

function redisGet(key) {
  return new Promise(async (resolve) => {
    const result = await upstashGet(`/get/${encodeURIComponent(key)}`);
    if (!result.ok || !result.data?.result) return resolve({ ok: false, data: null });
    try { resolve({ ok: true, data: JSON.parse(result.data.result) }); }
    catch (e) { resolve({ ok: false }); }
  });
}

function redisSet(key, value) {
  return new Promise(async (resolve) => {
    const encoded = encodeURIComponent(JSON.stringify(value));
    const result = await upstashGet(`/set/${encodeURIComponent(key)}/${encoded}?ex=86400`);
    resolve(result);
  });
}

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
    // Cadastre IGN
    httpGet(`https://geocodage.ign.fr/look4/parcel/search?lat=${lat}&lon=${lon}&returntruegeometry=false`)
      .then(r => { results.cadastre = r.ok ? r.data : null; }),
  ]);
  return results;
}

function extractParcelle(cadastreData) {
  if (!cadastreData?.features?.length) return null;
  const props = cadastreData.features[0]?.properties;
  if (!props) return null;
  return {
    section: props.section || props.codsec,
    numero: props.numero || props.dnupla,
    feuille: props.feuille,
    contenance: props.contenance,
    reference: `${props.codecom || ''}${props.codsec || ''}${props.dnupla || ''}`
  };
}

function buildPrompt(data, prixM2, lat, lon, label, codeInsee, govDataSummary, parcelle) {
  const { adresse, prix, surface, type_bien, annee, dpe_classe, notes_client } = data;
  return `Tu es l'agent pré-audit AQYMO, architecte expert bâtiment. Briefing technique avant visite, sois CONCIS.

BIEN : ${adresse}${label ? ` (${label})` : ''}
GPS : ${lat},${lon} | Commune : ${label || adresse} | Code INSEE : ${codeInsee || 'nr'}
${parcelle ? `Parcelle cadastrale : ${parcelle.reference} | Section : ${parcelle.section} | N° : ${parcelle.numero}${parcelle.contenance ? ` | Superficie : ${parcelle.contenance}m²` : ''}` : ''}
Prix : ${prix || 'nr'}€${prixM2 ? ` (${prixM2}€/m²)` : ''} | Surface : ${surface || 'nr'}m² | Type : ${type_bien || 'nr'} | Année : ${annee || 'nr'} | DPE : ${dpe_classe || '?'}
Notes client : ${notes_client || 'aucune'}

DONNÉES OFFICIELLES :
${govDataSummary}

IMPORTANT MARCHÉ : Aucune transaction DVF disponible via API. Estime le prix marché à partir du type de bien, commune, année construction, classe DPE et ta connaissance des prix immobiliers français 2024-2025. Indique que c'est une estimation experte.

Réponds UNIQUEMENT en JSON strict, champs courts (1-2 phrases max) :
{
  "score_alerte": "ÉLEVÉ|MODÉRÉ|FAIBLE",
  "resume_bien": "2 phrases",
  "prix_m2_annonce": ${prixM2 || 'null'},
  "estimation_marche": "ex: 2200-2500€/m² (estimation experte)",
  "ecart_marche": "ex: +8% vs marché estimé",
  "points_vigilance": [{"niveau": "ALERTE|ATTENTION|OK", "categorie": "nom", "detail": "1 phrase"}],
  "focus_visite": ["priorité 1", "priorité 2", "priorité 3", "priorité 4", "priorité 5"],
  "questions_vendeur": ["question 1", "question 2", "question 3"],
  "potentiel_energetique": "2 phrases",
  "risques_detectes": "1 phrase",
  "analyse_documents": "aucun document fourni",
  "donnees_officielles": {
    "transactions_dvf": "Estimation experte utilisée",
    "dpe_officiel": "1 phrase",
    "risques_principaux": "1 phrase"
  }
}`;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const { missionId } = req.body;
  if (!missionId) return res.status(400).json({ error: 'missionId manquant' });

  const missionResult = await redisGet(`mission:${missionId}`);
  if (!missionResult.ok || !missionResult.data) {
    return res.status(404).json({ error: 'Mission non trouvée' });
  }

  const missionData = missionResult.data;

  if (missionData._status === 'ready') {
    return res.status(200).json({ ok: true, status: 'already_ready' });
  }

  let lat, lon, codeInsee, label;
  try {
    const ban = await httpGet(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(missionData.adresse)}&limit=1`);
    if (ban.ok && ban.data.features?.length > 0) {
      const f = ban.data.features[0];
      [lon, lat] = f.geometry.coordinates;
      codeInsee = f.properties.citycode;
      label = f.properties.label;
    }
  } catch (e) {}

  let govData = {};
  if (lat && lon) govData = await collectGovData(lat, lon, codeInsee, missionData.adresse);
  
  const parcelle = extractParcelle(govData.cadastre);
  const govDataSummary = JSON.stringify(govData, null, 0).slice(0, 2500);
  const prixM2 = missionData.prix && missionData.surface ? Math.round(parseInt(missionData.prix) / parseInt(missionData.surface)) : null;

  const promptText = buildPrompt(missionData, prixM2, lat, lon, label, codeInsee, govDataSummary, parcelle);
  const messages = [{ role: 'user', content: promptText }];
  const body = JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 2000, stream: true, messages });

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
              if (event.type === 'content_block_delta' && event.delta?.text) fullText += event.delta.text;
            } catch (e) {}
          }
        }
      });
      apiRes.on('end', async () => {
        try {
          const clean = fullText.replace(/```json|```/g, '').trim();
          const start = clean.indexOf('{');
          const end = clean.lastIndexOf('}');
          if (start === -1) throw new Error('Pas de JSON');
          let jsonStr = clean.slice(start, end + 1);
          if (!jsonStr.endsWith('}')) {
            let open = 0;
            for (const c of jsonStr) { if (c === '{') open++; else if (c === '}') open--; }
            jsonStr += '}'.repeat(Math.max(0, open));
          }
          const result = JSON.parse(jsonStr);
          result._meta = { lat, lon, codeInsee, label, apisInterrogees: Object.keys(govData) };
          result._missionData = missionData;
          result._parcelle = parcelle;
          result._status = 'ready';
          result.missionId = missionId;
          result.adresse = missionData.adresse;
          result.createdAt = missionData.createdAt;
          await redisSet(`mission:${missionId}`, result);
        } catch (e) {
          await redisSet(`mission:${missionId}`, { ...missionData, _status: 'error', error: e.message });
        }
        resolve();
      });
    });

    req.on('error', async (e) => {
      await redisSet(`mission:${missionId}`, { ...missionData, _status: 'error', error: e.message });
      resolve();
    });

    req.write(body);
    req.end();
  });

  return res.status(200).json({ ok: true, status: 'done' });
};
