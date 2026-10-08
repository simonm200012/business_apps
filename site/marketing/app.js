/* Marketing calendar — Adrial Apps. Vanilla JS, hash routing.
 * Two separate PLANS, never mixed:
 *   demo — the fictional demo plan (IndexedDB "adrial-marketing" store "kv" key "data"); its daily performance is
 *          derived (MKTDATA.perfFor), never stored.
 *   live — the team's own plan for approved accounts (same store, key "live"); starts empty. Planned campaigns can be
 *          linked to real Google Ads / Meta campaigns (keys "platform|market|campaign_key" stored on the campaign).
 * Live ad numbers come from /api/marketing/* (see C:\hub\marketing.js) and are kept in memory only — never in
 * IndexedDB, localStorage or the sync snapshot. Cloud sync (AdrialSync app "marketing") uploads ONE snapshot
 * { version: 2, demo: <demo plan>, live: <live plan> } — both plans, clearly separated; a version-1 snapshot (demo
 * plan only, from before live mode) is still accepted and leaves the live plan untouched.
 * Attached creatives live in store "files" keyed by sha256 (shared by both plans), other tabs hear about saves through
 * BroadcastChannel "adrial-marketing", and small view preferences sit in localStorage "adrial-marketing-ui" (+ the
 * chosen mode in "adrial-marketing-mode"). Nothing is ever posted, sent or published to any ad, social, e-mail or SMS
 * service: the only network calls are /api/sync, /api/marketing (read-only GETs) and fonts. */
(function () {
  'use strict';

  var D = window.MKTDATA;
  if (!D) return;
  var MARKETS = D.MARKETS, CHANNELS = D.CHANNELS, TYPES = D.TYPES, STATUSES = D.STATUSES, CHECKLIST = D.CHECKLIST, TEAM = D.TEAM,
    STORES = D.STORES, GROUPS = D.GROUPS, CSTATUSES = D.CONTENT_STATUSES, CCHANNELS = D.CONTENT_CHANNELS, ALL_SPLIT = D.ALL_SPLIT;
  function index(arr) { var m = {}; arr.forEach(function (x) { m[x.id] = x; }); return m; }
  var MK = index(MARKETS), CH = index(CHANNELS), TY = index(TYPES), ST = index(STATUSES), TM = index(TEAM), STORE = index(STORES),
    GR = index(GROUPS), CST = index(CSTATUSES), CCH = index(CCHANNELS);
  var OWNERS = TEAM.filter(function (t) { return t.owner; });
  var MKT3 = ['SI', 'HR', 'IT'];
  var dnum = D.dnum, ymdOf = D.ymdOf, dow = D.dow, ymParts = D.ymParts, dmake = D.dmake;
  var TODAY_YMD = D.todayLj(), TODAY = dnum(TODAY_YMD);

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  // ── Text, numbers, dates (sl-SI formats, Europe/Ljubljana "today") ───────
  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return ESC[c]; }); }
  function norm(s) { return String(s || '').replace(/[Đđ]/g, 'dj').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
  function matchQ(q, hay) { var t = norm(q).trim().split(/\s+/).filter(Boolean); if (!t.length) return true; var h = norm(hay); return t.every(function (x) { return h.indexOf(x) >= 0; }); }
  var NF0 = new Intl.NumberFormat('sl-SI', { maximumFractionDigits: 0 });
  var NF1 = new Intl.NumberFormat('sl-SI', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  var NF2 = new Intl.NumberFormat('sl-SI', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var EUR0 = new Intl.NumberFormat('sl-SI', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 0 });
  var EUR2 = new Intl.NumberFormat('sl-SI', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var DTF = new Intl.DateTimeFormat('sl-SI', { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'UTC' });
  var DTF_S = new Intl.DateTimeFormat('sl-SI', { day: 'numeric', month: 'numeric', timeZone: 'UTC' });
  var DTF_TS = new Intl.DateTimeFormat('sl-SI', { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Ljubljana' });
  function int(v) { return NF0.format(Math.round(v || 0)); }
  function money(v) { return EUR0.format(Math.round(v || 0)); }
  function money2(v) { return EUR2.format(v || 0); }
  function moneyK(v) {
    v = v || 0; var a = Math.abs(v);
    if (a >= 1e6) return NF1.format(v / 1e6) + ' M €';
    if (a >= 1e4) return NF0.format(v / 1e3) + 'k €';
    if (a >= 1e3) return NF1.format(v / 1e3) + 'k €';
    return NF0.format(v) + ' €';
  }
  function pct(v, dec) { return v == null || !isFinite(v) ? '—' : (dec === 0 ? NF0 : dec === 2 ? NF2 : NF1).format(v * 100) + ' %'; }
  function ratio(v) { return v == null || !isFinite(v) ? '—' : NF2.format(v); }
  function eurOr(v, dec) { return v == null || !isFinite(v) ? '—' : dec ? money2(v) : money(v); }
  function fmtD(n) { if (typeof n === 'string') n = dnum(n); return DTF.format(new Date(n * 864e5)); }
  function fmtDs(n) { if (typeof n === 'string') n = dnum(n); return DTF_S.format(new Date(n * 864e5)); }
  function fmtRange(a, b) {
    if (typeof a === 'string') a = dnum(a); if (typeof b === 'string') b = dnum(b);
    if (a === b) return fmtD(a);
    return (ymParts(a).y === ymParts(b).y ? fmtDs(a) : fmtD(a)) + ' – ' + fmtD(b);
  }
  function fmtTs(ms) { return ms ? DTF_TS.format(new Date(ms)) : '—'; }
  var MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  var WDL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  function dayLabel(n) { var p = ymParts(n); return WDL[dow(n)] + ', ' + fmtD(n); }
  function relDays(n) { var k = n - TODAY; if (k === 0) return 'today'; if (k === 1) return 'tomorrow'; if (k === -1) return 'yesterday'; return k > 0 ? 'in ' + k + ' days' : -k + ' days ago'; }
  function validYmd(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s) && ymdOf(dnum(s)) === s; }
  function sum(arr, f) { var s = 0; for (var i = 0; i < arr.length; i++) s += f(arr[i]); return s; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function isoWeek(n) { var d = new Date(n * 864e5); d.setUTCDate(d.getUTCDate() + 3 - (d.getUTCDay() + 6) % 7); var w1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4)); return 1 + Math.round(((d - w1) / 864e5 - 3 + (w1.getUTCDay() + 6) % 7) / 7); }
  function monthStart(n) { var p = ymParts(n); return dmake(p.y, p.m, 1); }
  function addMonths(n, k) { var p = ymParts(n); return dmake(p.y, p.m + k, 1); }
  function quarterStart(n) { var p = ymParts(n); return dmake(p.y, Math.floor((p.m - 1) / 3) * 3 + 1, 1); }

  // ── Icons ─────────────────────────────────────────────────────────────────
  var ICONS = {
    plus: '<path d="M12 5v14M5 12h14"/>', edit: '<path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/>', trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    download: '<path d="M12 4v12M6 10l6 6 6-6M5 20h14"/>', upload: '<path d="M12 20V8M6 14l6-6 6 6M5 4h14"/>', cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    chevL: '<path d="M15 6l-6 6 6 6"/>', chevR: '<path d="M9 6l6 6-6 6"/>', close: '<path d="M6 6l12 12M18 6L6 18"/>', check: '<path d="M5 12l5 5L20 7"/>',
    warn: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.5"/>', link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    repeat: '<path d="M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4"/>', file: '<path d="M6 3h8l4 4v14H6zM14 3v4h4"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.5"/>', grip: '<circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/>',
    ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'
  };
  function icon(n, cls) { return '<svg class="' + (cls || 'ic') + '" viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[n] || '') + '</svg>'; }
  function warnIc(title) { return '<span class="warnic" title="' + esc(title || 'Conflict') + '">' + icon('warn') + '</span>'; }

  // ── Storage (IndexedDB) ───────────────────────────────────────────────────
  var IDB_NAME = 'adrial-marketing', UIKEY = 'adrial-marketing-ui', VER = 1;
  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function validDb(d) { return !!(d && d.version === VER && Array.isArray(d.campaigns) && Array.isArray(d.content) && d.seq && d.budgets && typeof d.budgets === 'object'); }

  var idbP = null;
  function idbOpen() {
    if (idbP) return idbP;
    idbP = new Promise(function (resolve) {
      var req;
      try { if (!window.indexedDB) { resolve(null); return; } req = window.indexedDB.open(IDB_NAME, 1); } catch (e) { resolve(null); return; }
      req.onupgradeneeded = function () { var d = req.result; if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv'); if (!d.objectStoreNames.contains('files')) d.createObjectStore('files'); };
      req.onsuccess = function () { var d = req.result; d.onversionchange = function () { d.close(); idbP = null; }; resolve(d); };
      req.onerror = function () { resolve(null); };
      req.onblocked = function () { resolve(null); };
    });
    return idbP;
  }
  function idbTx(store, mode, fn) {
    return idbOpen().then(function (d) {
      if (!d) throw new Error('IndexedDB unavailable');
      return new Promise(function (resolve, reject) {
        var tx, r, out;
        try { tx = d.transaction(store, mode); r = fn(tx.objectStore(store)); } catch (e) { reject(e); return; }
        if (r) r.onsuccess = function () { out = r.result; };
        tx.oncomplete = function () { resolve(out); };
        tx.onerror = tx.onabort = function () { reject(tx.error || new Error('IndexedDB transaction failed')); };
      });
    });
  }
  var IDBK = { demo: 'data', live: 'live' };            // one IndexedDB key per plan: the two never share a record
  function idbGet(k) { return idbTx('kv', 'readonly', function (st) { return st.get(IDBK[k || 'demo']); }); }
  function idbPut(v, k) { return idbTx('kv', 'readwrite', function (st) { return st.put(v, IDBK[k || 'demo']); }); }
  function fileGet(hash) { return idbTx('files', 'readonly', function (st) { return st.get(hash); }); }
  function filePut(hash, rec) { return idbTx('files', 'readwrite', function (st) { return st.put(rec, hash); }); }
  function fileDel(hash) { return idbTx('files', 'readwrite', function (st) { return st.delete(hash); }); }
  function fileKeys() { return idbTx('files', 'readonly', function (st) { return st.getAllKeys(); }); }
  function fileClear() { return idbTx('files', 'readwrite', function (st) { return st.clear(); }); }

  // `db` is the plan on screen; `plans` holds both. MODE says which one `db` is.
  var db = null, dataRev = 0, saveWarned = false, MODE = 'demo', plans = { demo: null, live: null };
  var dirty = false, dirtyKeys = {}, writing = null, saveTimer = null, silentNext = false;
  var TAB_ID = Math.random().toString(36).slice(2);
  var bc = null;
  try { if ('BroadcastChannel' in window) bc = new BroadcastChannel('adrial-marketing'); } catch (e) { bc = null; }
  function save() { dataRev++; dirty = true; dirtyKeys[MODE] = true; clearTimeout(saveTimer); saveTimer = setTimeout(flush, 250); }
  function flush() {
    saveTimer = null;
    if (writing) return writing;
    var keys = Object.keys(dirtyKeys).filter(function (k) { return dirtyKeys[k] && plans[k]; });
    if (!dirty || !keys.length) { dirty = false; dirtyKeys = {}; return Promise.resolve(true); }
    dirty = false; dirtyKeys = {};
    var silent = silentNext; silentNext = false;
    writing = Promise.all(keys.map(function (k) { return idbPut(plans[k], k); })).then(function () { return true; }, function () { return false; }).then(function (ok) {
      writing = null;
      if (!ok && !saveWarned) { saveWarned = true; toast('Changes could not be saved in this browser (storage blocked or full). They last until you reload.'); }
      if (ok) syncPending = false;
      if (ok && !silent && sync) sync.changed();
      if (ok && bc) { try { bc.postMessage({ type: 'changed', from: TAB_ID }); } catch (e) { /* ignore */ } }
      return dirty ? flush() : ok;
    });
    return writing;
  }
  function flushNow() { clearTimeout(saveTimer); return flush(); }
  window.addEventListener('pagehide', function () { if (dirty) flushNow(); });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden' && dirty) flushNow(); });

  var syncPending = false;
  function syncFromIdb() {
    if (!db) return;
    if (dirty || writing || stack.length || drag) { syncPending = true; return; }
    syncPending = false;
    Promise.all([idbGet('demo'), idbGet('live')]).then(function (r) {
      if (!validDb(r[0]) && !validDb(r[1])) return;
      if (dirty || writing || stack.length || drag) { syncPending = true; return; }
      if (validDb(r[0])) plans.demo = migrate(r[0]);
      if (validDb(r[1])) plans.live = migrate(r[1]);
      if (plans[MODE]) db = plans[MODE];
      perfCache.clear(); dataRev++; updateNav(); refresh();
    }, function () { /* ignore */ });
  }
  if (bc) bc.onmessage = function (e) { var m = e.data || {}; if (m.type === 'changed' && m.from !== TAB_ID) syncFromIdb(); };

  function migrate(d) {
    d.campaigns.forEach(function (c) {
      c.channels = Array.isArray(c.channels) ? c.channels.filter(function (x) { return CH[x]; }) : [];
      ['tags', 'stores', 'comments', 'files', 'utms', 'content'].forEach(function (k) { if (!Array.isArray(c[k])) c[k] = []; });
      if (!c.checklist || typeof c.checklist !== 'object') c.checklist = {};
      if (!c.targets || typeof c.targets !== 'object') c.targets = { roas: 0, revenue: 0, orders: 0, cpa: 0 };
      if (typeof c.seed !== 'number') c.seed = D.strHash(String(c.id) + c.name) >>> 0;
      c.budget = +c.budget || 0;
      // links to real ad campaigns: [{ k: 'platform|market|campaign_key', n: name as shown when linked }] (live plan only)
      var seen = {};
      c.links = (Array.isArray(c.links) ? c.links : []).filter(function (l) {
        if (!l || typeof l.k !== 'string' || !LINK_RE.test(l.k) || l.k.length > 300 || seen[l.k]) return false;
        seen[l.k] = 1; l.n = String(l.n || keyParts(l.k).ck).slice(0, 300); return true;
      }).slice(0, 50);
    });
    if (!d.seq.comment) d.seq.comment = 1000;
    if (!d.seq.utm) d.seq.utm = 1;
    if (!d.lbudget || typeof d.lbudget !== 'object') d.lbudget = {};
    return d;
  }
  var LINK_RE = /^(Google|Meta)\|(IT|HR|SI)\|.+$/;
  function keyParts(k) { var i = k.indexOf('|'), j = k.indexOf('|', i + 1); return { platform: k.slice(0, i), market: k.slice(i + 1, j), ck: k.slice(j + 1) }; }
  // the live plan starts EMPTY: nothing from the demo generator ever lands in it
  function emptyLivePlan() {
    return { version: VER, kind: 'live', generatedFor: TODAY_YMD, range: { from: '2025-01-01', to: ymdOf(D.lastOfMonth(ymParts(TODAY).y + 1, 12)) },
      seq: { campaign: 0, content: 0, comment: 1000, utm: 1 }, campaigns: [], content: [], budgets: {}, lbudget: {} };
  }
  function loadPlans() {
    function get(k) { return idbGet(k).then(function (d) { return validDb(d) ? d : null; }, function () { return null; }); }
    return Promise.all([get('demo'), get('live')]).then(function (r) {
      plans.live = r[1] ? migrate(r[1]) : emptyLivePlan();
      if (r[0]) { plans.demo = migrate(r[0]); return; }
      plans.demo = migrate(D.generate(TODAY_YMD));
      dirty = true; dirtyKeys.demo = true; silentNext = true; // a freshly generated demo set is not a change worth uploading
      return flushNow();
    });
  }
  function commit(noRefresh) { save(); updateNav(); if (!noRefresh) refresh(); }

  // ── UI preferences (localStorage, small) ──────────────────────────────────
  var UIDEF = {
    f: { market: '', channel: '', owner: '', status: '', type: '' },
    cal: { view: 'month', cursor: TODAY_YMD, color: 'channel', kd: 'key', ads: true },
    list: { q: '', sort: 'start', dir: -1, show: 50 },
    content: { view: 'board', period: 'upcoming', market: '', channel: '', assignee: '', q: '' },
    perf: { period: '90d', market: '', channel: '', tab: 'market', rank: 'roas' },
    budget: { year: TODAY_YMD.slice(0, 4) },
    lperf: { period: '90d', market: '', platform: '', area: '', tab: 'market', rank: 'roas', min: 300 },
    lbudget: { year: TODAY_YMD.slice(0, 4), market: 'SI' },
    utm:{ cid: '', base: '', ch: '', source: '', medium: '', campaign: '', content: '', term: '' }
  };
  var ui = (function () {
    var u = {}; try { u = JSON.parse(lsGet(UIKEY) || '{}') || {}; } catch (e) { u = {}; }
    var out = {};
    Object.keys(UIDEF).forEach(function (k) { out[k] = Object.assign({}, UIDEF[k], u[k] && typeof u[k] === 'object' ? u[k] : {}); });
    if (!validYmd(out.cal.cursor)) out.cal.cursor = TODAY_YMD;
    out.list.show = 50;
    return out;
  })();
  var uiTimer = null;
  function saveUi() { clearTimeout(uiTimer); uiTimer = setTimeout(function () { lsSet(UIKEY, JSON.stringify(ui)); }, 200); }

  // ── Lookups ───────────────────────────────────────────────────────────────
  function camp(id) { id = +id; for (var i = 0; i < db.campaigns.length; i++) if (db.campaigns[i].id === id) return db.campaigns[i]; return null; }
  function post(id) { id = +id; for (var i = 0; i < db.content.length; i++) if (db.content[i].id === id) return db.content[i]; return null; }
  function person(id) {
    if (TM[id]) return TM[id];
    if (!id) return { id: '', name: 'Unassigned', initials: '–', tone: 'grey', email: '' };
    var s = String(id), nm = s.replace(/@.*/, ''), parts = nm.split(/[._-]+/).filter(Boolean);
    return { id: s, name: s, initials: ((parts[0] || '?')[0] + (parts[1] ? parts[1][0] : '')).toUpperCase(), tone: 'grey', email: s.indexOf('@') > 0 ? s : '' };
  }
  // demo mode uses the fictional demo team; the live plan uses real accounts (the signed-in person + whoever is already in the plan)
  function peopleList(ownersOnly) {
    if (MODE === 'demo') return ownersOnly ? OWNERS : TEAM;
    var me = myIdentity().email, seen = {}, out = [];
    function add(id) { if (id && !seen[id] && !TM[id]) { seen[id] = 1; out.push({ id: id, name: id }); } }
    add(me);
    db.campaigns.forEach(function (c) { add(c.owner); });
    db.content.forEach(function (p) { add(p.assignee); });
    return out;
  }
  function defaultPerson(demoId) { return MODE === 'demo' ? demoId : myIdentity().email || ''; }
  function av(id) { var p = person(id); return '<span class="av tone-' + p.tone + '" title="' + esc(p.name) + '" aria-hidden="true">' + esc(p.initials) + '</span>'; }
  function whoHtml(id) { var p = person(id); return '<span class="who">' + av(id) + '<span>' + esc(p.name) + '</span></span>'; }
  function mktChip(m) { var x = MK[m] || MK.ALL; return '<span class="chip tone tone-' + x.tone + '" title="' + esc(x.name) + '"><span class="d"></span>' + esc(x.short) + '</span>'; }
  function statusChip(s) { var x = ST[s] || ST.idea; return '<span class="chip tone tone-' + x.tone + '"><span class="d"></span>' + esc(x.name) + '</span>'; }
  function cstatusChip(s) { var x = CST[s] || CST.brief; return '<span class="chip tone tone-' + x.tone + '"><span class="d"></span>' + esc(x.name) + '</span>'; }
  function chChip(id) { var c = CH[id]; if (!c) return ''; return '<span class="chip tone tone-' + GR[c.group].tone + '" title="' + esc(c.name) + '">' + esc(c.short) + '</span>'; }
  function chChips(list, max) {
    max = max || 3; var out = list.slice(0, max).map(chChip).join('');
    if (list.length > max) out += '<span class="chip" title="' + esc(list.slice(max).map(function (x) { return CH[x] ? CH[x].name : x; }).join(', ')) + '">+' + (list.length - max) + '</span>';
    return '<span class="chips">' + out + '</span>';
  }
  function primaryGroup(c) { var ch = CH[c.channels[0]]; return ch ? ch.group : 'organic'; }
  function toneOf(c) { return ui.cal.color === 'market' ? (MK[c.market] || MK.ALL).tone : GR[primaryGroup(c)].tone; }
  function campLink(c) { return '<a class="t1" href="#/c/' + c.id + '">' + esc(c.name) + '</a>'; }
  function opts(list, sel, blank) { return (blank != null ? '<option value="">' + esc(blank) + '</option>' : '') + list.map(function (x) { return '<option value="' + esc(x.id) + '"' + (String(x.id) === String(sel) ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join(''); }
  function checklistDone(c) { return CHECKLIST.filter(function (it) { return c.checklist[it.id]; }).length; }

  // ── Performance (derived) ─────────────────────────────────────────────────
  var perfCache = new Map();
  function perfSig(c) { return [c.status, c.start, c.end, c.budget, c.channels.join(','), c.market, c.type, c.seed, c.stores.length].join('|'); }
  function zero() { return { imp: 0, clk: 0, sp: 0, ses: 0, ord: 0, rev: 0, nc: 0 }; }
  function addRow(a, r) { a.imp += r.imp; a.clk += r.clk; a.sp += r.sp; a.ses += r.ses; a.ord += r.ord; a.rev += r.rev; a.nc += r.nc; return a; }
  function derive(a) {
    a.ctr = a.imp ? a.clk / a.imp : null; a.cpc = a.clk ? a.sp / a.clk : null; a.cpa = a.ord && a.sp ? a.sp / a.ord : null;
    a.roas = a.sp ? a.rev / a.sp : null; a.cvr = a.ses ? a.ord / a.ses : null; return a;
  }
  function perf(c) {
    if (MODE === 'live') return livePerf(c); // real numbers for linked ad campaigns (in memory), never the demo generator
    var s = perfSig(c), e = perfCache.get(c.id);
    if (!e || e.sig !== s) { var rows = D.perfFor(c, TODAY); var a = zero(); rows.forEach(function (r) { addRow(a, r); }); e = { sig: s, rows: rows, agg: derive(a) }; perfCache.set(c.id, e); }
    return e;
  }
  function aggRows(rows, from, to, ch) {
    var a = zero();
    for (var i = 0; i < rows.length; i++) { var r = rows[i]; if (r.d < from || r.d > to) continue; if (ch && r.ch !== ch) continue; addRow(a, r); }
    return derive(a);
  }
  // market totals per day (baseline + incremental share of campaign revenue) for the "vs 4 weeks before" view
  var mtCache = { rev: -1 };
  function marketTotals() {
    if (mtCache.rev === dataRev) return mtCache;
    var from = dnum(db.range.from), to = TODAY - 1, n = Math.max(0, to - from + 1), out = { rev: dataRev, from: from, to: to };
    MKT3.forEach(function (m) { var a = new Float64Array(n); for (var i = 0; i < n; i++) a[i] = D.baselineRevenue(m, from + i); out[m] = a; });
    db.campaigns.forEach(function (c) {
      perf(c).rows.forEach(function (r) {
        var i = r.d - from; if (i < 0 || i >= n || !r.rev) return;
        if (c.market === 'ALL') MKT3.forEach(function (m) { out[m][i] += r.rev * 0.7 * ALL_SPLIT[m]; });
        else if (out[c.market]) out[c.market][i] += r.rev * 0.7;
      });
    });
    mtCache = out; return out;
  }
  function incremental(c) {
    var mt = marketTotals(), s = dnum(c.start), e = Math.min(dnum(c.end), mt.to);
    if (e < s) return null;
    var ms = c.market === 'ALL' ? MKT3 : [c.market];
    function avg(a, b) { a = Math.max(a, mt.from); b = Math.min(b, mt.to); if (b < a) return null; var t = 0; for (var d = a; d <= b; d++) ms.forEach(function (m) { t += mt[m][d - mt.from]; }); return { v: t / (b - a + 1), n: b - a + 1 }; }
    var dur = avg(s, e), pre = avg(s - 28, s - 1);
    if (!dur || !pre || pre.n < 14) return null;
    return { days: dur.n, during: dur.v, before: pre.v, incr: (dur.v - pre.v) * dur.n, lift: pre.v ? dur.v / pre.v - 1 : null };
  }

  // ── Conflicts ─────────────────────────────────────────────────────────────
  var cfCache = { rev: -1, map: null };
  function mOverlap(a, b) { return a === b || a === 'ALL' || b === 'ALL'; }
  function conflicts() {
    if (cfCache.rev === dataRev) return cfCache.map;
    var map = {}, list = db.campaigns.filter(function (c) { return c.status !== 'cancelled'; });
    function add(c, x) { (map[c.id] = map[c.id] || []).push(x); }
    for (var i = 0; i < list.length; i++) for (var j = i + 1; j < list.length; j++) {
      var a = list[i], b = list[j];
      if (!mOverlap(a.market, b.market) || a.start > b.end || b.start > a.end) continue;
      var ta = TY[a.type] || {}, tb = TY[b.type] || {};
      var from = a.start > b.start ? a.start : b.start, to = a.end < b.end ? a.end : b.end, when = fmtRange(from, to);
      if (ta.big && tb.big) {
        add(a, { kind: 'big', other: b.id, text: 'Overlaps “' + b.name + '” (' + when + ') — two big promotions in ' + (a.market === 'ALL' ? b.market : a.market) });
        add(b, { kind: 'big', other: a.id, text: 'Overlaps “' + a.name + '” (' + when + ') — two big promotions in ' + (b.market === 'ALL' ? a.market : b.market) });
      } else if (ta.sale && a.code && b.code && !tb.big) {
        add(b, { kind: 'stack', other: a.id, text: 'Code ' + b.code + ' runs during the sale “' + a.name + '” (' + when + ') — discounts may stack' });
        add(a, { kind: 'stack', other: b.id, text: 'Code ' + b.code + ' from “' + b.name + '” can stack on this sale (' + when + ')' });
      } else if (tb.sale && b.code && a.code && !ta.big) {
        add(a, { kind: 'stack', other: b.id, text: 'Code ' + a.code + ' runs during the sale “' + b.name + '” (' + when + ') — discounts may stack' });
        add(b, { kind: 'stack', other: a.id, text: 'Code ' + a.code + ' from “' + a.name + '” can stack on this sale (' + when + ')' });
      }
    }
    cfCache = { rev: dataRev, map: map };
    return map;
  }
  function conflictsOf(c) { return conflicts()[c.id] || []; }
  function upcomingConflictIds() { var m = conflicts(); return db.campaigns.filter(function (c) { return m[c.id] && c.end >= TODAY_YMD && c.status !== 'cancelled'; }).map(function (c) { return c.id; }); }

  // ── Filters ───────────────────────────────────────────────────────────────
  function passF(c, f, keepCancelled) {
    f = f || ui.f;
    if (f.market && !(c.market === f.market || (c.market === 'ALL' && f.market !== 'ALL'))) return false;
    if (f.channel && c.channels.indexOf(f.channel) < 0) return false;
    if (f.owner && c.owner !== f.owner) return false;
    if (f.type && c.type !== f.type) return false;
    if (f.status) { if (c.status !== f.status) return false; }
    else if (!keepCancelled && c.status === 'cancelled') return false;
    return true;
  }
  function filtersActive() { var f = ui.f; return !!(f.market || f.channel || f.owner || f.status || f.type); }
  function filterBar(id) {
    var f = ui.f;
    return '<div class="filters" role="group" aria-label="Filters">' +
      '<label class="sr" for="' + id + 'm">Market</label><select class="select" id="' + id + 'm" data-chg="f" data-k="market">' + opts(MARKETS.map(function (m) { return { id: m.id, name: m.id === 'ALL' ? 'Cross-market only' : m.name }; }), f.market, 'All markets') + '</select>' +
      '<label class="sr" for="' + id + 'c">Channel</label><select class="select" id="' + id + 'c" data-chg="f" data-k="channel">' + opts(CHANNELS, f.channel, 'All channels') + '</select>' +
      '<label class="sr" for="' + id + 'o">Owner</label><select class="select" id="' + id + 'o" data-chg="f" data-k="owner">' + opts(peopleList(true), f.owner, 'All owners') + '</select>' +
      '<label class="sr" for="' + id + 's">Status</label><select class="select" id="' + id + 's" data-chg="f" data-k="status">' + opts(STATUSES, f.status, 'Any status') + '</select>' +
      '<label class="sr" for="' + id + 't">Type</label><select class="select" id="' + id + 't" data-chg="f" data-k="type">' + opts(TYPES, f.type, 'All types') + '</select>' +
      (filtersActive() ? '<button type="button" class="btn sm ghost" data-act="clear-f">Clear filters</button>' : '') + '</div>';
  }

  // ── Toast ─────────────────────────────────────────────────────────────────
  var toastTimer = null;
  function toast(msg, action) {
    var t = $('#toast'); if (!t) return;
    t.innerHTML = '<span>' + esc(msg) + '</span>' + (action ? '<button type="button">' + esc(action.label) + '</button>' : '');
    if (action) t.querySelector('button').onclick = function () { t.classList.remove('on'); action.run(); };
    t.classList.add('on');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('on'); }, action ? 7000 : 3400);
  }

  // ── Layers: modals, popover ───────────────────────────────────────────────
  var stack = [], pop = null, modalSeq = 0;
  var FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),iframe,[tabindex]:not([tabindex="-1"])';
  function openModal(o) {
    closePop(false);
    var id = 'md' + (++modalSeq), layer = $('#layer'), prev = document.activeElement;
    var scrim = document.createElement('div'); scrim.className = 'scrim';
    var m = document.createElement('div');
    m.className = 'modal' + (o.cls ? ' ' + o.cls : '');
    m.setAttribute('role', o.role || 'dialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-labelledby', id + 't');
    var tag = o.onSubmit ? 'form' : 'div';
    m.innerHTML = '<div class="md-head"><h2 id="' + id + 't">' + esc(o.title) + '</h2><button type="button" class="btn icon ghost" data-close aria-label="Close">' + icon('close') + '</button></div>' +
      '<' + tag + ' class="md-body" id="' + id + 'b"' + (o.onSubmit ? ' novalidate' : '') + '>' + o.body + '</' + tag + '>' +
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
  function closeAllModals() { while (stack.length) stack[stack.length - 1].close(true); }
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
    p.style.top = Math.round(Math.min(r.bottom + 6, window.innerHeight - p.offsetHeight - 8)) + 'px';
    p.style.right = Math.max(8, Math.round(window.innerWidth - r.right)) + 'px';
    anchor.setAttribute('aria-expanded', 'true');
    pop = { el: p, anchor: anchor };
    p.addEventListener('click', function (e) { var b = e.target.closest('[data-i]'); if (!b) return; closePop(false); items[+b.dataset.i].run(); });
    p.addEventListener('keydown', function (e) {
      var bs = $$('button', p), i = bs.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); bs[(i + 1) % bs.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); bs[(i - 1 + bs.length) % bs.length].focus(); }
      else if (e.key === 'Tab') closePop(false);
    });
    p.querySelector('button').focus();
  }
  function closePop(refocus) { if (!pop) return; pop.el.remove(); pop.anchor.setAttribute('aria-expanded', 'false'); if (refocus) pop.anchor.focus(); pop = null; }
  document.addEventListener('mousedown', function (e) { if (pop && !pop.el.contains(e.target) && !pop.anchor.contains(e.target)) closePop(false); });

  // ── Sidebar (narrow screens) ──────────────────────────────────────────────
  function openSide() { $('#side').classList.add('open'); $('#sideScrim').hidden = false; $('#menuBtn').setAttribute('aria-expanded', 'true'); var a = $('#side .nav a'); if (a) a.focus(); }
  function closeSide(refocus) { var s = $('#side'); if (!s.classList.contains('open')) return; s.classList.remove('open'); $('#sideScrim').hidden = true; $('#menuBtn').setAttribute('aria-expanded', 'false'); if (refocus) $('#menuBtn').focus(); }

  // ── Router ────────────────────────────────────────────────────────────────
  var current = { parts: [] };
  function parseHash() { var h = (location.hash || '').replace(/^#\/?/, '').split('?')[0]; return { parts: h.split('/').filter(Boolean).map(decodeURIComponent) }; }
  function route(focus) {
    closeSide(false); closeAllModals(); closePop(false); endDrag(true);
    current = parseHash();
    render();
    window.scrollTo(0, 0);
    if (focus !== false) { var h = $('#main h1'); if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); } }
  }
  var afterHooks = [];
  function render() {
    var p = current.parts, a = p[0] || 'calendar', b = p[1], html, nav = a;
    afterHooks = [];
    switch (a) {
      case 'calendar': html = viewCalendar(); break;
      case 'campaigns': html = viewCampaigns(); break;
      case 'c': html = viewCampaign(camp(b)); nav = 'campaigns'; break;
      case 'content': html = viewContent(); break;
      case 'performance': html = MODE === 'live' ? viewLivePerformance() : viewPerformance(); break;
      case 'budget': html = MODE === 'live' ? viewLiveBudget() : viewBudget(); break;
      case 'utm': html = viewUtm(b); break;
      default: html = viewMissing('Page not found', 'This address does not exist in the marketing calendar.');
    }
    $('#main').innerHTML = '<div class="page">' + html + '</div>';
    $$('#side .nav a').forEach(function (l) { if (l.dataset.nav === nav) l.setAttribute('aria-current', 'page'); else l.removeAttribute('aria-current'); });
    var cc = a === 'c' ? camp(b) : null;
    document.title = (cc ? cc.name + ' · Marketing' : TITLES[nav] || 'Marketing calendar') + ' — Adrial Apps';
    afterHooks.forEach(function (fn) { try { fn(); } catch (e) { console.error(e); } });
  }
  var TITLES = { calendar: 'Marketing calendar', campaigns: 'Campaigns · Marketing', content: 'Content planner · Marketing', performance: 'Performance · Marketing', budget: 'Budget · Marketing', utm: 'UTM builder · Marketing' };
  function after(fn) { afterHooks.push(fn); }
  function refresh() {
    if (drag) return;
    var main = $('#main'), ae = document.activeElement, id = null, sel = null, ss = null, se = null;
    if (ae && main.contains(ae)) {
      if (ae.id) id = ae.id;
      else if (ae.dataset && ae.dataset.cid && ae.classList.contains('bar')) sel = '.bar[data-cid="' + ae.dataset.cid + '"]';
      try { if (typeof ae.selectionStart === 'number') { ss = ae.selectionStart; se = ae.selectionEnd; } } catch (e) { ss = null; }
    }
    var sy = window.scrollY, scrollers = $$('.gantt,.board,.tablewrap').map(function (x) { return x.scrollLeft; });
    render();
    window.scrollTo(0, sy);
    $$('.gantt,.board,.tablewrap').forEach(function (x, i) { if (scrollers[i] != null) x.scrollLeft = scrollers[i]; });
    var el = id ? document.getElementById(id) : sel ? $(sel) : null;
    if (el) { el.focus({ preventScroll: true }); if (ss != null && typeof el.setSelectionRange === 'function') { try { el.setSelectionRange(ss, se); } catch (e) { /* ignore */ } } }
  }
  function viewMissing(t, s) { return '<div class="head"><div><a class="crumb" href="#/">' + icon('chevL') + 'Calendar</a><h1>' + esc(t) + '</h1><p class="sub">' + esc(s) + '</p></div></div>'; }
  function head(crumb, title, sub, actions) {
    return '<div class="head"><div>' + (crumb ? '<span class="crumb">' + crumb + '</span>' : '') + '<h1>' + title + '</h1>' + (sub ? '<p class="sub">' + sub + '</p>' : '') + '</div>' + (actions ? '<div class="actions">' + actions + '</div>' : '') + '</div>';
  }
  function updateNav() {
    if (!db) return;
    var cf = upcomingConflictIds().length, cnt = db.campaigns.filter(function (c) { return c.status === 'live'; }).length;
    var n1 = $('#navConflicts'); n1.textContent = cf ? cf + ' ⚠' : ''; n1.className = 'cnt' + (cf ? ' bad' : ''); n1.title = cf ? cf + ' upcoming or live campaigns with conflicts' : '';
    $('#navCampaigns').textContent = cnt ? cnt + ' live' : '';
    var todo = db.content.filter(function (p) { return p.status !== 'published' && p.date >= TODAY_YMD && p.date <= ymdOf(TODAY + 7); }).length;
    var nc = $('#navContent'); nc.textContent = todo ? String(todo) : ''; nc.title = todo ? todo + ' posts in the next 7 days are not published yet' : '';
    var w = (MODE === 'live' ? liveBudgetWarnings(ymParts(TODAY).y, '', true) : budgetWarnings(ymParts(TODAY).y)).filter(function (x) { return x.level === 'bad'; }).length;
    var nb = $('#navBudget'); nb.textContent = w ? w + ' ⚠' : ''; nb.className = 'cnt' + (w ? ' bad' : '');
  }

  // ── CSV / ICS / downloads ─────────────────────────────────────────────────
  function csvCell(v) {
    var s = v == null ? '' : String(v);
    if (/^[=@]/.test(s) || /^[+\-]/.test(s) && !/^[+\-]?[\d\s().]+$/.test(s)) s = "'" + s;
    return /[",;\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function saveBlob(blob, name) {
    try {
      var url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      return true;
    } catch (e) { toast('Download failed in this browser.'); return false; }
  }
  function downloadCsv(name, rows) {
    var csv = '\ufeff' + rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
    if (saveBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), name)) toast('Exported ' + (rows.length - 1) + ' rows · ' + name);
  }
  function n2(v) { return v == null || !isFinite(v) ? '' : (Math.round(v * 100) / 100).toFixed(2); }
  function n4(v) { return v == null || !isFinite(v) ? '' : v.toFixed(4); }
  function icsEscape(s) { return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }
  function icsFold(line) { var out = [], s = line; while (s.length > 73) { out.push(s.slice(0, 73)); s = ' ' + s.slice(73); } out.push(s); return out.join('\r\n'); }
  function downloadIcs(list, name) {
    var stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    var demo = MODE === 'demo';
    var L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Adrial Apps//Marketing calendar' + (demo ? ' demo' : '') + '//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Marketing calendar' + (demo ? ' (demo)' : ''), 'X-WR-TIMEZONE:Europe/Ljubljana'];
    list.forEach(function (c) {
      L.push('BEGIN:VEVENT', 'UID:campaign-' + c.id + '-' + c.seed + '@marketing.adrial-apps.' + (demo ? 'demo' : 'live'), 'DTSTAMP:' + stamp,
        'DTSTART;VALUE=DATE:' + c.start.replace(/-/g, ''), 'DTEND;VALUE=DATE:' + ymdOf(dnum(c.end) + 1).replace(/-/g, ''),
        'SUMMARY:' + icsEscape(c.name), 'CATEGORIES:' + icsEscape((TY[c.type] || {}).name || c.type) + ',' + c.market,
        'STATUS:' + (c.status === 'cancelled' ? 'CANCELLED' : c.status === 'idea' ? 'TENTATIVE' : 'CONFIRMED'),
        'DESCRIPTION:' + icsEscape(['Market: ' + (MK[c.market] || MK.ALL).name, 'Status: ' + (ST[c.status] || {}).name, 'Channels: ' + c.channels.map(function (x) { return CH[x].name; }).join(', '), 'Owner: ' + person(c.owner).name, 'Budget: ' + money(c.budget), c.offer ? 'Offer: ' + c.offer : '', c.code ? 'Code: ' + c.code : '', demo ? 'Demo data — fictional.' : ''].filter(Boolean).join('\n')),
        c.url ? 'URL:' + c.url : '', 'END:VEVENT');
    });
    L.push('END:VCALENDAR');
    var txt = L.filter(Boolean).map(icsFold).join('\r\n') + '\r\n';
    if (saveBlob(new Blob([txt], { type: 'text/calendar;charset=utf-8' }), name)) toast('Exported ' + list.length + ' campaigns to ' + name);
  }
  function copyText(text) {
    return (navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(text).then(function () { return true; }) : Promise.reject()).catch(function () {
      try { var t = document.createElement('textarea'); t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0'; document.body.appendChild(t); t.select(); var ok = document.execCommand('copy'); t.remove(); return ok; } catch (e) { return false; }
    });
  }

  // ══ Calendar ══════════════════════════════════════════════════════════════
  function calRange() {
    var cur = dnum(ui.cal.cursor), v = ui.cal.view;
    if (v === 'week') { var w0 = cur - dow(cur); return { from: w0, to: w0 + 6, title: 'Week ' + isoWeek(w0) + ' · ' + fmtRange(w0, w0 + 6) }; }
    if (v === 'quarter') { var q0 = quarterStart(cur), q1 = addMonths(q0, 3) - 1, p = ymParts(q0); return { from: q0, to: q1, title: 'Q' + ((p.m - 1) / 3 + 1) + ' ' + p.y + ' · ' + MON3[p.m - 1] + '–' + MON3[p.m + 1] }; }
    var m0 = monthStart(cur), m1 = addMonths(m0, 1) - 1, pm = ymParts(m0);
    return { from: m0 - dow(m0), to: m1 + (6 - dow(m1)), m0: m0, m1: m1, title: MON[pm.m - 1] + ' ' + pm.y };
  }
  function calCampaigns(from, to) {
    return db.campaigns.filter(function (c) { return passF(c) && dnum(c.start) <= to && dnum(c.end) >= from; })
      .sort(function (a, b) { return lanePrio(a) - lanePrio(b) || (a.start < b.start ? -1 : a.start > b.start ? 1 : (dnum(b.end) - dnum(b.start)) - (dnum(a.end) - dnum(a.start)) || a.id - b.id); });
  }
  // big promotions claim the top lanes; always-on newsletters go last so they never hide a promotion
  function lanePrio(c) { return (TY[c.type] || {}).big ? 0 : c.type === 'newsletter' ? 2 : 1; }
  function kdFor(from, to, kinds) {
    var f = ui.f.market;
    return D.keyDates(from, to).filter(function (k) {
      if (kinds.indexOf(k.kind) < 0) return false;
      if (!f || f === 'ALL') return true;
      return k.market === f || k.market === 'ALL';
    });
  }
  function kdKinds() { return ui.cal.kd === 'off' ? [] : ui.cal.kd === 'all' ? ['holiday', 'commerce', 'school', 'season'] : ['holiday', 'commerce']; }
  // merges the same holiday across markets: "SI/HR/IT · Christmas"
  function kdDayLabels(list, d) {
    var by = {}, order = [];
    list.forEach(function (k) { if (k.d !== d || k.e !== k.d) return; var key = k.name.replace(/ \((SI|HR|IT)[^)]*\)$/, ''); if (!by[key]) { by[key] = { name: key, kind: k.kind, m: [] }; order.push(key); } by[key].m.push(k.market); });
    return order.map(function (key) { var x = by[key]; return { kind: x.kind, text: (x.m.indexOf('ALL') >= 0 ? '' : x.m.join('/') + ' · ') + x.name, title: (x.m.indexOf('ALL') >= 0 ? 'All markets' : x.m.join(', ')) + ': ' + x.name }; });
  }
  function barLabel(c) { var cf = conflictsOf(c).length; return c.name + ', ' + (MK[c.market] || MK.ALL).name + ', ' + fmtRange(c.start, c.end) + ', ' + (ST[c.status] || {}).name + (cf ? ', ' + cf + ' conflict' + (cf > 1 ? 's' : '') : ''); }
  function barHtml(c, segFrom, segTo, style, extraCls) {
    var s = dnum(c.start), e = dnum(c.end), cf = conflictsOf(c);
    var cls = 'bar tone-' + toneOf(c) + ' st-' + c.status + (s < segFrom ? ' cl' : '') + (e > segTo ? ' cr' : '') + (cf.length ? ' conflict' : '') + (extraCls ? ' ' + extraCls : '');
    return '<button type="button" class="' + cls + '" data-cid="' + c.id + '" style="' + style + '" aria-label="' + esc(barLabel(c)) + '" aria-describedby="calHint" title="' + esc(c.name + ' · ' + fmtRange(c.start, c.end) + (cf.length ? '\n⚠ ' + cf.map(function (x) { return x.text; }).join('\n⚠ ') : '')) + '">' +
      (s >= segFrom ? '<span class="hd l" data-h="start" aria-hidden="true"></span>' : '') +
      '<span class="nm">' + esc(c.name) + '</span>' + (cf.length ? warnIc() : '') +
      (e <= segTo ? '<span class="hd r" data-h="end" aria-hidden="true"></span>' : '') + '</button>';
  }
  function laneAssign(items, from, to) {
    var lanes = [];
    items.forEach(function (it) {
      var s = Math.max(it.s, from), e = Math.min(it.e, to), l = 0;
      while (lanes[l] && lanes[l].some(function (x) { return !(e < x[0] || s > x[1]); })) l++;
      (lanes[l] = lanes[l] || []).push([s, e]); it.lane = l;
    });
    return lanes.length;
  }
  function weekRow(w0, o) {
    var w1 = w0 + 6, kinds = kdKinds(), kd = kdFor(w0, w1, kinds), html = '';
    for (var i = 0; i < 7; i++) {
      var d = w0 + i, out = o.m0 != null && (d < o.m0 || d > o.m1);
      html += '<div class="bg' + (i >= 5 ? ' weekend' : '') + (out ? ' out' : '') + '" style="grid-column:' + (i + 1) + '" data-day="' + d + '"></div>';
    }
    for (var j = 0; j < 7; j++) {
      var dd = w0 + j, outj = o.m0 != null && (dd < o.m0 || dd > o.m1), labels = kdDayLabels(kd, dd), p = ymParts(dd);
      var maxL = o.full ? 9 : 2;
      html += '<div class="dh' + (outj ? ' out' : '') + (dd === TODAY ? ' today' : '') + '" style="grid-column:' + (j + 1) + '">' +
        '<button type="button" class="dn" data-act="day" data-day="' + dd + '" aria-label="' + esc(dayLabel(dd) + (labels.length ? ' — ' + labels.map(function (l) { return l.text; }).join('; ') : '') + '. Open day') + '">' + (p.d === 1 && !o.full ? MON3[p.m - 1] + ' ' : '') + p.d + '</button>' +
        labels.slice(0, maxL).map(function (l) { return '<span class="kd ' + l.kind + '" title="' + esc(l.title) + '">' + esc(l.text) + '</span>'; }).join('') +
        (labels.length > maxL ? '<span class="kd" title="' + esc(labels.slice(maxL).map(function (l) { return l.text; }).join('\n')) + '">+' + (labels.length - maxL) + ' more</span>' : '') + '</div>';
    }
    // range context (school holidays, seasons)
    var ctx = kd.filter(function (k) { return k.e !== k.d; }).map(function (k) { return { k: k, s: k.d, e: k.e }; });
    var ctxLanes = laneAssign(ctx, w0, w1);
    ctx.forEach(function (x) {
      var s = Math.max(x.s, w0), e = Math.min(x.e, w1);
      html += '<div class="ctx ' + x.k.kind + '" style="grid-row:' + (2 + x.lane) + ';grid-column:' + (s - w0 + 1) + ' / ' + (e - w0 + 2) + '" title="' + esc((x.k.market === 'ALL' ? 'All markets' : x.k.market) + ': ' + x.k.name + ' (' + fmtRange(x.k.d, x.k.e) + ')') + '">' + esc((x.k.market === 'ALL' ? '' : x.k.market + ' · ') + x.k.name) + '</div>';
    });
    var items = o.list.filter(function (c) { return dnum(c.start) <= w1 && dnum(c.end) >= w0; }).map(function (c) { return { c: c, s: dnum(c.start), e: dnum(c.end) }; });
    var nLanes = laneAssign(items, w0, w1);
    var max = o.maxLanes, hidden = [0, 0, 0, 0, 0, 0, 0], row0 = 2 + ctxLanes;
    items.forEach(function (it) {
      var s = Math.max(it.s, w0), e = Math.min(it.e, w1);
      if (it.lane >= max) { for (var d = s; d <= e; d++) hidden[d - w0]++; return; }
      html += barHtml(it.c, w0, w1, 'grid-row:' + (row0 + it.lane) + ';grid-column:' + (s - w0 + 1) + ' / ' + (e - w0 + 2));
    });
    hidden.forEach(function (n, i) { if (n) html += '<button type="button" class="bar-more" data-act="day" data-day="' + (w0 + i) + '" style="grid-row:' + (row0 + max) + ';grid-column:' + (i + 1) + '" aria-label="' + n + ' more campaigns on ' + esc(dayLabel(w0 + i)) + '">+' + n + '<span class="mm"> more</span></button>'; });
    // live mode: real ad campaigns as thin bars below the plan (always-on ones are grouped in the strip above the grid)
    if (o.ads) {
      var arow = row0 + Math.min(nLanes, max) + (hidden.some(Boolean) ? 1 : 0), amax = o.adLanes, ahidden = [0, 0, 0, 0, 0, 0, 0];
      var aitems = o.ads.filter(function (a) { return a.s <= w1 && a.e >= w0; }).map(function (a) { return { a: a, s: a.s, e: a.e }; });
      laneAssign(aitems, w0, w1);
      aitems.forEach(function (it) {
        var s = Math.max(it.s, w0), e = Math.min(it.e, w1);
        if (it.lane >= amax) { for (var d = s; d <= e; d++) ahidden[d - w0]++; return; }
        html += adBarHtml(it.a, w0, w1, 'grid-row:' + (arow + it.lane) + ';grid-column:' + (s - w0 + 1) + ' / ' + (e - w0 + 2));
      });
      ahidden.forEach(function (n, i) { if (n) html += '<button type="button" class="ad-more" data-act="ads-day" data-day="' + (w0 + i) + '" style="grid-row:' + (arow + amax) + ';grid-column:' + (i + 1) + '" aria-label="' + n + ' more ad campaigns on ' + esc(dayLabel(w0 + i)) + '">+' + n + '<span class="mm"> ads</span></button>'; });
    }
    return '<div class="wk" data-w0="' + w0 + '">' + html + '</div>';
  }
  function monthHtml(r, list, ads) {
    var mw = ($('#main') || {}).clientWidth || window.innerWidth, max = mw && mw < 600 ? 3 : 6, out = '<div class="wkdays" aria-hidden="true">' + WD.map(function (w) { return '<div>' + w + '</div>'; }).join('') + '</div><div class="weeks" data-view="month">';
    for (var w = r.from; w <= r.to; w += 7) out += weekRow(w, { m0: r.m0, m1: r.m1, list: list, maxLanes: max, ads: ads, adLanes: mw && mw < 600 ? 2 : 3 });
    return out + '</div>';
  }
  function weekHtml(r, list, ads) {
    var out = '<div class="wkdays" aria-hidden="true">' + WD.map(function (w, i) { return '<div>' + w + ' ' + fmtDs(r.from + i) + '</div>'; }).join('') + '</div><div class="weeks" data-view="week">' + weekRow(r.from, { list: list, maxLanes: 99, full: true, ads: ads, adLanes: 10 }) + '</div>';
    var f = ui.f.market;
    out += '<div class="weekposts">';
    for (var i = 0; i < 7; i++) {
      var d = r.from + i, ds = ymdOf(d);
      var ps = db.content.filter(function (p) { return p.date === ds && (!f || p.market === f || p.market === 'ALL'); }).sort(function (a, b) { return a.time < b.time ? -1 : 1; });
      out += '<div><h3>' + WD[i] + ' · ' + ps.length + ' post' + (ps.length === 1 ? '' : 's') + '</h3>' + ps.map(postMini).join('') +
        '<button type="button" class="btn sm ghost" data-act="post-new" data-date="' + ds + '">' + icon('plus') + 'Post</button></div>';
    }
    return out + '</div>';
  }
  function postMini(p) {
    var ch = CCH[p.channel] || CCH.instagram;
    return '<button type="button" class="post tone-' + (CST[p.status] || CST.brief).tone + '" data-act="post-edit" data-id="' + p.id + '"><b>' + esc(p.title) + '</b><small>' + esc(p.time + ' · ' + ch.name + ' · ' + p.market + ' · ' + (CST[p.status] || {}).name) + '</small></button>';
  }
  function ganttHtml(r, list, ads) {
    var narrow = window.innerWidth < 640, px = narrow ? 10 : 14, labw = narrow ? 130 : 240, days = r.to - r.from + 1, W = days * px;
    var kd = kdFor(r.from, r.to, kdKinds()), f = ui.f.market;
    var head = '<div class="g-months">', d, p;
    for (d = r.from; d <= r.to; d = addMonths(d, 1)) { p = ymParts(d); head += '<span style="left:' + (d - r.from) * px + 'px;width:' + (Math.min(addMonths(d, 1), r.to + 1) - d) * px + 'px">' + MON[p.m - 1] + ' ' + p.y + '</span>'; }
    head += '</div><div class="g-days" aria-hidden="true">';
    for (d = r.from; d <= r.to; d++) { if (narrow && dow(d) !== 0) continue; if (!narrow && px < 14 && dow(d) !== 0) continue; head += '<span class="' + (d === TODAY ? 'today' : '') + '" style="left:' + (d - r.from) * px + 'px;width:' + px + 'px">' + ymParts(d).d + '</span>'; }
    head += '</div><div class="g-kd">';
    kd.forEach(function (k) {
      if (k.e !== k.d) head += '<i class="' + k.kind + '" style="left:' + (Math.max(k.d, r.from) - r.from) * px + 'px;width:' + (Math.min(k.e, r.to) - Math.max(k.d, r.from) + 1) * px + 'px" title="' + esc((k.market === 'ALL' ? 'All markets' : k.market) + ': ' + k.name + ' (' + fmtRange(k.d, k.e) + ')') + '"></i>';
      else head += '<i class="' + k.kind + '" style="left:' + ((k.d - r.from) * px + px / 2) + 'px" title="' + esc(fmtD(k.d) + ' · ' + (k.market === 'ALL' ? 'All markets' : k.market) + ': ' + k.name) + '"></i>';
    });
    head += '</div>';
    var cols = '';
    for (d = r.from; d <= r.to; d++) {
      if (dow(d) >= 5) cols += '<i class="we" style="left:' + (d - r.from) * px + 'px;width:' + px + 'px"></i>';
      if (ymParts(d).d === 1 && d !== r.from) cols += '<i class="ms" style="left:' + (d - r.from) * px + 'px"></i>';
    }
    if (f && f !== 'ALL') kd.forEach(function (k) { if (k.kind === 'holiday') cols += '<i class="hol" style="left:' + (k.d - r.from) * px + 'px;width:' + px + 'px" title="' + esc(k.name) + '"></i>'; });
    if (TODAY >= r.from && TODAY <= r.to) cols += '<i class="now" style="left:' + ((TODAY - r.from) * px + px / 2) + 'px" title="Today"></i>';
    // group rows by the colour key
    var groups = ui.cal.color === 'market' ? MARKETS.map(function (m) { return { id: m.id, name: m.name, tone: m.tone, test: function (c) { return c.market === m.id; } }; })
      : GROUPS.map(function (g) { return { id: g.id, name: g.name, tone: g.tone, test: function (c) { return primaryGroup(c) === g.id; } }; });
    var rows = '';
    groups.forEach(function (g) {
      var gl = list.filter(g.test).sort(function (a, b) { return a.start < b.start ? -1 : a.start > b.start ? 1 : a.id - b.id; }); if (!gl.length) return;
      rows += '<div class="g-row g-grp"><div class="g-lab">' + esc(g.name) + ' · ' + gl.length + '</div><div class="g-track" style="width:' + W + 'px"></div></div>';
      gl.forEach(function (c) {
        var s = Math.max(dnum(c.start), r.from), e = Math.min(dnum(c.end), r.to);
        rows += '<div class="g-row" data-cid="' + c.id + '"><div class="g-lab"><span class="sdot tone-' + toneOf(c) + '"></span><a href="#/c/' + c.id + '" title="' + esc(c.name) + '">' + esc(c.name) + '</a>' + (conflictsOf(c).length ? warnIc(conflictsOf(c)[0].text) : '') + '</div>' +
          '<div class="g-track" style="width:' + W + 'px">' + barHtml(c, r.from, r.to, 'left:' + (s - r.from) * px + 'px;width:' + Math.max(px, (e - s + 1) * px - 2) + 'px', 'g-bar').replace('<span class="nm">' + esc(c.name) + '</span>', '<span class="nm">' + esc(fmtRange(c.start, c.end) + ' · ' + c.market) + '</span>') + '</div></div>';
      });
    });
    if (!rows) rows = '<div class="empty">No campaigns in this quarter match the filters.</div>';
    if (ads && (ads.bars.length || ads.alwaysList.length)) {
      var top = ads.bars.slice().sort(function (a, b) { return b.row.spend - a.row.spend; }), shown = top.slice(0, 60);
      rows += '<div class="g-row g-grp"><div class="g-lab">Ad activity · ' + (ads.bars.length + ads.alwaysList.length) + ' real campaigns</div><div class="g-track" style="width:' + W + 'px"></div></div>';
      ads.always.forEach(function (g) {
        var s = Math.max(g.s, r.from), e = Math.min(g.e, r.to);
        rows += '<div class="g-row"><div class="g-lab"><button type="button" class="g-adlab" data-act="ads-always" data-m="' + g.market + '">' + esc('Always-on · ' + g.market + ' · ' + g.list.length) + '</button></div><div class="g-track" style="width:' + W + 'px">' +
          '<button type="button" class="adbar g-adbar aon" data-act="ads-always" data-m="' + g.market + '" style="left:' + (s - r.from) * px + 'px;width:' + Math.max(px, (e - s + 1) * px - 2) + 'px" aria-label="' + esc(alwaysLabel(g)) + '" title="' + esc(alwaysLabel(g)) + '"><span class="nm">' + esc(alwaysLabel(g)) + '</span></button></div></div>';
      });
      shown.forEach(function (a) {
        var s = Math.max(a.s, r.from), e = Math.min(a.e, r.to);
        rows += '<div class="g-row"><div class="g-lab"><span class="sdot ' + platTone(a.row.platform) + '"></span><button type="button" class="g-adlab" data-act="ad-open" data-k="' + esc(a.k) + '" title="' + esc(a.row.campaign) + '">' + esc(a.row.campaign) + '</button></div><div class="g-track" style="width:' + W + 'px">' +
          adBarHtml(a, r.from, r.to, 'left:' + (s - r.from) * px + 'px;width:' + Math.max(px, (e - s + 1) * px - 2) + 'px', 'g-adbar') + '</div></div>';
      });
      if (top.length > shown.length) rows += '<div class="g-row"><div class="g-lab"><button type="button" class="btn sm ghost" data-act="ads-rest">+' + (top.length - shown.length) + ' smaller ad campaigns</button></div><div class="g-track" style="width:' + W + 'px"></div></div>';
    }
    return '<div class="gantt" style="--labw:' + labw + 'px"><div class="g-inner weeks" data-view="quarter" data-from="' + r.from + '" data-px="' + px + '" data-labw="' + labw + '" style="width:' + (labw + W) + 'px">' +
      '<div class="g-head"><div class="g-lab" style="align-items:flex-end"><span class="label">Campaign</span></div><div class="g-track" style="width:' + W + 'px">' + head + '</div></div>' +
      '<div style="position:relative"><div class="g-cols" style="left:' + labw + 'px;width:' + W + 'px">' + cols + '</div>' + rows + '</div></div></div>';
  }

  function viewCalendar() {
    var r = calRange(), list = calCampaigns(r.from, r.to), v = ui.cal.view;
    var visFrom = r.m0 != null ? r.m0 : r.from, visTo = r.m1 != null ? r.m1 : r.to;
    var inView = list.filter(function (c) { return dnum(c.start) <= visTo && dnum(c.end) >= visFrom; }).sort(function (a, b) { return a.start < b.start ? -1 : a.start > b.start ? 1 : a.id - b.id; });
    var cfIn = inView.filter(function (c) { return conflictsOf(c).length; });
    var meta = liveCache.get('meta'), ads = null;
    if (MODE === 'live' && ui.cal.ads) ads = liveReady() ? adLayer(r.from, r.to) : { status: meta && meta.status === 'error' ? 'error' : 'loading', err: meta && meta.err };
    var okAds = ads && ads.status === 'ok' && !ads.future ? ads : null;
    var body = v === 'week' ? weekHtml(r, list, okAds && okAds.bars) : v === 'quarter' ? ganttHtml(r, list, okAds) : monthHtml(r, list, okAds && okAds.bars);
    var legend = ui.cal.color === 'market' ? MARKETS.map(function (m) { return '<span><i class="sw tone-' + m.tone + '"></i>' + esc(m.name) + '</span>'; }).join('') : GROUPS.map(function (g) { return '<span><i class="sw tone-' + g.tone + '"></i>' + esc(g.name) + '</span>'; }).join('');
    var kdList = kdFor(visFrom, visTo, ['holiday', 'commerce', 'school', 'season']);
    var html = head('Plan', 'Calendar<span class="dot">.</span>',
      '<span><b>' + inView.length + '</b> campaign' + (inView.length === 1 ? '' : 's') + ' in view</span>' + (cfIn.length ? '<span class="bad-t">' + warnIc() + ' <b class="bad-t">' + cfIn.length + '</b> with conflicts</span>' : '') + '<span>Today: ' + fmtD(TODAY) + '</span>',
      '<button type="button" class="btn" data-act="ics-view">' + icon('cal') + 'Export .ics</button><button type="button" class="btn pri" data-act="new-campaign">' + icon('plus') + 'New campaign</button>');
    if (MODE === 'live' && !db.campaigns.length) html += '<div class="banner info" role="note">' + icon('info') + '<div><b style="font-weight:500">Your live plan is empty.</b> Nothing from the demo is mixed in here. Plan campaigns with “New campaign”, turn on “Ad activity” to see what actually ran, or start from real data: <button type="button" class="btn sm" data-act="import-ads" style="margin-left:4px">Import ad campaigns as a starting plan</button></div></div>';
    html += '<div class="card">' +
      '<div class="calbar"><div class="calnav"><button type="button" class="btn icon sm" data-act="cal-step" data-d="-1" aria-label="Previous ' + v + '">' + icon('chevL') + '</button>' +
      '<button type="button" class="btn sm" data-act="cal-today">Today</button><button type="button" class="btn icon sm" data-act="cal-step" data-d="1" aria-label="Next ' + v + '">' + icon('chevR') + '</button>' +
      '<h2 class="caltitle" aria-live="polite">' + esc(r.title) + '</h2></div>' +
      '<div class="calnav"><div class="seg" role="group" aria-label="View">' + ['month', 'week', 'quarter'].map(function (x) { return '<button type="button" data-act="cal-view" data-v="' + x + '" aria-pressed="' + (v === x) + '">' + (x === 'quarter' ? 'Quarter' : x.charAt(0).toUpperCase() + x.slice(1)) + '</button>'; }).join('') + '</div>' +
      '<div class="seg" role="group" aria-label="Colour by">' + [['channel', 'By channel'], ['market', 'By market']].map(function (x) { return '<button type="button" data-act="cal-color" data-v="' + x[0] + '" aria-pressed="' + (ui.cal.color === x[0]) + '">' + x[1] + '</button>'; }).join('') + '</div>' +
      '<label class="sr" for="calKd">Key dates</label><select class="select sm" id="calKd" data-chg="cal-kd"><option value="key"' + (ui.cal.kd === 'key' ? ' selected' : '') + '>Holidays &amp; retail days</option><option value="all"' + (ui.cal.kd === 'all' ? ' selected' : '') + '>+ school holidays &amp; seasons</option><option value="off"' + (ui.cal.kd === 'off' ? ' selected' : '') + '>Hide key dates</option></select>' +
      (MODE === 'live' ? '<button type="button" class="btn sm adtoggle" data-act="cal-ads" aria-pressed="' + !!ui.cal.ads + '" title="Show real Google Ads and Meta campaigns from the ad data">' + icon('chart') + 'Ad activity</button>' : '') + '</div></div>' +
      '<div class="calbar" style="padding-top:10px;padding-bottom:10px">' + filterBar('cf') + '</div>' +
      '<p class="calhint" id="calHint"><span>Drag a bar to move it; drag its ends to change dates.</span><span>Keyboard: focus a bar, ← / → moves it a day, Shift + ← / → changes the end date, Enter opens it.</span></p>' +
      (ads ? adStripHtml(ads, v === 'quarter') : '') +
      body + '<div class="legendrow"><span class="label">Colour</span>' + legend + '<span class="label" style="margin-left:8px">Status</span><span>dashed = idea</span><span>faded = done</span><span><span class="sdot" style="--c:var(--good-dot)"></span> live</span><span class="bad-t">' + warnIc() + ' conflict</span>' +
      (okAds ? '<span class="label" style="margin-left:8px">Ad activity</span><span><i class="adsw tone-blue"></i>Google Ads</span><span><i class="adsw tone-violet"></i>Meta</span><span>thin bar = first to last day with spend</span>' : '') + '</div></div>';
    // lists below
    html += '<div class="gap"></div><div class="grid2"><div class="card"><div class="card-h"><div><span class="label">' + esc(r.title) + '</span><h2>Campaigns in view</h2></div></div>' +
      (inView.length ? '<ul class="rows">' + inView.map(function (c) {
        var cf = conflictsOf(c);
        return '<li' + (cf.length ? ' class="warn"' : '') + '><span class="sdot tone-' + toneOf(c) + '" style="width:9px;height:9px"></span><div class="main"><a href="#/c/' + c.id + '">' + esc(c.name) + '</a><div class="meta"><span>' + fmtRange(c.start, c.end) + '</span><span>' + esc((TY[c.type] || {}).name) + '</span><span>' + esc(person(c.owner).name) + '</span>' + (c.code ? '<span class="mono">' + esc(c.code) + '</span>' : '') + '</div>' +
          (cf.length ? '<div class="meta bad-t">' + cf.slice(0, 2).map(function (x) { return '<span>' + warnIc() + ' ' + esc(x.text) + '</span>'; }).join('') + (cf.length > 2 ? '<span>+' + (cf.length - 2) + ' more</span>' : '') + '</div>' : '') +
          '</div><div class="end">' + mktChip(c.market) + statusChip(c.status) + '</div></li>';
      }).join('') + '</ul>' : '<div class="card-b"><div class="empty box"><b>Nothing planned here</b>No campaigns match the filters in this period. <button type="button" class="btn sm" data-act="new-campaign" style="margin-top:8px">' + icon('plus') + 'Plan one</button></div></div>') + '</div>' +
      '<div class="card"><div class="card-h"><div><span class="label">' + (ui.f.market && ui.f.market !== 'ALL' ? esc(MK[ui.f.market].name) : 'SI · HR · IT') + '</span><h2>Key dates in view</h2></div></div>' +
      (kdList.length ? '<ul class="rows">' + kdList.map(function (k) { var p = ymParts(k.d); return '<li><span class="datebox"><b>' + p.d + '</b><small>' + MON3[p.m - 1] + '</small></span><div class="main"><span class="t">' + esc(k.name) + '</span><div class="meta"><span>' + (k.e !== k.d ? fmtRange(k.d, k.e) : WDL[dow(k.d)]) + '</span><span>' + ({ holiday: 'Public holiday', commerce: 'Retail moment', school: 'School holidays', season: 'Season' })[k.kind] + '</span></div></div><div class="end">' + mktChip(k.market) + '</div></li>'; }).join('') + '</ul>'
        : '<div class="card-b"><div class="empty box">No public holidays or retail moments in this period.</div></div>') +
      '<p class="hint" style="padding:0 20px 16px">School-holiday dates are approximate and vary by region.</p></div></div>';
    return html;
  }

  function stepCal(k) {
    var cur = dnum(ui.cal.cursor), v = ui.cal.view;
    ui.cal.cursor = ymdOf(v === 'week' ? cur + 7 * k : v === 'quarter' ? addMonths(quarterStart(cur), 3 * k) : addMonths(monthStart(cur), k));
    saveUi(); refresh();
  }

  function dayDialog(d) {
    var ds = ymdOf(d), list = db.campaigns.filter(function (c) { return passF(c) && c.start <= ds && c.end >= ds; });
    var kd = kdFor(d, d, ['holiday', 'commerce', 'school', 'season']), f = ui.f.market;
    var posts = db.content.filter(function (p) { return p.date === ds && (!f || p.market === f || p.market === 'ALL'); });
    var api = openModal({
      title: dayLabel(d), cls: 'wide',
      body: (kd.length ? '<div class="chips">' + kd.map(function (k) { return '<span class="kd ' + k.kind + '" style="font-size:12px;padding:3px 8px">' + esc((k.market === 'ALL' ? 'All' : k.market) + ' · ' + k.name) + '</span>'; }).join('') + '</div>' : '') +
        '<div><span class="label">Campaigns running (' + list.length + ')</span>' + (list.length ? '<ul class="rows" style="margin:6px -22px 0">' + list.map(function (c) {
          return '<li' + (conflictsOf(c).length ? ' class="warn"' : '') + '><span class="sdot tone-' + toneOf(c) + '" style="width:9px;height:9px"></span><div class="main"><a href="#/c/' + c.id + '">' + esc(c.name) + '</a><div class="meta"><span>' + fmtRange(c.start, c.end) + '</span><span>' + esc((TY[c.type] || {}).name) + '</span></div></div><div class="end">' + mktChip(c.market) + statusChip(c.status) + '</div></li>';
        }).join('') + '</ul>' : '<p class="hint">No campaigns match the filters on this day.</p>') + '</div>' +
        '<div><span class="label">Posts &amp; sends (' + posts.length + ')</span><div style="display:flex;flex-direction:column;gap:6px;margin-top:6px">' + (posts.length ? posts.map(postMini).join('') : '<p class="hint">Nothing scheduled.</p>') + '</div></div>',
      foot: '<button type="button" class="btn" data-pn>' + icon('plus') + 'Post on this day</button><button type="button" class="btn pri" data-cn>' + icon('plus') + 'Campaign starting this day</button>'
    });
    api.el.querySelector('[data-cn]').addEventListener('click', function () { api.close(true); campaignEditor(null, { start: ds, end: ymdOf(d + 13) }); });
    api.el.querySelector('[data-pn]').addEventListener('click', function () { api.close(true); postEditor(null, { date: ds }); });
    api.el.addEventListener('click', function (e) { var a = e.target.closest('a[href^="#/c/"]'); if (a) api.close(true); var b = e.target.closest('[data-act="post-edit"]'); if (b) { e.stopPropagation(); api.close(true); postEditor(post(b.dataset.id)); } });
  }

  // ── Moving campaigns: drag (pointer) + keyboard ──────────────────────────
  var drag = null, suppressClick = false;
  function dayAt(x, y) {
    var host = $('.weeks[data-view]'); if (!host) return null;
    if (host.dataset.view === 'quarter') {
      var tr = $('.g-head .g-track', host).getBoundingClientRect(), px = +host.dataset.px;
      return +host.dataset.from + Math.floor((x - tr.left) / px);
    }
    var rows = $$('.wk[data-w0]', host); if (!rows.length) return null;
    var row = rows[0], best = Infinity;
    rows.forEach(function (r) { var b = r.getBoundingClientRect(); var dist = y < b.top ? b.top - y : y > b.bottom ? y - b.bottom : 0; if (dist < best) { best = dist; row = r; } });
    var rb = row.getBoundingClientRect(), col = clamp(Math.floor((x - rb.left) / (rb.width / 7)), -7, 13);
    return +row.dataset.w0 + col;
  }
  function previewDrag() {
    var ns = drag.ns, ne = drag.ne, host = $('.weeks[data-view]');
    if (!host) return;
    if (host.dataset.view === 'quarter') {
      var px = +host.dataset.px, from = +host.dataset.from;
      $$('.g-bar[data-cid="' + drag.c.id + '"]').forEach(function (b) { b.style.left = (Math.max(ns, from - 2) - from) * px + 'px'; b.style.width = Math.max(px, (ne - Math.max(ns, from - 2) + 1) * px - 2) + 'px'; });
    } else {
      $$('.wk .bg[data-day]').forEach(function (b) { var d = +b.dataset.day; b.classList.toggle('drop', d >= ns && d <= ne); });
      $$('.bar[data-cid="' + drag.c.id + '"]').forEach(function (b) { b.classList.add('dragging'); });
    }
    var tip = drag.tip;
    if (!tip) { tip = drag.tip = document.createElement('div'); tip.className = 'dragtip'; document.body.appendChild(tip); }
    tip.innerHTML = esc(drag.c.name) + '<small>' + esc((drag.mode === 'move' ? 'Move to ' : drag.mode === 'start' ? 'Start ' : 'End ') + fmtRange(ns, ne) + ' · ' + (ne - ns + 1) + ' days') + '</small>';
  }
  function endDrag(cancel) {
    if (!drag) return;
    var dg = drag; drag = null;
    document.body.classList.remove('is-dragging', 'is-resizing');
    if (dg.tip) dg.tip.remove();
    if (!dg.moved) return;
    suppressClick = true; setTimeout(function () { suppressClick = false; }, 0);
    if (cancel || (dg.ns === dg.s && dg.ne === dg.e)) { render(); return; }
    setDates(dg.c, dg.ns, dg.ne, dg.mode);
  }
  function setDates(c, ns, ne, how, refocus) {
    var prev = { start: c.start, end: c.end };
    c.start = ymdOf(ns); c.end = ymdOf(ne); c.updatedAt = Date.now();
    commit();
    var cf = conflictsOf(c);
    if (refocus) { var b = $('.bar[data-cid="' + c.id + '"]'); if (b) b.focus({ preventScroll: true }); }
    toast((how === 'move' ? 'Moved' : 'Changed') + ' “' + c.name + '” to ' + fmtRange(ns, ne) + (cf.length ? ' · ⚠ ' + cf.length + ' conflict' + (cf.length > 1 ? 's' : '') : ''),
      { label: 'Undo', run: function () { c.start = prev.start; c.end = prev.end; c.updatedAt = Date.now(); commit(); toast('Dates restored: ' + fmtRange(prev.start, prev.end)); } });
  }
  document.addEventListener('pointerdown', function (e) {
    var bar = e.target.closest && e.target.closest('.weeks .bar[data-cid]');
    if (!bar || e.button !== 0 || drag) return;
    var hd = e.target.closest('.hd'), mode = hd ? hd.dataset.h : 'move';
    if (e.pointerType === 'touch' && mode === 'move') return; // let touch scroll the page; a tap still opens the campaign
    var c = camp(bar.dataset.cid), d0 = dayAt(e.clientX, e.clientY);
    if (!c || d0 == null) return;
    drag = { c: c, mode: mode, d0: d0, x0: e.clientX, y0: e.clientY, moved: false, s: dnum(c.start), e: dnum(c.end) };
    drag.ns = drag.s; drag.ne = drag.e;
    if (mode !== 'move') e.preventDefault();
  });
  document.addEventListener('pointermove', function (e) {
    if (!drag) return;
    if (!drag.moved) { if (Math.abs(e.clientX - drag.x0) + Math.abs(e.clientY - drag.y0) < 6) return; drag.moved = true; document.body.classList.add(drag.mode === 'move' ? 'is-dragging' : 'is-resizing'); }
    e.preventDefault();
    var d = dayAt(e.clientX, e.clientY); if (d == null) return;
    var k = d - drag.d0, ns = drag.s, ne = drag.e;
    if (drag.mode === 'move') { ns += k; ne += k; } else if (drag.mode === 'start') ns = Math.min(drag.s + k, drag.e); else ne = Math.max(drag.e + k, drag.s);
    drag.ns = ns; drag.ne = ne;
    previewDrag();
    if (drag.tip) { drag.tip.style.left = Math.min(window.innerWidth - drag.tip.offsetWidth - 8, e.clientX + 14) + 'px'; drag.tip.style.top = (e.clientY + 18) + 'px'; }
  });
  document.addEventListener('pointerup', function () { if (drag) endDrag(false); });
  document.addEventListener('pointercancel', function () { if (drag) endDrag(true); });
  document.addEventListener('click', function (e) { if (suppressClick) { e.preventDefault(); e.stopPropagation(); suppressClick = false; } }, true);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && drag) { endDrag(true); return; }
    var bar = e.target.closest && e.target.closest('.weeks .bar[data-cid]');
    if (!bar || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    var c = camp(bar.dataset.cid); if (!c) return;
    var k = e.key === 'ArrowLeft' ? -1 : 1, s = dnum(c.start), en = dnum(c.end);
    if (e.shiftKey) { if (en + k < s) { toast('A campaign needs at least one day.'); return; } setDates(c, s, en + k, 'end', true); }
    else setDates(c, s + k, en + k, 'move', true);
  });

  // ══ Campaign detail ═══════════════════════════════════════════════════════
  function prevSimilar(c) {
    var s = c.start, best = null;
    db.campaigns.forEach(function (x) {
      if (x.id === c.id || x.type !== c.type || x.end >= s || x.status === 'cancelled' || !perf(x).rows.length) return;
      var score = (x.market === c.market ? 0 : 1);
      if (!best || score < best.score || (score === best.score && x.end > best.x.end)) best = { x: x, score: score };
    });
    return best ? best.x : null;
  }
  function kpiTile(label, value, sub, cls) { return '<div class="card kpi"><span class="label">' + label + '</span><span class="v">' + value + '</span>' + (sub ? '<span class="s ' + (cls || '') + '"><i></i>' + sub + '</span>' : '') + '</div>'; }
  function vsTarget(v, t, lowerBetter, fmt) {
    if (v == null || !t) return { s: 'No target', c: '' };
    var r = v / t, good = lowerBetter ? r <= 1 : r >= 1;
    return { s: (lowerBetter ? (good ? 'under' : 'over') : (good ? 'at/above' : 'below')) + ' target ' + fmt(t) + ' (' + (r >= 1 ? '+' : '') + NF0.format((r - 1) * 100) + ' %)', c: good ? 'good' : 'bad' };
  }

  function viewCampaign(c) {
    if (!c) return viewMissing('Campaign not found', 'It may have been deleted, or the link is from another browser’s data.');
    var t = TY[c.type] || {}, s = dnum(c.start), e = dnum(c.end), len = e - s + 1, pf = perf(c), a = pf.agg, cf = conflictsOf(c);
    var done = checklistDone(c), posts = db.content.filter(function (p) { return p.campaignId === c.id; }).sort(function (x, y) { return x.date < y.date ? -1 : 1; });
    var when = s > TODAY ? 'starts ' + relDays(s) : e < TODAY ? 'ended ' + relDays(e) : 'day ' + (TODAY - s + 1) + ' of ' + len;
    var html = '<div class="head"><div><a class="crumb" href="#/campaigns">' + icon('chevL') + 'Campaigns</a><h1>' + esc(c.name) + '</h1><p class="sub">' + mktChip(c.market) + statusChip(c.status) + '<span>' + esc(t.name) + '</span><span>' + fmtRange(s, e) + ' · ' + len + ' days · ' + when + '</span></p></div>' +
      '<div class="actions"><button type="button" class="btn" data-act="camp-edit" data-id="' + c.id + '">' + icon('edit') + 'Edit</button><button type="button" class="btn" data-act="camp-dup" data-id="' + c.id + '">' + icon('repeat') + 'Duplicate / repeat</button>' +
      '<button type="button" class="btn icon" data-act="camp-more" data-id="' + c.id + '" aria-haspopup="menu" aria-expanded="false" aria-label="More actions"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg></button></div></div>';
    if (cf.length) html += '<div class="banner bad" role="note">' + icon('warn') + '<div><b style="font-weight:500">' + cf.length + ' conflict' + (cf.length > 1 ? 's' : '') + '</b><ul>' + cf.map(function (x) { return '<li>' + esc(x.text) + ' — <a href="#/c/' + x.other + '">open</a></li>'; }).join('') + '</ul></div></div>';
    html += '<div class="detail"><div class="stack">';
    // overview
    var spentShare = c.budget ? a.sp / c.budget : 0;
    html += '<div class="card"><div class="card-h"><div><span class="label">Overview</span><h2>Plan</h2></div></div><div class="kv">' +
      kvx('Owner', whoHtml(c.owner)) + kvx('Type', esc(t.name)) + kvx('Market', esc((MK[c.market] || MK.ALL).name)) +
      kvx('Dates', fmtRange(s, e) + ' <span class="muted">(' + len + ' days)</span>') +
      kvx('Budget planned', money(c.budget)) +
      (MODE === 'live' && !c.links.length ? kvx('Spent to date', '<span class="muted">Link ad campaigns to see real spend</span>') :
        kvx('Spent to date' + (MODE === 'live' ? ' (linked ads)' : ''), money(a.sp) + ' <span class="minibar' + (spentShare > 1.05 ? ' over' : '') + '" style="margin-top:6px"><i style="width:' + Math.min(100, spentShare * 100) + '%"></i></span><small class="muted">' + (c.budget ? pct(spentShare, 0) + ' of plan' : 'no budget planned') + '</small>')) +
      kvx('Offer', c.offer ? esc(c.offer) : '<span class="muted">No discount</span>') + kvx('Discount code', c.code ? '<span class="code">' + esc(c.code) + '</span>' : '<span class="muted">—</span>') +
      kvx('Landing page', c.url ? '<a href="' + esc(c.url) + '" target="_blank" rel="noopener noreferrer" style="overflow-wrap:anywhere">' + esc(c.url.replace(/^https?:\/\//, '')) + '</a>' : '<span class="muted">—</span>') +
      '<div class="wide"><span class="k">Channels</span><p>' + chChips(c.channels, 12) + '</p></div>' +
      kvx('Target KPIs', 'ROAS ' + ratio(c.targets.roas) + ' · ' + int(c.targets.orders) + ' orders · ' + money(c.targets.revenue) + ' revenue · CPA ' + eurOr(c.targets.cpa, true)) +
      kvx('Tags', c.tags.length ? '<span class="chips">' + c.tags.map(function (x) { return '<span class="chip">' + esc(x) + '</span>'; }).join('') + '</span>' : '<span class="muted">—</span>') +
      (c.stores.length ? '<div class="wide"><span class="k">Linked stores</span><p><span class="chips">' + c.stores.map(function (id) { var st = STORE[id]; return st ? '<span class="chip">' + esc(st.market + ' · ' + st.name) + '</span>' : ''; }).join('') + '</span></p></div>' : '') +
      '</div></div>';
    // performance: demo numbers in demo mode; in live mode the linked real ad campaigns (no demo numbers at all)
    html += MODE === 'live' ? linksCard(c) + liveSection(c) : perfSection(c, pf);
    // linked content
    html += '<div class="card"><div class="card-h"><div><span class="label">Content</span><h2>Linked posts &amp; sends (' + posts.length + ')</h2></div><button type="button" class="btn sm" data-act="post-new" data-cid="' + c.id + '" data-date="' + (s > TODAY ? c.start : ymdOf(Math.min(e, Math.max(s, TODAY)))) + '">' + icon('plus') + 'Add post</button></div>' +
      (posts.length ? '<ul class="rows">' + posts.map(function (p) { var dd = dnum(p.date), pp = ymParts(dd); return '<li><span class="datebox"><b>' + pp.d + '</b><small>' + MON3[pp.m - 1] + '</small></span><div class="main"><button type="button" class="subj" data-act="post-edit" data-id="' + p.id + '" style="all:unset;cursor:pointer;font-weight:500">' + esc(p.title) + '</button><div class="meta"><span>' + esc(p.time + ' · ' + (CCH[p.channel] || {}).name + ' · ' + p.market) + '</span><span>' + esc(person(p.assignee).name) + '</span></div></div><div class="end">' + cstatusChip(p.status) + '</div></li>'; }).join('') + '</ul>'
        : '<div class="card-b"><div class="empty box">No posts linked yet. Posts and newsletters linked to this campaign show up here and in the content planner.</div></div>') + '</div>';
    html += '</div><div class="stack">';
    // checklist
    html += '<div class="card"><div class="card-h"><div><span class="label">Readiness</span><h2>Checklist</h2></div><span class="prog">' + done + ' / ' + CHECKLIST.length + '<span class="minibar"><i style="width:' + done / CHECKLIST.length * 100 + '%"></i></span></span></div><ul class="checklist">' +
      CHECKLIST.map(function (it) { return '<li><label><input type="checkbox" class="chk" data-chg="check" data-id="' + c.id + '" data-k="' + it.id + '"' + (c.checklist[it.id] ? ' checked' : '') + '><span>' + esc(it.name) + '</span></label></li>'; }).join('') + '</ul></div>';
    // creatives
    html += '<div class="card"><div class="card-h"><div><span class="label">Creatives</span><h2>Attached files (' + c.files.length + ')</h2></div></div>' +
      (c.files.length ? '<div class="files" id="files">' + c.files.map(function (f) { return '<div class="file"><button type="button" class="th" data-act="file-open" data-id="' + c.id + '" data-h="' + f.hash + '" aria-label="Preview ' + esc(f.name) + '"><span class="ph" data-thumb="' + f.hash + '">' + (/pdf/.test(f.type) ? 'PDF' : 'Image') + '</span></button><div class="fm"><b title="' + esc(f.name) + '">' + esc(f.name) + '</b><small><span>' + kb(f.size) + '</span><button type="button" class="linkbtn" data-act="file-del" data-id="' + c.id + '" data-h="' + f.hash + '" aria-label="Remove ' + esc(f.name) + '">Remove</button></small></div></div>'; }).join('') + '</div>' : '') +
      '<div class="drop-zone" id="dropZone">Drop images or PDFs here, or <label for="fileIn">choose files</label>. Up to 10 MB each; kept in this browser (and your private cloud copy when signed in).<input type="file" id="fileIn" class="sr" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" multiple data-chg="files" data-id="' + c.id + '"></div></div>';
    // notes
    html += '<div class="card"><div class="card-h"><div><span class="label">Notes</span><h2>Brief notes</h2></div><span class="saved" id="noteSaved"></span></div><div class="card-b noteform"><label class="sr" for="noteIn">Notes</label><textarea class="in" id="noteIn" data-inp="note" data-id="' + c.id + '" placeholder="Key message, hero products, things to remember…">' + esc(c.notes) + '</textarea></div></div>';
    // comments
    var me = myIdentity();
    html += '<div class="card"><div class="card-h"><div><span class="label">Discussion</span><h2>Comments (' + c.comments.length + ')</h2></div></div>' +
      (c.comments.length ? '<ul class="thread">' + c.comments.slice().sort(function (x, y) { return x.at - y.at; }).map(function (m) {
        var tm = TEAM.filter(function (p) { return p.email === m.by; })[0];
        return '<li><span class="av tone-' + (tm ? tm.tone : 'violet') + '" aria-hidden="true">' + esc(tm ? tm.initials : (m.name || m.by || '?').slice(0, 2).toUpperCase()) + '</span><div><div class="when"><b>' + esc(m.name || m.by) + '</b><span>' + esc(m.by || '') + '</span><span>' + fmtTs(m.at) + '</span>' + (m.mine ? '<button type="button" class="linkbtn" data-act="comment-del" data-id="' + c.id + '" data-mid="' + m.id + '">Delete</button>' : '') + '</div><p>' + esc(m.text) + '</p></div></li>';
      }).join('') + '</ul>' : '<div class="card-b"><div class="empty box">No comments yet.</div></div>') +
      '<form class="composer" data-sub="comment" data-id="' + c.id + '"><label class="sr" for="cmIn">Add a comment</label><textarea class="in" id="cmIn" rows="2" placeholder="Write a comment…" style="min-height:64px"></textarea><div class="row"><span class="hint">As ' + esc(me.label) + ' · stays in this app</span><button type="submit" class="btn sm pri">Comment</button></div></form></div>';
    html += '</div></div>';
    after(function () { bindFiles(c); drawCharts(); });
    return html;
  }
  function kvx(k, v) { return '<div><span class="k">' + k + '</span><p>' + v + '</p></div>'; }
  function kb(n) { return n >= 1048576 ? NF1.format(n / 1048576) + ' MB' : NF0.format(Math.max(1, n / 1024)) + ' KB'; }
  function myIdentity() {
    var u = window.AdrialSync && window.AdrialSync.user && window.AdrialSync.user();
    if (u && u.email) return { email: u.email, name: u.name || u.email.replace(/@.*/, ''), label: u.email };
    return { email: '', name: 'You', label: 'you (not signed in)' };
  }

  function perfSection(c, pf) {
    var a = pf.agg, tg = c.targets || {}, s = dnum(c.start);
    var h = '<div class="card"><div class="card-h"><div><span class="label">Performance' + (pf.rows.length ? ' · to ' + fmtD(Math.min(dnum(c.end), TODAY - 1)) : '') + '</span><h2>Results vs targets</h2></div></div>';
    if (!pf.rows.length) {
      var why = c.status === 'cancelled' ? 'This campaign was cancelled.' : c.status === 'idea' || c.status === 'planned' ? 'Results appear once the campaign is in production or live and has run for a day.' : s >= TODAY ? 'It starts ' + relDays(s) + ' — results appear from the day after launch.' : 'No results yet.';
      return h + '<div class="card-b"><div class="empty box"><b>No performance data yet</b>' + esc(why) + '</div></div></div>';
    }
    var vr = vsTarget(a.rev, tg.revenue, false, money), vo = vsTarget(a.ord, tg.orders, false, int), vroas = vsTarget(a.roas, tg.roas, false, ratio), vc = vsTarget(a.cpa, tg.cpa, true, function (x) { return money2(x); });
    var inc = incremental(c);
    h += '<div class="kpis" style="padding:0 20px;margin-bottom:12px;grid-template-columns:repeat(auto-fit,minmax(min(100%,150px),1fr))">' +
      tile('Spend', money(a.sp), pct(c.budget ? a.sp / c.budget : null, 0) + ' of ' + money(c.budget), c.budget && a.sp > c.budget * 1.05 ? 'bad' : '') +
      tile('Revenue', money(a.rev), vr.s, vr.c) + tile('ROAS', ratio(a.roas), vroas.s, vroas.c) + tile('Orders', int(a.ord), vo.s, vo.c) +
      tile('CPA', eurOr(a.cpa, true), vc.s, vc.c) + tile('CTR', pct(a.ctr, 2), int(a.clk) + ' clicks') + tile('Conv. rate', pct(a.cvr, 2), int(a.ses) + ' sessions') +
      tile('New customers', int(a.nc), a.ord ? pct(a.nc / a.ord, 0) + ' of orders' : '') +
      tile('vs 4 weeks before', inc ? (inc.incr >= 0 ? '+' : '') + moneyK(inc.incr) : '—', inc ? 'market revenue ' + (inc.lift >= 0 ? '+' : '') + pct(inc.lift, 0) + ' per day' : 'not enough history', inc ? (inc.incr >= 0 ? 'good' : 'bad') : '') + '</div>';
    // daily chart
    var from = s, to = Math.min(dnum(c.end), TODAY - 1), days = [];
    for (var d = from; d <= to; d++) days.push({ d: d, sp: 0, rev: 0, ord: 0 });
    pf.rows.forEach(function (r) { var x = days[r.d - from]; if (x) { x.sp += r.sp; x.rev += r.rev; x.ord += r.ord; } });
    h += '<div class="legend"><span><i class="rev"></i>Revenue per day</span><span><i class="spend"></i>Spend per day</span></div><div class="chart" data-chart="daily" data-id="' + c.id + '"></div>';
    chartData['daily-' + c.id] = days;
    // per channel
    var byCh = c.channels.map(function (ch) { var x = aggRows(pf.rows, -1e9, 1e9, ch); x.ch = ch; return x; });
    h += '<div class="card-h" style="padding-top:6px"><div><span class="label">Breakdown</span><h2>Per channel</h2></div></div><div class="tablewrap"><table class="tbl"><thead><tr><th>Channel</th><th class="r">Spend</th><th class="r hide-sm">Impr.</th><th class="r hide-md">Clicks</th><th class="r hide-md">CTR</th><th class="r hide-md">Sessions</th><th class="r">Orders</th><th class="r">Revenue</th><th class="r">ROAS</th><th class="r hide-sm">CPA</th></tr></thead><tbody>' +
      byCh.map(function (x) { return '<tr><td>' + chChip(x.ch) + '</td><td class="r">' + money(x.sp) + '</td><td class="r hide-sm">' + int(x.imp) + '</td><td class="r hide-md">' + int(x.clk) + '</td><td class="r hide-md">' + pct(x.ctr, 2) + '</td><td class="r hide-md">' + int(x.ses) + '</td><td class="r">' + int(x.ord) + '</td><td class="r">' + money(x.rev) + '</td><td class="r">' + ratio(x.roas) + '</td><td class="r hide-sm">' + eurOr(x.cpa, true) + '</td></tr>'; }).join('') +
      '</tbody><tfoot><tr><td>Total</td><td class="r">' + money(a.sp) + '</td><td class="r hide-sm">' + int(a.imp) + '</td><td class="r hide-md">' + int(a.clk) + '</td><td class="r hide-md">' + pct(a.ctr, 2) + '</td><td class="r hide-md">' + int(a.ses) + '</td><td class="r">' + int(a.ord) + '</td><td class="r">' + money(a.rev) + '</td><td class="r">' + ratio(a.roas) + '</td><td class="r hide-sm">' + eurOr(a.cpa, true) + '</td></tr></tfoot></table></div>';
    // previous similar
    var pv = prevSimilar(c);
    h += '<div class="card-h" style="padding-top:14px"><div><span class="label">Comparison</span><h2>Previous similar campaign</h2></div></div>';
    if (pv) {
      var b = perf(pv).agg, ld = dnum(c.end) - s + 1, lp = dnum(pv.end) - dnum(pv.start) + 1;
      var rowsC = [['Days', ld, lp, int], ['Spend', a.sp, b.sp, money], ['Revenue', a.rev, b.rev, money], ['Orders', a.ord, b.ord, int], ['ROAS', a.roas, b.roas, ratio], ['CPA', a.cpa, b.cpa, function (x) { return eurOr(x, true); }, true], ['Conv. rate', a.cvr, b.cvr, function (x) { return pct(x, 2); }], ['Revenue per day', a.rev / Math.max(1, to - s + 1), b.rev / lp, money]];
      h += '<p class="hint" style="padding:0 20px 6px">Compared with <a href="#/c/' + pv.id + '">' + esc(pv.name) + '</a> (' + fmtRange(pv.start, pv.end) + (pv.market !== c.market ? ', ' + pv.market : '') + ').' + (c.status === 'live' ? ' This one is still running.' : '') + '</p><div class="tablewrap"><table class="cmp"><thead><tr><th>Metric</th><th>This</th><th>Previous</th><th>Change</th></tr></thead><tbody>' +
        rowsC.map(function (r) { var ch = r[2] ? r[1] / r[2] - 1 : null, good = ch == null ? null : r[4] ? ch <= 0 : ch >= 0; return '<tr><td>' + r[0] + '</td><td>' + r[3](r[1]) + '</td><td>' + r[3](r[2]) + '</td><td class="' + (ch == null || r[0] === 'Days' || r[0] === 'Spend' ? '' : good ? 'good-t' : 'bad-t') + '">' + (ch == null || !isFinite(ch) ? '—' : (ch >= 0 ? '+' : '') + NF0.format(ch * 100) + ' %') + '</td></tr>'; }).join('') + '</tbody></table></div>';
    } else h += '<div class="card-b"><div class="empty box">No earlier campaign of this type with results to compare with.</div></div>';
    return h + '<div style="height:12px"></div></div>';
  }
  function tile(label, v, sub, cls) { return '<div class="kpi" style="padding:10px 0"><span class="label">' + label + '</span><span class="v" style="font-size:22px">' + v + '</span>' + (sub ? '<span class="s ' + (cls || '') + '">' + (cls ? '<i></i>' : '') + esc(sub) + '</span>' : '') + '</div>'; }

  // ── Charts (plain SVG) ────────────────────────────────────────────────────
  var chartData = {};
  function drawCharts() {
    $$('.chart[data-chart]').forEach(function (el) {
      var k = el.dataset.chart, w = Math.max(260, el.clientWidth - 40);
      if (k === 'daily') el.innerHTML = dailyChart(chartData['daily-' + el.dataset.id] || [], w);
      else if (k === 'months') el.innerHTML = monthsChart(chartData.months || [], w);
      else if (k === 'budget') el.innerHTML = budgetChart(chartData.budget || [], w);
    });
  }
  function niceMax(v) { if (v <= 0) return 1; var p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }
  function dailyChart(days, W) {
    if (!days.length) return '';
    var H = 180, L = 46, B = 22, T = 8, iw = W - L, ih = H - B - T, mx = niceMax(Math.max.apply(null, days.map(function (d) { return Math.max(d.rev, d.sp); })));
    var x = function (i) { return L + (days.length === 1 ? iw / 2 : i * iw / (days.length - 1)); }, y = function (v) { return T + ih - v / mx * ih; };
    var g = '';
    for (var k = 0; k <= 4; k++) { var vv = mx * k / 4; g += '<line class="grid" x1="' + L + '" x2="' + W + '" y1="' + y(vv) + '" y2="' + y(vv) + '"/><text x="' + (L - 6) + '" y="' + (y(vv) + 4) + '" text-anchor="end">' + moneyK(vv) + '</text>'; }
    var pr = days.map(function (d, i) { return x(i).toFixed(1) + ',' + y(d.rev).toFixed(1); }).join(' '), ps = days.map(function (d, i) { return x(i).toFixed(1) + ',' + y(d.sp).toFixed(1); }).join(' ');
    var area = 'M' + x(0) + ',' + y(0) + ' L' + pr.replace(/ /g, ' L') + ' L' + x(days.length - 1) + ',' + y(0) + 'Z';
    var step = Math.max(1, Math.ceil(days.length / Math.max(2, Math.floor(iw / 70)))), lab = '', hits = '', bw = iw / Math.max(1, days.length);
    days.forEach(function (d, i) {
      if (i % step === 0) lab += '<text x="' + x(i) + '" y="' + (H - 4) + '" text-anchor="middle">' + fmtDs(d.d) + '</text>';
      hits += '<rect class="hit" x="' + (x(i) - bw / 2) + '" y="' + T + '" width="' + bw + '" height="' + ih + '" data-tip="' + esc('<b>' + WD[dow(d.d)] + ' ' + fmtD(d.d) + '</b><br>Revenue ' + money(d.rev) + ' · Spend ' + money(d.sp) + '<br><span>' + int(d.ord) + ' orders · ROAS ' + ratio(d.sp ? d.rev / d.sp : null) + '</span>') + '"/>';
    });
    return '<svg width="' + W + '" height="' + H + '" role="img" aria-label="Daily revenue and spend, ' + days.length + ' days">' + g + '<path class="a-rev" d="' + area + '"/><polyline class="l-rev" points="' + pr + '"/><polyline class="l-spend" points="' + ps + '"/>' + lab + hits + '</svg>';
  }
  function monthsChart(ms, W) {
    if (!ms.length) return '';
    var H = 220, L = 50, R = 40, B = 24, T = 10, iw = W - L - R, ih = H - B - T;
    var mx = niceMax(Math.max.apply(null, ms.map(function (m) { return Math.max(m.rev, m.sp); }))), mr = niceMax(Math.max.apply(null, ms.map(function (m) { return m.sp ? m.rev / m.sp : 0; })) || 1);
    var gw = iw / ms.length, bw = Math.max(3, Math.min(22, gw / 2 - 4)), y = function (v) { return T + ih - v / mx * ih; }, yr = function (v) { return T + ih - v / mr * ih; };
    var g = '';
    for (var k = 0; k <= 4; k++) { var vv = mx * k / 4; g += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(vv) + '" y2="' + y(vv) + '"/><text x="' + (L - 6) + '" y="' + (y(vv) + 4) + '" text-anchor="end">' + moneyK(vv) + '</text><text x="' + (W - R + 6) + '" y="' + (yr(mr * k / 4) + 4) + '">' + NF1.format(mr * k / 4) + '</text>'; }
    var bars = '', pts = [], lab = '', hits = '';
    ms.forEach(function (m, i) {
      var cx = L + gw * i + gw / 2;
      bars += '<rect class="s-spend" x="' + (cx - bw - 1) + '" y="' + y(m.sp) + '" width="' + bw + '" height="' + (T + ih - y(m.sp)) + '" rx="2"/><rect class="s-rev" x="' + (cx + 1) + '" y="' + y(m.rev) + '" width="' + bw + '" height="' + (T + ih - y(m.rev)) + '" rx="2"/>';
      if (m.sp && !m.noRev) pts.push([cx, yr(m.rev / m.sp)]);
      if (ms.length <= 12 || i % 2 === 0) lab += '<text x="' + cx + '" y="' + (H - 6) + '" text-anchor="middle">' + m.label + '</text>';
      hits += '<rect class="hit" x="' + (L + gw * i) + '" y="' + T + '" width="' + gw + '" height="' + ih + '" data-tip="' + esc('<b>' + m.full + '</b><br>Spend ' + money(m.sp) + (m.noRev ? '' : ' · ' + (m.revLabel || 'Revenue') + ' ' + money(m.rev) + '<br><span>ROAS ' + ratio(m.sp ? m.rev / m.sp : null) + ' · ' + int(m.ord) + ' orders</span>') + (m.site != null ? '<br><span>Site-wide GA4 revenue ' + money(m.site) + '</span>' : '')) + '"/>';
    });
    return '<svg width="' + W + '" height="' + H + '" role="img" aria-label="Spend and revenue per month with ROAS">' + g + bars + '<polyline class="l-roas" points="' + pts.map(function (p) { return p.join(','); }).join(' ') + '"/>' + pts.map(function (p) { return '<circle class="dot-roas" cx="' + p[0] + '" cy="' + p[1] + '" r="3"/>'; }).join('') + lab + hits + '</svg>';
  }
  function budgetChart(ms, W) {
    if (!ms.length) return '';
    var H = 220, L = 50, B = 24, T = 10, iw = W - L, ih = H - B - T;
    var mx = niceMax(Math.max.apply(null, ms.map(function (m) { return Math.max(m.plan, m.sp, m.budget); })));
    var gw = iw / ms.length, bw = Math.max(4, Math.min(30, gw - 10)), y = function (v) { return T + ih - v / mx * ih; };
    var g = '';
    for (var k = 0; k <= 4; k++) { var vv = mx * k / 4; g += '<line class="grid" x1="' + L + '" x2="' + W + '" y1="' + y(vv) + '" y2="' + y(vv) + '"/><text x="' + (L - 6) + '" y="' + (y(vv) + 4) + '" text-anchor="end">' + moneyK(vv) + '</text>'; }
    var bars = '', bl = [], lab = '', hits = '';
    ms.forEach(function (m, i) {
      var x0 = L + gw * i + (gw - bw) / 2, cx = L + gw * i + gw / 2;
      bars += '<rect class="s-plan" x="' + x0 + '" y="' + y(m.plan) + '" width="' + bw + '" height="' + (T + ih - y(m.plan)) + '" rx="3"/>';
      if (m.sp) bars += '<rect class="' + (m.sp > m.budget * 1.0001 && !(m.live && !m.budget) ? 's-over' : m.fc ? 's-fc' : 's-rev') + '" x="' + (x0 + bw * 0.22) + '" y="' + y(m.sp) + '" width="' + bw * 0.56 + '" height="' + (T + ih - y(m.sp)) + '" rx="2"/>';
      bl.push(L + gw * i + ',' + y(m.budget), L + gw * (i + 1) + ',' + y(m.budget));
      lab += '<text x="' + cx + '" y="' + (H - 6) + '" text-anchor="middle">' + m.label + '</text>';
      hits += '<rect class="hit" x="' + (L + gw * i) + '" y="' + T + '" width="' + gw + '" height="' + ih + '" data-tip="' + esc(m.tip || ('<b>' + m.full + '</b><br>Budget ' + money(m.budget) + ' · Planned ' + money(m.plan) + '<br>Spent ' + money(m.sp) + (m.sp > m.budget ? ' <span>(over budget)</span>' : ''))) + '"/>';
    });
    return '<svg width="' + W + '" height="' + H + '" role="img" aria-label="Monthly budget, planned and spent">' + g + bars + '<polyline class="l-budget" points="' + bl.join(' ') + '"/>' + lab + hits + '</svg>';
  }
  // chart tooltips
  var tipEl = null;
  document.addEventListener('mouseover', function (e) {
    var h = e.target.closest && e.target.closest('[data-tip]');
    if (!h) { if (tipEl) { tipEl.remove(); tipEl = null; } return; }
    var ch = h.closest('.chart'); if (!ch) return;
    if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'tip'; }
    if (tipEl.parentNode !== ch) ch.appendChild(tipEl);
    tipEl.innerHTML = h.getAttribute('data-tip');
    var hr = h.getBoundingClientRect(), cr = ch.getBoundingClientRect();
    tipEl.style.left = clamp(hr.left + hr.width / 2 - cr.left, 90, cr.width - 90) + 'px'; tipEl.style.top = Math.max(0, hr.top - cr.top + 10) + 'px';
  });
  var resizeTimer = null;
  window.addEventListener('resize', function () { clearTimeout(resizeTimer); resizeTimer = setTimeout(function () { if (db && !drag && !stack.length) { if ((current.parts[0] || 'calendar') === 'calendar') refresh(); else drawCharts(); } }, 200); });

  // ── Files (creatives) ─────────────────────────────────────────────────────
  var objUrls = [], fetching = {};
  function bindFiles(c) {
    objUrls.forEach(function (u) { URL.revokeObjectURL(u); }); objUrls = [];
    $$('[data-thumb]').forEach(function (ph) {
      var h = ph.dataset.thumb, f = c.files.filter(function (x) { return x.hash === h; })[0];
      if (!f) return;
      getFileBlob(h).then(function (blob) {
        if (!blob || !ph.isConnected) { if (ph.isConnected) ph.textContent = 'Not on this device'; return; }
        if (/^image\//.test(f.type)) { var u = URL.createObjectURL(blob); objUrls.push(u); ph.outerHTML = '<img src="' + u + '" alt="">'; }
        else ph.innerHTML = icon('file') + '<br>PDF · ' + kb(blob.size);
      });
    });
    var dz = $('#dropZone'); if (!dz) return;
    dz.addEventListener('dragover', function (e) { e.preventDefault(); dz.classList.add('over'); });
    dz.addEventListener('dragleave', function () { dz.classList.remove('over'); });
    dz.addEventListener('drop', function (e) { e.preventDefault(); dz.classList.remove('over'); addFiles(c, e.dataTransfer && e.dataTransfer.files); });
  }
  function getFileBlob(hash) {
    return fileGet(hash).then(function (r) { return r && r.blob ? r.blob : null; }, function () { return null; }).then(function (b) {
      if (b) return b;
      if (!sync || !(window.AdrialSync.user && window.AdrialSync.user()) || fetching[hash]) return null;
      fetching[hash] = true;
      return sync.fetchFile(hash).then(function (blob) { return blob; }, function () { return null; });
    });
  }
  var OK_TYPES = /^(image\/(png|jpeg|webp|gif)|application\/pdf)$/;
  function addFiles(c, list) {
    var files = Array.prototype.slice.call(list || []);
    if (!files.length) return;
    var me = myIdentity(), added = 0, skipped = [];
    files.reduce(function (p, f) {
      return p.then(function () {
        if (!OK_TYPES.test(f.type)) { skipped.push(f.name + ' (type)'); return; }
        if (f.size > 10 * 1048576) { skipped.push(f.name + ' (over 10 MB)'); return; }
        return f.arrayBuffer().then(function (buf) { return crypto.subtle.digest('SHA-256', buf); }).then(function (dg) {
          var hash = Array.prototype.map.call(new Uint8Array(dg), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
          return filePut(hash, { hash: hash, blob: f, type: f.type }).then(function () {
            if (!c.files.some(function (x) { return x.hash === hash; })) { c.files.push({ hash: hash, name: f.name.slice(0, 120), type: f.type, size: f.size, addedAt: Date.now(), by: me.email || '' }); added++; }
          });
        });
      });
    }, Promise.resolve()).then(function () {
      if (added) { c.updatedAt = Date.now(); commit(); }
      toast((added ? 'Attached ' + added + ' file' + (added > 1 ? 's' : '') : 'Nothing attached') + (skipped.length ? ' · skipped: ' + skipped.join(', ') : ''));
    }, function () { toast('Could not store the file in this browser.'); });
  }
  function openFile(c, hash) {
    var f = c.files.filter(function (x) { return x.hash === hash; })[0]; if (!f) return;
    getFileBlob(hash).then(function (blob) {
      if (!blob) { toast('This file is not on this device' + (sync ? ' — sign in to cloud sync to fetch it.' : '.')); return; }
      var u = URL.createObjectURL(new Blob([blob], { type: f.type }));
      var api = openModal({ title: f.name, cls: 'wide', body: /pdf/.test(f.type) ? '<iframe class="preview-frame" src="' + u + '" title="' + esc(f.name) + '"></iframe>' : '<img class="preview-img" src="' + u + '" alt="' + esc(f.name) + '">',
        foot: '<span class="hint grow">' + kb(f.size) + ' · added ' + fmtTs(f.addedAt) + '</span><a class="btn" href="' + u + '" download="' + esc(f.name) + '">' + icon('download') + 'Download</a><button type="button" class="btn pri" data-close>Close</button>',
        onClose: function () { setTimeout(function () { URL.revokeObjectURL(u); }, 1000); } });
      return api;
    });
  }
  function removeFile(c, hash) {
    var f = c.files.filter(function (x) { return x.hash === hash; })[0]; if (!f) return;
    confirmDialog({ title: 'Remove this file?', text: '“' + f.name + '” is removed from this campaign.', ok: 'Remove', danger: true }).then(function (ok) {
      if (!ok) return;
      c.files = c.files.filter(function (x) { return x.hash !== hash; });
      var used = hashUsed(hash);
      if (!used) fileDel(hash).catch(function () { /* ignore */ });
      c.updatedAt = Date.now(); commit(); toast('File removed');
    });
  }

  // ══ Campaign editor ═══════════════════════════════════════════════════════
  function campaignEditor(c, preset) {
    var isNew = !c, x = c || Object.assign({ name: '', market: ui.f.market || 'SI', type: 'seasonal_sale', status: 'planned', owner: ui.f.owner || defaultPerson('u1'), start: ymdOf(TODAY + 14), end: ymdOf(TODAY + 27), channels: ['meta', 'gads_search', 'newsletter'], budget: 3000, code: '', offer: '', url: '', targets: { roas: 4, orders: 0, revenue: 0, cpa: 0 }, tags: [], stores: [] }, preset || {});
    var body = '<div class="field"><label for="ceName">Name <span class="req">*</span></label><input class="in" id="ceName" maxlength="120" value="' + esc(x.name) + '" placeholder="e.g. Spring sale 2027" autofocus></div>' +
      '<div class="row3"><div class="field"><label for="ceMarket">Market</label><select class="in" id="ceMarket">' + opts(MARKETS, x.market) + '</select></div>' +
      '<div class="field"><label for="ceType">Type</label><select class="in" id="ceType">' + opts(TYPES, x.type) + '</select></div>' +
      '<div class="field"><label for="ceStatus">Status</label><select class="in" id="ceStatus">' + opts(STATUSES, x.status) + '</select></div></div>' +
      '<div class="row3"><div class="field"><label for="ceStart">Start <span class="req">*</span></label><input class="in" type="date" id="ceStart" value="' + esc(x.start) + '"></div>' +
      '<div class="field"><label for="ceEnd">End <span class="req">*</span></label><input class="in" type="date" id="ceEnd" value="' + esc(x.end) + '"></div>' +
      '<div class="field"><label for="ceOwner">Owner</label><select class="in" id="ceOwner">' + opts(peopleList(true), x.owner, MODE === 'live' ? 'Unassigned' : null) + '</select></div></div>' +
      '<fieldset class="field"><legend>Channels <span class="req">*</span></legend><div class="pills" id="ceCh">' + CHANNELS.map(function (ch) { return '<label><input type="checkbox" value="' + ch.id + '"' + (x.channels.indexOf(ch.id) >= 0 ? ' checked' : '') + '>' + esc(ch.name) + '</label>'; }).join('') + '</div></fieldset>' +
      '<div class="row3"><div class="field"><label for="ceBudget">Budget planned (€)</label><input class="in" type="number" min="0" step="50" id="ceBudget" value="' + esc(x.budget) + '"></div>' +
      '<div class="field"><label for="ceOffer">Offer</label><input class="in" id="ceOffer" maxlength="120" value="' + esc(x.offer) + '" placeholder="e.g. −20 % on frames"></div>' +
      '<div class="field"><label for="ceCode">Discount code</label><input class="in" id="ceCode" maxlength="30" value="' + esc(x.code) + '" placeholder="e.g. SPRING20-SI" style="text-transform:uppercase"></div></div>' +
      '<div class="field"><label for="ceUrl">Landing page URL</label><input class="in" type="url" id="ceUrl" value="' + esc(x.url) + '" placeholder="https://example.com/si/…"></div>' +
      '<fieldset class="field"><legend>Target KPIs</legend><div class="row4"><div class="field"><label for="ceTRoas">ROAS</label><input class="in" type="number" min="0" step="0.1" id="ceTRoas" value="' + esc(x.targets.roas) + '"></div>' +
      '<div class="field"><label for="ceTOrd">Orders</label><input class="in" type="number" min="0" step="1" id="ceTOrd" value="' + esc(x.targets.orders) + '"></div>' +
      '<div class="field"><label for="ceTRev">Revenue (€)</label><input class="in" type="number" min="0" step="100" id="ceTRev" value="' + esc(x.targets.revenue) + '"></div>' +
      '<div class="field"><label for="ceTCpa">CPA (€)</label><input class="in" type="number" min="0" step="0.5" id="ceTCpa" value="' + esc(x.targets.cpa) + '"></div></div>' +
      '<div><button type="button" class="btn sm" id="ceSuggest">Fill revenue, orders and CPA from budget × ROAS</button></div></fieldset>' +
      '<div class="field"><label for="ceTags">Tags <span class="hint">comma-separated</span></label><input class="in" id="ceTags" list="ceTagList" value="' + esc(x.tags.join(', ')) + '"><datalist id="ceTagList">' + D.TAGS.map(function (t) { return '<option value="' + esc(t) + '">'; }).join('') + '</datalist></div>' +
      '<fieldset class="field" id="ceStoresF"><legend>Linked stores (in-store promotions)</legend><div class="pills" id="ceStores">' + STORES.map(function (st) { return '<label data-m="' + st.market + '"><input type="checkbox" value="' + st.id + '"' + (x.stores.indexOf(st.id) >= 0 ? ' checked' : '') + '>' + esc(st.market + ' · ' + st.name) + '</label>'; }).join('') + '</div><span class="hint" id="ceStoresHint"></span></fieldset>';
    var api = openModal({
      title: isNew ? 'New campaign' : 'Edit campaign', cls: 'wide', body: body, onSubmit: submit,
      foot: '<button type="button" class="btn ghost" data-close>Cancel</button><button type="submit" form="{form}" class="btn pri">' + (isNew ? 'Create campaign' : 'Save changes') + '</button>'
    });
    var el = api.el;
    function syncStores() {
      var m = $('#ceMarket', el).value;
      $$('#ceStores label', el).forEach(function (l) { var show = m === 'ALL' || l.dataset.m === m; l.hidden = !show; if (!show) l.querySelector('input').checked = false; });
      $('#ceStoresHint', el).textContent = m === 'IT' ? 'Italy is webshop-only — no stores to link.' : '';
    }
    syncStores();
    $('#ceMarket', el).addEventListener('change', syncStores);
    $('#ceSuggest', el).addEventListener('click', function () {
      var b = +$('#ceBudget', el).value || 0, r = +$('#ceTRoas', el).value || (TY[$('#ceType', el).value] || {}).roas || 3, aov = (MK[$('#ceMarket', el).value] || MK.ALL).aov;
      var rev = Math.round(b * r / 100) * 100, ord = Math.max(1, Math.round(rev / aov));
      $('#ceTRoas', el).value = r; $('#ceTRev', el).value = rev; $('#ceTOrd', el).value = ord; $('#ceTCpa', el).value = b ? Math.round(b / ord * 100) / 100 : 0;
    });
    function submit(api2) {
      var v = function (id) { return $('#' + id, el).value; };
      var name = v('ceName').trim(), st = v('ceStart'), en = v('ceEnd'), url = v('ceUrl').trim(), chs = $$('#ceCh input:checked', el).map(function (i) { return i.value; });
      if (!name) return formError(api2, 'Give the campaign a name.', 'ceName');
      if (!validYmd(st)) return formError(api2, 'Enter a valid start date.', 'ceStart');
      if (!validYmd(en)) return formError(api2, 'Enter a valid end date.', 'ceEnd');
      if (en < st) return formError(api2, 'The end date is before the start date.', 'ceEnd');
      if (dnum(en) - dnum(st) > 400) return formError(api2, 'Campaigns can run for at most 400 days.', 'ceEnd');
      if (!chs.length) return formError(api2, 'Pick at least one channel.', 'ceCh');
      if (url && !/^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(url)) return formError(api2, 'The landing page must be a full http(s) URL.', 'ceUrl');
      var budget = +v('ceBudget'); if (!(budget >= 0) || budget > 1e7) return formError(api2, 'Enter a budget between 0 and 10.000.000 €.', 'ceBudget');
      var y = c || { id: ++db.seq.campaign, checklist: {}, notes: (preset && preset.notes) || '', comments: [], files: [], utms: [], content: [], links: (preset && preset.links || []).slice(0, 50), seed: (D.strHash(name + Date.now()) >>> 0), createdAt: Date.now() };
      Object.assign(y, {
        name: name, market: v('ceMarket'), type: v('ceType'), status: v('ceStatus'), owner: v('ceOwner'), start: st, end: en, channels: chs, budget: Math.round(budget),
        offer: v('ceOffer').trim(), code: v('ceCode').trim().toUpperCase().replace(/\s+/g, ''), url: url,
        targets: { roas: Math.max(0, +v('ceTRoas') || 0), orders: Math.max(0, Math.round(+v('ceTOrd') || 0)), revenue: Math.max(0, +v('ceTRev') || 0), cpa: Math.max(0, +v('ceTCpa') || 0) },
        tags: v('ceTags').split(',').map(function (t) { return t.trim().toLowerCase(); }).filter(Boolean).filter(function (t, i, a) { return a.indexOf(t) === i; }).slice(0, 12),
        stores: $$('#ceStores input:checked', el).map(function (i) { return i.value; }), updatedAt: Date.now()
      });
      if (!c) db.campaigns.push(y);
      api2.close(true);
      commit(true);
      var cf = conflictsOf(y);
      if (isNew) location.hash = '#/c/' + y.id; else refresh();
      toast((isNew ? 'Campaign created' + (y.links && y.links.length ? ', linked to ' + y.links.length + ' ad campaign' + (y.links.length > 1 ? 's' : '') : '') : 'Saved') + (cf.length ? ' · ⚠ ' + cf.length + ' conflict' + (cf.length > 1 ? 's' : '') + ' — see the campaign' : ''));
    }
  }

  // ── Duplicate / repeat ────────────────────────────────────────────────────
  function duplicateDialog(c) {
    var s = dnum(c.start), y = ymParts(s).y, len = dnum(c.end) - s;
    var isBf = c.type === 'black_friday';
    var bfNext = D.blackFriday(y + 1) - (D.blackFriday(y) - s);
    var body = '<p class="hint" style="margin:0">Copies the plan: channels, budget, offer, code, landing page, targets, tags, stores, notes and creatives. Comments, results' + (MODE === 'live' ? ' and linked ad campaigns' : '') + ' are not copied.</p>' +
      '<div class="field"><label for="dpName">Name</label><input class="in" id="dpName" value="' + esc(c.name.replace(String(y), String(y + 1)) === c.name ? c.name + ' (copy)' : c.name.replace(String(y), String(y + 1))) + '"></div>' +
      '<fieldset class="field"><legend>Dates</legend><div class="pills" id="dpWhen">' +
      (isBf ? '<label><input type="radio" name="dpw" value="bf" checked>Align to Black Friday ' + (y + 1) + ' (' + fmtRange(bfNext, bfNext + len) + ')</label>' : '') +
      '<label><input type="radio" name="dpw" value="wk"' + (isBf ? '' : ' checked') + '>Same weekdays next year (' + fmtRange(s + 364, s + 364 + len) + ')</label>' +
      '<label><input type="radio" name="dpw" value="yr">Same dates next year</label><label><input type="radio" name="dpw" value="same">Same dates</label><label><input type="radio" name="dpw" value="custom">Custom start</label></div>' +
      '<input class="in" type="date" id="dpStart" value="' + ymdOf(s + 364) + '" aria-label="Custom start date" hidden></fieldset>' +
      '<div class="row2"><div class="field"><label for="dpMarket">Market</label><select class="in" id="dpMarket">' + opts(MARKETS, c.market) + '</select></div>' +
      '<div class="field"><label for="dpStatus">Status of the copy</label><select class="in" id="dpStatus">' + opts(STATUSES.filter(function (x) { return x.id === 'idea' || x.id === 'planned'; }), 'planned') + '</select></div></div>' +
      '<label class="check"><input type="checkbox" class="chk" id="dpPosts" checked>Also copy the ' + db.content.filter(function (p) { return p.campaignId === c.id; }).length + ' linked posts (shifted, back to “Brief”)</label>';
    var api = openModal({ title: 'Duplicate “' + c.name + '”', body: body, onSubmit: submit, foot: '<button type="button" class="btn ghost" data-close>Cancel</button><button type="submit" form="{form}" class="btn pri">Create copy</button>' });
    var el = api.el;
    el.addEventListener('change', function () { $('#dpStart', el).hidden = ($('input[name="dpw"]:checked', el) || {}).value !== 'custom'; });
    function submit(api2) {
      var w = ($('input[name="dpw"]:checked', el) || {}).value, ns;
      if (w === 'bf') ns = bfNext; else if (w === 'wk') ns = s + 364; else if (w === 'same') ns = s;
      else if (w === 'yr') { var p = ymParts(s); ns = dmake(p.y + 1, p.m, Math.min(p.d, ymParts(D.lastOfMonth(p.y + 1, p.m)).d)); }
      else { var cs = $('#dpStart', el).value; if (!validYmd(cs)) return formError(api2, 'Pick a start date.', 'dpStart'); ns = dnum(cs); }
      var name = $('#dpName', el).value.trim(); if (!name) return formError(api2, 'Give the copy a name.', 'dpName');
      var shift = ns - s, mk = $('#dpMarket', el).value;
      var n = JSON.parse(JSON.stringify(c));
      var ny = ymParts(ns).y;
      if (n.url && ny !== y) n.url = n.url.replace(String(y), String(ny));
      Object.assign(n, { id: ++db.seq.campaign, name: name, market: mk, start: ymdOf(ns), end: ymdOf(ns + len), status: $('#dpStatus', el).value, checklist: {}, comments: [], utms: [], content: [], links: [],
        seed: D.strHash(name + Date.now()) >>> 0, createdAt: Date.now(), updatedAt: Date.now() });
      if (mk !== c.market) { n.stores = n.stores.filter(function (id) { return STORE[id] && (mk === 'ALL' || STORE[id].market === mk); }); if (c.code) n.code = c.code.replace(new RegExp('-' + c.market + '$'), '') + (mk !== 'ALL' ? '-' + mk : ''); }
      db.campaigns.push(n);
      var copied = 0;
      if ($('#dpPosts', el).checked) db.content.filter(function (p) { return p.campaignId === c.id; }).forEach(function (p) {
        var q = Object.assign({}, p, { id: ++db.seq.content, date: ymdOf(dnum(p.date) + shift), status: 'brief', campaignId: n.id, market: mk === 'ALL' ? p.market : mk });
        db.content.push(q); n.content.push(q.id); copied++;
      });
      api2.close(true); commit(true);
      location.hash = '#/c/' + n.id;
      toast('Copy created for ' + fmtRange(n.start, n.end) + (copied ? ' with ' + copied + ' posts' : ''));
    }
  }
  function deleteCampaign(c) {
    var posts = db.content.filter(function (p) { return p.campaignId === c.id; }).length;
    confirmDialog({ title: 'Delete this campaign?', text: '“' + c.name + '” and its checklist, notes and comments are deleted. ' + (posts ? posts + ' linked posts stay in the content planner, unlinked.' : ''), ok: 'Delete campaign', danger: true }).then(function (ok) {
      if (!ok) return;
      db.campaigns = db.campaigns.filter(function (x) { return x !== c; });
      db.content.forEach(function (p) { if (p.campaignId === c.id) p.campaignId = null; });
      perfCache.delete(c.id);
      var hashes = c.files.map(function (f) { return f.hash; }).filter(function (h) { return !hashUsed(h); });
      hashes.forEach(function (h) { fileDel(h).catch(function () { /* ignore */ }); });
      commit(true); location.hash = '#/campaigns'; toast('Campaign deleted');
    });
  }

  // ══ Content item editor ═══════════════════════════════════════════════════
  function postEditor(p, preset) {
    var isNew = !p, x = p || Object.assign({ date: ymdOf(TODAY + 1), time: '12:00', channel: 'instagram', market: ui.content.market || (ui.f.market && ui.f.market !== 'ALL' ? ui.f.market : 'SI'), title: '', caption: '', status: 'brief', assignee: defaultPerson('u5'), campaignId: null }, preset || {});
    if (isNew && preset && preset.campaignId) { var pc = camp(preset.campaignId); if (pc) x.market = pc.market; }
    var near = db.campaigns.filter(function (c) { return c.status !== 'cancelled' && dnum(c.end) >= dnum(x.date) - 60 && dnum(c.start) <= dnum(x.date) + 60 || c.id === x.campaignId; }).sort(function (a, b) { return a.start < b.start ? -1 : 1; });
    var body = '<div class="field"><label for="peTitle">Title <span class="req">*</span></label><input class="in" id="peTitle" maxlength="140" value="' + esc(x.title) + '" autofocus></div>' +
      '<div class="row3"><div class="field"><label for="peDate">Date <span class="req">*</span></label><input class="in" type="date" id="peDate" value="' + esc(x.date) + '"></div>' +
      '<div class="field"><label for="peTime">Time</label><input class="in" type="time" id="peTime" value="' + esc(x.time) + '"></div>' +
      '<div class="field"><label for="peStatus">Creative status</label><select class="in" id="peStatus">' + opts(CSTATUSES, x.status) + '</select></div></div>' +
      '<div class="row3"><div class="field"><label for="peCh">Channel</label><select class="in" id="peCh">' + opts(CCHANNELS, x.channel) + '</select></div>' +
      '<div class="field"><label for="peMarket">Market</label><select class="in" id="peMarket">' + opts(MARKETS, x.market) + '</select></div>' +
      '<div class="field"><label for="peWho">Assignee</label><select class="in" id="peWho">' + opts(peopleList(false), x.assignee, MODE === 'live' ? 'Unassigned' : null) + '</select></div></div>' +
      '<div class="field"><label for="peCamp">Campaign</label><select class="in" id="peCamp"><option value="">— Not linked —</option>' + near.map(function (c) { return '<option value="' + c.id + '"' + (c.id === x.campaignId ? ' selected' : '') + '>' + esc(c.name + ' (' + fmtRange(c.start, c.end) + ')') + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label for="peCap">Caption / brief</label><textarea class="in" id="peCap" maxlength="2200">' + esc(x.caption) + '</textarea><span class="hint" id="peCount"></span></div>' +
      '<p class="hint" style="margin:0">Planning only — nothing is posted, scheduled or sent to any social network, e-mail or SMS tool.</p>';
    var api = openModal({
      title: isNew ? 'New post' : 'Edit post', body: body, onSubmit: submit,
      foot: (isNew ? '' : '<button type="button" class="btn danger-ghost" data-del>' + icon('trash') + 'Delete</button><span class="grow"></span>') + '<button type="button" class="btn ghost" data-close>Cancel</button><button type="submit" form="{form}" class="btn pri">' + (isNew ? 'Add post' : 'Save') + '</button>'
    });
    var el = api.el, cap = $('#peCap', el), cnt = $('#peCount', el);
    function count() { cnt.textContent = cap.value.length + ' characters' + ($('#peCh', el).value === 'sms' && cap.value.length > 160 ? ' · longer than one SMS (160)' : ''); }
    cap.addEventListener('input', count); $('#peCh', el).addEventListener('change', count); count();
    var del = el.querySelector('[data-del]');
    if (del) del.addEventListener('click', function () {
      api.close(true);
      confirmDialog({ title: 'Delete this post?', text: '“' + p.title + '” is removed from the plan.', ok: 'Delete', danger: true }).then(function (ok) {
        if (!ok) return;
        db.content = db.content.filter(function (q) { return q !== p; });
        db.campaigns.forEach(function (c) { c.content = c.content.filter(function (id) { return id !== p.id; }); });
        commit(); toast('Post deleted');
      });
    });
    function submit(api2) {
      var v = function (id) { return $('#' + id, el).value; };
      var title = v('peTitle').trim(), date = v('peDate'), time = v('peTime') || '12:00';
      if (!title) return formError(api2, 'Give the post a title.', 'peTitle');
      if (!validYmd(date)) return formError(api2, 'Enter a valid date.', 'peDate');
      var y = p || { id: ++db.seq.content };
      var oldC = y.campaignId;
      Object.assign(y, { title: title, date: date, time: time, status: v('peStatus'), channel: v('peCh'), market: v('peMarket'), assignee: v('peWho'), campaignId: v('peCamp') ? +v('peCamp') : null, caption: v('peCap') });
      if (!p) db.content.push(y);
      if (oldC !== y.campaignId) {
        var oc = camp(oldC); if (oc) oc.content = oc.content.filter(function (id) { return id !== y.id; });
        var nc = camp(y.campaignId); if (nc && nc.content.indexOf(y.id) < 0) nc.content.push(y.id);
      }
      api2.close(true); commit(); toast(isNew ? 'Post added for ' + fmtD(date) : 'Post saved');
    }
  }

  // ══ Campaigns list ════════════════════════════════════════════════════════
  function listCampaigns() {
    var q = ui.list.q, s = ui.list.sort, dir = ui.list.dir;
    var list = db.campaigns.filter(function (c) { return passF(c, null, true) && (!q || matchQ(q, [c.name, c.code, c.offer, c.tags.join(' '), (TY[c.type] || {}).name, person(c.owner).name, c.market].join(' '))); });
    var key = {
      name: function (c) { return norm(c.name); }, start: function (c) { return c.start; }, market: function (c) { return c.market; }, status: function (c) { return STATUSES.indexOf(ST[c.status]); },
      budget: function (c) { return c.budget; }, spent: function (c) { return perf(c).agg.sp; }, roas: function (c) { var r = perf(c).agg.roas; return r == null ? -1 : r; }, owner: function (c) { return person(c.owner).name; }
    }[s] || function (c) { return c.start; };
    return list.sort(function (a, b) { var x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : a.id - b.id) * dir; });
  }
  function sortTh(k, label, cls) {
    var on = ui.list.sort === k;
    return '<th class="' + (cls || '') + '"' + (on ? ' aria-sort="' + (ui.list.dir > 0 ? 'ascending' : 'descending') + '"' : '') + '><button type="button" class="sortbtn" data-act="sort" data-k="' + k + '">' + label + (on ? '<i aria-hidden="true">' + (ui.list.dir > 0 ? '↑' : '↓') + '</i>' : '') + '</button></th>';
  }
  function viewCampaigns() {
    var list = listCampaigns(), show = list.slice(0, ui.list.show), live = MODE === 'live';
    if (live && liveReady()) show.forEach(function (c) { if (c.links.length) liveCampaignData(c, true); });
    var tb = sum(list, function (c) { return c.status === 'cancelled' ? 0 : c.budget; }), ts = sum(list, function (c) { return perf(c).agg.sp; });
    var nLinked = live ? list.filter(function (c) { return c.links.length; }).length : 0;
    var html = head('Plan', 'Campaigns<span class="dot">.</span>', '<span><b>' + list.length + '</b> of ' + db.campaigns.length + ' campaigns</span><span>Budget <b>' + money(tb) + '</b></span>' +
      (live ? '<span><b>' + nLinked + '</b> linked to ad campaigns</span><span title="Real spend of the linked ad campaigns within each campaign’s dates (loaded for the rows on screen)">Spent (linked) <b>' + money(ts) + '</b></span>' : '<span>Spent <b>' + money(ts) + '</b></span>'),
      '<button type="button" class="btn" data-act="csv-campaigns">' + icon('download') + 'CSV</button><button type="button" class="btn" data-act="ics-list">' + icon('cal') + '.ics</button>' + (live ? '<button type="button" class="btn" data-act="import-ads">' + icon('upload') + 'Import from ads</button>' : '') + '<button type="button" class="btn pri" data-act="new-campaign">' + icon('plus') + 'New campaign</button>');
    html += '<div class="toolbar"><label class="sr" for="clQ">Search campaigns</label><input class="search" id="clQ" type="search" placeholder="Search name, code, offer, tag…" value="' + esc(ui.list.q) + '" data-inp="list-q">' + filterBar('lf') + '</div>';
    html += '<div class="card">' + (list.length ? '<div class="tablewrap"><table class="tbl"><thead><tr>' + sortTh('name', 'Campaign') + sortTh('market', 'Market') + '<th class="hide-md">Channels</th>' + sortTh('owner', 'Owner', 'hide-md') + sortTh('status', 'Status') + sortTh('start', 'Dates') + sortTh('budget', 'Budget', 'r') + sortTh('spent', 'Spent', 'r hide-sm') + sortTh('roas', 'ROAS', 'r hide-sm') + '</tr></thead><tbody>' +
      show.map(function (c) {
        var a = perf(c).agg, cf = conflictsOf(c);
        return '<tr><td class="name"><a class="t1" href="#/c/' + c.id + '">' + esc(c.name) + '</a>' + (cf.length ? ' ' + warnIc(cf.map(function (x) { return x.text; }).join('\n')) : '') + '<small>' + esc((TY[c.type] || {}).name) + (c.code ? ' · ' + esc(c.code) : '') + '</small></td><td>' + mktChip(c.market) + '</td><td class="hide-md">' + chChips(c.channels, 2) + '</td><td class="hide-md">' + whoHtml(c.owner) + '</td><td>' + statusChip(c.status) + '</td>' +
          '<td class="nw">' + fmtRange(c.start, c.end) + '</td><td class="r nw">' + money(c.budget) + '</td><td class="r nw hide-sm' + (c.budget && a.sp > c.budget * 1.05 ? ' bad-t' : '') + '">' + (a.sp ? money(a.sp) : '—') + '</td><td class="r hide-sm' + (a.roas != null && c.targets.roas ? (a.roas >= c.targets.roas ? ' good-t' : ' bad-t') : '') + '">' + ratio(a.roas) + '</td></tr>';
      }).join('') + '</tbody></table></div>' + (list.length > show.length ? '<div class="more"><button type="button" class="btn" data-act="list-more">Show ' + Math.min(50, list.length - show.length) + ' more (' + (list.length - show.length) + ' left)</button></div>' : '')
      : (live && !db.campaigns.length ? '<div class="card-b"><div class="empty box"><b>Your live plan is empty</b>Add a campaign, or import real ad campaigns as a starting plan.<br><button type="button" class="btn sm" data-act="import-ads" style="margin-top:10px">' + icon('upload') + 'Import ad campaigns</button></div></div>'
        : '<div class="card-b"><div class="empty box"><b>No campaigns match</b>Try clearing the search or filters.' + (filtersActive() || ui.list.q ? '<br><button type="button" class="btn sm" data-act="clear-all" style="margin-top:10px">Clear search and filters</button>' : '') + '</div></div>')) + '</div>';
    return html;
  }
  function exportCampaignsCsv(list) {
    var live = MODE === 'live';
    var rows = [['ID', 'Name', 'Market', 'Type', 'Status', 'Owner', 'Start', 'End', 'Days', 'Channels', 'Budget EUR', live ? 'Spent EUR (linked ads, if loaded)' : 'Spent EUR', live ? 'GA4 revenue EUR' : 'Revenue EUR', live ? 'GA4 orders' : 'Orders', 'ROAS', 'Target ROAS', 'CPA EUR', 'Offer', 'Code', 'Landing page', 'Tags', 'Stores', 'Checklist done', 'Conflicts'].concat(live ? ['Linked ad campaigns'] : [])];
    list.forEach(function (c) {
      var pf = perf(c), a = pf.agg, has = !live || pf.loaded;
      rows.push([c.id, c.name, c.market, (TY[c.type] || {}).name, (ST[c.status] || {}).name, person(c.owner).name, c.start, c.end, dnum(c.end) - dnum(c.start) + 1, c.channels.map(function (x) { return CH[x].name; }).join(' | '),
        c.budget, has ? n2(a.sp) : '', has ? n2(a.rev) : '', has ? a.ord : '', has ? n2(a.roas) : '', c.targets.roas, has ? n2(a.cpa) : '', c.offer, c.code, c.url, c.tags.join(' | '), c.stores.map(function (id) { return STORE[id] ? STORE[id].name : id; }).join(' | '), checklistDone(c) + '/' + CHECKLIST.length, conflictsOf(c).map(function (x) { return x.text; }).join(' | ')]
        .concat(live ? [c.links.map(function (l) { return l.k; }).join(' ; ')] : []));
    });
    downloadCsv('marketing-campaigns-' + TODAY_YMD + '.csv', rows);
  }

  // ══ Content planner ═══════════════════════════════════════════════════════
  var selPosts = {};
  function contentRange() {
    var p = ui.content.period;
    if (p === 'week') return [TODAY, TODAY + 6];
    if (p === 'upcoming') return [TODAY - 3, TODAY + 27];
    if (p === 'past') return [TODAY - 30, TODAY - 1];
    if (p === 'quarter') return [TODAY, TODAY + 90];
    return [-1e9, 1e9];
  }
  function listPosts() {
    var r = contentRange(), u = ui.content;
    return db.content.filter(function (p) {
      var d = dnum(p.date);
      if (d < r[0] || d > r[1]) return false;
      if (u.market && p.market !== u.market && !(p.market === 'ALL' && u.market !== 'ALL')) return false;
      if (u.channel && p.channel !== u.channel) return false;
      if (u.assignee && p.assignee !== u.assignee) return false;
      if (u.q) { var c = camp(p.campaignId); if (!matchQ(u.q, p.title + ' ' + p.caption + ' ' + (c ? c.name : ''))) return false; }
      return true;
    }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.time < b.time ? -1 : a.time > b.time ? 1 : a.id - b.id; });
  }
  function viewContent() {
    var u = ui.content, list = listPosts();
    Object.keys(selPosts).forEach(function (id) { if (!list.some(function (p) { return p.id === +id; })) delete selPosts[id]; });
    var nSel = Object.keys(selPosts).length;
    var late = list.filter(function (p) { var d = dnum(p.date); return d >= TODAY && d <= TODAY + 2 && (p.status === 'brief' || p.status === 'design' || p.status === 'review'); }).length;
    var html = head('Create', 'Content planner<span class="dot">.</span>', '<span><b>' + list.length + '</b> posts &amp; sends in this view</span>' + (late ? '<span class="bad-t">' + warnIc() + ' <b class="bad-t">' + late + '</b> due in 2 days and not approved yet</span>' : '') + '<span>Planning only — nothing is published from here</span>',
      '<button type="button" class="btn" data-act="csv-content">' + icon('download') + 'CSV</button><button type="button" class="btn pri" data-act="post-new">' + icon('plus') + 'New post</button>');
    // quick add
    html += '<form class="card quickadd" data-sub="quick-post" aria-label="Quick add a post"><div class="field"><label for="qaDate">Date</label><input class="in" type="date" id="qaDate" value="' + ymdOf(TODAY + 1) + '" required></div>' +
      '<div class="field"><label for="qaCh">Channel</label><select class="in" id="qaCh">' + opts(CCHANNELS, 'instagram') + '</select></div>' +
      '<div class="field"><label for="qaM">Market</label><select class="in" id="qaM">' + opts(MARKETS, u.market || 'SI') + '</select></div>' +
      '<div class="field qa-title"><label for="qaT">Quick add</label><input class="in" id="qaT" maxlength="140" placeholder="Post title — lands in “Brief”"></div>' +
      '<div class="qa-go"><button type="submit" class="btn pri" style="min-height:44px;width:100%">' + icon('plus') + 'Add</button></div></form><div class="gap"></div>';
    html += '<div class="toolbar"><div class="seg" role="group" aria-label="Layout">' + [['board', 'Board'], ['list', 'List by date']].map(function (x) { return '<button type="button" data-act="content-view" data-v="' + x[0] + '" aria-pressed="' + (u.view === x[0]) + '">' + x[1] + '</button>'; }).join('') + '</div>' +
      '<label class="sr" for="ctP">Period</label><select class="select" id="ctP" data-chg="content-f" data-k="period">' + opts([{ id: 'week', name: 'Next 7 days' }, { id: 'upcoming', name: 'Next 4 weeks' }, { id: 'quarter', name: 'Next 90 days' }, { id: 'past', name: 'Last 30 days' }, { id: 'all', name: 'All dates' }], u.period) + '</select>' +
      '<label class="sr" for="ctM">Market</label><select class="select" id="ctM" data-chg="content-f" data-k="market">' + opts(MARKETS.map(function (m) { return { id: m.id, name: m.id === 'ALL' ? 'Cross-market posts' : m.name }; }), u.market, 'All markets') + '</select>' +
      '<label class="sr" for="ctC">Channel</label><select class="select" id="ctC" data-chg="content-f" data-k="channel">' + opts(CCHANNELS, u.channel, 'All channels') + '</select>' +
      '<label class="sr" for="ctA">Assignee</label><select class="select" id="ctA" data-chg="content-f" data-k="assignee">' + opts(peopleList(false), u.assignee, 'Everyone') + '</select>' +
      '<label class="sr" for="ctQ">Search posts</label><input class="search" id="ctQ" type="search" placeholder="Search posts…" value="' + esc(u.q) + '" data-inp="content-q"></div>';
    if (nSel) html += '<div class="bulkbar" role="region" aria-label="Bulk actions"><b style="font-weight:500">' + nSel + ' selected</b>' +
      '<label class="sr" for="bkSt">Move to status</label><select class="select" id="bkSt"><option value="">Move to…</option>' + CSTATUSES.map(function (s) { return '<option value="' + s.id + '">' + esc(s.name) + '</option>'; }).join('') + '</select>' +
      '<label class="sr" for="bkSh">Shift dates</label><select class="select" id="bkSh"><option value="">Shift dates…</option><option value="-7">−1 week</option><option value="-1">−1 day</option><option value="1">+1 day</option><option value="7">+1 week</option></select>' +
      '<label class="sr" for="bkAs">Assign to</label><select class="select" id="bkAs"><option value="">Assign to…</option>' + peopleList(false).map(function (t) { return '<option value="' + esc(t.id) + '">' + esc(t.name) + '</option>'; }).join('') + '</select>' +
      '<button type="button" class="btn sm" data-act="bulk-apply">Apply</button><button type="button" class="btn sm ghost" data-act="bulk-clear">Clear selection</button></div>';
    if (!list.length) return html + '<div class="card"><div class="card-b"><div class="empty box"><b>No posts in this view</b>Change the period or filters, or quick-add one above.</div></div></div>';
    if (u.view === 'list') {
      var byDay = {}, days = [];
      list.forEach(function (p) { if (!byDay[p.date]) { byDay[p.date] = []; days.push(p.date); } byDay[p.date].push(p); });
      html += '<div class="card"><div class="tablewrap"><table class="tbl"><thead><tr><th style="width:36px"><input type="checkbox" class="chk" data-chg="sel-all" aria-label="Select all ' + list.length + ' posts"' + (nSel && nSel === list.length ? ' checked' : '') + '></th><th>Time</th><th>Post</th><th class="hide-sm">Channel</th><th>Status</th><th class="hide-md">Assignee</th><th class="hide-md">Campaign</th></tr></thead><tbody>' +
        days.map(function (ds) {
          var d = dnum(ds);
          return '<tr><td colspan="7" style="background:var(--sunken);font:400 11px var(--mono);letter-spacing:.06em;text-transform:uppercase;color:var(--ink3)">' + esc(dayLabel(d)) + (d === TODAY ? ' · today' : '') + '</td></tr>' + byDay[ds].map(function (p) {
            var c = camp(p.campaignId);
            return '<tr><td><input type="checkbox" class="chk" data-chg="sel" data-id="' + p.id + '" aria-label="Select ' + esc(p.title) + '"' + (selPosts[p.id] ? ' checked' : '') + '></td><td class="nw mono">' + esc(p.time) + '</td><td><button type="button" class="subj" data-act="post-edit" data-id="' + p.id + '" style="all:unset;cursor:pointer;font-weight:500">' + esc(p.title) + '</button><small>' + esc(p.market + ' · ' + p.caption.slice(0, 80) + (p.caption.length > 80 ? '…' : '')) + '</small></td>' +
              '<td class="hide-sm">' + esc((CCH[p.channel] || {}).name) + '</td><td>' + cstatusChip(p.status) + '</td><td class="hide-md">' + whoHtml(p.assignee) + '</td><td class="hide-md">' + (c ? '<a href="#/c/' + c.id + '">' + esc(c.name) + '</a>' : '<span class="muted">—</span>') + '</td></tr>';
          }).join('');
        }).join('') + '</tbody></table></div></div>';
      return html;
    }
    html += '<div class="board" id="board">' + CSTATUSES.map(function (st) {
      var items = list.filter(function (p) { return p.status === st.id; }), shown = items.slice(0, 40);
      return '<section class="col" data-st="' + st.id + '" aria-label="' + esc(st.name) + ', ' + items.length + ' posts"><div class="col-h"><div class="t"><span class="sdot tone-' + st.tone + '"></span>' + esc(st.name) + '<span class="n">' + items.length + '</span></div></div><div class="col-b">' +
        (shown.length ? shown.map(postCard).join('') : '<div class="col-empty">Nothing here</div>') + '</div>' + (items.length > shown.length ? '<div class="col-foot">+' + (items.length - shown.length) + ' more — narrow the period or use the list</div>' : '') + '</section>';
    }).join('') + '</div><p class="hint">Drag a card by its handle to another column, or use “Move to” on the card. Tick cards to move several at once.</p>';
    return html;
  }
  function postCard(p) {
    var c = camp(p.campaignId), d = dnum(p.date), lateC = d >= TODAY && d <= TODAY + 2 && (p.status === 'brief' || p.status === 'design' || p.status === 'review');
    return '<article class="dcard tone-' + GR[(CCH[p.channel] || CCH.instagram).group].tone + '" data-id="' + p.id + '"><div class="row ttl"><label class="sr" for="ps' + p.id + '">Select</label><input type="checkbox" class="chk" id="ps' + p.id + '" data-chg="sel" data-id="' + p.id + '"' + (selPosts[p.id] ? ' checked' : '') + ' style="margin-top:2px">' +
      '<button type="button" class="tt" data-act="post-edit" data-id="' + p.id + '" style="flex:1">' + esc(p.title) + '</button><span class="grip" data-grip="' + p.id + '" title="Drag to another status" aria-hidden="true"><svg viewBox="0 0 24 24">' + ICONS.grip + '</svg></span></div>' +
      '<div class="meta"><span' + (lateC ? ' class="bad-t"' : '') + '>' + (lateC ? '⚠ ' : '') + fmtD(d) + ' · ' + esc(p.time) + '</span><span>' + esc((CCH[p.channel] || {}).name) + '</span><span>' + esc(p.market) + '</span></div>' +
      (p.caption ? '<div class="cap">' + esc(p.caption) + '</div>' : '') + (c ? '<div class="meta"><a href="#/c/' + c.id + '" style="color:var(--ink2)">' + esc(c.name) + '</a></div>' : '') +
      '<div class="row">' + whoHtml(p.assignee) + '<label class="sr" for="mv' + p.id + '">Move “' + esc(p.title) + '” to</label><select class="mv" id="mv' + p.id + '" data-chg="post-move" data-id="' + p.id + '">' + CSTATUSES.map(function (s) { return '<option value="' + s.id + '"' + (s.id === p.status ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join('') + '</select></div></article>';
  }
  // board drag (pointer, with a floating ghost)
  var bdrag = null;
  document.addEventListener('pointerdown', function (e) {
    var g = e.target.closest && e.target.closest('[data-grip]'); if (!g || e.button !== 0) return;
    var card = g.closest('.dcard'); if (!card) return;
    e.preventDefault();
    var r = card.getBoundingClientRect();
    bdrag = { id: +g.dataset.grip, card: card, ox: e.clientX - r.left, oy: e.clientY - r.top, ghost: null, over: null };
  });
  document.addEventListener('pointermove', function (e) {
    if (!bdrag) return;
    if (!bdrag.ghost) { bdrag.ghost = bdrag.card.cloneNode(true); bdrag.ghost.classList.add('ghost'); bdrag.ghost.removeAttribute('data-id'); $$('[id]', bdrag.ghost).forEach(function (x) { x.removeAttribute('id'); }); document.body.appendChild(bdrag.ghost); bdrag.card.classList.add('dragging'); document.body.classList.add('is-dragging'); }
    bdrag.ghost.style.transform = 'translate(' + (e.clientX - bdrag.ox) + 'px,' + (e.clientY - bdrag.oy) + 'px)';
    var col = null; $$('.col[data-st]').forEach(function (c) { var b = c.getBoundingClientRect(); if (e.clientX >= b.left && e.clientX <= b.right && e.clientY >= b.top - 40 && e.clientY <= b.bottom + 40) col = c; });
    $$('.col.over').forEach(function (c) { if (c !== col) c.classList.remove('over'); });
    if (col) col.classList.add('over'); bdrag.over = col;
    var bd = $('#board'); if (bd) { var bb = bd.getBoundingClientRect(); if (e.clientX > bb.right - 40) bd.scrollLeft += 12; else if (e.clientX < bb.left + 40) bd.scrollLeft -= 12; }
  });
  document.addEventListener('pointerup', function () {
    if (!bdrag) return;
    var d = bdrag; bdrag = null;
    document.body.classList.remove('is-dragging');
    if (d.ghost) d.ghost.remove();
    d.card.classList.remove('dragging');
    $$('.col.over').forEach(function (c) { c.classList.remove('over'); });
    if (d.over && d.ghost) movePosts([d.id], d.over.dataset.st);
  });
  function movePosts(ids, st, shift, who) {
    var n = 0;
    ids.forEach(function (id) {
      var p = post(id); if (!p) return;
      if (st && p.status !== st) { p.status = st; n++; }
      if (shift) { p.date = ymdOf(dnum(p.date) + shift); n++; }
      if (who && p.assignee !== who) { p.assignee = who; n++; }
    });
    if (!n) return;
    commit();
    toast(ids.length === 1 ? 'Post updated' + (st ? ' → ' + CST[st].name : '') : ids.length + ' posts updated');
  }
  function exportContentCsv(list) {
    var rows = [['ID', 'Date', 'Time', 'Channel', 'Market', 'Title', 'Caption', 'Status', 'Assignee', 'Campaign']];
    list.forEach(function (p) { var c = camp(p.campaignId); rows.push([p.id, p.date, p.time, (CCH[p.channel] || {}).name, p.market, p.title, p.caption, (CST[p.status] || {}).name, person(p.assignee).name, c ? c.name : '']); });
    downloadCsv('marketing-content-' + TODAY_YMD + '.csv', rows);
  }

  // ── Quick search (Ctrl+K) ─────────────────────────────────────────────────
  function quickSearch() {
    var api = openModal({ title: 'Find', cls: 'qs', body: '<label class="sr" for="qsIn">Search campaigns and posts</label><input class="qs-in" id="qsIn" type="search" autocomplete="off" placeholder="Campaign, code, post title…" role="combobox" aria-expanded="true" aria-controls="qsRes" aria-autocomplete="list"><ul class="qs-res" id="qsRes" role="listbox" aria-label="Results"></ul>' });
    var inp = $('#qsIn', api.el), res = $('#qsRes', api.el), items = [], act = 0;
    function draw() {
      var q = inp.value.trim();
      var cs = db.campaigns.filter(function (c) { return !q || matchQ(q, c.name + ' ' + c.code + ' ' + c.market + ' ' + (TY[c.type] || {}).name); }).sort(function (a, b) { return Math.abs(dnum(a.start) - TODAY) - Math.abs(dnum(b.start) - TODAY); }).slice(0, 8);
      var ps = q ? db.content.filter(function (p) { return matchQ(q, p.title + ' ' + p.caption); }).slice(0, 5) : [];
      items = cs.map(function (c) { return { href: '#/c/' + c.id, t: c.name, s: fmtRange(c.start, c.end) + ' · ' + (ST[c.status] || {}).name, k: 'Campaign' }; })
        .concat(ps.map(function (p) { return { post: p.id, t: p.title, s: fmtD(p.date) + ' · ' + (CCH[p.channel] || {}).name + ' · ' + p.market, k: 'Post' }; }));
      act = 0;
      res.innerHTML = items.length ? items.map(function (it, i) { return '<li class="qs-opt" role="option" id="qso' + i + '" data-i="' + i + '" aria-selected="' + (i === act) + '"><div class="main"><b>' + esc(it.t) + '</b><small>' + esc(it.k + ' · ' + it.s) + '</small></div></li>'; }).join('') : '<li class="empty">No matches.</li>';
      inp.setAttribute('aria-activedescendant', items.length ? 'qso0' : '');
    }
    function go(i) { var it = items[i]; if (!it) return; api.close(true); if (it.href) location.hash = it.href; else postEditor(post(it.post)); }
    inp.addEventListener('input', draw);
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!items.length) return; act = (act + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; $$('.qs-opt', res).forEach(function (o, i) { o.setAttribute('aria-selected', String(i === act)); }); inp.setAttribute('aria-activedescendant', 'qso' + act); var o = $('#qso' + act, res); if (o) o.scrollIntoView({ block: 'nearest' }); }
      else if (e.key === 'Enter') { e.preventDefault(); go(act); }
    });
    res.addEventListener('click', function (e) { var o = e.target.closest('[data-i]'); if (o) go(+o.dataset.i); });
    draw();
  }

  // ══ Performance ═══════════════════════════════════════════════════════════
  function perfPeriod() {
    var p = ui.perf.period, to = TODAY - 1, from;
    if (p === '30d') from = to - 29; else if (p === '12m') from = to - 364; else if (p === 'ytd') from = dmake(ymParts(TODAY).y, 1, 1); else from = to - 89;
    from = Math.max(from, dnum(db.range.from));
    return { from: from, to: to, label: { '30d': 'Last 30 days', '90d': 'Last 90 days', '12m': 'Last 12 months', ytd: 'Year to date' }[p] || 'Last 90 days' };
  }
  function perfCamps() { var m = ui.perf.market; return db.campaigns.filter(function (c) { return c.status !== 'cancelled' && (!m || c.market === m); }); }
  function collect(from, to) {
    var ch = ui.perf.channel, tot = zero(), byM = {}, byCh = {}, byT = {}, byMo = {}, byC = [];
    perfCamps().forEach(function (c) {
      var rows = perf(c).rows, a = zero(), any = false;
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i]; if (r.d < from || r.d > to || (ch && r.ch !== ch)) continue;
        any = true; addRow(a, r);
        addRow(byCh[r.ch] = byCh[r.ch] || zero(), r);
        var mk = ymdOf(r.d).slice(0, 7); addRow(byMo[mk] = byMo[mk] || zero(), r);
      }
      if (!any) return;
      addRow(tot, a); addRow(byM[c.market] = byM[c.market] || zero(), a); addRow(byT[c.type] = byT[c.type] || zero(), a);
      a.c = c; byC.push(derive(a));
    });
    [byM, byCh, byT, byMo].forEach(function (o) { Object.keys(o).forEach(function (k) { derive(o[k]); }); });
    return { tot: derive(tot), byM: byM, byCh: byCh, byT: byT, byMo: byMo, byC: byC };
  }
  function delta(cur, prev, lowerBetter, cls) {
    if (cur == null || prev == null || !prev) return { s: 'no earlier data', c: '' };
    var d = cur / prev - 1, good = lowerBetter ? d <= 0 : d >= 0;
    return { s: (d >= 0 ? '+' : '') + NF0.format(d * 100) + ' % vs previous period', c: good ? 'good' : 'bad' };
  }
  function verdict(c, a, inc) {
    var t = c.targets.roas || 0;
    if (a.roas == null) return { t: 'No spend', tone: 'grey' };
    if (t && a.roas >= t && (!inc || inc.incr > 0)) return { t: 'Worked', tone: 'green' };
    if ((t && a.roas < 0.6 * t) || (inc && inc.incr < 0 && t && a.roas < t)) return { t: 'Did not work', tone: 'clay' };
    return { t: 'Mixed', tone: 'blue' };
  }
  function viewPerformance() {
    var P = perfPeriod(), len = P.to - P.from + 1, cur = collect(P.from, P.to), prev = collect(P.from - len, P.from - 1), a = cur.tot, b = prev.tot, u = ui.perf;
    var html = head('Measure', 'Performance<span class="dot">.</span>', '<span>' + esc(P.label) + ' · ' + fmtRange(P.from, P.to) + '</span><span>' + (u.market ? esc(MK[u.market].name) : 'All markets') + ' · ' + (u.channel ? esc(CH[u.channel].name) : 'all channels') + '</span>',
      '<button type="button" class="btn" data-act="csv-perf">' + icon('download') + 'CSV</button>');
    html += '<div class="toolbar"><div class="seg" role="group" aria-label="Period">' + [['30d', '30 days'], ['90d', '90 days'], ['ytd', 'Year to date'], ['12m', '12 months']].map(function (x) { return '<button type="button" data-act="perf-period" data-v="' + x[0] + '" aria-pressed="' + (u.period === x[0]) + '">' + x[1] + '</button>'; }).join('') + '</div>' +
      '<label class="sr" for="pfM">Market</label><select class="select" id="pfM" data-chg="perf-f" data-k="market">' + opts(MARKETS.map(function (m) { return { id: m.id, name: m.id === 'ALL' ? 'Cross-market campaigns' : m.name }; }), u.market, 'All markets') + '</select>' +
      '<label class="sr" for="pfC">Channel</label><select class="select" id="pfC" data-chg="perf-f" data-k="channel">' + opts(CHANNELS, u.channel, 'All channels') + '</select></div>';
    if (!a.sp && !a.rev) return html + '<div class="card"><div class="card-b"><div class="empty box"><b>No results in this period</b>Pick a longer period or another market or channel.</div></div></div>';
    var d1 = delta(a.sp, b.sp), d2 = delta(a.rev, b.rev), d3 = delta(a.roas, b.roas), d4 = delta(a.ord, b.ord), d5 = delta(a.cpa, b.cpa, true), d6 = delta(a.cvr, b.cvr), d7 = delta(a.ctr, b.ctr), d8 = delta(a.nc, b.nc);
    html += '<div class="kpis">' + kpiTile('Spend', money(a.sp), d1.s, '') + kpiTile('Revenue', money(a.rev), d2.s, d2.c) + kpiTile('ROAS', ratio(a.roas), d3.s, d3.c) + kpiTile('Orders', int(a.ord), d4.s, d4.c) +
      kpiTile('CPA', eurOr(a.cpa, true), d5.s, d5.c) + kpiTile('Conv. rate', pct(a.cvr, 2), d6.s, d6.c) + kpiTile('CTR', pct(a.ctr, 2), d7.s, d7.c) + kpiTile('New customers', int(a.nc), d8.s, d8.c) + '</div>';
    // monthly chart (12 months, market/channel filters apply)
    var m0 = addMonths(monthStart(TODAY), -11), all12 = collect(Math.max(m0, dnum(db.range.from)), TODAY - 1).byMo, ms = [];
    for (var k = 0; k < 12; k++) { var md = addMonths(m0, k), p = ymParts(md), key = ymdOf(md).slice(0, 7), x = all12[key] || zero(); ms.push({ label: MON3[p.m - 1], full: MON[p.m - 1] + ' ' + p.y + (k === 11 ? ' (to date)' : ''), sp: x.sp, rev: x.rev, ord: x.ord }); }
    chartData.months = ms;
    html += '<div class="grid2"><div class="card"><div class="card-h"><div><span class="label">Last 12 months</span><h2>Spend, revenue and ROAS per month</h2></div></div><div class="legend"><span><i class="spend"></i>Spend</span><span><i class="rev"></i>Revenue</span><span><i class="roas"></i>ROAS (right axis)</span></div><div class="chart" data-chart="months"></div></div>';
    // ROAS by type vs target
    var types = Object.keys(cur.byT).map(function (t) { var tg = 0, w = 0; cur.byC.forEach(function (x) { if (x.c.type === t) { tg += (x.c.targets.roas || 0) * x.sp; w += x.sp; } }); return { t: t, a: cur.byT[t], target: w ? tg / w : 0 }; }).filter(function (x) { return x.a.sp > 0; }).sort(function (x, y) { return (y.a.roas || 0) - (x.a.roas || 0); });
    var mxr = Math.max.apply(null, types.map(function (x) { return Math.max(x.a.roas || 0, x.target); }).concat([1]));
    html += '<div class="card"><div class="card-h"><div><span class="label">' + esc(P.label) + '</span><h2>ROAS by campaign type</h2></div></div><div class="hbars">' + types.map(function (x) {
      var hit = x.target && x.a.roas >= x.target;
      return '<div class="hbar"><span class="nm" title="' + esc(TY[x.t].name) + '">' + esc(TY[x.t].name) + '</span><span class="tr" title="Target ' + ratio(x.target) + '"><i style="width:' + (x.a.roas / mxr * 100) + '%;--c:' + (hit ? 'var(--c-green)' : 'var(--c-clay)') + '"></i>' + (x.target ? '<b style="left:' + (x.target / mxr * 100) + '%"></b>' : '') + '</span><span class="vv">' + ratio(x.a.roas) + ' / ' + ratio(x.target) + '</span></div>';
    }).join('') + '</div><p class="hint" style="padding:0 20px 16px">Bar = actual ROAS (green when at or above target); the black line marks the spend-weighted target.</p></div></div><div class="gap"></div>';
    // breakdown tables
    var tab = u.tab, rows, keyName;
    if (tab === 'channel') rows = Object.keys(cur.byCh).map(function (k) { return { k: k, n: chChip(k), plain: CH[k].name, a: cur.byCh[k] }; });
    else if (tab === 'type') rows = Object.keys(cur.byT).map(function (k) { return { k: k, n: esc(TY[k].name), plain: TY[k].name, a: cur.byT[k] }; });
    else if (tab === 'month') rows = Object.keys(cur.byMo).sort().map(function (k) { var p = k.split('-'); return { k: k, n: MON[+p[1] - 1] + ' ' + p[0], plain: k, a: cur.byMo[k] }; });
    else rows = ['SI', 'HR', 'IT', 'ALL'].filter(function (k) { return cur.byM[k]; }).map(function (k) { return { k: k, n: mktChip(k) + ' ' + esc(MK[k].name), plain: MK[k].name, a: cur.byM[k] }; });
    if (tab !== 'month') rows.sort(function (x, y) { return y.a.sp - x.a.sp; });
    perfTableRows = rows;
    html += '<div class="card"><div class="card-h"><div><span class="label">' + esc(P.label) + '</span><h2>Breakdown</h2></div><div class="seg" role="group" aria-label="Breakdown by">' + [['market', 'Market'], ['channel', 'Channel'], ['type', 'Type'], ['month', 'Month']].map(function (x) { return '<button type="button" data-act="perf-tab" data-v="' + x[0] + '" aria-pressed="' + (tab === x[0]) + '">' + x[1] + '</button>'; }).join('') + '</div></div>' +
      '<div class="tablewrap"><table class="tbl"><thead><tr><th>' + ({ market: 'Market', channel: 'Channel', type: 'Type', month: 'Month' })[tab] + '</th><th class="r">Spend</th><th class="r">Revenue</th><th class="r">ROAS</th><th class="r">Orders</th><th class="r">CPA</th><th class="r hide-sm">Conv. rate</th><th class="r hide-md">CTR</th><th class="r hide-md">New cust.</th><th class="hide-sm" style="min-width:110px">Share of spend</th></tr></thead><tbody>' +
      rows.map(function (r) { var x = r.a; return '<tr><td class="nw">' + r.n + '</td><td class="r nw">' + money(x.sp) + '</td><td class="r nw">' + money(x.rev) + '</td><td class="r">' + ratio(x.roas) + '</td><td class="r">' + int(x.ord) + '</td><td class="r nw">' + eurOr(x.cpa, true) + '</td><td class="r hide-sm">' + pct(x.cvr, 2) + '</td><td class="r hide-md">' + pct(x.ctr, 2) + '</td><td class="r hide-md">' + int(x.nc) + '</td><td class="hide-sm"><span class="minibar"><i style="width:' + (a.sp ? x.sp / a.sp * 100 : 0) + '%"></i></span></td></tr>'; }).join('') +
      '</tbody><tfoot><tr><td>Total</td><td class="r nw">' + money(a.sp) + '</td><td class="r nw">' + money(a.rev) + '</td><td class="r">' + ratio(a.roas) + '</td><td class="r">' + int(a.ord) + '</td><td class="r nw">' + eurOr(a.cpa, true) + '</td><td class="r hide-sm">' + pct(a.cvr, 2) + '</td><td class="r hide-md">' + pct(a.ctr, 2) + '</td><td class="r hide-md">' + int(a.nc) + '</td><td class="hide-sm"></td></tr></tfoot></table></div></div><div class="gap"></div>';
    // top / worst
    var ranked = cur.byC.filter(function (x) { return x.sp >= 300 && x.roas != null; }).sort(function (x, y) { return y.roas - x.roas; });
    function mini(list, title, lab) {
      return '<div class="card"><div class="card-h"><div><span class="label">' + lab + '</span><h2>' + title + '</h2></div></div>' + (list.length ? '<ul class="rows">' + list.map(function (x) { var c = x.c; return '<li><div class="main"><a href="#/c/' + c.id + '">' + esc(c.name) + '</a><div class="meta"><span>' + esc(TY[c.type].name) + '</span><span>' + money(x.sp) + ' spend → ' + money(x.rev) + '</span></div></div><div class="end"><span class="mono" style="font-size:15px">' + ratio(x.roas) + '</span></div></li>'; }).join('') + '</ul>' : '<div class="card-b"><div class="empty box">Not enough campaigns with spend in this period.</div></div>') + '</div>';
    }
    html += '<div class="grid2 even">' + mini(ranked.slice(0, 5), 'Top campaigns by ROAS', esc(P.label) + ' · min. 300 € spend') + mini(ranked.slice(-5).reverse(), 'Worst campaigns by ROAS', esc(P.label) + ' · min. 300 € spend') + '</div><div class="gap"></div>';
    // what worked
    var ww = cur.byC.filter(function (x) { return x.sp >= 300; }).map(function (x) { var inc = incremental(x.c); return { x: x, inc: inc, v: verdict(x.c, x, inc) }; });
    ww.sort(u.rank === 'incr' ? function (p, q) { return (q.inc ? q.inc.incr : -1e12) - (p.inc ? p.inc.incr : -1e12); } : function (p, q) { return (q.x.roas || 0) - (p.x.roas || 0); });
    perfWW = ww;
    var cnt = { Worked: 0, Mixed: 0, 'Did not work': 0 }; ww.forEach(function (w) { if (cnt[w.v.t] != null) cnt[w.v.t]++; });
    html += '<div class="card"><div class="card-h"><div><span class="label">' + esc(P.label) + ' · ' + ww.length + ' campaigns · ' + cnt.Worked + ' worked · ' + cnt.Mixed + ' mixed · ' + cnt['Did not work'] + ' did not</span><h2>What worked</h2></div><div class="seg" role="group" aria-label="Rank by">' + [['roas', 'Rank by ROAS'], ['incr', 'By incremental revenue']].map(function (x) { return '<button type="button" data-act="perf-rank" data-v="' + x[0] + '" aria-pressed="' + (u.rank === x[0]) + '">' + x[1] + '</button>'; }).join('') + '</div></div>' +
      '<p class="hint" style="padding:0 20px 10px">Incremental revenue = average daily market revenue while the campaign ran minus the 4 weeks before it, × days (a simple baseline: overlapping campaigns and seasonality also move it). Cross-market campaigns use SI + HR + IT.</p>' +
      (ww.length ? '<div class="tablewrap"><table class="tbl"><thead><tr><th>#</th><th>Campaign</th><th class="r">Spend</th><th class="r">Revenue</th><th class="r">ROAS</th><th class="r hide-sm">Target</th><th class="r">Incremental</th><th class="r hide-md">Lift / day</th><th>Verdict</th></tr></thead><tbody>' +
        ww.slice(0, 25).map(function (w, i) { var x = w.x, c = x.c; return '<tr><td class="mono muted">' + (i + 1) + '</td><td class="name"><a class="t1" href="#/c/' + c.id + '">' + esc(c.name) + '</a><small>' + esc(TY[c.type].name) + ' · ' + fmtRange(c.start, c.end) + '</small></td><td class="r nw">' + money(x.sp) + '</td><td class="r nw">' + money(x.rev) + '</td><td class="r">' + ratio(x.roas) + '</td><td class="r hide-sm">' + ratio(c.targets.roas) + '</td><td class="r nw ' + (w.inc ? (w.inc.incr >= 0 ? 'good-t' : 'bad-t') : '') + '">' + (w.inc ? (w.inc.incr >= 0 ? '+' : '') + money(w.inc.incr) : '—') + '</td><td class="r hide-md">' + (w.inc ? (w.inc.lift >= 0 ? '+' : '') + pct(w.inc.lift, 0) : '—') + '</td><td><span class="chip tone tone-' + w.v.tone + '">' + w.v.t + '</span></td></tr>'; }).join('') +
        '</tbody></table></div>' + (ww.length > 25 ? '<p class="hint" style="padding:10px 20px">Showing 25 of ' + ww.length + ' — the CSV export has all of them.</p>' : '') : '<div class="card-b"><div class="empty box">No campaigns with at least 300 € spend in this period.</div></div>') + '<div style="height:8px"></div></div>';
    after(drawCharts);
    return html;
  }
  var perfTableRows = [], perfWW = [];
  function exportPerfCsv() {
    var P = perfPeriod(), rows = [['Section', 'Item', 'Period from', 'Period to', 'Spend EUR', 'Revenue EUR', 'ROAS', 'Orders', 'CPA EUR', 'Conv. rate', 'CTR', 'Impressions', 'Clicks', 'Sessions', 'New customers', 'Target ROAS', 'Incremental revenue EUR', 'Verdict']];
    perfTableRows.forEach(function (r) { var x = r.a; rows.push(['By ' + ui.perf.tab, r.plain, ymdOf(P.from), ymdOf(P.to), n2(x.sp), n2(x.rev), n2(x.roas), x.ord, n2(x.cpa), n4(x.cvr), n4(x.ctr), x.imp, x.clk, x.ses, x.nc, '', '', '']); });
    perfWW.forEach(function (w) { var x = w.x; rows.push(['Campaign', x.c.name, ymdOf(P.from), ymdOf(P.to), n2(x.sp), n2(x.rev), n2(x.roas), x.ord, n2(x.cpa), n4(x.cvr), n4(x.ctr), x.imp, x.clk, x.ses, x.nc, x.c.targets.roas, w.inc ? n2(w.inc.incr) : '', w.v.t]); });
    downloadCsv('marketing-performance-' + TODAY_YMD + '.csv', rows);
  }

  // ══ Budget ════════════════════════════════════════════════════════════════
  var MONTH_W = [0.07, 0.07, 0.08, 0.08, 0.09, 0.10, 0.09, 0.09, 0.08, 0.08, 0.11, 0.06];
  var bmCache = {};
  function planWeights(c) {
    var a = D.planSplit(c).alloc, w = c.channels.map(function (x) { return a[x] || 0; }), s = w.reduce(function (p, q) { return p + q; }, 0);
    if (!s) { w = c.channels.map(function () { return 1; }); s = w.length || 1; }
    return w.map(function (x) { return x / s; });
  }
  function mShares(c) { return c.market === 'ALL' ? ALL_SPLIT : (function () { var o = {}; o[c.market] = 1; return o; })(); }
  function budgetModel(Y) {
    var key = dataRev + ':' + Y; if (bmCache.key === key) return bmCache.v;
    var y0 = dmake(Y, 1, 1), y1 = dmake(Y, 12, 31), r0 = dnum(db.range.from), r1 = dnum(db.range.to);
    var budgets = db.budgets[Y] || { SI: 0, HR: 0, IT: 0 };
    var months = [], i, m;
    for (i = 0; i < 12; i++) months.push({ plan: {}, sp: {}, fut: {} });
    var M = {}; MKT3.forEach(function (k) { M[k] = { budget: +budgets[k] || 0, plan: 0, sp: 0, fut: 0, ideas: 0 }; for (i = 0; i < 12; i++) { months[i].plan[k] = 0; months[i].sp[k] = 0; months[i].fut[k] = 0; } });
    var CHT = {}; CHANNELS.forEach(function (ch) { CHT[ch.id] = { plan: 0, sp: 0 }; });
    var over = [];
    db.campaigns.forEach(function (c) {
      if (c.status === 'cancelled') return;
      var s = dnum(c.start), e = dnum(c.end); if (e < y0 || s > y1) return;
      var len = e - s + 1, per = c.budget / len, shares = mShares(c), ws = planWeights(c);
      var a = Math.max(s, y0), b = Math.min(e, y1);
      for (var d = a; d <= b; d++) {
        var mi = ymParts(d).m - 1;
        Object.keys(shares).forEach(function (k) {
          var v = per * shares[k];
          if (c.status === 'idea') { M[k].ideas += v; return; }
          months[mi].plan[k] += v; M[k].plan += v;
          if (d >= TODAY && c.status !== 'done') { months[mi].fut[k] += v; M[k].fut += v; }
        });
        if (c.status !== 'idea') c.channels.forEach(function (x, j) { CHT[x].plan += per * ws[j]; });
      }
      var pa = perf(c), spY = 0;
      pa.rows.forEach(function (r) {
        if (r.d < y0 || r.d > y1 || !r.sp) return;
        var mi2 = ymParts(r.d).m - 1; spY += r.sp;
        Object.keys(shares).forEach(function (k) { months[mi2].sp[k] += r.sp * shares[k]; M[k].sp += r.sp * shares[k]; });
        CHT[r.ch].sp += r.sp;
      });
      if (pa.agg.sp > c.budget * 1.05 && c.budget) over.push({ c: c, sp: pa.agg.sp, kind: 'over' });
      else if (c.status === 'live' && c.budget) {
        // pacing: only the channels that spend day by day (not one-off sends or print)
        var el = (Math.min(TODAY - 1, e) - s + 1) / len, al = D.planSplit(c).alloc, tAlloc = 0, tSp = 0;
        c.channels.forEach(function (x) { var k = CH[x].kind; if (k === 'cpc' || k === 'fee' || k === 'broadcast') tAlloc += al[x] || 0; });
        pa.rows.forEach(function (r) { var k = CH[r.ch].kind; if (k === 'cpc' || k === 'fee' || k === 'broadcast') tSp += r.sp; });
        if (el > 0.2 && tAlloc && tSp > tAlloc * el * 1.15) over.push({ c: c, sp: pa.agg.sp, kind: 'pacing', el: el });
      }
    });
    // monthly budget = annual × seasonal weight, rescaled to the months the demo data covers
    var cover = 0; for (i = 0; i < 12; i++) { m = dmake(Y, i + 1, 1); if (D.lastOfMonth(Y, i + 1) >= r0 && m <= r1) cover += MONTH_W[i]; }
    months.forEach(function (mo, idx) {
      var ms = dmake(Y, idx + 1, 1), inR = D.lastOfMonth(Y, idx + 1) >= r0 && ms <= r1;
      mo.inRange = inR; mo.budget = {}; MKT3.forEach(function (k) { mo.budget[k] = inR && cover ? M[k].budget * MONTH_W[idx] / cover : 0; });
      mo.past = D.lastOfMonth(Y, idx + 1) < TODAY; mo.current = ms <= TODAY && D.lastOfMonth(Y, idx + 1) >= TODAY;
    });
    MKT3.forEach(function (k) { M[k].forecast = M[k].sp + M[k].fut; });
    var v = { Y: Y, months: months, M: M, CHT: CHT, over: over, cover: cover };
    bmCache = { key: key, v: v };
    return v;
  }
  function msum(o, mk) { return mk ? o[mk] || 0 : MKT3.reduce(function (s, k) { return s + (o[k] || 0); }, 0); }
  function budgetWarnings(Y) {
    if (!db.budgets[Y] && !db.campaigns.some(function (c) { return c.start.slice(0, 4) === String(Y); })) return [];
    var bm = budgetModel(Y), out = [];
    MKT3.forEach(function (k) {
      var x = bm.M[k];
      if (!x.budget) return;
      if (x.sp > x.budget) out.push({ level: 'bad', text: MK[k].name + ': spent ' + money(x.sp) + ' — already ' + money(x.sp - x.budget) + ' over the annual budget of ' + money(x.budget) + '.' });
      else if (x.forecast > x.budget) out.push({ level: 'bad', text: MK[k].name + ': forecast to year end ' + money(x.forecast) + ' is ' + money(x.forecast - x.budget) + ' over the annual budget of ' + money(x.budget) + '.' });
      else if (x.forecast > x.budget * 0.95) out.push({ level: 'warn', text: MK[k].name + ': forecast ' + money(x.forecast) + ' uses ' + pct(x.forecast / x.budget, 0) + ' of the annual budget.' });
    });
    bm.months.forEach(function (mo, i) {
      if (!mo.inRange || !(mo.past || mo.current)) return;
      var sp = msum(mo.sp), bu = msum(mo.budget);
      if (bu && sp > bu * 1.1) out.push({ level: 'warn', text: MON[i] + ' ' + Y + ': spent ' + money(sp) + ' vs a monthly budget of ' + money(bu) + ' (+' + pct(sp / bu - 1, 0) + ').' });
    });
    bm.over.forEach(function (o) {
      if (o.kind === 'over') out.push({ level: 'bad', href: '#/c/' + o.c.id, text: o.c.name + ': spent ' + money(o.sp) + ' of ' + money(o.c.budget) + ' planned (+' + pct(o.sp / o.c.budget - 1, 0) + ').' });
      else out.push({ level: 'warn', href: '#/c/' + o.c.id, text: o.c.name + ': pacing ahead — ' + money(o.sp) + ' spent after ' + pct(o.el, 0) + ' of the days (' + pct(o.sp / o.c.budget, 0) + ' of budget).' });
    });
    return out;
  }
  function budgetYears() {
    var ys = {}; Object.keys(db.budgets).forEach(function (y) { ys[y] = 1; }); db.campaigns.forEach(function (c) { ys[c.start.slice(0, 4)] = 1; });
    return Object.keys(ys).sort();
  }
  function viewBudget() {
    var years = budgetYears(), Y = +ui.budget.year; if (years.indexOf(String(Y)) < 0) Y = +(years.indexOf(TODAY_YMD.slice(0, 4)) >= 0 ? TODAY_YMD.slice(0, 4) : years[years.length - 1]);
    var bm = budgetModel(Y), M = bm.M, tb = sum(MKT3, function (k) { return M[k].budget; }), tp = sum(MKT3, function (k) { return M[k].plan; }), ts = sum(MKT3, function (k) { return M[k].sp; }), tf = sum(MKT3, function (k) { return M[k].forecast; }), ti = sum(MKT3, function (k) { return M[k].ideas; });
    var warns = budgetWarnings(Y), isCur = Y === ymParts(TODAY).y;
    var html = head('Plan', 'Budget<span class="dot">.</span>', '<span>Annual budgets per market; cross-market campaigns count ' + MKT3.map(function (k) { return pct(ALL_SPLIT[k], 0) + ' ' + k; }).join(' · ') + '</span>',
      '<label class="sr" for="bgY">Year</label><select class="select" id="bgY" data-chg="budget-year">' + years.map(function (y) { return '<option' + (+y === Y ? ' selected' : '') + '>' + y + '</option>'; }).join('') + '</select><button type="button" class="btn" data-act="csv-budget" data-y="' + Y + '">' + icon('download') + 'CSV</button>');
    if (bm.cover < 0.999) html += '<div class="banner info" role="note">' + icon('info') + '<div>The demo data covers ' + fmtRange(db.range.from, db.range.to) + ', so ' + Y + ' is only partly covered; monthly budgets are spread over the covered months.</div></div>';
    var rem = tb - ts;
    html += '<div class="kpis">' + kpiTile('Annual budget ' + Y, money(tb), 'SI ' + moneyK(M.SI.budget) + ' · HR ' + moneyK(M.HR.budget) + ' · IT ' + moneyK(M.IT.budget), '') +
      kpiTile('Planned in campaigns', money(tp), pct(tb ? tp / tb : null, 0) + ' of budget' + (ti ? ' · +' + moneyK(ti) + ' in ideas' : ''), tp > tb ? 'bad' : '') +
      kpiTile('Spent' + (isCur ? ' to date' : ''), money(ts), pct(tb ? ts / tb : null, 0) + ' of budget', ts > tb ? 'bad' : '') +
      kpiTile('Remaining', money(rem), rem < 0 ? 'over budget' : 'not yet spent', rem < 0 ? 'bad' : 'good') +
      kpiTile('Forecast year end', money(tf), tf > tb ? money(tf - tb) + ' over budget' : money(tb - tf) + ' headroom', tf > tb ? 'bad' : 'good') + '</div>';
    // warnings
    html += '<div class="card" style="margin-bottom:16px"><div class="card-h"><div><span class="label">' + Y + '</span><h2>Over-budget warnings (' + warns.length + ')</h2></div></div>' +
      (warns.length ? '<ul class="rows">' + warns.map(function (w) { return '<li class="' + (w.level === 'bad' ? 'warn' : '') + '"><span class="' + (w.level === 'bad' ? 'warnic' : 'muted') + '">' + icon(w.level === 'bad' ? 'warn' : 'info') + '</span><div class="main">' + (w.href ? '<a href="' + w.href + '">' + esc(w.text) + '</a>' : '<span>' + esc(w.text) + '</span>') + '</div></li>'; }).join('') + '</ul>' : '<div class="card-b"><div class="empty box"><b>All within budget</b>No market, month or campaign is over budget.</div></div>') + '</div>';
    // chart
    var ms = bm.months.map(function (mo, i) { return { label: MON3[i], full: MON[i] + ' ' + Y, plan: msum(mo.plan), sp: msum(mo.sp), budget: msum(mo.budget) }; });
    chartData.budget = ms;
    html += '<div class="card"><div class="card-h"><div><span class="label">' + Y + ' · all markets</span><h2>Planned vs spent per month</h2></div></div><div class="legend"><span><i class="plan"></i>Planned</span><span><i class="rev"></i>Spent</span><span><i class="spend" style="background:var(--bad-dot)"></i>Spent over budget</span><span><i class="budget"></i>Monthly budget</span></div><div class="chart" data-chart="budget"></div>' +
      '<div class="tablewrap"><table class="tbl"><thead><tr><th>Month</th><th class="r">Budget</th><th class="r">Planned</th><th class="r">Spent</th><th class="r hide-sm">Spent vs plan</th><th class="r">Forecast</th><th class="hide-sm">Status</th></tr></thead><tbody>' +
      bm.months.map(function (mo, i) {
        if (!mo.inRange) return '';
        var bu = msum(mo.budget), pl = msum(mo.plan), sp = msum(mo.sp), fc = mo.past ? sp : sp + msum(mo.fut);
        var st = mo.past || mo.current ? (sp > bu * 1.05 ? '<span class="chip bad">Over budget</span>' : '<span class="chip good">OK</span>') : (pl > bu * 1.05 ? '<span class="chip bad">Planned over</span>' : '<span class="chip">Planned</span>');
        return '<tr><td class="nw">' + MON[i] + (mo.current ? ' <span class="muted">(now)</span>' : '') + '</td><td class="r nw">' + money(bu) + '</td><td class="r nw">' + money(pl) + '</td><td class="r nw">' + (mo.past || mo.current ? money(sp) : '—') + '</td><td class="r nw hide-sm ' + (mo.past && sp > pl ? 'bad-t' : '') + '">' + (mo.past && pl ? (sp >= pl ? '+' : '') + pct(sp / pl - 1, 0) : '—') + '</td><td class="r nw">' + money(fc) + '</td><td class="hide-sm">' + st + '</td></tr>';
      }).join('') + '</tbody><tfoot><tr><td>Total</td><td class="r nw">' + money(tb) + '</td><td class="r nw">' + money(tp) + '</td><td class="r nw">' + money(ts) + '</td><td class="hide-sm"></td><td class="r nw">' + money(tf) + '</td><td class="hide-sm"></td></tr></tfoot></table></div></div><div class="gap"></div>';
    // markets + channels
    html += '<div class="grid2 even"><div class="card"><div class="card-h"><div><span class="label">Edit the annual budgets here</span><h2>By market</h2></div></div><div class="tablewrap"><table class="tbl"><thead><tr><th>Market</th><th class="r">Annual budget</th><th class="r">Planned</th><th class="r">Spent</th><th class="r hide-sm">Remaining</th><th class="r">Forecast</th></tr></thead><tbody>' +
      MKT3.map(function (k) { var x = M[k], ov = x.budget && x.forecast > x.budget; return '<tr><td>' + mktChip(k) + ' ' + esc(MK[k].name) + '<span class="minibar' + (x.budget && x.sp > x.budget ? ' over' : '') + '" style="margin-top:6px" title="' + pct(x.budget ? x.sp / x.budget : null, 0) + ' spent"><i style="width:' + Math.min(100, x.budget ? x.sp / x.budget * 100 : 0) + '%"></i></span></td><td class="r"><label class="sr" for="bgIn' + k + '">' + esc(MK[k].name) + ' annual budget, euros</label><input class="in cell" type="number" min="0" step="1000" id="bgIn' + k + '" data-chg="budget-set" data-y="' + Y + '" data-k="' + k + '" value="' + Math.round(x.budget) + '"></td><td class="r nw">' + money(x.plan) + '</td><td class="r nw">' + money(x.sp) + '</td><td class="r nw hide-sm ' + (x.budget - x.sp < 0 ? 'bad-t' : '') + '">' + money(x.budget - x.sp) + '</td><td class="r nw ' + (ov ? 'bad-t' : '') + '">' + (ov ? warnIc('Forecast over budget') + ' ' : '') + money(x.forecast) + '</td></tr>'; }).join('') +
      '</tbody></table></div><p class="hint" style="padding:10px 20px 16px">Forecast = spent to date + the planned budget of planned, in-production and live campaigns for the rest of ' + Y + '. Ideas are not counted.</p></div>' +
      '<div class="card"><div class="card-h"><div><span class="label">' + Y + ' · planned split by typical channel weight</span><h2>By channel</h2></div></div><div class="tablewrap"><table class="tbl"><thead><tr><th>Channel</th><th class="r">Planned</th><th class="r">Spent</th><th class="hide-sm" style="min-width:100px">Spent of plan</th></tr></thead><tbody>' +
      CHANNELS.filter(function (ch) { return bm.CHT[ch.id].plan || bm.CHT[ch.id].sp; }).sort(function (x, y) { return bm.CHT[y.id].sp - bm.CHT[x.id].sp; }).map(function (ch) { var x = bm.CHT[ch.id], r = x.plan ? x.sp / x.plan : null; return '<tr><td>' + chChip(ch.id) + '</td><td class="r nw">' + money(x.plan) + '</td><td class="r nw">' + money(x.sp) + '</td><td class="hide-sm"><span class="minibar' + (r > 1.05 ? ' over' : '') + '" title="' + pct(r, 0) + '"><i style="width:' + Math.min(100, (r || 0) * 100) + '%"></i></span></td></tr>'; }).join('') +
      '</tbody></table></div><p class="hint" style="padding:10px 20px 16px">E-mail and SMS spend is the sending cost; organic posts have no media spend.</p></div></div>';
    after(drawCharts);
    return html;
  }
  function exportBudgetCsv(Y) {
    var bm = budgetModel(Y), rows = [['Year', 'Month', 'Market', 'Budget EUR', 'Planned EUR', 'Spent EUR', 'Forecast EUR']];
    bm.months.forEach(function (mo, i) { if (!mo.inRange) return; MKT3.forEach(function (k) { rows.push([Y, i + 1, k, n2(mo.budget[k]), n2(mo.plan[k]), n2(mo.sp[k]), n2(mo.past ? mo.sp[k] : mo.sp[k] + mo.fut[k])]); }); });
    downloadCsv('marketing-budget-' + Y + '.csv', rows);
  }

  // ══ UTM builder ═══════════════════════════════════════════════════════════
  var MEDIUMS = ['cpc', 'paid_social', 'email', 'sms', 'social', 'influencer', 'affiliate', 'qr', 'offline', 'display'];
  function utmNorm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9._-]+/g, '').replace(/-{2,}/g, '-').replace(/^[-_]+|[-_]+$/g, ''); }
  function utmCampaign(c) {
    var code = c.code ? utmNorm(c.code.replace(new RegExp('-(' + MKT3.join('|') + ')$'), '')) : '';
    return (c.start.slice(0, 7) + '_' + c.market.toLowerCase() + '_' + c.type.replace(/_/g, '-') + (code ? '_' + code : '')).slice(0, 60);
  }
  function utmPreset(chId) { var ch = CH[chId]; if (!ch) return null; return { source: ch.utm[0], medium: ch.utm[1], content: chId === 'gads_shopping' ? 'shopping' : chId === 'gads_pmax' ? 'pmax' : chId === 'gads_search' ? 'search' : '' }; }
  function utmIssues(u) {
    var out = [];
    ['source', 'medium', 'campaign'].forEach(function (k) { if (!u[k]) out.push('utm_' + k + ' is required.'); });
    ['source', 'medium', 'campaign', 'content', 'term'].forEach(function (k) {
      var v = u[k] || ''; if (!v) return;
      if (/[A-Z]/.test(v)) out.push('utm_' + k + ' has capital letters — GA4 treats “Meta” and “meta” as different sources.');
      if (/\s/.test(v)) out.push('utm_' + k + ' has spaces — use hyphens.');
      if (/[^a-zA-Z0-9._\s-]/.test(v)) out.push('utm_' + k + ' has special characters or accents — use a–z, 0–9, hyphens and underscores.');
    });
    if (u.medium && MEDIUMS.indexOf(u.medium) < 0) out.push('utm_medium “' + u.medium + '” is not one of the agreed mediums (' + MEDIUMS.join(', ') + ').');
    if (u.campaign && !/^\d{4}-\d{2}_(si|hr|it|all)_[a-z0-9-]+(_[a-z0-9-]+)*$/.test(u.campaign)) out.push('utm_campaign does not follow the naming rule yyyy-mm_market_type[_code].');
    if (u.campaign && u.campaign.length > 60) out.push('utm_campaign is longer than 60 characters.');
    var b = parseBase(u.base);
    if (!u.base) out.push('Enter the landing page URL.'); else if (!b) out.push('The landing page must be a full http(s) URL.');
    else if (/[?&]utm_/.test(u.base)) out.push('The landing page already has UTM parameters — they will be replaced.');
    return out;
  }
  function parseBase(s) { try { var x = new URL(String(s || '').trim()); return /^https?:$/.test(x.protocol) ? x : null; } catch (e) { return null; } }
  function buildUtm(u) {
    var x = parseBase(u.base); if (!x) return '';
    ['source', 'medium', 'campaign', 'content', 'term'].forEach(function (k) { x.searchParams.delete('utm_' + k); });
    ['source', 'medium', 'campaign', 'content', 'term'].forEach(function (k) { if (u[k]) x.searchParams.set('utm_' + k, u[k]); });
    return x.toString();
  }
  function viewUtm(cidFromRoute) {
    var u = ui.utm;
    if (cidFromRoute && camp(cidFromRoute) && String(u.cid) !== String(cidFromRoute)) { setUtmCampaign(cidFromRoute); }
    var c = camp(u.cid), issues = utmIssues(u), url = buildUtm(u);
    var camps = db.campaigns.filter(function (x) { return x.status !== 'cancelled' && x.end >= ymdOf(TODAY - 60); }).sort(function (a, b) { return a.start < b.start ? -1 : 1; });
    if (c && camps.indexOf(c) < 0) camps.unshift(c);
    var html = head('Track', 'UTM builder<span class="dot">.</span>', '<span>Builds tagged links in your browser — nothing is fetched, shortened or sent.</span>');
    html += '<div class="grid2"><div class="stack"><div class="card"><div class="card-h"><div><span class="label">Link</span><h2>Build a tagged URL</h2></div>' + (c ? '<a class="btn sm" href="#/c/' + c.id + '">Open campaign</a>' : '') + '</div><div class="card-b" style="display:flex;flex-direction:column;gap:12px">' +
      '<div class="field"><label for="utCid">Campaign</label><select class="in" id="utCid" data-chg="utm-cid"><option value="">— None, enter everything by hand —</option>' + camps.map(function (x) { return '<option value="' + x.id + '"' + (c && x.id === c.id ? ' selected' : '') + '>' + esc(x.name + ' · ' + fmtRange(x.start, x.end)) + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label for="utBase">Landing page URL</label><input class="in" id="utBase" type="url" data-inp="utm" data-k="base" value="' + esc(u.base) + '" placeholder="https://example.com/si/…"></div>' +
      '<div class="field"><label for="utCh">Channel preset</label><select class="in" id="utCh" data-chg="utm-ch"><option value="">— Choose to fill source &amp; medium —</option>' + CHANNELS.map(function (ch) { return '<option value="' + ch.id + '"' + (ch.id === u.ch ? ' selected' : '') + '>' + esc(ch.name + ' → ' + ch.utm[0] + ' / ' + ch.utm[1]) + '</option>'; }).join('') + '</select></div>' +
      '<div class="row2"><div class="field"><label for="utSrc">utm_source <span class="req">*</span></label><input class="in" id="utSrc" data-inp="utm" data-k="source" value="' + esc(u.source) + '" placeholder="facebook"></div>' +
      '<div class="field"><label for="utMed">utm_medium <span class="req">*</span></label><input class="in" id="utMed" list="utMedList" data-inp="utm" data-k="medium" value="' + esc(u.medium) + '" placeholder="paid_social"><datalist id="utMedList">' + MEDIUMS.map(function (m) { return '<option value="' + m + '">'; }).join('') + '</datalist></div></div>' +
      '<div class="field"><label for="utCmp">utm_campaign <span class="req">*</span></label><div style="display:flex;gap:8px"><input class="in" id="utCmp" data-inp="utm" data-k="campaign" value="' + esc(u.campaign) + '" placeholder="2026-11_si_black-friday_bf50">' + (c ? '<button type="button" class="btn" data-act="utm-rule" title="Apply the naming rule">Use rule</button>' : '') + '</div></div>' +
      '<div class="row2"><div class="field"><label for="utCnt">utm_content <span class="hint">creative / variant</span></label><input class="in" id="utCnt" data-inp="utm" data-k="content" value="' + esc(u.content) + '" placeholder="carousel-a"></div>' +
      '<div class="field"><label for="utTerm">utm_term <span class="hint">optional</span></label><input class="in" id="utTerm" data-inp="utm" data-k="term" value="' + esc(u.term) + '" placeholder="progressive-lenses"></div></div>' +
      '<div class="field"><span class="lab">Tagged URL</span><div class="utm-out"><output class="utm-url" id="utOut" aria-live="polite">' + (url ? esc(url) : '<span class="muted">Fill in the landing page, source, medium and campaign.</span>') + '</output></div></div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:8px"><button type="button" class="btn pri" data-act="copy" data-text="' + esc(url) + '"' + (url ? '' : ' disabled') + '>' + icon('copy') + 'Copy URL</button>' + (c ? '<button type="button" class="btn" data-act="utm-save"' + (url && !issues.filter(function (x) { return /required|full http/.test(x); }).length ? '' : ' disabled') + '>Save to campaign</button>' : '') + '<button type="button" class="btn ghost" data-act="utm-clear">Clear</button></div>' +
      '<ul class="issues" aria-live="polite">' + (issues.length ? issues.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') : '<li class="ok">' + icon('check') + ' Follows the naming rules.</li>') + '</ul>' +
      (issues.some(function (x) { return /capital|spaces|special/.test(x); }) ? '<div><button type="button" class="btn sm" data-act="utm-fix">Fix formatting automatically</button></div>' : '') +
      '</div></div>';
    if (c) {
      var rows = c.channels.map(function (chId) { var p = utmPreset(chId), uu = Object.assign({}, u, { source: p.source, medium: p.medium, content: p.content || utmNorm(CH[chId].short), campaign: u.campaign || utmCampaign(c) }); return { ch: chId, u: uu, url: buildUtm(uu) }; });
      utmRows = rows;
      html += '<div class="card"><div class="card-h"><div><span class="label">' + esc(c.name) + '</span><h2>One link per channel</h2></div><button type="button" class="btn sm" data-act="utm-all-csv">' + icon('download') + 'CSV</button></div><div class="tablewrap"><table class="tbl"><thead><tr><th>Channel</th><th>Source / medium</th><th>URL</th><th></th></tr></thead><tbody>' +
        rows.map(function (r) { return '<tr><td class="nw">' + chChip(r.ch) + '</td><td class="nw mono" style="font-size:12.5px">' + esc(r.u.source + ' / ' + r.u.medium) + '</td><td class="urlcell">' + (r.url ? esc(r.url) : '<span class="muted">Needs a landing page</span>') + '</td><td><button type="button" class="btn sm icon" data-act="copy" data-text="' + esc(r.url) + '" aria-label="Copy the ' + esc(CH[r.ch].name) + ' link"' + (r.url ? '' : ' disabled') + '>' + icon('copy') + '</button></td></tr>'; }).join('') +
        '</tbody></table></div><p class="hint" style="padding:10px 20px 16px">Google Ads normally uses auto-tagging (gclid); keep these UTM links for reporting outside Google Analytics or when auto-tagging is off.</p></div>';
      html += '<div class="card"><div class="card-h"><div><span class="label">Saved on the campaign</span><h2>Saved links (' + c.utms.length + ')</h2></div></div>' + (c.utms.length ? '<ul class="rows">' + c.utms.map(function (x) { return '<li><div class="main"><span class="urlcell" style="display:block">' + esc(x.url) + '</span><div class="meta"><span>' + esc(x.source + ' / ' + x.medium) + '</span><span>' + fmtTs(x.at) + '</span></div></div><div class="end"><button type="button" class="btn sm icon" data-act="copy" data-text="' + esc(x.url) + '" aria-label="Copy link">' + icon('copy') + '</button><button type="button" class="btn sm icon ghost" data-act="utm-del" data-id="' + x.id + '" aria-label="Remove saved link">' + icon('trash') + '</button></div></li>'; }).join('') + '</ul>' : '<div class="card-b"><div class="empty box">No links saved yet. “Save to campaign” keeps the link here and ticks “Tracking / UTM set up” in the checklist.</div></div>') + '</div>';
    }
    html += '</div><div class="card"><div class="card-h"><div><span class="label">House rules</span><h2>Naming rules</h2></div></div><ol class="rules">' +
      '<li>Everything lower-case, ASCII only (no č, š, ž, đ), no spaces — hyphens inside a part, underscores between parts.</li>' +
      '<li><span class="code">utm_campaign</span> = <span class="code">yyyy-mm_market_type[_code]</span>, e.g. <span class="code">2026-11_si_black-friday_bf50</span>. The month is the start month; market is si, hr, it or all.</li>' +
      '<li><span class="code">utm_source</span> is the platform or sender: google, facebook, instagram, tiktok, newsletter, sms, pricecompare, instore, radio.</li>' +
      '<li><span class="code">utm_medium</span> is one of: ' + MEDIUMS.map(function (m) { return '<span class="code">' + m + '</span>'; }).join(' ') + '.</li>' +
      '<li><span class="code">utm_content</span> names the creative or placement (carousel-a, story-video, header-banner). <span class="code">utm_term</span> only for paid search keywords.</li>' +
      '<li>Same campaign, same <span class="code">utm_campaign</span> in every channel — that is what lets the Performance view add them up.</li></ol></div></div>';
    return html;
  }
  var utmRows = [];
  function setUtmCampaign(id) {
    var c = camp(id), u = ui.utm;
    u.cid = c ? String(c.id) : '';
    if (c) { u.base = c.url || u.base; u.campaign = utmCampaign(c); var ch = c.channels[0], p = utmPreset(ch); if (p) { u.ch = ch; u.source = p.source; u.medium = p.medium; u.content = p.content; } u.term = ''; }
    saveUi();
  }

  // ══ Live data (approved accounts only) ════════════════════════════════════
  // Real ad numbers from /api/marketing/* (read-only GETs). Kept in memory for this tab only (plus the server's
  // 10-minute cache): never written to IndexedDB, localStorage or the sync snapshot.
  var LIVE = { session: null };
  var MODEKEY = 'adrial-marketing-mode';
  var liveCache = new Map(), liveTimer = null, aggMemo = new Map();
  var adIndex = {};          // key → latest campaign row seen (names for links; in memory only)
  var adsNow = null;         // the ad-activity layer on screen (for its dialogs)
  var lpIdx = {};            // key → campaign row of the Performance page's current period
  var DATA_START = '2025-01-01';
  function liveAllowed() { return !!(LIVE.session && LIVE.session.allowed); }
  function wantMode() { return liveAllowed() && lsGet(MODEKEY) !== 'demo' ? 'live' : 'demo'; }
  function liveReady() { var m = liveCache.get('meta'); return !!(m && m.status === 'ok' && m.data && m.data.dataThrough); }
  function through() { var m = liveCache.get('meta'); return m && m.status === 'ok' && m.data && m.data.dataThrough || ymdOf(TODAY - 1); }
  function checkSession() {
    var timeout = new Promise(function (res) { setTimeout(function () { res('timeout'); }, 6000); });
    var req = fetch('/api/marketing/session', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    return Promise.race([req, timeout]).then(function (s) {
      LIVE.session = s && typeof s === 'object' ? { signedIn: !!s.signedIn, email: s.email ? String(s.email).toLowerCase() : null, allowed: !!s.allowed } : { signedIn: false, email: null, allowed: false, failed: true };
      if (!LIVE.session.allowed) { liveCache.clear(); aggMemo.clear(); adIndex = {}; lpIdx = {}; adsNow = null; } // nothing real stays in memory
      else liveLoad('meta');
      renderModeUi();
      return LIVE.session;
    });
  }
  function liveLoad(path) {
    var e = liveCache.get(path);
    if (e) return e;
    e = { status: 'loading', data: null, err: '' };
    liveCache.set(path, e);
    if (liveCache.size > 150) { var old = liveCache.keys().next().value; if (old !== 'meta' && old !== path) liveCache.delete(old); }
    e.p = fetch('/api/marketing/' + path, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok) { var er = new Error(j.error || 'The ad data is unavailable right now (' + r.status + ').'); er.status = r.status; throw er; }
          return j;
        });
      })
      .then(function (j) {
        e.status = 'ok'; e.data = j;
        if (j && Array.isArray(j.campaigns)) j.campaigns.forEach(function (r) { adIndex[rowKey(r)] = r; });
      }, function (err) {
        e.status = 'error'; e.err = err && err.message && !/fetch|network/i.test(err.message) ? err.message : 'The ad data could not be reached. Check your connection.';
        if (err && (err.status === 401 || err.status === 403)) sessionLost(e.err);
      })
      .then(function () { aggMemo.clear(); liveChanged(); return e; });
    return e;
  }
  function liveChanged() {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(function () {
      if (!db) return;
      var ae = document.activeElement, main = $('#main');
      // never re-render under someone who is typing (or dragging): try again a bit later
      if (drag || bdrag || (ae && main && main.contains(ae) && /^(INPUT|TEXTAREA)$/.test(ae.tagName) && ae.type !== 'checkbox' && ae.value !== ae.defaultValue)) { liveTimer = setTimeout(liveChanged, 700); return; }
      renderModeUi(); updateNav(); refresh();
    }, 40);
  }
  function sessionLost(msg) {
    checkSession().then(function () {
      if (!liveAllowed() && MODE === 'live') { applyMode('demo'); toast(msg || 'Live ad numbers are no longer available for this account — showing the demo plan.'); }
    });
  }
  function retryLive() {
    liveCache.forEach(function (e, k) { if (e.status === 'error') liveCache.delete(k); });
    if (liveAllowed()) liveLoad('meta');
    refresh();
  }
  function applyMode(m) {
    if (m === 'live' && !liveAllowed()) m = 'demo';
    if (!db) return;                                   // boot picks the mode
    if (m === MODE) { renderModeUi(); updateNav(); refresh(); return; }
    flushNow();
    closeAllModals(); closePop(false); endDrag(true);
    MODE = m; db = plans[m] || (plans[m] = m === 'live' ? emptyLivePlan() : migrate(D.generate(TODAY_YMD)));
    perfCache.clear(); aggMemo.clear(); selPosts = {}; dataRev++;
    var people = peopleList(false).map(function (p) { return p.id; });
    if (ui.f.owner && people.indexOf(ui.f.owner) < 0) ui.f.owner = '';
    if (ui.content.assignee && people.indexOf(ui.content.assignee) < 0) ui.content.assignee = '';
    if (ui.utm.cid && !camp(ui.utm.cid)) ui.utm.cid = '';
    saveUi(); renderModeUi(); updateNav();
    if (current.parts[0] === 'c') location.hash = '#/campaigns'; else route(false);
  }
  function renderModeUi() {
    var pill = $('#modePill'), side = $('#modeSide'), sp = $('#sidePill'), rb = $('#resetBtn');
    if (!pill || !side) return;
    var s = LIVE.session, live = MODE === 'live', m = liveCache.get('meta');
    pill.hidden = false;
    pill.className = 'modepill ' + (live ? 'live' : 'demo');
    if (live) {
      var f = m && m.status === 'ok' ? m.data.freshness || {} : {};
      pill.innerHTML = '<i aria-hidden="true"></i>Live<span class="mp-long">' + (m && m.status === 'ok' ? ' · data through ' + esc(fmtD(through())) : m && m.status === 'error' ? ' · data unavailable' : ' · loading…') + '</span>';
      pill.title = m && m.status === 'ok' ? 'Real ad numbers. Google Ads through ' + (f['Google Ads'] ? fmtD(f['Google Ads']) : '—') + ', Meta Ads through ' + (f['Meta Ads'] ? fmtD(f['Meta Ads']) : '—') + ', GA4 through ' + (f.GA4 ? fmtD(f.GA4) : '—') + '.' : 'Real ad numbers';
    } else { pill.innerHTML = '<i aria-hidden="true"></i>Demo<span class="mp-long"> data</span>'; pill.title = 'Fictional demo plan and numbers'; }
    var h = '';
    if (liveAllowed()) {
      h = '<span class="label">Plan &amp; numbers</span><div class="seg" role="group" aria-label="Live or demo data">' +
        [['live', 'Live'], ['demo', 'Demo']].map(function (x) { return '<button type="button" data-act="mode" data-v="' + x[0] + '" aria-pressed="' + (MODE === x[0]) + '">' + x[1] + '</button>'; }).join('') + '</div>' +
        '<p class="hint">' + (live ? 'Your team’s plan with real Google Ads, Meta and GA4 numbers' + (m && m.status === 'ok' ? ' (data through ' + esc(fmtD(through())) + ')' : '') + '. The demo plan is kept separately.' : 'A separate, fictional demo plan — nothing here mixes with your live plan.') + '</p>';
    } else if (s && s.failed) {
      h = '<p class="hint">Live ad numbers could not be checked right now. <button type="button" class="linkbtn" data-act="live-session-retry">Try again</button></p>';
    } else if (s && s.signedIn) {
      h = '<p class="hint">Live ad numbers are available to approved accounts. ' + esc(s.email || 'This account') + ' is not on the list yet.</p>';
    } else if (s) {
      h = '<p class="hint">Live ad numbers are available to approved accounts — <button type="button" class="linkbtn" data-act="live-signin">sign in</button></p>';
    }
    side.innerHTML = h; side.hidden = !h;
    if (sp) {
      sp.innerHTML = live ? '<i aria-hidden="true" class="on"></i>Live plan · ad numbers are read-only from Google Ads, Meta and GA4 · nothing is ever posted, sent or changed in any ad account · plan saved in this browser, plus your private cloud copy when you sign in to sync'
        : '<i aria-hidden="true"></i>Demo data · nothing is ever posted, sent or published · saved in this browser, plus your private cloud copy when you sign in to sync';
      sp.title = live ? 'The plan is your team’s; the numbers come live from the ad data and are never stored in the browser.' : 'All campaigns, people and numbers are fictional demo data. Nothing is ever posted, sent or published to any ad platform, social network, e-mail or SMS service.';
    }
    if (rb) rb.hidden = live;
  }

  // ── small helpers ──
  function rowKey(r) { return r.platform + '|' + r.market + '|' + r.campaign_key; }
  function platTone(p) { return p === 'Meta' ? 'tone-violet' : 'tone-blue'; }
  function platName(p) { return p === 'Google' ? 'Google Ads' : p === 'Meta' ? 'Meta Ads' : p; }
  function platChip(p) { return '<span class="chip tone ' + platTone(p) + '"><span class="d"></span>' + esc(platName(p)) + '</span>'; }
  function campsPath(from, to) { return 'campaigns?from=' + from + '&to=' + to; }
  function monthlyPath() { var th = dnum(through()); return 'monthly?from=' + ymdOf(Math.max(dnum(DATA_START), monthStart(th - 1080))) + '&to=' + ymdOf(th); }
  function liveWait(m) {
    m = m || liveCache.get('meta');
    if (m && m.status === 'error') return liveErr(m.err);
    return '<div class="card-b"><p class="live-status" role="status"><span class="spin" aria-hidden="true"></span>Loading live ad data…</p></div>';
  }
  function liveErr(msg) { return '<div class="card-b"><div class="err" role="alert">Live ad numbers could not be loaded: ' + esc(msg || 'unknown error') + ' <button type="button" class="btn sm" data-act="live-retry" style="margin-left:6px">Try again</button></div></div>'; }
  var ATTRIB = 'GA4 revenue and orders are what GA4 attributes to the ad campaign’s sessions — roughly last-click. They are not incremental: some of those orders would have happened without the ad, store visits and view-through effects are missing, and the platforms’ own conversions count differently. Use them to compare campaigns, not as proof of profit.';
  function lzero() { return { sp: 0, clk: 0, imp: 0, conv: 0, cval: 0, ses: 0, ord: 0, rev: 0, n: 0 }; }
  function ladd(a, r) { a.sp += +r.spend || 0; a.clk += +r.clicks || 0; a.imp += +r.impressions || 0; a.conv += +r.conversions || 0; a.cval += +r.conv_value || 0; a.ses += +r.sessions || 0; a.ord += +r.orders || 0; a.rev += +r.revenue || 0; a.n++; return a; }
  function lderive(a) { a.roas = a.sp ? a.rev / a.sp : null; a.cpa = a.ord && a.sp ? a.sp / a.ord : null; a.ctr = a.imp ? a.clk / a.imp : null; a.cvr = a.ses ? a.ord / a.ses : null; a.proas = a.sp ? a.cval / a.sp : null; return a; }

  // ── suggestions: name, market and date overlap ──
  var STOP = {}; ['the', 'and', 'for', 'with', 'all', 'rest', 'src', 'pmax', 'shopping', 'feed', 'only', 'always', 'demgen', 'ads', 'campaign', 'campaigns', 'broad', 'test', 'control', 'mobile', 'generic', 'generics', 'seasonal', 'promotion', 'other', 'push', 'search', 'display', 'video', 'remarketing', 'prospecting', 'unclassified', 'new', 'week', 'weeks', 'day', 'days'].forEach(function (w) { STOP[w] = 1; });
  function toks(s) { var o = {}; norm(s).split(/[^a-z0-9]+/).forEach(function (t) { if (t.length >= 3 && !STOP[t] && !/^\d+$/.test(t)) o[t] = 1; }); return o; }
  function planToks(c) { return toks([c.name, c.code.replace(/-(SI|HR|IT)$/, ''), c.offer, c.tags.join(' ')].join(' ')); }
  function suggestScore(c, r, ptoks) {
    var a = Object.keys(ptoks || planToks(c)), b = toks(r.campaign + ' ' + (r.category || '')), bk = Object.keys(b);
    var hit = a.filter(function (t) { return b[t] || (t.length >= 4 && bk.some(function (u) { return u.length >= 4 && (u.indexOf(t) === 0 || t.indexOf(u) === 0); })); }).length;
    var nameS = a.length ? Math.min(1, hit / Math.min(a.length, 3)) : 0;
    var s = dnum(c.start), e = dnum(c.end), rs = dnum(r.first_spend), re = dnum(r.last_spend);
    var ov = Math.max(0, Math.min(e, re) - Math.max(s, rs) + 1), dS = ov / (e - s + 1);
    if (re - rs + 1 > (e - s + 1) * 2.5) dS *= 0.4;   // spends all the time: overlapping dates say little
    var score = 0.55 * nameS + 0.15 * (c.market === r.market ? 1 : c.market === 'ALL' ? 0.6 : 0) + 0.3 * dS;
    if (c.market !== 'ALL' && c.market !== r.market) score *= 0.4;
    return score;
  }
  function chFor(r) {
    if (r.platform === 'Meta') return ['meta'];
    var t = String(r.campaign_type || '').toLowerCase();
    return [t.indexOf('shopping') >= 0 ? 'gads_shopping' : t.indexOf('search') >= 0 ? 'gads_search' : 'gads_pmax'];
  }
  function guessType(r) {
    var n = norm(r.campaign + ' ' + (r.category || ''));
    if (/black ?friday|cyber|\bbf\b/.test(n)) return 'black_friday';
    if (/valentin/.test(n)) return 'valentines';
    if (/school|skol|scuol|\bsola\b/.test(n)) return 'back_to_school';
    if (/sunglass|soncn|suncan|\bsole\b|solari|\bsun\b/.test(n)) return 'summer_sun';
    if (/pregled|eye ?exam|visita|vision test/.test(n)) return 'eye_exam';
    if (/launch|lansir/.test(n)) return 'brand_launch';
    if (/collection|kolekcij|collezion/.test(n)) return 'new_collection';
    if (/\bsale\b|akcij|popust|sconti|saldi|outlet|discount|black week/.test(n)) return 'seasonal_sale';
    if (/lens|lenti|lece|kontakt|contact/.test(n)) return 'cl_subscription';
    if (/influenc/.test(n)) return 'influencer';
    return 'other';
  }
  function presetFromRow(r, note) {
    var th = dnum(through());
    return { name: String(r.campaign).slice(0, 120), market: r.market, type: guessType(r), status: dnum(r.last_spend) >= th - 1 ? 'live' : 'done', start: r.first_spend, end: r.last_spend,
      channels: chFor(r), budget: 0, owner: defaultPerson(''), code: '', offer: '', url: '', targets: { roas: 0, orders: 0, revenue: 0, cpa: 0 }, tags: ['from-ads'], stores: [],
      links: [{ k: rowKey(r), n: String(r.campaign).slice(0, 300) }],
      notes: note || ('Created from the ' + platName(r.platform) + ' campaign “' + r.campaign + '” (' + [r.campaign_type, r.area, r.category].filter(Boolean).join(' · ') + ').') };
  }

  // ── linked campaign numbers (/daily; keys with a comma can only get totals from /campaigns) ──
  function liveWindow(c) { var th = through(), to = c.end < th ? c.end : th; return c.start > to ? null : { from: c.start, to: to }; }
  function liveCampaignData(c, load) {
    if (!c.links.length) return { status: 'none' };
    if (!liveReady()) return { status: 'idle' };
    var w = liveWindow(c); if (!w) return { status: 'future' };
    // every key goes as its own key= parameter, so campaign names with commas work too
    var keys = c.links.map(function (l) { return l.k; }), dk = keys.slice().sort(), ck = [];
    var get = load ? liveLoad : function (p) { return liveCache.get(p) || { status: 'idle' }; };
    var p1 = dk.length ? 'daily?' + dk.map(function (k) { return 'key=' + encodeURIComponent(k); }).join('&') + '&from=' + w.from + '&to=' + w.to : '', p2 = '';
    var e1 = p1 ? get(p1) : { status: 'ok', data: { rows: [] } }, e2 = p2 ? get(p2) : { status: 'ok', data: { campaigns: [] } };
    if (e1.status === 'error' || e2.status === 'error') return { status: 'error', err: e1.err || e2.err, w: w };
    if (e1.status !== 'ok' || e2.status !== 'ok') return { status: e1.status === 'idle' || e2.status === 'idle' ? 'idle' : 'loading', w: w };
    var mk = p1 + '#' + p2 + '#' + keys.join('\n'), hit = aggMemo.get(mk);
    if (hit) return hit;
    var rows = [], byKey = {}, agg = zero(); agg.conv = 0; agg.cval = 0;
    keys.forEach(function (k) { byKey[k] = { sp: 0, clk: 0, imp: 0, conv: 0, cval: 0, ses: 0, ord: 0, rev: 0, days: 0 }; });
    (e1.data.rows || []).forEach(function (r) {
      var k = rowKey(r), x = { d: dnum(r.date), ch: r.platform, k: k, imp: +r.impressions || 0, clk: +r.clicks || 0, sp: +r.spend || 0, ses: +r.sessions || 0, ord: +r.orders || 0, rev: +r.revenue || 0, nc: 0, conv: +r.conversions || 0, cval: +r.conv_value || 0 };
      rows.push(x); addRow(agg, x); agg.conv += x.conv; agg.cval += x.cval;
      var b = byKey[k]; if (b) { b.sp += x.sp; b.clk += x.clk; b.imp += x.imp; b.conv += x.conv; b.cval += x.cval; b.ses += x.ses; b.ord += x.ord; b.rev += x.rev; if (x.sp > 0) b.days++; }
    });
    (e2.data.campaigns || []).forEach(function (r) {
      var k = rowKey(r); if (ck.indexOf(k) < 0) return;
      var b = byKey[k]; b.sp += +r.spend || 0; b.clk += +r.clicks || 0; b.imp += +r.impressions || 0; b.conv += +r.conversions || 0; b.cval += +r.conv_value || 0; b.ses += +r.sessions || 0; b.ord += +r.orders || 0; b.rev += +r.revenue || 0; b.days = +r.active_days || 0;
      addRow(agg, { imp: b.imp, clk: b.clk, sp: b.sp, ses: b.ses, ord: b.ord, rev: b.rev, nc: 0 }); agg.conv += b.conv; agg.cval += b.cval;
    });
    var out = { status: 'ok', w: w, rows: rows, byKey: byKey, agg: derive(agg), commaKeys: ck };
    aggMemo.set(mk, out);
    return out;
  }
  function livePerf(c) {
    var x = liveCampaignData(c, false);
    return x.status === 'ok' ? { rows: x.rows, agg: x.agg, loaded: true } : { rows: [], agg: derive(zero()), loaded: false };
  }

  // ── campaign detail: linked ad campaigns + live results ──
  function linksCard(c) {
    var x = liveCampaignData(c, false), byKey = x.status === 'ok' ? x.byKey : {};
    return '<div class="card"><div class="card-h"><div><span class="label">Live · real ad campaigns</span><h2>Linked ad campaigns (' + c.links.length + ')</h2></div><button type="button" class="btn sm" data-act="link-pick" data-id="' + c.id + '">' + icon('link') + (c.links.length ? 'Change links' : 'Link ad campaigns') + '</button></div>' +
      (c.links.length ? '<ul class="rows">' + c.links.map(function (l) {
        var p = keyParts(l.k), t = byKey[l.k];
        return '<li><span class="sdot ' + platTone(p.platform) + '" style="width:9px;height:9px"></span><div class="main"><span class="t">' + esc(l.n) + '</span><div class="meta"><span>' + esc(platName(p.platform) + ' · ' + p.market) + '</span>' +
          (t ? '<span>' + money(t.sp) + ' spend in these dates</span>' : '') + (l.k.indexOf(',') >= 0 ? '<span>totals only (its name has a comma)</span>' : '') + '</div></div>' +
          '<div class="end"><button type="button" class="btn sm icon ghost" data-act="link-del" data-id="' + c.id + '" data-k="' + esc(l.k) + '" aria-label="Unlink ' + esc(l.n) + '" title="Unlink">' + icon('close') + '</button></div></li>';
      }).join('') + '</ul>' : '<div class="card-b"><p class="hint" style="margin:0">Pick the real Google Ads / Meta campaigns that belong to this plan. Only their keys are stored on the plan (and synced with it); the numbers are always fetched fresh.</p></div>') + '</div>';
  }
  function liveSection(c) {
    var h = '<div class="card"><div class="card-h"><div><span class="label">Performance · live ad data' + (liveReady() ? ' · through ' + fmtD(through()) : '') + '</span><h2>Results vs targets</h2></div></div>';
    if (!liveReady()) return h + liveWait() + '</div>';
    if (!c.links.length) return h + '<div class="card-b"><div class="empty box"><b>No ad campaigns linked yet</b>Link the real Google Ads or Meta campaigns of this plan to see their spend, clicks, conversions and GA4 results within its dates, against the targets above.<br><button type="button" class="btn sm" data-act="link-pick" data-id="' + c.id + '" style="margin-top:10px">' + icon('link') + 'Link ad campaigns</button></div></div></div>';
    var x = liveCampaignData(c, true);
    if (x.status === 'future') return h + '<div class="card-b"><div class="empty box"><b>No results yet</b>It starts ' + esc(relDays(dnum(c.start))) + '; the ad data runs through ' + esc(fmtD(through())) + '.</div></div></div>';
    if (x.status === 'error') return h + liveErr(x.err) + '</div>';
    if (x.status !== 'ok') return h + '<div class="card-b"><p class="live-status" role="status"><span class="spin" aria-hidden="true"></span>Loading the linked campaigns’ numbers…</p></div></div>';
    var a = x.agg, tg = c.targets || {}, w = x.w;
    var vr = vsTarget(a.rev, tg.revenue, false, money), vo = vsTarget(a.ord, tg.orders, false, int), vroas = vsTarget(a.roas, tg.roas, false, ratio), vc = vsTarget(a.cpa, tg.cpa, true, function (v) { return money2(v); });
    h += '<p class="hint" style="padding:0 20px 8px;margin:0">' + esc(fmtRange(w.from, w.to)) + ' · ' + c.links.length + ' linked campaign' + (c.links.length > 1 ? 's' : '') + (w.to < c.end ? ' · the campaign runs until ' + esc(fmtD(c.end)) + ', data so far' : '') + '</p>';
    h += '<div class="kpis" style="padding:0 20px;margin-bottom:12px;grid-template-columns:repeat(auto-fit,minmax(min(100%,150px),1fr))">' +
      tile('Spend', money(a.sp), c.budget ? pct(a.sp / c.budget, 0) + ' of ' + money(c.budget) + ' planned' : 'no budget planned', c.budget && a.sp > c.budget * 1.05 ? 'bad' : '') +
      tile('GA4 revenue', money(a.rev), vr.s, vr.c) + tile('ROAS (GA4)', ratio(a.roas), vroas.s, vroas.c) + tile('GA4 orders', int(a.ord), vo.s, vo.c) +
      tile('CPA (GA4)', eurOr(a.cpa, true), vc.s, vc.c) + tile('CTR', pct(a.ctr, 2), int(a.clk) + ' clicks · ' + int(a.imp) + ' impr.') +
      tile('Platform conversions', NF1.format(a.conv || 0), money(a.cval) + ' value · ROAS ' + ratio(a.sp ? a.cval / a.sp : null)) + tile('GA4 sessions', int(a.ses), 'conv. rate ' + pct(a.cvr, 2)) + '</div>';
    var from = dnum(w.from), to = dnum(w.to), days = [];
    for (var d = from; d <= to; d++) days.push({ d: d, sp: 0, rev: 0, ord: 0 });
    x.rows.forEach(function (r) { var y = days[r.d - from]; if (y) { y.sp += r.sp; y.rev += r.rev; y.ord += r.ord; } });
    chartData['daily-' + c.id] = days;
    h += '<div class="legend"><span><i class="rev"></i>GA4 revenue per day</span><span><i class="spend"></i>Spend per day</span></div><div class="chart" data-chart="daily" data-id="' + c.id + '"></div>';
    if (x.commaKeys.length) h += '<p class="hint" style="padding:0 20px 8px;margin:0">' + x.commaKeys.length + ' linked campaign' + (x.commaKeys.length > 1 ? 's have' : ' has') + ' a comma in its name, so only its totals are counted (not in the daily chart).</p>';
    h += '<div class="card-h" style="padding-top:6px"><div><span class="label">Breakdown</span><h2>Per linked campaign</h2></div></div><div class="tablewrap"><table class="tbl"><thead><tr><th>Campaign</th><th class="r">Spend</th><th class="r hide-md">Clicks</th><th class="r hide-md">CTR</th><th class="r hide-sm">Conv.</th><th class="r">GA4 orders</th><th class="r">GA4 revenue</th><th class="r">ROAS</th><th class="r hide-sm">CPA</th></tr></thead><tbody>' +
      c.links.map(function (l) {
        var b = x.byKey[l.k] || {}, p = keyParts(l.k), roas = b.sp ? b.rev / b.sp : null;
        return '<tr><td class="name"><span class="t1">' + esc(l.n) + '</span><small>' + esc(platName(p.platform) + ' · ' + p.market + (b.days ? ' · ' + b.days + ' days with spend' : ' · no spend in these dates')) + '</small></td><td class="r nw">' + money(b.sp) + '</td><td class="r hide-md">' + int(b.clk) + '</td><td class="r hide-md">' + pct(b.imp ? b.clk / b.imp : null, 2) + '</td><td class="r hide-sm">' + NF1.format(b.conv || 0) + '</td><td class="r">' + int(b.ord) + '</td><td class="r nw">' + money(b.rev) + '</td><td class="r">' + ratio(roas) + '</td><td class="r nw hide-sm">' + eurOr(b.ord && b.sp ? b.sp / b.ord : null, true) + '</td></tr>';
      }).join('') + '</tbody><tfoot><tr><td>Total</td><td class="r nw">' + money(a.sp) + '</td><td class="r hide-md">' + int(a.clk) + '</td><td class="r hide-md">' + pct(a.ctr, 2) + '</td><td class="r hide-sm">' + NF1.format(a.conv || 0) + '</td><td class="r">' + int(a.ord) + '</td><td class="r nw">' + money(a.rev) + '</td><td class="r">' + ratio(a.roas) + '</td><td class="r nw hide-sm">' + eurOr(a.cpa, true) + '</td></tr></tfoot></table></div>';
    return h + '<p class="hint" style="padding:12px 20px 16px;margin:0">' + esc(ATTRIB) + '</p></div>';
  }

  // ── link picker ──
  function linkPicker(c) {
    if (!liveReady()) { toast('The live ad data is still loading — try again in a moment.'); return; }
    var th = dnum(through()), from = dnum(c.start) - 14, to = Math.min(dnum(c.end) + 14, th), note = '';
    if (from > to) { to = th; from = th - 29; note = ' It has not started yet, so this lists campaigns with spend in the last 30 days of ad data.'; }
    if (to - from > 790) from = to - 790;
    var path = campsPath(ymdOf(from), ymdOf(to)), sel = {}, f = { market: c.market !== 'ALL' ? c.market : '', platform: '', q: '', show: 60 }, ptoks = planToks(c);
    c.links.forEach(function (l) { sel[l.k] = l.n; });
    var api = openModal({
      title: 'Link ad campaigns', cls: 'wide',
      body: '<p class="hint" style="margin:0">' + esc('Real campaigns with spend between ' + fmtRange(from, to) + ' (“' + c.name + '” ± 14 days).' + note + ' Spend shown is for that window.') + '</p>' +
        '<div class="filters" role="group" aria-label="Filter ad campaigns"><label class="sr" for="lkM">Market</label><select class="select" id="lkM">' + opts([{ id: 'IT', name: 'Italy' }, { id: 'HR', name: 'Croatia' }, { id: 'SI', name: 'Slovenia' }], f.market, 'All markets') + '</select>' +
        '<label class="sr" for="lkP">Platform</label><select class="select" id="lkP">' + opts([{ id: 'Google', name: 'Google Ads' }, { id: 'Meta', name: 'Meta Ads' }], '', 'Google + Meta') + '</select>' +
        '<label class="sr" for="lkQ">Search ad campaigns</label><input class="search" id="lkQ" type="search" placeholder="Search campaign name…" autocomplete="off"></div>' +
        '<div id="lkBody"><p class="live-status" role="status"><span class="spin" aria-hidden="true"></span>Loading ad campaigns…</p></div>',
      foot: '<span class="hint grow" id="lkCount" aria-live="polite"></span><button type="button" class="btn ghost" data-close>Cancel</button><button type="button" class="btn pri" data-save>Save links</button>'
    });
    var el = api.el, entry = liveLoad(path), qTimer = null;
    function count() { var n = Object.keys(sel).length; $('#lkCount', el).textContent = n + ' linked' + (n >= 50 ? ' (maximum 50)' : ''); }
    function rowHtml(r, sug) {
      var k = rowKey(r), aon = r.active_days >= Math.max(5, Math.round((to - from + 1) * 0.6));
      return '<li><label class="lk-row"><input type="checkbox" class="chk" data-k="' + esc(k) + '"' + (sel[k] ? ' checked' : '') + '><span class="sdot ' + platTone(r.platform) + '"></span><span class="main"><b>' + esc(r.campaign) + '</b><small>' +
        esc([platName(r.platform), r.market, r.campaign_type, r.area].filter(Boolean).join(' · ') + ' · ' + fmtRange(r.first_spend, r.last_spend) + ' · ' + r.active_days + ' days · ' + money(r.spend)) + '</small></span>' +
        (sug ? '<span class="chip good">Suggested</span>' : '') + (aon ? '<span class="chip">Always-on</span>' : '') + '</label></li>';
    }
    function draw() {
      var body = $('#lkBody', el); if (!body) return;
      if (entry.status === 'error') { body.innerHTML = '<div class="err" role="alert">' + esc(entry.err) + ' <button type="button" class="btn sm" data-retry>Try again</button></div>'; return; }
      if (entry.status !== 'ok') return;
      var rows = entry.data.campaigns.filter(function (r) { return r.first_spend; });
      var scored = rows.map(function (r) { return { r: r, s: suggestScore(c, r, ptoks) }; });
      var sugg = scored.filter(function (x) { return x.s >= 0.4 && !sel[rowKey(x.r)] && (!f.market || x.r.market === f.market) && (!f.platform || x.r.platform === f.platform); }).sort(function (a, b) { return b.s - a.s; }).slice(0, 6);
      var sugSet = {}; sugg.forEach(function (x) { sugSet[rowKey(x.r)] = 1; });
      var list = scored.filter(function (x) { var r = x.r; return (!f.market || r.market === f.market) && (!f.platform || r.platform === f.platform) && matchQ(f.q, r.campaign + ' ' + r.campaign_type + ' ' + (r.category || '') + ' ' + r.area); })
        .sort(function (a, b) { var sa = sel[rowKey(a.r)] ? 1 : 0, sb = sel[rowKey(b.r)] ? 1 : 0; return sb - sa || b.s - a.s || b.r.spend - a.r.spend; });
      var inWin = {}; rows.forEach(function (r) { inWin[rowKey(r)] = 1; });
      var orphan = Object.keys(sel).filter(function (k) { return !inWin[k]; });
      var html = '';
      if (orphan.length) html += '<span class="label">Linked, no spend in this window (' + orphan.length + ')</span><ul class="lk-list">' + orphan.map(function (k) { var p = keyParts(k); return '<li><label class="lk-row"><input type="checkbox" class="chk" data-k="' + esc(k) + '" checked><span class="sdot ' + platTone(p.platform) + '"></span><span class="main"><b>' + esc(sel[k]) + '</b><small>' + esc(platName(p.platform) + ' · ' + p.market) + '</small></span></label></li>'; }).join('') + '</ul>';
      if (sugg.length && !f.q) html += '<span class="label">Suggested by name, market and dates</span><ul class="lk-list">' + sugg.map(function (x) { return rowHtml(x.r, true); }).join('') + '</ul>';
      html += '<span class="label">' + (f.q ? 'Matching' : 'All') + ' campaigns in the window (' + list.length + ')</span>' +
        (list.length ? '<ul class="lk-list">' + list.slice(0, f.show).map(function (x) { return rowHtml(x.r, sugSet[rowKey(x.r)]); }).join('') + '</ul>' + (list.length > f.show ? '<div class="more"><button type="button" class="btn sm" data-more>Show ' + Math.min(60, list.length - f.show) + ' more (' + (list.length - f.show) + ' left)</button></div>' : '')
          : '<p class="hint">No ad campaigns match. Clear the search or change the market / platform.</p>');
      body.innerHTML = html;
      count();
    }
    entry.p.then(draw);
    if (entry.status !== 'loading') draw();
    count();
    el.addEventListener('change', function (e) {
      var t = e.target;
      if (t.id === 'lkM') { f.market = t.value; f.show = 60; draw(); return; }
      if (t.id === 'lkP') { f.platform = t.value; f.show = 60; draw(); return; }
      if (t.dataset && t.dataset.k) {
        var k = t.dataset.k;
        if (t.checked) {
          if (Object.keys(sel).length >= 50) { t.checked = false; toast('At most 50 ad campaigns per planned campaign.'); return; }
          var r = adIndex[k]; sel[k] = r ? r.campaign : keyParts(k).ck;
        } else delete sel[k];
        $$('input[data-k]', el).forEach(function (x) { if (x.dataset.k === k) x.checked = !!sel[k]; });
        count();
      }
    });
    $('#lkQ', el).addEventListener('input', function (e) { clearTimeout(qTimer); var v = e.target.value; qTimer = setTimeout(function () { f.q = v; f.show = 60; draw(); }, 160); });
    el.addEventListener('click', function (e) {
      if (e.target.closest('[data-more]')) { f.show += 60; draw(); return; }
      if (e.target.closest('[data-retry]')) { liveCache.delete(path); entry = liveLoad(path); $('#lkBody', el).innerHTML = '<p class="live-status" role="status"><span class="spin" aria-hidden="true"></span>Loading ad campaigns…</p>'; entry.p.then(draw); return; }
      if (e.target.closest('[data-save]')) {
        var prev = c.links.slice();
        c.links = Object.keys(sel).slice(0, 50).map(function (k) { return { k: k, n: String(sel[k] || keyParts(k).ck).slice(0, 300) }; });
        c.updatedAt = Date.now(); api.close(true); commit();
        toast(c.links.length ? 'Linked ' + c.links.length + ' ad campaign' + (c.links.length > 1 ? 's' : '') : 'All links removed', { label: 'Undo', run: function () { c.links = prev; c.updatedAt = Date.now(); commit(); } });
      }
    });
  }

  // ── calendar: ad-activity layer ──
  function adLayer(fromN, toN) {
    var th = dnum(through()), to2 = Math.min(toN, th);
    if (fromN > to2) return (adsNow = { status: 'ok', bars: [], always: [], alwaysList: [], idx: {}, future: true, from: fromN, to: toN });
    var e = liveLoad(campsPath(ymdOf(fromN), ymdOf(to2)));
    if (e.status !== 'ok') return { status: e.status, err: e.err };
    var days = to2 - fromN + 1, fm = ui.f.market, mk = fm && fm !== 'ALL' ? fm : '', need = days >= 5 ? Math.ceil(days * 0.6) : days;
    var bars = [], al = {}, idx = {};
    e.data.campaigns.forEach(function (r) {
      if (!r.first_spend || !(r.spend > 0) || (mk && r.market !== mk)) return;
      var k = rowKey(r); idx[k] = r;
      if (r.active_days >= need) { (al[r.market] = al[r.market] || []).push(r); return; }
      bars.push({ k: k, row: r, s: dnum(r.first_spend), e: dnum(r.last_spend) });
    });
    bars.sort(function (a, b) { return b.row.spend - a.row.spend || a.s - b.s; });
    var always = MKT3.filter(function (m) { return al[m]; }).map(function (m) {
      var list = al[m].sort(function (a, b) { return b.spend - a.spend; });
      return { market: m, list: list, sp: sum(list, function (x) { return +x.spend || 0; }), s: Math.min.apply(null, list.map(function (x) { return dnum(x.first_spend); })), e: Math.max.apply(null, list.map(function (x) { return dnum(x.last_spend); })) };
    });
    adsNow = { status: 'ok', bars: bars, always: always, alwaysList: [].concat.apply([], always.map(function (g) { return g.list; })), idx: idx, from: fromN, to: to2, days: days, partial: toN > th, need: need };
    return adsNow;
  }
  function alwaysLabel(g) { return 'Always-on · ' + (MK[g.market] || { name: g.market }).name + ': ' + g.list.length + ' campaign' + (g.list.length > 1 ? 's' : '') + ', ' + money(g.sp); }
  function adLabel(r) { return platName(r.platform) + ' · ' + r.market + ' · ' + r.campaign + ' · ' + fmtRange(r.first_spend, r.last_spend) + ' · ' + money(r.spend) + ' spend'; }
  function adBarHtml(a, f, t, style, extra) {
    var r = a.row, lab = adLabel(r);
    return '<button type="button" class="adbar ' + platTone(r.platform) + (a.s < f ? ' cl' : '') + (a.e > t ? ' cr' : '') + (extra ? ' ' + extra : '') + '" data-act="ad-open" data-k="' + esc(a.k) + '" style="' + style + '" aria-label="' + esc(lab) + '" title="' + esc(lab) + '"><span class="nm">' + esc(r.campaign) + '</span></button>';
  }
  function adStripHtml(ads, inGantt) {
    if (ads.status === 'error') return '<div class="adstrip"><div class="err" role="alert">Ad activity could not be loaded: ' + esc(ads.err) + ' <button type="button" class="btn sm" data-act="live-retry">Try again</button></div></div>';
    if (ads.status !== 'ok') return '<div class="adstrip"><p class="live-status" role="status"><span class="spin" aria-hidden="true"></span>Loading ad activity…</p></div>';
    if (ads.future) return '<div class="adstrip"><p class="hint" style="margin:0">No ad activity yet for this period — the ad data runs through ' + esc(fmtD(through())) + '.</p></div>';
    var n = ads.bars.length + ads.alwaysList.length;
    return '<div class="adstrip" role="group" aria-label="Ad activity">' +
      (!inGantt ? ads.always.map(function (g) { return '<button type="button" class="aon-row ' + 'tone-' + MK[g.market].tone + '" data-act="ads-always" data-m="' + g.market + '"><span class="chip tone tone-' + MK[g.market].tone + '"><span class="d"></span>' + g.market + '</span><span class="t">' + esc(alwaysLabel(g)) + '</span><span class="muted">' + icon('chevR') + '</span></button>'; }).join('') : '') +
      '<p class="hint" style="margin:0">' + (n ? n + ' real ad campaign' + (n > 1 ? 's' : '') + ' with spend in view' + (ads.alwaysList.length ? ' · always-on = spending on at least ' + ads.need + ' of the ' + ads.days + ' days, grouped per market' : '') + (ads.bars.length ? ' · ' + ads.bars.length + ' shorter one' + (ads.bars.length > 1 ? 's' : '') + ' as thin bars' : '') : 'No ad spend in this period' + (ui.f.market && ui.f.market !== 'ALL' ? ' for ' + esc(MK[ui.f.market].name) : '') + '.') +
      (ads.partial ? ' · ad data through ' + esc(fmtD(through())) : '') + '</p></div>';
  }
  function adsListDialog(title, rows, sub) {
    rows = rows.slice().sort(function (a, b) { return b.spend - a.spend; });
    var shown = rows.slice(0, 300);
    var api = openModal({ title: title, cls: 'wide', body: (sub ? '<p class="hint" style="margin:0">' + esc(sub) + '</p>' : '') + '<ul class="rows" style="margin:0 -22px">' + shown.map(function (r, i) {
      return '<li><span class="sdot ' + platTone(r.platform) + '" style="width:9px;height:9px"></span><div class="main"><button type="button" class="subj" data-i="' + i + '" style="all:unset;cursor:pointer;font-weight:500;overflow-wrap:anywhere">' + esc(r.campaign) + '</button><div class="meta"><span>' + esc(platName(r.platform) + ' · ' + r.market + ' · ' + (r.campaign_type || '')) + '</span><span>' + esc(fmtRange(r.first_spend, r.last_spend)) + ' · ' + r.active_days + ' days</span></div></div><div class="end"><span class="mono">' + money(r.spend) + '</span></div></li>';
    }).join('') + '</ul>' + (rows.length > shown.length ? '<p class="hint">Showing the 300 largest of ' + rows.length + '.</p>' : ''), foot: '<button type="button" class="btn pri" data-close>Close</button>' });
    api.el.addEventListener('click', function (e) { var b = e.target.closest('[data-i]'); if (!b) return; var r = shown[+b.dataset.i]; api.close(true); adDialog(r, adsNow); });
    api.el.addEventListener('keydown', function (e) { var b = e.target.closest && e.target.closest('[data-i]'); if (b && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); b.click(); } });
  }
  function adDialog(r, win) {
    if (!r) return;
    var k = rowKey(r), linked = db.campaigns.filter(function (c) { return c.links.some(function (l) { return l.k === k; }); });
    var roas = r.spend ? r.revenue / r.spend : null, wl = win && win.from != null ? fmtRange(win.from, win.to) : '';
    var body = '<p class="sub" style="margin:0">' + platChip(r.platform) + mktChip(r.market) + '<span>' + esc([r.campaign_type, r.area, r.category, r.store].filter(Boolean).join(' · ')) + '</span></p>' +
      '<div class="kv" style="padding:0">' + kvx('Spend', money2(r.spend)) + kvx('First – last spend', esc(fmtRange(r.first_spend, r.last_spend)) + ' <span class="muted">(' + r.active_days + ' days)</span>') +
      kvx('Clicks · CTR', int(r.clicks) + ' · ' + pct(r.impressions ? r.clicks / r.impressions : null, 2)) + kvx('Impressions', int(r.impressions)) +
      kvx('Platform conversions', NF1.format(+r.conversions || 0) + ' <span class="muted">· ' + money(r.conv_value) + ' value</span>') +
      kvx('GA4 sessions', int(r.sessions)) + kvx('GA4 orders · CPA', int(r.orders) + ' · ' + eurOr(r.orders && r.spend ? r.spend / r.orders : null, true)) +
      kvx('GA4 revenue · ROAS', money(r.revenue) + ' · ' + ratio(roas)) + '</div>' +
      (linked.length ? '<div><span class="label">Linked to</span><ul class="rows" style="margin:4px -22px 0">' + linked.map(function (c) { return '<li><div class="main"><a href="#/c/' + c.id + '">' + esc(c.name) + '</a><div class="meta"><span>' + fmtRange(c.start, c.end) + '</span></div></div></li>'; }).join('') + '</ul></div>' : '') +
      '<p class="hint" style="margin:0">' + esc((wl ? 'Numbers for ' + wl + ' only. ' : '') + ATTRIB) + '</p>';
    var api = openModal({ title: r.campaign, cls: 'wide', body: body,
      foot: '<button type="button" class="btn" data-link>' + icon('link') + 'Link to…</button><button type="button" class="btn pri" data-create>' + icon('plus') + 'Create planned campaign from this</button>' });
    api.el.addEventListener('click', function (e) {
      if (e.target.closest('a[href^="#/c/"]')) { api.close(true); return; }
      if (e.target.closest('[data-create]')) { api.close(true); campaignEditor(null, presetFromRow(r)); return; }
      if (e.target.closest('[data-link]')) { api.close(true); linkToDialog(r); }
    });
  }
  function linkToDialog(r) {
    var k = rowKey(r), cands = db.campaigns.filter(function (c) { return c.status !== 'cancelled' && !c.links.some(function (l) { return l.k === k; }); })
      .map(function (c) { return { c: c, s: suggestScore(c, r) }; }).sort(function (a, b) { return b.s - a.s || (a.c.start < b.c.start ? 1 : -1); });
    if (!cands.length) { toast(db.campaigns.length ? 'Every planned campaign is already linked to it.' : 'Your plan has no campaigns yet — create one from this ad campaign instead.'); return; }
    openModal({ title: 'Link “' + r.campaign + '” to…', body: '<div class="field"><label for="ltSel">Planned campaign</label><select class="in" id="ltSel">' + cands.slice(0, 300).map(function (x, i) {
      return '<option value="' + x.c.id + '"' + (i === 0 ? ' selected' : '') + '>' + esc(x.c.name + ' · ' + x.c.market + ' · ' + fmtRange(x.c.start, x.c.end) + (x.s >= 0.4 ? ' · suggested' : '')) + '</option>';
    }).join('') + '</select><span class="hint">Sorted by how well name, market and dates match.</span></div>', onSubmit: function (api) {
      var c = camp($('#ltSel', api.el).value); if (!c) return;
      if (c.links.length >= 50) return formError(api, 'That campaign already has 50 linked ad campaigns.', 'ltSel');
      c.links.push({ k: k, n: String(r.campaign).slice(0, 300) }); c.updatedAt = Date.now(); api.close(true); commit();
      toast('Linked to “' + c.name + '”', { label: 'Open', run: function () { location.hash = '#/c/' + c.id; } });
    }, foot: '<button type="button" class="btn ghost" data-close>Cancel</button><button type="submit" form="{form}" class="btn pri">Link</button>' });
  }

  // ── import ad campaigns as a starting plan ──
  function importDialog() {
    if (!liveReady()) { toast('The live ad data is still loading — try again in a moment.'); return; }
    var th = dnum(through()), dFrom = addMonths(monthStart(th), -2), cand = [];
    var body = '<p class="hint" style="margin:0">Adds one planned campaign per real ad campaign that ran in the period: its first to last day with spend, market, channel and a link to it. Always-on campaigns (spending on at least 60 % of the period’s days, e.g. brand search, Shopping, PMax) and campaigns already linked in your plan are skipped. Budgets and targets stay empty for you to fill in — no ad numbers are copied into the plan.</p>' +
      '<div class="row2"><div class="field"><label for="imFrom">From</label><input class="in" type="date" id="imFrom" min="' + DATA_START + '" max="' + ymdOf(th) + '" value="' + ymdOf(dFrom) + '"></div><div class="field"><label for="imTo">To</label><input class="in" type="date" id="imTo" min="' + DATA_START + '" max="' + ymdOf(th) + '" value="' + ymdOf(th) + '"></div></div>' +
      '<div class="row3"><div class="field"><label for="imM">Market</label><select class="in" id="imM">' + opts([{ id: 'IT', name: 'Italy' }, { id: 'HR', name: 'Croatia' }, { id: 'SI', name: 'Slovenia' }], '', 'All markets') + '</select></div>' +
      '<div class="field"><label for="imP">Platform</label><select class="in" id="imP">' + opts([{ id: 'Google', name: 'Google Ads' }, { id: 'Meta', name: 'Meta Ads' }], '', 'Google + Meta') + '</select></div>' +
      '<div class="field"><label for="imA">Business area</label><select class="in" id="imA">' + opts([{ id: 'E-commerce', name: 'E-commerce' }, { id: 'Optics / retail', name: 'Optics / retail' }], '', 'All areas') + '</select></div></div>' +
      '<div class="field"><label for="imMin">Minimum spend in the period (€)</label><input class="in" type="number" min="0" step="10" id="imMin" value="100"></div>' +
      '<div id="imPrev" class="imprev" aria-live="polite"></div>';
    var api = openModal({ title: 'Import ad campaigns as a starting plan', cls: 'wide', body: body, onSubmit: submit,
      foot: '<button type="button" class="btn ghost" data-close>Cancel</button><button type="submit" form="{form}" class="btn pri" id="imGo" disabled>Import</button>' });
    var el = api.el, timer = null, seq = 0;
    function v(id) { return $('#' + id, el).value; }
    function preview() {
      var box = $('#imPrev', el), go = $('#imGo', el), a = v('imFrom'), b = v('imTo'), my = ++seq;
      cand = []; go.disabled = true;
      if (!validYmd(a) || !validYmd(b)) { box.innerHTML = '<p class="hint">Pick both dates.</p>'; return; }
      if (a > b) { box.innerHTML = '<p class="err">“From” is after “To”.</p>'; return; }
      if (b > ymdOf(th)) b = ymdOf(th);
      if (dnum(b) - dnum(a) > 790) { box.innerHTML = '<p class="err">Choose at most about 26 months.</p>'; return; }
      box.innerHTML = '<p class="live-status" role="status"><span class="spin" aria-hidden="true"></span>Loading ad campaigns…</p>';
      var e = liveLoad(campsPath(a, b));
      e.p.then(function () {
        if (my !== seq || !api.el.isConnected) return;
        if (e.status === 'error') { box.innerHTML = '<p class="err">' + esc(e.err) + '</p>'; liveCache.delete(campsPath(a, b)); return; }
        var days = dnum(b) - dnum(a) + 1, need = days >= 5 ? Math.ceil(days * 0.6) : days, min = Math.max(0, +v('imMin') || 0), m = v('imM'), p = v('imP'), ar = v('imA');
        var have = {}; db.campaigns.forEach(function (c) { c.links.forEach(function (l) { have[l.k] = 1; }); });
        var sk = { aon: 0, linked: 0, small: 0 };
        e.data.campaigns.forEach(function (r) {
          if (!r.first_spend || (m && r.market !== m) || (p && r.platform !== p) || (ar && r.area !== ar)) return;
          if (r.active_days >= need) { sk.aon++; return; }
          if (have[rowKey(r)]) { sk.linked++; return; }
          if ((+r.spend || 0) < min) { sk.small++; return; }
          cand.push(r);
        });
        cand.sort(function (x, y) { return x.first_spend < y.first_spend ? -1 : x.first_spend > y.first_spend ? 1 : y.spend - x.spend; });
        if (cand.length > 300) cand = cand.slice(0, 300);
        go.disabled = !cand.length; go.textContent = cand.length ? 'Import ' + cand.length + ' campaign' + (cand.length > 1 ? 's' : '') : 'Import';
        box.innerHTML = '<p style="margin:0"><b style="font-weight:500">' + cand.length + '</b> planned campaign' + (cand.length === 1 ? '' : 's') + ' will be added.</p><p class="hint" style="margin:2px 0 8px">Skipped: ' + sk.aon + ' always-on · ' + sk.linked + ' already in the plan · ' + sk.small + ' below ' + money(min) + '.' + (cand.length >= 300 ? ' Only the first 300 are imported — narrow the period.' : '') + '</p>' +
          (cand.length ? '<ul class="rows imlist">' + cand.slice(0, 8).map(function (r) { return '<li><span class="sdot ' + platTone(r.platform) + '"></span><div class="main"><span class="t">' + esc(r.campaign) + '</span><div class="meta"><span>' + esc(r.market + ' · ' + fmtRange(r.first_spend, r.last_spend) + ' · ' + (TY[guessType(r)] || {}).name) + '</span></div></div></li>'; }).join('') + (cand.length > 8 ? '<li><span class="hint">… and ' + (cand.length - 8) + ' more</span></li>' : '') + '</ul>' : '');
      });
    }
    el.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(preview, 350); });
    el.addEventListener('change', function () { clearTimeout(timer); timer = setTimeout(preview, 50); });
    preview();
    function submit(api2) {
      if (!cand.length) return formError(api2, 'Nothing to import with these settings.');
      var ids = [], now = Date.now();
      cand.forEach(function (r) {
        var p = presetFromRow(r, 'Imported from ' + platName(r.platform) + ' (' + [r.campaign_type, r.area, r.category].filter(Boolean).join(' · ') + ').');
        var c = Object.assign({ id: ++db.seq.campaign, checklist: {}, comments: [], files: [], utms: [], content: [], seed: D.strHash(p.name + now + ids.length) >>> 0, createdAt: now, updatedAt: now }, p);
        db.campaigns.push(c); ids.push(c.id);
      });
      api2.close(true); commit(true);
      if ((current.parts[0] || 'calendar') !== 'campaigns') location.hash = '#/campaigns'; else refresh();
      toast('Imported ' + ids.length + ' campaign' + (ids.length > 1 ? 's' : '') + ' into your live plan', { label: 'Undo', run: function () { db.campaigns = db.campaigns.filter(function (c) { return ids.indexOf(c.id) < 0; }); commit(); toast('Import undone'); } });
    }
  }

  // ══ Live performance ══════════════════════════════════════════════════════
  function lperiod() {
    var th = dnum(through()), p = ui.lperf.period, from;
    if (p === '30d') from = th - 29; else if (p === '12m') from = th - 364; else if (p === 'ytd') from = dmake(ymParts(th).y, 1, 1); else from = th - 89;
    var len = th - from + 1;
    return { from: from, to: th, pf: from - len, pt: from - 1, label: { '30d': 'Last 30 days', '90d': 'Last 90 days', '12m': 'Last 12 months', ytd: 'Year to date' }[p] || 'Last 90 days' };
  }
  function lpass(r) { var u = ui.lperf; return (!u.market || r.market === u.market) && (!u.platform || r.platform === u.platform) && (!u.area || r.area === u.area); }
  function monthlyAgg(data) {
    var u = ui.lperf, by = {}, seen = {};
    function get(m) { return by[m] = by[m] || Object.assign(lzero(), { site: 0, siteOrd: 0 }); }
    data.rows.forEach(function (r) {
      if ((u.market && r.market !== u.market) || (u.platform && r.platform !== u.platform)) return;
      var x = get(r.month);
      if (!u.area || r.area === u.area) { x.sp += +r.spend || 0; x.clk += +r.clicks || 0; x.imp += +r.impressions || 0; x.conv += +r.conversions || 0; x.cval += +r.conv_value || 0; }
      // GA4 is per month × market × platform: the API repeats it on each business-area row, so count it once
      var g = r.month + '|' + r.market + '|' + r.platform;
      if (!seen[g]) { seen[g] = 1; x.ses += +r.ga4_sessions || 0; x.ord += +r.ga4_orders || 0; x.rev += +r.ga4_revenue || 0; }
    });
    (data.site || []).forEach(function (s) { if (u.market && s.market !== u.market) return; var x = get(s.month); x.site += +s.revenue || 0; x.siteOrd += +s.orders || 0; });
    Object.keys(by).forEach(function (k) { lderive(by[k]); });
    return by;
  }
  var lpRows = [], lpCamps = [];
  function viewLivePerformance() {
    var u = ui.lperf;
    var html = head('Measure', 'Performance<span class="dot">.</span>', liveReady() ? '<span>Live ad data · through ' + esc(fmtD(through())) + '</span>' : '<span>Live ad data</span>', '<button type="button" class="btn" data-act="csv-lperf">' + icon('download') + 'CSV</button>');
    if (!liveReady()) return html + '<div class="card">' + liveWait() + '</div>';
    var P = lperiod(), eCur = liveLoad(campsPath(ymdOf(P.from), ymdOf(P.to))), ePrev = liveLoad(campsPath(ymdOf(P.pf), ymdOf(P.pt))), eMon = liveLoad(monthlyPath());
    html = head('Measure', 'Performance<span class="dot">.</span>', '<span>' + esc(P.label) + ' · ' + fmtRange(P.from, P.to) + '</span><span>' + (u.market ? esc(MK[u.market].name) : 'All markets') + ' · ' + (u.platform ? esc(platName(u.platform)) : 'Google + Meta') + ' · ' + (u.area ? esc(u.area) : 'all areas') + '</span><span>Live ad data</span>',
      '<button type="button" class="btn" data-act="csv-lperf">' + icon('download') + 'CSV</button>');
    html += '<div class="toolbar"><div class="seg" role="group" aria-label="Period">' + [['30d', '30 days'], ['90d', '90 days'], ['ytd', 'Year to date'], ['12m', '12 months']].map(function (x) { return '<button type="button" data-act="lperf-period" data-v="' + x[0] + '" aria-pressed="' + (u.period === x[0]) + '">' + x[1] + '</button>'; }).join('') + '</div>' +
      '<label class="sr" for="lpM">Market</label><select class="select" id="lpM" data-chg="lperf-f" data-k="market">' + opts([{ id: 'IT', name: 'Italy' }, { id: 'HR', name: 'Croatia' }, { id: 'SI', name: 'Slovenia' }], u.market, 'All markets') + '</select>' +
      '<label class="sr" for="lpP">Platform</label><select class="select" id="lpP" data-chg="lperf-f" data-k="platform">' + opts([{ id: 'Google', name: 'Google Ads' }, { id: 'Meta', name: 'Meta Ads' }], u.platform, 'Google + Meta') + '</select>' +
      '<label class="sr" for="lpA">Business area</label><select class="select" id="lpA" data-chg="lperf-f" data-k="area">' + opts([{ id: 'E-commerce', name: 'E-commerce' }, { id: 'Optics / retail', name: 'Optics / retail' }], u.area, 'All areas') + '</select></div>';
    html += '<div class="banner info" role="note">' + icon('info') + '<div><b style="font-weight:500">How to read these numbers.</b> ' + esc(ATTRIB) + '</div></div>';
    if (eCur.status === 'error') return html + '<div class="card">' + liveErr(eCur.err) + '</div>';
    if (eCur.status !== 'ok') return html + '<div class="card"><div class="card-b"><p class="live-status" role="status"><span class="spin" aria-hidden="true"></span>Loading real campaign results…</p></div></div>';
    var cur = eCur.data.campaigns.filter(lpass), prevOk = ePrev.status === 'ok', prev = prevOk ? ePrev.data.campaigns.filter(lpass) : [];
    var a = lderive(cur.reduce(ladd, lzero())), b = lderive(prev.reduce(ladd, lzero()));
    lpIdx = {}; cur.forEach(function (r) { lpIdx[rowKey(r)] = r; });
    if (!a.sp && !a.rev) return html + '<div class="card"><div class="card-b"><div class="empty box"><b>No ad spend in this period</b>Pick a longer period or another market, platform or area.</div></div></div>';
    function dl(x, y, lower) { return prevOk ? delta(x, y, lower) : { s: ePrev.status === 'error' ? 'previous period unavailable' : 'loading previous period…', c: '' }; }
    var d1 = dl(a.sp, b.sp), d2 = dl(a.rev, b.rev), d3 = dl(a.roas, b.roas), d4 = dl(a.ord, b.ord), d5 = dl(a.cpa, b.cpa, true), d6 = dl(a.ctr, b.ctr), d7 = dl(a.conv, b.conv), d8 = dl(a.ses, b.ses);
    html += '<div class="kpis">' + kpiTile('Spend', money(a.sp), d1.s, '') + kpiTile('GA4 revenue', money(a.rev), d2.s, d2.c) + kpiTile('ROAS (GA4)', ratio(a.roas), d3.s, d3.c) + kpiTile('GA4 orders', int(a.ord), d4.s, d4.c) +
      kpiTile('CPA (GA4)', eurOr(a.cpa, true), d5.s, d5.c) + kpiTile('CTR', pct(a.ctr, 2), d6.s, d6.c) + kpiTile('Platform conversions', NF0.format(a.conv), d7.s + ' · ROAS ' + ratio(a.proas) + ' by platform value', d7.c) + kpiTile('GA4 sessions', int(a.ses), d8.s, d8.c) + '</div>';
    // months (from /monthly): last 12 months, with site-wide GA4 revenue for context
    var th = dnum(through()), m0 = addMonths(monthStart(th), -11), ms = [], byMo = null, siteTot = 0, paidTot = 0;
    if (eMon.status === 'ok') {
      byMo = monthlyAgg(eMon.data);
      for (var k = 0; k < 12; k++) {
        var md = addMonths(m0, k), p = ymParts(md), key = ymdOf(md).slice(0, 7), x = byMo[key] || lderive(Object.assign(lzero(), { site: 0, siteOrd: 0 }));
        ms.push({ key: key, label: MON3[p.m - 1], full: MON[p.m - 1] + ' ' + p.y + (k === 11 ? ' (to ' + fmtDs(th) + ')' : ''), sp: x.sp, rev: u.area ? 0 : x.rev, ord: x.ord, noRev: !!u.area, revLabel: 'GA4 revenue', site: x.site, x: x });
        siteTot += x.site; paidTot += x.rev;
      }
    }
    chartData.months = ms;
    html += '<div class="card"><div class="card-h"><div><span class="label">Last 12 months · ' + (u.market ? esc(MK[u.market].name) : 'all markets') + '</span><h2>Spend, GA4 revenue and ROAS per month</h2></div>' +
      (byMo && !u.area && siteTot ? '<span class="hint">Site-wide GA4 revenue (paid + organic): ' + money(siteTot) + ' · ad-attributed ' + pct(paidTot / siteTot, 0) + '</span>' : '') + '</div>' +
      (eMon.status === 'error' ? liveErr(eMon.err) : eMon.status !== 'ok' ? '<div class="card-b"><p class="live-status" role="status"><span class="spin" aria-hidden="true"></span>Loading months…</p></div>' :
        '<div class="legend"><span><i class="spend"></i>Spend</span>' + (u.area ? '<span>GA4 results cannot be split by business area per month — spend only</span>' : '<span><i class="rev"></i>GA4 revenue</span><span><i class="roas"></i>ROAS (right axis)</span>') + '</div><div class="chart" data-chart="months"></div>') + '</div><div class="gap"></div>';
    // breakdown
    var tab = u.tab, rows;
    function group(f, name) { var o = {}; cur.forEach(function (r) { var g = f(r) || '—'; ladd(o[g] = o[g] || lzero(), r); }); return Object.keys(o).map(function (g) { return { k: g, n: name(g), plain: g, a: lderive(o[g]) }; }); }
    if (tab === 'platform') rows = group(function (r) { return r.platform; }, function (g) { return platChip(g); });
    else if (tab === 'area') rows = group(function (r) { return r.area; }, function (g) { return esc(g); });
    else if (tab === 'type') rows = group(function (r) { return r.platform + ' · ' + r.campaign_type; }, function (g) { return esc(g); });
    else if (tab === 'month') rows = ms.map(function (m) { return { k: m.key, n: esc(m.full), plain: m.key, a: m.x, site: m.site }; });
    else rows = group(function (r) { return r.market; }, function (g) { return mktChip(g) + ' ' + esc((MK[g] || { name: g }).name); });
    if (tab !== 'month') rows.sort(function (x, y) { return y.a.sp - x.a.sp; });
    lpRows = rows;
    var isMo = tab === 'month', tot = isMo ? lderive(ms.reduce(function (s, m) { ['sp', 'clk', 'imp', 'conv', 'cval', 'ses', 'ord', 'rev'].forEach(function (f) { s[f] += m.x[f] || 0; }); return s; }, lzero())) : a;
    html += '<div class="card"><div class="card-h"><div><span class="label">' + (isMo ? 'Last 12 months' : esc(P.label)) + '</span><h2>Breakdown</h2></div><div class="seg" role="group" aria-label="Breakdown by">' + [['market', 'Market'], ['platform', 'Platform'], ['area', 'Area'], ['type', 'Campaign type'], ['month', 'Month']].map(function (x) { return '<button type="button" data-act="lperf-tab" data-v="' + x[0] + '" aria-pressed="' + (tab === x[0]) + '">' + x[1] + '</button>'; }).join('') + '</div></div>' +
      (isMo && eMon.status !== 'ok' ? '<div class="card-b"><p class="live-status" role="status">Loading months…</p></div>' :
        '<div class="tablewrap"><table class="tbl"><thead><tr><th>' + ({ market: 'Market', platform: 'Platform', area: 'Business area', type: 'Campaign type', month: 'Month' })[tab] + '</th><th class="r">Spend</th><th class="r">GA4 revenue</th><th class="r">ROAS</th><th class="r">GA4 orders</th><th class="r">CPA</th><th class="r hide-sm">CTR</th><th class="r hide-md">Platform conv.</th>' +
        (isMo ? '<th class="r hide-sm">Site revenue (all GA4)</th><th class="r hide-sm">Ad share</th>' : '<th class="hide-sm" style="min-width:110px">Share of spend</th>') + '</tr></thead><tbody>' +
        rows.map(function (r) { var x = r.a, nr = isMo && u.area; return '<tr><td class="nw">' + r.n + '</td><td class="r nw">' + money(x.sp) + '</td><td class="r nw">' + (nr ? '—' : money(x.rev)) + '</td><td class="r">' + (nr ? '—' : ratio(x.roas)) + '</td><td class="r">' + (nr ? '—' : int(x.ord)) + '</td><td class="r nw">' + (nr ? '—' : eurOr(x.cpa, true)) + '</td><td class="r hide-sm">' + pct(x.ctr, 2) + '</td><td class="r hide-md">' + NF0.format(x.conv || 0) + '</td>' +
          (isMo ? '<td class="r nw hide-sm">' + money(r.site) + '</td><td class="r hide-sm">' + (nr ? '—' : pct(r.site ? x.rev / r.site : null, 0)) + '</td>' : '<td class="hide-sm"><span class="minibar"><i style="width:' + (a.sp ? x.sp / a.sp * 100 : 0) + '%"></i></span></td>') + '</tr>'; }).join('') +
        '</tbody><tfoot><tr><td>Total</td><td class="r nw">' + money(tot.sp) + '</td><td class="r nw">' + (isMo && u.area ? '—' : money(tot.rev)) + '</td><td class="r">' + (isMo && u.area ? '—' : ratio(tot.roas)) + '</td><td class="r">' + (isMo && u.area ? '—' : int(tot.ord)) + '</td><td class="r nw">' + (isMo && u.area ? '—' : eurOr(tot.cpa, true)) + '</td><td class="r hide-sm">' + pct(tot.ctr, 2) + '</td><td class="r hide-md">' + NF0.format(tot.conv || 0) + '</td>' +
        (isMo ? '<td class="r nw hide-sm">' + money(sum(ms, function (m) { return m.site; })) + '</td><td class="hide-sm"></td>' : '<td class="hide-sm"></td>') + '</tr></tfoot></table></div>') + '</div><div class="gap"></div>';
    // top / worst by ROAS (minimum spend)
    var min = Math.max(0, +u.min || 0), ranked = cur.filter(function (r) { return (+r.spend || 0) >= min; }).map(function (r) { return { r: r, roas: r.spend ? r.revenue / r.spend : 0 }; }).sort(function (x, y) { return y.roas - x.roas || y.r.spend - x.r.spend; });
    var top = ranked.slice(0, 5), worst = ranked.slice(Math.max(5, ranked.length - 5)).reverse();
    function linkedPlan(k) { return db.campaigns.filter(function (c) { return c.links.some(function (l) { return l.k === k; }); })[0]; }
    function mini(list, title) {
      return '<div class="card"><div class="card-h"><div><span class="label">' + esc(P.label) + ' · min. ' + money(min) + ' spend</span><h2>' + title + '</h2></div></div>' + (list.length ? '<ul class="rows">' + list.map(function (x) { var r = x.r; return '<li><span class="sdot ' + platTone(r.platform) + '" style="width:9px;height:9px"></span><div class="main"><button type="button" class="subj" data-act="lp-open" data-k="' + esc(rowKey(r)) + '" style="all:unset;cursor:pointer;font-weight:500;overflow-wrap:anywhere">' + esc(r.campaign) + '</button><div class="meta"><span>' + esc(platName(r.platform) + ' · ' + r.market + ' · ' + r.campaign_type) + '</span><span>' + money(r.spend) + ' → ' + money(r.revenue) + '</span></div></div><div class="end"><span class="mono" style="font-size:15px">' + ratio(x.roas) + '</span></div></li>'; }).join('') + '</ul>' : '<div class="card-b"><div class="empty box">No campaign reaches the minimum spend in this period.</div></div>') + '</div>';
    }
    html += '<div class="toolbar"><label for="lpMin" class="hint">Minimum spend for rankings (€)</label><input class="in cell" style="width:110px;min-height:36px" type="number" min="0" step="50" id="lpMin" data-chg="lperf-f" data-k="min" value="' + esc(min) + '"></div>';
    html += '<div class="grid2 even">' + mini(top, 'Top campaigns by ROAS') + mini(worst.filter(function (x) { return top.indexOf(x) < 0; }), 'Worst campaigns by ROAS') + '</div><div class="gap"></div>';
    // what worked: real campaigns vs the period's average, and planned campaigns vs their own targets
    var avg = a.roas || 0;
    var ww = ranked.map(function (x) {
      var v = !x.r.revenue ? { t: 'No GA4 revenue', tone: 'clay' } : x.roas >= avg * 1.25 ? { t: 'Above average', tone: 'green' } : x.roas < avg * 0.6 ? { t: 'Below average', tone: 'clay' } : { t: 'Around average', tone: 'blue' };
      return { r: x.r, roas: x.roas, v: v, plan: linkedPlan(rowKey(x.r)) };
    });
    if (u.rank === 'rev') ww.sort(function (p, q) { return q.r.revenue - p.r.revenue; });
    lpCamps = ww;
    var cnt = {}; ww.forEach(function (w) { cnt[w.v.t] = (cnt[w.v.t] || 0) + 1; });
    html += '<div class="card"><div class="card-h"><div><span class="label">' + esc(P.label) + ' · ' + ww.length + ' campaigns · ' + (cnt['Above average'] || 0) + ' above · ' + (cnt['Around average'] || 0) + ' around · ' + ((cnt['Below average'] || 0) + (cnt['No GA4 revenue'] || 0)) + ' below the average ROAS of ' + ratio(avg) + '</span><h2>What worked</h2></div><div class="seg" role="group" aria-label="Rank by">' + [['roas', 'Rank by ROAS'], ['rev', 'By GA4 revenue']].map(function (x) { return '<button type="button" data-act="lperf-rank" data-v="' + x[0] + '" aria-pressed="' + (u.rank === x[0]) + '">' + x[1] + '</button>'; }).join('') + '</div></div>' +
      '<p class="hint" style="padding:0 20px 10px;margin:0">Compared with the average GA4 ROAS of everything in this filter (above = at least 1.25×, below = under 0.6×). A high ROAS here means the campaign’s visitors bought — not that the ad caused the sale.</p>' +
      (ww.length ? '<div class="tablewrap"><table class="tbl"><thead><tr><th>#</th><th>Campaign</th><th class="r">Spend</th><th class="r">GA4 revenue</th><th class="r">ROAS</th><th class="r hide-sm">GA4 orders</th><th class="r hide-md">CPA</th><th>Verdict</th><th class="hide-sm">Plan</th></tr></thead><tbody>' +
        ww.slice(0, 25).map(function (w, i) { var r = w.r, k = rowKey(r); return '<tr><td class="mono muted">' + (i + 1) + '</td><td class="name"><button type="button" class="t1 subj" data-act="lp-open" data-k="' + esc(k) + '" style="all:unset;cursor:pointer;font-weight:500;overflow-wrap:anywhere">' + esc(r.campaign) + '</button><small>' + esc(platName(r.platform) + ' · ' + r.market + ' · ' + r.campaign_type + ' · ' + fmtRange(r.first_spend, r.last_spend)) + '</small></td><td class="r nw">' + money(r.spend) + '</td><td class="r nw">' + money(r.revenue) + '</td><td class="r">' + ratio(w.roas) + '</td><td class="r hide-sm">' + int(r.orders) + '</td><td class="r nw hide-md">' + eurOr(r.orders ? r.spend / r.orders : null, true) + '</td><td><span class="chip tone tone-' + w.v.tone + '">' + w.v.t + '</span></td>' +
          '<td class="hide-sm">' + (w.plan ? '<a href="#/c/' + w.plan.id + '">' + esc(w.plan.name) + '</a>' : '<button type="button" class="btn sm ghost" data-act="ad-plan" data-k="' + esc(k) + '">' + icon('plus') + 'Plan it</button>') + '</td></tr>'; }).join('') +
        '</tbody></table></div>' + (ww.length > 25 ? '<p class="hint" style="padding:10px 20px">Showing 25 of ' + ww.length + ' — the CSV export has all of them.</p>' : '') : '<div class="card-b"><div class="empty box">No campaigns reach the minimum spend in this period.</div></div>') + '<div style="height:8px"></div></div><div class="gap"></div>';
    // planned campaigns with links, against their own targets and dates
    var planned = db.campaigns.filter(function (c) { return c.status !== 'cancelled' && c.links.length && dnum(c.end) >= P.from && dnum(c.start) <= P.to; }).sort(function (x, y) { return x.start < y.start ? 1 : -1; }).slice(0, 30);
    html += '<div class="card"><div class="card-h"><div><span class="label">Your plan · campaigns running in this period with linked ads</span><h2>Planned campaigns vs their targets</h2></div></div>' +
      (planned.length ? '<div class="tablewrap"><table class="tbl"><thead><tr><th>Planned campaign</th><th class="r">Spend</th><th class="r hide-sm">Budget</th><th class="r">GA4 revenue</th><th class="r">ROAS</th><th class="r hide-sm">Target</th><th>Verdict</th></tr></thead><tbody>' + planned.map(function (c) {
        var x = liveCampaignData(c, true), t = c.targets.roas || 0;
        if (x.status !== 'ok') return '<tr><td class="name"><a class="t1" href="#/c/' + c.id + '">' + esc(c.name) + '</a><small>' + fmtRange(c.start, c.end) + '</small></td><td colspan="6" class="muted">' + (x.status === 'error' ? 'Could not load: ' + esc(x.err) : x.status === 'future' ? 'Not started' : 'Loading…') + '</td></tr>';
        var g = x.agg, v = g.roas == null ? { t: 'No spend', tone: 'grey' } : !t ? { t: 'No target', tone: 'grey' } : g.roas >= t ? { t: 'Worked', tone: 'green' } : g.roas < 0.6 * t ? { t: 'Did not work', tone: 'clay' } : { t: 'Mixed', tone: 'blue' };
        return '<tr><td class="name"><a class="t1" href="#/c/' + c.id + '">' + esc(c.name) + '</a><small>' + fmtRange(c.start, c.end) + ' · ' + c.links.length + ' linked</small></td><td class="r nw' + (c.budget && g.sp > c.budget * 1.05 ? ' bad-t' : '') + '">' + money(g.sp) + '</td><td class="r nw hide-sm">' + money(c.budget) + '</td><td class="r nw">' + money(g.rev) + '</td><td class="r">' + ratio(g.roas) + '</td><td class="r hide-sm">' + ratio(t || null) + '</td><td><span class="chip tone tone-' + v.tone + '">' + v.t + '</span></td></tr>';
      }).join('') + '</tbody></table></div><p class="hint" style="padding:10px 20px 16px;margin:0">Each planned campaign uses its linked ad campaigns within its own dates (not the period above).</p>'
        : '<div class="card-b"><div class="empty box"><b>No linked planned campaigns in this period</b>Open a campaign in your plan and use “Link ad campaigns”, or plan one from the table above.</div></div>') + '</div>';
    after(drawCharts);
    return html;
  }
  function exportLivePerfCsv() {
    if (!liveReady() || !lpRows.length) { toast('Nothing to export yet.'); return; }
    var P = lperiod(), isMo = ui.lperf.tab === 'month', rows = [['Section', 'Item', 'Period from', 'Period to', 'Spend EUR', 'GA4 revenue EUR', 'ROAS (GA4)', 'GA4 orders', 'CPA EUR', 'Clicks', 'Impressions', 'CTR', 'Platform conversions', 'Platform conv. value EUR', 'GA4 sessions', 'Verdict', 'Linked plan']];
    lpRows.forEach(function (r) { var x = r.a; rows.push(['By ' + ui.lperf.tab, r.plain, isMo ? r.k + '-01' : ymdOf(P.from), isMo ? '' : ymdOf(P.to), n2(x.sp), n2(x.rev), n2(x.roas), x.ord, n2(x.cpa), x.clk, x.imp, n4(x.ctr), n2(x.conv), n2(x.cval), x.ses, '', '']); });
    lpCamps.forEach(function (w) { var r = w.r; rows.push(['Campaign', r.platform + ' · ' + r.market + ' · ' + r.campaign, ymdOf(P.from), ymdOf(P.to), n2(+r.spend), n2(+r.revenue), n2(w.roas), r.orders, n2(r.orders ? r.spend / r.orders : null), r.clicks, r.impressions, n4(r.impressions ? r.clicks / r.impressions : null), n2(+r.conversions), n2(+r.conv_value), r.sessions, w.v.t, w.plan ? w.plan.name : '']); });
    downloadCsv('marketing-live-performance-' + ymdOf(P.to) + '.csv', rows);
  }

  // ══ Live budget ═══════════════════════════════════════════════════════════
  var LBCH = [
    { id: 'google', name: 'Google Ads', live: 'Google', tone: 'blue' }, { id: 'meta', name: 'Meta Ads', live: 'Meta', tone: 'violet' },
    { id: 'newsletter', name: 'Newsletter', tone: 'teal' }, { id: 'sms', name: 'SMS', tone: 'teal' }, { id: 'influencer', name: 'Influencers', tone: 'green' },
    { id: 'tiktok', name: 'TikTok', tone: 'violet' }, { id: 'affiliate', name: 'Affiliate / price comparison', tone: 'clay' },
    { id: 'instore', name: 'In-store & POS', tone: 'grey' }, { id: 'radio', name: 'Radio / outdoor', tone: 'grey' }, { id: 'other', name: 'Other', tone: 'grey' }];
  var LBC = index(LBCH);
  function lbArr(Y, mk, ch, f) { var y = db.lbudget[Y], m = y && y[mk], c = m && m[ch], a = c && c[f]; return Array.isArray(a) ? a : null; }
  function lbSet(Y, mk, ch, f, i, v) {
    var y = db.lbudget[Y] = db.lbudget[Y] || {}, m = y[mk] = y[mk] || {}, c = m[ch] = m[ch] || {};
    var a = c[f] = Array.isArray(c[f]) ? c[f] : [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; a[i] = v;
  }
  function liveBudgetModel(Y, load) {
    var path = monthlyPath(), e = liveReady() ? (load ? liveLoad(path) : liveCache.get(path) || { status: 'idle' }) : { status: 'idle' };
    var th = dnum(through()), curY = ymParts(th).y, M = {}, i;
    MKT3.forEach(function (mk) {
      M[mk] = {};
      LBCH.forEach(function (ch) {
        var pl = lbArr(Y, mk, ch.id, 'plan'), sp = ch.live ? null : lbArr(Y, mk, ch.id, 'spent'), x = { plan: [], sp: [], fc: [], rate: 0 };
        for (i = 0; i < 12; i++) { x.plan.push(pl ? +pl[i] || 0 : 0); x.sp.push(sp ? +sp[i] || 0 : 0); x.fc.push(0); }
        M[mk][ch.id] = x;
      });
    });
    var months = [];
    for (i = 0; i < 12; i++) { var ms = dmake(Y, i + 1, 1), me = D.lastOfMonth(Y, i + 1); months.push({ ms: ms, me: me, past: me <= th, current: ms <= th && me > th, future: ms > th }); }
    var ok = e.status === 'ok';
    if (ok) {
      var rs = addMonths(monthStart(th), -2), rdays = th - rs + 1, rsM = ymdOf(rs).slice(0, 7), thM = ymdOf(th).slice(0, 7);
      e.data.rows.forEach(function (r) {
        if (!M[r.market]) return;
        var ch = r.platform === 'Meta' ? 'meta' : 'google', x = M[r.market][ch];
        if (r.month.slice(0, 4) === String(Y)) x.sp[+r.month.slice(5, 7) - 1] += +r.spend || 0;
        if (r.month >= rsM && r.month <= thM) x.rate += (+r.spend || 0) / rdays;   // run-rate: €/day since the 1st of the month two months back
      });
    }
    MKT3.forEach(function (mk) {
      LBCH.forEach(function (ch) {
        var x = M[mk][ch.id];
        months.forEach(function (mo, j) {
          if (Y < curY || mo.past) x.fc[j] = x.sp[j];
          else if (ch.live) x.fc[j] = Y > curY ? x.plan[j] : mo.current ? x.sp[j] + x.rate * (mo.me - th) : x.rate * (mo.me - mo.ms + 1);
          else x.fc[j] = mo.current ? Math.max(x.sp[j], x.plan[j]) : x.plan[j];
        });
      });
    });
    return { Y: Y, M: M, months: months, e: e, ok: ok, th: th, curY: curY };
  }
  function lbSum(bm, mk, f, chf, mi) {
    var t = 0;
    (mk ? [mk] : MKT3).forEach(function (m) { LBCH.forEach(function (ch) { if (chf && !chf(ch)) return; var a = bm.M[m][ch.id][f]; if (mi != null) t += a[mi]; else for (var i = 0; i < 12; i++) t += a[i]; }); });
    return t;
  }
  function lbRate(bm, mk) { var t = 0; (mk ? [mk] : MKT3).forEach(function (m) { t += bm.M[m].google.rate + bm.M[m].meta.rate; }); return t; }
  function liveBudgetWarnings(Y, mkOnly, load) {
    if (MODE !== 'live' || !liveReady()) return [];
    var bm = liveBudgetModel(Y, load), out = [];
    if (!bm.ok) return out;
    (mkOnly ? [mkOnly] : MKT3).forEach(function (mk) {
      var name = MK[mk].name, plan = lbSum(bm, mk, 'plan'), spent = lbSum(bm, mk, 'sp'), fc = lbSum(bm, mk, 'fc');
      if (plan) {
        if (spent > plan) out.push({ level: 'bad', text: name + ': spent ' + money(spent) + ' — already ' + money(spent - plan) + ' over the planned ' + money(plan) + ' for ' + Y + '.' });
        else if (fc > plan) out.push({ level: 'bad', text: name + ': forecast to year end ' + money(fc) + ' is ' + money(fc - plan) + ' over the planned ' + money(plan) + '.' });
        else if (fc > plan * 0.95) out.push({ level: 'warn', text: name + ': forecast ' + money(fc) + ' uses ' + pct(fc / plan, 0) + ' of the planned budget.' });
      }
      LBCH.forEach(function (ch) {
        var x = bm.M[mk][ch.id], p = sum(x.plan, Number), s = sum(x.sp, Number), f = sum(x.fc, Number);
        if (ch.live && s > 0 && !p) out.push({ level: 'warn', text: ch.name + ' in ' + name + ': ' + money(s) + ' spent in ' + Y + ' with no planned budget.' });
        else if (p && f > p * 1.05) out.push({ level: 'warn', text: ch.name + ' in ' + name + ': forecast ' + money(f) + ' vs ' + money(p) + ' planned (+' + pct(f / p - 1, 0) + ').' });
        bm.months.forEach(function (mo, i) {
          if (!(mo.past || mo.current) || !x.plan[i] || Y > bm.curY) return;
          if (x.sp[i] > x.plan[i] * 1.1) out.push({ level: 'warn', text: MON[i] + ' ' + Y + ' · ' + ch.name + ' in ' + name + ': spent ' + money(x.sp[i]) + ' vs ' + money(x.plan[i]) + ' planned (+' + pct(x.sp[i] / x.plan[i] - 1, 0) + ').' });
        });
      });
    });
    return out.sort(function (a, b) { return (a.level === 'bad' ? 0 : 1) - (b.level === 'bad' ? 0 : 1); });
  }
  function lbGrid(bm, mk, f, edit) {
    var Y = bm.Y, live = f === 'sp';
    var head = '<thead><tr><th>Channel</th>' + MON3.map(function (m, i) { return '<th class="r' + (bm.months[i].current ? ' cur' : '') + '">' + m + '</th>'; }).join('') + '<th class="r">Total</th></tr></thead>';
    var body = LBCH.map(function (ch) {
      var tot = 0, cells = '';
      for (var i = 0; i < 12; i++) {
        var v = mk ? bm.M[mk][ch.id][f][i] : lbSum(bm, '', f, function (c) { return c.id === ch.id; }, i); tot += v;
        var mo = bm.months[i];
        if (live && ch.live) cells += '<td class="r nw' + (mo.current ? ' cur' : '') + '">' + (mo.future && Y >= bm.curY ? '<span class="muted">—</span>' : bm.ok ? money(v) : '…') + '</td>';
        else if (edit && mk) {
          var id = 'lb-' + f + '-' + mk + '-' + ch.id + '-' + i;
          cells += '<td class="r' + (mo.current ? ' cur' : '') + '"><label class="sr" for="' + id + '">' + esc(ch.name + ', ' + MON[i] + ' ' + Y + ', ' + (f === 'plan' ? 'planned budget' : 'spent') + ' in euros') + '</label><input class="in cell mcell" type="number" min="0" step="100" inputmode="numeric" id="' + id + '" data-chg="lb-set" data-y="' + Y + '" data-mk="' + mk + '" data-ch="' + ch.id + '" data-f="' + (f === 'plan' ? 'plan' : 'spent') + '" data-i="' + i + '" value="' + (v ? Math.round(v) : '') + '" placeholder="0"></td>';
        } else cells += '<td class="r nw' + (mo.current ? ' cur' : '') + '">' + (v ? money(v) : '<span class="muted">0</span>') + '</td>';
      }
      return '<tr><td class="nw"><span class="sdot tone-' + ch.tone + '"></span> ' + esc(ch.name) + (live && ch.live ? ' <span class="chip live-chip">live</span>' : '') + '</td>' + cells + '<td class="r nw"><b style="font-weight:500">' + money(tot) + '</b></td></tr>';
    }).join('');
    var foot = '<tfoot><tr><td>Total</td>';
    var all = 0;
    for (var i = 0; i < 12; i++) { var t = lbSum(bm, mk, f, null, i); all += t; foot += '<td class="r nw' + (bm.months[i].current ? ' cur' : '') + '">' + money(t) + '</td>'; }
    foot += '<td class="r nw">' + money(all) + '</td></tr></tfoot>';
    return '<div class="tablewrap"><table class="tbl lbgrid">' + head + '<tbody>' + body + '</tbody>' + foot + '</table></div>';
  }
  function viewLiveBudget() {
    var thY = ymParts(dnum(through())).y, years = []; for (var y = 2025; y <= Math.max(thY, ymParts(TODAY).y) + 1; y++) years.push(y);
    Object.keys(db.lbudget || {}).forEach(function (k) { if (/^\d{4}$/.test(k) && years.indexOf(+k) < 0) years.push(+k); }); years.sort();
    var Y = +ui.lbudget.year; if (years.indexOf(Y) < 0) Y = thY;
    var mk = ui.lbudget.market === '' ? '' : MKT3.indexOf(ui.lbudget.market) >= 0 ? ui.lbudget.market : 'SI';
    var html = head('Plan', 'Budget<span class="dot">.</span>', '<span>Your planned budgets per market, month and channel (synced with your plan). Spent on Google Ads and Meta comes from the real ad spend; other channels use the amounts you enter.</span>',
      '<label class="sr" for="lbY">Year</label><select class="select" id="lbY" data-chg="lb-year">' + years.map(function (y) { return '<option' + (y === Y ? ' selected' : '') + '>' + y + '</option>'; }).join('') + '</select><button type="button" class="btn" data-act="csv-lbudget" data-y="' + Y + '">' + icon('download') + 'CSV</button>');
    html += '<div class="toolbar"><div class="seg" role="group" aria-label="Market">' + [['', 'All markets']].concat(MKT3.map(function (k) { return [k, MK[k].name]; })).map(function (x) { return '<button type="button" data-act="lb-mk" data-v="' + x[0] + '" aria-pressed="' + (mk === x[0]) + '">' + x[1] + '</button>'; }).join('') + '</div></div>';
    if (!liveReady()) return html + '<div class="card">' + liveWait() + '</div>';
    var bm = liveBudgetModel(Y, true);
    if (bm.e.status === 'error') html += '<div class="card" style="margin-bottom:16px">' + liveErr(bm.e.err) + '</div>';
    else if (!bm.ok) html += '<div class="banner info" role="status">' + icon('info') + '<div>Loading the real ad spend…</div></div>';
    var plan = lbSum(bm, mk, 'plan'), spent = lbSum(bm, mk, 'sp'), fc = lbSum(bm, mk, 'fc'), rate = lbRate(bm, mk), isCur = Y === bm.curY;
    var y0 = dmake(Y, 1, 1), y1 = dmake(Y, 12, 31), inCamps = 0;
    db.campaigns.forEach(function (c) {
      if (c.status === 'cancelled' || c.status === 'idea' || !c.budget) return;
      var s = dnum(c.start), e = dnum(c.end), ov = Math.min(e, y1) - Math.max(s, y0) + 1; if (ov <= 0) return;
      var share = c.market === 'ALL' ? (mk ? ALL_SPLIT[mk] : 1) : (!mk || c.market === mk ? 1 : 0);
      inCamps += c.budget * ov / (e - s + 1) * share;
    });
    html += '<div class="kpis">' + kpiTile('Planned budget ' + Y, money(plan), mk ? esc(MK[mk].name) : 'SI ' + moneyK(lbSum(bm, 'SI', 'plan')) + ' · HR ' + moneyK(lbSum(bm, 'HR', 'plan')) + ' · IT ' + moneyK(lbSum(bm, 'IT', 'plan')), '') +
      kpiTile('Spent' + (isCur ? ' to ' + fmtDs(bm.th) : ''), bm.ok ? money(spent) : '…', plan ? pct(spent / plan, 0) + ' of planned' : 'no budget planned yet', plan && spent > plan ? 'bad' : '') +
      kpiTile('Remaining', plan ? money(plan - spent) : '—', !plan ? 'enter planned budgets below' : plan - spent < 0 ? 'over budget' : 'not yet spent', plan ? (plan - spent < 0 ? 'bad' : 'good') : '') +
      kpiTile('Forecast year end', Y < bm.curY ? money(spent) : bm.ok ? money(fc) : '…', !plan ? 'run-rate + planned' : fc > plan ? money(fc - plan) + ' over budget' : money(plan - fc) + ' headroom', plan ? (fc > plan ? 'bad' : 'good') : '') +
      kpiTile('Ad run-rate', bm.ok ? money(rate) + '/day' : '…', 'Google + Meta, since ' + fmtD(addMonths(monthStart(bm.th), -2)), '') +
      kpiTile('Planned in campaigns', money(inCamps), 'budgets of your planned campaigns in ' + Y, '') + '</div>';
    var warns = liveBudgetWarnings(Y, mk, false);
    html += '<div class="card" style="margin-bottom:16px"><div class="card-h"><div><span class="label">' + Y + (mk ? ' · ' + esc(MK[mk].name) : '') + '</span><h2>Over-budget warnings (' + warns.length + ')</h2></div></div>' +
      (warns.length ? '<ul class="rows">' + warns.slice(0, 40).map(function (w) { return '<li class="' + (w.level === 'bad' ? 'warn' : '') + '"><span class="' + (w.level === 'bad' ? 'warnic' : 'muted') + '">' + icon(w.level === 'bad' ? 'warn' : 'info') + '</span><div class="main"><span>' + esc(w.text) + '</span></div></li>'; }).join('') + '</ul>'
        : '<div class="card-b"><div class="empty box"><b>' + (plan ? 'All within budget' : 'No warnings') + '</b>' + (plan ? 'No market, month or channel is forecast over its planned budget.' : 'Enter planned budgets below to get over-budget warnings.') + '</div></div>') + '</div>';
    var ms = bm.months.map(function (mo, i) {
      var p = lbSum(bm, mk, 'plan', null, i), s = lbSum(bm, mk, 'sp', null, i), f = lbSum(bm, mk, 'fc', null, i), fut = mo.future && Y >= bm.curY;
      return { label: MON3[i], full: MON[i] + ' ' + Y, plan: p, budget: p, sp: fut ? f : s, fc: fut, live: true,
        tip: '<b>' + MON[i] + ' ' + Y + '</b><br>Planned ' + money(p) + '<br>' + (fut ? 'Forecast ' + money(f) : 'Spent ' + money(s) + (mo.current ? ' · forecast ' + money(f) : '')) + (p && (fut ? f : s) > p ? ' <span>(over)</span>' : '') };
    });
    chartData.budget = ms;
    html += '<div class="card"><div class="card-h"><div><span class="label">' + Y + ' · ' + (mk ? esc(MK[mk].name) : 'all markets') + '</span><h2>Planned vs spent per month</h2></div></div><div class="legend"><span><i class="plan"></i>Planned budget</span><span><i class="rev"></i>Spent</span><span><i class="fc"></i>Forecast (future months)</span><span><i class="spend" style="background:var(--bad-dot)"></i>Over the plan</span><span><i class="budget"></i>Planned line</span></div><div class="chart" data-chart="budget"></div></div><div class="gap"></div>';
    html += '<div class="card"><div class="card-h"><div><span class="label">' + (mk ? 'Edit · ' + esc(MK[mk].name) + ' · ' + Y : 'All markets · ' + Y + ' · pick a market to edit') + '</span><h2>Planned budget by channel and month</h2></div></div>' + lbGrid(bm, mk, 'plan', !!mk) + '<p class="hint" style="padding:10px 20px 16px;margin:0">Your team’s numbers: they are saved with your plan and synced. Amounts in euros.</p></div><div class="gap"></div>';
    html += '<div class="card"><div class="card-h"><div><span class="label">' + (mk ? esc(MK[mk].name) + ' · ' + Y : 'All markets · ' + Y) + '</span><h2>Spent by channel and month</h2></div></div>' + lbGrid(bm, mk, 'sp', !!mk) + '<p class="hint" style="padding:10px 20px 16px;margin:0">Google Ads and Meta are the real ad spend (live, read-only). Channels without live data — newsletter, SMS, influencers, in-store and the rest — keep a manual spent field' + (mk ? '' : ' (pick a market to enter them)') + '. Forecast = spent to date + the Google/Meta run-rate for the rest of the year + the planned amounts of the other channels for months still to come.</p></div><div class="gap"></div>';
    html += '<div class="card"><div class="card-h"><div><span class="label">' + Y + '</span><h2>By market</h2></div></div><div class="tablewrap"><table class="tbl"><thead><tr><th>Market</th><th class="r">Planned</th><th class="r">Spent</th><th class="r hide-sm">Remaining</th><th class="r">Forecast</th><th class="r hide-sm">Ad run-rate</th></tr></thead><tbody>' +
      MKT3.map(function (k) { var p = lbSum(bm, k, 'plan'), s = lbSum(bm, k, 'sp'), f = lbSum(bm, k, 'fc'), ov = p && f > p; return '<tr><td>' + mktChip(k) + ' ' + esc(MK[k].name) + '<span class="minibar' + (p && s > p ? ' over' : '') + '" style="margin-top:6px"><i style="width:' + Math.min(100, p ? s / p * 100 : 0) + '%"></i></span></td><td class="r nw">' + money(p) + '</td><td class="r nw">' + money(s) + '</td><td class="r nw hide-sm' + (p - s < 0 ? ' bad-t' : '') + '">' + money(p - s) + '</td><td class="r nw' + (ov ? ' bad-t' : '') + '">' + (ov ? warnIc('Forecast over the planned budget') + ' ' : '') + money(f) + '</td><td class="r nw hide-sm">' + money(lbRate(bm, k)) + '/day</td></tr>'; }).join('') +
      '</tbody></table></div></div>';
    after(drawCharts);
    return html;
  }
  function exportLiveBudgetCsv(Y) {
    var bm = liveBudgetModel(Y, false), rows = [['Year', 'Month', 'Market', 'Channel', 'Planned EUR', 'Spent EUR', 'Spent source', 'Forecast EUR']];
    MKT3.forEach(function (mk) { LBCH.forEach(function (ch) { var x = bm.M[mk][ch.id]; for (var i = 0; i < 12; i++) if (x.plan[i] || x.sp[i] || x.fc[i]) rows.push([Y, i + 1, mk, ch.name, n2(x.plan[i]), n2(x.sp[i]), ch.live ? 'live ad spend' : 'entered', n2(x.fc[i])]); }); });
    downloadCsv('marketing-live-budget-' + Y + '.csv', rows);
  }

  // ══ Events ════════════════════════════════════════════════════════════════
  var ACT = {
    search: function () { quickSearch(); },
    'new-campaign': function () { campaignEditor(null); },
    reset: function () { resetDemo(); },
    'cal-step': function (t) { stepCal(+t.dataset.d); },
    'cal-today': function () { ui.cal.cursor = TODAY_YMD; saveUi(); refresh(); },
    'cal-view': function (t) { ui.cal.view = t.dataset.v; saveUi(); refresh(); },
    'cal-color': function (t) { ui.cal.color = t.dataset.v; saveUi(); refresh(); },
    day: function (t) { dayDialog(+t.dataset.day); },
    'ics-view': function () { var r = calRange(); var list = calCampaigns(r.m0 != null ? r.m0 : r.from, r.m1 != null ? r.m1 : r.to); if (!list.length) return toast('No campaigns in view to export.'); downloadIcs(list, 'marketing-calendar-' + ymdOf(r.m0 != null ? r.m0 : r.from) + '.ics'); },
    'ics-list': function () { var list = listCampaigns(); if (!list.length) return toast('No campaigns to export.'); downloadIcs(list, 'marketing-campaigns-' + TODAY_YMD + '.ics'); },
    'clear-f': function () { ui.f = Object.assign({}, UIDEF.f); saveUi(); refresh(); },
    'clear-all': function () { ui.f = Object.assign({}, UIDEF.f); ui.list.q = ''; saveUi(); refresh(); },
    'camp-edit': function (t) { var c = camp(t.dataset.id); if (c) campaignEditor(c); },
    'camp-dup': function (t) { var c = camp(t.dataset.id); if (c) duplicateDialog(c); },
    'camp-more': function (t) {
      var c = camp(t.dataset.id); if (!c) return;
      var items = [{ label: 'Build UTM links', icon: 'link', run: function () { setUtmCampaign(c.id); location.hash = '#/utm'; } },
        { label: 'Export to calendar (.ics)', icon: 'cal', run: function () { downloadIcs([c], 'campaign-' + c.id + '.ics'); } },
        { label: 'Show in calendar', icon: 'cal', run: function () { ui.cal.cursor = c.start; ui.cal.view = 'month'; saveUi(); location.hash = '#/'; } }];
      if (c.status !== 'cancelled') items.push({ label: 'Mark as cancelled', icon: 'close', run: function () { c.status = 'cancelled'; c.updatedAt = Date.now(); commit(); toast('Marked as cancelled', { label: 'Undo', run: function () { c.status = 'planned'; commit(); } }); } });
      items.push({ label: 'Delete campaign…', icon: 'trash', run: function () { deleteCampaign(c); } });
      openPop(t, items);
    },
    'post-new': function (t) { postEditor(null, { date: t.dataset.date || ymdOf(TODAY + 1), campaignId: t.dataset.cid ? +t.dataset.cid : null }); },
    'post-edit': function (t) { var p = post(t.dataset.id); if (p) postEditor(p); },
    'file-open': function (t) { var c = camp(t.dataset.id); if (c) openFile(c, t.dataset.h); },
    'file-del': function (t) { var c = camp(t.dataset.id); if (c) removeFile(c, t.dataset.h); },
    'comment-del': function (t) { var c = camp(t.dataset.id); if (!c) return; c.comments = c.comments.filter(function (m) { return String(m.id) !== t.dataset.mid; }); commit(); toast('Comment deleted'); },
    sort: function (t) { var k = t.dataset.k; if (ui.list.sort === k) ui.list.dir = -ui.list.dir; else { ui.list.sort = k; ui.list.dir = k === 'name' || k === 'market' || k === 'owner' ? 1 : -1; } saveUi(); refresh(); },
    'list-more': function () { ui.list.show += 50; refresh(); },
    'csv-campaigns': function () { exportCampaignsCsv(listCampaigns()); },
    'content-view': function (t) { ui.content.view = t.dataset.v; saveUi(); refresh(); },
    'bulk-apply': function () {
      var st = $('#bkSt').value, sh = +$('#bkSh').value || 0, who = $('#bkAs').value, ids = Object.keys(selPosts).map(Number);
      if (!st && !sh && !who) return toast('Pick a status, a date shift or a person first.');
      movePosts(ids, st, sh, who);
    },
    'bulk-clear': function () { selPosts = {}; refresh(); },
    'csv-content': function () { exportContentCsv(listPosts()); },
    'perf-period': function (t) { ui.perf.period = t.dataset.v; saveUi(); refresh(); },
    'perf-tab': function (t) { ui.perf.tab = t.dataset.v; saveUi(); refresh(); },
    'perf-rank': function (t) { ui.perf.rank = t.dataset.v; saveUi(); refresh(); },
    'csv-perf': function () { exportPerfCsv(); },
    'csv-budget': function (t) { exportBudgetCsv(+t.dataset.y); },
    copy: function (t) { var s = t.dataset.text; if (!s) return; copyText(s).then(function (ok) { toast(ok ? 'Copied to the clipboard' : 'Copy failed — select the text and copy it'); }); },
    'utm-rule': function () { var c = camp(ui.utm.cid); if (c) { ui.utm.campaign = utmCampaign(c); saveUi(); refresh(); } },
    'utm-fix': function () { ['source', 'medium', 'campaign', 'content', 'term'].forEach(function (k) { ui.utm[k] = utmNorm(ui.utm[k]); }); saveUi(); refresh(); },
    'utm-clear': function () { ui.utm = Object.assign({}, UIDEF.utm); saveUi(); refresh(); },
    'utm-save': function () {
      var c = camp(ui.utm.cid), url = buildUtm(ui.utm); if (!c || !url) return;
      if (c.utms.some(function (x) { return x.url === url; })) return toast('This link is already saved on the campaign.');
      c.utms.push({ id: ++db.seq.utm, url: url, source: ui.utm.source, medium: ui.utm.medium, content: ui.utm.content, term: ui.utm.term, at: Date.now() });
      var ticked = !c.checklist.tracking; c.checklist.tracking = true; c.updatedAt = Date.now();
      commit(); toast('Saved to “' + c.name + '”' + (ticked ? ' · ticked “Tracking / UTM set up”' : ''));
    },
    'utm-del': function (t) { var c = camp(ui.utm.cid); if (!c) return; c.utms = c.utms.filter(function (x) { return String(x.id) !== t.dataset.id; }); commit(); toast('Saved link removed'); },
    'utm-all-csv': function () { var c = camp(ui.utm.cid); downloadCsv('utm-links-' + (c ? D.slug(c.name) : 'campaign') + '.csv', [['Channel', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'URL']].concat(utmRows.map(function (r) { return [CH[r.ch].name, r.u.source, r.u.medium, r.u.campaign, r.u.content, r.url]; }))); },
    // live mode
    mode: function (t) { var v = t.dataset.v === 'live' ? 'live' : 'demo'; lsSet(MODEKEY, v); if (v === MODE) return; applyMode(v); toast(MODE === 'live' ? 'Live: your plan with real ad numbers' : 'Demo: the separate fictional plan'); },
    'live-signin': function () { if (window.AdrialSync && window.AdrialSync.signIn) window.AdrialSync.signIn(); },
    'live-session-retry': function () { checkSession().then(function () { applyMode(wantMode()); }); },
    'live-retry': function () { retryLive(); },
    'cal-ads': function () { ui.cal.ads = !ui.cal.ads; saveUi(); refresh(); },
    'ad-open': function (t) { var k = t.dataset.k, r = (adsNow && adsNow.idx && adsNow.idx[k]) || adIndex[k]; if (r) adDialog(r, adsNow && adsNow.idx && adsNow.idx[k] ? adsNow : null); },
    'lp-open': function (t) { var r = lpIdx[t.dataset.k]; if (r) { var P = lperiod(); adDialog(r, { from: P.from, to: P.to }); } },
    'ad-plan': function (t) { var r = lpIdx[t.dataset.k] || adIndex[t.dataset.k]; if (r) campaignEditor(null, presetFromRow(r)); },
    'ads-always': function (t) {
      if (!adsNow || !adsNow.always) return; var g = adsNow.always.filter(function (x) { return x.market === t.dataset.m; })[0]; if (!g) return;
      adsListDialog(alwaysLabel(g), g.list, 'Spending on at least ' + adsNow.need + ' of the ' + adsNow.days + ' days in view (' + fmtRange(adsNow.from, adsNow.to) + '). Numbers are for that window.');
    },
    'ads-day': function (t) { if (!adsNow || !adsNow.bars) return; var d = +t.dataset.day; adsListDialog('Ad campaigns on ' + dayLabel(d), adsNow.bars.filter(function (a) { return a.s <= d && a.e >= d; }).map(function (a) { return a.row; }), 'Shorter (not always-on) campaigns with spend on this day. Numbers are for ' + fmtRange(adsNow.from, adsNow.to) + '.'); },
    'ads-rest': function () { if (!adsNow || !adsNow.bars) return; adsListDialog('Smaller ad campaigns in view', adsNow.bars.slice(60).map(function (a) { return a.row; }), 'Numbers are for ' + fmtRange(adsNow.from, adsNow.to) + '.'); },
    'link-pick': function (t) { var c = camp(t.dataset.id); if (c) linkPicker(c); },
    'link-del': function (t) {
      var c = camp(t.dataset.id); if (!c) return; var prev = c.links.slice(), k = t.dataset.k;
      c.links = c.links.filter(function (l) { return l.k !== k; }); c.updatedAt = Date.now(); commit();
      toast('Unlinked', { label: 'Undo', run: function () { c.links = prev; c.updatedAt = Date.now(); commit(); } });
    },
    'import-ads': function () { importDialog(); },
    'lperf-period': function (t) { ui.lperf.period = t.dataset.v; saveUi(); refresh(); },
    'lperf-tab': function (t) { ui.lperf.tab = t.dataset.v; saveUi(); refresh(); },
    'lperf-rank': function (t) { ui.lperf.rank = t.dataset.v; saveUi(); refresh(); },
    'csv-lperf': function () { exportLivePerfCsv(); },
    'lb-mk': function (t) { ui.lbudget.market = t.dataset.v; saveUi(); refresh(); },
    'csv-lbudget': function (t) { exportLiveBudgetCsv(+t.dataset.y); }
  };
  var CHG = {
    f: function (t) { ui.f[t.dataset.k] = t.value; ui.list.show = 50; saveUi(); refresh(); },
    'cal-kd': function (t) { ui.cal.kd = t.value; saveUi(); refresh(); },
    check: function (t) { var c = camp(t.dataset.id); if (!c) return; c.checklist[t.dataset.k] = t.checked; c.updatedAt = Date.now(); commit(); },
    files: function (t) { var c = camp(t.dataset.id); if (c) addFiles(c, t.files); t.value = ''; },
    'content-f': function (t) { ui.content[t.dataset.k] = t.value; saveUi(); refresh(); },
    sel: function (t) { if (t.checked) selPosts[t.dataset.id] = true; else delete selPosts[t.dataset.id]; refresh(); },
    'sel-all': function (t) { selPosts = {}; if (t.checked) listPosts().forEach(function (p) { selPosts[p.id] = true; }); refresh(); },
    'post-move': function (t) { movePosts([+t.dataset.id], t.value); },
    'perf-f': function (t) { ui.perf[t.dataset.k] = t.value; saveUi(); refresh(); },
    'budget-year': function (t) { ui.budget.year = t.value; saveUi(); refresh(); },
    'budget-set': function (t) {
      var v = Math.round(+t.value); if (!(v >= 0) || v > 1e8) { toast('Enter a budget between 0 and 100.000.000 €.'); refresh(); return; }
      var y = t.dataset.y; db.budgets[y] = db.budgets[y] || { SI: 0, HR: 0, IT: 0 }; db.budgets[y][t.dataset.k] = v; commit(); toast(MK[t.dataset.k].name + ' budget for ' + y + ' set to ' + money(v));
    },
    'utm-cid': function (t) { if (t.value) setUtmCampaign(t.value); else { ui.utm.cid = ''; saveUi(); } refresh(); },
    'utm-ch': function (t) { var p = utmPreset(t.value); ui.utm.ch = t.value; if (p) { ui.utm.source = p.source; ui.utm.medium = p.medium; if (p.content || !ui.utm.content) ui.utm.content = p.content; } saveUi(); refresh(); },
    'lperf-f': function (t) { var k = t.dataset.k; ui.lperf[k] = k === 'min' ? Math.max(0, Math.min(1e7, Math.round(+t.value || 0))) : t.value; saveUi(); refresh(); },
    'lb-year': function (t) { ui.lbudget.year = t.value; saveUi(); refresh(); },
    'lb-set': function (t) {
      var v = t.value === '' ? 0 : Math.round(+t.value);
      if (!(v >= 0) || v > 1e8) { toast('Enter an amount between 0 and 100.000.000 €.'); refresh(); return; }
      var d = t.dataset; if (MKT3.indexOf(d.mk) < 0 || !LBC[d.ch] || (d.f !== 'plan' && d.f !== 'spent') || (d.f === 'spent' && LBC[d.ch].live)) return;
      // re-render after the browser has moved focus (Tab / Enter), so focus stays on the next cell
      lbSet(d.y, d.mk, d.ch, d.f, +d.i, v); commit(true); setTimeout(refresh, 0);
    }
  };
  var inpTimer = null, noteTimer = null;
  var INP = {
    'list-q': function (t) { ui.list.q = t.value; ui.list.show = 50; clearTimeout(inpTimer); inpTimer = setTimeout(function () { saveUi(); refresh(); }, 180); },
    'content-q': function (t) { ui.content.q = t.value; clearTimeout(inpTimer); inpTimer = setTimeout(function () { saveUi(); refresh(); }, 180); },
    note: function (t) {
      var c = camp(t.dataset.id); if (!c) return; var s = $('#noteSaved'); if (s) s.textContent = 'Editing…';
      clearTimeout(noteTimer); noteTimer = setTimeout(function () { c.notes = t.value.slice(0, 5000); c.updatedAt = Date.now(); save(); var s2 = $('#noteSaved'); if (s2) s2.textContent = 'Saved'; }, 500);
    },
    utm: function (t) { ui.utm[t.dataset.k] = t.value; saveUi(); clearTimeout(inpTimer); inpTimer = setTimeout(refresh, 250); }
  };
  var SUB = {
    comment: function (f) {
      var c = camp(f.dataset.id), ta = $('textarea', f), text = ta.value.trim(); if (!c) return;
      if (!text) { ta.focus(); toast('Write something first.'); return; }
      var me = myIdentity();
      c.comments.push({ id: ++db.seq.comment, at: Date.now(), by: me.email, name: me.name, text: text.slice(0, 4000), mine: true });
      c.updatedAt = Date.now(); commit(); var n = $('#cmIn'); if (n) n.focus(); toast('Comment added');
    },
    'quick-post': function (f) {
      var d = $('#qaDate', f).value, t = $('#qaT', f).value.trim();
      if (!validYmd(d)) { $('#qaDate', f).focus(); toast('Pick a date.'); return; }
      if (!t) { $('#qaT', f).focus(); toast('Give the post a title.'); return; }
      var p = { id: ++db.seq.content, date: d, time: '12:00', channel: $('#qaCh', f).value, market: $('#qaM', f).value, title: t.slice(0, 140), caption: '', status: 'brief', assignee: defaultPerson('u5'), campaignId: null };
      db.content.push(p); commit();
      var n = $('#qaT'); if (n) { n.value = ''; n.focus(); }
      toast('Added “' + p.title + '” for ' + fmtD(d) + (contentRange()[0] <= dnum(d) && dnum(d) <= contentRange()[1] ? '' : ' — outside the current period filter'));
    }
  };
  document.addEventListener('click', function (e) {
    var bar = e.target.closest('.bar[data-cid]');
    if (bar && !e.target.closest('[data-act]')) { e.preventDefault(); location.hash = '#/c/' + bar.dataset.cid; return; }
    var t = e.target.closest('[data-act]'); if (!t || t.disabled) return;
    var fn = ACT[t.dataset.act]; if (!fn) return;
    if (t.tagName === 'A') e.preventDefault();
    if (!db && t.dataset.act !== 'reset') return;
    fn(t, e);
  });
  document.addEventListener('change', function (e) { var t = e.target.closest('[data-chg]'); if (t && db && CHG[t.dataset.chg]) CHG[t.dataset.chg](t, e); });
  document.addEventListener('input', function (e) { var t = e.target.closest('[data-inp]'); if (t && db && INP[t.dataset.inp]) INP[t.dataset.inp](t, e); });
  document.addEventListener('submit', function (e) { var f = e.target.closest('form[data-sub]'); if (!f) return; e.preventDefault(); if (db && SUB[f.dataset.sub]) SUB[f.dataset.sub](f, e); });
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); if (db && !stack.length) quickSearch(); return; }
    if (e.key === 'Escape') {
      if (pop) { closePop(true); return; }
      if (stack.length) { stack[stack.length - 1].close(); return; }
      closeSide(true);
    }
    if (e.key === 'Tab' && stack.length) {
      var m = stack[stack.length - 1].el, f = $$(FOCUSABLE, m).filter(function (x) { return x.offsetParent !== null || x === document.activeElement; });
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  });
  $('#menuBtn').addEventListener('click', function () { if ($('#side').classList.contains('open')) closeSide(true); else openSide(); });
  $('#sideScrim').addEventListener('click', function () { closeSide(true); });
  window.addEventListener('hashchange', function () { if (db) route(true); });

  // ── Reset ─────────────────────────────────────────────────────────────────
  function resetDemo() {
    confirmDialog({ title: 'Reset demo data?', text: 'This throws away every change you made (campaigns, posts, comments, attached files, budgets) and regenerates the original demo data. If you are signed in to cloud sync, the reset data replaces your cloud copy at the next sync.', ok: 'Reset demo data', danger: true }).then(function (ok) {
      if (!ok) return;
      clearTimeout(saveTimer); saveTimer = null;
      plans.demo = migrate(D.generate(TODAY_YMD)); if (MODE === 'demo') db = plans.demo; perfCache.clear(); selPosts = {}; dataRev++;
      // creatives attached to the live plan stay; only files no longer used by either plan are removed
      fileKeys().then(function (keys) { keys.forEach(function (k) { if (!hashUsed(k)) fileDel(k).catch(function () { /* ignore */ }); }); }, function () { /* ignore */ });
      dirty = true; dirtyKeys.demo = true; flushNow();
      updateNav();
      if (location.hash === '#/' || location.hash === '') route(true); else location.hash = '#/';
      toast('Demo data reset');
    });
  }

  // ── Cloud sync (AdrialSync) ───────────────────────────────────────────────
  var sync = null;
  // One snapshot, two clearly separated plans. Live ad NUMBERS are never in it (only the plan, incl. linked campaign keys and names).
  function snapshot() {
    return Promise.resolve(writing).then(function () {
      // the live plan (real campaign names and links) goes only into the cloud copy of the approved account
      // that is signed in now; on a shared browser another (not approved) account never receives it
      var u = null;
      try { u = window.AdrialSync.user(); } catch (e) { u = null; }
      var email = u && u.email ? String(u.email).toLowerCase() : '';
      var mine = !!(LIVE.session && LIVE.session.allowed && LIVE.session.email && LIVE.session.email === email);
      return { version: 2, format: 'adrial-marketing-plans', demo: plans.demo || null, live: mine ? (plans.live || null) : null };
    });
  }
  function applyCloud(data) {
    var demo = null, live = null;
    if (data && data.version === 2) { demo = validDb(data.demo) ? data.demo : null; live = validDb(data.live) ? data.live : null; }
    else if (validDb(data)) demo = data;                          // version 1 = the demo plan only (before live mode)
    if (!demo && !live) return Promise.reject(new Error('The cloud copy is not valid marketing-calendar data.'));
    clearTimeout(saveTimer); dirty = false; dirtyKeys = {};
    return Promise.resolve(writing).then(function () {
      closeAllModals(); endDrag(true);
      if (demo) plans.demo = migrate(demo);
      if (live) plans.live = migrate(live);
      db = plans[MODE] || db; perfCache.clear(); selPosts = {}; dataRev++;
      return Promise.all([demo ? idbPut(plans.demo, 'demo') : null, live ? idbPut(plans.live, 'live') : null]).catch(function () { /* stays in memory */ });
    }).then(function () {
      if (bc) { try { bc.postMessage({ type: 'changed', from: TAB_ID }); } catch (e) { /* ignore */ } }
      updateNav(); refresh();
      toast('Marketing calendar loaded from the cloud' + (MODE === 'live' ? ' (live plan' + (live ? '' : ' unchanged') + ')' : ''));
    });
  }
  function hashUsed(h) { return ['demo', 'live'].some(function (k) { return plans[k] && plans[k].campaigns.some(function (x) { return x.files.some(function (y) { return y.hash === h; }); }); }); }
  function referencedHashes() { var h = {}; ['demo', 'live'].forEach(function (k) { if (plans[k]) plans[k].campaigns.forEach(function (c) { c.files.forEach(function (f) { if (f.hash) h[f.hash] = f.type; }); }); }); return h; }
  var syncFiles = {
    list: function () {
      var refs = referencedHashes();
      return fileKeys().then(function (keys) {
        return keys.filter(function (k) { return refs[k]; }).map(function (k) { return { hash: k, type: refs[k], getBlob: function () { return fileGet(k).then(function (r) { return r.blob; }); } }; });
      }, function () { return []; });
    },
    has: function (hash) { return fileGet(hash).then(function (r) { return !!r; }, function () { return false; }); },
    put: function (hash, blob, type) { return filePut(hash, { hash: hash, blob: blob, type: type || blob.type }); }
  };
  function attachSync() {
    if (!window.AdrialSync || sync) return;
    try { sync = window.AdrialSync.attach({ app: 'marketing', label: 'Marketing calendar', getSnapshot: snapshot, applySnapshot: applyCloud, files: syncFiles }); } catch (e) { sync = null; }
    var side = $('#syncSide');
    if (sync && side) sync.mountPanel(side); else if (side) side.innerHTML = '<p class="hint" style="margin:0">Cloud sync is not available on this page.</p>';
    if (window.AdrialSync && window.AdrialSync.on) window.AdrialSync.on(function (a) {
      if (db && current.parts[0] === 'c' && !stack.length) refresh();
      // signing in or out may change whether live numbers are allowed
      var em = a && a.user && a.user.email ? String(a.user.email).toLowerCase() : null;
      if (a && a.loaded && LIVE.session && em !== (LIVE.session.email || null)) checkSession().then(function () { applyMode(wantMode()); });
    });
  }

  // ── Boot ──────────────────────────────────────────────────────────────────
  function boot() {
    MODE = wantMode(); db = plans[MODE]; dataRev++;
    renderModeUi(); updateNav(); route(false); attachSync();
  }
  Promise.all([loadPlans().then(null, function () {
    plans.demo = plans.demo || migrate(D.generate(TODAY_YMD)); plans.live = plans.live || emptyLivePlan(); saveWarned = true;
    toast('Changes could not be saved in this browser (storage blocked or full). They last until you reload.');
  }), checkSession()]).then(boot);
})();
