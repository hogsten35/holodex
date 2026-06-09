
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  try {
    const { imageBase64, isPack } = JSON.parse(event.body);
    if (!imageBase64) return { statusCode: 400, body: 'Missing imageBase64' };

    const prompt = isPack
      ? `You are identifying a Pokémon TCG booster pack. Return ONLY valid JSON:
{"name":"pack product name","set":"set name","set_id":"TCG API set id if known"}`
      : `You are a precise Pokémon TCG card identifier. Return ONLY valid JSON — no markdown:
{"name":"exact card name","pokemon":"base Pokémon name or null","set":"full set name","set_id":"TCG API set id e.g. sv3pt5","number":"collector number","year":"year","rarity":"rarity text","hp":"HP or null","types":["Fire"],"artist":"illustrator or null","condition":"NM/LP/MP/HP/DMG","condition_notes":"brief phrase","search_query":"optimized eBay search string"}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1000, messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } }, { type: 'text', text: prompt }] }] })
    });
    const data = await response.json();
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
