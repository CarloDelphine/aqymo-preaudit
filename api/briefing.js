const https = require('https');

function redisCall(command) {
  return new Promise((resolve) => {
    const url = new URL(process.env.KV_REST_API_URL);
    const body = JSON.stringify(command);
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
      res.on('end', () => {
        try { resolve({ ok: true, data: JSON.parse(data) }); }
        catch (e) { resolve({ ok: false, error: e.message }); }
      });
    });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.write(body);
    req.end();
  });
}

function redisGet(key) {
  return new Promise((resolve) => {
    const url = new URL(process.env.KV_REST_API_URL);
    const options = {
      hostname: url.hostname,
      path: `/get/${encodeURIComponent(key)}`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${process.env.KV_REST_API_TOKEN}` }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ ok: true, data: parsed.result ? JSON.parse(parsed.result) : null });
        } catch (e) { resolve({ ok: false }); }
      });
    });
    req.on('error', () => resolve({ ok: false }));
    req.end();
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Méthode non autorisée' });
  res.setHeader('Content-Type', 'application/json');

  const { id } = req.query;

  // Récupère une mission spécifique
  if (id) {
    const result = await redisGet(`mission:${id}`);
    if (!result.ok || !result.data) return res.status(404).json({ error: 'Mission non trouvée' });
    return res.status(200).json(result.data);
  }

  // Liste toutes les missions via SCAN
  const scanResult = await redisCall([['SCAN', '0', 'MATCH', 'mission:*', 'COUNT', '100']]);
  if (!scanResult.ok) return res.status(200).json({ missions: [] });

  const keys = scanResult.data?.[0]?.result?.[1] || [];
  if (!keys.length) return res.status(200).json({ missions: [] });

  // Récupère chaque mission
  const missions = [];
  for (const key of keys) {
    const m = await redisGet(key);
    if (m.ok && m.data) missions.push(m.data);
  }

  missions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return res.status(200).json({ missions });
};
