# Clearfigure public site

The public sales site: a landing page in Slovenian (first), Croatian and English, a privacy page and a legal notice
(Slovenian), and demo-only copies of four apps (Data health check, Collections, Cash forecast, Budget vs actual).
It is a separate Cloudflare Worker (`clearfigure`) from the private Business Apps site: no Cloudflare Access, no cloud
sync, no link into the private apps. The server code is the contact form (`POST /api/contact`) and the branded demo pages (`/d/<slug>`, below).

## Where to change things

| What | File |
|---|---|
| Every price (EUR, without VAT) | `public/data/prices.mjs` |
| Company details (ZEPT Art. 5 placeholders), e-mail, phone, booking link, photo, LinkedIn, VAT sentence, Turnstile key, site URL | `public/data/company.mjs` |
| Words in SL / HR / EN (products, FAQ, Nordvik story, "Built for clients") | `public/src/content.mjs` |
| Page structure, privacy page, legal notice | `public/src/render.mjs` |
| Look | `public/assets/site.css` (system fonts only) |
| Form, calculator, menu | `public/assets/site.js` |
| Demo bar and what the demos hide | `public/assets/demo.js`, `public/assets/demo.css` |
| Contact form backend | `public/worker.js` |
| Branded demo pages (`/d/<slug>`, `/api/demo/<slug>`) | `public/demo.js`, `public/assets/demo-page.js`, shell in `public/src/render.mjs`, renderer `site/_shared/demo-*.js` |

Never edit `public/dist/`: the build rewrites it. The demo apps are copied from `site/<app>/` at build time, so a fix in an
app reaches the public demo with the next build.

## Build

```
node tools/build-public.mjs                  # → public/dist, noindex everywhere (default until launch)
node tools/build-public.mjs --index          # at launch: the landing and legal pages may be indexed
node tools/build-public.mjs --index --site-url https://www.example.si   # also canonical/hreflang links and sitemap.xml
```

The demo copies stay `noindex` even with `--index` (sample-data app screens). Tests:
`node tools/tests/public-build.test.js` and `node tools/tests/public-contact.test.js`.

Look at it locally:

```
python3 -m http.server 8301 -d public/dist --bind 127.0.0.1     # static only (the form then offers e-mail)
npx wrangler dev -c public/wrangler.jsonc --port 8302            # with the contact form and _headers, no login needed
```

## Deploy (from the repo root)

Once:

```
npx wrangler r2 bucket create clearfigure-leads --jurisdiction eu
npx wrangler r2 bucket lifecycle add clearfigure-leads ratelimit-expire ratelimit/ --expire-days 2 --jurisdiction eu
```

The second command makes the rate-limit records (hashed IPs) disappear after 2 days, as the privacy page says; the
Worker also deletes days before yesterday on each new message. After creating the bucket, check in the dashboard
(R2 → clearfigure-leads → Settings) that its jurisdiction is EU; only then set `leadsBucketEU: true` in
`public/data/company.mjs`, so the privacy page says the messages are stored in the EU.

Every time:

```
node tools/build-public.mjs
npx wrangler deploy -c public/wrangler.jsonc
```

It is served at `https://clearfigure.<your-subdomain>.workers.dev`. Nothing in the site is tied to a host name, so the
same build works there and on a custom domain.

### A custom domain later

1. Add the domain to Cloudflare (its DNS must be on Cloudflare).
2. Either in the dashboard: Workers & Pages → clearfigure → Settings → Domains & Routes → Add → Custom domain
   (e.g. `www.example.si`), or in `public/wrangler.jsonc`: `"routes": [{ "pattern": "www.example.si", "custom_domain": true }]`
   and deploy again.
3. Set `siteUrl: 'https://www.example.si'` in `public/data/company.mjs`, build with `--index` when you launch, deploy.
4. Optional: `"workers_dev": false` in `public/wrangler.jsonc` so only the domain answers.

The form posts to its own origin, so nothing else changes. If a second domain must post to the same Worker (e.g. during a
move), set `ALLOWED_ORIGINS` (comma-separated) under `vars`.

## Branded demos (`/d/<slug>`)

Made in the private site (Studio > Branded demo, `site/demo-builder/`, API `worker/demos.js`), stored in the same bucket
`clearfigure-leads` under `demos/<slug>/` (`config.json`, `logo.png`, `views.json`). This Worker only reads them:

- `GET /d/<slug>` the page (`dist/demo/index.html`), `GET /api/demo/<slug>` the settings (no internal fields) and
  `GET /api/demo/<slug>/logo.png`. Unknown and expired slugs get the same plain 404. Needs `"/d/*"` in `run_worker_first`.
- Every page and answer: noindex, `Referrer-Policy: no-referrer`, strict CSP (scripts and styles only from the site itself).
- A view = one config request per page load: `{ count, last }` in `views.json`, no IP, no cookie, no user agent. Link
  previews/bots (user-agent check in `worker/demo-shared.js`), prefetch and `?c=0` are not counted.
- Retention (as the privacy page says): deleted with the demo, or 90 days after it expired; the clean-up runs when the
  private editor's list is opened. A demo link is 16 random base32 characters (80 bits) after a readable part, so it can't be guessed.
- The build copies the sales sheets, the renderer, the pitch (`/pitch/`, app list `pitch/home.html` generated from the home page
  without the private apps) and the app icons. Sheet texts and the pitch stay in English; the page around them is EN/SL/HR/DE.
- The privacy page (Slovenian; the HR/EN pages link to it) has a paragraph "Osebne predstavitvene povezave".

## Contact form

`POST /api/contact`, JSON `{ name, company, email, phone, product, message, lang, website, elapsedMs, page }`.

- `website` is a hidden honeypot: if filled, the answer is a normal 200 and nothing is stored.
- `elapsedMs` (time since the page opened) under 3 s → 400 `too_fast`.
- Lengths: name 2–100, company ≤ 120, e-mail ≤ 254 (checked format), phone optional 6–40 of `0-9 + ( ) / . -` and spaces,
  message 10–4.000 characters, body ≤ 16 KB; `product` and `lang` from fixed lists. Only `application/json`, only POST,
  and a browser `Origin` must be the site itself.
- Rate limit: 5 messages per IP per hour (the IP is stored only as a hash with a daily random salt) and 200 per day for
  everyone → 429. All in R2, so it works on the free plan (the Cache API does not work on `workers.dev`).
- Stored: `leads/<YYYY-MM>/<YYYYMMDDHHMMSS>-<id>.json` = `{ v, id, receivedAt, source: "website", name, company, email,
  phone, product, message, lang, page }`. No IP, no user agent. The answer never repeats the input.
- The page shows success or failure in its language; when the API can't be reached (or answers 5xx/429) it offers a
  `mailto:` link with the message filled in.

Reading the messages until the Client Atlas import exists: Cloudflare dashboard → R2 → `clearfigure-leads` → `leads/`, or
`npx wrangler r2 object get clearfigure-leads/leads/2026-10/<file>.json --jurisdiction eu --remote --pipe`.

### Optional: Cloudflare Turnstile (spam check)

Only if spam gets through the honeypot and rate limit. Turnstile is a Cloudflare service; the form then loads a script
from `challenges.cloudflare.com` (add a line to the privacy page when you turn it on).

1. Dashboard → Turnstile → Add widget, host name(s) of the site, mode "Managed". Copy the site key and the secret key.
2. `turnstileSiteKey: '<site key>'` in `public/data/company.mjs` (the build then also allows that host in the CSP).
3. `npx wrangler secret put TURNSTILE_SECRET -c public/wrangler.jsonc` and paste the secret key.
4. Build and deploy. With the secret set, the Worker refuses messages without a valid token.

## Leads into Client Atlas (to build in the private site)

Client Atlas keeps leads in `site/client-atlas/leads.js` format `{ id, company, contact, channel, status, next, notes,
created, updated }`. The public Worker already has the mapping: `toAtlasLead(record)` in `public/worker.js` (tested with
`AtlasLeads.clean`). What the private Worker would need (not built here; `worker/` belongs to the private site):

1. **Binding** in the root `wrangler.jsonc`: add
   `{ "binding": "LEADS", "bucket_name": "clearfigure-leads", "jurisdiction": "eu" }` to `r2_buckets`.
2. **Route** in `worker/index.js`: `GET /api/leads?after=<key>` →
   - the same Access check as `/api/sync`, and **owner only**: `OWNER_EMAIL`, never a `VIEWER_EMAILS` person (add a
     `leads` entry next to `PRIVATE_APPS` in `worker/access.js` so viewers get 403);
   - `env.LEADS.list({ prefix: 'leads/', startAfter: after, limit: 100 })`, then `get` each key and return
     `{ leads: [record…], last: <last key>, truncated }` with `Cache-Control: no-store`. Keys sort by time, so `after`
     (the last key the browser imported) makes a re-import fetch only new messages;
   - optional `DELETE /api/leads/:key` (owner only) to delete a message after it is imported or when the retention
     period (12 months) is over.
3. **Client Atlas**: an "Import from website" button on the Leads tab that calls `/api/leads?after=…`, maps each record
   with a copy of `toAtlasLead` (as `AtlasLeads.fromWebsite`), keeps leads whose `id` (`w` + the message id) it already
   has, saves, and remembers the last key.

## What the build changes in the demo copies

- `<meta name="stratum-public" content="1">` before `/_shared/stratum-shell.js`: the shell then shows only the light/dark
  switch (no "← Business Apps" link) and `StratumShell.needs()` writes nothing; `stratum-sync.js` makes no `/api/auth`
  call, shows no account button and `mountPanel` shows nothing. Collections' team workspaces (`ws-sync.js`) read the same
  meta and stay off.
- `/assets/demo.js` (demo bar "Demo — sample data, stays in your browser" + "Talk to us" → `/#contact`, the language from
  `?lang=`; Collections opens in that language) and `/assets/demo.css` (hides the sync panel, the VIES check, Cash
  forecast's "Fill from Billing and Invoices", the workspace box).
- Google Fonts and the home-screen app tags removed; Clearfigure favicon; titles "… — Clearfigure demo"; Cash forecast's two
  always-visible sentences about the private cloud copy reworded.
