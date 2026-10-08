/* AM.S: IndexedDB persistence (db 'adrial-mail', store 'kv') + BroadcastChannel */
(function () {
  const AM = window.AM = window.AM || {};
  const S = AM.S = { KEYS: ['meta', 'settings', 'products', 'profiles', 'events', 'lists', 'segments', 'campaigns', 'flows', 'templates', 'forms', 'runs'], mem: false, tab: Math.random().toString(36).slice(2) };
  let dbp = null, getter = null, timer = null, bc = null, flushing = Promise.resolve(); const queue = new Set(), hs = [];
  try { bc = new BroadcastChannel('adrial-mail'); bc.onmessage = e => { const m = e.data; if (!m || m.tab === S.tab) return; hs.forEach(f => { try { f(m); } catch (x) { console.error(x); } }); }; } catch (e) { bc = null; }
  S.open = () => dbp || (dbp = new Promise(res => {
    if (!window.indexedDB) { S.mem = true; return res(null); }
    const to = setTimeout(() => { S.mem = true; res(null); }, 5000);
    try {
      const r = indexedDB.open('adrial-mail', 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('kv'); };
      r.onsuccess = () => { clearTimeout(to); res(r.result); };
      r.onerror = r.onblocked = () => { clearTimeout(to); S.mem = true; res(null); };
    } catch (e) { clearTimeout(to); S.mem = true; res(null); }
  }));
  S.bind = fn => { getter = fn; };
  S.on = fn => { hs.push(fn); };
  S.post = m => { try { bc && bc.postMessage(Object.assign({ tab: S.tab }, m)); } catch (e) {} };
  const getAll = (db, keys) => new Promise(res => {
    const out = {}; let left = keys.length;
    try {
      const st = db.transaction('kv').objectStore('kv');
      keys.forEach(k => { const q = st.get(k); q.onsuccess = () => { out[k] = q.result; if (!--left) res(out); }; q.onerror = () => { if (!--left) res(out); }; });
    } catch (e) { res(out); }
  });
  S.load = async () => {
    const db = await S.open(); if (!db) return null;
    const o = await getAll(db, S.KEYS);
    return o.meta && o.profiles && o.events ? o : null;
  };
  S.loadKeys = async keys => { const db = await S.open(); return db ? getAll(db, keys) : {}; };
  const put = (db, obj) => new Promise(res => {
    try {
      const tx = db.transaction('kv', 'readwrite'), st = tx.objectStore('kv');
      Object.keys(obj).forEach(k => st.put(obj[k], k));
      tx.oncomplete = () => res(true); tx.onerror = tx.onabort = () => res(false);
    } catch (e) { res(false); }
  });
  S.saveAll = async db => { const d = await S.open(); if (!d) return false; const ok = await put(d, S.KEYS.reduce((o, k) => { o[k] = db[k]; return o; }, {})); return ok; };
  S.clear = async () => { const d = await S.open(); if (!d) return; await new Promise(res => { try { const tx = d.transaction('kv', 'readwrite'); tx.objectStore('kv').clear(); tx.oncomplete = tx.onerror = tx.onabort = () => res(); } catch (e) { res(); } }); };
  S.save = keys => { (keys || []).forEach(k => queue.add(k)); queue.add('meta'); clearTimeout(timer); timer = setTimeout(S.flush, 180); };
  S.flush = () => {
    clearTimeout(timer); timer = null;
    const keys = Array.from(queue); queue.clear(); if (!keys.length || !getter) return flushing;
    flushing = flushing.then(async () => {
      const db = getter(), d = await S.open(); if (!d || !db) return;
      const obj = {}; keys.forEach(k => { obj[k] = db[k]; });
      const ok = await put(d, obj);
      if (ok) S.post({ type: 'saved', keys });
      else if (!S.warned) { S.warned = true; AM.U.toast('Could not save to this browser; changes may be lost on reload.', 'warn'); }
    });
    return flushing;
  };
  window.addEventListener('pagehide', () => { S.flush(); });
})();
