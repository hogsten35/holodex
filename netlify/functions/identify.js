exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return { statusCode: 500, headers, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not set in Netlify environment variables' }) };

    const body = JSON.parse(event.body || '{}');
    const { imageBase64, isPack } = body;
    if (!imageBase64) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing imageBase64' }) };

    const prompt = isPack
      ? `Identify this Pokémon TCG booster pack. Return ONLY valid JSON:
{"name":"pack product name","set":"set name","set_id":"TCG API set id if known"}`
      : `You are an expert Pokémon TCG card identifier. The card may be inside a protective sleeve or case — look through it carefully. Read ALL visible text on the card precisely.

Return ONLY valid JSON, no markdown, no explanation:
{
  "name": "exact card name as printed — include ex/V/VMAX/GX/EX suffixes and any partner names like 'Slowpoke & Psyduck-GX'",
  "pokemon": "primary Pokémon name only e.g. Psyduck",
  "set": "full official set name",
  "set_id": "TCG API set id e.g. sm11 for Unified Minds, sv3pt5 for 151",
  "number": "collector number e.g. 039/237",
  "year": "year printed at card bottom",
  "rarity": "rarity as printed e.g. Common, Rare Holo, Ultra Rare",
  "hp": "HP number or null",
  "types": ["Water"],
  "artist": "illustrator name or null",
  "condition": "NM or LP or MP or HP or DMG",
  "condition_notes": "one brief phrase",
  "search_query": "eBay search string e.g. Pokemon Psyduck Slowpoke GX 039/237 Unified Minds sm11"
}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } },
            { type: 'text', text: prompt }
          ]
        }]
      })
    });

    const data = await response.json();

    if (data.error) {
      console.error('Anthropic API error:', JSON.stringify(data.error));
      return { statusCode: 200, headers, body: JSON.stringify({ _apiError: data.error.message || JSON.stringify(data.error), content: [] }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify(data) };

  } catch (err) {
    console.error('identify function error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
