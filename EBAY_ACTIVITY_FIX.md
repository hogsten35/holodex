# eBay Activity Fix

Adds a lightweight eBay activity panel to scan results.

## What changed

- Shows **Latest listing seen** when eBay provides listing date fields.
- Shows how many matching active listings were checked.
- Renames table labels from sold/sales wording to active listing wording.
- Keeps the wording honest: this is eBay Browse API active listing data, not completed sold comps.
- Bumps the service worker cache to `holodex-v5`.

## Replace these files

- `app.js`
- `index.html`
- `sw.js`

No Netlify environment variable changes are needed.
