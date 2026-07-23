const https = require('https');

function upstashGet(key) {
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
          if (!parsed.result) return resolve({ ok: true, data: null });
          // Gère simple et double encodage
          let value = parsed.result;
          if (typeof value === 'string') {
            try { value = JSON.parse(value); } catch (e) {}
          }
          resolve({ ok: true, data: value });
        } catch (e) { resolve({ ok: false, error: e.message }); }
      });
    });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.end();
  });
}

function upstashScan() {
  return new Promise((resolve) => {
    const url = new URL(process.env.KV_REST_API_URL);
    const options = {
      hostname: url.hostname,
      path: '/scan/0?match=mission%3A*&count=100',
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

  if (id) {
    const result = await upstashGet(`mission:${id}`);
    if (!result.ok || !result.data) return res.status(404).json({ error: 'Mission non trouvée', id });
    return res.status(200).json(result.data);
  }

  // Liste toutes les missions
  const scanResult = await upstashScan();
  if (!scanResult.ok) return res.status(200).json({ missions: [], error: scanResult.error });

  const keys = scanResult.data?.result?.[1] || [];
  if (!keys.length) return res.status(200).json({ missions: [] });

  const missions = [];
  for (const key of keys) {
    const m = await upstashGet(key);
    if (m.ok && m.data && m.data.missionId) {
      missions.push(m.data);
    }
  }

  missions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return res.status(200).json({ missions });
};
