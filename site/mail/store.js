/* Adrial Mail — persistence. IndexedDB database "adrial-mail", object store "kv" (one record per
 * collection). Falls back to memory if IndexedDB is unavailable. BroadcastChannel("adrial-mail")
 * tells other open tabs which collections changed. localStorage is NOT used for data. */
(function () {
  'use strict';
  var AM = window.AM;
  var S = AM.S = {};
  var KEYS = ['meta', 'settings', 'products', 'profiles', 'events', 'lists', 'segments', 'campaigns', 'flows', 'templates', 'forms', 'runs'];
  S.KEYS = KEYS;
  var DBN = 'adrial-mail', STORE = 'kv', dbp = null, chan = null, pending = new Set(), timer = null, getDb = null, listeners = [];
  var TAB = Math.random().toString(36).slice(2);
  S.available = true;
  try { chan = new BroadcastChannel('adrial-mail'); } catch (e) { chan = null; }

  function open() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve) {
      var req;
      try { req = indexedDB.open(DBN, 1); } catch (e) { S.available = false; return resolve(null); }
      var done = false, fin = function (v) { if (!done) { done = true; resolve(v); } };
      // never hang the app on a blocked/stuck open (e.g. a pending deleteDatabase) → memory fallback
      setTimeout(function () { if (!done) { S.available = false; fin(null); } }, 5000);
      req.onupgradeneeded = function () { var d = req.result; if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE); };
      req.onsuccess = function () {
        var d = req.result;
        // let other tabs / a "clear site data" delete or upgrade the database instead of blocking them
        d.onversionchange = function () { try { d.close(); } catch (e) {} dbp = null; };
        if (done) { try { d.close(); } catch (e) {} return; }
        fin(d);
      };
      req.onerror = function () { S.available = false; fin(null); };
    });
    return dbp;
  }
  S.open = open;

  S.load = function () {
    return open().then(function (d) {
      if (!d) return null;
      return new Promise(function (resolve) {
        var out = {}, t;
        try { t = d.transaction(STORE, 'readonly'); } catch (e) { return resolve(null); }
        var st = t.objectStore(STORE);
        KEYS.forEach(function (k) { var r = st.get(k); r.onsuccess = function () { out[k] = r.result; }; });
        t.oncomplete = function () { resolve(out.meta ? out : null); };
        t.onerror = t.onabort = function () { resolve(null); };
      });
    });
  };
  S.loadKeys = function (keys) {
    return open().then(function (d) {
      if (!d) return null;
      return new Promise(function (resolve) {
        var out = {}, t = d.transaction(STORE, 'readonly'), st = t.objectStore(STORE);
        keys.forEach(function (k) { var r = st.get(k); r.onsuccess = function () { out[k] = r.result; }; });
        t.oncomplete = function () { resolve(out); };
        t.onerror = t.onabort = function () { resolve(null); };
      });
    });
  };
  function write(db, keys) {
    return open().then(function (d) {
      if (!d) return false;
      return new Promise(function (resolve) {
        var t;
        try { t = d.transaction(STORE, 'readwrite'); } catch (e) { return resolve(false); }
        var st = t.objectStore(STORE);
        keys.forEach(function (k) { try { st.put(db[k], k); } catch (e) { console.error('save', k, e); } });
        t.oncomplete = function () { resolve(true); };
        t.onerror = t.onabort = function () { resolve(false); };
      });
    });
  }
  S.saveAll = function (db) { return write(db, KEYS); };
  // Queue collections for saving (debounced). getter returns the live db object.
  S.bind = function (getter) { getDb = getter; };
  S.save = function (keys) {
    (Array.isArray(keys) ? keys : [keys]).forEach(function (k) { pending.add(k); });
    pending.add('meta');
    clearTimeout(timer);
    timer = setTimeout(S.flush, 180);
  };
  S.flush = function () {
    clearTimeout(timer);
    if (!pending.size || !getDb) return Promise.resolve();
    var keys = Array.from(pending); pending.clear();
    var db = getDb(); db.meta.savedAt = Date.now(); db.meta.savedBy = TAB;
    return write(db, keys).then(function (ok) {
      if (!ok && S.available) { S.available = false; listeners.forEach(function (fn) { fn({ type: 'unavailable' }); }); }
      if (ok && chan) try { chan.postMessage({ type: 'saved', keys: keys, tab: TAB }); } catch (e) {}
      if (ok && S.afterSave) try { S.afterSave(keys); } catch (e) { console.error(e); }
    });
  };
  S.clear = function () {
    return open().then(function (d) {
      if (!d) return;
      return new Promise(function (resolve) {
        var t = d.transaction(STORE, 'readwrite'); t.objectStore(STORE).clear();
        t.oncomplete = t.onerror = t.onabort = function () { resolve(); };
      });
    });
  };
  S.broadcast = function (msg) { msg.tab = TAB; if (chan) try { chan.postMessage(msg); } catch (e) {} };
  S.on = function (fn) { listeners.push(fn); };
  if (chan) chan.onmessage = function (e) { var m = e.data || {}; if (m.tab === TAB) return; listeners.forEach(function (fn) { try { fn(m); } catch (err) { console.error(err); } }); };
  window.addEventListener('pagehide', function () { if (pending.size) S.flush(); });
})();
