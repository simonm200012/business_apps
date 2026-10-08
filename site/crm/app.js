/* CRM demo — Adrial Apps. Vanilla JS, hash routing; data in IndexedDB "adrial-crm", view settings in localStorage "adrial-crm-ui". */
(function () {
  'use strict';

  var D = window.CRMDATA;
  if (!D) return;
  var OWNERS = D.OWNERS, STAGES = D.STAGES, SEGMENTS = D.SEGMENTS, SEGMENT_TONE = D.SEGMENT_TONE,
    COUNTRIES = D.COUNTRIES, PRODUCTS = D.PRODUCTS, LOST_REASONS = D.LOST_REASONS, ACT_TYPES = D.ACT_TYPES, SOURCES = D.SOURCES;
  var STAGE = {}, OWNER = {}, PRODUCT = {}, ACT_TYPE = {};
  STAGES.forEach(function (s, i) { s.idx = i; STAGE[s.id] = s; });
  OWNERS.forEach(function (o) { OWNER[o.id] = o; });
  PRODUCTS.forEach(function (p) { PRODUCT[p.id] = p; });
  ACT_TYPES.forEach(function (t) { ACT_TYPE[t.id] = t; });
  var OPEN_STAGES = STAGES.filter(function (s) { return s.open; }).map(function (s) { return s.id; });
  var TYPE_TONE = { call: 'blue', meeting: 'violet', email: 'teal', task: 'clay' };
  var DAY = 864e5;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  // ── Text, numbers, dates ──────────────────────────────────────────────────
  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return ESC[c]; }); }
  function norm(s) { return String(s || '').replace(/[Đđ]/g, 'dj').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function matchQ(q, hay) {
    var toks = norm(q).trim().split(/\s+/).filter(Boolean);
    if (!toks.length) return true;
    var h = norm(hay);
    return toks.every(function (t) { return h.indexOf(t) >= 0; });
  }
  var fmtEUR = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0, minimumFractionDigits: 0 });
  var fmtEUR2 = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var fmtInt = new Intl.NumberFormat('en-IE');
  function money(v) { return fmtEUR.format(Math.round(v || 0)); }
  function money2(v) { return fmtEUR2.format(v || 0); }
  function moneyK(v) {
    v = Math.round(v || 0); var a = Math.abs(v);
    if (a >= 1e6) return '€' + (v / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
    if (a >= 1e3) return '€' + (v / 1e3).toFixed(a >= 1e5 ? 0 : 1).replace(/\.0$/, '') + 'k';
    return '€' + v;
  }
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(ms) { var d = new Date(ms); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function hhmm(ms) { var d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function parseYmd(s) { var p = String(s).split('-').map(Number); return new Date(p[0], (p[1] || 1) - 1, p[2] || 1).getTime(); }
  function todayYmd() { return ymd(Date.now()); }
  function addDays(s, n) { var d = new Date(parseYmd(s)); d.setDate(d.getDate() + n); return ymd(d.getTime()); }
  function daysBetween(a, b) { return Math.round((parseYmd(b) - parseYmd(a)) / DAY); }
  function validYmd(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s) && ymd(parseYmd(s)) === s; }
  function fmtDate(s) {
    if (!s) return '—';
    var d = new Date(parseYmd(s)), y = d.getFullYear();
    return d.getDate() + ' ' + MON[d.getMonth()] + (y !== new Date().getFullYear() ? ' ' + y : '');
  }
  function fmtDateFull(s) { if (!s) return '—'; var d = new Date(parseYmd(s)); return d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear(); }
  function fmtStamp(ms) { return ms ? fmtDate(ymd(ms)) + ' · ' + hhmm(ms) : '—'; }
  function relDay(s) {
    var n = daysBetween(todayYmd(), s);
    if (n === 0) return 'today'; if (n === 1) return 'tomorrow'; if (n === -1) return 'yesterday';
    return n > 0 ? 'in ' + n + ' d' : -n + ' d ago';
  }
  function ago(ms) {
    var m = (Date.now() - ms) / 6e4;
    if (m < 1) return 'just now'; if (m < 60) return Math.floor(m) + ' min ago';
    if (m < 1440) return Math.floor(m / 60) + ' h ago';
    return relDay(ymd(ms));
  }
  function quarterOf(s) {
    var d = new Date(parseYmd(s)), y = d.getFullYear(), q = Math.floor(d.getMonth() / 3);
    var start = y + '-' + pad(q * 3 + 1) + '-01';
    var end = ymd(new Date(y, q * 3 + 3, 0).getTime());
    return { start: start, end: end, label: 'Q' + (q + 1) + ' ' + y };
  }
  function weekStartOf(s) { var d = new Date(parseYmd(s)); var w = (d.getDay() + 6) % 7; return addDays(s, -w); }
  function isoWeek(s) { var d = new Date(parseYmd(s)); d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7); var w1 = new Date(d.getFullYear(), 0, 4); return 1 + Math.round(((d - w1) / DAY - 3 + (w1.getDay() + 6) % 7) / 7); }
  function sum(arr, f) { var s = 0; for (var i = 0; i < arr.length; i++) s += f(arr[i]); return s; }
  function isEmail(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s); }

  // ── Icons ─────────────────────────────────────────────────────────────────
  var ICONS = {
    call: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
    meeting: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18 14.6c1.9.7 3.1 2.5 3.5 5.4"/>',
    email: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
    task: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 12l3 3 5-6"/>',
    note: '<path d="M5 4h10l4 4v12H5zM14 4v5h5M8 13h8M8 17h5"/>',
    stage: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    deal: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    download: '<path d="M12 4v12M6 10l6 6 6-6M5 20h14"/>',
    upload: '<path d="M12 20V8M6 14l6-6 6 6M5 4h14"/>',
    chevL: '<path d="M15 6l-6 6 6 6"/>',
    chevR: '<path d="M9 6l6 6-6 6"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    check: '<path d="M5 12l5 5L20 7"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    company: '<path d="M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16M15 9h4a1 1 0 0 1 1 1v11M3 21h18M8 8h3M8 12h3M8 16h3"/>',
    contact: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
    star: '<path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z"/>'
  };
  function icon(n, cls) { return '<svg class="' + (cls || 'ic') + '" viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[n] || '') + '</svg>'; }

  // ── Storage ───────────────────────────────────────────────────────────────
  // The CRM database lives in IndexedDB (db "adrial-crm", store "kv", key "data") because all Adrial Apps
  // share one origin's ~5 MB localStorage quota. Only view settings stay in localStorage ("adrial-crm-ui").
  // A legacy "adrial-crm-data" localStorage value is migrated once and then removed.
  var KEY = 'adrial-crm-data', UIKEY = 'adrial-crm-ui', VER = 1;
  var IDB_NAME = 'adrial-crm', IDB_STORE = 'kv', IDB_KEY = 'data';
  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function lsDel(k) { try { window.localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  function validDb(d) { return !!(d && d.version === VER && Array.isArray(d.deals) && Array.isArray(d.companies) && Array.isArray(d.contacts) && Array.isArray(d.activities) && Array.isArray(d.notes) && d.seq); }

  var idbP = null;
  function idbOpen() {
    if (idbP) return idbP;
    idbP = new Promise(function (resolve) {
      var req;
      try { if (!window.indexedDB) { resolve(null); return; } req = window.indexedDB.open(IDB_NAME, 1); } catch (e) { resolve(null); return; }
      req.onupgradeneeded = function () { var d = req.result; if (!d.objectStoreNames.contains(IDB_STORE)) d.createObjectStore(IDB_STORE); };
      req.onsuccess = function () { var d = req.result; d.onversionchange = function () { d.close(); idbP = null; }; resolve(d); };
      req.onerror = function () { resolve(null); };
    });
    return idbP;
  }
  function idbTx(mode, fn) {
    return idbOpen().then(function (d) {
      if (!d) throw new Error('IndexedDB unavailable');
      return new Promise(function (resolve, reject) {
        var tx, r, out;
        try { tx = d.transaction(IDB_STORE, mode); r = fn(tx.objectStore(IDB_STORE)); } catch (e) { reject(e); return; }
        if (r) r.onsuccess = function () { out = r.result; };
        tx.oncomplete = function () { resolve(out); };
        tx.onerror = tx.onabort = function () { reject(tx.error || new Error('IndexedDB transaction failed')); };
      });
    });
  }
  function idbGet() { return idbTx('readonly', function (st) { return st.get(IDB_KEY); }); }
  function idbPut(v) { return idbTx('readwrite', function (st) { return st.put(v, IDB_KEY); }); }
  function idbClear() { return idbTx('readwrite', function (st) { return st.clear(); }); }

  var db = null; // loaded asynchronously in boot()
  var maps = null, saveWarned = false;
  function M() {
    if (!maps) {
      var mk = function (arr) { var m = new Map(); arr.forEach(function (x) { m.set(x.id, x); }); return m; };
      maps = { co: mk(db.companies), ct: mk(db.contacts), dl: mk(db.deals), act: mk(db.activities), note: mk(db.notes) };
    }
    return maps;
  }

  // Saves are debounced and serialised: one write in flight at a time, the latest state always wins.
  // put() structured-clones the object synchronously, so later in-memory edits cannot leak into a running write.
  var dirty = false, writing = null, saveTimer = null;
  var TAB_ID = Math.random().toString(36).slice(2);
  var bc = null;
  try { if ('BroadcastChannel' in window) bc = new BroadcastChannel('adrial-crm'); } catch (e) { bc = null; }
  function save() {
    maps = null; scoreCache = null; dupCache = null; dirty = true;
    clearTimeout(saveTimer); saveTimer = setTimeout(flush, 250);
  }
  function flush() {
    saveTimer = null;
    if (writing) return writing;               // the running write re-flushes when it sees dirty
    if (!dirty || !db) return Promise.resolve(true);
    dirty = false;
    var silent = silentNext; silentNext = false;
    writing = idbPut(db).then(function () { return true; }, function () { return false; }).then(function (ok) {
      writing = null;
      if (!ok && !saveWarned) {
        saveWarned = true;
        toast('Changes could not be saved in this browser (storage blocked or full). They last until you reload.');
      }
      if (ok) syncPending = false; // our state is now the newest; other tabs reload from it
      if (ok && !silent && crmSync) crmSync.changed();
      if (ok && bc) { try { bc.postMessage({ type: 'changed', from: TAB_ID }); } catch (e) { /* ignore */ } }
      return dirty ? flush() : ok;
    });
    return writing;
  }
  function flushNow() { clearTimeout(saveTimer); return flush(); }
  var silentNext = false;
  window.addEventListener('pagehide', function () { if (dirty) flushNow(); });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden' && dirty) flushNow(); });

  // Another tab saved: reload from IndexedDB (deferred while this tab has unsaved edits or an open dialog).
  var syncPending = false;
  function syncFromIdb() {
    if (!db) return;
    if (dirty || writing || stack.length) { syncPending = true; return; }
    syncPending = false;
    idbGet().then(function (d) {
      if (!validDb(d)) return;
      if (dirty || writing || stack.length) { syncPending = true; return; }
      db = migrate(d); maps = null; scoreCache = null; dupCache = null; updateNav(); refresh();
    }, function () { /* ignore */ });
  }
  if (bc) bc.onmessage = function (e) { var m = e.data || {}; if (m.type === 'changed' && m.from !== TAB_ID) syncFromIdb(); };

  function loadDb() {
    return idbGet().then(function (d) { return validDb(d) ? d : null; }, function () { return null; }).then(function (stored) {
      if (stored) { lsDel(KEY); return stored; }
      var raw = lsGet(KEY), legacy = null;
      if (raw) { try { var x = JSON.parse(raw); if (validDb(x)) legacy = x; } catch (e) { legacy = null; } }
      db = legacy || D.generate(Date.now());
      dirty = true; silentNext = !legacy;
      return flushNow().then(function (ok) { if (ok && raw) lsDel(KEY); return db; }); // keep the legacy copy if IndexedDB failed
    });
  }
  function commit(noRefresh) { save(); updateNav(); publishSoon(); if (!noRefresh) refresh(); }
  function whenReady(fn) { return function () { if (db) fn.apply(null, arguments); }; }

  var UIDEF = {
    me: 'all',
    co: { q: '', country: '', segment: '', score: '', sort: 'name', dir: 1 },
    ct: { q: '', country: '', segment: '', sort: 'name', dir: 1 },
    dl: { q: '', country: '', segment: '', status: 'open', stage: '', close: '', score: '', sort: 'expectedClose', dir: 1 },
    board: { q: '', country: '', segment: '' },
    act: { status: 'open', type: '', q: '', limit: 120 },
    week: { offset: 0, type: '', hideDone: false },
    tpl: { q: '', cat: '', owner: '' },
    digest: { offset: 0 }
  };
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function loadUi() {
    var u = {}, out = clone(UIDEF);
    try { u = JSON.parse(lsGet(UIKEY) || '{}') || {}; } catch (e) { u = {}; }
    Object.keys(out).forEach(function (k) {
      if (u[k] == null) return;
      if (typeof out[k] === 'object') { if (typeof u[k] === 'object') Object.keys(out[k]).forEach(function (kk) { if (u[k][kk] != null && typeof u[k][kk] === typeof out[k][kk]) out[k][kk] = u[k][kk]; }); }
      else if (typeof u[k] === typeof out[k]) out[k] = u[k];
    });
    if (out.me !== 'all' && !OWNER[out.me]) out.me = 'all';
    out.act.limit = 120; out.week.offset = 0; out.digest.offset = 0;
    return out;
  }
  var ui = loadUi();
  function saveUi() { lsSet(UIKEY, JSON.stringify(ui)); }
  function setUi(path, val) {
    var p = path.split('.');
    if (p.length === 2 && ui[p[0]] && typeof ui[p[0]] === 'object') ui[p[0]][p[1]] = val; else if (p.length === 1) ui[p[0]] = val;
    if (p[0] === 'act' && p[1] !== 'limit') ui.act.limit = 120;
    saveUi();
  }

  // ── Domain helpers ────────────────────────────────────────────────────────
  function mine(x) { return ui.me === 'all' || x.owner === ui.me; }
  function lineTotal(l) { return Math.round((+l.qty || 0) * (+l.price || 0) * (1 - (+l.discount || 0) / 100) * 100) / 100; }
  function dealValue(d) { return sum(d.lines || [], lineTotal); }
  function isOpen(d) { return !!(STAGE[d.stage] && STAGE[d.stage].open); }
  function prob(d) { return STAGE[d.stage] ? STAGE[d.stage].prob : 0; }
  function weighted(d) { return dealValue(d) * prob(d) / 100; }
  function daysInStage(d) { return Math.max(0, daysBetween(ymd(d.stageEnteredAt), todayYmd())); }
  function closeOverdue(d) { return isOpen(d) && d.expectedClose && d.expectedClose < todayYmd(); }
  function actDate(a) { return a.due.slice(0, 10); }
  function actTime(a) { return a.due.slice(11, 16); }
  function actMs(a) { return parseYmd(actDate(a)) + ((+a.due.slice(11, 13) || 0) * 60 + (+a.due.slice(14, 16) || 0)) * 6e4; }
  function actState(a) { if (a.done) return 'done'; var d = actDate(a), t = todayYmd(); return d < t ? 'overdue' : d === t ? 'today' : 'upcoming'; }
  function personName(c) { return c ? ((c.firstName || '') + ' ' + (c.lastName || '')).trim() : ''; }
  function company(id) { return id == null ? null : M().co.get(id) || null; }
  function contact(id) { return id == null ? null : M().ct.get(id) || null; }
  function deal(id) { return id == null ? null : M().dl.get(id) || null; }
  function defaultOwner() { return ui.me !== 'all' ? ui.me : 'u1'; }
  function ownerName(id) { return OWNER[id] ? OWNER[id].name : 'Unassigned'; }
  function byName(a, b) { return a.name.localeCompare(b.name, 'sl', { sensitivity: 'base' }); }

  // ── Small HTML helpers ────────────────────────────────────────────────────
  function ownerAv(id, lg) {
    var o = OWNER[id];
    if (!o) return '<span class="av tone-grey" title="Unassigned">?</span>';
    return '<span class="av tone-' + o.tone + (lg ? ' lg' : '') + '" title="' + esc(o.name) + '" role="img" aria-label="Owner ' + esc(o.name) + '">' + esc(o.initials) + '</span>';
  }
  function ownerChip(id) {
    var o = OWNER[id];
    return '<span class="who">' + ownerAv(id) + '<span>' + esc(o ? o.name : 'Unassigned') + '</span></span>';
  }
  function stageChip(id) { var s = STAGE[id]; return s ? '<span class="chip tone tone-' + s.tone + '"><span class="d"></span>' + esc(s.name) + '</span>' : ''; }
  function segChip(seg) { return '<span class="chip tone tone-' + (SEGMENT_TONE[seg] || 'grey') + '">' + esc(seg) + '</span>'; }
  function opts(list, val) {
    return list.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(val == null ? '' : val) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('');
  }
  function ownerOpts(val, withAll) {
    return opts((withAll ? [['all', 'All owners']] : []).concat(OWNERS.map(function (o) { return [o.id, o.name]; })), val);
  }
  function head(o) {
    return '<header class="head"><div>' +
      (o.crumb ? '<a class="crumb" href="' + o.crumbHref + '">' + icon('chevL') + esc(o.crumb) + '</a>' : '<span class="crumb">' + esc(o.eyebrow || '') + '</span>') +
      '<h1>' + esc(o.title) + (/[.!?]$/.test(o.title) ? '' : '<span class="dot" aria-hidden="true">.</span>') + '</h1>' + (o.sub ? '<p class="sub">' + o.sub + '</p>' : '') +
      '</div>' + (o.actions ? '<div class="actions">' + o.actions + '</div>' : '') + '</header>';
  }
  function btn(label, act, data, cls, ic) {
    var attrs = Object.keys(data || {}).map(function (k) { return ' data-' + k + '="' + esc(data[k]) + '"'; }).join('');
    return '<button type="button" class="btn ' + (cls || '') + '" data-act="' + act + '"' + attrs + '>' + (ic ? icon(ic) : '') + esc(label) + '</button>';
  }
  function th(scope, col, label, cls, descFirst) {
    var s = ui[scope], active = s.sort === col;
    return '<th class="' + (cls || '') + '" aria-sort="' + (active ? (s.dir > 0 ? 'ascending' : 'descending') : 'none') + '">' +
      '<button type="button" class="sortbtn" id="sort-' + scope + '-' + col + '" data-act="sort" data-scope="' + scope + '" data-col="' + col + '"' + (descFirst ? ' data-desc="1"' : '') + '>' +
      esc(label) + (active ? '<i aria-hidden="true">' + (s.dir > 0 ? '↑' : '↓') + '</i>' : '') + '</button></th>';
  }
  function sortRows(rows, getters, key, dir) {
    var g = getters[key] || getters[Object.keys(getters)[0]];
    return rows.slice().sort(function (a, b) {
      var x = g(a), y = g(b), r;
      if (typeof x === 'string' || typeof y === 'string') r = String(x == null ? '' : x).localeCompare(String(y == null ? '' : y), 'sl', { sensitivity: 'base' });
      else r = (x == null ? -Infinity : x) - (y == null ? -Infinity : y);
      if (r === 0 || isNaN(r)) r = (a.id || 0) - (b.id || 0);
      return r * dir;
    });
  }
  function segButtons(key, cur, list, label) {
    return '<div class="seg" role="group" aria-label="' + esc(label) + '">' + list.map(function (o) {
      return '<button type="button" id="seg-' + key.replace('.', '-') + '-' + (o[0] || 'all') + '" data-act="seg" data-key="' + key + '" data-val="' + esc(o[0]) + '" aria-pressed="' + (String(cur) === String(o[0])) + '">' + esc(o[1]) + '</button>';
    }).join('') + '</div>';
  }
  function filterSelect(id, key, cur, list, label) {
    return '<label class="sr" for="' + id + '">' + esc(label) + '</label><select class="select" id="' + id + '" data-chg="ui" data-key="' + key + '">' + opts(list, cur) + '</select>';
  }
  function ownerFilter(id) {
    return '<label class="sr" for="' + id + '">Owner</label><select class="select" id="' + id + '" data-chg="me">' + ownerOpts(ui.me, true) + '</select>';
  }
  function searchBox(id, key, val, ph) {
    return '<label class="sr" for="' + id + '">' + esc(ph) + '</label><input class="search" type="search" id="' + id + '" data-in="ui" data-key="' + key + '" value="' + esc(val) + '" placeholder="' + esc(ph) + '" autocomplete="off">';
  }
  var SEG_OPTS = [['', 'All segments']].concat(SEGMENTS.map(function (s) { return [s, s]; }));
  var COUNTRY_SEG = [['', 'All'], ['SI', 'SI'], ['HR', 'HR']];
  function scopeLabel() { return ui.me === 'all' ? 'all owners' : ownerName(ui.me); }

  // ── Toast ─────────────────────────────────────────────────────────────────
  var toastTimer = null;
  function toast(msg) {
    var t = $('#toast'); if (!t) return;
    t.textContent = msg; t.classList.add('on');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('on'); }, 3200);
  }

  // ── Layers: modals, popover menu ──────────────────────────────────────────
  var stack = [], pop = null, modalSeq = 0;
  var FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  function openModal(o) {
    closePop(false);
    var id = 'md' + (++modalSeq), layer = $('#layer');
    var prev = document.activeElement;
    var scrim = document.createElement('div'); scrim.className = 'scrim';
    var m = document.createElement('div');
    m.className = 'modal' + (o.cls ? ' ' + o.cls : '');
    m.setAttribute('role', o.role || 'dialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-labelledby', id + 't');
    var bodyTag = o.onSubmit ? 'form' : 'div';
    m.innerHTML = '<div class="md-head"><h2 id="' + id + 't">' + esc(o.title) + '</h2><button type="button" class="btn icon ghost" data-close aria-label="Close">' + icon('close') + '</button></div>' +
      '<' + bodyTag + ' class="md-body" id="' + id + 'b"' + (o.onSubmit ? ' novalidate' : '') + '>' + o.body + '</' + bodyTag + '>' +
      (o.foot ? '<div class="md-foot">' + o.foot.replace(/\{form\}/g, id + 'b') + '</div>' : '');
    layer.appendChild(scrim); layer.appendChild(m);
    var closed = false;
    var api = {
      el: m, form: o.onSubmit ? m.querySelector('form') : null,
      close: function (silent) {
        if (closed) return; closed = true;
        scrim.remove(); m.remove();
        var i = stack.indexOf(api); if (i >= 0) stack.splice(i, 1);
        if (o.onClose && !silent) o.onClose();
        if (syncPending && !stack.length) setTimeout(syncFromIdb, 0);
        if (prev && prev.isConnected && typeof prev.focus === 'function') prev.focus({ preventScroll: true });
      }
    };
    scrim.addEventListener('click', function () { api.close(); });
    $$('[data-close]', m).forEach(function (b) { b.addEventListener('click', function () { api.close(); }); });
    if (api.form) api.form.addEventListener('submit', function (e) { e.preventDefault(); o.onSubmit(api); });
    stack.push(api);
    if (o.onOpen) o.onOpen(api);
    var f = m.querySelector('[autofocus]') || m.querySelector('.md-body').querySelector(FOCUSABLE) || m.querySelector(FOCUSABLE);
    if (f) f.focus();
    return api;
  }
  function closeAllModals() { while (stack.length) stack[stack.length - 1].close(); }
  function formError(api, msg, fieldId) {
    var box = api.el.querySelector('.err.form-err');
    if (!box) { box = document.createElement('div'); box.className = 'err form-err'; box.setAttribute('role', 'alert'); api.form.insertBefore(box, api.form.firstChild); }
    box.textContent = msg;
    $$('[aria-invalid="true"]', api.el).forEach(function (x) { x.removeAttribute('aria-invalid'); });
    if (fieldId) { var f = api.el.querySelector('#' + fieldId); if (f) { f.setAttribute('aria-invalid', 'true'); f.focus(); } }
  }
  function confirmDialog(o) {
    return new Promise(function (resolve) {
      var done = false;
      var api = openModal({
        title: o.title, role: 'alertdialog',
        body: '<p style="margin:0;color:var(--ink2)">' + esc(o.text) + '</p>' + (o.extra || ''),
        foot: '<button type="button" class="btn ghost" data-close>Cancel</button><button type="button" class="btn ' + (o.danger ? 'danger' : 'pri') + '" data-ok>' + esc(o.ok || 'OK') + '</button>',
        onClose: function () { if (!done) { done = true; resolve(null); } }
      });
      var ok = api.el.querySelector('[data-ok]');
      ok.addEventListener('click', function () { done = true; var el = api.el; api.close(true); resolve(el); });
      if (!o.extra) ok.focus();
    });
  }
  function openPop(anchor, items) {
    closePop(false);
    var p = document.createElement('div');
    p.className = 'pop'; p.setAttribute('role', 'menu');
    p.innerHTML = items.map(function (it, i) { return '<button type="button" role="menuitem" data-i="' + i + '">' + (it.icon ? icon(it.icon) : '') + esc(it.label) + '</button>'; }).join('');
    $('#layer').appendChild(p);
    var r = anchor.getBoundingClientRect();
    p.style.top = Math.round(r.bottom + 6) + 'px';
    p.style.right = Math.max(8, Math.round(window.innerWidth - r.right)) + 'px';
    anchor.setAttribute('aria-expanded', 'true');
    pop = { el: p, anchor: anchor };
    p.addEventListener('click', function (e) {
      var b = e.target.closest('[data-i]'); if (!b) return;
      closePop(false); items[+b.dataset.i].run();
    });
    p.addEventListener('keydown', function (e) {
      var bs = $$('button', p), i = bs.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); bs[(i + 1) % bs.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); bs[(i - 1 + bs.length) % bs.length].focus(); }
      else if (e.key === 'Tab') { closePop(false); }
    });
    p.querySelector('button').focus();
  }
  function closePop(refocus) {
    if (!pop) return;
    pop.el.remove(); pop.anchor.setAttribute('aria-expanded', 'false');
    if (refocus) pop.anchor.focus();
    pop = null;
  }
  document.addEventListener('mousedown', function (e) { if (pop && !pop.el.contains(e.target) && !pop.anchor.contains(e.target)) closePop(false); });

  // ── Sidebar (narrow screens) ──────────────────────────────────────────────
  function openSide() {
    $('#side').classList.add('open'); $('#sideScrim').hidden = false; $('#menuBtn').setAttribute('aria-expanded', 'true');
    var a = $('#side .nav a'); if (a) a.focus();
  }
  function closeSide(refocus) {
    var s = $('#side'); if (!s.classList.contains('open')) return;
    s.classList.remove('open'); $('#sideScrim').hidden = true; $('#menuBtn').setAttribute('aria-expanded', 'false');
    if (refocus) $('#menuBtn').focus();
  }

  // ── Router ────────────────────────────────────────────────────────────────
  var current = { parts: [] };
  var tlExpanded = false;
  function parseHash() {
    var h = (location.hash || '').replace(/^#\/?/, '').split('?')[0];
    return { parts: h.split('/').filter(Boolean).map(decodeURIComponent) };
  }
  function route(focus) {
    closeSide(false); closeAllModals(); closePop(false);
    var next = parseHash();
    if (next.parts.join('/') !== current.parts.join('/')) tlExpanded = false;
    current = next;
    render();
    window.scrollTo(0, 0);
    if (focus !== false) { var h = $('#main h1'); if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); } }
  }
  function render() {
    var p = current.parts, a = p[0] || 'home', b = p[1], html;
    charts = {};
    switch (a) {
      case 'home': html = viewHome(); break;
      case 'companies': html = b ? viewCompany(+b) : viewCompanies(); break;
      case 'contacts': html = b ? viewContact(+b) : viewContacts(); break;
      case 'deals': html = b === 'list' ? viewDealList() : b ? viewDeal(+b) : viewBoard(); break;
      case 'activities': html = b === 'week' ? viewWeek() : viewActivities(); break;
      case 'data': html = viewData(); break;
      case 'team': html = viewTeam(); break;
      case 'duplicates': html = viewDuplicates(); break;
      case 'templates': html = viewTemplates(); break;
      case 'digest': html = viewDigest(); break;
      case 'quotes': html = viewQuote(+b); break;
      default: html = viewMissing('Page not found', 'This address does not exist in the CRM.');
    }
    $('#main').innerHTML = '<div class="page">' + html + '</div>';
    $$('#side .nav a').forEach(function (l) { if (l.dataset.nav === a) l.setAttribute('aria-current', 'page'); else l.removeAttribute('aria-current'); });
    $('#meSel').value = ui.me;
    afterRender();
  }
  function refresh() {
    var main = $('#main'), ae = document.activeElement, id = null, ss = null, se = null;
    if (ae && ae.id && main.contains(ae)) {
      id = ae.id;
      try { if (typeof ae.selectionStart === 'number') { ss = ae.selectionStart; se = ae.selectionEnd; } } catch (e) { ss = null; }
    }
    var sy = window.scrollY, board = $('.board'), bx = board ? board.scrollLeft : 0;
    var colScroll = $$('.col-b').map(function (c) { return c.scrollTop; });
    render();
    window.scrollTo(0, sy);
    var nb = $('.board'); if (nb) nb.scrollLeft = bx;
    $$('.col-b').forEach(function (c, i) { if (colScroll[i]) c.scrollTop = colScroll[i]; });
    if (id) {
      var n = document.getElementById(id);
      if (n) { n.focus({ preventScroll: true }); if (ss != null) { try { n.setSelectionRange(ss, se); } catch (e) { /* not a text input */ } } }
    }
  }
  function viewMissing(title, text) {
    return head({ eyebrow: 'CRM', title: title }) + '<div class="card"><div class="empty">' + esc(text) + '<br><br><a class="btn" href="#/">Back to Home</a></div></div>';
  }
  function updateNav() {
    var openDeals = db.deals.filter(function (d) { return mine(d) && isOpen(d); }).length;
    var overdue = 0, today = 0;
    db.activities.forEach(function (a) { if (!mine(a)) return; var s = actState(a); if (s === 'overdue') overdue++; else if (s === 'today') today++; });
    $('#navDeals').textContent = openDeals;
    $('#navCompanies').textContent = db.companies.filter(mine).length;
    var dupN = findDuplicates(), nd = dupN.companies.length + dupN.contacts.length, dn = $('#navDups');
    if (dn) dn.textContent = nd ? nd : '';
    $('#navContacts').textContent = db.contacts.filter(mine).length;
    var na = $('#navActivities');
    na.textContent = overdue ? overdue + ' overdue' : today ? today + ' today' : '';
    na.className = 'cnt' + (overdue ? ' bad' : '');
  }

  // ── Charts ────────────────────────────────────────────────────────────────
  var charts = {};
  function niceStep(raw) { if (raw <= 0) return 1; var p = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; }
  function topRounded(x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h));
    return 'M' + x + ',' + (y + h) + 'V' + (y + r) + 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y + 'H' + (x + w - r) + 'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + 'V' + (y + h) + 'Z';
  }
  function rightRounded(x, y, w, h, r) {
    r = Math.max(0, Math.min(r, h / 2, w));
    return 'M' + x + ',' + y + 'H' + (x + w - r) + 'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + 'V' + (y + h - r) + 'Q' + (x + w) + ',' + (y + h) + ' ' + (x + w - r) + ',' + (y + h) + 'H' + x + 'Z';
  }
  function drawCharts() {
    var p = $('[data-chart="pipeline"]'); if (p && charts.pipeline) drawPipeline(p, charts.pipeline);
    var w = $('[data-chart="won"]'); if (w && charts.won) drawWon(w, charts.won);
  }
  function drawPipeline(el, rows) {
    var W = Math.max(240, el.clientWidth - 40), rowH = 50, H = rows.length * rowH;
    var labelW = Math.min(150, Math.round(W * 0.34)), valW = 64, bw = Math.max(40, W - labelW - valW), barH = 16;
    var max = Math.max(1, Math.max.apply(null, rows.map(function (r) { return r.total; })));
    var g = rows.map(function (r, i) {
      var y = i * rowH, by = y + 17, tw = r.total > 0 ? Math.max(4, r.total / max * bw) : 0, ww = r.weighted > 0 ? Math.max(3, r.weighted / max * bw) : 0;
      var tip = r.name + '|' + money(r.total) + ' total · ' + r.count + ' deal' + (r.count === 1 ? '' : 's') + '|' + money(r.weighted) + ' weighted at ' + r.prob + '%';
      return '<g class="bar" data-tip="' + esc(tip) + '">' +
        '<text class="lab" x="0" y="' + (y + 22) + '">' + esc(r.name) + '</text>' +
        '<text x="0" y="' + (y + 39) + '">' + r.count + ' · ' + r.prob + '%</text>' +
        '<rect class="trk" x="' + labelW + '" y="' + by + '" width="' + bw + '" height="' + barH + '" rx="4"/>' +
        (tw ? '<path class="b-total" d="' + rightRounded(labelW, by, tw, barH, 4) + '"/>' : '') +
        (ww ? '<path class="b-weighted" d="' + rightRounded(labelW, by, ww, barH, 4) + '"/>' : '') +
        '<text class="val" x="' + (labelW + bw + 8) + '" y="' + (by + 12) + '">' + esc(moneyK(r.total)) + '</text>' +
        '<rect class="hit" x="0" y="' + y + '" width="' + W + '" height="' + rowH + '"/></g>';
    }).join('');
    el.innerHTML = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true">' + g + '</svg><div class="tip" hidden></div>';
    bindTips(el);
  }
  function drawWon(el, rows) {
    var W = Math.max(260, el.clientWidth - 40), H = 210, left = 46, top = 10, bottom = 24, plotH = H - top - bottom, plotW = W - left;
    var max = Math.max.apply(null, rows.map(function (r) { return r.value; }));
    var step = niceStep(Math.max(max, 1000) / 4), maxT = Math.ceil(Math.max(max, 1) / step) * step;
    var grid = '';
    for (var v = 0; v <= maxT + 0.5; v += step) {
      var y = top + plotH - v / maxT * plotH;
      grid += '<line class="' + (v === 0 ? 'base' : 'grid') + '" x1="' + left + '" x2="' + W + '" y1="' + y + '" y2="' + y + '"/>' +
        '<text x="' + (left - 8) + '" y="' + (y + 4) + '" text-anchor="end">' + esc(moneyK(v)) + '</text>';
    }
    var slot = plotW / rows.length, bw = Math.min(34, slot * 0.62), every = slot < 30 ? 2 : 1;
    var bars = rows.map(function (r, i) {
      var x = left + i * slot + (slot - bw) / 2, h = r.value / maxT * plotH, y = top + plotH - h;
      var tip = r.full + (r.partial ? ' (to date)' : '') + '|' + money(r.value) + ' won|' + r.count + ' deal' + (r.count === 1 ? '' : 's');
      return '<g class="bar" data-tip="' + esc(tip) + '">' +
        (h > 0 ? '<path class="b-won' + (r.partial ? ' partial' : '') + '" d="' + topRounded(x, y, bw, h, 4) + '"/>' : '') +
        ((i % every === (rows.length - 1) % every) ? '<text x="' + (x + bw / 2) + '" y="' + (H - 6) + '" text-anchor="middle">' + esc(r.label) + '</text>' : '') +
        '<rect class="hit" x="' + (left + i * slot) + '" y="' + top + '" width="' + slot + '" height="' + plotH + '"/></g>';
    }).join('');
    el.innerHTML = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true">' + grid + bars + '</svg><div class="tip" hidden></div>';
    bindTips(el);
  }
  function bindTips(el) {
    var tip = el.querySelector('.tip');
    function show(e) {
      var g = e.target.closest && e.target.closest('[data-tip]');
      if (!g) { tip.hidden = true; return; }
      var parts = g.getAttribute('data-tip').split('|');
      tip.innerHTML = '<b>' + esc(parts[0]) + '</b>' + parts.slice(1).map(function (p) { return '<br><span>' + esc(p) + '</span>'; }).join('');
      var r = el.getBoundingClientRect();
      var x = Math.min(Math.max(e.clientX - r.left, 80), r.width - 80);
      tip.style.left = x + 'px'; tip.style.top = (e.clientY - r.top - 12) + 'px'; tip.hidden = false;
    }
    el.addEventListener('pointermove', show);
    el.addEventListener('pointerleave', function () { tip.hidden = true; });
  }

  // ── Home ──────────────────────────────────────────────────────────────────
  function viewHome() {
    var today = todayYmd(), q = quarterOf(today), mStart = today.slice(0, 8) + '01';
    var deals = db.deals.filter(mine), open = deals.filter(isOpen);
    var openVal = sum(open, dealValue), pastClose = open.filter(closeOverdue).length;
    var openQ = open.filter(function (d) { return d.expectedClose >= q.start && d.expectedClose <= q.end; });
    var weightedQ = sum(openQ, weighted);
    var wonQ = deals.filter(function (d) { return d.stage === 'won' && d.closedAt >= q.start && d.closedAt <= q.end; });
    var wonQVal = sum(wonQ, dealValue);
    var wonM = deals.filter(function (d) { return d.stage === 'won' && d.closedAt >= mStart && d.closedAt <= today; });
    var prevMStart = ymd(new Date(parseYmd(mStart)).setMonth(new Date(parseYmd(mStart)).getMonth() - 1));
    var prevMEnd = addDays(mStart, -1);
    var dayOfMonth = +today.slice(8, 10);
    var prevMSame = addDays(prevMStart, Math.min(dayOfMonth, daysBetween(prevMStart, prevMEnd) + 1) - 1);
    var wonPrevSame = deals.filter(function (d) { return d.stage === 'won' && d.closedAt >= prevMStart && d.closedAt <= prevMSame; }).length;
    function rate(from, to) {
      var closed = deals.filter(function (d) { return !isOpen(d) && d.closedAt >= from && d.closedAt <= to; });
      var won = closed.filter(function (d) { return d.stage === 'won'; }).length;
      return { n: closed.length, won: won, r: closed.length ? won / closed.length : null };
    }
    var r90 = rate(addDays(today, -89), today), rPrev = rate(addDays(today, -179), addDays(today, -90));
    var acts = db.activities.filter(mine);
    var dueToday = acts.filter(function (a) { return actState(a) === 'today'; }).length;
    var overdue = acts.filter(function (a) { return actState(a) === 'overdue'; }).length;

    var delta = (r90.r != null && rPrev.r != null) ? Math.round((r90.r - rPrev.r) * 100) : null;
    var kpis =
      '<a class="card kpi" href="#/deals"><span class="label">Open pipeline</span><span class="v">' + money(openVal) + '</span><span class="s">' + open.length + ' open deals' + (pastClose ? ' · <span class="bad">' + pastClose + ' past close date</span>' : '') + '</span></a>' +
      '<a class="card kpi" href="#/deals/list" data-act="goto-deals" data-close="quarter"><span class="label">Weighted forecast · ' + esc(q.label) + '</span><span class="v">' + money(wonQVal + weightedQ) + '</span><span class="s">' + money(wonQVal) + ' won + ' + money(weightedQ) + ' weighted open</span></a>' +
      '<a class="card kpi" href="#/deals/list" data-act="goto-deals" data-status="won"><span class="label">Won this month</span><span class="v">' + wonM.length + ' <span style="font-size:18px;color:var(--ink2)">' + esc(money(sum(wonM, dealValue))) + '</span></span><span class="s">' + wonPrevSame + ' by this day last month</span></a>' +
      '<a class="card kpi" href="#/deals/list" data-act="goto-deals" data-status="closed90"><span class="label">Win rate · last 90 days</span><span class="v">' + (r90.r == null ? '—' : Math.round(r90.r * 100) + '%') + '</span><span class="s">' + r90.won + ' won of ' + r90.n + ' closed' + (delta != null ? ' · <span class="' + (delta >= 0 ? 'good-t' : 'bad-t') + '">' + (delta >= 0 ? '+' : '−') + Math.abs(delta) + ' pts</span>' : '') + '</span></a>' +
      '<a class="card kpi" href="#/activities" data-act="goto-acts" data-status="' + (overdue ? 'overdue' : 'today') + '"><span class="label">Activities today / overdue</span><span class="v">' + dueToday + ' <span style="color:var(--ink3)">/</span> <span class="' + (overdue ? 'bad-t' : '') + '">' + overdue + '</span></span><span class="s">' + dueToday + ' due today · ' + overdue + ' overdue</span></a>';

    // charts
    charts.pipeline = OPEN_STAGES.map(function (s) {
      var list = open.filter(function (d) { return d.stage === s; });
      return { name: STAGE[s].name, prob: STAGE[s].prob, count: list.length, total: sum(list, dealValue), weighted: sum(list, weighted) };
    });
    var won = [], base = new Date(parseYmd(mStart));
    for (var i = 11; i >= 0; i--) {
      var d = new Date(base.getFullYear(), base.getMonth() - i, 1), key = d.getFullYear() + '-' + pad(d.getMonth() + 1);
      var list = deals.filter(function (x) { return x.stage === 'won' && x.closedAt && x.closedAt.slice(0, 7) === key; });
      won.push({ key: key, label: MON[d.getMonth()], full: MON[d.getMonth()] + ' ' + d.getFullYear(), value: sum(list, dealValue), count: list.length, partial: i === 0 });
    }
    charts.won = won;
    var wonTotal = sum(won, function (r) { return r.value; });
    var pipeSummary = charts.pipeline.map(function (r) { return r.name + ' ' + money(r.total) + ' (' + r.count + ' deals, ' + money(r.weighted) + ' weighted)'; }).join('; ');
    var wonSummary = won.map(function (r) { return r.full + ' ' + money(r.value); }).join('; ');

    // tasks today
    var tasks = acts.filter(function (a) { var s = actState(a); return s === 'overdue' || actDate(a) === today; })
      .sort(function (a, b) {
        var oa = actState(a) === 'overdue', ob = actState(b) === 'overdue';
        if (oa !== ob) return oa ? 1 : -1; // today's agenda first, then overdue (most recent first)
        return oa ? b.due.localeCompare(a.due) : a.due.localeCompare(b.due);
      });
    var taskList = tasks.slice(0, 12);
    var recent = deals.slice().sort(function (a, b) { return b.updatedAt - a.updatedAt; }).slice(0, 8);

    var who = ui.me === 'all' ? 'Team' : OWNER[ui.me].name.split(' ')[0] + '’s';
    return head({
      eyebrow: 'Adrial B2B · ' + fmtDateFull(today), title: ui.me === 'all' ? 'Sales overview' : 'Hello, ' + OWNER[ui.me].name.split(' ')[0],
      sub: '<span>Showing <b>' + esc(scopeLabel()) + '</b> · opticians, clinics, corporate eye-care and partners in Slovenia and Croatia</span>',
      actions: btn('New deal', 'new-deal', {}, 'pri', 'plus') + btn('Log activity', 'new-act', {}, '', 'task')
    }) +
      '<div class="kpis">' + kpis + '</div>' +
      '<div class="grid2" style="margin-bottom:16px">' +
      '<section class="card" aria-labelledby="hPipe"><div class="card-h"><div><span class="label">Open deals</span><h2 id="hPipe">Pipeline by stage</h2></div><a class="btn sm" href="#/deals">Open board</a></div>' +
      '<div class="legend" aria-hidden="true"><span><i class="soft"></i>Total value</span><span><i></i>Weighted (× stage probability)</span></div>' +
      '<div class="chart" data-chart="pipeline" role="img" aria-label="' + esc('Open pipeline by stage: ' + pipeSummary) + '"></div>' +
      '<details class="card-b"><summary class="hint" style="cursor:pointer">Show as table</summary><div class="tablewrap"><table class="tbl"><thead><tr><th>Stage</th><th class="r">Deals</th><th class="r">Total</th><th class="r">Weighted</th></tr></thead><tbody>' +
      charts.pipeline.map(function (r) { return '<tr><td>' + esc(r.name) + '</td><td class="r num">' + r.count + '</td><td class="r num">' + money(r.total) + '</td><td class="r num">' + money(r.weighted) + '</td></tr>'; }).join('') +
      '</tbody></table></div></details></section>' +
      '<section class="card" aria-labelledby="hTasks"><div class="card-h"><div><span class="label">' + esc(fmtDateFull(today)) + '</span><h2 id="hTasks">' + esc(ui.me === 'all' ? 'Team tasks today' : 'My tasks today') + '</h2></div>' + btn('Add', 'new-act', {}, 'sm', 'plus') + '</div>' +
      (taskList.length ? '<ul class="rows">' + taskList.map(function (a) { return actRow(a, { owner: ui.me === 'all' }); }).join('') + '</ul>' : '<div class="card-b"><div class="empty box">Nothing due today. Enjoy the calm.</div></div>') +
      (tasks.length > taskList.length ? '<div class="more"><a class="btn sm" href="#/activities" data-act="goto-acts" data-status="open">All ' + tasks.length + ' tasks →</a></div>' : '<div class="more"><a class="btn sm ghost" href="#/activities/week">This week →</a></div>') +
      '</section></div>' +
      '<div class="grid2 even" style="margin-bottom:16px">' + homeTargetsCard() + hotLeadsCard() + '</div>' +
      '<div class="grid2">' +
      '<section class="card" aria-labelledby="hWon"><div class="card-h"><div><span class="label">Last 12 months · ' + esc(who) + '</span><h2 id="hWon">Won revenue by month</h2></div><span class="chip num">' + esc(money(wonTotal)) + '</span></div>' +
      '<div class="legend" aria-hidden="true"><span><i></i>Won value (current month to date is lighter)</span></div>' +
      '<div class="chart" data-chart="won" role="img" aria-label="' + esc('Won revenue by month: ' + wonSummary) + '"></div>' +
      '<details class="card-b"><summary class="hint" style="cursor:pointer">Show as table</summary><div class="tablewrap"><table class="tbl"><thead><tr><th>Month</th><th class="r">Deals won</th><th class="r">Value</th></tr></thead><tbody>' +
      won.map(function (r) { return '<tr><td>' + esc(r.full) + '</td><td class="r num">' + r.count + '</td><td class="r num">' + money(r.value) + '</td></tr>'; }).join('') +
      '</tbody></table></div></details></section>' +
      '<section class="card" aria-labelledby="hRecent"><div class="card-h"><div><span class="label">Deals</span><h2 id="hRecent">Recently updated</h2></div><a class="btn sm" href="#/deals/list">All deals</a></div>' +
      (recent.length ? '<ul class="rows">' + recent.map(function (d) {
        var c = company(d.companyId);
        return '<li><div class="main"><a href="#/deals/' + d.id + '">' + esc(d.title) + '</a><div class="meta"><span>' + esc(c ? c.name : '—') + '</span><span>' + esc(ago(d.updatedAt)) + '</span></div></div><div class="end">' + stageChip(d.stage) + '<span class="num" style="min-width:70px;text-align:right">' + esc(moneyK(dealValue(d))) + '</span></div></li>';
      }).join('') + '</ul>' : '<div class="card-b"><div class="empty box">No deals yet.</div></div>') +
      '</section></div>';
  }

  // ── Activity row (shared) ─────────────────────────────────────────────────
  function actRow(a, o) {
    o = o || {};
    var st = actState(a), co = company(a.companyId), ct = contact(a.contactId), dl = deal(a.dealId);
    var t = ACT_TYPE[a.type] ? ACT_TYPE[a.type].name : a.type;
    var when = actDate(a) === todayYmd() ? actTime(a) : fmtDate(actDate(a)) + ' · ' + actTime(a);
    var links = [];
    if (co && !o.noCompany) links.push('<a href="#/companies/' + co.id + '">' + esc(co.name) + '</a>');
    if (ct && !o.noContact) links.push('<a href="#/contacts/' + ct.id + '">' + esc(personName(ct)) + '</a>');
    if (dl && !o.noDeal) links.push('<a href="#/deals/' + dl.id + '">' + esc(dl.title) + '</a>');
    return '<li class="' + (st === 'done' ? 'done' : st === 'overdue' ? 'overdue' : '') + '">' +
      '<input type="checkbox" class="chk" id="done-' + a.id + (o.idSuffix || '') + '" data-chg="done" data-id="' + a.id + '"' + (a.done ? ' checked' : '') + ' aria-label="' + esc((a.done ? 'Done: ' : 'Mark as done: ') + a.subject) + '">' +
      '<span class="typeic tone-' + TYPE_TONE[a.type] + '" title="' + esc(t) + '">' + icon(a.type) + '</span>' +
      '<div class="main"><button type="button" class="subj" data-act="edit-act" data-id="' + a.id + '"><span class="sr">' + esc(t) + ': </span>' + esc(a.subject) + '</button>' +
      (links.length ? '<div class="meta">' + links.join('') + '</div>' : '') + '</div>' +
      '<div class="end"><span class="due' + (st === 'overdue' ? ' bad' : '') + '">' + (st === 'overdue' ? 'Overdue · ' : '') + esc(when) + '</span>' + (o.owner ? ownerAv(a.owner) : '') + '</div></li>';
  }

  // ── Companies ─────────────────────────────────────────────────────────────
  function companyStats() {
    var st = new Map();
    db.companies.forEach(function (c) { st.set(c.id, { contacts: 0, open: 0, openValue: 0, won: 0, wonValue: 0, last: 0 }); });
    db.contacts.forEach(function (ct) { var s = st.get(ct.companyId); if (s) s.contacts++; });
    db.deals.forEach(function (d) {
      var s = st.get(d.companyId); if (!s) return;
      var v = dealValue(d);
      if (isOpen(d)) { s.open++; s.openValue += v; } else if (d.stage === 'won') { s.won++; s.wonValue += v; }
    });
    db.activities.forEach(function (a) { var s = st.get(a.companyId); if (s && a.done && (a.doneAt || 0) > s.last) s.last = a.doneAt; });
    return st;
  }
  function filteredCompanies() {
    var f = ui.co;
    return db.companies.filter(function (c) {
      return mine(c) && (!f.country || c.country === f.country) && (!f.segment || c.segment === f.segment) && (!f.score || companyScore(c).score >= +f.score) &&
        matchQ(f.q, [c.name, c.city, c.vat, c.email, c.address].join(' '));
    });
  }
  function viewCompanies() {
    var st = companyStats(), f = ui.co;
    var rows = sortRows(filteredCompanies(), {
      name: function (c) { return c.name; }, segment: function (c) { return c.segment; }, country: function (c) { return c.country + c.city; },
      owner: function (c) { return ownerName(c.owner); }, contacts: function (c) { return st.get(c.id).contacts; },
      open: function (c) { return st.get(c.id).openValue; }, won: function (c) { return st.get(c.id).wonValue; }, last: function (c) { return st.get(c.id).last; },
      score: function (c) { return companyScore(c).score; }
    }, f.sort, f.dir);
    var filtered = f.q || f.country || f.segment || f.score;
    return head({
      eyebrow: 'Accounts', title: 'Companies', sub: '<b>' + rows.length + '</b> of ' + db.companies.filter(mine).length + ' companies · ' + esc(scopeLabel()),
      actions: btn('Export CSV', 'export', { what: 'companies', scope: 'list' }, '', 'download') + btn('New company', 'new-company', {}, 'pri', 'plus')
    }) +
      '<div class="toolbar">' + searchBox('coQ', 'co.q', f.q, 'Search name, city, VAT…') +
      segButtons('co.country', f.country, COUNTRY_SEG, 'Country') +
      filterSelect('coSeg', 'co.segment', f.segment, SEG_OPTS, 'Segment') + filterSelect('coScore', 'co.score', f.score, [['', 'Any score'], ['70', 'Hot (70+)'], ['45', 'Warm or hot (45+)']], 'Lead score') + ownerFilter('coOwner') +
      (filtered ? btn('Clear filters', 'clear-filters', { scope: 'co' }, 'ghost sm') : '') + '</div>' +
      '<section class="card"><div class="tablewrap"><table class="tbl"><caption class="sr">Companies</caption><thead><tr>' +
      th('co', 'name', 'Company') + th('co', 'score', 'Score', 'r', true) + th('co', 'segment', 'Segment', 'hide-sm') + th('co', 'country', 'Location', 'hide-md') + th('co', 'owner', 'Owner', 'hide-sm') +
      th('co', 'contacts', 'Contacts', 'r hide-md', true) + th('co', 'open', 'Open pipeline', 'r', true) + th('co', 'won', 'Won to date', 'r hide-md', true) + th('co', 'last', 'Last activity', 'hide-md', true) +
      '</tr></thead><tbody>' +
      (rows.length ? rows.map(function (c) {
        var s = st.get(c.id);
        return '<tr><td><a class="t1" href="#/companies/' + c.id + '">' + esc(c.name) + '</a> ' + erpBadge(c) + '<small>' + esc(c.city + ', ' + c.country) + '</small></td>' +
          '<td class="r">' + scoreBadge(companyScore(c)) + '</td><td class="hide-sm">' + segChip(c.segment) + '</td><td class="hide-md">' + esc(c.city) + ' <span class="muted mono">' + esc(c.country) + '</span></td>' +
          '<td class="hide-sm">' + ownerChip(c.owner) + '</td><td class="r num hide-md">' + s.contacts + '</td>' +
          '<td class="r num">' + (s.open ? money(s.openValue) + '<small>' + s.open + ' deal' + (s.open === 1 ? '' : 's') + '</small>' : '<span class="muted">—</span>') + '</td>' +
          '<td class="r num hide-md">' + (s.wonValue ? money(s.wonValue) : '<span class="muted">—</span>') + '</td>' +
          '<td class="hide-md">' + (s.last ? esc(fmtDate(ymd(s.last))) : '<span class="muted">—</span>') + '</td></tr>';
      }).join('') : '<tr><td colspan="9"><div class="empty">No companies match these filters.</div></td></tr>') +
      '</tbody></table></div></section>';
  }

  function timelineHtml(items, limit) {
    items.sort(function (a, b) { return b.at - a.at; });
    var shown = tlExpanded ? items : items.slice(0, limit);
    if (!items.length) return '<div class="card-b"><div class="empty box">No history yet.</div></div>';
    return '<ul class="tl">' + shown.map(function (it) {
      return '<li><span class="typeic' + (it.tone ? ' tone-' + it.tone : '') + '">' + icon(it.ic) + '</span><div><div class="what">' + it.html + '</div>' +
        '<div class="when"><span>' + esc(fmtStamp(it.at)) + '</span>' + (it.by ? '<span>' + esc(ownerName(it.by)) + '</span>' : '') + (it.del ? it.del : '') + '</div>' +
        (it.note != null ? '<p class="note">' + esc(it.note) + '</p>' : '') + '</div></li>';
    }).join('') + '</ul>' +
      (items.length > shown.length ? '<div class="more"><button type="button" class="btn sm" data-act="tl-all">Show all ' + items.length + ' entries</button></div>' : '');
  }
  function noteItem(n, ctx) {
    return { at: n.at, ic: 'note', by: n.owner, html: '<b>Note</b>' + (ctx ? ' · ' + ctx : ''), note: n.text, del: '<button type="button" class="linkbtn" data-act="del-note" data-id="' + n.id + '">Delete note</button>' };
  }
  function actItem(a, o) {
    var ct = contact(a.contactId), dl = deal(a.dealId), bits = [];
    if (ct && !(o && o.noContact)) bits.push('<a href="#/contacts/' + ct.id + '">' + esc(personName(ct)) + '</a>');
    if (dl && !(o && o.noDeal)) bits.push('<a href="#/deals/' + dl.id + '">' + esc(dl.title) + '</a>');
    return { at: a.doneAt || actMs(a), ic: a.type, tone: TYPE_TONE[a.type], by: a.owner, html: '<b>' + esc(ACT_TYPE[a.type].name) + '</b> · <button type="button" class="subj" data-act="edit-act" data-id="' + a.id + '">' + esc(a.subject) + '</button>' + (bits.length ? ' · ' + bits.join(' · ') : ''), note: a.notes ? a.notes : null };
  }
  function stageItems(d, withTitle) {
    return d.history.map(function (h) {
      var t = withTitle ? '<a href="#/deals/' + d.id + '">' + esc(d.title) + '</a>' : '';
      if (!h.from) return { at: h.at, ic: 'deal', by: h.by, html: '<b>Deal created</b>' + (t ? ' · ' + t : '') + ' in ' + esc(STAGE[h.to] ? STAGE[h.to].name : h.to) };
      return { at: h.at, ic: 'stage', tone: STAGE[h.to] ? STAGE[h.to].tone : '', by: h.by, html: '<b>' + esc(STAGE[h.from] ? STAGE[h.from].name : h.from) + ' → ' + esc(STAGE[h.to] ? STAGE[h.to].name : h.to) + '</b>' + (t ? ' · ' + t : '') };
    });
  }
  function composer(entity, id) {
    return '<div class="composer"><label class="sr" for="noteText">Add a note</label><textarea class="in" id="noteText" rows="2" placeholder="Write a note…" maxlength="4000"></textarea>' +
      '<div class="row">' + btn('Add note', 'add-note', { entity: entity, id: id }, 'sm pri', 'note') + '</div></div>';
  }
  function openActsCard(list, o, preset) {
    var open = list.filter(function (a) { return !a.done; }).sort(function (a, b) { return a.due.localeCompare(b.due); });
    return '<section class="card" aria-labelledby="hOpenActs"><div class="card-h"><div><span class="label">To do</span><h2 id="hOpenActs">Open activities</h2></div>' + btn('Log activity', 'new-act', preset, 'sm', 'plus') + '</div>' +
      (open.length ? '<ul class="rows">' + open.map(function (a) { return actRow(a, o); }).join('') + '</ul>' : '<div class="card-b"><div class="empty box">No open activities.</div></div>') + '</section>';
  }

  function viewCompany(id) {
    var c = company(id);
    if (!c) return viewMissing('Company not found', 'It may have been deleted.');
    var cts = db.contacts.filter(function (x) { return x.companyId === c.id; }).sort(function (a, b) { return a.lastName.localeCompare(b.lastName, 'sl'); });
    var deals = db.deals.filter(function (d) { return d.companyId === c.id; }).sort(function (a, b) { return (isOpen(b) - isOpen(a)) || (b.updatedAt - a.updatedAt); });
    var acts = db.activities.filter(function (a) { return a.companyId === c.id; });
    var openDeals = deals.filter(isOpen), wonDeals = deals.filter(function (d) { return d.stage === 'won'; });
    var items = [];
    acts.forEach(function (a) { if (a.done) items.push(actItem(a)); });
    db.notes.forEach(function (n) {
      if (n.entity === 'company' && n.entityId === c.id) items.push(noteItem(n));
      else if (n.entity === 'deal') { var d = deal(n.entityId); if (d && d.companyId === c.id) items.push(noteItem(n, 'on <a href="#/deals/' + d.id + '">' + esc(d.title) + '</a>')); }
    });
    deals.forEach(function (d) { items = items.concat(stageItems(d, true)); });
    items.push({ at: c.createdAt, ic: 'company', html: '<b>Company added</b>' });

    var site = c.website ? esc(c.website) : '—';
    return head({
      crumb: 'Companies', crumbHref: '#/companies', title: c.name,
      sub: segChip(c.segment) + erpBadge(c) + '<span>' + esc(c.city + ', ' + (c.country === 'SI' ? 'Slovenia' : 'Croatia')) + '</span>' + ownerChip(c.owner),
      actions: btn('Edit', 'edit-company', { id: c.id }, '', 'edit') + btn('New deal', 'new-deal', { company: c.id }, 'pri', 'plus') + btn('Delete', 'del-company', { id: c.id }, 'danger-ghost', 'trash')
    }) +
      '<div class="detail"><div class="stack">' +
      '<section class="card" aria-labelledby="hInfo"><div class="card-h"><h2 id="hInfo">Details</h2></div><div class="tiles">' +
      '<div class="tile"><span class="label">Open pipeline</span><div class="v">' + money(sum(openDeals, dealValue)) + '</div></div>' +
      '<div class="tile"><span class="label">Won to date</span><div class="v">' + money(sum(wonDeals, dealValue)) + '</div></div>' +
      '<div class="tile"><span class="label">Deals</span><div class="v">' + openDeals.length + ' <span class="muted" style="font-size:14px">open / ' + deals.length + '</span></div></div></div>' +
      '<div class="kv">' +
      '<div><span class="k">Address</span><p>' + esc(c.address || '—') + '<br>' + esc((c.postcode || '') + ' ' + (c.city || '')) + '</p></div>' +
      '<div><span class="k">Phone</span><p>' + (c.phone ? '<a href="tel:' + esc(c.phone.replace(/\s+/g, '')) + '">' + esc(c.phone) + '</a>' : '—') + '</p></div>' +
      '<div><span class="k">Email</span><p>' + (c.email ? '<a href="mailto:' + esc(c.email) + '">' + esc(c.email) + '</a>' : '—') + '</p></div>' +
      '<div><span class="k">Website</span><p>' + site + '</p></div>' +
      '<div><span class="k">VAT ID</span><p class="mono">' + esc(c.vat || '—') + '</p></div>' +
      '<div><span class="k">Employees</span><p class="num">' + esc(c.employees || '—') + '</p></div>' +
      '<div><span class="k">Source</span><p>' + esc(c.source || '—') + '</p></div>' +
      '<div><span class="k">Customer since</span><p>' + esc(fmtDateFull(ymd(c.createdAt))) + '</p></div>' +
      '</div></section>' +
      '<section class="card" aria-labelledby="hCts"><div class="card-h"><div><span class="label">' + cts.length + ' people</span><h2 id="hCts">Contacts</h2></div><div class="actions">' + btn('Link existing', 'link-contact', { company: c.id }, 'sm', 'link') + btn('Add', 'new-contact', { company: c.id }, 'sm', 'plus') + '</div></div>' +
      (cts.length ? '<ul class="rows">' + cts.map(function (ct) {
        return '<li><span class="av tone-grey" aria-hidden="true">' + esc((ct.firstName[0] || '') + (ct.lastName[0] || '')) + '</span><div class="main"><a href="#/contacts/' + ct.id + '">' + esc(personName(ct)) + '</a><div class="meta"><span>' + esc(ct.title || '') + '</span>' + (ct.email ? '<a href="mailto:' + esc(ct.email) + '">' + esc(ct.email) + '</a>' : '') + (ct.phone ? '<span class="mono">' + esc(ct.phone) + '</span>' : '') + '</div></div>' +
          '<div class="end">' + (ct.email ? '<button type="button" class="btn sm ghost" data-act="email" data-contact="' + ct.id + '" aria-label="' + esc('Email ' + personName(ct)) + '">Email</button>' : '') + '<button type="button" class="btn sm ghost" data-act="unlink-contact" data-id="' + ct.id + '" aria-label="' + esc('Unlink ' + personName(ct) + ' from this company') + '">Unlink</button></div></li>';
      }).join('') + '</ul>' : '<div class="card-b"><div class="empty box">No contacts linked yet.</div></div>') + '</section>' +
      '<section class="card" aria-labelledby="hDeals"><div class="card-h"><div><span class="label">' + deals.length + ' total</span><h2 id="hDeals">Deals</h2></div>' + btn('New deal', 'new-deal', { company: c.id }, 'sm', 'plus') + '</div>' +
      (deals.length ? '<ul class="rows">' + deals.map(function (d) {
        return '<li><div class="main"><a href="#/deals/' + d.id + '">' + esc(d.title) + '</a><div class="meta"><span>' + (isOpen(d) ? 'Close ' + esc(fmtDate(d.expectedClose)) : (d.stage === 'won' ? 'Won ' : 'Lost ') + esc(fmtDate(d.closedAt))) + '</span><span>' + esc(ownerName(d.owner)) + '</span></div></div><div class="end">' + stageChip(d.stage) + '<span class="num" style="min-width:72px;text-align:right">' + esc(money(dealValue(d))) + '</span></div></li>';
      }).join('') + '</ul>' : '<div class="card-b"><div class="empty box">No deals yet.</div></div>') + '</section>' +
      '</div><div class="stack">' +
      scoreWhyCard(companyScore(c), 'This company') +
      openActsCard(acts, { noCompany: true }, { company: c.id }) +
      '<section class="card" aria-labelledby="hTl"><div class="card-h"><div><span class="label">Activities, notes and stage changes</span><h2 id="hTl">Timeline</h2></div></div>' +
      composer('company', c.id) + timelineHtml(items, 25) + '</section>' +
      '</div></div>';
  }

  // ── Contacts ──────────────────────────────────────────────────────────────
  function lastTouchByContact() {
    var m = new Map();
    db.activities.forEach(function (a) { if (a.contactId != null && a.done && (a.doneAt || 0) > (m.get(a.contactId) || 0)) m.set(a.contactId, a.doneAt); });
    return m;
  }
  function filteredContacts() {
    var f = ui.ct;
    return db.contacts.filter(function (ct) {
      var c = company(ct.companyId);
      if (!mine(ct)) return false;
      if (f.country && (!c || c.country !== f.country)) return false;
      if (f.segment && (!c || c.segment !== f.segment)) return false;
      return matchQ(f.q, [personName(ct), ct.email, ct.phone, ct.title, c ? c.name : ''].join(' '));
    });
  }
  function viewContacts() {
    var f = ui.ct, last = lastTouchByContact();
    var rows = sortRows(filteredContacts(), {
      name: function (x) { return x.lastName + ' ' + x.firstName; }, company: function (x) { var c = company(x.companyId); return c ? c.name : '￿'; },
      email: function (x) { return x.email || ''; }, owner: function (x) { return ownerName(x.owner); }, last: function (x) { return last.get(x.id) || 0; }
    }, f.sort, f.dir);
    var filtered = f.q || f.country || f.segment;
    return head({
      eyebrow: 'People', title: 'Contacts', sub: '<b>' + rows.length + '</b> of ' + db.contacts.filter(mine).length + ' contacts · ' + esc(scopeLabel()),
      actions: '<a class="btn" href="#/data">' + icon('upload') + 'Import CSV</a>' + btn('Export CSV', 'export', { what: 'contacts', scope: 'list' }, '', 'download') + btn('New contact', 'new-contact', {}, 'pri', 'plus')
    }) +
      '<div class="toolbar">' + searchBox('ctQ', 'ct.q', f.q, 'Search name, email, phone, company…') +
      segButtons('ct.country', f.country, COUNTRY_SEG, 'Country') +
      filterSelect('ctSeg', 'ct.segment', f.segment, SEG_OPTS, 'Segment') + ownerFilter('ctOwner') +
      (filtered ? btn('Clear filters', 'clear-filters', { scope: 'ct' }, 'ghost sm') : '') + '</div>' +
      '<section class="card"><div class="tablewrap"><table class="tbl"><caption class="sr">Contacts</caption><thead><tr>' +
      th('ct', 'name', 'Name') + th('ct', 'company', 'Company', 'hide-sm') + th('ct', 'email', 'Email · phone', 'hide-md') + th('ct', 'owner', 'Owner', 'hide-sm') + th('ct', 'last', 'Last activity', 'hide-md', true) +
      '</tr></thead><tbody>' +
      (rows.length ? rows.map(function (ct) {
        var c = company(ct.companyId), l = last.get(ct.id);
        return '<tr><td><a class="t1" href="#/contacts/' + ct.id + '">' + esc(personName(ct)) + '</a><small>' + esc(ct.title || '') + '</small></td>' +
          '<td class="hide-sm">' + (c ? '<a href="#/companies/' + c.id + '">' + esc(c.name) + '</a>' : '<span class="muted">No company</span>') + '</td>' +
          '<td class="hide-md">' + (ct.email ? '<a href="mailto:' + esc(ct.email) + '">' + esc(ct.email) + '</a>' : '<span class="muted">—</span>') + '<small class="mono">' + esc(ct.phone || '') + '</small></td>' +
          '<td class="hide-sm">' + ownerChip(ct.owner) + '</td><td class="hide-md">' + (l ? esc(fmtDate(ymd(l))) : '<span class="muted">—</span>') + '</td></tr>';
      }).join('') : '<tr><td colspan="5"><div class="empty">No contacts match these filters.</div></td></tr>') +
      '</tbody></table></div></section>';
  }
  function viewContact(id) {
    var ct = contact(id);
    if (!ct) return viewMissing('Contact not found', 'It may have been deleted.');
    var c = company(ct.companyId);
    var deals = db.deals.filter(function (d) { return d.contactId === ct.id; }).sort(function (a, b) { return (isOpen(b) - isOpen(a)) || (b.updatedAt - a.updatedAt); });
    var acts = db.activities.filter(function (a) { return a.contactId === ct.id; });
    var items = [];
    acts.forEach(function (a) { if (a.done) items.push(actItem(a, { noContact: true })); });
    db.notes.forEach(function (n) { if (n.entity === 'contact' && n.entityId === ct.id) items.push(noteItem(n)); });
    items.push({ at: ct.createdAt, ic: 'contact', html: '<b>Contact added</b>' });
    return head({
      crumb: 'Contacts', crumbHref: '#/contacts', title: personName(ct),
      sub: '<span>' + esc(ct.title || 'No title') + '</span>' + (c ? '<a href="#/companies/' + c.id + '">' + esc(c.name) + '</a>' : '<span class="muted">No company</span>') + ownerChip(ct.owner),
      actions: btn('Edit', 'edit-contact', { id: ct.id }, '', 'edit') + btn('Email', 'email', { contact: ct.id }, '', 'email') + btn('Log activity', 'new-act', { contact: ct.id, company: ct.companyId || '' }, 'pri', 'plus') + btn('Delete', 'del-contact', { id: ct.id }, 'danger-ghost', 'trash')
    }) +
      '<div class="detail"><div class="stack">' +
      '<section class="card" aria-labelledby="hInfo"><div class="card-h"><h2 id="hInfo">Details</h2></div><div class="kv">' +
      '<div><span class="k">Email</span><p>' + (ct.email ? '<a href="mailto:' + esc(ct.email) + '">' + esc(ct.email) + '</a>' : '—') + '</p></div>' +
      '<div><span class="k">Phone</span><p>' + (ct.phone ? '<a href="tel:' + esc(ct.phone.replace(/\s+/g, '')) + '">' + esc(ct.phone) + '</a>' : '—') + '</p></div>' +
      '<div><span class="k">Company</span><p>' + (c ? '<a href="#/companies/' + c.id + '">' + esc(c.name) + '</a>' : 'No company · <button type="button" class="linkbtn" data-act="edit-contact" data-id="' + ct.id + '">link one</button>') + '</p></div>' +
      '<div><span class="k">Segment · country</span><p>' + (c ? esc(c.segment + ' · ' + c.country) : '—') + '</p></div>' +
      '<div><span class="k">Owner</span><p>' + esc(ownerName(ct.owner)) + '</p></div>' +
      '<div><span class="k">Added</span><p>' + esc(fmtDateFull(ymd(ct.createdAt))) + '</p></div>' +
      '</div></section>' +
      '<section class="card" aria-labelledby="hDeals"><div class="card-h"><div><span class="label">Where this person is the main contact</span><h2 id="hDeals">Deals</h2></div>' + (c ? btn('New deal', 'new-deal', { company: c.id, contact: ct.id }, 'sm', 'plus') : '') + '</div>' +
      (deals.length ? '<ul class="rows">' + deals.map(function (d) {
        return '<li><div class="main"><a href="#/deals/' + d.id + '">' + esc(d.title) + '</a><div class="meta"><span>' + (isOpen(d) ? 'Close ' + esc(fmtDate(d.expectedClose)) : esc(STAGE[d.stage].name + ' ' + fmtDate(d.closedAt))) + '</span></div></div><div class="end">' + stageChip(d.stage) + '<span class="num">' + esc(money(dealValue(d))) + '</span></div></li>';
      }).join('') + '</ul>' : '<div class="card-b"><div class="empty box">No deals with this contact.</div></div>') + '</section>' +
      '</div><div class="stack">' +
      openActsCard(acts, { noContact: true }, { contact: ct.id, company: ct.companyId || '' }) +
      '<section class="card" aria-labelledby="hTl"><div class="card-h"><div><span class="label">Activities and notes</span><h2 id="hTl">Timeline</h2></div></div>' +
      composer('contact', ct.id) + timelineHtml(items, 25) + '</section></div></div>';
  }

  // ── Deals: board ──────────────────────────────────────────────────────────
  function dealMatches(d, f) {
    var c = company(d.companyId);
    if (!mine(d)) return false;
    if (f.country && (!c || c.country !== f.country)) return false;
    if (f.segment && (!c || c.segment !== f.segment)) return false;
    var ct = contact(d.contactId);
    return matchQ(f.q, [d.title, c ? c.name : '', personName(ct), d.lines.map(function (l) { return lineLabel(l) + ' ' + lineCode(l); }).join(' ')].join(' '));
  }
  function dealTabs(cur) {
    return '<div class="seg" role="group" aria-label="Deals view"><a href="#/deals"' + (cur === 'board' ? ' aria-current="page"' : '') + '>Board</a><a href="#/deals/list"' + (cur === 'list' ? ' aria-current="page"' : '') + '>List</a></div>';
  }
  function stageSelect(d) {
    return '<label class="sr" for="mv-' + d.id + '">' + esc('Stage of ' + d.title) + '</label><select class="mv" id="mv-' + d.id + '" data-chg="move" data-id="' + d.id + '">' +
      STAGES.map(function (s) { return '<option value="' + s.id + '"' + (s.id === d.stage ? ' selected' : '') + '>' + (s.id === d.stage ? '' : 'Move to ') + esc(s.name) + '</option>'; }).join('') + '</select>';
  }
  function viewBoard() {
    var f = ui.board, today = todayYmd(), since = addDays(today, -90);
    var deals = db.deals.filter(function (d) { return dealMatches(d, f); });
    var open = deals.filter(isOpen);
    var cols = STAGES.map(function (s) {
      var list = deals.filter(function (d) { return d.stage === s.id; }), hidden = 0;
      if (!s.open) { var all = list.length; list = list.filter(function (d) { return (d.closedAt || '') >= since; }); hidden = all - list.length; }
      list.sort(function (a, b) { return s.open ? (a.expectedClose || '').localeCompare(b.expectedClose || '') : (b.closedAt || '').localeCompare(a.closedAt || ''); });
      var total = sum(list, dealValue);
      return '<section class="col" data-stage="' + s.id + '" aria-labelledby="col-' + s.id + '">' +
        '<div class="col-h"><div class="t"><span class="sdot tone-' + s.tone + '" aria-hidden="true"></span><span id="col-' + s.id + '">' + esc(s.name) + '</span><span class="n">' + list.length + '</span></div>' +
        '<div class="s">' + esc(money(total)) + (s.open ? ' · ' + s.prob + '% → ' + esc(moneyK(total * s.prob / 100)) : ' · last 90 days') + '</div></div>' +
        '<div class="col-b">' + (list.length ? list.map(function (d) { return dealCard(d, today); }).join('') : '<div class="col-empty">Drop a deal here</div>') + '</div>' +
        (hidden ? '<div class="col-foot"><a href="#/deals/list" data-act="goto-deals" data-status="' + s.id + '">+ ' + hidden + ' older in list view</a></div>' : '') + '</section>';
    }).join('');
    var filtered = f.q || f.country || f.segment;
    return head({
      eyebrow: 'Pipeline', title: 'Deals',
      sub: '<b>' + open.length + '</b> open · <b>' + esc(money(sum(open, dealValue))) + '</b> pipeline · <b>' + esc(money(sum(open, weighted))) + '</b> weighted · ' + esc(scopeLabel()),
      actions: btn('Export CSV', 'export', { what: 'deals', scope: 'board' }, '', 'download') + btn('New deal', 'new-deal', {}, 'pri', 'plus')
    }) +
      '<div class="toolbar">' + dealTabs('board') + searchBox('bdQ', 'board.q', f.q, 'Search deals, companies, products…') +
      segButtons('board.country', f.country, COUNTRY_SEG, 'Country') + filterSelect('bdSeg', 'board.segment', f.segment, SEG_OPTS, 'Segment') + ownerFilter('bdOwner') +
      (filtered ? btn('Clear filters', 'clear-filters', { scope: 'board' }, 'ghost sm') : '') + '</div>' +
      '<p class="hint" style="margin:0 0 10px">Drag cards between columns (on touch screens drag the ⠿ handle), or use the stage menu on each card. Moving to Lost asks for a reason.</p>' +
      '<div class="board" role="region" aria-label="Pipeline board" tabindex="0">' + cols + '</div>';
  }
  function dealCard(d, today) {
    var c = company(d.companyId), late = closeOverdue(d);
    var fc = fulfilChip(d), sc = dealScore(d);
    return '<article class="dcard" data-deal="' + d.id + '" aria-label="' + esc(d.title + ', ' + (c ? c.name : '') + ', ' + money(dealValue(d))) + '">' +
      '<div class="row ttl"><a class="tt" href="#/deals/' + d.id + '" draggable="false">' + esc(d.title) + '</a><span class="grip" title="Drag to another stage" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg></span></div>' +
      '<div class="co">' + esc(c ? c.name : '—') + '</div>' +
      '<div class="row"><span class="val">' + esc(money(dealValue(d))) + '</span>' + ownerAv(d.owner) + '</div>' +
      '<div class="meta">' + (isOpen(d) ? '<span class="' + (late ? 'bad' : '') + '">' + (late ? 'Past close · ' : 'Close ') + esc(fmtDate(d.expectedClose)) + '</span><span>' + daysInStage(d) + ' d in stage</span>'
        : '<span>' + (d.stage === 'won' ? 'Won ' : 'Lost ') + esc(fmtDate(d.closedAt)) + '</span>' + (d.lostReason ? '<span>' + esc(d.lostReason) + '</span>' : '')) + '</div>' +
      '<div class="row">' + stageSelect(d) + '<span class="cardchips">' + fc + (sc ? scoreBadge(sc) : '') + '</span></div></article>';
  }
  // ── Stage moves (single place for won/lost bookkeeping) ──────────────────
  function actor(owner) { return ui.me !== 'all' ? ui.me : owner; }
  function requestMove(d, to) {
    if (!d || !STAGE[to] || d.stage === to) { refresh(); return; }
    if (to === 'lost') {
      lostDialog(d).then(function (reason) { if (reason == null) { refresh(); return; } applyMove(d, to, reason); });
    } else applyMove(d, to, null);
  }
  function applyMove(d, to, reason) {
    var now = Date.now(), from = d.stage;
    d.history.push({ from: from, to: to, at: now, by: actor(d.owner) });
    d.stage = to; d.stageEnteredAt = now; d.updatedAt = now;
    if (STAGE[to].open) { d.closedAt = null; d.lostReason = null; }
    else { d.closedAt = todayYmd(); d.lostReason = to === 'lost' ? reason : null; }
    commit();
    toast(to === 'won' ? 'Won · ' + money(dealValue(d)) + ' · ' + d.title : to === 'lost' ? 'Marked as lost · ' + d.title : (!STAGE[from].open ? 'Reopened in ' : 'Moved to ') + STAGE[to].name + ' · ' + d.title);
  }
  function lostDialog(d) {
    return new Promise(function (resolve) {
      var done = false;
      openModal({
        title: 'Why was it lost?',
        body: '<p style="margin:0;color:var(--ink2)">' + esc(d.title) + ' · ' + esc(money(dealValue(d))) + '</p>' +
          '<fieldset class="field" style="border:0;padding:0;margin:0"><legend class="lab" style="font:400 12px var(--mono);color:var(--ink2);margin-bottom:6px">Reason <span class="req" aria-hidden="true">*</span></legend><div class="radios">' +
          LOST_REASONS.map(function (r, i) { return '<label><input type="radio" name="lr" value="' + esc(r) + '"' + (i === 0 ? ' autofocus' : '') + '>' + esc(r) + '</label>'; }).join('') + '</div></fieldset>' +
          '<div class="field"><label for="lrNote">Details (optional)</label><textarea class="in" id="lrNote" rows="2" maxlength="400" placeholder="e.g. competitor offered 12% lower price"></textarea></div>',
        foot: '<button type="button" class="btn ghost" data-close>Cancel</button><button type="submit" class="btn danger" form="{form}">Mark as lost</button>',
        onSubmit: function (api) {
          var r = api.el.querySelector('input[name="lr"]:checked');
          if (!r) { formError(api, 'Choose a reason.'); api.el.querySelector('input[name="lr"]').focus(); return; }
          var note = api.el.querySelector('#lrNote').value.trim();
          done = true; api.close(true);
          resolve(r.value + (note ? ' — ' + note : ''));
        },
        onClose: function () { if (!done) { done = true; resolve(null); } }
      });
    });
  }

  // ── Deals: list ───────────────────────────────────────────────────────────
  function filteredDeals() {
    var f = ui.dl, today = todayYmd(), q = quarterOf(today), nq = quarterOf(addDays(q.end, 1)), mStart = today.slice(0, 8) + '01';
    var mEnd = ymd(new Date(+today.slice(0, 4), +today.slice(5, 7), 0).getTime());
    return db.deals.filter(function (d) {
      if (!dealMatches(d, f)) return false;
      if (f.status === 'open' && !isOpen(d)) return false;
      if (f.status === 'won' && d.stage !== 'won') return false;
      if (f.status === 'lost' && d.stage !== 'lost') return false;
      if (f.status === 'closed90' && (isOpen(d) || d.closedAt < addDays(today, -89))) return false;
      if (f.stage && d.stage !== f.stage) return false;
      if (f.score) { var sc = dealScore(d); if (!sc || sc.score < +f.score) return false; }
      var dt = isOpen(d) ? d.expectedClose : d.closedAt;
      if (f.close === 'overdue' && !closeOverdue(d)) return false;
      if (f.close === 'month' && !(dt >= mStart && dt <= mEnd)) return false;
      if (f.close === 'quarter' && !(dt >= q.start && dt <= q.end)) return false;
      if (f.close === 'next' && !(dt >= nq.start && dt <= nq.end)) return false;
      return true;
    });
  }
  function viewDealList() {
    var f = ui.dl;
    var rows = sortRows(filteredDeals(), {
      title: function (d) { return d.title; }, company: function (d) { var c = company(d.companyId); return c ? c.name : ''; },
      stage: function (d) { return STAGE[d.stage].idx; }, value: dealValue, prob: prob, weighted: weighted,
      owner: function (d) { return ownerName(d.owner); }, expectedClose: function (d) { return isOpen(d) ? d.expectedClose : d.closedAt; },
      days: function (d) { return isOpen(d) ? daysInStage(d) : -1; }, updated: function (d) { return d.updatedAt; },
      score: function (d) { var sc = dealScore(d); return sc ? sc.score : -1; }
    }, f.sort, f.dir);
    var stageOpts = [['', 'All stages']].concat(STAGES.filter(function (s) { return f.status === 'all' || f.status === 'closed90' || (f.status === 'open' ? s.open : s.id === f.status); }).map(function (s) { return [s.id, s.name]; }));
    var filtered = f.q || f.country || f.segment || f.stage || f.close || f.score || f.status !== 'open';
    return head({
      eyebrow: 'Pipeline', title: 'Deals',
      sub: '<b>' + rows.length + '</b> deals · <b>' + esc(money(sum(rows, dealValue))) + '</b> total · <b>' + esc(money(sum(rows, weighted))) + '</b> weighted · ' + esc(scopeLabel()),
      actions: btn('Export CSV', 'export', { what: 'deals', scope: 'list' }, '', 'download') + btn('New deal', 'new-deal', {}, 'pri', 'plus')
    }) +
      '<div class="toolbar">' + dealTabs('list') + searchBox('dlQ', 'dl.q', f.q, 'Search deals, companies, products…') +
      segButtons('dl.status', f.status, [['open', 'Open'], ['won', 'Won'], ['lost', 'Lost'], ['closed90', 'Closed 90 d'], ['all', 'All']], 'Status') + '</div>' +
      '<div class="toolbar">' + filterSelect('dlStage', 'dl.stage', f.stage, stageOpts, 'Stage') +
      filterSelect('dlClose', 'dl.close', f.close, [['', 'Any close date'], ['overdue', 'Past close date'], ['month', 'Closing this month'], ['quarter', 'Closing this quarter'], ['next', 'Closing next quarter']], 'Close date') +
      filterSelect('dlScore', 'dl.score', f.score, [['', 'Any score'], ['70', 'Hot (70+)'], ['45', 'Warm or hot (45+)']], 'Lead score') + filterSelect('dlSeg', 'dl.segment', f.segment, SEG_OPTS, 'Segment') + filterSelect('dlCountry', 'dl.country', f.country, [['', 'SI + HR'], ['SI', 'Slovenia'], ['HR', 'Croatia']], 'Country') + ownerFilter('dlOwner') +
      (filtered ? btn('Reset filters', 'clear-filters', { scope: 'dl' }, 'ghost sm') : '') + '</div>' +
      '<section class="card"><div class="tablewrap"><table class="tbl"><caption class="sr">Deals</caption><thead><tr>' +
      th('dl', 'title', 'Deal') + th('dl', 'score', 'Score', 'r', true) + th('dl', 'stage', 'Stage') + th('dl', 'value', 'Value', 'r', true) + th('dl', 'prob', 'Prob.', 'r hide-md', true) + th('dl', 'weighted', 'Weighted', 'r hide-sm', true) +
      th('dl', 'owner', 'Owner', 'hide-md') + th('dl', 'expectedClose', 'Close', 'hide-sm') + th('dl', 'days', 'In stage', 'r hide-md', true) + th('dl', 'updated', 'Updated', 'hide-md', true) +
      '</tr></thead><tbody>' +
      (rows.length ? rows.map(function (d) {
        var c = company(d.companyId), open = isOpen(d), late = closeOverdue(d);
        return '<tr><td><a class="t1" href="#/deals/' + d.id + '">' + esc(d.title) + '</a> ' + fulfilChip(d) + '<small>' + esc(c ? c.name : '—') + '</small></td>' +
          '<td class="r">' + scoreBadge(dealScore(d)) + '</td><td>' + stageChip(d.stage) + '</td><td class="r num">' + esc(money(dealValue(d))) + '</td><td class="r num hide-md">' + prob(d) + '%</td>' +
          '<td class="r num hide-sm">' + esc(money(weighted(d))) + '</td><td class="hide-md">' + ownerChip(d.owner) + '</td>' +
          '<td class="hide-sm' + (late ? ' bad-t' : '') + '">' + (open ? esc(fmtDate(d.expectedClose)) + (late ? '<small class="bad-t">past close date</small>' : '') : esc(fmtDate(d.closedAt)) + '<small>' + (d.stage === 'won' ? 'won' : 'lost') + '</small>') + '</td>' +
          '<td class="r num hide-md">' + (open ? daysInStage(d) + ' d' : '—') + '</td><td class="hide-md">' + esc(ago(d.updatedAt)) + '</td></tr>';
      }).join('') : '<tr><td colspan="10"><div class="empty">No deals match these filters.</div></td></tr>') +
      '</tbody>' + (rows.length ? '<tfoot><tr><td>' + rows.length + ' deals</td><td></td><td></td><td class="r num">' + esc(money(sum(rows, dealValue))) + '</td><td class="hide-md"></td><td class="r num hide-sm">' + esc(money(sum(rows, weighted))) + '</td><td class="hide-md"></td><td class="hide-sm"></td><td class="hide-md"></td><td class="hide-md"></td></tr></tfoot>' : '') +
      '</table></div></section>';
  }

  // ── Deal detail ───────────────────────────────────────────────────────────
  function viewDeal(id) {
    var d = deal(id);
    if (!d) return viewMissing('Deal not found', 'It may have been deleted.');
    var c = company(d.companyId), ct = contact(d.contactId), cur = STAGE[d.stage];
    var acts = db.activities.filter(function (a) { return a.dealId === d.id; });
    var stepper = STAGES.map(function (s) {
      var past = d.stage !== 'lost' && s.open && s.idx < cur.idx;
      return (s.id === 'won' ? '<span class="sep" aria-hidden="true"></span>' : '') +
        '<button type="button" id="st-' + s.id + '" class="tone-' + s.tone + (past ? ' past' : '') + '" data-act="stage" data-id="' + d.id + '" data-stage="' + s.id + '" aria-pressed="' + (s.id === d.stage) + '">' +
        (past ? icon('check') : '') + esc(s.name) + (s.open ? ' <span class="mono" style="font-size:11px;opacity:.75">' + s.prob + '%</span>' : '') + '</button>';
    }).join('');
    var hist = d.history.map(function (h, i) {
      var next = d.history[i + 1], end = next ? next.at : Date.now(), days = Math.max(0, Math.round((end - h.at) / DAY));
      return '<li><span class="typeic tone-' + (STAGE[h.to] ? STAGE[h.to].tone : 'grey') + '">' + icon(h.from ? 'stage' : 'deal') + '</span><div><div class="what"><b>' +
        (h.from ? esc(STAGE[h.from].name) + ' → ' + esc(STAGE[h.to].name) : 'Created in ' + esc(STAGE[h.to].name)) + '</b></div>' +
        '<div class="when"><span>' + esc(fmtStamp(h.at)) + '</span><span>' + esc(ownerName(h.by)) + '</span>' + (STAGE[h.to] && STAGE[h.to].open ? '<span>' + (next ? days + ' d in stage' : days + ' d so far') + '</span>' : '') + '</div></div></li>';
    }).reverse().join('');
    var notes = db.notes.filter(function (n) { return n.entity === 'deal' && n.entityId === d.id; }).map(function (n) { return noteItem(n); });
    var doneActs = acts.filter(function (a) { return a.done; }).map(function (a) { return actItem(a, { noDeal: true }); });
    var v = dealValue(d);
    return head({
      crumb: 'Deals', crumbHref: '#/deals', title: d.title,
      sub: (c ? '<a href="#/companies/' + c.id + '">' + esc(c.name) + '</a>' : '') + (ct ? '<a href="#/contacts/' + ct.id + '">' + esc(personName(ct)) + '</a>' : '') + ownerChip(d.owner) + fulfilChip(d),
      actions: btn('Edit', 'edit-deal', { id: d.id }, '', 'edit') + btn('Email', 'email', { deal: d.id }, '', 'email') + btn('Log activity', 'new-act', { deal: d.id }, 'pri', 'plus') + btn('Delete', 'del-deal', { id: d.id }, 'danger-ghost', 'trash')
    }) +
      '<section class="card" style="margin-bottom:16px" aria-labelledby="hStage"><div class="card-h"><div><span class="label">Stage</span><h2 id="hStage">' + esc(cur.name) + '</h2></div></div>' +
      '<div class="stepper" role="group" aria-label="Move deal to stage">' + stepper + '</div>' +
      (d.stage === 'won' ? '<div class="banner good">' + icon('check') + '<span>Won on ' + esc(fmtDateFull(d.closedAt)) + '.</span></div>' : '') +
      (d.stage === 'lost' ? '<div class="banner bad">' + icon('close') + '<span>Lost on ' + esc(fmtDateFull(d.closedAt)) + ' · ' + esc(d.lostReason || 'no reason given') + '</span></div>' : '') +
      '<div class="tiles">' +
      '<div class="tile"><span class="label">Value</span><div class="v">' + esc(money(v)) + '</div></div>' +
      '<div class="tile"><span class="label">Probability</span><div class="v">' + prob(d) + '%</div></div>' +
      '<div class="tile"><span class="label">Weighted</span><div class="v">' + esc(money(weighted(d))) + '</div></div>' +
      '<div class="tile"><span class="label">' + (isOpen(d) ? 'Expected close' : 'Closed') + '</span><div class="v' + (closeOverdue(d) ? ' bad-t' : '') + '">' + esc(fmtDate(isOpen(d) ? d.expectedClose : d.closedAt)) + '</div></div>' +
      '<div class="tile"><span class="label">In stage</span><div class="v">' + daysInStage(d) + ' d</div></div>' +
      '<div class="tile"><span class="label">Created</span><div class="v">' + esc(fmtDate(ymd(d.createdAt))) + '</div></div>' +
      '</div></section>' +
      '<div class="detail"><div class="stack">' +
      '<section class="card" aria-labelledby="hLines"><div class="card-h"><div><span class="label">' + d.lines.length + ' line' + (d.lines.length === 1 ? '' : 's') + '</span><h2 id="hLines">Products</h2></div>' + btn('Edit lines', 'edit-deal', { id: d.id }, 'sm', 'edit') + '</div>' +
      '<div class="tablewrap"><table class="tbl"><thead><tr><th>Product</th><th class="r">Qty</th><th class="r hide-sm">Unit price</th><th class="r hide-sm">Disc.</th><th class="r">Total</th></tr></thead><tbody>' +
      d.lines.map(function (l) {
        var w = c ? stockWarn(l, c.country) : '';
        return '<tr><td>' + esc(lineLabel(l)) + '<small class="mono">' + esc(lineCode(l)) + (l.sku ? ' · ERP' : ' · service') + '</small>' + (w && isOpen(d) ? '<small class="bad-t">' + esc(w) + '</small>' : '') + '</td><td class="r num">' + fmtInt.format(l.qty) + ' <span class="muted">' + esc(lineUnit(l)) + '</span></td>' +
          '<td class="r num hide-sm">' + esc(money2(l.price)) + '</td><td class="r num hide-sm">' + (l.discount ? l.discount + '%' : '—') + '</td><td class="r num">' + esc(money2(lineTotal(l))) + '</td></tr>';
      }).join('') + '</tbody><tfoot><tr><td>Total</td><td></td><td class="hide-sm"></td><td class="hide-sm"></td><td class="r num">' + esc(money2(v)) + '</td></tr></tfoot></table></div>' + (erp.catalog || !Bus ? '' : '<div class="card-b">' + catalogHint() + '</div>') + '</section>' +
      quotesCard(d) + erpCard(d) +
      '<section class="card" aria-labelledby="hHist"><div class="card-h"><div><span class="label">' + (d.history.length - 1) + ' change' + (d.history.length === 2 ? '' : 's') + '</span><h2 id="hHist">Stage history</h2></div></div><ul class="tl">' + hist + '</ul>' + changesList(d) + '</section>' +
      '</div><div class="stack">' +
      scoreWhyCard(dealScore(d), 'This deal') +
      openActsCard(acts, { noDeal: true, noCompany: true }, { deal: d.id }) +
      '<section class="card" aria-labelledby="hNotes"><div class="card-h"><div><span class="label">Completed activities and notes</span><h2 id="hNotes">Notes &amp; history</h2></div></div>' +
      composer('deal', d.id) + timelineHtml(notes.concat(doneActs), 25) + '</section>' +
      '</div></div>';
  }

  // ── Activities ────────────────────────────────────────────────────────────
  function actFilter(a, f) {
    if (!mine(a)) return false;
    if (f.type && a.type !== f.type) return false;
    if (f.q) {
      var c = company(a.companyId), ct = contact(a.contactId), d = deal(a.dealId);
      if (!matchQ(f.q, [a.subject, a.notes, c ? c.name : '', personName(ct), d ? d.title : ''].join(' '))) return false;
    }
    return true;
  }
  var TYPE_OPTS = [['', 'All types']].concat(ACT_TYPES.map(function (t) { return [t.id, t.name + 's']; }));
  function actTabs(cur) {
    return '<div class="seg" role="group" aria-label="Activities view"><a href="#/activities"' + (cur === 'list' ? ' aria-current="page"' : '') + '>List</a><a href="#/activities/week"' + (cur === 'week' ? ' aria-current="page"' : '') + '>This week</a></div>';
  }
  function viewActivities() {
    var f = ui.act, today = todayYmd();
    var all = db.activities.filter(function (a) { return actFilter(a, f); });
    var counts = { overdue: 0, today: 0, upcoming: 0, done: 0 };
    all.forEach(function (a) { counts[actState(a)]++; });
    var list = all.filter(function (a) {
      var s = actState(a);
      if (f.status === 'open') return s !== 'done';
      if (f.status === 'all') return true;
      return s === f.status;
    });
    if (f.status === 'done') list.sort(function (a, b) { return (b.doneAt || 0) - (a.doneAt || 0); });
    else if (f.status === 'all') list.sort(function (a, b) { return b.due.localeCompare(a.due); });
    else list.sort(function (a, b) { return a.due.localeCompare(b.due); });
    var shown = list.slice(0, f.limit);
    var groups = [], gmap = {};
    shown.forEach(function (a) {
      var key = f.status === 'done' ? ymd(a.doneAt || actMs(a)) : actState(a) === 'overdue' && f.status !== 'all' ? 'overdue' : actDate(a);
      if (!gmap[key]) { gmap[key] = { key: key, items: [] }; groups.push(gmap[key]); }
      gmap[key].items.push(a);
    });
    function gLabel(k) {
      if (k === 'overdue') return 'Overdue';
      var r = relDay(k);
      return WD[(new Date(parseYmd(k)).getDay() + 6) % 7] + ', ' + fmtDate(k) + (/today|tomorrow|yesterday/.test(r) ? ' · ' + r : '');
    }
    return head({
      eyebrow: 'Calls, meetings, emails, tasks', title: 'Activities',
      sub: '<b class="' + (counts.overdue ? 'bad-t' : '') + '">' + counts.overdue + '</b> overdue · <b>' + counts.today + '</b> today · <b>' + counts.upcoming + '</b> upcoming · ' + esc(scopeLabel()),
      actions: btn('Export CSV', 'export', { what: 'activities', scope: 'list' }, '', 'download') + btn('New activity', 'new-act', {}, 'pri', 'plus')
    }) +
      '<div class="toolbar">' + actTabs('list') + searchBox('acQ', 'act.q', f.q, 'Search subject, company, contact, deal…') + '</div>' +
      '<div class="toolbar">' + segButtons('act.status', f.status, [['open', 'Open'], ['overdue', 'Overdue (' + counts.overdue + ')'], ['today', 'Today'], ['upcoming', 'Upcoming'], ['done', 'Done'], ['all', 'All']], 'Status') +
      filterSelect('acType', 'act.type', f.type, TYPE_OPTS, 'Type') + ownerFilter('acOwner') + '</div>' +
      '<section class="card">' + (groups.length ? groups.map(function (g) {
        return '<h2 class="label" style="margin:0;padding:14px 20px 6px;' + (g.key === 'overdue' ? 'color:var(--bad)' : g.key === today ? 'color:var(--accent)' : '') + '">' + esc(gLabel(g.key)) + ' · ' + g.items.length + '</h2>' +
          '<ul class="rows">' + g.items.map(function (a) { return actRow(a, { owner: true }); }).join('') + '</ul>';
      }).join('') : '<div class="empty">No activities here' + (f.status === 'overdue' ? ' — nothing overdue.' : '.') + '</div>') +
      (list.length > shown.length ? '<div class="more">' + btn('Show more (' + (list.length - shown.length) + ' left)', 'more-acts', {}, 'sm') + '</div>' : '') +
      '</section>';
  }
  function viewWeek() {
    var f = ui.week, today = todayYmd(), start = addDays(weekStartOf(today), 7 * f.offset), end = addDays(start, 6);
    var acts = db.activities.filter(function (a) { var d = actDate(a); return d >= start && d <= end && actFilter(a, { type: f.type, q: '' }) && !(f.hideDone && a.done); })
      .sort(function (a, b) { return a.due.localeCompare(b.due); });
    var days = [];
    for (var i = 0; i < 7; i++) days.push(addDays(start, i));
    var label = 'Week ' + isoWeek(start) + ' · ' + fmtDate(start) + ' – ' + fmtDate(end);
    var cols = days.map(function (day, i) {
      var items = acts.filter(function (a) { return actDate(a) === day; });
      return '<section class="wd' + (day === today ? ' today' : '') + (i >= 5 ? ' weekend' : '') + '" aria-label="' + esc(WD[i] + ' ' + fmtDate(day)) + '">' +
        '<div class="wd-h"><b>' + WD[i] + ' ' + new Date(parseYmd(day)).getDate() + '</b><small>' + (items.length ? items.length + ' item' + (items.length === 1 ? '' : 's') : '') + (day === today ? ' · today' : '') + '</small></div>' +
        '<div class="wd-b">' + items.map(function (a) {
          var st = actState(a), c = company(a.companyId);
          return '<div class="wi tone-' + TYPE_TONE[a.type] + (st === 'done' ? ' done' : '') + (st === 'overdue' ? ' overdue' : '') + '">' +
            '<input type="checkbox" class="chk" id="wdone-' + a.id + '" data-chg="done" data-id="' + a.id + '"' + (a.done ? ' checked' : '') + ' aria-label="' + esc((a.done ? 'Done: ' : 'Mark as done: ') + a.subject) + '">' +
            '<div class="x"><button type="button" class="subj" data-act="edit-act" data-id="' + a.id + '">' + esc(a.subject) + '</button>' +
            '<small>' + esc(actTime(a) + ' · ' + ACT_TYPE[a.type].name + (st === 'overdue' ? ' · overdue' : '')) + '</small>' +
            (c ? '<small>' + esc(c.name) + '</small>' : '') + (ui.me === 'all' ? '<small>' + esc(ownerName(a.owner)) + '</small>' : '') + '</div></div>';
        }).join('') + '</div></section>';
    }).join('');
    return head({
      eyebrow: 'Calls, meetings, emails, tasks', title: 'Activities', sub: '<b>' + acts.length + '</b> activities this week · ' + esc(scopeLabel()),
      actions: btn('New activity', 'new-act', {}, 'pri', 'plus')
    }) +
      '<div class="toolbar">' + actTabs('week') +
      '<div class="weeknav"><button type="button" class="btn icon" id="wkPrev" data-act="week" data-d="-1" aria-label="Previous week">' + icon('chevL') + '</button>' +
      '<span class="wk" aria-live="polite">' + esc(label) + '</span>' +
      '<button type="button" class="btn icon" id="wkNext" data-act="week" data-d="1" aria-label="Next week">' + icon('chevR') + '</button>' +
      (f.offset ? '<button type="button" class="btn sm" id="wkToday" data-act="week" data-d="0">This week</button>' : '') + '</div>' +
      '<span class="grow"></span>' + filterSelect('wkType', 'week.type', f.type, TYPE_OPTS, 'Type') + ownerFilter('wkOwner') +
      '<label class="check"><input type="checkbox" class="chk" id="wkHide" data-chg="hide-done"' + (f.hideDone ? ' checked' : '') + '>Hide done</label></div>' +
      '<section class="card" style="overflow:hidden"><div class="week">' + cols + '</div></section>';
  }

  // ── Team ──────────────────────────────────────────────────────────────────
  // ── Forms ─────────────────────────────────────────────────────────────────
  function fld(id, label, input, o) {
    o = o || {};
    return '<div class="field ' + (o.cls || '') + '"><label for="' + id + '">' + esc(label) + (o.req ? ' <span class="req" aria-hidden="true">*</span>' : '') + '</label>' + input + (o.hint ? '<span class="hint">' + esc(o.hint) + '</span>' : '') + '</div>';
  }
  function inp(id, val, attrs) { return '<input class="in" id="' + id + '" name="' + id + '" value="' + esc(val == null ? '' : val) + '" ' + (attrs || '') + '>'; }
  function sel(id, list, val, attrs) { return '<select class="in" id="' + id + '" name="' + id + '" ' + (attrs || '') + '>' + opts(list, val) + '</select>'; }
  function val(api, id) { var e = api.el.querySelector('#' + id); return e ? e.value.trim() : ''; }
  function companyOpts(withNone) {
    return (withNone ? [['', withNone]] : []).concat(db.companies.slice().sort(byName).map(function (c) { return [c.id, c.name + ' · ' + c.city]; }));
  }
  function contactOpts(companyId, none) {
    var list = db.contacts.filter(function (x) { return companyId ? x.companyId === companyId : true; })
      .sort(function (a, b) { return personName(a).localeCompare(personName(b), 'sl'); });
    return [['', none || '— None —']].concat(list.map(function (x) { var c = companyId ? null : company(x.companyId); return [x.id, personName(x) + (c ? ' · ' + c.name : '')]; }));
  }

  function companyForm(c) {
    var isNew = !c;
    var v = c || { name: '', segment: 'Optician', country: 'SI', city: '', postcode: '', address: '', phone: '', email: '', website: '', vat: '', employees: '', source: 'Referral', owner: defaultOwner() };
    openModal({
      title: isNew ? 'New company' : 'Edit company', cls: 'wide',
      body: fld('fcName', 'Company name', inp('fcName', v.name, 'required maxlength="120" autocomplete="off" autofocus'), { req: true }) +
        '<div class="row3">' + fld('fcSeg', 'Segment', sel('fcSeg', SEGMENTS.map(function (s) { return [s, s]; }), v.segment), { req: true }) +
        fld('fcCountry', 'Country', sel('fcCountry', COUNTRIES.map(function (x) { return [x.id, x.name]; }), v.country), { req: true }) +
        fld('fcOwner', 'Owner', sel('fcOwner', OWNERS.map(function (o) { return [o.id, o.name]; }), v.owner)) + '</div>' +
        '<div class="row3">' + fld('fcAddr', 'Street address', inp('fcAddr', v.address, 'maxlength="120"')) + fld('fcPost', 'Postcode', inp('fcPost', v.postcode, 'maxlength="12" inputmode="numeric"')) + fld('fcCity', 'City', inp('fcCity', v.city, 'maxlength="60"')) + '</div>' +
        '<div class="row3">' + fld('fcPhone', 'Phone', inp('fcPhone', v.phone, 'type="tel" maxlength="40"')) + fld('fcEmail', 'Email', inp('fcEmail', v.email, 'type="email" maxlength="120"')) + fld('fcWeb', 'Website', inp('fcWeb', v.website, 'maxlength="120"')) + '</div>' +
        '<div class="row3">' + fld('fcVat', 'VAT ID', inp('fcVat', v.vat, 'maxlength="20"')) + fld('fcEmp', 'Employees', inp('fcEmp', v.employees, 'type="number" min="0" step="1"')) + fld('fcSrc', 'Source', sel('fcSrc', SOURCES.map(function (s) { return [s, s]; }), v.source)) + '</div>',
      foot: '<button type="button" class="btn ghost" data-close>Cancel</button><button type="submit" class="btn pri" form="{form}">' + (isNew ? 'Create company' : 'Save changes') + '</button>',
      onSubmit: function (api) {
        var name = val(api, 'fcName'), email = val(api, 'fcEmail'), emp = val(api, 'fcEmp');
        if (!name) return formError(api, 'Enter the company name.', 'fcName');
        if (email && !isEmail(email)) return formError(api, 'That email address does not look right.', 'fcEmail');
        if (emp && (!/^\d+$/.test(emp))) return formError(api, 'Employees must be a whole number.', 'fcEmp');
        var dup = db.companies.find(function (x) { return x !== c && norm(x.name) === norm(name); });
        if (dup) return formError(api, 'A company with this name already exists.', 'fcName');
        var now = Date.now(), target = c;
        if (isNew) { target = { id: ++db.seq.company, createdAt: now }; db.companies.push(target); }
        Object.assign(target, {
          name: name, segment: val(api, 'fcSeg'), country: val(api, 'fcCountry'), owner: val(api, 'fcOwner'), address: val(api, 'fcAddr'),
          postcode: val(api, 'fcPost'), city: val(api, 'fcCity'), phone: val(api, 'fcPhone'), email: email, website: val(api, 'fcWeb'),
          vat: val(api, 'fcVat').toUpperCase(), employees: emp ? +emp : '', source: val(api, 'fcSrc'), updatedAt: now
        });
        api.close(true);
        if (isNew) { save(); updateNav(); toast('Company created'); location.hash = '#/companies/' + target.id; }
        else { commit(); toast('Company saved'); }
      }
    });
  }

  function reassignContactCompany(ct, newCompanyId) {
    if (ct.companyId === newCompanyId) return;
    var old = ct.companyId;
    // deals of the previous company can no longer point at this person as their contact
    db.deals.forEach(function (d) { if (d.contactId === ct.id && d.companyId === old) d.contactId = null; });
    ct.companyId = newCompanyId;
  }
  function contactForm(ct, preset) {
    var isNew = !ct; preset = preset || {};
    var v = ct || { firstName: '', lastName: '', title: '', email: '', phone: '', companyId: preset.companyId || null, owner: defaultOwner() };
    if (isNew && preset.companyId) { var pc = company(preset.companyId); if (pc) v.owner = pc.owner; }
    openModal({
      title: isNew ? 'New contact' : 'Edit contact',
      body: '<div class="row2">' + fld('ftFirst', 'First name', inp('ftFirst', v.firstName, 'required maxlength="60" autocomplete="off" autofocus'), { req: true }) + fld('ftLast', 'Last name', inp('ftLast', v.lastName, 'maxlength="60" autocomplete="off"')) + '</div>' +
        fld('ftCo', 'Company', sel('ftCo', companyOpts('— No company —'), v.companyId)) +
        fld('ftTitle', 'Job title', inp('ftTitle', v.title, 'maxlength="80"')) +
        '<div class="row2">' + fld('ftEmail', 'Email', inp('ftEmail', v.email, 'type="email" maxlength="120" autocomplete="off"')) + fld('ftPhone', 'Phone', inp('ftPhone', v.phone, 'type="tel" maxlength="40"')) + '</div>' +
        fld('ftOwner', 'Owner', sel('ftOwner', OWNERS.map(function (o) { return [o.id, o.name]; }), v.owner)),
      foot: '<button type="button" class="btn ghost" data-close>Cancel</button><button type="submit" class="btn pri" form="{form}">' + (isNew ? 'Create contact' : 'Save changes') + '</button>',
      onSubmit: function (api) {
        var first = val(api, 'ftFirst'), email = val(api, 'ftEmail').toLowerCase();
        if (!first) return formError(api, 'Enter at least a first name.', 'ftFirst');
        if (email && !isEmail(email)) return formError(api, 'That email address does not look right.', 'ftEmail');
        if (email && db.contacts.some(function (x) { return x !== ct && (x.email || '').toLowerCase() === email; })) return formError(api, 'Another contact already uses this email.', 'ftEmail');
        var now = Date.now(), target = ct, coId = val(api, 'ftCo') ? +val(api, 'ftCo') : null;
        if (isNew) { target = { id: ++db.seq.contact, createdAt: now, companyId: null }; db.contacts.push(target); }
        Object.assign(target, { firstName: first, lastName: val(api, 'ftLast'), title: val(api, 'ftTitle'), email: email, phone: val(api, 'ftPhone'), owner: val(api, 'ftOwner'), updatedAt: now });
        reassignContactCompany(target, coId);
        api.close(true);
        if (isNew && !preset.stay) { save(); updateNav(); toast('Contact created'); location.hash = '#/contacts/' + target.id; }
        else { commit(); toast(isNew ? 'Contact created' : 'Contact saved'); }
      }
    });
  }

  function activityForm(a, preset) {
    var isNew = !a; preset = preset || {};
    var pd = deal(preset.dealId), pct = contact(preset.contactId);
    var now = new Date(), nextHour = Math.min(17, now.getHours() + 1);
    var v = a ? {
      type: a.type, subject: a.subject, date: actDate(a), time: actTime(a), duration: a.duration || '', owner: a.owner,
      companyId: a.companyId || '', contactId: a.contactId || '', dealId: a.dealId || '', notes: a.notes || '', done: a.done
    } : {
      type: 'call', subject: '', date: todayYmd(), time: pad(nextHour) + ':00', duration: 30,
      owner: pd ? pd.owner : ui.me !== 'all' ? ui.me : ((company(preset.companyId) || contact(preset.contactId) || {}).owner || defaultOwner()),
      companyId: pd ? pd.companyId : (preset.companyId || (pct ? pct.companyId : '') || ''),
      contactId: pd ? (pd.contactId || '') : (preset.contactId || ''), dealId: pd ? pd.id : '', notes: '', done: false
    };
    function dealOpts(cid) {
      var list = cid ? db.deals.filter(function (d) { return d.companyId === cid; }) : [];
      list.sort(function (x, y) { return (isOpen(y) - isOpen(x)) || (y.updatedAt - x.updatedAt); });
      return [['', cid ? '— None —' : '— Choose a company first —']].concat(list.map(function (d) { return [d.id, d.title + ' · ' + STAGE[d.stage].name]; }));
    }
    var cid0 = v.companyId ? +v.companyId : null;
    openModal({
      title: isNew ? 'New activity' : 'Edit activity', cls: 'wide',
      body: '<fieldset class="field" style="border:0;padding:0;margin:0"><legend class="lab" style="font:400 12px var(--mono);color:var(--ink2);margin-bottom:6px">Type</legend><div class="radios">' +
        ACT_TYPES.map(function (t) { return '<label><input type="radio" name="faType" value="' + t.id + '"' + (v.type === t.id ? ' checked' : '') + '>' + esc(t.name) + '</label>'; }).join('') + '</div></fieldset>' +
        fld('faSubj', 'Subject', inp('faSubj', v.subject, 'required maxlength="140" autocomplete="off" autofocus placeholder="e.g. Follow-up call on proposal"'), { req: true }) +
        '<div class="row3">' + fld('faDate', 'Due date', inp('faDate', v.date, 'type="date" required'), { req: true }) + fld('faTime', 'Time', inp('faTime', v.time, 'type="time" step="900"')) +
        fld('faDur', 'Duration (min)', inp('faDur', v.duration, 'type="number" min="0" step="5"')) + '</div>' +
        '<div class="row2">' + fld('faCo', 'Company', sel('faCo', companyOpts('— None —'), v.companyId)) + fld('faCt', 'Contact', sel('faCt', contactOpts(cid0), v.contactId)) + '</div>' +
        '<div class="row2">' + fld('faDeal', 'Deal', sel('faDeal', dealOpts(cid0), v.dealId)) + fld('faOwner', 'Owner', sel('faOwner', OWNERS.map(function (o) { return [o.id, o.name]; }), v.owner)) + '</div>' +
        fld('faNotes', 'Notes', '<textarea class="in" id="faNotes" rows="3" maxlength="2000">' + esc(v.notes) + '</textarea>') +
        '<label class="check"><input type="checkbox" class="chk" id="faDone"' + (v.done ? ' checked' : '') + '>Done</label>',
      foot: (isNew ? '' : '<button type="button" class="btn danger-ghost" data-del>' + icon('trash') + 'Delete</button><span class="grow"></span>') +
        '<button type="button" class="btn ghost" data-close>Cancel</button><button type="submit" class="btn pri" form="{form}">' + (isNew ? 'Create activity' : 'Save changes') + '</button>',
      onOpen: function (api) {
        var co = api.el.querySelector('#faCo'), ct = api.el.querySelector('#faCt'), dl = api.el.querySelector('#faDeal');
        co.addEventListener('change', function () {
          var id = co.value ? +co.value : null, keepCt = ct.value, keepDl = dl.value;
          var c0 = contact(+keepCt);
          ct.innerHTML = opts(contactOpts(id), c0 && (!id || c0.companyId === id) ? keepCt : '');
          var d0 = deal(+keepDl);
          dl.innerHTML = opts(dealOpts(id), d0 && d0.companyId === id ? keepDl : '');
        });
        ct.addEventListener('change', function () {
          var c = contact(+ct.value);
          if (c && c.companyId && !co.value) { co.value = c.companyId; var keep = ct.value; co.dispatchEvent(new Event('change')); ct.value = keep; }
        });
        var del = api.el.querySelector('[data-del]');
        if (del) del.addEventListener('click', function () {
          api.close(true);
          confirmDialog({ title: 'Delete activity?', text: '“' + a.subject + '” will be removed permanently.', ok: 'Delete', danger: true }).then(function (ok) {
            if (!ok) return;
            db.activities = db.activities.filter(function (x) { return x !== a; });
            commit(); toast('Activity deleted');
          });
        });
      },
      onSubmit: function (api) {
        var subj = val(api, 'faSubj'), date = val(api, 'faDate'), time = val(api, 'faTime') || '09:00', dur = val(api, 'faDur');
        var type = (api.el.querySelector('input[name="faType"]:checked') || {}).value || 'task';
        if (!subj) return formError(api, 'Enter a subject.', 'faSubj');
        if (!validYmd(date)) return formError(api, 'Enter a due date.', 'faDate');
        if (!/^\d{2}:\d{2}$/.test(time)) return formError(api, 'Enter a valid time.', 'faTime');
        if (dur && !(+dur >= 0)) return formError(api, 'Duration must be a positive number.', 'faDur');
        var coId = val(api, 'faCo') ? +val(api, 'faCo') : null, ctId = val(api, 'faCt') ? +val(api, 'faCt') : null, dlId = val(api, 'faDeal') ? +val(api, 'faDeal') : null;
        var dd = deal(dlId); if (dd && dd.companyId !== coId) dlId = null;
        var done = api.el.querySelector('#faDone').checked, now = Date.now(), target = a;
        if (isNew) { target = { id: ++db.seq.activity, createdAt: now, done: false, doneAt: null }; db.activities.push(target); }
        var wasDone = target.done;
        Object.assign(target, { type: type, subject: subj, due: date + 'T' + time, duration: dur ? +dur : 0, owner: val(api, 'faOwner'), companyId: coId, contactId: ctId, dealId: dlId, notes: val(api, 'faNotes'), done: done });
        if (done && !wasDone) target.doneAt = now; else if (!done) target.doneAt = null;
        touchRelated(target, now);
        api.close(true);
        commit(); toast(isNew ? 'Activity created' : 'Activity saved');
      }
    });
  }
  function touchRelated(a, now) {
    var d = deal(a.dealId); if (d) d.updatedAt = now;
    var c = company(a.companyId); if (c) c.updatedAt = now;
  }

  // ── Deletes (no dangling references) ──────────────────────────────────────
  function deleteCompany(c) {
    var deals = db.deals.filter(function (d) { return d.companyId === c.id; }), dealIds = {};
    deals.forEach(function (d) { dealIds[d.id] = 1; });
    var acts = db.activities.filter(function (a) { return a.companyId === c.id || dealIds[a.dealId]; });
    var cts = db.contacts.filter(function (x) { return x.companyId === c.id; });
    confirmDialog({
      title: 'Delete company?', ok: 'Delete company', danger: true,
      text: c.name + ' will be deleted together with its ' + deals.length + ' deal' + (deals.length === 1 ? '' : 's') + ', ' + acts.length + ' activit' + (acts.length === 1 ? 'y' : 'ies') + ' and notes.',
      extra: cts.length ? '<label class="check"><input type="checkbox" class="chk" id="delCts">Also delete its ' + cts.length + ' contact' + (cts.length === 1 ? '' : 's') + ' (otherwise they are kept without a company)</label>' : ''
    }).then(function (el) {
      if (!el) return;
      var alsoCts = !!(el.querySelector('#delCts') && el.querySelector('#delCts').checked), ctIds = {};
      cts.forEach(function (x) { ctIds[x.id] = 1; });
      db.deals = db.deals.filter(function (d) { return !dealIds[d.id]; });
      db.quotes = db.quotes.filter(function (q) { return !dealIds[q.dealId]; });
      db.activities = db.activities.filter(function (a) { return !(a.companyId === c.id || dealIds[a.dealId]); });
      db.notes = db.notes.filter(function (n) { return !((n.entity === 'company' && n.entityId === c.id) || (n.entity === 'deal' && dealIds[n.entityId]) || (alsoCts && n.entity === 'contact' && ctIds[n.entityId])); });
      if (alsoCts) {
        db.contacts = db.contacts.filter(function (x) { return !ctIds[x.id]; });
        db.activities.forEach(function (a) { if (ctIds[a.contactId]) a.contactId = null; });
        db.deals.forEach(function (d) { if (ctIds[d.contactId]) d.contactId = null; });
        db.quotes.forEach(function (q) { if (ctIds[q.contactId]) q.contactId = null; });
      } else cts.forEach(function (x) { x.companyId = null; });
      db.companies = db.companies.filter(function (x) { return x !== c; });
      save(); updateNav(); toast('Company deleted');
      location.hash = '#/companies';
    });
  }
  function deleteContact(ct) {
    var nd = db.deals.filter(function (d) { return d.contactId === ct.id; }).length, na = db.activities.filter(function (a) { return a.contactId === ct.id; }).length;
    confirmDialog({ title: 'Delete contact?', ok: 'Delete contact', danger: true, text: personName(ct) + ' will be deleted with their notes. ' + (nd || na ? nd + ' deal(s) and ' + na + ' activit' + (na === 1 ? 'y' : 'ies') + ' are kept but no longer linked to this person.' : '') }).then(function (ok) {
      if (!ok) return;
      db.deals.forEach(function (d) { if (d.contactId === ct.id) d.contactId = null; });
      db.activities.forEach(function (a) { if (a.contactId === ct.id) a.contactId = null; });
      db.quotes.forEach(function (q) { if (q.contactId === ct.id) q.contactId = null; });
      db.notes = db.notes.filter(function (n) { return !(n.entity === 'contact' && n.entityId === ct.id); });
      db.contacts = db.contacts.filter(function (x) { return x !== ct; });
      save(); updateNav(); toast('Contact deleted');
      location.hash = '#/contacts';
    });
  }
  function deleteDeal(d) {
    var na = db.activities.filter(function (a) { return a.dealId === d.id; }).length;
    confirmDialog({ title: 'Delete deal?', ok: 'Delete deal', danger: true, text: '“' + d.title + '” (' + money(dealValue(d)) + ') will be deleted with its notes, quotes and stage history.' + (na ? ' Its ' + na + ' activit' + (na === 1 ? 'y stays' : 'ies stay') + ' on the company timeline.' : '') }).then(function (ok) {
      if (!ok) return;
      db.activities.forEach(function (a) { if (a.dealId === d.id) a.dealId = null; });
      db.notes = db.notes.filter(function (n) { return !(n.entity === 'deal' && n.entityId === d.id); });
      db.quotes = db.quotes.filter(function (q) { return q.dealId !== d.id; });
      db.deals = db.deals.filter(function (x) { return x !== d; });
      save(); updateNav(); toast('Deal deleted');
      location.hash = '#/deals';
    });
  }
  function linkContactDialog(c) {
    var list = db.contacts.filter(function (x) { return x.companyId !== c.id; }).sort(function (a, b) { return (a.companyId ? 1 : 0) - (b.companyId ? 1 : 0) || personName(a).localeCompare(personName(b), 'sl'); });
    openModal({
      title: 'Link a contact to ' + c.name,
      body: (list.length ? fld('lkCt', 'Contact', sel('lkCt', [['', 'Choose a contact…']].concat(list.map(function (x) { var o = company(x.companyId); return [x.id, personName(x) + ' · ' + (o ? o.name : 'no company')]; })), '', 'autofocus'), { hint: 'People without a company are listed first. Linking moves the contact to this company.' }) : '<p class="muted">Every contact already belongs to this company.</p>'),
      foot: '<button type="button" class="btn ghost" data-close>Cancel</button>' + (list.length ? '<button type="submit" class="btn pri" form="{form}">Link contact</button>' : ''),
      onSubmit: function (api) {
        var ct = contact(+val(api, 'lkCt'));
        if (!ct) return formError(api, 'Choose a contact.', 'lkCt');
        reassignContactCompany(ct, c.id); ct.updatedAt = Date.now();
        api.close(true); commit(); toast(personName(ct) + ' linked to ' + c.name);
      }
    });
  }

  // ── Quick search ──────────────────────────────────────────────────────────
  var qsOpen = false;
  function quickSearch() {
    if (qsOpen) return;
    qsOpen = true;
    var results = [], sel = 0;
    var api = openModal({
      title: 'Search', cls: 'qs',
      body: '<label class="sr" for="qsIn">Search companies, contacts and deals</label>' +
        '<input class="qs-in" id="qsIn" type="search" role="combobox" aria-expanded="true" aria-controls="qsList" aria-autocomplete="list" placeholder="Companies, contacts, deals…" autocomplete="off" spellcheck="false" autofocus>' +
        '<ul class="qs-res" id="qsList" role="listbox" aria-label="Search results"></ul><p class="hint" style="margin:0">↑ ↓ to move · Enter to open · Esc to close</p>',
      onClose: function () { qsOpen = false; }
    });
    var input = api.el.querySelector('#qsIn'), list = api.el.querySelector('#qsList');
    function run() {
      var q = input.value.trim(); results = [];
      if (!q) {
        db.deals.filter(mine).sort(function (a, b) { return b.updatedAt - a.updatedAt; }).slice(0, 5).forEach(function (d) { var c = company(d.companyId); results.push({ g: 'Recently updated deals', ic: 'deal', t: d.title, s: (c ? c.name : '') + ' · ' + STAGE[d.stage].name + ' · ' + money(dealValue(d)), href: '#/deals/' + d.id }); });
      } else {
        var cos = db.companies.filter(function (c) { return matchQ(q, [c.name, c.city, c.vat, c.email].join(' ')); }).slice(0, 6);
        cos.forEach(function (c) { results.push({ g: 'Companies', ic: 'company', t: c.name, s: c.segment + ' · ' + c.city + ', ' + c.country + ' · ' + ownerName(c.owner), href: '#/companies/' + c.id }); });
        var cts = db.contacts.filter(function (x) { var c = company(x.companyId); return matchQ(q, [personName(x), x.email, x.phone, x.title, c ? c.name : ''].join(' ')); }).slice(0, 6);
        cts.forEach(function (x) { var c = company(x.companyId); results.push({ g: 'Contacts', ic: 'contact', t: personName(x), s: [x.title, c ? c.name : 'No company', x.email].filter(Boolean).join(' · '), href: '#/contacts/' + x.id }); });
        var dls = db.deals.filter(function (d) { var c = company(d.companyId); return matchQ(q, [d.title, c ? c.name : ''].join(' ')); }).sort(function (a, b) { return (isOpen(b) - isOpen(a)) || (b.updatedAt - a.updatedAt); }).slice(0, 6);
        dls.forEach(function (d) { var c = company(d.companyId); results.push({ g: 'Deals', ic: 'deal', t: d.title, s: (c ? c.name : '') + ' · ' + STAGE[d.stage].name + ' · ' + money(dealValue(d)), href: '#/deals/' + d.id }); });
      }
      if (sel >= results.length) sel = 0;
      var html = '', lastG = '';
      results.forEach(function (r, i) {
        if (r.g !== lastG) { html += '<li role="presentation" class="qs-grp">' + esc(r.g) + '</li>'; lastG = r.g; }
        html += '<li role="option" class="qs-opt" id="qs-o-' + i + '" data-i="' + i + '" aria-selected="' + (i === sel) + '"><span class="typeic">' + icon(r.ic) + '</span><span class="main"><b>' + esc(r.t) + '</b><small>' + esc(r.s) + '</small></span></li>';
      });
      list.innerHTML = html || '<li role="presentation" class="empty">No matches for “' + esc(q) + '”.</li>';
      if (results.length) input.setAttribute('aria-activedescendant', 'qs-o-' + sel); else input.removeAttribute('aria-activedescendant');
    }
    function move(n) {
      if (!results.length) return;
      sel = (sel + n + results.length) % results.length;
      $$('.qs-opt', list).forEach(function (o) { o.setAttribute('aria-selected', String(+o.dataset.i === sel)); });
      input.setAttribute('aria-activedescendant', 'qs-o-' + sel);
      var o = list.querySelector('#qs-o-' + sel); if (o) o.scrollIntoView({ block: 'nearest' });
    }
    function go(i) { var r = results[i]; if (!r) return; api.close(true); qsOpen = false; location.hash = r.href; }
    input.addEventListener('input', function () { sel = 0; run(); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); go(sel); }
    });
    list.addEventListener('click', function (e) { var o = e.target.closest('.qs-opt'); if (o) go(+o.dataset.i); });
    run();
  }

  // ── CSV ───────────────────────────────────────────────────────────────────
  function csvCell(v) {
    var s = v == null ? '' : String(v);
    if (/^[=@]/.test(s) || /^[+\-]/.test(s) && !/^[+\-]?[\d\s().]+$/.test(s)) s = "'" + s; // spreadsheet formula guard
    return /[",;\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function downloadCsv(name, rows) {
    var csv = '﻿' + rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
    try {
      var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' }), url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      toast('Exported ' + (rows.length - 1) + ' rows · ' + name);
    } catch (e) { toast('Export failed in this browser.'); }
  }
  function n2(v) { return (Math.round(v * 100) / 100).toFixed(2); }
  function exportData(what, scope) {
    var stamp = todayYmd(), rows;
    if (what === 'companies') {
      var st = companyStats(), list = scope === 'list' ? filteredCompanies() : db.companies.filter(mine);
      rows = [['ID', 'Name', 'Segment', 'Country', 'City', 'Postcode', 'Address', 'Phone', 'Email', 'Website', 'VAT ID', 'Employees', 'Source', 'Owner', 'Contacts', 'Open deals', 'Open pipeline EUR', 'Won to date EUR', 'Created']]
        .concat(list.map(function (c) { var s = st.get(c.id); return [c.id, c.name, c.segment, c.country, c.city, c.postcode, c.address, c.phone, c.email, c.website, c.vat, c.employees, c.source, ownerName(c.owner), s.contacts, s.open, n2(s.openValue), n2(s.wonValue), ymd(c.createdAt)]; }));
    } else if (what === 'contacts') {
      var lc = scope === 'list' ? filteredContacts() : db.contacts.filter(mine);
      rows = [['ID', 'First name', 'Last name', 'Job title', 'Email', 'Phone', 'Company ID', 'Company', 'Country', 'Owner', 'Created']]
        .concat(lc.map(function (x) { var c = company(x.companyId); return [x.id, x.firstName, x.lastName, x.title, x.email, x.phone, c ? c.id : '', c ? c.name : '', c ? c.country : '', ownerName(x.owner), ymd(x.createdAt)]; }));
    } else if (what === 'deals') {
      var ld = scope === 'list' ? filteredDeals() : scope === 'board' ? db.deals.filter(function (d) { return dealMatches(d, ui.board); }) : db.deals.filter(mine);
      rows = [['ID', 'Title', 'Company ID', 'Company', 'Contact', 'Owner', 'Stage', 'Probability %', 'Value EUR', 'Weighted EUR', 'Expected close', 'Closed', 'Lost reason', 'Days in stage', 'Line items', 'Created', 'Updated']]
        .concat(ld.map(function (d) {
          var c = company(d.companyId);
          return [d.id, d.title, d.companyId, c ? c.name : '', personName(contact(d.contactId)), ownerName(d.owner), STAGE[d.stage].name, prob(d), n2(dealValue(d)), n2(weighted(d)), d.expectedClose, d.closedAt || '', d.lostReason || '', isOpen(d) ? daysInStage(d) : '',
            d.lines.map(function (l) { return lineCode(l) + ' x' + l.qty + ' @' + l.price + (l.discount ? ' -' + l.discount + '%' : ''); }).join(' | '), ymd(d.createdAt), ymd(d.updatedAt)];
        }));
    } else {
      var la = db.activities.filter(function (a) { return actFilter(a, ui.act); });
      rows = [['ID', 'Type', 'Subject', 'Due', 'Duration min', 'Done', 'Done at', 'Owner', 'Company', 'Contact', 'Deal', 'Notes']]
        .concat(la.map(function (a) { var c = company(a.companyId), dl = deal(a.dealId); return [a.id, ACT_TYPE[a.type].name, a.subject, a.due.replace('T', ' '), a.duration || '', a.done ? 'yes' : 'no', a.doneAt ? ymd(a.doneAt) + ' ' + hhmm(a.doneAt) : '', ownerName(a.owner), c ? c.name : '', personName(contact(a.contactId)), dl ? dl.title : '', a.notes || '']; }));
    }
    downloadCsv('crm-' + what + '-' + stamp + '.csv', rows);
  }
  function detectDelim(text) {
    var line = text.split(/\r?\n/).find(function (l) { return l.trim(); }) || '';
    var c = { ',': 0, ';': 0, '\t': 0 }, q = false, best = ',';
    for (var i = 0; i < line.length; i++) { var ch = line[i]; if (ch === '"') q = !q; else if (!q && Object.prototype.hasOwnProperty.call(c, ch)) c[ch]++; }
    Object.keys(c).forEach(function (k) { if (c[k] > c[best]) best = k; });
    return best;
  }
  function parseCsv(text, delim) {
    var rows = [], row = [], f = '', q = false, i = 0, n = text.length;
    if (text.charCodeAt(0) === 0xFEFF) i = 1;
    for (; i < n; i++) {
      var ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
        else f += ch;
      } else if (ch === '"' && f === '') q = true;
      else if (ch === delim) { row.push(f); f = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
      else f += ch;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    return rows.map(function (r) { return r.map(function (x) { return x.trim(); }); }).filter(function (r) { return r.some(function (x) { return x !== ''; }); });
  }

  // ── Import & export page ──────────────────────────────────────────────────
  var IMP_FIELDS = [
    { key: 'name', label: 'Name (full, or first name)', req: true, re: /^(full ?name|name|contact|contact name|ime|ime in priimek|ime i prezime|first ?name|given name)$/ },
    { key: 'last', label: 'Last name', re: /^(last ?name|surname|family name|priimek|prezime)$/ },
    { key: 'email', label: 'Email', re: /e-?mail|mail/ },
    { key: 'phone', label: 'Phone', re: /phone|tel|mobile|gsm|mobitel/ },
    { key: 'company', label: 'Company', re: /company|organi[sz]ation|account|podjetje|tvrtka|firma|poduzece/ },
    { key: 'title', label: 'Job title', re: /title|position|role|funkcija|delovno|pozicija/ }
  ];
  function newImp() { return { step: 1, text: '', header: true, delim: 'auto', headers: [], data: [], map: {}, owner: defaultOwner(), createCos: true, segment: 'Optician', country: 'SI', result: null }; }
  var imp = newImp();
  function impPlan() {
    var seenEmail = {}, newCos = {}, out = [];
    db.contacts.forEach(function (x) { if (x.email) seenEmail[x.email.toLowerCase()] = 'existing'; });
    var coByName = {}; db.companies.forEach(function (c) { coByName[norm(c.name)] = c; });
    imp.data.forEach(function (r, i) {
      function g(k) { var ix = imp.map[k]; return ix === '' || ix == null ? '' : (r[+ix] || '').trim(); }
      var name = g('name'), last = g('last'), first = name;
      if (imp.map.last === '' || imp.map.last == null) {
        var parts = name.split(/\s+/).filter(Boolean);
        if (parts.length > 1) { last = parts.pop(); first = parts.join(' '); }
      }
      var email = g('email').toLowerCase(), comp = g('company'), p = { row: i + 1, first: first, last: last, email: email, phone: g('phone'), company: comp, title: g('title'), status: 'ok', note: '' };
      if (!first) { p.status = 'skip'; p.note = 'No name'; }
      else if (email && !isEmail(email)) { p.note = 'Invalid email dropped'; p.email = ''; }
      else if (email && seenEmail[email]) { p.status = 'skip'; p.note = seenEmail[email] === 'existing' ? 'Email already in CRM' : 'Duplicate row'; }
      if (p.status === 'ok') {
        if (p.email) seenEmail[p.email] = 'row';
        if (comp) {
          var ex = coByName[norm(comp)];
          if (ex) { p.companyId = ex.id; p.coNote = 'Linked to ' + ex.name; }
          else if (imp.createCos) { p.newCo = comp; p.coNote = 'New company'; newCos[norm(comp)] = comp; }
          else p.coNote = 'Not found — no company';
        }
      }
      out.push(p);
    });
    return { rows: out, ok: out.filter(function (p) { return p.status === 'ok'; }).length, skip: out.filter(function (p) { return p.status !== 'ok'; }).length, newCos: Object.keys(newCos).length };
  }
  function impSample() {
    var ex = db.contacts.find(function (x) { return x.email; });
    return 'Name;Email;Phone;Company;Position\n' +
      'Tjaša Primožič;tjasa.primozic@example.com;+386 40 555 123;Očesna klinika Lipa d.o.o.;Head nurse\n' +
      'Marin Vlašić;marin.vlasic@example.com;+385 98 555 4410;Optika Svjetionik d.o.o.;Owner\n' +
      '"Lea Zorko";lea.zorko@example.com;;"Optika Svjetionik d.o.o.";Optometrist\n' +
      'Boris Petrač;boris.petrac@example;+385 91 555 2231;Kapija Logistika d.o.o.;HR manager\n' +
      ';no.name@example.com;+386 41 555 777;;\n' +
      (ex ? personName(ex) + ';' + ex.email + ';' + (ex.phone || '') + ';;\n' : '');
  }
  function viewData() {
    var exp = '<section class="card" aria-labelledby="hExp"><div class="card-h"><div><span class="label">Download</span><h2 id="hExp">Export CSV</h2></div></div>' +
      '<div class="card-b"><p class="small" style="margin:0 0 12px">UTF-8 with BOM, comma-separated, opens directly in Excel. Exports follow <b>My view</b> (now: ' + esc(scopeLabel()) + '). List pages export exactly the filtered list you see.</p>' +
      '<div class="actions">' + btn('Companies (' + db.companies.filter(mine).length + ')', 'export', { what: 'companies', scope: 'all' }, '', 'download') +
      btn('Contacts (' + db.contacts.filter(mine).length + ')', 'export', { what: 'contacts', scope: 'all' }, '', 'download') +
      btn('Deals (' + db.deals.filter(mine).length + ')', 'export', { what: 'deals', scope: 'all' }, '', 'download') + '</div></div></section>';
    var reset = '<section class="card" aria-labelledby="hReset"><div class="card-h"><div><span class="label">Demo</span><h2 id="hReset">Reset demo data</h2></div></div>' +
      '<div class="card-b"><p class="small" style="margin:0 0 12px">All data is fictional. It is saved in this browser (IndexedDB database <span class="mono">adrial-crm</span>; view settings in localStorage <span class="mono">adrial-crm-ui</span>), plus your private cloud copy when you sign in to sync. Resetting replaces everything with a fresh copy of the generated demo set: ' + db.companies.length + ' companies, ' + db.contacts.length + ' contacts, ' + db.deals.length + ' deals and ' + db.activities.length + ' activities right now.</p>' +
      btn('Reset demo data…', 'reset', {}, 'danger-ghost', 'trash') + '</div></section>';
    return head({ eyebrow: 'Tools', title: 'Import & export', sub: 'Move contacts in and data out as CSV' }) +
      '<div class="grid2"><div class="stack">' + importCard() + '</div><div class="stack">' + exp +
      '<section class="card" aria-labelledby="hSync"><div class="card-h"><div><span class="label">Across your devices</span><h2 id="hSync">Cloud sync</h2></div></div><div class="card-b"><div id="syncPanel"></div><p class="hint" style="margin:10px 0 0">Sign in (or create an account with any e-mail and a password) to keep one private copy of the CRM data in the cloud. Saves upload automatically; “Reset demo data” does not delete the cloud copy.</p></div></section>' +
      reset + '</div></div>';
  }
  function importCard() {
    var steps = '<div class="steps" aria-hidden="true"><span class="' + (imp.step === 1 ? 'on' : '') + '">1 · Source</span><span class="' + (imp.step === 2 ? 'on' : '') + '">2 · Map &amp; preview</span><span class="' + (imp.step === 3 ? 'on' : '') + '">3 · Done</span></div>';
    var h = '<section class="card" aria-labelledby="hImp"><div class="card-h"><div><span class="label">Contacts</span><h2 id="hImp">Import contacts from CSV</h2></div>' + steps + '</div><div class="card-b" style="display:flex;flex-direction:column;gap:14px">';
    if (imp.step === 1) {
      h += '<p class="small" style="margin:0">Paste rows from Excel or a CSV file, or choose a file. Comma, semicolon and tab separators are detected automatically. Name, email, phone and company columns can be mapped in the next step.</p>' +
        '<div class="dropzone">' + fld('impText', 'Paste CSV', '<textarea class="in" id="impText" data-in="imp-text" rows="8" spellcheck="false" style="font-family:var(--mono);font-size:13px" placeholder="Name;Email;Phone;Company">' + esc(imp.text) + '</textarea>') +
        '<div class="toolbar" style="margin:0"><label class="btn sm" for="impFile">' + icon('upload') + 'Choose file…</label><input type="file" id="impFile" class="sr" accept=".csv,.txt,text/csv,text/plain" data-chg="imp-file">' +
        btn('Load sample', 'imp-sample', {}, 'sm ghost') + '<span class="grow"></span>' +
        '<label class="check"><input type="checkbox" class="chk" id="impHeader" data-chg="imp-header"' + (imp.header ? ' checked' : '') + '>First row is a header</label>' +
        '<label class="sr" for="impDelim">Separator</label><select class="select" id="impDelim" data-chg="imp-delim">' + opts([['auto', 'Auto-detect'], [',', 'Comma'], [';', 'Semicolon'], ['\t', 'Tab']], imp.delim) + '</select></div></div>' +
        '<div class="actions" style="justify-content:flex-end">' + btn('Preview →', 'imp-parse', {}, 'pri') + '</div>';
    } else if (imp.step === 2) {
      var plan = impPlan();
      var colOpts = [['', '— Not mapped —']].concat(imp.headers.map(function (hh, i) { return [String(i), hh || 'Column ' + (i + 1)]; }));
      h += '<div class="mapgrid">' + IMP_FIELDS.map(function (f) {
        return fld('map-' + f.key, f.label, '<select class="in" id="map-' + f.key + '" data-chg="imp-map" data-field="' + f.key + '">' + opts(colOpts, imp.map[f.key] == null ? '' : imp.map[f.key]) + '</select>', { req: f.req });
      }).join('') + '</div>' +
        '<p class="hint" style="margin:0">If no Last name column is mapped, the last word of the name becomes the last name.</p>' +
        '<div class="mapgrid">' + fld('impOwner', 'Owner of new contacts', '<select class="in" id="impOwner" data-chg="imp-opt" data-k="owner">' + ownerOpts(imp.owner) + '</select>') +
        '<div class="field"><span class="lab">Unknown companies</span><label class="check" style="min-height:44px"><input type="checkbox" class="chk" id="impCreate" data-chg="imp-opt" data-k="createCos"' + (imp.createCos ? ' checked' : '') + '>Create them</label></div>' +
        (imp.createCos ? fld('impSeg', 'New company segment', '<select class="in" id="impSeg" data-chg="imp-opt" data-k="segment">' + opts(SEGMENTS.map(function (s) { return [s, s]; }), imp.segment) + '</select>') +
          fld('impCountry', 'New company country', '<select class="in" id="impCountry" data-chg="imp-opt" data-k="country">' + opts(COUNTRIES.map(function (c) { return [c.id, c.name]; }), imp.country) + '</select>') : '') + '</div>' +
        '<div class="stats" style="border:1px solid var(--hair);border-radius:14px"><span><b>' + plan.ok + '</b> to import</span><span><b>' + plan.skip + '</b> skipped</span><span><b>' + plan.newCos + '</b> new compan' + (plan.newCos === 1 ? 'y' : 'ies') + '</span><span>' + imp.data.length + ' rows read</span></div>' +
        (imp.map.name === '' || imp.map.name == null ? '<div class="err" role="alert">Map the Name column to continue.</div>' : '') +
        '<div class="tablewrap" style="border:1px solid var(--hair);border-radius:14px"><table class="tbl preview"><caption class="sr">Preview of the first rows</caption><thead><tr><th>#</th><th>First</th><th>Last</th><th class="hide-sm">Email</th><th class="hide-md">Phone</th><th>Company</th><th>Status</th></tr></thead><tbody>' +
        plan.rows.slice(0, 12).map(function (p) {
          return '<tr><td class="mono muted">' + p.row + '</td><td>' + esc(p.first || '—') + '</td><td>' + esc(p.last || '—') + '</td><td class="hide-sm">' + esc(p.email || '—') + '</td><td class="hide-md mono">' + esc(p.phone || '—') + '</td>' +
            '<td>' + esc(p.company || '—') + (p.coNote ? '<small>' + esc(p.coNote) + '</small>' : '') + '</td>' +
            '<td>' + (p.status === 'ok' ? '<span class="chip good">Import</span>' : '<span class="chip bad">Skip</span>') + (p.note ? '<small>' + esc(p.note) + '</small>' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div>' +
        (plan.rows.length > 12 ? '<p class="hint" style="margin:0">Showing 12 of ' + plan.rows.length + ' rows.</p>' : '') +
        '<div class="actions" style="justify-content:space-between">' + btn('← Back', 'imp-back', {}, 'ghost') +
        '<button type="button" class="btn pri" data-act="imp-run"' + (plan.ok && imp.map.name !== '' && imp.map.name != null ? '' : ' disabled') + '>Import ' + plan.ok + ' contact' + (plan.ok === 1 ? '' : 's') + '</button></div>';
    } else {
      var r = imp.result || { added: 0, skipped: 0, newCos: 0 };
      h += '<div class="banner good" style="margin:0">' + icon('check') + '<span>Imported <b>' + r.added + '</b> contact' + (r.added === 1 ? '' : 's') + (r.newCos ? ' and created <b>' + r.newCos + '</b> compan' + (r.newCos === 1 ? 'y' : 'ies') : '') + '. ' + r.skipped + ' row' + (r.skipped === 1 ? ' was' : 's were') + ' skipped.</span></div>' +
        '<div class="actions"><a class="btn pri" href="#/contacts">View contacts</a>' + btn('Import another file', 'imp-again', {}, '') + '</div>';
    }
    return h + '</div></section>';
  }
  function impParse() {
    var text = imp.text;
    if (!text.trim()) { toast('Paste some CSV text or choose a file first.'); var t = $('#impText'); if (t) t.focus(); return; }
    var delim = imp.delim === 'auto' ? detectDelim(text) : imp.delim;
    var rows = parseCsv(text, delim);
    if (!rows.length) { toast('No rows found.'); return; }
    var width = Math.max.apply(null, rows.map(function (r) { return r.length; }));
    if (imp.header) { imp.headers = rows[0].concat([]); imp.data = rows.slice(1); }
    else { imp.headers = []; imp.data = rows; }
    for (var i = 0; i < width; i++) if (!imp.headers[i]) imp.headers[i] = 'Column ' + (i + 1);
    imp.map = {};
    IMP_FIELDS.forEach(function (f) {
      var ix = imp.header ? imp.headers.findIndex(function (h) { return f.re.test(norm(h).trim()); }) : -1;
      imp.map[f.key] = ix >= 0 ? String(ix) : '';
    });
    if (imp.map.name === '' && !imp.header) imp.map.name = '0';
    imp.step = 2; refresh();
    var m = $('#map-name'); if (m) m.focus();
  }
  function impRun() {
    var plan = impPlan(), now = Date.now(), created = {}, added = 0;
    plan.rows.forEach(function (p) {
      if (p.status !== 'ok') return;
      var coId = p.companyId || null;
      if (!coId && p.newCo) {
        var k = norm(p.newCo);
        if (!created[k]) {
          var c = { id: ++db.seq.company, name: p.newCo, segment: imp.segment, country: imp.country, city: '', postcode: '', address: '', phone: '', email: '', website: '', vat: '', employees: '', source: 'Import', owner: imp.owner, createdAt: now, updatedAt: now };
          db.companies.push(c); created[k] = c.id;
        }
        coId = created[k];
      }
      db.contacts.push({ id: ++db.seq.contact, firstName: p.first, lastName: p.last, title: p.title, email: p.email, phone: p.phone, companyId: coId, owner: imp.owner, createdAt: now, updatedAt: now });
      added++;
    });
    imp.result = { added: added, skipped: plan.skip, newCos: Object.keys(created).length };
    imp.step = 3; imp.text = '';
    commit();
    toast('Imported ' + added + ' contacts');
  }

  // ── Reset ─────────────────────────────────────────────────────────────────
  function resetDemo() {
    confirmDialog({ title: 'Reset demo data?', ok: 'Reset demo data', danger: true, text: 'This replaces all companies, contacts, deals, activities and notes with a fresh copy of the demo data. Every change you made in this browser will be lost.' }).then(function (ok) {
      if (!ok) return;
      lsDel(KEY); lsDel(UIKEY);
      clearTimeout(saveTimer); dirty = false;
      Promise.resolve(writing).then(function () { return idbClear(); }).catch(function () { /* fall back to in-memory */ }).then(function () {
        db = migrate(D.generate(Date.now())); maps = null; scoreCache = null; dupCache = null; ui = loadUi(); imp = newImp();
        templatesSeeded = false;
        dirty = true; flushNow().then(function () { if (crmSync) crmSync.changed(); });
        if (Bus) Bus.reset('crm').then(function () { publishSoon(200); }, function () { /* ignore */ });
        updateNav(); toast('Demo data reset');
        if (location.hash === '#/' || location.hash === '') route(); else location.hash = '#/';
      });
    });
  }

  // ── Event wiring ──────────────────────────────────────────────────────────
  var ACT = {
    'new-menu': function (t) {
      if (pop && pop.anchor === t) { closePop(true); return; }
      openPop(t, [
        { label: 'Deal', icon: 'deal', run: function () { dealForm(null, {}); } },
        { label: 'Company', icon: 'company', run: function () { companyForm(null); } },
        { label: 'Contact', icon: 'contact', run: function () { contactForm(null, {}); } },
        { label: 'Activity', icon: 'task', run: function () { activityForm(null, {}); } }
      ]);
    },
    search: function () { quickSearch(); },
    reset: function () { resetDemo(); },
    sort: function (t) {
      var s = ui[t.dataset.scope], col = t.dataset.col;
      if (s.sort === col) s.dir = -s.dir; else { s.sort = col; s.dir = t.dataset.desc ? -1 : 1; }
      saveUi(); refresh();
    },
    seg: function (t) { setUi(t.dataset.key, t.dataset.val); refresh(); },
    'clear-filters': function (t) {
      var s = t.dataset.scope; ui[s] = Object.assign(clone(UIDEF[s]), { sort: ui[s].sort, dir: ui[s].dir });
      if (!('sort' in UIDEF[s])) { delete ui[s].sort; delete ui[s].dir; }
      saveUi(); refresh();
    },
    'goto-acts': function (t) { setUi('act.status', t.dataset.status || 'open'); if (location.hash === '#/activities') refresh(); else location.hash = '#/activities'; },
    'goto-deals': function (t) {
      var st = t.dataset.status, cl = t.dataset.close;
      ui.dl = Object.assign(clone(UIDEF.dl), { sort: ui.dl.sort, dir: ui.dl.dir });
      if (cl === 'quarter') { ui.dl.status = 'all'; ui.dl.close = 'quarter'; }
      else if (st === 'won' || st === 'lost') { ui.dl.status = st; ui.dl.sort = 'expectedClose'; ui.dl.dir = -1; if (t.closest('.kpi')) ui.dl.close = 'month'; }
      else if (st === 'closed90') { ui.dl.status = 'closed90'; ui.dl.sort = 'expectedClose'; ui.dl.dir = -1; }
      if (t.dataset.sort) { ui.dl.sort = t.dataset.sort; ui.dl.dir = -1; }
      saveUi();
      if (location.hash === '#/deals/list') refresh(); else location.hash = '#/deals/list';
    },
    'new-company': function () { companyForm(null); },
    'edit-company': function (t) { var c = company(+t.dataset.id); if (c) companyForm(c); },
    'del-company': function (t) { var c = company(+t.dataset.id); if (c) deleteCompany(c); },
    'new-contact': function (t) { contactForm(null, { companyId: t.dataset.company ? +t.dataset.company : null, stay: !!t.dataset.company }); },
    'edit-contact': function (t) { var c = contact(+t.dataset.id); if (c) contactForm(c); },
    'del-contact': function (t) { var c = contact(+t.dataset.id); if (c) deleteContact(c); },
    'link-contact': function (t) { var c = company(+t.dataset.company); if (c) linkContactDialog(c); },
    'unlink-contact': function (t) {
      var ct = contact(+t.dataset.id); if (!ct) return;
      reassignContactCompany(ct, null); ct.updatedAt = Date.now(); commit(); toast(personName(ct) + ' unlinked');
    },
    'new-deal': function (t) { dealForm(null, { companyId: t.dataset.company ? +t.dataset.company : null, contactId: t.dataset.contact ? +t.dataset.contact : null }); },
    'edit-deal': function (t) { var d = deal(+t.dataset.id); if (d) dealForm(d); },
    'del-deal': function (t) { var d = deal(+t.dataset.id); if (d) deleteDeal(d); },
    stage: function (t) { var d = deal(+t.dataset.id); if (d) requestMove(d, t.dataset.stage); },
    'new-act': function (t) { activityForm(null, { companyId: t.dataset.company ? +t.dataset.company : null, contactId: t.dataset.contact ? +t.dataset.contact : null, dealId: t.dataset.deal ? +t.dataset.deal : null }); },
    'edit-act': function (t) { var a = M().act.get(+t.dataset.id); if (a) activityForm(a); },
    'add-note': function (t) {
      var ta = $('#noteText'), text = ta ? ta.value.trim() : '';
      if (!text) { toast('Write something first.'); if (ta) ta.focus(); return; }
      var now = Date.now(), ent = t.dataset.entity, id = +t.dataset.id;
      var owner = ui.me !== 'all' ? ui.me : ((ent === 'company' ? company(id) : ent === 'contact' ? contact(id) : deal(id)) || {}).owner || 'u1';
      db.notes.push({ id: ++db.seq.note, entity: ent, entityId: id, text: text, at: now, owner: owner });
      var tgt = ent === 'company' ? company(id) : ent === 'contact' ? contact(id) : deal(id); if (tgt) tgt.updatedAt = now;
      commit(); toast('Note added');
    },
    'del-note': function (t) {
      var n = M().note.get(+t.dataset.id); if (!n) return;
      confirmDialog({ title: 'Delete note?', text: n.text.length > 120 ? n.text.slice(0, 117) + '…' : n.text, ok: 'Delete', danger: true }).then(function (ok) {
        if (!ok) return; db.notes = db.notes.filter(function (x) { return x !== n; }); commit(); toast('Note deleted');
      });
    },
    'tl-all': function () { tlExpanded = true; refresh(); },
    export: function (t) { exportData(t.dataset.what, t.dataset.scope); },
    week: function (t) { var d = +t.dataset.d; ui.week.offset = d === 0 ? 0 : ui.week.offset + d; saveUi(); refresh(); },
    'more-acts': function () { ui.act.limit += 120; refresh(); },
    'set-me': function (t) { ui.me = t.dataset.id; saveUi(); updateNav(); refresh(); toast(ui.me === 'all' ? 'Showing all owners' : 'Viewing as ' + ownerName(ui.me)); },
    'imp-sample': function () { imp.text = impSample(); imp.header = true; imp.delim = 'auto'; refresh(); },
    'imp-parse': function () { impParse(); },
    'imp-back': function () { imp.step = 1; refresh(); },
    'imp-run': function () { impRun(); },
    'imp-again': function () { imp = newImp(); refresh(); }
  };
  var CHG = {
    me: function (t) { ui.me = t.value; saveUi(); updateNav(); refresh(); },
    ui: function (t) { setUi(t.dataset.key, t.value); refresh(); },
    done: function (t) {
      var a = M().act.get(+t.dataset.id); if (!a) return;
      var now = Date.now();
      a.done = t.checked; a.doneAt = t.checked ? now : null;
      touchRelated(a, now);
      commit(); toast(a.done ? 'Done · ' + a.subject : 'Reopened · ' + a.subject);
    },
    move: function (t) { var d = deal(+t.dataset.id); if (d) requestMove(d, t.value); },
    'hide-done': function (t) { ui.week.hideDone = t.checked; saveUi(); refresh(); },
    'imp-header': function (t) { imp.header = t.checked; },
    'imp-delim': function (t) { imp.delim = t.value; },
    'imp-file': function (t) {
      var f = t.files && t.files[0]; if (!f) return;
      if (f.size > 2 * 1024 * 1024) { toast('File is larger than 2 MB.'); return; }
      var r = new FileReader();
      r.onload = function () { imp.text = String(r.result || ''); refresh(); toast('Loaded ' + f.name); };
      r.onerror = function () { toast('Could not read the file.'); };
      r.readAsText(f);
    },
    'imp-map': function (t) { imp.map[t.dataset.field] = t.value; refresh(); },
    'imp-opt': function (t) { imp[t.dataset.k] = t.type === 'checkbox' ? t.checked : t.value; refresh(); }
  };
  var INP = {
    ui: function (t) { setUi(t.dataset.key, t.value); refresh(); },
    'imp-text': function (t) { imp.text = t.value; }
  };
  document.addEventListener('click', function (e) {
    if (!db) return;
    var t = e.target.closest('[data-act]');
    if (!t || t.disabled) return;
    var fn = ACT[t.dataset.act]; if (!fn) return;
    e.preventDefault(); fn(t, e);
  });
  document.addEventListener('change', function (e) { if (!db) return; var t = e.target.closest('[data-chg]'); if (!t) return; var fn = CHG[t.dataset.chg]; if (fn) fn(t, e); });
  document.addEventListener('input', function (e) { if (!db) return; var t = e.target.closest('[data-in]'); if (!t) return; var fn = INP[t.dataset.in]; if (fn) fn(t, e); });
  function isTyping(el) { return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable); }
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); if (db) quickSearch(); return; }
    if (e.key === 'Escape') {
      if (pop) { e.preventDefault(); closePop(true); return; }
      if (stack.length) { e.preventDefault(); stack[stack.length - 1].close(); return; }
      if ($('#side').classList.contains('open')) { e.preventDefault(); closeSide(true); return; }
    }
    if (e.key === 'Tab' && stack.length) {
      var m = stack[stack.length - 1].el, f = $$(FOCUSABLE, m).filter(function (x) { return x.offsetParent !== null || x === document.activeElement; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (!m.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    if (e.key === '/' && db && !stack.length && !isTyping(e.target)) { e.preventDefault(); quickSearch(); }
  });
  $('#menuBtn').addEventListener('click', function () { if ($('#side').classList.contains('open')) closeSide(true); else openSide(); });
  $('#sideScrim').addEventListener('click', function () { closeSide(true); });
  $('#skipLink').addEventListener('click', function (e) { e.preventDefault(); var h = $('#main h1'); if (h) { h.setAttribute('tabindex', '-1'); h.focus(); } else $('#main').focus(); });

  function afterRender() {
    if ($('#syncPanel')) mountSyncPanel();
    drawCharts();
    if ($('.board')) bindBoard();
  }
  var rz = null;
  window.addEventListener('resize', function () { clearTimeout(rz); rz = setTimeout(drawCharts, 120); });
  window.addEventListener('adrial-theme', function () { drawCharts(); });
  window.addEventListener('hashchange', whenReady(function () { route(); }));

  // ══ Round 2: ERP bus, quotes, targets, lead scoring, duplicates, email templates ═══════════════
  var Bus = window.AdrialBus || null;
  var erp = { catalog: null, catalogAt: null, catIndex: null, customers: null, custIndex: null };
  var VAT_STD = { SI: 22, HR: 25 };
  var SELLER = { name: 'Adrial demo company d.o.o.', lines: ['Demo cesta 1, 1000 Ljubljana, Slovenia', 'VAT ID SI00000000 · b2b@example.com · +386 1 555 00 00'] };
  function r2(v) { return Math.round((+v || 0) * 100) / 100; }
  function monthsBack(n) {
    var out = [], b = new Date(); b.setDate(1);
    for (var i = n - 1; i >= 0; i--) { var d = new Date(b.getFullYear(), b.getMonth() - i, 1); out.push(d.getFullYear() + '-' + pad(d.getMonth() + 1)); }
    return out;
  }

  // ── Data model additions (old saved data is upgraded in place) ──────────────
  function migrate(d) {
    if (!d) return d;
    if (!Array.isArray(d.quotes)) d.quotes = [];
    if (!d.seq.quoteYear || typeof d.seq.quoteYear !== 'object') d.seq.quoteYear = {};
    if (typeof d.seq.quote !== 'number') d.seq.quote = d.quotes.reduce(function (m, q) { return Math.max(m, q.id); }, 0);
    if (!Array.isArray(d.dupIgnore)) d.dupIgnore = [];
    if (!d.targets || typeof d.targets !== 'object') d.targets = defaultTargets(d);
    OWNERS.forEach(function (o) { if (!d.targets[o.id]) d.targets[o.id] = { month: 20000, quarter: 60000 }; });
    migrate3(d);
    return d;
  }
  function defaultTargets(d) {
    var n = new Date(), from = ymd(new Date(n.getFullYear(), n.getMonth() - 12, 1).getTime()), out = {};
    OWNERS.forEach(function (o) {
      var won = d.deals.filter(function (x) { return x.owner === o.id && x.stage === 'won' && x.closedAt >= from; });
      var m = Math.max(5000, Math.round(sum(won, dealValue) / 12 * 1.1 / 1000) * 1000);
      out[o.id] = { month: m, quarter: m * 3 };
    });
    return out;
  }

  // ── Line items: CRM programmes (productId) or ERP catalogue products (sku) ─
  function lineLabel(l) { return l.sku ? (l.name || l.sku) : (PRODUCT[l.productId] ? PRODUCT[l.productId].name : (l.productId || '—')); }
  function lineCode(l) { return l.sku || l.productId || ''; }
  function lineUnit(l) { return l.sku ? 'pcs' : (PRODUCT[l.productId] ? PRODUCT[l.productId].unit : ''); }
  function catProduct(sku) {
    if (!erp.catalog || !sku) return null;
    if (!erp.catIndex) { erp.catIndex = new Map(); erp.catalog.products.forEach(function (p) { if (p && p.sku) erp.catIndex.set(p.sku, p); }); }
    return erp.catIndex.get(sku) || null;
  }
  function vatPct(v) { v = +v || 0; return v > 0 && v < 1 ? Math.round(v * 1000) / 10 : v; }
  function stockFor(p, country) {
    if (!p) return null;
    if (p.availableByCountry && p.availableByCountry[country] != null) return +p.availableByCountry[country];
    return p.available != null ? +p.available : null;
  }
  function lineVat(l, country) {
    if (l.sku) { var p = catProduct(l.sku), rates = (p && p.vat) || l.vatRates; if (rates && rates[country] != null) return vatPct(rates[country]); }
    return VAT_STD[country] || 22;
  }
  function stockWarn(l, country) {
    if (!l.sku || !erp.catalog) return '';
    var p = catProduct(l.sku);
    if (!p) return 'Not in the current ERP catalogue';
    var s = stockFor(p, country);
    if (s == null) return '';
    if (s <= 0) return 'Out of stock in ' + country;
    if ((+l.qty || 0) > s) return 'Only ' + fmtInt.format(s) + ' available in ' + country;
    return '';
  }
  function catalogHint() {
    return '<p class="hint" style="margin:0">' + (Bus ? 'Open the ERP once to load its product catalogue · <a href="/erp/" target="_blank" rel="noopener">Open ERP</a>' : 'The Adrial Apps bus is not available, so ERP products cannot be loaded.') + '</p>';
  }

  // ── Bus: catalogue, customers, orders, status updates, summary ─────────────
  function busLoad() {
    if (!Bus) return Promise.resolve();
    return Promise.all([Bus.read('erp.catalog'), Bus.read('erp.customers')]).then(function (r) {
      var c = r[0] && r[0].data;
      erp.catalog = c && Array.isArray(c.products) ? c : null; erp.catalogAt = r[0] ? r[0].updatedAt : null; erp.catIndex = null;
      var cu = r[1] && r[1].data;
      erp.customers = cu && Array.isArray(cu.customers) ? cu.customers : null; erp.custIndex = null;
    }, function () { /* bus unavailable */ });
  }
  var busTimer = null;
  function busSyncSoon() { clearTimeout(busTimer); busTimer = setTimeout(busSync, 150); }
  function busSync() {
    if (!Bus || !db) return Promise.resolve();
    return Promise.all([Bus.inbox('crm'), Bus.history(function (m) { return m.type === 'crm.order' && m.from === 'crm'; })]).then(function (r) {
      var changed = false, jobs = [];
      (r[0] || []).forEach(function (m) {
        if (m.type !== 'erp.orderStatus') { jobs.push(Bus.fail(m.id, 'CRM does not handle ' + m.type)); return; }
        var p = m.payload || {}, d = deal(+p.dealId);
        if (!d) { jobs.push(Bus.fail(m.id, 'Deal ' + p.dealId + ' not found in CRM')); return; }
        var f = d.fulfilment || (d.fulfilment = { log: [] }), at = Date.parse(m.createdAt) || Date.now();
        if (p.orderNo) f.orderNo = p.orderNo;
        if (p.status) f.status = p.status;
        if (p.invoiceNo != null) f.invoiceNo = p.invoiceNo;
        if (p.invoiceStatus != null) f.invoiceStatus = p.invoiceStatus;
        if (p.amount != null && isFinite(+p.amount)) f.amount = +p.amount;
        f.updatedAt = at;
        f.log = (f.log || []).concat([{ at: at, status: f.status || '', invoiceNo: f.invoiceNo || '', invoiceStatus: f.invoiceStatus || '' }]).slice(-20);
        if (d.erp && d.erp.status !== 'created' && p.orderNo) { d.erp.status = 'created'; d.erp.orderNo = p.orderNo; d.erp.error = null; }
        d.updatedAt = Math.max(d.updatedAt, at);
        changed = true;
        jobs.push(Bus.done(m.id, { ok: true, dealId: d.id }));
      });
      (r[1] || []).forEach(function (m) {
        var p = m.payload || {}, d = deal(+p.dealId);
        if (!d || !d.erp || d.erp.msgId !== m.id) return;
        var st = m.status === 'done' ? 'created' : m.status === 'failed' ? 'failed' : 'sent';
        var orderNo = (m.result && m.result.orderNo) || d.erp.orderNo || null, err = st === 'failed' ? (m.error || 'Unknown error') : null;
        if (d.erp.status !== st || d.erp.orderNo !== orderNo || d.erp.error !== err) {
          d.erp.status = st; d.erp.orderNo = orderNo; d.erp.error = err;
          d.erp.orderId = (m.result && m.result.orderId) || d.erp.orderId || null;
          d.erp.settledAt = m.settledAt ? Date.parse(m.settledAt) : null;
          changed = true;
        }
      });
      if (changed) commit();
      return Promise.all(jobs);
    }).catch(function () { /* bus unavailable */ });
  }
  if (Bus) Bus.on(function (evt) {
    if (!evt) return;
    if (evt.kind === 'snapshot') {
      if (evt.key === 'erp.catalog' || evt.key === 'erp.customers' || /\.reset$/.test(evt.key || '')) busLoad().then(function () { if (db) refresh(); });
    } else if (evt.kind === 'message') busSyncSoon();
  });
  var pubTimer = null;
  function publishSoon(ms) { if (!Bus) return; clearTimeout(pubTimer); pubTimer = setTimeout(publishSummary, ms == null ? 1500 : ms); }
  function publishSummary() { if (Bus && db) Bus.publish('crm.summary', crmSummary()).catch(function () { /* ignore */ }); }
  function forecastQuarter(deals, q) {
    var wonQ = deals.filter(function (d) { return d.stage === 'won' && d.closedAt >= q.start && d.closedAt <= q.end; });
    var openQ = deals.filter(function (d) { return isOpen(d) && d.expectedClose >= q.start && d.expectedClose <= q.end; });
    return sum(wonQ, dealValue) + sum(openQ, weighted);
  }
  function crmSummary() {
    var today = todayYmd(), q = quarterOf(today), from90 = addDays(today, -89), open = db.deals.filter(isOpen);
    var closed90 = db.deals.filter(function (d) { return !isOpen(d) && d.closedAt >= from90; });
    var won90 = closed90.filter(function (d) { return d.stage === 'won'; }).length;
    return {
      asOf: new Date().toISOString(), currency: 'EUR', quarter: q.label,
      openPipeline: r2(sum(open, dealValue)),
      weightedForecastQuarter: r2(forecastQuarter(db.deals, q)),
      wonByMonth: monthsBack(12).map(function (m) {
        var l = db.deals.filter(function (d) { return d.stage === 'won' && d.closedAt && d.closedAt.slice(0, 7) === m; });
        return { month: m, value: r2(sum(l, dealValue)), count: l.length };
      }),
      winRate90d: closed90.length ? Math.round(won90 / closed90.length * 1000) / 1000 : null,
      byStage: STAGES.map(function (s) {
        var l = db.deals.filter(function (d) { return d.stage === s.id && (s.open || d.closedAt >= from90); });
        return { stage: s.name, count: l.length, value: r2(sum(l, dealValue)) };
      }),
      byOwner: OWNERS.map(function (o) {
        var mineD = db.deals.filter(function (d) { return d.owner === o.id; });
        return {
          owner: o.name, ownerId: o.id,
          won: r2(sum(mineD.filter(function (d) { return d.stage === 'won' && d.closedAt >= q.start && d.closedAt <= q.end; }), dealValue)),
          open: r2(sum(mineD.filter(isOpen), dealValue)),
          target: +db.targets[o.id].quarter || 0, targetMonth: +db.targets[o.id].month || 0
        };
      })
    };
  }

  // ERP customer match (by VAT ID, else by name without legal form)
  function erpCustomerFor(c) {
    if (!erp.customers || !c) return null;
    if (!erp.custIndex) {
      erp.custIndex = { vat: new Map(), name: new Map() };
      erp.customers.forEach(function (x) {
        if (!x) return;
        var v = vatKey(x.vatId);
        if (v) erp.custIndex.vat.set(v, x);
        if (x.name && x.type !== 'B2C') erp.custIndex.name.set(fullNameKey(x.name), x);
      });
    }
    var v = vatKey(c.vat);
    return (v && erp.custIndex.vat.get(v)) || erp.custIndex.name.get(fullNameKey(c.name)) || null;
  }
  function vatKey(v) { return String(v || '').replace(/[\s.\-]/g, '').toUpperCase(); }
  function fullNameKey(n) { return norm(n).replace(/[^a-z0-9]+/g, '').trim(); } // same name incl. legal form, ignoring case/punctuation
  function erpBadge(c) { var x = erpCustomerFor(c); return x ? '<span class="chip good" title="' + esc('Matched to ERP customer ' + x.name + (x.vatId ? ' · ' + x.vatId : '')) + '">ERP customer</span>' : ''; }

  // ERP state on deals
  function erpLines(d) { return d.lines.filter(function (l) { return !!l.sku; }); }
  function dealQuotes(d) { return db.quotes.filter(function (q) { return q.dealId === d.id; }).sort(function (a, b) { return b.createdAt - a.createdAt; }); }
  function acceptedQuote(d) { return dealQuotes(d).filter(function (q) { return q.status === 'Accepted'; })[0] || null; }
  function erpBlocker(d) {
    if (!Bus) return 'The Adrial Apps bus is not available in this browser.';
    if (d.erp && d.erp.status !== 'failed') return 'Already sent to the ERP.';
    if (!(d.stage === 'won' || acceptedQuote(d))) return 'Win the deal or accept a quote first.';
    if (!erpLines(d).length) return 'Add at least one product from the ERP catalogue (services cannot be sent).';
    return '';
  }
  var sending = {};
  function sendToErpDialog(d) {
    var block = erpBlocker(d); if (block) { toast(block); return; }
    var c = company(d.companyId); if (!c) return;
    var lines = erpLines(d), skipped = d.lines.length - lines.length, q = acceptedQuote(d) || dealQuotes(d)[0] || null;
    openModal({
      title: 'Create sales order in ERP', cls: 'wide',
      body: '<p style="margin:0;color:var(--ink2)">The ERP creates a <b>draft</b> sales order for <b>' + esc(c.name) + '</b> (' + esc(c.country) + (c.vat ? ' · ' + esc(c.vat) : '') + ') and adds the customer if it is new.' + (q ? ' Quote ' + esc(q.no) + ' is referenced.' : '') + '</p>' +
        '<div class="tablewrap" style="border:1px solid var(--hair);border-radius:14px"><table class="tbl"><thead><tr><th>SKU</th><th>Product</th><th class="r">Qty</th><th class="r">Unit €</th><th class="r">Disc.</th></tr></thead><tbody>' +
        lines.map(function (l) { return '<tr><td class="mono">' + esc(l.sku) + '</td><td>' + esc(l.name) + (stockWarn(l, c.country) ? '<small class="bad-t">' + esc(stockWarn(l, c.country)) + '</small>' : '') + '</td><td class="r num">' + fmtInt.format(l.qty) + '</td><td class="r num">' + esc(money2(l.price)) + '</td><td class="r num">' + (l.discount ? l.discount + '%' : '—') + '</td></tr>'; }).join('') +
        '</tbody></table></div>' +
        (skipped ? '<p class="hint" style="margin:0">' + skipped + ' service / programme line' + (skipped === 1 ? ' has' : 's have') + ' no SKU and ' + (skipped === 1 ? 'is' : 'are') + ' not sent.</p>' : '') +
        fld('erpNote', 'Note for the ERP order', '<textarea class="in" id="erpNote" rows="2" maxlength="400">' + esc('CRM deal #' + d.id + ' · ' + d.title) + '</textarea>'),
      foot: '<button type="button" class="btn ghost" data-close>Cancel</button><button type="submit" class="btn pri" form="{form}">Send to ERP</button>',
      onSubmit: function (api) {
        if (sending[d.id]) return;
        sending[d.id] = true;
        var note = val(api, 'erpNote');
        var payload = {
          dealId: d.id, dealTitle: d.title, quoteNo: q ? q.no : undefined,
          customer: { name: c.name, country: c.country, vatId: c.vat || undefined, email: c.email || undefined, address: [c.address, ((c.postcode || '') + ' ' + (c.city || '')).trim()].filter(Boolean).join(', ') || undefined },
          lines: lines.map(function (l) { return { sku: l.sku, name: l.name, qty: +l.qty, unitPrice: +l.price, discountPct: +l.discount || 0 }; }),
          note: note || undefined
        };
        api.close(true);
        Bus.send('erp', 'crm.order', payload).then(function (id) {
          sending[d.id] = false;
          if (!id) { toast('Could not write to the Adrial Apps bus in this browser.'); return; }
          var now = Date.now();
          d.erp = { msgId: id, status: 'sent', sentAt: now, lines: lines.length, quoteNo: q ? q.no : null, attempts: ((d.erp && d.erp.attempts) || 0) + 1, orderNo: null, error: null };
          d.updatedAt = now;
          commit(); toast('Sent to ERP · the draft order is created when the ERP processes its inbox');
        }, function () { sending[d.id] = false; toast('Could not write to the Adrial Apps bus in this browser.'); });
      }
    });
  }
  function fulfilLabel(d) {
    var f = d.fulfilment;
    if (f && f.status) {
      if (f.invoiceStatus === 'Paid') return ['Paid', 'green'];
      if (f.invoiceStatus === 'Overdue') return ['Invoice overdue', 'clay'];
      if (f.invoiceStatus === 'Partially paid') return ['Part paid', 'teal'];
      if (f.status === 'Cancelled') return ['Cancelled', 'clay'];
      if (f.status === 'Shipped') return ['Shipped', 'teal'];
      if (f.status === 'Invoiced') return ['Invoiced', 'blue'];
      if (f.status === 'Confirmed') return ['Confirmed', 'blue'];
      return ['Draft order', 'grey'];
    }
    if (d.erp) return d.erp.status === 'failed' ? ['ERP failed', 'clay'] : d.erp.status === 'created' ? ['Order ' + (d.erp.orderNo || 'created'), 'blue'] : ['Sent to ERP', 'grey'];
    return null;
  }
  function fulfilChip(d) { var x = fulfilLabel(d); return x ? '<span class="chip tone tone-' + x[1] + '" title="ERP order status"><span class="d"></span>' + esc(x[0]) + '</span>' : ''; }
  function erpCard(d) {
    var block = erpBlocker(d), e = d.erp, f = d.fulfilment, status = '';
    if (e) {
      if (e.status === 'sent') status = '<div class="banner info">' + icon('upload') + '<span><b>Sent</b> ' + esc(fmtStamp(e.sentAt)) + ' · waiting for the ERP. The draft order is created as soon as the ERP is open in this browser.</span></div>';
      else if (e.status === 'created') status = '<div class="banner good">' + icon('check') + '<span><b>Created ' + esc(e.orderNo || 'sales order') + '</b> in the ERP' + (e.settledAt ? ' · ' + esc(fmtStamp(e.settledAt)) : '') + '.</span></div>';
      else status = '<div class="banner bad">' + icon('close') + '<span><b>Failed:</b> ' + esc(e.error || 'unknown reason') + '</span></div>';
    }
    var fl = '';
    if (f && (f.orderNo || f.status)) {
      fl = '<div class="kv" style="padding:4px 20px 12px">' +
        '<div><span class="k">Order</span><p class="mono">' + esc(f.orderNo || '—') + '</p></div>' +
        '<div><span class="k">Order status</span><p>' + esc(f.status || '—') + '</p></div>' +
        '<div><span class="k">Invoice</span><p class="mono">' + esc(f.invoiceNo || '—') + '</p></div>' +
        '<div><span class="k">Invoice status</span><p class="' + (f.invoiceStatus === 'Overdue' ? 'bad-t' : f.invoiceStatus === 'Paid' ? 'good-t' : '') + '">' + esc(f.invoiceStatus || '—') + '</p></div>' +
        '<div><span class="k">Amount</span><p class="num">' + (f.amount != null ? esc(money2(f.amount)) : '—') + '</p></div>' +
        '<div><span class="k">Last update</span><p>' + esc(fmtStamp(f.updatedAt)) + '</p></div></div>' +
        (f.log && f.log.length > 1 ? '<details class="card-b"><summary class="hint" style="cursor:pointer">Status history (' + f.log.length + ')</summary><ul class="rows">' + f.log.slice().reverse().map(function (x) { return '<li><div class="main"><span class="t">' + esc(x.status || '—') + (x.invoiceStatus ? ' · ' + esc(x.invoiceStatus) : '') + '</span><div class="meta">' + esc(fmtStamp(x.at)) + (x.invoiceNo ? ' · ' + esc(x.invoiceNo) : '') + '</div></div></li>'; }).join('') + '</ul></details>' : '');
    }
    var canSend = !block;
    return '<section class="card" aria-labelledby="hErp"><div class="card-h"><div><span class="label">ERP · ' + erpLines(d).length + ' catalogue line' + (erpLines(d).length === 1 ? '' : 's') + '</span><h2 id="hErp">Order &amp; fulfilment</h2></div>' +
      (canSend ? btn(e && e.status === 'failed' ? 'Send again' : 'Create sales order in ERP', 'erp-send', { id: d.id }, 'sm pri', 'upload') : '') + '</div>' +
      status + (!e && block ? '<p class="hint" style="margin:0 20px 14px">' + esc(block) + '</p>' : '') +
      (fl || (e && e.status === 'created' ? '<p class="hint" style="margin:0 20px 14px">Status updates from the ERP (shipping, invoicing, payment) appear here.</p>' : '')) +
      (Bus ? '<div class="card-b" style="padding-top:0"><a class="btn sm ghost" href="/erp/" target="_blank" rel="noopener">Open ERP ↗</a></div>' : '') + '</section>';
  }

  // ── Quotes ──────────────────────────────────────────────────────────────────
  var QUOTE_TONE = { Draft: 'grey', Sent: 'blue', Accepted: 'green', Declined: 'clay', Expired: 'clay' };
  function quoteStatus(q) { return (q.status === 'Draft' || q.status === 'Sent') && q.validUntil < todayYmd() ? 'Expired' : q.status; }
  function quoteChip(q) { var s = quoteStatus(q); return '<span class="chip tone tone-' + QUOTE_TONE[s] + '"><span class="d"></span>' + esc(s) + '</span>'; }
  function quoteTotals(q) {
    var net = 0, vat = 0;
    q.lines.forEach(function (l) { var t = lineTotal(l); net += t; vat += t * (+l.vat || 0) / 100; });
    net = r2(net); vat = r2(vat);
    return { net: net, vat: vat, gross: r2(net + vat) };
  }
  function nextQuoteNo() {
    var y = new Date().getFullYear(), n = (db.seq.quoteYear[y] || 0) + 1;
    db.seq.quoteYear[y] = n;
    return 'Q-' + y + '-' + String(n).padStart(4, '0');
  }
  var DEFAULT_TERMS = 'Prices in EUR, VAT shown separately. Payment 30 days net from invoice date. Delivery 5–10 working days after order confirmation. This quote is a demo and not a binding offer.';
  function quoteForm(d) {
    var c = company(d.companyId); if (!c) return;
    if (!d.lines.length) { toast('Add line items first.'); return; }
    openModal({
      title: 'New quote', cls: 'wide',
      body: '<p style="margin:0;color:var(--ink2)">' + esc(d.title) + ' · ' + esc(c.name) + ' · ' + d.lines.length + ' line' + (d.lines.length === 1 ? '' : 's') + ' · ' + esc(money2(dealValue(d))) + ' excl. VAT</p>' +
        '<div class="row2">' + fld('qValid', 'Valid until', inp('qValid', addDays(todayYmd(), 30), 'type="date" required autofocus'), { req: true }) +
        fld('qContact', 'Addressed to', sel('qContact', contactOpts(c.id, '— Company only —'), d.contactId || '')) + '</div>' +
        fld('qTerms', 'Terms', '<textarea class="in" id="qTerms" rows="3" maxlength="1500">' + esc(DEFAULT_TERMS) + '</textarea>') +
        fld('qNote', 'Note to the customer (optional)', '<textarea class="in" id="qNote" rows="2" maxlength="800"></textarea>'),
      foot: '<button type="button" class="btn ghost" data-close>Cancel</button><button type="submit" class="btn pri" form="{form}">Create quote</button>',
      onSubmit: function (api) {
        var vu = val(api, 'qValid');
        if (!validYmd(vu)) return formError(api, 'Enter a valid date.', 'qValid');
        if (vu < todayYmd()) return formError(api, 'The validity date cannot be in the past.', 'qValid');
        var now = Date.now();
        var q = {
          id: ++db.seq.quote, no: nextQuoteNo(), dealId: d.id, createdAt: now, validUntil: vu, country: c.country,
          contactId: val(api, 'qContact') ? +val(api, 'qContact') : null, terms: val(api, 'qTerms'), note: val(api, 'qNote'), status: 'Draft',
          lines: d.lines.map(function (l) { return { code: lineCode(l), name: lineLabel(l), unit: lineUnit(l), sku: l.sku || null, qty: +l.qty, price: +l.price, discount: +l.discount || 0, vat: lineVat(l, c.country) }; }),
          history: [{ at: now, status: 'Draft', by: actor(d.owner) }]
        };
        db.quotes.push(q); d.updatedAt = now;
        api.close(true); save(); updateNav(); toast('Quote ' + q.no + ' created');
        location.hash = '#/quotes/' + q.id;
      }
    });
  }
  function setQuoteStatus(q, st) {
    var cur = quoteStatus(q), d = deal(q.dealId), now = Date.now();
    if (st === cur) return;
    if ((st === 'Accepted' || st === 'Sent') && cur === 'Expired') { toast('This quote has expired. Create a new one.'); return; }
    q.status = st; q.history = (q.history || []).concat([{ at: now, status: st, by: actor(d ? d.owner : null) }]);
    if (d) d.updatedAt = now;
    if (st === 'Accepted' && d && d.stage !== 'won') { applyMove(d, 'won', null); toast('Quote ' + q.no + ' accepted · deal won'); return; }
    commit(); toast('Quote ' + q.no + ' · ' + st);
  }
  function quotesCard(d) {
    var qs = dealQuotes(d);
    return '<section class="card" aria-labelledby="hQuotes"><div class="card-h"><div><span class="label">' + qs.length + ' quote' + (qs.length === 1 ? '' : 's') + '</span><h2 id="hQuotes">Quotes</h2></div>' + btn('New quote', 'quote-new', { id: d.id }, 'sm', 'plus') + '</div>' +
      (qs.length ? '<ul class="rows">' + qs.map(function (q) {
        var t = quoteTotals(q), s = quoteStatus(q);
        return '<li><div class="main"><a href="#/quotes/' + q.id + '">' + esc(q.no) + '</a><div class="meta"><span>' + esc(fmtDate(ymd(q.createdAt))) + '</span><span>valid until ' + esc(fmtDate(q.validUntil)) + '</span><span class="num">' + esc(money2(t.gross)) + ' incl. VAT</span></div></div>' +
          '<div class="end">' + quoteChip(q) + quoteActions(q, s, true) + '</div></li>';
      }).join('') + '</ul>' : '<div class="card-b"><div class="empty box">No quotes yet. A quote is created from the deal’s line items.</div></div>') + '</section>';
  }
  function quoteActions(q, s, small) {
    var c = small ? 'sm' : '';
    var out = '';
    if (s === 'Draft') out += btn('Mark sent', 'quote-status', { id: q.id, st: 'Sent' }, c);
    if (s === 'Draft' || s === 'Sent') out += btn('Accept', 'quote-status', { id: q.id, st: 'Accepted' }, c + ' pri') + btn('Decline', 'quote-status', { id: q.id, st: 'Declined' }, c + ' ghost');
    return out;
  }
  function viewQuote(id) {
    var q = db.quotes.find(function (x) { return x.id === id; });
    if (!q) return viewMissing('Quote not found', 'It may have been deleted together with its deal.');
    var d = deal(q.dealId), c = d ? company(d.companyId) : null, ct = contact(q.contactId), t = quoteTotals(q), s = quoteStatus(q), owner = d ? OWNER[d.owner] : null;
    var vatGroups = {};
    q.lines.forEach(function (l) { var k = String(+l.vat || 0); vatGroups[k] = (vatGroups[k] || 0) + lineTotal(l) * (+l.vat || 0) / 100; });
    return '<div class="noprint">' + head({
      crumb: d ? d.title : 'Deals', crumbHref: d ? '#/deals/' + d.id : '#/deals', title: 'Quote ' + q.no,
      sub: quoteChip(q) + '<span>' + esc(money2(t.gross)) + ' incl. VAT</span>',
      actions: quoteActions(q, s, false) + '<button type="button" class="btn" data-act="print">' + icon('download') + 'Print / PDF</button>'
    }) + '</div>' +
      '<article class="card quote-doc" aria-label="Quote document">' +
      '<header class="qd-head"><div><div class="qd-brand">' + esc(SELLER.name) + '</div>' + SELLER.lines.map(function (l) { return '<div class="qd-small">' + esc(l) + '</div>'; }).join('') + '</div>' +
      '<div class="qd-meta"><div class="qd-title">Quote</div><div class="mono">' + esc(q.no) + '</div><div class="qd-small">Date ' + esc(fmtDateFull(ymd(q.createdAt))) + '</div><div class="qd-small">Valid until ' + esc(fmtDateFull(q.validUntil)) + '</div><div class="qd-small">Status ' + esc(s) + '</div></div></header>' +
      '<section class="qd-to"><span class="label">Prepared for</span><div class="qd-cust">' + esc(c ? c.name : 'Unknown customer') + '</div>' +
      (c ? '<div class="qd-small">' + esc([c.address, ((c.postcode || '') + ' ' + (c.city || '')).trim(), c.country === 'SI' ? 'Slovenia' : 'Croatia'].filter(Boolean).join(', ')) + '</div>' + (c.vat ? '<div class="qd-small">VAT ID ' + esc(c.vat) + '</div>' : '') : '') +
      (ct ? '<div class="qd-small">Attn. ' + esc(personName(ct)) + (ct.email ? ' · ' + esc(ct.email) : '') + '</div>' : '') + '</section>' +
      (d ? '<p class="qd-small" style="margin:0 0 10px">Re: ' + esc(d.title) + '</p>' : '') +
      '<div class="tablewrap"><table class="tbl qd-tbl"><thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Unit price</th><th class="r">Disc.</th><th class="r">VAT</th><th class="r">Net</th></tr></thead><tbody>' +
      q.lines.map(function (l) { return '<tr><td>' + esc(l.name) + '<small class="mono">' + esc(l.code || '') + '</small></td><td class="r num">' + fmtInt.format(l.qty) + ' ' + esc(l.unit || '') + '</td><td class="r num">' + esc(money2(l.price)) + '</td><td class="r num">' + (l.discount ? l.discount + '%' : '—') + '</td><td class="r num">' + vatPct(l.vat) + '%</td><td class="r num">' + esc(money2(lineTotal(l))) + '</td></tr>'; }).join('') +
      '</tbody></table></div>' +
      '<div class="qd-totals"><div><span>Net</span><b class="num">' + esc(money2(t.net)) + '</b></div>' +
      Object.keys(vatGroups).map(function (k) { return '<div><span>VAT ' + k + '%</span><b class="num">' + esc(money2(vatGroups[k])) + '</b></div>'; }).join('') +
      '<div class="qd-grand"><span>Total EUR</span><b class="num">' + esc(money2(t.gross)) + '</b></div></div>' +
      (q.note ? '<section class="qd-sec"><span class="label">Note</span><p>' + esc(q.note) + '</p></section>' : '') +
      '<section class="qd-sec"><span class="label">Terms</span><p>' + esc(q.terms || '') + '</p></section>' +
      '<footer class="qd-foot"><div>' + esc(owner ? owner.name : '') + '<br><span class="qd-small">' + esc(owner ? owner.role : '') + ' · ' + esc(SELLER.name) + '</span></div><div class="qd-sign">Accepted by the customer (date, signature)</div></footer>' +
      '</article>';
  }

  // ── Targets ─────────────────────────────────────────────────────────────────
  function periodOf(kind) {
    var t = todayYmd();
    if (kind === 'month') return { start: t.slice(0, 8) + '01', end: ymd(new Date(+t.slice(0, 4), +t.slice(5, 7), 0).getTime()), label: MON[+t.slice(5, 7) - 1] + ' ' + t.slice(0, 4) };
    return quarterOf(t);
  }
  function wonIn(owner, r) { return sum(db.deals.filter(function (d) { return d.stage === 'won' && d.closedAt >= r.start && d.closedAt <= r.end && (owner === 'all' || d.owner === owner); }), dealValue); }
  function targetOf(owner, kind) { return owner === 'all' ? sum(OWNERS, function (o) { return +db.targets[o.id][kind] || 0; }) : +((db.targets[owner] || {})[kind]) || 0; }
  function elapsedOf(r) { var total = daysBetween(r.start, r.end) + 1, done = daysBetween(r.start, todayYmd()) + 1; return Math.min(1, Math.max(0, done / total)); }
  function targetBar(label, won, target, pace, id) {
    var pct = target > 0 ? won / target : 0, ahead = pct >= pace, p100 = Math.round(pct * 100);
    return '<div class="tgt"><div class="tgt-h"><span id="' + id + '">' + esc(label) + '</span><span class="num">' + esc(money(won)) + ' <span class="muted">of ' + (target ? esc(money(target)) : 'no target') + '</span></span></div>' +
      '<div class="tgt-bar" role="progressbar" aria-labelledby="' + id + '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.min(100, p100) + '" aria-valuetext="' + esc(p100 + '% of target, ' + Math.round(pace * 100) + '% of the period elapsed') + '">' +
      '<i style="width:' + Math.min(100, pct * 100).toFixed(1) + '%"></i><b style="left:' + (pace * 100).toFixed(1) + '%" title="Expected pace today"></b></div>' +
      '<div class="tgt-f"><span>' + p100 + '% of target</span>' + (target ? '<span class="' + (ahead ? 'good-t' : 'bad-t') + '">' + (ahead ? 'Ahead of' : 'Behind') + ' pace · ' + Math.round(pace * 100) + '% of period gone</span>' : '') + '</div></div>';
  }
  function homeTargetsCard() {
    var m = periodOf('month'), q = periodOf('quarter'), who = ui.me;
    var body = targetBar(m.label + (who === 'all' ? ' · team' : ''), wonIn(who, m), targetOf(who, 'month'), elapsedOf(m), 'tgM') +
      targetBar(q.label + (who === 'all' ? ' · team' : ''), wonIn(who, q), targetOf(who, 'quarter'), elapsedOf(q), 'tgQ');
    if (who === 'all') body += '<div class="tgt-reps">' + OWNERS.map(function (o) {
      var won = wonIn(o.id, q), tg = targetOf(o.id, 'quarter'), pct = tg ? won / tg : 0;
      return '<div class="tgt-rep">' + ownerAv(o.id) + '<span class="nm">' + esc(o.name.split(' ')[0]) + '</span><span class="mini" role="img" aria-label="' + esc(o.name + ': ' + Math.round(pct * 100) + '% of quarterly target') + '"><i style="width:' + Math.min(100, pct * 100).toFixed(1) + '%"></i></span><span class="num small" style="display:inline">' + Math.round(pct * 100) + '%</span></div>';
    }).join('') + '</div>';
    return '<section class="card" aria-labelledby="hTgt"><div class="card-h"><div><span class="label">Won vs target · ' + esc(scopeLabel()) + '</span><h2 id="hTgt">Targets</h2></div><a class="btn sm" href="#/team">Edit targets</a></div><div class="card-b">' + body + '</div></section>';
  }
  function viewTeam() {
    var m = periodOf('month'), q = periodOf('quarter');
    return head({ eyebrow: 'Owners', title: 'Sales team', sub: '<span>Targets, progress and pace per rep. Pick a person to filter the whole CRM to their work (same as <b>My view</b>).</span>' }) +
      '<section class="card" style="margin-bottom:16px"><div class="owners">' + OWNERS.map(function (o) {
        var deals = db.deals.filter(function (d) { return d.owner === o.id; }), open = deals.filter(isOpen);
        var od = db.activities.filter(function (a) { return a.owner === o.id && actState(a) === 'overdue'; }).length;
        var cos = db.companies.filter(function (c) { return c.owner === o.id; }).length;
        return '<div class="owner" style="flex-direction:column;align-items:stretch"><div style="display:flex;gap:12px;align-items:center">' + ownerAv(o.id, true) + '<div style="flex:1;min-width:0"><b>' + esc(o.name) + '</b><small>' + esc(o.role) + '</small></div>' +
          '<button type="button" class="btn sm" data-act="set-me" data-id="' + o.id + '" aria-pressed="' + (ui.me === o.id) + '">' + (ui.me === o.id ? 'Current view' : 'View as') + '</button></div>' +
          '<div class="small num">' + open.length + ' open · ' + esc(money(sum(open, dealValue))) + ' · ' + cos + ' companies' + (od ? ' · <span class="bad-t">' + od + ' overdue</span>' : '') + '</div>' +
          targetBar(m.label, wonIn(o.id, m), targetOf(o.id, 'month'), elapsedOf(m), 'tm-' + o.id) + targetBar(q.label, wonIn(o.id, q), targetOf(o.id, 'quarter'), elapsedOf(q), 'tq-' + o.id) + '</div>';
      }).join('') + '</div>' + (ui.me !== 'all' ? '<div class="more">' + btn('Show all owners', 'set-me', { id: 'all' }, 'sm') + '</div>' : '') + '</section>' +
      '<section class="card" aria-labelledby="hTgEdit"><div class="card-h"><div><span class="label">Revenue from won deals, EUR</span><h2 id="hTgEdit">Edit targets</h2></div></div>' +
      '<form id="tgForm" class="card-b" novalidate><div class="tablewrap"><table class="tbl"><thead><tr><th>Rep</th><th class="r">Monthly target</th><th class="r">Quarterly target</th></tr></thead><tbody>' +
      OWNERS.map(function (o) {
        return '<tr><td>' + ownerChip(o.id) + '</td>' +
          '<td class="r"><label class="sr" for="tg-m-' + o.id + '">Monthly target for ' + esc(o.name) + '</label><input class="in tg-in" type="number" min="0" step="1000" inputmode="numeric" id="tg-m-' + o.id + '" value="' + esc(db.targets[o.id].month) + '"></td>' +
          '<td class="r"><label class="sr" for="tg-q-' + o.id + '">Quarterly target for ' + esc(o.name) + '</label><input class="in tg-in" type="number" min="0" step="1000" inputmode="numeric" id="tg-q-' + o.id + '" value="' + esc(db.targets[o.id].quarter) + '"></td></tr>';
      }).join('') + '</tbody><tfoot><tr><td>Team</td><td class="r num">' + esc(money(targetOf('all', 'month'))) + '</td><td class="r num">' + esc(money(targetOf('all', 'quarter'))) + '</td></tr></tfoot></table></div>' +
      '<div class="actions" style="justify-content:flex-end;margin-top:12px"><button type="button" class="btn ghost" data-act="tg-fill">Quarter = 3 × month</button><button type="button" class="btn pri" data-act="tg-save">Save targets</button></div></form></section>';
  }
  function saveTargets() {
    var next = {}, bad = null;
    OWNERS.forEach(function (o) {
      ['m', 'q'].forEach(function (k) {
        var el = $('#tg-' + k + '-' + o.id), v = el ? el.value.trim() : '';
        if (el) el.removeAttribute('aria-invalid');
        if (!/^\d+(\.\d+)?$/.test(v)) { if (!bad) bad = el; if (el) el.setAttribute('aria-invalid', 'true'); return; }
        next[o.id] = next[o.id] || {};
        next[o.id][k === 'm' ? 'month' : 'quarter'] = Math.round(+v);
      });
    });
    if (bad) { toast('Targets must be numbers of 0 or more.'); bad.focus(); return; }
    db.targets = next; commit(); toast('Targets saved');
  }

  // ── Lead scoring ────────────────────────────────────────────────────────────
  var scoreCache = null;
  function scoreIdx() {
    if (scoreCache) return scoreCache;
    var now = Date.now(), y1 = addDays(todayYmd(), -365);
    var x = { dLast: {}, dCnt60: {}, dNext: {}, dOver: {}, cLast: {}, cCnt90: {}, cWon12: {}, cOpen: {}, cBest: {} };
    db.activities.forEach(function (a) {
      if (a.done) {
        var at = a.doneAt || actMs(a);
        if (a.dealId != null) { x.dLast[a.dealId] = Math.max(x.dLast[a.dealId] || 0, at); if (now - at <= 60 * DAY) x.dCnt60[a.dealId] = (x.dCnt60[a.dealId] || 0) + 1; }
        if (a.companyId != null) { x.cLast[a.companyId] = Math.max(x.cLast[a.companyId] || 0, at); if (now - at <= 90 * DAY) x.cCnt90[a.companyId] = (x.cCnt90[a.companyId] || 0) + 1; }
      } else if (a.dealId != null) { if (actState(a) === 'overdue') x.dOver[a.dealId] = true; else x.dNext[a.dealId] = true; }
    });
    db.deals.forEach(function (d) {
      if (d.stage === 'won' && d.closedAt >= y1) x.cWon12[d.companyId] = true;
      if (isOpen(d)) { x.cOpen[d.companyId] = (x.cOpen[d.companyId] || 0) + dealValue(d); x.cBest[d.companyId] = Math.max(x.cBest[d.companyId] == null ? -1 : x.cBest[d.companyId], STAGE[d.stage].idx); }
    });
    scoreCache = x;
    return x;
  }
  function daysAgo(ms) { return ms ? (Date.now() - ms) / DAY : Infinity; }
  function finishScore(r) { return { score: Math.max(0, Math.min(100, Math.round(sum(r, function (z) { return z.pts; })))), reasons: r }; }
  function dealScore(d) {
    if (!d || !isOpen(d)) return null;
    var x = scoreIdx(), r = [], c = company(d.companyId);
    function add(label, pts) { if (pts) r.push({ label: label, pts: pts }); }
    add('Stage ' + STAGE[d.stage].name, { lead: 5, qualified: 15, proposal: 25, negotiation: 35 }[d.stage]);
    var v = dealValue(d); add('Deal size ' + moneyK(v), v >= 20000 ? 20 : v >= 8000 ? 12 : v >= 3000 ? 6 : 2);
    var la = daysAgo(x.dLast[d.id]);
    add(la <= 7 ? 'Activity in the last 7 days' : la <= 14 ? 'Activity in the last 14 days' : la <= 30 ? 'Activity in the last 30 days' : 'No activity for 30+ days', la <= 7 ? 20 : la <= 14 ? 12 : la <= 30 ? 6 : -5);
    var n = x.dCnt60[d.id] || 0; if (n) add(n + ' completed activit' + (n === 1 ? 'y' : 'ies') + ' in 60 days', n >= 4 ? 10 : n >= 2 ? 6 : 3);
    if (x.dNext[d.id]) add('Next step planned', 5);
    if (x.dOver[d.id]) add('Overdue follow-up', -5);
    var ds = daysInStage(d); if (ds > 45) add(ds + ' days in the same stage', -15); else if (ds > 21) add(ds + ' days in the same stage', -8);
    if (closeOverdue(d)) add('Past the expected close date', -10);
    if (c) add('Segment ' + c.segment, { Corporate: 5, Clinic: 5, Reseller: 3 }[c.segment] || 0);
    return finishScore(r);
  }
  function companyScore(c) {
    if (!c) return null;
    var x = scoreIdx(), r = [];
    function add(label, pts) { if (pts) r.push({ label: label, pts: pts }); }
    add('Segment ' + c.segment, { Corporate: 15, Clinic: 15, Reseller: 10, Optician: 8, Partner: 6 }[c.segment] || 0);
    var la = daysAgo(x.cLast[c.id]);
    add(la <= 7 ? 'Activity in the last 7 days' : la <= 30 ? 'Activity in the last 30 days' : la <= 90 ? 'Activity in the last 90 days' : 'No activity for 90+ days', la <= 7 ? 25 : la <= 30 ? 15 : la <= 90 ? 6 : -5);
    var ov = x.cOpen[c.id] || 0; if (ov) add('Open pipeline ' + moneyK(ov), ov >= 30000 ? 25 : ov >= 10000 ? 15 : 8);
    var n = x.cCnt90[c.id] || 0; if (n) add(n + ' completed activit' + (n === 1 ? 'y' : 'ies') + ' in 90 days', n >= 8 ? 15 : n >= 4 ? 10 : 5);
    if (x.cWon12[c.id]) add('Won a deal in the last 12 months', 10);
    var best = x.cBest[c.id]; if (best === 3) add('A deal in Negotiation', 10); else if (best === 2) add('A deal in Proposal', 6);
    return finishScore(r);
  }
  function scoreTier(s) { return s >= 70 ? 'hot' : s >= 45 ? 'warm' : 'cold'; }
  function scoreBadge(sc) {
    if (!sc) return '<span class="muted">—</span>';
    var t = scoreTier(sc.score), why = sc.reasons.map(function (z) { return (z.pts > 0 ? '+' : '') + z.pts + '  ' + z.label; }).join('\n');
    return '<span class="score ' + t + '" title="' + esc('Lead score ' + sc.score + '/100 (' + t + ')\n' + why) + '" aria-label="' + esc('Lead score ' + sc.score + ' of 100, ' + t) + '">' + sc.score + '</span>';
  }
  function scoreWhyCard(sc, what) {
    if (!sc) return '';
    return '<section class="card" aria-labelledby="hScore"><div class="card-h"><div><span class="label">' + esc(what) + ' · ' + scoreTier(sc.score) + '</span><h2 id="hScore">Lead score</h2></div>' + scoreBadge(sc) + '</div>' +
      '<ul class="rows why">' + sc.reasons.map(function (z) { return '<li><div class="main"><span class="t" style="font-weight:400">' + esc(z.label) + '</span></div><div class="end"><span class="num ' + (z.pts > 0 ? 'good-t' : 'bad-t') + '">' + (z.pts > 0 ? '+' : '−') + Math.abs(z.pts) + '</span></div></li>'; }).join('') + '</ul>' +
      '<p class="hint" style="margin:0;padding:6px 20px 16px">Rules: stage, deal size, recent and repeated activity, planned next steps, time in stage, close date and segment. Clamped to 0–100.</p></section>';
  }
  function hotLeadsCard() {
    var list = db.deals.filter(function (d) { return mine(d) && isOpen(d); }).map(function (d) { return { d: d, s: dealScore(d) }; })
      .sort(function (a, b) { return b.s.score - a.s.score || dealValue(b.d) - dealValue(a.d); }).slice(0, 6);
    return '<section class="card" aria-labelledby="hHot"><div class="card-h"><div><span class="label">Highest lead score</span><h2 id="hHot">Hot leads</h2></div><a class="btn sm" href="#/deals/list" data-act="goto-deals" data-sort="score">All by score</a></div>' +
      (list.length ? '<ul class="rows">' + list.map(function (x) {
        var c = company(x.d.companyId), top = x.s.reasons.filter(function (z) { return z.pts > 0; }).sort(function (a, b) { return b.pts - a.pts; }).slice(0, 2).map(function (z) { return z.label; }).join(' · ');
        return '<li>' + scoreBadge(x.s) + '<div class="main"><a href="#/deals/' + x.d.id + '">' + esc(x.d.title) + '</a><div class="meta"><span>' + esc(c ? c.name : '') + '</span><span>' + esc(top) + '</span></div></div><div class="end">' + stageChip(x.d.stage) + '<span class="num">' + esc(moneyK(dealValue(x.d))) + '</span></div></li>';
      }).join('') + '</ul>' : '<div class="card-b"><div class="empty box">No open deals.</div></div>') + '</section>';
  }

  // ── Duplicates & merge ───────────────────────────────────────────────────────
  function coreName(n) {
    var s = ' ' + norm(n).replace(/[,;]/g, ' ') + ' ';
    s = s.replace(/\s(j\.?\s?d\.?\s?o\.?\s?o|d\.?\s?o\.?\s?o|d\.?\s?d|s\.?\s?p)\.?(?=\s)/g, ' ');
    return s.replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function lev(a, b) {
    if (a === b) return 0;
    var m = a.length, n = b.length, prev = [], cur = [], i, j;
    for (j = 0; j <= n; j++) prev[j] = j;
    for (i = 1; i <= m; i++) {
      cur = [i];
      for (j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[n];
  }
  function similar(a, b) { if (!a || !b) return 0; if (Math.abs(a.length - b.length) > 3) return 0; return 1 - lev(a, b) / Math.max(a.length, b.length); }
  function pairKey(kind, a, b) { return kind + ':' + Math.min(a, b) + ':' + Math.max(a, b); }
  var dupCache = null;
  function findDuplicates() {
    if (dupCache) return dupCache;
    var ign = new Set(db.dupIgnore), out = { companies: [], contacts: [] };
    var cs = db.companies.map(function (c) { return { c: c, k: coreName(c.name), v: vatKey(c.vat) }; });
    for (var i = 0; i < cs.length; i++) for (var j = i + 1; j < cs.length; j++) {
      var a = cs[i], b = cs[j], why = [];
      if (a.v && b.v && a.v !== b.v && fullNameKey(a.c.name) !== fullNameKey(b.c.name)) continue; // two different VAT IDs = two legal entities
      if (a.v && a.v === b.v) why.push('Same VAT ID');
      if (a.k && a.k === b.k) why.push('Same name (ignoring legal form)');
      else if (a.c.country === b.c.country && similar(a.k, b.k) >= 0.88) why.push('Very similar name');
      if (why.length && !ign.has(pairKey('co', a.c.id, b.c.id))) out.companies.push({ a: a.c, b: b.c, why: why });
    }
    var ps = db.contacts.map(function (x) { return { x: x, e: String(x.email || '').toLowerCase(), n: norm(personName(x)).replace(/[^a-z0-9]+/g, ' ').trim() }; });
    for (i = 0; i < ps.length; i++) for (j = i + 1; j < ps.length; j++) {
      var p = ps[i], q = ps[j], w = [];
      if (p.e && p.e === q.e) w.push('Same email');
      var sameCo = p.x.companyId != null && p.x.companyId === q.x.companyId;
      if (p.n && p.n === q.n && (sameCo || p.x.companyId == null || q.x.companyId == null)) w.push(sameCo ? 'Same name at the same company' : 'Same name');
      else if (sameCo && similar(p.n, q.n) >= 0.9) w.push('Similar name at the same company');
      if (w.length && !ign.has(pairKey('ct', p.x.id, q.x.id))) out.contacts.push({ a: p.x, b: q.x, why: w });
    }
    dupCache = out;
    return out;
  }
  var CO_FIELDS = [['name', 'Name'], ['segment', 'Segment'], ['country', 'Country'], ['city', 'City'], ['postcode', 'Postcode'], ['address', 'Address'], ['phone', 'Phone'], ['email', 'Email'], ['website', 'Website'], ['vat', 'VAT ID'], ['employees', 'Employees'], ['source', 'Source'], ['owner', 'Owner']];
  var CT_FIELDS = [['firstName', 'First name'], ['lastName', 'Last name'], ['title', 'Job title'], ['email', 'Email'], ['phone', 'Phone'], ['companyId', 'Company'], ['owner', 'Owner']];
  function fieldText(kind, k, v) {
    if (v == null || v === '') return '';
    if (k === 'owner') return ownerName(v);
    if (k === 'companyId') { var c = company(v); return c ? c.name : ''; }
    return String(v);
  }
  function relCounts(kind, rec) {
    function n(c, one, many) { return c + ' ' + (c === 1 ? one : many); }
    if (kind === 'co') return [n(db.contacts.filter(function (x) { return x.companyId === rec.id; }).length, 'contact', 'contacts'), n(db.deals.filter(function (x) { return x.companyId === rec.id; }).length, 'deal', 'deals'), n(db.activities.filter(function (x) { return x.companyId === rec.id; }).length, 'activity', 'activities')].join(' · ');
    return [n(db.deals.filter(function (x) { return x.contactId === rec.id; }).length, 'deal', 'deals'), n(db.activities.filter(function (x) { return x.contactId === rec.id; }).length, 'activity', 'activities')].join(' · ');
  }
  function viewDuplicates() {
    var dup = findDuplicates();
    function pairRow(kind, p, i) {
      var la = kind === 'co' ? p.a.name : personName(p.a), lb = kind === 'co' ? p.b.name : personName(p.b);
      var href = kind === 'co' ? '#/companies/' : '#/contacts/';
      var sub = function (r) { return kind === 'co' ? r.city + ', ' + r.country + (r.vat ? ' · ' + r.vat : '') : [r.email, (company(r.companyId) || {}).name].filter(Boolean).join(' · '); };
      return '<li class="dup"><div class="main"><div class="duo"><div><a href="' + href + p.a.id + '">' + esc(la) + '</a><div class="meta"><span>' + esc(sub(p.a)) + '</span><span>' + esc(relCounts(kind, p.a)) + '</span></div></div>' +
        '<div><a href="' + href + p.b.id + '">' + esc(lb) + '</a><div class="meta"><span>' + esc(sub(p.b)) + '</span><span>' + esc(relCounts(kind, p.b)) + '</span></div></div></div>' +
        '<div class="meta">' + p.why.map(function (w) { return '<span class="chip">' + esc(w) + '</span>'; }).join('') + '</div></div>' +
        '<div class="end">' + btn('Not a duplicate', 'dup-ignore', { kind: kind, a: p.a.id, b: p.b.id }, 'sm ghost') + btn('Review & merge', 'dup-merge', { kind: kind, a: p.a.id, b: p.b.id }, 'sm pri') + '</div></li>';
    }
    return head({ eyebrow: 'Data quality', title: 'Duplicates', sub: '<b>' + dup.companies.length + '</b> possible duplicate compan' + (dup.companies.length === 1 ? 'y' : 'ies') + ' · <b>' + dup.contacts.length + '</b> possible duplicate contact' + (dup.contacts.length === 1 ? '' : 's') + (db.dupIgnore.length ? ' · ' + db.dupIgnore.length + ' dismissed' : ''), actions: db.dupIgnore.length ? btn('Show dismissed again', 'dup-unignore', {}, 'ghost') : '' }) +
      '<section class="card" style="margin-bottom:16px" aria-labelledby="hDupCo"><div class="card-h"><div><span class="label">Same VAT ID or (nearly) the same name</span><h2 id="hDupCo">Companies</h2></div></div>' +
      (dup.companies.length ? '<ul class="rows">' + dup.companies.map(function (p, i) { return pairRow('co', p, i); }).join('') + '</ul>' : '<div class="card-b"><div class="empty box">No likely duplicate companies.</div></div>') + '</section>' +
      '<section class="card" aria-labelledby="hDupCt"><div class="card-h"><div><span class="label">Same email, or the same / similar name at one company</span><h2 id="hDupCt">Contacts</h2></div></div>' +
      (dup.contacts.length ? '<ul class="rows">' + dup.contacts.map(function (p, i) { return pairRow('ct', p, i); }).join('') + '</ul>' : '<div class="card-b"><div class="empty box">No likely duplicate contacts.</div></div>') + '</section>';
  }
  function mergeDialog(kind, a, b) {
    if (!a || !b) return;
    var fields = kind === 'co' ? CO_FIELDS : CT_FIELDS, title = kind === 'co' ? 'Merge companies' : 'Merge contacts';
    var nameOf = function (r) { return kind === 'co' ? r.name : personName(r); };
    var rows = fields.map(function (f) {
      var k = f[0], va = a[k], vb = b[k], ta = fieldText(kind, k, va), tb = fieldText(kind, k, vb), pickB = !ta && !!tb;
      if (ta === tb) return '<tr><th scope="row">' + esc(f[1]) + '</th><td colspan="2">' + (ta ? esc(ta) : '<span class="muted">—</span>') + '</td></tr>';
      return '<tr><th scope="row">' + esc(f[1]) + '</th>' +
        '<td><label class="check"><input type="radio" class="chk" name="mf-' + k + '" value="a"' + (pickB ? '' : ' checked') + '>' + (ta ? esc(ta) : '<span class="muted">empty</span>') + '</label></td>' +
        '<td><label class="check"><input type="radio" class="chk" name="mf-' + k + '" value="b"' + (pickB ? ' checked' : '') + '>' + (tb ? esc(tb) : '<span class="muted">empty</span>') + '</label></td></tr>';
    }).join('');
    openModal({
      title: title, cls: 'wide',
      body: '<fieldset class="field" style="border:0;padding:0;margin:0"><legend class="lab" style="font:400 12px var(--mono);color:var(--ink2);margin-bottom:6px">Keep this record (its ID and link survive)</legend><div class="radios">' +
        '<label><input type="radio" name="mKeep" value="a" checked>' + esc(nameOf(a)) + ' · #' + a.id + '</label><label><input type="radio" name="mKeep" value="b">' + esc(nameOf(b)) + ' · #' + b.id + '</label></div></fieldset>' +
        '<p class="hint" style="margin:0">Choose the value to keep for every field that differs. ' + (kind === 'co' ? 'Contacts, deals, activities and notes of both companies end up on the kept one.' : 'Deals, activities and notes of both people end up on the kept one.') + '</p>' +
        '<div class="tablewrap" style="border:1px solid var(--hair);border-radius:14px"><table class="tbl merge"><thead><tr><th>Field</th><th>#' + a.id + ' · ' + esc(relCounts(kind, a)) + '</th><th>#' + b.id + ' · ' + esc(relCounts(kind, b)) + '</th></tr></thead><tbody>' + rows + '</tbody></table></div>',
      foot: '<button type="button" class="btn ghost" data-close>Cancel</button><button type="submit" class="btn pri" form="{form}">Merge</button>',
      onSubmit: function (api) {
        var keepB = (api.el.querySelector('input[name="mKeep"]:checked') || {}).value === 'b';
        var keep = keepB ? b : a, drop = keepB ? a : b, vals = {};
        fields.forEach(function (f) {
          var k = f[0], r = api.el.querySelector('input[name="mf-' + k + '"]:checked');
          vals[k] = r ? (r.value === 'b' ? b[k] : a[k]) : a[k];
        });
        if (kind === 'ct' && vals.email && db.contacts.some(function (x) { return x !== a && x !== b && (x.email || '').toLowerCase() === String(vals.email).toLowerCase(); })) return formError(api, 'Another contact already uses the chosen email.');
        api.close(true);
        if (kind === 'co') mergeCompanies(keep, drop, vals); else mergeContacts(keep, drop, vals);
      }
    });
  }
  function dropIgnores(kind, id) { db.dupIgnore = db.dupIgnore.filter(function (k) { var p = k.split(':'); return !(p[0] === kind && (+p[1] === id || +p[2] === id)); }); }
  function mergeCompanies(keep, drop, vals) {
    var now = Date.now();
    Object.assign(keep, vals);
    keep.createdAt = Math.min(keep.createdAt, drop.createdAt); keep.updatedAt = now;
    db.contacts.forEach(function (x) { if (x.companyId === drop.id) x.companyId = keep.id; });
    db.deals.forEach(function (x) { if (x.companyId === drop.id) x.companyId = keep.id; });
    db.activities.forEach(function (x) { if (x.companyId === drop.id) x.companyId = keep.id; });
    db.notes.forEach(function (n) { if (n.entity === 'company' && n.entityId === drop.id) n.entityId = keep.id; });
    db.notes.push({ id: ++db.seq.note, entity: 'company', entityId: keep.id, text: 'Merged with “' + drop.name + '” (#' + drop.id + ').', at: now, owner: keep.owner });
    db.companies = db.companies.filter(function (x) { return x !== drop; });
    dropIgnores('co', drop.id);
    commit(); toast('Companies merged into ' + keep.name);
  }
  function mergeContacts(keep, drop, vals) {
    var now = Date.now();
    Object.assign(keep, vals);
    keep.createdAt = Math.min(keep.createdAt, drop.createdAt); keep.updatedAt = now;
    db.deals.forEach(function (x) { if (x.contactId === drop.id) x.contactId = keep.id; });
    db.activities.forEach(function (x) { if (x.contactId === drop.id) x.contactId = keep.id; });
    db.notes.forEach(function (n) { if (n.entity === 'contact' && n.entityId === drop.id) n.entityId = keep.id; });
    db.quotes.forEach(function (q) { if (q.contactId === drop.id) q.contactId = keep.id; });
    // a deal can only name a contact of its own company
    db.deals.forEach(function (x) { if (x.contactId === keep.id && x.companyId !== keep.companyId) x.contactId = null; });
    db.notes.push({ id: ++db.seq.note, entity: 'contact', entityId: keep.id, text: 'Merged with ' + personName(drop) + ' (#' + drop.id + ').', at: now, owner: keep.owner });
    db.contacts = db.contacts.filter(function (x) { return x !== drop; });
    dropIgnores('ct', drop.id);
    commit(); toast('Contacts merged into ' + personName(keep));
  }

  // ── Email templates & compose ───────────────────────────────────────────────
  var EMAIL_TPL = [
    { id: 'intro', name: 'Introduction — B2B programme', subject: 'Adrial B2B programme for {{company}}', body: 'Dear {{first_name}},\n\nthank you for your interest in working with Adrial. We supply opticians, clinics and companies in Slovenia and Croatia with frames, lenses, contact-lens subscriptions and corporate eye-care programmes.\n\nI would be glad to show you what we could do for {{company}} — would a short call next week suit you?\n\nKind regards,\n{{owner}}\nAdrial B2B' },
    { id: 'followup', name: 'Follow-up after a meeting', subject: 'Thank you for the meeting — next steps', body: 'Dear {{first_name}},\n\nthank you for your time today. As agreed, I will prepare a proposal for {{deal}} and send it to you shortly.\n\nIf anything else comes up in the meantime, just reply to this email.\n\nBest regards,\n{{owner}}' },
    { id: 'proposal', name: 'Proposal / quote sent', subject: 'Our proposal: {{deal}}', body: 'Dear {{first_name}},\n\nplease find our proposal for {{deal}} ({{value}} excl. VAT){{quote_ref}}. It is valid for 30 days.\n\nI am happy to walk you through it — let me know a time that works for you.\n\nKind regards,\n{{owner}}\nAdrial B2B' },
    { id: 'reminder', name: 'Gentle reminder', subject: 'Following up on {{deal}}', body: 'Dear {{first_name}},\n\nI wanted to follow up on our proposal for {{deal}}. Have you had a chance to look at it? If it helps, we can adjust volumes or delivery dates.\n\nBest regards,\n{{owner}}' },
    { id: 'thanks', name: 'Thank you for your order', subject: 'Thank you for your order, {{company}}', body: 'Dear {{first_name}},\n\nthank you for choosing Adrial. Your order for {{deal}} is being processed and we will confirm the delivery date shortly.\n\nWarm regards,\n{{owner}}\nAdrial B2B' }
  ];
  function fillTpl(s, ctx) { return String(s).replace(/\{\{\s*(\w+)\s*\}\}/g, function (m, k) { return ctx[k] != null && ctx[k] !== '' ? ctx[k] : (k === 'quote_ref' ? '' : m); }); }
  function copyText(text) {
    function fallback() {
      var ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); var ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; } ta.remove();
      return ok;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return fallback(); });
    return Promise.resolve(fallback());
  }
  // ── Pipeline drag & drop with Pointer Events (mouse, touch, pen) ─────────────
  var drag = null;
  function bindBoard() {
    var board = $('.board'); if (!board) return;
    board.addEventListener('pointerdown', dragDown);
  }
  function dragDown(e) {
    if (e.button !== 0 || drag) return;
    var card = e.target.closest('.dcard'); if (!card) return;
    var grip = !!e.target.closest('.grip');
    if (!grip && (e.pointerType !== 'mouse' || e.target.closest('a,select,button,input,label'))) return; // touch drags start on the grip; the card body scrolls
    drag = { id: +card.dataset.deal, card: card, pid: e.pointerId, x0: e.clientX, y0: e.clientY, active: false, ghost: null, over: null, x: e.clientX, y: e.clientY, raf: 0 };
    if (grip) { e.preventDefault(); dragStart(e); }
    document.addEventListener('pointermove', dragMove);
    document.addEventListener('pointerup', dragEnd);
    document.addEventListener('pointercancel', dragCancel);
  }
  function dragStart(e) {
    var r = drag.card.getBoundingClientRect();
    drag.active = true; drag.dx = e.clientX - r.left; drag.dy = e.clientY - r.top;
    var g = drag.card.cloneNode(true);
    g.classList.add('ghost'); g.removeAttribute('aria-label'); g.setAttribute('aria-hidden', 'true');
    $$('[id]', g).forEach(function (x) { x.removeAttribute('id'); });
    g.style.width = r.width + 'px';
    document.body.appendChild(g); drag.ghost = g;
    drag.card.classList.add('dragging'); document.body.classList.add('is-dragging');
    try { drag.card.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    dragPos(e.clientX, e.clientY);
    drag.raf = requestAnimationFrame(dragTick);
  }
  function dragPos(x, y) {
    drag.x = x; drag.y = y;
    drag.ghost.style.transform = 'translate(' + Math.round(x - drag.dx) + 'px,' + Math.round(y - drag.dy) + 'px) rotate(1.5deg)';
    var el = document.elementFromPoint(x, y), col = el && el.closest ? el.closest('.col') : null;
    if (col !== drag.over) { if (drag.over) drag.over.classList.remove('over'); drag.over = col; if (col) col.classList.add('over'); }
  }
  function dragTick() { // auto-scroll the board and the column under the pointer near their edges
    if (!drag || !drag.active) return;
    var b = $('.board');
    if (b) { var r = b.getBoundingClientRect(); if (drag.x < r.left + 48) b.scrollLeft -= 14; else if (drag.x > r.right - 48) b.scrollLeft += 14; }
    if (drag.over) { var cb = drag.over.querySelector('.col-b'); if (cb) { var rc = cb.getBoundingClientRect(); if (drag.y < rc.top + 36) cb.scrollTop -= 10; else if (drag.y > rc.bottom - 36) cb.scrollTop += 10; } }
    drag.raf = requestAnimationFrame(dragTick);
  }
  function dragMove(e) {
    if (!drag || e.pointerId !== drag.pid) return;
    if (!drag.active) { if (Math.abs(e.clientX - drag.x0) + Math.abs(e.clientY - drag.y0) < 7) return; dragStart(e); }
    e.preventDefault();
    dragPos(e.clientX, e.clientY);
  }
  function dragFinish() {
    document.removeEventListener('pointermove', dragMove);
    document.removeEventListener('pointerup', dragEnd);
    document.removeEventListener('pointercancel', dragCancel);
    var d0 = drag; drag = null;
    if (!d0) return null;
    cancelAnimationFrame(d0.raf);
    if (d0.ghost) d0.ghost.remove();
    d0.card.classList.remove('dragging'); document.body.classList.remove('is-dragging');
    $$('.col.over').forEach(function (x) { x.classList.remove('over'); });
    return d0;
  }
  function dragEnd(e) {
    if (!drag || e.pointerId !== drag.pid) return;
    var d0 = dragFinish();
    if (!d0 || !d0.active) return;
    // swallow the click that follows a drag so the card link does not open
    var swallow = function (ev) { ev.stopPropagation(); ev.preventDefault(); };
    document.addEventListener('click', swallow, true);
    setTimeout(function () { document.removeEventListener('click', swallow, true); }, 80);
    var to = d0.over ? d0.over.dataset.stage : null, d = deal(d0.id);
    if (d && to && to !== d.stage) requestMove(d, to);
  }
  function dragCancel() { dragFinish(); }

  // ── Deal form with ERP catalogue picker ────────────────────────────────────
  function productPicker(country, onPick) {
    var results = [], selIdx = 0;
    var api = openModal({
      title: 'Choose a product', cls: 'wide qsm',
      body: '<label class="sr" for="ppIn">Search products by name, SKU or category</label>' +
        '<input class="qs-in" id="ppIn" type="search" role="combobox" aria-expanded="true" aria-controls="ppList" aria-autocomplete="list" placeholder="Search name, SKU, category, brand…" autocomplete="off" spellcheck="false" autofocus>' +
        (erp.catalog ? '<p class="hint" style="margin:0">ERP catalogue · ' + erp.catalog.products.length + ' products · stock and VAT for ' + esc(country) + (erp.catalogAt ? ' · updated ' + esc(fmtStamp(Date.parse(erp.catalogAt))) : '') + '</p>' : catalogHint()) +
        '<ul class="qs-res" id="ppList" role="listbox" aria-label="Products"></ul>'
    });
    var input = api.el.querySelector('#ppIn'), list = api.el.querySelector('#ppList');
    function run() {
      var q = input.value.trim(); results = [];
      if (erp.catalog) {
        erp.catalog.products.filter(function (p) { return p && p.sku && matchQ(q, [p.sku, p.name, p.category, p.brand].join(' ')); }).slice(0, 60).forEach(function (p) {
          var st = stockFor(p, country);
          results.push({ g: 'ERP catalogue', kind: 'erp', p: p, t: p.name, s: [p.sku, p.category, p.brand].filter(Boolean).join(' · '), price: +p.price || 0, vat: vatPct(p.vat && p.vat[country] != null ? p.vat[country] : VAT_STD[country]), stock: st });
        });
      }
      PRODUCTS.filter(function (p) { return matchQ(q, [p.id, p.name, 'service programme'].join(' ')); }).forEach(function (p) {
        results.push({ g: 'Services & programmes (no SKU — not sent to ERP)', kind: 'crm', p: p, t: p.name, s: p.id + ' · per ' + p.unit, price: p.price, vat: VAT_STD[country], stock: null });
      });
      if (selIdx >= results.length) selIdx = 0;
      var html = '', last = '';
      results.forEach(function (r, i) {
        if (r.g !== last) { html += '<li role="presentation" class="qs-grp">' + esc(r.g) + '</li>'; last = r.g; }
        html += '<li role="option" class="qs-opt" id="pp-o-' + i + '" data-i="' + i + '" aria-selected="' + (i === selIdx) + '"><span class="main"><b>' + esc(r.t) + '</b><small>' + esc(r.s) + '</small></span>' +
          '<span class="pp-meta"><span class="num">' + esc(money2(r.price)) + '</span><small>VAT ' + r.vat + '%' + (r.stock != null ? ' · <span class="' + (r.stock <= 0 ? 'bad-t' : '') + '">' + (r.stock <= 0 ? 'out of stock' : fmtInt.format(r.stock) + ' in ' + esc(country)) + '</span>' : '') + '</small></span></li>';
      });
      list.innerHTML = html || '<li role="presentation" class="empty">No products match.</li>';
      if (results.length) input.setAttribute('aria-activedescendant', 'pp-o-' + selIdx); else input.removeAttribute('aria-activedescendant');
    }
    function move(n) {
      if (!results.length) return;
      selIdx = (selIdx + n + results.length) % results.length;
      $$('.qs-opt', list).forEach(function (o) { o.setAttribute('aria-selected', String(+o.dataset.i === selIdx)); });
      input.setAttribute('aria-activedescendant', 'pp-o-' + selIdx);
      var o = list.querySelector('#pp-o-' + selIdx); if (o) o.scrollIntoView({ block: 'nearest' });
    }
    function go(i) { var r = results[i]; if (!r) return; api.close(); onPick(r); }
    input.addEventListener('input', function () { selIdx = 0; run(); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); go(selIdx); }
    });
    list.addEventListener('click', function (e) { var o = e.target.closest('.qs-opt'); if (o) go(+o.dataset.i); });
    run();
  }
  function dealForm(d, preset) {
    var isNew = !d; preset = preset || {};
    var lines = d ? d.lines.map(function (l) { return Object.assign({}, l); }) : [{ productId: '', qty: 1, price: '', discount: 0 }];
    var coId = d ? d.companyId : (preset.companyId || '');
    var pc = company(coId);
    var v = d || { title: '', contactId: preset.contactId || '', owner: pc ? pc.owner : defaultOwner(), stage: 'lead', expectedClose: addDays(todayYmd(), 45) };
    var apiRef = null;
    function country() { var c = apiRef ? company(+apiRef.el.querySelector('#fdCo').value) : pc; return c ? c.country : 'SI'; }
    function info(l) {
      if (!l.sku && !l.productId) return '';
      var w = stockWarn(l, country()), p = l.sku ? catProduct(l.sku) : null, st = p ? stockFor(p, country()) : null;
      return esc(lineCode(l) + (l.sku ? ' · ERP · VAT ' + lineVat(l, country()) + '%' : ' · service · per ' + lineUnit(l))) +
        (st != null && !w ? ' · ' + fmtInt.format(st) + ' in stock (' + country() + ')' : '') + (w ? ' · <span class="bad-t">' + esc(w) + '</span>' : '');
    }
    function lineHtml(l, i) {
      var has = l.sku || l.productId;
      return '<div class="line" data-i="' + i + '">' +
        '<div class="field f-prod"><span class="lab" id="ln-pl-' + i + '">Product</span><button type="button" class="in prodbtn" id="ln-p-' + i + '" data-pick="' + i + '" aria-labelledby="ln-pl-' + i + ' ln-p-' + i + '">' + (has ? esc(lineLabel(l)) : '<span class="muted">Choose a product…</span>') + '</button></div>' +
        '<div class="field"><label for="ln-q-' + i + '">Qty</label>' + inp('ln-q-' + i, l.qty, 'type="number" min="1" step="1" inputmode="numeric" data-f="qty"') + '</div>' +
        '<div class="field"><label for="ln-r-' + i + '">Unit €</label>' + inp('ln-r-' + i, l.price, 'type="number" min="0" step="0.01" inputmode="decimal" data-f="price"') + '</div>' +
        '<div class="field"><label for="ln-d-' + i + '">Disc. %</label>' + inp('ln-d-' + i, l.discount, 'type="number" min="0" max="100" step="1" inputmode="numeric" data-f="discount"') + '</div>' +
        '<div class="field f-rm"><button type="button" class="btn icon sm ghost" data-rm="' + i + '" aria-label="Remove line ' + (i + 1) + '"' + (lines.length === 1 ? ' disabled' : '') + '>' + icon('trash') + '</button></div>' +
        '<div class="lt"><span class="li">' + info(l) + '</span><span class="num">' + esc(money2(lineTotal(l))) + '</span></div></div>';
    }
    openModal({
      title: isNew ? 'New deal' : 'Edit deal', cls: 'wide',
      body: fld('fdTitle', 'Deal title', inp('fdTitle', v.title, 'required maxlength="120" autocomplete="off" autofocus placeholder="e.g. Frames programme 2027"'), { req: true }) +
        '<div class="row2">' + fld('fdCo', 'Company', sel('fdCo', companyOpts('Choose a company…'), coId), { req: true }) + fld('fdCt', 'Main contact', sel('fdCt', contactOpts(coId ? +coId : null), v.contactId)) + '</div>' +
        '<div class="row3">' + fld('fdOwner', 'Owner', sel('fdOwner', OWNERS.map(function (o) { return [o.id, o.name]; }), v.owner)) +
        (isNew ? fld('fdStage', 'Stage', sel('fdStage', OPEN_STAGES.map(function (s) { return [s, STAGE[s].name + ' · ' + STAGE[s].prob + '%']; }), v.stage)) : '<div class="field"><span class="lab">Stage</span><p style="margin:10px 0 0">' + stageChip(d.stage) + ' <span class="hint">change it on the deal page</span></p></div>') +
        fld('fdClose', 'Expected close', inp('fdClose', v.expectedClose, 'type="date" required'), { req: true }) + '</div>' +
        '<div class="field"><span class="lab">Products / line items <span class="req" aria-hidden="true">*</span></span>' + (erp.catalog ? '' : catalogHint()) + '<div class="lines" id="fdLines"></div>' +
        '<div><button type="button" class="btn sm" data-addline>' + icon('plus') + 'Add line</button></div></div>' +
        '<div class="total"><span>Deal value <span class="hint">excl. VAT</span></span><b id="fdTotal" aria-live="polite"></b></div>',
      foot: '<button type="button" class="btn ghost" data-close>Cancel</button><button type="submit" class="btn pri" form="{form}">' + (isNew ? 'Create deal' : 'Save changes') + '</button>',
      onOpen: function (api) {
        apiRef = api;
        var box = api.el.querySelector('#fdLines');
        function draw() { box.innerHTML = lines.map(lineHtml).join(''); total(); }
        function total() { api.el.querySelector('#fdTotal').textContent = money2(sum(lines, lineTotal)); }
        function readRow(row) {
          var l = lines[+row.dataset.i];
          $$('[data-f]', row).forEach(function (e) { l[e.dataset.f] = e.value === '' ? '' : +e.value; });
          row.querySelector('.lt .num').textContent = money2(lineTotal(l));
          row.querySelector('.lt .li').innerHTML = info(l);
          total();
        }
        draw();
        box.addEventListener('input', function (e) { var row = e.target.closest('.line'); if (row) readRow(row); });
        box.addEventListener('click', function (e) {
          var pick = e.target.closest('[data-pick]');
          if (pick) {
            var i = +pick.dataset.pick;
            productPicker(country(), function (r) {
              var old = lines[i], n;
              if (r.kind === 'erp') n = { sku: r.p.sku, name: r.p.name, category: r.p.category || '', vatRates: r.p.vat || null, qty: old.qty || 1, price: +r.p.price || 0, discount: old.discount || 0 };
              else n = { productId: r.p.id, qty: old.qty || 1, price: r.p.price, discount: old.discount || 0 };
              lines[i] = n; draw();
              var t = api.el.querySelector('#fdTitle');
              if (!t.value.trim()) t.value = r.kind === 'erp' ? r.p.name : r.p.short;
              setTimeout(function () { var b = api.el.querySelector('#ln-q-' + i); if (b) b.focus(); }, 0);
            });
            return;
          }
          var b = e.target.closest('[data-rm]'); if (!b || lines.length === 1) return;
          lines.splice(+b.dataset.rm, 1); draw();
          var f = box.querySelector('.prodbtn'); if (f) f.focus();
        });
        api.el.querySelector('[data-addline]').addEventListener('click', function () {
          lines.push({ productId: '', qty: 1, price: '', discount: 0 }); draw();
          box.querySelector('.line:last-child .prodbtn').focus();
        });
        api.el.querySelector('#fdCo').addEventListener('change', function (e) {
          var id = e.target.value ? +e.target.value : null, ctSel = api.el.querySelector('#fdCt'), keep = ctSel.value;
          ctSel.innerHTML = opts(contactOpts(id), keep);
          var c = company(id); if (c && isNew) api.el.querySelector('#fdOwner').value = c.owner;
          $$('.line', box).forEach(function (row) { row.querySelector('.lt .li').innerHTML = info(lines[+row.dataset.i]); });
        });
      },
      onSubmit: function (api) {
        var title = val(api, 'fdTitle'), co = val(api, 'fdCo'), close = val(api, 'fdClose');
        if (!title) return formError(api, 'Enter a deal title.', 'fdTitle');
        if (!co || !company(+co)) return formError(api, 'Choose the company this deal is with.', 'fdCo');
        if (!validYmd(close)) return formError(api, 'Enter the expected close date.', 'fdClose');
        for (var i = 0; i < lines.length; i++) {
          var l = lines[i];
          if (!(l.sku || PRODUCT[l.productId])) return formError(api, 'Choose a product on line ' + (i + 1) + '.', 'ln-p-' + i);
          if (!(l.qty > 0) || Math.round(l.qty) !== l.qty) return formError(api, 'Quantity on line ' + (i + 1) + ' must be a whole number above 0.', 'ln-q-' + i);
          if (l.price === '' || !(l.price >= 0)) return formError(api, 'Enter a unit price on line ' + (i + 1) + '.', 'ln-r-' + i);
          if (l.discount === '') l.discount = 0;
          if (!(l.discount >= 0 && l.discount <= 100)) return formError(api, 'Discount on line ' + (i + 1) + ' must be between 0 and 100.', 'ln-d-' + i);
        }
        var now = Date.now(), coId = +co, ctId = val(api, 'fdCt') ? +val(api, 'fdCt') : null, owner = val(api, 'fdOwner');
        var ctObj = contact(ctId); if (!ctObj || ctObj.companyId !== coId) ctId = null;
        var clean = lines.map(function (l) {
          var base = { qty: +l.qty, price: Math.round(+l.price * 100) / 100, discount: +l.discount || 0 };
          return l.sku ? Object.assign({ sku: l.sku, name: l.name || l.sku, category: l.category || '', vatRates: l.vatRates || null }, base) : Object.assign({ productId: l.productId }, base);
        });
        var target = d;
        if (isNew) {
          var stage = val(api, 'fdStage') || 'lead';
          target = { id: ++db.seq.deal, stage: stage, closedAt: null, lostReason: null, createdAt: now, stageEnteredAt: now, history: [{ from: null, to: stage, at: now, by: owner }] };
          db.deals.push(target);
        } else if (d.companyId !== coId) {
          db.activities.forEach(function (a) { if (a.dealId === d.id) a.companyId = coId; });
        }
        var oldV = isNew ? null : dealValue(target), oldClose = isNew ? null : target.expectedClose;
        Object.assign(target, { title: title, companyId: coId, contactId: ctId, owner: owner, expectedClose: close, lines: clean, updatedAt: now });
        if (isNew) target.changes = [];
        else { recordChange(target, 'value', r2(oldV), r2(dealValue(target)), now); recordChange(target, 'expectedClose', oldClose, close, now); }
        var cc = company(coId); if (cc) cc.updatedAt = now;
        api.close(true);
        if (isNew) { save(); updateNav(); toast('Deal created'); location.hash = '#/deals/' + target.id; }
        else { commit(); toast('Deal saved'); }
      }
    });
  }

  Object.assign(ACT, {
    print: function () { window.print(); },
    'erp-send': function (t) { var d = deal(+t.dataset.id); if (d) sendToErpDialog(d); },
    'quote-new': function (t) { var d = deal(+t.dataset.id); if (d) quoteForm(d); },
    'quote-status': function (t) { var q = db.quotes.find(function (x) { return x.id === +t.dataset.id; }); if (q) setQuoteStatus(q, t.dataset.st); },
    'tg-save': function () { saveTargets(); },
    'tg-fill': function () { OWNERS.forEach(function (o) { var m = $('#tg-m-' + o.id), q = $('#tg-q-' + o.id); if (m && q && /^\d+(\.\d+)?$/.test(m.value.trim())) q.value = Math.round(+m.value * 3); }); },
    'dup-ignore': function (t) { db.dupIgnore.push(pairKey(t.dataset.kind, +t.dataset.a, +t.dataset.b)); commit(); toast('Marked as not a duplicate'); },
    'dup-unignore': function () { db.dupIgnore = []; commit(); },
    'dup-merge': function (t) { var k = t.dataset.kind, a = k === 'co' ? company(+t.dataset.a) : contact(+t.dataset.a), b = k === 'co' ? company(+t.dataset.b) : contact(+t.dataset.b); mergeDialog(k, a, b); },
    email: function (t) { composeEmail({ dealId: t.dataset.deal ? +t.dataset.deal : null, contactId: t.dataset.contact ? +t.dataset.contact : null, companyId: t.dataset.company ? +t.dataset.company : null }); }
  });

  // ══ Round 3: editable email templates, weekly digest, cloud sync ═══════════════════════════════
  var TPL_CATS = ['Intro', 'Follow-up', 'Proposal', 'Negotiation', 'Thank you', 'Win-back', 'Other'];
  var PLACEHOLDERS = [
    ['first_name', 'Contact first name'], ['last_name', 'Contact last name'], ['full_name', 'Contact full name'], ['job_title', 'Contact job title'],
    ['company', 'Company name'], ['city', 'Company city'], ['deal', 'Deal title'], ['value', 'Deal value (excl. VAT)'], ['stage', 'Deal stage'],
    ['close_date', 'Expected close date'], ['quote_no', 'Latest quote number'], ['quote_ref', 'Quote reference (", quote Q-…" or empty)'],
    ['owner', 'Owner name'], ['today', 'Today’s date']
  ];
  var PH_KEYS = {}; PLACEHOLDERS.forEach(function (p) { PH_KEYS[p[0]] = true; });
  var TPL_CAT_OF = { intro: 'Intro', followup: 'Follow-up', proposal: 'Proposal', reminder: 'Follow-up', thanks: 'Thank you' };
  var DEFAULT_TEMPLATES = EMAIL_TPL.map(function (t) { return { key: t.id, name: t.name, category: TPL_CAT_OF[t.id] || 'Other', subject: t.subject, body: t.body }; }).concat([{
    key: 'winback', name: 'Win-back — it has been a while', category: 'Win-back', subject: 'Shall we pick up where we left off, {{first_name}}?',
    body: 'Dear {{first_name}},\n\nit has been a while since we last worked with {{company}}. This season we have new frame collections, contact-lens subscriptions and corporate eye-care packages, and I would be glad to show you what is new.\n\nWould you have 20 minutes next week?\n\nKind regards,\n{{owner}}\nAdrial B2B'
  }]);
  var templatesSeeded = false;
  function seedTemplates(d) {
    if (!d.seq.template) d.seq.template = 0;
    var now = Date.now();
    d.templates = DEFAULT_TEMPLATES.map(function (t) { return { id: ++d.seq.template, key: t.key, name: t.name, category: t.category, subject: t.subject, body: t.body, owner: null, uses: 0, lastUsedAt: null, createdAt: now, updatedAt: now }; });
  }

  // Demo history of value / close-date changes (once per deal; deterministic per deal id)
  function prng(seed) { var a = seed | 0; return function () { a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function bizMs(ms, R) { var d = new Date(ms); var w = d.getDay(); if (w === 6) d.setDate(d.getDate() - 1); if (w === 0) d.setDate(d.getDate() + 1); d.setHours(8 + Math.floor(R() * 9), [0, 15, 30, 45][Math.floor(R() * 4)], 0, 0); return Math.min(d.getTime(), Date.now() - 3600e3); }
  function seedChanges(d) {
    d.changes = [];
    var R = prng(d.id * 7919 + 13), lo = d.createdAt + DAY, hi = isOpen(d) ? Date.now() : parseYmd(d.closedAt || ymd(d.updatedAt)) + 12 * 3600e3;
    if (!(hi - lo > 3 * DAY)) return;
    if (d.expectedClose && R() < 0.4) {
      var at = bizMs(hi - Math.pow(R(), 2) * (hi - lo), R), days = 7 + Math.floor(R() * 28), pulled = R() < 0.18;
      d.changes.push({ at: Math.max(lo, at), by: d.owner, field: 'expectedClose', from: addDays(d.expectedClose, pulled ? days : -days), to: d.expectedClose });
    }
    if (R() < 0.28) {
      var v = dealValue(d), f = 0.72 + R() * 0.5, at2 = bizMs(hi - Math.pow(R(), 2) * (hi - lo), R);
      if (Math.abs(f - 1) > 0.03) d.changes.push({ at: Math.max(lo, at2), by: d.owner, field: 'value', from: r2(v * f), to: r2(v) });
    }
    d.changes.sort(function (a, b) { return a.at - b.at; });
  }
  function migrate3(d) {
    var changed = false;
    if (!Array.isArray(d.templates)) { seedTemplates(d); changed = true; }
    d.deals.forEach(function (x) { if (!Array.isArray(x.changes)) { seedChanges(x); changed = true; } });
    if (changed) templatesSeeded = true;
    return d;
  }
  function recordChange(d, field, from, to, at) {
    if (from == null) return;
    if (field === 'value' ? Math.abs((+from || 0) - (+to || 0)) < 0.005 : from === to) return;
    d.changes = (d.changes || []).concat([{ at: at, by: actor(d.owner), field: field, from: from, to: to }]).slice(-60);
  }
  function changesList(d) {
    var ch = (d.changes || []).slice().reverse();
    if (!ch.length) return '';
    return '<h3 class="label" style="margin:0;padding:6px 20px 0">Value &amp; close-date changes</h3><ul class="tl">' + ch.map(function (c) {
      var what = c.field === 'value' ? 'Value ' + money(c.from) + ' → ' + money(c.to) : 'Close date ' + fmtDate(c.from) + ' → ' + fmtDate(c.to);
      var tag = c.field === 'value' ? (c.to > c.from ? 'up' : 'down') : (c.to > c.from ? 'slipped' : 'pulled in');
      return '<li><span class="typeic">' + icon(c.field === 'value' ? 'deal' : 'task') + '</span><div><div class="what"><b>' + esc(what) + '</b> <span class="chip">' + esc(tag) + '</span></div><div class="when"><span>' + esc(fmtStamp(c.at)) + '</span><span>' + esc(ownerName(c.by)) + '</span></div></div></li>';
    }).join('') + '</ul>';
  }

  // ── Templates: filling, usage ────────────────────────────────────────────────
  function tplCtx(person, d, c) {
    var q = d ? dealQuotes(d)[0] : null, ownerId = d ? d.owner : person ? person.owner : defaultOwner();
    return {
      first_name: person ? person.firstName : '', last_name: person ? person.lastName : '', full_name: person ? personName(person) : '', job_title: person ? person.title || '' : '',
      company: c ? c.name : '', city: c ? c.city || '' : '', deal: d ? d.title : '', value: d ? money(dealValue(d)) : '', stage: d ? STAGE[d.stage].name : '',
      close_date: d && d.expectedClose ? fmtDateFull(d.expectedClose) : '', quote_no: q ? q.no : '', quote_ref: q ? ', quote ' + q.no : '',
      owner: ownerName(ownerId), today: fmtDateFull(todayYmd())
    };
  }
  function fillT(s, ctx) { return String(s || '').replace(/\{\{\s*([a-zA-Z_]\w*)\s*\}\}/g, function (m, k) { return PH_KEYS[k] ? (ctx[k] == null ? '' : String(ctx[k])) : m; }); }
  function tplIssues(subject, body) {
    var out = [], seen = {}, all = String(subject || '') + '\n' + String(body || '');
    all.replace(/\{\{\s*([^{}]*?)\s*\}\}/g, function (m, k) { if (!PH_KEYS[k] && !seen[k]) { seen[k] = 1; out.push('Unknown placeholder {{' + k + '}} — it stays as typed.'); } return m; });
    var opens = (all.match(/\{\{/g) || []).length, closes = (all.match(/\}\}/g) || []).length;
    if (opens !== closes) out.push('Unbalanced braces: ' + opens + ' “{{” but ' + closes + ' “}}”.');
    return out;
  }
  function markHtml(text) { // escaped text with unknown placeholders highlighted
    return esc(text).replace(/\{\{\s*([^{}]*?)\s*\}\}/g, function (m) { return '<mark title="Unknown placeholder">' + m + '</mark>'; });
  }
  function visibleTemplates(ownerId) {
    return db.templates.filter(function (t) { return !t.owner || t.owner === ownerId || (ui.me !== 'all' && t.owner === ui.me); })
      .sort(function (a, b) { return (b.uses || 0) - (a.uses || 0) || a.name.localeCompare(b.name); });
  }
  function markUsed(t) { if (!t) return; t.uses = (t.uses || 0) + 1; t.lastUsedAt = Date.now(); save(); }

  function composeEmail(preset) {
    preset = preset || {};
    var d = deal(preset.dealId), ct0 = contact(preset.contactId) || (d ? contact(d.contactId) : null);
    var c = d ? company(d.companyId) : ct0 ? company(ct0.companyId) : company(preset.companyId);
    var people = c ? db.contacts.filter(function (x) { return x.companyId === c.id; }) : ct0 ? [ct0] : [];
    if (ct0 && people.indexOf(ct0) < 0) people.unshift(ct0);
    if (!people.length) { toast('Add a contact with an email address first.'); return; }
    var ownerId = d ? d.owner : (ct0 || people[0]).owner;
    var list = visibleTemplates(ownerId);
    if (!list.length) { toast('No email templates yet — create one on the Templates page.'); return; }
    var wantCat = d ? (d.stage === 'won' ? 'Thank you' : d.stage === 'proposal' ? 'Proposal' : d.stage === 'negotiation' ? 'Proposal' : 'Follow-up') : 'Intro';
    var t0 = list.filter(function (t) { return t.category === wantCat; })[0] || list[0];
    var used = false;
    openModal({
      title: 'Compose email', cls: 'wide',
      body: '<div class="row2">' + fld('emTpl', 'Template', sel('emTpl', list.map(function (t) { return [t.id, t.name + ' · ' + t.category + (t.owner ? ' · ' + ownerName(t.owner).split(' ')[0] : '')]; }), t0.id)) +
        fld('emTo', 'To', sel('emTo', people.map(function (x) { return [x.id, personName(x) + (x.email ? ' <' + x.email + '>' : ' (no email)')]; }), (ct0 || people[0]).id)) + '</div>' +
        fld('emSubj', 'Subject', inp('emSubj', '', 'maxlength="200" autocomplete="off"')) +
        fld('emBody', 'Message', '<textarea class="in" id="emBody" rows="10" maxlength="8000"></textarea>', { hint: 'Filled from the template; edit freely. Nothing is sent from the CRM — copy it, open your mail app, or log it.' }),
      foot: '<button type="button" class="btn" data-copy>' + icon('note') + 'Copy</button><a class="btn" id="emMailto" href="#" target="_blank" rel="noopener">' + icon('email') + 'Open in mail app</a><span class="grow"></span>' +
        '<button type="button" class="btn ghost" data-close>Cancel</button><button type="submit" class="btn pri" form="{form}">Log as email activity</button>',
      onOpen: function (api) {
        var tSel = api.el.querySelector('#emTpl'), toSel = api.el.querySelector('#emTo'), subj = api.el.querySelector('#emSubj'), body = api.el.querySelector('#emBody'), mail = api.el.querySelector('#emMailto');
        function person() { return contact(+toSel.value); }
        function tpl() { return db.templates.find(function (x) { return x.id === +tSel.value; }); }
        function fill() { var t = tpl(), cx = tplCtx(person(), d, c); subj.value = fillT(t ? t.subject : '', cx); body.value = fillT(t ? t.body : '', cx); link(); }
        function link() {
          var p = person();
          mail.href = 'mailto:' + encodeURIComponent(p && p.email ? p.email : '').replace(/%40/g, '@') + '?subject=' + encodeURIComponent(subj.value) + '&body=' + encodeURIComponent(body.value);
        }
        function use() { if (!used) { used = true; markUsed(tpl()); } }
        tSel.addEventListener('change', fill); toSel.addEventListener('change', fill);
        subj.addEventListener('input', link); body.addEventListener('input', link);
        mail.addEventListener('click', use);
        api.el.querySelector('[data-copy]').addEventListener('click', function () {
          var p = person(); use();
          copyText((p && p.email ? 'To: ' + p.email + '\n' : '') + 'Subject: ' + subj.value + '\n\n' + body.value).then(function (ok) { toast(ok ? 'Copied to the clipboard' : 'Copy failed — select the text and copy it manually'); });
        });
        fill();
        api.useTpl = use;
      },
      onSubmit: function (api) {
        var p = contact(+val(api, 'emTo')), s = val(api, 'emSubj'), b = api.el.querySelector('#emBody').value;
        if (!s) return formError(api, 'Enter a subject.', 'emSubj');
        api.useTpl();
        var now = Date.now(), cid = p && p.companyId != null ? p.companyId : (c ? c.id : null);
        var a = {
          id: ++db.seq.activity, type: 'email', subject: s, due: ymd(now) + 'T' + hhmm(now), duration: 0, done: true, doneAt: now,
          owner: d ? d.owner : (p ? p.owner : defaultOwner()), companyId: cid, contactId: p ? p.id : null,
          dealId: d && d.companyId === cid ? d.id : null, notes: (p && p.email ? 'To: ' + p.email + '\n\n' : '') + b, createdAt: now
        };
        db.activities.push(a); touchRelated(a, now);
        api.close(true); commit(); toast('Email logged as an activity');
      }
    });
  }

  // ── Templates page and editor ────────────────────────────────────────────────
  function viewTemplates() {
    var f = ui.tpl;
    var rows = db.templates.filter(function (t) {
      if (f.cat && t.category !== f.cat) return false;
      if (f.owner === 'shared' && t.owner) return false;
      if (f.owner && f.owner !== 'shared' && t.owner !== f.owner) return false;
      return matchQ(f.q, [t.name, t.subject, t.body, t.category].join(' '));
    }).sort(function (a, b) { return a.category.localeCompare(b.category) || a.name.localeCompare(b.name); });
    var totalUses = sum(db.templates, function (t) { return t.uses || 0; });
    return head({
      eyebrow: 'Email', title: 'Templates', sub: '<b>' + db.templates.length + '</b> templates · used ' + totalUses + ' time' + (totalUses === 1 ? '' : 's') + ' · placeholders are filled when you compose from a contact or deal',
      actions: btn('Restore defaults', 'tpl-restore', {}, 'ghost') + btn('New template', 'tpl-new', {}, 'pri', 'plus')
    }) +
      '<div class="toolbar">' + searchBox('tpQ', 'tpl.q', f.q, 'Search templates…') +
      filterSelect('tpCat', 'tpl.cat', f.cat, [['', 'All categories']].concat(TPL_CATS.map(function (x) { return [x, x]; })), 'Category') +
      filterSelect('tpOwner', 'tpl.owner', f.owner, [['', 'Shared and personal'], ['shared', 'Shared only']].concat(OWNERS.map(function (o) { return [o.id, o.name + '’s']; })), 'Owner') + '</div>' +
      '<section class="card"><div class="tablewrap"><table class="tbl"><caption class="sr">Email templates</caption><thead><tr><th>Template</th><th class="hide-sm">Category</th><th class="hide-md">Visible to</th><th class="r">Uses</th><th class="hide-sm">Last used</th><th class="r"><span class="sr">Actions</span></th></tr></thead><tbody>' +
      (rows.length ? rows.map(function (t) {
        var bad = tplIssues(t.subject, t.body).length;
        return '<tr><td><button type="button" class="subj" data-act="tpl-edit" data-id="' + t.id + '">' + esc(t.name) + '</button>' + (t.key ? ' <span class="chip">default</span>' : '') + (bad ? ' <span class="chip bad" title="Has unknown placeholders">check</span>' : '') + '<small>' + esc(t.subject) + '</small></td>' +
          '<td class="hide-sm"><span class="chip">' + esc(t.category) + '</span></td><td class="hide-md">' + (t.owner ? ownerChip(t.owner) : '<span class="muted">Shared</span>') + '</td>' +
          '<td class="r num">' + (t.uses || 0) + '</td><td class="hide-sm">' + (t.lastUsedAt ? esc(ago(t.lastUsedAt)) : '<span class="muted">never</span>') + '</td>' +
          '<td class="r" style="white-space:nowrap"><button type="button" class="btn sm icon ghost" data-act="tpl-edit" data-id="' + t.id + '" aria-label="' + esc('Edit ' + t.name) + '">' + icon('edit') + '</button>' +
          '<button type="button" class="btn sm icon ghost" data-act="tpl-dup" data-id="' + t.id + '" aria-label="' + esc('Duplicate ' + t.name) + '">' + icon('plus') + '</button>' +
          '<button type="button" class="btn sm icon danger-ghost" data-act="tpl-del" data-id="' + t.id + '" aria-label="' + esc('Delete ' + t.name) + '">' + icon('trash') + '</button></td></tr>';
      }).join('') : '<tr><td colspan="6"><div class="empty">No templates match.</div></td></tr>') +
      '</tbody></table></div></section>';
  }
  function templateEditor(t) {
    var isNew = !t;
    var v = t || { name: '', category: 'Follow-up', owner: ui.me !== 'all' ? ui.me : null, subject: '', body: 'Dear {{first_name}},\n\n\n\nKind regards,\n{{owner}}' };
    var people = db.contacts.filter(function (x) { return x.email && x.companyId != null; }).sort(function (a, b) { return personName(a).localeCompare(personName(b), 'sl'); });
    var withDeal = people.filter(function (x) { return db.deals.some(function (dd) { return dd.contactId === x.id && isOpen(dd); }); })[0] || people[0];
    function dealOptsFor(ct) {
      var list = ct ? db.deals.filter(function (dd) { return dd.companyId === ct.companyId; }).sort(function (a, b) { return (isOpen(b) - isOpen(a)) || (b.updatedAt - a.updatedAt); }) : [];
      return [['', '— No deal —']].concat(list.map(function (dd) { return [dd.id, dd.title + ' · ' + STAGE[dd.stage].name]; }));
    }
    var firstDeal = withDeal ? (db.deals.filter(function (dd) { return dd.contactId === withDeal.id && isOpen(dd); })[0] || null) : null;
    openModal({
      title: isNew ? 'New template' : 'Edit template', cls: 'wide xwide',
      body: '<div class="te-grid"><div class="te-col">' +
        fld('teName', 'Name', inp('teName', v.name, 'required maxlength="80" autocomplete="off" autofocus'), { req: true }) +
        '<div class="row2">' + fld('teCat', 'Category', sel('teCat', TPL_CATS.map(function (x) { return [x, x]; }), v.category)) +
        fld('teOwner', 'Visible to', sel('teOwner', [['', 'Shared — everyone']].concat(OWNERS.map(function (o) { return [o.id, 'Only ' + o.name]; })), v.owner || '')) + '</div>' +
        fld('teSubj', 'Subject', inp('teSubj', v.subject, 'required maxlength="200" autocomplete="off"'), { req: true }) +
        '<div class="te-ins"><label class="sr" for="tePh">Placeholder to insert</label><select class="select" id="tePh">' + PLACEHOLDERS.map(function (p) { return '<option value="' + p[0] + '">{{' + p[0] + '}} — ' + esc(p[1]) + '</option>'; }).join('') + '</select>' +
        '<button type="button" class="btn sm" data-ins>Insert at cursor</button></div>' +
        fld('teBody', 'Message', '<textarea class="in" id="teBody" rows="12" maxlength="8000" required>' + esc(v.body) + '</textarea>', { req: true }) +
        '<div id="teWarn" aria-live="polite"></div>' +
        '</div><div class="te-col te-prev"><span class="label">Live preview</span>' +
        '<div class="row2">' + fld('tePvCt', 'Contact', sel('tePvCt', people.map(function (x) { var cc = company(x.companyId); return [x.id, personName(x) + (cc ? ' · ' + cc.name : '')]; }), withDeal ? withDeal.id : '')) +
        fld('tePvDl', 'Deal', sel('tePvDl', dealOptsFor(withDeal), firstDeal ? firstDeal.id : '')) + '</div>' +
        '<div class="te-mail"><div class="te-subj" id="tePvSubj"></div><div class="te-body" id="tePvBody"></div></div></div></div>',
      foot: (isNew ? '' : '<button type="button" class="btn danger-ghost" data-del>' + icon('trash') + 'Delete</button><span class="grow"></span>') +
        '<button type="button" class="btn ghost" data-close>Cancel</button><button type="submit" class="btn pri" form="{form}">' + (isNew ? 'Create template' : 'Save template') + '</button>',
      onOpen: function (api) {
        var subj = api.el.querySelector('#teSubj'), body = api.el.querySelector('#teBody'), last = body;
        var pvCt = api.el.querySelector('#tePvCt'), pvDl = api.el.querySelector('#tePvDl');
        function preview() {
          var ct = contact(+pvCt.value), dd = deal(+pvDl.value), cc = ct ? company(ct.companyId) : null, cx = tplCtx(ct, dd, cc);
          api.el.querySelector('#tePvSubj').innerHTML = markHtml(fillT(subj.value, cx)) || '<span class="muted">(no subject)</span>';
          api.el.querySelector('#tePvBody').innerHTML = markHtml(fillT(body.value, cx));
          var iss = tplIssues(subj.value, body.value);
          api.el.querySelector('#teWarn').innerHTML = iss.length ? '<div class="err" style="padding:8px 12px">' + iss.map(esc).join('<br>') + '</div>' : '<p class="hint" style="margin:0">All placeholders are known.</p>';
        }
        subj.addEventListener('focus', function () { last = subj; }); body.addEventListener('focus', function () { last = body; });
        subj.addEventListener('input', preview); body.addEventListener('input', preview);
        pvCt.addEventListener('change', function () { var ct = contact(+pvCt.value); pvDl.innerHTML = opts(dealOptsFor(ct), ''); preview(); });
        pvDl.addEventListener('change', preview);
        api.el.querySelector('[data-ins]').addEventListener('click', function () {
          var tok = '{{' + api.el.querySelector('#tePh').value + '}}', el = last;
          var s0 = typeof el.selectionStart === 'number' ? el.selectionStart : el.value.length, s1 = typeof el.selectionEnd === 'number' ? el.selectionEnd : s0;
          el.value = el.value.slice(0, s0) + tok + el.value.slice(s1);
          el.focus(); try { el.setSelectionRange(s0 + tok.length, s0 + tok.length); } catch (e) { /* ignore */ }
          preview();
        });
        var del = api.el.querySelector('[data-del]');
        if (del) del.addEventListener('click', function () { api.close(true); deleteTemplate(t); });
        preview();
      },
      onSubmit: function (api) {
        var name = val(api, 'teName'), s = val(api, 'teSubj'), b = api.el.querySelector('#teBody').value;
        if (!name) return formError(api, 'Give the template a name.', 'teName');
        if (!s) return formError(api, 'Enter a subject.', 'teSubj');
        if (!b.trim()) return formError(api, 'Write the message.', 'teBody');
        var now = Date.now(), target = t;
        if (isNew) { target = { id: ++db.seq.template, key: null, uses: 0, lastUsedAt: null, createdAt: now }; db.templates.push(target); }
        Object.assign(target, { name: name, category: val(api, 'teCat'), owner: val(api, 'teOwner') || null, subject: s, body: b, updatedAt: now });
        api.close(true); commit(); toast(isNew ? 'Template created' : 'Template saved');
      }
    });
  }
  function deleteTemplate(t) {
    confirmDialog({ title: 'Delete template?', text: '“' + t.name + '” will be removed.' + (t.key ? ' It is a default template — “Restore defaults” brings it back.' : ''), ok: 'Delete', danger: true }).then(function (ok) {
      if (!ok) return; db.templates = db.templates.filter(function (x) { return x !== t; }); commit(); toast('Template deleted');
    });
  }
  function restoreTemplates() {
    confirmDialog({ title: 'Restore default templates?', ok: 'Restore defaults', text: 'The ' + DEFAULT_TEMPLATES.length + ' default templates get their original text back (deleted ones return). Templates you created are kept, and usage counts stay.' }).then(function (ok) {
      if (!ok) return;
      var now = Date.now();
      DEFAULT_TEMPLATES.forEach(function (dt) {
        var t = db.templates.find(function (x) { return x.key === dt.key; });
        if (!t) { t = { id: ++db.seq.template, key: dt.key, uses: 0, lastUsedAt: null, createdAt: now }; db.templates.push(t); }
        Object.assign(t, { name: dt.name, category: dt.category, subject: dt.subject, body: dt.body, owner: null, updatedAt: now });
      });
      commit(); toast('Default templates restored');
    });
  }

  // ── Weekly digest ────────────────────────────────────────────────────────────
  function digestWeek(offset) { // offset 0 = last full week (Mon–Sun), -1 = the week before, 1 = this week so far
    var start = addDays(weekStartOf(todayYmd()), -7 + 7 * offset), end = addDays(start, 6);
    return { start: start, end: end, startMs: parseYmd(start), endMs: parseYmd(addDays(end, 1)) - 1, label: 'Week ' + isoWeek(start) + ' · ' + fmtDate(start) + ' – ' + fmtDateFull(end), short: 'week ' + isoWeek(start) };
  }
  function stageAt(d, ms) { var s = null; d.history.forEach(function (h) { if (h.at <= ms) s = h.to; }); return s; }
  function digestData(w, owner) {
    function inW(ms) { return ms >= w.startMs && ms <= w.endMs; }
    var deals = db.deals.filter(function (d) { return owner === 'all' || d.owner === owner; });
    var o = { newDeals: [], forward: [], backward: [], won: [], lost: [], valueCh: [], slipped: [], pulledIn: [], stale: [], done: 0, doneByType: {}, overdue: 0, reasons: {} };
    var lastDone = {};
    db.activities.forEach(function (a) {
      var t = a.done ? (a.doneAt || actMs(a)) : null;
      if (a.dealId != null && t != null && t <= w.endMs) lastDone[a.dealId] = Math.max(lastDone[a.dealId] || 0, t);
      if (owner !== 'all' && a.owner !== owner) return;
      if (t != null && inW(t)) { o.done++; o.doneByType[a.type] = (o.doneByType[a.type] || 0) + 1; }
      if (actDate(a) <= w.end && (t == null || t > w.endMs)) o.overdue++; // due by the end of the week, not done by then
    });
    deals.forEach(function (d) {
      if (inW(d.createdAt)) o.newDeals.push(d);
      d.history.forEach(function (h) {
        if (!h.from || !inW(h.at) || !STAGE[h.from] || !STAGE[h.to]) return;
        var e = { d: d, h: h };
        if (h.to === 'won') o.won.push(e);
        else if (h.to === 'lost') { o.lost.push(e); var r = d.stage === 'lost' && d.lostReason ? (LOST_REASONS.filter(function (x) { return d.lostReason.indexOf(x) === 0; })[0] || d.lostReason.split(' — ')[0]) : 'Reopened since'; o.reasons[r] = (o.reasons[r] || 0) + 1; }
        else if (!STAGE[h.from].open || STAGE[h.to].idx < STAGE[h.from].idx) o.backward.push(e);
        else o.forward.push(e);
      });
      (d.changes || []).forEach(function (c) {
        if (!inW(c.at)) return;
        if (c.field === 'value') o.valueCh.push({ d: d, c: c });
        else if (c.field === 'expectedClose') (c.to > c.from ? o.slipped : o.pulledIn).push({ d: d, c: c });
      });
      var st = stageAt(d, w.endMs);
      if (st && STAGE[st] && STAGE[st].open && d.createdAt < w.endMs - 14 * DAY && (!lastDone[d.id] || lastDone[d.id] < w.endMs - 14 * DAY)) o.stale.push(d);
    });
    o.wonValue = sum(o.won, function (e) { return dealValue(e.d); });
    o.newValue = sum(o.newDeals, dealValue);
    o.lostValue = sum(o.lost, function (e) { return dealValue(e.d); });
    o.valueDelta = sum(o.valueCh, function (x) { return (+x.c.to || 0) - (+x.c.from || 0); });
    return o;
  }
  function digestFocus(w, owner) {
    var soon = addDays(w.end, 14);
    return db.deals.filter(function (d) { return isOpen(d) && (owner === 'all' || d.owner === owner); }).map(function (d) {
      var sc = dealScore(d), closing = d.expectedClose && d.expectedClose > w.end && d.expectedClose <= soon, late = closeOverdue(d);
      var rank = sc.score + (closing ? 25 : 0) + (late ? 10 : 0) + Math.min(15, weighted(d) / 2000);
      var why = [closing ? 'closes ' + fmtDate(d.expectedClose) : late ? 'past its close date' : '', sc.reasons.filter(function (z) { return z.pts > 0; }).sort(function (a, b) { return b.pts - a.pts; }).slice(0, 1).map(function (z) { return z.label.toLowerCase(); })[0] || ''].filter(Boolean).join(' · ');
      return { d: d, sc: sc, rank: rank, why: why };
    }).sort(function (a, b) { return b.rank - a.rank; }).slice(0, 5);
  }
  function quotaAt(owner, w) {
    var t = w.end, mStart = t.slice(0, 8) + '01', mEnd = ymd(new Date(+t.slice(0, 4), +t.slice(5, 7), 0).getTime()), q = quarterOf(t);
    function won(r0, r1) { return sum(db.deals.filter(function (d) { return d.stage === 'won' && d.closedAt >= r0 && d.closedAt <= r1 && (owner === 'all' || d.owner === owner); }), dealValue); }
    function pace(s, e) { return Math.min(1, (daysBetween(s, t) + 1) / (daysBetween(s, e) + 1)); }
    return {
      month: { label: MON[+t.slice(5, 7) - 1] + ' ' + t.slice(0, 4), won: won(mStart, t), target: targetOf(owner, 'month'), pace: pace(mStart, mEnd) },
      quarter: { label: q.label, won: won(q.start, t), target: targetOf(owner, 'quarter'), pace: pace(q.start, q.end) }
    };
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function digestSentences(cur, prev, quota, who) {
    var s = [];
    var wonDiff = cur.won.length - prev.won.length;
    s.push((cur.won.length ? plural(cur.won.length, 'deal') + ' won worth ' + money(cur.wonValue) : 'No deals won') + (prev.won.length || cur.won.length ? ' (' + (wonDiff === 0 ? 'same as' : (wonDiff > 0 ? '+' : '−') + Math.abs(wonDiff) + ' vs') + ' the week before)' : '') +
      (cur.lost.length ? '; ' + plural(cur.lost.length, 'deal') + ' lost' + (Object.keys(cur.reasons).length ? ', most often “' + Object.keys(cur.reasons).sort(function (a, b) { return cur.reasons[b] - cur.reasons[a]; })[0] + '”' : '') : '') + '.');
    s.push(cur.newDeals.length ? plural(cur.newDeals.length, 'new deal') + ' added for ' + money(cur.newValue) + ' in total.' : 'No new deals were added.');
    s.push('The pipeline moved forward ' + plural(cur.forward.length, 'time') + (cur.backward.length ? ' and back ' + plural(cur.backward.length, 'time') : '') + '.');
    if (cur.slipped.length || cur.valueCh.length) s.push((cur.slipped.length ? plural(cur.slipped.length, 'close date') + ' slipped' : 'No close dates slipped') + (cur.valueCh.length ? '; deal values changed ' + plural(cur.valueCh.length, 'time') + ' (' + (cur.valueDelta >= 0 ? '+' : '−') + money(Math.abs(cur.valueDelta)) + ' net)' : '') + '.');
    s.push(plural(cur.done, 'activity', 'activities') + ' done (' + (cur.done >= prev.done ? '+' : '−') + Math.abs(cur.done - prev.done) + ' vs the week before), ' + cur.overdue + ' overdue at the end of the week' + (cur.stale.length ? '; ' + plural(cur.stale.length, 'open deal') + ' had no activity for 14+ days' : '') + '.');
    if (quota.quarter.target) {
      var p = quota.quarter.won / quota.quarter.target;
      s.push(who + ' is at ' + Math.round(p * 100) + '% of the ' + quota.quarter.label + ' target with ' + Math.round(quota.quarter.pace * 100) + '% of the quarter gone — ' + (p >= quota.quarter.pace ? 'ahead of pace.' : 'behind pace.'));
    }
    return s;
  }
  function deltaChip(cur, prev, goodUp) {
    var d = cur - prev;
    if (!d) return '<span class="muted">= prev. week</span>';
    var good = goodUp ? d > 0 : d < 0;
    return '<span class="' + (good ? 'good-t' : 'bad-t') + '">' + (d > 0 ? '+' : '−') + Math.abs(Math.round(d)) + ' vs prev. week</span>';
  }
  function dealLine(d, extra) {
    var c = company(d.companyId);
    return '<li><div class="main"><a href="#/deals/' + d.id + '">' + esc(d.title) + '</a><div class="meta"><span>' + esc(c ? c.name : '') + '</span><span>' + esc(ownerName(d.owner)) + '</span>' + (extra || '') + '</div></div><div class="end"><span class="num">' + esc(money(dealValue(d))) + '</span></div></li>';
  }
  function digestModel() {
    var w = digestWeek(ui.digest.offset), owner = ui.me, pw = digestWeek(ui.digest.offset - 1);
    var cur = digestData(w, owner), prev = digestData(pw, owner), quota = quotaAt(owner, w), focus = digestFocus(w, owner);
    var who = owner === 'all' ? 'The team' : ownerName(owner);
    return { w: w, pw: pw, owner: owner, cur: cur, prev: prev, quota: quota, focus: focus, who: who, sentences: digestSentences(cur, prev, quota, who) };
  }
  function viewDigest() {
    var m = digestModel(), cur = m.cur, prev = m.prev, w = m.w;
    function card(id, label, title, inner) { return '<section class="card" aria-labelledby="' + id + '"><div class="card-h"><div><span class="label">' + esc(label) + '</span><h2 id="' + id + '">' + esc(title) + '</h2></div></div>' + inner + '</section>'; }
    function list(items, fn, empty) { return items.length ? '<ul class="rows">' + items.map(fn).join('') + '</ul>' : '<div class="card-b"><div class="empty box">' + esc(empty) + '</div></div>'; }
    var kpis =
      '<div class="card kpi"><span class="label">Won</span><span class="v">' + cur.won.length + ' <span style="font-size:18px;color:var(--ink2)">' + esc(money(cur.wonValue)) + '</span></span><span class="s">' + deltaChip(cur.won.length, prev.won.length, true) + '</span></div>' +
      '<div class="card kpi"><span class="label">Lost</span><span class="v">' + cur.lost.length + '</span><span class="s">' + deltaChip(cur.lost.length, prev.lost.length, false) + '</span></div>' +
      '<div class="card kpi"><span class="label">New deals</span><span class="v">' + cur.newDeals.length + ' <span style="font-size:18px;color:var(--ink2)">' + esc(money(cur.newValue)) + '</span></span><span class="s">' + deltaChip(cur.newDeals.length, prev.newDeals.length, true) + '</span></div>' +
      '<div class="card kpi"><span class="label">Stage moves</span><span class="v">' + cur.forward.length + ' <span class="good-t" style="font-size:18px">↑</span> ' + cur.backward.length + ' <span class="bad-t" style="font-size:18px">↓</span></span><span class="s">' + deltaChip(cur.forward.length, prev.forward.length, true) + '</span></div>' +
      '<div class="card kpi"><span class="label">Activities done / overdue</span><span class="v">' + cur.done + ' <span style="color:var(--ink3)">/</span> <span class="' + (cur.overdue ? 'bad-t' : '') + '">' + cur.overdue + '</span></span><span class="s">' + deltaChip(cur.done, prev.done, true) + '</span></div>';
    var move = function (e) { return '<li><div class="main"><a href="#/deals/' + e.d.id + '">' + esc(e.d.title) + '</a><div class="meta"><span>' + esc(STAGE[e.h.from].name + ' → ' + STAGE[e.h.to].name) + '</span><span>' + esc(fmtStamp(e.h.at)) + '</span></div></div><div class="end">' + stageChip(e.h.to) + '</div></li>'; };
    var mailBody = digestText(m, 1600);
    return '<div class="noprint">' + head({
      eyebrow: 'Weekly digest · ' + (m.owner === 'all' ? 'all owners' : ownerName(m.owner)), title: 'Pipeline digest',
      sub: '<span>' + esc(w.label) + ' · compared with ' + esc(m.pw.short) + '</span>',
      actions: '<button type="button" class="btn" data-act="print">' + icon('download') + 'Print / PDF</button>' + btn('Copy as email', 'digest-copy', {}, '', 'note') +
        '<a class="btn pri" href="mailto:?subject=' + encodeURIComponent('Pipeline digest — ' + w.label) + '&body=' + encodeURIComponent(mailBody) + '" target="_blank" rel="noopener">' + icon('email') + 'Email…</a>'
    }) +
      '<div class="toolbar"><div class="weeknav"><button type="button" class="btn icon" id="dgPrev" data-act="digest-week" data-d="-1" aria-label="Previous week">' + icon('chevL') + '</button>' +
      '<span class="wk" aria-live="polite">' + esc(w.label) + '</span><button type="button" class="btn icon" id="dgNext" data-act="digest-week" data-d="1" aria-label="Next week"' + (ui.digest.offset >= 1 ? ' disabled' : '') + '>' + icon('chevR') + '</button>' +
      (ui.digest.offset !== 0 ? '<button type="button" class="btn sm" data-act="digest-week" data-d="0">Last full week</button>' : '') + '</div><span class="grow"></span>' + ownerFilter('dgOwner') + '</div></div>' +
      '<div class="print-only"><h1 style="font-size:26px">Pipeline digest · ' + esc(w.label) + '</h1><p class="sub">' + esc(m.owner === 'all' ? 'All owners' : ownerName(m.owner)) + ' · Adrial B2B CRM</p></div>' +
      '<section class="card digest-sum" aria-labelledby="hDgSum"><div class="card-h"><div><span class="label">' + esc(m.who) + ' · ' + esc(w.label) + '</span><h2 id="hDgSum">Summary</h2></div></div><ul class="sumlist">' + m.sentences.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></section>' +
      '<div class="kpis" style="margin-top:16px">' + kpis + '</div>' +
      '<div class="grid2 even">' +
      card('hDgWon', money(cur.wonValue) + ' won', 'Won', list(cur.won, function (e) { return dealLine(e.d, '<span>' + esc(fmtDate(ymd(e.h.at))) + '</span>'); }, 'No deals won this week.')) +
      card('hDgLost', Object.keys(cur.reasons).map(function (r) { return r + ' ×' + cur.reasons[r]; }).join(' · ') || 'Reasons', 'Lost', list(cur.lost, function (e) { return dealLine(e.d, '<span>' + esc(e.d.stage === 'lost' ? (e.d.lostReason || 'no reason') : 'reopened since') + '</span>'); }, 'No deals lost this week.')) +
      card('hDgNew', money(cur.newValue) + ' added', 'New deals', list(cur.newDeals, function (d) { return dealLine(d, '<span>' + esc(STAGE[d.history[0].to].name) + '</span>'); }, 'No new deals.')) +
      card('hDgMoves', cur.forward.length + ' forward · ' + cur.backward.length + ' back', 'Stage moves', list(cur.forward.concat(cur.backward).sort(function (a, b) { return a.h.at - b.h.at; }), move, 'No stage moves.')) +
      card('hDgChg', cur.slipped.length + ' slipped · ' + cur.pulledIn.length + ' pulled in · ' + cur.valueCh.length + ' value changes', 'Value & close-date changes',
        list(cur.slipped.concat(cur.pulledIn).concat(cur.valueCh).sort(function (a, b) { return a.c.at - b.c.at; }), function (x) {
          var t = x.c.field === 'value' ? money(x.c.from) + ' → ' + money(x.c.to) : 'close ' + fmtDate(x.c.from) + ' → ' + fmtDate(x.c.to);
          var bad = x.c.field === 'value' ? x.c.to < x.c.from : x.c.to > x.c.from;
          return dealLine(x.d, '<span class="' + (bad ? 'bad-t' : 'good-t') + '">' + esc(t) + '</span>');
        }, 'No value or close-date changes.')) +
      card('hDgStale', plural(cur.stale.length, 'deal') + ' · no activity for 14+ days', 'Gone stale', list(cur.stale.slice(0, 12), function (d) { return dealLine(d, '<span>' + esc(STAGE[d.stage] ? STAGE[d.stage].name : '') + '</span>'); }, 'Nothing stale — every open deal had activity in the last 14 days.') + (cur.stale.length > 12 ? '<p class="hint" style="margin:0;padding:0 20px 14px">+ ' + (cur.stale.length - 12) + ' more</p>' : '')) +
      card('hDgQuota', 'Won vs target as of ' + fmtDate(w.end), 'Quota progress', '<div class="card-b">' + targetBar(m.quota.month.label, m.quota.month.won, m.quota.month.target, m.quota.month.pace, 'dgQm') + targetBar(m.quota.quarter.label, m.quota.quarter.won, m.quota.quarter.target, m.quota.quarter.pace, 'dgQq') +
        '<p class="hint" style="margin:6px 0 0">Activities done: ' + ACT_TYPES.map(function (t) { return t.name + 's ' + (cur.doneByType[t.id] || 0); }).join(' · ') + '</p></div>') +
      card('hDgFocus', 'Highest score, closing soon or overdue', 'Focus next week', list(m.focus, function (x) { return '<li>' + scoreBadge(x.sc) + '<div class="main"><a href="#/deals/' + x.d.id + '">' + esc(x.d.title) + '</a><div class="meta"><span>' + esc((company(x.d.companyId) || {}).name || '') + '</span><span>' + esc(x.why) + '</span></div></div><div class="end">' + stageChip(x.d.stage) + '<span class="num">' + esc(moneyK(dealValue(x.d))) + '</span></div></li>'; }, 'No open deals.')) +
      '</div>';
  }
  function digestText(m, limit) {
    var L = [];
    L.push('Pipeline digest — ' + m.w.label + ' (' + (m.owner === 'all' ? 'all owners' : ownerName(m.owner)) + ')', '');
    m.sentences.forEach(function (s) { L.push('• ' + s); });
    L.push('', 'Won: ' + (m.cur.won.map(function (e) { return e.d.title + ' (' + money(dealValue(e.d)) + ')'; }).join('; ') || 'none'));
    L.push('Lost: ' + (m.cur.lost.map(function (e) { return e.d.title + (e.d.lostReason ? ' — ' + e.d.lostReason : ''); }).join('; ') || 'none'));
    L.push('', 'Focus next week:');
    m.focus.forEach(function (x, i) { L.push((i + 1) + '. ' + x.d.title + ' — ' + money(dealValue(x.d)) + ' · ' + STAGE[x.d.stage].name + (x.why ? ' · ' + x.why : '')); });
    var t = L.join('\n');
    return limit && t.length > limit ? t.slice(0, limit - 1) + '…' : t;
  }
  function digestHtml(m) {
    var h = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5">';
    h += '<h2 style="font-size:18px;margin:0 0 8px">Pipeline digest — ' + esc(m.w.label) + '</h2><p style="margin:0 0 10px">' + esc(m.owner === 'all' ? 'All owners' : ownerName(m.owner)) + '</p><ul>';
    m.sentences.forEach(function (s) { h += '<li>' + esc(s) + '</li>'; });
    h += '</ul><table cellpadding="6" style="border-collapse:collapse"><tr><th align="left">Won</th><th align="left">Lost</th><th align="left">New</th><th align="left">Forward / back</th><th align="left">Done / overdue</th></tr><tr>' +
      '<td>' + m.cur.won.length + ' · ' + esc(money(m.cur.wonValue)) + '</td><td>' + m.cur.lost.length + '</td><td>' + m.cur.newDeals.length + ' · ' + esc(money(m.cur.newValue)) + '</td><td>' + m.cur.forward.length + ' / ' + m.cur.backward.length + '</td><td>' + m.cur.done + ' / ' + m.cur.overdue + '</td></tr></table>';
    h += '<h3 style="font-size:15px;margin:14px 0 6px">Focus next week</h3><ol>';
    m.focus.forEach(function (x) { h += '<li><b>' + esc(x.d.title) + '</b> — ' + esc(money(dealValue(x.d))) + ' · ' + esc(STAGE[x.d.stage].name) + (x.why ? ' · ' + esc(x.why) : '') + '</li>'; });
    return h + '</ol></div>';
  }
  function copyDigest() {
    var m = digestModel(), text = digestText(m), html = digestHtml(m);
    var p;
    try {
      if (navigator.clipboard && navigator.clipboard.write && window.ClipboardItem) {
        p = navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([text], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) })]).then(function () { return 'both'; });
      }
    } catch (e) { p = null; }
    (p || Promise.reject()).catch(function () { return copyText(text).then(function (ok) { return ok ? 'text' : ''; }); }).then(function (r) {
      toast(r === 'both' ? 'Digest copied (formatted + plain text) — paste it into an email' : r === 'text' ? 'Digest copied as plain text' : 'Copy failed in this browser');
    });
  }

  // ── Cloud sync (AdrialSync) ──────────────────────────────────────────────────
  var crmSync = null, panelOff = null;
  function applyCloud(data) {
    if (!validDb(data)) return Promise.reject(new Error('The cloud copy is not valid CRM data.'));
    clearTimeout(saveTimer); dirty = false;
    return Promise.resolve(writing).then(function () {
      db = migrate(data); maps = null; scoreCache = null; dupCache = null;
      return idbPut(db).catch(function () { /* stays in memory */ });
    }).then(function () {
      if (bc) { try { bc.postMessage({ type: 'changed', from: TAB_ID }); } catch (e) { /* ignore */ } }
      updateNav(); refresh(); publishSoon(200);
      toast('CRM data loaded from the cloud');
    });
  }
  function attachSync() {
    if (!window.AdrialSync || crmSync) return;
    try {
      crmSync = window.AdrialSync.attach({
        app: 'crm', label: 'CRM data',
        getSnapshot: function () { return Promise.resolve(writing).then(function () { return db; }); },
        applySnapshot: applyCloud
      });
    } catch (e) { crmSync = null; }
    var side = $('#syncSide'); if (crmSync && side) crmSync.mountPanel(side);
  }
  function mountSyncPanel() {
    if (panelOff) { try { panelOff(); } catch (e) { /* ignore */ } panelOff = null; }
    var el = $('#syncPanel');
    if (el && crmSync) panelOff = crmSync.mountPanel(el);
    else if (el) el.innerHTML = '<p class="hint" style="margin:0">Cloud sync is not available on this page.</p>';
  }

  Object.assign(ACT, {
    'tpl-new': function () { templateEditor(null); },
    'tpl-edit': function (t) { var x = db.templates.find(function (y) { return y.id === +t.dataset.id; }); if (x) templateEditor(x); },
    'tpl-dup': function (t) {
      var x = db.templates.find(function (y) { return y.id === +t.dataset.id; }); if (!x) return;
      var now = Date.now();
      db.templates.push({ id: ++db.seq.template, key: null, name: x.name + ' (copy)', category: x.category, owner: x.owner, subject: x.subject, body: x.body, uses: 0, lastUsedAt: null, createdAt: now, updatedAt: now });
      commit(); toast('Template duplicated');
    },
    'tpl-del': function (t) { var x = db.templates.find(function (y) { return y.id === +t.dataset.id; }); if (x) deleteTemplate(x); },
    'tpl-restore': function () { restoreTemplates(); },
    'digest-week': function (t) { var d = +t.dataset.d; ui.digest.offset = d === 0 ? 0 : Math.min(1, ui.digest.offset + d); refresh(); },
    'digest-copy': function () { copyDigest(); }
  });

  // ── Boot ──────────────────────────────────────────────────────────────────
  $('#meSel').innerHTML = ownerOpts(ui.me, true);
  Promise.all([loadDb(), busLoad()]).then(function (r) {
    db = migrate(r[0]); maps = null;
    if (templatesSeeded) { templatesSeeded = false; save(); }
    updateNav();
    route(false);
    busSync(); publishSoon(400);
    attachSync(); mountSyncPanel();
  }, function () {
    db = migrate(D.generate(Date.now())); maps = null; templatesSeeded = false;
    toast('Changes could not be saved in this browser (storage blocked or full). They last until you reload.'); saveWarned = true;
    updateNav(); route(false);
  });
})();
