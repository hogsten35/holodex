# HoloDex — BossHog Gaming

Pokémon TCG Card Scanner & Collection Tracker

## Deploy to Netlify (Functions Required)

> ⚠️ Drag-and-drop on Netlify does NOT deploy functions. Follow these steps instead.

### Step 1 — Push to GitHub

1. Go to [github.com](https://github.com) → **New repository** → name it `holodex` → Create
2. Open a terminal on your PC (or use GitHub Desktop):
```
git init
git add .
git commit -m "Initial HoloDex deploy"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/holodex.git
git push -u origin main
```

### Step 2 — Connect Netlify to GitHub

1. Go to [app.netlify.com](https://app.netlify.com) → **Add new site** → **Import an existing project**
2. Choose **GitHub** → authorize → select your `holodex` repo
3. Build settings:
   - **Build command**: *(leave blank)*
   - **Publish directory**: `.`
   - **Functions directory**: `netlify/functions`
4. Click **Deploy site**

### Step 3 — Add Environment Variables

In Netlify → **Site Settings** → **Environment Variables** → Add:

| Key | Value |
|-----|-------|
| `ANTHROPIC_API_KEY` | Your key from console.anthropic.com |

### Step 4 — Set up GitHub Actions (auto-deploy on push)

In Netlify → **Site Settings** → **General** → copy your **Site ID**

In Netlify → **User Settings** → **Applications** → **Personal access tokens** → create one

In GitHub → your repo → **Settings** → **Secrets and variables** → **Actions** → add:
- `NETLIFY_SITE_ID` = your site ID
- `NETLIFY_AUTH_TOKEN` = your personal access token

Now every `git push` auto-deploys.

### Step 5 — Install as PWA on phone

1. Open your Netlify URL in **Safari** (iOS) or **Chrome** (Android)
2. iOS: tap Share → **Add to Home Screen**
3. Android: tap menu → **Add to Home Screen** (or Chrome will prompt)

## API Keys

- **Anthropic API**: [console.anthropic.com](https://console.anthropic.com) (required for card scanning)
- **eBay API**: [developer.ebay.com](https://developer.ebay.com) (optional, for real sold prices)
  - Add Client ID and Client Secret in the app's Settings tab
