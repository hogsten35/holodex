
// HoloDex QR Upload Session Manager
// Uses query params instead of path segments (Netlify function routing limitation)
// Sessions stored in-memory — resets on cold start, fine for short-lived QR sessions

const sessions = {};

function cleanOldSessions() {
  const cutoff = Date.now() - 1000 * 60 * 15; // 15 min TTL
  Object.keys(sessions).forEach(k => {
    if (sessions[k].created < cutoff) delete sessions[k];
  });
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  cleanOldSessions();

  const method = event.httpMethod;
  const params = event.queryStringParameters || {};
  const action = params.action;
  const sessionId = params.id;

  // POST ?action=create  →  create new session
  if (method === 'POST' && action === 'create') {
    const id = Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
    sessions[id] = { status: 'waiting', created: Date.now() };
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ sessionId: id })
    };
  }

  // POST ?action=upload&id=SESSION_ID  →  phone uploads image
  if (method === 'POST' && action === 'upload' && sessionId) {
    if (!sessions[sessionId]) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Session not found or expired' }) };
    }
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch(e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) }; }
    if (!body.imageBase64) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing imageBase64' }) };
    sessions[sessionId] = { status: 'ready', imageBase64: body.imageBase64, created: sessions[sessionId].created };
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  }

  // GET ?action=poll&id=SESSION_ID  →  desktop polls for result
  if (method === 'GET' && action === 'poll' && sessionId) {
    if (!sessions[sessionId]) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Session not found or expired' }) };
    }
    const s = sessions[sessionId];
    if (s.status === 'ready') {
      const img = s.imageBase64;
      sessions[sessionId] = { ...s, status: 'consumed', imageBase64: null };
      return { statusCode: 200, headers, body: JSON.stringify({ status: 'ready', imageBase64: img }) };
    }
    return { statusCode: 200, headers, body: JSON.stringify({ status: s.status }) };
  }

  return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid request. Use ?action=create|upload|poll' }) };
};
