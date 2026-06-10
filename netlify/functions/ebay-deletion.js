// eBay Marketplace Account Deletion Notification Handler
// Required by eBay to activate Production API keys
// HoloDex stores no eBay user data, so this simply acknowledges the notification

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-EBAY-SIGNATURE'
  };

  // eBay sends a GET challenge request first to verify the endpoint
  if (event.httpMethod === 'GET') {
    const challengeCode = event.queryStringParameters?.challenge_code;
    if (challengeCode) {
      // eBay requires: SHA256(challengeCode + verificationToken + endpoint)
      const crypto = require('crypto');
      const verificationToken = process.env.EBAY_VERIFICATION_TOKEN || 'holodex-verification-token-12345';
      const endpoint = `https://${event.headers.host}/.netlify/functions/ebay-deletion`;
      const hash = crypto.createHash('sha256')
        .update(challengeCode + verificationToken + endpoint)
        .digest('hex');
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ challengeResponse: hash })
      };
    }
  }

  // eBay sends POST notifications when an account is deleted
  // We don't store eBay user data so we just acknowledge
  if (event.httpMethod === 'POST') {
    console.log('eBay deletion notification received:', event.body);
    return { statusCode: 200, headers, body: JSON.stringify({ acknowledged: true }) };
  }

  return { statusCode: 200, headers, body: JSON.stringify({ status: 'ok' }) };
};
