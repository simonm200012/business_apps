/* Adrial Apps · Invoices
 * Stores PDF invoices in this browser (IndexedDB), reads them with pdf.js + parser.js,
 * and shows costs by month, category and vendor. Nothing is uploaded anywhere.
 */
(function () {
  'use strict';

  var P = window.InvoiceParser;
  var R = window.InvoiceRegions;
  var PDFJS = window.pdfjsLib;
  var FM = null; // field mapping + templates UI (fieldmap.js), set in start()
  var FX = null; // payments, QR, duplicates, accountant export (features.js), set in start()
  var MEDIA = window.InvoiceMedia;
  var ZIP = window.InvoiceZip;
  var sync = null; // AdrialSync controller (cloud sync), set in start()
  var applyingSnapshot = false;
  var TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  if (PDFJS) PDFJS.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  var UI_KEY = 'adrial-invoices-ui';
  var MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  // your own companies: which one an invoice is billed to (the buyer), so costs land on the right books
  var DEFAULT_COMPANIES = [
    { id: 'adrial', name: 'ADRIAL, trgovina in storitve, d.o.o.', country: 'SI', variants: ['ADRIAL d.o.o.'], vatId: 'SI36314765', keywords: [] },
    { id: 'vallis-mg', name: 'VALLIS MG, trgovina in storitve, d.o.o.', country: 'SI', variants: ['Vallis MG d.o.o.'], vatId: '', keywords: [] },
    { id: 'mgv-91', name: 'MGV 91, trgovina in storitve, d.o.o.', country: 'SI', variants: ['MGV 91 d.o.o.', 'MGV91'], vatId: '', keywords: [] },
    { id: 'adrialece', name: 'ADRIALECE d.o.o.', country: 'HR', variants: [], vatId: '', keywords: [] }
  ];
  var DEFAULT_SETTINGS = {
    ownNames: ['Adrial'], ownTaxIds: [], categories: P.DEFAULT_CATEGORIES.slice(), companies: DEFAULT_COMPANIES, users: [], migrations: { adrialVat: true },
    remindDays: 3, notify: false, exportPattern: '{date}_{vendor}_{number}', exportSep: ';'
  };
  var UNASSIGNED = '__none';
  var STATUS_LABEL = { review: 'To check', paid: 'Paid', overdue: 'Overdue', unpaid: 'Unpaid', partial: 'Partially paid' };

  var state = {
    invoices: [],
    settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
    rules: {},
    filters: { year: '', month: '', cat: '', status: '', q: '', vendor: '', company: '', person: '' },
    selected: {},
    sort: { key: 'issueDate', dir: -1 },
    queue: [],
    current: null,
    previewDoc: null
  };

  // ---------- DOM helpers ----------

  function $(id) { return document.getElementById(id); }

  function el(tag, props, kids) {
    var n = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (v == null || v === false) return;
        if (k === 'class') n.className = v;
        else if (k === 'text') n.textContent = v;
        else if (k.indexOf('on') === 0) n.addEventListener(k.slice(2), v);
        else n.setAttribute(k, v === true ? '' : v);
      });
    }
    (kids || []).forEach(function (c) {
      if (c == null || c === false) return;
      n.append(c.nodeType ? c : document.createTextNode(String(c)));
    });
    return n;
  }

  var ICONS = {
    alert: '<circle cx="12" cy="12" r="8.5"/><path d="M12 8v4.5M12 16h.01"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
    sortUp: '<path d="m6 15 6-6 6 6"/>',
    sortDown: '<path d="m6 9 6 6 6-6"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>'
  };
  function icon(name) {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('aria-hidden', 'true');
    s.innerHTML = ICONS[name];
    return s;
  }

  // ---------- formatting ----------

  var moneyFmt = {};
  function money(v, cur) {
    if (v == null || isNaN(v)) return '–';
    cur = cur || 'EUR';
    if (!moneyFmt[cur]) {
      try { moneyFmt[cur] = new Intl.NumberFormat('sl-SI', { style: 'currency', currency: cur }); }
      catch (e) { moneyFmt[cur] = { format: function (x) { return x.toFixed(2) + ' ' + cur; } }; }
    }
    return moneyFmt[cur].format(v);
  }
  var intFmt = new Intl.NumberFormat('sl-SI', { maximumFractionDigits: 0 });
  function moneyAxis(v) { return intFmt.format(v) + ' €'; }
  var dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  function dateStr(iso) {
    if (!iso) return '–';
    var d = new Date(iso + 'T00:00:00Z');
    return isNaN(d) ? iso : dateFmt.format(d);
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function todayIso() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function amountText(v) { return v == null || isNaN(v) ? '' : v.toFixed(2).replace('.', ','); }
  function parseAmount(s) {
    s = String(s || '').trim().replace(/[€$£\s]|EUR|USD|GBP|CHF/gi, '');
    if (!s) return null;
    var n = P.toNumber(s);
    return isFinite(n) ? Math.round(n * 100) / 100 : null;
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
  function slug(s) {
    return P.norm(s || '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  }
  function fileExt(inv) { return inv.ext || (MEDIA ? MEDIA.extOf(inv.mime || 'application/pdf', inv.fileName) : 'pdf'); }
  function isImageInv(inv) { return /^image\//.test(inv.mime || ''); }
  function niceName(inv) {
    var parts = [inv.issueDate || 'undated', slug(inv.vendor) || 'invoice'];
    if (inv.number) parts.push(slug(inv.number));
    return parts.join('_') + '.' + fileExt(inv);
  }

  // ---------- derived values ----------

  function isEur(inv) { return !inv.currency || inv.currency === 'EUR'; }
  function eurOf(inv) { return isEur(inv) ? inv.total : inv.eur; }
  function ratio(inv) { return isEur(inv) ? 1 : (inv.eur != null && inv.total ? inv.eur / inv.total : null); }
  function vatEur(inv) { var r = ratio(inv); return inv.vat == null || r == null ? null : inv.vat * r; }
  function netEur(inv) { var r = ratio(inv); return inv.net == null || r == null ? null : inv.net * r; }
  function dateOf(inv) { return inv.issueDate || String(inv.addedAt || '').slice(0, 10); }
  function isOverdue(inv) { return !inv.paid && !!inv.dueDate && inv.dueDate < todayIso(); }
  // payments: [{ id, date, amount, method, note }] in the invoice currency
  function paidAmount(inv) { return Math.round((inv.payments || []).reduce(function (s, p) { return s + (+p.amount || 0); }, 0) * 100) / 100; }
  function remaining(inv) {
    if (inv.paid) return 0;
    if (inv.total == null) return null;
    return Math.max(0, Math.round((inv.total - paidAmount(inv)) * 100) / 100);
  }
  function remainingEur(inv) { var r = ratio(inv); var v = remaining(inv); return v == null || r == null ? null : v * r; }
  function payState(inv) {
    if (inv.paid) return 'paid';
    if (isOverdue(inv)) return 'overdue';
    return paidAmount(inv) > 0 ? 'partial' : 'unpaid';
  }
  function statusOf(inv) {
    if (inv.status === 'review') return 'review';
    return payState(inv);
  }
  function remindDays() { var n = +state.settings.remindDays; return n >= 0 && n <= 60 ? n : 3; }
  function addDays(iso, n) { var d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function isDueSoon(inv) {
    if (inv.paid || !inv.dueDate) return false;
    var t = todayIso();
    return inv.dueDate >= t && inv.dueDate <= addDays(t, remindDays());
  }
  function sum(list, f) { return list.reduce(function (s, x) { var v = f(x); return v == null || isNaN(v) ? s : s + v; }, 0); }

  // ---------- storage (IndexedDB) ----------

  var dbPromise = null;
  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!window.indexedDB) { reject(new Error('IndexedDB unavailable')); return; }
      var req = indexedDB.open('adrial-invoices', 2);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains('invoices')) db.createObjectStore('invoices', { keyPath: 'id' }).createIndex('hash', 'hash');
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'key' });
        // v2: vendor templates (field regions per vendor)
        if (!db.objectStoreNames.contains('templates')) db.createObjectStore('templates', { keyPath: 'id' });
      };
      req.onsuccess = function () {
        var db = req.result;
        // another tab with a newer version of the app: let it upgrade, reload this one later
        db.onversionchange = function () { db.close(); dbPromise = null; };
        resolve(db);
      };
      req.onerror = function () { reject(req.error); };
      req.onblocked = function () { reject(new Error('Storage is blocked by another tab')); };
    });
    return dbPromise;
  }
  function tx(store, mode, fn) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(store, mode);
        var result;
        var r = fn(t.objectStore(store));
        if (r && 'onsuccess' in r) r.onsuccess = function () { result = r.result; };
        t.oncomplete = function () {
          // every saved change of invoices, templates or settings is queued for cloud sync
          if (mode === 'readwrite' && store !== 'files' && !applyingSnapshot && sync) sync.changed();
          resolve(result);
        };
        t.onerror = t.onabort = function () { reject(t.error || new Error('Storage error')); };
      });
    });
  }
  var idb = {
    all: function (s) { return tx(s, 'readonly', function (os) { return os.getAll(); }); },
    get: function (s, k) { return tx(s, 'readonly', function (os) { return os.get(k); }); },
    put: function (s, v) { return tx(s, 'readwrite', function (os) { return os.put(v); }); },
    del: function (s, k) { return tx(s, 'readwrite', function (os) { return os.delete(k); }); },
    clear: function (s) { return tx(s, 'readwrite', function (os) { return os.clear(); }); }
  };
  function saveSettings() { return idb.put('kv', { key: 'settings', value: state.settings }); }
  function saveRules() { return idb.put('kv', { key: 'rules', value: state.rules }); }

  function requestPersist() {
    if (navigator.storage && navigator.storage.persisted) {
      navigator.storage.persisted().then(function (p) { if (!p && navigator.storage.persist) return navigator.storage.persist(); }).then(updateStorageLine).catch(function () {});
    }
  }
  function updateStorageLine() {
    var line = $('storage-line');
    if (!navigator.storage || !navigator.storage.estimate) return;
    Promise.all([navigator.storage.estimate(), navigator.storage.persisted ? navigator.storage.persisted() : Promise.resolve(false)]).then(function (r) {
      var mb = (r[0].usage || 0) / 1048576;
      line.textContent = 'Stored only in this browser · ' + (mb < 0.1 ? '<0.1' : mb.toFixed(1)) + ' MB used' + (r[1] ? ' · protected from automatic clean-up' : '');
      $('s-storage').textContent = line.textContent + '. Invoices never leave this device unless you export them.';
    }).catch(function () {});
  }

  function saveUi() {
    try { localStorage.setItem(UI_KEY, JSON.stringify({ filters: state.filters, sort: state.sort })); } catch (e) { /* ignore */ }
  }
  function loadUi() {
    try {
      var ui = JSON.parse(localStorage.getItem(UI_KEY) || 'null');
      if (ui && ui.filters) Object.assign(state.filters, ui.filters);
      if (ui && ui.sort) state.sort = ui.sort;
      return !!ui;
    } catch (e) { return false; }
  }

  // ---------- external libraries (loaded on demand) ----------

  var scriptCache = {};
  function loadScript(url) {
    if (!scriptCache[url]) {
      scriptCache[url] = new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = url;
        s.onload = resolve;
        s.onerror = function () { delete scriptCache[url]; reject(new Error('Could not load ' + url)); };
        document.head.appendChild(s);
      });
    }
    return scriptCache[url];
  }

  // ---------- toasts & tooltip ----------

  function toast(message, opts) {
    opts = opts || {};
    var box = $('toasts');
    var p = el('p', { text: message });
    var node = el('div', { class: 'toast', role: opts.progress ? 'status' : null }, [opts.progress ? el('span', { class: 'spin', 'aria-hidden': 'true' }) : null, p]);
    if (opts.action) node.append(el('button', { type: 'button', text: opts.action.label, onclick: function () { opts.action.run(); close(); } }));
    box.append(node);
    var timer = null;
    function close() { if (timer) clearTimeout(timer); node.remove(); }
    if (!opts.progress) timer = setTimeout(close, opts.ms || 5200);
    return { update: function (m) { p.textContent = m; }, close: close };
  }

  var tip = null;
  function showTip(target, rows) {
    tip = tip || $('tooltip');
    tip.textContent = '';
    rows.forEach(function (r) { tip.append(el('span', { class: r[0], text: r[1] })); });
    tip.hidden = false;
    var rect = target.getBoundingClientRect();
    var tw = tip.offsetWidth;
    var th = tip.offsetHeight;
    var x = Math.min(Math.max(8, rect.left + rect.width / 2 - tw / 2), window.innerWidth - tw - 8);
    var y = rect.top - th - 10;
    if (y < 8) y = rect.bottom + 10;
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  }
  function hideTip() { if (tip) tip.hidden = true; }

  // ---------- reading PDFs ----------

  async function sha256(buf) {
    if (window.crypto && crypto.subtle) {
      var h = await crypto.subtle.digest('SHA-256', buf);
      return Array.from(new Uint8Array(h)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    }
    return 'size-' + buf.byteLength;
  }

  function pageLines(items) {
    var rows = [];
    items.forEach(function (it) {
      if (!it.str || !it.transform) return;
      // some PDFs (e.g. Stripe invoices) draw spaces as NUL glyphs
      if (/[\u0000-\u001f]/.test(it.str)) it = { str: it.str.replace(/[\u0000-\u001f]/g, ' '), transform: it.transform, width: it.width, height: it.height };
      var x = it.transform[4];
      var y = it.transform[5];
      var h = Math.abs(it.transform[3]) || it.height || 10;
      var row = null;
      for (var i = 0; i < rows.length; i++) { if (Math.abs(rows[i].y - y) <= Math.max(2, h * 0.45)) { row = rows[i]; break; } }
      if (!row) { row = { y: y, h: h, items: [] }; rows.push(row); }
      row.items.push({ x: x, w: it.width || 0, str: it.str });
    });
    rows.sort(function (a, b) { return b.y - a.y; });
    return rows.map(function (r) {
      r.items.sort(function (a, b) { return a.x - b.x; });
      var out = '';
      var lastEnd = null;
      r.items.forEach(function (it) {
        if (lastEnd !== null) {
          var gap = it.x - lastEnd;
          if (gap > r.h * 1.4) out += '   ';
          else if (gap > r.h * 0.12 && !/\s$/.test(out) && !/^\s/.test(it.str)) out += ' ';
        }
        out += it.str;
        lastEnd = it.x + it.w;
      });
      return out.replace(/\s+$/, '');
    }).filter(function (l) { return l.trim() !== ''; });
  }

  async function extractLines(buf) {
    var pdf = await PDFJS.getDocument({ data: new Uint8Array(buf.slice(0)), isEvalSupported: false }).promise;
    var lines = [];
    var items = []; // page-relative text positions per page, for vendor templates
    var pages = Math.min(pdf.numPages, 15);
    for (var p = 1; p <= pages; p++) {
      var page = await pdf.getPage(p);
      var tc = await page.getTextContent();
      lines = lines.concat(pageLines(tc.items));
      items.push(R.itemsFromTextContent(tc.items, page.getViewport({ scale: 1 })));
    }
    var n = pdf.numPages;
    pdf.destroy();
    return { lines: lines, pages: n, items: items };
  }

  // photos: OCR of the whole image gives the text lines and word boxes (same shape as a PDF's text layer)
  async function extractImage(blob, onProgress) {
    var r = await MEDIA.ocr(blob, { loadScript: loadScript, url: TESSERACT_URL, onProgress: onProgress, maxSide: 2400 });
    return { lines: r.lines, pages: 1, items: r.items, ocr: true };
  }

  // the stored file of an invoice; downloaded from the cloud when this browser does not have it yet
  async function fileBlob(inv, onStatus) {
    var rec = await idb.get('files', inv.id);
    if (rec && rec.blob) return rec.blob;
    if (!inv.hash || !sync || !window.AdrialSync || !AdrialSync.user()) throw new Error('the file is not stored in this browser');
    if (onStatus) onStatus('Downloading the file from the cloud…');
    var blob = await sync.fetchFile(inv.hash);
    return blob;
  }

  // a pdf.js document, or a photo wrapped to behave like a one-page document
  async function openDoc(inv, onStatus) {
    var blob = await fileBlob(inv, onStatus);
    if (isImageInv(inv)) {
      if (!MEDIA) throw new Error('photos are not supported here');
      return MEDIA.doc(blob, inv.ocrItems || null);
    }
    if (!PDFJS) throw new Error('pdf.js missing');
    return PDFJS.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false }).promise;
  }

  function companies() { return state.settings.companies || []; }
  function companyById(id) { return companies().find(function (c) { return c.id === id; }) || null; }
  function companyLabel(id) {
    var c = companyById(id);
    if (!c) return 'Unassigned';
    var short = c.name.split(',')[0].replace(/[\s,]+(d\.\s?o\.\s?o\.?|d\.\s?d\.?|s\.\s?p\.?)$/i, '').trim();
    return (short || c.name) + (c.country ? ' (' + c.country + ')' : '');
  }

  function parserOptions() {
    var names = (state.settings.ownNames || []).slice();
    var ids = (state.settings.ownTaxIds || []).slice();
    companies().forEach(function (c) {
      [c.name].concat(c.variants || []).forEach(function (n) { var head = String(n || '').split(',')[0].trim(); if (head.length >= 3) names.push(head); });
      if (c.vatId) ids.push(c.vatId);
    });
    return { ownNames: names, ownTaxIds: ids, rules: state.rules, companies: companies(), users: users() };
  }

  // ---------- billed to person (users) ----------

  function users() { return state.settings.users || (state.settings.users = []); }
  function normEmail(e) { return String(e || '').trim().toLowerCase(); }
  function isEmail(e) { return /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[a-z]{2,}$/i.test(String(e || '').trim()); }
  function userByEmail(email) {
    var e = normEmail(email);
    if (!e) return null;
    return users().find(function (u) { return normEmail(u.email) === e || (u.aliases || []).some(function (a) { return normEmail(a) === e; }); }) || null;
  }
  function personLabel(email) {
    var u = userByEmail(email);
    if (u) return u.name || u.email;
    return email ? (P.nameFromEmail(email) || email) : 'Unassigned';
  }
  // the first time an email shows up it becomes a user, marked "new" so it can be checked in Settings
  function ensureUser(email, name, companyId) {
    var e = normEmail(email);
    if (!isEmail(e)) return null;
    var u = userByEmail(e);
    if (u) return u;
    u = { email: e, name: String(name || '').trim().slice(0, 120) || P.nameFromEmail(e), companyId: companyById(companyId) ? companyId : '', aliases: [], isNew: true };
    users().push(u);
    return u;
  }
  // the person decides the company when company detection is weak or empty
  function crossFillCompany(inv) {
    var u = userByEmail(inv.billedPerson);
    if (!u || !companyById(u.companyId)) return;
    var c = (inv.confidence || {}).billedTo;
    if (!companyById(inv.billedTo) || c === 'low' || c === 'none') {
      inv.billedTo = u.companyId;
      inv.confidence = Object.assign({}, inv.confidence, { billedTo: 'person' });
    }
  }

  // ---------- duplicates ----------

  var DUP_RANK = { file: 4, duplicate: 3, likely: 2, possible: 1 };
  function sameVendor(a, b) {
    var va = String(a.vendorTaxId || '').replace(/[\s.\-]/g, '').toUpperCase();
    var vb = String(b.vendorTaxId || '').replace(/[\s.\-]/g, '').toUpperCase();
    if (va && vb) return va === vb;
    var na = P.norm(a.vendor).replace(/[^a-z0-9]+/g, ' ').trim();
    var nb = P.norm(b.vendor).replace(/[^a-z0-9]+/g, ' ').trim();
    return !!na && na === nb;
  }
  function normNumber(s) { return String(s || '').replace(/[\s\-\/._]/g, '').toUpperCase(); }
  function sameAmount(a, b) { return a.total != null && b.total != null && Math.abs(a.total - b.total) < 0.005; }
  // every other invoice this one may duplicate, strongest first; acknowledged pairs ("Keep both") are left out
  function findDuplicates(inv, list) {
    var out = [];
    (list || state.invoices).forEach(function (o) {
      if (o.id === inv.id) return;
      if ((inv.dupOk || []).indexOf(o.id) !== -1 || (o.dupOk || []).indexOf(inv.id) !== -1) return;
      var level = null;
      var why = '';
      if (inv.hash && o.hash && inv.hash === o.hash && !/^size-/.test(inv.hash)) { level = 'file'; why = 'the same file'; }
      else if (inv.number && o.number && normNumber(inv.number) === normNumber(o.number) && sameVendor(inv, o)) { level = 'duplicate'; why = 'same vendor and invoice number'; }
      else if (sameVendor(inv, o) && sameAmount(inv, o) && inv.issueDate && inv.issueDate === o.issueDate) { level = 'likely'; why = 'same vendor, total and date'; }
      else if (sameAmount(inv, o) && inv.issueDate && inv.issueDate === o.issueDate && inv.billedTo && inv.billedTo === o.billedTo) { level = 'possible'; why = 'same total, date and company'; }
      if (level) out.push({ other: o, level: level, why: why });
    });
    return out.sort(function (a, b) { return DUP_RANK[b.level] - DUP_RANK[a.level]; });
  }
  function possibleDuplicate(inv) {
    var d = findDuplicates(inv).filter(function (x) { return DUP_RANK[x.level] >= 2; })[0];
    return d ? d.other : null;
  }

  function makeInvoice(file, hash, ext, parsed, readError) {
    var mime = MEDIA ? MEDIA.mimeOf(file) : 'application/pdf';
    var inv = {
      id: uid(),
      hash: hash,
      fileName: file.name,
      mime: mime,
      ext: MEDIA ? MEDIA.extOf(mime, file.name) : 'pdf',
      ocrItems: ext.ocr ? ext.items : undefined,
      ocr: !!ext.ocr,
      payments: [],
      size: file.size,
      pages: ext.pages || 0,
      addedAt: new Date().toISOString(),
      vendor: parsed.vendor || '',
      detectedVendor: parsed.vendor || '',
      vendorTaxId: parsed.vendorTaxId || '',
      billedTo: parsed.billedTo || '',
      billedPerson: normEmail(parsed.billedPerson),
      number: parsed.number || '',
      issueDate: parsed.issueDate || null,
      dueDate: parsed.dueDate || null,
      currency: parsed.currency || 'EUR',
      total: parsed.total,
      vat: parsed.vat,
      net: parsed.net,
      eur: null,
      serviceDate: parsed.serviceDate || null,
      vatRate: parsed.vatRate != null ? parsed.vatRate : null,
      iban: parsed.iban || '',
      reference: parsed.reference || '',
      poNumber: parsed.poNumber || '',
      category: parsed.category || 'Other',
      notes: parsed.reverseCharge ? 'Reverse charge: VAT is self-assessed by the buyer.' : '',
      reverseCharge: !!parsed.reverseCharge,
      paid: false,
      paidDate: null,
      status: 'review',
      scanned: !!parsed.scanned,
      readError: !!readError,
      confidence: parsed.confidence || {},
      text: (ext.lines || []).join('\n').slice(0, 40000)
    };
    if (state.settings.categories.indexOf(inv.category) === -1 && inv.category !== 'Other') inv.category = 'Other';
    var dup = possibleDuplicate(inv);
    if (dup) inv.duplicateOf = dup.id;
    return inv;
  }

  async function importFiles(fileList) {
    var all = Array.from(fileList || []);
    var isPdf = function (f) { return f.type === 'application/pdf' || /\.pdf$/i.test(f.name); };
    var files = all.filter(function (f) { return isPdf(f) || (MEDIA && MEDIA.isImage(f)); });
    if (!files.length) { toast(all.length ? 'Only PDF files and photos (JPG, PNG, WebP, HEIC) can be added.' : 'No files selected.'); return; }
    if (!PDFJS && files.some(isPdf)) { toast('The PDF reader did not load. Check your connection and reload the page.'); return; }
    requestPersist();
    var added = [];
    var failed = [];
    var ocrFailed = 0;
    var usedOcr = false;
    var t = toast('Reading ' + plural(files.length, 'file', 'files') + '…', { progress: true });
    var usersChanged = false;
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      var label = 'Reading ' + (i + 1) + ' of ' + files.length + ': ' + f.name;
      t.update(label);
      try {
        var buf = await f.arrayBuffer();
        var hash = await sha256(buf);
        var ext = { lines: [], pages: 0 };
        var readError = false;
        if (isPdf(f)) {
          try { ext = await extractLines(buf); } catch (e) { readError = true; }
        } else {
          usedOcr = true;
          try {
            ext = await extractImage(new Blob([buf], { type: MEDIA.mimeOf(f) }), function (m) {
              var pct = typeof m.progress === 'number' ? ' ' + Math.round(m.progress * 100) + '%' : '';
              t.update(label + ' · ' + (/recogniz/.test(m.status || '') ? 'reading text' : 'loading OCR') + pct);
            });
          } catch (e) {
            console.warn(e);
            ocrFailed++;
            ext = { lines: [], pages: 1 };
            if (/format/.test(e.message || '')) readError = true;
          }
        }
        var parsed = P.parseInvoice(ext.lines, parserOptions());
        // a vendor template overrides the parser for the fields it covers
        var applied = FM ? FM.applyOnImport(parsed, ext) : null;
        var inv = makeInvoice(f, hash, ext, parsed, readError);
        if (applied) {
          inv.templateId = applied.template.id;
          inv.fromTemplate = applied.fields;
          inv.regions = applied.regions;
        }
        if (inv.billedPerson) {
          var before = users().length;
          var hiConf = (inv.confidence || {}).billedTo === 'high' || (inv.confidence || {}).billedTo === 'template';
          ensureUser(inv.billedPerson, parsed.billedPersonName, hiConf ? inv.billedTo : '');
          if (users().length !== before) usersChanged = true;
          crossFillCompany(inv);
        }
        await idb.put('files', { id: inv.id, blob: new Blob([buf], { type: inv.mime }), hash: hash, type: inv.mime });
        await idb.put('invoices', inv);
        if (applied) await FM.noteTemplateUse(applied.template, inv.id);
        state.invoices.push(inv);
        added.push(inv);
      } catch (e) {
        console.error(e);
        failed.push(f.name);
      }
    }
    t.close();
    if (usedOcr && MEDIA) MEDIA.release();
    if (usersChanged) { try { await saveSettings(); } catch (e) { console.error(e); } }
    // duplicates: compare side by side and let the person decide, one by one
    var dupCount = 0;
    if (FX) {
      for (var di = 0; di < added.length; di++) {
        var cand = added[di];
        // against older invoices, and against files added earlier in this same batch (asked once per pair)
        var d = findDuplicates(cand).filter(function (x) {
          var at = added.indexOf(x.other);
          return DUP_RANK[x.level] >= 2 && (at === -1 || at < di);
        })[0];
        if (!d) continue;
        dupCount++;
        var choice = await FX.compareDuplicates(cand, d, 'upload');
        if (choice === 'discard') {
          await removeInvoice(cand);
          added.splice(di, 1);
          di--;
        } else if (choice === 'replace') {
          await removeInvoice(d.other);
          delete cand.duplicateOf;
          await idb.put('invoices', cand);
        } else if (choice === 'keep') {
          cand.dupOk = (cand.dupOk || []).concat([d.other.id]);
          delete cand.duplicateOf;
          await idb.put('invoices', cand);
        }
      }
    }
    // if the year filter would hide everything just added, jump to the year of the new invoices
    if (added.length && state.filters.year && !added.some(function (x) { return dateOf(x).slice(0, 4) === state.filters.year; })) {
      state.filters.year = dateOf(added[0]).slice(0, 4);
      state.filters.month = '';
      saveUi();
    }
    render();
    updateStorageLine();
    var msg = [];
    if (added.length) msg.push(plural(added.length, 'invoice', 'invoices') + ' added');
    if (dupCount) msg.push(plural(dupCount, 'possible duplicate', 'possible duplicates') + ' checked');
    if (ocrFailed) msg.push(plural(ocrFailed, 'photo', 'photos') + ' could not be read with OCR (offline?) — open them to retry or type the details');
    if (failed.length) msg.push(failed.length + ' could not be saved');
    if (msg.length) toast(msg.join(' · ') + '.');
    if (added.length) openDetail(added[0].id, added.map(function (x) { return x.id; }));
  }

  // ---------- filtering ----------

  function companyMatches(inv, filter) {
    var known = !!companyById(inv.billedTo);
    return filter === UNASSIGNED ? !known : known && inv.billedTo === filter;
  }
  function statusMatches(inv, s) {
    if (s === 'review') return inv.status === 'review';
    if (s === 'paid') return !!inv.paid;
    if (s === 'unpaid') return !inv.paid;
    if (s === 'partial') return !inv.paid && paidAmount(inv) > 0;
    if (s === 'overdue') return isOverdue(inv);
    if (s === 'duesoon') return isDueSoon(inv);
    if (s === 'attention') return isDueSoon(inv) || isOverdue(inv);
    if (s === 'dupes') return findDuplicates(inv).length > 0;
    return true;
  }
  // one key per person: the user's main email (aliases fold into it), else the raw email
  function personKey(inv) {
    if (!inv.billedPerson) return UNASSIGNED;
    var u = userByEmail(inv.billedPerson);
    return u ? normEmail(u.email) : normEmail(inv.billedPerson);
  }

  function filtered(opts) {
    opts = opts || {};
    var f = state.filters;
    var q = P.norm(String(f.q || '').trim());
    return state.invoices.filter(function (inv) {
      var d = dateOf(inv);
      if (f.year && d.slice(0, 4) !== f.year) return false;
      if (f.year && f.month && !opts.ignoreMonth && d.slice(5, 7) !== f.month) return false;
      if (f.cat && !opts.ignoreCat && inv.category !== f.cat) return false;
      if (f.vendor && !opts.ignoreVendor && inv.vendor !== f.vendor) return false;
      if (f.company && !opts.ignoreCompany && !companyMatches(inv, f.company)) return false;
      if (f.person && !opts.ignorePerson && personKey(inv) !== f.person) return false;
      if (f.status && !statusMatches(inv, f.status)) return false;
      if (q) {
        var hay = P.norm([inv.vendor, inv.number, inv.category, inv.notes, inv.fileName, inv.vendorTaxId, companyLabel(inv.billedTo), inv.billedPerson, inv.billedPerson ? personLabel(inv.billedPerson) : '', inv.reference, inv.poNumber, inv.text].join(' '));
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  // ---------- rendering ----------

  function render() {
    var has = state.invoices.length > 0;
    $('onboard').hidden = has;
    $('dash').hidden = !has;
    renderReviewBanner();
    if (!has) return;
    renderFilters();
    var list = filtered();
    renderKpis(list);
    renderMonthChart(filtered({ ignoreMonth: true }));
    renderBars($('c-cat'), groupBy(filtered({ ignoreCat: true }), 'category'), state.filters.cat, function (name) {
      state.filters.cat = state.filters.cat === name ? '' : name; saveUi(); render();
    }, 12);
    var vendors = groupBy(filtered({ ignoreVendor: true }), 'vendor');
    $('c-ven-note').textContent = vendors.length ? plural(vendors.length, 'vendor', 'vendors') : '';
    renderBars($('c-ven'), vendors, state.filters.vendor, function (name) {
      state.filters.vendor = state.filters.vendor === name ? '' : name; saveUi(); render();
    }, 8);
    var byCo = groupByCompany(filtered({ ignoreCompany: true }));
    var activeCo = state.filters.company ? (state.filters.company === UNASSIGNED ? 'Unassigned' : companyLabel(state.filters.company)) : '';
    renderBars($('c-co'), byCo, activeCo, function (name) {
      var g = byCo.find(function (x) { return x.name === name; });
      var id = g ? g.id : '';
      state.filters.company = state.filters.company === id ? '' : id; saveUi(); render();
    }, 12);
    var byPerson = groupByPerson(filtered({ ignorePerson: true }));
    var activeP = state.filters.person ? (byPerson.find(function (g) { return g.id === state.filters.person; }) || {}).name : '';
    renderBars($('c-person'), byPerson, activeP, function (name) {
      var g = byPerson.find(function (x) { return x.name === name; });
      var id = g ? g.id : '';
      state.filters.person = state.filters.person === id ? '' : id; saveUi(); render();
    }, 10);
    renderTable(list);
    var dl = $('vendor-list');
    dl.textContent = '';
    Array.from(new Set(state.invoices.map(function (x) { return x.vendor; }).filter(Boolean))).sort().forEach(function (v) { dl.append(el('option', { value: v })); });
  }

  function renderReviewBanner() {
    var n = state.invoices.filter(function (x) { return x.status === 'review'; }).length;
    $('review-banner').hidden = n === 0;
    $('review-text').textContent = n === 1 ? '1 invoice is waiting to be checked.' : n + ' invoices are waiting to be checked.';
    // reminders: due within N days (and overdue) — an in-app list with a badge
    var soon = state.invoices.filter(isDueSoon);
    var late = state.invoices.filter(isOverdue);
    var badge = $('due-badge');
    badge.hidden = !soon.length && !late.length;
    badge.textContent = soon.length + late.length;
    badge.setAttribute('aria-label', plural(soon.length, 'invoice', 'invoices') + ' due soon, ' + late.length + ' overdue');
    $('due-banner').hidden = !soon.length && !late.length;
    $('due-text').textContent = (soon.length ? plural(soon.length, 'invoice is', 'invoices are') + ' due within ' + plural(remindDays(), 'day', 'days') + ' · ' + money(sum(soon, remainingEur)) : 'Nothing is due in the next ' + plural(remindDays(), 'day', 'days')) +
      (late.length ? ' · ' + plural(late.length, 'invoice is', 'invoices are') + ' overdue · ' + money(sum(late, remainingEur)) : '') + '.';
    if (FX) FX.maybeNotify(soon, late);
  }

  function setOptions(select, options, value) {
    select.textContent = '';
    options.forEach(function (o) { select.append(el('option', { value: o[0], text: o[1] })); });
    select.value = value;
    if (select.value !== value) select.value = options.length ? options[0][0] : '';
  }

  function renderFilters() {
    var f = state.filters;
    var years = Array.from(new Set(state.invoices.map(function (x) { return dateOf(x).slice(0, 4); }).concat([String(new Date().getFullYear())]))).sort().reverse();
    setOptions($('f-year'), [['', 'All years']].concat(years.map(function (y) { return [y, y]; })), f.year);
    setOptions($('f-month'), [['', 'All months']].concat(MONTH_LONG.map(function (m, i) { return [pad(i + 1), m]; })), f.month);
    $('f-month').disabled = !f.year;
    var cats = state.settings.categories.slice();
    state.invoices.forEach(function (x) { if (x.category && cats.indexOf(x.category) === -1) cats.push(x.category); });
    setOptions($('f-cat'), [['', 'All']].concat(cats.map(function (c) { return [c, c]; })), f.cat);
    setOptions($('f-company'), [['', 'All companies']].concat(companies().map(function (c) { return [c.id, companyLabel(c.id)]; })).concat([[UNASSIGNED, 'Unassigned']]), f.company || '');
    setOptions($('f-person'), [['', 'All people']].concat(personOptions()).concat([[UNASSIGNED, 'Unassigned']]), f.person || '');
    $('f-status').value = f.status;
    if ($('f-q').value !== f.q) $('f-q').value = f.q;
    $('f-vendor-chip').hidden = !f.vendor;
    $('f-vendor-name').textContent = f.vendor;
  }

  function periodLabel() {
    var f = state.filters;
    if (f.year && f.month) return MONTH_LONG[+f.month - 1] + ' ' + f.year;
    if (f.year) return f.year;
    return 'all years';
  }

  function renderKpis(list) {
    var f = state.filters;
    var spent = sum(list, eurOf);
    var missingEur = list.filter(function (x) { return eurOf(x) == null; }).length;
    $('k-spent-label').textContent = f.year ? 'Spent in ' + periodLabel() : 'Spent · all years';
    $('k-spent').textContent = money(spent);
    var sub = $('k-spent-sub');
    sub.textContent = '';
    sub.className = 'sub';
    if (missingEur) {
      sub.append(icon('alert'), ' ' + plural(missingEur, 'invoice', 'invoices') + ' without an amount in EUR');
    } else if (f.year && !f.month) {
      // compare with the same stretch of the previous year
      var prevYear = String(+f.year - 1);
      var cutoff = f.year === String(new Date().getFullYear()) ? todayIso().slice(5) : '12-31';
      var prevList = state.invoices.filter(function (inv) {
        var d = dateOf(inv);
        if (d.slice(0, 4) !== prevYear || d.slice(5) > cutoff) return false;
        return matchesNonDate(inv);
      });
      var prev = sum(prevList, eurOf);
      if (prev > 0) {
        var pct = Math.round(((spent - prev) / prev) * 100);
        sub.append(icon(pct >= 0 ? 'up' : 'down'), ' ' + Math.abs(pct) + '% vs ' + prevYear + (cutoff === '12-31' ? '' : ' to date'));
      } else {
        sub.textContent = plural(list.length, 'invoice', 'invoices');
      }
    } else {
      sub.textContent = plural(list.length, 'invoice', 'invoices');
    }

    if (f.year && f.month) {
      $('k-avg-label').textContent = 'Average invoice';
      $('k-avg').textContent = list.length ? money(spent / list.length) : '–';
      $('k-avg-sub').textContent = plural(list.length, 'invoice', 'invoices');
    } else {
      var months;
      if (f.year) months = f.year === String(new Date().getFullYear()) ? new Date().getMonth() + 1 : 12;
      else {
        var ds = list.map(dateOf).filter(Boolean).sort();
        if (ds.length) {
          var a = ds[0];
          var b = ds[ds.length - 1];
          months = (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7)) + 1;
        } else months = 1;
      }
      $('k-avg-label').textContent = 'Monthly average';
      $('k-avg').textContent = money(spent / Math.max(1, months));
      $('k-avg-sub').textContent = 'over ' + plural(months, 'month', 'months');
    }

    $('k-vat').textContent = money(sum(list, vatEur));
    $('k-vat-sub').textContent = 'Net ' + money(sum(list, netEur));

    var unpaid = list.filter(function (x) { return !x.paid; });
    var overdue = unpaid.filter(isOverdue);
    $('k-unpaid').textContent = money(sum(unpaid, remainingEur));
    var us = $('k-unpaid-sub');
    us.textContent = '';
    if (!unpaid.length) us.textContent = 'All paid';
    else {
      us.append(plural(unpaid.length, 'invoice', 'invoices'));
      if (overdue.length) us.append(' · ', el('span', { class: 'bad' }, [icon('clock'), ' ' + overdue.length + ' overdue · ' + money(sum(overdue, remainingEur))]));
    }
    if (FX) FX.renderPayments(list);
  }

  // every filter except the period (used for year-over-year comparison)
  function matchesNonDate(inv) {
    var f = state.filters;
    if (f.cat && inv.category !== f.cat) return false;
    if (f.vendor && inv.vendor !== f.vendor) return false;
    if (f.company && !companyMatches(inv, f.company)) return false;
    if (f.status && !statusMatches(inv, f.status)) return false;
    var q = P.norm(String(f.q || '').trim());
    if (q && P.norm([inv.vendor, inv.number, inv.category, inv.notes, inv.fileName, inv.vendorTaxId, companyLabel(inv.billedTo), inv.reference, inv.poNumber, inv.text].join(' ')).indexOf(q) === -1) return false;
    return true;
  }

  function niceScale(max) {
    if (!(max > 0)) return { top: 100, step: 25 };
    var raw = max / 4;
    var mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var n = raw / mag;
    var step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
    return { top: Math.ceil(max / step) * step, step: step };
  }

  function renderMonthChart(list) {
    var f = state.filters;
    var box = $('c-month');
    var labels = $('c-month-labels');
    box.textContent = '';
    labels.textContent = '';
    var months = [];
    if (f.year) {
      for (var m = 1; m <= 12; m++) months.push({ key: f.year + '-' + pad(m), y: f.year, m: m });
    } else {
      var now = new Date();
      for (var i = 11; i >= 0; i--) {
        var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push({ key: d.getFullYear() + '-' + pad(d.getMonth() + 1), y: String(d.getFullYear()), m: d.getMonth() + 1 });
      }
    }
    var byKey = {};
    months.forEach(function (mo) { mo.total = 0; mo.vat = 0; mo.count = 0; byKey[mo.key] = mo; });
    list.forEach(function (inv) {
      var mo = byKey[dateOf(inv).slice(0, 7)];
      if (!mo) return;
      var v = eurOf(inv);
      if (v != null) mo.total += v;
      mo.vat += vatEur(inv) || 0;
      mo.count++;
    });
    $('c-month-note').textContent = (f.year ? f.year : 'Last 12 months') + ' · incl. VAT, in EUR · select a month to filter';
    var max = Math.max.apply(null, months.map(function (x) { return x.total; }));
    var scale = niceScale(max);
    for (var v = 0; v <= scale.top + 1e-9; v += scale.step) {
      var pct = (v / scale.top) * 100;
      box.append(el('div', { class: 'gridline' + (v === 0 ? ' base' : ''), style: 'top:' + (100 - pct) + '%' }));
      box.append(el('span', { class: 'tick num', style: 'top:' + (100 - pct) + '%', text: moneyAxis(v) }));
    }
    var row = el('div', { class: 'cols-row' });
    var maxKey = max > 0 ? months.filter(function (x) { return x.total === max; })[0].key : null;
    months.forEach(function (mo) {
      var selected = f.year && f.month === pad(mo.m) && f.year === mo.y;
      var heightPct = scale.top ? (mo.total / scale.top) * 100 : 0;
      var bar = el('span', { class: 'bar', style: 'height:' + heightPct + '%' });
      var label = MONTH_LONG[mo.m - 1] + ' ' + mo.y + ': ' + money(mo.total) + ', ' + plural(mo.count, 'invoice', 'invoices');
      var col = el('button', {
        type: 'button',
        class: 'col' + (f.month && !selected ? ' dim' : ''),
        'aria-label': label,
        'aria-pressed': selected ? 'true' : 'false',
        onclick: function () {
          if (selected) state.filters.month = '';
          else { state.filters.year = mo.y; state.filters.month = pad(mo.m); }
          saveUi(); render();
        },
        onpointerenter: function () { showTip(bar.offsetHeight ? bar : col, [['tv', money(mo.total)], ['tl', MONTH_LONG[mo.m - 1] + ' ' + mo.y], ['tm', plural(mo.count, 'invoice', 'invoices') + ' · VAT ' + money(mo.vat)]]); },
        onpointerleave: hideTip,
        onfocus: function () { showTip(bar.offsetHeight ? bar : col, [['tv', money(mo.total)], ['tl', MONTH_LONG[mo.m - 1] + ' ' + mo.y], ['tm', plural(mo.count, 'invoice', 'invoices') + ' · VAT ' + money(mo.vat)]]); },
        onblur: hideTip
      }, [bar]);
      if (mo.total > 0 && (mo.key === maxKey || selected)) {
        col.append(el('span', { class: 'cap num', style: 'bottom:' + heightPct + '%', text: moneyAxis(Math.round(mo.total)) }));
      }
      row.append(col);
      labels.append(el('span', { class: selected ? 'on' : '', text: MONTH_SHORT[mo.m - 1] + (!f.year && mo.m === 1 ? ' ’' + mo.y.slice(2) : '') }));
    });
    box.append(row);
  }

  function groupBy(list, field) {
    var map = {};
    list.forEach(function (inv) {
      var k = inv[field] || (field === 'vendor' ? 'Unknown vendor' : 'Other');
      if (!map[k]) map[k] = { name: k, total: 0, count: 0 };
      var v = eurOf(inv);
      if (v != null) map[k].total += v;
      map[k].count++;
    });
    return Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) { return b.total - a.total; });
  }

  function groupByCompany(list) {
    var map = {};
    list.forEach(function (inv) {
      var id = companyById(inv.billedTo) ? inv.billedTo : UNASSIGNED;
      if (!map[id]) map[id] = { id: id, name: id === UNASSIGNED ? 'Unassigned' : companyLabel(id), total: 0, count: 0 };
      var v = eurOf(inv);
      if (v != null) map[id].total += v;
      map[id].count++;
    });
    return Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) { return b.total - a.total; });
  }

  function groupByPerson(list) {
    var map = {};
    list.forEach(function (inv) {
      var id = personKey(inv);
      if (!map[id]) map[id] = { id: id, name: id === UNASSIGNED ? 'Unassigned' : personLabel(id), total: 0, count: 0 };
      var v = eurOf(inv);
      if (v != null) map[id].total += v;
      map[id].count++;
    });
    var groups = Object.keys(map).map(function (k) { return map[k]; });
    // two people can share a display name: add the email so the bars stay distinct
    groups.forEach(function (g) { if (g.id !== UNASSIGNED && groups.some(function (o) { return o !== g && o.name === g.name; })) g.name += ' · ' + g.id; });
    return groups.sort(function (a, b) { return b.total - a.total; });
  }

  // known users plus emails that only appear on invoices
  function personOptions() {
    var seen = {};
    var out = [];
    users().forEach(function (u) { var e = normEmail(u.email); if (!seen[e]) { seen[e] = 1; out.push([e, (u.name || e) + ' · ' + e]); } });
    state.invoices.forEach(function (inv) { var k = personKey(inv); if (k !== UNASSIGNED && !seen[k]) { seen[k] = 1; out.push([k, personLabel(k) + ' · ' + k]); } });
    return out.sort(function (a, b) { return a[1].localeCompare(b[1], 'sl'); });
  }

  function renderBars(listEl, groups, active, onPick, limit) {
    listEl.textContent = '';
    if (!groups.length) { listEl.append(el('li', {}, [el('p', { class: 'empty-note', text: 'Nothing here yet for these filters.' })])); return; }
    var total = groups.reduce(function (s, g) { return s + g.total; }, 0) || 1;
    var max = groups[0].total || 1;
    groups.slice(0, limit).forEach(function (g) {
      var on = active === g.name;
      var share = Math.round((g.total / total) * 100);
      listEl.append(el('li', {}, [el('button', {
        type: 'button',
        class: 'hbar' + (on ? ' on' : ''),
        'aria-pressed': on ? 'true' : 'false',
        'aria-label': g.name + ': ' + money(g.total) + ', ' + share + '% of the total, ' + plural(g.count, 'invoice', 'invoices'),
        onclick: function () { onPick(g.name); }
      }, [
        el('span', { class: 'name', text: g.name }),
        el('span', { class: 'track' }, [el('span', { class: 'fill', style: 'display:block;width:' + Math.max(1.5, (g.total / max) * 100) + '%' })]),
        el('span', { class: 'val num' }, [money(g.total), el('small', { text: share + '% · ' + plural(g.count, 'invoice', 'invoices') })])
      ])]));
    });
    if (groups.length > limit) {
      var rest = groups.slice(limit);
      listEl.append(el('li', {}, [el('p', { class: 'muted', style: 'margin:6px 8px 0;font-size:13px', text: '+ ' + plural(rest.length, 'more', 'more') + ' · ' + money(rest.reduce(function (s, g) { return s + g.total; }, 0)) })]));
    }
  }

  function renderTable(list) {
    var s = state.sort;
    var sorted = list.slice().sort(function (a, b) {
      var key = function (x) {
        if (s.key === 'eur') return eurOf(x);
        if (s.key === 'issueDate') return dateOf(x);
        if (s.key === 'billedTo') return companyById(x.billedTo) ? companyLabel(x.billedTo) : '';
        if (s.key === 'billedPerson') return x.billedPerson ? personLabel(x.billedPerson) : '';
        return x[s.key];
      };
      var va = key(a);
      var vb = key(b);
      if (va == null || va === '') return 1;
      if (vb == null || vb === '') return -1;
      if (typeof va === 'string') return va.localeCompare(vb, 'sl') * s.dir;
      return (va - vb) * s.dir;
    });
    var body = $('t-body');
    body.textContent = '';
    sorted.forEach(function (inv) {
      var st = statusOf(inv);
      var pill = el('span', { class: 'pill' + (st === 'paid' ? ' ok' : st === 'review' ? ' warn' : st === 'overdue' ? ' bad' : st === 'partial' ? ' part' : '') }, [
        st === 'paid' ? icon('check') : st === 'overdue' ? icon('clock') : st === 'review' ? icon('eye') : null, STATUS_LABEL[st]
      ]);
      var statusCell = el('td', {}, [pill]);
      if (st !== 'paid' && st !== 'partial' && paidAmount(inv) > 0) statusCell.append(el('span', { class: 'foreign', text: 'part paid' }));
      if (isDueSoon(inv)) statusCell.append(el('span', { class: 'foreign due-soon', text: 'due soon' }));
      if (findDuplicates(inv).some(function (d) { return DUP_RANK[d.level] >= 2; })) statusCell.append(el('span', { class: 'foreign dup', text: 'possible duplicate' }));
      var totalCell = el('td', { class: 'r num' });
      if (isEur(inv)) totalCell.append(el('strong', { style: 'font-weight:500', text: money(inv.total) }));
      else {
        totalCell.append(el('strong', { style: 'font-weight:500', text: inv.eur != null ? money(inv.eur) : '–' }));
        totalCell.append(el('span', { class: 'foreign', text: money(inv.total, inv.currency) + (inv.eur == null ? ' · needs EUR' : '') }));
      }
      var label = (inv.vendor || inv.fileName) + (inv.number ? ' ' + inv.number : '');
      var co = companyById(inv.billedTo);
      var coCell = el('td', { class: co ? '' : 'muted' }, [co ? companyLabel(inv.billedTo) : 'Unassigned']);
      if (co && inv.status === 'review' && inv.confidence && (inv.confidence.billedTo === 'low' || inv.confidence.billedTo === 'medium')) coCell.append(el('span', { class: 'foreign', text: 'detected · check' }));
      var pc = inv.billedPerson ? el('td', {}, [personLabel(inv.billedPerson), el('span', { class: 'foreign', text: inv.billedPerson })]) : el('td', { class: 'muted', text: 'Unassigned' });
      var tr = el('tr', { 'data-id': inv.id, class: state.selected[inv.id] ? 'sel' : null }, [
        el('td', { class: 'pick' }, [el('input', { type: 'checkbox', 'data-pick': inv.id, 'aria-label': 'Select ' + label, checked: state.selected[inv.id] ? true : null })]),
        el('td', { class: 'date num', text: dateStr(inv.issueDate) }),
        el('td', {}, [el('button', { type: 'button', class: 'vendor-btn', 'data-open': inv.id }, [
          el('span', { class: 'v', text: inv.vendor || inv.fileName }),
          el('span', { class: 'n', text: inv.number || (inv.vendor ? inv.fileName : '') })
        ])]),
        coCell,
        pc,
        el('td', { class: 'muted', text: inv.category }),
        el('td', { class: 'r num muted', text: isEur(inv) ? money(inv.net) : money(inv.net, inv.currency) }),
        el('td', { class: 'r num muted', text: isEur(inv) ? money(inv.vat) : money(inv.vat, inv.currency) }),
        totalCell,
        el('td', { class: 'date num', text: inv.paid ? (inv.paidDate ? 'Paid ' + dateStr(inv.paidDate) : 'Paid') : dateStr(inv.dueDate) }),
        statusCell
      ]);
      body.append(tr);
    });
    $('t-empty').hidden = sorted.length > 0;
    $('t-note').textContent = plural(sorted.length, 'invoice', 'invoices') + ' · ' + money(sum(sorted, eurOf));
    state.shownIds = sorted.map(function (x) { return x.id; });
    renderBulk();
    document.querySelectorAll('thead th[data-sort]').forEach(function (th) {
      var btn = th.querySelector('button');
      var old = btn.querySelector('svg');
      if (old) old.remove();
      if (th.dataset.sort === s.key) {
        th.setAttribute('aria-sort', s.dir > 0 ? 'ascending' : 'descending');
        btn.append(icon(s.dir > 0 ? 'sortUp' : 'sortDown'));
      } else th.removeAttribute('aria-sort');
    });
  }

  // ---------- bulk: set "billed to" on several invoices ----------

  function selectedIds() {
    return Object.keys(state.selected).filter(function (id) { return state.selected[id] && state.invoices.some(function (x) { return x.id === id; }); });
  }

  function renderBulk() {
    var ids = selectedIds();
    var shown = state.shownIds || [];
    var all = $('t-pick-all');
    var shownSel = shown.filter(function (id) { return state.selected[id]; }).length;
    all.checked = shown.length > 0 && shownSel === shown.length;
    all.indeterminate = shownSel > 0 && shownSel < shown.length;
    $('bulk').hidden = ids.length === 0;
    $('bulk-count').textContent = plural(ids.length, 'invoice', 'invoices') + ' selected';
    var sel = $('bulk-company');
    var keep = sel.value;
    setOptions(sel, companies().map(function (c) { return [c.id, companyLabel(c.id)]; }).concat([[UNASSIGNED, 'Unassigned']]), keep || (companies()[0] ? companies()[0].id : UNASSIGNED));
    var ps = $('bulk-person');
    var keepP = ps.value;
    var popts = personOptions().concat([[UNASSIGNED, 'Unassigned']]);
    setOptions(ps, popts, keepP || popts[0][0]);
  }

  // record the open amount of each selected invoice as paid today
  async function applyBulkPaid() {
    var ids = selectedIds();
    var list = ids.map(function (id) { return state.invoices.find(function (x) { return x.id === id; }); }).filter(function (x) { return x && !x.paid; });
    if (!list.length) { toast('The selected invoices are already paid.'); return; }
    var day = todayIso();
    try {
      for (var i = 0; i < list.length; i++) {
        var inv = list[i];
        var rest = remaining(inv);
        inv.payments = (inv.payments || []).slice();
        if (rest > 0) inv.payments.push({ id: uid(), date: day, amount: rest, method: '', note: 'Marked paid in bulk' });
        inv.paid = true;
        inv.paidDate = day;
        inv.updatedAt = new Date().toISOString();
        await idb.put('invoices', inv);
      }
    } catch (e) { toast('Could not save: ' + e.message); return; }
    state.selected = {};
    render();
    toast(plural(list.length, 'invoice', 'invoices') + ' marked paid.');
  }

  async function applyBulkPerson() {
    var ids = selectedIds();
    var to = $('bulk-person').value;
    if (!ids.length) return;
    var value = to === UNASSIGNED ? '' : normEmail(to);
    try {
      for (var i = 0; i < ids.length; i++) {
        var inv = state.invoices.find(function (x) { return x.id === ids[i]; });
        if (!inv) continue;
        inv.billedPerson = value;
        inv.confidence = Object.assign({}, inv.confidence, { billedPerson: 'manual' });
        if (value) crossFillCompany(inv);
        inv.updatedAt = new Date().toISOString();
        await idb.put('invoices', inv);
      }
    } catch (e) { toast('Could not save: ' + e.message); return; }
    state.selected = {};
    render();
    toast(plural(ids.length, 'invoice', 'invoices') + ' set to ' + (value ? personLabel(value) : 'Unassigned') + '.');
  }

  async function applyBulkCompany() {
    var ids = selectedIds();
    var to = $('bulk-company').value;
    if (!ids.length) return;
    var value = to === UNASSIGNED ? '' : to;
    try {
      for (var i = 0; i < ids.length; i++) {
        var inv = state.invoices.find(function (x) { return x.id === ids[i]; });
        if (!inv) continue;
        inv.billedTo = value;
        inv.confidence = Object.assign({}, inv.confidence, { billedTo: 'manual' });
        inv.updatedAt = new Date().toISOString();
        await idb.put('invoices', inv);
      }
    } catch (e) { toast('Could not save: ' + e.message); return; }
    state.selected = {};
    render();
    toast(plural(ids.length, 'invoice', 'invoices') + ' set to ' + (value ? companyLabel(value) : 'Unassigned') + '.');
  }

  // fill in "billed to" (company and person) for invoices that have none yet, from the text already read
  async function detectUnassigned() {
    var list = state.invoices.filter(function (x) { return (!companyById(x.billedTo) || !x.billedPerson) && x.text; });
    var n = 0;
    var p = 0;
    var before = users().length;
    for (var i = 0; i < list.length; i++) {
      var inv = list[i];
      var lines = inv.text.split('\n');
      var changed = false;
      if (!companyById(inv.billedTo)) {
        var r = P.findBilledTo(lines, companies());
        if (r.id) { inv.billedTo = r.id; inv.confidence = Object.assign({}, inv.confidence, { billedTo: r.conf }); n++; changed = true; }
      }
      if (!inv.billedPerson) {
        var who = P.findBilledPerson(lines, { users: users(), vendor: inv.vendor });
        if (who.email) {
          inv.billedPerson = who.email;
          inv.confidence = Object.assign({}, inv.confidence, { billedPerson: who.conf });
          ensureUser(who.email, who.name, inv.confidence.billedTo === 'high' ? inv.billedTo : '');
          crossFillCompany(inv);
          p++;
          changed = true;
        }
      }
      if (changed) await idb.put('invoices', inv);
    }
    if (users().length !== before) await saveSettings();
    render();
    return { companies: n, people: p };
  }

  // ---------- detail / review dialog ----------

  var openToken = 0;

  function fillCategorySelect(select, value) {
    var cats = state.settings.categories.slice();
    if (value && cats.indexOf(value) === -1) cats.push(value);
    if (cats.indexOf('Other') === -1) cats.push('Other');
    setOptions(select, cats.map(function (c) { return [c, c]; }), value || 'Other');
  }

  var COMPANY_CONF = {
    high: 'Detected in the buyer block of the PDF.',
    medium: 'Detected on the PDF, but not next to a buyer label — check it.',
    low: 'Several of your companies appear on the PDF — check it.',
    manual: 'Set by you.',
    template: 'From the vendor template.',
    person: 'Taken from the person it is billed to.'
  };
  var PERSON_CONF = {
    high: 'Email found in the buyer block of the PDF.',
    medium: 'Found on the PDF, but not clearly in the buyer block — check it.',
    low: 'Only a guess — check it.',
    manual: 'Set by you.',
    template: 'From the vendor template.'
  };
  function companyHint(inv) {
    var c = (inv.confidence || {}).billedTo;
    var known = !!companyById(inv.billedTo);
    $('d-company-hint').textContent = known ? (COMPANY_CONF[c] || 'Set earlier.') : 'None of your companies was found on the PDF. Pick one, or add the company in Settings.';
    personHint(inv);
  }
  // shows who the person is, how they were found, and a mismatch with the company
  function personHint(inv) {
    var email = normEmail($('d-person').value);
    var hint = $('d-person-hint');
    hint.textContent = '';
    if (!email) { hint.textContent = 'No email of a person was found in the buyer block. Pick or type one.'; return; }
    if (!isEmail(email)) { hint.textContent = 'This does not look like an email address.'; return; }
    var u = userByEmail(email);
    var c = inv && normEmail(inv.billedPerson) === email ? (inv.confidence || {}).billedPerson : 'manual';
    var parts = [u ? (u.name || u.email) + (u.isNew ? ' (new — check in Settings)' : '') : P.nameFromEmail(email) + ' (will be added to your users)'];
    if (PERSON_CONF[c]) parts.push(PERSON_CONF[c]);
    hint.append(parts.join(' · '));
    var co = $('d-company').value;
    if (u && companyById(u.companyId)) {
      if (!co) {
        hint.append(' ', el('button', { type: 'button', text: 'Use ' + companyLabel(u.companyId), onclick: function () { $('d-company').value = u.companyId; $('d-company').dispatchEvent(new Event('change')); } }));
      } else if (co !== u.companyId) {
        hint.append(el('span', { class: 'warn-text', text: ' · ' + (u.name || u.email) + ' belongs to ' + companyLabel(u.companyId) + ', not ' + companyLabel(co) + '.' }));
      }
    }
  }
  function fillPersonList() {
    var dl = $('person-list');
    dl.textContent = '';
    personOptions().forEach(function (o) { dl.append(el('option', { value: o[0], label: o[1] })); });
  }

  function fillCompanySelect(select, value) {
    var opts = [['', 'Unassigned']].concat(companies().map(function (c) { return [c.id, companyLabel(c.id)]; }));
    setOptions(select, opts, companyById(value) ? value : '');
  }

  function openDetail(id, queue) {
    var inv = state.invoices.find(function (x) { return x.id === id; });
    if (!inv) return;
    state.current = inv;
    if (queue) state.queue = queue;
    var token = ++openToken;
    var dlg = $('detail');
    var qi = state.queue.indexOf(id);
    var inQueue = qi !== -1 && state.queue.length > 0 && inv.status === 'review';
    $('d-eyebrow').textContent = inQueue
      ? 'TO CHECK · ' + (qi + 1) + ' OF ' + state.queue.length
      : (STATUS_LABEL[statusOf(inv)] + ' · ' + inv.fileName).toUpperCase();
    $('d-title').textContent = inv.vendor || inv.fileName;
    $('d-vendor').value = inv.vendor || '';
    $('d-number').value = inv.number || '';
    $('d-taxid').value = inv.vendorTaxId || '';
    fillCompanySelect($('d-company'), inv.billedTo);
    fillPersonList();
    $('d-person').value = inv.billedPerson || '';
    companyHint(inv);
    $('d-issue').value = inv.issueDate || '';
    $('d-due').value = inv.dueDate || '';
    fillCategorySelect($('d-cat'), inv.category);
    var cur = $('d-cur');
    if (!Array.from(cur.options).some(function (o) { return o.value === inv.currency; })) cur.append(el('option', { value: inv.currency, text: inv.currency }));
    cur.value = inv.currency || 'EUR';
    $('d-total').value = amountText(inv.total);
    $('d-vat').value = amountText(inv.vat);
    $('d-net').value = amountText(inv.net);
    $('d-eur').value = amountText(inv.eur);
    $('d-service').value = inv.serviceDate || '';
    $('d-rate').value = inv.vatRate != null ? String(inv.vatRate).replace('.', ',') : '';
    $('d-iban').value = formatIban(inv.iban);
    $('d-ref').value = inv.reference || '';
    $('d-po').value = inv.poNumber || '';
    $('d-paid').checked = !!inv.paid;
    $('d-paid-date').value = inv.paidDate || '';
    $('d-notes').value = inv.notes || '';
    $('d-remember').checked = true;
    $('d-text').textContent = inv.text || '(no text was found in this PDF)';
    document.querySelectorAll('#detail .tag[data-for]').forEach(function (t) {
      var c = (inv.confidence || {})[t.dataset.for];
      t.hidden = inv.status !== 'review' || !(c === 'low' || c === 'none' || c == null);
    });
    $('d-skip').hidden = !inQueue || qi === state.queue.length - 1;
    $('d-save').textContent = inQueue && qi < state.queue.length - 1 ? 'Save & next' : 'Save';
    $('d-scanned').hidden = !(inv.scanned || inv.readError);
    $('d-ocr-status').textContent = '';
    $('d-ocr').disabled = false;
    syncDetailUi();
    renderAlerts(inv);
    if (FX) FX.onOpen(inv);
    if (!dlg.open) dlg.showModal();
    $('d-pages').textContent = '';
    if (FM) FM.onOpen(inv);
    renderPreview(inv, token);
    setTimeout(function () {
      var firstCheck = document.querySelector('#detail .tag[data-for]:not([hidden])');
      var target = firstCheck ? firstCheck.closest('.f').querySelector('input,select') : $('d-vendor');
      if (target) target.focus();
    }, 30);
  }

  function renderAlerts(inv) {
    var box = $('d-alerts');
    box.textContent = '';
    var add = function (kind, text) { box.append(el('div', { class: 'alert ' + kind }, [icon('alert'), el('span', { text: text })])); };
    if (inv.readError) add('bad', isImageInv(inv) ? 'This photo could not be opened in this browser (HEIC works in Safari only). The file is saved; enter the details by hand.' : 'This PDF could not be read (it may be password-protected). The file is saved; enter the details by hand.');
    var LEVEL = { file: 'The same file was added before as', duplicate: 'Duplicate of', likely: 'Likely a duplicate of', possible: 'Possibly a duplicate of' };
    findDuplicates(inv).slice(0, 3).forEach(function (d) {
      var o = d.other;
      var row = el('div', { class: 'alert ' + (DUP_RANK[d.level] >= 2 ? 'warn' : 'info') }, [icon('alert'), el('span', { text: LEVEL[d.level] + ' ' + (o.vendor || o.fileName) + (o.number ? ' ' + o.number : '') + ' from ' + dateStr(o.issueDate) + ' (' + d.why + ').' })]);
      if (FX) row.append(el('button', { type: 'button', class: 'btn small', text: 'Compare', onclick: function () { compareFromDetail(inv, d); } }));
      box.append(row);
    });
  }

  async function compareFromDetail(inv, d) {
    var choice = await FX.compareDuplicates(inv, d, 'edit');
    if (choice === 'keep') {
      inv.dupOk = (inv.dupOk || []).concat([d.other.id]);
      delete inv.duplicateOf;
      await idb.put('invoices', inv);
      renderAlerts(inv);
      render();
    } else if (choice === 'replace') {
      await removeInvoice(d.other);
      renderAlerts(inv);
      render();
      toast('The other invoice was deleted.');
    } else if (choice === 'discard') {
      await removeInvoice(inv);
      $('detail').close();
      render();
      toast('This invoice was deleted.');
    }
  }

  // deletes an invoice and its file from this browser (and from the next cloud sync)
  async function removeInvoice(inv) {
    await idb.del('files', inv.id);
    await idb.del('invoices', inv.id);
    state.invoices = state.invoices.filter(function (x) { return x.id !== inv.id; });
    state.queue = state.queue.filter(function (id) { return id !== inv.id; });
    delete state.selected[inv.id];
    state.invoices.forEach(function (x) { if (x.duplicateOf === inv.id) delete x.duplicateOf; });
  }

  function syncDetailUi() {
    var cur = $('d-cur').value;
    $('d-eur-wrap').hidden = cur === 'EUR';
    $('d-paid-date-wrap').hidden = !$('d-paid').checked;
    var total = parseAmount($('d-total').value);
    var vat = parseAmount($('d-vat').value);
    var net = parseAmount($('d-net').value);
    var hint = $('d-math');
    hint.textContent = '';
    if (total == null) { hint.textContent = 'Enter the total to include this invoice in your costs.'; return; }
    if (vat != null && net != null) {
      var diff = Math.round((net + vat - total) * 100) / 100;
      if (Math.abs(diff) < 0.015) hint.textContent = 'Net + VAT = total ✓';
      else {
        hint.append('Net + VAT is ' + money(Math.abs(diff), cur) + (diff > 0 ? ' more' : ' less') + ' than the total. ');
        hint.append(el('button', { type: 'button', text: 'Set net to total − VAT', onclick: function () { $('d-net').value = amountText(Math.round((total - vat) * 100) / 100); syncDetailUi(); } }));
      }
    } else if (vat != null && net == null) {
      hint.append(el('button', { type: 'button', text: 'Fill net as total − VAT', onclick: function () { $('d-net').value = amountText(Math.round((total - vat) * 100) / 100); syncDetailUi(); } }));
    }
  }

  async function renderPreview(inv, token) {
    var holder = $('d-pages');
    if (state.previewDoc) { try { state.previewDoc.destroy(); } catch (e) { /* ignore */ } state.previewDoc = null; }
    var loading = null;
    try {
      var pdf = await openDoc(inv, function (msg) {
        if (token !== openToken) return;
        loading = el('p', { class: 'more loading', role: 'status' }, [el('span', { class: 'spin', 'aria-hidden': 'true' }), msg]);
        holder.append(loading);
      });
      if (loading) loading.remove();
      if (token !== openToken) { pdf.destroy(); return; }
      state.previewDoc = pdf;
      // page viewer with zoom, page navigation and field selection (fieldmap.js)
      if (FM) { await FM.showDoc(inv, pdf, function () { return token === openToken; }); return; }
      var width = Math.min(760, (holder.clientWidth || 520));
      var dpr = Math.min(2, window.devicePixelRatio || 1);
      var count = Math.min(pdf.numPages, 6);
      for (var p = 1; p <= count; p++) {
        var page = await pdf.getPage(p);
        if (token !== openToken) return;
        var base = page.getViewport({ scale: 1 });
        var vp = page.getViewport({ scale: (width / base.width) * dpr });
        var canvas = el('canvas', { 'aria-label': 'Page ' + p + ' of ' + pdf.numPages });
        canvas.width = Math.floor(vp.width);
        canvas.height = Math.floor(vp.height);
        canvas.style.width = width + 'px';
        holder.append(canvas);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      }
      if (pdf.numPages > count) holder.append(el('p', { class: 'more', text: '+ ' + (pdf.numPages - count) + ' more pages — download the PDF to see them all.' }));
    } catch (e) {
      if (token === openToken) {
        if (FM) FM.previewFailed();
        holder.textContent = '';
        var missing = /not stored|not in the cloud/i.test(e.message || '');
        holder.append(el('p', { class: 'more', text: missing
          ? 'The file of this invoice is not in this browser. Sign in to cloud sync (Settings) to download it.'
          : 'The preview could not be shown (' + (e.message || 'unknown error') + '). You can still download the file.' }));
      }
    }
  }

  function collectDetail() {
    var inv = state.current;
    inv.vendor = $('d-vendor').value.trim();
    inv.number = $('d-number').value.trim();
    inv.vendorTaxId = $('d-taxid').value.replace(/\s/g, '').toUpperCase();
    var co = $('d-company').value || '';
    if (co !== (inv.billedTo || '')) inv.confidence = Object.assign({}, inv.confidence, { billedTo: 'manual' });
    inv.billedTo = co;
    var who = normEmail($('d-person').value);
    if (who && !isEmail(who)) who = normEmail(inv.billedPerson);
    if (who !== normEmail(inv.billedPerson)) inv.confidence = Object.assign({}, inv.confidence, { billedPerson: 'manual' });
    inv.billedPerson = who;
    inv.issueDate = $('d-issue').value || null;
    inv.dueDate = $('d-due').value || null;
    inv.category = $('d-cat').value || 'Other';
    inv.currency = $('d-cur').value || 'EUR';
    inv.total = parseAmount($('d-total').value);
    inv.vat = parseAmount($('d-vat').value);
    inv.net = parseAmount($('d-net').value);
    inv.eur = inv.currency === 'EUR' ? null : parseAmount($('d-eur').value);
    inv.serviceDate = $('d-service').value || null;
    var rate = parseAmount(String($('d-rate').value).replace('%', ''));
    inv.vatRate = rate != null && rate >= 0 && rate <= 100 ? rate : null;
    inv.iban = $('d-iban').value.replace(/\s/g, '').toUpperCase();
    inv.reference = $('d-ref').value.trim();
    inv.poNumber = $('d-po').value.trim();
    inv.paid = $('d-paid').checked;
    inv.paidDate = inv.paid ? ($('d-paid-date').value || todayIso()) : null;
    inv.notes = $('d-notes').value.trim();
    inv.updatedAt = new Date().toISOString();
    if (FM) FM.collect(inv);
    if (FX) FX.collect(inv);
    // payments that cover the total make it paid
    var pays = inv.payments || [];
    if (!inv.paid && pays.length && inv.total != null && paidAmount(inv) >= inv.total - 0.005) {
      inv.paid = true;
      inv.paidDate = pays.map(function (p) { return p.date; }).filter(Boolean).sort().pop() || todayIso();
    }
    return inv;
  }

  function formatIban(s) {
    return String(s || '').replace(/\s/g, '').toUpperCase().replace(/(.{4})(?=.)/g, '$1 ');
  }

  function learnRule(inv) {
    if (!inv.vendor) return;
    var rule = { vendor: inv.vendor, category: inv.category, updatedAt: new Date().toISOString() };
    if (inv.vendorTaxId) state.rules['id:' + inv.vendorTaxId] = rule;
    else {
      var needle = P.norm(inv.detectedVendor || inv.vendor).trim();
      if (needle.length >= 5 && P.norm(inv.text || '').indexOf(needle) !== -1) state.rules['name:' + needle] = rule;
      else return;
    }
    return saveRules();
  }

  async function saveDetail() {
    var known = findDuplicates(state.current || {}).map(function (d) { return d.other.id; });
    var inv = collectDetail();
    var wasReview = inv.status === 'review';
    inv.status = 'ok';
    delete inv.duplicateOf;
    // an edit that makes this invoice look like another one: compare before saving
    var fresh = findDuplicates(inv).filter(function (d) { return DUP_RANK[d.level] >= 2 && known.indexOf(d.other.id) === -1; })[0];
    if (fresh && FX) {
      var choice = await FX.compareDuplicates(inv, fresh, 'edit');
      if (choice === 'discard') {
        await removeInvoice(inv);
        $('detail').close();
        render();
        toast('This invoice was deleted.');
        return;
      }
      if (choice === 'replace') await removeInvoice(fresh.other);
      if (choice === 'keep') inv.dupOk = (inv.dupOk || []).concat([fresh.other.id]);
      if (!choice) return; // closed without deciding: stay in the dialog, nothing saved yet
    }
    var dup = possibleDuplicate(inv);
    if (dup) inv.duplicateOf = dup.id;
    try {
      if (inv.billedPerson && !userByEmail(inv.billedPerson)) {
        var nameHint = FM ? FM.personName(inv.billedPerson) : '';
        ensureUser(inv.billedPerson, nameHint, inv.billedTo);
        await saveSettings();
      }
      await idb.put('invoices', inv);
      if ($('d-remember').checked) await learnRule(inv);
    } catch (e) {
      toast('Could not save: ' + e.message);
      return;
    }
    render();
    var qi = state.queue.indexOf(inv.id);
    if (wasReview && qi !== -1 && qi < state.queue.length - 1) {
      var next = state.queue.slice(qi + 1).find(function (id) { var x = state.invoices.find(function (i) { return i.id === id; }); return x && x.status === 'review'; });
      if (next) { openDetail(next); return; }
    }
    $('detail').close();
    toast('Saved ' + (inv.vendor || inv.fileName) + '.');
  }

  function skipDetail() {
    var qi = state.queue.indexOf(state.current.id);
    var next = state.queue[qi + 1];
    if (next) openDetail(next); else $('detail').close();
  }

  async function deleteCurrent() {
    var inv = state.current;
    if (!inv) return;
    if (!window.confirm('Delete ' + (inv.vendor || inv.fileName) + (inv.number ? ' ' + inv.number : '') + '? The file is removed from this browser.')) return;
    var qi = state.queue.indexOf(inv.id);
    await removeInvoice(inv);
    render();
    updateStorageLine();
    var next = qi !== -1 ? state.queue[qi] : null;
    if (next) openDetail(next); else $('detail').close();
    toast('Invoice deleted.');
  }

  async function downloadCurrent() {
    var inv = state.current;
    if (!inv) return;
    try { saveBlob(await fileBlob(inv), niceName(inv)); } catch (e) { toast('Could not get the file: ' + e.message); }
  }

  async function runOcr() {
    var inv = state.current;
    if (!inv || !state.previewDoc) return;
    var status = $('d-ocr-status');
    var btn = $('d-ocr');
    btn.disabled = true;
    status.textContent = 'Loading OCR (first time takes a while)…';
    try {
      if (isImageInv(inv)) {
        // a photo: OCR with word boxes, so fields can also be picked on the photo afterwards
        var ext = await extractImage(await fileBlob(inv), function (m) {
          status.textContent = (/recogniz/.test(m.status || '') ? 'Reading the photo' : 'Loading OCR') + (typeof m.progress === 'number' ? ' ' + Math.round(m.progress * 100) + '%' : '') + '…';
        });
        MEDIA.release();
        inv.ocrItems = ext.items;
        if (state.previewDoc) state.previewDoc.pageItems = ext.items;
        applyOcrLines(inv, ext.lines);
        inv.scanned = !ext.lines.length;
        await idb.put('invoices', inv);
        status.textContent = 'Done. Check the fields — OCR makes mistakes. You can now also select fields on the photo.';
        if (FM) FM.afterFullOcr(inv, true);
        return;
      }
      await loadScript(TESSERACT_URL);
      var worker = await window.Tesseract.createWorker('slv+eng');
      var lines = [];
      var pdf = state.previewDoc;
      var count = Math.min(pdf.numPages, 3);
      for (var p = 1; p <= count; p++) {
        status.textContent = 'Reading page ' + p + ' of ' + count + '…';
        var page = await pdf.getPage(p);
        var vp = page.getViewport({ scale: 2.2 });
        var canvas = document.createElement('canvas');
        canvas.width = Math.floor(vp.width);
        canvas.height = Math.floor(vp.height);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
        var res = await worker.recognize(canvas);
        lines = lines.concat(String(res.data.text || '').split('\n'));
      }
      await worker.terminate();
      applyOcrLines(inv, lines);
      status.textContent = 'Done. Check the fields — OCR makes mistakes.';
      if (FM) FM.afterFullOcr(inv);
    } catch (e) {
      console.error(e);
      status.textContent = 'OCR could not run here (' + e.message + '). Enter the amounts by hand.';
      btn.disabled = false;
    }
  }

  // fill empty fields from OCR'd text
  function applyOcrLines(inv, lines) {
    var parsed = P.parseInvoice(lines, parserOptions());
    var fill = function (id, value, fmt) { var input = $(id); if (!input.value && value != null && value !== '') input.value = fmt ? fmt(value) : value; };
    fill('d-vendor', parsed.vendor);
    fill('d-number', parsed.number);
    fill('d-taxid', parsed.vendorTaxId);
    fill('d-issue', parsed.issueDate);
    fill('d-due', parsed.dueDate);
    fill('d-total', parsed.total, amountText);
    fill('d-vat', parsed.vat, amountText);
    fill('d-net', parsed.net, amountText);
    fill('d-service', parsed.serviceDate);
    fill('d-rate', parsed.vatRate, function (v) { return String(v).replace('.', ','); });
    fill('d-iban', parsed.iban, formatIban);
    fill('d-ref', parsed.reference);
    fill('d-po', parsed.poNumber);
    if (parsed.currency && $('d-cur').value === 'EUR' && parsed.currency !== 'EUR') $('d-cur').value = parsed.currency;
    if (parsed.category && parsed.category !== 'Other' && $('d-cat').value === 'Other') $('d-cat').value = parsed.category;
    if (parsed.billedTo && !$('d-company').value) $('d-company').value = parsed.billedTo;
    if (parsed.billedPerson && !$('d-person').value) $('d-person').value = parsed.billedPerson;
    inv.text = lines.join('\n').slice(0, 40000);
    inv.ocr = true;
    $('d-text').textContent = inv.text;
    syncDetailUi();
    personHint(inv);
  }

  // ---------- export, backup, restore ----------

  function saveBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = el('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }
  function stamp() { return todayIso(); }
  function dec(v) { return v == null || isNaN(v) ? '' : v.toFixed(2).replace('.', ','); }
  function csvCell(v) {
    var s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(,\d+)?$/.test(s)) s = "'" + s;
    return /[";\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCsv(list) {
    // new columns go at the end so existing spreadsheet imports keep working
    var head = ['Invoice date', 'Due date', 'Vendor', 'Vendor VAT ID', 'Invoice number', 'Category', 'Currency', 'Net', 'VAT', 'Total', 'Total EUR', 'Paid', 'Paid on', 'Status', 'Notes', 'File', 'Service date', 'VAT rate', 'IBAN', 'Reference', 'PO number', 'Billed to', 'Billed to VAT ID', 'Billed to person', 'Billed to person email', 'Paid amount', 'Open amount'];
    var rows = list.map(function (inv) {
      return [inv.issueDate, inv.dueDate, inv.vendor, inv.vendorTaxId, inv.number, inv.category, inv.currency, dec(inv.net), dec(inv.vat), dec(inv.total), dec(eurOf(inv)), inv.paid ? 'yes' : 'no', inv.paidDate, STATUS_LABEL[statusOf(inv)], inv.notes, niceName(inv),
        inv.serviceDate, inv.vatRate != null ? String(inv.vatRate).replace('.', ',') : '', inv.iban, inv.reference, inv.poNumber,
        companyById(inv.billedTo) ? companyById(inv.billedTo).name : 'Unassigned', companyById(inv.billedTo) ? companyById(inv.billedTo).vatId : '',
        inv.billedPerson ? personLabel(inv.billedPerson) : 'Unassigned', inv.billedPerson || '',
        dec(inv.paid && !paidAmount(inv) ? inv.total : paidAmount(inv)), dec(remaining(inv))];
    });
    return '﻿' + [head].concat(rows).map(function (r) { return r.map(csvCell).join(';'); }).join('\r\n');
  }
  function sortedForExport(list) { return list.slice().sort(function (a, b) { return dateOf(a) < dateOf(b) ? -1 : 1; }); }

  function exportCsv() {
    var list = sortedForExport(filtered());
    if (!list.length) { toast('No invoices to export with these filters.'); return; }
    saveBlob(new Blob([toCsv(list)], { type: 'text/csv;charset=utf-8' }), 'invoices-' + stamp() + '.csv');
  }

  // full backup: every file + all data as JSON, written by zip.js (no network)
  async function exportBackup() {
    var list = state.invoices.slice();
    if (!list.length) { toast('No invoices to export.'); return; }
    var t = toast('Preparing the .zip…', { progress: true });
    try {
      var entries = [];
      var missing = 0;
      for (var i = 0; i < list.length; i++) {
        var inv = list[i];
        t.update('Adding ' + (i + 1) + ' of ' + list.length + '…');
        var rec = await idb.get('files', inv.id);
        if (!rec) { missing++; continue; }
        entries.push({ name: 'files/' + inv.id + '.' + fileExt(inv), data: rec.blob, date: new Date(inv.addedAt || Date.now()) });
      }
      entries.push({ name: 'invoices.json', data: JSON.stringify({ app: 'adrial-invoices', version: 1, exportedAt: new Date().toISOString(), settings: state.settings, rules: state.rules, templates: FM ? FM.allTemplates() : [], invoices: list }, null, 1) });
      var blob = await ZIP.make(entries);
      t.close();
      saveBlob(blob, 'invoices-backup-' + stamp() + '.zip');
      if (missing) toast(plural(missing, 'file is', 'files are') + ' only in the cloud and not in this backup. Open those invoices once to download them.');
    } catch (e) {
      t.close();
      toast('Export failed: ' + e.message);
    }
  }

  function str(v, max) { return typeof v === 'string' ? v.slice(0, max || 500) : ''; }
  function numOrNull(v) { return typeof v === 'number' && isFinite(v) ? Math.round(v * 100) / 100 : null; }
  function isoOrNull(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null; }
  function cleanInvoice(o) {
    return {
      id: str(o.id, 80) || uid(), hash: str(o.hash, 128), fileName: str(o.fileName, 260) || 'invoice.pdf',
      size: typeof o.size === 'number' ? o.size : 0, pages: typeof o.pages === 'number' ? o.pages : 0,
      addedAt: str(o.addedAt, 40) || new Date().toISOString(), updatedAt: str(o.updatedAt, 40) || undefined,
      vendor: str(o.vendor, 200), detectedVendor: str(o.detectedVendor, 200), vendorTaxId: str(o.vendorTaxId, 30),
      billedTo: /^[A-Za-z0-9\-_]{0,80}$/.test(o.billedTo || '') ? (o.billedTo || '') : '',
      billedPerson: isEmail(o.billedPerson) ? normEmail(o.billedPerson).slice(0, 200) : '',
      reverseCharge: o.reverseCharge === true,
      number: str(o.number, 80), issueDate: isoOrNull(o.issueDate), dueDate: isoOrNull(o.dueDate),
      currency: /^[A-Z]{3}$/.test(o.currency) ? o.currency : 'EUR', total: numOrNull(o.total), vat: numOrNull(o.vat),
      net: numOrNull(o.net), eur: numOrNull(o.eur), category: str(o.category, 80) || 'Other', notes: str(o.notes, 4000),
      paid: o.paid === true, paidDate: isoOrNull(o.paidDate), status: o.status === 'review' ? 'review' : 'ok',
      scanned: o.scanned === true, readError: o.readError === true, ocr: o.ocr === true,
      confidence: o.confidence && typeof o.confidence === 'object' ? o.confidence : {}, text: str(o.text, 40000),
      serviceDate: isoOrNull(o.serviceDate), vatRate: numOrNull(o.vatRate), iban: str(o.iban, 40).replace(/[^A-Z0-9]/gi, '').toUpperCase(),
      reference: str(o.reference, 80), poNumber: str(o.poNumber, 80),
      regions: R.cleanRegions(o.regions), templateId: str(o.templateId, 80) || undefined,
      fromTemplate: Array.isArray(o.fromTemplate) ? o.fromTemplate.filter(function (k) { return R.FIELD_KEYS.indexOf(k) !== -1; }) : undefined,
      mime: /^(application\/pdf|image\/[a-z0-9.+\-]{1,40})$/i.test(o.mime || '') ? o.mime : 'application/pdf',
      ext: /^[a-z0-9]{1,5}$/i.test(o.ext || '') ? o.ext.toLowerCase() : undefined,
      ocrItems: cleanItems(o.ocrItems),
      payments: cleanPayments(o.payments),
      dupOk: Array.isArray(o.dupOk) ? o.dupOk.filter(function (x) { return typeof x === 'string'; }).slice(0, 50) : undefined,
      payeeStreet: str(o.payeeStreet, 70) || undefined, payeeCity: str(o.payeeCity, 70) || undefined
    };
  }
  function cleanPayments(v) {
    if (!Array.isArray(v)) return [];
    return v.map(function (p) {
      if (!p || typeof p !== 'object') return null;
      var amount = numOrNull(p.amount);
      if (amount == null) return null;
      return { id: str(p.id, 80) || uid(), date: isoOrNull(p.date), amount: amount, method: str(p.method, 40), note: str(p.note, 200) };
    }).filter(Boolean).slice(0, 200);
  }
  function cleanItems(v) {
    if (!Array.isArray(v)) return undefined;
    return v.slice(0, 15).map(function (page) {
      return (Array.isArray(page) ? page : []).slice(0, 3000).map(function (it) {
        if (!it || typeof it.s !== 'string') return null;
        var n = function (x) { return typeof x === 'number' && isFinite(x) ? Math.max(0, Math.min(1, x)) : 0; };
        return { s: it.s.slice(0, 200), x: n(it.x), y: n(it.y), w: n(it.w), h: n(it.h) };
      }).filter(Boolean);
    });
  }

  function strList(v, max) { return Array.isArray(v) ? v.filter(function (x) { return typeof x === 'string' && x.trim(); }).map(function (x) { return x.trim().slice(0, 200); }).slice(0, max || 20) : []; }
  function cleanCompany(o) {
    if (!o || typeof o !== 'object' || typeof o.name !== 'string' || !o.name.trim()) return null;
    return {
      id: /^[A-Za-z0-9\-_]{1,80}$/.test(o.id || '') ? o.id : (slug(o.name) || uid()),
      name: o.name.trim().slice(0, 200),
      country: /^[A-Z]{2}$/.test(o.country || '') ? o.country : '',
      variants: strList(o.variants),
      vatId: str(o.vatId, 30).replace(/[\s.\-]/g, '').toUpperCase(),
      keywords: strList(o.keywords)
    };
  }

  function cleanUser(o) {
    if (!o || typeof o !== 'object' || !isEmail(o.email)) return null;
    return {
      email: normEmail(o.email).slice(0, 200),
      name: str(o.name, 120).trim(),
      companyId: /^[A-Za-z0-9\-_]{0,80}$/.test(o.companyId || '') ? (o.companyId || '') : '',
      aliases: strList(o.aliases).map(normEmail).filter(isEmail),
      isNew: o.isNew === true
    };
  }

  async function restoreBackup(file) {
    var t = toast('Reading the backup…', { progress: true });
    try {
      var zip = await ZIP.read(file);
      var jsonFile = zip.file('invoices.json');
      if (!jsonFile) throw new Error('this is not an Invoices backup');
      var data = JSON.parse(await jsonFile.async('string'));
      if (!data || data.app !== 'adrial-invoices' || !Array.isArray(data.invoices)) throw new Error('this is not an Invoices backup');
      var added = 0;
      var skipped = 0;
      for (var i = 0; i < data.invoices.length; i++) {
        var inv = cleanInvoice(data.invoices[i] || {});
        if (state.invoices.some(function (x) { return x.id === inv.id || (inv.hash && x.hash === inv.hash); })) { skipped++; continue; }
        var pdf = zip.file('files/' + inv.id + '.' + fileExt(inv)) || zip.file('files/' + inv.id + '.pdf');
        if (!pdf) { skipped++; continue; }
        var bytes = await pdf.async('arraybuffer');
        var blob = new Blob([bytes], { type: inv.mime });
        var fh = await sha256(bytes);
        if (!inv.hash) inv.hash = fh;
        await idb.put('files', { id: inv.id, blob: blob, hash: fh, type: inv.mime });
        await idb.put('invoices', inv);
        state.invoices.push(inv);
        added++;
        t.update('Restored ' + added + '…');
      }
      if (data.rules && typeof data.rules === 'object') {
        Object.keys(data.rules).forEach(function (k) {
          var r = data.rules[k];
          if (!state.rules[k] && r && typeof r.vendor === 'string') state.rules[k] = { vendor: str(r.vendor, 200), category: str(r.category, 80) || 'Other' };
        });
        await saveRules();
      }
      if (Array.isArray(data.templates) && FM) await FM.importTemplates(data.templates, { keepExisting: true });
      if (data.settings && Array.isArray(data.settings.categories)) {
        data.settings.categories.forEach(function (c) { if (typeof c === 'string' && state.settings.categories.indexOf(c) === -1) state.settings.categories.push(c.slice(0, 80)); });
        await saveSettings();
      }
      if (data.settings && Array.isArray(data.settings.companies)) {
        data.settings.companies.map(cleanCompany).forEach(function (c) { if (c && !companyById(c.id)) state.settings.companies.push(c); });
        await saveSettings();
      }
      if (data.settings && Array.isArray(data.settings.users)) {
        data.settings.users.map(cleanUser).forEach(function (u) { if (u && !userByEmail(u.email)) users().push(u); });
        await saveSettings();
      }
      t.close();
      requestPersist();
      render();
      updateStorageLine();
      toast('Restored ' + plural(added, 'invoice', 'invoices') + (skipped ? ' · ' + skipped + ' already here or missing' : '') + '.');
    } catch (e) {
      t.close();
      toast('Could not restore: ' + e.message + '.');
    }
  }

  // ---------- settings ----------

  function openSettings() {
    var s = state.settings;
    $('s-own').value = s.ownNames.join(', ');
    $('s-ownids').value = s.ownTaxIds.join(', ');
    $('s-cats').value = s.categories.join('\n');
    $('s-remind').value = String(remindDays());
    $('s-notify').checked = !!s.notify && window.Notification && Notification.permission === 'granted';
    $('s-notify').disabled = !window.Notification;
    $('s-notify-hint').textContent = !window.Notification ? 'This browser has no notifications.' : Notification.permission === 'denied' ? 'Notifications are blocked for this site in the browser settings.' : 'Only while the app is open in a tab. The browser asks for permission when you turn this on.';
    renderCompanyEditor(JSON.parse(JSON.stringify(companies())));
    renderUserEditor(JSON.parse(JSON.stringify(users())));
    renderRules();
    updateStorageLine();
    $('settings').showModal();
  }
  function renderCompanyEditor(list) {
    var box = $('s-companies');
    box.textContent = '';
    list.forEach(function (c, i) { box.append(companyRow(c, i)); });
    updateDetectButton();
  }
  function updateDetectButton() {
    var unassigned = state.invoices.filter(function (x) { return !companyById(x.billedTo) || !x.billedPerson; }).length;
    $('s-detect').hidden = !unassigned;
    $('s-detect').textContent = 'Detect company & person for ' + plural(unassigned, 'unassigned invoice', 'unassigned invoices');
  }

  var userRowSeq = 0;
  function renderUserEditor(list) {
    var box = $('s-users');
    box.textContent = '';
    list.sort(function (a, b) { return (b.isNew ? 1 : 0) - (a.isNew ? 1 : 0) || String(a.name || a.email).localeCompare(String(b.name || b.email), 'sl'); });
    list.forEach(function (u) { box.append(userRow(u)); });
    $('s-users-empty').hidden = list.length > 0;
  }
  function userRow(u) {
    var n = 'us' + (++userRowSeq) + '-';
    var input = function (key, label, value, attrs, span2) {
      return el('div', { class: 'f' + (span2 ? ' span2' : '') }, [
        el('label', { for: n + key, text: label }),
        el('input', Object.assign({ id: n + key, 'data-k': key, value: value || '', autocomplete: 'off', spellcheck: 'false' }, attrs || {}))
      ]);
    };
    var coSel = el('select', { id: n + 'company', 'data-k': 'companyId' });
    setOptions(coSel, [['', 'No company']].concat(companies().map(function (c) { return [c.id, companyLabel(c.id)]; })), companyById(u.companyId) ? u.companyId : '');
    var count = state.invoices.filter(function (x) { return personKey(x) === normEmail(u.email); }).length;
    return el('fieldset', { class: 'company user', 'data-new': u.isNew ? '1' : '' }, [
      el('legend', { class: 'sr', text: 'Person ' + (u.name || u.email) }),
      u.isNew ? el('span', { class: 'tag', text: 'New — found on an invoice, check it' }) : null,
      el('div', { class: 'grid2' }, [
        input('email', 'Email', u.email, { type: 'email', required: true }),
        input('name', 'Name', u.name),
        el('div', { class: 'f' }, [el('label', { for: n + 'company', text: 'Company' }), coSel]),
        input('aliases', 'Other emails', (u.aliases || []).join(', '), { placeholder: 'Comma-separated' })
      ]),
      el('div', { class: 'actions' }, [
        el('span', { class: 'muted', style: 'font-size:13px', text: plural(count, 'invoice', 'invoices') }),
        el('button', { type: 'button', class: 'btn small ghost danger', text: 'Remove person', onclick: function (e) { e.currentTarget.closest('fieldset').remove(); } })
      ])
    ]);
  }
  function readUserEditor() {
    var seen = {};
    return Array.from($('s-users').querySelectorAll('fieldset.user')).map(function (fs) {
      var get = function (k) { return fs.querySelector('[data-k="' + k + '"]').value.trim(); };
      var email = normEmail(get('email'));
      if (!isEmail(email) || seen[email]) return null;
      seen[email] = true;
      var wasNew = fs.dataset.new === '1';
      var name = get('name');
      return cleanUser({
        email: email, name: name || P.nameFromEmail(email), companyId: get('companyId'),
        aliases: get('aliases').split(',').map(function (x) { return x.trim(); }).filter(Boolean),
        // saving the settings form counts as checking the new people
        isNew: wasNew && fs.dataset.keepNew === '1'
      });
    }).filter(Boolean);
  }
  function companyRow(c, i) {
    var n = 'co' + i + '-';
    var field = function (key, label, value, hint, attrs) {
      return el('div', { class: 'f' + (key === 'name' ? ' span2' : '') }, [
        el('label', { for: n + key, text: label }),
        el('input', Object.assign({ id: n + key, 'data-k': key, value: value || '', autocomplete: 'off', spellcheck: 'false' }, attrs || {})),
        hint ? el('span', { class: 'hint', text: hint }) : null
      ]);
    };
    return el('fieldset', { class: 'company', 'data-id': c.id || '' }, [
      el('legend', { class: 'sr', text: 'Company ' + (i + 1) }),
      el('div', { class: 'grid2' }, [
        field('name', 'Legal name', c.name),
        field('variants', 'Other names on invoices', (c.variants || []).join(', '), 'Comma-separated, e.g. a short name.'),
        field('vatId', 'VAT ID', c.vatId, null, { placeholder: c.country === 'HR' ? 'HR…' : 'SI…' }),
        field('keywords', 'Address keywords', (c.keywords || []).join(', '), 'Comma-separated street, town or account words.'),
        field('country', 'Country', c.country, null, { maxlength: '2', placeholder: 'SI' })
      ]),
      el('button', { type: 'button', class: 'btn small ghost danger', text: 'Remove company', onclick: function (e) { e.currentTarget.closest('fieldset').remove(); } })
    ]);
  }
  function readCompanyEditor() {
    var split = function (s) { return s.split(',').map(function (x) { return x.trim(); }).filter(Boolean); };
    var used = {};
    return Array.from($('s-companies').querySelectorAll('fieldset.company')).map(function (fs) {
      var get = function (k) { return fs.querySelector('[data-k="' + k + '"]').value.trim(); };
      var name = get('name');
      if (!name) return null;
      var id = fs.dataset.id || slug(name.split(',')[0]) || uid();
      while (used[id]) id += '-2';
      used[id] = true;
      return cleanCompany({ id: id, name: name, variants: split(get('variants')), vatId: get('vatId'), keywords: split(get('keywords')), country: get('country').toUpperCase() });
    }).filter(Boolean);
  }

  function renderRules() {
    var ul = $('s-rules');
    ul.textContent = '';
    var keys = Object.keys(state.rules).sort(function (a, b) { return state.rules[a].vendor.localeCompare(state.rules[b].vendor); });
    $('s-rules-help').hidden = keys.length > 0;
    if (!keys.length) { ul.append(el('li', {}, [el('span', { class: 'muted', text: 'None yet.' })])); return; }
    keys.forEach(function (k) {
      var r = state.rules[k];
      ul.append(el('li', {}, [
        el('span', {}, [el('strong', { style: 'font-weight:500', text: r.vendor }), ' → ' + r.category, el('br'), el('small', { text: k.indexOf('id:') === 0 ? 'VAT ID ' + k.slice(3) : 'Name on PDF: ' + k.slice(5) })]),
        el('button', { type: 'button', class: 'btn small ghost', text: 'Forget', onclick: function () { delete state.rules[k]; saveRules(); renderRules(); } })
      ]));
    });
  }
  function saveSettingsForm() {
    var split = function (s) { return s.split(',').map(function (x) { return x.trim(); }).filter(Boolean); };
    state.settings.ownNames = split($('s-own').value);
    state.settings.ownTaxIds = split($('s-ownids').value).map(function (x) { return x.replace(/\s/g, '').toUpperCase(); });
    var cats = $('s-cats').value.split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
    if (cats.indexOf('Other') === -1) cats.push('Other');
    state.settings.categories = Array.from(new Set(cats));
    state.settings.companies = readCompanyEditor();
    state.settings.users = readUserEditor();
    var rd = parseInt($('s-remind').value, 10);
    state.settings.remindDays = rd >= 0 && rd <= 60 ? rd : 3;
    state.settings.notify = $('s-notify').checked;
    saveSettings();
    $('settings').close();
    render();
    toast('Settings saved.');
  }
  async function wipeAll() {
    if (!window.confirm('Delete every invoice and setting from this browser? This cannot be undone.')) return;
    await idb.clear('files');
    await idb.clear('invoices');
    await idb.clear('kv');
    await idb.clear('templates');
    if (FM) FM.setTemplates([]);
    state.invoices = [];
    state.rules = {};
    state.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    $('settings').close();
    render();
    updateStorageLine();
    toast('Everything was deleted.');
  }

  // ---------- events ----------

  function bind() {
    var fileInput = $('file-input');
    $('add-btn').addEventListener('click', function () { fileInput.click(); });
    $('add-btn-2').addEventListener('click', function () { fileInput.click(); });
    fileInput.addEventListener('change', function () { var files = Array.from(fileInput.files || []); fileInput.value = ''; importFiles(files); });
    var camInput = $('camera-input');
    $('camera-btn').addEventListener('click', function () { camInput.click(); });
    camInput.addEventListener('change', function () { var files = Array.from(camInput.files || []); camInput.value = ''; importFiles(files); });
    $('due-btn').addEventListener('click', function () { state.filters.status = 'attention'; state.filters.year = ''; state.filters.month = ''; saveUi(); render(); $('t-h').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    $('due-badge').addEventListener('click', function () { $('due-btn').click(); });
    $('t-clear').addEventListener('click', function () { var f = state.filters; f.year = ''; f.month = ''; f.cat = ''; f.vendor = ''; f.company = ''; f.person = ''; f.status = ''; f.q = ''; saveUi(); render(); });
    $('s-notify').addEventListener('change', function () { if (this.checked && FX) FX.enableNotify(this); });

    var menu = $('export-menu');
    menu.querySelectorAll('[data-act]').forEach(function (b) {
      b.addEventListener('click', function () {
        menu.removeAttribute('open');
        var act = b.dataset.act;
        if (act === 'csv') exportCsv();
        else if (act === 'accountant') { if (FX) FX.openAccountant(); }
        else if (act === 'ics') { if (FX) FX.exportIcs(); }
        else if (act === 'backup') exportBackup();
        else if (act === 'restore') $('restore-input').click();
      });
    });
    document.addEventListener('click', function (e) { if (menu.open && !menu.contains(e.target)) menu.removeAttribute('open'); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && menu.open) { menu.removeAttribute('open'); menu.querySelector('summary').focus(); } });
    $('restore-input').addEventListener('change', function () { var f = this.files[0]; this.value = ''; if (f) restoreBackup(f); });

    $('settings-btn').addEventListener('click', openSettings);
    $('s-close').addEventListener('click', function () { $('settings').close(); });
    $('s-cancel').addEventListener('click', function () { $('settings').close(); });
    $('settings-form').addEventListener('submit', function (e) { e.preventDefault(); saveSettingsForm(); });
    $('s-wipe').addEventListener('click', wipeAll);
    $('s-add-company').addEventListener('click', function () {
      var box = $('s-companies');
      var row = companyRow({ id: '', name: '', variants: [], vatId: '', keywords: [], country: '' }, box.children.length + Date.now() % 1000);
      box.append(row);
      row.querySelector('input').focus();
    });
    $('s-detect').addEventListener('click', async function () {
      // use the companies as currently typed in the form
      state.settings.companies = readCompanyEditor();
      $('s-users').querySelectorAll('fieldset.user').forEach(function (fs) { fs.dataset.keepNew = '1'; });
      state.settings.users = readUserEditor();
      await saveSettings();
      var r = await detectUnassigned();
      renderCompanyEditor(JSON.parse(JSON.stringify(companies())));
      renderUserEditor(JSON.parse(JSON.stringify(users())));
      var parts = [];
      if (r.companies) parts.push('company for ' + plural(r.companies, 'invoice', 'invoices'));
      if (r.people) parts.push('person for ' + plural(r.people, 'invoice', 'invoices'));
      toast(parts.length ? 'Found the ' + parts.join(' and the ') + '. They are marked so you can check them.' : 'None of the unassigned invoices mention one of your companies or a person.');
    });
    $('s-add-user').addEventListener('click', function () {
      var row = userRow({ email: '', name: '', companyId: '', aliases: [] });
      $('s-users').prepend(row);
      $('s-users-empty').hidden = true;
      row.querySelector('input').focus();
    });

    $('templates-btn').addEventListener('click', function () { if (FM) FM.openTemplates(); });
    $('t-body').addEventListener('change', function (e) {
      var cb = e.target.closest('input[data-pick]');
      if (!cb) return;
      if (cb.checked) state.selected[cb.dataset.pick] = true; else delete state.selected[cb.dataset.pick];
      cb.closest('tr').classList.toggle('sel', cb.checked);
      renderBulk();
    });
    $('t-pick-all').addEventListener('change', function () {
      var on = this.checked;
      (state.shownIds || []).forEach(function (id) { if (on) state.selected[id] = true; else delete state.selected[id]; });
      renderTable(filtered());
    });
    $('bulk-apply').addEventListener('click', applyBulkCompany);
    $('bulk-person-apply').addEventListener('click', applyBulkPerson);
    $('bulk-paid').addEventListener('click', applyBulkPaid);
    $('d-person').addEventListener('input', function () { personHint(state.current); });
    $('d-person').addEventListener('change', function () {
      // picking a known person fills an empty company
      var u = userByEmail(this.value);
      if (u && companyById(u.companyId) && !$('d-company').value) { $('d-company').value = u.companyId; $('d-company').dispatchEvent(new Event('change')); }
      personHint(state.current);
    });
    $('d-company').addEventListener('change', function () { personHint(state.current); });
    $('bulk-clear').addEventListener('click', function () { state.selected = {}; renderTable(filtered()); });

    $('review-btn').addEventListener('click', function () {
      var ids = state.invoices.filter(function (x) { return x.status === 'review'; }).sort(function (a, b) { return a.addedAt < b.addedAt ? -1 : 1; }).map(function (x) { return x.id; });
      if (ids.length) openDetail(ids[0], ids);
    });

    var onFilter = function (key, input) {
      input.addEventListener('change', function () {
        state.filters[key] = input.value;
        if (key === 'year' && !input.value) state.filters.month = '';
        if (key === 'status' && /^(attention|duesoon|overdue)$/.test(input.value)) { state.filters.year = ''; state.filters.month = ''; }
        saveUi();
        render();
      });
    };
    onFilter('year', $('f-year'));
    onFilter('person', $('f-person'));
    onFilter('month', $('f-month'));
    onFilter('cat', $('f-cat'));
    onFilter('status', $('f-status'));
    onFilter('company', $('f-company'));
    var qTimer = null;
    $('f-q').addEventListener('input', function () {
      var v = this.value;
      clearTimeout(qTimer);
      qTimer = setTimeout(function () { state.filters.q = v; saveUi(); render(); }, 160);
    });
    $('f-vendor-clear').addEventListener('click', function () { state.filters.vendor = ''; saveUi(); render(); });

    document.querySelectorAll('thead th[data-sort] button').forEach(function (b) {
      b.addEventListener('click', function () {
        var key = b.parentElement.dataset.sort;
        if (state.sort.key === key) state.sort.dir = -state.sort.dir;
        else state.sort = { key: key, dir: key === 'vendor' || key === 'category' ? 1 : -1 };
        saveUi();
        render();
      });
    });
    $('t-body').addEventListener('click', function (e) {
      if (e.target.closest('td.pick')) return;
      var tr = e.target.closest('tr[data-id]');
      if (tr) openDetail(tr.dataset.id, []);
    });

    var dlg = $('detail');
    $('detail-form').addEventListener('submit', function (e) { e.preventDefault(); saveDetail(); });
    $('d-close').addEventListener('click', function () { dlg.close(); });
    $('d-skip').addEventListener('click', skipDetail);
    $('d-delete').addEventListener('click', deleteCurrent);
    $('d-download').addEventListener('click', downloadCurrent);
    $('d-ocr').addEventListener('click', runOcr);
    ['d-cur', 'd-paid', 'd-total', 'd-vat', 'd-net'].forEach(function (id) {
      $(id).addEventListener('input', syncDetailUi);
      $(id).addEventListener('change', syncDetailUi);
    });
    $('d-paid').addEventListener('change', function () { if (this.checked && !$('d-paid-date').value) $('d-paid-date').value = todayIso(); });
    dlg.addEventListener('close', function () {
      if (dlg.open) return; // closed and reopened in the same task: the close event arrives late
      openToken++;
      state.queue = [];
      if (FM) FM.onClose();
      if (state.previewDoc) { try { state.previewDoc.destroy(); } catch (e) { /* ignore */ } state.previewDoc = null; }
      $('d-pages').textContent = '';
    });

    var overlay = $('drop-overlay');
    var depth = 0;
    var hasFiles = function (e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') !== -1; };
    window.addEventListener('dragenter', function (e) { if (!hasFiles(e)) return; e.preventDefault(); depth++; overlay.hidden = false; });
    window.addEventListener('dragover', function (e) { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    window.addEventListener('dragleave', function (e) { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) overlay.hidden = true; });
    window.addEventListener('drop', function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      overlay.hidden = true;
      importFiles(e.dataTransfer.files);
    });
    window.addEventListener('scroll', hideTip, { passive: true });
  }

  // ---------- start ----------

  async function start() {
    if (window.InvoiceFieldMap && R) {
      try {
        FM = window.InvoiceFieldMap.init({
          state: state, idb: idb, $: $, el: el, icon: icon, toast: toast, loadScript: loadScript, TESSERACT_URL: TESSERACT_URL,
          uid: uid, money: money, dateStr: dateStr, amountText: amountText, formatIban: formatIban, syncDetailUi: syncDetailUi,
          openDetail: openDetail, parserOptions: parserOptions, fillCategorySelect: fillCategorySelect, plural: plural, pdfjs: PDFJS,
          companies: companies, companyById: companyById, companyLabel: companyLabel, companyHint: companyHint,
          users: users, userByEmail: userByEmail, personLabel: personLabel, personHint: function () { personHint(state.current); }
        });
      } catch (e) { console.error(e); FM = null; }
    }
    if (window.InvoiceFeatures) {
      try {
        FX = window.InvoiceFeatures.init({
          state: state, idb: idb, $: $, el: el, icon: icon, toast: toast, uid: uid, money: money, dateStr: dateStr, amountText: amountText,
          parseAmount: parseAmount, plural: plural, todayIso: todayIso, addDays: addDays, formatIban: formatIban, saveBlob: saveBlob,
          saveSettings: saveSettings, render: render, openDetail: openDetail, syncDetailUi: syncDetailUi, setOptions: setOptions,
          companies: companies, companyById: companyById, companyLabel: companyLabel, personLabel: personLabel, personKey: personKey,
          paidAmount: paidAmount, remaining: remaining, remainingEur: remainingEur, payState: payState, statusOf: statusOf, STATUS_LABEL: STATUS_LABEL,
          isOverdue: isOverdue, isDueSoon: isDueSoon, remindDays: remindDays, eurOf: eurOf, isEur: isEur, dateOf: dateOf, fileExt: fileExt,
          fileBlob: fileBlob, openDoc: openDoc, isImageInv: isImageInv, slug: slug, UNASSIGNED: UNASSIGNED, sum: sum
        });
      } catch (e) { console.error(e); FX = null; }
    }
    bind();
    var hadUi = loadUi();
    await loadState();
    if (!hadUi) {
      var thisYear = String(new Date().getFullYear());
      var years = state.invoices.map(function (x) { return dateOf(x).slice(0, 4); }).sort();
      state.filters.year = years.indexOf(thisYear) !== -1 || !years.length ? thisYear : years[years.length - 1];
    }
    render();
    updateStorageLine();
    migrateFileHashes();
    attachSync();
  }

  // ---------- cloud sync (/_shared/adrial-sync.js) ----------

  // every file record carries the sha256 of its bytes and its type (the cloud stores files by hash)
  async function migrateFileHashes() {
    try {
      var recs = await idb.all('files');
      for (var i = 0; i < recs.length; i++) {
        var r = recs[i];
        if (r.hash && r.type) continue;
        var inv = state.invoices.find(function (x) { return x.id === r.id; });
        var h = r.hash || await sha256(await r.blob.arrayBuffer());
        await idb.put('files', { id: r.id, blob: r.blob, hash: h, type: r.type || (inv && inv.mime) || r.blob.type || 'application/pdf' });
        if (inv && inv.hash !== h) { inv.hash = h; await idb.put('invoices', inv); }
      }
    } catch (e) { console.warn('file hash migration', e); }
  }

  function snapshot() {
    return {
      app: 'adrial-invoices', version: 1, savedAt: new Date().toISOString(),
      // metadata only — files go separately by hash; long PDF text is trimmed to keep the copy small
      invoices: state.invoices.map(function (x) { var o = Object.assign({}, x); o.text = String(x.text || '').slice(0, 20000); return o; }),
      templates: FM ? FM.allTemplates() : [],
      settings: state.settings,
      rules: state.rules
    };
  }

  async function applySnapshot(data) {
    if (!data || !Array.isArray(data.invoices)) throw new Error('The cloud copy is not Invoices data');
    applyingSnapshot = true;
    try {
      if ($('detail').open) $('detail').close();
      var invs = data.invoices.map(cleanInvoice);
      await idb.clear('invoices');
      for (var i = 0; i < invs.length; i++) await idb.put('invoices', invs[i]);
      await idb.clear('templates');
      if (FM) { FM.setTemplates([]); await FM.importTemplates(Array.isArray(data.templates) ? data.templates : [], { keepExisting: false }); }
      var settings = Object.assign(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), data.settings && typeof data.settings === 'object' ? data.settings : {});
      settings.companies = (Array.isArray(settings.companies) ? settings.companies : DEFAULT_COMPANIES).map(cleanCompany).filter(Boolean);
      settings.users = (Array.isArray(settings.users) ? settings.users : []).map(cleanUser).filter(Boolean);
      await idb.put('kv', { key: 'settings', value: settings });
      await idb.put('kv', { key: 'rules', value: data.rules && typeof data.rules === 'object' ? data.rules : {} });
      // files of invoices that no longer exist go; the rest stay (others download when opened)
      var keep = {};
      invs.forEach(function (x) { keep[x.id] = true; });
      var recs = await idb.all('files');
      for (var k = 0; k < recs.length; k++) if (!keep[recs[k].id]) await idb.del('files', recs[k].id);
      await loadState();
      state.selected = {};
      render();
      updateStorageLine();
    } finally {
      applyingSnapshot = false;
    }
  }

  var MAX_SYNC_FILE = 20 * 1024 * 1024;
  var syncFiles = {
    list: async function () {
      var recs = await idb.all('files');
      return recs.filter(function (r) { return r.hash && r.blob && !/^size-/.test(r.hash) && r.blob.size <= MAX_SYNC_FILE; }).map(function (r) {
        return { hash: r.hash, type: r.type || r.blob.type, getBlob: function () { return Promise.resolve(r.blob); } };
      });
    },
    has: async function (hash) {
      var recs = await idb.all('files');
      return recs.some(function (r) { return r.hash === hash; });
    },
    put: async function (hash, blob, type) {
      var owners = state.invoices.filter(function (x) { return x.hash === hash; });
      for (var i = 0; i < owners.length; i++) {
        var mime = owners[i].mime || type || 'application/pdf';
        await idb.put('files', { id: owners[i].id, blob: new Blob([blob], { type: mime }), hash: hash, type: mime });
      }
      updateStorageLine();
    }
  };

  function attachSync() {
    if (!window.AdrialSync) return;
    try {
      sync = AdrialSync.attach({ app: 'invoices', label: 'Invoices', getSnapshot: snapshot, applySnapshot: applySnapshot, files: syncFiles });
      sync.mountPanel($('s-sync'));
    } catch (e) { console.error(e); sync = null; }
  }

  async function loadState() {
    try {
      var rows = await Promise.all([idb.all('invoices'), idb.get('kv', 'settings'), idb.get('kv', 'rules'), idb.all('templates')]);
      state.invoices = rows[0] || [];
      if (rows[1] && rows[1].value) {
        var saved = rows[1].value;
        state.settings = Object.assign(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), saved);
        // once: ADRIAL's VAT ID and the short name it has on invoices (seen on a real invoice)
        if (!(saved.migrations && saved.migrations.adrialVat)) {
          var ad = companyById('adrial');
          if (ad) {
            if (!ad.vatId) ad.vatId = 'SI36314765';
            ad.variants = (ad.variants || []).filter(function (v) { return P.norm(v) !== 'adrial d.o.o.'; }).concat(['ADRIAL d.o.o.']);
          }
          state.settings.migrations = Object.assign({}, saved.migrations, { adrialVat: true });
          if (!Array.isArray(state.settings.users)) state.settings.users = [];
          saveSettings();
        }
      }
      else state.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
      state.rules = rows[2] && rows[2].value ? rows[2].value : {};
      if (FM) FM.setTemplates(rows[3] || []);
    } catch (e) {
      console.error(e);
      $('storage-error').hidden = false;
    }
  }

  // exposed for the end-to-end test only
  window.__invoicesApp = { state: state, importFiles: importFiles, get fieldMap() { return FM; }, get features() { return FX; }, get sync() { return sync; } };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
