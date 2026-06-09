exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/xml',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=900'
  };
  try {
    const res = await fetch('https://www.pokebeach.com/feed');
    if (!res.ok) throw new Error('Feed returned ' + res.status);
    const text = await res.text();
    return { statusCode: 200, headers, body: text };
  } catch(e) {
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: e.message }) };
  }
};
