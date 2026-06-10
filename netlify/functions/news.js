// RSS proxy for HoloDex news. If the upstream feed blocks/fails, return a tiny
// valid RSS fallback with 200 so the browser console stays clean.
exports.handler = async () => {
  const headers = {
    'Content-Type': 'application/xml; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=900'
  };

  const fallback = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>HoloDex News</title>
<item><title>Pokémon TCG market news temporarily unavailable</title><link>https://www.pokebeach.com/</link><pubDate>${new Date().toUTCString()}</pubDate></item>
</channel></rss>`;

  try {
    const res = await fetch('https://www.pokebeach.com/feed', {
      headers: { 'User-Agent': 'HoloDex/1.0 (+Netlify Function)' }
    });
    if (!res.ok) throw new Error('Feed returned ' + res.status);
    const text = await res.text();
    if (!text || !text.includes('<item')) throw new Error('Feed was empty');
    return { statusCode: 200, headers, body: text };
  } catch(e) {
    console.warn('news feed fallback:', e.message);
    return { statusCode: 200, headers, body: fallback };
  }
};
