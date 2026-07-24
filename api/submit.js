const https = require('https');

function upstashSet(key, value) {
  return new Promise((resolve) => {
    const url = new URL(process.env.KV_REST_API_URL);
    // Upstash REST : POST /set/KEY avec la valeur en body JSON string
    const bodyStr = JSON.stringify(value);
    const path = `/set/${encodeURIComponent(key)}?ex=86400`;
    const options = {
      hostname: url.hostname,
      path,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.KV_REST_API_TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr)
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        console.log('Upstash SET response:', data);
        resolve({ ok: true, raw: data });
      });
    });
    req.on('error', (e) => { console.error('Upstash error:', e); resolve({ ok: false }); });
    req.write(bodyStr);
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

  const result = await upstashSet(`mission:${missionId}`, missionData);
  console.log('Mission stored:', missionId, result);

  return res.status(200).json({ ok: true, missionId });
};
