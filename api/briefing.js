const https = require('https');

function upstashFetch(path, method = 'GET', body = null) {
  return new Promise((resolve) => {
    const url = new URL(process.env.KV_REST_API_URL);
    const bodyStr = body ? JSON.stringify(body) : null;
    const options = {
      hostname: url.hostname,
      path,
      method,
      headers: {
        'Authorization': `Bearer ${process.env.KV_REST_API_TOKEN}`,
        ...(bodyStr ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) } : {})
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
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Méthode non autorisée' });
  res.setHeader('Content-Type', 'application/json');

  const { id } = req.query;

  if (id) {
    const result = await upstashFetch(`/get/mission:${encodeURIComponent(id)}`);
    if (!result.ok || !result.data?.result) return res.status(404).json({ error: 'Mission non trouvée' });
    try {
      return res.status(200).json(JSON.parse(result.data.result));
    } catch (e) {
      return res.status(500).json({ error: 'Parsing error' });
    }
  }

  // SCAN pour lister toutes les missions
  const scanResult = await upstashFetch('/scan/0?match=mission:*&count=100');
  if (!scanResult.ok) return res.status(200).json({ missions: [] });

  const keys = scanResult.data?.result?.[1] || [];
  if (!keys.length) return res.status(200).json({ missions: [] });

  const missions = [];
  for (const key of keys) {
    const m = await upstashFetch(`/get/${encodeURIComponent(key)}`);
    if (m.ok && m.data?.result) {
      try { missions.push(JSON.parse(m.data.result)); } catch (e) {}
    }
  }

  missions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return res.status(200).json({ missions });
};
