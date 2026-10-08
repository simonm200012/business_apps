/* AdrialBus: browser-local snapshots + message queue between apps (IndexedDB 'adrial-bus'). */
(function () {
  var APP = (location.pathname.split('/')[1] || 'app'), bc = null, lis = [], dbp = null;
  try { bc = new BroadcastChannel('adrial-bus'); bc.onmessage = function (e) { fire(e.data); }; } catch (e) {}
  function fire(d) { lis.forEach(function (f) { try { f(d); } catch (e) {} }); }
  function note(d) { fire(d); try { bc && bc.postMessage(d); } catch (e) {} }
  function open() {
    if (dbp) return dbp;
    dbp = new Promise(function (res) {
      if (!window.indexedDB) return res(null);
      var r = indexedDB.open('adrial-bus', 1);
      r.onupgradeneeded = function () { var d = r.result; d.createObjectStore('shared', { keyPath: 'key' }); var m = d.createObjectStore('messages', { keyPath: 'id' }); m.createIndex('to_status', ['to', 'status']); };
      r.onsuccess = function () { res(r.result); }; r.onerror = r.onblocked = function () { res(null); };
    });
    return dbp;
  }
  function tx(store, mode, fn) {
    return open().then(function (db) {
      if (!db) return null;
      return new Promise(function (res) {
        try { var t = db.transaction(store, mode), out = fn(t.objectStore(store)); t.oncomplete = function () { res(out && out.result !== undefined ? out.result : true); }; t.onerror = t.onabort = function () { res(null); }; } catch (e) { res(null); }
      });
    });
  }
  function all(store) { return open().then(function (db) { return !db ? [] : new Promise(function (res) { var r = db.transaction(store).objectStore(store).getAll(); r.onsuccess = function () { res(r.result || []); }; r.onerror = function () { res([]); }; }); }); }
  var B = {
    available: !!window.indexedDB,
    publish: function (key, data) { return tx('shared', 'readwrite', function (s) { s.put({ key: key, from: APP, updatedAt: Date.now(), data: data }); }).then(function (ok) { if (ok) note({ kind: 'snapshot', key: key }); return !!ok; }); },
    read: function (key) { return open().then(function (db) { return !db ? null : new Promise(function (res) { var r = db.transaction('shared').objectStore('shared').get(key); r.onsuccess = function () { res(r.result || null); }; r.onerror = function () { res(null); }; }); }); },
    send: function (to, type, payload) { var id = 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); return tx('messages', 'readwrite', function (s) { s.put({ id: id, from: APP, to: to, type: type, payload: payload, status: 'new', createdAt: Date.now() }); }).then(function () { note({ kind: 'message', to: to, type: type }); return id; }); },
    inbox: function (to) { return all('messages').then(function (l) { return l.filter(function (m) { return m.to === to && m.status === 'new'; }).sort(function (a, b) { return a.createdAt - b.createdAt; }); }); },
    settle: function (id, status, result) { return all('messages').then(function (l) { var m = l.filter(function (x) { return x.id === id; })[0]; if (!m) return false; m.status = status; m.result = result; m.settledAt = Date.now(); return tx('messages', 'readwrite', function (s) { s.put(m); }).then(function () { note({ kind: 'message', to: m.from, type: m.type }); return true; }); }); },
    done: function (id, result) { return B.settle(id, 'done', result); },
    fail: function (id, reason) { return B.settle(id, 'failed', reason); },
    history: function (filter) { return all('messages').then(function (l) { return filter ? l.filter(filter) : l; }); },
    on: function (f) { lis.push(f); return function () { lis = lis.filter(function (x) { return x !== f; }); }; },
    reset: function (prefix) {
      return Promise.all([all('shared'), all('messages')]).then(function (r) {
        return tx('shared', 'readwrite', function (s) { r[0].forEach(function (x) { if (x.key.indexOf(prefix + '.') === 0) s.delete(x.key); }); }).then(function () {
          return tx('messages', 'readwrite', function (s) { r[1].forEach(function (m) { if (m.from === prefix || m.to === prefix) s.delete(m.id); }); });
        }).then(function () { return B.publish(prefix + '.reset', Date.now()); });
      });
    }
  };
  window.AdrialBus = B;
})();
