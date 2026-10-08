/* Webshop conversion health (Adrial Apps): LIVE data only, for allow-listed accounts (see /webshop.js).
 *
 * Pages read /api/webshop/* (daily GA4 aggregates in BigQuery dataset webshop_app). There is no demo data:
 * without access the app shows what it does and a sign-in. Live numbers live only in memory (never in
 * localStorage / IndexedDB / the sync snapshot); a 401/403 at any point drops them and returns to the
 * access page. Only the filter choices (shop, device, period, compare mode) are remembered in this browser. */
(function () {
  'use strict';

  const API = '/api/webshop/';
  const FKEY = 'adrial-webshop-filters';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const NF0 = new Intl.NumberFormat('sl-SI', { maximumFractionDigits: 0 });
  const NF1 = new Intl.NumberFormat('sl-SI', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const NF2 = new Intl.NumberFormat('sl-SI', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fin = (x) => x != null && isFinite(x);
  const num = (n) => (fin(n) ? NF0.format(n) : '–');
  const eur = (n) => (fin(n) ? NF0.format(n) + ' €' : '–');
  const eur2 = (n) => (fin(n) ? NF2.format(n) + ' €' : '–');
  const pct = (x, d) => (fin(x) ? (d === 2 ? NF2 : NF1).format(x * 100) + ' %' : '–');
  const div = (a, b) => (b ? a / b : null);
  const DAY = 864e5;
  const isoD = (d) => d.toISOString().slice(0, 10);
  const addDays = (s, n) => isoD(new Date(Date.parse(s + 'T00:00:00Z') + n * DAY));
  const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY) + 1;
  const fmtDate = (s) => (s ? new Date(s + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '–');
  const fmtShort = (s) => new Date(s + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

  const ICON = {
    overview: '<path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/>',
    categories: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
    devices: '<rect x="2" y="5" width="13" height="10" rx="1.5"/><path d="M6 19h5"/><rect x="17" y="8" width="5" height="11" rx="1.2"/>',
    landing: '<path d="M4 4h16v16H4z"/><path d="M4 9h16M9 9v11"/>',
    browsers: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>',
    promotions: '<path d="M4 10v4l11 5V5L4 10z"/><path d="M15 9a3 3 0 0 1 0 6M7 15l1 5h3l-1-4"/>',
    checks: '<path d="M9 12l2 2 4-4"/><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z"/>',
  };
  const PAGES = [
    { id: 'overview', title: 'Overview', h: 'Shops at a glance', sub: 'Sessions, conversion and revenue per session per shop, the funnel, and the change against the previous period and last year.' },
    { id: 'categories', title: 'Funnel by category', h: 'Funnel by category', sub: 'Item views, add-to-carts, checkouts and purchases per product category. GA4 does not split item metrics by device, so this page always covers all devices.' },
    { id: 'devices', title: 'Mobile vs desktop', h: 'Mobile vs desktop', sub: 'Conversion and funnel steps per device and shop. Desktop is shown with and without purchases that GA4 received without a browser session.' },
    { id: 'landing', title: 'Landing pages', h: 'Landing pages', sub: 'Entry pages with traffic but no sales, and the biggest drops against the comparison period. Landing pages are counted in whole weeks (Monday to Sunday).' },
    { id: 'browsers', title: 'Browsers & devices', h: 'Browsers & devices', sub: 'Browser and operating-system combinations whose conversion is far from their shop and device average: a list of things that may be broken.' },
    { id: 'promotions', title: 'Promotions', h: 'Promotions', sub: 'Banner and upsell promotions: views, clicks, click-through rate and what they sold.' },
    { id: 'checks', title: 'Data checks', h: 'Data checks', sub: 'Tracking problems that bend the numbers: purchases without sessions, inflated item views, refunds sent as purchases, duplicates.' },
  ];
  const DEVICE_LABEL = { '': 'All devices', mobile: 'Mobile', desktop: 'Desktop', tablet: 'Tablet' };

  // ── state (live numbers only in memory) ─────────────────────────────────
  let SESSION = { checked: false, failed: false, signedIn: false, allowed: false, email: null };
  let META = null;
  let DATA = new Map();
  let renderSeq = 0;
  const ui = { sort: {}, open: {}, show: {}, q: {}, minS: 100, flagged: true };
  const F = loadFilters();

  function loadFilters() {
    const d = { shop: '', device: '', preset: '28', from: '', to: '', compare: 'prev' };
    try { const s = JSON.parse(localStorage.getItem(FKEY) || '{}'); for (const k of Object.keys(d)) if (typeof s[k] === 'string') d[k] = s[k]; } catch (e) {}
    return d;
  }
  function saveFilters() { try { localStorage.setItem(FKEY, JSON.stringify(F)); } catch (e) {} }
  function forgetLive() { DATA = new Map(); META = null; }

  function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 3200); }

  // ── API ─────────────────────────────────────────────────────────────────
  class ApiError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
  async function api(route, params) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params || {})) if (v !== '' && v != null) qs.set(k, v);
    const url = API + route + (qs.toString() ? '?' + qs : '');
    if (DATA.has(url)) return DATA.get(url);
    let r;
    try { r = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } }); } catch (e) { throw new ApiError(0, 'Could not reach the server. Check your connection.'); }
    let j = null;
    try { j = await r.json(); } catch (e) {}
    if (r.status === 401 || r.status === 403) { denied(r.status); throw new ApiError(r.status, (j && j.error) || 'No access'); }
    if (!r.ok) throw new ApiError(r.status, (j && j.error) || 'The webshop data is unavailable right now.');
    DATA.set(url, j);
    return j;
  }
  function denied(code) {
    forgetLive();
    SESSION.allowed = false;
    if (code === 401) SESSION.signedIn = false;
    toast(code === 401 ? 'Your sign-in has ended. Live data is hidden.' : 'This account no longer has access to live webshop data.');
    render();
    checkSession();
  }
  async function checkSession() {
    try {
      const r = await fetch(API + 'session', { credentials: 'same-origin' });
      const j = await r.json();
      const was = SESSION.allowed;
      SESSION = { checked: true, failed: false, signedIn: !!j.signedIn, allowed: !!j.allowed, email: j.email || null };
      if (!SESSION.allowed) forgetLive();
      if (was !== SESSION.allowed || !was) render();
    } catch (e) {
      SESSION = { checked: true, failed: true, signedIn: false, allowed: false, email: null };
      forgetLive();
      render();
    }
  }
  function signIn() { if (window.AdrialSync && window.AdrialSync.signIn) window.AdrialSync.signIn(); else toast('Sign-in is not available on this server.'); }

  // ── filters ─────────────────────────────────────────────────────────────
  function win() {
    const through = (META && META.dataThrough) || addDays(isoD(new Date()), -1);
    const first = (META && META.dataFrom) || addDays(through, -400);
    let from, to;
    if (F.preset === 'custom' && F.from && F.to) { from = F.from; to = F.to; } else {
      const n = F.preset === 'mtd' ? null : +F.preset || 28;
      to = through;
      from = n ? addDays(to, -(n - 1)) : to.slice(0, 8) + '01';
    }
    if (from < first) from = first;
    if (to > through) to = through;
    if (from > to) from = to;
    return { from, to };
  }
  function params(extra) { const w = win(); return Object.assign({ from: w.from, to: w.to, shop: F.shop, device: F.device, compare: F.compare }, extra || {}); }
  const shopLabel = (s) => { const x = META && META.shops.find((m) => m.shop === s); return x ? x.label : s; };
  const shopMarket = (s) => { const x = META && META.shops.find((m) => m.shop === s); return x ? x.market : ''; };
  const cmpName = (mode) => (mode === 'yoy' ? 'last year' : 'previous period');

  function renderFilters() {
    const el = $('filters');
    if (!SESSION.allowed || !META) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    const w = win();
    const seg = (key, opts) => '<div class="seg" role="group">' + opts.map(([v, l]) => '<button type="button" data-act="f" data-k="' + key + '" data-v="' + v + '" aria-pressed="' + (F[key] === v) + '">' + l + '</button>').join('') + '</div>';
    const g = (a) => (a && a.updated_at ? new Date(a.updated_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
    const ga = META.freshness.find((f) => f.source === 'GA4 load'), rb = META.freshness.find((f) => f.source === 'Summary rebuilt');
    el.innerHTML =
      '<div class="f"><label for="fShop">Shop</label><select class="select" id="fShop" data-act="fsel" data-k="shop"><option value="">All shops</option>' +
        META.shops.map((s) => '<option value="' + esc(s.shop) + '"' + (F.shop === s.shop ? ' selected' : '') + '>' + esc(s.label) + ' · ' + esc(s.market) + '</option>').join('') + '</select></div>' +
      '<div class="f"><label for="fDev">Device</label><select class="select" id="fDev" data-act="fsel" data-k="device">' +
        Object.entries(DEVICE_LABEL).map(([v, l]) => '<option value="' + v + '"' + (F.device === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></div>' +
      '<div class="f wide"><span class="label" id="lPer">Period</span>' + seg('preset', [['7', '7 days'], ['28', '28 days'], ['90', '90 days'], ['mtd', 'Month to date'], ['custom', 'Custom']]) + '</div>' +
      '<div class="f"><label for="fFrom">From</label><input class="date" type="date" id="fFrom" data-act="fdate" data-k="from" value="' + w.from + '" min="' + esc(META.dataFrom || '') + '" max="' + esc(META.dataThrough || '') + '"></div>' +
      '<div class="f"><label for="fTo">To</label><input class="date" type="date" id="fTo" data-act="fdate" data-k="to" value="' + w.to + '" min="' + esc(META.dataFrom || '') + '" max="' + esc(META.dataThrough || '') + '"></div>' +
      '<div class="f wide"><span class="label">Compare with</span>' + seg('compare', [['prev', 'Previous period'], ['yoy', 'Last year']]) + '</div>' +
      '<div class="fresh">GA4 data through ' + fmtDate(META.dataThrough) + (ga && ga.updated_at ? ' · GA4 loaded ' + g(ga) : '') + (rb && rb.updated_at ? ' · summary rebuilt ' + g(rb) : '') +
        ' · kept from ' + fmtDate(META.dataFrom) + ' · ' + daysBetween(w.from, w.to) + ' days selected</div>';
  }

  // ── small render helpers ────────────────────────────────────────────────
  function delta(cur, cmp, kind, opts) {
    opts = opts || {};
    if (!fin(cur) || !fin(cmp) || (kind !== 'pp' && !cmp)) return '<span class="dl muted"><i></i>' + (opts.label ? esc(opts.label) + ' ' : '') + 'n/a</span>';
    const d = kind === 'pp' ? (cur - cmp) * 100 : (cur / cmp - 1) * 100;
    const up = d > 0.05, dn = d < -0.05;
    const good = opts.invert ? dn : up, badd = opts.invert ? up : dn;
    const txt = (d > 0 ? '+' : d < 0 ? '−' : '±') + NF1.format(Math.abs(d)) + (kind === 'pp' ? ' pp' : ' %');
    return '<span class="dl ' + (good ? 'good' : badd ? 'bad' : '') + '"><i></i>' + (opts.label ? esc(opts.label) + ' ' : '') + txt + '</span>';
  }
  const deltaCsv = (cur, cmp, kind) => (!fin(cur) || !fin(cmp) || (kind !== 'pp' && !cmp) ? '' : kind === 'pp' ? +((cur - cmp) * 100).toFixed(2) : +((cur / cmp - 1) * 100).toFixed(1));
  function coverage(cmp) {
    const first = META && META.dataFrom;
    if (!first || !cmp) return 'full';
    if (cmp.to < first) return 'none';
    if (cmp.from < first) return 'partial';
    return 'full';
  }
  function covNote(resp, label) {
    const c = coverage(resp.compare);
    const range = fmtDate(resp.compare.from) + ' – ' + fmtDate(resp.compare.to);
    if (c === 'none') return '<p class="callout">No ' + esc(label || cmpName(resp.compare.mode)) + ' to compare with: the summary keeps 13 months (from ' + fmtDate(META.dataFrom) + ').</p>';
    if (c === 'partial') return '<p class="callout">The ' + esc(label || cmpName(resp.compare.mode)) + ' (' + range + ') starts before the kept data (' + fmtDate(META.dataFrom) + '), so it is only partly covered.</p>';
    return '';
  }

  function sum(rows, keys) {
    const o = {};
    for (const k of keys) o[k] = 0;
    for (const r of rows) for (const k of keys) o[k] += +r[k] || 0;
    return o;
  }
  const TOT_KEYS = ['sessions', 'engaged_sessions', 'new_users', 'page_views', 'transactions', 'revenue', 'untracked_sessions', 'untracked_transactions', 'untracked_revenue',
    'ev_session_start', 'ev_view_item', 'view_item_users', 'ev_view_cart', 'ev_add_to_cart', 'ev_begin_checkout', 'ev_add_shipping_info', 'ev_add_payment_info', 'ev_purchase'];
  function metrics(t) {
    return Object.assign({}, t, {
      conv: div(t.transactions, t.sessions),
      tracked_conv: div(t.transactions - t.untracked_transactions, t.sessions - t.untracked_sessions),
      rps: div(t.revenue, t.sessions),
      aov: div(t.revenue, t.transactions),
      untracked_share: div(t.untracked_transactions, t.transactions),
      views_per_session: div(t.ev_view_item, t.sessions),
      atc_rate: div(t.ev_add_to_cart, t.sessions),
      checkout_per_atc: div(t.ev_begin_checkout, t.ev_add_to_cart),
      purchase_per_checkout: div(t.transactions, t.ev_begin_checkout),
    });
  }
  function totalsOf(rows, period, pred) { return metrics(sum(rows.filter((r) => r.period === period && (!pred || pred(r))), TOT_KEYS)); }

  // generic sortable table: cols [{k,label,num,v(row)->sort value,html(row),csv(row)}]
  function table(id, cols, rows, opts) {
    opts = opts || {};
    const s = ui.sort[id] || opts.sort || { k: cols.find((c) => c.num) ? cols.find((c) => c.num).k : cols[0].k, dir: -1 };
    const col = cols.find((c) => c.k === s.k) || cols[0];
    const val = (r, c) => (c.v ? c.v(r) : r[c.k]);
    const sorted = rows.slice().sort((a, b) => {
      const x = val(a, col), y = val(b, col);
      if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
      return (typeof x === 'string' ? x.localeCompare(y) : x - y) * s.dir;
    });
    const limit = opts.limit && !ui.show[id] ? opts.limit : Infinity;
    const shown = sorted.slice(0, limit);
    TABLES[id] = { cols, rows: sorted, name: opts.csv || id };
    const th = cols.map((c) => {
      const on = c.k === s.k;
      return '<th scope="col" class="' + (c.num ? 'num' : '') + '"' + (on ? ' aria-sort="' + (s.dir > 0 ? 'ascending' : 'descending') + '"' : '') +
        '><button type="button" data-act="sort" data-t="' + id + '" data-k="' + c.k + '">' + esc(c.label) + (on ? (s.dir > 0 ? ' ↑' : ' ↓') : '') + '</button></th>';
    }).join('');
    const body = shown.length ? shown.map((r) => '<tr>' + cols.map((c) => '<td class="' + (c.num ? 'num' : c.cls || '') + '">' + (c.html ? c.html(r) : esc(r[c.k])) + '</td>').join('') + '</tr>').join('')
      : '<tr><td colspan="' + cols.length + '" class="empty">' + esc(opts.empty || 'Nothing to show for this selection.') + '</td></tr>';
    return '<div class="tw' + (opts.tall ? ' tall' : '') + '"><table class="t"><caption class="sr">' + esc(opts.caption || id) + '</caption><thead><tr>' + th + '</tr></thead><tbody>' + body + '</tbody>' + (opts.foot || '') + '</table></div>' +
      (sorted.length > shown.length ? '<div class="more">Showing ' + num(shown.length) + ' of ' + num(sorted.length) + ' · <button type="button" class="btn sm" data-act="showall" data-t="' + id + '">Show all</button></div>' : '');
  }
  const TABLES = {};
  const csvBtn = (id, label) => '<button type="button" class="btn sm" data-act="csv" data-t="' + id + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>' + esc(label || 'CSV') + '</button>';
  function csvCell(v) {
    if (v == null) v = '';
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(v)) v = "'" + v;
    v = String(v);
    return /[",;\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  function downloadCsv(id) {
    const t = TABLES[id];
    if (!t) return;
    const cols = t.cols.filter((c) => c.csv !== false);
    const head = cols.map((c) => c.csvLabel || c.label);
    const rows = t.rows.map((r) => cols.map((c) => (typeof c.csv === 'function' ? c.csv(r) : c.v ? c.v(r) : r[c.k])).map((v) => (typeof v === 'number' ? +v.toFixed(4) : v)));
    const w = win();
    const s = '﻿' + [head].concat(rows).map((r) => r.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([s], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'webshop-' + t.name + '-' + w.from + '_' + w.to + '.csv';
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
    toast('Exported ' + num(rows.length) + ' rows to ' + a.download + ' (downloaded only, nothing is sent)');
  }
  const card = (title, desc, body, acts) => '<section class="card"><div class="card-h"><div><h2>' + esc(title) + '</h2>' + (desc ? '<p>' + desc + '</p>' : '') + '</div>' + (acts ? '<div class="acts">' + acts + '</div>' : '') + '</div><div class="card-b">' + body + '</div></section>';
  const shopCell = (r) => esc(shopLabel(r.shop)) + '<small>' + esc(shopMarket(r.shop)) + '</small>';
  const badge = (cls, t, title) => '<span class="badge ' + cls + '"' + (title ? ' title="' + esc(title) + '"' : '') + '>' + esc(t) + '</span>';

  // ── data notes (no numbers in this file: the site is public; numbers come from the live API) ──
  function notesHtml(open, extra) {
    return '<details class="notes"' + (open ? ' open' : '') + '><summary>Data notes: read these before trusting a number</summary><ul>' +
      '<li><b>Desktop conversion looks inflated (often 20–28 %).</b> GA4 receives many purchases without a browser session (browser “(not set)”, channel “Unassigned”), almost all on desktop. They count as orders but bring no session. Where it matters, the app shows desktop conversion with and without them (“tracked”).</li>' +
      '<li><b>Item views are inflated on desktop</b> (sharply since June 2026): far more view_item events per session than on mobile, and more viewing users than sessions. It looks like automated traffic or a tag that fires too often. Rates that start from item views (above all frames and sunglasses) are understated; use add-to-cart → purchase instead.</li>' +
      '<li><b>alensa.hr and alensa.si</b> show many frame and sunglass views but almost no purchases. Most of those views come from the same desktop pattern, so their view-based conversion is not meaningful.</li>' +
      '<li><b>No device split for categories</b>: GA4 does not combine item metrics with device, so the category funnel always covers all devices.</li>' +
      '<li><b>Funnel steps are event counts</b> (a shopper can add to cart several times), shown per 100 sessions; purchases are GA4 transactions. Shipping and payment-info events fire several times per checkout, so they are left out of the funnel.</li>' +
      (extra || '') + '</ul></details>';
  }

  // ── gate (no access) ────────────────────────────────────────────────────
  function gateHtml() {
    let box;
    if (!SESSION.checked) box = '<p class="loading" role="status"><i aria-hidden="true"></i>Checking your access…</p>';
    else if (SESSION.failed) box = '<div class="box"><p>Could not check your access right now. The server may be restarting or you are offline.</p><button type="button" class="btn pri" data-act="recheck">Try again</button></div>';
    else if (!SESSION.signedIn) box = '<div class="box"><p><b>Live data for approved accounts — sign in.</b> Your Adrial Apps account must be on the list for this app.</p><button type="button" class="btn pri" data-act="signin">Sign in</button></div>';
    else box = '<div class="box"><p>Signed in as <b>' + esc(SESSION.email) + '</b>, but <b>your account is not on the list</b> for live webshop data. Ask Simon to add it, or sign in with another account.</p><button type="button" class="btn" data-act="signin">Switch account</button></div>';
    return '<div class="gate"><span class="eyebrow">Adrial Apps · e-commerce & UX</span><h1 tabindex="-1">Webshop conversion health</h1>' +
      '<p class="lead">How shoppers behave on our webshops (adrialenti.it, adrialece.hr, moje-lece.si, alensa.hr, alensa.si): where they drop off, by shop, device, product category and landing page, and what looks broken. Built every morning from Google Analytics 4. Ad spend is in Ads & Return.</p>' +
      '<ul><li>Overview per shop: sessions, conversion, revenue per session and the funnel, against the previous period and last year.</li>' +
      '<li>Funnel by category: contact lenses vs frames vs sunglasses and more.</li>' +
      '<li>The mobile vs desktop gap per shop.</li><li>Landing pages with traffic but no sales, and the biggest drops.</li>' +
      '<li>Browsers and devices with abnormal conversion: a possible breakage list.</li><li>Promotions, and the data checks that bend the numbers.</li></ul>' + box + '</div>';
  }

  // ── chart: sessions (bars) + conversion (line) per day ──────────────────
  function dailyChart(days) {
    if (days.length < 2) return '<p class="empty">Pick at least two days to see the daily chart.</p>';
    const W = 800, H = 220, L = 46, R = 46, T = 12, B = 26, iw = W - L - R, ih = H - T - B;
    const maxS = Math.max(1, ...days.map((d) => d.sessions));
    const convs = days.map((d) => div(d.transactions, d.sessions) || 0);
    const maxC = Math.max(0.0001, ...convs) * 1.1;
    const bw = iw / days.length;
    const x = (i) => L + i * bw + bw / 2;
    const bars = days.map((d, i) => '<rect x="' + (L + i * bw + bw * 0.15).toFixed(1) + '" y="' + (T + ih - (d.sessions / maxS) * ih).toFixed(1) + '" width="' + Math.max(1, bw * 0.7).toFixed(1) + '" height="' + ((d.sessions / maxS) * ih).toFixed(1) + '"><title>' +
      esc(fmtDate(d.date) + ': ' + num(d.sessions) + ' sessions, ' + num(d.transactions) + ' orders, conversion ' + pct(div(d.transactions, d.sessions), 2)) + '</title></rect>').join('');
    const line = convs.map((c, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + (T + ih - (c / maxC) * ih).toFixed(1)).join(' ');
    const step = Math.ceil(days.length / 8);
    const ticks = days.map((d, i) => (i % step === 0 ? '<text class="tick" x="' + x(i).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle">' + esc(fmtShort(d.date)) + '</text>' : '')).join('');
    const grid = [0, 0.5, 1].map((f) => '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + (T + ih - f * ih) + '" y2="' + (T + ih - f * ih) + '"/>' +
      '<text class="tick" x="' + (L - 6) + '" y="' + (T + ih - f * ih + 3) + '" text-anchor="end">' + esc(num(maxS * f)) + '</text>' +
      '<text class="tick" x="' + (W - R + 6) + '" y="' + (T + ih - f * ih + 3) + '">' + esc(pct(maxC * f)) + '</text>').join('');
    const tot = days.reduce((a, d) => ({ s: a.s + d.sessions, t: a.t + d.transactions }), { s: 0, t: 0 });
    return '<div class="legend"><span><i class="c3"></i>Sessions (left)</span><span><i></i>Conversion (right)</span></div>' +
      '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc('Daily sessions and conversion, ' + days.length + ' days, ' + num(tot.s) + ' sessions, average conversion ' + pct(div(tot.t, tot.s), 2)) + '">' +
      grid + '<g class="bars">' + bars + '</g><path class="line" d="' + line + '"/>' + ticks + '</svg>';
  }

  // ── pages ───────────────────────────────────────────────────────────────
  async function pageOverview() {
    const [a, b] = await Promise.all([api('overview', params({ compare: 'prev' })), api('overview', params({ compare: 'yoy' }))]);
    const dev = F.device;
    const pred = (r) => !dev || r.device === dev;
    const cur = totalsOf(a.totals, 'cur', pred), prev = totalsOf(a.totals, 'cmp', pred), ly = totalsOf(b.totals, 'cmp', pred);
    const ok = (resp) => coverage(resp.compare) !== 'none';
    const pv = ok(a) ? prev : {}, lv = ok(b) ? ly : {};
    const kpi = (label, key, fmt, kind, invert) => '<div class="kpi"><span class="label">' + esc(label) + '</span><span class="v">' + fmt(cur[key]) + '</span><span class="d">' +
      delta(cur[key], pv[key], kind, { label: 'vs prev', invert }) + delta(cur[key], lv[key], kind, { label: 'vs LY', invert }) + '</span></div>';
    let html = notesHtml(false) + covNote(a, 'previous period') + covNote(b, 'last year') +
      '<div class="kpis">' + kpi('Sessions', 'sessions', num, 'rel') + kpi('Orders', 'transactions', num, 'rel') + kpi('Conversion', 'conv', (v) => pct(v, 2), 'pp') +
      kpi('Revenue / session', 'rps', eur2, 'rel') + kpi('Revenue', 'revenue', eur, 'rel') + kpi('Avg order', 'aov', eur2, 'rel') + '</div>';

    // per shop
    const shops = META.shops.map((s) => s.shop).filter((s) => !F.shop || s === F.shop);
    const rows = shops.map((s) => {
      const p2 = (r) => r.shop === s && pred(r);
      const c = totalsOf(a.totals, 'cur', p2), p = ok(a) ? totalsOf(a.totals, 'cmp', p2) : {}, l = ok(b) ? totalsOf(b.totals, 'cmp', p2) : {};
      return { shop: s, c, p, l };
    });
    const shopCols = [
      { k: 'shop', label: 'Shop', html: shopCell, v: (r) => shopLabel(r.shop), cls: 'name' },
      { k: 'sessions', label: 'Sessions', num: true, v: (r) => r.c.sessions, html: (r) => num(r.c.sessions) + '<small>' + delta(r.c.sessions, r.p.sessions, 'rel', { label: 'P' }) + ' ' + delta(r.c.sessions, r.l.sessions, 'rel', { label: 'LY' }) + '</small>' },
      { k: 'conv', label: 'Conversion', num: true, v: (r) => r.c.conv, html: (r) => pct(r.c.conv, 2) + '<small>' + delta(r.c.conv, r.p.conv, 'pp', { label: 'P' }) + ' ' + delta(r.c.conv, r.l.conv, 'pp', { label: 'LY' }) + '</small>' },
      { k: 'tracked', label: 'Tracked conv.', num: true, v: (r) => r.c.tracked_conv, html: (r) => pct(r.c.tracked_conv, 2) + '<small>without sessionless</small>' },
      { k: 'rps', label: 'Rev / session', num: true, v: (r) => r.c.rps, html: (r) => eur2(r.c.rps) + '<small>' + delta(r.c.rps, r.p.rps, 'rel', { label: 'P' }) + ' ' + delta(r.c.rps, r.l.rps, 'rel', { label: 'LY' }) + '</small>' },
      { k: 'revenue', label: 'Revenue', num: true, v: (r) => r.c.revenue, html: (r) => eur(r.c.revenue) + '<small>' + delta(r.c.revenue, r.p.revenue, 'rel', { label: 'P' }) + ' ' + delta(r.c.revenue, r.l.revenue, 'rel', { label: 'LY' }) + '</small>' },
      { k: 'orders', label: 'Orders', num: true, v: (r) => r.c.transactions, html: (r) => num(r.c.transactions) + '<small>' + pct(r.c.untracked_share) + ' sessionless</small>' },
      { k: 'aov', label: 'Avg order', num: true, v: (r) => r.c.aov, html: (r) => eur2(r.c.aov) },
    ];
    // CSV gets explicit columns
    const shopCsvCols = [
      { k: 'shop', label: 'Shop', v: (r) => r.shop }, { k: 'm', label: 'Market', v: (r) => shopMarket(r.shop) },
      { k: 's', label: 'Sessions', v: (r) => r.c.sessions }, { k: 'sp', label: 'Sessions prev', v: (r) => r.p.sessions }, { k: 'sl', label: 'Sessions LY', v: (r) => r.l.sessions },
      { k: 'o', label: 'Orders', v: (r) => r.c.transactions }, { k: 'op', label: 'Orders prev', v: (r) => r.p.transactions }, { k: 'ol', label: 'Orders LY', v: (r) => r.l.transactions },
      { k: 'uo', label: 'Sessionless orders', v: (r) => r.c.untracked_transactions },
      { k: 'c', label: 'Conversion %', v: (r) => (fin(r.c.conv) ? r.c.conv * 100 : null) }, { k: 'tc', label: 'Tracked conversion %', v: (r) => (fin(r.c.tracked_conv) ? r.c.tracked_conv * 100 : null) },
      { k: 'r', label: 'Revenue EUR', v: (r) => r.c.revenue }, { k: 'rp', label: 'Revenue prev EUR', v: (r) => r.p.revenue }, { k: 'rl', label: 'Revenue LY EUR', v: (r) => r.l.revenue },
      { k: 'rps', label: 'Revenue per session EUR', v: (r) => r.c.rps }, { k: 'aov', label: 'Avg order EUR', v: (r) => r.c.aov },
    ];
    const tbl = table('shops', shopCols, rows, { caption: 'Shops', csv: 'shops' });
    TABLES.shops = { cols: shopCsvCols, rows, name: 'shops' };
    html += card('Per shop', 'P = vs ' + esc(fmtShort(a.compare.from)) + '–' + esc(fmtShort(a.compare.to)) + ' · LY = vs ' + esc(fmtShort(b.compare.from)) + '–' + esc(fmtShort(b.compare.to)) + ' (52 weeks earlier, same weekdays)' + (dev ? ' · ' + esc(DEVICE_LABEL[dev]) + ' only' : ''), tbl, csvBtn('shops'));

    // funnel
    const cmpResp = F.compare === 'yoy' ? b : a, cmpT = F.compare === 'yoy' ? lv : pv;
    html += '<div class="cols">' + card('Funnel', 'Events per 100 sessions, ' + esc(fmtShort(a.window.from)) + '–' + esc(fmtShort(a.window.to)) + ' against the ' + esc(cmpName(cmpResp.compare.mode)) + '.', funnelHtml(cur, cmpT)) +
      card('Day by day', (dev ? esc(DEVICE_LABEL[dev]) + ' · ' : '') + 'sessions and conversion' + (F.shop ? ' for ' + esc(shopLabel(F.shop)) : ' for all shops'), dailyChart(dailyRows(a.daily)), csvBtn('daily')) + '</div>';
    return html;
  }
  function dailyRows(daily) {
    const m = new Map();
    for (const r of daily) {
      if (F.device && r.device !== F.device) continue;
      const d = m.get(r.date) || { date: r.date, sessions: 0, transactions: 0, revenue: 0, untracked_transactions: 0 };
      d.sessions += r.sessions; d.transactions += r.transactions; d.revenue += r.revenue; d.untracked_transactions += r.untracked_transactions;
      m.set(r.date, d);
    }
    const rows = [...m.values()].sort((x, y) => (x.date < y.date ? -1 : 1));
    TABLES.daily = { name: 'daily', rows, cols: [{ k: 'date', label: 'Date' }, { k: 'sessions', label: 'Sessions' }, { k: 'transactions', label: 'Orders' }, { k: 'untracked_transactions', label: 'Sessionless orders' },
      { k: 'revenue', label: 'Revenue EUR' }, { k: 'conv', label: 'Conversion %', v: (r) => (r.sessions ? (r.transactions / r.sessions) * 100 : null) }] };
    return rows;
  }
  function funnelHtml(c, p) {
    const steps = [
      ['Sessions', 'sessions', 'all visits'], ['Item views', 'ev_view_item', 'view_item'], ['Add to cart', 'ev_add_to_cart', 'add_to_cart'],
      ['Checkout started', 'ev_begin_checkout', 'begin_checkout'], ['Purchases', 'transactions', 'GA4 transactions'],
    ];
    if (!c.sessions) return '<p class="empty">No sessions in this selection.</p>';
    const per = (t, k) => div(t[k], t.sessions);
    let prevK = null;
    const out = steps.map(([name, k, ev]) => {
      const v = per(c, k), pvv = p && p.sessions ? per(p, k) : null;
      const w = (x) => (fin(x) ? Math.min(1, x) * 100 : 0);
      const stepRate = prevK && prevK !== 'sessions' && k !== 'ev_view_item' ? div(c[k], c[prevK]) : null;
      const inflated = k === 'ev_view_item' && v > 10;
      const lineVal = fin(v) ? NF1.format(v * 100) : '–';
      const r = '<div class="fstep"><div class="nm">' + esc(name) + '<small>' + esc(ev) + '</small></div>' +
        '<div class="fbars"><div class="bar" title="this period"><span style="width:' + w(v).toFixed(1) + '%"></span></div><div class="bar cmp" title="comparison"><span style="width:' + w(pvv).toFixed(1) + '%"></span></div></div>' +
        '<div class="vals"><b>' + lineVal + '</b> / 100' + (inflated ? ' ' + badge('warn', 'inflated?', 'More than 10 item views per session: see data notes') : '') + '<br>' +
        (k === 'sessions' ? '<span class="muted">' + num(c.sessions) + '</span>' : delta(v, pvv, 'rel', { label: 'vs cmp' })) +
        (fin(stepRate) ? '<br><span class="muted">' + pct(stepRate) + ' of previous step</span>' : '') + '</div></div>';
      if (k !== 'ev_view_item') prevK = k; else if (!prevK) prevK = 'sessions';
      return r;
    }).join('');
    return '<div class="legend"><span><i></i>This period</span><span><i class="c2"></i>Comparison</span><span>Bars: share of sessions (capped at 100)</span></div><div class="funnel">' + out + '</div>';
  }

  async function pageCategories() {
    const r = await api('categories', params({ device: '' }));
    const fltr = (p) => r.rows.filter((x) => x.period === p);
    const K = ['item_views', 'add_to_cart', 'checkouts', 'purchases', 'revenue', 'refunds', 'list_views', 'list_clicks'];
    const groupBy = (rows, keyFn) => { const m = new Map(); for (const x of rows) { const k = keyFn(x); m.set(k, (m.get(k) || []).concat([x])); } return m; };
    const cur = groupBy(fltr('cur'), (x) => x.category_group), cmp = groupBy(fltr('cmp'), (x) => x.category_group);
    const rate = (t) => Object.assign(t, { v2c: div(t.add_to_cart, t.item_views), c2p: div(t.purchases, t.add_to_cart), v2p: div(t.purchases, t.item_views) });
    const groups = [...cur.keys()].map((g) => {
      const c = rate(sum(cur.get(g), K)), p = rate(sum(cmp.get(g) || [], K));
      const subs = [...groupBy(cur.get(g), (x) => x.category).entries()].map(([cat, rows]) => {
        const sc = rate(sum(rows, K)), sp = rate(sum((cmp.get(g) || []).filter((x) => x.category === cat), K));
        return { name: cat, c: sc, p: sp };
      }).sort((x, y) => y.c.revenue - x.c.revenue);
      return { name: g, c, p, subs };
    }).sort((x, y) => y.c.revenue - x.c.revenue);
    const okc = coverage(r.compare) !== 'none';
    const rc = (v, d) => (fin(v) && v > 1 ? '<span class="muted" title="More of this step than of the step before (added from the configurator, or free add-ons)">over 100 %</span>' : pct(v, d));
    const dpp = (c, p) => (okc && !(c > 1) && !(p > 1) ? delta(c, p, 'pp') : '–');
    const tr = (x, sub) => '<tr class="' + (sub ? 'sub' : 'grp') + '"><td class="name">' + (sub ? esc(x.name) : '<button type="button" class="link" data-act="toggle" data-g="' + esc(x.name) + '" aria-expanded="' + !!ui.open[x.name] + '">' + (ui.open[x.name] ? '▾ ' : '▸ ') + esc(x.name) + '</button>') + '</td>' +
      '<td class="num">' + num(x.c.item_views) + '</td><td class="num">' + num(x.c.add_to_cart) + '</td><td class="num">' + num(x.c.checkouts) + '</td><td class="num">' + num(x.c.purchases) + '</td><td class="num">' + eur(x.c.revenue) + '</td>' +
      '<td class="num">' + rc(x.c.v2c) + '</td><td class="num">' + rc(x.c.c2p) + '</td><td class="num">' + rc(x.c.v2p, 2) + '</td><td class="num">' + dpp(x.c.v2p, x.p.v2p) + '</td><td class="num">' + (okc ? delta(x.c.revenue, x.p.revenue, 'rel') : '–') + '</td></tr>';
    const body = groups.map((g) => tr(g, false) + (ui.open[g.name] ? g.subs.map((s) => tr(s, true)).join('') : '')).join('');
    const th = ['Category', 'Item views', 'Add to cart', 'Checkouts', 'Purchases', 'Revenue', 'View → cart', 'Cart → purchase', 'View → purchase', 'Δ view → purchase', 'Δ revenue'];
    TABLES.categories = {
      name: 'categories', rows: groups.flatMap((g) => [Object.assign({ level: 'group', group: g.name }, g)].concat(g.subs.map((s) => Object.assign({ level: 'category', group: g.name }, s)))),
      cols: [{ k: 'group', label: 'Group' }, { k: 'name', label: 'Category' }, { k: 'level', label: 'Level' },
        ...['item_views', 'add_to_cart', 'checkouts', 'purchases', 'revenue', 'refunds'].map((k) => ({ k, label: k.replace(/_/g, ' '), v: (x) => x.c[k] })),
        { k: 'v2c', label: 'view to cart %', v: (x) => (fin(x.c.v2c) ? x.c.v2c * 100 : null) }, { k: 'c2p', label: 'cart to purchase %', v: (x) => (fin(x.c.c2p) ? x.c.c2p * 100 : null) },
        { k: 'v2p', label: 'view to purchase %', v: (x) => (fin(x.c.v2p) ? x.c.v2p * 100 : null) },
        { k: 'pv2p', label: 'view to purchase % (comparison)', v: (x) => (okc && fin(x.p.v2p) ? x.p.v2p * 100 : null) }, { k: 'prev', label: 'revenue (comparison)', v: (x) => (okc ? x.p.revenue : null) }],
    };
    let html = (F.device ? '<p class="callout">The device filter does not apply here: GA4 has no device split for item metrics. Showing all devices.</p>' : '') + covNote(r) +
      card('Funnel by category', (F.shop ? esc(shopLabel(F.shop)) : 'All shops') + ' · ' + esc(fmtShort(r.window.from)) + '–' + esc(fmtShort(r.window.to)) + ' · Δ against the ' + esc(cmpName(r.compare.mode)) + '. Open a group to see its categories. Lenses for glasses are added from the glasses configurator, so they have almost no item views.',
        '<div class="tw"><table class="t"><caption class="sr">Funnel by category</caption><thead><tr>' + th.map((h, i) => '<th scope="col" class="' + (i ? 'num' : '') + '">' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' +
        (body || '<tr><td colspan="11" class="empty">No item data for this selection.</td></tr>') + '</tbody></table></div>', csvBtn('categories'));

    if (!F.shop) {
      const shops = META.shops.map((s) => s.shop);
      const byShop = (s, g, key) => { const t = rate(sum(fltr('cur').filter((x) => x.shop === s && x.category_group === g), K)); return t[key]; };
      const mx = (key) => Math.max(0.0001, ...groups.flatMap((g) => shops.map((s) => byShop(s, g.name, key) || 0)).filter((v) => v <= 1));
      const matrix = (key, label) => {
        const top = mx(key);
        return '<div class="tw"><table class="t"><caption class="sr">' + esc(label) + ' by shop</caption><thead><tr><th scope="col">Category</th>' + shops.map((s) => '<th scope="col" class="num">' + esc(shopLabel(s)) + '</th>').join('') + '</tr></thead><tbody>' +
          groups.map((g) => '<tr><td class="name">' + esc(g.name) + '</td>' + shops.map((s) => {
            const v = byShop(s, g.name, key);
            const a = fin(v) ? Math.min(1, v / top) : 0;
            return '<td class="num">' + (v > 1 ? '<span class="heat muted">over 100 %</span>' : '<span class="heat" style="background:color-mix(in srgb, var(--accent) ' + Math.round(a * 45) + '%, transparent)">' + pct(v, 2) + '</span>') + '</td>';
          }).join('') + '</tr>').join('') + '</tbody></table></div>';
      };
      html += '<div class="cols">' + card('View → purchase by shop', 'Purchases per item view. Desktop item views are inflated (see data notes), above all on alensa.hr and alensa.si.', matrix('v2p', 'View to purchase')) +
        card('Cart → purchase by shop', 'Purchases per add-to-cart: less affected by the inflated views.', matrix('c2p', 'Cart to purchase')) + '</div>';
    }
    return html;
  }

  async function pageDevices() {
    const r = await api('overview', params({ device: '' }));
    const okc = coverage(r.compare) !== 'none';
    const shops = META.shops.map((s) => s.shop).filter((s) => !F.shop || s === F.shop);
    const t = (s, d, per) => totalsOf(r.totals, per, (x) => (!s || x.shop === s) && x.device === d);
    const rows = shops.map((s) => {
      const m = t(s, 'mobile', 'cur'), dk = t(s, 'desktop', 'cur'), tb = t(s, 'tablet', 'cur'), mp = okc ? t(s, 'mobile', 'cmp') : {}, dp = okc ? t(s, 'desktop', 'cmp') : {};
      const all = totalsOf(r.totals, 'cur', (x) => x.shop === s);
      return { shop: s, m, dk, tb, mp, dp, gap: fin(dk.tracked_conv) && fin(m.conv) ? dk.tracked_conv - m.conv : null, gapAll: fin(dk.conv) && fin(m.conv) ? dk.conv - m.conv : null,
        mShareS: div(m.sessions, all.sessions), mShareO: div(m.transactions, all.transactions) };
    });
    const cols = [
      { k: 'shop', label: 'Shop', html: shopCell, v: (x) => shopLabel(x.shop), cls: 'name', csv: (x) => x.shop },
      { k: 'ms', label: 'Mobile sessions', num: true, v: (x) => x.m.sessions, html: (x) => num(x.m.sessions) + '<small>' + pct(x.mShareS) + ' of sessions</small>' },
      { k: 'mc', label: 'Mobile conv.', num: true, v: (x) => x.m.conv, csv: (x) => (fin(x.m.conv) ? x.m.conv * 100 : null), html: (x) => pct(x.m.conv, 2) + '<small>' + (okc ? delta(x.m.conv, x.mp.conv, 'pp', { label: 'vs cmp' }) : '') + '</small>' },
      { k: 'dc', label: 'Desktop conv.', num: true, v: (x) => x.dk.conv, csv: (x) => (fin(x.dk.conv) ? x.dk.conv * 100 : null), html: (x) => pct(x.dk.conv, 2) + '<small>' + pct(x.dk.untracked_share) + ' sessionless orders</small>' },
      { k: 'dt', label: 'Desktop tracked', num: true, v: (x) => x.dk.tracked_conv, csv: (x) => (fin(x.dk.tracked_conv) ? x.dk.tracked_conv * 100 : null), html: (x) => pct(x.dk.tracked_conv, 2) + '<small>' + (okc ? delta(x.dk.tracked_conv, x.dp.tracked_conv, 'pp', { label: 'vs cmp' }) : '') + '</small>' },
      { k: 'gap', label: 'Gap (tracked)', num: true, v: (x) => x.gap, csvLabel: 'Gap desktop tracked - mobile pp', csv: (x) => (fin(x.gap) ? x.gap * 100 : null), html: (x) => (fin(x.gap) ? (x.gap >= 0 ? '+' : '−') + NF2.format(Math.abs(x.gap * 100)) + ' pp' : '–') + '<small>all orders: ' + (fin(x.gapAll) ? (x.gapAll >= 0 ? '+' : '−') + NF1.format(Math.abs(x.gapAll * 100)) + ' pp' : '–') + '</small>' },
      { k: 'tc', label: 'Tablet conv.', num: true, v: (x) => x.tb.conv, csv: (x) => (fin(x.tb.conv) ? x.tb.conv * 100 : null), html: (x) => pct(x.tb.conv, 2) + '<small>' + num(x.tb.sessions) + ' sessions</small>' },
      { k: 'mo', label: 'Mobile orders', num: true, v: (x) => x.mShareO, csv: (x) => (fin(x.mShareO) ? x.mShareO * 100 : null), csvLabel: 'Mobile share of orders %', html: (x) => pct(x.mShareO) + '<small>of orders</small>' },
      { k: 'mr', label: 'Rev / session', num: true, v: (x) => x.m.rps, csvLabel: 'Mobile rev per session EUR', html: (x) => eur2(x.m.rps) + '<small>desktop ' + eur2(x.dk.rps) + '</small>' },
    ];
    let html = covNote(r) + '<p class="callout">“Desktop tracked” leaves out purchases that GA4 received without a browser session (browser “(not set)”). Those are almost all desktop and make desktop look far better than it is. The gap is desktop tracked minus mobile.</p>' +
      card('Mobile vs desktop per shop', esc(fmtShort(r.window.from)) + '–' + esc(fmtShort(r.window.to)) + ' · comparison: ' + esc(cmpName(r.compare.mode)) + ' (' + esc(fmtShort(r.compare.from)) + '–' + esc(fmtShort(r.compare.to)) + ')', table('devices', cols, rows, { caption: 'Mobile vs desktop', sort: { k: 'ms', dir: -1 } }), csvBtn('devices'));

    // funnel steps per shop x device
    const steps = [];
    for (const s of shops) for (const d of ['mobile', 'desktop', 'tablet']) {
      const c = t(s, d, 'cur');
      if (!c.sessions) continue;
      const p = okc ? t(s, d, 'cmp') : {};
      steps.push({ shop: s, device: d, c, p });
    }
    const scols = [
      { k: 'shop', label: 'Shop', html: shopCell, v: (x) => shopLabel(x.shop), cls: 'name', csv: (x) => x.shop },
      { k: 'device', label: 'Device', html: (x) => esc(DEVICE_LABEL[x.device] || x.device) },
      { k: 'sessions', label: 'Sessions', num: true, v: (x) => x.c.sessions, html: (x) => num(x.c.sessions) },
      { k: 'vps', label: 'Item views / session', num: true, v: (x) => x.c.views_per_session, html: (x) => (fin(x.c.views_per_session) ? NF1.format(x.c.views_per_session) : '–') + (x.c.views_per_session > 10 ? ' ' + badge('warn', 'inflated?') : '') },
      { k: 'atc', label: 'Add to cart / 100', num: true, v: (x) => x.c.atc_rate, csv: (x) => (fin(x.c.atc_rate) ? x.c.atc_rate * 100 : null), html: (x) => (fin(x.c.atc_rate) ? NF1.format(x.c.atc_rate * 100) : '–') + '<small>' + delta(x.c.atc_rate, x.p.atc_rate, 'rel', { label: 'vs cmp' }) + '</small>' },
      { k: 'cpa', label: 'Checkout / cart', num: true, v: (x) => x.c.checkout_per_atc, csv: (x) => (fin(x.c.checkout_per_atc) ? x.c.checkout_per_atc * 100 : null), html: (x) => pct(x.c.checkout_per_atc) + '<small>' + delta(x.c.checkout_per_atc, x.p.checkout_per_atc, 'pp', { label: 'vs cmp' }) + '</small>' },
      { k: 'ppc', label: 'Purchase / checkout', num: true, v: (x) => x.c.purchase_per_checkout, csv: (x) => (fin(x.c.purchase_per_checkout) ? x.c.purchase_per_checkout * 100 : null), html: (x) => pct(x.c.purchase_per_checkout) + '<small>' + delta(x.c.purchase_per_checkout, x.p.purchase_per_checkout, 'pp', { label: 'vs cmp' }) + '</small>' },
      { k: 'aov', label: 'Avg order', num: true, v: (x) => x.c.aov, html: (x) => eur2(x.c.aov) },
    ];
    html += card('Funnel steps by device', 'Event ratios: checkouts per add-to-cart and purchases per checkout show where each device loses shoppers. Purchase / checkout on desktop includes sessionless purchases.', table('devsteps', scols, steps, { caption: 'Funnel steps by device', sort: { k: 'sessions', dir: -1 } }), csvBtn('devsteps'));
    return html;
  }

  async function pageLanding() {
    const r = await api('landing', params());
    const okc = coverage(r.compare) !== 'none';
    const min = ui.minS;
    const rows = r.rows.map((x) => Object.assign({}, x, {
      conv: div(x.transactions, x.sessions), c_conv: div(x.c_transactions, x.c_sessions), engaged: div(x.engaged_sessions, x.sessions),
      d_sessions: x.sessions - x.c_sessions, d_revenue: x.revenue - x.c_revenue, rps: div(x.revenue, x.sessions),
    }));
    const pageCell = (x) => esc(x.page) + (x.page === '(not set)' ? ' ' + badge('info', 'no page_view', 'Sessions without a page_view event (consent mode, app or tag timing)') : '') + (x.page === '(other pages)' ? ' ' + badge('', 'outside top 250') : '');
    const real = rows.filter((x) => x.page !== '(other pages)');
    const nosale = real.filter((x) => x.sessions >= min && x.transactions === 0);
    const drops = okc ? real.filter((x) => x.c_sessions >= min && (x.d_revenue < 0 || x.d_sessions < 0)) : [];
    const base = [{ k: 'page', label: 'Landing page', html: pageCell, v: (x) => x.page, cls: 'name' }, { k: 'shop', label: 'Shop', v: (x) => x.shop, csv: (x) => x.shop, html: (x) => esc(shopLabel(x.shop)), hide: !!F.shop }];
    const c1 = base.concat([
      { k: 'sessions', label: 'Sessions', num: true, html: (x) => num(x.sessions) },
      { k: 'engaged', label: 'Engaged', num: true, csv: (x) => (fin(x.engaged) ? x.engaged * 100 : null), csvLabel: 'Engaged %', html: (x) => pct(x.engaged) },
      { k: 'c_sessions', label: 'Sessions before', num: true, html: (x) => (okc ? num(x.c_sessions) : '–') },
      { k: 'c_transactions', label: 'Orders before', num: true, html: (x) => (okc ? num(x.c_transactions) : '–') },
    ]).filter((c) => !c.hide);
    const c2 = base.concat([
      { k: 'd_revenue', label: 'Revenue change', num: true, csvLabel: 'Revenue change EUR', html: (x) => eur(x.d_revenue) + '<small>' + eur(x.c_revenue) + ' → ' + eur(x.revenue) + '</small>' },
      { k: 'd_sessions', label: 'Sessions change', num: true, html: (x) => num(x.d_sessions) + '<small>' + delta(x.sessions, x.c_sessions, 'rel') + '</small>' },
      { k: 'conv', label: 'Conversion', num: true, csv: (x) => (fin(x.conv) ? x.conv * 100 : null), csvLabel: 'Conversion %', html: (x) => pct(x.conv, 2) + '<small>' + delta(x.conv, x.c_conv, 'pp', { label: 'was ' + pct(x.c_conv, 2) }) + '</small>' },
      { k: 'transactions', label: 'Orders', num: true, html: (x) => num(x.transactions) + '<small>was ' + num(x.c_transactions) + '</small>' },
    ]).filter((c) => !c.hide);
    const c3 = base.concat([
      { k: 'sessions', label: 'Sessions', num: true, html: (x) => num(x.sessions) + '<small>' + (okc ? delta(x.sessions, x.c_sessions, 'rel') : '') + '</small>' },
      { k: 'engaged', label: 'Engaged', num: true, csv: (x) => (fin(x.engaged) ? x.engaged * 100 : null), csvLabel: 'Engaged %', html: (x) => pct(x.engaged) },
      { k: 'conv', label: 'Conversion', num: true, csv: (x) => (fin(x.conv) ? x.conv * 100 : null), csvLabel: 'Conversion %', html: (x) => pct(x.conv, 2) + '<small>' + (okc ? delta(x.conv, x.c_conv, 'pp') : '') + '</small>' },
      { k: 'transactions', label: 'Orders', num: true, html: (x) => num(x.transactions) },
      { k: 'revenue', label: 'Revenue', num: true, csvLabel: 'Revenue EUR', html: (x) => eur(x.revenue) },
      { k: 'rps', label: 'Rev / session', num: true, csvLabel: 'Revenue per session EUR', html: (x) => eur2(x.rps) },
      { k: 'c_sessions', label: 'Sessions (cmp)', num: true, html: (x) => (okc ? num(x.c_sessions) : '–') },
      { k: 'c_revenue', label: 'Revenue (cmp)', num: true, csvLabel: 'Revenue comparison EUR', html: (x) => (okc ? eur(x.c_revenue) : '–') },
    ]).filter((c) => !c.hide);
    const q = (ui.q.landing || '').toLowerCase();
    const all = q ? rows.filter((x) => x.page.toLowerCase().includes(q)) : rows;
    const minSel = '<label class="sr" for="minS">Minimum sessions</label><select class="select" id="minS" data-act="minS">' + [30, 100, 300, 1000].map((n) => '<option value="' + n + '"' + (n === min ? ' selected' : '') + '>min. ' + n + ' sessions</option>').join('') + '</select>';
    const span = fmtDate(r.window.from) + ' – ' + fmtDate(r.window.to) + ' (' + r.window.weeks + (r.window.weeks === 1 ? ' week' : ' weeks') + ')';
    let html = '<p class="callout">Whole weeks only: ' + esc(span) + ', compared with ' + esc(fmtDate(r.compare.from)) + ' – ' + esc(fmtDate(r.compare.to)) + ' (' + esc(cmpName(r.compare.mode)) + '). Each week keeps its top 250 pages per shop; the rest are in “(other pages)”. Add-to-carts are not split by landing page in GA4, so they are left out.' + (F.device ? ' Device: ' + esc(DEVICE_LABEL[F.device]) + '.' : '') + '</p>' + covNote(r) +
      '<div class="cols">' + card('Traffic but no sales', 'Pages with at least ' + num(min) + ' sessions and no order.', table('nosale', c1, nosale, { caption: 'Traffic but no sales', limit: 25, sort: { k: 'sessions', dir: -1 }, empty: 'Every landing page with this much traffic sold something.' }), minSel + csvBtn('nosale')) +
      card('Biggest drops', okc ? 'Pages that had at least ' + num(min) + ' sessions before, sorted by lost revenue.' : 'No comparison data for this period.', table('drops', c2, drops, { caption: 'Biggest drops', limit: 25, sort: { k: 'd_revenue', dir: 1 }, empty: 'No drops for this selection.' }), csvBtn('drops')) + '</div>' +
      card('All landing pages', 'Top ' + num(rows.length) + ' pages by sessions in either period.', table('landing', c3, all, { caption: 'All landing pages', limit: 100, tall: true, sort: { k: 'sessions', dir: -1 } }),
        '<label class="sr" for="qLanding">Search landing pages</label><input class="search" id="qLanding" type="search" placeholder="Search pages" data-act="q" data-t="landing" value="' + esc(ui.q.landing || '') + '">' + csvBtn('landing'));
    return html;
  }

  async function pageBrowsers() {
    const r = await api('browsers', params());
    const okc = coverage(r.compare) !== 'none';
    const cur = r.rows.filter((x) => x.period === 'cur'), cmp = r.rows.filter((x) => x.period === 'cmp');
    const NOTSET = (x) => x.browser === '(not set)';
    const base = new Map();
    for (const x of cur) {
      if (NOTSET(x)) continue;
      const k = x.shop + '|' + x.device, b = base.get(k) || { s: 0, t: 0 };
      b.s += x.sessions; b.t += x.transactions; base.set(k, b);
    }
    const cmpMap = new Map(cmp.map((x) => [x.shop + '|' + x.device + '|' + x.browser + '|' + x.os, x]));
    const min = ui.minS;
    const rows = cur.map((x) => {
      const b = base.get(x.shop + '|' + x.device) || { s: 0, t: 0 };
      const baseline = div(b.t, b.s);
      const conv = div(x.transactions, x.sessions);
      const expected = fin(baseline) ? x.sessions * baseline : null;
      const z = expected > 0 ? (x.transactions - expected) / Math.sqrt(expected) : null;
      const p = cmpMap.get(x.shop + '|' + x.device + '|' + x.browser + '|' + x.os);
      let flag = 'ok';
      if (NOTSET(x)) flag = x.transactions > x.sessions ? 'sessionless' : 'notset';
      else if (x.sessions >= min && expected >= 5 && conv < 0.5 * baseline && z <= -3) flag = 'broken';
      else if (x.sessions >= min && expected >= 3 && conv < 0.75 * baseline && z <= -2) flag = 'low';
      else if (x.sessions >= min && expected >= 3 && conv > 2 * baseline && z >= 3) flag = 'high';
      return Object.assign({}, x, { baseline, conv, expected, z, missing: fin(expected) ? expected - x.transactions : null, c_conv: p ? div(p.transactions, p.sessions) : null, c_sessions: p ? p.sessions : 0, flag, eng: div(x.engaged_sessions, x.sessions) });
    });
    const FL = { broken: ['bad', 'Possible breakage'], low: ['warn', 'Below average'], high: ['info', 'Unusually high'], sessionless: ['warn', 'Sessionless purchases'], notset: ['', 'No browser info'], ok: ['good', 'Normal'] };
    const rank = { broken: 0, sessionless: 1, low: 2, high: 3, notset: 4, ok: 5 };
    const shown = ui.flagged ? rows.filter((x) => x.flag !== 'ok' && x.flag !== 'notset') : rows.filter((x) => x.sessions >= 5);
    const cols = [
      { k: 'flag', label: 'Status', v: (x) => rank[x.flag], csv: (x) => FL[x.flag][1], html: (x) => badge(FL[x.flag][0], FL[x.flag][1]) },
      { k: 'browser', label: 'Browser · OS', v: (x) => x.browser + ' ' + x.os, csv: (x) => x.browser + ' / ' + x.os, cls: 'name', html: (x) => esc(x.browser) + ' · ' + esc(x.os) + '<small>' + esc(DEVICE_LABEL[x.device] || x.device) + (F.shop ? '' : ' · ' + esc(shopLabel(x.shop))) + '</small>' },
      { k: 'shop', label: 'Shop', v: (x) => x.shop, html: (x) => esc(shopLabel(x.shop)) },
      { k: 'device', label: 'Device', v: (x) => x.device, html: (x) => esc(DEVICE_LABEL[x.device] || x.device) },
      { k: 'sessions', label: 'Sessions', num: true, html: (x) => num(x.sessions) + '<small>' + pct(x.eng) + ' engaged</small>' },
      { k: 'transactions', label: 'Orders', num: true, html: (x) => num(x.transactions) },
      { k: 'conv', label: 'Conversion', num: true, csv: (x) => (fin(x.conv) ? x.conv * 100 : null), csvLabel: 'Conversion %', html: (x) => pct(x.conv, 2) + '<small>avg ' + pct(x.baseline, 2) + '</small>' },
      { k: 'missing', label: 'Missing orders', num: true, csv: (x) => (fin(x.missing) ? +x.missing.toFixed(1) : null), html: (x) => (fin(x.missing) && x.flag !== 'sessionless' && x.flag !== 'notset' ? NF1.format(x.missing) : '–') + '<small>' + (fin(x.z) && x.flag !== 'sessionless' ? 'z ' + NF1.format(x.z) : '') + '</small>' },
      { k: 'c_conv', label: 'Before', num: true, csv: (x) => (okc && fin(x.c_conv) ? x.c_conv * 100 : null), csvLabel: 'Conversion comparison %', html: (x) => (okc ? pct(x.c_conv, 2) + '<small>' + num(x.c_sessions) + ' sessions</small>' : '–') },
      { k: 'revenue', label: 'Revenue', num: true, csvLabel: 'Revenue EUR', html: (x) => eur(x.revenue) },
    ].filter((c) => (c.k === 'shop' || c.k === 'device' ? false : true));
    const csvCols = cols.concat([{ k: 'shop', label: 'Shop' }, { k: 'device', label: 'Device' }, { k: 'baseline', label: 'Shop+device avg conversion %', v: (x) => (fin(x.baseline) ? x.baseline * 100 : null) }]);
    const nb = rows.filter((x) => x.flag === 'broken').length, nl = rows.filter((x) => x.flag === 'low').length;
    const ns = rows.filter((x) => x.flag === 'sessionless').reduce((a, x) => a + x.transactions, 0);
    const tbl = table('browsers', cols, shown, { caption: 'Browsers and devices', limit: 60, tall: true, sort: { k: 'flag', dir: 1 }, empty: ui.flagged ? 'Nothing abnormal: every browser with at least ' + min + ' sessions converts close to its shop and device average.' : 'No browser data.' });
    TABLES.browsers.cols = csvCols;
    const ctl = '<div class="seg" role="group" aria-label="Rows"><button type="button" data-act="flagged" data-v="1" aria-pressed="' + ui.flagged + '">Flagged</button><button type="button" data-act="flagged" data-v="0" aria-pressed="' + !ui.flagged + '">All</button></div>' +
      '<label class="sr" for="minS">Minimum sessions</label><select class="select" id="minS" data-act="minS">' + [30, 100, 300, 1000].map((n) => '<option value="' + n + '"' + (n === min ? ' selected' : '') + '>min. ' + n + ' sessions</option>').join('') + '</select>' + csvBtn('browsers');
    return covNote(r) + '<div class="kpis"><div class="kpi"><span class="label">Possible breakage</span><span class="v">' + num(nb) + '</span><span class="d">conversion under half the average, z ≤ −3</span></div>' +
      '<div class="kpi"><span class="label">Below average</span><span class="v">' + num(nl) + '</span><span class="d">under 75 % of the average, z ≤ −2</span></div>' +
      '<div class="kpi"><span class="label">Sessionless purchases</span><span class="v">' + num(ns) + '</span><span class="d">orders with browser “(not set)”</span></div></div>' +
      card('Browsers with abnormal conversion', 'Each browser + operating system is compared with its shop and device average (without “(not set)”). Missing orders = what the average would have sold minus what it sold; z = how unusual that is. Look at a flagged browser on a real device before acting.', tbl, ctl);
  }

  async function pagePromotions() {
    const r = await api('promotions', params({ device: '' }));
    const okc = coverage(r.compare) !== 'none';
    const rows = r.rows.map((x) => Object.assign({}, x, { ctr: div(x.clicks, x.views), c_ctr: div(x.c_clicks, x.c_views) }));
    const byC = new Map();
    for (const x of rows) { const k = x.creative; const t = byC.get(k) || { creative: k, views: 0, clicks: 0, add_to_cart: 0, purchases: 0, revenue: 0, c_clicks: 0, c_views: 0, n: 0 }; for (const f of ['views', 'clicks', 'add_to_cart', 'purchases', 'revenue', 'c_clicks', 'c_views']) t[f] += x[f]; t.n++; byC.set(k, t); }
    const crs = [...byC.values()].map((t) => Object.assign(t, { ctr: div(t.clicks, t.views), c_ctr: div(t.c_clicks, t.c_views) }));
    const ccols = [
      { k: 'creative', label: 'Placement', cls: 'name', html: (x) => esc(x.creative) + '<small>' + num(x.n) + ' promotions</small>' },
      { k: 'views', label: 'Views', num: true, html: (x) => num(x.views) },
      { k: 'clicks', label: 'Clicks', num: true, html: (x) => num(x.clicks) + '<small>' + (okc ? delta(x.clicks, x.c_clicks, 'rel') : '') + '</small>' },
      { k: 'ctr', label: 'CTR', num: true, csv: (x) => (fin(x.ctr) ? x.ctr * 100 : null), csvLabel: 'CTR %', html: (x) => pct(x.ctr, 2) + '<small>' + (okc ? delta(x.ctr, x.c_ctr, 'pp') : '') + '</small>' },
      { k: 'add_to_cart', label: 'Add to cart', num: true, html: (x) => num(x.add_to_cart) },
      { k: 'purchases', label: 'Purchased', num: true, html: (x) => num(x.purchases) },
      { k: 'revenue', label: 'Item revenue', num: true, csvLabel: 'Item revenue EUR', html: (x) => eur(x.revenue) },
    ];
    const q = (ui.q.promos || '').toLowerCase();
    const list = q ? rows.filter((x) => (x.promotion + ' ' + x.creative).toLowerCase().includes(q)) : rows;
    const pcols = [
      { k: 'promotion', label: 'Promotion', cls: 'name', html: (x) => esc(x.promotion) + '<small>' + esc(x.creative) + (F.shop ? '' : ' · ' + esc(shopLabel(x.shop))) + ' · ' + num(x.days) + ' days</small>' },
      { k: 'shop', label: 'Shop', html: (x) => esc(shopLabel(x.shop)), csv: (x) => x.shop },
      { k: 'views', label: 'Views', num: true, html: (x) => num(x.views) },
      { k: 'clicks', label: 'Clicks', num: true, html: (x) => num(x.clicks) + '<small>' + (okc ? (x.c_clicks ? delta(x.clicks, x.c_clicks, 'rel') : badge('info', 'new')) : '') + '</small>' },
      { k: 'ctr', label: 'CTR', num: true, csv: (x) => (fin(x.ctr) ? x.ctr * 100 : null), csvLabel: 'CTR %', html: (x) => pct(x.ctr, 2) },
      { k: 'add_to_cart', label: 'Add to cart', num: true, html: (x) => num(x.add_to_cart) },
      { k: 'purchases', label: 'Purchased', num: true, html: (x) => num(x.purchases) },
      { k: 'revenue', label: 'Item revenue', num: true, csvLabel: 'Item revenue EUR', html: (x) => eur(x.revenue) },
      { k: 'c_clicks', label: 'Clicks (cmp)', num: true, html: (x) => (okc ? num(x.c_clicks) : '–') },
    ].filter((c) => !(c.k === 'shop' && F.shop));
    return (F.device ? '<p class="callout">The device filter does not apply here: promotions are not split by device in this GA4 export.</p>' : '') + covNote(r) +
      '<p class="callout">A view is counted for every promoted item shown, so cart upsells reach millions of views and a CTR near zero. Banners rarely show purchases: GA4 credits a promotion only for the promoted item itself. Item lists are not filled in this GA4 property, so they are not shown.</p>' +
      card('By placement', esc(fmtShort(r.window.from)) + '–' + esc(fmtShort(r.window.to)) + ' · Δ against the ' + esc(cmpName(r.compare.mode)), table('placements', ccols, crs, { caption: 'Promotions by placement', sort: { k: 'clicks', dir: -1 } }), csvBtn('placements')) +
      card('Promotions', 'Up to 800 promotions with the most clicks.', table('promos', pcols, list, { caption: 'Promotions', limit: 100, tall: true, sort: { k: 'clicks', dir: -1 } }),
        '<label class="sr" for="qPromos">Search promotions</label><input class="search" id="qPromos" type="search" placeholder="Search promotions" data-act="q" data-t="promos" value="' + esc(ui.q.promos || '') + '">' + csvBtn('promos'));
  }

  async function pageChecks() {
    const r = await api('quality', params({ compare: 'prev' }));
    const shops = META.shops.map((s) => s.shop).filter((s) => !F.shop || s === F.shop);
    const rows = shops.map((s) => {
      const t = totalsOf(r.totals, 'cur', (x) => x.shop === s && (!F.device || x.device === F.device));
      const d = totalsOf(r.totals, 'cur', (x) => x.shop === s && x.device === 'desktop');
      const m = totalsOf(r.totals, 'cur', (x) => x.shop === s && x.device === 'mobile');
      const o = sum(r.orders.filter((x) => x.shop === s), ['tx_rows', 'orders', 'duplicate_rows', 'revenue', 'negative_rows', 'negative_revenue', 'zero_rows', 'unassigned_rows', 'unassigned_revenue']);
      const p = totalsOf(r.totals, 'cmp', (x) => x.shop === s && (!F.device || x.device === F.device));
      return { shop: s, t, d, m, o, p, spike: p.sessions ? t.sessions / p.sessions - 1 : null, viewUsersPerSession: div(d.view_item_users, d.ev_session_start) };
    });
    const flag = (cond, cls, txt) => (cond ? ' ' + badge(cls, txt) : '');
    const cols = [
      { k: 'shop', label: 'Shop', html: shopCell, v: (x) => shopLabel(x.shop), cls: 'name', csv: (x) => x.shop },
      { k: 'spike', label: 'Sessions vs previous', num: true, v: (x) => x.spike, csv: (x) => (fin(x.spike) ? x.spike * 100 : null), csvLabel: 'Sessions change vs previous period %', html: (x) => num(x.t.sessions) + flag(fin(x.spike) && Math.abs(x.spike) > 0.5, 'warn', (x.spike > 0 ? 'spike ' : 'drop ') + delta(1 + x.spike, 1, 'rel').replace(/<[^>]+>/g, '')) + '<small>was ' + num(x.p.sessions) + '</small>' },
      { k: 'sl', label: 'Sessionless orders', num: true, v: (x) => x.t.untracked_share, csv: (x) => x.t.untracked_transactions, html: (x) => num(x.t.untracked_transactions) + flag(x.t.untracked_share > 0.2, 'bad', pct(x.t.untracked_share) + ' of orders') + '<small>' + eur(x.t.untracked_revenue) + ' revenue</small>' },
      { k: 'vd', label: 'Item views / session, desktop', num: true, v: (x) => x.d.views_per_session, csv: (x) => x.d.views_per_session, html: (x) => (fin(x.d.views_per_session) ? NF1.format(x.d.views_per_session) : '–') + flag(x.d.views_per_session > 10, 'warn', 'inflated') + '<small>mobile ' + (fin(x.m.views_per_session) ? NF1.format(x.m.views_per_session) : '–') + '</small>' },
      { k: 'vu', label: 'Viewing users / session, desktop', num: true, v: (x) => x.viewUsersPerSession, csv: (x) => x.viewUsersPerSession, html: (x) => (fin(x.viewUsersPerSession) ? NF2.format(x.viewUsersPerSession) : '–') + flag(x.viewUsersPerSession > 1.5, 'warn', 'more users than sessions') },
      { k: 'neg', label: 'Negative purchases', num: true, v: (x) => x.o.negative_rows, csv: (x) => x.o.negative_rows, html: (x) => num(x.o.negative_rows) + flag(x.o.negative_rows > 0, 'warn', 'refunds as purchases') + '<small>' + eur(x.o.negative_revenue) + '</small>' },
      { k: 'una', label: 'Unassigned channel', num: true, v: (x) => div(x.o.unassigned_rows, x.o.tx_rows), csv: (x) => x.o.unassigned_rows, html: (x) => num(x.o.unassigned_rows) + '<small>' + pct(div(x.o.unassigned_rows, x.o.tx_rows)) + ' of purchase rows</small>' },
      { k: 'dup', label: 'Duplicate rows', num: true, v: (x) => x.o.duplicate_rows, csv: (x) => x.o.duplicate_rows, html: (x) => num(x.o.duplicate_rows) + '<small>same id in one day</small>' },
      { k: 'zero', label: 'Zero-value', num: true, v: (x) => x.o.zero_rows, csv: (x) => x.o.zero_rows, html: (x) => num(x.o.zero_rows) },
      { k: 'cmp', label: 'Orders: sessions vs purchase report', num: true, v: (x) => x.t.transactions - x.o.orders, csvLabel: 'Orders (sessions report) minus distinct ids (purchase report)', html: (x) => num(x.t.transactions) + ' / ' + num(x.o.orders) + '<small>same day, ids counted per day</small>' },
    ];
    return notesHtml(true, '<li><b>Negative purchases</b> are refunds sent to GA4 as purchase events with negative revenue (mostly “Unassigned”); they lower revenue but count as transactions.</li>' +
      '<li><b>Landing page “(not set)”</b> means sessions without a page_view event; it is a large share on some shops.</li>') +
      card('Tracking checks per shop', esc(fmtShort(r.window.from)) + '–' + esc(fmtShort(r.window.to)) + (F.device ? ' · ' + esc(DEVICE_LABEL[F.device]) + ' (purchase checks); item-view checks are per device' : ''), table('checks', cols, rows, { caption: 'Tracking checks', sort: { k: 'sl', dir: -1 } }), csvBtn('checks'));
  }

  const LOADERS = { overview: pageOverview, categories: pageCategories, devices: pageDevices, landing: pageLanding, browsers: pageBrowsers, promotions: pagePromotions, checks: pageChecks };

  // ── render ──────────────────────────────────────────────────────────────
  function route() { const m = /^#\/([a-z]+)/.exec(location.hash || ''); return m && LOADERS[m[1]] ? m[1] : 'overview'; }
  function renderNav(active) {
    $('nav').innerHTML = SESSION.allowed ? PAGES.map((p) => '<a href="#/' + p.id + '"' + (p.id === active ? ' aria-current="page"' : '') + '><svg viewBox="0 0 24 24" aria-hidden="true">' + ICON[p.id] + '</svg>' + esc(p.title) + '</a>').join('') : '';
    $('sideFoot').innerHTML = SESSION.allowed
      ? '<span class="pill"><i aria-hidden="true"></i>Live GA4 data · ' + esc(SESSION.email || '') + ' · kept in memory only</span>'
      : '<span class="pill"><i aria-hidden="true" style="background:var(--ink3)"></i>Live data for approved accounts</span>';
  }
  let focusNext = false;
  async function render() {
    const seq = ++renderSeq;
    const id = route();
    renderNav(id);
    const page = $('page');
    if (!SESSION.allowed) {
      renderFilters();
      page.innerHTML = gateHtml();
      document.title = 'Webshop conversion health — Adrial Apps';
      return;
    }
    if (!META) {
      page.innerHTML = '<p class="loading" role="status"><i aria-hidden="true"></i>Loading webshop data…</p>';
      try { META = await api('meta'); } catch (e) { if (seq === renderSeq && SESSION.allowed) page.innerHTML = errorHtml(e); return; }
      if (seq !== renderSeq) return;
    }
    renderFilters();
    const P = PAGES.find((p) => p.id === id);
    document.title = P.title + ' · Webshop health — Adrial Apps';
    const head = '<div class="head"><div><span class="eyebrow">Webshop health · ' + esc(F.shop ? shopLabel(F.shop) : 'all shops') + (F.device ? ' · ' + esc(DEVICE_LABEL[F.device]) : '') + '</span><h1 tabindex="-1">' + esc(P.h) + '</h1><p class="sub">' + esc(P.sub) + '</p></div></div>';
    const keepScroll = !focusNext ? window.scrollY : 0;
    page.innerHTML = head + '<p class="loading" role="status"><i aria-hidden="true"></i>Loading ' + esc(P.title.toLowerCase()) + '…</p>';
    let body;
    try { body = await LOADERS[id](); } catch (e) {
      if (seq !== renderSeq) return;
      if (e.status === 401 || e.status === 403) return;
      page.innerHTML = head + errorHtml(e);
      return;
    }
    if (seq !== renderSeq || !SESSION.allowed) return;
    page.innerHTML = head + body;
    if (focusNext) { const h = page.querySelector('h1'); if (h) h.focus(); focusNext = false; } else window.scrollTo(0, keepScroll);
  }
  function errorHtml(e) {
    return '<div class="err" role="alert"><p><b>' + esc(e.status === 400 ? 'That selection could not be shown.' : e.status === 0 ? 'Could not reach the server.' : 'The webshop data is unavailable right now.') + '</b><br><span class="muted">' + esc(e.message) + '</span></p><button type="button" class="btn" data-act="retry">Try again</button></div>';
  }
  // re-render the current page from memory (sort, open, search) without refetching
  function rerender() { render(); }

  // ── events ──────────────────────────────────────────────────────────────
  const ACT = {
    signin: signIn,
    recheck: () => { SESSION.checked = false; render(); checkSession(); },
    retry: () => { DATA = new Map(); render(); },
    f: (el) => {
      const k = el.dataset.k, v = el.dataset.v;
      F[k] = v;
      if (k === 'preset' && v === 'custom') { const w = win(); F.from = w.from; F.to = w.to; }
      saveFilters(); render();
    },
    sort: (el) => { const id = el.dataset.t, k = el.dataset.k, s = ui.sort[id]; const cur = s && s.k === k ? s.dir : null; ui.sort[id] = { k, dir: cur === -1 ? 1 : -1 }; rerender(); },
    showall: (el) => { ui.show[el.dataset.t] = true; rerender(); },
    toggle: (el) => { const g = el.dataset.g; ui.open[g] = !ui.open[g]; rerender(); setTimeout(() => { const b = document.querySelector('[data-act="toggle"][data-g="' + CSS.escape(g) + '"]'); if (b) b.focus(); }, 60); },
    csv: (el) => downloadCsv(el.dataset.t),
    flagged: (el) => { ui.flagged = el.dataset.v === '1'; rerender(); },
  };
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.tagName === 'SELECT' || el.tagName === 'INPUT') return;
    const fn = ACT[el.dataset.act];
    if (fn) { e.preventDefault(); fn(el); }
  });
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.act === 'fsel') { F[el.dataset.k] = el.value; saveFilters(); render(); }
    else if (el.dataset.act === 'fdate') {
      if (!el.value) return;
      const w = win();
      F.preset = 'custom'; F.from = w.from; F.to = w.to; F[el.dataset.k] = el.value;
      if (F.from > F.to) { if (el.dataset.k === 'from') F.to = F.from; else F.from = F.to; }
      saveFilters(); render();
    } else if (el.dataset.act === 'minS') { ui.minS = +el.value; const id = el.id; rerender(); setTimeout(() => { const x = $(id); if (x) x.focus(); }, 80); }
  });
  let qT = null;
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset.act !== 'q') return;
    ui.q[el.dataset.t] = el.value;
    clearTimeout(qT);
    qT = setTimeout(() => { const id = el.id, pos = el.selectionStart; rerender(); setTimeout(() => { const x = $(id); if (x) { x.focus(); try { x.setSelectionRange(pos, pos); } catch (err) {} } }, 80); }, 250);
  });
  window.addEventListener('hashchange', () => { focusNext = true; $('side').classList.remove('open'); $('menuBtn').setAttribute('aria-expanded', 'false'); render(); });
  $('menuBtn').addEventListener('click', () => { const o = $('side').classList.toggle('open'); $('menuBtn').setAttribute('aria-expanded', String(o)); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('side').classList.contains('open')) { $('side').classList.remove('open'); $('menuBtn').setAttribute('aria-expanded', 'false'); $('menuBtn').focus(); } });

  // re-check access whenever the Adrial Apps account changes (sign in / out / switch)
  if (window.AdrialSync && window.AdrialSync.on) {
    let last = null;
    window.AdrialSync.ready.then(() => {
      last = (window.AdrialSync.user() || {}).email || '';
      window.AdrialSync.on(() => { const now = (window.AdrialSync.user() || {}).email || ''; if (now !== last) { last = now; forgetLive(); SESSION.checked = false; render(); checkSession(); } });
    });
  }
  render();
  checkSession();
})();
