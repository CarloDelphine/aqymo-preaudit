const https = require('https');

function upstashPipeline(commands) {
  return new Promise((resolve) => {
    const url = new URL(process.env.KV_REST_API_URL);
    const bodyStr = JSON.stringify(commands);
    const options = {
      hostname: url.hostname,
      path: '/pipeline',
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
        console.log('Upstash pipeline response:', data);
        try { resolve({ ok: true, data: JSON.parse(data) }); }
        catch (e) { resolve({ ok: false, error: e.message }); }
      });
    });
    req.on('error', (e) => { console.error('Upstash error:', e.message); resolve({ ok: false }); });
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

  const result = await upstashPipeline([
    ['SET', `mission:${missionId}`, JSON.stringify(missionData), 'EX', 86400]
  ]);

  console.log('Store result:', JSON.stringify(result));
  return res.status(200).json({ ok: true, missionId, debug: result });
};
