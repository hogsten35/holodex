# HoloDex TCG Price Fix

This fix keeps TCGplayer / PokémonTCG.io as the primary raw-card value and uses eBay only for market activity.

Why:
- eBay Browse API returns active listings, not completed sales.
- Active listings can include PSA/CGC/BGS slabs, sealed packs, lots, and outlier seller prices.
- That caused common raw cards like Pikachu 42/146 to show inflated prices.

Replace:
- app.js
- sw.js

After deploy:
- Hard refresh with Ctrl+Shift+R
- If needed: DevTools > Application > Service Workers > Unregister > Reload

Cache bumped to holodex-v7.
