# HoloDex Pro UI + Batch Review Upgrade

## Replace
- app.js
- index.html
- sw.js

## Adds
- Pro-style card detail drawer with hero card image, set badge, raw TCG market price, eBay activity, owned count/value, market/history/set/details tabs.
- Recent eBay active-listing activity inside card details.
- Graded market watch section for PSA 10 / PSA 9 / PSA 8 active listing checks. These are active asking/listing values, not sold comps.
- Batch scan review workflow. Batch uploads now scan photos first, then let you review/select cards before adding them to the collection.
- Service worker cache bumped to holodex-v8.

## Notes
- Collection value still uses TCGplayer/PokemonTCG raw market pricing.
- eBay and graded sections are informational and not used to calculate collection value.
- Batch scans still use the Anthropic identify function once per uploaded image.
