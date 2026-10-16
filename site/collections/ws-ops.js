/* Collections team workspaces: the shared data as an ordered list of small operations (Business Apps).
 * The app keeps one document (customers, invoices, actions, plans, settings…). In a team workspace every change becomes
 * operations that the Worker (worker/workspaces.js) numbers in one strict order; every device applies the same
 * operations in the same order, so everyone ends up with the same document and nobody is asked "which copy do you keep?".
 *
 *   op = { id, type, p }                     as a device sends it (id: random, the same op sent twice is applied once)
 *   op = { seq, id, by, at, type, p }        as the Worker stores it: seq, by (the e-mail from the verified sign-in) and
 *                                            at (server time) are set by the Worker, never by the device
 *
 * Types (p = payload):
 *   rec.put  { c, id, n?, f }    a record of c ('customers' | 'invoices' | 'actions' | 'plans'): f = [[path, value] or
 *                                [path] (= delete)] relative to the record; n: the op creates it (a put without n on a
 *                                record that is gone is ignored: deleted stays deleted)
 *   rec.del  { c, ids }          records removed (undo of an add, an import that replaces everything)
 *   sub.add  { c, id, k, key, item }  an item added to a keyed list inside a record (an invoice's payments): appended
 *                                unless an item with that key is there; two people's payments are both kept
 *   sub.del  { c, id, k, key }   that item removed (undo)
 *   doc.put  { f }               fields of the document itself (settings, letterhead, sender…), paths from the root
 *   set.add  { k: 'bankSeen', v } bank statement entries already recorded (de-duplication of bank payments)
 *   log.add  { e: { at, text } }  a line of the app's change log
 *   ws.*                         membership and workspace events written by the Worker; no effect on the document
 *
 * Conflicts: the later operation in the Worker's order wins, per field (two people changing different fields of the
 * same customer both keep their change). Calls, letters, promises, notes and payments are records of their own (and
 * payments keyed items), added and never overwritten, so concurrent actions of two people are always all kept. Who
 * made an action (by, byEmail) comes only from the operation's server-set `by`.
 * UMD: window.CollWsOps in the browser, require() in the Node tests (tools/tests/collections-workspaces.test.js). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CollWsOps = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var COLLS = ['customers', 'invoices', 'actions', 'plans'];
  var SPECIAL = { customers: 1, invoices: 1, actions: 1, plans: 1, log: 1, bankSeen: 1 };
  var KEYED = { invoices: { payments: 1 } }; // lists merged item by item (key: ref, bankId or the item itself)
  var TRUSTED = { by: 1, byEmail: 1 };        // action fields only the server's op.by may set
  var BAD_KEY = { __proto__: 1, constructor: 1, prototype: 1 };
  var MAX_DEPTH = 8, LOG_MAX = 300, SEEN_MAX = 5000, POS_MAX = 60;
  var hasOwn = Object.prototype.hasOwnProperty;

  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
  function json(v) { return v === undefined ? '' : JSON.stringify(v); }
  /** a stable text for an item (keys sorted, `by` left out), for keys of items without ref/bankId */
  function stable(v) {
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    if (isObj(v)) return '{' + Object.keys(v).filter(function (k) { return k !== 'by' && v[k] !== undefined; }).sort().map(function (k) { return JSON.stringify(k) + ':' + stable(v[k]); }).join(',') + '}';
    return JSON.stringify(v === undefined ? null : v);
  }
  function itemBase(x) { return x && x.ref ? 'r:' + x.ref : x && x.bankId ? 'b:' + x.bankId : 'j:' + stable(x); }
  /** keys of a keyed list: the item's own key plus #n for repeats, so two equal items stay two */
  function itemKeys(arr) {
    var seen = {};
    return (arr || []).map(function (x) { var b = itemBase(x), n = seen[b] = (seen[b] || 0) + 1; return n > 1 ? b + '#' + n : b; });
  }
  function okSeg(s) { return (typeof s === 'string' && s.length > 0 && s.length <= 60 && !BAD_KEY[s]) || (typeof s === 'number' && s >= 0 && s < 100000 && Math.floor(s) === s); }
  function okPath(p) { return Array.isArray(p) && p.length <= MAX_DEPTH && p.every(okSeg); }

  // ── index of records by id (per array, kept in step with pushes and deletes) ───────────────────────────────────────
  var IX = typeof WeakMap === 'function' ? new WeakMap() : null;
  function index(arr) {
    var m = IX && IX.get(arr);
    if (!m || m.n !== arr.length) {
      m = { n: arr.length, map: new Map() };
      arr.forEach(function (r, i) { if (r && r.id != null) m.map.set(String(r.id), i); });
      if (IX) IX.set(arr, m);
    }
    return m;
  }
  function findRec(arr, id) {
    var m = index(arr), i = m.map.get(String(id));
    if (i === undefined) return null;
    if (arr[i] && String(arr[i].id) === String(id)) return arr[i];
    if (IX) IX.delete(arr); // changed behind the index's back: look again from scratch
    m = index(arr); i = m.map.get(String(id));
    return i === undefined ? null : arr[i];
  }
  function pushRec(arr, rec) { var m = index(arr); arr.push(rec); m.map.set(String(rec.id), arr.length - 1); m.n = arr.length; }

  // ── applying ───────────────────────────────────────────────────────────────────────────────────────────────────────
  function setPath(target, path, pair, guard) {
    if (!okPath(path)) return;
    if (!path.length) { // the whole record / document: merge its fields
      if (pair.length < 2 || !isObj(pair[1])) return;
      Object.keys(pair[1]).forEach(function (k) { if (okSeg(k) && !(guard && guard[k])) target[k] = clone(pair[1][k]); });
      return;
    }
    if (guard && guard[path[0]]) return;
    var o = target;
    for (var i = 0; i < path.length - 1; i++) {
      var k = path[i], nk = path[i + 1], next = o[k];
      var want = typeof nk === 'number' ? 'arr' : 'obj';
      if (want === 'arr' ? !Array.isArray(next) : !isObj(next)) { next = want === 'arr' ? [] : {}; o[k] = next; }
      o = next;
    }
    var last = path[path.length - 1];
    if (pair.length < 2) { if (Array.isArray(o) && typeof last === 'number') { if (last < o.length) o[last] = null; } else delete o[last]; }
    else o[last] = clone(pair[1]);
  }
  function list(st, c) { if (COLLS.indexOf(c) < 0) return null; if (!Array.isArray(st[c])) st[c] = []; return st[c]; }

  /** applies one operation to the document (in place); unknown or malformed operations change nothing */
  function apply(st, op) {
    if (!st || !op || typeof op.type !== 'string') return st;
    var p = isObj(op.p) ? op.p : {}, arr, rec;
    switch (op.type) {
      case 'rec.put':
        arr = list(st, p.c); if (!arr || p.id == null || !Array.isArray(p.f)) return st;
        rec = findRec(arr, p.id);
        if (!rec) { if (!p.n) return st; rec = { id: p.id }; pushRec(arr, rec); }
        var guard = p.c === 'actions' ? TRUSTED : null;
        p.f.forEach(function (pair) { if (Array.isArray(pair)) setPath(rec, pair[0], pair, guard); });
        rec.id = p.id;
        if (p.n && p.c === 'actions' && op.by) { rec.by = op.by; rec.byEmail = op.by; }
        return st;
      case 'rec.del':
        arr = list(st, p.c); if (!arr || !Array.isArray(p.ids)) return st;
        var gone = {}; p.ids.forEach(function (id) { gone[String(id)] = 1; });
        var keep = arr.filter(function (r) { return !(r && gone[String(r.id)]); });
        if (keep.length !== arr.length) { arr.length = 0; keep.forEach(function (r) { arr.push(r); }); if (IX) IX.delete(arr); }
        return st;
      case 'sub.add':
        arr = list(st, p.c); if (!arr || !KEYED[p.c] || !KEYED[p.c][p.k] || !isObj(p.item) || typeof p.key !== 'string') return st;
        rec = findRec(arr, p.id); if (!rec) return st;
        if (!Array.isArray(rec[p.k])) rec[p.k] = [];
        if (itemKeys(rec[p.k]).indexOf(p.key) >= 0) return st;
        var item = clone(p.item); delete item.by; if (op.by) item.by = op.by;
        rec[p.k].push(item);
        return st;
      case 'sub.del':
        arr = list(st, p.c); if (!arr || !KEYED[p.c] || !KEYED[p.c][p.k]) return st;
        rec = findRec(arr, p.id); if (!rec || !Array.isArray(rec[p.k])) return st;
        var at = itemKeys(rec[p.k]).indexOf(p.key);
        if (at >= 0) rec[p.k].splice(at, 1);
        return st;
      case 'doc.put':
        if (!Array.isArray(p.f)) return st;
        p.f.forEach(function (pair) { if (Array.isArray(pair) && Array.isArray(pair[0]) && pair[0].length && !SPECIAL[pair[0][0]]) setPath(st, pair[0], pair); });
        return st;
      case 'set.add':
        if (p.k !== 'bankSeen' || !Array.isArray(p.v)) return st;
        if (!Array.isArray(st.bankSeen)) st.bankSeen = [];
        var have = {}; st.bankSeen.forEach(function (x) { have[x] = 1; });
        p.v.forEach(function (x) { if (typeof x === 'string' && !have[x]) { have[x] = 1; st.bankSeen.push(x); } });
        if (st.bankSeen.length > SEEN_MAX) st.bankSeen.splice(0, st.bankSeen.length - SEEN_MAX);
        return st;
      case 'log.add':
        if (!isObj(p.e) || typeof p.e.text !== 'string') return st;
        if (!Array.isArray(st.log)) st.log = [];
        var e = { at: String(p.e.at || '').slice(0, 30), text: p.e.text.slice(0, 500) }; if (op.by) e.by = op.by;
        st.log.unshift(e); if (st.log.length > LOG_MAX) st.log.length = LOG_MAX;
        return st;
      default: return st; // ws.* and anything newer
    }
  }
  function fold(st, ops) { (ops || []).forEach(function (op) { apply(st, op); }); return st; }

  // ── diffing: what changed between two versions of the document → operations ─────────────────────────────────────
  /** a cheap picture of the document to diff against later: every record as JSON text */
  function shadow(doc) {
    var s = { root: {}, colls: {}, seen: {}, log: [] };
    Object.keys(doc || {}).forEach(function (k) { if (!SPECIAL[k]) s.root[k] = json(doc[k]); });
    COLLS.forEach(function (c) { var m = new Map(); (doc[c] || []).forEach(function (r) { if (r && r.id != null) m.set(String(r.id), json(r)); }); s.colls[c] = m; });
    (doc.bankSeen || []).forEach(function (x) { s.seen[x] = 1; });
    s.log = (doc.log || []).map(function (e) { return json(e && { at: e.at, text: e.text }); });
    return s;
  }
  function diffVal(a, b, path, out, depth) {
    if (b === undefined) { if (a !== undefined) out.push([path]); return; }
    if (json(a) === json(b)) return;
    if (depth < MAX_DEPTH - 1 && isObj(a) && isObj(b)) {
      var keys = {}; Object.keys(a).forEach(function (k) { keys[k] = 1; }); Object.keys(b).forEach(function (k) { keys[k] = 1; });
      Object.keys(keys).forEach(function (k) { if (okSeg(k)) diffVal(a[k], b[k], path.concat(k), out, depth + 1); });
      return;
    }
    if (depth < MAX_DEPTH - 1 && Array.isArray(a) && Array.isArray(b) && a.length === b.length && b.length <= POS_MAX) {
      for (var i = 0; i < b.length; i++) diffVal(a[i], b[i] === undefined ? null : b[i], path.concat(i), out, depth + 1);
      return;
    }
    out.push([path, clone(b)]);
  }
  function stripTrusted(rec) { var r = {}; Object.keys(rec).forEach(function (k) { if (!TRUSTED[k] && rec[k] !== undefined) r[k] = rec[k]; }); return r; }

  /** the operations that turn the document `prev` (a shadow() of it) into `next`, in an order that applies cleanly */
  function diff(prev, next) {
    var ops = [], rootF = [];
    Object.keys(next).forEach(function (k) {
      if (SPECIAL[k] || !okSeg(k)) return;
      var was = prev.root[k];
      if (was === json(next[k])) return;
      diffVal(was === undefined || was === '' ? undefined : JSON.parse(was), next[k], [k], rootF, 0);
    });
    Object.keys(prev.root).forEach(function (k) { if (!(k in next) && okSeg(k)) rootF.push([[k]]); });
    if (rootF.length) ops.push({ type: 'doc.put', p: { f: rootF } });
    COLLS.forEach(function (c) {
      var pm = prev.colls[c] || new Map(), here = {}, keyed = KEYED[c] || {};
      (next[c] || []).forEach(function (r) {
        if (!r || r.id == null) return;
        var id = String(r.id), was = pm.get(id); here[id] = 1;
        if (was === undefined) { ops.push({ type: 'rec.put', p: { c: c, id: r.id, n: 1, f: [[[], clone(c === 'actions' ? stripTrusted(r) : r)]] } }); return; }
        var now = json(r); if (now === was) return;
        var o = JSON.parse(was), f = [], subs = [], keys = {};
        Object.keys(o).forEach(function (k) { keys[k] = 1; }); Object.keys(r).forEach(function (k) { keys[k] = 1; });
        Object.keys(keys).forEach(function (k) {
          if (!okSeg(k) || k === 'id' || (c === 'actions' && TRUSTED[k])) return;
          if (keyed[k] && (Array.isArray(r[k]) || r[k] === undefined)) {
            var ok = itemKeys(o[k]), nk = itemKeys(r[k]);
            ok.forEach(function (key) { if (nk.indexOf(key) < 0) subs.push({ type: 'sub.del', p: { c: c, id: r.id, k: k, key: key } }); });
            nk.forEach(function (key, i) { if (ok.indexOf(key) < 0) subs.push({ type: 'sub.add', p: { c: c, id: r.id, k: k, key: key, item: clone(r[k][i]) } }); });
            return;
          }
          diffVal(o[k], r[k], [k], f, 1);
        });
        if (f.length) ops.push({ type: 'rec.put', p: { c: c, id: r.id, f: f } });
        // removals first, so an item edited in place (removed and added under a new key) never shows twice
        subs.sort(function (a, b) { return (a.type === 'sub.del' ? 0 : 1) - (b.type === 'sub.del' ? 0 : 1); }).forEach(function (s) { ops.push(s); });
      });
      var dels = []; pm.forEach(function (v, id) { if (!here[id]) dels.push(JSON.parse(v).id); });
      for (var i = 0; i < dels.length; i += 500) ops.push({ type: 'rec.del', p: { c: c, ids: dels.slice(i, i + 500) } });
    });
    var add = (next.bankSeen || []).filter(function (x) { return typeof x === 'string' && !prev.seen[x]; });
    for (var j = 0; j < add.length; j += 500) ops.push({ type: 'set.add', p: { k: 'bankSeen', v: add.slice(j, j + 500) } });
    // log lines that were not there before (newest first in the document, so added oldest first)
    var count = {}; prev.log.forEach(function (k) { count[k] = (count[k] || 0) + 1; });
    var fresh = [];
    (next.log || []).forEach(function (e) { var k = json(e && { at: e.at, text: e.text }); if (count[k]) count[k]--; else if (e && typeof e.text === 'string') fresh.push({ at: e.at, text: e.text }); });
    fresh.reverse().forEach(function (e) { ops.push({ type: 'log.add', p: { e: e } }); });
    return ops;
  }

  /** a short description of an operation for the activity list: { kind, c, id, actType, customerId, amount, text } */
  function summary(op) {
    var p = isObj(op && op.p) ? op.p : {}, s = { kind: op && op.type, c: p.c || '' };
    if (op.type === 'rec.put' && p.n && Array.isArray(p.f) && p.f[0] && isObj(p.f[0][1])) {
      var r = p.f[0][1]; s.n = 1;
      if (p.c === 'actions') { s.actType = String(r.type || '').slice(0, 20); s.customerId = String(r.customerId || '').slice(0, 40); if (typeof r.amount === 'number') s.amount = r.amount; }
      if (p.c === 'invoices') s.customerId = String(r.customerId || '').slice(0, 40);
    }
    if (op.type === 'sub.add' && isObj(p.item) && typeof p.item.amount === 'number') s.amount = p.item.amount;
    if (op.type === 'log.add' && isObj(p.e)) s.text = String(p.e.text || '').slice(0, 200);
    if (op.type === 'rec.del' && Array.isArray(p.ids)) s.count = p.ids.length;
    return s;
  }

  return { COLLS: COLLS, apply: apply, fold: fold, diff: diff, shadow: shadow, clone: clone, itemKeys: itemKeys, summary: summary };
});
