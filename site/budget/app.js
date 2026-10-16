/* Budget vs actual — vanilla JS single-page app (Business Apps).
 * State: one document in IndexedDB "stratum-budget" (store "kv", key "db"): the chart of accounts, actuals per account
 * and month (last year and this year), budget and forecast versions per P&L line, variance comments and settings.
 * Money is integer cents and engine.js does every calculation, so screens, CSV files and the board pack reconcile to
 * the cent. Per-viewer choices (period, comparison, toggles) live in localStorage "stratum-budget-ui". Other open tabs
 * follow via BroadcastChannel("stratum-budget"); a private cloud copy via /_shared/stratum-sync.js.
 * Routing: #/, #/pl, #/line/:id, #/budget, #/import, #/comments, #/print, #/settings. */
(function () {
  'use strict';

  var E = window.BudgetEngine, X = window.BudgetData, I18N = window.BuI18n;
  var $ = function (id) { return document.getElementById(id); };
  var UIKEY = 'stratum-budget-ui';
  var PACK_LANGS = { en: 'English', sl: 'Slovenščina', hr: 'Hrvatski' }; // languages of the board pack and of comment texts

  function todayLj() {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Ljubljana', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
    catch (e) { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  }
  var TODAY = todayLj();

  // ── storage ──────────────────────────────────────────────────────────────
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* blocked */ } }
  var idbP = null, idbOK = true;
  function idbOpen() {
    if (!idbP) {
      idbP = new Promise(function (resolve, reject) {
        try {
          if (!window.indexedDB) throw new Error('IndexedDB not available');
          var rq = indexedDB.open('stratum-budget', 1);
          rq.onupgradeneeded = function () { if (!rq.result.objectStoreNames.contains('kv')) rq.result.createObjectStore('kv'); };
          rq.onsuccess = function () { var d = rq.result; d.onversionchange = function () { d.close(); idbP = null; }; resolve(d); };
          rq.onerror = function () { reject(rq.error || new Error('IndexedDB open failed')); };
          rq.onblocked = function () { reject(new Error('IndexedDB blocked')); };
        } catch (e) { reject(e); }
      });
      idbP.catch(function () { idbP = null; });
    }
    return idbP;
  }
  function kv(mode, fn) {
    return idbOpen().then(function (d) {
      return new Promise(function (resolve, reject) {
        var t, out;
        try { t = d.transaction('kv', mode); out = fn(t.objectStore('kv')); } catch (e) { reject(e); return; }
        t.oncomplete = function () { resolve(out && 'result' in out ? out.result : undefined); };
        t.onerror = t.onabort = function () { reject(t.error || new Error('IndexedDB transaction failed')); };
      });
    });
  }
  var kvGet = function () { return kv('readonly', function (s) { return s.get('db'); }); };
  var kvPut = function (v) { return kv('readwrite', function (s) { s.put(v, 'db'); }); };
  var saveTimer = null, writeQ = Promise.resolve(), warned = false, byPerson = false, applying = false;
  function failed(err) {
    idbOK = false;
    if (window.console) console.warn('Budget vs actual: browser storage unavailable, keeping data in memory.', err);
    if (!warned) { warned = true; setTimeout(function () { toast(tx('Browser storage is unavailable: changes last until you reload.')); }, 50); }
  }
  function save() { if (!idbOK) return; clearTimeout(saveTimer); saveTimer = setTimeout(flush, 250); }
  function flush() {
    if (!saveTimer) return writeQ;
    clearTimeout(saveTimer); saveTimer = null;
    if (!idbOK) return writeQ;
    var snap = db, person = byPerson;
    byPerson = false;
    writeQ = writeQ.then(function () { return kvPut(snap); }).then(announce).then(function () { if (person && sync && !applying) { try { sync.changed(); } catch (e) { /* sync unavailable */ } } }).catch(failed);
    return writeQ;
  }
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flush(); });
  var channel = null;
  try { if (window.BroadcastChannel) channel = new BroadcastChannel('stratum-budget'); } catch (e) { channel = null; }
  function announce() { if (channel) { try { channel.postMessage({ type: 'changed' }); } catch (e) { /* closed */ } } }
  if (channel) channel.onmessage = function (e) {
    if (!e.data || e.data.type !== 'changed' || !db || saveTimer) return;
    writeQ.then(kvGet).then(function (v) {
      if (!valid(v) || saveTimer) return;
      db = v; ensureSchema(); invalidate(); undoStack = []; imp = null;
      if ($('layers').innerHTML) { closeLayer(); toast(tx('Changed in another tab: the dialog was closed.')); }
      render();
    }).catch(function () { /* ignore */ });
  };

  // ── cloud sync ───────────────────────────────────────────────────────────
  // A cloud copy is written straight to IndexedDB (not through flush), so taking it does not count as a local change.
  var sync = null, syncPanelOff = null;
  function applyCloud(data) {
    if (!valid(data)) return Promise.reject(new Error(tx('The cloud copy is not Budget vs actual data this version can read.')));
    applying = true;
    clearTimeout(saveTimer); saveTimer = null;
    db = data; ensureSchema(); invalidate(); undoStack = []; imp = null;
    closeLayer(); render();
    var snap = db;
    writeQ = writeQ.then(function () { return idbOK ? kvPut(snap) : null; }).then(announce).catch(failed);
    return writeQ.then(function () { applying = false; toast(tx('Loaded your data from the cloud copy')); }, function (err) { applying = false; throw err; });
  }

  // ── state ────────────────────────────────────────────────────────────────
  var db = null;
  function valid(o) {
    return !!(o && o.version === X.VERSION && typeof o.year === 'number' && Array.isArray(o.accounts) && o.actuals && typeof o.actuals === 'object' &&
      Array.isArray(o.versions) && o.versions.some(function (v) { return v && v.kind === 'budget' && v.values && typeof v.values === 'object'; }));
  }
  function ensureSchema() {
    X.migrate(db); // demo data made before the Slovenian chart of accounts moves onto it
    var s = db.settings = db.settings || {};
    if (s.closed !== 'auto' && !(s.closed >= 0 && s.closed <= 12)) s.closed = 'auto';
    if (!(s.grace >= 0 && s.grace <= 60)) s.grace = X.GRACE;
    if (!(s.pct > 0 && s.pct <= 1000)) s.pct = 10;
    if (!(s.ytdAbs >= 0)) s.ytdAbs = 10000;
    if (!(s.monthAbs >= 0)) s.monthAbs = 5000;
    if (!(s.alwaysAbs >= 0)) s.alwaysAbs = 0; // "always explain above X €"; 0 = off (data made before it had none)
    if (s.basis !== 'budget' && s.basis !== 'forecast') s.basis = 'forecast';
    if (typeof s.author !== 'string') s.author = '';
    db.company = db.company || { name: 'Your company', what: '', city: '' };
    db.comments = Array.isArray(db.comments) ? db.comments.filter(function (c) { return c && E.LINE[c.line] && c.month >= 1 && c.month <= 12; }) : [];
    db.comments.forEach(function (c) {
      if (!c.texts || typeof c.texts !== 'object') c.texts = {};
      Object.keys(c.texts).forEach(function (k) { if (!PACK_LANGS[k] || typeof c.texts[k] !== 'string') delete c.texts[k]; });
      if (!PACK_LANGS[c.lang]) c.lang = 'en';
    });
    var hc = db.headcount = db.headcount && typeof db.headcount === 'object' ? db.headcount : {};
    hc.rows = Array.isArray(hc.rows) ? hc.rows.filter(function (r) { return r && typeof r === 'object'; }) : [];
    hc.rows.forEach(function (r, i) {
      r.id = r.id ? String(r.id) : 'h' + Date.now().toString(36) + i; r.role = String(r.role || ''); r.country = r.country === 'HR' ? 'HR' : 'SI';
      r.fte = r.fte >= 0 && r.fte <= 999 ? +r.fte : 1; r.gross = Math.max(0, Math.round(+r.gross || 0)); r.allow = Math.max(0, Math.round(+r.allow || 0));
      r.from = /^\d{4}-\d{2}$/.test(r.from) ? r.from : ''; r.to = /^\d{4}-\d{2}$/.test(r.to) ? r.to : '';
    });
    hc.rates = hc.rates && typeof hc.rates === 'object' ? hc.rates : {};
    ['SI', 'HR'].forEach(function (k) { if (!(hc.rates[k] >= 0 && hc.rates[k] <= 100)) hc.rates[k] = E.CONTRIB[k]; });
    hc.holiday = Math.max(0, Math.round(+hc.holiday || 0)); hc.holidayMonth = hc.holidayMonth >= 1 && hc.holidayMonth <= 12 ? Math.round(hc.holidayMonth) : 6;
    hc.other = Math.max(0, Math.round(+hc.other || 0));
    db.log = Array.isArray(db.log) ? db.log : [];
    db.loaded = db.loaded && typeof db.loaded === 'object' ? db.loaded : {};
    [db.year - 1, db.year].forEach(function (y) {
      if (!Array.isArray(db.loaded[y]) || db.loaded[y].length !== 12) db.loaded[y] = E.zeros().map(function () { return false; });
      if (!db.actuals[y] || typeof db.actuals[y] !== 'object') db.actuals[y] = {};
    });
    db.accounts.forEach(function (a) { a.code = String(a.code); if (a.kind !== 'income' && a.kind !== 'cost') a.kind = E.kindFromCode(a.code); if (!E.LINE[a.line]) a.line = ''; a.name = String(a.name || ''); });
    db.versions.forEach(function (v) {
      v.values = v.values || {};
      E.LINES.forEach(function (l) { if (!E.isIntArr12(v.values[l.id])) v.values[l.id] = E.zeros(); });
      if (v.kind !== 'budget') { v.kind = 'forecast'; v.actualThrough = Math.max(0, Math.min(12, +v.actualThrough || 0)); }
    });
  }
  var ui = {};
  try { ui = JSON.parse(lsGet(UIKEY) || '{}') || {}; } catch (e) { ui = {}; }
  function part(k, def) { if (!ui[k] || typeof ui[k] !== 'object') ui[k] = def; return ui[k]; }
  var uPl = part('pl', { per: 'ytd', month: 0, q: 0, cmp: 'budget', pctRev: false, open: {} });
  if (!uPl.open || typeof uPl.open !== 'object') uPl.open = {};
  var uOv = part('ov', { chart: 'rev', bridge: 'ytd' });
  var uBud = part('bud', { vid: 'budget', line: 'sales_si', ri: 0, m: 1 });
  var uCm = part('cm', { f: 'attention', line: '' });
  // the board pack's language: picked = chosen in the pack; otherwise the pack follows the screen language (an old
  // saved 'en' was only the default, never a choice; 'sl' and 'hr' could only have been chosen)
  var uPk = part('pack', { lang: '' });
  if (typeof uPk.picked !== 'boolean') { uPk.picked = uPk.lang === 'sl' || uPk.lang === 'hr'; if (!uPk.picked) uPk.lang = ''; }
  var uSt = part('set', { q: '', line: '' });
  var uHc = part('hc', { vid: '' });
  var uiT = null;
  function saveUi() { clearTimeout(uiT); uiT = null; lsSet(UIKEY, JSON.stringify(ui)); }
  function saveUiSoon() { clearTimeout(uiT); uiT = setTimeout(saveUi, 400); }

  // ── screen language (English, Slovene, Croatian) ─────────────────────────
  function defaultLang() { var n = String((navigator.languages && navigator.languages[0]) || navigator.language || '').toLowerCase(); return n.indexOf('sl') === 0 ? 'sl' : n.indexOf('hr') === 0 || n.indexOf('bs') === 0 || n.indexOf('sr') === 0 ? 'hr' : 'en'; }
  (function () { // ?lang=sl|hr|en (the public site's demo links): use it and keep it as the choice
    var q = /[?&]lang=(en|sl|hr)\b/.exec(location.search);
    if (q && ui.lang !== q[1]) { ui.lang = q[1]; saveUi(); }
  })();
  var LANG = I18N.LANGS.indexOf(ui.lang) >= 0 ? ui.lang : defaultLang(), I = I18N.make(LANG);
  /** a screen text in the chosen language; {name} placeholders filled from v (plain text: escape it for HTML) */
  function tx(s, v) { return I.t(s, v); }
  /** the same for HTML: the text is escaped, the values in v are inserted as they are (escape them yourself) */
  function th(s, v) { var t = esc(I.t(s)); return v ? t.replace(/\{(\w+)\}/g, function (m, k) { return v[k] == null ? m : v[k]; }) : t; }
  /** a text the engine (or older data) wrote in English: translated by pattern */
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
    $('menuLabel').textContent = tx('Menu');
    $('appName').textContent = tx('Budget vs actual');
    $('side').setAttribute('aria-label', tx('Budget vs actual navigation'));
    $('nav').setAttribute('aria-label', tx('Sections'));
    $('demoPill').title = tx('The company, people, accounts and amounts are fictional demo data. Nothing is ever sent anywhere; your changes and imports stay in this browser, plus your private cloud copy if you sign in to sync.');
    $('demoText').textContent = tx('Demo data · saved in this browser only');
    $('langLabel').textContent = tx('Language');
    $('uiLang').value = LANG;
    var ld = document.querySelector('.loading span'); if (ld) ld.textContent = tx('Adding up the year…');
  }
  /** the board pack's language: the one chosen in the pack, else the screen language */
  function packLang() { return uPk.picked && PACK_LANGS[uPk.lang] ? uPk.lang : LANG; }

  var M = null;
  function invalidate() { M = null; }
  function budgetV() { return db.versions.filter(function (v) { return v.kind === 'budget'; })[0]; }
  function forecasts() { return db.versions.filter(function (v) { return v.kind === 'forecast'; }).sort(function (a, b) { return a.createdOn < b.createdOn ? -1 : a.createdOn > b.createdOn ? 1 : 0; }); }
  function latestFc() { var f = forecasts(); return f.length ? f[f.length - 1] : null; }
  function model() {
    if (M) return M;
    var y = db.year, s = db.settings;
    var auto = E.closedFor(y, TODAY, s.grace), loaded = db.loaded[y];
    var closed = s.closed === 'auto' ? E.capByLoaded(auto, loaded) : Math.max(0, Math.min(12, Math.round(+s.closed) || 0));
    var ag = E.aggregate(db.actuals[y], db.accounts), pag = E.aggregate(db.actuals[y - 1], db.accounts);
    var bud = budgetV(), fc = latestFc(), basis = s.basis === 'forecast' && fc ? fc : bud;
    var out = E.outlook(ag.lines, basis.values, closed);
    M = {
      y: y, closed: closed, auto: auto, act: ag.lines, actR: E.rowsOf(ag.lines), py: pag.lines, pyR: E.rowsOf(pag.lines),
      unmapped: ag.unmapped.concat(pag.unmapped.filter(function (c) { return ag.unmapped.indexOf(c) < 0; })),
      bud: bud, budR: E.rowsOf(bud.values), fc: fc, fcR: fc ? E.rowsOf(fc.values) : null, basis: basis, out: out, outR: E.rowsOf(out),
      th: { pct: s.pct, monthAbs: Math.round(s.monthAbs * 100), ytdAbs: Math.round(s.ytdAbs * 100), always: Math.round((s.alwaysAbs || 0) * 100) }, cIdx: {}
    };
    M.flags = E.flags(M.actR, M.budR, closed, M.th);
    M.fIdx = {};
    M.flags.forEach(function (f) { M.fIdx[E.commentKey(f.line, f.month, f.scope)] = f; });
    db.comments.forEach(function (c) { M.cIdx[E.commentKey(c.line, c.month, c.scope)] = c; });
    return M;
  }
  function cmpRows(cmp) { var m = model(); return cmp === 'forecast' && m.fcR ? m.fcR : cmp === 'ly' ? m.pyR : m.budR; }
  function cmpShort(cmp) { var m = model(); return cmp === 'forecast' && m.fc ? tx('Forecast') : cmp === 'ly' ? String(m.y - 1) : tx('Budget'); }
  function cmpLong(cmp) { var m = model(); return cmp === 'forecast' && m.fc ? vname(m.fc) : cmp === 'ly' ? tx('{year} actual', { year: m.y - 1 }) : vname(m.bud); }
  function attention() { var m = model(); return m.flags.filter(function (f) { var c = m.cIdx[E.commentKey(f.line, f.month, f.scope)]; return !c || c.status !== 'explained'; }); }
  function commit(text, fn, opts) {
    fn();
    if (text) { db.log.unshift({ at: TODAY, text: text }); if (db.log.length > 200) db.log.length = 200; }
    db.edited = true; byPerson = true;
    invalidate(); save();
    if (!(opts && opts.noRender)) render();
  }

  // ── formatting ───────────────────────────────────────────────────────────
  // useGrouping 'always': 6.117 like 12.345 (sl-SI leaves four-digit numbers ungrouped by default); older browsers ignore it
  var nf0 = new Intl.NumberFormat('sl-SI', { maximumFractionDigits: 0, useGrouping: 'always' });
  var nf1 = new Intl.NumberFormat('sl-SI', { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: 'always' });
  var nf2 = new Intl.NumberFormat('sl-SI', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' });
  var nfx = new Intl.NumberFormat('sl-SI', { maximumFractionDigits: 2, useGrouping: 'always' });
  var MINUS = '\u2212', NB = '\u00a0'; // minus sign; no-break space between a number and its unit
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  /** cents → whole euros with thousands separators, e.g. 1.234.567 or −12.345 */
  function num(c) { var e = Math.round(Math.abs(c) / 100); return (c < 0 && e ? MINUS : '') + nf0.format(e); }
  function eur(c) { return num(c) + NB + '€'; }
  function eur2(c) { var a = Math.abs(c); return (c < 0 && a ? MINUS : '') + nf2.format(a / 100) + NB + '€'; }
  /** signed whole euros: +1.234 / −1.234 / 0 */
  function sgn(c) { var e = Math.round(Math.abs(c) / 100); return (e ? (c < 0 ? MINUS : '+') : '') + nf0.format(e); }
  function keur(c) {
    var a = Math.abs(c) / 100, s;
    if (a >= 1e6) s = nf2.format(a / 1e6) + NB + 'M€'; else if (a >= 1e4) s = nf0.format(a / 1e3) + NB + 'k€'; else s = nf0.format(a) + NB + '€';
    return (c < 0 && a >= 0.5 ? MINUS : '') + s;
  }
  /** thousands of euros for small steps too: 6,1 k€ (the bridge keeps one unit) */
  function kshort(c) { var a = Math.abs(c) / 100, s = a >= 1e6 ? nf2.format(a / 1e6) + NB + 'M€' : a >= 1e4 ? nf0.format(a / 1e3) + NB + 'k€' : nf1.format(a / 1e3) + NB + 'k€'; return (c < 0 && a >= 50 ? MINUS : '') + s; }
  function skeur(c) { return (Math.abs(c) >= 50 && c > 0 ? '+' : '') + keur(c); }
  function pctTxt(p, plus) {
    if (p == null || !isFinite(p)) return '—';
    var r = Math.round(p * 10) / 10;
    return (r > 0 && plus ? '+' : r < 0 ? MINUS : '') + nf1.format(Math.abs(r)) + NB + '%';
  }
  function ppTxt(p) { if (p == null || !isFinite(p)) return '—'; var r = Math.round(p * 10) / 10; return (r > 0 ? '+' : r < 0 ? MINUS : '') + nf1.format(Math.abs(r)) + NB + tx('pp'); }
  /** 15. 10. 2026 (Croatian adds the closing full stop: 15. 10. 2026.) */
  function dt(s) { return E.isDate(s) ? dt0(s) + (LANG === 'hr' ? '.' : '') : '—'; }
  function dt0(s) { return E.isDate(s) ? +s.slice(8, 10) + '. ' + +s.slice(5, 7) + '. ' + s.slice(0, 4) : '—'; }
  function mon(m) { return I.months[m - 1]; }
  function monL(m) { return I.monthsLong[m - 1]; }
  /** after "through": do septembra (sl), do rujna (hr); English and the nominative are the same */
  function monG(m) { return I.monthsGen[m - 1]; }
  /** a heading or sentence that starts with a (lowercase Slovene or Croatian) month name */
  function cap(s) { s = String(s); return s.charAt(0).toUpperCase() + s.slice(1); }
  function range(from, to) { return from > to ? tx('no months') : from === to ? monL(from) : monL(from) + '–' + monL(to); }
  /** "3 accounts" in the screen language (Slovene has four forms, Croatian three) */
  function plural(n, one, many) { return nf0.format(n) + ' ' + I.noun(n, one, many); }
  /** the name of a P&L line, subtotal or margin row in the screen language */
  function lnm(id) {
    if (LANG !== 'en' && I18N.LINE_NAMES[LANG][id]) return I18N.LINE_NAMES[LANG][id];
    return id === 'gm_pct' ? 'Gross margin %' : id === 'ebitda_pct' ? 'EBITDA %' : E.nameOf(id);
  }
  function rowName(r) { return r.kind === 'head' ? tx(r.name) : lnm(r.id); }
  function secName(id) { var s = E.SECTIONS.filter(function (x) { return x.id === id; })[0]; return s ? tx(s.name) : ''; }
  /** a version's name: the app's own names ("Budget 2026", "Forecast 2026 (Q2)") in the screen language */
  function vname(v) { return v ? lx(v.name) : ''; }
  function favCls(fav) { return fav === true ? 'pos' : fav === false ? 'neg' : ''; }
  function kcls(fav) { return fav === true ? 'good' : fav === false ? 'bad' : ''; }
  function favWord(fav) { return tx(fav === true ? 'Favourable' : fav === false ? 'Unfavourable' : 'No difference'); }
  function same(a, b) { if (a.length !== b.length) return false; for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; }
  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
  function keyId(k) { return String(k).replace(/[^a-z0-9]+/gi, '-'); }
  var IC = {
    home: '<path d="M4 11.5 12 5l8 6.5V20H4z"/><path d="M10 20v-5h4v5"/>',
    pl: '<rect x="4" y="4.5" width="16" height="15" rx="2.5"/><path d="M4 9.5h16M4 14.5h16M11 9.5v10"/>',
    grid: '<path d="M4 17.5V20h2.5L17 9.5 14.5 7z"/><path d="M13 8.5l2.5 2.5"/><path d="M4 4h7M4 8h4M14 20h6M17 16h3"/>',
    chat: '<path d="M5 5h14v10H10l-5 4z"/><path d="M9 9h6M9 12h4"/>',
    print: '<path d="M7 9V4h10v5M7 17H5v-6h14v6h-2"/><rect x="7" y="14" width="10" height="6"/>',
    up: '<path d="M12 16V5M7 10l5-5 5 5M5 19h14"/>',
    set: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>', dl: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>', plus: '<path d="M12 5v14M5 12h14"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>', lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    unlock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.7-1.5"/>', tools: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    chev: '<path d="M9 6l6 6-6 6"/>', back: '<path d="M15 6l-6 6 6 6"/>', trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    fc: '<path d="M4 18l5-6 4 3 7-9"/><path d="M15 6h5v5"/>', people: '<circle cx="9" cy="8" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="9" r="2.4"/><path d="M15.5 14.2A4.5 4.5 0 0 1 21 18.5"/>', file: '<path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4M9 13h6M9 17h6"/>', check: '<path d="M5 12l5 5 9-10"/>'
  };
  function ic(n) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + IC[n] + '</svg>'; }
  var LINE_HINT = {
    sales_si: 'Wholesale to installers, contractors and retail chains in Slovenia, net of customer rebates',
    sales_hr: 'Sales in Croatia, including the new sales rep in Split', sales_eu: 'Austria, Italy and other EU customers',
    other_inc: 'Sublet warehouse space, gains on sold assets, refunds', cogs: 'Purchase price of goods sold, write-downs, supplier rebates',
    freight: 'Inbound freight, carriers and packaging', personnel: 'Salaries, employer contributions, allowances, bonuses',
    rent: 'Warehouse rent, utilities, cleaning and maintenance', vehicles: 'Van leases, fuel, maintenance and tolls',
    marketing: 'Advertising, trade fairs, catalogues', it: 'Licences, IT support and the ERP project', prof: 'Audit, tax, legal and consulting',
    travel: 'Business travel at home and abroad', insurance: 'Property, stock, liability and credit insurance', other_cost: 'Office, telephone, bank charges, fees',
    da: 'Depreciation of buildings, racking, vehicles and software', fin: 'Interest income minus interest on loans and the credit line',
    rev: 'All four revenue lines', cos: 'Cost of goods sold plus freight and logistics', gm: 'Revenue minus cost of sales', opex: 'The nine operating cost lines',
    ebitda: 'Gross margin minus operating expenses', ebit: 'EBITDA minus depreciation and amortisation', pbt: 'EBIT plus the net financial result'
  };

  // ── layers: modal, toast, downloads ──────────────────────────────────────
  var lastFocus = null, lastTrigger = null, modalSubmit = null;
  function openLayer(html, sel) {
    // Safari does not focus a clicked button, so fall back to the element that was clicked
    if (!$('layers').innerHTML) lastFocus = document.activeElement && document.activeElement !== document.body ? document.activeElement : lastTrigger;
    $('layers').innerHTML = '<div class="scrim" data-act="close"></div>' + html;
    var el = $('layers').querySelector(sel);
    if (el) {
      el.setAttribute('tabindex', '-1');
      var f = el.querySelector('[autofocus]') || el.querySelector('.md-body input:not([type=hidden]):not([disabled]):not([type=radio]), .md-body select, .md-body textarea, .md-body input[type=radio]:checked');
      (f || el).focus();
    }
  }
  function closeLayer() {
    if (!$('layers').innerHTML) return;
    $('layers').innerHTML = ''; modalSubmit = null; toolSt = null;
    if (lastFocus && lastFocus.focus && document.contains(lastFocus)) lastFocus.focus();
  }
  function modal(title, body, submitLabel, onSubmit, opts) {
    opts = opts || {};
    modalSubmit = onSubmit;
    openLayer('<form class="modal' + (opts.wide ? ' wide' : '') + '" id="mdForm" role="dialog" aria-modal="true" aria-labelledby="mdTitle" novalidate><div class="md-head"><h2 id="mdTitle">' + esc(title) + '</h2>' +
      '<button type="button" class="btn icon sm" data-act="close" aria-label="' + esc(tx('Close')) + '">' + ic('x') + '</button></div><div class="md-body">' + body + '<div class="err" id="mdErr" role="alert" hidden></div></div>' +
      '<div class="md-foot">' + (opts.extra || '') + '<button type="button" class="btn" data-act="close">' + esc(tx(submitLabel ? 'Cancel' : 'Close')) + '</button>' +
      (submitLabel ? '<button type="submit" class="btn ' + (opts.danger ? 'danger' : 'pri') + '">' + esc(submitLabel) + '</button>' : '') + '</div></form>', '.modal');
  }
  function modalError(msg) { var e = $('mdErr'); if (e) { e.hidden = !msg; e.textContent = msg || ''; } }
  /** text is HTML: escape every value in it */
  function confirmBox(title, text, okLabel, onOk, danger) { modal(title, '<p>' + text + '</p>', okLabel, function () { closeLayer(); onOk(); }, { danger: danger }); }
  var toastT = null;
  function toast(msg) { var t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('on'); }, 3400); }
  function download(name, text, type) {
    var b = new Blob([text], { type: type || 'text/csv;charset=utf-8' }), a = document.createElement('a');
    a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }

  // ── navigation ───────────────────────────────────────────────────────────
  // [route, label, icon, short label for the phone tab bar]
  var ROUTES = [
    ['', 'Overview', 'home'], ['pl', 'Profit and loss', 'pl', 'P&L'], ['budget', 'Budget & forecast', 'grid', 'Budget'], ['comments', 'Comments', 'chat'],
    ['print', 'Board pack', 'print'], ['import', 'Import actuals', 'up'], ['people', 'Headcount', 'people'], ['settings', 'Settings', 'set']
  ];
  function parseRoute() {
    var h = (location.hash || '').replace(/^#\/?/, ''), p = h.split('/');
    if (p[0] === 'line') return { name: 'line', arg: decodeURIComponent(p[1] || '') };
    return { name: ROUTES.some(function (r) { return r[0] === p[0]; }) ? p[0] : '', arg: '' };
  }
  function renderNav() {
    var r = parseRoute(), m = model(), need = attention().length;
    $('nav').innerHTML = ROUTES.map(function (x) {
      var cur = r.name === x[0] || (r.name === 'line' && x[0] === 'pl');
      var cnt = x[0] === 'comments' && need ? '<span class="count alert" title="' + esc(tx('Variances that still need an explanation')) + '">' + need + '</span>' : '';
      return '<a href="#/' + x[0] + '"' + (cur ? ' aria-current="page"' : '') + '>' + ic(x[2]) + '<span>' + (x[3] ? '<span class="nl">' + esc(tx(x[1])) + '</span><span class="ns">' + esc(tx(x[3])) + '</span>' : esc(tx(x[1]))) + '</span>' + cnt + '</a>';
    }).join('');
    var short = db.company.name.replace(/\s+(d\.\s?o\.\s?o\.|d\.\s?d\.|s\.\s?p\.)$/i, '');
    if (short.length > 14) short = short.split(/\s+/)[0];
    $('brandSub').textContent = short + ' · ' + m.y;
    $('closePill').innerHTML = '<span>' + (m.closed ? th('Closed through {month}', { month: '<b>' + esc(monG(m.closed)) + '</b>' }) : th('No month closed yet')) + '</span><small>' + (m.closed < 12 ? th('Open: {months}', { months: plural(12 - m.closed, 'month', 'months') }) : th('The whole year is closed')) + (db.settings.closed === 'auto' ? '' : ' · ' + th('set by hand')) + '</small>';
    // home-page summary: the same count as the Comments badge
    try { if (window.StratumShell && StratumShell.needs) StratumShell.needs('budget', [
      { text: 'Variances that need an explanation', count: need, href: '/budget/#/comments', tone: 'warn' }
    ]); } catch (e) { /* home-page summary is optional */ }
  }
  function head(eyebrow, title, sub, actions) {
    return '<div class="head"><div><span class="eyebrow">' + eyebrow + '</span><h1 tabindex="-1">' + esc(title) + '<span class="dot">.</span></h1>' + (sub ? '<p class="sub">' + sub + '</p>' : '') + '</div>' +
      (actions ? '<div class="head-actions no-print">' + actions + '</div>' : '') + '</div>';
  }
  function nextCloseDate() {
    var m = model(); if (m.closed >= 12) return null;
    var nm = m.closed + 1;
    return E.addDays(E.monthEnd(m.y, nm), db.settings.grace);
  }
  /** months counted as closed (set by hand) that have no actuals: they would show as zero */
  function missingNotice() {
    var m = model(), miss = [];
    for (var i = 1; i <= m.closed; i++) if (!db.loaded[m.y][i - 1]) miss.push(monL(i));
    if (!miss.length) return '';
    var list = miss.length > 3 ? tx('{month} and {n} more months', { month: miss[0], n: miss.length - 1 }) : miss.join(', ');
    return '<div class="notice warn"><p>' + th(miss.length === 1 ? 'Counted as closed, but no actuals yet: {list}. It shows as zero. Import the actuals, or set the closed month in Settings.' : 'Counted as closed, but no actuals yet: {list}. They show as zero. Import the actuals, or set the closed month in Settings.', { list: esc(list) }) + '</p><a class="btn sm" href="#/import">' + th('Import actuals') + '</a></div>';
  }
  function basisSeg(label) {
    var m = model();
    if (!m.fc) return '';
    return '<div class="seg" role="group" aria-label="' + esc(label || tx('Outlook uses')) + '"><button type="button" data-act="basis" data-v="forecast" aria-pressed="' + (m.basis === m.fc) + '">' + esc(vname(m.fc)) + '</button>' +
      '<button type="button" data-act="basis" data-v="budget" aria-pressed="' + (m.basis === m.bud) + '">' + esc(vname(m.bud)) + '</button></div>';
  }

  // ── charts ───────────────────────────────────────────────────────────────
  // Drawn after the page is in the DOM, at the real width of their box, so the text stays readable on a phone.
  var CH = {};
  function f1(n) { return Math.round(n * 10) / 10; }
  function niceStep(span, n) { var raw = span / (n || 4), p = Math.pow(10, Math.floor(Math.log10(raw || 1))), m = raw / p; return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p; }
  function axisLbl(c) { var e = c / 100, a = Math.abs(e); var s = a >= 1e6 ? nfx.format(a / 1e6) + ' M' : a >= 1e3 ? nf0.format(a / 1e3) + ' k' : nf0.format(a); return (e < 0 && a ? MINUS : '') + s; }
  function chartBox(id, label, def) {
    CH[id] = def;
    return '<div class="chart" id="' + id + '" tabindex="0" role="group" aria-roledescription="chart" aria-label="' + esc(tx('{chart}. Use the left and right arrow keys to read each month.', { chart: label })) + '"><div class="cv"></div><div class="tip" role="status" aria-live="polite" hidden></div></div>';
  }
  function drawCharts() {
    Object.keys(CH).forEach(function (id) {
      var el = $(id); if (!el) return;
      var w = Math.max(260, Math.round(el.clientWidth || 600));
      el.querySelector('.cv').innerHTML = CH[id].draw(w);
      el._w = w;
    });
  }
  function barPath(cls, x0, w, yBase, yVal) {
    var h = Math.abs(yBase - yVal);
    if (h < 0.6) return '';
    var r = Math.min(4, w / 2, h), xr = x0 + w, up = yVal < yBase, e = up ? yVal + r : yVal - r;
    return '<path class="' + cls + '" d="M' + f1(x0) + ' ' + f1(yBase) + 'V' + f1(e) + 'Q' + f1(x0) + ' ' + f1(yVal) + ' ' + f1(x0 + r) + ' ' + f1(yVal) + 'H' + f1(xr - r) + 'Q' + f1(xr) + ' ' + f1(yVal) + ' ' + f1(xr) + ' ' + f1(e) + 'V' + f1(yBase) + 'Z"/>';
  }
  function scaleY(vals, H, T, B, ticks) {
    var lo = Math.min.apply(null, vals.concat([0])), hi = Math.max.apply(null, vals.concat([0]));
    var step = niceStep((hi - lo) || 100, ticks);
    lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
    if (hi === lo) hi = lo + step;
    return { lo: lo, hi: hi, step: step, y: function (v) { return T + (H - T - B) * (hi - v) / (hi - lo); } };
  }
  function monthAxis(g, x, sw, H, narrow) {
    for (var i = 0; i < 12; i++) g.push('<text class="ax" x="' + f1(x(i) + sw / 2) + '" y="' + (H - 7) + '" text-anchor="middle">' + (narrow ? I.months[i].charAt(0).toUpperCase() : I.months[i]) + '</text>');
  }
  function gridLines(g, sc, L, W, R) {
    for (var v = sc.lo; v <= sc.hi + sc.step / 2; v += sc.step) {
      var yy = f1(sc.y(v));
      g.push('<line class="' + (v === 0 ? 'base' : 'grid-l') + '" x1="' + L + '" x2="' + (W - R) + '" y1="' + yy + '" y2="' + yy + '"/><text class="ax" x="' + (L - 6) + '" y="' + f1(yy + 3.5) + '" text-anchor="end">' + esc(axisLbl(v)) + '</text>');
    }
  }
  /** Bars per month: actual (closed months) or outlook (open months) in front, budget as an outline behind, last year as a line.
   * o = { ac, ou, bu, ly, closed, names: { ac, ou, bu, ly }, type } */
  function monthBars(id, label, o) {
    return chartBox(id, label, {
      draw: function (W) {
        var narrow = W < 440, H = W < 560 ? 230 : 270, L = narrow ? 42 : 52, R = 6, T = 12, B = 24, vals = [];
        for (var i = 0; i < 12; i++) { vals.push(o.bu[i], i < o.closed ? o.ac[i] : o.ou[i]); if (o.ly) vals.push(o.ly[i]); }
        var sc = scaleY(vals, H, T, B, narrow ? 3 : 4), sw = (W - L - R) / 12, x = function (k) { return L + sw * k; }, g = [];
        if (o.closed < 12) g.push('<rect class="band" x="' + f1(x(o.closed)) + '" y="' + T + '" width="' + f1(sw * (12 - o.closed)) + '" height="' + (H - T - B) + '"/>');
        gridLines(g, sc, L, W, R);
        var bw = Math.max(4, Math.min(20, sw * 0.36)), off = bw * 0.42, y0 = sc.y(0);
        for (i = 0; i < 12; i++) {
          var cx = x(i) + sw / 2, v = i < o.closed ? o.ac[i] : o.ou[i];
          g.push(barPath('b-bu', cx - off - bw / 2, bw, y0, sc.y(o.bu[i])));
          g.push(barPath((i < o.closed ? 'b-ac' : 'b-ou') + (v < 0 ? ' b-neg' : ''), cx + off - bw / 2, bw, y0, sc.y(v)));
        }
        if (o.ly) {
          g.push('<path class="ly" d="' + o.ly.map(function (v2, k) { return (k ? 'L' : 'M') + f1(x(k) + sw / 2) + ' ' + f1(sc.y(v2)); }).join(' ') + '"/>');
          o.ly.forEach(function (v2, k) { g.push('<circle class="ly-d" cx="' + f1(x(k) + sw / 2) + '" cy="' + f1(sc.y(v2)) + '" r="4"/>'); });
        }
        if (o.closed > 0 && o.closed < 12) g.push('<line class="sep" x1="' + f1(x(o.closed)) + '" x2="' + f1(x(o.closed)) + '" y1="' + T + '" y2="' + (H - B) + '"/>');
        monthAxis(g, x, sw, H, narrow);
        for (i = 0; i < 12; i++) g.push('<rect class="hit" data-i="' + i + '" x="' + f1(x(i)) + '" y="' + T + '" width="' + f1(sw) + '" height="' + (H - T - B) + '"/>');
        return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" aria-hidden="true">' + g.join('') + '</svg>';
      },
      tip: function (i) {
        var isAc = i < o.closed, v = isAc ? o.ac[i] : o.ou[i], va = E.variance(v, o.bu[i], o.type);
        return '<b>' + esc(cap(monL(i + 1))) + ' ' + model().y + (isAc ? '' : ' · ' + th('open')) + '</b>' +
          '<div><span><i style="border-color:var(--c-ac)' + (isAc ? '' : ';border-top-style:dashed') + '"></i>' + esc(isAc ? o.names.ac : o.names.ou) + '</span><span>' + eur(v) + '</span></div>' +
          '<div><span><i style="border-color:var(--c-bu)"></i>' + esc(o.names.bu) + '</span><span>' + eur(o.bu[i]) + '</span></div>' +
          '<div class="' + favCls(va.fav) + '"><span>' + th('Difference') + '</span><span>' + sgn(va.d) + NB + '€ · ' + pctTxt(va.pct, true) + '</span></div>' +
          (o.ly ? '<div><span><i style="border-color:var(--c-ly)"></i>' + esc(o.names.ly) + '</span><span>' + eur(o.ly[i]) + '</span></div>' : '');
      }
    });
  }
  /** Running totals through the year: actual then outlook, budget, last year. */
  function cumLines(id, label, o) {
    function cum(a) { var s = 0; return a.map(function (v) { s += v; return s; }); }
    var cAc = cum(o.ou), cBu = cum(o.bu), cLy = o.ly ? cum(o.ly) : null;
    return chartBox(id, label, {
      draw: function (W) {
        var narrow = W < 440, H = W < 560 ? 220 : 250, L = narrow ? 46 : 56, R = 10, T = 12, B = 24;
        var vals = cAc.concat(cBu, cLy || []), sc = scaleY(vals, H, T, B, narrow ? 3 : 4), sw = (W - L - R) / 12, g = [];
        var x = function (k) { return L + sw * k + sw / 2; };
        if (o.closed < 12) g.push('<rect class="band" x="' + f1(L + sw * o.closed) + '" y="' + T + '" width="' + f1(sw * (12 - o.closed)) + '" height="' + (H - T - B) + '"/>');
        gridLines(g, sc, L, W, R);
        function path(arr, from, to) { var d = ''; for (var k = from; k <= to; k++) d += (k === from ? 'M' : 'L') + f1(x(k)) + ' ' + f1(sc.y(arr[k])); return d; }
        if (o.closed > 0) g.push('<path class="area" d="' + path(cAc, 0, o.closed - 1) + 'L' + f1(x(o.closed - 1)) + ' ' + f1(sc.y(0)) + 'L' + f1(x(0)) + ' ' + f1(sc.y(0)) + 'Z"/>');
        if (cLy) g.push('<path class="ln lyl" d="' + path(cLy, 0, 11) + '"/>');
        g.push('<path class="ln bu" d="' + path(cBu, 0, 11) + '"/>');
        if (o.closed < 12) g.push('<path class="ln ou" d="' + path(cAc, Math.max(0, o.closed - 1), 11) + '"/>');
        if (o.closed > 0) g.push('<path class="ln ac" d="' + path(cAc, 0, o.closed - 1) + '"/>');
        if (o.closed > 0) g.push('<circle class="dot" style="fill:var(--c-ac)" cx="' + f1(x(o.closed - 1)) + '" cy="' + f1(sc.y(cAc[o.closed - 1])) + '" r="4.5"/>');
        g.push('<circle class="dot" style="fill:var(--c-bu)" cx="' + f1(x(11)) + '" cy="' + f1(sc.y(cBu[11])) + '" r="4"/>');
        monthAxis(g, function (k) { return L + sw * k; }, sw, H, narrow);
        for (var i = 0; i < 12; i++) g.push('<rect class="hit" data-i="' + i + '" x="' + f1(L + sw * i) + '" y="' + T + '" width="' + f1(sw) + '" height="' + (H - T - B) + '"/>');
        return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" aria-hidden="true">' + g.join('') + '</svg>';
      },
      tip: function (i) {
        var isAc = i < o.closed, va = E.variance(cAc[i], cBu[i], o.type);
        return '<b>' + th('Through {month}', { month: esc(monG(i + 1)) }) + (isAc ? '' : ' · ' + th('outlook')) + '</b>' +
          '<div><span><i style="border-color:var(--c-ac)' + (isAc ? '' : ';border-top-style:dashed') + '"></i>' + th(isAc ? 'Actual' : 'Outlook') + '</span><span>' + eur(cAc[i]) + '</span></div>' +
          '<div><span><i style="border-color:var(--c-bu)"></i>' + th('Budget') + '</span><span>' + eur(cBu[i]) + '</span></div>' +
          '<div class="' + favCls(va.fav) + '"><span>' + th('Difference') + '</span><span>' + sgn(va.d) + NB + '€</span></div>' +
          (cLy ? '<div><span><i style="border-color:var(--c-ly)"></i>' + (model().y - 1) + '</span><span>' + eur(cLy[i]) + '</span></div>' : '');
      }
    });
  }
  function showTip(box, i, ev) {
    var def = CH[box.id]; if (!def || !def.tip) return;
    i = Math.max(0, Math.min(11, i));
    var tip = box.querySelector('.tip');
    tip.innerHTML = def.tip(i); tip.hidden = false; box._i = i;
    box.querySelectorAll('.hit.on').forEach(function (e) { e.classList.remove('on'); });
    var hit = box.querySelector('.hit[data-i="' + i + '"]');
    if (hit) hit.classList.add('on');
    var r = box.getBoundingClientRect(), hr = hit ? hit.getBoundingClientRect() : r, tw = tip.offsetWidth, th = tip.offsetHeight;
    var left = hr.right - r.left + 8;
    if (left + tw > r.width) left = hr.left - r.left - tw - 8;
    if (left < 0) left = Math.max(0, Math.min(r.width - tw, hr.left - r.left + hr.width / 2 - tw / 2));
    var top = ev && ev.clientY ? ev.clientY - r.top - th / 2 : 8;
    tip.style.left = Math.round(left) + 'px'; tip.style.top = Math.round(Math.max(0, Math.min(top, r.height - th))) + 'px';
  }
  function hideTip(box) { var t = box.querySelector('.tip'); if (t) t.hidden = true; box.querySelectorAll('.hit.on').forEach(function (e) { e.classList.remove('on'); }); }

  /** Horizontal waterfall: start bar (outline), one step per line, end bar (solid). Exact euros in the titles and the table. */
  function bridgeList(br, o) {
    var b = o.compact ? E.compactBridge(br, o.compact) : br, run = b.start, pts = [0, b.start, b.end], rows = [];
    b.steps.forEach(function (s) { rows.push({ s: s, from: run, to: run + s.effect }); run += s.effect; pts.push(run); });
    var lo = Math.min.apply(null, pts), hi = Math.max.apply(null, pts), span = (hi - lo) || 1;
    lo -= span * 0.02; hi += span * 0.02; span = hi - lo;
    var sc = function (v) { return (v - lo) / span * 100; };
    function bar(cls, a, z) { var l = Math.min(sc(a), sc(z)), w = Math.abs(sc(z) - sc(a)); return '<span class="wt"><i class="wb ' + cls + '" style="left:' + l.toFixed(2) + '%;width:' + w.toFixed(2) + '%"></i></span>'; }
    var h = '<ul class="wf" style="--z:' + sc(0).toFixed(2) + '%">';
    h += '<li class="tot" title="' + esc(o.startLabel + ': ' + eur(b.start)) + '"><span class="wl">' + esc(o.startLabel) + '</span>' + bar('start', 0, b.start) + '<span class="wv">' + esc(o.fmt ? o.fmt(b.start) : kshort(b.start)) + '</span></li>';
    rows.forEach(function (r) {
      var s = r.s, name = o.names && o.names[s.id] ? o.names[s.id] : s.id === 'other' ? tx(s.name) : lnm(s.id), cls = s.effect >= 0 ? 'up' : 'down';
      var lbl = o.link && E.LINE[s.id] ? '<a href="#/line/' + s.id + '">' + esc(name) + '</a>' : esc(name) + (s.ids ? ' (' + s.ids.length + ')' : '');
      h += '<li title="' + esc(tx('{line}: {amount} on EBITDA', { line: name, amount: sgn(s.effect) + NB + '€' })) + '"><span class="wl">' + lbl + '</span>' + bar(cls, r.from, r.to) + '<span class="wv ' + (s.effect > 0 ? 'pos' : s.effect < 0 ? 'neg' : '') + '">' + esc(o.fmt ? (s.effect > 0 ? '+' : '') + o.fmt(s.effect) : (s.effect >= 5000 ? '+' : '') + kshort(s.effect)) + '</span></li>';
    });
    h += '<li class="tot" title="' + esc(o.endLabel + ': ' + eur(b.end)) + '"><span class="wl">' + esc(o.endLabel) + '</span>' + bar('end', 0, b.end) + '<span class="wv">' + esc(o.fmt ? o.fmt(b.end) : kshort(b.end)) + '</span></li>';
    return h + '</ul>';
  }
  function bridgeTable(br, startLabel, endLabel) {
    var run = br.start;
    return '<details class="tbl"><summary>' + th('Show as table') + '</summary><div class="tw"><table class="t compact"><thead><tr><th>' + th('Step') + '</th><th class="num">' + th('Effect on EBITDA') + '</th><th class="num">' + th('Running total') + '</th></tr></thead><tbody>' +
      '<tr><td>' + esc(startLabel) + '</td><td class="num"></td><td class="num">' + eur(br.start) + '</td></tr>' +
      br.steps.map(function (s) { run += s.effect; return '<tr><td>' + esc(s.id === 'other' ? tx(s.name) : lnm(s.id)) + '</td><td class="num ' + (s.effect > 0 ? 'pos' : s.effect < 0 ? 'neg' : '') + '">' + sgn(s.effect) + '</td><td class="num">' + eur(run) + '</td></tr>'; }).join('') +
      '</tbody><tfoot><tr><td>' + esc(endLabel) + '</td><td class="num">' + sgn(br.end - br.start) + '</td><td class="num">' + eur(br.end) + '</td></tr></tfoot></table></div></details>';
  }
  function monthTable(o, first) {
    return '<details class="tbl"><summary>' + th('Show as table') + '</summary><div class="tw"><table class="t compact"><thead><tr><th>' + esc(first || tx('Month')) + '</th><th class="num">' + esc(o.names.ac) + ' / ' + esc(o.names.ou) + '</th><th class="num">' + esc(o.names.bu) + '</th><th class="num">Δ</th><th class="num">Δ %</th>' + (o.ly ? '<th class="num">' + esc(o.names.ly) + '</th>' : '') + '</tr></thead><tbody>' +
      I.monthsLong.map(function (mn, i) {
        var v = i < o.closed ? o.ac[i] : o.ou[i], va = E.variance(v, o.bu[i], o.type);
        return '<tr><td>' + esc(cap(mn)) + (i < o.closed ? '' : ' <span class="tag">' + th('open') + '</span>') + '</td><td class="num">' + num(v) + '</td><td class="num">' + num(o.bu[i]) + '</td><td class="num ' + favCls(va.fav) + '">' + sgn(va.d) + '</td><td class="num ' + favCls(va.fav) + '">' + pctTxt(va.pct, true) + '</td>' + (o.ly ? '<td class="num">' + num(o.ly[i]) + '</td>' : '') + '</tr>';
      }).join('') + '</tbody></table></div></details>';
  }

  // ── pieces ───────────────────────────────────────────────────────────────
  function kpi(label, value, detail, cls, href, sub) {
    var tag = href ? 'a href="' + href + '"' : 'div';
    return '<' + tag + ' class="kpi"><span class="label">' + esc(label) + '</span><span class="v">' + value + '</span>' +
      (detail ? '<span class="d ' + (cls || '') + '"><i aria-hidden="true"></i><span>' + detail + '</span></span>' : '') + (sub ? '<span class="s">' + sub + '</span>' : '') + '</' + (href ? 'a' : 'div') + '>';
  }
  function statusTag(cm) {
    if (!cm) return '<span class="st none">' + th('No comment yet') + '</span>';
    return cm.status === 'explained' ? '<span class="st explained">' + th('Explained') + '</span>' : '<span class="st open">' + th('Open') + '</span>';
  }
  var editingC = {};
  function commentForm(key, line, month, scope, cm) {
    var id = keyId(key), prev = '';
    if (!cm && scope === 'ytd') {
      var older = db.comments.filter(function (c) { return c.line === line && c.scope === 'ytd' && c.month < month; }).sort(function (a, b) { return b.month - a.month; })[0];
      if (older) { var ot = E.commentText(older, LANG); prev = '<div class="prev"><b>' + th('Note through {month}:', { month: esc(monG(older.month)) }) + '</b> <span lang="' + ot.lang + '">' + esc(ot.text) + '</span> <button type="button" class="btn sm ghost" data-act="creuse" data-v="' + esc(key) + '" data-from="' + esc(older.id) + '">' + th('Use it') + '</button></div>'; }
    }
    var what = lnm(line) + ', ' + (scope === 'ytd' ? tx('year to date through {month}', { month: monG(month) }) : monL(month));
    // a new comment is written in the screen language unless you pick another
    var wl = (cm && cm.lang) || LANG;
    return '<form class="cf" data-k="' + esc(key) + '" novalidate>' + prev +
      '<label class="sr" for="ct-' + id + '">' + th('Explanation for {what}', { what: esc(what) }) + '</label>' +
      '<textarea class="in" id="ct-' + id + '" name="text" maxlength="1500" rows="2" placeholder="' + th('What happened, and will it continue?') + '">' + esc(cm ? cm.text : '') + '</textarea>' +
      translationFields(id, cm) +
      '<div class="row"><label class="sr" for="cl-' + id + '">' + th('Written in') + '</label><select class="in" id="cl-' + id + '" name="lang" title="' + th('The language the comment above is written in') + '">' + Object.keys(PACK_LANGS).map(function (k) { return '<option value="' + k + '"' + (wl === k ? ' selected' : '') + '>' + th({ en: 'Written in English', sl: 'Written in Slovenian', hr: 'Written in Croatian' }[k]) + '</option>'; }).join('') + '</select>' +
      '<label class="sr" for="cs-' + id + '">' + th('Status') + '</label><select class="in" id="cs-' + id + '" name="status"><option value="explained"' + (!cm || cm.status === 'explained' ? ' selected' : '') + '>' + th('Explained') + '</option><option value="open"' + (cm && cm.status === 'open' ? ' selected' : '') + '>' + th('Open: still finding out') + '</option></select>' +
      '<label class="sr" for="ca-' + id + '">' + th('Author') + '</label><input class="in grow" id="ca-' + id + '" name="author" maxlength="60" placeholder="' + th('Your name') + '" value="' + esc(cm ? cm.author : db.settings.author) + '">' +
      '<button type="submit" class="btn sm pri">' + th('Save') + '</button>' + (cm || editingC[key] ? '<button type="button" class="btn sm ghost" data-act="ccancel" data-v="' + esc(key) + '">' + th('Cancel') + '</button>' : '') +
      (cm ? '<button type="button" class="btn sm ghost" data-act="cdel" data-v="' + esc(key) + '">' + ic('trash') + th('Delete') + '</button>' : '') + '</div></form>';
  }
  /** The same comment in the board pack's other languages: empty prints the comment as written. */
  function translationFields(id, cm) {
    var tr = (cm && cm.texts) || {}, have = Object.keys(PACK_LANGS).filter(function (k) { return tr[k]; });
    return '<details class="trx"' + (have.length ? ' open' : '') + '><summary>' + th('Board pack text in other languages') + (have.length ? ' · ' + have.map(function (k) { return k.toUpperCase(); }).join(', ') : '') + '</summary><div class="trx-grid">' +
      ['sl', 'hr', 'en'].map(function (k) {
        return '<div class="field"><label for="cx' + k + '-' + id + '">' + esc(PACK_LANGS[k]) + '</label><textarea class="in" id="cx' + k + '-' + id + '" name="t_' + k + '" lang="' + k + '" rows="2" maxlength="1500" placeholder="' + th(k === 'en' ? 'Only when the comment is written in another language' : 'Empty: the pack prints the comment as written') + '">' + esc(tr[k] || '') + '</textarea></div>';
      }).join('') + '</div></details>';
  }
  /** The comment of a line/month/scope, or a form to write one (collapsed into a button when not asked for). */
  function commentArea(line, month, scope, collapsed) {
    var key = E.commentKey(line, month, scope), cm = model().cIdx[key];
    if (cm && !editingC[key]) {
      var langs = [cm.lang || 'en'].concat(Object.keys(cm.texts || {}).filter(function (k) { return cm.texts[k] && k !== (cm.lang || 'en'); }));
      // shown in the screen language when the comment has a text in it, otherwise as it was written
      var ct = E.commentText(cm, LANG);
      return '<p class="txt" lang="' + ct.lang + '">' + esc(ct.text) + '</p><div class="meta">' + esc(cm.author || tx('Someone')) + ' · ' + dt(cm.at) + (cm.edited && cm.edited !== cm.at ? ' · ' + th('edited {date}', { date: dt(cm.edited) }) : '') +
        ' · <span class="langs" title="' + th('Languages the board pack can print this comment in') + '">' + langs.map(function (k) { return k.toUpperCase(); }).join(' ') + '</span>' +
        ' <button type="button" class="btn sm ghost" data-act="cedit" data-v="' + esc(key) + '">' + th('Edit') + '</button></div>';
    }
    if (!cm && !editingC[key] && collapsed) return '<button type="button" class="btn sm" data-act="cedit" data-v="' + esc(key) + '">' + ic('plus') + th('Add a comment') + '</button>';
    return commentForm(key, line, month, scope, cm);
  }
  function variancePair(line, month, scope) {
    var m = model(), from = scope === 'ytd' ? 1 : month;
    var a = E.sumRange(m.actR[line], from, month), b = E.sumRange(m.budR[line], from, month);
    return E.variance(a, b, E.typeOf(line));
  }
  function exItem(line, month, scope, opts) {
    opts = opts || {};
    var m = model(), key = E.commentKey(line, month, scope), cm = m.cIdx[key], v = variancePair(line, month, scope), fl = m.fIdx[key];
    var when = scope === 'ytd' ? tx('Year to date · {range}', { range: range(1, month) }) : cap(monL(month)) + ' ' + m.y;
    var big = fl && fl.why === 'always' ? '<span class="tag big" title="' + th('Flagged by the rule in Settings: every variance of {amount} or more needs an explanation', { amount: esc(nf0.format(db.settings.alwaysAbs)) + ' €' }) + '">' + th('over {amount}', { amount: esc(nf0.format(db.settings.alwaysAbs)) + NB + '€' }) + '</span>' : '';
    return '<li id="ex-' + keyId(key) + '"><div class="ex-h"><a class="ln" href="#/line/' + line + '">' + esc(lnm(line)) + '</a><span class="tag">' + esc(when) + '</span>' + big + (fl || cm ? statusTag(cm) : '') +
      '<span class="vv ' + favCls(v.fav) + '" title="' + esc(favWord(v.fav)) + '">' + sgn(v.d) + NB + '€ · ' + pctTxt(v.pct, true) + '</span></div>' +
      '<div class="ex-sub">' + th('Actual {actual} · budget {budget}', { actual: eur(v.a), budget: eur(v.b) }) + (fl ? '' : ' · ' + th('within the thresholds')) + '</div>' +
      '<div class="ex-c">' + commentArea(line, month, scope, opts.collapsed && !fl) + '</div></li>';
  }

  // ── page: overview ───────────────────────────────────────────────────────
  function pageOverview() {
    var m = model(), c = m.closed, y = m.y, nc = nextCloseDate();
    var sub = esc(db.company.name) + ' · ' + (c ? th('actuals for {range} against {version}', { range: esc(range(1, c)), version: esc(vname(m.bud)) }) : th('no month closed yet, so only the budget')) +
      (c < 12 ? '. ' + th('The full-year outlook adds {version} for {range}.', { version: esc(vname(m.basis)), range: esc(range(c + 1, 12)) }) : '.');
    var h = head(th('Overview · closed through {date}', { date: c ? dt(E.monthEnd(y, c)) : th('no month yet') }), c ? tx('{year} so far', { year: y }) : tx('Budget {year}', { year: y }), sub,
      '<a class="btn" href="#/pl">' + ic('pl') + th('Profit and loss') + '</a><a class="btn pri" href="#/print">' + ic('print') + th('Board pack') + '</a>');
    var bar = '<div class="toolbar no-print board-bar"><span class="fpill"><small>' + th('Year') + '</small>' + y + '</span>' + (c ? '<span class="fpill"><small>' + th('Actuals') + '</small>' + esc(c > 1 ? mon(1) + '–' + mon(c) : mon(1)) + '</span>' : '') + '<span class="fpill"><small>' + th('Version') + '</small>' + esc(vname(m.bud)) + '</span>' +
      '<span class="label">' + th('Full-year outlook uses') + '</span>' + (m.fc ? basisSeg() : '<span class="tag">' + esc(vname(m.bud)) + '</span>') +
      (nc ? '<span class="grow"></span><span class="hint">' + th('{month} counts as closed from {date}', { month: esc(cap(monL(c + 1))), date: dt(nc) }) + (db.settings.closed === 'auto' ? '' : ' ' + th('(closing is set by hand in Settings)')) + '</span>' : '') + '</div>';
    h += bar;
    if (!c) {
      h += '<div class="notice"><p>' + th('No month of {year} is closed yet. Import January’s actuals, or set the closed month in Settings. Until then this page shows the budget only.', { year: y }) + '</p><a class="btn sm" href="#/import">' + th('Import actuals') + '</a></div>';
    }
    h += missingNotice();
    if (m.unmapped.length) h += '<div class="notice warn"><p>' + th('Accounts with actuals but no P&L line: {n} ({list}). They are left out of every total until you map them.', { n: m.unmapped.length, list: esc(m.unmapped.slice(0, 5).join(', ')) }) + '</p><a class="btn sm" href="#/settings">' + th('Map accounts') + '</a></div>';
    var revA = E.sumRange(m.actR.rev, 1, c), revB = E.sumRange(m.budR.rev, 1, c), rv = E.variance(revA, revB, 'income');
    var gmA = E.share(E.sumRange(m.actR.gm, 1, c), revA), gmB = E.share(E.sumRange(m.budR.gm, 1, c), revB);
    var ebA = E.sumRange(m.actR.ebitda, 1, c), ebB = E.sumRange(m.budR.ebitda, 1, c), ev = E.variance(ebA, ebB, 'income');
    var fyA = E.total(m.outR.ebitda), fyB = E.total(m.budR.ebitda), fv = E.variance(fyA, fyB, 'income');
    var gmD = gmA == null || gmB == null ? null : gmA - gmB;
    h += '<div class="kpis">' +
      kpi(tx('Revenue, year to date'), c ? keur(revA) : '—', c ? th('{pct} vs budget', { pct: pctTxt(rv.pct, true) }) + ' · ' + skeur(rv.d) : th('no closed month'), c ? kcls(rv.fav) : '', '#/line/rev', c ? th('Budget {amount}', { amount: keur(revB) }) : '') +
      kpi(tx('Gross margin, year to date'), gmA == null ? '—' : pctTxt(gmA), gmD == null ? th('no closed month') : th('{pct} vs budget', { pct: ppTxt(gmD) }), gmD == null ? '' : gmD > 0.05 ? 'good' : gmD < -0.05 ? 'bad' : '', '#/line/gm', gmB == null ? '' : th('Budget {amount}', { amount: pctTxt(gmB) }) + ' · ' + keur(E.sumRange(m.actR.gm, 1, c))) +
      kpi(tx('EBITDA, year to date'), c ? keur(ebA) : '—', c ? th('{pct} vs budget', { pct: skeur(ev.d) + ' (' + pctTxt(ev.pct, true) + ')' }) : th('no closed month'), c ? kcls(ev.fav) : '', '#/line/ebitda', c ? th('Budget {amount}', { amount: keur(ebB) }) + ' · ' + th('{pct} of revenue', { pct: pctTxt(E.share(ebA, revA)) }) : '') +
      kpi(tx('EBITDA, full-year outlook'), keur(fyA), th('{pct} vs budget', { pct: skeur(fv.d) + ' (' + pctTxt(fv.pct, true) + ')' }), fv.fav ? 'good' : fv.fav === false ? 'bad' : '', '#/line/ebitda', th('Budget {amount}', { amount: keur(fyB) }) + (c < 12 ? ' · ' + (m.basis === m.bud ? th('on the budget') : th('on {version}', { version: esc(vname(m.basis)) })) : '')) +
      '</div>';
    if (c) h += '<div class="grid2 board">' + plGridCard() + '<div class="stack">' + monthlyCard() + bridgeCard() + '</div></div>';
    else h += '<div class="grid21">' + monthlyCard() + bridgeCard() + '</div>';
    h += explainCard();
    return h;
  }
  /** The board's dense P&L grid: year to date, actual against the budget, in k€, down to EBITDA. */
  function plGridCard() {
    var m = model(), c = m.closed, out = '', flagged = {};
    m.flags.forEach(function (f) { if (f.scope === 'ytd') flagged[f.line] = true; });
    function k(v) { var e = Math.round(Math.abs(v) / 1e5); return (v < 0 && e ? MINUS : '') + nf0.format(e); }
    function sk(v) { var e = Math.round(Math.abs(v) / 1e5); return (e ? (v < 0 ? MINUS : '+') : '') + nf0.format(e); }
    for (var i = 0; i < E.ROWS.length; i++) {
      var r = E.ROWS[i];
      if (r.kind === 'head' || r.kind === 'pct') continue;
      var a = E.sumRange(m.actR[r.id], 1, c), b = E.sumRange(m.budR[r.id], 1, c), v = E.variance(a, b, r.type);
      var hot = v.fav === false && (flagged[r.id] || (r.kind === 'sub' && v.pct != null && Math.abs(v.pct) >= db.settings.pct));
      out += '<tr class="' + (r.kind === 'sub' ? (r.strong ? 'g-tot' : 'g-sub') : 'g-line') + '"><th scope="row"><a href="#/line/' + r.id + '">' + esc(rowName(r)) + '</a></th><td>' + k(a) + '</td><td>' + k(b) + '</td>' +
        '<td class="' + favCls(v.fav) + '">' + sk(v.d) + '</td><td class="' + favCls(v.fav) + (hot ? ' hot' : '') + '">' + pctTxt(v.pct, true) + '</td></tr>';
      if (r.id === 'ebitda') break;
    }
    return '<section class="card pl-grid"><div class="card-h"><div><span class="label">' + esc(range(1, c)) + ' ' + m.y + ' · k€</span><h2>' + th('P&L · actual vs budget') + '</h2></div><a class="btn sm no-print" href="#/pl">' + ic('pl') + th('Open the P&L') + '</a></div>' +
      '<div class="tw"><table class="t gt"><caption class="sr">' + th('Profit and loss down to EBITDA, {period}, actual against {version}, in thousands of euros', { period: esc(range(1, c)) + ' ' + m.y, version: esc(vname(m.bud)) }) + '</caption><thead><tr><th scope="col">' + th('Line') + '</th><th scope="col">' + th('Actual') + '</th><th scope="col">' + th('Budget') + '</th><th scope="col">' + th('Var') + '</th><th scope="col">' + th('Var %') + '</th></tr></thead><tbody>' + out + '</tbody></table></div></section>';
  }
  function monthlyCard() {
    var m = model(), which = uOv.chart === 'ebitda' ? 'ebitda' : 'rev';
    var o = { ac: m.actR[which], ou: m.outR[which], bu: m.budR[which], ly: which === 'rev' ? m.pyR.rev : null, closed: m.closed, type: 'income',
      names: { ac: tx('Actual'), ou: tx('Outlook'), bu: tx('Budget'), ly: String(m.y - 1) } };
    var legend = '<div class="legend"><span><i class="k-ac"></i>' + th('Actual') + '</span>' + (m.closed < 12 ? '<span><i class="k-ou"></i>' + th('Outlook ({version})', { version: esc(m.basis === m.bud ? tx('budget') : vname(m.basis)) }) + '</span>' : '') + '<span><i class="k-bu"></i>' + th('Budget') + '</span>' + (o.ly ? '<span><i class="k-ly"></i>' + (m.y - 1) + '</span>' : '') + '</div>';
    return '<section class="card"><div class="card-h"><div><span class="label">' + th('Month by month · {year}', { year: m.y }) + '</span><h2>' + th(which === 'rev' ? 'Revenue against budget and last year' : 'EBITDA against budget') + '</h2></div>' +
      '<div class="seg no-print" role="group" aria-label="' + th('Measure') + '"><button type="button" data-act="ovchart" data-v="rev" aria-pressed="' + (which === 'rev') + '">' + th('Revenue') + '</button><button type="button" data-act="ovchart" data-v="ebitda" aria-pressed="' + (which === 'ebitda') + '">EBITDA</button></div></div>' +
      '<div class="card-b">' + legend + '<div style="margin-top:10px">' + monthBars('chMonth', tx(which === 'rev' ? (o.ly ? 'Revenue per month: actual, outlook, budget and last year' : 'Revenue per month: actual, outlook, budget') : 'EBITDA per month: actual, outlook, budget'), o) + '</div>' + monthTable(o) + '</div></section>';
  }
  function bridgeCard() {
    var m = model(), fy = uOv.bridge === 'fy' || !m.closed;
    var br = fy ? E.bridge(m.bud.values, m.out, 1, 12) : E.bridge(m.bud.values, m.act, 1, m.closed);
    var sl = fy ? tx('Budget, full year') : tx('Budget, {range}', { range: range(1, m.closed) }), el = fy ? tx('Outlook, full year') : tx('Actual, {range}', { range: range(1, m.closed) });
    return '<section class="card"><div class="card-h"><div><span class="label">' + th(fy ? 'EBITDA bridge · full year' : 'EBITDA bridge · year to date') + '</span><h2>' + th(fy ? 'From budget to outlook' : 'From budget to actual') + '</h2></div>' +
      '<div class="seg no-print" role="group" aria-label="' + th('Period') + '"><button type="button" data-act="ovbridge" data-v="ytd" aria-pressed="' + !fy + '"' + (m.closed ? '' : ' disabled') + '>' + th('Year to date') + '</button><button type="button" data-act="ovbridge" data-v="fy" aria-pressed="' + fy + '">' + th('Full year') + '</button></div></div>' +
      '<div class="card-b">' + bridgeList(br, { compact: 9, link: true, startLabel: tx('Budget EBITDA'), endLabel: tx(fy ? 'Outlook EBITDA' : 'Actual EBITDA') }) +
      '<div class="legend wf-note"><span><i class="k-up"></i>' + th('Adds to EBITDA') + '</span><span><i class="k-down"></i>' + th('Takes away') + '</span></div>' + bridgeTable(br, sl, el) + '</div></section>';
  }
  function explainCard() {
    var m = model(), c = m.closed, items = [];
    m.flags.forEach(function (f) {
      var cm = m.cIdx[E.commentKey(f.line, f.month, f.scope)], grp = f.scope === 'ytd' ? 0 : f.month === c ? 1 : 2;
      if (grp === 2 && cm && cm.status === 'explained') return;
      items.push({ f: f, cm: cm, grp: grp, done: cm && cm.status === 'explained' ? 1 : 0 });
    });
    items.sort(function (a, b) { return a.grp - b.grp || a.done - b.done || (a.grp === 2 ? b.f.month - a.f.month : 0) || Math.abs(b.f.effect) - Math.abs(a.f.effect); });
    var s = db.settings, open = items.filter(function (x) { return !x.done; }).length;
    var thv = { pct: nfx.format(s.pct) + NB + '%', month: nf0.format(s.monthAbs) + NB + '€', ytd: nf0.format(s.ytdAbs) + NB + '€', always: nf0.format(s.alwaysAbs) + NB + '€' };
    var hdr = '<div class="card-h"><div><span class="label">' + th('Needs an explanation · {status}', { status: open ? th('{n} open', { n: open }) : th('all explained') }) + '</span><h2>' + th(s.alwaysAbs ? 'Variances over {pct} and {month} in a month, or {ytd} year to date, and every variance over {always}' : 'Variances over {pct} and {month} in a month, or {ytd} year to date', thv) + '</h2></div>' +
      '<a class="btn sm no-print" href="#/comments">' + ic('chat') + th('All comments') + '</a></div>';
    if (!c) return '<section class="card">' + hdr + '<div class="card-b"><p class="empty">' + th('Nothing to explain until the first month is closed.') + '</p></div></section>';
    if (!items.length) return '<section class="card">' + hdr + '<div class="card-b"><div class="empty-state">' + ic('check') + '<p>' + th('Every line is within the thresholds against the budget. Nothing needs explaining.') + '</p></div></div></section>';
    var groups = [[tx('Year to date, {range}', { range: range(1, c) }), 0], [tx('{month}, the month just closed', { month: cap(monL(c)) + ' ' + m.y }), 1], [tx('Still open from earlier months'), 2]];
    var h = '<section class="card">' + hdr + '<div class="card-b">';
    groups.forEach(function (g) {
      var list = items.filter(function (x) { return x.grp === g[1]; });
      if (!list.length) return;
      h += '<h3 class="mgroup">' + esc(g[0]) + '</h3><ul class="ex">' + list.map(function (x) { return exItem(x.f.line, x.f.month, x.f.scope); }).join('') + '</ul>';
    });
    return h + '</div></section>';
  }

  // ── page: profit and loss ────────────────────────────────────────────────
  function plState() {
    var m = model(), c = m.closed;
    var per = ['month', 'quarter', 'ytd', 'fy'].indexOf(uPl.per) >= 0 ? uPl.per : 'ytd';
    if (!c) per = 'fy';
    var month = uPl.month >= 1 && uPl.month <= c ? uPl.month : c;
    var q = uPl.q >= 1 && uPl.q <= 4 && uPl.q * 3 - 2 <= c ? uPl.q : Math.max(1, Math.ceil(c / 3));
    var cmp = uPl.cmp === 'forecast' && m.fc ? 'forecast' : uPl.cmp === 'ly' ? 'ly' : 'budget';
    var p = per === 'month' ? E.period('month', month, c) : per === 'quarter' ? E.period('quarter', q, c) : per === 'ytd' ? E.period('ytd', 0, c) : E.period('fy', 12, c);
    var label = per === 'month' ? cap(monL(month)) + ' ' + m.y : per === 'quarter' ? 'Q' + q + ' ' + m.y + (p.partial ? ' ' + tx('to date ({range})', { range: range(p.from, p.to) }) : '') : per === 'ytd' ? cap(range(1, c)) + ' ' + m.y : tx(c < 12 ? 'Full year {year} (outlook)' : 'Full year {year}', { year: m.y });
    // file names stay English (slug): the label and the comparison in English
    var enRange = function (f, t) { return f > t ? 'no months' : f === t ? E.MONTHS_LONG[f - 1] : E.MONTHS_LONG[f - 1] + '–' + E.MONTHS_LONG[t - 1]; };
    var fileLabel = per === 'month' ? E.MONTHS_LONG[month - 1] + ' ' + m.y : per === 'quarter' ? 'Q' + q + ' ' + m.y + (p.partial ? ' to date (' + enRange(p.from, p.to) + ')' : '') : per === 'ytd' ? enRange(1, c) + ' ' + m.y : 'Full year ' + m.y + (c < 12 ? ' (outlook)' : '');
    return { per: per, month: month, q: q, cmp: cmp, p: p, a: per === 'fy' ? m.outR : m.actR, b: cmpRows(cmp), label: label, fileLabel: fileLabel, aName: tx(per === 'fy' && c < 12 ? 'Outlook' : 'Actual'), bName: cmpShort(cmp) };
  }
  function accountsOf(line) { return db.accounts.filter(function (a) { return a.line === line; }).sort(function (x, y) { return x.code < y.code ? -1 : 1; }); }
  function accVal(acc, year, from, to) { var arr = (db.actuals[year] || {})[acc.code]; return arr ? E.accountSign(acc) * E.sumRange(arr, from, to) : 0; }
  function pagePl() {
    var m = model(), s = plState(), c = m.closed;
    var h = head(th('Profit and loss · amounts in €'), s.label, (s.per === 'fy' && c < 12 ? th('Actuals for {closed} plus {version} for {open}, against {cmp}.', { closed: esc(range(1, c)), version: esc(vname(m.basis)), open: esc(range(c + 1, 12)), cmp: esc(cmpLong(s.cmp)) }) : th('Actual against {cmp}.', { cmp: esc(cmpLong(s.cmp)) })) + ' ' + th('Click a line to open it, or the arrow to see its accounts.'),
      '<button type="button" class="btn" data-act="plcsv">' + ic('dl') + th('Export CSV') + '</button><button type="button" class="btn" data-act="print">' + ic('print') + th('Print') + '</button>');
    var per = [['month', 'Month'], ['quarter', 'Quarter'], ['ytd', 'Year to date'], ['fy', 'Full year']];
    h += '<div class="toolbar no-print"><div class="seg" role="group" aria-label="' + th('Period') + '">' + per.map(function (x) {
      return '<button type="button" data-act="plper" data-v="' + x[0] + '" aria-pressed="' + (s.per === x[0]) + '"' + (!c && x[0] !== 'fy' ? ' disabled' : '') + '>' + th(x[1]) + '</button>';
    }).join('') + '</div>';
    if (s.per === 'month') { var mo = ''; for (var i = c; i >= 1; i--) mo += '<option value="' + i + '"' + (i === s.month ? ' selected' : '') + '>' + esc(cap(monL(i))) + ' ' + m.y + '</option>'; h += '<label class="sr" for="plMonth">' + th('Month') + '</label><select class="select" id="plMonth" data-ch="plmonth">' + mo + '</select>'; }
    if (s.per === 'quarter') { var qo = ''; for (var q = 1; q <= 4; q++) if (q * 3 - 2 <= c) qo += '<option value="' + q + '"' + (q === s.q ? ' selected' : '') + '>Q' + q + ' ' + m.y + '</option>'; h += '<label class="sr" for="plQ">' + th('Quarter') + '</label><select class="select" id="plQ" data-ch="plq">' + qo + '</select>'; }
    if (s.per === 'fy' && m.fc && c < 12) h += basisSeg(tx('Outlook uses'));
    h += '<span class="grow"></span><div class="seg" role="group" aria-label="' + th('Compare with') + '"><button type="button" data-act="plcmp" data-v="budget" aria-pressed="' + (s.cmp === 'budget') + '">' + th('vs Budget') + '</button>' +
      '<button type="button" data-act="plcmp" data-v="forecast" aria-pressed="' + (s.cmp === 'forecast') + '"' + (m.fc ? '' : ' disabled title="' + th('No forecast yet: create one on Budget & forecast') + '"') + '>' + th('vs Forecast') + '</button>' +
      '<button type="button" data-act="plcmp" data-v="ly" aria-pressed="' + (s.cmp === 'ly') + '">' + th('vs {year}', { year: m.y - 1 }) + '</button></div>' +
      '<button type="button" class="chip" data-act="plpct" aria-pressed="' + !!uPl.pctRev + '">' + th('% of revenue') + '</button>' +
      '<button type="button" class="btn sm ghost" data-act="plall">' + th(Object.keys(uPl.open).some(function (k) { return uPl.open[k]; }) ? 'Collapse all' : 'Expand all') + '</button></div>';
    h += missingNotice();
    var p = s.p, revA = E.sumRange(s.a.rev, p.from, p.to), revB = E.sumRange(s.b.rev, p.from, p.to);
    var flagged = {};
    if (s.cmp === 'budget' && (s.per === 'month' || s.per === 'ytd')) m.flags.forEach(function (f) { if (s.per === 'month' ? f.scope === 'month' && f.month === s.month : f.scope === 'ytd') flagged[f.line] = true; });
    var cols = 5 + (uPl.pctRev ? 2 : 0);
    var t = '<div class="tw pl-wrap"><table class="t pl"><caption class="sr">' + th('Profit and loss, {period}, {actual} against {cmp}', { period: esc(s.label), actual: esc(s.aName), cmp: esc(cmpLong(s.cmp)) }) + '</caption><thead><tr><th class="lc" scope="col">' + th('Line') + '</th><th class="num" scope="col">' + esc(s.aName) + '</th><th class="num cb" scope="col">' + esc(s.bName) + '</th><th class="num" scope="col" title="' + th('Difference: {a} minus {b}', { a: esc(s.aName.toLowerCase()), b: esc(s.bName.toLowerCase()) }) + '">Δ</th><th class="num" scope="col">Δ %</th>' +
      (uPl.pctRev ? '<th class="num" scope="col">' + th('% rev.') + '</th><th class="num cb" scope="col">' + esc(s.bName) + ' ' + th('% rev.') + '</th>' : '') + '</tr></thead><tbody>';
    E.ROWS.forEach(function (r) {
      if (r.kind === 'head') { t += '<tr class="sec"><th scope="rowgroup">' + esc(rowName(r)) + '</th><td colspan="' + (cols - 1) + '"></td></tr>'; return; }
      if (r.kind === 'pct') {
        var pa = E.share(E.sumRange(s.a[r.of], p.from, p.to), revA), pb = E.share(E.sumRange(s.b[r.of], p.from, p.to), revB), d = pa == null || pb == null ? null : pa - pb;
        t += '<tr class="pct"><th scope="row">' + esc(rowName(r)) + '</th><td class="num">' + pctTxt(pa) + '</td><td class="num cb">' + pctTxt(pb) + '</td><td class="num d ' + (d == null ? '' : d > 0.05 ? 'pos' : d < -0.05 ? 'neg' : '') + '">' + ppTxt(d) + '</td><td class="num"></td>' + (uPl.pctRev ? '<td></td><td class="cb"></td>' : '') + '</tr>';
        return;
      }
      var a = E.sumRange(s.a[r.id], p.from, p.to), b = E.sumRange(s.b[r.id], p.from, p.to), v = E.variance(a, b, r.type);
      var cls = r.kind === 'sub' ? 'subt' + (r.strong ? ' strong' : '') : 'line', open = r.kind === 'line' && uPl.open[r.id];
      var name = r.kind === 'line' ? '<button type="button" class="xbtn" data-act="plx" data-v="' + r.id + '" aria-expanded="' + !!open + '" aria-label="' + th('Accounts of {line}', { line: esc(rowName(r)) }) + '">' + ic('chev') + '</button><a class="lname" href="#/line/' + r.id + '">' + esc(rowName(r)) + '</a>' + (flagged[r.id] ? '<span class="flag" title="' + th('Needs an explanation') + '"><span class="sr">' + th('Needs an explanation') + '</span></span>' : '')
        : '<a class="lname" href="#/line/' + r.id + '">' + esc(rowName(r)) + '</a>';
      t += '<tr class="' + cls + '"><th scope="row">' + name + '</th><td class="num">' + num(a) + '</td><td class="num cb">' + num(b) + '</td><td class="num d ' + favCls(v.fav) + '" title="' + esc(favWord(v.fav)) + '">' + sgn(v.d) + '</td><td class="num dp ' + favCls(v.fav) + '">' + pctTxt(v.pct, true) + '</td>' +
        (uPl.pctRev ? '<td class="num rv">' + pctTxt(E.share(a, revA)) + '</td><td class="num rv cb">' + pctTxt(E.share(b, revB)) + '</td>' : '') + '</tr>';
      if (open) t += accountRows(r.id, s, revA, revB);
    });
    t += '</tbody></table></div>';
    var phoneNote = '<p class="pl-phone">Δ = ' + esc(s.aName.toLowerCase()) + ' − ' + esc(cmpLong(s.cmp)) + '. ' + th(s.cmp === 'budget' ? 'Open a line for the budget and its months.' : s.cmp === 'forecast' ? 'Open a line for the forecast and its months.' : 'Open a line for the {year} amount and its months.', { year: m.y - 1 }) + '</p>';
    h += '<section class="card">' + phoneNote + t + '<div class="pl-foot"><span>' + th(s.cmp === 'budget' ? '{green} is favourable, {red} unfavourable: more income or less cost than the budget.' : s.cmp === 'forecast' ? '{green} is favourable, {red} unfavourable: more income or less cost than the forecast.' : '{green} is favourable, {red} unfavourable: more income or less cost than last year.', { green: '<span class="pos">' + th('Green') + '</span>', red: '<span class="neg">' + th('red') + '</span>' }) + '</span>' + (Object.keys(flagged).length ? '<span><span class="flag" style="display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--bad-dot)"></span> ' + th('needs an explanation') + '</span>' : '') + '<span>' + th('Subtotals are computed from the lines.') + '</span></div></section>';
    return h;
  }
  function accountRows(line, s, revA, revB) {
    var m = model(), p = s.p, accs = accountsOf(line), out = '', lyCmp = s.cmp === 'ly', fyOpen = s.per === 'fy' && m.closed < 12;
    var to = s.per === 'fy' ? m.closed : p.to;
    accs.forEach(function (acc) {
      var a = accVal(acc, m.y, p.from, to), b = lyCmp ? accVal(acc, m.y - 1, p.from, p.to) : null;
      if (!a && !b) return;
      var v = b == null ? null : E.variance(a, b, E.LINE[line].type);
      out += '<tr class="acc"><th scope="row"><span class="code">' + esc(acc.code) + '</span>' + esc(acc.name) + '</th><td class="num">' + num(a) + '</td><td class="num cb">' + (b == null ? '<span class="muted" title="' + th('The comparison is set per line, not per account') + '">·</span>' : num(b)) + '</td>' +
        '<td class="num ' + (v ? favCls(v.fav) : '') + '">' + (v ? sgn(v.d) : '') + '</td><td class="num ' + (v ? favCls(v.fav) : '') + '">' + (v ? pctTxt(v.pct, true) : '') + '</td>' +
        (uPl.pctRev ? '<td class="num rv">' + pctTxt(E.share(a, revA)) + '</td><td class="num rv cb">' + (b == null ? '' : pctTxt(E.share(b, revB))) + '</td>' : '') + '</tr>';
    });
    if (fyOpen) {
      var planned = E.sumRange(m.outR[line], m.closed + 1, 12);
      out += '<tr class="acc"><th scope="row"><span class="code">' + esc(mon(m.closed + 1)) + '–' + esc(mon(12)) + '</span>' + th('Open months, {version} (set per line)', { version: esc(m.basis === m.bud ? tx('budget') : vname(m.basis)) }) + '</th><td class="num">' + num(planned) + '</td><td class="cb"></td><td></td><td></td>' + (uPl.pctRev ? '<td></td><td class="cb"></td>' : '') + '</tr>';
    }
    if (!out) out = '<tr class="acc"><th scope="row" colspan="' + (uPl.pctRev ? 7 : 5) + '" class="muted">' + th('No actuals on this line’s accounts in this period.') + '</th></tr>';
    return out;
  }
  function plCsv() {
    var m = model(), s = plState(), p = s.p, rows = [[tx('level'), tx('account'), tx('line'), s.aName.toLowerCase(), s.bName.toLowerCase(), tx('difference'), tx('difference %'), tx('% of revenue')]];
    var revA = E.sumRange(s.a.rev, p.from, p.to);
    function pc(x) { return x == null ? '' : (Math.round(x * 10) / 10).toFixed(1).replace('.', ','); }
    E.ROWS.forEach(function (r) {
      if (r.kind === 'head') return;
      if (r.kind === 'pct') {
        var pa = E.share(E.sumRange(s.a[r.of], p.from, p.to), revA), pb = E.share(E.sumRange(s.b[r.of], p.from, p.to), E.sumRange(s.b.rev, p.from, p.to));
        rows.push([tx('margin'), '', rowName(r), pc(pa), pc(pb), pa == null || pb == null ? '' : pc(pa - pb), '', '']); return;
      }
      var a = E.sumRange(s.a[r.id], p.from, p.to), b = E.sumRange(s.b[r.id], p.from, p.to), v = E.variance(a, b, r.type);
      rows.push([tx(r.kind === 'sub' ? 'subtotal' : 'line'), '', rowName(r), E.centsText(a), E.centsText(b), E.centsText(v.d), pc(v.pct), pc(E.share(a, revA))]);
      if (r.kind === 'line') accountsOf(r.id).forEach(function (acc) {
        var aa = accVal(acc, m.y, p.from, s.per === 'fy' ? m.closed : p.to), bb = s.cmp === 'ly' ? accVal(acc, m.y - 1, p.from, p.to) : null;
        if (aa || bb) rows.push([tx('account'), acc.code, acc.name, E.centsText(aa), bb == null ? '' : E.centsText(bb), bb == null ? '' : E.centsText(aa - bb), bb == null ? '' : pc(E.pctVar(aa, bb)), pc(E.share(aa, revA))]);
      });
    });
    download('pl-' + m.y + '-' + slug(s.fileLabel) + '-vs-' + (s.cmp === 'ly' ? m.y - 1 : s.cmp) + '.csv', E.toCsv(rows, ';'));
  }

  // ── page: one line ───────────────────────────────────────────────────────
  function subTerms(id, sign, out) {
    out = out || []; sign = sign || 1;
    if (E.LINE[id]) { out.push([id, sign]); return out; }
    E.SUB[id].terms.forEach(function (t) { subTerms(t[0], sign * t[1], out); });
    return out;
  }
  function pageLine(id) {
    if (!E.LINE[id] && !E.SUB[id]) return head(th('Profit and loss'), tx('Not found'), th('There is no P&L line called “{id}”.', { id: esc(id) }), '') + '<a class="btn" href="#/pl">' + ic('back') + th('Back to the P&L') + '</a>';
    var m = model(), c = m.closed, isLine = !!E.LINE[id], type = E.typeOf(id), name = lnm(id), accs = isLine ? accountsOf(id) : [];
    var sec = isLine ? secName(E.LINE[id].section) : tx('Subtotal');
    var h = '<a class="crumb no-print" href="#/pl">' + ic('back') + th('Profit and loss') + '</a>';
    h += head(esc(sec) + ' · ' + th(type === 'cost' ? 'cost: lower is better' : 'income: higher is better'), name, esc(LINE_HINT[id] ? tx(LINE_HINT[id]) : '') + (isLine ? ' · ' + plural(accs.length, 'account', 'accounts') : ''),
      isLine ? '<a class="btn" href="#/budget" data-act="budline" data-v="' + id + '">' + ic('grid') + th('Edit the budget') + '</a>' : '');
    var ya = E.sumRange(m.actR[id], 1, c), yb = E.sumRange(m.budR[id], 1, c), yv = E.variance(ya, yb, type);
    var fa = E.total(m.outR[id]), fb = E.total(m.budR[id]), fv = E.variance(fa, fb, type);
    var la = E.sumRange(m.pyR[id], 1, c), lv = E.variance(ya, la, type);
    var revA = E.sumRange(m.actR.rev, 1, c), revB = E.sumRange(m.budR.rev, 1, c);
    var sa = E.share(ya, revA), sb = E.share(yb, revB);
    h += '<div class="kpis">' +
      kpi(tx('Year to date'), c ? keur(ya) : '—', c ? th('{pct} vs budget', { pct: skeur(yv.d) + ' (' + pctTxt(yv.pct, true) + ')' }) : th('no closed month'), yv.fav ? 'good' : yv.fav === false ? 'bad' : '', '', c ? th('Budget {amount}', { amount: keur(yb) }) + ' · ' + esc(range(1, c)) : '') +
      kpi(tx('Full-year outlook'), keur(fa), th('{pct} vs budget', { pct: skeur(fv.d) + ' (' + pctTxt(fv.pct, true) + ')' }), fv.fav ? 'good' : fv.fav === false ? 'bad' : '', '', th('Budget {amount}', { amount: keur(fb) })) +
      kpi(tx('Against {year}', { year: m.y - 1 }), c ? pctTxt(lv.pct, true) : '—', c ? th('{amount} on the same months', { amount: skeur(lv.d) }) : '', lv.fav ? 'good' : lv.fav === false ? 'bad' : '', '', c ? (m.y - 1) + ': ' + keur(la) : '') +
      (id === 'rev' ? '' : kpi(tx('Share of revenue'), sa == null ? '—' : pctTxt(sa), sa == null || sb == null ? '' : th('{pct} vs budget', { pct: ppTxt(sa - sb) }), '', '', sb == null ? '' : th('Budget {amount}', { amount: pctTxt(sb) }))) + '</div>';
    var o = { ac: m.actR[id], ou: m.outR[id], bu: m.budR[id], ly: m.pyR[id], closed: c, type: type, names: { ac: tx('Actual'), ou: tx('Outlook'), bu: tx('Budget'), ly: String(m.y - 1) } };
    var legend = '<div class="legend"><span><i class="k-ac"></i>' + th('Actual') + '</span>' + (c < 12 ? '<span><i class="k-ou"></i>' + th('Outlook') + '</span>' : '') + '<span><i class="k-bu"></i>' + th('Budget') + '</span><span><i class="k-ly"></i>' + (m.y - 1) + '</span></div>';
    var legend2 = '<div class="legend"><span><i class="k-lnac"></i>' + th('Actual') + '</span>' + (c < 12 ? '<span><i class="k-lnou"></i>' + th('Outlook') + '</span>' : '') + '<span><i class="k-lnbu"></i>' + th('Budget') + '</span><span><i class="k-ly"></i>' + (m.y - 1) + '</span></div>';
    h += '<div class="grid2"><section class="card"><div class="card-h"><div><span class="label">' + th('Month by month') + '</span><h2>' + th('Actual, budget and last year') + '</h2></div></div><div class="card-b">' + legend + '<div style="margin-top:10px">' + monthBars('chLine', tx('{line} per month', { line: name }), o) + '</div>' + monthTable(o) + '</div></section>' +
      '<section class="card"><div class="card-h"><div><span class="label">' + th('Cumulative') + '</span><h2>' + th('Running total through the year') + '</h2></div></div><div class="card-b">' + legend2 + '<div style="margin-top:10px">' + cumLines('chCum', tx('{line}, running total', { line: name }), o) + '</div>' + cumTable(o) + '</div></section></div>';
    h += isLine ? accountsCard(id, accs) : partsCard(id);
    if (isLine) h += lineComments(id);
    return h;
  }
  function cumTable(o) {
    var a = 0, b = 0, l = 0;
    return '<details class="tbl"><summary>' + th('Show as table') + '</summary><div class="tw"><table class="t compact"><thead><tr><th>' + th('Through') + '</th><th class="num">' + th('Actual / outlook') + '</th><th class="num">' + th('Budget') + '</th><th class="num">Δ</th><th class="num">' + (model().y - 1) + '</th></tr></thead><tbody>' +
      I.monthsLong.map(function (mn, i) { a += o.ou[i]; b += o.bu[i]; l += o.ly[i]; var v = E.variance(a, b, o.type); return '<tr><td>' + esc(cap(mn)) + '</td><td class="num">' + num(a) + '</td><td class="num">' + num(b) + '</td><td class="num ' + favCls(v.fav) + '">' + sgn(v.d) + '</td><td class="num">' + num(l) + '</td></tr>'; }).join('') + '</tbody></table></div></details>';
  }
  function accountsCard(id, accs) {
    var m = model(), c = m.closed, y = m.y, cols = '';
    for (var i = 1; i <= 12; i++) cols += '<th class="num" scope="col"' + (i > c ? ' style="opacity:.55"' : '') + '>' + mon(i) + '</th>';
    var rows = accs.map(function (acc) {
      var arr = (db.actuals[y] || {})[acc.code] || E.zeros(), sg = E.accountSign(acc), tds = '';
      for (var k = 1; k <= 12; k++) tds += '<td class="num">' + (k <= c ? num(sg * arr[k - 1]) : '<span class="muted">·</span>') + '</td>';
      return '<tr><td class="nw"><span class="mono">' + esc(acc.code) + '</span> ' + esc(acc.name) + (sg < 0 ? ' <span class="tag" title="' + th('Counts against this line') + '">−</span>' : '') + '</td>' + tds + '<td class="num"><b>' + num(accVal(acc, y, 1, c)) + '</b></td><td class="num muted">' + num(accVal(acc, y - 1, 1, c)) + '</td></tr>';
    }).join('');
    var tot = '', bud = '', dif = '';
    for (i = 1; i <= 12; i++) {
      var a = m.actR[id][i - 1], b = m.budR[id][i - 1], v = E.variance(a, b, E.typeOf(id));
      tot += '<td class="num">' + (i <= c ? num(a) : '<span class="muted">·</span>') + '</td>';
      bud += '<td class="num">' + num(b) + '</td>';
      dif += '<td class="num ' + (i <= c ? favCls(v.fav) : '') + '">' + (i <= c ? sgn(v.d) : '') + '</td>';
    }
    var ya = E.sumRange(m.actR[id], 1, c), yb = E.sumRange(m.budR[id], 1, c), yv = E.variance(ya, yb, E.typeOf(id));
    return '<section class="card mb"><div class="card-h"><div><span class="label">' + th(db.chart === 'si-2016' ? 'Slovenian chart of accounts (kontni okvir) · map yours in Settings' : 'Chart of accounts · map yours in Settings') + '</span><h2>' + th('Accounts by month') + '</h2></div><a class="btn sm no-print" href="#/settings">' + th('Mapping') + '</a></div>' +
      '<div class="tw"><table class="t compact"><thead><tr><th scope="col">' + th('Account') + '</th>' + cols + '<th class="num" scope="col">' + th('YTD') + '</th><th class="num" scope="col">' + (y - 1) + ' ' + th('YTD') + '</th></tr></thead><tbody>' + (rows || '<tr><td colspan="15" class="empty">' + th('No accounts are mapped to this line yet.') + '</td></tr>') + '</tbody>' +
      '<tfoot><tr><td>' + th('Line total') + '</td>' + tot + '<td class="num">' + num(ya) + '</td><td class="num">' + num(E.sumRange(m.pyR[id], 1, c)) + '</td></tr>' +
      '<tr><td>' + th('Budget') + '</td>' + bud + '<td class="num">' + num(yb) + '</td><td></td></tr>' +
      '<tr><td>' + th('Δ vs budget') + '</td>' + dif + '<td class="num ' + favCls(yv.fav) + '">' + sgn(yv.d) + '</td><td></td></tr></tfoot></table></div></section>';
  }
  function partsCard(id) {
    var m = model(), c = m.closed, terms = subTerms(id), cols = '';
    for (var i = 1; i <= 12; i++) cols += '<th class="num" scope="col"' + (i > c ? ' style="opacity:.55"' : '') + '>' + mon(i) + '</th>';
    function row(label, arr, strong) { var t = ''; for (var k = 1; k <= 12; k++) t += '<td class="num">' + num(arr[k - 1]) + '</td>'; return '<tr' + (strong ? ' class="subt"' : '') + '><td class="nw">' + label + '</td>' + t + '<td class="num"><b>' + num(E.total(arr)) + '</b></td></tr>'; }
    var body = terms.map(function (t) { return row((t[1] < 0 ? '− ' : '+ ') + '<a href="#/line/' + t[0] + '">' + esc(lnm(t[0])) + '</a>', m.outR[t[0]]); }).join('');
    return '<section class="card mb"><div class="card-h"><div><span class="label">' + th('Actual for closed months, outlook for open ones') + '</span><h2>' + th('What makes up {line}', { line: esc(lnm(id)) }) + '</h2></div></div><div class="tw"><table class="t compact"><thead><tr><th scope="col">' + th('Line') + '</th>' + cols + '<th class="num" scope="col">' + th('Year') + '</th></tr></thead><tbody>' + body + '</tbody><tfoot>' + row('= ' + esc(lnm(id)), m.outR[id], true) + '</tfoot></table></div></section>';
  }
  function lineComments(id) {
    var m = model(), c = m.closed, h = '';
    if (!c) return '';
    h += '<h3 class="mgroup">' + th('Year to date') + '</h3><ul class="ex">' + exItem(id, c, 'ytd', { collapsed: true }) + '</ul><h3 class="mgroup">' + th('By month') + '</h3><ul class="ex">';
    for (var i = c; i >= 1; i--) h += exItem(id, i, 'month', { collapsed: true });
    return '<section class="card"><div class="card-h"><div><span class="label">' + th('Comments against the budget') + '</span><h2>' + th('Why it happened') + '</h2></div></div><div class="card-b">' + h + '</ul></div></section>';
  }

  // ── page: budget and forecast editor ─────────────────────────────────────
  var undoStack = [], editing = null, GRID = [];
  function curVersion() {
    var v = db.versions.filter(function (x) { return x.id === uBud.vid; })[0];
    if (!v) { v = budgetV(); uBud.vid = v.id; }
    return v;
  }
  function frozenOf(v) { return v.kind === 'forecast' ? Math.max(0, Math.min(12, v.actualThrough || 0)) : 0; }
  function lockedMsg() { var v = curVersion(); return v.kind === 'budget' ? tx('{version} is approved and locked. Unlock it first, or plan in a forecast.', { version: vname(v) }) : tx('This version is locked.'); }
  function pushUndo(v, label, changes) { undoStack.push({ vid: v.id, label: label, changes: changes }); if (undoStack.length > 60) undoStack.shift(); }
  function gridRows() { return E.ROWS.filter(function (r) { return r.kind !== 'head'; }); }
  function pageBudget() {
    var m = model(), v = curVersion(), fr = frozenOf(v), rows = E.rowsOf(v.values);
    var status = v.kind === 'budget' ? (v.locked ? tx('Approved {date} · locked', { date: dt(v.approvedOn) }) : tx('Being edited · not approved')) : tx('Forecast made {date}', { date: dt(v.createdOn) }) + (fr ? ' · ' + tx('actuals for {range}', { range: range(1, fr) }) : '');
    var h = head(th('Budget & forecast · amounts in €'), vname(v), esc(v.note ? lx(v.note) : tx(v.kind === 'budget' ? 'The approved plan every report compares against.' : 'A reforecast: actuals for the closed months, a revised plan for the rest.')), '');
    var vs = db.versions.slice().sort(function (a, b) { return a.kind === b.kind ? (a.createdOn < b.createdOn ? -1 : 1) : a.kind === 'budget' ? -1 : 1; });
    var last = undoStack[undoStack.length - 1];
    h += '<div class="vbar no-print">' + (vs.length <= 4 ? '<div class="seg" role="group" aria-label="' + th('Version') + '">' + vs.map(function (x) { return '<button type="button" data-act="bver" data-v="' + esc(x.id) + '" aria-pressed="' + (x.id === v.id) + '">' + esc(vname(x)) + '</button>'; }).join('') + '</div>'
      : '<label class="sr" for="bVer">' + th('Version') + '</label><select class="select" id="bVer" data-ch="bver">' + vs.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === v.id ? ' selected' : '') + '>' + esc(vname(x)) + '</option>'; }).join('') + '</select>') +
      '<span class="lockpill' + (v.locked ? '' : ' open') + '">' + ic(v.locked ? 'lock' : 'unlock') + esc(status) + '</span><span class="grow"></span>' +
      '<button type="button" class="btn sm" id="undoBtn" data-act="undo"' + (last ? ' title="' + th('Undo: {change}', { change: esc(last.label) }) + '"' : ' disabled') + '>' + ic('undo') + th('Undo') + '</button>' +
      '<button type="button" class="btn sm" data-act="newfc"' + (m.closed ? '' : ' disabled title="' + th('Close a month first') + '"') + '>' + ic('fc') + th('New forecast') + '</button>' +
      (v.kind === 'budget' ? (v.locked ? '<button type="button" class="btn sm ghost" data-act="unlock">' + ic('unlock') + th('Unlock') + '</button>' : '<button type="button" class="btn sm pri" data-act="approve">' + ic('lock') + th('Approve and lock') + '</button>')
        : '<button type="button" class="btn sm ghost" data-act="delfc">' + ic('trash') + th('Delete') + '</button>') + '</div>';
    if (v.locked) h += '<div class="notice no-print"><p>' + th('{approved} and is locked, so every report keeps the same baseline. To plan the rest of the year, create a forecast from actuals + this version.', { approved: '<b>' + th('{version} was approved on {date}', { version: esc(vname(v)), date: dt(v.approvedOn) }) + '</b>' }) + '</p></div>';
    else if (fr) h += '<div class="notice no-print"><p>' + th('{closed}: these months hold the actuals from when this forecast was made and cannot be edited. The tools fill in {open} only.', { closed: esc(cap(range(1, fr))), open: esc(range(fr + 1, 12)) }) + '</p></div>';
    // wide grid
    GRID = gridRows();
    var thm = '';
    for (var i = 1; i <= 12; i++) thm += '<th class="num" scope="col">' + mon(i) + '</th>';
    var body = '';
    E.ROWS.forEach(function (r) {
      if (r.kind === 'head') { body += '<tr class="sec"><th class="lc" scope="rowgroup">' + esc(rowName(r)) + '</th><td colspan="15"></td></tr>'; return; }
      var ri = GRID.indexOf(r), cls = r.kind === 'sub' ? 'subt' + (r.strong ? ' strong' : '') : r.kind;
      var tool = r.kind === 'line' && !v.locked ? '<button type="button" class="btn icon sm ghost tool" data-act="tools" data-v="' + r.id + '" aria-label="' + th('Fill in {line} with a tool', { line: esc(rowName(r)) }) + '" title="' + th('Spread, copy or set as % of revenue') + '">' + ic('tools') + '</button>' : '';
      var tds = '';
      for (var k = 1; k <= 13; k++) {
        var ro = r.kind !== 'line' || v.locked || (k <= 12 && k <= fr) || (k === 13 && fr >= 12);
        tds += '<td class="c' + (k === 13 ? ' tot' : '') + (ro ? ' ro' : '') + (r.kind === 'line' && k <= fr ? ' frozen' : '') + '" role="gridcell" tabindex="-1" data-ri="' + ri + '" data-m="' + k + '" data-id="' + r.id + '" data-k="' + r.kind + '"' + (r.of ? ' data-of="' + r.of + '"' : '') + (ro ? ' aria-readonly="true"' : '') + '></td>';
      }
      tds += '<td class="c ly" data-id="' + r.id + '" data-k="' + r.kind + '"' + (r.of ? ' data-of="' + r.of + '"' : '') + ' data-m="14"></td><td class="c lyp" data-id="' + r.id + '" data-k="' + r.kind + '" data-m="15"' + (r.of ? ' data-of="' + r.of + '"' : '') + '></td>';
      body += '<tr class="' + cls + '"><th class="lc" scope="row"><div class="lcw"><span>' + esc(rowName(r)) + '</span>' + tool + '</div></th>' + tds + '</tr>';
    });
    var kbd = function (k) { return '<span class="kbd">' + k + '</span>'; };
    h += '<section class="card only-wide"><div class="tw" id="bgWrap"><table class="t bud" id="bgGrid" role="grid" aria-label="' + th('{version}, one row per line, one column per month', { version: esc(vname(v)) }) + '" aria-readonly="' + !!v.locked + '"><thead><tr><th class="lc" scope="col">' + th('Line') + '</th>' + thm + '<th class="num" scope="col">' + th('Total') + '</th><th class="num" scope="col">' + (m.y - 1) + '</th><th class="num" scope="col" title="' + th('Total against last year') + '">' + th('vs {year}', { year: m.y - 1 }) + '</th></tr></thead><tbody>' + body + '</tbody></table></div>' +
      '<div class="grid-help"><span>' + th('{keys} move', { keys: kbd('↑ ↓ ← →') }) + '</span><span>' + th('{enter} or type to edit, {enter} to save', { enter: kbd('Enter') }) + '</span><span>' + th('{tab} save and go right', { tab: kbd('Tab') }) + '</span><span>' + th('{esc} cancel', { esc: kbd('Esc') }) + '</span><span>' + th('{keys} undo', { keys: kbd('Ctrl Z') }) + '</span><span>' + th('Paste a block from Excel') + '</span><span>' + th('Type in Total to re-spread the year') + '</span><span>12.500 · 12500,50 · 12,5k</span></div></section>';
    // phone: one line at a time
    var lid = E.LINE[uBud.line] ? uBud.line : 'sales_si', li = E.LINES.map(function (l) { return l.id; }).indexOf(lid);
    var opts = lineOptions(lid);
    var list = '';
    for (i = 1; i <= 12; i++) {
      var ro2 = v.locked || i <= fr, val = v.values[lid][i - 1];
      list += '<li><label for="pm' + i + '">' + esc(cap(monL(i))) + '<small>' + (m.y - 1) + ': ' + num(m.py[lid][i - 1]) + '</small></label>' + (ro2 ? '<span class="ro" id="pm' + i + '">' + num(val) + '</span>' : '<input class="in" id="pm' + i + '" inputmode="decimal" autocomplete="off" data-pm="' + i + '" value="' + esc(inputNice(val)) + '">') + '</li>';
    }
    h += '<section class="card only-phone"><div class="ph-line"><button type="button" class="btn icon sm" data-act="phprev" aria-label="' + th('Previous line') + '"' + (li <= 0 ? ' disabled' : '') + '>' + ic('back') + '</button><label class="sr" for="phLine">' + th('Line') + '</label><select class="select" id="phLine" data-ch="phline">' + opts + '</select><button type="button" class="btn icon sm" data-act="phnext" aria-label="' + th('Next line') + '"' + (li >= E.LINES.length - 1 ? ' disabled' : '') + '>' + ic('chev') + '</button></div>' +
      '<ul class="ph-list">' + list + '</ul><div class="ph-tot"><span>' + th('Total {year}', { year: m.y }) + '</span><span id="phTot">' + eur(E.total(v.values[lid])) + '</span></div>' +
      '<div class="ph-subs" id="phSubs">' + phoneSubs(rows) + '</div>' +
      (v.locked ? '' : '<div class="ph-line" style="padding-top:0"><button type="button" class="btn" data-act="tools" data-v="' + lid + '">' + ic('tools') + th('Tools for this line') + '</button></div>') + '</section>';
    return h;
  }
  function phoneSubs(rows) {
    var m = model();
    return '<div><span>' + esc(lnm('rev')) + '</span><b>' + eur(E.total(rows.rev)) + '</b></div><div><span>' + esc(lnm('gm')) + '</span><b>' + eur(E.total(rows.gm)) + ' · ' + pctTxt(E.share(E.total(rows.gm), E.total(rows.rev))) + '</b></div>' +
      '<div><span>EBITDA</span><b>' + eur(E.total(rows.ebitda)) + ' · ' + pctTxt(E.share(E.total(rows.ebitda), E.total(rows.rev))) + '</b></div><div><span>' + esc(lnm('pbt')) + '</span><b>' + eur(E.total(rows.pbt)) + '</b></div>' +
      '<div><span>' + th('EBITDA {year}', { year: m.y - 1 }) + '</span><span>' + eur(E.total(m.pyR.ebitda)) + '</span></div>';
  }
  function inputText(c) { return c % 100 === 0 ? String(c / 100) : (c / 100).toFixed(2).replace('.', ','); }
  /** the same, grouped for reading (1.234.567 or -1.234,56); parseInput reads both */
  function inputNice(c) { var a = Math.abs(c); return (c < 0 ? '-' : '') + (a % 100 === 0 ? nf0.format(a / 100) : nf2.format(a / 100)); }
  function cellText(td, rows) {
    var id = td.getAttribute('data-id'), m = +td.getAttribute('data-m'), k = td.getAttribute('data-k'), mo = model();
    if (k === 'pct') {
      var of = td.getAttribute('data-of');
      if (m === 13) return pctTxt(E.share(E.total(rows[of]), E.total(rows.rev)));
      if (m === 14) return pctTxt(E.share(E.total(mo.pyR[of]), E.total(mo.pyR.rev)));
      if (m === 15) { var a = E.share(E.total(rows[of]), E.total(rows.rev)), b = E.share(E.total(mo.pyR[of]), E.total(mo.pyR.rev)); return a == null || b == null ? '—' : ppTxt(a - b); }
      return pctTxt(E.share(rows[of][m - 1], rows.rev[m - 1]));
    }
    if (m === 13) return num(E.total(rows[id]));
    if (m === 14) return num(E.total(mo.pyR[id]));
    if (m === 15) return pctTxt(E.pctVar(E.total(rows[id]), E.total(mo.pyR[id])), true);
    return num(rows[id][m - 1]);
  }
  function refreshGrid() {
    var v = curVersion(), rows = E.rowsOf(v.values), g = $('bgGrid');
    if (g) g.querySelectorAll('td.c').forEach(function (td) { if (editing && td === editing.td) return; td.textContent = cellText(td, rows); });
    var lid = E.LINE[uBud.line] ? uBud.line : 'sales_si';
    for (var i = 1; i <= 12; i++) { var el = $('pm' + i); if (el && el !== document.activeElement) { if (el.tagName === 'INPUT') el.value = inputNice(v.values[lid][i - 1]); else el.textContent = num(v.values[lid][i - 1]); el.removeAttribute('aria-invalid'); } }
    if ($('phTot')) $('phTot').textContent = eur(E.total(v.values[lid]));
    if ($('phSubs')) $('phSubs').innerHTML = phoneSubs(rows);
    var u = $('undoBtn'), last = undoStack[undoStack.length - 1];
    if (u) { u.disabled = !last; u.title = last ? tx('Undo: {change}', { change: last.label }) : ''; }
    renderNav();
  }
  function cellAt(ri, m) { return document.querySelector('#bgGrid td.c[data-ri="' + ri + '"][data-m="' + m + '"]'); }
  function focusCell(td) {
    if (!td) return;
    var g = $('bgGrid');
    if (g) g.querySelectorAll('td.c[tabindex="0"]').forEach(function (x) { x.setAttribute('tabindex', '-1'); });
    td.setAttribute('tabindex', '0'); td.focus();
    uBud.ri = +td.getAttribute('data-ri'); uBud.m = +td.getAttribute('data-m'); saveUiSoon();
  }
  function neighbor(td, dir) {
    var ri = +td.getAttribute('data-ri'), m = +td.getAttribute('data-m');
    if (dir === 'left') m--; else if (dir === 'right') m++; else if (dir === 'up') ri--; else if (dir === 'down') ri++;
    else if (dir === 'home') m = 1; else if (dir === 'end') m = 13;
    if (m < 1 || m > 13 || ri < 0 || ri >= GRID.length) return null;
    return cellAt(ri, m);
  }
  function canEdit(td) { return td && td.getAttribute('data-k') === 'line' && !td.classList.contains('ro'); }
  function startEdit(td, initial) {
    if (!canEdit(td)) {
      var v0 = curVersion();
      if (td && td.getAttribute('data-k') === 'line') toast(v0.locked ? lockedMsg() : tx('These months hold the actuals this forecast was made from.'));
      else if (td) toast(tx('Subtotals are computed from the lines.'));
      return;
    }
    var v = curVersion(), id = td.getAttribute('data-id'), m = +td.getAttribute('data-m');
    var cur = m === 13 ? E.total(v.values[id]) : v.values[id][m - 1];
    td.innerHTML = '<input class="cell-in" inputmode="decimal" autocomplete="off" spellcheck="false" aria-label="' + esc(lnm(id) + ', ' + (m === 13 ? tx('total for the year, spread over the months like now') : monL(m))) + '">';
    var inp = td.querySelector('input');
    editing = { td: td, input: inp, id: id, m: m, orig: cur };
    inp.value = initial != null ? initial : inputText(cur);
    inp.focus();
    if (initial == null) inp.select(); else inp.setSelectionRange(inp.value.length, inp.value.length);
  }
  function endEdit(save2, move) {
    if (!editing) return true;
    var ed = editing, val = E.parseInput(ed.input.value);
    if (save2 && isNaN(val)) { ed.input.setAttribute('aria-invalid', 'true'); toast(tx('Type a number, for example 12.500, 12500,50 or 12,5k')); ed.input.focus(); return false; }
    editing = null;
    if (save2 && val !== ed.orig) applyCell(ed.id, ed.m, val);
    ed.td.textContent = cellText(ed.td, E.rowsOf(curVersion().values));
    var nx = move ? neighbor(ed.td, move) : null;
    focusCell(nx || ed.td);
    return true;
  }
  function applyCell(id, m, val) {
    var v = curVersion(), before = v.values[id].slice(), fr = frozenOf(v), after;
    if (m === 13) {
      var frozenSum = E.sumRange(before, 1, fr);
      after = before.slice(0, fr).concat(E.rescale(before.slice(fr), val - frozenSum, model().py[id].slice(fr)));
    } else { after = before.slice(); after[m - 1] = val; }
    if (same(before, after)) return;
    pushUndo(v, lnm(id) + ', ' + (m === 13 ? tx('total') : monL(m)), [{ id: id, before: before, after: after }]);
    commit('', function () { v.values[id] = after; }, { noRender: true });
    refreshGrid();
  }
  function doUndo() {
    var u = undoStack.pop();
    if (!u) return toast(tx('Nothing to undo'));
    var v = db.versions.filter(function (x) { return x.id === u.vid; })[0];
    if (!v) return toast(tx('That version no longer exists'));
    if (v.locked) { undoStack.push(u); return toast(tx('{version} is locked. Unlock it to undo.', { version: vname(v) })); }
    commit('', function () { u.changes.forEach(function (ch) { v.values[ch.id] = ch.before.slice(); }); }, { noRender: true });
    if (uBud.vid !== v.id || parseRoute().name !== 'budget') { uBud.vid = v.id; saveUi(); render(); } else refreshGrid();
    toast(tx('Undone: {change}', { change: u.label }));
  }
  function pasteBlock(td, text) {
    var v = curVersion();
    if (v.locked) return toast(lockedMsg());
    var lines = text.replace(/\r/g, '').replace(/\n+$/, '').split('\n').map(function (l) { return l.split('\t'); });
    var ri0 = +td.getAttribute('data-ri'), m0 = +td.getAttribute('data-m'), changes = {}, bad = 0, n = 0;
    lines.forEach(function (cells, dr) {
      cells.forEach(function (raw, dc) {
        var cell = cellAt(ri0 + dr, m0 + dc);
        if (!cell || !canEdit(cell) || +cell.getAttribute('data-m') > 12) return;
        var val = E.parseInput(raw);
        if (isNaN(val)) { bad++; return; }
        var id = cell.getAttribute('data-id'), ch = changes[id] || (changes[id] = { id: id, before: v.values[id].slice(), after: v.values[id].slice() });
        ch.after[+cell.getAttribute('data-m') - 1] = val; n++;
      });
    });
    var list = Object.keys(changes).map(function (k) { return changes[k]; }).filter(function (ch) { return !same(ch.before, ch.after); });
    if (!list.length) return toast(tx(bad ? 'Nothing pasted: the clipboard has no numbers for these cells.' : 'Nothing changed.'));
    pushUndo(v, tx('paste of {cells}', { cells: plural(n, 'cell', 'cells') }), list);
    commit('', function () { list.forEach(function (ch) { v.values[ch.id] = ch.after; }); }, { noRender: true });
    refreshGrid();
    toast(tx('Pasted {cells}', { cells: plural(n, 'cell', 'cells') }) + (bad ? ', ' + tx('skipped (not numbers): {n}', { n: bad }) : ''));
  }
  function phoneCommit(inp) {
    var v = curVersion(), id = E.LINE[uBud.line] ? uBud.line : 'sales_si', mm = +inp.getAttribute('data-pm'), val = E.parseInput(inp.value);
    if (isNaN(val)) { inp.setAttribute('aria-invalid', 'true'); toast(tx('Type a number, for example 12.500 or 12500,50')); return; }
    inp.removeAttribute('aria-invalid');
    if (v.locked || mm <= frozenOf(v) || v.values[id][mm - 1] === val) { inp.value = inputNice(v.values[id][mm - 1]); return; }
    var before = v.values[id].slice(), after = before.slice(); after[mm - 1] = val;
    pushUndo(v, lnm(id) + ', ' + monL(mm), [{ id: id, before: before, after: after }]);
    commit('', function () { v.values[id] = after; }, { noRender: true });
    inp.value = inputNice(val);
    refreshGrid();
  }
  // tools: spread, copy with growth, % of revenue — with a preview
  var toolSt = null;
  function openTools(id) {
    var v = curVersion();
    if (v.locked) return toast(lockedMsg());
    var fr = frozenOf(v), n = 12 - fr;
    if (!n) return toast(tx('Every month of this forecast holds actuals.'));
    var cur = v.values[id].slice(fr), sec = E.LINE[id].section, m = model();
    toolSt = { id: id, fr: fr, cur: cur, ly: m.py[id].slice(fr), rev: E.rowsOf(v.values).rev.slice(fr), tool: 'seasonal' };
    var span = fr ? range(fr + 1, 12) : tx('the year');
    var curTot = E.sum(cur), share = E.share(E.sum(cur), E.sum(toolSt.rev));
    var opt = function (val, title, small, chk) { return '<div class="tool-opt"><label><input type="radio" name="tool" value="' + val + '"' + (chk ? ' checked' : '') + '>' + esc(title) + '</label><small>' + small + '</small></div>'; };
    var body = '<fieldset class="grp"><legend>' + th('How to fill in {span}', { span: esc(span) }) + '</legend>' +
      opt('seasonal', tx('Spread a total like last year'), th('Each month gets the share it had in {year}.', { year: m.y - 1 }), true) +
      opt('even', tx('Spread a total evenly'), th('The same amount every month; leftover euros go to the first months.')) +
      opt('growth', tx('Last year + growth'), th('{year} month by month, times (1 + growth %).', { year: m.y - 1 })) +
      (sec === 'rev' ? '' : opt('pct', tx('A share of revenue'), th('This version’s revenue × the percentage, month by month. Today: {pct}.', { pct: pctTxt(share) }))) +
      (id === 'cogs' ? opt('margin', tx('Cost of goods at a target margin'), th('Revenue × (100 % − margin). Freight is not included.')) : '') + '</fieldset>' +
      '<div class="tool-in"><div class="field" id="tfTotal"><label for="tTotal">' + th('Total for {span} (€)', { span: esc(span) }) + '</label><input class="in" id="tTotal" inputmode="decimal" autocomplete="off" value="' + esc(inputText(curTot)) + '"></div>' +
      '<div class="field" id="tfGrowth" hidden><label for="tGrowth">' + th('Growth (%)') + '</label><input class="in" id="tGrowth" inputmode="decimal" value="5"></div>' +
      '<div class="field" id="tfPct" hidden><label for="tPct">' + th('Share of revenue (%)') + '</label><input class="in" id="tPct" inputmode="decimal" value="' + esc(share == null ? '2' : String(Math.round(share * 10) / 10).replace('.', ',')) + '"></div>' +
      '<div class="field" id="tfMargin" hidden><label for="tMargin">' + th('Target gross margin (%)') + '</label><input class="in" id="tMargin" inputmode="decimal" value="' + esc(share == null ? '26' : String(Math.round((100 - share) * 10) / 10).replace('.', ',')) + '"></div></div>' +
      '<div id="toolPrev"></div><p class="hint">' + th('Tools fill in numbers once; they do not keep a formula. Totals are kept to the cent; whole-euro totals give whole-euro months. Undo puts the old numbers back.') + '</p>';
    modal(tx('Fill in {line}', { line: lnm(id) }), body, tx('Apply'), applyTool, { wide: true });
    toolPreview();
  }
  function pnum(s) { var t = String(s || '').trim().replace(/\s|%/g, '').replace(',', '.'); return t === '' ? NaN : Number(t); }
  function toolResult() {
    var st = toolSt, n = st.cur.length, t = st.tool;
    if (t === 'even' || t === 'seasonal') {
      var tot = E.parseInput($('tTotal').value);
      if (isNaN(tot)) return tx('Type the total, for example 120.000 or 120000,50.');
      return t === 'even' ? E.spreadEven(tot, n) : E.spreadSeasonal(tot, st.ly);
    }
    if (t === 'growth') {
      var g = pnum($('tGrowth').value);
      if (!isFinite(g) || g < -100 || g > 1000) return tx('Type the growth in %, for example 5 or -2,5.');
      if (!E.sum(st.ly.map(Math.abs))) return tx('Last year has no amounts on this line, so there is nothing to grow from.');
      return E.copyGrowth(st.ly, g);
    }
    var p = t === 'margin' ? 100 - pnum($('tMargin').value) : pnum($('tPct').value);
    if (!isFinite(p) || p < 0 || p > 1000) return tx(t === 'margin' ? 'Type the margin in %, for example 26.' : 'Type the share in %, for example 2 or 74,5.');
    if (!E.sum(st.rev)) return tx('This version has no revenue in these months yet. Fill in the revenue lines first.');
    return E.pctOf(st.rev, p);
  }
  function toolPreview() {
    if (!toolSt || !$('toolPrev')) return;
    var st = toolSt, chk = document.querySelector('#mdForm input[name=tool]:checked');
    st.tool = chk ? chk.value : 'seasonal';
    $('tfTotal').hidden = !(st.tool === 'even' || st.tool === 'seasonal');
    $('tfGrowth').hidden = st.tool !== 'growth';
    if ($('tfPct')) $('tfPct').hidden = st.tool !== 'pct';
    if ($('tfMargin')) $('tfMargin').hidden = st.tool !== 'margin';
    var res = toolResult();
    if (typeof res === 'string') { $('toolPrev').innerHTML = '<div class="err">' + esc(res) + '</div>'; st.res = null; return; }
    st.res = res;
    var rows = res.map(function (x, i) { var d = x - st.cur[i]; return '<tr><td>' + esc(cap(monL(st.fr + i + 1))) + '</td><td class="num">' + num(st.cur[i]) + '</td><td class="num"><b>' + num(x) + '</b></td><td class="num ' + (d ? favCls(E.variance(x, st.cur[i], E.typeOf(st.id)).fav) : '') + '">' + sgn(d) + '</td><td class="num muted">' + num(st.ly[i]) + '</td></tr>'; }).join('');
    var tn = E.sum(res), tc = E.sum(st.cur);
    $('toolPrev').innerHTML = '<div class="tw"><table class="t compact prev-t"><caption class="sr">' + th('Preview') + '</caption><thead><tr><th>' + th('Month') + '</th><th class="num">' + th('Now') + '</th><th class="num">' + th('New') + '</th><th class="num">Δ</th><th class="num">' + (model().y - 1) + '</th></tr></thead><tbody>' + rows + '</tbody><tfoot><tr><td>' + th('Total') + '</td><td class="num">' + num(tc) + '</td><td class="num"><b>' + num(tn) + '</b></td><td class="num">' + sgn(tn - tc) + '</td><td class="num muted">' + num(E.sum(st.ly)) + '</td></tr></tfoot></table></div>';
  }
  function applyTool() {
    var st = toolSt; if (!st) return;
    toolPreview();
    if (!st.res) return modalError(tx('Fix the input first.'));
    var v = curVersion(), before = v.values[st.id].slice(), after = before.slice(0, st.fr).concat(st.res);
    var names = { seasonal: 'spread like last year', even: 'spread evenly', growth: 'last year + growth', pct: '% of revenue', margin: 'target margin' };
    closeLayer();
    if (same(before, after)) return toast(tx('Nothing changed'));
    pushUndo(v, lnm(st.id) + ', ' + tx(names[st.tool]), [{ id: st.id, before: before, after: after }]);
    // the activity log is written in English and translated when it is shown
    commit(v.name + ': ' + E.nameOf(st.id) + ' filled in (' + names[st.tool] + ')', function () { v.values[st.id] = after; }, { noRender: true });
    refreshGrid();
    toast(tx('{line}: {tool}, total {amount}', { line: lnm(st.id), tool: tx(names[st.tool]), amount: eur(E.total(after)) }));
  }
  function newForecast() {
    var m = model(), v = curVersion(), c = m.closed;
    if (!c) return toast(tx('Close a month first.'));
    var name = E.forecastName(m.y, c), k = 2;
    while (db.versions.some(function (x) { return x.name === name; })) name = E.forecastName(m.y, c) + ' · ' + (k++);
    // the app's own name is kept in English and shown in the screen language (vname)
    var shown = lx(name);
    var enRange = function (f, t) { return f > t ? 'no months' : f === t ? E.MONTHS_LONG[f - 1] : E.MONTHS_LONG[f - 1] + '–' + E.MONTHS_LONG[t - 1]; };
    modal(tx('New forecast'), '<p>' + th('It takes the actuals for {closed} and {version} for {open}. You can then revise the open months. The full-year outlook uses the newest forecast.', { closed: '<b>' + esc(range(1, c)) + '</b>', version: '<b>' + esc(vname(v)) + '</b>', open: esc(range(c + 1, 12)) }) + '</p>' +
      '<div class="field"><label for="fcName">' + th('Name') + '</label><input class="in" id="fcName" maxlength="60" value="' + esc(shown) + '"></div>', tx('Create forecast'), function () {
      var nm = $('fcName').value.trim();
      if (nm === shown) nm = name;
      if (!nm) return modalError(tx('Give it a name.'));
      if (db.versions.some(function (x) { return x.name === nm || vname(x) === nm; })) return modalError(tx('A version with that name already exists.'));
      var nv = { id: 'fc-' + Date.now().toString(36), kind: 'forecast', name: nm, locked: false, createdOn: TODAY, basedOn: v.id, actualThrough: c, note: 'Made on ' + dt0(TODAY) + ' from actuals for ' + enRange(1, c) + ' and ' + v.name + ' for ' + enRange(c + 1, 12) + '.', values: E.makeForecast(m.act, v.values, c) };
      closeLayer();
      uBud.vid = nv.id; saveUi();
      commit('Created ' + nm, function () { db.versions.push(nv); if (db.settings.basis !== 'forecast') db.settings.basis = 'forecast'; });
      toast(tx('{version} created. The full-year outlook now uses it.', { version: vname(nv) }));
    });
  }

  // ── page: comments ───────────────────────────────────────────────────────
  function pageComments() {
    var m = model(), all = {}, list = [];
    db.comments.forEach(function (c) { var k = E.commentKey(c.line, c.month, c.scope); all[k] = { line: c.line, month: c.month, scope: c.scope, cm: c, fl: m.fIdx[k] || null }; });
    m.flags.forEach(function (f) { var k = E.commentKey(f.line, f.month, f.scope); if (!all[k]) all[k] = { line: f.line, month: f.month, scope: f.scope, cm: null, fl: f }; });
    Object.keys(all).forEach(function (k) { list.push(all[k]); });
    var cnt = { attention: 0, none: 0, open: 0, explained: 0, all: list.length };
    list.forEach(function (x) { if (!x.cm) { cnt.none++; if (x.fl) cnt.attention++; } else if (x.cm.status === 'open') { cnt.open++; cnt.attention++; } else cnt.explained++; });
    var f = uCm.f in cnt ? uCm.f : 'attention';
    var shown = list.filter(function (x) {
      if (uCm.line && x.line !== uCm.line) return false;
      if (f === 'attention') return !x.cm ? !!x.fl : x.cm.status === 'open';
      if (f === 'none') return !x.cm;
      if (f === 'open') return x.cm && x.cm.status === 'open';
      if (f === 'explained') return x.cm && x.cm.status === 'explained';
      return true;
    }).sort(function (a, b) { return b.month - a.month || (a.scope === 'ytd' ? -1 : 0) - (b.scope === 'ytd' ? -1 : 0) || E.LINE[a.line].order - E.LINE[b.line].order; });
    var h = head(th('Comments · against {version}', { version: esc(vname(m.bud)) }), tx('Variance comments'), th('Every variance over the thresholds, month by month, with what people wrote about it. Status: open while you are still finding out, explained once it is.'), '');
    var segs = [['attention', 'Needs attention'], ['none', 'No comment'], ['open', 'Open'], ['explained', 'Explained'], ['all', 'All']];
    h += '<div class="toolbar"><div class="seg" role="group" aria-label="' + th('Status') + '">' + segs.map(function (s) { return '<button type="button" data-act="cmf" data-v="' + s[0] + '" aria-pressed="' + (f === s[0]) + '">' + th(s[1]) + ' <span class="muted">' + cnt[s[0]] + '</span></button>'; }).join('') + '</div>' +
      '<label class="sr" for="cmLine">' + th('Line') + '</label><select class="select" id="cmLine" data-ch="cmline"><option value="">' + th('All lines') + '</option>' + E.LINES.map(function (l) { return '<option value="' + l.id + '"' + (uCm.line === l.id ? ' selected' : '') + '>' + esc(lnm(l.id)) + '</option>'; }).join('') + '</select></div>';
    if (!shown.length) return h + '<section class="card"><div class="empty-state">' + ic('check') + '<p>' + th(f === 'attention' ? 'Nothing needs attention: every flagged variance has an explanation.' : 'No comments match.') + '</p></div></section>';
    var body = '', cur = null;
    shown.forEach(function (x) {
      if (x.month !== cur) { if (cur !== null) body += '</ul>'; cur = x.month; body += '<h3 class="mgroup">' + esc(cap(monL(x.month)) + ' ' + m.y) + '</h3><ul class="ex">'; }
      body += exItem(x.line, x.month, x.scope);
    });
    return h + '<section class="card"><div class="card-b" style="padding-top:14px">' + body + '</ul></div></section>';
  }

  // ── page: import actuals ─────────────────────────────────────────────────
  var imp = null, lastImport = null;
  function pageImport() {
    var m = model(), y = m.y;
    var h = head(th('Import actuals · {prev} and {year}', { prev: y - 1, year: y }), tx('Bring in the actuals'), th('A trial balance (bruto bilanca) or general ledger (glavna knjiga) exported from Minimax or Pantheon, or one row per account and month from Excel. Each month you import replaces what was there, or adds to it.'),
      '<button type="button" class="btn" data-act="tmpl">' + ic('file') + th('Download template') + '</button><button type="button" class="btn" data-act="actcsv">' + ic('dl') + th('Download current actuals') + '</button>');
    if (lastImport && lastImport.month > m.closed && lastImport.y === y) {
      h += '<div class="notice ok"><p>' + th('{month} now has actuals. By the {days}-day rule it counts as closed from {date}.', { month: esc(cap(monL(lastImport.month))), days: db.settings.grace, date: dt(E.addDays(E.monthEnd(y, lastImport.month), db.settings.grace)) }) + '</p><button type="button" class="btn sm" data-act="closenow" data-v="' + lastImport.month + '">' + th('Close through {month} now', { month: esc(monG(lastImport.month)) }) + '</button></div>';
    }
    if (!imp) {
      var fh = tmplRows(y);
      h += '<div class="grid21"><section class="card"><div class="card-h"><div><span class="label">' + th('Step 1') + '</span><h2>' + th('Choose a file or paste rows') + '</h2></div></div><div class="card-b">' +
        '<div class="drop" id="dropZone">' + ic('up') + '<p style="margin:0">' + th('Drop a CSV file here, or') + '</p><button type="button" class="btn pri" data-act="pick">' + ic('file') + th('Choose a file') + '</button><span class="hint">' + th('Excel (.xlsx), CSV or text, semicolon, comma or tab separated, up to 5 MB') + '</span></div>' +
        '<details class="tbl" style="margin-top:14px"><summary>' + th('Or paste rows from Excel') + '</summary><div class="field" style="margin-top:8px"><label for="impPaste">' + th('Rows with month, account, amount and description') + '</label><textarea class="in" id="impPaste" rows="6" spellcheck="false" placeholder="' + esc(y + '-09\t7620\t512.340,12\t' + tx('Sales of goods')) + '"></textarea></div><div style="margin-top:8px"><button type="button" class="btn" data-act="pasteimp">' + th('Read the pasted rows') + '</button></div></details></div></section>' +
        '<section class="card"><div class="card-h"><div><span class="label">' + th('The format') + '</span><h2>' + th('Files it reads') + '</h2></div></div><div class="card-b">' +
        '<ul class="fmt-list"><li>' + th('{name} for a month or the year to date: Konto, Naziv, Promet debet, Promet kredit. You pick the month; a year-to-date file has the earlier months subtracted.', { name: '<b>' + th('Minimax or Pantheon, bruto bilanca') + '</b>' }) + '</li>' +
        '<li>' + th('{name}: one row per posting with Datum, Konto, Debet and Kredit (Croatian Duguje / Potražuje too). The month comes from the date.', { name: '<b>' + th('Minimax or Pantheon, glavna knjiga') + '</b>' }) + '</li>' +
        '<li>' + th('{name}: month, account, amount and an optional description.', { name: '<b>' + th('Your own file') + '</b>' }) + '</li></ul>' +
        '<div class="fmt">' + esc(fh[0].join(';') + '\n' + y + '-09;7620;512.340,12;' + tx('Sales of goods — heating') + '\n' + y + '-09;7020;-1.234,00;' + tx('Credit note') + '\n30.09.' + y + ';4700;88.410,55;' + tx('Gross salaries')) + '</div>' +
        '<p class="hint" style="margin-top:10px">' + th('Accounts on the Slovenian chart (kontni okvir) are recognised: classes 4 and 7 are imported, balance-sheet accounts, group 49 and subtotal rows are left out. New accounts get a suggested P&L line to check. Title lines above the header, two-row headers and debit/credit columns are handled; the preview shows what was read.') + '</p></div></section></div>';
    } else h += importPreview();
    h += loadedCard();
    return h;
  }
  function loadedCard() {
    var m = model(), y = m.y, cells = '', yrs = [y - 1, y];
    var ag = { }; yrs.forEach(function (yy) { ag[yy] = E.rowsOf(E.aggregate(db.actuals[yy] || {}, db.accounts).lines); });
    var rows = yrs.map(function (yy) {
      var tds = '';
      for (var i = 1; i <= 12; i++) {
        var ok = db.loaded[yy] && db.loaded[yy][i - 1];
        tds += '<td class="num">' + (ok ? '<span title="' + esc(tx('{month}: revenue {revenue}, EBITDA {ebitda}', { month: cap(monL(i)) + ' ' + yy, revenue: eur(ag[yy].rev[i - 1]), ebitda: eur(ag[yy].ebitda[i - 1]) })) + '">' + keur(ag[yy].rev[i - 1]) + '</span>' : '<span class="muted">—</span>') + '</td>';
      }
      return '<tr><td>' + yy + '</td>' + tds + '</tr>';
    }).join('');
    for (var i = 1; i <= 12; i++) cells += '<th class="num" scope="col">' + mon(i) + '</th>';
    return '<section class="card" style="margin-top:14px"><div class="card-h"><div><span class="label">' + th('In the app now · revenue per month') + '</span><h2>' + th('Months with actuals') + '</h2></div></div><div class="tw"><table class="t compact"><thead><tr><th scope="col">' + th('Year') + '</th>' + cells + '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="hint" style="padding:0 20px 16px">' + th('A dash means no actuals yet.') + ' ' + (db.demo ? th('Demo months are added automatically when they close; your own imports turn that off.') : '') + '</p></section>';
  }
  function readImport(text, name) {
    imp = { name: name, text: text, period: null, cols: null, modes: {}, map: {}, sign: null };
    lastImport = null;
    parseImp();
    render();
    var el = $('impPrev'); if (el) el.focus();
  }
  /** (Re)read the file with the chosen period and columns; keeps the choices already made for months and accounts. */
  function parseImp() {
    var y = db.year, m = model();
    var opts = { accounts: db.accounts, years: [y - 1, y], cols: imp.cols || undefined, period: imp.period || undefined };
    var p = E.parseExport(imp.text, opts);
    if (p.needsPeriod && !imp.period) {
      var g = p.periodGuess, first = 1;
      while (first < 12 && db.loaded[y] && db.loaded[y][first - 1]) first++;
      imp.period = g && (g.y === y || g.y === y - 1) ? g : { y: y, m: Math.min(12, Math.max(1, first)), cumulative: false };
      imp.periodFromFile = !!(g && imp.period === g);
      opts.period = imp.period;
      p = E.parseExport(imp.text, opts);
    }
    imp.p = p;
    if (!imp.sign) imp.sign = p.signGuess;
    p.months.forEach(function (mo) { if (!imp.modes[mo.key]) imp.modes[mo.key] = 'replace'; });
    p.unknown.forEach(function (u) { if (!imp.map[u.code]) { var ln = E.suggestLine(u.code, db.accounts); imp.map[u.code] = { line: ln, name: u.desc || '', suggested: !!ln }; } });
    return m;
  }
  /** Rows to import: a year-to-date trial balance becomes the month (earlier months subtracted). */
  function impRows(accounts) {
    var p = imp.p, per = imp.period;
    if (p.format === 'tb' && per && per.cumulative && per.m > 1) return E.deCumulate(p.rows, db.actuals, accounts, per.y, per.m, imp.sign);
    return p.rows;
  }
  /** Months before a year-to-date trial balance's month that have no actuals yet (the subtraction needs them). */
  function impMissing() {
    var p = imp.p, per = imp.period, out = [];
    if (!(p.format === 'tb' && per && per.cumulative)) return out;
    for (var i = 1; i < per.m; i++) if (!(db.loaded[per.y] && db.loaded[per.y][i - 1])) out.push(i);
    return out;
  }
  /** New accounts in a year-to-date trial balance: nothing was imported on them before, so nothing could be
   * subtracted and their whole year would land in one month. */
  function impNewInYtd() {
    var p = imp.p, per = imp.period;
    if (!(p.format === 'tb' && per && per.cumulative && per.m > 1)) return [];
    return p.unknown.filter(function (u) { return (imp.map[u.code] || {}).line !== '__skip'; });
  }
  function newAccounts() {
    var out = [];
    imp.p.unknown.forEach(function (u) {
      var mp = imp.map[u.code] || {};
      if (mp.line === '__skip' || !E.LINE[mp.line]) return;
      out.push({ code: u.code, name: (mp.name || '').trim() || tx('Account {code}', { code: u.code }), line: mp.line, kind: E.LINE[mp.line].type });
    });
    return out;
  }
  var REASON = { balance: 'balance sheet (classes 0–3, 9)', other: 'not P&L (classes 5, 6, 8)', transfer: 'cost transfers (group 49), already in class 7', total: 'subtotal of the accounts below it' };
  var ROLE = [['account', 'Account'], ['name', 'Account name'], ['date', 'Date'], ['period', 'Month'], ['debit', 'Debit'], ['credit', 'Credit'], ['sd', 'Balance, debit'], ['sk', 'Balance, credit'], ['amount', 'Amount'], ['saldo', 'Balance'], ['desc', 'Description']];
  function importPreview() {
    var p = imp.p, m = model(), y = m.y, preset = E.PRESETS.filter(function (x) { return x.id === p.preset; })[0];
    var fmt = tx(p.format === 'tb' ? 'Trial balance (bruto bilanca)' : p.format === 'gl' ? 'General ledger (glavna knjiga)' : 'Month, account, amount');
    var h = '<section class="card" id="impPrev" tabindex="-1"><div class="card-h"><div><span class="label">' + th('Step 2') + ' · ' + esc(imp.name) + '</span><h2>' + th('Check before importing') + '</h2></div><button type="button" class="btn sm ghost" data-act="impcancel">' + ic('x') + th('Start over') + '</button></div>';
    h += '<div class="stats"><span><b>' + esc(fmt) + '</b>' + (preset && p.format !== 'simple' ? ' · ' + th('columns like {program}', { program: esc(preset.name) }) : '') + '</span><span>' + th('{rows} read', { rows: '<b>' + plural(p.rows.length, 'row', 'rows') + '</b>' }) + '</span><span><b>' + plural(p.months.length, 'month', 'months') + '</b></span><span>' + th({ ';': 'semicolon separated', ',': 'comma separated', '\t': 'tab separated' }[p.delimiter]) + '</span><span>' + th(p.decimal === ',' ? 'decimal comma' : 'decimal point') + '</span>' + (p.format === 'simple' ? (p.header ? '<span>' + th('with a header row') + '</span>' : '<span>' + th('no header row: read as month, account, amount') + '</span>') : '') + '</div><div class="card-b" style="padding-top:14px">';
    if (p.format !== 'simple' && p.cols) {
      var used = ROLE.filter(function (r) { return p.cols[r[0]] >= 0; }).map(function (r) { return th(r[1]) + ': <b>' + esc(p.heads[p.cols[r[0]]] || '') + '</b>'; });
      var colSel = function (role, label) { return '<div class="field"><label for="ic-' + role + '">' + th(label) + '</label><select class="in" id="ic-' + role + '" data-ch="impcol" data-v="' + role + '"><option value="-1">—</option>' + p.heads.map(function (hd, i) { return '<option value="' + i + '"' + (p.cols[role] === i ? ' selected' : '') + '>' + esc(hd || tx('Column {n}', { n: i + 1 })) + '</option>'; }).join('') + '</select></div>'; };
      h += '<details class="tbl cols-d"><summary>' + th('Columns read:') + ' ' + used.join(' · ') + '</summary><div class="cols-g">' + ROLE.filter(function (r) { return ['account', 'name', 'date', 'debit', 'credit', 'amount'].indexOf(r[0]) >= 0; }).map(function (r) { return colSel(r[0], r[1]); }).join('') + '</div><p class="hint">' + th('Debit − credit is the amount. Pick another column when the program named one differently.') + '</p></details>';
    }
    if (p.format === 'tb') {
      var per = imp.period || { y: y, m: 1, cumulative: false }, mo = '';
      [y - 1, y].forEach(function (yy) { for (var i = 1; i <= 12; i++) mo += '<option value="' + yy + '-' + i + '"' + (per.y === yy && per.m === i ? ' selected' : '') + '>' + esc(cap(monL(i)) + ' ' + yy) + (db.loaded[yy] && db.loaded[yy][i - 1] ? ' · ' + th('has actuals') : '') + '</option>'; });
      h += '<fieldset class="grp"><legend>' + th('Which month this trial balance is for') + '</legend><div class="row2"><div class="field"><label for="impPer">' + th('Month') + '</label><select class="in" id="impPer" data-ch="impper">' + mo + '</select>' + (imp.periodFromFile ? '<span class="hint">' + th('Read from the period line in the file.') + '</span>' : '<span class="hint">' + th('A trial balance has no dates: choose its month.') + '</span>') + '</div>' +
        '<div class="field"><span class="lab">' + th('The amounts are') + '</span><div class="radio-row"><label><input type="radio" name="impCum" value="0"' + (per.cumulative ? '' : ' checked') + ' data-ch="impcum"> ' + th('That month’s turnover') + '</label><label><input type="radio" name="impCum" value="1"' + (per.cumulative ? ' checked' : '') + ' data-ch="impcum"> ' + th('Year to date through that month') + '</label></div></div></div>';
      var miss = impMissing(), nw = impNewInYtd();
      if (miss.length) h += '<div class="err" role="alert">' + th('Year to date through {through} needs the earlier months to subtract, but these have no actuals yet: {list}. Import those first, or a file with only the turnover of {month}.', { through: esc(monG(per.m)), month: esc(monL(per.m)), list: esc(miss.map(monL).join(', ')) }) + '</div>';
      else if (nw.length) h += '<div class="err" role="alert">' + th(nw.length === 1 ? 'New account: {list}. There is nothing to subtract for it, so the whole year to date would land in {month}. Import the turnover of {month} only, a general ledger, or the earlier months on this account first — or skip it below.' : 'New accounts: {list}. There is nothing to subtract for them, so the whole year to date would land in {month}. Import the turnover of {month} only, a general ledger, or the earlier months on these accounts first — or skip them below.', { list: esc(nw.slice(0, 4).map(function (u) { return u.code; }).join(', ')) + (nw.length > 4 ? ', …' : ''), month: esc(monL(per.m)) }) + '</div>';
      else if (per.cumulative && per.m > 1) h += '<p class="hint">' + th('{range} as already imported will be subtracted, so {month} gets its own turnover.', { range: esc(cap(range(1, per.m - 1))), month: esc(monL(per.m)) }) + '</p>';
      h += '</fieldset>';
    }
    if (p.errors.length) {
      h += '<div class="err" role="alert"><b>' + th('Rows that could not be read: {n}. Nothing can be imported yet.', { n: p.errors.length }) + '</b> ' + th('Fix them in the file and try again; either every row is imported or none.') + '</div><ul class="imp-errs" style="margin-top:8px">' +
        p.errors.slice(0, 40).map(function (e) { return '<li>' + (e.row ? th('Row {n}:', { n: e.row }) + ' ' : '') + esc(lx(e.msg)) + '</li>'; }).join('') + (p.errors.length > 40 ? '<li>' + th('… and {n} more', { n: p.errors.length - 40 }) + '</li>' : '') + '</ul></div></section>';
      return h;
    }
    if (p.skipped.length || p.ignored) {
      var byR = {};
      p.skipped.forEach(function (x) { (byR[x.reason] = byR[x.reason] || []).push(x); });
      var SHORT = { balance: 'Accounts on the balance sheet: {n}', other: 'Accounts outside the P&L: {n}', transfer: 'Accounts with cost transfers (group 49): {n}', total: 'Subtotal accounts: {n}' };
      h += '<details class="tbl skip-d"><summary>' + th('Left out:') + ' ' + Object.keys(byR).map(function (r) { return th(SHORT[r], { n: byR[r].length }); }).concat(p.ignored ? [th('Rows without an account (titles, totals): {n}', { n: p.ignored })] : []).join(' · ') + '</summary>' +
        (p.skipped.length ? '<div class="tw"><table class="t compact"><thead><tr><th>' + th('Account') + '</th><th>' + th('Name') + '</th><th class="num">' + th('Rows') + '</th><th class="num">' + th('Debit − credit') + '</th><th>' + th('Why') + '</th></tr></thead><tbody>' + p.skipped.slice(0, 80).map(function (x) { return '<tr><td class="mono nw">' + esc(x.code) + '</td><td>' + esc(x.desc || '') + '</td><td class="num">' + x.rows + '</td><td class="num">' + num(x.cents) + '</td><td class="muted">' + th(REASON[x.reason]) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '') +
        (p.ignoredText.length ? '<p class="hint" style="padding:0 2px">' + th('Rows without an account, e.g. {rows}', { rows: esc(p.ignoredText.join(' | ')) }) + '</p>' : '') + '</details>';
    }
    if (!p.rows.length) return h + '<p class="empty">' + th('No P&L rows with amounts in this file.') + '</p></div></section>';
    h += '<fieldset class="grp"><legend>' + th('Signs in this file') + '</legend><div class="radio-row"><label><input type="radio" name="impSign" value="pl"' + (imp.sign === 'pl' ? ' checked' : '') + ' data-ch="impsign"> ' + th('Income and costs both positive (P&L view)') + '</label><label><input type="radio" name="impSign" value="ledger"' + (imp.sign === 'ledger' ? ' checked' : '') + ' data-ch="impsign"> ' + th('Debit +, credit − (ledger view: income comes in negative)') + '</label></div>' +
      (p.format !== 'simple' ? '<p class="hint">' + th(p.format === 'tb' ? 'Read as debit − credit from the turnover columns, so the ledger view is right.' : 'Read as debit − credit from the posting columns, so the ledger view is right.') + '</p>' : p.signGuess === 'ledger' ? '<p class="hint">' + th('Income accounts are negative in this file, so it looks like a ledger export.') + '</p>' : '') + '</fieldset>';
    var accounts = db.accounts.concat(newAccounts()), acc = {}; accounts.forEach(function (a) { acc[a.code] = a; });
    var rowsAll = impRows(accounts);
    h += '<h3 class="mgroup">' + th('Months in the file') + '</h3><div class="tw"><table class="t compact"><thead><tr><th>' + th('Month') + '</th><th class="num">' + th('Rows') + '</th><th class="num">' + th('Revenue') + '</th><th class="num">EBITDA</th><th>' + th('In the app now') + '</th><th>' + th('What to do') + '</th></tr></thead><tbody>' +
      p.months.map(function (mo) {
        var rows = rowsAll.filter(function (r) { return r.y === mo.y && r.m === mo.m && acc[r.code]; }), tmp = {};
        rows.forEach(function (r) { var v = imp.sign === 'ledger' && acc[r.code].kind === 'income' ? -r.cents : r.cents; (tmp[r.code] = tmp[r.code] || E.zeros())[mo.m - 1] += v; });
        var rr = E.rowsOf(E.aggregate(tmp, accounts).lines), have = db.loaded[mo.y] && db.loaded[mo.y][mo.m - 1];
        var nowR = have ? E.rowsOf(E.aggregate(db.actuals[mo.y] || {}, db.accounts).lines) : null;
        return '<tr><td class="nw">' + esc(cap(monL(mo.m)) + ' ' + mo.y) + '</td><td class="num">' + mo.rows + '</td><td class="num">' + num(rr.rev[mo.m - 1]) + '</td><td class="num">' + num(rr.ebitda[mo.m - 1]) + '</td><td>' + (have ? th('Yes · revenue {amount}', { amount: keur(nowR.rev[mo.m - 1]) }) : '<span class="muted">' + th('No') + '</span>') + '</td>' +
          '<td><label class="sr" for="im-' + mo.key + '">' + th('What to do with {month}', { month: esc(monL(mo.m) + ' ' + mo.y) }) + '</label><select class="select" id="im-' + mo.key + '" data-ch="impmode" data-v="' + mo.key + '"><option value="replace"' + (imp.modes[mo.key] !== 'add' ? ' selected' : '') + '>' + th('Replace the month') + '</option><option value="add"' + (imp.modes[mo.key] === 'add' ? ' selected' : '') + '>' + th('Add to it') + '</option></select></td></tr>';
      }).join('') + '</tbody></table></div><p class="hint">' + th('Revenue and EBITDA here count the accounts mapped to a line, with the signs chosen above.') + '</p>';
    if (p.unknown.length) {
      var opts = function (sel) { return '<option value="">' + th('Choose a line…') + '</option>' + lineOptions(sel) + '<option value="__skip"' + (sel === '__skip' ? ' selected' : '') + '>' + th('Skip these rows') + '</option>'; };
      var sug = p.unknown.filter(function (u) { return imp.map[u.code] && imp.map[u.code].suggested; }).length, none = p.unknown.length - sug;
      h += '<h3 class="mgroup">' + th(p.unknown.length === 1 ? 'An account new to the app: map it to a P&L line' : 'Accounts new to the app ({n}): map each to a P&L line', { n: p.unknown.length }) + '</h3>' +
        '<div class="notice warn"><p>' + (sug ? th(sug === 1 ? 'One line is suggested from the chart of accounts (kontni okvir) or your nearest account: check it before importing.' : 'Lines suggested from the chart of accounts (kontni okvir) or your nearest account: {n}. Check them before importing.', { n: sug }) + (none ? ' ' : '') : '') + (none ? th(none === 1 ? 'One account has no suggestion: choose a line or skip it.' : 'Accounts with no suggestion: {n}. Choose a line or skip them.', { n: none }) : '') + ' ' + th('Accounts left unmapped would be missing from every total.') + '</p></div>' +
        '<div class="tw"><table class="t compact"><thead><tr><th>' + th('Account') + '</th><th class="num">' + th('Rows') + '</th><th class="num">' + th('Amount') + '</th><th>' + th('Name') + '</th><th>' + th('P&L line') + '</th></tr></thead><tbody>' +
        p.unknown.map(function (u) {
          var mp = imp.map[u.code] || { line: '', name: '' };
          return '<tr><td class="mono nw">' + esc(u.code) + '</td><td class="num">' + u.rows + '</td><td class="num">' + num(u.cents) + '</td><td><label class="sr" for="un-' + esc(u.code) + '">' + th('Name of account {code}', { code: esc(u.code) }) + '</label><input class="in" style="min-height:38px;min-width:180px" id="un-' + esc(u.code) + '" data-ch="impname" data-v="' + esc(u.code) + '" maxlength="80" value="' + esc(mp.name) + '" placeholder="' + th('Account {code}', { code: esc(u.code) }) + '"></td>' +
            '<td class="nw"><label class="sr" for="ul-' + esc(u.code) + '">' + th('P&L line for account {code}', { code: esc(u.code) }) + '</label><select class="select" id="ul-' + esc(u.code) + '" data-ch="impline" data-v="' + esc(u.code) + '"' + (mp.line ? '' : ' aria-invalid="true"') + '>' + opts(mp.line) + '</select>' + (mp.suggested ? ' <span class="tag sug" title="' + th('Suggested from the chart of accounts: check it') + '">' + th('suggested') + '</span>' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    var missing = p.unknown.filter(function (u) { return !(imp.map[u.code] && imp.map[u.code].line); }).length, gap = impMissing().length + impNewInYtd().length;
    h += '<div class="toolbar" style="margin:16px 0 0"><button type="button" class="btn pri" data-act="doimport"' + (missing || gap || !p.rows.length ? ' disabled' : '') + '>' + ic('up') + th('Import {rows}', { rows: plural(p.rows.length, 'row', 'rows') }) + '</button>' +
      (missing ? '<span class="hint">' + th('Map or skip these accounts first: {n}.', { n: missing }) + '</span>' : gap ? '<span class="hint">' + th('See the note on the month above.') + '</span>' : '<span class="hint">' + th('You can undo nothing here, but you can always import the month again.') + '</span>') + '</div></div></section>';
    return h;
  }
  /** The import template: the header in the screen language (the import reads it in every language) and four rows. */
  function tmplRows(y) {
    var k = y + '-' + E.pad(Math.max(1, model().closed));
    return [[tx('month'), tx('account'), tx('amount'), tx('description')], [k, '7620', '512340,12', tx('Sales of goods — Slovenia, heating')], [k, '7020', '368912,40', tx('Cost of goods sold — heating')], [k, '4700', '88410,55', tx('Gross salaries')], [k, '4130', '26400,00', tx('Warehouse rent')]];
  }
  function doImport() {
    if (!imp || imp.p.errors.length || impMissing().length || impNewInYtd().length) return;
    var p = imp.p, newAccs = newAccounts(), skip = {};
    p.unknown.forEach(function (u) { if ((imp.map[u.code] || {}).line === '__skip') skip[u.code] = true; });
    var accounts = db.accounts.concat(newAccs);
    var res = E.applyImport(db.actuals, impRows(accounts), accounts, { modes: imp.modes, sign: imp.sign, skip: skip });
    var months = res.months.map(function (k) { return monL(+k.slice(5, 7)) + ' ' + k.slice(0, 4); });
    var enMonths = res.months.map(function (k) { return E.MONTHS_LONG[+k.slice(5, 7) - 1] + ' ' + k.slice(0, 4); });
    commit('Imported ' + res.rows + (res.rows === 1 ? ' row' : ' rows') + ' of actuals for ' + enMonths.join(', ') + (newAccs.length ? ', ' + newAccs.length + (newAccs.length === 1 ? ' new account' : ' new accounts') : ''), function () {
      db.accounts = accounts; db.actuals = res.actuals; db.demo = false;
      res.months.forEach(function (k) { var yy = +k.slice(0, 4), mm = +k.slice(5, 7); if (!db.loaded[yy]) db.loaded[yy] = E.zeros().map(function () { return false; }); db.loaded[yy][mm - 1] = true; });
    }, { noRender: true });
    var cy = res.months.filter(function (k) { return +k.slice(0, 4) === db.year; }).map(function (k) { return +k.slice(5, 7); });
    lastImport = cy.length ? { y: db.year, month: Math.max.apply(null, cy) } : null;
    imp = null;
    render();
    toast(tx('Imported {rows} for {months}', { rows: plural(res.rows, 'row', 'rows'), months: months.join(', ') }));
  }

  // ── page: board pack ─────────────────────────────────────────────────────
  var PACK = {
    en: {
      name: 'English', title: 'Management report', ytd: 'Year to date', fy: 'Full year', actual: 'Actual', budget: 'Budget', outlook: 'Outlook', diff: 'Δ', rel: 'Δ %', index: false,
      closed: 'Closed through', prepared: 'Prepared', vs: 'vs budget', pp: 'pp',
      kRev: 'Revenue', kGm: 'Gross margin', kEb: 'EBITDA', kFy: 'EBITDA, full year', sYtd: 'year to date', sFy: 'outlook',
      pl: 'Profit and loss', bridge: 'EBITDA from budget to actual, year to date', bStart: 'Budget EBITDA', bEnd: 'Actual EBITDA', other: 'Other lines',
      top: 'Largest variances against the budget, year to date', none: 'No explanation yet.', through: 'note through', open: 'open',
      basis: 'Outlook = actuals for {closed} and {version} for {open}.', notes: 'Amounts in euros. Δ is actual minus budget; for costs a negative Δ is favourable.',
      page: 'Page {n} of 2', months: E.MONTHS_LONG, dash: '–', dateDot: '',
      budgetName: 'Budget {y}', forecastName: 'Forecast {y}', lines: {}, origIn: { sl: '(in Slovenian)', hr: '(in Croatian)' },
      monthly: 'Month by month, € thousands', mShort: E.MONTHS, rAct: 'Revenue, actual / outlook', rBud: 'Revenue, budget', eAct: 'EBITDA, actual / outlook', eBud: 'EBITDA, budget', openNote: 'Grey: open months (outlook).', year: 'Year'
    },
    sl: {
      name: 'Slovenščina', title: 'Poročilo o poslovanju', ytd: 'Od začetka leta', fy: 'Celo leto', actual: 'Realizacija', budget: 'Plan', outlook: 'Ocena', diff: 'Razlika', rel: 'Indeks', index: true,
      closed: 'Zaključeno do', prepared: 'Pripravljeno', vs: 'glede na plan', pp: 'o. t.',
      kRev: 'Prihodki', kGm: 'Bruto marža', kEb: 'EBITDA', kFy: 'EBITDA, celo leto', sYtd: 'od začetka leta', sFy: 'ocena',
      pl: 'Izkaz poslovnega izida', bridge: 'EBITDA od plana do realizacije, od začetka leta', bStart: 'Planirana EBITDA', bEnd: 'Dosežena EBITDA', other: 'Druge postavke',
      top: 'Največji odmiki od plana od začetka leta', none: 'Pojasnila še ni.', through: 'pojasnilo do konca meseca', open: 'odprto',
      basis: 'Ocena = realizacija za {closed} in {version} za {open}.', notes: 'Zneski so v evrih. Razlika = realizacija − plan; pri stroških je negativna razlika ugodna. Indeks = realizacija / plan × 100.',
      page: 'Stran {n} od 2', months: ['januar', 'februar', 'marec', 'april', 'maj', 'junij', 'julij', 'avgust', 'september', 'oktober', 'november', 'december'], dash: '–', dateDot: '',
      budgetName: 'Plan {y}', forecastName: 'Napoved {y}', origIn: { en: '(v angleščini)', hr: '(v hrvaščini)' },
      monthly: 'Po mesecih, v tisoč €', mShort: ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'avg', 'sep', 'okt', 'nov', 'dec'], rAct: 'Prihodki, realizacija / ocena', rBud: 'Prihodki, plan', eAct: 'EBITDA, realizacija / ocena', eBud: 'EBITDA, plan', openNote: 'Sivo: odprti meseci (ocena).', year: 'Leto',
      lines: I18N.LINE_NAMES.sl // the same names as on the screens (i18n.js)
    },
    hr: {
      name: 'Hrvatski', title: 'Izvješće o poslovanju', ytd: 'Od početka godine', fy: 'Cijela godina', actual: 'Ostvarenje', budget: 'Plan', outlook: 'Procjena', diff: 'Razlika', rel: 'Indeks', index: true,
      closed: 'Zaključeno do', prepared: 'Pripremljeno', vs: 'u odnosu na plan', pp: 'p. b.',
      kRev: 'Prihodi', kGm: 'Bruto marža', kEb: 'EBITDA', kFy: 'EBITDA, cijela godina', sYtd: 'od početka godine', sFy: 'procjena',
      pl: 'Račun dobiti i gubitka', bridge: 'EBITDA od plana do ostvarenja, od početka godine', bStart: 'Planirana EBITDA', bEnd: 'Ostvarena EBITDA', other: 'Ostale stavke',
      top: 'Najveća odstupanja od plana od početka godine', none: 'Objašnjenje još nije upisano.', through: 'objašnjenje do kraja mjeseca', open: 'otvoreno',
      basis: 'Procjena = ostvarenje za {closed} i {version} za {open}.', notes: 'Iznosi su u eurima. Razlika = ostvarenje − plan; kod troškova je negativna razlika povoljna. Indeks = ostvarenje / plan × 100.',
      page: 'Stranica {n} od 2', months: ['siječanj', 'veljača', 'ožujak', 'travanj', 'svibanj', 'lipanj', 'srpanj', 'kolovoz', 'rujan', 'listopad', 'studeni', 'prosinac'], dash: ' – ', dateDot: '.',
      budgetName: 'Plan {y}', forecastName: 'Prognoza {y}', origIn: { en: '(na engleskom)', sl: '(na slovenskom)' },
      monthly: 'Po mjesecima, u tisućama €', mShort: ['sij', 'velj', 'ožu', 'tra', 'svi', 'lip', 'srp', 'kol', 'ruj', 'lis', 'stu', 'pro'], rAct: 'Prihodi, ostvarenje / procjena', rBud: 'Prihodi, plan', eAct: 'EBITDA, ostvarenje / procjena', eBud: 'EBITDA, plan', openNote: 'Sivo: otvoreni mjeseci (procjena).', year: 'Godina',
      lines: I18N.LINE_NAMES.hr
    }
  };
  function packName(L, id) { return L.lines[id] || (id === 'gm_pct' ? 'Gross margin %' : id === 'ebitda_pct' ? 'EBITDA %' : E.nameOf(id)); }
  function packVersion(L, v) {
    if (L === PACK.en) return v.name;
    var y = String(model().y), base = (v.kind === 'budget' ? L.budgetName : L.forecastName).replace('{y}', y), rest = v.name.replace(/^(Budget|Forecast)\s+\d{4}/, '');
    return base + rest;
  }
  function packRange(L, from, to) { var y = model().y; return (from === to ? L.months[from - 1] : L.months[from - 1] + L.dash + L.months[to - 1]) + ' ' + y + L.dateDot; }
  function packDate(L, s) { return dt0(s) + L.dateDot; }
  function pagePrint() {
    var m = model(), c = m.closed, lang = packLang(), L = PACK[lang];
    var miss = c ? packTop(m).filter(function (t) { return t.cm && !E.commentText(t.cm, lang).inLang; }) : [];
    var h = '<div class="pack-bar no-print"><div class="seg" role="group" aria-label="' + th('Language of the report') + '">' + Object.keys(PACK).map(function (k) { return '<button type="button" data-act="packlang" data-v="' + k + '" aria-pressed="' + (k === lang) + '" lang="' + k + '">' + esc(PACK[k].name) + '</button>'; }).join('') + '</div>' +
      '<button type="button" class="btn pri" data-act="print">' + ic('print') + th('Print or save as PDF') + '</button><span class="hint">' + th(lang === LANG ? 'In the language of the screens. Two A4 pages. Comments print in the pack’s language when they have a text in it, otherwise as they were written.' : 'Two A4 pages. Comments print in the pack’s language when they have a text in it, otherwise as they were written.') + '</span></div>';
    if (miss.length) h += '<div class="notice warn no-print"><p>' + th({ en: 'Comments that print as written, not in English: {list}. Open the line and add the text under “Board pack text in other languages”.', sl: 'Comments that print as written, not in Slovenian: {list}. Open the line and add the text under “Board pack text in other languages”.', hr: 'Comments that print as written, not in Croatian: {list}. Open the line and add the text under “Board pack text in other languages”.' }[lang], { list: miss.map(function (t) { return '<a href="#/line/' + t.l.id + '">' + esc(lnm(t.l.id)) + '</a>'; }).join(', ') }) + '</p></div>';
    if (!c) return head(th('Board pack'), tx('Nothing to report yet'), th('The board pack needs at least one closed month.'), '') + h;
    return '<h1 class="sr" tabindex="-1">' + th('Board pack') + '</h1>' + h + '<div class="pack-wrap" lang="' + lang + '">' + packPage1(L, m) + packPage2(L, m) + '</div>';
  }
  function packCells(L, a, b, type) {
    var v = E.variance(a, b, type), idx = b > 0 && a >= 0 ? a / b * 100 : null;
    return '<td>' + num(a) + '</td><td>' + num(b) + '</td><td class="' + favCls(v.fav) + '">' + sgn(v.d) + '</td><td class="' + favCls(v.fav) + '">' + (L.index ? (idx == null ? '—' : nf1.format(idx)) : pctTxt(v.pct, true)) + '</td>';
  }
  function packPage1(L, m) {
    var c = m.closed, revA = E.sumRange(m.actR.rev, 1, c), revB = E.sumRange(m.budR.rev, 1, c);
    var gmA = E.share(E.sumRange(m.actR.gm, 1, c), revA), gmB = E.share(E.sumRange(m.budR.gm, 1, c), revB);
    var ebA = E.sumRange(m.actR.ebitda, 1, c), ebB = E.sumRange(m.budR.ebitda, 1, c), fyA = E.total(m.outR.ebitda), fyB = E.total(m.budR.ebitda);
    var rv = E.variance(revA, revB, 'income'), ev = E.variance(ebA, ebB, 'income'), fv = E.variance(fyA, fyB, 'income');
    function tile(label, sub, val, det, cls) { return '<div><span>' + esc(label) + ' · ' + esc(sub) + '</span><b>' + val + '</b><em class="' + cls + '">' + det + '</em></div>'; }
    var ppv = gmA == null || gmB == null ? null : gmA - gmB, ppS = ppv == null ? '—' : (Math.round(ppv * 10) / 10 > 0 ? '+' : Math.round(ppv * 10) / 10 < 0 ? MINUS : '') + nf1.format(Math.abs(Math.round(ppv * 10) / 10)) + ' ' + L.pp;
    var hdr = '<div class="ph"><div><div class="co">' + esc(db.company.name) + '</div><h2>' + esc(L.title) + '</h2><div style="font-size:11pt;margin-top:2px">' + esc(L.ytd) + ': ' + esc(packRange(L, 1, c)) + '</div></div>' +
      '<div style="text-align:right"><small>' + esc(L.closed) + ' ' + esc(packDate(L, E.monthEnd(m.y, c))) + '<br>' + esc(L.prepared) + ' ' + esc(packDate(L, TODAY)) + '</small></div></div>';
    var k = '<div class="pk">' +
      tile(L.kRev, L.sYtd, esc(keur(revA)), pctTxt(rv.pct, true) + ' ' + esc(L.vs), favCls(rv.fav)) +
      tile(L.kGm, L.sYtd, gmA == null ? '—' : pctTxt(gmA), esc(ppS) + ' ' + esc(L.vs), ppv == null ? '' : ppv > 0.05 ? 'pos' : ppv < -0.05 ? 'neg' : '') +
      tile(L.kEb, L.sYtd, esc(keur(ebA)), esc(skeur(ev.d)) + ' · ' + pctTxt(ev.pct, true) + ' ' + esc(L.vs), favCls(ev.fav)) +
      tile(L.kFy, L.sFy, esc(keur(fyA)), esc(skeur(fv.d)) + ' · ' + pctTxt(fv.pct, true) + ' ' + esc(L.vs), favCls(fv.fav)) + '</div>';
    var ids = ['sales_si', 'sales_hr', 'sales_eu', 'other_inc', 'rev', 'cos', 'gm', 'gm_pct', 'opex', 'ebitda', 'ebitda_pct', 'da', 'ebit', 'fin', 'pbt'];
    var t = '<table><thead><tr><th rowspan="2" style="vertical-align:bottom">' + esc(L.pl) + '</th><th class="grp" colspan="4">' + esc(L.ytd) + '</th><th class="gap"></th><th class="grp" colspan="4">' + esc(L.fy) + '</th></tr>' +
      '<tr><th>' + esc(L.actual) + '</th><th>' + esc(L.budget) + '</th><th>' + esc(L.diff) + '</th><th>' + esc(L.rel) + '</th><th class="gap"></th><th>' + esc(L.outlook) + '</th><th>' + esc(L.budget) + '</th><th>' + esc(L.diff) + '</th><th>' + esc(L.rel) + '</th></tr></thead><tbody>';
    ids.forEach(function (id) {
      if (/_pct$/.test(id)) {
        var of = id.replace('_pct', ''), a1 = E.share(E.sumRange(m.actR[of], 1, c), revA), b1 = E.share(E.sumRange(m.budR[of], 1, c), revB), a2 = E.share(E.total(m.outR[of]), E.total(m.outR.rev)), b2 = E.share(E.total(m.budR[of]), E.total(m.budR.rev));
        var pp = function (x, y2) { if (x == null || y2 == null) return '—'; var r = Math.round((x - y2) * 10) / 10; return (r > 0 ? '+' : r < 0 ? MINUS : '') + nf1.format(Math.abs(r)) + ' ' + L.pp; };
        t += '<tr class="pct"><td>' + esc(packName(L, id)) + '</td><td>' + pctTxt(a1) + '</td><td>' + pctTxt(b1) + '</td><td>' + pp(a1, b1) + '</td><td></td><td class="gap"></td><td>' + pctTxt(a2) + '</td><td>' + pctTxt(b2) + '</td><td>' + pp(a2, b2) + '</td><td></td></tr>';
        return;
      }
      var type = E.typeOf(id);
      t += '<tr' + (E.SUB[id] ? ' class="subt"' : '') + '><td>' + esc(packName(L, id)) + '</td>' + packCells(L, E.sumRange(m.actR[id], 1, c), E.sumRange(m.budR[id], 1, c), type) + '<td class="gap"></td>' + packCells(L, E.total(m.outR[id]), E.total(m.budR[id]), type) + '</tr>';
    });
    t += '</tbody></table>';
    var basis = c < 12 ? L.basis.replace('{closed}', packRange(L, 1, c)).replace('{version}', packVersion(L, m.basis)).replace('{open}', packRange(L, c + 1, 12)) : '';
    basis = basis.replace(/\.\.$/, '.'); // a Croatian date already ends with a full stop
    var kk = function (x) { var e = Math.round(x / 100000); return (e < 0 ? MINUS : '') + nf0.format(Math.abs(e)); };
    var mrow = function (label, arr, outl) { var tds = ''; for (var i = 0; i < 12; i++) tds += '<td' + (outl && i >= c ? ' class="op"' : '') + '>' + kk(arr[i]) + '</td>'; return '<tr><td>' + esc(label) + '</td>' + tds + '<td><b>' + kk(E.total(arr)) + '</b></td></tr>'; };
    var mt = '<table class="mt"><thead><tr><th></th>' + L.mShort.map(function (x) { return '<th>' + esc(x) + '</th>'; }).join('') + '<th>' + esc(L.year) + '</th></tr></thead><tbody>' +
      mrow(L.rAct, m.outR.rev, true) + mrow(L.rBud, m.budR.rev) + mrow(L.eAct, m.outR.ebitda, true) + mrow(L.eBud, m.budR.ebitda) + '</tbody></table>';
    return '<div class="sheet-box"><article class="sheet">' + hdr + k + '<h3>' + esc(L.pl) + ' · ' + esc(packVersion(L, m.bud)) + '</h3>' + t + '<p class="note">' + esc(basis) + ' ' + esc(L.notes) + '</p>' +
      '<h3>' + esc(L.monthly) + '</h3>' + mt + (c < 12 ? '<p class="note">' + esc(L.openNote) + '</p>' : '') +
      '<div class="pf"><span>' + esc(db.company.name) + ' · ' + esc(L.title) + '</span><span>' + esc(L.page.replace('{n}', '1')) + '</span></div></article></div>';
  }
  function packPage2(L, m) {
    var c = m.closed, br = E.bridge(m.bud.values, m.act, 1, c), names = {};
    E.LINES.forEach(function (l) { names[l.id] = packName(L, l.id); });
    names.other = L.other;
    var cbr = E.compactBridge(br, 10);
    cbr.steps.forEach(function (s) { if (s.id === 'other') s.name = L.other; });
    var bridge = bridgeList(cbr, { names: names, startLabel: L.bStart, endLabel: L.bEnd, fmt: function (x) { return num(x); } });
    var langKey = Object.keys(PACK).filter(function (k) { return PACK[k] === L; })[0] || 'en';
    var items = packTop(m).map(function (t) {
      var cm = t.cm, note = '';
      if (cm) {
        var ct = E.commentText(cm, langKey);
        note = '<p' + (ct.inLang ? '' : ' lang="' + ct.lang + '"') + '>' + esc(ct.text) + ' <span style="color:#6B6964">— ' + esc(cm.author || '') + ', ' + esc(L.months[cm.month - 1]) + (cm.status === 'open' ? ' (' + esc(L.open) + ')' : '') + (ct.inLang ? '' : ' ' + esc((L.origIn || {})[ct.lang] || '')) + '</span></p>';
      } else note = '<p class="none">' + esc(L.none) + '</p>';
      var idx = t.v.b > 0 && t.v.a >= 0 ? nf1.format(t.v.a / t.v.b * 100) : '—';
      return '<li><b>' + esc(packName(L, t.l.id)) + '</b><span class="n ' + favCls(t.v.fav) + '">' + sgn(t.v.d) + NB + '€ · ' + (L.index ? esc(L.rel) + ' ' + idx : pctTxt(t.v.pct, true)) + '</span>' + note + '</li>';
    }).join('');
    return '<div class="sheet-box"><article class="sheet page2"><div class="ph"><div><div class="co">' + esc(db.company.name) + '</div><h2 style="font-size:15pt">' + esc(L.ytd) + ': ' + esc(packRange(L, 1, c)) + '</h2></div></div>' +
      '<h3>' + esc(L.bridge) + '</h3>' + bridge + '<h3 style="margin-top:20px">' + esc(L.top) + '</h3><ul class="tv">' + items + '</ul>' +
      '<div class="pf"><span>' + esc(db.company.name) + ' · ' + esc(L.title) + '</span><span>' + esc(L.page.replace('{n}', '2')) + '</span></div></article></div>';
  }
  /** The five lines with the largest effect on profit year to date, each with its comment (the year-to-date one, else
   * the latest on the line). */
  function packTop(m) {
    var c = m.closed;
    return E.LINES.map(function (l) {
      var a = E.sumRange(m.actR[l.id], 1, c), b = E.sumRange(m.budR[l.id], 1, c), v = E.variance(a, b, l.type);
      return { l: l, v: v, eff: E.profitEffect(l.id, v.d) };
    }).sort(function (x, y) { return Math.abs(y.eff) - Math.abs(x.eff); }).slice(0, 5).map(function (t) {
      t.cm = m.cIdx[E.commentKey(t.l.id, c, 'ytd')] || db.comments.filter(function (x) { return x.line === t.l.id; }).sort(function (a, b) { return b.month - a.month || (a.scope === 'ytd' ? -1 : 1); })[0] || null;
      return t;
    });
  }
  function fitSheets() {
    var wrap = document.querySelector('.pack-wrap'); if (!wrap) return;
    var w = wrap.clientWidth;
    wrap.querySelectorAll('.sheet-box').forEach(function (box) {
      var sh = box.querySelector('.sheet'); sh.style.transform = ''; box.style.height = '';
      var sw = sh.offsetWidth;
      if (w && sw > w) { var s = w / sw; sh.style.transform = 'scale(' + s + ')'; sh.style.transformOrigin = 'top left'; box.style.height = Math.ceil(sh.offsetHeight * s + 18) + 'px'; }
    });
  }

  // ── page: headcount plan ─────────────────────────────────────────────────
  function hcCost() { var hc = db.headcount; return E.headcountCost(hc.rows, db.year, { rates: hc.rates, holiday: hc.holiday, holidayMonth: hc.holidayMonth, other: hc.other }); }
  function hcTarget() {
    var v = db.versions.filter(function (x) { return x.id === uHc.vid; })[0];
    return v || latestFc() || budgetV();
  }
  function pctIn(x) { return String(Math.round(x * 100) / 100).replace('.', ','); }
  function pageHeadcount() {
    var m = model(), y = m.y, hc = db.headcount, cost = hcCost(), v = hcTarget(), fr = frozenOf(v);
    var h = head(th('Personnel · {year} · amounts in €', { year: y }), tx('Headcount plan'), th('Who you plan to employ, from when and at what gross pay. Its cost — gross pay, employer contributions, allowances, holiday allowance and other staff costs — can fill the Personnel line of a budget or forecast.'),
      '<button type="button" class="btn" data-act="hccsv">' + ic('dl') + th('Export CSV') + '</button><a class="btn" href="#/line/personnel">' + ic('pl') + th('Personnel line') + '</a>');
    function mopt(sel, emptyLabel) {
      var o = '<option value=""' + (sel ? '' : ' selected') + '>' + esc(emptyLabel) + '</option>', inYear = false;
      for (var i = 1; i <= 12; i++) { var k = y + '-' + E.pad(i); if (k === sel) inYear = true; o += '<option value="' + k + '"' + (k === sel ? ' selected' : '') + '>' + esc(cap(monL(i))) + '</option>'; }
      if (sel && !inYear) o += '<option value="' + esc(sel) + '" selected>' + esc(sel) + '</option>';
      return o;
    }
    var rows = hc.rows.map(function (r, i) {
      var x = cost.rows[i], id = esc(r.id);
      return '<div class="hc-row" role="row"><div class="hc-f hc-role" role="cell"><label for="hr-' + id + '">' + th('Role') + '</label><input class="in" id="hr-' + id + '" maxlength="80" value="' + esc(r.role) + '" data-hc="role" data-v="' + id + '"></div>' +
        '<div class="hc-f" role="cell"><label for="hk-' + id + '">' + th('Country') + '</label><select class="in" id="hk-' + id + '" data-hc="country" data-v="' + id + '"><option value="SI"' + (r.country === 'SI' ? ' selected' : '') + '>SI</option><option value="HR"' + (r.country === 'HR' ? ' selected' : '') + '>HR</option></select></div>' +
        '<div class="hc-f" role="cell"><label for="hf-' + id + '">' + th('FTE') + '</label><input class="in num" id="hf-' + id + '" inputmode="decimal" value="' + esc(pctIn(r.fte)) + '" data-hc="fte" data-v="' + id + '"></div>' +
        '<div class="hc-f" role="cell"><label for="hg-' + id + '">' + th('Gross a month') + '</label><input class="in num" id="hg-' + id + '" inputmode="decimal" value="' + esc(inputNice(r.gross)) + '" data-hc="gross" data-v="' + id + '"></div>' +
        '<div class="hc-f" role="cell"><label for="ha-' + id + '">' + th('Allowances') + '</label><input class="in num" id="ha-' + id + '" inputmode="decimal" value="' + esc(inputNice(r.allow)) + '" data-hc="allow" data-v="' + id + '" title="' + th('Meal and commuting allowances a month at 1 FTE, no contributions') + '"></div>' +
        '<div class="hc-f" role="cell"><label for="hs-' + id + '">' + th('From') + '</label><select class="in" id="hs-' + id + '" data-hc="from" data-v="' + id + '">' + mopt(r.from, tx('Earlier')) + '</select></div>' +
        '<div class="hc-f" role="cell"><label for="he-' + id + '">' + th('Until') + '</label><select class="in" id="he-' + id + '" data-hc="to" data-v="' + id + '">' + mopt(r.to, tx('Ongoing')) + '</select></div>' +
        '<div class="hc-f hc-cost" role="cell"><span class="lab">' + th('Cost {year}', { year: y }) + '</span><b>' + num(x.year) + '</b></div>' +
        '<div class="hc-f hc-del" role="cell"><button type="button" class="btn icon sm ghost" data-act="hcdel" data-v="' + id + '" aria-label="' + th('Remove {role}', { role: esc(r.role || tx('this row')) }) + '">' + ic('trash') + '</button></div></div>';
    }).join('');
    var fteNow = cost.fte[Math.max(0, Math.min(11, m.closed))], fteEnd = cost.fte[11];
    h += '<div class="kpis">' + kpi(tx('Cost of the plan, {year}', { year: y }), keur(E.total(cost.total)), plural(hc.rows.length, 'row', 'rows') + ' · ' + th('{fte} FTE in December', { fte: nf1.format(fteEnd) }), '', '', th('Gross pay {amount}', { amount: keur(E.total(cost.gross)) })) +
      kpi(tx('Employer contributions'), keur(E.total(cost.contrib)), 'SI ' + pctIn(hc.rates.SI) + NB + '% · HR ' + pctIn(hc.rates.HR) + NB + '%', '', '', th('on gross pay')) +
      kpi(tx('FTE now'), nf1.format(fteNow), esc(cap(monL(Math.max(1, Math.min(12, m.closed + 1))))) + ' ' + y, '', '', '') +
      kpi(tx('Personnel in {version}', { version: vname(v) }), keur(E.total(v.values.personnel)), th(v.kind === 'budget' ? '{amount} plan vs budget' : '{amount} plan vs forecast', { amount: skeur(E.total(cost.total) - E.total(v.values.personnel)) }), '', '', '') + '</div>';
    h += '<section class="card"><div class="card-h"><div><span class="label">' + th('People · one row per role or person') + '</span><h2>' + th('Who, from when, at what pay') + '</h2></div><button type="button" class="btn sm" data-act="hcadd">' + ic('plus') + th('Add a row') + '</button></div>' +
      '<div class="hc-table" role="table" aria-label="' + th('Headcount plan') + '"><div class="hc-row hc-head" role="row" aria-hidden="true"><div>' + th('Role') + '</div><div>' + th('Country') + '</div><div class="num">' + th('FTE') + '</div><div class="num">' + th('Gross a month') + '</div><div class="num" title="' + th('Meal and commuting allowances a month at 1 FTE') + '">' + th('Allow.') + '</div><div>' + th('From') + '</div><div>' + th('Until') + '</div><div class="num">' + th('Cost {year}', { year: y }) + '</div><div></div></div>' +
      (rows || '<p class="empty" style="padding:16px 20px">' + th('No one in the plan yet. Add a row per role (e.g. “Warehouse operatives”, FTE 12) or per person.') + '</p>') + '</div>' +
      '<p class="hint" style="padding:10px 20px 16px">' + th('Gross pay and allowances are per month at 1 FTE; FTE 0,5 is half time and 12 is twelve people. The cost counts every month from “From” to “Until”.') + '</p></section>';
    var mo = ''; for (var i = 1; i <= 12; i++) mo += '<option value="' + i + '"' + (hc.holidayMonth === i ? ' selected' : '') + '>' + esc(cap(monL(i))) + '</option>';
    var asm = '<section class="card pad" style="margin-top:14px"><span class="label">' + th('Assumptions') + '</span><form id="hcForm" class="stack" style="margin-top:12px" novalidate>' +
      '<div class="row2"><div class="field"><label for="hcSI">' + th('Employer contributions, Slovenia (%)') + '</label><input class="in" id="hcSI" inputmode="decimal" value="' + esc(pctIn(hc.rates.SI)) + '"><span class="hint">' + th('16,10 % (pension 8,85, health 6,56, injury 0,53, parental 0,10, unemployment 0,06) + 1 % long-term care from 1. 7. 2025 (ZDOsk-1).') + '</span></div>' +
      '<div class="field"><label for="hcHR">' + th('Employer contributions, Croatia (%)') + '</label><input class="in" id="hcHR" inputmode="decimal" value="' + esc(pctIn(hc.rates.HR)) + '"><span class="hint">' + th('16,5 % health insurance (Zakon o doprinosima); pension comes out of the gross.') + '</span></div></div>' +
      '<div class="row2"><div class="field"><label for="hcHol">' + th('Holiday allowance (regres) per FTE (€)') + '</label><input class="in" id="hcHol" inputmode="decimal" value="' + esc(inputNice(hc.holiday)) + '"><span class="hint">' + th('No contributions in Slovenia up to the average monthly wage. At least the minimum wage, paid by 1 July (ZDR-1, Art. 131).') + '</span></div>' +
      '<div class="field"><label for="hcHolM">' + th('Paid in') + '</label><select class="in" id="hcHolM">' + mo + '</select><span class="hint">' + th('To everyone in the plan that month.') + '</span></div></div>' +
      '<div class="field"><label for="hcOther">' + th('Other staff costs a year (€)') + '</label><input class="in" id="hcOther" inputmode="decimal" value="' + esc(inputNice(hc.other)) + '"><span class="hint">' + th('Bonuses, training, team events: spread evenly over the months.') + '</span></div>' +
      '<div class="err" id="hcErr" role="alert" hidden></div><div><button type="submit" class="btn pri">' + th('Save assumptions') + '</button></div></form><p class="hint" style="margin-top:12px">' + th('Rates are defaults to check each year; this is a plan, not a payroll.') + '</p></section>';
    // by month against the chosen version
    var vs = db.versions.slice().sort(function (a, b) { return a.kind === b.kind ? (a.createdOn < b.createdOn ? -1 : 1) : a.kind === 'budget' ? -1 : 1; });
    var trs = '', vt = v.values.personnel;
    for (i = 0; i < 12; i++) {
      var dd = cost.total[i] - vt[i], fz = i < fr;
      trs += '<tr' + (fz ? ' class="muted-row"' : '') + '><td class="nw"><span class="hc-x">' + esc(cap(monL(i + 1))) + '</span><span class="hc-s">' + esc(mon(i + 1)) + '</span>' + (fz ? ' <span class="tag hc-x" title="' + th('This version holds actuals for the month') + '">' + th('actual') + '</span>' : '') + '</td><td class="num">' + nf1.format(cost.fte[i]) + '</td><td class="num hc-x">' + num(cost.gross[i]) + '</td><td class="num hc-x">' + num(cost.contrib[i]) + '</td><td class="num hc-x">' + num(cost.allow[i] + cost.holiday[i]) + '</td><td class="num hc-x">' + num(cost.other[i]) + '</td><td class="num"><b>' + num(cost.total[i]) + '</b></td><td class="num">' + num(vt[i]) + '</td><td class="num ' + (dd ? favCls(dd < 0) : '') + '">' + sgn(dd) + '</td></tr>';
    }
    var tt = E.total(cost.total) - E.total(vt);
    var can = !v.locked && fr < 12;
    h += '<section class="card" style="margin-top:14px"><div class="card-h"><div><span class="label">' + th('By month · against {version}', { version: esc(vname(v)) }) + '</span><h2>' + th('Plan cost and the Personnel line') + '</h2></div>' +
      '<div><label class="sr" for="hcVer">' + th('Compare with') + '</label><select class="select" id="hcVer" data-ch="hcver">' + vs.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === v.id ? ' selected' : '') + '>' + esc(vname(x)) + '</option>'; }).join('') + '</select></div></div>' +
      '<div class="tw"><table class="t compact hc-month"><thead><tr><th>' + th('Month') + '</th><th class="num">' + th('FTE') + '</th><th class="num hc-x">' + th('Gross') + '</th><th class="num hc-x">' + th('Contrib.') + '</th><th class="num hc-x">' + th('Allow. + holiday') + '</th><th class="num hc-x">' + th('Other') + '</th><th class="num">' + th('Plan') + '</th><th class="num">' + th(v.kind === 'budget' ? 'Budget' : 'Forecast') + '</th><th class="num">Δ</th></tr></thead><tbody>' + trs + '</tbody>' +
      '<tfoot><tr><td>' + th('Year') + '</td><td></td><td class="num hc-x">' + num(E.total(cost.gross)) + '</td><td class="num hc-x">' + num(E.total(cost.contrib)) + '</td><td class="num hc-x">' + num(E.total(cost.allow) + E.total(cost.holiday)) + '</td><td class="num hc-x">' + num(E.total(cost.other)) + '</td><td class="num">' + num(E.total(cost.total)) + '</td><td class="num">' + num(E.total(vt)) + '</td><td class="num ' + (tt ? favCls(tt < 0) : '') + '">' + sgn(tt) + '</td></tr></tfoot></table></div>' +
      '<div class="toolbar" style="padding:12px 20px 18px"><button type="button" class="btn pri" data-act="hcapply"' + (can && hc.rows.length ? '' : ' disabled') + '>' + ic('check') + th('Use as Personnel in {version}', { version: esc(vname(v)) }) + '</button><span class="hint">' + (v.locked ? th('{version} is approved and locked: choose a forecast, or unlock it on Budget & forecast.', { version: esc(vname(v)) }) : fr >= 12 ? th('Every month of this forecast holds actuals.') : th(fr ? 'Fills {range} (earlier months hold actuals). Undo on Budget & forecast puts the old numbers back.' : 'Fills {range}. Undo on Budget & forecast puts the old numbers back.', { range: esc(range(fr + 1, 12)) })) + '</span></div></section>' + asm;
    return h;
  }
  function hcApply() {
    var v = hcTarget(), fr = frozenOf(v), cost = hcCost();
    if (v.locked) return toast(lockedMsg());
    var before = v.values.personnel.slice(), after = before.slice(0, fr).concat(cost.total.slice(fr));
    if (same(before, after)) return toast(tx('Personnel in {version} already matches the plan', { version: vname(v) }));
    confirmBox(tx('Use the headcount plan for Personnel?'), th('Personnel in {version} for {range} becomes the plan’s cost: {plan} instead of {now}.', { version: '<b>' + esc(vname(v)) + '</b>', range: esc(range(fr + 1, 12)), plan: eur(E.sumRange(cost.total, fr + 1, 12)), now: eur(E.sumRange(before, fr + 1, 12)) }), tx('Use the plan'), function () {
      pushUndo(v, tx('Personnel from the headcount plan'), [{ id: 'personnel', before: before, after: after }]);
      commit(v.name + ': Personnel filled in from the headcount plan', function () { v.values.personnel = after; });
      toast(tx('Personnel in {version}: {amount} for the year', { version: vname(v), amount: eur(E.total(after)) }));
    });
  }
  function hcCsv() {
    var cost = hcCost(), y = db.year, rows = [['role', 'country', 'fte', 'gross a month', 'allowances a month', 'from', 'until'].map(function (x) { return tx(x); }).concat(I.months.map(function (x) { return x + ' ' + y; })).concat([tx('year')])];
    db.headcount.rows.forEach(function (r, i) { rows.push([r.role, r.country, String(r.fte).replace('.', ','), E.centsText(r.gross), E.centsText(r.allow), r.from, r.to].concat(cost.rows[i].total.map(function (c) { return E.centsText(c); })).concat([E.centsText(cost.rows[i].year)])); });
    [['gross', 'Gross pay'], ['contrib', 'Employer contributions'], ['allow', 'Allowances'], ['holiday', 'Holiday allowance'], ['other', 'Other staff costs'], ['total', 'Total']].forEach(function (k) {
      rows.push([tx(k[1]), '', '', '', '', '', ''].concat(cost[k[0]].map(function (c) { return E.centsText(c); })).concat([E.centsText(E.total(cost[k[0]]))]));
    });
    download('headcount-' + y + '.csv', E.toCsv(rows, ';'));
  }

  // ── page: settings ───────────────────────────────────────────────────────
  function pageSettings() {
    var m = model(), s = db.settings, y = m.y;
    var synced = !!(sync && window.StratumSync && StratumSync.user());
    var h = head(th('Settings'), tx('Company, closing and accounts'), th('Thresholds and the closing rule are defaults to check against your own close calendar and materiality.') + ' ' + th(synced ? 'Saved in this browser and in your private cloud copy.' : 'Everything is saved in this browser only.'), '');
    // the screen language: this browser only
    h += '<section class="card pad" style="margin:0 0 14px"><div class="lang-set"><div><span class="label">' + th('This browser') + '</span><h2>' + th('Screen language') + '</h2></div><div class="seg" role="group" aria-label="' + th('Screen language') + '">' + [['en', 'English'], ['sl', 'Slovenščina'], ['hr', 'Hrvatski']].map(function (o) { return '<button type="button" data-act="uilang" data-v="' + o[0] + '" lang="' + o[0] + '" aria-pressed="' + (LANG === o[0]) + '">' + o[1] + '</button>'; }).join('') + '</div></div><p class="hint" style="margin-top:8px">' + th('The language of the screens. The board pack follows it unless you choose another language there; each comment keeps the language it was written in.') + '</p></section>';
    h += '<div id="syncPanel" class="sync-panel" style="margin:0 0 14px"></div>';
    var autoNow = E.capByLoaded(m.auto, db.loaded[y]);
    var closeOpts = '<option value="auto"' + (s.closed === 'auto' ? ' selected' : '') + '>' + th('Automatic: {days} after month end (now {now})', { days: plural(s.grace, 'day', 'days'), now: autoNow ? th('through {month}', { month: esc(monG(autoNow)) }) : th('none') }) + '</option><option value="0"' + (s.closed === 0 ? ' selected' : '') + '>' + th('No month closed') + '</option>';
    for (var i = 1; i <= 12; i++) closeOpts += '<option value="' + i + '"' + (s.closed === i ? ' selected' : '') + '>' + th('Through {month}', { month: esc(monG(i)) + ' ' + y }) + (db.loaded[y][i - 1] ? '' : ' ' + th('(no actuals yet)')) + '</option>';
    h += '<div class="grid2"><section class="card pad"><span class="label">' + th('Company and close') + '</span><form id="setForm" class="stack" style="margin-top:12px" novalidate>' +
      '<div class="field"><label for="sName">' + th('Company name') + '</label><input class="in" id="sName" maxlength="80" value="' + esc(db.company.name) + '"></div>' +
      '<div class="row2"><div class="field"><label for="sWhat">' + th('What it does') + '</label><input class="in" id="sWhat" maxlength="120" value="' + esc(db.company.what || '') + '"></div><div class="field"><label for="sCity">' + th('City') + '</label><input class="in" id="sCity" maxlength="60" value="' + esc(db.company.city || '') + '"></div></div>' +
      '<div class="field"><label for="sClosed">' + th('Closed through') + '</label><select class="in" id="sClosed">' + closeOpts + '</select><span class="hint">' + th('Closed months count as actual everywhere; open months use the budget or forecast.') + '</span></div>' +
      '<div class="row2"><div class="field"><label for="sGrace">' + th('Days after month end before it closes') + '</label><input class="in" id="sGrace" type="number" min="0" max="60" step="1" value="' + s.grace + '"></div><div class="field"><label for="sAuthor">' + th('Your name on new comments') + '</label><input class="in" id="sAuthor" maxlength="60" value="' + esc(s.author) + '"></div></div>' +
      '<fieldset class="grp"><legend>' + th('Needs an explanation when the variance is at least') + '</legend><div class="row3"><div class="field"><label for="sPct">' + th('Percent of budget') + '</label><input class="in" id="sPct" inputmode="decimal" value="' + String(s.pct).replace('.', ',') + '"></div><div class="field"><label for="sMonth">' + th('€ in a month') + '</label><input class="in" id="sMonth" inputmode="decimal" value="' + nf0.format(s.monthAbs) + '"></div><div class="field"><label for="sYtd">' + th('€ year to date') + '</label><input class="in" id="sYtd" inputmode="decimal" value="' + nf0.format(s.ytdAbs) + '"></div></div><span class="hint">' + th('Both the percentage and the amount must be reached. Against a zero budget only the amount counts.') + '</span>' +
      '<div class="field" style="margin-top:12px"><label for="sAlways">' + th('Always needs an explanation above (€)') + '</label><input class="in" id="sAlways" inputmode="decimal" value="' + (s.alwaysAbs ? nf0.format(s.alwaysAbs) : '') + '" placeholder="' + th('Off') + '" style="max-width:200px"><span class="hint">' + th('Any variance of at least this amount, in a month or year to date, needs a comment whatever its percentage, so the biggest ones are always explained. Empty or 0 turns it off.') + '</span></div></fieldset>' +
      '<div class="field"><span class="lab">' + th('Full-year outlook uses') + '</span><div class="radio-row"><label><input type="radio" name="sBasis" value="forecast"' + (s.basis === 'forecast' ? ' checked' : '') + '> ' + th('The newest forecast') + ' ' + (m.fc ? '(' + esc(vname(m.fc)) + ')' : th('(none yet: the budget is used)')) + '</label><label><input type="radio" name="sBasis" value="budget"' + (s.basis === 'budget' ? ' checked' : '') + '> ' + th('The budget') + '</label></div></div>' +
      '<div class="err" id="setErr" role="alert" hidden></div><div><button type="submit" class="btn pri">' + th('Save') + '</button></div></form></section>';
    h += '<section class="card pad"><span class="label">' + th('Data') + '</span><h2>' + th('About this data') + '</h2><p class="sub">' + th('{company} and every person, account and amount here is fictional demo data. Import your own actuals on the Import page, map your accounts below and type your budget to try it with real numbers. Nothing leaves this browser unless you sign in to sync.', { company: esc(db.company.name) }) + '</p>' +
      '<div class="toolbar" style="margin-top:14px"><button type="button" class="btn" data-act="tmpl">' + ic('file') + th('CSV template') + '</button><button type="button" class="btn" data-act="actcsv">' + ic('dl') + th('Current actuals') + '</button><button type="button" class="btn danger" data-act="reset">' + th('Reset demo data') + '</button></div>' +
      '<h3 class="label" style="margin:18px 0 6px">' + th('Activity') + '</h3><ul class="log">' + db.log.slice(0, 12).map(function (l) { return '<li><small>' + dt(l.at) + '</small>' + esc(lx(l.text)) + '</li>'; }).join('') + '</ul></section></div>';
    h += accountsEditor();
    return h;
  }
  /** the P&L lines as option groups by section, in the screen language */
  function lineOptions(sel) {
    return E.SECTIONS.map(function (s) { return '<optgroup label="' + esc(tx(s.name)) + '">' + E.LINES.filter(function (l) { return l.section === s.id; }).map(function (l) { return '<option value="' + l.id + '"' + (sel === l.id ? ' selected' : '') + '>' + esc(lnm(l.id)) + '</option>'; }).join('') + '</optgroup>'; }).join('');
  }
  function lineSelect(id, sel, attrs) {
    return '<select class="in" id="' + id + '" ' + (attrs || '') + '>' + (sel ? '' : '<option value="">' + th('Not mapped') + '</option>') + lineOptions(sel) + '</select>';
  }
  function accountsEditor() {
    var m = model(), y = m.y, q = (uSt.q || '').toLowerCase();
    var list = db.accounts.filter(function (a) { return (!uSt.line || a.line === uSt.line) && (!q || (a.code + ' ' + a.name).toLowerCase().indexOf(q) >= 0); }).sort(function (a, b) { return a.code < b.code ? -1 : 1; });
    var rows = list.map(function (a) {
      var id = keyId(a.code), ytd = (db.actuals[y] || {})[a.code], has = [y - 1, y].some(function (yy) { var arr = (db.actuals[yy] || {})[a.code]; return arr && arr.some(function (x) { return x; }); });
      return '<tr><td class="code">' + esc(a.code) + '</td><td class="nm"><label class="sr" for="an-' + id + '">' + th('Name of {code}', { code: esc(a.code) }) + '</label><input class="in" id="an-' + id + '" maxlength="80" value="' + esc(a.name) + '" data-ch="accname" data-v="' + esc(a.code) + '"></td>' +
        '<td class="kd"><label class="sr" for="ak-' + id + '">' + th('Kind of {code}', { code: esc(a.code) }) + '</label><select class="in" id="ak-' + id + '" data-ch="acckind" data-v="' + esc(a.code) + '"><option value="income"' + (a.kind === 'income' ? ' selected' : '') + '>' + th('Income') + '</option><option value="cost"' + (a.kind === 'cost' ? ' selected' : '') + '>' + th('Cost') + '</option></select></td>' +
        '<td class="ln"><label class="sr" for="al-' + id + '">' + th('P&L line of {code}', { code: esc(a.code) }) + '</label>' + lineSelect('al-' + id, a.line, 'data-ch="accline" data-v="' + esc(a.code) + '"') + '</td>' +
        '<td class="num">' + (ytd ? num(E.accountSign(a) * E.sumRange(ytd, 1, m.closed)) : '<span class="muted">—</span>') + '</td>' +
        '<td>' + (has ? '' : '<button type="button" class="btn icon sm ghost" data-act="accdel" data-v="' + esc(a.code) + '" aria-label="' + th('Delete account {code}', { code: esc(a.code) }) + '">' + ic('trash') + '</button>') + '</td></tr>';
    }).join('');
    return '<section class="card"><div class="card-h"><div><span class="label">' + th(db.chart === 'si-2016' ? 'Slovenian chart of accounts (kontni okvir za gospodarske družbe)' : 'Chart of accounts') + '</span><h2>' + th('Accounts and the P&L line each one feeds') + '</h2><p class="sub">' + plural(db.accounts.length, 'account', 'accounts') + '. ' + th('Class 4 holds costs by nature; in class 7, groups 70–75 are expenses (702 cost of goods sold, 742 interest) and 76–78 income. A cost account in an income line (interest expense in the financial result) counts against it. Changes apply at once to every report.') + '</p></div></div>' +
      '<div class="toolbar" style="padding:0 20px"><label class="sr" for="accQ">' + th('Search accounts') + '</label><input class="search" type="search" id="accQ" placeholder="' + th('Search code or name') + '" value="' + esc(uSt.q) + '"><label class="sr" for="accLine">' + th('Line') + '</label><select class="select" id="accLine" data-ch="accfilter"><option value="">' + th('All lines') + '</option>' + E.LINES.map(function (l) { return '<option value="' + l.id + '"' + (uSt.line === l.id ? ' selected' : '') + '>' + esc(lnm(l.id)) + '</option>'; }).join('') + '</select></div>' +
      '<div class="tw"><table class="t acc-t"><thead><tr><th>' + th('Code') + '</th><th>' + th('Name') + '</th><th>' + th('Kind') + '</th><th>' + th('P&L line') + '</th><th class="num">' + y + ' ' + th('YTD') + '</th><th><span class="sr">' + th('Delete') + '</span></th></tr></thead><tbody>' + (rows || '<tr><td colspan="6" class="empty">' + th('No accounts match.') + '</td></tr>') + '</tbody></table></div>' +
      '<form id="accAdd" class="cf" style="margin:14px 20px 20px" novalidate><div class="row"><label class="sr" for="aaCode">' + th('New account code') + '</label><input class="in" id="aaCode" maxlength="20" placeholder="' + th('Code, e.g. 4180') + '" style="max-width:150px"><label class="sr" for="aaName">' + th('Name') + '</label><input class="in grow" id="aaName" maxlength="80" placeholder="' + th('Name') + '"><label class="sr" for="aaLine">' + th('P&L line') + '</label>' + lineSelect('aaLine', 'other_cost', 'style="max-width:260px"') + '<button type="submit" class="btn sm pri">' + ic('plus') + th('Add account') + '</button></div><span class="hint">' + th('The kind follows the line; change it in the table if the account works the other way.') + '</span></form></section>';
  }

  // ── render ───────────────────────────────────────────────────────────────
  var PAGES = { '': pageOverview, pl: pagePl, line: pageLine, budget: pageBudget, import: pageImport, comments: pageComments, print: pagePrint, people: pageHeadcount, settings: pageSettings };
  var TITLES = { '': 'Overview', pl: 'Profit and loss', line: 'Line', budget: 'Budget & forecast', import: 'Import actuals', comments: 'Comments', print: 'Board pack', people: 'Headcount', settings: 'Settings' };
  var lastKey = null;
  function focusKeyOf(el) {
    if (!el || el === document.body || !$('main').contains(el)) return null;
    if (el.id) return '#' + el.id;
    var a = el.getAttribute('data-act'), v = el.getAttribute('data-v');
    return a ? '[data-act="' + a + '"]' + (v != null ? '[data-v="' + v.replace(/"/g, '\\"') + '"]' : '') : null;
  }
  function render() {
    if (!db) return;
    editing = null;
    CH = {};
    renderNav();
    var r = parseRoute(), key = r.name + '/' + r.arg, y = window.scrollY, fk = focusKeyOf(document.activeElement);
    var bw = $('bgWrap'), bsl = bw ? bw.scrollLeft : 0, pw = document.querySelector('.pl-wrap'), psl = pw ? pw.scrollLeft : 0;
    $('main').innerHTML = '<div class="page">' + PAGES[r.name](r.arg) + '</div>';
    document.body.classList.toggle('printing-pack', r.name === 'print');
    drawCharts(); fitSheets();
    if (syncPanelOff) { syncPanelOff(); syncPanelOff = null; }
    if (sync && $('syncPanel')) syncPanelOff = sync.mountPanel($('syncPanel'));
    if (key !== lastKey) {
      window.scrollTo(0, 0);
      var h1 = $('main').querySelector('h1');
      if (h1 && lastKey !== null) h1.focus({ preventScroll: true });
    } else {
      window.scrollTo(0, y);
      if ($('bgWrap')) $('bgWrap').scrollLeft = bsl;
      if (document.querySelector('.pl-wrap')) document.querySelector('.pl-wrap').scrollLeft = psl;
      if (fk) { try { var el = $('main').querySelector(fk); if (el) el.focus({ preventScroll: true }); } catch (e) { /* bad selector */ } }
    }
    if (r.name === 'budget') refreshGrid();
    if (r.name === 'budget') { var cell = cellAt(Math.min(uBud.ri || 0, GRID.length - 1), Math.max(1, Math.min(13, uBud.m || 1))) || cellAt(0, 1); if (cell) cell.setAttribute('tabindex', '0'); }
    lastKey = key;
    document.title = (r.name === 'line' && (E.LINE[r.arg] || E.SUB[r.arg]) ? lnm(r.arg) : tx(TITLES[r.name])) + ' — ' + tx('Budget vs actual') + ' — Business Apps';
  }
  window.addEventListener('hashchange', function () { closeLayer(); $('side').classList.remove('open'); $('menuBtn').setAttribute('aria-expanded', 'false'); render(); });

  // ── actions ──────────────────────────────────────────────────────────────
  function readFile(file) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return toast(tx('That file is over 5 MB.'));
    if (/\.xlsx$/i.test(file.name) && window.BudgetXlsx) {
      file.arrayBuffer().then(function (buf) { return BudgetXlsx.toText(buf); }).then(function (t) { readImport(t, file.name); }, function (err) { toast(err && err.message ? lx(err.message) : tx('The Excel file could not be read. Save it as CSV and try again.')); });
      return;
    }
    if (/\.xls$/i.test(file.name)) return toast(tx('Old Excel files (.xls) cannot be read: save it as .xlsx or CSV.'));
    var rd = new FileReader();
    rd.onload = function () { readImport(String(rd.result || ''), file.name); };
    rd.onerror = function () { toast(tx('The file could not be read.')); };
    rd.readAsText(file);
  }
  var ACT = {
    close: function () { closeLayer(); },
    print: function () { window.print(); },
    basis: function (v) { if (db.settings.basis === v) return; commit('Full-year outlook now uses ' + (v === 'budget' ? 'the budget' : 'the newest forecast'), function () { db.settings.basis = v; }); },
    ovchart: function (v) { uOv.chart = v; saveUi(); render(); },
    ovbridge: function (v) { uOv.bridge = v; saveUi(); render(); },
    plper: function (v) { uPl.per = v; saveUi(); render(); },
    plcmp: function (v) { uPl.cmp = v; saveUi(); render(); },
    plpct: function () { uPl.pctRev = !uPl.pctRev; saveUi(); render(); },
    plx: function (v) { uPl.open[v] = !uPl.open[v]; saveUi(); render(); },
    plall: function () { var any = Object.keys(uPl.open).some(function (k) { return uPl.open[k]; }); uPl.open = {}; if (!any) E.LINES.forEach(function (l) { uPl.open[l.id] = true; }); saveUi(); render(); },
    plcsv: function () { plCsv(); },
    budline: function (v) { uBud.line = v; var idx = gridRows().map(function (r) { return r.id; }).indexOf(v); if (idx >= 0) { uBud.ri = idx; uBud.m = Math.min(12, model().closed + 1); } saveUi(); location.hash = '#/budget'; },
    bver: function (v) { uBud.vid = v; saveUi(); render(); },
    undo: function () { doUndo(); },
    tools: function (v) { openTools(v); },
    newfc: function () { newForecast(); },
    unlock: function () {
      var v = curVersion();
      confirmBox(tx('Unlock {version}?', { version: vname(v) }), th('It was approved on {date}. Every report compares against it, so a change shows up everywhere. Approve and lock it again when you are done.', { date: dt(v.approvedOn) }), tx('Unlock'), function () {
        commit('Unlocked ' + v.name, function () { v.locked = false; v.unlockedOn = TODAY; });
      });
    },
    approve: function () { var v = curVersion(); commit('Approved and locked ' + v.name, function () { v.locked = true; v.approvedOn = TODAY; }); toast(tx('{version} approved and locked', { version: vname(v) })); },
    delfc: function () {
      var v = curVersion();
      if (v.kind !== 'forecast') return;
      confirmBox(tx('Delete {version}?', { version: vname(v) }), th('The forecast and its numbers are removed. Comparisons and the outlook fall back to the newest remaining forecast, or the budget. This cannot be undone.'), tx('Delete'), function () {
        commit('Deleted ' + v.name, function () { db.versions = db.versions.filter(function (x) { return x.id !== v.id; }); });
        undoStack = undoStack.filter(function (u) { return u.vid !== v.id; });
        uBud.vid = 'budget'; saveUi(); render(); toast(tx('{version} deleted', { version: vname(v) }));
      }, true);
    },
    phprev: function () { var ids = E.LINES.map(function (l) { return l.id; }), i = ids.indexOf(uBud.line); if (i > 0) { uBud.line = ids[i - 1]; saveUi(); render(); } },
    phnext: function () { var ids = E.LINES.map(function (l) { return l.id; }), i = ids.indexOf(uBud.line); if (i < ids.length - 1) { uBud.line = ids[Math.max(0, i + 1)]; saveUi(); render(); } },
    cedit: function (v) { editingC[v] = true; render(); var t = $('ct-' + keyId(v)); if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); } },
    ccancel: function (v) { delete editingC[v]; render(); },
    creuse: function (v, el) { var from = db.comments.filter(function (c) { return c.id === el.getAttribute('data-from'); })[0], t = $('ct-' + keyId(v)); if (from && t) { t.value = from.text; t.focus(); } },
    cdel: function (v) {
      var cm = model().cIdx[v]; if (!cm) return;
      confirmBox(tx('Delete this comment?'), esc(lnm(cm.line)) + ', ' + esc(cm.scope === 'ytd' ? tx('year to date through {month}', { month: monG(cm.month) }) : monL(cm.month)) + ': ' + th('“{text}”', { text: esc(cm.text.slice(0, 120)) + (cm.text.length > 120 ? '…' : '') }), tx('Delete'), function () {
        delete editingC[v];
        commit('Deleted a comment on ' + E.nameOf(cm.line), function () { db.comments = db.comments.filter(function (x) { return x !== cm; }); });
        toast(tx('Comment deleted'));
      }, true);
    },
    cmf: function (v) { uCm.f = v; saveUi(); render(); },
    // choosing the screen language again makes the pack follow the screens
    packlang: function (v) { if (!PACK[v]) return; uPk.picked = v !== LANG; uPk.lang = uPk.picked ? v : ''; saveUi(); render(); },
    pick: function () { $('csvPick').value = ''; $('csvPick').click(); },
    hcadd: function () {
      var nr = { id: 'h' + Date.now().toString(36), role: '', country: 'SI', fte: 1, gross: 200000, allow: 18000, from: db.year + '-' + E.pad(Math.min(12, model().closed + 1)), to: '' };
      commit('Added a row to the headcount plan', function () { db.headcount.rows.push(nr); });
      var el = $('hr-' + nr.id); if (el) el.focus();
    },
    hcdel: function (v) {
      var r = db.headcount.rows.filter(function (x) { return x.id === v; })[0]; if (!r) return;
      confirmBox(tx('Remove {role}?', { role: r.role || tx('this row') }), th('The row leaves the headcount plan. Budgets and forecasts keep their numbers until you use the plan again.'), tx('Remove'), function () {
        commit('Removed ' + (r.role || 'a row') + ' from the headcount plan', function () { db.headcount.rows = db.headcount.rows.filter(function (x) { return x !== r; }); });
      }, true);
    },
    hcapply: function () { hcApply(); },
    hccsv: function () { hcCsv(); },
    pasteimp: function () { var t = $('impPaste'); if (!t || !t.value.trim()) return toast(tx('Paste some rows first.')); readImport(t.value, tx('Pasted rows')); },
    impcancel: function () { imp = null; render(); },
    doimport: function () { doImport(); },
    closenow: function (v) { var n = +v; commit('Closed through ' + E.MONTHS_LONG[n - 1] + ' by hand', function () { db.settings.closed = n; }); lastImport = null; render(); toast(tx('Closed through {month}', { month: monG(n) })); },
    tmpl: function () { download('actuals-template.csv', E.toCsv(tmplRows(db.year), ';')); },
    actcsv: function () {
      var y = db.year, rows = E.actualsRows(db.actuals, db.accounts, [y - 1, y]);
      rows[0] = tmplRows(y)[0]; // the header in the screen language (the import reads mesec/konto/znesek and mjesec/konto/iznos too)
      download('actuals-' + (y - 1) + '-' + y + '.csv', E.toCsv(rows, ';'));
    },
    uilang: function (v) { setLang(v); },
    accdel: function (v) {
      var a = db.accounts.filter(function (x) { return x.code === v; })[0]; if (!a) return;
      confirmBox(tx('Delete account {code}?', { code: a.code }), th('{name} has no actuals, so nothing else changes.', { name: esc(a.name) }), tx('Delete'), function () { commit('Deleted account ' + a.code, function () { db.accounts = db.accounts.filter(function (x) { return x !== a; }); Object.keys(db.actuals).forEach(function (yy) { delete db.actuals[yy][a.code]; }); }); }, true);
    },
    reset: function () {
      confirmBox(tx('Reset demo data?'), th('This replaces everything in this app, including your imports, budget changes and comments, with fresh demo data for today. It cannot be undone.'), tx('Reset'), function () {
        db = X.generate(TODAY); ensureSchema(); invalidate(); undoStack = []; imp = null; lastImport = null; editingC = {};
        idbOK = true; byPerson = false; saveTimer = 1; flush();
        render(); toast(tx('Demo data reset'));
      }, true);
    }
  };

  // ── events ───────────────────────────────────────────────────────────────
  document.addEventListener('click', function (e) {
    var hit = e.target.closest && e.target.closest('.chart .hit');
    if (hit) { var box = hit.closest('.chart'); showTip(box, +hit.getAttribute('data-i'), e); }
    var el = e.target.closest && e.target.closest('[data-act]');
    if (el && !el.disabled) {
      var act = el.getAttribute('data-act');
      if (ACT[act]) { if (el.tagName === 'A') e.preventDefault(); lastTrigger = el; ACT[act](el.getAttribute('data-v'), el, e); return; }
    }
    var cell = e.target.closest && e.target.closest('#bgGrid td.c');
    if (cell && !(editing && editing.td === cell)) focusCell(cell);
  });
  document.addEventListener('dblclick', function (e) { var cell = e.target.closest && e.target.closest('#bgGrid td.c'); if (cell && !editing) startEdit(cell); });
  document.addEventListener('mouseover', function (e) { var hit = e.target.closest && e.target.closest('.chart .hit'); if (hit) showTip(hit.closest('.chart'), +hit.getAttribute('data-i'), e); });
  document.addEventListener('mouseout', function (e) {
    var hit = e.target.closest && e.target.closest('.chart .hit'); if (!hit) return;
    var to = e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.chart .hit');
    var box = hit.closest('.chart');
    if (!to && document.activeElement !== box) hideTip(box);
  });
  document.addEventListener('focusin', function (e) {
    var t = e.target;
    if (t.classList && t.classList.contains('chart') && CH[t.id]) showTip(t, t._i != null ? t._i : Math.max(0, model().closed - 1));
  });
  document.addEventListener('focusout', function (e) {
    var t = e.target;
    if (t.classList && t.classList.contains('chart')) hideTip(t);
    if (editing && t === editing.input) {
      var val = E.parseInput(t.value);
      if (isNaN(val)) { var ed = editing; editing = null; ed.td.textContent = cellText(ed.td, E.rowsOf(curVersion().values)); toast(tx('Not saved: that was not a number.')); return; }
      var ed2 = editing; editing = null;
      if (val !== ed2.orig) applyCell(ed2.id, ed2.m, val);
      ed2.td.textContent = cellText(ed2.td, E.rowsOf(curVersion().values));
    }
  });
  document.addEventListener('keydown', function (e) {
    var t = e.target;
    // dialogs: Escape closes, Tab stays inside
    if ($('layers').innerHTML) {
      if (e.key === 'Escape') { e.preventDefault(); closeLayer(); return; }
      if (e.key === 'Tab') {
        var box = $('layers').querySelector('.modal'); if (!box) return;
        var f = Array.prototype.filter.call(box.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'), function (x) { return x.offsetParent !== null && !(x.type === 'radio' && !x.checked); });
        if (!f.length) { e.preventDefault(); box.focus(); return; }
        if (e.shiftKey && (document.activeElement === f[0] || document.activeElement === box)) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
      return;
    }
    // budget grid: editing a cell
    if (t.classList && t.classList.contains('cell-in')) {
      if (e.key === 'Enter') { e.preventDefault(); endEdit(true, e.shiftKey ? 'up' : 'down'); }
      else if (e.key === 'Tab') { e.preventDefault(); endEdit(true, e.shiftKey ? 'left' : 'right'); }
      else if (e.key === 'Escape') { e.preventDefault(); var ed = editing; editing = null; if (ed) { ed.td.textContent = cellText(ed.td, E.rowsOf(curVersion().values)); focusCell(ed.td); } }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); endEdit(true, e.key === 'ArrowUp' ? 'up' : 'down'); }
      return;
    }
    // budget grid: moving between cells
    if (t.matches && t.matches('#bgGrid td.c')) {
      var dir = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Home: 'home', End: 'end' }[e.key];
      if (dir) { e.preventDefault(); var nx = neighbor(t, dir); if (nx) focusCell(nx); return; }
      if (e.key === 'Tab') { var nb = neighbor(t, e.shiftKey ? 'left' : 'right'); if (nb) { e.preventDefault(); focusCell(nb); } return; }
      if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); startEdit(t); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); startEdit(t, ''); return; }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); doUndo(); return; }
      if (e.key.length === 1 && /[0-9,.\-+]/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); startEdit(t, e.key); return; }
      return;
    }
    if (parseRoute().name === 'budget' && (e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z') && !(t.matches && t.matches('input, textarea, select'))) { e.preventDefault(); doUndo(); return; }
    // charts: arrows read the months
    if (t.classList && t.classList.contains('chart') && CH[t.id]) {
      var i = t._i != null ? t._i : 0;
      if (e.key === 'ArrowRight') { e.preventDefault(); showTip(t, i + 1); } else if (e.key === 'ArrowLeft') { e.preventDefault(); showTip(t, i - 1); }
      else if (e.key === 'Home') { e.preventDefault(); showTip(t, 0); } else if (e.key === 'End') { e.preventDefault(); showTip(t, 11); }
      else if (e.key === 'Escape') hideTip(t);
      return;
    }
    if (e.key === 'Escape' && $('side').classList.contains('open')) { $('side').classList.remove('open'); $('menuBtn').setAttribute('aria-expanded', 'false'); $('menuBtn').focus(); }
  });
  document.addEventListener('paste', function (e) {
    var t = document.activeElement;
    if (!t || !t.matches || !t.matches('#bgGrid td.c') || editing) return;
    var text = e.clipboardData ? e.clipboardData.getData('text') : '';
    if (!text) return;
    e.preventDefault();
    pasteBlock(t, text);
  });
  document.addEventListener('copy', function (e) {
    var t = document.activeElement;
    if (!t || !t.matches || !t.matches('#bgGrid td.c') || editing || !e.clipboardData) return;
    var v = curVersion(), id = t.getAttribute('data-id'), m = +t.getAttribute('data-m'), rows = E.rowsOf(v.values);
    var c = t.getAttribute('data-k') === 'pct' ? null : m === 13 ? E.total(rows[id]) : m <= 12 ? rows[id][m - 1] : null;
    if (c == null) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', inputText(c));
    toast(tx('Copied {amount}', { amount: eur2(c) }));
  });
  document.addEventListener('submit', function (e) {
    var f = e.target;
    if (f.id === 'mdForm') { e.preventDefault(); modalError(''); if (modalSubmit) modalSubmit(); return; }
    if (f.classList && f.classList.contains('cf') && f.getAttribute('data-k')) {
      e.preventDefault();
      var key = f.getAttribute('data-k'), parts = key.split('|'), line = parts[0], month = +parts[1], scope = parts[2];
      var text = f.elements.text.value.trim(), status = f.elements.status.value, author = f.elements.author.value.trim(), lang = PACK_LANGS[f.elements.lang.value] ? f.elements.lang.value : LANG, texts = {};
      Object.keys(PACK_LANGS).forEach(function (k) { var el = f.elements['t_' + k], v = el ? el.value.trim() : ''; if (v && k !== lang) texts[k] = v; });
      if (!text) { f.elements.text.setAttribute('aria-invalid', 'true'); f.elements.text.focus(); return toast(tx('Write what happened first.')); }
      var cm = model().cIdx[key];
      delete editingC[key];
      commit((cm ? 'Edited' : 'Added') + ' a comment on ' + E.nameOf(line) + ', ' + (scope === 'ytd' ? 'year to date' : E.MONTHS_LONG[month - 1]), function () {
        if (cm) { cm.text = text; cm.status = status; cm.author = author; cm.lang = lang; cm.texts = texts; cm.edited = TODAY; }
        else db.comments.push({ id: 'c' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36), line: line, month: month, scope: scope, status: status, text: text, lang: lang, texts: texts, author: author, at: TODAY });
        if (author && !db.settings.author) db.settings.author = author;
      });
      toast(tx('Comment saved'));
      return;
    }
    if (f.id === 'setForm') {
      e.preventDefault();
      var err = $('setErr'), name = $('sName').value.trim(), pct = pnum($('sPct').value), mAbs = E.parseInput($('sMonth').value), yAbs = E.parseInput($('sYtd').value), grace = Math.round(+$('sGrace').value), aAbs = E.parseInput($('sAlways').value);
      var closed = $('sClosed').value, basis = (document.querySelector('input[name=sBasis]:checked') || {}).value || 'forecast', bad = '';
      if (!name) bad = tx('Enter a company name.');
      else if (!(pct > 0 && pct <= 1000)) bad = tx('The percentage threshold must be above 0.');
      else if (isNaN(mAbs) || mAbs < 0 || isNaN(yAbs) || yAbs < 0 || isNaN(aAbs) || aAbs < 0) bad = tx('The amount thresholds must be zero or more.');
      else if (!(grace >= 0 && grace <= 60)) bad = tx('Days after month end: 0 to 60.');
      if (bad) { err.hidden = false; err.textContent = bad; return; }
      commit('Settings updated', function () {
        db.company.name = name; db.company.what = $('sWhat').value.trim(); db.company.city = $('sCity').value.trim();
        var s = db.settings; s.pct = pct; s.monthAbs = Math.round(mAbs / 100); s.ytdAbs = Math.round(yAbs / 100); s.alwaysAbs = Math.round(aAbs / 100); s.grace = grace;
        s.closed = closed === 'auto' ? 'auto' : +closed; s.basis = basis; s.author = $('sAuthor').value.trim();
      });
      toast(tx('Saved'));
      return;
    }
    if (f.id === 'hcForm') {
      e.preventDefault();
      var rSI = pnum($('hcSI').value), rHR = pnum($('hcHR').value), hol = E.parseInput($('hcHol').value), oth = E.parseInput($('hcOther').value), hm = +$('hcHolM').value, he = $('hcErr');
      var bad2 = !(rSI >= 0 && rSI <= 100 && rHR >= 0 && rHR <= 100) ? tx('Contribution rates are percentages from 0 to 100.') : isNaN(hol) || hol < 0 || isNaN(oth) || oth < 0 ? tx('Amounts must be zero or more.') : '';
      if (bad2) { he.hidden = false; he.textContent = bad2; return; }
      commit('Headcount plan assumptions updated', function () { var hc = db.headcount; hc.rates = { SI: rSI, HR: rHR }; hc.holiday = hol; hc.holidayMonth = hm >= 1 && hm <= 12 ? hm : 6; hc.other = oth; });
      toast(tx('Saved'));
      return;
    }
    if (f.id === 'accAdd') {
      e.preventDefault();
      var code = $('aaCode').value.trim(), nm = $('aaName').value.trim(), ln = $('aaLine').value;
      if (!code || /[\s;,]/.test(code)) return toast(tx('Type an account code without spaces.'));
      if (db.accounts.some(function (a) { return a.code === code; })) return toast(tx('Account {code} already exists.', { code: code }));
      if (!E.LINE[ln]) return toast(tx('Choose a P&L line.'));
      commit('Added account ' + code, function () { db.accounts.push({ code: code, name: nm || tx('Account {code}', { code: code }), line: ln, kind: E.LINE[ln].type }); });
      toast(tx('Account {code} added', { code: code }));
    }
  });
  /** One field of a headcount row changed: check it, save it, and keep the focus where it was. */
  function hcField(t) {
    var r = db.headcount.rows.filter(function (x) { return x.id === t.getAttribute('data-v'); })[0], f = t.getAttribute('data-hc'), val;
    if (!r) return;
    if (f === 'role') val = t.value.trim();
    else if (f === 'country') val = t.value === 'HR' ? 'HR' : 'SI';
    else if (f === 'fte') { val = pnum(t.value); if (!(val >= 0 && val <= 999)) { t.setAttribute('aria-invalid', 'true'); return toast(tx('FTE is a number like 1, 0,5 or 12.')); } }
    else if (f === 'gross' || f === 'allow') { val = E.parseInput(t.value); if (isNaN(val) || val < 0) { t.setAttribute('aria-invalid', 'true'); return toast(tx('Type an amount in euros, for example 2.150 or 2150,50.')); } }
    else if (f === 'from' || f === 'to') { val = t.value; if (val && !/^\d{4}-\d{2}$/.test(val)) return; }
    else return;
    t.removeAttribute('aria-invalid');
    if (f === 'to' && val && r.from && val < r.from) { t.value = r.to; return toast(tx('“Until” cannot be before “From”.')); }
    if (f === 'from' && val && r.to && r.to < val) { t.value = r.from; return toast(tx('“From” cannot be after “Until”.')); }
    if (r[f] === val) return;
    // render after the focus has moved on (Tab), so it stays on the next field
    commit(f === 'role' ? '' : 'Headcount plan: ' + (r.role || 'a row') + ' changed', function () { r[f] = val; }, { noRender: true });
    setTimeout(render, 0);
  }
  var qT = null;
  document.addEventListener('input', function (e) {
    var t = e.target;
    if ($('toolPrev') && t.closest && t.closest('#mdForm')) { toolPreview(); return; }
    if (t.id === 'accQ') {
      clearTimeout(qT);
      qT = setTimeout(function () { uSt.q = t.value; saveUi(); render(); var n = $('accQ'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 220);
    }
    if (t.getAttribute && t.getAttribute('data-ch') === 'impname' && imp) { imp.map[t.getAttribute('data-v')].name = t.value; }
    if (t.classList && t.classList.contains('in') && t.getAttribute('aria-invalid') === 'true' && t.tagName === 'TEXTAREA') t.removeAttribute('aria-invalid');
  });
  document.addEventListener('change', function (e) {
    var t = e.target, ch = t.getAttribute && t.getAttribute('data-ch'), v = t.getAttribute && t.getAttribute('data-v');
    if (t.id === 'csvPick' && t.files && t.files[0]) { readFile(t.files[0]); return; }
    if (t.id === 'uiLang') { setLang(t.value); return; }
    if (t.hasAttribute && t.hasAttribute('data-pm')) { phoneCommit(t); return; }
    if (t.hasAttribute && t.hasAttribute('data-hc')) { hcField(t); return; }
    if (!ch) return;
    if (ch === 'plmonth') { uPl.month = +t.value; saveUi(); render(); }
    else if (ch === 'plq') { uPl.q = +t.value; saveUi(); render(); }
    else if (ch === 'bver') { uBud.vid = t.value; saveUi(); render(); }
    else if (ch === 'phline') { uBud.line = t.value; saveUi(); render(); }
    else if (ch === 'cmline') { uCm.line = t.value; saveUi(); render(); }
    else if (ch === 'hcver') { uHc.vid = t.value; saveUi(); render(); var s5 = $('hcVer'); if (s5) s5.focus(); }
    else if (ch === 'impsign') { imp.sign = t.value; render(); }
    else if (ch === 'impper') { var pp = t.value.split('-'); imp.period = { y: +pp[0], m: +pp[1], cumulative: !!(imp.period && imp.period.cumulative) }; imp.periodFromFile = false; parseImp(); render(); var s3 = $('impPer'); if (s3) s3.focus(); }
    else if (ch === 'impcum') { imp.period = Object.assign({}, imp.period, { cumulative: t.value === '1' }); parseImp(); render(); }
    else if (ch === 'impcol') { var cc = {}; Object.keys(imp.p.cols).forEach(function (k) { cc[k] = imp.p.cols[k]; }); var nv = +t.value; Object.keys(cc).forEach(function (k) { if (cc[k] === nv && k !== v) cc[k] = -1; }); cc[v] = nv; imp.cols = cc; parseImp(); render(); var s4 = $('ic-' + v); if (s4) s4.focus(); }
    else if (ch === 'impmode') { imp.modes[v] = t.value; }
    else if (ch === 'impline') { imp.map[v].line = t.value; imp.map[v].suggested = false; render(); var s2 = $('ul-' + v); if (s2) s2.focus(); }
    else if (ch === 'accfilter') { uSt.line = t.value; saveUi(); render(); }
    else if (ch === 'accname' || ch === 'acckind' || ch === 'accline') {
      var a = db.accounts.filter(function (x) { return x.code === v; })[0]; if (!a) return;
      var val = ch === 'accname' ? t.value.trim() : t.value;
      if (ch === 'accline' && !E.LINE[val]) return;
      commit(ch === 'accline' ? 'Account ' + a.code + ' now feeds ' + E.nameOf(val) : ch === 'acckind' ? 'Account ' + a.code + ' is now ' + (val === 'income' ? 'an income' : 'a cost') + ' account' : '', function () {
        if (ch === 'accname') a.name = val || a.name; else if (ch === 'acckind') a.kind = val; else a.line = val;
      });
      toast(tx('Saved'));
    }
  });
  document.addEventListener('dragover', function (e) { var z = e.target.closest && e.target.closest('#dropZone'); if (z) { e.preventDefault(); z.classList.add('over'); } });
  document.addEventListener('dragleave', function (e) { var z = e.target.closest && e.target.closest('#dropZone'); if (z && !z.contains(e.relatedTarget)) z.classList.remove('over'); });
  document.addEventListener('drop', function (e) {
    var z = e.target.closest && e.target.closest('#dropZone');
    if (!z) return;
    e.preventDefault(); z.classList.remove('over');
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]);
  });
  $('menuBtn').addEventListener('click', function () { var s = $('side'), open = !s.classList.contains('open'); s.classList.toggle('open', open); this.setAttribute('aria-expanded', String(open)); });
  var rT = null;
  window.addEventListener('resize', function () {
    clearTimeout(rT);
    rT = setTimeout(function () {
      Object.keys(CH).forEach(function (id) { var el = $(id); if (el && Math.abs(el.clientWidth - (el._w || 0)) > 4) { el.querySelector('.cv').innerHTML = CH[id].draw(Math.max(260, el.clientWidth)); el._w = el.clientWidth; } });
      fitSheets();
    }, 120);
  });
  window.addEventListener('stratum-theme', function () { if (db) drawCharts(); });
  window.addEventListener('beforeprint', function () { document.querySelectorAll('.sheet').forEach(function (s) { s.style.transform = ''; }); document.querySelectorAll('.sheet-box').forEach(function (b) { b.style.height = ''; }); });
  window.addEventListener('afterprint', fitSheets);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible' || !db) return;
    var t = todayLj();
    if (t !== TODAY) { TODAY = t; if (X.extend(db, TODAY)) save(); invalidate(); render(); }
  });

  // ── boot ─────────────────────────────────────────────────────────────────
  shellText();
  var fresh = false;
  kvGet().then(function (v) {
    // demo data nobody touched, made before the Slovenian chart: start it again (headcount, translated comments)
    if (valid(v) && v.demo && !v.edited && !v.chart) { fresh = true; var g0 = X.generate(TODAY); return kvPut(g0).then(function () { return g0; }); }
    if (valid(v)) return v;
    fresh = true;
    var g = X.generate(TODAY);
    return kvPut(g).then(function () { return g; });
  }).catch(function (err) { failed(err); fresh = true; return X.generate(TODAY); }).then(function (v) {
    db = v; ensureSchema();
    if (X.extend(db, TODAY)) save(); // demo months that closed since the data was made; not a change by the person
    render();
    if (fresh) setTimeout(function () { toast(tx('Demo data generated: {company}, {year}', { company: db.company.name, year: db.year })); }, 300);
    if (window.StratumSync) {
      try {
        sync = StratumSync.attach({
          app: 'budget', label: tx('Budget vs actual'), getSnapshot: function () { return Promise.resolve(db); }, applySnapshot: applyCloud,
          isEmpty: function () { return Promise.resolve(!!(db && db.demo && !db.edited)); }
        });
        if (parseRoute().name === 'settings' && $('syncPanel')) syncPanelOff = sync.mountPanel($('syncPanel'));
      } catch (e) { sync = null; }
    }
  });
})();
