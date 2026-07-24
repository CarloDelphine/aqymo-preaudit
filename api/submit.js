const https = require('https');

function upstashGet(path) {
  return new Promise((resolve) => {
    const url = new URL(process.env.KV_REST_API_URL);
    const options = {
      hostname: url.hostname,
      path,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${process.env.KV_REST_API_TOKEN}`
      }
    };
    const req = https.request(options, (r) => {
      let data = '';
      r.on('data', c => data += c);
      r.on('end', () => {
        try { resolve({ ok: true, data: JSON.parse(data) }); }
        catch (e) { resolve({ ok: false, error: e.message }); }
      });
    });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.end();
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const { adresse, prix, surface, type_bien, annee, dpe_classe, notes_client, email_client, tel_client, projet_client } = req.body;
  if (!adresse) return res.status(400).json({ error: 'Adresse manquante' });

  const missionId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const missionData = {
    missionId,
    adresse, prix, surface, type_bien, annee, dpe_classe,
    notes_client, email_client, tel_client, projet_client,
    createdAt: new Date().toISOString(),
    _status: 'pending'
  };

  // SET via GET request — format qui marche
  const encoded = encodeURIComponent(JSON.stringify(missionData));
  const result = await upstashGet(`/set/mission:${missionId}/${encoded}?ex=86400`);

  return res.status(200).json({ ok: true, missionId, stored: result });
};
