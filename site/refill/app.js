/* Contact-lens refill & win-back — Adrial Apps, LIVE data only.
 *
 * Reads /api/refill/* (see /refill.js), the daily aggregate summary in BigQuery dataset refill_app
 * (sql/refill_app_refresh.sql). Aggregates only: counts, sums and rates per market / webshop / action /
 * runout bucket / day. No customer ids, e-mails or names ever reach this page.
 * Access: /api/refill/session says whether the signed-in account is on REFILL_ALLOWED_EMAILS. Anyone else
 * sees a page that explains the app. Live numbers are kept in memory only (no localStorage, IndexedDB or
 * sync snapshot); a 401/403 at any point drops them and returns to that page.
 */
(function () {
  'use strict';

  const API = '/api/refill/';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // ── formatting ───────────────────────────────────────────────────────────
  const NF = new Intl.NumberFormat('en-GB');
  const num = (n) => (n == null || !isFinite(n) ? '–' : NF.format(Math.round(n)));
  const dec = (n, d) => (n == null || !isFinite(n) ? '–' : Number(n).toFixed(d));
  const pct = (x, d) => (x == null || !isFinite(x) ? '–' : (x * 100).toFixed(d == null ? 1 : d) + '%');
  const share = (x) => (x > 0 && x < 0.005 ? '<1%' : pct(x, 0));
  const ppt = (x) => (x == null || !isFinite(x) ? '–' : (x >= 0.0005 ? '+' : x <= -0.0005 ? '−' : '±') + Math.abs(x * 100).toFixed(1) + ' pp');
  function eur(n) {
    if (n == null || !isFinite(n)) return '–';
    const a = Math.abs(n);
    if (a >= 1e6) return '€' + (n / 1e6).toFixed(a >= 1e7 ? 1 : 2) + 'M';
    if (a >= 1e4) return '€' + Math.round(n / 1e3) + 'k';
    return '€' + NF.format(Math.round(n));
  }
  const DAYMS = 864e5;
  const D0 = (s) => new Date(s + 'T00:00:00Z');
  const isoAdd = (s, n) => new Date(D0(s).getTime() + n * DAYMS).toISOString().slice(0, 10);
  const diffDays = (a, b) => Math.round((D0(b) - D0(a)) / DAYMS);
  const fmtD = (s, o) => (s ? D0(s).toLocaleDateString('en-GB', Object.assign({ timeZone: 'UTC' }, o)) : '–');
  const fDay = (s) => fmtD(s, { weekday: 'short', day: 'numeric', month: 'short' });
  const fDate = (s) => fmtD(s, { day: 'numeric', month: 'short', year: 'numeric' });
  const fShort = (s) => fmtD(s, { day: 'numeric', month: 'short' });
  const todayIso = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
  const isWeekend = (s) => { const g = D0(s).getUTCDay(); return g === 0 || g === 6; };
  const ago = (s) => { const n = diffDays(s, todayIso()); return n <= 0 ? 'today' : n === 1 ? 'yesterday' : n + ' days ago'; };
  const sum = (a, f) => a.reduce((t, r) => t + (Number(f(r)) || 0), 0);

  // ── vocabulary ───────────────────────────────────────────────────────────
  const MK = { SI: ['Slovenia', 1], CRO: ['Croatia', 2], IT: ['Italy', 3] };
  const mName = (m) => (MK[m] ? MK[m][0] : m);
  const mCls = (m) => (MK[m] ? MK[m][1] : 4);
  // fixed order and colour per suggested action (colour follows the action, never its rank)
  const ACTIONS = [
    ['Refill reminder', 1, 'Due now: within about ±30% of their usual reorder gap'],
    ['Reminder + small incentive', 4, 'Overdue: up to 2.5× their usual gap, within a year'],
    ['Win-back offer', 3, 'Lapsing or lapsed (up to 2 years), top 20% predicted value'],
    ['Low-cost win-back (email only)', 2, 'Lapsing or lapsed, the other value tiers'],
    ['No contact', 0, 'Not due yet'],
  ];
  const aCls = (a) => { const x = ACTIONS.find((r) => r[0] === a); return x ? x[1] : 0; };
  const aOrd = (a) => { const i = ACTIONS.findIndex((r) => r[0] === a); return i < 0 ? 99 : i; };
  const BUCKETS = [['0 overdue', 'Overdue'], ['1 0-7', '0–7 days'], ['2 8-14', '8–14 days'], ['3 15-30', '15–30 days'], ['4 31-60', '31–60 days'], ['5 60+', 'Over 60 days'], ['9 unknown', 'Unknown']];
  const bName = (b) => { const x = BUCKETS.find((r) => r[0] === b); return x ? x[1] : b; };
  const DUE14 = new Set(['1 0-7', '2 8-14']);
  const MODELS = { reorder_30d: '30-day reorder', reorder_90d: '90-day reorder', value_365d: '12-month value' };
  const ACTION_OPTS = [['contact', 'All contact actions'], ['', 'All actions (incl. no contact)']].concat(ACTIONS.map((a) => [a[0], a[0]]));
  const LIST_TABLE = 'customer_intel.cl_customer_scores';

  // ── state (memory only) ──────────────────────────────────────────────────
  let SES = null;               // { signedIn, allowed, email, failed }
  let META = null;
  let CACHE = new Map();
  const F = { market: '', action: 'contact', days: 60, by: 'market', mail: '', segAction: '', bucket: '', sort: { key: 'customers', dir: -1 }, horizon: 7, model: 'reorder_30d' };
  function resetData() { CACHE = new Map(); META = null; }

  function api(path) {
    if (CACHE.has(path)) return CACHE.get(path);
    const p = fetch(API + path, { credentials: 'same-origin', headers: { Accept: 'application/json' }, cache: 'no-store' })
      .then((r) => r.json().catch(() => ({})).then((j) => {
        if (r.status === 401 || r.status === 403) { denied(r.status); throw Object.assign(new Error(j.error || 'No access'), { status: r.status }); }
        if (!r.ok) throw Object.assign(new Error(j.error || 'The data could not be loaded (' + r.status + ').'), { status: r.status });
        return j;
      }), () => { throw Object.assign(new Error('Check your connection and try again.'), { status: 0 }); });
    CACHE.set(path, p);
    p.catch(() => { if (CACHE.get(path) === p) CACHE.delete(path); });
    return p;
  }
  const qs = (o) => Object.entries(o).filter(([, v]) => v !== '' && v != null).map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');

  // a 401/403 anywhere: forget every live number at once, show the access page, then re-check the session
  function denied(code) {
    resetData();
    tok++;
    SES = { signedIn: code === 403, allowed: false, email: code === 403 && SES ? SES.email : null };
    renderGate();
    toast(code === 401 ? 'Your sign-in has ended: live data is hidden.' : 'This account has no access to the refill data.');
    checkSession();
  }

  let sesSeq = 0;
  function checkSession() {
    const my = ++sesSeq;
    return fetch(API + 'session', { credentials: 'same-origin', headers: { Accept: 'application/json' }, cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error('session ' + r.status); return r.json(); })
      .then((j) => ({ signedIn: !!j.signedIn, allowed: !!j.allowed, email: j.email || null }), () => ({ failed: true, signedIn: false, allowed: false, email: null }))
      .then((s) => {
        if (my !== sesSeq) return;
        if (!SES || SES.email !== s.email || !s.allowed) resetData();
        SES = s;
        render(false);
      });
  }

  // ── shell: nav, menu, toast, tooltip ─────────────────────────────────────
  const ICON = {
    grid: '<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/>',
    cal: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
    table: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M4 10h16M4 15h16M10 5v14"/>',
    ab: '<path d="M5 19V9M10 19V5M15 19v-7M20 19v-4"/>',
    pulse: '<path d="M3 12h4l2-6 4 12 2-6h6"/>',
    dl: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    warn: '<path d="M12 4 2.5 20h19z"/><path d="M12 10v4M12 17.5v.01"/>',
    ok: '<path d="m5 12.5 4.5 4.5L19 7"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/>',
  };
  const ic = (n) => '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICON[n] + '</svg>';
  const NAV = [['Overview', '', 'grid'], ['Runout calendar', 'calendar', 'cal'], ['Segments', 'segments', 'table'], ['Did reminders work?', 'ab', 'ab'], ['Model health', 'model', 'pulse']];

  function renderNav() {
    $('nav').innerHTML = NAV.map((n) => '<a href="#/' + n[1] + '"' + (route === n[1] ? ' aria-current="page"' : '') + '>' + ic(n[2]) + '<span>' + esc(n[0]) + '</span></a>').join('');
    $('sideFoot').innerHTML = '<span class="live-pill"><i aria-hidden="true"></i>Live data · aggregates only</span>' +
      '<div class="live-note">Signed in as <b>' + esc(SES.email) + '</b>. Counts and sums per market only; no customer details. Nothing is stored in this browser.</div>';
  }
  function setMenu(open) { $('side').classList.toggle('open', open); $('menuBtn').setAttribute('aria-expanded', open ? 'true' : 'false'); }
  $('menuBtn').addEventListener('click', () => setMenu(!$('side').classList.contains('open')));
  $('nav').addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { hideTip(); if ($('side').classList.contains('open')) { setMenu(false); $('menuBtn').focus(); } } });
  document.querySelector('.skip').addEventListener('click', (e) => { e.preventDefault(); const h = document.querySelector('#page h1'); (h || $('main')).focus(); });

  let toastT = 0;
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 3200); }

  const tip = $('tip');
  function hideTip() { tip.hidden = true; }
  function onPointer(e) {
    const t = e.target && e.target.closest ? e.target.closest('[data-tip]') : null;
    if (!t) return hideTip();
    tip.innerHTML = t.getAttribute('data-tip');
    tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let x = e.clientX + 14, y = e.clientY + 14;
    if (x + w > window.innerWidth - 8) x = Math.max(8, e.clientX - w - 14);
    if (y + h > window.innerHeight - 8) y = Math.max(8, e.clientY - h - 14);
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  }
  document.addEventListener('pointermove', onPointer);
  document.addEventListener('pointerdown', onPointer);
  window.addEventListener('scroll', hideTip, { passive: true });

  // ── router + render ──────────────────────────────────────────────────────
  const PAGES = { '': pOverview, calendar: pCalendar, segments: pSegments, ab: pAb, model: pModel };
  let route = null;
  let tok = 0;
  let CHARTS = [];
  function onRoute() {
    const b = location.hash.replace(/^#\/?/, '').split('/')[0] || '';
    if (!Object.prototype.hasOwnProperty.call(PAGES, b)) { location.replace('#/'); return; }
    const changed = route !== null && route !== b;
    route = b;
    setMenu(false);
    render(changed);
  }
  window.addEventListener('hashchange', onRoute);

  function focusKey() { const a = document.activeElement; return a && a !== document.body ? (a.getAttribute('data-fid') || null) : null; }
  async function render(focusHeading) {
    if (!SES) return;
    if (!SES.allowed) return renderGate();
    renderNav();
    const my = ++tok, keep = focusKey();
    const slow = setTimeout(() => { if (my === tok) $('page').innerHTML = '<p class="loading" role="status"><i aria-hidden="true"></i>Loading live data…</p>'; }, 150);
    try {
      if (!META) META = await api('meta');
      const charts = [];
      const html = await PAGES[route](charts);
      clearTimeout(slow);
      if (my !== tok) return;
      $('page').innerHTML = html;
      CHARTS = charts; drawCharts();
      if (focusHeading) { window.scrollTo(0, 0); const h = $('page').querySelector('h1'); if (h) h.focus({ preventScroll: true }); }
      else if (keep) { const n = $('page').querySelector('[data-fid="' + CSS.escape(keep) + '"]'); if (n) n.focus({ preventScroll: true }); }
    } catch (e) {
      clearTimeout(slow);
      if (my !== tok || e.status === 401 || e.status === 403) return;
      $('page').innerHTML = '<div class="card lerr" role="alert"><div class="card-h"><div><h2>' + (e.status === 0 ? 'Could not reach the server' : 'This part of the live data could not be loaded') + '</h2>' +
        '<p>' + esc(e.message) + '</p></div></div><div class="card-b"><button type="button" class="btn pri" data-act="retry" data-fid="retry">Try again</button></div></div>';
    }
  }

  function renderGate() {
    $('nav').innerHTML = ''; $('sideFoot').innerHTML = '';
    const s = SES || {};
    let acc;
    if (s.failed) acc = '<p><b>Could not check your access.</b> The server did not answer; try again in a moment.</p><button type="button" class="btn pri" data-act="recheck" data-fid="recheck">Try again</button>';
    else if (!s.signedIn) acc = '<p><b>Live data for approved accounts — sign in.</b> Access is given per e-mail address of your Adrial Apps account.</p><button type="button" class="btn pri" data-act="signin" data-fid="signin">Sign in</button>';
    else acc = '<p>You are signed in as <b>' + esc(s.email) + '</b>, but <b>your account is not on the list</b> for this app. Ask Simon to add it.</p><button type="button" class="btn" data-act="signin" data-fid="signin">Use another account</button>';
    $('page').innerHTML = '<div class="gate">' + head('Live data · marketing & CRM', 'Contact-lens refill &amp; win-back',
      'Which contact-lens customers run out soon, who can be e-mailed, what the prediction model suggests, and whether reminders bring people back.') +
      '<section class="card"><div class="card-h"><div><h2>What this app shows</h2></div></div><div class="card-b"><ul>' +
      '<li><b>Overview per market</b>: customers due in the next 14 days, the share that may be e-mailed, the predicted value at stake and the mix of suggested actions.</li>' +
      '<li><b>Runout calendar</b>: how many customers run out of lenses on each of the next 60 days.</li>' +
      '<li><b>Segments</b>: market × suggested action (remind, win back, leave alone) × runout window, as a table and CSV.</li>' +
      '<li><b>Did reminders work?</b>: reorder rates of the contacted group against the 10% hold-out, with honest wording when samples are small.</li>' +
      '<li><b>Model health</b>: accuracy (AUC) and calibration of the predictions, and how fresh the models and scores are.</li>' +
      '</ul><p class="sub" style="margin-top:12px">Counts, sums and rates only: the app never shows individual customers, e-mail addresses or ids. Customer lists for e-mailing stay in BigQuery.</p></div>' +
      '<div class="acc">' + acc + '</div></section></div>';
  }

  // ── events ───────────────────────────────────────────────────────────────
  const ACT = {
    signin: () => { if (window.AdrialSync && window.AdrialSync.signIn) window.AdrialSync.signIn(); else toast('Sign-in is not available on this server.'); },
    recheck: () => checkSession(),
    retry: () => { CACHE = new Map(); render(false); },
    set: (b) => { const k = b.getAttribute('data-k'); let v = b.getAttribute('data-v'); if (k === 'days' || k === 'horizon') v = +v; F[k] = v; render(false); },
    sort: (b) => { const k = b.getAttribute('data-k'); F.sort = { key: k, dir: F.sort.key === k ? -F.sort.dir : (k === 'market' || k === 'project' || k === 'action' || k === 'bucket' ? 1 : -1) }; render(false); },
    csv: (b) => { const f = CSVS[b.getAttribute('data-v')]; if (f) f(); },
  };
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (b && ACT[b.getAttribute('data-act')]) ACT[b.getAttribute('data-act')](b); });
  document.addEventListener('change', (e) => { const s = e.target.closest('[data-ch]'); if (s) { F[s.getAttribute('data-ch')] = s.value; render(false); } });
  let rsT = 0;
  window.addEventListener('resize', () => { clearTimeout(rsT); rsT = setTimeout(drawCharts, 120); });
  if (window.AdrialSync && window.AdrialSync.on) {
    window.AdrialSync.on((auth) => {
      const e = auth && auth.user && auth.user.email ? String(auth.user.email).toLowerCase() : null;
      if (SES && !SES.failed && (SES.email || null) !== e) checkSession();
    });
  }

  // ── building blocks ──────────────────────────────────────────────────────
  function head(eyebrow, title, sub, actions) {
    return '<header class="head"><div><span class="eyebrow">' + esc(eyebrow) + '</span><h1 tabindex="-1">' + title + '</h1>' + (sub ? '<p class="sub">' + sub + '</p>' : '') + '</div>' +
      (actions ? '<div class="ctrls" style="margin:0">' + actions + '</div>' : '') + '</header>';
  }
  function seg(label, key, opts) {
    return '<div class="grp"><span class="label" id="lb-' + key + '">' + esc(label) + '</span><div class="seg" role="group" aria-labelledby="lb-' + key + '">' +
      opts.map((o) => '<button type="button" data-act="set" data-k="' + key + '" data-v="' + esc(o[0]) + '" data-fid="' + key + '-' + esc(o[0]) + '" aria-pressed="' + (String(F[key]) === String(o[0])) + '">' + esc(o[1]) + '</button>').join('') + '</div></div>';
  }
  function sel(label, key, opts) {
    return '<div class="grp"><label class="label" for="sel-' + key + '">' + esc(label) + '</label><select class="select" id="sel-' + key + '" data-ch="' + key + '" data-fid="sel-' + key + '">' +
      opts.map((o) => '<option value="' + esc(o[0]) + '"' + (String(F[key]) === String(o[0]) ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') + '</select></div>';
  }
  function marketList() {
    const seen = Array.from(new Set((META.shops || []).map((s) => s.market)));
    return seen.sort((a, b) => (MK[a] ? Object.keys(MK).indexOf(a) : 9) - (MK[b] ? Object.keys(MK).indexOf(b) : 9) || a.localeCompare(b));
  }
  const marketSeg = () => seg('Market', 'market', [['', 'All']].concat(marketList().map((m) => [m, m])));
  function card(title, sub, body, extra) {
    return '<section class="card"' + (extra || '') + '><div class="card-h"><div><h2>' + title + '</h2>' + (sub ? '<p>' + sub + '</p>' : '') + '</div></div><div class="card-b">' + body + '</div></section>';
  }
  const csvBtn = (key, label) => '<button type="button" class="btn sm no-print" data-act="csv" data-v="' + key + '" data-fid="csv-' + key + '">' + ic('dl') + (label || 'CSV') + '</button>';
  const legend = (items) => '<div class="legend">' + items.map((x) => '<span><i class="sw-' + x[1] + '" aria-hidden="true"></i>' + esc(x[0]) + '</span>').join('') + '</div>';
  const fresh = (src) => (META.freshness || []).find((f) => f.source === src) || {};
  const scoredOn = () => fresh('scores').day;
  function notice(kind, html) { return '<div class="notice ' + kind + '" role="' + (kind === 'bad' ? 'alert' : 'note') + '">' + ic(kind === 'ok' ? 'ok' : kind ? 'warn' : 'info') + '<div>' + html + '</div></div>'; }

  // ── CSV (download only, nothing is kept) ─────────────────────────────────
  const CSVS = {};
  function csvCell(v) {
    if (v == null) v = '';
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) && !/^-\d+(\.\d+)?$/.test(v)) v = "'" + v;
    v = String(v);
    return /[",;\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  function downloadCsv(name, header, rows) {
    const s = '﻿' + [header].concat(rows).map((r) => r.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([s], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'refill-' + name + '-' + (scoredOn() || 'live') + '.csv';
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
    toast('Exported ' + num(rows.length) + ' rows to ' + a.download);
  }
  const r4 = (x) => (x == null || !isFinite(x) ? '' : Math.round(x * 10000) / 10000);
  const r2 = (x) => (x == null || !isFinite(x) ? '' : Math.round(x * 100) / 100);

  // ── charts (SVG drawn at the container's real width) ─────────────────────
  function drawCharts() { CHARTS.forEach((c) => { const el = $(c.id); if (el) el.innerHTML = c.draw(Math.max(260, el.clientWidth)); }); }
  // top of the y axis: 4 equal, round steps
  function niceMax(v) { if (!(v > 0)) return 1; const r = v / 4, p = Math.pow(10, Math.floor(Math.log10(r))), f = r / p; return 4 * (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; }
  function yGrid(W, P, H, max, fy, min, n) {
    min = min || 0; n = n || 4;
    let s = '';
    for (let i = 0; i <= n; i++) {
      const v = min + (max - min) * i / n, y = P.t + H - H * i / n;
      s += '<line class="' + (i ? 'grid-l' : 'base') + '" x1="' + P.l + '" x2="' + (W - P.r) + '" y1="' + y + '" y2="' + y + '"/><text class="ax" x="' + (P.l - 6) + '" y="' + (y + 3.5) + '" text-anchor="end">' + esc(fy(v)) + '</text>';
    }
    return s;
  }
  function xLabels(cats, P, bw, lab, minGap) {
    const every = Math.max(1, Math.ceil((minGap || 56) / bw));
    return cats.map((c, i) => (i % every ? '' : '<text class="ax" x="' + (P.l + bw * i + bw / 2) + '" y="' + (P.t + P.H + 16) + '" text-anchor="middle">' + esc(lab(c, i)) + '</text>')).join('');
  }
  function tipHtml(title, rows) { return esc('<b>' + esc(title) + '</b>' + rows.map((r) => '<div><span>' + esc(r[0]) + '</span><span>' + esc(r[1]) + '</span></div>').join('')); }
  // stacked columns: series [{cls, vals}], tips[i] = [title, rows]
  function stackedBars(o) {
    return (W) => {
      const P = { l: 46, r: 8, t: 10, b: 26 }, H = o.h || 240; P.H = H;
      const n = o.cats.length, bw = (W - P.l - P.r) / n, gap = bw > 10 ? 2 : 1;
      const tot = o.cats.map((_, i) => sum(o.series, (s) => s.vals[i]));
      const max = niceMax(Math.max.apply(null, tot.concat([1])));
      let s = '<svg viewBox="0 0 ' + W + ' ' + (H + P.t + P.b) + '" width="' + W + '" height="' + (H + P.t + P.b) + '" role="img" aria-label="' + esc(o.label) + '">';
      if (o.shade) o.cats.forEach((c, i) => { if (o.shade(c)) s += '<rect class="wk" x="' + (P.l + bw * i) + '" y="' + P.t + '" width="' + bw + '" height="' + H + '"/>'; });
      s += yGrid(W, P, H, max, o.fy || num);
      o.cats.forEach((c, i) => {
        let y = P.t + H;
        const segs = o.series.filter((x) => x.vals[i] > 0);
        segs.forEach((x, k) => {
          const h = H * x.vals[i] / max, top = k === segs.length - 1;
          const hh = Math.max(top ? 1 : 0, h - (top ? 0 : gap));
          y -= h;
          s += '<rect class="s' + x.cls + '" x="' + (P.l + bw * i + gap / 2) + '" y="' + (top ? y : y + gap) + '" width="' + Math.max(1, bw - gap) + '" height="' + hh + '"' + (top ? ' rx="' + Math.min(3, bw / 4) + '"' : '') + '/>';
        });
        s += '<rect class="hit" x="' + (P.l + bw * i) + '" y="' + P.t + '" width="' + bw + '" height="' + H + '" data-tip="' + tipHtml(o.tips[i][0], o.tips[i][1]) + '"/>';
      });
      return s + xLabels(o.cats, P, bw, o.xl, o.minGap) + '</svg>';
    };
  }
  // grouped columns: series [{cls, vals}] side by side per category
  function groupedBars(o) {
    return (W) => {
      const P = { l: 52, r: 8, t: 10, b: 26 }, H = o.h || 220; P.H = H;
      const n = o.cats.length, bw = (W - P.l - P.r) / n, k = o.series.length, inner = Math.max(2, (bw - 8) / k);
      const max = niceMax(Math.max.apply(null, o.series.flatMap((x) => x.vals.filter((v) => v != null)).concat([o.minMax || 0.0001])));
      let s = '<svg viewBox="0 0 ' + W + ' ' + (H + P.t + P.b) + '" width="' + W + '" height="' + (H + P.t + P.b) + '" role="img" aria-label="' + esc(o.label) + '">' + yGrid(W, P, H, max, o.fy);
      o.cats.forEach((c, i) => {
        o.series.forEach((x, j) => {
          const v = x.vals[i]; if (v == null) return;
          const h = Math.max(1, H * v / max);
          s += '<rect class="s' + x.cls + '" x="' + (P.l + bw * i + 4 + inner * j + 1) + '" y="' + (P.t + H - h) + '" width="' + Math.max(1, inner - 2) + '" height="' + h + '" rx="' + Math.min(3, inner / 4) + '"/>';
        });
        s += '<rect class="hit" x="' + (P.l + bw * i) + '" y="' + P.t + '" width="' + bw + '" height="' + H + '" data-tip="' + tipHtml(o.tips[i][0], o.tips[i][1]) + '"/>';
      });
      return s + xLabels(o.cats, P, bw, o.xl, 34) + '</svg>';
    };
  }
  // lines: series [{cls, vals, dash, name}], optional ref (dashed horizontal line with label)
  function lineChart(o) {
    return (W) => {
      const P = { l: 52, r: 12, t: 12, b: 26 }, H = o.h || 220; P.H = H;
      const n = o.cats.length, bw = (W - P.l - P.r) / Math.max(1, n);
      const all = o.series.flatMap((x) => x.vals.filter((v) => v != null)).concat(o.ref ? [o.ref.v] : []);
      const lo = o.min != null ? o.min : 0, max = o.max != null ? o.max : niceMax(Math.max.apply(null, all.concat([0.0001])));
      const yv = (v) => P.t + H - H * (v - lo) / (max - lo), xv = (i) => P.l + bw * i + bw / 2;
      let s = '<svg viewBox="0 0 ' + W + ' ' + (H + P.t + P.b) + '" width="' + W + '" height="' + (H + P.t + P.b) + '" role="img" aria-label="' + esc(o.label) + '">' + yGrid(W, P, H, max, o.fy, lo, o.ticks);
      if (o.ref) s += '<line class="ref" x1="' + P.l + '" x2="' + (W - P.r) + '" y1="' + yv(o.ref.v) + '" y2="' + yv(o.ref.v) + '"/><text class="lbl" x="' + (W - P.r) + '" y="' + (yv(o.ref.v) - 6) + '" text-anchor="end">' + esc(o.ref.label) + '</text>';
      o.series.forEach((x) => {
        let d = '', pen = false;
        x.vals.forEach((v, i) => { if (v == null) { pen = false; return; } d += (pen ? 'L' : 'M') + xv(i).toFixed(1) + ' ' + yv(v).toFixed(1); pen = true; });
        if (d) s += '<path class="line s' + x.cls + '" d="' + d + '"' + (x.dash ? ' stroke-dasharray="5 4"' : '') + '/>';
        x.vals.forEach((v, i) => { if (v != null) s += '<circle class="pt s' + x.cls + '" cx="' + xv(i) + '" cy="' + yv(v) + '" r="4"/>'; });
      });
      o.cats.forEach((c, i) => { s += '<rect class="hit" x="' + (P.l + bw * i) + '" y="' + P.t + '" width="' + bw + '" height="' + H + '" data-tip="' + tipHtml(o.tips[i][0], o.tips[i][1]) + '"/>'; });
      return s + xLabels(o.cats, P, bw, o.xl, 56) + '</svg>';
    };
  }

  // ── freshness strip ──────────────────────────────────────────────────────
  function freshItems(which) {
    const sc = fresh('scores'), od = fresh('orders'), mt = fresh('models_trained'), mb = fresh('models_backtested'), tl = fresh('training_labels'), sh = fresh('score_history'), em = fresh('emails_sent');
    const items = {};
    if (sc.day) {
      const age = diffDays(sc.day, todayIso());
      items.scores = [age <= 2 ? 'ok' : age <= 6 ? 'warn' : 'bad', 'Scores for ' + fDay(sc.day), 'Orders through ' + fShort(od.day) + ' · ' + num(sc.n) + ' customers · ' + (age <= 2 ? 'scored daily' : 'last scored ' + ago(sc.day))];
    }
    if (mt.day) {
      const age = diffDays(mt.day, todayIso());
      items.models = [age <= 7 ? 'ok' : age <= 45 ? 'warn' : 'bad', 'Models trained ' + fDate(mt.day) + ' (' + ago(mt.day) + ')',
        (age > 7 ? 'Not retrained since; ' : '') + 'backtest ' + fShort(mb.day) + ', training labels end ' + fShort(tl.day) + '. Daily scoring keeps using these models.'];
    }
    if (sh.day) items.history = [sh.n >= 12 ? 'ok' : 'warn', 'Scored on ' + num(sh.n) + ' of the last 14 days', 'Score history since ' + fShort(sh.day) + '; days without new order data are skipped'];
    items.emails = em.n > 0 ? ['ok', num(em.n) + ' e-mails sent (last 30 days)', 'Real sends recorded in engage.events, last on ' + fShort(em.day)]
      : ['warn', 'No reminder sends recorded yet', 'engage.events has no real (non-simulated) e-mails in the last 30 days'];
    return which.filter((k) => items[k]).map((k) => {
      const x = items[k];
      return '<div class="fr ' + (x[0] === 'ok' ? '' : x[0]) + '"><span class="ico" aria-hidden="true">' + ic(x[0] === 'ok' ? 'ok' : 'warn') + '</span><div><b>' + esc(x[1]) + '</b><span>' + esc(x[2]) + '</span></div><span class="sr">' + (x[0] === 'ok' ? 'OK' : x[0] === 'warn' ? 'Warning' : 'Problem') + '</span></div>';
    }).join('');
  }
  const freshStrip = (which) => '<div class="fresh" aria-label="Data freshness">' + freshItems(which) + '</div>';

  // ══ Pages ═══════════════════════════════════════════════════════════════
  // 1. Overview per market
  async function pOverview() {
    const { rows } = await api('segments?by=market');
    const mks = marketList();
    const per = (m) => rows.filter((r) => !m || r.market === m);
    const stat = (rs) => {
      const due = rs.filter((r) => DUE14.has(r.runout_bucket)), od = rs.filter((r) => r.runout_bucket === '0 overdue');
      return {
        all: sum(rs, (r) => r.customers), due: sum(due, (r) => r.customers), dueMail: sum(due, (r) => (r.email_marketable ? r.customers : 0)),
        dueValue: sum(due, (r) => r.value_365), dueExp: sum(due, (r) => r.exp_reorders_30d),
        od: sum(od, (r) => r.customers), odMail: sum(od, (r) => (r.email_marketable ? r.customers : 0)),
        mail: sum(rs, (r) => (r.email_marketable ? r.customers : 0)),
        mix: ACTIONS.map((a) => [a[0], a[1], sum(rs.filter((r) => r.suggested_action === a[0]), (r) => r.customers)]),
      };
    };
    const T = stat(rows);
    const kpis = '<div class="kpis">' +
      kpi('Customers scored', num(T.all), num(T.mail) + ' may be e-mailed (' + pct(T.mail / T.all, 0) + ')') +
      kpi('Run out in the next 14 days', num(T.due), num(T.dueExp) + ' expected to reorder within 30 days') +
      kpi('E-mailable of those', pct(T.dueMail / T.due, 0), num(T.dueMail) + ' customers with marketing consent') +
      kpi('Value at stake', eur(T.dueValue), 'Predicted 12-month sales of the 14-day group') +
      kpi('Supply already ran out', num(T.od), num(T.odMail) + ' e-mailable · includes lapsed customers') + '</div>';
    const tiles = '<div class="tiles">' + mks.map((m) => {
      const s = stat(per(m));
      const mix = s.mix.filter((x) => x[2] > 0);
      return '<article class="tile" aria-labelledby="t-' + esc(m) + '"><div class="top"><h3 id="t-' + esc(m) + '">' + esc(mName(m)) + '<small>' + esc(m) + ' · ' + num(s.all) + ' customers</small></h3>' +
        '<span class="badge b-violet">' + pct(s.dueMail / s.due, 0) + ' e-mailable</span></div>' +
        '<div class="big">' + num(s.due) + '<small>run out in 14 days</small></div>' +
        '<div class="facts"><div class="fact"><span>E-mailable</span><b>' + num(s.dueMail) + '</b></div><div class="fact"><span>Value at stake</span><b>' + eur(s.dueValue) + '</b></div><div class="fact"><span>Ran out</span><b>' + num(s.od) + '</b></div></div>' +
        '<div><span class="label">Suggested action, all customers</span><div class="mixbar" role="img" aria-label="Suggested action mix for ' + esc(mName(m)) + ': ' + esc(mix.map((x) => x[0] + ' ' + pct(x[2] / s.all, 0)).join(', ')) + '" style="margin:8px 0 10px">' +
        mix.map((x) => '<i class="sw-' + x[1] + '" style="width:' + (100 * x[2] / s.all).toFixed(2) + '%" data-tip="' + tipHtml(x[0], [['Customers', num(x[2])], ['Share', pct(x[2] / s.all)]]) + '"></i>').join('') + '</div>' +
        '<div class="legend col">' + s.mix.map((x) => '<span><span style="display:inline-flex;align-items:center;gap:7px"><i class="sw-' + x[1] + '" aria-hidden="true"></i>' + esc(x[0]) + '</span><em>' + num(x[2]) + ' · ' + esc(share(x[2] / s.all)) + '</em></span>').join('') + '</div></div></article>';
    }).join('') + '</div>';
    const rules = card('How the model picks an action', 'From each customer\'s usual reorder gap and predicted value (refreshed with the scores every morning).',
      '<div class="tw"><table class="t"><thead><tr><th>Suggested action</th><th>Who</th></tr></thead><tbody>' +
      ACTIONS.map((a) => '<tr><td class="nw"><span class="dot sw-' + a[1] + '" aria-hidden="true"></span>' + esc(a[0]) + '</td><td>' + esc(a[2]) + '</td></tr>').join('') + '</tbody></table></div>') +
      notice('', '<p><b>Customer lists for e-mailing stay in BigQuery.</b> Take a segment from <code>' + LIST_TABLE + '</code> (filter <code>market</code>, <code>suggested_action</code>, <code>runout_date</code> and <code>email_marketable = TRUE</code>), and keep <code>ab_group = \'target\'</code> only, so the 10% hold-out stays un-mailed and the A/B read stays fair.</p>');
    return head('Live · scored ' + fDay(scoredOn()), 'Refill &amp; win-back', '“Run out” is the day a customer\'s last lens supply ends; “value at stake” is the predicted sales of the next 12 months. Counts per market, no customer details.') +
      freshStrip(['scores', 'models', 'emails']) + kpis + tiles + rules;
  }
  const kpi = (l, v, d) => '<div class="kpi"><span class="label">' + esc(l) + '</span><span class="v">' + v + '</span>' + (d ? '<span class="d">' + esc(d) + '</span>' : '') + '</div>';

  // 2. Runout calendar
  async function pCalendar(charts) {
    const { rows } = await api('calendar?' + qs({ market: F.market, action: F.action, days: F.days }));
    const start = scoredOn(), days = Array.from({ length: F.days + 1 }, (_, i) => isoAdd(start, i));
    const mks = F.market ? [F.market] : marketList();
    const at = {};
    rows.forEach((r) => { at[r.date + '|' + r.market] = r; });
    const cell = (d, m, k) => (at[d + '|' + m] ? at[d + '|' + m][k] : 0) || 0;
    const tot = (k) => sum(rows, (r) => r[k]);
    const dayTot = days.map((d) => sum(mks, (m) => cell(d, m, 'customers')));
    const peak = dayTot.reduce((b, v, i) => (v > dayTot[b] ? i : b), 0);
    const actLabel = (ACTION_OPTS.find((o) => o[0] === F.action) || ['', ''])[1];
    charts.push({ id: 'calChart', draw: stackedBars({
      label: 'Customers running out per day, next ' + F.days + ' days, stacked by market',
      cats: days, h: 240, shade: isWeekend, xl: (d) => fShort(d), minGap: 64,
      series: mks.map((m) => ({ cls: mCls(m), vals: days.map((d) => cell(d, m, 'customers')) })).reverse(),
      tips: days.map((d, i) => [fDay(d) + (i === 0 ? ' (today)' : ''), mks.map((m) => [mName(m), num(cell(d, m, 'customers'))]).concat([['Total', num(dayTot[i])], ['E-mailable', num(sum(mks, (m) => cell(d, m, 'emailable')))]])]),
    }) });
    CSVS.calendar = () => downloadCsv('runout-calendar', ['Date', 'Market', 'Action filter', 'Customers', 'E-mailable', 'Expected reorders 30d', 'Predicted 12-month value EUR'],
      days.flatMap((d) => mks.map((m) => [d, m, actLabel, cell(d, m, 'customers'), cell(d, m, 'emailable'), r2(cell(d, m, 'exp_reorders_30d')), r2(cell(d, m, 'value_365'))])));
    const tbl = '<div class="tw tall"><table class="t"><caption class="sr">Customers running out per day</caption><thead><tr><th>Day</th>' + mks.map((m) => '<th class="num">' + esc(m) + '</th>').join('') +
      '<th class="num">Total</th><th class="num">E-mailable</th><th class="num">Value</th></tr></thead><tbody>' +
      days.map((d, i) => {
        const em = sum(mks, (m) => cell(d, m, 'emailable'));
        return '<tr' + (isWeekend(d) ? ' class="wkend"' : '') + '><td class="nw">' + esc(fDay(d)) + (i === 0 ? ' <small>today</small>' : '') + '</td>' + mks.map((m) => '<td class="num">' + num(cell(d, m, 'customers')) + '</td>').join('') +
          '<td class="num">' + num(dayTot[i]) + '</td><td class="num">' + num(em) + ' <small>' + pct(dayTot[i] ? em / dayTot[i] : null, 0) + '</small></td><td class="num">' + eur(sum(mks, (m) => cell(d, m, 'value_365'))) + '</td></tr>';
      }).join('') + '</tbody><tfoot><tr><td>Total</td>' + mks.map((m) => '<td class="num">' + num(sum(rows.filter((r) => r.market === m), (r) => r.customers)) + '</td>').join('') +
      '<td class="num">' + num(tot('customers')) + '</td><td class="num">' + num(tot('emailable')) + '</td><td class="num">' + eur(tot('value_365')) + '</td></tr></tfoot></table></div>';
    return head('Next ' + F.days + ' days from ' + fShort(start), 'Runout calendar', 'Customers whose last lens supply ends on each day: the moment a refill reminder is most useful. Weekends are shaded.') +
      '<div class="ctrls">' + marketSeg() + sel('Suggested action', 'action', ACTION_OPTS) + seg('Range', 'days', [[14, '14 days'], [30, '30 days'], [60, '60 days']]) + '</div>' +
      '<div class="kpis">' + kpi('Run out in range', num(tot('customers')), actLabel) + kpi('E-mailable', num(tot('emailable')), pct(tot('emailable') / tot('customers'), 0) + ' of them') +
      kpi('Expected reorders', num(tot('exp_reorders_30d')), 'Sum of 30-day reorder chances') + kpi('Busiest day', num(dayTot[peak]), fDay(days[peak])) + '</div>' +
      (rows.length ? '<section class="card"><div class="card-h"><div><h2>Customers running out per day</h2><p>' + esc(F.market ? mName(F.market) : 'All markets') + ' · ' + esc(actLabel) + '</p></div>' + (mks.length > 1 ? legend(mks.map((m) => [mName(m), mCls(m)])) : '') + '</div>' +
        '<div class="card-b"><div class="chart" id="calChart"></div></div></section>' +
        '<section class="card"><div class="card-h"><div><h2>Per day</h2></div>' + csvBtn('calendar') + '</div>' + tbl + '</section>'
        : '<section class="card"><p class="empty">Nobody in this selection runs out in the next ' + F.days + ' days.</p></section>');
  }

  // 3. Segments table
  async function pSegments() {
    const { rows } = await api('segments?' + qs({ market: F.market, by: F.by }));
    const g = {};
    rows.filter((r) => (!F.mail || String(r.email_marketable) === F.mail) && (!F.segAction || r.suggested_action === F.segAction) && (!F.bucket || r.runout_bucket === F.bucket)).forEach((r) => {
      const k = [r.market, r.project_name, r.suggested_action, r.runout_bucket].join('|');
      const x = g[k] || (g[k] = { market: r.market, project: r.project_name, action: r.suggested_action, bucket: r.runout_bucket, customers: 0, mail: 0, exp: 0, value: 0, margin: 0 });
      x.customers += r.customers; x.mail += r.email_marketable ? r.customers : 0; x.exp += r.exp_reorders_30d; x.value += r.value_365; x.margin += r.margin_365;
    });
    const list = Object.values(g);
    list.forEach((x) => { x.share = x.customers ? x.mail / x.customers : 0; x.expRate = x.customers ? x.exp / x.customers : 0; });
    const k = F.sort.key, dir = F.sort.dir;
    const cmp = { market: (a, b) => a.market.localeCompare(b.market), project: (a, b) => a.project.localeCompare(b.project), action: (a, b) => aOrd(a.action) - aOrd(b.action), bucket: (a, b) => a.bucket.localeCompare(b.bucket) };
    list.sort((a, b) => dir * (cmp[k] ? cmp[k](a, b) : a[k] - b[k]) || a.market.localeCompare(b.market) || aOrd(a.action) - aOrd(b.action) || a.bucket.localeCompare(b.bucket));
    const maxC = Math.max.apply(null, list.map((x) => x.customers).concat([1]));
    const cols = [['market', 'Market'], F.by === 'project' ? ['project', 'Webshop'] : null, ['action', 'Suggested action'], ['bucket', 'Runs out'], ['customers', 'Customers', 1], ['mail', 'E-mailable', 1], ['share', 'E-mailable %', 1], ['exp', 'Exp. reorders 30d', 1], ['value', '12-month value', 1], ['margin', '12-month margin', 1]].filter(Boolean);
    const th = cols.map((c) => '<th' + (c[2] ? ' class="num"' : '') + (k === c[0] ? ' aria-sort="' + (dir > 0 ? 'ascending' : 'descending') + '"' : '') + '><button type="button" data-act="sort" data-k="' + c[0] + '" data-fid="sort-' + c[0] + '">' + esc(c[1]) + (k === c[0] ? (dir > 0 ? ' ↑' : ' ↓') : '') + '</button></th>').join('');
    const T = { customers: sum(list, (x) => x.customers), mail: sum(list, (x) => x.mail), exp: sum(list, (x) => x.exp), value: sum(list, (x) => x.value), margin: sum(list, (x) => x.margin) };
    const body = list.map((x) => '<tr><td class="nw">' + esc(x.market) + '</td>' + (F.by === 'project' ? '<td class="nw">' + esc(x.project) + '</td>' : '') +
      '<td class="nw"><span class="dot sw-' + aCls(x.action) + '" aria-hidden="true"></span>' + esc(x.action) + '</td><td class="nw">' + esc(bName(x.bucket)) + '</td>' +
      '<td class="num">' + num(x.customers) + '<span class="cellbar" aria-hidden="true"><i style="width:' + (100 * x.customers / maxC).toFixed(1) + '%"></i></span></td><td class="num">' + num(x.mail) + '</td><td class="num">' + pct(x.share, 0) + '</td>' +
      '<td class="num">' + num(x.exp) + ' <small>' + pct(x.expRate, 0) + ' each</small></td><td class="num">' + eur(x.value) + '</td><td class="num">' + eur(x.margin) + '</td></tr>').join('');
    CSVS.segments = () => downloadCsv('segments', ['Market'].concat(F.by === 'project' ? ['Webshop'] : []).concat(['Suggested action', 'Runs out', 'Customers', 'E-mailable', 'E-mailable share', 'Expected reorders 30d', 'Predicted 12-month value EUR', 'Predicted 12-month margin EUR']),
      list.map((x) => [x.market].concat(F.by === 'project' ? [x.project] : []).concat([x.action, bName(x.bucket), x.customers, x.mail, r4(x.share), r2(x.exp), r2(x.value), r2(x.margin)])));
    const shops = (META.shops || []).filter((s) => !F.market || s.market === F.market);
    return head('Scored ' + fDay(scoredOn()), 'Segments', 'Customers by market, suggested action and when their lenses run out, with how many may be e-mailed and the predicted value. Click a column to sort.') +
      '<div class="ctrls">' + marketSeg() + seg('Rows per', 'by', [['market', 'Market'], ['project', 'Webshop']]) + seg('E-mail consent', 'mail', [['', 'All'], ['true', 'E-mailable'], ['false', 'Not e-mailable']]) +
      sel('Suggested action', 'segAction', [['', 'All actions']].concat(ACTIONS.map((a) => [a[0], a[0]]))) + sel('Runs out', 'bucket', [['', 'Any time']].concat(BUCKETS.filter((b) => rows.some((r) => r.runout_bucket === b[0])))) + '</div>' +
      '<section class="card"><div class="card-h"><div><h2>' + num(list.length) + ' segments · ' + num(T.customers) + ' customers</h2><p>' + esc(F.market ? mName(F.market) : 'All markets') + (F.by === 'project' ? ' · ' + num(shops.length) + ' webshops' : '') + '</p></div>' + csvBtn('segments') + '</div>' +
      (list.length ? '<div class="tw tall"><table class="t"><caption class="sr">Segments</caption><thead><tr>' + th + '</tr></thead><tbody>' + body + '</tbody><tfoot><tr><td colspan="' + (F.by === 'project' ? 4 : 3) + '">Total</td>' +
        '<td class="num">' + num(T.customers) + '</td><td class="num">' + num(T.mail) + '</td><td class="num">' + pct(T.customers ? T.mail / T.customers : null, 0) + '</td><td class="num">' + num(T.exp) + '</td><td class="num">' + eur(T.value) + '</td><td class="num">' + eur(T.margin) + '</td></tr></tfoot></table></div>'
        : '<p class="empty">No customers in this selection.</p>') +
      '<div class="card-foot">The customer list for a segment is in BigQuery table <code>' + LIST_TABLE + '</code> (same market, suggested_action, runout_date window and email_marketable; keep ab_group = \'target\'). “Runs out” is counted from the scoring day, ' + esc(fShort(scoredOn())) + '.</div></section>';
  }

  // 4. Did reminders work?
  function abCohorts(cohorts, h) {
    const by = {};
    cohorts.forEach((r) => { const c = by[r.cohort] || (by[r.cohort] = { cohort: r.cohort, days: 0, final: true }); c[r.ab_group] = r; c.days = Math.max(c.days, r.days_observed); c.final = c.final && r.final; });
    const key = 'reordered_' + h + 'd';
    return Object.values(by).sort((a, b) => a.cohort.localeCompare(b.cohort)).map((c) => {
      const t = c.target || {}, k = c.control || {}, nt = t.customers || 0, nc = k.customers || 0;
      const x = { cohort: c.cohort, days: c.days, final: c.final, ok: c.days >= h, nt, nc, xt: t[key] || 0, xc: k[key] || 0 };
      x.rt = nt ? x.xt / nt : null; x.rc = nc ? x.xc / nc : null;
      x.d = x.rt != null && x.rc != null ? x.rt - x.rc : null;
      const se = nt && nc ? Math.sqrt(x.rt * (1 - x.rt) / nt + x.rc * (1 - x.rc) / nc) : null;
      x.lo = se != null ? x.d - 1.96 * se : null; x.hi = se != null ? x.d + 1.96 * se : null;
      x.st = nt ? (t.sales_30d || 0) / nt : null; x.sc = nc ? (k.sales_30d || 0) / nc : null;
      return x;
    });
  }
  function verdict(x, sent) {
    if (x.nc < 300 || x.xc < 20 || x.xt < 20) return ['warn', 'Too few customers to tell', 'The hold-out has ' + num(x.nc) + ' customers here with ' + num(x.xc) + ' reorders. A gap this size cannot be told apart from chance; choose a wider market or action filter.'];
    const inRange = x.lo <= 0 && x.hi >= 0;
    if (!sent) {
      return inRange ? ['', 'Groups behave the same (as expected)', 'Nobody has been e-mailed yet, so both groups were treated alike. The ' + ppt(x.d) + ' gap is inside the 95% range of chance (' + ppt(x.lo) + ' to ' + ppt(x.hi) + '): the hold-out split is fair, ready for real reminders.']
        : ['warn', 'Groups differ although nobody was e-mailed', 'A ' + ppt(x.d) + ' gap (95% range ' + ppt(x.lo) + ' to ' + ppt(x.hi) + ') without any reminders sent points at the split or at chance on a single day; check other days before trusting later results.'];
    }
    if (inRange) return ['', 'No measurable difference yet', 'Contacted customers reordered ' + ppt(x.d) + ' compared with the hold-out, but the 95% range (' + ppt(x.lo) + ' to ' + ppt(x.hi) + ') includes zero, so it could be chance.'];
    return x.d > 0 ? ['ok', 'Reminders lifted reorders', 'Contacted customers reordered ' + ppt(x.d) + ' more often than the hold-out (95% range ' + ppt(x.lo) + ' to ' + ppt(x.hi) + ').']
      : ['warn', 'Contacted group reordered less', 'Contacted customers reordered ' + ppt(x.d) + ' compared with the hold-out (95% range ' + ppt(x.lo) + ' to ' + ppt(x.hi) + '). Worth a look at the message or timing.'];
  }
  async function pAb(charts) {
    const { cohorts, baseline } = await api('ab?' + qs({ market: F.market, action: F.action }));
    const h = F.horizon, sent = (fresh('emails_sent').n || 0) > 0;
    const all = abCohorts(cohorts, h), ok = all.filter((x) => x.ok), last = ok[ok.length - 1];
    const actLabel = (ACTION_OPTS.find((o) => o[0] === F.action) || ['', ''])[1];
    const first = all.length ? all[0].cohort : (fresh('score_history').day || scoredOn());
    let top = sent ? '' : notice('warn', '<p><b>No reminder e-mails are recorded yet.</b> engage.events holds no real sends in the last 30 days (the e-mail work in engage_dev is simulated). Until reminders go out, target and control are treated the same, so this page is an A/A check: it shows the hold-out is fair, not that reminders work.</p>');
    let head1;
    if (last) {
      const v = verdict(last, sent);
      head1 = '<section class="card"><div class="card-h"><div><h2>' + esc(v[1]) + '</h2><p>Scoring day ' + esc(fDay(last.cohort)) + ' · reorders within ' + h + ' days · ' + esc(F.market ? mName(F.market) : 'all markets') + ' · ' + esc(actLabel) + '</p></div></div><div class="card-b">' +
        '<div class="verdict"><div class="vbox"><span>Target (would be contacted)</span><b>' + pct(last.rt) + '</b><small>' + num(last.xt) + ' of ' + num(last.nt) + ' reordered</small></div>' +
        '<div class="vbox"><span>Control (10% hold-out)</span><b>' + pct(last.rc) + '</b><small>' + num(last.xc) + ' of ' + num(last.nc) + ' reordered</small></div>' +
        '<div class="vbox"><span>Difference</span><b>' + ppt(last.d) + '</b><small>95% range ' + ppt(last.lo) + ' to ' + ppt(last.hi) + '</small></div>' +
        '<div class="vbox"><span>Relative uplift</span><b>' + (last.rc ? (last.d / last.rc >= 0 ? '+' : '−') + Math.abs(100 * last.d / last.rc).toFixed(0) + '%' : '–') + '</b><small>difference ÷ control rate</small></div></div>' +
        notice(v[0], '<p>' + esc(v[2]) + '</p>') + '</div></section>';
    } else {
      head1 = notice('', '<p><b>No ' + h + '-day read yet.</b> The first scoring day with ' + h + ' days of orders is ' + esc(fDay(isoAdd(first, h - 1 + 1))) + ' or later. Try a shorter window, or come back then.</p>');
    }
    charts.push({ id: 'abChart', draw: lineChart({
      label: h + '-day reorder rate per scoring day, target and control',
      cats: ok.map((x) => x.cohort), xl: (c) => fShort(c), fy: (v) => pct(v, 0), h: 220,
      series: [{ cls: 1, vals: ok.map((x) => x.rt) }, { cls: 0, vals: ok.map((x) => x.rc), dash: true }],
      tips: ok.map((x) => [fDay(x.cohort), [['Target', pct(x.rt) + ' of ' + num(x.nt)], ['Control', pct(x.rc) + ' of ' + num(x.nc)], ['Difference', ppt(x.d)], ['95% range', ppt(x.lo) + ' to ' + ppt(x.hi)]]]),
    }) });
    CSVS.ab = () => downloadCsv('ab-cohorts', ['Scoring day', 'Market', 'Action filter', 'Days observed', 'Window days', 'Target customers', 'Target reorders', 'Target rate', 'Control customers', 'Control reorders', 'Control rate', 'Difference', 'CI95 low', 'CI95 high', 'Target sales per customer EUR (observed days)', 'Control sales per customer EUR (observed days)'],
      all.map((x) => [x.cohort, F.market || 'All', actLabel, x.days, h, x.nt, x.ok ? x.xt : '', x.ok ? r4(x.rt) : '', x.nc, x.ok ? x.xc : '', x.ok ? r4(x.rc) : '', x.ok ? r4(x.d) : '', x.ok ? r4(x.lo) : '', x.ok ? r4(x.hi) : '', r2(x.st), r2(x.sc)]));
    const tbl = '<div class="tw tall"><table class="t"><caption class="sr">A/B result per scoring day</caption><thead><tr><th>Scoring day</th><th class="num">Days seen</th><th class="num">Target</th><th class="num">Rate</th><th class="num">Control</th><th class="num">Rate</th><th class="num">Difference</th><th class="num">95% range</th><th class="num">Sales / customer</th></tr></thead><tbody>' +
      all.slice().reverse().map((x) => '<tr><td class="nw">' + esc(fDay(x.cohort)) + '</td><td class="num">' + x.days + (x.final ? ' <small>final</small>' : '') + '</td><td class="num">' + num(x.nt) + '</td><td class="num">' + (x.ok ? pct(x.rt) : '<small>after ' + h + ' days</small>') + '</td>' +
        '<td class="num">' + num(x.nc) + '</td><td class="num">' + (x.ok ? pct(x.rc) : '–') + '</td><td class="num">' + (x.ok ? ppt(x.d) : '–') + '</td><td class="num">' + (x.ok ? ppt(x.lo) + ' to ' + ppt(x.hi) : '–') + '</td>' +
        '<td class="num">' + eur(x.st) + ' / ' + eur(x.sc) + '<small>target / control, ' + x.days + ' days</small></td></tr>').join('') + '</tbody></table></div>';
    // pre-period A/A check on the training labels
    const bl = {};
    baseline.forEach((r) => { (bl[r.asof] = bl[r.asof] || {})[r.ab_group] = r; });
    const blRows = Object.keys(bl).sort().reverse().map((d) => {
      const t = bl[d].target || {}, c = bl[d].control || {};
      const rt = t.customers ? t.reordered_30d / t.customers : null, rc = c.customers ? c.reordered_30d / c.customers : null;
      const se = t.customers && c.customers ? Math.sqrt(rt * (1 - rt) / t.customers + rc * (1 - rc) / c.customers) : null;
      return '<tr><td class="nw">' + esc(fDate(d)) + '</td><td class="num">' + num(t.customers) + '</td><td class="num">' + pct(rt) + '</td><td class="num">' + num(c.customers) + '</td><td class="num">' + pct(rc) + '</td><td class="num">' + ppt(rt - rc) + '</td><td class="num">' + (se ? '±' + (196 * se).toFixed(1) + ' pp' : '–') + '</td></tr>';
    }).join('');
    return head('A/B · 10% hold-out', 'Did reminders work?', 'Every scoring day splits customers by a fixed hash into target (90%, may be contacted) and control (10%, never contacted). Comparing how often each group reorders shows what the reminders add.') +
      '<div class="ctrls">' + marketSeg() + sel('Suggested action', 'action', ACTION_OPTS) + seg('Reorder within', 'horizon', [[7, '7 days'], [14, '14 days'], [30, '30 days']]) + '</div>' +
      top + head1 +
      (ok.length ? '<section class="card"><div class="card-h"><div><h2>' + h + '-day reorder rate per scoring day</h2><p>Only scoring days with at least ' + h + ' days of orders.</p></div>' + legend([['Target', 1], ['Control (hold-out)', 0]]) + '</div><div class="card-b"><div class="chart" id="abChart"></div></div></section>' : '') +
      '<section class="card"><div class="card-h"><div><h2>Per scoring day</h2><p>Each day is a separate read of mostly the same customers, so do not add days up; look at whether the gap holds day after day. Days are re-measured at 7, 14 and 30 days.</p></div>' + csvBtn('ab') + '</div>' +
      (all.length ? tbl : '<p class="empty">No scoring day has 7 days of orders yet.</p>') + '</section>' +
      card('Before any reminders: A/A check', 'The same hold-out hash applied to the model\'s training periods (30-day reorders, ' + esc(F.market ? mName(F.market) : 'all markets') + ', all actions). The groups should match; this is how big chance gaps get.',
        '<div class="tw"><table class="t"><thead><tr><th>Period start</th><th class="num">Target</th><th class="num">Rate</th><th class="num">Control</th><th class="num">Rate</th><th class="num">Difference</th><th class="num">Chance range</th></tr></thead><tbody>' + blRows + '</tbody></table></div>');
  }

  // 5. Model health
  async function pModel(charts) {
    const { metrics, accuracy, calibration } = await api('model');
    const runs = Array.from(new Set(metrics.map((m) => m.computed_at))).sort();
    const lastRun = runs[runs.length - 1];
    const cur = metrics.filter((m) => m.computed_at === lastRun);
    const one = (model) => cur.filter((m) => m.model === model).sort((a, b) => a.decile - b.decile);
    const mt = fresh('models_trained'), age = mt.day ? diffDays(mt.day, todayIso()) : null;
    const stale = age == null ? '' : age > 45 ? notice('bad', '<p><b>The models are stale: last trained ' + esc(fDate(mt.day)) + ' (' + age + ' days ago).</b> Scores are still produced daily, but from models that have not seen recent behaviour. Retrain them in BigQuery (customer_intel).</p>')
      : age > 7 ? notice('warn', '<p><b>Not retrained for ' + age + ' days</b> (last ' + esc(fDate(mt.day)) + '; backtest ' + esc(fShort(fresh('models_backtested').day)) + '). Daily scoring continues with these models; the live checks below show whether they still rank customers well.</p>') : '';
    const kp = (model) => { const r = one(model); if (!r.length) return ''; const a = r[0];
      return a.auc != null ? kpi(MODELS[model] + ' AUC', dec(a.auc, 3), 'Tested on ' + fShort(a.test_asof) + ' · base rate ' + pct(a.base_rate, 0))
        : kpi(MODELS[model], pct(a.share_of_actual, 0), 'of actual value in the top 10% · tested ' + fShort(a.test_asof)); };
    const sm = one(F.model), isVal = F.model === 'value_365d', fy = isVal ? (v) => eur(v) : (v) => pct(v, 0);
    charts.push({ id: 'calBack', draw: groupedBars({
      label: 'Backtest calibration of the ' + MODELS[F.model] + ' model per decile: predicted vs actual',
      cats: sm.map((m) => m.decile), xl: (d) => 'D' + d, fy, h: 220,
      series: [{ cls: 0, vals: sm.map((m) => m.predicted) }, { cls: 1, vals: sm.map((m) => m.actual) }],
      tips: sm.map((m) => ['Decile ' + m.decile + (m.decile === 1 ? ' (highest predicted)' : ''), [['Customers', num(m.customers)], ['Predicted', fy(m.predicted)], ['Actual', fy(m.actual)], ['Share of all actual', pct(m.share_of_actual)]]]),
    }) });
    // live accuracy: AUC per scoring day, all markets + per market
    const acc = {};
    accuracy.forEach((r) => { (acc[r.cohort] = acc[r.cohort] || {})[r.market] = r; });
    const days = Object.keys(acc).sort();
    const mks = marketList();
    const back30 = (one('reorder_30d')[0] || {}).auc;
    charts.push({ id: 'aucLive', draw: lineChart({
      label: 'Live AUC of the 30-day reorder score per scoring day', cats: days, xl: (c) => fShort(c), fy: (v) => dec(v, 1), min: 0.5, max: 1, ticks: 5, h: 200,
      ref: back30 ? { v: back30, label: 'backtest ' + dec(back30, 3) } : null,
      series: [{ cls: 1, vals: days.map((d) => (acc[d].All || {}).auc) }].concat(mks.map((m) => ({ cls: mCls(m) === 1 ? 4 : mCls(m), vals: days.map((d) => (acc[d][m] || {}).auc), dash: true }))),
      tips: days.map((d) => [fDay(d) + ' · ' + (acc[d].All || {}).days_observed + ' days seen', [['All markets', dec((acc[d].All || {}).auc, 3)]].concat(mks.map((m) => [mName(m), dec((acc[d][m] || {}).auc, 3)]))]),
    }) });
    const calCo = calibration[0] || null;
    charts.push({ id: 'calLive', draw: groupedBars({
      label: 'Live calibration: predicted 30-day reorder chance vs share that reordered, per predicted band',
      cats: calibration.map((c) => c.band), xl: (b) => b * 10 + '%', fy: (v) => pct(v, 0), h: 200,
      series: [{ cls: 0, vals: calibration.map((c) => c.mean_p30) }, { cls: 1, vals: calibration.map((c) => c.actual_rate) }],
      tips: calibration.map((c) => ['Predicted ' + c.band * 10 + '–' + (c.band * 10 + 10) + '%', [['Customers', num(c.customers)], ['Predicted', pct(c.mean_p30)], ['Reordered', pct(c.actual_rate)]]]),
    }) });
    CSVS.accuracy = () => downloadCsv('live-accuracy', ['Scoring day', 'Market', 'Days observed', 'Final', 'Customers', 'Reordered', 'Mean predicted p30', 'Actual reorder rate', 'AUC'],
      accuracy.map((r) => [r.cohort, r.market, r.days_observed, r.final ? 'yes' : 'no', r.customers, r.reordered, r4(r.mean_p30), r4(r.actual_rate), r4(r.auc)]));
    CSVS.backtest = () => downloadCsv('backtest', ['Computed at', 'Model', 'Tested on', 'Decile', 'Customers', 'Predicted', 'Actual', 'Share of actual', 'Base rate', 'AUC'],
      metrics.map((m) => [m.computed_at, m.model, m.test_asof, m.decile, m.customers, r4(m.predicted), r4(m.actual), r4(m.share_of_actual), r4(m.base_rate), r4(m.auc)]));
    const runRows = [];
    runs.slice().reverse().forEach((r) => Object.keys(MODELS).forEach((m) => { const x = metrics.find((y) => y.computed_at === r && y.model === m && y.decile === 1); if (x) runRows.push(x); }));
    return head('Predictions · customer_intel', 'Model health', 'How well the reorder and value predictions match what customers actually did, and how fresh the models are.') +
      freshStrip(['models', 'scores', 'history']) + stale +
      '<div class="kpis">' + kp('reorder_30d') + kp('reorder_90d') + kp('value_365d') + kpi('Backtest runs kept', num(runs.length), 'last ' + (lastRun ? fDate(lastRun.slice(0, 10)) : '–')) + '</div>' +
      '<section class="card"><div class="card-h"><div><h2>Backtest calibration</h2><p>Customers split into 10 equal groups by prediction (D1 = highest). Bars close together = well calibrated. Tested on a period the model was not trained on.</p></div>' +
      '<div class="ctrls" style="margin:0">' + seg('Model', 'model', Object.keys(MODELS).map((m) => [m, MODELS[m]])) + '</div></div>' +
      '<div class="card-b">' + legend([['Predicted', 0], ['Actual', 1]]) + '<div class="chart" id="calBack" style="margin-top:8px"></div></div></section>' +
      '<div class="cols2"><section class="card"><div class="card-h"><div><h2>Live accuracy (AUC) per scoring day</h2><p>30-day reorder score against who actually reordered since. 0.5 = coin flip, 1 = perfect. Early days only see the first reorders; final after 30 days.</p></div>' + legend([['All markets', 1]].concat(mks.map((m) => [mName(m) + ' (dashed)', mCls(m) === 1 ? 4 : mCls(m)]))) + '</div>' +
      '<div class="card-b">' + (days.length ? '<div class="chart" id="aucLive"></div>' : '<p class="empty">The first live read comes 7 days after the first scoring day.</p>') + '</div></section>' +
      '<section class="card"><div class="card-h"><div><h2>Live calibration</h2><p>' + (calCo ? 'Scoring day ' + esc(fDay(calCo.cohort)) + ', ' + calCo.days_observed + ' of 30 days seen' + (calCo.final ? '' : ': reorders are still coming in, so “reordered” sits below “predicted” until day 30') + '.' : 'Not available yet.') + '</p></div>' + legend([['Predicted', 0], ['Reordered', 1]]) + '</div>' +
      '<div class="card-b">' + (calibration.length ? '<div class="chart" id="calLive"></div>' : '<p class="empty">No live read yet.</p>') + '</div></section></div>' +
      '<section class="card"><div class="card-h"><div><h2>Live accuracy table</h2></div>' + csvBtn('accuracy') + '</div><div class="tw tall"><table class="t"><thead><tr><th>Scoring day</th><th class="num">Days seen</th><th class="num">AUC all</th>' + mks.map((m) => '<th class="num">AUC ' + esc(m) + '</th>').join('') + '<th class="num">Predicted 30d</th><th class="num">Reordered so far</th></tr></thead><tbody>' +
      days.slice().reverse().map((d) => { const a = acc[d].All || {}; return '<tr><td class="nw">' + esc(fDay(d)) + '</td><td class="num">' + a.days_observed + (a.final ? ' <small>final</small>' : '') + '</td><td class="num">' + dec(a.auc, 3) + '</td>' + mks.map((m) => '<td class="num">' + dec((acc[d][m] || {}).auc, 3) + '</td>').join('') + '<td class="num">' + pct(a.mean_p30) + '</td><td class="num">' + pct(a.actual_rate) + '</td></tr>'; }).join('') +
      '</tbody></table></div></section>' +
      '<section class="card"><div class="card-h"><div><h2>Backtest history</h2><p>Kept by this app every time the models are retrained (the source table only holds the latest run).</p></div>' + csvBtn('backtest') + '</div><div class="tw"><table class="t"><thead><tr><th>Computed</th><th>Model</th><th>Tested on</th><th class="num">Customers</th><th class="num">AUC</th><th class="num">Base rate</th><th class="num">Top 10% share</th></tr></thead><tbody>' +
      runRows.map((x) => '<tr><td class="nw">' + esc(fDate(x.computed_at.slice(0, 10))) + '</td><td class="nw">' + esc(MODELS[x.model]) + '</td><td class="nw">' + esc(fDate(x.test_asof)) + '</td><td class="num">' + num(sum(metrics.filter((y) => y.computed_at === x.computed_at && y.model === x.model), (y) => y.customers)) + '</td><td class="num">' + dec(x.auc, 3) + '</td><td class="num">' + (x.model === 'value_365d' ? eur(x.base_rate) : pct(x.base_rate)) + '</td><td class="num">' + pct(x.share_of_actual, 0) + '</td></tr>').join('') +
      '</tbody></table></div><div class="card-foot">Summary rebuilt ' + esc(fDay(fresh('summary').day)) + '. Scores refreshed ' + esc((fresh('scores').updated_at || '').replace('T', ' ').replace('Z', ' UTC')) + '.</div></section>';
  }

  // ── start ────────────────────────────────────────────────────────────────
  route = location.hash.replace(/^#\/?/, '').split('/')[0] || '';
  if (!Object.prototype.hasOwnProperty.call(PAGES, route)) { route = ''; location.replace('#/'); }
  checkSession();
})();
