# HoloDex News Fix

Changed files:

- `netlify/functions/news.js`
- `app.js`
- `sw.js`

What changed:

- News now tries PokéBeach RSS first.
- If PokéBeach blocks/fails from Netlify, it scrapes PokeGuardian public headlines and converts them to RSS.
- The front end no longer hardcodes "PokéBeach" for every news item.
- `loadNews()` uses `cache: 'no-store'` and a timestamp query to avoid stale PWA/service-worker news responses.
- Service worker cache bumped to `holodex-v4`.
