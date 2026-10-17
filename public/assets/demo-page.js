/* Branded demo page (/d/<slug>): asks the Worker for this demo's settings once, then draws the page with the shared renderer
   (site/_shared/demo-render.js). A missing, unknown or expired demo shows the same plain text. No cookies, no storage, no tracking.
   "?p=1" (the owner's "Open as prospect") asks without counting a view. */
(function () {
  'use strict';
  var m = /^\/d\/([^/]+)/.exec(location.pathname), el = document.getElementById('demoApp');
  function gone() { el.innerHTML = '<p class="dv-load">' + (window.DEMO_STRINGS.en.notFound) + '</p>'; }
  if (!m || !el) { if (el) gone(); return; }
  var slug = m[1], quiet = /(^|[?&])p=1(&|$)/.test(location.search);
  fetch('/api/demo/' + encodeURIComponent(slug) + (quiet ? '?c=0' : ''), { credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (cfg) {
      if (!cfg) return gone();
      document.documentElement.lang = cfg.lang || 'en';
      document.title = cfg.name;
      el.innerHTML = '';
      window.DemoRender.mount(el, cfg, { logoUrl: '/api/demo/' + encodeURIComponent(slug) + '/logo.png' });
    })
    .catch(gone);
})();
