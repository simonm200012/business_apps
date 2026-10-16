/* Home page look "raycast" (see home-looks/README.md). raycast.css turns the page's own sections into one command
   window; this adds what the page has no markup for, and removes it again when another look is chosen:
   - the detail pane for the highlighted app (icon, tags, description, its screens with ⌘1–⌘9, group, last opened, pin),
   - the action bar at the bottom ("Open <app> ↵", "Actions ⌘K" = the page's command bar),
   - the group dropdown in the search field (it opens the page's groups menu),
   - the keyboard: ↑ ↓ move the highlight through the list, ↵ opens it, ⌘1–⌘9 open its screens, typing starts a search.
   Links carry data-app and the app's own href, so the page's click handler records them as recently opened. */
(function () {
  'use strict';
  var NAME = 'raycast';
  var root = document.documentElement;
  var $ = function (id) { return document.getElementById(id); };
  var isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
  var phone = window.matchMedia ? matchMedia('(max-width: 700px)') : { matches: false };
  var fine = window.matchMedia ? matchMedia('(hover: hover) and (pointer: fine)') : { matches: true };
  var ROWS = '#qaBody tr[data-app], #needsBody .need li a, #groupsWrap .card[data-app]';
  var ORDER = ['#qaBody tr[data-app]', '#needsBody .need li a', '#groupsWrap .card[data-app]']; // as the window shows them
  var PATH = { star: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z', chevd: 'M7 10l5 5 5-5', search: 'M4.5 11a6.5 6.5 0 1 0 13 0a6.5 6.5 0 1 0 -13 0M16 16l4.5 4.5' };
  var M = null; // what is mounted: { det, foot, grp, cur, id, kind, off: [], raf }

  function svg(n, s) { return '<svg class="i" viewBox="0 0 24 24" width="' + s + '" height="' + s + '" aria-hidden="true" focusable="false"><path d="' + PATH[n] + '"/></svg>'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function get(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v === null || v === undefined ? d : v; } catch (e) { return d; } }
  function isPinned(id) { var l = get('stratum-apps-pins', []); return Array.isArray(l) && l.indexOf(id) >= 0; }
  function openedAt(id) { var o = get('stratum-apps-opened', {}); return o && typeof o === 'object' && !Array.isArray(o) ? o[id] : null; }
  // "Today, 09:12", "Yesterday", "Monday", "10 Oct" (as the page writes it)
  function when(iso) {
    var d = new Date(iso); if (!iso || isNaN(d)) return '';
    var now = new Date(), start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(), day = 864e5;
    if (d.getTime() >= start) return 'Today, ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    if (d.getTime() >= start - day) return 'Yesterday';
    if (d.getTime() >= start - 6 * day) return d.toLocaleDateString('en-GB', { weekday: 'long' });
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }
  function on(t, ev, fn, opt) { t.addEventListener(ev, fn, opt); M.off.push(function () { t.removeEventListener(ev, fn, opt); }); }
  function watch(t, fn, opt) { var o = new MutationObserver(fn); o.observe(t, opt); M.off.push(function () { o.disconnect(); }); }

  // an app, read from its card in the page
  function app(id) {
    var c = id && document.querySelector('#groupsWrap .card[data-app="' + id + '"]');
    if (!c) return null;
    var g = c.closest('.group'), kind = c.querySelector('.pill.kind'), data = c.querySelector('.pill.data'), p = c.querySelector('p');
    return { id: id, name: c.querySelector('h3').textContent.trim(), href: c.querySelector('a.open').getAttribute('href'), icon: c.querySelector('img.ai').getAttribute('src'),
      desc: p ? p.textContent.trim() : '', isNew: c.hasAttribute('data-new'), kind: kind ? kind.textContent.trim() : '',
      data: data ? (data.classList.contains('yours') ? 'Your data' : 'Demo data') : '', dataTitle: data ? data.title : '',
      group: g ? { id: g.getAttribute('data-group'), name: g.querySelector('h2').textContent.trim() } : null,
      screens: [].map.call(c.querySelectorAll('.screens a'), function (s) { return { name: s.textContent.trim(), href: s.getAttribute('href') }; }) };
  }

  // the list rows and the highlight
  function vis(el) { return !!el && document.contains(el) && el.getClientRects().length > 0; }
  function rows() { return [].concat.apply([], ORDER.map(function (s) { return [].slice.call(document.querySelectorAll(s)); })).filter(vis); }
  // the next row up or down as the eye sees it (in the grid: the tile above or below), or the next tile left or right
  function step(cur, k) {
    var r = rows(); if (!r.length) return null;
    var i = r.indexOf(cur); if (i < 0) return r[0];
    var c = cur.getBoundingClientRect(), cx = c.left + c.width / 2;
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
      var n = r[i + (k === 'ArrowRight' ? 1 : -1)], b = n && n.getBoundingClientRect();
      return b && Math.abs(b.top - c.top) < 4 ? n : null;
    }
    var down = k === 'ArrowDown', tile = cur.matches('.card') && !$('apps').classList.contains('list'), best = null, bt = 0, bd = 0;
    r.forEach(function (x) {
      if (x === cur) return;
      var b = x.getBoundingClientRect();
      if (down ? b.top < c.bottom - 2 : b.bottom > c.top + 2) return;
      var t = down ? b.top : -b.bottom, d = tile ? Math.abs(b.left + b.width / 2 - cx) : b.left; // from a list row: the first tile
      if (!best || t < bt - 3 || (Math.abs(t - bt) <= 3 && d < bd)) { best = x; bt = t; bd = d; }
    });
    return best;
  }
  function hostId(el) { var h = el && el.closest('[data-app]'); return h ? h.getAttribute('data-app') : null; }
  function kindOf(el) { return !el ? null : el.matches('tr') ? 'q' : el.matches('a') ? 'n:' + el.getAttribute('href') : 'c'; }
  function linkOf(el) { return !el ? null : el.matches('a[href]') ? el : el.querySelector('a.ql, a.open'); }
  function pick() { var r = rows(), q = r.filter(function (x) { return x.matches('tr'); }); return q[0] || r[0] || null; }
  function show(el, scroll) {
    if (!M) return;
    if (M.cur !== el) {
      if (M.cur) M.cur.classList.remove('rc-on');
      M.cur = el || null;
      if (el) el.classList.add('rc-on');
    }
    M.kind = kindOf(el);
    if (el && scroll) el.scrollIntoView({ block: 'nearest' });
    var id = hostId(el);
    if (id !== M.id) { M.id = id; renderDet(id); }
    renderFoot(id, linkOf(el));
  }
  // after the page redraws a list, filters or searches: keep the same app highlighted, or take the first row
  function check() {
    if (!M) return;
    M.raf = 0;
    if (M.cur && vis(M.cur)) return;
    var k = M.kind, id = M.id, alt = null;
    if (id) alt = rows().filter(function (r) { return hostId(r) === id && kindOf(r) === k; })[0] || null;
    show(alt || pick(), false);
  }
  function later() { if (M && !M.raf) M.raf = requestAnimationFrame(check); }

  // the detail pane
  function renderDet(id) {
    var a = app(id), d = M.det;
    if (!a) { d.innerHTML = '<div class="rc-dempty">' + svg('search', 28) + '<p>Nothing selected</p></div>'; return; }
    var mod = isMac ? '⌘' : 'Ctrl', last = when(openedAt(a.id)), pinned = isPinned(a.id), e = esc(a.name);
    var tags = (a.isNew ? '<span class="rc-tag red">New</span>' : '') + (a.kind ? '<span class="rc-tag">' + esc(a.kind) + '</span>' : '') +
      (a.data ? '<span class="rc-tag ' + (a.data === 'Your data' ? 'green' : 'blue') + '" title="' + esc(a.dataTitle) + '">' + a.data + '</span>' : '');
    var scr = a.screens.length ? a.screens : [{ name: a.name, href: a.href, open: true }];
    d.innerHTML =
      '<div class="rc-dhead" data-app="' + a.id + '"><img src="' + esc(a.icon) + '" alt="" width="60" height="60">' +
        '<div class="rc-dtt"><h2>' + e + '</h2><div class="rc-tags">' + tags + '</div></div>' +
        '<button type="button" class="rc-dpin" data-pin="' + a.id + '" aria-pressed="' + pinned + '" aria-label="Pin ' + e + '">' + svg('star', 15) + '<span class="off">Pin</span><span class="on">Pinned</span></button></div>' +
      '<p class="rc-ddesc">' + esc(a.desc) + '</p>' +
      '<div class="rc-dl">' + (a.screens.length ? 'Screens' : 'Opens at') + '</div>' +
      '<ul class="rc-scr" data-app="' + a.id + '">' + scr.map(function (s, i) {
        var keys = s.open ? '<kbd class="sym">↵</kbd>' : i < 9 ? '<kbd' + (isMac ? ' class="sym"' : '') + '>' + mod + '</kbd><kbd>' + (i + 1) + '</kbd>' : '';
        return '<li><a href="' + esc(s.href) + '"' + (s.open ? '' : ' data-key="' + (i + 1) + '"') + '><span>' + esc(s.name) + '</span><span class="rc-keys" aria-hidden="true">' + keys + '</span></a></li>';
      }).join('') + '</ul>' +
      '<div class="rc-dl">Information</div><dl class="rc-meta">' +
        (a.group ? '<div><dt>Group</dt><dd><a href="#g-' + esc(a.group.id) + '" data-jump>' + esc(a.group.name) + '</a></dd></div>' : '') +
        (a.kind ? '<div><dt>Type</dt><dd>' + esc(a.kind) + '</dd></div>' : '') +
        (a.data ? '<div><dt>Data</dt><dd>' + a.data + '</dd></div>' : '') +
        '<div><dt>Last opened</dt><dd>' + (last ? esc(last) : 'Not yet') + '</dd></div></dl>';
    var b = d.querySelector('.rc-dpin');
    b.title = pinned ? 'Pinned to Home. Click to unpin' : 'Pin to Home';
  }

  // the action bar
  function renderFoot(id, lk) {
    var a = app(id), f = M.foot, open = f.querySelector('.rc-open'), cur = f.querySelector('.rc-cur');
    open.hidden = cur.hidden = !a;
    if (!a) return;
    var href = lk ? lk.getAttribute('href') : a.href;
    [open, cur].forEach(function (x) { x.setAttribute('href', href); x.setAttribute('data-app', a.id); });
    open.querySelector('b').textContent = ' ' + a.name;
    open.setAttribute('aria-label', 'Open ' + a.name);
    cur.querySelector('img').src = a.icon;
    cur.querySelector('span').textContent = a.name;
  }

  // the group dropdown shows the group in use
  function syncGroup() {
    if (!M) return;
    var b = document.querySelector('#chips button[aria-pressed="true"]'), g = b ? b.getAttribute('data-g') : '';
    var sec = g && document.querySelector('.group[data-group="' + g + '"] h2'), name = sec ? sec.textContent.trim() : '';
    M.grp.querySelector('.rc-grp-t').textContent = name || (phone.matches ? 'All' : 'All groups');
    M.grp.setAttribute('aria-label', 'Show a group: ' + (name || 'All groups'));
  }
  // the groups menu opens under its button (the page puts it beside the rail, which is in the header here)
  function placeMenu() {
    var m = $('gmenu');
    if (!M || m.hidden || phone.matches) return;
    var from = document.querySelector('[data-nav="groups"][aria-expanded="true"]'); if (!from) return;
    var r = from.getBoundingClientRect(), w = m.offsetWidth, h = m.offsetHeight;
    var left = from === M.grp ? r.right - w : r.left;
    left = Math.max(8, Math.min(left, innerWidth - w - 8));
    var top = r.bottom + 6; if (top + h > innerHeight - 8) top = Math.max(8, innerHeight - h - 8);
    m.style.left = left + 'px'; m.style.top = top + 'px';
  }
  // the theme switch of the shell sits at the right end of the header: keep room for it
  function measureShell() {
    if (!M) return;
    var s = document.querySelector('stratum-shell'), w = s ? Math.ceil(s.getBoundingClientRect().width) : 0;
    if (w) root.style.setProperty('--rc-shell', w + 'px');
  }

  // keyboard: only while this look is on, the command bar is closed and no menu is open
  function isField(el) { return !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable); }
  function onKey(e) {
    if (!M || e.defaultPrevented || e.isComposing) return;
    if (!$('cmdk').hidden || !$('gmenu').hidden || !$('lookMenu').hidden) return;
    var ae = document.activeElement, q = $('q');
    var onBody = !ae || ae === document.body || ae === root;
    var inQ = ae === q;
    var inRow = !onBody && !inQ && !isField(ae) && !!(ae.closest && ae.closest(ROWS));
    var k = e.key, mod = e.metaKey || e.ctrlKey, plain = !mod && !e.altKey && !e.shiftKey;
    var lr = (k === 'ArrowLeft' || k === 'ArrowRight') && (onBody || inRow) && M.cur && M.cur.matches('.card') && !$('apps').classList.contains('list');
    if (((k === 'ArrowDown' || k === 'ArrowUp') && (onBody || inQ || inRow) || lr) && plain) {
      if (!rows().length) return;
      e.preventDefault();
      var nx = step(vis(M.cur) ? M.cur : null, k);
      if (!nx) return;
      show(nx, true);
      if (inRow) { var l = linkOf(nx); if (l) l.focus({ preventScroll: true }); }
      return;
    }
    if (k === 'Enter' && plain && (onBody || inQ) && vis(M.cur)) {
      var go = linkOf(M.cur); if (!go) return;
      e.preventDefault(); e.stopPropagation();
      go.click();
      return;
    }
    if (mod && !e.altKey && !e.shiftKey && /^[1-9]$/.test(k) && (onBody || inQ || inRow)) {
      var s = M.det.querySelector('.rc-scr a[data-key="' + k + '"]');
      if (s) { e.preventDefault(); s.click(); }
      return;
    }
    // typing anywhere starts a search ("/" stays the page's shortcut for the command bar)
    if (onBody && k.length === 1 && k !== '/' && k !== ' ' && !mod && !e.altKey && !phone.matches && q && q.offsetParent) q.focus();
  }

  function mount() {
    if (M) return;
    var mi = document.querySelector('.mi'), find = document.querySelector('.find'), main = $('main');
    if (!mi || !find || !main) return;
    M = { cur: null, id: undefined, kind: null, off: [], raf: 0 };

    M.det = document.createElement('aside');
    M.det.className = 'rc-det'; M.det.setAttribute('aria-label', 'Selected app');
    mi.insertBefore(M.det, mi.querySelector('.foot'));

    var hi = $('hi') ? $('hi').textContent : '', today = $('today') ? $('today').textContent : '';
    M.foot = document.createElement('div');
    M.foot.className = 'rc-foot';
    M.foot.innerHTML = '<div class="rc-bar" role="group" aria-label="Actions">' +
      '<span class="rc-hello"><img src="/icons/apps/launcher.png" alt="" width="18" height="18"><b>' + esc(hi) + '</b><span>' + esc(today) + '</span></span>' +
      '<a class="rc-cur" href="#"><img src="" alt="" width="22" height="22"><span></span></a>' +
      '<span class="rc-sp"></span>' +
      '<a class="rc-open" href="#"><span>Open<b></b></span><kbd class="sym" aria-hidden="true">↵</kbd></a><i class="rc-sep" aria-hidden="true"></i>' +
      '<button type="button" class="rc-act" title="Open the command bar">Actions<kbd aria-hidden="true"' + (isMac ? ' class="sym">⌘' : '>Ctrl') + '</kbd><kbd aria-hidden="true">K</kbd></button></div>';
    document.body.appendChild(M.foot);
    on(M.foot.querySelector('.rc-act'), 'click', function () { var k = $('qK'); if (k) k.click(); });

    M.grp = document.createElement('button');
    M.grp.type = 'button'; M.grp.className = 'rc-grp';
    M.grp.setAttribute('data-nav', 'groups'); M.grp.setAttribute('aria-haspopup', 'menu'); M.grp.setAttribute('aria-expanded', 'false');
    M.grp.innerHTML = '<span class="rc-grp-t">All groups</span>' + svg('chevd', 14);
    find.appendChild(M.grp);

    on(window, 'keydown', onKey, true);
    on(main, 'mousemove', function (e) {
      // only a real move: the page scrolling under a still mouse (↑ ↓ scroll the list) must not take the highlight
      if (!fine.matches || (e.clientX === M.mx && e.clientY === M.my)) return;
      M.mx = e.clientX; M.my = e.clientY;
      var r = e.target.closest && e.target.closest(ROWS);
      if (r && r !== M.cur) show(r, false);
    });
    on(main, 'focusin', function (e) { var r = e.target.closest && e.target.closest(ROWS); if (r && r !== M.cur) show(r, false); });
    on($('q'), 'input', function () { var r = rows(); show(this.value.trim() ? r[0] || null : pick(), true); });
    on(window, 'resize', measureShell);
    on(window, 'load', measureShell);
    on(window, 'stratum-theme', function () { setTimeout(measureShell, 0); });
    if (phone.addEventListener) on(phone, 'change', function () { syncGroup(); M.setPh(); later(); });
    watch($('groupsWrap'), later, { subtree: true, attributes: true, attributeFilter: ['data-hide'] });
    watch($('qaBody'), later, { childList: true });
    watch($('needsBody'), later, { childList: true });
    watch(document.body, later, { attributes: true, attributeFilter: ['class'] });
    watch($('chips'), syncGroup, { subtree: true, attributes: true, attributeFilter: ['aria-pressed'] });
    watch($('gmenu'), placeMenu, { attributes: true, attributeFilter: ['hidden'] });
    // a pin toggled elsewhere (a star, ⌘K, another tab) changes "Last opened"/"Pinned" in the pane only on redraw
    on(window, 'storage', function (e) { if (M && (!e.key || /^stratum-apps-/.test(e.key))) { M.id = undefined; show(M.cur, false); } });

    var q = $('q'), n = document.querySelectorAll('#groupsWrap .card[data-app]').length;
    M.ph = q.getAttribute('placeholder');
    M.setPh = function () { q.setAttribute('placeholder', 'Search ' + n + ' apps' + (phone.matches ? '…' : ' and screens…')); };
    M.setPh();
    measureShell(); setTimeout(measureShell, 300);
    syncGroup();
    show(pick(), false);
    // the page marks Home or Apps in the header and tab bar on scroll: let it look again at the new layout
    requestAnimationFrame(function () { window.dispatchEvent(new Event('scroll')); });
  }

  function unmount() {
    if (!M) return;
    var m = M; M = null;
    if (m.raf) cancelAnimationFrame(m.raf);
    m.off.forEach(function (f) { f(); });
    if (m.cur) m.cur.classList.remove('rc-on');
    [].forEach.call(document.querySelectorAll('.rc-on'), function (x) { x.classList.remove('rc-on'); });
    [m.det, m.foot, m.grp].forEach(function (x) { if (x && x.parentNode) x.parentNode.removeChild(x); });
    root.style.removeProperty('--rc-shell');
    if (m.ph !== null && m.ph !== undefined) $('q').setAttribute('placeholder', m.ph);
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
