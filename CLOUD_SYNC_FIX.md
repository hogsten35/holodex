# HoloDex Cloud Sync Fix

Adds a cheap/free Cloud Save Code system using the Upstash Redis environment variables already used by the QR phone scanner.

## Replace/add these files

- `app.js`
- `index.html`
- `sw.js`
- `netlify/functions/cloud-save.js` ← new file

## How it works

1. User opens Settings → Cloud Sync.
2. User taps Create Cloud Save.
3. App creates a private code like `HDEX-ABCD-2345-WXYZ`.
4. Collection, wishlist, and value history save automatically to Upstash through a Netlify function.
5. On another device, user taps Connect Existing Code and enters the code.

## Important

This is not a login system. The cloud save code acts like the password. Anyone with the code can load that collection, so keep it private.

## Required Netlify env vars

Already present if QR phone scanner works:

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

## Service worker

Cache bumped to `holodex-v8`.
