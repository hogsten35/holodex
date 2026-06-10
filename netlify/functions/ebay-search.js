// eBay Browse API proxy — handles CORS by running server-side
exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const { query, limit = 50 } = JSON.parse(event.body || '{}');
    if (!query) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing query' }) };

    // Get token server-side
    const clientId = process.env.EBAY_CLIENT_ID;
    const clientSecret = process.env.EBAY_CLIENT_SECRET;
    if (!clientId || !clientSecret) return { statusCode: 503, headers, body: JSON.stringify({ error: 'eBay keys not configured' }) };

    const tokenRes = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(clientId + ':' + clientSecret).toString('base64')
      },
      body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope'
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) return { statusCode: 401, headers, body: JSON.stringify({ error: tokenData.error_description || 'Token failed' }) };

    const token = tokenData.access_token;

    // Search eBay Browse API
    const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(query)}&limit=${limit}&category_ids=183454&sort=newlyListed`;
    const searchRes = await fetch(url, {
      headers: {
        'Authorization': 'Bearer ' + token,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
        'X-EBAY-C-ENDUSERCTX': 'affiliateCampaignId=0'
      }
    });
    const data = await searchRes.json();
    return { statusCode: 200, headers, body: JSON.stringify(data) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
