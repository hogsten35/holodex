// HoloDex QR Upload Session — Upstash Redis REST API
// Upstash REST format: POST to /pipeline or GET /{command}/{args}

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

async function redisRequest(commands) {
  const url = (process.env.UPSTASH_REDIS_REST_URL || '').trim();
  const token = (process.env.UPSTASH_REDIS_REST_TOKEN || '').trim();

  if (!url || !token) {
    throw new Error('UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN not set');
  }

  // Use pipeline endpoint for multiple commands, single for one
  const endpoint = Array.isArray(commands[0]) ? `${url}/pipeline` : `${url}`;
  const body = Array.isArray(commands[0]) ? commands : commands;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch(e) {
    throw new Error('Upstash returned non-JSON: ' + text.substring(0, 200));
  }
}

async function redisGet(key) {
  const result = await redisRequest(['GET', key]);
  if (!result || !result.result) return null;
  try { return JSON.parse(result.result); } catch(e) { return null; }
}

async function redisSet(key, value, ttl) {
  if (ttl) {
    await redisRequest(['SET', key, JSON.stringify(value), 'EX', ttl]);
  } else {
    await redisRequest(['SET', key, JSON.stringify(value)]);
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: HEADERS, body: '' };
  }

  const params = event.queryStringParameters || {};
  const action = params.action;
  const sessionId = params.id;
  const method = event.httpMethod;

  try {
    // POST ?action=create — desktop opens QR modal
    if (method === 'POST' && action === 'create') {
      const id = Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
      await redisSet(`holodex:${id}`, { status: 'waiting', created: Date.now() }, 600);
      return {
        statusCode: 200,
        headers: HEADERS,
        body: JSON.stringify({ sessionId: id })
      };
    }

    // POST ?action=upload&id=X — phone sends the image
    if (method === 'POST' && action === 'upload' && sessionId) {
      let body;
      try { body = JSON.parse(event.body || '{}'); }
      catch(e) { return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Invalid request body' }) }; }

      if (!body.imageBase64) {
        return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Missing imageBase64' }) };
      }

      await redisSet(`holodex:${sessionId}`, {
        status: 'ready',
        imageBase64: body.imageBase64,
        created: Date.now()
      }, 600);

      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true }) };
    }

    // GET ?action=poll&id=X — desktop polls waiting for image
    if (method === 'GET' && action === 'poll' && sessionId) {
      const session = await redisGet(`holodex:${sessionId}`);

      if (!session) {
        return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ status: 'waiting' }) };
      }

      if (session.status === 'ready') {
        // Consume it so it's not picked up twice
        await redisSet(`holodex:${sessionId}`, { status: 'consumed', created: session.created }, 60);
        return {
          statusCode: 200,
          headers: HEADERS,
          body: JSON.stringify({ status: 'ready', imageBase64: session.imageBase64 })
        };
      }

      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ status: session.status }) };
    }

    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Invalid action' }) };

  } catch(err) {
    console.error('upload-session error:', err.message);
    return {
      statusCode: 500,
      headers: HEADERS,
      body: JSON.stringify({ error: err.message })
    };
  }
};
