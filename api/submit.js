module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const { adresse, prix, surface, type_bien, annee, dpe_classe, notes_client, email_client, tel_client, projet_client, fichiers } = req.body;
  if (!adresse) return res.status(400).json({ error: 'Adresse manquante' });

  const missionId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const missionData = {
    missionId,
    adresse, prix, surface, type_bien, annee, dpe_classe,
    notes_client, email_client, tel_client, projet_client,
    fichiers: [],
    createdAt: new Date().toISOString(),
    _status: 'pending'
  };

  // Upstash REST API — format correct
  const url = new URL(process.env.KV_REST_API_URL);
  const key = `mission:${missionId}`;
  const value = JSON.stringify(missionData);

  await new Promise((resolve) => {
    const https = require('https');
    const body = JSON.stringify([key, value, 'EX', 86400]);
    const options = {
      hostname: url.hostname,
      path: '/set/' + encodeURIComponent(key),
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.KV_REST_API_TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(JSON.stringify({ ex: 86400 }))
      }
    };

    // Utilise l'API REST Upstash correctement
    const bodyStr = JSON.stringify({ value, ex: 86400 });
    const opts = {
      hostname: url.hostname,
      path: `/set/${encodeURIComponent(key)}`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.KV_REST_API_TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr)
      }
    };
    const reqHttp = https.request(opts, (r) => {
      let data = '';
      r.on('data', c => data += c);
      r.on('end', () => { console.log('Redis SET:', data); resolve(); });
    });
    reqHttp.on('error', (e) => { console.error('Redis error:', e); resolve(); });
    reqHttp.write(bodyStr);
    reqHttp.end();
  });

  return res.status(200).json({ ok: true, missionId });
};
