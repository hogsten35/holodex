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
      : `You are an expert Pokémon TCG card identifier. The card may be inside a protective sleeve, top loader, or case. Read only what is actually visible on the card.

IMPORTANT:
- Do NOT guess a set, set_id, collector number, or year if it is blurry or hidden. Use null when unsure.
- The collector number is usually at the bottom-left or bottom-right and looks like 054/165, 070/102, TG01/TG30, etc.
- Capture attack names, ability names, HP, type, illustrator, and any visible bottom text because the app will use them to verify the exact printing.
- Return ONLY valid JSON, no markdown, no explanation.

{
  "name": "exact card name as printed — include ex/V/VMAX/GX/EX suffixes and partner names",
  "pokemon": "primary Pokémon name only e.g. Psyduck",
  "set": "full official set name or null if not clearly visible",
  "set_id": "PokémonTCG.io set id if known with high confidence, otherwise null",
  "number": "collector number exactly as visible e.g. 054/165, or null if unreadable",
  "year": "copyright/card year if visible, otherwise null",
  "rarity": "rarity as printed or null",
  "hp": "HP number or null",
  "types": ["Water"],
  "artist": "illustrator name or null",
  "abilities": ["ability names/text you can read"],
  "attacks": ["attack names/damage you can read"],
  "visible_text": "short string of the most useful visible words/numbers from the card",
  "condition": "NM or LP or MP or HP or DMG",
  "condition_notes": "one brief phrase",
  "search_query": "Pokemon + exact name + collector number if known + set if known"
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
