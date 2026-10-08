# Adrial Apps: handoff and local setup

Goal: run the Adrial Apps on Cloudflare for free, private to you, using the original front-end files.

## Current state

- Repo: `simonm200012/business_apps`, branch `claude/friendly-mayer-rcxumj`.
- `site/` holds the original front-end files copied from the live Cloud Run site. This is what Cloudflare serves.
  - Included: erp, crm, analytics, mail, invoices, desk, design-compare, branch-manager, parcels, recon, stores, onboarding, contracts, marketing, client-atlas, pisarna-dms, postbench, team-tasks, plus `_shared/`.
  - The home page currently lists 18 tiles.
- `public/` (earlier rebuild) and the stray `bk-*.png` files were removed.
- `wrangler.jsonc` points Cloudflare at `./site`.
- Cloudflare project: `business-apps`, live at https://business-apps.simonm2000.workers.dev
- Build settings in Cloudflare: build command empty, deploy command `npx wrangler deploy`.

## What is not done yet

1. ~~Cloudflare Access~~ done: policy `business-apps owner` (Allow, simonm2000@outlook.com, One-time PIN) is attached to the worker for all traffic and verified.
2. **Stratum (`showcase/`) is not in the repo.** It is private on the original server (needs sign-in). Add it only after step 1 works.
   - Download it while signed in on the original site, or copy `C:\hub\public\showcase` from your PC into `site/showcase/`.
3. **Eight apps that need your server are not in `site/`:** ads, billing, cs-quality, hub-usage, margin, n8n, refill, webshop. Without the server they only show a sign-in page. Copy them from `C:\hub\public\` if you want the tiles to open.
4. ~~Cleanup~~ done.
5. **Home page:** `site/index.html` tiles for the apps above need adding back (copy the full `C:\hub\public\index.html`).

## Run locally

```
cd site
python3 -m http.server 8080
```

Open http://localhost:8080/ (Windows: `python -m http.server 8080`). Do not open the HTML files directly from disk; use the server.

Or with the original Node server (no credentials needed for the demo apps):

```
cd C:\hub
npm install
node server.js
```

## Deploy to Cloudflare

Cloudflare builds from GitHub on every push to the connected branch.

1. Put your changes in the repo (`site/`), commit and push.
2. Cloudflare redeploys automatically. To force it: project -> Deployments -> Retry build.
3. To switch to `main`: merge the branch, then Settings -> Builds -> Production branch = `main`.

## Limits of the free static setup

- Data is stored per browser and device (IndexedDB). There is no cloud sync and no `/api/...` server.
- Live-only modes of the apps stay in demo mode.
- Invoices and Desk load pdf.js and OCR libraries from a CDN, so they need internet.

## Notes

- Do not put passwords or API keys in this repo. The password shared in chat earlier should be changed on the original server.
- The guide with how each app is built is in `docs/APPS-CODE-GUIDE.md`.
