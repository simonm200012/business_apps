/* Parcels & COD: single-page app (demo mode only). */
(function () {
  'use strict';
  const D = window.ParcelsData, U = D.util, VERSION = D.VERSION;
  const CAR = {}, SHOP = {}, PERSON = {};
  D.CARRIERS.forEach(c => CAR[c.id] = c); D.SHOPS.forEach(s => SHOP[s.id] = s); D.TEAM.forEach(t => PERSON[t.id] = t);
  const $ = (s, r) => (r || document).querySelector(s), $$ = (s, r) => [].slice.call((r || document).querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const eur = x => (x < -0.004 ? '−' : '') + Math.abs(x).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  const fd = d => d ? (+d.slice(8, 10)) + '.' + (+d.slice(5, 7)) + '.' + d.slice(0, 4) : '';
  const fdt = t => fd(t) + ' ' + t.slice(11, 16);
  const r2 = U.r2;
  const nowLj = () => { const p = {}; new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Ljubljana', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).forEach(x => p[x.type] = x.value); return p.year + '-' + p.month + '-' + p.day + 'T' + p.hour + ':' + p.minute; };

  const STATUS_L = { created: 'Label created', transit: 'In transit', out: 'Out for delivery', failed: 'Delivery failed', pickup: 'Waiting for pickup', delivered: 'Delivered', returning: 'Returning', returned: 'Returned', damaged: 'Damaged', lost: 'Lost' };
  const STATUS_C = { created: 'mut', transit: '', out: '', failed: 'warn', pickup: 'warn', delivered: 'good', returning: 'warn', returned: 'bad', damaged: 'bad', lost: 'bad' };
  const ACTIVE = { created: 1, transit: 1, out: 1, failed: 1, pickup: 1 };
  const COD_L = { pending: 'Not delivered', collected: 'Collected by courier', overdue: 'Overdue', announced: 'In payout batch', paid: 'Paid', short: 'Paid short', paidret: 'Paid, but returned', void: 'Void' };
  const COD_C = { pending: 'mut', collected: '', overdue: 'bad', announced: '', paid: 'good', short: 'bad', paidret: 'warn', void: 'mut' };
  const RULES = [{ id: 'noscan', t: 'No scan' }, { id: 'failed', t: 'Failed attempt' }, { id: 'pickup', t: 'Not collected' }, { id: 'returned', t: 'Returned' }, { id: 'damlost', t: 'Damaged / lost' }, { id: 'manual', t: 'Added by hand' }];
  const ACTIONS = ['Contact carrier', 'Call customer', 'Send replacement', 'Wait for next scan', 'Request return', 'File claim', 'Refund customer'];
  const NOTES = ['Carrier says depot is backed up.', 'Customer asked to redeliver on Saturday.', 'Waiting for the carrier to confirm.', 'Customer informed by e-mail.', 'Photo of damage received.', 'Phone not answered, will retry tomorrow.'];

  let st, DATA, IX, TODAY, cache = {}, DR = null, MD = null, lastFocus = null;
  const SEL = new Set(), TBL = {};

  /* ---------- UI prefs ---------- */
  const UIK = 'adrial-parcels-ui';
  const uiDef = () => ({ f: {}, page: {}, sort: {}, tbl: {} });
  let ui = (() => { try { return Object.assign(uiDef(), JSON.parse(localStorage.getItem(UIK) || '{}')); } catch (e) { return uiDef(); } })();
  const saveUi = () => { try { localStorage.setItem(UIK, JSON.stringify(ui)); } catch (e) {} };
  const F = id => ui.f[id] || (ui.f[id] = {});

  /* ---------- IndexedDB (decisions only) ---------- */
  let dbp = null;
  const db = () => dbp || (dbp = new Promise((res, rej) => { const q = indexedDB.open('adrial-parcels', 1); q.onupgradeneeded = () => q.result.createObjectStore('kv'); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }));
  const idbOp = (mode, fn) => db().then(d => new Promise(res => { const t = d.transaction('kv', mode), q = fn(t.objectStore('kv')); t.oncomplete = () => res(q && q.result !== undefined ? q.result : true); t.onerror = t.onabort = () => res(null); })).catch(() => null);
  const idbGet = () => idbOp('readonly', s => s.get('state'));
  const idbPut = v => idbOp('readwrite', s => s.put(v, 'state'));
  const idbDel = () => idbOp('readwrite', s => s.delete('state'));
  let chain = Promise.resolve(), timer = null, dirty = false, bc = null;
  const enqueue = f => (chain = chain.then(f, f));
  try { bc = new BroadcastChannel('adrial-parcels'); } catch (e) {}
  function save() { dirty = true; clearTimeout(timer); timer = setTimeout(flush, 250); }
  function flush() { clearTimeout(timer); if (!dirty) return chain; dirty = false; const copy = JSON.parse(JSON.stringify(st)); return enqueue(() => idbPut(copy).then(() => { if (bc) bc.postMessage({ type: 'changed' }); })); }
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
  if (bc) bc.onmessage = async e => {
    if (!e.data || e.data.type !== 'changed') return;
    const s = await idbGet(); if (!validState(s)) return;
    const reload = s.anchor !== st.anchor; st = ensureState(s); if (reload) loadData(); cache = {}; render();
  };

  /* ---------- date + model ---------- */
  const defaultSettings = () => ({ stuckDays: 3, failedMin: 1, pickupDays: 5, codOverdueDays: 14 });
  const validState = s => !!(s && s.version === VERSION && typeof s.anchor === 'string' && s.cases && s.cod && s.batches && Array.isArray(s.claims));
  function ensureState(s) { s.settings = Object.assign(defaultSettings(), s.settings || {}); s.log = s.log || []; s.seq = s.seq || 0; s.me = PERSON[s.me] ? s.me : 'tina'; return s; }
  function loadData() { DATA = D.generate(st.anchor); TODAY = st.anchor.slice(0, 10); derive(); cache = {}; }
  function freshState(anchor) {
    st = { version: VERSION, anchor: anchor, me: 'tina', touched: false, settings: defaultSettings(), cases: {}, cod: {}, batches: {}, claims: [], log: [], seq: 0 };
    loadData(); seedState(); cache = {}; return st;
  }
  function derive() {
    IX = { p: {}, item: {}, batchOf: {}, b: {} };
    DATA.parcels.forEach(p => {
      IX.p[p.id] = p; p.last = p.ev[p.ev.length - 1] || { ts: p.created, code: 'label' };
      p.status = D.util.statusOf(p.ev); p.fails = p.ev.filter(e => e.code === 'failed').length;
      const pk = p.ev.find(e => e.code === 'collected'), dl = p.ev.find(e => e.code === 'delivered');
      p.pickAt = pk ? pk.ts : null; p.delAt = dl ? dl.ts : null;
      p.days = p.pickAt && p.delAt ? U.wdBetween(p.pickAt, p.delAt) : null;
      p.onTime = p.days != null ? p.days <= CAR[p.carrier].sla : null;
      p.key = (p.no + ' ' + p.track + ' ' + p.name + ' ' + p.email + ' ' + p.city).toLowerCase();
    });
    DATA.batches.forEach(b => { IX.b[b.id] = b; b.items.forEach(it => { IX.item[it.pid] = it; IX.batchOf[it.pid] = b; }); });
  }
  const memo = (k, f) => k in cache ? cache[k] : (cache[k] = f());

  /* ---------- exception rules ---------- */
  function issuesOf(p) {
    const c = cache.iss || (cache.iss = {}); if (c[p.id]) return c[p.id];
    const s = st.settings, out = [], act = ACTIVE[p.status];
    if (act && p.status !== 'pickup' && U.wdBetween(p.last.ts, TODAY) >= s.stuckDays) out.push('noscan');
    if (act && p.fails >= s.failedMin) out.push('failed');
    if (p.status === 'pickup' && U.diff(p.last.ts, TODAY) >= s.pickupDays) out.push('pickup');
    if (p.status === 'returning' || p.status === 'returned') out.push('returned');
    if (p.status === 'damaged' || p.status === 'lost') out.push('damlost');
    if (st.cases[p.id] && st.cases[p.id].manual) out.push('manual');
    return (c[p.id] = out);
  }
  const queueRows = () => memo('q', () => DATA.parcels.map(p => ({ p: p, rules: issuesOf(p), c: st.cases[p.id] })).filter(r => r.rules.length));
  const openExceptions = () => queueRows().filter(r => !(r.c && r.c.resolved));

  /* ---------- COD state machine ---------- */
  function codOf(p) {
    if (!p.cod) return null;
    const c = cache.cod || (cache.cod = {}); if (c[p.id]) return c[p.id];
    const it = IX.item[p.id], b = IX.batchOf[p.id], o = { p: p, expected: p.cod, item: it, batch: b, paid: it ? it.paid : 0, base: p.delAt ? p.delAt.slice(0, 10) : p.last.ts.slice(0, 10) };
    if (it) {
      if (p.status === 'returned' || p.status === 'damaged' || p.status === 'lost') o.state = b.onBank ? 'paidret' : 'announced';
      else if (!b.onBank) o.state = 'announced';
      else if (it.paid < it.expected - 0.005) o.state = 'short';
      else o.state = 'paid';
    } else if (p.status === 'delivered') o.state = U.diff(o.base, TODAY) > st.settings.codOverdueDays ? 'overdue' : 'collected';
    else if (p.status === 'returned' || p.status === 'damaged' || p.status === 'lost') o.state = 'void';
    else o.state = 'pending';
    o.age = U.diff(o.base, TODAY); o.mismatch = o.state === 'short' || o.state === 'paidret' || o.state === 'overdue';
    o.diff = codDiff(o);
    return (c[p.id] = o);
  }
  function codDiff(o) { return o.state === 'short' ? r2(o.paid - o.expected) : o.state === 'paidret' ? o.paid : o.state === 'overdue' ? -o.expected : 0; }
  const codAll = () => memo('codAll', () => DATA.parcels.filter(p => p.cod).map(codOf));
  const mismatches = () => codAll().filter(o => o.mismatch);
  const openMismatches = () => mismatches().filter(o => !st.cod[o.p.id]);
  const batchOpen = b => b.items.filter(it => { const o = codOf(IX.p[it.pid]); return o.mismatch && !st.cod[it.pid]; }).length;
  function batchStatus(b) { if (st.batches[b.id]) return 'rec'; if (!b.onBank) return 'ann'; return batchOpen(b) ? 'diff' : 'ready'; }
  const BS_L = { rec: 'Reconciled', ann: 'Announced', diff: 'Differences', ready: 'Ready to reconcile' }, BS_C = { rec: 'good', ann: '', diff: 'bad', ready: 'warn' };

  /* ---------- seed ---------- */
  function seedState() {
    const r = U.rng(0x5EED01), ppl = D.TEAM.map(t => t.id), stamp = (days) => U.add(TODAY, -Math.max(0, days)) + 'T' + U.pad(8 + Math.floor(r() * 9)) + ':' + U.pad(Math.floor(r() * 60));
    queueRows().forEach(row => {
      if (r() > 0.62) return;
      const age = U.diff(row.p.last.ts, TODAY), who = ppl[Math.floor(r() * ppl.length)];
      const c = { assignee: who, action: ACTIONS[Math.floor(r() * ACTIONS.length)], resolved: false, notes: [], manual: false };
      if (r() < 0.6) c.notes.push({ at: stamp(Math.min(age, 3)), by: who, text: NOTES[Math.floor(r() * NOTES.length)] });
      if (age >= 10 && r() < 0.45) c.resolved = true;
      st.cases[row.p.id] = c;
    });
    mismatches().forEach(o => {
      if (o.age < 10 || r() > 0.7) return;
      const at = stamp(o.age - 6);
      if (r() < 0.55) st.cod[o.p.id] = { how: 'reconciled', by: 'tina', at: at, note: 'Matches the carrier statement' };
      else claimFor(o, 'tina', at, 'Opened from the carrier statement', r() < 0.4 ? 'recovered' : 'open');
    });
    DATA.batches.forEach(b => { if (b.onBank && U.diff(b.payDate, TODAY) > 12 && batchOpen(b) === 0 && r() < 0.9) st.batches[b.id] = { by: 'tina', at: stamp(U.diff(b.bankDate, TODAY) - 1) }; });
    st.log.unshift({ at: nowLj(), by: 'tina', msg: 'Demo decisions loaded' });
  }
  function claimFor(o, by, at, note, status) {
    const no = 'CLM-' + TODAY.slice(0, 4) + '-' + String(++st.seq).padStart(4, '0');
    st.claims.push({ no: no, pid: o.p.id, carrier: o.p.carrier, kind: o.state, amount: Math.abs(o.diff), opened: at, by: by, status: status || 'open', note: note || '' });
    st.cod[o.p.id] = { how: 'claim', claim: no, by: by, at: at, note: note || '' };
  }

  /* ---------- commit / toast / layers ---------- */
  function logIt(msg) { st.log.unshift({ at: nowLj(), by: st.me, msg: msg }); if (st.log.length > 300) st.log.length = 300; }
  function commit(msg) { st.touched = true; if (msg) logIt(msg); cache = {}; save(); render(); }
  let tt; function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('on'), 2400); }
  function paintDr() {
    if (!DR) { $('#lay-d').innerHTML = ''; return; }
    const old = $('#lay-d .lbody'), sc = old ? old.scrollTop : 0;
    $('#lay-d').innerHTML = '<div class="scrim" data-act="close"></div><section class="drawer" role="dialog" aria-modal="true" aria-label="' + esc(DR.title) + '"><div class="lh"><h2>' + esc(DR.title) + '</h2><button class="btn sm" data-act="close" aria-label="Close">Close</button></div><div class="lbody">' + DR.fn() + '</div></section>';
    $('#lay-d .lbody').scrollTop = sc;
  }
  function openDrawer(title, fn) { lastFocus = document.activeElement; DR = { title: title, fn: fn }; paintDr(); const b = $('#lay-d .lh button'); if (b) b.focus(); }
  function closeLayer() { if (MD) { MD = null; $('#lay-m').innerHTML = ''; return; } if (DR) { DR = null; paintDr(); if (lastFocus && lastFocus.focus) try { lastFocus.focus(); } catch (e) {} } }
  function modal(o) {
    MD = o; $('#lay-m').innerHTML = '<div class="scrim" data-act="close"></div><form class="modal" role="dialog" aria-modal="true" aria-label="' + esc(o.title) + '"><div class="lh"><h2>' + esc(o.title) + '</h2></div><div class="lbody">' + o.body + '<div class="neg" id="merr" role="alert"></div></div><div class="lfoot"><button type="button" class="btn" data-act="close">Cancel</button><button class="btn pri' + (o.danger ? ' danger' : '') + '" type="submit">' + esc(o.ok || 'OK') + '</button></div></form>';
    const f = $('#lay-m form'); f.onsubmit = e => { e.preventDefault(); const v = {}; new FormData(f).forEach((x, k) => v[k] = x); const err = o.onSubmit(v); if (err) $('#merr').textContent = err; else { MD = null; $('#lay-m').innerHTML = ''; } };
    const i = $('input,textarea,select', f); (i || $('button.pri', f)).focus();
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && (MD || DR)) closeLayer(); });

  /* ---------- charts (hand-written SVG) ---------- */
  const niceMax = m => { const e = Math.pow(10, Math.floor(Math.log10(m))); return ([1, 2, 2.5, 5, 10].find(x => x * e >= m) || 10) * e; };
  const kf = v => v >= 1e6 ? (v / 1e6) + 'M' : v >= 1000 ? (v / 1000) + 'k' : String(v);
  function barChart(items, series, o) {
    o = o || {}; const W = 640, H = o.h || 210, L = 44, B = 24, T = 8, R = 6, iw = W - L - R, ih = H - T - B;
    const mx = niceMax(Math.max(1, ...items.map(i => o.stack ? i.v.reduce((a, b) => a + b, 0) : Math.max.apply(null, i.v)))), bw = iw / items.length, yf = o.yf || kf;
    let s = '<svg class="ch" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(o.label || 'Chart') + '">';
    for (let i = 0; i <= 4; i++) { const y = T + ih - ih * i / 4; s += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '"/><text x="' + (L - 5) + '" y="' + (y + 3) + '" text-anchor="end">' + yf(mx * i / 4) + '</text>'; }
    const step = Math.ceil(items.length / (o.labels || 10));
    items.forEach((it, k) => {
      const x0 = L + k * bw; let acc = 0;
      it.v.forEach((v, j) => {
        const h = ih * v / mx; let x, y;
        if (o.stack) { x = x0 + bw * 0.12; y = T + ih - acc - h; acc += h; s += '<rect class="s' + series[j].c + '" x="' + x + '" y="' + y + '" width="' + bw * 0.76 + '" height="' + Math.max(0, h) + '"><title>' + esc(it.l + ': ' + series[j].n + ' ' + v) + '</title></rect>'; }
        else { const w = bw * 0.8 / it.v.length; x = x0 + bw * 0.1 + j * w; s += '<rect class="s' + series[j].c + '" x="' + x + '" y="' + (T + ih - h) + '" width="' + Math.max(1, w - 1) + '" height="' + Math.max(0, h) + '"><title>' + esc(it.l + ': ' + series[j].n + ' ' + (o.yf ? o.yf(v) : v)) + '</title></rect>'; }
      });
      if (k % step === 0) s += '<text x="' + (x0 + bw / 2) + '" y="' + (H - 7) + '" text-anchor="middle">' + esc(it.l) + '</text>';
    });
    return s + '<line class="axis" x1="' + L + '" x2="' + (W - R) + '" y1="' + (T + ih) + '" y2="' + (T + ih) + '"/></svg>' + legend(series);
  }
  const legend = series => '<div class="legend">' + series.map(x => '<span><i class="s' + x.c + '" style="background:var(--k' + x.c + ')"></i>' + esc(x.n) + '</span>').join('') + '</div>';
  function hbar(items, o) {
    o = o || {}; const W = 640, rh = 26, L = 92, H = items.length * rh + 6, R = 70, mx = Math.max(0.0001, ...items.map(i => Math.max(i.v, i.m || 0))) * 1.05;
    let s = '<svg class="ch" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(o.label || 'Chart') + '">';
    items.forEach((it, k) => {
      const y = 3 + k * rh, w = (W - L - R) * it.v / mx;
      s += '<text x="' + (L - 6) + '" y="' + (y + 15) + '" text-anchor="end">' + esc(it.l) + '</text><rect class="s' + it.c + '" x="' + L + '" y="' + (y + 3) + '" width="' + Math.max(1, w) + '" height="' + (rh - 9) + '" rx="2"><title>' + esc(it.l + ': ' + it.f) + '</title></rect>';
      if (it.m != null) { const mxp = L + (W - L - R) * it.m / mx; s += '<line class="mark" x1="' + mxp + '" x2="' + mxp + '" y1="' + (y + 1) + '" y2="' + (y + rh - 4) + '"/>'; }
      s += '<text x="' + (L + w + 6) + '" y="' + (y + 15) + '">' + esc(it.f) + '</text>';
    });
    return s + '</svg>';
  }
  function chartBox(id, title, svg, head, rows, note) {
    const t = ui.tbl[id];
    return '<div class="card"><div class="ch-h"><h3>' + esc(title) + '</h3><button class="btn sm" data-act="tgl" data-id="' + id + '" aria-pressed="' + !!t + '">' + (t ? 'Show chart' : 'Show as table') + '</button></div>' +
      (t ? '<div class="tw"><table class="tbl"><thead><tr>' + head.map((h, i) => '<th' + (i ? ' class="num"' : '') + '>' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' + rows.map(r => '<tr>' + r.map((c, i) => '<td' + (i ? ' class="num"' : '') + '>' + esc(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>' : svg) + (note ? '<div class="muted" style="font-size:12px;margin-top:4px">' + note + '</div>' : '') + '</div>';
  }

  /* ---------- generic table ---------- */
  function tbl(id, rows, cols, o) {
    o = o || {}; const s = ui.sort[id] || o.sort; let list = rows.slice();
    if (s) { const c = cols.find(c => c.k === s.k); if (c) { const g = c.v || (r => r[c.k]); list.sort((a, b) => { const x = g(a), y = g(b); return s.dir * (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))); }); } }
    TBL[id] = { list: list, cols: cols };
    const size = o.size || 50, pages = Math.max(1, Math.ceil(list.length / size)), pg = Math.min(ui.page[id] || 0, pages - 1), view = list.slice(pg * size, pg * size + size);
    if (!list.length) return '<div class="tw"><div class="empty">' + (o.empty || 'Nothing matches these filters.') + '</div></div>';
    let h = '<div class="tw"><table class="tbl"><thead><tr>' + cols.map(c => '<th class="' + (c.num ? 'num' : '') + '"' + (s && s.k === c.k ? ' aria-sort="' + (s.dir > 0 ? 'ascending' : 'descending') + '"' : '') + '>' + (c.hh || (c.nosort ? esc(c.h) : '<button type="button" data-act="sort" data-t="' + id + '" data-k="' + c.k + '">' + esc(c.h) + (s && s.k === c.k ? (s.dir > 0 ? ' ▲' : ' ▼') : '') + '</button>')) + '</th>').join('') + '</tr></thead><tbody>';
    view.forEach(r => { h += '<tr' + (o.act ? ' class="row" data-act="' + o.act + '" data-id="' + esc(o.rid(r)) + '"' : '') + '>' + cols.map(c => '<td class="' + (c.num ? 'num ' : '') + (c.cls ? c.cls(r) : '') + '">' + (c.f ? c.f(r) : esc(c.v(r))) + '</td>').join('') + '</tr>'; });
    h += '</tbody></table></div><div class="pager"><span>' + list.length + ' rows</span>' + (pages > 1 ? '<button class="btn sm" data-act="page" data-t="' + id + '" data-d="-1"' + (pg ? '' : ' disabled') + '>Prev</button><span>Page ' + (pg + 1) + ' / ' + pages + '</span><button class="btn sm" data-act="page" data-t="' + id + '" data-d="1"' + (pg < pages - 1 ? '' : ' disabled') + '>Next</button>' : '') + (o.nocsv ? '' : '<button class="btn sm" data-act="csv" data-t="' + id + '">Export CSV</button>') + '</div>';
    return h;
  }
  function csvOut(id) {
    const t = TBL[id]; if (!t) return; const cols = t.cols.filter(c => c.v && c.h);
    const q = x => '"' + String(x == null ? '' : x).replace(/"/g, '""') + '"';
    const txt = '﻿' + [cols.map(c => q(c.h)).join(',')].concat(t.list.map(r => cols.map(c => q(c.csv ? c.csv(r) : c.v(r))).join(','))).join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type: 'text/csv' })); a.download = 'parcels-' + id + '-' + TODAY + '.csv'; document.body.appendChild(a); a.click(); a.remove(); toast('CSV exported');
  }
  function sel(id, key, opts, all) { const v = F(id)[key] || ''; return '<select data-f="' + id + ':' + key + '" aria-label="' + esc(all) + '"><option value="">' + esc(all) + '</option>' + opts.map(o => '<option value="' + esc(o[0]) + '"' + (o[0] === v ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') + '</select>'; }
  const carOpts = () => D.CARRIERS.map(c => [c.id, c.name]);
  const badge = (t, c) => '<span class="badge ' + (c || '') + '">' + esc(t) + '</span>';
  const sbadge = s => badge(STATUS_L[s], STATUS_C[s]);
  const cbadge = s => badge(COD_L[s], COD_C[s]);
  const carDot = id => '<span class="sw k' + CAR[id].k + '"></span>' + esc(CAR[id].short);
  const pLink = p => '<button class="lnk" type="button" data-act="parcel" data-id="' + p.id + '">' + esc(p.no) + '</button>';
  const kpi = (l, v, s, c) => '<div class="kpi ' + (c || '') + '"><div class="l">' + esc(l) + '</div><div class="v">' + v + '</div><div class="s">' + s + '</div></div>';
  const pct = (a, b) => b ? Math.round(a * 1000 / b) / 10 : 0;

  /* ---------- pages ---------- */
  function staleNotice() {
    const a = U.anchorNow().slice(0, 10); if (a === TODAY) return '';
    return '<div class="banner">These demo parcels are as of ' + fd(TODAY) + ', not today. <button class="btn sm" data-act="regen">Regenerate for today</button><span class="muted">(clears your decisions)</span></div>';
  }
  function pageOverview() {
    const P = DATA.parcels, del = P.filter(p => p.status === 'delivered'), ot = del.filter(p => p.onTime).length, oe = openExceptions();
    const co = codAll(), outst = co.filter(o => o.state === 'collected' || o.state === 'overdue' || o.state === 'announced').reduce((a, o) => a + o.expected, 0);
    const om = openMismatches(), omv = om.reduce((a, o) => a + Math.abs(o.diff), 0);
    let h = '<h1 class="pg">Overview</h1><p class="sub">' + P.length + ' parcels from the last 60 days, as of ' + fdt(st.anchor) + '.</p><div class="kpis">' +
      kpi('Parcels (60 days)', P.length, D.CARRIERS.length + ' carrier accounts') + kpi('Delivered', pct(del.length, P.length) + ' %', del.length + ' parcels', 'good') +
      kpi('On time', pct(ot, del.length) + ' %', 'within each carrier\'s SLA', pct(ot, del.length) < 85 ? 'warn' : 'good') +
      '<a class="kpi ' + (oe.length > 20 ? 'warn' : '') + '" href="#/exceptions" style="text-decoration:none;color:inherit"><div class="l">Open work queue</div><div class="v">' + oe.length + '</div><div class="s">parcels need attention</div></a>' +
      kpi('COD not at bank', eur(outst), 'collected, overdue or announced') + '<a class="kpi ' + (om.length ? 'bad' : 'good') + '" href="#/cod/mismatches" style="text-decoration:none;color:inherit"><div class="l">Open COD differences</div><div class="v">' + om.length + '</div><div class="s">' + eur(omv) + ' to resolve</div></a></div>';
    const days = []; for (let i = 59; i >= 0; i--) days.push(U.add(TODAY, -i));
    const cnt = {}; days.forEach(d => cnt[d] = [0, 0, 0]);
    P.forEach(p => { const a = cnt[p.created.slice(0, 10)]; if (!a) return; a[p.status === 'delivered' ? 0 : (p.status === 'failed' || p.status === 'returning' || p.status === 'returned' || p.status === 'damaged' || p.status === 'lost') ? 2 : 1]++; });
    const ser = [{ n: 'Delivered', c: 3 }, { n: 'In progress', c: 1 }, { n: 'Problem', c: 2 }];
    h += '<div class="grid2">' + chartBox('ppd', 'Parcels per day', barChart(days.map(d => ({ l: (+d.slice(8)) + '.' + (+d.slice(5, 7)) + '.', v: cnt[d] })), ser, { stack: true, label: 'Parcels per day, by outcome' }), ['Day', 'Delivered', 'In progress', 'Problem'], days.map(d => [fd(d)].concat(cnt[d])));
    const sc = scoreRows();
    h += chartBox('avgd', 'Average delivery time (working days)', hbar(sc.map(s => ({ l: s.c.short, v: s.avg, m: s.c.sla, c: s.c.k, f: s.avg.toFixed(1) })), { label: 'Average delivery days by carrier' }), ['Carrier', 'Avg days', 'SLA'], sc.map(s => [s.c.name, s.avg.toFixed(1), s.c.sla]), 'Black mark = carrier SLA.') + '</div>';
    h += '<div class="grid2"><div class="card"><h3>Work queue</h3><div class="chips" style="margin-bottom:8px">' + RULES.map(r => '<button class="chip" data-act="qrule" data-id="' + r.id + '">' + r.t + ' · ' + oe.filter(x => x.rules.includes(r.id)).length + '</button>').join('') + '</div><p class="muted" style="margin:0">' + oe.filter(x => !x.c || !x.c.assignee).length + ' of ' + oe.length + ' open cases have nobody assigned.</p></div>';
    const wk = []; for (let i = 8; i >= 0; i--) wk.push(U.add(TODAY, -i * 7 - ((U.dow(TODAY) + 6) % 7)));
    const wkOf = d => { const s = U.add(d, -((U.dow(d) + 6) % 7)); return wk.indexOf(s); }, w1 = wk.map(() => 0), w2 = wk.map(() => 0);
    co.forEach(o => { if (o.p.delAt) { const k = wkOf(o.p.delAt.slice(0, 10)); if (k >= 0) w1[k] += o.expected; } });
    DATA.batches.forEach(b => { if (b.onBank) { const k = wkOf(b.bankDate); if (k >= 0) w2[k] += b.gross; } });
    h += chartBox('codw', 'COD per week', barChart(wk.map((d, i) => ({ l: (+d.slice(8)) + '.' + (+d.slice(5, 7)) + '.', v: [Math.round(w1[i]), Math.round(w2[i])] })), [{ n: 'Collected by couriers', c: 1 }, { n: 'Arrived at bank', c: 3 }], { label: 'COD collected and paid per week', labels: 9, yf: v => kf(Math.round(v)) }), ['Week from', 'Collected', 'At bank'], wk.map((d, i) => [fd(d), eur(w1[i]), eur(w2[i])])) + '</div>';
    h += '<div class="card"><h3>Recent decisions</h3>' + (st.log.length ? '<ul style="margin:0;padding-left:18px">' + st.log.slice(0, 6).map(l => '<li>' + esc(l.msg) + ' <span class="muted">· ' + esc((PERSON[l.by] || {}).name || l.by) + ', ' + fdt(l.at) + '</span></li>').join('') + '</ul>' : '<p class="muted">Nothing yet.</p>') + '</div>';
    return h;
  }

  function searchHtml(q) {
    q = (q || '').trim().toLowerCase(); if (q.length < 2) return '<p class="muted">Type at least two characters: order number, tracking number, name or e-mail.</p>';
    const toks = q.split(/\s+/), res = DATA.parcels.filter(p => toks.every(t => p.key.indexOf(t) >= 0));
    if (!res.length) return '<div class="empty">No parcel found for "' + esc(q) + '".</div>';
    if (res.length === 1) return '<div class="card">' + parcelBody(res[0]) + '</div>';
    return '<p class="muted">' + res.length + ' parcels' + (res.length > 25 ? ', showing 25' : '') + '</p>' + tbl('sr', res.slice(0, 25), [
      { k: 'no', h: 'Order', v: p => p.no, f: pLink }, { k: 'name', h: 'Customer', v: p => p.name }, { k: 'c', h: 'Carrier', v: p => CAR[p.carrier].short, f: p => carDot(p.carrier) }, { k: 's', h: 'Status', v: p => STATUS_L[p.status], f: p => sbadge(p.status) }, { k: 'cr', h: 'Created', v: p => p.created, f: p => fd(p.created) }], { nocsv: true, act: 'parcel', rid: p => p.id });
  }
  function pageSearch() { return '<h1 class="pg">Search</h1><p class="sub">Find a parcel by order number, tracking number, customer name or e-mail.</p><div class="card"><input id="q" class="srch" type="search" placeholder="e.g. 312345, GLS0123… or ana.novak" value="' + esc(ui.q || '') + '" autocomplete="off" aria-label="Search parcels"></div><div id="sres">' + searchHtml(ui.q) + '</div>'; }

  /* parcels list */
  const PCOLS = () => [
    { k: 'no', h: 'Order', v: p => p.no, f: pLink }, { k: 'name', h: 'Customer', v: p => p.name }, { k: 'cc', h: 'Country', v: p => p.cc }, { k: 'c', h: 'Carrier', v: p => CAR[p.carrier].short, f: p => carDot(p.carrier) },
    { k: 'kind', h: 'Type', v: p => p.kind }, { k: 'cr', h: 'Created', v: p => p.created, f: p => fd(p.created) }, { k: 's', h: 'Status', v: p => STATUS_L[p.status], f: p => sbadge(p.status) },
    { k: 'last', h: 'Last scan', v: p => p.last.ts, f: p => fdt(p.last.ts) }, { k: 'days', h: 'Days', num: true, v: p => p.days == null ? -1 : p.days, f: p => p.days == null ? '' : p.days }, { k: 'cod', h: 'COD €', num: true, v: p => p.cod, f: p => p.cod ? eur(p.cod) : '' }];
  function tableP() {
    const f = F('p'), toks = (f.q || '').toLowerCase().split(/\s+/).filter(Boolean);
    const rows = DATA.parcels.filter(p => (!f.status || p.status === f.status) && (!f.carrier || p.carrier === f.carrier) && (!f.cc || p.cc === f.cc) && (!f.kind || p.kind === f.kind) && (!f.cod || (f.cod === 'cod') === !!p.cod) && toks.every(t => p.key.indexOf(t) >= 0));
    return tbl('p', rows, PCOLS(), { act: 'parcel', rid: p => p.id, sort: { k: 'cr', dir: -1 } });
  }
  function pageParcels() {
    const f = F('p');
    return '<h1 class="pg">Parcels</h1><p class="sub">Every parcel of the last 60 days. Click a row for the scan history.</p><div class="bar"><input data-f="p:q" type="search" placeholder="Filter by text" value="' + esc(f.q || '') + '" aria-label="Filter by text">' +
      sel('p', 'status', Object.keys(STATUS_L).map(k => [k, STATUS_L[k]]), 'All statuses') + sel('p', 'carrier', carOpts(), 'All carriers') + sel('p', 'cc', [['SI', 'Slovenia'], ['HR', 'Croatia'], ['IT', 'Italy']], 'All countries') +
      sel('p', 'kind', [['home', 'Home delivery'], ['locker', 'Locker']], 'All types') + sel('p', 'cod', [['cod', 'COD only'], ['no', 'No COD']], 'COD and not') + '</div><div id="tw-p">' + tableP() + '</div>';
  }

  /* work queue */
  const ageOf = r => U.diff(r.p.last.ts, TODAY);
  function tableE() {
    const f = F('e'), st0 = f.open || 'open', toks = (f.q || '').toLowerCase().split(/\s+/).filter(Boolean);
    const rows = queueRows().filter(r => (st0 === 'all' || (st0 === 'open') === !(r.c && r.c.resolved)) && (!f.rule || r.rules.includes(f.rule)) && (!f.who || (f.who === '-' ? !(r.c && r.c.assignee) : r.c && r.c.assignee === f.who)) && (!f.carrier || r.p.carrier === f.carrier) && toks.every(t => r.p.key.indexOf(t) >= 0));
    const all = rows.length && rows.every(r => SEL.has(r.p.id));
    return tbl('e', rows, [
      { k: 'sel', h: 'Select', nosort: true, hh: '<input type="checkbox" data-selall ' + (all ? 'checked' : '') + ' aria-label="Select all">', f: r => '<input type="checkbox" data-sel="' + r.p.id + '" ' + (SEL.has(r.p.id) ? 'checked' : '') + ' aria-label="Select ' + esc(r.p.no) + '">' },
      { k: 'no', h: 'Parcel', v: r => r.p.no, f: r => pLink(r.p) + ' <span class="muted">' + esc(r.p.name) + '</span>' }, { k: 'c', h: 'Carrier', v: r => CAR[r.p.carrier].short, f: r => carDot(r.p.carrier) },
      { k: 's', h: 'Status', v: r => STATUS_L[r.p.status], f: r => sbadge(r.p.status) }, { k: 'rules', h: 'Rules', v: r => r.rules.map(x => RULES.find(y => y.id === x).t).join(', '), f: r => r.rules.map(x => badge(RULES.find(y => y.id === x).t, x === 'damlost' || x === 'returned' ? 'bad' : 'warn')).join(' ') },
      { k: 'age', h: 'Idle days', num: true, v: ageOf, f: ageOf }, { k: 'who', h: 'Assignee', v: r => r.c && r.c.assignee ? PERSON[r.c.assignee].name : '', f: r => r.c && r.c.assignee ? esc(PERSON[r.c.assignee].name) : '<span class="muted">-</span>' },
      { k: 'act', h: 'Next action', v: r => r.c ? r.c.action || '' : '' }, { k: 'res', h: 'State', v: r => r.c && r.c.resolved ? 'Resolved' : 'Open', f: r => r.c && r.c.resolved ? badge('Resolved', 'good') : badge('Open', 'warn') }
    ], { act: 'parcel', rid: r => r.p.id, sort: { k: 'age', dir: -1 } });
  }
  function bulkBar() {
    if (!SEL.size) return '';
    return '<div class="bulk" id="bulk"><b>' + SEL.size + ' selected</b><select id="bwho" aria-label="Assign to"><option value="">Assign to…</option>' + D.TEAM.map(t => '<option value="' + t.id + '">' + esc(t.name) + '</option>').join('') + '</select><button class="btn sm" data-act="bulk" data-k="assignee">Assign</button>' +
      '<select id="bact" aria-label="Next action"><option value="">Next action…</option>' + ACTIONS.map(a => '<option>' + a + '</option>').join('') + '</select><button class="btn sm" data-act="bulk" data-k="action">Set</button><button class="btn sm" data-act="bulk" data-k="resolve">Resolve</button><button class="btn sm" data-act="bulk" data-k="reopen">Reopen</button><button class="btn sm" data-act="bulk" data-k="clear">Clear selection</button></div>';
  }
  function pageExceptions() {
    const f = F('e'), oe = openExceptions();
    return '<h1 class="pg">Work queue</h1><p class="sub">Parcels that hit an exception rule or were added by hand. Rule limits are in Settings.</p><div class="chips" style="margin-bottom:10px">' +
      '<button class="chip" data-act="qrule" data-id="" aria-pressed="' + !f.rule + '">All rules · ' + oe.length + '</button>' + RULES.map(r => '<button class="chip" data-act="qrule" data-id="' + r.id + '" aria-pressed="' + (f.rule === r.id) + '">' + r.t + ' · ' + oe.filter(x => x.rules.includes(r.id)).length + '</button>').join('') + '</div>' +
      '<div class="bar"><input data-f="e:q" type="search" placeholder="Filter by text" value="' + esc(f.q || '') + '" aria-label="Filter by text"><select data-f="e:open" aria-label="State">' + [['open', 'Open'], ['resolved', 'Resolved'], ['all', 'All']].map(o => '<option value="' + o[0] + '"' + ((f.open || 'open') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select>' +
      sel('e', 'who', [['-', 'Unassigned']].concat(D.TEAM.map(t => [t.id, t.name])), 'Anyone') + sel('e', 'carrier', carOpts(), 'All carriers') + '</div><div id="bulkw">' + bulkBar() + '</div><div id="tw-e">' + tableE() + '</div>';
  }

  /* scorecard */
  function scoreRows() {
    return memo('score', () => D.CARRIERS.map(c => {
      const P = DATA.parcels.filter(p => p.carrier === c.id), del = P.filter(p => p.status === 'delivered'), done = del.filter(p => p.days != null);
      const s = { c: c, n: P.length, delivered: del.length, delPct: pct(del.length, P.length), avg: done.length ? done.reduce((a, p) => a + p.days, 0) / done.length : 0, onTime: pct(del.filter(p => p.onTime).length, del.length), failPct: pct(P.filter(p => p.fails > 0).length, P.length), retPct: pct(P.filter(p => p.status === 'returned' || p.status === 'returning').length, P.length), ld: P.filter(p => p.status === 'lost' || p.status === 'damaged').length, open: openExceptions().filter(r => r.p.carrier === c.id).length };
      const co = codAll().filter(o => o.p.carrier === c.id), bs = DATA.batches.filter(b => b.carrier === c.id);
      s.codOut = co.filter(o => o.state === 'collected' || o.state === 'overdue').reduce((a, o) => a + o.expected, 0); s.short = co.filter(o => o.state === 'short' || o.state === 'overdue').reduce((a, o) => a + Math.abs(o.diff), 0);
      const g = bs.reduce((a, b) => a + b.gross, 0); s.feePct = g ? pct(bs.reduce((a, b) => a + b.fees, 0), g) : 0; return s;
    }));
  }
  function pageScorecard() {
    const sc = scoreRows(), M = [['delPct', 'Delivered %', 1, 'num'], ['avg', 'Avg days', -1], ['onTime', 'On time %', 1], ['failPct', 'Failed attempts %', -1], ['retPct', 'Returned %', -1], ['ld', 'Lost / damaged', -1], ['open', 'Open cases', -1], ['codOut', 'COD at courier €', -1], ['short', 'COD short / overdue €', -1], ['feePct', 'COD fee %', -1]];
    const best = {}, worst = {}; M.forEach(m => { const v = sc.map(s => s[m[0]]), mx = Math.max.apply(null, v), mn = Math.min.apply(null, v); best[m[0]] = m[2] > 0 ? mx : mn; worst[m[0]] = m[2] > 0 ? mn : mx; });
    const cols = [{ k: 'c', h: 'Carrier', v: s => s.c.name, f: s => carDot(s.c.id) + ' ' + esc(s.c.name) }, { k: 'n', h: 'Parcels', num: true, v: s => s.n }].concat(M.map(m => ({ k: m[0], h: m[1], num: true, v: s => s[m[0]], f: s => (m[0] === 'avg' ? s.avg.toFixed(1) : m[0] === 'codOut' || m[0] === 'short' ? eur(s[m[0]]) : s[m[0]]), cls: s => best[m[0]] !== worst[m[0]] ? (s[m[0]] === best[m[0]] ? 'best' : s[m[0]] === worst[m[0]] ? 'worst' : '') : '' })));
    return '<h1 class="pg">Carrier scorecard</h1><p class="sub">Green is the best carrier for a column, red the worst.</p>' + tbl('sc', sc, cols, { nocsv: false, sort: { k: 'onTime', dir: -1 }, size: 20 });
  }

  /* COD */
  const COD_TABS = [['outstanding', 'Outstanding'], ['batches', 'Payout batches'], ['mismatches', 'Differences'], ['claims', 'Claims']];
  function pageCod(r) {
    const sub = COD_TABS.some(t => t[0] === r.sub) ? r.sub : 'outstanding';
    return '<h1 class="pg">Cash on delivery</h1><p class="sub">From the courier, to the carrier payout batch, to the bank statement.</p><nav class="tabs" aria-label="COD sections">' + COD_TABS.map(t => '<a href="#/cod/' + t[0] + '"' + (t[0] === sub ? ' aria-current="page"' : '') + '>' + t[1] + (t[0] === 'mismatches' ? ' <span class="cnt">' + openMismatches().length + '</span>' : '') + '</a>').join('') + '</nav>' + ({ outstanding: codOutstanding, batches: codBatches, mismatches: codMismatches, claims: codClaims }[sub])();
  }
  const BUCKETS = [['0-7', 0, 7], ['8-14', 8, 14], ['15-30', 15, 30], ['31+', 31, 9999]];
  function tableCo() {
    const f = F('co'), rows = codAll().filter(o => (f.state ? o.state === f.state : (o.state === 'pending' || o.state === 'collected' || o.state === 'overdue' || o.state === 'announced')) && (!f.carrier || o.p.carrier === f.carrier));
    return tbl('co', rows, [{ k: 'no', h: 'Order', v: o => o.p.no, f: o => pLink(o.p) }, { k: 'c', h: 'Carrier', v: o => CAR[o.p.carrier].short, f: o => carDot(o.p.carrier) }, { k: 'st', h: 'COD state', v: o => COD_L[o.state], f: o => cbadge(o.state) }, { k: 'ex', h: 'Amount', num: true, v: o => o.expected, f: o => eur(o.expected) },
      { k: 'base', h: 'Delivered', v: o => o.p.delAt || '', f: o => o.p.delAt ? fd(o.p.delAt) : '' }, { k: 'age', h: 'Days since', num: true, v: o => o.p.delAt ? o.age : -1, f: o => o.p.delAt ? o.age : '' }, { k: 'b', h: 'Batch', v: o => o.batch ? o.batch.ref : '', f: o => o.batch ? '<button class="lnk" data-act="batch" data-id="' + o.batch.id + '">' + esc(o.batch.ref) + '</button>' : '' }], { act: 'parcel', rid: o => o.p.id, sort: { k: 'age', dir: -1 } });
  }
  function codOutstanding() {
    const co = codAll(), states = ['pending', 'collected', 'overdue', 'announced'], f = F('co');
    let h = '<div class="kpis">' + states.map(s => { const l = co.filter(o => o.state === s); return '<button class="kpi" style="text-align:left;cursor:pointer" data-act="costate" data-id="' + s + '" aria-pressed="' + (f.state === s) + '"><div class="l">' + COD_L[s] + '</div><div class="v">' + eur(l.reduce((a, o) => a + o.expected, 0)) + '</div><div class="s">' + l.length + ' parcels</div></button>'; }).join('') + '</div>';
    const rows = D.CARRIERS.map(c => ({ c: c, b: BUCKETS.map(b => co.filter(o => o.p.carrier === c.id && (o.state === 'collected' || o.state === 'overdue') && o.age >= b[1] && o.age <= b[2]).reduce((a, o) => a + o.expected, 0)) }));
    h += '<div class="card"><h3>Ageing of COD the courier holds (days since delivery)</h3><div class="tw"><table class="tbl"><thead><tr><th>Carrier</th>' + BUCKETS.map(b => '<th class="num">' + b[0] + ' days</th>').join('') + '<th class="num">Total</th></tr></thead><tbody>' + rows.map(r => '<tr><td>' + carDot(r.c.id) + '</td>' + r.b.map(v => '<td class="num">' + (v ? eur(v) : '-') + '</td>').join('') + '<td class="num"><b>' + eur(r.b.reduce((a, b) => a + b, 0)) + '</b></td></tr>').join('') + '<tr class="tot"><td>Total</td>' + BUCKETS.map((b, i) => '<td class="num">' + eur(rows.reduce((a, r) => a + r.b[i], 0)) + '</td>').join('') + '<td class="num">' + eur(rows.reduce((a, r) => a + r.b.reduce((x, y) => x + y, 0), 0)) + '</td></tr></tbody></table></div></div>';
    return h + '<div class="bar"><span class="muted">List:</span>' + sel('co', 'state', states.map(s => [s, COD_L[s]]), 'All outstanding') + sel('co', 'carrier', carOpts(), 'All carriers') + '</div><div id="tw-co">' + tableCo() + '</div>';
  }
  function tableBa() {
    const f = F('ba'), rows = DATA.batches.filter(b => (!f.status || batchStatus(b) === f.status) && (!f.carrier || b.carrier === f.carrier));
    return tbl('ba', rows, [{ k: 'ref', h: 'Batch', v: b => b.ref, f: b => '<button class="lnk" data-act="batch" data-id="' + b.id + '">' + esc(b.ref) + '</button>' }, { k: 'c', h: 'Carrier', v: b => CAR[b.carrier].short, f: b => carDot(b.carrier) }, { k: 'pd', h: 'Payout date', v: b => b.payDate, f: b => fd(b.payDate) }, { k: 'bd', h: 'On bank', v: b => b.bankDate, f: b => fd(b.bankDate) },
      { k: 'n', h: 'Parcels', num: true, v: b => b.items.length }, { k: 'g', h: 'Gross', num: true, v: b => b.gross, f: b => eur(b.gross) }, { k: 'fe', h: 'Fees', num: true, v: b => b.fees, f: b => eur(b.fees) }, { k: 'net', h: 'Net', num: true, v: b => b.net, f: b => eur(b.net) },
      { k: 'd', h: 'Open diff.', num: true, v: b => batchOpen(b), f: b => batchOpen(b) || '' }, { k: 's', h: 'Status', v: b => BS_L[batchStatus(b)], f: b => badge(BS_L[batchStatus(b)], BS_C[batchStatus(b)]) }], { act: 'batch', rid: b => b.id, sort: { k: 'pd', dir: -1 } });
  }
  function codBatches() { return '<div class="bar">' + sel('ba', 'status', Object.keys(BS_L).map(k => [k, BS_L[k]]), 'All statuses') + sel('ba', 'carrier', carOpts(), 'All carriers') + '</div><div id="tw-ba">' + tableBa() + '</div>'; }
  function tableMm() {
    const f = F('mm'), h0 = f.h || 'open', rows = mismatches().filter(o => (!f.t || o.state === f.t) && (h0 === 'all' || (h0 === 'open') === !st.cod[o.p.id]) && (!f.carrier || o.p.carrier === f.carrier));
    return '<div class="muted" style="margin-bottom:6px">Total difference shown: <b class="' + (rows.reduce((a, o) => a + o.diff, 0) < 0 ? 'neg' : 'pos') + '">' + eur(rows.reduce((a, o) => a + o.diff, 0)) + '</b></div>' + tbl('mm', rows, [{ k: 'no', h: 'Order', v: o => o.p.no, f: o => pLink(o.p) }, { k: 'c', h: 'Carrier', v: o => CAR[o.p.carrier].short, f: o => carDot(o.p.carrier) }, { k: 't', h: 'Type', v: o => COD_L[o.state], f: o => cbadge(o.state) },
      { k: 'ex', h: 'Expected', num: true, v: o => o.expected, f: o => eur(o.expected) }, { k: 'pd', h: 'Carrier paid', num: true, v: o => o.paid, f: o => eur(o.paid) }, { k: 'df', h: 'Difference', num: true, v: o => o.diff, f: o => '<span class="' + (o.diff < 0 ? 'neg' : 'pos') + '">' + eur(o.diff) + '</span>' }, { k: 'age', h: 'Days', num: true, v: o => o.age },
      { k: 'dec', h: 'Decision', v: o => st.cod[o.p.id] ? st.cod[o.p.id].how : '', f: o => decisionBadge(o) }, { k: 'a', h: 'Actions', nosort: true, f: o => mmActions(o) }], { act: 'parcel', rid: o => o.p.id, sort: { k: 'age', dir: -1 } });
  }
  const decisionBadge = o => { const d = st.cod[o.p.id]; return d ? badge(d.how === 'claim' ? 'Claim ' + d.claim : 'Reconciled', 'good') : badge('Open', 'bad'); };
  function mmActions(o) {
    const d = st.cod[o.p.id], pid = o.p.id;
    if (!d) return '<button class="btn sm" data-act="codrec" data-id="' + pid + '">Reconcile</button> <button class="btn sm" data-act="codclaim" data-id="' + pid + '">Open claim</button>';
    const cl = d.how === 'claim' && st.claims.find(c => c.no === d.claim), lock = cl && cl.status !== 'open';
    return '<button class="btn sm" data-act="codundo" data-id="' + pid + '"' + (lock ? ' disabled title="The claim is already closed"' : '') + '>Undo</button>';
  }
  function codMismatches() { const f = F('mm'); return '<div class="bar"><div class="chips">' + [['', 'All types'], ['short', 'Paid short'], ['paidret', 'Paid, but returned'], ['overdue', 'Overdue']].map(t => '<button class="chip" data-act="mmtype" data-id="' + t[0] + '" aria-pressed="' + ((f.t || '') === t[0]) + '">' + t[1] + '</button>').join('') + '</div>' + '<select data-f="mm:h" aria-label="Decision">' + [['open', 'Open'], ['done', 'Handled'], ['all', 'All']].map(o => '<option value="' + o[0] + '"' + ((f.h || 'open') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select>' + sel('mm', 'carrier', carOpts(), 'All carriers') + '</div><div id="tw-mm">' + tableMm() + '</div>'; }
  function tableCl() {
    return tbl('cl', st.claims.slice(), [{ k: 'no', h: 'Claim', v: c => c.no }, { k: 'p', h: 'Parcel', v: c => IX.p[c.pid].no, f: c => pLink(IX.p[c.pid]) }, { k: 'c', h: 'Carrier', v: c => CAR[c.carrier].short, f: c => carDot(c.carrier) }, { k: 'k', h: 'Reason', v: c => COD_L[c.kind] }, { k: 'am', h: 'Amount', num: true, v: c => c.amount, f: c => eur(c.amount) },
      { k: 'op', h: 'Opened', v: c => c.opened, f: c => fd(c.opened) }, { k: 'by', h: 'By', v: c => (PERSON[c.by] || {}).name || c.by }, { k: 'stt', h: 'Status', v: c => c.status, f: c => badge({ open: 'Open', recovered: 'Recovered', closed: 'Written off' }[c.status], c.status === 'recovered' ? 'good' : c.status === 'open' ? 'warn' : 'mut') },
      { k: 'a', h: 'Actions', nosort: true, f: c => c.status === 'open' ? '<button class="btn sm" data-act="claimset" data-id="' + c.no + '" data-s="recovered">Recovered</button> <button class="btn sm" data-act="claimset" data-id="' + c.no + '" data-s="closed">Write off</button>' : '<button class="btn sm" data-act="claimset" data-id="' + c.no + '" data-s="open">Reopen</button>' }], { sort: { k: 'op', dir: -1 }, empty: 'No claims yet. Open one from the Differences tab.' });
  }
  function codClaims() { const open = st.claims.filter(c => c.status === 'open'); return '<p class="muted">' + open.length + ' open claims, ' + eur(open.reduce((a, c) => a + c.amount, 0)) + ' claimed from carriers.</p><div id="tw-cl">' + tableCl() + '</div>'; }

  /* settings */
  function pageSettings() {
    const s = st.settings, num = (k, l, mn, mx) => '<div class="field"><label for="s_' + k + '">' + l + '</label><input id="s_' + k + '" name="' + k + '" type="number" min="' + mn + '" max="' + mx + '" value="' + s[k] + '"></div>';
    return '<h1 class="pg">Settings</h1><p class="sub">Rule limits are used for the work queue and the COD overdue state.</p><div class="grid2"><form class="card" id="thrForm"><h3>Rule thresholds</h3>' + num('stuckDays', 'No scan: working days without a scan', 1, 10) + num('failedMin', 'Failed attempts before a parcel is flagged', 1, 5) + num('pickupDays', 'Waiting for pickup: calendar days', 2, 14) + num('codOverdueDays', 'COD overdue after (calendar days)', 7, 60) + '<button class="btn pri" type="submit">Save thresholds</button> <button class="btn" type="button" data-act="thrdef">Defaults</button><div class="neg" id="thrErr" role="alert"></div></form>' +
      '<div class="card"><h3>You are</h3><div class="field"><label for="me">Decisions are recorded under this name</label><select id="me">' + D.TEAM.map(t => '<option value="' + t.id + '"' + (st.me === t.id ? ' selected' : '') + '>' + esc(t.name) + '</option>').join('') + '</select></div><h3>Demo data</h3><p class="muted">Anchor ' + fdt(st.anchor) + ' · ' + DATA.parcels.length + ' parcels · ' + DATA.batches.length + ' batches · ' + Object.keys(st.cases).length + ' cases · ' + Object.keys(st.cod).length + ' COD decisions.</p><button class="btn" data-act="regen">Regenerate for today</button></div></div>' +
      '<div class="card"><h3>Carrier terms</h3>' + tbl('terms', D.CARRIERS, [{ k: 'n', h: 'Carrier account', v: c => c.name, f: c => carDot(c.id) + ' ' + esc(c.name) }, { k: 'cc', h: 'Country', v: c => c.country }, { k: 'pay', h: 'Pay days', nosort: true, v: c => c.payDays.map(d => 'SMTWTFS'[d] + ['un', 'on', 'ue', 'ed', 'hu', 'ri', 'at'][d]).join(', ') }, { k: 'lag', h: 'Pays after (wd)', num: true, v: c => c.lag }, { k: 'bl', h: 'Bank lag (wd)', num: true, v: c => c.bankLag }, { k: 'fee', h: 'Fee', num: true, v: c => (c.pct * 100).toFixed(1) + ' % + ' + c.fix.toFixed(2) + ' €' }, { k: 'sla', h: 'SLA (wd)', num: true, v: c => c.sla }], { nocsv: true }) + '</div>';
  }

  /* ---------- drawers ---------- */
  function codBlock(p) {
    const o = codOf(p); if (!o) return '';
    let h = '<h3>Cash on delivery</h3><dl class="dl"><dt>State</dt><dd>' + cbadge(o.state) + '</dd><dt>Expected</dt><dd>' + eur(o.expected) + '</dd>';
    if (o.item) h += '<dt>Carrier paid</dt><dd>' + eur(o.paid) + '</dd><dt>Batch</dt><dd><button class="lnk" data-act="batch" data-id="' + o.batch.id + '">' + esc(o.batch.ref) + '</button> (on bank ' + fd(o.batch.bankDate) + (o.batch.onBank ? '' : ', not yet') + ')</dd>';
    if (o.mismatch) { const d = st.cod[p.id]; h += '<dt>Difference</dt><dd class="' + (o.diff < 0 ? 'neg' : 'pos') + '">' + eur(o.diff) + '</dd><dt>Decision</dt><dd>' + (d ? (d.how === 'claim' ? 'Claim ' + esc(d.claim) : 'Reconciled') + ' by ' + esc((PERSON[d.by] || {}).name || d.by) + ', ' + fd(d.at) + (d.note ? '<br><span class="muted">' + esc(d.note) + '</span>' : '') : 'Open') + '</dd></dl><div style="margin-bottom:12px">' + mmActions(o) + '</div>'; } else h += '</dl>';
    return h;
  }
  function parcelBody(p) {
    const c = st.cases[p.id], rules = issuesOf(p), cr = CAR[p.carrier];
    let h = '<div style="margin-bottom:8px">' + sbadge(p.status) + ' ' + rules.map(x => badge(RULES.find(y => y.id === x).t, 'warn')).join(' ') + '</div><dl class="dl"><dt>Order</dt><dd>' + esc(p.no) + ' · ' + esc(SHOP[p.shop].name) + '</dd><dt>Tracking</dt><dd class="mono">' + esc(p.track) + '</dd><dt>Tracking link</dt><dd class="mono muted">' + esc('https://track.' + cr.id.split('-')[0] + '.example/' + p.track) + '</dd><dt>Carrier</dt><dd>' + carDot(p.carrier) + ' · ' + esc(cr.name) + '</dd><dt>Customer</dt><dd>' + esc(p.name) + '<br><span class="muted">' + esc(p.email) + '</span></dd><dt>Destination</dt><dd>' + esc(p.city) + ', ' + p.cc + ' · ' + (p.kind === 'locker' ? 'locker' : 'home delivery') + '</dd><dt>Created</dt><dd>' + fdt(p.created) + '</dd><dt>Value / weight</dt><dd>' + eur(p.value) + ' · ' + p.weight + ' kg</dd>' + (p.days != null ? '<dt>Delivery time</dt><dd>' + p.days + ' working days ' + (p.onTime ? badge('on time', 'good') : badge('late', 'bad')) + '</dd>' : '') + '</dl>';
    h += codBlock(p) + '<h3>Scan history</h3><ul class="tl">' + p.ev.slice().reverse().map(e => '<li class="' + (e.code === 'info' ? 'info' : e.code === 'delivered' ? 'good' : /failed|lost|damaged|returned|returning/.test(e.code) ? 'bad' : '') + '"><div class="t">' + fdt(e.ts) + (e.loc ? ' · ' + esc(e.loc) : '') + '</div>' + esc(e.text) + '</li>').join('') + '</ul>';
    if (c || rules.length) {
      h += '<h3>Case</h3>' + (c ? '' : '<p class="muted">Not yet worked on.</p>') + '<div class="grid2"><div class="field"><label for="c_who">Assignee</label><select id="c_who" data-case="assignee" data-pid="' + p.id + '"><option value="">Nobody</option>' + D.TEAM.map(t => '<option value="' + t.id + '"' + (c && c.assignee === t.id ? ' selected' : '') + '>' + esc(t.name) + '</option>').join('') + '</select></div><div class="field"><label for="c_act">Next action</label><select id="c_act" data-case="action" data-pid="' + p.id + '"><option value="">None</option>' + ACTIONS.map(a => '<option' + (c && c.action === a ? ' selected' : '') + '>' + a + '</option>').join('') + '</select></div></div>' +
        '<label><input type="checkbox" data-case="resolved" data-pid="' + p.id + '" ' + (c && c.resolved ? 'checked' : '') + '> Resolved</label>' + (c && c.notes.length ? c.notes.map(n => '<div class="note"><span class="muted">' + fdt(n.at) + ' · ' + esc((PERSON[n.by] || {}).name || n.by) + '</span><br>' + esc(n.text) + '</div>').join('') : '') +
        '<div class="field" style="margin-top:8px"><label for="c_note">Add a note</label><textarea id="c_note" placeholder="What happened, what next?"></textarea></div><button class="btn sm" data-act="note" data-id="' + p.id + '">Add note</button>';
    } else h += '<button class="btn" data-act="toqueue" data-id="' + p.id + '">Add to work queue</button>';
    if (c && c.manual) h += ' <button class="btn sm" data-act="unqueue" data-id="' + p.id + '">Remove manual flag</button>';
    return h;
  }
  function openParcel(id) { const p = IX.p[id]; if (p) openDrawer('Parcel ' + p.no, () => parcelBody(p)); }
  function openBatch(id) {
    const b = IX.b[id]; if (!b) return;
    openDrawer(b.ref, () => {
      const stt = batchStatus(b), open = batchOpen(b), tie = Math.round(b.gross * 100) - Math.round(b.fees * 100) === Math.round(b.net * 100), rec = st.batches[b.id];
      return '<dl class="dl"><dt>Carrier</dt><dd>' + carDot(b.carrier) + '</dd><dt>Payout date</dt><dd>' + fd(b.payDate) + '</dd><dt>Bank arrival</dt><dd>' + fd(b.bankDate) + (b.onBank ? '' : ' (expected)') + '</dd><dt>Gross</dt><dd>' + eur(b.gross) + '</dd><dt>Fees</dt><dd>' + eur(b.fees) + '</dd><dt>Net to bank</dt><dd><b>' + eur(b.net) + '</b> ' + (tie ? badge('gross − fees = net', 'good') : badge('does not add up', 'bad')) + '</dd><dt>Status</dt><dd>' + badge(BS_L[stt], BS_C[stt]) + (rec ? ' by ' + esc((PERSON[rec.by] || {}).name || rec.by) + ', ' + fd(rec.at) : '') + '</dd></dl>' +
        '<div style="margin-bottom:12px">' + (rec ? '<button class="btn" data-act="batchundo" data-id="' + b.id + '">Undo reconciled</button>' : '<button class="btn pri" data-act="batchrec" data-id="' + b.id + '"' + (b.onBank && !open ? '' : ' disabled') + '>Mark reconciled</button> <span class="muted">' + (!b.onBank ? 'Not on the bank statement yet.' : open ? open + ' open differences first.' : '') + '</span>') + '</div>' +
        '<h3>Parcels (' + b.items.length + ')</h3><div class="tw"><table class="tbl"><thead><tr><th>Order</th><th class="num">Expected</th><th class="num">Paid</th><th class="num">Fee</th><th></th></tr></thead><tbody>' + b.items.map(it => { const p = IX.p[it.pid], o = codOf(p); return '<tr class="row" data-act="parcel" data-id="' + p.id + '"><td>' + esc(p.no) + '</td><td class="num">' + eur(it.expected) + '</td><td class="num">' + eur(it.paid) + '</td><td class="num">' + eur(it.fee) + '</td><td>' + (o.state === 'short' || o.state === 'paidret' ? cbadge(o.state) : '') + (it.xfee ? badge('extra fee', 'warn') : '') + '</td></tr>'; }).join('') + '</tbody></table></div>';
    });
  }

  /* ---------- actions ---------- */
  function ensureCase(pid) { return st.cases[pid] || (st.cases[pid] = { assignee: '', action: '', resolved: false, notes: [], manual: false }); }
  const ACT = {
    close: () => closeLayer(),
    parcel: el => openParcel(el.dataset.id), batch: el => openBatch(el.dataset.id),
    tgl: el => { ui.tbl[el.dataset.id] = !ui.tbl[el.dataset.id]; saveUi(); render(); },
    sort: el => { const id = el.dataset.t, k = el.dataset.k, s = ui.sort[id]; ui.sort[id] = { k: k, dir: s && s.k === k ? -s.dir : 1 }; saveUi(); refresh(id); },
    page: el => { ui.page[el.dataset.t] = Math.max(0, (ui.page[el.dataset.t] || 0) + (+el.dataset.d)); saveUi(); refresh(el.dataset.t); },
    csv: el => csvOut(el.dataset.t),
    qrule: el => { F('e').rule = el.dataset.id; ui.page.e = 0; saveUi(); if (location.hash !== '#/exceptions') location.hash = '#/exceptions'; else render(); },
    costate: el => { const f = F('co'); f.state = f.state === el.dataset.id ? '' : el.dataset.id; ui.page.co = 0; saveUi(); render(); },
    mmtype: el => { F('mm').t = el.dataset.id; ui.page.mm = 0; saveUi(); render(); },
    regen: () => modal({ title: 'Regenerate for today', body: '<p>This builds the demo parcels for today and clears all cases, COD decisions and claims.</p>', ok: 'Regenerate', danger: true, onSubmit: () => { freshState(U.anchorNow()); save(); toast('Regenerated'); render(); } }),
    toqueue: el => { const c = ensureCase(el.dataset.id); c.manual = true; c.resolved = false; commit('Added ' + IX.p[el.dataset.id].no + ' to the work queue'); },
    unqueue: el => { ensureCase(el.dataset.id).manual = false; commit('Removed manual flag on ' + IX.p[el.dataset.id].no); },
    note: el => { const t = $('#c_note').value.trim(); if (!t) { toast('Write a note first'); return; } ensureCase(el.dataset.id).notes.push({ at: nowLj(), by: st.me, text: t }); commit('Note on ' + IX.p[el.dataset.id].no); },
    bulk: el => {
      const k = el.dataset.k; if (k === 'clear') { SEL.clear(); render(); return; }
      const v = k === 'assignee' ? $('#bwho').value : k === 'action' ? $('#bact').value : ''; if ((k === 'assignee' || k === 'action') && !v) { toast('Choose a value first'); return; }
      const n = SEL.size; SEL.forEach(pid => { const c = ensureCase(pid); if (k === 'assignee') c.assignee = v; else if (k === 'action') c.action = v; else c.resolved = k === 'resolve'; });
      SEL.clear(); commit('Bulk ' + k + ' on ' + n + ' parcels');
    },
    codrec: el => { const o = codOf(IX.p[el.dataset.id]); modal({ title: 'Reconcile ' + o.p.no, body: '<p>' + COD_L[o.state] + ', difference ' + eur(o.diff) + '.</p><div class="field"><label for="m_note">Note (optional)</label><input id="m_note" name="note"></div>', ok: 'Mark reconciled', onSubmit: v => { st.cod[o.p.id] = { how: 'reconciled', by: st.me, at: nowLj(), note: v.note || '' }; commit('Reconciled COD of ' + o.p.no); } }); },
    codclaim: el => { const o = codOf(IX.p[el.dataset.id]); modal({ title: 'Open claim for ' + o.p.no, body: '<p>Claim of ' + eur(Math.abs(o.diff)) + ' from ' + esc(CAR[o.p.carrier].name) + '. Nothing is sent to the carrier.</p><div class="field"><label for="m_note">What do you claim?</label><input id="m_note" name="note" required></div>', ok: 'Open claim', onSubmit: v => { if (!(v.note || '').trim()) return 'Please describe the claim.'; claimFor(o, st.me, nowLj(), v.note.trim()); commit('Opened claim for ' + o.p.no); } }); },
    codundo: el => { const pid = el.dataset.id, d = st.cod[pid]; if (d && d.how === 'claim') st.claims = st.claims.filter(c => c.no !== d.claim); delete st.cod[pid]; commit('Undid COD decision on ' + IX.p[pid].no); },
    claimset: el => { const c = st.claims.find(x => x.no === el.dataset.id); c.status = el.dataset.s; commit('Claim ' + c.no + ' ' + c.status); },
    batchrec: el => { const b = IX.b[el.dataset.id]; if (!b.onBank || batchOpen(b)) return; st.batches[b.id] = { by: st.me, at: nowLj() }; commit('Reconciled ' + b.ref); },
    batchundo: el => { delete st.batches[el.dataset.id]; commit('Undid reconciliation of ' + IX.b[el.dataset.id].ref); },
    thrdef: () => { st.settings = defaultSettings(); commit('Thresholds reset'); }
  };
  function refresh(id) { const w = $('#tw-' + id); if (w) w.innerHTML = ({ p: tableP, e: tableE, co: tableCo, ba: tableBa, mm: tableMm, cl: tableCl }[id])(); else render(); }
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-act]'); if (!a) return;
    if (a.tagName === 'TR' && e.target.matches('input,select,label,textarea')) return;
    if (a.hasAttribute('disabled')) return;
    if (ACT[a.dataset.act]) ACT[a.dataset.act](a, e);
  });
  document.addEventListener('input', e => {
    const t = e.target;
    if (t.id === 'q') { ui.q = t.value; saveUi(); $('#sres').innerHTML = searchHtml(t.value); }
    else if (t.dataset.f && t.tagName === 'INPUT') { const [id, k] = t.dataset.f.split(':'); F(id)[k] = t.value; ui.page[id] = 0; saveUi(); refresh(id); }
  });
  document.addEventListener('change', e => {
    const t = e.target, d = t.dataset;
    if (d.f && t.tagName === 'SELECT') { const [id, k] = d.f.split(':'); F(id)[k] = t.value; ui.page[id] = 0; saveUi(); refresh(id); if (id === 'p' || id === 'e') {} }
    else if (d.sel) { t.checked ? SEL.add(d.sel) : SEL.delete(d.sel); $('#bulkw').innerHTML = bulkBar(); }
    else if (d.selall !== undefined) { TBL.e.list.forEach(r => t.checked ? SEL.add(r.p.id) : SEL.delete(r.p.id)); refresh('e'); $('#bulkw').innerHTML = bulkBar(); }
    else if (d.case) { const c = ensureCase(d.pid); c[d.case] = d.case === 'resolved' ? t.checked : t.value; commit('Case ' + IX.p[d.pid].no + ': ' + d.case); }
    else if (t.id === 'me') { st.me = t.value; commit('Now working as ' + PERSON[st.me].name); }
  });
  document.addEventListener('submit', e => {
    if (e.target.id !== 'thrForm') return; e.preventDefault();
    const f = e.target, lim = { stuckDays: [1, 10], failedMin: [1, 5], pickupDays: [2, 14], codOverdueDays: [7, 60] }, n = {};
    for (const k in lim) { const v = +f.elements[k].value; if (!Number.isInteger(v) || v < lim[k][0] || v > lim[k][1]) { $('#thrErr').textContent = k + ' must be a whole number from ' + lim[k][0] + ' to ' + lim[k][1] + '.'; return; } n[k] = v; }
    st.settings = n; commit('Thresholds saved');
  });

  /* ---------- router ---------- */
  const NAV = [['#/', 'Overview', /^$|^overview$/], ['#/search', 'Search', /^search/], ['#/parcels', 'Parcels', /^parcels/], ['#/exceptions', 'Work queue', /^exceptions/, () => openExceptions().length], ['#/cod/outstanding', 'COD', /^cod/, () => openMismatches().length], ['#/scorecard', 'Scorecard', /^scorecard/], ['#/settings', 'Settings', /^settings/]];
  const PAGES = { '': pageOverview, search: pageSearch, parcels: pageParcels, exceptions: pageExceptions, cod: pageCod, scorecard: pageScorecard, settings: pageSettings };
  function route() { const p = location.hash.replace(/^#\/?/, '').split('/'); return { page: p[0] in PAGES ? p[0] : '', sub: p[1] || '' }; }
  function render(nav) {
    if (!st) return; const r = route(), y = window.scrollY;
    $('#nav').innerHTML = NAV.map(n => '<a href="' + n[0] + '"' + (n[2].test(location.hash.replace(/^#\/?/, '')) ? ' aria-current="page"' : '') + '>' + n[1] + (n[3] && n[3]() ? '<span class="cnt">' + n[3]() + '</span>' : '') + '</a>').join('');
    $('#asof').textContent = 'Fictional parcels as of ' + fdt(st.anchor);
    $('#main').innerHTML = staleNotice() + PAGES[r.page](r);
    document.title = (NAV.find(n => n[2].test(location.hash.replace(/^#\/?/, ''))) || NAV[0])[1] + ' · Parcels & COD';
    paintDr(); if (nav) window.scrollTo(0, 0); else window.scrollTo(0, y);
  }
  window.addEventListener('hashchange', () => { SEL.clear(); render(true); });
  window.addEventListener('adrial-theme', () => render());

  /* reset */
  $('#resetBtn').addEventListener('click', () => modal({ title: 'Reset demo data', body: '<p>This deletes all your decisions in this browser (cases, COD decisions, claims, settings) and rebuilds the demo for today.</p>', ok: 'Reset', danger: true, onSubmit: () => { freshState(U.anchorNow()); enqueue(idbDel).then(() => idbPut(JSON.parse(JSON.stringify(st)))).then(() => bc && bc.postMessage({ type: 'changed' })); toast('Demo data reset'); render(true); } }));

  /* cloud sync (optional, inert here) */
  function syncSnapshot() { return JSON.parse(JSON.stringify(st)); }
  function applyCloud(s) { if (validState(s)) { st = ensureState(s); loadData(); render(); } }
  /* start */
  (async function boot() {
    let s = await idbGet(); const now = U.anchorNow();
    if (validState(s)) { st = ensureState(s); if (!st.touched && st.anchor.slice(0, 10) !== now.slice(0, 10)) { freshState(now); save(); } else loadData(); }
    else { freshState(now); dirty = true; flush(); }
    if (!location.hash) history.replaceState(null, '', '#/');
    render(true);
    try { if (window.AdrialSync && AdrialSync.attach) { const c = AdrialSync.attach({ app: 'parcels', getSnapshot: syncSnapshot, applySnapshot: applyCloud }); if (c && c.mountPanel) c.mountPanel($('#syncPanel')); } } catch (e) {}
  })();
})();
