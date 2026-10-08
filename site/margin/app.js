/* Margin leak & discount guard: vanilla JS single-page app over /api/margin/* (server: /margin.js).
 * LIVE DATA ONLY, for allow-listed accounts. Everything fetched lives in page memory (LC) and is dropped on a
 * 401/403, on sign-out and on account change — never in localStorage, IndexedDB or a sync snapshot.
 * localStorage "adrial-margin-ui" keeps per-viewer preferences only (date preset, flag thresholds).
 * Routes: #/ (overview), #/codes, #/pricelists, #/brands, #/alerts. */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const API = '/api/margin/';

  // ── Formatting (sl-SI numbers, dates d. m. yyyy, amounts in EUR) ─────────
  const NF0 = new Intl.NumberFormat('sl-SI', { maximumFractionDigits: 0 });
  const NF1 = new Intl.NumberFormat('sl-SI', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const fin = (x) => x != null && isFinite(x);
  const eur = (n) => (fin(n) ? (n < 0 ? '−' : '') + NF0.format(Math.abs(Math.round(n))) + ' €' : '—');
  const eurK = (n) => (!fin(n) ? '—' : Math.abs(n) >= 1e6 ? (n < 0 ? '−' : '') + NF1.format(Math.abs(n) / 1e6) + ' M€' : Math.abs(n) >= 1e4 ? (n < 0 ? '−' : '') + NF0.format(Math.abs(n) / 1e3) + ' k€' : eur(n));
  const num = (n) => (fin(n) ? NF0.format(Math.round(n)) : '—');
  const pct = (x) => (fin(x) ? (x < 0 ? '−' : '') + NF1.format(Math.abs(x) * 100) + ' %' : '—');
  const pp = (x) => (fin(x) ? (x > 0.0005 ? '+' : x < -0.0005 ? '−' : '±') + NF1.format(Math.abs(x) * 100) + ' pp' : '—');
  const sgnPct = (x) => (fin(x) ? (x > 0 ? '+' : x < 0 ? '−' : '±') + NF1.format(Math.abs(x) * 100) + ' %' : '—');
  const div = (a, b) => (b ? a / b : null);
  const fdate = (s) => (s ? +s.slice(8, 10) + '. ' + +s.slice(5, 7) + '. ' + s.slice(0, 4) : '—');
  const fdm = (s) => +s.slice(8, 10) + '. ' + +s.slice(5, 7) + '.';
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fmon = (ym) => MON[+ym.slice(5, 7) - 1] + ' ' + ym.slice(2, 4);
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  const D = (s) => new Date(s + 'T00:00:00Z');
  const isoD = (d) => d.toISOString().slice(0, 10);
  const addDays = (s, n) => isoD(new Date(D(s).getTime() + n * 864e5));
  const daysBetween = (a, b) => Math.round((D(b) - D(a)) / 864e5);
  const dow = (s) => D(s).getUTCDay();

  const IC = {
    x: 'M6 6l12 12M18 6L6 18', exp: 'M12 4v12M6 10l6 6 6-6M5 20h14', back: 'M15 6l-6 6 6 6', fwd: 'M9 6l6 6-6 6',
    home: 'M4 20V4M4 20h16M8 16l4-5 3 3 5-7', tag: 'M3 12V4h8l10 10-8 8zM7.5 7.5v.01', list: 'M8 6h12M8 12h12M8 18h12M4 6v.01M4 12v.01M4 18v.01',
    box: 'M4 7l8-4 8 4v10l-8 4-8-4zM4 7l8 4 8-4M12 11v10', bell: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0',
    warn: 'M12 4l9 16H3zM12 10v4M12 17v.01', ok: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8 12l3 3 5-6', bad: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8v5M12 16v.01',
    lock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3', retry: 'M4 12a8 8 0 1 0 2.4-5.7L4 8.6M4 4v4.6h4.6'
  };
  const ic = (n) => '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="' + IC[n] + '"/></svg>';
  const badge = (lv, label, icon) => '<span class="st ' + lv + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + IC[icon || (lv === 'good' ? 'ok' : lv === 'bad' ? 'bad' : 'warn')] + '"/></svg>' + esc(label) + '</span>';

  // ── Per-viewer preferences (no data) ─────────────────────────────────────
  const UIKEY = 'adrial-margin-ui';
  const PREF = { preset: '90', minPct: 20, maxGap: 8, minRev: 1000, codeShow: 'all', leakDim: 'code', brandGroup: 'bc', negOnly: true };
  try { Object.assign(PREF, JSON.parse(localStorage.getItem(UIKEY) || '{}')); } catch (e) { /* blocked or bad */ }
  function savePref() { try { localStorage.setItem(UIKEY, JSON.stringify(PREF)); } catch (e) { /* blocked */ } }

  // ── State ────────────────────────────────────────────────────────────────
  let SESSION = { checked: false, failed: false, signedIn: false, allowed: false, email: null };
  let LC = {}, gen = 0, rTimer = null;
  const F = { from: '', to: '', market: '', project: '', channel: '' };
  let alertDay = '';
  let drawerCode = null;
  const SORT = {}, SHOWALL = {}, CSV = {}, CH = {}, SEARCH = {};
  let route = 'overview';

  // ── Fetching (same-origin GET; only the server's `error` text is shown) ──
  function qs(o) {
    const q = [];
    Object.keys(o).forEach((k) => { const v = o[k]; if (v !== '' && v != null) q.push(encodeURIComponent(k) + '=' + encodeURIComponent(v)); });
    return q.length ? '?' + q.join('&') : '';
  }
  const fp = () => ({ from: F.from, to: F.to, market: F.market, project: F.project, channel: F.channel });
  const aurl = (r, extra) => API + r + qs(Object.assign(fp(), extra || {}));
  function lfetch(url) {
    return fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' }, cache: 'no-store' }).then((r) => r.json().catch(() => ({})).then((j) => {
      if (r.ok) return j;
      const msg = j && typeof j.error === 'string' && j.error ? j.error.slice(0, 300) :
        r.status === 401 ? 'Sign in to see live margin data.' : r.status === 403 ? 'Your account is not on the list for live margin data.' : 'The margin data is unavailable right now.';
      const e = new Error(msg); e.status = r.status; throw e;
    }), () => { const e = new Error('Could not reach the server. Check the connection and try again.'); e.status = 0; throw e; });
  }
  function lget(url) {
    let c = LC[url];
    if (c) return c;
    const g = gen;
    c = LC[url] = { status: 'loading', url: url };
    lfetch(url).then((d) => {
      if (g !== gen || LC[url] !== c) return;
      c.status = 'ok'; c.data = d;
      changed();
    }, (e) => {
      if (g !== gen || LC[url] !== c) return;
      c.status = 'error'; c.err = e.message; c.code = e.status;
      if (e.status === 401 || e.status === 403) denied(e.status); else changed();
    });
    return c;
  }
  function changed() { clearTimeout(rTimer); rTimer = setTimeout(rerender, 30); }
  // forget every live number held by the page (rows, chart series, CSV buffers)
  function forget() {
    gen++; LC = {};
    [CSV, CH].forEach((o) => Object.keys(o).forEach((k) => { delete o[k]; }));
    drawerCode = null; closeAll();
  }
  function denied(code) {
    forget();
    SESSION.allowed = false;
    if (code === 401) SESSION.signedIn = false;
    toast(code === 401 ? 'Your sign-in has ended: live data is hidden.' : 'This account has no access to live margin data.');
    rerender();
    checkSession();
  }
  function wait(cs, what) {
    for (let i = 0; i < cs.length; i++) if (cs[i].status === 'error') return lerror(cs[i]);
    for (let j = 0; j < cs.length; j++) if (cs[j].status !== 'ok') return '<div class="card pad"><p class="loading" role="status" style="margin:10px 0"><i aria-hidden="true"></i>Loading ' + esc(what) + '…</p></div>';
    return null;
  }
  function lerror(c) {
    const t = { 0: 'Could not reach the server', 400: 'That could not be looked up', 502: 'The margin data is unavailable' }[c.code] || 'Could not load this part of the data';
    return '<div class="card pad lerr" role="alert"><h2>' + esc(t) + '</h2><p>' + esc(c.err || '') + '</p>' +
      (c.code !== 400 ? '<div class="dr-actions"><button type="button" class="btn" data-act="retry" data-fid="retry">' + ic('retry') + 'Try again</button></div>' : '') + '</div>';
  }

  // ── Session ──────────────────────────────────────────────────────────────
  let sessP = null;
  function checkSession() {
    if (sessP) return sessP;
    sessP = fetch(API + 'session', { credentials: 'same-origin', headers: { Accept: 'application/json' }, cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error('session ' + r.status); return r.json(); })
      .then((j) => { SESSION = { checked: true, failed: false, signedIn: !!j.signedIn, allowed: !!j.allowed, email: j.email || null }; },
        () => { SESSION = { checked: true, failed: true, signedIn: false, allowed: false, email: null }; })
      .then(() => { sessP = null; if (!SESSION.allowed) forget(); rerender(); });
    return sessP;
  }
  function watchAuth() {
    if (!window.AdrialSync || !window.AdrialSync.on) return;
    // compare only once the sign-in library knows who is signed in: its first "loaded" event is not a change
    (window.AdrialSync.ready || Promise.resolve()).then(() => {
      let last = ((window.AdrialSync.user && window.AdrialSync.user()) || {}).email || '';
      window.AdrialSync.on(() => {
        const now = ((window.AdrialSync.user && window.AdrialSync.user()) || {}).email || '';
        if (now !== last) { last = now; forget(); SESSION.checked = false; rerender(); checkSession(); }
      });
    });
  }

  // ── Layers (drawer), focus, toast ────────────────────────────────────────
  const layers = [];
  let uid = 0;
  const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  function openLayer(html, onClose) {
    const host = document.createElement('div');
    host.className = 'layer layer-' + (layers.length + 1);
    host.innerHTML = '<div class="scrim" data-close></div>' + html;
    $('layers').appendChild(host);
    const op = document.activeElement;
    const L = { el: host, opener: op, openerKey: op && op.getAttribute ? (op.getAttribute('data-fid') || op.id) : '', onClose: onClose };
    layers.push(L);
    host.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) { e.preventDefault(); closeLayer(L); } });
    return L;
  }
  function closeLayer(L, noRestore) {
    const i = layers.indexOf(L);
    if (i < 0) return;
    layers.splice(i, 1); L.el.remove();
    if (L.onClose) L.onClose();
    if (noRestore) return;
    let back = L.opener && L.opener.isConnected && L.opener !== document.body ? L.opener : null;
    if (!back && L.openerKey) back = document.querySelector('[data-fid="' + CSS.escape(L.openerKey) + '"]');
    if (back) back.focus(); else { const h = document.querySelector('#page h1'); if (h) h.focus({ preventScroll: true }); }
  }
  function closeAll() { while (layers.length) closeLayer(layers[layers.length - 1], true); }
  function withFocus(fn) {
    const a = document.activeElement, key = a && a !== document.body ? (a.getAttribute('data-fid') || '') : '';
    const y = window.scrollY;
    fn();
    if (key) { const n = document.querySelector('[data-fid="' + CSS.escape(key) + '"]'); if (n) n.focus({ preventScroll: true }); }
    window.scrollTo(0, y);
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (layers.length) { e.preventDefault(); closeLayer(layers[layers.length - 1]); return; }
      if ($('side').classList.contains('open')) { setMenu(false); $('menuBtn').focus(); }
      return;
    }
    if (e.key === 'Tab' && layers.length) {
      const box = layers[layers.length - 1].el.querySelector('[role=dialog]');
      const f = Array.prototype.filter.call(box.querySelectorAll(FOCUSABLE), (n) => n.offsetParent !== null || n === document.activeElement);
      if (!f.length) { e.preventDefault(); box.focus(); return; }
      const first = f[0], last = f[f.length - 1];
      if (!box.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && (document.activeElement === first || document.activeElement === box)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 3200); }
  function setMenu(open) { $('side').classList.toggle('open', open); $('menuBtn').setAttribute('aria-expanded', String(open)); }
  $('menuBtn').addEventListener('click', () => setMenu(!$('side').classList.contains('open')));

  // ── CSV (built from the rows on screen; page memory only) ────────────────
  function csvCell(v) {
    if (v == null) return '';
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;   // no spreadsheet formulas
    return /[",\r\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  const p100 = (x) => (fin(x) ? r2(x * 100) : '');
  const r2 = (n, d) => (fin(n) ? String(Math.round(n * Math.pow(10, d == null ? 2 : d)) / Math.pow(10, d == null ? 2 : d)) : '');
  function downloadCsv(name, header, rows) {
    const s = '﻿' + [header].concat(rows).map((r) => r.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([s], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'margin-' + name + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  // ── Sortable tables ──────────────────────────────────────────────────────
  // cols: { k, label, num, v(row) sort value, h(row) cell html, csv(row) export value, csvLabel }
  function table(id, cols, rows, o) {
    o = o || {};
    const s = SORT[id] || o.sort || { k: cols[1].k, dir: -1 };
    const col = cols.find((c) => c.k === s.k) || cols[1];
    const val = (r) => (col.v ? col.v(r) : r[col.k]);
    const sorted = rows.slice().sort((a, b) => {
      const pa = o.pin ? (o.pin(a) ? 0 : 1) : 1, pb = o.pin ? (o.pin(b) ? 0 : 1) : 1;
      if (pa !== pb) return pa - pb;
      const x = val(a), y = val(b);
      const nx = x == null || (typeof x === 'number' && !isFinite(x)), ny = y == null || (typeof y === 'number' && !isFinite(y));
      if (nx || ny) return nx === ny ? 0 : nx ? 1 : -1;
      if (typeof x === 'string') return s.dir * x.localeCompare(y, 'sl');
      return s.dir * (x - y);
    });
    CSV[id] = { name: o.csv || id, header: cols.map((c) => c.csvLabel || c.label), rows: sorted.map((r) => cols.map((c) => (c.csv ? c.csv(r) : c.v ? c.v(r) : r[c.k]))) };
    const lim = SHOWALL[id] ? Infinity : (o.limit || 60);
    const shown = sorted.slice(0, lim);
    const th = (c) => {
      const on = c.k === s.k;
      return '<th scope="col"' + (c.num ? ' class="num"' : '') + (on ? ' aria-sort="' + (s.dir > 0 ? 'ascending' : 'descending') + '"' : '') +
        '><button type="button" data-act="sort" data-t="' + id + '" data-k="' + c.k + '" data-fid="th-' + id + '-' + c.k + '">' + esc(c.label) + (on ? (s.dir > 0 ? ' ↑' : ' ↓') : '') + '</button></th>';
    };
    if (!rows.length) return '<div class="empty">' + esc(o.empty || 'Nothing in this period.') + '</div>';
    return '<div class="tw"><table class="t compact">' + (o.caption ? '<caption class="sr">' + esc(o.caption) + '</caption>' : '') +
      '<thead><tr>' + cols.map(th).join('') + '</tr></thead><tbody>' +
      shown.map((r) => '<tr' + (o.rowCls ? ' class="' + o.rowCls(r) + '"' : '') + '>' + cols.map((c, i) => {
        const h = c.h ? c.h(r) : esc(c.v ? c.v(r) : r[c.k]);
        return i === 0 ? '<th scope="row" class="name" style="font-weight:400;text-align:left">' + h + '</th>' : '<td' + (c.num ? ' class="num"' : '') + '>' + h + '</td>';
      }).join('') + '</tr>').join('') + '</tbody></table></div>' +
      (sorted.length > lim ? '<div class="more"><button type="button" class="btn sm" data-act="more" data-t="' + id + '" data-fid="more-' + id + '">Show all ' + num(sorted.length) + ' rows</button></div>' : '');
  }
  const csvBtn = (id, label) => '<button type="button" class="btn sm" data-act="csv" data-t="' + id + '" data-fid="csv-' + id + '">' + ic('exp') + (label || 'Export CSV') + '</button>';

  // ── Charts (inline SVG, hover tooltip, a table view next to each) ────────
  const CW = 720, CHH = 230, PL = 52, PR = 14, PT = 12, PB = 28;
  function niceTicks(lo, hi, n) {
    const span = hi - lo || 1, step0 = span / n, mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n) || 10 * mag;
    const a = Math.floor(lo / step) * step, out = [];
    for (let v = a, i = 0; i < 50; v += step, i++) { out.push(+v.toFixed(10)); if (v >= hi - step * 0.001) break; }
    return out;
  }
  function xLabels(labels) {
    const n = labels.length, every = Math.max(1, Math.ceil(n / 8));
    return labels.map((l, i) => (i % every === 0 || (i === n - 1 && (n - 1) % every >= every * 0.6) ? l : null));
  }
  function lineChart(id, labels, series, o) {
    const vals = []; series.forEach((s) => s.values.forEach((v) => { if (fin(v)) vals.push(v); }));
    if (!vals.length) return '<div class="empty">No sales in this period.</div>';
    let lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    const padv = (hi - lo) * 0.12 || 0.02; lo -= padv; hi += padv;
    const ticks = niceTicks(lo, hi, 4); lo = Math.min(lo, ticks[0]); hi = Math.max(hi, ticks[ticks.length - 1]);
    const n = labels.length, pw = CW - PL - PR, ph = CHH - PT - PB;
    const x = (i) => PL + (n === 1 ? pw / 2 : i * pw / (n - 1));
    const y = (v) => PT + ph - (v - lo) / (hi - lo) * ph;
    let g = ticks.map((t) => '<line class="grid-l" x1="' + PL + '" x2="' + (CW - PR) + '" y1="' + y(t) + '" y2="' + y(t) + '"/><text class="ax" x="' + (PL - 8) + '" y="' + (y(t) + 3.5) + '" text-anchor="end">' + esc(o.fy(t)) + '</text>').join('');
    g += xLabels(labels).map((l, i) => (l ? '<text class="ax" x="' + x(i) + '" y="' + (CHH - 8) + '" text-anchor="middle">' + esc(l) + '</text>' : '')).join('');
    series.forEach((s) => {
      let d = '', pen = false;
      s.values.forEach((v, i) => { if (fin(v)) { d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1); pen = true; } else pen = false; });
      g += '<path class="line" d="' + d + '" stroke="' + s.color + '"/>';
      if (n <= 40) s.values.forEach((v, i) => { if (fin(v)) g += '<circle class="pt" cx="' + x(i) + '" cy="' + y(v) + '" r="3.5" fill="' + s.color + '"/>'; });
    });
    const bw = pw / Math.max(1, n - 1);
    for (let i = 0; i < n; i++) g += '<rect class="hit" data-ch="' + id + '" data-i="' + i + '" x="' + (x(i) - bw / 2) + '" y="' + PT + '" width="' + bw + '" height="' + ph + '"/>';
    g += '<line class="cross" x1="0" x2="0" y1="' + PT + '" y2="' + (PT + ph) + '" visibility="hidden"/>';
    CH[id] = { n: n, xs: labels.map((l, i) => x(i) / CW), tip: o.tip };
    return '<div class="chart" data-chart="' + id + '"><svg viewBox="0 0 ' + CW + ' ' + CHH + '" role="img" aria-label="' + esc(o.aria) + '">' + g + '</svg><div class="tip" hidden></div></div>';
  }
  function barChart(id, labels, values, o) {
    if (!values.some((v) => fin(v) && v > 0)) return '<div class="empty">' + esc(o.empty || 'Nothing to show.') + '</div>';
    const hi0 = Math.max.apply(null, values.filter(fin));
    const ticks = niceTicks(0, hi0 * 1.08, 4), hi = ticks[ticks.length - 1] || 1;
    const n = labels.length, pw = CW - PL - PR, ph = CHH - PT - PB, bw = pw / n;
    const y = (v) => PT + ph - v / hi * ph;
    let g = ticks.map((t) => '<line class="grid-l" x1="' + PL + '" x2="' + (CW - PR) + '" y1="' + y(t) + '" y2="' + y(t) + '"/><text class="ax" x="' + (PL - 8) + '" y="' + (y(t) + 3.5) + '" text-anchor="end">' + esc(o.fy(t)) + '</text>').join('');
    g += xLabels(labels).map((l, i) => (l ? '<text class="ax" x="' + (PL + bw * (i + 0.5)) + '" y="' + (CHH - 8) + '" text-anchor="middle">' + esc(l) + '</text>' : '')).join('');
    values.forEach((v, i) => {
      if (!fin(v) || v <= 0) return;
      const w = Math.max(1.5, bw - 2), h = Math.max(1, ph - (y(v) - PT)), x0 = PL + bw * i + (bw - w) / 2, r = Math.min(4, w / 2, h);
      g += '<path class="negbar' + (o.hl === i ? ' hl' : '') + '" d="M' + x0 + ' ' + (PT + ph) + 'V' + (y(v) + r) + 'Q' + x0 + ' ' + y(v) + ' ' + (x0 + r) + ' ' + y(v) + 'H' + (x0 + w - r) + 'Q' + (x0 + w) + ' ' + y(v) + ' ' + (x0 + w) + ' ' + (y(v) + r) + 'V' + (PT + ph) + 'Z"/>';
    });
    g += '<line class="base" x1="' + PL + '" x2="' + (CW - PR) + '" y1="' + (PT + ph) + '" y2="' + (PT + ph) + '"/>';
    for (let i = 0; i < n; i++) g += '<rect class="hit" data-ch="' + id + '" data-i="' + i + '" x="' + (PL + bw * i) + '" y="' + PT + '" width="' + bw + '" height="' + ph + '"/>';
    CH[id] = { n: n, xs: labels.map((l, i) => (PL + bw * (i + 0.5)) / CW), tip: o.tip, bars: true };
    return '<div class="chart" data-chart="' + id + '"><svg viewBox="0 0 ' + CW + ' ' + CHH + '" role="img" aria-label="' + esc(o.aria) + '">' + g + '</svg><div class="tip" hidden></div></div>';
  }
  function chartHover(e) {
    const hit = e.target.closest && e.target.closest('.hit');
    const box = e.target.closest && e.target.closest('.chart');
    document.querySelectorAll('.chart .hit.on').forEach((h) => { if (h !== hit) h.classList.remove('on'); });
    if (!box) return;
    const tip = box.querySelector('.tip'), cross = box.querySelector('.cross');
    if (!hit) { tip.hidden = true; if (cross) cross.setAttribute('visibility', 'hidden'); return; }
    const c = CH[hit.getAttribute('data-ch')]; if (!c) return;
    const i = +hit.getAttribute('data-i');
    hit.classList.add('on');
    tip.innerHTML = c.tip(i); tip.hidden = false;
    const fx = c.xs[i], bw = box.clientWidth;
    tip.style.top = '8px';
    tip.style.left = Math.max(0, Math.min(bw - tip.offsetWidth, fx * bw + (fx > 0.6 ? -tip.offsetWidth - 14 : 14))) + 'px';
    if (cross) { const px = fx * CW; cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.setAttribute('visibility', 'visible'); }
  }
  document.addEventListener('mouseover', chartHover);
  document.addEventListener('mouseleave', (e) => { if (e.target && e.target.classList && e.target.classList.contains('chart')) chartHover({ target: e.target }); }, true);
  const tipRow = (color, label, value) => '<div><span>' + (color ? '<i style="background:' + color + '"></i>' : '') + esc(label) + '</span><b style="all:unset;font-weight:500">' + value + '</b></div>';
  const legend = (items) => '<div class="legend">' + items.map((s) => '<span><i style="background:' + s[1] + '"></i>' + esc(s[0]) + '</span>').join('') + '</div>';

  // buckets for the trend: day (≤ 45 days), ISO week (≤ 200 days) or month
  function bucketOf(span) { return span <= 45 ? 'day' : span <= 200 ? 'week' : 'month'; }
  function bucketKey(s, b) { return b === 'day' ? s : b === 'week' ? addDays(s, -((dow(s) + 6) % 7)) : s.slice(0, 7); }
  function bucketLabel(k, b) { return b === 'month' ? fmon(k) : fdm(k); }

  // ── Filters ──────────────────────────────────────────────────────────────
  const PRESETS = [['mtd', 'Month to date'], ['prev', 'Last month'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['ytd', 'Year to date'], ['12m', 'Last 12 months'], ['24m', 'Last 24 months'], ['custom', 'Custom']];
  function meta() { const c = LC[API + 'meta']; return c && c.status === 'ok' ? c.data : null; }
  function applyPreset(p) {
    const M = meta(); if (!M) return;
    const T = M.dataThrough, first = M.dataFrom;
    let from = F.from, to = T;
    if (p === 'mtd') from = T.slice(0, 8) + '01';
    else if (p === 'prev') { to = addDays(T.slice(0, 8) + '01', -1); from = to.slice(0, 8) + '01'; }
    else if (p === '30') from = addDays(T, -29);
    else if (p === '90') from = addDays(T, -89);
    else if (p === 'ytd') from = T.slice(0, 4) + '-01-01';
    else if (p === '12m') from = addDays(T, -364);
    else if (p === '24m') from = first;
    else { from = F.from || addDays(T, -89); to = F.to || T; }
    if (from < first) from = first;
    F.from = from; F.to = to;
  }
  function filterLabel() {
    const M = meta(), bits = [];
    if (F.market) bits.push(F.market);
    if (F.project) { const p = M && M.projects.find((x) => x.project_id === F.project); bits.push(p ? p.project : F.project); }
    if (F.channel) bits.push(F.channel);
    return bits.length ? bits.join(' · ') : 'All markets, projects and channels';
  }
  function renderTopbar() {
    const M = meta(), tb = $('topbar');
    if (!SESSION.allowed || !M) { tb.innerHTML = ''; return; }
    const projects = M.projects.filter((p) => !F.market || p.market === F.market);
    const chans = M.channels.filter((c) => !F.market || (c.markets || []).indexOf(F.market) >= 0);
    const stores = chans.filter((c) => c.channel !== 'Online' && c.channel !== 'B2B');
    const opt = (v, l, sel) => '<option value="' + esc(v) + '"' + (sel ? ' selected' : '') + '>' + esc(l) + '</option>';
    const dated = route !== 'alerts';
    tb.innerHTML =
      (dated ? '<label class="f"><span>Period</span><select class="select" data-chg="preset" data-fid="f-preset">' + PRESETS.map((p) => opt(p[0], p[1], PREF.preset === p[0])).join('') + '</select></label>' +
        '<label class="f"><span>From</span><input type="date" data-chg="from" data-fid="f-from" value="' + esc(F.from) + '" min="' + esc(M.dataFrom) + '" max="' + esc(M.dataThrough) + '"></label>' +
        '<label class="f"><span>To</span><input type="date" data-chg="to" data-fid="f-to" value="' + esc(F.to) + '" min="' + esc(M.dataFrom) + '" max="' + esc(M.dataThrough) + '"></label>' : '') +
      '<label class="f"><span>Market</span><select class="select" data-chg="market" data-fid="f-market">' + opt('', 'All markets', !F.market) + M.markets.map((m) => opt(m, m, F.market === m)).join('') + '</select></label>' +
      '<label class="f wide"><span>Project / shop</span><select class="select" data-chg="project" data-fid="f-project">' + opt('', 'All projects', !F.project) + projects.map((p) => opt(p.project_id, p.project + ' (' + p.market + ')', F.project === p.project_id)).join('') + '</select></label>' +
      '<label class="f wide"><span>Channel</span><select class="select" data-chg="channel" data-fid="f-channel">' + opt('', 'All channels', !F.channel) +
        chans.filter((c) => c.channel === 'Online' || c.channel === 'B2B').map((c) => opt(c.channel, c.channel, F.channel === c.channel)).join('') +
        (stores.length ? opt('All stores', 'All stores', F.channel === 'All stores') + '<optgroup label="Stores">' + stores.map((c) => opt(c.channel, c.channel, F.channel === c.channel)).join('') + '</optgroup>' : '') + '</select></label>' +
      '<span class="grow"></span><span class="fresh">Data through ' + fdate(M.dataThrough) + '</span>';
  }

  // ── Navigation & chrome ──────────────────────────────────────────────────
  const NAV = [['overview', '#/', 'Overview', 'home'], ['codes', '#/codes', 'Discount codes', 'tag'], ['pricelists', '#/pricelists', 'Price lists & projects', 'list'],
    ['brands', '#/brands', 'Brands & categories', 'box'], ['alerts', '#/alerts', 'Daily alerts', 'bell']];
  function renderNav() {
    const nav = $('nav');
    nav.innerHTML = SESSION.allowed ? NAV.map((n) => '<a href="' + n[1] + '"' + (route === n[0] ? ' aria-current="page"' : '') + '><svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + IC[n[3]] + '"/></svg><span>' + esc(n[2]) + '</span></a>').join('') : '';
    const M = meta();
    $('sideFoot').innerHTML = SESSION.allowed
      ? '<span class="live-pill"><i aria-hidden="true"></i>Live data' + (M ? ' · through ' + fdate(M.dataThrough) : '') + '</span>' +
        '<span class="demo-pill" style="background:var(--fill)">Signed in as ' + esc(SESSION.email || '') + '. Numbers stay in this page only.</span>'
      : '';
  }
  function parseRoute() {
    const h = (location.hash || '#/').replace(/^#\/?/, '').split('?')[0];
    route = ['codes', 'pricelists', 'brands', 'alerts'].indexOf(h) >= 0 ? h : 'overview';
  }

  // ── Gate (signed out / not on the list) ──────────────────────────────────
  function gate() {
    const who = SESSION.signedIn
      ? '<p class="notice warn" role="alert" style="margin-top:16px">' + ic('lock') + '<span>Your account <b>' + esc(SESSION.email || '') + '</b> is not on the list for live margin data. Ask Simon to add it, or sign in with another account.</span></p>' +
        '<div class="acts"><button type="button" class="btn" data-act="signin" data-fid="signin">Switch account</button></div>'
      : '<p class="notice" style="margin-top:16px">' + ic('lock') + '<span>Live data for approved accounts — sign in.</span></p>' +
        '<div class="acts"><button type="button" class="btn pri" data-act="signin" data-fid="signin">Sign in</button></div>';
    return '<div class="gate"><div class="card"><span class="eyebrow">Adrial Apps · live data</span><h1 tabindex="-1">Margin leak &amp; discount guard</h1>' +
      '<p class="sub">For the pricing lead and the CFO: see which discount codes, price lists, brands and projects lose margin, and catch negative-margin sales the morning after.</p>' +
      '<ul><li><b>Overview</b> — margin % trend, discounted vs undiscounted margin, negative-margin value and share, top leaks this month.</li>' +
      '<li><b>Discount codes</b> — revenue, orders and margin % per code, the gap to the no-code margin of the same shop and category, and the margin given away; codes under your threshold are flagged.</li>' +
      '<li><b>Price lists &amp; projects</b>, <b>Brands &amp; categories</b> — where negative-margin lines come from.</li>' +
      '<li><b>Daily alerts</b> — yesterday\'s negative-margin totals by code, brand and project against the usual day.</li></ul>' +
      '<p class="hint">Store- and shop-level totals only: no customers, orders or staff. Refreshed every morning from the sales data.</p>' + who + '</div></div>';
  }

  // ── Pages ────────────────────────────────────────────────────────────────
  const head = (title, sub, actions) => '<div class="head"><div><span class="eyebrow">Margin guard · ' + esc(filterLabel()) + '</span><h1 tabindex="-1">' + esc(title) + '</h1><p class="sub">' + sub + '</p></div>' + (actions ? '<div class="head-actions">' + actions + '</div>' : '') + '</div>';
  const period = () => fdate(F.from) + ' – ' + fdate(F.to);
  const kpi = (label, v, d, cls) => '<div class="kpi"><span class="label">' + esc(label) + '</span><span class="v">' + v + '</span>' + (d ? '<span class="d ' + (cls || '') + '"><i aria-hidden="true"></i>' + d + '</span>' : '') + '</div>';
  const mpct = (r) => div(r.margin, r.revenue);
  const negShare = (r) => div(r.neg_lines, r.lines);

  function pageOverview() {
    const ov = lget(aurl('overview'));
    const mfrom = F.to.slice(0, 8) + '01';
    const cm = lget(API + 'codes' + qs(Object.assign(fp(), { from: mfrom, to: F.to })));
    let h = head('Overview', 'Sales and margin, ' + esc(period()) + '. Amounts in EUR, net of credit notes.');
    const w = wait([ov], 'the overview'); if (w) return h + w;
    const d = ov.data, days = d.days, ly = d.lastYear || {};
    const t = days.reduce((a, x) => { Object.keys(x).forEach((k) => { if (k !== 'date') a[k] = (a[k] || 0) + (x[k] || 0); }); return a; }, {});
    const m = div(t.margin, t.revenue), lym = div(ly.margin, ly.revenue);
    const nc = div(t.margin - t.disc_margin, t.revenue - t.disc_revenue), wc = div(t.disc_margin, t.disc_revenue);
    const lyFull = ly.first_day && ly.first_day <= addDays(ly.from, 3);
    h += '<div class="kpis">' +
      kpi('Revenue', eurK(t.revenue), ly.revenue ? sgnPct(div(t.revenue, ly.revenue) - 1) + ' vs last year' : 'no data a year ago', '') +
      kpi('Margin', eurK(t.margin), 'Margin % ' + pct(m)) +
      kpi('Margin % vs last year', pct(m), lym != null ? pp(m - lym) + ' (was ' + pct(lym) + ')' + (lyFull ? '' : ' · partial year') : 'no data a year ago', lym == null ? '' : m >= lym ? 'pos' : 'neg') +
      kpi('Without a code', pct(nc), eurK(t.revenue - t.disc_revenue) + ' revenue') +
      kpi('With a code', pct(wc), (nc != null && wc != null ? pp(wc - nc) + ' vs no code · ' : '') + pct(div(t.disc_revenue, t.revenue)) + ' of revenue', wc != null && nc != null && wc < nc ? 'neg' : '') +
      kpi('Lost on negative-margin lines', eurK(-t.neg_margin), pct(negShare(t)) + ' of lines (' + num(t.neg_lines) + ')', t.neg_margin < 0 ? 'neg' : '') +
      '</div>';

    // trend
    const b = bucketOf(daysBetween(F.from, F.to) + 1), bk = {}, order = [];
    days.forEach((x) => { const k = bucketKey(x.date, b); if (!bk[k]) { bk[k] = { k: k, revenue: 0, margin: 0, disc_revenue: 0, disc_margin: 0, lines: 0, neg_lines: 0, neg_margin: 0 }; order.push(k); } const o = bk[k]; Object.keys(o).forEach((f) => { if (f !== 'k') o[f] += x[f] || 0; }); });
    const B = order.map((k) => bk[k]), labels = B.map((x) => bucketLabel(x.k, b));
    const sAll = B.map((x) => div(x.margin, x.revenue)), sNo = B.map((x) => div(x.margin - x.disc_margin, x.revenue - x.disc_revenue)), sCode = B.map((x) => div(x.disc_margin, x.disc_revenue));
    const C1 = 'var(--c1)', C2 = 'var(--c2)', C3 = 'var(--c3)';
    const bname = { day: 'day', week: 'week (from Monday)', month: 'month' }[b];
    const tipD = (i) => '<b>' + esc(b === 'month' ? fmon(B[i].k) : b === 'week' ? 'Week from ' + fdate(B[i].k) : WD[dow(B[i].k)] + ' ' + fdate(B[i].k)) + '</b>';
    h += '<div class="cols2" style="margin-top:0">' +
      '<section class="card" aria-labelledby="h-trend"><div class="card-h"><div><span class="label">By ' + bname + '</span><h2 id="h-trend">Margin % over time</h2></div>' + csvBtn('trend') + '</div><div class="card-b">' +
      legend([['All sales', C1], ['No code', C2], ['With a code', C3]]) +
      lineChart('trend', labels, [{ values: sAll, color: C1 }, { values: sNo, color: C2 }, { values: sCode, color: C3 }],
        { fy: (v) => NF0.format(v * 100) + ' %', aria: 'Margin % by ' + b + ': all sales, no code and with a code', tip: (i) => tipD(i) + tipRow(C1, 'All sales', pct(sAll[i])) + tipRow(C2, 'No code', pct(sNo[i])) + tipRow(C3, 'With a code', pct(sCode[i])) + tipRow('', 'Revenue', eur(B[i].revenue)) }) +
      '</div></section>' +
      '<section class="card" aria-labelledby="h-neg"><div class="card-h"><div><span class="label">By ' + bname + '</span><h2 id="h-neg">Lost on negative-margin lines</h2></div></div><div class="card-b">' +
      barChart('neg', labels, B.map((x) => -x.neg_margin), { fy: (v) => eurK(v), aria: 'Margin lost on negative-margin lines by ' + b, empty: 'No negative-margin lines in this period.',
        tip: (i) => tipD(i) + tipRow('var(--bad-dot)', 'Lost', eur(-B[i].neg_margin)) + tipRow('', 'Negative lines', num(B[i].neg_lines) + ' (' + pct(div(B[i].neg_lines, B[i].lines)) + ')') }) +
      '<p class="chart-note">A line is one item sold on one day in one shop, code and price list; credit notes are left out of the count.</p></div></section></div>';
    CSV.trend = { name: 'trend-' + F.from + '_' + F.to, header: ['Period start', 'Revenue EUR', 'Margin EUR', 'Margin %', 'No-code margin %', 'With-code margin %', 'Revenue with a code EUR', 'Lines', 'Negative-margin lines', 'Lost on negative lines EUR'],
      rows: B.map((x, i) => [x.k.length === 7 ? x.k + '-01' : x.k, r2(x.revenue), r2(x.margin), p100(sAll[i]), p100(sNo[i]), p100(sCode[i]), r2(x.disc_revenue), x.lines, x.neg_lines, r2(-x.neg_margin)]) };

    // leaks this month
    const LD = [['code', 'Discount code'], ['brand', 'Brand'], ['category', 'Category'], ['pricelist', 'Price list'], ['project', 'Project'], ['channel', 'Channel']];
    const dim = LD.find((x) => x[0] === PREF.leakDim) || LD[0];
    const leaks = d.leaks.filter((x) => x.dim === dim[0]);
    h += '<section class="card" aria-labelledby="h-leaks" style="margin-top:14px"><div class="card-h"><div><span class="label">' + fdate(d.leakWindow.from) + ' – ' + fdate(d.leakWindow.to) + '</span><h2 id="h-leaks">Top leaks this month</h2></div>' + csvBtn('leaks') + '</div>' +
      '<div class="ctrls"><div class="seg" role="group" aria-label="Leaks by">' + LD.map((x) => '<button type="button" data-act="leakDim" data-v="' + x[0] + '" data-fid="ld-' + x[0] + '" aria-pressed="' + (dim[0] === x[0]) + '">' + x[1] + '</button>').join('') + '</div></div>' +
      table('leaks', [
        { k: 'name', label: dim[1], v: (r) => r.name, h: (r) => '<b>' + esc(nm(r.name)) + '</b>' },
        { k: 'neg_margin', label: 'Lost', num: true, v: (r) => r.neg_margin, h: (r) => eur(-r.neg_margin), csv: (r) => r2(-r.neg_margin), csvLabel: 'Lost on negative lines EUR' },
        { k: 'neg_lines', label: 'Negative lines', num: true, v: (r) => r.neg_lines, h: (r) => num(r.neg_lines) },
        { k: 'share', label: 'Share of lines', num: true, v: negShare, h: (r) => pct(negShare(r)), csv: (r) => p100(negShare(r)) },
        { k: 'revenue', label: 'Revenue', num: true, h: (r) => eur(r.revenue), csv: (r) => r2(r.revenue), csvLabel: 'Revenue EUR' },
        { k: 'mpct', label: 'Margin %', num: true, v: mpct, h: (r) => pct(mpct(r)), csv: (r) => p100(mpct(r)) },
      ], leaks, { sort: { k: 'neg_margin', dir: 1 }, csv: 'leaks-' + dim[0] + '-' + d.leakWindow.from + '_' + d.leakWindow.to, empty: 'No negative-margin lines this month.', caption: 'Top leaks this month by ' + dim[1] }) + '</section>';

    // codes giving away most this month
    h += '<section class="card" aria-labelledby="h-give" style="margin-top:14px"><div class="card-h"><div><span class="label">Month to date · vs the no-code margin of the same project and category</span><h2 id="h-give">Codes giving away the most margin</h2></div><a class="btn sm" href="#/codes">All codes</a></div><div class="card-b">';
    const cw = wait([cm], 'codes');
    if (cw) h += cw;
    else {
      const rows = cm.data.rows.filter((r) => r.code !== '(none)').map((r) => Object.assign({}, r, { given: r.expected_margin - r.margin })).filter((r) => r.given > 0).sort((a, b2) => b2.given - a.given).slice(0, 8);
      const max = rows.length ? rows[0].given : 1;
      h += rows.length ? '<ul class="list">' + rows.map((r) => '<li><div class="l"><button type="button" class="linkish" data-act="code" data-v="' + esc(r.code) + '" data-fid="give-' + esc(r.code) + '">' + esc(r.code) + '</button><small>' + esc(codeDesc(r.code)) + ' · margin ' + pct(mpct(r)) + ' vs ' + pct(div(r.expected_margin, r.revenue)) + ' without a code</small><div class="bar warn"><i style="width:' + Math.max(2, r.given / max * 100) + '%"></i></div></div><div class="r">' + eur(r.given) + '<small class="cell-sub">' + eurK(r.revenue) + ' revenue</small></div></li>').join('') + '</ul>'
        : '<div class="empty">No code is below its no-code baseline this month.</div>';
    }
    return h + '</div></section>';
  }

  function codeInfo(code) { const M = meta(); return (M && M.codes.find((c) => c.code === code)) || null; }
  function codeDesc(code) { const c = codeInfo(code); return c ? (c.description || c.kind) : ''; }
  const nm = (s) => (s === '(none)' ? 'No code' : s);

  function codeRows(data) {
    return data.rows.map((r) => {
      const info = codeInfo(r.code) || {};
      const base = div(r.expected_margin, r.revenue), mp = mpct(r);
      const isBase = r.code === '(none)';
      const flag = !isBase && r.revenue >= PREF.minRev && fin(mp) && (mp * 100 < PREF.minPct || (fin(base) && (mp - base) * 100 < -PREF.maxGap));
      return Object.assign({}, r, { kind: info.kind || 'Discount', description: info.description || '', base: base, gap: isBase ? null : fin(mp) && fin(base) ? mp - base : null, given: isBase ? 0 : r.expected_margin - r.margin, flag: flag, isBase: isBase });
    });
  }
  function pageCodes() {
    const c = lget(aurl('codes'));
    const acts = csvBtn('codes');
    let h = head('Discount codes', 'Each code against the margin the same shops and categories make without a code, ' + esc(period()) + '.', acts);
    const w = wait([c], 'discount codes'); if (w) return h + w;
    const all = codeRows(c.data);
    const used = all.filter((r) => !r.isBase);
    const tot = all.reduce((a, r) => { a.rev += r.revenue; return a; }, { rev: 0 });
    const codeRev = used.reduce((a, r) => a + r.revenue, 0), codeMar = used.reduce((a, r) => a + r.margin, 0), given = used.reduce((a, r) => a + Math.max(0, r.given), 0), givenNet = used.reduce((a, r) => a + r.given, 0);
    const base = all.find((r) => r.isBase), flagged = used.filter((r) => r.flag);
    h += '<div class="kpis">' +
      kpi('Revenue with a code', eurK(codeRev), pct(div(codeRev, tot.rev)) + ' of all revenue') +
      kpi('Margin % with a code', pct(div(codeMar, codeRev)), base ? 'No code: ' + pct(mpct(base)) : '') +
      kpi('Margin given away', eurK(given), 'by codes under their no-code margin · net of codes above it ' + eurK(givenNet), given > 0 ? 'neg' : 'pos') +
      kpi('Flagged codes', num(flagged.length), 'of ' + num(used.length) + ' codes used', flagged.length ? 'neg' : 'pos') + '</div>';
    const SHOW = [['all', 'All'], ['flag', 'Flagged'], ['Discount', 'Discounts'], ['Free delivery', 'Free delivery']];
    let rows = all;
    if (PREF.codeShow === 'flag') rows = all.filter((r) => r.flag || r.isBase);
    else if (PREF.codeShow !== 'all') rows = all.filter((r) => r.kind === PREF.codeShow || r.isBase);
    const qv = (SEARCH.codes || '').trim().toLowerCase();
    if (qv) rows = rows.filter((r) => r.isBase || (r.code + ' ' + r.description).toLowerCase().indexOf(qv) >= 0);
    h += '<section class="card" aria-labelledby="h-codes"><div class="card-h"><div><span class="label">' + esc(period()) + '</span><h2 id="h-codes">Codes</h2></div></div>' +
      '<div class="ctrls">' +
      '<div class="grp"><span class="label">Show</span><div class="seg" role="group" aria-label="Show">' + SHOW.map((x) => '<button type="button" data-act="codeShow" data-v="' + x[0] + '" data-fid="cs-' + x[0].replace(/\s/g, '') + '" aria-pressed="' + (PREF.codeShow === x[0]) + '">' + x[1] + '</button>').join('') + '</div></div>' +
      '<label class="grp"><span class="label">Flag margin below</span><span><input class="num-in" type="number" min="-100" max="100" step="1" data-chg="minPct" data-fid="t-minPct" value="' + PREF.minPct + '"> %</span></label>' +
      '<label class="grp"><span class="label">or below no-code by</span><span><input class="num-in" type="number" min="0" max="100" step="1" data-chg="maxGap" data-fid="t-maxGap" value="' + PREF.maxGap + '"> pp</span></label>' +
      '<label class="grp"><span class="label">Only codes with revenue over</span><span><input class="num-in" type="number" min="0" step="100" data-chg="minRev" data-fid="t-minRev" value="' + PREF.minRev + '"> €</span></label>' +
      '<label class="grp" style="flex:1 1 200px"><span class="label">Search</span><input class="search" type="search" placeholder="Code or description" data-inp="codes" data-fid="s-codes" value="' + esc(SEARCH.codes || '') + '"></label></div>' +
      table('codes', [
        { k: 'code', label: 'Code', v: (r) => r.code, h: (r) => (r.isBase ? '<b>No code</b><small>baseline</small>' : '<button type="button" class="rowbtn" data-act="code" data-v="' + esc(r.code) + '" data-fid="code-' + esc(r.code) + '">' + esc(r.code) + '</button><small>' + esc(r.description ? r.kind + ' · ' + r.description : r.kind) + '</small>'), csv: (r) => nm(r.code) },
        { k: 'flag', label: 'Status', v: (r) => (r.isBase ? -1 : r.flag ? 1 : 0), h: (r) => (r.isBase ? '' : r.flag ? badge('bad', 'Below threshold') : badge('good', 'OK')), csv: (r) => (r.isBase ? 'baseline' : r.flag ? 'flagged' : 'ok') },
        { k: 'revenue', label: 'Revenue', num: true, h: (r) => eur(r.revenue), csv: (r) => r2(r.revenue), csvLabel: 'Revenue EUR' },
        { k: 'orders', label: 'Orders', num: true, h: (r) => num(r.orders) },
        { k: 'margin', label: 'Margin', num: true, h: (r) => eur(r.margin), csv: (r) => r2(r.margin), csvLabel: 'Margin EUR' },
        { k: 'mpct', label: 'Margin %', num: true, v: mpct, h: (r) => pct(mpct(r)), csv: (r) => p100(mpct(r)) },
        { k: 'base', label: 'No-code %', num: true, v: (r) => (r.isBase ? null : r.base), h: (r) => (r.isBase ? '' : pct(r.base)), csv: (r) => (r.isBase ? '' : p100(r.base)), csvLabel: 'No-code margin % (same project+category)' },
        { k: 'gap', label: 'Gap', num: true, v: (r) => r.gap, h: (r) => (r.gap == null ? '' : '<span class="' + (r.gap < 0 ? 'neg' : 'pos') + '">' + pp(r.gap) + '</span>'), csv: (r) => p100(r.gap), csvLabel: 'Gap pp' },
        { k: 'given', label: 'Given away', num: true, v: (r) => (r.isBase ? null : r.given), h: (r) => (r.isBase ? '' : eur(r.given)), csv: (r) => (r.isBase ? '' : r2(r.given)), csvLabel: 'Margin given away EUR' },
        { k: 'neg', label: 'Neg. lines', num: true, v: negShare, h: (r) => pct(negShare(r)) + '<small>' + num(r.neg_lines) + '</small>', csv: (r) => r.neg_lines, csvLabel: 'Negative-margin lines' },
        { k: 'units', label: 'Units', num: true, h: (r) => num(r.units), csv: (r) => r2(r.units) },
      ], rows, { sort: { k: 'revenue', dir: -1 }, pin: (r) => r.isBase, rowCls: (r) => (r.isBase ? 'base' : r.flag ? 'flag' : ''), csv: 'codes-' + F.from + '_' + F.to, caption: 'Discount codes', empty: 'No code matches.' }) +
      '<div class="card-foot">No-code % is what the same projects and categories earned without a code in this period, weighted by this code\'s revenue. Given away = that margin minus the code\'s margin. Free-delivery codes give the discount on shipping, so their gap comes from the product mix. Orders count invoiced orders with the code.</div></section>';
    return h;
  }

  function drawerBody() {
    const code = drawerCode;
    const c = lget(aurl('code', { code: code }));
    const info = codeInfo(code) || {};
    let b = '<p class="desc">' + esc(info.kind || '') + (info.description ? ' · ' + esc(info.description) : '') + '</p>' +
      '<p class="hint" style="margin-top:6px">First used ' + fdate(info.first_used) + ' · last used ' + fdate(info.last_used) + ' · ' + num(info.projects) + ' project' + (info.projects === 1 ? '' : 's') + ' · ' + esc(period()) + '</p>';
    const w = wait([c], 'the code'); if (w) return b + w;
    const rows = c.data.rows, months = c.data.months;
    const t = rows.reduce((a, r) => { a.revenue += r.revenue; a.margin += r.margin; a.exp += fin(r.base_pct) ? r.revenue * r.base_pct : 0; a.expRev += fin(r.base_pct) ? r.revenue : 0; a.neg += r.neg_margin; return a; }, { revenue: 0, margin: 0, exp: 0, expRev: 0, neg: 0 });
    b += '<div class="minis"><div class="mini"><span>Revenue</span><b>' + eurK(t.revenue) + '</b></div><div class="mini"><span>Margin %</span><b>' + pct(div(t.margin, t.revenue)) + '</b></div>' +
      '<div class="mini"><span>No-code %</span><b>' + pct(div(t.exp, t.expRev)) + '</b></div></div>';
    b += '<h3>By month</h3>' + table('cm', [
      { k: 'month', label: 'Month', v: (r) => r.month, h: (r) => esc(fmon(r.month)) },
      { k: 'revenue', label: 'Revenue', num: true, h: (r) => eur(r.revenue), csv: (r) => r2(r.revenue) },
      { k: 'mpct', label: 'Margin %', num: true, v: mpct, h: (r) => pct(mpct(r)), csv: (r) => p100(mpct(r)) },
      { k: 'neg_margin', label: 'Lost', num: true, h: (r) => eur(-r.neg_margin), csv: (r) => r2(-r.neg_margin) },
    ], months, { sort: { k: 'month', dir: 1 }, limit: 30, csv: 'code-months' });
    b += '<h3>By project and category</h3>' + table('cp', [
      { k: 'project', label: 'Project · category', v: (r) => r.project + ' ' + r.category, h: (r) => esc(r.project) + '<small>' + esc(r.category) + '</small>', csv: (r) => r.project + ' / ' + r.category },
      { k: 'revenue', label: 'Revenue', num: true, h: (r) => eur(r.revenue), csv: (r) => r2(r.revenue) },
      { k: 'mpct', label: 'Margin %', num: true, v: mpct, h: (r) => pct(mpct(r)), csv: (r) => p100(mpct(r)) },
      { k: 'base_pct', label: 'No-code %', num: true, h: (r) => pct(r.base_pct), csv: (r) => p100(r.base_pct) },
      { k: 'gap', label: 'Gap', num: true, v: (r) => (fin(r.base_pct) && fin(mpct(r)) ? mpct(r) - r.base_pct : null), h: (r) => (fin(r.base_pct) && fin(mpct(r)) ? '<span class="' + (mpct(r) < r.base_pct ? 'neg' : 'pos') + '">' + pp(mpct(r) - r.base_pct) + '</span>' : '—'), csv: (r) => (fin(r.base_pct) ? r2((mpct(r) - r.base_pct) * 100) : '') },
    ], rows, { sort: { k: 'revenue', dir: -1 }, limit: 40, csv: 'code-projects' });
    return b;
  }
  function openCode(code) {
    drawerCode = code;
    const id = 'dh' + (++uid);
    openLayer('<aside class="drawer wide" role="dialog" aria-modal="true" aria-labelledby="' + id + '" tabindex="-1"><div class="dr-head"><div style="min-width:0"><span class="eyebrow">Discount code</span><h2 id="' + id + '">' + esc(code) + '</h2></div>' +
      '<button type="button" class="btn icon sm ghost" data-close aria-label="Close panel" data-fid="dr-close">' + ic('x') + '</button></div><div class="dr-body" id="drBody">' + drawerBody() + '</div></aside>', () => { drawerCode = null; });
    $('layers').querySelector('.drawer [data-close]').focus();
  }

  function aggBy(rows, keyFn, extra) {
    const m = {}, out = [];
    rows.forEach((r) => {
      const k = keyFn(r);
      let o = m[k];
      if (!o) { o = m[k] = Object.assign({ key: k, revenue: 0, cost: 0, margin: 0, units: 0, lines: 0, neg_lines: 0, neg_margin: 0, neg_revenue: 0, disc_revenue: 0, disc_margin: 0, ly_revenue: 0, ly_margin: 0 }, extra ? extra(r) : {}); out.push(o); }
      ['revenue', 'cost', 'margin', 'units', 'lines', 'neg_lines', 'neg_margin', 'neg_revenue', 'disc_revenue', 'disc_margin', 'ly_revenue', 'ly_margin'].forEach((f) => { o[f] += r[f] || 0; });
    });
    return out;
  }
  const COMMON = [
    { k: 'revenue', label: 'Revenue', num: true, h: (r) => eur(r.revenue), csv: (r) => r2(r.revenue), csvLabel: 'Revenue EUR' },
    { k: 'margin', label: 'Margin', num: true, h: (r) => eur(r.margin), csv: (r) => r2(r.margin), csvLabel: 'Margin EUR' },
    { k: 'mpct', label: 'Margin %', num: true, v: mpct, h: (r) => pct(mpct(r)), csv: (r) => p100(mpct(r)) },
    { k: 'dshare', label: 'With a code', num: true, v: (r) => div(r.disc_revenue, r.revenue), h: (r) => pct(div(r.disc_revenue, r.revenue)) + '<small>' + pct(div(r.disc_margin, r.disc_revenue)) + ' margin</small>', csv: (r) => p100(div(r.disc_revenue, r.revenue)), csvLabel: 'Revenue with a code %' },
    { k: 'neg', label: 'Neg. lines', num: true, v: negShare, h: (r) => pct(negShare(r)) + '<small>' + num(r.neg_lines) + '</small>', csv: (r) => r.neg_lines, csvLabel: 'Negative-margin lines' },
    { k: 'neg_margin', label: 'Lost', num: true, v: (r) => r.neg_margin, h: (r) => eur(-r.neg_margin), csv: (r) => r2(-r.neg_margin), csvLabel: 'Lost on negative lines EUR' },
  ];
  function pagePricelists() {
    const c = lget(aurl('pricelists'));
    let h = head('Price lists & projects', 'Margin by price list and by project (web shop), ' + esc(period()) + '.');
    const w = wait([c], 'price lists'); if (w) return h + w;
    const rows = c.data.rows;
    const pl = aggBy(rows, (r) => r.pricelist), pj = aggBy(rows, (r) => r.project_id, (r) => ({ project: r.project, market: r.market, owner_group: r.owner_group }));
    h += '<div class="cols2" style="margin-top:0">' +
      '<section class="card" aria-labelledby="h-pl"><div class="card-h"><h2 id="h-pl">By price list</h2>' + csvBtn('pl') + '</div>' +
      table('pl', [{ k: 'key', label: 'Price list', v: (r) => r.key, h: (r) => '<b>' + esc(r.key) + '</b>' }].concat(COMMON), pl, { sort: { k: 'revenue', dir: -1 }, csv: 'pricelists-' + F.from + '_' + F.to, caption: 'Margin by price list' }) + '</section>' +
      '<section class="card" aria-labelledby="h-pj"><div class="card-h"><h2 id="h-pj">By project</h2>' + csvBtn('pj') + '</div>' +
      table('pj', [{ k: 'project', label: 'Project', v: (r) => r.project, h: (r) => '<b>' + esc(r.project) + '</b><small>' + esc(r.market + ' · ' + r.owner_group) + '</small>', csv: (r) => r.project }].concat(COMMON), pj, { sort: { k: 'revenue', dir: -1 }, csv: 'projects-' + F.from + '_' + F.to, caption: 'Margin by project' }) + '</section></div>';
    let rr = rows;
    const qv = (SEARCH.plx || '').trim().toLowerCase();
    if (qv) rr = rows.filter((r) => (r.project + ' ' + r.pricelist + ' ' + r.market).toLowerCase().indexOf(qv) >= 0);
    h += '<section class="card" aria-labelledby="h-plx" style="margin-top:14px"><div class="card-h"><div><span class="label">Every project and price list</span><h2 id="h-plx">Project × price list</h2></div>' + csvBtn('plx') + '</div>' +
      '<div class="ctrls"><label class="grp" style="flex:1 1 220px"><span class="label">Search</span><input class="search" type="search" placeholder="Project, price list or market" data-inp="plx" data-fid="s-plx" value="' + esc(SEARCH.plx || '') + '"></label></div>' +
      table('plx', [{ k: 'project', label: 'Project · price list', v: (r) => r.project + ' ' + r.pricelist, h: (r) => '<b>' + esc(r.project) + '</b><small>' + esc(r.pricelist + ' · ' + r.market) + '</small>', csv: (r) => r.project }, { k: 'pricelist', label: 'Price list', v: (r) => r.pricelist }].concat(COMMON),
        rr, { sort: { k: 'neg_margin', dir: 1 }, csv: 'project-pricelist-' + F.from + '_' + F.to, caption: 'Margin by project and price list', empty: 'Nothing matches.' }) + '</section>';
    return h;
  }

  function pageBrands() {
    const c = lget(aurl('brands'));
    let h = head('Brands & categories', 'Where negative-margin lines come from, ' + esc(period()) + ', with the same period a year earlier.');
    const w = wait([c], 'brands'); if (w) return h + w;
    const rows = c.data.rows, ly = c.data.lastYear;
    const LYC = { k: 'ly', label: 'vs last year', num: true, v: (r) => (r.ly_revenue ? mpct(r) - div(r.ly_margin, r.ly_revenue) : null), h: (r) => (r.ly_revenue > 0 && fin(mpct(r)) ? '<span class="' + (mpct(r) < div(r.ly_margin, r.ly_revenue) ? 'neg' : 'pos') + '">' + pp(mpct(r) - div(r.ly_margin, r.ly_revenue)) + '</span><small>was ' + pct(div(r.ly_margin, r.ly_revenue)) + '</small>' : '—'), csv: (r) => (r.ly_revenue ? p100(div(r.ly_margin, r.ly_revenue)) : ''), csvLabel: 'Margin % last year' };
    const NEGREV = { k: 'neg_revenue', label: 'Neg. revenue', num: true, h: (r) => eur(r.neg_revenue), csv: (r) => r2(r.neg_revenue), csvLabel: 'Revenue on negative lines EUR' };
    const cat = aggBy(rows, (r) => r.category);
    const t = cat.reduce((a, r) => { a.neg += r.neg_margin; a.lines += r.lines; a.nl += r.neg_lines; return a; }, { neg: 0, lines: 0, nl: 0 });
    const brandsAll = new Set(rows.filter((r) => r.revenue || r.lines).map((r) => r.brand)), brandsNeg = new Set(rows.filter((r) => r.neg_lines > 0).map((r) => r.brand));
    const lyNeg = rows.reduce((a, r) => a + (r.ly_neg_margin || 0), 0);
    h += '<div class="kpis">' + kpi('Lost on negative-margin lines', eurK(-t.neg), pct(div(t.nl, t.lines)) + ' of lines', t.neg < 0 ? 'neg' : '') +
      kpi('Brands with negative lines', num(brandsNeg.size), 'of ' + num(brandsAll.size) + ' brands sold') +
      kpi('Lost a year earlier', eurK(-lyNeg), fdate(ly.from) + ' – ' + fdate(ly.to), lyNeg < t.neg ? 'pos' : 'neg') + '</div>';
    h += '<section class="card" aria-labelledby="h-cat"><div class="card-h"><h2 id="h-cat">Categories</h2>' + csvBtn('cat') + '</div>' +
      table('cat', [{ k: 'key', label: 'Category', v: (r) => r.key, h: (r) => '<b>' + esc(r.key) + '</b>' }].concat(COMMON.slice(0, 3), [LYC], COMMON.slice(3), [NEGREV]), cat, { sort: { k: 'neg_margin', dir: 1 }, csv: 'categories-' + F.from + '_' + F.to, caption: 'Margin by category' }) + '</section>';
    const grp = PREF.brandGroup === 'b' ? 'b' : 'bc';
    let br = grp === 'b' ? aggBy(rows, (r) => r.brand, (r) => ({ brand: r.brand, category: '' })) : rows.map((r) => Object.assign({}, r));
    if (PREF.negOnly) br = br.filter((r) => r.neg_lines > 0);
    const qv = (SEARCH.br || '').trim().toLowerCase();
    if (qv) br = br.filter((r) => (r.brand + ' ' + r.category).toLowerCase().indexOf(qv) >= 0);
    h += '<section class="card" aria-labelledby="h-br" style="margin-top:14px"><div class="card-h"><div><span class="label">Sorted by margin lost</span><h2 id="h-br">Brands</h2></div>' + csvBtn('br') + '</div>' +
      '<div class="ctrls"><div class="grp"><span class="label">Rows</span><div class="seg" role="group" aria-label="Rows">' +
      [['bc', 'Brand × category'], ['b', 'Brand']].map((x) => '<button type="button" data-act="brandGroup" data-v="' + x[0] + '" data-fid="bg-' + x[0] + '" aria-pressed="' + (grp === x[0]) + '">' + x[1] + '</button>').join('') + '</div></div>' +
      '<label class="grp check" style="flex-direction:row;align-items:center;min-height:36px"><input type="checkbox" data-chg="negOnly" data-fid="negOnly"' + (PREF.negOnly ? ' checked' : '') + '> Only with negative-margin lines</label>' +
      '<label class="grp" style="flex:1 1 200px"><span class="label">Search</span><input class="search" type="search" placeholder="Brand or category" data-inp="br" data-fid="s-br" value="' + esc(SEARCH.br || '') + '"></label></div>' +
      table('br', [{ k: 'brand', label: grp === 'b' ? 'Brand' : 'Brand · category', v: (r) => r.brand + ' ' + r.category, h: (r) => '<b>' + esc(r.brand) + '</b>' + (r.category ? '<small>' + esc(r.category) + '</small>' : ''), csv: (r) => r.brand }].concat(grp === 'b' ? [] : [{ k: 'category', label: 'Category', v: (r) => r.category }], COMMON.slice(0, 3), [LYC], COMMON.slice(3), [NEGREV]),
        br, { sort: { k: 'neg_margin', dir: 1 }, csv: 'brands-' + F.from + '_' + F.to, caption: 'Margin by brand', empty: 'No brand matches.' }) + '</section>';
    return h;
  }

  function pageAlerts() {
    const M = meta();
    if (!alertDay) alertDay = M.dataThrough;
    const c = lget(API + 'alerts' + qs({ day: alertDay, market: F.market, project: F.project, channel: F.channel }));
    const acts = '<button type="button" class="btn icon" data-act="day" data-v="-1" data-fid="day-prev" aria-label="Previous day"' + (alertDay <= M.dataFrom ? ' disabled' : '') + '>' + ic('back') + '</button>' +
      '<label class="sr" for="alertDay">Day</label><input id="alertDay" type="date" class="select" style="padding-right:14px;background-image:none" data-chg="alertDay" data-fid="alertDay" value="' + esc(alertDay) + '" min="' + esc(M.dataFrom) + '" max="' + esc(M.dataThrough) + '">' +
      '<button type="button" class="btn icon" data-act="day" data-v="1" data-fid="day-next" aria-label="Next day"' + (alertDay >= M.dataThrough ? ' disabled' : '') + '>' + ic('fwd') + '</button>' + csvBtn('alerts');
    let h = head('Daily alerts', 'Negative-margin sales on ' + WD[dow(alertDay)] + ' ' + fdate(alertDay) + (alertDay === M.dataThrough ? ' (the latest day)' : '') + ', against the 28 days before.', acts);
    const w = wait([c], 'the alerts'); if (w) return h + w;
    const d = c.data, days = d.days, today = days.find((x) => x.date === d.day) || { revenue: 0, margin: 0, lines: 0, neg_lines: 0, neg_margin: 0 };
    const prev = days.filter((x) => x.date !== d.day), avg = (f) => prev.reduce((a, x) => a + x[f], 0) / 28;
    const an = avg('neg_margin'), al = avg('neg_lines'), alines = avg('lines');
    const lvl = today.neg_margin < 1.5 * an && today.neg_margin < -100 ? 'bad' : today.neg_margin < an ? 'warn' : 'good';
    h += '<div class="kpis">' +
      kpi('Lost on negative-margin lines', eur(-today.neg_margin), 'usual day ' + eur(-an), lvl === 'good' ? 'pos' : 'neg') +
      kpi('Negative-margin lines', num(today.neg_lines), pct(div(today.neg_lines, today.lines)) + ' of lines · usual ' + pct(div(al, alines))) +
      kpi('Revenue', eurK(today.revenue), 'margin ' + pct(div(today.margin, today.revenue))) +
      '<div class="kpi"><span class="label">Status</span><span class="v" style="font-size:18px">' + badge(lvl, lvl === 'bad' ? 'Well above usual' : lvl === 'warn' ? 'Above usual' : 'Usual or better') + '</span><span class="d">vs the 28 days before</span></div></div>';
    const labels = days.map((x) => fdm(x.date));
    h += '<section class="card" aria-labelledby="h-29" style="margin-bottom:14px"><div class="card-h"><div><span class="label">29 days to ' + fdate(d.day) + '</span><h2 id="h-29">Lost per day</h2></div></div><div class="card-b">' +
      barChart('al', labels, days.map((x) => -x.neg_margin), { fy: (v) => eurK(v), aria: 'Margin lost on negative-margin lines per day', empty: 'No negative-margin lines in these days.',
        tip: (i) => '<b>' + WD[dow(days[i].date)] + ' ' + fdate(days[i].date) + '</b>' + tipRow('var(--bad-dot)', 'Lost', eur(-days[i].neg_margin)) + tipRow('', 'Negative lines', num(days[i].neg_lines)) + tipRow('', 'Revenue', eur(days[i].revenue)) }) + '</div></section>';
    const DIMS = [['code', 'Discount codes'], ['brand', 'Brands'], ['project', 'Projects'], ['pricelist', 'Price lists'], ['category', 'Categories'], ['channel', 'Channels']];
    const cols = (lab) => [
      { k: 'name', label: lab, v: (r) => r.name, h: (r) => '<b>' + esc(nm(r.name)) + '</b>' + (r.dim === 'code' && r.name !== '(none)' ? '<small>' + esc(codeDesc(r.name)) + '</small>' : '') },
      { k: 'neg_margin', label: 'Lost', num: true, v: (r) => r.neg_margin, h: (r) => eur(-r.neg_margin), csv: (r) => r2(-r.neg_margin), csvLabel: 'Lost EUR' },
      { k: 'usual', label: 'Usual day', num: true, v: (r) => r.avg_neg_margin, h: (r) => (r.avg_neg_margin < 0 ? eur(-r.avg_neg_margin) : '<span class="badge b-clay plain">New</span>'), csv: (r) => r2(-r.avg_neg_margin), csvLabel: 'Usual day (28-day average) EUR' },
      { k: 'neg_lines', label: 'Lines', num: true, h: (r) => num(r.neg_lines) + '<small>of ' + num(r.lines) + '</small>', csvLabel: 'Negative-margin lines' },
      { k: 'mpct', label: 'Margin %', num: true, v: mpct, h: (r) => pct(mpct(r)), csv: (r) => p100(mpct(r)) },
    ];
    h += '<div class="cols2" style="margin-top:0">' + DIMS.map((x) => {
      const rows = d.rows.filter((r) => r.dim === x[0]);
      return '<section class="card" aria-labelledby="h-a-' + x[0] + '"><div class="card-h"><h2 id="h-a-' + x[0] + '">' + x[1] + '</h2><span class="hint">' + num(rows.length) + (rows.length === 25 ? '+' : '') + ' with losses</span></div>' +
        table('a-' + x[0], cols(x[1].replace(/s$/, '').replace(/ie$/, 'y')), rows, { sort: { k: 'neg_margin', dir: 1 }, limit: 8, csv: 'alerts-' + x[0], empty: 'No negative-margin lines.', rowCls: (r) => (r.neg_margin < 2 * r.avg_neg_margin && r.neg_margin < -50 ? 'flag' : '') }) + '</section>';
    }).join('') + '</div>';
    CSV.alerts = { name: 'alerts-' + d.day, header: ['Day', 'Dimension', 'Name', 'Lost EUR', 'Usual day EUR', 'Negative-margin lines', 'Lines', 'Revenue EUR', 'Margin EUR'],
      rows: d.rows.map((r) => [d.day, r.dim, nm(r.name), r2(-r.neg_margin), r2(-r.avg_neg_margin), r.neg_lines, r.lines, r2(r.revenue), r2(r.margin)]) };
    h += '<p class="hint" style="margin-top:12px">Rows marked on the left lost more than twice their usual day. "New" = no negative-margin lines in the 28 days before.</p>';
    return h;
  }

  // ── Render ───────────────────────────────────────────────────────────────
  let lastRoute = null;
  function rerender() {
    withFocus(() => {
      parseRoute();
      renderNav();
      const page = $('page');
      if (!SESSION.checked) { $('topbar').innerHTML = ''; page.innerHTML = '<p class="loading" role="status"><i aria-hidden="true"></i>Checking access…</p>'; return; }
      if (!SESSION.allowed) {
        $('topbar').innerHTML = '';
        page.innerHTML = SESSION.failed ? '<div class="gate"><div class="card lerr" role="alert"><h2>Could not check your access</h2><p>The server could not be reached. Check the connection and try again.</p><div class="acts"><button type="button" class="btn" data-act="recheck" data-fid="recheck">' + ic('retry') + 'Try again</button></div></div></div>' : gate();
        return;
      }
      const mc = lget(API + 'meta');
      if (mc.status !== 'ok') { $('topbar').innerHTML = ''; page.innerHTML = wait([mc], 'margin data'); return; }
      if (!F.to) applyPreset(PREF.preset);
      renderTopbar();
      const fn = { overview: pageOverview, codes: pageCodes, pricelists: pagePricelists, brands: pageBrands, alerts: pageAlerts }[route];
      page.innerHTML = fn();
      if (drawerCode && $('drBody')) $('drBody').innerHTML = drawerBody();
    });
    if (lastRoute !== route) {
      lastRoute = route;
      document.title = ({ overview: 'Overview', codes: 'Discount codes', pricelists: 'Price lists & projects', brands: 'Brands & categories', alerts: 'Daily alerts' }[route]) + ' — Margin guard';
    }
  }
  window.addEventListener('hashchange', () => {
    setMenu(false); closeAll();
    rerender();
    const h1 = document.querySelector('#page h1'); if (h1) h1.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  });

  // ── Events ───────────────────────────────────────────────────────────────
  const ACT = {
    signin: () => { if (window.AdrialSync && window.AdrialSync.signIn) window.AdrialSync.signIn(); else toast('Sign-in is not available on this server.'); },
    recheck: () => { SESSION.checked = false; rerender(); checkSession(); },
    retry: () => { Object.keys(LC).forEach((k) => { if (LC[k].status === 'error') delete LC[k]; }); rerender(); },
    sort: (b) => {
      const t = b.getAttribute('data-t'), k = b.getAttribute('data-k'), th = b.closest('th'), on = th && th.getAttribute('aria-sort');
      SORT[t] = { k: k, dir: on ? (on === 'ascending' ? -1 : 1) : (k === 'neg_margin' || k === 'gap' || k === 'usual' ? 1 : -1) };
      rerender();
    },
    more: (b) => { SHOWALL[b.getAttribute('data-t')] = true; rerender(); },
    csv: (b) => { const c = CSV[b.getAttribute('data-t')]; if (c) downloadCsv(c.name, c.header, c.rows); else toast('The data is still loading.'); },
    leakDim: (b) => { PREF.leakDim = b.getAttribute('data-v'); savePref(); rerender(); },
    codeShow: (b) => { PREF.codeShow = b.getAttribute('data-v'); savePref(); rerender(); },
    brandGroup: (b) => { PREF.brandGroup = b.getAttribute('data-v'); savePref(); delete SORT.br; rerender(); },
    code: (b) => openCode(b.getAttribute('data-v')),
    day: (b) => { const M = meta(), n = addDays(alertDay, +b.getAttribute('data-v')); if (n >= M.dataFrom && n <= M.dataThrough) { alertDay = n; rerender(); } },
  };
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const fn = ACT[b.getAttribute('data-act')];
    if (fn) { e.preventDefault(); fn(b); }
  });
  const num0 = (v, lo, hi, def) => { const n = Number(v); return v === '' || !isFinite(n) ? def : Math.min(hi, Math.max(lo, n)); };
  document.addEventListener('change', (e) => {
    const el = e.target, k = el.getAttribute && el.getAttribute('data-chg');
    if (!k) return;
    const M = meta();
    if (k === 'preset') { PREF.preset = el.value; savePref(); applyPreset(el.value); }
    else if (k === 'from' || k === 'to') {
      const v = el.value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) { toast('Choose a date.'); rerender(); return; }
      F[k] = v < M.dataFrom ? M.dataFrom : v > M.dataThrough ? M.dataThrough : v;
      if (F.from > F.to) { if (k === 'from') F.to = F.from; else F.from = F.to; }
      PREF.preset = 'custom'; savePref();
    } else if (k === 'market') { F.market = el.value; const p = M.projects.find((x) => x.project_id === F.project); if (p && F.market && p.market !== F.market) F.project = ''; const ch = M.channels.find((x) => x.channel === F.channel); if (ch && F.market && (ch.markets || []).indexOf(F.market) < 0) F.channel = ''; }
    else if (k === 'project') F.project = el.value;
    else if (k === 'channel') F.channel = el.value;
    else if (k === 'minPct') { PREF.minPct = num0(el.value, -100, 100, 20); savePref(); }
    else if (k === 'maxGap') { PREF.maxGap = num0(el.value, 0, 100, 8); savePref(); }
    else if (k === 'minRev') { PREF.minRev = num0(el.value, 0, 1e9, 1000); savePref(); }
    else if (k === 'negOnly') { PREF.negOnly = el.checked; savePref(); }
    else if (k === 'alertDay') { const v = el.value; if (/^\d{4}-\d{2}-\d{2}$/.test(v) && v >= M.dataFrom && v <= M.dataThrough) alertDay = v; else toast('Choose a day between ' + fdate(M.dataFrom) + ' and ' + fdate(M.dataThrough) + '.'); }
    Object.keys(SHOWALL).forEach((x) => { delete SHOWALL[x]; });
    rerender();
  });
  let sTimer = null;
  document.addEventListener('input', (e) => {
    const k = e.target.getAttribute && e.target.getAttribute('data-inp');
    if (!k) return;
    SEARCH[k] = e.target.value;
    clearTimeout(sTimer);
    sTimer = setTimeout(() => {
      const el = document.activeElement, s = el && el.selectionStart;
      rerender();
      const n = document.querySelector('[data-inp="' + k + '"]');
      if (n && document.activeElement === n && s != null) { try { n.setSelectionRange(s, s); } catch (x) { /* not supported */ } }
    }, 200);
  });

  // ── Start ────────────────────────────────────────────────────────────────
  parseRoute();
  rerender();
  checkSession();
  watchAuth();
})();
