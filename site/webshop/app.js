/* Webshop conversion health (Business Apps demo).
 *
 * Pages read /api/webshop/* (daily GA4-style aggregates per shop, device and day). On this static site
 * demo-api.js answers those calls in the browser with made-up numbers for three fictional shops. The numbers
 * live only in memory (never in localStorage / IndexedDB / the sync snapshot); a 401/403 at any point drops
 * them and returns to the access page. Only the filter choices (shop, device, period, compare mode) are
 * remembered in this browser. */
(function () {
  'use strict';

  const API = '/api/webshop/';
  const FKEY = 'stratum-webshop-filters';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Slovenian formats: "1.936,30 €", "12,3 %", "15. 10. 2026" (useGrouping 'always': sl-SI leaves 1936 ungrouped by default)
  const NF0 = new Intl.NumberFormat('sl-SI', { maximumFractionDigits: 0, useGrouping: 'always' });
  const NF1 = new Intl.NumberFormat('sl-SI', { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: 'always' });
  const NF2 = new Intl.NumberFormat('sl-SI', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' });
  const RK = window.WebshopRisk;
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
  const fmtDate = (s) => (s ? +s.slice(8, 10) + '. ' + +s.slice(5, 7) + '. ' + s.slice(0, 4) : '–');
  const fmtShort = (s) => +s.slice(8, 10) + '. ' + +s.slice(5, 7) + '.';

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
    { id: 'overview', tab: 'Home', title: 'Overview', h: 'Shops at a glance', sub: 'Sessions, conversion and revenue per session per shop, the funnel, and the change against the previous period and last year.' },
    { id: 'categories', tab: 'Funnel', title: 'Funnel by category', h: 'Funnel by category', sub: 'Item views, add-to-carts, checkouts and purchases per product category. GA4 does not split item metrics by device, so this page always covers all devices.' },
    { id: 'devices', tab: 'Devices', title: 'Mobile vs desktop', h: 'Mobile vs desktop', sub: 'Conversion and funnel steps per device and shop. Desktop is shown with and without purchases that GA4 received without a browser session.' },
    { id: 'landing', tab: 'Landing', title: 'Landing pages', h: 'Landing pages', sub: 'Entry pages with traffic but no sales, and the biggest drops against the comparison period. Landing pages are counted in whole weeks (Monday to Sunday).' },
    { id: 'browsers', tab: 'Browsers', title: 'Browsers & devices', h: 'Browsers & devices', sub: 'Browser and operating-system combinations whose conversion is far from their shop and device average: a list of things that may be broken.' },
    { id: 'promotions', tab: 'Promos', title: 'Promotions', h: 'Promotions', sub: 'Banner and upsell promotions: views, clicks, click-through rate and what they sold.' },
    { id: 'checks', tab: 'Checks', title: 'Data checks', h: 'Data checks', sub: 'Tracking problems that bend the numbers: purchases without sessions, inflated item views, refunds sent as purchases, duplicates.' },
  ];
  const DEVICE_LABEL = { '': 'All devices', mobile: 'Mobile', desktop: 'Desktop', tablet: 'Tablet' };

  // ── state (live numbers only in memory) ─────────────────────────────────
  let SESSION = { checked: false, failed: false, signedIn: false, allowed: false, email: null };
  let META = null;
  let DATA = new Map();
  let renderSeq = 0;
  const ui = { sort: {}, open: {}, show: {}, q: {}, minS: 100, flagged: true };
  // filter defaults; content = landing pages shown: all, shop pages only, or content (blog, help) only
  const FDEF = { shop: '', device: '', preset: '28', from: '', to: '', compare: 'prev', content: 'all' };
  const F = loadFilters();
  const filtersAtDefault = () => Object.keys(FDEF).every((k) => k === 'from' || k === 'to' || F[k] === FDEF[k]) && ui.minS === 100 && ui.flagged && !Object.values(ui.q).some(Boolean);

  function loadFilters() {
    const d = Object.assign({}, FDEF);
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
  function signIn() { if (window.StratumSync && window.StratumSync.signIn) window.StratumSync.signIn(); else toast('Sign-in is not available on this server.'); }

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
    const PRESET = { '7': 'Last 7 days', '28': 'Last 28 days', '90': 'Last 90 days', mtd: 'Month to date', custom: 'Custom range' };
    const open = el.classList.contains('open');
    el.innerHTML =
      '<div class="fsum"><div class="fdr"><b>' + esc(PRESET[F.preset] || 'Custom range') + '</b><span>' + fmtDate(w.from) + ' – ' + fmtDate(w.to) + '</span></div>' +
        '<button type="button" class="fbtn" data-act="ftog" aria-expanded="' + open + '" aria-controls="filters"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>vs ' + esc(cmpName(F.compare)) + '</button></div>' +
      '<div class="f"><label for="fShop">Shop</label><select class="select" id="fShop" data-act="fsel" data-k="shop"><option value="">All shops</option>' +
        META.shops.map((s) => '<option value="' + esc(s.shop) + '"' + (F.shop === s.shop ? ' selected' : '') + '>' + esc(s.label) + ' · ' + esc(s.market) + '</option>').join('') + '</select></div>' +
      '<div class="f"><label for="fDev">Device</label><select class="select" id="fDev" data-act="fsel" data-k="device">' +
        Object.entries(DEVICE_LABEL).map(([v, l]) => '<option value="' + v + '"' + (F.device === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></div>' +
      '<div class="f wide"><span class="label" id="lPer">Period</span>' + seg('preset', [['7', '7 days'], ['28', '28 days'], ['90', '90 days'], ['mtd', 'Month to date'], ['custom', 'Custom']]) + '</div>' +
      '<div class="f"><label for="fFrom">From</label><input class="date" type="date" id="fFrom" data-act="fdate" data-k="from" value="' + w.from + '" min="' + esc(META.dataFrom || '') + '" max="' + esc(META.dataThrough || '') + '"></div>' +
      '<div class="f"><label for="fTo">To</label><input class="date" type="date" id="fTo" data-act="fdate" data-k="to" value="' + w.to + '" min="' + esc(META.dataFrom || '') + '" max="' + esc(META.dataThrough || '') + '"></div>' +
      '<div class="f wide"><span class="label">Compare with</span>' + seg('compare', [['prev', 'Previous period'], ['yoy', 'Last year']]) + '</div>' +
      '<div class="f freset"><button type="button" class="btn sm" data-act="freset"' + (filtersAtDefault() ? ' disabled' : '') + '>Reset filters</button></div>' +
      '<div class="fresh">GA4 data through ' + fmtDate(META.dataThrough) + (ga && ga.updated_at && !window.StratumDemo ? ' · GA4 loaded ' + g(ga) : '') + (rb && rb.updated_at && !window.StratumDemo ? ' · summary rebuilt ' + g(rb) : '') +
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
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) && !/^-\d+(,\d+)?$/.test(v)) v = "'" + v;
    v = String(v);
    return /[",;\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  function downloadCsv(id) {
    const t = TABLES[id];
    if (!t) return;
    const cols = t.cols.filter((c) => c.csv !== false);
    const head = cols.map((c) => c.csvLabel || c.label);
    // Excel with Slovenian settings: ";" between columns and a decimal comma
    const rows = t.rows.map((r) => cols.map((c) => (typeof c.csv === 'function' ? c.csv(r) : c.v ? c.v(r) : r[c.k])).map((v) => (typeof v === 'number' ? (isFinite(v) ? String(+v.toFixed(4)).replace('.', ',') : '') : v)));
    const w = win();
    const s = '﻿' + [head].concat(rows).map((r) => r.map(csvCell).join(';')).join('\r\n');
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

  // ── data notes (general GA4 caveats; the numbers themselves come from the API) ──
  function notesHtml(open, extra) {
    return '<details class="notes"' + (open ? ' open' : '') + '><summary>Data notes: read these before trusting a number</summary><ul>' +
      '<li><b>Sessionless purchases lift conversion.</b> GA4 can receive purchases without a browser session (browser “(not set)”, channel “Unassigned”), for example from a server-side tag or a payment-page redirect. They count as orders but bring no session. Where it matters, the app shows conversion with and without them (“tracked”).</li>' +
      '<li><b>Item views can be inflated</b> by bots or a tag that fires too often: far more view_item events per session on one device than on the others, or more viewing users than sessions. Rates that start from item views are then understated; use add-to-cart → purchase instead. The Data checks page flags it per shop.</li>' +
      '<li><b>No device split for categories</b>: GA4 does not combine item metrics with device, so the category funnel always covers all devices.</li>' +
      '<li><b>Funnel steps are event counts</b> (a shopper can add to cart several times), shown per 100 sessions; purchases are GA4 transactions. Shipping and payment-info events fire several times per checkout, so they are left out of the funnel.</li>' +
      (extra || '') + '</ul></details>';
  }

  // ── gate (no access) ────────────────────────────────────────────────────
  function gateHtml() {
    let box;
    if (!SESSION.checked) box = '<p class="loading" role="status"><i aria-hidden="true"></i>Checking your access…</p>';
    else if (SESSION.failed) box = '<div class="box"><p>Could not check your access right now. The server may be restarting or you are offline.</p><button type="button" class="btn pri" data-act="recheck">Try again</button></div>';
    else if (!SESSION.signedIn) box = '<div class="box"><p><b>Live data for approved accounts — sign in.</b> Your Business Apps account must be on the list for this app.</p><button type="button" class="btn pri" data-act="signin">Sign in</button></div>';
    else box = '<div class="box"><p>Signed in as <b>' + esc(SESSION.email) + '</b>, but <b>your account is not on the list</b> for live webshop data. Ask the app owner to add it, or sign in with another account.</p><button type="button" class="btn" data-act="signin">Switch account</button></div>';
    return '<div class="gate"><span class="eyebrow">Business Apps · e-commerce & UX</span><h1 tabindex="-1">Webshop conversion health</h1>' +
      '<p class="lead">How shoppers behave on the webshops (Tokovi Optika SI, Tokovi Optika HR, Tokovi Lenses IT): where they drop off, by shop, device, product category and landing page, and what looks broken. Built every morning from Google Analytics 4. Ad spend is in Ads & Return.</p>' +
      '<ul><li>Overview per shop: sessions, conversion, revenue per session and the funnel, against the previous period and last year.</li>' +
      '<li>Funnel by category: contact lenses vs frames vs sunglasses and more.</li>' +
      '<li>The mobile vs desktop gap per shop.</li><li>Landing pages with traffic but no sales, and the biggest drops.</li>' +
      '<li>Browsers and devices with abnormal conversion: a possible breakage list.</li><li>Promotions, and the data checks that bend the numbers.</li></ul>' + box + '</div>';
  }

  // ── overview chart: metric tabs over a daily line, the comparison dashed (drawn at the width it is shown at) ──
  const compact = (v) => (Math.abs(v) >= 1e6 ? NF1.format(v / 1e6) + ' M' : Math.abs(v) >= 1e4 ? NF0.format(v / 1e3) + ' k' : Math.abs(v) >= 1e3 ? NF1.format(v / 1e3) + ' k' : NF0.format(v));
  const METRICS = [
    { k: 'sessions', label: 'Sessions', fmt: num, kind: 'rel', day: (d) => d.sessions, ax: compact, tip: num },
    { k: 'transactions', label: 'Orders', fmt: num, kind: 'rel', day: (d) => d.transactions, ax: compact, tip: num },
    { k: 'conv', label: 'Conversion', fmt: (v) => pct(v, 2), kind: 'pp', day: (d) => div(d.transactions, d.sessions), ax: (v) => NF1.format(v * 100) + ' %', tip: (v) => pct(v, 2) },
    { k: 'rps', label: 'Revenue / session', fmt: eur2, kind: 'rel', day: (d) => div(d.revenue, d.sessions), ax: (v) => NF2.format(v) + ' €', tip: eur2 },
    { k: 'revenue', label: 'Revenue', fmt: eur, kind: 'rel', day: (d) => d.revenue, ax: (v) => compact(v) + ' €', tip: eur },
    { k: 'aov', label: 'Avg order', fmt: eur2, kind: 'rel', day: (d) => div(d.revenue, d.transactions), ax: (v) => NF0.format(v) + ' €', tip: eur2 },
  ];
  let MCH = null;   // the chart's days (page memory only)
  function drawMetric() {
    const box = $('mchart');
    if (!box || !MCH) return;
    const m = METRICS.find((x) => x.k === ui.metric) || METRICS[0];
    document.querySelectorAll('.mtab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.k === m.k)));
    box.setAttribute('aria-labelledby', 'mt-' + m.k);
    const cur = MCH.cur, cmp = MCH.cmp || [];
    if (cur.length < 2) { box.innerHTML = '<p class="empty">Pick at least two days to see the daily chart.</p>'; return; }
    const W = Math.max(280, Math.round(box.clientWidth || 600)), H = W < 560 ? 176 : 236, L = 6, R = 52, T = 10, B = 34, iw = W - L - R, ih = H - T - B;
    const v1 = cur.map(m.day), v2 = cmp.slice(0, cur.length).map(m.day);
    const hi0 = Math.max(0, ...v1.concat(v2).filter(fin));
    const raw = (hi0 || 1) / 3, mag = Math.pow(10, Math.floor(Math.log10(raw))), st = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw * 0.999);
    const ticks = [0, st, 2 * st, 3 * st], top = ticks[3];
    const n = cur.length, x = (i) => L + (i * iw) / (n - 1), y = (v) => T + ih - (v / top) * ih;
    const path = (vals) => { let d = '', pen = false; vals.forEach((v, i) => { if (!fin(v)) { pen = false; return; } d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1); pen = true; }); return d; };
    let g = ticks.map((t) => '<line class="grid" x1="' + L + '" x2="' + (W - R + 6) + '" y1="' + y(t).toFixed(1) + '" y2="' + y(t).toFixed(1) + '"/><text class="tick" x="' + (W - 2) + '" y="' + (y(t) + 3.5).toFixed(1) + '" text-anchor="end">' + esc(m.ax(t)) + '</text>').join('');
    const step = Math.max(1, Math.ceil(n / (W < 560 ? 5 : 10)));
    let lastMon = '';
    cur.forEach((d, i) => {
      if (i % step) return;
      const dt = new Date(d.date + 'T00:00:00Z'), mon = dt.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
      g += '<text class="tick" x="' + x(i).toFixed(1) + '" y="' + (H - 18) + '" text-anchor="' + (i ? 'middle' : 'start') + '">' + String(dt.getUTCDate()).padStart(2, '0') + '</text>' +
        (mon !== lastMon ? '<text class="tick" x="' + x(i).toFixed(1) + '" y="' + (H - 5) + '" text-anchor="' + (i ? 'middle' : 'start') + '">' + esc(mon) + '</text>' : '');
      lastMon = mon;
    });
    if (v2.some(fin)) g += '<path class="cmpline" d="' + path(v2) + '"/>';
    g += '<path class="line" d="' + path(v1) + '"/>';
    const bw = iw / (n - 1);
    cur.forEach((d, i) => { g += '<rect class="hit" x="' + Math.max(0, x(i) - bw / 2).toFixed(1) + '" y="' + T + '" width="' + bw.toFixed(1) + '" height="' + ih + '"><title>' + esc(fmtDate(d.date) + ': ' + m.label + ' ' + m.tip(v1[i]) + (fin(v2[i]) ? ' · ' + MCH.cmpLabel + ' ' + m.tip(v2[i]) : '')) + '</title></rect>'; });
    const tot = (vals) => vals.filter(fin);
    box.innerHTML = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(m.label + ' by day, ' + fmtDate(cur[0].date) + ' to ' + fmtDate(cur[n - 1].date) + (tot(v2).length ? ', with the ' + MCH.cmpLabel + ' dashed' : '')) + '">' + g + '</svg>';
  }
  let mrz = null;
  window.addEventListener('resize', () => { clearTimeout(mrz); mrz = setTimeout(drawMetric, 120); });

  // drop-off funnel: add to cart → checkout → purchase, column heights against add to cart, the rest striped
  function dropFunnel(c, p) {
    const steps = [['Add to cart', 'ev_add_to_cart'], ['Checkout', 'ev_begin_checkout'], ['Purchase', 'transactions']];
    if (!c.sessions || !c.ev_add_to_cart) return '';
    return '<div class="gfun">' + steps.map(([name, k], i) => {
      const v = c[k], per = div(v, c.sessions), h = Math.max(1.5, Math.min(100, (div(v, c.ev_add_to_cart) || 0) * 100));
      const prevV = i ? c[steps[i - 1][1]] : null, ab = i && prevV ? 1 - v / prevV : null;
      const pp = p && p.sessions ? div(p[k], p.sessions) : null;
      return '<div class="gstep"><b>' + (i + 1) + '. ' + esc(name) + '</b><div class="gbar" title="' + esc(name + ': ' + NF1.format((per || 0) * 100) + ' per 100 sessions') + '"><i style="height:' + h.toFixed(1) + '%"></i></div>' +
        '<em>' + (fin(per) ? NF1.format(per * 100) : '–') + ' / 100</em><span>' + (i ? 'abandoned ' + (fin(ab) && ab >= 0 ? pct(ab) : '–') : num(v) + ' events') + '</span>' + (fin(pp) ? delta(per, pp, 'rel', { label: 'vs cmp' }) : '') + '</div>';
    }).join('') + '</div>';
  }

  // insights: what in this selection is worth a look (computed from the totals already loaded)
  function insightsHtml(a) {
    const shops = META.shops.map((s) => s.shop).filter((s) => !F.shop || s === F.shop);
    const T = (s, d, per) => totalsOf(a.totals, per || 'cur', (r) => r.shop === s && (!d || r.device === d));
    const out = [];
    const sl = shops.map((s) => ({ s, t: T(s, F.device) })).filter((x) => x.t.transactions >= 20).sort((x, y) => (y.t.untracked_share || 0) - (x.t.untracked_share || 0))[0];
    if (sl && sl.t.untracked_share > 0.1) out.push(['warn', '<b>' + esc(shopLabel(sl.s)) + ':</b> ' + pct(sl.t.untracked_share) + ' of orders arrive without a session (' + num(sl.t.untracked_transactions) + ' orders).', '#/checks', 'Data checks']);
    const iv = shops.map((s) => ({ s, d: T(s, 'desktop'), m: T(s, 'mobile') })).filter((x) => x.d.sessions >= 100).sort((x, y) => (y.d.views_per_session || 0) - (x.d.views_per_session || 0))[0];
    if (iv && iv.d.views_per_session > 10) out.push(['bad', '<b>Desktop item views inflated:</b> ' + NF1.format(iv.d.views_per_session) + ' per session on ' + esc(shopLabel(iv.s)) + ', ' + (fin(iv.m.views_per_session) ? NF1.format(iv.m.views_per_session) : '–') + ' on mobile.', '#/checks', 'Data checks']);
    const md = totalsOf(a.totals, 'cur', (r) => r.device === 'mobile'), dk = totalsOf(a.totals, 'cur', (r) => r.device === 'desktop');
    if (fin(md.conv) && fin(dk.tracked_conv)) out.push(['info', '<b>Mobile converts at ' + pct(md.conv, 2) + '</b> against ' + pct(dk.tracked_conv, 2) + ' on desktop, counting tracked desktop sessions only.', '#/devices', 'Mobile vs desktop']);
    if (coverage(a.compare) !== 'none' && shops.length > 1) {
      const ch = shops.map((s) => { const c = T(s, F.device), p = T(s, F.device, 'cmp'); return { s, d: fin(c.conv) && fin(p.conv) ? c.conv - p.conv : null }; }).filter((x) => x.d != null).sort((x, y) => x.d - y.d)[0];
      if (ch && ch.d < -0.0005) out.push(['bad', '<b>' + esc(shopLabel(ch.s)) + ':</b> conversion down ' + NF2.format(Math.abs(ch.d * 100)) + ' pp against the previous period, the biggest drop of the shops.', '#/landing', 'Landing pages']);
    }
    if (!out.length) return '<p class="empty">Nothing unusual in this selection.</p>';
    const IC = { warn: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17h.01"/>', bad: '<path d="M3 7l6 6 4-4 8 8"/><path d="M15 17h6v-6"/>', info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5h.01"/>' };
    return '<ul class="ins">' + out.map((x) => '<li class="' + x[0] + '"><i aria-hidden="true"><svg viewBox="0 0 24 24">' + IC[x[0]] + '</svg></i><div>' + x[1] + ' <a href="' + x[2] + '">' + esc(x[3]) + '</a></div></li>').join('') + '</ul>';
  }

  // issues ranked by revenue at risk in euros (risk.js): broken browsers, landing pages that stopped selling, shops whose
  // conversion fell. Loads the browser and landing summaries for the same selection.
  async function issuesCard(a, pred) {
    let br, la;
    try { [br, la] = await Promise.all([api('browsers', params()), api('landing', params())]); } catch (e) {
      if (e.status === 401 || e.status === 403) throw e;
      return card('Revenue at risk', '', '<p class="empty">Could not load the browser and landing-page data: ' + esc(e.message) + '</p>');
    }
    const issues = [], min = ui.minS;
    browserRows(br).forEach((x) => { if (x.risk > 0) issues.push({ key: 'b|' + x.shop + x.device + x.browser + x.os, eur: x.risk, href: '#/browsers', tag: x.flag === 'broken' ? ['bad', 'Possible breakage'] : ['warn', 'Below average'],
      html: '<b>' + esc(x.browser) + ' · ' + esc(x.os) + '</b> on ' + esc((DEVICE_LABEL[x.device] || x.device).toLowerCase()) + (F.shop ? '' : ', ' + esc(shopLabel(x.shop))) + ': converts at ' + pct(x.conv, 2) + ' against ' + pct(x.baseline, 2) + ', about ' + NF1.format(x.missing) + ' orders missing' }); });
    const lok = coverage(la.compare) !== 'none', rps = RK.shopRps(la.rows);
    la.rows.forEach((x) => {
      if (x.page === '(other pages)' || RK.isContentPage(x.page)) return;
      const key = 'p|' + x.shop + '|' + x.page, where = esc(x.page) + (F.shop ? '' : ' <span class="muted">' + esc(shopLabel(x.shop)) + '</span>');
      if (x.sessions >= min && x.transactions === 0) { const v = RK.noSaleRisk(x, rps.get(x.shop)); if (v > 0) issues.push({ key, eur: v, href: '#/landing', tag: ['warn', 'No sales'], html: '<b>' + where + '</b>: ' + num(x.sessions) + ' sessions and no order' }); }
      if (lok && x.c_sessions >= min) { const v = RK.dropRisk({ page: x.page, d_revenue: x.revenue - x.c_revenue }); if (v > 0) issues.push({ key, eur: v, href: '#/landing', tag: ['bad', 'Revenue drop'], html: '<b>' + where + '</b>: ' + eur(x.c_revenue) + ' → ' + eur(x.revenue) + ' against the ' + esc(cmpName(la.compare.mode)) }); }
    });
    if (coverage(a.compare) !== 'none') META.shops.map((m) => m.shop).filter((sh) => !F.shop || sh === F.shop).forEach((sh) => {
      const p2 = (r) => r.shop === sh && pred(r), c = totalsOf(a.totals, 'cur', p2), p = totalsOf(a.totals, 'cmp', p2), v = RK.convDropRisk(c.sessions, p.conv, c.conv, c.aov);
      if (v > 0) issues.push({ key: 's|' + sh, eur: v, href: '#/devices', tag: ['bad', 'Conversion down'], html: '<b>' + esc(shopLabel(sh)) + '</b>: conversion ' + pct(p.conv, 2) + ' → ' + pct(c.conv, 2) + ' on ' + num(c.sessions) + ' sessions' });
    });
    const R0 = RK.rank(issues), top = R0.list.slice(0, 6);
    TABLES.risk = { name: 'revenue-at-risk', rows: R0.list, cols: [{ k: 'what', label: 'Issue', v: (x) => x.tag[1] }, { k: 'detail', label: 'Detail', v: (x) => x.html.replace(/<[^>]+>/g, '') }, { k: 'eur', label: 'Revenue at risk EUR', v: (x) => Math.round(x.eur) }] };
    const body = top.length ? '<ul class="risk">' + top.map((x) => '<li><div>' + badge(x.tag[0], x.tag[1]) + ' <span>' + x.html + '</span></div><a href="' + x.href + '"><b>' + eur(x.eur) + '</b></a></li>').join('') + '</ul>' +
      (R0.list.length > top.length ? '<p class="muted small">' + num(R0.list.length - top.length) + ' more issues, ' + eur(R0.total - top.reduce((s0, x) => s0 + x.eur, 0)) + ' together, in the CSV.</p>' : '')
      : '<p class="empty">Nothing in this selection puts revenue at risk.</p>';
    return card('Revenue at risk' + (R0.total ? ': ' + eur(R0.total) : ''), 'Estimated euros per issue in this period: missing orders × average order for browsers, sessions × the shop\'s usual revenue per session for pages without sales (landing pages count whole weeks), lost conversion × sessions × average order for shops. Blog and help pages are left out.', body, csvBtn('risk'));
  }

  // ── pages ───────────────────────────────────────────────────────────────
  async function pageOverview() {
    const [a, b] = await Promise.all([api('overview', params({ compare: 'prev' })), api('overview', params({ compare: 'yoy' }))]);
    const dev = F.device;
    const pred = (r) => !dev || r.device === dev;
    const cur = totalsOf(a.totals, 'cur', pred), prev = totalsOf(a.totals, 'cmp', pred), ly = totalsOf(b.totals, 'cmp', pred);
    const ok = (resp) => coverage(resp.compare) !== 'none';
    const pv = ok(a) ? prev : {}, lv = ok(b) ? ly : {};
    const cmpResp = F.compare === 'yoy' ? b : a, cmpT = F.compare === 'yoy' ? lv : pv;
    // the comparison period by day, for the dashed line (only when it is fully kept)
    let cmpDays = null;
    if (coverage(cmpResp.compare) === 'full') {
      try { const c = await api('overview', { from: cmpResp.compare.from, to: cmpResp.compare.to, shop: F.shop, device: F.device, compare: 'prev' }); cmpDays = dailyRows(c.daily, true); } catch (e) { if (e.status === 401 || e.status === 403) throw e; }
    }
    MCH = { cur: dailyRows(a.daily), cmp: cmpDays, cmpLabel: cmpName(cmpResp.compare.mode) };
    if (!METRICS.some((m) => m.k === ui.metric)) ui.metric = 'sessions';
    const tab = (m) => '<button type="button" class="kpi mtab" role="tab" id="mt-' + m.k + '" aria-controls="mchart" aria-selected="' + (ui.metric === m.k) + '" data-act="metric" data-k="' + m.k + '"><span class="label">' + esc(m.label) + '</span><span class="v">' + m.fmt(cur[m.k]) + '</span><span class="d">' +
      delta(cur[m.k], pv[m.k], m.kind, { label: 'vs prev' }) + delta(cur[m.k], lv[m.k], m.kind, { label: 'vs LY' }) + '</span></button>';
    const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
    let html = notesHtml(false) + covNote(a, 'previous period') + covNote(b, 'last year') +
      '<section class="card mcard" aria-label="Key metrics by day"><div class="mtabs" role="tablist" aria-label="Metric shown in the chart">' + METRICS.map(tab).join('') + '</div>' +
      '<div class="mbody"><div class="mhead"><span>' + (dev ? esc(DEVICE_LABEL[dev]) + ' · ' : '') + 'by day ' + (F.shop ? 'for ' + esc(shopLabel(F.shop)) : 'for all shops') + '</span>' + csvBtn('daily') + '</div>' +
      '<div class="mchart" id="mchart" role="tabpanel"></div>' +
      '<div class="mlegend"><span><i></i>' + esc(fmtShort(a.window.from)) + ' – ' + esc(fmtShort(a.window.to)) + '</span>' + (cmpDays ? '<span><i class="cmp"></i>' + esc(cap(cmpName(cmpResp.compare.mode))) + '</span>' : '') + '</div></div></section>';

    // funnel + insights
    html += '<div class="cols">' + card('Where shoppers drop off', 'Events per 100 sessions, ' + esc(fmtShort(a.window.from)) + '–' + esc(fmtShort(a.window.to)) + ' against the ' + esc(cmpName(cmpResp.compare.mode)) + '.', dropFunnel(cur, cmpT) + funnelHtml(cur, cmpT)) +
      card('Insights', 'Worth a look in this selection.', insightsHtml(a)) + '</div>';
    html += await issuesCard(a, pred);

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
    return html;
  }
  function dailyRows(daily, noCsv) {
    const m = new Map();
    for (const r of daily) {
      if (F.device && r.device !== F.device) continue;
      const d = m.get(r.date) || { date: r.date, sessions: 0, transactions: 0, revenue: 0, untracked_transactions: 0 };
      d.sessions += r.sessions; d.transactions += r.transactions; d.revenue += r.revenue; d.untracked_transactions += r.untracked_transactions;
      m.set(r.date, d);
    }
    const rows = [...m.values()].sort((x, y) => (x.date < y.date ? -1 : 1));
    if (noCsv) return rows;
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
      card('Funnel by category', (F.shop ? esc(shopLabel(F.shop)) : 'All shops') + ' · ' + esc(fmtShort(r.window.from)) + '–' + esc(fmtShort(r.window.to)) + ' · Δ against the ' + esc(cmpName(r.compare.mode)) + '. Open a group to see its categories. Categories that are added in a configurator rather than viewed get few item views, so their view-based rates can read over 100 %.',
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
      html += '<div class="cols">' + card('View → purchase by shop', 'Purchases per item view. Inflated item views (see data notes) make this rate look low.', matrix('v2p', 'View to purchase')) +
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
    const pageCell = (x) => esc(x.page) + (RK.isContentPage(x.page) ? ' ' + badge('', 'content') : '') + (x.page === '(not set)' ? ' ' + badge('info', 'no page_view', 'Sessions without a page_view event (consent mode, app or tag timing)') : '') + (x.page === '(other pages)' ? ' ' + badge('', 'outside top 250') : '');
    // revenue at risk: a shop page with traffic and no sales would have sold at its shop's usual revenue per session;
    // a drop lost what it earned before (content pages such as blog and help are not expected to sell)
    const rps = RK.shopRps(rows);
    rows.forEach((x) => { x.risk = x.transactions === 0 ? RK.noSaleRisk(x, rps.get(x.shop)) : 0; x.lost = okc ? RK.dropRisk(x) : 0; });
    const mode = F.content === 'shop' || F.content === 'content' ? F.content : 'all';
    const real = RK.filterPages(rows.filter((x) => x.page !== '(other pages)'), mode);
    const nosale = real.filter((x) => x.sessions >= min && x.transactions === 0);
    const drops = okc ? real.filter((x) => x.c_sessions >= min && (x.d_revenue < 0 || x.d_sessions < 0)) : [];
    const riskCell = (v, why) => (v > 0 ? '<b>' + eur(v) + '</b>' + (why ? '<small>' + esc(why) + '</small>' : '') : '<span class="muted">–</span>');
    const base = [{ k: 'page', label: 'Landing page', html: pageCell, v: (x) => x.page, cls: 'name' }, { k: 'shop', label: 'Shop', v: (x) => x.shop, csv: (x) => x.shop, html: (x) => esc(shopLabel(x.shop)), hide: !!F.shop }];
    const c1 = base.concat([
      { k: 'sessions', label: 'Sessions', num: true, html: (x) => num(x.sessions) },
      { k: 'risk', label: '€ at risk', num: true, csvLabel: 'Revenue at risk EUR', html: (x) => (RK.isContentPage(x.page) ? '<span class="muted">content</span>' : riskCell(x.risk, 'at ' + eur2(rps.get(x.shop)) + ' / session')) },
      { k: 'engaged', label: 'Engaged', num: true, csv: (x) => (fin(x.engaged) ? x.engaged * 100 : null), csvLabel: 'Engaged %', html: (x) => pct(x.engaged) },
      { k: 'c_sessions', label: 'Sessions before', num: true, html: (x) => (okc ? num(x.c_sessions) : '–') },
      { k: 'c_transactions', label: 'Orders before', num: true, html: (x) => (okc ? num(x.c_transactions) : '–') },
    ]).filter((c) => !c.hide);
    const c2 = base.concat([
      { k: 'lost', label: '€ at risk', num: true, csvLabel: 'Revenue at risk EUR', html: (x) => (RK.isContentPage(x.page) ? '<span class="muted">content</span>' : riskCell(x.lost, 'lost vs before')) },
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
    const all = RK.filterPages(q ? rows.filter((x) => x.page.toLowerCase().includes(q)) : rows, mode);
    const nContent = rows.filter((x) => RK.isContentPage(x.page)).length;
    const contentSeg = '<div class="seg" role="group" aria-label="Landing pages shown">' + [['all', 'All pages'], ['shop', 'Shop pages'], ['content', 'Blog & help']].map(([v, l]) => '<button type="button" data-act="content" data-v="' + v + '" aria-pressed="' + (mode === v) + '">' + l + '</button>').join('') + '</div>';
    const riskNo = nosale.reduce((a, x) => a + x.risk, 0), riskDrop = drops.reduce((a, x) => a + x.lost, 0);
    const minSel = '<label class="sr" for="minS">Minimum sessions</label><select class="select" id="minS" data-act="minS">' + [30, 100, 300, 1000].map((n) => '<option value="' + n + '"' + (n === min ? ' selected' : '') + '>min. ' + n + ' sessions</option>').join('') + '</select>';
    const span = fmtDate(r.window.from) + ' – ' + fmtDate(r.window.to) + ' (' + r.window.weeks + (r.window.weeks === 1 ? ' week' : ' weeks') + ')';
    let html = '<div class="lfilter">' + contentSeg + '<span class="muted">' + num(nContent) + ' blog and help pages (paths like /blog/… and /help/…): they inform rather than sell, so they never count as revenue at risk.</span></div>' +
      '<p class="callout">Whole weeks only: ' + esc(span) + ', compared with ' + esc(fmtDate(r.compare.from)) + ' – ' + esc(fmtDate(r.compare.to)) + ' (' + esc(cmpName(r.compare.mode)) + '). Each week keeps its top 250 pages per shop; the rest are in “(other pages)”. Add-to-carts are not split by landing page in GA4, so they are left out.' + (F.device ? ' Device: ' + esc(DEVICE_LABEL[F.device]) + '.' : '') + '</p>' + covNote(r) +
      '<div class="cols">' + card('Traffic but no sales', 'Pages with at least ' + num(min) + ' sessions and no order' + (riskNo > 0 ? ' · <b>' + eur(riskNo) + ' at risk</b>' : '') + '.', table('nosale', c1, nosale, { caption: 'Traffic but no sales', limit: 25, sort: { k: 'risk', dir: -1 }, empty: 'Every landing page with this much traffic sold something.' }), minSel + csvBtn('nosale')) +
      card('Biggest drops', okc ? 'Pages that had at least ' + num(min) + ' sessions before, sorted by lost revenue' + (riskDrop > 0 ? ' · <b>' + eur(riskDrop) + ' lost</b>' : '') + '.' : 'No comparison data for this period.', table('drops', c2, drops, { caption: 'Biggest drops', limit: 25, sort: { k: 'd_revenue', dir: 1 }, empty: 'No drops for this selection.' }), csvBtn('drops')) + '</div>' +
      card('All landing pages', 'Top ' + num(rows.length) + ' pages by sessions in either period.', table('landing', c3, all, { caption: 'All landing pages', limit: 100, tall: true, sort: { k: 'sessions', dir: -1 } }),
        '<label class="sr" for="qLanding">Search landing pages</label><input class="search" id="qLanding" type="search" placeholder="Search pages" data-act="q" data-t="landing" value="' + esc(ui.q.landing || '') + '">' + csvBtn('landing'));
    return html;
  }

  // each browser + OS against its shop and device average (shared by the Browsers page and the overview's issues)
  function browserRows(r) {
    const cur = r.rows.filter((x) => x.period === 'cur'), cmp = r.rows.filter((x) => x.period === 'cmp');
    const NOTSET = (x) => x.browser === '(not set)';
    const base = new Map();
    for (const x of cur) {
      if (NOTSET(x)) continue;
      const k = x.shop + '|' + x.device, b = base.get(k) || { s: 0, t: 0, r: 0 };
      b.s += x.sessions; b.t += x.transactions; b.r += x.revenue || 0; base.set(k, b);
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
      const o = Object.assign({}, x, { baseline, conv, expected, z, missing: fin(expected) ? expected - x.transactions : null, aov: div(b.r, b.t), c_conv: p ? div(p.transactions, p.sessions) : null, c_sessions: p ? p.sessions : 0, flag, eng: div(x.engaged_sessions, x.sessions) });
      o.risk = RK.browserRisk(o, o.aov); // missing orders × the shop and device's average order
      return o;
    });
    return rows;
  }
  async function pageBrowsers() {
    const r = await api('browsers', params());
    const okc = coverage(r.compare) !== 'none';
    const rows = browserRows(r), min = ui.minS;
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
      { k: 'risk', label: '€ at risk', num: true, csvLabel: 'Revenue at risk EUR', html: (x) => (x.risk > 0 ? '<b>' + eur(x.risk) + '</b><small>avg order ' + eur2(x.aov) + '</small>' : '<span class="muted">–</span>') },
      { k: 'c_conv', label: 'Before', num: true, csv: (x) => (okc && fin(x.c_conv) ? x.c_conv * 100 : null), csvLabel: 'Conversion comparison %', html: (x) => (okc ? pct(x.c_conv, 2) + '<small>' + num(x.c_sessions) + ' sessions</small>' : '–') },
      { k: 'revenue', label: 'Revenue', num: true, csvLabel: 'Revenue EUR', html: (x) => eur(x.revenue) },
    ].filter((c) => (c.k === 'shop' || c.k === 'device' ? false : true));
    const csvCols = cols.concat([{ k: 'shop', label: 'Shop' }, { k: 'device', label: 'Device' }, { k: 'baseline', label: 'Shop+device avg conversion %', v: (x) => (fin(x.baseline) ? x.baseline * 100 : null) }]);
    const nb = rows.filter((x) => x.flag === 'broken').length, nl = rows.filter((x) => x.flag === 'low').length;
    const ns = rows.filter((x) => x.flag === 'sessionless').reduce((a, x) => a + x.transactions, 0);
    const atRisk = rows.reduce((a, x) => a + (x.risk || 0), 0);
    const tbl = table('browsers', cols, shown, { caption: 'Browsers and devices', limit: 60, tall: true, sort: { k: 'flag', dir: 1 }, empty: ui.flagged ? 'Nothing abnormal: every browser with at least ' + min + ' sessions converts close to its shop and device average.' : 'No browser data.' });
    TABLES.browsers.cols = csvCols;
    const ctl = '<div class="seg" role="group" aria-label="Rows"><button type="button" data-act="flagged" data-v="1" aria-pressed="' + ui.flagged + '">Flagged</button><button type="button" data-act="flagged" data-v="0" aria-pressed="' + !ui.flagged + '">All</button></div>' +
      '<label class="sr" for="minS">Minimum sessions</label><select class="select" id="minS" data-act="minS">' + [30, 100, 300, 1000].map((n) => '<option value="' + n + '"' + (n === min ? ' selected' : '') + '>min. ' + n + ' sessions</option>').join('') + '</select>' + csvBtn('browsers');
    return covNote(r) + '<div class="kpis"><div class="kpi"><span class="label">Possible breakage</span><span class="v">' + num(nb) + '</span><span class="d">conversion under half the average, z ≤ −3</span></div>' +
      '<div class="kpi"><span class="label">Below average</span><span class="v">' + num(nl) + '</span><span class="d">under 75 % of the average, z ≤ −2</span></div>' +
      '<div class="kpi"><span class="label">Revenue at risk</span><span class="v">' + eur(atRisk) + '</span><span class="d">missing orders × average order, flagged browsers</span></div>' +
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
      '<p class="callout">A view is counted for every promoted item shown, so cart upsells reach millions of views and a CTR near zero. Banners rarely show purchases: GA4 credits a promotion only for the promoted item itself.</p>' +
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
      '<li><b>Landing page “(not set)”</b> means sessions without a page_view event (consent banners or tag timing); watch it when it grows.</li>') +
      card('Tracking checks per shop', esc(fmtShort(r.window.from)) + '–' + esc(fmtShort(r.window.to)) + (F.device ? ' · ' + esc(DEVICE_LABEL[F.device]) + ' (purchase checks); item-view checks are per device' : ''), table('checks', cols, rows, { caption: 'Tracking checks', sort: { k: 'sl', dir: -1 } }), csvBtn('checks'));
  }

  const LOADERS = { overview: pageOverview, categories: pageCategories, devices: pageDevices, landing: pageLanding, browsers: pageBrowsers, promotions: pagePromotions, checks: pageChecks };

  // ── render ──────────────────────────────────────────────────────────────
  function route() { const m = /^#\/([a-z]+)/.exec(location.hash || ''); return m && LOADERS[m[1]] ? m[1] : 'overview'; }
  function renderNav(active) {
    $('nav').innerHTML = SESSION.allowed ? PAGES.map((p) => '<a href="#/' + p.id + '"' + (p.id === active ? ' aria-current="page"' : '') + '><svg viewBox="0 0 24 24" aria-hidden="true">' + ICON[p.id] + '</svg><span class="nl">' + esc(p.title) + '</span><span class="ns">' + esc(p.tab) + '</span></a>').join('') : '';
    $('sideFoot').innerHTML = SESSION.allowed
      ? '<span class="pill"><i aria-hidden="true"></i>' + (window.StratumDemo ? 'Demo data · made-up GA4 numbers' : 'Live GA4 data · ' + esc(SESSION.email || '')) + ' · kept in memory only</span>'
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
      document.title = 'Webshop conversion health — Business Apps';
      return;
    }
    if (!META) {
      page.innerHTML = '<p class="loading" role="status"><i aria-hidden="true"></i>Loading webshop data…</p>';
      try { META = await api('meta'); } catch (e) { if (seq === renderSeq && SESSION.allowed) page.innerHTML = errorHtml(e); return; }
      if (F.shop && !META.shops.some((x) => x.shop === F.shop)) { F.shop = ''; saveFilters(); } // a remembered shop that no longer exists
      if (seq !== renderSeq) return;
    }
    renderFilters();
    const P = PAGES.find((p) => p.id === id);
    document.title = P.title + ' · Webshop health — Business Apps';
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
    if (id === 'overview') drawMetric();
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
    ftog: (el) => { const f = $('filters'), o = !f.classList.contains('open'); f.classList.toggle('open', o); el.setAttribute('aria-expanded', String(o)); },
    metric: (el) => { ui.metric = el.dataset.k; drawMetric(); },
    content: (el) => { F.content = el.dataset.v; saveFilters(); rerender(); },
    freset: () => {
      Object.assign(F, FDEF); ui.minS = 100; ui.flagged = true; ui.q = {}; ui.show = {};
      saveFilters(); toast('Filters reset: all shops and devices, last 28 days against the previous period.'); render();
      setTimeout(() => { const b = document.querySelector('[data-act="freset"]'); if (b) b.focus(); }, 300);
    },
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

  // re-check access whenever the Business Apps account changes (sign in / out / switch)
  if (window.StratumSync && window.StratumSync.on) {
    let last = null;
    window.StratumSync.ready.then(() => {
      last = (window.StratumSync.user() || {}).email || '';
      window.StratumSync.on(() => { const now = (window.StratumSync.user() || {}).email || ''; if (now !== last) { last = now; forgetLive(); SESSION.checked = false; render(); checkSession(); } });
    });
  }
  render();
  checkSession();
})();
