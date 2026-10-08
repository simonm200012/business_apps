# Business Apps (Adrial Apps)

Static browser apps (no build step, no server). Web root is `site/`. Spec: `docs/APPS-CODE-GUIDE.md`.

Run locally: `cd site && python3 -m http.server 8080`, then open http://localhost:8080/

## Deploy free on Cloudflare (Workers static assets)
1. Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git → pick this repo.
2. Framework preset: None. Build command: leave empty. Build output directory: `site`.
3. Save and Deploy. You get `https://<name>.pages.dev`; add your own domain under Custom domains (free).
4. To keep it private: Zero Trust → Access → Applications → add the pages.dev/domain, allow only your e-mail (free up to 50 users).

Data is stored per browser (IndexedDB), so each device/browser has its own copy; there is no cloud sync.
