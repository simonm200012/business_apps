/* Business Apps — what is left of the "Old design / New design" switch.
 * <script src="/_shared/design-switch.js" data-app="recon" data-current="new" data-old="/recon/" data-new="/recon/new/"></script>
 * The switch showed two different data sets (the new design was a frozen snapshot), so the apps no longer offer it.
 * This file stays for old pages that still load it (only /recon/new/, which nothing links to any more):
 *  - it never redirects and forgets a remembered choice ("stratum-design:<app>"), so nobody is sent to the snapshot;
 *  - on such a page (data-current="new") it shows one small "Open the live app" link in the top-right corner, below
 *    the page's dialogs (z-index 45), and nothing on phones' bottom edge, where the shell bar is. */
(function () {
  'use strict';
  var me = document.currentScript;
  if (!me) return;
  var app = me.getAttribute('data-app') || 'app';
  try { localStorage.removeItem('stratum-design:' + app); } catch (e) { /* storage blocked */ }
  if (me.getAttribute('data-current') !== 'new') return;
  var live = me.getAttribute('data-old') || '../';

  function mount() {
    var host = document.createElement('stratum-design-switch');
    host.setAttribute('style', 'position:fixed;top:calc(12px + env(safe-area-inset-top,0px));right:12px;z-index:45;');
    var root = host.attachShadow({ mode: 'open' });
    root.innerHTML =
      '<style>' +
      ':host{all:initial}' +
      'a{display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:999px;font:500 12px/1 Geist,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;' +
      'background:rgba(255,255,255,.9);color:#1f1e1c;border:1px solid rgba(0,0,0,.12);box-shadow:0 4px 16px rgba(0,0,0,.1);text-decoration:none;white-space:nowrap}' +
      ':host([data-mode="dark"]) a{background:rgba(34,34,32,.9);color:#ecebe7;border-color:rgba(255,255,255,.14)}' +
      'a:focus-visible{outline:2px solid #3f6fd8;outline-offset:1px}' +
      '@media print{a{display:none}}' +
      '</style>' +
      '<a href="' + live + '" title="This page is an old snapshot. The live app has today’s data.">Snapshot · open the live app</a>';
    function syncMode() { host.setAttribute('data-mode', document.documentElement.getAttribute('data-stratum-mode') || 'light'); }
    syncMode();
    window.addEventListener('stratum-theme', syncMode);
    document.body.appendChild(host);
  }
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
})();
