// HoloDex QR Upload Session — Upstash Redis REST API
const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

async function redisGet(key) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await res.json();
  if (!data.result) return null;
  return JSON.parse(data.result);
}

async function redisSet(key, value, exSeconds) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  const body = exSeconds
    ? ['SET', key, JSON.stringify(value), 'EX', exSeconds]
    : ['SET', key, JSON.stringify(value)];
  await fetch(`${url}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' };

  const params = event.queryStringParameters || {};
  const action = params.action;
  const sessionId = params.id;
  const method = event.httpMethod;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN env vars' }) };
  }

  try {
    // POST ?action=create
    if (method === 'POST' && action === 'create') {
      const id = Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
      await redisSet(`holodex:${id}`, { status: 'waiting', created: Date.now() }, 600);
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ sessionId: id }) };
    }

    // POST ?action=upload&id=X
    if (method === 'POST' && action === 'upload' && sessionId) {
      const existing = await redisGet(`holodex:${sessionId}`);
      if (!existing) return { statusCode: 404, headers: HEADERS, body: JSON.stringify({ error: 'Session not found or expired' }) };

      let body;
      try { body = JSON.parse(event.body || '{}'); }
      catch (e) { return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Invalid JSON body' }) }; }

      if (!body.imageBase64) return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Missing imageBase64' }) };

      await redisSet(`holodex:${sessionId}`, { status: 'ready', imageBase64: body.imageBase64, created: existing.created }, 600);
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true }) };
    }

    // GET ?action=poll&id=X
    if (method === 'GET' && action === 'poll' && sessionId) {
      const session = await redisGet(`holodex:${sessionId}`);
      if (!session) return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ status: 'waiting' }) };
      if (session.status === 'ready') {
        await redisSet(`holodex:${sessionId}`, { status: 'consumed', created: session.created }, 60);
        return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ status: 'ready', imageBase64: session.imageBase64 }) };
      }
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ status: session.status }) };
    }

    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Invalid action' }) };

  } catch (err) {
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: err.message }) };
  }
};
