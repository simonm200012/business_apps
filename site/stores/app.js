/* Store daily board demo: vanilla JS single-page app.
 * Trading history comes from data.js (deterministic, generated on every load, never stored).
 * What people change (cash checks, "called" / "replied" marks, notes, tasks) is one small document in
 * IndexedDB "adrial-stores" (store "kv", key "state"); other tabs hear about saves on
 * BroadcastChannel("adrial-stores"), and cloud sync (app id "stores") uploads the same document.
 * localStorage "adrial-stores-ui" keeps per-viewer preferences only (viewing as, tile/table, chart picks).
 * Routes: #/ (all stores), #/store/<id>, #/trends, #/staff, #/tasks.
 * LIVE mode (allow-listed accounts only, see /stores.js): pages read /api/stores/* (the real 8 optics stores)
 * into page memory only (LC) — never into localStorage, IndexedDB or the sync snapshot. The team's own work on
 * live stores (cash checks, notes, tasks) is kept apart in state.live and only goes to the cloud copy of an
 * account that is on the live-data list (syncSnapshot). */
(function () {
  'use strict';

  const D = window.StoresData, U = D.util, STORES = D.STORES, SB = D.byId;
  const $ = (id) => document.getElementById(id);
  const TZ = 'Europe/Ljubljana';

  // ── Mode: demo (generated stores) or live (the real 8 stores) ────────────
  let MODE = 'demo';
  const LIVE = () => MODE === 'live';
  const LSTORES = [['Komenda', 'SI'], ['Koper', 'SI'], ['Maribor', 'SI'], ['Novo mesto', 'SI'], ['Zagreb', 'HR'], ['Split', 'HR'], ['Rijeka', 'HR'], ['Zadar', 'HR']]
    .map((x) => ({ id: x[0].toLowerCase().replace(/\s+/g, '-'), name: x[0], country: x[1], kind: 'Optics store' }));
  const LSB = {}; LSTORES.forEach((s) => { LSB[s.id] = s; });
  const SL = () => (LIVE() ? LSTORES : STORES);      // store list of the current mode
  const SBX = () => (LIVE() ? LSB : SB);             // stores by id of the current mode
  const TD = () => (LIVE() ? state.live : state);    // the editable document of the current mode (tasks, notes, cash checks)
  const VA = () => (LIVE() ? ui.lviewAs : ui.viewAs);
  function emptyLive() { return { cash: {}, notes: {}, tasks: [], taskDone: {}, nextTask: 1 }; }
  function ensureLive(s) {
    if (!s) return s;
    const l = s.live && typeof s.live === 'object' ? s.live : {};
    s.live = { cash: l.cash && typeof l.cash === 'object' ? l.cash : {}, notes: l.notes && typeof l.notes === 'object' ? l.notes : {},
      tasks: Array.isArray(l.tasks) ? l.tasks : [], taskDone: l.taskDone && typeof l.taskDone === 'object' ? l.taskDone : {}, nextTask: +l.nextTask || 1 };
    return s;
  }

  // ── Time in Ljubljana ────────────────────────────────────────────────────
  function nowLj() {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
    const g = (t) => (p.find((x) => x.type === t) || {}).value;
    return { date: g('year') + '-' + g('month') + '-' + g('day'), min: (+g('hour')) * 60 + (+g('minute')), hm: g('hour') + ':' + g('minute') };
  }
  const TODAY = nowLj().date, YDAY = U.addDays(TODAY, -1), MIN_DATE = U.addDays(YDAY, -119);
  let cur = YDAY;                                  // the board date ("yesterday" by default)
  const boardToday = () => U.addDays(cur, 1);      // the morning the board is read on

  // ── Formatting (sl-SI numbers, dates d. m. yyyy) ─────────────────────────
  const NF2 = new Intl.NumberFormat('sl-SI', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const NF1 = new Intl.NumberFormat('sl-SI', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const NF0 = new Intl.NumberFormat('sl-SI', { maximumFractionDigits: 0 });
  const NF1k = new Intl.NumberFormat('sl-SI', { maximumFractionDigits: 1 });
  const NF3 = new Intl.NumberFormat('sl-SI', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
  const eur = (n) => NF2.format(n || 0) + ' €';
  const eur0 = (n) => NF0.format(Math.round(n || 0)) + ' €';
  const num = (n) => NF0.format(n || 0);
  const pct = (x, d) => (x == null || !isFinite(x) ? '—' : (d === 0 ? NF0 : NF1).format(x * 100) + ' %');
  const sgnPct = (x) => (x == null || !isFinite(x) ? '—' : (x > 0 ? '+' : x < 0 ? '−' : '±') + NF1.format(Math.abs(x) * 100) + ' %');
  const sgnEur = (x) => (x > 0 ? '+' : x < 0 ? '−' : '±') + eur(Math.abs(x));
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const WDL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const fdate = (s) => (s ? +s.slice(8, 10) + '. ' + +s.slice(5, 7) + '. ' + s.slice(0, 4) : '—');
  const fdm = (s) => +s.slice(8, 10) + '. ' + +s.slice(5, 7) + '.';
  const fday = (s) => WD[U.dow(s)] + ' ' + fdate(s);
  const fdayShort = (s) => WD[U.dow(s)] + ' ' + fdm(s);
  const hm = (m) => (m == null ? '—' : U.pad(Math.floor(m / 60)) + ':' + U.pad(m % 60));
  const fts = (ts) => (ts ? fdm(ts.slice(0, 10)) + ' ' + ts.slice(11, 16) : '');
  const hrs = (h) => NF1.format(h) + ' h';
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function nowTs() { const n = nowLj(); return n.date + 'T' + n.hm; }
  function monthName(ym) { return new Date(+ym.slice(0, 4), +ym.slice(5, 7) - 1, 1).toLocaleString('en-GB', { month: 'long' }); }

  const IC = {
    x: 'M6 6l12 12M18 6L6 18', plus: 'M12 5v14M5 12h14', exp: 'M12 4v12M6 10l6 6 6-6M5 20h14', back: 'M15 6l-6 6 6 6', fwd: 'M9 6l6 6-6 6',
    grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z', store: 'M4 10v10h16V10M3 10l2-6h14l2 6M3 10h18M9 20v-5h6v5',
    chart: 'M4 20V4M4 20h16M8 16l4-5 3 3 5-7', users: 'M16 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 20v-1a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
    tasks: 'M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2', check: 'M5 12l5 5 9-10', phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z',
    undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3', trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3', cal: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
    warn: 'M12 4l9 16H3zM12 10v4M12 17v.01', bad: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8v5M12 16v.01', ok: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8 12l3 3 5-6', moon: 'M5 12h14'
  };
  const ic = (n) => '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="' + IC[n] + '"/></svg>';
  const ST = { good: ['On track', 'ok'], warn: ['Check', 'warn'], bad: ['Act now', 'bad'], closed: ['Closed', 'moon'] };
  const stBadge = (lv) => '<span class="st ' + lv + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + IC[ST[lv][1]] + '"/></svg>' + ST[lv][0] + '</span>';

  // ── Storage: IndexedDB document + BroadcastChannel + localStorage prefs ──
  const UIKEY = 'adrial-stores-ui', IDB_NAME = 'adrial-stores', IDB_STORE = 'kv', IDB_REC = 'state';
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* blocked */ } }
  let idbOK = true, idbPromise = null;
  function idbOpen() {
    if (!idbPromise) {
      idbPromise = new Promise((resolve, reject) => {
        try {
          if (!window.indexedDB) throw new Error('IndexedDB not available');
          const rq = indexedDB.open(IDB_NAME, 1);
          rq.onupgradeneeded = () => { if (!rq.result.objectStoreNames.contains(IDB_STORE)) rq.result.createObjectStore(IDB_STORE); };
          rq.onsuccess = () => { const d = rq.result; d.onversionchange = () => { d.close(); idbPromise = null; }; resolve(d); };
          rq.onerror = () => reject(rq.error || new Error('IndexedDB open failed'));
          rq.onblocked = () => reject(new Error('IndexedDB open blocked'));
        } catch (e) { reject(e); }
      });
      idbPromise.catch(() => { idbPromise = null; });
    }
    return idbPromise;
  }
  function idbTx(mode, fn) {
    return idbOpen().then((d) => new Promise((resolve, reject) => {
      let tx, out;
      try { tx = d.transaction(IDB_STORE, mode); out = fn(tx.objectStore(IDB_STORE)); } catch (e) { reject(e); return; }
      tx.oncomplete = () => resolve(out && 'result' in out ? out.result : undefined);
      tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
      tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
    }));
  }
  const idbGet = () => idbTx('readonly', (st) => st.get(IDB_REC));
  const idbPut = (v) => idbTx('readwrite', (st) => { st.put(v, IDB_REC); });

  let storageWarned = false, saveTimer = null, writeQ = Promise.resolve();
  function storageFailed(err) {
    idbOK = false;
    if (err && window.console) console.warn('Store board: IndexedDB unavailable, keeping changes in memory only.', err);
    if (!storageWarned) { storageWarned = true; setTimeout(() => toast('Browser storage is unavailable: changes last until you reload.'), 50); }
  }
  function enqueue(job) { writeQ = writeQ.then(job).catch(storageFailed); return writeQ; }
  function save() {
    state.updatedAt = nowTs();
    if (!idbOK) { syncChanged(); return; }
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 250);
  }
  function flush() {
    if (!saveTimer) return writeQ;
    clearTimeout(saveTimer); saveTimer = null;
    const snap = state;
    return enqueue(() => idbPut(snap).then(announce).then(syncChanged));
  }
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });

  let channel = null;
  try { if (window.BroadcastChannel) channel = new BroadcastChannel('adrial-stores'); } catch (e) { channel = null; }
  function announce() { if (channel) { try { channel.postMessage({ type: 'changed' }); } catch (e) { /* closed */ } } }

  function validState(o) { return !!(o && o.version === D.VERSION && Array.isArray(o.tasks) && o.cash && o.called && o.replied && o.notes && o.taskDone); }
  let state = null, fresh = false;
  function boot() {
    return idbGet().then((st) => {
      if (validState(st)) return ensureLive(st);
      const g = ensureLive(D.initialState(TODAY)); fresh = true;
      return idbPut(g).then(() => g);
    }).catch((err) => { storageFailed(err); fresh = true; return ensureLive(D.initialState(TODAY)); });
  }

  let ui = {};
  try { ui = JSON.parse(lsGet(UIKEY) || '{}') || {}; } catch (e) { ui = {}; }
  function uiDef(k, v) { if (ui[k] === undefined) ui[k] = v; return ui[k]; }
  uiDef('viewAs', 'HO'); uiDef('allView', window.matchMedia && window.matchMedia('(max-width: 700px)').matches ? 'tiles' : 'table');
  uiDef('country', ''); uiDef('sort', { k: 'status', dir: 1 });
  uiDef('tr', { metric: 'revenue', range: 60, grain: 'week', stores: [] }); uiDef('staff', { period: 30, store: '', sort: 'name', dir: 1 });
  uiDef('tasks', { filter: 'open', store: '' }); uiDef('pick', 'call');
  if (ui.viewAs !== 'HO' && !SB[ui.viewAs]) ui.viewAs = 'HO';
  // live-mode preferences: store ids and chart picks only, never numbers
  uiDef('lviewAs', 'HO'); uiDef('lsort', { k: 'status', dir: 1 }); uiDef('ltr', { metric: 'taken', range: 90, grain: 'week', stores: [], part: 'both' });
  if (ui.lviewAs !== 'HO' && !LSB[ui.lviewAs]) ui.lviewAs = 'HO';
  function saveUi() { lsSet(UIKEY, JSON.stringify(ui)); }
  const viewLabel = () => (VA() === 'HO' ? 'Head office' : SBX()[VA()].name + ' store');

  // ── Derived numbers ──────────────────────────────────────────────────────
  const day = (id, d) => D.day(id, d);
  const isOpen = (id, d) => !!D.hours(id, d);
  function sameWeekdayAvg(id, date, n) {
    n = n || 6;
    const out = { revenue: 0, receipts: 0, avg: 0, units: 0, done: 0, conv: 0, discount: 0, n: 0 };
    let conv = 0, done = 0;
    for (let i = 1, g = 0; out.n < n && g < 20; i++, g++) {
      const dd = day(id, U.addDays(date, -7 * i));
      if (!dd.open) continue;
      out.revenue += dd.revenue; out.receipts += dd.receipts; out.units += dd.units; out.done += dd.exams.done; out.discount += dd.discount;
      conv += dd.exams.converted; done += dd.exams.done; out.n++;
    }
    if (!out.n) return null;
    ['revenue', 'receipts', 'units', 'done', 'discount'].forEach((k) => { out[k] /= out.n; });
    out.avg = out.revenue / Math.max(1, out.receipts); out.conv = done ? conv / done : null;
    return out;
  }
  function mtd(id, date) {
    const ym = date.slice(0, 7), n = U.monthDays(ym);
    let sum = 0, elapsed = 0, total = 0, ly = 0;
    for (let d = 1; d <= n; d++) {
      const ds = ym + '-' + U.pad(d);
      if (!isOpen(id, ds)) continue;
      total++;
      if (ds <= date) { elapsed++; sum += day(id, ds).revenue; }
    }
    const lyY = (+ym.slice(0, 4) - 1) + ym.slice(4), lyEnd = lyY + date.slice(7);
    for (let d = 1; d <= +date.slice(8, 10); d++) { const dd = day(id, lyY + '-' + U.pad(d)); if (dd.open) ly += dd.revenue; }
    const target = D.monthTarget(id, ym), expected = total ? target * elapsed / total : 0, remaining = total - elapsed;
    return { ym: ym, sum: sum, target: target, elapsed: elapsed, total: total, remaining: remaining, expected: expected, pct: target ? sum / target : 0,
      pace: expected ? sum / expected : null, need: remaining ? Math.max(0, target - sum) / remaining : 0, runRate: elapsed ? sum / elapsed : 0, ly: ly, lyEnd: lyEnd,
      projected: elapsed ? sum / elapsed * total : 0 };
  }
  const lyDate = (d) => U.addDays(d, -364);
  function vsLy(id, d) { const a = day(id, d), b = day(id, lyDate(d)); return a.open && b.open && b.revenue ? a.revenue / b.revenue - 1 : null; }

  function woList(id) { return D.workOrders(id, TODAY); }
  function pickups(id, asOf) {
    return woList(id).filter((w) => w.ready <= asOf && w.pickedUp > asOf).map((w) => {
      const wait = U.diffDays(w.ready, asOf), mine = state.called[w.id];
      const reminded = w.remindedOn && w.remindedOn <= asOf ? w.remindedOn : null;
      return { w: w, wait: wait, overdue: wait > 14, called: mine || null, reminded: reminded, needsCall: wait >= 7 && !mine && !reminded };
    }).sort((a, b) => b.wait - a.wait);
  }
  function labStatus(id, asOf) {
    const inLab = woList(id).filter((w) => w.created <= asOf && w.ready > asOf);
    const delayed = inLab.filter((w) => w.expected <= asOf).map((w) => ({ w: w, late: U.diffDays(w.expected, asOf) + 1 })).sort((a, b) => b.late - a.late);
    return { ordered: inLab.filter((w) => w.created === asOf).length, production: inLab.length, delayed: delayed };
  }
  function openComplaints(id, asOf) {
    return D.complaints(id, TODAY).filter((c) => c.opened <= asOf && c.resolved > asOf).map((c) => ({ c: c, age: U.diffDays(c.opened, asOf) })).sort((a, b) => b.age - a.age);
  }
  const rvIx = {};
  function reviewIndex(id) {
    if (rvIx[id]) return rvIx[id];
    const list = D.reviews(id, TODAY).slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const base = D.baseReviews(id), dates = [], cc = [], cs = [];
    let c = base[0], s = base[0] * base[1];
    list.forEach((r) => { c++; s += r.stars; dates.push(r.date); cc.push(c); cs.push(s); });
    return (rvIx[id] = { list: list, dates: dates, cc: cc, cs: cs, base: base });
  }
  function ratingAt(id, date) {
    const ix = reviewIndex(id);
    let lo = 0, hi = ix.dates.length - 1, k = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (ix.dates[m] <= date) { k = m; lo = m + 1; } else hi = m - 1; }
    const c = k < 0 ? ix.base[0] : ix.cc[k], s = k < 0 ? ix.base[0] * ix.base[1] : ix.cs[k];
    return { count: c, sum: s, avg: s / c };
  }
  function isReplied(r, asOf) { return !!(state.replied[r.id] || (r.repliedOn && r.repliedOn <= asOf)); }
  function reviewsFor(id, asOf) {
    const ix = reviewIndex(id), from7 = U.addDays(asOf, -6), from30 = U.addDays(asOf, -29);
    const recent = ix.list.filter((r) => r.date <= asOf && r.date >= from30);
    const unanswered = recent.filter((r) => !isReplied(r, asOf));
    const show = recent.filter((r) => r.date >= from7 || !isReplied(r, asOf)).reverse();
    return { week: recent.filter((r) => r.date >= from7), unanswered: unanswered, show: show, lowUnanswered: unanswered.filter((r) => r.stars <= 3) };
  }
  const cashKey = (id, d) => id + '|' + d;
  function attIssues(id, d) {
    const a = D.attendance(id, d);
    return { late: a.filter((x) => x.late > 0).length, missing: a.filter((x) => x.missingOut).length, absent: a.filter((x) => x.absent).length };
  }

  // traffic light: the worst of the reasons below decides the colour
  function storeStatus(id, d) {
    const dd = day(id, d), reasons = [];
    if (!dd.open) {
      return { level: 'closed', reasons: [{ lv: 'closed', t: dd.holiday ? 'Closed for ' + dd.holiday : 'Closed on ' + WDL[U.dow(d)] + 's' }] };
    }
    const m = mtd(id, d);
    if (m.pace != null && m.pace < 0.9) reasons.push({ lv: 'bad', t: 'Month to date ' + pct(1 - m.pace, 0) + ' behind pace', h: 'mtd' });
    else if (m.pace != null && m.pace < 0.95) reasons.push({ lv: 'warn', t: 'Month to date ' + pct(1 - m.pace, 0) + ' behind pace', h: 'mtd' });
    const chk = state.cash[cashKey(id, d)];
    if (!chk && Math.abs(dd.cash.diff) >= 5) reasons.push({ lv: 'bad', t: 'Cash difference ' + sgnEur(dd.cash.diff) + ' not checked', h: 'cash' });
    if (!chk && dd.cash.cardDiff) reasons.push({ lv: 'warn', t: 'Card terminal differs by ' + sgnEur(dd.cash.cardDiff), h: 'cash' });
    const pk = pickups(id, d), toCall = pk.filter((p) => p.overdue && p.needsCall).length;
    if (toCall >= 2) reasons.push({ lv: 'warn', t: toCall + ' overdue pickup' + (toCall === 1 ? '' : 's') + ' not called', h: 'pickups' });
    const lab = labStatus(id, d);
    if (lab.delayed.length >= 6) reasons.push({ lv: 'warn', t: lab.delayed.length + ' jobs delayed at the lab', h: 'pickups' });
    const oldC = openComplaints(id, d).filter((c) => c.age > 14).length;
    if (oldC) reasons.push({ lv: 'warn', t: oldC + ' complaint' + (oldC === 1 ? '' : 's') + ' open over 14 days', h: 'complaints' });
    const rv = reviewsFor(id, d);
    if (rv.lowUnanswered.length) reasons.push({ lv: 'warn', t: rv.lowUnanswered.length + ' low-star review' + (rv.lowUnanswered.length === 1 ? '' : 's') + ' without reply', h: 'reviews' });
    const ai = attIssues(id, d);
    if (ai.missing) reasons.push({ lv: 'warn', t: ai.missing + ' missing clock-out' + (ai.missing === 1 ? '' : 's'), h: 'staffToday' });
    const level = reasons.some((r) => r.lv === 'bad') ? 'bad' : reasons.length ? 'warn' : 'good';
    reasons.sort((a, b) => (a.lv === b.lv ? 0 : a.lv === 'bad' ? -1 : 1));
    return { level: level, reasons: reasons };
  }
  const LVORD = { bad: 0, warn: 1, good: 2, closed: 3 };

  function storeRow(id, d) {
    const s = SB[id], dd = day(id, d), sw = sameWeekdayAvg(id, d), m = mtd(id, d), st = storeStatus(id, d), r = ratingAt(id, d), r30 = ratingAt(id, U.addDays(d, -30));
    return {
      id: id, s: s, dd: dd, st: st, m: m, rating: r.avg, ratingCount: r.count, ratingDelta: r.avg - r30.avg,
      rev: dd.open ? dd.revenue : null, vsAvg: dd.open && sw ? dd.revenue / sw.revenue - 1 : null, vsLy: vsLy(id, d),
      avg: dd.open ? dd.avg : null, conv: dd.open && dd.exams.done ? dd.exams.converted / dd.exams.done : null, receipts: dd.open ? dd.receipts : null
    };
  }

  // ── Layers: modals, drawers, focus ───────────────────────────────────────
  const layers = []; let uid = 0;
  const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  function openLayer(html, opts) {
    const host = document.createElement('div');
    host.className = 'layer layer-' + (layers.length + 1);
    host.innerHTML = '<div class="scrim" data-close></div>' + html;
    $('layers').appendChild(host);
    const op = document.activeElement;
    const L = { el: host, opts: opts || {}, opener: op, openerKey: op && op.getAttribute ? (op.getAttribute('data-fid') || op.id) : '' };
    layers.push(L);
    host.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) { e.preventDefault(); closeLayer(L); } });
    return L;
  }
  function focusIn(el) {
    const f = el.querySelector('[data-autofocus]') || el.querySelector('.md-body input, .md-body textarea, .md-body select') || el.querySelector('.md-foot [type=submit]') || el.querySelector('[role=dialog]');
    if (f) f.focus();
  }
  function closeLayer(L, noRestore) {
    const i = layers.indexOf(L);
    if (i < 0) return;
    layers.splice(i, 1); L.el.remove();
    if (noRestore) return;
    let back = L.opener && L.opener.isConnected && L.opener !== document.body ? L.opener : null;
    if (!back && L.openerKey) back = document.querySelector('[data-fid="' + L.openerKey + '"]') || document.getElementById(L.openerKey);
    if (back) back.focus();
    else if (layers.length) focusIn(layers[layers.length - 1].el);
    else { const h = document.querySelector('#page h1'); if (h) h.focus({ preventScroll: true }); }
  }
  function closeAll() { while (layers.length) closeLayer(layers[layers.length - 1], true); }
  function withFocus(fn) {
    const a = document.activeElement, key = a && a !== document.body ? (a.getAttribute('data-fid') || a.id) : null;
    const y = window.scrollY;
    fn();
    if (key) { const n = document.querySelector('[data-fid="' + CSS.escape(key) + '"]') || document.getElementById(key); if (n) { n.focus({ preventScroll: true }); if (document.activeElement !== n) { const sec = n.closest('section[tabindex]'); if (sec) sec.focus({ preventScroll: true }); } window.scrollTo(0, y); if (document.activeElement && document.activeElement !== document.body) return; } }
    window.scrollTo(0, y);
    if (!document.activeElement || document.activeElement === document.body) { const h = document.querySelector('#page h1'); if (h) h.focus({ preventScroll: true }); }
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
  /* modal({title, body, submitLabel, danger, wide, onSubmit(form) -> error|null, mount(form), cancelLabel}) */
  function modal(o) {
    const id = 'mh' + (++uid);
    const foot = '<button type="button" class="btn ghost" data-close>' + esc(o.cancelLabel || 'Cancel') + '</button>' +
      (o.onSubmit ? '<button type="submit" class="btn ' + (o.danger ? 'danger' : 'pri') + '">' + esc(o.submitLabel || 'Save') + '</button>' : '');
    const html = '<form class="modal' + (o.wide ? ' wide' : '') + '" role="dialog" aria-modal="true" aria-labelledby="' + id + '" tabindex="-1" novalidate>' +
      '<div class="md-head"><h2 id="' + id + '">' + esc(o.title) + '</h2><button type="button" class="btn icon sm ghost" data-close aria-label="Close dialog">' + ic('x') + '</button></div>' +
      '<div class="md-body">' + o.body + '<div class="err" role="alert" hidden></div></div><div class="md-foot">' + foot + '</div></form>';
    const L = openLayer(html, o);
    const form = L.el.querySelector('form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!o.onSubmit) return;
      const err = o.onSubmit(form, L), box = form.querySelector('.err');
      if (err) { box.textContent = err; box.hidden = false; return; }
      closeLayer(L);
    });
    if (o.mount) o.mount(form, L);
    focusIn(L.el);
    return L;
  }
  function confirmBox(title, text, okLabel, onOk, danger) { modal({ title: title, body: '<p>' + text + '</p>', submitLabel: okLabel, danger: danger, onSubmit: () => onOk() || null }); }
  function drawer(title, eyebrow, body) {
    const id = 'dh' + (++uid);
    const L = openLayer('<aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="' + id + '" tabindex="-1"><div class="dr-head"><div style="min-width:0"><span class="eyebrow">' + eyebrow + '</span><h2 id="' + id + '">' + title + '</h2></div>' +
      '<button type="button" class="btn icon sm ghost" data-close aria-label="Close panel">' + ic('x') + '</button></div><div class="dr-body">' + body + '</div></aside>');
    L.el.querySelector('.drawer [data-close]').focus();
    return L;
  }
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 3200); }

  // ── CSV ──────────────────────────────────────────────────────────────────
  function csvCell(v) {
    if (v == null) v = '';
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(v)) v = "'" + v;
    v = String(v);
    return /[",;\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  const csvNum = (n, d) => (n == null || !isFinite(n) ? '' : String(Math.round(n * Math.pow(10, d == null ? 2 : d)) / Math.pow(10, d == null ? 2 : d)));
  function downloadCsv(name, header, rows) {
    const s = '﻿' + [header].concat(rows).map((r) => r.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([s], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = name + '-' + cur + '.csv';
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
    toast('Exported ' + num(rows.length) + ' rows to ' + a.download + ' (downloaded only, nothing is sent)');
  }

  // ── Charts (inline SVG, CSS-variable colours, crosshair tooltip) ─────────
  const charts = {};
  function niceMax(v, no25) { if (v <= 0) return 1; const e = Math.pow(10, Math.floor(Math.log10(v))), f = v / e; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 && !no25 ? 2.5 : f <= 5 ? 5 : 10) * e; }
  /* o: {id, labels:[str], series:[{name, color, values, dash}], fmt, axis, min0, aria, yMin, yMax} */
  function lineChart(o) {
    const W = 760, H = o.h || 260, L = 56, R = 12, T = 12, B = 28, iw = W - L - R, ih = H - T - B, n = o.labels.length;
    let lo = Infinity, hi = -Infinity;
    o.series.forEach((s) => s.values.forEach((v) => { if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }));
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    let y0 = o.yMin != null ? o.yMin : 0, y1 = o.yMax != null ? o.yMax : niceMax(hi * 1.05);
    if (o.tight) {
      const pad = (hi - lo) * 0.1 || Math.abs(hi) * 0.02 || 0.05;
      const lo2 = o.floor != null ? Math.max(o.floor, lo - pad) : lo - pad, hi2 = o.ceil != null ? Math.min(o.ceil, hi + pad) : hi + pad;
      let step = niceMax((hi2 - lo2) / 4);
      for (let g = 0; g < 8; g++) { y0 = Math.floor(lo2 / step + 1e-9) * step; if (y0 + 4 * step >= hi2 - 1e-9) break; step = niceMax(step * 1.01); }
      y1 = y0 + 4 * step;
      if (o.ceil != null && y1 > o.ceil) { y1 = o.ceil; y0 = y1 - 4 * step; }
    }
    const X = (i) => L + (n <= 1 ? iw / 2 : iw * i / (n - 1)), Y = (v) => T + ih - ih * (v - y0) / ((y1 - y0) || 1);
    let s = '';
    for (let g = 0; g <= 4; g++) {
      const v = y0 + (y1 - y0) * g / 4, y = T + ih - ih * g / 4;
      s += '<line class="' + (g ? 'grid-l' : 'base') + '" x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '"/>';
      s += '<text class="ax" x="' + (L - 8) + '" y="' + (y + 3.5) + '" text-anchor="end">' + esc((o.axis || o.fmt)(v)) + '</text>';
    }
    const step = Math.max(1, Math.ceil(n / 8));
    o.labels.forEach((lb, i) => { if (i % step === 0 || i === n - 1 && n - 1 - (Math.floor((n - 1) / step) * step) > step / 2) s += '<text class="ax" x="' + X(i) + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(lb) + '</text>'; });
    o.series.forEach((se) => {
      let d = '', pen = false;
      se.values.forEach((v, i) => { if (v == null) { pen = false; return; } d += (pen ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(v).toFixed(1); pen = true; });
      s += '<path class="line" d="' + d + '" style="stroke:' + se.color + '"' + (se.dash ? ' stroke-dasharray="5 5"' : '') + '/>';
      if (n <= 20) se.values.forEach((v, i) => { if (v != null) s += '<circle class="pt" cx="' + X(i).toFixed(1) + '" cy="' + Y(v).toFixed(1) + '" r="4" style="fill:' + se.color + '"/>'; });
    });
    s += '<line class="cross" x1="0" x2="0" y1="' + T + '" y2="' + (T + ih) + '" visibility="hidden"/>';
    const cw = n <= 1 ? iw : iw / (n - 1);
    o.labels.forEach((lb, i) => { s += '<rect class="hitc" data-i="' + i + '" x="' + (X(i) - cw / 2).toFixed(1) + '" y="' + T + '" width="' + cw.toFixed(1) + '" height="' + ih + '" fill="transparent"/>'; });
    charts[o.id] = { o: o, X: X };
    return '<div class="chart" data-chart="' + o.id + '"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(o.aria) + '">' + s + '</svg><div class="tip" hidden></div></div>';
  }
  /* stacked 100 % columns: o: {id, labels, keys:[{k,name,color}], rows:[{k:value}], aria} */
  function stackChart(o) {
    const W = 760, H = 260, L = 44, R = 8, T = 12, B = 28, iw = W - L - R, ih = H - T - B, n = o.labels.length;
    const gw = iw / n, bw = Math.max(4, Math.min(34, gw - 6));
    let s = '';
    for (let g = 0; g <= 4; g++) { const y = T + ih - ih * g / 4; s += '<line class="' + (g ? 'grid-l' : 'base') + '" x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '"/><text class="ax" x="' + (L - 8) + '" y="' + (y + 3.5) + '" text-anchor="end">' + g * 25 + ' %</text>'; }
    const step = Math.max(1, Math.ceil(n / 8));
    o.rows.forEach((r, i) => {
      const tot = o.keys.reduce((a, k) => a + (r[k.k] || 0), 0), x = L + gw * i + (gw - bw) / 2;
      let y = T + ih;
      if (tot > 0) o.keys.forEach((k) => {
        const h = ih * (r[k.k] || 0) / tot;
        if (h > 0) { s += '<rect x="' + x.toFixed(1) + '" y="' + (y - h + 1).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(0, h - 2).toFixed(1) + '" rx="2" style="fill:' + k.color + '"/>'; }
        y -= h;
      });
      if (i % step === 0) s += '<text class="ax" x="' + (L + gw * i + gw / 2) + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(o.labels[i]) + '</text>';
      s += '<rect class="hitc" data-i="' + i + '" x="' + (L + gw * i).toFixed(1) + '" y="' + T + '" width="' + gw.toFixed(1) + '" height="' + ih + '" fill="transparent"/>';
    });
    charts[o.id] = { o: o, stack: true };
    return '<div class="chart" data-chart="' + o.id + '"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(o.aria) + '">' + s + '</svg><div class="tip" hidden></div></div>';
  }
  function bindCharts() {
    document.querySelectorAll('#page .chart[data-chart]').forEach((c) => {
      const cfg = charts[c.getAttribute('data-chart')]; if (!cfg) return;
      const tip = c.querySelector('.tip'), cross = c.querySelector('.cross'), svg = c.querySelector('svg');
      c.addEventListener('mousemove', (e) => {
        const h = e.target.closest('.hitc');
        if (!h) { tip.hidden = true; if (cross) cross.setAttribute('visibility', 'hidden'); return; }
        const i = +h.getAttribute('data-i'), o = cfg.o;
        let html = '<b>' + esc(o.tipLabels ? o.tipLabels[i] : o.labels[i]) + '</b>';
        if (cfg.stack) {
          const r = o.rows[i], tot = o.keys.reduce((a, k) => a + (r[k.k] || 0), 0);
          o.keys.slice().reverse().forEach((k) => { html += '<div><span><i style="background:' + k.color + '"></i>' + esc(k.name) + '</span><span>' + pct(tot ? (r[k.k] || 0) / tot : 0) + '</span></div>'; });
        } else {
          o.series.forEach((se) => { html += '<div><span><i style="background:' + se.color + '"></i>' + esc(se.name) + '</span><span>' + (se.values[i] == null ? esc(o.nullText || 'closed') : esc(o.fmt(se.values[i]))) + '</span></div>'; });
          if (cross) { const x = cfg.X(i); cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.setAttribute('visibility', 'visible'); }
        }
        tip.innerHTML = html; tip.hidden = false;
        const r = c.getBoundingClientRect(); let x = e.clientX - r.left + 14; const tw = tip.offsetWidth;
        if (x + tw > r.width) x = e.clientX - r.left - tw - 14;
        tip.style.left = Math.max(0, x) + 'px'; tip.style.top = Math.max(0, e.clientY - r.top - 20) + 'px';
      });
      c.addEventListener('mouseleave', () => { tip.hidden = true; if (cross) cross.setAttribute('visibility', 'hidden'); });
      if (svg) svg.setAttribute('focusable', 'false');
    });
  }
  function spark(values) {
    const v = values.filter((x) => x != null); if (v.length < 2) return '';
    const lo = Math.min.apply(null, v), hi = Math.max.apply(null, v), W = 300, H = 46, n = values.length;
    let d = '';
    values.forEach((x, i) => { if (x == null) return; d += (d ? 'L' : 'M') + (W * i / (n - 1)).toFixed(1) + ',' + (4 + (H - 8) * (1 - (x - lo) / ((hi - lo) || 1))).toFixed(1); });
    return '<svg class="spark" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true"><path d="' + d + '" vector-effect="non-scaling-stroke"/></svg>';
  }
  const MIX = [{ k: 'frames', name: 'Frames', color: 'var(--c1)' }, { k: 'lenses', name: 'Lenses', color: 'var(--c2)' }, { k: 'cl', name: 'Contact lenses', color: 'var(--c3)' }, { k: 'sun', name: 'Sunglasses', color: 'var(--c4)' }, { k: 'services', name: 'Services (eye exams, repairs)', color: 'var(--ink3)' }];
  const SER = ['var(--c1)', 'var(--c2)', 'var(--c3)'];

  // ── Navigation, top bar ──────────────────────────────────────────────────
  let route = { base: '', id: null };
  function myStore() {
    const B = SBX(), v = VA(), last = LIVE() ? ui.llastStore : ui.lastStore;
    return v !== 'HO' ? v : (last && B[last] ? last : SL()[0].id);
  }
  function openTasksFor(viewAs) {
    const T = TD();
    return T.tasks.filter((t) => (viewAs === 'HO' ? t.stores.some((s) => !T.taskDone[t.id + '|' + s]) : t.stores.indexOf(viewAs) >= 0 && !T.taskDone[t.id + '|' + viewAs])).length;
  }
  function renderNav() {
    renderChrome();
    const ms = myStore(), tn = openTasksFor(VA());
    const items = [
      ['All stores', '#/', 'grid', route.base === '', ''],
      [VA() === 'HO' ? 'Store board' : 'My store board', '#/store/' + ms, 'store', route.base === 'store', VA() === 'HO' ? SBX()[ms].name : ''],
      ['Trends', '#/trends', 'chart', route.base === 'trends', ''],
      ['Staff hours', '#/staff', 'users', route.base === 'staff', ''],
      ['Tasks', '#/tasks', 'tasks', route.base === 'tasks', tn ? tn + ' open' : '']
    ];
    $('nav').innerHTML = items.map((n) => '<a href="' + n[1] + '"' + (n[3] ? ' aria-current="page"' : '') + '>' + ic(n[2]) + '<span>' + esc(n[0]) + '</span>' + (n[4] ? '<span class="count">' + esc(n[4]) + '</span>' : '') + '</a>').join('');
  }
  function dateBounds() { if (!LIVE()) return { min: MIN_DATE, max: YDAY }; const mx = lthrough() || YDAY; return { min: U.addDays(mx, -365), max: mx }; }
  function renderTop() {
    const va = VA(), b = dateBounds(), live = LIVE();
    const opts = '<option value="HO"' + (va === 'HO' ? ' selected' : '') + '>Head office (all stores)</option>' +
      ['SI', 'HR'].map((c) => '<optgroup label="' + (c === 'SI' ? 'Slovenia' : 'Croatia') + '">' + SL().filter((s) => s.country === c).map((s) => '<option value="' + s.id + '"' + (va === s.id ? ' selected' : '') + '>' + esc(s.name) + '</option>').join('') + '</optgroup>').join('');
    const tag = cur === YDAY ? ' · yesterday' : live && cur === b.max ? ' · latest day' : '';
    $('topbar').innerHTML =
      '<div class="datebox" role="group" aria-label="Board date">' +
        '<span class="lbl"><span class="label">Board date</span><b>' + esc(fday(cur)) + tag + '</b></span>' +
        '<button type="button" class="btn icon" id="dPrev" data-act="dayPrev" aria-label="Previous day"' + (cur <= b.min ? ' disabled' : '') + '>' + ic('back') + '</button>' +
        '<input type="date" id="dIn" data-chg="date" aria-label="Pick a date" min="' + b.min + '" max="' + b.max + '" value="' + cur + '">' +
        '<button type="button" class="btn icon" id="dNext" data-act="dayNext" aria-label="Next day"' + (cur >= b.max ? ' disabled' : '') + '>' + ic('fwd') + '</button>' +
        (cur !== b.max ? '<button type="button" class="btn sm" id="dY" data-act="dayY">' + (b.max === YDAY ? 'Back to yesterday' : 'Back to the latest day') + '</button>' : '') +
      '</div><span class="grow"></span>' +
      '<label class="viewas"><span class="label">Viewing as</span><select class="select" id="viewAs" data-chg="viewAs">' + opts + '</select></label>';
  }
  function setMenu(open) { $('side').classList.toggle('open', open); $('menuBtn').setAttribute('aria-expanded', open ? 'true' : 'false'); }
  $('menuBtn').addEventListener('click', () => setMenu(!$('side').classList.contains('open')));
  $('nav').addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });
  document.querySelector('.skip').addEventListener('click', (e) => { e.preventDefault(); const h = document.querySelector('#page h1'); (h || $('main')).focus(); });
  $('resetBtn').addEventListener('click', () => {
    confirmBox('Reset demo data?', 'This throws away your cash checks, call and reply marks, notes and tasks, and restores the original demo tasks. The trading history itself never changes. If you are signed in to cloud sync, the reset replaces your cloud copy at the next sync.', 'Reset demo data', () => {
      clearTimeout(saveTimer); saveTimer = null;
      const keepLive = state.live;                 // work on the live stores is not demo data: keep it
      state = D.initialState(TODAY); state.live = keepLive; ensureLive(state);
      const snap = state;
      (idbOK ? enqueue(() => idbPut(snap).then(announce)) : Promise.resolve()).then(syncChanged);
      closeAll(); setMenu(false);
      if (location.hash === '#/' || location.hash === '') { rerender(); } else location.hash = '#/';
      toast('Demo data reset');
    }, true);
  });

  const PAGES = { '': pageAll, store: pageStore, trends: pageTrends, staff: pageStaff, tasks: pageTasks };
  const PAGES_LIVE = { '': pageLAll, store: pageLStore, trends: pageLTrends, staff: pageLStaff, tasks: pageTasks };
  const pages = () => (LIVE() ? PAGES_LIVE : PAGES);
  function onRoute() {
    if (!state) return;
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    let base = parts[0] || '';
    if (!Object.prototype.hasOwnProperty.call(PAGES, base)) { location.replace('#/'); return; }
    if (base === 'store' && (!parts[1] || !SBX()[decodeURIComponent(parts[1])])) { location.replace('#/store/' + myStore()); return; }
    route = { base: base, id: parts[1] ? decodeURIComponent(parts[1]) : null, anchor: parts[2] || null };
    if (base === 'store') { if (LIVE()) ui.llastStore = route.id; else ui.lastStore = route.id; saveUi(); }
    closeAll(); setMenu(false);
    renderNav(); renderTop(); renderPage();
    window.scrollTo(0, 0);
    if (!firstRoute) { const h = document.querySelector('#page h1'); if (h) h.focus({ preventScroll: true }); }
    firstRoute = false;
  }
  let firstRoute = true;
  window.addEventListener('hashchange', onRoute);
  function renderPage() { $('page').innerHTML = pages()[route.base](); bindCharts(); document.title = (pageTitle || 'Store daily board') + ' — Adrial Apps'; }
  let pageTitle = '';
  function rerender() { withFocus(() => { renderNav(); renderTop(); renderPage(); }); }
  function setDate(d) {
    const b = dateBounds();
    if (!d || d < b.min || d > b.max) { toast('Pick a day between ' + fdate(b.min) + ' and ' + fdate(b.max) + '.'); renderTop(); return; }
    cur = d; if (LIVE()) lcurPicked = true;
    rerender();
  }

  // ── Events (delegated) ───────────────────────────────────────────────────
  const ACT = {};
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (b && !b.disabled) { const f = ACT[b.getAttribute('data-act')]; if (f) { e.preventDefault(); f(b.dataset, b); } return; }
    const row = e.target.closest('tr[data-href]');
    if (row && !e.target.closest('a,button,input,select,label')) location.hash = row.getAttribute('data-href');
  });
  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-chg]'); if (!el) return;
    const k = el.getAttribute('data-chg');
    if (k === 'date') setDate(el.value);
    else if (k === 'viewAs') {
      if (LIVE()) ui.lviewAs = el.value; else ui.viewAs = el.value;
      saveUi(); if (route.base === 'store' && VA() !== 'HO') location.hash = '#/store/' + VA(); else rerender(); toast('Viewing as ' + viewLabel());
    }
    else if (k === 'storeJump') location.hash = '#/store/' + el.value;
    else if (k === 'staffStore') { ui.staff.store = el.value; saveUi(); rerender(); }
    else if (k === 'taskStore') { if (LIVE()) ui.ltaskStore = el.value; else ui.tasks.store = el.value; saveUi(); rerender(); }
    else if (k === 'taskDone') {
      const key = el.getAttribute('data-task') + '|' + el.getAttribute('data-store'), T = TD();
      if (el.checked) T.taskDone[key] = nowTs(); else delete T.taskDone[key];
      save(); rerender(); toast(el.checked ? 'Task ticked off' : 'Task reopened');
    }
  });
  document.addEventListener('input', (e) => {
    const el = e.target.closest('[data-note]'); if (!el) return;
    const key = el.getAttribute('data-note'), v = el.value, N = TD().notes;
    if (v.trim()) N[key] = { text: v, at: nowTs(), by: viewLabel() }; else delete N[key];
    const ss = $('noteState'); if (ss) ss.textContent = 'Saving…';
    clearTimeout(noteTimer); noteTimer = setTimeout(() => { save(); const s2 = $('noteState'); if (s2) s2.textContent = 'Saved in this browser · ' + nowLj().hm; }, 500);
  });
  let noteTimer = null;
  ACT.dayPrev = () => setDate(U.addDays(cur, -1));
  ACT.dayNext = () => setDate(U.addDays(cur, 1));
  ACT.dayY = () => setDate(dateBounds().max);
  ACT.country = (d) => { ui.country = d.v; saveUi(); rerender(); };
  ACT.allView = (d) => { ui.allView = d.v; saveUi(); rerender(); };
  ACT.sort = (d) => { const s = ui.sort; if (s.k === d.k) s.dir = -s.dir; else { s.k = d.k; s.dir = d.k === 'name' || d.k === 'status' ? 1 : -1; } saveUi(); rerender(); };

  // ════════════════════════════════════════════════════════════════════════
  // 1. All stores
  // ════════════════════════════════════════════════════════════════════════
  const COLS = [
    ['status', 'Status', (r) => LVORD[r.st.level] * 10 - r.st.reasons.length],
    ['name', 'Store', (r) => r.s.name],
    ['rev', 'Yesterday', (r) => r.rev],
    ['vsAvg', 'vs weekday avg', (r) => r.vsAvg],
    ['vsLy', 'vs last year', (r) => r.vsLy],
    ['mtd', 'Month to date', (r) => r.m.sum],
    ['pctT', '% of target', (r) => r.m.pct],
    ['pace', 'Pace', (r) => r.m.pace],
    ['need', 'Needed per day', (r) => r.m.need],
    ['avg', 'Avg receipt', (r) => r.avg],
    ['conv', 'Exam → glasses', (r) => r.conv],
    ['rating', 'Rating', (r) => r.rating]
  ];
  function allRows() {
    let rows = STORES.filter((s) => !ui.country || s.country === ui.country).map((s) => storeRow(s.id, cur));
    const c = COLS.find((x) => x[0] === ui.sort.k) || COLS[0], dir = ui.sort.dir;
    rows.sort((a, b) => {
      const va = c[2](a), vb = c[2](b);
      if (va == null && vb == null) return a.s.name.localeCompare(b.s.name);
      if (va == null) return 1; if (vb == null) return -1;
      return (typeof va === 'string' ? va.localeCompare(vb) : va - vb) * dir || a.s.name.localeCompare(b.s.name);
    });
    return rows;
  }
  function deltaCls(x, inv) { if (x == null || Math.abs(x) < 0.005) return ''; return (x > 0) !== !!inv ? 'pos' : 'neg'; }
  function pageAll() {
    pageTitle = 'All stores';
    const rows = allRows(), open = rows.filter((r) => r.dd.open);
    let rev = 0, recs = 0, swRev = 0, mSum = 0, mExp = 0, mT = 0, done = 0, conv = 0, lyRev = 0, lyHave = 0;
    rows.forEach((r) => {
      mSum += r.m.sum; mExp += r.m.expected; mT += r.m.target;
      if (!r.dd.open) return;
      rev += r.dd.revenue; recs += r.dd.receipts; done += r.dd.exams.done; conv += r.dd.exams.converted;
      const sw = sameWeekdayAvg(r.id, cur); if (sw) swRev += sw.revenue;
      const ly = day(r.id, lyDate(cur)); if (ly.open) { lyRev += ly.revenue; lyHave += r.dd.revenue; }
    });
    const att = rows.filter((r) => r.st.level === 'bad' || r.st.level === 'warn').length, actNow = rows.filter((r) => r.st.level === 'bad').length;
    let h = '<div class="head"><div><span class="eyebrow">Morning overview · ' + esc(fday(cur)) + '</span><h1 tabindex="-1">All stores<span class="dot">.</span></h1>' +
      '<p class="sub">How ' + (cur === YDAY ? 'yesterday' : WDL[U.dow(cur)] + ', ' + fdate(cur) + ',') + ' went and what needs attention. ' + rows.length + ' optics stores' + (ui.country ? ' in ' + (ui.country === 'SI' ? 'Slovenia' : 'Croatia') : ' in Slovenia and Croatia') + '.</p></div>' +
      '<div class="head-actions"><div class="seg" role="group" aria-label="Country">' + [['', 'All'], ['SI', 'Slovenia'], ['HR', 'Croatia']].map((c) => '<button type="button" data-act="country" data-v="' + c[0] + '" data-fid="cty-' + c[0] + '" aria-pressed="' + (ui.country === c[0]) + '">' + c[1] + '</button>').join('') + '</div>' +
      '<div class="seg" role="group" aria-label="Layout">' + [['tiles', 'Tiles'], ['table', 'Table']].map((c) => '<button type="button" data-act="allView" data-v="' + c[0] + '" data-fid="av-' + c[0] + '" aria-pressed="' + (ui.allView === c[0]) + '">' + c[1] + '</button>').join('') + '</div>' +
      '<button type="button" class="btn" data-act="csvAll" data-fid="csvAll">' + ic('exp') + 'Export CSV</button></div></div>';
    if (!open.length) h += '<div class="notice">' + ic('cal') + '<span>All ' + (ui.country ? 'selected ' : '') + 'stores were closed on ' + esc(fday(cur)) + (rows[0] && rows[0].dd.holiday ? ' (' + esc(rows[0].dd.holiday) + ')' : '') + '. Month-to-date figures are still shown.</span></div>';
    const vsW = swRev ? rev / swRev - 1 : null;
    h += '<div class="kpis">' +
      kpi('Revenue · ' + fdayShort(cur), open.length ? eur0(rev) : '—', vsW == null ? '' : sgnPct(vsW) + ' vs ' + WD[U.dow(cur)] + ' average', deltaCls(vsW)) +
      kpi('vs same day last year', lyRev ? sgnPct(lyHave / lyRev - 1) : '—', lyRev ? eur0(lyRev) + ' on ' + fdayShort(lyDate(cur)) + ' ' + lyDate(cur).slice(0, 4) : 'closed last year', lyRev ? deltaCls(lyHave / lyRev - 1) : '') +
      kpi('Month to date', pct(mT ? mSum / mT : 0, 0) + '<small>of target</small>', eur0(mSum) + ' of ' + eur0(mT) + ' · pace ' + pct(mExp ? mSum / mExp : null, 0), mExp ? deltaCls(mSum / mExp - 1) : '') +
      kpi('Receipts', open.length ? num(recs) : '—', open.length ? 'average ' + eur(rev / Math.max(1, recs)) : '') +
      kpi('Exam → glasses', done ? pct(conv / done, 0) : '—', done ? num(conv) + ' of ' + num(done) + ' eye exams' : 'no exams') +
      kpi('Need attention', String(att) + '<small>of ' + rows.length + '</small>', actNow ? actNow + ' to act on now' : 'nothing urgent', actNow ? 'bad' : '') +
      '</div>';
    if (ui.allView === 'tiles') h += '<div class="tiles">' + rows.map(tileHtml).join('') + '</div>';
    else h += tableAll(rows);
    h += '<p class="hint" style="margin-top:14px">Status: <b>Act now</b> = month-to-date pace below 90 % or an unchecked cash difference of 5 € or more. <b>Check</b> = pace below 95 %, two or more overdue pickups not called, 6+ lab delays, old complaints, low-star reviews without a reply, card terminal mismatch or missing clock-outs.</p>';
    return h;
  }
  function kpi(label, v, d, cls) { return '<div class="kpi"><span class="label">' + esc(label) + '</span><span class="v">' + v + '</span>' + (d ? '<span class="d ' + (cls || '') + '"><i></i>' + esc(d) + '</span>' : '') + '</div>'; }
  function paceBar(m, small) {
    const w = Math.min(100, m.pct * 100), mk = m.total ? Math.min(100, m.elapsed / m.total * 100) : 0;
    return '<div class="pace' + (small ? ' sm' : '') + '" role="img" aria-label="' + esc(pct(m.pct, 0) + ' of the monthly target reached; ' + pct(m.total ? m.elapsed / m.total : 0, 0) + ' of the open days have passed') + '"><i style="width:' + w.toFixed(1) + '%"></i><b style="left:' + mk.toFixed(1) + '%"></b></div>';
  }
  function tileHtml(r) {
    const lv = r.st.level, closed = !r.dd.open;
    return '<a class="tile' + (closed ? ' closed' : '') + '" href="#/store/' + r.id + '" data-fid="tile-' + r.id + '"><div class="top"><h3>' + esc(r.s.name) + '<small>' + r.s.country + ' · ' + esc(r.s.kind) + '</small></h3>' + stBadge(lv) + '</div>' +
      '<div><span class="big">' + (closed ? 'Closed' : eur0(r.rev)) + '</span>' + (closed ? '' : ' <span class="' + deltaCls(r.vsAvg) + '" style="font-size:13px">' + sgnPct(r.vsAvg) + ' vs ' + WD[U.dow(cur)] + ' avg</span>') + '</div>' +
      '<div>' + paceBar(r.m, true) + '<div class="row"><span>MTD ' + eur0(r.m.sum) + ' · ' + pct(r.m.pct, 0) + ' of target</span><span>pace ' + pct(r.m.pace, 0) + '</span></div></div>' +
      (r.st.reasons.length && lv !== 'closed' ? '<ul>' + r.st.reasons.slice(0, 3).map((x) => '<li><i class="dot-l ' + x.lv + '" aria-hidden="true"></i>' + esc(x.t) + '</li>').join('') + (r.st.reasons.length > 3 ? '<li class="muted">+' + (r.st.reasons.length - 3) + ' more</li>' : '') + '</ul>' : lv === 'closed' ? '<ul><li>' + esc(r.st.reasons[0].t) + '</li></ul>' : '<ul><li><i class="dot-l good" aria-hidden="true"></i>Nothing needs attention</li></ul>') +
      '<div class="row"><span>★ ' + NF1.format(r.rating) + ' (' + num(r.ratingCount) + ')</span><span>Avg receipt ' + (r.avg ? eur0(r.avg) : '—') + '</span><span>Exam conv. ' + pct(r.conv, 0) + '</span></div></a>';
  }
  function thSort(k, label, num_) {
    const s = ui.sort, on = s.k === k;
    return '<th scope="col"' + (num_ ? ' class="num"' : '') + (on ? ' aria-sort="' + (s.dir > 0 ? 'ascending' : 'descending') + '"' : '') + '><button type="button" data-act="sort" data-k="' + k + '" data-fid="th-' + k + '">' + esc(label) + (on ? (s.dir > 0 ? ' ↑' : ' ↓') : '') + '</button></th>';
  }
  function tableAll(rows) {
    let h = '<div class="card"><div class="tw"><table class="t"><caption class="sr">Store ranking for ' + esc(fday(cur)) + '. Select a column header to sort.</caption><thead><tr>' +
      COLS.map((c) => thSort(c[0], c[1], c[0] !== 'status' && c[0] !== 'name')).join('') + '</tr></thead><tbody>';
    rows.forEach((r) => {
      h += '<tr class="click" data-href="#/store/' + r.id + '"><td class="st-cell">' + stBadge(r.st.level) + '</td>' +
        '<td class="name"><a href="#/store/' + r.id + '" data-fid="row-' + r.id + '">' + esc(r.s.name) + '</a><small>' + r.s.country + ' · ' + esc(r.st.reasons[0] && r.st.level !== 'good' ? r.st.reasons[0].t : r.st.level === 'good' ? 'nothing needs attention' : '') + '</small></td>' +
        '<td class="num">' + (r.rev == null ? '<span class="muted">closed</span>' : eur0(r.rev)) + '</td>' +
        '<td class="num ' + deltaCls(r.vsAvg) + '">' + sgnPct(r.vsAvg) + '</td><td class="num ' + deltaCls(r.vsLy) + '">' + sgnPct(r.vsLy) + '</td>' +
        '<td class="num">' + eur0(r.m.sum) + '<small>of ' + eur0(r.m.target) + '</small></td><td class="num" style="min-width:110px">' + pct(r.m.pct, 0) + paceBar(r.m, true) + '</td>' +
        '<td class="num ' + (r.m.pace == null ? '' : r.m.pace < 0.95 ? 'neg' : 'pos') + '">' + pct(r.m.pace, 0) + '</td><td class="num">' + (r.m.remaining ? eur0(r.m.need) : '—') + '<small>' + r.m.remaining + ' open days left</small></td>' +
        '<td class="num">' + (r.avg ? eur(r.avg) : '—') + '</td><td class="num">' + pct(r.conv, 0) + '</td>' +
        '<td class="num">★ ' + NF1.format(r.rating) + '<small class="' + (r.ratingDelta < -0.004 ? 'neg' : '') + '">' + (Math.abs(r.ratingDelta) < 0.005 ? 'steady' : (r.ratingDelta > 0 ? '+' : '−') + NF2.format(Math.abs(r.ratingDelta))) + ' in 30 d</small></td></tr>';
    });
    return h + '</tbody></table></div></div>';
  }
  ACT.csvAll = () => {
    const rows = allRows();
    downloadCsv('store-ranking', ['Date', 'Store', 'Country', 'Status', 'Attention', 'Revenue EUR', 'Receipts', 'Avg receipt EUR', 'vs weekday avg %', 'vs last year %', 'MTD EUR', 'Target EUR', '% of target', 'Pace %', 'Needed per open day EUR', 'Open days left', 'Exam conversion %', 'Rating', 'Reviews'],
      rows.map((r) => [cur, r.s.name, r.s.country, ST[r.st.level][0], r.st.reasons.map((x) => x.t).join('; '), csvNum(r.rev), r.receipts == null ? '' : r.receipts, csvNum(r.avg), csvNum(r.vsAvg == null ? null : r.vsAvg * 100, 1), csvNum(r.vsLy == null ? null : r.vsLy * 100, 1),
        csvNum(r.m.sum), r.m.target, csvNum(r.m.pct * 100, 1), csvNum(r.m.pace == null ? null : r.m.pace * 100, 1), csvNum(r.m.need), r.m.remaining, csvNum(r.conv == null ? null : r.conv * 100, 1), csvNum(r.rating, 2), r.ratingCount]));
  };

  // ════════════════════════════════════════════════════════════════════════
  // 2. Store board
  // ════════════════════════════════════════════════════════════════════════
  function pageStore() {
    const id = route.id, s = SB[id], dd = day(id, cur), td = boardToday(), th = D.hours(id, td), team = D.staff(id), mgr = team[0];
    pageTitle = s.name;
    const st = storeStatus(id, cur);
    let h = '<div class="head"><div>' + (ui.viewAs === 'HO' || ui.viewAs !== id ? '<a class="crumb" href="#/">' + ic('back') + 'All stores</a>' : '<span class="eyebrow">My store · ' + esc(s.country) + '</span>') +
      '<h1 tabindex="-1">' + esc(s.name) + '<span class="dot">.</span></h1><p class="sub">' + esc(s.kind) + ' · manager ' + esc(mgr.name) + ' · ' + (th ? 'open today (' + esc(fdayShort(td)) + ') ' + hm(th[0]) + '–' + hm(th[1]) : 'closed today (' + esc(fdayShort(td)) + ')' + (D.holiday(id, td) ? ', ' + esc(D.holiday(id, td)) : '')) + '</p></div>' +
      '<div class="head-actions"><label class="sr" for="storeJump">Open another store</label><select class="select" id="storeJump" data-chg="storeJump">' + STORES.map((x) => '<option value="' + x.id + '"' + (x.id === id ? ' selected' : '') + '>' + esc(x.name) + ' (' + x.country + ')</option>').join('') + '</select>' +
      '<button type="button" class="btn no-print" data-act="print">Print</button></div></div>';
    // status summary
    if (st.level === 'closed') h += '<div class="notice">' + ic('cal') + '<span>' + esc(st.reasons[0].t) + ' on ' + esc(fday(cur)) + '. There are no sales or cash to check for that day; pickups, complaints and reviews below are as of that evening.</span></div>';
    else if (st.level === 'good') h += '<div class="notice ok">' + ic('check') + '<span>' + stBadge('good') + ' Nothing needs attention from ' + esc(fdayShort(cur)) + ' Have a good day.</span></div>';
    else h += '<div class="card pad" style="margin-bottom:14px"><div style="display:flex;gap:10px;align-items:center;margin-bottom:10px">' + stBadge(st.level) + '<b style="font-weight:500">' + st.reasons.length + ' thing' + (st.reasons.length === 1 ? '' : 's') + ' to look at this morning</b></div><ul class="reasons">' +
      st.reasons.map((x) => '<li><i class="dot-l ' + x.lv + '" aria-hidden="true"></i><span>' + (x.h ? '<a href="#' + x.h + '" data-act="jump" data-to="' + x.h + '">' + esc(x.t) + '</a>' : esc(x.t)) + (x.lv === 'bad' ? ' <span class="sr">(act now)</span>' : '') + '</span></li>').join('') + '</ul></div>';
    // yesterday KPIs
    h += '<h2 class="subhead" style="margin:4px 0 10px">' + (cur === YDAY ? 'Yesterday · ' : '') + esc(fday(cur)) + ' · compared with the average of the last 6 ' + WDL[U.dow(cur)] + 's</h2>';
    if (dd.open) {
      const sw = sameWeekdayAvg(id, cur) || {}, conv = dd.exams.done ? dd.exams.converted / dd.exams.done : null, ly = day(id, lyDate(cur));
      const dv = (a, b) => (b ? a / b - 1 : null);
      h += '<div class="kpis">' +
        kpi('Revenue', eur0(dd.revenue), sgnPct(dv(dd.revenue, sw.revenue)) + ' vs ' + eur0(sw.revenue) + (ly.open ? ' · LY ' + sgnPct(dd.revenue / ly.revenue - 1) : ''), deltaCls(dv(dd.revenue, sw.revenue))) +
        kpi('Receipts', num(dd.receipts), sgnPct(dv(dd.receipts, sw.receipts)) + ' vs ' + NF1.format(sw.receipts || 0), deltaCls(dv(dd.receipts, sw.receipts))) +
        kpi('Average receipt', eur(dd.avg), sgnPct(dv(dd.avg, sw.avg)) + ' vs ' + eur0(sw.avg), deltaCls(dv(dd.avg, sw.avg))) +
        kpi('Units sold', num(dd.units), sgnPct(dv(dd.units, sw.units)) + ' vs ' + NF1.format(sw.units || 0), '') +
        kpi('Eye exams done', num(dd.exams.done) + '<small>' + dd.exams.booked + ' booked</small>', dd.exams.noShow + ' no-show' + (dd.exams.noShow === 1 ? '' : 's') + ' · ' + dd.exams.walkIn + ' walk-in' + (dd.exams.rescheduled ? ' · ' + dd.exams.rescheduled + ' moved (optometrist absent)' : '') + (dd.exams.relief ? ' · relief optometrist' : ''), dd.exams.noShow >= 2 || dd.exams.rescheduled ? 'neg' : '') +
        kpi('Exam → glasses', pct(conv, 0), conv == null ? 'no exams' : dd.exams.converted + ' of ' + dd.exams.done + ' · avg ' + pct(sw.conv, 0), conv != null && sw.conv != null ? deltaCls(conv - sw.conv) : '') +
        kpi('Discounts', eur0(dd.discount), pct(dd.discountRate) + ' of goods' + (dd.promo ? ' · ' + dd.promo : ''), '') +
        '</div>';
    } else h += '<div class="empty dashed" style="margin-bottom:14px">Closed — ' + esc(dd.holiday || WDL[U.dow(cur)]) + '. No trading on this day.</div>';

    const L = [cardMtd(id), cardCash(id), cardPickups(id), cardComplaints(id), cardMix(id)];
    const R = [cardStaffToday(id), cardTasks(id), cardNotes(id), cardReviews(id)];
    h += '<div class="board"><div class="col">' + L.join('') + '</div><div class="col">' + R.join('') + '</div></div>';
    return h;
  }
  ACT.print = () => window.print();
  ACT.jump = (d) => { const el = $(d.to); if (!el) return; el.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); el.focus({ preventScroll: true }); };
  function card(o) {
    return '<section class="card" id="' + o.id + '" tabindex="-1" style="--o:' + o.order + '" aria-labelledby="' + o.id + '-h"><div class="card-h"><div><span class="label">' + esc(o.eyebrow) + '</span><h2 id="' + o.id + '-h">' + esc(o.title) + '</h2></div>' + (o.right || '') + '</div><div class="card-b">' + o.body + '</div>' + (o.foot ? '<div class="card-foot">' + o.foot + '</div>' : '') + '</section>';
  }
  function cardMtd(id) {
    const m = mtd(id, cur), behind = m.sum - m.expected;
    const body = '<div class="rating-big"><b>' + eur0(m.sum) + '</b><span class="muted">of ' + eur0(m.target) + ' target · ' + pct(m.pct, 0) + '</span></div>' + paceBar(m) +
      '<div class="pace-legend"><span>1. ' + +m.ym.slice(5) + '.</span><span>| expected by ' + fdm(cur) + ': ' + eur0(m.expected) + '</span><span>' + U.monthDays(m.ym) + '. ' + +m.ym.slice(5) + '.</span></div>' +
      '<table class="kv" style="margin-top:12px"><tbody>' +
      '<tr><th scope="row">Pace</th><td class="' + (m.pace == null ? '' : m.pace < 0.95 ? 'neg' : 'pos') + '">' + pct(m.pace, 0) + ' · ' + sgnEur(behind).replace(/,\d\d €/, ' €') + ' vs expected</td></tr>' +
      '<tr><th scope="row">Open days</th><td>' + m.elapsed + ' done · ' + m.remaining + ' left</td></tr>' +
      '<tr><th scope="row">Daily average so far</th><td>' + eur0(m.runRate) + '</td></tr>' +
      '<tr class="tot"><th scope="row">Needed per remaining open day</th><td>' + (m.remaining ? eur0(m.need) : '—') + '</td></tr>' +
      '<tr><th scope="row">Projected month at this pace</th><td>' + eur0(m.projected) + '</td></tr>' +
      '<tr><th scope="row">Same period last year</th><td>' + eur0(m.ly) + (m.ly ? ' <span class="' + deltaCls(m.sum / m.ly - 1) + '">(' + sgnPct(m.sum / m.ly - 1) + ')</span>' : '') + '</td></tr>' +
      '</tbody></table>';
    return card({ id: 'mtd', order: 1, eyebrow: monthName(m.ym) + ' ' + m.ym.slice(0, 4), title: 'Month to date vs target', body: body });
  }
  function cardCash(id) {
    const dd = day(id, cur);
    if (!dd.open) return card({ id: 'cash', order: 2, eyebrow: 'Money box · ' + fdayShort(cur), title: 'Cash check', body: '<div class="empty dashed">Store closed: nothing to count.</div>' });
    const c = dd.cash, chk = state.cash[cashKey(id, cur)], ad = Math.abs(c.diff);
    const lv = ad >= 5 ? ['b-bad', 'Difference to explain'] : ad > 0 ? ['b-clay', 'Small difference'] : ['b-good', 'Balanced'];
    let body = '<table class="kv"><caption class="sr">Cash in the register compared with the counted cash</caption><tbody>' +
      '<tr><th scope="row">Cash sales (register)</th><td>' + eur(c.regCash) + '</td></tr><tr><th scope="row">Opening float</th><td>' + eur(c.float) + '</td></tr>' +
      '<tr class="tot"><th scope="row">Expected in the drawer</th><td>' + eur(c.expected) + '</td></tr><tr class="tot"><th scope="row">Counted at close</th><td>' + eur(c.counted) + '</td></tr>' +
      '<tr><th scope="row">Difference</th><td class="' + (c.diff < 0 ? 'neg' : c.diff > 0 ? 'pos' : '') + '">' + sgnEur(c.diff) + '</td></tr></tbody></table>' +
      '<p class="subhead">Cards</p><table class="kv"><tbody><tr><th scope="row">Card sales (register)</th><td>' + eur(c.regCard) + '</td></tr><tr><th scope="row">Terminal batch total</th><td>' + eur(c.terminal) + '</td></tr>' +
      '<tr><th scope="row">Difference</th><td class="' + (c.cardDiff ? 'neg' : '') + '">' + sgnEur(c.cardDiff) + '</td></tr></tbody></table>';
    if (chk) body += '<div class="checked"><div><b style="font-weight:500">' + ic('check') + ' Checked by ' + esc(chk.by) + ' · ' + esc(fts(chk.at)) + '</b>' + (chk.note ? '<p>' + esc(chk.note) + '</p>' : '') + '</div><button type="button" class="btn sm" data-act="cashUndo" data-fid="cashUndo">' + ic('undo') + 'Reopen</button></div>';
    else body += '<div style="margin-top:14px;display:flex;flex-wrap:wrap;gap:8px;align-items:center"><button type="button" class="btn pri" data-act="cashCheck" data-fid="cashCheck">' + ic('check') + 'Mark checked…</button><span class="hint">' + (ad >= 5 || c.cardDiff ? 'Add a short explanation.' : 'Confirms the count matches.') + '</span></div>';
    return card({ id: 'cash', order: 2, eyebrow: 'Money box · ' + fdayShort(cur), title: 'Cash check', right: '<span class="badge ' + lv[0] + '">' + lv[1] + '</span>', body: body });
  }
  ACT.cashCheck = () => {
    const id = route.id, c = day(id, cur).cash, needNote = Math.abs(c.diff) >= 5 || !!c.cardDiff;
    modal({
      title: 'Cash check · ' + SB[id].name, submitLabel: 'Mark checked',
      body: '<p>' + esc(fday(cur)) + ': counted ' + eur(c.counted) + ', expected ' + eur(c.expected) + ' (difference ' + sgnEur(c.diff) + ')' + (c.cardDiff ? '; card terminal differs by ' + sgnEur(c.cardDiff) : '') + '.</p>' +
        '<div class="field"><label for="cashNote">Note' + (needNote ? ' (required)' : ' (optional)') + '</label><textarea class="in" id="cashNote" name="note" maxlength="500" placeholder="' + (needNote ? 'e.g. Recounted with the second key holder; 20 € change error at the till' : 'e.g. Counted with Maja, all fine') + '"></textarea></div>' +
        '<p class="hint">Saved in this browser (and your cloud copy if you sync). Nothing is sent to accounting.</p>',
      onSubmit: (f) => {
        const note = f.elements.note.value.trim();
        if (needNote && note.length < 3) return 'Please write a short explanation of the difference.';
        state.cash[cashKey(id, cur)] = { at: nowTs(), note: note, by: viewLabel() };
        save(); rerender(); toast('Cash for ' + fdayShort(cur) + ' marked as checked');
        setTimeout(() => { const b = document.querySelector('[data-fid="cashUndo"]'); if (b) b.focus(); }, 0);
        return null;
      }
    });
  };
  ACT.cashUndo = () => { delete state.cash[cashKey(route.id, cur)]; save(); rerender(); toast('Cash check reopened'); };

  function cardStaffToday(id) {
    const td = boardToday(), th = D.hours(id, td), now = nowLj(), live = td === TODAY, team = D.staff(id);
    const pid = {}; team.forEach((p) => { pid[p.id] = p; });
    if (!th) return card({ id: 'staffToday', order: 3, eyebrow: 'Today · ' + fdayShort(td), title: 'Staff on shift', body: '<div class="empty dashed">Closed today' + (D.holiday(id, td) ? ' (' + esc(D.holiday(id, td)) + ')' : '') + '. No shifts planned.</div>' });
    const att = D.attendance(id, td);
    let inNow = 0;
    const rows = att.slice().sort((a, b) => a.start - b.start || pid[a.staffId].name.localeCompare(pid[b.staffId].name)).map((a) => {
      const p = pid[a.staffId]; let badge;
      const t = live ? now.min : 24 * 60;
      if (live && t < a.start - 30) badge = '<span class="badge plain">Starts ' + hm(a.start) + '</span>';
      else if (a.absent) badge = '<span class="badge b-clay">Absent · ' + esc(a.reason.toLowerCase()) + '</span>';
      else if (a.in > t) badge = t >= a.start ? '<span class="badge b-bad">Not clocked in yet</span>' : '<span class="badge plain">Starts ' + hm(a.start) + '</span>';
      else if (a.out != null && a.out <= t) badge = '<span class="badge">In ' + hm(a.in) + ' · out ' + hm(a.out) + '</span>' + (a.late ? ' <span class="badge b-clay">' + a.late + ' min late</span>' : '');
      else { inNow++; badge = '<span class="badge b-good">In since ' + hm(a.in) + '</span>' + (a.late ? ' <span class="badge b-clay">' + a.late + ' min late</span>' : '') + (!live && a.missingOut ? ' <span class="badge b-clay">No clock-out</span>' : ''); }
      return '<li><div class="l"><b style="font-weight:500">' + esc(p.name) + '</b><small>' + esc(p.role) + ' · ' + hm(a.start) + '–' + hm(a.end) + '</small></div><div class="r">' + badge + '</div></li>';
    });
    const leave = team.filter((p) => !att.some((a) => a.staffId === p.id)).map((p) => p.name);
    const right = live ? '<span class="live label"><i aria-hidden="true"></i>Live · ' + now.hm + '</span>' : '';
    return card({ id: 'staffToday', order: 3, eyebrow: 'Today · ' + fdayShort(td) + ' · open ' + hm(th[0]) + '–' + hm(th[1]), title: 'Staff plan vs clock-ins', right: right,
      body: '<ul class="list">' + rows.join('') + '</ul>' + (leave.length ? '<p class="hint" style="margin-top:8px">Not rostered today: ' + esc(leave.join(', ')) + '</p>' : ''),
      foot: (live ? inNow + ' clocked in now · ' : '') + 'Demo clock-ins in the style of a Codeks time-attendance export. Times are Europe/Ljubljana.' });
  }

  function cardPickups(id) {
    const pk = pickups(id, cur), lab = labStatus(id, cur), toCall = pk.filter((p) => p.needsCall), over = pk.filter((p) => p.overdue).length;
    const showAll = ui.pick === 'all', list = showAll ? pk : toCall.concat(pk.filter((p) => p.called && p.called.at && p.called.at.slice(0, 10) >= TODAY));
    const seen = {}, uniq = list.filter((p) => (seen[p.w.id] ? false : (seen[p.w.id] = 1)));
    let body = '<div class="minirow"><span><b>' + pk.length + '</b> ready</span><span><b>' + over + '</b> waiting over 14 days</span><span><b>' + lab.production + '</b> at the lab</span><span><b>' + lab.delayed.length + '</b> lab delays</span></div>' +
      '<p class="hint" style="margin:8px 0 10px">Customers get an automatic SMS when glasses are ready. Call anyone waiting 7 days or more.</p>' +
      '<div class="seg" role="group" aria-label="Which pickups"><button type="button" data-act="pick" data-v="call" data-fid="pk-call" aria-pressed="' + !showAll + '">To call (' + toCall.length + ')</button><button type="button" data-act="pick" data-v="all" data-fid="pk-all" aria-pressed="' + showAll + '">All ready (' + pk.length + ')</button></div>';
    if (!uniq.length) body += '<div class="empty dashed" style="margin-top:12px">' + (showAll ? 'No glasses waiting for pickup.' : 'Nobody to call. Every customer waiting 7+ days has been called.') + '</div>';
    else body += '<ul class="list" style="margin-top:6px">' + uniq.slice(0, showAll ? 200 : 60).map((p) => {
      const w = p.w;
      const status = p.called ? '<span class="badge b-good">Called ' + esc(fts(p.called.at)) + '</span> <button type="button" class="btn sm ghost" data-act="uncall" data-id="' + w.id + '" data-fid="call-' + w.id + '" aria-label="Undo called mark for ' + esc(w.customer) + '">' + ic('undo') + '</button>'
        : p.reminded ? '<span class="badge">Reminder call ' + fdm(p.reminded) + '</span>'
        : p.wait >= 7 ? '<button type="button" class="btn sm" data-act="call" data-id="' + w.id + '" data-fid="call-' + w.id + '">' + ic('phone') + 'Mark called</button>' : '<span class="badge plain">SMS sent</span>';
      return '<li' + (p.called ? ' class="called"' : '') + '><div class="l"><b style="font-weight:500">' + esc(w.customer) + '</b> <span class="badge ' + (p.overdue ? 'b-clay' : 'plain') + '">' + (p.overdue ? 'Overdue · ' : '') + p.wait + ' day' + (p.wait === 1 ? '' : 's') + '</span>' +
        '<small>' + esc(w.id) + ' · ' + esc(w.kind) + ' · ' + esc(w.phone) + ' · ' + esc(w.paid) + '</small></div><div class="r">' + status + '</div></li>';
    }).join('') + '</ul>';
    if (lab.delayed.length) body += '<details class="tbl" style="margin-top:10px"><summary>Show ' + lab.delayed.length + ' lab delay' + (lab.delayed.length === 1 ? '' : 's') + '</summary><ul class="list">' + lab.delayed.map((x) => '<li><div class="l"><b style="font-weight:500">' + esc(x.w.id) + '</b><small>' + esc(x.w.kind) + ' · ' + esc(x.w.lab) + ' · ordered ' + fdm(x.w.created) + '</small></div><div class="r"><span class="badge b-clay">' + x.late + ' day' + (x.late === 1 ? '' : 's') + ' late</span><small class="cell-sub">due ' + fdm(x.w.expected) + '</small></div></li>').join('') + '</ul></details>';
    return card({ id: 'pickups', order: 4, eyebrow: 'Glasses in progress · as of ' + fdayShort(cur) + ' evening', title: 'Ready for pickup: call list', body: body, foot: 'Phone numbers are fictional (000 blocks). Nothing is dialled or sent from here.' });
  }
  ACT.pick = (d) => { ui.pick = d.v; saveUi(); rerender(); };
  ACT.call = (d) => { state.called[d.id] = { at: nowTs(), by: viewLabel() }; save(); rerender(); toast('Marked as called'); };
  ACT.uncall = (d) => { delete state.called[d.id]; save(); rerender(); toast('Called mark removed'); };

  function cardComplaints(id) {
    const list = openComplaints(id, cur);
    const body = !list.length ? '<div class="empty dashed">No open complaints.</div>' : '<ul class="list">' + list.map((x) => {
      const c = x.c, cls = c.type === 'Wrong prescription' ? 'b-violet' : c.type === 'Frame defect' ? 'b-blue' : 'b-teal';
      return '<li><div class="l"><span class="badge ' + cls + '">' + esc(c.type) + '</span> <b style="font-weight:500">' + esc(c.customer) + '</b><small style="white-space:normal">' + esc(c.id) + ' · ' + esc(c.detail) + '</small></div><div class="r"><span class="badge ' + (x.age > 14 ? 'b-clay' : 'plain') + '">' + x.age + ' day' + (x.age === 1 ? '' : 's') + ' open</span><small class="cell-sub">since ' + fdm(c.opened) + '</small></div></li>';
    }).join('') + '</ul>';
    return card({ id: 'complaints', order: 7, eyebrow: 'Complaints and returns', title: 'Open complaints (' + list.length + ')', body: body });
  }
  function cardReviews(id) {
    const rv = reviewsFor(id, cur), r = ratingAt(id, cur), vals = [];
    for (let i = 119; i >= 0; i -= 3) vals.push(ratingAt(id, U.addDays(cur, -i)).avg);
    const r30 = ratingAt(id, U.addDays(cur, -30)).avg, dl = r.avg - r30;
    let body = '<div class="rating-big"><b>★ ' + NF2.format(r.avg) + '</b><span class="muted">' + num(r.count) + ' Google reviews · ' + (Math.abs(dl) < 0.005 ? 'steady' : (dl > 0 ? '+' : '−') + NF2.format(Math.abs(dl))) + ' in 30 days</span></div>' + spark(vals) +
      '<p class="hint" style="margin:4px 0 8px">Rating over the last 120 days. ' + rv.week.length + ' new review' + (rv.week.length === 1 ? '' : 's') + ' in the last 7 days, ' + rv.unanswered.length + ' without a reply.</p>';
    body += !rv.show.length ? '<div class="empty dashed">No new reviews this week and nothing waiting for a reply.</div>' : '<div>' + rv.show.slice(0, 12).map((x) => {
      const replied = isReplied(x, cur), mine = state.replied[x.id];
      return '<div class="rev"><div class="h"><span><span class="stars" role="img" aria-label="' + x.stars + ' of 5 stars">' + '★'.repeat(x.stars) + '<span class="off">' + '★'.repeat(5 - x.stars) + '</span></span> <b style="font-weight:500">' + esc(x.author) + '</b></span><span class="hint">' + esc(fdayShort(x.date)) + '</span></div>' +
        '<p>' + (x.text ? esc(x.text) : '<i class="muted">Rating only, no text.</i>') + '</p><div class="f">' +
        (replied ? '<span class="badge b-good">Replied' + (mine ? ' ' + esc(fts(mine.at)) : x.repliedOn ? ' ' + fdm(x.repliedOn) : '') + '</span>' + (mine ? '<button type="button" class="btn sm ghost" data-act="unreply" data-id="' + x.id + '" data-fid="rv-' + x.id + '" aria-label="Undo replied mark">' + ic('undo') + '</button>' : '')
          : '<span class="badge ' + (x.stars <= 3 ? 'b-clay' : 'plain') + '">No reply yet</span><button type="button" class="btn sm" data-act="reply" data-id="' + x.id + '" data-fid="rv-' + x.id + '">' + ic('check') + 'Mark replied</button>') + '</div></div>';
    }).join('') + '</div>';
    return card({ id: 'reviews', order: 8, eyebrow: 'Google reviews', title: 'New reviews', body: body, foot: 'Fictional reviews. "Mark replied" only records that you answered in Google; nothing is posted from here.' });
  }
  ACT.reply = (d) => { state.replied[d.id] = { at: nowTs(), by: viewLabel() }; save(); rerender(); toast('Review marked as replied'); };
  ACT.unreply = (d) => { delete state.replied[d.id]; save(); rerender(); toast('Replied mark removed'); };

  function cardNotes(id) {
    const td = boardToday(), key = id + '|' + td, N = TD().notes, n = N[key], prev = N[id + '|' + cur];
    const body = '<div class="field notes-box"><label for="noteBox">Notes for ' + esc(fday(td)) + '</label><textarea class="in" id="noteBox" data-note="' + esc(key) + '" maxlength="4000" placeholder="Handover, reminders, who covers the late shift…">' + esc(n ? n.text : '') + '</textarea>' +
      '<span class="save-state" id="noteState" aria-live="polite">' + (n ? 'Saved ' + esc(fts(n.at)) + ' by ' + esc(n.by) : 'Saved automatically in this browser') + '</span></div>' +
      (prev ? '<p class="subhead">Notes from ' + esc(fdayShort(cur)) + '</p><div class="prev-note">' + esc(prev.text) + '</div>' : '');
    return card({ id: 'notes', order: 6, eyebrow: 'Manager', title: 'Today’s notes', body: body });
  }
  function cardTasks(id) {
    const T = TD(), ts = T.tasks.filter((t) => t.stores.indexOf(id) >= 0);
    const open = ts.filter((t) => !T.taskDone[t.id + '|' + id]), done = ts.filter((t) => T.taskDone[t.id + '|' + id]);
    const one = (t) => taskRow(t, id);
    const body = (open.length ? open.map(one).join('') : '<div class="empty dashed">No open tasks from head office.</div>') +
      (done.length ? '<details class="tbl" style="margin-top:8px"><summary>' + done.length + ' done</summary>' + done.map(one).join('') + '</details>' : '');
    return card({ id: 'tasks', order: 5, eyebrow: 'From head office', title: 'Tasks (' + open.length + ' open)', right: '<a class="btn sm ghost" href="#/tasks">All tasks</a>', body: body });
  }
  function taskRow(t, storeId) {
    const k = t.id + '|' + storeId, done = TD().taskDone[k], over = !done && t.due < TODAY, cid = 'tk-' + t.id + '-' + storeId;
    return '<div class="task' + (done ? ' done' : '') + '"><input type="checkbox" id="' + cid + '" data-fid="' + cid + '" data-chg="taskDone" data-task="' + t.id + '" data-store="' + storeId + '"' + (done ? ' checked' : '') + '>' +
      '<div style="min-width:0"><label class="tt" for="' + cid + '">' + esc(t.title) + '</label><small>' + (done ? 'Done ' + esc(fts(done)) : 'Due ' + esc(fdayShort(t.due))) + (over ? ' · <span class="neg">overdue</span>' : '') + '</small>' + (t.details ? '<p>' + esc(t.details) + '</p>' : '') + '</div></div>';
  }
  function cardMix(id) {
    const dd = day(id, cur);
    if (!dd.open) return card({ id: 'mix', order: 9, eyebrow: 'Sales mix · ' + fdayShort(cur), title: 'What sold', body: '<div class="empty dashed">Closed.</div>' });
    const tot = MIX.reduce((a, k) => a + dd.mix[k.k], 0);
    const body = '<div class="mixbar" role="img" aria-label="Sales mix: ' + esc(MIX.map((k) => k.name + ' ' + pct(dd.mix[k.k] / tot, 0)).join(', ')) + '">' + MIX.map((k) => '<i style="width:' + (dd.mix[k.k] / tot * 100).toFixed(2) + '%;background:' + k.color + '"></i>').join('') + '</div>' +
      '<table class="kv"><tbody>' + MIX.map((k) => '<tr><th scope="row"><span class="legend"><span><i style="background:' + k.color + '"></i>' + esc(k.name) + '</span></span></th><td>' + eur0(dd.mix[k.k]) + '</td><td>' + pct(dd.mix[k.k] / tot, 0) + '</td><td class="muted">' + num(dd.unitMix[k.k]) + ' ' + (k.k === 'services' ? 'exams' : k.k === 'cl' ? 'boxes' : 'pcs') + '</td></tr>').join('') + '</tbody></table>';
    return card({ id: 'mix', order: 9, eyebrow: 'Sales mix · ' + fdayShort(cur), title: 'What sold', body: body });
  }

  // ════════════════════════════════════════════════════════════════════════
  // 3. Trends
  // ════════════════════════════════════════════════════════════════════════
  const METRICS = [['revenue', 'Revenue'], ['receipts', 'Receipts'], ['avg', 'Avg receipt'], ['mix', 'Sales mix'], ['exams', 'Eye exams'], ['conv', 'Exam conversion'], ['rating', 'Rating']];
  function periods(range, grain) {
    const out = [];
    if (grain === 'week') {
      const n = Math.floor(range / 7);
      for (let i = n - 1; i >= 0; i--) { const end = U.addDays(cur, -7 * i), start = U.addDays(end, -6); out.push({ start: start, end: end, label: fdm(start), tip: fdm(start) + '–' + fdm(end) }); }
    } else for (let i = range - 1; i >= 0; i--) { const d = U.addDays(cur, -i); out.push({ start: d, end: d, label: fdm(d), tip: fday(d) }); }
    return out;
  }
  function agg(ids, p, shift) {
    const a = { revenue: 0, receipts: 0, booked: 0, done: 0, noShow: 0, conv: 0, open: 0, mix: { frames: 0, lenses: 0, cl: 0, sun: 0, services: 0 } };
    for (let d = p.start; d <= p.end; d = U.addDays(d, 1)) ids.forEach((id) => {
      const dd = day(id, shift ? U.addDays(d, shift) : d); if (!dd.open) return;
      a.open++; a.revenue += dd.revenue; a.receipts += dd.receipts; a.booked += dd.exams.booked; a.done += dd.exams.done; a.noShow += dd.exams.noShow; a.conv += dd.exams.converted;
      MIX.forEach((k) => { a.mix[k.k] += dd.mix[k.k]; });
    });
    return a;
  }
  function ratingCombined(ids, date) { let c = 0, s = 0; ids.forEach((id) => { const r = ratingAt(id, date); c += r.count; s += r.sum; }); return s / c; }
  function trendData() {
    const t = ui.tr, ps = periods(t.range, t.grain);
    const groups = t.stores.length ? t.stores.map((id) => ({ name: SB[id].name, ids: [id] })) : [{ name: 'All stores', ids: STORES.map((s) => s.id) }];
    let keep = ps;
    if (t.grain === 'day') keep = ps.filter((p) => groups.some((g) => g.ids.some((id) => isOpen(id, p.start))));
    const val = (a, m) => (!a.open ? null : m === 'revenue' ? a.revenue : m === 'receipts' ? a.receipts : m === 'avg' ? a.revenue / Math.max(1, a.receipts) : m === 'conv' ? (a.done ? a.conv / a.done : null) : null);
    return { ps: keep, groups: groups, val: val };
  }
  function pageTrends() {
    pageTitle = 'Trends';
    const t = ui.tr; t.stores = t.stores.filter((id) => SB[id]).slice(0, 3);
    const td = trendData(), ps = td.ps, m = t.metric, single = td.groups.length === 1;
    let h = '<div class="head"><div><span class="eyebrow">Up to ' + esc(fday(cur)) + '</span><h1 tabindex="-1">Trends<span class="dot">.</span></h1><p class="sub">Pick a measure, then compare up to 3 stores. With no store picked, the chart shows all stores together' + (single && ['revenue', 'receipts', 'avg'].indexOf(m) >= 0 ? ', with the same weekdays last year as a dashed line' : '') + '.</p></div>' +
      '<div class="head-actions"><button type="button" class="btn" data-act="csvTrend" data-fid="csvTrend">' + ic('exp') + 'Export CSV</button></div></div>';
    h += '<div class="ctrls"><div class="grp"><span class="label">Measure</span><div class="seg" role="group" aria-label="Measure">' + METRICS.map((x) => '<button type="button" data-act="trM" data-v="' + x[0] + '" data-fid="trm-' + x[0] + '" aria-pressed="' + (m === x[0]) + '">' + x[1] + '</button>').join('') + '</div></div>' +
      '<div class="grp"><span class="label">Period</span><div class="seg" role="group" aria-label="Period">' + [30, 60, 120].map((r) => '<button type="button" data-act="trR" data-v="' + r + '" data-fid="trr-' + r + '" aria-pressed="' + (t.range === r) + '">' + r + ' days</button>').join('') + '</div></div>' +
      '<div class="grp"><span class="label">Group by</span><div class="seg" role="group" aria-label="Group by">' + [['day', 'Day'], ['week', 'Week']].map((g) => '<button type="button" data-act="trG" data-v="' + g[0] + '" data-fid="trg-' + g[0] + '" aria-pressed="' + (t.grain === g[0]) + '">' + g[1] + '</button>').join('') + '</div></div></div>';
    h += '<div class="ctrls"><div class="grp" style="flex:1"><span class="label">Stores · ' + (t.stores.length ? t.stores.length + ' of 3 picked' : 'none picked = all stores') + '</span><div class="chips" style="margin-top:0">' +
      STORES.map((s) => { const i = t.stores.indexOf(s.id), on = i >= 0, full = !on && t.stores.length >= 3; return '<button type="button" class="chip" data-act="trS" data-v="' + s.id + '" data-fid="trs-' + s.id + '" aria-pressed="' + on + '"' + (full ? ' disabled title="Up to 3 stores"' : '') + '>' + (on ? '<i class="sw" style="background:' + SER[i] + '" aria-hidden="true"></i>' : '') + esc(s.name) + '</button>'; }).join('') +
      (t.stores.length ? '<button type="button" class="chip" data-act="trClear" data-fid="trClear">' + ic('x') + 'Clear</button>' : '') + '</div></div></div>';
    const mName = METRICS.find((x) => x[0] === m)[1];
    let chart = '', table = '', legend = '';
    if (m === 'mix') {
      const ids = td.groups.reduce((a, g) => a.concat(g.ids), []), rows = ps.map((p) => agg(ids, p).mix);
      chart = stackChart({ id: 'trend', labels: ps.map((p) => p.label), tipLabels: ps.map((p) => p.tip), keys: MIX, rows: rows, aria: 'Sales mix by ' + t.grain + ' for ' + (t.stores.length ? t.stores.map((x) => SB[x].name).join(', ') : 'all stores') + ', share of revenue per category.' });
      legend = MIX.map((k) => '<span><i style="background:' + k.color + '"></i>' + esc(k.name) + '</span>').join('');
      table = '<thead><tr><th scope="col">Period</th>' + MIX.map((k) => '<th scope="col" class="num">' + esc(k.name) + '</th>').join('') + '</tr></thead><tbody>' + rows.map((r, i) => { const tot = MIX.reduce((a, k) => a + r[k.k], 0); return '<tr><td>' + esc(ps[i].tip) + '</td>' + MIX.map((k) => '<td class="num">' + eur0(r[k.k]) + ' · ' + pct(tot ? r[k.k] / tot : 0, 0) + '</td>').join('') + '</tr>'; }).join('') + '</tbody>';
      if (t.stores.length > 1) legend += '<span class="muted">Mix is for the picked stores together.</span>';
    } else {
      let series = [];
      const fmt = m === 'revenue' ? eur0 : m === 'avg' ? eur : m === 'conv' ? (v) => pct(v, 0) : m === 'rating' ? (v) => '★ ' + NF2.format(v) : num;
      const axis = m === 'revenue' ? (v) => (v >= 1000 ? NF1k.format(v / 1000) + 'k' : NF0.format(v)) : m === 'conv' ? (v) => NF0.format(v * 100) + ' %' : m === 'rating' ? (v) => NF3.format(v) : m === 'avg' ? (v) => NF0.format(v) + ' €' : (v) => NF0.format(v);
      if (m === 'exams' && single) {
        const g = td.groups[0], a = ps.map((p) => agg(g.ids, p));
        series = [{ name: 'Booked', color: SER[0], values: a.map((x) => (x.open ? x.booked : null)) }, { name: 'Done', color: SER[1], values: a.map((x) => (x.open ? x.done : null)) }, { name: 'No-shows', color: SER[2], values: a.map((x) => (x.open ? x.noShow : null)) }];
      } else if (m === 'exams') series = td.groups.map((g, i) => ({ name: g.name, color: SER[i], values: ps.map((p) => { const a = agg(g.ids, p); return a.open ? a.done : null; }) }));
      else if (m === 'rating') series = td.groups.map((g, i) => ({ name: g.name, color: SER[i], values: ps.map((p) => ratingCombined(g.ids, p.end)) }));
      else {
        series = td.groups.map((g, i) => ({ name: g.name, color: SER[i], values: ps.map((p) => td.val(agg(g.ids, p), m)) }));
        if (single && m !== 'conv') series.push({ name: 'Same days last year', color: 'var(--ink3)', dash: true, values: ps.map((p) => td.val(agg(td.groups[0].ids, p, -364), m)) });
      }
      const all = [].concat.apply([], series.map((s) => s.values)).filter((v) => v != null);
      chart = lineChart({ id: 'trend', labels: ps.map((p) => p.label), tipLabels: ps.map((p) => p.tip), series: series, fmt: fmt, axis: axis, tight: m === 'rating' || m === 'conv' || m === 'avg', floor: 0, ceil: m === 'conv' ? 1 : m === 'rating' ? 5 : null,
        aria: mName + ' by ' + t.grain + ', last ' + t.range + ' days, for ' + series.map((s) => s.name).join(', ') + '. ' + (all.length ? 'Range ' + fmt(Math.min.apply(null, all)) + ' to ' + fmt(Math.max.apply(null, all)) + '.' : '') });
      legend = series.length > 1 ? series.map((s) => '<span><i style="background:' + s.color + (s.dash ? ';opacity:.6' : '') + '"></i>' + esc(s.name) + '</span>').join('') : '';
      table = '<thead><tr><th scope="col">Period</th>' + series.map((s) => '<th scope="col" class="num">' + esc(s.name) + '</th>').join('') + '</tr></thead><tbody>' + ps.map((p, i) => '<tr><td>' + esc(p.tip) + '</td>' + series.map((s) => '<td class="num">' + (s.values[i] == null ? '<span class="muted">closed</span>' : esc(fmt(s.values[i]))) + '</td>').join('') + '</tr>').join('') + '</tbody>';
      trendCsv = { header: ['Period start', 'Period end'].concat(series.map((s) => s.name)), rows: ps.map((p, i) => [p.start, p.end].concat(series.map((s) => (s.values[i] == null ? '' : csvNum(s.values[i], m === 'conv' || m === 'rating' ? 4 : 2))))) };
    }
    if (m === 'mix') { const ids = td.groups.reduce((a, g) => a.concat(g.ids), []); trendCsv = { header: ['Period start', 'Period end'].concat(MIX.map((k) => k.name + ' EUR')), rows: ps.map((p) => { const a = agg(ids, p).mix; return [p.start, p.end].concat(MIX.map((k) => csvNum(a[k.k]))); }) }; }
    h += '<div class="card"><div class="card-h"><div><span class="label">' + (t.grain === 'week' ? 'Weekly' : 'Daily') + ' · last ' + t.range + ' days</span><h2>' + esc(mName) + '</h2></div>' + (legend ? '<div class="legend">' + legend + '</div>' : '') + '</div><div class="card-b">' +
      (ps.length ? chart + '<details class="tbl" style="margin-top:8px"><summary>Show as table</summary><div class="tw"><table class="t compact">' + table + '</table></div></details>' : '<div class="empty dashed">No open days in this period.</div>') + '</div></div>';
    return h;
  }
  let trendCsv = null;
  ACT.trM = (d) => { ui.tr.metric = d.v; saveUi(); rerender(); };
  ACT.trR = (d) => { ui.tr.range = +d.v; saveUi(); rerender(); };
  ACT.trG = (d) => { ui.tr.grain = d.v; saveUi(); rerender(); };
  ACT.trS = (d) => { const a = ui.tr.stores, i = a.indexOf(d.v); if (i >= 0) a.splice(i, 1); else if (a.length < 3) a.push(d.v); saveUi(); rerender(); };
  ACT.trClear = () => { ui.tr.stores = []; saveUi(); rerender(); };
  ACT.csvTrend = () => { if (trendCsv) downloadCsv('store-trends-' + ui.tr.metric, trendCsv.header, trendCsv.rows); };

  // ════════════════════════════════════════════════════════════════════════
  // 4. Staff hours
  // ════════════════════════════════════════════════════════════════════════
  function staffPeriod() {
    const p = ui.staff.period;
    if (p === 'mtd') return { from: cur.slice(0, 8) + '01', to: cur, label: 'Month to date' };
    return { from: U.addDays(cur, -(+p - 1)), to: cur, label: 'Last ' + p + ' days' };
  }
  function staffStats(id, from, to) {
    const team = D.staff(id), by = {}; let storePlanned = 0, storeActual = 0, storeRev = 0;
    team.forEach((p) => { by[p.id] = { p: p, shifts: 0, planned: 0, actual: 0, late: 0, lateMin: 0, missing: 0, absent: 0, sales: 0, days: [] }; });
    const daysOut = [];
    for (let d = from; d <= to; d = U.addDays(d, 1)) {
      const dd = day(id, d); if (!dd.open) continue;
      const att = D.attendance(id, d); let w = 0, dp = 0, da = 0;
      att.forEach((a) => { if (!a.absent) w += a.actual * by[a.staffId].p.salesFactor; });
      att.forEach((a) => {
        const r = by[a.staffId]; r.shifts++; r.planned += a.planned; dp += a.planned;
        if (a.absent) r.absent++; else { r.actual += a.actual; da += a.actual; r.sales += w ? dd.revenue * a.actual * r.p.salesFactor / w : 0; }
        if (a.late) { r.late++; r.lateMin += a.late; }
        if (a.missingOut) r.missing++;
        r.days.push({ d: d, a: a });
      });
      storePlanned += dp; storeActual += da; storeRev += dd.revenue;
      daysOut.push({ d: d, planned: dp, actual: da, people: att.filter((a) => !a.absent).length, rev: dd.revenue });
    }
    return { rows: team.map((p) => by[p.id]), planned: storePlanned, actual: storeActual, rev: storeRev, days: daysOut };
  }
  function pageStaff() {
    pageTitle = 'Staff hours';
    if (!ui.staff.store || !SB[ui.staff.store]) ui.staff.store = ui.viewAs !== 'HO' ? ui.viewAs : myStore();
    const id = ui.staff.store, per = staffPeriod(), S = staffStats(id, per.from, per.to);
    const so = ui.staff, rows = S.rows.slice();
    const key = { name: (r) => r.p.name, role: (r) => r.p.role, shifts: (r) => r.shifts, planned: (r) => r.planned, actual: (r) => r.actual, diff: (r) => r.actual - r.planned, late: (r) => r.late, missing: (r) => r.missing, absent: (r) => r.absent, sph: (r) => (r.actual ? r.sales / r.actual : 0) }[so.sort] || ((r) => r.p.name);
    rows.sort((a, b) => { const x = key(a), y = key(b); return (typeof x === 'string' ? x.localeCompare(y) : x - y) * so.dir || a.p.name.localeCompare(b.p.name); });
    const issues = S.rows.reduce((a, r) => a + r.late + r.missing + r.absent, 0);
    let h = '<div class="head"><div><span class="eyebrow">' + esc(per.label) + ' · ' + esc(fdate(per.from)) + ' – ' + esc(fdate(per.to)) + '</span><h1 tabindex="-1">Staff hours<span class="dot">.</span></h1><p class="sub">Planned shifts compared with clocked hours (demo time-attendance data). Shown in name order; use it to plan cover and follow up on missing clock-outs, not to rank people.</p></div>' +
      '<div class="head-actions"><button type="button" class="btn" data-act="csvStaff" data-fid="csvStaff">' + ic('exp') + 'Export CSV</button></div></div>';
    h += '<div class="ctrls"><div class="grp"><label class="label" for="staffStore">Store</label><select class="select" id="staffStore" data-chg="staffStore">' + STORES.map((s) => '<option value="' + s.id + '"' + (s.id === id ? ' selected' : '') + '>' + esc(s.name) + ' (' + s.country + ')</option>').join('') + '</select></div>' +
      '<div class="grp"><span class="label">Period</span><div class="seg" role="group" aria-label="Period">' + [['7', '7 days'], ['30', '30 days'], ['mtd', 'Month to date']].map((x) => '<button type="button" data-act="stP" data-v="' + x[0] + '" data-fid="stp-' + x[0] + '" aria-pressed="' + (String(so.period) === x[0]) + '">' + x[1] + '</button>').join('') + '</div></div></div>';
    h += '<div class="kpis">' + kpi('Planned hours', NF0.format(S.planned), S.days.length + ' open days', '') +
      kpi('Clocked hours', NF0.format(S.actual), (S.actual - S.planned >= 0 ? '+' : '−') + NF1.format(Math.abs(S.actual - S.planned)) + ' h vs plan (' + sgnPct(S.planned ? S.actual / S.planned - 1 : 0) + ')', '') +
      kpi('Sales per staff hour', S.actual ? eur0(S.rev / S.actual) : '—', 'revenue ' + eur0(S.rev), '') +
      kpi('Attendance notes', String(issues), issues ? 'late arrivals, missing clock-outs, absences' : 'none in this period', '') + '</div>';
    const cols = [['name', 'Name'], ['role', 'Role'], ['shifts', 'Shifts'], ['planned', 'Planned'], ['actual', 'Clocked'], ['diff', 'Difference'], ['late', 'Late arrivals'], ['missing', 'Missing clock-outs'], ['absent', 'Absences'], ['sph', 'Sales per hour']];
    const th = (c, i) => { const on = so.sort === c[0]; return '<th scope="col"' + (i > 1 ? ' class="num"' : '') + (on ? ' aria-sort="' + (so.dir > 0 ? 'ascending' : 'descending') + '"' : '') + '><button type="button" data-act="stSort" data-k="' + c[0] + '" data-fid="sth-' + c[0] + '">' + c[1] + (on ? (so.dir > 0 ? ' ↑' : ' ↓') : '') + '</button></th>'; };
    h += '<div class="card"><div class="tw"><table class="t"><caption class="sr">Hours per person, ' + esc(per.label) + '</caption><thead><tr>' + cols.map(th).join('') + '</tr></thead><tbody>' +
      rows.map((r) => { const df = r.actual - r.planned; return '<tr><td class="name"><button type="button" class="btn ghost sm" style="padding:0 8px;margin-left:-8px" data-act="person" data-id="' + r.p.id + '" data-fid="ps-' + r.p.id + '">' + esc(r.p.name) + '</button>' + (r.p.fte < 1 ? '<small>part-time</small>' : '') + '</td><td class="nw">' + esc(r.p.role) + '</td>' +
        '<td class="num">' + r.shifts + '</td><td class="num">' + hrs(r.planned) + '</td><td class="num">' + hrs(r.actual) + '</td><td class="num">' + (df >= 0 ? '+' : '−') + NF1.format(Math.abs(df)) + ' h</td>' +
        '<td class="num">' + (r.late ? r.late + '<small>' + r.lateMin + ' min total</small>' : '0') + '</td><td class="num">' + r.missing + '</td><td class="num">' + r.absent + '</td><td class="num">' + (r.actual ? eur0(r.sales / r.actual) : '—') + '</td></tr>'; }).join('') +
      (rows.every((r) => !r.shifts) ? '<tr><td colspan="10"><div class="empty">No shifts in this period.</div></td></tr>' : '') +
      '</tbody><tfoot><tr><td>Store total</td><td></td><td class="num">' + S.rows.reduce((a, r) => a + r.shifts, 0) + '</td><td class="num">' + hrs(S.planned) + '</td><td class="num">' + hrs(S.actual) + '</td><td class="num">' + (S.actual - S.planned >= 0 ? '+' : '−') + NF1.format(Math.abs(S.actual - S.planned)) + ' h</td>' +
      '<td class="num">' + S.rows.reduce((a, r) => a + r.late, 0) + '</td><td class="num">' + S.rows.reduce((a, r) => a + r.missing, 0) + '</td><td class="num">' + S.rows.reduce((a, r) => a + r.absent, 0) + '</td><td class="num">' + (S.actual ? eur0(S.rev / S.actual) : '—') + '</td></tr></tfoot></table></div>' +
      '<div class="card-foot">Late = clocked in more than 5 minutes after the planned start. A missing clock-out counts the planned end time. Sales per hour attributes each day’s revenue to the people on the floor by their clocked hours (optometrists spend part of their time on eye exams), so it is an estimate.</div></div>';
    h += '<details class="tbl" style="margin-top:14px"><summary>Day by day for the store</summary><div class="card" style="margin-top:8px"><div class="tw"><table class="t compact"><thead><tr><th scope="col">Day</th><th scope="col" class="num">People</th><th scope="col" class="num">Planned</th><th scope="col" class="num">Clocked</th><th scope="col" class="num">Revenue</th><th scope="col" class="num">Sales per hour</th></tr></thead><tbody>' +
      S.days.slice().reverse().map((x) => '<tr><td>' + esc(fday(x.d)) + '</td><td class="num">' + x.people + '</td><td class="num">' + hrs(x.planned) + '</td><td class="num">' + hrs(x.actual) + '</td><td class="num">' + eur0(x.rev) + '</td><td class="num">' + (x.actual ? eur0(x.rev / x.actual) : '—') + '</td></tr>').join('') + '</tbody></table></div></div></details>';
    staffCache = S;
    return h;
  }
  let staffCache = null;
  ACT.stP = (d) => { ui.staff.period = d.v === 'mtd' ? 'mtd' : +d.v; saveUi(); rerender(); };
  ACT.stSort = (d) => { const s = ui.staff; if (s.sort === d.k) s.dir = -s.dir; else { s.sort = d.k; s.dir = d.k === 'name' || d.k === 'role' ? 1 : -1; } saveUi(); rerender(); };
  ACT.person = (d) => {
    const r = staffCache && staffCache.rows.find((x) => x.p.id === d.id); if (!r) return;
    const per = staffPeriod();
    const body = '<div class="minis"><div class="mini"><span>Planned</span><b>' + hrs(r.planned) + '</b></div><div class="mini"><span>Clocked</span><b>' + hrs(r.actual) + '</b></div><div class="mini"><span>Shifts</span><b>' + r.shifts + '</b></div></div>' +
      '<h3>' + esc(per.label) + '</h3>' + (r.days.length ? '<div class="tw"><table class="t compact"><thead><tr><th scope="col">Day</th><th scope="col">Planned</th><th scope="col">Clock in</th><th scope="col">Clock out</th><th scope="col" class="num">Hours</th><th scope="col">Note</th></tr></thead><tbody>' +
      r.days.slice().reverse().map((x) => { const a = x.a; return '<tr><td class="nw">' + esc(fdayShort(x.d)) + '</td><td class="nw">' + hm(a.start) + '–' + hm(a.end) + '</td><td>' + (a.absent ? '—' : hm(a.in)) + '</td><td>' + (a.absent ? '—' : a.missingOut ? '<span class="badge b-clay">missing</span>' : hm(a.out)) + '</td><td class="num">' + (a.absent ? '0' : NF1.format(a.actual)) + '</td><td>' + (a.absent ? esc(a.reason) : a.late ? a.late + ' min late' : '') + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<div class="empty dashed">No shifts in this period (days off or annual leave).</div>') +
      '<p class="hint" style="margin-top:12px">Fictional person and demo clock-in data. Contact: ' + esc(r.p.email) + '</p>';
    drawer(esc(r.p.name), esc(r.p.role + ' · ' + SB[r.p.store].name), body);
  };
  ACT.csvStaff = () => {
    if (!staffCache) return; const per = staffPeriod(), id = ui.staff.store;
    downloadCsv('staff-hours-' + id, ['Store', 'From', 'To', 'Name', 'Role', 'Part-time', 'Shifts', 'Planned h', 'Clocked h', 'Difference h', 'Late arrivals', 'Late minutes', 'Missing clock-outs', 'Absences', 'Sales per hour EUR (estimate)'],
      staffCache.rows.map((r) => [SB[id].name, per.from, per.to, r.p.name, r.p.role, r.p.fte < 1 ? 'yes' : 'no', r.shifts, csvNum(r.planned), csvNum(r.actual), csvNum(r.actual - r.planned), r.late, r.lateMin, r.missing, r.absent, csvNum(r.actual ? r.sales / r.actual : null)]));
  };

  // ════════════════════════════════════════════════════════════════════════
  // 5. Tasks
  // ════════════════════════════════════════════════════════════════════════
  function pageTasks() {
    pageTitle = 'Tasks';
    const live = LIVE(), va = VA(), B = SBX(), T = TD(), ho = va === 'HO', tf = live ? { filter: ui.tasks.filter, store: B[ui.ltaskStore] ? ui.ltaskStore : '' } : ui.tasks;
    let h = '<div class="head"><div><span class="eyebrow">' + (live ? 'Live stores · ' : '') + (ho ? 'Head office · all stores' : esc(B[va].name)) + '</span><h1 tabindex="-1">Tasks<span class="dot">.</span></h1><p class="sub">' +
      (ho ? 'Send a task to one or more stores; each store ticks it off on its board. Switch “Viewing as” to a store to see its list.' : 'Tasks from head office for this store. Tick them off when done.') +
      (live ? ' Tasks for the real stores are kept apart from the demo tasks, in this browser and in your private cloud copy (approved accounts only).' : '') + '</p></div>' +
      '<div class="head-actions">' + (ho ? '<button type="button" class="btn pri" data-act="newTask" data-fid="newTask">' + ic('plus') + 'New task</button>' : '') + '<button type="button" class="btn" data-act="csvTasks" data-fid="csvTasks">' + ic('exp') + 'Export CSV</button></div></div>';
    h += '<div class="ctrls"><div class="seg" role="group" aria-label="Show">' + [['open', 'Open'], ['done', 'Completed'], ['all', 'All']].map((x) => '<button type="button" data-act="tkF" data-v="' + x[0] + '" data-fid="tkf-' + x[0] + '" aria-pressed="' + (tf.filter === x[0]) + '">' + x[1] + '</button>').join('') + '</div>' +
      (ho ? '<label class="sr" for="taskStore">Store</label><select class="select" id="taskStore" data-chg="taskStore"><option value="">All stores</option>' + SL().map((s) => '<option value="' + s.id + '"' + (tf.store === s.id ? ' selected' : '') + '>' + esc(s.name) + '</option>').join('') + '</select>' : '') + '</div>';
    const scope = ho ? tf.store : va;
    let list = T.tasks.filter((t) => !scope || t.stores.indexOf(scope) >= 0);
    const isDone = (t) => (scope ? !!T.taskDone[t.id + '|' + scope] : t.stores.every((s) => T.taskDone[t.id + '|' + s]));
    if (tf.filter === 'open') list = list.filter((t) => !isDone(t)); else if (tf.filter === 'done') list = list.filter(isDone);
    list.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
    if (!list.length) return h + '<div class="card pad"><div class="empty">' + (tf.filter === 'open' ? 'No open tasks. ' + (ho ? 'Create one with “New task”.' : 'All done.') : 'Nothing here yet.') + '</div></div>';
    h += list.map((t) => {
      if (!ho) return '<article class="card tcard">' + taskRow(t, scope) + '<div class="meta-l" style="margin-left:32px">from ' + esc(t.by) + ' · ' + esc(fts(t.createdAt)) + '</div></article>';
      const n = t.stores.filter((s) => T.taskDone[t.id + '|' + s]).length, over = !isDone(t) && t.due < TODAY;
      let x = '<article class="card tcard"><div class="tc-h"><div style="min-width:0"><h3>' + esc(t.title) + '</h3><div class="meta-l"><span>' + ic('cal') + ' Due ' + esc(fday(t.due)) + '</span>' + (over ? '<span class="badge b-clay">Overdue</span>' : '') + '<span>from ' + esc(t.by) + ' · ' + esc(fts(t.createdAt)) + '</span></div></div>' +
        (ho ? '<div style="display:flex;gap:6px;align-items:center"><span class="badge ' + (n === t.stores.length ? 'b-good' : 'plain') + '">' + n + ' of ' + t.stores.length + ' done</span><button type="button" class="btn icon sm ghost" data-act="delTask" data-id="' + t.id + '" data-fid="del-' + t.id + '" aria-label="Delete task ' + esc(t.title) + '">' + ic('trash') + '</button></div>' : '') + '</div>' +
        (t.details ? '<p>' + esc(t.details) + '</p>' : '');
      if (ho) {
        x += '<div class="bar" style="max-width:420px"><i style="width:' + (n / t.stores.length * 100).toFixed(1) + '%"></i></div><div class="chips">' + t.stores.map((s) => {
          const dn = T.taskDone[t.id + '|' + s];
          return '<button type="button" class="chip' + (dn ? ' done' : '') + '" data-act="tkToggle" data-id="' + t.id + '" data-s="' + s + '" data-fid="tk-' + t.id + '-' + s + '" aria-pressed="' + !!dn + '" title="' + (dn ? 'Done ' + esc(fts(dn)) + '. Click to reopen.' : 'Open. Click to tick off for this store.') + '">' + (dn ? ic('check') : '') + esc(B[s] ? B[s].name : s) + '</button>';
        }).join('') + '</div>';
      }
      return x + '</article>';
    }).join('');
    return h;
  }
  ACT.tkF = (d) => { ui.tasks.filter = d.v; saveUi(); rerender(); };
  ACT.tkToggle = (d) => { const T = TD(), B = SBX(), k = d.id + '|' + d.s, nm = B[d.s] ? B[d.s].name : d.s; if (T.taskDone[k]) delete T.taskDone[k]; else T.taskDone[k] = nowTs(); save(); rerender(); toast(T.taskDone[k] ? 'Ticked off for ' + nm : 'Reopened for ' + nm); };
  ACT.delTask = (d) => {
    const T0 = TD(), t = T0.tasks.find((x) => x.id === d.id); if (!t) return;
    confirmBox('Delete this task?', '“' + esc(t.title) + '” is removed from all ' + t.stores.length + ' store boards, including their ticks.', 'Delete task', () => {
      const T = TD(); if (T !== T0) return null;     // the mode changed while the dialog was open
      T.tasks = T.tasks.filter((x) => x.id !== d.id);
      Object.keys(T.taskDone).forEach((k) => { if (k.split('|')[0] === d.id) delete T.taskDone[k]; });
      save(); rerender(); toast('Task deleted'); return null;
    }, true);
  };
  ACT.newTask = () => {
    const SLm = SL(), SBm = SBX(), T0 = TD();
    const grp = (c) => '<div class="storepick">' + SLm.filter((s) => s.country === c).map((s) => '<label class="check"><input type="checkbox" name="st" value="' + s.id + '">' + esc(s.name) + '</label>').join('') + '</div>';
    modal({
      title: 'New task for stores', submitLabel: 'Send to stores', wide: true,
      body: '<div class="field"><label for="tkTitle">Task</label><input class="in" id="tkTitle" name="title" maxlength="140" required placeholder="e.g. Change the window display by Friday" data-autofocus></div>' +
        '<div class="field"><label for="tkDet">Details (optional)</label><textarea class="in" id="tkDet" name="details" maxlength="1000"></textarea></div>' +
        '<div class="field"><label for="tkDue">Due date</label><input class="in" type="date" id="tkDue" name="due" min="' + TODAY + '" value="' + U.addDays(TODAY, 3) + '" style="max-width:220px"></div>' +
        '<fieldset><legend>Stores</legend><div class="qbtns"><button type="button" class="btn sm" data-pickst="all">All stores</button><button type="button" class="btn sm" data-pickst="SI">Slovenia</button><button type="button" class="btn sm" data-pickst="HR">Croatia</button><button type="button" class="btn sm ghost" data-pickst="none">None</button></div>' +
        '<p class="label" style="margin:8px 0 0">Slovenia</p>' + grp('SI') + '<p class="label" style="margin:10px 0 0">Croatia</p>' + grp('HR') + '</fieldset>' +
        '<p class="hint">' + (LIVE() ? 'The task appears on the chosen live store boards for everyone who uses this browser or your synced cloud copy. No e-mail or message is sent.' : 'The task appears on the chosen store boards in this demo. No e-mail or message is sent.') + '</p>',
      mount: (f) => { f.addEventListener('click', (e) => { const b = e.target.closest('[data-pickst]'); if (!b) return; const v = b.getAttribute('data-pickst'); f.querySelectorAll('input[name=st]').forEach((i) => { i.checked = v === 'all' || (v !== 'none' && SBm[i.value].country === v); }); }); },
      onSubmit: (f) => {
        const title = f.elements.title.value.trim(), due = f.elements.due.value, stores = Array.prototype.filter.call(f.querySelectorAll('input[name=st]'), (i) => i.checked).map((i) => i.value);
        f.elements.title.setAttribute('aria-invalid', title ? 'false' : 'true');
        if (!title) return 'Write what the stores should do.';
        if (!/^\d{4}-\d\d-\d\d$/.test(due)) return 'Pick a due date.';
        if (due < TODAY) return 'The due date cannot be in the past.';
        if (!stores.length) return 'Pick at least one store.';
        const T = TD();
        if (T !== T0) return 'The data source changed while this was open. Close the dialog and try again.';
        const id = 't' + (T.nextTask || (T.tasks.length + 1)) + '-' + Date.now().toString(36);
        T.nextTask = (T.nextTask || T.tasks.length + 1) + 1;
        T.tasks.push({ id: id, title: title, details: f.elements.details.value.trim(), due: due, stores: stores, createdAt: nowTs(), by: 'Head office' });
        save(); ui.tasks.filter = 'open'; saveUi(); rerender(); toast('Task sent to ' + stores.length + ' store' + (stores.length === 1 ? '' : 's'));
        return null;
      }
    });
  };
  ACT.csvTasks = () => {
    const rows = [], T = TD(), B = SBX();
    T.tasks.forEach((t) => t.stores.forEach((s) => { const dn = T.taskDone[t.id + '|' + s]; rows.push([t.title, t.details || '', t.due, B[s] ? B[s].name : s, dn ? 'done' : 'open', dn ? dn.replace('T', ' ') : '', t.by, t.createdAt.replace('T', ' ')]); }));
    downloadCsv(LIVE() ? 'store-tasks-live' : 'store-tasks', ['Task', 'Details', 'Due', 'Store', 'Status', 'Done at', 'From', 'Created'], rows);
  };

  // ════════════════════════════════════════════════════════════════════════
  // Cloud sync + cross-tab updates
  // ════════════════════════════════════════════════════════════════════════
  let SYNC = null, applying = false;
  function syncChanged() { if (SYNC && !applying) { try { SYNC.changed(); } catch (e) { /* sync unavailable */ } } }
  function applyCloud(data) {
    if (!validState(data)) return Promise.reject(new Error('The cloud copy is not store-board data this version can read.'));
    clearTimeout(saveTimer); saveTimer = null;
    applying = true; state = ensureLive(data);
    const snap = state;
    const w = idbOK ? enqueue(() => idbPut(snap).then(announce)) : Promise.resolve();
    return w.then(() => { applying = false; closeAll(); rerender(); toast('Loaded your store-board data from the cloud'); }, (e) => { applying = false; throw e; });
  }
  // Work on the live stores (cash checks, notes, tasks) only goes into the cloud copy of an account that is on
  // the live-data list and signed in now; on a shared browser another (not approved) account never receives it.
  function syncSnapshot() {
    const snap = JSON.parse(JSON.stringify(state));
    let u = null;
    try { u = window.AdrialSync.user(); } catch (e) { u = null; }
    const email = u && u.email ? String(u.email).toLowerCase() : '';
    if (!(SESSION.allowed && SESSION.email && String(SESSION.email).toLowerCase() === email)) snap.live = emptyLive();
    return snap;
  }
  function syncStart() {
    if (!window.AdrialSync || SYNC) return;
    try {
      SYNC = window.AdrialSync.attach({ app: 'stores', label: 'Store board', getSnapshot: () => Promise.resolve(syncSnapshot()), applySnapshot: applyCloud });
      const el = $('syncPanel'); if (el) SYNC.mountPanel(el);
    } catch (e) { if (window.console) console.warn('Store board: cloud sync unavailable', e); }
  }
  if (channel) channel.onmessage = (e) => {
    if (!e.data || e.data.type !== 'changed' || !state || saveTimer || noteTimer && document.activeElement && document.activeElement.id === 'noteBox') return;
    enqueue(() => idbGet()).then((n) => {
      if (!validState(n) || saveTimer) return;
      state = ensureLive(n);
      if (layers.length) { closeAll(); toast('Updated from another tab: the dialog was closed.'); }
      if (document.activeElement && document.activeElement.id === 'noteBox') { renderNav(); return; }
      rerender();
    });
  };

  // ════════════════════════════════════════════════════════════════════════
  // LIVE DATA — the real 8 optics stores for allow-listed accounts (server: /stores.js)
  // Everything fetched lives in LC / LDAYS (page memory) only. The team's work on live stores is state.live.
  // "Taken" is money taken at the tills (card + cash, incl. deposits on orders), NOT invoiced sales.
  // ════════════════════════════════════════════════════════════════════════
  const MODEKEY = 'adrial-stores-mode', API = '/api/stores/', METAURL = API + 'meta', AHEADURL = API + 'ahead', COMPURL = API + 'complaints';
  let SESSION = { checked: false, failed: false, signedIn: false, allowed: false, email: null };
  let LC = {}, LDAYS = [], lgen = 0, lrTimer = null, lastDrop = 0, dcur = null, lcurPicked = false, ltrendCsv = null, lallCsv = null;
  function lurl(r, params) {
    const q = [];
    Object.keys(params || {}).forEach((k) => { const v = params[k]; if (v !== '' && v != null) q.push(encodeURIComponent(k) + '=' + encodeURIComponent(v)); });
    return API + r + (q.length ? '?' + q.join('&') : '');
  }

  // ── Fetching (same-origin GET, sign-in cookie; only the server's `error` text is ever shown) ──
  function lfetch(url) {
    return fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' }, cache: 'no-store' }).then((r) => r.json().catch(() => ({})).then((j) => {
      if (r.ok) return j;
      const msg = j && typeof j.error === 'string' && j.error ? j.error.slice(0, 300) :
        r.status === 401 ? 'Sign in to see live store data.' : r.status === 403 ? 'Your account is not on the list for live store data.' : 'The store data is unavailable right now.';
      const e = new Error(msg); e.status = r.status; throw e;
    }), () => { const e = new Error('Could not reach the server. Check the connection and try again.'); e.status = 0; throw e; });
  }
  function lindex(d) {
    const by = {}, mo = {};
    d.days.forEach((r) => { (by[r.store] = by[r.store] || {})[r.date] = r; });
    d.months.forEach((m) => { (mo[m.store] = mo[m.store] || {})[String(m.month).slice(0, 7)] = m; });
    return { by: by, mo: mo };
  }
  function lget(url) {
    let c = LC[url];
    if (c) return c;
    const g = lgen;
    c = LC[url] = { status: 'loading', url: url };
    lfetch(url).then((d) => {
      if (g !== lgen || LC[url] !== c) return;
      c.status = 'ok'; c.data = d;
      if (url.indexOf(API + 'days') === 0 && Array.isArray(d.days) && Array.isArray(d.months)) LDAYS.unshift(lindex(d));
      if (url === METAURL) lmetaArrived();
      liveChanged();
    }, (e) => {
      if (g !== lgen || LC[url] !== c) return;
      c.status = 'error'; c.err = e.message; c.code = e.status;
      if (e.status === 401 || e.status === 403) liveDenied(e.status); else liveChanged();
    });
    return c;
  }
  function liveChanged() { clearTimeout(lrTimer); lrTimer = setTimeout(() => { if (LIVE() && state) rerender(); }, 30); }
  // forget every live number held by the page (fetched rows, chart series, CSV buffers)
  function liveForget() {
    lgen++; LC = {}; LDAYS = []; ltrendCsv = null; lallCsv = null;
    Object.keys(charts).forEach((k) => { delete charts[k]; });
  }
  function memo(c, k, fn) { c.memo = c.memo || {}; if (!(k in c.memo)) c.memo[k] = fn(c.data); return c.memo[k]; }
  // a 401/403 anywhere: drop to demo at once, forget every live row, then re-check the session
  function liveDenied(code) {
    if (!LIVE()) return;
    lastDrop = Date.now();
    SESSION.allowed = false;
    if (code === 401) SESSION.signedIn = false;
    lsetMode('demo');
    toast(code === 401 ? 'Live data needs sign-in: showing demo data.' : 'This account has no access to live store data: showing demo data.');
    checkSession();
  }
  function lwait(cs, what) {
    for (let i = 0; i < cs.length; i++) if (cs[i].status === 'error') return lerror(cs[i]);
    for (let j = 0; j < cs.length; j++) if (cs[j].status !== 'ok') return '<div class="card pad"><p class="loading" role="status" style="margin:10px 0"><i aria-hidden="true"></i>Loading ' + esc(what) + '…</p></div>';
    return null;
  }
  function lerror(c) {
    const t = { 0: 'Could not reach the server', 401: 'Sign in to see live store data', 403: 'No access to live store data', 400: 'That could not be looked up' }[c.code] || 'Could not load this part of the live data';
    return '<div class="card pad lerr" role="alert"><h2>' + esc(t) + '</h2><p>' + esc(c.err || '') + '</p><div class="dr-actions">' +
      (c.code !== 400 && c.code !== 401 && c.code !== 403 ? '<button type="button" class="btn" data-act="lretry" data-fid="lretry">Try again</button>' : '') +
      (c.code === 401 ? '<button type="button" class="btn pri" data-act="lsignin">Sign in</button>' : '') +
      (c.code === 401 || c.code === 403 ? '<button type="button" class="btn" data-act="mode" data-v="demo">Show demo data</button>' : '') + '</div></div>';
  }
  ACT.lretry = () => { Object.keys(LC).forEach((k) => { if (LC[k].status === 'error') delete LC[k]; }); rerender(); };
  ACT.lsignin = () => { if (window.AdrialSync && window.AdrialSync.signIn) window.AdrialSync.signIn(); else toast('Sign-in is not available on this server.'); };

  // ── Session and mode ─────────────────────────────────────────────────────
  let sessP = null;
  function checkSession() {
    if (sessP) return sessP;
    sessP = fetch(API + 'session', { credentials: 'same-origin', headers: { Accept: 'application/json' }, cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error('session ' + r.status); return r.json(); })
      .then((j) => { SESSION = { checked: true, failed: false, signedIn: !!j.signedIn, allowed: !!j.allowed, email: j.email || null }; },
        () => { SESSION = { checked: true, failed: true, signedIn: false, allowed: false, email: null }; })
      .then(() => { sessP = null; applySession(); });
    return sessP;
  }
  function applySession() {
    if (!SESSION.allowed) {
      if (LIVE()) { lsetMode('demo'); toast(SESSION.signedIn ? 'This account has no access to live store data: showing demo data.' : 'Live data needs sign-in: showing demo data.'); }
      else if (state) rerender(); else renderChrome();
      return;
    }
    // allowed accounts start in live unless they chose demo (and not straight after a 401/403 drop)
    if (!LIVE() && lsGet(MODEKEY) !== 'demo' && Date.now() - lastDrop > 60000) lsetMode('live');
    else if (state) rerender(); else renderChrome();
  }
  function watchAuth() {
    if (!window.AdrialSync || !window.AdrialSync.on) return;
    let last = (window.AdrialSync.user() || {}).email || '';
    window.AdrialSync.on(() => { const now = (window.AdrialSync.user() || {}).email || ''; if (now !== last) { last = now; checkSession(); } });
  }
  function lsetMode(m) {
    if (m === 'live' && !SESSION.allowed) m = 'demo';
    if (m === MODE) { if (state) rerender(); else renderChrome(); return; }
    MODE = m;
    liveForget();
    if (m === 'live') { dcur = cur; cur = YDAY; lcurPicked = false; lget(METAURL); lget(COMPURL); lget(AHEADURL); }
    else cur = dcur || YDAY;
    if (!state) { renderChrome(); return; }
    closeAll();
    onRoute();
  }
  ACT.mode = (d) => {
    if (d.v === 'live' && !SESSION.allowed) { toast('Live store data is only for approved accounts.'); return; }
    lsSet(MODEKEY, d.v);
    const was = MODE;
    lsetMode(d.v);
    if (was !== MODE) toast(LIVE() ? 'Showing live store data' : 'Showing demo data');
    const b = document.querySelector('[data-fid="mode-' + d.v + '"]'); if (b) b.focus();
  };
  function liveNote(side) {
    if (!SESSION.checked || SESSION.allowed) return '';
    let txt;
    if (SESSION.failed) txt = esc('Live store data could not be checked right now; this is demo data.');
    else if (!SESSION.signedIn) txt = 'Live store data is available to approved accounts — <button type="button" class="linkish" data-act="lsignin">sign in</button>';
    else txt = esc('Live store data is available to approved accounts. ' + (SESSION.email || 'This account') + ' is not on the list.');
    return '<div class="' + (side ? 'live-note' : 'notice') + '"><span>' + txt + '</span></div>';
  }
  function lmeta() { const c = LC[METAURL]; return c && c.status === 'ok' ? c.data : null; }
  function lthrough() { const m = lmeta(); return m && /^\d{4}-\d\d-\d\d$/.test(m.dataThrough || '') ? m.dataThrough : null; }
  function lmetaArrived() {
    const thr = lthrough();
    if (!LIVE() || !thr) return;
    if (!lcurPicked || cur > thr) cur = thr;
  }
  function renderChrome() {
    const live = LIVE(), thr = lthrough();
    const bs = document.querySelector('.brand small'); if (bs) bs.textContent = live ? 'Live' + (thr ? ' · data through ' + fdate(thr) : ' · optics stores') : 'Demo · optics stores';
    const dp = document.querySelector('.demo-pill'); if (dp) dp.hidden = live;
    const rb = $('resetBtn'); if (rb) rb.hidden = live;
    const mp = $('modePanel'); if (!mp) return;
    let h = '';
    if (SESSION.allowed) {
      h = '<div class="seg mode-seg" role="group" aria-label="Data source">' + [['live', 'Live data'], ['demo', 'Demo']].map((x) =>
        '<button type="button" data-act="mode" data-v="' + x[0] + '" data-fid="mode-' + x[0] + '" aria-pressed="' + (MODE === x[0] ? 'true' : 'false') + '">' + x[1] + '</button>').join('') + '</div>';
      if (live) h += '<span class="live-pill"><i aria-hidden="true"></i>Live · data through ' + (thr ? fdate(thr) : '…') + '</span>';
    } else h = liveNote(true);
    if (mp.getAttribute('data-h') !== h) { mp.innerHTML = h; mp.setAttribute('data-h', h); }
  }
  function lhead(eye, title, sub, actions) {
    const thr = lthrough();
    return '<div class="head"><div><span class="eyebrow">Live' + (thr ? ' · data through ' + esc(fdate(thr)) : '') + (eye ? ' · ' + eye : '') + '</span><h1 tabindex="-1">' + esc(title) + '<span class="dot">.</span></h1>' +
      (sub ? '<p class="sub">' + sub + '</p>' : '') + '</div>' + (actions ? '<div class="head-actions">' + actions + '</div>' : '') + '</div>';
  }

  // ── Live lookups ─────────────────────────────────────────────────────────
  function lrow(name, d) { for (let i = 0; i < LDAYS.length; i++) { const b = LDAYS[i].by[name]; if (b && b[d]) return b[d]; } return null; }
  function lmonth(name, ym) { for (let i = 0; i < LDAYS.length; i++) { const b = LDAYS[i].mo[name]; if (b && b[ym]) return b[ym]; } return null; }
  function lsm(name) { const m = lmeta(); return m && Array.isArray(m.stores) ? m.stores.find((x) => x.store === name) || null : null; }
  function lcompl(name) {
    const c = LC[COMPURL]; if (!c || c.status !== 'ok') return [];
    const by = memo(c, 'by', (d) => { const o = {}; (d.complaints || []).forEach((x) => { (o[x.store] = o[x.store] || []).push(x); }); Object.keys(o).forEach((k) => o[k].sort((a, b) => (+b.age_days || 0) - (+a.age_days || 0))); return o; });
    return by[name] || [];
  }
  const monthEnd = (ym) => ym + '-' + U.pad(U.monthDays(ym));
  // one days window per board month: 6 weeks of same-weekday history plus the whole month (to the data date)
  function lboardUrl(d) {
    const thr = lthrough(); let to = monthEnd(d.slice(0, 7));
    if (thr && to > thr) to = thr;
    return lurl('days', { from: U.addDays(d, -42).slice(0, 7) + '-01', to: to });
  }
  const LSWK = ['taken', 'card', 'cash', 'card_payments', 'cash_payments', 'orders_paid', 'deposits', 'final_payments', 'refunds', 'exams_booked', 'exams_booked_online', 'exams_cancelled', 'new_bookings_online', 'new_bookings_staff', 'complaints_received', 'complaints_closed'];
  // average of the same weekday over the previous 6 weeks (open days only: money taken > 0)
  function lsw(name, d) {
    const o = { n: 0 }; LSWK.forEach((k) => { o[k] = 0; });
    for (let i = 1; i <= 6; i++) { const r = lrow(name, U.addDays(d, -7 * i)); if (!r || !(r.taken > 0)) continue; o.n++; LSWK.forEach((k) => { o[k] += +r[k] || 0; }); }
    if (!o.n) return null;
    LSWK.forEach((k) => { o[k] /= o.n; });
    return o;
  }
  // month to date vs the monthly sales-plan target; open days = days with money taken so far
  function lmtd(name, d) {
    const ym = d.slice(0, 7), mo = lmonth(name, ym), last = +d.slice(8, 10);
    let sum = 0, elapsed = 0, have = 0;
    for (let i = 1; i <= last; i++) { const r = lrow(name, ym + '-' + U.pad(i)); if (!r) continue; have++; sum += +r.taken || 0; if (r.taken > 0) elapsed++; }
    const target = mo && mo.target_month != null ? +mo.target_month : null, wd = mo && mo.working_days != null ? +mo.working_days : null;
    const tday = mo && mo.target_day != null ? +mo.target_day : (target != null && wd ? target / wd : null);
    const remaining = wd != null ? Math.max(0, wd - elapsed) : null;
    const expected = tday != null ? tday * (wd != null ? Math.min(elapsed, wd) : elapsed) : null;
    const runRate = elapsed ? sum / elapsed : 0;
    return { ym: ym, sum: sum, target: target, total: wd, tday: tday, elapsed: elapsed, remaining: remaining, expected: expected, complete: have === last,
      pct: target ? sum / target : null, pace: expected ? sum / expected : null, need: remaining ? Math.max(0, (target || 0) - sum) / remaining : 0,
      runRate: runRate, projected: sum + runRate * (remaining || 0) };
  }
  const plural = (n, w) => num(n) + ' ' + w + (n === 1 ? '' : 's');
  // traffic light for the live data: the worst reason decides the colour
  function lstatus(s, d) {
    const r = lrow(s.name, d), reasons = [];
    if (!r) return { level: 'closed', reasons: [{ lv: 'closed', t: 'No till data for this day' }] };
    if (!(r.taken > 0) && !r.cash_desks_used) return { level: 'closed', reasons: [{ lv: 'closed', t: 'Closed: nothing taken at the tills' }] };
    const m = lmtd(s.name, d);
    // The first open days of a month say little about the month (one big order swings the pace), so the
    // pace only turns red from the 6th open day on; before that a big gap is a "Check", not "Act now".
    const early = !(m.elapsed >= 6);
    if (m.pace != null && m.pace < (early ? 0.75 : 0.9)) reasons.push({ lv: early ? 'warn' : 'bad', t: 'Month to date ' + pct(1 - m.pace, 0) + ' behind the target pace' + (early ? ' (first days of the month)' : ''), h: 'mtd' });
    else if (!early && m.pace != null && m.pace < 0.95) reasons.push({ lv: 'warn', t: 'Month to date ' + pct(1 - m.pace, 0) + ' behind the target pace', h: 'mtd' });
    const chk = state.live.cash[cashKey(s.id, d)], unclosed = Math.max(0, (+r.cash_desks_used || 0) - (+r.cash_desks_closed || 0));
    if (!chk && unclosed) reasons.push({ lv: 'bad', t: plural(unclosed, 'cash desk') + ' not closed, not checked', h: 'cash' });
    if (!chk && r.closes_off_float > 0) reasons.push({ lv: 'warn', t: plural(r.closes_off_float, 'close') + ' off the usual float (' + sgnEur(+r.off_float_amount || 0) + '), not checked', h: 'cash' });
    const sw = lsw(s.name, d);
    if (r.taken > 0 && sw && sw.taken && r.taken / sw.taken - 1 <= -0.3) reasons.push({ lv: 'warn', t: 'Taken ' + pct(1 - r.taken / sw.taken, 0) + ' below the ' + WDL[U.dow(d)] + ' average', h: 'lkpis' });
    if (r.exams_cancelled >= 3 && r.exams_cancelled >= 0.25 * (+r.exams_booked || 0)) reasons.push({ lv: 'warn', t: plural(r.exams_cancelled, 'eye exam cancellation') + ' (' + num(r.exams_booked) + ' booked)', h: 'lkpis' });
    const old = lcompl(s.name).filter((c) => c.age_days > 30).length;
    if (old >= 5) reasons.push({ lv: 'warn', t: plural(old, 'complaint') + ' open over 30 days', h: 'complaints' });
    const level = reasons.some((x) => x.lv === 'bad') ? 'bad' : reasons.length ? 'warn' : 'good';
    reasons.sort((a, b) => (a.lv === b.lv ? 0 : a.lv === 'bad' ? -1 : 1));
    return { level: level, reasons: reasons };
  }
  function lstoreRow(s, d) {
    const r = lrow(s.name, d), sw = lsw(s.name, d), m = lmtd(s.name, d), meta = lsm(s.name), open = !!(r && r.taken > 0);
    return { id: s.id, s: s, r: r, open: open, sw: sw, m: m, st: lstatus(s, d), taken: open ? +r.taken : null, vsAvg: open && sw && sw.taken ? r.taken / sw.taken - 1 : null,
      cardShare: open ? r.card / r.taken : null, orders: r ? +r.orders_paid : null, booked: r ? +r.exams_booked : null, cancelled: r ? +r.exams_cancelled : null,
      online: r ? +r.new_bookings_online : null, compl: lcompl(s.name).length, rating: meta && meta.rating != null ? +meta.rating : null, rc: meta && meta.review_count != null ? +meta.review_count : null };
  }

  // ── Live: all stores ─────────────────────────────────────────────────────
  const LCOLS = [
    ['status', 'Status', (r) => LVORD[r.st.level] * 10 - r.st.reasons.length],
    ['name', 'Store', (r) => r.s.name],
    ['taken', 'Taken', (r) => r.taken],
    ['vsAvg', 'vs weekday avg', (r) => r.vsAvg],
    ['mtd', 'Month to date', (r) => r.m.sum],
    ['pctT', '% of target', (r) => r.m.pct],
    ['pace', 'Pace', (r) => r.m.pace],
    ['need', 'Needed per day', (r) => (r.m.remaining ? r.m.need : null)],
    ['card', 'Card / cash', (r) => r.cardShare],
    ['orders', 'Orders paid', (r) => r.orders],
    ['exams', 'Exams booked', (r) => r.booked],
    ['online', 'New online bookings', (r) => r.online],
    ['compl', 'Open complaints', (r) => r.compl],
    ['rating', 'Rating', (r) => r.rating]
  ];
  function lallRows() {
    const rows = LSTORES.filter((s) => !ui.country || s.country === ui.country).map((s) => lstoreRow(s, cur));
    const c = LCOLS.find((x) => x[0] === ui.lsort.k) || LCOLS[0], dir = ui.lsort.dir;
    rows.sort((a, b) => {
      const va = c[2](a), vb = c[2](b);
      if (va == null && vb == null) return a.s.name.localeCompare(b.s.name);
      if (va == null) return 1; if (vb == null) return -1;
      return (typeof va === 'string' ? va.localeCompare(vb) : va - vb) * dir || a.s.name.localeCompare(b.s.name);
    });
    return rows;
  }
  ACT.lsort = (d) => { const s = ui.lsort; if (s.k === d.k) s.dir = -s.dir; else { s.k = d.k; s.dir = d.k === 'name' || d.k === 'status' ? 1 : -1; } saveUi(); rerender(); };
  function lthSort(k, label, num_) {
    const s = ui.lsort, on = s.k === k;
    return '<th scope="col"' + (num_ ? ' class="num"' : '') + (on ? ' aria-sort="' + (s.dir > 0 ? 'ascending' : 'descending') + '"' : '') + '><button type="button" data-act="lsort" data-k="' + k + '" data-fid="lth-' + k + '">' + esc(label) + (on ? (s.dir > 0 ? ' ↑' : ' ↓') : '') + '</button></th>';
  }
  const TAKEN_NOTE = '“Taken” is money taken at the tills (card + cash, including deposits paid when glasses are ordered), not invoiced sales. Targets come from the monthly sales plan.';
  function pageLAll() {
    pageTitle = 'All stores';
    const actions = '<div class="seg" role="group" aria-label="Country">' + [['', 'All'], ['SI', 'Slovenia'], ['HR', 'Croatia']].map((c) => '<button type="button" data-act="country" data-v="' + c[0] + '" data-fid="cty-' + c[0] + '" aria-pressed="' + (ui.country === c[0]) + '">' + c[1] + '</button>').join('') + '</div>' +
      '<div class="seg" role="group" aria-label="Layout">' + [['tiles', 'Tiles'], ['table', 'Table']].map((c) => '<button type="button" data-act="allView" data-v="' + c[0] + '" data-fid="av-' + c[0] + '" aria-pressed="' + (ui.allView === c[0]) + '">' + c[1] + '</button>').join('') + '</div>' +
      '<button type="button" class="btn" data-act="lcsvAll" data-fid="lcsvAll">' + ic('exp') + 'Export CSV</button>';
    const head = lhead('Morning overview · ' + esc(fday(cur)), 'All stores', 'Money taken at the tills vs target, cash desks, eye exam bookings and open complaints for the ' + (ui.country ? (ui.country === 'SI' ? 'Slovenian' : 'Croatian') + ' stores' : '8 optics stores in Slovenia and Croatia') + '.', actions);
    lallCsv = null;
    const meta = lget(METAURL);
    let w = lwait([meta], 'live store data'); if (w) return head + w;
    const days = lget(lboardUrl(cur)), comp = lget(COMPURL);
    w = lwait([days, comp], 'the stores for ' + fday(cur)); if (w) return head + w;
    const rows = lallRows(), open = rows.filter((r) => r.open);
    let taken = 0, swT = 0, card = 0, cash = 0, orders = 0, dep = 0, fin = 0, booked = 0, canc = 0, onl = 0, staffB = 0, mSum = 0, mExp = 0, mT = 0, compl = 0, compOld = 0;
    rows.forEach((x) => {
      mSum += x.m.sum; if (x.m.expected != null) mExp += x.m.expected; if (x.m.target != null) mT += x.m.target;
      compl += x.compl; compOld += lcompl(x.s.name).filter((c) => c.age_days > 30).length;
      const r = x.r; if (!r) return;
      booked += +r.exams_booked || 0; canc += +r.exams_cancelled || 0; onl += +r.new_bookings_online || 0; staffB += +r.new_bookings_staff || 0; orders += +r.orders_paid || 0;
      if (!x.open) return;
      taken += +r.taken; card += +r.card || 0; cash += +r.cash || 0; dep += +r.deposits || 0; fin += +r.final_payments || 0;
      if (x.sw) swT += x.sw.taken;
    });
    const att = rows.filter((r) => r.st.level === 'bad' || r.st.level === 'warn').length, actNow = rows.filter((r) => r.st.level === 'bad').length;
    let h = head;
    if (!open.length) h += '<div class="notice">' + ic('cal') + '<span>No money was taken at the ' + (ui.country ? 'selected ' : '') + 'stores on ' + esc(fday(cur)) + '. Month-to-date figures are still shown.</span></div>';
    const vsW = swT ? taken / swT - 1 : null;
    h += '<div class="kpis">' +
      kpi('Taken at the tills · ' + fdayShort(cur), open.length ? eur0(taken) : '—', vsW == null ? '' : sgnPct(vsW) + ' vs ' + WD[U.dow(cur)] + ' average', deltaCls(vsW)) +
      kpi('Taken month to date vs target', mT ? pct(mSum / mT, 0) + '<small>of target</small>' : '—', eur0(mSum) + (mT ? ' of ' + eur0(mT) + ' · pace ' + pct(mExp ? mSum / mExp : null, 0) : ' · no target'), mExp ? deltaCls(mSum / mExp - 1) : '') +
      kpi('Card / cash', taken ? pct(card / taken, 0) + '<small>card</small>' : '—', taken ? eur0(card) + ' card · ' + eur0(cash) + ' cash' : '') +
      kpi('Orders paid', num(orders), open.length ? 'deposits ' + eur0(dep) + ' · final ' + eur0(fin) : '') +
      kpi('Eye exams booked', num(booked), num(canc) + ' cancelled', '') +
      kpi('New bookings', num(onl + staffB), num(onl) + ' online · ' + num(staffB) + ' by staff', '') +
      kpi('Open complaints', num(compl), num(compOld) + ' open over 30 days', '') +
      kpi('Need attention', String(att) + '<small>of ' + rows.length + '</small>', actNow ? actNow + ' to act on now' : 'nothing urgent', actNow ? 'bad' : '') +
      '</div>';
    if (ui.allView === 'tiles') h += '<div class="tiles">' + rows.map(ltileHtml).join('') + '</div>';
    else h += ltableAll(rows);
    h += '<p class="hint" style="margin-top:14px">' + esc(TAKEN_NOTE) + ' Status: <b>Act now</b> = month-to-date pace below 90 % of the target (from the 6th open day of the month) or a cash desk not closed (and not checked). <b>Check</b> = pace below 95 % (in the first 5 open days: below 75 %), a close off the usual float, taken 30 %+ below the weekday average, 3+ eye exam cancellations (a quarter of the bookings or more), or 5+ complaints open over 30 days. Complaints are as of the latest refresh.</p>';
    lallCsv = rows;
    return h;
  }
  function ltileHtml(r) {
    const lv = r.st.level, closed = !r.open;
    return '<a class="tile' + (closed ? ' closed' : '') + '" href="#/store/' + r.id + '" data-fid="tile-' + r.id + '"><div class="top"><h3>' + esc(r.s.name) + '<small>' + r.s.country + ' · taken at the tills</small></h3>' + stBadge(lv) + '</div>' +
      '<div><span class="big">' + (closed ? 'Closed' : eur0(r.taken)) + '</span>' + (closed ? '' : ' <span class="' + deltaCls(r.vsAvg) + '" style="font-size:13px">' + sgnPct(r.vsAvg) + ' vs ' + WD[U.dow(cur)] + ' avg</span>') + '</div>' +
      '<div>' + paceBar(r.m, true) + '<div class="row"><span>MTD ' + eur0(r.m.sum) + ' · ' + (r.m.target ? pct(r.m.pct, 0) + ' of target' : 'no target') + '</span><span>pace ' + pct(r.m.pace, 0) + '</span></div></div>' +
      (r.st.reasons.length && lv !== 'closed' ? '<ul>' + r.st.reasons.slice(0, 3).map((x) => '<li><i class="dot-l ' + x.lv + '" aria-hidden="true"></i>' + esc(x.t) + '</li>').join('') + (r.st.reasons.length > 3 ? '<li class="muted">+' + (r.st.reasons.length - 3) + ' more</li>' : '') + '</ul>' : lv === 'closed' ? '<ul><li>' + esc(r.st.reasons[0].t) + '</li></ul>' : '<ul><li><i class="dot-l good" aria-hidden="true"></i>Nothing needs attention</li></ul>') +
      '<div class="row"><span>' + (r.rating != null ? '★ ' + NF1.format(r.rating) + ' (' + num(r.rc) + ')' : '★ —') + '</span><span>Orders ' + (r.orders == null ? '—' : num(r.orders)) + '</span><span>Exams ' + (r.booked == null ? '—' : num(r.booked)) + '</span><span>Complaints ' + num(r.compl) + '</span></div></a>';
  }
  function ltableAll(rows) {
    let h = '<div class="card"><div class="tw"><table class="t"><caption class="sr">Live store ranking for ' + esc(fday(cur)) + '. Select a column header to sort.</caption><thead><tr>' +
      LCOLS.map((c) => lthSort(c[0], c[1], c[0] !== 'status' && c[0] !== 'name')).join('') + '</tr></thead><tbody>';
    rows.forEach((r) => {
      const x = r.r;
      h += '<tr class="click" data-href="#/store/' + r.id + '"><td class="st-cell">' + stBadge(r.st.level) + '</td>' +
        '<td class="name"><a href="#/store/' + r.id + '" data-fid="row-' + r.id + '">' + esc(r.s.name) + '</a><small>' + r.s.country + ' · ' + esc(r.st.reasons[0] && r.st.level !== 'good' ? r.st.reasons[0].t : r.st.level === 'good' ? 'nothing needs attention' : '') + '</small></td>' +
        '<td class="num">' + (r.taken == null ? '<span class="muted">closed</span>' : eur0(r.taken)) + '</td>' +
        '<td class="num ' + deltaCls(r.vsAvg) + '">' + sgnPct(r.vsAvg) + '</td>' +
        '<td class="num">' + eur0(r.m.sum) + '<small>' + (r.m.target != null ? 'of ' + eur0(r.m.target) : 'no target') + '</small></td><td class="num" style="min-width:110px">' + pct(r.m.pct, 0) + paceBar(r.m, true) + '</td>' +
        '<td class="num ' + (r.m.pace == null ? '' : r.m.pace < 0.95 ? 'neg' : 'pos') + '">' + pct(r.m.pace, 0) + '</td><td class="num">' + (r.m.remaining ? eur0(r.m.need) : '—') + '<small>' + (r.m.remaining == null ? 'no plan' : r.m.remaining + ' working days left') + '</small></td>' +
        '<td class="num">' + (r.cardShare == null ? '—' : pct(r.cardShare, 0) + ' card') + '<small>' + (x && r.open ? eur0(x.cash) + ' cash' : '') + '</small></td>' +
        '<td class="num">' + (r.orders == null ? '—' : num(r.orders)) + '</td>' +
        '<td class="num">' + (r.booked == null ? '—' : num(r.booked)) + '<small>' + (r.cancelled ? num(r.cancelled) + ' cancelled' : '') + '</small></td>' +
        '<td class="num">' + (r.online == null ? '—' : num(r.online)) + '</td>' +
        '<td class="num">' + num(r.compl) + '</td>' +
        '<td class="num">' + (r.rating == null ? '—' : '★ ' + NF1.format(r.rating) + '<small>' + num(r.rc) + ' reviews</small>') + '</td></tr>';
    });
    return h + '</tbody></table></div></div>';
  }
  ACT.lcsvAll = () => {
    if (!lallCsv) { toast('The live data is still loading.'); return; }
    downloadCsv('store-ranking-live', ['Date', 'Store', 'Country', 'Status', 'Attention', 'Taken at the tills EUR', 'Same-weekday avg EUR (6 weeks)', 'vs weekday avg %', 'MTD taken EUR', 'Target EUR', '% of target', 'Pace %', 'Expected by now EUR', 'Needed per remaining working day EUR', 'Working days left', 'Card EUR', 'Cash EUR', 'Card share %', 'Orders paid', 'Deposits EUR', 'Final payments EUR', 'Refunds EUR', 'Cash desks used', 'Cash desks closed', 'Closes off float', 'Exams booked', 'Exams booked online', 'Exams cancelled', 'New bookings online', 'New bookings staff', 'Open complaints', 'Rating', 'Reviews'],
      lallCsv.map((r) => { const x = r.r || {}; return [cur, r.s.name, r.s.country, ST[r.st.level][0], r.st.reasons.map((y) => y.t).join('; '), csvNum(r.taken), csvNum(r.sw ? r.sw.taken : null), csvNum(r.vsAvg == null ? null : r.vsAvg * 100, 1),
        csvNum(r.m.sum), csvNum(r.m.target), csvNum(r.m.pct == null ? null : r.m.pct * 100, 1), csvNum(r.m.pace == null ? null : r.m.pace * 100, 1), csvNum(r.m.expected), csvNum(r.m.remaining ? r.m.need : null), r.m.remaining == null ? '' : r.m.remaining,
        csvNum(x.card), csvNum(x.cash), csvNum(r.cardShare == null ? null : r.cardShare * 100, 1), x.orders_paid, csvNum(x.deposits), csvNum(x.final_payments), csvNum(x.refunds), x.cash_desks_used, x.cash_desks_closed, x.closes_off_float,
        x.exams_booked, x.exams_booked_online, x.exams_cancelled, x.new_bookings_online, x.new_bookings_staff, r.compl, csvNum(r.rating, 2), r.rc == null ? '' : r.rc]; }));
  };

  // ── Live: store board ────────────────────────────────────────────────────
  function lnc(id, order, eyebrow, title, text) {
    return card({ id: id, order: order, eyebrow: eyebrow, title: title, right: '<span class="badge plain">Not connected yet</span>', body: '<div class="nc"><p>' + esc(text) + '</p></div>' });
  }
  function pageLStore() {
    const id = route.id, s = LSB[id], va = VA();
    pageTitle = s.name;
    const thr = lthrough();
    let h = '<div class="head"><div>' + (va === 'HO' || va !== id ? '<a class="crumb" href="#/">' + ic('back') + 'All stores</a>' : '<span class="eyebrow">My store · ' + esc(s.country) + '</span>') +
      '<h1 tabindex="-1">' + esc(s.name) + '<span class="dot">.</span></h1><p class="sub">' + (s.country === 'SI' ? 'Slovenia' : 'Croatia') + ' · optics store · live' + (thr ? ' data through ' + esc(fdate(thr)) : '') + '</p></div>' +
      '<div class="head-actions"><label class="sr" for="storeJump">Open another store</label><select class="select" id="storeJump" data-chg="storeJump">' + LSTORES.map((x) => '<option value="' + x.id + '"' + (x.id === id ? ' selected' : '') + '>' + esc(x.name) + ' (' + x.country + ')</option>').join('') + '</select>' +
      '<button type="button" class="btn no-print" data-act="print">Print</button></div></div>';
    const meta = lget(METAURL);
    let w = lwait([meta], 'live store data'); if (w) return h + w;
    const days = lget(lboardUrl(cur)), comp = lget(COMPURL); lget(AHEADURL);
    w = lwait([days, comp], s.name + ' for ' + fday(cur)); if (w) return h + w;
    const r = lrow(s.name, cur), st = lstatus(s, cur);
    if (st.level === 'closed') h += '<div class="notice">' + ic('cal') + '<span>' + esc(st.reasons[0].t) + ' on ' + esc(fday(cur)) + '. There is no money or cash desk to check for that day; bookings and complaints below are current.</span></div>';
    else if (st.level === 'good') h += '<div class="notice ok">' + ic('check') + '<span>' + stBadge('good') + ' Nothing needs attention from ' + esc(fdayShort(cur)) + '. Have a good day.</span></div>';
    else h += '<div class="card pad" style="margin-bottom:14px"><div style="display:flex;gap:10px;align-items:center;margin-bottom:10px">' + stBadge(st.level) + '<b style="font-weight:500">' + st.reasons.length + ' thing' + (st.reasons.length === 1 ? '' : 's') + ' to look at this morning</b></div><ul class="reasons">' +
      st.reasons.map((x) => '<li><i class="dot-l ' + x.lv + '" aria-hidden="true"></i><span>' + (x.h ? '<a href="#' + x.h + '" data-act="jump" data-to="' + x.h + '">' + esc(x.t) + '</a>' : esc(x.t)) + (x.lv === 'bad' ? ' <span class="sr">(act now)</span>' : '') + '</span></li>').join('') + '</ul></div>';
    h += '<h2 class="subhead" style="margin:4px 0 10px">' + (cur === YDAY ? 'Yesterday · ' : '') + esc(fday(cur)) + ' · compared with the average of the open ' + WDL[U.dow(cur)] + 's in the previous 6 weeks</h2>';
    if (r && (r.taken > 0 || r.cash_desks_used)) {
      const sw = lsw(s.name, cur) || {}, dv = (a, b) => (b ? a / b - 1 : null);
      const vs = (k, f) => (sw[k] != null && sw.n ? sgnPct(dv(r[k], sw[k])) + ' vs ' + f(sw[k]) : 'no history');
      h += '<div class="kpis" id="lkpis" tabindex="-1">' +
        kpi('Taken at the tills', eur0(r.taken), vs('taken', eur0), deltaCls(dv(r.taken, sw.taken))) +
        kpi('Card / cash', r.taken ? pct(r.card / r.taken, 0) + '<small>card</small>' : '—', eur0(r.card) + ' card (' + num(r.card_payments) + ') · ' + eur0(r.cash) + ' cash (' + num(r.cash_payments) + ')', '') +
        kpi('Orders paid', num(r.orders_paid), vs('orders_paid', (v) => NF1.format(v)), deltaCls(dv(r.orders_paid, sw.orders_paid))) +
        kpi('Deposits / final payments', eur0(r.deposits), 'final ' + eur0(r.final_payments) + (r.refunds ? ' · refunds ' + eur0(r.refunds) : ''), '') +
        kpi('Eye exams booked', num(r.exams_booked) + '<small>' + num(r.exams_booked_online) + ' online</small>', num(r.exams_cancelled) + ' cancelled · avg ' + (sw.n ? NF1.format(sw.exams_booked) + ' booked' : '—'), r.exams_cancelled >= 3 ? 'neg' : '') +
        kpi('New bookings made', num(r.new_bookings_online + r.new_bookings_staff), num(r.new_bookings_online) + ' online · ' + num(r.new_bookings_staff) + ' by staff', '') +
        kpi('Complaints', num(r.complaints_received) + '<small>received</small>', num(r.complaints_closed) + ' closed that day', '') +
        '</div>';
    } else h += '<div class="empty dashed" id="lkpis" tabindex="-1" style="margin-bottom:14px">' + (r ? 'Closed — nothing taken at the tills on this day.' : 'No till data for this day yet.') + '</div>';
    h += '<p class="hint" style="margin:-4px 0 14px">' + esc(TAKEN_NOTE) + ' Eye exams done are not in the live data, only booked and cancelled.</p>';
    const L = [lcardMtd(s), lcardCash(s), lcardAhead(s), lcardComplaints(s), lnc('pickups', 9, 'Glasses in progress', 'Work orders and pickup list', 'Glasses work orders, lab delays and the pickup call list are not connected to live data yet.'), lnc('mix', 10, 'Sales mix', 'What sold', 'Product mix (frames, lenses, contact lenses, sunglasses, services) is not in the live data yet.')];
    const R = [lnc('staffToday', 3, 'Today', 'Staff plan vs clock-ins', 'Staff hours, attendance and live clock-ins come from Codeks in a later step.'), cardTasks(id), cardNotes(id), lcardRating(s)];
    h += '<div class="board"><div class="col">' + L.join('') + '</div><div class="col">' + R.join('') + '</div></div>';
    return h;
  }
  function lcardMtd(s) {
    const m = lmtd(s.name, cur);
    const eb = monthName(m.ym) + ' ' + m.ym.slice(0, 4);
    if (m.target == null) return card({ id: 'mtd', order: 1, eyebrow: eb, title: 'Taken at the tills vs target', body: '<div class="rating-big"><b>' + eur0(m.sum) + '</b><span class="muted">taken so far · ' + plural(m.elapsed, 'open day') + '</span></div><div class="empty dashed" style="margin-top:12px">No target for this month in the sales plan.</div>' });
    const behind = m.expected != null ? m.sum - m.expected : null;
    const body = '<div class="rating-big"><b>' + eur0(m.sum) + '</b><span class="muted">of ' + eur0(m.target) + ' target · ' + pct(m.pct, 0) + '</span></div>' + paceBar(m) +
      '<div class="pace-legend"><span>1. ' + +m.ym.slice(5) + '.</span><span>| expected after ' + plural(m.elapsed, 'open day') + ': ' + eur0(m.expected) + '</span><span>' + num(m.total) + ' working days</span></div>' +
      '<table class="kv" style="margin-top:12px"><tbody>' +
      '<tr><th scope="row">Pace</th><td class="' + (m.pace == null ? '' : m.pace < 0.95 ? 'neg' : 'pos') + '">' + pct(m.pace, 0) + (behind != null ? ' · ' + sgnEur(behind).replace(/,\d\d €/, ' €') + ' vs expected' : '') + '</td></tr>' +
      '<tr><th scope="row">Working days</th><td>' + num(m.elapsed) + ' open so far · ' + num(m.remaining) + ' left of ' + num(m.total) + '</td></tr>' +
      '<tr><th scope="row">Target per working day</th><td>' + eur0(m.tday) + '</td></tr>' +
      '<tr><th scope="row">Daily average so far</th><td>' + eur0(m.runRate) + '</td></tr>' +
      '<tr class="tot"><th scope="row">Needed per remaining working day</th><td>' + (m.remaining ? eur0(m.need) : '—') + '</td></tr>' +
      '<tr><th scope="row">Projected month at this pace</th><td>' + eur0(m.projected) + '</td></tr>' +
      '</tbody></table>';
    return card({ id: 'mtd', order: 1, eyebrow: eb + ' · to ' + fdm(cur), title: 'Taken at the tills vs target', body: body,
      foot: 'Expected = target per working day × open days so far (days with money taken). Needed = what is left of the target ÷ working days left in the plan.' + (m.complete ? '' : ' Some days of this month have no till data yet.') });
  }
  function lcardCash(s) {
    const r = lrow(s.name, cur), eb = 'Cash desks · ' + fdayShort(cur);
    if (!r || (!(r.taken > 0) && !r.cash_desks_used)) return card({ id: 'cash', order: 2, eyebrow: eb, title: 'Cash check', body: '<div class="empty dashed">No till activity: nothing to check.</div>' });
    const chk = state.live.cash[cashKey(s.id, cur)], used = +r.cash_desks_used || 0, closed = +r.cash_desks_closed || 0, unclosed = Math.max(0, used - closed), off = +r.closes_off_float || 0;
    const lv = unclosed ? ['b-bad', 'Desk not closed'] : off ? ['b-clay', 'Close off float'] : ['b-good', 'All closed'];
    let body = '<table class="kv"><caption class="sr">Cash desks used and closed</caption><tbody>' +
      '<tr><th scope="row">Cash desks used</th><td>' + num(used) + '</td></tr>' +
      '<tr><th scope="row">Cash desks closed</th><td class="' + (unclosed ? 'neg' : '') + '">' + num(closed) + (unclosed ? ' · ' + num(unclosed) + ' not closed' : '') + '</td></tr>' +
      '<tr><th scope="row">Closes off the usual float</th><td class="' + (off ? 'neg' : '') + '">' + num(off) + '</td></tr>' +
      (off ? '<tr><th scope="row">Off-float amount</th><td class="neg">' + sgnEur(+r.off_float_amount || 0) + '</td></tr>' : '') + '</tbody></table>' +
      '<p class="subhead">Taken by payment type</p><table class="kv"><tbody>' +
      '<tr><th scope="row">Cash</th><td>' + eur(r.cash) + ' <span class="muted">· ' + plural(+r.cash_payments || 0, 'payment') + '</span></td></tr>' +
      '<tr><th scope="row">Card (all terminals)</th><td>' + eur(r.card) + ' <span class="muted">· ' + plural(+r.card_payments || 0, 'payment') + '</span></td></tr>' +
      (r.card_ext_terminal ? '<tr><th scope="row">of which external terminal</th><td>' + eur(r.card_ext_terminal) + '</td></tr>' : '') +
      (r.card_kiosk ? '<tr><th scope="row">of which kiosk</th><td>' + eur(r.card_kiosk) + '</td></tr>' : '') +
      '<tr class="tot"><th scope="row">Taken at the tills</th><td>' + eur(r.taken) + '</td></tr></tbody></table>';
    if (chk) body += '<div class="checked"><div><b style="font-weight:500">' + ic('check') + ' Checked by ' + esc(chk.by) + ' · ' + esc(fts(chk.at)) + '</b>' + (chk.note ? '<p>' + esc(chk.note) + '</p>' : '') + '</div><button type="button" class="btn sm" data-act="lcashUndo" data-fid="cashUndo">' + ic('undo') + 'Reopen</button></div>';
    else body += '<div style="margin-top:14px;display:flex;flex-wrap:wrap;gap:8px;align-items:center"><button type="button" class="btn pri" data-act="lcashCheck" data-fid="cashCheck">' + ic('check') + 'Mark checked…</button><span class="hint">' + (unclosed || off ? 'Add a short explanation.' : 'Confirms the desks were closed as usual.') + '</span></div>';
    return card({ id: 'cash', order: 2, eyebrow: eb, title: 'Cash check', right: '<span class="badge ' + lv[0] + '">' + lv[1] + '</span>', body: body,
      foot: 'From the store-board money-box export. Counted cash per desk is not in the live data; “off float” means a close did not leave the desk at its usual float.' });
  }
  ACT.lcashCheck = () => {
    if (!LIVE()) return;
    const s = LSB[route.id], r = s && lrow(s.name, cur); if (!r) return;
    const unclosed = Math.max(0, (+r.cash_desks_used || 0) - (+r.cash_desks_closed || 0)), off = +r.closes_off_float || 0, needNote = !!(unclosed || off), day0 = cur;
    modal({
      title: 'Cash check · ' + s.name, submitLabel: 'Mark checked',
      body: '<p>' + esc(fday(day0)) + ': ' + plural(+r.cash_desks_used || 0, 'cash desk') + ' used, ' + num(r.cash_desks_closed) + ' closed' + (off ? '; ' + plural(off, 'close') + ' off the usual float (' + sgnEur(+r.off_float_amount || 0) + ')' : '') + '.</p>' +
        '<div class="field"><label for="cashNote">Note' + (needNote ? ' (required)' : ' (optional)') + '</label><textarea class="in" id="cashNote" name="note" maxlength="500" placeholder="' + (needNote ? 'e.g. Desk 2 closed the next morning; float topped up' : 'e.g. All desks closed as usual') + '"></textarea></div>' +
        '<p class="hint">Saved in this browser and in your private cloud copy (approved accounts only). Only the check mark and your note are kept, never the amounts. Nothing is sent to accounting.</p>',
      onSubmit: (f) => {
        if (!LIVE()) return 'The page switched to demo data. Close this dialog.';
        const note = f.elements.note.value.trim();
        if (needNote && note.length < 3) return 'Please write a short explanation.';
        state.live.cash[cashKey(s.id, day0)] = { at: nowTs(), note: note, by: viewLabel() };
        save(); rerender(); toast('Cash for ' + fdayShort(day0) + ' marked as checked');
        setTimeout(() => { const b = document.querySelector('[data-fid="cashUndo"]'); if (b) b.focus(); }, 0);
        return null;
      }
    });
  };
  ACT.lcashUndo = () => { if (!LIVE()) return; delete state.live.cash[cashKey(route.id, cur)]; save(); rerender(); toast('Cash check reopened'); };

  function lcardAhead(s) {
    const c = LC[AHEADURL] || lget(AHEADURL), eb = 'Eye exams · today and the next 21 days';
    const w = lwait([c], 'exam bookings'); if (w) return '<section class="card" id="ahead" tabindex="-1" aria-label="Exam bookings">' + w + '</section>';
    const by = {}; (c.data.days || []).forEach((x) => { if (x.store === s.name) by[x.date] = x; });
    const capOf = (d) => { const mo = lmonth(s.name, d.slice(0, 7)) || lmonth(s.name, cur.slice(0, 7)); return mo && mo.exam_capacity_day ? +mo.exam_capacity_day : null; };
    let rows = '', wk = 0, wkCan = 0, all = 0;
    for (let i = 0; i <= 21; i++) {
      const d = U.addDays(TODAY, i), x = by[d] || { exams_booked: 0, exams_booked_online: 0, exams_cancelled: 0 }, cap = capOf(d), b = +x.exams_booked || 0, share = cap ? b / cap : null;
      if (i < 7) { wk += b; wkCan += +x.exams_cancelled || 0; } all += b;
      rows += '<tr' + (i === 0 ? ' class="today"' : '') + '><td class="nw">' + esc(fdayShort(d)) + (i === 0 ? ' · today' : '') + '</td><td class="num">' + (b ? num(b) : '<span class="muted">—</span>') + '</td><td class="num">' + (x.exams_booked_online ? num(x.exams_booked_online) : '<span class="muted">—</span>') + '</td><td class="num">' + (x.exams_cancelled ? num(x.exams_cancelled) : '<span class="muted">—</span>') + '</td>' +
        '<td class="num">' + (cap && b ? pct(share, 0) + '<div class="bar' + (share > 1 ? ' warn' : '') + '" role="img" aria-label="' + esc(num(b) + ' of ' + num(cap) + ' exam slots booked') + '"><i style="width:' + Math.min(100, share * 100).toFixed(1) + '%"></i></div>' : '—') + '</td></tr>';
    }
    const t = by[TODAY] || {}, capT = capOf(TODAY);
    const body = '<div class="minirow"><span><b>' + num(+t.exams_booked || 0) + '</b> booked today' + (capT ? ' of ' + num(capT) + ' slots' : '') + '</span><span><b>' + num(wk) + '</b> in the next 7 days</span><span><b>' + num(wkCan) + '</b> cancelled in those 7 days</span><span><b>' + num(all) + '</b> in 22 days</span></div>' +
      '<div class="tw" style="margin-top:10px"><table class="t compact ahead"><caption class="sr">Eye exam bookings per day for ' + esc(s.name) + '</caption><thead><tr><th scope="col">Day</th><th scope="col" class="num">Booked</th><th scope="col" class="num">Online</th><th scope="col" class="num">Cancelled</th><th scope="col" class="num">vs capacity</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    return card({ id: 'ahead', order: 4, eyebrow: eb, title: 'Exam bookings ahead', body: body, foot: 'Capacity = exam slots per day in the monthly plan' + (capT ? ' (' + num(capT) + ' this month)' : '') + '. Days with no bookings show a dash (the store may be closed). Exams done are not in the live data.' });
  }
  const AGE_B = [['0–7 days', 0, 7], ['8–14', 8, 14], ['15–30', 15, 30], ['31–90', 31, 90], ['over 90', 91, 1e9]];
  function lcountBy(list, k) { const o = {}; list.forEach((x) => { const v = x[k] == null || x[k] === '' ? 'Not set' : String(x[k]); o[v] = (o[v] || 0) + 1; }); return Object.keys(o).map((v) => [v, o[v]]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])); }
  function lcardComplaints(s) {
    const list = lcompl(s.name);
    if (!list.length) return card({ id: 'complaints', order: 7, eyebrow: 'Complaints and returns · now', title: 'Open complaints (0)', body: '<div class="empty dashed">No open complaints.</div>' });
    const bk = AGE_B.map((b) => [b[0], list.filter((x) => x.age_days >= b[1] && x.age_days <= b[2]).length]);
    const tbl = (title, rows) => '<div><h3>' + esc(title) + '</h3><table class="kv"><tbody>' + rows.slice(0, 8).map((x) => '<tr><th scope="row">' + esc(x[0]) + '</th><td>' + num(x[1]) + '</td></tr>').join('') + (rows.length > 8 ? '<tr><th scope="row" class="muted">' + (rows.length - 8) + ' more</th><td>' + num(rows.slice(8).reduce((a, x) => a + x[1], 0)) + '</td></tr>' : '') + '</tbody></table></div>';
    const one = (x) => '<li><div class="l"><span class="badge plain">' + esc(x.final_category || 'Uncategorised') + '</span> ' + (x.id_complaints != null && x.id_complaints !== '' ? '<b style="font-weight:500">Complaint ' + esc(x.id_complaints) + '</b>' : '<b style="font-weight:500">No complaint id</b>') + (x.order_id ? ' <span class="muted">· order ' + esc(x.order_id) + '</span>' : '') +
      '<small>' + esc([x.issue_type, x.item_type, x.status_new || x.status, x.assigned_department, x.reason].filter((v) => v != null && v !== '').join(' · ')) + '</small></div>' +
      '<div class="r"><span class="badge ' + (x.age_days > 30 ? 'b-clay' : 'plain') + '">' + plural(+x.age_days || 0, 'day') + ' open</span><small class="cell-sub">since ' + (x.date_received ? fdate(String(x.date_received).slice(0, 10)) : '—') + '</small></div></li>';
    const body = '<div class="minirow">' + bk.map((b) => '<span><b>' + num(b[1]) + '</b> ' + esc(b[0]) + '</span>').join('') + '</div>' +
      '<div class="cnt">' + tbl('By category', lcountBy(list, 'final_category')) + tbl('By issue type', lcountBy(list, 'issue_type')) + '</div>' +
      '<p class="subhead">Oldest first</p><ul class="list">' + list.slice(0, 15).map(one).join('') + '</ul>' +
      (list.length > 15 ? '<details class="tbl" style="margin-top:8px"><summary>Show ' + (list.length - 15) + ' more</summary><ul class="list">' + list.slice(15).map(one).join('') + '</ul></details>' : '');
    return card({ id: 'complaints', order: 7, eyebrow: 'Complaints and returns · now', title: 'Open complaints (' + num(list.length) + ')', body: body, foot: 'Open complaints as of the latest refresh. Customer names are not in the live data.' });
  }
  function lcardRating(s) {
    const m = lsm(s.name);
    const body = m && m.rating != null ? '<div class="rating-big"><b>★ ' + NF2.format(+m.rating) + '</b><span class="muted">' + plural(+m.review_count || 0, 'Google review') + (m.rating_observed_at ? ' · read ' + esc(fdate(String(m.rating_observed_at).slice(0, 10))) : '') + '</span></div>' : '<div class="empty dashed">No rating available for this store.</div>';
    return card({ id: 'reviews', order: 8, eyebrow: 'Google reviews', title: 'Rating', right: '<span class="badge plain">Texts not connected yet</span>', body: body + '<p class="hint" style="margin-top:8px">Only the rating and the number of reviews are available. Review texts and replies are not connected yet.</p>' });
  }

  // ── Live: staff (later) ──────────────────────────────────────────────────
  function pageLStaff() {
    pageTitle = 'Staff hours';
    return lhead('', 'Staff hours', '') + '<div class="card pad"><div class="nc"><p><b style="font-weight:500">Staff hours come later.</b> Planned shifts, clocked hours, attendance and live clock-ins will come from Codeks in a later step, so this page has no live data yet.</p><p>Switch to <button type="button" class="linkish" data-act="mode" data-v="demo">demo data</button> to see how the page will work.</p></div></div>';
  }

  // ── Live: trends ─────────────────────────────────────────────────────────
  const LMET = [
    { k: 'taken', name: 'Taken at the tills', parts: [['taken', 'Taken']], eur: true },
    { k: 'cardcash', name: 'Card vs cash', parts: [['card', 'Card'], ['cash', 'Cash']], eur: true },
    { k: 'orders', name: 'Orders paid', parts: [['orders_paid', 'Orders paid']] },
    { k: 'pay', name: 'Deposits vs final payments', parts: [['deposits', 'Deposits'], ['final_payments', 'Final payments']], eur: true },
    { k: 'exams', name: 'Exams booked / cancelled', parts: [['exams_booked', 'Booked'], ['exams_cancelled', 'Cancelled']] },
    { k: 'bookings', name: 'Online vs staff bookings', parts: [['new_bookings_online', 'Online'], ['new_bookings_staff', 'By staff']] },
    { k: 'complaints', name: 'Complaints received / closed', parts: [['complaints_received', 'Received'], ['complaints_closed', 'Closed']] }
  ];
  const nextYm = (ym) => { const y = +ym.slice(0, 4), m = +ym.slice(5, 7); return m === 12 ? (y + 1) + '-01' : y + '-' + U.pad(m + 1); };
  const monthShort = (ym) => new Date(+ym.slice(0, 4), +ym.slice(5, 7) - 1, 1).toLocaleString('en-GB', { month: 'short' }) + ' ' + ym.slice(2, 4);
  function lperiods(range, grain, end) {
    const out = [];
    if (grain === 'month') {
      const last = end.slice(0, 7);
      for (let ym = U.addDays(end, -(range - 1)).slice(0, 7); ym <= last; ym = nextYm(ym)) {
        const full = monthEnd(ym), e = ym === last ? end : full, ly = (+ym.slice(0, 4) - 1) + ym.slice(4);
        out.push({ start: ym + '-01', end: e, label: monthShort(ym), tip: monthName(ym) + ' ' + ym.slice(0, 4) + (e !== full ? ' (to ' + fdm(e) + ')' : ''), lyStart: ly + '-01', lyEnd: ly + '-' + U.pad(Math.min(+e.slice(8, 10), U.monthDays(ly))) });
      }
    } else if (grain === 'week') {
      for (let i = Math.floor(range / 7) - 1; i >= 0; i--) { const e = U.addDays(end, -7 * i), s = U.addDays(e, -6); out.push({ start: s, end: e, label: fdm(s), tip: fdm(s) + '–' + fdm(e), lyStart: U.addDays(s, -364), lyEnd: U.addDays(e, -364) }); }
    } else for (let i = range - 1; i >= 0; i--) { const d = U.addDays(end, -i); out.push({ start: d, end: d, label: fdm(d), tip: fday(d), lyStart: U.addDays(d, -364), lyEnd: U.addDays(d, -364) }); }
    return out;
  }
  // sums over [a, b] for some stores; null unless every store has a row for every day (= data exists)
  function lagg(names, a, b, keys) {
    const o = { open: false }; let complete = true;
    keys.forEach((k) => { o[k] = 0; });
    for (let d = a; d <= b && complete; d = U.addDays(d, 1)) names.forEach((n) => { const r = lrow(n, d); if (!r) { complete = false; return; } if (r.taken > 0) o.open = true; keys.forEach((k) => { o[k] += +r[k] || 0; }); });
    return complete ? o : null;
  }
  function pageLTrends() {
    pageTitle = 'Trends';
    const t = ui.ltr; t.stores = (t.stores || []).filter((id) => LSB[id]).slice(0, 3);
    if (!LMET.some((x) => x.k === t.metric)) t.metric = 'taken';
    if ([30, 90, 365].indexOf(t.range) < 0) t.range = 90;
    if (['day', 'week', 'month'].indexOf(t.grain) < 0) t.grain = 'week';
    const met = LMET.find((x) => x.k === t.metric), two = met.parts.length > 1;
    const groups = t.stores.length ? t.stores.map((id) => ({ name: LSB[id].name, names: [LSB[id].name] })) : [{ name: 'All stores', names: LSTORES.map((s) => s.name) }];
    let part = two ? t.part : met.parts[0][0];
    if (two && part !== 'both' && !met.parts.some((p) => p[0] === part)) part = 'both';
    if (two && part === 'both' && groups.length > 1) part = met.parts[0][0];
    ltrendCsv = null;
    const actions = '<button type="button" class="btn" data-act="lcsvTrend" data-fid="lcsvTrend">' + ic('exp') + 'Export CSV</button>';
    let h = lhead('Up to ' + esc(fday(cur)), 'Trends', 'Pick a measure, then compare up to 3 stores. With no store picked, the chart shows all 8 stores together. Dashed lines are the same period last year, where there is data for it.' + (met.eur ? ' ' + esc(TAKEN_NOTE) : ''), actions);
    h += '<div class="ctrls"><div class="grp"><span class="label">Measure</span><div class="seg" role="group" aria-label="Measure">' + LMET.map((x) => '<button type="button" data-act="ltrM" data-v="' + x.k + '" data-fid="ltrm-' + x.k + '" aria-pressed="' + (t.metric === x.k) + '">' + esc(x.name) + '</button>').join('') + '</div></div></div>' +
      '<div class="ctrls"><div class="grp"><span class="label">Period</span><div class="seg" role="group" aria-label="Period">' + [30, 90, 365].map((r) => '<button type="button" data-act="ltrR" data-v="' + r + '" data-fid="ltrr-' + r + '" aria-pressed="' + (t.range === r) + '">' + r + ' days</button>').join('') + '</div></div>' +
      '<div class="grp"><span class="label">Group by</span><div class="seg" role="group" aria-label="Group by">' + [['day', 'Day'], ['week', 'Week'], ['month', 'Month']].map((g) => '<button type="button" data-act="ltrG" data-v="' + g[0] + '" data-fid="ltrg-' + g[0] + '" aria-pressed="' + (t.grain === g[0]) + '">' + g[1] + '</button>').join('') + '</div></div>' +
      (two ? '<div class="grp"><span class="label">Show</span><div class="seg" role="group" aria-label="Show">' + [['both', 'Both']].concat(met.parts).map((p) => { const dis = p[0] === 'both' && groups.length > 1; return '<button type="button" data-act="ltrP" data-v="' + p[0] + '" data-fid="ltrp-' + p[0] + '" aria-pressed="' + (part === p[0]) + '"' + (dis ? ' disabled title="Both only works for one store or all stores together"' : '') + '>' + esc(p[1]) + '</button>'; }).join('') + '</div></div>' : '') + '</div>';
    h += '<div class="ctrls"><div class="grp" style="flex:1"><span class="label">Stores · ' + (t.stores.length ? t.stores.length + ' of 3 picked' : 'none picked = all stores') + '</span><div class="chips" style="margin-top:0">' +
      LSTORES.map((s) => { const i = t.stores.indexOf(s.id), on = i >= 0, full = !on && t.stores.length >= 3; return '<button type="button" class="chip" data-act="ltrS" data-v="' + s.id + '" data-fid="ltrs-' + s.id + '" aria-pressed="' + on + '"' + (full ? ' disabled title="Up to 3 stores"' : '') + '>' + (on ? '<i class="sw" style="background:' + SER[i] + '" aria-hidden="true"></i>' : '') + esc(s.name) + '</button>'; }).join('') +
      (t.stores.length ? '<button type="button" class="chip" data-act="ltrClear" data-fid="ltrClear">' + ic('x') + 'Clear</button>' : '') + '</div></div></div>';
    const meta = lget(METAURL);
    let w = lwait([meta], 'live store data'); if (w) return h + w;
    const end = cur, ps0 = lperiods(t.range, t.grain, end);
    let from = ps0.reduce((a, p) => (p.lyStart < a ? p.lyStart : a), ps0[0].start);
    if (U.diffDays(from, end) > 799) from = U.addDays(end, -799);
    const dc = lget(lurl('days', { from: from, to: end }));
    w = lwait([dc], 'the trend data'); if (w) return h + w;
    const keys = met.parts.map((p) => p[0]), allNames = [].concat.apply([], groups.map((g) => g.names));
    let ps = ps0;
    if (t.grain === 'day') ps = ps0.filter((p) => { const a = lagg(allNames, p.start, p.end, keys); return !a || a.open; });
    const A = groups.map((g) => ps.map((p) => ({ c: lagg(g.names, p.start, p.end, keys), l: lagg(g.names, p.lyStart, p.lyEnd, keys) })));
    const series = [];
    if (two && part === 'both') {
      met.parts.forEach((p, i) => series.push({ name: p[1], color: SER[i], values: A[0].map((a) => (a.c ? a.c[p[0]] : null)) }));
      met.parts.forEach((p, i) => series.push({ name: p[1] + ' · last year', color: SER[i], dash: true, values: A[0].map((a) => (a.l ? a.l[p[0]] : null)) }));
    } else {
      const pn = (met.parts.find((p) => p[0] === part) || met.parts[0])[1];
      groups.forEach((g, gi) => series.push({ name: g.name + (two ? ' · ' + pn : ''), color: SER[gi], values: A[gi].map((a) => (a.c ? a.c[part] : null)) }));
      groups.forEach((g, gi) => series.push({ name: g.name + (two ? ' · ' + pn : '') + ' · last year', color: SER[gi], dash: true, values: A[gi].map((a) => (a.l ? a.l[part] : null)) }));
    }
    const shown = series.filter((s) => !s.dash || s.values.some((v) => v != null));
    const fmt = met.eur ? eur0 : num, axis = met.eur ? (v) => (v >= 1000 ? NF1k.format(v / 1000) + 'k' : NF0.format(v)) : (v) => NF0.format(v);
    const all = [].concat.apply([], shown.map((s) => s.values)).filter((v) => v != null);
    const noLy = shown.length === series.length ? '' : '<span class="muted">No data for last year’s period.</span>';
    const legend = shown.map((s) => '<span><i style="background:' + s.color + (s.dash ? ';opacity:.5' : '') + '"></i>' + esc(s.name) + '</span>').join('') + noLy;
    const gl = t.grain === 'month' ? 'Monthly' : t.grain === 'week' ? 'Weekly' : 'Daily';
    const chart = lineChart({ id: 'ltrend', labels: ps.map((p) => p.label), tipLabels: ps.map((p) => p.tip), series: shown, fmt: fmt, axis: axis, nullText: 'no data',
      aria: met.name + ' by ' + t.grain + ', last ' + t.range + ' days, for ' + shown.map((s) => s.name).join(', ') + '. ' + (all.length ? 'Range ' + fmt(Math.min.apply(null, all)) + ' to ' + fmt(Math.max.apply(null, all)) + '.' : '') });
    const table = '<thead><tr><th scope="col">Period</th>' + shown.map((s) => '<th scope="col" class="num">' + esc(s.name) + '</th>').join('') + '</tr></thead><tbody>' +
      ps.map((p, i) => '<tr><td>' + esc(p.tip) + '</td>' + shown.map((s) => '<td class="num">' + (s.values[i] == null ? '<span class="muted">no data</span>' : esc(fmt(s.values[i]))) + '</td>').join('') + '</tr>').join('') + '</tbody>';
    const hasLy = shown.some((s) => s.dash);
    ltrendCsv = { name: 'store-trends-live-' + met.k, header: ['Period start', 'Period end'].concat(shown.map((s) => s.name + (met.eur ? ' EUR' : ''))).concat(hasLy ? ['Last-year period start', 'Last-year period end'] : []),
      rows: ps.map((p, i) => [p.start, p.end].concat(shown.map((s) => (s.values[i] == null ? '' : csvNum(s.values[i])))).concat(hasLy ? [p.lyStart, p.lyEnd] : [])) };
    h += '<div class="card"><div class="card-h"><div><span class="label">' + gl + ' · last ' + t.range + ' days</span><h2>' + esc(met.name) + '</h2></div><div class="legend">' + legend + '</div></div><div class="card-b">' +
      (ps.length ? chart + '<details class="tbl" style="margin-top:8px"><summary>Show as table</summary><div class="tw"><table class="t compact">' + table + '</table></div></details>' : '<div class="empty dashed">No open days in this period.</div>') + '</div></div>';
    return h;
  }
  ACT.ltrM = (d) => { ui.ltr.metric = d.v; saveUi(); rerender(); };
  ACT.ltrR = (d) => { ui.ltr.range = +d.v; saveUi(); rerender(); };
  ACT.ltrG = (d) => { ui.ltr.grain = d.v; saveUi(); rerender(); };
  ACT.ltrP = (d) => { ui.ltr.part = d.v; saveUi(); rerender(); };
  ACT.ltrS = (d) => { const a = ui.ltr.stores, i = a.indexOf(d.v); if (i >= 0) a.splice(i, 1); else if (a.length < 3) a.push(d.v); saveUi(); rerender(); };
  ACT.ltrClear = () => { ui.ltr.stores = []; saveUi(); rerender(); };
  ACT.lcsvTrend = () => { if (ltrendCsv) downloadCsv(ltrendCsv.name, ltrendCsv.header, ltrendCsv.rows); else toast('The live data is still loading.'); };

  // ── Start ────────────────────────────────────────────────────────────────
  // the first page waits for the live-data session check, so nobody sees demo flash before live (or the reverse)
  Promise.all([boot(), checkSession()]).then((all) => {
    state = all[0];
    if (!location.hash || location.hash === '#') history.replaceState(null, '', '#/' + (VA() !== 'HO' ? 'store/' + VA() : ''));
    onRoute();
    syncStart();
    watchAuth();
    if (fresh && !LIVE()) setTimeout(() => toast('Demo data ready · your marks and notes are saved in this browser'), 300);
  });
})();
