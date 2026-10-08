/* Adrial Payment reconciliation demo — vanilla JS single-page app.
 * Base data (orders, provider transactions, payouts, bank lines) is regenerated deterministically by data.js
 * from state.genDate, so the only thing stored is what the person decides: links (accepted / manual
 * matches), unmatched + rejected keys, exception status/owner/notes, month-close checks and the decision log.
 * Storage: IndexedDB "adrial-recon" (store "kv", record "state"); other tabs are told via
 * BroadcastChannel("adrial-recon"); cloud sync through /_shared/adrial-sync.js (app id "recon").
 * localStorage "adrial-recon-ui" keeps only filters/tabs. All money is integer cents. Nothing is ever sent
 * to a provider, bank or customer.
 * LIVE mode (allow-listed accounts only, see /recon.js): pages read /api/recon/* (summaries of
 * payments.payments_all_live) into page memory only — never into localStorage/IndexedDB. The only live
 * thing stored (IndexedDB + cloud sync, inside the same state record as S.live) is what people decide on
 * live exceptions — status/owner/notes keyed by "kind|ref" — plus the live month-close checks and log. */
(function () {
  'use strict';

  var D = window.ReconData, U = D.util;
  var PROV = {}, ACC = {}, SHOP = {};
  D.PROVIDERS.forEach(function (p) { PROV[p.id] = p; });
  D.ACCOUNTS.forEach(function (a) { ACC[a.id] = a; });
  D.SHOPS.forEach(function (s) { SHOP[s.id] = s; });
  var TODAY = D.todayLj(), REF = TODAY; // REF = the date the demo data is 'as of' (state.genDate)
  var UIKEY = 'adrial-recon-ui', STATE_V = 1;
  var $ = function (id) { return document.getElementById(id); };

  // ── Formatting ───────────────────────────────────────────────────────────
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var NF2 = new Intl.NumberFormat('sl-SI', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var NF0 = new Intl.NumberFormat('sl-SI', { maximumFractionDigits: 0 });
  var NF1 = new Intl.NumberFormat('sl-SI', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  var NFP = new Intl.NumberFormat('sl-SI', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var DTF = null;
  try { DTF = new Intl.DateTimeFormat('sl-SI', { timeZone: 'Europe/Ljubljana', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { DTF = null; }
  function eur(c) { return NF2.format((c || 0) / 100) + ' €'; }
  function eur0(c) { return NF0.format(Math.round((c || 0) / 100)) + ' €'; }
  function amt(c, cls) { return '<span class="amt' + (c < 0 ? ' neg' : '') + (cls ? ' ' + cls : '') + '">' + eur(c) + '</span>'; }
  function signed(c) { return (c > 0 ? '+' : '') + eur(c); }
  function num(n) { return NF0.format(n || 0); }
  function pct(a, b) { return b ? NF1.format(a / b * 100 + 0) + ' %' : '—'; }
  function rate(fee, vol) { return vol ? NFP.format(fee / vol * 100 + 0) + ' %' : '—'; } // + 0 turns -0 into 0
  function fdate(s) { return s ? s.slice(8, 10) + '.' + s.slice(5, 7) + '.' + s.slice(0, 4) : '—'; }
  function fts(iso) { if (!iso) return '—'; try { return DTF ? DTF.format(new Date(iso)) : iso.slice(0, 16).replace('T', ' '); } catch (e) { return iso; } }
  function age(d) { return U.diffDays(d, REF); }
  function cents2(c) { return (c / 100).toFixed(2); }
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function nameKey(s) { return norm(s).replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' '); }
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function monthLabel(m) { return MONTHS[+m.slice(5, 7) - 1] + ' ' + m.slice(0, 4); }
  function monthShort(m) { return MONTHS[+m.slice(5, 7) - 1].slice(0, 3) + ' ' + m.slice(2, 4); }
  function nowIso() { return new Date().toISOString(); }
  function who() { try { var u = window.AdrialSync && window.AdrialSync.user && window.AdrialSync.user(); if (u && u.email) return u.email; } catch (e) { /* no sync */ } return 'you'; }

  var IC = {
    x: 'M6 6l12 12M18 6L6 18', exp: 'M12 4v12M6 10l6 6 6-6M5 20h14', back: 'M15 6l-6 6 6 6', check: 'M5 12l5 5 9-10',
    home: 'M3 11l9-7 9 7v9H15v-6H9v6H3z', link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
    alert: 'M12 3l10 18H2zM12 10v5M12 18h.01', bank: 'M3 10l9-6 9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18', pct: 'M19 5L5 19M7 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
    cal: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4', list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01', arrow: 'M4 12h15M14 6l6 6-6 6',
    unlink: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7M3 3l18 18', dot: 'M12 12h.01', minus: 'M6 12h12',
    search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4.2-4.2', refresh: 'M4 12a8 8 0 1 0 2.4-5.7L4 8.6M4 4v4.6h4.6'
  };
  function ic(n) { return '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="' + IC[n] + '"/></svg>'; }

  // ── Storage: IndexedDB (state), localStorage (UI prefs only) ─────────────
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } }
  var IDB_NAME = 'adrial-recon', IDB_STORE = 'kv', IDB_REC = 'state';
  var idbOK = true, idbPromise = null;
  function idbOpen() {
    if (!idbPromise) {
      idbPromise = new Promise(function (resolve, reject) {
        try {
          if (!window.indexedDB) throw new Error('IndexedDB not available');
          var rq = indexedDB.open(IDB_NAME, 1);
          rq.onupgradeneeded = function () { if (!rq.result.objectStoreNames.contains(IDB_STORE)) rq.result.createObjectStore(IDB_STORE); };
          rq.onsuccess = function () { var d = rq.result; d.onversionchange = function () { d.close(); idbPromise = null; }; resolve(d); };
          rq.onerror = function () { reject(rq.error || new Error('IndexedDB open failed')); };
          rq.onblocked = function () { reject(new Error('IndexedDB open blocked')); };
        } catch (e) { reject(e); }
      });
      idbPromise.catch(function () { idbPromise = null; });
    }
    return idbPromise;
  }
  function idbTx(mode, fn) {
    return idbOpen().then(function (d) {
      return new Promise(function (resolve, reject) {
        var tx, out;
        try { tx = d.transaction(IDB_STORE, mode); out = fn(tx.objectStore(IDB_STORE)); } catch (e) { reject(e); return; }
        tx.oncomplete = function () { resolve(out && 'result' in out ? out.result : undefined); };
        tx.onerror = function () { reject(tx.error || new Error('IndexedDB transaction failed')); };
        tx.onabort = function () { reject(tx.error || new Error('IndexedDB transaction aborted')); };
      });
    });
  }
  function idbGet() { return idbTx('readonly', function (s) { return s.get(IDB_REC); }); }
  function idbPut(v) { return idbTx('readwrite', function (s) { s.put(v, IDB_REC); }); }

  var storageWarned = false, saveTimer = null, writeQ = Promise.resolve();
  function storageFailed(err) {
    idbOK = false;
    if (err && window.console) console.warn('Adrial Recon: IndexedDB unavailable, keeping decisions in memory only.', err);
    if (!storageWarned) { storageWarned = true; setTimeout(function () { toast('Browser storage is unavailable: decisions last until you reload.'); }, 50); }
  }
  function enqueue(job) { writeQ = writeQ.then(job).catch(storageFailed); return writeQ; }
  function save() { if (!idbOK) return; clearTimeout(saveTimer); saveTimer = setTimeout(flush, 200); }
  function flush() {
    if (!saveTimer) return writeQ;
    clearTimeout(saveTimer); saveTimer = null;
    if (!idbOK) return writeQ;
    var snap = JSON.parse(JSON.stringify(S));
    return enqueue(function () { return idbPut(snap).then(announce).then(syncChanged); });
  }
  window.addEventListener('pagehide', function () { flush(); });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flush(); });
  var channel = null;
  try { if (window.BroadcastChannel) channel = new BroadcastChannel('adrial-recon'); } catch (e) { channel = null; }
  function announce() { if (channel) { try { channel.postMessage({ type: 'changed' }); } catch (e) { /* closed */ } } }

  var ui = {};
  try { ui = JSON.parse(lsGet(UIKEY) || '{}') || {}; } catch (e) { ui = {}; }
  function uiState(k, def) { if (!ui[k] || typeof ui[k] !== 'object') ui[k] = def; for (var x in def) if (!(x in ui[k])) ui[k][x] = def[x]; return ui[k]; }
  function saveUi() {
    // live search boxes can hold real order numbers / batch references: those stay in memory only
    var copy = JSON.parse(JSON.stringify(ui));
    ['lex', 'lpo', 'llg'].forEach(function (k) { if (copy[k]) copy[k].q = ''; });
    lsSet(UIKEY, JSON.stringify(copy));
  }
  var stS = uiState('sug', { prov: '', kind: '', q: '' });
  var stW = uiState('wb', { tprov: '', ttype: '', tq: '', oshop: '', ostat: '', oq: '', cand: false });
  var stM = uiState('mt', { conf: '', kind: '', prov: '', q: '', page: 0 });
  var stE = uiState('ex', { type: '', status: 'active', owner: '', age: '', q: '', sort: 'age', dir: -1, page: 0 });
  var stP = uiState('po', { acc: '', status: '', month: '', q: '', page: 0 });
  var stB = uiState('bk', { kind: '', month: '', q: '', page: 0 });
  var stF = uiState('fee', { month: '', by: 'provider', prov: '' });
  var stC = uiState('cl', { month: '' });
  var stL = uiState('log', { act: '', q: '', page: 0 });
  // live-mode filters (UI prefs only, never data)
  var stLO = uiState('lov', { p: '30', from: '', to: '' });
  var stLX = uiState('lex', { tab: 'problems', kind: '', acc: '', from: '', to: '', status: 'active', owner: '', q: '', sort: 'day', dir: -1, page: 0 });
  var stLP = uiState('lpo', { days: '90', prov: '', acc: '', diff: false, q: '', page: 0 });
  var stLF = uiState('lfe', { by: 'provider', prov: '', acc: '', month: '' });
  var stLC = uiState('lcl', { month: '' });
  var stLL = uiState('llg', { q: '', page: 0 });

  // ── State ────────────────────────────────────────────────────────────────
  var S = null, B = null, IX = null, E = null;
  function freshState(genDate) {
    return { v: STATE_V, genDate: genDate, seq: 0, links: [], blocked: {}, rejected: {}, ex: {}, close: {}, threshold: { count: 5, value: 50000 }, log: [], createdAt: nowIso() };
  }
  function validState(o) { return !!(o && o.v === STATE_V && typeof o.genDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.genDate) && Array.isArray(o.links) && o.ex && o.close && Array.isArray(o.log)); }
  function ensureState() {
    S.blocked = S.blocked || {}; S.rejected = S.rejected || {}; S.threshold = S.threshold || { count: 5, value: 50000 };
    S.seq = S.seq || 0;
    // live-mode decisions only (no live rows): exceptions by "kind|ref", month close, log
    if (!S.live || typeof S.live !== 'object') S.live = {};
    S.live.ex = S.live.ex || {}; S.live.close = S.live.close || {}; S.live.log = S.live.log || [];
    S.live.threshold = S.live.threshold || { count: 10, value: 100000 };
  }
  function logIt(act, txt, note, ref) {
    S.log.unshift({ at: nowIso(), by: who(), act: act, txt: txt, note: note || '', ref: ref || null });
    if (S.log.length > 3000) S.log.length = 3000;
  }

  // ── Base data and indexes ────────────────────────────────────────────────
  function loadBase() {
    if (B && B.genDate === S.genDate) return;
    B = D.generate(S.genDate); REF = S.genDate;
    IX = { o: {}, t: {}, p: {}, b: {}, byNo: {}, inv: {}, invD: {}, bankByPayout: {}, bankByTxn: {}, months: [] };
    B.orders.forEach(function (o) {
      IX.o[o.id] = o;
      IX.byNo[o.no.replace(/\D/g, '')] = o;
      IX.inv[o.inv] = o;
      var k = o.country + o.inv.replace(/\D/g, '');
      IX.invD[k] = IX.invD[k] ? 'AMBIG' : o;
    });
    B.txns.forEach(function (t) { IX.t[t.id] = t; });
    B.payouts.forEach(function (p) { IX.p[p.id] = p; });
    B.bank.forEach(function (b) { IX.b[b.id] = b; if (b.payout) IX.bankByPayout[b.payout] = b; if (b.txn) IX.bankByTxn[b.txn] = b; });
    for (var m = B.start.slice(0, 7); m <= REF.slice(0, 7); m = U.addDays(m + '-28', 5).slice(0, 7)) IX.months.push(m);
  }
  // Orders referenced by a transaction's merchant reference (order numbers, invoice numbers, UPN refs)
  function refOrders(t) {
    var s = String(t.ref || '').toUpperCase(), out = [], m;
    var re = /(?:^|[^0-9])([3579]\d{5})(?![0-9])/g;
    while ((m = re.exec(s))) { var o = IX.byNo[m[1]]; if (o && out.indexOf(o) < 0) out.push(o); }
    var re2 = /R26-([A-Z]{2})-(\d{5})/g;
    while ((m = re2.exec(s))) { var o2 = IX.inv[m[0]]; if (o2 && out.indexOf(o2) < 0) out.push(o2); }
    var re3 = /(?:^|[^0-9])26(\d{5})(?![0-9])/g;
    while ((m = re3.exec(s))) { var o3 = IX.invD[t.country + '26' + m[1]]; if (o3 && o3 !== 'AMBIG' && out.indexOf(o3) < 0) out.push(o3); }
    return out;
  }
  var WINDOW = { monri: [0, 3], adyen: [0, 3], paypal: [0, 3], flik: [0, 3], valu: [0, 3], klarna: [0, 10], cod: [1, 14], bank: [0, 21] };
  function inWindow(t, o) { var w = WINDOW[t.provider] || [0, 3], d = U.diffDays(o.date, t.date); return d >= w[0] && d <= w[1]; }
  function mkey(tids, oids) { return tids.slice().sort().join('+') + '|' + oids.slice().sort().join('+'); }
  function sumT(ids) { var s = 0; ids.forEach(function (id) { s += IX.t[id].gross; }); return s; }
  function sumO(ids) { var s = 0; ids.forEach(function (id) { s += IX.o[id].amount; }); return s; }
  function kindOf(tids) {
    var ty = tids.map(function (id) { return IX.t[id].type; });
    if (ty.every(function (x) { return x === 'chargeback'; })) return 'chargeback';
    if (ty.every(function (x) { return x === 'refund'; })) return 'refund';
    return 'payment';
  }
  function cnSum(o) { var s = 0; o.cns.forEach(function (c) { s += c.amount; }); return s; }

  // ── Matching engine ──────────────────────────────────────────────────────
  // 1) stored links (accepted suggestions + manual matches), 2) auto-match by reference,
  // 3) suggestions by amount + date window + e-mail/name (incl. 1 payment → 2 orders), 4) exceptions.
  function engine() {
    var used = {}, uo = {}, M = [], byOrder = {}, mByKey = {};
    function add(m) {
      m.kind = kindOf(m.txnIds);
      m.sumT = sumT(m.txnIds); m.sumO = sumO(m.orderIds);
      m.key = mkey(m.txnIds, m.orderIds);
      m.diff = m.kind === 'payment' ? m.sumT - m.sumO : 0;
      m.date = m.txnIds.map(function (id) { return IX.t[id].date; }).sort().pop();
      m.txnIds.forEach(function (id) { used[id] = m; });
      m.orderIds.forEach(function (id) { (byOrder[id] = byOrder[id] || []).push(m); if (m.kind === 'payment') uo[id] = m; });
      mByKey[m.key] = m;
      M.push(m);
    }
    var stale = 0;
    S.links.forEach(function (l) {
      var ok = l.txnIds.length && l.orderIds.length && l.txnIds.every(function (id) { return IX.t[id] && !used[id]; }) && l.orderIds.every(function (id) { return IX.o[id]; });
      if (ok && kindOf(l.txnIds) === 'payment' && l.orderIds.some(function (id) { return uo[id]; })) ok = false;
      if (!ok) { stale++; return; }
      add({ id: l.id, txnIds: l.txnIds.slice(), orderIds: l.orderIds.slice(), conf: l.conf, src: l.src || 'manual', reasons: l.reasons || [], by: l.by, at: l.at, note: l.note || '', reason: l.reason || '' });
    });

    // 2) by reference: connected components of captures ↔ referenced (unmatched) orders
    var parent = {};
    function find(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
    function union(a, b) { if (!(a in parent)) parent[a] = a; if (!(b in parent)) parent[b] = b; var ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; }
    B.txns.forEach(function (t) {
      if (used[t.id] || t.type !== 'capture') return;
      refOrders(t).forEach(function (o) { if (!uo[o.id]) union('T' + t.id, 'O' + o.id); });
    });
    var comps = {};
    Object.keys(parent).forEach(function (k) { var r = find(k), c = comps[r] = comps[r] || { t: [], o: [] }; if (k[0] === 'T') c.t.push(k.slice(1)); else c.o.push(k.slice(1)); });
    Object.keys(comps).forEach(function (r) {
      var c = comps[r], key = mkey(c.t, c.o);
      if (S.blocked[key]) return;
      var st = sumT(c.t), so = sumO(c.o), nos = c.o.map(function (id) { return IX.o[id].no; }).join(', ');
      var reasons = ['Reference matches ' + nos];
      if (c.t.length > 1) reasons.push(c.t.length + ' payments for ' + (c.o.length > 1 ? c.o.length + ' orders' : 'one order'));
      if (c.o.length > 1 && c.t.length === 1) reasons.push('One payment covers ' + c.o.length + ' orders');
      if (st === so) { reasons.push('Amount equal'); add({ id: 'A:' + key, txnIds: c.t, orderIds: c.o, conf: 'exact', src: 'auto', reasons: reasons }); return; }
      if (c.o.length === 1 && c.t.length >= 2 && c.t.some(function (id) { return IX.t[id].gross === so; })) {
        reasons.push('Paid ' + c.t.length + '× — overpaid by ' + eur(st - so));
        add({ id: 'A:' + key, txnIds: c.t, orderIds: c.o, conf: 'exact', src: 'auto', reasons: reasons, over: st - so }); return;
      }
      reasons.push('Amount differs by ' + signed(st - so));
      add({ id: 'A:' + key, txnIds: c.t, orderIds: c.o, conf: 'likely', src: 'auto', reasons: reasons });
    });
    // refunds / chargebacks by reference (do not consume the order)
    B.txns.forEach(function (t) {
      if (used[t.id] || t.type === 'capture') return;
      var os = refOrders(t); if (!os.length) return;
      var key = mkey([t.id], [os[0].id]);
      if (S.blocked[key]) return;
      add({ id: 'A:' + key, txnIds: [t.id], orderIds: [os[0].id], conf: 'exact', src: 'auto', reasons: ['Reference matches ' + os[0].no, t.type === 'refund' ? 'Refund' : 'Chargeback'] });
    });

    // 3) suggestions
    var freeO = B.orders.filter(function (o) { return !uo[o.id]; });
    var byAmt = {}, byCust = {};
    freeO.forEach(function (o) { (byAmt[o.amount] = byAmt[o.amount] || []).push(o); });
    var pairs = [], nCand = {};
    B.txns.forEach(function (t) {
      if (used[t.id] || t.type !== 'capture') return;
      (byAmt[t.gross] || []).forEach(function (o) {
        if (!inWindow(t, o)) return;
        var em = !!t.email && t.email.toLowerCase() === o.email, nm = nameKey(t.payer) === nameKey(o.name);
        if (!em && !nm) return;
        var key = mkey([t.id], [o.id]);
        if (S.rejected[key] || S.blocked[key]) return;
        var dd = U.diffDays(o.date, t.date);
        var rs = ['Same amount'];
        if (em) rs.push('Same e-mail'); if (nm) rs.push('Same name');
        rs.push(dd === 0 ? 'Paid the same day' : 'Paid ' + dd + ' d after the order');
        if (!t.ref) rs.push('No reference on the payment'); else rs.push('Reference “' + t.ref + '” not recognised');
        pairs.push({ key: key, t: t, o: [o], score: 40 + (em ? 35 : 0) + (nm ? 15 : 0) + Math.max(0, 10 - dd), reasons: rs });
        nCand[t.id] = (nCand[t.id] || 0) + 1;
      });
    });
    pairs.sort(function (a, b) { return b.score - a.score || (a.key < b.key ? -1 : 1); });
    var sT = {}, sO = {}, SUG = [];
    pairs.forEach(function (p) {
      if (sT[p.t.id] || sO[p.o[0].id]) return;
      sT[p.t.id] = 1; sO[p.o[0].id] = 1;
      if (nCand[p.t.id] > 1) p.reasons.push(nCand[p.t.id] + ' candidates — best shown');
      SUG.push(p);
    });
    // one payment covering two orders of the same customer, no usable reference
    freeO.forEach(function (o) { if (sO[o.id]) return; [o.email, 'n:' + nameKey(o.name)].forEach(function (k) { (byCust[k] = byCust[k] || []).push(o); }); });
    B.txns.forEach(function (t) {
      if (used[t.id] || sT[t.id] || t.type !== 'capture') return;
      var list = (t.email ? byCust[t.email.toLowerCase()] : null) || byCust['n:' + nameKey(t.payer)] || [];
      for (var i = 0; i < list.length; i++) for (var j = i + 1; j < list.length; j++) {
        var a = list[i], b = list[j];
        if (sO[a.id] || sO[b.id] || a.amount + b.amount !== t.gross || !inWindow(t, a) || !inWindow(t, b)) continue;
        var key = mkey([t.id], [a.id, b.id]);
        if (S.rejected[key] || S.blocked[key]) continue;
        sT[t.id] = sO[a.id] = sO[b.id] = 1;
        SUG.push({ key: key, t: t, o: [a, b], score: 55, reasons: ['Two orders of the same customer add up to the amount', t.email ? 'Same e-mail' : 'Same name', t.ref ? 'Reference “' + t.ref + '” not recognised' : 'No reference on the payment'] });
        return;
      }
    });
    SUG.forEach(function (s) { s.conf = 'likely'; s.txnIds = [s.t.id]; s.orderIds = s.o.map(function (o) { return o.id; }); s.amount = s.t.gross; s.diff = s.t.gross - sumO(s.orderIds); });
    SUG.sort(function (a, b) { return a.t.date < b.t.date ? -1 : a.t.date > b.t.date ? 1 : b.score - a.score; });

    // unmatched pools
    var unT = B.txns.filter(function (t) { return !used[t.id]; });
    var unO = B.orders.filter(function (o) { return !uo[o.id]; });

    // 4) exceptions (derived; their status/owner/notes live in S.ex)
    var EX = [];
    function ex(id, type, o) { o.id = id; o.type = type; EX.push(o); }
    unT.forEach(function (t) {
      if (sT[t.id] || age(t.date) < 1) return;
      ex('no_order:' + t.id, 'no_order', { amount: t.gross, date: t.date, provider: t.provider, txnIds: [t.id], orderIds: [], title: (t.type === 'capture' ? 'Payment ' : t.type === 'refund' ? 'Refund ' : 'Chargeback ') + (t.ref ? '“' + t.ref + '”' : 'without reference'), detail: ACC[t.account].name + ' · ' + (t.email || t.payer) });
    });
    M.forEach(function (m) {
      var t0 = IX.t[m.txnIds[0]], prov = t0.provider, nos = m.orderIds.map(function (id) { return IX.o[id].no; }).join(', ');
      if (m.kind === 'payment' && m.over) ex('double_paid:' + m.orderIds[0], 'double_paid', { amount: m.over, date: m.date, provider: prov, txnIds: m.txnIds, orderIds: m.orderIds, matchKey: m.key, title: nos + ' paid ' + m.txnIds.length + '×', detail: 'Overpaid by ' + eur(m.over) + ' · refund the duplicate' });
      else if (m.kind === 'payment' && m.diff !== 0) {
        var sub = m.txnIds.some(function (id) { return IX.t[id].origCurrency; }) ? 'currency' : Math.abs(m.diff) <= 5 ? 'rounding' : m.diff < 0 ? 'partial capture' : 'overpayment';
        ex('amount_diff:' + m.key, 'amount_diff', { amount: m.diff, date: m.date, provider: prov, txnIds: m.txnIds, orderIds: m.orderIds, matchKey: m.key, sub: sub, title: nos + ' · ' + sub, detail: 'Paid ' + eur(m.sumT) + ' for ' + eur(m.sumO) });
      }
      if (m.kind === 'refund') {
        var o = IX.o[m.orderIds[0]];
        if (!o.cns.length) ex('refund_no_cn:' + m.txnIds[0], 'refund_no_cn', { amount: m.sumT, date: m.date, provider: prov, txnIds: m.txnIds, orderIds: m.orderIds, matchKey: m.key, title: 'Refund on ' + o.no, detail: 'No credit note issued in the shop' });
      }
    });
    B.txns.forEach(function (t) {
      if (t.type === 'chargeback') ex('chargeback:' + t.id, 'chargeback', { amount: t.gross, date: t.date, provider: t.provider, txnIds: [t.id], orderIds: used[t.id] ? used[t.id].orderIds : [], title: 'Chargeback ' + (t.ref || ''), detail: t.reason || '' });
    });
    B.payouts.forEach(function (p) {
      var s = payoutStatus(p);
      if (s.code === 'missing') ex('payout_missing:' + p.id, 'payout_missing', { amount: p.net, date: p.date, provider: p.provider, payoutId: p.id, txnIds: [], orderIds: [], title: ACC[p.account].name + ' ' + p.batch, detail: 'Expected on the bank by ' + fdate(s.expected) });
      if (s.code === 'diff') ex('payout_diff:' + p.id, 'payout_diff', { amount: s.bank.amount - p.net, date: p.date, provider: p.provider, payoutId: p.id, bankId: s.bank.id, txnIds: [], orderIds: [], title: ACC[p.account].name + ' ' + p.batch, detail: 'Bank ' + eur(s.bank.amount) + ' vs payout net ' + eur(p.net) });
    });
    unO.forEach(function (o) {
      if (!o.markedPaid || sO[o.id] || age(o.date) < 3) return;
      ex('paid_no_payment:' + o.id, 'paid_no_payment', { amount: o.amount, date: o.date, provider: o.provider, txnIds: [], orderIds: [o.id], title: o.no + ' marked paid', detail: PROV[o.provider].name + ' · no payment received' });
    });
    B.bank.forEach(function (b) {
      if (b.kind === 'unknown') ex('bank_unknown:' + b.id, 'bank_unknown', { amount: b.amount, date: b.date, provider: /ADYEN/.test(b.counterparty) ? 'adyen' : 'bank', bankId: b.id, txnIds: [], orderIds: [], title: b.counterparty + ' · ' + b.text, detail: 'Bank credit with no payout report behind it' });
    });
    var exIds = {};
    EX.forEach(function (x) {
      exIds[x.id] = 1;
      var st = S.ex[x.id] || {};
      x.status = st.status || 'open'; x.owner = st.owner || ''; x.notes = st.notes || []; x.updatedAt = st.at || null; x.updatedBy = st.by || null;
      x.age = age(x.date);
    });
    // exceptions that were worked on but whose condition has since cleared (e.g. matched later)
    Object.keys(S.ex).forEach(function (id) {
      if (exIds[id]) return;
      var st = S.ex[id], sn = st.snap || {};
      EX.push({ id: id, type: sn.type || id.split(':')[0], amount: sn.amount || 0, date: sn.date || REF, provider: sn.provider || 'bank', txnIds: sn.txnIds || [], orderIds: sn.orderIds || [], payoutId: sn.payoutId, title: sn.title || id, detail: sn.detail || '',
        status: st.status === 'open' || st.status === 'waiting' ? 'resolved' : st.status, owner: st.owner || '', notes: st.notes || [], updatedAt: st.at, updatedBy: st.by, age: age(sn.date || REF), cleared: true });
    });
    var exByTxn = {}, exByOrder = {}, exByPayout = {};
    EX.forEach(function (x) {
      x.txnIds.forEach(function (id) { (exByTxn[id] = exByTxn[id] || []).push(x); });
      x.orderIds.forEach(function (id) { (exByOrder[id] = exByOrder[id] || []).push(x); });
      if (x.payoutId) (exByPayout[x.payoutId] = exByPayout[x.payoutId] || []).push(x);
    });
    E = { M: M, used: used, uo: uo, byOrder: byOrder, mByKey: mByKey, SUG: SUG, sT: sT, sO: sO, unT: unT, unO: unO, EX: EX, exByTxn: exByTxn, exByOrder: exByOrder, exByPayout: exByPayout, stale: stale };
    cache = {};
  }
  var cache = {};
  function payoutStatus(p) {
    var b = IX.bankByPayout[p.id], expected = U.addBusiness(p.date, 2);
    if (b) return b.amount === p.net ? { code: 'arrived', bank: b, expected: expected } : { code: 'diff', bank: b, expected: expected };
    return { code: REF > expected ? 'missing' : 'transit', expected: expected };
  }
  var PST = { arrived: ['Arrived', 'b-good'], transit: ['In transit', 'b-blue'], missing: ['Missing from bank', 'b-bad'], diff: ['Amount differs', 'b-bad'] };
  var EXT = {
    no_order: 'Payment without order', double_paid: 'Order paid twice', amount_diff: 'Amount differs', refund_no_cn: 'Refund without credit note',
    chargeback: 'Chargeback', payout_missing: 'Payout missing from bank', payout_diff: 'Payout ≠ bank amount', paid_no_payment: 'Marked paid, no payment', bank_unknown: 'Bank credit without payout'
  };
  var EXS = { open: ['Open', 'b-clay'], waiting: ['Waiting', 'b-blue'], resolved: ['Resolved', 'b-good'], written_off: ['Written off', ''] };
  function isActive(x) { return x.status === 'open' || x.status === 'waiting'; }
  function exState(id) { return S.ex[id] || null; }

  // Seed a few realistic statuses into a freshly generated dataset (by fictional colleagues)
  function seedDemoDecisions() {
    engine();
    var ago = function (d, h) { var t = new Date(); t.setDate(t.getDate() - d); t.setHours(h, 12, 0, 0); return t.toISOString(); };
    var pickType = function (type, n) { return E.EX.filter(function (x) { return x.type === type; }).sort(function (a, b) { return b.age - a.age; }).slice(0, n); };
    var put = function (x, status, owner, note, d) {
      S.ex[x.id] = { status: status, owner: owner, by: owner, at: ago(d, 10), notes: [{ by: owner, at: ago(d, 10), text: note }], snap: snapOf(x) };
      S.log.push({ at: ago(d, 10), by: owner, act: 'exception', txt: EXT[x.type] + ' ' + x.title + ' → ' + EXS[status][0], note: note, ref: x.id });
    };
    var O = D.OWNERS;
    pickType('no_order', 2).forEach(function (x, i) { put(x, 'waiting', O[0], i ? 'Asked the customer service team whether this was a phone order.' : 'Asked the provider support for the original order reference.', 6 + i); });
    pickType('chargeback', 1).forEach(function (x) { put(x, 'waiting', O[1], 'Delivery proof and invoice uploaded as dispute evidence.', 4); });
    pickType('amount_diff', 8).filter(function (x) { return x.sub === 'rounding'; }).slice(0, 2).forEach(function (x) { put(x, 'written_off', O[2], 'Rounding difference below 0,05 € written off (account 7790).', 3); });
    pickType('refund_no_cn', 1).forEach(function (x) { put(x, 'open', O[0], 'Shop team asked to issue the credit note.', 2); });
    S.log.sort(function (a, b) { return a.at < b.at ? 1 : -1; });
  }
  function snapOf(x) { return { type: x.type, title: x.title, detail: x.detail, amount: x.amount, date: x.date, provider: x.provider, txnIds: x.txnIds, orderIds: x.orderIds, payoutId: x.payoutId || null }; }

  // ── Layers: drawers, modals, focus (same behaviour as the ERP demo) ──────
  var layers = [], uid = 0;
  var FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  function openLayer(html, opts) {
    var host = document.createElement('div');
    host.className = 'layer layer-' + (layers.length + 1);
    host.innerHTML = '<div class="scrim" data-close></div>' + html;
    $('layers').appendChild(host);
    var op = document.activeElement;
    var L = { el: host, opts: opts || {}, opener: op, openerKey: op && op.getAttribute ? (op.getAttribute('data-fid') || op.id) : '' };
    layers.push(L);
    host.addEventListener('click', function (e) { if (e.target.closest('[data-close]')) { e.preventDefault(); closeLayer(L); } });
    return L;
  }
  function focusIn(el) {
    var f = el.querySelector('[data-autofocus]') || el.querySelector('.md-body ' + FOCUSABLE.split(',').join(',.md-body ')) || el.querySelector('.md-foot [type=submit]') || el.querySelector('[role=dialog]');
    if (f) f.focus();
  }
  function closeLayer(L, noRestore) {
    var i = layers.indexOf(L);
    if (i < 0) return;
    layers.splice(i, 1);
    L.el.remove();
    if (!noRestore) {
      var back = L.opener && L.opener.isConnected && L.opener !== document.body ? L.opener : null;
      if (!back && L.openerKey) back = document.querySelector('[data-fid="' + L.openerKey + '"]') || document.getElementById(L.openerKey);
      if (back) back.focus();
      else if (layers.length) focusIn(layers[layers.length - 1].el);
      else { var h = document.querySelector('#main h1'); if (h) h.focus({ preventScroll: true }); }
    }
  }
  function closeAll() { while (layers.length) closeLayer(layers[layers.length - 1], true); }
  function refreshLayers() { layers.forEach(function (L) { if (L.opts.refresh) L.opts.refresh(L); }); }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (layers.length) { e.preventDefault(); closeLayer(layers[layers.length - 1]); return; }
      if ($('side').classList.contains('open')) { setMenu(false); $('menuBtn').focus(); }
      return;
    }
    if (e.key === 'Tab' && layers.length) {
      var box = layers[layers.length - 1].el.querySelector('[role=dialog]');
      var f = Array.prototype.filter.call(box.querySelectorAll(FOCUSABLE), function (n) { return n.offsetParent !== null || n === document.activeElement; });
      if (!f.length) { e.preventDefault(); box.focus(); return; }
      var first = f[0], last = f[f.length - 1];
      if (!box.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && (document.activeElement === first || document.activeElement === box)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  /* modal({title, body, submitLabel, danger, wide, onSubmit(form) -> error|null, mount(form)}) */
  function modal(o) {
    var id = 'mh' + (++uid);
    var foot = '<button type="button" class="btn ghost" data-close>' + esc(o.cancelLabel || 'Cancel') + '</button>' +
      (o.onSubmit ? '<button type="submit" class="btn ' + (o.danger ? 'danger' : 'pri') + '">' + esc(o.submitLabel || 'Save') + '</button>' : '');
    var html = '<form class="modal' + (o.wide ? ' wide' : '') + '" role="dialog" aria-modal="true" aria-labelledby="' + id + '" tabindex="-1" novalidate>' +
      '<div class="md-head"><h2 id="' + id + '">' + esc(o.title) + '</h2><button type="button" class="btn icon sm ghost" data-close aria-label="Close dialog">' + ic('x') + '</button></div>' +
      '<div class="md-body">' + o.body + '<div class="err" role="alert" hidden></div></div><div class="md-foot">' + foot + '</div></form>';
    var L = openLayer(html, o);
    var form = L.el.querySelector('form');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!o.onSubmit) return;
      var err = o.onSubmit(form, L);
      var box = form.querySelector('.err');
      if (err) { box.textContent = err; box.hidden = false; return; }
      closeLayer(L);
    });
    if (o.mount) o.mount(form, L);
    focusIn(L.el);
    return L;
  }
  function confirmBox(title, html, okLabel, onOk, danger) { modal({ title: title, body: '<p>' + html + '</p>', submitLabel: okLabel, danger: danger, onSubmit: function () { return onOk() || null; } }); }
  function drawer(render) {
    var id = 'dh' + (++uid);
    var L = openLayer('<aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="' + id + '" tabindex="-1"></aside>', { refresh: function (L2) { fill(L2); } });
    function fill(L2) {
      var c = render();
      var box = L2.el.querySelector('.drawer');
      if (!c) { box.innerHTML = '<div class="dr-head"><h2 id="' + id + '">Not found</h2><button type="button" class="btn icon sm ghost" data-close aria-label="Close panel">' + ic('x') + '</button></div>'; return; }
      box.classList.toggle('wide', !!c.wide);
      var st = box.querySelector('.dr-body') ? box.querySelector('.dr-body').scrollTop : 0;
      // keep half-typed text (notes) when the drawer re-renders because data arrived or something was saved
      var typed = {}, ae = document.activeElement, hadFocus = box.contains(ae) && ae !== box;
      var fk = hadFocus ? (ae.id || ae.getAttribute('data-fid') || (ae.hasAttribute('data-close') ? '__close' : '')) : '';
      Array.prototype.forEach.call(box.querySelectorAll('textarea[id],input[type=text][id],input[type=search][id]'), function (n) { if (n.value) typed[n.id] = n.value; });
      box.innerHTML = '<div class="dr-head"><div style="min-width:0">' + c.eyebrow + '<h2 id="' + id + '">' + c.title + '</h2>' + (c.sub || '') + '</div>' +
        '<button type="button" class="btn icon sm ghost" data-close aria-label="Close panel">' + ic('x') + '</button></div><div class="dr-body">' + c.body + '</div>';
      Object.keys(typed).forEach(function (id) { var n = box.querySelector('#' + CSS.escape(id)); if (n && !n.value) n.value = typed[id]; });
      box.querySelector('.dr-body').scrollTop = st;
      if (hadFocus && !box.contains(document.activeElement)) { // re-rendered under the keyboard: put focus back
        var back = fk && fk !== '__close' ? box.querySelector('#' + CSS.escape(fk) + ',[data-fid="' + CSS.escape(fk) + '"]') : null;
        (back || box.querySelector('.dr-head [data-close]') || box).focus({ preventScroll: true });
      }
    }
    fill(L);
    var h = L.el.querySelector('.drawer [data-close]');
    (h || L.el.querySelector('.drawer')).focus();
    return L;
  }
  function toast(msg) { var t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(function () { t.classList.remove('on'); }, 3400); }
  function field(label, input, hint) { var id = 'f' + (++uid); return '<div class="field"><label for="' + id + '">' + esc(label) + '</label>' + input.replace('%ID%', id) + (hint ? '<span class="hint">' + hint + '</span>' : '') + '</div>'; }
  function opt(v, label, sel) { return '<option value="' + esc(v) + '"' + (String(v) === String(sel) ? ' selected' : '') + '>' + esc(label) + '</option>'; }

  // ── CSV ──────────────────────────────────────────────────────────────────
  function csvCell(v) {
    if (v == null) v = '';
    // spreadsheet formula guard, but plain signed numbers (-12.50) stay numbers
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) && !/^-\d+(\.\d+)?$/.test(v)) v = "'" + v;
    v = String(v);
    return /[",;\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  function downloadCsv(name, header, rows, quiet) {
    var s = '﻿' + [header].concat(rows).map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
    var url = URL.createObjectURL(new Blob([s], { type: 'text/csv;charset=utf-8' }));
    var a = document.createElement('a');
    a.href = url; a.download = name + '-' + (MODE === 'live' ? (through() || 'live') : REF) + '.csv';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
    if (!quiet) toast('Exported ' + num(rows.length) + ' rows to ' + a.download);
    return a.download;
  }
  // CSV amounts: plain numbers with a dot (machine-readable), signed
  function cc(c) { return cents2(c || 0); }

  // ── Shared bits ──────────────────────────────────────────────────────────
  function head(eyebrowTxt, title, sub, actions) {
    return '<header class="head"><div style="min-width:0"><span class="eyebrow">' + esc(eyebrowTxt) + '</span><h1 tabindex="-1">' + title + '</h1>' + (sub ? '<p class="sub">' + sub + '</p>' : '') + '</div>' +
      (actions ? '<div class="head-actions">' + actions + '</div>' : '') + '</header>';
  }
  function badge(txt, cls) { return '<span class="badge ' + (cls || '') + '">' + esc(txt) + '</span>'; }
  function provBadge(p) { var x = PROV[p]; return x ? '<span class="badge plain b-' + x.color + '">' + esc(x.name) + '</span>' : ''; }
  function confBadge(c) { return badge({ exact: 'Exact', likely: 'Likely', manual: 'Manual' }[c] || c, 'b-' + c); }
  function exBadge(s) { var x = EXS[s] || [s, '']; return badge(x[0], x[1]); }
  function typeLabel(t) { return { capture: 'Payment', refund: 'Refund', chargeback: 'Chargeback' }[t] || t; }
  function methodLabel(t) { return D.METHOD_LABEL[t.method] + (t.brand ? ' · ' + t.brand : ''); }
  function tLink(t, label) { return '<button type="button" class="linkish" data-act="txn" data-id="' + t.id + '">' + esc(label || t.ref || '(no reference)') + '</button>'; }
  function oLink(o) { return '<button type="button" class="linkish" data-act="order" data-id="' + o.id + '">' + esc(o.no) + '</button>'; }
  function pLink(p) { return '<button type="button" class="linkish" data-act="payout" data-id="' + p.id + '">' + esc(p.batch) + '</button>'; }
  function tie(ok, txt) { return '<span class="tie ' + (ok ? 'ok' : 'bad') + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + (ok ? IC.check : IC.x) + '"/></svg>' + esc(txt) + '</span>'; }
  function pager(total, st, size, key) {
    var pages = Math.max(1, Math.ceil(total / size));
    if (st.page >= pages) st.page = pages - 1;
    if (st.page < 0) st.page = 0;
    if (total <= size) return '';
    return '<div class="pager"><span>' + num(st.page * size + 1) + '–' + num(Math.min(total, (st.page + 1) * size)) + ' of ' + num(total) + '</span><div>' +
      '<button type="button" class="btn sm" data-act="page" data-k="' + key + '" data-d="-1"' + (st.page ? '' : ' disabled') + '>Previous</button>' +
      '<button type="button" class="btn sm" data-act="page" data-k="' + key + '" data-d="1"' + (st.page < pages - 1 ? '' : ' disabled') + '>Next</button></div></div>';
  }
  var PAGERS = {};
  function empty(txt, sub) { return '<div class="empty">' + esc(txt) + (sub ? '<div class="hint" style="margin-top:6px">' + sub + '</div>' : '') + '</div>'; }
  function months() { return IX.months.slice(); }
  function monthOpts(sel, allLabel) { return (allLabel ? opt('', allLabel, sel) : '') + months().slice().reverse().map(function (m) { return opt(m, monthLabel(m), sel); }).join(''); }
  function provOpts(sel, allLabel) { return opt('', allLabel || 'All providers', sel) + D.PROVIDERS.map(function (p) { return opt(p.id, p.name, sel); }).join(''); }
  function inMonth(d, m) { return !m || d.slice(0, 7) === m; }

  // ── Navigation ───────────────────────────────────────────────────────────
  var NAV = [
    ['Overview', '', 'home', null],
    ['Reconcile', 'reconcile', 'link', function () { var n = E.SUG.length; return n ? n + ' to review' : ''; }],
    ['Exceptions', 'exceptions', 'alert', function () { var n = E.EX.filter(isActive).length; return n ? n + ' open' : ''; }],
    ['Payouts', 'payouts', 'bank', function () { var n = B.payouts.filter(function (p) { var c = payoutStatus(p).code; return c === 'missing' || c === 'diff'; }).length; return n ? n + ' flagged' : ''; }],
    ['Fees', 'fees', 'pct', null],
    ['Month close', 'close', 'cal', null],
    ['Activity', 'activity', 'list', null]
  ];
  function renderNav() {
    renderChrome();
    $('nav').innerHTML = (MODE === 'live' ? NAV_LIVE : NAV).map(function (n) {
      var cur = route.base === n[1];
      var c = n[3] ? n[3]() : '';
      return '<a href="#/' + n[1] + '"' + (cur ? ' aria-current="page"' : '') + '>' + ic(n[2]) + '<span>' + esc(n[0]) + '</span>' + (c ? '<span class="count">' + esc(c) + '</span>' : '') + '</a>';
    }).join('');
  }
  function setMenu(open) { $('side').classList.toggle('open', open); $('menuBtn').setAttribute('aria-expanded', open ? 'true' : 'false'); }
  $('menuBtn').addEventListener('click', function () { setMenu(!$('side').classList.contains('open')); });
  $('nav').addEventListener('click', function (e) { if (e.target.closest('a')) setMenu(false); });
  document.querySelector('.skip').addEventListener('click', function (e) { e.preventDefault(); var h = document.querySelector('#main h1'); (h || $('main')).focus(); });

  // ── Router ───────────────────────────────────────────────────────────────
  var route = { base: '', sub: null };
  var PAGES = { '': pageOverview, reconcile: pageReconcile, exceptions: pageExceptions, payouts: pagePayouts, fees: pageFees, close: pageClose, activity: pageActivity };
  function pages() { return MODE === 'live' ? PAGES_LIVE : PAGES; }
  function go(h) { if (location.hash === h) onRoute(); else location.hash = h; }
  var firstRoute = true;
  function onRoute() {
    if (!S) return;
    var parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    var base = parts[0] || '';
    if (!Object.prototype.hasOwnProperty.call(pages(), base)) {
      // the matching workbench needs shop orders, which live mode does not have: it becomes the order lookup
      location.replace(MODE === 'live' && base === 'reconcile' ? '#/order' : '#/'); return;
    }
    route = { base: base, sub: parts[1] || null };
    closeAll(); setMenu(false);
    renderNav(); renderPage(); window.scrollTo(0, 0);
    if (!firstRoute) { var h = document.querySelector('#main h1'); if (h) h.focus({ preventScroll: true }); }
    firstRoute = false;
  }
  window.addEventListener('hashchange', onRoute);
  var afterHooks = [];
  function renderPage() { $('main').innerHTML = '<div class="page">' + pages()[route.base]() + '</div>'; var h = afterHooks; afterHooks = []; h.forEach(function (f) { f(); }); }
  // re-render keeping focus where it was (by data-fid or id)
  function rerender() {
    var a = document.activeElement, key = a && a !== document.body ? (a.getAttribute('data-fid') || a.id) : null;
    var inLayer = a && a.closest && a.closest('#layers');
    renderNav(); renderPage(); refreshLayers();
    if (key) { var n = document.querySelector('[data-fid="' + CSS.escape(key) + '"]') || document.getElementById(key); if (n) { n.focus({ preventScroll: true }); return; } }
    if (!inLayer && (document.activeElement === document.body || !document.activeElement.isConnected)) { var h = document.querySelector('#main h1'); if (h) h.focus({ preventScroll: true }); }
  }
  // after any decision: recompute, save, re-render
  function commit(msg) { engine(); save(); rerender(); if (msg) toast(msg); }

  // ── Global event delegation ──────────────────────────────────────────────
  var ACT = {}, CHG = {}, INP = {};
  document.addEventListener('click', function (e) {
    var a = e.target.closest('[data-act]');
    if (a && ACT[a.getAttribute('data-act')]) { e.preventDefault(); ACT[a.getAttribute('data-act')](a.dataset, a, e); return; }
    var tr = e.target.closest('tr[data-open]');
    if (tr && !e.target.closest('a,button,input,select,textarea,label')) { var p = tr.getAttribute('data-open').split(':'); ACT[p[0]]({ id: p.slice(1).join(':') }, tr); }
  });
  document.addEventListener('keydown', function (e) {
    var tr = e.target.closest && e.target.closest('tr[data-open]');
    if (tr && e.target === tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); var p = tr.getAttribute('data-open').split(':'); ACT[p[0]]({ id: p.slice(1).join(':') }, tr); }
  });
  document.addEventListener('change', function (e) { var a = e.target.closest('[data-chg]'); if (a && CHG[a.getAttribute('data-chg')]) CHG[a.getAttribute('data-chg')](a); });
  var inpTimer = null;
  document.addEventListener('input', function (e) { var a = e.target.closest('[data-inp]'); if (a && INP[a.getAttribute('data-inp')]) { clearTimeout(inpTimer); inpTimer = setTimeout(function () { INP[a.getAttribute('data-inp')](a); }, 160); } });
  ACT.page = function (d) { var st = PAGERS[d.k]; if (!st) return; st.page += +d.d; saveUi(); rerender(); };
  // generic filter binding: data-chg="f" data-st="sug" data-k="prov"
  var STS = { sug: stS, wb: stW, mt: stM, ex: stE, po: stP, bk: stB, fee: stF, cl: stC, log: stL, lov: stLO, lex: stLX, lpo: stLP, lfe: stLF, lcl: stLC, llg: stLL };
  CHG.f = function (el) { var st = STS[el.getAttribute('data-st')]; st[el.getAttribute('data-k')] = el.type === 'checkbox' ? el.checked : el.value; if ('page' in st) st.page = 0; saveUi(); rerender(); };
  INP.f = CHG.f;
  ACT.seg = function (d) { var st = STS[d.st]; st[d.k] = d.v; if ('page' in st) st.page = 0; saveUi(); rerender(); };
  function sel(st, k, html, label) { return '<label class="sr" for="s-' + st + '-' + k + '">' + esc(label) + '</label><select class="select" id="s-' + st + '-' + k + '" data-fid="s-' + st + '-' + k + '" data-chg="f" data-st="' + st + '" data-k="' + k + '">' + html + '</select>'; }
  function search(st, k, val, ph) { return '<input class="search" type="search" id="q-' + st + '-' + k + '" data-fid="q-' + st + '-' + k + '" data-inp="f" data-st="' + st + '" data-k="' + k + '" value="' + esc(val) + '" placeholder="' + esc(ph) + '" aria-label="' + esc(ph) + '">'; }
  function seg(st, k, cur, items, label) {
    return '<div class="seg" role="group" aria-label="' + esc(label) + '">' + items.map(function (it) {
      return '<button type="button" data-act="seg" data-st="' + st + '" data-k="' + k + '" data-v="' + esc(it[0]) + '" data-fid="seg-' + st + '-' + k + '-' + esc(it[0]) + '" aria-pressed="' + (String(cur) === String(it[0]) ? 'true' : 'false') + '">' + esc(it[1]) + '</button>';
    }).join('') + '</div>';
  }

  // ════════════════════════════════════════════════════════════════════════
  // Overview
  // ════════════════════════════════════════════════════════════════════════
  function totals() {
    if (cache.tot) return cache.tot;
    var caps = B.txns.filter(function (t) { return t.type === 'capture'; });
    var mC = caps.filter(function (t) { return E.used[t.id]; });
    var tv = 0, mv = 0; caps.forEach(function (t) { tv += t.gross; }); mC.forEach(function (t) { mv += t.gross; });
    var unV = 0; E.unT.forEach(function (t) { unV += t.gross; });
    cache.tot = { caps: caps.length, matched: mC.length, tv: tv, mv: mv, unN: E.unT.length, unV: unV };
    return cache.tot;
  }
  function feeAgg(filter) {
    var r = { n: 0, vol: 0, fees: 0, ref: 0, cb: 0, cnt: 0 };
    B.txns.forEach(function (t) {
      if (!filter(t)) return;
      r.fees += t.fee; r.cnt++;
      if (t.type === 'capture') { r.n++; r.vol += t.gross; } else if (t.type === 'refund') r.ref += t.gross; else r.cb += t.gross;
    });
    return r;
  }
  function pageOverview() {
    var T = totals(), curM = REF.slice(0, 7), prevM = U.addDays(curM + '-01', -1).slice(0, 7);
    var fm = feeAgg(function (t) { return t.date.slice(0, 7) === curM; }), fp = feeAgg(function (t) { return t.date.slice(0, 7) === prevM; });
    var act = E.EX.filter(isActive), actV = 0; act.forEach(function (x) { actV += Math.abs(x.amount); });
    var pend = B.payouts.map(function (p) { return { p: p, s: payoutStatus(p) }; }).filter(function (x) { return x.s.code !== 'arrived'; });
    var transit = pend.filter(function (x) { return x.s.code === 'transit'; }), flagged = pend.filter(function (x) { return x.s.code !== 'transit'; });
    var trV = 0; transit.forEach(function (x) { trV += x.p.net; });
    var h = head('Payment reconciliation · data as of ' + fdate(REF), 'Overview<span class="dot">.</span>', 'Provider payments matched against shop orders and invoices for ' + fdate(B.start) + '–' + fdate(REF) + '. Demo data: nothing is sent to any provider, bank or customer.',
      '<a class="btn pri" href="#/reconcile">' + ic('link') + 'Reconcile' + (E.SUG.length ? ' · ' + E.SUG.length : '') + '</a>');
    h += liveNote(false);
    h += '<div class="kpis">' +
      '<a class="kpi" href="#/reconcile/matched"><span class="label">Match rate · payments</span><span class="v">' + pct(T.matched, T.caps) + '</span><span class="d"><i></i>' + num(T.matched) + ' of ' + num(T.caps) + ' · by value ' + pct(T.mv, T.tv) + '</span></a>' +
      '<a class="kpi" href="#/reconcile/workbench"><span class="label">Unmatched payments</span><span class="v' + (T.unV < 0 ? ' neg' : '') + '">' + eur0(T.unV) + '</span><span class="d"><i></i>' + num(T.unN) + ' items incl. refunds, signed</span></a>' +
      '<a class="kpi" href="#/reconcile"><span class="label">Suggestions to review</span><span class="v">' + num(E.SUG.length) + '</span><span class="d"><i></i>amount + date + customer</span></a>' +
      '<a class="kpi" href="#/exceptions"><span class="label">Open exceptions</span><span class="v">' + num(act.length) + '</span><span class="d ' + (act.length ? 'bad' : 'good') + '"><i></i>' + eur0(actV) + ' at stake (absolute)</span></a>' +
      '<a class="kpi" href="#/fees"><span class="label">Fees · ' + esc(monthShort(curM)) + ' to date</span><span class="v">' + eur0(fm.fees) + '</span><span class="d"><i></i>' + rate(fm.fees, fm.vol) + ' of volume · ' + esc(monthShort(prevM)) + ' ' + eur0(fp.fees) + '</span></a>' +
      '<a class="kpi" href="#/payouts"><span class="label">Payouts pending</span><span class="v">' + num(transit.length) + '</span><span class="d ' + (flagged.length ? 'bad' : '') + '"><i></i>' + eur0(trV) + ' in transit · ' + num(flagged.length) + ' flagged</span></a>' +
      '</div>';

    // unmatched value per provider
    var byP = {};
    E.unT.forEach(function (t) { var x = byP[t.provider] = byP[t.provider] || { n: 0, v: 0 }; x.n++; x.v += t.gross; });
    var maxV = 1; Object.keys(byP).forEach(function (k) { maxV = Math.max(maxV, Math.abs(byP[k].v)); });
    var provList = D.PROVIDERS.filter(function (p) { return byP[p.id]; }).map(function (p) {
      var x = byP[p.id];
      return '<li><div class="l" style="flex:1"><a href="#/reconcile/workbench" data-act="wbprov" data-p="' + p.id + '">' + esc(p.name) + '</a><small>' + num(x.n) + ' unmatched</small><div class="bar"><i style="width:' + Math.max(2, Math.abs(x.v) / maxV * 100) + '%"></i></div></div><div class="r">' + amt(x.v) + '</div></li>';
    }).join('');
    // exceptions by type × age
    var buckets = [[0, 2, '0–2 d'], [3, 7, '3–7 d'], [8, 30, '8–30 d'], [31, 9999, '> 30 d']];
    var rows = Object.keys(EXT).map(function (k) {
      var xs = act.filter(function (x) { return x.type === k; }); if (!xs.length) return '';
      var v = 0; xs.forEach(function (x) { v += x.amount; });
      return '<tr class="click" data-open="extype:' + k + '" tabindex="0"><td>' + esc(EXT[k]) + '</td>' + buckets.map(function (b, i) {
        var n = xs.filter(function (x) { return x.age >= b[0] && x.age <= b[1]; }).length;
        return '<td class="num' + (n && i === 3 ? ' hot' : '') + '">' + (n || '<span class="muted">·</span>') + '</td>';
      }).join('') + '<td class="num"><b>' + xs.length + '</b></td><td class="num">' + amt(v) + '</td></tr>';
    }).join('');
    // fee rate by provider this month
    var fr = D.PROVIDERS.map(function (p) { return { p: p, a: feeAgg(function (t) { return t.provider === p.id && t.date.slice(0, 7) === curM; }) }; }).filter(function (x) { return x.a.vol; });
    var maxR = 0.0001; fr.forEach(function (x) { maxR = Math.max(maxR, x.a.fees / x.a.vol); });
    var feeList = fr.map(function (x) {
      return '<li><div class="l" style="flex:1"><b style="font-weight:500">' + esc(x.p.name) + '</b><small>' + eur0(x.a.vol) + ' volume · ' + eur(x.a.fees) + ' fees</small><div class="bar"><i style="width:' + (x.a.fees / x.a.vol / maxR * 100) + '%"></i></div></div><div class="r">' + rate(x.a.fees, x.a.vol) + '</div></li>';
    }).join('');
    var pendList = pend.sort(function (a, b) { return (a.s.code === 'transit') - (b.s.code === 'transit') || (a.p.date < b.p.date ? 1 : -1); }).slice(0, 8).map(function (x) {
      return '<li><div class="l">' + pLink(x.p) + '<small>' + esc(ACC[x.p.account].name) + ' · paid out ' + fdate(x.p.date) + ' · expected ' + fdate(x.s.expected) + '</small></div><div class="r">' + amt(x.p.net) + '<div>' + badge(PST[x.s.code][0], PST[x.s.code][1]) + '</div></div></li>';
    }).join('');
    var logList = S.log.slice(0, 6).map(function (l) { return '<li><div class="l"><span>' + esc(l.txt) + '</span><small>' + esc(l.by) + ' · ' + fts(l.at) + (l.note ? ' · “' + esc(l.note) + '”' : '') + '</small></div></li>'; }).join('');

    h += '<div class="dash"><section class="card"><div class="card-h"><div><span class="label">Open exceptions</span><h2>By type and age</h2></div><a class="btn sm" href="#/exceptions">All exceptions</a></div>' +
      (rows ? '<div class="tw"><table class="t compact agegrid"><thead><tr><th>Type</th>' + buckets.map(function (b) { return '<th class="num">' + b[2] + '</th>'; }).join('') + '<th class="num">Total</th><th class="num">Value</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : empty('No open exceptions.', 'Everything is matched or resolved.')) +
      '</section><section class="card"><div class="card-h"><div><span class="label">Unmatched value</span><h2>Per provider</h2></div></div><div class="card-b">' + (provList ? '<ul class="list">' + provList + '</ul>' : empty('Every payment is matched.')) + '</div></section></div>';
    h += '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr))">' +
      '<section class="card"><div class="card-h"><div><span class="label">Fees · ' + esc(monthLabel(curM)) + ' to date</span><h2>Effective rate by provider</h2></div><a class="btn sm" href="#/fees">Fees</a></div><div class="card-b">' + (feeList ? '<ul class="list">' + feeList + '</ul>' : empty('No payments this month yet.')) + '</div></section>' +
      '<section class="card"><div class="card-h"><div><span class="label">Bank</span><h2>Payouts pending or flagged</h2></div><a class="btn sm" href="#/payouts">Payouts</a></div><div class="card-b">' + (pendList ? '<ul class="list">' + pendList + '</ul>' : empty('All payouts arrived on the bank.')) + '</div></section>' +
      '<section class="card"><div class="card-h"><div><span class="label">Who did what</span><h2>Recent decisions</h2></div><a class="btn sm" href="#/activity">Activity</a></div><div class="card-b">' + (logList ? '<ul class="list">' + logList + '</ul>' : empty('No decisions yet.', 'Accept a suggestion or match something by hand.')) + '</div></section>' +
      '</div>';
    return h;
  }
  ACT.extype = function (d) { stE.type = d.id; stE.status = 'active'; stE.page = 0; saveUi(); go('#/exceptions'); };
  ACT.wbprov = function (d) { stW.tprov = d.p; saveUi(); go('#/reconcile/workbench'); };

  // ════════════════════════════════════════════════════════════════════════
  // Reconcile: suggestions · workbench · matched
  // ════════════════════════════════════════════════════════════════════════
  var selT = {}, selO = {};
  function pageReconcile() {
    var sub = route.sub || 'suggestions';
    if (['suggestions', 'workbench', 'matched'].indexOf(sub) < 0) sub = 'suggestions';
    var tabs = '<nav class="seg" aria-label="Reconcile views" style="margin-bottom:14px">' + [['suggestions', 'Suggestions · ' + E.SUG.length], ['workbench', 'Workbench · ' + E.unT.length + ' / ' + E.unO.length], ['matched', 'Matched · ' + num(E.M.length)]].map(function (x) {
      return '<a href="#/reconcile/' + x[0] + '"' + (x[0] === sub ? ' aria-current="page"' : '') + '>' + esc(x[1]) + '</a>';
    }).join('') + '</nav>';
    var h = head('Reconcile', 'Match payments to orders<span class="dot">.</span>', 'Exact reference matches are applied automatically. Review the likely ones, or match by hand with a reason. Every decision is saved with who and when.');
    return h + tabs + (sub === 'suggestions' ? viewSuggestions() : sub === 'workbench' ? viewWorkbench() : viewMatched());
  }
  function txnLine(t) { return esc(ACC[t.account].name) + ' · ' + typeLabel(t.type) + ' · ' + fdate(t.date) + ' ' + esc(t.time); }
  function orderLine(o) { return esc(SHOP[o.shop].name) + ' · ' + fdate(o.date) + ' · ' + esc(PROV[o.provider].name); }
  function sugFiltered() {
    var q = norm(stS.q);
    return E.SUG.filter(function (s) {
      if (stS.prov && s.t.provider !== stS.prov) return false;
      if (stS.kind === 'single' && s.o.length > 1) return false;
      if (stS.kind === 'split' && s.o.length < 2) return false;
      if (stS.kind === 'email' && s.reasons.indexOf('Same e-mail') < 0) return false;
      if (q) { var hay = norm([s.t.ref, s.t.email, s.t.payer, eur(s.t.gross)].concat(s.o.map(function (o) { return o.no + ' ' + o.inv + ' ' + o.name + ' ' + o.email; })).join(' ')); if (hay.indexOf(q) < 0) return false; }
      return true;
    });
  }
  function viewSuggestions() {
    var list = sugFiltered();
    var h = '<div class="toolbar">' + search('sug', 'q', stS.q, 'Search reference, e-mail, order, amount') +
      sel('sug', 'prov', provOpts(stS.prov), 'Provider') +
      sel('sug', 'kind', opt('', 'All suggestions', stS.kind) + opt('single', 'One payment → one order', stS.kind) + opt('split', 'One payment → two orders', stS.kind) + opt('email', 'Same e-mail only', stS.kind), 'Suggestion kind') +
      '<span class="grow"></span>' + (list.length ? '<button type="button" class="btn" data-act="acceptAll">' + ic('check') + 'Accept all shown (' + list.length + ')</button>' : '') + '</div>';
    h += '<p class="keys" aria-hidden="true"><span><span class="kbd">↑</span><span class="kbd">↓</span> move</span><span><span class="kbd">A</span> accept</span><span><span class="kbd">R</span> reject</span><span><span class="kbd">Enter</span> details</span><span><span class="kbd">M</span> match manually</span></p>';
    if (!list.length) return h + '<section class="card">' + empty(E.SUG.length ? 'No suggestions match these filters.' : 'No suggestions left to review.', E.SUG.length ? '' : 'Remaining unmatched items are in the workbench and the exceptions queue.') + '</section>';
    h += '<section class="card"><ol class="sugg" aria-label="Suggested matches. Use arrow keys to move, A to accept, R to reject.">' + list.map(function (s, i) {
      var t = s.t;
      return '<li tabindex="0" data-sid="' + esc(s.key) + '" data-fid="sg-' + esc(s.key) + '" aria-label="Payment ' + esc(eur(t.gross)) + ' from ' + esc(t.email || t.payer) + ' to order ' + esc(s.o.map(function (o) { return o.no; }).join(' and ')) + '">' +
        '<div class="side-a">' + provBadge(t.provider) + ' <b>' + amt(t.gross) + '</b> ' + tLink(t) + '<small>' + txnLine(t) + '</small><small>' + esc(t.email || t.payer) + '</small></div>' +
        '<div class="arrow"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + IC.arrow + '"/></svg></div>' +
        '<div class="side-b">' + s.o.map(function (o) { return '<div><b>' + amt(o.amount) + ' ' + oLink(o) + '</b><small>' + orderLine(o) + '</small><small>' + esc(o.name) + ' · ' + esc(o.email) + '</small></div>'; }).join('') + '</div>' +
        '<div class="acts"><button type="button" class="btn sm pri" data-act="accept" data-key="' + esc(s.key) + '" data-i="' + i + '">Accept</button><button type="button" class="btn sm" data-act="reject" data-key="' + esc(s.key) + '" data-i="' + i + '">Reject</button><button type="button" class="btn sm ghost" data-act="manualFrom" data-key="' + esc(s.key) + '">Match manually</button></div>' +
        '<div class="why">' + confBadge('likely') + s.reasons.map(function (r) { return '<span class="rs' + (/differs/.test(r) ? ' warn' : /Same|equal|Two orders/.test(r) ? ' ok' : '') + '">' + esc(r) + '</span>'; }).join('') + '<span class="score">score ' + s.score + '</span></div></li>';
    }).join('') + '</ol></section>';
    return h;
  }
  function sugByKey(k) { for (var i = 0; i < E.SUG.length; i++) if (E.SUG[i].key === k) return E.SUG[i]; return null; }
  function focusSug(i) {
    var lis = document.querySelectorAll('.sugg > li');
    if (!lis.length) { var h = document.querySelector('#main h1'); if (h) h.focus({ preventScroll: true }); return; }
    var li = lis[Math.max(0, Math.min(lis.length - 1, i))];
    li.focus();
    li.scrollIntoView({ block: 'nearest' });
  }
  function newLinkId() { S.seq = (S.seq || 0) + 1; return 'L' + S.seq; }
  function acceptSug(s, note) {
    S.links.push({ id: newLinkId(), txnIds: s.txnIds.slice(), orderIds: s.orderIds.slice(), conf: 'likely', src: 'suggestion', reasons: s.reasons.slice(), by: who(), at: nowIso(), note: note || '', reason: 'Accepted suggestion' });
    delete S.rejected[s.key]; delete S.blocked[s.key];
    logIt('accept', 'Accepted ' + eur(s.t.gross) + ' ' + (PROV[s.t.provider].name) + ' → ' + s.o.map(function (o) { return o.no; }).join(' + '), note, s.key);
  }
  ACT.accept = function (d) {
    var s = sugByKey(d.key); if (!s) return;
    var i = +d.i || 0;
    acceptSug(s);
    engine(); save(); renderNav(); renderPage(); focusSug(i);
    toast('Matched ' + s.o.map(function (o) { return o.no; }).join(' + ') + ' · ' + eur(s.t.gross));
  };
  ACT.reject = function (d) {
    var s = sugByKey(d.key); if (!s) return;
    var i = +d.i || 0;
    modal({
      title: 'Reject this suggestion?', submitLabel: 'Reject',
      body: '<p>' + esc(eur(s.t.gross)) + ' ' + esc(PROV[s.t.provider].name) + ' payment from ' + esc(s.t.email || s.t.payer) + ' will not be suggested for ' + esc(s.o.map(function (o) { return o.no; }).join(' + ')) + ' again. Both stay unmatched.</p>' +
        field('Reason', '<select class="in" id="%ID%" name="reason" data-autofocus>' + ['Different customer', 'Payment belongs to another order', 'Amount coincidence', 'Duplicate payment', 'Other'].map(function (r) { return opt(r, r, ''); }).join('') + '</select>') +
        field('Note (optional)', '<textarea class="in" id="%ID%" name="note" rows="2"></textarea>'),
      onSubmit: function (f) {
        var reason = f.elements.reason.value, note = f.elements.note.value.trim();
        S.rejected[s.key] = { by: who(), at: nowIso(), reason: reason, note: note };
        logIt('reject', 'Rejected suggestion ' + eur(s.t.gross) + ' → ' + s.o.map(function (o) { return o.no; }).join(' + ') + ' · ' + reason, note, s.key);
        setTimeout(function () { engine(); save(); renderNav(); renderPage(); focusSug(i); toast('Suggestion rejected'); }, 0);
        return null;
      }
    });
  };
  ACT.acceptAll = function () {
    var list = sugFiltered();
    confirmBox('Accept ' + list.length + ' suggestions?', 'Each shown suggestion becomes a <b>likely</b> match recorded under ' + esc(who()) + '. You can unmatch any of them later from the Matched tab, with a reason.', 'Accept ' + list.length, function () {
      list.forEach(function (s) { acceptSug(s, 'Bulk accept'); });
      commit('Accepted ' + list.length + ' suggestions');
    });
  };
  ACT.manualFrom = function (d) {
    var s = sugByKey(d.key); if (!s) return;
    selT = {}; selO = {}; selT[s.t.id] = 1; s.orderIds.forEach(function (id) { selO[id] = 1; });
    go('#/reconcile/workbench');
  };
  document.addEventListener('keydown', function (e) {
    var li = e.target.closest && e.target.closest('.sugg > li');
    if (!li || e.target !== li || e.ctrlKey || e.metaKey || e.altKey || layers.length) return;
    var lis = Array.prototype.slice.call(document.querySelectorAll('.sugg > li')), i = lis.indexOf(li), k = e.key.toLowerCase();
    if (k === 'arrowdown' || k === 'j') { e.preventDefault(); focusSug(i + 1); }
    else if (k === 'arrowup' || k === 'k') { e.preventDefault(); focusSug(i - 1); }
    else if (k === 'home') { e.preventDefault(); focusSug(0); }
    else if (k === 'end') { e.preventDefault(); focusSug(lis.length - 1); }
    else if (k === 'a') { e.preventDefault(); ACT.accept({ key: li.getAttribute('data-sid'), i: i }); }
    else if (k === 'r') { e.preventDefault(); ACT.reject({ key: li.getAttribute('data-sid'), i: i }); }
    else if (k === 'm') { e.preventDefault(); ACT.manualFrom({ key: li.getAttribute('data-sid') }); }
    else if (k === 'enter') { e.preventDefault(); var s = sugByKey(li.getAttribute('data-sid')); if (s) openTxn(s.t.id); }
  });

  // ── Workbench ────────────────────────────────────────────────────────────
  function candScore(t, o) {
    var sc = 0, rs = [];
    if (t.gross === o.amount) { sc += 50; rs.push('amount'); }
    if (t.email && t.email.toLowerCase() === o.email) { sc += 35; rs.push('e-mail'); }
    else if (nameKey(t.payer) === nameKey(o.name)) { sc += 20; rs.push('name'); }
    if (inWindow(t, o)) { sc += 10; rs.push('date'); }
    return { sc: sc, rs: rs };
  }
  function wbLists() {
    Object.keys(selT).forEach(function (id) { if (!IX.t[id] || E.used[id]) delete selT[id]; });
    Object.keys(selO).forEach(function (id) { if (!IX.o[id] || E.uo[id]) delete selO[id]; });
    var tq = norm(stW.tq), oq = norm(stW.oq);
    var ts = E.unT.filter(function (t) {
      if (stW.tprov && t.provider !== stW.tprov) return false;
      if (stW.ttype && t.type !== stW.ttype) return false;
      if (tq && norm([t.ref, t.email, t.payer, eur(t.gross), t.id, t.parcel].join(' ')).indexOf(tq) < 0) return false;
      return true;
    });
    var os = E.unO.filter(function (o) {
      if (stW.oshop && o.shop !== stW.oshop) return false;
      if (stW.ostat === 'paid' && !o.markedPaid) return false;
      if (stW.ostat === 'awaiting' && o.markedPaid) return false;
      if (oq && norm([o.no, o.inv, o.name, o.email, eur(o.amount)].join(' ')).indexOf(oq) < 0) return false;
      return true;
    });
    // candidates: score orders against the selected payments (and vice versa)
    var st = Object.keys(selT).map(function (id) { return IX.t[id]; }), so = Object.keys(selO).map(function (id) { return IX.o[id]; });
    var oScore = {}, tScore = {};
    if (st.length) os.forEach(function (o) { var b = { sc: 0, rs: [] }; st.forEach(function (t) { var c = candScore(t, o); if (c.sc > b.sc) b = c; }); oScore[o.id] = b; });
    if (so.length) ts.forEach(function (t) { var b = { sc: 0, rs: [] }; so.forEach(function (o) { var c = candScore(t, o); if (c.sc > b.sc) b = c; }); tScore[t.id] = b; });
    if (stW.cand) { if (st.length) os = os.filter(function (o) { return selO[o.id] || oScore[o.id].sc >= 45; }); if (so.length) ts = ts.filter(function (t) { return selT[t.id] || tScore[t.id].sc >= 45; }); }
    var byDate = function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; };
    ts.sort(function (a, b) { return (selT[b.id] ? 1 : 0) - (selT[a.id] ? 1 : 0) || ((tScore[b.id] || {}).sc || 0) - ((tScore[a.id] || {}).sc || 0) || byDate(a, b); });
    os.sort(function (a, b) { return (selO[b.id] ? 1 : 0) - (selO[a.id] ? 1 : 0) || ((oScore[b.id] || {}).sc || 0) - ((oScore[a.id] || {}).sc || 0) || byDate(a, b); });
    return { ts: ts, os: os, oScore: oScore, tScore: tScore };
  }
  var wbPage = { t: { page: 0 }, o: { page: 0 } };
  PAGERS.wbt = wbPage.t; PAGERS.wbo = wbPage.o;
  function viewWorkbench() {
    var L = wbLists(), SZ = 40;
    var tp = pager(L.ts.length, wbPage.t, SZ, 'wbt'), op = pager(L.os.length, wbPage.o, SZ, 'wbo');
    var tRows = L.ts.slice(wbPage.t.page * SZ, wbPage.t.page * SZ + SZ).map(function (t) {
      var c = L.tScore[t.id], on = !!selT[t.id];
      return '<li class="' + (on ? 'on' : c && c.sc >= 45 ? 'cand' : '') + '"><label><input type="checkbox" data-chg="selT" data-id="' + t.id + '" data-fid="ct-' + t.id + '"' + (on ? ' checked' : '') + ' aria-label="Select ' + esc(typeLabel(t.type) + ' ' + eur(t.gross) + ' ' + (t.ref || t.email || t.payer)) + '"></label>' +
        '<div class="l"><b>' + tLink(t) + '</b><small>' + txnLine(t) + '</small><small>' + esc(t.email || t.payer || '') + (t.parcel ? ' · parcel ' + esc(t.parcel) : '') + '</small></div>' +
        '<div class="r">' + amt(t.gross) + provBadge(t.provider) + (c && c.sc >= 45 ? '<span class="rs ok">' + esc(c.rs.join(' + ')) + '</span>' : '') + (E.sT[t.id] ? '<span class="rs">suggested</span>' : '') + '</div></li>';
    }).join('');
    var oRows = L.os.slice(wbPage.o.page * SZ, wbPage.o.page * SZ + SZ).map(function (o) {
      var c = L.oScore[o.id], on = !!selO[o.id];
      return '<li class="' + (on ? 'on' : c && c.sc >= 45 ? 'cand' : '') + '"><label><input type="checkbox" data-chg="selO" data-id="' + o.id + '" data-fid="co-' + o.id + '"' + (on ? ' checked' : '') + ' aria-label="Select order ' + esc(o.no + ' ' + eur(o.amount)) + '"></label>' +
        '<div class="l"><b>' + oLink(o) + '</b> <span class="muted">' + esc(o.inv) + '</span><small>' + orderLine(o) + '</small><small>' + esc(o.name) + ' · ' + esc(o.email) + '</small></div>' +
        '<div class="r">' + amt(o.amount) + (o.markedPaid ? '<span class="rs">marked paid</span>' : '<span class="rs">awaiting payment</span>') + (c && c.sc >= 45 ? '<span class="rs ok">' + esc(c.rs.join(' + ')) + '</span>' : '') + '</div></li>';
    }).join('');
    var h = '<p class="keys"><span>Tick one or more payments and one or more orders, then <b style="font-weight:500">Match selected</b> (or press <span class="kbd">M</span>). Candidates for your selection float to the top.</span></p>';
    h += '<label class="check" style="margin-bottom:12px"><input type="checkbox" data-chg="f" data-st="wb" data-k="cand" data-fid="wb-cand"' + (stW.cand ? ' checked' : '') + '> Show only candidates for the selection</label>';
    h += '<div class="wb"><section class="card"><div class="card-h"><div><span class="label">Provider side</span><h2>Unmatched payments · ' + num(L.ts.length) + '</h2></div><button type="button" class="btn sm" data-act="csvUnT">' + ic('exp') + 'CSV</button></div>' +
      '<div class="toolbar">' + search('wb', 'tq', stW.tq, 'Reference, e-mail, amount') + sel('wb', 'tprov', provOpts(stW.tprov), 'Provider') + sel('wb', 'ttype', opt('', 'All types', stW.ttype) + opt('capture', 'Payments', stW.ttype) + opt('refund', 'Refunds', stW.ttype) + opt('chargeback', 'Chargebacks', stW.ttype), 'Type') + '</div>' +
      (tRows ? '<ul class="pick">' + tRows + '</ul>' + tp : empty('No unmatched payments here.')) + '</section>' +
      '<section class="card"><div class="card-h"><div><span class="label">Shop side</span><h2>Unmatched orders · ' + num(L.os.length) + '</h2></div><button type="button" class="btn sm" data-act="csvUnO">' + ic('exp') + 'CSV</button></div>' +
      '<div class="toolbar">' + search('wb', 'oq', stW.oq, 'Order, invoice, customer, amount') + sel('wb', 'oshop', opt('', 'All shops', stW.oshop) + D.SHOPS.map(function (s) { return opt(s.id, s.name, stW.oshop); }).join(''), 'Shop') + sel('wb', 'ostat', opt('', 'Any status', stW.ostat) + opt('paid', 'Marked paid', stW.ostat) + opt('awaiting', 'Awaiting payment', stW.ostat), 'Order status') + '</div>' +
      (oRows ? '<ul class="pick">' + oRows + '</ul>' + op : empty('No unmatched orders here.')) + '</section></div>';
    h += selBar();
    return h;
  }
  function selBar() {
    var tids = Object.keys(selT), oids = Object.keys(selO);
    if (!tids.length && !oids.length) return '';
    var a = sumT(tids), b = sumO(oids), d = a - b;
    return '<div class="selbar" role="region" aria-label="Selection"><div class="sum"><div><span>Payments</span>' + tids.length + ' · ' + eur(a) + '</div><div><span>Orders</span>' + oids.length + ' · ' + eur(b) + '</div><div><span>Difference</span><b class="' + (d === 0 ? 'd-ok' : 'd-bad') + '" style="font-weight:500">' + signed(d) + '</b></div></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn sm ghost" data-act="clearSel">Clear</button><button type="button" class="btn sm" data-act="matchSel"' + (tids.length && oids.length ? '' : ' disabled') + '>' + ic('link') + 'Match selected…</button></div></div>';
  }
  CHG.selT = function (el) { if (el.checked) selT[el.getAttribute('data-id')] = 1; else delete selT[el.getAttribute('data-id')]; wbPage.o.page = 0; rerender(); };
  CHG.selO = function (el) { if (el.checked) selO[el.getAttribute('data-id')] = 1; else delete selO[el.getAttribute('data-id')]; wbPage.t.page = 0; rerender(); };
  ACT.clearSel = function () { selT = {}; selO = {}; rerender(); var h = document.querySelector('#main h1'); if (h) h.focus({ preventScroll: true }); };
  document.addEventListener('keydown', function (e) {
    if (route.base !== 'reconcile' || route.sub !== 'workbench' || layers.length || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest && e.target.closest('input[type=search],input[type=text],textarea,select')) return;
    if (e.key === 'm' || e.key === 'M') { if (Object.keys(selT).length && Object.keys(selO).length) { e.preventDefault(); ACT.matchSel(); } }
    if (e.key === '/') { var q = $('q-wb-tq'); if (q) { e.preventDefault(); q.focus(); } }
  });
  var REASONS = ['Same customer, reference missing on payment', 'One payment for several orders', 'Order paid in instalments', 'Wrong reference used by customer', 'Amount difference accepted', 'Other'];
  ACT.matchSel = function () {
    var tids = Object.keys(selT), oids = Object.keys(selO);
    if (!tids.length || !oids.length) return;
    var kinds = tids.map(function (id) { return IX.t[id].type; });
    var mixed = kinds.some(function (k) { return k !== kinds[0]; });
    if (mixed) { toast('Match payments, refunds and chargebacks separately.'); return; }
    var kind = kinds[0];
    if (kind !== 'capture' && oids.length > 1) { toast('A refund or chargeback belongs to one order.'); return; }
    if (tids.length > 1 && oids.length > 1) { toast('Split matches are one payment → several orders, or several payments → one order.'); return; }
    var a = sumT(tids), b = sumO(oids), d = kind === 'capture' ? a - b : 0;
    modal({
      title: 'Match manually', submitLabel: 'Match', wide: true,
      body: '<div class="minis"><div class="mini"><span>Payments</span><b>' + tids.length + ' · ' + esc(eur(a)) + '</b></div><div class="mini"><span>Orders</span><b>' + oids.length + ' · ' + esc(eur(b)) + '</b></div><div class="mini"><span>Difference</span><b class="' + (d ? 'neg' : 'pos') + '">' + esc(signed(d)) + '</b></div></div>' +
        '<ul class="list">' + tids.map(function (id) { var t = IX.t[id]; return '<li><div class="l"><b style="font-weight:500">' + esc(t.ref || '(no reference)') + '</b><small>' + txnLine(t) + '</small></div><div class="r">' + amt(t.gross) + '</div></li>'; }).join('') +
        oids.map(function (id) { var o = IX.o[id]; return '<li><div class="l"><b style="font-weight:500">' + esc(o.no) + ' · ' + esc(o.name) + '</b><small>' + orderLine(o) + '</small></div><div class="r">' + amt(o.amount) + '</div></li>'; }).join('') + '</ul>' +
        field('Reason (required)', '<select class="in" id="%ID%" name="reason" data-autofocus>' + opt('', 'Choose a reason…', '') + REASONS.map(function (r) { return opt(r, r, tids.length > 1 ? 'Order paid in instalments' : oids.length > 1 ? 'One payment for several orders' : ''); }).join('') + '</select>') +
        field('Note', '<textarea class="in" id="%ID%" name="note" rows="2" placeholder="What did you check?"></textarea>', d ? 'The difference stays visible as an “Amount differs” exception unless you write it off.' : '') +
        (d ? '<label class="check"><input type="checkbox" name="wo"> Write off the difference of ' + esc(signed(d)) + ' now</label>' : '') +
        '<p class="hint">Recorded as a <b>manual</b> match by ' + esc(who()) + '. Nothing is sent to the provider or the shop.</p>',
      onSubmit: function (f) {
        var reason = f.elements.reason.value, note = f.elements.note.value.trim();
        if (!reason) { f.elements.reason.setAttribute('aria-invalid', 'true'); f.elements.reason.focus(); return 'Choose a reason for the manual match.'; }
        if (reason === 'Other' && !note) { f.elements.note.focus(); return 'Add a note that explains “Other”.'; }
        var key = mkey(tids, oids);
        S.links.push({ id: newLinkId(), txnIds: tids, orderIds: oids, conf: 'manual', src: 'manual', reasons: [reason], by: who(), at: nowIso(), note: note, reason: reason });
        delete S.blocked[key]; delete S.rejected[key];
        logIt('match', 'Manual match ' + eur(a) + ' → ' + oids.map(function (id) { return IX.o[id].no; }).join(' + ') + ' · ' + reason, note, key);
        if (d && f.elements.wo && f.elements.wo.checked) {
          engine();
          var x = E.EX.filter(function (z) { return z.id === 'amount_diff:' + key; })[0];
          if (x) setEx(x, { status: 'written_off' }, 'Difference ' + signed(d) + ' written off at manual match' + (note ? ': ' + note : ''));
        }
        selT = {}; selO = {};
        setTimeout(function () { commit('Matched manually · ' + oids.map(function (id) { return IX.o[id].no; }).join(' + ')); }, 0);
        return null;
      }
    });
  };
  ACT.csvUnT = function () {
    var L = wbLists();
    downloadCsv('recon-unmatched-payments', ['Transaction', 'Provider', 'Account', 'Type', 'Date', 'Time', 'Reference', 'E-mail', 'Payer', 'Method', 'Gross EUR', 'Fee EUR', 'Net EUR', 'Payout batch', 'Suggested'], L.ts.map(function (t) {
      return [t.id, PROV[t.provider].name, ACC[t.account].name, typeLabel(t.type), t.date, t.time, t.ref, t.email, t.payer, methodLabel(t), cc(t.gross), cc(t.fee), cc(t.gross - t.fee), t.payout ? IX.p[t.payout].batch : '', E.sT[t.id] ? 'yes' : 'no'];
    }));
  };
  ACT.csvUnO = function () {
    var L = wbLists();
    downloadCsv('recon-unmatched-orders', ['Order', 'Invoice', 'Shop', 'Date', 'Customer', 'E-mail', 'Payment method', 'Amount EUR', 'Marked paid', 'Suggested'], L.os.map(function (o) {
      return [o.no, o.inv, SHOP[o.shop].name, o.date, o.name, o.email, PROV[o.provider].name, cc(o.amount), o.markedPaid ? 'yes' : 'no', E.sO[o.id] ? 'yes' : 'no'];
    }));
  };

  // ── Matched ──────────────────────────────────────────────────────────────
  PAGERS.mt = stM;
  function matchedRows() {
    var q = norm(stM.q);
    return E.M.filter(function (m) {
      if (stM.conf && m.conf !== stM.conf) return false;
      if (stM.kind && m.kind !== stM.kind) return false;
      if (stM.prov && IX.t[m.txnIds[0]].provider !== stM.prov) return false;
      if (q) {
        var hay = norm(m.txnIds.map(function (id) { var t = IX.t[id]; return t.ref + ' ' + t.email + ' ' + t.payer; }).concat(m.orderIds.map(function (id) { var o = IX.o[id]; return o.no + ' ' + o.inv + ' ' + o.name + ' ' + o.email; })).join(' ') + ' ' + eur(m.sumT) + ' ' + (m.by || '') + ' ' + (m.note || ''));
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    }).sort(function (a, b) { return (b.at || '') < (a.at || '') ? -1 : (b.at || '') > (a.at || '') ? 1 : a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
  }
  function viewMatched() {
    var rows = matchedRows(), SZ = 50;
    var cnt = { exact: 0, likely: 0, manual: 0 }; E.M.forEach(function (m) { cnt[m.conf]++; });
    var h = '<div class="toolbar">' + search('mt', 'q', stM.q, 'Reference, order, customer, amount, who') +
      sel('mt', 'conf', opt('', 'All confidence levels', stM.conf) + opt('exact', 'Exact · ' + cnt.exact, stM.conf) + opt('likely', 'Likely · ' + cnt.likely, stM.conf) + opt('manual', 'Manual · ' + cnt.manual, stM.conf), 'Confidence') +
      sel('mt', 'kind', opt('', 'Payments, refunds, chargebacks', stM.kind) + opt('payment', 'Payments', stM.kind) + opt('refund', 'Refunds', stM.kind) + opt('chargeback', 'Chargebacks', stM.kind), 'Kind') +
      sel('mt', 'prov', provOpts(stM.prov), 'Provider') + '<span class="grow"></span><button type="button" class="btn" data-act="csvMatched">' + ic('exp') + 'Export CSV</button></div>';
    var pg = pager(rows.length, stM, SZ, 'mt');
    var sT0 = 0, sO0 = 0; rows.forEach(function (m) { sT0 += m.sumT; if (m.kind === 'payment') sO0 += m.sumO; });
    h += '<section class="card"><div class="stats"><span><b>' + num(rows.length) + '</b> matches</span><span>Payments side <b>' + eur(sT0) + '</b></span><span>Orders side (payments) <b>' + eur(sO0) + '</b></span></div>';
    if (!rows.length) return h + empty('No matches with these filters.') + '</section>';
    h += '<div class="tw"><table class="t"><thead><tr><th>Confidence</th><th>Payment(s)</th><th>Order(s)</th><th class="num">Paid</th><th class="num">Order total</th><th class="num">Difference</th><th>Decided</th><th><span class="sr">Actions</span></th></tr></thead><tbody>' +
      rows.slice(stM.page * SZ, stM.page * SZ + SZ).map(function (m) {
        return '<tr><td>' + confBadge(m.conf) + (m.kind !== 'payment' ? ' ' + badge(m.kind === 'refund' ? 'Refund' : 'Chargeback', 'plain') : '') + '</td>' +
          '<td>' + m.txnIds.map(function (id) { var t = IX.t[id]; return '<div>' + tLink(t) + '<small>' + esc(PROV[t.provider].name) + ' · ' + fdate(t.date) + '</small></div>'; }).join('') + '</td>' +
          '<td>' + m.orderIds.map(function (id) { var o = IX.o[id]; return '<div>' + oLink(o) + '<small>' + esc(o.name) + '</small></div>'; }).join('') + '</td>' +
          '<td class="num">' + amt(m.sumT) + '</td><td class="num">' + (m.kind === 'payment' ? amt(m.sumO) : '<span class="muted">—</span>') + '</td><td class="num">' + (m.diff ? '<span class="neg">' + esc(signed(m.diff)) + '</span>' : '<span class="muted">0,00 €</span>') + '</td>' +
          '<td>' + (m.src === 'auto' ? '<span class="muted">Auto · by reference</span>' : esc(m.by || 'you') + '<small>' + fts(m.at) + (m.note ? ' · “' + esc(m.note) + '”' : '') + '</small>') + '</td>' +
          '<td class="nw"><button type="button" class="btn sm ghost" data-act="match" data-id="' + esc(m.key) + '" data-fid="mo-' + esc(m.key) + '">Details</button><button type="button" class="btn sm" data-act="unmatch" data-id="' + esc(m.key) + '">' + ic('unlink') + 'Unmatch</button></td></tr>';
      }).join('') + '</tbody></table></div>' + pg + '</section>';
    return h;
  }
  ACT.csvMatched = function () { downloadCsv('recon-matches', MATCH_HDR, matchedRows().map(matchCsv)); };
  var MATCH_HDR = ['Confidence', 'Kind', 'Source', 'Transactions', 'Providers', 'Accounts', 'Payment dates', 'References', 'Orders', 'Invoices', 'Credit notes', 'Paid EUR', 'Order total EUR', 'Difference EUR', 'Fees EUR', 'Payout batches', 'Decided by', 'Decided at', 'Reason', 'Note'];
  function matchCsv(m) {
    var ts = m.txnIds.map(function (id) { return IX.t[id]; }), os = m.orderIds.map(function (id) { return IX.o[id]; });
    var fee = 0; ts.forEach(function (t) { fee += t.fee; });
    var uniq = function (a) { return a.filter(function (x, i) { return x && a.indexOf(x) === i; }).join(' | '); };
    return [m.conf, m.kind, m.src, uniq(ts.map(function (t) { return t.id; })), uniq(ts.map(function (t) { return PROV[t.provider].name; })), uniq(ts.map(function (t) { return ACC[t.account].name; })), uniq(ts.map(function (t) { return t.date; })), uniq(ts.map(function (t) { return t.ref; })),
      uniq(os.map(function (o) { return o.no; })), uniq(os.map(function (o) { return o.inv; })), uniq([].concat.apply([], os.map(function (o) { return o.cns.map(function (c) { return c.no; }); }))),
      cc(m.sumT), m.kind === 'payment' ? cc(m.sumO) : '', cc(m.diff), cc(fee), uniq(ts.map(function (t) { return t.payout ? IX.p[t.payout].batch : ''; })), m.src === 'auto' ? 'auto' : m.by, m.at || '', m.reason || m.reasons.join('; '), m.note || ''];
  }
  ACT.unmatch = function (d) {
    var m = E.mByKey[d.id]; if (!m) return;
    modal({
      title: 'Unmatch?', submitLabel: 'Unmatch', danger: true,
      body: '<p>' + esc(m.txnIds.map(function (id) { return IX.t[id].ref || id; }).join(' + ')) + ' (' + esc(eur(m.sumT)) + ') and ' + esc(m.orderIds.map(function (id) { return IX.o[id].no; }).join(' + ')) + ' go back to the unmatched lists. This pairing is not auto-matched or suggested again unless you match it by hand.</p>' +
        field('Reason (required)', '<select class="in" id="%ID%" name="reason" data-autofocus>' + opt('', 'Choose a reason…', '') + ['Wrong order', 'Wrong customer', 'Payment belongs to several orders', 'Duplicate payment needs separate handling', 'Other'].map(function (r) { return opt(r, r, ''); }).join('') + '</select>') +
        field('Note', '<textarea class="in" id="%ID%" name="note" rows="2"></textarea>'),
      onSubmit: function (f) {
        var reason = f.elements.reason.value, note = f.elements.note.value.trim();
        if (!reason) { f.elements.reason.setAttribute('aria-invalid', 'true'); f.elements.reason.focus(); return 'Choose a reason.'; }
        S.links = S.links.filter(function (l) { return mkey(l.txnIds, l.orderIds) !== m.key; });
        S.blocked[m.key] = { by: who(), at: nowIso(), reason: reason, note: note };
        logIt('unmatch', 'Unmatched ' + eur(m.sumT) + ' ↔ ' + m.orderIds.map(function (id) { return IX.o[id].no; }).join(' + ') + ' · ' + reason, note, m.key);
        setTimeout(function () { closeAll(); commit('Unmatched · items are back in the workbench'); }, 0);
        return null;
      }
    });
  };

  // ════════════════════════════════════════════════════════════════════════
  // Drawers: transaction, order, match, payout, exception
  // ════════════════════════════════════════════════════════════════════════
  function metaGrid(items) { return '<div class="meta" style="padding:6px 0 4px">' + items.filter(Boolean).map(function (x) { return '<div><span>' + esc(x[0]) + '</span><p>' + x[1] + '</p></div>'; }).join('') + '</div>'; }
  function exList(xs) {
    if (!xs || !xs.length) return '';
    return '<h3>Exceptions</h3><ul class="list">' + xs.map(function (x) { return '<li><div class="l"><button type="button" class="linkish" data-act="ex" data-id="' + esc(x.id) + '">' + esc(EXT[x.type]) + '</button><small>' + esc(x.title) + '</small></div><div class="r">' + exBadge(x.status) + '</div></li>'; }).join('') + '</ul>';
  }
  function matchBlock(m) {
    if (!m) return '<h3>Match</h3><p class="muted" style="margin:0">Not matched.' + (route.base !== 'reconcile' ? ' <a href="#/reconcile/workbench">Open the workbench</a>' : '') + '</p>';
    return '<h3>Match</h3><ul class="list"><li><div class="l">' + confBadge(m.conf) + ' <button type="button" class="linkish" data-act="match" data-id="' + esc(m.key) + '">' + esc(m.orderIds.map(function (id) { return IX.o[id].no; }).join(' + ')) + '</button><small>' + esc(m.reasons.join(' · ')) + '</small><small>' + (m.src === 'auto' ? 'Auto-matched by reference' : esc(m.by || 'you') + ' · ' + fts(m.at)) + '</small></div><div class="r">' + (m.diff ? '<span class="neg">' + esc(signed(m.diff)) + '</span>' : tie(true, 'ties out')) + '</div></li></ul>';
  }
  function openTxn(id) {
    drawer(function () {
      var t = IX.t[id]; if (!t) return null;
      var m = E.used[t.id], po = t.payout ? IX.p[t.payout] : null, bl = IX.bankByTxn[t.id];
      var raw = t.raw ? '<h3>Raw Klarna settlement line</h3><div class="notice"><div>amount_minor <b>' + esc(t.raw.amount_minor) + '</b> (unsigned, cents) · type <b>' + esc(t.raw.type) + '</b> · fee_minor <b>' + esc(t.raw.fee_minor) + '</b><br>Shown here as signed EUR: ' + amt(t.gross) + ' (' + (t.raw.type === 'SALE' ? 'sale = +' : 'return/chargeback = −') + ')</div></div>' : '';
      var body = '<div class="minis"><div class="mini"><span>Gross</span><b>' + amt(t.gross) + '</b></div><div class="mini"><span>Fee</span><b>' + amt(-t.fee) + '</b></div><div class="mini"><span>Net</span><b>' + amt(t.gross - t.fee) + '</b></div></div>' +
        metaGrid([['Provider', esc(PROV[t.provider].name)], ['Account', esc(ACC[t.account].name)], ['Type', esc(typeLabel(t.type))], ['Date', fdate(t.date) + ' ' + esc(t.time)], ['Method', esc(methodLabel(t))],
          ['Reference', esc(t.ref || '(none)')], t.email ? ['E-mail', esc(t.email)] : null, t.payer ? ['Payer', esc(t.payer)] : null, t.iban ? ['IBAN (demo)', esc(t.iban)] : null, t.parcel ? ['Parcel', esc(t.parcel)] : null,
          t.origCurrency ? ['Original amount', esc(NF2.format(t.origAmount / 100) + ' ' + t.origCurrency)] : null, t.reason ? ['Chargeback reason', esc(t.reason)] : null,
          ['Payout', po ? pLink(po) + '<small class="cell-sub">' + fdate(po.date) + '</small>' : '<span class="muted">Not yet paid out</span>'], bl ? ['Bank line', fdate(bl.date) + ' · ' + eur(bl.amount)] : null]) +
        raw + matchBlock(m) + exList(E.exByTxn[t.id]) +
        (!m && E.sT[t.id] ? '<p class="hint">A suggestion exists for this payment on the Reconcile tab.</p>' : '') +
        (!m ? '<div class="dr-actions"><button type="button" class="btn" data-act="toWb" data-t="' + t.id + '">' + ic('link') + 'Match in workbench</button></div>' : '');
      return { eyebrow: '<span class="eyebrow">' + esc(PROV[t.provider].name) + ' · ' + esc(t.id) + '</span>', title: esc(typeLabel(t.type)) + ' ' + amt(t.gross), sub: '<p class="sub">' + esc(t.ref || 'No reference') + '</p>', body: body };
    });
  }
  ACT.txn = function (d) { openTxn(d.id); };
  ACT.toWb = function (d) { selT = {}; selO = {}; if (d.t) selT[d.t] = 1; if (d.o) selO[d.o] = 1; stW.cand = false; saveUi(); closeAll(); go('#/reconcile/workbench'); };
  function openOrder(id) {
    drawer(function () {
      var o = IX.o[id]; if (!o) return null;
      var ms = E.byOrder[o.id] || [];
      var pay = ms.filter(function (m) { return m.kind === 'payment'; })[0];
      var paid = 0, refunded = 0, cb = 0;
      ms.forEach(function (m) { m.txnIds.forEach(function (tid) { var t = IX.t[tid]; if (t.type === 'capture') paid += m.orderIds.length > 1 ? 0 : t.gross; else if (t.type === 'refund') refunded += t.gross; else cb += t.gross; }); });
      if (pay && pay.orderIds.length > 1) paid = o.amount + 0; // one payment for several orders: this order's share
      var body = '<div class="minis"><div class="mini"><span>Order total</span><b>' + amt(o.amount) + '</b></div><div class="mini"><span>Paid</span><b>' + amt(paid) + '</b></div><div class="mini"><span>Refunded / CB</span><b>' + amt(refunded + cb) + '</b></div></div>' +
        metaGrid([['Shop', esc(SHOP[o.shop].name)], ['Date', fdate(o.date) + ' ' + esc(o.time)], ['Invoice', esc(o.inv)], ['Payment method', esc(PROV[o.provider].name)], ['Customer', esc(o.name)], ['E-mail', esc(o.email)], ['Shop status', o.markedPaid ? 'Marked paid' : 'Awaiting payment'],
          ['Credit notes', o.cns.length ? o.cns.map(function (c) { return esc(c.no) + ' · ' + eur(-c.amount) + ' · ' + fdate(c.date); }).join('<br>') : '<span class="muted">None</span>']]) +
        '<h3>Linked transactions</h3>' + (ms.length ? '<ul class="list">' + ms.map(function (m) {
          return m.txnIds.map(function (tid) { var t = IX.t[tid]; return '<li><div class="l">' + tLink(t) + ' ' + confBadge(m.conf) + '<small>' + txnLine(t) + '</small></div><div class="r">' + amt(t.gross) + '</div></li>'; }).join('');
        }).join('') + '</ul>' : '<p class="muted" style="margin:0">No payments linked.</p>') +
        exList(E.exByOrder[o.id]) +
        (!pay ? '<div class="dr-actions"><button type="button" class="btn" data-act="toWb" data-o="' + o.id + '">' + ic('link') + 'Match in workbench</button></div>' : '');
      return { eyebrow: '<span class="eyebrow">Order · ' + esc(SHOP[o.shop].name) + '</span>', title: esc(o.no) + ' ' + amt(o.amount), sub: '<p class="sub">' + esc(o.name) + ' · ' + esc(o.email) + '</p>', body: body };
    });
  }
  ACT.order = function (d) { openOrder(d.id); };
  ACT.match = function (d) {
    drawer(function () {
      var m = E.mByKey[d.id]; if (!m) return null;
      var hist = S.log.filter(function (l) { return l.ref === m.key; });
      var body = '<div class="minis"><div class="mini"><span>Paid</span><b>' + amt(m.sumT) + '</b></div><div class="mini"><span>' + (m.kind === 'payment' ? 'Order total' : 'Kind') + '</span><b>' + (m.kind === 'payment' ? amt(m.sumO) : esc(m.kind)) + '</b></div><div class="mini"><span>Difference</span><b>' + (m.diff ? '<span class="neg">' + esc(signed(m.diff)) + '</span>' : '0,00 €') + '</b></div></div>' +
        '<h3>Why</h3><div class="chips">' + confBadge(m.conf) + m.reasons.map(function (r) { return '<span class="rs">' + esc(r) + '</span>'; }).join('') + '</div>' +
        metaGrid([['Decided by', m.src === 'auto' ? 'Auto-match (reference)' : esc(m.by || 'you')], ['When', m.src === 'auto' ? '—' : fts(m.at)], m.reason ? ['Reason', esc(m.reason)] : null, m.note ? ['Note', esc(m.note)] : null]) +
        '<h3>Payments</h3><ul class="list">' + m.txnIds.map(function (id) { var t = IX.t[id]; return '<li><div class="l">' + tLink(t) + '<small>' + txnLine(t) + '</small></div><div class="r">' + amt(t.gross) + '</div></li>'; }).join('') + '</ul>' +
        '<h3>Orders</h3><ul class="list">' + m.orderIds.map(function (id) { var o = IX.o[id]; return '<li><div class="l">' + oLink(o) + '<small>' + orderLine(o) + ' · ' + esc(o.name) + '</small></div><div class="r">' + amt(o.amount) + '</div></li>'; }).join('') + '</ul>' +
        (hist.length ? '<h3>History</h3><ul class="hist">' + hist.map(function (l) { return '<li>' + esc(l.txt) + '<small>' + esc(l.by) + ' · ' + fts(l.at) + (l.note ? ' · “' + esc(l.note) + '”' : '') + '</small></li>'; }).join('') + '</ul>' : '') +
        '<div class="dr-actions"><button type="button" class="btn" data-act="unmatch" data-id="' + esc(m.key) + '">' + ic('unlink') + 'Unmatch…</button></div>';
      return { eyebrow: '<span class="eyebrow">Match · ' + esc(m.kind) + '</span>', title: esc(m.orderIds.map(function (id) { return IX.o[id].no; }).join(' + ')), body: body };
    });
  };

  // ════════════════════════════════════════════════════════════════════════
  // Exceptions
  // ════════════════════════════════════════════════════════════════════════
  PAGERS.ex = stE;
  function exRows() {
    var q = norm(stE.q);
    var rows = E.EX.filter(function (x) {
      if (stE.type && x.type !== stE.type) return false;
      if (stE.status === 'active' && !isActive(x)) return false;
      if (stE.status && stE.status !== 'active' && stE.status !== 'all' && x.status !== stE.status) return false;
      if (stE.owner === '-' && x.owner) return false;
      if (stE.owner && stE.owner !== '-' && x.owner !== stE.owner) return false;
      if (stE.age === '0' && x.age > 2) return false;
      if (stE.age === '3' && (x.age < 3 || x.age > 7)) return false;
      if (stE.age === '8' && (x.age < 8 || x.age > 30)) return false;
      if (stE.age === '31' && x.age < 31) return false;
      if (q && norm(x.title + ' ' + x.detail + ' ' + EXT[x.type] + ' ' + eur(x.amount) + ' ' + x.owner + ' ' + x.notes.map(function (n) { return n.text; }).join(' ')).indexOf(q) < 0) return false;
      return true;
    });
    var k = stE.sort, dir = stE.dir;
    rows.sort(function (a, b) {
      var va = k === 'amount' ? Math.abs(a.amount) : k === 'type' ? EXT[a.type] : a.age, vb = k === 'amount' ? Math.abs(b.amount) : k === 'type' ? EXT[b.type] : b.age;
      return (va < vb ? -1 : va > vb ? 1 : a.id < b.id ? -1 : 1) * dir;
    });
    return rows;
  }
  function ownerOpts(sel, any) { var me = who(); var os = [me].concat(D.OWNERS.filter(function (o) { return o !== me; })); return (any ? opt('', 'Any owner', sel) + opt('-', 'Unassigned', sel) : opt('', 'Unassigned', sel)) + os.map(function (o) { return opt(o, o === me ? o + ' (me)' : o, sel); }).join(''); }
  var exSel = {};
  function sortTh(k, label, cls) {
    var on = stE.sort === k;
    return '<th' + (cls ? ' class="' + cls + '"' : '') + (on ? ' aria-sort="' + (stE.dir > 0 ? 'ascending' : 'descending') + '"' : '') + '><button type="button" data-act="exSort" data-k="' + k + '" data-fid="exs-' + k + '">' + esc(label) + (on ? (stE.dir > 0 ? ' ↑' : ' ↓') : '') + '</button></th>';
  }
  ACT.exSort = function (d) { if (stE.sort === d.k) stE.dir = -stE.dir; else { stE.sort = d.k; stE.dir = d.k === 'type' ? 1 : -1; } saveUi(); rerender(); };
  function pageExceptions() {
    var rows = exRows(), SZ = 50;
    Object.keys(exSel).forEach(function (id) { if (!rows.some(function (x) { return x.id === id; })) delete exSel[id]; });
    var all = E.EX, cnt = { open: 0, waiting: 0, resolved: 0, written_off: 0 };
    all.forEach(function (x) { cnt[x.status] = (cnt[x.status] || 0) + 1; });
    var h = head('Exceptions', 'Exception queue<span class="dot">.</span>', 'Detected automatically from the matching state. Give each one an owner, a status and notes; resolved or written-off items count as reconciled at month close.',
      '<button type="button" class="btn" data-act="csvEx">' + ic('exp') + 'Export CSV</button>');
    h += '<div class="toolbar">' + seg('ex', 'status', stE.status, [['active', 'Active · ' + (cnt.open + cnt.waiting)], ['open', 'Open · ' + cnt.open], ['waiting', 'Waiting · ' + cnt.waiting], ['resolved', 'Resolved · ' + cnt.resolved], ['written_off', 'Written off · ' + cnt.written_off], ['all', 'All']], 'Status') + '</div>';
    h += '<div class="toolbar">' + search('ex', 'q', stE.q, 'Search reference, note, owner, amount') +
      sel('ex', 'type', opt('', 'All types', stE.type) + Object.keys(EXT).map(function (k) { return opt(k, EXT[k], stE.type); }).join(''), 'Type') +
      sel('ex', 'owner', ownerOpts(stE.owner, true), 'Owner') +
      sel('ex', 'age', opt('', 'Any age', stE.age) + opt('0', '0–2 days', stE.age) + opt('3', '3–7 days', stE.age) + opt('8', '8–30 days', stE.age) + opt('31', 'Over 30 days', stE.age), 'Age') + '</div>';
    var nSel = Object.keys(exSel).length;
    var tot = 0; rows.forEach(function (x) { tot += x.amount; });
    h += '<section class="card"><div class="stats"><span><b>' + num(rows.length) + '</b> exceptions</span><span>Signed total <b>' + eur(tot) + '</b></span>' +
      (nSel ? '<span style="margin-left:auto;display:flex;gap:6px;flex-wrap:wrap"><b>' + nSel + ' selected</b><button type="button" class="btn sm" data-act="exBulk">Set status / owner…</button><button type="button" class="btn sm ghost" data-act="exClear">Clear</button></span>' : '') + '</div>';
    if (!rows.length) return h + empty(all.length ? 'No exceptions match these filters.' : 'No exceptions. Everything ties out.') + '</section>';
    var page = rows.slice(stE.page * SZ, stE.page * SZ + SZ);
    var allOn = page.every(function (x) { return exSel[x.id]; });
    h += '<div class="tw"><table class="t"><thead><tr><th class="chk"><input type="checkbox" data-chg="exAll" data-fid="ex-all" aria-label="Select all on this page"' + (allOn ? ' checked' : '') + '></th>' + sortTh('type', 'Type') + '<th>Item</th><th>Provider</th>' + sortTh('amount', 'Amount', 'num') + sortTh('age', 'Age', 'num') + '<th>Owner</th><th>Status</th><th>Last note</th></tr></thead><tbody>' +
      page.map(function (x) {
        var last = x.notes[x.notes.length - 1];
        return '<tr class="click' + (exSel[x.id] ? ' sel' : '') + '" data-open="ex:' + esc(x.id) + '" tabindex="0" data-fid="exr-' + esc(x.id) + '"><td class="chk"><input type="checkbox" data-chg="exSel" data-id="' + esc(x.id) + '" data-fid="exc-' + esc(x.id) + '" aria-label="Select ' + esc(x.title) + '"' + (exSel[x.id] ? ' checked' : '') + '></td>' +
          '<td class="nw">' + esc(EXT[x.type]) + (x.sub ? '<small>' + esc(x.sub) + '</small>' : '') + '</td><td>' + esc(x.title) + '<small>' + esc(x.detail) + (x.cleared ? ' · condition cleared' : '') + '</small></td>' +
          '<td>' + provBadge(x.provider) + '</td><td class="num">' + amt(x.amount) + '</td><td class="num">' + x.age + ' d</td><td class="nw">' + (x.owner ? esc(x.owner) : '<span class="muted">Unassigned</span>') + '</td><td>' + exBadge(x.status) + '</td>' +
          '<td>' + (last ? esc(last.text.length > 60 ? last.text.slice(0, 58) + '…' : last.text) + '<small>' + esc(last.by) + ' · ' + fts(last.at) + '</small>' : '<span class="muted">—</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div>' + pager(rows.length, stE, SZ, 'ex') + '</section>';
    return h;
  }
  CHG.exSel = function (el) { if (el.checked) exSel[el.getAttribute('data-id')] = 1; else delete exSel[el.getAttribute('data-id')]; rerender(); };
  CHG.exAll = function (el) { var rows = exRows().slice(stE.page * 50, stE.page * 50 + 50); rows.forEach(function (x) { if (el.checked) exSel[x.id] = 1; else delete exSel[x.id]; }); rerender(); };
  ACT.exClear = function () { exSel = {}; rerender(); };
  // write status/owner/note for one exception (keeps a snapshot so it stays visible if the condition clears)
  function setEx(x, patch, note) {
    var cur = S.ex[x.id] || { status: 'open', owner: '', notes: [] };
    var parts = [];
    if (patch.status && patch.status !== cur.status) { parts.push(EXS[cur.status || 'open'][0] + ' → ' + EXS[patch.status][0]); cur.status = patch.status; }
    if ('owner' in patch && patch.owner !== cur.owner) { parts.push('owner ' + (patch.owner || 'unassigned')); cur.owner = patch.owner; }
    cur.notes = (cur.notes || []).slice();
    if (note) cur.notes.push({ by: who(), at: nowIso(), text: note });
    if (!parts.length && !note) return false;
    cur.by = who(); cur.at = nowIso(); cur.snap = snapOf(x);
    S.ex[x.id] = cur;
    logIt('exception', EXT[x.type] + ' ' + x.title + (parts.length ? ' · ' + parts.join(' · ') : ' · note added'), note, x.id);
    return true;
  }
  function exById(id) { for (var i = 0; i < E.EX.length; i++) if (E.EX[i].id === id) return E.EX[i]; return null; }
  ACT.exBulk = function () {
    var ids = Object.keys(exSel);
    modal({
      title: 'Update ' + ids.length + ' exceptions', submitLabel: 'Apply',
      body: field('Status', '<select class="in" id="%ID%" name="status" data-autofocus>' + opt('', 'Keep as is', '') + Object.keys(EXS).map(function (k) { return opt(k, EXS[k][0], ''); }).join('') + '</select>') +
        field('Owner', '<select class="in" id="%ID%" name="owner">' + opt('*', 'Keep as is', '*') + ownerOpts('', false) + '</select>') +
        field('Note', '<textarea class="in" id="%ID%" name="note" rows="2"></textarea>', 'Required when writing off.'),
      onSubmit: function (f) {
        var st = f.elements.status.value, ow = f.elements.owner.value, note = f.elements.note.value.trim();
        if (st === 'written_off' && !note) { f.elements.note.focus(); return 'Add a note that explains the write-off.'; }
        var patch = {}; if (st) patch.status = st; if (ow !== '*') patch.owner = ow;
        var n = 0;
        ids.forEach(function (id) { var x = exById(id); if (x && setEx(x, patch, note)) n++; });
        exSel = {};
        setTimeout(function () { commit('Updated ' + n + ' exception' + (n === 1 ? '' : 's')); }, 0);
        return null;
      }
    });
  };
  ACT.csvEx = function () {
    downloadCsv('recon-exceptions', ['Exception id', 'Type', 'Detail', 'Item', 'Description', 'Provider', 'Amount EUR', 'Item date', 'Age days', 'Owner', 'Status', 'Last updated by', 'Last updated at', 'Notes'], exRows().map(function (x) {
      return [x.id, EXT[x.type], x.sub || '', x.title, x.detail, PROV[x.provider] ? PROV[x.provider].name : x.provider, cc(x.amount), x.date, x.age, x.owner, EXS[x.status][0], x.updatedBy || '', x.updatedAt || '', x.notes.map(function (n) { return n.by + ' ' + n.at + ': ' + n.text; }).join(' | ')];
    }));
  };
  function openEx(id) {
    drawer(function () {
      var x = exById(id); if (!x) return null;
      var links = x.txnIds.map(function (tid) { var t = IX.t[tid]; return '<li><div class="l">' + tLink(t) + '<small>' + txnLine(t) + '</small></div><div class="r">' + amt(t.gross) + '</div></li>'; }).join('') +
        x.orderIds.map(function (oid) { var o = IX.o[oid]; return '<li><div class="l">' + oLink(o) + '<small>' + orderLine(o) + ' · ' + esc(o.name) + '</small></div><div class="r">' + amt(o.amount) + '</div></li>'; }).join('') +
        (x.payoutId ? '<li><div class="l">' + pLink(IX.p[x.payoutId]) + '<small>' + esc(ACC[IX.p[x.payoutId].account].name) + ' payout · ' + fdate(IX.p[x.payoutId].date) + '</small></div><div class="r">' + amt(IX.p[x.payoutId].net) + '</div></li>' : '') +
        (x.bankId ? '<li><div class="l"><b style="font-weight:500">Bank line ' + esc(IX.b[x.bankId].text) + '</b><small>' + fdate(IX.b[x.bankId].date) + ' · ' + esc(IX.b[x.bankId].counterparty) + '</small></div><div class="r">' + amt(IX.b[x.bankId].amount) + '</div></li>' : '');
      var HINT = {
        no_order: 'Find the order (phone order, deleted order, B2B customer?) and match it in the workbench, or refund the customer.',
        double_paid: 'Refund the duplicate payment to the customer in the provider portal, then resolve.',
        amount_diff: 'Rounding and currency differences are usually written off; a partial capture needs the shop to correct the invoice.',
        refund_no_cn: 'Ask the shop to issue the credit note for this refund.',
        chargeback: 'Submit dispute evidence in the provider portal before the deadline; resolve when the outcome is known.',
        payout_missing: 'Ask the provider for the payout trace (bank reference) and check the bank statement again.',
        payout_diff: 'Usually a bank or provider charge outside the report; post the difference as a bank fee.',
        paid_no_payment: 'The shop shows the order as paid but no payment arrived. Check the carrier / customer and correct the order status.',
        bank_unknown: 'Ask the provider what the credit is (e.g. a reserve release) and post it.'
      };
      var body = '<div class="minis"><div class="mini"><span>Amount</span><b>' + amt(x.amount) + '</b></div><div class="mini"><span>Age</span><b>' + x.age + ' days</b></div><div class="mini"><span>Status</span><b>' + esc(EXS[x.status][0]) + '</b></div></div>' +
        '<div class="notice" style="margin-top:14px">' + esc(HINT[x.type] || '') + '</div>' +
        (x.cleared ? '<div class="notice ok">The condition behind this exception has cleared (for example the payment was matched later).</div>' : '') +
        '<h3>Status</h3><div class="seg" role="group" aria-label="Status">' + Object.keys(EXS).map(function (k) { return '<button type="button" data-act="exStatus" data-id="' + esc(x.id) + '" data-v="' + k + '" data-fid="exst-' + k + '" aria-pressed="' + (x.status === k ? 'true' : 'false') + '">' + esc(EXS[k][0]) + '</button>'; }).join('') + '</div>' +
        '<h3>Owner</h3>' + '<label class="sr" for="exOwner">Owner</label><select class="select" id="exOwner" data-chg="exOwner" data-id="' + esc(x.id) + '">' + ownerOpts(x.owner, false) + '</select>' +
        '<h3>Linked items</h3>' + (links ? '<ul class="list">' + links + '</ul>' : '<p class="muted" style="margin:0">—</p>') +
        (x.type === 'no_order' && !x.cleared ? '<div class="dr-actions"><button type="button" class="btn" data-act="toWb" data-t="' + esc(x.txnIds[0]) + '">' + ic('link') + 'Find the order in the workbench</button></div>' : '') +
        (x.type === 'paid_no_payment' && !x.cleared ? '<div class="dr-actions"><button type="button" class="btn" data-act="toWb" data-o="' + esc(x.orderIds[0]) + '">' + ic('link') + 'Look for the payment in the workbench</button></div>' : '') +
        '<h3>Notes</h3>' + (x.notes.length ? '<ul class="hist">' + x.notes.slice().reverse().map(function (n) { return '<li>' + esc(n.text) + '<small>' + esc(n.by) + ' · ' + fts(n.at) + '</small></li>'; }).join('') + '</ul>' : '<p class="muted" style="margin:0 0 8px">No notes yet.</p>') +
        '<form class="field" data-exnote="' + esc(x.id) + '" style="margin-top:8px"><label for="exNote">Add a note</label><textarea class="in" id="exNote" name="note" rows="2" placeholder="What did you do or find out?"></textarea><div><button type="submit" class="btn sm">Add note</button></div></form>';
      return { eyebrow: '<span class="eyebrow">' + esc(EXT[x.type]) + (x.sub ? ' · ' + esc(x.sub) : '') + '</span>', title: esc(x.title), sub: '<p class="sub">' + esc(x.detail) + '</p>', body: body };
    });
  }
  ACT.ex = function (d) { openEx(d.id); };
  ACT.exStatus = function (d) {
    var x = exById(d.id); if (!x || x.status === d.v) return;
    if (d.v === 'written_off') {
      modal({ title: 'Write off?', submitLabel: 'Write off', body: '<p>' + esc(EXT[x.type]) + ' · ' + esc(x.title) + ' · ' + esc(eur(x.amount)) + '</p>' + field('Note (required)', '<textarea class="in" id="%ID%" name="note" rows="2" data-autofocus placeholder="Why, and which account it was posted to"></textarea>'),
        onSubmit: function (f) { var n = f.elements.note.value.trim(); if (!n) return 'A write-off needs a note.'; setEx(x, { status: 'written_off' }, n); setTimeout(function () { commit('Written off'); }, 0); return null; } });
      return;
    }
    setEx(x, { status: d.v }); commit('Status: ' + EXS[d.v][0]);
  };
  CHG.exOwner = function (el) { var x = exById(el.getAttribute('data-id')); if (!x) return; setEx(x, { owner: el.value }); commit(el.value ? 'Assigned to ' + el.value : 'Unassigned'); };
  document.addEventListener('submit', function (e) {
    var f = e.target.closest('form[data-exnote]'); if (!f) return;
    e.preventDefault();
    var x = exById(f.getAttribute('data-exnote')), n = f.elements.note.value.trim();
    if (!x || !n) { f.elements.note.focus(); return; }
    f.elements.note.value = '';
    setEx(x, {}, n); commit('Note added');
    var t = $('exNote'); if (t) t.focus();
  });

  // ════════════════════════════════════════════════════════════════════════
  // Payouts and bank statement
  // ════════════════════════════════════════════════════════════════════════
  PAGERS.po = stP; PAGERS.bk = stB;
  function payoutRows() {
    var q = norm(stP.q);
    return B.payouts.filter(function (p) {
      if (stP.acc && p.account !== stP.acc && p.provider !== stP.acc) return false;
      if (stP.month && !inMonth(p.date, stP.month)) return false;
      if (stP.status && payoutStatus(p).code !== stP.status) return false;
      if (q && norm(p.batch + ' ' + ACC[p.account].name).indexOf(q) < 0) return false;
      return true;
    }).slice().reverse();
  }
  function pagePayouts() {
    var sub = route.sub === 'bank' ? 'bank' : 'payouts';
    var h = head('Payouts', 'Payouts and bank<span class="dot">.</span>', 'Every provider settlement batch with its lines, checked against the demo bank statement. Gross − fees = net must tie out for each batch and in total.',
      '<button type="button" class="btn" data-act="' + (sub === 'bank' ? 'csvBank' : 'csvPayouts') + '">' + ic('exp') + 'Export CSV</button>');
    h += '<nav class="seg" aria-label="Payout views" style="margin-bottom:14px"><a href="#/payouts"' + (sub === 'payouts' ? ' aria-current="page"' : '') + '>Payout batches · ' + B.payouts.length + '</a><a href="#/payouts/bank"' + (sub === 'bank' ? ' aria-current="page"' : '') + '>Bank statement · ' + B.bank.length + '</a></nav>';
    return h + (sub === 'bank' ? viewBank() : viewPayouts());
  }
  function accOpts(sel) { return opt('', 'All accounts', sel) + D.PROVIDERS.filter(function (p) { return p.id !== 'bank'; }).map(function (p) { var as = D.ACCOUNTS.filter(function (a) { return a.provider === p.id; }); return as.length > 1 ? '<optgroup label="' + esc(p.name) + '">' + opt(p.id, 'All ' + p.name, sel) + as.map(function (a) { return opt(a.id, a.name, sel); }).join('') + '</optgroup>' : opt(as[0].id, as[0].name, sel); }).join(''); }
  function viewPayouts() {
    var rows = payoutRows(), SZ = 50;
    var g = 0, f = 0, n = 0, bk = 0, cnt = { arrived: 0, transit: 0, missing: 0, diff: 0 };
    rows.forEach(function (p) { g += p.gross; f += p.fees; n += p.net; var s = payoutStatus(p); cnt[s.code]++; if (s.bank) bk += s.bank.amount; });
    var h = '<div class="toolbar">' + search('po', 'q', stP.q, 'Batch id') + sel('po', 'acc', accOpts(stP.acc), 'Account') + sel('po', 'month', monthOpts(stP.month, 'All months'), 'Payout month') +
      sel('po', 'status', opt('', 'Any bank status', stP.status) + Object.keys(PST).map(function (k) { return opt(k, PST[k][0], stP.status); }).join(''), 'Bank status') + '</div>';
    h += '<section class="card"><div class="stats"><span><b>' + num(rows.length) + '</b> batches</span><span>Arrived <b>' + cnt.arrived + '</b></span><span>In transit <b>' + cnt.transit + '</b></span><span>Missing <b class="' + (cnt.missing ? 'neg' : '') + '">' + cnt.missing + '</b></span><span>Amount differs <b class="' + (cnt.diff ? 'neg' : '') + '">' + cnt.diff + '</b></span><span>' + tie(g - f === n, 'gross − fees = net') + '</span></div>';
    if (!rows.length) return h + empty('No payouts match these filters.') + '</section>';
    h += '<div class="tw"><table class="t"><thead><tr><th>Payout date</th><th>Account</th><th>Batch</th><th>Period</th><th class="num">Lines</th><th class="num">Gross</th><th class="num">Fees</th><th class="num">Net</th><th>Bank</th><th class="num">Bank amount</th><th>Status</th></tr></thead><tbody>' +
      rows.slice(stP.page * SZ, stP.page * SZ + SZ).map(function (p) {
        var s = payoutStatus(p);
        return '<tr class="click" data-open="payout:' + p.id + '" tabindex="0" data-fid="por-' + p.id + '"><td class="nw">' + fdate(p.date) + '</td><td class="nw">' + esc(ACC[p.account].name) + '</td><td class="nw">' + esc(p.batch) + '</td><td class="nw">' + fdate(p.from) + (p.to !== p.from ? '–' + fdate(p.to) : '') + '</td>' +
          '<td class="num">' + p.count + '</td><td class="num">' + amt(p.gross) + '</td><td class="num">' + amt(-p.fees) + '</td><td class="num"><b style="font-weight:500">' + amt(p.net) + '</b></td>' +
          '<td class="nw">' + (s.bank ? fdate(s.bank.date) : '<span class="muted">exp. ' + fdate(s.expected) + '</span>') + '</td><td class="num">' + (s.bank ? amt(s.bank.amount) : '<span class="muted">—</span>') + '</td><td>' + badge(PST[s.code][0], PST[s.code][1]) + '</td></tr>';
      }).join('') + '</tbody><tfoot><tr><td colspan="5">Total (' + num(rows.length) + ' batches, all pages)</td><td class="num">' + amt(g) + '</td><td class="num">' + amt(-f) + '</td><td class="num">' + amt(n) + '</td><td></td><td class="num">' + amt(bk) + '</td><td></td></tr></tfoot></table></div>' + pager(rows.length, stP, SZ, 'po') + '</section>';
    return h;
  }
  ACT.payout = function (d) {
    drawer(function () {
      var p = IX.p[d.id]; if (!p) return null;
      var s = payoutStatus(p), lines = p.lines.map(function (id) { return IX.t[id]; });
      var g = 0, f = 0; lines.forEach(function (t) { g += t.gross; f += t.fee; });
      var unm = lines.filter(function (t) { return !E.used[t.id]; }).length;
      var body = '<div class="minis"><div class="mini"><span>Gross</span><b>' + amt(p.gross) + '</b></div><div class="mini"><span>Fees</span><b>' + amt(-p.fees) + '</b></div><div class="mini"><span>Net</span><b>' + amt(p.net) + '</b></div></div>' +
        '<h3>Checks</h3><div class="chips" style="gap:8px 14px">' + tie(g === p.gross, 'Σ lines gross = ' + eur(g)) + tie(f === p.fees, 'Σ line fees = ' + eur(f)) + tie(p.gross - p.fees === p.net, 'gross − fees = net') +
        (s.bank ? tie(s.bank.amount === p.net, 'bank ' + eur(s.bank.amount) + (s.bank.amount === p.net ? ' = net' : ' ≠ net (' + signed(s.bank.amount - p.net) + ')')) : tie(s.code === 'transit', s.code === 'transit' ? 'in transit, expected ' + fdate(s.expected) : 'not on the bank, expected ' + fdate(s.expected))) +
        tie(!unm, unm ? unm + ' lines not matched to orders' : 'all lines matched to orders') + '</div>' +
        metaGrid([['Account', esc(ACC[p.account].name)], ['Batch', esc(p.batch)], ['Period', fdate(p.from) + ' – ' + fdate(p.to)], ['Payout date', fdate(p.date)], ['Bank', s.bank ? fdate(s.bank.date) + ' · ' + esc(s.bank.text) : '—'], ['Status', badge(PST[s.code][0], PST[s.code][1])]]) +
        exList(E.exByPayout[p.id]) +
        '<h3>Lines · ' + lines.length + '</h3><div class="tw"><table class="t compact"><thead><tr><th>Date</th><th>Type</th><th>Reference</th><th>Order</th><th class="num">Gross</th><th class="num">Fee</th><th class="num">Net</th></tr></thead><tbody>' +
        lines.map(function (t) { var m = E.used[t.id]; return '<tr><td class="nw">' + fdate(t.date) + '</td><td>' + esc(typeLabel(t.type)) + '</td><td>' + tLink(t) + '</td><td>' + (m ? m.orderIds.map(function (id) { return oLink(IX.o[id]); }).join(' ') : '<span class="neg">unmatched</span>') + '</td><td class="num">' + amt(t.gross) + '</td><td class="num">' + amt(-t.fee) + '</td><td class="num">' + amt(t.gross - t.fee) + '</td></tr>'; }).join('') +
        '</tbody><tfoot><tr><td colspan="4">Total</td><td class="num">' + amt(g) + '</td><td class="num">' + amt(-f) + '</td><td class="num">' + amt(g - f) + '</td></tr></tfoot></table></div>' +
        '<div class="dr-actions"><button type="button" class="btn" data-act="csvLines" data-id="' + p.id + '">' + ic('exp') + 'Lines CSV</button></div>';
      return { wide: true, eyebrow: '<span class="eyebrow">Payout · ' + esc(ACC[p.account].name) + '</span>', title: esc(p.batch), sub: '<p class="sub">Paid out ' + fdate(p.date) + ' · ' + p.count + ' lines</p>', body: body };
    });
  };
  ACT.csvLines = function (d) {
    var p = IX.p[d.id];
    downloadCsv('recon-payout-' + p.batch.replace(/[^A-Za-z0-9-]+/g, '-'), ['Batch', 'Transaction', 'Date', 'Type', 'Reference', 'Orders', 'Method', 'Gross EUR', 'Fee EUR', 'Net EUR'], p.lines.map(function (id) {
      var t = IX.t[id], m = E.used[t.id];
      return [p.batch, t.id, t.date, typeLabel(t.type), t.ref, m ? m.orderIds.map(function (x) { return IX.o[x].no; }).join(' | ') : '', methodLabel(t), cc(t.gross), cc(t.fee), cc(t.gross - t.fee)];
    }));
  };
  ACT.csvPayouts = function () {
    downloadCsv('recon-payouts', ['Payout date', 'Account', 'Provider', 'Batch', 'Period from', 'Period to', 'Lines', 'Gross EUR', 'Fees EUR', 'Net EUR', 'Bank date', 'Bank amount EUR', 'Difference EUR', 'Status'], payoutRows().map(function (p) {
      var s = payoutStatus(p);
      return [p.date, ACC[p.account].name, PROV[p.provider].name, p.batch, p.from, p.to, p.count, cc(p.gross), cc(p.fees), cc(p.net), s.bank ? s.bank.date : '', s.bank ? cc(s.bank.amount) : '', s.bank ? cc(s.bank.amount - p.net) : '', PST[s.code][0]];
    }));
  };
  function bankRows() {
    var q = norm(stB.q);
    return B.bank.filter(function (b) {
      if (stB.kind && b.kind !== stB.kind) return false;
      if (stB.month && !inMonth(b.date, stB.month)) return false;
      if (q && norm(b.counterparty + ' ' + b.text + ' ' + eur(b.amount)).indexOf(q) < 0) return false;
      return true;
    }).slice().reverse();
  }
  var BK = { payout: ['Provider payout', 'b-violet'], customer: ['Customer transfer', 'b-teal'], refund: ['Refund to customer', 'b-clay'], unknown: ['Unexplained', 'b-bad'] };
  function viewBank() {
    var rows = bankRows(), SZ = 60, cr = 0, db = 0;
    rows.forEach(function (b) { if (b.amount >= 0) cr += b.amount; else db += b.amount; });
    var h = '<div class="notice">Demo bank account <b>SI56 0000 0000 0000 000</b> (fictional). Provider payouts are matched to batches by reference; customer transfers are the “Bank transfer” payments matched on the Reconcile tab.</div>';
    h += '<div class="toolbar">' + search('bk', 'q', stB.q, 'Counterparty, text, amount') + sel('bk', 'kind', opt('', 'All lines', stB.kind) + Object.keys(BK).map(function (k) { return opt(k, BK[k][0], stB.kind); }).join(''), 'Line kind') + sel('bk', 'month', monthOpts(stB.month, 'All months'), 'Month') + '</div>';
    h += '<section class="card"><div class="stats"><span><b>' + num(rows.length) + '</b> lines</span><span>Credits <b>' + eur(cr) + '</b></span><span>Debits <b>' + eur(db) + '</b></span><span>Net <b>' + eur(cr + db) + '</b></span></div>';
    if (!rows.length) return h + empty('No bank lines match these filters.') + '</section>';
    h += '<div class="tw"><table class="t"><thead><tr><th>Date</th><th>Counterparty</th><th>Text</th><th>Kind</th><th>Linked to</th><th class="num">Amount</th></tr></thead><tbody>' +
      rows.slice(stB.page * SZ, stB.page * SZ + SZ).map(function (b) {
        var link = b.payout ? pLink(IX.p[b.payout]) + (b.amount !== IX.p[b.payout].net ? ' <span class="rs warn">≠ net ' + esc(eur(IX.p[b.payout].net)) + '</span>' : '') : b.txn ? tLink(IX.t[b.txn], E.used[b.txn] ? E.used[b.txn].orderIds.map(function (id) { return IX.o[id].no; }).join(' + ') : 'unmatched') : '<button type="button" class="linkish" data-act="ex" data-id="bank_unknown:' + b.id + '">Exception</button>';
        return '<tr><td class="nw">' + fdate(b.date) + '</td><td>' + esc(b.counterparty) + '</td><td>' + esc(b.text) + '</td><td>' + badge(BK[b.kind][0], BK[b.kind][1]) + '</td><td>' + link + '</td><td class="num">' + amt(b.amount) + '</td></tr>';
      }).join('') + '</tbody></table></div>' + pager(rows.length, stB, SZ, 'bk') + '</section>';
    return h;
  }
  ACT.csvBank = function () {
    downloadCsv('recon-bank-statement', ['Date', 'Counterparty', 'Text', 'Kind', 'Payout batch', 'Transaction', 'Amount EUR'], bankRows().map(function (b) {
      return [b.date, b.counterparty, b.text, BK[b.kind][0], b.payout ? IX.p[b.payout].batch : '', b.txn || '', cc(b.amount)];
    }));
  };

  // ════════════════════════════════════════════════════════════════════════
  // Fees
  // ════════════════════════════════════════════════════════════════════════
  var GROUPS = {
    provider: ['Provider', function (t) { return PROV[t.provider].name; }],
    account: ['Account', function (t) { return ACC[t.account].name; }],
    method: ['Method', function (t) { return D.METHOD_LABEL[t.method]; }],
    brand: ['Card brand', function (t) { return t.brand || '— not a card'; }],
    month: ['Month', function (t) { return t.date.slice(0, 7); }]
  };
  function feeGroups(month, prov, by) {
    var g = {}, tot = { k: 'Total', n: 0, vol: 0, ref: 0, cb: 0, fees: 0 };
    B.txns.forEach(function (t) {
      if (month && !inMonth(t.date, month)) return;
      if (prov && t.provider !== prov) return;
      var k = GROUPS[by][1](t), x = g[k] = g[k] || { k: k, n: 0, vol: 0, ref: 0, cb: 0, fees: 0 };
      [x, tot].forEach(function (y) { y.fees += t.fee; if (t.type === 'capture') { y.n++; y.vol += t.gross; } else if (t.type === 'refund') y.ref += t.gross; else y.cb += t.gross; });
    });
    var rows = Object.keys(g).map(function (k) { return g[k]; });
    rows.sort(by === 'month' ? function (a, b) { return a.k < b.k ? -1 : 1; } : function (a, b) { return b.fees - a.fees; });
    return { rows: rows, tot: tot };
  }
  function pageFees() {
    var by = GROUPS[stF.by] ? stF.by : 'provider';
    var G = feeGroups(stF.month, stF.prov, by);
    var h = head('Fees', 'Provider fees<span class="dot">.</span>', 'What payment providers and carriers charged, by transaction date. Effective rate = fees ÷ captured volume (refund and chargeback fees included in fees).',
      '<button type="button" class="btn" data-act="csvFees">' + ic('exp') + 'Export CSV</button>');
    h += '<div class="toolbar">' + seg('fee', 'by', by, Object.keys(GROUPS).map(function (k) { return [k, GROUPS[k][0]]; }), 'Group by') + sel('fee', 'month', monthOpts(stF.month, 'All 90 days'), 'Month') + sel('fee', 'prov', provOpts(stF.prov), 'Provider') + '</div>';
    // monthly chart (single series, accent) — fees by month for the provider filter
    var MG = feeGroups('', stF.prov, 'month').rows;
    var W = 640, H = 220, pl = 56, pr = 12, pt = 14, pb = 28, max = 1;
    MG.forEach(function (x) { max = Math.max(max, x.fees); });
    var step = Math.pow(10, Math.floor(Math.log10(max / 100))) * 100, nice = Math.ceil(max / step / 4) * step * 4 || 100, bw = (W - pl - pr) / Math.max(1, MG.length);
    var chart = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Fees by month' + (stF.prov ? ' for ' + esc(PROV[stF.prov].name) : '') + '">';
    for (var i = 0; i <= 4; i++) { var y = pt + (H - pt - pb) * (1 - i / 4); chart += '<line class="grid-l" x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y + '" y2="' + y + '"/><text class="ax" x="' + (pl - 8) + '" y="' + (y + 3) + '" text-anchor="end">' + esc(eur0(nice * i / 4)) + '</text>'; }
    MG.forEach(function (x, j) {
      var bh = (H - pt - pb) * x.fees / nice, bx = pl + j * bw + bw * 0.22, w = bw * 0.56, by0 = H - pb - bh;
      chart += '<rect x="' + bx + '" y="' + by0 + '" width="' + w + '" height="' + Math.max(0, bh) + '" rx="4" fill="var(--s1)"/>' +
        '<text class="ax" x="' + (pl + j * bw + bw / 2) + '" y="' + (H - 10) + '" text-anchor="middle">' + esc(monthShort(x.k)) + (x.k === REF.slice(0, 7) ? ' (MTD)' : '') + '</text>' +
        '<rect class="hit" x="' + (pl + j * bw) + '" y="' + pt + '" width="' + bw + '" height="' + (H - pt - pb) + '" data-tip="' + j + '"/>';
    });
    chart += '<line class="base" x1="' + pl + '" x2="' + (W - pr) + '" y1="' + (H - pb) + '" y2="' + (H - pb) + '"/></svg>';
    afterHooks.push(function () { bindTip(MG); });
    var maxR = 0.0001; G.rows.forEach(function (x) { if (x.vol) maxR = Math.max(maxR, x.fees / x.vol); });
    h += '<div class="dash"><section class="card"><div class="card-h"><div><span class="label">' + (stF.prov ? esc(PROV[stF.prov].name) : 'All providers') + '</span><h2>Fees by month</h2></div></div><div class="card-b"><div class="chart" id="feeChart">' + chart + '</div>' +
      '<details class="tbl"><summary>Show as table</summary><div class="tw"><table class="t compact"><thead><tr><th>Month</th><th class="num">Volume</th><th class="num">Fees</th><th class="num">Rate</th></tr></thead><tbody>' + MG.map(function (x) { return '<tr><td>' + esc(monthLabel(x.k)) + '</td><td class="num">' + eur(x.vol) + '</td><td class="num">' + eur(x.fees) + '</td><td class="num">' + rate(x.fees, x.vol) + '</td></tr>'; }).join('') + '</tbody></table></div></details></div></section>' +
      '<section class="card"><div class="card-h"><div><span class="label">' + esc(stF.month ? monthLabel(stF.month) : 'All 90 days') + '</span><h2>Effective rate by ' + esc(GROUPS[by][0].toLowerCase()) + '</h2></div></div><div class="card-b"><ul class="list">' +
      G.rows.filter(function (x) { return x.vol; }).slice(0, 12).map(function (x) { return '<li><div class="l" style="flex:1"><b style="font-weight:500">' + esc(by === 'month' ? monthLabel(x.k) : x.k) + '</b><div class="bar"><i style="width:' + (x.fees / x.vol / maxR * 100) + '%"></i></div></div><div class="r">' + rate(x.fees, x.vol) + '</div></li>'; }).join('') + '</ul></div></section></div>';
    h += '<section class="card"><div class="tw"><table class="t"><thead><tr><th>' + esc(GROUPS[by][0]) + '</th><th class="num">Payments</th><th class="num">Captured volume</th><th class="num">Refunds</th><th class="num">Chargebacks</th><th class="num">Fees</th><th class="num">Effective rate</th><th class="num">Avg fee / payment</th></tr></thead><tbody>' +
      (G.rows.length ? G.rows.map(function (x) {
        return '<tr><td>' + esc(by === 'month' ? monthLabel(x.k) : x.k) + '</td><td class="num">' + num(x.n) + '</td><td class="num">' + amt(x.vol) + '</td><td class="num">' + amt(x.ref) + '</td><td class="num">' + amt(x.cb) + '</td><td class="num"><b style="font-weight:500">' + amt(x.fees) + '</b></td><td class="num">' + rate(x.fees, x.vol) + '</td><td class="num">' + (x.n ? eur(Math.round(x.fees / x.n)) : '—') + '</td></tr>';
      }).join('') : '<tr><td colspan="8">' + empty('No transactions for these filters.') + '</td></tr>') +
      '</tbody><tfoot><tr><td>Total</td><td class="num">' + num(G.tot.n) + '</td><td class="num">' + amt(G.tot.vol) + '</td><td class="num">' + amt(G.tot.ref) + '</td><td class="num">' + amt(G.tot.cb) + '</td><td class="num">' + amt(G.tot.fees) + '</td><td class="num">' + rate(G.tot.fees, G.tot.vol) + '</td><td class="num">' + (G.tot.n ? eur(Math.round(G.tot.fees / G.tot.n)) : '—') + '</td></tr></tfoot></table></div></section>';
    return h;
  }
  function bindTip(MG) {
    var box = $('feeChart'); if (!box) return;
    var tip = document.createElement('div'); tip.className = 'tip'; tip.hidden = true; box.appendChild(tip);
    box.addEventListener('mousemove', function (e) {
      var r = e.target.closest && e.target.closest('[data-tip]');
      box.querySelectorAll('.hit.on').forEach(function (n) { n.classList.remove('on'); });
      if (!r) { tip.hidden = true; return; }
      r.classList.add('on');
      var x = MG[+r.getAttribute('data-tip')];
      tip.innerHTML = '<b>' + esc(monthLabel(x.k)) + '</b><div><span><i style="background:var(--s1)"></i>Fees</span><span>' + esc(eur(x.fees)) + '</span></div><div><span>Volume</span><span>' + esc(eur(x.vol)) + '</span></div><div><span>Rate</span><span>' + esc(rate(x.fees, x.vol)) + '</span></div>';
      tip.hidden = false;
      var bb = box.getBoundingClientRect(), tx = e.clientX - bb.left + 14;
      if (tx + 190 > bb.width) tx = e.clientX - bb.left - 200;
      tip.style.left = Math.max(0, tx) + 'px'; tip.style.top = Math.max(0, e.clientY - bb.top - 20) + 'px';
    });
    box.addEventListener('mouseleave', function () { tip.hidden = true; box.querySelectorAll('.hit.on').forEach(function (n) { n.classList.remove('on'); }); });
  }
  ACT.csvFees = function () {
    var by = GROUPS[stF.by] ? stF.by : 'provider', G = feeGroups(stF.month, stF.prov, by);
    downloadCsv('recon-fees-by-' + by, [GROUPS[by][0], 'Payments', 'Captured volume EUR', 'Refunds EUR', 'Chargebacks EUR', 'Fees EUR', 'Effective rate %'], G.rows.concat([G.tot]).map(function (x) {
      return [x.k, x.n, cc(x.vol), cc(x.ref), cc(x.cb), cc(x.fees), x.vol ? (x.fees / x.vol * 100).toFixed(3) : ''];
    }));
  };

  // ════════════════════════════════════════════════════════════════════════
  // Month close
  // ════════════════════════════════════════════════════════════════════════
  function covered(t) { return (E.exByTxn[t.id] || []).some(function (x) { return x.type === 'no_order' && (x.status === 'resolved' || x.status === 'written_off'); }); }
  function exCleared(x) { return x.status === 'resolved' || x.status === 'written_off'; }
  function closeCalc(m) {
    var provs = D.PROVIDERS.map(function (p) {
      var ts = B.txns.filter(function (t) { return t.provider === p.id && inMonth(t.date, m); });
      var un = ts.filter(function (t) { return !E.used[t.id] && !covered(t); }), uv = 0; un.forEach(function (t) { uv += t.gross; });
      return { p: p, n: ts.length, matched: ts.length - un.length, un: un.length, uv: uv, ok: !un.length };
    }).filter(function (x) { return x.n; });
    var pos = B.payouts.filter(function (p) { return inMonth(p.date, m); }).map(function (p) { return { p: p, s: payoutStatus(p) }; });
    var poBad = pos.filter(function (x) { return x.s.code !== 'arrived' && !(E.exByPayout[x.p.id] || []).some(exCleared); });
    var exs = E.EX.filter(function (x) { return isActive(x) && inMonth(x.date, m); }), exV = 0; exs.forEach(function (x) { exV += Math.abs(x.amount); });
    var th = S.threshold, c = S.close[m] || {};
    var checks = {
      providers: provs.every(function (x) { return x.ok; }),
      payouts: !poBad.length,
      exceptions: exs.length <= th.count && exV <= th.value,
      fees: !!(c.fees && c.fees.at),
      exported: !!(c.exported && c.exported.at)
    };
    var monthEnded = U.addDays(m + '-28', 5).slice(0, 7) <= REF.slice(0, 7) && m < REF.slice(0, 7);
    return { provs: provs, pos: pos, poBad: poBad, exs: exs, exV: exV, checks: checks, c: c, ended: monthEnded, all: checks.providers && checks.payouts && checks.exceptions && checks.fees && checks.exported };
  }
  function stIcon(ok) { return '<span class="st ' + (ok ? 'ok' : 'bad') + '">' + (ok ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + IC.check + '"/></svg>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + IC.minus + '"/></svg>') + '</span><span class="sr">' + (ok ? 'Done' : 'Not done') + '</span>'; }
  function pageClose() {
    var ms = months(), m = ms.indexOf(stC.month) >= 0 ? stC.month : (ms.length > 1 ? ms[ms.length - 2] : ms[0]);
    var K = closeCalc(m), c = K.c, closed = !!(c.closed && c.closed.at);
    var h = head('Month close', 'Close ' + esc(monthLabel(m)) + '<span class="dot">.</span>', 'A month can be closed when every provider is reconciled, payouts are on the bank, open exceptions are under the threshold, fees are reviewed and the accounting export is done.',
      '<button type="button" class="btn pri" data-act="exportAcc" data-m="' + m + '">' + ic('exp') + 'Export for accounting</button>');
    h += '<div class="toolbar">' + seg('cl', 'month', m, ms.map(function (x) { var cx = S.close[x] && S.close[x].closed; return [x, monthShort(x) + (cx ? ' · closed' : '')]; }), 'Month') + '</div>';
    if (closed) h += '<div class="notice ok closed-banner"><span>Closed by <b>' + esc(c.closed.by) + '</b> on ' + fts(c.closed.at) + (c.closed.note ? ' · “' + esc(c.closed.note) + '”' : '') + '</span><button type="button" class="btn sm" data-act="reopen" data-m="' + m + '">Reopen…</button></div>';
    else if (!K.ended) h += '<div class="notice">' + esc(monthLabel(m)) + ' is still running (data as of ' + fdate(REF) + '). You can work through the list, but closing is only possible after the month ends.</div>';
    var th = S.threshold;
    h += '<section class="card"><ul class="checks">' +
      '<li>' + stIcon(K.checks.providers) + '<div><b>All providers reconciled</b><p>Every transaction dated in ' + esc(monthLabel(m)) + ' is matched, or its exception is resolved / written off.</p><ul class="sublist">' +
      K.provs.map(function (x) { return '<li class="' + (x.ok ? '' : 'bad') + '"><span>' + esc(x.p.name) + '</span><span>' + (x.ok ? num(x.matched) + '/' + num(x.n) + ' ✓' : num(x.un) + ' open · ' + esc(eur(x.uv))) + '</span></li>'; }).join('') + '</ul></div><a class="btn sm" href="#/reconcile/workbench">Workbench</a></li>' +
      '<li>' + stIcon(K.checks.payouts) + '<div><b>Payouts arrived on the bank</b><p>' + num(K.pos.length) + ' payouts paid out in ' + esc(monthLabel(m)) + '; ' + (K.poBad.length ? num(K.poBad.length) + ' still in transit, missing or with a different bank amount (and not resolved).' : 'all arrived with the right amount or were resolved.') + '</p>' +
      (K.poBad.length ? '<ul class="sublist">' + K.poBad.slice(0, 8).map(function (x) { return '<li class="bad"><span>' + pLink(x.p) + '</span><span>' + esc(PST[x.s.code][0]) + '</span></li>'; }).join('') + '</ul>' : '') + '</div><a class="btn sm" href="#/payouts">Payouts</a></li>' +
      '<li>' + stIcon(K.checks.exceptions) + '<div><b>Open exceptions under the threshold</b><p>' + num(K.exs.length) + ' open or waiting · ' + esc(eur(K.exV)) + ' absolute. Threshold: at most <b>' + th.count + '</b> items and <b>' + esc(eur(th.value)) + '</b>.</p></div><div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end"><button type="button" class="btn sm ghost" data-act="threshold">Change threshold</button><button type="button" class="btn sm" data-act="exMonth" data-m="' + m + '">Exceptions</button></div></li>' +
      '<li>' + stIcon(K.checks.fees) + '<div><b>Fees reviewed</b><p>' + (K.checks.fees ? 'Ticked by ' + esc(c.fees.by) + ' · ' + fts(c.fees.at) : 'Compare the fee rates on the Fees screen with the contracts, then tick.') + '</p></div><label class="check"><input type="checkbox" data-chg="feesOk" data-m="' + m + '" data-fid="feesok"' + (K.checks.fees ? ' checked' : '') + (closed ? ' disabled' : '') + '> Reviewed</label></li>' +
      '<li>' + stIcon(K.checks.exported) + '<div><b>Export for accounting done</b><p>' + (K.checks.exported ? 'Exported by ' + esc(c.exported.by) + ' · ' + fts(c.exported.at) + (c.exported.files ? ' · ' + esc(c.exported.files.join(', ')) : '') : 'Matched pairs, unmatched items and fees per provider as CSV. Files are only downloaded to this device.') + '</p></div><button type="button" class="btn sm" data-act="exportAcc" data-m="' + m + '">' + ic('exp') + 'Export…</button></li>' +
      '</ul><div class="md-foot" style="justify-content:space-between;align-items:center"><span class="hint">' + (closed ? 'Closed.' : K.all ? 'All checks done.' : 'Closing with open checks needs a note.') + '</span>' +
      (closed ? '' : '<button type="button" class="btn pri" data-act="closeMonth" data-m="' + m + '"' + (K.ended ? '' : ' disabled') + '>' + ic('check') + 'Close ' + esc(monthLabel(m)) + '</button>') + '</div></section>';
    return h;
  }
  ACT.exMonth = function () { stE.status = 'active'; stE.type = ''; stE.page = 0; saveUi(); go('#/exceptions'); };
  CHG.feesOk = function (el) {
    var m = el.getAttribute('data-m'), c = S.close[m] = S.close[m] || {};
    if (el.checked) { c.fees = { by: who(), at: nowIso() }; logIt('close', 'Fees reviewed for ' + monthLabel(m), '', 'close:' + m); }
    else { delete c.fees; logIt('close', 'Fees review un-ticked for ' + monthLabel(m), '', 'close:' + m); }
    commit();
  };
  ACT.threshold = function () {
    var th = S.threshold;
    modal({
      title: 'Exception threshold for month close', submitLabel: 'Save',
      body: '<div class="row2">' + field('Max open exceptions', '<input class="in" id="%ID%" name="count" inputmode="numeric" value="' + th.count + '" data-autofocus>') + field('Max open value (€)', '<input class="in" id="%ID%" name="value" inputmode="decimal" value="' + NF2.format(th.value / 100).replace(/\s/g, '') + '">') + '</div>',
      onSubmit: function (f) {
        var n = parseInt(f.elements.count.value, 10), v = parseFloat(String(f.elements.value.value).replace(/\./g, '').replace(',', '.'));
        if (!(n >= 0) || !isFinite(v) || v < 0) return 'Enter a whole number of items and an amount of 0 or more.';
        S.threshold = { count: n, value: Math.round(v * 100) };
        logIt('close', 'Threshold set to ' + n + ' items / ' + eur(S.threshold.value), '', 'threshold');
        setTimeout(function () { commit('Threshold saved'); }, 0);
        return null;
      }
    });
  };
  ACT.closeMonth = function (d) {
    var m = d.m, K = closeCalc(m);
    if (!K.ended) return;
    modal({
      title: 'Close ' + monthLabel(m) + '?', submitLabel: 'Close month',
      body: (K.all ? '<p>All checks are done. The month is marked closed by ' + esc(who()) + '.</p>' : '<div class="notice warn">Not every check is done: ' + esc(['providers', 'payouts', 'exceptions', 'fees', 'exported'].filter(function (k) { return !K.checks[k]; }).map(function (k) { return { providers: 'providers reconciled', payouts: 'payouts on the bank', exceptions: 'exceptions under threshold', fees: 'fees reviewed', exported: 'export done' }[k]; }).join(', ')) + '.</div>') +
        field(K.all ? 'Note (optional)' : 'Why close anyway? (required)', '<textarea class="in" id="%ID%" name="note" rows="2" data-autofocus></textarea>'),
      onSubmit: function (f) {
        var note = f.elements.note.value.trim();
        if (!K.all && !note) return 'Explain why the month is closed with open checks.';
        var c = S.close[m] = S.close[m] || {};
        c.closed = { by: who(), at: nowIso(), note: note, open: K.all ? [] : ['providers', 'payouts', 'exceptions', 'fees', 'exported'].filter(function (k) { return !K.checks[k]; }) };
        logIt('close', 'Closed ' + monthLabel(m) + (K.all ? '' : ' with open checks'), note, 'close:' + m);
        setTimeout(function () { commit(monthLabel(m) + ' closed'); }, 0);
        return null;
      }
    });
  };
  ACT.reopen = function (d) {
    var m = d.m;
    modal({ title: 'Reopen ' + monthLabel(m) + '?', submitLabel: 'Reopen', body: field('Reason (required)', '<textarea class="in" id="%ID%" name="note" rows="2" data-autofocus></textarea>'),
      onSubmit: function (f) {
        var note = f.elements.note.value.trim(); if (!note) return 'Give a reason for reopening.';
        delete S.close[m].closed; logIt('close', 'Reopened ' + monthLabel(m), note, 'close:' + m);
        setTimeout(function () { commit(monthLabel(m) + ' reopened'); }, 0); return null;
      } });
  };
  // Export for accounting: three CSV files for one month
  function accFiles(m) {
    var lab = m.replace('-', '');
    return {
      matched: function () { return downloadCsv('recon-' + lab + '-matched-pairs', ['Month'].concat(MATCH_HDR), E.M.filter(function (x) { return inMonth(x.date, m); }).map(function (x) { return [m].concat(matchCsv(x)); }), true); },
      unmatched: function () {
        var rows = [];
        B.txns.forEach(function (t) {
          if (E.used[t.id] || !inMonth(t.date, m)) return;
          var x = (E.exByTxn[t.id] || [])[0];
          rows.push([m, 'Payment', t.id, PROV[t.provider].name, ACC[t.account].name, typeLabel(t.type), t.date, t.ref, t.email || t.payer, cc(t.gross), cc(t.fee), E.sT[t.id] ? 'suggestion pending' : '', x ? EXT[x.type] + ' · ' + EXS[x.status][0] : '', x ? x.owner : '']);
        });
        B.orders.forEach(function (o) {
          if (E.uo[o.id] || !inMonth(o.date, m)) return;
          var x = (E.exByOrder[o.id] || [])[0];
          rows.push([m, 'Order', o.no, PROV[o.provider].name, SHOP[o.shop].name, o.markedPaid ? 'Marked paid' : 'Awaiting payment', o.date, o.inv, o.email, cc(o.amount), '', E.sO[o.id] ? 'suggestion pending' : '', x ? EXT[x.type] + ' · ' + EXS[x.status][0] : '', x ? x.owner : '']);
        });
        return downloadCsv('recon-' + lab + '-unmatched-items', ['Month', 'Side', 'Id / order', 'Provider', 'Account / shop', 'Type / status', 'Date', 'Reference / invoice', 'Customer', 'Amount EUR', 'Fee EUR', 'Suggestion', 'Exception', 'Owner'], rows, true);
      },
      fees: function () {
        var g = {}, tot = { n: 0, vol: 0, ref: 0, cb: 0, fees: 0 };
        B.txns.forEach(function (t) {
          if (!inMonth(t.date, m)) return;
          var x = g[t.account] = g[t.account] || { n: 0, vol: 0, ref: 0, cb: 0, fees: 0 };
          [x, tot].forEach(function (y) { y.fees += t.fee; if (t.type === 'capture') { y.n++; y.vol += t.gross; } else if (t.type === 'refund') y.ref += t.gross; else y.cb += t.gross; });
        });
        var rows = D.ACCOUNTS.filter(function (a) { return g[a.id]; }).map(function (a) { var x = g[a.id]; return [m, PROV[a.provider].name, a.name, x.n, cc(x.vol), cc(x.ref), cc(x.cb), cc(x.fees), x.vol ? (x.fees / x.vol * 100).toFixed(3) : '']; });
        rows.push([m, 'Total', '', tot.n, cc(tot.vol), cc(tot.ref), cc(tot.cb), cc(tot.fees), tot.vol ? (tot.fees / tot.vol * 100).toFixed(3) : '']);
        return downloadCsv('recon-' + lab + '-fees-per-provider', ['Month', 'Provider', 'Account', 'Payments', 'Captured volume EUR', 'Refunds EUR', 'Chargebacks EUR', 'Fees EUR', 'Effective rate %'], rows, true);
      }
    };
  }
  ACT.exportAcc = function (d) {
    var m = d.m, F = accFiles(m);
    var done = {};
    function mark(names) {
      var c = S.close[m] = S.close[m] || {};
      c.exported = { by: who(), at: nowIso(), files: names };
      logIt('export', 'Accounting export for ' + monthLabel(m) + ' (' + names.length + ' file' + (names.length === 1 ? '' : 's') + ')', '', 'close:' + m);
      engine(); save(); renderNav(); renderPage();
    }
    modal({
      title: 'Export for accounting · ' + monthLabel(m),
      body: '<p>Three CSV files (UTF-8, comma-separated, amounts signed with a dot decimal). They are only downloaded to this device; nothing is sent anywhere.</p>' +
        '<ul class="list">' + [['matched', 'Matched pairs', 'payment ↔ order/invoice, confidence, who/when, fees, payout batch'], ['unmatched', 'Unmatched items', 'payments and orders still open, with suggestion and exception status'], ['fees', 'Fees per provider', 'per account: volume, refunds, chargebacks, fees, effective rate']].map(function (x) {
          return '<li><div class="l"><b style="font-weight:500">' + esc(x[1]) + '</b><small>' + esc(x[2]) + '</small></div><div class="r"><button type="button" class="btn sm" data-x="' + x[0] + '">' + ic('exp') + 'Download</button></div></li>';
        }).join('') + '</ul>',
      onSubmit: function () {
        var names = [];
        names.push(F.matched());
        setTimeout(function () { names.push(F.unmatched()); }, 350);
        setTimeout(function () { names.push(F.fees()); mark(names); toast('Exported 3 files for ' + monthLabel(m)); }, 700);
        return null;
      },
      submitLabel: 'Download all 3',
      mount: function (form) {
        form.addEventListener('click', function (e) {
          var b = e.target.closest('[data-x]'); if (!b) return;
          var name = F[b.getAttribute('data-x')]();
          done[b.getAttribute('data-x')] = name;
          b.innerHTML = ic('check') + 'Downloaded';
          var names = Object.keys(done).map(function (k) { return done[k]; });
          if (names.length === 3) { mark(names); toast('All 3 files exported'); } else toast('Downloaded ' + name);
        });
      }
    });
  };

  // ════════════════════════════════════════════════════════════════════════
  // Activity (decision log)
  // ════════════════════════════════════════════════════════════════════════
  PAGERS.log = stL;
  var ACTS = { accept: 'Accepted suggestion', reject: 'Rejected suggestion', match: 'Manual match', unmatch: 'Unmatch', exception: 'Exception', close: 'Month close', export: 'Export', restore: 'Restore', reset: 'Reset' };
  function logRows() {
    var q = norm(stL.q);
    return S.log.filter(function (l) { return (!stL.act || l.act === stL.act) && (!q || norm(l.txt + " " + l.note + " " + l.by).indexOf(q) >= 0); });
  }
  function pageActivity() {
    var rows = logRows(), SZ = 50;
    var h = head('Activity', 'Decision log<span class="dot">.</span>', 'Every accept, reject, manual match, unmatch, exception change and month-close step, with who and when. Signed in to cloud sync, your e-mail is recorded; otherwise “you”.',
      '<button type="button" class="btn" data-act="csvLog">' + ic('exp') + 'Export CSV</button>');
    h += '<div class="toolbar">' + search('log', 'q', stL.q, 'Search text, note, person') + sel('log', 'act', opt('', 'All actions', stL.act) + Object.keys(ACTS).map(function (k) { return opt(k, ACTS[k], stL.act); }).join(''), 'Action') + '</div>';
    h += '<section class="card"><div class="stats"><span><b>' + num(rows.length) + '</b> entries</span><span>Rejected suggestions kept <b>' + Object.keys(S.rejected).length + '</b></span><span>Unmatched pairings blocked <b>' + Object.keys(S.blocked).length + '</b></span>' + (E.stale ? '<span>Stale links ignored <b>' + E.stale + '</b></span>' : '') + '</div>';
    if (!rows.length) return h + empty(S.log.length ? 'Nothing matches.' : 'No decisions yet.', S.log.length ? '' : 'Accept a suggestion on the Reconcile tab to get started.') + '</section>';
    h += '<div class="tw"><table class="t"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>What</th><th>Note</th><th><span class="sr">Undo</span></th></tr></thead><tbody>' +
      rows.slice(stL.page * SZ, stL.page * SZ + SZ).map(function (l) {
        var canRestore = (l.act === 'reject' && S.rejected[l.ref]) || (l.act === 'unmatch' && S.blocked[l.ref]);
        return '<tr><td class="nw">' + fts(l.at) + '</td><td class="nw">' + esc(l.by) + '</td><td class="nw">' + esc(ACTS[l.act] || l.act) + '</td><td>' + esc(l.txt) + '</td><td>' + (l.note ? esc(l.note) : '<span class="muted">—</span>') + '</td>' +
          '<td class="nw">' + (canRestore ? '<button type="button" class="btn sm ghost" data-act="restore" data-k="' + esc(l.ref) + '" data-a="' + l.act + '">Undo</button>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>' + pager(rows.length, stL, SZ, 'log') + '</section>';
    return h;
  }
  ACT.restore = function (d) {
    if (d.a === 'reject') delete S.rejected[d.k]; else delete S.blocked[d.k];
    logIt('restore', (d.a === 'reject' ? 'Restored rejected suggestion ' : 'Restored auto-match ') + d.k.replace('|', ' ↔ '), '', d.k);
    commit(d.a === 'reject' ? 'Suggestion is back on the Reconcile tab' : 'Pairing can be auto-matched or suggested again');
  };
  ACT.csvLog = function () { downloadCsv('recon-decision-log', ['At', 'By', 'Action', 'What', 'Note', 'Reference'], logRows().map(function (l) { return [l.at, l.by, ACTS[l.act] || l.act, l.txt, l.note, l.ref || '']; })); };

  // ════════════════════════════════════════════════════════════════════════
  // LIVE DATA — real provider payments for allow-listed accounts (server: /recon.js)
  // Everything fetched lives in LC (page memory) only. Decisions live in S.live (IndexedDB + cloud).
  // ════════════════════════════════════════════════════════════════════════
  var MODEKEY = 'adrial-recon-mode', MODE = 'demo';
  var SESSION = { checked: false, failed: false, signedIn: false, allowed: false, email: null };
  var LC = {}, lgen = 0, lrTimer = null, lxSel = {};
  var EXURL = '/api/recon/exceptions', METAURL = '/api/recon/meta';
  var LPROV = ['Adyen', 'PayPal', 'Klarna', 'Flik', 'Monri', 'Valu']; // fixed colour order (--p1…--p6)
  var LPNAME = { Valu: 'VALÚ' };
  var LK = { paid_twice: 'Paid twice', refund_without_payment: 'Refund without payment', refund_exceeds_payment: 'Refund exceeds payment', chargeback: 'Chargeback', payout_difference: 'Payout difference', paid_in_parts: 'Paid in parts', refund_credit_note: 'Refund under a credit note' };
  var LREAL = ['paid_twice', 'refund_without_payment', 'refund_exceeds_payment', 'chargeback', 'payout_difference'], LINFO = ['paid_in_parts', 'refund_credit_note'];
  var LHINT = {
    paid_twice: 'Two or more successful payments of the same amount for one order. Check whether the customer was charged twice; refund the duplicate in the provider portal, then resolve.',
    refund_without_payment: 'A refund for an order that has no successful payment in the last 13 months of payment data. The payment may be older, under another order number or at another provider.',
    refund_exceeds_payment: 'More was refunded than paid for this order. Check for a duplicate or wrong refund.',
    chargeback: 'Submit dispute evidence in the provider portal before the deadline; resolve when the outcome is known.',
    payout_difference: 'The amount paid out to the bank differs from what the batch adds up to. Check the provider payout report for a charge, reserve or correction.',
    paid_in_parts: 'For information: several payments of different amounts for one order, usually a legitimate split (for example a deposit and the balance).',
    refund_credit_note: 'For information: a PayPal refund filed under a credit-note number instead of an order number. Finding its order needs the Alensis credit note list, which is a later step.'
  };
  var LTYPE = { PAYMENT: 'Payment', REFUND: 'Refund', REVERSAL: 'Reversal', CHARGEBACK: 'Chargeback', CHARGEBACK_REVERSAL: 'Chargeback reversal', FEE: 'Fee', PAYOUT: 'Payout', HOLD: 'Hold', ADJUSTMENT: 'Adjustment', OTHER: 'Other' };
  var LSTAT = { SUCCESS: ['Success', 'b-good'], FAILED: ['Failed', 'b-bad'], CANCELLED: ['Cancelled', ''], PENDING: ['Pending', 'b-blue'], REVERSED: ['Reversed', 'b-clay'] };
  function pname(p) { return LPNAME[p] || p || '—'; }
  function pcol(p) { var i = LPROV.indexOf(p); return i < 0 ? 'var(--ink3)' : 'var(--p' + (i + 1) + ')'; }
  function pdot(p) { return '<i class="pdot" style="background:' + pcol(p) + '" aria-hidden="true"></i>'; }
  function pcmp(a, b) { var ia = LPROV.indexOf(a), ib = LPROV.indexOf(b); ia = ia < 0 ? 99 : ia; ib = ib < 0 ? 99 : ib; return ia - ib || (a < b ? -1 : a > b ? 1 : 0); }
  function lc(v) { return Math.round((+v || 0) * 100) || 0; } // live decimals → integer cents (never -0)
  function lamt(c, cur) { return cur && cur !== 'EUR' ? '<span class="amt' + (c < 0 ? ' neg' : '') + '">' + NF2.format(c / 100) + ' ' + esc(cur) + '</span>' : amt(c); }
  function eurK(c) { var v = c / 100, a = Math.abs(v); return (a >= 1e6 ? NF1.format(v / 1e6) + ' M' : a >= 1e4 ? NF0.format(v / 1e3) + 'k' : NF0.format(v)) + ' €'; }
  function nextMonth(m) { return U.addDays(m + '-28', 5).slice(0, 7); }
  function monthEnd(m) { return U.addDays(nextMonth(m) + '-01', -1); }
  function minD(a, b) { return a < b ? a : b; }
  function isoOk(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !isNaN(Date.parse(s + 'T00:00:00Z')); }
  function tsIso(s) { return s ? String(s).replace(' ', 'T').replace(/(\.\d{3})\d+/, '$1').replace(/\+00(:00)?$/, 'Z') : null; }
  function typeL(t) { return LTYPE[t] || t || '—'; }
  function statB(s) { var x = LSTAT[s] || [s || '—', '']; return badge(x[0], x[1]); }

  // ── Fetching (same-origin GET, sign-in cookie; only the server's `error` text is ever shown) ──
  function lfetch(url) {
    return fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' }, cache: 'no-store' }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.ok) return j;
        var msg = j && typeof j.error === 'string' && j.error ? j.error.slice(0, 300) :
          r.status === 401 ? 'Sign in to see live payment data.' : r.status === 403 ? 'Your account is not on the list for live payment data.' : 'The payment data is unavailable right now.';
        var e = new Error(msg); e.status = r.status; throw e;
      });
    }, function () { var e = new Error('Could not reach the server. Check the connection and try again.'); e.status = 0; throw e; });
  }
  function lget(url) {
    var c = LC[url];
    if (c) return c;
    var g = lgen;
    c = LC[url] = { status: 'loading', url: url };
    lfetch(url).then(function (d) {
      if (g !== lgen || LC[url] !== c) return;
      c.status = 'ok'; c.data = d; liveChanged();
    }, function (e) {
      if (g !== lgen || LC[url] !== c) return;
      c.status = 'error'; c.err = e.message; c.code = e.status; liveChanged();
      if (e.status === 401 || e.status === 403) checkSession();
    });
    return c;
  }
  function liveChanged() { clearTimeout(lrTimer); lrTimer = setTimeout(function () { if (MODE === 'live' && S) rerender(); }, 30); }
  function liveForget() { lgen++; LC = {}; lxSel = {}; }
  function memo(c, k, fn) { c.memo = c.memo || {}; if (!(k in c.memo)) c.memo[k] = fn(c.data); return c.memo[k]; }
  function through() { var c = LC[METAURL]; return c && c.status === 'ok' ? c.data.dataThrough : null; }
  function lwait(cs, what) {
    for (var i = 0; i < cs.length; i++) if (cs[i].status === 'error') return lerror(cs[i]);
    for (var j = 0; j < cs.length; j++) if (cs[j].status !== 'ok') return '<div class="card pad"><p class="loading" role="status" style="margin:10px 0"><i aria-hidden="true"></i>Loading ' + esc(what) + '…</p></div>';
    return null;
  }
  function lerror(c) {
    var t = { 401: 'Sign in to see live payment data', 403: 'No access to live payment data', 400: 'That could not be looked up', 502: 'Could not load this part of the live data' }[c.code] || 'Could not load live payment data';
    return '<div class="card pad lerr" role="alert"><h2>' + esc(t) + '</h2><p>' + esc(c.err || '') + '</p><div class="dr-actions">' +
      (c.code !== 400 && c.code !== 401 && c.code !== 403 ? '<button type="button" class="btn" data-act="lretry">' + ic('refresh') + 'Try again</button>' : '') +
      (c.code === 401 ? '<button type="button" class="btn pri" data-act="lsignin">Sign in</button>' : '') +
      (c.code === 401 || c.code === 403 ? '<button type="button" class="btn" data-act="mode" data-v="demo">Show demo data</button>' : '') + '</div></div>';
  }
  ACT.lretry = function () { Object.keys(LC).forEach(function (k) { if (LC[k].status === 'error') delete LC[k]; }); rerender(); };
  ACT.lsignin = function () { if (window.AdrialSync && window.AdrialSync.signIn) window.AdrialSync.signIn(); else toast('Sign-in is not available on this server.'); };

  // ── Session and mode ─────────────────────────────────────────────────────
  var sessP = null;
  function checkSession() {
    if (sessP) return sessP;
    sessP = fetch('/api/recon/session', { credentials: 'same-origin', headers: { Accept: 'application/json' }, cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('session ' + r.status); return r.json(); })
      .then(function (j) { SESSION = { checked: true, failed: false, signedIn: !!j.signedIn, allowed: !!j.allowed, email: j.email || null }; },
        function () { SESSION = { checked: true, failed: true, signedIn: false, allowed: false, email: null }; })
      .then(function () { sessP = null; applySession(); });
    return sessP;
  }
  function applySession() {
    if (!SESSION.allowed) {
      if (MODE === 'live') { setMode('demo'); toast(SESSION.signedIn ? 'This account has no access to live payment data: showing demo data.' : 'Live data needs sign-in: showing demo data.'); }
      else if (S) rerender(); else renderChrome();
      return;
    }
    if (MODE !== 'live' && lsGet(MODEKEY) !== 'demo') setMode('live');
    else if (S) rerender(); else renderChrome();
  }
  function watchAuth() {
    if (!window.AdrialSync || !window.AdrialSync.on) return;
    var last = (window.AdrialSync.user() || {}).email || '';
    window.AdrialSync.on(function () { var now = (window.AdrialSync.user() || {}).email || ''; if (now !== last) { last = now; checkSession(); } });
  }
  function setMode(m) {
    if (m === 'live' && !SESSION.allowed) m = 'demo';
    if (m === MODE) { if (S) rerender(); else renderChrome(); return; }
    MODE = m;
    liveForget();
    if (m === 'live') { lget(METAURL); lget(EXURL); }
    if (!S) { renderChrome(); return; }
    closeAll();
    onRoute();
  }
  ACT.mode = function (d) {
    if (d.v === 'live' && !SESSION.allowed) { toast('Live payment data is only for approved accounts.'); return; }
    lsSet(MODEKEY, d.v);
    var was = MODE;
    setMode(d.v);
    if (was !== MODE) toast(MODE === 'live' ? 'Showing live payment data' : 'Showing demo data');
    var b = document.querySelector('[data-fid="mode-' + d.v + '"]'); if (b) b.focus();
  };
  function liveNote(side) {
    if (!SESSION.checked || SESSION.allowed) return '';
    var txt;
    if (SESSION.failed) txt = esc('Live payment data could not be checked right now; this is demo data.');
    else if (!SESSION.signedIn) txt = 'Live payment data is available to approved accounts — <button type="button" class="linkish" data-act="lsignin">sign in</button>';
    else txt = esc('Live payment data is available to approved accounts. ' + (SESSION.email || 'This account') + ' is not on the list.');
    return '<div class="' + (side ? 'live-note' : 'notice') + '"><span>' + txt + '</span></div>';
  }
  function renderChrome() {
    var live = MODE === 'live', thr = through();
    var bs = document.querySelector('.brand small'); if (bs) bs.textContent = live ? 'Live' + (thr ? ' · data through ' + fdate(thr) : ' data') : 'Demo · finance';
    var dp = document.querySelector('.demo-pill'); if (dp) dp.hidden = live;
    var rb = $('resetBtn'); if (rb) rb.hidden = live;
    var mp = $('modePanel'); if (!mp) return;
    var h = '';
    if (SESSION.allowed) {
      h = '<div class="seg mode-seg" role="group" aria-label="Data source">' + [['live', 'Live data'], ['demo', 'Demo']].map(function (x) {
        return '<button type="button" data-act="mode" data-v="' + x[0] + '" data-fid="mode-' + x[0] + '" aria-pressed="' + (MODE === x[0] ? 'true' : 'false') + '">' + x[1] + '</button>';
      }).join('') + '</div>';
      if (live) h += '<span class="live-pill"><i aria-hidden="true"></i>Live · data through ' + (thr ? fdate(thr) : '…') + '</span>';
    } else h = liveNote(true);
    if (mp.getAttribute('data-h') !== h) { mp.innerHTML = h; mp.setAttribute('data-h', h); }
  }
  function lhead(eye, title, sub, actions) { var thr = through(); return head('Live' + (thr ? ' · data through ' + fdate(thr) : '') + ' · ' + eye, title, sub, actions); }

  // ── Exceptions data + decisions ──────────────────────────────────────────
  function lexRows(c) {
    return memo(c, 'rows', function (d) {
      return (d.exceptions || []).map(function (x) {
        return { key: x.kind + '|' + x.ref, kind: x.kind, ref: String(x.ref == null ? '' : x.ref), acc: x.merchant_account || '', market: x.market || '', day: x.day || '', amount: lc(x.amount), detail: x.detail || '', info: LINFO.indexOf(x.kind) >= 0 };
      });
    });
  }
  function lexIndex(c) { return memo(c, 'idx', function () { var m = {}; lexRows(c).forEach(function (x) { m[x.key] = x; }); return m; }); }
  function lxDec(x) { var d = S.live.ex[x.key] || {}; x.status = EXS[d.status] ? d.status : 'open'; x.owner = d.owner || ''; x.notes = d.notes || []; x.at = d.at || null; x.by = d.by || null; return x; }
  function lxActive(x) { return x.status === 'open' || x.status === 'waiting'; }
  function lxStatusOf(key) { var d = S.live.ex[key]; return d && EXS[d.status] ? d.status : 'open'; }
  function lxAge(x) { var t = through(); return t && x.day ? U.diffDays(x.day, t) : 0; }
  function lowners() { var s = {}; s[who()] = 1; Object.keys(S.live.ex).forEach(function (k) { var o = S.live.ex[k].owner; if (o) s[o] = 1; }); return Object.keys(s).sort(); }
  function llog(act, txt, note, ref) { S.live.log.unshift({ at: nowIso(), by: who(), act: act, txt: txt, note: note || '', ref: ref || null }); if (S.live.log.length > 3000) S.live.log.length = 3000; }
  function setLx(x, patch, note) {
    var cur = S.live.ex[x.key] ? JSON.parse(JSON.stringify(S.live.ex[x.key])) : { status: 'open', owner: '', notes: [] };
    var parts = [], was = EXS[cur.status] ? cur.status : 'open';
    if (patch.status && patch.status !== was) { parts.push(EXS[was][0] + ' → ' + EXS[patch.status][0]); cur.status = patch.status; }
    if ('owner' in patch && patch.owner !== (cur.owner || '')) { parts.push('owner ' + (patch.owner || 'unassigned')); cur.owner = patch.owner; }
    cur.notes = cur.notes || [];
    if (note) cur.notes.push({ by: who(), at: nowIso(), text: note });
    if (!parts.length && !note) return false;
    cur.status = cur.status || 'open'; cur.by = who(); cur.at = nowIso();
    S.live.ex[x.key] = cur;
    llog('exception', LK[x.kind] + ' ' + x.ref + (parts.length ? ' · ' + parts.join(' · ') : ' · note added'), note, x.key);
    return true;
  }
  function lcommit(msg) { save(); rerender(); if (msg) toast(msg); }

  // ── Charts ───────────────────────────────────────────────────────────────
  function niceMax(v) { if (v <= 0) return 400; var e = Math.pow(10, Math.floor(Math.log10(v / 4))), ms = [1, 2, 2.5, 5, 10]; for (var i = 0; i < ms.length; i++) if (ms[i] * e * 4 >= v) return ms[i] * e * 4; return 40 * e; }
  // stacked bars: cols [{label, v:{series: cents}}], series in fixed order, colour per series
  function barChart(cols, series, colour, label) {
    var W = 760, H = 250, pl = 58, pr = 8, pt = 12, pb = 28, max = 0;
    cols.forEach(function (c) { var t = 0; series.forEach(function (p) { t += Math.max(0, c.v[p] || 0); }); max = Math.max(max, t); });
    var top = niceMax(max), ih = H - pt - pb, bw = (W - pl - pr) / Math.max(1, cols.length), gap = bw >= 8 ? bw * 0.24 : bw >= 3 ? 1 : 0, w = Math.max(0.6, bw - gap);
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(label) + '">';
    for (var i = 0; i <= 4; i++) { var y = pt + ih * (1 - i / 4); s += '<line class="grid-l" x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y + '" y2="' + y + '"/><text class="ax" x="' + (pl - 8) + '" y="' + (y + 3) + '" text-anchor="end">' + esc(eurK(top * i / 4)) + '</text>'; }
    var every = Math.max(1, Math.ceil(cols.length / 8));
    cols.forEach(function (c, j) {
      var x = pl + j * bw + gap / 2, y0 = H - pb, segs = series.filter(function (p) { return (c.v[p] || 0) > 0; });
      segs.forEach(function (p, k) {
        var hh = ih * c.v[p] / top; y0 -= hh;
        var r = k === segs.length - 1 && w >= 8 ? Math.min(4, hh) : 0;
        s += '<rect x="' + x.toFixed(2) + '" y="' + y0.toFixed(2) + '" width="' + w.toFixed(2) + '" height="' + hh.toFixed(2) + '"' + (r ? ' rx="' + r.toFixed(1) + '"' : '') + ' fill="' + colour(p) + '" stroke="var(--surface)" stroke-width="' + (w >= 3 ? 1 : 0) + '"/>';
      });
      if (j % every === 0) s += '<text class="ax" x="' + (pl + j * bw + bw / 2).toFixed(1) + '" y="' + (H - 9) + '" text-anchor="middle">' + esc(c.label) + '</text>';
      s += '<rect class="hit" x="' + (pl + j * bw).toFixed(2) + '" y="' + pt + '" width="' + bw.toFixed(2) + '" height="' + ih + '" data-tip="' + j + '"/>';
    });
    return s + '<line class="base" x1="' + pl + '" x2="' + (W - pr) + '" y1="' + (H - pb) + '" y2="' + (H - pb) + '"/></svg>';
  }
  function bindTips(id, html) {
    var box = $(id); if (!box) return;
    var tip = document.createElement('div'); tip.className = 'tip'; tip.hidden = true; box.appendChild(tip);
    box.addEventListener('mousemove', function (e) {
      var r = e.target.closest && e.target.closest('[data-tip]');
      box.querySelectorAll('.hit.on').forEach(function (n) { n.classList.remove('on'); });
      if (!r) { tip.hidden = true; return; }
      r.classList.add('on');
      tip.innerHTML = html(+r.getAttribute('data-tip'));
      tip.hidden = false;
      var bb = box.getBoundingClientRect(), tx = e.clientX - bb.left + 14;
      if (tx + 210 > bb.width) tx = e.clientX - bb.left - 220;
      tip.style.left = Math.max(0, tx) + 'px'; tip.style.top = Math.max(0, e.clientY - bb.top - 20) + 'px';
    });
    box.addEventListener('mouseleave', function () { tip.hidden = true; box.querySelectorAll('.hit.on').forEach(function (n) { n.classList.remove('on'); }); });
  }
  function legend(series, colour, nameOf) { return '<div class="legend" style="margin-bottom:8px">' + series.map(function (p) { return '<span><i style="background:' + colour(p) + '"></i>' + esc(nameOf(p)) + '</span>'; }).join('') + '</div>'; }

  // ════════════════════════════════════════════════════════════════════════
  // Live · Overview
  // ════════════════════════════════════════════════════════════════════════
  function lwin(st, thr) {
    var p = st.p, to = thr, from, err = '';
    if (p === 'custom') {
      if (!st.from && !st.to) { st.from = U.addDays(thr, -29); st.to = thr; }
      var f = st.from, t = st.to;
      if (!isoOk(f) || !isoOk(t)) err = 'Pick both dates.';
      else if (f > t) err = 'From is after To.';
      else if (U.diffDays(f, t) > 399) err = 'Choose at most 400 days.';
      else { from = f; to = minD(t, thr); if (from > to) err = 'There is no data after ' + fdate(thr) + ' yet.'; }
      if (err) { from = U.addDays(thr, -29); to = thr; }
    } else if (p === 'mtd') from = thr.slice(0, 8) + '01';
    else from = U.addDays(thr, -((['7', '30', '90'].indexOf(p) >= 0 ? +p : 30) - 1));
    return { from: from, to: to, err: err };
  }
  function winBar(W) {
    var thr = through();
    var h = '<div class="toolbar">' + seg('lov', 'p', stLO.p, [['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['mtd', 'Month to date'], ['custom', 'Custom']], 'Period');
    if (stLO.p === 'custom') h += '<label class="sr" for="lov-from">From</label><input type="date" id="lov-from" data-fid="lov-from" data-chg="f" data-st="lov" data-k="from" value="' + esc(stLO.from) + '" max="' + esc(thr) + '"><span class="muted" aria-hidden="true">–</span><label class="sr" for="lov-to">To</label><input type="date" id="lov-to" data-fid="lov-to" data-chg="f" data-st="lov" data-k="to" value="' + esc(stLO.to) + '" max="' + esc(thr) + '">';
    h += '</div>';
    if (W.err) h += '<div class="notice warn" role="alert">' + esc(W.err) + ' Showing the last 30 days instead.</div>';
    return h;
  }
  function zeroAgg() { return { n: 0, vol: 0, ref: 0, nRef: 0, cb: 0, nCb: 0, fees: 0, failN: 0, failV: 0, canN: 0, canV: 0, rows: 0 }; }
  function addRow(y, r, a, f) {
    y.rows++;
    y.fees += f + (r.type === 'FEE' ? a : 0);
    if (r.type === 'PAYMENT') {
      if (r.status === 'SUCCESS') { y.vol += a; y.n += r.n || 0; }
      else if (r.status === 'FAILED') { y.failN += r.n || 0; y.failV += a; }
      else if (r.status === 'CANCELLED') { y.canN += r.n || 0; y.canV += a; }
    } else if (r.type === 'REFUND' && r.status === 'SUCCESS') { y.ref += a; y.nRef += r.n || 0; }
    else if ((r.type === 'CHARGEBACK' || r.type === 'CHARGEBACK_REVERSAL') && r.status === 'SUCCESS') { y.cb += a; if (r.type === 'CHARGEBACK') y.nCb += r.n || 0; }
  }
  // EUR totals, per provider+account(+currency) and per day×provider (successful payment volume, EUR)
  function dailyAgg(d) {
    var tot = zeroAgg(), acc = {}, days = {}, other = {};
    (d.rows || []).forEach(function (r) {
      var a = lc(r.amount), f = lc(r.fee_amount), cur = r.currency || 'EUR';
      var k = r.provider + '|' + r.merchant_account + '|' + cur;
      var x = acc[k] = acc[k] || Object.assign(zeroAgg(), { provider: r.provider, acc: r.merchant_account || '', cur: cur });
      addRow(x, r, a, f);
      if (cur === 'EUR') addRow(tot, r, a, f); else { var o = other[cur] = other[cur] || zeroAgg(); addRow(o, r, a, f); }
      if (cur === 'EUR' && r.type === 'PAYMENT' && r.status === 'SUCCESS') { var dd = days[r.date] = days[r.date] || {}; dd[r.provider] = (dd[r.provider] || 0) + a; }
    });
    return { tot: tot, acc: Object.keys(acc).map(function (k) { return acc[k]; }), days: days, other: other };
  }
  function kpiL(href, label, v, d, cls) { return '<a class="kpi" href="' + href + '"><span class="label">' + esc(label) + '</span><span class="v' + (cls || '') + '">' + v + '</span><span class="d"><i></i>' + d + '</span></a>'; }
  function pageLOverview() {
    var mc = lget(METAURL), w0 = lwait([mc], 'live payment data');
    if (w0) return lhead('Overview', 'Overview<span class="dot">.</span>') + w0;
    var thr = through(), W = lwin(stLO, thr);
    var dc = lget('/api/recon/daily?from=' + W.from + '&to=' + W.to), ec = lget(EXURL);
    var h = lhead('Overview', 'Overview<span class="dot">.</span>', 'Adyen, Klarna, PayPal, Flik, VALÚ and Monri, ' + fdate(W.from) + '–' + fdate(W.to) + '. EUR, signed: money in +, refunds, chargebacks and fees −.',
      '<a class="btn" href="#/order">' + ic('search') + 'Order lookup</a><a class="btn pri" href="#/exceptions">' + ic('alert') + 'Exceptions</a>');
    h += winBar(W);
    var w1 = lwait([dc], 'payments for this period'); if (w1) return h + w1;
    var A = memo(dc, 'agg', dailyAgg), K = A.tot;
    var prob = null;
    if (ec.status === 'ok') {
      prob = { n: 0, v: 0, by: {}, info: {} };
      lexRows(ec).forEach(function (x) {
        if (x.day < W.from || x.day > W.to) return;
        var st = lxStatusOf(x.key); if (st !== 'open' && st !== 'waiting') return;
        if (x.info) { prob.info[x.kind] = (prob.info[x.kind] || 0) + 1; return; }
        prob.n++; prob.v += Math.abs(x.amount); prob.by[x.kind] = (prob.by[x.kind] || 0) + 1;
      });
    }
    h += '<div class="kpis">' +
      kpiL('#/fees', 'Payments in', eur0(K.vol), num(K.n) + ' successful payments') +
      kpiL('#/exceptions', 'Refunds', eur0(K.ref), num(K.nRef) + ' refunds · ' + pct(-K.ref, K.vol) + ' of volume', K.ref < 0 ? ' neg' : '') +
      kpiL('#/exceptions', 'Chargebacks', eur0(K.cb), num(K.nCb) + ' chargebacks, net of reversals', K.cb < 0 ? ' neg' : '') +
      kpiL('#/fees', 'Fees', eur0(K.fees), rate(-K.fees, K.vol) + ' effective rate', K.fees < 0 ? ' neg' : '') +
      kpiL('#/exceptions', 'Failed payments', num(K.failN), eur0(K.failV) + ' value · ' + num(K.canN) + ' cancelled') +
      '<a class="kpi" href="#/exceptions"><span class="label">Open problems</span><span class="v">' + (prob ? num(prob.n) : '…') + '</span><span class="d ' + (prob && prob.n ? 'bad' : prob ? 'good' : '') + '"><i></i>' +
        (prob ? (prob.n ? eur0(prob.v) + ' at stake (absolute), in this period' : 'none open in this period') : ec.status === 'error' ? 'could not load' : 'loading…') + '</span></a>' +
      '</div>';
    var curs = Object.keys(A.other);
    if (curs.length) h += '<div class="notice">Also in this period: ' + curs.map(function (c) { return num(A.other[c].rows) + ' rows in ' + esc(c) + ' (' + esc(NF2.format(A.other[c].vol / 100)) + ' ' + esc(c) + ' payments)'; }).join(', ') + '. They are not in the EUR totals; the table shows them with their currency.</div>';

    // daily volume per provider (stacked) + problems by kind
    var list = []; for (var d = W.from; d <= W.to; d = U.addDays(d, 1)) list.push(d);
    var provs = LPROV.filter(function (p) { return list.some(function (x) { return A.days[x] && A.days[x][p]; }); });
    Object.keys(A.days).forEach(function (x) { Object.keys(A.days[x]).forEach(function (p) { if (provs.indexOf(p) < 0) provs.push(p); }); });
    var cols = list.map(function (x) { return { k: x, label: x.slice(8, 10) + '.' + x.slice(5, 7) + '.', v: A.days[x] || {} }; });
    afterHooks.push(function () {
      bindTips('lvChart', function (i) {
        var c = cols[i], t = 0; provs.forEach(function (p) { t += c.v[p] || 0; });
        return '<b>' + esc(fdate(c.k)) + '</b>' + provs.filter(function (p) { return c.v[p]; }).map(function (p) { return '<div><span><i style="background:' + pcol(p) + '"></i>' + esc(pname(p)) + '</span><span>' + esc(eur(c.v[p])) + '</span></div>'; }).join('') + '<div><span>Total</span><span>' + esc(eur(t)) + '</span></div>';
      });
    });
    var chartTbl = '<details class="tbl"><summary>Show as table</summary><div class="tw"><table class="t compact"><thead><tr><th>Day</th>' + provs.map(function (p) { return '<th class="num">' + esc(pname(p)) + '</th>'; }).join('') + '<th class="num">Total</th></tr></thead><tbody>' +
      cols.map(function (c) { var t = 0; provs.forEach(function (p) { t += c.v[p] || 0; }); return '<tr><td class="nw">' + fdate(c.k) + '</td>' + provs.map(function (p) { return '<td class="num">' + (c.v[p] ? eur(c.v[p]) : '<span class="muted">—</span>') + '</td>'; }).join('') + '<td class="num">' + eur(t) + '</td></tr>'; }).join('') + '</tbody></table></div></details>';
    var kinds = prob ? LREAL.map(function (k) {
      var n = prob.by[k] || 0;
      return '<li><div class="l"><button type="button" class="linkish" data-act="lxKind" data-k="' + k + '" data-f="' + W.from + '" data-t="' + W.to + '">' + esc(LK[k]) + '</button><small>' + esc(LHINT[k].split('.')[0]) + '</small></div><div class="r">' + (n ? '<b style="font-weight:500">' + num(n) + '</b>' : '<span class="muted">0</span>') + '</div></li>';
    }).join('') : '';
    h += '<div class="dash"><section class="card"><div class="card-h"><div><span class="label">Successful payments, EUR</span><h2>Daily volume per provider</h2></div></div><div class="card-b">' +
      (provs.length ? legend(provs, pcol, pname) + '<div class="chart" id="lvChart">' + barChart(cols, provs, pcol, 'Daily successful payment volume per provider, ' + fdate(W.from) + ' to ' + fdate(W.to)) + '</div>' + chartTbl : empty('No successful payments in this period.')) + '</div></section>' +
      '<section class="card"><div class="card-h"><div><span class="label">Open · in this period</span><h2>Problems by kind</h2></div><a class="btn sm" href="#/exceptions">Exceptions</a></div><div class="card-b">' +
      (prob ? '<ul class="list">' + kinds + '</ul><p class="hint" style="margin:10px 0 0">For information, not problems: ' + num(prob.info.paid_in_parts || 0) + ' paid in parts · ' + num(prob.info.refund_credit_note || 0) + ' refunds under a credit note.</p>' : (lwait([ec], 'exceptions') || '')) + '</div></section></div>';

    // by provider and account
    var groups = {};
    A.acc.forEach(function (x) { var g = groups[x.provider + '|' + x.cur] = groups[x.provider + '|' + x.cur] || { provider: x.provider, cur: x.cur, rows: [], t: zeroAgg() }; g.rows.push(x); ['n', 'vol', 'ref', 'nRef', 'cb', 'nCb', 'fees', 'failN', 'failV', 'canN', 'canV', 'rows'].forEach(function (f) { g.t[f] += x[f]; }); });
    var gl = Object.keys(groups).map(function (k) { return groups[k]; }).sort(function (a, b) { return pcmp(a.provider, b.provider) || (a.cur < b.cur ? -1 : 1); });
    function accRow(x, label, cls) {
      return '<tr' + (cls ? ' class="' + cls + '"' : '') + '><td class="nw">' + label + '</td><td class="num">' + num(x.n) + '</td><td class="num">' + lamt(x.vol, x.cur) + '</td><td class="num">' + lamt(x.ref, x.cur) + '</td><td class="num">' + lamt(x.cb, x.cur) + '</td><td class="num">' + lamt(x.fees, x.cur) + '</td><td class="num">' + rate(-x.fees, x.vol) + '</td><td class="num">' + (x.failN ? num(x.failN) : '<span class="muted">0</span>') + '</td></tr>';
    }
    h += '<section class="card" style="margin-bottom:14px"><div class="card-h"><div><span class="label">' + fdate(W.from) + '–' + fdate(W.to) + '</span><h2>By provider and account</h2></div></div><div class="tw"><table class="t"><thead><tr><th>Provider · account</th><th class="num">Payments</th><th class="num">Volume</th><th class="num">Refunds</th><th class="num">Chargebacks</th><th class="num">Fees</th><th class="num">Fee %</th><th class="num">Failed</th></tr></thead><tbody>' +
      (gl.length ? gl.map(function (g) {
        g.t.cur = g.cur;
        return accRow(g.t, pdot(g.provider) + '<b style="font-weight:500">' + esc(pname(g.provider)) + '</b>' + (g.cur !== 'EUR' ? ' <span class="badge plain">' + esc(g.cur) + '</span>' : ''), 'grp') +
          (g.rows.length > 1 ? g.rows.sort(function (a, b) { return a.vol < b.vol ? 1 : -1; }).map(function (x) { return accRow(x, '<span class="indent">' + esc(x.acc || '—') + '</span>'); }).join('') : '');
      }).join('') : '<tr><td colspan="8">' + empty('No payments in this period.') + '</td></tr>') +
      '</tbody><tfoot><tr><td>Total EUR</td><td class="num">' + num(K.n) + '</td><td class="num">' + amt(K.vol) + '</td><td class="num">' + amt(K.ref) + '</td><td class="num">' + amt(K.cb) + '</td><td class="num">' + amt(K.fees) + '</td><td class="num">' + rate(-K.fees, K.vol) + '</td><td class="num">' + num(K.failN) + '</td></tr></tfoot></table></div>' +
      '<p class="hint" style="padding:0 18px 14px;margin:0">Fees include per-payment fees and separate fee rows (Klarna, Adyen invoices). Fee % = −fees ÷ volume. Provider rows show a single account inline.</p></section>';
    h += freshCard(mc.data);
    return h;
  }
  ACT.lxKind = function (d) { stLX.tab = LINFO.indexOf(d.k) >= 0 ? 'info' : 'problems'; stLX.kind = d.k; stLX.status = 'active'; stLX.from = d.f || ''; stLX.to = d.t || ''; stLX.acc = ''; stLX.q = ''; stLX.page = 0; saveUi(); go('#/exceptions'); };
  function freshCard(meta) {
    var fr = (meta.freshness || []).slice().sort(function (a, b) { return pcmp(a.provider, b.provider) || (a.merchant_account < b.merchant_account ? -1 : 1); });
    var newest = meta.dataThrough, ref = fr.map(function (r) { return r.refreshed_at || ''; }).sort().pop();
    var behind = 0, dormant = 0;
    var rows = fr.map(function (r) {
      var lag = r.data_through && newest ? U.diffDays(r.data_through, newest) : null, b;
      if (lag == null) { b = badge('No data', 'b-bad'); behind++; }
      else if (lag > 30) { b = badge('No data since ' + fdate(r.data_through), 'b-clay'); dormant++; }
      else if (lag >= 2) { b = badge(lag + ' days behind', 'b-bad'); behind++; }
      else b = badge(lag ? '1 day behind' : 'Up to date', 'b-good');
      return '<tr' + (lag != null && lag >= 2 ? ' class="flag"' : '') + '><td class="nw">' + pdot(r.provider) + esc(pname(r.provider)) + '</td><td>' + esc(r.merchant_account || '—') + '</td><td class="nw">' + fdate(r.data_through) + '</td><td>' + b + '</td></tr>';
    }).join('');
    return '<section class="card"><div class="card-h"><div><span class="label">Refreshed ' + esc(fts(tsIso(ref))) + '</span><h2>Data freshness per account</h2></div></div>' +
      '<div class="stats"><span>Newest data <b>' + fdate(newest) + '</b></span><span>2+ days behind <b class="' + (behind ? 'neg' : '') + '">' + behind + '</b></span><span>No data for over 30 days <b>' + dormant + '</b> <span class="muted">(closed or unused accounts?)</span></span></div>' +
      '<div class="tw"><table class="t compact"><thead><tr><th>Provider</th><th>Account</th><th>Data through</th><th>Status</th></tr></thead><tbody>' + rows + '</tbody></table></div></section>';
  }

  // ════════════════════════════════════════════════════════════════════════
  // Live · Exceptions
  // ════════════════════════════════════════════════════════════════════════
  PAGERS.lex = stLX;
  function lxFiltered(rows, ignoreStatus) {
    var info = stLX.tab === 'info', kinds = info ? LINFO : LREAL, q = norm(stLX.q);
    var kind = kinds.indexOf(stLX.kind) >= 0 ? stLX.kind : '';
    var out = rows.filter(function (x) {
      if (x.info !== info) return false;
      if (kind && x.kind !== kind) return false;
      if (stLX.acc && x.acc !== stLX.acc) return false;
      if (stLX.from && x.day < stLX.from) return false;
      if (stLX.to && x.day > stLX.to) return false;
      if (!ignoreStatus) {
        if (stLX.status === 'active' && !lxActive(x)) return false;
        if (stLX.status && stLX.status !== 'active' && stLX.status !== 'all' && x.status !== stLX.status) return false;
      }
      if (stLX.owner === '-' && x.owner) return false;
      if (stLX.owner && stLX.owner !== '-' && x.owner !== stLX.owner) return false;
      if (q && norm(x.ref + ' ' + x.detail + ' ' + x.owner + ' ' + x.notes.map(function (n) { return n.text; }).join(' ')).indexOf(q) < 0) return false;
      return true;
    });
    if (ignoreStatus) return out;
    var k = stLX.sort, dir = stLX.dir;
    function val(x) { return k === 'amount' ? Math.abs(x.amount) : k === 'kind' ? LK[x.kind] : k === 'acc' ? x.acc : x.day; }
    out.sort(function (a, b) { var va = val(a), vb = val(b); return (va < vb ? -1 : va > vb ? 1 : a.key < b.key ? -1 : 1) * dir; });
    return out;
  }
  function lsortTh(k, label, cls) {
    var on = stLX.sort === k;
    return '<th' + (cls ? ' class="' + cls + '"' : '') + (on ? ' aria-sort="' + (stLX.dir > 0 ? 'ascending' : 'descending') + '"' : '') + '><button type="button" data-act="lxSort" data-k="' + k + '" data-fid="lxs-' + k + '">' + esc(label) + (on ? (stLX.dir > 0 ? ' ↑' : ' ↓') : '') + '</button></th>';
  }
  ACT.lxSort = function (d) { if (stLX.sort === d.k) stLX.dir = -stLX.dir; else { stLX.sort = d.k; stLX.dir = d.k === 'kind' || d.k === 'acc' ? 1 : -1; } saveUi(); rerender(); };
  ACT.lxClearF = function () { stLX.kind = ''; stLX.acc = ''; stLX.from = ''; stLX.to = ''; stLX.owner = ''; stLX.q = ''; stLX.page = 0; saveUi(); rerender(); };
  function ownerList() { return '<datalist id="lxOwners">' + lowners().map(function (o) { return '<option value="' + esc(o) + '">'; }).join('') + '</datalist>'; }
  function pageLExceptions() {
    var mc = lget(METAURL), ec = lget(EXURL);
    var h = lhead('Exceptions', 'Exception queue<span class="dot">.</span>', 'Found nightly in the live payment data, last 13 months. Give each problem an owner, a status and notes: those decisions are saved in this browser and your private cloud copy; the payment rows never are.',
      '<button type="button" class="btn" data-act="lxCsv"' + (ec.status === 'ok' ? '' : ' disabled') + '>' + ic('exp') + 'Export CSV</button>');
    var w = lwait([mc, ec], 'exceptions'); if (w) return h + w;
    var all = lexRows(ec).map(lxDec);
    var nReal = 0, nInfo = 0; all.forEach(function (x) { if (x.info) nInfo++; else if (lxActive(x)) nReal++; });
    var info = stLX.tab === 'info';
    h += '<div class="seg" role="group" aria-label="Exception group" style="margin-bottom:14px">' + [['problems', 'Problems · ' + num(nReal) + ' open'], ['info', 'For information · ' + num(nInfo)]].map(function (x) {
      return '<button type="button" data-act="lxTab" data-v="' + x[0] + '" data-fid="lxtab-' + x[0] + '" aria-pressed="' + (stLX.tab === x[0] || (x[0] === 'problems' && !info) ? 'true' : 'false') + '">' + esc(x[1]) + '</button>';
    }).join('') + '</div>';
    if (info) h += '<div class="notice">These are not problems. <b>Paid in parts</b>: several payments of different amounts for one order, usually a legitimate split. <b>Refund under a credit note</b>: PayPal refunds filed under a credit-note number (like dIT…); finding their order needs the Alensis credit note list, which is a later step.</div>';
    var base = lxFiltered(all, true), cnt = { open: 0, waiting: 0, resolved: 0, written_off: 0 };
    base.forEach(function (x) { cnt[x.status]++; });
    var rows = lxFiltered(all), SZ = 50;
    Object.keys(lxSel).forEach(function (k) { if (!rows.some(function (x) { return x.key === k; })) delete lxSel[k]; });
    var kinds = info ? LINFO : LREAL, kc = {}; all.forEach(function (x) { kc[x.kind] = (kc[x.kind] || 0) + 1; });
    var accs = {}; all.forEach(function (x) { if (x.info === info && x.acc) accs[x.acc] = 1; });
    h += '<div class="toolbar">' + seg('lex', 'status', stLX.status, [['active', 'Active · ' + (cnt.open + cnt.waiting)], ['open', 'Open · ' + cnt.open], ['waiting', 'Waiting · ' + cnt.waiting], ['resolved', 'Resolved · ' + cnt.resolved], ['written_off', 'Written off · ' + cnt.written_off], ['all', 'All · ' + base.length]], 'Status') + '</div>';
    h += '<div class="toolbar">' + search('lex', 'q', stLX.q, 'Search order number, note, owner') +
      sel('lex', 'kind', opt('', 'All kinds', kinds.indexOf(stLX.kind) >= 0 ? stLX.kind : '') + kinds.map(function (k) { return opt(k, LK[k] + ' · ' + num(kc[k] || 0), stLX.kind); }).join(''), 'Kind') +
      sel('lex', 'acc', opt('', 'All accounts', stLX.acc) + Object.keys(accs).sort().map(function (a) { return opt(a, a, stLX.acc); }).join(''), 'Account') +
      sel('lex', 'owner', opt('', 'Any owner', stLX.owner) + opt('-', 'Unassigned', stLX.owner) + lowners().map(function (o) { return opt(o, o === who() ? o + ' (me)' : o, stLX.owner); }).join(''), 'Owner') +
      '<span class="daterange"><label for="lex-from">From</label><input type="date" id="lex-from" data-fid="lex-from" data-chg="f" data-st="lex" data-k="from" value="' + esc(stLX.from) + '"><label for="lex-to">to</label><input type="date" id="lex-to" data-fid="lex-to" data-chg="f" data-st="lex" data-k="to" value="' + esc(stLX.to) + '"></span>' +
      ((stLX.kind || stLX.acc || stLX.from || stLX.to || stLX.owner || stLX.q) ? '<button type="button" class="btn sm ghost" data-act="lxClearF">Clear filters</button>' : '') + '</div>';
    var nSel = Object.keys(lxSel).length, tot = 0; rows.forEach(function (x) { tot += x.amount; });
    h += '<section class="card"><div class="stats"><span><b>' + num(rows.length) + '</b> ' + (info ? 'item' : 'problem') + (rows.length === 1 ? '' : 's') + '</span><span>Signed total <b>' + eur(tot) + '</b></span>' +
      (nSel ? '<span style="margin-left:auto;display:flex;gap:6px;flex-wrap:wrap"><b>' + nSel + ' selected</b><button type="button" class="btn sm" data-act="lxBulk">Set status / owner…</button><button type="button" class="btn sm ghost" data-act="lxSelClear">Clear</button></span>' : '') + '</div>';
    if (!rows.length) return h + empty(base.length ? 'Nothing matches these filters.' : 'No ' + (info ? 'items' : 'problems') + ' for these filters.') + '</section>';
    var page = rows.slice(stLX.page * SZ, stLX.page * SZ + SZ), allOn = page.every(function (x) { return lxSel[x.key]; });
    h += '<div class="tw"><table class="t"><thead><tr><th class="chk"><input type="checkbox" data-chg="lxAll" data-fid="lx-all" aria-label="Select all on this page"' + (allOn ? ' checked' : '') + '></th>' + lsortTh('kind', 'Kind') + '<th>Order / reference</th>' + lsortTh('acc', 'Account') + lsortTh('day', 'Day') + lsortTh('amount', 'Amount', 'num') + '<th>Owner</th><th>Status</th><th>Last note</th></tr></thead><tbody>' +
      page.map(function (x) {
        var last = x.notes[x.notes.length - 1];
        return '<tr class="click' + (lxSel[x.key] ? ' sel' : '') + '" data-open="lx:' + esc(x.key) + '" tabindex="0" data-fid="lxr-' + esc(x.key) + '" aria-label="' + esc(LK[x.kind] + ' ' + x.ref + ', open details') + '"><td class="chk"><input type="checkbox" data-chg="lxSel" data-id="' + esc(x.key) + '" data-fid="lxc-' + esc(x.key) + '" aria-label="Select ' + esc(LK[x.kind] + ' ' + x.ref) + '"' + (lxSel[x.key] ? ' checked' : '') + '></td>' +
          '<td class="nw">' + esc(LK[x.kind]) + '</td><td class="wide-cell"><b class="ref">' + esc(x.ref) + '</b><small>' + esc(x.detail) + '</small></td>' +
          '<td class="nw">' + esc(x.acc || '—') + (x.market ? '<small>' + esc(x.market) + '</small>' : '') + '</td><td class="nw">' + fdate(x.day) + '<small>' + lxAge(x) + ' d ago</small></td><td class="num">' + amt(x.amount) + '</td>' +
          '<td class="nw">' + (x.owner ? esc(x.owner) : '<span class="muted">Unassigned</span>') + '</td><td>' + exBadge(x.status) + '</td>' +
          '<td>' + (last ? esc(last.text.length > 60 ? last.text.slice(0, 58) + '…' : last.text) + '<small>' + esc(last.by) + ' · ' + fts(last.at) + '</small>' : '<span class="muted">—</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div>' + pager(rows.length, stLX, SZ, 'lex') + '</section>';
    return h;
  }
  ACT.lxTab = function (d) { stLX.tab = d.v; stLX.kind = ''; stLX.acc = ''; stLX.page = 0; lxSel = {}; saveUi(); rerender(); };
  CHG.lxSel = function (el) { if (el.checked) lxSel[el.getAttribute('data-id')] = 1; else delete lxSel[el.getAttribute('data-id')]; rerender(); };
  CHG.lxAll = function (el) { var c = LC[EXURL]; if (!c || c.status !== 'ok') return; lxFiltered(lexRows(c).map(lxDec)).slice(stLX.page * 50, stLX.page * 50 + 50).forEach(function (x) { if (el.checked) lxSel[x.key] = 1; else delete lxSel[x.key]; }); rerender(); };
  ACT.lxSelClear = function () { lxSel = {}; rerender(); };
  ACT.lxCsv = function () {
    var c = LC[EXURL]; if (!c || c.status !== 'ok') return;
    downloadCsv('recon-live-' + (stLX.tab === 'info' ? 'information' : 'exceptions'), LX_HDR, lxFiltered(lexRows(c).map(lxDec)).map(lxCsvRow));
  };
  var LX_HDR = ['Group', 'Kind', 'Order / reference', 'Account', 'Market', 'Day', 'Amount EUR', 'Detail', 'Status', 'Owner', 'Last updated by', 'Last updated at', 'Notes'];
  function lxCsvRow(x) { return [x.info ? 'Information' : 'Problem', LK[x.kind] || x.kind, x.ref, x.acc, x.market, x.day, cc(x.amount), x.detail, EXS[x.status][0], x.owner, x.by || '', x.at || '', x.notes.map(function (n) { return n.by + ' ' + n.at + ': ' + n.text; }).join(' | ')]; }
  ACT.lxBulk = function () {
    var c = LC[EXURL]; if (!c || c.status !== 'ok') return;
    var idx = lexIndex(c), keys = Object.keys(lxSel).filter(function (k) { return idx[k]; });
    modal({
      title: 'Update ' + keys.length + ' exception' + (keys.length === 1 ? '' : 's'), submitLabel: 'Apply',
      body: field('Status', '<select class="in" id="%ID%" name="status" data-autofocus>' + opt('', 'Keep as is', '') + Object.keys(EXS).map(function (k) { return opt(k, EXS[k][0], ''); }).join('') + '</select>') +
        '<label class="check"><input type="checkbox" name="setOwner"> Change the owner</label>' +
        field('Owner', '<input class="in" type="text" id="%ID%" name="owner" list="lxOwners" maxlength="80" autocomplete="off" placeholder="Empty = unassigned">' + ownerList()) +
        field('Note', '<textarea class="in" id="%ID%" name="note" rows="2"></textarea>', 'Required when writing off.'),
      onSubmit: function (f) {
        var st = f.elements.status.value, note = f.elements.note.value.trim(), patch = {};
        if (st === 'written_off' && !note) { f.elements.note.focus(); return 'Add a note that explains the write-off.'; }
        if (st) patch.status = st;
        if (f.elements.setOwner.checked) patch.owner = f.elements.owner.value.trim().slice(0, 80);
        var n = 0;
        keys.forEach(function (k) { if (setLx(lxDec(idx[k]), patch, note)) n++; });
        lxSel = {};
        setTimeout(function () { lcommit('Updated ' + n + ' exception' + (n === 1 ? '' : 's')); }, 0);
        return null;
      }
    });
  };
  function provFor(acc) {
    var c = LC[METAURL]; if (!c || c.status !== 'ok') return null;
    var ps = (c.data.freshness || []).filter(function (r) { return r.merchant_account === acc; }).map(function (r) { return r.provider; });
    return ps.indexOf('Adyen') >= 0 ? 'Adyen' : ps[0] || null;
  }
  function openLx(key) {
    drawer(function () {
      var ec = LC[EXURL]; if (!ec || ec.status !== 'ok') return null;
      var x = lexIndex(ec)[key]; if (!x) return null; lxDec(x);
      var thr = through() || x.day;
      var linked = x.kind === 'payout_difference' ? payoutSection(provFor(x.acc), x.acc, x.ref, [U.addDays(x.day, -10), minD(U.addDays(x.day, 10), thr)]) : orderSection(x.ref);
      var body = '<div class="minis"><div class="mini"><span>Amount</span><b>' + amt(x.amount) + '</b></div><div class="mini"><span>Day</span><b>' + fdate(x.day) + '</b></div><div class="mini"><span>Status</span><b>' + esc(EXS[x.status][0]) + '</b></div></div>' +
        '<div class="notice' + (x.info ? ' ok' : '') + '" style="margin-top:14px">' + esc(LHINT[x.kind] || '') + '</div>' +
        metaGrid([['Kind', esc(LK[x.kind] || x.kind) + (x.info ? ' · information' : '')], ['Reference', esc(x.ref)], ['Account', esc(x.acc || '—')], x.market ? ['Market', esc(x.market)] : null, ['Age', lxAge(x) + ' days']]) +
        '<h3>Status</h3><div class="seg" role="group" aria-label="Status">' + Object.keys(EXS).map(function (k) { return '<button type="button" data-act="lxStatus" data-id="' + esc(x.key) + '" data-v="' + k + '" data-fid="lxst-' + k + '" aria-pressed="' + (x.status === k ? 'true' : 'false') + '">' + esc(EXS[k][0]) + '</button>'; }).join('') + '</div>' +
        '<h3><label for="lxOwner">Owner</label></h3><input class="in" type="text" id="lxOwner" list="lxOwners" maxlength="80" autocomplete="off" placeholder="Unassigned — type a name or e-mail" data-chg="lxOwner" data-id="' + esc(x.key) + '" value="' + esc(x.owner) + '">' + ownerList() +
        '<h3>Notes</h3>' + (x.notes.length ? '<ul class="hist">' + x.notes.slice().reverse().map(function (n) { return '<li>' + esc(n.text) + '<small>' + esc(n.by) + ' · ' + fts(n.at) + '</small></li>'; }).join('') + '</ul>' : '<p class="muted" style="margin:0 0 8px">No notes yet.</p>') +
        '<form class="field" data-lxnote="' + esc(x.key) + '" style="margin-top:8px"><label for="lxNote">Add a note</label><textarea class="in" id="lxNote" name="note" rows="2" maxlength="2000" placeholder="What did you do or find out?"></textarea><div><button type="submit" class="btn sm">Add note</button></div></form>' +
        '<h3>' + (x.kind === 'payout_difference' ? 'Payout batch' : 'Payments for ' + esc(x.ref)) + '</h3>' + linked +
        (x.kind !== 'payout_difference' ? '<div class="dr-actions"><a class="btn" href="#/order/' + encodeURIComponent(x.ref) + '">' + ic('search') + 'Open in order lookup</a></div>' : '');
      return { wide: true, eyebrow: '<span class="eyebrow">' + esc(LK[x.kind] || x.kind) + (x.info ? ' · for information' : '') + '</span>', title: esc(x.ref), sub: '<p class="sub">' + esc(x.detail) + '</p>', body: body };
    });
  }
  ACT.lx = function (d) { openLx(d.id); };
  function lxByKey(k) { var c = LC[EXURL]; return c && c.status === 'ok' ? lexIndex(c)[k] || null : null; }
  ACT.lxStatus = function (d) {
    var x = lxByKey(d.id); if (!x) return; lxDec(x);
    if (x.status === d.v) return;
    if (d.v === 'written_off') {
      modal({ title: 'Write off?', submitLabel: 'Write off', body: '<p>' + esc(LK[x.kind]) + ' · ' + esc(x.ref) + ' · ' + esc(eur(x.amount)) + '</p>' + field('Note (required)', '<textarea class="in" id="%ID%" name="note" rows="2" data-autofocus placeholder="Why, and which account it was posted to"></textarea>'),
        onSubmit: function (f) { var n = f.elements.note.value.trim(); if (!n) return 'A write-off needs a note.'; setLx(x, { status: 'written_off' }, n); setTimeout(function () { lcommit('Written off'); }, 0); return null; } });
      return;
    }
    setLx(x, { status: d.v }); lcommit('Status: ' + EXS[d.v][0]);
  };
  CHG.lxOwner = function (el) { var x = lxByKey(el.getAttribute('data-id')); if (!x) return; lxDec(x); var v = el.value.trim().slice(0, 80); if (setLx(x, { owner: v })) lcommit(v ? 'Assigned to ' + v : 'Unassigned'); };
  document.addEventListener('submit', function (e) {
    var f = e.target.closest('form[data-lxnote]'); if (!f) return;
    e.preventDefault();
    var x = lxByKey(f.getAttribute('data-lxnote')), n = f.elements.note.value.trim();
    if (!x || !n) { f.elements.note.focus(); return; }
    lxDec(x); f.elements.note.value = '';
    setLx(x, {}, n.slice(0, 2000)); lcommit('Note added');
    var t = $('lxNote'); if (t) t.focus();
  });

  // ════════════════════════════════════════════════════════════════════════
  // Live · Order lookup (payments only: there is no orders/invoices table in live mode yet)
  // ════════════════════════════════════════════════════════════════════════
  var REFRE = /^[A-Za-z0-9_-]{1,40}$/;
  function orderSection(ref) {
    if (!REFRE.test(ref)) return '<div class="notice warn" role="alert">An order number has letters, digits, - and _ only (at most 40 characters).</div>';
    var c = lget('/api/recon/order?ref=' + encodeURIComponent(ref));
    var w = lwait([c], 'payments for ' + ref); if (w) return w;
    var os = c.data.orders || [];
    if (!os.length) return '<div class="card">' + empty('No payments found for ' + ref + ' in the last 13 months.', 'Check the number; the payment may be older, or filed under another reference.') + '</div>';
    return os.map(function (o) { return orderCard(o, ref); }).join('');
  }
  function orderCard(o, ref) {
    var ec = LC[EXURL], exs = ec && ec.status === 'ok' ? lexRows(ec).filter(function (x) { return x.ref === o.order_key || x.ref === ref; }).map(lxDec) : [];
    var lines = (o.lines || []).slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    var fe = 0, am = 0, other = false;
    lines.forEach(function (l) { if ((l.currency || 'EUR') === 'EUR') { am += lc(l.amount); fe += lc(l.fee_amount); } else other = true; });
    var cur = lines.length && lines.every(function (l) { return l.currency && l.currency === lines[0].currency; }) ? lines[0].currency : 'EUR';
    var h = '<section class="card ocard"><div class="card-h"><div style="min-width:0"><span class="label">' + esc((o.providers || []).map(pname).join(' · ')) + (o.merchant_account ? ' · ' + esc(o.merchant_account) : '') + (o.market ? ' · ' + esc(o.market) : '') + '</span><h2>' + esc(o.order_key) + '</h2></div>' +
      (exs.length ? '<div class="chips">' + exs.map(function (x) { return '<button type="button" class="rs ' + (x.info ? '' : lxActive(x) ? 'warn' : 'ok') + '" data-act="lx" data-id="' + esc(x.key) + '">' + esc(LK[x.kind]) + ' · ' + esc(EXS[x.status][0]) + '</button>'; }).join('') + '</div>' : '') + '</div><div class="card-b">' +
      '<div class="minis four"><div class="mini"><span>Paid</span><b>' + lamt(lc(o.paid), cur) + '</b></div><div class="mini"><span>Refunded</span><b>' + lamt(lc(o.refunded), cur) + '</b></div><div class="mini"><span>Chargebacks</span><b>' + lamt(lc(o.chargebacks), cur) + '</b></div><div class="mini"><span>Fees</span><b>' + lamt(lc(o.fees), cur) + '</b></div></div>' +
      metaGrid([['First · last day', fdate(o.first_day) + (o.last_day && o.last_day !== o.first_day ? ' – ' + fdate(o.last_day) : '')], ['Successful payments', num(o.n_paid)], ['Failed attempts', num(o.n_failed)], ['Same-amount payments', num(o.same_amount_payments)], ['Largest payment', lamt(lc(o.largest_payment), cur)]]) +
      '<div class="tw"><table class="t compact"><thead><tr><th>Date</th><th>Provider</th><th>Type</th><th>Status</th><th>Method</th><th class="num">Amount</th><th class="num">Fee</th><th>Payout</th></tr></thead><tbody>' +
      (lines.length ? lines.map(function (l) {
        var lcur = l.currency || 'EUR';
        return '<tr><td class="nw">' + fdate(l.date) + '</td><td class="nw">' + pdot(l.provider) + esc(pname(l.provider)) + '<small>' + esc(l.merchant_account || '') + (l.order_reference && l.order_reference !== o.order_key ? ' · ref ' + esc(l.order_reference) : '') + '</small></td><td class="nw">' + esc(typeL(l.type)) + '</td><td>' + statB(l.status) + '</td>' +
          '<td>' + esc(l.payment_method || '—') + (l.card_brand ? '<small>' + esc(l.card_brand) + '</small>' : '') + '</td><td class="num">' + lamt(lc(l.amount), lcur) + '</td><td class="num">' + lamt(lc(l.fee_amount), lcur) + '</td>' +
          '<td class="nw">' + (l.payout_reference ? '<button type="button" class="linkish" data-act="lpay" data-p="' + esc(l.provider) + '" data-a="' + esc(l.merchant_account || '') + '" data-r="' + esc(l.payout_reference) + '" data-d="' + esc(l.date) + '">' + esc(l.payout_reference) + '</button>' : '<span class="muted">—</span>') + '</td></tr>';
      }).join('') : '<tr><td colspan="8" class="muted">No lines.</td></tr>') +
      '</tbody><tfoot><tr><td colspan="5">All lines' + (other ? ' (EUR only)' : '') + '</td><td class="num">' + amt(am) + '</td><td class="num">' + amt(fe) + '</td><td></td></tr></tfoot></table></div></div></section>';
    return h;
  }
  function pageLOrder() {
    var mc = lget(METAURL), ref = '';
    try { ref = route.sub ? decodeURIComponent(route.sub) : ''; } catch (e) { ref = ''; }
    lget(EXURL);
    var h = lhead('Order lookup', 'Order lookup<span class="dot">.</span>', 'Every payment, refund, chargeback, fee and payout reference for one order number, across all providers, for the last 13 months.');
    h += '<form class="toolbar" data-lookup role="search"><label class="sr" for="lkRef">Order number</label><input class="search" type="search" id="lkRef" name="ref" maxlength="40" autocomplete="off" spellcheck="false" value="' + esc(ref) + '" placeholder="Order number"' + (ref ? '' : ' data-autofocus') + '><button type="submit" class="btn pri">' + ic('search') + 'Look up</button></form>';
    h += '<div class="notice">Live mode has the payment side only. Matching payments against Alensis orders and invoices (the demo’s Reconcile workbench) comes once the order list is connected.</div>';
    var w = lwait([mc], 'live payment data'); if (w) return h + w;
    if (!ref) return h + '<section class="card">' + empty('Enter an order number to see its payments.', 'Rows on the Exceptions page open here too.') + '</section>';
    return h + orderSection(ref);
  }
  document.addEventListener('submit', function (e) {
    var f = e.target.closest('form[data-lookup]'); if (!f) return;
    e.preventDefault();
    var v = f.elements.ref.value.trim();
    if (!v) { f.elements.ref.focus(); return; }
    if (!REFRE.test(v)) { toast('An order number has letters, digits, - and _ only.'); f.elements.ref.focus(); return; }
    go('#/order/' + encodeURIComponent(v));
  });

  // ════════════════════════════════════════════════════════════════════════
  // Live · Payouts
  // ════════════════════════════════════════════════════════════════════════
  PAGERS.lpo = stLP;
  function lpConv(x) {
    return { p: x.provider, a: x.merchant_account || '', r: x.payout_reference || '', first: x.first_tx, last: x.last_tx, pdate: x.payout_date, sdate: x.settlement_date, rows: +x.payout_rows || 0,
      paid: x.payout_rows > 0 && x.paid_out != null ? lc(x.paid_out) : null, pay: lc(x.payments), ref: lc(x.refunds), cb: lc(x.chargebacks), fee: lc(x.fees), oth: lc(x.other), exp: lc(x.expected),
      diff: x.difference == null ? null : lc(x.difference), np: +x.n_payments || 0, n: +x.n || 0, date: x.payout_date || x.settlement_date || x.last_tx || '', dateKind: x.payout_date ? 'paid out' : x.settlement_date ? 'settled' : 'last transaction' };
  }
  function lpRows(c) { return memo(c, 'rows', function (d) { return (d.payouts || []).map(lpConv); }); }
  function lpStat(x) {
    if (x.rows > 0) return x.diff ? ['Difference', 'b-bad', 'diff'] : ['Ties out', 'b-good', 'ok'];
    if (x.p === 'Adyen') return ['Not paid out yet', 'b-blue', 'open'];
    return ['Expected net to bank', 'plain', 'batch'];
  }
  function lpFiltered(rows) {
    var q = norm(stLP.q);
    return rows.filter(function (x) {
      if (stLP.prov && x.p !== stLP.prov) return false;
      if (stLP.acc && x.a !== stLP.acc) return false;
      if (stLP.diff && lpStat(x)[2] !== 'diff') return false;
      if (q && norm(x.r + ' ' + x.a).indexOf(q) < 0) return false;
      return true;
    });
  }
  function lpUrl() { var thr = through(), days = ['30', '90', '180', '365'].indexOf(stLP.days) >= 0 ? +stLP.days : 90; return '/api/recon/payouts?from=' + U.addDays(thr, -(days - 1)) + '&to=' + thr; }
  var NOBATCH = 'PayPal, Flik and VALÚ have no batch (payout) reference in their data, so they are not in this list: their money is on the Overview and Fees pages by day, and per order in the order lookup.';
  function pageLPayouts() {
    var mc = lget(METAURL);
    var h = lhead('Payouts', 'Payout batches<span class="dot">.</span>', 'Adyen payouts are checked against what each batch adds up to (paid out − expected = difference). Klarna and Monri have batches without a payout row: their “expected” is the net the bank should receive.',
      '<button type="button" class="btn" data-act="lpCsv">' + ic('exp') + 'Export CSV</button>');
    var w0 = lwait([mc], 'live payment data'); if (w0) return h + w0;
    var pc = lget(lpUrl());
    h += '<div class="notice">' + esc(NOBATCH) + '</div>';
    var rows0 = pc.status === 'ok' ? lpRows(pc) : [];
    var provs = {}, accs = {}; rows0.forEach(function (x) { provs[x.p] = 1; if (!stLP.prov || x.p === stLP.prov) accs[x.a] = 1; });
    h += '<div class="toolbar">' + seg('lpo', 'days', stLP.days, [['30', '30 days'], ['90', '90 days'], ['180', '180 days'], ['365', '12 months']], 'Period') + '</div>' +
      '<div class="toolbar">' + search('lpo', 'q', stLP.q, 'Batch reference or account') +
      sel('lpo', 'prov', opt('', 'All providers', stLP.prov) + Object.keys(provs).sort(pcmp).map(function (p) { return opt(p, pname(p), stLP.prov); }).join(''), 'Provider') +
      sel('lpo', 'acc', opt('', 'All accounts', stLP.acc) + Object.keys(accs).sort().map(function (a) { return opt(a, a, stLP.acc); }).join(''), 'Account') +
      '<label class="check"><input type="checkbox" data-chg="f" data-st="lpo" data-k="diff" data-fid="lpo-diff"' + (stLP.diff ? ' checked' : '') + '> Difference only</label></div>';
    var w = lwait([pc], 'payouts'); if (w) return h + w;
    var rows = lpFiltered(rows0), SZ = 50, cnt = { ok: 0, diff: 0, open: 0, batch: 0 }, te = 0, tp = 0, td = 0;
    rows.forEach(function (x) { cnt[lpStat(x)[2]]++; te += x.exp; if (x.paid != null) tp += x.paid; if (x.diff) td += x.diff; });
    h += '<section class="card"><div class="stats"><span><b>' + num(rows.length) + '</b> batches</span><span>Adyen ties out <b>' + cnt.ok + '</b></span><span>Difference <b class="' + (cnt.diff ? 'neg' : '') + '">' + cnt.diff + '</b></span><span>Adyen not paid out yet <b>' + cnt.open + '</b></span><span>Klarna / Monri batches <b>' + cnt.batch + '</b></span></div>';
    if (!rows.length) return h + empty(rows0.length ? 'No batches match these filters.' : 'No payout batches in this period.') + '</section>';
    h += '<div class="tw"><table class="t"><thead><tr><th>Date</th><th>Provider · account</th><th>Batch</th><th>Transactions</th><th class="num">Payments</th><th class="num">Expected net</th><th class="num">Paid out</th><th class="num">Difference</th><th>Status</th></tr></thead><tbody>' +
      rows.slice(stLP.page * SZ, stLP.page * SZ + SZ).map(function (x) {
        var s = lpStat(x), id = x.p + '|' + x.a + '|' + x.r;
        return '<tr class="click" data-open="lpo:' + esc(id) + '" tabindex="0" data-fid="lpr-' + esc(id) + '" aria-label="' + esc('Batch ' + x.r + ', open details') + '"><td class="nw">' + fdate(x.date) + '<small>' + esc(x.dateKind) + '</small></td><td class="nw">' + pdot(x.p) + esc(pname(x.p)) + '<small>' + esc(x.a) + '</small></td><td class="nw"><b class="ref">' + esc(x.r) + '</b></td>' +
          '<td class="nw">' + fdate(x.first) + (x.last && x.last !== x.first ? '–' + fdate(x.last) : '') + '</td><td class="num">' + num(x.np) + '</td><td class="num"><b style="font-weight:500">' + amt(x.exp) + '</b></td>' +
          '<td class="num">' + (x.paid != null ? amt(x.paid) : '<span class="muted">—</span>') + '</td><td class="num">' + (x.diff == null ? '<span class="muted">—</span>' : x.diff ? '<span class="neg">' + esc(signed(x.diff)) + '</span>' : '<span class="muted">0,00 €</span>') + '</td><td>' + badge(s[0], s[1]) + '</td></tr>';
      }).join('') + '</tbody><tfoot><tr><td colspan="5">Total (' + num(rows.length) + ' batches, all pages)</td><td class="num">' + amt(te) + '</td><td class="num">' + amt(tp) + '</td><td class="num">' + amt(td) + '</td><td></td></tr></tfoot></table></div>' + pager(rows.length, stLP, SZ, 'lpo') + '</section>';
    return h;
  }
  var LP_HDR = ['Provider', 'Account', 'Batch reference', 'First transaction', 'Last transaction', 'Payout date', 'Settlement date', 'Payout rows', 'Payments EUR', 'Refunds EUR', 'Chargebacks EUR', 'Fees EUR', 'Other EUR', 'Expected net EUR', 'Paid out EUR', 'Difference EUR', 'Successful payments', 'Transactions', 'Status'];
  function lpCsvRow(x) { return [pname(x.p), x.a, x.r, x.first || '', x.last || '', x.pdate || '', x.sdate || '', x.rows, cc(x.pay), cc(x.ref), cc(x.cb), cc(x.fee), cc(x.oth), cc(x.exp), x.paid == null ? '' : cc(x.paid), x.diff == null ? '' : cc(x.diff), x.np, x.n, lpStat(x)[0]]; }
  ACT.lpCsv = function () { var c = LC[lpUrl()]; if (!c || c.status !== 'ok') { toast('The payouts are still loading.'); return; } downloadCsv('recon-live-payouts', LP_HDR, lpFiltered(lpRows(c)).map(lpCsvRow)); };
  ACT.lpo = function (d) { var p = d.id.split('|'); openLPayout(p[0], p[1], p.slice(2).join('|'), null); };
  ACT.lpay = function (d) { var thr = through() || d.d; openLPayout(d.p, d.a, d.r, d.d ? [minD(d.d, thr), minD(U.addDays(d.d, 45), thr)] : null); };
  function findPayout(p, a, r, win) {
    var hit = null;
    Object.keys(LC).forEach(function (u) {
      var c = LC[u]; if (hit || u.indexOf('/api/recon/payouts?') !== 0 || c.status !== 'ok') return;
      lpRows(c).some(function (x) { if (x.p === p && x.a === a && x.r === r) { hit = x; return true; } return false; });
    });
    if (hit || !win) return { x: hit };
    var c = lget('/api/recon/payouts?provider=' + encodeURIComponent(p) + '&from=' + win[0] + '&to=' + win[1]);
    return c.status === 'loading' ? { loading: true } : { x: null };
  }
  function payoutSection(p, a, r, win) {
    if (!p) return '<div class="notice">This account is not in the payout data.</div>';
    var f = findPayout(p, a, r, win), x = f.x, h = '';
    if (f.loading) h += lwait([{ status: 'loading' }], 'the batch');
    else if (x) {
      var s = lpStat(x), sum = x.pay + x.ref + x.cb + x.fee + x.oth;
      h += '<div class="minis"><div class="mini"><span>Expected net</span><b>' + amt(x.exp) + '</b></div><div class="mini"><span>Paid out</span><b>' + (x.paid != null ? amt(x.paid) : '—') + '</b></div><div class="mini"><span>Difference</span><b>' + (x.diff == null ? '—' : x.diff ? '<span class="neg">' + esc(signed(x.diff)) + '</span>' : '0,00 €') + '</b></div></div>' +
        metaGrid([['Provider', pdot(x.p) + esc(pname(x.p))], ['Account', esc(x.a)], ['Batch', esc(x.r)], ['Transactions', fdate(x.first) + ' – ' + fdate(x.last)], ['Payout date', fdate(x.pdate)], ['Settlement date', fdate(x.sdate)], ['Successful payments', num(x.np)], ['Status', badge(s[0], s[1])]]) +
        '<h3>Tie-out</h3><div class="tw"><table class="t compact tieout"><tbody>' +
        [['Payments', x.pay], ['Refunds', x.ref], ['Chargebacks', x.cb], ['Fees', x.fee], ['Other', x.oth]].map(function (r2) { return '<tr><td>' + esc(r2[0]) + '</td><td class="num">' + amt(r2[1]) + '</td><td></td></tr>'; }).join('') +
        '<tr class="sum"><td>= Expected net</td><td class="num"><b style="font-weight:500">' + amt(x.exp) + '</b></td><td>' + tie(sum === x.exp, sum === x.exp ? 'adds up' : 'lines add up to ' + eur(sum)) + '</td></tr>' +
        (x.rows > 0 ? '<tr><td>Paid out</td><td class="num">' + amt(x.paid) + '</td><td></td></tr><tr class="sum"><td>Difference = paid out − expected</td><td class="num">' + (x.diff ? '<span class="neg">' + esc(signed(x.diff)) + '</span>' : '0,00 €') + '</td><td>' + tie(!x.diff && x.paid - x.exp === 0, x.diff ? 'difference to explain' : 'ties out') + '</td></tr>' : '') +
        '</tbody></table></div>' +
        (x.rows > 0 ? '' : '<div class="notice" style="margin-top:10px">' + esc(x.p === 'Adyen' ? 'No payout row for this batch yet: it has not been paid out, so there is nothing to compare with.' : pname(x.p) + ' reports the batch, not the bank transfer: “expected net” is what the bank should receive. Compare it with the bank statement.') + '</div>');
    } else h += '<div class="notice">The batch summary is not in the loaded payout periods. The lines below are still complete.</div>';
    var lcache = lget('/api/recon/payout?provider=' + encodeURIComponent(p) + '&account=' + encodeURIComponent(a) + '&ref=' + encodeURIComponent(r));
    h += '<h3>Days and types in this batch</h3>';
    var w = lwait([lcache], 'batch lines'); if (w) return h + w;
    var lines = lcache.data.lines || [], ta = 0, tf = 0, tn = 0, oc = false;
    lines.forEach(function (l) { if ((l.currency || 'EUR') !== 'EUR') { oc = true; return; } if (l.type !== 'PAYOUT') { ta += lc(l.amount); tf += lc(l.fee_amount); } tn += +l.n || 0; });
    h += '<p class="hint" style="margin:0 0 8px">Every day and type for this account from the batch’s first transaction to its payout date (or last transaction). Neighbouring batches can share those days, so the lines total is not the batch total.</p>' +
      '<div class="tw"><table class="t compact"><thead><tr><th>Date</th><th>Type</th><th>Status</th><th>Method</th><th class="num">Count</th><th class="num">Amount</th><th class="num">Fee</th></tr></thead><tbody>' +
      (lines.length ? lines.map(function (l) { var cur = l.currency || 'EUR'; return '<tr><td class="nw">' + fdate(l.date) + '</td><td class="nw">' + esc(typeL(l.type)) + '</td><td>' + statB(l.status) + '</td><td>' + esc(l.payment_method || '—') + (l.card_brand ? '<small>' + esc(l.card_brand) + '</small>' : '') + '</td><td class="num">' + num(l.n) + '</td><td class="num">' + lamt(lc(l.amount), cur) + '</td><td class="num">' + lamt(lc(l.fee_amount), cur) + '</td></tr>'; }).join('') : '<tr><td colspan="7" class="muted">No lines.</td></tr>') +
      '</tbody><tfoot><tr><td colspan="4">Total without payout rows' + (oc ? ' (EUR only)' : '') + '</td><td class="num">' + num(tn) + '</td><td class="num">' + amt(ta) + '</td><td class="num">' + amt(tf) + '</td></tr></tfoot></table></div>' +
      '<div class="dr-actions" style="margin-top:10px"><button type="button" class="btn sm" data-act="lplCsv" data-p="' + esc(p) + '" data-a="' + esc(a) + '" data-r="' + esc(r) + '">' + ic('exp') + 'Lines CSV</button></div>';
    return h;
  }
  ACT.lplCsv = function (d) {
    var c = LC['/api/recon/payout?provider=' + encodeURIComponent(d.p) + '&account=' + encodeURIComponent(d.a) + '&ref=' + encodeURIComponent(d.r)]; if (!c || c.status !== 'ok') return;
    downloadCsv('recon-live-batch-' + d.r.replace(/[^A-Za-z0-9-]+/g, '-'), ['Provider', 'Account', 'Batch', 'Date', 'Type', 'Status', 'Method', 'Card brand', 'Currency', 'Count', 'Amount', 'Fee'], (c.data.lines || []).map(function (l) {
      return [pname(d.p), d.a, d.r, l.date, typeL(l.type), l.status, l.payment_method || '', l.card_brand || '', l.currency || 'EUR', l.n, cc(lc(l.amount)), cc(lc(l.fee_amount))];
    }));
  };
  function openLPayout(p, a, r, win) {
    drawer(function () {
      return { wide: true, eyebrow: '<span class="eyebrow">Payout batch · ' + esc(pname(p)) + ' · ' + esc(a) + '</span>', title: esc(r), body: payoutSection(p, a, r, win) };
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // Live · Fees
  // ════════════════════════════════════════════════════════════════════════
  var LFG = {
    provider: ['Provider', function (r) { return pname(r.provider); }],
    account: ['Account', function (r) { return pname(r.provider) + ' · ' + (r.acc || '—'); }],
    method: ['Method', function (r) { return r.method || '— not given'; }],
    brand: ['Card brand', function (r) { return r.brand || '— not a card'; }],
    month: ['Month', function (r) { return r.month; }]
  };
  function lfRows(c) { return memo(c, 'rows', function (d) { return (d.rows || []).map(function (r) { return { month: r.month, provider: r.provider, acc: r.merchant_account || '', method: r.payment_method || '', brand: r.card_brand || '', n: +r.payments || 0, vol: lc(r.volume), fees: lc(r.fees) }; }); }); }
  function lfGroup(rows, by) {
    var g = {}, tot = { k: 'Total', n: 0, vol: 0, fees: 0 };
    rows.forEach(function (r) { var k = LFG[by][1](r), x = g[k] = g[k] || { k: k, n: 0, vol: 0, fees: 0 }; [x, tot].forEach(function (y) { y.n += r.n; y.vol += r.vol; y.fees += r.fees; }); });
    var out = Object.keys(g).map(function (k) { return g[k]; });
    out.sort(by === 'month' ? function (a, b) { return a.k < b.k ? -1 : 1; } : function (a, b) { return a.fees - b.fees || (a.k < b.k ? -1 : 1); });
    return { rows: out, tot: tot };
  }
  function lfFilter(rows, withMonth) { return rows.filter(function (r) { return (!stLF.prov || r.provider === stLF.prov) && (!stLF.acc || r.acc === stLF.acc) && (!withMonth || !stLF.month || r.month === stLF.month); }); }
  function pageLFees() {
    var mc = lget(METAURL), fc = lget('/api/recon/fees');
    var h = lhead('Fees', 'Provider fees<span class="dot">.</span>', 'Per-payment fees plus separate fee rows, by transaction month, last 12 months. Effective rate = −fees ÷ successful payment volume. Fees are negative.',
      '<button type="button" class="btn" data-act="lfCsv"' + (fc.status === 'ok' ? '' : ' disabled') + '>' + ic('exp') + 'Export CSV</button>');
    var w = lwait([mc, fc], 'fees'); if (w) return h + w;
    var all = lfRows(fc), by = LFG[stLF.by] ? stLF.by : 'provider';
    var provs = {}, accs = {}, months = {}; all.forEach(function (r) { provs[r.provider] = 1; if (!stLF.prov || r.provider === stLF.prov) accs[r.acc] = 1; months[r.month] = 1; });
    var win = fc.data.window || {};
    h += '<div class="toolbar">' + seg('lfe', 'by', by, Object.keys(LFG).map(function (k) { return [k, LFG[k][0]]; }), 'Group by') + '</div><div class="toolbar">' +
      sel('lfe', 'month', opt('', 'Last 12 months', stLF.month) + Object.keys(months).sort().reverse().map(function (m) { return opt(m, monthLabel(m), stLF.month); }).join(''), 'Month') +
      sel('lfe', 'prov', opt('', 'All providers', stLF.prov) + Object.keys(provs).sort(pcmp).map(function (p) { return opt(p, pname(p), stLF.prov); }).join(''), 'Provider') +
      sel('lfe', 'acc', opt('', 'All accounts', stLF.acc) + Object.keys(accs).sort().map(function (a) { return opt(a, a || '—', stLF.acc); }).join(''), 'Account') + '</div>';
    var G = lfGroup(lfFilter(all, true), by), MG = lfGroup(lfFilter(all, false), 'month').rows;
    var wf = (win.from || '').slice(0, 7), wt = (win.to || '').slice(0, 7), thrM = through().slice(0, 7);
    var mcols = MG.map(function (x) { return { k: x.k, label: monthShort(x.k) + (x.k === thrM && monthEnd(x.k) > through() ? ' MTD' : x.k === wf && win.from.slice(8) !== '01' ? ' (part)' : ''), v: { fees: Math.max(0, -x.fees) } }; });
    afterHooks.push(function () { bindTips('lfChart', function (i) { var x = MG[i]; return '<b>' + esc(monthLabel(x.k)) + '</b><div><span><i style="background:var(--s1)"></i>Fees</span><span>' + esc(eur(x.fees)) + '</span></div><div><span>Volume</span><span>' + esc(eur(x.vol)) + '</span></div><div><span>Rate</span><span>' + esc(rate(-x.fees, x.vol)) + '</span></div>'; }); });
    var maxR = 0.00001; G.rows.forEach(function (x) { if (x.vol) maxR = Math.max(maxR, -x.fees / x.vol); });
    var scope = (stLF.prov ? pname(stLF.prov) : 'All providers') + (stLF.acc ? ' · ' + stLF.acc : '');
    h += '<div class="dash"><section class="card"><div class="card-h"><div><span class="label">' + esc(scope) + ' · fees paid, shown as positive</span><h2>Fees by month</h2></div></div><div class="card-b">' +
      (MG.length ? '<div class="chart" id="lfChart">' + barChart(mcols, ['fees'], function () { return 'var(--s1)'; }, 'Fees by month, ' + scope) + '</div>' +
        '<details class="tbl"><summary>Show as table</summary><div class="tw"><table class="t compact"><thead><tr><th>Month</th><th class="num">Volume</th><th class="num">Fees</th><th class="num">Rate</th></tr></thead><tbody>' + MG.map(function (x) { return '<tr><td>' + esc(monthLabel(x.k)) + '</td><td class="num">' + eur(x.vol) + '</td><td class="num">' + eur(x.fees) + '</td><td class="num">' + rate(-x.fees, x.vol) + '</td></tr>'; }).join('') + '</tbody></table></div></details>' : empty('No fees for these filters.')) + '</div></section>' +
      '<section class="card"><div class="card-h"><div><span class="label">' + esc(stLF.month ? monthLabel(stLF.month) : 'Last 12 months') + '</span><h2>Effective rate by ' + esc(LFG[by][0].toLowerCase()) + '</h2></div></div><div class="card-b">' +
      (G.rows.some(function (x) { return x.vol; }) ? '<ul class="list">' + G.rows.filter(function (x) { return x.vol; }).sort(function (a, b) { return -a.fees / a.vol < -b.fees / b.vol ? 1 : -1; }).slice(0, 12).map(function (x) { return '<li><div class="l" style="flex:1"><b style="font-weight:500">' + esc(by === 'month' ? monthLabel(x.k) : x.k) + '</b><div class="bar"><i style="width:' + Math.max(1, -x.fees / x.vol / maxR * 100) + '%"></i></div></div><div class="r">' + rate(-x.fees, x.vol) + '</div></li>'; }).join('') + '</ul>' : empty('No payment volume for these filters.')) + '</div></section></div>';
    h += '<section class="card"><div class="stats"><span>Data <b>' + fdate(win.from) + '–' + fdate(win.to) + '</b></span><span>Groups <b>' + num(G.rows.length) + '</b></span></div><div class="tw"><table class="t"><thead><tr><th>' + esc(LFG[by][0]) + '</th><th class="num">Payments</th><th class="num">Volume</th><th class="num">Fees</th><th class="num">Effective rate</th><th class="num">Avg fee / payment</th></tr></thead><tbody>' +
      (G.rows.length ? G.rows.map(function (x) { return '<tr><td>' + esc(by === 'month' ? monthLabel(x.k) : x.k) + '</td><td class="num">' + num(x.n) + '</td><td class="num">' + amt(x.vol) + '</td><td class="num"><b style="font-weight:500">' + amt(x.fees) + '</b></td><td class="num">' + rate(-x.fees, x.vol) + '</td><td class="num">' + (x.n ? eur(Math.round(x.fees / x.n)) : '—') + '</td></tr>'; }).join('') : '<tr><td colspan="6">' + empty('No fees for these filters.') + '</td></tr>') +
      '</tbody><tfoot><tr><td>Total</td><td class="num">' + num(G.tot.n) + '</td><td class="num">' + amt(G.tot.vol) + '</td><td class="num">' + amt(G.tot.fees) + '</td><td class="num">' + rate(-G.tot.fees, G.tot.vol) + '</td><td class="num">' + (G.tot.n ? eur(Math.round(G.tot.fees / G.tot.n)) : '—') + '</td></tr></tfoot></table></div></section>';
    return h;
  }
  var LF_HDR = ['Month', 'Provider', 'Account', 'Method', 'Card brand', 'Payments', 'Volume EUR', 'Fees EUR', 'Effective rate %'];
  function lfCsvRow(r) { return [r.month, pname(r.provider), r.acc, r.method, r.brand, r.n, cc(r.vol), cc(r.fees), r.vol ? (-r.fees / r.vol * 100).toFixed(3) : '']; }
  ACT.lfCsv = function () {
    var c = LC['/api/recon/fees']; if (!c || c.status !== 'ok') return;
    var by = LFG[stLF.by] ? stLF.by : 'provider', G = lfGroup(lfFilter(lfRows(c), true), by);
    downloadCsv('recon-live-fees-by-' + by, [LFG[by][0], 'Payments', 'Volume EUR', 'Fees EUR', 'Effective rate %', 'Avg fee per payment EUR'], G.rows.concat([G.tot]).map(function (x) {
      return [x.k, x.n, cc(x.vol), cc(x.fees), x.vol ? (-x.fees / x.vol * 100).toFixed(3) : '', x.n ? cc(Math.round(x.fees / x.n)) : ''];
    }));
  };

  // ════════════════════════════════════════════════════════════════════════
  // Live · Month close
  // ════════════════════════════════════════════════════════════════════════
  function lmonths() { var out = [], m = through().slice(0, 7); for (var i = 0; i < 13; i++) { out.push(m); m = U.addDays(m + '-01', -1).slice(0, 7); } return out; }
  function lcUrls(m) { var thr = through(), to = minD(monthEnd(m), thr); return { po: '/api/recon/payouts?from=' + m + '-01&to=' + to, fe: '/api/recon/fees?from=' + m + '-01&to=' + to }; }
  function lcloseCalc(m, ec, pc, fc, meta) {
    var thr = through(), end = monthEnd(m), target = minD(end, meta.dataThrough);
    var fresh = (meta.freshness || []).filter(function (r) { return r.data_through && r.data_through >= m + '-01'; });
    var late = fresh.filter(function (r) { return r.data_through < target; });
    var exs = lexRows(ec).filter(function (x) { return x.day.slice(0, 7) === m; }).map(lxDec);
    var open = exs.filter(function (x) { return !x.info && lxActive(x); }), openV = 0; open.forEach(function (x) { openV += Math.abs(x.amount); });
    var pos = lpRows(pc), diffs = pos.filter(function (x) { return lpStat(x)[2] === 'diff'; });
    var diffOpen = diffs.filter(function (x) { var st = lxStatusOf('payout_difference|' + x.r); return st !== 'resolved' && st !== 'written_off'; });
    var th = S.live.threshold, c = S.live.close[m] || {};
    var checks = { data: !late.length, problems: open.length <= th.count && openV <= th.value, payouts: !diffOpen.length, fees: !!(c.fees && c.fees.at), exported: !!(c.exported && c.exported.at) };
    return { late: late, target: target, exs: exs, open: open, openV: openV, pos: pos, diffs: diffs, diffOpen: diffOpen, fees: lfRows(fc), checks: checks, c: c, ended: end <= thr,
      all: checks.data && checks.problems && checks.payouts && checks.fees && checks.exported };
  }
  var LCHK = { data: 'data complete', problems: 'problems under threshold', payouts: 'payout differences explained', fees: 'fees reviewed', exported: 'export done' };
  function pageLClose() {
    var mc = lget(METAURL), w0 = lwait([mc], 'live payment data');
    if (w0) return lhead('Month close', 'Month close<span class="dot">.</span>') + w0;
    var ms = lmonths(), thr = through(), m = ms.indexOf(stLC.month) >= 0 ? stLC.month : (monthEnd(ms[0]) <= thr ? ms[0] : ms[1]);
    var U2 = lcUrls(m), ec = lget(EXURL), pc = lget(U2.po), fc = lget(U2.fe);
    var c0 = S.live.close[m] || {}, closed = !!(c0.closed && c0.closed.at);
    var h = lhead('Month close', 'Close ' + esc(monthLabel(m)) + '<span class="dot">.</span>', 'Live checks for the month: provider data complete, open problems under the threshold, payout differences explained, fees reviewed and the accounting export done.',
      '<button type="button" class="btn pri" data-act="lExport" data-m="' + m + '"' + ([ec, pc, fc].every(function (c) { return c.status === 'ok'; }) ? '' : ' disabled') + '>' + ic('exp') + 'Export for accounting</button>');
    h += '<div class="toolbar">' + sel('lcl', 'month', ms.map(function (x) { var cx = S.live.close[x] && S.live.close[x].closed; return opt(x, monthLabel(x) + (cx ? ' · closed' : ''), m); }).join(''), 'Month') + '</div>';
    var w = lwait([ec, pc, fc], 'the month’s checks'); if (w) return h + w;
    var K = lcloseCalc(m, ec, pc, fc, mc.data), c = K.c, th = S.live.threshold;
    if (closed) h += '<div class="notice ok closed-banner"><span>Closed by <b>' + esc(c.closed.by) + '</b> on ' + fts(c.closed.at) + (c.closed.note ? ' · “' + esc(c.closed.note) + '”' : '') + '</span><button type="button" class="btn sm" data-act="lReopen" data-m="' + m + '">Reopen…</button></div>';
    else if (!K.ended) h += '<div class="notice">' + esc(monthLabel(m)) + ' is still running (data through ' + fdate(thr) + '). You can work through the list, but closing is only possible once the data covers the whole month.</div>';
    var byKind = {}; K.open.forEach(function (x) { byKind[x.kind] = (byKind[x.kind] || 0) + 1; });
    h += '<section class="card"><ul class="checks">' +
      '<li>' + stIcon(K.checks.data) + '<div><b>Provider data complete</b><p>Every account with data in ' + esc(monthLabel(m)) + ' has data through ' + fdate(K.target) + '.</p>' + (K.late.length ? '<ul class="sublist">' + K.late.map(function (r) { return '<li class="bad"><span>' + esc(pname(r.provider)) + ' · ' + esc(r.merchant_account) + '</span><span>through ' + fdate(r.data_through) + '</span></li>'; }).join('') + '</ul>' : '') + '</div><a class="btn sm" href="#/">Freshness</a></li>' +
      '<li>' + stIcon(K.checks.problems) + '<div><b>Open problems under the threshold</b><p>' + num(K.open.length) + ' open or waiting problems dated in ' + esc(monthLabel(m)) + ' · ' + esc(eur(K.openV)) + ' absolute. Threshold: at most <b>' + th.count + '</b> items and <b>' + esc(eur(th.value)) + '</b>.</p>' +
        (K.open.length ? '<ul class="sublist">' + LREAL.filter(function (k) { return byKind[k]; }).map(function (k) { return '<li class="bad"><span>' + esc(LK[k]) + '</span><span>' + num(byKind[k]) + '</span></li>'; }).join('') + '</ul>' : '') + '</div><div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end"><button type="button" class="btn sm ghost" data-act="lThreshold">Change threshold</button><button type="button" class="btn sm" data-act="lxMonth" data-m="' + m + '">Exceptions</button></div></li>' +
      '<li>' + stIcon(K.checks.payouts) + '<div><b>Payout differences explained</b><p>' + num(K.pos.length) + ' batches in ' + esc(monthLabel(m)) + '; ' + (K.diffs.length ? num(K.diffs.length) + ' Adyen payouts differ from their batch, ' + num(K.diffOpen.length) + ' not yet resolved or written off.' : 'no Adyen payout differs from its batch.') + ' PayPal, Flik and VALÚ have no batches to check.</p>' +
        (K.diffOpen.length ? '<ul class="sublist">' + K.diffOpen.slice(0, 8).map(function (x) { return '<li class="bad"><span><button type="button" class="linkish" data-act="lpo" data-id="' + esc(x.p + '|' + x.a + '|' + x.r) + '">' + esc(x.r) + '</button></span><span>' + esc(signed(x.diff)) + '</span></li>'; }).join('') + '</ul>' : '') + '</div><a class="btn sm" href="#/payouts">Payouts</a></li>' +
      '<li>' + stIcon(K.checks.fees) + '<div><b>Fees reviewed</b><p>' + (K.checks.fees ? 'Ticked by ' + esc(c.fees.by) + ' · ' + fts(c.fees.at) : 'Compare the fee rates on the Fees page with the contracts, then tick.') + '</p></div><label class="check"><input type="checkbox" data-chg="lFeesOk" data-m="' + m + '" data-fid="lfeesok"' + (K.checks.fees ? ' checked' : '') + (closed ? ' disabled' : '') + '> Reviewed</label></li>' +
      '<li>' + stIcon(K.checks.exported) + '<div><b>Export for accounting done</b><p>' + (K.checks.exported ? 'Exported by ' + esc(c.exported.by) + ' · ' + fts(c.exported.at) + (c.exported.files ? ' · ' + esc(c.exported.files.join(', ')) : '') : 'The month’s exceptions, payout batches and fees as CSV. Files are only downloaded to this device.') + '</p></div><button type="button" class="btn sm" data-act="lExport" data-m="' + m + '">' + ic('exp') + 'Export…</button></li>' +
      '</ul><div class="md-foot" style="justify-content:space-between;align-items:center"><span class="hint">' + (closed ? 'Closed.' : K.all ? 'All checks done.' : 'Closing with open checks needs a note.') + '</span>' +
      (closed ? '' : '<button type="button" class="btn pri" data-act="lCloseMonth" data-m="' + m + '"' + (K.ended ? '' : ' disabled') + '>' + ic('check') + 'Close ' + esc(monthLabel(m)) + '</button>') + '</div></section>';
    return h;
  }
  function lcloseNow(m) {
    var mc = LC[METAURL], ec = LC[EXURL], u = lcUrls(m), pc = LC[u.po], fc = LC[u.fe];
    if (![mc, ec, pc, fc].every(function (c) { return c && c.status === 'ok'; })) return null;
    return lcloseCalc(m, ec, pc, fc, mc.data);
  }
  ACT.lxMonth = function (d) { stLX.tab = 'problems'; stLX.kind = ''; stLX.acc = ''; stLX.status = 'active'; stLX.from = d.m + '-01'; stLX.to = monthEnd(d.m); stLX.page = 0; saveUi(); go('#/exceptions'); };
  CHG.lFeesOk = function (el) {
    var m = el.getAttribute('data-m'), c = S.live.close[m] = S.live.close[m] || {};
    if (el.checked) { c.fees = { by: who(), at: nowIso() }; llog('close', 'Fees reviewed for ' + monthLabel(m), '', 'close:' + m); }
    else { delete c.fees; llog('close', 'Fees review un-ticked for ' + monthLabel(m), '', 'close:' + m); }
    lcommit();
  };
  ACT.lThreshold = function () {
    var th = S.live.threshold;
    modal({
      title: 'Problem threshold for month close', submitLabel: 'Save',
      body: '<div class="row2">' + field('Max open problems', '<input class="in" id="%ID%" name="count" inputmode="numeric" value="' + th.count + '" data-autofocus>') + field('Max open value (€)', '<input class="in" id="%ID%" name="value" inputmode="decimal" value="' + NF2.format(th.value / 100).replace(/\s/g, '') + '">') + '</div>',
      onSubmit: function (f) {
        var n = parseInt(f.elements.count.value, 10), v = parseFloat(String(f.elements.value.value).replace(/\./g, '').replace(',', '.'));
        if (!(n >= 0) || !isFinite(v) || v < 0) return 'Enter a whole number of items and an amount of 0 or more.';
        S.live.threshold = { count: n, value: Math.round(v * 100) };
        llog('close', 'Threshold set to ' + n + ' items / ' + eur(S.live.threshold.value), '', 'threshold');
        setTimeout(function () { lcommit('Threshold saved'); }, 0);
        return null;
      }
    });
  };
  ACT.lCloseMonth = function (d) {
    var m = d.m, K = lcloseNow(m);
    if (!K || !K.ended) return;
    modal({
      title: 'Close ' + monthLabel(m) + '?', submitLabel: 'Close month',
      body: (K.all ? '<p>All checks are done. The month is marked closed by ' + esc(who()) + '.</p>' : '<div class="notice warn">Not every check is done: ' + esc(Object.keys(LCHK).filter(function (k) { return !K.checks[k]; }).map(function (k) { return LCHK[k]; }).join(', ')) + '.</div>') +
        field(K.all ? 'Note (optional)' : 'Why close anyway? (required)', '<textarea class="in" id="%ID%" name="note" rows="2" data-autofocus></textarea>'),
      onSubmit: function (f) {
        var note = f.elements.note.value.trim();
        if (!K.all && !note) return 'Explain why the month is closed with open checks.';
        var c = S.live.close[m] = S.live.close[m] || {};
        c.closed = { by: who(), at: nowIso(), note: note, open: Object.keys(LCHK).filter(function (k) { return !K.checks[k]; }) };
        llog('close', 'Closed ' + monthLabel(m) + (K.all ? '' : ' with open checks'), note, 'close:' + m);
        setTimeout(function () { lcommit(monthLabel(m) + ' closed'); }, 0);
        return null;
      }
    });
  };
  ACT.lReopen = function (d) {
    var m = d.m;
    modal({ title: 'Reopen ' + monthLabel(m) + '?', submitLabel: 'Reopen', body: field('Reason (required)', '<textarea class="in" id="%ID%" name="note" rows="2" data-autofocus></textarea>'),
      onSubmit: function (f) {
        var note = f.elements.note.value.trim(); if (!note) return 'Give a reason for reopening.';
        delete S.live.close[m].closed; llog('close', 'Reopened ' + monthLabel(m), note, 'close:' + m);
        setTimeout(function () { lcommit(monthLabel(m) + ' reopened'); }, 0); return null;
      } });
  };
  function laccFiles(m) {
    var lab = m.replace('-', '');
    return {
      exceptions: function () { var K = lcloseNow(m); return downloadCsv('recon-live-' + lab + '-exceptions', ['Month'].concat(LX_HDR), K.exs.map(function (x) { return [m].concat(lxCsvRow(x)); }), true); },
      payouts: function () { var K = lcloseNow(m); return downloadCsv('recon-live-' + lab + '-payouts', ['Month'].concat(LP_HDR), K.pos.map(function (x) { return [m].concat(lpCsvRow(x)); }), true); },
      fees: function () { var K = lcloseNow(m); return downloadCsv('recon-live-' + lab + '-fees', LF_HDR, K.fees.map(lfCsvRow), true); }
    };
  }
  ACT.lExport = function (d) {
    var m = d.m, F = laccFiles(m), done = {};
    if (!lcloseNow(m)) { toast('The month’s data is still loading.'); return; }
    function mark(names) {
      var c = S.live.close[m] = S.live.close[m] || {};
      c.exported = { by: who(), at: nowIso(), files: names };
      llog('export', 'Accounting export for ' + monthLabel(m) + ' (' + names.length + ' file' + (names.length === 1 ? '' : 's') + ')', '', 'close:' + m);
      save(); rerender();
    }
    modal({
      title: 'Export for accounting · ' + monthLabel(m),
      body: '<p>Three CSV files from the live data (UTF-8, comma-separated, signed amounts with a dot decimal). They are only downloaded to this device; nothing is sent anywhere.</p>' +
        '<ul class="list">' + [['exceptions', 'Exceptions', 'problems and information items dated in the month, with status, owner and notes'], ['payouts', 'Payout batches', 'Adyen, Klarna and Monri batches with expected net, paid out and difference'], ['fees', 'Fees', 'per provider, account, method and card brand: payments, volume, fees, rate']].map(function (x) {
          return '<li><div class="l"><b style="font-weight:500">' + esc(x[1]) + '</b><small>' + esc(x[2]) + '</small></div><div class="r"><button type="button" class="btn sm" data-x="' + x[0] + '">' + ic('exp') + 'Download</button></div></li>';
        }).join('') + '</ul>',
      submitLabel: 'Download all 3',
      onSubmit: function () {
        var names = [F.exceptions()];
        setTimeout(function () { names.push(F.payouts()); }, 350);
        setTimeout(function () { names.push(F.fees()); mark(names); toast('Exported 3 files for ' + monthLabel(m)); }, 700);
        return null;
      },
      mount: function (form) {
        form.addEventListener('click', function (e) {
          var b = e.target.closest('[data-x]'); if (!b) return;
          var name = F[b.getAttribute('data-x')]();
          done[b.getAttribute('data-x')] = name;
          b.innerHTML = ic('check') + 'Downloaded';
          var names = Object.keys(done).map(function (k) { return done[k]; });
          if (names.length === 3) { mark(names); toast('All 3 files exported'); } else toast('Downloaded ' + name);
        });
      }
    });
  };

  // ════════════════════════════════════════════════════════════════════════
  // Live · Activity (decisions on live data)
  // ════════════════════════════════════════════════════════════════════════
  PAGERS.llg = stLL;
  var LACTS = { exception: 'Exception', close: 'Month close', export: 'Export' };
  function llRows() { var q = norm(stLL.q); return S.live.log.filter(function (l) { return !q || norm(l.txt + ' ' + l.note + ' ' + l.by).indexOf(q) >= 0; }); }
  function pageLActivity() {
    var rows = llRows(), SZ = 50;
    var h = lhead('Activity', 'Decision log<span class="dot">.</span>', 'Every status, owner and note change on live exceptions and every month-close step, with who and when. Kept in this browser and your private cloud copy.',
      '<button type="button" class="btn" data-act="llCsv">' + ic('exp') + 'Export CSV</button>');
    h += '<div class="toolbar">' + search('llg', 'q', stLL.q, 'Search text, note, person') + '</div>';
    h += '<section class="card"><div class="stats"><span><b>' + num(rows.length) + '</b> entries</span><span>Exceptions with a decision <b>' + num(Object.keys(S.live.ex).length) + '</b></span></div>';
    if (!rows.length) return h + empty(S.live.log.length ? 'Nothing matches.' : 'No decisions yet.', S.live.log.length ? '' : 'Give an exception an owner or a status to start the log.') + '</section>';
    h += '<div class="tw"><table class="t"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>What</th><th>Note</th></tr></thead><tbody>' +
      rows.slice(stLL.page * SZ, stLL.page * SZ + SZ).map(function (l) {
        var open = l.act === 'exception' && l.ref ? '<button type="button" class="linkish" data-act="lx" data-id="' + esc(l.ref) + '">' + esc(l.txt) + '</button>' : esc(l.txt);
        return '<tr><td class="nw">' + fts(l.at) + '</td><td class="nw">' + esc(l.by) + '</td><td class="nw">' + esc(LACTS[l.act] || l.act) + '</td><td>' + open + '</td><td>' + (l.note ? esc(l.note) : '<span class="muted">—</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div>' + pager(rows.length, stLL, SZ, 'llg') + '</section>';
    return h;
  }
  ACT.llCsv = function () { downloadCsv('recon-live-decision-log', ['At', 'By', 'Action', 'What', 'Note', 'Reference'], llRows().map(function (l) { return [l.at, l.by, LACTS[l.act] || l.act, l.txt, l.note, l.ref || '']; })); };

  var NAV_LIVE = [
    ['Overview', '', 'home', null],
    ['Exceptions', 'exceptions', 'alert', function () {
      var c = LC[EXURL]; if (!c || c.status !== 'ok') return '';
      var n = 0; lexRows(c).forEach(function (x) { if (!x.info) { var st = lxStatusOf(x.key); if (st === 'open' || st === 'waiting') n++; } });
      return n ? num(n) + ' open' : '';
    }],
    ['Payouts', 'payouts', 'bank', null],
    ['Fees', 'fees', 'pct', null],
    ['Order lookup', 'order', 'search', null],
    ['Month close', 'close', 'cal', null],
    ['Activity', 'activity', 'list', null]
  ];
  var PAGES_LIVE = { '': pageLOverview, exceptions: pageLExceptions, payouts: pageLPayouts, fees: pageLFees, order: pageLOrder, close: pageLClose, activity: pageLActivity };

  // ════════════════════════════════════════════════════════════════════════
  // Reset, cloud sync, other tabs, start
  // ════════════════════════════════════════════════════════════════════════
  function resetSelections() { selT = {}; selO = {}; exSel = {}; [stM, stE, stP, stB, stL].forEach(function (s) { s.page = 0; }); wbPage.t.page = wbPage.o.page = 0; }
  $('resetBtn').addEventListener('click', function () {
    confirmBox('Reset demo data?', 'This throws away every decision (matches, rejections, exception notes, month closes) and regenerates the demo payments as of today. Decisions on live exceptions are kept. If you are signed in to cloud sync, the reset replaces your cloud copy at the next sync.', 'Reset demo data', function () {
      clearTimeout(saveTimer); saveTimer = null;
      var keepLive = S.live; // live-exception decisions are not demo data: a demo reset keeps them
      S = freshState(TODAY); S.live = keepLive; ensureState(); B = null; loadBase(); seedDemoDecisions(); engine();
      resetSelections(); saveUi();
      var snap = JSON.parse(JSON.stringify(S));
      (idbOK ? enqueue(function () { return idbPut(snap).then(announce); }) : Promise.resolve()).then(syncChanged);
      closeAll();
      if (location.hash === '#/' || location.hash === '') { renderNav(); renderPage(); } else location.hash = '#/';
      toast('Demo data reset');
    }, true);
  });

  var SYNC = null;
  function syncChanged() { if (SYNC) { try { SYNC.changed(); } catch (e) { /* sync unavailable */ } } }
  function applyCloud(data) {
    if (!validState(data)) return Promise.reject(new Error('The cloud copy is not reconciliation data this version can read.'));
    clearTimeout(saveTimer); saveTimer = null;
    S = data; ensureState(); loadBase(); engine(); resetSelections();
    var snap = JSON.parse(JSON.stringify(S));
    var w = idbOK ? enqueue(function () { return idbPut(snap).then(announce); }) : Promise.resolve();
    return w.then(function () { closeAll(); renderNav(); renderPage(); toast('Loaded your reconciliation decisions from the cloud'); });
  }
  // Decisions on live payments go only into the cloud copy of the approved account that is signed in
  // now; on a shared browser another (not approved) account never receives them.
  function syncSnapshot() {
    var snap = JSON.parse(JSON.stringify(S)), u = null;
    try { u = window.AdrialSync.user(); } catch (e) { u = null; }
    var email = u && u.email ? String(u.email).toLowerCase() : '';
    if (!(SESSION.allowed && SESSION.email && String(SESSION.email).toLowerCase() === email)) {
      snap.live = { ex: {}, close: {}, log: [], threshold: (S.live && S.live.threshold) || { count: 10, value: 100000 } };
    }
    return snap;
  }
  function syncStart() {
    if (!window.AdrialSync || SYNC) return;
    try {
      SYNC = window.AdrialSync.attach({ app: 'recon', label: 'Payment reconciliation', getSnapshot: function () { return Promise.resolve(syncSnapshot()); }, applySnapshot: applyCloud });
      var el = $('syncPanel'); if (el) SYNC.mountPanel(el);
    } catch (e) { if (window.console) console.warn('Adrial Recon: cloud sync unavailable', e); }
  }
  if (channel) channel.onmessage = function (e) {
    if (!e.data || e.data.type !== 'changed' || !S || saveTimer) return;
    enqueue(function () { return idbGet(); }).then(function (n) {
      if (!validState(n) || saveTimer) return;
      S = n; ensureState(); loadBase(); engine();
      var hadModal = layers.some(function (L) { return !L.opts.refresh; });
      if (hadModal) { closeAll(); renderNav(); renderPage(); toast('Changed in another tab: the dialog was closed.'); }
      else rerender();
    });
  };

  function boot() {
    return idbGet().then(function (st) {
      if (validState(st)) return { s: st, fresh: false };
      return { s: null, fresh: true };
    }).catch(function (err) { storageFailed(err); return { s: null, fresh: true }; });
  }
  // the first page waits for the live-data session check, so nobody sees demo flash before live (or the reverse)
  Promise.all([boot(), checkSession()]).then(function (all) {
    var r = all[0];
    if (r.s) { S = r.s; ensureState(); loadBase(); }
    else { S = freshState(TODAY); ensureState(); loadBase(); seedDemoDecisions(); }
    engine();
    if (r.fresh && idbOK) { var snap = JSON.parse(JSON.stringify(S)); enqueue(function () { return idbPut(snap); }); }
    onRoute();
    syncStart();
    watchAuth();
    if (r.fresh && MODE === 'demo') setTimeout(function () { toast('Demo data generated · decisions are saved in this browser'); }, 300);
  });
})();
