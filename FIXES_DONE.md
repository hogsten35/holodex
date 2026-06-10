# HoloDex polished fix pack

## Main scanner fix

The app no longer trusts the AI's guessed set/collector number by itself.

Flow now:
1. Claude reads the photo and returns visible text, attacks, abilities, HP, type, condition, etc.
2. `app.js` searches PokémonTCG.io for candidate cards.
3. It scores candidates using exact name, collector number, set, HP/type, and especially visible move/ability text.
4. It replaces the AI guess with the best verified PokémonTCG.io printing before showing the card image or doing eBay pricing.

This fixes cases where the scan reads `Psyduck` correctly but shows the wrong Psyduck artwork/number.

## Other polish

- Added `/favicon.ico` and index favicon link.
- Added `mobile-web-app-capable` meta to remove the Chrome PWA warning.
- Made the news Netlify function return a valid fallback RSS feed with status 200 instead of console 500.
- Bumped service worker cache to `holodex-v3` so deployed updates refresh cleanly.

## After deploy

Hard refresh once after Netlify finishes deploying:

- Windows Chrome: Ctrl + Shift + R
- Or DevTools > Application > Service Workers > Unregister, then reload

Then rescan the card.
