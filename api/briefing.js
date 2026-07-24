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

  if (id) {
    const result = await upstashGet(`/get/mission:${id}`);
    if (!result.ok || !result.data?.result) return res.status(404).json({ error: 'Mission non trouvée' });
    try {
      const parsed = JSON.parse(result.data.result);
      return res.status(200).json(parsed);
    } catch (e) {
      return res.status(500).json({ error: 'Parse error' });
    }
  }

  // SCAN toutes les missions
  const scanResult = await upstashGet('/scan/0?match=mission:*&count=100');
  if (!scanResult.ok) return res.status(200).json({ missions: [] });

  const keys = scanResult.data?.result?.[1] || [];
  if (!keys.length) return res.status(200).json({ missions: [] });

  const missions = [];
  for (const key of keys) {
    const m = await upstashGet(`/get/${encodeURIComponent(key)}`);
    if (m.ok && m.data?.result) {
      try {
        const parsed = JSON.parse(m.data.result);
        if (parsed.missionId) missions.push(parsed);
      } catch (e) {}
    }
  }

  missions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return res.status(200).json({ missions });
};
