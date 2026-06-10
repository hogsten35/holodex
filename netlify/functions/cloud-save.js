// HoloDex Cloud Save — Upstash Redis REST API
// Stores one encrypted-by-obscurity cloud backup per private save code.
// Anyone with the save code can load that collection, so users should keep it private.

const crypto = require('crypto');

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

function normalizeCode(code) {
  return String(code || '').trim().toUpperCase().replace(/\s+/g, '').replace(/[^A-Z0-9-]/g, '');
}

function makeCode() {
  // 60 bits of randomness; short enough to type, hard enough to guess for friends/family beta.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i++) out += alphabet[bytes[i] % alphabet.length];
  return `HDEX-${out.slice(0,4)}-${out.slice(4,8)}-${out.slice(8,12)}`;
}

function safePayload(data) {
  const collection = Array.isArray(data?.collection) ? data.collection : [];
  const wishlist = Array.isArray(data?.wishlist) ? data.wishlist : [];
  const valueHistory = Array.isArray(data?.valueHistory) ? data.valueHistory : [];
  return {
    app: 'HoloDex',
    version: 1,
    updatedAt: new Date().toISOString(),
    collection,
    wishlist,
    valueHistory
  };
}

async function redisCmd(command, ...args) {
  const url = (process.env.UPSTASH_REDIS_REST_URL || '').trim().replace(/\/$/, '');
  const token = (process.env.UPSTASH_REDIS_REST_TOKEN || '').trim();
  if (!url || !token) throw new Error('UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN is not set in Netlify env vars');

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([command, ...args])
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Redis ${res.status}: ${text}`);
  const data = JSON.parse(text);
  return data.result;
}

async function saveCloud(code, data) {
  const payload = safePayload(data);
  const raw = JSON.stringify(payload);

  // Keep this conservative for the free tier / Netlify payload comfort.
  // A normal card collection should be far below this.
  if (Buffer.byteLength(raw, 'utf8') > 900_000) {
    const err = new Error('Cloud save is too large. Export a JSON backup and trim old data before syncing.');
    err.statusCode = 413;
    throw err;
  }

  await redisCmd('SET', `hd:cloud:${code}`, raw);
  return payload;
}

async function loadCloud(code) {
  const raw = await redisCmd('GET', `hd:cloud:${code}`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch (e) { return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

    const action = body.action;

    if (action === 'create') {
      let code = makeCode();
      // Very small collision chance, but check a few times anyway.
      for (let i = 0; i < 5; i++) {
        const existing = await loadCloud(code);
        if (!existing) break;
        code = makeCode();
      }
      const payload = await saveCloud(code, body.data || {});
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true, code, updatedAt: payload.updatedAt }) };
    }

    const code = normalizeCode(body.code);
    if (!code || code.length < 10) {
      return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Missing or invalid cloud save code' }) };
    }

    if (action === 'save') {
      const payload = await saveCloud(code, body.data || {});
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true, code, updatedAt: payload.updatedAt }) };
    }

    if (action === 'load') {
      const payload = await loadCloud(code);
      if (!payload) return { statusCode: 404, headers: HEADERS, body: JSON.stringify({ error: 'Cloud save code not found' }) };
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true, code, updatedAt: payload.updatedAt, data: payload }) };
    }

    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Unknown action' }) };
  } catch (err) {
    return { statusCode: err.statusCode || 500, headers: HEADERS, body: JSON.stringify({ error: err.message }) };
  }
};
