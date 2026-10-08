/* Customer service quality & chatbot — LIVE data only (allow-listed accounts, server: /csquality.js).
 *
 * Reads /api/csquality/* (daily aggregates of the Daktela tickets, NPS, calls, AI chatbot and AI contact
 * reasons by market / queue / bot). Nothing is stored in the browser: every number lives in page memory
 * (CACHE) and is dropped on a 401/403, on sign-out or when the account changes. No demo data.
 */
(function () {
  'use strict';

  const API = '/api/csquality/';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DAY = 864e5;
  const MARKET_NAMES = { IT: 'Italy', CRO: 'Croatia', SI: 'Slovenia', Crulle: 'Crullé', Other: 'Other' };
  const MARKET_ORDER = ['IT', 'CRO', 'SI', 'Crulle', 'Other'];
  const MCOL = { IT: 'var(--c1)', CRO: 'var(--c2)', SI: 'var(--c3)', Crulle: 'var(--c4)', Other: 'var(--c5)' };
  const PAL = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)'];
  // first-answer histogram bucket edges (seconds), same as fa_bucket() in sql/csquality_app_refresh.sql
  const EDGES = [300, 900, 1800, 3600, 7200, 10800, 14400, 21600, 28800, 43200, 57600, 86400, 129600, 172800, 259200, 345600, 432000, 604800, 1209600];

  const ROUTES = [
    { id: 'overview', title: 'Overview', icon: '<path d="M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-4H4zM14 4v4h6V4z"/>' },
    { id: 'nps', title: 'NPS', icon: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>' },
    { id: 'tickets', title: 'Tickets', icon: '<path d="M4 6h16v4a2 2 0 0 0 0 4v4H4v-4a2 2 0 0 0 0-4z"/>' },
    { id: 'chatbot', title: 'Chatbot', icon: '<path d="M5 5h14v10H9l-4 4z"/><path d="M9 10h.01M12 10h.01M15 10h.01"/>' },
    { id: 'reasons', title: 'Contact reasons', icon: '<path d="M4 6h16M4 12h10M4 18h6"/>' },
    { id: 'calls', title: 'Calls', icon: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>' },
  ];

  let SESSION = { checked: false, signedIn: false, allowed: false, email: null, failed: false };
  let META = null;          // { freshness, dataThrough }
  let CACHE = {};           // url -> { status, data, err, code }
  let GEN = 0;
  const F = { market: '', from: '', to: '', range: '90' };
  let route = 'overview';
  const charts = {};        // chart id -> spec (page memory only)
  const sorts = {};         // table id -> { key, dir }
  const csvs = {};          // csv id -> () => rows

  // ── small helpers ──────────────────────────────────────────────────────
  const fmtN = (n) => (n == null || !isFinite(n) ? '–' : Math.round(n).toLocaleString('en-GB'));
  const pct = (a, b, d) => (b ? (100 * a / b).toFixed(d == null ? 0 : d) + ' %' : '–');
  const pctv = (a, b) => (b ? 100 * a / b : null);
  const nps = (p, d, n) => (n ? Math.round(100 * (p - d) / n) : null);
  const signed = (v) => (v == null ? '–' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v));
  function dur(s) {
    if (s == null || !isFinite(s)) return '–';
    if (s < 3600) return Math.max(1, Math.round(s / 60)) + ' min';
    if (s < 48 * 3600) return (s / 3600).toFixed(s < 36000 ? 1 : 0) + ' h';
    return (s / 86400).toFixed(1) + ' d';
  }
  const secs = (s) => (s == null || !isFinite(s) ? '–' : s < 120 ? Math.round(s) + ' s' : (s / 60).toFixed(1) + ' min');
  const iso = (d) => d.toISOString().slice(0, 10);
  const pd = (s) => new Date(s + 'T00:00:00Z');
  function isoWeek(s) { const d = pd(s); const wd = (d.getUTCDay() + 6) % 7; return iso(new Date(d - wd * DAY)); }
  const month = (s) => s.slice(0, 7);
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function lab(k) {
    if (k.length === 7) return MON[+k.slice(5, 7) - 1] + ' ' + k.slice(2, 4);
    return +k.slice(8, 10) + ' ' + MON[+k.slice(5, 7) - 1];
  }
  function sum(rows, k) { let s = 0; for (const r of rows) s += +r[k] || 0; return s; }
  function group(rows, keyFn) {
    const m = new Map();
    for (const r of rows) { const k = keyFn(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
    return m;
  }
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 3200);
  }
  // percentile estimated from the histogram (linear inside a bucket; the last bucket is open-ended)
  function histPct(counts, q) {
    let total = 0; for (const c of counts) total += c || 0;
    if (!total) return null;
    const target = q * total; let acc = 0;
    for (let i = 0; i < counts.length; i++) {
      const c = counts[i] || 0;
      if (acc + c >= target && c > 0) {
        const lo = i === 0 ? 0 : EDGES[i - 1], hi = i < EDGES.length ? EDGES[i] : EDGES[EDGES.length - 1] * 2;
        return lo + (hi - lo) * ((target - acc) / c);
      }
      acc += c;
    }
    return EDGES[EDGES.length - 1];
  }
  function histOf(rows) { const h = new Array(EDGES.length + 1).fill(0); for (const r of rows) h[+r.bucket] += +r.n || 0; return h; }
  // granularity: weekly for short windows, monthly for long ones
  function gran(days) { return days > 120 ? 'month' : 'week'; }
  function periodKey(g) { return g === 'month' ? (r) => month(r.date || r.week) : (r) => (r.week || isoWeek(r.date)); }
  function periods(g) {
    const out = []; let d = pd(F.from); const end = pd(F.to);
    if (g === 'month') { d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)); while (d <= end) { out.push(iso(d).slice(0, 7)); d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)); } }
    else { d = pd(isoWeek(F.from)); while (d <= end) { out.push(iso(d)); d = new Date(+d + 7 * DAY); } }
    return out;
  }
  const days = () => Math.round((pd(F.to) - pd(F.from)) / DAY) + 1;
  const marketsIn = (rows) => MARKET_ORDER.filter((m) => rows.some((r) => r.market === m));

  // ── fetching (same-origin GET, sign-in cookie; only the server's `error` text is shown) ──
  function url(r) {
    const q = new URLSearchParams();
    if (r !== 'meta') { q.set('from', F.from); q.set('to', F.to); if (F.market) q.set('market', F.market); }
    const s = q.toString();
    return API + r + (s ? '?' + s : '');
  }
  function fetchJson(u) {
    return fetch(u, { credentials: 'same-origin', headers: { Accept: 'application/json' }, cache: 'no-store' }).then((r) => r.json().catch(() => ({})).then((j) => {
      if (r.ok) return j;
      const msg = j && typeof j.error === 'string' && j.error ? j.error.slice(0, 300) :
        r.status === 401 ? 'Sign in to see live customer service data.' : r.status === 403 ? 'Your account is not on the list for live customer service data.' : 'The customer service data is unavailable right now.';
      const e = new Error(msg); e.status = r.status; throw e;
    }), () => { const e = new Error('Could not reach the server. Check the connection and try again.'); e.status = 0; throw e; });
  }
  function get(r) {
    const u = url(r);
    let c = CACHE[u];
    if (c) return c;
    const g = GEN;
    c = CACHE[u] = { status: 'loading' };
    fetchJson(u).then((d) => {
      if (g !== GEN || CACHE[u] !== c) return;
      c.status = 'ok'; c.data = d;
      schedule();
    }, (e) => {
      if (g !== GEN || CACHE[u] !== c) return;
      c.status = 'error'; c.err = e.message; c.code = e.status;
      if (e.status === 401 || e.status === 403) denied(e.status); else schedule();
    });
    return c;
  }
  function forget() { GEN++; CACHE = {}; META = null; Object.keys(charts).forEach((k) => delete charts[k]); Object.keys(csvs).forEach((k) => delete csvs[k]); }
  function denied(code) {
    forget();
    SESSION.allowed = false;
    if (code === 401) SESSION.signedIn = false;
    toast(code === 401 ? 'Your sign-in ended: live data is hidden.' : 'This account has no access to live customer service data.');
    checkSession();
  }
  let rt = null;
  function schedule() { clearTimeout(rt); rt = setTimeout(render, 20); }
  function wait(cs, what) {
    for (const c of cs) if (c.status === 'error') return errorCard(c);
    for (const c of cs) if (c.status !== 'ok') return '<div class="card pad"><p class="loading" role="status" style="margin:6px 0"><i aria-hidden="true"></i>Loading ' + esc(what) + '…</p></div>';
    return null;
  }
  function errorCard(c) {
    const t = { 0: 'Could not reach the server', 400: 'That range could not be shown', 401: 'Sign in to see live data', 403: 'No access to live data' }[c.code] || 'Could not load this part of the data';
    return '<div class="card pad lerr" role="alert"><h2>' + esc(t) + '</h2><p>' + esc(c.err || '') + '</p>' +
      (c.code !== 400 ? '<button type="button" class="btn" data-act="retry">Try again</button>' : '') + '</div>';
  }

  // ── session and the gate page ───────────────────────────────────────────
  let sessP = null;
  function checkSession() {
    if (sessP) return sessP;
    sessP = fetch(API + 'session', { credentials: 'same-origin', headers: { Accept: 'application/json' }, cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error('session ' + r.status); return r.json(); })
      .then((j) => { SESSION = { checked: true, failed: false, signedIn: !!j.signedIn, allowed: !!j.allowed, email: j.email || null }; },
        () => { SESSION = { checked: true, failed: true, signedIn: false, allowed: false, email: null }; })
      .then(() => { sessP = null; if (!SESSION.allowed) forget(); render(); });
    return sessP;
  }
  function watchAuth() {
    if (!window.AdrialSync || !window.AdrialSync.on) return;
    // compare only once the sign-in library knows who is signed in: its first "loaded" event is not a change
    (window.AdrialSync.ready || Promise.resolve()).then(() => {
      let last = (window.AdrialSync.user() || {}).email || '';
      window.AdrialSync.on(() => { const now = (window.AdrialSync.user() || {}).email || ''; if (now !== last) { last = now; forget(); checkSession(); } });
    });
  }
  function gate() {
    $('app').classList.add('gated');
    const s = SESSION;
    const msg = s.failed ? '<p class="muted" role="alert">Could not check your access right now. Check the connection and try again.</p><div class="acts"><button type="button" class="btn pri" data-act="recheck">Try again</button></div>'
      : !s.signedIn ? '<p><b>Live data for approved accounts — sign in.</b></p><div class="acts"><button type="button" class="btn pri" data-act="signin">Sign in</button></div>'
      : '<p role="alert"><b>Your account (' + esc(s.email) + ') is not on the list</b> for live customer service data. Ask Simon to add it.</p><div class="acts"><button type="button" class="btn" data-act="signin">Use another account</button></div>';
    $('page').innerHTML = '<section class="gate" aria-labelledby="gh"><span class="eyebrow">Adrial Apps · live data</span>' +
      '<h1 id="gh" tabindex="-1">Customer service quality &amp; chatbot</h1>' +
      '<p class="lead">How well customer service answers, and how much of the work the AI chatbot handles, from the Daktela data, refreshed every morning.</p>' +
      '<ul><li><b>Overview</b>: NPS trend, time to first answer, SLA overdue and the bot handover rate.</li>' +
      '<li><b>NPS</b> by market and channel, with promoters, passives and detractors.</li>' +
      '<li><b>Tickets</b>: response times and SLA by queue.</li>' +
      '<li><b>Chatbot</b>: chats, handovers to a person per bot and market, topics.</li>' +
      '<li><b>Contact reasons</b>: AI-classified reasons for writing in, by week.</li>' +
      '<li><b>Calls</b>: inbound calls, answered and waiting time, with data-quality notes.</li></ul>' +
      '<p class="muted" style="font-size:13.5px">Totals by market, queue and bot only: no customer details and no agent names.</p>' + msg + '</section>';
  }

  // ── chrome: nav, freshness, filters ─────────────────────────────────────
  function renderNav() {
    $('nav').innerHTML = ROUTES.map((r) => '<a href="#/' + r.id + '"' + (r.id === route ? ' aria-current="page"' : '') + '><svg viewBox="0 0 24 24" aria-hidden="true">' + r.icon + '</svg>' + esc(r.title) + '</a>').join('');
    const fr = META && META.freshness ? META.freshness.filter((f) => f.source !== 'Summary rebuilt') : [];
    $('sideFoot').innerHTML = '<span class="live-pill"><i aria-hidden="true"></i>Live data · ' + esc(SESSION.email || '') + '</span>' +
      (fr.length ? '<ul class="fresh" aria-label="Data through">' + fr.map((f) => '<li><span>' + esc(f.source) + '</span><b>' + esc(f.data_through || '–') + '</b></li>').join('') + '</ul>' : '');
  }
  function filters() {
    const ranges = [['30', '30 days'], ['90', '90 days'], ['182', '6 months'], ['395', '13 months']];
    return '<form class="filters" id="filters" aria-label="Filters" onsubmit="return false">' +
      '<label><span class="label">Market</span><select class="select" id="fMarket">' +
      '<option value="">All markets</option>' + MARKET_ORDER.map((m) => '<option value="' + m + '"' + (F.market === m ? ' selected' : '') + '>' + esc(MARKET_NAMES[m]) + '</option>').join('') + '</select></label>' +
      '<label><span class="label">From</span><input class="date" type="date" id="fFrom" value="' + esc(F.from) + '" max="' + esc(META.dataThrough || '') + '"></label>' +
      '<label><span class="label">To</span><input class="date" type="date" id="fTo" value="' + esc(F.to) + '" max="' + esc(META.dataThrough || '') + '"></label>' +
      '<div class="grow"></div><div class="chips" role="group" aria-label="Quick ranges">' +
      ranges.map((r) => '<button type="button" class="chip" data-act="range" data-v="' + r[0] + '" aria-pressed="' + (F.range === r[0]) + '">' + r[1] + '</button>').join('') + '</div></form>';
  }
  function setRange(nd) {
    const end = pd(META.dataThrough);
    F.to = META.dataThrough; F.from = iso(new Date(end - (nd - 1) * DAY)); F.range = String(nd);
  }
  function head(eyebrow, title, sub, extra) {
    return '<div class="head"><div><span class="eyebrow">' + esc(eyebrow) + '</span><h1 id="h1" tabindex="-1">' + esc(title) + '</h1>' +
      (sub ? '<p class="sub">' + sub + '</p>' : '') + '</div>' + (extra || '') + '</div>';
  }
  const scope = () => (F.market ? MARKET_NAMES[F.market] : 'All markets') + ' · ' + lab(F.from) + ' ' + F.from.slice(0, 4) + ' – ' + lab(F.to) + ' ' + F.to.slice(0, 4);
  function kpi(label, v, d, cls, href) {
    const tag = href ? 'a href="' + href + '"' : 'div';
    return '<' + tag + ' class="kpi"><span class="label">' + esc(label) + '</span><span class="v">' + v + '</span>' + (d ? '<span class="d ' + (cls || '') + '">' + d + '</span>' : '') + '</' + (href ? 'a' : 'div') + '>';
  }
  function card(title, sub, body, actions) {
    return '<section class="card"><div class="card-h"><div><h2>' + esc(title) + '</h2>' + (sub ? '<p>' + sub + '</p>' : '') + '</div>' + (actions || '') + '</div><div class="card-b">' + body + '</div></section>';
  }
  function csvBtn(id, label) { return '<button type="button" class="btn sm" data-act="csv" data-v="' + id + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>' + esc(label || 'CSV') + '</button>'; }

  // ── charts (SVG, drawn at the container's real width) ───────────────────
  function chartBox(id, spec) {
    charts[id] = spec;
    const leg = spec.series.length > 1 || spec.legend ? '<ul class="legend">' + spec.series.map((s) => '<li><i class="' + (spec.kind === 'line' ? 'ln' : '') + '" style="background:' + s.color + '"></i>' + esc(s.name) + '</li>').join('') + '</ul>' : '';
    return leg + '<div class="chart" id="ch-' + id + '" role="img" aria-label="' + esc(spec.label) + '"></div>';
  }
  function drawCharts() { Object.keys(charts).forEach((id) => { const el = $('ch-' + id); if (el) draw(el, charts[id]); }); }
  function draw(el, s) {
    const W = Math.max(260, el.clientWidth || 600), H = s.height || 220, pl = s.pl || 46, pr = s.pr || (s.right ? 46 : 12), pt = 10, pb = 26;
    const n = s.labels.length, iw = W - pl - pr, ih = H - pt - pb;
    const all = []; s.series.forEach((x) => { if (!x.right) x.values.forEach((v) => { if (v != null && isFinite(v)) all.push(v); }); });
    if (s.kind === 'stack') { for (let i = 0; i < n; i++) { let t = 0; s.series.forEach((x) => { t += x.values[i] || 0; }); all.push(t); } }
    if (!n || !all.length) { el.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '"><text class="empty" x="' + (W / 2) + '" y="' + (H / 2) + '" text-anchor="middle">No data in this range</text></svg>'; return; }
    let lo = s.min != null ? s.min : Math.min(0, ...all), hi = s.max != null ? s.max : Math.max(...all);
    if (hi === lo) hi = lo + 1;
    const ticks = niceTicks(lo, hi, 4); lo = Math.min(lo, ticks[0]); hi = Math.max(hi, ticks[ticks.length - 1]);
    const y = (v) => pt + ih - (v - lo) / (hi - lo) * ih;
    const bw = iw / n, x = (i) => pl + bw * i + bw / 2;
    let g = '';
    ticks.forEach((t) => { g += '<line class="' + (t === 0 ? 'zero' : 'grid') + '" x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y(t) + '" y2="' + y(t) + '"/><text class="ax" x="' + (pl - 6) + '" y="' + (y(t) + 3.5) + '" text-anchor="end">' + esc(s.fmt ? s.fmt(t) : t) + '</text>'; });
    const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 58))));
    s.labels.forEach((l, i) => { if (i % every === 0 || i === n - 1 && n < 8) g += '<text class="ax" x="' + x(i) + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(lab(l)) + '</text>'; });
    if (s.kind === 'bar' || s.kind === 'stack') {
      const k = s.kind === 'stack' ? 1 : s.series.filter((q) => !q.right).length, gw = Math.min(bw * 0.72, 46), w1 = gw / k;
      for (let i = 0; i < n; i++) {
        let base = 0;
        s.series.filter((q) => !q.right).forEach((q, j) => {
          const v = q.values[i]; if (v == null || !v) return;
          const x0 = s.kind === 'stack' ? x(i) - gw / 2 : x(i) - gw / 2 + j * w1, y0 = s.kind === 'stack' ? y(base + v) : y(Math.max(0, v)), h = s.kind === 'stack' ? y(base) - y(base + v) : Math.abs(y(v) - y(0));
          g += '<rect x="' + x0.toFixed(1) + '" y="' + y0.toFixed(1) + '" width="' + Math.max(1, w1 - (k > 1 ? 1 : 0)).toFixed(1) + '" height="' + Math.max(0.5, h).toFixed(1) + '" rx="2" fill="' + q.color + '"><title>' + esc(lab(s.labels[i]) + ' · ' + q.name + ': ' + (s.fmt ? s.fmt(v) : v)) + '</title></rect>';
          if (s.kind === 'stack') base += v;
        });
      }
    }
    const lines = s.kind === 'line' ? s.series : s.series.filter((q) => q.right);
    if (lines.length) {
      let rlo = 0, rhi = 100, ry = y;
      if (s.kind !== 'line') { const rv = []; lines.forEach((q) => q.values.forEach((v) => { if (v != null) rv.push(v); })); rhi = Math.max(10, ...rv); rlo = 0; const rt = niceTicks(rlo, rhi, 4); rhi = rt[rt.length - 1]; ry = (v) => pt + ih - (v - rlo) / (rhi - rlo) * ih; rt.forEach((t) => { g += '<text class="ax" x="' + (W - pr + 6) + '" y="' + (ry(t) + 3.5) + '">' + esc(s.rfmt ? s.rfmt(t) : t) + '</text>'; }); }
      lines.forEach((q) => {
        let d = '', pen = false;
        q.values.forEach((v, i) => { if (v == null || !isFinite(v)) { pen = false; return; } d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ' ' + ry(v).toFixed(1); pen = true; });
        g += '<path d="' + d + '" fill="none" stroke="' + q.color + '" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"' + (q.dash ? ' stroke-dasharray="5 4"' : '') + '/>';
        q.values.forEach((v, i) => { if (v == null || !isFinite(v)) return; g += '<circle cx="' + x(i).toFixed(1) + '" cy="' + ry(v).toFixed(1) + '" r="' + (n > 40 ? 1.8 : 3) + '" fill="' + q.color + '"><title>' + esc(lab(s.labels[i]) + ' · ' + q.name + ': ' + ((q.right ? s.rfmt : s.fmt) || String)(Math.round(v * 10) / 10)) + '</title></circle>'; });
      });
    }
    el.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" aria-hidden="true">' + g + '</svg>';
  }
  function niceTicks(lo, hi, k) {
    const span = hi - lo, step0 = span / k, mag = Math.pow(10, Math.floor(Math.log10(step0))), r = step0 / mag;
    const step = (r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10) * mag;
    const out = []; for (let v = Math.floor(lo / step) * step; v <= hi + step * 0.001; v += step) out.push(Math.round(v * 1e6) / 1e6);
    if (out[out.length - 1] < hi) out.push(out[out.length - 1] + step);
    return out;
  }

  // ── tables with sorting + CSV ───────────────────────────────────────────
  // cols: [{ k, t, num, fmt, wrap }]; rows are plain objects; foot = optional totals row
  function table(id, caption, cols, rows, foot) {
    const s = sorts[id];
    if (s) rows = rows.slice().sort((a, b) => { const x = a[s.key], y = b[s.key]; const c = (x == null) - (y == null) || (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))); return s.dir * c; });
    csvs[id] = { cols: cols, rows: rows, name: id };
    const th = cols.map((c) => '<th scope="col"' + (c.num ? ' class="num"' : '') + (s && s.key === c.k ? ' aria-sort="' + (s.dir > 0 ? 'ascending' : 'descending') + '"' : '') + '><button type="button" data-act="sort" data-t="' + id + '" data-k="' + c.k + '">' + esc(c.t) + (s && s.key === c.k ? (s.dir > 0 ? ' ↑' : ' ↓') : '') + '</button></th>').join('');
    const cell = (c, r) => '<td class="' + (c.num ? 'num' : '') + (c.wrap ? ' wrap' : '') + '">' + (c.html ? c.html(r) : esc(c.fmt ? c.fmt(r[c.k], r) : r[c.k] == null ? '–' : r[c.k])) + '</td>';
    const body = rows.length ? rows.map((r) => '<tr>' + cols.map((c) => cell(c, r)).join('') + '</tr>').join('') : '<tr><td colspan="' + cols.length + '" class="muted">No rows in this range.</td></tr>';
    return '<div class="tw"><table class="t"><caption class="sr">' + esc(caption) + '</caption><thead><tr>' + th + '</tr></thead><tbody>' + body + '</tbody>' +
      (foot && rows.length ? '<tfoot><tr>' + cols.map((c) => cell(c, foot)).join('') + '</tr></tfoot>' : '') + '</table></div>';
  }
  function downloadCsv(id) {
    const t = csvs[id]; if (!t) return;
    const q = (v) => { const s = v == null ? '' : String(v); return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const lines = [t.cols.map((c) => q(c.t)).join(',')].concat(t.rows.map((r) => t.cols.map((c) => q(c.csv ? c.csv(r) : r[c.k])).join(',')));
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'cs-quality-' + id + '-' + (F.market || 'all') + '-' + F.from + '_' + F.to + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ── derived numbers ─────────────────────────────────────────────────────
  function npsAgg(rows) {
    const e = rows.filter((r) => r.scale === '0-10'), ph = rows.filter((r) => r.scale === '1-5');
    const P = sum(e, 'promoters'), Pa = sum(e, 'passives'), D = sum(e, 'detractors'), N = P + Pa + D;
    return { P, Pa, D, N, nps: nps(P, D, N), phoneN: sum(ph, 'responses'), phoneAvg: sum(ph, 'responses') ? sum(ph, 'score_sum') / sum(ph, 'responses') : null };
  }
  function ticketAgg(rows) {
    const c = sum(rows, 'created'), a = sum(rows, 'answered');
    return { created: c, answered: a, noAnswer: sum(rows, 'closed_no_answer'), open: sum(rows, 'still_open'), sla: sum(rows, 'sla_overdue'), faOver: sum(rows, 'fa_overdue'), faAvg: a ? sum(rows, 'fa_sum_s') / a : null };
  }
  function botAgg(rows) {
    const o = {}; ['chats', 'handed_over', 'handed_over_email', 'wanted_person', 'bot_only_end', 'bot_errors', 'rated_happy', 'rated_unsure', 'rated_unhappy', 'user_messages'].forEach((k) => { o[k] = sum(rows, k); });
    return o;
  }
  const inboundIn = (rows) => rows.filter((r) => r.direction === 'Inbound' && r.hours === 'Inside hours');

  // ── pages ───────────────────────────────────────────────────────────────
  function pageOverview() {
    const cn = get('nps'), ct = get('tickets'), cb = get('bots'), cc = get('calls');
    let h = head('Overview', 'Customer service quality', esc(scope()) + '. Service quality and how much the AI chatbot handles; complements the Hub customer-service app.');
    h += filters();
    const w = wait([cn, ct, cb, cc], 'the overview');
    if (w) return h + w;
    const N = npsAgg(cn.data.rows), T = ticketAgg(ct.data.rows), B = botAgg(cb.data.rows), C = inboundIn(cc.data.rows);
    const faMed = histPct(histOf(ct.data.histWeek), 0.5);
    const ca = sum(C, 'calls'), cans = sum(C, 'answered');
    h += '<div class="kpis">' +
      kpi('NPS (e-mail)', signed(N.nps), fmtN(N.N) + ' answers · ' + pct(N.P, N.N) + ' promoters', N.nps == null ? '' : N.nps >= 20 ? 'good' : N.nps < 0 ? 'bad' : '', '#/nps') +
      kpi('First answer, median', dur(faMed), fmtN(T.answered) + ' answered tickets', '', '#/tickets') +
      kpi('SLA overdue', pct(T.sla, T.created, 1), fmtN(T.sla) + ' of ' + fmtN(T.created) + ' tickets', T.created && T.sla / T.created > 0.05 ? 'bad' : '', '#/tickets') +
      kpi('Bot handover', pct(B.handed_over, B.chats), fmtN(B.handed_over) + ' of ' + fmtN(B.chats) + ' chats to a person', '', '#/chatbot') +
      kpi('Calls answered*', pct(cans, ca), fmtN(ca) + ' inbound in working hours · *see notes', '', '#/calls') +
      '</div>';
    // NPS trend
    const g = days() > 92 ? 'month' : 'week', P = periods(g), pk = periodKey(g);
    const er = cn.data.rows.filter((r) => r.scale === '0-10');
    const ms = F.market ? [F.market] : marketsIn(er).filter((m) => m !== 'Other' && m !== 'Crulle');
    const byP = group(er, pk);
    const tot = P.map((p) => { const a = npsAgg(byP.get(p) || []); return a.N >= 5 ? a.nps : null; });
    const series = [{ name: F.market ? MARKET_NAMES[F.market] : 'All markets', color: 'var(--ink)', values: tot }];
    if (!F.market) ms.forEach((m) => { const bm = group(er.filter((r) => r.market === m), pk); series.push({ name: MARKET_NAMES[m], color: MCOL[m], dash: true, values: P.map((p) => { const a = npsAgg(bm.get(p) || []); return a.N >= 5 ? a.nps : null; }) }); });
    const npsChart = chartBox('ov-nps', { kind: 'line', labels: P, series: series, fmt: (v) => signed(v), label: 'NPS by ' + g + ': ' + P.map((p, i) => lab(p) + ' ' + signed(tot[i])).join(', ') });
    // first answer weekly median
    const W = periods('week'), hw = group(ct.data.histWeek, (r) => r.week);
    const med = W.map((p) => histPct(histOf(hw.get(p) || []), 0.5)), p90 = W.map((p) => histPct(histOf(hw.get(p) || []), 0.9));
    const faChart = chartBox('ov-fa', { kind: 'line', labels: W, series: [{ name: 'Median', color: 'var(--c1)', values: med.map((v) => (v == null ? null : v / 3600)) }, { name: '90th percentile', color: 'var(--c4)', dash: true, values: p90.map((v) => (v == null ? null : v / 3600)) }], fmt: (v) => v + ' h', label: 'Time to first answer by week, median and 90th percentile, in hours' });
    // handover by market
    const bm = group(cb.data.rows, (r) => r.market);
    const bars = MARKET_ORDER.filter((m) => bm.has(m)).map((m) => { const a = botAgg(bm.get(m)); const v = pctv(a.handed_over, a.chats) || 0; return '<div class="bar-row"><span>' + esc(MARKET_NAMES[m]) + ' <span class="muted mono" style="font-size:11.5px">' + fmtN(a.chats) + '</span></span><span class="tr" aria-hidden="true"><span class="fl" style="display:block;width:' + Math.min(100, v).toFixed(1) + '%;background:' + MCOL[m] + '"></span></span><span class="n">' + v.toFixed(0) + ' %</span></div>'; }).join('');
    // SLA overdue % weekly
    const tw = group(ct.data.rows, (r) => isoWeek(r.date));
    const slaChart = chartBox('ov-sla', { kind: 'bar', labels: W, series: [{ name: 'Tickets created', color: 'var(--c2)', values: W.map((p) => sum(tw.get(p) || [], 'created')) }, { name: 'SLA overdue %', color: 'var(--c4)', right: true, values: W.map((p) => { const r = tw.get(p) || []; return pctv(sum(r, 'sla_overdue'), sum(r, 'created')); }) }], fmt: (v) => fmtN(v), rfmt: (v) => v + ' %', legend: true, label: 'Tickets created per week with the share overdue on SLA' });
    h += '<div class="cols">' + card('NPS trend', 'E-mail survey, 0–10 scale. A ' + g + ' needs 5 answers to show.', npsChart) + card('Time to first answer', 'Answered tickets, by week of creation (hours).', faChart) + '</div>';
    h += '<div class="cols">' + card('Bot handover to a person', 'Share of finished chats transferred to an agent, by market.', '<div class="bars">' + (bars || '<p class="muted">No chats in this range.</p>') + '</div>') + card('Tickets and SLA', 'Tickets created per week (bars) and share overdue on SLA (line, right axis).', slaChart) + '</div>';
    h += notesCard();
    return h;
  }
  function notesCard() {
    return card('Notes on the data', '', '<ul class="notes">' +
      '<li>Daktela data is loaded every night (03:00); this summary is rebuilt after it, so the latest day is yesterday.</li>' +
      '<li>NPS comes from the e-mail survey (0–10). The phone survey answers on a 1–5 keypad and is shown apart as an average; it is never mixed into the NPS.</li>' +
      '<li>Ticket market comes from the Daktela ticket category. Time to first answer is as Daktela reports it; many tickets are closed without an answer (notifications, duplicates, spam) and are counted apart.</li>' +
      '<li>"Reopened" is not available: the reopen field is empty in the Daktela export.</li>' +
      '<li>Chatbot: <i>goals_hit</i> is always filled ("Discussion start" is on every chat), so it says nothing on its own. "Handed over" = transferred to a person; "ended in the bot" = the dialogue ended without a transfer.</li>' +
      '<li>Calls: see the data-quality banner on the Calls page before using the answered rate.</li></ul>');
  }

  function pageNps() {
    const cn = get('nps');
    let h = head('NPS', 'NPS by market and channel', esc(scope()) + '. Promoters answer 9–10, passives 7–8, detractors 0–6; NPS = promoters % − detractors %.');
    h += filters();
    const w = wait([cn], 'NPS'); if (w) return h + w;
    const rows = cn.data.rows, N = npsAgg(rows);
    h += '<div class="kpis">' + kpi('NPS (e-mail)', signed(N.nps), fmtN(N.N) + ' answers', N.nps == null ? '' : N.nps >= 20 ? 'good' : N.nps < 0 ? 'bad' : '') +
      kpi('Promoters', pct(N.P, N.N), fmtN(N.P) + ' answers 9–10', 'good') + kpi('Passives', pct(N.Pa, N.N), fmtN(N.Pa) + ' answers 7–8') +
      kpi('Detractors', pct(N.D, N.N), fmtN(N.D) + ' answers 0–6', 'bad') +
      kpi('Phone survey', N.phoneAvg == null ? '–' : N.phoneAvg.toFixed(1) + ' / 5', fmtN(N.phoneN) + ' keypad answers (1–5)') + '</div>';
    const g = days() > 92 ? 'month' : 'week', P = periods(g), pk = periodKey(g);
    const er = rows.filter((r) => r.scale === '0-10'), bp = group(er, pk);
    const agg = P.map((p) => npsAgg(bp.get(p) || []));
    const stack = chartBox('nps-split', { kind: 'stack', labels: P, series: [
      { name: 'Promoters', color: 'var(--good-dot)', values: agg.map((a) => (a.N ? 100 * a.P / a.N : null)) },
      { name: 'Passives', color: 'var(--c5)', values: agg.map((a) => (a.N ? 100 * a.Pa / a.N : null)) },
      { name: 'Detractors', color: 'var(--bad-dot)', values: agg.map((a) => (a.N ? 100 * a.D / a.N : null)) }], max: 100, fmt: (v) => Math.round(v) + ' %', label: 'Share of promoters, passives and detractors by ' + g });
    const ms = F.market ? [F.market] : marketsIn(er);
    const lines = chartBox('nps-mk', { kind: 'line', labels: P, series: ms.map((m) => { const b = group(er.filter((r) => r.market === m), pk); return { name: MARKET_NAMES[m], color: MCOL[m], values: P.map((p) => { const a = npsAgg(b.get(p) || []); return a.N >= 5 ? a.nps : null; }) }; }), fmt: (v) => signed(v), label: 'NPS by market and ' + g });
    h += '<div class="cols">' + card('NPS by market', 'A ' + g + ' needs 5 answers to show.', lines) + card('Promoter / detractor split', 'All selected markets, e-mail survey.', stack) + '</div>';
    // table market × channel
    const mc = group(rows, (r) => r.market + '|' + r.channel);
    const trows = [...mc.entries()].map(([k, rs]) => { const [m, ch] = k.split('|'); const a = npsAgg(rs), resp = sum(rs, 'responses'); return { market: MARKET_NAMES[m] || m, channel: ch, responses: resp, promoters: rs[0].scale === '0-10' ? a.P : null, passives: rs[0].scale === '0-10' ? a.Pa : null, detractors: rs[0].scale === '0-10' ? a.D : null, nps: rs[0].scale === '0-10' ? a.nps : null, avg: resp ? Math.round(10 * sum(rs, 'score_sum') / resp) / 10 : null, scale: rs[0].scale }; });
    if (!sorts.npsmc) sorts.npsmc = { key: 'responses', dir: -1 };
    h += card('By market and channel', 'Average score is on the channel\'s own scale (0–10 e-mail, 1–5 phone).', table('npsmc', 'NPS by market and channel', [
      { k: 'market', t: 'Market' }, { k: 'channel', t: 'Channel' }, { k: 'scale', t: 'Scale' }, { k: 'responses', t: 'Answers', num: 1, fmt: fmtN },
      { k: 'promoters', t: 'Promoters', num: 1, fmt: fmtN }, { k: 'passives', t: 'Passives', num: 1, fmt: fmtN }, { k: 'detractors', t: 'Detractors', num: 1, fmt: fmtN },
      { k: 'nps', t: 'NPS', num: 1, fmt: signed }, { k: 'avg', t: 'Avg score', num: 1 }], trows), csvBtn('npsmc'));
    // per-period table
    const prow = P.map((p, i) => ({ period: p, answers: agg[i].N, promoters: agg[i].P, passives: agg[i].Pa, detractors: agg[i].D, nps: agg[i].N ? agg[i].nps : null }));
    h += card('By ' + g, 'E-mail survey, selected markets.', table('npsper', 'NPS by ' + g, [
      { k: 'period', t: g === 'month' ? 'Month' : 'Week of', fmt: (v) => (g === 'month' ? lab(v) : v) , csv: (r) => r.period }, { k: 'answers', t: 'Answers', num: 1, fmt: fmtN }, { k: 'promoters', t: 'Promoters', num: 1, fmt: fmtN },
      { k: 'passives', t: 'Passives', num: 1, fmt: fmtN }, { k: 'detractors', t: 'Detractors', num: 1, fmt: fmtN }, { k: 'nps', t: 'NPS', num: 1, fmt: signed }], prow), csvBtn('npsper'));
    h += '<div class="note"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v5h1"/></svg><div>The phone survey has few answers and only scores 1, 2, 3 and 5 so far; what each key means is not confirmed, so treat its average with care. Crullé and other markets have no NPS survey answers.</div></div>';
    return h;
  }

  function pageTickets() {
    const ct = get('tickets');
    let h = head('Tickets', 'Response times and SLA by queue', esc(scope()) + '. Queue = the Daktela ticket category; tickets are counted on the day they were created.');
    h += filters();
    const w = wait([ct], 'tickets'); if (w) return h + w;
    const rows = ct.data.rows, T = ticketAgg(rows), hAll = histOf(ct.data.histQueue);
    h += '<div class="kpis">' + kpi('Tickets created', fmtN(T.created), fmtN(T.open) + ' still open or waiting') +
      kpi('Answered', pct(T.answered, T.created), fmtN(T.answered) + ' got a first answer') +
      kpi('Closed without answer', pct(T.noAnswer, T.created), fmtN(T.noAnswer) + ' (notifications, duplicates, spam…)') +
      kpi('First answer, median', dur(histPct(hAll, 0.5)), '90 % within ' + dur(histPct(hAll, 0.9))) +
      kpi('SLA overdue', pct(T.sla, T.created, 1), fmtN(T.sla) + ' tickets', T.created && T.sla / T.created > 0.05 ? 'bad' : '') +
      kpi('First answer late', pct(T.faOver, T.answered, 1), fmtN(T.faOver) + ' past the first-answer deadline') + '</div>';
    const W = periods('week');
    const ms = F.market ? [F.market] : marketsIn(ct.data.histWeek).filter((m) => m !== 'Other');
    const medChart = chartBox('tk-med', { kind: 'line', labels: W, series: ms.map((m) => { const b = group(ct.data.histWeek.filter((r) => r.market === m), (r) => r.week); return { name: MARKET_NAMES[m], color: MCOL[m], values: W.map((p) => { const x = histPct(histOf(b.get(p) || []), 0.5); return x == null ? null : x / 3600; }) }; }), fmt: (v) => v + ' h', label: 'Median time to first answer by week and market, hours' });
    const tw = group(rows, (r) => isoWeek(r.date));
    const volChart = chartBox('tk-vol', { kind: 'stack', labels: W, series: [
      { name: 'Answered', color: 'var(--c1)', values: W.map((p) => sum(tw.get(p) || [], 'answered')) },
      { name: 'Closed without answer', color: 'var(--c5)', values: W.map((p) => sum(tw.get(p) || [], 'closed_no_answer')) },
      { name: 'Open / waiting', color: 'var(--c4)', values: W.map((p) => sum(tw.get(p) || [], 'still_open')) }], fmt: fmtN, label: 'Tickets created per week by outcome' });
    h += '<div class="cols">' + card('Median first answer by market', 'Hours, by week of creation.', medChart) + card('Tickets per week', 'By what happened to them.', volChart) + '</div>';
    // queue table
    const hq = group(ct.data.histQueue, (r) => r.market + '|' + r.queue);
    const q = group(rows, (r) => r.market + '|' + r.queue);
    const trows = [...q.entries()].map(([k, rs]) => { const a = ticketAgg(rs), hh = histOf(hq.get(k) || []); return { market: MARKET_NAMES[rs[0].market] || rs[0].market, queue: rs[0].queue, created: a.created, answered: a.answered, answered_pct: pctv(a.answered, a.created), no_answer: a.noAnswer, open: a.open, median_s: histPct(hh, 0.5), p90_s: histPct(hh, 0.9), sla: a.sla, sla_pct: pctv(a.sla, a.created), fa_late: a.faOver }; });
    const foot = { market: 'Total', queue: '', created: T.created, answered: T.answered, answered_pct: pctv(T.answered, T.created), no_answer: T.noAnswer, open: T.open, median_s: histPct(hAll, 0.5), p90_s: histPct(hAll, 0.9), sla: T.sla, sla_pct: pctv(T.sla, T.created), fa_late: T.faOver };
    if (!sorts.queues) sorts.queues = { key: 'created', dir: -1 };
    const p1 = (v) => (v == null ? '–' : v.toFixed(1) + ' %');
    h += card('By queue', 'Median and 90th percentile are estimated from a time histogram, so they are close to (not exactly) Daktela\'s own figures.', table('queues', 'Tickets by queue', [
      { k: 'market', t: 'Market' }, { k: 'queue', t: 'Queue', wrap: 1 }, { k: 'created', t: 'Created', num: 1, fmt: fmtN }, { k: 'answered', t: 'Answered', num: 1, fmt: fmtN },
      { k: 'answered_pct', t: 'Answered %', num: 1, fmt: p1, csv: (r) => (r.answered_pct == null ? '' : r.answered_pct.toFixed(1)) }, { k: 'no_answer', t: 'Closed, no answer', num: 1, fmt: fmtN }, { k: 'open', t: 'Open', num: 1, fmt: fmtN },
      { k: 'median_s', t: '1st answer median', num: 1, fmt: dur, csv: (r) => (r.median_s == null ? '' : (r.median_s / 3600).toFixed(2) + ' h') }, { k: 'p90_s', t: '1st answer p90', num: 1, fmt: dur, csv: (r) => (r.p90_s == null ? '' : (r.p90_s / 3600).toFixed(2) + ' h') },
      { k: 'sla', t: 'SLA overdue', num: 1, fmt: fmtN }, { k: 'sla_pct', t: 'SLA overdue %', num: 1, fmt: p1, csv: (r) => (r.sla_pct == null ? '' : r.sla_pct.toFixed(1)) }, { k: 'fa_late', t: '1st answer late', num: 1, fmt: fmtN }], trows, foot), csvBtn('queues'));
    // daily export
    const drows = [...group(rows, (r) => r.date + '|' + r.market).entries()].map(([k, rs]) => { const a = ticketAgg(rs); return { date: rs[0].date, market: rs[0].market, created: a.created, answered: a.answered, no_answer: a.noAnswer, sla: a.sla, avg_h: a.faAvg == null ? null : Math.round(a.faAvg / 36) / 100 }; }).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.market.localeCompare(b.market)));
    csvs.ticketdays = { cols: [{ k: 'date', t: 'Date' }, { k: 'market', t: 'Market' }, { k: 'created', t: 'Created' }, { k: 'answered', t: 'Answered' }, { k: 'no_answer', t: 'Closed without answer' }, { k: 'sla', t: 'SLA overdue' }, { k: 'avg_h', t: 'First answer average (h)' }], rows: drows };
    h += '<p>' + csvBtn('ticketdays', 'Daily tickets by market (CSV)') + '</p>';
    return h;
  }

  function pageChatbot() {
    const cb = get('bots');
    let h = head('Chatbot', 'AI chatbot volume and handovers', esc(scope()) + '. Daktela AI chatbots on the web shops; a chat counts once, on the day it started.');
    h += filters();
    const w = wait([cb], 'chatbot data'); if (w) return h + w;
    const rows = cb.data.rows, B = botAgg(rows), rated = B.rated_happy + B.rated_unsure + B.rated_unhappy;
    h += '<div class="kpis">' + kpi('Chats', fmtN(B.chats), fmtN(B.user_messages) + ' customer messages') +
      kpi('Handed over to a person', pct(B.handed_over, B.chats), fmtN(B.handed_over) + ' chats · ' + pct(B.handed_over_email, B.handed_over) + ' of them as an e-mail ticket') +
      kpi('Ended in the bot', pct(B.bot_only_end, B.chats), fmtN(B.bot_only_end) + ' chats without a transfer', 'good') +
      kpi('Asked for a person', pct(B.wanted_person, B.chats), fmtN(B.wanted_person) + ' chats') +
      kpi('Chat rating', rated ? pct(B.rated_happy, rated) + ' happy' : '–', fmtN(rated) + ' rated · ' + fmtN(B.rated_unhappy) + ' unhappy') +
      kpi('Bot errors', pct(B.bot_errors, B.chats, 1), fmtN(B.bot_errors) + ' timeouts / not understood', B.chats && B.bot_errors / B.chats > 0.05 ? 'bad' : '') + '</div>';
    const g = days() > 120 ? 'month' : 'week', P = periods(g), pk = periodKey(g);
    const ms = F.market ? [F.market] : marketsIn(rows);
    const bp = group(rows, pk);
    const vol = chartBox('bot-vol', { kind: 'bar', labels: P, series: [{ name: 'Chats', color: 'var(--c2)', values: P.map((p) => sum(bp.get(p) || [], 'chats')) }, { name: 'Handover %', color: 'var(--c4)', right: true, values: P.map((p) => { const r = bp.get(p) || []; return pctv(sum(r, 'handed_over'), sum(r, 'chats')); }) }], fmt: fmtN, rfmt: (v) => v + ' %', legend: true, label: 'Chats per ' + g + ' and handover rate' });
    const ho = chartBox('bot-ho', { kind: 'line', labels: P, series: ms.map((m) => { const b = group(rows.filter((r) => r.market === m), pk); return { name: MARKET_NAMES[m], color: MCOL[m], values: P.map((p) => { const r = b.get(p) || []; const c = sum(r, 'chats'); return c >= 10 ? 100 * sum(r, 'handed_over') / c : null; }) }; }), min: 0, fmt: (v) => v + ' %', label: 'Handover rate by market and ' + g });
    h += '<div class="cols">' + card('Volume', 'Chats per ' + g + ' (bars) and the share handed over (line, right axis).', vol) + card('Handover rate by market', 'Share of chats transferred to a person; a ' + g + ' needs 10 chats to show.', ho) + '</div>';
    const bb = group(rows, (r) => r.bot);
    const trows = [...bb.entries()].map(([bot, rs]) => { const a = botAgg(rs); const rt = a.rated_happy + a.rated_unsure + a.rated_unhappy; return { market: MARKET_NAMES[rs[0].market] || rs[0].market, bot: bot, chats: a.chats, handed_over: a.handed_over, ho_pct: pctv(a.handed_over, a.chats), via_email: a.handed_over_email, bot_end_pct: pctv(a.bot_only_end, a.chats), wanted: a.wanted_person, errors: a.bot_errors, happy_pct: pctv(a.rated_happy, rt), rated: rt, messages: a.user_messages }; });
    if (!sorts.bots) sorts.bots = { key: 'chats', dir: -1 };
    const p0 = (v) => (v == null ? '–' : v.toFixed(0) + ' %'), c1 = (k) => (r) => (r[k] == null ? '' : r[k].toFixed(1));
    h += card('By bot', 'One bot per web shop.', table('bots', 'Chatbot by bot', [
      { k: 'market', t: 'Market' }, { k: 'bot', t: 'Bot (shop)' }, { k: 'chats', t: 'Chats', num: 1, fmt: fmtN }, { k: 'handed_over', t: 'Handed over', num: 1, fmt: fmtN },
      { k: 'ho_pct', t: 'Handover %', num: 1, fmt: p0, csv: c1('ho_pct') }, { k: 'via_email', t: 'As e-mail', num: 1, fmt: fmtN }, { k: 'bot_end_pct', t: 'Ended in bot %', num: 1, fmt: p0, csv: c1('bot_end_pct') },
      { k: 'wanted', t: 'Asked for person', num: 1, fmt: fmtN }, { k: 'errors', t: 'Errors', num: 1, fmt: fmtN }, { k: 'rated', t: 'Rated', num: 1, fmt: fmtN },
      { k: 'happy_pct', t: 'Happy %', num: 1, fmt: p0, csv: c1('happy_pct') }, { k: 'messages', t: 'Messages', num: 1, fmt: fmtN }], trows), csvBtn('bots'));
    const tp = group(cb.data.topics, (r) => r.topic);
    const trow2 = [...tp.entries()].map(([t, rs]) => ({ topic: t, chats: sum(rs, 'chats'), handed_over: sum(rs, 'handed_over'), ho_pct: pctv(sum(rs, 'handed_over'), sum(rs, 'chats')) }));
    if (!sorts.topics) sorts.topics = { key: 'chats', dir: -1 };
    h += card('Topics', 'First-level bot dialogues, by whole weeks overlapping the range; one chat can touch several topics.', table('topics', 'Chat topics', [
      { k: 'topic', t: 'Topic' }, { k: 'chats', t: 'Chats', num: 1, fmt: fmtN }, { k: 'handed_over', t: 'Handed over', num: 1, fmt: fmtN }, { k: 'ho_pct', t: 'Handover %', num: 1, fmt: p0, csv: c1('ho_pct') }], trow2), csvBtn('topics'));
    return h;
  }

  const CAT_NAMES = { ORDER_INQUIRY: 'Order inquiry', PAYMENT_INQUIRY: 'Payment inquiry', INVOICE_REQUEST: 'Invoice request', PRODUCT_INQUIRY: 'Product inquiry', UNCLASSIFIED: 'Unclassified' };
  const catName = (c) => CAT_NAMES[c] || String(c).replace(/_/g, ' ').toLowerCase().replace(/^./, (x) => x.toUpperCase());
  const reasonName = (r) => (r === '(no status)' ? '(no status)' : String(r).replace(/_/g, ' ').replace(/^./, (x) => x.toUpperCase()));
  function pageReasons() {
    const cr = get('reasons');
    let h = head('Contact reasons', 'Why customers write in', esc(scope()) + '. AI-classified reasons of e-mail tickets (Alensis AI), by week.');
    h += filters();
    h += '<div class="note"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v5h1"/></svg><div>The AI classification starts on <b>30 June 2026</b> and covers the main shops of Italy, Croatia and Slovenia (tickets marked valid). The detail reason is the Daktela status set on the ticket (the first one when there are several).</div></div>';
    const w = wait([cr], 'contact reasons'); if (w) return h + w;
    const rows = cr.data.rows, total = sum(rows, 'tickets');
    const cats = [...group(rows, (r) => r.ai_category).entries()].map(([c, rs]) => ({ c, n: sum(rs, 'tickets') })).sort((a, b) => b.n - a.n);
    h += '<div class="kpis">' + kpi('Classified tickets', fmtN(total), cats.length + ' AI categories') + cats.slice(0, 4).map((c) => kpi(catName(c.c), pct(c.n, total), fmtN(c.n) + ' tickets')).join('') + '</div>';
    const W = [...new Set(rows.map((r) => r.week))].sort(), bw = group(rows, (r) => r.week);
    const stack = chartBox('rs-week', { kind: 'stack', labels: W, series: cats.slice(0, 5).map((c, i) => ({ name: catName(c.c), color: PAL[i], values: W.map((wk) => sum((bw.get(wk) || []).filter((r) => r.ai_category === c.c), 'tickets')) })), fmt: fmtN, label: 'AI-classified tickets per week by category' });
    const shareLines = chartBox('rs-share', { kind: 'line', labels: W, series: cats.slice(0, 5).map((c, i) => ({ name: catName(c.c), color: PAL[i], values: W.map((wk) => { const r = bw.get(wk) || []; return pctv(sum(r.filter((x) => x.ai_category === c.c), 'tickets'), sum(r, 'tickets')); }) })), min: 0, fmt: (v) => v + ' %', label: 'Share of each AI category per week' });
    h += '<div class="cols">' + card('Tickets per week', 'By AI category.', stack) + card('Share per week', 'Each category\'s share of the week.', shareLines) + '</div>';
    const rr = [...group(rows, (r) => r.ai_category + '|' + r.reason).entries()].map(([k, rs]) => ({ category: catName(rs[0].ai_category), reason: reasonName(rs[0].reason), tickets: sum(rs, 'tickets'), share: pctv(sum(rs, 'tickets'), total) }));
    if (!sorts.reasons) sorts.reasons = { key: 'tickets', dir: -1 };
    h += card('Reasons', 'AI category and the detail reason.', table('reasons', 'Contact reasons', [
      { k: 'category', t: 'AI category' }, { k: 'reason', t: 'Detail reason' }, { k: 'tickets', t: 'Tickets', num: 1, fmt: fmtN }, { k: 'share', t: 'Share', num: 1, fmt: (v) => (v == null ? '–' : v.toFixed(1) + ' %'), csv: (r) => (r.share == null ? '' : r.share.toFixed(1)) }], rr), csvBtn('reasons'));
    const wr = [...group(rows, (r) => r.week + '|' + r.market + '|' + r.ai_category).entries()].map(([k, rs]) => ({ week: rs[0].week, market: rs[0].market, category: catName(rs[0].ai_category), tickets: sum(rs, 'tickets') })).sort((a, b) => (a.week < b.week ? -1 : a.week > b.week ? 1 : 0));
    csvs.reasonweeks = { cols: [{ k: 'week', t: 'Week of' }, { k: 'market', t: 'Market' }, { k: 'category', t: 'AI category' }, { k: 'tickets', t: 'Tickets' }], rows: wr };
    h += '<p>' + csvBtn('reasonweeks', 'Weekly reasons by market (CSV)') + '</p>';
    return h;
  }

  function pageCalls() {
    const cc = get('calls');
    let h = head('Calls', 'Phone calls', esc(scope()) + '. Daktela calls by queue market. Every attempt is a call; a caller who rings three times counts three times (callers = distinct numbers per day).');
    h += filters();
    h += '<div class="note warn" role="note"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17h.01"/></svg><div><b>Data quality: read the answered rate with care.</b><ul>' +
      '<li><b>Outside-hours queues are never answered</b> (by design, about 13 % of inbound calls). They are left out of the answered rate here; counting them was part of the low "answered" figure seen before.</li>' +
      '<li><b>Inside working hours the answered rate really fell</b> from about 75 % (Sep 2025–Jan 2026) to 16–27 % (Mar–Aug 2026), market by market at different months (Croatia from March, Slovenia from April, Italy from May). Every unanswered call is a caller hang-up after a median wait of about 2 minutes. The answered flag agrees with talk time and agent, and the Daktela CSV export (cs.ext_calls) matched these numbers exactly up to its last file in early July — so it is in Daktela itself, not a loading error.</li>' +
      '<li><b>From September volume dropped</b> to about 500 inbound calls a month (from 2,000–2,500), with every working day present and the answered rate back near 50–60 %. This looks like a routing change (fewer calls reach the Daktela queues), not missing data. Worth confirming with the phone set-up.</li>' +
      '<li>Repeat dialling inflates the call count: distinct callers per day are about 60 % of inbound calls. <i>cs.cs_missed_calls</i> is empty for the last months because its CSV export stopped in early July.</li></ul></div></div>';
    const w = wait([cc], 'calls'); if (w) return h + w;
    const rows = cc.data.rows, I = inboundIn(rows), O = rows.filter((r) => r.direction === 'Inbound' && r.hours === 'Outside hours'), OUT = rows.filter((r) => r.direction === 'Outbound');
    const ci = sum(I, 'calls'), ca = sum(I, 'answered'), cu = sum(I, 'unanswered');
    h += '<div class="kpis">' + kpi('Inbound, working hours', fmtN(ci), fmtN(sum(I, 'callers')) + ' caller-days') +
      kpi('Answered', pct(ca, ci), fmtN(ca) + ' calls · callers reached ' + pct(sum(I, 'callers_answered'), sum(I, 'callers')), ci && ca / ci < 0.6 ? 'bad' : '') +
      kpi('Abandoned', pct(sum(I, 'abandoned'), ci), fmtN(sum(I, 'abandoned')) + ' hung up while waiting') +
      kpi('Wait, answered', secs(ca ? sum(I, 'wait_answered_sum_s') / ca : null), 'average before an agent picks up') +
      kpi('Wait, unanswered', secs(cu ? sum(I, 'wait_unanswered_sum_s') / cu : null), 'average before hanging up') +
      kpi('Outside hours', fmtN(sum(O, 'calls')), fmtN(sum(OUT, 'calls')) + ' outbound calls') + '</div>';
    const g = days() > 120 ? 'month' : 'week', P = periods(g), pk = periodKey(g), bp = group(I, pk);
    const ch = chartBox('calls', { kind: 'stack', labels: P, series: [{ name: 'Answered', color: 'var(--c1)', values: P.map((p) => sum(bp.get(p) || [], 'answered')) }, { name: 'Not answered', color: 'var(--bad-dot)', values: P.map((p) => sum(bp.get(p) || [], 'unanswered')) }], fmt: fmtN, label: 'Inbound calls in working hours per ' + g + ', answered and not answered' });
    const ms = F.market ? [F.market] : marketsIn(I);
    const rate = chartBox('calls-rate', { kind: 'line', labels: P, series: ms.map((m) => { const b = group(I.filter((r) => r.market === m), pk); return { name: MARKET_NAMES[m], color: MCOL[m], values: P.map((p) => { const r = b.get(p) || []; const c = sum(r, 'calls'); return c >= 10 ? 100 * sum(r, 'answered') / c : null; }) }; }), min: 0, max: 100, fmt: (v) => v + ' %', label: 'Answered rate of inbound working-hours calls by market and ' + g });
    h += '<div class="cols">' + card('Inbound calls, working hours', 'Per ' + g + '.', ch) + card('Answered rate by market', 'Working-hours inbound calls; a ' + g + ' needs 10 calls to show.', rate) + '</div>';
    const mm = group(rows.filter((r) => r.direction !== 'Internal'), (r) => month(r.date) + '|' + r.market);
    const trows = [...mm.entries()].map(([k, rs]) => { const i = inboundIn(rs), a = sum(i, 'answered'), c = sum(i, 'calls'), u = sum(i, 'unanswered'); return { month: k.split('|')[0], market: MARKET_NAMES[rs[0].market] || rs[0].market, inbound: c, answered: a, ans_pct: pctv(a, c), callers: sum(i, 'callers'), callers_pct: pctv(sum(i, 'callers_answered'), sum(i, 'callers')), wait_a: a ? sum(i, 'wait_answered_sum_s') / a : null, wait_u: u ? sum(i, 'wait_unanswered_sum_s') / u : null, outside: sum(rs.filter((r) => r.direction === 'Inbound' && r.hours === 'Outside hours'), 'calls'), outbound: sum(rs.filter((r) => r.direction === 'Outbound'), 'calls') }; });
    if (!sorts.calls) sorts.calls = { key: 'month', dir: -1 };
    const p0 = (v) => (v == null ? '–' : v.toFixed(0) + ' %'), r1 = (k) => (r) => (r[k] == null ? '' : r[k].toFixed(1));
    h += card('By month and market', 'Inbound columns are working-hours calls only.', table('calls', 'Calls by month and market', [
      { k: 'month', t: 'Month', fmt: lab, csv: (r) => r.month }, { k: 'market', t: 'Market' }, { k: 'inbound', t: 'Inbound', num: 1, fmt: fmtN }, { k: 'answered', t: 'Answered', num: 1, fmt: fmtN },
      { k: 'ans_pct', t: 'Answered %', num: 1, fmt: p0, csv: r1('ans_pct') }, { k: 'callers', t: 'Caller-days', num: 1, fmt: fmtN }, { k: 'callers_pct', t: 'Callers reached %', num: 1, fmt: p0, csv: r1('callers_pct') },
      { k: 'wait_a', t: 'Wait answered', num: 1, fmt: secs, csv: r1('wait_a') }, { k: 'wait_u', t: 'Wait unanswered', num: 1, fmt: secs, csv: r1('wait_u') },
      { k: 'outside', t: 'Outside hours', num: 1, fmt: fmtN }, { k: 'outbound', t: 'Outbound', num: 1, fmt: fmtN }], trows), csvBtn('calls'));
    return h;
  }

  // ── render + routing ────────────────────────────────────────────────────
  const PAGES = { overview: pageOverview, nps: pageNps, tickets: pageTickets, chatbot: pageChatbot, reasons: pageReasons, calls: pageCalls };
  let lastRoute = null;
  function render() {
    if (!SESSION.checked) return;
    if (!SESSION.allowed) { gate(); lastRoute = null; return; }
    $('app').classList.remove('gated');
    if (!META) {
      const c = get('meta');
      renderNav();
      if (c.status === 'error') { $('page').innerHTML = errorCard(c); return; }
      if (c.status !== 'ok') { $('page').innerHTML = '<p class="loading" role="status"><i aria-hidden="true"></i>Loading customer service data…</p>'; return; }
      META = c.data;
      if (!F.to) setRange(90);
    }
    renderNav();
    const active = document.activeElement, aid = active && active.id, focusAct = active && active.dataset ? active.dataset.act + '|' + (active.dataset.v || active.dataset.k || '') : null;
    Object.keys(charts).forEach((k) => delete charts[k]);
    $('page').innerHTML = PAGES[route]();
    drawCharts();
    if (lastRoute !== route) { lastRoute = route; const h1 = $('h1'); if (h1 && document.activeElement !== $('main')) h1.focus({ preventScroll: true }); window.scrollTo(0, 0); }
    else if (aid && $(aid)) $(aid).focus();
    else if (focusAct) { const el = document.querySelector('[data-act="' + focusAct.split('|')[0] + '"][data-' + (focusAct.split('|')[0] === 'sort' ? 'k' : 'v') + '="' + focusAct.split('|')[1] + '"]'); if (el) el.focus(); }
  }
  function onRoute() {
    const m = /^#\/([a-z]+)/.exec(location.hash || '');
    route = m && PAGES[m[1]] ? m[1] : 'overview';
    $('side').classList.remove('open'); $('menuBtn').setAttribute('aria-expanded', 'false');
    document.title = (ROUTES.find((r) => r.id === route) || {}).title + ' · Customer service quality — Adrial Apps';
    lastRoute = null;
    render();
  }

  // ── events ──────────────────────────────────────────────────────────────
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const a = b.dataset.act;
    if (a === 'signin') { if (window.AdrialSync && window.AdrialSync.signIn) window.AdrialSync.signIn(); else toast('Sign-in is not available on this server.'); }
    else if (a === 'recheck') { SESSION.checked = false; checkSession(); }
    else if (a === 'retry') { Object.keys(CACHE).forEach((k) => { if (CACHE[k].status === 'error') delete CACHE[k]; }); render(); }
    else if (a === 'range') { setRange(+b.dataset.v); render(); }
    else if (a === 'csv') downloadCsv(b.dataset.v);
    else if (a === 'sort') { const t = b.dataset.t, k = b.dataset.k, s = sorts[t]; sorts[t] = { key: k, dir: s && s.key === k ? -s.dir : (k === 'market' || k === 'queue' || k === 'bot' || k === 'topic' || k === 'category' || k === 'reason' || k === 'channel' ? 1 : -1) }; render(); }
  });
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'fMarket') { F.market = t.value; render(); }
    else if (t.id === 'fFrom' || t.id === 'fTo') {
      const v = t.value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
      const nf = t.id === 'fFrom' ? v : F.from, nt = t.id === 'fTo' ? v : F.to;
      if (nf > nt) { toast('"From" must be on or before "To".'); t.value = t.id === 'fFrom' ? F.from : F.to; return; }
      if ((pd(nt) - pd(nf)) / DAY > 400) { toast('Choose at most 400 days.'); t.value = t.id === 'fFrom' ? F.from : F.to; return; }
      F.from = nf; F.to = nt; F.range = ''; render();
    }
  });
  $('menuBtn').addEventListener('click', () => { const s = $('side'), o = !s.classList.contains('open'); s.classList.toggle('open', o); $('menuBtn').setAttribute('aria-expanded', String(o)); });
  let rz = null;
  window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(drawCharts, 120); });
  window.addEventListener('adrial-theme', () => drawCharts());
  window.addEventListener('hashchange', onRoute);

  watchAuth();
  const m0 = /^#\/([a-z]+)/.exec(location.hash || ''); route = m0 && PAGES[m0[1]] ? m0[1] : 'overview';
  checkSession();
})();
