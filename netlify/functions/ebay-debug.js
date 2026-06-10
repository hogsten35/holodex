// Temporary debug function — tests eBay token + search and returns raw response
exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return { statusCode: 200, headers, body: JSON.stringify({ step: 'keys', error: 'EBAY_CLIENT_ID or EBAY_CLIENT_SECRET not set in Netlify env vars' }) };
  }

  // Step 1: get token
  let token;
  try {
    const res = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': 'Basic ' + Buffer.from(clientId + ':' + clientSecret).toString('base64') },
      body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope'
    });
    const d = await res.json();
    if (!d.access_token) return { statusCode: 200, headers, body: JSON.stringify({ step: 'token', status: res.status, error: d.error_description || d.error, raw: d }) };
    token = d.access_token;
  } catch(e) {
    return { statusCode: 200, headers, body: JSON.stringify({ step: 'token', error: e.message }) };
  }

  // Step 2: test Browse API search
  try {
    const res = await fetch(
      'https://api.ebay.com/buy/browse/v1/item_summary/search?q=Pokemon+Mewtwo+holo&limit=5&category_ids=183454',
      { headers: { 'Authorization': 'Bearer ' + token, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US', 'X-EBAY-C-ENDUSERCTX': 'affiliateCampaignId=0' } }
    );
    const d = await res.json();
    return { statusCode: 200, headers, body: JSON.stringify({
      step: 'search',
      status: res.status,
      total: d.total,
      itemCount: d.itemSummaries?.length || 0,
      firstItem: d.itemSummaries?.[0] ? { title: d.itemSummaries[0].title, price: d.itemSummaries[0].price, condition: d.itemSummaries[0].condition } : null,
      errors: d.errors || null
    })};
  } catch(e) {
    return { statusCode: 200, headers, body: JSON.stringify({ step: 'search', error: e.message }) };
  }
};
