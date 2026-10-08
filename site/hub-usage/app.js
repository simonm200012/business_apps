/* Hub usage & speed — live data only (server: /hubusage.js, summary dataset hubusage_app).
 * How the Adrial Hub portal is used and how fast it is: active users, apps, pages, speed, errors and cloud cost.
 * Every number lives in page memory only (LC / META): nothing fetched is written to localStorage, IndexedDB or a
 * sync snapshot. localStorage keeps view preferences only (range, retire threshold, picked apps).
 * Privacy: the API returns counts of distinct users, never a user id, name or e-mail. */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const API = '/api/hubusage/';
  const UIKEY = 'adrial-hubusage-ui';
  const RANGES = [['30', '30 days'], ['90', '90 days'], ['182', '6 months'], ['400', '13 months']];

  // ── helpers ──────────────────────────────────────────────────────────────
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* blocked */ } }
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dShort = (d) => (d ? +d.slice(8, 10) + ' ' + MON[+d.slice(5, 7) - 1] : '–');
  const dLong = (d) => (d ? dShort(d) + ' ' + d.slice(0, 4) : '–');
  function addDays(d, n) { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }
  function monday(d) { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() - (t.getUTCDay() + 6) % 7); return t.toISOString().slice(0, 10); }
  function daysBetween(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5); }
  function dateList(from, to) { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; }
  const num = (v) => (v == null || !isFinite(v) ? '–' : Math.round(v).toLocaleString('en-GB'));
  function fmtMs(v) {
    if (v == null || !isFinite(v)) return '–';
    if (v < 1000) return Math.round(v) + ' ms';
    if (v < 10000) return (v / 1000).toFixed(1) + ' s';
    if (v < 60000) return Math.round(v / 1000) + ' s';
    return (v / 60000).toFixed(1) + ' min';
  }
  const pct = (x, d) => (x == null || !isFinite(x) ? '–' : (x * 100).toFixed(d == null ? 1 : d) + ' %');
  const rate = (a, b) => (b ? a / b : null);
  function usd(v) {
    if (v == null || !isFinite(v)) return '–';
    return (v < 0 ? '−$' : '$') + Math.abs(v).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  const sum = (rows, k) => rows.reduce((a, r) => a + (+r[k] || 0), 0);
  function median(a) { const v = a.filter((x) => x != null).sort((x, y) => x - y); if (!v.length) return null; const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; }
  function ic(n) {
    const P = {
      home: '<path d="M4 11l8-7 8 7v9H4z"/><path d="M10 20v-6h4v6"/>', grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
      speed: '<path d="M4 15a8 8 0 1 1 16 0"/><path d="M12 15l4-5"/>', err: '<path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17v.5"/>',
      cost: '<path d="M12 3v18"/><path d="M16.5 7.5c-1-1.2-2.6-1.8-4.5-1.8-2.5 0-4.2 1.3-4.2 3.1 0 4.4 9 2.3 9 6.6 0 1.9-1.9 3.2-4.6 3.2-2 0-3.8-.7-4.9-2"/>',
      exp: '<path d="M12 4v11M7 10l5 5 5-5"/><path d="M5 20h14"/>', back: '<path d="M15 6l-6 6 6 6"/>', app: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M4 9h16"/>',
    };
    return '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">' + (P[n] || '') + '</svg>';
  }
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 3200); }

  // ── preferences (never numbers) ──────────────────────────────────────────
  let ui = {};
  try { ui = JSON.parse(lsGet(UIKEY) || '{}') || {}; } catch (e) { ui = {}; }
  if (!RANGES.some((r) => r[0] === ui.range)) ui.range = '90';
  if (!(ui.minUsers >= 0 && ui.minUsers <= 1000)) ui.minUsers = 3;
  ui.countAdmins = !!ui.countAdmins;
  if (!Array.isArray(ui.speedPick)) ui.speedPick = [];
  ['appsFilter', 'speedApp', 'errApp', 'costService'].forEach((k) => { if (typeof ui[k] !== 'string') ui[k] = ''; });
  function saveUi() { lsSet(UIKEY, JSON.stringify({ range: ui.range, minUsers: ui.minUsers, countAdmins: ui.countAdmins, speedPick: ui.speedPick, appsFilter: ui.appsFilter, speedApp: ui.speedApp, errApp: ui.errApp, costService: ui.costService })); }
  let search = { apps: '', cost: '' };   // search boxes: page memory only

  // ── live data: session, fetching, page-memory cache ──────────────────────
  let SESSION = { checked: false, failed: false, signedIn: false, allowed: false, email: null };
  let META = null, LC = {}, gen = 0, rrTimer = null;
  function apiUrl(r, params) {
    const q = [];
    Object.keys(params || {}).forEach((k) => { const v = params[k]; if (v !== '' && v != null) q.push(encodeURIComponent(k) + '=' + encodeURIComponent(v)); });
    return API + r + (q.length ? '?' + q.join('&') : '');
  }
  function lfetch(url) {
    return fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' }, cache: 'no-store' }).then((r) => r.json().catch(() => ({})).then((j) => {
      if (r.ok) return j;
      const msg = j && typeof j.error === 'string' && j.error ? j.error.slice(0, 300) :
        r.status === 401 ? 'Sign in to see live Hub usage data.' : r.status === 403 ? 'Your account is not on the list for live Hub usage data.' : 'The Hub usage data is unavailable right now.';
      const e = new Error(msg); e.status = r.status; throw e;
    }), () => { const e = new Error('Could not reach the server. Check the connection and try again.'); e.status = 0; throw e; });
  }
  function lget(url) {
    let c = LC[url];
    if (c) return c;
    const g = gen;
    c = LC[url] = { status: 'loading' };
    lfetch(url).then((d) => {
      if (g !== gen || LC[url] !== c) return;
      c.status = 'ok'; c.data = d; changed();
    }, (e) => {
      if (g !== gen || LC[url] !== c) return;
      c.status = 'error'; c.err = e.message; c.code = e.status;
      if (e.status === 401 || e.status === 403) denied(e.status); else changed();
    });
    return c;
  }
  function changed() { clearTimeout(rrTimer); rrTimer = setTimeout(() => { if (SESSION.allowed && META) rerender(); }, 30); }
  function forget() { gen++; LC = {}; META = null; metaP = null; Object.keys(charts).forEach((k) => delete charts[k]); Object.keys(TABLES).forEach((k) => delete TABLES[k]); }
  // a 401/403 anywhere: forget every number held by the page and show the access page
  function denied(code) {
    forget();
    SESSION.allowed = false;
    if (code === 401) SESSION.signedIn = false;
    toast(code === 401 ? 'Your sign-in ended: live data is hidden.' : 'This account has no access to live Hub usage data.');
    renderGate();
    checkSession();
  }
  function lwait(cs, what) {
    for (let i = 0; i < cs.length; i++) if (cs[i].status === 'error') return lerror(cs[i]);
    for (let j = 0; j < cs.length; j++) if (cs[j].status !== 'ok') return '<div class="card pad"><p class="loading" role="status" style="margin:10px 0"><i aria-hidden="true"></i>Loading ' + esc(what) + '…</p></div>';
    return null;
  }
  function lerror(c) {
    const t = { 0: 'Could not reach the server', 400: 'That could not be looked up' }[c.code] || 'Could not load this part of the data';
    return '<div class="card pad lerr" role="alert"><h2>' + esc(t) + '</h2><p>' + esc(c.err || '') + '</p><div class="dr-actions">' +
      (c.code !== 400 ? '<button type="button" class="btn" data-act="retry" data-fid="retry">Try again</button>' : '<a class="btn" href="#/">Back to the overview</a>') + '</div></div>';
  }

  let sessP = null;
  function checkSession() {
    if (sessP) return sessP;
    sessP = fetch(API + 'session', { credentials: 'same-origin', headers: { Accept: 'application/json' }, cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error('session ' + r.status); return r.json(); })
      .then((j) => { SESSION = { checked: true, failed: false, signedIn: !!j.signedIn, allowed: !!j.allowed, email: j.email || null }; },
        () => { SESSION = { checked: true, failed: true, signedIn: false, allowed: false, email: null }; })
      .then(() => { sessP = null; if (SESSION.allowed) start(); else { forget(); renderGate(); } });
    return sessP;
  }
  let metaP = null;
  function start() {
    if (META) { rerender(); return; }
    if (metaP) return;
    const g = gen;
    $('page').innerHTML = '<p class="loading" role="status"><i aria-hidden="true"></i>Loading Hub usage…</p>';
    metaP = lfetch(API + 'meta').then((d) => { metaP = null; if (g !== gen) return; META = d; rerender(); }, (e) => {
      metaP = null; if (g !== gen) return;
      if (e.status === 401 || e.status === 403) return denied(e.status);
      renderChrome();
      $('page').innerHTML = lerror({ code: e.status, err: e.message }).replace('data-act="retry"', 'data-act="retryMeta"');
    });
  }
  function watchAuth() {
    if (!window.AdrialSync || !window.AdrialSync.on) return;
    // Start comparing only once the sign-in library knows who is signed in: its first "loaded" event is
    // not an account change (treating it as one dropped the first data request and left the page loading).
    const ready = window.AdrialSync.ready || Promise.resolve();
    ready.then(() => {
      let last = (window.AdrialSync.user() || {}).email || '';
      window.AdrialSync.on(() => { const now = (window.AdrialSync.user() || {}).email || ''; if (now !== last) { last = now; forget(); checkSession(); } });
    });
  }

  // ── windows ──────────────────────────────────────────────────────────────
  const thru = () => (META && META.dataThrough) || addDays(new Date().toISOString().slice(0, 10), -1);
  const costThru = () => (META && META.costThrough) || thru();
  function firstDay(src) { const f = ((META && META.freshness) || []).find((x) => x.source === src); return (f && f.first_day) || '2000-01-01'; }
  // the chosen period, never starting before the first day the source has data
  function win(to, src) {
    to = to || thru();
    let from = addDays(to, -(+ui.range - 1)); const f = firstDay(src || 'Hub usage events');
    if (from < f && f <= to) from = f;
    return { from: from, to: to };
  }
  const appsById = () => { const o = {}; ((META && META.apps) || []).forEach((a) => { o[a.app_id] = a; }); return o; };

  // retire-candidate rule (editable: fewer than N users in the last 30 days, apps older than 30 days)
  function usersFor(a) { return ui.countAdmins ? a.users_30d : a.member_users_30d; }
  function flagOf(a) {
    if (!a.users_30d) return { k: 'unused', t: 'Unused 30 d', cls: 'b-bad', retire: true };
    if (a.first_seen > addDays(thru(), -30)) return { k: 'new', t: 'New', cls: 'b-blue', retire: false };
    if (usersFor(a) < ui.minUsers) return { k: 'retire', t: 'Retire candidate', cls: 'b-clay', retire: true };
    return null;
  }

  // ── CSV ──────────────────────────────────────────────────────────────────
  function csvCell(v) {
    if (v == null) v = '';
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(v)) v = "'" + v;
    v = String(v);
    return /[",;\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  function downloadCsv(name, header, rows) {
    const s = '﻿' + [header].concat(rows).map((r) => r.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([s], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = name + '-' + thru() + '.csv';
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
    toast('Exported ' + num(rows.length) + ' rows to ' + a.download + ' (downloaded only, nothing is sent)');
  }

  // ── sortable tables ──────────────────────────────────────────────────────
  // cols: {k, label, num, f(r) -> html, v(r) -> sort/csv value, cls}
  const TABLES = {}, SORT = {}, MORE = {};
  function table(id, cols, rows, opt) {
    opt = opt || {};
    const s = SORT[id] || opt.sort || { k: cols[0].k, dir: 1 };
    const col = cols.find((c) => c.k === s.k) || cols[0];
    const val = (c, r) => (c.v ? c.v(r) : r[c.k]);
    const sorted = rows.slice().sort((a, b) => {
      const x = val(col, a), y = val(col, b);
      if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * s.dir;
    });
    TABLES[id] = { cols: cols, rows: sorted, name: opt.csv || id, sort: s };
    const lim = MORE[id] ? sorted.length : (opt.limit || 60);
    let h = '<div class="tw"><table class="t' + (opt.compact ? ' compact' : '') + '"><caption class="sr">' + esc(opt.caption || '') + '</caption><thead><tr>';
    cols.forEach((c) => {
      const on = c.k === s.k;
      h += '<th scope="col"' + (c.num ? ' class="num"' : '') + (on ? ' aria-sort="' + (s.dir > 0 ? 'ascending' : 'descending') + '"' : '') + '><button type="button" data-act="sort" data-t="' + id + '" data-k="' + c.k + '" data-fid="s-' + id + '-' + c.k + '">' + esc(c.label) + (on ? (s.dir > 0 ? ' ↑' : ' ↓') : '') + '</button></th>';
    });
    h += '</tr></thead><tbody>';
    if (!sorted.length) h += '<tr><td colspan="' + cols.length + '"><div class="empty">' + esc(opt.empty || 'Nothing here.') + '</div></td></tr>';
    sorted.slice(0, lim).forEach((r) => {
      h += '<tr' + (opt.rowCls ? ' class="' + opt.rowCls(r) + '"' : '') + '>';
      cols.forEach((c) => { h += '<td class="' + (c.num ? 'num ' : '') + (c.cls || '') + '">' + (c.f ? c.f(r) : esc(r[c.k])) + '</td>'; });
      h += '</tr>';
    });
    h += '</tbody></table></div>';
    if (sorted.length > lim) h += '<div class="pager"><span>Showing ' + num(lim) + ' of ' + num(sorted.length) + '</span><div><button type="button" class="btn sm" data-act="more" data-t="' + id + '" data-fid="more-' + id + '">Show all</button></div></div>';
    return h;
  }
  function csvBtn(id) { return '<button type="button" class="btn sm" data-act="csv" data-t="' + id + '" data-fid="csv-' + id + '">' + ic('exp') + 'CSV</button>'; }

  // ── charts (inline SVG, CSS-variable colours, crosshair tooltip, keyboard) ──
  const charts = {};
  // phones get a narrower drawing so the axis text stays readable
  const PHONE = window.matchMedia ? window.matchMedia('(max-width: 600px)') : { matches: false };
  const CW = () => (PHONE.matches ? 420 : 760);
  function niceStep(v) { if (v <= 0) return 1; const e = Math.pow(10, Math.floor(Math.log10(v))), f = v / e; return [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((x) => f <= x + 1e-9) * e; }
  function axisLabels(n, labels, X, H) {
    let s = '';
    const step = Math.max(1, Math.ceil(n / (PHONE.matches ? 4 : 8)));
    labels.forEach((lb, i) => { if (i % step === 0) s += '<text class="ax" x="' + X(i).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(lb) + '</text>'; });
    return s;
  }
  function gridY(L, W, R, T, ih, y1, fmt) {
    let s = '';
    for (let g = 0; g <= 4; g++) {
      const v = y1 * g / 4, y = T + ih - ih * g / 4;
      s += '<line class="' + (g ? 'grid-l' : 'base') + '" x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '"/>';
      s += '<text class="ax" x="' + (L - 8) + '" y="' + (y + 3.5) + '" text-anchor="end">' + esc(fmt(v)) + '</text>';
    }
    return s;
  }
  /* o: {id, labels, tipLabels, series:[{name, color, values}], fmt, axis, aria, h} */
  function lineChart(o) {
    const W = CW(), H = o.h || 240, L = 58, R = 14, T = 12, B = 28, iw = W - L - R, ih = H - T - B, n = o.labels.length;
    let hi = 0;
    o.series.forEach((s) => s.values.forEach((v) => { if (v != null && v > hi) hi = v; }));
    const y1 = 4 * niceStep(hi * 1.05 / 4);
    const X = (i) => L + (n <= 1 ? iw / 2 : iw * i / (n - 1)), Y = (v) => T + ih - ih * v / y1;
    let s = gridY(L, W, R, T, ih, y1, o.axis || o.fmt) + axisLabels(n, o.labels, X, H);
    o.series.forEach((se) => {
      let d = '', pen = false;
      se.values.forEach((v, i) => { if (v == null) { pen = false; return; } d += (pen ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(v).toFixed(1); pen = true; });
      s += '<path class="line" d="' + d + '" style="stroke:' + se.color + '"/>';
      se.values.forEach((v, i) => {   // isolated points (no neighbours) and short series get a marker
        const lone = v != null && (i === 0 || se.values[i - 1] == null) && (i === n - 1 || se.values[i + 1] == null);
        if (v != null && (n <= 24 || lone)) s += '<circle class="pt" cx="' + X(i).toFixed(1) + '" cy="' + Y(v).toFixed(1) + '" r="4" style="fill:' + se.color + '"/>';
      });
    });
    s += '<line class="cross" x1="0" x2="0" y1="' + T + '" y2="' + (T + ih) + '" visibility="hidden"/>';
    const cw = n <= 1 ? iw : iw / (n - 1);
    o.labels.forEach((lb, i) => { s += '<rect class="hitc" data-i="' + i + '" x="' + (X(i) - cw / 2).toFixed(1) + '" y="' + T + '" width="' + cw.toFixed(1) + '" height="' + ih + '" fill="transparent"/>'; });
    charts[o.id] = { o: o, X: X, n: n, W: W };
    return chartBox(o, s, W, H);
  }
  /* stacked columns: o: {id, labels, tipLabels, series:[{name, color, values}], fmt, axis, aria, h} */
  function barChart(o) {
    const W = CW(), H = o.h || 240, L = 58, R = 14, T = 12, B = 28, iw = W - L - R, ih = H - T - B, n = o.labels.length;
    const tot = o.labels.map((_, i) => o.series.reduce((a, se) => a + Math.max(0, se.values[i] || 0), 0));
    const y1 = 4 * niceStep(Math.max.apply(null, tot.concat([0])) * 1.05 / 4);
    const gw = iw / Math.max(1, n), bw = Math.max(2, Math.min(28, gw * 0.72));
    const X = (i) => L + gw * i + gw / 2;
    let s = gridY(L, W, R, T, ih, y1, o.axis || o.fmt) + axisLabels(n, o.labels, X, H);
    o.labels.forEach((_, i) => {
      let y = T + ih;
      o.series.forEach((se, k) => {
        const v = Math.max(0, se.values[i] || 0), h = ih * v / y1;
        if (h <= 0) return;
        const gap = k > 0 ? 2 : 0, top = k === o.series.length - 1 || !o.series.slice(k + 1).some((x) => (x.values[i] || 0) > 0);
        const hh = Math.max(1, h - gap);
        s += '<rect x="' + (X(i) - bw / 2).toFixed(1) + '" y="' + (y - h).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + hh.toFixed(1) + '" rx="' + (top ? Math.min(4, bw / 2) : 0) + '" style="fill:' + se.color + '"/>';
        y -= h;
      });
      s += '<rect class="hitc" data-i="' + i + '" x="' + (L + gw * i).toFixed(1) + '" y="' + T + '" width="' + gw.toFixed(1) + '" height="' + ih + '" fill="transparent"/>';
    });
    charts[o.id] = { o: o, X: X, n: n, W: W, bar: true };
    return chartBox(o, s, W, H);
  }
  function chartBox(o, s, W, H) {
    let leg = '';
    if (o.series.length > 1) leg = '<div class="legend">' + o.series.map((se) => '<span><i style="background:' + se.color + '"></i>' + esc(se.name) + '</span>').join('') + '</div>';
    return leg + '<div class="chart" data-chart="' + o.id + '" tabindex="0" aria-label="' + esc(o.aria) + '. Use the arrow keys to read the values."><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(o.aria) + '" focusable="false">' + s + '</svg><div class="tip" hidden></div></div>' + chartTable(o);
  }
  function chartTable(o) {
    let h = '<details class="tbl"><summary>Show as table</summary><div class="tw"><table class="t compact"><thead><tr><th scope="col">' + esc(o.xName || 'Date') + '</th>';
    o.series.forEach((se) => { h += '<th scope="col" class="num">' + esc(se.name) + '</th>'; });
    h += '</tr></thead><tbody>';
    o.labels.forEach((lb, i) => { h += '<tr><td class="nw">' + esc(o.tipLabels ? o.tipLabels[i] : lb) + '</td>' + o.series.map((se) => '<td class="num">' + (se.values[i] == null ? '–' : esc(o.fmt(se.values[i]))) + '</td>').join('') + '</tr>'; });
    return h + '</tbody></table></div></details>';
  }
  function showTip(c, cfg, i, px, py) {
    const o = cfg.o, tip = c.querySelector('.tip'), cross = c.querySelector('.cross');
    let html = '<b>' + esc(o.tipLabels ? o.tipLabels[i] : o.labels[i]) + '</b>';
    o.series.forEach((se) => { html += '<div><span><i style="background:' + se.color + '"></i>' + esc(se.name) + '</span><span>' + (se.values[i] == null ? esc(o.nullText || 'no data') : esc(o.fmt(se.values[i]))) + '</span></div>'; });
    if (cfg.bar && o.series.length > 1) html += '<div><span>Total</span><span>' + esc(o.fmt(o.series.reduce((a, se) => a + (se.values[i] || 0), 0))) + '</span></div>';
    if (cross && !cfg.bar) { const x = cfg.X(i); cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.setAttribute('visibility', 'visible'); }
    tip.innerHTML = html; tip.hidden = false;
    const r = c.getBoundingClientRect(), tw = tip.offsetWidth;
    if (px == null) { px = cfg.X(i) / cfg.W * r.width; py = 20; }
    let x = px + 14; if (x + tw > r.width) x = px - tw - 14;
    tip.style.left = Math.max(0, x) + 'px'; tip.style.top = Math.max(0, py - 20) + 'px';
  }
  function hideTip(c) { const t = c.querySelector('.tip'), x = c.querySelector('.cross'); if (t) t.hidden = true; if (x) x.setAttribute('visibility', 'hidden'); }
  function bindCharts() {
    document.querySelectorAll('#page .chart[data-chart]').forEach((c) => {
      const cfg = charts[c.getAttribute('data-chart')]; if (!cfg) return;
      c.addEventListener('mousemove', (e) => {
        const h = e.target.closest('.hitc'); if (!h) { hideTip(c); return; }
        const r = c.getBoundingClientRect(); showTip(c, cfg, +h.getAttribute('data-i'), e.clientX - r.left, e.clientY - r.top);
      });
      c.addEventListener('mouseleave', () => hideTip(c));
      c.addEventListener('keydown', (e) => {
        if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].indexOf(e.key) < 0) return;
        e.preventDefault();
        let i = c._i == null ? cfg.n - 1 : c._i;
        i = e.key === 'Home' ? 0 : e.key === 'End' ? cfg.n - 1 : Math.max(0, Math.min(cfg.n - 1, i + (e.key === 'ArrowLeft' ? -1 : 1)));
        c._i = i; showTip(c, cfg, i);
      });
      c.addEventListener('focus', () => { c._i = cfg.n - 1; showTip(c, cfg, c._i); });
      c.addEventListener('blur', () => hideTip(c));
    });
  }
  function spark(values) {
    const v = values.filter((x) => x != null); if (v.length < 2) return '';
    const hi = Math.max.apply(null, v.concat([1])), W = 96, H = 24, n = values.length;
    let d = '';
    values.forEach((x, i) => { if (x == null) return; d += (d ? 'L' : 'M') + (W * i / (n - 1)).toFixed(1) + ',' + (2 + (H - 4) * (1 - x / hi)).toFixed(1); });
    return '<svg class="spark" viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true"><path d="' + d + '"/></svg>';
  }
  const C = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)'];

  // ── small pieces ─────────────────────────────────────────────────────────
  function kpi(label, v, d, cls) { return '<div class="kpi"><span class="label">' + esc(label) + '</span><span class="v">' + v + '</span>' + (d ? '<span class="d ' + (cls || '') + '"><i></i>' + esc(d) + '</span>' : '') + '</div>'; }
  function head(eyebrow, title, sub, actions) {
    return '<div class="head"><div><span class="eyebrow">' + esc(eyebrow) + '</span><h1 tabindex="-1">' + esc(title) + '<span class="dot">.</span></h1>' + (sub ? '<p class="sub">' + sub + '</p>' : '') + '</div>' +
      (actions ? '<div class="head-actions">' + actions + '</div>' : '') + '</div>';
  }
  function card(title, body, opt) {
    opt = opt || {};
    return '<section class="card"' + (opt.id ? ' id="' + opt.id + '"' : '') + ' aria-labelledby="h-' + (opt.id || title.replace(/\W+/g, '')) + '"><div class="card-h"><div>' + (opt.eyebrow ? '<span class="label">' + esc(opt.eyebrow) + '</span>' : '') +
      '<h2 id="h-' + (opt.id || title.replace(/\W+/g, '')) + '">' + esc(title) + '</h2></div>' + (opt.right || '') + '</div>' + body + (opt.foot ? '<div class="card-foot">' + opt.foot + '</div>' : '') + '</section>';
  }
  function deltaUsers(cur, prev) {
    if (prev == null) return '';
    const d = cur - prev;
    if (!d) return '<span class="delta">±0</span>';
    return '<span class="delta ' + (d > 0 ? 'up' : 'down') + '">' + (d > 0 ? '+' : '−') + Math.abs(d) + '</span>';
  }
  function deltaMs(cur, prev) {
    if (cur == null || prev == null || !prev) return '';
    const x = cur / prev - 1;
    if (Math.abs(x) < 0.1) return '<span class="delta">≈</span>';
    return '<span class="delta ' + (x > 0 ? 'slower' : 'faster') + '">' + (x > 0 ? '+' : '−') + Math.round(Math.abs(x) * 100) + ' %</span>';
  }
  const appLink = (id) => '<a href="#/app/' + encodeURIComponent(id) + '">' + esc(id) + '</a>';
  function badge(f) { return f ? '<span class="badge ' + f.cls + '">' + esc(f.t) + '</span>' : ''; }
  function appOptions(sel, blank) {
    return (blank ? '<option value="">' + esc(blank) + '</option>' : '') + ((META && META.apps) || []).map((a) => a.app_id).sort().map((id) => '<option value="' + esc(id) + '"' + (id === sel ? ' selected' : '') + '>' + esc(id) + '</option>').join('');
  }
  function fillDays(w, rows) { const by = {}; rows.forEach((r) => { by[r.date] = r; }); return dateList(w.from, w.to).map((d) => by[d] || { date: d }); }

  // ── chrome: nav, top bar, side foot ──────────────────────────────────────
  let route = { base: '', id: null };
  const NAV = [['', 'Overview', 'home'], ['apps', 'Apps', 'grid'], ['speed', 'Speed', 'speed'], ['errors', 'Errors', 'err'], ['cost', 'Cost', 'cost']];
  function renderChrome() {
    const ok = SESSION.allowed && META;
    $('nav').innerHTML = ok ? NAV.map((n) => '<a href="#/' + n[0] + '"' + ((route.base === n[0] || (n[0] === 'apps' && route.base === 'app')) ? ' aria-current="page"' : '') + '>' + ic(n[2]) + '<span>' + n[1] + '</span></a>').join('') : '';
    let f = '';
    if (ok) {
      const fr = META.freshness || [], ev = fr.find((x) => x.source === 'Hub usage events') || {}, bi = fr.find((x) => x.source === 'Cloud billing export') || {};
      f = '<span class="live-pill"><i aria-hidden="true"></i>Live data · ' + esc(SESSION.email || '') + '</span>' +
        '<p class="side-note">Usage through ' + esc(dLong(ev.data_through)) + '<br>Cost through ' + esc(dLong(bi.data_through)) + '<br>Summary rebuilt ' + esc(ev.refreshed_at ? dShort(ev.refreshed_at.slice(0, 10)) + ' ' + ev.refreshed_at.slice(11, 16) + ' UTC' : '–') + '</p>' +
        '<p class="side-note">Counts of people only, never who. Pipelines: <a href="/n8n/">n8n Runs</a></p>';
    }
    $('sideFoot').innerHTML = f;
    let t = '';
    if (ok && route.base !== 'apps') {
      t = '<div class="seg" role="group" aria-label="Period">' + RANGES.map((r) => '<button type="button" data-act="range" data-v="' + r[0] + '" data-fid="range-' + r[0] + '" aria-pressed="' + (ui.range === r[0]) + '">' + r[1] + '</button>').join('') + '</div>' +
        '<span class="grow"></span><span class="thru">' + (route.base === 'cost' ? 'Cost through ' + esc(dLong(costThru())) + ' (Pacific time days)' : 'Through ' + esc(dLong(thru())) + ' · Ljubljana days') + '</span>';
    } else if (ok) t = '<span class="thru">Last 30 days · ' + esc(dLong(addDays(thru(), -29))) + ' – ' + esc(dLong(thru())) + '</span>';
    $('topbar').innerHTML = t;
  }
  function setMenu(open) { $('side').classList.toggle('open', open); $('menuBtn').setAttribute('aria-expanded', open ? 'true' : 'false'); }

  // ── access page (not signed in / not on the list) ────────────────────────
  function renderGate() {
    renderChrome();
    let state;
    if (!SESSION.checked) state = '<p class="loading" role="status"><i aria-hidden="true"></i>Checking access…</p>';
    else if (SESSION.failed) state = '<div class="notice warn" role="alert">Access could not be checked right now. <button type="button" class="linkish" data-act="recheck">Try again</button></div>';
    else if (!SESSION.signedIn) state = '<div class="notice info">Live data for approved accounts — <button type="button" class="linkish" data-act="signin" data-fid="signin">sign in</button></div>';
    else state = '<div class="notice warn">Your account (' + esc(SESSION.email || '') + ') is not on the list for live Hub usage data. Ask Simon to add it.</div>';
    $('page').innerHTML = '<div class="card gate"><span class="eyebrow">Adrial Apps · live data</span><h1 tabindex="-1">Hub usage &amp; speed<span class="dot">.</span></h1>' +
      '<p>How the Adrial Hub portal is used and how fast it is, for the platform owner:</p><ul>' +
      '<li>active users per day and week, and which apps matter;</li><li>every app with its users in the last 30 days, its trend and a <b>retire candidate</b> flag;</li>' +
      '<li>slow pages and endpoints (p95 response time) and pages with errors;</li><li>Cloud cost per service and, where jobs are labelled, per app.</li></ul>' +
      '<p>Only counts are shown: the number of people per app and day, never who they are.</p>' + state +
      (SESSION.checked && !SESSION.failed && !SESSION.signedIn ? '<div class="dr-actions"><button type="button" class="btn pri" data-act="signin">Sign in</button></div>' : '') + '</div>';
    document.title = 'Hub usage & speed — Adrial Apps';
  }

  // ── routing & render ─────────────────────────────────────────────────────
  function parseRoute() {
    const h = (location.hash || '').replace(/^#\/?/, '').split('/');
    const base = ['apps', 'app', 'speed', 'errors', 'cost'].indexOf(h[0]) >= 0 ? h[0] : '';
    let id = null; try { id = h[1] ? decodeURIComponent(h[1]) : null; } catch (e) { id = null; }
    return { base: base, id: id };
  }
  let lastBase = null;
  function onRoute() {
    route = parseRoute();
    setMenu(false);
    if (!SESSION.allowed || !META) { if (SESSION.checked) renderGate(); return; }
    const newPage = route.base + '|' + route.id !== lastBase;
    rerender();
    if (newPage) { lastBase = route.base + '|' + route.id; const h1 = document.querySelector('#page h1'); if (h1 && document.activeElement !== document.body) h1.focus({ preventScroll: true }); window.scrollTo(0, 0); }
  }
  function withFocus(fn) {
    const a = document.activeElement, fid = a && a.getAttribute && a.getAttribute('data-fid'), val = a && a.tagName === 'INPUT' ? a.selectionStart : null;
    const det = []; document.querySelectorAll('#page details').forEach((d, i) => { if (d.open) det.push(i); });
    fn();
    document.querySelectorAll('#page details').forEach((d, i) => { if (det.indexOf(i) >= 0) d.open = true; });
    if (fid) { const el = document.querySelector('[data-fid="' + fid + '"]'); if (el) { el.focus({ preventScroll: true }); if (val != null && el.setSelectionRange) try { el.setSelectionRange(val, val); } catch (e) { /* number input */ } } }
  }
  let pageTitle = '';
  function rerender() {
    if (!SESSION.allowed || !META) return;
    withFocus(() => {
      renderChrome();
      const P = { '': pageOverview, apps: pageApps, app: pageApp, speed: pageSpeed, errors: pageErrors, cost: pageCost };
      Object.keys(charts).forEach((k) => delete charts[k]);
      $('page').innerHTML = P[route.base]();
      bindCharts();
      document.title = (pageTitle ? pageTitle + ' · ' : '') + 'Hub usage & speed — Adrial Apps';
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // 1. Overview
  // ════════════════════════════════════════════════════════════════════════
  function pageOverview() {
    pageTitle = 'Overview';
    const w = win(), c = lget(apiUrl('overview', w));
    let h = head('Adrial Hub · ' + RANGES.find((r) => r[0] === ui.range)[1], 'Hub usage & speed', 'Who uses the Hub (as counts), which apps matter, and how fast and reliable they are.');
    const wait = lwait([c], 'Hub usage');
    if (wait) return h + wait;
    const days = c.data.days, weeks = c.data.weeks, apps = META.apps;
    if (!days.length) return h + '<div class="card pad empty">No Hub use in this period.</div>';
    const last = days[days.length - 1], wk = days.length > 7 ? days[days.length - 8] : null;
    const fullWeeks = weeks.filter((x) => addDays(x.week, 6) <= w.to), lw = fullWeeks[fullWeeks.length - 1], pw = fullWeeks[fullWeeks.length - 2];
    const t5 = sum(days, 'errors_5xx'), tt = sum(days, 'timed');
    const used = apps.filter((a) => a.users_30d > 0).length, retire = apps.filter((a) => { const f = flagOf(a); return f && f.retire; }).length;
    h += '<div class="kpis">' +
      kpi('Active users · ' + dShort(last.date), num(last.users), wk ? (last.users - wk.users >= 0 ? '+' : '−') + Math.abs(last.users - wk.users) + ' vs ' + dShort(wk.date) : '', wk ? (last.users >= wk.users ? 'pos' : 'neg') : '') +
      kpi('Active in last 7 days', num(last.users_7d), wk ? (last.users_7d - wk.users_7d >= 0 ? '+' : '−') + Math.abs(last.users_7d - wk.users_7d) + ' vs a week earlier' : '', wk ? (last.users_7d >= wk.users_7d ? 'pos' : 'neg') : '') +
      kpi('Active in last 28 days', num(last.users_28d), num(last.member_users_7d) + ' non-admin users this week') +
      kpi('Events in period', num(sum(days, 'events')), num(sum(days, 'opens')) + ' app opens') +
      kpi('Server errors (5xx)', pct(rate(t5, tt), 2), num(t5) + ' of ' + num(tt) + ' requests', t5 ? 'neg' : 'pos') +
      kpi('p95 response · last full week', lw ? fmtMs(lw.p95_ms) : '–', lw && pw ? 'week before ' + fmtMs(pw.p95_ms) : 'week of ' + (lw ? dShort(lw.week) : '–'), lw && pw ? (lw.p95_ms > pw.p95_ms * 1.1 ? 'neg' : lw.p95_ms < pw.p95_ms * 0.9 ? 'pos' : '') : '') +
      kpi('Apps used · 30 days', num(used) + '<small> / ' + apps.length + '</small>', retire ? retire + ' retire candidates' : 'no retire candidates', retire ? 'neg' : '') +
      '</div>';
    const labels = days.map((d) => dShort(d.date)), tips = days.map((d) => dLong(d.date));
    h += '<div class="dash">' + card('Active users', '<div class="chart-wrap">' + lineChart({
      id: 'dau', labels: labels, tipLabels: tips, fmt: num, aria: 'Daily active users and users active in the last 7 days',
      series: [{ name: 'Active that day', color: C[0], values: days.map((d) => d.users) }, { name: 'Active in the last 7 days', color: C[1], values: days.map((d) => d.users_7d) }],
    }) + '</div>', { eyebrow: 'Distinct people per day', foot: 'A person counts once per day however many apps they open. Admin accounts (the Hub owners) are included; the Apps page can leave them out.' }) +
      card('Weekly active users', '<div class="chart-wrap">' + barChart({
        id: 'wau', xName: 'Week', labels: weeks.map((x) => dShort(x.week) + (addDays(x.week, 6) > w.to ? '*' : '')), tipLabels: weeks.map((x) => 'Week of ' + dLong(x.week) + (addDays(x.week, 6) > w.to ? ' (so far)' : '')), fmt: num,
        aria: 'Weekly active users', series: [{ name: 'Weekly active users', color: C[0], values: weeks.map((x) => x.users) }],
      }) + '</div>', { eyebrow: 'Monday to Sunday', foot: weeks.length && addDays(weeks[weeks.length - 1].week, 6) > w.to ? '* week not finished yet.' : '' }) + '</div>';
    h += card('Server error rate per day', '<div class="chart-wrap">' + lineChart({
      id: 'err', labels: labels, tipLabels: tips, fmt: (v) => v.toFixed(2) + ' %', axis: (v) => (v ? v.toFixed(v < 1 ? 2 : 1) : '0') + ' %', nullText: 'no requests', aria: 'Share of requests answered with a 5xx error per day', h: 200,
      series: [{ name: '5xx share of requests', color: C[2], values: days.map((d) => (d.timed ? 100 * d.errors_5xx / d.timed : null)) }],
    }) + '</div>', { eyebrow: '5xx answers / timed requests (page loads + API calls)', foot: '<a href="#/errors">Errors by app and page →</a>' });
    // lists
    const slow = apps.filter((a) => a.timed_30d >= 100).sort((a, b) => b.p95_30d - a.p95_30d).slice(0, 8), maxP = slow.length ? slow[0].p95_30d : 1;
    const top = apps.slice().sort((a, b) => b.users_30d - a.users_30d || b.events_30d - a.events_30d).slice(0, 8), maxU = top.length ? top[0].users_30d : 1;
    const errs = apps.filter((a) => a.errors_5xx_30d > 0).sort((a, b) => b.errors_5xx_30d - a.errors_5xx_30d).slice(0, 8);
    const li = (a, right, frac, warn) => '<li><div class="l" style="flex:1">' + appLink(a.app_id) + '<div class="bar' + (warn ? ' warn' : '') + '"><i style="width:' + Math.max(2, Math.round(100 * frac)) + '%"></i></div></div><div class="r">' + right + '</div></li>';
    h += '<div class="cols3">' +
      card('Slowest apps', '<div class="card-b"><ul class="list">' + (slow.map((a) => li(a, fmtMs(a.p95_30d) + '<small class="cell-sub">' + num(a.timed_30d) + ' requests</small>', a.p95_30d / maxP, a.p95_30d >= 5000)).join('') || '<li class="muted">No app with 100+ requests.</li>') + '</ul></div>', { eyebrow: 'p95 · last 30 days · 100+ requests', foot: '<a href="#/speed">Speed over time →</a>' }) +
      card('Most used apps', '<div class="card-b"><ul class="list">' + top.map((a) => li(a, num(a.users_30d) + ' users<small class="cell-sub">' + num(a.opens_30d) + ' opens</small>', a.users_30d / maxU)).join('') + '</ul></div>', { eyebrow: 'Users · last 30 days', foot: '<a href="#/apps">All ' + apps.length + ' apps →</a>' }) +
      card('Most server errors', '<div class="card-b"><ul class="list">' + (errs.map((a) => li(a, num(a.errors_5xx_30d) + ' × 5xx<small class="cell-sub">' + pct(rate(a.errors_5xx_30d, a.timed_30d), 2) + ' of requests</small>', a.errors_5xx_30d / errs[0].errors_5xx_30d, true)).join('') || '<li class="muted">No 5xx errors in 30 days.</li>') + '</ul></div>', { eyebrow: '5xx · last 30 days', foot: '<a href="#/errors">All errors →</a>' }) +
      '</div>';
    return h;
  }

  // ════════════════════════════════════════════════════════════════════════
  // 2. Apps table (last 30 days) with the retire-candidate flag
  // ════════════════════════════════════════════════════════════════════════
  const APPS_FILTERS = [['', 'All'], ['retire', 'Retire candidates'], ['new', 'New'], ['slow', 'Slow (p95 ≥ 5 s)'], ['errors', 'With 5xx']];
  function pageApps() {
    pageTitle = 'Apps';
    const c = lget(apiUrl('apps'));
    const apps = META.apps, T = thru();
    let h = head('Adrial Hub · last 30 days', 'Apps', 'Every Hub app with its users in the last 30 days, the trend, speed and errors. Apps are flagged as retire candidates by the rule below.',
      csvBtn('apps'));
    h += '<div class="ctrls">' +
      '<div class="grp"><label class="label" for="minUsers">Retire if fewer than … users / 30 days</label><input class="num" id="minUsers" type="number" min="0" max="1000" step="1" value="' + ui.minUsers + '" data-chg="minUsers" data-fid="minUsers"></div>' +
      '<label class="check"><input type="checkbox" data-chg="countAdmins" data-fid="countAdmins"' + (ui.countAdmins ? ' checked' : '') + '>Count admin accounts as users</label>' +
      '<div class="grp"><label class="label" for="appSearch">Find an app</label><input class="search" id="appSearch" type="search" placeholder="App id" value="' + esc(search.apps) + '" data-chg="searchApps" data-fid="appSearch" autocomplete="off"></div>' +
      '</div><div class="toolbar"><div class="seg" role="group" aria-label="Show">' + APPS_FILTERS.map((f) => {
      const n = f[0] ? apps.filter((a) => appMatch(a, f[0])).length : apps.length;
      return '<button type="button" data-act="appsFilter" data-v="' + f[0] + '" data-fid="af-' + f[0] + '" aria-pressed="' + (ui.appsFilter === f[0]) + '">' + f[1] + ' · ' + n + '</button>';
    }).join('') + '</div></div>';
    const weeksByApp = {};
    if (c.status === 'ok') {
      const lastW = monday(T), wl = []; for (let i = 11; i >= 0; i--) wl.push(addDays(lastW, -7 * i));
      const by = {}; c.data.weeks.forEach((r) => { (by[r.app_id] = by[r.app_id] || {})[r.week] = r; });
      Object.keys(by).forEach((id) => { weeksByApp[id] = wl.map((wk) => (by[id][wk] ? by[id][wk].users : 0)); });
    }
    const q = search.apps.trim().toLowerCase();
    const rows = apps.filter((a) => (!ui.appsFilter || appMatch(a, ui.appsFilter)) && (!q || a.app_id.indexOf(q) >= 0)).map((a) => Object.assign({ flag: flagOf(a) }, a));
    const cols = [
      { k: 'app_id', label: 'App', cls: 'app', f: (r) => appLink(r.app_id) },
      { k: 'users_30d', label: 'Users', num: true, f: (r) => num(r.users_30d) + ' ' + deltaUsers(r.users_30d, r.users_prev_30d) },
      { k: 'member_users_30d', label: 'Non-admin', num: true, f: (r) => num(r.member_users_30d) },
      { k: 'users_prev_30d', label: 'Prev 30 d', num: true, f: (r) => num(r.users_prev_30d) },
      { k: 'trend', label: 'Users / week (12 wk)', v: (r) => (weeksByApp[r.app_id] || []).slice(-4).reduce((x, y) => x + y, 0), f: (r) => (c.status === 'ok' ? spark(weeksByApp[r.app_id] || []) || '<span class="muted">–</span>' : '<span class="muted">…</span>') },
      { k: 'opens_30d', label: 'Opens', num: true, f: (r) => num(r.opens_30d) },
      { k: 'active_days_30d', label: 'Days used', num: true, f: (r) => num(r.active_days_30d) },
      { k: 'p95_30d', label: 'p95', num: true, f: (r) => fmtMs(r.p95_30d) + ' ' + deltaMs(r.p95_30d, r.p95_prev_30d) },
      { k: 'errors_5xx_30d', label: '5xx', num: true, f: (r) => num(r.errors_5xx_30d) },
      { k: 'errors_4xx_30d', label: '4xx', num: true, f: (r) => num(r.errors_4xx_30d) },
      { k: 'last_seen', label: 'Last used', cls: 'nw', f: (r) => esc(dLong(r.last_seen)) },
      { k: 'first_seen', label: 'First seen', cls: 'nw', f: (r) => esc(dLong(r.first_seen)) },
      { k: 'flag', label: 'Flag', v: (r) => (r.flag ? r.flag.t : ''), f: (r) => badge(r.flag) },
    ];
    TABLES_CSV.apps = (r) => [r.app_id, r.users_30d, r.member_users_30d, r.users_prev_30d, (weeksByApp[r.app_id] || []).join(' '), r.users_7d, r.users_90d, r.opens_30d, r.events_30d, r.active_days_30d,
      r.p50_30d, r.p95_30d, r.p95_prev_30d, r.timed_30d, r.slow_5s_30d, r.errors_5xx_30d, r.errors_4xx_30d, r.last_seen, r.first_seen, r.flag ? r.flag.t : ''];
    TABLES_HEAD.apps = ['App', 'Users 30 d', 'Non-admin users 30 d', 'Users previous 30 d', 'Users per week (12 weeks)', 'Users 7 d', 'Users 90 d', 'Opens 30 d', 'Events 30 d', 'Days used 30 d',
      'p50 ms 30 d', 'p95 ms 30 d', 'p95 ms previous 30 d', 'Timed requests 30 d', 'Requests over 5 s', '5xx 30 d', '4xx 30 d', 'Last used', 'First seen', 'Flag'];
    h += card(rows.length + ' apps', table('apps', cols, rows, { sort: { k: 'users_30d', dir: -1 }, limit: 100, csv: 'hub-apps', caption: 'Hub apps, last 30 days', empty: 'No app matches.', rowCls: (r) => (r.flag && r.flag.retire ? 'flag' : '') }),
      { eyebrow: 'Last 30 days to ' + dLong(T), foot: '<p><b>Retire candidate</b>: in use for more than 30 days and fewer than ' + ui.minUsers + ' ' + (ui.countAdmins ? '' : 'non-admin ') + 'users in the last 30 days, or not used at all. <b>New</b>: first seen in the last 30 days, never flagged.</p>' +
        '<p>Users are distinct people in the period (not the sum of daily users). p95 = 95 % of page loads and API calls were faster than this; the change is against the 30 days before. Admin = Hub admin role.</p>' });
    return h;
  }
  function appMatch(a, f) {
    const fl = flagOf(a);
    if (f === 'retire') return !!(fl && fl.retire);
    if (f === 'new') return !!(fl && fl.k === 'new');
    if (f === 'slow') return a.timed_30d >= 20 && a.p95_30d >= 5000;
    if (f === 'errors') return a.errors_5xx_30d > 0;
    return true;
  }

  // ════════════════════════════════════════════════════════════════════════
  // 3. App detail
  // ════════════════════════════════════════════════════════════════════════
  function pageApp() {
    const id = route.id || '', A = appsById()[id];
    pageTitle = id;
    if (!A) return head('Apps', 'Unknown app', '') + '<div class="card pad"><p>There is no Hub usage for “' + esc(id) + '”. <a href="#/apps">Back to all apps</a>.</p></div>';
    const w = win(), c = lget(apiUrl('app', { app: id, from: w.from, to: w.to })), fl = flagOf(A);
    let h = '<a class="crumb" href="#/apps">' + ic('back') + 'All apps</a>' + head('Hub app · first seen ' + dLong(A.first_seen) + ' · last used ' + dLong(A.last_seen), id, badge(fl),
      '<label class="sr" for="appPick">Another app</label><select class="select" id="appPick" data-chg="appPick" data-fid="appPick">' + appOptions(id) + '</select>');
    h += '<div class="kpis">' +
      kpi('Users · 30 days', num(A.users_30d), (A.users_30d - A.users_prev_30d >= 0 ? '+' : '−') + Math.abs(A.users_30d - A.users_prev_30d) + ' vs the 30 days before', A.users_30d >= A.users_prev_30d ? 'pos' : 'neg') +
      kpi('Non-admin users · 30 d', num(A.member_users_30d), num(A.users_7d) + ' users in the last 7 days') +
      kpi('Opens · 30 days', num(A.opens_30d), num(A.active_days_30d) + ' of 30 days used') +
      kpi('p95 response · 30 d', fmtMs(A.p95_30d), 'p50 ' + fmtMs(A.p50_30d) + (A.p95_prev_30d ? ' · before ' + fmtMs(A.p95_prev_30d) : ''), A.p95_prev_30d && A.p95_30d > A.p95_prev_30d * 1.1 ? 'neg' : '') +
      kpi('Server errors · 30 d', num(A.errors_5xx_30d), pct(rate(A.errors_5xx_30d, A.timed_30d), 2) + ' of ' + num(A.timed_30d) + ' requests', A.errors_5xx_30d ? 'neg' : 'pos') +
      kpi('Client errors · 30 d', num(A.errors_4xx_30d), 'incl. sign-in / no access') + '</div>';
    const wait = lwait([c], 'this app');
    if (wait) return h + wait;
    const d = c.data, days = fillDays(w, d.days), labels = days.map((x) => dShort(x.date)), tips = days.map((x) => dLong(x.date));
    h += '<div class="cols2" style="margin-top:0">' +
      card('Users per day', '<div class="chart-wrap">' + lineChart({ id: 'au', labels: labels, tipLabels: tips, fmt: num, aria: 'Users of ' + id + ' per day',
        series: [{ name: 'All users', color: C[0], values: days.map((x) => x.users || 0) }, { name: 'Non-admin users', color: C[1], values: days.map((x) => x.member_users || 0) }] }) + '</div>', { eyebrow: 'Distinct people per day' }) +
      card('Speed per day', '<div class="chart-wrap">' + lineChart({ id: 'as', labels: labels, tipLabels: tips, fmt: fmtMs, nullText: 'no requests', aria: 'Median and p95 response time of ' + id + ' per day',
        series: [{ name: 'p95', color: C[2], values: days.map((x) => (x.timed ? x.p95_ms : null)) }, { name: 'Median (p50)', color: C[0], values: days.map((x) => (x.timed ? x.p50_ms : null)) }] }) + '</div>', { eyebrow: 'Page loads + API calls' }) +
      '</div>';
    // slowest pages over time: the 3 pages with the highest 30-day p95 that have daily rows
    const withDays = {}; d.pageDays.forEach((r) => { withDays[r.page] = 1; });
    const slowPages = d.pages.filter((p) => p.timed >= 3 && withDays[p.page]).sort((a, b) => b.p95_ms - a.p95_ms).slice(0, 3);
    const pdBy = {}; d.pageDays.forEach((r) => { (pdBy[r.page] = pdBy[r.page] || {})[r.date] = r; });
    h += '<div class="cols2">' +
      card('Errors per day', '<div class="chart-wrap">' + barChart({ id: 'ae', labels: labels, tipLabels: tips, fmt: num, aria: 'Errors of ' + id + ' per day',
        series: [{ name: '5xx server errors', color: C[2], values: days.map((x) => x.errors_5xx || 0) }, { name: '4xx client errors', color: C[3], values: days.map((x) => x.errors_4xx || 0) }] }) + '</div>', { eyebrow: 'Answers with an error status' }) +
      card('Slowest pages, p95 per day', slowPages.length ? '<div class="chart-wrap">' + lineChart({ id: 'ap', labels: labels, tipLabels: tips, fmt: fmtMs, nullText: 'no requests', aria: 'p95 per day of the slowest pages of ' + id,
        series: slowPages.map((p, i) => ({ name: p.page, color: C[i], values: days.map((x) => (pdBy[p.page] && pdBy[p.page][x.date] ? pdBy[p.page][x.date].p95_ms : null)) })) }) + '</div>' : '<div class="card-b empty">No page with enough timed requests.</div>',
        { eyebrow: 'The 3 slowest pages of the last 30 days' }) + '</div>';
    const pcols = [
      { k: 'page', label: 'Page', cls: 'code', f: (r) => esc(r.page) },
      { k: 'users', label: 'Users', num: true, f: (r) => num(r.users) }, { k: 'events', label: 'Events', num: true, f: (r) => num(r.events) },
      { k: 'timed', label: 'Requests', num: true, f: (r) => num(r.timed) }, { k: 'p50_ms', label: 'p50', num: true, f: (r) => fmtMs(r.p50_ms) },
      { k: 'p95_ms', label: 'p95', num: true, f: (r) => fmtMs(r.p95_ms) }, { k: 'max_ms', label: 'Slowest', num: true, f: (r) => fmtMs(r.max_ms) },
      { k: 'slow_5s', label: '> 5 s', num: true, f: (r) => num(r.slow_5s) },
      { k: 'errors_5xx', label: '5xx', num: true, f: (r) => num(r.errors_5xx) }, { k: 'errors_4xx', label: '4xx', num: true, f: (r) => num(r.errors_4xx) },
      { k: 'last_used', label: 'Last used', cls: 'nw', f: (r) => esc(dLong(r.last_used)) },
    ];
    h += '<div class="stack" style="margin-top:14px">' + card('Pages', table('pages', pcols, d.pages, { sort: { k: 'p95_ms', dir: -1 }, limit: 30, csv: 'hub-' + id + '-pages', caption: 'Pages of ' + id + ', last 30 days' }),
      { eyebrow: 'Last 30 days', right: csvBtn('pages'), foot: 'A page is the Hub page id, or the route when the app reports none. Requests = page loads and API calls with a measured time.' });
    const rcols = [
      { k: 'route', label: 'Endpoint', cls: 'code', f: (r) => '<span class="muted">' + esc(r.method) + '</span> ' + esc(r.route) },
      { k: 'page', label: 'Page', cls: 'code', f: (r) => esc(r.page) },
      { k: 'timed', label: 'Requests', num: true, f: (r) => num(r.timed) }, { k: 'p50_ms', label: 'p50', num: true, f: (r) => fmtMs(r.p50_ms) },
      { k: 'p95_ms', label: 'p95', num: true, f: (r) => fmtMs(r.p95_ms) }, { k: 'max_ms', label: 'Slowest', num: true, f: (r) => fmtMs(r.max_ms) },
      { k: 'slow_5s', label: '> 5 s', num: true, f: (r) => num(r.slow_5s) },
      { k: 'errors_5xx', label: '5xx', num: true, f: (r) => num(r.errors_5xx) }, { k: 'errors_4xx', label: '4xx', num: true, f: (r) => num(r.errors_4xx) },
      { k: 'last_error', label: 'Last error', cls: 'nw', f: (r) => esc(r.last_error ? dLong(r.last_error) : '–') },
    ];
    h += card('Endpoints', table('routes', rcols, d.routes, { sort: { k: 'p95_ms', dir: -1 }, limit: 25, csv: 'hub-' + id + '-endpoints', caption: 'Endpoints of ' + id + ', last 30 days' }),
      { eyebrow: 'Last 30 days · the 25 slowest + every one with errors', right: csvBtn('routes'), foot: 'Routes are recorded without parameters (e.g. /api/x/:table).' });
    const errRows = d.pages.filter((p) => p.errors_5xx + p.errors_4xx > 0);
    const ecols = [
      { k: 'page', label: 'Page', cls: 'code', f: (r) => esc(r.page) },
      { k: 'timed', label: 'Requests', num: true, f: (r) => num(r.timed) },
      { k: 'errors_5xx', label: '5xx', num: true, f: (r) => num(r.errors_5xx) }, { k: 'rate5', label: '5xx share', num: true, v: (r) => rate(r.errors_5xx, r.timed), f: (r) => pct(rate(r.errors_5xx, r.timed), 2) },
      { k: 'last_5xx', label: 'Last 5xx', cls: 'nw', f: (r) => esc(r.last_5xx ? dLong(r.last_5xx) : '–') },
      { k: 'errors_4xx', label: '4xx', num: true, f: (r) => num(r.errors_4xx) }, { k: 'last_4xx', label: 'Last 4xx', cls: 'nw', f: (r) => esc(r.last_4xx ? dLong(r.last_4xx) : '–') },
    ];
    h += card('Error pages', table('errpages', ecols, errRows, { sort: { k: 'errors_5xx', dir: -1 }, limit: 30, csv: 'hub-' + id + '-error-pages', caption: 'Pages of ' + id + ' with errors', empty: 'No errors in the last 30 days.' }),
      { eyebrow: 'Last 30 days', right: csvBtn('errpages') }) + '</div>';
    return h;
  }

  // ════════════════════════════════════════════════════════════════════════
  // 4. Speed
  // ════════════════════════════════════════════════════════════════════════
  function pageSpeed() {
    pageTitle = 'Speed';
    const w = win(), app = appsById()[ui.speedApp] ? ui.speedApp : '';
    const c = lget(apiUrl('speed', { from: w.from, to: w.to, app: app })), o = lget(apiUrl('overview', w));
    let h = head('Adrial Hub · ' + RANGES.find((r) => r[0] === ui.range)[1], 'Speed', 'p95 response time (95 % of page loads and API calls were faster) per week, by app and by page.');
    const wait = lwait([c, o], 'speed data');
    if (wait) return h + wait;
    const weeks = o.data.weeks, wl = weeks.map((x) => x.week), part = (wk) => addDays(wk, 6) > w.to;
    const wlab = wl.map((x) => dShort(x) + (part(x) ? '*' : '')), wtip = wl.map((x) => 'Week of ' + dLong(x) + (part(x) ? ' (so far)' : ''));
    h += card('Whole Hub, per week', '<div class="chart-wrap">' + lineChart({ id: 'sw', xName: 'Week', labels: wlab, tipLabels: wtip, fmt: fmtMs, aria: 'Hub-wide p95 and median response time per week',
      series: [{ name: 'p95', color: C[2], values: weeks.map((x) => x.p95_ms) }, { name: 'Median (p50)', color: C[0], values: weeks.map((x) => x.p50_ms) }] }) + '</div>', { eyebrow: 'All apps · page loads + API calls', foot: weeks.length && part(wl[wl.length - 1]) ? '* week not finished yet.' : '' });
    // per app
    const by = {}; c.data.apps.forEach((r) => { (by[r.app_id] = by[r.app_id] || {})[r.week] = r; });
    const agg = Object.keys(by).map((id) => {
      const rs = Object.keys(by[id]).sort().map((k) => by[id][k]), full = rs.filter((r) => !part(r.week)), lastR = full[full.length - 1] || rs[rs.length - 1];
      const worst = rs.reduce((a, r) => (!a || r.p95_ms > a.p95_ms ? r : a), null);
      return { app_id: id, timed: sum(rs, 'timed'), slow_5s: sum(rs, 'slow_5s'), weeks: rs.length, med: median(rs.map((r) => r.p95_ms)), last: lastR ? lastR.p95_ms : null, lastWeek: lastR ? lastR.week : null, worst: worst ? worst.p95_ms : null, worstWeek: worst ? worst.week : null };
    });
    let pick = ui.speedPick.filter((id) => by[id]).slice(0, 3);
    if (!pick.length) pick = agg.filter((a) => a.timed >= 100).sort((a, b) => b.med - a.med).slice(0, 3).map((a) => a.app_id);
    const picker = [0, 1, 2].map((i) => '<label class="sr" for="sp' + i + '">App ' + (i + 1) + '</label><select class="select" id="sp' + i + '" data-chg="speedPick" data-i="' + i + '" data-fid="sp' + i + '">' + appOptions(pick[i] || '', '— none —') + '</select>').join('');
    h += '<div style="margin-top:14px">' + card('p95 per week, by app', '<div class="card-b"><div class="toolbar" style="margin:0">' + picker + '</div></div><div class="chart-wrap">' + (pick.length ? lineChart({ id: 'sa', xName: 'Week', labels: wlab, tipLabels: wtip, fmt: fmtMs, nullText: 'no requests', aria: 'p95 per week for ' + pick.join(', '),
      series: pick.map((id, i) => ({ name: id, color: C[i], values: wl.map((wk) => (by[id] && by[id][wk] ? by[id][wk].p95_ms : null)) })) }) : '<div class="empty">Pick up to three apps.</div>') + '</div>',
      { eyebrow: 'Up to 3 apps · default: the 3 slowest' }) + '</div>';
    const acols = [
      { k: 'app_id', label: 'App', cls: 'app', f: (r) => appLink(r.app_id) },
      { k: 'timed', label: 'Requests', num: true, f: (r) => num(r.timed) },
      { k: 'med', label: 'Typical weekly p95', num: true, f: (r) => fmtMs(r.med) },
      { k: 'last', label: 'Last full week', num: true, f: (r) => fmtMs(r.last) + (r.lastWeek ? '<small>' + esc(dShort(r.lastWeek)) + '</small>' : '') },
      { k: 'worst', label: 'Worst week', num: true, f: (r) => fmtMs(r.worst) + (r.worstWeek ? '<small>' + esc(dShort(r.worstWeek)) + '</small>' : '') },
      { k: 'slow_5s', label: '> 5 s', num: true, f: (r) => num(r.slow_5s) },
      { k: 'slowshare', label: '> 5 s share', num: true, v: (r) => rate(r.slow_5s, r.timed), f: (r) => pct(rate(r.slow_5s, r.timed)) },
    ];
    TABLES_CSV.speedapps = (r) => [r.app_id, r.timed, r.med, r.last, r.lastWeek, r.worst, r.worstWeek, r.slow_5s, r.weeks];
    TABLES_HEAD.speedapps = ['App', 'Requests', 'Typical weekly p95 ms (median of weeks)', 'p95 ms last full week', 'Last full week', 'p95 ms worst week', 'Worst week', 'Requests over 5 s', 'Weeks with requests'];
    h += '<div class="stack" style="margin-top:14px">' + card('Apps', table('speedapps', acols, agg, { sort: { k: 'med', dir: -1 }, limit: 30, csv: 'hub-speed-apps', caption: 'Speed by app' }),
      { eyebrow: dLong(w.from) + ' – ' + dLong(w.to), right: csvBtn('speedapps'), foot: 'p95 values of different weeks cannot be added up, so the table shows the typical (median) week, the last full week and the worst week.' });
    // slowest pages (each app's 10 slowest per week)
    const pg = {}; c.data.pages.forEach((r) => {
      const k = r.app_id + '|' + r.page, g = pg[k] = pg[k] || { app_id: r.app_id, page: r.page, weeks: 0, timed: 0, slow_5s: 0, errors: 0, worst: null, last: null, lastWeek: null, max: null };
      g.weeks++; g.timed += r.timed; g.slow_5s += r.slow_5s; g.errors += r.errors_4xx + r.errors_5xx;
      if (g.worst == null || r.p95_ms > g.worst) g.worst = r.p95_ms; if (g.max == null || r.max_ms > g.max) g.max = r.max_ms;
      if (!g.lastWeek || r.week > g.lastWeek) { g.lastWeek = r.week; g.last = r.p95_ms; }
    });
    const prow = Object.keys(pg).map((k) => pg[k]);
    const pcols = [
      { k: 'app_id', label: 'App', cls: 'app', f: (r) => appLink(r.app_id) }, { k: 'page', label: 'Page', cls: 'code', f: (r) => esc(r.page) },
      { k: 'timed', label: 'Requests', num: true, f: (r) => num(r.timed) },
      { k: 'worst', label: 'Worst weekly p95', num: true, f: (r) => fmtMs(r.worst) },
      { k: 'last', label: 'Latest p95', num: true, f: (r) => fmtMs(r.last) + '<small>' + esc(dShort(r.lastWeek)) + '</small>' },
      { k: 'max', label: 'Slowest', num: true, f: (r) => fmtMs(r.max) },
      { k: 'slow_5s', label: '> 5 s', num: true, f: (r) => num(r.slow_5s) }, { k: 'weeks', label: 'Weeks in top 10', num: true, f: (r) => num(r.weeks) },
    ];
    TABLES_CSV.speedpages = (r) => [r.app_id, r.page, r.timed, r.worst, r.last, r.lastWeek, r.max, r.slow_5s, r.weeks, r.errors];
    TABLES_HEAD.speedpages = ['App', 'Page', 'Requests', 'Worst weekly p95 ms', 'Latest weekly p95 ms', 'Latest week', 'Slowest ms', 'Requests over 5 s', 'Weeks in the app top 10', 'Errors'];
    h += card('Slowest pages', '<div class="card-b"><div class="toolbar" style="margin:0"><label class="label" for="speedApp">App</label><select class="select" id="speedApp" data-chg="speedApp" data-fid="speedApp">' + appOptions(app, 'All apps') + '</select></div></div>' +
      table('speedpages', pcols, prow, { sort: { k: 'worst', dir: -1 }, limit: 40, csv: 'hub-speed-pages', caption: 'Slowest pages', empty: 'No pages with 3+ requests in this period.' }),
      { eyebrow: 'Each app’s 10 slowest pages per week (3+ requests)', right: csvBtn('speedpages') }) + '</div>';
    return h;
  }

  // ════════════════════════════════════════════════════════════════════════
  // 5. Errors
  // ════════════════════════════════════════════════════════════════════════
  function pageErrors() {
    pageTitle = 'Errors';
    const w = win(), app = appsById()[ui.errApp] ? ui.errApp : '';
    const c = lget(apiUrl('errors', { from: w.from, to: w.to, app: app }));
    let h = head('Adrial Hub · ' + RANGES.find((r) => r[0] === ui.range)[1], 'Errors', '5xx = the app or the Hub failed (incl. 502/503/504 from an app behind the Hub). 4xx = the request was refused (incl. 401/403 sign-in and access, 404, 429, 499 closed by the browser).',
      '<label class="sr" for="errApp">App</label><select class="select" id="errApp" data-chg="errApp" data-fid="errApp">' + appOptions(app, 'All apps') + '</select>');
    const wait = lwait([c], 'error data');
    if (wait) return h + wait;
    const d = c.data;
    let days;
    if (app) { const by = {}; d.days.forEach((r) => { by[r.date] = r; }); days = dateList(w.from, w.to).map((x) => by[x] || { date: x, errors_4xx: 0, errors_5xx: 0 }); }
    else days = fillDays(w, d.totals);
    const at = app ? d.apps.filter((a) => a.app_id === app) : d.apps;
    const t5 = sum(at, 'errors_5xx'), t4 = sum(at, 'errors_4xx'), tt = sum(at, 'timed');
    h += '<div class="kpis">' + kpi('5xx server errors', num(t5), pct(rate(t5, tt), 2) + ' of ' + num(tt) + ' requests', t5 ? 'neg' : 'pos') +
      kpi('4xx client errors', num(t4), pct(rate(t4, tt), 2) + ' of requests') +
      kpi('Days with 5xx', num(days.filter((x) => x.errors_5xx > 0).length) + '<small> / ' + days.length + '</small>') +
      kpi(app ? 'Last 5xx' : 'Apps with 5xx', app ? esc(at[0] && at[0].last_5xx ? dLong(at[0].last_5xx) : '–') : num(at.filter((a) => a.errors_5xx > 0).length) + '<small> / ' + at.length + '</small>') + '</div>';
    h += card('Errors per day' + (app ? ' · ' + app : ''), '<div class="chart-wrap">' + barChart({ id: 'ed', labels: days.map((x) => dShort(x.date)), tipLabels: days.map((x) => dLong(x.date)), fmt: num, aria: 'Errors per day',
      series: [{ name: '5xx server errors', color: C[2], values: days.map((x) => x.errors_5xx || 0) }, { name: '4xx client errors', color: C[3], values: days.map((x) => x.errors_4xx || 0) }] }) + '</div>', { eyebrow: app ? 'One app' : 'All apps' });
    const acols = [
      { k: 'app_id', label: 'App', cls: 'app', f: (r) => appLink(r.app_id) },
      { k: 'timed', label: 'Requests', num: true, f: (r) => num(r.timed) },
      { k: 'errors_5xx', label: '5xx', num: true, f: (r) => num(r.errors_5xx) }, { k: 'r5', label: '5xx share', num: true, v: (r) => rate(r.errors_5xx, r.timed), f: (r) => pct(rate(r.errors_5xx, r.timed), 2) },
      { k: 'days_with_5xx', label: 'Days with 5xx', num: true, f: (r) => num(r.days_with_5xx) }, { k: 'last_5xx', label: 'Last 5xx', cls: 'nw', f: (r) => esc(r.last_5xx ? dLong(r.last_5xx) : '–') },
      { k: 'errors_4xx', label: '4xx', num: true, f: (r) => num(r.errors_4xx) }, { k: 'r4', label: '4xx share', num: true, v: (r) => rate(r.errors_4xx, r.timed), f: (r) => pct(rate(r.errors_4xx, r.timed), 2) },
      { k: 'last_4xx', label: 'Last 4xx', cls: 'nw', f: (r) => esc(r.last_4xx ? dLong(r.last_4xx) : '–') },
    ];
    h += '<div class="stack" style="margin-top:14px">' + card('Apps', table('errapps', acols, at.filter((a) => a.errors_4xx + a.errors_5xx > 0), { sort: { k: 'errors_5xx', dir: -1 }, limit: 30, csv: 'hub-errors-apps', caption: 'Errors by app', empty: 'No errors in this period.' }),
      { eyebrow: dLong(w.from) + ' – ' + dLong(w.to), right: csvBtn('errapps') });
    const pcols = [
      { k: 'app_id', label: 'App', cls: 'app', f: (r) => appLink(r.app_id) }, { k: 'page', label: 'Page', cls: 'code', f: (r) => esc(r.page) },
      { k: 'timed', label: 'Requests', num: true, f: (r) => num(r.timed) },
      { k: 'errors_5xx', label: '5xx', num: true, f: (r) => num(r.errors_5xx) }, { k: 'errors_4xx', label: '4xx', num: true, f: (r) => num(r.errors_4xx) },
      { k: 'weeks_with_errors', label: 'Weeks with errors', num: true, f: (r) => num(r.weeks_with_errors) },
      { k: 'last_week', label: 'Last error week', cls: 'nw', f: (r) => esc(r.last_week ? dLong(r.last_week) : '–') },
    ];
    h += card('Pages with errors', table('errpg', pcols, d.pages, { sort: { k: 'errors_5xx', dir: -1 }, limit: 40, csv: 'hub-errors-pages', caption: 'Pages with errors', empty: 'No page with errors in this period.' }),
      { eyebrow: dLong(w.from) + ' – ' + dLong(w.to) + ' (whole weeks)', right: csvBtn('errpg') });
    const rcols = [
      { k: 'app_id', label: 'App', cls: 'app', f: (r) => appLink(r.app_id) },
      { k: 'route', label: 'Endpoint', cls: 'code', f: (r) => '<span class="muted">' + esc(r.method) + '</span> ' + esc(r.route) },
      { k: 'timed', label: 'Requests', num: true, f: (r) => num(r.timed) },
      { k: 'errors_5xx', label: '5xx', num: true, f: (r) => num(r.errors_5xx) }, { k: 'errors_4xx', label: '4xx', num: true, f: (r) => num(r.errors_4xx) },
      { k: 'last_error', label: 'Last error', cls: 'nw', f: (r) => esc(r.last_error ? dLong(r.last_error) : '–') },
    ];
    h += card('Endpoints with errors', table('errrt', rcols, d.routes, { sort: { k: 'errors_5xx', dir: -1 }, limit: 40, csv: 'hub-errors-endpoints', caption: 'Endpoints with errors', empty: 'No endpoint with errors in the last 30 days.' }),
      { eyebrow: 'Last 30 days', right: csvBtn('errrt') }) + '</div>';
    return h;
  }

  // ════════════════════════════════════════════════════════════════════════
  // 6. Cost (Cloud billing export)
  // ════════════════════════════════════════════════════════════════════════
  function pageCost() {
    pageTitle = 'Cost';
    const w = win(costThru(), 'Cloud billing export'), c = lget(apiUrl('cost', w));
    let h = head('Cloud billing · ' + RANGES.find((r) => r[0] === ui.range)[1], 'Cost', 'Google Cloud cost per day and service (USD, after credits) for every project on the billing account, and the part that can be traced to a Hub app.');
    const wait = lwait([c], 'cost data');
    if (wait) return h + wait;
    const d = c.data, wl = d.workloads, total = sum(d.days, 'cost');   // per-day rows hold every cent; the workload list leaves out sub-cent ones
    const hubApps = wl.filter((x) => x.hub_app && x.hub_app !== '(hub platform)'), hubCost = sum(hubApps, 'cost');
    const platform = sum(wl.filter((x) => x.hub_app === '(hub platform)'), 'cost'), unl = sum(wl.filter((x) => x.attribution === 'BigQuery unlabelled jobs'), 'cost');
    const bq = sum(wl.filter((x) => x.service === 'BigQuery'), 'cost');
    h += '<div class="kpis">' + kpi('Total cost', usd(total), dLong(w.from) + ' – ' + dLong(w.to)) +
      kpi('Traced to Hub apps', usd(hubCost), pct(rate(hubCost, total)) + ' of the total') +
      kpi('Hub itself (adrial-hub)', usd(platform), 'Cloud Run service') +
      kpi('Unlabelled BigQuery jobs', usd(unl), pct(rate(unl, total)) + ' of the total · ' + pct(rate(unl, bq), 0) + ' of BigQuery', unl > total * 0.2 ? 'neg' : '') +
      kpi('Credits', usd(sum(wl, 'credits')), 'already taken off') + '</div>';
    if (!wl.length) return h + '<div class="card pad empty">No billing rows in this period.</div>';
    h += '<div class="notice info"><span><b>What can be traced:</b> Cloud Run cost per service, and BigQuery jobs that carry a label <code>app</code> (or <code>application</code>). ' +
      'Unlabelled BigQuery jobs (' + pct(rate(unl, total), 0) + ' of all cost here) cannot be split by app from the billing export. To trace them, every BigQuery job the Hub and its apps run needs the job label <code>app=&lt;app id&gt;</code> (the Hub already does this for a few apps, e.g. purchasing); the alternative is joining INFORMATION_SCHEMA.JOBS by service account. Service names are matched to Hub app ids by name.</span></div>';
    // daily cost by service: top 3 services + the rest
    const svcTot = {}; d.days.forEach((r) => { svcTot[r.service] = (svcTot[r.service] || 0) + r.cost; });
    const svcs = Object.keys(svcTot).sort((a, b) => svcTot[b] - svcTot[a]), top = svcs.slice(0, 3);
    const by = {}; d.days.forEach((r) => { const k = top.indexOf(r.service) >= 0 ? r.service : 'Other services'; (by[r.date] = by[r.date] || {})[k] = ((by[r.date] || {})[k] || 0) + r.cost; });
    const dl = dateList(w.from, w.to).filter((x) => x <= (d.costThrough || w.to));
    const keys = top.concat(svcs.length > 3 ? ['Other services'] : []);
    h += card('Cost per day', '<div class="chart-wrap">' + barChart({ id: 'cd', labels: dl.map(dShort), tipLabels: dl.map(dLong), fmt: usd, axis: (v) => '$' + Math.round(v), aria: 'Cloud cost per day by service',
      series: keys.map((k, i) => ({ name: k, color: C[i], values: dl.map((x) => (by[x] && by[x][k]) || 0) })) }) + '</div>', { eyebrow: 'USD after credits · Pacific-time days, as in the Cloud console' });
    // per Hub app
    const ap = {}; hubApps.forEach((x) => { const g = ap[x.hub_app] = ap[x.hub_app] || { app_id: x.hub_app, cost: 0, run: 0, bq: 0, other: 0, workloads: [] }; g.cost += x.cost; if (x.service === 'Cloud Run') g.run += x.cost; else if (x.service === 'BigQuery') g.bq += x.cost; else g.other += x.cost; if (g.workloads.indexOf(x.workload) < 0) g.workloads.push(x.workload); });
    const A = appsById(), arows = Object.keys(ap).map((k) => Object.assign(ap[k], { users_30d: A[k] ? A[k].users_30d : null }));
    const acols = [
      { k: 'app_id', label: 'Hub app', cls: 'app', f: (r) => appLink(r.app_id) },
      { k: 'cost', label: 'Cost', num: true, f: (r) => usd(r.cost) }, { k: 'run', label: 'Cloud Run', num: true, f: (r) => usd(r.run) }, { k: 'bq', label: 'BigQuery (labelled)', num: true, f: (r) => usd(r.bq) },
      { k: 'users_30d', label: 'Users 30 d', num: true, f: (r) => num(r.users_30d) },
      { k: 'workloads', label: 'Matched by', cls: 'code', v: (r) => r.workloads.join(' '), f: (r) => esc(r.workloads.join(', ')) },
    ];
    TABLES_CSV.costapps = (r) => [r.app_id, r.cost.toFixed(4), r.run.toFixed(4), r.bq.toFixed(4), r.other.toFixed(4), r.users_30d, r.workloads.join(' ')];
    TABLES_HEAD.costapps = ['Hub app', 'Cost USD', 'Cloud Run USD', 'BigQuery labelled USD', 'Other USD', 'Users 30 d', 'Matched workloads'];
    h += '<div class="stack" style="margin-top:14px">' + card('Cost traced to Hub apps', table('costapps', acols, arows, { sort: { k: 'cost', dir: -1 }, limit: 40, csv: 'hub-cost-apps', caption: 'Cost per Hub app', empty: 'No cost could be traced to a Hub app.' }),
      { eyebrow: 'Lower bound: unlabelled BigQuery jobs and shared storage are not included', right: csvBtn('costapps') });
    const services = Array.from(new Set(wl.map((x) => x.service))).sort();
    const svc = services.indexOf(ui.costService) >= 0 ? ui.costService : '', q = search.cost.trim().toLowerCase();
    const rows = wl.filter((x) => (!svc || x.service === svc) && (!q || (x.workload + ' ' + x.project_id + ' ' + x.hub_app + ' ' + x.attribution).toLowerCase().indexOf(q) >= 0));
    const wcols = [
      { k: 'service', label: 'Service', cls: 'nw' }, { k: 'attribution', label: 'Traced by', cls: 'nw' },
      { k: 'workload', label: 'Workload', cls: 'code', f: (r) => esc(r.workload) }, { k: 'hub_app', label: 'Hub app', cls: 'nw', f: (r) => (r.hub_app && r.hub_app !== '(hub platform)' ? appLink(r.hub_app) : esc(r.hub_app || '–')) },
      { k: 'project_id', label: 'Project', cls: 'nw' },
      { k: 'cost', label: 'Cost', num: true, f: (r) => usd(r.cost) }, { k: 'credits', label: 'Credits', num: true, f: (r) => usd(r.credits) }, { k: 'days', label: 'Days', num: true },
    ];
    TABLES_CSV.workloads = (r) => [r.project_id, r.service, r.attribution, r.workload, r.hub_app, r.gross_cost, r.credits, r.cost, r.currency, r.days];
    TABLES_HEAD.workloads = ['Project', 'Service', 'Traced by', 'Workload', 'Hub app', 'Cost before credits', 'Credits', 'Cost', 'Currency', 'Days'];
    h += card('All workloads', '<div class="card-b"><div class="toolbar" style="margin:0"><label class="sr" for="costSvc">Service</label><select class="select" id="costSvc" data-chg="costService" data-fid="costSvc"><option value="">All services</option>' +
      services.map((s) => '<option' + (s === svc ? ' selected' : '') + '>' + esc(s) + '</option>').join('') + '</select><label class="sr" for="costQ">Find</label><input class="search" id="costQ" type="search" placeholder="Workload, project or app" value="' + esc(search.cost) + '" data-chg="searchCost" data-fid="costQ" autocomplete="off"></div></div>' +
      table('workloads', wcols, rows, { sort: { k: 'cost', dir: -1 }, limit: 50, csv: 'hub-cost-workloads', caption: 'Cost per workload', empty: 'Nothing matches.' }),
    { eyebrow: dLong(w.from) + ' – ' + dLong(w.to), right: csvBtn('workloads'), foot: 'Workload = Cloud Run service or job, BigQuery job label (app / pipeline), scheduled queries, BigQuery storage per dataset, Cloud Storage bucket, or another resource. Billing rows of the last 7 days can still change.' }) + '</div>';
    return h;
  }
  const TABLES_CSV = {}, TABLES_HEAD = {};

  // ── actions ──────────────────────────────────────────────────────────────
  const ACT = {
    retry: () => { Object.keys(LC).forEach((k) => { if (LC[k].status === 'error') delete LC[k]; }); rerender(); },
    retryMeta: () => start(),
    recheck: () => checkSession(),
    signin: () => { if (window.AdrialSync && window.AdrialSync.signIn) window.AdrialSync.signIn(); else toast('Sign-in is not available on this server.'); },
    range: (d) => { ui.range = d.v; saveUi(); rerender(); },
    sort: (d) => {
      const t = TABLES[d.t], cur = SORT[d.t] || (t && t.sort);
      SORT[d.t] = { k: d.k, dir: cur && cur.k === d.k ? -cur.dir : (t && t.cols.some((c) => c.k === d.k && c.num) ? -1 : 1) };
      rerender();
    },
    more: (d) => { MORE[d.t] = true; rerender(); },
    csv: (d) => {
      const t = TABLES[d.t]; if (!t) return;
      const head = TABLES_HEAD[d.t] || t.cols.map((c) => c.label), row = TABLES_CSV[d.t] || ((r) => t.cols.map((c) => (c.v ? c.v(r) : r[c.k])));
      downloadCsv(t.name, head, t.rows.map(row));
    },
    appsFilter: (d) => { ui.appsFilter = d.v; saveUi(); rerender(); },
  };
  const CHG = {
    minUsers: (el) => { const v = Math.round(+el.value); if (el.value !== '' && v >= 0 && v <= 1000) { ui.minUsers = v; saveUi(); rerender(); } },
    countAdmins: (el) => { ui.countAdmins = el.checked; saveUi(); rerender(); },
    searchApps: (el) => { search.apps = el.value.slice(0, 60); rerender(); },
    searchCost: (el) => { search.cost = el.value.slice(0, 60); rerender(); },
    appPick: (el) => { location.hash = '#/app/' + encodeURIComponent(el.value); },
    speedPick: (el) => {
      const cur = [0, 1, 2].map((i) => { const s = $('sp' + i); return s ? s.value : ''; });
      ui.speedPick = cur.filter((x, i) => x && cur.indexOf(x) === i); saveUi(); rerender();
    },
    speedApp: (el) => { ui.speedApp = el.value; saveUi(); rerender(); },
    errApp: (el) => { ui.errApp = el.value; saveUi(); rerender(); },
    costService: (el) => { ui.costService = el.value; saveUi(); rerender(); },
  };
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (b && ACT[b.getAttribute('data-act')]) { e.preventDefault(); ACT[b.getAttribute('data-act')](b.dataset, b); return; }
    if (e.target.closest('#nav a')) setMenu(false);
  });
  document.addEventListener('input', (e) => { const el = e.target.closest('[data-chg]'); if (el && (el.type === 'search' || el.type === 'number')) CHG[el.getAttribute('data-chg')](el); });
  document.addEventListener('change', (e) => { const el = e.target.closest('[data-chg]'); if (el && el.type !== 'search' && el.type !== 'number') CHG[el.getAttribute('data-chg')](el); });
  $('menuBtn').addEventListener('click', () => setMenu(!$('side').classList.contains('open')));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('side').classList.contains('open')) { setMenu(false); $('menuBtn').focus(); } });
  window.addEventListener('hashchange', onRoute);
  if (PHONE.addEventListener) PHONE.addEventListener('change', () => rerender());

  // ── start ────────────────────────────────────────────────────────────────
  route = parseRoute();
  renderChrome();
  watchAuth();
  checkSession();
})();
