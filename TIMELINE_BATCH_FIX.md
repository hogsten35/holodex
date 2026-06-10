# HoloDex Timeline + Batch Scan Fix

Replace these files in your repo:

- `app.js`
- `index.html`
- `sw.js`

## Added

### Collection Value Timeline
- Adds a chart on the Collection page.
- Supports 7D / 30D / All views.
- Shows Today, Change, High, and Low.
- Saves a daily value snapshot in `holodex_value_history`.
- `valueHistory` is already included in Cloud Sync.

### Refresh Values
- Adds a `Refresh Values` button on the Collection timeline.
- Also adds `Refresh Market Values` in Settings.
- Uses PokémonTCG.io / TCGplayer raw-card market values, not eBay active listing outliers.

### Batch Upload Scans
- Adds a `Batch Upload Scans` button on the Scan page.
- Select multiple card photos at once.
- Processes images one at a time to avoid hammering the API.
- Auto-adds recognized cards to the collection.
- Uses selected condition for the whole batch.
- Skips eBay during batch processing so big batches are faster.
- Cloud Sync is muted during the batch and then syncs once at the end.

## After replacing

Push to GitHub, let Netlify deploy, then hard refresh:

`Ctrl + Shift + R`

If the PWA cache still shows old files:

DevTools → Application → Service Workers → Unregister → Reload

Service worker cache bumped to `holodex-v8`.
