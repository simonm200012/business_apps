# Adrial Apps: how the apps are built (demo-data edition)

This guide explains the code of the browser apps in Adrial Apps (`C:\hub\public\`) as they run **without any data connection**, using their built-in demo data or the user's own local data. It is written for a developer who has never seen the code.

It deliberately leaves out:
- BigQuery and the scheduled queries in `C:\hub\sql\`;
- the server modules in `C:\hub\*.js` (`server.js`, `sync.js`, `ads.js`, `recon.js`, `parcels.js`, `stores.js`, `marketing.js`, …);
- the `/api/…` endpoints and the "live mode" of the apps that have one.

Where an app has a live mode, its section says in one paragraph where that code sits and how the app stays in demo mode.

## Contents

| App | Folder | Data without a connection | Section |
|---|---|---|---|
| Shared pieces (shell, bus, sync, home page) | `_shared/`, `index.html` | n/a | Part 1 |
| ERP | `erp/` | generated demo data | Part 1 |
| CRM | `crm/` | generated demo data | Part 1 |
| Analytics | `analytics/` | generated demo data | Part 1 |
| Adrial Mail | `mail/` | generated demo data | Part 2 |
| Invoices | `invoices/` | the user's own PDFs and photos (stored in the browser) | Part 2 |
| Desk | `desk/` | the user's own e-mails and confirmations (stored in the browser), plus example tasks | Part 2 |
| Design Comparison | `design-compare/` | static content | Part 2 |
| Branch Manager: bookings | `branch-manager/Bookings.html` | sample data | Part 2 |
| Parcels & COD | `parcels/` | generated demo data | Part 3 |
| Payment reconciliation | `recon/` | generated demo data | Part 3 |
| Store daily board | `stores/` | generated demo data | Part 3 |
| Joiners & leavers | `onboarding/` | generated demo data | Part 4 |
| Contracts & renewals | `contracts/` | generated demo data | Part 4 |
| Marketing calendar | `marketing/` | generated demo data | Part 4 |

**Not covered:**
- **Live-only apps (no demo mode):** Hub usage & speed, Margin guard, Refill & win-back, Webshop conversion health, Customer service quality, n8n Runs, Ads & Return. Without a data connection they only show their sign-in page.
- **Apps that came from elsewhere:** Stratum (`showcase/`), Team Tasks (`team-tasks/`), Pisarna DMS, Client Atlas, Postbench, and the older Branch Manager prototype pages (`*.dc.html`). These were built outside this work and only got small changes here.

## Running the apps with demo data only

The apps are plain HTML, CSS and JavaScript: no build step, no framework, no bundler. Every app is a folder with an `index.html` that loads its own scripts.

**Option A: any static file server.** Serve the `public` folder as the web root, so absolute paths like `/_shared/adrial-shell.js` resolve:

```bash
cd C:\hub\public
python -m http.server 8080
```

Then open `http://localhost:8080/erp/` (or any other folder). The account and cloud-sync parts notice there is no server and stay hidden or show "sync not set up"; the apps work fully. Apps with a live mode see no `/api/<app>/session` answer and stay in demo mode.

**Option B: the real server, without any credentials:**

```bash
cd C:\hub
npm install
node server.js
```

`server.js` serves `public/` with the same headers as production. No Google credentials are needed for the demo apps: the BigQuery client is only used when a live `/api/…` endpoint is called. Add `$env:DEV_LOGIN='1'` (PowerShell) to get a password-less "Test" sign-in for trying the optional cloud copy against a local folder.

Opening the HTML files directly from disk (`file://`) is not supported: the absolute `/_shared/…` paths and IndexedDB behave differently there.

## Patterns every app follows

- **One folder, three or four files:** `index.html` (markup and the shell scripts), `data.js` (the demo data generator) where there is demo data, `app.js` (state, rendering and events) and `style.css`. The larger apps split app.js into a few modules (Invoices, Desk, Contracts).
- **The shared shell:** every page loads `/_shared/adrial-shell.js`. It adds the floating bar (back to Adrial Apps, account button, Light/Dark/Auto) and sets `html[data-adrial-mode]`, which each app's dark-mode CSS keys off.
- **Deterministic demo data:** generators use a small seeded pseudo-random function, so every browser sees the same demo company. Dates are usually made relative to today (or to a stored "anchor" date), so the data never looks stale.
- **Storage:**
  - Each app keeps its state in its own IndexedDB database (`adrial-erp`, `adrial-parcels`, …). The demo apps mostly store only what the person changed (decisions, notes, edits); the generated data is rebuilt from the seed.
  - localStorage holds only small UI preferences (filters, chosen tab), because it is shared by all apps on the same site and is small.
  - A BroadcastChannel keeps several open tabs of the same app in step.
  - "Reset demo data" clears the app's own database after a confirmation.
- **Rendering:** plain template strings into `innerHTML`, with an `esc()` helper for every value, hash-based routing (`#/route`), and charts drawn as inline SVG or canvas without chart libraries.
- **Accessibility and layout:**
  - Every app works at phone width (16 px gutters, no sideways scroll), is usable with the keyboard, and has a "show as table" view or CSV export for its charts and tables.
  - Colours are CSS custom properties (tokens) defined once for light and once for dark.
- **Cross-app demo links** (ERP ↔ CRM ↔ Analytics ↔ Mail) go through `/_shared/adrial-bus.js`: an app publishes a snapshot (for example ERP's catalogue) that another app reads, so the demos feel connected without a server.

---

# Part 1: Shared pieces, ERP, CRM, Analytics

## Shared front-end pieces (`/_shared/` and `/index.html`)

**What it does**: Three small scripts in `public/_shared/` give every demo app the same corner bar (back button, theme switch, optional account button), a browser-local message bus between apps, and an optional cloud copy. `public/index.html` is the Adrial Apps home page that links to every app.

**Files**

| File | Lines | Role |
|---|---|---|
| `_shared/adrial-shell.js` | 122 | Back button, Light/Dark/Auto theme, account-button slot (`window.AdrialShell`) |
| `_shared/adrial-bus.js` | 132 | Cross-app snapshots and messages in IndexedDB (`window.AdrialBus`) |
| `_shared/adrial-sync.js` | 371 | Optional cloud copy of an app's data (`window.AdrialSync`) |
| `index.html` | 384 | Home page: tiles, data-source chips, filters, private-tile hiding |

### adrial-shell.js

Include it in `<head>`, not deferred, so the theme is applied before first paint:

```html
<script src="/_shared/adrial-shell.js" data-pos="br"></script>
```

Options are `data-*` attributes on the script tag: `pos` (`bl` default, `br`, `tl`, `tr`), `x` / `y` (offset in px, default 14), `home="1"` (no back button; used by `index.html`), `reload="1"` (reload the page on theme change, for apps that read the theme only at start-up).

How it works:

- The choice lives in localStorage `adrial-theme` (`light` or `dark`; absent means Auto/system). It is shared by all apps on the origin.
- `apply()` sets `<html data-theme="light|dark">` only for an explicit choice, and always sets `<html data-adrial-mode="light|dark">` (the resolved mode). The app stylesheets key their dark tokens off `html[data-adrial-mode="dark"]`.
- After each apply it dispatches `window` event `adrial-theme` with `detail: { theme, mode }`. Apps that draw SVG charts listen to it and redraw.
- The bar is a custom element `<adrial-shell>` with a shadow root, fixed position, so app CSS cannot leak in. The button cycles Auto → Light → Dark → Auto.
- It reacts to `prefers-color-scheme` changes (when on Auto) and to `storage` events, so other tabs follow.

Public API:

```js
AdrialShell.get();        // 'system' | 'light' | 'dark'
AdrialShell.set('dark');  // store + apply (or reload if data-reload="1")
AdrialShell.mode();       // resolved 'light' | 'dark'
AdrialShell.refresh();    // re-apply
AdrialShell.setAccount({ initials: 'SM', label: '', title: 'Synced', state: 'ok', onClick: fn }); // or null to hide
```

`state` is `ok | busy | warn | off` and colours the status dot. Only `adrial-sync.js` calls `setAccount`; without it the account button stays hidden.

### adrial-bus.js

Lets ERP, CRM and Analytics talk in the same browser. Storage is IndexedDB database `adrial-bus` (version 1) with two stores: `shared` (keyPath `key`) and `messages` (keyPath `id`, index `to_status` on `[to, status]`). A `BroadcastChannel('adrial-bus')` tells other open tabs about changes. There is no network. The sender app name is taken from the first path segment (`/erp/` gives `erp`).

Snapshots (one current value per key, overwritten by the owning app):

```js
await AdrialBus.publish('erp.catalog', data);   // → true/false, notifies all tabs
const rec = await AdrialBus.read('erp.summary'); // → { key, from, updatedAt, data } | null
```

Keys in use: `erp.catalog` and `erp.customers` (ERP → CRM), `erp.summary` (ERP → Analytics), `crm.summary` (CRM → Analytics).

Messages (a queue; the receiver settles each one):

```js
const id = await AdrialBus.send('erp', 'crm.order', payload);
const msgs = await AdrialBus.inbox('erp');      // status 'new', oldest first
await AdrialBus.done(id, { orderNo, orderId });  // or AdrialBus.fail(id, 'reason')
const all = await AdrialBus.history(m => m.type === 'crm.order');
const off = AdrialBus.on(evt => { /* {kind:'message'|'snapshot', to?, type?, key?} from any tab */ });
await AdrialBus.reset('crm');                    // drop crm.* snapshots and crm's messages
```

Message types: `crm.order` (CRM → ERP, creates a draft sales order) and `erp.orderStatus` (ERP → CRM, status of that order). `reset(prefix)` notifies a snapshot key `<prefix>.reset`, which readers treat as "reload". Every call resolves even when IndexedDB is unavailable (reads give `null`/`[]`); `AdrialBus.available` is then `false` and apps keep working alone.

### adrial-sync.js (optional)

An optional add-on that keeps a private cloud copy of one app's data for a signed-in user. ERP and CRM load it; Analytics does not. The apps are fully usable without it: their data lives in IndexedDB, and if the sync server is not configured the controller stays in state `off` and the shell's account button stays hidden.

```js
const sync = AdrialSync.attach({ app: 'erp', label: 'ERP data',
  getSnapshot: () => Promise.resolve(db), applySnapshot: applyCloud });
sync.changed();          // after each local save (uploads ~2.5 s later)
sync.mountPanel(el);     // status card with Sign in / Sync now / Sign out
```

It keeps its own bookkeeping in localStorage `adrial-sync:<app>:<email>`. It never merges: on a conflict the user picks "keep this browser" or "use the cloud copy".

### index.html (home page)

- Loads only the shell (`data-home="1" data-pos="br"`); no bus, no sync. Colour tokens are on `:root` with a dark set under `prefers-color-scheme` (guarded by `:not([data-theme="light"])`) and again under `:root[data-theme="dark"]`.
- 27 tiles, each an `<article class="card">` with an icon, title, tags, description and an `Open` link (some also have a `.screens` nav of deep links).
- Data-source chip: `<span class="data mono demo|live|both|yours">`; the tile carries the same value in `data-source` (10 `demo`, 7 `live`, 4 `both`, 3 `yours`, 3 without).
- Filters: buttons with `data-f` = `""` (All), `live`, `demo`, `yours`. `apply(f)` sets `aria-pressed` and adds `data-filtered` to non-matching cards (CSS hides them). A `both` tile shows under Live and under Demo; a tile without `data-source` shows only under All. The choice is kept in localStorage `adrial-apps-filter`.
- Private tiles: a tile with `data-private="<key>"` is rendered with `hidden` (currently one: `showcase`). A short script asks the server which private keys the session may see and removes `hidden` from matching tiles. If that request fails (for example a static file server), the tile simply stays hidden.

To add a tile, copy an `<article class="card" data-source="demo">` block and set the icon SVG, title, chip, text and `href`.

---

## ERP (`/erp/`)

**What it does**: A demo ERP for a fictional optical retailer: products and stock per location, purchasing, transfers, stock counts, a point of sale, quotes, sales orders, invoices, payments and credit notes. All data is generated in the browser and saved in IndexedDB; every stock change is recorded as a movement.

**Files**

| File | Lines | Role |
|---|---|---|
| `index.html` | 42 | Shell (sidebar, `#nav`, `#main`, `#layers`, `#toast`, reset button) and script order |
| `data.js` | 543 | `window.ERPData`: constants and the deterministic generator |
| `app.js` | 3358 | Whole app: storage, indexes, mutations, router, pages, bus, sync |
| `style.css` | 294 | Design tokens (light + dark) and components |

**How it starts**

1. `<head>` loads `adrial-shell.js` (`data-pos="br"`) and `style.css?v=9`. `#main` shows "Loading ERP data…".
2. End of body: `adrial-bus.js`, `adrial-sync.js`, `data.js?v=9`, `app.js?v=9`.
3. `app.js` (one IIFE) sets `TODAY = U.ymd(new Date())`, opens the BroadcastChannel, reads UI prefs, wires the menu and reset button, and registers `hashchange → onRoute`.
4. `boot()`: `idbGet()`; if the record passes `validDb()` (version must equal `ERPData.VERSION`), use it. Otherwise migrate a legacy localStorage copy, otherwise call `ERPData.generate(TODAY)` and `idbPut()` it. If IndexedDB fails, it keeps data in memory and shows a toast.
5. Then: `ensureSchema()`, `reindex()`, `crmStatusSync()` (save if anything changed), `onRoute()` (first render), `busStart()`, `syncStart()`, and a "Demo data generated" toast on first run.

**Demo data**

- Generator: `ERPData.generate(today)` in `data.js`. Random source `rng(0xAD71A1)` (a mulberry32-style PRNG). For the same `today` string the output is identical; a different first-load date shifts weekdays and seasons, so the content differs.
- Fixed constants: 11 `LOCATIONS` (`WH`, `ESHOP`, stores `SI-KOM`, `SI-KP`, `SI-MB`, `SI-NM`, `HR-ZG`, `HR-ST`, `HR-RI`, `HR-ZD`, `HR-OS`), `VAT` `{SI:22, HR:25}`, 6 `CATEGORIES`.
- Master data: 13 suppliers, 120 products (40 frames, 25 sunglasses, 20 contact lenses, 10 solutions, 12 optical lenses, 13 accessories), 64 customers (22 B2B, 2 walk-in, 40 named B2C). All e-mails are `@example.com`.
- Simulation: one loop per day from `today − 365`: PO receipts, Monday POs below reorder point, replenishment transfers every 14 days, random adjustments, and store, e-shop and B2B sales that become orders, shipments, invoices and payments.
- Final touches: a partial receipt, a draft PO, 3 transfers in transit, up to 4 credit notes, 6 quotes.
- Numbering (`docNo`): `SO-YYYY-00001`, `PO-YYYY-0001`, `YYYY-000001` (invoice), `TR-YYYY-00001`, `CN-`, `QT-`, `CNT-YYYY-0001`.
- `app.js` adds on first load: `seedPrices()` (its own `seeded(4242)` PRNG) builds `supplierPrices`, adding a 14th supplier "Pacific Lens Supply Inc." with USD prices (`USD_EUR = 0.92`); `deriveMinMax()` sets min/max per product and location from the last 90 days of sales.
- Dates are anchored to the first-load day (`generatedFor`). They are not regenerated later, so the data ages: invoices become overdue as real days pass.

**State and storage**

- IndexedDB `adrial-erp` (version 1), store `kv`, one record under key `db` holding the whole document: `version, generatedFor, nextId, seq, suppliers, products, customers, stock, sos, pos, invoices, movements, creditNotes, damaged, quotes, counts, transfers`, plus `minmax`, `transfersMigrated`, `supplierPrices`, `priceHistory`.
- `stock` is `{ [productId]: { [locationId]: qty } }`; reserved stock is computed from confirmed sales orders (`resMap()`), not stored.
- localStorage `adrial-erp-ui`: list filters, sort and page per list (keys `p, m, po, so, c, s, inv, q, cn, pos, rp, cnt, tr`). Legacy localStorage `adrial-erp-db` is read once, moved to IndexedDB and deleted.
- BroadcastChannel `adrial-erp`, message `{type:'changed'}`. Other tabs re-read IndexedDB and re-render, unless they have a save pending.
- Saves: `commit(msg)` runs `reindex()`, `crmStatusSync()`, `save()`, `schedulePublish()` and re-renders. `save()` debounces 250 ms; `flush()` queues `idbPut(db)` on one promise chain (`writeQ`) so writes never interleave, then announces and calls `syncChanged()`. Pending saves flush on `pagehide` and when the tab is hidden.
- "Reset demo data" (`#resetBtn`): confirm, regenerate with `ERPData.generate(TODAY)`, `ensureSchema()`, `idbReset()` (clear + put), reset page counters and the POS cart, republish bus snapshots, go to `#/`.

**Screens and routing**

Hash routes are parsed in `onRoute()` into `{ base, id, sub }`. Unknown bases redirect to `#/`.

| Route | Render function | Shows |
|---|---|---|
| `#/` | `pageOverview` | Revenue vs cost chart, low stock, recent documents, ageing, stock by location |
| `#/products`, `/:id` | `pageProducts`, `openProductDrawer` | Product list; drawer with stock, min/max, prices |
| `#/replenishment` | `pageReplenishment` | Min/max plan and suggested transfers |
| `#/transfers`, `/:id` | `pageTransfers`, `pageTransfer` | Transfers with in-transit stage |
| `#/counts`, `/:id` | `pageCounts`, `pageCount` | Stock counts |
| `#/movements` | `pageMovements` | Movement audit log |
| `#/purchasing`, `/suggest`, `/:id` | `pagePurchasing`, `pageSuggest`, `pagePO` | POs, reorder suggestions, PO detail |
| `#/suppliers`, `/:id` | `pageSuppliers`, `openSupplierDrawer` | Suppliers and price lists |
| `#/pos`, `/receipt/:id` | `pagePos`, `pageReceipt` | Store till and receipt |
| `#/quotes`, `/:id` | `pageQuotes`, `pageQuote` | B2B quotes |
| `#/sales`, `/:id` | `pageSales`, `pageSO` | Sales orders |
| `#/customers`, `/:id` | `pageCustomers`, `openCustomerDrawer` | Customers |
| `#/invoices`, `/:id`, `/cn`, `/cn/:id` | `pageInvoices`, `pageInvoice`, `pageCreditNotes`, `pageCreditNote` | Invoices, payments, credit notes |

**Key functions**

| Function / object | Purpose |
|---|---|
| `ERPData.generate(today)` | Builds the full dataset |
| `boot()` | Load from IndexedDB, legacy copy, or generate |
| `ensureSchema()` | Adds missing collections; runs `deriveMinMax`, `migrateTransfers`, `seedPrices` |
| `reindex()` / `IX` | Id and SKU lookup maps; clears `cache` |
| `commit(msg)` | Standard "after a change" step |
| `save()` / `flush()` / `enqueue()` | Debounced, serialised IndexedDB writes |
| `changeStock()` + `addMove()` | The only way stock changes; refuses negative stock |
| `docNo()` / `nextId()` | Per-year document numbers and ids |
| `onHand`, `avail`, `isLow`, `invStatus`, `balance` | Stock and receivables maths |
| `doConfirmSO`, `doShipSO`, `doInvoiceSO`, `doPayment` | Sales order lifecycle |
| `doOrderPO`, `doReceivePO`, `suggestions` | Purchasing |
| `replenishmentPlan`, `doShipTransfer`, `doReceiveTransfer` | Transfers |
| `doPosSale`, `doReturn` | Till sale; return with credit note |
| `publishAll`, `buildSummary`, `handleCrmOrder`, `crmStatusSync` | Bus snapshots and messages |
| `PAGES`, `DRAWER_ROUTES`, `ACT`/`CHG`/`INP` | Router tables; delegated handlers for `data-act`, `data-chg`, `data-inp` |

**Shared pieces used**

- Shell: back button and theme; CSS follows `data-adrial-mode`.
- Bus: publishes `erp.catalog`, `erp.customers`, `erp.summary` (1.5 s after changes). Reads its inbox `erp` for `crm.order`, creates a draft SO with `so.source = { app:'crm', dealId, … }`, matches or creates the customer by VAT ID then name, and calls `done`/`fail`. Sends `erp.orderStatus` to `crm` whenever such an order changes. `navigator.locks` (`adrial-erp-inbox`) stops two tabs creating the same order.
- Sync (optional): `AdrialSync.attach({ app:'erp', … })`, panel in `#syncPanel`.

**How to change common things**

- Add a field to an entity: set it in `data.js` (for example in `addP` for products), then add a default in `ensureSchema()` so saved data gets it too. Show it in the page or drawer function.
- Change volume: product loops and customer counts in `data.js` (`for (var ci = 0; ci < 40; ci++)`), sale probabilities in the "5. sales" block, `DAYS = 365`.
- Add a screen: write `pageX()` returning HTML, add it to `PAGES`, and add a `NAV` entry `['Label', 'x', 'icon', countFn]`.
- Change a colour: edit tokens in `style.css` `:root` and the `html[data-adrial-mode="dark"]` block.

**Gotchas**

- `validDb()` requires `version === ERPData.VERSION` (currently 3). Bumping `VERSION` silently discards saved data and regenerates.
- The generator throws if stock would go negative; changes to sale logic must use `availAt`.
- `migrateTransfers()` rebuilds older transfer movements into `db.transfers` once (`transfersMigrated`).
- Reset does not call `AdrialBus.reset`; it overwrites ERP snapshots by republishing.
- Script URLs carry `?v=9`; bump it to bust caches.

---

## CRM (`/crm/`)

**What it does**: A B2B sales CRM with companies, contacts, a drag-and-drop deal pipeline, activities, quotes, sales targets, lead scores, duplicate merging, e-mail templates and a weekly digest. Data is generated in the browser and saved in IndexedDB. Won deals can be sent to the ERP as draft sales orders over the bus.

**Files**

| File | Lines | Role |
|---|---|---|
| `index.html` | 60 | Sidebar nav with counters, top bar (search, "My view", New), `#main`, `#layer`, script order |
| `data.js` | 442 | `window.CRMDATA`: catalogues and the generator |
| `app.js` | 3266 | Storage, router, views, forms, board drag, bus, quotes, scoring, templates, digest, sync |
| `style.css` | 455 | Tokens (light + dark) and components |

**How it starts**

1. `<head>`: shell (`data-pos="br"`), `style.css`. `#main` shows "Loading CRM…".
2. Body end: `adrial-bus.js`, `adrial-sync.js`, `data.js`, `app.js`.
3. `app.js` builds lookup maps (`STAGE`, `OWNER`, `PRODUCT`, `ACT_TYPE`), reads UI prefs with `loadUi()`, wires events and `hashchange` (guarded by `whenReady`).
4. Boot: fills the "My view" select, then `Promise.all([loadDb(), busLoad()])`. `loadDb()` reads IndexedDB, else migrates the legacy localStorage copy, else `CRMDATA.generate(Date.now())`, and writes it.
5. Then `migrate()`, `updateNav()`, `route(false)` (first render), `busSync()`, `publishSoon(400)`, `attachSync()`, `mountSyncPanel()`. If loading fails, it generates data in memory and warns.

**Demo data**

- Generator: `CRMDATA.generate(nowMs)` with `mulberry32(SEED)`, `SEED = 20261007`. The random sequence is fixed, but dates are laid out relative to the first-load day (`startOfDay(nowMs)`) and weekend dates are moved to weekdays, so the exact records depend on that day.
- Catalogues (constants, not stored): 5 `OWNERS` (`u1`–`u5`), 6 `STAGES` with probabilities (Lead 10 … Negotiation 75, Won 100, Lost 0), 5 `SEGMENTS`, 2 `COUNTRIES`, 11 programme `PRODUCTS`, `LOST_REASONS`, `ACT_TYPES`, `SOURCES`.
- 81 companies: one fixed ("Očesna klinika Lipa d.o.o.") plus 30 opticians, 13 clinics, 18 corporates, 10 resellers, 8 partners in shuffled order, about 55 % SI.
- 2–4 contacts per company plus 6 without a company.
- 2–6 deals per company starting up to ~545 days ago (about 18 months). Each deal walks Lead → Negotiation with loss chances `[0.16, 0.13, 0.15, 0.2]` until won, lost or today; `history` records each move.
- Activities per stage period plus 3–5 items today and 1–3 overdue per owner; notes on about a third of deals. `addDuplicates()` adds a few duplicate companies and contacts.
- `migrate()` in `app.js` adds `quotes`, `dupIgnore`, `targets` (per owner from the last 12 months of won value × 1.1, minimum 5,000 a month), `templates`, and per-deal `changes` from `prng(d.id * 7919 + 13)`.

**State and storage**

- IndexedDB `adrial-crm` (version 1), store `kv`, key `data`: `{ version: 1, generatedAt, seq, companies, contacts, deals, activities, notes, quotes, dupIgnore, targets, templates }`.
- localStorage `adrial-crm-ui`: `me` (owner filter) and view state `co, ct, dl, board, act, week, tpl, digest`. `loadUi()` only keeps values whose type matches `UIDEF` and resets `act.limit`, `week.offset` and `digest.offset`. Legacy localStorage `adrial-crm-data` is migrated once and removed.
- BroadcastChannel `adrial-crm`, message `{ type:'changed', from: TAB_ID }`. `syncFromIdb()` reloads, but waits while this tab has unsaved edits, a write in flight or a dialog open.
- Saves: `commit()` → `save()` (marks dirty, clears caches, 250 ms debounce) → `flush()` with one write in flight; it re-flushes if dirty again. On success it tells sync and other tabs. Freshly generated data is written with `silentNext`, so it does not count as a change for sync.
- "Reset demo data" (`resetDemo()`): confirm, delete both localStorage keys, wait for the running write, `idbClear()`, regenerate and migrate, save, `AdrialBus.reset('crm')`, republish, go to `#/`.

**Screens and routing**

`parseHash()` splits `#/a/b`; `render()` switches on `a`.

| Route | Render function | Shows |
|---|---|---|
| `#/` | `viewHome` | KPIs, pipeline chart, tasks today, won by month, targets, hot leads, recently updated |
| `#/deals` | `viewBoard` | Kanban by stage (pointer drag) |
| `#/deals/list` | `viewDealList` | Sortable deal table |
| `#/deals/:id` | `viewDeal` | Lines, history, timeline, quotes, ERP card |
| `#/companies`, `/:id` | `viewCompanies`, `viewCompany` | Companies and detail |
| `#/contacts`, `/:id` | `viewContacts`, `viewContact` | Contacts and detail |
| `#/activities`, `/week` | `viewActivities`, `viewWeek` | List and week calendar |
| `#/quotes/:id` | `viewQuote` | Printable quote |
| `#/digest` | `viewDigest` | Weekly digest |
| `#/templates` | `viewTemplates` | E-mail templates |
| `#/data` | `viewData` | CSV import/export, sync card |
| `#/team` | `viewTeam` | Targets per owner |
| `#/duplicates` | `viewDuplicates` | Duplicate pairs and merge |
| other | `viewMissing` | Not found |

**Key functions**

| Function / object | Purpose |
|---|---|
| `CRMDATA.generate(nowMs)` | Builds the dataset |
| `loadDb()` / `migrate(d)` / `migrate3(d)` | Load and upgrade saved data in place |
| `M()` | Cached `Map`s by id (`co, ct, dl, act, note`) |
| `save()` / `flush()` / `flushNow()` / `commit()` | Debounced writes and re-render |
| `route()` / `render()` / `refresh()` / `updateNav()` | Navigate; re-render keeping scroll and focus; sidebar counters |
| `dealValue`, `weighted`, `actState` | Domain maths |
| `requestMove` / `applyMove` / `lostDialog` | Stage changes (lost asks for a reason) |
| `bindBoard` and `drag*` | Board drag-and-drop |
| `dealForm`, `companyForm`, `contactForm`, `activityForm` | Edit modals via `openModal` |
| `quoteForm`, `quoteStatus` | Quotes (Draft, Sent, Accepted, Declined, Expired) |
| `dealScore`, `companyScore` | Lead scores (hot ≥ 70, warm ≥ 45) |
| `findDuplicates`, `mergeCompanies`, `mergeContacts` | Duplicates |
| `composeEmail`, `fillT`, `digestData` | Templates with `{{placeholders}}`; weekly digest |
| `impRun`, `exportData` | CSV import/export |
| `busLoad`, `busSync`, `sendToErpDialog`, `crmSummary` | Bus integration |
| `quickSearch`; `ACT`/`CHG`/`INP` | Search (Ctrl/Cmd+K or `/`); delegated handlers |

**Shared pieces used**

- Shell: theme; charts redraw on `adrial-theme`.
- Bus: reads `erp.catalog` and `erp.customers` (product picker with stock warnings; "ERP customer" badge matched by VAT ID or name). `sendToErpDialog()` sends `crm.order` to `erp` for a won deal (or one with an accepted quote) that has catalogue lines with a SKU. `busSync()` handles `erp.orderStatus` into `deal.fulfilment` and tracks the sent message in `deal.erp`. Publishes `crm.summary` 1.5 s after changes.
- Sync (optional): `AdrialSync.attach({ app:'crm', … })`, panels in `#syncSide` and on `#/data`.

**How to change common things**

- Add a company field: set it in `makeCompany()` in `data.js`, default it in `migrate()`, add it to `companyForm()` and `viewCompany()`; add it to `CO_FIELDS` if merge should handle it.
- Change volume: the segment plan in `data.js` (`[['Optician', 30], …]`), `CT_RANGE`, `DEAL_RANGE`, `earliest = today − 545`.
- Add a stage or product: edit `STAGES` or `PRODUCTS` in `data.js` (constants, so old data keeps working).
- Add a screen: write `viewX()`, add a `case` in `render()`, and add a `<a data-nav="x">` link in `index.html`.
- Colours: tokens in `style.css` `:root` and `html[data-adrial-mode="dark"]` (`--c-violet`, `--t-violet`, …); stage and segment `tone` names map to these.

**Gotchas**

- Deal lines are of two kinds: CRM programmes (`productId`) and ERP products (`sku`). Only `sku` lines can go to the ERP.
- `validDb()` requires `version === 1`. New fields go through `migrate()`, not a version bump.
- A reset clears the local copy only; a signed-in cloud copy receives the reset data as a normal change.

---

## Analytics (`/analytics/`)

**What it does**: A read-only retail dashboard over about two years of generated daily data for 9 stores and 2 e-shops: sales, stores, e-commerce funnel and marketing, customers and cohorts, products, targets and forecast, automatic alerts and a monthly report. One extra page shows the ERP and CRM summaries that those demo apps published to the bus in this browser.

**Files**

| File | Lines | Role |
|---|---|---|
| `index.html` | 90 | Header, `#nav`, filter bar, `#scope`, `#main`, `#layer`, tooltip, script order |
| `data.js` | 362 | Generates `window.AA` (typed arrays and dimensions) |
| `app.js` | 2204 | State/URL, aggregation, SVG charts, pages, targets, forecast, alerts, export |
| `style.css` | 314 | Tokens incl. chart colours `--c1`…`--c6` (light + dark) |

**How it starts**

1. `<head>`: shell (`data-pos="br"`), `style.css`.
2. Body end: `adrial-bus.js`, `data.js`, `app.js`. There is no `adrial-sync.js`.
3. `data.js` runs synchronously and builds all data (time in `AA.genMs`).
4. `app.js` precomputes monthly cubes `MCUBE` and `LOCM`, loads targets, then `initFilters()` → `readHash(true)` → `render()`.
5. `loadBus()` reads the two summaries and re-renders if the live page is open.

**Demo data**

- Window: first day of the month 24 months ago up to today (local date); `ND` days. Day numbers are UTC day counts (`dnOf`), with `EPOCH` 2024-01-01 for growth trends.
- Deterministic by calendar date: every random draw is seeded from a hash of the date and a key, for example `rng(hash(dn, li, 11))` for a store day, `hash(dn, lj, 23)` for an e-shop day, `hash(k, 4242, 3)` for weekly incidents. A given date always gives the same numbers, whatever "today" is; the window just slides.
- Dimensions: 11 `LOCS` (9 stores, `si-eshop`, `hr-eshop`), 3 `CHANNELS` (store, e-shop, marketplace), 6 `CATS`, 5 `SOURCES`. `COMBOS` (location × channel × category) = 70.
- Arrays: `S` = `ND × NC × 7` measures (`rev, cogs, orders, units, newOrders, retRev, retUnits`); `OPS` = `ND × 9 stores × 3` (traffic, bookings, exams); `FUN` = `ND × 2 e-shops × 5 sources × 6` (sessions, views, add to cart, checkout, orders, spend); `COH_NEW` (new customers per acquisition key and month); `SHARE` (monthly share of 36 `PRODUCTS` within their category).
- Effects modelled: weekday and category seasonality, SI/HR public holidays incl. Easter, five promotions a year (`PROMOS`), yearly growth, and `EVENTS` (outage, bulk, returns, roas, checkout) for the Alerts page.
- Index example: `S[(d * NC + ci) * NM + 0]` is revenue for day `d`, combo `ci`.

**State and storage**

- No IndexedDB and no saved dataset: data is rebuilt on every load, so there is no "Reset demo data". The `Reset` button resets filters.
- localStorage, prefix `adrial-analytics-`: `last` (last filters), `sort` (table sort), `views` (saved views `{ name, hash, desc, saved }`), `targets` (`growth`, `marginPP`, and per-month, per-location `rev`/`gm` overrides).
- No BroadcastChannel of its own; it listens to the bus. No debounce: filter changes call `setFilters()`, which writes `last` and re-renders.

**Screens and routing**

Hash form `#/<page>?<filters>`. `readHash()` passes the query through `sanitize()` and replaces the URL with the canonical `hashFor()`. Filter keys (only non-defaults are written): `r` range preset, `c` compare (`prev`/`yoy`), `co`, `l` location ids, `ch`, `cat`, `g` granularity, `f`/`t` custom dates, `ov` overlay, `m` report month, `aw`/`ak` alert window/kind, `s` open store drawer.

| Page | Render function | Shows |
|---|---|---|
| `overview` | `pageOverview` | KPI tiles, trend with target/forecast overlay, breakdowns |
| `stores` | `pageStores` (+ `openStore`) | Store table, traffic, exams; store drawer |
| `ecommerce` | `pageEcom` | Funnel, sources, spend vs revenue, ROAS |
| `customers` | `pageCustomers` | New vs returning, cohorts |
| `products` | `pageProducts` | Product stats, ABC/Pareto |
| `targets` | `pageTargets` (+ `openTargets`) | Targets, forecast, editor |
| `alerts` | `pageAlerts` | Detected anomalies |
| `report` | `pageReport` | Monthly report vs previous month and last year |
| `live` | `pageLive` | `erp.summary` and `crm.summary` from the bus |

**Key functions**

| Function | Purpose |
|---|---|
| `sanitize`, `readHash`, `hashFor`, `setFilters` | URL-backed filter state |
| `getRange()` | Current and comparison day ranges |
| `selection()` | Which combos, stores and e-shops match the filters |
| `compute(ai, bi, sel)` | Sums over a day range into totals and series |
| `makeBuckets`, `gran` | Day/week/month buckets |
| `kpiTiles`, `card`, `tableHtml`, `addExport` | Page building blocks; every card can switch to a table |
| `lineChart`, `hbarChart`, `groupBars`, `stackChart`, `donutChart`, `heatmap`, `paretoChart`, `bubbleMap`, `sparkline` | Hand-written SVG charts |
| `mount`, `drawChart`, `bindChart`, `redrawAll` | Chart lifecycle, ResizeObserver redraw, tooltips and keys |
| `loadTargets`, `targetSeries`, `tRev`, `tGm` | Targets (default: same month last year × growth) |
| `forecastSlice` | Forecast with an 80 % band |
| `detectAlerts`, `robust` | Median/MAD anomaly detection |
| `loadBus`, `pageLive` | Bus snapshots |
| `exportCsv` | CSV of the tables on the current page |
| `render()` | Builds the page and calls its chart mounts |

**Shared pieces used**

- Shell: theme; `adrial-theme` triggers `redrawAll()`.
- Bus: reads `erp.summary` and `crm.summary`; `AdrialBus.on` reloads them when either key, or any `*.reset`, changes. It publishes nothing.
- Sync: not used.

**How to change common things**

- Add a location or category: add to `LOCS` or `CATS` (and `CATSEAS`, `MIX_*`, `PREFIX`) in `data.js`; combos and arrays size themselves.
- Change volume: `BASE_STORE`, `BASE_EXAM_BOOK`, `BASE_SESS`, `BASE_MKT`, `L.size`, growth exponents.
- Change history length: `START` in `data.js` (`now.getFullYear() - 2`).
- Add a page: add `['id', 'Label']` to `PAGES`, write `pageX()` returning `{ html, mounts }`, and dispatch it in `render()`.
- Add a filter: add a key to `DEF`, validate it in `sanitize()`, and use it in `selection()`.
- Colours: `--c1`…`--c6` in `style.css` (both modes); series reference them as `var(--c1)`.

**Gotchas**

- The page labelled "ERP & CRM (live)" is not server data: it only shows what the ERP and CRM demo apps published in this browser. If they have never been opened, it shows an empty state with a link.
- Filters do not apply on the live page; the monthly report uses its own month selector.
- Generation cost grows with `ND × NC`; keep an eye on `AA.genMs` (shown in the footer) when adding dimensions.
- Saved views store full hashes; renamed filter keys break old views (`sanitize()` falls back to defaults).

---

# Part 2: Adrial Mail, Invoices, Desk, Design Comparison, Branch Manager bookings

## Adrial Mail (`/mail/`)

**What it does**: A demo email and SMS marketing tool (in the style of Klaviyo) for a fictional optical retailer: profiles, lists, segments, campaigns with A/B tests, automated flows, sign-up forms, a block email editor and analytics. Everything is simulated in the browser: no email or SMS is ever sent, and all profiles and results are generated. A "demo clock" can be moved forward so that flows and scheduled campaigns run.

**Files**

| File | Lines | Role |
|---|---|---|
| `index.html` | 74 | Shell: sidebar nav (`data-nav` keys), top search, demo clock button, `<main id="main">`, script tags in load order |
| `style.css` | 464 | All styles (loaded as `style.css?v=2`) |
| `util.js` | 245 | `AM.U`: escaping, number/date formatting, seeded RNG, dialogs, toast, CSV, `U.pref`, SMS segment counter |
| `email.js` | 348 | `AM.Email`: block model, email-safe HTML renderer, plain text, `{{ tag }}` personalisation, sanitiser, generated SVG art, template library |
| `engine.js` | 783 | `AM.E`: profile/event index, segment evaluation, predictions, attribution, stats, campaign send simulation, flow runner |
| `data.js` | 300 | `AM.Data.generate()`: seeded demo database |
| `store.js` | 107 | `AM.S`: IndexedDB persistence + BroadcastChannel |
| `charts.js` | 113 | `AM.C`: hand-made SVG bar, line, horizontal-bar and sparkline charts |
| `ui.js` | 219 | `AM.UI`: page header, chips, condition editor, profile picker, sandboxed preview frame, pager; defines `AM.route` |
| `editor.js` | 344 | `AM.Editor`: drag-and-drop block editor with undo/redo and pre-send checks |
| `flows.js` | 305 | Flows list, visual flow builder, flow-email editor route |
| `pages-audience.js` | 300 | Profiles, lists, segments (segment builder) |
| `pages-messaging.js` | 523 | Campaigns (wizard, A/B, schedule, report), SMS, templates, sign-up forms |
| `pages-insights.js` | 329 | Dashboard, Analytics tabs, Event simulator |
| `app.js` | 241 | `AM.App`: boot, hash router, save wiring, cross-tab sync, simulated sending, heartbeat, demo clock |

No third-party JavaScript is loaded. The only external resource is the Geist / Geist Mono font from Google Fonts.

**How it starts**

1. `<head>` loads `/_shared/adrial-shell.js`, `/_shared/adrial-bus.js` and `/_shared/adrial-sync.js` (all three are optional for the app logic).
2. The 13 app scripts load with `defer` in this order: `util`, `email`, `engine`, `data`, `store`, `charts`, `ui`, `editor`, `flows`, `pages-audience`, `pages-messaging`, `pages-insights`, `app`. Each is an IIFE that hangs a module on `window.AM`. Page files call `AM.route(regex, fn, navKey)` (defined in `ui.js`), which pushes into `AM.routes`; `app.js` adopts that array as `App.routes`.
3. `app.js` → `boot()`: `S.bind()` gives the store a getter for the live db; `S.on()` listens for BroadcastChannel messages.
4. `Promise.all([S.load(), readCatalog()])`. If the stored `meta.version` equals `AM.Data.VERSION` (3), the stored db is used (and merged with an ERP catalogue if one is on the bus). Otherwise `fresh()` runs `AM.Data.generate(catalog)` and `S.saveAll(db)`.
5. `E.init(db)` builds the in-memory index; `App.heartbeat(true)` catches up flows and scheduled sends; `attachSync()` (only if `AdrialSync` exists); `App.render()`; then `setInterval(App.heartbeat, 15000)`.

**Data**

All data is generated demo data; there is no import of real contacts.

- Generator: `AM.Data.generate(products)` in `data.js`, seeded with `D.SEED = 20261007` through `U.rng` (mulberry32), so the same seed always gives the same database. The time anchor is "now, rounded to the minute" at first generation, so all dates are relative to that moment.
- Volumes: `D.N = 3000` profiles (about 58% Slovenian, 42% Croatian; emails at `example.si`, `example.hr`, `example.com`; phones `+386 00 5…` / `+385 00 5…`), shopping events over 540 days, 7 lists (Newsletter SI/HR, VIP, contact-lens, SMS, in-store, test), 10 segments, the 8 templates of `AM.Email.TEMPLATES`, 4 sign-up forms, 12 flows, monthly SI and HR newsletters plus seasonal promotions for the last ~12 months, several SMS campaigns, and a draft and scheduled campaigns. Flow history is produced by running the real flow engine (`E.enter`) over the generated events with the same RNG.
- Products: `D.PRODUCTS` (frames, sunglasses, contact lenses, solutions…) unless the ERP demo app has published `erp.catalog` on the local AdrialBus; then those products are used and later merged by SKU (`mergeCatalog`).
- Event rows are compact objects: `p` profile id, `t` type (`view`, `cart`, `checkout`, `order`, `open`, `click`, `sms_click`, `unsub`, `bounce`, `spam`, `sub`, `form`, `flow`, `prop`…), `ts`, `r` message ref (`c:<id>`, `c:<id>:<variant>`, `f:<flowId>:<stepId>`), `s` SKU, `v` value, `x` extra.

**State and storage**

- IndexedDB `adrial-mail`, version 1, one object store `kv` with out-of-line keys. One record per collection: `meta`, `settings`, `products`, `profiles`, `events`, `lists`, `segments`, `campaigns`, `flows`, `templates`, `forms`, `runs` (`S.KEYS`).
- Saving: `App.save(keys)` → `S.save` queues keys (plus `meta`) and flushes after 180 ms; `pagehide` forces a flush. If IndexedDB fails or `open` takes over 5 s, the app runs in memory and shows a warning toast.
- BroadcastChannel `adrial-mail`: after a write it posts `{ type: 'saved', keys, tab }`; other tabs re-read just those keys (`S.loadKeys`) in `applyRemote()`, delayed while the user is editing. `{ type: 'reset' }` makes other tabs reload.
- localStorage: only `adrial-mail-ui` (small UI preferences via `U.pref`, e.g. the dashboard `period` and the preview profile `previewP`), plus the shell's `adrial-theme`.
- AdrialBus (browser-local IndexedDB `adrial-bus`): reads `erp.catalog`; publishes `mail.summary` (`E.summary()`, debounced 2.5 s) for the Analytics demo; `Bus.reset('mail')` on reset. No files or blobs are stored.

**Screens and routing**

Hash router in `App.render()`: the path before `?` is matched against each route regex; the handler gets a fresh `<div class="page">` and the match.

| Route | Handler (file) | Shows |
|---|---|---|
| `#/` | anonymous, `pages-insights.js` | Dashboard: attributed revenue and other KPIs for 30 days / 90 days / 12 months / year to date, compared with the previous period |
| `#/analytics[/campaigns\|flows\|cohorts\|attribution\|export]` | `anCampaigns`, `anFlows`, `anCohorts`, `anAttr`, `anExport` | Comparison tables, cohorts, attribution windows, CSV exports |
| `#/simulator` | anonymous, `pages-insights.js` | Event simulator: fire events for a profile, quick scenarios, fast-forward the demo clock |
| `#/campaigns`, `#/campaigns/:id[/edit[/:step]]`, `#/campaigns/:id/content[/:n]` | `pages-messaging.js` | List; wizard for drafts, status for scheduled/sending, report + click map for sent; content editor |
| `#/sms`, `#/sms/:id` | `pages-messaging.js` | SMS list; composer with GSM-7/UCS-2 segment counter and consent checks; report |
| `#/templates`, `#/templates/:id` | `pages-messaging.js` | Template gallery and editor |
| `#/forms`, `#/forms/:id` | `pages-messaging.js` | Sign-up forms and their stats |
| `#/flows`, `#/flows/:id`, `#/flows/:id/email/:stepId` | `flows.js` | Flow list, visual builder, flow email editor |
| `#/profiles`, `#/profiles/:id` | `pages-audience.js` | Searchable profile list; profile detail with timeline, predictions, consent |
| `#/lists`, `#/segments`, `#/lists/:id`, `#/segments/new\|:id` | `pages-audience.js` | Lists and segments; segment builder |

**Key functions**

| Function / module | Purpose |
|---|---|
| `AM.Data.generate(products)` | Build the whole demo db deterministically |
| `S.load`, `S.save`, `S.flush`, `S.loadKeys` | IndexedDB read/write per collection |
| `E.init` / `rebuild` | Index profiles by id, events per profile (sorted), list membership sets |
| `E.addEvent(e, opt)` | Append an event, update consent/suppression/lens refill, optionally trigger flows (`E.onEvent`) |
| `E.cond`, `E.match`, `E.members`, `E.segSet` | Segment condition evaluation (fields in `E.PROP_FIELDS`, `E.PRED_FIELDS`) |
| `E.pred(p)` | Per-profile predictions: order interval, next order, churn score, CLV |
| `E.attr()` | Last-touch attribution: click (5 days) or SMS click (1 day) beats open (5 days); windows from `settings` |
| `E.audience(c)` | Recipients after excludes, consent, suppression, missing address |
| `E.runSend(c, opt)` / `E.commitSend` | Simulate a send (shuffle, A/B test group, winner by metric, rest after wait), then commit events and stats |
| `E.simEmail`, `E.simSms` | Probabilistic bounce/open/click/order/unsub per profile, driven by engagement `p.eng` |
| `E.enter`, `E.advance`, `E.tick` | Flow runner: delays, email/SMS steps, conditional and trigger splits, property updates; webhooks are skipped |
| `E.runDateTriggers` | Enter profiles into date-property flows (e.g. birthday, eye exam) |
| `App.sendCampaign`, `App.heartbeat`, `App.advanceClock` | Progress-bar "sending", periodic catch-up, demo clock offset (`meta.clockOffset`) |
| `AM.Email.render`, `M.plain`, `M.resolve`, `M.sanitize` | Email HTML, plain text, `{{ first_name\|default:"…" }}` tags, rich-text sanitising |
| `AM.Editor.mount`, `Ed.checks` | Block editor and pre-send checklist (footer with unsubscribe, alt text, link URLs, malformed tags, subject length, HTML size under Gmail's 102 KB clip) |
| `U.smsInfo(text)` | GSM-7 vs UCS-2 detection, characters, segment count |

**Shared pieces used**

- Shell: back button and theme. Charts redraw on the `adrial-theme` event (`C.redraw`).
- Bus: optional `erp.catalog` in, `mail.summary` out. Without the bus the built-in catalogue is used.
- Sync (optional): `AdrialSync.attach({ app: 'mail', getSnapshot: App.snapshot, applySnapshot: App.applySnapshot })`. The snapshot has `format: 'adrial-mail/1'`, every collection, and events packed as `{ cols: ['p','t','ts','r','s','v','x'], rows }`. The app works fully without signing in; the panel just shows "sign in".

**How to change common things**

- New page: in a pages file, `AM.route(/^\/thing$/, function (page, m) { App().title = 'Thing'; page.innerHTML = … }, 'thing');` and add `<a href="#/thing" data-nav="thing">` to the sidebar in `index.html`.
- Data volume or content: edit `D.N`, lists/segments/flows in `data.js`, then bump `D.VERSION` so every browser regenerates (this discards local changes).
- New email template: add an entry to `M.TEMPLATES` in `email.js` (`key`, `name`, `category`, `subject`, `preview`, `design()` returning blocks).
- New segment field: add to `E.PROP_FIELDS` (and handle it in `E.cond` if it is not a plain property).
- After changing any script, bump its `?v=2` query in `index.html`.

**Gotchas**

- `E.now()` is `Date.now() + meta.clockOffset`; always use it (not `Date.now()`) for anything time-related, or the demo clock breaks.
- Generated dates hang off the first-load anchor, so an old database looks "stale" until reset (sidebar "Reset demo data" clears `kv`, regenerates and makes other tabs reload).
- Email HTML is only ever shown in `<iframe sandbox="">` via `UI.frame`; design colours pass through `U.color` (hex only) to block CSS injection.
- Script order matters: `ui.js` must load before the page files and `app.js` last.
- Large collections (`events`) are written whole on every save of that key; save only the keys you changed.

## Invoices (`/invoices/`)

**What it does**: Keeps the user's own supplier invoices (PDFs and photos) in the browser, reads them with pdf.js and a rule-based parser (OCR for photos and scans), and shows costs by month, company, person, category and vendor, with payments, due-date reminders, duplicate checks, payment QR codes and an accountant export. There is no demo or example data: the app starts empty and holds only what the user drops in. Files never leave the device unless the user exports them or turns on the optional cloud sync.

**Files**

| File | Lines | Role |
|---|---|---|
| `index.html` | 852 | Page markup and all CSS (inline `<style>`), dialogs `detail`, `templates`, `dup`, `acct`, `settings`, script tags |
| `app.js` | 2312 | Core: IndexedDB, import pipeline, filters, dashboard, table, detail dialog, CSV/backup, settings, sync wiring |
| `parser.js` | 1094 | `window.InvoiceParser`: text lines → vendor, VAT ID, number, dates, amounts, IBAN, reference, category + confidence (also runs in Node) |
| `regions.js` | 387 | `window.InvoiceRegions`: page-relative geometry, text in a rectangle, anchors, template matching (pure) |
| `fieldmap.js` | 1420 | `window.InvoiceFieldMap`: PDF viewer, "select fields on the PDF", vendor templates, region OCR |
| `features.js` | 538 | `window.InvoiceFeatures`: payments, reminders/notifications, `.ics`, payment QR, duplicate comparison, accountant export |
| `media.js` | 173 | `window.InvoiceMedia`: photo decoding, whole-photo OCR with tesseract.js, photo as a pdf.js-like document |
| `qr.js` | 358 | `window.InvoiceQR`: QR encoder + UPN QR and EPC (SEPA) payloads, SVG output |
| `zip.js` | 165 | `window.InvoiceZip`: minimal ZIP writer (stored) and reader (stored + deflate) |

Third-party libraries:

- pdf.js 3.11.174 from `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js` (blocking `<script>` in the page) with worker `…/3.11.174/pdf.worker.min.js` set in `app.js`.
- tesseract.js 5.1.1 from `https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js` (`TESSERACT_URL`), loaded only when OCR is needed via `loadScript()`. tesseract.js then downloads its own worker, core and language data (its defaults). Languages: `eng+slv+hrv` with fallback to `eng` (`media.js`, `fieldmap.js`); the "Read with OCR" button for scanned PDFs uses `slv+eng`.

**How it starts**

1. Non-deferred scripts: shell, pdf.js, `parser.js`, `regions.js`, `zip.js`, `qr.js`, `media.js`, `adrial-sync.js`. Then deferred `fieldmap.js`, `features.js`, `app.js`.
2. `app.js` sets the pdf.js worker URL and, on `DOMContentLoaded`, runs `start()`:
3. `FM = InvoiceFieldMap.init(core)` and `FX = InvoiceFeatures.init(core)`, each receiving a `core` object of app helpers (state, `idb`, `toast`, `openDetail`…). Failures leave them `null` and the core still works.
4. `bind()` wires buttons, filters, the drop overlay and dialogs; `loadUi()` restores filters/sort.
5. `await loadState()`: reads `invoices`, `kv/settings`, `kv/rules`, `templates`; merges settings onto `DEFAULT_SETTINGS`; runs the one-off `migrations.adrialVat` fix.
6. Picks a default year filter, `render()`, `updateStorageLine()`, `migrateFileHashes()` (adds a sha256 and type to old file records), `attachSync()`.

**Data**

User data only. Ways in:

- Drop PDFs or photos anywhere on the page (`window` `drop` listener), the Add buttons (`#file-input`) or the camera button (`#camera-input`). `importFiles()` accepts `application/pdf` and images (JPG, PNG, WebP, HEIC where the browser can decode it).
- Restore a backup `.zip` (`restoreBackup`), which adds invoices whose id or hash is not present yet and merges rules, templates, categories, companies and users.
- Import vendor templates from a JSON file (`app: 'adrial-invoices-templates'`).

Built-in defaults (not demo data): `DEFAULT_COMPANIES` (four own companies used to decide who an invoice is billed to), `P.DEFAULT_CATEGORIES` (12 cost categories) and `KNOWN_VENDORS` in `parser.js` (common Slovenian vendors with their usual category).

**State and storage**

- IndexedDB `adrial-invoices`, version 2:
  - `invoices` (keyPath `id`, index `hash`): one record per invoice: `id`, `hash`, `fileName`, `mime`, `ext`, `size`, `pages`, `addedAt`, `vendor`, `detectedVendor`, `vendorTaxId`, `billedTo` (company id), `billedPerson` (email), `number`, `issueDate`, `dueDate`, `serviceDate`, `currency`, `total`, `vat`, `net`, `eur`, `vatRate`, `iban`, `reference`, `poNumber`, `category`, `notes`, `reverseCharge`, `paid`, `paidDate`, `payments[]`, `status` (`review` until saved once, then `ok`), `confidence{}`, `text` (first 40,000 chars), `ocr`, `ocrItems`, `templateId`, `fromTemplate`, `regions`, `duplicateOf`, `dupOk[]`.
  - `files` (keyPath `id` = the invoice id): `{ id, blob, hash, type }`. The original bytes as a Blob.
  - `kv` (keyPath `key`): `settings` (categories, companies, users, own names/VAT IDs, `remindDays`, `notify`, `exportPattern`, `exportSep`) and `rules` (learned vendor rules).
  - `templates` (keyPath `id`): vendor templates (see `cleanTemplate` in `regions.js`: `vatId`, `nameKey`, `fingerprint`, `fields{field: {page,x,y,w,h,anchor}}`, `fixedBilledTo`, `fixedBilledPerson`, `uses`…).
- Hashes: `sha256()` uses `crypto.subtle` and returns hex; without a secure context it falls back to `size-<bytes>`, which is excluded from duplicate checks and sync.
- localStorage: `adrial-invoices-ui` (`filters`, `sort`), `adrial-invoices-viewer` (`zoom`), `adrial-invoices-notified` (which invoices were notified today).
- No BroadcastChannel and no AdrialBus. `navigator.storage.persist()` is requested on first import.

**Screens and routing**

There is no router; one page plus native `<dialog>`s.

| View / dialog | Render function | Shows |
|---|---|---|
| Header, banners | `renderReviewBanner`, due banner in `render()` | "N to check" queue, due-soon / overdue count |
| Filters + KPIs | `renderFilters`, `renderKpis` | Year, month, category, status, company, person, search; totals incl./excl. VAT |
| Payments card | `FX.renderPayments` | Ageing buckets, unpaid by company / person, due soon |
| Charts | `renderMonthChart`, `renderBars` (person, company, category, top vendors) | Costs by month; click a bar to filter |
| Invoice table | `renderTable`, `renderBulk` | Sortable list, bulk assign company/person/paid |
| `#detail` | `openDetail`, `syncDetailUi`, `FM.onOpen`, `FX.onOpen` | PDF/photo preview, field selection, all fields, payments, QR code |
| `#templates` | `FM.openTemplates` | Vendor template list, rename, test, export/import |
| `#dup` | `FX.compareDuplicates` | Side-by-side comparison: discard / replace / keep both |
| `#acct` | `FX.openAccountant` | ZIP of files with a naming pattern + CSV for a company and month range |
| `#settings` | `openSettings` | Companies, people, categories, rules, storage, sync panel, wipe |

**Key functions**

| Function | Purpose |
|---|---|
| `importFiles(fileList)` | Per file: sha256 → text (pdf.js or OCR) → `P.parseInvoice` → `FM.applyOnImport` → `makeInvoice` → store file + invoice → duplicate dialogs → open the review queue |
| `extractLines(buf)` / `pageLines(items)` | pdf.js text of up to 15 pages, grouped into lines by baseline; gaps over 1.4× text height become 3 spaces (column separator) |
| `extractImage` → `InvoiceMedia.ocr` | Photo OCR: word boxes with confidence ≥ 20 become page-relative items; lines rebuilt with `R.textInRect` |
| `P.parseInvoice(lines, opts)` | Field extraction with per-field confidence |
| `FM.applyOnImport`, `readWithTemplate` | Match a vendor template, read its regions, override parser fields (`confidence = 'template'`) |
| `R.matchTemplate`, `R.locate`, `R.fingerprint` | Template matching and anchor-shifted regions |
| `findDuplicates(inv)` | Levels: `file` (same hash), `duplicate` (same vendor + number), `likely` (vendor, total, date), `possible` (total, date, company) |
| `saveDetail`, `learnRule` | Save edits; with "remember" checked, store `rules['id:<VAT>']` or `rules['name:<vendor>']` |
| `runOcr`, `applyOcrLines` | OCR a scanned PDF (first 3 pages at scale 2.2) or a photo, then fill empty fields |
| `exportCsv`, `exportBackup`, `restoreBackup` | CSV of filtered invoices; full backup ZIP (`files/<id>.<ext>` + `invoices.json`) |
| `FX.renderQr` → `InvoiceQR.upnQr` / `epcQr` / `svg` | Payment QR for the open amount (total − payments) |
| `FX.exportIcs`, `maybeNotify` | Calendar of due dates with an alarm `remindDays` before; hourly browser notifications |
| `snapshot`, `applySnapshot`, `syncFiles` | Optional cloud sync |

**How the parser works (`parser.js`)**

Input is the array of text lines (columns separated by 3+ spaces). If the text has fewer than 20 non-space characters it returns `scanned: true` with empty fields. Otherwise:

- Vendor (`findVendor`): marks a "buyer zone" (5 lines after Kupec / Bill to / Customer…) and the column of the user's own company names, so VAT IDs found there count as the buyer's. The seller's VAT ID is then looked up in learned rules (`id:<VAT>`), then `name:` rules, then `KNOWN_VENDORS`, then a name is taken from the top lines (legal suffix such as d.o.o., GmbH, Ltd).
- Number (`findNumber`): first line matching `NUMBER_KEYS` (Račun št., Invoice no., Faktura…), or the token on the next line after a label-only line.
- Dates (`findDatesFields`): due date = first date at or after a `DUE_KEYS` label (rok plačila, zapadlost, valuta, due date…) on the same line or the next line; issue date likewise with `ISSUE_KEYS`. With no issue label, the first date not on a due/service line is used with `low` confidence. A due date earlier than the issue date is dropped. The parser never invents a due date.
- Amounts (`solveAmounts`): the total is the highest-weighted `TOTAL_KEYS` line (amount on the line or the next). VAT and net are then solved in order: (0) per-rate rows where VAT ≈ base × rate, summed, must add to the total; (1) a VAT amount plus any other amount equals the total; (2) total × r / (100 + r) for a rate found in the text appears in the document; (3) a net line, VAT = difference; (4) a "strong" VAT line alone; (5) reverse charge / exempt wording → VAT 0. Net + VAT = total raises the total's confidence to `high`.
- `toNumber` handles `1.234,56`, `1,234.56`, `1 234,56` and apostrophes: the last `.` or `,` is the decimal point unless exactly three digits follow it and it is the only separator kind.
- IBAN (`findIbans`, `ibanValid`): runs of letters/digits shrunk until the mod-97 check passes; the user's own IBANs are skipped.
- Also: VAT rate from net/VAT snapped to known rates, reference (SI/HR/RF model), PO number, service date, billed-to company (`findBilledTo`), billed-to person by email (`findBilledPerson`), category (`guessCategory` keyword rules).

**How the payment QR is built (`qr.js`)**

- UPN QR (Slovenian IBANs only, tab "UPN QR"): 19 fields joined with `\n` in this order: `UPNQR`, 7 empty payer fields, amount in cents padded to 11 digits, 2 empty fields, purpose code (default `OTHR`), purpose (max 42 chars, e.g. `Račun <number>`), due date `dd.mm.yyyy`, recipient IBAN, reference (must be `SI..` or `RF..`, otherwise `SI99`), name, street, city (33 chars each). A 3-digit control value (byte length of the body) and `\n` follow. The text is encoded as ISO 8859-2 (`latin2`), padded with spaces to 411 bytes and encoded as QR version 15, level M, with ECI 4. The payer fields stay empty so the banking app fills them.
- EPC/SEPA QR (any IBAN): `BCD`, `002`, `1`, `SCT`, BIC, name (70), IBAN, `EUR<amount>`, purpose, structured `RF` reference or free text (140); trailing empty lines removed; UTF-8; version ≤ 13.
- `encode()` is a full ISO/IEC 18004 byte-mode encoder: Reed–Solomon over GF(256), block interleaving, all 8 masks with the standard penalty score. `svg()` outputs only numbers and an escaped title. QR codes are shown only for EUR, unpaid invoices with a valid IBAN.

**Shared pieces used**

- Shell only (no bus).
- Sync (optional): `AdrialSync.attach({ app: 'invoices', getSnapshot: snapshot, applySnapshot, files: syncFiles })`. The snapshot holds invoices (text trimmed to 20,000 chars), templates, settings and rules; files go separately by sha256, max 20 MB each. A file that exists only in the cloud is fetched on open by `fileBlob()`. Every readwrite transaction except on `files` calls `sync.changed()`. Without sync everything works locally.

**How to change common things**

- New invoice field: add it to `parseInvoice` output, `makeInvoice`, `openDetail`/`collectDetail`, `cleanInvoice`, the form in `index.html`, and (if selectable on the PDF) `FIELDS` in `regions.js` plus the `INPUT` map in `fieldmap.js`.
- New label language: extend the regexes `TOTAL_KEYS`, `DUE_KEYS`, `ISSUE_KEYS`, `NUMBER_KEYS`, `MONTHS` in `parser.js`.
- New known vendor or category rule: add to `KNOWN_VENDORS` / `CATEGORY_RULES`.
- Default companies or categories: `DEFAULT_COMPANIES` in `app.js`, `DEFAULT_CATEGORIES` in `parser.js` (existing browsers keep their saved settings).
- Accountant file-name tokens: `TOKENS` / `fileNameFor` in `features.js`.

**Gotchas**

- The `files` store is keyed by invoice id, not hash: two invoices with the same bytes store the file twice. (Desk does the opposite.)
- pdf.js is a blocking script from cdnjs. If it does not load, PDF import is refused with a toast; OCR also needs the network the first time.
- Only the first 15 PDF pages are read; `text` is capped at 40,000 chars.
- `wipeAll()` clears all four stores; there is no undo. With sync on, an empty state is then uploaded like any other change.
- Element ids in `index.html` (`d-vendor`, `d-due`, …) are referenced from `app.js`, `fieldmap.js` and `features.js`; rename them everywhere.
- Notifications fire only while a tab is open (hourly `setInterval`).
- `window.__invoicesApp` exists only for the end-to-end test.

## Desk (`/desk/`)

**What it does**: A task list for a business secretary that turns the user's own e-mails into tasks. Outlook `.msg` files, `.eml` files or pasted mail text become tasks with suggested due dates; booking links and confirmation PDFs or photos are attached to each task, so it is clear what is booked and what is left. All mail content is stored only in the browser, with an optional private cloud copy.

**Files**

| File | Lines | Role |
|---|---|---|
| `index.html` | 505 | Markup and inline CSS: header, tabs, toolbar, empty state, dialogs `detail`, `mailview`, `confedit`, `paste`, `settings`, `ask` |
| `app.js` | 1704 | Core: IndexedDB, content-addressed files, import, list views, task detail, confirmation editor, mail viewer, sync |
| `msg.js` | 370 | `window.DeskMsg`: Outlook `.msg` (OLE/CFB) reader |
| `eml.js` | 197 | `window.DeskEml`: MIME `.eml` reader |
| `extract.js` | 534 | `window.DeskExtract`: subject clean-up, due-date suggestions, booking extraction, provider detection, pasted-mail parsing |
| `features.js` | 386 | `window.DeskFeatures`: board, calendar, done log, example data, backup/restore, CSV |

Third-party: only pdf.js 3.11.174 from cdnjs (`PDFJS_URL`, `PDFJS_WORKER`), loaded lazily by `loadPdfJs()` when a confirmation PDF is opened (`crossOrigin='anonymous'`, `referrerPolicy='no-referrer'`). There is no OCR in Desk.

**How it starts**

1. `msg.js`, `eml.js`, `extract.js` and `adrial-sync.js` load synchronously; `features.js` and `app.js` are deferred.
2. `start()`: `FX = DeskFeatures.init(core)`, `loadUi()` (view and calendar month), `setupUi()`, `setupBulk()`, `setupDrop()`.
3. `openDb()` + `loadState()` read `tasks`, `mails` and `kv/settings` (on failure `#storage-error` is shown).
4. Opens BroadcastChannel `adrial-desk`; any message reloads the state 150 ms later and refreshes the open task if the user is not typing in it.
5. `renderMain()`, `updateStorageLine()`, `navigator.storage.persist()`, `attachSync()`, and a 60 s timer that re-renders when the date changes (Ljubljana time).

**Data**

User data, from:

- Files dropped anywhere, chosen with Import (`#file-input`) or pasted as files. `sniff()` decides the type: CFB signature → `msg`; `%PDF` → `pdf`; image types → `image`; `.eml` / `message/rfc822` or header-like first 4 KB → `eml`. Mail files become tasks; PDFs/photos are attached as confirmations to the open task.
- Pasted text: the Paste dialog, or Ctrl+V anywhere outside a field (text over 20 chars opens the dialog), or a drag from new Outlook / Outlook on the web that carries text only. `X.parsePasted` reads `From/Od/Šalje`, `Sent/Poslano/Datum`, `To/Za`, `Cc/Kp`, `Subject/Zadeva/Predmet` lines.
- New manual task (`N` key or button).
- Restore of a Desk backup JSON (replace everything, or add missing tasks).

Example data: `FX.loadExamples()` (buttons `#example-btn` in the empty state and `#s-example` in Settings) adds 6 fictional tasks: 4 with example mails (Slovenian, English and Croatian requests for a hotel, flights, a rental car, accommodation) from `@example.com` senders, 2 done tasks with example confirmations (`hotel-lipa.example.com`, `tickets.example.com`). All dates are relative to today, all names end in "(example)", and they are tagged `example`. They are removed with Clear all data or by deleting them.

**State and storage**

- IndexedDB `adrial-desk`, version 1:
  - `tasks` (keyPath `id`): defaults from `cleanTask`: `title`, `status` (`todo`, `doing`, `waiting`, `done`), `due`, `priority` (`high`, `normal`, `low`), `notes`, `checklist[{id,text,done}]`, `tags`, `forWhom`, `mailId`, `dueSuggestions[{iso,snippet,score}]`, `confirmations[]`, `confirmed`, `confirmedAt`, `confirmedWith`, `createdAt`, `updatedAt`, `doneAt`.
  - `mails` (keyPath `id`): `taskId`, `key`, `altKey`, `messageId`, `subject`, `from`, `to`, `cc`, `date`, `text`, `htmlHash`, `links[]` (max 80), `attachments[{hash,name,type,size,cid,inline}]`, `source` (`msg`/`eml`/`paste`), `fileName`, `rtfOnly`, `importedAt`.
  - `files` (keyPath `hash`): content-addressed by sha256 of the bytes: `{ hash, blob, type, name, size, addedAt }`. The mail HTML is stored here too (`message.html`). Identical files are stored once.
  - `kv` (keyPath `key`): `settings`.
- Confirmation object: `{ id, kind (hotel|stay|flight|train|bus|car|event|ferry|link), label, url, provider, ref, dateFrom, dateTo, amount, currency, text, fileHash, fileName, fileType, size, addedAt, updatedAt }`.
- `gcFiles()` deletes files no task or mail references (after delete, restore and taking a cloud copy).
- localStorage: `adrial-desk-ui` (`view`, `calMonth`) plus `adrial-theme`.
- BroadcastChannel `adrial-desk`: `{ type: 'changed' }` after every saved change.

**Screens and routing**

No URL routing; `state.view` is a tab saved in localStorage. A search query replaces the view with `renderSearch`.

| View / dialog | Render function | Shows |
|---|---|---|
| `today` | `renderMain` | Overdue, Today, New without a due date (last 7 days) |
| `upcoming` | `renderMain` | Tomorrow, next 7 days, later, no due date |
| `waiting` | `renderMain` | Tasks waiting on someone |
| `done` | `FX.renderDoneLog` | Done log with confirmations |
| `all` | `renderMain` | Grouped by status |
| `board` | `FX.renderBoard` | Four status columns, drag or buttons to move; done column shows the last 14 days |
| `calendar` | `FX.renderCalendar` | Month grid of due dates and booking ranges (`bookingsOf`) |
| `#detail` | `openTask` → `renderDetail` | Task fields, due suggestions, checklist, confirmations, the source mail |
| `#mailview` | `openMail` | Mail as text or sanitised HTML in a sandboxed iframe, attachments |
| `#confedit` | `openConfEditor` | Add/edit a booking link or file, with suggestions from the mail or PDF |
| `#paste`, `#settings`, `#ask` | `openPaste`, settings markup, `ask()` | Paste mail text; sync, storage, backup, examples, clear; confirmations |

**Key functions**

| Function | Purpose |
|---|---|
| `importFiles(fileList)` | Sniff types, parse mails with `MSG.parse` / `EML.parse`, create tasks; route PDFs/photos to the open task |
| `createFromParsed(p, meta)` | Duplicate check, store attachments and HTML with `putFile`, build the mail record, task title from `X.cleanSubject`, `X.suggestDue` |
| `mailKey`, `findDuplicate` | `id:<message-id>` or `k:<subject>\|<from>\|<date to the minute>`; asks Skip / Import again / Open existing |
| `putFile`, `getBlob`, `gcFiles`, `referencedFiles` | Content-addressed file store; cloud fallback when signed in |
| `htmlToText`, `linksIn` | Text body from HTML when there is no plain text; `http(s)` links |
| `sanitizeMailHtml(html, allowRemote, cidMap)` | Removes scripts/frames/handlers/`javascript:` URLs, blocks remote images unless "Load images", inlines `cid:` images as data URLs, adds a strict CSP `<meta>` |
| `readPdf(blob, canvas)` | Text of up to 10 PDF pages (lines by baseline) and a page-1 thumbnail |
| `openConfEditor(t, opt)` | Confirmation form; `X.detectProvider` on the URL, `X.extractBooking` on the mail or PDF text |
| `setStatus`, `confirmOpenItems` | Status changes; asks before marking done with open checklist items |
| `FX.loadExamples`, `downloadBackup`, `restoreBackup`, `downloadCsv` | Examples, JSON backup with base64 files, restore, CSV |
| `snapshot`, `applySnapshot`, `downloadMissing`, `syncFiles` | Optional cloud sync |

**How the parsers work**

`msg.js` (Outlook `.msg` = OLE compound file, "CFB"):

1. Check the 8-byte signature `D0 CF 11 E0 A1 B1 1A E1`. Read the header: sector size `1 << u16@0x1E` (512 or 4096), mini sector size `1 << u16@0x20` (64), FAT sector count `@0x2C`, first directory sector `@0x30`, mini-stream cutoff `@0x38` (4096), mini-FAT start/count `@0x3C/0x40`, DIFAT start `@0x44`.
2. Collect FAT sector numbers: the first 109 from the header at `0x4C`, the rest by following the DIFAT chain (the last 4 bytes of each DIFAT sector point to the next). Concatenate those sectors into one `Uint32Array` FAT. Sector `n` lives at byte `(n + 1) * sectorSize`.
3. `chain(start, table)` follows next-pointers until `ENDOFCHAIN` (`0xFFFFFFFE`) and throws on a loop. `readBig` concatenates the sectors of a chain.
4. The directory is a chain of 128-byte entries: UTF-16 name (length at `0x40`), type at `0x42` (1 storage, 2 stream, 5 root), left/right/child at `0x44/0x48/0x4C`, start sector `0x74`, size `0x78`. Children of a storage are found by walking the sibling tree from `child` through `left`/`right`.
5. The root entry's stream is the mini stream. Streams smaller than the cutoff are read from it in 64-byte mini sectors via the mini FAT (`readMini`), larger ones via the FAT.
6. MAPI properties: variable-size ones are streams `__substg1.0_<id><type>` (`001F` UTF-16, `001E` 8-bit in the message code page, `0102` binary, `000D` embedded object). Fixed-size ones are 16-byte entries in `__properties_version1.0` after a 32-byte header (24 for an embedded message, 8 for recipients/attachments); FILETIME values become ISO dates.
7. `readMessage` maps properties: subject `0x0037`; sender name `0x0C1A`/`0x0042`; sender SMTP `0x5D01`/`0x5D02`/`0x0C1F`/`0x0065`, falling back to the transport headers `0x007D`; recipients from `__recip_version1.0_#n` (`0x39FE`/`0x5FF7`/`0x3003`, name `0x3001`, type `0x0C15`: 1 To, 2 Cc); date `0x0039`, `0x0E06`, the Date header, then `0x3007`; Message-ID `0x1035`; text `0x1000`; HTML `0x1013` (charset from code page `0x3FDE`/`0x3FFD` or the HTML meta). A mail with only compressed RTF (`0x1009`) gets `rtfOnly: true` and no body. Attachments come from `__attach_version1.0_#n` (name `0x3707`/`0x3704`/`0x3001`, MIME `0x370E`, Content-ID `0x3712`, data `0x3701`); an embedded message (method 5) is parsed recursively and turned into a small `.eml` by `toEml`.

`eml.js` (MIME): the file is read as a binary string (one char per byte). It strips a BOM and an mbox `From ` line, splits headers from body at the first blank line, unfolds headers, and parses `Content-Type` / `Content-Disposition` parameters including RFC 2231 continuations and charsets (`parseParams`). `walk()` recurses into `multipart/*` (max depth 20) by splitting on `--boundary`, decodes base64 or quoted-printable, takes the first non-attachment `text/plain` and `text/html` parts as the body (decoded with each part's own charset), and keeps every other part as an attachment (a `text/calendar` part becomes `invite.ics`, an attached message gets its subject as a file name). Encoded words (RFC 2047) are decoded with `DeskMsg.decodeWords`; header bytes are tried as strict UTF-8, then windows-1252. A file without any mail-like header throws.

`extract.js`:

- `cleanSubject` removes `[tag]` and repeated reply/forward prefixes in many languages (`RE`, `FW`, `AW`, `WG`, `ODG`, `POSL`…).
- `findDates(text, baseIso)` finds ISO dates, `15.10.2026`, `15/10/26`, `15. 10.` (no year, marked weak), `15 Oct`, `15. oktobra 2026`, `15. listopada`, `October 15th, 2026`. A date without a year gets the base year, or the next year if it would fall more than 31 days before the base date.
- `suggestDue(text, subject, baseIso)` (base = the mail date): keeps only the newest message (stops at quoted lines, reply headers or "Original message"), but falls back to the whole thread when the newest part has no usable date (typical for forwards). Each date on or after the base date and within 730 days scores 2 (1 if weak), +3 with a `DUE_KEY` word just before it (do, by, until, rok, deadline, check-in, meeting…), +2 if directly after do/by/until/before, +4 for rok/deadline/due/najkasneje, −4 when it is the end of a range ("od 20. 10. do 22. 10."), +1 if in the subject. Relative words are added too: jutri/tomorrow/sutra, danes/today, pojutrišnjem/prekosutra, and weekdays after do/by/until ("do petka", "by Friday", "next Monday"). Result: the best 3 distinct dates with a snippet, stored in `task.dueSuggestions`.
- `extractBooking(text, { baseIso })`: joins stacked date boxes (`joinStackedDates`), finds a booking reference after labels such as "booking number", "confirmation code", "številka rezervacije" (`findRef`), assigns dates to check-in/arrival and check-out/return labels on the same or following lines (ignoring "booked on"/"cancel by" dates), falls back to the two earliest future dates within 60 days, takes the amount on the best "total" line (or the largest amount), and the provider from `providerFromText`.
- `detectProvider(url)`: host match against `PROVIDERS` (Booking.com, Airbnb, Expedia, hotel chains, airlines, rail, rental cars…), else a kind guessed from words in the host.

**Shared pieces used**

- Shell only (no bus).
- Sync (optional): `AdrialSync.attach({ app: 'desk', getSnapshot: snapshot, applySnapshot, files: syncFiles })`. The snapshot holds tasks, mails (text capped at 50,000 chars, `textTrimmed: true`) and settings; files go by their sha256 hash (max 20 MB, only referenced ones). After a cloud copy is applied, `downloadMissing()` fetches missing files in the background. Without signing in nothing is uploaded and the app works fully.

**How to change common things**

- New status: add to `STATUSES` in `app.js` and a colour in `COLS` in `features.js`.
- New tab/view: add to `VIEWS` and a branch in `renderMain` (or a renderer in `features.js`).
- New booking provider: add `{ name, kind, hosts, text }` to `PROVIDERS` in `extract.js`.
- New deadline wording or language: extend `DUE_KEY`, `MONTHS`, `WEEKDAYS`, `PREFIX`, `REF_LABEL`, `FROM_LABEL`/`TO_LABEL`.
- The parsers run in Node (`module.exports`), so they can be unit-tested without a browser.

**Gotchas**

- Booking URLs are never fetched; they only open in a new tab. Mail HTML is shown in an `<iframe sandbox="allow-popups allow-popups-to-escape-sandbox">` with a CSP meta; remote images stay blocked until "Load images".
- RTF-only Outlook mails import without a body (`rtfOnly`); the viewer says so.
- Photos attached as confirmations are not read; only PDF text is (first 10 pages, 20,000 chars kept in `c.text`). Files over 40 MB are refused.
- Dates use `Europe/Ljubljana` (`TZ`) for "today", independent of the computer's time zone.
- "Clear all data" empties all four stores; when signed in, the empty state replaces the cloud copy.
- All mail/PDF text goes into the DOM through `textContent` (`h()`); keep it that way.
- `window.__deskApp` exists only for the end-to-end test.

## Design Comparison (`/design-compare/`)

**What it does**: A one-page decision tool that renders the same fictional Adrial dashboard in three design languages (Branch Manager, Photon, Tenzen), side by side or one at a time, in light and dark. It lists the key differences and colour tokens and lets the user pick a winner per criterion, write notes and copy a summary. Nothing is loaded from a server except the font.

**Files**

| File | Lines | Role |
|---|---|---|
| `index.html` | 796 | Everything: early theme script, CSS (page chrome + scoped preview styles `.scr.bm/.ph/.tz`), markup for four views, one inline script |

No third-party JavaScript. Fonts: Geist (300–600) and Geist Mono from Google Fonts.

**How it starts**

1. `<head>` loads `/_shared/adrial-shell.js`, then a tiny inline script that copies localStorage `adrial-theme` to `<html data-theme>` before paint.
2. The main inline IIFE at the end of `<body>` defines constants, loads `state` from localStorage, builds the side-by-side columns and calls `mount()` for each design, fills the design switcher, difference table and swatches.
3. `applyTheme()` then `setView(view)` (the saved view, default `side`).

**Data**

Fictional sample content, hard-coded in the script: `DESIGNS` (`bm` Branch Manager, `ph` Photon, `tz` Tenzen, each with a tagline), `NAV` (5 menu items), `KPIS` (4 tiles), `MONTHS` with `THIS` and `LAST` series for the chart, `STORES` (5 store rows), `ROWS` (18 rows of differences), `SW_NAMES` + `SW` (8 colour tokens per design in light and dark) and `CRIT` (7 decision criteria). There is no generator, seed or user import.

**State and storage**

- localStorage `adrial-design-compare-v1`: `{ view, single, picks: { <criterion>: 'bm'|'ph'|'tz' }, final, notes }`.
- localStorage `adrial-theme`: written by the page's own theme buttons as well as by the shell; the two stay in sync through the `adrial-theme` window event and `AdrialShell.refresh()`.
- No IndexedDB, no BroadcastChannel, no files.

**Screens and routing**

No URL routing; four `<section id="view-*">` blocks toggled by `setView()`.

| View | Render function | Shows |
|---|---|---|
| `side` | `mount(stage, key)` for each design | Three scaled previews, "Open larger" buttons |
| `single` | `showSingle()` → `mount(singleStage, single)` | One preview; keys 1/2/3 and ←/→ switch designs |
| `details` | `ROWS` table, `SW` swatches (built once) | Difference table and colour tokens |
| `decide` | `renderDecide()` | Per-criterion picks, score bars, final choice, notes, Copy summary, Reset |

**Key functions**

| Function | Purpose |
|---|---|
| `screen(k, mode)` | HTML string for one 1180 px preview; Tenzen gets a top bar, the others a sidebar (`sidebar`, `header`, `kpis`, `chartCard`, `formCard`, `tableCard`, `componentsCard`) |
| `chart()` | Inline SVG line chart of `THIS` vs `LAST` |
| `fit(stage)` | Scales the 1180 px preview to the column width with `transform: scale()`, sets the stage height; driven by a `ResizeObserver` and `document.fonts.ready` |
| `mount(stage, k)` | Renders a preview in the current resolved mode and fits it |
| `applyTheme()` | Sets `data-theme`, stores `adrial-theme`, updates every `.scr` `data-mode` |
| `setView(v)` | Shows one view, saves it |
| `renderDecide()` | Pick buttons, tally per design, final pick |
| `copySummary` click / `fallbackCopy` | Clipboard API, or a hidden textarea with `execCommand('copy')` |
| `load()` / `save()` | localStorage state |

**Shared pieces used**

Shell only (theme switch, back button). No bus, no sync.

**How to change common things**

- Add a design: add an entry to `DESIGNS`, a `.scr.<key>` and `.scr.<key>[data-mode="dark"]` token block in the CSS, a column in `ROWS`, an entry in `SW`, and a `counts` key in `renderDecide()`. The keyboard handler assumes three designs (`% 3`).
- Change the sample dashboard: edit `NAV`, `KPIS`, `THIS`/`LAST`, `STORES`.
- Change criteria: edit `CRIT`; old picks for removed keys are simply ignored.

**Gotchas**

- Previews are `inert` and `aria-hidden`; their buttons have `tabindex="-1"`. They are pictures, not working UI.
- Each design's colours are CSS variables scoped to `.scr.<key>`, so page tokens and preview tokens never mix; dark mode for previews comes from `data-mode`, not from `<html>`.
- Bump the storage key suffix (`-v1`) if the state shape changes.

## Branch Manager bookings (`/branch-manager/Bookings.html`)

**What it does**: A TIMIFY-style appointment calendar for the optics branches: agenda, day, week and monthly shift-plan views per branch, with rooms, services, opening hours and public holidays. Bookings are generated sample data; the user can add, edit, duplicate and delete bookings, and those changes are kept in this browser only. Nothing is sent to TIMIFY.

**Files**

| File | Lines | Role |
|---|---|---|
| `Bookings.html` | 930 | Self-contained page: CSS, markup (header, two toolbars, stats + view panel, `#layer` for popovers/drawers/modals) and one inline script |

Not used by Bookings: `support.js` (350 lines, a bundled React runtime) and `login-dark.css` serve the older `*.dc.html` prototype pages in the same folder.

How it links in: the Branch Manager prototype `Main.dc.html` has a sidebar link `Bookings.html` and, on each branch row, `Bookings.html?branch={{b.id}}` (the branch ids there, such as `komenda`, match `BRANCHES` here). The Adrial Apps home page (`public/index.html`) links `branch-manager/Bookings.html` from the Branch Manager card. The page's breadcrumb links back to `Main.dc.html`.

No third-party JavaScript; fonts from Google Fonts.

**How it starts**

1. `/_shared/adrial-shell.js` in `<head>`.
2. The inline IIFE defines branches, services, date helpers, the generator and the local store, then reads `state` from the URL: `branch` (default `komenda`), `view` (`agenda|day|week|shift`, default `week`, or `agenda` under 760 px), `date` (default today).
3. Fills the branch and service selects, wires the toolbar and keyboard, and calls `render()`.

**Data**

Generated sample bookings, deterministic per branch, day and room:

- `BRANCHES`: 9 branches (5 HR: Osijek, Rijeka, Split, Zadar, Zagreb; 4 SI: Komenda, Koper, Maribor, Novo Mesto) with 2–3 rooms each (`roomList` codes `E1`, `E2`…).
- `SERVICES`: 10 TIMIFY services (eye exams 20/30/60 min, sight measurement, contact-lens fitting/check-up, eye doctor, eye pressure test) with duration, light and dark colours and a weight `w` for random picks; plus `CUSTOM`.
- Opening hours (`hours()`): Mon–Fri 08:00–19:00 with a 12:00–12:30 break, Saturday 08:00–13:00, Sunday closed. `holidays(country, year)` lists fixed SI/HR holidays, Easter Monday from `easter(y)` and, for HR, Corpus Christi.
- `generated(branch, date)`: seeds mulberry32 `rng()` with an FNV-1a `hash(branchId|date|room)`. It walks the day from opening to closing; at each step, with probability `base` (0.78 weekdays, 0.58 Saturday, × 1/0.72/0.5 for the 1st/2nd/3rd room, × 0.35 for a showroom, fading after 40 days ahead) it places a weighted service; otherwise it skips 10 or 20 minutes. Customers come from Slovenian/Croatian name pools with `@example.si` / `@example.hr` emails and fake phones; about 3.5% are cancelled, about 3.5% of past ones are no-shows, about 66% are "created by Alensa" (online) and the rest by staff names. Results are cached in `GEN`. Ids look like `komenda-2026-10-08-E1-480`.

**State and storage**

- localStorage `bm-bookings-v1`: `{ added: {id: booking}, edited: {id: booking}, deleted: {id: true} }`. It is an overlay over the generated data: `bookingsOn(branch, date)` returns generated bookings that are not deleted or edited, plus edited and added ones for that day.
- `putBooking(x)`: generated → `edited`, user-made → `added`. `removeBooking(x)`: deletes from `added`/`edited` and flags generated ids in `deleted`. New ids start with `u-`, `createdBy: 'You (prototype)'`.
- URL query `branch`, `view`, `date` kept current with `history.replaceState` (`syncUrl`).
- localStorage `adrial-theme` (shell). No IndexedDB, no BroadcastChannel, no sync.

**Screens and routing**

`render()` calls `syncUrl`, `renderToolbar`, `renderStats` and one view renderer.

| View (`?view=`) | Render function | Shows |
|---|---|---|
| `week` | `renderCalendar(7 days)` | Time grid 08:00–19:00 (`PX = 1.9` px per minute), one column per day × room; breaks and closed days shaded |
| `day` | `renderCalendar([date])` | Same grid for one day |
| `agenda` | `renderAgenda()` | List grouped by hour, with a search box |
| `shift` | `renderShift()` | Month grid with opening hours per room and utilisation |
| Popover / drawer / modals | `quickActions`, `details` (tabs `booking`, `customer`), `editForm`, `newBooking`, `confirmDelete` | View, edit, duplicate, delete; customer visits (same email within ±60 days) |

**Key functions**

| Function | Purpose |
|---|---|
| `generated(branch, s)` | Deterministic sample bookings for a branch and day |
| `bookingsOn(branchId, s)`, `findBooking(id)` | Merge generated data with the local overlay |
| `putBooking`, `removeBooking`, `saveStore` | Write the overlay to localStorage |
| `hours`, `holidays`, `holidayOf`, `easter` | Opening hours and closed days |
| `busy`, `roomFree`, `freeSlots` | Collision checks and free-slot search (respects breaks and closing time) |
| `newBooking(opts)` | 3-step wizard: service, rooms and duration → pick free slots (several allowed) → customer (search existing within ±14 days or new), note, notify toggle; re-checks for clashes before saving |
| `editForm(x)` | Drawer to edit service, room, date, start, duration, customer name/email/phone, notes, status and no-show |
| `renderStats` | For the visible range: bookings, % of open room time booked, cancelled, added or changed by you |
| Export button handler | CSV of the visible range: date, start, end, room, service, customer, email, phone, status, created_by, note |
| `colors(x)` | Service colours, switching to the dark tints when `data-adrial-mode="dark"` |

Clicking an empty grid slot opens `newBooking` at that time (if the branch is open, the time is not past and the room is free). Keyboard: `T` today, `N` new booking, Alt+←/→ previous/next.

**Shared pieces used**

Shell only. The page re-renders on the `adrial-theme` event so booking colours follow the theme. No bus and no sync: changes cannot leave the browser.

**How to change common things**

- Add a branch or room: add to `BRANCHES` (keep the `id` in line with `Main.dc.html`).
- Add a service: add to `SERVICES` (with `w` for how often it is generated) and to `DARK_TINT` / `DARK_INK`.
- Opening hours: `hours()` (minutes after midnight) and `GRID_START` / `GRID_END`.
- Holidays: the fixed-date maps in `holidays()`.

**Gotchas**

- `TODAY` is computed once at load and feeds the generator (the fade and no-shows), so the sample data shifts slightly from day to day.
- Edited generated bookings are stored as full copies keyed by the generated id. If you change the generator, old ids in `edited`/`deleted` may no longer match anything (harmless but invisible).
- `GEN_free` is reset in `putBooking` but never read.
- All dates are local-time `YYYY-MM-DD` strings built with `new Date(y, m, d)`; avoid `toISOString()` for day keys.
- The "notify customer" option and "sent to TIMIFY" are only simulated in toasts.

---

# Part 3: Parcels & COD, Payment reconciliation, Store daily board

## Parcels & COD (`/parcels/`)

**What it does.** A customer-service and finance board for about 1,500 fictional parcels sent by 9 carrier accounts in Slovenia, Croatia and Italy. It shows where each parcel is, puts stuck, failed, returned and damaged parcels into a work queue, and follows each cash-on-delivery (COD) amount from the courier to the carrier payout batch and then to the bank statement. Nothing is ever sent to a carrier, customer or bank. Carrier tracking links are only shown as text.

**Files**

| File | Lines | Role |
|---|---|---|
| `index.html` | 42 | Page frame: sidebar (`#nav`, `#modePanel`, `#syncPanel`, demo pill, `#resetBtn`), `#main`, `#layers`, `#toast`. Loads `adrial-shell.js`, `adrial-sync.js`, `data.js`, `app.js`. |
| `data.js` | 369 | `window.ParcelsData`: reference data (`CARRIERS`, `SHOPS`, `TEAM`, `ACCOUNTS`), the generator `generate(anchor)` and date helpers (`util`). |
| `app.js` | 2,621 | The whole single-page app: storage, the derived model, exception rules, the COD model, pages, and the live mode. |
| `style.css` | 415 | Styles and light/dark tokens. |

**How it starts (demo path)**

1. `app.js` builds lookups (`CAR`, `SHOP`, `PERSON`) and reads the UI prefs from localStorage `adrial-parcels-ui`.
2. At the bottom of the file, `Promise.all([idbGet(), checkSession()])` waits for both the stored state and the live-session check. This avoids a flash of the wrong mode.
3. If `validState(stored)` passes, `ensureState()` repairs it. If the state is **untouched** (`st.touched === false`) and its anchor day is not today, `freshState(anchorNow())` regenerates the data for today. A touched state keeps its old snapshot. With no valid state, `freshState()` runs.
4. `freshState` → `loadData()` (calls `D.generate(st.anchor)`, then `derive()`), then `seedState()`. A fresh state is written to IndexedDB at once.
5. `onRoute()` renders the page, `syncStart()` attaches cloud sync, and `watchAuth()` re-checks the session when the sync user changes.

**Demo data**

- **Generator:** `data.js` → `generate(anchor)`. The anchor is a `'YYYY-MM-DDTHH:MM'` Ljubljana wall-clock time. `anchorNow()` rounds it down to the hour.
- **Seeded random:** `rng(0xC0D5A1)` (mulberry32). All date maths uses `Date.UTC` on naive strings, so daylight-saving time never shifts a day. The same anchor always gives the same data.
- **Volumes:** 60 days ending at the anchor. Mon–Fri 29–39 parcels a day, Sat 4–8, Sun 2–5. The country mix is SI 45 %, HR 40 %, IT 15 %, and each country has its own carrier mix (`CARRIER_MIX`). The COD share is `COD_RATE` (SI 0.44, HR 0.47, IT 0.16), cut by a quarter for lockers. Each parcel gets a scan history from `simulate()`. Events dated after the anchor are dropped.
- **Payout batches:** one batch per carrier pay day (`payDays`). It pays parcels delivered at least `lag` working days earlier. Bank arrival is `bankLag` working days later, and `onBank` is true when that date is on or before the anchor. The fee is `pct × COD + fix`.
- **Injected problems:**
  - Parcels: stalls with no scans, sometimes declared `lost` (0.8 % × the carrier's `pm` factor); damage at the depot (0.35 %); refusals; failed attempts that lead to a parcel shop, a post office or a return; lockers not collected within 7 days.
  - COD payouts: 3 % skipped (these become *overdue*), 2 % partial collection, 1.2 % extra fee, and 16 % of returned COD parcels paid anyway ("lists the parcel as delivered").
- **Seeded work:** `seedState()` (seed `0x5EED01`) fakes a queue that has been in use for a while. About 62 % of exception parcels get an assignee, a next action and notes. Older mismatches are reconciled or have claims opened by "tina". Most batches older than 12 days are marked reconciled.

**State and storage**

- **IndexedDB:** `adrial-parcels`, store `kv`, key `state`. It holds one document `st = { version, anchor, me, touched, settings, cases, cod, batches, claims, log, seq, live }`.
  - `cases[pid]` = `{assignee, action, resolved, notes[]}`.
  - `cod[pid]` = `{how:'reconciled'|'claim', …}`.
  - `batches[bid]` = reconciliation mark.
  - `claims[]` have numbers `CLM-YYYY-NNNN`.
  - Only the anchor and the person's decisions are saved. The parcels are regenerated on every load.
- **Writes:** `save()` waits 250 ms (debounce), then `flush()` puts a deep copy through a serial queue (`enqueue`). It also flushes on `pagehide` and when the tab is hidden.
- **localStorage:** `adrial-parcels-ui` (filters and page numbers) and `adrial-parcels-mode`.
- **BroadcastChannel:** `adrial-parcels`. Other tabs re-read IndexedDB on `{type:'changed'}`.
- **Reset demo data** (`resetDemo()`) and **Regenerate for today** (`ACT.regen`) both call `freshState(anchorNow())`, which throws away cases, COD decisions, claims and settings. Both keep `st.live`.

**Screens and routing**

| Hash | Render function | Shows |
|---|---|---|
| `#/` | `pageOverview` | KPIs, parcels-per-day chart, average delivery days, work-queue counts, COD weekly chart |
| `#/search` | `pageSearch` | One search box: order number, tracking number, name or e-mail, plus a parcel card |
| `#/parcels` | `pageParcels` (`TABLES.p`) | Filterable and sortable list with CSV export |
| `#/exceptions` | `pageExceptions` (`TABLES.e`) | Work queue with rule chips and bulk assign, action and resolve |
| `#/cod/outstanding\|batches\|mismatches\|claims` | `pageCod` → `codOutstanding` / `codBatches` / `codMismatches` / `codClaims` | COD ageing, payout batches, differences, claims |
| `#/scorecard` | `pageScorecard` | Per-carrier metrics, best and worst marked |
| `#/settings` | `pageSettings` | Rule thresholds, "you are", carrier terms |

Parcels open in a drawer (`openParcel`) and batches in a drawer (`openBatch`). Neither has its own route.

**Key functions**

| Function | Purpose |
|---|---|
| `generate(anchor)` (data.js) | Builds parcels, events and batches |
| `simulate(p, c, shop, created)` (data.js) | Writes one parcel's scan history and picks its fate |
| `derive()` | Indexes (`IX.p`, `IX.item`, `IX.batchOf`, `IX.b`). Sets `status`, `pickAt`, `delAt`, `fails`, `days`, `onTime` and the search key |
| `issuesOf(p)` | Applies the exception rules (cached in `cache.iss`) |
| `queueRows()` / `openExceptions()` | Rule hits plus hand-added cases / those not resolved |
| `codOf(p)` | The COD state machine (cached) |
| `codDiff(o)` | Signed difference per mismatch |
| `batchStatus(b)` | `rec` / `ann` / `diff` / `ready` |
| `seedState()` | Seeds the demo decisions |
| `ACT.codRec`, `ACT.codClaim`, `ACT.codUndo` | Reconcile a difference, open a claim, undo |
| `ACT.batchRec` | Marks a batch reconciled. Only enabled when it is on the bank and has no open differences |
| `commit(msg)` | Marks touched, clears `cache`, saves, re-renders |
| `scoreRows()` | Scorecard aggregation |
| `staleNotice()` | Banner when the data's day is not today |

**The exception rules.** Thresholds live in `st.settings` (defaults `stuckDays 3`, `failedMin 1`, `pickupDays 5`, `codOverdueDays 14`).

- `noscan`: the parcel is active but not waiting for pickup, and `U.wdBetween(p.last.ts, TODAY) >= stuckDays` (working days, Mon–Fri).
- `failed`: the parcel is active and `fails >= failedMin`.
- `pickup`: the status is `pickup` and the calendar days since the last event are `>= pickupDays`.
- `returned`: the status is returning or returned.
- `damlost`: damaged or lost.
- `manual`: added by hand.

**The COD lifecycle.** `codOf` puts every COD parcel in one state:

- `pending`: not delivered yet.
- `collected`: delivered, not in a batch yet.
- `overdue`: collected, and more than `codOverdueDays` calendar days have passed.
- `announced`: in a batch, but the batch is not on the bank yet.
- `paid`: the batch is on the bank.
- `short`: paid less than expected (`it.paid < it.expected - 0.005`).
- `paidret`: the parcel was returned, damaged or lost, but the carrier paid it anyway.
- `void`: returned and not paid.

`short`, `paidret` and `overdue` are mismatches. They stay open until `st.cod[pid]` records a decision.

**Live mode (short).** The live code is in the "LIVE DATA" section at the end of `app.js` (`MODE`, `checkSession`, `applySession`, `lsetMode`, `lfetch`/`lget`, `NAV_LIVE`, the `pageL*` pages). Live mode only switches on when the session check says the signed-in account is approved (`SESSION.allowed`). Live rows stay in page memory, and only decisions go into `st.live`. `MODE` starts as `'demo'`, and `lsetMode('live')` falls back to demo unless `SESSION.allowed`. If `/api/parcels/session` is missing or returns a non-OK response, `SESSION.failed` is set and the app stays demo-only. Nothing else needs to change.

**Shared pieces used.** `/_shared/adrial-shell.js` (back button and theme switch, localStorage `adrial-theme`). `/_shared/adrial-sync.js` is optional: `AdrialSync.attach({app:'parcels', getSnapshot: syncSnapshot, applySnapshot: applyCloud})`. Without it, `syncChanged()` does nothing. `adrial-bus.js` is not used.

**How to change common things**

- **Add a carrier:** add an entry to `CARRIERS` (with `k` for the colour `--kN`, `payDays`, `lag`, `pct`/`fix`, `sla`, `td`), add it to `CARRIER_MIX`, and add a case to `tracking()`.
- **New exception rule:** add a row to `RULES`, push it in `issuesOf()`, and optionally add notes and an action in `seedState`.
- **Default thresholds:** `defaultSettings()`. The Settings form limits are in the `thrForm` submit handler.
- **More or fewer parcels:** the per-day `n` in `generate()`.

**Gotchas**

- Any change to `generate()` that uses random numbers in a different order changes which parcel `p17` or batch `b42` is, so the saved decisions point at different parcels. Bump `VERSION` in `data.js`. This invalidates the stored states.
- Money here uses floats rounded with `r2()` and compared with a 0.005 tolerance. It does not use integer cents like recon.
- `p.status` comes from the last event that is not `info`, but the `noscan` age uses `p.last`, which includes `info` events.
- After a mutation, always go through `commit()`. Results are cached in `cache` and are stale until it is cleared.

---

## Payment reconciliation (`/recon/`)

**What it does.** It matches 90 days of fictional provider transactions (cards, PayPal, Klarna, Flik, VALÚ, COD carriers, bank transfers) to shop orders and invoices. It auto-matches by reference, suggests likely matches, and puts what is left into an exception queue with owners and notes. It also checks payout batches against a demo bank statement, reports fees, and walks through a month-close checklist with accounting CSV exports.

**Files**

| File | Lines | Role |
|---|---|---|
| `index.html` | 42 | Same frame as Parcels. Loads `adrial-shell.js`, `adrial-sync.js`, `data.js?v=3`, `app.js?v=3`. |
| `data.js` | 403 | `window.ReconData`: `PROVIDERS`, `ACCOUNTS` (16 payout streams), `SHOPS`, `METHOD_LABEL`, `OWNERS`, `generate(genDate)`, `todayLj()`, `util`. |
| `app.js` | 2,618 | Storage, base indexes, the matching engine, pages, drawers, the live mode. |
| `style.css` | 387 | Styles. |

**How it starts (demo path)**

1. `Promise.all([boot(), checkSession()])`. `boot()` reads IndexedDB and checks it with `validState()`.
2. **Stored state:** `ensureState()` → `loadBase()`, which calls `D.generate(S.genDate)`, sets `REF = S.genDate` and builds `IX`.
   **No stored state:** `S = freshState(TODAY)` → `loadBase()` → `seedDemoDecisions()`.
3. `engine()` computes every match, suggestion and exception. Then `onRoute()`, `syncStart()` and `watchAuth()` run.

**Demo data**

- **Generator:** `generate(genDate)`. The seed is `rng(0x5EC0A7)`. Orders cover `genDate−90 … genDate−1`. `genDate` is stored once and **does not move forward by itself**: the data stays "as of" that day until a reset.
- **Integer cents:** every amount is in integer cents (for example `amountFor()` returns 2390–64990). The data comment says this is "so totals always tie out".
- **Volumes:** 34 orders on Sundays, 38 on Saturdays and 49 on weekdays, each × 0.85–1.15 (about 4,000 orders). There are 2,500 pool customers on `@example.com`. Captures arrive after `lagFor()` days. Payouts are daily (weekends roll into Monday) or weekly, depending on `ACCOUNTS[].cadence` and `lag`. Bank lines come from the payouts plus bank-transfer transactions.
- **Reference noise:** about 15 % of card references are `#` plus the lowercased order number, PayPal leaves 5 % empty, COD 16 % empty. Bank transfers use UPN-style refs (`SI00 …`, `SI12 …`), a free-text phrase or nothing.
- **Injected exceptions (deterministic `take()` picks):**
  - payments: 7 orders paid twice; 8 rounding differences of ±1–2 c; 6 Klarna partial captures; 5 PayPal CHF and 2 Adyen GBP currency differences.
  - multi-order and split payments: 9 bank payments that cover two orders; 6 bank instalments; 4 Klarna split captures.
  - missing or extra money: 6 orders marked paid with no payment; 11 payments with no order (`orphan`); about 4 % refunds, with every 18th one (`k % 18 === 5`) missing its credit note; 6 chargebacks.
  - bank side: 2 payouts missing from the bank (Klarna, COD); 2 bank amounts that differ (−12.40 € and −2.50 €); 1 unexplained "RESERVE RELEASE" from Adyen (412.50 €).
  - Also, 6 % of bank proformas are never paid.
- **Truth is hidden:** `t.oid` is deleted from transactions before they reach the app, so the app has to find the matches itself.

**State and storage**

- **IndexedDB:** `adrial-recon`, store `kv`, key `state`. It holds `S = { v, genDate, seq, links[], blocked{}, rejected{}, ex{}, close{}, threshold{count, value}, log[], createdAt, live }`. Only decisions are saved:
  - `links` are accepted or manual matches (`{id:'L'+seq, txnIds, orderIds, conf, src, by, at, note, reason}`).
  - `rejected` holds suggestions that were turned down, and `blocked` holds pairings that were unmatched. Both are keyed by `mkey()` = `"T1+T2|O5"`.
  - `ex[id]` holds the status, owner, notes and a `snap` of the exception.
  - `close[month]` holds the fees and export ticks and the closed mark.
- **Writes:** debounced by 200 ms and serialised through a queue.
- **localStorage:** `adrial-recon-ui` (filters; live search text is blanked before saving) and `adrial-recon-mode`.
- **BroadcastChannel:** `adrial-recon`.
- **Reset demo data:** `S = freshState(TODAY)` with `S.live` kept, then `seedDemoDecisions()`.

**Screens and routing**

| Hash | Render function | Shows |
|---|---|---|
| `#/` | `pageOverview` | Match rate, unmatched value, suggestions, exceptions by type × age, fees, pending payouts, recent decisions |
| `#/reconcile/suggestions` | `pageReconcile` → `viewSuggestions` | Likely matches. Keys: A accept, R reject, M manual, ↑↓ move, Enter details |
| `#/reconcile/workbench` | `viewWorkbench` | Two pick lists plus `selBar()`, "Match selected" |
| `#/reconcile/matched` | `viewMatched` | All matches, with Unmatch |
| `#/exceptions` | `pageExceptions` | Queue with status, owner, age and bulk update |
| `#/payouts`, `#/payouts/bank` | `pagePayouts` → `viewPayouts` / `viewBank` | Batches with tie-out checks; bank lines |
| `#/fees` | `pageFees` | Fees by provider, account, method, brand or month |
| `#/close` | `pageClose` | Month-close checklist |
| `#/activity` | `pageActivity` | Decision log with Undo for rejects and unmatches |

The drawers are `openTxn`, `openOrder`, `ACT.match`, `ACT.payout` and `openEx`.

**The matching engine (`engine()`)**

1. **Stored links first.** A link is skipped and counted in `E.stale` if a transaction is gone or already used, or if a payment link would use an order that is already paid.
2. **Reference match.** `refOrders(t)` pulls order numbers (`[3579]\d{5}`), invoice numbers (`R26-XX-NNNNN`) and invoice digits (`26NNNNN`, looked up by country in `IX.invD`, where a clash is marked `'AMBIG'`) out of `t.ref`. A union-find joins captures and the orders they reference into components.
   - The sums are equal: an **exact** match.
   - One order with several captures, and one of them equals the order: **exact**, with an `over` amount (paid twice).
   - Otherwise: **likely**.
   Refunds and chargebacks are matched by reference without using up the order. Components listed in `S.blocked` are skipped.
3. **Suggestions.** Unmatched captures are compared with free orders of the **same amount in cents** (`byAmt`), inside the provider's date window (`WINDOW`, for example Klarna 0–10 days, COD 1–14, bank 0–21). The **same e-mail or the same name** is also required (`nameKey()` sorts the name tokens, so word order does not matter). Score = 40 + 35 (e-mail) + 15 (name) + max(0, 10 − day gap). A greedy pass picks one-to-one pairs. Then it looks for two orders of the same customer that add up to one payment.
4. **Exceptions.** `no_order`, `double_paid`, `amount_diff` (subtype `currency` / `rounding` / `partial capture` / `overpayment`), `refund_no_cn`, `chargeback`, `payout_missing`, `payout_diff`, `paid_no_payment` and `bank_unknown`. Each id is `type:id`. Status, owner and notes come from `S.ex`. If an exception was worked on and its condition has since cleared, its stored `snap` keeps it visible, marked as cleared.

**Keeping totals consistent.** All amounts are integer cents, and fees are rounded with `Math.round` when they are generated. Ties are checked with exact `===`:

- `tie(g - f === n, 'gross − fees = net')`;
- the sum of line gross equals the payout gross;
- the bank amount equals the net (`payoutStatus`).

Cents become euros only at display time (`eur(c)`) and in CSV files (`cents2()` / `cc()`). The month-close threshold is stored in cents (default `{count: 5, value: 50000}` = 500 €).

**Key functions**

| Function | Purpose |
|---|---|
| `generate(genDate)` (data.js) | Orders, transactions, payouts, bank lines |
| `loadBase()` | Builds `IX` (`o`, `t`, `p`, `b`, `byNo`, `inv`, `invD`, `bankByPayout`, `bankByTxn`, `months`) |
| `refOrders(t)` | Finds orders in a reference |
| `engine()` | Matches → suggestions → exceptions, into `E` |
| `payoutStatus(p)` | `arrived` / `transit` / `missing` / `diff` (expected two working days after the payout) |
| `seedDemoDecisions()` | Statuses and notes from fictional `OWNERS` |
| `acceptSug(s)` / `ACT.reject` / `ACT.acceptAll` | Suggestion decisions |
| `ACT.matchSel` | Manual match with a required reason and an optional write-off |
| `ACT.unmatch` | Removes the link and adds the pairing to `S.blocked` |
| `setEx(x, patch, note)` | Changes exception status, owner or note, plus the log |
| `closeCalc(m)` | The five close checks: providers, payouts, exceptions, fees, exported |
| `ACT.closeMonth` / `ACT.reopen` | Close needs a note if checks are open; reopen needs a reason |
| `accFiles(m)` / `ACT.exportAcc` | Three CSVs: matched pairs, unmatched items, fees per provider |
| `commit(msg)` | `engine()`, then `save()`, then `rerender()` |

**Live mode (short).** The live code is the "LIVE DATA" section that starts at about line 1631 of `app.js` (`MODEKEY`, `checkSession`, `applySession`, `setMode`, `lfetch`/`lget`, `NAV_LIVE`, `PAGES_LIVE`, the `pageL*` pages). It only switches on for approved signed-in accounts (`SESSION.allowed`). Decisions on live data go to `S.live`. `MODE` defaults to `'demo'`. If `/api/recon/session` is missing or fails, `SESSION.failed` keeps the app in demo, and `setMode('live')` refuses without `SESSION.allowed`.

**Shared pieces used.** `adrial-shell.js`. `adrial-sync.js` is optional (`app:'recon'`; `syncSnapshot()` empties `live` for accounts that are not approved). No bus.

**How to change common things**

- **Date window per provider:** `WINDOW`.
- **Suggestion scoring:** the score formula in step 3 of `engine()`. The workbench uses `candScore()` with a threshold of 45.
- **New exception type:** add the label to `EXT`, a hint to `HINT` in `openEx`, and create it in step 4 of `engine()`.
- **Fees:** `feeFor()` in data.js.
- **Default threshold:** `freshState()`.

**Gotchas**

- Links point at generated ids (`T…`, `O…`). Changing the generator or how many random numbers it uses breaks the saved links (they show up as "Stale links ignored"). Bump `VERSION`, which `STATE_V` checks via `S.v`.
- `REF` is the stored `genDate`, not today, so all ages count from that day.
- In modal `onSubmit` handlers, `commit()` runs inside `setTimeout(…, 0)` so that the modal closes first.
- `engine()` recomputes everything on every decision. Keep it linear.

---

## Store daily board (`/stores/`)

**What it does.** A morning board for ten fictional optics stores (7 in SI, 3 in HR). For any day in the last 120 days it shows sales, month-to-date progress against target, the cash check, staff plan against clock-ins, glasses waiting for pickup, complaints, Google reviews and head-office tasks. Each store gets a traffic-light status. Staff can mark cash as checked, mark customers as called and reviews as replied, write notes, and tick off tasks.

**Files**

| File | Lines | Role |
|---|---|---|
| `index.html` | 45 | Frame with `#topbar` (date picker, "Viewing as") and `#page` inside `#main`. |
| `data.js` | 418 | `window.StoresData`: `STORES`, `staff`, `hours`, `holiday`, `plan`, `attendance`, `day`, `monthTarget`, `workOrders`, `complaints`, `reviews`, `initialState`, `util`. |
| `app.js` | 1,779 | ES2015 (`const`/arrows). Storage, derived numbers, status, pages, live mode. |
| `style.css` | 408 | Styles. |

**How it starts (demo path)**

1. Constants: `TODAY` is the Ljubljana date (`nowLj()`), `YDAY = TODAY − 1`, `MIN_DATE = YDAY − 119`. The board date `cur` starts at `YDAY`.
2. The UI prefs are read from `adrial-stores-ui`, with defaults set by `uiDef()`.
3. `Promise.all([boot(), checkSession()])`. `boot()` reads IndexedDB. If the state is missing or invalid, it writes `D.initialState(TODAY)`.
4. With no hash, the URL is replaced with `#/` (or `#/store/<id>` when "Viewing as" is a store). Then `onRoute()`, `syncStart()` and `watchAuth()` run.

**Demo data**

- **Per-key seeding:** there is no global seed. `tools(key)` seeds mulberry32 with an FNV-1a `hash()` of a purpose string such as `'day|KP|2026-10-07'`, `'att|<staffId>|<date>'`, `'wo|…|i'`, `'rv|…'`, `'cmp|…'` or `'target|…'`. Any given store-day is always identical, whatever today is. Results are cached per key.
- **No stored anchor:** all trading is computed by date, so it is relative to the real today. Only `initialState(today)` uses today, to seed task due dates (`seededFor`).
- **Entities:** 10 stores with opening hours (`MALL`, `CITY`, `COAST`) and SI/HR public holidays. Each store has `staffN + 1` staff with rotating shifts (`plan`). There is a daily `day()` record (revenue `3350 × size × season × weekday factor × growth × noise`, sales mix, eye exams, cash box). The other data:
  - work orders for the last 190 days;
  - complaints for the last 200 days;
  - reviews since `2025-09-01`;
  - a monthly target = last year's same month × (1.03–1.07), rounded to 500 €.
- **Injected problems:**
  - Staff: 1.5 % absences, 5 % late clock-ins, 1.2 % missing clock-outs.
  - Cash and cards: 5 % cash differences of 5–50 €, 11 % small ones, 3 % card-terminal differences.
  - Work orders: 6.5 % delayed at the lab, 4.5 % with a 15–40 day pickup wait.
  - Complaints: 3.5 % stay open for 20–40 days.
  - Reviews: low-star reviews, more often at stores with a low `quality`.
  - Seasonal and promo effects.
- **Tasks:** the initial state seeds tasks `t1`–`t4`, with some already done.

**State and storage**

- **IndexedDB:** `adrial-stores`, store `kv`, key `state`. It holds `{ version, seededFor, cash{}, called{}, replied{}, notes{}, tasks[], taskDone{}, nextTask, updatedAt, live }`.
  - `cash['storeId|date']` = `{at, note, by}`.
  - `called[workOrderId]` and `replied[reviewId]` = `{at, by}`.
  - `notes['storeId|date']`.
  - `taskDone['taskId|storeId']` = timestamp.
  - Only the person's marks, notes and tasks are saved. Trading data is never stored.
- **Writes:** debounced by 250 ms. Note text is saved 500 ms after the last keystroke.
- **localStorage:**
  - `adrial-stores-ui` holds `viewAs`, `allView`, `country`, `sort`, `tr`, `staff`, `tasks`, `pick`, `lastStore`, plus the live prefs.
  - `adrial-stores-mode` holds the data mode.
- **BroadcastChannel:** `adrial-stores`. An update from another tab is ignored while you are typing in the notes box.
- **Reset demo data:** `state = D.initialState(TODAY)`, keeping `state.live`.

**Screens and routing**

| Hash | Render function | Shows |
|---|---|---|
| `#/` | `pageAll` | KPIs, then tiles (`tileHtml`) or a sortable table (`tableAll`, columns `COLS`) |
| `#/store/<id>` | `pageStore` | Status reasons, the day's KPIs against the same-weekday average, then cards: `cardMtd`, `cardCash`, `cardPickups`, `cardComplaints`, `cardMix`, `cardStaffToday`, `cardTasks`, `cardNotes`, `cardReviews` |
| `#/trends` | `pageTrends` | Line or stacked chart, up to 3 stores, a dashed "last year" line |
| `#/staff` | `pageStaff` | Planned against clocked hours per person, with a person drawer (`ACT.person`) |
| `#/tasks` | `pageTasks` | Head-office tasks per store; `ACT.newTask`, `ACT.delTask` |

**The status rules (`storeStatus(id, d)`).** The worst reason decides the colour.

| Status | When |
|---|---|
| **closed** | The store is not open that day (holiday or closing day). |
| **bad** ("Act now") | Month-to-date pace < 0.90, or a cash difference of at least 5 € that is not checked. |
| **warn** ("Check") | Any of: pace < 0.95; an unchecked card-terminal difference; 2 or more overdue pickups (more than 14 days waiting) that need a call (7+ days, not called, no reminder); 6 or more lab delays; complaints open more than 14 days; low-star (3 or fewer) reviews from the last 30 days without a reply; missing clock-outs. |
| **good** | Nothing else. |

**The month-to-date pace math (`mtd(id, date)`).** Only open days count.

```js
expected  = target * elapsed / total      // target scaled to open days passed
pace      = sum / expected                // 1.0 = on track
need      = max(0, target - sum) / remaining
projected = sum / elapsed * total;  runRate = sum / elapsed
```

`ly` adds up last year's same calendar days up to the same day of the month. Day-level "vs last year" (`vsLy`) compares with `date − 364`, so the weekday is the same. `sameWeekdayAvg` averages the last 6 open days with the same weekday.

**Key functions**

| Function | Purpose |
|---|---|
| `day(id, d)` (data.js) | One store-day: revenue, mix, exams, cash |
| `attendance` / `plan` (data.js) | Shifts and clock-ins |
| `monthTarget` (data.js) | Monthly target |
| `mtd`, `sameWeekdayAvg`, `vsLy` | Comparisons |
| `storeStatus`, `storeRow` | Traffic light and table row |
| `pickups`, `labStatus` | Call list and lab delays |
| `openComplaints`, `reviewsFor`, `ratingAt` | Rating uses a binary search over cumulative counts and sums |
| `staffStats` | Hours, late arrivals, sales per hour (an estimate) |
| `ACT.cashCheck` | Modal; a note is required for diffs ≥ 5 € or a card difference |
| `ACT.call` / `ACT.reply` | Mark a customer called / a review replied |
| `ACT.newTask`, `ACT.tkToggle` | Create a task / tick it off for a store |
| `setDate(d)` | Board date, kept inside `dateBounds()` |

**Live mode (short).** The live code is the "LIVE DATA" section from about line 1182 of `app.js` (`MODEKEY`, `checkSession`, `applySession`, `lsetMode`, `lfetch`/`lget`, `PAGES_LIVE`, the `pageL*` and `lcard*` functions). The helpers `SL()`, `SBX()`, `TD()` and `VA()` choose the demo or live store list and document. Live mode only switches on for approved signed-in accounts (`SESSION.allowed`), and live work is kept in `state.live`. `MODE` starts as `'demo'`. If `/api/stores/session` is unavailable, `SESSION.failed` keeps the app demo-only.

**Shared pieces used.** `adrial-shell.js`. `adrial-sync.js` is optional (`app:'stores'`; `syncSnapshot()` replaces `live` with `emptyLive()` for accounts that are not approved). No bus.

**How to change common things**

- **Add a store:** add an entry to `STORES` in data.js (`size`, `growth`, `conv`, `quality`, `hours`, `staffN`, `baseReviews`).
- **Thresholds:** edit the conditions in `storeStatus()` and update the hint text at the end of `pageAll()`.
- **Days you can browse:** `MIN_DATE`.
- **Seeded tasks:** `initialState()`.

**Gotchas**

- The comment in `data.js` says targets are "+ 6–10 %", but `monthTarget` actually applies 3–7 %.
- Seeded tasks keep the due dates from the day the state was first created, so they slowly go overdue until you reset.
- Generated ids (`WO-…`, `RV-…`) come from the store, the date and an index, so `called` and `replied` marks survive code changes as long as the key strings and the random-number order inside each key stay the same.
- `flush()` writes `state` itself rather than a copy. IndexedDB clones it at put time.

---

# Part 4: Joiners & leavers, Contracts & renewals, Marketing calendar

All three are vanilla-JS single-page apps with no build step and no framework. Each one has an `index.html`, a `style.css`, a `data.js` that generates the demo dataset, and an `app.js` that holds the whole UI inside one IIFE. They share a few patterns:

- State is one JSON document in IndexedDB.
- Writes are debounced (250 ms) and serialised.
- Other tabs hear about saves through a `BroadcastChannel`.
- Per-viewer preferences live in `localStorage`.
- Routing uses `location.hash`.
- Clicks, changes and input events are delegated through `data-act`, `data-chg` and `data-inp` attributes.

None of the three ever sends e-mail, posts anything or changes an outside system.

---

## Joiners & leavers (`/onboarding/`)

**What it does.** Joiners & leavers tracks the checklists for people who start, leave or change role or store, across three fictional group companies (Adrial SI, Adrial HR and Vallis). Each case gets dated tasks for HR, IT, the manager, payroll, facilities and the person themself. It also keeps an asset register (laptops, phones, keys, Codeks cards) that records who holds what and what still has to come back from leavers.

### Files

| File | Lines | Role |
|---|---|---|
| `index.html` | 45 | Shell markup: sidebar, `#nav`, the "Acting as" select (`#actorSel`), `#syncPanel`, `#resetBtn`, `#main`, `#layers`, `#toast`; loads shell, sync, `data.js`, `app.js` |
| `data.js` | 596 | `window.JLData`: catalogues (companies, 14 locations, roles, teams, licences, asset types), `makeTemplates()`, `buildTasks()`, `generate(today)`, date utils |
| `app.js` | 1810 | Storage, router, every page, modals, case and asset logic, cloud sync |
| `style.css` | 492 | Styles, including a print sheet for checklists |

### How it starts

1. `index.html` loads `/_shared/adrial-shell.js` in `<head>`, then `adrial-sync.js`, `data.js` and `app.js`.
2. `app.js` sets `TODAY` from `todayYmd()`. This is the date in Europe/Ljubljana, read with `Intl.DateTimeFormat`.
3. It reads UI preferences from `localStorage` and opens `BroadcastChannel('adrial-onboarding')`.
4. `boot()` calls `idbGet()`.
   - If `validDb()` accepts the stored record, that record is used. `validDb()` checks that `version === JLData.VERSION` and that the arrays and `seq` are present.
   - Otherwise it calls `JLData.generate(TODAY)` and saves the result with `idbPut`.
   - If IndexedDB fails, `storageFailed()` switches the app to memory-only and shows a toast.
5. `ensureSchema()` fills in any missing fields. `reindex()` builds the lookups in `IX`. `onRoute()` renders the page, then `syncStart()` attaches cloud sync.
6. A 60-second `setInterval` re-renders when the date rolls over.

### Demo data

`data.js → generate(today)` uses a seeded generator, `rng(0x0B0A2D17)` (mulberry32-style). The same `today` always gives the same dataset. All dates are computed from `today`:

- **Existing staff:** 97 people across the 14 locations, with start dates 420 to 3,600 days ago. Each gets equipment through `giveNew()`. Joiner cases add 39 more people, for 136 in total.
- **Spare stock:** laptops, phones, tablets, scanners, cards and store keys, added 380 to 420 days ago, plus 3 retired laptops.
- **Finished cases:** 60 in total: 27 joiners (100 to 362 days back), 23 leavers (two of them closed with an override) and 10 changes.
- **Open cases:** 25 in total: 12 joiners, 8 leavers and 5 changes, at fixed offsets such as `[-50, 'store'] … [27, 'store']` days from today. Leaver dates are snapped to a weekday with `workday()`.
- **Task completion:** `pDone(due)` decides how likely each task is to be done already, based on how far its due date lies before today.
- **Templates:** 7 templates (`T-store`, `T-office`, `T-wh`, `T-cc`, `T-leave`, `T-move`, `T-role`).

All names are invented and all e-mails end in `@example.com`.

### How templates become dated tasks

A template item is created with `I(team, offset, required, title, text, extras)`. The extras can be `key`, `asset`, `collect`, `licence`, `onlyRoles`, `skipFor` and `naHint`.

`buildTasks(tpl, anchor, ctx)` copies each item into a task and sets `due = dueFor(anchor, offset)`:

```js
function workday(s, dir) { /* Sat/Sun → previous Friday (dir<0) or next Monday (dir>0) */ }
function dueFor(anchor, offset) { return workday(addDays(anchor, offset), offset > 0 ? 1 : -1); }
```

For example, with a start date of Monday 12.10.2026:

- offset −2 lands on Saturday 10.10 and moves back to Friday 9.10;
- offset +5 lands on Saturday 17.10 and moves forward to Monday 19.10.

Some items are marked not needed as soon as the case is created. Their status is `na`, `by` is set to `'Template rule'`, and a log line records why. This happens when:

- the role is not listed in `onlyRoles`, or
- the contract type is listed in `skipFor` (for example, agency workers skip the payroll items).

Cases keep their own copy of the tasks. Editing a template only affects new cases. When a case date is edited with "Move the due dates" ticked, `dueFor()` re-runs for the open tasks. When it is unticked, the offsets are recalculated instead.

### The blocked-leaver rule

`caseState(c)` returns `'blocked'` when all of these are true:

- the case is an open leaver case;
- `c.date < TODAY`;
- the person still holds an issued asset, **or** a required task due on or before today is still open.

`blockers(c)` lists the required tasks that are still open (for any case type) and the assets still held (for leavers only). If `blockers(c)` is not empty, "Close case" opens an override dialog. That dialog needs a reason of at least 5 characters, which is stored in `c.override = {reason, by, at}`.

Ticking a task with `collect` opens `collectDialog()`. The task is only marked done when every listed item has been returned.

### State and storage

- **IndexedDB:** database `adrial-onboarding` (v1), store `kv`, key `db`. The record holds `{version, generatedFor, seq, people, cases, assets, templates, mgrs}`.
- **localStorage:** key `adrial-onboarding-ui`, with the sections `cases`, `tasks`, `assets`, `case`, `cal` and `tpl`, plus `actor` and `team`.
- **BroadcastChannel:** `adrial-onboarding`, message `{type:'changed'}`. A receiving tab re-reads IndexedDB unless it has a save of its own pending.
- **Files:** none. This app stores no blobs.
- **Reset demo data:** regenerates the dataset for the current `TODAY`, clears the store with `idbReset()`, notifies the other tabs and calls `syncChanged()`.

### Screens and routing

`PAGES` maps the first hash segment to a page function. An unknown segment is replaced with `#/`.

| Hash | Render function | Shows |
|---|---|---|
| `#/` | `pageOverview` | KPIs, a 4-week `timeline()`, overdue tasks by team, assets to collect, `monthChart()` |
| `#/cases` | `pageCases` | Filterable, sortable case list with CSV export |
| `#/cases/<id>` | `pageCase` | Checklist grouped by team or date, equipment, activity log, `printSheet()` |
| `#/tasks[/<TEAM>]` | `pageTasks` | One team's tasks (overdue, next 7 days, all, done), with bulk actions |
| `#/assets[/register\|collect\|history]` | `pageAssets` | The asset register, items to collect, and the event history |
| `#/templates[/<id>]` | `pageTemplates` | Template editor with a live preview of the due dates |
| `#/calendar` | `pageCalendar` | Month grid of case dates and key tasks due |

### Key functions

| Function | Purpose |
|---|---|
| `generate(today)` | Builds the whole deterministic dataset |
| `makeTemplates()` | Defines the 7 default checklists |
| `buildTasks(tpl, anchor, ctx)` | Turns a template into dated tasks and applies the template rules |
| `dueFor` / `workday` | Applies the offset and moves weekend due dates |
| `boot()` / `ensureSchema()` | Loads or generates the data and fills in missing fields |
| `save()` / `flush()` / `enqueue()` | Debounced, serialised IndexedDB writes, then `announce()` and `syncChanged()` |
| `reindex()` | Builds `IX.p`, `IX.c`, `IX.a`, `IX.tpl`, `IX.openCase` and `IX.held` |
| `stats(c)` / `caseState(c)` | Progress counts and the case state (open, overdue, blocked, ready, closed, override) |
| `blockers(c)` | What prevents a case from closing cleanly |
| `tick(c, t)` | Shared tick flow. Equipment tasks open `issueDialog()` or `collectDialog()` |
| `applyDone` / `applyReopen` | Marks a task done or reopens it, including the licence assign/change/remove side effects |
| `createCase(o)` | Creates the person (for joiners) and the case number `JL-<year>-NNN`, then builds the tasks |
| `closeCase(c, reason)` | Updates the person (left, moved or active) and stores `c.prev` so the case can be reopened |
| `issueAsset` / `returnAsset` / `nextTag` | Asset register operations and the next free tag (`ADR-LT-0101`, `CDK-10407`, `KEY-LJ-01`) |
| `collectList()` | Leavers who still hold equipment |
| `onRoute()` / `rerender()` / `commit(msg)` | Routing and re-rendering. `commit` runs reindex, save, rerender and a toast |

### Shared pieces used

- **Shell:** `adrial-shell.js` (`data-pos="br"`) adds the back button and theme switch, and stores the theme in `localStorage` key `adrial-theme`.
- **Bus:** `adrial-bus.js` is not used.
- **Cloud sync (optional):** `AdrialSync.attach({app:'onboarding', getSnapshot, applySnapshot: applyCloud})` with `mountPanel('#syncPanel')`. The app works without it.

### How to change common things

- **Locations or roles:** edit `LOCATIONS` and `ROLES` in `data.js`. A store also needs a manager branch in `generate()`.
- **Default checklist items:** edit the `I(...)` lines in `makeTemplates()`. Existing browsers keep their stored templates until they reset.
- **A new page:** add an entry to `PAGES` and to the `NAV` array.
- **Force every browser to regenerate:** bump `VERSION` in `data.js`. `validDb()` then rejects the old data, and the user's changes are lost.

### Gotchas

- The data is generated once and then stored. The dates stay anchored to the day of the first load, so as days pass more tasks become overdue. "Reset demo data" re-anchors everything to today.
- "Acting as" is not a login. It only fills in `by` on ticks.
- "Mark done" in bulk skips tasks that issue or collect equipment.
- Two tabs saving at once means the last write wins. A tab with a pending save ignores incoming change messages.

---

## Contracts & renewals (`/contracts/`)

**What it does.** Contracts & renewals is a register of about 120 fictional contracts (leases, suppliers, software and so on) for an optical retailer. It works out notice deadlines, automatic renewals, price indexation and expected spend, shows them on an overview, a calendar and an in-app reminders list, and lets users attach real PDFs or photos that are stored in the browser.

### Files

| File | Lines | Role |
|---|---|---|
| `index.html` | 44 | Shell markup, hidden `#filePick` and `#csvPick` inputs; loads shell, sync, `dates.js`, `data.js`, `app.js` |
| `dates.js` | 204 | `ContractDates`: pure date and deadline rules (UMD, so it also loads in Node) |
| `data.js` | 470 | `window.ContractsData`: catalogues, the `CAT` contract catalogue, `generate(today)` |
| `app.js` | 1644 | Storage, router, pages, forms, CSV, .ics, documents, notifications, sync |
| `style.css` | 416 | Styles |
| `C:\hub\tools\tests\contracts-dates.test.js` | 154 | 26 Node unit tests for `dates.js` |

### How it starts

1. The scripts load in this order: shell, sync, `dates.js` (`window.ContractDates`), `data.js` (`window.ContractsData`), `app.js`.
2. `TODAY = todayLj()` gives today's date in Europe/Ljubljana.
3. `boot()` calls `kvGet()`. If `validDb()` rejects the result, the app calls `X.generate(TODAY)` and saves it with `kvPut`.
4. `ensureSchema()` runs next. It fills in the settings and per-category reminder windows, applies scheduled price changes whose date has passed, and flips `ending` contracts whose `endsOn` has passed to `ended`. If anything changed, it saves.
5. `reindex()`, `onRoute()` and `syncStart()` run, and `checkNotify()` is called after 2 seconds.
6. `visibilitychange` re-checks the date and re-runs `ensureSchema()`. Notifications are checked every 15 minutes.

### Demo data

`generate(today)` uses `rng(0xC0A7AC7)`. The same `today` always gives the same data.

**Contracts.** The `CAT` catalogue holds 123 contracts in 13 categories. Each catalogue entry is merged with the category's `DEFAULTS`.

**Dates.** Each entry's `plan` field places its dates relative to `today`:

| `plan` | Where the dates land |
|---|---|
| `soon` | The notice deadline falls within about 3 to 88 days |
| `later` | 95 to 420 days out |
| `locked` | The deadline has just passed, so the renewal is locked in |
| `past` | Fixed-term contracts have already ended. Open-ended ones started 200 to 2,400 days ago |
| `future` | A draft starting in 35 to 80 days |

Auto-renewing contracts get 0 to 3 past renewals in their history.

**Values.** CPI contracts get a history of yearly indexations that produces their current amount. Fixed-step contracts get an announced price step on 1 January.

**Statuses and decisions.** Contracts with a deadline in the next 90 days cycle through negotiation, renew, renegotiate, cancel and undecided decisions. Five contracts (indexes 3, 11, 19, 27 and 35) get a notice already given.

**Other fields.** Documents are names only (`demo: true`, empty `hash`). IBANs and contacts are fictional.

### Deadline rules (`dates.js`)

All dates are `'YYYY-MM-DD'` strings. They are compared as strings, and the arithmetic uses UTC.

- **`addMonths`** keeps month ends: 30.6. − 3 months = 31.3. Other days are clamped: 30.5. − 3 months = 28.2.
- **`noticeDeadline(termEnd, c)`** subtracts `noticeN` months or days. If `noticeEom` is set and the result is not a month end, it moves back to the end of the previous month.
  - 3 months before 30.6.2027 gives 31.3.2027.
  - 6 months before 31.8.2027 gives 28.2.2027.
  - 90 days before 31.12.2026 gives 2.10.2026. With `noticeEom` it gives 30.9.2026.
- **Auto-renew.** `currentTermEnd` rolls the end date forward by `renewMonths` until it reaches today. For a contract with `end` 31.12.2024, 12-month renewals and 3 months' notice:
  - on 15.9.2026, `nextDeadline` gives deadline 30.9.2026 for the term ending 31.12.2026;
  - on 7.10.2026 that deadline has passed, so the result is `locked: {deadline: 2026-09-30, termEnd: 2026-12-31}` and the next deadline is 30.9.2027. `nextRenewal` gives `{date: 2027-01-01, locked: true}`.
- **Open-ended.** `earliestOpenEnd(c, day)` sets end = day + period (rounded up to the month end with `noticeEom`) and deadline = end − period. For 30 days' notice to a month end, asked on 7.10.2026, the result is end 30.11.2026 and deadline 31.10.2026. Without `noticeEom`, 3 months' notice on 7.10.2026 gives end 7.1.2027 and deadline today.
- **Fixed term.** The deadline is `kind: 'decide'` (extend or exit). Once it has passed, the function returns `null`.
- **Notice given.** For status `ending` or `ended`, and for `draft` or `noticeN = 0`, there is no deadline. A contract with no notice period still renews. `effectiveEnd` returns `endsOn`, or else the current term end.
- **Indexation.** `indexDates` returns the anniversary dates or 1 January dates, and never any after the effective end.
- **`events(c, from, to)`** returns dated events of the types `notice`, `decide`, `renewal`, `end`, `price`, `decision`, `milestone` and `start`.

To run the tests: `node C:\hub\tools\tests\contracts-dates.test.js`.

### State and storage

- **IndexedDB:** database `adrial-contracts` (v1).
  - Store `kv`, key `db`: `{version, generatedFor, contracts, settings:{remind, cpi, handled, me}}`.
  - Store `files`, `keyPath: 'hash'`: `{hash, blob, type, name}`. `hash` is the SHA-256 of the file's bytes, from `crypto.subtle`. Accepted files are PDF, PNG, JPEG and WebP, at most 20 MB each. `gcFiles()` deletes blobs that no contract references.
- **localStorage:** `adrial-contracts-ui` holds `list`, `cal`, `spend` and `notify`. `adrial-contracts-notified` holds the reminder keys that have already been notified (capped at 400).
- **BroadcastChannel:** `adrial-contracts`.
- **Reset demo data:** runs `fileClear()`, then `kvPut()` with a freshly generated dataset.

### Screens and routing

| Hash | Render function | Shows |
|---|---|---|
| `#/` | `pageOverview` | KPIs, notice deadlines in the next 90 days, renewals and ends and price increases, value bars, housekeeping |
| `#/contracts` | `pageContracts` | Search across all fields, filters, sorting, paging (50 per page), CSV import and export |
| `#/contracts/<id>` | `pageDetail` | Alert box, key facts, `timelineCard`, `historyCard`, notes, `decisionCard`, `docsCard`, value |
| `#/calendar` | `pageCalendar` | Month grid with event-type chips and an agenda |
| `#/reminders` | `pageReminders` | Due and handled reminders, browser notifications, reminder windows |
| `#/spend` | `pageSpend` | Spend now against next year's projection, grouped by category, party, location or company |

An unknown hash renders the overview.

### Key functions

| Function | Purpose |
|---|---|
| `info(c)` | Cached `{nd, act, nr, end, annual, nextPrice}` per contract |
| `openDeadlineWanted(c)` | Tracks an open-ended deadline only with `noticeEom` and a decision of cancel or renegotiate |
| `reminders()` / `dueReminders()` | Builds reminders. Deadlines fall inside the category window; decisions and milestones are reminded 7 days ahead. Keys look like `id\|n\|date` |
| `deadlineText(c, nd)` | Human wording for a deadline |
| `amountAt` / `projectYear` / `expectedEnd` | Spend projection with indexation, scheduled changes and expected ends |
| `validate(o)` | Shared by the contract form and the CSV import |
| `contractForm(src, mode)` | Create, edit and "duplicate as template" (creates a draft) |
| `readForm` / `previewText` | Previews the deadline live while the user types |
| `attachFiles` / `sha256` / `viewDoc` / `blobFor` | Stores, hashes and shows documents |
| `importRows` / `parseCsv` / `exportList` | All-or-nothing CSV import, and CSV export |
| `openIcs()` | Downloads an `.ics` file with a `VALARM` per notice deadline |
| `checkNotify()` | Browser notifications, shown only while the app is open |
| `ACT['notice-given']` | Records that notice was given: status becomes ending, and `endsOn` and a history entry are set |

### Shared pieces used

- **Shell:** `adrial-shell.js`.
- **Bus:** not used.
- **Cloud sync (optional):** `AdrialSync.attach({app:'contracts', …, files: syncFiles})`. `syncFiles.list/has/put` move the document blobs. A document that is missing locally can be fetched with `SYNC.fetchFile(hash)`.

### How to change common things

- **A category:** add it to `CATEGORIES` (with a `remind` window in days), to `CAT` and to `DEFAULTS`.
- **A currency:** add it to `CURRENCIES` with its demo conversion rate to EUR.
- **A deadline rule:** change `dates.js`, add a test, and run the Node test file.
- **The CSV columns:** edit `IMPORT_COLS`.

### Gotchas

- The comment in the test file says to run `node C:\hub\public\contracts\test-dates.js`. That path is out of date; the file now lives in `tools\tests\`.
- Dates must be strict ISO strings, because comparisons are string comparisons.
- Every change must go through `commit()`. It clears the `info()` cache through `reindex()`.
- `ensureSchema()` changes data when it loads: it applies price changes that are due and ends contracts that have run out.
- Demo documents have no file behind them. `viewDoc()` shows a placeholder instead.
- Hashing needs a secure context (HTTPS or localhost).
- Spend projections assume fixed-term contracts are extended at the same price unless the decision is to cancel.

---

## Marketing calendar (`/marketing/`)

**What it does.** The Marketing calendar plans marketing campaigns for SI, HR and IT on a month, week or quarter calendar, with drag-to-reschedule and conflict warnings. It also has a content planner, a performance view, a budget view and a UTM link builder. In demo mode every performance number is computed on the fly from each campaign's seed, and none of it is stored.

### Files

| File | Lines | Role |
|---|---|---|
| `index.html` | 52 | Static sidebar nav, `#modeSide`, `#syncSide`, `#resetBtn`, Ctrl+K search, `#main`, `#layer` |
| `data.js` | 596 | `window.MKTDATA`: catalogues, `keyDates()`, `generate()`, `perfFor()` and helpers |
| `app.js` | 2822 | Storage, router, views, drag and drop, editors, budget, UTM, live mode, sync |
| `style.css` | 564 | Styles |

### How it starts

1. Scripts load: shell, sync, `data.js`, `app.js`. `TODAY_YMD` comes from `MKTDATA.todayLj()`; `ui` is `UIDEF` merged with `localStorage`.
2. `Promise.all([loadPlans(), checkSession()])` runs. `loadPlans()` reads IndexedDB keys `data` (demo) and `live`. With no valid demo plan it saves `migrate(D.generate(TODAY_YMD))` with `silentNext`, so fresh demo data is not uploaded to sync. A missing live plan becomes `emptyLivePlan()`.
3. `boot()` sets `MODE = wantMode()` (demo unless live is allowed) and `db = plans[MODE]`, then runs `renderModeUi()`, `updateNav()`, `route(false)` and `attachSync()`.

### Demo data

**Seed.** `generate(todayYmd)` uses `mulberry32(SEED)` with `SEED = 20261007`. The same day always gives the same plan.

**Range.** The plan runs from the first day of the month 12 months back to the last day of the month 3 months ahead (`range.from` / `range.to`).

**Campaigns.** Each month adds its seasonal campaigns (winter sale, Valentine's, summer sunglasses, Black Friday, and so on), a newsletter per market, a lens-reorder push and an influencer collaboration in a rotating market, and PR every other month. **Statuses** (done, live, production, planned, idea, a few cancelled) follow from the dates. **Content** is at least 300 posts and sends, topped up with evergreen posts. **Budgets** are set per year per market. For 8.10.2026 the plan has 148 campaigns and 333 content items.

**Key dates** (holidays, retail days, school holidays, seasons) come from `keyDatesYear()`. They are computed, never stored.

### Generated performance numbers

`perfFor(c, today)` returns daily rows `{d, ch, imp, clk, sp, ses, ord, rev, nc}` for each channel, from the start date up to the day before today. It only produces rows for the statuses `production`, `live` and `done`.

- **`planSplit(c)`.** E-mail and SMS sending costs come off the top of the budget (send days × list size × unit cost). The rest is split by channel weight `w`.
- **`campFactors(c)`.** Turns the seed into a quality factor `q` and a pacing factor `pf`. About 13% of campaigns flop, about 14% are strong, and about 9% overspend.
- **Daily noise.** `h01(seed, channel, day, salt)` is a stateless hash. Rows are reproducible without storing them.
- **Seasonality and weekdays.** `seasonFactor()` applies the month and Black Friday spikes (×2.2 on the day). Orders are lower at weekends.
- **Channel kinds:** `cpc` (spend → clicks → impressions → sessions), `fee` (per-thousand price), `broadcast` (weekdays only), `list` (send days only; newsletters on Tuesday and Thursday), `reach` (organic) and `store` (footfall).
- **Diminishing returns.** The conversion rate is multiplied by `min(1.25, (140/spend)^0.2)`.
- **Rounding.** Orders are rounded stochastically.

The app caches the rows in `perfCache`, keyed by `perfSig(c)`. Changing the dates, budget, channels or status changes the numbers.

`incremental(c)` compares average daily market revenue (baseline plus 70% of campaign revenue) during the campaign with the 28 days before; it feeds the "What worked" verdict.

### State and storage

- **IndexedDB:** database `adrial-marketing` (v1).
  - Store `kv`: key `data` holds the demo plan; key `live` holds the live plan.
  - Store `files`: creatives keyed by their SHA-256 hex, `{hash, blob, type}`. Accepted files are PNG, JPEG, WebP, GIF and PDF, at most 10 MB each. Both plans share this store.
- **localStorage:** `adrial-marketing-ui` holds `f`, `cal`, `list`, `content`, `perf`, `budget`, `lperf`, `lbudget` and `utm`. `adrial-marketing-mode` holds the mode choice.
- **BroadcastChannel:** `adrial-marketing`, message `{type:'changed', from: TAB_ID}`. `syncFromIdb()` waits while a modal or a drag is open.
- **Reset demo data** (`resetDemo()`): regenerates only `plans.demo` and deletes file blobs that neither plan uses. The button is hidden in live mode.

### Screens and routing

| Hash | Render function | Shows |
|---|---|---|
| `#/` (also `#/calendar`) | `viewCalendar` → `monthHtml` / `weekHtml` / `ganttHtml` | Calendar with lanes, key dates, filters, conflicts |
| `#/campaigns` | `viewCampaigns` | Sortable list, CSV, .ics |
| `#/c/<id>` | `viewCampaign` | Plan, results against targets, posts, checklist, creatives, notes, comments |
| `#/content` | `viewContent` | Kanban board or list of posts, quick add, bulk actions |
| `#/performance` | `viewPerformance` | KPIs against the previous period, monthly chart, breakdowns, "What worked" |
| `#/budget` | `viewBudget` | Annual budgets per market, planned against spent, warnings |
| `#/utm[/<id>]` | `viewUtm` | UTM builder |

Any other hash renders `viewMissing()`.

### Calendar drag and resize

Each bar is a `.bar[data-cid]` button with `.hd[data-h="start"|"end"]` handles.

- `pointerdown` starts `drag` in `move`, `start` or `end` mode. Touch on the middle of a bar is left to scroll the page.
- After 6 px of movement, `dayAt(x, y)` maps the pointer to a day (pixels per day in the Gantt view, column width in week rows), and `previewDrag()` shows the target days and a tooltip.
- `endDrag()` calls `setDates()`, which commits and offers Undo. Escape cancels.
- Keyboard: ←/→ moves a bar a day; Shift+←/→ changes its end.
- `laneAssign()` packs bars into lanes; `lanePrio()` puts big promotions first and newsletters last.

### Conflict detection

`conflicts()` checks every pair of non-cancelled campaigns that overlap in dates and in market (`mOverlap`: the same market, or one of them is `ALL`). There are two kinds:

- **`big`:** both campaigns have a type with `big: true` (seasonal sale, Black Friday, back to school, summer sunglasses).
- **`stack`:** one is a `sale` type with a code and the other also has a code and is not big, so the discounts may stack.

Results are cached per `dataRev`. They appear as bar warnings, a banner on the campaign page, and a count in the nav.

### UTM builder

`utmCampaign(c)` builds `yyyy-mm_market_type[_code]`, at most 60 characters. For example: `2026-11_si_black-friday_bf50`.

- `utmPreset(chId)` fills source and medium from `CHANNELS[].utm`.
- `utmIssues()` checks the required fields, capitals, spaces and accents, that the medium is in `MEDIUMS`, the naming pattern, and the landing URL.
- `buildUtm()` replaces any existing `utm_*` parameters using `URL.searchParams`.
- "Save to campaign" adds the link to `c.utms` and ticks `checklist.tracking`.

### Key functions

| Function | Purpose |
|---|---|
| `generate` / `perfFor` / `planSplit` | Demo plan and derived numbers (`data.js`) |
| `loadPlans` / `migrate` | Loads both plans and fills in missing fields |
| `save` / `flush` | Debounced writes per plan key |
| `perf(c)` / `derive` | Cached performance and derived metrics |
| `calRange` / `weekRow` / `ganttHtml` | Calendar layout |
| `setDates` | Applies a drag or keyboard move, with Undo |
| `campaignEditor` / `duplicateDialog` / `postEditor` | Editors. Duplicate can align to next year's Black Friday |
| `movePosts` | Board drag and bulk status, date and assignee changes |
| `budgetModel` / `budgetWarnings` | Spreads budgets by `MONTH_W`, works out the forecast, and flags overspend and pacing |
| `addFiles` / `getFileBlob` | Stores creatives by hash, and fetches them from sync when missing locally |
| `utmCampaign` / `utmIssues` / `buildUtm` | UTM builder |

### Live mode (short)

The live-mode code sits in `app.js` from the "Live data (approved accounts only)" section onwards, starting at `checkSession`, `applyMode` and `renderModeUi`, through to `viewLivePerformance` and `viewLiveBudget`.

At start-up, `checkSession()` asks whether the signed-in account is on the approved list. `wantMode()` returns `'live'` only when that check says `allowed` and `adrial-marketing-mode` is not `'demo'`. In every other case the app runs in demo mode and `perf()` uses `MKTDATA.perfFor`.

The two plans are stored separately: IndexedDB key `data` for demo and `live` for live. The sync snapshot `{version: 2, demo, live}` includes the live plan only for the approved account that is signed in.

### Shared pieces used

- **Shell:** `adrial-shell.js`.
- **Bus:** not used.
- **Cloud sync (optional):** `AdrialSync.attach({app:'marketing', getSnapshot: snapshot, applySnapshot: applyCloud, files: syncFiles})`, mounted in `#syncSide`. `applyCloud()` also accepts the older version-1 snapshots, which contain only the demo plan.

### How to change common things

- **A channel:** add it to `CHANNELS` with `kind`, `w`, its rates and `utm`.
- **A campaign type:** add it to `TYPES`. Set `big`/`sale` to control conflicts and `roas` for the targets.
- **The seasonal plan:** edit the `m === …` blocks in `generate()`.
- **Holidays:** edit `keyDatesYear()`.
- **UTM rules:** edit `MEDIUMS` and the regular expression in `utmIssues()`.
- **The cross-market budget split:** edit `ALL_SPLIT`.

### Gotchas

- `TODAY_YMD` is fixed when the page loads, so the app does not notice a date rollover.
- Day numbers count UTC days, and `dow()` treats 0 as **Monday**, unlike JavaScript's `getDay()`.
- A new campaign gets a random `seed` (`strHash(name + Date.now())`), so its demo numbers cannot be predicted until it exists.
- The type `other` is never generated. It exists only for live imports.
- `refresh()` does nothing while a drag is in progress.
