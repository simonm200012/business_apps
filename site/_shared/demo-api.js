/* Adrial Apps demo API (static hosting only).
 * The original server answers /api/<app>/... with real company data. This site has no server, so this file
 * answers those calls in the browser with made-up sample data, and shows a "DEMO DATA" badge.
 * Usage (before the app's own script):
 *   <script src="/_shared/demo-api.js"></script>
 *   <script src="demo-api.js"></script>          // the app's module, calls AdrialDemo.register(...)
 * register(prefix, handler): prefix like '/api/ads/'; handler(path, params, ctx) returns a JSON-able object,
 * or { __status: 404, error: '...' } for an error; may return a Promise. ctx = { url, method, body }.
 * Everything is illustrative: no real customers, shops, amounts or e-mail addresses. */
(function () {
  'use strict';
  if (window.AdrialDemo) return;
  var routes = [];
  var realFetch = window.fetch ? window.fetch.bind(window) : null;

  // deterministic random numbers so a page shows the same numbers every time it is opened
  function hash(str) { var h = 2166136261; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) {
    var a = hash(String(seed)) || 1;
    var f = function () { a |= 0; a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    f.between = function (lo, hi) { return lo + (hi - lo) * f(); };
    f.int = function (lo, hi) { return Math.floor(lo + (hi - lo + 1) * f()); };
    f.pick = function (arr) { return arr[Math.floor(f() * arr.length)]; };
    return f;
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(d) { return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function parseDay(s) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null; }
  function today() { var n = new Date(); return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())); }
  function addDays(d, n) { return new Date(d.getTime() + n * 86400000); }
  /** inclusive list of YYYY-MM-DD strings from `from` to `to` */
  function days(from, to) { var a = parseDay(from), b = parseDay(to), out = []; if (!a || !b) return out; for (var d = a; d <= b && out.length < 800; d = addDays(d, 1)) out.push(iso(d)); return out; }
  /** weekday/season shaped multiplier for a day (about 0.6 to 1.5), deterministic */
  function shape(day) { var d = parseDay(day), w = d.getUTCDay(), m = d.getUTCMonth(); var wk = [0.82, 1.0, 1.05, 1.02, 1.08, 1.12, 0.9][w]; var se = 1 + 0.18 * Math.sin((m - 8) / 12 * 2 * Math.PI) + (m === 10 || m === 11 ? 0.2 : 0); return wk * se; }

  function register(prefix, handler) { routes.push({ prefix: prefix, handler: handler }); }

  function respond(status, body, delay) {
    return new Promise(function (resolve) {
      setTimeout(function () {
        resolve(new Response(JSON.stringify(body), { status: status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }));
      }, delay);
    });
  }

  if (realFetch) {
    window.fetch = function (input, init) {
      var raw = typeof input === 'string' ? input : (input && input.url) || '';
      var u;
      try { u = new URL(raw, location.href); } catch (e) { return realFetch(input, init); }
      if (u.origin === location.origin) {
        for (var i = 0; i < routes.length; i++) {
          var r = routes[i];
          if (u.pathname.indexOf(r.prefix) === 0) {
            var path = u.pathname.slice(r.prefix.length);
            var ctx = { url: u, method: ((init && init.method) || (input && input.method) || 'GET').toUpperCase(), body: init && init.body };
            var out;
            try { out = r.handler(path, u.searchParams, ctx); } catch (e) { return respond(500, { error: 'Demo handler error: ' + e.message }, 0); }
            return Promise.resolve(out).then(function (body) {
              if (body && body.__status) { var s = body.__status; var b = Object.assign({}, body); delete b.__status; return respond(s, b, 40); }
              return respond(200, body === undefined ? {} : body, 60 + Math.floor(Math.random() * 120));
            });
          }
        }
      }
      return realFetch(input, init);
    };
  }

  function badge() {
    if (document.getElementById('adrial-demo-badge')) return;
    var b = document.createElement('div');
    b.id = 'adrial-demo-badge';
    b.textContent = 'DEMO DATA';
    b.title = 'Made-up sample data. Nothing here is real.';
    b.setAttribute('style', 'position:fixed;left:12px;bottom:12px;z-index:2147483000;font:600 10px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em;padding:6px 9px;border-radius:999px;background:#fff7e0;color:#7a5200;border:1px solid #e9d28a;box-shadow:0 1px 3px rgba(0,0,0,.12);pointer-events:none');
    document.body.appendChild(b);
  }
  if (document.body) badge(); else document.addEventListener('DOMContentLoaded', badge);

  window.AdrialDemo = { register: register, rng: rng, hash: hash, iso: iso, parseDay: parseDay, today: today, addDays: addDays, days: days, shape: shape };
})();
