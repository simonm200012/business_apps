/* Collections team workspaces, browser side (Business Apps). Server side: worker/workspaces.js; the operations and how
 * they merge: ws-ops.js.
 *
 * "Personal copy" is today's behaviour, unchanged: this browser's data plus the person's own cloud copy (StratumSync).
 * A team workspace is a separate data set shared by the people of one company, kept in its own IndexedDB database
 * ("stratum-collections-ws"), never mixed with the personal data. The choice lives in localStorage
 * "stratum-collections-ws" and switching reloads the page, so the personal cloud sync is never attached to team data.
 *
 * In a workspace every saved change becomes small operations (diff of the document against the last state, ws-ops.js):
 *   - they go into a queue in IndexedDB first (kept when offline or when the tab closes) and are sent soon after;
 *   - the Worker numbers them in one order; this device then pulls everything after the last number it has (on focus,
 *     when the page is shown again, when back online and every 30 s while open) and applies it;
 *   - the screen shows: the confirmed state + this device's queued operations on top. Same op id twice → applied once.
 *   - now and then an editor's device stores a compacted state, so a new device does not replay everything.
 * Viewers get a read-only screen (the server refuses their changes anyway).
 *
 * Invitations: there is no mail service, so the owner's browser writes the invitation (inviteMail: an .eml draft with
 * "X-Unsent: 1" through outbox.js buildEml, a mailto: link and plain text, in SL/HR/EN) and the Worker only records
 * invitedAt (POST …/invite). The link is <origin>/collections/?ws=<id>: it selects that workspace for a member, anyone
 * else sees "You don't have access to this workspace" (the same for one that does not exist).
 * Deleting (owner, Team page → danger zone): DELETE /api/ws/:id with the typed name, repeated until done; then this
 * device clears that workspace's IndexedDB data and queue and goes back to the personal copy. Other members' devices
 * get 410 on their next request and do the same (offering "Download my copy as JSON" first if changes were not sent).
 *
 * createEngine(opts), inviteMail(o), linkId(search) and resolveLink(id, call, current) have no DOM and are what the
 * Node tests drive (tools/tests/collections-workspaces*.test.js); CollWs.boot(hooks) and the rest bind it to the app
 * (app.js). Texts go through the app's tx() (i18n.js). */
(function (root, factory) {
  var node = typeof module === 'object' && module.exports;
  var api = factory(node ? require('./ws-ops.js') : root.CollWsOps, root, node ? require('./i18n.js') : root.CollI18n,
    function () { return node ? require('./outbox.js') : root.CollOutbox; });
  if (node) module.exports = api; else root.CollWs = api;
})(typeof self !== 'undefined' ? self : this, function (OPS, root, I18N, outbox) {
  'use strict';

  var WSID = /^[a-z0-9][a-z0-9-]{0,39}$/;
  var SEL_KEY = 'stratum-collections-ws', LINK_KEY = 'stratum-collections-ws-link', NOTE_KEY = 'stratum-collections-ws-note';
  var CF_DASH = 'https://one.dash.cloudflare.com/';
  var MAX_OP = 30 * 1024, BATCH_OPS = 200, BATCH_BYTES = 400 * 1024;
  var COMPACT_AT = 300, FAR_BEHIND = 2000, POLL_MS = 30000, INFO_MS = 5 * 60000;

  function P(v) { return Promise.resolve(v); }
  function rid() {
    var a = new Uint8Array(14), c = (root && root.crypto) || (typeof globalThis !== 'undefined' && globalThis.crypto);
    if (c && c.getRandomValues) c.getRandomValues(a); else for (var i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
    return 'o' + Array.prototype.map.call(a, function (b) { return (b % 36).toString(36); }).join('');
  }
  function err(code, msg, extra) { var e = new Error(msg || code); e.code = code; if (extra) for (var k in extra) e[k] = extra[k]; return e; }

  // ── the engine: queue, push, pull, compaction (no DOM) ─────────────────────────────────────────────────────────────
  /* opts: { id, me, role, fetch(url, init) → Response, store: { get(k), update(k, fn(cur) → next) → next },
   *         valid(doc) → bool, onChange(view, { remote }), onStatus(status) } */
  function createEngine(o) {
    var base = '/api/ws/' + encodeURIComponent(o.id), K = 'ws:' + o.id + ':', me = String(o.me || '');
    var st = { base: null, pending: [], status: 'idle', message: '', role: o.role || 'viewer', info: null, head: 0, snapSeq: 0, lastOk: 0, refused: 0, deleted: null };
    var running = null, again = false;

    function req(method, path, body, raw) {
      var init = { method: method, headers: { 'X-Stratum-Apps': '1' }, redirect: 'manual', credentials: 'same-origin', cache: 'no-store' };
      if (body !== undefined) { init.body = raw ? body : JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
      return P().then(function () { return o.fetch(base + path, init); }).then(function (r) {
        if (r.type === 'opaqueredirect' || r.status === 0 || r.status === 401) throw err('expired', 'Your sign-in has expired.');
        return r;
      }, function () { throw err('offline', 'offline'); });
    }
    function fail(r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 410 && j.deleted) st.deleted = { at: j.deletedAt || null, by: j.deletedBy || null, unfinished: !!j.unfinished, name: j.name || '' };
        throw err(r.status === 410 ? 'deleted' : r.status === 404 ? 'gone' : r.status === 403 ? 'forbidden' : r.status === 409 ? 'busy' : 'error', j.error || ('HTTP ' + r.status), { status: r.status, body: j });
      });
    }
    function ok(r) { return r.ok ? r.json() : fail(r); }
    function canWrite() { return st.role === 'owner' || st.role === 'editor'; }
    function status() { return { status: st.status, message: st.message, pending: st.pending.length, role: st.role, seq: st.base ? st.base.seq : 0, head: st.head, lastOk: st.lastOk, hasData: !!st.base, refused: st.refused, deleted: st.deleted }; }
    function setStatus(s, msg) { st.status = s; st.message = msg || ''; if (o.onStatus) { try { o.onStatus(status()); } catch (e) { /* UI only */ } } }
    function saveBase() {
      var mine = st.base;
      return o.store.update(K + 'base', function (cur) { return cur && cur.seq > mine.seq ? cur : mine; });
    }

    function view() {
      if (!st.base) return null;
      var v = OPS.clone(st.base.state);
      st.pending.forEach(function (op) { OPS.apply(v, { id: op.id, type: op.type, p: op.p, by: me }); });
      return v;
    }
    function refreshInfo() {
      return req('GET', '').then(ok).then(function (j) {
        st.info = j; st.role = j.role; st.head = j.head || st.head;
        if (j.snap && j.snap.seq > st.snapSeq) st.snapSeq = j.snap.seq;
        if (!j.ready && st.status === 'idle') setStatus('setup');
        return j;
      }).catch(function (e) { if (e.code === 'gone' || e.code === 'deleted' || e.code === 'expired') setStatus(e.code); throw e; });
    }
    function fetchSnapshot() {
      return req('GET', '/snapshot').then(function (r) {
        if (r.status === 404) { setStatus('setup'); return false; }
        if (!r.ok) return fail(r);
        var seq = parseInt(r.headers.get('X-Ws-Seq'), 10) || 0;
        return r.json().then(function (state) {
          if (o.valid && !o.valid(state)) throw err('error', 'The shared data is not Collections data this version can read.');
          st.base = { seq: seq, state: state }; if (seq > st.snapSeq) st.snapSeq = seq;
          return saveBase().then(function () { return true; });
        });
      });
    }
    /** the confirmed state and the queue from this device's storage; fetches the compacted state when there is none */
    function load() {
      return Promise.all([o.store.get(K + 'base'), o.store.get(K + 'pending')]).then(function (v) {
        st.base = v[0] && typeof v[0].seq === 'number' && v[0].state ? v[0] : null;
        st.pending = Array.isArray(v[1]) ? v[1] : [];
        if (st.base) return true;
        return fetchSnapshot().catch(function (e) { setStatus(e.code || 'error', e.message); return false; });
      });
    }
    /** another tab of this workspace changed the stored state or queue: take it */
    function reload() {
      return Promise.all([o.store.get(K + 'base'), o.store.get(K + 'pending')]).then(function (v) {
        var changed = false;
        if (v[0] && v[0].state && (!st.base || v[0].seq > st.base.seq)) { st.base = v[0]; changed = true; }
        var p = Array.isArray(v[1]) ? v[1] : [];
        if (p.length !== st.pending.length || p.some(function (x, i) { return !st.pending[i] || st.pending[i].id !== x.id; })) { st.pending = p; changed = true; }
        if (changed && o.onChange) o.onChange(view(), { remote: true });
        return changed;
      });
    }
    /** queue this device's operations ({ type, p }); returns them with their ids */
    function local(list) {
      var add = (list || []).map(function (op) { return { id: rid(), type: op.type, p: op.p }; });
      if (!add.length) return P(add);
      st.pending = st.pending.concat(add);
      if (st.status === 'synced' || st.status === 'idle') setStatus('pending');
      return o.store.update(K + 'pending', function (cur) {
        cur = Array.isArray(cur) ? cur : [];
        var have = {}; cur.forEach(function (x) { have[x.id] = 1; });
        return cur.concat(add.filter(function (x) { return !have[x.id]; }));
      }).then(function (all) { st.pending = all; return add; });
    }
    function dropPending(ids) {
      return o.store.update(K + 'pending', function (cur) { return (Array.isArray(cur) ? cur : []).filter(function (x) { return !ids[x.id]; }); })
        .then(function (left) { st.pending = left; return left; });
    }
    function batches(list) {
      var out = [], cur = [], size = 0;
      list.forEach(function (op) {
        var n = JSON.stringify(op).length;
        if (cur.length && (cur.length >= BATCH_OPS || size + n > BATCH_BYTES)) { out.push(cur); cur = []; size = 0; }
        cur.push(op); size += n;
      });
      if (cur.length) out.push(cur);
      return out;
    }
    function pushAll(done) {
      if (!st.pending.length) return P();
      if (!canWrite()) { st.refused = st.pending.length; return P(); }
      var list = batches(st.pending.slice()), i = 0;
      function next() {
        if (i >= list.length) return P();
        var b = list[i++];
        return req('POST', '/ops', { ops: b }).then(function (r) {
          if (r.status === 400) { // refused for good (a bug or an op from a newer version): never block the queue with it
            return r.json().catch(function () { return {}; }).then(function (j) { b.forEach(function (x) { done[x.id] = 1; }); st.dropped = true; if (root && root.console) console.warn('Collections workspace: changes refused', j.error); });
          }
          return ok(r).then(function (j) { (j.dup || []).forEach(function (id) { done[id] = 1; }); });
        }).then(next);
      }
      return next().catch(function (e) {
        if (e.code === 'forbidden') { st.role = 'viewer'; st.refused = st.pending.length; return; }
        if (e.code === 'busy') return; // still being set up
        throw e;
      });
    }
    function pullAll(done) {
      var foreign = false, got = 0, mine = {};
      st.pending.forEach(function (x) { mine[x.id] = 1; });
      function step() {
        return req('GET', '/ops?since=' + st.base.seq).then(ok).then(function (j) {
          st.head = j.head;
          (j.ops || []).forEach(function (op) {
            if (!(op.seq > st.base.seq)) return;
            OPS.apply(st.base.state, op); st.base.seq = op.seq; got++;
            done[op.id] = 1;
            if (!mine[op.id] && op.type.indexOf('ws.') !== 0) foreign = true;
          });
          if (j.more && j.ops && j.ops.length) return step();
        });
      }
      var far = st.snapSeq - st.base.seq > FAR_BEHIND;
      return (far ? fetchSnapshot().then(function () { foreign = true; }) : P()).then(step).then(function () { return { got: got, foreign: foreign }; });
    }
    function compact() {
      if (!canWrite() || st.pending.length || !st.base || st.base.seq - st.snapSeq < COMPACT_AT) return P(false);
      var seq = st.base.seq;
      return req('PUT', '/snapshot?seq=' + seq, JSON.stringify(st.base.state), true).then(function (r) {
        if (r.ok) { st.snapSeq = seq; return true; }
        return r.json().catch(function () { return {}; }).then(function (j) { if (j.seq > st.snapSeq) st.snapSeq = j.seq; return false; });
      }).catch(function () { return false; });
    }
    function once() {
      var done = {};
      return (st.base ? P(true) : fetchSnapshot()).then(function (have) {
        if (!have) return null;
        return o.store.get(K + 'pending').then(function (p) { if (Array.isArray(p)) st.pending = p; })
          .then(function () { return pushAll(done); })
          .then(function () { return pullAll(done); })
          .then(function (res) {
            var dropped = st.dropped; st.dropped = false;
            return dropPending(done).then(function () {
              var w = res.got ? saveBase() : P();
              return w.then(function () {
                st.lastOk = Date.now();
                if (st.refused && !canWrite()) setStatus('readonly', '');
                else setStatus(st.pending.length ? 'pending' : 'synced');
                if ((res.foreign || dropped) && o.onChange) o.onChange(view(), { remote: res.foreign });
                return res;
              });
            });
          });
      }).then(function (res) { return res ? compact().then(function () { return res; }) : res; });
    }
    /** push the queue, then pull everything new; one run at a time (a call during a run runs once more after it) */
    function sync() {
      if (running) { again = true; return running; }
      running = once().catch(function (e) {
        setStatus(e.code === 'offline' || e.code === 'expired' || e.code === 'gone' || e.code === 'deleted' ? e.code : 'error', e.message);
        return null;
      }).then(function (res) {
        running = null;
        if (again) { again = false; return sync(); }
        return res;
      });
      return running;
    }
    /** a viewer's (or a removed editor's) queued changes the server refused: drop them, explicitly */
    function discard() {
      var all = {}; st.pending.forEach(function (x) { all[x.id] = 1; });
      return dropPending(all).then(function () { st.refused = 0; setStatus('synced'); if (o.onChange) o.onChange(view(), { remote: false }); });
    }
    /** forget this workspace on this device: the stored state and the queue (after it was deleted, or left) */
    function clear() {
      var del = function (k) { return o.store.del ? o.store.del(k) : o.store.update(k, function () { return null; }); };
      st.base = null; st.pending = [];
      return Promise.all([del(K + 'base'), del(K + 'pending')]).then(function () { return true; });
    }
    /** owner: delete the workspace on the server. The Worker moves it in steps (202 = not done yet): repeat until done.
     * A 410 means it is already deleted (an earlier attempt finished). onStep({ moved }) after every step. */
    function remove(name, onStep) {
      var moved = 0, steps = 0;
      function step() {
        return req('DELETE', '', { name: name }).then(function (r) {
          if (r.status === 410) return { done: true, moved: moved, already: true };
          if (r.status !== 200 && r.status !== 202) return fail(r);
          return r.json().then(function (j) {
            moved += j.moved || 0; steps++;
            if (onStep) { try { onStep({ moved: moved, steps: steps }); } catch (e) { /* UI only */ } }
            if (j.done) { st.deleted = { at: j.deletedAt || null, by: j.deletedBy || me }; return { done: true, moved: moved }; }
            if (steps > 1000) throw err('error', 'The workspace could not be deleted completely. Try again.');
            return step();
          });
        });
      }
      return step();
    }
    return { load: load, reload: reload, sync: sync, local: local, view: view, status: status, refreshInfo: refreshInfo, discard: discard, compact: compact, clear: clear, remove: remove,
      request: req, ok: ok, info: function () { return st.info; }, role: function () { return st.role; }, me: function () { return me; }, canWrite: canWrite,
      _state: st };
  }

  // ── storage: IndexedDB "stratum-collections-ws" (one key per workspace and kind), memory when blocked ──────────────
  function idbStore() {
    var dbp = null, mem = new Map(), useMem = false;
    function open() {
      if (!dbp) dbp = new Promise(function (resolve, reject) {
        try {
          var rq = root.indexedDB.open('stratum-collections-ws', 1);
          rq.onupgradeneeded = function () { if (!rq.result.objectStoreNames.contains('kv')) rq.result.createObjectStore('kv'); };
          rq.onsuccess = function () { var d = rq.result; d.onversionchange = function () { d.close(); dbp = null; }; resolve(d); };
          rq.onerror = function () { reject(rq.error); }; rq.onblocked = function () { reject(new Error('blocked')); };
        } catch (e) { reject(e); }
      });
      return dbp;
    }
    function trans(mode, fn) {
      if (useMem || !root.indexedDB) { useMem = true; return P(fn(null)); }
      return open().then(function (d) {
        return new Promise(function (resolve, reject) {
          var t = d.transaction('kv', mode), out = { v: undefined };
          fn(t.objectStore('kv'), out);
          t.oncomplete = function () { resolve(out.v); };
          t.onerror = t.onabort = function () { reject(t.error); };
        });
      }).catch(function (e) { if (root.console) console.warn('Collections workspace: storage unavailable, keeping the queue in memory', e); useMem = true; return fn(null); });
    }
    return {
      get: function (k) { return trans('readonly', function (s, out) { if (!s) return OPS.clone(mem.get(k)); var r = s.get(k); r.onsuccess = function () { out.v = r.result; }; }); },
      update: function (k, fn) {
        return trans('readwrite', function (s, out) {
          if (!s) { var v = fn(OPS.clone(mem.get(k))); mem.set(k, OPS.clone(v)); return v; }
          var r = s.get(k); r.onsuccess = function () { var v = fn(r.result); s.put(v, k); out.v = v; }; // one transaction: safe across tabs
        });
      },
      del: function (k) { return trans('readwrite', function (s) { if (!s) { mem.delete(k); return; } s.delete(k); }); },
      memory: function () { return useMem; }
    };
  }

  // ── invitations and links (no DOM) ───────────────────────────────────────────────────────────────────────────────
  /** o: { lang: 'sl'|'hr'|'en', inviter (e-mail), email, role, ws: { id, name }, origin } →
   * { subject, text, link, fileName, eml, mailto }: the invitation in the language the owner chose */
  function inviteMail(o) {
    var L = I18N.make(o.lang || 'sl');
    function tx(s, v) { return L.t(s, v); } // the invitation's own language, not the screen's
    var name = String((o.ws && o.ws.name) || ''), email = String(o.email || ''), inviter = String(o.inviter || ''), role = o.role;
    var link = String(o.origin || '').replace(/\/+$/, '') + '/collections/?ws=' + encodeURIComponent(o.ws.id);
    var v = { inviter: inviter, name: name, email: email };
    var lead = role === 'owner' ? tx('{inviter} invites you to the team workspace “{name}” in Clearfigure Collections as an owner.', v)
      : role === 'viewer' ? tx('{inviter} invites you to the team workspace “{name}” in Clearfigure Collections as a viewer.', v)
      : tx('{inviter} invites you to the team workspace “{name}” in Clearfigure Collections as an editor.', v);
    var can = role === 'owner' ? tx('As an owner you can change the data, add and remove people and change their roles, rename the workspace and delete it.')
      : role === 'viewer' ? tx('As a viewer you can see the customers, invoices, letters and the activity, but you cannot change anything.')
      : tx('As an editor you can record calls, letters, promises and payments and change customers and invoices.');
    var text = [tx('Hello,'), '', lead, can + ' ' + tx('Everyone in the workspace sees the same data.'), '',
      tx('Open the workspace with this link:'), link, '',
      tx('How to sign in: open the link and enter your e-mail address {email}. Cloudflare Access, which protects the site, sends you a one-time code by e-mail; type it in and you are in. You need no password and no account.', v), '',
      tx('If the page says you have no access, reply to this e-mail: your address may not have been let in yet.'), '',
      tx('Kind regards,'), inviter].join('\n');
    var subject = tx('Invitation to “{name}” in Clearfigure Collections', v);
    var O = outbox(), slug = O && O.slug ? O.slug(name) : name.replace(/[^A-Za-z0-9]+/g, '-');
    var out = { subject: subject, text: text, link: link, fileName: tx('Invitation') + '-' + (slug || 'workspace') + '.eml',
      mailto: 'mailto:' + encodeURIComponent(email).replace(/%40/g, '@') + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(text) };
    out.eml = O ? O.buildEml({ to: { email: email }, subject: subject, text: text, date: o.date || new Date() }) : '';
    return out;
  }
  /** the ?ws=<id> of a link (decoded, maybe not a valid id), or null when there is none */
  function linkId(search) {
    var m = /[?&]ws=([^&#]*)/.exec(String(search || ''));
    if (!m) return null;
    try { return decodeURIComponent(m[1].replace(/\+/g, ' ')).trim().toLowerCase(); } catch (e) { return ''; }
  }
  /** what a ?ws= link means for the signed-in person. call(method, url) → Promise of the JSON (rejects with .status).
   * → { action: 'none' | 'same' | 'choose' (ws) | 'denied' (not a member, or no such workspace: the same) | 'error' } */
  function resolveLink(id, call, cur) {
    if (id == null) return P({ action: 'none' });
    if (cur && cur.id === id) return P({ action: 'same' });
    var me = '';
    return call('GET', '/api/ws').then(function (list) {
      me = (list && list.me) || '';
      if (!WSID.test(id)) throw err('gone', 'Not found.', { status: 404 }); // a broken link: the same answer as any other
      return call('GET', '/api/ws/' + encodeURIComponent(id));
    }).then(function (w) {
      return { action: 'choose', ws: { id: w.id, name: w.name, role: w.role, me: me, ready: !!w.ready, head: w.head || 0 } };
    }, function (e) {
      return e && (e.status === 404 || e.status === 410) ? { action: 'denied', me: me } : { action: 'error', message: (e && e.message) || '', code: e && e.code };
    });
  }

  // ── binding to the app ────────────────────────────────────────────────────────────────────────────────────────────
  var H = null, engine = null, sel = null, shadowS = null, remoteGen = 0, deferred = null, deferT = null, chan = null, mine = null, activity = null, lastStatus = null;
  var pendingLink = null, deletedShown = false, deletingNow = false;
  function tx(s, v) { return H ? H.tx(s, v) : s; }
  function esc(s) { return H ? H.esc(s) : String(s); }
  function isPublic() { try { return !!(root.document && document.querySelector('meta[name="stratum-public"][content="1"]')); } catch (e) { return false; } }
  function lsGet(k) { try { return root.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v == null) root.localStorage.removeItem(k); else root.localStorage.setItem(k, v); } catch (e) { /* blocked */ } }
  function ssGet(k) { try { return root.sessionStorage.getItem(k); } catch (e) { return null; } }
  function ssSet(k, v) { try { if (v == null) root.sessionStorage.removeItem(k); else root.sessionStorage.setItem(k, v); } catch (e) { /* blocked */ } }
  // a ?ws=<id> link: remembered for this page (probe/boot follow it) and taken out of the address bar
  if (root.document && root.location && root.history && !isPublic()) {
    try {
      pendingLink = linkId(root.location.search);
      if (pendingLink !== null) { var u0 = new URL(root.location.href); u0.searchParams.delete('ws'); root.history.replaceState(root.history.state, '', u0.pathname + u0.search + u0.hash); }
    } catch (e) { pendingLink = null; }
  }
  /** the chosen team workspace { id, name, role, me }, or null for the personal copy */
  function selected() {
    if (isPublic()) return null;
    try { var v = JSON.parse(lsGet(SEL_KEY) || 'null'); return v && typeof v.id === 'string' && WSID.test(v.id) ? v : null; } catch (e) { return null; }
  }
  function choose(ws) {
    lsSet(SEL_KEY, ws ? JSON.stringify({ id: ws.id, name: ws.name, role: ws.role, me: ws.me }) : null);
    try { root.location.hash = '#/'; root.location.reload(); } catch (e) { /* tests */ }
  }
  function api(method, url, body) {
    var init = { method: method, headers: { 'X-Stratum-Apps': '1' }, redirect: 'manual', credentials: 'same-origin', cache: 'no-store' };
    if (body !== undefined) { init.body = typeof body === 'string' ? body : JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
    return root.fetch(url, init).then(function (r) {
      if (r.type === 'opaqueredirect' || r.status === 0 || r.status === 401) throw err('expired', tx('Your sign-in has expired.'));
      return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw err('error', j.error || ('HTTP ' + r.status), { status: r.status }); return j; });
    }, function () { throw err('offline', tx('The server cannot be reached. Check the connection.')); });
  }
  // only a workspace owner may replace everyone's data with an import (app.js hides and refuses it for editors)
  function isOwner() { return !!engine && engine.role() === 'owner'; }
  function readOnly() { if (!engine) return false; var s = engine.status(); return !engine.canWrite() || !s.hasData || s.status === 'gone' || s.status === 'deleted'; }
  function emptyDoc() {
    var X = H.X, E = H.E;
    return { version: X.VERSION, generatedFor: H.today(), demo: false, company: OPS.clone(X.COMPANY), sender: OPS.clone(X.SENDER), settings: E.normSettings({}), customers: [], invoices: [], actions: [], plans: [], log: [], bankSeen: [] };
  }
  function announce() { if (chan) { try { chan.postMessage({ type: 'changed' }); } catch (e) { /* closed */ } } }

  /** show the newest state; while the person is busy (a dialog, a pending save, typing) try again shortly, with the
   * state as it is then (so changes saved meanwhile are in it) */
  function applyRemote() {
    if (!engine || !engine.view) return;
    if (H.busy()) { deferred = true; clearTimeout(deferT); deferT = setTimeout(applyRemote, 1500); return; }
    deferred = false;
    var v = engine.view(); if (!v) return;
    remoteGen++;
    H.apply(v);
  }
  function statusChanged(s) {
    var was = lastStatus; lastStatus = s;
    if (root.document && document.body) document.body.classList.toggle('ws-ro', readOnly());
    if (!H) return;
    if (s.status === 'deleted') handleDeleted();
    if (was && (was.role !== s.role || was.hasData !== s.hasData)) { if (sel && s.role) { sel.role = s.role; lsSet(SEL_KEY, JSON.stringify(sel)); } H.render(); }
    else refreshStatus();
  }

  /** starts the chosen workspace: resolves with the document to show (the shared data, or an empty placeholder) */
  function boot(hooks) {
    H = hooks; sel = selected();
    engine = createEngine({ id: sel.id, me: sel.me, role: sel.role, fetch: function (u, i) { return root.fetch(u, i); }, store: idbStore(), valid: H.valid,
      onChange: function () { applyRemote(); announce(); }, onStatus: statusChanged });
    try { if (root.BroadcastChannel) { chan = new BroadcastChannel('stratum-collections-ws-' + sel.id); chan.onmessage = function (e) { if (e.data && e.data.type === 'changed') engine.reload(); }; } } catch (e) { chan = null; }
    root.document.body.classList.add('ws-mode');
    var info = engine.refreshInfo().then(function (j) { if (j.name && j.name !== sel.name) { sel.name = j.name; lsSet(SEL_KEY, JSON.stringify(sel)); } }, function () { /* offline: the stored data still opens */ });
    return info.then(function () { return engine.load(); }).then(function () {
      var v = engine.view();
      document.body.classList.toggle('ws-ro', readOnly());
      setInterval(function () { if (document.visibilityState === 'visible') engine.sync(); }, POLL_MS);
      setInterval(function () { if (document.visibilityState === 'visible') engine.refreshInfo().catch(function () {}); }, INFO_MS);
      document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') engine.sync(); });
      root.addEventListener('focus', function () { engine.sync(); });
      root.addEventListener('online', function () { engine.sync(); });
      setTimeout(function () { engine.sync(); }, 50);
      setTimeout(followLink, 0);
      return v || emptyDoc();
    });
  }
  function setShadow(doc) { shadowS = OPS.shadow(doc); }
  /** the app saved: turn the change into operations and queue them */
  function changed(doc) {
    if (!engine || !shadowS) return;
    if (readOnly()) { setShadow(doc); return; }
    var ops = OPS.diff(shadowS, doc), big = 0;
    shadowS = OPS.shadow(doc);
    ops = ops.filter(function (op) { if (JSON.stringify(op.p).length > MAX_OP) { big++; return false; } return true; });
    if (big) { H.toast(tx('One change was too large to share with the team and was not saved. Shorten the text and try again.')); setTimeout(applyRemote, 0); }
    if (!ops.length) return;
    engine.local(ops).then(function () { announce(); refreshStatus(); setTimeout(function () { engine.sync(); }, 400); });
  }

  // ── what the app draws ────────────────────────────────────────────────────────────────────────────────────────────
  function roleName(r) { return tx({ owner: 'Owner', editor: 'Editor', viewer: 'Viewer' }[r] || 'Viewer'); }
  function statusText(s) {
    if (!s) return '';
    if (s.status === 'offline') return s.pending ? tx('Offline: waiting on this device: {n}. They are sent once you are back online.', { n: s.pending }) : tx('Offline: showing the data from the last sync.');
    if (s.status === 'expired') return tx('Your sign-in has expired.');
    if (s.status === 'gone') return tx('You are no longer a member of this workspace.');
    if (s.status === 'deleted') return tx('This workspace was deleted.');
    if (s.status === 'setup') return tx('This workspace is still being set up by its owner.');
    if (s.status === 'readonly') return tx('You can only view this workspace now. Not saved: {n}.', { n: s.pending || s.refused });
    if (s.status === 'error') return tx('Could not sync: {msg}', { msg: s.message });
    if (s.pending) return tx('Waiting to be sent: {n}', { n: s.pending });
    if (s.lastOk) return tx('Shared with the team · checked {time}', { time: clock(new Date(s.lastOk).toISOString()) });
    return tx('Connecting to the team workspace…');
  }
  function tone(s) { return !s ? '' : s.status === 'synced' ? 'good' : s.status === 'pending' || s.status === 'idle' ? '' : 'bad'; }
  function clock(iso) {
    var d = new Date(iso); if (isNaN(d)) return '';
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function when(iso) { return iso ? H.dt(iso.slice(0, 10)) + ' ' + clock(iso) : ''; }
  function statusActions(s) {
    if (!s) return '';
    if (s.status === 'expired') return '<button type="button" class="btn sm" data-ws="signin">' + esc(tx('Sign in again')) + '</button>';
    if (s.status === 'gone') return '<button type="button" class="btn sm" data-ws="choose" data-v="">' + esc(tx('Back to my personal copy')) + '</button>';
    if (s.status === 'deleted') return '<button type="button" class="btn sm" data-ws="deletedback">' + esc(tx('Back to my personal copy')) + '</button>';
    if (s.status === 'readonly' && s.pending) return '<button type="button" class="btn sm danger" data-ws="discard">' + esc(tx('Discard them')) + '</button>';
    if (s.status === 'offline' || s.status === 'error' || s.status === 'pending') return '<button type="button" class="btn sm" data-ws="retry">' + esc(tx('Sync now')) + '</button>';
    return '';
  }
  /** the small box in the side bar: which data you are looking at, and the switch */
  function box() {
    var el = root.document.getElementById('wsBox'); if (!el || !H) return;
    if (!sel && !(mine && (mine.workspaces.length || mine.canCreate))) { el.hidden = true; el.innerHTML = ''; return; }
    var s = engine && engine.status();
    el.hidden = false;
    el.innerHTML = '<span class="ws-l">' + esc(tx('Workspace')) + '</span><button type="button" class="ws-pick" data-ws="pick" aria-haspopup="dialog">' +
      '<span class="ws-n">' + esc(sel ? sel.name : tx('Personal copy')) + '</span><small>' + esc(sel ? roleName(s ? s.role : sel.role) + (s && s.pending ? ' · ' + tx('{n} waiting', { n: s.pending }) : '') : tx('Only you')) + '</small>' +
      (sel ? '<i class="ws-dot ' + tone(s) + '" aria-hidden="true"></i>' : '') + '</button>';
  }
  /** personal mode: is there anything to switch to? (one quiet request; nothing shows when it fails) */
  function probe(hooks) {
    H = hooks;
    if (isPublic() || !root.fetch) return;
    showNote();
    api('GET', '/api/ws').then(function (j) { mine = j; box(); }, function () { mine = null; box(); });
    followLink();
  }
  /** a message kept across the reload back to the personal copy (the workspace was deleted) */
  function showNote() {
    var n = null; try { n = JSON.parse(ssGet(NOTE_KEY) || 'null'); } catch (e) { n = null; }
    ssSet(NOTE_KEY, null);
    if (n && n.text) setTimeout(function () { H.modal({ title: n.title || tx('This workspace was deleted'), body: '<p>' + esc(n.text) + '</p>', cancel: tx('Close') }); }, 300);
  }
  /** a ?ws=<id> link was opened: switch to that workspace if this person is a member, else say so (never whether it exists) */
  function followLink() {
    var id = pendingLink; pendingLink = null;
    if (id === null || !H) return;
    resolveLink(id, api, sel).then(function (r) {
      if (r.action === 'choose') {
        if (!mine) mine = { me: r.ws.me, workspaces: [], canCreate: false };
        if (!r.ws.ready && r.ws.role === 'owner') return seedModal(r.ws);
        choose(r.ws);
      } else if (r.action === 'denied') {
        H.modal({ title: tx('No access to this workspace'), cancel: tx('Close'), body: '<p>' + esc(tx('You don’t have access to this workspace. Ask its owner to add you, with the e-mail address you signed in with.')) + '</p>' +
          (r.me ? '<p class="hint">' + esc(tx('You are signed in as {email}.', { email: r.me })) + '</p>' : '') });
      } else if (r.action === 'error') H.toast(tx('Could not open the workspace from the link: {msg}', { msg: r.message }));
    });
  }
  function picker() {
    var cur = sel ? sel.id : '';
    H.modal({ title: tx('Choose the data'), body: '<p class="hint" id="wsPickNote">' + esc(tx('Loading your workspaces…')) + '</p><ul class="ws-list" id="wsList"></ul>', cancel: tx('Close'),
      mount: function (form) {
        api('GET', '/api/ws').then(function (j) {
          mine = j;
          var rows = '<li><button type="button" class="ws-opt"' + (cur ? '' : ' aria-current="true"') + ' data-ws="choose" data-v=""><b>' + esc(tx('Personal copy')) + '</b><small>' + esc(tx('Only you: this browser and your own cloud copy.')) + '</small></button></li>';
          j.workspaces.forEach(function (w) {
            rows += '<li><button type="button" class="ws-opt"' + (w.id === cur ? ' aria-current="true"' : '') + ' data-ws="choose" data-v="' + esc(w.id) + '"><b>' + esc(w.name) + '</b><small>' +
              esc(roleName(w.role) + ' · ' + tx('People: {n}', { n: w.members }) + (w.ready ? '' : ' · ' + tx('not set up yet'))) + '</small></button></li>';
          });
          form.querySelector('#wsList').innerHTML = rows;
          var note = form.querySelector('#wsPickNote');
          note.textContent = tx('A team workspace is shared by the people of one company: everyone sees the same customers, letters, promises and payments.');
          if (j.canCreate) note.insertAdjacentHTML('afterend', '<p><button type="button" class="btn sm" data-ws="new">' + esc(tx('New team workspace…')) + '</button></p>');
        }, function (e) { var n = form.querySelector('#wsPickNote'); n.textContent = tx('Team workspaces are not available here: {msg}', { msg: e.message }); });
      } });
  }
  function pick(id) {
    if (!id) { if (sel) choose(null); else closeTop(); return; }
    var w = mine && mine.workspaces.filter(function (x) { return x.id === id; })[0];
    if (!w) return;
    if (!w.ready && w.role === 'owner') { closeTop(); return seedModal(w); }
    choose({ id: w.id, name: w.name, role: w.role, me: mine.me });
  }
  function closeTop() { var b = root.document.querySelector('#layers .layer:last-child [data-close]'); if (b) b.click(); }
  function seedChoices(personal) {
    var d = personal && H.getDb();
    return '<fieldset class="ws-seed"><legend>' + esc(tx('Start with')) + '</legend><div class="choices one">' +
      '<label><input type="radio" name="wsSeed" value="demo" checked> <span>' + esc(tx('Fresh demo data (fictional customers)')) + '</span></label>' +
      (d ? '<label><input type="radio" name="wsSeed" value="personal"> <span>' + esc(tx('Copy my personal data into this new workspace ({customers} customers, {invoices} invoices)', { customers: d.customers.length, invoices: d.invoices.length })) + '</span></label>' : '') +
      '<label><input type="radio" name="wsSeed" value="empty"> <span>' + esc(tx('Empty: import the invoices later')) + '</span></label></div>' +
      '<p class="hint">' + esc(tx('This choice is made once. Your personal copy stays as it is and is never changed by the workspace.')) + '</p></fieldset>';
  }
  function seedDoc(kind) {
    if (kind === 'personal' && !sel) return OPS.clone(H.getDb());
    if (kind === 'empty') return emptyDoc();
    return H.X.generate(H.today());
  }
  function uploadSeed(w, kind) {
    var doc = seedDoc(kind);
    return api('PUT', '/api/ws/' + encodeURIComponent(w.id) + '/snapshot?seq=' + (w.head || 0), JSON.stringify(doc));
  }
  function createModal() {
    H.modal({ title: tx('New team workspace'), submit: tx('Create the workspace'), body:
      '<div class="field"><label for="wsName">' + esc(tx('Company or team name')) + '</label><input class="in" id="wsName" maxlength="80" autocomplete="organization"></div>' + seedChoices(!sel) +
      '<p class="hint">' + esc(tx('You are its owner. Add the people next, by e-mail; each of them also needs access to this site in Cloudflare Access.')) + '</p>',
      onSubmit: function (form) {
        var name = form.querySelector('#wsName').value.trim();
        if (!name) { form.querySelector('#wsName').setAttribute('aria-invalid', 'true'); return tx('Enter a name for the workspace.'); }
        var kind = (form.querySelector('input[name="wsSeed"]:checked') || {}).value || 'demo', btn = form.querySelector('[type=submit]');
        btn.disabled = true;
        api('POST', '/api/ws', { name: name, app: 'collections' }).then(function (w) {
          return uploadSeed(w, kind).then(function () { choose({ id: w.id, name: w.name, role: 'owner', me: mine && mine.me }); });
        }).catch(function (e) {
          btn.disabled = false;
          var box = form.querySelector('.md-body > .err'); box.textContent = e.message; box.hidden = false;
        });
        return false;
      } });
  }
  function seedModal(w) {
    H.modal({ title: tx('Finish setting up {name}', { name: w.name }), submit: tx('Set it up'), body: seedChoices(!sel),
      onSubmit: function (form) {
        var kind = (form.querySelector('input[name="wsSeed"]:checked') || {}).value || 'demo', btn = form.querySelector('[type=submit]');
        btn.disabled = true;
        api('GET', '/api/ws/' + encodeURIComponent(w.id)).then(function (info) { return uploadSeed(info, kind); })
          .then(function () { choose({ id: w.id, name: w.name, role: 'owner', me: w.me || (mine && mine.me) }); })
          .catch(function (e) { btn.disabled = false; var b = form.querySelector('.md-body > .err'); b.textContent = e.message; b.hidden = false; });
        return false;
      } });
  }

  // ── the Team page: members, activity, sync status ────────────────────────────────────────────────────────────────
  var ACT_LABEL = { call: 'Call logged', letter: 'Letter logged as sent', payment: 'Payment recorded', email: 'E-mail logged', note: 'Note added', dispute: 'Dispute logged', hold: 'Deliveries on hold changed', plan: 'Payment plan agreed', promise: 'Promise logged' };
  var COLL_LABEL = { customers: 'customers', invoices: 'invoices', actions: 'actions', plans: 'payment plans' };
  function custName(id) { var d = H.getDb(), c = d && d.customers.filter(function (x) { return x.id === id; })[0]; return c ? c.name : ''; }
  function groupText(items) {
    var out = [], logs = items.filter(function (x) { return x.type === 'log.add' && x.text; });
    items.forEach(function (x) {
      if (x.type === 'ws.create') out.push(tx('Created the workspace “{name}”', { name: x.name || '' }));
      else if (x.type === 'ws.rename') out.push(tx('Renamed the workspace to “{name}”', { name: x.name || '' }));
      else if (x.type === 'ws.join') out.push(tx('Joined the workspace'));
      else if (x.type === 'ws.invite') out.push(tx('Sent an invitation to {email}', { email: x.email }));
      else if (x.type === 'ws.member') out.push(x.role == null ? tx('Removed {email}', { email: x.email }) : x.prev ? tx('Changed {email} from {prev} to {role}', { email: x.email, prev: roleName(x.prev), role: roleName(x.role) }) : tx('Added {email} as {role}', { email: x.email, role: roleName(x.role) }));
    });
    if (logs.length) out.push(logs[logs.length - 1].text + (logs.length > 1 ? ' ' + tx('(and {n} more)', { n: logs.length - 1 }) : ''));
    else {
      items.forEach(function (x) {
        if (x.type === 'rec.put' && x.n && x.c === 'actions') { var cn = custName(x.customerId); out.push(tx(ACT_LABEL[x.actType] || 'Note added') + (cn ? ' · ' + cn : '')); }
      });
    }
    if (!out.length) {
      var n = items.filter(function (x) { return x.type.indexOf('ws.') !== 0; }).length;
      var colls = {}; items.forEach(function (x) { if (x.c) colls[x.c] = 1; });
      if (n) out.push(tx('Changes: {n}', { n: n }) + (Object.keys(colls).length ? ' · ' + Object.keys(colls).map(function (c) { return tx(COLL_LABEL[c] || c); }).join(', ') : ''));
    }
    return out;
  }
  function activityHtml() {
    if (!activity) return '<p class="hint">' + esc(tx('Loading the activity…')) + '</p>';
    if (activity.error) return '<p class="hint neg">' + esc(activity.error) + '</p>';
    var groups = [], cur = null;
    activity.items.forEach(function (x) {
      if (x.type === 'ws.snapshot') return;
      if (cur && cur.by === x.by && cur.at === x.at) cur.items.push(x); else { cur = { by: x.by, at: x.at, items: [x] }; groups.push(cur); }
    });
    if (!groups.length) return '<p class="hint">' + esc(tx('Nothing has happened in this workspace yet.')) + '</p>';
    return '<ol class="tl ws-act">' + groups.slice(0, 80).map(function (g) {
      var lines = groupText(g.items); if (!lines.length) return '';
      return '<li><span class="dot">' + H.ic('note') + '</span><div class="what"><b>' + esc(lines[0]) + '</b><small>' + esc(when(g.at)) + ' · ' + esc(g.by) + '</small>' +
        (lines.length > 1 ? '<p>' + esc(lines.slice(1, 4).join(' · ')) + '</p>' : '') + '</div></li>';
    }).join('') + '</ol>';
  }
  function membersHtml(info) {
    if (!info) return '<p class="hint">' + esc(tx('Loading the members…')) + '</p>';
    var meE = engine.me(), owner = info.role === 'owner', owners = info.members.filter(function (m) { return m.role === 'owner'; }).length;
    var h = '<div class="tw"><table class="t compact ws-members"><thead><tr><th>' + esc(tx('E-mail')) + '</th><th>' + esc(tx('Role')) + '</th><th>' + esc(tx('Status')) + '</th>' + (owner ? '<th><span class="sr">' + esc(tx('Invite or remove')) + '</span></th>' : '') + '</tr></thead><tbody>';
    info.members.forEach(function (m) {
      var last = m.role === 'owner' && owners <= 1;
      h += '<tr><td class="name">' + esc(m.email) + (m.email === meE ? ' <span class="badge plain">' + esc(tx('you')) + '</span>' : '') + '</td><td>' +
        (owner ? '<select class="in sm" data-ws-role="' + esc(m.email) + '" aria-label="' + esc(tx('Role of {email}', { email: m.email })) + '"' + (last ? ' disabled title="' + esc(tx('A workspace needs at least one owner.')) + '"' : '') + '>' +
          ['owner', 'editor', 'viewer'].map(function (r) { return '<option value="' + r + '"' + (m.role === r ? ' selected' : '') + '>' + esc(roleName(r)) + '</option>'; }).join('') + '</select>' : esc(roleName(m.role))) +
        '</td><td class="ws-mst">' + memberState(m) + '</td>' +
        (owner ? '<td class="num ws-mact">' + (m.email === meE ? '' : '<button type="button" class="btn sm" data-ws="invite" data-v="' + esc(m.email) + '">' + esc(tx('Send invitation')) + '</button> ') +
          '<button type="button" class="btn sm ghost" data-ws="remove" data-v="' + esc(m.email) + '"' + (last ? ' disabled title="' + esc(tx('A workspace needs at least one owner.')) + '"' : '') + '>' + esc(tx('Remove')) + '</button></td>' : '') + '</tr>';
    });
    h += '</tbody></table></div>';
    if (owner) {
      h += '<form id="wsAdd" class="ws-add" novalidate><div class="field"><label for="wsEmail">' + esc(tx('Add a person by e-mail')) + '</label><input class="in" id="wsEmail" type="email" autocomplete="off" placeholder="ana@example.si"></div>' +
        '<div class="field"><label for="wsRole">' + esc(tx('Role')) + '</label><select class="in" id="wsRole"><option value="editor">' + esc(roleName('editor')) + '</option><option value="viewer">' + esc(roleName('viewer')) + '</option><option value="owner">' + esc(roleName('owner')) + '</option></select></div>' +
        '<div><button type="submit" class="btn pri">' + esc(tx('Add')) + '</button></div></form>' +
        '<p class="hint">' + esc(tx('After adding someone you can send them an invitation. Each new member also needs access to this site in Cloudflare Access (below).')) + '</p>';
    } else if (!(info.role === 'owner')) {
      h += '<p style="margin-top:12px"><button type="button" class="btn sm ghost" data-ws="leave">' + esc(tx('Leave this workspace')) + '</button></p>';
    }
    return h;
  }
  function memberState(m) {
    if (m.joinedAt) return '<span class="badge good">' + esc(tx('Joined')) + '</span><small>' + esc(H.dt(m.joinedAt.slice(0, 10))) + '</small>';
    if (m.invitedAt) return '<span class="badge">' + esc(tx('Invited {date}', { date: H.dt(m.invitedAt.slice(0, 10)) })) + '</span><small>' + esc(tx('not signed in yet')) + '</small>';
    return '<span class="badge plain">' + esc(tx('Not invited yet')) + '</span><small>' + esc(tx('Added {date}', { date: H.dt(String(m.addedAt || '').slice(0, 10)) })) + '</small>';
  }
  /** owners: how the site owner lets a new e-mail through Cloudflare Access (the invitation alone does not) */
  function accessHtml(info, email) {
    return '<ol class="ws-steps"><li>' + esc(tx('Open Cloudflare Zero Trust and sign in.')) + '</li><li>' + esc(tx('Access → Applications → business-apps → Policies.')) + '</li><li>' +
      esc(tx('Edit the policy, add {email} under Include → Emails and save.', { email: email || tx('the new e-mail address') })) + '</li></ol>' +
      (info && info.siteOwner ? '' : '<p class="hint">' + esc(tx('Only the administrator of this site can do this. If that is not you, send them the e-mail address.')) + '</p>') +
      '<p><a class="btn sm" href="' + CF_DASH + '" target="_blank" rel="noopener noreferrer">' + esc(tx('Open Cloudflare Zero Trust')) + '</a></p>';
  }
  function accessCard(info) {
    return '<section class="card ws-access"><div class="card-h"><div><span class="label">' + esc(tx('Before an invitation works')) + '</span><h2>' + esc(tx('Let the e-mail into the site')) + '</h2></div></div><div class="card-b">' +
      '<p>' + esc(tx('The site is protected by Cloudflare Access: a new member can only sign in once their e-mail address is in its policy.')) + '</p>' + accessHtml(info) + '</div></section>';
  }
  function dangerCard() {
    return '<section class="card ws-danger"><div class="card-h"><div><span class="label">' + esc(tx('Danger zone')) + '</span><h2>' + esc(tx('Delete this workspace')) + '</h2></div></div><div class="card-b">' +
      '<p>' + esc(tx('Everyone loses access at once. The data is kept on the server for 30 days, then removed for good.')) + '</p>' +
      '<p><button type="button" class="btn danger" data-ws="delete">' + esc(tx('Delete workspace…')) + '</button></p></div></section>';
  }
  /** #/team */
  function page() {
    if (!engine) {
      return H.head(H.eb(esc(tx('Team'))), tx('Team workspaces'), esc(tx('You are working in your personal copy. Choose a team workspace to share the data with your colleagues.')), '<button type="button" class="btn pri" data-ws="pick">' + esc(tx('Choose the data')) + '</button>');
    }
    var s = engine.status(), info = engine.info();
    var h = H.head(H.eb(esc(tx('Team workspace'))), sel.name, esc(tx('You are signed in as {email} · {role}', { email: engine.me(), role: roleName(s.role) })),
      (info && info.role === 'owner' ? '<button type="button" class="btn" data-ws="rename">' + esc(tx('Rename')) + '</button>' : '') + '<button type="button" class="btn" data-ws="pick">' + esc(tx('Switch')) + '</button>');
    h += '<section class="card pad ws-status"><div class="split"><div><span class="label">' + esc(tx('Sync')) + '</span><p class="ws-st ' + tone(s) + '" id="wsStatusText"><i aria-hidden="true"></i>' + esc(statusText(s)) + '</p></div><div id="wsStatusAct">' + statusActions(s) + '</div></div>' +
      '<p class="hint">' + esc(tx('Changes are sent as you make them and the others’ changes arrive within half a minute. Calls, letters, promises and payments of everyone are all kept; when two people change the same field, the later change wins.')) + '</p></section>';
    h += '<div class="grid2"><section class="card"><div class="card-h"><div><span class="label">' + esc(tx('Owners manage members; editors change the data; viewers only read.')) + '</span><h2>' + esc(tx('Members')) + '</h2></div></div><div class="card-b" id="wsMembers">' + membersHtml(info) + '</div></section>' +
      '<section class="card"><div class="card-h"><div><span class="label">' + esc(tx('Who did what')) + '</span><h2>' + esc(tx('Activity')) + '</h2></div><button type="button" class="btn sm ghost" data-ws="actrefresh">' + esc(tx('Refresh')) + '</button></div><div class="card-b" id="wsActivity">' + activityHtml() + '</div></section></div>';
    h += '<div id="wsOwnerCards">' + ownerCards(info) + '</div>';
    return h;
  }
  function loadActivity() {
    if (!engine) return;
    engine.request('GET', '/activity?limit=200').then(engine.ok).then(function (j) { activity = j; }, function (e) { activity = { error: e.message, items: [] }; })
      .then(function () { var el = root.document.getElementById('wsActivity'); if (el) el.innerHTML = activityHtml(); });
  }
  /** after the Team page is drawn: fetch members and activity */
  function ownerCards(info) { return info && info.role === 'owner' ? '<div class="grid2 ws-owner">' + accessCard(info) + dangerCard() + '</div>' : ''; }
  function mounted() {
    if (!engine) return;
    engine.refreshInfo().then(function () {
      var el = root.document.getElementById('wsMembers'); if (el) el.innerHTML = membersHtml(engine.info());
      var oc = root.document.getElementById('wsOwnerCards'); if (oc) oc.innerHTML = ownerCards(engine.info());
    }, function () {});
    loadActivity();
  }
  function refreshStatus() {
    var s = engine && engine.status(), t = root.document.getElementById('wsStatusText');
    if (t && s) { t.className = 'ws-st ' + tone(s); t.innerHTML = '<i aria-hidden="true"></i>' + esc(statusText(s)); var a = root.document.getElementById('wsStatusAct'); if (a) a.innerHTML = statusActions(s); }
    box();
  }
  function member(email, role) {
    return engine.request('POST', '/members', { email: email, role: role }).then(engine.ok).then(function (j) {
      engine._state.info = Object.assign({}, engine.info() || {}, j); mounted(); return j;
    }, function (e) { H.toast(e.message); throw e; });
  }
  // ── invitations (owner) ───────────────────────────────────────────────────────────────────────────────────────────
  function langNow() { var l = H && H.lang ? H.lang() : 'sl'; return I18N.LANGS.indexOf(l) >= 0 ? l : 'sl'; }
  function inviteFor(email, lang) {
    var info = engine.info() || {}, m = (info.members || []).filter(function (x) { return x.email === email; })[0];
    return inviteMail({ lang: lang, inviter: engine.me(), email: email, role: m ? m.role : 'editor', ws: { id: sel.id, name: info.name || sel.name }, origin: root.location.origin });
  }
  /** tell the Worker that an invitation went out (invitedAt); the Team page shows it */
  function recordInvite(email) {
    return engine.request('POST', '/invite', { email: email }).then(engine.ok).then(function (j) {
      engine._state.info = Object.assign({}, engine.info() || {}, j);
      var el = root.document.getElementById('wsMembers'); if (el) el.innerHTML = membersHtml(engine.info());
    }, function (e) { H.toast(e.message); });
  }
  function inviteModal(email) {
    var lang = langNow(), mail = inviteFor(email, lang);
    H.modal({ title: tx('Invite {email}', { email: email }), wide: true, cancel: tx('Close'), body:
      '<p class="hint">' + esc(tx('The app does not send e-mail. Open the invitation in your mail app, check it and send it yourself, or copy the text into any message.')) + '</p>' +
      '<div class="field"><label for="wsInvLang">' + esc(tx('Language of the invitation')) + '</label><select class="in" id="wsInvLang">' +
        [['sl', 'Slovenščina'], ['hr', 'Hrvatski'], ['en', 'English']].map(function (l) { return '<option value="' + l[0] + '"' + (l[0] === lang ? ' selected' : '') + '>' + l[1] + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label for="wsInvText">' + esc(tx('Invitation text')) + '</label><textarea class="in ws-inv-text" id="wsInvText" rows="11" readonly></textarea></div>' +
      '<div class="ws-inv-btns"><button type="button" class="btn pri" data-ws="inveml" data-v="' + esc(email) + '">' + esc(tx('E-mail invitation (.eml)')) + '</button>' +
        '<a class="btn" id="wsInvMailto" data-ws="invmailto" data-v="' + esc(email) + '" href="#">' + esc(tx('Open in my mail app')) + '</a>' +
        '<button type="button" class="btn" data-ws="invcopy" data-v="' + esc(email) + '">' + esc(tx('Copy invitation text')) + '</button></div>' +
      '<p class="hint">' + esc(tx('The .eml file opens in Outlook as a new message, ready to send. “Open in my mail app” works with any mail program but may cut very long texts.')) + '</p>' +
      '<details class="ws-inv-access"><summary>' + esc(tx('Let the e-mail into the site')) + '</summary>' + accessHtml(engine.info(), email) + '</details>',
      mount: function (form) {
        function fill() {
          mail = inviteFor(email, form.querySelector('#wsInvLang').value);
          form.querySelector('#wsInvText').value = mail.subject + '\n\n' + mail.text;
          form.querySelector('#wsInvMailto').setAttribute('href', mail.mailto);
        }
        form.querySelector('#wsInvLang').addEventListener('change', fill);
        fill();
      } });
  }
  function currentInvite(email) {
    var sl = root.document.getElementById('wsInvLang');
    return inviteFor(email, sl ? sl.value : langNow());
  }

  // ── deleting (owner) and being told a workspace was deleted (everyone) ────────────────────────────────────────────
  function downloadCopy() {
    var v = engine && engine.view(); if (!v) { H.toast(tx('There is no data on this device to download.')); return; }
    var O = outbox(), name = (O && O.slug ? O.slug(sel.name) : 'workspace') || 'workspace';
    H.download('collections-' + name + '-' + H.today() + '.json', JSON.stringify(v, null, 1), 'application/json;charset=utf-8');
  }
  /** forget the workspace on this device, then back to the personal copy (with a message after the reload) */
  function leaveDeleted(text) {
    var d = engine.status().deleted || {};
    var finish = d.unfinished && engine.role() === 'owner' ? engine.remove(d.name || sel.name).catch(function () {}) : P();
    deletingNow = true;
    return finish.then(function () { return engine.clear(); }).catch(function () {}).then(function () {
      ssSet(NOTE_KEY, JSON.stringify({ title: tx('This workspace was deleted'), text: text + ' ' + tx('You are back in your personal copy. Nothing of the workspace was kept on this device.') }));
      choose(null);
    });
  }
  function deletedText() {
    var d = engine.status().deleted || {}, name = sel ? sel.name : '';
    if (d.by && d.at) return tx('The team workspace “{name}” was deleted by {email} on {date}.', { name: name, email: d.by, date: when(d.at) });
    return tx('The team workspace “{name}” was deleted.', { name: name });
  }
  function handleDeleted() {
    if (deletedShown || deletingNow || !engine) return;
    deletedShown = true;
    (engine.status().hasData ? P() : engine.load().catch(function () {})).then(function () {
      var n = engine.status().pending, text = deletedText();
      if (!n) return leaveDeleted(text);
      H.modal({ title: tx('This workspace was deleted'), submit: tx('Back to my personal copy'), cancel: tx('Not now'), body: '<p>' + esc(text) + '</p>' +
        '<p>' + esc(tx('Changes on this device that were not sent before it was deleted: {n}. Download your copy as a JSON file before this device forgets the workspace.', { n: n })) + '</p>' +
        '<p><button type="button" class="btn" data-ws="dlcopy">' + esc(tx('Download my copy as JSON')) + '</button></p>',
        onSubmit: function () { leaveDeleted(text); } });
    });
  }
  function deleteModal() {
    var s = engine.status(), name = (engine.info() && engine.info().name) || sel.name;
    H.modal({ title: tx('Delete “{name}”?', { name: name }), danger: true, submit: tx('Delete the workspace'), body:
      '<p>' + esc(tx('Everyone loses access at once: nobody sees this workspace’s customers, invoices, letters, promises, payments and activity any more. Personal copies are not affected.')) + '</p>' +
      '<p class="hint">' + esc(tx('The data is kept on the server for 30 days, then removed for good. Within those 30 days only the site administrator can bring it back.')) + '</p>' +
      (s.pending ? '<p class="neg">' + esc(tx('Changes on this device not sent yet: {n}.', { n: s.pending })) + ' <button type="button" class="btn sm" data-ws="dlcopy">' + esc(tx('Download my copy as JSON')) + '</button></p>' : '') +
      '<div class="field"><label for="wsDelName">' + esc(tx('Type the name of the workspace to confirm: {name}', { name: name })) + '</label><input class="in" id="wsDelName" autocomplete="off" spellcheck="false"></div>' +
      '<p class="hint" id="wsDelProg" role="status"></p>',
      onSubmit: function (form) {
        var inp = form.querySelector('#wsDelName');
        if (inp.value.replace(/\s+/g, ' ').trim() !== name) { inp.setAttribute('aria-invalid', 'true'); return tx('Type the name exactly as shown to confirm.'); }
        var btn = form.querySelector('[type=submit]'), prog = form.querySelector('#wsDelProg'), box = form.querySelector('.md-body > .err');
        btn.disabled = true; inp.disabled = true; box.hidden = true; prog.textContent = tx('Deleting…');
        deletingNow = true;
        engine.remove(name, function (p) { prog.textContent = tx('Deleting… {n} files moved', { n: p.moved }); }).then(function () {
          return engine.clear().catch(function () {}).then(function () {
            ssSet(NOTE_KEY, JSON.stringify({ title: tx('Workspace deleted'), text: tx('You deleted the team workspace “{name}”. Its data is kept on the server for 30 days, then removed for good.', { name: name }) + ' ' + tx('You are back in your personal copy. Nothing of the workspace was kept on this device.') }));
            choose(null);
          });
        }, function (e) {
          deletingNow = false; btn.disabled = false; inp.disabled = false; prog.textContent = '';
          box.textContent = e.message; box.hidden = false;
        });
        return false;
      } });
  }

  /** Settings → the sync card in a workspace (instead of the personal cloud sync panel) */
  function settingsCard() {
    var s = engine.status();
    return '<div class="as-card"><div><b>' + esc(sel.name) + '</b> · ' + esc(roleName(s.role)) + '</div><div>' + esc(statusText(s)) + '</div><div>' + statusActions(s) +
      ' <a class="btn sm" href="#/team">' + esc(tx('Members and activity')) + '</a> <button type="button" class="btn sm ghost" data-ws="choose" data-v="">' + esc(tx('Back to my personal copy')) + '</button></div></div>';
  }

  if (root.document) {
    root.document.addEventListener('click', function (e) {
      var el = e.target.closest && e.target.closest('[data-ws]'); if (!el || el.disabled || !H) return;
      var k = el.getAttribute('data-ws'), v = el.getAttribute('data-v');
      if (k === 'pick') picker();
      else if (k === 'choose') pick(v);
      else if (k === 'new') { closeTop(); createModal(); }
      else if (k === 'retry') { engine.sync().then(refreshStatus); }
      else if (k === 'signin') root.location.reload();
      else if (k === 'discard') H.confirm(tx('Discard the changes?'), esc(tx('They were made on this device but the workspace no longer accepts your changes. They are removed from this device.')), tx('Discard them'), function () { engine.discard(); });
      else if (k === 'invite') inviteModal(v);
      else if (k === 'inveml') { var m1 = currentInvite(v); H.download(m1.fileName, m1.eml, 'message/rfc822'); recordInvite(v); }
      else if (k === 'invmailto') { recordInvite(v); } // the link itself opens the mail app
      else if (k === 'invcopy') { var m2 = currentInvite(v); H.copy(m2.subject + '\n\n' + m2.text).then(function () { H.toast(tx('Invitation copied. Paste it into a message to {email}.', { email: v })); }, function () { H.toast(tx('Copying was blocked: select the text and copy it.')); }); recordInvite(v); }
      else if (k === 'delete') deleteModal();
      else if (k === 'dlcopy') downloadCopy();
      else if (k === 'deletedback') { deletedShown = false; handleDeleted(); }
      else if (k === 'actrefresh') { activity = null; var el2 = root.document.getElementById('wsActivity'); if (el2) el2.innerHTML = activityHtml(); engine.sync().then(mounted); } // members (joined, invited) too
      else if (k === 'remove') H.confirm(tx('Remove {email}?', { email: v }), esc(tx('They can no longer open this workspace. What they recorded stays.')), tx('Remove'), function () { member(v, 'remove').catch(function () {}); }, true);
      else if (k === 'leave') H.confirm(tx('Leave this workspace?'), esc(tx('You can no longer open it unless an owner adds you again.')), tx('Leave'), function () { member(engine.me(), 'remove').then(function () { choose(null); }, function () {}); }, true);
      else if (k === 'rename') {
        H.modal({ title: tx('Rename the workspace'), submit: tx('Save'), body: '<div class="field"><label for="wsNewName">' + esc(tx('Company or team name')) + '</label><input class="in" id="wsNewName" maxlength="80" value="' + esc(sel.name) + '"></div>',
          onSubmit: function (form) {
            var name = form.querySelector('#wsNewName').value.trim(); if (!name) return tx('Enter a name for the workspace.');
            engine.request('PATCH', '', { name: name }).then(engine.ok).then(function (j) { sel.name = j.name; lsSet(SEL_KEY, JSON.stringify(sel)); H.render(); mounted(); }, function (e2) { H.toast(e2.message); });
          } });
      }
    });
    root.document.addEventListener('change', function (e) {
      var t = e.target, em = t.getAttribute && t.getAttribute('data-ws-role'); if (!em || !engine) return;
      member(em, t.value).catch(function () { mounted(); });
    });
    root.document.addEventListener('submit', function (e) {
      if (!e.target || e.target.id !== 'wsAdd' || !engine) return;
      e.preventDefault();
      var inp = root.document.getElementById('wsEmail'), email = inp.value.trim().toLowerCase(), role = root.document.getElementById('wsRole').value;
      if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) { inp.setAttribute('aria-invalid', 'true'); inp.focus(); H.toast(tx('Enter a valid e-mail address.')); return; }
      member(email, role).then(function () { H.toast(tx('{email} added as {role}', { email: email, role: roleName(role) })); inp.value = ''; inviteModal(email); }, function () {});
    }, true);
  }

  return {
    createEngine: createEngine, inviteMail: inviteMail, linkId: linkId, resolveLink: resolveLink, selected: selected, boot: boot, probe: probe, changed: changed, setShadow: setShadow, readOnly: readOnly, isOwner: isOwner,
    remoteGen: function () { return remoteGen; }, box: box, page: page, mounted: mounted, refreshStatus: refreshStatus, settingsCard: settingsCard,
    me: function () { return engine ? engine.me() : ''; }, active: function () { return !!engine; }, name: function () { return sel ? sel.name : ''; },
    flushPending: function () { return engine ? engine.sync() : P(); }
  };
});
