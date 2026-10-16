/* Postbench — photos and logos live in IndexedDB ("stratum-postbench", store "img", one Blob per picture), not in
 * localStorage. localStorage is shared by every app on this site (about 5 MB in all), so one plan with a few photos
 * used to fill it and the photos were dropped. The saved designs now hold small references ("pbimg:<key>") instead
 * of the pictures; the key is a hash of the picture, so saving the same picture twice stores it once.
 * Old saves with pictures inside still load as they are and move to IndexedDB the next time they are saved.
 * If IndexedDB is not available (some private windows), pictures stay inside the save as before.
 * The pure helpers (hash, externalize, internalize) are tested in tools/tests/postbench-local.test.js. */
(function (root) {
  'use strict';
  var P = {};
  var PREFIX = 'pbimg:', DBN = 'stratum-postbench', STORE = 'img';
  P.PREFIX = PREFIX;
  // FNV-1a over the whole string, two lanes for fewer collisions, plus the length
  P.hash = function (s) {
    var h1 = 0x811c9dc5, h2 = 0x1b873593;
    for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 ^ c, 2246822507); }
    return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36) + '-' + s.length.toString(36);
  };
  P.isPic = function (v) { return typeof v === 'string' && /^data:image\/[a-z0-9.+-]+;base64,/i.test(v) && v.length > 200; };
  P.isRef = function (v) { return typeof v === 'string' && v.indexOf(PREFIX) === 0; };
  // deep copy with every picture replaced by a reference; put(key, dataUrl) is called once per picture
  P.externalize = function (v, put) {
    if (P.isPic(v)) { var k = P.hash(v); put(k, v); return PREFIX + k; }
    if (Array.isArray(v)) return v.map(function (x) { return P.externalize(x, put); });
    if (v && typeof v === 'object') { var o = {}; Object.keys(v).forEach(function (k) { o[k] = P.externalize(v[k], put); }); return o; }
    return v;
  };
  // deep copy with references swapped back; get(key) → Promise<dataUrl|null>. A missing picture becomes null.
  P.internalize = function (v, get) {
    if (P.isRef(v)) return Promise.resolve(get(v.slice(PREFIX.length))).then(function (d) { return d || null; }, function () { return null; });
    if (Array.isArray(v)) return Promise.all(v.map(function (x) { return P.internalize(x, get); }));
    if (v && typeof v === 'object') {
      var keys = Object.keys(v);
      return Promise.all(keys.map(function (k) { return P.internalize(v[k], get); })).then(function (vals) { var o = {}; keys.forEach(function (k, i) { o[k] = vals[i]; }); return o; });
    }
    return Promise.resolve(v);
  };
  P.refsIn = function (text) { var out = {}, re = /pbimg:([a-z0-9-]+)/g, m; while ((m = re.exec(String(text || '')))) out[m[1]] = 1; return out; };
  root.PBPics = P;
  if (typeof module !== 'undefined' && module.exports) module.exports = P;
  if (typeof indexedDB === 'undefined' || typeof document === 'undefined') return;

  // ── IndexedDB (browser only) ─────────────────────────────────────────
  var dbp = null, mem = new Map(), pending = new Map();
  function open() {
    if (dbp) return dbp;
    dbp = new Promise(function (res) {
      var req, done = false, fin = function (d) { if (!done) { done = true; res(d); } };
      try { req = indexedDB.open(DBN, 1); } catch (e) { return fin(null); }
      setTimeout(function () { fin(null); }, 4000);
      req.onupgradeneeded = function () { var d = req.result; if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE); };
      req.onsuccess = function () { var d = req.result; d.onversionchange = function () { try { d.close(); } catch (e) {} dbp = null; }; fin(d); };
      req.onerror = function () { fin(null); };
    });
    return dbp;
  }
  function toBlob(dataUrl) {
    var i = dataUrl.indexOf(','), mime = dataUrl.slice(5, dataUrl.indexOf(';')), bin = atob(dataUrl.slice(i + 1)), a = new Uint8Array(bin.length);
    for (var j = 0; j < bin.length; j++) a[j] = bin.charCodeAt(j);
    return new Blob([a], { type: mime });
  }
  function toDataUrl(blob) { return new Promise(function (res) { var fr = new FileReader(); fr.onload = function () { res(String(fr.result || '')); }; fr.onerror = function () { res(null); }; fr.readAsDataURL(blob); }); }
  P.ok = false;
  P.ready = open().then(function (d) { P.ok = !!d; return P.ok; });
  // queue a write; the save in localStorage only refers to it, so it is written before anything else happens
  P.put = function (key, dataUrl) {
    mem.set(key, dataUrl);
    if (pending.has(key)) return pending.get(key);
    var p = open().then(function (d) {
      if (!d) return false;
      return new Promise(function (res) {
        var t; try { t = d.transaction(STORE, 'readwrite'); } catch (e) { return res(false); }
        t.objectStore(STORE).put({ blob: toBlob(dataUrl), at: Date.now() }, key);
        t.oncomplete = function () { res(true); }; t.onerror = t.onabort = function () { res(false); };
      });
    }).then(function (ok) { pending.delete(key); return ok; });
    pending.set(key, p);
    return p;
  };
  P.get = function (key) {
    if (mem.has(key)) return Promise.resolve(mem.get(key));
    return open().then(function (d) {
      if (!d) return null;
      return new Promise(function (res) {
        var t; try { t = d.transaction(STORE, 'readonly'); } catch (e) { return res(null); }
        var r = t.objectStore(STORE).get(key);
        r.onsuccess = function () { var v = r.result; if (!v || !v.blob) return res(null); toDataUrl(v.blob).then(function (u) { if (u) mem.set(key, u); res(u); }); };
        r.onerror = function () { res(null); };
      });
    });
  };
  P.flush = function () { return Promise.all(Array.from(pending.values())); };
  // remove pictures no save refers to any more (older than a minute, so another tab's fresh picture is safe)
  P.gc = function (texts) {
    var keep = {}; texts.forEach(function (t) { Object.assign(keep, P.refsIn(t)); });
    return P.flush().then(open).then(function (d) {
      if (!d) return 0;
      return new Promise(function (res) {
        var n = 0, t; try { t = d.transaction(STORE, 'readwrite'); } catch (e) { return res(0); }
        var st = t.objectStore(STORE), req = st.openCursor();
        req.onsuccess = function () {
          var c = req.result; if (!c) return;
          if (!keep[c.key] && !(c.value && c.value.at > Date.now() - 60e3)) { c.delete(); mem.delete(c.key); n++; }
          c.continue();
        };
        t.oncomplete = function () { res(n); }; t.onerror = t.onabort = function () { res(n); };
      });
    });
  };
})(typeof window !== 'undefined' ? window : globalThis);
