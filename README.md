# Business Apps

Browser apps for finance, sales, operations and people, plus the Clearfigure showcase site. They are demos Simon shows to
customers and tools he uses himself. Live (private, behind Cloudflare Access): https://business-apps.simonm2000.workers.dev

- `site/`: the web root. Every app is a folder of plain HTML, CSS and JavaScript (no build step). The home page
  `site/index.html` lists them in groups; in the default look "All apps" is a list with a one-page sales sheet per app (texts in
  `site/_shared/app-sheets.js`, `#app=<id>` links to one). How the apps are built: `docs/APPS-CODE-GUIDE.md`.
- `worker/`: a small Cloudflare Worker that answers only `/api/*`: the private cloud copy that keeps each app's data the
  same on the phone and the computer (`worker/index.js`, Access check in `worker/access.js`).
- `tools/`: `make-pwa.mjs` (home-screen tags on every page), `make-icons.mjs` (the launcher and app icons in
  `site/icons/`, drawn by `tools/icons/`), `tests/` (Node tests).
- `portal-site/`, `worker/portal.js`, `wrangler.portal.jsonc`: the client portal, a separate Worker (`docs/CLIENT-PORTAL.md`).
- `HANDOFF.md`: current state, deploy steps and what to check.

## Run locally

Static only (apps work, sync stays off):

```
cd site
python3 -m http.server 8080
```

With the sync server (needs Node; `.dev.vars` with `DEV_BYPASS=1` skips the Access check locally and is never deployed):

```
printf 'DEV_BYPASS=1\n' > .dev.vars
npx wrangler dev
```

## Tests

```
for f in tools/tests/*.test.js; do node "$f" || break; done
```

## Deploy

`npx wrangler deploy` from the repo root (it serves `site/` and runs `worker/`). The R2 bucket `business-apps-sync-eu`
(EU jurisdiction) must exist (`npx wrangler r2 bucket create business-apps-sync-eu --jurisdiction eu`, done once).
