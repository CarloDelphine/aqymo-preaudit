const https = require('https');

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
        } catch (e) { resolve({ ok: false, error: e.message }); }
      });
    });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.end();
  });
}

function redisList(pattern) {
  return new Promise((resolve) => {
    const url = new URL(process.env.KV_REST_API_URL);
    const options = {
      hostname: url.hostname,
      path: `/keys/${encodeURIComponent(pattern)}`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${process.env.KV_REST_API_TOKEN}` }
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
    req.end();
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Méthode non autorisée' });

  res.setHeader('Content-Type', 'application/json');

  const { id } = req.query;

  // Si un ID est fourni, retourne cette mission
  if (id) {
    const result = await redisGet(`mission:${id}`);
    if (!result.ok || !result.data) return res.status(404).json({ error: 'Mission non trouvée' });
    return res.status(200).json(result.data);
  }

  // Sinon retourne toutes les missions
  const keys = await redisList('mission:*');
  if (!keys.ok) return res.status(500).json({ error: 'Erreur Redis' });

  const missions = [];
  for (const key of (keys.data.result || [])) {
    const m = await redisGet(key);
    if (m.ok && m.data) missions.push(m.data);
  }

  missions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return res.status(200).json({ missions });
};
