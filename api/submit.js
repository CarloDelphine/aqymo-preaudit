const https = require('https');

function redisSet(key, value) {
  return new Promise((resolve) => {
    const url = new URL(process.env.KV_REST_API_URL);
    const body = JSON.stringify(['SET', key, JSON.stringify(value), 'EX', 86400]);
    const options = {
      hostname: url.hostname,
      path: '/pipeline',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.KV_REST_API_TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ ok: true }));
    });
    req.on('error', (e) => resolve({ ok: false }));
    req.write(body);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const { adresse, prix, surface, type_bien, annee, dpe_classe, notes_client, email_client, tel_client, projet_client, fichiers } = req.body;
  if (!adresse) return res.status(400).json({ error: 'Adresse manquante' });

  const missionId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const missionData = {
    missionId,
    adresse, prix, surface, type_bien, annee, dpe_classe,
    notes_client, email_client, tel_client, projet_client,
    fichiers: fichiers || [],
    createdAt: new Date().toISOString(),
    _status: 'pending'
  };

  await redisSet(`mission:${missionId}`, missionData);
  return res.status(200).json({ ok: true, missionId });
};
