exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return { statusCode: 500, headers, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not set in Netlify environment variables' }) };

    const body = JSON.parse(event.body || '{}');
    const { imageBase64, isPack } = body;
    if (!imageBase64) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing imageBase64' }) };

    // Detect media type from base64 header if available, default to jpeg
    const mediaType = 'image/jpeg';

    const prompt = isPack
      ? `Identify this Pokémon TCG booster pack. Return ONLY valid JSON, no markdown:
{"name":"pack product name","set":"set name","set_id":"TCG API set id if known"}`
      : `You are a precise Pokémon TCG card identifier. Examine this card image carefully and return ONLY valid JSON — no markdown, no explanation, no code blocks:
{"name":"exact card name as printed","pokemon":"base Pokémon name e.g. Gengar or null","set":"full official set name","set_id":"TCG API set id e.g. sv3pt5 for 151","number":"collector number e.g. 094/165","year":"year printed","rarity":"rarity text","hp":"HP number or null","types":["Psychic"],"artist":"illustrator name or null","condition":"NM or LP or MP or HP or DMG","condition_notes":"one brief phrase","search_query":"optimized eBay sold search string including card name number set"}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
            { type: 'text', text: prompt }
          ]
        }]
      })
    });

    const data = await response.json();

    // Pass through any API errors with detail
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
