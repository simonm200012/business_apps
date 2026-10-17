/* Home page look "classic": extra markup that exists only while this look is active (see home-looks/README.md).
   The earlier cursor.com home page: group links in the top bar and a dark "Browse apps" pill (it opens the groups menu),
   the hero (title, lede, two pill buttons) inside the greeting section, and the search moved from the top bar into the
   sticky toolbar above All apps, next to the Cards / List switch and the group chips. Everything is built from the page's
   own DOM; unmount() takes it all away again and puts the search back in the top bar. */
(function () {
  'use strict';
  var NAME = 'classic', on = false, added = [], timer = 0, tick = 0, place = null;
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function make(tag, cls, html, attrs) {
    var el = document.createElement(tag);
    el.className = cls; if (html) el.innerHTML = html;
    Object.keys(attrs || {}).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    added.push(el);
    return el;
  }
  // "Sales & marketing" fits the top bar as "Sales"; short names stay whole
  function short(n) { return n.length > 12 && n.indexOf(' & ') > 0 ? n.slice(0, n.indexOf(' & ')) : n; }

  function mount() {
    if (on) return; on = true;
    var tb = $('tb'), brand = tb && tb.querySelector('.brand'), right = tb && tb.querySelector('.tb-r');
    var hello = $('top'), ah = document.querySelector('#apps .ah'), find = document.querySelector('.find');
    var groups = [].slice.call(document.querySelectorAll('.group[data-group]'));
    var n = document.querySelectorAll('.card[data-app]').length;

    // top bar: a link per group (data-jump: the page shows all apps first, so the group is there to scroll to)
    if (brand) {
      var links = make('nav', 'cl-links', groups.map(function (g) {
        var h = g.querySelector('h2'); return '<a href="#' + esc(g.id) + '" data-jump>' + esc(short(h ? h.textContent.trim() : g.id)) + '</a>';
      }).join(''), { 'aria-label': 'App groups' });
      brand.parentNode.insertBefore(links, brand.nextSibling);
    }
    // top bar: "Browse apps" opens the page's groups menu (the icon rail that holds it is hidden in this look)
    if (right) {
      right.appendChild(make('button', 'cl-browse', 'Browse apps<svg class="i" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false"><path d="M7 10l5 5 5-5"/></svg>',
        { type: 'button', 'data-nav': 'groups', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-controls': 'gmenu' }));
    }
    // hero, under the greeting (which becomes a small monospace line above it)
    if (hello) {
      hello.appendChild(make('div', 'cl-hero',
        '<p class="cl-title">Business apps for finance, sales, operations and people, in one place.</p>' +
        '<p class="cl-lede">Demos to show customers and tools for your own work. Your data follows you between your phone and your computer.</p>' +
        '<div class="cl-act"><a class="cl-btn" href="#apps" data-nav="apps">Browse all ' + n + ' apps</a>' +
        '<a class="cl-btn ghost" href="showcase/" data-app="showcase">Open the showcase →</a></div>'));
    }
    // the search lives in the toolbar above the apps, as it did
    if (find && ah && find.parentNode !== ah) ah.insertBefore(find, ah.firstChild);
    var q = $('q'); if (q) { place = q.getAttribute('placeholder'); q.setAttribute('placeholder', 'Find an app'); q.addEventListener('input', onInput); }

    // the sales sheet and the "adjust for your company" band (shared with every look: _shared/app-sheet-panel.js)
    if (window.AppSheetPanel) {
      var gw = $('groupsWrap');
      if (gw && gw.parentNode) { var band = AppSheetPanel.adjustBand(); added.push(band); gw.parentNode.insertBefore(band, gw); }
      AppSheetPanel.cardButtons(true);
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    onScroll();
  }

  function unmount() {
    clearTimeout(timer);
    if (!on) return; on = false;
    if (window.AppSheetPanel) AppSheetPanel.cardButtons(false);
    added.forEach(function (el) { if (el.parentNode) el.parentNode.removeChild(el); });
    added = [];
    // put the search back where the page has it: in the top bar, before its right-hand buttons
    var tb = $('tb'), find = document.querySelector('.find'), right = tb && tb.querySelector('.tb-r');
    if (find && tb && find.parentNode !== tb) tb.insertBefore(find, right);
    var q = $('q'); if (q) { q.removeEventListener('input', onInput); if (place !== null) q.setAttribute('placeholder', place); } place = null;
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onScroll);
    if (tick) { cancelAnimationFrame(tick); tick = 0; }
    if (tb) tb.classList.remove('cl-scrolled');
    var ah = document.querySelector('#apps .ah'); if (ah) ah.classList.remove('cl-stuck');
    var menu = $('gmenu'); if (menu) { menu.style.left = ''; menu.style.top = ''; }
  }

  // typing in the toolbar's search hides the sections above it (the page's own rule); when the toolbar was stuck, the
  // first results would end up above the screen, so the page scrolls back to the top of the results. Runs after the
  // page's own input handler.
  function onInput() {
    if (!on) return;
    var apps = $('apps'), tb = $('tb'); if (!apps || !tb) return;
    var top = apps.getBoundingClientRect().top, bar = tb.getBoundingClientRect().bottom;
    if (top < bar - 1) window.scrollTo(0, Math.max(0, window.scrollY + top - bar));
  }

  // hairlines under the top bar once the page scrolls, and under the toolbar once it sticks
  function onScroll() { if (!tick) tick = requestAnimationFrame(draw); }
  function draw() {
    tick = 0;
    if (!on) return;
    var tb = $('tb'), ah = document.querySelector('#apps .ah');
    if (tb) tb.classList.toggle('cl-scrolled', window.scrollY > 4);
    if (tb && ah) {
      var top = ah.getBoundingClientRect().top, bar = tb.getBoundingClientRect().bottom;
      ah.classList.toggle('cl-stuck', ah.offsetParent !== null && top <= bar + 1 && window.scrollY > 4);
    }
  }

  // the page puts the groups menu to the right of whatever opened it (made for the icon rail); under "Browse apps"
  // it drops down from the button instead, right-aligned. Runs after the page's own click handler.
  document.addEventListener('click', function (e) {
    if (!on) return;
    var b = e.target.closest && e.target.closest('.cl-browse'), menu = $('gmenu');
    if (!b || !menu || menu.hidden || window.matchMedia('(max-width: 700px)').matches) return;
    var r = b.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(r.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8)) + 'px';
    menu.style.top = (r.bottom + 8) + 'px';
  });

  function apply(e) {
    var want = document.documentElement.getAttribute('data-look') === NAME;
    if (!want) { unmount(); return; }
    // coming from another look: let its own script take its markup away first (it may hold the search too)
    if (e) { clearTimeout(timer); timer = setTimeout(function () { if (document.documentElement.getAttribute('data-look') === NAME) mount(); }, 0); }
    else mount();
  }
  // leave at once; arrive after a timeout, once the look being left (whatever its script) has restored the page
  window.addEventListener('home-look', apply, true);
  apply();
})();
