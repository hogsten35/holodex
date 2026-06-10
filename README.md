# HoloDex — BossHog Gaming

Pokémon TCG card scanner, collection tracker, wishlist, PWA, and desktop-to-phone QR scanner.

## What this version fixes

- Front-end `app.js` now parses correctly and loads.
- eBay keys stay server-side in Netlify environment variables.
- Settings → Test eBay Connection now checks the deployed Netlify function instead of asking for browser-side keys.
- Pricing calls use `/.netlify/functions/ebay-search` instead of exposing credentials.
- QR phone upload uses Upstash Redis through `/.netlify/functions/upload-session`.
- Icons are placed in `/icons/` to match the manifest and Apple touch icon paths.
- Netlify Functions are in `/netlify/functions/`.

## Project structure

```text
holodex/
  index.html
  app.js
  manifest.json
  sw.js
  scan-phone.html
  netlify.toml
  README.md

  icons/
    icon-192.png
    icon-512.png

  netlify/
    functions/
      identify.js
      ebay-search.js
      ebay-token.js
      ebay-debug.js
      ebay-deletion.js
      news.js
      upload-session.js

  .github/
    workflows/
      deploy.yml
```

## Deploy to Netlify

> Drag-and-drop deploys do **not** deploy Netlify Functions. Use GitHub-connected deploys or the Netlify CLI.

### Step 1 — Push to GitHub

```bash
git init
git add .
git commit -m "Initial HoloDex deploy"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/holodex.git
git push -u origin main
```

### Step 2 — Connect Netlify to GitHub

1. Netlify → **Add new site** → **Import an existing project**
2. Select GitHub and choose your `holodex` repo
3. Build settings:
   - **Build command:** leave blank
   - **Publish directory:** `.`
   - **Functions directory:** `netlify/functions`
4. Deploy the site.

## Required Netlify environment variables

Your screenshot shows these are already stored in Netlify, which is exactly where they should be.

| Key | Required for | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | Card scanning | Required for Claude vision identification |
| `EBAY_CLIENT_ID` | eBay pricing | Production App ID / Client ID |
| `EBAY_CLIENT_SECRET` | eBay pricing | Production Cert ID / Client Secret |
| `UPSTASH_REDIS_REST_URL` | Desktop QR phone scanner | Required for temporary upload sessions |
| `UPSTASH_REDIS_REST_TOKEN` | Desktop QR phone scanner | Required for temporary upload sessions |
| `ANTHROPIC_MODEL` | Optional | Only add this if you want to override the default model in `identify.js` |
| `EBAY_VERIFICATION_TOKEN` | Optional | Use if eBay asks for marketplace account deletion endpoint verification |

After changing environment variables in Netlify, trigger a **fresh deploy**.

## GitHub Actions auto-deploy

Add these GitHub repository secrets:

- `NETLIFY_SITE_ID`
- `NETLIFY_AUTH_TOKEN`

Then every push to `main` will deploy using `.github/workflows/deploy.yml`.

## Testing checklist

1. Open your deployed Netlify site.
2. Go to **Settings** → **Test eBay Connection**.
3. Expected result: a green message saying eBay returned test listings.
4. Go to **Scan** → upload or capture a Pokémon card.
5. Expected result: card identification, image lookup, market pricing table, and chart.
6. Go to **Settings** → **Scan from Phone** and test the QR flow.

## Notes on pricing

This version uses eBay Browse API market listings through a server-side Netlify proxy. It does not expose eBay secrets to the browser.

The current function estimates market value from matching eBay listings. True historical sold-comps require a separate eBay sold/completed-items data source or approved marketplace insights access.
