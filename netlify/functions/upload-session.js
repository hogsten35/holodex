// HoloDex QR Upload Session — Upstash Redis REST API
const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

async function redisCmd(command, ...args) {
  const url = (process.env.UPSTASH_REDIS_REST_URL || '').trim().replace(/\/$/, '');
  const token = (process.env.UPSTASH_REDIS_REST_TOKEN || '').trim();
  if (!url || !token) throw new Error('UPSTASH env vars not set');

  const res = await fetch(`${url}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([command, ...args])
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Redis ${res.status}: ${text}`);
  const data = JSON.parse(text);
  return data.result;
}

async function getSession(id) {
  const raw = await redisCmd('GET', `hd:${id}`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

async function setSession(id, value, ttl = 600) {
  await redisCmd('SET', `hd:${id}`, JSON.stringify(value), 'EX', ttl);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' };

  const params = event.queryStringParameters || {};
  const action = params.action;
  const sessionId = params.id;

  try {
    // POST ?action=create
    if (event.httpMethod === 'POST' && action === 'create') {
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      await setSession(id, { status: 'waiting', created: Date.now() });
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ sessionId: id }) };
    }

    // POST ?action=upload&id=X
    if (event.httpMethod === 'POST' && action === 'upload' && sessionId) {
      let body;
      try { body = JSON.parse(event.body || '{}'); }
      catch(e) { return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Invalid JSON' }) }; }
      if (!body.imageBase64) return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Missing imageBase64' }) };
      await setSession(sessionId, { status: 'ready', imageBase64: body.imageBase64, created: Date.now() }, 300);
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true }) };
    }

    // GET ?action=poll&id=X
    if (event.httpMethod === 'GET' && action === 'poll' && sessionId) {
      const session = await getSession(sessionId);
      if (!session) return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ status: 'waiting' }) };
      if (session.status === 'ready') {
        await setSession(sessionId, { status: 'consumed', created: session.created }, 60);
        return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ status: 'ready', imageBase64: session.imageBase64 }) };
      }
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ status: session.status }) };
    }

    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Invalid action' }) };

  } catch (err) {
    console.error('upload-session error:', err.message);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: err.message }) };
  }
};
