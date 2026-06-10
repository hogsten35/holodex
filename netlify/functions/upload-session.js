// HoloDex QR Upload Session
// Uses Upstash Redis REST API for persistent cross-function storage
// Free tier at upstash.com — no credit card needed
// Set env vars: UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in Netlify

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

async function redisCmd(...args) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    throw new Error('UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN env vars not set. See README for setup instructions.');
  }

  const res = await fetch(`${url}/${args.map(a => encodeURIComponent(a)).join('/')}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await res.json();
  return data.result;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' };

  const params = event.queryStringParameters || {};
  const action = params.action;
  const sessionId = params.id;
  const method = event.httpMethod;

  try {
    // POST ?action=create — desktop creates a new session
    if (method === 'POST' && action === 'create') {
      const id = Math.random().toString(36).slice(2,9) + Date.now().toString(36).slice(-4);
      // Store with 10 minute expiry
      await redisCmd('SET', `holodex:session:${id}`, JSON.stringify({ status: 'waiting', created: Date.now() }), 'EX', '600');
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ sessionId: id }) };
    }

    // POST ?action=upload&id=X — phone uploads the image
    if (method === 'POST' && action === 'upload' && sessionId) {
      const existing = await redisCmd('GET', `holodex:session:${sessionId}`);
      if (!existing) return { statusCode: 404, headers: HEADERS, body: JSON.stringify({ error: 'Session not found or expired' }) };

      let body;
      try { body = JSON.parse(event.body || '{}'); }
      catch(e) { return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Invalid JSON body' }) }; }

      if (!body.imageBase64) return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Missing imageBase64' }) };

      const parsed = JSON.parse(existing);
      // Store image with 10 minute expiry
      await redisCmd('SET', `holodex:session:${sessionId}`,
        JSON.stringify({ status: 'ready', imageBase64: body.imageBase64, created: parsed.created }),
        'EX', '600'
      );
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true }) };
    }

    // GET ?action=poll&id=X — desktop polls for the image
    if (method === 'GET' && action === 'poll' && sessionId) {
      const raw = await redisCmd('GET', `holodex:session:${sessionId}`);
      if (!raw) return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ status: 'waiting' }) };

      const session = JSON.parse(raw);
      if (session.status === 'ready') {
        // Mark consumed so it's not double-delivered
        await redisCmd('SET', `holodex:session:${sessionId}`,
          JSON.stringify({ status: 'consumed', created: session.created }),
          'EX', '60'
        );
        return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ status: 'ready', imageBase64: session.imageBase64 }) };
      }
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ status: session.status }) };
    }

    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Invalid action. Use ?action=create|upload|poll' }) };

  } catch(err) {
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: err.message }) };
  }
};
