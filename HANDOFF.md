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
2. ~~Stratum (`showcase/`)~~ done: copied into `site/showcase/` and its tile is visible on the home page.
3. ~~Eight server apps~~ done: ads, billing, cs-quality, hub-usage, margin, n8n, refill, webshop are in `site/` with the full home page. Billing works offline. ads, cs-quality, hub-usage, margin, refill, webshop and n8n run on made-up demo data: `_shared/demo-api.js` answers their `/api/...` calls in the browser and each app has a `demo-api.js`. A DEMO DATA badge is shown. To use real data later, remove the two demo script tags from the app's `index.html` and add a real backend.
4. ~~Cleanup~~ done.
5. ~~Home page~~ done: full tile list restored.

## Added since

- **Cash forecast** (`site/cashflow/`): a 13-week cash forecast app with demo data, built to sell to companies. Tile on the home page. Tests: `node tools/tests/cashflow-engine.test.js`.

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
