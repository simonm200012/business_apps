/* Sales sheet for one app, and the "adjust for your company" box, for the Business Apps home page (site/index.html).
   Texts: the sheet comes from _shared/app-sheets.js (window.APP_SHEETS); the adjust box and the "Adjust for your company"
   list are written once, here (ADJUST). Used by:
   - the Microsoft 365 look (inline list + sheet in index.html): AppSheetPanel.sheetHtml(app, { back: true }) and fillAdjust()
   - every other look (home-looks/<look>.js): a button with data-sp-open="<app id>" (AppSheetPanel.aboutBtn(id)) opens the
     sheet in a side panel on a computer and in a bottom sheet on a phone (<= 640px) with a close button, Esc, a click on
     the backdrop, a focus trap, focus back on the opener, and #app=<id> in the address (same as the Microsoft 365 look).
     AppSheetPanel.adjustBand() returns the compact "adjust / company news" band for a look to place above its app grid.
   The panel closes itself when the look changes. It is only used while html[data-look] is not "m365". */
(function (root) {
  'use strict';
  var ADJUST = {
    title: 'Every app can be adjusted for your company',
    lead: 'The apps shown here use sample branding. For a client we change the app to look and work like their own system, so it feels like theirs from day one.',
    items: [
      ['Branding', 'Your logo and your colours on every screen, invoice and report.'],
      ['Fields', 'Add, rename or hide fields, for example a contract number or cost centre.'],
      ['Workflows', 'Your approval steps, statuses and who sees what.'],
      ['Language', 'English, Slovenian, Croatian or German labels and letters.'],
      ['Company news', 'An announcements area on the start screen: opening hours, new rules, campaigns.']
    ],
    newsLabel: 'Example: Company news',
    news: '"Stores close at 14:00 on Friday for stocktake. New returns form is in Operations." Posted by Head office.',
    list: ['Your logo and colours', 'Your fields (for example extra columns or IDs)', 'Your workflow and approval steps', 'Your language', 'A company news area on the start screen']
  };
  // Node (tools/tests/pitch.test.js) and the pitch page (/pitch/) read the same texts
  if (typeof module !== 'undefined' && module.exports) module.exports = { ADJUST: ADJUST };
  if (!root.document) return;
  var STAR = 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z';
  var PLAY = 'M8 5.5v13l10.5-6.5z';
  var X = 'M6.5 6.5l11 11M17.5 6.5l-11 11';
  var doc = root.document;
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function icon(path, n) { return '<svg class="i" viewBox="0 0 24 24" width="' + n + '" height="' + n + '" aria-hidden="true" focusable="false"><path d="' + path + '"/></svg>'; }

  // ── the texts as markup ─────────────────────────────────────────────────────────────────────────────────────
  function sheetHtml(a, o) {
    o = o || {};
    var s = a.sheet || (root.APP_SHEETS || {})[a.id] || { what: a.desc || '', who: '', problem: '', features: [], pitch: '' };
    var hid = o.headingId || 'bSheetH', screens = a.screens || [];
    var tags = (a.isNew ? '<span class="pill new">New</span>' : '') + (a.kind ? '<span class="pill kind">' + esc(a.kind) + '</span>' : '') +
      (a.data ? '<span class="pill data ' + a.data + '">' + (a.data === 'yours' ? 'Your data' : 'Demo data') + '</span>' : '');
    function sec(label, text) { return text ? '<div class="b-sec"><span class="b-lab">' + label + '</span><p>' + esc(text) + '</p></div>' : ''; }
    return (o.back ? '<button type="button" class="b-back" data-bback>← All apps</button>' : '') +
      '<div class="b-hd"><img src="' + esc(a.icon) + '" alt="" width="44" height="44"><div><h3 id="' + hid + '">' + esc(a.name) + '</h3><div class="tags">' + tags + '</div></div></div>' +
      '<div class="b-act" data-app="' + esc(a.id) + '"><a class="fbtn pri b-open" href="' + esc(a.href) + '">Open app</a>' +
      '<a class="fbtn b-play" href="/pitch/?app=' + esc(a.id) + '">' + icon(PLAY, 16) + '<span>Play pitch</span></a>' +
      '<button type="button" class="fbtn" data-pin="' + esc(a.id) + '" aria-pressed="false">' + icon(STAR, 16) + '<span>Pin</span></button></div>' +
      (screens.length ? '<nav class="b-sc" data-app="' + esc(a.id) + '" aria-label="' + esc(a.name) + ' screens">' + screens.map(function (x) { return '<a href="' + esc(x.href) + '">' + esc(x.name) + '</a>'; }).join('') + '</nav>' : '') +
      sec('What it does', s.what) + sec('Who it’s for', s.who) + sec('Problem it solves', s.problem) +
      (s.features.length ? '<div class="b-sec"><span class="b-lab">Key features</span><ul>' + s.features.map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') + '</ul></div>' : '') +
      (s.pitch ? '<div class="b-sec"><div class="b-pitch"><small>How I’d pitch it</small>' + esc(s.pitch) + '</div></div>' : '') +
      '<div class="b-cust"><span class="b-lab">Adjust for your company</span><ul>' + ADJUST.list.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>' +
      '<p>Typical for ' + esc(a.name) + ': same screens, relabelled and recoloured for the client, with their news on top.</p></div>';
  }
  function adjustInner(hid) {
    return '<h3 id="' + hid + '">' + esc(ADJUST.title) + '</h3><p>' + esc(ADJUST.lead) + '</p>' +
      '<ul class="b-adjg">' + ADJUST.items.map(function (i) { return '<li><b>' + esc(i[0]) + '</b><span>' + esc(i[1]) + '</span></li>'; }).join('') + '</ul>' +
      '<p class="b-news"><b>' + esc(ADJUST.newsLabel) + '</b><br>' + esc(ADJUST.news) + '</p>';
  }
  // the Microsoft 365 page box (#bAdj) is filled from the same text
  function fillAdjust(el) { if (el) el.innerHTML = adjustInner('bAdjH') + '<p class="b-playp">' + playAll() + '</p>'; }
  // "Business Apps in 40 seconds": the overall animated pitch (/pitch/?all)
  function playAll() { return '<a class="fbtn pri b-playall" href="/pitch/?all">' + icon(PLAY, 16) + '<span>Business Apps in 40 seconds</span></a>'; }
  // the compact band the other looks place above their app grid: a one-line summary that opens to the full text
  function adjustBand() {
    var d = doc.createElement('section');
    d.className = 'sp-adj'; d.setAttribute('aria-labelledby', 'spAdjH');
    d.innerHTML = '<div class="sp-adj-hd"><b id="spAdjH">' + esc(ADJUST.title) + '</b>' +
      '<span class="sp-adj-chips">' + ADJUST.items.map(function (i) { return '<span>' + esc(i[0]) + '</span>'; }).join('') + '</span>' + playAll() +
      '<button type="button" class="sp-adj-tg" aria-expanded="false" aria-controls="spAdjBody">Details</button></div>' +
      '<div class="sp-adj-body" id="spAdjBody" hidden><p>' + esc(ADJUST.lead) + '</p>' +
      '<ul class="b-adjg">' + ADJUST.items.map(function (i) { return '<li><b>' + esc(i[0]) + '</b><span>' + esc(i[1]) + '</span></li>'; }).join('') + '</ul>' +
      '<p class="b-news"><b>' + esc(ADJUST.newsLabel) + '</b><br>' + esc(ADJUST.news) + '</p></div>';
    d.querySelector('.sp-adj-tg').addEventListener('click', function (e) {
      var b = e.currentTarget, body = d.querySelector('.sp-adj-body'), open = b.getAttribute('aria-expanded') !== 'true';
      b.setAttribute('aria-expanded', String(open)); b.textContent = open ? 'Hide' : 'Details'; body.hidden = !open;
    });
    return d;
  }
  function aboutBtn(id, label, cls) {
    return '<button type="button" class="' + (cls || 'sp-about') + '" data-sp-open="' + esc(id) + '">' + esc(label || 'About') + '</button>';
  }

  var INFO = 'M12 11v5.5M12 7.8h.01M3.5 12a8.5 8.5 0 1 0 17 0a8.5 8.5 0 1 0 -17 0';
  // an "About" button on every card of the page (the cards' own link covers the whole card, so the sheet needs a button
  // of its own); on(false) takes them away again. Looks call it from mount and unmount.
  function cardButtons(on) {
    [].forEach.call(doc.querySelectorAll('[data-sp-made]'), function (b) { if (b.parentNode) b.parentNode.removeChild(b); });
    if (!on) return;
    [].forEach.call(doc.querySelectorAll('.card[data-app]'), function (c) {
      var o = c.querySelector('a.open'); if (!o) return;
      var d = doc.createElement('span');
      d.innerHTML = '<button type="button" class="sp-info" data-sp-made data-sp-open="' + esc(c.getAttribute('data-app')) + '" aria-label="About ' + esc(o.textContent.trim()) + '" title="About this app">' + icon(INFO, 14) + '<span>About</span></button>';
      c.appendChild(d.firstChild);
    });
  }

  // ── apps, read from the cards in the page ──────────────────────────────────────────────────────────────────
  var APPS = null;
  function apps() {
    if (APPS) return APPS;
    APPS = {};
    var SH = root.APP_SHEETS || {};
    [].forEach.call(doc.querySelectorAll('.card[data-app]'), function (c) {
      var o = c.querySelector('a.open'), img = c.querySelector('img.ai'), p = c.querySelector('p'), kind = c.querySelector('.pill.kind'), data = c.querySelector('.pill.data');
      if (!o) return;
      var id = c.getAttribute('data-app');
      APPS[id] = { id: id, name: o.textContent.trim(), href: o.getAttribute('href'), icon: img ? img.getAttribute('src') : '', desc: p ? p.textContent.trim() : '',
        isNew: c.hasAttribute('data-new'), kind: kind ? kind.textContent.trim() : '', data: data ? (data.classList.contains('yours') ? 'yours' : 'demo') : '',
        screens: [].map.call(c.querySelectorAll('.screens a'), function (s) { return { name: s.textContent.trim(), href: s.getAttribute('href') }; }), sheet: SH[id] || null };
    });
    return APPS;
  }

  // ── the panel ──────────────────────────────────────────────────────────────────────────────────────────────
  var el = null, cur = '', opener = null, scrollY = 0, pushed = false;
  var small = root.matchMedia ? root.matchMedia('(max-width: 640px)') : { matches: false };
  function look() { return doc.documentElement.getAttribute('data-look') || 'm365'; }
  function hashId() { var m = /^#app=([\w-]+)$/.exec(root.location.hash); return m && apps()[m[1]] ? m[1] : ''; }
  function pins() { try { var l = JSON.parse(root.localStorage.getItem('stratum-apps-pins')); return Array.isArray(l) ? l : []; } catch (e) { return []; } }
  function build() {
    el = doc.createElement('div');
    el.className = 'sp'; el.hidden = true;
    el.innerHTML = '<div class="sp-back" data-sp-close></div>' +
      '<aside class="sp-pane" role="dialog" aria-modal="true" aria-labelledby="spH" tabindex="-1">' +
      '<button type="button" class="sp-x" data-sp-close aria-label="Close">' + icon(X, 18) + '</button><div class="sp-body"></div></aside>';
    el.addEventListener('click', function (e) { if (e.target.closest('[data-sp-close]')) close(true); });
    doc.body.appendChild(el);
  }
  function pane() { return el.querySelector('.sp-pane'); }
  // how: 'push' (new history entry), 'replace' or 'none' (the address already says it)
  function open(id, how, from) {
    var a = apps()[id]; if (!a || look() === 'm365') return;
    if (!el) build();
    var was = !el.hidden;
    if (!was) { opener = from || doc.activeElement; scrollY = root.pageYOffset; }
    cur = id;
    var body = el.querySelector('.sp-body');
    body.innerHTML = sheetHtml(a, { headingId: 'spH' });
    var p = pins(), pb = body.querySelector('[data-pin]');
    if (pb) { var on = p.indexOf(id) >= 0; pb.setAttribute('aria-pressed', on ? 'true' : 'false'); pb.setAttribute('aria-label', 'Pin ' + a.name); pb.title = on ? 'Pinned to Home. Click to unpin' : 'Pin to Home'; }
    body.scrollTop = 0;
    el.hidden = false;
    doc.documentElement.classList.add('sp-lock');
    var h = '#app=' + id;
    if (root.location.hash !== h) {
      try { if (how === 'push' && !was) { root.history.pushState({ sheet: 1 }, '', h); pushed = true; } else if (how !== 'none') root.history.replaceState(root.history.state, '', h); } catch (e) {}
    }
    pane().focus({ preventScroll: true });
  }
  // hide it; fromUser: also take #app=… out of the address
  function hide() {
    if (!el || el.hidden) return;
    el.hidden = true; cur = '';
    doc.documentElement.classList.remove('sp-lock');
    var o = opener; opener = null;
    if (o && o.focus && doc.contains(o)) o.focus({ preventScroll: true });
    root.scrollTo(0, scrollY);
  }
  function close(fromUser) {
    if (!el || el.hidden) return;
    if (fromUser && /^#app=/.test(root.location.hash)) {
      if (pushed && root.history.state && root.history.state.sheet) { pushed = false; root.history.back(); return; }   // popstate hides it
      try { root.history.replaceState(null, '', root.location.pathname + root.location.search); } catch (e) {}
    }
    pushed = false;
    hide();
  }
  function onHash() {
    if (look() === 'm365') return;
    var id = hashId();
    if (id) { if (id !== cur) open(id, 'none'); } else hide();
  }
  doc.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-sp-open]');
    if (!b || look() === 'm365') return;
    e.preventDefault(); e.stopPropagation();
    open(b.getAttribute('data-sp-open'), 'push', b);
  }, true);
  doc.addEventListener('keydown', function (e) {
    if (!el || el.hidden) return;
    if (e.key === 'Escape' && !e.defaultPrevented) {
      var cx = doc.getElementById('cmdk');
      if (cx && !cx.hidden) return;   // the command bar (⌘K) has its own Esc
      e.preventDefault(); close(true); return;
    }
    if (e.key !== 'Tab') return;
    var f = [].filter.call(pane().querySelectorAll('a[href], button:not([disabled]), [tabindex="0"]'), function (x) { return x.offsetParent !== null; });
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1], act = doc.activeElement;
    if (!pane().contains(act)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && (act === first || act === pane())) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && act === last) { e.preventDefault(); first.focus(); }
  });
  // the page's pin button inside the panel: the page's own handler toggles the pin and redraws; nothing to do here
  root.addEventListener('hashchange', onHash);
  root.addEventListener('popstate', onHash);
  // another look chosen: the panel goes (the address keeps #app=…, the Microsoft 365 look selects that app)
  root.addEventListener('home-look', function (e) {
    if (el) { pushed = false; hide(); if (el.parentNode) el.parentNode.removeChild(el); el = null; }
    if (e.detail && e.detail.look !== 'm365') setTimeout(onHash, 0);
  });
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', function () { setTimeout(onHash, 0); }); else setTimeout(onHash, 0);

  root.AppSheetPanel = { sheetHtml: sheetHtml, fillAdjust: fillAdjust, adjustBand: adjustBand, ADJUST: ADJUST, aboutBtn: aboutBtn, cardButtons: cardButtons, open: function (id) { open(id, 'push'); }, close: function () { close(true); }, app: function (id) { return apps()[id] || null; } };
})(typeof window !== 'undefined' ? window : this);
