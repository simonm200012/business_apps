/* Demo dates: keeps generated demo data as current as the day it was made.
 *
 *   <script src="/_shared/demo-dates.js"></script>      →  window.DemoDates
 *
 * A demo document carries `demoDates: { day, sig, edited }`: the local day it was generated (or last brought up to
 * date) and a fingerprint of its content at that moment. On load an app calls
 *
 *   const r = DemoDates.refresh(doc, opts)
 *     r.action === 'none'        nothing to do (not demo data, or generated today)
 *     r.action === 'shifted'     untouched demo data: every ISO date / timestamp was moved forward by r.days (re-save it)
 *     r.action === 'regenerate'  untouched, and opts.regenerate was set: the app builds a fresh demo for today instead
 *     r.action === 'stale'       the person changed the demo: nothing moved; offer DemoDates.notice(…) instead
 *
 *   DemoDates.bringUp(doc, opts) → days moved (the person pressed "Bring them up to today")
 *   DemoDates.stamp(doc, opts)    → after generating a demo (after the app's own load-time additions)
 *   DemoDates.reseal(doc, opts)   → the app itself upgraded untouched demo data on load: same day, new fingerprint
 *   DemoDates.forget(doc)         → the document is no longer demo data (imported, started empty): never shift it again
 *
 * opts: { ignore: [top-level keys left out of the fingerprint: timestamps of the last save, view state…],
 *         skip:   [top-level keys never shifted, e.g. real data kept next to the demo],
 *         only:   [shift these top-level keys only],
 *         msKeys: [property names whose numbers are epoch milliseconds (shifted too)],
 *         keys:   true to also shift object keys that start with a date ("2026-10-15", "2026-10-15|LJ") }
 * A string is a date when it starts with YYYY-MM-DD and is nothing more, or continues with "T" + time; free text,
 * document numbers ("2026-000123") and ids are never touched. Only the date part changes, so times stay the same.
 * Data without `demoDates` (real data, or demo data from before this helper) is never touched. */
(function () {
  'use strict';
  if (window.DemoDates) return;

  var META = 'demoDates';
  var RE = /^(\d{4})-(\d{2})-(\d{2})(?=$|T\d{2}:\d{2})/;
  var KEY_RE = /^\d{4}-\d{2}-\d{2}(?=$|[T|_:])/;

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parse(s) { return new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), 12); } // noon: DST-safe
  function today() { return ymd(new Date()); }
  function addDays(s, n) { var d = parse(s); d.setDate(d.getDate() + n); return ymd(d); }
  function diff(a, b) { return Math.round((parse(b) - parse(a)) / 864e5); }
  function isDay(s) { var m = RE.exec(s); return !!m && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31; }

  function shiftStr(s, n) { return isDay(s) ? addDays(s.slice(0, 10), n) + s.slice(10) : s; }

  // Moves every date in obj forward by n days, in place. Returns the number of values changed.
  function shift(obj, n, opts) {
    opts = opts || {};
    n = Math.round(+n || 0);
    if (!n || !obj || typeof obj !== 'object') return 0;
    var ms = {}, count = 0;
    (opts.msKeys || []).forEach(function (k) { ms[k] = 1; });
    function walk(o, depth) {
      if (Array.isArray(o)) {
        for (var i = 0; i < o.length; i++) {
          var v = o[i];
          if (typeof v === 'string') { var s = shiftStr(v, n); if (s !== v) { o[i] = s; count++; } }
          else if (v && typeof v === 'object') walk(v, depth + 1);
        }
        return;
      }
      var keys = Object.keys(o), moved = null;
      keys.forEach(function (k) {
        if (depth === 0) {
          if (k === META) return;
          if (opts.skip && opts.skip.indexOf(k) >= 0) return;
          if (opts.only && opts.only.indexOf(k) < 0) return;
        }
        var v = o[k];
        if (typeof v === 'string') { var s = shiftStr(v, n); if (s !== v) { o[k] = s; count++; } }
        else if (typeof v === 'number' && ms[k] && v > 1e11) { o[k] = v + n * 864e5; count++; }
        else if (v && typeof v === 'object') walk(v, depth + 1);
        if (opts.keys && depth > 0 && KEY_RE.test(k) && isDay(k.slice(0, 10))) (moved = moved || []).push(k);
      });
      // date keys: rebuild the object so the moved keys keep their order and never collide with one another
      if (moved) {
        var copy = {};
        keys.forEach(function (k) { copy[k] = o[k]; delete o[k]; });
        keys.forEach(function (k) { o[moved.indexOf(k) >= 0 ? addDays(k.slice(0, 10), n) + k.slice(10) : k] = copy[k]; });
        count += moved.length;
      }
    }
    walk(obj, 0);
    return count;
  }

  // FNV-1a over the JSON of the document, without the bookkeeping and the ignored top-level keys.
  function fingerprint(obj, opts) {
    var ign = (opts && opts.ignore) || [], s;
    try {
      s = JSON.stringify(obj, function (k, v) { return this === obj && (k === META || ign.indexOf(k) >= 0) ? undefined : v; });
    } catch (e) { return ''; }
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36) + '.' + s.length.toString(36);
  }

  function stamp(obj, opts) {
    if (!obj || typeof obj !== 'object') return obj;
    var prev = obj[META] && typeof obj[META] === 'object' ? obj[META] : {};
    obj[META] = { day: today(), sig: fingerprint(obj, opts), edited: !!prev.edited };
    return obj;
  }
  // the app upgraded untouched demo data itself (new fields, migrations): keep the day, take the new fingerprint
  function reseal(obj, opts) {
    var m = obj && obj[META];
    if (m && typeof m === 'object') m.sig = fingerprint(obj, opts);
    return obj;
  }
  function forget(obj) { if (obj && typeof obj === 'object') delete obj[META]; return obj; }

  // { demo, day, age (days since generated), edited } — edited sticks once seen, so only the person moves dates after that.
  function status(obj, opts) {
    var m = obj && typeof obj === 'object' ? obj[META] : null;
    if (!m || typeof m !== 'object' || typeof m.day !== 'string' || !isDay(m.day)) return { demo: false, age: 0, edited: false };
    var edited = !!m.edited || fingerprint(obj, opts) !== m.sig;
    if (edited) m.edited = true;
    return { demo: true, day: m.day, age: diff(m.day, today()), edited: edited };
  }

  function refresh(obj, opts) {
    opts = opts || {};
    var st = status(obj, opts);
    if (!st.demo || st.age <= 0) return { action: 'none', days: 0, edited: st.edited };
    if (st.edited) return { action: 'stale', days: st.age, edited: true };
    if (opts.regenerate) return { action: 'regenerate', days: st.age, edited: false };
    shift(obj, st.age, opts);
    obj[META] = { day: today(), sig: fingerprint(obj, opts), edited: false };
    return { action: 'shifted', days: st.age, edited: false };
  }

  function bringUp(obj, opts) {
    var st = status(obj, opts);
    if (!st.demo || st.age <= 0) return 0;
    shift(obj, st.age, opts);
    obj[META] = { day: today(), sig: fingerprint(obj, opts), edited: st.edited };
    return st.age;
  }

  // A small notice with the action button. The app places it (DemoDates.notice(n, fn) → element) and removes it.
  var cssDone = false;
  function css() {
    if (cssDone) return; cssDone = true;
    var st = document.createElement('style');
    st.textContent =
      '.demo-dates{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;margin:0 0 14px;padding:9px 12px;border:1px solid color-mix(in srgb,currentColor 18%,transparent);' +
      'border-radius:10px;background:color-mix(in srgb,currentColor 5%,transparent);font-size:13px;line-height:1.4}' +
      '.demo-dates span{flex:1 1 220px;min-width:0}' +
      '.demo-dates button{font:inherit;font-weight:600;color:inherit;background:transparent;border:1px solid color-mix(in srgb,currentColor 30%,transparent);border-radius:8px;padding:5px 10px;cursor:pointer;min-height:32px}' +
      '.demo-dates button:hover{background:color-mix(in srgb,currentColor 8%,transparent)}' +
      '.demo-dates button:focus-visible{outline:2px solid currentColor;outline-offset:2px}';
    document.head.appendChild(st);
  }
  function notice(days, onBring, label) {
    css();
    var el = document.createElement('div');
    el.className = 'demo-dates';
    el.setAttribute('role', 'status');
    var t = document.createElement('span');
    t.textContent = 'Demo dates are ' + days + ' day' + (days === 1 ? '' : 's') + ' old' + (label ? ' · ' + label : '') + '.';
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = 'Bring them up to today';
    b.addEventListener('click', function () { b.disabled = true; try { onBring(); } finally { b.disabled = false; } });
    el.appendChild(t); el.appendChild(b);
    return el;
  }

  window.DemoDates = {
    META: META, today: today, addDays: addDays, diff: diff, isDay: isDay,
    shift: shift, fingerprint: fingerprint, stamp: stamp, reseal: reseal, forget: forget, status: status,
    refresh: refresh, bringUp: bringUp, notice: notice
  };
})();
