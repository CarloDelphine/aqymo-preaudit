const https = require('https');

module.exports = async function handler(req, res) {
  const url = new URL(process.env.KV_REST_API_URL);
  
  // Test SET simple via GET (format le plus basique Upstash)
  const result = await new Promise((resolve) => {
    const options = {
      hostname: url.hostname,
      path: '/set/test-key/test-value',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${process.env.KV_REST_API_TOKEN}`
      }
    };
    const req = https.request(options, (r) => {
      let data = '';
      r.on('data', c => data += c);
      r.on('end', () => resolve(data));
    });
    req.on('error', (e) => resolve('ERROR: ' + e.message));
    req.end();
  });

  // Test GET
  const getResult = await new Promise((resolve) => {
    const options = {
      hostname: url.hostname,
      path: '/get/test-key',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${process.env.KV_REST_API_TOKEN}`
      }
    };
    const req = https.request(options, (r) => {
      let data = '';
      r.on('data', c => data += c);
      r.on('end', () => resolve(data));
    });
    req.on('error', (e) => resolve('ERROR: ' + e.message));
    req.end();
  });

  return res.status(200).json({
    url: url.hostname,
    setResult: result,
    getResult: getResult
  });
};
