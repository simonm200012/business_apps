/* Home page look "appstore": the App Store's own structure, built from the page's cards while this look is active (see
   home-looks/README.md). On a computer: a floating sidebar (Discover, Recently opened, New, All apps, the groups, Install)
   and big gradient story cards for the new apps under a "Discover" title. On a phone: a large "Business Apps" title, a
   "Five new apps to try" card and a round search button beside the glass tab bar. Everything else is the page's own
   markup, restyled by appstore.css. Links to apps carry data-app and the card's href, so opening one is remembered. */
(function () {
  'use strict';
  var NAME = 'appstore', on = false, doc = document, root = doc.documentElement;
  var made = [], offs = [], obs = null, tick = 0, spBand = null;
  function $(id) { return doc.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var P = {
    star: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z',
    clock: 'M3.5 12a8.5 8.5 0 1 0 17 0a8.5 8.5 0 1 0 -17 0M12 7.5V12l3 2',
    sparkle: 'M12 3.5l1.9 5.6 5.6 1.9-5.6 1.9L12 18.5l-1.9-5.6L4.5 11l5.6-1.9zM18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z',
    apps: 'M4.5 4.5h6v6h-6zM13.5 4.5h6v6h-6zM4.5 13.5h6v6h-6zM13.5 13.5h6v6h-6z',
    folder: 'M3.5 7V18.5h17V8.5h-8.5l-2-2.5H3.5z',
    finance: 'M3.5 12a8.5 8.5 0 1 0 17 0a8.5 8.5 0 1 0 -17 0M14.8 8.9a3.6 3.6 0 1 0 0 6.2M7.8 11h5M7.8 13.2h5',
    sales: 'M4 10v4h3l7 4.5v-13L7 10zM17.5 9.2a4 4 0 0 1 0 5.6',
    operations: 'M12 3.5l7.5 4v9l-7.5 4-7.5-4v-9zM4.5 7.5l7.5 4 7.5-4M12 11.5v9',
    people: 'M8.4 8.3a3.6 3.6 0 1 0 7.2 0a3.6 3.6 0 1 0 -7.2 0M5 20c.8-3.9 3.6-5.6 7-5.6s6.2 1.7 7 5.6',
    insights: 'M4.5 20h15M7 16.5v-4M11 16.5V8M15 16.5v-6M19 16.5V5',
    studio: 'M4.5 19.5l3.8-1 10.4-10.4a1.9 1.9 0 0 0-2.7-2.7L5.6 15.8zM14.3 6.7l3 3',
    search: 'M4.5 11a6.5 6.5 0 1 0 13 0a6.5 6.5 0 1 0 -13 0M16 16l4.5 4.5',
    chevl: 'M14.5 6l-6 6 6 6', chevr: 'M9.5 6l6 6-6 6', more: 'M5.5 12h.01M12 12h.01M18.5 12h.01'
  };
  function svg(n, s, sw) { return '<svg class="i" viewBox="0 0 24 24" width="' + s + '" height="' + s + '"' + (sw ? ' style="stroke-width:' + sw + '"' : '') + ' aria-hidden="true" focusable="false"><path d="' + P[n] + '"/></svg>'; }
  // story card colours per app (from its icon), [light, mid, deep, Open-button text]; others take one from the spare list
  var GRAD = {
    collections: ['#FF7A6B', '#E5375B', '#A3175A', '#D6305A'], leave: ['#3FD0C9', '#169BB0', '#0B5F86', '#11809C'],
    budget: ['#7BDB8E', '#2BA35E', '#0E6B4A', '#1F8A50'], service: ['#FFC25C', '#FF8A3D', '#D4470F', '#D9541A'],
    datacheck: ['#7FB5FF', '#3F7CF0', '#2A3DB5', '#3461D6']
  };
  var SPARE = [['#C79BFF', '#8A5CF0', '#4B2FB0', '#6E44E0'], ['#FF9BC8', '#E04F98', '#9C1F66', '#C8327F'], ['#9FE0FF', '#3BA7E8', '#1A5FA8', '#2283C9']];
  var TAG = {
    collections: 'Who owes you and who to call today', budget: 'This year’s budget next to what really happened',
    service: 'Technician jobs, dispatch and signed reports', leave: 'Leave requests and the team calendar',
    datacheck: 'Find broken VAT numbers, IBANs and duplicates'
  };
  var NUM = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];

  function readGroups() {
    return [].map.call(doc.querySelectorAll('#groupsWrap > .group[data-group]'), function (g) {
      var id = g.getAttribute('data-group');
      return { id: id, name: g.querySelector('.ghead h2').textContent.trim(), apps: [].map.call(g.querySelectorAll('.card[data-app]'), function (c) {
        var a = c.querySelector('a.open'), k = c.querySelector('.pill.kind'), p = c.querySelector('p');
        return { id: c.getAttribute('data-app'), name: a.textContent.trim(), href: a.getAttribute('href'), icon: c.querySelector('img.ai').getAttribute('src'),
          isNew: c.hasAttribute('data-new'), kind: k ? k.textContent.trim() : 'App', desc: p ? p.textContent.trim() : '' };
      }) };
    });
  }
  function firstPhrase(t) { var s = String(t).split(/[.:;]/)[0].split(', ')[0]; return s.length > 60 ? s.slice(0, 57).replace(/\s+\S*$/, '') + '…' : s; }
  function joinNames(l) { return l.length < 2 ? l.join('') : l.slice(0, -1).join(', ') + ' and ' + l[l.length - 1]; }

  function build() {
    var groups = readGroups(), all = [], fresh = [];
    groups.forEach(function (g) { g.apps.forEach(function (a) { a.gname = g.name; all.push(a); if (a.isNew) fresh.push(a); }); });
    var date = ($('today') && $('today').textContent) || '';

    // sidebar
    var side = doc.createElement('aside');
    side.className = 'as-side'; side.id = 'asSide'; side.setAttribute('aria-label', 'Business Apps');
    side.innerHTML = '<div class="as-q" aria-hidden="true"></div>' +
      '<nav class="as-nav" aria-label="Browse">' +
        '<a href="#top" data-nav="home" data-as="home">' + svg('star', 18) + '<span>Discover</span></a>' +
        '<a href="#quick" data-as="recent">' + svg('clock', 18) + '<span>Recently opened</span></a>' +
        '<a href="#quick" data-nav="new" data-as="new">' + svg('sparkle', 18) + '<span>New</span>' + (fresh.length ? '<b>' + fresh.length + '</b>' : '') + '</a>' +
        '<a href="#apps" data-nav="apps" data-as="apps">' + svg('apps', 18) + '<span>All apps</span><i>' + all.length + '</i></a>' +
      '</nav>' +
      '<div class="as-sh"><span id="asGroupsH">Groups</span><button type="button" class="as-gm" data-nav="groups" aria-haspopup="menu" aria-expanded="false" aria-label="Groups menu" title="Show a group">' + svg('more', 18, 2.6) + '</button></div>' +
      '<nav class="as-groups" aria-labelledby="asGroupsH">' + groups.map(function (g) {
        return '<button type="button" data-as-g="' + esc(g.id) + '" aria-pressed="false">' + svg(P[g.id] ? g.id : 'folder', 18) + '<span>' + esc(g.name) + '</span><i>' + g.apps.length + '</i></button>';
      }).join('') + '</nav>' +
      '<div class="as-foot"><div class="as-inst-slot" aria-hidden="true"></div>' +
        '<a class="as-me" href="showcase/" data-app="showcase"><img src="/icons/apps/launcher.png" alt="" width="30" height="30"><span><b>Business Apps</b><small>Made by Clearfigure</small></span></a></div>';
    var rail = doc.querySelector('.rail');
    rail.parentNode.insertBefore(side, rail);
    made.push(side);

    // large title and the new apps: story cards (computer) and one "Five new apps to try" card (phone)
    var hero = doc.createElement('section');
    hero.className = 'as-hero home-only'; hero.id = 'asHero'; hero.setAttribute('aria-labelledby', 'asTitle');
    var spare = 0;
    hero.innerHTML = '<div class="as-hd"><div class="as-hdt"><p class="as-date">' + esc(date) + '</p><h1 id="asTitle"><span class="as-td">Discover</span><span class="as-tp">Business Apps</span></h1></div>' +
      (fresh.length > 2 ? '<div class="as-arrows"><button type="button" data-as-scroll="-1" aria-label="Previous new apps">' + svg('chevl', 18, 2.2) + '</button><button type="button" data-as-scroll="1" aria-label="More new apps">' + svg('chevr', 18, 2.2) + '</button></div>' : '') + '</div>' +
      (fresh.length ? '<ul class="as-stories" id="asStories" aria-label="New in Business Apps">' + fresh.map(function (a) {
        var c = GRAD[a.id] || SPARE[spare++ % SPARE.length];
        return '<li><a class="as-story" data-app="' + esc(a.id) + '" href="' + esc(a.href) + '" style="--g1:' + c[0] + ';--g2:' + c[1] + ';--g3:' + c[2] + ';--gk:' + c[3] + '">' +
          '<span class="as-ey">New in Business Apps</span><span class="as-st">' + esc(a.name) + '</span><span class="as-ss">' + esc(TAG[a.id] || firstPhrase(a.desc)) + '</span>' +
          '<img class="as-big" src="' + esc(a.icon) + '" alt="" width="132" height="132" decoding="async">' +
          '<span class="as-fo"><span class="as-open">Open</span><span>' + esc(a.gname) + ' · ' + esc(a.kind) + '</span></span></a></li>';
      }).join('') + '</ul>' +
      '<div class="as-today"><a class="as-today-a" href="#quick" data-nav="new"><span class="as-ey">New in Business Apps</span>' +
        '<span class="as-tt">' + (NUM[fresh.length] || fresh.length) + ' new app' + (fresh.length === 1 ? '' : 's') + ' to try</span>' +
        '<span class="as-tx">' + esc(joinNames(fresh.map(function (a) { return a.name; }))) + '.</span></a>' +
        '<ul class="as-ti" aria-label="New apps">' + fresh.slice(0, 5).map(function (a) {
          return '<li><a data-app="' + esc(a.id) + '" href="' + esc(a.href) + '" title="' + esc(a.name) + '"><img src="' + esc(a.icon) + '" alt="' + esc(a.name) + '" width="56" height="56" decoding="async"></a></li>';
        }).join('') + '</ul></div>' : '');
    var top = $('top');
    top.parentNode.insertBefore(hero, top);
    made.push(hero);

    // phone: the round search button next to the tab bar (opens the ⌘K search, like the page's own search button)
    var fab = doc.createElement('button');
    fab.type = 'button'; fab.className = 'as-fab'; fab.id = 'asFab';
    fab.setAttribute('aria-label', 'Search apps and screens'); fab.setAttribute('aria-haspopup', 'dialog');
    fab.innerHTML = svg('search', 24, 2.1);
    var bn = doc.querySelector('.bn');
    bn.parentNode.insertBefore(fab, bn.nextSibling);
    made.push(fab);
  }

  function clearSearch() { var q = $('q'); if (q && q.value) { q.value = ''; q.dispatchEvent(new Event('input', { bubbles: true })); } }
  function goTo(el) { if (el) el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); }
  function selectedGroup() { var b = doc.querySelector('#chips button[aria-pressed="true"]'); return b ? b.getAttribute('data-g') : ''; }
  function chip(g) { var b = $('chips') && $('chips').querySelector('button[data-g="' + g + '"]'); if (b) b.click(); }

  function onSide(e) {
    var t = e.target, g = t.closest('[data-as-g]'), l = t.closest('[data-as]');
    if (g) {
      clearSearch();
      var id = g.getAttribute('data-as-g');
      chip(selectedGroup() === id ? '' : id);
      goTo($('apps'));
      return;
    }
    if (!l) return;
    var k = l.getAttribute('data-as');
    if (k === 'recent') { e.preventDefault(); clearSearch(); var tab = $('tab-recent'); if (tab) tab.click(); goTo($('quick')); }
    else if (k === 'apps' && selectedGroup()) chip('');   // the page itself then scrolls to All apps
  }
  function onClick(e) {
    var s = e.target.closest('[data-as-scroll]');
    if (s) { var row = $('asStories'), card = row && row.querySelector('li'); if (card) row.scrollBy({ left: +s.getAttribute('data-as-scroll') * (card.offsetWidth + 18), behavior: 'smooth' }); return; }
    if (e.target.closest('#asFab')) { var p = $('pSearch'); if (p) p.click(); }
  }
  function arrows() {
    var row = $('asStories'), box = doc.querySelector('.as-arrows');
    if (!row || !box) return;
    var max = row.scrollWidth - row.clientWidth;
    box.hidden = max < 4;
    box.children[0].disabled = row.scrollLeft < 4;
    box.children[1].disabled = row.scrollLeft > max - 4;
  }
  // the sidebar shows where you are: Discover at the top, All apps (or the chosen group) once All apps is in view
  function mark() {
    tick = 0;
    var apps = $('apps'), side = $('asSide');
    if (!apps || !side) return;
    root.classList.toggle('as-scrolled', window.scrollY > 4);
    var g = selectedGroup(), inApps = doc.body.classList.contains('searching') || apps.getBoundingClientRect().top < window.innerHeight * 0.45;
    var key = inApps ? (g ? 'g:' + g : 'apps') : 'home';
    [].forEach.call(side.querySelectorAll('[data-as], [data-as-g]'), function (n) {
      var k = n.hasAttribute('data-as-g') ? 'g:' + n.getAttribute('data-as-g') : n.getAttribute('data-as'), sel = k === key;
      n.classList.toggle('on', sel);
      if (n.hasAttribute('data-as-g')) n.setAttribute('aria-pressed', String(n.getAttribute('data-as-g') === g));
      else if (sel) n.setAttribute('aria-current', 'true'); else n.removeAttribute('aria-current');
    });
  }
  function soon() { if (!tick) tick = requestAnimationFrame(mark); }
  function listen(el, ev, fn, opt) { if (!el) return; el.addEventListener(ev, fn, opt); offs.push(function () { el.removeEventListener(ev, fn, opt); }); }

  function mount() {
    if (on) return;
    on = true;
    build();
    // the sales sheet and the "adjust for your company" band (shared with every look: _shared/app-sheet-panel.js)
    if (window.AppSheetPanel) {
      var gw = $('groupsWrap');
      spBand = AppSheetPanel.adjustBand(); if (gw && gw.parentNode) gw.parentNode.insertBefore(spBand, gw);
      AppSheetPanel.cardButtons(true);
    }
    listen($('asSide'), 'click', onSide);
    listen(doc, 'click', onClick);
    listen(window, 'scroll', soon, { passive: true });
    listen(window, 'resize', function () { soon(); arrows(); });
    listen($('asStories'), 'scroll', arrows, { passive: true });
    if (window.MutationObserver) {
      obs = new MutationObserver(soon);
      if ($('chips')) obs.observe($('chips'), { subtree: true, attributes: true, attributeFilter: ['aria-pressed'] });
      obs.observe(doc.body, { attributes: true, attributeFilter: ['class'] });
    }
    mark(); arrows();
  }
  function unmount() {
    if (!on) return;
    on = false;
    offs.forEach(function (f) { f(); }); offs = [];
    if (obs) { obs.disconnect(); obs = null; }
    if (tick) { cancelAnimationFrame(tick); tick = 0; }
    if (window.AppSheetPanel) AppSheetPanel.cardButtons(false);
    if (spBand && spBand.parentNode) spBand.parentNode.removeChild(spBand); spBand = null;
    made.forEach(function (el) { if (el.parentNode) el.parentNode.removeChild(el); }); made = [];
    root.classList.remove('as-scrolled');
  }
  function apply() { if (root.getAttribute('data-look') === NAME) mount(); else unmount(); }
  // leave at once, arrive just after the event (a microtask): the look being left always takes its markup and the
  // search box text away before the next one sets up, whichever look's script loaded first
  window.addEventListener('home-look', function () {
    if (root.getAttribute('data-look') !== NAME) { unmount(); return; }
    Promise.resolve().then(function () { if (root.getAttribute('data-look') === NAME) mount(); });
  });
  apply();
})();
