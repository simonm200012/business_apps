/* Invoices · phone tab bar for the Ramp look (ramp.css shows it under 720px).
 * Costs, Invoices and Vendors jump to their part of the page; Export opens the existing export menu (a bottom sheet on
 * phones) and Settings presses the existing settings button. No data is touched here. */
(function () {
  'use strict';
  var bar = document.getElementById('ramp-tabs');
  if (!bar) return;
  var $ = function (id) { return document.getElementById(id); };
  function setOn(k) {
    bar.querySelectorAll('[data-tab]').forEach(function (b) {
      if (b.dataset.tab === k) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
  }
  function jump(id) { var el = $(id); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  bar.addEventListener('click', function (e) {
    var b = e.target.closest('[data-tab]');
    if (!b) return;
    var k = b.dataset.tab;
    if (k === 'costs') { window.scrollTo({ top: 0, behavior: 'smooth' }); setOn(k); }
    else if (k === 'invoices') { jump('t-h'); setOn(k); }
    else if (k === 'vendors') { jump('c-ven-h'); setOn(k); }
    else if (k === 'export') {
      e.stopPropagation(); // the app closes the menu on any click outside it
      var m = $('export-menu');
      if (m) m.open = !m.open;
    } else if (k === 'settings') { var s = $('settings-btn'); if (s) s.click(); }
  });
  // keep the tab of the part of the page in view lit
  var queued = false;
  window.addEventListener('scroll', function () {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () {
      queued = false;
      var dash = $('dash');
      if (!dash || dash.hidden) { setOn('costs'); return; }
      var y = window.innerHeight * 0.4;
      var t = $('t-h'), v = $('c-ven-h');
      setOn(t && t.getBoundingClientRect().top < y ? 'invoices' : v && v.getBoundingClientRect().top < y ? 'vendors' : 'costs');
    });
  }, { passive: true });
})();
