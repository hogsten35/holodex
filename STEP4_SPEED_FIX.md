# HoloDex Step 4 Speed Fix

Replace only:

- app.js
- sw.js

What changed:

- The full-screen scan overlay no longer waits for eBay pricing/activity.
- The scan result appears as soon as the card is identified and matched.
- eBay market listings load in the price panel in the background.
- eBay lookup is limited to fewer focused searches and has a client-side timeout.
- Service worker cache bumped to holodex-v6.
