/* Adrial Apps · Desk — Outlook e-mails become tasks for the business secretary; booking links and
 * confirmation PDFs are attached to each task so it is always clear what is done and what is left.
 *
 * Everything is stored in this browser (IndexedDB "adrial-desk"; files content-addressed by
 * sha256). The only thing that ever leaves the browser is the person's own private cloud copy via
 * /_shared/adrial-sync.js when she signs in. Booking URLs are never fetched: they only open in a
 * new tab. Mail HTML is shown only in a sandboxed iframe without scripts, remote images blocked.
 * All mail/PDF text goes into the page through textContent (h()), never innerHTML.
 */
(function () {
  'use strict';

  var X = window.DeskExtract, MSG = window.DeskMsg, EML = window.DeskEml;
  var FX = null; // window.DeskFeatures, initialised in start()

  var DB_NAME = 'adrial-desk', UI_KEY = 'adrial-desk-ui', CHANNEL = 'adrial-desk';
  var TZ = 'Europe/Ljubljana';
  var PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  var PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  var SNAPSHOT_TEXT_CAP = 50000;
  var MAX_SYNC_FILE = 20 * 1024 * 1024;

  var STATUSES = [
    { k: 'todo', l: 'To do', c: '' },
    { k: 'doing', l: 'In progress', c: 'blue' },
    { k: 'waiting', l: 'Waiting on someone', c: 'clay' },
    { k: 'done', l: 'Done', c: 'ok' }
  ];
  var PRIORITIES = [{ k: 'high', l: 'High' }, { k: 'normal', l: 'Normal' }, { k: 'low', l: 'Low' }];
  var VIEWS = [
    { k: 'today', l: 'Today & overdue' }, { k: 'upcoming', l: 'Upcoming' }, { k: 'waiting', l: 'Waiting' },
    { k: 'done', l: 'Done' }, { k: 'all', l: 'All' }, { k: 'board', l: 'Board' }, { k: 'calendar', l: 'Calendar' }
  ];

  var state = { tasks: [], mails: {}, settings: {}, view: 'today', query: '', who: '', selected: {}, calMonth: null, calDay: null, openId: null };
  var sync = null, applying = false, bc = null;

  // ---------- small helpers ----------

  function $(id) { return document.getElementById(id); }
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'svg') el.appendChild(icon(v));
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    });
    append(el, kids);
    return el;
  }
  function append(el, kids) {
    if (kids == null) return el;
    (Array.isArray(kids) ? kids : [kids]).forEach(function (c) {
      if (c == null || c === false) return;
      if (Array.isArray(c)) append(el, c);
      else el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
    return el;
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

  var ICONS = {
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
    clip: '<path d="M20 11.5l-7.8 7.8a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8"/>',
    circle: '<circle cx="12" cy="12" r="8.5"/>',
    checkc: '<circle cx="12" cy="12" r="8.5" fill="currentColor" stroke="none" opacity=".16"/><circle cx="12" cy="12" r="8.5"/><path d="M8.2 12.3l2.6 2.6 5-5.4" stroke-width="2"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
    image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M20.5 16l-5-5-8 8.5"/>',
    hotel: '<path d="M3 18v-8M3 14h18v4M21 18v-4a3 3 0 0 0-3-3h-7v3"/><circle cx="7" cy="11.5" r="1.8"/>',
    stay: '<path d="M4 11l8-6.5 8 6.5"/><path d="M6 9.5V19h12V9.5"/><path d="M10 19v-5h4v5"/>',
    flight: '<path d="M10.5 13.5L4 11l1.2-1.2 7.3.8 4.3-4.3a1.6 1.6 0 0 1 2.3 2.3l-4.3 4.3.8 7.3L14.4 21l-2.5-6.5-3.4 3.4.3 2-1 1-1.4-2.7-2.7-1.4 1-1 2 .3z"/>',
    train: '<rect x="6" y="3.5" width="12" height="13" rx="3"/><path d="M6 10.5h12M9 20l1.5-3.5M15 20l-1.5-3.5"/><circle cx="9.5" cy="13.5" r=".6"/><circle cx="14.5" cy="13.5" r=".6"/>',
    bus: '<rect x="5" y="3.5" width="14" height="14" rx="2.5"/><path d="M5 10.5h14M8 17.5V20M16 17.5V20"/><circle cx="8.5" cy="14" r=".6"/><circle cx="15.5" cy="14" r=".6"/>',
    car: '<path d="M5 16.5v2M19 16.5v2M4 16.5h16v-4l-2-5H6l-2 5z"/><path d="M4 12.5h16"/><circle cx="7.5" cy="14.5" r=".6"/><circle cx="16.5" cy="14.5" r=".6"/>',
    event: '<path d="M4 8.5a1.5 1.5 0 0 0 0 3v4.5h16v-4.5a1.5 1.5 0 0 1 0-3V4H4z" transform="translate(0 2)"/><path d="M14 6v14" stroke-dasharray="2 2"/>',
    ferry: '<path d="M3 17c2 1.5 4 1.5 6 0s4-1.5 6 0 4 1.5 6 0"/><path d="M5 14l1-5h12l1 5"/><path d="M9 9V6h6v3"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    left: '<path d="m14.5 6-6 6 6 6"/>', right: '<path d="m9.5 6 6 6-6 6"/>',
    ext: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
    download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14"/>',
    user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
    list: '<path d="M9 7h11M9 12h11M9 17h11"/><path d="M4 7l1 1 2-2M4 12l1 1 2-2M4 17l1 1 2-2"/>',
    cal: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
    edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    shield: '<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><path d="M9 12l2 2 4-4"/>',
    flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>'
  };
  function icon(name, cls) {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('aria-hidden', 'true');
    s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.8');
    s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
    if (cls) s.setAttribute('class', cls);
    s.innerHTML = ICONS[name] || ICONS.link;
    return s;
  }

  function uid() { return window.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
  function nowIso() { return new Date().toISOString(); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function norm(s) { return X.norm(s); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  var isoParts = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  function isoOf(d) {
    var p = {};
    isoParts.formatToParts(d instanceof Date ? d : new Date(d)).forEach(function (x) { p[x.type] = x.value; });
    return p.year + '-' + p.month + '-' + p.day;
  }
  function todayIso() { return isoOf(new Date()); }
  function addDays(iso, n) { return X.addDays(iso, n); }
  function fmtDate(iso) {
    if (!iso) return '';
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    return m ? m[3] + '. ' + m[2] + '. ' + m[1] : iso;
  }
  var WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function weekdayOf(iso) { return WD[new Date(iso + 'T00:00:00Z').getUTCDay()]; }
  function fmtDateWd(iso) { return iso ? weekdayOf(iso) + ', ' + fmtDate(iso) : ''; }
  var tFmt = new Intl.DateTimeFormat('sl-SI', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  function fmtDateTime(ts) { if (!ts) return ''; var d = new Date(ts); return isNaN(d) ? String(ts) : fmtDate(isoOf(d)) + ', ' + tFmt.format(d); }
  function fmtTime(ts) { var d = new Date(ts); return isNaN(d) ? '' : tFmt.format(d); }
  function dueLabel(iso) {
    var t = todayIso();
    if (iso === t) return 'Today';
    if (iso === addDays(t, 1)) return 'Tomorrow';
    if (iso === addDays(t, -1)) return 'Yesterday';
    return fmtDateWd(iso);
  }
  function fmtRange(a, b) { if (!a) return ''; if (!b || b === a) return fmtDate(a); return fmtDate(a) + ' – ' + fmtDate(b); }
  function money(v, cur) {
    if (v == null || isNaN(v)) return '';
    try { return new Intl.NumberFormat('sl-SI', { style: 'currency', currency: cur || 'EUR' }).format(v); } catch (e) { return v.toFixed(2).replace('.', ',') + ' ' + (cur || ''); }
  }
  function fileSize(n) { if (n == null) return ''; if (n < 1024) return n + ' B'; if (n < 1048576) return Math.round(n / 1024) + ' KB'; return (n / 1048576).toFixed(1).replace('.', ',') + ' MB'; }
  function statusOf(k) { return STATUSES.find(function (s) { return s.k === k; }) || STATUSES[0]; }
  function personLabel(a) { return a ? (a.name || a.address || '') : ''; }
  function personFull(a) { if (!a) return ''; return a.name && a.address ? a.name + ' <' + a.address + '>' : (a.name || a.address || ''); }

  async function sha256(blob) {
    var buf = await blob.arrayBuffer();
    var d = await crypto.subtle.digest('SHA-256', buf);
    return Array.prototype.map.call(new Uint8Array(d), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  }

  // ---------- toasts and the ask() dialog ----------

  function toast(msg, opts) {
    opts = opts || {};
    var el = h('div', { class: 'toast' + (opts.error ? ' err' : ''), role: opts.error ? 'alert' : 'status' }, [
      opts.busy ? h('span', { class: 'spin', 'aria-hidden': 'true' }) : null,
      h('p', { text: msg }),
      opts.action ? h('button', { type: 'button', text: opts.action, onclick: function () { el.remove(); opts.onAction(); } }) : null,
      h('button', { type: 'button', 'aria-label': 'Dismiss', text: '×', onclick: function () { el.remove(); } })
    ]);
    $('toasts').appendChild(el);
    if (!opts.busy) setTimeout(function () { el.remove(); }, opts.ms || (opts.error ? 9000 : 5000));
    return el;
  }
  function errMsg(e) { return (e && e.message) || String(e); }

  var askQueue = Promise.resolve();
  function ask(o) {
    var run = function () {
      return new Promise(function (resolve) {
        var d = $('ask');
        $('ask-title').textContent = o.title || '';
        $('ask-text').textContent = o.text || '';
        var row = clear($('ask-btns'));
        row.appendChild(h('span', { class: 'spacer' }));
        var done = false;
        function finish(v) { if (done) return; done = true; d.removeEventListener('close', onClose); if (d.open) d.close(); resolve(v); }
        function onClose() { finish(null); }
        (o.buttons || [{ v: 'ok', label: 'OK', primary: true }]).forEach(function (b) {
          row.appendChild(h('button', { type: 'button', class: 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : ''), 'data-v': b.v, text: b.label, onclick: function () { finish(b.v); } }));
        });
        d.addEventListener('close', onClose);
        d.showModal();
        var pri = row.querySelector('.primary') || row.querySelector('button');
        if (pri) pri.focus();
      });
    };
    var p = askQueue.then(run, run);
    askQueue = p.catch(function () {});
    return p;
  }

  // ---------- storage (IndexedDB) ----------

  var dbPromise = null;
  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!window.indexedDB) { reject(new Error('IndexedDB unavailable')); return; }
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains('tasks')) db.createObjectStore('tasks', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('mails')) db.createObjectStore('mails', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'hash' });
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'key' });
      };
      req.onsuccess = function () {
        var db = req.result;
        // another tab upgrading or someone deleting the database: let go of it
        db.onversionchange = function () { db.close(); dbPromise = null; };
        db.onclose = function () { dbPromise = null; };
        resolve(db);
      };
      req.onerror = function () { dbPromise = null; reject(req.error); };
      req.onblocked = function () { dbPromise = null; reject(new Error('Storage is blocked by another tab')); };
    });
    return dbPromise;
  }
  function tx(store, mode, fn) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(store, mode), result;
        var r = fn(t.objectStore(store));
        if (r && 'onsuccess' in r) r.onsuccess = function () { result = r.result; };
        t.oncomplete = function () { resolve(result); };
        t.onerror = t.onabort = function () { reject(t.error || new Error('Storage error')); };
      });
    });
  }
  var idb = {
    all: function (s) { return tx(s, 'readonly', function (os) { return os.getAll(); }); },
    keys: function (s) { return tx(s, 'readonly', function (os) { return os.getAllKeys(); }); },
    get: function (s, k) { return tx(s, 'readonly', function (os) { return os.get(k); }); },
    put: function (s, v) { return tx(s, 'readwrite', function (os) { return os.put(v); }); },
    del: function (s, k) { return tx(s, 'readwrite', function (os) { return os.delete(k); }); },
    clear: function (s) { return tx(s, 'readwrite', function (os) { return os.clear(); }); }
  };

  // every saved change goes to the other tabs and (when signed in) to the cloud copy
  function changed() {
    if (applying) return;
    if (sync) { try { sync.changed(); } catch (e) { console.error(e); } }
    if (bc) { try { bc.postMessage({ type: 'changed' }); } catch (e) {} }
  }
  async function saveTask(t, quiet) {
    t.updatedAt = nowIso();
    await idb.put('tasks', t);
    if (!state.tasks.some(function (x) { return x.id === t.id; })) state.tasks.push(t);
    if (!quiet) changed();
  }
  async function saveMail(m) { await idb.put('mails', m); state.mails[m.id] = m; }
  async function saveSettings() { await idb.put('kv', { key: 'settings', value: state.settings }); changed(); }

  var pending = {};
  function queueSave(t, ms) {
    clearTimeout(pending[t.id]);
    pending[t.id] = setTimeout(function () { delete pending[t.id]; saveTask(t).then(renderMain).catch(fail); }, ms == null ? 350 : ms);
  }
  function flushSaves() {
    return Promise.all(Object.keys(pending).map(function (id) {
      clearTimeout(pending[id]); delete pending[id];
      var t = taskById(id);
      return t ? saveTask(t) : null;
    }));
  }

  async function loadState() {
    var r = await Promise.all([idb.all('tasks'), idb.all('mails'), idb.get('kv', 'settings')]);
    state.tasks = (r[0] || []).map(cleanTask);
    state.mails = {};
    (r[1] || []).forEach(function (m) { state.mails[m.id] = m; });
    state.settings = r[2] && r[2].value && typeof r[2].value === 'object' ? r[2].value : {};
  }
  function cleanTask(t) {
    return Object.assign({ title: '', status: 'todo', due: null, priority: 'normal', notes: '', checklist: [], tags: [], forWhom: '', mailId: null, dueSuggestions: [], confirmations: [], confirmed: false, createdAt: nowIso(), updatedAt: nowIso(), doneAt: null }, t);
  }

  // ---------- files (content-addressed) ----------

  async function putFile(data, name, type) {
    var blob = data instanceof Blob ? data : new Blob([data], { type: type || 'application/octet-stream' });
    type = type || blob.type || 'application/octet-stream';
    var hash = await sha256(blob);
    var ex = await idb.get('files', hash);
    if (!ex || !ex.blob) await idb.put('files', { hash: hash, blob: new Blob([blob], { type: type }), type: type, name: name || '', size: blob.size, addedAt: nowIso() });
    return { hash: hash, name: name || '', type: type, size: blob.size };
  }
  async function getBlob(hash, onStatus) {
    var r = await idb.get('files', hash);
    if (r && r.blob) return r.blob;
    if (sync && window.AdrialSync && AdrialSync.user()) {
      if (onStatus) onStatus();
      try { return await sync.fetchFile(hash); } catch (e) { throw new Error('This file is not in this browser or in your cloud copy.'); }
    }
    throw new Error('This file is not stored in this browser.' + (window.AdrialSync && AdrialSync.enabled() && !AdrialSync.user() ? ' Sign in to get it from your cloud copy.' : ''));
  }
  function referencedFiles() {
    var refs = {};
    Object.keys(state.mails).forEach(function (id) {
      var m = state.mails[id];
      if (m.htmlHash) refs[m.htmlHash] = { name: 'message.html', type: 'text/html' };
      (m.attachments || []).forEach(function (a) { if (a.hash) refs[a.hash] = { name: a.name, type: a.type }; });
    });
    state.tasks.forEach(function (t) { (t.confirmations || []).forEach(function (c) { if (c.fileHash) refs[c.fileHash] = { name: c.fileName, type: c.fileType }; }); });
    return refs;
  }
  async function gcFiles() {
    var refs = referencedFiles(), keys = await idb.keys('files');
    for (var i = 0; i < keys.length; i++) if (!refs[keys[i]]) await idb.del('files', keys[i]);
  }
  var urls = [];
  function blobUrl(blob) { var u = URL.createObjectURL(blob); urls.push(u); setTimeout(function () { URL.revokeObjectURL(u); }, 120000); return u; }
  async function openFile(hash, name, download) {
    var note = null;
    try {
      var blob = await getBlob(hash, function () { note = toast('Getting the file from your cloud copy…', { busy: true }); });
      if (note) note.remove();
      var a = h('a', { href: blobUrl(blob), target: '_blank', rel: 'noopener noreferrer' });
      if (download || !/^(application\/pdf|image\/|text\/plain)/.test(blob.type)) a.setAttribute('download', name || 'file');
      document.body.appendChild(a); a.click(); a.remove();
    } catch (e) { if (note) note.remove(); toast(errMsg(e), { error: true }); }
  }

  // ---------- tasks ----------

  function taskById(id) { return state.tasks.find(function (t) { return t.id === id; }) || null; }
  function newTask(f) { return cleanTask(Object.assign({ id: uid(), createdAt: nowIso(), updatedAt: nowIso() }, f || {})); }
  function openItems(t) { return (t.checklist || []).filter(function (c) { return !c.done; }).length; }
  function isOpen(t) { return t.status !== 'done'; }
  function isOverdue(t) { return isOpen(t) && t.due && t.due < todayIso(); }
  function isDueToday(t) { return isOpen(t) && t.due === todayIso(); }

  async function confirmOpenItems(list) {
    var open = list.filter(function (t) { return t.status !== 'done' && openItems(t) > 0; });
    if (!open.length) return true;
    var n = open.reduce(function (s, t) { return s + openItems(t); }, 0);
    var v = await ask({
      title: 'Mark as done with open checklist items?',
      text: open.length === 1 ? plural(n, 'checklist item is', 'checklist items are') + ' still open on “' + open[0].title + '”.' : plural(open.length, 'task still has', 'tasks still have') + ' open checklist items (' + n + ' in total).',
      buttons: [{ v: 'cancel', label: 'Cancel' }, { v: 'yes', label: 'Mark done anyway', primary: true }]
    });
    return v === 'yes';
  }
  function applyStatus(t, s, opts) {
    opts = opts || {};
    if (s === 'done') {
      if (t.status !== 'done') t.doneAt = nowIso();
      t.status = 'done';
      if (opts.confirmed) { t.confirmed = true; t.confirmedAt = nowIso(); t.confirmedWith = opts.confId || null; }
    } else {
      t.status = s;
      t.doneAt = null; t.confirmed = false; t.confirmedAt = null; t.confirmedWith = null;
    }
  }
  async function setStatus(t, s, opts) {
    opts = opts || {};
    if (s === 'done' && t.status !== 'done' && !opts.force && !(await confirmOpenItems([t]))) return false;
    applyStatus(t, s, opts);
    await saveTask(t);
    renderMain();
    return true;
  }
  async function deleteTasks(ids) {
    for (var i = 0; i < ids.length; i++) {
      var t = taskById(ids[i]);
      if (!t) continue;
      if (t.mailId) { await idb.del('mails', t.mailId); delete state.mails[t.mailId]; }
      await idb.del('tasks', t.id);
      state.tasks = state.tasks.filter(function (x) { return x.id !== t.id; });
      delete state.selected[t.id];
    }
    await gcFiles();
    changed();
    renderMain();
  }

  // ---------- importing e-mails ----------

  function htmlToText(html) {
    var doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    doc.querySelectorAll('script,style,head,title,noscript,template').forEach(function (n) { n.remove(); });
    var out = [];
    var BLOCK = /^(P|DIV|SECTION|ARTICLE|HEADER|FOOTER|H[1-6]|UL|OL|TABLE|TR|BLOCKQUOTE|PRE|HR|ADDRESS|CENTER|FORM|DL|DT|DD)$/;
    (function walk(n) {
      if (n.nodeType === 3) { out.push(n.nodeValue.replace(/[\s ]+/g, ' ')); return; }
      if (n.nodeType !== 1) return;
      var tag = n.tagName;
      if (tag === 'BR') { out.push('\n'); return; }
      if (tag === 'IMG') { var alt = n.getAttribute('alt'); if (alt && alt.trim()) out.push(' ' + alt.trim() + ' '); return; }
      if (BLOCK.test(tag)) out.push('\n');
      if (tag === 'LI') out.push('\n• ');
      if (tag === 'TD' || tag === 'TH') out.push(' ');
      for (var c = n.firstChild; c; c = c.nextSibling) walk(c);
      if (BLOCK.test(tag)) out.push('\n');
      if (tag === 'TD' || tag === 'TH') out.push('  ');
    })(doc.body || doc.documentElement);
    return out.join('').split('\n').map(function (l) { return l.replace(/[ \t]+/g, ' ').trim(); }).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  function linksIn(html) {
    if (!html) return [];
    var doc = new DOMParser().parseFromString(html, 'text/html'), seen = {}, out = [];
    doc.querySelectorAll('a[href]').forEach(function (a) {
      var u = a.getAttribute('href').trim();
      if (/^https?:\/\//i.test(u) && !seen[u] && out.length < 60) { seen[u] = 1; out.push(u); }
    });
    return out;
  }
  function mailKey(p) {
    var mid = String(p.messageId || '').trim().replace(/^<|>$/g, '').toLowerCase();
    if (mid) return 'id:' + mid;
    return 'k:' + norm(X.cleanSubject(p.subject)).replace(/\s+/g, ' ') + '|' + String((p.from && p.from.address) || (p.from && p.from.name) || '').toLowerCase() + '|' + (p.date ? String(p.date).slice(0, 16) : norm(String(p.text || '').slice(0, 200)).replace(/\s+/g, ' '));
  }
  function findDuplicate(p) {
    var key = mailKey(p), alt = 'k:' + norm(X.cleanSubject(p.subject)).replace(/\s+/g, ' ') + '|' + String((p.from && p.from.address) || (p.from && p.from.name) || '').toLowerCase() + '|' + (p.date ? String(p.date).slice(0, 16) : '');
    var ids = Object.keys(state.mails);
    for (var i = 0; i < ids.length; i++) {
      var m = state.mails[ids[i]];
      if (m.key === key || (p.date && m.altKey === alt)) { var t = taskById(m.taskId); if (t) return { mail: m, task: t }; }
    }
    return null;
  }

  async function createFromParsed(p, meta) {
    var dup = findDuplicate(p);
    if (dup) {
      var v = await ask({
        title: 'This e-mail is already a task',
        text: '“' + (p.subject || '(no subject)') + '” was imported before as the task “' + dup.task.title + '”' + (dup.task.status === 'done' ? ' (done)' : '') + '.',
        buttons: [{ v: 'skip', label: 'Skip' }, { v: 'again', label: 'Import again' }, { v: 'open', label: 'Open the existing task', primary: true }]
      });
      if (v === 'open') { openTask(dup.task.id); return { opened: true }; }
      if (v !== 'again') return { skipped: true };
    }
    var text = String(p.text || '').replace(/\r\n/g, '\n');
    if (!text.trim() && p.html) text = htmlToText(p.html);
    var html = String(p.html || '');
    var atts = [];
    for (var i = 0; i < (p.attachments || []).length; i++) {
      var a = p.attachments[i];
      if (!a.data || !a.data.length) continue;
      var f = await putFile(a.data, a.name, a.type);
      var usedInline = !!a.cid && html.indexOf('cid:' + a.cid) >= 0;
      atts.push({ hash: f.hash, name: a.name, type: f.type, size: f.size, cid: a.cid || '', inline: usedInline });
    }
    var htmlHash = null;
    if (html.trim()) htmlHash = (await putFile(new Blob([html], { type: 'text/html' }), 'message.html', 'text/html')).hash;
    var task = newTask({});
    var mail = {
      id: uid(), taskId: task.id, key: mailKey(p),
      altKey: 'k:' + norm(X.cleanSubject(p.subject)).replace(/\s+/g, ' ') + '|' + String((p.from && p.from.address) || (p.from && p.from.name) || '').toLowerCase() + '|' + (p.date ? String(p.date).slice(0, 16) : ''),
      messageId: String(p.messageId || '').trim(), subject: p.subject || '', from: p.from || { name: '', address: '' }, to: p.to || [], cc: p.cc || [],
      date: p.date || null, text: text, htmlHash: htmlHash, links: linksIn(html).concat(X.findUrls(text)).filter(function (u, k, arr) { return arr.indexOf(u) === k; }).slice(0, 80),
      attachments: atts, source: meta.source, fileName: meta.fileName || '', rtfOnly: !!p.rtfOnly, importedAt: nowIso()
    };
    var base = p.date ? isoOf(new Date(p.date)) : todayIso();
    task.title = X.cleanSubject(p.subject) || meta.title || '(no subject)';
    task.mailId = mail.id;
    task.dueSuggestions = X.suggestDue(text, p.subject, base);
    await saveMail(mail);
    await saveTask(task);
    return { task: task };
  }

  async function sniff(file) {
    var ext = (/\.([a-z0-9]+)$/i.exec(file.name || '') || [])[1];
    ext = ext ? ext.toLowerCase() : '';
    var head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    if (MSG.isMsg(new Uint8Array(await file.slice(0, 512).arrayBuffer()))) return 'msg';
    if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) return 'pdf';
    if (ext === 'pdf' || file.type === 'application/pdf') return 'pdf';
    if (/^image\//.test(file.type) || /^(jpe?g|png|gif|webp|heic|heif)$/.test(ext)) return 'image';
    if (ext === 'eml' || file.type === 'message/rfc822') return 'eml';
    if (ext === 'msg') return 'msg';
    var txt = new TextDecoder('utf-8').decode(await file.slice(0, 4096).arrayBuffer());
    if (/^(from|subject|date|received|return-path|message-id|mime-version|to|delivered-to|x-[a-z-]+)\s*:/im.test(txt)) return 'eml';
    return null;
  }

  async function importFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;
    var kinds = [];
    for (var i = 0; i < files.length; i++) kinds.push(await sniff(files[i]));
    var openT = state.openId && $('detail').open ? taskById(state.openId) : null;
    var confFiles = files.filter(function (f, k) { return kinds[k] === 'pdf' || kinds[k] === 'image'; });
    var mailFiles = files.filter(function (f, k) { return kinds[k] === 'msg' || kinds[k] === 'eml'; });
    var unknown = files.filter(function (f, k) { return !kinds[k]; });
    if (unknown.length) toast(plural(unknown.length, 'file was', 'files were') + ' skipped: ' + unknown.map(function (f) { return f.name; }).join(', ') + '. Desk reads Outlook .msg and .eml e-mails, and PDF or photo confirmations on a task.', { error: true });
    if (confFiles.length) {
      if (openT) {
        if (confFiles.length > 1) toast('One confirmation at a time: “' + confFiles[0].name + '” is opened first.');
        await openConfEditor(openT, { file: confFiles[0] });
      } else toast('To attach a confirmation, open a task and drop the PDF or photo on it (or use “Add PDF or photo”).');
    }
    if (!mailFiles.length) return;
    if (openT && $('detail').open) closeDetail();
    var busy = mailFiles.length > 1 ? toast('Reading ' + mailFiles.length + ' e-mails…', { busy: true }) : null;
    var created = [], failed = [], firstOpened = false;
    for (var j = 0; j < mailFiles.length; j++) {
      var f = mailFiles[j];
      try {
        var u8 = new Uint8Array(await f.arrayBuffer());
        var isMsg = MSG.isMsg(u8);
        var p = isMsg ? MSG.parse(u8) : EML.parse(u8);
        var r = await createFromParsed(p, { source: isMsg ? 'msg' : 'eml', fileName: f.name, title: f.name.replace(/\.(msg|eml)$/i, '') });
        if (r.task) created.push(r.task);
        if (r.opened) firstOpened = true;
      } catch (e) { console.error(e); failed.push(f.name + ' (' + errMsg(e) + ')'); }
    }
    if (busy) busy.remove();
    if (created.length) changed();
    renderMain();
    if (failed.length) toast('Could not read ' + failed.join('; '), { error: true });
    if (created.length === 1 && !firstOpened) openTask(created[0].id);
    else if (created.length > 1) {
      toast(plural(created.length, 'task', 'tasks') + ' created from e-mails.', { action: 'Show all', onAction: function () { setView('all'); } });
      if (state.view !== 'all' && state.view !== 'board') setView('today');
    }
  }

  async function createFromPaste(text, subject) {
    var p = X.parsePasted(text);
    if (subject) p.subject = subject;
    if (!p.text.trim() && !p.subject.trim()) throw new Error('Paste the e-mail text first.');
    var r = await createFromParsed(p, { source: 'paste', fileName: '' });
    if (r.task) { changed(); renderMain(); openTask(r.task.id); }
    return r;
  }

  // ---------- main view ----------

  function loadUi() {
    try {
      var u = JSON.parse(localStorage.getItem(UI_KEY) || '{}');
      if (VIEWS.some(function (v) { return v.k === u.view; })) state.view = u.view;
      if (u.calMonth) state.calMonth = u.calMonth;
    } catch (e) { /* ignore */ }
  }
  function saveUi() { try { localStorage.setItem(UI_KEY, JSON.stringify({ view: state.view, calMonth: state.calMonth })); } catch (e) { /* ignore */ } }
  function setView(v) { state.view = v; state.selected = {}; saveUi(); renderMain(); }

  function visibleTasks() {
    return state.tasks.filter(function (t) { return !state.who || norm(t.forWhom) === state.who; });
  }
  function counts() {
    var c = { today: 0, overdue: 0, upcoming: 0, waiting: 0, done: 0, all: 0, open: 0 }, t0 = todayIso();
    visibleTasks().forEach(function (t) {
      c.all++;
      if (t.status === 'done') { c.done++; return; }
      c.open++;
      if (t.status === 'waiting') c.waiting++;
      if (t.due && t.due < t0) c.overdue++;
      else if (t.due === t0) c.today++;
      else if (t.due) c.upcoming++;
    });
    return c;
  }
  function sortTasks(list) {
    var P = { high: 0, normal: 1, low: 2 };
    return list.slice().sort(function (a, b) {
      var da = a.due || '9999', db = b.due || '9999';
      if (da !== db) return da < db ? -1 : 1;
      if (P[a.priority] !== P[b.priority]) return P[a.priority] - P[b.priority];
      return a.createdAt < b.createdAt ? 1 : -1;
    });
  }

  function renderSummary(c) {
    var s = clear($('summary'));
    if (!state.tasks.length) return;
    function item(cls, n, label) { return h('span', { class: cls }, [h('i'), h('b', { text: String(n) }), ' ' + label]); }
    append(s, [
      item(c.today ? '' : 'ok', c.today, 'due today'),
      item(c.overdue ? 'bad' : 'ok', c.overdue, 'overdue'),
      item('', c.waiting, 'waiting'),
      item('', c.open, 'open')
    ]);
  }
  function renderTabs(c) {
    var nav = clear($('tabs'));
    VIEWS.forEach(function (v) {
      var n = null, bad = false;
      if (v.k === 'today') { n = c.today + c.overdue; bad = c.overdue > 0; }
      else if (v.k === 'upcoming') n = c.upcoming;
      else if (v.k === 'waiting') n = c.waiting;
      else if (v.k === 'done') n = c.done;
      else if (v.k === 'all') n = c.all;
      var label = v.l + (n != null ? ', ' + n + (v.k === 'today' && c.overdue ? ' (' + c.overdue + ' overdue)' : '') : '');
      nav.appendChild(h('button', {
        type: 'button', role: 'tab', class: 'tab', 'aria-selected': String(state.view === v.k && !state.query), 'aria-label': label, 'data-view': v.k,
        tabindex: state.view === v.k ? '0' : '-1',
        onclick: function () { state.query = ''; $('q').value = ''; setView(v.k); }
      }, [v.l, n != null ? h('span', { class: 'n' + (bad ? ' bad' : ''), 'aria-hidden': 'true', text: String(n) }) : null]));
    });
  }
  function renderWho() {
    var sel = $('f-who'), names = {}, cur = state.who;
    state.tasks.forEach(function (t) { var k = norm(t.forWhom).trim(); if (k && !names[k]) names[k] = t.forWhom.trim(); });
    var keys = Object.keys(names).sort(function (a, b) { return a < b ? -1 : 1; });
    clear(sel).appendChild(h('option', { value: '', text: 'Everyone' }));
    keys.forEach(function (k) { sel.appendChild(h('option', { value: k, text: names[k] })); });
    if (cur && !names[cur]) state.who = '';
    sel.value = state.who;
    sel.parentElement.hidden = !keys.length;
  }
  function renderBulk() {
    var ids = Object.keys(state.selected).filter(function (id) { return taskById(id); });
    $('bulk').hidden = !ids.length;
    $('bulk-count').textContent = plural(ids.length, 'task', 'tasks') + ' selected';
  }

  function renderMain() {
    var c = counts();
    var empty = !state.tasks.length;
    $('empty').hidden = !empty;
    $('tabs').hidden = empty;
    $('toolbar').hidden = empty;
    renderSummary(c);
    renderTabs(c);
    renderWho();
    renderBulk();
    var view = clear($('view'));
    if (empty) return;
    if (state.query.trim()) return renderSearch(view);
    if (state.view === 'board') return FX.renderBoard(view);
    if (state.view === 'calendar') return FX.renderCalendar(view);
    if (state.view === 'done') return FX.renderDoneLog(view);
    var list = visibleTasks(), t0 = todayIso(), groups = [];
    if (state.view === 'today') {
      var open = list.filter(isOpen);
      groups.push({ title: 'Overdue', bad: true, items: sortTasks(open.filter(function (t) { return t.due && t.due < t0; })) });
      groups.push({ title: 'Today · ' + fmtDateWd(t0), items: sortTasks(open.filter(function (t) { return t.due === t0; })) });
      var weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
      groups.push({ title: 'New · no due date yet', items: sortTasks(open.filter(function (t) { return !t.due && t.createdAt >= weekAgo; })) });
      if (!groups.some(function (g) { return g.items.length; })) return view.appendChild(h('p', { class: 'none' }, [h('b', { text: 'Nothing due today or overdue.' }), 'Upcoming tasks are under Upcoming. New e-mails you drop here appear in this list until they get a due date.']));
    } else if (state.view === 'upcoming') {
      var op = list.filter(isOpen), t1 = addDays(t0, 1), t7 = addDays(t0, 7);
      groups.push({ title: 'Tomorrow', items: sortTasks(op.filter(function (t) { return t.due === t1; })) });
      groups.push({ title: 'Next 7 days', items: sortTasks(op.filter(function (t) { return t.due > t1 && t.due <= t7; })) });
      groups.push({ title: 'Later', items: sortTasks(op.filter(function (t) { return t.due > t7; })) });
      groups.push({ title: 'No due date', items: sortTasks(op.filter(function (t) { return !t.due; })) });
      if (!groups.some(function (g) { return g.items.length; })) return view.appendChild(h('p', { class: 'none' }, [h('b', { text: 'Nothing upcoming.' }), 'Tasks with a due date after today show up here.']));
    } else if (state.view === 'waiting') {
      groups.push({ title: 'Waiting on someone', items: sortTasks(list.filter(function (t) { return t.status === 'waiting'; })) });
      if (!groups[0].items.length) return view.appendChild(h('p', { class: 'none' }, [h('b', { text: 'Nobody to wait for.' }), 'Set a task to “Waiting on someone” when the ball is in someone else\'s court.']));
    } else {
      STATUSES.forEach(function (s) { groups.push({ title: s.l, items: sortTasks(list.filter(function (t) { return t.status === s.k; })) }); });
    }
    groups.forEach(function (g) { if (g.items.length) view.appendChild(groupEl(g)); });
  }

  function groupEl(g) {
    return h('section', { class: 'group' }, [
      h('h2', { class: 'group-h' + (g.bad ? ' bad' : '') }, [g.title, h('span', { class: 'c', text: String(g.items.length) })]),
      h('ul', { class: 'tasks' }, g.items.map(function (t) { return rowEl(t, g.hits ? g.hits[t.id] : null); }))
    ]);
  }

  function dueBadge(t) {
    if (!t.due) return null;
    if (t.status === 'done') return h('span', { class: 'pill', text: fmtDate(t.due) });
    var t0 = todayIso();
    if (t.due < t0) return h('span', { class: 'pill bad' }, [h('i'), 'Overdue · ' + fmtDate(t.due)]);
    if (t.due === t0) return h('span', { class: 'pill warn' }, [h('i'), 'Today']);
    if (t.due === addDays(t0, 1)) return h('span', { class: 'pill violet', text: 'Tomorrow' });
    return h('span', { class: 'pill', text: fmtDateWd(t.due) });
  }
  function statusPill(t) {
    var s = statusOf(t.status);
    if (t.status === 'done' && t.confirmed) return h('span', { class: 'pill ok' }, [icon('check'), 'Confirmed']);
    return h('span', { class: 'pill ' + s.c }, [h('i'), s.l]);
  }
  function rowEl(t, hit) {
    var mail = t.mailId ? state.mails[t.mailId] : null;
    var nItems = (t.checklist || []).length, nOpen = openItems(t);
    var meta = [];
    if (t.forWhom) meta.push(h('span', { class: 'who' }, [icon('user'), t.forWhom]));
    if (mail && norm(personLabel(mail.from)) !== norm(t.forWhom)) meta.push(h('span', { title: 'From e-mail' }, [icon('mail'), personLabel(mail.from) || 'e-mail']));
    if (nItems) meta.push(h('span', { title: 'Checklist' }, [icon('list'), (nItems - nOpen) + '/' + nItems]));
    if ((t.confirmations || []).length) meta.push(h('span', { title: 'Confirmations' }, [icon('link'), String(t.confirmations.length)]));
    if (mail && (mail.attachments || []).filter(function (a) { return !a.inline; }).length) meta.push(h('span', { title: 'Attachments' }, [icon('clip'), String(mail.attachments.filter(function (a) { return !a.inline; }).length)]));
    (t.tags || []).forEach(function (tag) { meta.push(h('span', { class: 'tagchip', text: tag })); });
    if (hit) meta.push(h('span', { class: 'hit', text: 'Found in ' + hit }));
    var sel = !!state.selected[t.id];
    var li = h('li', { class: 'row' + (t.status === 'done' ? ' done' : '') + (sel ? ' sel' : ''), 'data-id': t.id }, [
      h('input', { type: 'checkbox', class: 'pick', checked: sel, 'aria-label': 'Select “' + t.title + '”', onchange: function (e) { if (e.target.checked) state.selected[t.id] = 1; else delete state.selected[t.id]; li.classList.toggle('sel', e.target.checked); renderBulk(); } }),
      h('button', {
        type: 'button', class: 'donebtn', 'aria-pressed': String(t.status === 'done'), title: t.status === 'done' ? 'Done · click to reopen' : 'Mark as done',
        'aria-label': (t.status === 'done' ? 'Reopen ' : 'Mark as done: ') + t.title,
        onclick: function () { setStatus(t, t.status === 'done' ? 'todo' : 'done').catch(fail); }
      }, icon(t.status === 'done' ? 'checkc' : 'circle')),
      h('button', { type: 'button', class: 'rowmain', onclick: function () { openTask(t.id); } }, [
        h('span', { class: 't', text: t.title || '(untitled)' }),
        meta.length ? h('span', { class: 'meta' }, meta) : null
      ]),
      h('span', { class: 'rowside' }, [
        t.priority === 'high' ? h('span', { class: 'pill bad', title: 'High priority' }, [icon('flag'), 'High']) : null,
        dueBadge(t),
        statusPill(t)
      ])
    ]);
    return li;
  }

  // ---------- search ----------

  var hayCache = {};
  function haystack(t) {
    var c = hayCache[t.id];
    var mail = t.mailId ? state.mails[t.mailId] : null;
    var stamp = t.updatedAt + '|' + (mail ? mail.importedAt : '');
    if (c && c.stamp === stamp) return c;
    var conf = (t.confirmations || []).map(function (x) { return [x.label, x.url, x.ref, x.provider, x.fileName, x.text].join(' '); }).join(' ');
    c = {
      stamp: stamp,
      parts: [
        ['title', norm(t.title)],
        ['for whom', norm(t.forWhom + ' ' + (t.tags || []).join(' '))],
        ['notes', norm(t.notes + ' ' + (t.checklist || []).map(function (i) { return i.text; }).join(' '))],
        ['e-mail', mail ? norm([mail.subject, personFull(mail.from), (mail.to || []).map(personFull).join(' '), mail.text, (mail.attachments || []).map(function (a) { return a.name; }).join(' ')].join(' ')) : ''],
        ['confirmation', norm(conf)]
      ]
    };
    hayCache[t.id] = c;
    return c;
  }
  function renderSearch(view) {
    var words = norm(state.query).split(/\s+/).filter(Boolean), hits = {};
    var found = visibleTasks().filter(function (t) {
      var hs = haystack(t), all = hs.parts.map(function (p) { return p[1]; }).join(' ');
      if (!words.every(function (w) { return all.indexOf(w) >= 0; })) return false;
      var where = hs.parts.filter(function (p) { return words.some(function (w) { return p[1].indexOf(w) >= 0; }); }).map(function (p) { return p[0]; });
      if (where.length && where[0] !== 'title') hits[t.id] = where.join(', ');
      return true;
    });
    var head = h('h2', { class: 'group-h' }, [plural(found.length, 'result', 'results') + ' for “' + state.query.trim() + '”', h('button', { type: 'button', class: 'linkbtn', style: 'margin-left:auto;font-family:inherit;text-transform:none;letter-spacing:0', text: 'Clear search', onclick: function () { state.query = ''; $('q').value = ''; renderMain(); $('q').focus(); } })]);
    view.appendChild(head);
    if (!found.length) return view.appendChild(h('p', { class: 'none' }, [h('b', { text: 'No tasks match.' }), 'Search looks in titles, notes, checklists, e-mail text and attachments names, and confirmations (including the text of confirmation PDFs).']));
    var open = sortTasks(found.filter(isOpen)), done = sortTasks(found.filter(function (t) { return !isOpen(t); }));
    if (open.length) view.appendChild(groupEl({ title: 'Open', items: open, hits: hits }));
    if (done.length) view.appendChild(groupEl({ title: 'Done', items: done, hits: hits }));
  }

  // ---------- task detail ----------

  function openTask(id) {
    var t = taskById(id);
    if (!t) return;
    state.openId = id;
    renderDetail(t);
    var d = $('detail');
    if (!d.open) d.showModal();
    var sh = d.querySelector('.d-main');
    if (sh) sh.scrollTop = 0;
    growTitle();
  }
  function growTitle() {
    var ti = $('d-title');
    if (!ti) return;
    ti.style.height = 'auto';
    if (ti.scrollHeight) ti.style.height = ti.scrollHeight + 'px';
  }
  function closeDetail() {
    var d = $('detail');
    if (d.open) d.close();
  }
  function refreshDetail(focusSel) {
    var t = state.openId ? taskById(state.openId) : null;
    if (!t || !$('detail').open) return;
    var main = $('detail').querySelector('.d-main'), side = $('detail').querySelector('.d-side');
    var s1 = main ? main.scrollTop : 0, s2 = side ? side.scrollTop : 0;
    renderDetail(t);
    var m2 = $('detail').querySelector('.d-main'), sd2 = $('detail').querySelector('.d-side');
    if (m2) m2.scrollTop = s1;
    if (sd2) sd2.scrollTop = s2;
    growTitle();
    if (focusSel) { var f = $('detail').querySelector(focusSel); if (f) f.focus(); }
  }

  function renderDetail(t) {
    var shell = clear($('detail-shell'));
    var mail = t.mailId ? state.mails[t.mailId] : null;
    var t0 = todayIso();

    // header
    var eyebrow = 'TASK' + (mail ? ' · FROM E-MAIL' : '') + ' · ADDED ' + fmtDate(isoOf(new Date(t.createdAt)));
    shell.appendChild(h('header', { class: 'd-head' }, [
      h('div', { class: 't' }, [h('span', { class: 'eyebrow', id: 'd-eyebrow', text: eyebrow })]),
      h('button', { type: 'button', class: 'btn icon small ghost', 'aria-label': 'Close', onclick: closeDetail }, icon('x'))
    ]));

    // main column
    var title = h('textarea', { class: 'title-in', id: 'd-title', rows: '1', maxlength: '300', 'aria-label': 'Task title', spellcheck: 'true' });
    title.value = t.title;
    function grow() { title.style.height = 'auto'; if (title.scrollHeight) title.style.height = title.scrollHeight + 'px'; }
    title.addEventListener('input', function () { t.title = title.value.replace(/\s*\n\s*/g, ' '); grow(); queueSave(t); });
    title.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } });
    setTimeout(grow, 0);

    var stateLine = h('div', { class: 'state-line' }, [
      statusPill(t),
      t.priority === 'high' ? h('span', { class: 'pill bad' }, [icon('flag'), 'High priority']) : null,
      isOverdue(t) ? h('span', { class: 'pill bad' }, [h('i'), 'Overdue']) : isDueToday(t) ? h('span', { class: 'pill warn' }, [h('i'), 'Due today']) : null,
      t.status === 'done' && t.doneAt ? h('span', { class: 'pill', text: 'Done ' + fmtDateTime(t.doneAt) }) : null
    ]);

    var statusSel = h('select', { id: 'd-status' }, STATUSES.map(function (s) { return h('option', { value: s.k, text: s.l }); }));
    statusSel.value = t.status;
    statusSel.addEventListener('change', function () {
      var v = statusSel.value;
      setStatus(t, v).then(function (ok) { if (!ok) statusSel.value = t.status; refreshDetail('#d-status'); }).catch(fail);
    });
    var prioSel = h('select', { id: 'd-prio' }, PRIORITIES.map(function (p) { return h('option', { value: p.k, text: p.l }); }));
    prioSel.value = t.priority || 'normal';
    prioSel.addEventListener('change', function () { t.priority = prioSel.value; saveTask(t).then(function () { renderMain(); refreshDetail('#d-prio'); }).catch(fail); });
    var dueIn = h('input', { type: 'date', id: 'd-due', value: t.due || '' });
    dueIn.addEventListener('change', function () { t.due = dueIn.value || null; saveTask(t).then(function () { renderMain(); refreshDetail('#d-due'); }).catch(fail); });
    var whoIn = h('input', { type: 'text', id: 'd-who', list: 'd-who-list', maxlength: '120', placeholder: 'Person or company', autocomplete: 'off', value: t.forWhom || '' });
    whoIn.addEventListener('input', function () { t.forWhom = whoIn.value; queueSave(t, 500); });
    var whoList = h('datalist', { id: 'd-who-list' });
    var seenWho = {};
    state.tasks.forEach(function (x) { var w = (x.forWhom || '').trim(); if (w && !seenWho[norm(w)]) { seenWho[norm(w)] = 1; whoList.appendChild(h('option', { value: w })); } });

    var dueSugg = null;
    var sug = (t.dueSuggestions || []).filter(function (s) { return s.iso !== t.due; });
    if (sug.length && !t.due && !t.dueSuggestionDismissed) {
      dueSugg = h('div', { class: 'sugg', role: 'group', 'aria-label': 'Suggested due date' }, [
        h('div', null, ['Suggested due date from the e-mail: ', h('b', { style: 'font-weight:500', text: fmtDateWd(sug[0].iso) }), sug[0].iso < t0 ? ' (already past)' : '']),
        h('span', { class: 'q', text: '“' + sug[0].snippet + '”' }),
        h('div', { class: 'acts' }, [
          h('button', { type: 'button', class: 'btn small primary', id: 'd-sugg-use', text: 'Use ' + fmtDate(sug[0].iso), onclick: function () { useDue(sug[0].iso); } }),
          sug.slice(1).map(function (s) { return h('button', { type: 'button', class: 'btn small', title: s.snippet, text: fmtDate(s.iso), onclick: function () { useDue(s.iso); } }); }),
          h('button', { type: 'button', class: 'btn small ghost', text: 'Dismiss', onclick: function () { t.dueSuggestionDismissed = true; saveTask(t).then(function () { refreshDetail('#d-due'); }).catch(fail); } })
        ])
      ]);
    }
    function useDue(iso) { t.due = iso; saveTask(t).then(function () { renderMain(); refreshDetail('#d-due'); toast('Due date set to ' + fmtDateWd(iso) + '.'); }).catch(fail); }

    var whoHint = null;
    if (mail && !t.forWhom && personLabel(mail.from)) {
      var sender = mail.from.name || mail.from.address;
      whoHint = h('span', { class: 'hint' }, ['E-mail from ', h('button', { type: 'button', class: 'linkbtn', text: sender, title: 'Use the sender as “for whom”', onclick: function () { t.forWhom = sender; saveTask(t).then(function () { renderMain(); refreshDetail('#d-who'); }).catch(fail); } })]);
    }

    var tagsIn = h('input', { type: 'text', id: 'd-tags', maxlength: '300', placeholder: 'e.g. travel, Zagreb fair', value: (t.tags || []).join(', ') });
    tagsIn.addEventListener('change', function () {
      var seen = {};
      t.tags = tagsIn.value.split(',').map(function (x) { return x.trim(); }).filter(function (x) { var k = norm(x); if (!x || seen[k]) return false; seen[k] = 1; return true; }).slice(0, 20);
      saveTask(t).then(renderMain).catch(fail);
    });

    var notes = h('textarea', { id: 'd-notes', maxlength: '20000', placeholder: 'Anything to remember: names, room types, who pays…' });
    notes.value = t.notes || '';
    notes.addEventListener('input', function () { t.notes = notes.value; queueSave(t, 600); });

    var main = h('div', { class: 'd-main' }, [
      title, stateLine,
      h('div', { class: 'grid2' }, [
        h('div', { class: 'f' }, [h('label', { for: 'd-status', text: 'STATUS' }), statusSel]),
        h('div', { class: 'f' }, [h('label', { for: 'd-prio', text: 'PRIORITY' }), prioSel]),
        h('div', { class: 'f' }, [h('label', { for: 'd-due', text: 'DUE DATE' }), dueIn, t.due ? h('span', { class: 'hint' }, [fmtDateWd(t.due) + ' · ', h('button', { type: 'button', class: 'linkbtn', text: 'Clear', onclick: function () { t.due = null; saveTask(t).then(function () { renderMain(); refreshDetail('#d-due'); }).catch(fail); } })]) : null]),
        h('div', { class: 'f' }, [h('label', { for: 'd-who', text: 'FOR WHOM' }), whoIn, whoList, whoHint])
      ]),
      dueSugg,
      h('div', { class: 'f' }, [h('label', { for: 'd-tags', text: 'TAGS' }), tagsIn, h('span', { class: 'hint', text: 'Separate with commas.' })]),
      checklistEl(t),
      h('div', { class: 'f' }, [h('label', { for: 'd-notes', text: 'NOTES' }), notes])
    ]);

    // side column: confirmations + e-mail
    var side = h('div', { class: 'd-side' }, [confirmationsEl(t), mail ? mailEl(t, mail) : h('section', { class: 'sec' }, [h('h3', { class: 'sec-h', text: 'E-mail' }), h('p', { class: 'help', text: 'Created by hand, no e-mail linked.' })])]);

    shell.appendChild(h('div', { class: 'd-body' }, [main, side]));

    // footer
    var done = t.status === 'done';
    shell.appendChild(h('footer', { class: 'd-foot' }, [
      h('button', { type: 'button', class: 'btn small danger', onclick: function () { askDelete([t.id]); } }, [icon('trash'), 'Delete']),
      h('span', { class: 'spacer' }),
      done ? h('button', { type: 'button', class: 'btn', id: 'd-reopen', onclick: function () { setStatus(t, 'todo').then(function () { refreshDetail('#d-done'); }).catch(fail); } }, 'Reopen')
        : h('button', { type: 'button', class: 'btn primary', id: 'd-done', onclick: function () { setStatus(t, 'done').then(function (ok) { if (ok) refreshDetail('#d-reopen'); }).catch(fail); } }, [icon('check'), 'Mark done'])
    ]));
  }

  function checklistEl(t) {
    var list = t.checklist || (t.checklist = []);
    var ul = h('ul', { class: 'check' });
    list.forEach(function (it, i) {
      var cb = h('input', { type: 'checkbox', checked: !!it.done, 'aria-label': 'Done: ' + it.text });
      var tx = h('input', { type: 'text', value: it.text, 'aria-label': 'Checklist item ' + (i + 1), maxlength: '300' });
      var li = h('li', { class: it.done ? 'done' : '' }, [cb, tx, h('button', { type: 'button', class: 'btn icon tiny ghost', 'aria-label': 'Remove item “' + it.text + '”', onclick: function () { list.splice(i, 1); saveTask(t).then(function () { renderMain(); refreshDetail('#d-check-add'); }).catch(fail); } }, icon('x'))]);
      cb.addEventListener('change', function () { it.done = cb.checked; li.classList.toggle('done', it.done); saveTask(t).then(renderMain).catch(fail); upd(); });
      tx.addEventListener('input', function () { it.text = tx.value; queueSave(t, 500); });
      ul.appendChild(li);
    });
    var add = h('input', { type: 'text', id: 'd-check-add', maxlength: '300', placeholder: 'Add a step and press Enter', 'aria-label': 'Add checklist item' });
    add.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || !add.value.trim()) return;
      e.preventDefault();
      list.push({ id: uid(), text: add.value.trim(), done: false });
      saveTask(t).then(function () { renderMain(); refreshDetail('#d-check-add'); }).catch(fail);
    });
    var count = h('span', { class: 'c' });
    function upd() { count.textContent = list.length ? (list.length - openItems(t)) + '/' + list.length : ''; }
    upd();
    return h('section', { class: 'sec' }, [h('h3', { class: 'sec-h' }, ['Checklist', count]), ul, h('div', { class: 'addline' }, add)]);
  }

  function provIcon(kind) { return h('span', { class: 'prov ' + (kind || 'link') }, icon(ICONS[kind] ? kind : (kind === 'file' ? 'file' : 'link'))); }
  function confSummary(c) {
    var kv = [];
    if (c.ref) kv.push(h('span', null, ['Ref ', h('b', { class: 'mono', text: c.ref })]));
    if (c.dateFrom) kv.push(h('span', null, [c.dateTo ? 'Dates ' : 'Date ', h('b', { text: fmtRange(c.dateFrom, c.dateTo) })]));
    if (c.amount != null && c.amount !== '') kv.push(h('span', null, ['Total ', h('b', { text: money(+c.amount, c.currency) })]));
    return kv;
  }
  function confirmationsEl(t) {
    var list = t.confirmations || (t.confirmations = []);
    var sec = h('section', { class: 'sec', 'aria-labelledby': 'd-conf-h' });
    sec.appendChild(h('h3', { class: 'sec-h', id: 'd-conf-h' }, ['Confirmations', h('span', { class: 'c', text: list.length ? String(list.length) : '' })]));
    if (t.status === 'done' && t.confirmed) {
      var cw = list.find(function (c) { return c.id === t.confirmedWith; });
      sec.appendChild(h('div', { class: 'confirmed-banner', role: 'status' }, [icon('shield'), h('span', null, [h('b', { text: 'Confirmed' }), ' · done ' + fmtDateTime(t.confirmedAt || t.doneAt) + (cw ? ' with ' + (cw.label || cw.provider || 'the confirmation') : '')])]));
    }
    var box = h('div', { class: 'confs' });
    list.forEach(function (c) {
      var kind = c.kind || (c.fileHash ? 'file' : 'link');
      var sub = [c.provider && c.provider !== c.label ? c.provider : null, X.KINDS[kind] && kind !== 'link' ? X.KINDS[kind] : null, c.url ? X.hostOf(c.url) : null, c.fileName ? c.fileName + (c.size ? ' · ' + fileSize(c.size) : '') : null].filter(Boolean).join(' · ');
      var acts = [];
      if (c.url) acts.push(h('a', { class: 'btn tiny', href: c.url, target: '_blank', rel: 'noopener noreferrer', title: c.url }, [icon('ext'), 'Open link']));
      if (c.fileHash) {
        acts.push(h('button', { type: 'button', class: 'btn tiny', onclick: function () { openFile(c.fileHash, c.fileName); } }, [icon('ext'), /^image\//.test(c.fileType) ? 'Open photo' : 'Open PDF']));
        acts.push(h('button', { type: 'button', class: 'btn tiny ghost', 'aria-label': 'Download ' + c.fileName, onclick: function () { openFile(c.fileHash, c.fileName, true); } }, icon('download')));
      }
      acts.push(h('button', { type: 'button', class: 'btn tiny ghost', onclick: function () { openConfEditor(t, { edit: c }); } }, [icon('edit'), 'Edit']));
      box.appendChild(h('div', { class: 'conf' + (t.confirmed && t.confirmedWith === c.id ? ' confirmed' : '') }, [
        h('div', { class: 'conf-top' }, [provIcon(c.fileHash && !c.provKind ? (c.kind && c.kind !== 'link' ? c.kind : 'file') : c.kind), h('div', { class: 'conf-t' }, [h('b', { text: c.label || c.provider || c.fileName || 'Confirmation' }), sub ? h('small', { text: sub }) : null])]),
        confSummary(c).length ? h('div', { class: 'kv' }, confSummary(c)) : null,
        h('div', { class: 'conf-acts' }, acts)
      ]));
    });
    if (!list.length) box.appendChild(h('p', { class: 'help', text: 'When it is booked, add the booking link or drop the confirmation PDF here. Reference, dates and total are kept with the task and booking dates show on the calendar.' }));
    sec.appendChild(box);
    sec.appendChild(h('div', { class: 'conf-acts' }, [
      h('button', { type: 'button', class: 'btn small', id: 'd-add-link', onclick: function () { openConfEditor(t, { url: true }); } }, [icon('link'), 'Add booking link']),
      h('button', { type: 'button', class: 'btn small', id: 'd-add-file', onclick: function () { pickConfFile(t); } }, [icon('file'), 'Add PDF or photo'])
    ]));
    sec.appendChild(h('p', { class: 'help', text: 'Tip: you can also drop a PDF or photo anywhere on this window.' }));
    return sec;
  }
  function pickConfFile(t) {
    var inp = $('conf-input');
    inp.value = '';
    inp.onchange = function () { if (inp.files && inp.files[0]) openConfEditor(t, { file: inp.files[0] }).catch(fail); };
    inp.click();
  }

  function mailEl(t, mail) {
    var atts = (mail.attachments || []).filter(function (a) { return !a.inline; });
    var excerpt = String(mail.text || '').replace(/\n{2,}/g, '\n').trim().slice(0, 600);
    return h('section', { class: 'sec', 'aria-labelledby': 'd-mail-h' }, [
      h('h3', { class: 'sec-h', id: 'd-mail-h' }, ['E-mail', h('span', { class: 'c', text: mail.source === 'paste' ? 'PASTED' : (mail.source || '').toUpperCase() })]),
      h('div', { class: 'mailcard' }, [
        h('div', { class: 'subj', text: mail.subject || '(no subject)' }),
        h('dl', null, [
          h('dt', { text: 'From' }), h('dd', { text: personFull(mail.from) || '–' }),
          mail.to && mail.to.length ? [h('dt', { text: 'To' }), h('dd', { text: mail.to.map(personLabel).join(', ') })] : null,
          h('dt', { text: 'Sent' }), h('dd', { text: mail.date ? fmtDateTime(mail.date) : '–' })
        ]),
        excerpt ? h('p', { class: 'excerpt', text: excerpt }) : null,
        h('div', { class: 'conf-acts' }, [h('button', { type: 'button', class: 'btn small', id: 'd-open-mail', onclick: function () { openMail(mail.id); } }, [icon('mail'), 'Open e-mail'])])
      ]),
      atts.length ? h('div', { class: 'sec' }, [
        h('h3', { class: 'sec-h' }, ['Attachments', h('span', { class: 'c', text: String(atts.length) })]),
        h('ul', { class: 'atts' }, atts.map(function (a) {
          var canConf = /^(application\/pdf|image\/)/.test(a.type) || /\.pdf$/i.test(a.name);
          return h('li', null, [
            icon(/^image\//.test(a.type) ? 'image' : 'file', 'ico'),
            h('span', { class: 'nm', text: a.name }), h('small', { text: fileSize(a.size) }),
            h('button', { type: 'button', class: 'btn tiny', onclick: function () { openFile(a.hash, a.name); } }, 'Open'),
            h('button', { type: 'button', class: 'btn tiny ghost', 'aria-label': 'Download ' + a.name, onclick: function () { openFile(a.hash, a.name, true); } }, icon('download')),
            canConf ? h('button', { type: 'button', class: 'btn tiny', title: 'Attach this file as the booking confirmation', onclick: function () { openConfEditor(t, { hash: a.hash, name: a.name, type: a.type, size: a.size }).catch(fail); } }, 'Use as confirmation') : null
          ]);
        }))
      ]) : null
    ]);
  }

  async function askDelete(ids) {
    var list = ids.map(taskById).filter(Boolean);
    if (!list.length) return;
    var v = await ask({
      title: list.length === 1 ? 'Delete this task?' : 'Delete ' + list.length + ' tasks?',
      text: (list.length === 1 ? '“' + list[0].title + '”' : 'The selected tasks') + ', with ' + (list.length === 1 ? 'its' : 'their') + ' e-mail and confirmation files, will be removed from this browser' + (sync && window.AdrialSync && AdrialSync.user() ? ' and from your cloud copy' : '') + '. This cannot be undone.',
      buttons: [{ v: 'cancel', label: 'Cancel' }, { v: 'del', label: 'Delete', primary: true }]
    });
    if (v !== 'del') return;
    if (list.some(function (t) { return t.id === state.openId; })) closeDetail();
    await deleteTasks(list.map(function (t) { return t.id; }));
    toast(list.length === 1 ? 'Task deleted.' : list.length + ' tasks deleted.');
  }

  // ---------- confirmation editor ----------

  var pdfjsPromise = null;
  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (pdfjsPromise) return pdfjsPromise;
    pdfjsPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = PDFJS_URL; s.crossOrigin = 'anonymous'; s.referrerPolicy = 'no-referrer';
      s.onload = function () { if (!window.pdfjsLib) return reject(new Error('The PDF reader did not load.')); window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; resolve(window.pdfjsLib); };
      s.onerror = function () { pdfjsPromise = null; reject(new Error('The PDF reader could not be loaded (offline?). You can still type the details by hand.')); };
      document.head.appendChild(s);
    });
    return pdfjsPromise;
  }
  // text lines of a PDF (items grouped by their baseline), plus page 1 drawn on a canvas
  async function readPdf(blob, canvas) {
    var lib = await loadPdfJs();
    var pdf = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false }).promise;
    var lines = [], rendering = null;
    for (var p = 1; p <= Math.min(pdf.numPages, 10); p++) {
      var page = await pdf.getPage(p);
      if (p === 1 && canvas) {
        // the thumbnail is drawn on the side: reading the text never waits for it
        var vp0 = page.getViewport({ scale: 1 }), scale = Math.min(2, 480 / vp0.width), vp = page.getViewport({ scale: scale });
        canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
        rendering = page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise.catch(function () {});
      }
      var tc = await page.getTextContent();
      var rows = [];
      tc.items.forEach(function (it) {
        if (!it.str || !it.str.trim()) return;
        var x = it.transform[4], y = it.transform[5], hgt = Math.abs(it.transform[3]) || 10;
        var r = rows.find(function (rr) { return Math.abs(rr.y - y) < hgt * 0.5; });
        if (!r) { r = { y: y, h: hgt, items: [] }; rows.push(r); }
        r.items.push({ x: x, w: it.width || 0, s: it.str });
      });
      rows.sort(function (a, b) { return b.y - a.y; });
      rows.forEach(function (r) {
        r.items.sort(function (a, b) { return a.x - b.x; });
        var out = '', end = null;
        r.items.forEach(function (it) {
          if (end != null) { var gap = it.x - end; out += gap > r.h * 1.4 ? '   ' : gap > r.h * 0.15 && !/\s$/.test(out) ? ' ' : ''; }
          out += it.s; end = it.x + it.w;
        });
        if (out.trim()) lines.push(out.replace(/\s+$/, ''));
      });
    }
    if (rendering) rendering.then(function () { pdf.destroy(); }); else pdf.destroy();
    return lines.join('\n');
  }

  var CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'HRK', 'RSD', 'BAM'];
  async function openConfEditor(t, opt) {
    opt = opt || {};
    var d = $('confedit'), shell = clear($('confedit-shell'));
    var edit = opt.edit || null;
    var c = edit ? Object.assign({}, edit) : { id: uid(), kind: 'link', label: '', url: '', provider: '', ref: '', dateFrom: '', dateTo: '', amount: null, currency: 'EUR', addedAt: nowIso() };
    var isFile = edit ? !!edit.fileHash : !!(opt.file || opt.hash);
    var mail = t.mailId ? state.mails[t.mailId] : null;
    var sugFrom = null, sugg = {};
    var base = isoOf(new Date(t.createdAt));

    // fields
    var urlIn = h('input', { type: 'url', id: 'ce-url', placeholder: 'https://…', maxlength: '2000', value: c.url || '', autocomplete: 'off' });
    var labelIn = h('input', { type: 'text', id: 'ce-label', maxlength: '160', value: c.label || '', placeholder: 'e.g. Hotel for Ana, 15.–17. 10.' });
    var provIn = h('input', { type: 'text', id: 'ce-prov', maxlength: '120', value: c.provider || '', placeholder: 'Booking.com, Ryanair, Hotel …' });
    var kindSel = h('select', { id: 'ce-kind' }, Object.keys(X.KINDS).map(function (k) { return h('option', { value: k, text: k === 'link' ? 'Other' : X.KINDS[k] }); }));
    kindSel.value = c.kind && X.KINDS[c.kind] ? c.kind : 'link';
    var refIn = h('input', { type: 'text', id: 'ce-ref', maxlength: '80', value: c.ref || '', class: 'mono', autocomplete: 'off' });
    var fromIn = h('input', { type: 'date', id: 'ce-from', value: c.dateFrom || '' });
    var toIn = h('input', { type: 'date', id: 'ce-to', value: c.dateTo || '' });
    var amtIn = h('input', { type: 'text', id: 'ce-amount', inputmode: 'decimal', maxlength: '20', value: c.amount != null ? String(c.amount).replace('.', ',') : '', placeholder: '0,00' });
    var curSel = h('select', { id: 'ce-cur' }, CURRENCIES.map(function (k) { return h('option', { value: k, text: k }); }));
    if (c.currency && CURRENCIES.indexOf(c.currency) < 0) curSel.appendChild(h('option', { value: c.currency, text: c.currency }));
    curSel.value = c.currency || 'EUR';
    var provLine = h('div', { class: 'provline', 'aria-live': 'polite' });
    var labelTouched = !!c.label, provTouched = !!c.provider;
    labelIn.addEventListener('input', function () { labelTouched = true; });
    provIn.addEventListener('input', function () { provTouched = true; });
    function tagFor(key) { return sugg[key] ? h('span', { class: 'tagsug', text: 'from ' + sugFrom }) : null; }
    function fld(id, label, input, key, extra) { return h('div', { class: 'f' + (extra || '') }, [h('label', { for: id }, [label, key ? h('span', { 'data-sug': key }) : null]), input]); }
    function markSug() {
      shell.querySelectorAll('[data-sug]').forEach(function (s) { clear(s); var tg = tagFor(s.getAttribute('data-sug')); if (tg) s.appendChild(tg); });
    }
    function updProv() {
      clear(provLine);
      if (!urlIn.value.trim()) return;
      var p = X.detectProvider(urlIn.value.trim());
      provLine.appendChild(provIcon(p.kind));
      provLine.appendChild(h('span', { text: p.known ? p.name + ' · ' + p.kindLabel : (p.host ? p.host + ' · provider not recognised' : 'Not a web address') }));
      if (!provTouched) provIn.value = p.known ? p.name : (p.host || '');
      if (p.kind !== 'link' || p.known) kindSel.value = p.kind;
      if (!labelTouched && !edit) labelIn.value = p.known ? p.name : '';
    }
    urlIn.addEventListener('input', updProv);

    function applySuggestions(s, from) {
      if (!s) return;
      sugFrom = from;
      if (s.ref && !refIn.value) { refIn.value = s.ref; sugg.ref = 1; }
      if (s.dateFrom && !fromIn.value) { fromIn.value = s.dateFrom; sugg.from = 1; }
      if (s.dateTo && !toIn.value) { toIn.value = s.dateTo; sugg.to = 1; }
      if (s.amount != null && !amtIn.value) { amtIn.value = String(s.amount.toFixed(2)).replace('.', ','); sugg.amount = 1; if (s.currency) { if (CURRENCIES.indexOf(s.currency) < 0) curSel.appendChild(h('option', { value: s.currency, text: s.currency })); curSel.value = s.currency; } }
      if (s.provider && !provIn.value) { provIn.value = s.provider.name; sugg.prov = 1; if (s.provider.kind) kindSel.value = s.provider.kind; }
      if (!labelIn.value && s.provider) labelIn.value = s.provider.name;
      markSug();
    }

    // preview + file
    var prev = null, textBox = null, status = h('p', { class: 'help', 'aria-live': 'polite' });
    var fileMeta = edit && edit.fileHash ? { hash: edit.fileHash, name: edit.fileName, type: edit.fileType, size: edit.size } : null;
    if (isFile) {
      prev = h('div', { class: 'ce-prev' });
      textBox = h('details', { class: 'text', hidden: true }, [h('summary', { text: 'Text read from the file' }), h('pre')]);
    }

    var linkSugg = null;
    if (!isFile && !edit && mail) {
      var links = X.bookingLinks((mail.links || []).join('\n'));
      if (links.length) linkSugg = h('div', { class: 'f' }, [h('span', { class: 'lbl', text: 'LINKS IN THE E-MAIL' }), h('div', { class: 'linksugg' }, links.map(function (u) {
        var p = X.detectProvider(u);
        return h('button', { type: 'button', class: 'btn tiny', title: u, onclick: function () { urlIn.value = u; updProv(); urlIn.focus(); } }, [icon(p.kind === 'link' ? 'link' : p.kind), p.known ? p.name + ' · ' + X.hostOf(u) : X.hostOf(u)]);
      }))]);
    }

    var err = h('p', { class: 'mv-note', role: 'alert', hidden: true });
    var form = h('div', { class: 'grid2' }, [
      isFile ? null : h('div', { class: 'f span2' }, [h('label', { for: 'ce-url', text: 'BOOKING LINK' }), urlIn, provLine, h('span', { class: 'hint', text: 'The link is only stored and opened in a new tab when you click it. Desk never loads it.' })]),
      linkSugg ? h('div', { class: 'span2', style: 'grid-column:1/-1' }, linkSugg) : null,
      fld('ce-label', 'LABEL', labelIn, null, ' span2'),
      fld('ce-prov', 'PROVIDER ', provIn, 'prov'),
      fld('ce-kind', 'TYPE', kindSel),
      fld('ce-ref', 'REFERENCE / BOOKING NUMBER ', refIn, 'ref', ' span2'),
      fld('ce-from', 'FROM (CHECK-IN / TRAVEL) ', fromIn, 'from'),
      fld('ce-to', 'TO (CHECK-OUT / RETURN) ', toIn, 'to'),
      fld('ce-amount', 'TOTAL ', amtIn, 'amount'),
      fld('ce-cur', 'CURRENCY', curSel)
    ]);

    var markDone = !(t.status === 'done' && t.confirmed);
    var saveBtn = h('button', { type: 'button', class: 'btn' + (markDone ? '' : ' primary'), id: 'ce-save', text: 'Save' });
    var saveDone = markDone ? h('button', { type: 'button', class: 'btn primary', id: 'ce-save-done' }, [icon('check'), t.status === 'done' ? 'Save and mark confirmed' : 'Mark task as done (confirmed)']) : null;

    shell.appendChild(h('header', { class: 'd-head' }, [
      h('div', { class: 't' }, [h('span', { class: 'eyebrow', text: (edit ? 'EDIT ' : 'ADD ') + (isFile ? 'CONFIRMATION FILE' : 'BOOKING LINK') }), h('h2', { id: 'ce-title', text: t.title || 'Confirmation' })]),
      h('button', { type: 'button', class: 'btn icon small ghost', 'aria-label': 'Close', onclick: function () { d.close(); } }, icon('x'))
    ]));
    shell.appendChild(h('div', { class: 's-body' }, [
      isFile ? h('div', { class: 'ce-grid' }, [h('div', { class: 'sec' }, [status, form, textBox]), prev]) : h('div', { class: 'sec' }, [form]),
      err
    ]));
    shell.appendChild(h('footer', { class: 'd-foot' }, [
      edit ? h('button', { type: 'button', class: 'btn small danger', id: 'ce-remove', onclick: removeConf }, [icon('trash'), 'Remove']) : null,
      h('span', { class: 'spacer' }),
      h('button', { type: 'button', class: 'btn', text: 'Cancel', onclick: function () { d.close(); } }),
      saveBtn, saveDone
    ]));
    if (!d.open) d.showModal();
    if (!isFile) { updProv(); (edit ? labelIn : urlIn).focus(); }

    // suggestions from the e-mail for a link (the mail often has the reference and dates)
    if (!isFile && !edit && mail && mail.text) applySuggestions(X.extractBooking(mail.text, { baseIso: base }), 'the e-mail');

    // read the file
    if (isFile) {
      try {
        if (!fileMeta) {
          status.textContent = 'Storing the file…';
          if (opt.file) {
            if (opt.file.size > 40 * 1024 * 1024) throw new Error('That file is larger than 40 MB.');
            fileMeta = await putFile(opt.file, opt.file.name, opt.file.type || (/\.pdf$/i.test(opt.file.name) ? 'application/pdf' : 'application/octet-stream'));
          } else fileMeta = { hash: opt.hash, name: opt.name, type: opt.type, size: opt.size };
          if ((t.confirmations || []).some(function (x) { return x.fileHash === fileMeta.hash; })) { status.textContent = ''; d.close(); toast('This file is already attached to the task.'); return; }
        }
        prev.appendChild(h('span', { class: 'fname', text: fileMeta.name + (fileMeta.size ? ' · ' + fileSize(fileMeta.size) : '') }));
        var blob = await getBlob(fileMeta.hash, function () { status.textContent = 'Getting the file from your cloud copy…'; });
        var isPdf = /pdf/.test(fileMeta.type || blob.type) || /\.pdf$/i.test(fileMeta.name);
        if (isPdf) {
          var canvas = h('canvas', { 'aria-label': 'First page of ' + fileMeta.name, role: 'img' });
          prev.insertBefore(canvas, prev.firstChild);
          status.textContent = 'Reading the PDF…';
          var text = edit && edit.text ? edit.text : await readPdf(blob, canvas);
          if (edit && edit.text) readPdf(blob, canvas).catch(function () {});
          c.text = text.slice(0, 20000);
          if (text.trim()) {
            textBox.hidden = false; textBox.querySelector('pre').textContent = text;
            if (!edit) {
              applySuggestions(X.extractBooking(text, { baseIso: base }), 'the PDF');
              var found = Object.keys(sugg).length;
              status.textContent = found ? 'Read from the PDF: check the suggested fields (marked) and save.' : 'Nothing recognised in the PDF text. Type the details you need.';
            } else status.textContent = '';
          } else status.textContent = 'This PDF has no text (probably a scan). Type the details you need.';
        } else {
          prev.insertBefore(h('img', { src: blobUrl(blob), alt: 'Photo ' + fileMeta.name }), prev.firstChild);
          status.textContent = edit ? '' : 'Photos are not read automatically. Type the reference, dates and total you need.';
        }
        if (!labelIn.value) labelIn.value = (provIn.value || fileMeta.name.replace(/\.[a-z0-9]+$/i, ''));
        if (!edit) labelIn.focus();
      } catch (e) {
        console.error(e);
        status.textContent = errMsg(e);
        if (!fileMeta) { saveBtn.disabled = true; if (saveDone) saveDone.disabled = true; }
      }
    }

    function collect() {
      err.hidden = true;
      var url = urlIn.value.trim();
      if (!isFile) {
        if (!url) return fail2('Paste the booking link first.', urlIn);
        if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
        try { var u = new URL(url); if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) throw 0; } catch (e) { return fail2('That does not look like a web address.', urlIn); }
      }
      var amount = amtIn.value.trim() ? X.parseAmount(amtIn.value) : null;
      if (amtIn.value.trim() && amount == null) return fail2('The total is not a number.', amtIn);
      if (fromIn.value && toIn.value && toIn.value < fromIn.value) return fail2('“To” is before “From”.', toIn);
      var p = !isFile ? X.detectProvider(url) : null;
      c.kind = kindSel.value;
      c.url = isFile ? '' : url;
      c.label = labelIn.value.trim();
      c.provider = provIn.value.trim() || (p && p.known ? p.name : '');
      c.ref = refIn.value.trim();
      c.dateFrom = fromIn.value || '';
      c.dateTo = toIn.value || '';
      c.amount = amount;
      c.currency = curSel.value;
      if (isFile && fileMeta) { c.fileHash = fileMeta.hash; c.fileName = fileMeta.name; c.fileType = fileMeta.type; c.size = fileMeta.size; }
      if (!c.label) c.label = c.provider || (isFile ? c.fileName : X.hostOf(url));
      c.updatedAt = nowIso();
      return c;
    }
    function fail2(msg, el) { err.textContent = msg; err.hidden = false; if (el) el.focus(); return null; }
    async function store(done) {
      var conf = collect();
      if (!conf) return;
      var list = t.confirmations || (t.confirmations = []);
      var i = list.findIndex(function (x) { return x.id === conf.id; });
      if (i >= 0) list[i] = conf; else list.push(conf);
      d.close();
      if (done) {
        if (t.status !== 'done' && !(await confirmOpenItems([t]))) { await saveTask(t); renderMain(); refreshDetail(); toast('Confirmation saved; the task stays open.'); return; }
        applyStatus(t, 'done', { confirmed: true, confId: conf.id });
      }
      await saveTask(t);
      renderMain();
      refreshDetail(done ? '#d-reopen' : '#d-add-link');
      toast(done ? 'Done and confirmed: “' + t.title + '”.' : 'Confirmation saved.');
    }
    async function removeConf() {
      var v = await ask({ title: 'Remove this confirmation?', text: '“' + (edit.label || 'Confirmation') + '” is removed from the task' + (edit.fileHash ? ', with its file' : '') + '.', buttons: [{ v: 'no', label: 'Cancel' }, { v: 'yes', label: 'Remove', primary: true }] });
      if (v !== 'yes') return;
      t.confirmations = (t.confirmations || []).filter(function (x) { return x.id !== edit.id; });
      if (t.confirmedWith === edit.id) t.confirmedWith = null;
      d.close();
      await saveTask(t);
      await gcFiles();
      renderMain(); refreshDetail('#d-add-link');
    }
    saveBtn.onclick = function () { store(false).catch(fail); };
    if (saveDone) saveDone.onclick = function () { store(true).catch(fail); };
  }

  // ---------- mail viewer ----------

  function sanitizeMailHtml(html, allowRemote, cidMap) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script,iframe,frame,frameset,object,embed,applet,base,meta,link,noscript,template,portal').forEach(function (n) { n.remove(); });
    var blocked = 0;
    var REMOTE = /^\s*(https?:)?\/\//i;
    doc.querySelectorAll('*').forEach(function (el) {
      Array.prototype.slice.call(el.attributes).forEach(function (a) {
        var n = a.name.toLowerCase(), v = a.value;
        if (n.slice(0, 2) === 'on' || n === 'formaction' || n === 'srcdoc' || n === 'ping') { el.removeAttribute(a.name); return; }
        if ((n === 'href' || n === 'src' || n === 'action' || n === 'xlink:href' || n === 'background' || n === 'poster' || n === 'data') && /^\s*(javascript|vbscript|data:text\/html|file):/i.test(v)) { el.removeAttribute(a.name); return; }
        if (n === 'style' && /url\(/i.test(v) && !allowRemote) {
          var nv = v.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, function (all, q, u) { if (/^\s*cid:/i.test(u)) { var k = u.replace(/^\s*cid:/i, '').trim(); return cidMap[k] ? 'url("' + cidMap[k] + '")' : 'none'; } if (/^\s*data:/i.test(u)) return all; blocked++; return 'none'; });
          el.setAttribute('style', nv);
        }
      });
      var tag = el.tagName;
      if (tag === 'A' || tag === 'AREA') { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer'); }
      if (tag === 'FORM') el.removeAttribute('action');
      ['src', 'background', 'poster'].forEach(function (attr) {
        var v = el.getAttribute(attr);
        if (!v) return;
        if (/^\s*cid:/i.test(v)) { var k = v.replace(/^\s*cid:/i, '').trim(); if (cidMap[k]) el.setAttribute(attr, cidMap[k]); else el.removeAttribute(attr); return; }
        if (REMOTE.test(v) && !allowRemote) { el.setAttribute('data-blocked-' + attr, v); el.removeAttribute(attr); blocked++; }
      });
      if (el.hasAttribute('srcset') && !allowRemote) { el.removeAttribute('srcset'); blocked++; }
    });
    var csp = "default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:" + (allowRemote ? ' https: http:' : '') + "; media-src 'none'; form-action 'none'";
    var head = doc.head || doc.documentElement.insertBefore(doc.createElement('head'), doc.body);
    var meta = doc.createElement('meta'); meta.setAttribute('http-equiv', 'Content-Security-Policy'); meta.setAttribute('content', csp);
    var cs = doc.createElement('meta'); cs.setAttribute('charset', 'utf-8');
    var base = doc.createElement('base'); base.setAttribute('target', '_blank');
    var st = doc.createElement('style'); st.textContent = 'html{background:#fff;color:#111}body{margin:12px;font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;overflow-wrap:anywhere}img{max-width:100%;height:auto}';
    head.insertBefore(st, head.firstChild); head.insertBefore(base, head.firstChild); head.insertBefore(meta, head.firstChild); head.insertBefore(cs, head.firstChild);
    return { html: '<!doctype html>' + doc.documentElement.outerHTML, blocked: blocked };
  }
  function linkify(text) {
    var frag = document.createDocumentFragment(), re = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/g, last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      frag.appendChild(h('a', { href: m[0], target: '_blank', rel: 'noopener noreferrer', text: m[0] }));
      last = m.index + m[0].length;
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    return frag;
  }
  async function cidMapOf(mail) {
    var map = {}, total = 0;
    var list = (mail.attachments || []).filter(function (a) { return a.cid && /^image\//.test(a.type); });
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (a.size > 3 * 1024 * 1024 || total > 15 * 1024 * 1024) continue;
      try {
        var b = await getBlob(a.hash);
        map[a.cid] = await new Promise(function (res, rej) { var fr = new FileReader(); fr.onload = function () { res(fr.result); }; fr.onerror = rej; fr.readAsDataURL(new Blob([b], { type: a.type })); });
        total += a.size;
      } catch (e) { /* missing inline image: left out */ }
    }
    return map;
  }

  async function openMail(mailId) {
    var mail = state.mails[mailId];
    if (!mail) return;
    var d = $('mailview'), shell = clear($('mailview-shell'));
    var mode = mail.htmlHash ? 'html' : 'text', allowRemote = false, html = null, cids = null;
    var atts = (mail.attachments || []).filter(function (a) { return !a.inline; });
    var body = h('div', { style: 'display:flex;flex-direction:column;flex:1;min-height:0' });
    var bar = h('div', { class: 'mv-bar' });
    shell.appendChild(h('header', { class: 'd-head' }, [
      h('div', { class: 't' }, [h('span', { class: 'eyebrow', text: 'E-MAIL' + (mail.fileName ? ' · ' + mail.fileName.toUpperCase() : '') }), h('h2', { id: 'mv-title', text: mail.subject || '(no subject)' })]),
      h('button', { type: 'button', class: 'btn icon small ghost', 'aria-label': 'Close', onclick: function () { d.close(); } }, icon('x'))
    ]));
    shell.appendChild(h('div', { class: 's-body' }, [
      h('dl', { class: 'mv-meta' }, [
        h('dt', { text: 'From' }), h('dd', { text: personFull(mail.from) || '–' }),
        mail.to && mail.to.length ? [h('dt', { text: 'To' }), h('dd', { text: mail.to.map(personFull).join(', ') })] : null,
        mail.cc && mail.cc.length ? [h('dt', { text: 'Cc' }), h('dd', { text: mail.cc.map(personFull).join(', ') })] : null,
        h('dt', { text: 'Sent' }), h('dd', { text: mail.date ? fmtDateTime(mail.date) : '–' })
      ]),
      atts.length ? h('ul', { class: 'atts' }, atts.map(function (a) {
        return h('li', null, [icon(/^image\//.test(a.type) ? 'image' : 'file', 'ico'), h('span', { class: 'nm', text: a.name }), h('small', { text: fileSize(a.size) }),
          h('button', { type: 'button', class: 'btn tiny', onclick: function () { openFile(a.hash, a.name); } }, 'Open'),
          h('button', { type: 'button', class: 'btn tiny ghost', 'aria-label': 'Download ' + a.name, onclick: function () { openFile(a.hash, a.name, true); } }, icon('download'))]);
      })) : null,
      mail.rtfOnly ? h('p', { class: 'mv-note', text: 'This e-mail\'s text is stored only in Outlook\'s RTF format, which Desk does not read. Open it in Outlook to see the full message; the attachments are here.' }) : null,
      bar, body
    ]));
    function draw() {
      clear(bar); clear(body);
      if (mail.htmlHash) {
        bar.appendChild(h('div', { class: 'seg', role: 'group', 'aria-label': 'Show as' }, [
          h('button', { type: 'button', 'aria-pressed': String(mode === 'html'), text: 'Formatted', onclick: function () { mode = 'html'; draw(); } }),
          h('button', { type: 'button', 'aria-pressed': String(mode === 'text'), text: 'Plain text', onclick: function () { mode = 'text'; draw(); } })
        ]));
      }
      if (mode === 'text') {
        body.appendChild(h('pre', { class: 'mv-text', tabindex: '0', 'aria-label': 'E-mail text' }, linkify(mail.text || '(no text)')));
        return;
      }
      var r = sanitizeMailHtml(html || '', allowRemote, cids || {});
      if (r.blocked && !allowRemote) {
        bar.appendChild(h('span', { class: 'help', text: plural(r.blocked, 'remote image is', 'remote images are') + ' blocked to protect your privacy.' }));
        bar.appendChild(h('button', { type: 'button', class: 'btn small', id: 'mv-load-images', text: 'Load images', onclick: function () { allowRemote = true; draw(); } }));
      }
      var fr = h('iframe', { class: 'mv-frame', title: 'E-mail content', sandbox: 'allow-popups allow-popups-to-escape-sandbox', referrerpolicy: 'no-referrer' });
      fr.srcdoc = r.html;
      body.appendChild(fr);
    }
    if (!d.open) d.showModal();
    if (mail.htmlHash) {
      body.appendChild(h('p', { class: 'help', text: 'Loading…' }));
      try {
        html = await (await getBlob(mail.htmlHash, function () { clear(body).appendChild(h('p', { class: 'help', text: 'Getting the e-mail from your cloud copy…' })); })).text();
        cids = await cidMapOf(mail);
      } catch (e) { mode = 'text'; bar.appendChild(h('p', { class: 'mv-note', text: 'The formatted version is not available: ' + errMsg(e) })); }
    }
    draw();
  }

  // ---------- drag and drop ----------

  var dragDepth = 0;
  function dragKind(e) {
    var types = Array.prototype.slice.call((e.dataTransfer && e.dataTransfer.types) || []);
    if (types.indexOf('text/x-desk-task') >= 0) return null;
    if (types.indexOf('Files') >= 0) return 'files';
    return null;
  }
  function showDrop(on) {
    var det = $('detail');
    var blocked = $('confedit').open || $('mailview').open || $('paste').open || $('settings').open || $('ask').open;
    if (det.open) { det.classList.toggle('dropping', on && !blocked); $('drop-overlay').hidden = true; return; }
    $('drop-overlay').hidden = !on || blocked;
  }
  function setupDrop() {
    window.addEventListener('dragenter', function (e) { if (!dragKind(e)) return; e.preventDefault(); dragDepth++; showDrop(true); });
    window.addEventListener('dragover', function (e) { if (!dragKind(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    window.addEventListener('dragleave', function (e) { if (!dragKind(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) showDrop(false); });
    window.addEventListener('drop', function (e) {
      var kind = dragKind(e);
      dragDepth = 0; showDrop(false);
      if (!kind) return;
      e.preventDefault();
      if ($('confedit').open || $('mailview').open || $('paste').open || $('settings').open || $('ask').open) return;
      var files = e.dataTransfer.files;
      if (files && files.length) importFiles(files).catch(fail);
      else {
        // e.g. a mail dragged from new Outlook / Outlook on the web: no file, maybe text
        var txt = e.dataTransfer.getData('text/plain');
        openPaste(txt || '');
        if (!txt) toast('That drag did not include a file. Copy the e-mail text and paste it here, or save the mail as a file first.');
      }
    });
  }

  // ---------- paste ----------

  function openPaste(text) {
    $('p-text').value = text || '';
    $('p-subject').value = '';
    $('paste').showModal();
    $('p-text').focus();
  }

  // ---------- bulk actions ----------

  function selectedTasks() { return Object.keys(state.selected).map(taskById).filter(Boolean); }
  function setupBulk() {
    var st = $('bulk-status');
    STATUSES.forEach(function (s) { st.appendChild(h('option', { value: s.k, text: s.l })); });
    st.addEventListener('change', async function () {
      var v = st.value; st.value = '';
      var list = selectedTasks();
      if (!v || !list.length) return;
      if (v === 'done' && !(await confirmOpenItems(list))) return;
      for (var i = 0; i < list.length; i++) { applyStatus(list[i], v); await saveTask(list[i], true); }
      changed(); state.selected = {}; renderMain();
      toast(plural(list.length, 'task', 'tasks') + ' set to “' + statusOf(v).l + '”.');
    });
    $('bulk-prio').addEventListener('change', async function () {
      var v = this.value; this.value = '';
      var list = selectedTasks();
      if (!v) return;
      for (var i = 0; i < list.length; i++) { list[i].priority = v; await saveTask(list[i], true); }
      changed(); renderMain();
    });
    $('bulk-due').addEventListener('change', async function () {
      var v = this.value; this.value = '';
      var list = selectedTasks();
      if (!v) return;
      for (var i = 0; i < list.length; i++) { list[i].due = v; await saveTask(list[i], true); }
      changed(); renderMain();
      toast('Due date ' + fmtDate(v) + ' set on ' + plural(list.length, 'task', 'tasks') + '.');
    });
    $('bulk-tag').addEventListener('keydown', async function (e) {
      if (e.key !== 'Enter' || !this.value.trim()) return;
      e.preventDefault();
      var tag = this.value.trim(); this.value = '';
      var list = selectedTasks();
      for (var i = 0; i < list.length; i++) {
        var t = list[i];
        if (!(t.tags || []).some(function (x) { return norm(x) === norm(tag); })) { t.tags = (t.tags || []).concat(tag); await saveTask(t, true); }
      }
      changed(); renderMain();
    });
    $('bulk-delete').addEventListener('click', function () { askDelete(Object.keys(state.selected)).catch(fail); });
    $('bulk-clear').addEventListener('click', function () { state.selected = {}; renderMain(); });
  }

  // ---------- settings ----------

  function updateStorageLine() {
    var line = $('storage-line');
    if (!navigator.storage || !navigator.storage.estimate) return;
    navigator.storage.estimate().then(function (r) {
      var mb = (r.usage || 0) / 1048576;
      line.textContent = 'Stored only in this browser · ' + (mb < 0.1 ? '<0.1' : mb.toFixed(1).replace('.', ',')) + ' MB used';
      $('s-storage').textContent = line.textContent + '. E-mails, tasks and files never leave this device unless you sign in to cloud sync or export a backup.';
    }).catch(function () {});
  }
  async function clearAll() {
    var v = await ask({ title: 'Clear all data?', text: 'Every task, e-mail and confirmation file in this browser is deleted' + (sync && window.AdrialSync && AdrialSync.user() ? ', and your cloud copy is replaced with the empty one' : '') + '. Download a backup first if you might need them. This cannot be undone.', buttons: [{ v: 'no', label: 'Cancel' }, { v: 'yes', label: 'Clear all data', primary: true }] });
    if (v !== 'yes') return;
    closeDetail();
    await idb.clear('tasks'); await idb.clear('mails'); await idb.clear('files'); await idb.clear('kv');
    state.tasks = []; state.mails = {}; state.settings = {}; state.selected = {}; hayCache = {};
    changed();
    $('settings').close();
    renderMain(); updateStorageLine();
    toast('All Desk data in this browser was cleared.');
  }

  // ---------- cloud sync ----------

  function snapshot() {
    return {
      app: 'adrial-desk', version: 1, savedAt: nowIso(),
      tasks: state.tasks,
      mails: Object.keys(state.mails).map(function (id) {
        var m = Object.assign({}, state.mails[id]);
        if (m.text && m.text.length > SNAPSHOT_TEXT_CAP) { m.text = m.text.slice(0, SNAPSHOT_TEXT_CAP); m.textTrimmed = true; }
        return m;
      }),
      settings: state.settings
    };
  }
  async function replaceAll(data) {
    if (!data || !Array.isArray(data.tasks) || !Array.isArray(data.mails)) throw new Error('This is not Desk data.');
    closeDetail();
    ['confedit', 'mailview'].forEach(function (id) { if ($(id).open) $(id).close(); });
    await idb.clear('tasks'); await idb.clear('mails'); await idb.clear('kv');
    for (var i = 0; i < data.tasks.length; i++) if (data.tasks[i] && data.tasks[i].id) await idb.put('tasks', cleanTask(data.tasks[i]));
    for (var j = 0; j < data.mails.length; j++) if (data.mails[j] && data.mails[j].id) await idb.put('mails', data.mails[j]);
    await idb.put('kv', { key: 'settings', value: data.settings && typeof data.settings === 'object' ? data.settings : {} });
    await loadState();
    hayCache = {}; state.selected = {};
  }
  async function applySnapshot(data) {
    applying = true;
    try {
      await replaceAll(data);
      await gcFiles();
      renderMain(); updateStorageLine();
      if (bc) bc.postMessage({ type: 'changed' });
    } finally { applying = false; }
    setTimeout(downloadMissing, 50);
  }
  // after taking the cloud copy, fetch the files this browser does not have yet
  var downloading = false;
  async function downloadMissing() {
    if (downloading || !sync || !window.AdrialSync || !AdrialSync.user()) return;
    downloading = true;
    var note = null;
    try {
      var refs = referencedFiles(), have = {}, keys = await idb.keys('files');
      keys.forEach(function (k) { have[k] = 1; });
      var missing = Object.keys(refs).filter(function (k) { return !have[k]; });
      if (!missing.length) return;
      note = toast('Getting ' + plural(missing.length, 'file', 'files') + ' from your cloud copy…', { busy: true });
      var failed = 0;
      for (var i = 0; i < missing.length; i++) { try { await sync.fetchFile(missing[i]); } catch (e) { failed++; } }
      if (note) note.remove();
      if (failed) toast(plural(failed, 'file', 'files') + ' could not be downloaded; they are fetched again when you open them.', { error: true });
      updateStorageLine();
    } finally { downloading = false; if (note) note.remove(); }
  }
  var syncFiles = {
    list: async function () {
      var refs = referencedFiles(), recs = await idb.all('files');
      return recs.filter(function (r) { return r.blob && refs[r.hash] && r.blob.size <= MAX_SYNC_FILE; }).map(function (r) {
        return { hash: r.hash, type: r.type || r.blob.type, getBlob: function () { return Promise.resolve(r.blob); } };
      });
    },
    has: async function (hash) { var r = await idb.get('files', hash); return !!(r && r.blob); },
    put: async function (hash, blob, type) {
      var ref = referencedFiles()[hash] || {};
      var t = ref.type || type || blob.type || 'application/octet-stream';
      await idb.put('files', { hash: hash, blob: new Blob([blob], { type: t }), type: t, name: ref.name || '', size: blob.size, addedAt: nowIso() });
    }
  };
  function attachSync() {
    if (!window.AdrialSync) { $('s-sync').textContent = 'Cloud sync is not available on this page.'; return; }
    try {
      sync = AdrialSync.attach({ app: 'desk', label: 'Desk', getSnapshot: snapshot, applySnapshot: applySnapshot, files: syncFiles });
      sync.mountPanel($('s-sync'));
    } catch (e) { console.error(e); sync = null; }
  }

  // ---------- wiring ----------

  function fail(e) { console.error(e); toast(errMsg(e), { error: true }); }

  function setupUi() {
    $('import-btn').addEventListener('click', function () { $('file-input').click(); });
    $('import-btn-2').addEventListener('click', function () { $('file-input').click(); });
    $('file-input').addEventListener('change', function () { var f = this.files; importFiles(f).catch(fail).then(function () { $('file-input').value = ''; }); });
    $('paste-btn').addEventListener('click', function () { openPaste(''); });
    $('paste-btn-2').addEventListener('click', function () { openPaste(''); });
    $('new-btn').addEventListener('click', newManualTask);
    $('settings-btn').addEventListener('click', function () { updateStorageLine(); $('settings').showModal(); });
    $('example-btn').addEventListener('click', function () { FX.loadExamples().catch(fail); });
    $('s-example').addEventListener('click', function () { $('settings').close(); FX.loadExamples().catch(fail); });
    $('s-backup').addEventListener('click', function () { FX.downloadBackup().catch(fail); });
    $('s-csv').addEventListener('click', function () { FX.downloadCsv(); });
    $('s-restore').addEventListener('click', function () { $('restore-input').value = ''; $('restore-input').click(); });
    $('restore-input').addEventListener('change', function () { if (this.files[0]) FX.restoreBackup(this.files[0]).catch(fail); });
    $('s-clear').addEventListener('click', function () { clearAll().catch(fail); });
    document.querySelectorAll('dialog [data-close]').forEach(function (b) { b.addEventListener('click', function () { b.closest('dialog').close(); }); });
    $('paste-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var text = $('p-text').value, subj = $('p-subject').value.trim();
      if (!text.trim()) { $('p-text').focus(); return; }
      $('paste').close();
      createFromPaste(text, subj).catch(fail);
    });
    $('detail').addEventListener('close', function () {
      flushSaves().then(function () { renderMain(); }).catch(fail);
      state.openId = null;
      $('detail').classList.remove('dropping');
    });
    var qTimer = null;
    $('q').addEventListener('input', function () { clearTimeout(qTimer); qTimer = setTimeout(function () { state.query = $('q').value; renderMain(); }, 120); });
    $('q').addEventListener('keydown', function (e) { if (e.key === 'Escape' && this.value) { this.value = ''; state.query = ''; renderMain(); } });
    $('f-who').addEventListener('change', function () { state.who = this.value; renderMain(); });
    // tabs: arrow keys move between views
    $('tabs').addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      var tabs = Array.prototype.slice.call(this.querySelectorAll('.tab')), i = tabs.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      var n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      n.click();
      var again = $('tabs').querySelector('[data-view="' + n.getAttribute('data-view') + '"]');
      if (again) again.focus();
    });
    document.addEventListener('keydown', function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey || document.querySelector('dialog[open]')) return;
      var tag = (e.target && e.target.tagName) || '';
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (e.target && e.target.isContentEditable)) return;
      if (e.key === '/') { e.preventDefault(); $('q').focus(); }
      else if (e.key === 'n' || e.key === 'N') { e.preventDefault(); newManualTask(); }
    });
    // pasting an e-mail anywhere on the page (not into a field) opens the paste dialog with it
    document.addEventListener('paste', function (e) {
      var tag = (e.target && e.target.tagName) || '';
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || document.querySelector('dialog[open]')) return;
      var files = e.clipboardData && e.clipboardData.files;
      if (files && files.length) { e.preventDefault(); importFiles(files).catch(fail); return; }
      var txt = e.clipboardData && e.clipboardData.getData('text/plain');
      if (txt && txt.trim().length > 20) { e.preventDefault(); openPaste(txt); }
    });
  }
  async function newManualTask() {
    var t = newTask({ title: 'New task' });
    await saveTask(t);
    renderMain();
    openTask(t.id);
    var ti = $('d-title');
    if (ti) { ti.focus(); ti.select(); }
  }

  async function start() {
    FX = window.DeskFeatures.init(core);
    loadUi();
    setupUi();
    setupBulk();
    setupDrop();
    try { await openDb(); await loadState(); } catch (e) { console.error(e); $('storage-error').hidden = false; }
    if (window.BroadcastChannel) {
      bc = new BroadcastChannel(CHANNEL);
      var rt = null;
      bc.onmessage = function () {
        clearTimeout(rt);
        rt = setTimeout(function () {
          loadState().then(function () {
            hayCache = {};
            renderMain();
            var a = document.activeElement, inDetail = a && $('detail').contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName);
            if ($('detail').open && !inDetail && !$('confedit').open) { if (taskById(state.openId)) refreshDetail(); else closeDetail(); }
          }).catch(console.error);
        }, 150);
      };
    }
    renderMain();
    updateStorageLine();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persisted().then(function (p) { if (!p) return navigator.storage.persist(); }).catch(function () {});
    attachSync();
    // the day changes at midnight (Ljubljana): refresh "today"
    var lastDay = todayIso();
    setInterval(function () { if (todayIso() !== lastDay) { lastDay = todayIso(); renderMain(); } }, 60000);
  }

  // helpers shared with features.js
  var core = {
    $: $, h: h, icon: icon, clear: clear, append: append, state: state, X: X, STATUSES: STATUSES,
    todayIso: todayIso, isoOf: isoOf, addDays: addDays, fmtDate: fmtDate, fmtDateWd: fmtDateWd, fmtDateTime: fmtDateTime, fmtTime: fmtTime, fmtRange: fmtRange,
    money: money, plural: plural, uid: uid, nowIso: nowIso, norm: norm, statusOf: statusOf, personLabel: personLabel, personFull: personFull, fileSize: fileSize,
    visibleTasks: visibleTasks, sortTasks: sortTasks, taskById: taskById, openTask: openTask, setStatus: setStatus, saveTask: saveTask, saveMail: saveMail,
    newTask: newTask, rowEl: rowEl, groupEl: groupEl, statusPill: statusPill, dueBadge: dueBadge, provIcon: provIcon, confSummary: confSummary, openFile: openFile, openItems: openItems,
    renderMain: renderMain, toast: toast, ask: ask, fail: fail, changed: changed, idb: idb, putFile: putFile, getBlob: getBlob, replaceAll: replaceAll,
    gcFiles: gcFiles, loadState: loadState, snapshot: snapshot, setView: setView, saveUi: saveUi, closeDetail: closeDetail, updateStorageLine: updateStorageLine,
    referencedFiles: referencedFiles, cleanTask: cleanTask, setApplying: function (v) { applying = v; }
  };

  // exposed for the end-to-end test only
  window.__deskApp = { state: state, importFiles: importFiles, get sync() { return sync; }, sanitize: function (h2, r) { return sanitizeMailHtml(h2, r, {}); } };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
