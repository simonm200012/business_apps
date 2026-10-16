/* Data health check — vanilla JS single-page app (Business Apps).
 * Reads a customer, supplier or product list (CSV, TSV, TXT, pasted rows; Excel through SheetJS, loaded from cdnjs only
 * when an Excel file is picked), checks every value with engine.js and shows a score, the issues with one-click fixes,
 * duplicate groups, exports and a printable report. Files are read in this browser and never uploaded.
 * Storage: IndexedDB "stratum-datacheck" — store "kv", key "db": { version, settings, checks: [summary of each check] } (one
 * versioned document; this is what cloud sync copies) and store "tables": one record per check with its rows, column roles,
 * fixes and duplicate decisions (only in this browser, and only while "Keep files in this browser" is on). Writes are
 * debounced and serialised and flushed when the page is hidden; other tabs follow via BroadcastChannel("stratum-datacheck").
 * The document also holds the recipes (saved column roles and fixes, db.recipes) and each check keeps its first score
 * (meta.first). The VIES answers of a check live with its rows (record.vies), so they stay in this browser.
 * Online VAT check: only when the person asks for it, GET /api/vies/:country/:number (worker/index.js) sends the VAT IDs, and
 * nothing else, to the EU's VIES service. Everything else works without it.
 * UI preferences: localStorage "stratum-datacheck-ui" ({ sev, exp, lang }). Screen language English, Slovene or Croatian
 * (i18n.js: tx() for screen texts, lx() for the English texts the engine writes); ?lang=sl|hr|en in the URL picks it too.
 * Routes: #/, #/check/:id[/summary|columns|issues|rows|duplicates|export][/rule], #/report/:id, #/settings. */
(function () {
  'use strict';

  var E = window.DataCheckEngine, X = window.DataCheckData, I18N = window.DcI18n;
  var $ = function (id) { return document.getElementById(id); };
  var UIKEY = 'stratum-datacheck-ui', DB_NAME = 'stratum-datacheck', VERSION = 1;
  var SHEETJS = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  var MAX_ROWS = 200000, MAX_BYTES = 150 * 1024 * 1024, PAGE = 50, DUP_PAGE = 10;
  var TABS = [['summary', 'Summary'], ['columns', 'Columns'], ['issues', 'Issues'], ['rows', 'Rows'], ['duplicates', 'Duplicates'], ['export', 'Export']];
  var SEV_NAME = { error: 'Error', warning: 'Warning', info: 'Note' };
  var DUP_ROLES = { name: 1, vat: 1, oib: 1, email: 1, phone: 1, postal: 1, street: 1, iban: 1, ean: 1, sku: 1, country: 1 };

  function todayLj() {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Ljubljana', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
    catch (e) { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  }
  var TODAY = todayLj();

  /** run fn soon, after pending events and rendering, without the clamping and background throttling of setTimeout */
  var nextTick = (function () {
    if (!window.MessageChannel) return function (fn) { setTimeout(fn, 0); };
    var ch = new MessageChannel(), q = [];
    ch.port1.onmessage = function () { var fn = q.shift(); if (fn) fn(); };
    return function (fn) { q.push(fn); ch.port2.postMessage(0); };
  })();

  // ── storage ──────────────────────────────────────────────────────────────
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* blocked */ } }
  var idbP = null, idbOK = true;
  function idbOpen() {
    if (!idbP) {
      idbP = new Promise(function (resolve, reject) {
        try {
          if (!window.indexedDB) throw new Error('IndexedDB not available');
          var rq = indexedDB.open(DB_NAME, 1);
          rq.onupgradeneeded = function () {
            var d = rq.result;
            if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
            if (!d.objectStoreNames.contains('tables')) d.createObjectStore('tables', { keyPath: 'id' });
          };
          rq.onsuccess = function () { var d = rq.result; d.onversionchange = function () { d.close(); idbP = null; }; resolve(d); };
          rq.onerror = function () { reject(rq.error || new Error('IndexedDB open failed')); };
          rq.onblocked = function () { reject(new Error('IndexedDB blocked')); };
        } catch (e) { reject(e); }
      });
      idbP.catch(function () { idbP = null; });
    }
    return idbP;
  }
  function idbTx(store, mode, fn) {
    return idbOpen().then(function (d) {
      return new Promise(function (resolve, reject) {
        var t, out;
        try { t = d.transaction(store, mode); out = fn(t.objectStore(store)); } catch (e) { reject(e); return; }
        t.oncomplete = function () { resolve(out && 'result' in out ? out.result : undefined); };
        t.onerror = t.onabort = function () { reject(t.error || new Error('IndexedDB transaction failed')); };
      });
    });
  }
  var kvGet = function () { return idbTx('kv', 'readonly', function (s) { return s.get('db'); }); };
  var kvPut = function (v) { return idbTx('kv', 'readwrite', function (s) { s.put(v, 'db'); }); };
  // rows are stored as one string each (cells joined by U+001F): cloning 50.000 strings is far quicker than 2 million
  var SEP = '\u001F';
  /** the record with its rows joined, built a slice at a time so a big file does not stall the page */
  function pack(rec) {
    return new Promise(function (resolve) {
      var rows = rec.rows, n = rows.length, packed = new Array(n), i = 0;
      (function slice() {
        var stop = Math.min(n, i + 4000);
        for (; i < stop; i++) {
          var j = rows[i].join(SEP);
          if (j.split(SEP).length !== rows[i].length) { resolve(rec); return; } // a cell holds U+001F itself: store as it is
          packed[i] = j;
        }
        if (i < n) { nextTick(slice); return; }
        var out = Object.assign({}, rec); out.rows = null; out.packed = packed; out.width = rec.headers.length;
        resolve(out);
      })();
    });
  }
  function unpack(rec) {
    if (!rec || !Array.isArray(rec.packed)) return rec;
    var w = rec.width || rec.headers.length;
    rec.rows = rec.packed.map(function (line) { var r = line.split(SEP); while (r.length < w) r.push(''); return r; });
    delete rec.packed; delete rec.width;
    return rec;
  }
  var tGet = function (id) { return idbTx('tables', 'readonly', function (s) { return s.get(id); }).then(unpack); };
  var tPut = function (rec) { return pack(rec).then(function (p) { return idbTx('tables', 'readwrite', function (s) { s.put(p); }); }); };
  var tDel = function (id) { return idbTx('tables', 'readwrite', function (s) { s.delete(id); }); };
  var tKeys = function () { return idbTx('tables', 'readonly', function (s) { return s.getAllKeys(); }); };
  var tClear = function () { return idbTx('tables', 'readwrite', function (s) { s.clear(); }); };

  var saveTimer = null, dirty = {}, writeQ = Promise.resolve(), warned = false, syncWanted = false, applying = false;
  function failed(err) {
    idbOK = false;
    if (window.console) console.warn('Data health check: browser storage unavailable, keeping data in memory.', err);
    if (!warned) { warned = true; setTimeout(function () { toast(tx('Browser storage is unavailable: checks last until you reload.')); }, 50); }
  }
  function enqueue(job) { var p = writeQ.then(job); writeQ = p.catch(failed); return p; }
  /** save the document (and the named check's rows); byPerson: the person changed something, so cloud sync follows */
  function save(byPerson, tableId) {
    if (byPerson) syncWanted = true;
    if (tableId) dirty[tableId] = 1;
    clearTimeout(saveTimer); saveTimer = setTimeout(flush, 300);
  }
  function flush() {
    if (!saveTimer) return writeQ;
    clearTimeout(saveTimer); saveTimer = null;
    var ids = Object.keys(dirty), wantSync = syncWanted; dirty = {}; syncWanted = false;
    if (!idbOK) return writeQ;
    return enqueue(function () {
      var p = kvPut(db);
      ids.forEach(function (id) {
        p = p.then(function () {
          var rec = tables[id];
          if (!rec || !db.checks.some(function (c) { return c.id === id; })) return tDel(id).then(function () { delete stored[id]; });
          return db.settings.keepFiles ? tPut(rec).then(function () { stored[id] = true; }) : null;
        });
      });
      return p.then(function () { announce(ids); if (wantSync && !applying) syncChanged(); });
    });
  }
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flush(); });
  var channel = null;
  try { if (window.BroadcastChannel) channel = new BroadcastChannel('stratum-datacheck'); } catch (e) { channel = null; }
  function announce(ids) { if (channel) { try { channel.postMessage({ type: 'changed', ids: ids || [] }); } catch (e) { /* closed */ } } }

  // ── state ────────────────────────────────────────────────────────────────
  var db = null, tables = {}, raw = {}, cur = null, stored = {};
  function defaultSettings() {
    var req = {};
    E.TYPES.forEach(function (t) { req[t.id] = { required: E.DEFAULT_REQ[t.id].required.slice(), recommended: E.DEFAULT_REQ[t.id].recommended.slice() }; });
    // reportLang '' = the screen language; reportLangSet: the person picked a report language themselves
    return { req: req, dupThreshold: 85, home: 'SI', vatRates: { SI: [22, 9.5, 5], HR: [25, 13, 5] }, preparedBy: 'Simon Modic, Clearfigure', preparedFor: '', reportLang: '', reportLangSet: false, keepFiles: true, bookingUrl: '' };
  }
  function validDb(o) { return !!(o && o.version === VERSION && o.settings && typeof o.settings === 'object' && Array.isArray(o.checks)); }
  function ensureSchema(d) {
    var def = defaultSettings(), s = d.settings;
    Object.keys(def).forEach(function (k) { if (s[k] == null || typeof s[k] !== typeof def[k]) s[k] = def[k]; });
    E.TYPES.forEach(function (t) { var r = s.req[t.id]; if (!r || !Array.isArray(r.required) || !Array.isArray(r.recommended)) s.req[t.id] = def.req[t.id]; });
    ['SI', 'HR'].forEach(function (cc) { if (!Array.isArray(s.vatRates[cc])) s.vatRates[cc] = def.vatRates[cc]; });
    if (s.home !== 'SI' && s.home !== 'HR') s.home = 'SI';
    // 'en' was the default before the screens had languages: unless the person chose it, the report follows the screens
    if (['', 'en', 'sl', 'hr'].indexOf(s.reportLang) < 0 || (s.reportLang === 'en' && !s.reportLangSet)) s.reportLang = '';
    d.checks = d.checks.filter(function (c) { return c && typeof c.id === 'string' && typeof c.name === 'string'; });
    d.recipes = Array.isArray(d.recipes) ? d.recipes.filter(function (x) { return x && typeof x.id === 'string' && typeof x.name === 'string' && Array.isArray(x.cols); }) : [];
    if (!safeUrl(s.bookingUrl)) s.bookingUrl = '';
    return d;
  }
  function newDb() { return { version: VERSION, settings: defaultSettings(), checks: [], recipes: [], seeded: false }; }
  /** an https link (the booking link in the report), or '' */
  function safeUrl(u) { u = String(u || '').trim(); return /^https:\/\/[^\s"'<>]+$/i.test(u) && u.length <= 300 ? u : ''; }
  function findCheck(id) { return db.checks.filter(function (c) { return c.id === id; })[0] || null; }
  function hasData(meta) { return !!(tables[meta.id] || stored[meta.id]); }
  var ui = {};
  try { ui = JSON.parse(lsGet(UIKEY) || '{}') || {}; } catch (e) { ui = {}; }
  ui.sev = ['all', 'error', 'warning', 'info'].indexOf(ui.sev) >= 0 ? ui.sev : 'all';
  ui.exp = Object.assign({ delim: ';', dropIgnored: false, dropErrors: false, isoDates: false, dec: 'keep', merge: true }, ui.exp || {});
  // "Only one-click fixes" is a filter for the open check only: it is never saved, so it cannot hide issues later
  function saveUi() { lsSet(UIKEY, JSON.stringify({ sev: ui.sev, exp: ui.exp, lang: ui.lang })); }

  // ── screen language (English, Slovene, Croatian) ─────────────────────────
  function defaultLang() { var n = String((navigator.languages && navigator.languages[0]) || navigator.language || '').toLowerCase(); return n.indexOf('sl') === 0 ? 'sl' : n.indexOf('hr') === 0 || n.indexOf('bs') === 0 || n.indexOf('sr') === 0 ? 'hr' : 'en'; }
  if (I18N.LANGS.indexOf(ui.lang) < 0) delete ui.lang;
  (function () { // ?lang=sl|hr|en (the public site's demo links): used and kept as the choice
    var q = null; try { q = new URLSearchParams(location.search).get('lang'); } catch (e) { q = null; }
    if (I18N.LANGS.indexOf(q) >= 0 && q !== ui.lang) { ui.lang = q; saveUi(); }
  })();
  var LANG = ui.lang || defaultLang(), I = I18N.make(LANG);
  /** a screen text in the chosen language; {name} placeholders filled from v */
  function tx(s, v) { return I.t(s, v); }
  /** a text the engine wrote in English (rule titles, messages, role names…): translated by dictionary and pattern */
  function lx(s) { return I.x(s); }
  function setLang(l) {
    if (I18N.LANGS.indexOf(l) < 0) return;
    LANG = l; I = I18N.make(l); ui.lang = l; saveUi();
    shellText(); closeLayer(); render();
  }
  /** the texts in index.html */
  function shellText() {
    document.documentElement.lang = LANG;
    $('skipLink').textContent = tx('Skip to content');
    $('brandName').textContent = tx('Data health check');
    $('brandSub').textContent = tx('Files stay in this browser');
    $('menuLabel').textContent = tx('Menu');
    $('side').setAttribute('aria-label', tx('Data health check navigation'));
    $('nav').setAttribute('aria-label', tx('Sections'));
    $('demoPill').title = tx('The three demo files are fictional exports with planted problems. Files you check are read in this browser and never uploaded; with cloud sync on, only settings and the list of checks with their scores travel.');
    $('demoPillText').textContent = tx('Demo data · saved in this browser only');
    $('langLabel').textContent = tx('Language');
    $('uiLang').value = LANG;
    var bt = $('bootText'); if (bt) bt.textContent = tx('Opening the data health check…');
    $('dropText').textContent = tx('Drop the file to check it');
    $('busyTrack').setAttribute('aria-label', tx('Progress'));
  }
  var view = { open: {}, rowsF: 'all', rowsQ: '', rowsPage: 0, dupPage: 0, lastId: null, fixOnly: false };

  // ── formatting ───────────────────────────────────────────────────────────
  var nf0 = new Intl.NumberFormat('sl-SI', { maximumFractionDigits: 0 });
  var nf2 = new Intl.NumberFormat('sl-SI', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function n0(n) { return nf0.format(n || 0); }
  function pct(part, whole) { if (!whole || !part) return '0 %'; var p = part / whole * 100; return (p < 1 ? '<1' : nf0.format(Math.round(p))) + ' %'; }
  /** "3 rows" in the screen language (Slovene has four forms, Croatian three); cs: a case form from i18n.js NOUNS ('in' …) */
  function plural(n, one, many, cs) { return n0(n) + ' ' + I.noun(n, one, many, cs); }
  function dt(iso) { if (!iso) return '—'; var d = String(iso).slice(0, 10); return +d.slice(8, 10) + '. ' + +d.slice(5, 7) + '. ' + d.slice(0, 4) + (LANG === 'hr' ? '.' : ''); }
  function dtTime(iso) {
    if (!iso) return '—';
    try { return new Intl.DateTimeFormat(LANG === 'hr' ? 'hr-HR' : 'sl-SI', { timeZone: 'Europe/Ljubljana', day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)); }
    catch (e) { return dt(iso); }
  }
  function cut(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  /** a value with its invisible characters made visible: ␣ space at an end, ⍽ non-breaking space, ↵ line break, ⇥ tab */
  function showWs(v, n) {
    v = String(v == null ? '' : v);
    if (n && v.length > n) v = v.slice(0, n - 1) + '…';
    if (v === '') return '<span class="muted">' + esc(tx('(empty)')) + '</span>';
    var m = /^(\s*)([\s\S]*?)(\s*)$/.exec(v), out = '';
    function mark(s) { return s.replace(/[\s\S]/g, function (c) { return c === '\n' || c === '\r' ? (c === '\n' ? '↵' : '') : c === '\t' ? '⇥' : c === '\u00A0' ? '⍽' : c === ' ' ? '␣' : c.charCodeAt(0) < 32 ? '¤' : c; }); }
    out += m[1] ? '<mark class="ws">' + esc(mark(m[1])) + '</mark>' : '';
    out += esc(m[2]).replace(/\u00A0/g, '<mark class="ws">⍽</mark>').replace(/\r?\n/g, '<mark class="ws">↵</mark>').replace(/\t/g, '<mark class="ws">⇥</mark>').replace(/ {2,}/g, function (s) { return '<mark class="ws">' + s.replace(/ /g, '␣') + '</mark>'; });
    out += m[3] ? '<mark class="ws">' + esc(mark(m[3])) + '</mark>' : '';
    return out;
  }
  var IC = {
    up: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
    set: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>', dl: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>', print: '<path d="M7 9V4h10v5M7 17H5v-6h14v6h-2"/><rect x="7" y="14" width="10" height="6"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>', trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>', back: '<path d="M15 6l-6 6 6 6"/>',
    report: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
    check: '<path d="M5 12.5 10 17l9-10"/>', table: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M3.5 10h17M3.5 14.5h17M9 5v14"/>',
    wand: '<path d="M5 19 15 9M14 4v2M19 9h2M17.5 5.5l1.5-1.5M12 6l1-1 6 6-1 1z"/>', paste: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h6"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>', home: '<path d="M4 11.5 12 5l8 6.5V20H4z"/><path d="M10 20v-5h4v5"/>'
  };
  function ic(n) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + IC[n] + '</svg>'; }

  // ── layers: drawer, modal, toast (focus is trapped and returned) ─────────
  var lastFocus = null, modalSubmit = null;
  function openLayer(html, cls) {
    if (!$('layers').innerHTML) lastFocus = document.activeElement;
    $('layers').innerHTML = '<div class="scrim" data-act="close"></div>' + html;
    var el = $('layers').querySelector('.' + cls);
    if (el) { el.setAttribute('tabindex', '-1'); var f = el.querySelector('[autofocus]'); (f || el).focus(); }
  }
  function closeLayer() {
    var had = !!$('layers').innerHTML;
    $('layers').innerHTML = ''; modalSubmit = null;
    if (had && lastFocus && lastFocus.focus && document.contains(lastFocus)) lastFocus.focus();
  }
  function drawer(eyebrow, title, body, foot, wide) {
    openLayer('<aside class="drawer' + (wide ? ' wide' : '') + '" role="dialog" aria-modal="true" aria-labelledby="drH"><div class="dr-head"><div><span class="eyebrow">' + esc(eyebrow) + '</span><h2 id="drH">' + esc(title) + '</h2></div>' +
      '<button type="button" class="btn icon sm" data-act="close" aria-label="' + esc(tx('Close')) + '">' + ic('x') + '</button></div><div class="dr-body">' + body + '</div>' + (foot ? '<div class="dr-foot">' + foot + '</div>' : '') + '</aside>', 'drawer');
  }
  function modal(title, body, submitLabel, onSubmit, opts) {
    opts = opts || {};
    openLayer('<form class="modal' + (opts.wide ? ' wide' : '') + '" id="mdForm" role="dialog" aria-modal="true" aria-labelledby="mdH" novalidate><div class="md-head"><h2 id="mdH">' + esc(title) + '</h2>' +
      '<button type="button" class="btn icon sm" data-act="close" aria-label="' + esc(tx('Close')) + '">' + ic('x') + '</button></div><div class="md-body">' + body + '<div class="err" id="mdErr" hidden></div></div>' +
      '<div class="md-foot"><button type="button" class="btn" data-act="close">' + esc(tx(submitLabel ? 'Cancel' : 'Close')) + '</button>' + (submitLabel ? '<button type="submit" class="btn ' + (opts.danger ? 'danger' : 'pri') + '">' + esc(submitLabel) + '</button>' : '') + '</div></form>', 'modal');
    modalSubmit = onSubmit;
    var first = $('layers').querySelector('.md-body [autofocus], .md-body input, .md-body select, .md-body textarea');
    if (first) first.focus(); else { var b = $('layers').querySelector('.md-foot .pri, .md-foot .danger'); if (b) b.focus(); }
  }
  function modalError(msg) { var e = $('mdErr'); if (e) { e.hidden = !msg; e.textContent = msg || ''; } }
  function confirmBox(title, text, label, fn, danger) { modal(title, '<p>' + esc(text) + '</p>', label, function () { closeLayer(); fn(); }, { danger: danger }); }
  document.addEventListener('keydown', function (e) {
    if (!$('layers').innerHTML) return;
    if (e.key === 'Escape') { e.preventDefault(); closeLayer(); return; }
    if (e.key !== 'Tab') return;
    var box = $('layers').querySelector('.drawer, .modal'); if (!box) return;
    var f = Array.prototype.filter.call(box.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'), function (x) { return x.offsetParent !== null; });
    if (!f.length) { e.preventDefault(); box.focus(); return; }
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === box)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  var toastT = null;
  function toast(msg) { var t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('on'); }, 3600); }
  function download(name, text, type) {
    var b = new Blob([text], { type: type || 'text/csv;charset=utf-8' }), a = document.createElement('a');
    a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }

  // ── chunked jobs with a progress bar ─────────────────────────────────────
  var busyN = 0;
  function showBusy(label, p) {
    var b = $('busy'); b.hidden = false;
    $('busyLabel').textContent = label;
    var v = Math.round((p || 0) * 100);
    $('busyPct').textContent = v + ' %'; $('busyBar').style.width = v + '%'; $('busyTrack').setAttribute('aria-valuenow', String(v));
  }
  function hideBusy() { if (!busyN) $('busy').hidden = true; }
  /** run an engine job in slices of about 25 ms so the page stays responsive */
  function runJob(job, label) {
    busyN++; showBusy(label, job.progress || 0);
    return new Promise(function (resolve, reject) {
      function tick() {
        var t0 = performance.now();
        try { while (!job.done && performance.now() - t0 < 25) job.step(12000); }
        catch (e) { busyN--; hideBusy(); reject(e); return; }
        showBusy(job.label ? lx(job.label) : label, job.progress);
        if (job.done) { busyN--; hideBusy(); resolve(job.result || job); } else nextTick(tick);
      }
      setTimeout(tick, 0);
    });
  }

  // ── reading files ────────────────────────────────────────────────────────
  var EXCEL = /\.(xlsx|xlsm|xls|xlsb|ods)$/i;
  function importFile(file) {
    if (!file) return;
    if (file.size > MAX_BYTES) return toast(tx('That file is larger than 150 MB. Split it or export fewer columns.'));
    if (EXCEL.test(file.name)) return importExcel(file);
    if (/\.(pdf|docx?|zip|png|jpe?g|gif)$/i.test(file.name)) return toast(tx('Use a CSV, TXT or Excel file.'));
    showBusy(tx('Opening {name}', { name: file.name }), 0.02);
    file.arrayBuffer().then(function (buf) { busyN++; return importBytes(new Uint8Array(buf), file.name, 'file'); })
      .then(function () { busyN = Math.max(0, busyN - 1); hideBusy(); }, function (err) { busyN = Math.max(0, busyN - 1); hideBusy(); readFailed(err); });
  }
  function readFailed(err) { if (window.console) console.error(err); toast(tx('Could not read the file: {msg}', { msg: lx(err && err.message || err) })); }
  /** bytes → text → table → a new check (or, with `into`, new contents for an existing check) */
  function importBytes(bytes, name, kind, opts) {
    opts = opts || {};
    var dec = E.decode(bytes, opts.encoding);
    return importText(dec.text, name, kind, { encoding: dec.encoding, fallback: dec.fallback, bom: dec.bom, delim: opts.delim, header: opts.header, into: opts.into, demo: opts.demo, quiet: opts.quiet }, bytes);
  }
  function importText(text, name, kind, read, bytes) {
    var delim = read.delim || E.sniffDelimiter(text), job = E.csvJob(text, delim);
    return runJob(job, tx('Reading {name}', { name: name })).then(function () {
      var hi = read.header != null ? read.header : E.detectHeader(job.rows).index;
      var table = E.buildTable(job.rows, job.lines, hi);
      var info = { encoding: read.encoding || '', fallback: !!read.fallback, delim: delim, header: table.header, hasHeader: table.hasHeader, skipped: table.skipped, short: table.short, long: table.long };
      return finishImport(table, name, kind, info, bytes, read);
    });
  }
  function finishImport(table, name, kind, info, bytes, read) {
    if (!table.rows.length) { toast(tx('No data rows found in {name}.', { name: name })); return null; }
    var cutRows = table.rows.length > MAX_ROWS;
    if (cutRows) { table.rows.length = MAX_ROWS; table.lines.length = MAX_ROWS; info.cut = true; }
    if (read && read.into) return reread(read.into, table, info, bytes);
    var meta = createCheck(name, kind, table, info, bytes, read && read.demo);
    if (cutRows) toast(tx('Only the first {n} rows are checked.', { n: n0(MAX_ROWS) }));
    if (!(read && read.quiet)) location.hash = '#/check/' + meta.id;
    return meta;
  }
  function newId() { return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function createCheck(name, kind, table, info, bytes, demo) {
    var setup = E.autoSetup(table, name, db.settings.home), id = newId();
    var meta = { id: id, name: name, kind: kind, demo: demo || null, createdAt: new Date().toISOString(), checkedAt: null, type: setup.type,
      rows: table.rows.length, cols: table.headers.length, read: info, summary: null, preparedFor: '' };
    tables[id] = { id: id, version: 1, headers: table.headers, rows: table.rows, lines: table.lines, roles: setup.roles, roleSrc: setup.src,
      unitTarget: null, dupThreshold: null, survivors: {}, notDup: {}, history: [], vies: null, fixedRules: [], recipe: null };
    if (bytes) raw[id] = bytes;
    db.checks.unshift(meta);
    save(!demo, id);
    return meta;
  }
  /** a changed way of reading the same bytes replaces the rows and resets fixes and decisions */
  function reread(id, table, info) {
    var meta = findCheck(id), old = tables[id]; if (!meta) return null;
    var setup = E.autoSetup(table, meta.name, db.settings.home);
    var same = old && old.headers.length === table.headers.length && old.headers.every(function (h, i) { return h === table.headers[i]; });
    tables[id] = { id: id, version: 1, headers: table.headers, rows: table.rows, lines: table.lines, roles: same ? old.roles : setup.roles, roleSrc: same ? old.roleSrc : setup.src,
      unitTarget: null, dupThreshold: old ? old.dupThreshold : null, survivors: {}, notDup: {}, history: [], vies: old ? old.vies || null : null, fixedRules: [], recipe: old ? old.recipe || null : null };
    if (!same) meta.type = setup.type;
    meta.read = info; meta.rows = table.rows.length; meta.cols = table.headers.length;
    save(true, id);
    if (cur && cur.id === id) { cur.data = tables[id]; cur.res = null; analyse({ byPerson: true }); }
    return meta;
  }

  // Excel through SheetJS, loaded the first time an Excel file is picked
  var xlsxP = null;
  function loadXlsx() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (!xlsxP) {
      xlsxP = new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = SHEETJS; s.async = true; s.crossOrigin = 'anonymous';
        s.onload = function () { if (window.XLSX) resolve(window.XLSX); else reject(new Error('The Excel reader did not start.')); };
        s.onerror = function () { s.remove(); reject(new Error('offline')); };
        document.head.appendChild(s);
      });
      xlsxP.catch(function () { xlsxP = null; });
    }
    return xlsxP;
  }
  function excelOffline() {
    modal(tx('Excel needs a connection the first time'), '<p>' + esc(tx('Excel files are read with SheetJS, which this page downloads from cdnjs when you open your first Excel file. It could not be loaded, so this browser is probably offline.')) + '</p>' +
      '<p>' + tx('CSV works offline: in Excel choose <b>File → Save As → CSV UTF-8 (comma delimited)</b> and drop that file here. Your data still stays in this browser.') + '</p>', '', null);
  }
  function importExcel(file) {
    showBusy(tx('Loading the Excel reader'), 0.05);
    Promise.all([loadXlsx(), file.arrayBuffer()]).then(function (r) {
      showBusy(tx('Reading the workbook'), 0.15);
      setTimeout(function () {
        var XLSX = r[0], wb;
        try { wb = XLSX.read(new Uint8Array(r[1]), { type: 'array', cellNF: true, cellText: false, cellDates: false }); }
        catch (e) { hideBusy(); return toast(tx('This Excel file could not be read. Save it again, or as CSV.')); }
        var sheets = wb.SheetNames.map(function (n) {
          var ws = wb.Sheets[n], ref = ws && ws['!ref'], rg = ref ? XLSX.utils.decode_range(ref) : null;
          return { name: n, rows: rg ? rg.e.r - rg.s.r + 1 : 0, cols: rg ? rg.e.c - rg.s.c + 1 : 0 };
        });
        var withData = sheets.filter(function (s) { return s.rows > 0; }).sort(function (a, b) { return b.rows * b.cols - a.rows * a.cols; });
        hideBusy();
        if (!withData.length) return toast(tx('The workbook has no data.'));
        if (withData.length === 1) return readSheet(XLSX, wb, withData[0].name, file.name);
        modal(tx('Which sheet?'), '<p>' + esc(tx('{name} has {n} sheets.', { name: file.name, n: sheets.length })) + '</p><fieldset class="grp"><legend>' + esc(tx('Sheet to check')) + '</legend><div class="sheets">' + sheets.map(function (s, i) {
          return '<label class="radio"><input type="radio" name="sheet" value="' + esc(s.name) + '"' + (s === withData[0] ? ' checked' : '') + (s.rows ? '' : ' disabled') + '><span><b>' + esc(s.name) + '</b><small>' + (s.rows ? plural(s.rows, 'row', 'rows') + ' · ' + plural(s.cols, 'column', 'columns') : esc(tx('empty'))) + '</small></span></label>';
        }).join('') + '</div></fieldset>', tx('Check this sheet'), function () {
          var pick = $('layers').querySelector('input[name=sheet]:checked'); if (!pick) return modalError(tx('Choose a sheet.'));
          var name = pick.value; closeLayer(); readSheet(XLSX, wb, name, file.name);
        });
      }, 30);
    }, function (err) { hideBusy(); if (err && err.message === 'offline') excelOffline(); else readFailed(err); });
  }
  function cellText(XLSX, c) {
    if (!c || c.v == null) return c && c.w ? String(c.w) : '';
    if (c.t === 's' || c.t === 'str') return String(c.v);
    if (c.t === 'b') return c.v ? 'TRUE' : 'FALSE';
    if (c.t === 'e') return c.w || '#ERROR';
    if (c.t === 'd') { var d = c.v instanceof Date ? c.v : new Date(c.v); return isNaN(d) ? String(c.v) : String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + d.getFullYear(); }
    if (c.t === 'n') {
      var z = c.z || '';
      if (z && XLSX.SSF && XLSX.SSF.is_date(z) && c.v > 0 && c.v < 2958466) return E.formatDate(E.excelSerialToIso(c.v), 'dd.mm.yyyy');
      var v = c.v;
      if (/%/.test(z)) v = v * 100;
      if (Number.isInteger(v) && Math.abs(v) < 1e15) return String(v);
      return String(Number(v.toPrecision(15))).replace('.', ',');
    }
    return c.w || String(c.v);
  }
  function readSheet(XLSX, wb, sheet, fileName) {
    var ws = wb.Sheets[sheet], rg = XLSX.utils.decode_range(ws['!ref']), rows = [], lines = [];
    showBusy(tx('Reading {name}', { name: sheet }), 0.3);
    setTimeout(function () {
      for (var r = rg.s.r; r <= rg.e.r && rows.length < MAX_ROWS + 50; r++) {
        var row = [], any = false;
        for (var c = rg.s.c; c <= rg.e.c; c++) { var v = cellText(XLSX, ws[XLSX.utils.encode_cell({ r: r, c: c })]); row.push(v); if (v && /\S/.test(v)) any = true; }
        if (any) { rows.push(row); lines.push(r + 1); }
      }
      hideBusy();
      var hi = E.detectHeader(rows).index, table = E.buildTable(rows, lines, hi);
      finishImport(table, fileName, 'excel', { encoding: '', delim: '', sheet: sheet, header: table.header, hasHeader: table.hasHeader, skipped: table.skipped, short: 0, long: 0 }, null, null);
    }, 30);
  }

  // ── analysis ─────────────────────────────────────────────────────────────
  function cfgFor(meta, data, opts) {
    var s = db.settings, req = s.req[meta.type] || E.DEFAULT_REQ[meta.type];
    return { type: meta.type, roles: data.roles, required: req.required, recommended: req.recommended, home: s.home, vatRates: s.vatRates[s.home], today: TODAY,
      unitTarget: data.unitTarget, dupThreshold: data.dupThreshold || s.dupThreshold, survivors: data.survivors, notDup: data.notDup,
      reuseDup: opts && opts.reuseDup ? opts.reuseDup : null, vies: viesMap(data) };
  }
  /** the VIES answers of a check as the engine reads them: { 'SI12345679': { valid: true|false|null, at } } */
  function viesMap(data) {
    var v = data && data.vies; if (!v) return null;
    var out = {}, any = false;
    Object.keys(v).forEach(function (k) { var x = v[k]; if (x && typeof x.valid === 'boolean') { out[k] = { valid: x.valid, at: x.at }; any = true; } });
    return any ? out : null;
  }
  function viesCounts(data, res) {
    var c = { total: 0, valid: 0, invalid: 0, unavailable: 0, open: 0 }, v = (data && data.vies) || {};
    if (!res || !data) return c;
    E.viesCandidates(res, data).forEach(function (x) {
      c.total++; var a = v[x.norm];
      if (!a) c.open++; else if (a.valid === true) c.valid++; else if (a.valid === false) c.invalid++; else { c.unavailable++; c.open++; }
    });
    return c;
  }
  /** the new summary of a check, its e-invoice readiness and, the first time, the score to compare later checks with */
  function setSummary(meta, res, data) {
    var s = summarize(res), ei = data ? E.einvoice(res, data) : null;
    if (ei) s.einv = { pct: ei.pct, ready: ei.ready, rows: ei.rows, avg: ei.avg, crit: ei.crit.map(function (c) { return [c.id, c.miss, c.n]; }) };
    if (data && data.vies) { var vc = viesCounts(data, res); if (vc.total) s.vies = vc; }
    meta.summary = s; meta.checkedAt = new Date().toISOString(); meta.rows = res.nRows; meta.cols = res.nCols;
    if (!meta.first) meta.first = { score: s.score, at: meta.checkedAt, einv: s.einv ? s.einv.pct : null };
    return ei;
  }
  function summarize(res) {
    var rules = Object.keys(res.rules).map(function (k) { var o = res.rules[k]; return [k, o.n, o.rows, o.fixable]; }).sort(byImpact);
    var fixable = 0, dupRows = 0;
    rules.forEach(function (x) { fixable += x[3]; });
    res.groups.forEach(function (g) { dupRows += g.rows.length - 1; });
    var missing = {};
    res.issues.forEach(function (x) { if (x.k === 'req.missing' || x.k === 'rec.missing') { var key = x.k + ':' + x.p; missing[key] = (missing[key] || 0) + 1; } });
    return { score: res.score, scoreAfter: res.scoreAfter, errors: res.counts.error, warnings: res.counts.warning, infos: res.counts.info, rowsErr: res.rowsErr, rowsWarn: res.rowsWarn,
      rowsClean: res.rowsClean, groups: res.groups.length, dupRows: dupRows, fixable: fixable, rules: rules, missing: missing, structure: res.structure.map(function (x) { return x.k + ':' + x.p; }), type: res.type };
  }
  function weightOf(k, rows) { return (E.SEV_W[E.RULES[k].sev] * 10 + 1) * rows; }
  function byImpact(a, b) { return weightOf(b[0], b[2] || b[1]) - weightOf(a[0], a[2] || a[1]) || E.RULES[a[0]].order - E.RULES[b[0]].order; }
  function analyseRecord(meta, data, opts) {
    var job = E.analysisJob(data, cfgFor(meta, data, opts));
    return runJob(job, tx('Checking {name}', { name: meta.name }));
  }
  /** (re)check the open file; byPerson: a change the person made, so the new summary is synced */
  function analyse(opts) {
    opts = opts || {};
    if (!cur || !cur.data) return Promise.resolve();
    var id = cur.id, token = {};
    cur.token = token; cur.busy = true;
    if (!cur.res) render();
    return analyseRecord(cur.meta, cur.data, opts).then(function (res) {
      if (!cur || cur.id !== id || cur.token !== token) return;
      cur.res = res; cur.busy = false;
      cur.einv = setSummary(cur.meta, res, cur.data);
      save(!!opts.byPerson);
      render();
    }, function (err) {
      if (cur && cur.id === id) { cur.busy = false; cur.failed = String(err && err.message || err); }
      if (window.console) console.error(err);
      toast(tx('Checking stopped: {msg}', { msg: lx(err && err.message || err) })); render();
    });
  }
  function regroup() {
    if (!cur || !cur.res) return;
    E.applyDupes(cur.res, cur.data, cfgFor(cur.meta, cur.data));
    cur.einv = setSummary(cur.meta, cur.res, cur.data);
    save(true, cur.id); render();
  }
  function loadCheck(id) {
    var meta = findCheck(id);
    cur = { id: id, meta: meta, data: tables[id] || null, res: null, loading: true };
    var p = cur.data ? Promise.resolve(cur.data) : idbOK && stored[id] ? enqueue(function () { return tGet(id); }) : Promise.resolve(null);
    p.then(function (rec) {
      if (!cur || cur.id !== id) return;
      if (rec && Array.isArray(rec.rows)) { tables[id] = rec; cur.data = rec; }
      cur.loading = false;
      if (!cur.data) { render(); return; }
      analyse();
    }, function () { if (cur && cur.id === id) { cur.loading = false; render(); } });
  }
  /** apply cell changes as one undoable step, then check again */
  function commitChanges(label, changes, quiet) {
    if (!cur || !cur.data) return;
    if (cur.busy) { toast(tx('Wait until the check has finished.')); return; }
    var d = cur.data, ch = [], touchesDup = false;
    changes.forEach(function (x) {
      var before = d.rows[x.r][x.c];
      if (before === x.v) return;
      ch.push([x.r, x.c, before, x.v]); d.rows[x.r][x.c] = x.v;
      if (DUP_ROLES[d.roles[x.c]]) touchesDup = true;
    });
    if (!ch.length) { toast(tx('Nothing to change.')); return; }
    d.history.push({ label: label, at: new Date().toISOString(), ch: ch });
    if (d.history.length > 25) d.history.shift();
    save(true, cur.id);
    analyse({ byPerson: true, reuseDup: touchesDup ? null : cur.res && cur.res.dup });
    if (!quiet) toast(tx('{label} · {cells} changed. Undo is at the top.', { label: histLabel(label), cells: plural(ch.length, 'cell', 'cells') }));
  }
  function undo() {
    var d = cur && cur.data; if (!d || !d.history.length) return;
    var h = d.history.pop();
    for (var i = h.ch.length - 1; i >= 0; i--) d.rows[h.ch[i][0]][h.ch[i][1]] = h.ch[i][2];
    save(true, cur.id);
    analyse({ byPerson: true });
    toast(tx('Undone: {label}', { label: histLabel(h.label) }));
  }
  /** an undo step's label: stored in English (saved checks keep working), shown in the screen language */
  function histLabel(l) { return lx(l); }
  function noteFixed(d, rules) {
    if (!Array.isArray(d.fixedRules)) d.fixedRules = [];
    rules.forEach(function (k) { if (d.fixedRules.indexOf(k) < 0) d.fixedRules.push(k); });
  }
  /** every one-click fix (or those of `rules`) as ONE undoable step: apply the fixes, check again, and repeat while a check finds
   * more (a cell with spaces and capitals needs two passes), at most 5 times. Every cell keeps its value from before the step. */
  function runFixes(label, rules) {
    if (!cur || !cur.data || !cur.res) return Promise.resolve(0);
    if (cur.busy) { toast(tx('Wait until the check has finished.')); return Promise.resolve(0); }
    var id = cur.id, d = cur.data, entry = { label: label, at: new Date().toISOString(), ch: [] }, seen = {}, pass = 0, before = cur.res.score, used = {};
    return new Promise(function (resolve) {
      function step() {
        if (!cur || cur.id !== id || !cur.res) return finish();
        var plan = pass < 5 ? E.planFixes(cur.res, d, rules) : [];
        if (!plan.length) return finish();
        plan.forEach(function (x) {
          var key = x.r + ':' + x.c;
          if (seen[key] == null) { seen[key] = entry.ch.length; entry.ch.push([x.r, x.c, d.rows[x.r][x.c], x.v]); } else entry.ch[seen[key]][3] = x.v;
          d.rows[x.r][x.c] = x.v;
          x.k.forEach(function (k) { used[k] = 1; });
        });
        if (!pass) { d.history.push(entry); if (d.history.length > 25) d.history.shift(); }
        pass++;
        save(true, id);
        analyse({ byPerson: true }).then(step);
      }
      function finish() {
        entry.ch = entry.ch.filter(function (ch) { return ch[2] !== ch[3]; });
        if (!entry.ch.length) { var at = d.history.indexOf(entry); if (at >= 0) d.history.splice(at, 1); render(); resolve(0); return; }
        noteFixed(d, Object.keys(used));
        save(true, id); render();
        var after = cur && cur.id === id && cur.res ? cur.res.score : before;
        toast(after !== before ? tx('{label} · {cells} changed, score {a} → {b}. Undo is at the top.', { label: histLabel(label), cells: plural(entry.ch.length, 'cell', 'cells'), a: before, b: after }) :
          tx('{label} · {cells} changed. Undo is at the top.', { label: histLabel(label), cells: plural(entry.ch.length, 'cell', 'cells') }));
        resolve(entry.ch.length);
      }
      step();
    });
  }
  /** "Fix N values": what changes, per kind of problem, then all of it in one step */
  function fixEverything() {
    if (!cur || !cur.res) return;
    if (cur.busy) return toast(tx('Wait until the check has finished.'));
    var res = cur.res, d = cur.data, plan = E.planFixes(res, d);
    if (!plan.length) return toast(tx('Nothing left to fix automatically.'));
    var rules = Object.keys(res.rules).map(function (k) { return res.rules[k]; }).filter(function (o) { return o.fixable; })
      .sort(function (a, b) { return b.fixable - a.fixable || E.RULES[a.k].order - E.RULES[b.k].order; });
    var sample = plan.slice(0, 12);
    modal(tx('Fix {n} values in one step', { n: n0(res.issues.filter(function (x) { return x.f !== undefined; }).length) }),
      '<p>' + (res.scoreAfter > res.score ? tx('Every one-click fix is applied at once, which lifts the score from {a} to about {b}. It is one step: <b>Undo</b> puts every cell back as it was.', { a: res.score, b: res.scoreAfter }) :
        tx('Every one-click fix is applied at once. It is one step: <b>Undo</b> puts every cell back as it was.')) + '</p>' +
      '<ul class="list fixlist">' + rules.map(function (o) {
        var R = E.RULES[o.k];
        return '<li><div class="l"><span class="sevdot ' + R.sev + '" aria-hidden="true"></span><b>' + esc(lx(R.title)) + '</b></div><div class="r">' + n0(o.fixable) + '</div></li>';
      }).join('') + '</ul>' +
      '<div class="tw prev"><table class="t compact"><thead><tr><th>' + esc(tx('Row')) + '</th><th>' + esc(tx('Column')) + '</th><th>' + esc(tx('Before')) + '</th><th>' + esc(tx('After')) + '</th></tr></thead><tbody>' + sample.map(function (x) {
        return '<tr><td class="mono">' + d.lines[x.r] + '</td><td class="nw">' + esc(d.headers[x.c]) + '</td><td class="val">' + showWs(d.rows[x.r][x.c], 60) + '</td><td class="val after">' + showWs(x.v, 60) + '</td></tr>';
      }).join('') + '</tbody></table></div>' + (plan.length > sample.length ? '<p class="hint">' + esc(tx('Examples: {a} of {b} cells.', { a: sample.length, b: n0(plan.length) })) + '</p>' : ''),
      tx('Apply all fixes'), function () { closeLayer(); runFixes('All one-click fixes'); }, { wide: true });
  }

  // ── demo files ───────────────────────────────────────────────────────────
  function addDemo(id, open) {
    var f = X.file(id, TODAY);
    return importBytes(f.bytes, f.name, 'demo', { demo: id, quiet: true }).then(function (meta) {
      if (!meta) return null;
      if (open) { location.hash = '#/check/' + meta.id; return meta; }
      return analyseRecord(meta, tables[meta.id]).then(function (res) { setSummary(meta, res, tables[meta.id]); save(false); render(); return meta; });
    });
  }
  function seedDemos() {
    var ids = X.DEMOS.map(function (d) { return d.id; }).reverse(), p = Promise.resolve();
    ids.forEach(function (id) { p = p.then(function () { return addDemo(id, false); }); });
    return p.then(function () { db.seeded = true; save(false); });
  }
  /** the ERP demo's customers from this browser (IndexedDB "stratum-erp", record "db", read only), or null when the ERP demo
   * was never opened here. It never creates that database: an open that would create it is aborted. */
  function readErpCustomers() {
    function open() {
      return new Promise(function (resolve) {
        var rq, created = false;
        try { rq = indexedDB.open('stratum-erp'); } catch (e) { resolve(null); return; }
        rq.onupgradeneeded = function () { created = true; try { rq.transaction.abort(); } catch (e) { /* already gone */ } };
        rq.onsuccess = function () {
          var d = rq.result;
          if (created || !d.objectStoreNames.contains('kv')) { d.close(); resolve(null); return; }
          try {
            var g = d.transaction('kv', 'readonly').objectStore('kv').get('db');
            g.onsuccess = function () { d.close(); var v = g.result; resolve(v && Array.isArray(v.customers) && v.customers.length ? v.customers : null); };
            g.onerror = function () { d.close(); resolve(null); };
          } catch (e) { d.close(); resolve(null); }
        };
        rq.onerror = function () { resolve(null); };
        rq.onblocked = function () { resolve(null); };
      });
    }
    if (!window.indexedDB) return Promise.resolve(null);
    if (indexedDB.databases) return indexedDB.databases().then(function (l) { return l.some(function (x) { return x.name === 'stratum-erp'; }) ? open() : null; }, open);
    return open();
  }
  function openErpDemo() {
    readErpCustomers().then(function (list) {
      var live = !!list, text = X.erpCsv(live ? list : X.erpSample());
      var old = db.checks.filter(function (c) { return c.demo === 'erp'; }).map(function (c) { return c.id; });
      if (old.length) { db.checks = db.checks.filter(function (c) { return old.indexOf(c.id) < 0; }); old.forEach(function (id) { delete tables[id]; delete stored[id]; dirty[id] = 1; }); if (cur && old.indexOf(cur.id) >= 0) cur = null; }
      return importText(text, live ? tx('ERP demo · customers') : tx('ERP demo · sample customers'), 'erp', { encoding: 'utf-8', demo: 'erp' }).then(function (meta) {
        if (meta) { meta.read.source = live ? 'erp' : 'sample'; save(false); render(); toast(live ? tx('Read {n} from the ERP demo in this browser.', { n: plural(meta.rows, 'customer', 'customers') }) : tx('The ERP demo has no data in this browser yet, so this is a sample in the same shape.')); }
      });
    }).catch(readFailed);
  }
  function openDemo(id) {
    var have = db.checks.filter(function (c) { return c.demo === id; })[0];
    if (have) { location.hash = '#/check/' + have.id; return; }
    addDemo(id, true);
  }

  // ── navigation ───────────────────────────────────────────────────────────
  function route() {
    var p = (location.hash || '').replace(/^#\/?/, '').split('/');
    if (p[0] === 'check' && p[1]) return { page: 'check', id: p[1], tab: TABS.some(function (t) { return t[0] === p[2]; }) ? p[2] : 'summary', sub: p[3] ? decodeURIComponent(p[3]) : '' };
    if (p[0] === 'report' && p[1]) return { page: 'report', id: p[1] };
    if (p[0] === 'settings') return { page: 'settings' };
    return { page: 'start' };
  }
  function scoreBadge(sum) {
    if (!sum) return '<span class="score-chip none">…</span>';
    return '<span class="score-chip ' + E.scoreBand(sum.score) + '">' + sum.score + '</span>';
  }
  function renderNav(r) {
    var recent = db.checks.slice(0, 8);
    $('nav').innerHTML = '<a href="#/"' + (r.page === 'start' ? ' aria-current="page"' : '') + '>' + ic('up') + '<span>' + esc(tx('New check')) + '</span></a>' +
      (recent.length ? '<h2>' + esc(tx('Recent checks')) + '</h2>' + recent.map(function (c) {
        var on = (r.page === 'check' || r.page === 'report') && r.id === c.id;
        return '<a href="#/check/' + esc(c.id) + '"' + (on ? ' aria-current="page"' : '') + ' title="' + esc(c.name) + '">' + ic('file') + '<span>' + esc(c.name) + '</span>' + scoreBadge(c.summary) + '</a>';
      }).join('') : '') +
      '<a href="#/settings"' + (r.page === 'settings' ? ' aria-current="page"' : '') + ' class="nav-set">' + ic('set') + '<span>' + esc(tx('Settings')) + '</span></a>';
  }
  function head(eyebrow, title, sub, actions) {
    return '<div class="head"><div class="head-t"><span class="eyebrow">' + eyebrow + '</span><h1 tabindex="-1">' + esc(title) + '</h1>' + (sub ? '<p class="sub">' + sub + '</p>' : '') + '</div>' +
      (actions ? '<div class="head-actions no-print">' + actions + '</div>' : '') + '</div>';
  }
  function typeName(t) { return lx((E.TYPE[t] || E.TYPE.customers).name); }
  function encName(e) { var x = E.ENCODINGS.filter(function (p) { return p[0] === e; })[0]; return x ? x[1].replace(/ \(.*\)$/, '') : e || ''; }
  function sevName(s) { return tx(SEV_NAME[s]); }
  function roleName(r) { return lx((E.ROLE[r] || E.ROLE.text).name); }
  function ruleT(k) { return lx(E.RULES[k].title); }

  // ── page: start ──────────────────────────────────────────────────────────
  function pageStart() {
    var h = head(esc(tx('Data health check')), tx('Check a customer or product list'), esc(tx('See in seconds what is broken: invalid VAT IDs and IBANs, duplicates, missing fields. Then download a cleaned file.')));
    h += '<section class="drop-card" id="dropCard"><div class="drop-in">' + ic('up') + '<h2>' + esc(tx('Drop a CSV or Excel file here')) + '</h2><p>' + esc(tx('or')) + '</p>' +
      '<button type="button" class="btn pri" data-act="pick">' + ic('file') + esc(tx('Choose a file')) + '</button>' +
      '<p class="hint">' + esc(tx('CSV, TXT or TSV (any of ; , tab |), XLSX or XLS · up to 50.000 rows')) + '</p></div>' +
      '<p class="privacy">' + ic('lock') + esc(tx('Files are read in this browser and never uploaded.')) + '</p></section>';
    h += '<div class="grid2 start-grid"><section class="card pad"><span class="label">' + esc(tx('No file at hand?')) + '</span><h2>' + esc(tx('Try a demo file')) + '</h2><div class="demos">' + X.DEMOS.map(function (d) {
      return '<button type="button" class="demo" data-act="demo" data-v="' + d.id + '"><b>' + esc(tx(d.title)) + '</b><small>' + esc(tx(d.sub)) + '</small><span class="mono">' + esc(d.name) + '</span></button>';
    }).join('') + '<button type="button" class="demo erp" data-act="erpdemo"><b>' + esc(tx('Try with demo data: ERP customers')) + '</b><small>' + esc(tx('The customer list of the ERP demo, read straight from this browser (a sample in the same shape if you have not opened the ERP demo)')) + '</small><span class="mono">' + esc(tx('ERP demo')) + '</span></button>' +
      '</div><p class="hint">' + esc(tx('Exports of Nordvik Distribucija, the fictional wholesaler from the other demos, with typical problems planted.')) + '</p></section>';
    h += '<section class="card pad"><span class="label">' + esc(tx('From Excel or another program')) + '</span><h2>' + esc(tx('Paste rows')) + '</h2><div class="field"><label for="pasteIn">' + esc(tx('Copy the rows including the header row, then paste them here')) + '</label>' +
      '<textarea class="in paste" id="pasteIn" rows="6" spellcheck="false" placeholder="Šifra&#9;Naziv&#9;Ulica&#9;Pošta&#9;Kraj"></textarea></div>' +
      '<div class="dr-actions"><button type="button" class="btn" data-act="paste">' + ic('paste') + esc(tx('Check pasted rows')) + '</button></div></section></div>';
    h += '<section class="card"><div class="card-h"><div><span class="label">' + esc(tx('Checks in this browser: {n}', { n: n0(db.checks.length) })) + '</span><h2>' + esc(tx('Recent checks')) + '</h2></div></div>';
    if (!db.checks.length) h += '<p class="empty">' + esc(tx('No checks yet. Drop a file above or try a demo file.')) + '</p>';
    else h += '<div class="tw"><table class="t recent"><thead><tr><th>' + esc(tx('File')) + '</th><th>' + esc(tx('Type')) + '</th><th class="num">' + esc(tx('Rows')) + '</th><th>' + esc(tx('Checked')) + '</th><th class="num">' + esc(tx('Score')) + '</th><th class="num"><span class="sr">' + esc(tx('Actions')) + '</span></th></tr></thead><tbody>' + db.checks.map(function (c) {
      var s = c.summary;
      return '<tr class="click" data-act="open" data-v="' + esc(c.id) + '"><td class="name"><a href="#/check/' + esc(c.id) + '">' + esc(c.name) + '</a>' + (c.demo ? ' <span class="tag">' + esc(tx('demo')) + '</span>' : '') + (hasData(c) ? '' : ' <span class="tag" title="' + esc(tx('Only the summary is kept')) + '">' + esc(tx('summary only')) + '</span>') + '</td>' +
        '<td>' + esc(typeName(c.type)) + '</td><td class="num">' + n0(c.rows) + '</td><td class="nw">' + (c.checkedAt ? esc(dtTime(c.checkedAt)) : '<span class="muted">' + esc(tx('checking…')) + '</span>') + '</td>' +
        '<td class="num">' + scoreBadge(s) + '</td><td class="num"><button type="button" class="btn icon sm ghost" data-act="del" data-v="' + esc(c.id) + '" aria-label="' + esc(tx('Delete {name}', { name: c.name })) + '">' + ic('trash') + '</button></td></tr>';
    }).join('') + '</tbody></table></div>';
    h += '</section>';
    return h;
  }

  // ── page: check ──────────────────────────────────────────────────────────
  function checkHead(meta, tab) {
    var s = meta.summary, d = tables[meta.id], last = d && d.history.length ? d.history[d.history.length - 1] : null;
    var read = meta.read || {};
    var how = [read.sheet ? esc(tx('sheet {name}', { name: read.sheet })) : '', read.encoding ? esc(encName(read.encoding)) : '', read.delim ? esc(tx(delimSep(read.delim))) : ''].filter(Boolean).join(', ');
    var sub = (meta.checkedAt ? esc(tx('Checked {date}', { date: dtTime(meta.checkedAt) })) : esc(tx('Not checked yet'))) + (how ? ' · ' + how : '');
    var acts = (last ? '<button type="button" class="btn" data-act="undo" title="' + esc(tx('Undo: {label}', { label: histLabel(last.label) })) + '">' + ic('undo') + '<span>' + esc(tx('Undo')) + '</span></button>' : '') +
      (d ? '<button type="button" class="btn" data-act="recipes">' + ic('copy') + '<span>' + esc(tx('Recipe')) + '</span></button>' : '') +
      '<a class="btn" href="#/report/' + esc(meta.id) + '">' + ic('report') + '<span>' + esc(tx('Report')) + '</span></a>';
    var h = head(esc(typeName(meta.type)) + ' · ' + plural(meta.rows, 'row', 'rows') + ' · ' + plural(meta.cols, 'column', 'columns'), meta.name, sub, acts);
    h += '<nav class="tabs no-print" aria-label="' + esc(tx('Check sections')) + '">' + TABS.map(function (t) {
      var cnt = '';
      if (s && t[0] === 'issues' && s.errors + s.warnings) cnt = '<span class="tcount">' + n0(s.errors + s.warnings) + '</span>';
      if (s && t[0] === 'duplicates' && s.groups) cnt = '<span class="tcount">' + n0(s.groups) + '</span>';
      return '<a href="#/check/' + esc(meta.id) + '/' + t[0] + '"' + (t[0] === tab ? ' aria-current="page"' : '') + '>' + esc(tx(t[1])) + cnt + '</a>';
    }).join('') + '</nav>';
    return h;
  }
  function pageCheck(r) {
    var meta = findCheck(r.id);
    if (!meta) return head(esc(tx('Data health check')), tx('Check not found'), esc(tx('It may have been deleted in another tab.'))) + '<p><a class="btn" href="#/">' + ic('back') + esc(tx('Back to the start')) + '</a></p>';
    if (!cur || cur.id !== r.id) loadCheck(r.id);
    if (view.lastId !== r.id) { view = { open: {}, rowsF: 'all', rowsQ: '', rowsPage: 0, dupPage: 0, lastId: r.id, fixOnly: false }; }
    var h = checkHead(meta, r.tab);
    if (cur.loading) return h + '<p class="loading" role="status"><i aria-hidden="true"></i>' + esc(tx('Opening the file…')) + '</p>';
    if (!cur.data) return h + summaryOnly(meta, r.tab);
    if (cur.failed && !cur.res) return h + '<div class="notice warn"><div>' + esc(tx('Checking stopped: {msg}. Try a different column role, or open the file again.', { msg: lx(cur.failed) })) + '</div></div>';
    if (!cur.res) return h + '<p class="loading" role="status"><i aria-hidden="true"></i>' + esc(tx('Checking {rows}…', { rows: plural(meta.rows, 'row', 'rows') })) + '</p>';
    var fn = { summary: tabSummary, columns: tabColumns, issues: tabIssues, rows: tabRows, duplicates: tabDuplicates, export: tabExport }[r.tab];
    return h + '<div class="tabbody' + (cur.busy ? ' stale' : '') + '">' + fn(meta, cur.data, cur.res, r) + '</div>';
  }
  function summaryOnly(meta, tab) {
    var s = meta.summary;
    var note = '<div class="notice">' + ic('lock') + '<div>' + esc(db.settings.keepFiles ? tx('The file itself is not stored in this browser, only its summary. Open the file again to see its rows, fix issues and export a cleaned copy.') :
      tx('The file itself is not stored in this browser ("Keep files in this browser" is off in Settings), only its summary. Open the file again to see its rows, fix issues and export a cleaned copy.')) + '</div></div>';
    if (!s) return note;
    if (tab !== 'summary' && tab !== 'issues') return note;
    var h = note + scoreCards(meta, s) + (s.einv ? '<div class="grid2 sum-extra">' + einvCard(meta, s, false) + '</div>' : '');
    h += '<section class="card"><div class="card-h"><div><span class="label">' + esc(tx('From the last check')) + '</span><h2>' + esc(tx('Problems found')) + '</h2></div></div><ul class="list toplist">' + s.rules.map(function (x) {
      var R = E.RULES[x[0]]; if (!R) return '';
      return '<li><div class="l"><span class="sevdot ' + R.sev + '" aria-hidden="true"></span><b>' + esc(ruleT(x[0])) + '</b><small>' + esc(sevName(R.sev) + ' · ' + valuesIn(x[1], x[2])) + '</small></div></li>';
    }).join('') + '</ul></section>';
    return h;
  }

  /** "12 values in 9 rows" ("12 values" when the counts are equal or there are no rows) */
  function valuesIn(n, rows) { return rows && rows !== n ? tx('{values} in {rows}', { values: plural(n, 'value', 'values'), rows: plural(rows, 'row', 'rows', 'in') }) : plural(n, 'value', 'values'); }
  function delimSep(d) { return { ';': 'semicolon-separated', ',': 'comma-separated', '\t': 'tab-separated', '|': 'pipe-separated' }[d] || d; }
  // summary tab
  function ring(score, band, label, of) {
    var R = 52, C = 2 * Math.PI * R, off = C * (1 - score / 100);
    return '<svg class="ring ' + band + '" viewBox="0 0 120 120" role="img" aria-label="' + esc(label || tx('Score {n} of 100', { n: score })) + '"><circle class="trk" cx="60" cy="60" r="' + R + '"/>' +
      '<circle class="val" cx="60" cy="60" r="' + R + '" stroke-dasharray="' + C.toFixed(2) + '" stroke-dashoffset="' + off.toFixed(2) + '" transform="rotate(-90 60 60)"/>' +
      '<text x="60" y="64" class="num" text-anchor="middle">' + score + '</text><text x="60" y="84" class="of" text-anchor="middle">' + esc(of || tx('of 100')) + '</text></svg>';
  }
  var BAND = { good: ['Good', 'Ready to migrate after a quick look.'], fair: ['Fair', 'Usable, but fix the errors before you migrate.'], poor: ['Poor', 'Needs work before it goes into a new system.'], critical: ['Critical', 'Not fit to migrate as it is.'] };
  function scoreCards(meta, s, live) {
    var band = E.scoreBand(s.score), rows = meta.rows;
    // Validation run card: score out of 100 with its band, a bar of rows with errors / warnings / clean, and the two next steps.
    var notesOnly = Math.max(0, rows - s.rowsErr - s.rowsWarn - s.rowsClean);
    var parts = [['e', s.rowsErr, tx('{rows} with errors', { rows: plural(s.rowsErr, 'row', 'rows') })], ['w', s.rowsWarn, tx('{n} with warnings', { n: n0(s.rowsWarn) })], ['n', notesOnly, tx('{n} with notes only', { n: n0(notesOnly) })], ['c', s.rowsClean, tx('{n} clean', { n: n0(s.rowsClean) })]].filter(function (x) { return x[1] > 0; });
    var h = '<div class="sum-top"><section class="card score-card"><div class="gx-run"><h2 class="label">' + esc(tx('Data health score') + ' · ' + plural(rows, 'row', 'rows') + ' · ' + plural(meta.cols, 'column', 'columns')) + '</h2>' + (meta.checkedAt ? '<span class="label">' + esc(dtTime(meta.checkedAt)) + '</span>' : '') + '</div>' +
      '<div class="gx-sc"><p class="gx-score"><b>' + s.score + '</b><small>/100</small><span class="gx-band ' + band + '">' + esc(tx(BAND[band][0])) + '</span></p>' +
      (s.scoreAfter > s.score ? '<p class="gx-after">' + esc(tx('After the one-click fixes')) + '<b>' + esc(tx('about {n}', { n: s.scoreAfter })) + '</b></p>' : '') + '</div>' +
      (meta.first && meta.first.score !== s.score ? '<p class="gx-first">' + esc(tx('First check {date}:', { date: dt(meta.first.at) })) + ' <b>' + meta.first.score + ' → ' + s.score + '</b>' + (s.score > meta.first.score ? ' <span class="up">+' + (s.score - meta.first.score) + '</span>' : '') + '</p>' : '') +
      '<p class="gx-say">' + esc(tx(BAND[band][1])) + '</p>' +
      '<div class="gx-bar" role="img" aria-label="' + esc(parts.map(function (x) { return x[2]; }).join(', ')) + '">' + parts.map(function (x) { return '<i class="' + x[0] + '" style="flex-grow:' + x[1] + '"></i>'; }).join('') + '</div>' +
      '<p class="gx-lgd" aria-hidden="true">' + parts.map(function (x) { return '<span><i class="' + x[0] + '"></i>' + esc(x[2]) + '</span>'; }).join('') + '</p>' +
      (live ? '<div class="gx-acts no-print">' + (s.fixable ? '<button type="button" class="btn pri" data-act="fixview" data-v="' + esc(meta.id) + '">' + ic('wand') + esc(tx('Fix {n} values', { n: n0(s.fixable) })) + '</button>' : '') +
        '<a class="btn" href="#/check/' + esc(meta.id) + '/export">' + ic('dl') + esc(tx('Cleaned file')) + '</a></div>' : '') +
      '<details class="how"><summary>' + esc(tx('How the score works')) + '</summary><p>' + esc(tx('Score = 100 × (1 − weighted problem rows ÷ (3 × all rows)). A row with at least one error counts 3, a row with only warnings counts 1, notes count 0. Column scores use the same formula on the column\'s cells. Missing columns are listed separately and do not change the score.')) + '</p></details></section>';
    h += '<div class="kpis sum-kpis">' +
      kpi(tx('Rows checked'), n0(rows), esc(plural(meta.cols, 'column', 'columns'))) +
      kpi(tx('Errors'), n0(s.errors), esc(tx('in {rows}', { rows: plural(s.rowsErr, 'row', 'rows', 'in') }) + ' · ' + pct(s.rowsErr, rows)), s.errors ? 'bad' : 'good', '#/check/' + meta.id + '/issues') +
      kpi(tx('Warnings'), n0(s.warnings), esc(s.rowsWarn ? tx('{rows} more affected', { rows: plural(s.rowsWarn, 'more row', 'more rows') }) : tx('no other rows')), s.warnings ? 'warn' : 'good', '#/check/' + meta.id + '/issues') +
      kpi(tx('Duplicates'), n0(s.dupRows), esc(s.groups ? tx('in {groups}', { groups: plural(s.groups, 'group', 'groups', 'in') }) : tx('none found')), s.groups ? 'warn' : 'good', '#/check/' + meta.id + '/duplicates') +
      kpi(tx('One-click fixes'), n0(s.fixable), esc(s.fixable ? tx('values the app can correct') : tx('nothing to fix automatically')), s.fixable ? 'acc' : '', '#/check/' + meta.id + '/issues') +
      kpi(tx('Clean rows'), pct(s.rowsClean, rows), esc(tx('{rows} without problems', { rows: plural(s.rowsClean, 'row', 'rows') }))) + '</div></div>';
    return h;
  }
  function kpi(label, value, detail, cls, href) {
    var tag = href ? 'a href="' + esc(href) + '"' : 'div';
    return '<' + tag + ' class="kpi"><span class="label">' + esc(label) + '</span><span class="v">' + value + '</span>' + (detail ? '<span class="d ' + (cls || '') + '"><i></i>' + detail + '</span>' : '') + '</' + (href ? 'a' : 'div') + '>';
  }
  /** a rule title inside a sentence: "E-mail address…" → "e-mail address…", but "VAT ID…" and "IBAN…" keep their capitals */
  function lc(t) { return /^[A-Z]{2}/.test(t) ? t : t.charAt(0).toLowerCase() + t.slice(1); }
  function ruleList(names) { if (names.length <= 1) return names.join(''); return names.slice(0, -1).join(', ') + ' ' + tx('and') + ' ' + names[names.length - 1]; }
  function meaning(meta, res) {
    var T = E.TYPE[res.type] || E.TYPE.customers, rows = res.nRows, s = summarize(res), p = [];
    var errRules = s.rules.filter(function (x) { return E.RULES[x[0]].sev === 'error' && x[2]; }).slice(0, 3);
    if (!res.rowsErr && !res.rowsWarn) p.push(tx('All {items} passed every check. Only notes remain, which do not affect the score.', { items: plural(rows, T.one, T.many) }));
    else {
      var v = { items: plural(rows, T.one, T.many), n: n0(rows), e: n0(res.rowsErr), pct: pct(res.rowsErr, rows), w: n0(res.rowsWarn), wpct: pct(res.rowsWarn, rows) };
      p.push(tx(res.rowsErr === 1 ? 'Of the {items} in this file, {e} ({pct}) has at least one error that would block or corrupt an import.' : 'Of the {items} in this file, {e} ({pct}) have at least one error that would block or corrupt an import.', v) +
        (res.rowsWarn ? ' ' + tx(res.rowsWarn === 1 ? 'Another {w} ({wpct}) has warnings only.' : 'Another {w} ({wpct}) have warnings only.', v) : '') +
        (errRules.length ? ' ' + tx('The errors are mostly {list}.', { list: ruleList(errRules.map(function (x) { return lc(ruleT(x[0])) + ' (' + n0(x[2]) + ')'; })) }) : ''));
    }
    if (s.groups) p.push(tx(s.dupRows === 1 ? '{items} looks like a duplicate of another ({groups}). Merge them before the migration, or their history and balances end up split.' : '{items} look like a duplicate of another ({groups}). Merge them before the migration, or their history and balances end up split.',
      { items: plural(s.dupRows, T.one, T.many), groups: plural(s.groups, 'group', 'groups') }));
    var fixRules = s.rules.filter(function (x) { return x[3]; }), manual = s.rules.filter(function (x) { return !x[3] && E.RULES[x[0]].sev !== 'info'; }).slice(0, 3);
    if (fixRules.length) p.push((s.scoreAfter > s.score ? tx('{a} of the {b} kinds of problem can be fixed here in one click ({values}), which lifts the score from {from} to about {to}.', { a: fixRules.length, b: s.rules.length, values: plural(s.fixable, 'value', 'values'), from: s.score, to: s.scoreAfter }) :
      tx('{a} of the {b} kinds of problem can be fixed here in one click ({values}).', { a: fixRules.length, b: s.rules.length, values: plural(s.fixable, 'value', 'values') })) +
      (manual.length ? ' ' + tx({ customers: 'The rest needs someone who knows the customers: {list}.', suppliers: 'The rest needs someone who knows the suppliers: {list}.', products: 'The rest needs someone who knows the products: {list}.' }[T.id] || 'The rest needs someone who knows the customers: {list}.', { list: ruleList(manual.map(function (x) { return lc(ruleT(x[0])); })) }) : ''));
    var miss = res.structure.filter(function (x) { return x.k === 'req.nocolumn'; });
    if (miss.length) {
      var one = miss.length === 1, cols = ruleList(miss.map(function (x) { return I.q(roleName(x.p)); }));
      p.unshift(tx(one ? 'The file has no {cols} column, which {many} need, so every row counts as an error. Add it to the export, mark an existing column with that role on the Columns tab, or make it optional in Settings.' :
        'The file has no {cols} columns, which {many} need, so every row counts as an error. Add them to the export, mark existing columns with those roles on the Columns tab, or make them optional in Settings.', { cols: cols, many: tx(T.many) }));
    }
    return p.map(function (x) { return '<p>' + esc(x) + '</p>'; }).join('');
  }
  function tabSummary(meta, d, res) {
    var s = meta.summary || summarize(res), h = recipeNotice(meta, d) + scoreCards(meta, s, true);
    h += '<section class="card pad meaning"><span class="label">' + esc(tx('In plain words')) + '</span><h2>' + esc(tx('What this means')) + '</h2>' + meaning(meta, res) + '</section>';
    h += '<div class="grid2 sum-extra">' + einvCard(meta, s, true) + viesCard(meta, d, res) + '</div>';
    var miss = res.structure;
    if (miss.length) h += '<div class="notice ' + (miss.some(function (x) { return x.k === 'req.nocolumn'; }) ? 'warn' : '') + '"><div><b>' + esc(tx('Columns not in this file:')) + '</b> ' + miss.map(function (x) {
      return esc(roleName(x.p) + ' (' + tx(x.k === 'req.nocolumn' ? 'required' : 'recommended') + ')'); }).join(', ') + '. <a href="#/check/' + esc(meta.id) + '/columns">' + esc(tx('Check the column roles')) + '</a></div></div>';
    h += '<div class="grid21">';
    var top = s.rules.filter(function (x) { return E.RULES[x[0]].sev !== 'info' || x[3]; }).slice(0, 8);
    h += '<section class="card"><div class="card-h"><div><span class="label">' + esc(tx('By impact')) + '</span><h2>' + esc(tx('Top issues')) + '</h2></div><a class="btn sm" href="#/check/' + esc(meta.id) + '/issues">' + esc(tx('All issues')) + '</a></div><ul class="list toplist">' +
      (top.length ? top.map(function (x) {
        var R = E.RULES[x[0]];
        return '<li><div class="l"><span class="sevdot ' + R.sev + '" aria-hidden="true"></span><a href="#/check/' + esc(meta.id) + '/issues/' + encodeURIComponent(x[0]) + '">' + esc(ruleT(x[0])) + '</a><small>' + esc(sevName(R.sev) + ' · ' +
          (x[2] ? plural(x[2], 'row', 'rows') + ' · ' + pct(x[2], res.nRows) : tx('file'))) + '</small></div><div class="r">' +
          (x[3] ? '<button type="button" class="btn sm" data-act="fixall" data-v="' + esc(x[0]) + '">' + esc(tx('Fix {n}', { n: n0(x[3]) })) + '</button>' : '<a class="btn sm ghost" href="#/check/' + esc(meta.id) + '/issues/' + encodeURIComponent(x[0]) + '">' + esc(tx('See')) + '</a>') + '</div></li>';
      }).join('') : '<li><div class="l">' + esc(tx('No problems found.')) + '</div></li>') + '</ul></section>';
    var cols = d.headers.map(function (hd, c) { return { c: c, h: hd, role: d.roles[c], score: res.colScores[c] }; }).filter(function (x) { return x.score != null; }).sort(function (a, b) { return a.score - b.score || a.c - b.c; });
    h += '<section class="card"><div class="card-h"><div><span class="label">' + esc(tx('Lowest first')) + '</span><h2>' + esc(tx('Column scores')) + '</h2></div><a class="btn sm" href="#/check/' + esc(meta.id) + '/columns">' + esc(tx('Columns')) + '</a></div><div class="card-b"><ul class="list colscores">' +
      cols.map(function (x) {
        var b = E.scoreBand(x.score);
        return '<li><div class="l"><a href="#/check/' + esc(meta.id) + '/columns" data-act="gocol" data-v="' + x.c + '">' + esc(x.h) + '</a><small>' + esc(roleName(x.role)) + '</small><div class="bar ' + b + '"><i style="width:' + x.score + '%"></i></div></div><div class="r"><b>' + x.score + '</b></div></li>';
      }).join('') + '</ul></div></section></div>';
    h += readCard(meta);
    return h;
  }
  // e-invoice readiness (engine.einvoice): share of records with everything an e-invoice needs, per criterion
  var EINV_NAME = {}; E.EINV.forEach(function (x) { EINV_NAME[x[0]] = { name: x[1], why: x[2] }; });
  function einvCard(meta, s, live) {
    var e = s && s.einv; if (!e) return '';
    var T = E.TYPE[s.type] || E.TYPE.customers, band = e.pct >= 90 ? 'good' : e.pct >= 70 ? 'fair' : e.pct >= 40 ? 'poor' : 'critical';
    var first = meta.first && meta.first.einv != null && meta.first.einv !== e.pct ? ' ' + tx('Since the first check: {a} % → {b} %.', { a: meta.first.einv, b: e.pct }) : '';
    return '<section class="card pad einv"><div class="split"><div><span class="label">' + esc(tx('Croatia since 1 Jan 2026 · Slovenia from 1 Jan 2028')) + '</span><h2>' + esc(tx('E-invoice readiness')) + '</h2></div>' +
      (live && e.ready < e.rows ? '<button type="button" class="btn sm" data-act="einvrows">' + esc(tx('Show {records} not ready', { records: plural(e.rows - e.ready, 'record', 'records') })) + '</button>' : '') + '</div>' +
      '<div class="einv-top"><p class="gx-score"><b>' + e.pct + '</b><small>' + esc(tx('% ready')) + '</small><span class="gx-band ' + band + '">' + esc(tx('{a} of {b}', { a: n0(e.ready), b: n0(e.rows) })) + '</span></p>' +
      '<p class="sub">' + esc(tx('{a} of {b} {many} have everything an e-invoice to them needs. The average record meets {avg} % of what applies to it.', { a: n0(e.ready), b: n0(e.rows), many: I.noun(5, T.one, T.many), avg: e.avg }) + first) + '</p></div>' +
      '<ul class="list einv-crit">' + e.crit.map(function (c) {
        var nm = EINV_NAME[c[0]] || { name: c[0] }, okN = c[2] - c[1], w = c[2] ? Math.round(100 * okN / c[2]) : 100;
        return '<li><div class="l"><b>' + esc(lx(nm.name)) + '</b><small>' + esc((c[1] ? tx('{n} missing or wrong', { n: n0(c[1]) }) : tx('all fine')) + ' · ' + tx('counts for {n}', { n: n0(c[2]) })) + '</small><div class="bar ' + (w >= 90 ? 'good' : w >= 70 ? 'fair' : w >= 40 ? 'poor' : 'critical') + '"><i style="width:' + w + '%"></i></div></div><div class="r"><b>' + w + ' %</b></div></li>';
      }).join('') + '</ul>' +
      '<details class="how"><summary>' + esc(tx('What counts and why')) + '</summary><p>' + esc(tx('A record is ready when every field that applies to it is filled in and passes the checks. The fields follow the buyer part of the European e-invoice standard EN 16931, which Croatian B2B e-invoices use since 1 January 2026 (Fiscalisation Act, NN 89/2025) and Slovene B2B e-invoices will use from 1 January 2028. Fixes that are still open count as missing, so the share rises after the one-click fixes.')) + '</p>' +
      '<ul class="whys">' + E.EINV.map(function (x) { return '<li><b>' + esc(lx(x[1])) + '</b>: ' + esc(lx(x[2])) + '</li>'; }).join('') + '</ul></details></section>';
  }
  // online VAT check (VIES): opt-in, the app works the same without it
  var viesRun = null;
  function viesCard(meta, d, res) {
    if (!d || !res || res.cols.vat < 0 || res.type === 'products') return '';
    var c = viesCounts(d, res); if (!c.total) return '';
    var running = viesRun && viesRun.id === meta.id;
    var done = c.valid + c.invalid, v = { done: n0(done), total: n0(c.total), valid: n0(c.valid), invalid: n0(c.invalid), un: n0(c.unavailable) };
    return '<section class="card pad vies"><div class="split"><div><span class="label">' + esc(tx('Optional · online')) + '</span><h2>' + esc(tx('VAT IDs in VIES')) + '</h2></div></div>' +
      '<p class="sub">' + (done || c.unavailable ? esc(c.unavailable ? tx('{done} of {total} VAT IDs checked: {valid} valid, {invalid} not valid, {un} could not be checked (the country\'s register did not answer).', v) : tx('{done} of {total} VAT IDs checked: {valid} valid, {invalid} not valid.', v)) :
        esc(tx('{total} VAT IDs pass the check digits here. VIES, the European Commission\'s service, can tell whether each one is registered for trade between EU countries.', v))) + '</p>' +
      (running ? '<div class="vies-run" role="status"><span id="viesProg">' + esc(tx('Checking {a} of {b}…', { a: n0(viesRun.done), b: n0(viesRun.total) })) + '</span><button type="button" class="btn sm" data-act="viesstop">' + esc(tx('Stop')) + '</button></div>' :
        c.open ? '<div class="dr-actions"><button type="button" class="btn" data-act="vies">' + ic('check') + esc(tx('Check {ids} online', { ids: plural(c.open, 'VAT ID', 'VAT IDs') })) + '</button></div>' : '') +
      '<p class="hint">' + ic('lock') + ' ' + esc(tx('Off until you click. Only the VAT IDs are sent, through our server, to VIES; no names, addresses or other columns, and nothing is stored or logged on the way. The answers stay in this browser with the check.')) + '</p></section>';
  }
  function viesConsent() {
    if (!cur || !cur.res) return;
    var list = viesTodo(); if (!list.length) return toast(tx('Every VAT ID has an answer from VIES.'));
    var cc = {}; list.forEach(function (x) { cc[x.cc] = (cc[x.cc] || 0) + 1; });
    modal(tx('Check {ids} online?', { ids: plural(list.length, 'VAT ID', 'VAT IDs') }), '<p>' + tx('This sends <b>only the VAT IDs</b> ({list}) to <b>VIES</b>, the European Commission\'s VAT number service, which asks each country\'s tax register. They go through our server, which keeps and logs nothing. No names, addresses, e-mails or any other column leave this browser.', { list: esc(Object.keys(cc).sort().map(function (k) { return k + ' ' + n0(cc[k]); }).join(', ')) }) + '</p>' +
      '<p>' + esc(tx('VIES confirms registration for trade between EU countries. A Slovene company that is not VAT-registered still has a valid tax number but is "not valid" in VIES, so its VAT ID should not carry the SI prefix.')) + '</p>' +
      '<p class="hint">' + esc(tx('Without this check the app works the same; it only adds what VIES says. Large files take a while: about two VAT IDs a second.')) + '</p>', tx('Check online'), function () { closeLayer(); viesStart(list); });
  }
  function viesTodo() { var v = (cur.data && cur.data.vies) || {}; return E.viesCandidates(cur.res, cur.data).filter(function (x) { return !v[x.norm] || typeof v[x.norm].valid !== 'boolean'; }); }
  function viesFetch(x) {
    var ctl = window.AbortController ? new AbortController() : null, tm = ctl ? setTimeout(function () { ctl.abort(); }, 12000) : null;
    return fetch('/api/vies/' + encodeURIComponent(x.cc) + '/' + encodeURIComponent(x.num), { credentials: 'same-origin', headers: { Accept: 'application/json' }, signal: ctl ? ctl.signal : undefined })
      .then(function (r) {
        clearTimeout(tm);
        var type = r.headers.get('Content-Type') || '';
        if (type.indexOf('json') < 0) return { fatal: 'off' };
        return r.json().then(function (j) { j.httpStatus = r.status; return j; }, function () { return { fatal: 'off' }; });
      }, function () { clearTimeout(tm); return { status: 'unavailable', reason: 'NETWORK' }; });
  }
  function viesStart(list) {
    var id = cur.id, d = cur.data, run = viesRun = { id: id, total: list.length, done: 0, stop: false, valid: 0, invalid: 0, failed: 0 }, i = 0, fatal = null;
    if (!d.vies) d.vies = {};
    render();
    function prog() { var el = $('viesProg'); if (el) el.textContent = tx('Checking {a} of {b}…', { a: n0(run.done), b: n0(run.total) }); }
    function worker() {
      if (run.stop || fatal || i >= list.length) return Promise.resolve();
      var x = list[i++];
      return viesFetch(x).then(function (j) {
        if (j.fatal || j.httpStatus === 401 || j.httpStatus === 403) { fatal = j.httpStatus === 401 ? 'signin' : j.httpStatus === 403 ? 'denied' : 'off'; return; }
        if (j.status === 'unavailable' && /CONCURRENT/.test(j.reason || '') && !x.retried) { x.retried = true; list.push(x); return new Promise(function (r) { setTimeout(r, 1500); }); }
        var at = new Date().toISOString();
        if (typeof j.valid === 'boolean') { d.vies[x.norm] = { valid: j.valid, name: String(j.name || '').slice(0, 200), address: String(j.address || '').slice(0, 300), at: at }; if (j.valid) run.valid++; else run.invalid++; }
        else { d.vies[x.norm] = { valid: null, reason: String(j.reason || j.status || 'unavailable').slice(0, 40), at: at }; run.failed++; }
        run.done++; prog();
      }).then(worker);
    }
    Promise.all([worker(), worker()]).then(function () {
      viesRun = null;
      save(true, id);
      var vv = { valid: n0(run.valid), invalid: n0(run.invalid), failed: n0(run.failed) };
      var msg = fatal === 'off' ? tx('The online VAT check is not available here: it needs the Business Apps server. Everything else works without it.') :
        fatal === 'signin' ? tx('Your sign-in has expired. Reload the page, then check again.') : fatal === 'denied' ? tx('This account may not use the online VAT check.') :
        (run.stop ? tx('Stopped.') + ' ' : '') + (run.failed ? tx('VIES: {valid} valid, {invalid} not valid, {failed} without an answer (try again later).', vv) : tx('VIES: {valid} valid, {invalid} not valid.', vv));
      if (cur && cur.id === id) analyse({ byPerson: true, reuseDup: cur.res && cur.res.dup }).then(function () { toast(msg); });
      else toast(msg);
      if (fatal && !run.done) render();
    });
  }

  // recipes: the column roles, type and fixes of a check, saved by name and applied to next month's file
  function recipeMatches(d) {
    return (db.recipes || []).map(function (rc) { return { rc: rc, m: E.matchRecipe(rc, d.headers) }; }).filter(function (x) { return x.m.found; })
      .sort(function (a, b) { return b.m.share - a.m.share || (b.rc.createdAt < a.rc.createdAt ? -1 : 1); });
  }
  function recipeNotice(meta, d) {
    if (!d || d.recipe || view.recipeHidden) return '';
    var best = recipeMatches(d).filter(function (x) { return x.m.share >= 0.8; })[0];
    if (!best) return '';
    var rv = { name: '<b>' + esc(best.rc.name) + '</b>', a: best.m.found, b: d.headers.length, fixes: esc(plural(best.rc.rules.length, 'kind of fix', 'kinds of fix')) };
    return '<div class="notice rcp no-print">' + ic('copy') + '<div>' + (best.rc.rules.length ? tx('This file looks like recipe {name} ({a} of {b} columns). Apply its column roles and {fixes}?', rv) : tx('This file looks like recipe {name} ({a} of {b} columns). Apply its column roles?', rv)) +
      '<div class="dr-actions"><button type="button" class="btn sm pri" data-act="rcpapply" data-v="' + esc(best.rc.id) + '">' + esc(tx('Apply the recipe')) + '</button><button type="button" class="btn sm ghost" data-act="rcphide">' + esc(tx('Not now')) + '</button></div></div></div>';
  }
  function recipeDialog() {
    if (!cur || !cur.data || !cur.res) return;
    var d = cur.data, res = cur.res, fixable = Object.keys(res.rules).filter(function (k) { return res.rules[k].fixable; });
    var done = (d.fixedRules || []).filter(function (k) { return E.RULES[k] && E.RULES[k].fix; });
    var all = E.RULE_LIST.filter(function (k) { return E.RULES[k].fix && (fixable.indexOf(k) >= 0 || done.indexOf(k) >= 0); });
    var mine = recipeMatches(d);
    var body = '';
    if ((db.recipes || []).length) {
      body += '<h3>' + esc(tx('Apply a saved recipe')) + '</h3><ul class="list rcp-list">' + mine.concat((db.recipes || []).filter(function (rc) { return !mine.some(function (x) { return x.rc === rc; }); }).map(function (rc) { return { rc: rc, m: { found: 0 } }; })).map(function (x) {
        return '<li><div class="l"><b>' + esc(x.rc.name) + '</b><small>' + esc(typeName(x.rc.type) + ' · ' + (x.m.found ? tx('{a} of {b} columns match', { a: x.m.found, b: d.headers.length }) : tx('no matching columns')) + ' · ' + plural(x.rc.rules.length, 'kind of fix', 'kinds of fix')) + '</small></div><div class="r">' +
          '<button type="button" class="btn sm' + (x.m.found ? ' pri' : '') + '" data-act="rcpapply" data-v="' + esc(x.rc.id) + '"' + (x.m.found ? '' : ' disabled') + '>' + esc(tx('Apply')) + '</button></div></li>';
      }).join('') + '</ul>';
    }
    var saves = [tx('the type ({type})', { type: typeName(cur.meta.type).toLowerCase() }), tx('the role of each of the {n} columns', { n: d.headers.length })];
    if (d.unitTarget) saves.push(tx('the unit spelling'));
    if (d.dupThreshold) saves.push(tx('the duplicate threshold'));
    saves.push(tx('the fixes you tick'));
    body += '<h3>' + esc(tx('Save this check as a recipe')) + '</h3><p class="hint">' + esc(tx('Saves {list}. Next month, open the new export and apply it: one click instead of the same work again. Recipes hold column names and settings, never rows.', { list: ruleList(saves) })) + '</p>' +
      '<div class="field"><label for="rcpName">' + esc(tx('Name')) + '</label><input class="in" id="rcpName" maxlength="80" value="' + esc(d.recipe ? d.recipe.name : baseName(cur.meta.name).replace(/[_-]+/g, ' ')) + '" autofocus></div>' +
      (all.length ? '<fieldset class="grp"><legend>' + esc(tx('Fixes to apply')) + '</legend>' + all.map(function (k) {
        return '<label class="check"><input type="checkbox" name="rcpRule" value="' + esc(k) + '" checked> ' + esc(ruleT(k)) + '</label>';
      }).join('') + '</fieldset>' : '<p class="hint">' + esc(tx('No one-click fixes in this file: the recipe keeps the column roles.')) + '</p>');
    modal(tx('Recipe'), body, tx('Save recipe'), function () {
      var name = $('rcpName').value.trim(); if (!name) return modalError(tx('Give the recipe a name.'));
      var rules = Array.prototype.map.call($('layers').querySelectorAll('input[name=rcpRule]:checked'), function (x) { return x.value; });
      var rc = E.makeRecipe(name, cur.meta.type, d, rules);
      var same = (db.recipes || []).filter(function (x) { return x.name.toLowerCase() === rc.name.toLowerCase(); })[0];
      rc.id = same ? same.id : 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      db.recipes = (db.recipes || []).filter(function (x) { return x.id !== rc.id; }); db.recipes.unshift(rc);
      d.recipe = { id: rc.id, name: rc.name, at: new Date().toISOString() }; cur.meta.recipe = rc.name;
      closeLayer(); save(true, cur.id); render(); toast(tx(same ? 'Recipe updated: {name}' : 'Recipe saved: {name}', { name: rc.name }));
    }, { wide: true });
  }
  function applyRecipe(id) {
    var rc = (db.recipes || []).filter(function (x) { return x.id === id; })[0]; if (!rc || !cur || !cur.data) return;
    if (cur.busy) return toast(tx('Wait until the check has finished.'));
    var d = cur.data, m = E.matchRecipe(rc, d.headers);
    closeLayer();
    m.roles.forEach(function (role, c) { if (role) { d.roles[c] = role; d.roleSrc[c] = 'recipe'; } });
    if (E.TYPE[rc.type]) cur.meta.type = rc.type;
    if (rc.unitTarget) d.unitTarget = rc.unitTarget;
    if (rc.dupThreshold) d.dupThreshold = rc.dupThreshold;
    d.recipe = { id: rc.id, name: rc.name, at: new Date().toISOString() }; cur.meta.recipe = rc.name;
    save(true, cur.id);
    analyse({ byPerson: true }).then(function () {
      if (!rc.rules.length) { toast(tx('Recipe applied: {name} ({n} columns)', { name: rc.name, n: m.found })); return; }
      runFixes('Recipe "' + rc.name + '"', rc.rules).then(function (n) { if (!n) toast(tx('Recipe applied: {name}. Nothing to fix.', { name: rc.name })); });
    });
  }

  function readCard(meta) {
    var r = meta.read || {}, rows = [];
    if (r.source) rows.push([tx('Source'), esc(tx(r.source === 'erp' ? 'the ERP demo in this browser (read only)' : 'a sample in the shape of the ERP demo'))]);
    if (r.sheet) rows.push([tx('Sheet'), esc(r.sheet)]);
    if (r.encoding) rows.push([tx('Text encoding'), esc(encName(r.encoding)) + (r.fallback ? ' <span class="muted">· ' + esc(tx('the file is not valid UTF-8, so it was read as Windows-1250 (usual for older Slovene and Croatian systems)')) + '</span>' : '')]);
    if (r.delim) rows.push([tx('Delimiter'), esc(tx(E.delimName(r.delim)))]);
    rows.push([tx('Header row'), esc(r.hasHeader === false ? tx('none found · columns are named Column 1, 2…') : tx('line {n}', { n: n0(r.header || 1) }) + (r.skipped ? ' · ' + tx('title lines above it skipped: {n}', { n: n0(r.skipped) }) : ''))]);
    if (r.short || r.long) rows.push([tx('Uneven rows'), esc([r.short ? tx('rows with fewer cells than the header: {n}', { n: n0(r.short) }) : '', r.long ? tx('with more: {n}', { n: n0(r.long) }) : ''].filter(Boolean).join(', '))]);
    if (r.cut) rows.push([tx('Rows checked'), esc(tx('the first {n}', { n: n0(MAX_ROWS) }))]);
    var canChange = !!(raw[meta.id] || (meta.demo && meta.demo !== 'erp')) && meta.kind !== 'excel';
    return '<section class="card pad readcard"><div class="split"><div><span class="label">' + esc(tx('How the file was read')) + '</span><h2>' + esc(tx('File')) + '</h2></div>' +
      (meta.kind === 'excel' || meta.kind === 'paste' || meta.kind === 'erp' ? '' : canChange ? '<button type="button" class="btn sm" data-act="reread">' + esc(tx('Change how it is read')) + '</button>' : '<span class="hint">' + esc(tx('Open the file again to change how it is read.')) + '</span>') + '</div>' +
      '<dl class="kv">' + rows.map(function (x) { return '<div><dt>' + esc(x[0]) + '</dt><dd>' + x[1] + '</dd></div>'; }).join('') + '</dl></section>';
  }

  // columns tab
  function typeSeg(meta) {
    return '<div class="seg" role="group" aria-label="' + esc(tx('What the file contains')) + '">' + E.TYPES.map(function (t) {
      return '<button type="button" data-act="type" data-v="' + t.id + '" aria-pressed="' + (meta.type === t.id) + '">' + esc(lx(t.name)) + '</button>';
    }).join('') + '</div>';
  }
  function fmtNum(n) { return Math.abs(n) >= 1000 || Math.round(n) === n ? n0(n) : nf2.format(n); }
  function tabColumns(meta, d, res) {
    var req = db.settings.req[meta.type] || E.DEFAULT_REQ[meta.type];
    var h = '<div class="toolbar"><span class="label">' + esc(tx('The file contains')) + '</span>' + typeSeg(meta) + '<span class="hint grow">' + esc(tx('Required: {list}. Change the list in Settings.', { list: req.required.map(roleName).join(', ') })) + '</span></div>';
    var errs = {}; res.issues.forEach(function (x) { var o = errs[x.c] || (errs[x.c] = { error: 0, warning: 0, info: 0 }); o[E.RULES[x.k].sev]++; });
    h += '<div class="colgrid">' + d.headers.map(function (hd, c) {
      var p = res.profiles[c] || {}, role = d.roles[c], sc = res.colScores[c], e = errs[c] || { error: 0, warning: 0, info: 0 };
      var src = tx(d.roleSrc[c] === 'you' ? 'set by you' : d.roleSrc[c] === 'header' ? 'from the header' : d.roleSrc[c] === 'content' ? 'from the values' : d.roleSrc[c] === 'recipe' ? 'from the recipe' : 'no match, so plain text');
      var stats = '<div class="cc-stats"><span>' + tx('<b>{x}</b> filled', { x: pct(p.filled, res.nRows) }) + '</span><span>' + tx('<b>{x}</b> distinct', { x: p.capped ? '10.000+' : n0(p.distinct) }) + '</span>' +
        '<span>' + tx('<b class="{cls}">{e}</b> errors · <b>{w}</b> warnings', { cls: e.error ? 'neg' : '', e: n0(e.error), w: n0(e.warning) }) + '</span></div>';
      var extra = '';
      if (p.num) extra += '<div class="cc-num"><span>' + esc(tx('Min')) + ' <b>' + fmtNum(p.num.min) + '</b></span><span>' + esc(tx('Max')) + ' <b>' + fmtNum(p.num.max) + '</b></span><span>' + esc(tx('Average')) + ' <b>' + fmtNum(p.num.avg) + '</b></span></div>';
      if (p.date) extra += '<div class="cc-num"><span>' + esc(tx('From')) + ' <b>' + dt(p.date.min) + '</b></span><span>' + esc(tx('To')) + ' <b>' + dt(p.date.max) + '</b></span></div>';
      if (role === 'unit' && p.unit && p.unit.pc) extra += unitPicker(d, p.unit.pc, 'u' + c);
      return '<article class="colcard" id="col-' + c + '"><div class="cc-h"><div><span class="label">' + esc(tx('Column {n}', { n: c + 1 })) + '</span><h3>' + esc(hd) + '</h3></div>' +
        (sc == null ? '<span class="score-chip none" title="' + esc(tx('Not checked')) + '">–</span>' : '<span class="score-chip ' + E.scoreBand(sc) + '" title="' + esc(tx('Column score')) + '">' + sc + '</span>') + '</div>' +
        '<div class="field"><label for="role-' + c + '">' + esc(tx('Role')) + ' <small class="muted">· ' + esc(src) + '</small></label><select class="in" id="role-' + c + '" data-chg="role" data-c="' + c + '">' +
        E.ROLES.map(function (R) { return '<option value="' + R.id + '"' + (R.id === role ? ' selected' : '') + '>' + esc(lx(R.name)) + '</option>'; }).join('') + '</select></div>' + stats + extra +
        '<div class="cc-lists"><div><span class="label">' + esc(tx('Most common values')) + '</span><ol class="vals">' + ((p.top || []).map(function (x) { return '<li><span>' + showWs(x[0], 40) + '</span><b>' + n0(x[1]) + '</b></li>'; }).join('') || '<li class="muted">' + esc(tx('all empty')) + '</li>') + '</ol></div>' +
        '<div><span class="label">' + esc(tx('Patterns')) + ' <small>' + esc(tx('A letter · 9 digit')) + '</small></span><ol class="vals mono">' + ((p.patterns || []).map(function (x) { return '<li><span>' + esc(x[0]) + '</span><b>' + n0(x[1]) + '</b></li>'; }).join('') || '<li class="muted">—</li>') + '</ol></div></div></article>';
    }).join('') + '</div>';
    return h;
  }
  function unitPicker(d, pc, id) {
    var opts = pc.spellings.slice();
    ['kos', 'kom', 'pcs'].forEach(function (u) { if (opts.indexOf(u) < 0) opts.push(u); });
    return '<div class="field unitpick"><label for="' + id + '">' + esc(tx('One spelling for pieces')) + '</label><select class="in" id="' + id + '" data-chg="unit">' + opts.map(function (u) {
      return '<option value="' + esc(u) + '"' + (u === pc.target ? ' selected' : '') + '>' + esc(u) + (pc.counts[u] ? ' (' + n0(pc.counts[u]) + ')' : '') + '</option>';
    }).join('') + '</select></div>';
  }

  // issues tab
  function recordName(d, res, r) {
    var c = res.cols.name, idc = res.cols.id >= 0 ? res.cols.id : res.cols.sku;
    var nm = c >= 0 ? E.core(E.fixMojibake(d.rows[r][c]) || d.rows[r][c]) : '', id = idc >= 0 ? E.core(d.rows[r][idc]) : '';
    return (id ? id + (nm ? ' · ' : '') : '') + (nm || (id ? '' : tx('Row {n}', { n: d.lines[r] })));
  }
  function tabIssues(meta, d, res, r) {
    var rules = Object.keys(res.rules).map(function (k) { return res.rules[k]; });
    var counts = { error: res.counts.error, warning: res.counts.warning, info: res.counts.info };
    counts.all = counts.error + counts.warning + counts.info;
    if (r.sub && res.rules[r.sub] && view.subDone !== r.sub) { view.open[r.sub] = true; view.subDone = r.sub; if (E.RULES[r.sub].sev !== ui.sev && ui.sev !== 'all') ui.sev = 'all'; }
    var last = d.history.length ? d.history[d.history.length - 1] : null;
    var h = '<div class="toolbar"><div class="seg" role="group" aria-label="' + esc(tx('Severity')) + '">' + [['all', 'All'], ['error', 'Errors'], ['warning', 'Warnings'], ['info', 'Notes']].map(function (x) {
      return '<button type="button" data-act="sev" data-v="' + x[0] + '" aria-pressed="' + (ui.sev === x[0]) + '">' + esc(tx(x[1])) + ' <span class="muted">' + n0(counts[x[0]]) + '</span></button>';
    }).join('') + '</div><label class="check"><input type="checkbox" data-chg="fixonly"' + (view.fixOnly ? ' checked' : '') + '> ' + esc(tx('Only one-click fixes')) + '</label><span class="grow"></span>' +
      (last ? '<button type="button" class="btn sm" data-act="undo">' + ic('undo') + esc(tx('Undo: {label}', { label: cut(histLabel(last.label), 40) })) + '</button>' : '') + '</div>';
    var shown = rules.filter(function (o) { var R = E.RULES[o.k]; return (ui.sev === 'all' || R.sev === ui.sev) && (!view.fixOnly || o.fixable); });
    if (!shown.length) return h + '<div class="card"><p class="empty">' + (rules.length ? esc(tx(view.fixOnly ? 'No one-click fixes left.' : 'Nothing matches this filter.')) + ' ' +
      '<button type="button" class="btn sm" data-act="showall">' + esc(tx('Show all issues')) + '</button>' : esc(tx('No problems found. Every value passed every check.'))) + '</p></div>';
    E.GROUPS.forEach(function (g) {
      var list = shown.filter(function (o) { return E.RULES[o.k].group === g[0]; }).sort(function (a, b) { return byImpact([a.k, a.n, a.rows], [b.k, b.n, b.rows]); });
      if (!list.length) return;
      h += '<h2 class="grp-h">' + esc(lx(g[1])) + '</h2>' + list.map(function (o) { return ruleCard(meta, d, res, o); }).join('');
    });
    return h;
  }
  function ruleCard(meta, d, res, o) {
    var R = E.RULES[o.k], open = !!view.open[o.k], sevc = R.sev === 'error' ? 'e' : R.sev === 'warning' ? 'w' : 'i';
    var counts = o.rows ? valuesIn(o.n, o.rows) + ' · ' + tx('{pct} of rows', { pct: pct(o.rows, res.nRows) }) : tx('the whole file');
    var h = '<section class="rule sev-' + sevc + '" id="rule-' + esc(o.k) + '"><div class="rule-h"><button type="button" class="rule-t" data-act="rule" data-v="' + esc(o.k) + '" aria-expanded="' + open + '" aria-controls="rb-' + esc(o.k) + '">' +
      '<span class="sev ' + sevc + '">' + esc(sevName(R.sev)) + '</span><span class="rt"><b>' + esc(ruleT(o.k)) + '</b><small>' + esc(counts) + '</small></span></button>' +
      (o.fixable ? '<button type="button" class="btn sm pri" data-act="fixall" data-v="' + esc(o.k) + '">' + ic('wand') + esc(tx('Fix all ({n})', { n: n0(o.fixable) })) + '</button>' : '') + '</div>';
    if (open) {
      h += '<div class="rule-b" id="rb-' + esc(o.k) + '"><p class="why">' + esc(lx(R.why)) + '</p>';
      if (o.k === 'unit.variant') {
        var uc = res.roles.indexOf('unit'), pc = uc >= 0 && res.profiles[uc].unit && res.profiles[uc].unit.pc;
        if (pc) h += unitPicker(d, pc, 'uRule');
      }
      var ex = o.first.slice(0, 10);
      if (o.rows) {
        h += '<div class="tw"><table class="t compact ex"><thead><tr><th>' + esc(tx('Row')) + '</th><th>' + esc(tx('Record')) + '</th><th>' + esc(tx('Column')) + '</th><th>' + esc(tx('Value')) + '</th><th>' + esc(tx('Problem')) + '</th><th>' + (R.fix ? esc(tx('After the fix')) : R.sug ? esc(tx('Suggestion')) : '') + '</th></tr></thead><tbody>' + ex.map(function (x) {
          var v = d.rows[x.r][x.c], fix = x.f !== undefined ? x.f : x.s;
          return '<tr><td class="nw mono"><a href="#" data-act="row" data-v="' + x.r + '">' + d.lines[x.r] + '</a></td><td class="rec">' + esc(cut(recordName(d, res, x.r), 46)) + '</td><td class="nw">' + esc(d.headers[x.c]) + '</td>' +
            '<td class="val">' + showWs(v, 60) + '</td><td class="msg">' + esc(msgOf(x, d, res)) + '</td><td class="val">' +
            (fix !== undefined ? '<span class="after">' + showWs(fix, 60) + '</span> <button type="button" class="btn sm ghost" data-act="useone" data-r="' + x.r + '" data-c="' + x.c + '" data-k="' + esc(x.k) + '">' + esc(tx('Use')) + '</button>' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
        h += '<div class="dr-actions"><a class="btn sm" href="#/check/' + esc(meta.id) + '/rows" data-act="rowsrule" data-v="' + esc(o.k) + '">' + ic('table') + esc(tx('Show all rows ({n})', { n: n0(o.rows) })) + '</a>' +
          (o.n > ex.length ? '<span class="hint">' + esc(tx('Showing {a} of {b}.', { a: ex.length, b: n0(o.n) })) + '</span>' : '') + '</div>';
      } else {
        h += '<ul class="list">' + res.structure.filter(function (x) { return x.k === o.k; }).map(function (x) { return '<li><div class="l">' + esc(msgOf(x, d, res)) + '</div></li>'; }).join('') + '</ul>';
      }
      h += '</div>';
    }
    return h + '</section>';
  }
  /** the engine's sentence for an issue, in the screen language */
  function msgOf(x, d, res) { return lx(E.message(x, { table: d, res: res })); }
  function fixPreview(k) {
    if (cur.busy) return toast(tx('Wait until the check has finished.'));
    var res = cur.res, d = cur.data, R = E.RULES[k], list = res.issues.filter(function (x) { return x.k === k && x.f !== undefined; });
    if (!list.length) return toast(tx('Nothing left to fix for this rule.'));
    var cols = {}; list.forEach(function (x) { cols[d.headers[x.c]] = 1; });
    modal(tx('Fix all: {title}', { title: ruleT(k) }), '<p>' + esc(tx(list.length === 1 ? '{n} value changes in {cols}. You can undo it.' : '{n} values change in {cols}. You can undo it.', { n: n0(list.length), cols: Object.keys(cols).join(', ') })) + '</p>' +
      '<div class="tw prev"><table class="t compact"><thead><tr><th>' + esc(tx('Row')) + '</th><th>' + esc(tx('Column')) + '</th><th>' + esc(tx('Before')) + '</th><th>' + esc(tx('After')) + '</th></tr></thead><tbody>' + list.slice(0, 40).map(function (x) {
        return '<tr><td class="mono">' + d.lines[x.r] + '</td><td class="nw">' + esc(d.headers[x.c]) + '</td><td class="val">' + showWs(d.rows[x.r][x.c], 70) + '</td><td class="val after">' + showWs(x.f, 70) + '</td></tr>';
      }).join('') + '</tbody></table></div>' + (list.length > 40 ? '<p class="hint">' + esc(tx('And {n} more.', { n: n0(list.length - 40) })) + '</p>' : ''),
    tx('Apply {n} fixes', { n: n0(list.length) }), function () {
      closeLayer();
      noteFixed(d, [k]);
      commitChanges(R.title + ' fixed', list.map(function (x) { return { r: x.r, c: x.c, v: x.f }; }));
    }, { wide: true });
  }

  // rows tab
  function rowFilterOptions(res) {
    var o = [['all', tx('All rows'), res.nRows], ['err', tx('Rows with errors'), res.rowsErr], ['warn', tx('Rows with warnings only'), res.rowsWarn], ['any', tx('Rows with any problem'), null], ['clean', tx('Rows without problems'), null], ['dup', tx('Rows in duplicate groups'), null]];
    if (cur && cur.einv) o.push(['einv', tx('Not ready for e-invoices'), cur.einv.rows - cur.einv.ready]);
    var rules = Object.keys(res.rules).filter(function (k) { return res.rules[k].rows; }).sort(function (a, b) { return E.RULES[a].order - E.RULES[b].order; });
    return o.concat(rules.map(function (k) { return ['rule:' + k, ruleT(k), res.rules[k].rows]; }));
  }
  function filteredRows(d, res) {
    var f = view.rowsF, q = (view.rowsQ || '').toLowerCase().trim(), out = [], set = null;
    if (f.indexOf('rule:') === 0) { set = new Set(); var k = f.slice(5); res.issues.forEach(function (x) { if (x.k === k) set.add(x.r); }); }
    for (var r = 0; r < res.nRows; r++) {
      if (f === 'err' && res.rowW[r] !== 3) continue;
      if (f === 'warn' && res.rowW[r] !== 1) continue;
      if (f === 'any' && res.rowStart[r + 1] === res.rowStart[r]) continue;
      if (f === 'clean' && res.rowStart[r + 1] !== res.rowStart[r]) continue;
      if (f === 'dup' && res.groupOf[r] < 0) continue;
      if (f === 'einv' && (!cur.einv || !cur.einv.masks[r])) continue;
      if (set && !set.has(r)) continue;
      if (q) { var row = d.rows[r], hit = false; for (var c = 0; c < row.length && !hit; c++) if (String(row[c]).toLowerCase().indexOf(q) >= 0) hit = true; if (!hit) continue; }
      out.push(r);
    }
    return out;
  }
  function cellIssues(res, r) {
    var m = {};
    for (var i = res.rowStart[r]; i < res.rowStart[r + 1]; i++) { var x = res.issues[i]; (m[x.c] = m[x.c] || []).push(x); }
    return m;
  }
  function worst(list) { var w = 'info'; list.forEach(function (x) { var s = E.RULES[x.k].sev; if (s === 'error' || (s === 'warning' && w === 'info')) w = s; }); return w; }
  function tabRows(meta, d, res) {
    var list = filteredRows(d, res), pages = Math.max(1, Math.ceil(list.length / PAGE));
    if (view.rowsPage >= pages) view.rowsPage = pages - 1;
    var from = view.rowsPage * PAGE, slice = list.slice(from, from + PAGE);
    var h = '<div class="toolbar"><label class="sr" for="rowsF">' + esc(tx('Show')) + '</label><select class="select" id="rowsF" data-chg="rowsF">' + rowFilterOptions(res).map(function (o) {
      return '<option value="' + esc(o[0]) + '"' + (o[0] === view.rowsF ? ' selected' : '') + '>' + esc(o[1]) + (o[2] != null ? ' (' + n0(o[2]) + ')' : '') + '</option>';
    }).join('') + '</select><input class="search" type="search" id="rowsQ" data-inp="rowsQ" placeholder="' + esc(tx('Search in every column')) + '" aria-label="' + esc(tx('Search rows')) + '" value="' + esc(view.rowsQ) + '"></div>';
    if (!list.length) return h + '<div class="card"><p class="empty">' + esc(tx('No rows match. Choose another filter or clear the search.')) + '</p></div>';
    var cols = d.headers.map(function (x, c) { return c; });
    h += '<section class="card"><div class="stats"><span>' + tx('Rows: <b>{n}</b>', { n: n0(list.length) }) + '</span><span>' + esc(tx('Click a row to edit it. Coloured cells have a problem; hover or focus for details.')) + '</span></div>' +
      '<div class="tw rows-wrap"><table class="t grid"><thead><tr><th class="rn" scope="col">' + esc(tx('Row')) + '</th>' + cols.map(function (c) {
        return '<th scope="col">' + esc(cut(d.headers[c], 28)) + '<small>' + esc(roleName(d.roles[c])) + '</small></th>';
      }).join('') + '</tr></thead><tbody>' + slice.map(function (r) {
        var m = cellIssues(res, r), w = res.rowW[r];
        return '<tr class="click" data-act="row" data-v="' + r + '" tabindex="0" title="' + esc(tx('Edit row {n}', { n: d.lines[r] })) + '"><th scope="row" class="rn ' + (w === 3 ? 'e' : w === 1 ? 'w' : '') + '">' + d.lines[r] + (res.groupOf[r] >= 0 ? '<span class="dupmark" title="' + esc(tx('In a duplicate group')) + '">' + esc(tx('D')) + '</span>' : '') + '</th>' + cols.map(function (c) {
          var iss = m[c], v = d.rows[r][c];
          if (!iss) return '<td>' + (v === '' ? '' : showWs(v, 48)) + '</td>';
          var sv = worst(iss), tip = iss.map(function (x) { return ruleT(x.k) + ': ' + msgOf(x, d, res); }).join('\n');
          return '<td class="c' + sv.charAt(0) + '" title="' + esc(tip) + '">' + showWs(v, 48) + '</td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="pager"><span>' + esc(tx('Rows {from}–{to} of {total}', { from: n0(from + 1), to: n0(from + slice.length), total: n0(list.length) })) + '</span><div><button type="button" class="btn sm" data-act="page" data-v="-1"' + (view.rowsPage ? '' : ' disabled') + '>' + esc(tx('Previous')) + '</button>' +
      '<button type="button" class="btn sm" data-act="page" data-v="1"' + (view.rowsPage < pages - 1 ? '' : ' disabled') + '>' + esc(tx('Next')) + '</button></div></div></section>';
    return h;
  }
  function openRow(r) {
    var d = cur.data, res = cur.res; if (!d || !res || !d.rows[r]) return;
    var m = cellIssues(res, r);
    var body = '<form id="rowForm" data-r="' + r + '" novalidate>' + d.headers.map(function (hd, c) {
      var v = d.rows[r][c], iss = m[c] || [], multi = /[\r\n]/.test(v) || v.length > 70;
      var input = multi ? '<textarea class="in" id="rf-' + c + '" data-c="' + c + '" rows="2">' + esc(v) + '</textarea>' : '<input class="in" id="rf-' + c + '" data-c="' + c + '" value="' + esc(v) + '"' + (iss.length ? ' aria-describedby="rfi-' + c + '"' : '') + '>';
      return '<div class="field rf' + (iss.length ? ' has-' + worst(iss) : '') + '"><label for="rf-' + c + '">' + esc(hd) + ' <small class="muted">· ' + esc(roleName(d.roles[c])) + '</small></label>' + input +
        (iss.length ? '<ul class="cell-iss" id="rfi-' + c + '">' + iss.map(function (x) {
          var fix = x.f !== undefined ? x.f : x.s, R = E.RULES[x.k];
          return '<li class="' + R.sev + '"><span>' + esc(msgOf(x, d, res)) + '</span>' + (fix !== undefined ? '<button type="button" class="btn sm ghost" data-act="usefield" data-c="' + c + '" data-v="' + esc(fix) + '">' + esc(tx('Use {value}', { value: I.q(cut(fix, 40) || tx('(empty)'), true) })) + '</button>' : '') + '</li>';
        }).join('') + '</ul>' : '') + '</div>';
    }).join('') + '</form>';
    var g = res.groupOf[r] >= 0 ? res.groups[res.groupOf[r]] : null;
    var ei = cur.einv, miss = ei ? E.EINV.filter(function (x, i) { return ei.masks[r] & (1 << i); }).map(function (x) { return lc(lx(x[1])); }) : [];
    var vat = res.cols.vat >= 0 && d.vies ? d.vies[(E.vatCheck(E.core(d.rows[r][res.cols.vat]), res.rowCC[r]) || {}).norm] : null;
    var lead = (ei ? '<div class="notice ' + (miss.length ? '' : 'ok') + '">' + esc(miss.length ? tx('E-invoice readiness {n} of 100: missing or wrong {list}.', { n: ei.scores[r], list: ruleList(miss) }) : tx('E-invoice readiness {n} of 100: ready.', { n: ei.scores[r] })) + '</div>' : '') +
      (vat && typeof vat.valid === 'boolean' ? '<div class="notice ' + (vat.valid ? 'ok' : 'warn') + '">' + esc(tx('VIES {date}:', { date: dt(vat.at) })) + ' ' + (vat.valid ? esc(tx('valid')) + (vat.name ? ' · ' + esc(vat.name) : '') + (vat.address ? ' · ' + esc(vat.address) : '') : esc(tx('not valid'))) + '</div>' : '') +
      (g ? '<div class="notice">' + esc(g.survivor === r ? tx('In a duplicate group of {n} rows, kept as the survivor.', { n: g.rows.length }) : tx('In a duplicate group of {n} rows, merging into row {row}.', { n: g.rows.length, row: d.lines[g.survivor] })) + ' <a href="#/check/' + esc(cur.id) + '/duplicates" data-act="close">' + esc(tx('See duplicates')) + '</a></div>' : '');
    drawer(tx('Row {n}', { n: d.lines[r] }), recordName(d, res, r), lead + body, '<button type="button" class="btn pri" data-act="saverow" data-v="' + r + '">' + esc(tx('Save changes')) + '</button><button type="button" class="btn" data-act="close">' + esc(tx('Cancel')) + '</button>', false);
  }

  // duplicates tab
  function tabDuplicates(meta, d, res) {
    var thr = d.dupThreshold || db.settings.dupThreshold, groups = res.groups, pages = Math.max(1, Math.ceil(groups.length / DUP_PAGE));
    if (view.dupPage >= pages) view.dupPage = pages - 1;
    var dupRows = 0; groups.forEach(function (g) { dupRows += g.rows.length; });
    var decided = Object.keys(d.survivors).length + Object.keys(d.notDup).length;
    var h = '<div class="toolbar dup-tools"><div class="field thr"><label for="thr">' + esc(tx('Match threshold')) + ' <b id="thrV">' + thr + '</b></label><input type="range" id="thr" min="' + E.MIN_PAIR + '" max="100" step="1" value="' + thr + '" data-chg="thr" data-inp="thrV"></div>' +
      '<div class="dup-count"><b>' + esc(plural(groups.length, 'group', 'groups')) + '</b> · ' + esc(plural(dupRows, 'record', 'records')) + ' · ' + esc(tx('to merge: {n}', { n: n0(dupRows - groups.length) })) + '</div>' +
      (decided ? '<button type="button" class="btn sm ghost" data-act="dupreset">' + esc(tx('Reset my decisions')) + '</button>' : '') + '</div>';
    h += '<details class="how card pad"><summary>' + esc(tx('How the match works')) + '</summary><p>' + esc(tx(res.dup.kind === 'products' ?
      'Names are compared without capitals, punctuation or Slovene and Croatian letters, word by word (Jaro-Winkler) and as a whole. The same barcode adds 30 and the same SKU 10; a different barcode takes off 30, different numbers in the name (sizes, powers) 40, and a missing barcode 10. 100 is a certain match.' :
      'Names are compared without legal forms (d.o.o., GmbH…), capitals, punctuation or Slovene and Croatian letters, word by word (Jaro-Winkler) and as a whole. The same VAT ID adds 25, the same e-mail or IBAN 15, the same phone 10, a matching street 8 and postal code 4; a different VAT ID takes off 35, a different street or postal code 10. 100 is a certain match.') + ' ' +
      tx('Rows are only compared when they share the first letters of the name, a VAT ID, e-mail, phone or barcode, so even large files stay fast. The suggested record to keep is the most complete one.')) + '</p></details>';
    if (!res.dup.ok) return h + '<div class="card"><p class="empty">' + esc(tx('Duplicates need a Name column. Mark one on the Columns tab.')) + '</p></div>';
    if (!groups.length) return h + '<div class="card"><p class="empty">' + esc(tx('No duplicates at this threshold. Lower it to see weaker matches.')) + '</p></div>';
    var cols = d.headers.map(function (x, c) { return c; }).filter(function (c) { return d.roles[c] !== 'ignore'; });
    groups.slice(view.dupPage * DUP_PAGE, view.dupPage * DUP_PAGE + DUP_PAGE).forEach(function (g, i) {
      var gi = view.dupPage * DUP_PAGE + i, sv = g.survivor, title = recordName(d, res, sv);
      h += '<section class="card dupg"><div class="card-h"><div><span class="label">' + esc(tx('Group {n}', { n: gi + 1 }) + ' · ' + tx('best match {n}', { n: g.score }) + ' · ' + plural(g.rows.length, 'record', 'records')) + '</span><h3>' + esc(cut(title, 70)) + '</h3></div>' +
        '<button type="button" class="btn sm" data-act="notdup" data-v="' + gi + '">' + esc(tx('Not duplicates')) + '</button></div><div class="tw"><table class="t cmp"><thead><tr><th scope="col">' + esc(tx('Field')) + '</th>' + g.rows.map(function (r) {
          return '<th scope="col"><label class="keep"><input type="radio" name="sv-' + gi + '" data-chg="survivor" data-g="' + gi + '" value="' + r + '"' + (r === sv ? ' checked' : '') + '> ' + esc(tx('Keep row {n}', { n: d.lines[r] })) + '</label>' +
            '<small>' + esc(r === sv ? tx(g.auto ? 'suggested: most complete' : 'kept') : tx('match {m} · merges into {row}', { m: g.match[r] || '–', row: d.lines[sv] })) + '</small></th>';
        }).join('') + '</tr></thead><tbody>' + cols.map(function (c) {
          var base = E.core(d.rows[sv][c]).toLowerCase();
          if (g.rows.every(function (r) { return !E.core(d.rows[r][c]); })) return '';
          return '<tr><th scope="row">' + esc(d.headers[c]) + '</th>' + g.rows.map(function (r) {
            var v = d.rows[r][c], k = E.core(v).toLowerCase(), cls = r === sv ? 'sv' : !k ? '' : !base ? 'fill' : k !== base ? 'diff' : '';
            return '<td class="' + cls + '"' + (cls === 'fill' ? ' title="' + esc(tx('Fills an empty field of the kept record')) + '"' : cls === 'diff' ? ' title="' + esc(tx('Differs from the kept record')) + '"' : '') + '>' + (v === '' ? '<span class="muted">—</span>' : showWs(v, 60)) + '</td>';
          }).join('') + '</tr>';
        }).join('') + '</tbody></table></div></section>';
    });
    if (pages > 1) h += '<div class="pager card"><span>' + esc(tx('Groups {from}–{to} of {total}', { from: view.dupPage * DUP_PAGE + 1, to: Math.min(groups.length, (view.dupPage + 1) * DUP_PAGE), total: groups.length })) + '</span><div>' +
      '<button type="button" class="btn sm" data-act="duppage" data-v="-1"' + (view.dupPage ? '' : ' disabled') + '>' + esc(tx('Previous')) + '</button><button type="button" class="btn sm" data-act="duppage" data-v="1"' + (view.dupPage < pages - 1 ? '' : ' disabled') + '>' + esc(tx('Next')) + '</button></div></div>';
    h += '<p class="hint">' + esc(tx('Highlighted:')) + ' <span class="key diff">' + esc(tx('differs from the kept record')) + '</span> <span class="key fill">' + esc(tx('fills one of its empty fields')) + '</span>. ' + esc(tx('Your choices are saved with the check and used in the exports.')) + '</p>';
    return h;
  }

  // export tab
  function baseName(n) { return String(n).replace(/\.[^.]+$/, '').replace(/[^\w\-. ]+/g, '_').trim() || 'data'; }
  function tabExport(meta, d, res) {
    var x = ui.exp, groups = res.groups, errRows = res.rowsErr;
    var T = E.TYPE[res.type] || E.TYPE.customers;
    var h = '<div class="grid2 exports"><section class="card pad"><span class="label">' + esc(tx('CSV · UTF-8 with BOM, opens correctly in Excel')) + '</span><h2>' + esc(tx('Cleaned file')) + '</h2><p class="sub">' + esc(tx('All rows with your fixes and edits.')) + '</p>' +
      '<fieldset class="grp"><legend>' + esc(tx('Delimiter')) + '</legend><div class="seg" role="group" aria-label="' + esc(tx('Delimiter')) + '">' + [[';', tx('Semicolon ;')], [',', tx('Comma ,')], ['\t', tx('Tab')], ['|', tx('Pipe |')]].map(function (o) {
        return '<button type="button" data-act="expdelim" data-v="' + (o[0] === '\t' ? 'tab' : esc(o[0])) + '" aria-pressed="' + (x.delim === o[0]) + '">' + esc(o[1]) + '</button>';
      }).join('') + '</div></fieldset>' +
      '<label class="check"><input type="checkbox" data-chg="exp" data-k="dropErrors"' + (x.dropErrors ? ' checked' : '') + '> ' + esc(tx('Leave out the rows with errors ({n})', { n: n0(errRows) })) + '</label>' +
      '<label class="check"><input type="checkbox" data-chg="exp" data-k="dropIgnored"' + (x.dropIgnored ? ' checked' : '') + '> ' + esc(tx('Leave out columns marked Ignore')) + '</label>' +
      '<label class="check"><input type="checkbox" data-chg="exp" data-k="isoDates"' + (x.isoDates ? ' checked' : '') + '> ' + esc(tx('Write dates as yyyy-mm-dd')) + '</label>' +
      '<div class="field"><label for="expDec">' + esc(tx('Numbers and prices')) + '</label><select class="in" id="expDec" data-chg="expdec"><option value="keep"' + (x.dec === 'keep' ? ' selected' : '') + '>' + esc(tx('As they are')) + '</option><option value=","' + (x.dec === ',' ? ' selected' : '') + '>' + esc(tx('Plain, decimal comma (1234,56)')) + '</option><option value="."' + (x.dec === '.' ? ' selected' : '') + '>' + esc(tx('Plain, decimal point (1234.56)')) + '</option></select></div>' +
      '<div class="dr-actions"><button type="button" class="btn pri" data-act="dlclean">' + ic('dl') + esc(tx('Download cleaned file')) + '</button></div></section>';
    h += '<section class="card pad"><span class="label">CSV</span><h2>' + esc(tx('Issues list')) + '</h2><p class="sub">' + esc(tx('Every problem with its row, column, value and the suggested fix: {lines}. Useful as a to-do list for whoever corrects the source system.', { lines: plural(res.issues.length + res.structure.length, 'line', 'lines') })) + '</p>' +
      '<div class="dr-actions"><button type="button" class="btn" data-act="dlissues">' + ic('dl') + esc(tx('Download issues')) + '</button></div>' +
      '<h2 class="mt">' + esc(tx('Duplicate merge map')) + '</h2><p class="sub">' + esc(tx('For every duplicate: its code and the code of the record it merges into, so open documents can be repointed.')) + '</p>' +
      '<div class="dr-actions"><button type="button" class="btn" data-act="dlmap"' + (groups.length ? '' : ' disabled') + '>' + ic('dl') + esc(tx('Download merge map')) + '</button>' + (groups.length ? '' : '<span class="hint">' + esc(tx('No duplicates found.')) + '</span>') + '</div>' +
      '<h2 class="mt">' + esc(tx('Deduplicated file')) + '</h2><p class="sub">' + esc(groups.length ? tx({ customers: 'One row per customer: the duplicates are left out ({rows}).', suppliers: 'One row per supplier: the duplicates are left out ({rows}).', products: 'One row per product: the duplicates are left out ({rows}).' }[T.id], { rows: plural(res.nRows - countAfterDedup(res), 'row', 'rows') }) :
        tx({ customers: 'One row per customer: the duplicates are left out.', suppliers: 'One row per supplier: the duplicates are left out.', products: 'One row per product: the duplicates are left out.' }[T.id])) + '</p>' +
      '<label class="check"><input type="checkbox" data-chg="exp" data-k="merge"' + (x.merge ? ' checked' : '') + '> ' + esc(tx('Fill empty fields of the kept record from its duplicates')) + '</label>' +
      '<div class="dr-actions"><button type="button" class="btn" data-act="dldedup"' + (groups.length ? '' : ' disabled') + '>' + ic('dl') + esc(tx('Download deduplicated file')) + '</button></div></section></div>';
    h += '<section class="card pad report-cta"><div><span class="label">' + esc(tx('For the prospect or the project team')) + '</span><h2>' + esc(tx('Printable report')) + '</h2><p class="sub">' + esc(tx('Score, problems by rule with examples, duplicates and what to fix before the migration, in English, Slovene or Croatian.')) + '</p></div>' +
      '<a class="btn pri" href="#/report/' + esc(meta.id) + '">' + ic('report') + esc(tx('Open the report')) + '</a></section>';
    h += '<p class="hint">' + ic('lock') + ' ' + esc(tx('Files are created in this browser. Nothing is uploaded.')) + '</p>';
    return h;
  }
  function countAfterDedup(res) { var n = res.nRows; res.groups.forEach(function (g) { n -= g.rows.length - 1; }); return n; }
  function exportRows(d, res, opts) {
    var x = ui.exp, keepCols = d.headers.map(function (h, c) { return c; }).filter(function (c) { return !(x.dropIgnored && d.roles[c] === 'ignore'); });
    var rows = [];
    function conv(v, c) {
      var role = d.roles[c];
      if (x.isoDates && role === 'date') { var p = E.parseDate(E.core(v), { serial: true }); if (p.ok) return p.iso; }
      if (x.dec !== 'keep' && (role === 'price' || role === 'number' || role === 'vatrate')) { var n = E.parseNumber(E.core(v), res.profiles[c] && res.profiles[c].dec); if (n.ok) return E.plainNumber(n.n, x.dec, n.fd); }
      return v;
    }
    for (var r = 0; r < res.nRows; r++) {
      if (x.dropErrors && res.rowW[r] === 3 && !opts.keepErrors) continue;
      var row = d.rows[r];
      if (opts.dedup && res.groupOf[r] >= 0) {
        var g = res.groups[res.groupOf[r]];
        if (g.survivor !== r) continue;
        if (x.merge) row = E.mergeRow(d.rows, g.rows, r);
      }
      rows.push(keepCols.map(function (c) { return conv(row[c], c); }));
    }
    return { headers: keepCols.map(function (c) { return d.headers[c]; }), rows: rows };
  }
  function dlClean(dedup) {
    var d = cur.data, res = cur.res, out = exportRows(d, res, { dedup: dedup });
    download(baseName(cur.meta.name) + '-' + tx(dedup ? 'deduplicated' : 'cleaned') + '.csv', E.toCsv(out.headers, out.rows, ui.exp.delim, true));
    toast(tx(dedup ? 'Deduplicated file: {rows}' : 'Cleaned file: {rows}', { rows: plural(out.rows.length, 'row', 'rows') }));
  }
  function dlIssues() {
    var d = cur.data, res = cur.res, rows = [];
    res.structure.forEach(function (x) { rows.push(['', '', '', '', '', sevName(E.RULES[x.k].sev), ruleT(x.k), msgOf(x, d, res), '']); });
    res.issues.forEach(function (x) {
      var idc = res.cols.id >= 0 ? res.cols.id : res.cols.sku, fix = x.f !== undefined ? x.f : x.s;
      rows.push([d.lines[x.r], idc >= 0 ? d.rows[x.r][idc] : '', res.cols.name >= 0 ? d.rows[x.r][res.cols.name] : '', d.headers[x.c], d.rows[x.r][x.c], sevName(E.RULES[x.k].sev), ruleT(x.k), msgOf(x, d, res), fix == null ? '' : fix]);
    });
    var ISSUE_COLS = ['Row', 'ID', 'Name', 'Column', 'Value', 'Severity', 'Problem', 'Details', 'Suggested value'];
    download(baseName(cur.meta.name) + '-' + tx('issues') + '.csv', E.toCsv(ISSUE_COLS.map(function (c) { return tx(c); }), rows, ui.exp.delim, true));
  }
  function dlMap() {
    var d = cur.data, res = cur.res, rows = [], idc = res.cols.id >= 0 ? res.cols.id : res.cols.sku, nc = res.cols.name;
    var val = function (r, c) { return c >= 0 ? d.rows[r][c] : ''; };
    res.groups.forEach(function (g, gi) {
      g.rows.forEach(function (r) {
        if (r === g.survivor) return;
        rows.push([gi + 1, g.match[r] || g.score, d.lines[r], val(r, idc), val(r, nc), d.lines[g.survivor], val(g.survivor, idc), val(g.survivor, nc)]);
      });
    });
    var MAP_COLS = ['Group', 'Match', 'Duplicate row', 'Duplicate ID', 'Duplicate name', 'Survivor row', 'Survivor ID', 'Survivor name'];
    download(baseName(cur.meta.name) + '-' + tx('merge-map') + '.csv', E.toCsv(MAP_COLS.map(function (c) { return tx(c); }), rows, ui.exp.delim, true));
  }

  // ── page: report (Slovene, Croatian and English) ─────────────────────────
  var L = {
    en: { lang: 'English', title: 'Data health report', for: 'Prepared for', by: 'Prepared by', date: 'Date', file: 'File', records: 'Records', columns: 'Columns', contents: 'Contents',
      score: 'Data health score', of100: 'of 100', after: 'After the automatic fixes: about {n}', how: 'The score is the share of records without problems, weighted by severity: a record with an error counts three times, a record with only warnings once, notes do not count.',
      split: 'Records with errors: {e} · with warnings only: {w} · without problems: {c}', problems: 'Problems found', problem: 'Problem', severity: 'Severity', recs: 'Records', share: 'Share', auto: 'Automatic fix', yes: 'yes',
      examples: 'Examples', row: 'Row', record: 'Record', field: 'Field', value: 'Value', suggested: 'Suggested', dups: 'Duplicates', dupGroups: 'Groups of possible duplicates', dupRecords: 'Records in these groups', dupMerge: 'Records to merge',
      dupTop: 'Largest groups', fix: 'What to fix before you migrate', missing: 'Columns not in the file', required: 'required', recommended: 'recommended', none: 'No problems found.',
      noData: 'Examples and duplicate names are not available because the file is not stored in this browser.', noDup: 'No duplicates found.',
      footer: 'Checked with the Clearfigure data health check on {d}. The file was read in the browser and was not uploaded anywhere. This is a technical check of the data, not legal or tax advice.',
      sev: { error: 'Error', warning: 'Warning', info: 'Note' }, band: { good: 'Good: ready to migrate after a quick review.', fair: 'Fair: usable, but correct the errors before you migrate.', poor: 'Poor: the data needs work before it goes into a new system.', critical: 'Critical: the data is not fit to migrate as it is.' },
      types: { customers: 'Customers', suppliers: 'Suppliers', products: 'Products' },
      since: 'Since the first check on {d}: {a} → {b}', recipe: 'Recipe', einv: 'E-invoice readiness',
      einvLead: '{p} % of the records ({r} of {n}) have everything an e-invoice needs. Croatian B2B e-invoices have been mandatory since 1 January 2026; Slovene ones will be from 1 January 2028.',
      einvSince: 'Since the first check: {a} % → {b} %.', einvField: 'Field', einvMiss: 'Missing or wrong', einvFor: 'Counts for',
      einvHow: 'A record is ready when every field that applies to it is filled in and passes the checks. The fields follow the buyer part of the European e-invoice standard EN 16931. The tax ID counts for companies in the EU, the IBAN for suppliers and when the file has an IBAN column.',
      vies: 'Online VAT check (VIES): {v} valid, {i} not valid, {u} without an answer, of {t} VAT IDs.',
      erp: 'What we\'d fix in your ERP', erpLead: 'Cleaning the file once is half the job. These changes in the system stop the same problems from coming back:', book: 'Book 20 minutes to go through the findings' },
    sl: { lang: 'Slovenščina', title: 'Poročilo o kakovosti podatkov', for: 'Naročnik', by: 'Izvajalec', date: 'Datum', file: 'Datoteka', records: 'Zapisi', columns: 'Stolpci', contents: 'Vsebina',
      score: 'Ocena kakovosti podatkov', of100: 'od 100', after: 'Po samodejnih popravkih: približno {n}', how: 'Ocena je delež zapisov brez težav, utežen z resnostjo: zapis z napako šteje trikrat, zapis samo z opozorili enkrat, opombe se ne štejejo.',
      split: 'Zapisi z napakami: {e} · samo z opozorili: {w} · brez težav: {c}', problems: 'Ugotovljene težave', problem: 'Težava', severity: 'Resnost', recs: 'Zapisi', share: 'Delež', auto: 'Samodejni popravek', yes: 'da',
      examples: 'Primeri', row: 'Vrstica', record: 'Zapis', field: 'Polje', value: 'Vrednost', suggested: 'Predlog', dups: 'Dvojniki', dupGroups: 'Skupine verjetnih dvojnikov', dupRecords: 'Zapisi v teh skupinah', dupMerge: 'Zapisi za združitev',
      dupTop: 'Največje skupine', fix: 'Kaj popraviti pred prenosom podatkov', missing: 'Stolpci, ki jih v datoteki ni', required: 'obvezen', recommended: 'priporočen', none: 'Težav ni bilo najdenih.',
      noData: 'Primeri in nazivi dvojnikov niso na voljo, ker datoteka ni shranjena v tem brskalniku.', noDup: 'Dvojnikov ni bilo najdenih.',
      footer: 'Preverjeno s pregledom kakovosti podatkov Clearfigure dne {d}. Datoteka je bila prebrana v brskalniku in ni bila nikamor naložena. Gre za tehnični pregled podatkov in ne za pravni ali davčni nasvet.',
      sev: { error: 'Napaka', warning: 'Opozorilo', info: 'Opomba' }, band: { good: 'Dobro: podatki so po hitrem pregledu pripravljeni za prenos.', fair: 'Zadovoljivo: podatki so uporabni, vendar pred prenosom odpravite napake.', poor: 'Slabo: podatke je treba urediti, preden jih prenesete v nov sistem.', critical: 'Kritično: podatki v tej obliki niso primerni za prenos.' },
      types: { customers: 'Kupci', suppliers: 'Dobavitelji', products: 'Artikli' },
      since: 'Od prvega pregleda {d}: {a} → {b}', recipe: 'Recept', einv: 'Pripravljenost na e-račune',
      einvLead: '{p} % zapisov ({r} od {n}) ima vse, kar potrebuje e-račun. Na Hrvaškem so e-računi med podjetji obvezni od 1. januarja 2026, v Sloveniji bodo od 1. januarja 2028.',
      einvSince: 'Od prvega pregleda: {a} % → {b} %.', einvField: 'Polje', einvMiss: 'Manjka ali napačno', einvFor: 'Velja za',
      einvHow: 'Zapis je pripravljen, ko je vsako polje, ki zanj velja, izpolnjeno in prestane preverjanja. Polja sledijo delu o kupcu v evropskem standardu za e-račune EN 16931. Davčna številka velja za podjetja v EU, IBAN za dobavitelje in kadar ima datoteka stolpec IBAN.',
      vies: 'Spletno preverjanje ID za DDV (VIES): {v} veljavnih, {i} neveljavnih, {u} brez odgovora, od {t} številk.',
      erp: 'Kaj bi uredili v vašem ERP-ju', erpLead: 'Enkratno čiščenje datoteke je pol dela. S temi spremembami v sistemu se iste težave ne bodo vračale:', book: 'Rezervirajte 20 minut za pregled ugotovitev' },
    hr: { lang: 'Hrvatski', title: 'Izvješće o kvaliteti podataka', for: 'Naručitelj', by: 'Izvođač', date: 'Datum', file: 'Datoteka', records: 'Zapisi', columns: 'Stupci', contents: 'Sadržaj',
      score: 'Ocjena kvalitete podataka', of100: 'od 100', after: 'Nakon automatskih ispravaka: otprilike {n}', how: 'Ocjena je udio zapisa bez problema, ponderiran prema ozbiljnosti: zapis s pogreškom broji se tri puta, zapis samo s upozorenjima jednom, a napomene se ne broje.',
      split: 'Zapisi s pogreškama: {e} · samo s upozorenjima: {w} · bez problema: {c}', problems: 'Utvrđeni problemi', problem: 'Problem', severity: 'Ozbiljnost', recs: 'Zapisi', share: 'Udio', auto: 'Automatski ispravak', yes: 'da',
      examples: 'Primjeri', row: 'Redak', record: 'Zapis', field: 'Polje', value: 'Vrijednost', suggested: 'Prijedlog', dups: 'Duplikati', dupGroups: 'Skupine mogućih duplikata', dupRecords: 'Zapisi u tim skupinama', dupMerge: 'Zapisi za spajanje',
      dupTop: 'Najveće skupine', fix: 'Što ispraviti prije prijenosa podataka', missing: 'Stupci kojih nema u datoteci', required: 'obavezan', recommended: 'preporučen', none: 'Nisu pronađeni problemi.',
      noData: 'Primjeri i nazivi duplikata nisu dostupni jer datoteka nije spremljena u ovom pregledniku.', noDup: 'Nisu pronađeni duplikati.',
      footer: 'Provjereno provjerom kvalitete podataka Clearfigure {d}. Datoteka je pročitana u pregledniku i nije nigdje učitana. Ovo je tehnička provjera podataka, a ne pravni ili porezni savjet.',
      sev: { error: 'Pogreška', warning: 'Upozorenje', info: 'Napomena' }, band: { good: 'Dobro: podaci su nakon kratkog pregleda spremni za prijenos.', fair: 'Zadovoljavajuće: podaci su upotrebljivi, ali prije prijenosa ispravite pogreške.', poor: 'Loše: podatke treba urediti prije prijenosa u novi sustav.', critical: 'Kritično: podaci u ovom obliku nisu prikladni za prijenos.' },
      types: { customers: 'Kupci', suppliers: 'Dobavljači', products: 'Artikli' },
      since: 'Od prve provjere {d}: {a} → {b}', recipe: 'Recept', einv: 'Spremnost za e-račune',
      einvLead: '{p} % zapisa ({r} od {n}) ima sve što treba e-računu. U Hrvatskoj su e-računi među poduzetnicima obvezni od 1. siječnja 2026., a u Sloveniji će biti od 1. siječnja 2028.',
      einvSince: 'Od prve provjere: {a} % → {b} %.', einvField: 'Polje', einvMiss: 'Nedostaje ili je pogrešno', einvFor: 'Vrijedi za',
      einvHow: 'Zapis je spreman kada je svako polje koje se na njega odnosi popunjeno i prolazi provjere. Polja slijede dio o kupcu u europskoj normi za e-račune EN 16931. Porezni broj vrijedi za poduzeća u EU-u, IBAN za dobavljače i kada datoteka ima stupac IBAN.',
      vies: 'Online provjera PDV ID-a (VIES): {v} valjanih, {i} nevaljanih, {u} bez odgovora, od {t} brojeva.',
      erp: 'Što bismo uredili u vašem ERP-u', erpLead: 'Jednokratno čišćenje datoteke pola je posla. Ovim promjenama u sustavu isti se problemi neće vraćati:', book: 'Rezervirajte 20 minuta za pregled nalaza' }
  };
  // rule titles, column roles and e-invoice criteria in the report's language come from i18n.js (the same texts as the screens)
  var RI = {};
  function rx(lang) { return (RI[lang] || (RI[lang] = I18N.make(lang))).x; }
  function ruleTitle(k, lang) { return rx(lang)(E.RULES[k].title); }
  function roleNameL(r, lang) { return rx(lang)((E.ROLE[r] || E.ROLE.text).name); }
  function fill(s, o) { return s.replace(/\{(\w+)\}/g, function (a, k) { return o[k] != null ? o[k] : ''; }); }
  function dateLang(iso, lang) { if (!iso) return '—'; var d = String(iso).slice(0, 10); return +d.slice(8, 10) + '. ' + +d.slice(5, 7) + '. ' + d.slice(0, 4) + (lang === 'hr' ? '.' : ''); }
  /** the report's language: the one picked for reports, else the screen language */
  function reportLang() { return L[db.settings.reportLang] ? db.settings.reportLang : LANG; }
  // what to fix, in order of priority: a lead sentence, then "label: count" for each part that is not zero
  var THEMES = [
    { t: { en: 'Fill in the required fields.', sl: 'Izpolnite obvezna polja.', hr: 'Popunite obavezna polja.' },
      parts: [[['req.missing'], { en: 'empty required fields', sl: 'prazna obvezna polja', hr: 'prazna obavezna polja' }]] },
    { t: { en: 'Merge duplicate records and decide which record is kept; the merge map shows where open documents must point.',
        sl: 'Združite podvojene zapise in določite, kateri zapis ostane; seznam združitev pokaže, na kateri zapis morajo kazati odprti dokumenti.',
        hr: 'Spojite dvostruke zapise i odredite koji zapis ostaje; popis spajanja pokazuje na koji zapis moraju upućivati otvoreni dokumenti.' },
      parts: [[['dup.record'], { en: 'duplicates', sl: 'dvojniki', hr: 'duplikati' }], [['id.dup'], { en: 'codes used more than once', sl: 'večkrat uporabljene šifre', hr: 'šifre korištene više puta' }]] },
    { t: { en: 'Correct VAT IDs and OIBs that cannot exist and check them in VIES or the national business register.',
        sl: 'Popravite identifikacijske številke za DDV in OIB-e, ki ne morejo obstajati, ter jih preverite v sistemu VIES ali v poslovnem registru.',
        hr: 'Ispravite PDV identifikacijske brojeve i OIB-e koji ne mogu postojati te ih provjerite u sustavu VIES ili u sudskom registru.' },
      parts: [[['vat.checksum', 'vat.format', 'oib.invalid', 'vat.country', 'vat.vies'], { en: 'wrong', sl: 'napačne', hr: 'pogrešni' }], [['rec.missing:vat'], { en: 'not filled in', sl: 'niso vpisane', hr: 'nisu upisani' }]] },
    { t: { en: 'Correct the bank details so that payments do not fail.', sl: 'Popravite bančne podatke, da plačila ne bodo zavrnjena.', hr: 'Ispravite bankovne podatke kako plaćanja ne bi bila odbijena.' },
      parts: [[['iban.checksum', 'iban.format', 'bic.format', 'bic.mismatch'], { en: 'wrong IBANs or BICs', sl: 'napačni IBAN-i ali BIC-i', hr: 'pogrešni IBAN-i ili BIC-ovi' }],
        [['iban.local'], { en: 'domestic account numbers to convert to IBAN (automatic)', sl: 'domače številke računov za pretvorbo v IBAN (samodejno)', hr: 'domaći brojevi računa za pretvorbu u IBAN (automatski)' }]] },
    { t: { en: 'Fix contact details so that invoices and reminders arrive.', sl: 'Popravite kontaktne podatke, da bodo računi in opomini prispeli do naslovnikov.', hr: 'Ispravite kontaktne podatke kako bi računi i opomene stigli do primatelja.' },
      parts: [[['email.invalid', 'email.typo', 'email.multi'], { en: 'e-mail addresses', sl: 'e-poštni naslovi', hr: 'adrese e-pošte' }], [['phone.invalid', 'phone.multi'], { en: 'phone numbers', sl: 'telefonske številke', hr: 'brojevi telefona' }]] },
    { t: { en: 'Check the addresses.', sl: 'Preverite naslove.', hr: 'Provjerite adrese.' },
      parts: [[['postal.city', 'postal.format', 'postal.unknown'], { en: 'postal code and city do not match or are malformed', sl: 'poštna številka in kraj se ne ujemata ali sta napačno zapisana', hr: 'poštanski broj i mjesto se ne podudaraju ili su pogrešno napisani' }],
        [['country.unknown'], { en: 'countries not recognised', sl: 'neprepoznane države', hr: 'neprepoznate države' }]] },
    { t: { en: 'Check the product data.', sl: 'Preverite podatke o artiklih.', hr: 'Provjerite podatke o artiklima.' },
      parts: [[['ean.sci', 'ean.checksum', 'ean.format'], { en: 'barcodes to export again as text or correct', sl: 'črtne kode, ki jih je treba ponovno izvoziti kot besedilo ali popraviti', hr: 'barkodovi koje treba ponovno izvesti kao tekst ili ispraviti' }],
        [['price.zero', 'price.negative', 'price.outlier'], { en: 'prices of zero, below zero or far outside the usual range', sl: 'cene, ki so nič, negativne ali močno odstopajo od običajnih', hr: 'cijene koje su nula, negativne ili znatno odstupaju od uobičajenih' }]] },
    { t: { en: 'Correct dates and numbers that cannot be read or look wrong.', sl: 'Popravite datume in števila, ki jih ni mogoče prebrati ali so videti napačni.', hr: 'Ispravite datume i brojeve koje nije moguće pročitati ili izgledaju pogrešno.' },
      parts: [[['date.invalid', 'date.future'], { en: 'dates', sl: 'datumi', hr: 'datumi' }], [['num.invalid', 'vatrate.invalid', 'vatrate.unusual'], { en: 'numbers and VAT rates', sl: 'števila in stopnje DDV', hr: 'brojevi i stope PDV-a' }]] },
    { auto: true, t: { en: 'Apply the automatic fixes for spaces, capitals, broken characters, country codes and phone, number and date formats. They tidy the data without changing what it says.',
        sl: 'Uporabite samodejne popravke presledkov, velikih črk, pokvarjenih znakov, kod držav ter oblik telefonskih številk, števil in datumov. Podatke uredijo, ne da bi spremenili njihov pomen.',
        hr: 'Primijenite automatske ispravke razmaka, velikih slova, oštećenih znakova, kodova država te oblika brojeva telefona, brojeva i datuma. Podatke uređuju bez promjene njihova značenja.' },
      parts: [[null, { en: 'values', sl: 'vrednosti', hr: 'vrijednosti' }]] }
  ];
  function einvName(id, lang) { return rx(lang)((EINV_NAME[id] || { name: id }).name); }
  // what to change in the customer's system so the problems do not come back: [rules that trigger it, en, sl, hr]
  var ERP_FIX = [
    [['vat.checksum', 'vat.format', 'oib.invalid', 'vat.vies', 'vat.country'], 'Check VAT IDs and OIBs when they are entered: the check digit at once, VIES once a month for EU partners.',
      'Preverjanje ID za DDV in OIB ob vnosu: kontrolna številka takoj, VIES enkrat mesečno za partnerje iz EU.', 'Provjera PDV ID-a i OIB-a pri unosu: kontrolna znamenka odmah, VIES jednom mjesečno za partnere iz EU-a.'],
    [['dup.record', 'id.dup', 'vat.dup'], 'Warn about a duplicate when a new partner is created (same VAT ID, e-mail or a similar name), and merge the existing ones with the merge map.',
      'Opozorilo na dvojnik ob vnosu novega partnerja (ista davčna številka, e-pošta ali podoben naziv) in združitev obstoječih po seznamu združitev.', 'Upozorenje na duplikat pri unosu novog partnera (isti PDV ID, e-pošta ili sličan naziv) i spajanje postojećih prema popisu spajanja.'],
    [['postal.city', 'postal.format', 'postal.unknown', 'postal.zero', 'postal.clean', 'req.nocolumn:postal', 'req.nocolumn:street', 'req.missing:postal', 'req.missing:street'], 'Street, postal code and city as separate fields, the postal code chosen from the official list of Pošta Slovenije or Hrvatska pošta and the city filled in from it.',
      'Ulica, poštna številka in kraj kot ločena polja; poštna številka iz uradnega seznama Pošte Slovenije ali Hrvatske pošte, kraj se izpolni sam.', 'Ulica, poštanski broj i mjesto kao zasebna polja; poštanski broj iz službenog popisa Pošte Slovenije ili Hrvatske pošte, a mjesto se popunjava samo.'],
    [['einv'], 'An e-invoice check on every partner record that lists what is missing, well before the e-invoice deadline.',
      'Preverjanje pripravljenosti na e-račune pri vsakem partnerju, s seznamom manjkajočih podatkov, pravočasno pred rokom za e-račune.', 'Provjera spremnosti za e-račune na svakom partneru, s popisom podataka koji nedostaju, na vrijeme prije roka za e-račune.'],
    [['email.invalid', 'email.typo', 'email.multi', 'email.clean', 'rec.missing:email'], 'A field "e-mail for invoices", checked on entry and kept apart from the general contact address.',
      'Polje »e-pošta za račune«, preverjeno ob vnosu in ločeno od splošnega kontaktnega naslova.', 'Polje „e-pošta za račune”, provjereno pri unosu i odvojeno od općenite kontaktne adrese.'],
    [['iban.checksum', 'iban.format', 'iban.local', 'bic.format', 'bic.mismatch'], 'IBAN and BIC checked on entry, and domestic account numbers stored as IBAN.',
      'Preverjanje IBAN in BIC ob vnosu ter domače številke računov shranjene kot IBAN.', 'Provjera IBAN-a i BIC-a pri unosu te domaći brojevi računa spremljeni kao IBAN.'],
    [['req.missing', 'req.nocolumn'], 'Required fields enforced in the entry form, so an incomplete record cannot be saved.',
      'Obvezna polja v vnosnem obrazcu, da nepopolnega zapisa ni mogoče shraniti.', 'Obavezna polja u obrascu za unos, tako da se nepotpun zapis ne može spremiti.'],
    [['text.mojibake', 'text.lost', 'enc'], 'Exports and interfaces in UTF-8, so č, š, ž, ć and đ survive every transfer.',
      'Izvozi in vmesniki v UTF-8, da č, š, ž, ć in đ preživijo vsak prenos.', 'Izvozi i sučelja u UTF-8, kako bi č, š, ž, ć i đ preživjeli svaki prijenos.'],
    [['phone.format', 'phone.invalid', 'phone.multi'], 'Phone numbers stored in international form (+386…, +385…), one per field, so SMS and click-to-call work.',
      'Telefonske številke v mednarodni obliki (+386…, +385…), ena na polje, da delujeta SMS in klic z enim klikom.', 'Brojevi telefona u međunarodnom obliku (+386…, +385…), jedan po polju, kako bi SMS i poziv jednim klikom radili.'],
    [['country.mixed', 'country.code', 'country.unknown'], 'The country chosen from a list of ISO codes instead of typed in.', 'Država izbrana s seznama kod ISO namesto vpisa.', 'Država odabrana s popisa ISO kodova umjesto upisa.'],
    [['ean.sci', 'ean.checksum', 'ean.format', 'ean.zero', 'unit.variant'], 'Barcodes kept as text with the check digit validated, and units of measure from one list.',
      'Črtne kode kot besedilo s preverjeno kontrolno številko in enote mere z enega seznama.', 'Barkodovi kao tekst s provjerenom kontrolnom znamenkom i jedinice mjere s jednog popisa.'],
    [['always'], 'This check as a monthly recipe on the new export, so new problems show up within weeks, not at the next migration.',
      'Ta pregled kot mesečni recept na novem izvozu, da se nove težave pokažejo v nekaj tednih in ne šele ob naslednji selitvi.', 'Ova provjera kao mjesečni recept na novom izvozu, kako bi se novi problemi pokazali za nekoliko tjedana, a ne tek pri sljedećoj migraciji.']
  ];
  function erpFixes(meta, s, lang) {
    var by = {}, out = [], li = lang === 'sl' ? 2 : lang === 'hr' ? 3 : 1;
    s.rules.forEach(function (x) { by[x[0]] = x[2] || x[1]; });
    Object.keys(s.missing || {}).forEach(function (k) { by[k] = s.missing[k]; });
    (s.structure || []).forEach(function (k) { by[k] = 1; });
    if (s.einv && s.einv.pct < 100) by.einv = 1;
    if (meta.read && meta.read.fallback) by.enc = 1;
    by.always = 1;
    ERP_FIX.forEach(function (f) { if (f[0].some(function (k) { return by[k]; })) out.push(f[li]); });
    return out.slice(0, 7);
  }
  function themeCounts(s) {
    var by = {}, miss = s.missing || {}; s.rules.forEach(function (x) { by[x[0]] = x; });
    return function (keys) { var n = 0; keys.forEach(function (k) { if (k.indexOf(':') > 0) { n += miss[k] || 0; return; } var x = by[k]; if (x) n += x[2] || x[1]; }); return n; };
  }
  function pageReport(r) {
    var meta = findCheck(r.id);
    if (!meta) return head(esc(tx('Report')), tx('Check not found'), '') + '<p><a class="btn" href="#/">' + ic('back') + esc(tx('Back')) + '</a></p>';
    if (!cur || cur.id !== r.id) loadCheck(r.id);
    var lang = reportLang(), T = L[lang], s = meta.summary, d = cur && cur.id === r.id ? cur.data : null, res = cur && cur.id === r.id ? cur.res : null;
    var tools = '<div class="report-tools no-print"><a class="btn" href="#/check/' + esc(meta.id) + '">' + ic('back') + esc(tx('Back to the check')) + '</a><div class="seg" role="group" aria-label="' + esc(tx('Report language')) + '">' +
      Object.keys(L).map(function (k) { return '<button type="button" data-act="rlang" data-v="' + k + '" aria-pressed="' + (k === lang) + '" lang="' + k + '">' + L[k].lang + '</button>'; }).join('') + '</div>' +
      '<div class="field pf"><label for="rFor">' + esc(tx('Prepared for')) + '</label><input class="in" id="rFor" data-chg="rfor" maxlength="120" value="' + esc(meta.preparedFor || db.settings.preparedFor) + '" placeholder="' + esc(tx('Company name')) + '"></div>' +
      '<button type="button" class="btn pri" data-act="print">' + ic('print') + esc(tx('Print or save as PDF')) + '</button></div>';
    if (cur && cur.id === r.id && (cur.loading || (cur.data && !cur.res))) return tools + '<p class="loading" role="status"><i aria-hidden="true"></i>' + esc(tx('Preparing the report…')) + '</p>';
    if (!s) return tools + '<p class="empty">' + esc(tx('This file has not been checked yet.')) + '</p>';
    var band = E.scoreBand(s.score), rows = meta.rows, cnt = themeCounts(s);
    var h = tools + '<article class="report" lang="' + lang + '"><header class="rp-head"><div><span class="rp-brand"><i aria-hidden="true"></i>Clearfigure</span><h1>' + esc(T.title) + '</h1></div>' +
      '<dl class="rp-meta"><div><dt>' + T.for + '</dt><dd>' + esc(meta.preparedFor || db.settings.preparedFor || '—') + '</dd></div><div><dt>' + T.by + '</dt><dd>' + esc(db.settings.preparedBy || '—') + '</dd></div>' +
      '<div><dt>' + T.date + '</dt><dd>' + dateLang(meta.checkedAt || new Date().toISOString(), lang) + '</dd></div><div><dt>' + T.file + '</dt><dd>' + esc(meta.name) + '</dd></div>' +
      '<div><dt>' + T.contents + '</dt><dd>' + esc(T.types[meta.type] || meta.type) + '</dd></div><div><dt>' + T.records + ' · ' + T.columns + '</dt><dd>' + n0(rows) + ' · ' + n0(meta.cols) + '</dd></div>' +
      (meta.recipe ? '<div><dt>' + T.recipe + '</dt><dd>' + esc(meta.recipe) + '</dd></div>' : '') + '</dl></header>';
    h += '<section class="rp-score">' + ring(s.score, band, T.score + ': ' + s.score + ' ' + T.of100, T.of100) + '<div><span class="label">' + esc(T.score) + '</span><p class="rp-band ' + band + '">' + esc(T.band[band]) + '</p>' +
      '<p>' + esc(fill(T.split, { e: n0(s.rowsErr), w: n0(s.rowsWarn), c: n0(s.rowsClean) })) + '</p>' + (s.scoreAfter > s.score ? '<p>' + esc(fill(T.after, { n: s.scoreAfter })) + '</p>' : '') +
      (meta.first && meta.first.score !== s.score ? '<p class="rp-since"><b>' + esc(fill(T.since, { d: dateLang(meta.first.at, lang), a: meta.first.score, b: s.score })) + '</b></p>' : '') +
      '<p class="rp-small">' + esc(T.how) + '</p></div></section>';
    var struct = s.structure || [];
    if (struct.length) h += '<section class="rp-sec"><h2>' + esc(T.missing) + '</h2><p>' + struct.map(function (x) { var p = x.split(':'); return esc(roleNameL(p[1], lang)) + ' (' + (p[0] === 'req.nocolumn' ? T.required : T.recommended) + ')'; }).join(', ') + '</p></section>';
    var fixes = [];
    THEMES.forEach(function (th) {
      var parts = th.parts.map(function (p) { return [p[1][lang], p[0] ? cnt(p[0]) : s.fixable]; }).filter(function (p) { return p[1] > 0; });
      if (!parts.length) return;
      var list = parts.map(function (p) { return p[0] + ': ' + n0(p[1]); }).join('; ');
      fixes.push(th.t[lang] + ' ' + list.charAt(0).toUpperCase() + list.slice(1) + '.');
    });
    h += '<section class="rp-sec rp-fix"><h2>' + esc(T.fix) + '</h2>' + (fixes.length ? '<ol>' + fixes.map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') + '</ol>' : '<p>' + esc(T.none) + '</p>') + '</section>';
    var list = s.rules.filter(function (x) { return E.RULES[x[0]]; });
    h += '<section class="rp-sec"><h2>' + esc(T.problems) + '</h2>' + (list.length ? '<table class="rp-t"><thead><tr><th>' + T.problem + '</th><th>' + T.severity + '</th><th class="num">' + T.recs + '</th><th class="num">' + T.share + '</th><th>' + T.auto + '</th></tr></thead><tbody>' +
      list.map(function (x) {
        var R = E.RULES[x[0]];
        return '<tr><td>' + esc(ruleTitle(x[0], lang)) + '</td><td><span class="sevdot ' + R.sev + '" aria-hidden="true"></span>' + esc(T.sev[R.sev]) + '</td><td class="num">' + (x[2] ? n0(x[2]) : '—') + '</td><td class="num">' + (x[2] ? pct(x[2], rows) : '—') + '</td><td>' + (x[3] ? esc(T.yes) : '—') + '</td></tr>';
      }).join('') + '</tbody></table>' : '<p>' + esc(T.none) + '</p>') + '</section>';
    h += '<section class="rp-sec"><h2>' + esc(T.dups) + '</h2><dl class="rp-dl"><div><dt>' + T.dupGroups + '</dt><dd>' + n0(s.groups) + '</dd></div><div><dt>' + T.dupRecords + '</dt><dd>' + n0(s.groups + s.dupRows) + '</dd></div><div><dt>' + T.dupMerge + '</dt><dd>' + n0(s.dupRows) + '</dd></div></dl>';
    if (res && d && res.groups.length) {
      h += '<h3>' + esc(T.dupTop) + '</h3><ul class="rp-groups">' + res.groups.slice().sort(function (a, b) { return b.rows.length - a.rows.length || b.score - a.score; }).slice(0, 5).map(function (g) {
        return '<li>' + g.rows.map(function (r) { return '<span>' + esc(cut(recordName(d, res, r), 60)) + '</span>'; }).join('') + '</li>';
      }).join('') + '</ul>';
    } else if (!s.groups) h += '<p>' + esc(T.noDup) + '</p>';
    h += '</section>';
    if (s.einv) {
      var e = s.einv;
      h += '<section class="rp-sec rp-einv"><h2>' + esc(T.einv) + '</h2><p><b>' + esc(fill(T.einvLead, { p: e.pct, r: n0(e.ready), n: n0(e.rows) })) + '</b>' +
        (meta.first && meta.first.einv != null && meta.first.einv !== e.pct ? ' ' + esc(fill(T.einvSince, { a: meta.first.einv, b: e.pct })) : '') + '</p>' +
        '<table class="rp-t"><thead><tr><th>' + esc(T.einvField) + '</th><th class="num">' + esc(T.einvMiss) + '</th><th class="num">' + esc(T.einvFor) + '</th><th class="num">' + esc(T.share) + '</th></tr></thead><tbody>' +
        e.crit.map(function (c) { return '<tr><td>' + esc(einvName(c[0], lang)) + '</td><td class="num">' + n0(c[1]) + '</td><td class="num">' + n0(c[2]) + '</td><td class="num">' + pct(c[2] - c[1], c[2]) + '</td></tr>'; }).join('') +
        '</tbody></table><p class="rp-small">' + esc(T.einvHow) + '</p>' +
        (s.vies && (s.vies.valid || s.vies.invalid) ? '<p>' + esc(fill(T.vies, { v: n0(s.vies.valid), i: n0(s.vies.invalid), u: n0(s.vies.unavailable), t: n0(s.vies.total) })) + '</p>' : '') + '</section>';
    }
    if (res && d) {
      var top = list.filter(function (x) { return x[2] && E.RULES[x[0]].sev !== 'info'; }).slice(0, 10);
      if (top.length) h += '<section class="rp-sec rp-ex"><h2>' + esc(T.examples) + '</h2>' + top.map(function (x) {
        var o = res.rules[x[0]]; if (!o) return '';
        return '<h3>' + esc(ruleTitle(x[0], lang)) + '</h3><table class="rp-t"><thead><tr><th>' + T.row + '</th><th>' + T.record + '</th><th>' + T.field + '</th><th>' + T.value + '</th><th>' + T.suggested + '</th></tr></thead><tbody>' +
          o.first.slice(0, 5).map(function (i) {
            var fix = i.f !== undefined ? i.f : i.s;
            return '<tr><td class="mono">' + d.lines[i.r] + '</td><td>' + esc(cut(recordName(d, res, i.r), 44)) + '</td><td>' + esc(d.headers[i.c]) + '</td><td class="val">' + showWs(d.rows[i.r][i.c], 50) + '</td><td class="val">' + (fix !== undefined ? showWs(fix, 50) : '—') + '</td></tr>';
          }).join('') + '</tbody></table>';
      }).join('') + '</section>';
    } else h += '<p class="rp-small">' + esc(T.noData) + '</p>';
    var book = safeUrl(db.settings.bookingUrl);
    h += '<section class="rp-sec rp-erp"><h2>' + esc(T.erp) + '</h2><p>' + esc(T.erpLead) + '</p><ul>' + erpFixes(meta, s, lang).map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') + '</ul>' +
      (book ? '<p class="rp-book"><a class="btn pri" href="' + esc(book) + '" target="_blank" rel="noopener">' + esc(T.book) + '</a><span class="rp-url">' + esc(book) + '</span></p>' : '') + '</section>';
    h += '<footer class="rp-foot">' + esc(fill(T.footer, { d: dateLang(meta.checkedAt || new Date().toISOString(), lang) })) + '</footer></article>';
    return h;
  }

  // ── page: settings ───────────────────────────────────────────────────────
  var REQ_ROLES = ['id', 'sku', 'name', 'street', 'postal', 'city', 'country', 'vat', 'oib', 'regno', 'phone', 'email', 'website', 'iban', 'bic', 'ean', 'unit', 'price', 'vatrate', 'date'];
  function pageSettings() {
    var s = db.settings;
    var h = head(esc(tx('Data health check')), tx('Settings'), esc(tx('Rules, report header and what this browser keeps. Rates and rules are defaults to check, not legal or tax advice.')));
    h += '<section class="card pad lang-card"><div class="split"><div><span class="label">' + esc(tx('This browser')) + '</span><h2>' + esc(tx('Screen language')) + '</h2></div>' +
      '<div class="seg" role="group" aria-label="' + esc(tx('Screen language')) + '">' + [['en', 'English'], ['sl', 'Slovenščina'], ['hr', 'Hrvatski']].map(function (o) {
        return '<button type="button" data-act="uilang" data-v="' + o[0] + '" lang="' + o[0] + '" aria-pressed="' + (LANG === o[0]) + '">' + o[1] + '</button>';
      }).join('') + '</div></div><p class="hint">' + esc(tx('The language of the screens and, unless you choose another one below, of the printable report.')) + '</p></section>';
    h += '<form class="card" id="reqForm"><div class="card-h"><div><span class="label">' + esc(tx('Per type of file')) + '</span><h2>' + esc(tx('Required and recommended fields')) + '</h2></div></div><div class="tw"><table class="t compact req"><thead><tr><th>' + esc(tx('Field')) + '</th>' +
      E.TYPES.map(function (t) { return '<th>' + esc(lx(t.name)) + '</th>'; }).join('') + '</tr></thead><tbody>' + REQ_ROLES.map(function (rid) {
        return '<tr><th scope="row">' + esc(roleName(rid)) + '</th>' + E.TYPES.map(function (t) {
          var q = s.req[t.id], v = q.required.indexOf(rid) >= 0 ? 'req' : q.recommended.indexOf(rid) >= 0 ? 'rec' : '';
          return '<td><label class="sr" for="rq-' + t.id + '-' + rid + '">' + esc(tx('{field} for {type}', { field: roleName(rid), type: lx(t.name) })) + '</label><select class="in sm" id="rq-' + t.id + '-' + rid + '" data-t="' + t.id + '" data-r="' + rid + '">' +
            '<option value=""' + (v ? '' : ' selected') + '>—</option><option value="req"' + (v === 'req' ? ' selected' : '') + '>' + esc(tx('Required')) + '</option><option value="rec"' + (v === 'rec' ? ' selected' : '') + '>' + esc(tx('Recommended')) + '</option></select></td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody></table></div><div class="card-b"><p class="hint">' + esc(tx('An empty required field is an error, an empty recommended field a warning. A missing column is listed separately.')) + '</p>' +
      '<div class="dr-actions"><button type="submit" class="btn pri">' + esc(tx('Save fields')) + '</button><button type="button" class="btn ghost" data-act="reqreset">' + esc(tx('Back to the defaults')) + '</button></div></div></form>';
    h += '<div class="grid2"><form class="card pad" id="ruleForm"><span class="label">' + esc(tx('Checks')) + '</span><h2>' + esc(tx('Rules')) + '</h2>' +
      '<div class="field"><label for="sHome">' + esc(tx('Home country')) + '</label><select class="in" id="sHome"><option value="SI"' + (s.home === 'SI' ? ' selected' : '') + '>' + esc(tx('Slovenia')) + '</option><option value="HR"' + (s.home === 'HR' ? ' selected' : '') + '>' + esc(tx('Croatia')) + '</option></select>' +
      '<small class="hint">' + esc(tx('Used for values without a country: 041 123 456, a tax number without SI, VAT rates of products.')) + '</small></div>' +
      '<div class="field"><label for="sThr">' + esc(tx('Duplicate threshold for new checks')) + ' <b id="sThrV">' + s.dupThreshold + '</b></label><input type="range" id="sThr" min="' + E.MIN_PAIR + '" max="100" value="' + s.dupThreshold + '" data-inp="sThrV"></div>' +
      '<div class="row2"><div class="field"><label for="sRateSI">' + esc(tx('VAT rates, Slovenia (%)')) + '</label><input class="in" id="sRateSI" value="' + esc(s.vatRates.SI.map(fmtRate).join('; ')) + '"></div>' +
      '<div class="field"><label for="sRateHR">' + esc(tx('VAT rates, Croatia (%)')) + '</label><input class="in" id="sRateHR" value="' + esc(s.vatRates.HR.map(fmtRate).join('; ')) + '"></div></div>' +
      '<p class="hint">' + esc(tx('Defaults to check: Slovenia 22 %, 9,5 % and 5 %; Croatia 25 %, 13 % and 5 %. A product with any other rate is flagged as a warning; add 0 if you sell exempt goods.')) + '</p>' +
      '<div class="err" id="ruleErr" hidden></div><div class="dr-actions"><button type="submit" class="btn pri">' + esc(tx('Save rules')) + '</button></div></form>';
    h += '<form class="card pad" id="repForm"><span class="label">' + esc(tx('Printable report')) + '</span><h2>' + esc(tx('Report header')) + '</h2>' +
      '<div class="field"><label for="sBy">' + esc(tx('Prepared by')) + '</label><input class="in" id="sBy" maxlength="120" value="' + esc(s.preparedBy) + '"></div>' +
      '<div class="field"><label for="sFor">' + esc(tx('Prepared for (default; each report can change it)')) + '</label><input class="in" id="sFor" maxlength="120" value="' + esc(s.preparedFor) + '"></div>' +
      '<div class="field"><label for="sLang">' + esc(tx('Report language')) + '</label><select class="in" id="sLang"><option value=""' + (L[s.reportLang] ? '' : ' selected') + '>' + esc(tx('Same as the screens')) + '</option>' + Object.keys(L).map(function (k) { return '<option value="' + k + '" lang="' + k + '"' + (s.reportLang === k ? ' selected' : '') + '>' + L[k].lang + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label for="sBook">' + esc(tx('Booking link (ends the report; empty = no link)')) + '</label><input class="in" id="sBook" type="url" inputmode="url" maxlength="300" placeholder="https://…" value="' + esc(s.bookingUrl) + '"><small class="hint">' + esc(tx('For example a Microsoft Bookings or Cal.com page. Only https links.')) + '</small></div>' +
      '<div class="err" id="repErr" hidden></div><div class="dr-actions"><button type="submit" class="btn pri">' + esc(tx('Save header')) + '</button></div></form></div>';
    h += '<section class="card"><div class="card-h"><div><span class="label">' + esc(tx('Same mapping and fixes every month')) + '</span><h2>' + esc(tx('Recipes')) + '</h2></div></div>' + ((db.recipes || []).length ? '<ul class="list rcp-list">' + db.recipes.map(function (rc) {
      return '<li><div class="l"><b>' + esc(rc.name) + '</b><small>' + esc(typeName(rc.type) + ' · ' + plural(rc.cols.length, 'column', 'columns') + ' · ' + plural(rc.rules.length, 'kind of fix', 'kinds of fix') + ' · ' + tx('saved {date}', { date: dt(rc.createdAt) })) + '</small></div><div class="r">' +
        '<button type="button" class="btn icon sm ghost" data-act="rcpdel" data-v="' + esc(rc.id) + '" aria-label="' + esc(tx('Delete recipe {name}', { name: rc.name })) + '">' + ic('trash') + '</button></div></li>';
    }).join('') + '</ul>' : '<p class="empty">' + esc(tx('No recipes yet. Open a check, then Recipe → Save this check as a recipe.')) + '</p>') + '</section>';
    h += '<div class="grid2"><section class="card pad"><span class="label">' + esc(tx('Privacy')) + '</span><h2>' + esc(tx('What this browser keeps')) + '</h2>' +
      '<label class="switch"><input type="checkbox" data-chg="keep"' + (s.keepFiles ? ' checked' : '') + '> ' + esc(tx('Keep files in this browser')) + '</label>' +
      '<p class="sub">' + esc(tx(s.keepFiles ? 'On: each check keeps its rows, fixes and decisions in this browser (IndexedDB), so you can come back to it.' : 'Off: only the summary of each check (file name, rows, score, counts) is kept. The rows are gone when you close or reload the page.')) + '</p>' +
      '<p class="hint" id="storeUse"></p><div class="dr-actions"><button type="button" class="btn danger" data-act="delall"' + (db.checks.length ? '' : ' disabled') + '>' + esc(tx('Delete all checks')) + '</button><button type="button" class="btn" data-act="resetdemo">' + esc(tx('Reset demo data')) + '</button></div></section>';
    h += '<section class="card pad"><span class="label">' + esc(tx('Across your devices')) + '</span><h2>' + esc(tx('Cloud sync')) + '</h2><div id="syncPanel" class="sync-panel"></div>' +
      '<p class="hint">' + esc(tx('Sync copies your settings and the list of checks with their scores and counts. The files and their rows (names, addresses, VAT IDs…) never leave this browser.')) + '</p></section></div>';
    return h;
  }
  function fmtRate(n) { return String(n).replace('.', ','); }
  function parseRates(s) {
    var out = [], bad = false;
    String(s).split(/[;\s]+/).filter(Boolean).forEach(function (p) { var n = E.parseNumber(p.replace('%', ''), ','); if (n.ok && n.n >= 0 && n.n <= 50) out.push(n.n); else bad = true; });
    return bad || !out.length ? null : out;
  }

  // ── render ───────────────────────────────────────────────────────────────
  var lastKey = null, panelOff = null;
  function render() {
    if (!db) return;
    var r = route(), y = window.scrollY, key = r.page + '|' + (r.id || '') + '|' + (r.tab || '');
    renderNav(r);
    if (panelOff) { try { panelOff(); } catch (e) { /* gone */ } panelOff = null; }
    var html = r.page === 'check' ? pageCheck(r) : r.page === 'report' ? pageReport(r) : r.page === 'settings' ? pageSettings() : pageStart();
    $('main').innerHTML = '<div class="page' + (r.page === 'report' ? ' page-report' : '') + '">' + html + '</div>';
    if (key !== lastKey) {
      window.scrollTo(0, 0);
      var h1 = $('main').querySelector('h1'); if (h1 && lastKey !== null) h1.focus({ preventScroll: true });
      if (r.page === 'check' && r.tab === 'issues' && r.sub) { var el = document.getElementById('rule-' + r.sub); if (el) el.scrollIntoView({ block: 'start' }); }
    } else window.scrollTo(0, y);
    lastKey = key;
    if (r.page === 'settings') {
      var p = $('syncPanel');
      if (p) { if (SYNC) panelOff = SYNC.mountPanel(p); else p.innerHTML = '<p class="hint">' + esc(tx('Cloud sync is not available on this page.')) + '</p>'; }
      storageUse();
    }
    var meta = (r.page === 'check' || r.page === 'report') && findCheck(r.id);
    document.title = (meta ? (r.page === 'report' ? tx('Report') + ' · ' : '') + meta.name + ' — ' : r.page === 'settings' ? tx('Settings') + ' — ' : '') + tx('Data health check') + ' — Business Apps';
  }
  function storageUse() {
    var el = $('storeUse'); if (!el || !navigator.storage || !navigator.storage.estimate) return;
    navigator.storage.estimate().then(function (e) { if (el.isConnected && e && e.usage != null) el.textContent = tx('This site uses about {n} MB of browser storage.', { n: nf0.format(Math.max(1, Math.round(e.usage / 1048576))) }); }).catch(function () {});
  }
  window.addEventListener('hashchange', function () { closeLayer(); $('side').classList.remove('open'); $('menuBtn').setAttribute('aria-expanded', 'false'); render(); });

  // ── events ───────────────────────────────────────────────────────────────
  var ACT = {
    close: function () { closeLayer(); },
    pick: function () { $('filePick').value = ''; $('filePick').click(); },
    demo: function (v) { openDemo(v); },
    paste: function () {
      var t = $('pasteIn').value;
      if (!t.trim()) return toast(tx('Paste some rows first.'));
      importText(t, tx('Pasted rows {date}', { date: dtTime(new Date().toISOString()) }), 'paste', { encoding: '' }).catch(readFailed);
    },
    open: function (v) { location.hash = '#/check/' + v; },
    del: function (v) {
      var m = findCheck(v); if (!m) return;
      confirmBox(tx('Delete this check?'), tx(window.StratumSync && StratumSync.user() ? '{name} and its rows, fixes and decisions are removed from this browser and from your cloud copy. The original file is not touched.' : '{name} and its rows, fixes and decisions are removed from this browser. The original file is not touched.', { name: I.q(m.name, true) }), tx('Delete'), function () {
        db.checks = db.checks.filter(function (c) { return c.id !== v; });
        delete tables[v]; delete raw[v]; delete stored[v];
        if (cur && cur.id === v) cur = null;
        save(true, v); render(); toast(tx('Check deleted'));
      }, true);
    },
    undo: function () { undo(); },
    type: function (v) {
      if (!cur || !cur.data || cur.meta.type === v) return;
      cur.meta.type = v; cur.data.roles = E.rolesForType(cur.data.roles, v);
      save(true, cur.id); analyse({ byPerson: true }); toast(tx('Checked as {type}', { type: typeName(v).toLowerCase() }));
    },
    sev: function (v) { ui.sev = v; saveUi(); render(); },
    rule: function (v) { view.open[v] = !view.open[v]; render(); var b = document.querySelector('[data-act="rule"][data-v="' + CSS.escape(v) + '"]'); if (b) b.focus(); },
    fixall: function (v) { if (cur && cur.res) fixPreview(v); },
    fixview: function () { fixEverything(); },
    showall: function () { view.fixOnly = false; ui.sev = 'all'; saveUi(); render(); },
    einvrows: function () { view.rowsF = 'einv'; view.rowsPage = 0; location.hash = '#/check/' + cur.id + '/rows'; },
    vies: function () { viesConsent(); },
    viesstop: function () { if (viesRun) { viesRun.stop = true; var el = $('viesProg'); if (el) el.textContent = tx('Stopping…'); } },
    recipes: function () { recipeDialog(); },
    rcpapply: function (v) { applyRecipe(v); },
    rcphide: function () { view.recipeHidden = true; render(); },
    rcpdel: function (v) {
      var rc = (db.recipes || []).filter(function (x) { return x.id === v; })[0]; if (!rc) return;
      confirmBox(tx('Delete this recipe?'), tx('{name} is removed. Checks it was applied to keep their changes.', { name: I.q(rc.name, true) }), tx('Delete'), function () {
        db.recipes = db.recipes.filter(function (x) { return x.id !== v; }); save(true); render(); toast(tx('Recipe deleted'));
      }, true);
    },
    erpdemo: function () { openErpDemo(); },
    useone: function (v, el) {
      var r = +el.getAttribute('data-r'), c = +el.getAttribute('data-c'), k = el.getAttribute('data-k');
      var x = cur.res.issues.filter(function (i) { return i.r === r && i.c === c && i.k === k; })[0]; if (!x) return;
      commitChanges(E.RULES[k].title + ' fixed in row ' + cur.data.lines[r], [{ r: r, c: c, v: x.f !== undefined ? x.f : x.s }]); // stored in English, shown through histLabel()
    },
    row: function (v) { openRow(+v); },
    rowsrule: function (v) { view.rowsF = 'rule:' + v; view.rowsPage = 0; location.hash = '#/check/' + cur.id + '/rows'; },
    page: function (v) { view.rowsPage = Math.max(0, view.rowsPage + +v); render(); var t = $('main').querySelector('.rows-wrap'); if (t) t.scrollTop = 0; },
    duppage: function (v) { view.dupPage = Math.max(0, view.dupPage + +v); render(); },
    usefield: function (v, el) { var c = el.getAttribute('data-c'), inp = $('rf-' + c); if (inp) { inp.value = v; inp.focus(); } },
    saverow: function (v) {
      var r = +v, d = cur.data, ch = [];
      $('layers').querySelectorAll('#rowForm input[data-c], #rowForm textarea[data-c]').forEach(function (inp) { var c = +inp.getAttribute('data-c'); if (inp.value !== d.rows[r][c]) ch.push({ r: r, c: c, v: inp.value }); });
      closeLayer();
      if (ch.length) commitChanges('Row ' + d.lines[r] + ' edited', ch);
    },
    notdup: function (v) {
      var g = cur.res.groups[+v]; if (!g) return;
      g.rows.forEach(function (a) { g.rows.forEach(function (b) { if (a < b) cur.data.notDup[a + ':' + b] = 1; }); });
      g.rows.forEach(function (r) { delete cur.data.survivors[r]; });
      regroup(); toast(tx('Marked as not duplicates'));
    },
    dupreset: function () { cur.data.survivors = {}; cur.data.notDup = {}; regroup(); toast(tx('Duplicate decisions reset')); },
    gocol: function (v) { location.hash = '#/check/' + cur.id + '/columns'; setTimeout(function () { var el = $('col-' + v); if (el) { el.scrollIntoView({ block: 'start' }); el.classList.add('flash'); } }, 50); },
    reread: function () { rereadDialog(); },
    expdelim: function (v) { ui.exp.delim = v === 'tab' ? '\t' : v; saveUi(); render(); },
    dlclean: function () { dlClean(false); }, dldedup: function () { dlClean(true); }, dlissues: function () { dlIssues(); }, dlmap: function () { dlMap(); },
    rlang: function (v) { if (!L[v]) return; db.settings.reportLang = v; db.settings.reportLangSet = true; save(true); render(); },
    uilang: function (v) { setLang(v); },
    print: function () { window.print(); },
    reqreset: function () {
      var def = defaultSettings();
      db.settings.req = def.req; save(true); if (cur) cur.res = null; cur = null; render(); toast(tx('Fields back to the defaults'));
    },
    delall: function () {
      confirmBox(tx('Delete all checks?'), tx(window.StratumSync && StratumSync.user() ? 'Every check in this browser is removed, with its rows, fixes and decisions, and the list in your cloud copy is emptied. The original files are not touched.' : 'Every check in this browser is removed, with its rows, fixes and decisions. The original files are not touched.'), tx('Delete all'), function () {
        db.checks = []; tables = {}; raw = {}; stored = {}; cur = null; db.seeded = true;
        if (idbOK) enqueue(tClear);
        save(true); render(); toast(tx('All checks deleted'));
      }, true);
    },
    resetdemo: function () {
      confirmBox(tx('Reset demo data?'), tx('The three demo checks are created again from the original demo files, without your fixes and decisions. Your own checks stay.'), tx('Reset demo data'), function () {
        var ids = db.checks.filter(function (c) { return c.demo; }).map(function (c) { return c.id; });
        db.checks = db.checks.filter(function (c) { return !c.demo; });
        ids.forEach(function (id) { delete tables[id]; delete raw[id]; delete stored[id]; dirty[id] = 1; });
        if (cur && ids.indexOf(cur.id) >= 0) cur = null;
        save(false);
        location.hash = '#/';
        seedDemos().then(function () { toast(tx('Demo data reset')); render(); });
      });
    }
  };
  function rereadDialog() {
    var meta = cur.meta, rd = meta.read || {};
    modal(tx('Change how the file is read'), '<p>' + esc(tx('Reading the file again replaces its rows and drops your fixes, edits and duplicate decisions for it.')) + '</p>' +
      '<div class="field"><label for="rrEnc">' + esc(tx('Text encoding')) + '</label><select class="in" id="rrEnc">' + E.ENCODINGS.map(function (e) { return '<option value="' + e[0] + '"' + (rd.encoding === e[0] ? ' selected' : '') + '>' + esc(lx(e[1])) + '</option>'; }).join('') + '</select></div>' +
      '<div class="row2"><div class="field"><label for="rrDel">' + esc(tx('Delimiter')) + '</label><select class="in" id="rrDel">' + E.DELIMS.map(function (d) { return '<option value="' + (d === '\t' ? 'tab' : esc(d)) + '"' + (rd.delim === d ? ' selected' : '') + '>' + esc(tx(E.delimName(d))) + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label for="rrHdr">' + esc(tx('Header row')) + '</label><select class="in" id="rrHdr"><option value="auto">' + esc(tx('Find it automatically')) + '</option><option value="none">' + esc(tx('No header row')) + '</option>' +
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(function (n) { return '<option value="' + n + '">' + esc(tx('Record {n}', { n: n })) + '</option>'; }).join('') + '</select></div></div>' +
      '<p class="hint">' + esc(tx('Records are counted without empty lines.')) + '</p>', tx('Read again'), function () {
      var enc = $('rrEnc').value, dl = $('rrDel').value, hd = $('rrHdr').value;
      var bytes = raw[meta.id] || (meta.demo ? X.file(meta.demo, TODAY).bytes : null);
      if (!bytes) return modalError(tx('The original file is no longer in memory. Open it again.'));
      closeLayer();
      importBytes(bytes, meta.name, meta.kind, { encoding: enc, delim: dl === 'tab' ? '\t' : dl, header: hd === 'auto' ? null : hd === 'none' ? -1 : +hd - 1, into: meta.id })
        .then(function () { toast(tx('Read again as {enc}', { enc: encName(enc) })); }, readFailed);
    });
  }
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]'); if (!el) return;
    var act = el.getAttribute('data-act'); if (!ACT[act]) return;
    if (el.tagName === 'A' && act !== 'close') e.preventDefault();
    if (el.tagName === 'TR' && e.target.closest('a, button, input, select, label') && e.target.closest('[data-act]') !== el) return;
    ACT[act](el.getAttribute('data-v'), el, e);
  });
  document.addEventListener('keydown', function (e) {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('tr[data-act]')) { e.preventDefault(); e.target.click(); }
  });
  document.addEventListener('submit', function (e) {
    var f = e.target;
    if (f.id === 'mdForm') { e.preventDefault(); modalError(''); if (modalSubmit) modalSubmit(); return; }
    if (f.id === 'reqForm') {
      e.preventDefault();
      E.TYPES.forEach(function (t) {
        var q = { required: [], recommended: [] };
        f.querySelectorAll('select[data-t="' + t.id + '"]').forEach(function (s) { if (s.value === 'req') q.required.push(s.getAttribute('data-r')); else if (s.value === 'rec') q.recommended.push(s.getAttribute('data-r')); });
        db.settings.req[t.id] = q;
      });
      save(true); cur = null; toast(tx('Fields saved. Checks use them the next time you open them.'));
    }
    if (f.id === 'ruleForm') {
      e.preventDefault();
      var si = parseRates($('sRateSI').value), hr = parseRates($('sRateHR').value), err = $('ruleErr');
      if (!si || !hr) { err.hidden = false; err.textContent = tx('Write the rates as numbers separated by semicolons, for example 22; 9,5; 5.'); return; }
      err.hidden = true;
      db.settings.home = $('sHome').value; db.settings.dupThreshold = +$('sThr').value; db.settings.vatRates = { SI: si, HR: hr };
      save(true); cur = null; render(); toast(tx('Rules saved'));
    }
    if (f.id === 'repForm') {
      e.preventDefault();
      var bk = $('sBook').value.trim(), re = $('repErr');
      if (bk && !safeUrl(bk)) { re.hidden = false; re.textContent = tx('Write the booking link as a full https address, for example https://cal.com/your-name/20min.'); return; }
      re.hidden = true;
      var rl = L[$('sLang').value] ? $('sLang').value : '';
      if (rl !== db.settings.reportLang) { db.settings.reportLang = rl; db.settings.reportLangSet = !!rl; }
      db.settings.preparedBy = $('sBy').value.trim(); db.settings.preparedFor = $('sFor').value.trim(); db.settings.bookingUrl = safeUrl(bk);
      save(true); toast(tx('Report header saved'));
    }
  });
  var qT = null;
  document.addEventListener('input', function (e) {
    var t = e.target, k = t.getAttribute && t.getAttribute('data-inp');
    if (!k) return;
    if (k === 'rowsQ') {
      clearTimeout(qT); qT = setTimeout(function () {
        view.rowsQ = t.value; view.rowsPage = 0; render();
        var n = $('rowsQ'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); }
      }, 250);
    } else { var out = $(k); if (out) out.textContent = t.value; }
  });
  document.addEventListener('change', function (e) {
    var t = e.target, k = t.getAttribute && t.getAttribute('data-chg');
    if (t.id === 'filePick' && t.files && t.files[0]) { importFile(t.files[0]); return; }
    if (t.id === 'uiLang') { setLang(t.value); return; }
    if (!k) return;
    if (k === 'role') {
      var c = +t.getAttribute('data-c');
      cur.data.roles[c] = t.value; cur.data.roleSrc[c] = 'you';
      save(true, cur.id); analyse({ byPerson: true }); toast(tx('{column} is now checked as {role}', { column: cur.data.headers[c], role: roleName(t.value) }));
    } else if (k === 'unit') {
      cur.data.unitTarget = t.value; save(true, cur.id); analyse({ byPerson: true, reuseDup: cur.res && cur.res.dup });
    } else if (k === 'fixonly') { view.fixOnly = t.checked; render(); }
    else if (k === 'rowsF') { view.rowsF = t.value; view.rowsPage = 0; render(); var s = $('rowsF'); if (s) s.focus(); }
    else if (k === 'thr') { cur.data.dupThreshold = +t.value; view.dupPage = 0; regroup(); var th = $('thr'); if (th) th.focus(); }
    else if (k === 'survivor') {
      var g = cur.res.groups[+t.getAttribute('data-g')]; if (!g) return;
      g.rows.forEach(function (r) { delete cur.data.survivors[r]; });
      cur.data.survivors[+t.value] = 1; regroup();
    } else if (k === 'exp') { ui.exp[t.getAttribute('data-k')] = t.checked; saveUi(); }
    else if (k === 'expdec') { ui.exp.dec = t.value; saveUi(); }
    else if (k === 'rfor') { var m = findCheck(route().id); if (m) { m.preparedFor = t.value.trim(); save(true); render(); } }
    else if (k === 'keep') {
      var on = t.checked;
      if (!on) {
        t.checked = true;
        confirmBox(tx('Stop keeping files?'), tx('The rows of every check are removed from this browser. Their summaries stay, and the files you open from now on are kept only until you close the page.'), tx('Stop keeping files'), function () {
          db.settings.keepFiles = false; stored = {};
          if (idbOK) enqueue(tClear);
          save(true); render(); toast(tx('Files are no longer kept in this browser'));
        }, true);
      } else {
        db.settings.keepFiles = true;
        Object.keys(tables).forEach(function (id) { if (findCheck(id)) { dirty[id] = 1; stored[id] = true; } });
        save(true); render(); toast(tx('Files are kept in this browser'));
      }
    }
  });
  $('menuBtn').addEventListener('click', function () { var s = $('side'), open = !s.classList.contains('open'); s.classList.toggle('open', open); this.setAttribute('aria-expanded', String(open)); });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && todayLj() !== TODAY) TODAY = todayLj(); });

  // drag and drop anywhere on the page
  var dragDepth = 0;
  function hasFiles(e) { var t = e.dataTransfer && e.dataTransfer.types; return !!t && Array.prototype.indexOf.call(t, 'Files') >= 0; }
  document.addEventListener('dragenter', function (e) { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; $('dropzone').hidden = false; });
  document.addEventListener('dragover', function (e) { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  document.addEventListener('dragleave', function (e) { if (!hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('dropzone').hidden = true; });
  document.addEventListener('drop', function (e) {
    if (!hasFiles(e)) return;
    e.preventDefault(); dragDepth = 0; $('dropzone').hidden = true;
    var f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) importFile(f);
  });

  // ── cloud sync: settings and check summaries only, never the rows ───────
  var SYNC = null;
  function syncChanged() { if (SYNC && !applying) { try { SYNC.changed(); } catch (e) { /* sync unavailable */ } } }
  function snapshot() {
    return { version: VERSION, settings: db.settings, seeded: !!db.seeded, recipes: db.recipes || [], checks: db.checks.map(function (c) { return Object.assign({}, c); }) };
  }
  function applyCloud(data) {
    if (!validDb(data)) return Promise.reject(new Error(tx('The cloud copy is not data this version of the data health check can read.')));
    applying = true;
    clearTimeout(saveTimer); saveTimer = null;
    var next = ensureSchema(JSON.parse(JSON.stringify(data)));
    var keep = {}; next.checks.forEach(function (c) { keep[c.id] = 1; });
    Object.keys(tables).forEach(function (id) { if (!keep[id]) { delete tables[id]; delete raw[id]; } });
    var gone = Object.keys(stored).filter(function (id) { return !keep[id]; });
    gone.forEach(function (id) { delete stored[id]; });
    db = next; cur = null;
    var w = idbOK ? enqueue(function () { var p = kvPut(db); gone.forEach(function (id) { p = p.then(function () { return tDel(id); }); }); return p.then(function () { announce(gone); }); }) : Promise.resolve();
    return w.then(function () { closeLayer(); render(); toast(tx('Loaded settings and checks from the cloud')); })
      .then(function () { applying = false; }, function (e) { applying = false; throw e; });
  }
  function syncStart() {
    if (!window.StratumSync || SYNC) return;
    try {
      SYNC = window.StratumSync.attach({ app: 'datacheck', label: tx('Data health check'), getSnapshot: function () { return Promise.resolve(snapshot()); }, applySnapshot: applyCloud });
    } catch (e) { SYNC = null; if (window.console) console.warn('Data health check: cloud sync unavailable', e); }
  }

  // other tabs: reload the list and, if they changed the open check, its rows
  if (channel) channel.onmessage = function (e) {
    if (!e.data || e.data.type !== 'changed' || !db || saveTimer) return;
    enqueue(function () { return Promise.all([kvGet(), tKeys()]); }).then(function (v) {
      if (!v || !validDb(v[0]) || saveTimer) return;
      db = ensureSchema(v[0]);
      stored = {}; (v[1] || []).forEach(function (k) { stored[k] = true; });
      var ids = e.data.ids || [];
      ids.forEach(function (id) { if (!cur || cur.id !== id || !cur.busy) delete tables[id]; });
      if (cur && (ids.indexOf(cur.id) >= 0 || !findCheck(cur.id))) { if ($('layers').innerHTML) { closeLayer(); toast(tx('This check changed in another tab.')); } cur = null; }
      render();
    }, function () { /* storage gone: keep what this tab has */ });
  };

  shellText();

  // ── boot ─────────────────────────────────────────────────────────────────
  enqueue(function () { return Promise.all([kvGet(), tKeys()]); }).then(function (v) {
    (v && v[1] || []).forEach(function (k) { stored[k] = true; });
    return v && validDb(v[0]) ? ensureSchema(v[0]) : null;
  }, function () { return null; }).then(function (loaded) {
    db = loaded || newDb();
    render();
    syncStart();
    if (!db.seeded) seedDemos().then(render, function (err) { if (window.console) console.error(err); });
  });
})();
