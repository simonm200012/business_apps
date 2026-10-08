/* Invoices: core. IndexedDB, import pipeline, filters, dashboard, table, detail dialog, CSV/backup, settings, sync wiring. */
(function () {
  'use strict';
  var P = window.InvoiceParser, R = window.InvoiceRegions, Z = window.InvoiceZip, M = window.InvoiceMedia;
  var PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  if (window.pdfjsLib) window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  var DEFAULT_COMPANIES = [{ id: 'c1', name: 'Adrial d.o.o.', vatId: '', aliases: [], ibans: [] }, { id: 'c2', name: 'Adrial Optika d.o.o.', vatId: '', aliases: [], ibans: [] },
    { id: 'c3', name: 'Adrial Trgovina d.o.o.', vatId: '', aliases: [], ibans: [] }, { id: 'c4', name: 'Adrial Holding d.o.o.', vatId: '', aliases: [], ibans: [] }];
  var DEFAULT_SETTINGS = { categories: P.DEFAULT_CATEGORIES, companies: DEFAULT_COMPANIES, users: [], ownNames: [], ownVatIds: [], remindDays: 3, notify: false, exportPattern: '{date}_{vendor}_{number}', exportSep: ';' };
  var UI_KEY = 'adrial-invoices-ui';
  var state = { invoices: [], settings: clone(DEFAULT_SETTINGS), rules: {}, templates: [], filters: { year: '', month: '', cat: '', status: '', company: '', person: '', q: '' }, sort: { key: 'issueDate', dir: -1 }, sel: new Set(), queue: [], cur: null };
  var db = null, memOnly = false, memFiles = {}, sync = null, FM = null, FX = null, core = null;

  /* ---------- helpers ---------- */
  function $(id) { return document.getElementById(id); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function uid(p) { return (p || 'i') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function todayIso() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function addDays(iso, n) { var d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function daysBetween(a, b) { return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5); }
  function fmtDate(iso) { var m = /^(\d{4})-(\d\d)-(\d\d)/.exec(iso || ''); return m ? (+m[3]) + '. ' + (+m[2]) + '. ' + m[1] : ''; }
  var nf = {};
  function fmtMoney(v, cur) {
    if (v == null || v === '' || !isFinite(v)) return '';
    cur = cur || 'EUR'; var k = cur;
    try { nf[k] = nf[k] || new Intl.NumberFormat('sl-SI', { style: 'currency', currency: cur }); return nf[k].format(v); } catch (e) { return Number(v).toFixed(2) + ' ' + cur; }
  }
  function num(v) { if (v == null || v === '') return null; var n = P.toNumber(String(v)); return isFinite(n) ? n : null; }
  function r2(x) { return Math.round(x * 100) / 100; }
  function toast(msg, ms) {
    var t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; $('toasts').appendChild(t);
    setTimeout(function () { t.remove(); }, ms || 3500);
  }
  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  async function sha256(buf) {
    try { if (!(window.crypto && crypto.subtle)) throw 0; var d = await crypto.subtle.digest('SHA-256', buf); return Array.prototype.map.call(new Uint8Array(d), function (b) { return b.toString(16).padStart(2, '0'); }).join(''); }
    catch (e) { return 'size-' + buf.byteLength; }
  }
  function ask(html, o) {
    o = o || {};
    return new Promise(function (res) {
      var d = $('ask'); $('ask-title').textContent = o.title || 'Confirm'; $('ask-body').innerHTML = html; $('ask-yes').textContent = o.ok || 'OK'; $('ask-no').hidden = !!o.single;
      var done = function (v) { d.close(); $('ask-yes').onclick = $('ask-no').onclick = d.oncancel = null; res(v); };
      $('ask-yes').onclick = function () { done(true); }; $('ask-no').onclick = function () { done(false); }; d.oncancel = function (e) { e.preventDefault(); done(false); };
      d.showModal();
    });
  }

  /* ---------- IndexedDB ---------- */
  function openDb() {
    return new Promise(function (res, rej) {
      if (!window.indexedDB) return rej(new Error('IndexedDB unavailable'));
      var rq = indexedDB.open('adrial-invoices', 2);
      rq.onupgradeneeded = function () {
        var d = rq.result, s;
        if (!d.objectStoreNames.contains('invoices')) { s = d.createObjectStore('invoices', { keyPath: 'id' }); s.createIndex('hash', 'hash'); }
        else { s = rq.transaction.objectStore('invoices'); if (!s.indexNames.contains('hash')) s.createIndex('hash', 'hash'); }
        if (!d.objectStoreNames.contains('files')) d.createObjectStore('files', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv', { keyPath: 'key' });
        if (!d.objectStoreNames.contains('templates')) d.createObjectStore('templates', { keyPath: 'id' });
      };
      rq.onsuccess = function () { res(rq.result); }; rq.onerror = function () { rej(rq.error); };
    });
  }
  function run(stores, mode, fn) {
    if (memOnly) return Promise.resolve(null);
    return new Promise(function (res, rej) {
      var t = db.transaction(stores, mode), out;
      t.oncomplete = function () {
        if (mode === 'readwrite' && sync && [].concat(stores).some(function (s) { return s !== 'files'; })) { try { sync.changed(); } catch (e) {} }
        res(out && typeof out === 'object' && 'result' in out && out.readyState ? out.result : out);
      };
      t.onerror = t.onabort = function () { rej(t.error || new Error('Database error')); };
      out = fn(t);
    });
  }
  var idb = {
    all: function (s) { return run(s, 'readonly', function (t) { return t.objectStore(s).getAll(); }); },
    get: function (s, k) { return run(s, 'readonly', function (t) { return t.objectStore(s).get(k); }); },
    put: function (s, v) { return run(s, 'readwrite', function (t) { return t.objectStore(s).put(v); }); },
    del: function (s, k) { return run(s, 'readwrite', function (t) { return t.objectStore(s).delete(k); }); },
    clear: function (names) { return run(names, 'readwrite', function (t) { names.forEach(function (n) { t.objectStore(n).clear(); }); }); }
  };

  /* ---------- state load/save ---------- */
  function mergeSettings(s) {
    var o = Object.assign(clone(DEFAULT_SETTINGS), s || {});
    ['categories', 'companies', 'users', 'ownNames', 'ownVatIds'].forEach(function (k) { if (!Array.isArray(o[k])) o[k] = clone(DEFAULT_SETTINGS[k]); });
    if (!o.categories.length) o.categories = clone(P.DEFAULT_CATEGORIES);
    return o;
  }
  async function loadState() {
    var inv = await idb.all('invoices'), st = await idb.get('kv', 'settings'), ru = await idb.get('kv', 'rules'), tp = await idb.all('templates');
    state.invoices = (inv || []).map(cleanInvoice); state.settings = mergeSettings(st && st.value); state.rules = (ru && ru.value) || {}; state.templates = tp || [];
  }
  function cleanInvoice(i) {
    var d = { id: '', hash: '', fileName: '', mime: '', ext: '', size: 0, pages: 0, addedAt: '', vendor: '', detectedVendor: '', vendorTaxId: '', billedTo: '', billedPerson: '', number: '', issueDate: '', dueDate: '', serviceDate: '', currency: 'EUR',
      total: null, vat: null, net: null, eur: null, vatRate: null, iban: '', reference: '', poNumber: '', category: 'other', notes: '', reverseCharge: false, paid: false, paidDate: '', payments: [], status: 'review',
      confidence: {}, text: '', ocr: false, ocrItems: null, templateId: '', fromTemplate: false, regions: null, duplicateOf: '', dupOk: [] };
    return Object.assign(d, i);
  }
  function saveInvoice(inv) { inv = cleanInvoice(inv); var k = state.invoices.findIndex(function (x) { return x.id === inv.id; }); if (k >= 0) state.invoices[k] = inv; else state.invoices.push(inv); return idb.put('invoices', inv); }
  function saveSettings() { return idb.put('kv', { key: 'settings', value: state.settings }); }
  function saveRules() { return idb.put('kv', { key: 'rules', value: state.rules }); }
  function getInv(id) { return state.invoices.find(function (x) { return x.id === id; }); }
  async function fileBlob(id) {
    if (memOnly) return memFiles[id] || null;
    var f = await idb.get('files', id); if (f && f.blob) return f.blob;
    if (sync && sync.fetchFile) { var inv = getInv(id); try { var b = inv && await sync.fetchFile(inv.hash); if (b) { await idb.put('files', { id: id, blob: b, hash: inv.hash, type: inv.mime }); return b; } } catch (e) {} }
    return null;
  }
  function putFile(inv, blob) { if (memOnly) { memFiles[inv.id] = blob; return Promise.resolve(); } return idb.put('files', { id: inv.id, blob: blob, hash: inv.hash, type: inv.mime }); }
  async function deleteInvoice(id) { state.invoices = state.invoices.filter(function (x) { return x.id !== id; }); state.sel.delete(id); delete memFiles[id]; await idb.del('invoices', id); await idb.del('files', id); }

  /* ---------- domain helpers ---------- */
  function catName(id) { var c = state.settings.categories.find(function (x) { return x.id === id; }); return c ? c.name : (id || '-'); }
  function companyName(id) { var c = state.settings.companies.find(function (x) { return x.id === id; }); return c ? c.name : ''; }
  function personName(email) { var u = state.settings.users.find(function (x) { return x.email === email; }); return u ? (u.name || u.email) : (email || ''); }
  function paidSum(inv) { return (inv.payments || []).reduce(function (s, p) { return s + (+p.amount || 0); }, 0); }
  function openAmount(inv) { if (inv.total == null) return 0; if (inv.paid && !(inv.payments || []).length) return 0; return Math.max(0, r2(inv.total - paidSum(inv))); }
  function isPaid(inv) { return !!inv.paid || (inv.total != null && inv.total > 0 && openAmount(inv) <= 0.005 && (inv.payments || []).length > 0); }
  function toEur(inv, v) {
    if (v == null) return 0; if ((inv.currency || 'EUR') === 'EUR') return v;
    if (inv.eur != null && inv.total) return v * inv.eur / inv.total; return 0;
  }
  function statusOf(inv) {
    if (inv.status === 'review') return 'review'; if (isPaid(inv)) return 'paid';
    if (inv.dueDate && inv.dueDate < todayIso()) return 'overdue'; return 'unpaid';
  }
  function isDue(inv) { return inv.status !== 'review' && !isPaid(inv) && inv.dueDate && inv.dueDate <= addDays(todayIso(), state.settings.remindDays | 0); }
  function parseOpts() {
    var s = state.settings;
    return { companies: s.companies, ownNames: s.ownNames, ownVatIds: s.ownVatIds, users: s.users, rules: state.rules };
  }
  function findDuplicates(inv) {
    var best = null, order = { file: 4, duplicate: 3, likely: 2, possible: 1 };
    state.invoices.forEach(function (o) {
      if (o.id === inv.id || (inv.dupOk || []).indexOf(o.id) >= 0 || (o.dupOk || []).indexOf(inv.id) >= 0) return;
      var lvl = null, nv = P.normName(inv.vendor), ov = P.normName(o.vendor);
      if (inv.hash && !/^size-/.test(inv.hash) && inv.hash === o.hash) lvl = 'file';
      else if (nv && nv === ov && inv.number && inv.number.toLowerCase() === (o.number || '').toLowerCase()) lvl = 'duplicate';
      else if (nv && nv === ov && inv.total != null && inv.total === o.total && inv.issueDate && inv.issueDate === o.issueDate) lvl = 'likely';
      else if (inv.total != null && inv.total === o.total && inv.issueDate && inv.issueDate === o.issueDate && inv.billedTo === o.billedTo && inv.total > 0) lvl = 'possible';
      if (lvl && (!best || order[lvl] > order[best.level])) best = { level: lvl, other: o };
    });
    return best;
  }

  /* ---------- PDF / image text ---------- */
  async function extractPdf(buf) {
    if (!window.pdfjsLib) throw new Error('pdf.js did not load (offline?), so PDFs cannot be read right now.');
    var doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise, n = Math.min(doc.numPages, 15), items = [];
    for (var p = 1; p <= n; p++) {
      var page = await doc.getPage(p), vp = page.getViewport({ scale: 1 }), tc = await page.getTextContent();
      tc.items.forEach(function (it) { if (it.str && it.str.trim()) items.push(R.fromPdfItem(it, vp.transform, vp.width, vp.height, p - 1)); });
    }
    var pages = doc.numPages; try { doc.destroy(); } catch (e) {}
    return { lines: R.linesFromItems(items), items: items, pages: pages };
  }
  function compactItems(items) { return items.slice(0, 4000).map(function (i) { return { s: i.s, x: +i.x.toFixed(4), y: +i.y.toFixed(4), w: +i.w.toFixed(4), h: +i.h.toFixed(4), p: i.p || 0 }; }); }

  /* ---------- import ---------- */
  function sniffType(f, head) {
    if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) return 'pdf';
    if (/^image\//.test(f.type) || /\.(jpe?g|png|webp|heic|heif|gif|bmp)$/i.test(f.name)) return 'image';
    if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') return 'pdf';
    if (/\.zip$/i.test(f.name)) return 'zip';
    return '';
  }
  function extOf(name, type) { var m = /\.([a-z0-9]{2,5})$/i.exec(name || ''); return m ? m[1].toLowerCase() : (type === 'pdf' ? 'pdf' : 'jpg'); }
  async function importFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []); if (!files.length) return;
    var added = [], failed = 0, busy = $('add-btn');
    busy.disabled = true;
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
    for (var i = 0; i < files.length; i++) {
      var f = files[i]; toast('Reading ' + f.name + ' (' + (i + 1) + '/' + files.length + ')', 2000);
      try {
        var buf = await f.arrayBuffer(), type = sniffType(f, new Uint8Array(buf, 0, 8));
        if (type === 'zip') { await restoreBackup(f); continue; }
        if (!type) { toast(f.name + ': only PDF files and photos can be added.'); failed++; continue; }
        var hash = await sha256(buf), lines = [], items = [], pages = 1, ocr = false;
        if (type === 'pdf') { var ex = await extractPdf(buf); lines = ex.lines; items = ex.items; pages = ex.pages; }
        else {
          var ph = await M.ocr(f, { onProgress: function (m) { if (m.status === 'recognizing text') $('storage-line').textContent = 'Reading photo ' + Math.round((m.progress || 0) * 100) + '%'; } });
          items = ph.items; lines = R.linesFromItems(items); ocr = true;
        }
        var parsed = P.parseInvoice(lines, parseOpts());
        if (FM) { try { parsed = FM.applyOnImport(parsed, items, { lines: lines }) || parsed; } catch (e) { console.warn('template', e); } }
        var inv = makeInvoice(f, type, hash, buf.byteLength, pages, parsed, lines, ocr, items);
        await putFile(inv, new Blob([buf], { type: type === 'pdf' ? 'application/pdf' : (f.type || 'image/jpeg') }));
        await saveInvoice(inv); added.push(inv);
      } catch (e) { console.error(e); failed++; toast(f.name + ': ' + (e && e.message ? e.message : 'could not be read'), 6000); }
    }
    busy.disabled = false; updateStorageLine();
    if (!state.filters.year && added.length) state.filters.year = '';
    render();
    for (var k = 0; k < added.length; k++) {
      var cur = getInv(added[k].id); if (!cur) continue;
      var dup = findDuplicates(cur);
      if (dup) await resolveDuplicate(cur, dup);
    }
    var review = state.invoices.filter(function (x) { return x.status === 'review' && added.some(function (a) { return a.id === x.id; }); });
    if (added.length) toast(added.length + ' added' + (failed ? ', ' + failed + ' failed' : ''));
    render();
    if (review.length) { state.queue = review.map(function (x) { return x.id; }); openDetail(state.queue[0], { queue: true }); }
  }
  function makeInvoice(f, type, hash, size, pages, p, lines, ocr, items) {
    var text = lines.join('\n').slice(0, 40000);
    var inv = cleanInvoice({
      id: uid('inv'), hash: hash, fileName: f.name || 'photo.jpg', mime: type === 'pdf' ? 'application/pdf' : (f.type || 'image/jpeg'), ext: extOf(f.name, type), size: size, pages: pages, addedAt: new Date().toISOString(),
      vendor: p.vendor || '', detectedVendor: p.detectedVendor || p.vendor || '', vendorTaxId: p.vendorTaxId || '', billedTo: p.billedTo || '', billedPerson: p.billedPerson || '',
      number: p.number || '', issueDate: p.issueDate || '', dueDate: p.dueDate || '', serviceDate: p.serviceDate || '', currency: p.currency || 'EUR',
      total: p.total, vat: p.vat, net: p.net, eur: p.eur, vatRate: p.vatRate, iban: p.iban || '', reference: p.reference || '', poNumber: p.poNumber || '', category: p.category || 'other',
      reverseCharge: !!p.reverseCharge, status: 'review', confidence: p.confidence || {}, text: text, ocr: !!ocr, ocrItems: ocr ? compactItems(items) : null,
      templateId: p.templateId || '', fromTemplate: !!p.templateId, regions: p.regions || null });
    if (p.scanned) inv.confidence.scanned = true;
    return inv;
  }
  async function resolveDuplicate(inv, dup) {
    var act = FX ? await FX.compareDuplicates(inv, dup.other, dup.level) : ((await ask('<p>This looks like a duplicate of <b>' + esc(dup.other.vendor || dup.other.fileName) + '</b>. Keep it anyway?</p>', { title: 'Possible duplicate', ok: 'Keep both' })) ? 'keep' : 'discard');
    if (act === 'discard') { await deleteInvoice(inv.id); toast('Discarded ' + inv.fileName); }
    else if (act === 'replace') {
      var old = dup.other; inv.payments = old.payments || []; inv.paid = old.paid; inv.paidDate = old.paidDate; if (old.notes) inv.notes = old.notes; if (old.status === 'ok') inv.status = 'ok';
      await saveInvoice(inv); await deleteInvoice(old.id);
    } else { inv.dupOk = (inv.dupOk || []).concat(dup.other.id); dup.other.dupOk = (dup.other.dupOk || []).concat(inv.id); await saveInvoice(inv); await saveInvoice(dup.other); }
    render();
  }

  /* ---------- filters + rendering ---------- */
  function loadUi() { var u = lsGet(UI_KEY); if (u) { if (u.filters) Object.assign(state.filters, u.filters); if (u.sort) state.sort = u.sort; } }
  function saveUi() { lsSet(UI_KEY, { filters: state.filters, sort: state.sort }); }
  function yearOf(inv) { return (inv.issueDate || inv.addedAt || '').slice(0, 4); }
  function monthOf(inv) { return (inv.issueDate || inv.addedAt || '').slice(5, 7); }
  function applyFilters(list, skip) {
    var f = state.filters, q = (f.q || '').toLowerCase().trim();
    return list.filter(function (i) {
      if (f.year && skip !== 'month' && yearOf(i) !== f.year) return false; if (f.year && skip === 'month' && yearOf(i) !== f.year) return false;
      if (f.month && skip !== 'month' && monthOf(i) !== f.month) return false;
      if (f.cat && i.category !== f.cat) return false; if (f.company && i.billedTo !== f.company) return false; if (f.person && i.billedPerson !== f.person) return false;
      if (f.status) { var st = statusOf(i); if (f.status === 'due') { if (!isDue(i)) return false; } else if (f.status === 'unpaid') { if (st !== 'unpaid' && st !== 'overdue') return false; } else if (st !== f.status) return false; }
      if (q && (i.vendor + ' ' + i.number + ' ' + i.notes + ' ' + i.fileName + ' ' + i.reference).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }
  function opt(v, t, sel) { return '<option value="' + esc(v) + '"' + (sel === v ? ' selected' : '') + '>' + esc(t) + '</option>'; }
  function renderFilters() {
    var f = state.filters, years = {}; state.invoices.forEach(function (i) { var y = yearOf(i); if (y) years[y] = 1; });
    var ys = Object.keys(years).sort().reverse(); if (f.year && ys.indexOf(f.year) < 0) ys.unshift(f.year);
    var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    $('f-year').innerHTML = opt('', 'All years', f.year) + ys.map(function (y) { return opt(y, y, f.year); }).join('');
    $('f-month').innerHTML = opt('', 'All months', f.month) + MON.map(function (m, k) { return opt(String(k + 1).padStart(2, '0'), m, f.month); }).join('');
    $('f-cat').innerHTML = opt('', 'All categories', f.cat) + state.settings.categories.map(function (c) { return opt(c.id, c.name, f.cat); }).join('');
    $('f-status').innerHTML = [['', 'Any status'], ['review', 'To check'], ['unpaid', 'Unpaid'], ['overdue', 'Overdue'], ['due', 'Due soon or overdue'], ['paid', 'Paid']].map(function (x) { return opt(x[0], x[1], f.status); }).join('');
    $('f-company').innerHTML = opt('', 'All companies', f.company) + state.settings.companies.map(function (c) { return opt(c.id, c.name, f.company); }).join('');
    $('f-person').innerHTML = opt('', 'All people', f.person) + state.settings.users.map(function (u) { return opt(u.email, u.name || u.email, f.person); }).join('');
    $('f-q').value = f.q || '';
  }
  function sum(list, fn) { return list.reduce(function (s, i) { return s + (fn(i) || 0); }, 0); }
  function renderKpis(list) {
    var other = list.filter(function (i) { return (i.currency || 'EUR') !== 'EUR' && !i.eur; }).length;
    var tot = sum(list, function (i) { return toEur(i, i.total); }), vat = sum(list, function (i) { return toEur(i, i.vat); }), net = sum(list, function (i) { return toEur(i, i.net != null ? i.net : i.total); });
    var open = sum(list, function (i) { return i.status === 'review' ? 0 : toEur(i, openAmount(i)); });
    $('kpis').innerHTML = [['Invoices', list.length], ['Total incl. VAT', fmtMoney(tot)], ['Excl. VAT', fmtMoney(net)], ['VAT', fmtMoney(vat)], ['Open to pay', fmtMoney(open)]].map(function (k) { return '<div class="card kpi"><span class="muted small">' + k[0] + '</span><b>' + esc(k[1]) + '</b></div>'; }).join('') +
      (other ? '<div class="card kpi"><span class="muted small">Without EUR value</span><b>' + other + '</b></div>' : '');
  }
  function renderBanners() {
    var rv = state.invoices.filter(function (i) { return i.status === 'review'; }), due = state.invoices.filter(isDue);
    $('review-banner').hidden = !rv.length; $('review-text').textContent = rv.length + (rv.length === 1 ? ' invoice needs' : ' invoices need') + ' a quick check before it counts.';
    $('due-banner').hidden = !due.length;
    var overdue = due.filter(function (i) { return i.dueDate < todayIso(); });
    $('due-text').textContent = due.length + ' unpaid ' + (due.length === 1 ? 'invoice is' : 'invoices are') + ' due within ' + state.settings.remindDays + ' days or overdue' + (overdue.length ? ' (' + overdue.length + ' overdue)' : '') + ': ' + fmtMoney(sum(due, function (i) { return toEur(i, openAmount(i)); })) + '.';
  }
  function renderMonthChart(list) {
    var f = state.filters, byM = {}, months = [];
    list.forEach(function (i) { var k = (i.issueDate || i.addedAt || '').slice(0, 7); if (k.length === 7) byM[k] = (byM[k] || 0) + toEur(i, i.net != null ? i.net : i.total); });
    if (f.year) for (var m = 1; m <= 12; m++) months.push(f.year + '-' + String(m).padStart(2, '0'));
    else { var ks = Object.keys(byM).sort(); if (ks.length) { var c = ks[ks.length - 1], y = +c.slice(0, 4), mo = +c.slice(5); for (var n = 0; n < 12; n++) { months.unshift(y + '-' + String(mo).padStart(2, '0')); mo--; if (!mo) { mo = 12; y--; } } } }
    if (!months.length) { $('chart-month').innerHTML = '<p class="muted">No data.</p>'; $('chart-table').innerHTML = ''; return; }
    var max = Math.max.apply(null, months.map(function (k) { return byM[k] || 0; }).concat([1])), W = 600, H = 190, bw = W / months.length, svg = '<svg viewBox="0 0 ' + W + ' ' + (H + 18) + '" role="img" aria-label="Costs by month">';
    months.forEach(function (k, i) {
      var v = byM[k] || 0, h = Math.round(v / max * (H - 14)), x = i * bw + 4;
      svg += '<g><rect class="b' + (f.month && k.slice(5) === f.month ? ' sel' : '') + '" data-m="' + k + '" x="' + x + '" y="' + (H - h) + '" width="' + (bw - 8) + '" height="' + Math.max(h, v ? 1 : 0) + '" rx="3" tabindex="0" role="button" aria-label="' + k + ': ' + esc(fmtMoney(v)) + '"><title>' + k + ': ' + esc(fmtMoney(v)) + '</title></rect><text x="' + (x + (bw - 8) / 2) + '" y="' + (H + 12) + '" text-anchor="middle">' + k.slice(5) + '</text></g>';
    });
    $('chart-month').innerHTML = svg + '</svg>';
    $('chart-table').innerHTML = '<table class="cmp"><tbody>' + months.map(function (k) { return '<tr><td>' + k + '</td><td class="num">' + esc(fmtMoney(byM[k] || 0)) + '</td></tr>'; }).join('') + '</tbody></table>';
  }
  function bars(el, list, keyFn, labelFn, filterKey, limit) {
    var agg = {}; list.forEach(function (i) { var k = keyFn(i) || ''; agg[k] = (agg[k] || 0) + toEur(i, i.net != null ? i.net : i.total); });
    var rows = Object.keys(agg).map(function (k) { return { k: k, v: agg[k] }; }).sort(function (a, b) { return b.v - a.v; }).slice(0, limit || 8), max = rows.length ? Math.max(rows[0].v, 1) : 1;
    $(el).innerHTML = rows.length ? rows.map(function (r) {
      return '<button class="bar-row" type="button" data-f="' + filterKey + '" data-v="' + esc(r.k) + '" aria-pressed="' + (filterKey && state.filters[filterKey] === r.k ? 'true' : 'false') + '"><span class="l">' + esc(labelFn(r.k) || '(none)') + '</span><span class="t"><i style="width:' + Math.max(2, r.v / max * 100) + '%"></i></span><span class="small nowrap">' + esc(fmtMoney(r.v)) + '</span></button>';
    }).join('') : '<span class="muted">No data.</span>';
  }
  var COLS = [['issueDate', 'Date'], ['vendor', 'Vendor'], ['number', 'Number', 'hide-s'], ['billedTo', 'Company', 'hide-s'], ['category', 'Category', 'hide-s'], ['total', 'Total', 'num'], ['dueDate', 'Due', 'hide-s'], ['status', 'Status']];
  function sortVal(i, k) {
    if (k === 'status') return statusOf(i); if (k === 'billedTo') return companyName(i.billedTo); if (k === 'category') return catName(i.category);
    var v = i[k]; return typeof v === 'string' ? v.toLowerCase() : (v == null ? -Infinity : v);
  }
  function renderTable(list) {
    var s = state.sort;
    $('tbl').querySelector('thead').innerHTML = '<tr><th><input type="checkbox" id="sel-all" aria-label="Select all"></th>' + COLS.map(function (c) { return '<th class="' + (c[2] || '') + '" data-sort="' + c[0] + '" aria-sort="' + (s.key === c[0] ? (s.dir > 0 ? 'ascending' : 'descending') : 'none') + '">' + c[1] + (s.key === c[0] ? (s.dir > 0 ? ' ▲' : ' ▼') : '') + '</th>'; }).join('') + '</tr>';
    var rows = list.slice().sort(function (a, b) { var x = sortVal(a, s.key), y = sortVal(b, s.key); return (x < y ? -1 : x > y ? 1 : 0) * s.dir || (a.addedAt < b.addedAt ? 1 : -1); });
    $('tbl').querySelector('tbody').innerHTML = rows.map(function (i) {
      var st = statusOf(i), cls = st === 'paid' ? 'ok' : st === 'overdue' ? 'bad' : st === 'review' ? 'warn' : '', label = { review: 'To check', paid: 'Paid', overdue: 'Overdue', unpaid: 'Unpaid' }[st];
      return '<tr data-id="' + i.id + '" tabindex="0"><td><input type="checkbox" class="sel" data-id="' + i.id + '"' + (state.sel.has(i.id) ? ' checked' : '') + ' aria-label="Select"></td><td class="nowrap">' + esc(fmtDate(i.issueDate)) + '</td><td>' + esc(i.vendor || i.fileName) + (i.duplicateOf ? ' <span class="chip">dup</span>' : '') +
        '</td><td class="hide-s">' + esc(i.number) + '</td><td class="hide-s">' + esc(companyName(i.billedTo)) + '</td><td class="hide-s">' + esc(catName(i.category)) + '</td><td class="num nowrap">' + esc(fmtMoney(i.total, i.currency)) + '</td><td class="hide-s nowrap">' + esc(fmtDate(i.dueDate)) +
        '</td><td><span class="chip ' + cls + '">' + label + '</span></td></tr>';
    }).join('') || '<tr><td colspan="9" class="muted">Nothing matches the filters.</td></tr>';
    $('tbl-foot').textContent = list.length + ' of ' + state.invoices.length + ' invoices shown.';
    var all = $('sel-all'); if (all) all.checked = rows.length > 0 && rows.every(function (i) { return state.sel.has(i.id); });
  }
  function renderBulk() {
    var el = $('bulk'), n = state.sel.size; el.classList.toggle('on', n > 0); if (!n) { el.innerHTML = ''; return; }
    el.innerHTML = '<b>' + n + ' selected</b><select id="b-company" aria-label="Assign company">' + opt('', 'Assign company…', '') + state.settings.companies.map(function (c) { return opt(c.id, c.name, ''); }).join('') + '</select>' +
      '<select id="b-person" aria-label="Assign person">' + opt('', 'Assign person…', '') + state.settings.users.map(function (u) { return opt(u.email, u.name || u.email, ''); }).join('') + '</select>' +
      '<button type="button" id="b-paid">Mark paid</button><button type="button" id="b-unpaid">Mark unpaid</button><button type="button" class="danger" id="b-del">Delete</button><button type="button" id="b-clear">Clear</button>';
  }
  function render() {
    var has = state.invoices.length > 0; $('empty').hidden = has; $('main').hidden = !has;
    renderBanners(); if (!has) return;
    renderFilters(); var list = applyFilters(state.invoices);
    renderKpis(list); if (FX) FX.renderPayments($('payments'), state.invoices); renderMonthChart(applyFilters(state.invoices, 'month'));
    bars('bars-vendor', list, function (i) { return i.vendor; }, function (k) { return k; }, 'q', 8);
    bars('bars-company', list, function (i) { return i.billedTo; }, companyName, 'company', 8);
    bars('bars-person', list, function (i) { return i.billedPerson; }, personName, 'person', 8);
    bars('bars-category', list, function (i) { return i.category; }, catName, 'cat', 8);
    renderTable(list); renderBulk();
  }

  /* ---------- detail dialog ---------- */
  var D = { vendor: 'd-vendor', vendorTaxId: 'd-vatid', number: 'd-number', billedTo: 'd-company', billedPerson: 'd-person', issueDate: 'd-issue', dueDate: 'd-due', serviceDate: 'd-service', currency: 'd-currency', total: 'd-total',
    vat: 'd-vat', net: 'd-net', vatRate: 'd-rate', eur: 'd-eur', iban: 'd-iban', reference: 'd-ref', poNumber: 'd-po', category: 'd-category', notes: 'd-notes' };
  var NUMF = { total: 1, vat: 1, net: 1, vatRate: 1, eur: 1 };
  function setField(key, value, conf) {
    var el = $(D[key]); if (!el) return; el.value = value == null ? '' : (NUMF[key] && value !== '' ? String(r2(+value)) : value);
    if (conf) markConf(key, conf);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function markConf(key, conf) { var el = $(D[key]); if (el) el.className = el.className.replace(/\bc-\w+\b/g, '').trim() + ' c-' + conf; }
  function fillSelects() {
    $('d-company').innerHTML = opt('', '(not set)', '') + state.settings.companies.map(function (c) { return opt(c.id, c.name, ''); }).join('');
    $('d-person').innerHTML = opt('', '(not set)', '') + state.settings.users.map(function (u) { return opt(u.email, u.name || u.email, ''); }).join('');
    $('d-category').innerHTML = state.settings.categories.map(function (c) { return opt(c.id, c.name, ''); }).join('');
  }
  async function openDetail(id, o) {
    var inv = getInv(id); if (!inv) return; o = o || {};
    state.cur = { id: id, inv: inv, dirty: false }; fillSelects();
    Object.keys(D).forEach(function (k) {
      var el = $(D[k]), v = inv[k]; if (k === 'category' && !state.settings.categories.some(function (c) { return c.id === v; })) el.insertAdjacentHTML('beforeend', opt(v, v, '')); if (k === 'billedTo' && v && !companyName(v)) v = '';
      if (k === 'billedPerson' && v && !state.settings.users.some(function (u) { return u.email === v; })) el.insertAdjacentHTML('beforeend', opt(v, v, ''));
      el.value = v == null ? '' : (NUMF[k] ? String(v) : v); el.className = ''; var c = (inv.confidence || {})[k];
      if (c && c !== 'high') el.classList.add('c-' + c); else if (!c && ['vendor', 'number', 'issueDate', 'total'].indexOf(k) >= 0 && (v === '' || v == null)) el.classList.add('c-none', 'req');
    });
    if (inv.fromTemplate) Object.keys(inv.regions || {}).forEach(function (k) { markConf(k, 'template'); });
    $('d-reverse').checked = !!inv.reverseCharge; $('d-remember').checked = true;
    $('d-title').textContent = inv.vendor || inv.fileName; $('d-file').textContent = inv.fileName + ' · ' + Math.round(inv.size / 1024) + ' KB' + (inv.pages ? ' · ' + inv.pages + (inv.pages === 1 ? ' page' : ' pages') : '') + ' · added ' + fmtDate(inv.addedAt.slice(0, 10));
    var q = o.queue && state.queue.length > 1, pos = state.queue.indexOf(id);
    $('d-pos').textContent = q ? (pos + 1) + ' of ' + state.queue.length : ''; $('d-next').hidden = !(q && pos < state.queue.length - 1);
    $('d-ocr').hidden = false; $('d-ocr').textContent = inv.ocr ? 'Read with OCR again' : 'Read with OCR';
    var note = $('d-note'), dup = findDuplicates(inv); note.hidden = !dup && !(inv.confidence && inv.confidence.scanned && !inv.ocr);
    note.innerHTML = dup ? 'Possible duplicate of <b>' + esc(dup.other.vendor || dup.other.fileName) + ' ' + esc(dup.other.number) + '</b> (' + dup.level + '). <button class="link" type="button" id="d-cmp">Compare</button>' :
      (inv.confidence && inv.confidence.scanned && !inv.ocr ? 'No text was found in this file. It looks scanned: use "Read with OCR".' : '');
    var cmp = $('d-cmp'); if (cmp) cmp.onclick = function () { resolveDuplicate(inv, dup).then(function () { if (!getInv(id)) $('detail').close(); else openDetail(id, o); }); };
    if (!$('detail').open) $('detail').showModal();
    if (FM) { try { FM.onOpen(inv); } catch (e) { console.warn(e); } }
    if (FX) { try { FX.onOpen(inv); } catch (e) { console.warn(e); } }
  }
  function boolRate(t, v, n) { return t != null && n ? Math.round(v / n * 1000) / 10 : null; }
  function collectDetail() {
    var inv = state.cur.inv, o = {};
    Object.keys(D).forEach(function (k) { var v = $(D[k]).value; o[k] = NUMF[k] ? num(v) : (typeof v === 'string' ? v.trim() : v); });
    o.currency = (o.currency || 'EUR').toUpperCase(); o.iban = (o.iban || '').replace(/\s+/g, '').toUpperCase(); o.vendorTaxId = P.vatNorm(o.vendorTaxId);
    o.reverseCharge = $('d-reverse').checked;
    if (o.currency === 'EUR' && o.eur == null) o.eur = o.total;
    return o;
  }
  function learnRule(inv, remember) {
    if (!remember || !inv.vendor) return;
    var rule = { vendor: inv.vendor, category: inv.category, billedTo: inv.billedTo, billedPerson: inv.billedPerson };
    state.rules[inv.vendorTaxId ? 'id:' + inv.vendorTaxId : 'name:' + inv.vendor] = rule;
    if (inv.detectedVendor && inv.detectedVendor !== inv.vendor && !inv.vendorTaxId) state.rules['name:' + inv.detectedVendor] = rule;
  }
  async function saveDetail() {
    var c = state.cur; if (!c) return false; var inv = c.inv, o = collectDetail();
    if (!o.vendor) { toast('Please enter the vendor.'); $('d-vendor').focus(); return false; }
    if (o.total != null && o.net != null && o.vat != null && Math.abs(o.net + o.vat - o.total) > 0.02 && !(await ask('<p>Net + VAT (' + fmtMoney(o.net + o.vat, o.currency) + ') does not equal the total (' + fmtMoney(o.total, o.currency) + ').</p>', { title: 'Amounts do not add up', ok: 'Save anyway' }))) return false;
    Object.assign(inv, o); inv.status = 'ok'; inv.confidence = inv.confidence || {};
    if (inv.paid && !inv.paidDate) inv.paidDate = todayIso();
    learnRule(inv, $('d-remember').checked);
    if (FX) FX.beforeSave(inv);
    await saveInvoice(inv); await saveRules(); updateStorageLine(); render(); return true;
  }
  async function removeCurrent() {
    var c = state.cur; if (!c) return; if (!(await ask('<p>Delete <b>' + esc(c.inv.vendor || c.inv.fileName) + '</b> and its file? This cannot be undone.</p>', { title: 'Delete invoice', ok: 'Delete' }))) return;
    await deleteInvoice(c.id); closeDetail(); render(); updateStorageLine(); toast('Deleted');
  }
  function closeDetail() { if (FM) FM.onClose(); if (FX) FX.onClose(); state.cur = null; if ($('detail').open) $('detail').close(); }
  async function downloadFile(inv) {
    var b = await fileBlob(inv.id); if (!b) return toast('The file is not on this device.');
    var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = inv.fileName || ('invoice.' + inv.ext); document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  async function runOcr() {
    var c = state.cur; if (!c) return; var inv = c.inv, btn = $('d-ocr'), label = btn.textContent; btn.disabled = true;
    var prog = function (m) { if (m.status === 'recognizing text') btn.textContent = 'OCR ' + Math.round((m.progress || 0) * 100) + '%'; else btn.textContent = 'OCR: ' + (m.status || '…'); };
    try {
      var blob = await fileBlob(inv.id); if (!blob) throw new Error('The file is not on this device.');
      var items = [];
      if (/^image\//.test(inv.mime)) { var r = await M.ocr(blob, { onProgress: prog, langs: 'eng+slv+hrv' }); items = r.items; }
      else {
        var pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
        for (var p = 1; p <= Math.min(3, pdf.numPages); p++) {
          var page = await pdf.getPage(p), vp = page.getViewport({ scale: 2.2 }), cv = document.createElement('canvas'); cv.width = vp.width; cv.height = vp.height;
          await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
          var data = await M.recognize(cv, { langs: 'slv+eng', onProgress: prog });
          (data.words || []).forEach(function (w) { if (w.text && w.confidence >= 20) items.push({ s: w.text, x: w.bbox.x0 / cv.width, y: w.bbox.y0 / cv.height, w: (w.bbox.x1 - w.bbox.x0) / cv.width, h: (w.bbox.y1 - w.bbox.y0) / cv.height, p: p - 1 }); });
        }
      }
      applyOcrLines(inv, R.linesFromItems(items), items); toast('OCR done. Please check the fields.');
    } catch (e) { toast('OCR failed: ' + (e.message || e), 6000); }
    btn.disabled = false; btn.textContent = label;
  }
  function applyOcrLines(inv, lines, items) {
    var p = P.parseInvoice(lines, parseOpts()), o = collectDetail();
    inv.text = lines.join('\n').slice(0, 40000); inv.ocr = true; inv.ocrItems = compactItems(items); inv.confidence.scanned = false;
    ['vendor', 'vendorTaxId', 'number', 'issueDate', 'dueDate', 'serviceDate', 'total', 'vat', 'net', 'vatRate', 'iban', 'reference', 'poNumber', 'billedTo', 'billedPerson'].forEach(function (k) {
      if ((o[k] === '' || o[k] == null) && p[k] != null && p[k] !== '') { setField(k, p[k], 'medium'); }
    });
    if (!inv.vendor && p.category) setField('category', p.category);
    $('d-note').hidden = true; if (FM) FM.onItems(inv);
  }

  /* ---------- settings / csv / backup ---------- */
  function csvCell(v, sep) { v = v == null ? '' : String(v); return /["\n\r]/.test(v) || v.indexOf(sep) >= 0 ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function csvRows(list, sep) {
    var dec = sep === ',' ? '.' : ',', n = function (v) { return v == null ? '' : String(r2(v)).replace('.', dec); };
    var head = ['Date', 'Vendor', 'VAT ID', 'Number', 'Company', 'Person', 'Category', 'Currency', 'Net', 'VAT', 'VAT rate %', 'Total', 'Total EUR', 'Due', 'Status', 'Paid date', 'IBAN', 'Reference', 'Notes', 'File'];
    var rows = [head].concat(list.map(function (i) { return [i.issueDate, i.vendor, i.vendorTaxId, i.number, companyName(i.billedTo), personName(i.billedPerson), catName(i.category), i.currency, n(i.net), n(i.vat), n(i.vatRate), n(i.total), n(i.eur), i.dueDate, statusOf(i), i.paidDate, i.iban, i.reference, i.notes, i.fileName]; }));
    return '﻿' + rows.map(function (r) { return r.map(function (c) { return csvCell(c, sep); }).join(sep); }).join('\r\n');
  }
  function saveBlob(blob, name) { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500); }
  function exportCsv() { var sep = state.settings.exportSep || ';'; saveBlob(new Blob([csvRows(applyFilters(state.invoices), sep)], { type: 'text/csv;charset=utf-8' }), 'invoices-' + todayIso() + '.csv'); }
  async function exportBackup() {
    toast('Preparing backup…', 1500); var entries = [], skipped = 0;
    entries.push({ name: 'invoices.json', data: JSON.stringify({ app: 'adrial-invoices', version: 2, exportedAt: new Date().toISOString(), invoices: state.invoices, templates: state.templates, settings: state.settings, rules: state.rules }) });
    for (var i = 0; i < state.invoices.length; i++) { var inv = state.invoices[i], b = await fileBlob(inv.id); if (b) entries.push({ name: 'files/' + inv.id + '.' + inv.ext, data: b }); else skipped++; }
    saveBlob(await Z.build(entries), 'invoices-backup-' + todayIso() + '.zip'); toast('Backup saved' + (skipped ? ' (' + skipped + ' files missing)' : ''));
  }
  async function restoreBackup(file) {
    var entries = await Z.read(await file.arrayBuffer()), js = entries.find(function (e) { return e.name === 'invoices.json'; });
    if (!js) throw new Error('This ZIP is not an Invoices backup.');
    var data = JSON.parse(Z.text(js)), added = 0, byHash = {}; state.invoices.forEach(function (i) { if (i.hash && !/^size-/.test(i.hash)) byHash[i.hash] = 1; });
    for (var k = 0; k < (data.invoices || []).length; k++) {
      var inv = cleanInvoice(data.invoices[k]); if (getInv(inv.id) || (inv.hash && byHash[inv.hash])) continue;
      var fe = entries.find(function (e) { return e.name.indexOf('files/' + inv.id + '.') === 0; });
      if (fe) await putFile(inv, new Blob([fe.data], { type: inv.mime }));
      await saveInvoice(inv); added++;
    }
    Object.keys(data.rules || {}).forEach(function (r) { if (!state.rules[r]) state.rules[r] = data.rules[r]; }); await saveRules();
    for (var t = 0; t < (data.templates || []).length; t++) if (!state.templates.some(function (x) { return x.id === data.templates[t].id; })) { state.templates.push(data.templates[t]); await idb.put('templates', data.templates[t]); }
    var s = data.settings || {}, cur = state.settings;
    (s.categories || []).forEach(function (c) { if (!cur.categories.some(function (x) { return x.id === c.id; })) cur.categories.push(c); });
    (s.companies || []).forEach(function (c) { if (!cur.companies.some(function (x) { return x.id === c.id; })) cur.companies.push(c); });
    (s.users || []).forEach(function (u) { if (!cur.users.some(function (x) { return x.email === u.email; })) cur.users.push(u); });
    await saveSettings(); render(); toast('Restored ' + added + ' invoices from the backup.');
  }
  function rowHtml(vals, ph, kind) {
    return '<div class="row-edit" data-kind="' + kind + '">' + vals.map(function (v, i) { return '<input value="' + esc(v) + '" placeholder="' + esc(ph[i] || '') + '" aria-label="' + esc(ph[i] || '') + '">'; }).join('') + '<button type="button" class="danger" data-rm aria-label="Remove">×</button></div>';
  }
  function openSettings() {
    var s = state.settings;
    $('s-companies').innerHTML = s.companies.map(function (c) { return rowHtml([c.name, c.vatId, (c.aliases || []).concat(c.ibans || []).join(', ')], ['Name', 'VAT ID (SI12345678)', 'Other names, IBANs'], 'company').replace('data-kind="company"', 'data-kind="company" data-id="' + esc(c.id) + '"'); }).join('');
    $('s-users').innerHTML = s.users.map(function (u) { return rowHtml([u.name, u.email], ['Name', 'E-mail'], 'user'); }).join('');
    $('s-cats').innerHTML = s.categories.map(function (c) { return rowHtml([c.name], ['Category name'], 'cat').replace('data-kind="cat"', 'data-kind="cat" data-id="' + esc(c.id) + '"'); }).join('');
    $('s-remind').value = s.remindDays; $('s-notify').checked = !!s.notify;
    var rk = Object.keys(state.rules);
    $('s-rules').innerHTML = rk.length ? rk.map(function (k) { return '<div>' + esc(k) + ' → ' + esc(state.rules[k].vendor || '') + ' / ' + esc(catName(state.rules[k].category)) + ' <button class="link danger" type="button" data-rule="' + esc(k) + '">forget</button></div>'; }).join('') : '<span class="muted">None yet. Saving an invoice with "Remember vendor settings" creates one.</span>';
    updateStorageLine($('s-storage')); if (sync && sync.mountPanel) sync.mountPanel($('sync-panel'));
    $('settings').showModal();
  }
  async function saveSettingsDialog() {
    var s = state.settings, rows = function (k) { return Array.prototype.map.call($('settings').querySelectorAll('.row-edit[data-kind="' + k + '"]'), function (r) { return { id: r.dataset.id, v: Array.prototype.map.call(r.querySelectorAll('input'), function (i) { return i.value.trim(); }) }; }); };
    s.companies = rows('company').filter(function (r) { return r.v[0]; }).map(function (r) {
      var extra = r.v[2].split(',').map(function (x) { return x.trim(); }).filter(Boolean);
      return { id: r.id || uid('co'), name: r.v[0], vatId: P.vatNorm(r.v[1]), aliases: extra.filter(function (x) { return !P.ibanValid(x); }), ibans: extra.filter(P.ibanValid).map(function (x) { return x.replace(/\s+/g, '').toUpperCase(); }) };
    });
    s.users = rows('user').filter(function (r) { return r.v[1]; }).map(function (r) { return { name: r.v[0], email: r.v[1].toLowerCase() }; });
    s.categories = rows('cat').filter(function (r) { return r.v[0]; }).map(function (r) { return { id: r.id || (P.normName(r.v[0]).replace(/\s+/g, '-') || uid('cat')), name: r.v[0] }; });
    if (!s.categories.length) s.categories = clone(P.DEFAULT_CATEGORIES);
    s.remindDays = Math.max(0, Math.min(60, parseInt($('s-remind').value, 10) || 0)); s.notify = $('s-notify').checked;
    if (s.notify && window.Notification && Notification.permission === 'default') { try { await Notification.requestPermission(); } catch (e) {} }
    await saveSettings(); $('settings').close(); render(); toast('Settings saved');
  }
  async function wipeAll() {
    if (!(await ask('<p>Delete <b>all</b> invoices, files, templates, rules and settings from this browser? This cannot be undone.</p>', { title: 'Delete everything', ok: 'Delete everything' }))) return;
    await idb.clear(['invoices', 'files', 'kv', 'templates']); memFiles = {}; state.invoices = []; state.templates = []; state.rules = {}; state.settings = mergeSettings(); state.sel.clear();
    $('settings').close(); closeDetail(); render(); updateStorageLine(); toast('All data deleted');
  }
  async function updateStorageLine(el) {
    el = el || $('storage-line'); var t = 'Files stay in this browser.';
    try { if (navigator.storage && navigator.storage.estimate) { var e = await navigator.storage.estimate(); t += ' Using ' + (e.usage / 1048576).toFixed(1) + ' MB' + (e.quota ? ' of ' + Math.round(e.quota / 1048576) + ' MB' : '') + '.'; } } catch (e) {}
    el.textContent = memOnly ? 'Browser storage is not available: invoices are kept only until you close this page.' : t;
  }
  async function migrateFileHashes() {
    if (memOnly) return;
    for (var i = 0; i < state.invoices.length; i++) {
      var inv = state.invoices[i]; if (inv.hash) continue;
      var f = await idb.get('files', inv.id); if (!f || !f.blob) continue;
      inv.hash = await sha256(await f.blob.arrayBuffer()); inv.mime = inv.mime || f.blob.type; inv.ext = inv.ext || extOf(inv.fileName, 'pdf'); await saveInvoice(inv);
      f.hash = inv.hash; f.type = inv.mime; await idb.put('files', f);
    }
  }

  /* ---------- sync ---------- */
  function snapshot() {
    return Promise.resolve({ invoices: state.invoices.map(function (i) { return Object.assign({}, i, { text: (i.text || '').slice(0, 20000), ocrItems: null }); }), templates: state.templates, settings: state.settings, rules: state.rules });
  }
  async function applySnapshot(s) {
    if (!s) return; await idb.clear(['invoices', 'kv', 'templates']);
    for (var i = 0; i < (s.invoices || []).length; i++) await idb.put('invoices', cleanInvoice(s.invoices[i]));
    for (var t = 0; t < (s.templates || []).length; t++) await idb.put('templates', s.templates[t]);
    await idb.put('kv', { key: 'settings', value: s.settings || {} }); await idb.put('kv', { key: 'rules', value: s.rules || {} });
    await loadState(); render();
  }
  var syncFiles = {
    max: 20 * 1048576,
    list: function () { return Promise.resolve(state.invoices.filter(function (i) { return i.hash && !/^size-/.test(i.hash) && i.size <= 20 * 1048576; }).map(function (i) { return { hash: i.hash, id: i.id, size: i.size, type: i.mime }; })); },
    get: function (hash) { var inv = state.invoices.find(function (i) { return i.hash === hash; }); return inv ? fileBlob(inv.id) : Promise.resolve(null); },
    put: async function (hash, blob) { var inv = state.invoices.find(function (i) { return i.hash === hash; }); if (inv) await putFile(inv, blob); }
  };
  function attachSync() {
    if (!window.AdrialSync || !AdrialSync.attach) return;
    try { sync = AdrialSync.attach({ app: 'invoices', label: 'Invoices', getSnapshot: snapshot, applySnapshot: applySnapshot, files: syncFiles }); } catch (e) { sync = null; }
  }

  /* ---------- events ---------- */
  function bind() {
    $('add-btn').onclick = $('empty-add').onclick = function () { $('file-input').click(); };
    $('camera-btn').onclick = function () { $('camera-input').click(); };
    $('file-input').onchange = $('camera-input').onchange = function (e) { importFiles(e.target.files); e.target.value = ''; };
    $('export-csv').onclick = exportCsv; $('set-btn').onclick = openSettings;
    $('tpl-btn').onclick = function () { FM ? FM.openTemplates() : toast('Templates are not available.'); };
    $('acct-btn').onclick = function () { FX ? FX.openAccountant() : toast('Not available.'); };
    $('review-btn').onclick = function () { state.queue = state.invoices.filter(function (i) { return i.status === 'review'; }).sort(function (a, b) { return a.addedAt < b.addedAt ? -1 : 1; }).map(function (i) { return i.id; }); if (state.queue.length) openDetail(state.queue[0], { queue: true }); };
    $('due-btn').onclick = function () { state.filters.status = 'due'; state.filters.year = ''; state.filters.month = ''; saveUi(); render(); $('tbl').scrollIntoView({ behavior: 'smooth' }); };
    var fm = { 'f-year': 'year', 'f-month': 'month', 'f-cat': 'cat', 'f-status': 'status', 'f-company': 'company', 'f-person': 'person' };
    Object.keys(fm).forEach(function (id) { $(id).onchange = function () { state.filters[fm[id]] = this.value; saveUi(); render(); }; });
    var qt = null; $('f-q').oninput = function () { var v = this.value; clearTimeout(qt); qt = setTimeout(function () { state.filters.q = v; saveUi(); render(); $('f-q').focus(); }, 200); };
    $('f-clear').onclick = function () { state.filters = { year: '', month: '', cat: '', status: '', company: '', person: '', q: '' }; saveUi(); render(); };
    document.addEventListener('click', function (e) {
      var br = e.target.closest('.bar-row'); if (br) { var k = br.dataset.f, v = br.dataset.v; state.filters[k] = state.filters[k] === v ? '' : v; saveUi(); render(); return; }
      var rc = e.target.closest('rect[data-m]'); if (rc) { var m = rc.dataset.m; state.filters.year = m.slice(0, 4); state.filters.month = state.filters.month === m.slice(5) ? '' : m.slice(5); saveUi(); render(); return; }
      var th = e.target.closest('th[data-sort]'); if (th) { var key = th.dataset.sort; state.sort = { key: key, dir: state.sort.key === key ? -state.sort.dir : (key === 'total' || key === 'issueDate' || key === 'dueDate' ? -1 : 1) }; saveUi(); renderTable(applyFilters(state.invoices)); return; }
      var cb = e.target.closest('input.sel'); if (cb) { cb.checked ? state.sel.add(cb.dataset.id) : state.sel.delete(cb.dataset.id); renderBulk(); return; }
      if (e.target.id === 'sel-all') { var list = applyFilters(state.invoices); e.target.checked ? list.forEach(function (i) { state.sel.add(i.id); }) : state.sel.clear(); renderTable(list); renderBulk(); return; }
      var tr = e.target.closest('#tbl tbody tr[data-id]'); if (tr && !e.target.closest('input')) { state.queue = []; openDetail(tr.dataset.id); }
    });
    $('tbl').addEventListener('keydown', function (e) { if (e.key === 'Enter') { var tr = e.target.closest('tr[data-id]'); if (tr) openDetail(tr.dataset.id); } });
    $('bulk').addEventListener('change', async function (e) {
      var ids = Array.from(state.sel), key = e.target.id === 'b-company' ? 'billedTo' : e.target.id === 'b-person' ? 'billedPerson' : null; if (!key || !e.target.value) return;
      for (var i = 0; i < ids.length; i++) { var inv = getInv(ids[i]); if (inv) { inv[key] = e.target.value; await saveInvoice(inv); } } toast('Updated ' + ids.length); render();
    });
    $('bulk').addEventListener('click', async function (e) {
      var id = e.target.id, ids = Array.from(state.sel);
      if (id === 'b-clear') { state.sel.clear(); render(); }
      else if (id === 'b-paid' || id === 'b-unpaid') { for (var i = 0; i < ids.length; i++) { var inv = getInv(ids[i]); if (!inv) continue; if (id === 'b-paid') { inv.paid = true; inv.paidDate = inv.paidDate || todayIso(); } else { inv.paid = false; inv.paidDate = ''; inv.payments = []; } await saveInvoice(inv); } render(); }
      else if (id === 'b-del' && await ask('<p>Delete ' + ids.length + ' invoices and their files?</p>', { title: 'Delete', ok: 'Delete' })) { for (var j = 0; j < ids.length; j++) await deleteInvoice(ids[j]); render(); updateStorageLine(); }
    });
    // drop
    var depth = 0;
    window.addEventListener('dragenter', function (e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0) { depth++; $('drop-overlay').classList.add('on'); } });
    window.addEventListener('dragleave', function () { depth = Math.max(0, depth - 1); if (!depth) $('drop-overlay').classList.remove('on'); });
    window.addEventListener('dragover', function (e) { e.preventDefault(); });
    window.addEventListener('drop', function (e) { e.preventDefault(); depth = 0; $('drop-overlay').classList.remove('on'); if (e.dataTransfer && e.dataTransfer.files.length) importFiles(e.dataTransfer.files); });
    // detail
    $('d-close').onclick = closeDetail; $('detail').addEventListener('cancel', function (e) { e.preventDefault(); closeDetail(); }); $('detail').addEventListener('close', function () { if (state.cur) { if (FM) FM.onClose(); if (FX) FX.onClose(); state.cur = null; } });
    $('d-save').onclick = async function () { if (await saveDetail()) { toast('Saved'); closeDetail(); } };
    $('d-next').onclick = async function () { var id = state.cur.id; if (await saveDetail()) { var k = state.queue.indexOf(id); var nx = state.queue[k + 1]; if (nx && getInv(nx)) openDetail(nx, { queue: true }); else closeDetail(); } };
    $('d-delete').onclick = removeCurrent; $('d-download').onclick = function () { state.cur && downloadFile(state.cur.inv); }; $('d-ocr').onclick = runOcr;
    var recalc = function (e) {
      var id = e.target.id; if (['d-total', 'd-vat', 'd-net', 'd-currency'].indexOf(id) < 0) return;
      var t = num($('d-total').value), v = num($('d-vat').value), n = num($('d-net').value);
      if (id === 'd-total' || id === 'd-vat') { if (t != null && v != null && (id === 'd-vat' || n == null || Math.abs(n + v - t) > 0.02)) { n = r2(t - v); $('d-net').value = n; } }
      else if (id === 'd-net' && n != null && v != null && t == null) $('d-total').value = r2(n + v);
      t = num($('d-total').value); v = num($('d-vat').value); n = num($('d-net').value);
      if (n && v != null && id !== 'd-currency') $('d-rate').value = P.snapRate(v / n * 100);
      if (($('d-currency').value || 'EUR').toUpperCase() === 'EUR' && (id === 'd-total' || id === 'd-currency')) $('d-eur').value = t == null ? '' : t;
      if (FX && state.cur) FX.onAmountChange();
    };
    $('detail').addEventListener('input', function (e) { if (e.target.matches('input,select,textarea')) { e.target.classList.remove('c-low', 'c-none', 'c-medium'); if (state.cur) state.cur.dirty = true; } recalc(e); });
    // settings
    document.addEventListener('click', function (e) { var c = e.target.closest('[data-close]'); if (c) c.closest('dialog').close(); });
    $('s-add-company').onclick = function () { $('s-companies').insertAdjacentHTML('beforeend', rowHtml(['', '', ''], ['Name', 'VAT ID (SI12345678)', 'Other names, IBANs'], 'company')); };
    $('s-add-user').onclick = function () { $('s-users').insertAdjacentHTML('beforeend', rowHtml(['', ''], ['Name', 'E-mail'], 'user')); };
    $('s-add-cat').onclick = function () { $('s-cats').insertAdjacentHTML('beforeend', rowHtml([''], ['Category name'], 'cat')); };
    $('settings').addEventListener('click', function (e) {
      if (e.target.matches('[data-rm]')) e.target.closest('.row-edit').remove();
      var r = e.target.getAttribute && e.target.getAttribute('data-rule'); if (r) { delete state.rules[r]; saveRules(); e.target.closest('div').remove(); }
    });
    $('s-save').onclick = saveSettingsDialog; $('s-backup').onclick = exportBackup; $('s-restore').onclick = function () { $('s-restore-file').click(); };
    $('s-restore-file').onchange = async function (e) { var f = e.target.files[0]; e.target.value = ''; if (f) { try { await restoreBackup(f); } catch (x) { toast(x.message, 6000); } } };
    $('s-wipe').onclick = wipeAll; $('s-ics').onclick = function () { FX && FX.exportIcs(); };
    window.addEventListener('keydown', function (e) { if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && !document.querySelector('dialog[open]')) { e.preventDefault(); $('f-q').focus(); } });
  }

  /* ---------- start ---------- */
  async function start() {
    core = {
      state: state, idb: idb, toast: toast, esc: esc, ask: ask, $: $, fmtMoney: fmtMoney, fmtDate: fmtDate, todayIso: todayIso, addDays: addDays, daysBetween: daysBetween, num: num, r2: r2, uid: uid,
      openDetail: openDetail, saveInvoice: saveInvoice, getInv: getInv, fileBlob: fileBlob, render: render, setField: setField, markConf: markConf, collectDetail: collectDetail, parseOpts: parseOpts,
      catName: catName, companyName: companyName, personName: personName, statusOf: statusOf, openAmount: openAmount, isPaid: isPaid, isDue: isDue, toEur: toEur, paidSum: paidSum, saveBlob: saveBlob, csvRows: csvRows,
      applyFilters: applyFilters, extractPdf: extractPdf, compactItems: compactItems, applyOcrLines: applyOcrLines, sha256: sha256, saveTemplate: function (t) { var k = state.templates.findIndex(function (x) { return x.id === t.id; }); if (k >= 0) state.templates[k] = t; else state.templates.push(t); return idb.put('templates', t); },
      deleteTemplate: function (id) { state.templates = state.templates.filter(function (x) { return x.id !== id; }); return idb.del('templates', id); }, saveInvoiceDraftFlag: function () { if (state.cur) state.cur.dirty = true; },
      get settings() { return state.settings; }, get cur() { return state.cur; }
    };
    try { FM = window.InvoiceFieldMap ? window.InvoiceFieldMap.init(core) : null; } catch (e) { console.warn('fieldmap', e); FM = null; }
    try { FX = window.InvoiceFeatures ? window.InvoiceFeatures.init(core) : null; } catch (e) { console.warn('features', e); FX = null; }
    bind(); loadUi();
    try { db = await openDb(); } catch (e) { memOnly = true; console.warn(e); }
    try { await loadState(); } catch (e) { console.error(e); }
    if (!state.filters.year) { /* keep "all years" by default; a saved choice wins */ }
    if (state.filters.year && !state.invoices.some(function (i) { return yearOf(i) === state.filters.year; })) state.filters.year = '';
    render(); updateStorageLine(); migrateFileHashes().catch(function () {}); attachSync();
    if (FX) { FX.maybeNotify(); setInterval(function () { FX.maybeNotify(); }, 3600 * 1000); }
    window.__invoicesApp = { state: state, importFiles: importFiles, parseText: function (t) { return P.parseInvoice(String(t).split(/\r?\n/), parseOpts()); }, core: core };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
