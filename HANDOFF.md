# Business Apps: handoff and local setup

Goal: Simon's business apps on Cloudflare for free, private to him, on his computer and as a home-screen app on his
phone, with demos good enough to show and sell to customers.

## Current state

- Repo `simonm200012/business_apps`. The live site is deployed from branch **`design-switch-recon`** (also the
  repo's default branch) with `npx wrangler deploy` (manual).
- Live at https://business-apps.simonm2000.workers.dev, behind Cloudflare Access: application for that hostname, policy
  `business-apps owner` (simonm2000@outlook.com, one-time PIN).
- `site/` is the web root: one folder per app, plain HTML/CSS/JS, no build step.
- `worker/` answers only `/api/*` (cloud sync, see below). Everything else is a static file.
- The home page lists 33 apps in six groups (Finance, Sales & marketing, Operations, People & IT, Insights, Studio).
  It has search (press `/`, also matches who/problem/pitch text) and "Recently opened". In the default Microsoft 365 look "All apps" is a list plus a sales sheet per app (`site/_shared/app-sheets.js`, linkable as `#app=<id>`, on phones the sheet replaces the list); the other looks still use the cards. `tools/tests/home-sheets.test.js` checks every app has a sheet.
- **Animated pitches** (`site/pitch/`, no video files): `/pitch/?app=<id>` plays a ~40 s pitch per app from its sales sheet, `/pitch/?all` is "Business Apps in 40 seconds". Scenes are pure data (`scenes.js`, tested in `tools/tests/pitch.test.js`), `pitch.js` draws and drives them with one clock (`&t=<s>` or `&scene=<n>` freezes a frame; reduced motion gives static slides). Buttons: "Play pitch" on every sheet and "Business Apps in 40 seconds" in the adjust box/band (`app-sheet-panel.js`). Checked in headless Chrome only (screenshots in `docs/design/pitch-shots/`), not on a real phone or in full screen.

## Cloud sync (new)

Every app that keeps your data now has the same data on the phone and the computer:
- Billing, Invoices, Desk, Client Atlas and Cash forecast;
- the demo apps ERP, CRM, Mail, Contracts, Parcels, Recon, Stores, Joiners & leavers, Marketing and Team Tasks;
- the new apps.

- **Server:** `worker/index.js` (Access check in `worker/access.js`). It stores snapshots and files in the private R2
  bucket `business-apps-sync-eu` (EU jurisdiction since 16 Oct 2026; the old `business-apps-sync` is a backup), under
  `u/<hash of the e-mail>/`.
  - It refuses anything without a valid Access token for `OWNER_EMAIL`. That also covers addresses Access does not
    front, such as version preview URLs.
  - Every change must carry the `X-Stratum-Apps` header the apps send.
  - **Version history:** before an upload replaces `u/<hash>/<app>.json`, the Worker copies the copy it replaces (bytes
    and its generation/time, never parsed) to `u/<hash>/<app>/versions/<generation>.json` and keeps the newest 30.
    `GET /api/sync/:app/versions` lists them (newest first), `GET /api/sync/:app/versions/:generation` returns one.
    History starts with the first upload after the deploy; existing data needs nothing.
  - **View-only people:** e-mails in the Worker secret `VIEWER_EMAILS` (comma-separated, may be empty; also allowed in
    the Access policy) read the owner's copies of the demo apps. They can never change anything (every non-GET is 403)
    and never read the private apps `billing`, `invoices`, `desk`, `cashflow`, `client-atlas` and `home` (the home
    page's pins and "Needs you today"; data, files, history: 403). Both checks are in `worker/access.js` and again in `worker/index.js`. A new private app must be added to
    `PRIVATE_APPS` in `worker/access.js`.
- **Client:** `site/_shared/stratum-sync.js`, unchanged for the apps. With `provider: 'access'` there is no password:
  - you are signed in whenever Cloudflare Access let you in;
  - "Sign out" goes through Access;
  - snapshots travel as raw JSON, so the Worker never parses them and stays within the free plan's CPU limit.
  - The panel (`mountPanel`) has "Restore an earlier version…": pick a version (date, size), then it replaces this
    browser's data and goes up as the new cloud copy (the replaced copy stays in the history).
  - Viewers see "View only" in the panel: their browser takes the owner's copy when nothing of its own would be
    replaced, never uploads and never shows a dialog about replacing the cloud copy.
- **How syncing behaves:**
  - Nothing is ever merged silently.
  - The first time an app opens on a second device, it asks whether to use the cloud copy, unless the device has
    nothing of its own yet (`isEmpty`). Then it just takes the cloud copy. An empty device never uploads.
  - When both devices changed, it asks which copy to keep.
  - Every local change counts up a change number; an upload only marks the data synced when nothing changed while it
    was on its way (otherwise it uploads again). Changes made while the server could not be reached at load, or while
    the sign-in had expired, are kept and uploaded once the account is known again (on reconnect or when the page is
    shown again).
  - An expired Cloudflare Access sign-in shows "Your sign-in has expired — Sign in again" (a reload through Access);
    nothing is marked synced meanwhile.
  - **Loss check** (`describeLoss(from, to)`, used by Billing): before the sync replaces data (a choice in a dialog, a
    newer cloud copy taken automatically, a restore), a choice that would drop an issued invoice is turned off, the
    invoices are listed, and "Download both copies" saves both as JSON. "Decide later" is always there.
  - `sync.ensureFresh()` syncs now and answers `fresh`, `offline` (with a message), `conflict` (the dialog is open) or
    `off`. Billing calls it before taking an invoice number.
  - Tests: `node tools/tests/sync.test.js` runs the real client against the real Worker (in-memory R2, real Access
    tokens signed with a test key).
- **Billing:** a cloud copy must pass the same integrity check as a restored backup. "Delete everything" now also
  clears the cloud copy, and says so. The cloud copy is not the 10-year archive: keep downloading backups and the
  yearly archive.
- **Data health check:** syncs only settings and check summaries, never uploaded files.
- **`GET /api/vies/:cc/:number`** (`worker/index.js`): a pass-through to the EU VIES VAT check for Data health check
  and CRM (the browser can't call VIES itself). Same Access check as sync; nothing is stored.

## Team workspaces (pilot: Collections, 15 Oct 2026)

Several people of one customer company work in the same Collections data, with roles. Not deployed yet.
- **Server:** `worker/workspaces.js`, routed from `worker/index.js` for `/api/ws` and `/api/ws/*`. Same Access token check
  (`verifiedEmail` in `worker/access.js`), but any signed-in e-mail may call it: the workspace's member list decides.
  Roles: `owner` (members, rename), `editor` (changes data), `viewer` (reads). Only `OWNER_EMAIL` creates workspaces.
  Non-members get the same 404 as for a workspace that does not exist; the last owner can't be removed or demoted.
- **Data in R2** (bucket `business-apps-sync-eu`, prefix `ws/`, no e-mails in keys): `ws/<id>/meta.json` (name, members),
  `ws/<id>/collections/log.json` (the newest ops; every write conditional on its etag → one strict order),
  `…/ops/<k>.json` (sealed chunks of 100 ops), `…/seed.json` (the starting data, kept), `…/snap.json` (newest compacted
  state, uploaded by an editor's device every ≥300 ops), `wsu/<sha256>.json` (which workspaces an e-mail is in).
- **Ops:** `{ seq, id, by, at, type, p }`; `seq`, `by` (the verified e-mail) and `at` are set by the server. Types and
  merge rules: `site/collections/ws-ops.js` (diff of the document → ops; later op wins per field; actions and
  payments are added, never overwritten; the same op id twice is stored once). Limits: 32 KB per op, 200 ops / 512 KB
  per request. Membership changes are `ws.*` ops in the same log (the Activity list).
- **Client:** `site/collections/ws-sync.js` (+ `ws.css`). "Personal copy" is unchanged. Choosing a workspace (side
  bar → Workspace) reloads the page with the team data from its own IndexedDB database (`stratum-collections-ws`);
  the personal cloud sync is then not attached. Queue in IndexedDB, push on save, pull on focus/show/online and every
  30 s. New page **Team** (`#/team`): members (owners manage), Activity, sync status. Viewers get a read-only screen.
  The timeline shows "Recorded by <e-mail>".
- **Access:** members must also be allowed by the Cloudflare Access policy of the site (an e-mail or domain rule).
  The Team page shows owners the steps (Zero Trust → Access → Applications → business-apps → Policies → edit the
  policy → Include → Emails → add the e-mail → Save) and a button to https://one.dash.cloudflare.com/.
- **Invitations (16 Oct 2026):** no mail service (none on the free plan without a domain), so the owner's browser makes
  the invitation: after "Add" and from "Send invitation" on each member row, a dialog with the text in SL/HR/EN (who
  invites, workspace, role and what it allows, the link `<origin>/collections/?ws=<id>`, sign-in with e-mail + one-time
  code), "E-mail invitation (.eml)" (outbox.js `buildEml`, `X-Unsent: 1`, no From, so Outlook opens a new message),
  "Open in my mail app" (mailto:) and "Copy invitation text". Each of them calls `POST /api/ws/:id/invite { email }`
  (owner): the Worker sets `invitedAt`/`invitedBy` on that member (a `ws.invite` activity entry, at most one per 10 min).
  `joinedAt` is set by the Worker on the member's first request to that workspace (`ws.join` entry). The members table
  shows "Joined <date>" / "Invited <date>" / "Not invited yet".
- **Links:** `?ws=<id>` in the Collections URL (taken out of the address bar at once) switches a member to that
  workspace (the seed dialog for an owner of one not set up yet); anyone else, and for an id that does not exist, gets
  the same "You don't have access to this workspace" dialog.
- **Deleting (16 Oct 2026):** Team page → Danger zone → "Delete workspace…" (owners), confirmed by typing the name.
  `DELETE /api/ws/:id { name }` (owner; editors, viewers and others get the plain 404). The Worker first marks
  `meta.deleting` (from then on members get **410** `{ deleted, deletedBy, deletedAt }` on every endpoint, others 404),
  cleans the members' `wsu/` lists, then copies every object to `ws-deleted/<id>-<yyyymmddThhmmssZ>/` and deletes the
  original, at most 40 R2 calls per request (202 `{ done: false }` → the browser repeats; a retry resumes), meta.json
  last, plus a tombstone `ws-deleted/<id>.json` (name, members, who/when) so members keep getting 410. A deletion that
  stopped half way (tab closed) is finished by the owner's device the next time it opens the workspace (410 with
  `unfinished`). The deleting device then clears that workspace's IndexedDB data and queue and goes back to Personal
  copy; other members' devices do the same on their next poll, first offering "Download my copy as JSON" if they had
  unsent changes. **Deleted workspaces are kept 30 days**, then removed by an R2 lifecycle rule — **not set up yet**;
  Simon runs once:
  `npx wrangler r2 bucket lifecycle add business-apps-sync-eu ws-deleted-30-days ws-deleted/ --expire-days 30 -J eu`
  (check with `npx wrangler r2 bucket lifecycle list business-apps-sync-eu -J eu`). No Restore button: within the 30
  days, copy `ws-deleted/<id>-<time>/…` back to `ws/<id>/…` (meta.json without `deleting`), re-add the id to each
  member's `wsu/` file and delete the tombstone.
- **Local test:** `wrangler dev` with `DEV_BYPASS=1`: on localhost the cookie `stratum_dev_as=<e-mail>` acts as that
  person in `/api/ws` (never on any other host). Tests: `node tools/tests/collections-workspaces.test.js` and
  `node tools/tests/collections-workspaces-admin.test.js` (invitations, joinedAt, links, deleting).

## Rename to Clearfigure (14 Oct 2026)

Everything that carried the suite's former name now says Clearfigure: the shared scripts (`stratum-shell.js`,
`stratum-sync.js`, `stratum-bus.js`), every app's saved-data names (`stratum-…`), the sync header and the cloud folder.
- `stratum-shell.js` starts with a one-time move: it renames what a browser saved under the former name (localStorage keys
  and IndexedDB databases, copied record for record) before any app opens its data. Remove that block after 2026-12-31.
- The cloud copies were copied to the new folder in the `business-apps-sync` bucket, with their version numbers. The old
  folder `u/f3b5937b…/` can be deleted once the apps show their data on both devices.

## App designs (15 Oct 2026)

Every app has the look of a leading product in its category, picked by Simon from three researched options each. Each
look is one layer file in the app's folder, loaded after the app's own styles, plus small markup changes (phone tab bars,
header bands, new overview cards). Light and dark both follow the shell's `data-stratum-mode`.

| App | Look (file) | App | Look (file) |
|---|---|---|---|
| Billing | FreshBooks (`freshbooks.css`) | ERP | Shopify (`shopify.css`) |
| Invoices | Ramp (`ramp.css`, `ramp.js`) | Service jobs | Jobber (`jobber.css`) |
| Cash forecast | Agicap (`agicap.css`) | Store board | Lightspeed (`lightspeed.css`) |
| Collections | Upflow (`upflow.css`) | Parcels | AfterShip (`aftership.css`) |
| Budget | Pigment (`pigment.css`) | Branch Manager | Fresha (`fresha.css`) |
| Recon | Ledge (`ledge.css`; `recon/new/` unchanged) | Desk | Superhuman (`superhuman.css`) |
| Contracts | Ironclad (`ironclad.css`) | Pisarna DMS | Dropbox (`dropbox.css`) |
| CRM | Pipedrive (`pipedrive.css`) | Time & leave | Timetastic (`timetastic.css`) |
| Clearfigure Mail | Klaviyo (`klaviyo.css`) | Team Tasks | Asana (`asana.css`) |
| Marketing | Notion Calendar (`notion.css`) | Joiners & leavers | Rippling (`rippling.css`) |
| Refill | Klaviyo (`klaviyo.css`) | Portal usage | Google Cloud (`googlecloud.css`) |
| Postbench | Canva (`canva.css`) | n8n Runs | Better Stack (`betterstack.css`) |
| Analytics | Shopify (`shopify.css`) | Margin guard | Competera (`competera.css`) |
| Data health | Great Expectations (`gx.css`) | Webshop | Google Analytics 4 (`ga4.css`) |
| Ads & Return | Meta Ads Manager (`meta.css`) | CS quality | Intercom (`intercom.css`) |
| Client Atlas | Sales Navigator (inline) | Design Comparison | Dribbble (inline) |

Clearfigure (`showcase/`) keeps its own design; a Classic / Linear switch in its nav turns on `linear.css`
(`?look=linear`, remembered in localStorage).

**Home page styles:** the Style menu in the top bar (also `?look=…` and "Style: …" in ⌘K) switches the whole home page
between Microsoft 365 (default), App Store, Raycast, Arc, Odoo and Classic (the earlier cursor.com page), remembered per
device. Each extra style is `site/home-looks/<name>.css` + `.js` (see the README there): the CSS is scoped to
`html[data-look]`, the JS adds the style's own structure on the `home-look` event and removes it when you switch away.

**Home page:** the Microsoft 365 look, with pinned favourites (`stratum-apps-pins`), a ⌘K command bar over apps and their
screens, and **Needs you today**. Apps report what waits for the user with
`StratumShell.needs(app, [{ text, count, href, tone }])` (in `_shared/stratum-shell.js`, saved in localStorage
`stratum-needs`); the home page shows each app's latest report for 7 days. Wired in Collections, Leave, Contracts, n8n,
Recon, Invoices, Billing, Parcels, Joiners & leavers, Budget, Desk, CS quality, ERP, Service (dispatch board) and Store
board (all-stores view). `_headers` makes browsers re-check `/_shared/*` on every load, because those files have no
version in their address.

## Per-app improvements (15 Oct 2026)

Everything runs in the browser. Where a real service would be needed (sending e-mail, a bank API) the apps make a
file instead: a ready `.eml` with the PDF attached (opens as a new message in Outlook), a bank file to upload
(pain.001), or an import of the bank's statement (camt.053 / CSV).

- **Collections:** bank statement import with matching (`bank.js`, `#/bank`); Minimax and Pantheon open-invoice
  import; letters as PDF + `.eml` (`outbox.js`, own PDF writer); SL/HR screens (`i18n.js`); Croatia e-reporting CSV;
  a customer payment page. `engine.js` is `?v=3` (Cash forecast loads the same).
- **Billing:** quotes and proformas (own `PR-` series), e-SLOG 2.0 XML (`eslog.js`), payments from a bank statement
  (`bank.js`), reminders as `.eml`, English invoices, `#new` opens a new invoice. The loss check covers quotes.
- **Invoices:** e-invoice reading (`einvoice.js`), pay run → pain.001 and bank statement → paid (`bankfiles.js`,
  `payflow.js`), optional approval step (Settings, off by default, on in the demo), demo at `/invoices/?demo=1`.
- **Cash forecast:** Minimax/Pantheon and camt.053 import (`importers.js`), month view `#/months`, fill from Billing
  and Invoices.
- **Budget:** chart of accounts and GL/trial balance import incl. `.xlsx` (`xlsx.js`), headcount `#/people`.
- **Data health check:** official SI/HR postal codes (`postal-data.js`, refresh yearly), live VIES check, e-invoice
  readiness score, Fix all with undo.
- **Recon, Contracts, CRM:** month lock and sign-off, journal export; notice letters and `.ics`; SL/HR quotes, VIES.
- **Marketing, Ops, People, Insights, Studio:** see the tests in `tools/tests/` for each new module. Branch Manager
  has a self-booking page (`branch-manager/Book.html`). CS quality's agent scorecard is off by default (staff
  monitoring needs a legal basis).

To check before selling (each is marked in the code): Minimax/Pantheon column names against real exports, the Croatian
e-reporting format, e-SLOG with your e-invoice provider, UPN QR with a banking app, `.eml` in the Outlook you use.

## Phone app

Business Apps installs as one app on the phone: open the site in Safari, sign in, then Share → Add to Home Screen
(Android/Chrome: menu → Install app). It opens full screen on the home page, and every app opens inside it.

On the Mac it installs the same way as a Dock app: the home page's **Install** button opens Chrome's or Edge's install
dialog, and in Safari it shows File → Add to Dock (macOS Sonoma or newer). The installed app keeps its own sign-in, so
Cloudflare Access asks once inside it. The button is hidden inside the installed app.

- `site/manifest.webmanifest` and `site/icons/`. The icons are a "Fluent suite" drawn in code, each modelled on the
  top App Store apps of its kind (layered flat planes in one colour ramp on a white tile; only the launcher sits on a
  near-black tile, and violet is kept for it): `tools/icons/kit.mjs` (construction rules,
  ramps, rendering, core marks) and `tools/icons/specs.mjs` (one spec per app, the other marks); `tools/icons/build.mjs`
  checks new marks on a contact sheet. `SHARP_FROM=<a package.json with sharp> node tools/make-icons.mjs`
  writes the launcher icons and `site/icons/apps/<id>.png`, which the home page and the showcase show. After changing the
  launcher icon, remove Business Apps from the iPhone home screen and add it again: iOS keeps the old one.
- Every page carries the home-screen tags and the favicon between `<!-- phone app -->` markers. Run
  `node tools/make-pwa.mjs` again after adding a page or an app.
- `site/_shared/phone.css` holds phone-only fixes for apps without their own phone layout.
- In the home-screen app, links to this site that would open a new tab open in place, so you never fall out into
  Safari's separate sign-in. This is in `stratum-shell.js`.

## Apps added for selling

All five use the Cash forecast company (Nordvik Distribucija d.o.o.) or one of its customers, so the demos tell one
story. Each has `engine.js` with Node tests in `tools/tests/`.

| App | Folder | What it does | Check before selling |
|---|---|---|---|
| Collections | `collections/` | Who owes what, who to call today, reminder letters (SL/HR/EN) with statutory default interest, the €40 fee and a UPN/EPC QR, promises and payment plans, reports, CSV import | Interest rate table (ECB + 8 pp; 2026 H2 = 10,40 %, checked; update each half-year), payments go to costs → interest → principal (OZ Art. 288 / ZOO Art. 172, setting for principal-first contracts), legal wording of the letters incl. the new payment-order sentence |
| Budget vs actual | `budget/` | Budget and forecast by month, P&L with drill-down, variances that need an explanation, EBITDA bridge, budget editor with spreading tools, actuals import, two-page board pack (EN/SL/HR) | Demo chart of accounts (map your own), the closing rule (10 days after month end), SL/HR board-pack terms |
| Time & leave | `leave/` | Leave requests and approvals with team-minimum warnings, team calendar with SI/HR holidays, entitlement calculator, clock in/out, monthly working-time record (SL/HR/EN), payroll CSV, iCal | Entitlement rules and overtime limits (ZDR-1 / ZOR defaults), special-leave reasons, record wording |
| Data health check | `datacheck/` | Upload a customer, supplier or product list (CSV/Excel): VAT (SI/HR check digits), IBAN, OIB, EAN, e-mail, phone, postal code checks, duplicates, one-click fixes, cleaned file, merge map, report (EN/SL/HR) | Score bands and duplicate weights; uploaded files are never synced |
| Service jobs | `service/` | Technician's day on the phone (checklist, photos, parts, signature), dispatch board, maintenance due, service report (SL/HR/EN), invoicing CSV, reports | Rates and response times, VAT (no construction reverse charge), checklist ranges |

Every legal rate and rule is an editable default in the app's Settings, marked as something to check; none of the apps is legal advice.

## Convert (`convert/`, 17 Oct 2026)

A file converter that runs completely in the browser: nothing is uploaded, no Worker, no AI, no outside service. It
started as a copy of the tested converter from the private My Apps hub, restyled in the Business Apps look, with four
new tools.

- **Tools (16):** Word to PDF, PDF to Word, Images to PDF, PDF to images, Merge PDF, Split PDF, CSV to PDF, Excel to PDF,
  Text/Markdown to PDF, PDF to text, CSV to Excel, Excel to CSV, and the "Data & XML" group: PDF to Excel (tables),
  Excel or CSV to XML, XML to Excel, PDF to XML.
- **Files:** `app.mjs` (page), `ui.mjs` (toast, password dialog, escaping), `lib.mjs` (pure helpers: tools list, CSV,
  names, XML names and writing, XML records, PDF table guessing), `tools.mjs` (the conversions), `convert.css`,
  `vendor/` (libraries, each folder named with its exact version and holding its licence). Shell, theme and back
  button come from `/_shared/stratum-shell.js`; phone-app tags from `tools/make-pwa.mjs`; icon `tools/icons/specs.mjs`
  (`convert`, mark `pageSwap`; only `site/icons/apps/convert.png` was generated, not the whole set).
- **Libraries (vendored, loaded only when a tool needs them):** pdf.js 6.3.289, pdf-lib 1.17.1, pdfmake 0.3.11,
  mammoth 1.13.0, html-to-pdfmake 2.5.34, docx 9.8.1, marked 18.0.14, SheetJS 0.20.3, JSZip 3.10.1. All MIT or
  Apache-2.0. No CDN; pdfmake is told to refuse every URL. Only Noto Sans comes from Google Fonts, like the home page.
- **Privacy:** files are read in the page and never leave the device. The page says "On this device".
- **Limits:** no OCR (scans have no text); Word to PDF is not Word's exact layout; PDF to Word is text only.
  PDF to Excel guesses rows (text on the same baseline) and columns (gutters between filled bands) and works on
  computer-made tables, not on scans, merged cells or tables without clear columns. XML to Excel picks the repeated
  element highest in the tree as the record, names nested values `parent/child` and attributes `@name`, joins repeated
  values with "; " and warns when it flattened something. Excel/CSV to XML writes `<rows><row><Header>..` with safe
  names, one file per sheet.
- **Tests:** `tools/tests/convert.test.js` (ported from the hub, 21 checks) and `tools/tests/convert-data.test.js`
  (11 checks: XML names, rows to XML and back, nested XML, PDF to XML, table guessing on a pdf-lib PDF read with
  pdf.js). The XML tests in Node use a small stand-in parser because Node has no DOMParser; the four new tools were
  also run once in headless Chrome on generated files (real DOMParser). Screenshots: `docs/design/convert-shots/`.

## Run locally

Static only (sync stays off):

```
cd site
python3 -m http.server 8080
```

With the sync server:

```
printf 'DEV_BYPASS=1\n' > .dev.vars
npx wrangler dev
```

`.dev.vars` skips the Access check locally. It is git-ignored and never deployed.

## Tests

```
for f in tools/tests/*.test.js; do node "$f" || break; done
```

## Deploy

1. Commit on `design-switch-recon` and push.
2. Run `npx wrangler deploy` from the repo root. Once only: `npx wrangler r2 bucket create business-apps-sync-eu --jurisdiction eu`
   (already done).
3. Check that https://business-apps.simonm2000.workers.dev still asks you to sign in, then open an app and look for
   "Cloud sync · … synced" on its settings screen or in the account button.

## Notes

- Do not put passwords or API keys in this repo. `.dev.vars` is for local testing only.
- How each app is built: `docs/APPS-CODE-GUIDE.md`. The note at the top covers hosting and sync.
- Apps written against an `/api/<app>/` endpoint get made-up answers in the browser (`_shared/demo-api.js` and the
  app's own `demo-api.js`). The home page tags them Demo data, and the Business Apps bar shows a small DEMO chip.


## Client portal (branch feat/client-portal, 17 Oct 2026, built, not deployed)

Separate portal Worker (`worker/portal.js`, `wrangler.portal.jsonc`, `portal-site/`), staff publish API (`worker/portal-staff.js`,
`/api/portal/*`), projection builder `site/billing/portal-projection.js`, schema `worker/portal-schema.js`, tests `tools/tests/portal-*.test.js`,
sample page `site/client-portal/` and a home-page card with sales sheet. Steps Simon must do in Cloudflare and unverified assumptions:
`docs/CLIENT-PORTAL.md`. Also fixed: the staff Worker refuses every request when `DEV_BYPASS` is set on a non-localhost host.
Not built: Billing's own "Portal access / Publish to portal" screen (use `tools/portal-publish.mjs` and the endpoints for now).
