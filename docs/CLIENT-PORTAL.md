# Client portal

A separate Worker (`business-apps-portal`, `worker/portal.js`, pages in `portal-site/`, config `wrangler.portal.jsonc`) where a
company's clients sign in with a one-time code and see only their own invoices, quotes, shared documents and news, and can
accept or decline a quote. Look: `docs/design/client-portal/portal-A.html`; built screenshots: `built-*.png` in the same folder.
Branding (name, `#rrggbb` accent, PNG/JPEG/WebP logo) is per company, published by staff, so another company renders differently.

## How it is kept safe (short)

- Own origin, own Access app and audience, **no SYNC binding**: a bug in the portal cannot reach Billing or any staff data.
- Who is calling comes only from the verified token e-mail, then the mapping `pu/<sha256 of e-mail>` to one client. No client id in
  a URL, query, body or header is ever read. Not-yours and not-existing both answer the same 404.
- Staff publish a whitelisted projection (`site/billing/portal-projection.js`, re-checked key by key in `worker/portal-schema.js`).
  Payments, work log, contracts, settings, drafts, other clients never leave Billing.
- A quote answer is a recorded request (origin, `X-Portal` header, JSON only, state, expiry in Ljubljana time, hash of what the
  client saw, replay and opposite-answer checks). Staff confirm it in Billing.
- Strict CSP (no inline script or style), text-only rendering, download-only sandboxed files, audit log, rate limits.

## What Simon does in Cloudflare (one time; the code cannot do these)

Run everything from the repo root on your Mac. Nothing here is automated and nothing is deployed by the code.

1. Create the bucket: `npx wrangler r2 bucket create business-apps-portal-eu --jurisdiction eu`
2. Deploy the portal once: `npx wrangler deploy -c wrangler.portal.jsonc`. With `PORTAL_ACCESS_AUD` empty it answers 503 to every
   `/api/*` request (fails closed). Also redeploy the staff Worker (`npx wrangler deploy`): it now has the `PORTAL` binding
   (bucket from step 1) and the `/api/portal/*` routes.
3. Cloudflare dashboard, Workers & Pages, `business-apps-portal`, Settings, Domains & Routes, the `workers.dev` row:
   **Enable Cloudflare Access**, then **Manage**. Application name "business-apps portal". Login method: **One-time PIN only**.
   Policy "portal clients": Allow, Include, Emails: the client people (this list and the Billing mapping must both contain a
   person; two places to edit). Session duration 24 hours. Cookie settings: HttpOnly on, SameSite Lax (or Strict), binding
   cookie on.
4. Copy that Access application's **Audience (AUD) tag**. Put it in `PORTAL_ACCESS_AUD` in **both** `wrangler.portal.jsonc` and
   `wrangler.jsonc` (it is not a secret), then redeploy both Workers. The staff Worker uses it to refuse any token that also lists
   the portal audience.
5. Never add client e-mails to the staff policy `business-apps owner`, and never use domain or "Everyone" rules on the staff app.
6. Check the portal address: `PORTAL_ORIGIN` in `wrangler.portal.jsonc` must be the exact `https://...workers.dev` address of the
   portal Worker (quote answers are refused from any other origin).
7. Rate limits: the three `ratelimits` bindings in `wrangler.portal.jsonc` (`RL_READ` 120/min, `RL_DOWNLOAD` 30/min, `RL_DECIDE`
   5/min, per person) are created by the deploy. If the deploy refuses them, see "Unverified" below.
8. Optional: an R2 lifecycle rule on prefix `p/` objects under `audit/` (for example delete after 400 days), and an Access login
   page logo (team-wide, one look for staff and clients).
9. Secrets: **none** are needed. `VIEWER_EMAILS` stays a staff secret and is never read by the portal. Do not put any e-mail or key in
   the repository (it is public).
10. First smoke test with a real second address: an e-mail that is not listed gets no code; a listed but unmapped e-mail gets
    "No access"; client A cannot open client B's file id (404).

## Publishing (until Billing has its own "Publish to portal" screen)

The staff endpoints are `/api/portal/*` (owner only, see the header of `worker/portal-staff.js`). The order is: enable the client
(`PUT /clients/:c`, `c` = 32 random hex chosen by Billing), upload files, set brand/news, map e-mails (`PUT /users`), publish the
view last (`PUT /clients/:c/view`). `tools/portal-publish.mjs` does the publish step from a Billing state export and seeds the demo;
it only talks to a local Worker. Billing's own screen (enable per client, add e-mails, preview, import answers via
`GET /api/portal/responses`, confirm with the existing quote decision) is the one piece of the design not built yet.

## Run it locally

```
printf 'DEV_BYPASS=1\n' > .dev.vars                       # git-ignored; localhost only, other hosts get 500
npx wrangler dev --port 8787 --persist-to .wrangler/shared                           # staff Worker
npx wrangler dev -c wrangler.portal.jsonc --port 8788 --persist-to .wrangler/shared  # portal (start it after the first is ready)
node tools/portal-publish.mjs seed --base http://localhost:8787                      # fictional company, two clients
```

Then open http://localhost:8788 with a cookie `portal_dev_as` set to `client-a@example.test` (or `client-b@example.test`). Without
Cloudflare at all: `node tools/portal-dev-server.mjs` (real Workers over an in-memory bucket, two fictional companies, visit
`/__as/client-a@example.test`, `/__as/client-b@example.test`, `/__as/client-x@example.test`). The sample page in the Business Apps
site (`site/client-portal/`) is built by `node tools/build-portal-demo.mjs`.

## Unverified assumptions (could not be checked without a Cloudflare account)

- **Create-only R2 writes** (`onlyIf: { etagDoesNotMatch: '*' }`) behave as in the local emulator (checked there: a repeated
  quote answer is a replay, one object). On real R2 a failed condition should return `null` from `put`. The code also handles the
  lost race (reads the winner), so the worst case is one extra read, but verify with two quick answers in production.
- **Rate limit binding**: the `ratelimits` config block and `limit({ key })` are used as documented; the emulator accepted the
  config. Limits are per Cloudflare location and approximate. A missing binding refuses quote answers (fail closed) but not reads.
- **Access on workers.dev**: that "Enable Cloudflare Access" can protect the whole `workers.dev` hostname of the second Worker
  with its own application and AUD, and that tokens carry `email` for one-time-PIN logins. Preview URLs are switched off
  (`preview_urls: false`) because Access may not front them.
- **Static pages are served without the Worker** (`run_worker_first` covers only `/api/*`): Access protects the hostname, and the
  pages contain no data, but if Access were off the empty shell would be public (the API would still answer 401).
- **Logo as image only**: no SVG and no logo URL (the CSP allows images from the portal's own origin only).
