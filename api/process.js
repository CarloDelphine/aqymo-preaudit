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

function httpPost(url, bodyData) {
  return new Promise((resolve) => {
    const urlObj = new URL(url);
    const bodyStr = JSON.stringify(bodyData);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'User-Agent': 'AQYMO/1.0',
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr)
      },
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
    req.write(bodyStr);
    req.end();
  });
}

function extractParcelle(cadastreData) {
  if (!cadastreData?.features?.length) return null;
  const props = cadastreData.features[0]?.properties;
  if (!props) return null;
  return {
    section: props.section,
    numero: props.numero,
    commune: props.nom_com,
    contenance: props.contenance,
    reference: props.idu,
    code_dep: props.code_dep,
    code_insee: props.code_insee
  };
}

function extractPLU(pluData) {
  if (!pluData?.features?.length) return null;
  const props = pluData.features[0]?.properties;
  if (!props) return null;
  return {
    zone: props.libelle,
    type_zone: props.typezone,
    libelle_long: props.libelong
  };
}

function extractErrial(errialData) {
  if (!errialData) return null;
  const naturels = Object.values(errialData.risquesNaturels || {})
    .filter(r => r.present)
    .map(r => r.libelle + (r.libelleStatutCommune ? ` (${r.libelleStatutCommune})` : ''));
  const technos = Object.values(errialData.risquesTechnologiques || {})
    .filter(r => r.present)
    .map(r => r.libelle + (r.libelleStatutCommune ? ` (${r.libelleStatutCommune})` : ''));
  return { naturels, technos, url: errialData.url };
}

async function collectGovData(lat, lon, codeInsee, adresse) {
  const results = {};

  // Phase 1 — tous les appels indépendants en parallèle
  await Promise.all([
    httpGet(`https://georisques.gouv.fr/api/v1/gaspar/risques?rayon=1000&latlon=${lon},${lat}&page=1&page_size=10`)
      .then(r => { results.georisques = r.ok ? r.data : null; }),
    httpGet(`https://data.ademe.fr/data-fair/api/v1/datasets/dpe-v2-logements-existants/lines?q=${encodeURIComponent(adresse)}&size=3&select=numero_dpe,classe_consommation_energie,annee_construction,surface_habitable_logement,adresse_ban`)
      .then(r => { results.dpe = r.ok ? r.data : null; }),
    httpGet(`https://georisques.gouv.fr/api/v1/argiles?latlon=${lon},${lat}`)
      .then(r => { results.argiles = r.ok ? r.data : null; }),
    httpGet(`https://georisques.gouv.fr/api/v1/radon?code_insee=${codeInsee}`)
      .then(r => { results.radon = r.ok ? r.data : null; }),
    httpGet(`https://georisques.gouv.fr/api/v1/installations_classees?rayon=500&latlon=${lon},${lat}&page=1&page_size=5`)
      .then(r => { results.icpe = r.ok ? r.data : null; }),
    httpGet(`https://data.anfr.fr/api/explore/v2.1/catalog/datasets/observatoire_2g_3g_4g/records?where=within_distance(coordonnees_geo,geom'POINT(${lon} ${lat})',500m)&limit=5`)
      .then(r => { results.antennes = r.ok ? r.data : null; }),
    httpGet(`https://api.sitadel.fr/v2/autorisations?commune=${codeInsee}&dateDepotMin=2018-01-01&limit=5`)
      .then(r => { results.sitadel = r.ok ? r.data : null; }),
    httpGet(`https://apicarto.ign.fr/api/cadastre/parcelle?geom=${encodeURIComponent(JSON.stringify({"type":"Point","coordinates":[lon,lat]}))}`)
      .then(r => { results.cadastre = r.ok ? r.data : null; }),
    httpPost('https://apicarto.ign.fr/api/gpu/zone-urba', {
      geom: JSON.stringify({"type":"Point","coordinates":[lon,lat]})
    }).then(r => { results.plu = r.ok ? r.data : null; }),
  ]);

  // Phase 2 — ERRIAL parcellaire (dépend du cadastre)
  const parcelle = extractParcelle(results.cadastre);
  if (parcelle && codeInsee && parcelle.section && parcelle.numero) {
    const errial = await httpGet(
      `https://georisques.gouv.fr/api/v1/resultats_rapport_risque?code_insee=${codeInsee}&section=${encodeURIComponent(parcelle.section)}&numero=${encodeURIComponent(parcelle.numero)}`
    );
    results.errial = errial.ok ? errial.data : null;
  }

  return results;
}

function buildPrompt(data, prixM2, lat, lon, label, codeInsee, parcelle, plu, errialResume, govDataSummary) {
  const { adresse, prix, surface, type_bien, annee, dpe_classe, notes_client } = data;
  return `Tu es l'agent pré-audit AQYMO, architecte expert bâtiment. Briefing technique avant visite, sois CONCIS.

BIEN : ${adresse}${label ? ` (${label})` : ''}
GPS : ${lat},${lon} | Commune : ${label || adresse} | Code INSEE : ${codeInsee || 'nr'}
${parcelle ? `Parcelle cadastrale : ${parcelle.reference} | Section : ${parcelle.section} | N° : ${parcelle.numero} | Superficie cadastrale : ${parcelle.contenance || 'nc'} m²` : 'Parcelle cadastrale : non trouvée'}
${plu ? `Zone PLU : ${plu.zone}${plu.libelle_long ? ` — ${plu.libelle_long}` : ''}${plu.type_zone ? ` (${plu.type_zone})` : ''}` : 'Zone PLU : non disponible'}
${errialResume ? `ERRIAL parcellaire — Risques naturels : ${errialResume.naturels.join(' | ') || 'aucun'} | Risques technologiques : ${errialResume.technos.join(' | ') || 'aucun'}` : 'ERRIAL : données non disponibles pour cette parcelle'}
Prix : ${prix || 'nr'}€${prixM2 ? ` (${prixM2}€/m²)` : ''} | Surface : ${surface || 'nr'}m² | Type : ${type_bien || 'nr'} | Année : ${annee || 'nr'} | DPE : ${dpe_classe || '?'}
Notes client : ${notes_client || 'aucune'}

DONNÉES OFFICIELLES COMPLÉMENTAIRES :
${govDataSummary}

INSTRUCTIONS :
- Ne jamais mentionner de codes d'erreur HTTP (404, 500...). Si une donnée est indisponible, dire "données non disponibles".
- Ne jamais donner de fourchette de prix travaux dans le briefing — l'archi les évaluera sur site.
- Pour le DPE et le potentiel énergétique : décrire l'impact sur la valeur et la finançabilité sans chiffrer les travaux.
- Pour les risques : constats factuels uniquement, sans chiffrage.
- Marché : estimation experte uniquement, pas de DVF disponible.

Réponds UNIQUEMENT en JSON strict, champs courts (1-2 phrases max) :
{
  "score_alerte": "ÉLEVÉ|MODÉRÉ|FAIBLE",
  "resume_bien": "2 phrases",
  "prix_m2_annonce": ${prixM2 || 'null'},
  "estimation_marche": "ex: 2200-2500€/m² (estimation experte)",
  "ecart_marche": "ex: +8% vs marché estimé",
  "points_vigilance": [{"niveau": "ALERTE|ATTENTION|OK", "categorie": "nom", "detail": "1 phrase factuelle sans chiffrage travaux"}],
  "focus_visite": ["priorité 1", "priorité 2", "priorité 3", "priorité 4", "priorité 5"],
  "questions_vendeur": ["question 1", "question 2", "question 3"],
  "potentiel_energetique": "2 phrases — impact DPE sur valeur et finançabilité, potentiel MPR/CEE, sans fourchette de prix",
  "risques_detectes": "1 phrase — synthèse factuelle des risques ERRIAL sans chiffrage",
  "analyse_documents": "aucun document fourni",
  "donnees_officielles": {
    "transactions_dvf": "Estimation experte utilisée — pas de DVF API disponible",
    "dpe_officiel": "1 phrase sur DPE officiel trouvé ou non",
    "risques_principaux": "1 phrase de synthèse des risques principaux identifiés"
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

  // Géolocalisation BAN
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

  // Collecte données gouvernementales
  let govData = {};
  if (lat && lon) govData = await collectGovData(lat, lon, codeInsee, missionData.adresse);

  const parcelle = extractParcelle(govData.cadastre);
  const plu = extractPLU(govData.plu);
  const errialResume = extractErrial(govData.errial);
  const govDataSummary = JSON.stringify({
    georisques: govData.georisques,
    dpe: govData.dpe,
    argiles: govData.argiles,
    radon: govData.radon,
    icpe: govData.icpe,
    antennes: govData.antennes,
    sitadel: govData.sitadel,
  }, null, 0).slice(0, 3000);

  const prixM2 = missionData.prix && missionData.surface
    ? Math.round(parseInt(missionData.prix) / parseInt(missionData.surface))
    : null;

  const promptText = buildPrompt(
    missionData, prixM2, lat, lon, label, codeInsee,
    parcelle, plu, errialResume, govDataSummary
  );

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
          result._plu = plu;
          result._errial = errialResume;
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
