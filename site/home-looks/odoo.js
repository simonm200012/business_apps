/* Home page look "odoo": Odoo's home menu (17/18). Extra markup that exists only while this look is active (see
   home-looks/README.md):
   - a calm, centred grid of every app as a big icon tile, pinned apps first; drag a tile (or use Arrange) to reorder,
     which is the page's own pins list (localStorage "stratum-apps-pins", then a storage event so the page redraws too)
   - "Search menus…": typing anywhere starts it; it filters the icons and lists "App / Screen" rows
   - the navbar: the groups as menu sections (a dropdown on smaller screens, the burger drawer on a phone)
   - the systray: search, Activities (the clock: "Needs you today" per app, from localStorage "stratum-needs"), Recent (the
     page's own Quick access, shown as a dropdown), Showcase, Style, Install and the shell's theme switch
   The page stays the source of truth: groups go through its chips, pins through its list, Quick access is its #quick. */
(function () {
  'use strict';
  var NAME = 'odoo', on = false;
  var root = document.documentElement, doc = document;
  var PKEY = 'stratum-apps-pins', NKEY = 'stratum-needs';
  var $ = function (id) { return doc.getElementById(id); };
  var phone = window.matchMedia ? matchMedia('(max-width: 700px)') : { matches: false };
  var reduce = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  var isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
  var P = {
    search: 'M4.5 11a6.5 6.5 0 1 0 13 0a6.5 6.5 0 1 0 -13 0M16 16l4.5 4.5',
    clock: 'M3.5 12a8.5 8.5 0 1 0 17 0a8.5 8.5 0 1 0 -17 0M12 7v5.2l3.3 2',
    history: 'M5.2 15.2A7.6 7.6 0 1 0 5 8.6M4.4 4.6v4.2h4.2M12 8v4.3l2.9 1.8',
    info: 'M12 11v5.5M12 7.8h.01M3.5 12a8.5 8.5 0 1 0 17 0a8.5 8.5 0 1 0 -17 0',
    star: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z',
    bars: 'M4 6.5h16M4 12h16M4 17.5h16',
    chevd: 'M7 10l5 5 5-5', chevl: 'M14.5 6l-6 6 6 6', chevr: 'M9.5 6l6 6-6 6',
    x: 'M6.5 6.5l11 11M17.5 6.5l-11 11',
    install: 'M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14',
    apps: 'M4.5 4.5h6v6h-6zM13.5 4.5h6v6h-6zM4.5 13.5h6v6h-6zM13.5 13.5h6v6h-6z',
    sparkle: 'M12 3.5l1.9 5.6 5.6 1.9-5.6 1.9L12 18.5l-1.9-5.6L4.5 11l5.6-1.9zM18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z',
    cmd: 'M9 6.5a2.5 2.5 0 1 0-2.5 2.5H9zm0 0v11m0-11h6m-6 11a2.5 2.5 0 1 1-2.5-2.5H9zm6-11a2.5 2.5 0 1 1 2.5 2.5H15zm0 0v11m0 0a2.5 2.5 0 1 0 2.5-2.5H15zm0 0H9',
    move: 'M12 4v16M4 12h16M9 6.5L12 3.5l3 3M9 17.5l3 3 3-3M6.5 9L3.5 12l3 3M17.5 9l3 3-3 3',
    finance: 'M3.5 12a8.5 8.5 0 1 0 17 0a8.5 8.5 0 1 0 -17 0M14.8 8.9a3.6 3.6 0 1 0 0 6.2M7.8 11h5M7.8 13.2h5',
    sales: 'M4 10v4h3l7 4.5v-13L7 10zM17.5 9.2a4 4 0 0 1 0 5.6',
    operations: 'M12 3.5l7.5 4v9l-7.5 4-7.5-4v-9zM4.5 7.5l7.5 4 7.5-4M12 11.5v9',
    people: 'M8.4 8.3a3.6 3.6 0 1 0 7.2 0a3.6 3.6 0 1 0 -7.2 0M5 20c.8-3.9 3.6-5.6 7-5.6s6.2 1.7 7 5.6',
    insights: 'M4.5 20h15M7 16.5v-4M11 16.5V8M15 16.5v-6M19 16.5V5',
    studio: 'M4.5 19.5l3.8-1 10.4-10.4a1.9 1.9 0 0 0-2.7-2.7L5.6 15.8zM14.3 6.7l3 3',
    folder: 'M3.5 7V18.5h17V8.5h-8.5l-2-2.5H3.5z',
    filter: 'M4 5.5h16l-6.2 7.2v5.6l-3.6 1.7v-7.3z'
  };
  function svg(n, s, cls) { return '<svg class="i' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" width="' + (s || 16) + '" height="' + (s || 16) + '" aria-hidden="true" focusable="false"><path d="' + (P[n] || P.folder) + '"/></svg>'; }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fold(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function wordRe(w) { return new RegExp('(^|[^a-z0-9])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')); }
  function get(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v === null || v === undefined ? d : v; } catch (e) { return d; } }
  function isField(el) { return !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable); }
  function say(t) { var l = $('live'); if (!l) return; l.textContent = ''; setTimeout(function () { l.textContent = t; }, 30); }
  function make(tag, cls, html) { var e = doc.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; }

  // the apps, read from the page's cards (the same list the page script uses)
  var data = null;
  function readApps() {
    var groups = [], apps = [], byId = {};
    [].forEach.call(doc.querySelectorAll('.group[data-group]'), function (sec) {
      var h = sec.querySelector('.ghead h2');
      var g = { id: sec.getAttribute('data-group'), name: h ? h.textContent.trim() : sec.getAttribute('data-group'), apps: [] };
      groups.push(g);
      [].forEach.call(sec.querySelectorAll('.card[data-app]'), function (c) {
        var link = c.querySelector('a.open'), img = c.querySelector('img.ai'), kind = c.querySelector('.pill.kind'), p = c.querySelector('p');
        if (!link) return;
        var a = { id: c.getAttribute('data-app'), name: link.textContent.trim(), href: link.getAttribute('href'), icon: img ? img.getAttribute('src') : '',
          group: g, kind: kind ? kind.textContent.trim() : '', desc: p ? p.textContent.trim() : '',
          screens: [].map.call(c.querySelectorAll('.screens a'), function (s) { return { name: s.textContent.trim(), href: s.getAttribute('href') }; }) };
        a.text = fold([a.name, g.name, a.kind, a.desc].concat(a.screens.map(function (s) { return s.name; })).join(' '));
        g.apps.push(a); apps.push(a); byId[a.id] = a;
      });
    });
    return { groups: groups, apps: apps, byId: byId };
  }

  // page state
  function pins() { var l = get(PKEY, []); return Array.isArray(l) ? l.filter(function (id, i) { return data.byId[id] && l.indexOf(id) === i; }) : []; }
  function setPins(p) {
    try { localStorage.setItem(PKEY, JSON.stringify(p)); } catch (e) { return; }
    // the page redraws its pinned row, Quick access and pin buttons on a storage event (normally from another tab)
    try { window.dispatchEvent(new StorageEvent('storage', { key: PKEY })); } catch (e) {}
    schedule();
  }
  function order() { var p = pins(); return p.concat(data.apps.map(function (a) { return a.id; }).filter(function (id) { return p.indexOf(id) < 0; })); }
  function curGroup() { var b = doc.querySelector('#chips button[aria-pressed="true"]'); return b ? b.getAttribute('data-g') || '' : ''; }
  function setGroup(g) { var b = doc.querySelector('#chips button[data-g="' + (g || '') + '"]'); if (b) b.click(); }
  function groupName(g) { for (var i = 0; i < data.groups.length; i++) if (data.groups[i].id === g) return data.groups[i].name; return 'All apps'; }

  // "Needs you today", as the page reads it (StratumShell.needs in each app writes it)
  function readNeeds() {
    var all = get(NKEY, {}), now = Date.now(), cutoff = now - 7 * 864e5;
    if (!all || typeof all !== 'object' || Array.isArray(all)) return [];
    return Object.keys(all).map(function (k) {
      var v = all[k] || {}, t = Date.parse(v.at);
      var items = Array.isArray(v.items) ? v.items.filter(function (it) { return it && typeof it.text === 'string' && it.text.trim(); }).slice(0, 3) : [];
      return { a: data.byId[k], at: v.at, t: t, items: items };
    }).filter(function (x) { return x.a && x.items.length && x.t > cutoff && x.t < now + 3e5; })
      .sort(function (x, y) { return y.t - x.t; });
  }
  function when(iso) {
    var d = new Date(iso); if (!iso || isNaN(d)) return '';
    var now = new Date(), start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(), day = 864e5;
    if (d.getTime() >= start) return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    if (d.getTime() >= start - day) return 'Yesterday';
    if (d.getTime() >= start - 6 * day) return d.toLocaleDateString('en-GB', { weekday: 'long' });
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }
  function tone(t) { return t === 'bad' || t === 'warn' ? t : 'info'; }
  function safeHref(h, a) { return typeof h === 'string' && /^\/(?!\/)/.test(h) ? h : a.href; }

  // ---------------------------------------------------------------------------------------------------------------
  var ui = null, st = null, tiles = {};
  function listen(el, type, fn, opt) { if (!el) return; el.addEventListener(type, fn, opt); ui.off.push(function () { el.removeEventListener(type, fn, opt); }); }
  function observe(el, opts) { if (!el || !window.MutationObserver) return; var o = new MutationObserver(schedule); o.observe(el, opts); ui.obs.push(o); }
  function schedule() { if (!on || ui.tick) return; ui.tick = requestAnimationFrame(function () { if (ui) { ui.tick = 0; sync(); } }); }
  function keep(node) { ui.nodes.push(node); return node; }

  function groupItems(cls) {
    return '<button type="button" class="' + cls + '" data-od-g="">' + (cls === 'od-gi' ? svg('apps', 18) : '') + '<span>All apps</span>' + (cls === 'od-gi' ? '<small>' + data.apps.length + '</small>' : '') + '</button>' +
      data.groups.map(function (g) {
        return '<button type="button" class="' + cls + '" data-od-g="' + esc(g.id) + '">' + (cls === 'od-gi' ? svg(P[g.id] ? g.id : 'folder', 18) : '') + '<span>' + esc(g.name) + '</span>' + (cls === 'od-gi' ? '<small>' + g.apps.length + '</small>' : '') + '</button>';
      }).join('');
  }

  function buildNavbar() {
    var tbl = doc.querySelector('.tb-l'), tbr = doc.querySelector('.tb-r'), brand = tbl && tbl.querySelector('.brand');
    // groups: the burger on a phone, "Group ▾" on a smaller screen, inline menu sections on a large one
    var tog = keep(make('button', 'od-gtog', '<span class="od-bars">' + svg('bars', 22) + '</span><span class="od-gl">All apps</span>' + svg('chevd', 14, 'od-caret')));
    tog.type = 'button'; tog.id = 'odGtog';
    tog.setAttribute('aria-haspopup', 'true'); tog.setAttribute('aria-expanded', 'false'); tog.setAttribute('aria-controls', 'odGp');
    tbl.insertBefore(tog, brand || null);
    var secs = keep(make('nav', 'od-secs', groupItems('od-sec')));
    secs.setAttribute('aria-label', 'Groups');
    tbl.appendChild(secs);
    // the groups panel (a dropdown, or the drawer on a phone) lives at the end of the page
    var gp = keep(make('div', 'od-gp'));
    gp.id = 'odGp'; gp.hidden = true; gp.setAttribute('role', 'dialog'); gp.setAttribute('aria-label', 'Groups');
    gp.innerHTML = '<div class="od-gph"><b>Business Apps</b><button type="button" class="od-gpx" aria-label="Close">' + svg('x', 18) + '</button></div>' +
      '<div class="od-gpl"><div class="od-gpt">Groups</div>' + groupItems('od-gi') + '</div>' +
      '<div class="od-gpm"><div class="od-gpt">More</div>' +
      '<a class="od-gi" href="showcase/" data-app="showcase">' + svg('sparkle', 18) + '<span>Showcase</span></a>' +
      '<button type="button" class="od-gi od-gpinst" data-install>' + svg('install', 18) + '<span>Install app</span></button>' +
      '<button type="button" class="od-gi od-gpcmd">' + svg('search', 18) + '<span>Command bar</span></button></div>';
    doc.body.appendChild(gp);
    var scrim = keep(make('div', 'od-scrim')); scrim.hidden = true; doc.body.appendChild(scrim);
    // systray (left to right, like Odoo's): search, activities, recent; the page's Showcase, Style and Install follow
    var frag = doc.createDocumentFragment();
    var sq = keep(make('button', 'od-sb od-sq', svg('search', 18)));
    sq.type = 'button'; sq.id = 'odSearchBtn'; sq.setAttribute('aria-label', 'Search menus'); sq.title = 'Search menus (or just start typing)';
    frag.appendChild(sq);
    var act = keep(make('div', 'od-act', '<button type="button" class="od-sb" id="odActBtn" aria-haspopup="dialog" aria-expanded="false" aria-controls="odActDd" title="Activities: needs you today">' + svg('clock', 19) + '<b class="od-badge" id="odActN" hidden></b></button>' +
      '<div class="od-dd od-actdd" id="odActDd" role="dialog" aria-label="Activities: needs you today" hidden></div>'));
    frag.appendChild(act);
    var rec = keep(make('button', 'od-sb od-rec', svg('history', 19)));
    rec.type = 'button'; rec.id = 'odRecBtn'; rec.setAttribute('aria-haspopup', 'dialog'); rec.setAttribute('aria-expanded', 'false'); rec.setAttribute('aria-controls', 'quick');
    rec.setAttribute('aria-label', 'Recent: recently opened, pinned, new and your data'); rec.title = 'Recent';
    frag.appendChild(rec);
    tbr.insertBefore(frag, tbr.firstChild);
  }

  function buildHome() {
    var mi = doc.querySelector('.mi');
    var home = keep(make('section', 'od-home'));
    home.id = 'odHome'; home.setAttribute('aria-label', 'Apps');
    home.innerHTML =
      '<div class="od-search" role="search">' + svg('search', 18) +
      '<span class="od-facet" hidden><span class="od-fi">' + svg('filter', 13) + '</span><span class="od-fl"></span><button type="button" class="od-fx" aria-label="Remove the group filter">' + svg('x', 13) + '</button></span>' +
      '<label class="sr" for="odQ">Search apps and screens</label>' +
      '<input id="odQ" type="search" placeholder="Search menus…" autocomplete="off" spellcheck="false" enterkeyhint="go" aria-describedby="odSt">' +
      '<button type="button" class="od-sx" aria-label="Clear search" hidden>' + svg('x', 16) + '</button></div>' +
      '<p class="sr" id="odSt" aria-live="polite"></p>' +
      '<div class="od-apps" role="list" aria-label="Apps"></div>' +
      '<div class="od-menus" role="list" aria-label="Screens" hidden></div>' +
      '<p class="od-none" hidden></p>' +
      '<div class="od-foot"><button type="button" class="od-arr" aria-pressed="false">' + svg('move', 15) + '<span>Arrange apps</span></button><span class="od-hint"></span></div>';
    mi.insertBefore(home, mi.firstChild);
    var grid = home.querySelector('.od-apps');
    tiles = {};
    data.apps.forEach(function (a) {
      var e = esc(a.name), t = make('div', 'od-app');
      t.setAttribute('role', 'listitem'); t.setAttribute('data-app', a.id); t.draggable = true;
      t.innerHTML = '<a class="od-link" id="od-t-' + esc(a.id) + '" href="' + esc(a.href) + '" draggable="false" title="' + e + ' · ' + esc(a.group.name) + '">' +
        '<img src="' + esc(a.icon) + '" alt="" width="76" height="76" draggable="false" decoding="async"><span class="od-cap">' + e + '</span></a>' +
        '<button type="button" class="od-pin" data-pin="' + esc(a.id) + '" aria-label="Pin ' + e + '">' + svg('star', 13) + '</button>' +
        (window.AppSheetPanel ? '<button type="button" class="od-info" data-sp-open="' + esc(a.id) + '" aria-label="About ' + e + '" title="About this app">' + svg('info', 13) + '</button>' : '') +
        '<span class="od-ed"><button type="button" class="od-mv" data-od-mv="-1" aria-label="Move ' + e + ' left">' + svg('chevl', 14) + '</button>' +
        '<button type="button" class="od-mv" data-od-mv="1" aria-label="Move ' + e + ' right">' + svg('chevr', 14) + '</button></span>';
      tiles[a.id] = t; grid.appendChild(t);
    });
    if (window.AppSheetPanel) { var band = AppSheetPanel.adjustBand(); band.className += ' od-band'; grid.parentNode.insertBefore(band, grid); }
    ui.home = home; ui.grid = grid; ui.input = home.querySelector('#odQ'); ui.menus = home.querySelector('.od-menus'); ui.none = home.querySelector('.od-none');
  }

  // ---------------------------------------------------------------------------------------------------------------
  // draw: order and pins, the group filter or the search, the sections and the activities
  function sync() {
    if (!on) return;
    var p = pins(), ord = order(), sig = ord.join(','), g = curGroup();
    if (sig !== ui.sig) {
      var act = doc.activeElement, held = act && ui.grid.contains(act) ? act : null;
      ord.forEach(function (id) { ui.grid.appendChild(tiles[id]); });
      if (held && doc.activeElement !== held) held.focus({ preventScroll: true });
      ui.sig = sig;
    }
    ord.forEach(function (id) {
      var t = tiles[id], i = p.indexOf(id), pinned = i >= 0, b = t.querySelector('.od-pin');
      t.classList.toggle('od-pinned', pinned);
      b.setAttribute('aria-pressed', pinned ? 'true' : 'false');
      b.title = pinned ? 'Pinned first. Click to unpin' : 'Pin first';
      var mv = t.querySelectorAll('.od-mv');
      mv[0].disabled = !pinned || i === 0; mv[1].disabled = !pinned || i === p.length - 1;
    });
    [].forEach.call(doc.querySelectorAll('[data-od-g]'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-od-g') === g)); });
    var gl = $('odGtog') && $('odGtog').querySelector('.od-gl'); if (gl) gl.textContent = groupName(g);
    $('odGtog').setAttribute('aria-label', 'Groups: ' + groupName(g));
    var fc = ui.home.querySelector('.od-facet'); fc.hidden = !g; fc.querySelector('.od-fl').textContent = g ? groupName(g) : '';
    var inst = $('inst'), gi = doc.querySelector('.od-gpinst'); if (gi) gi.hidden = !inst || inst.hidden;
    results(false);
    renderActs(false);
    hint();
  }

  function hint() {
    var h = ui.home.querySelector('.od-hint'), a = ui.home.querySelector('.od-arr');
    var n = pins().length;
    a.setAttribute('aria-pressed', st.arrange ? 'true' : 'false');
    a.querySelector('span').textContent = st.arrange ? 'Done' : 'Arrange apps';
    h.textContent = st.arrange ? 'Star an app to keep it first; the arrows move pinned apps.'
      : (phone.matches ? '' : 'Drag icons to arrange them. ') + (n ? n + (n === 1 ? ' pinned app comes' : ' pinned apps come') + ' first.' : 'Pinned apps come first.');
    ui.home.classList.toggle('od-arranging', st.arrange);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // "Search menus…"
  function hl(text, ws) {
    var chars = Array.from(text), f = chars.map(function (c) { return fold(c).charAt(0) || c; }).join(''), mk = chars.map(function () { return false; });
    ws.forEach(function (w) {
      var m = wordRe(w).exec(f), at = m ? m.index + m[1].length : -1;
      if (at >= 0) for (var k = at; k < at + w.length && k < mk.length; k++) mk[k] = true;
    });
    var out = '', open = false;
    chars.forEach(function (c, i) {
      if (mk[i] && !open) { out += '<b>'; open = true; }
      if (!mk[i] && open) { out += '</b>'; open = false; }
      out += esc(c);
    });
    return out + (open ? '</b>' : '');
  }
  function results(fromInput) {
    var q = st.q.trim(), ws = q ? fold(q).split(/\s+/).filter(Boolean) : [], res = ws.map(wordRe), g = curGroup(), shown = [];
    order().forEach(function (id) {
      var a = data.byId[id], ok = (!g || a.group.id === g) && res.every(function (re) { return re.test(a.text); });
      tiles[id].hidden = !ok;
      if (ok) shown.push(tiles[id].querySelector('.od-link'));
    });
    ui.home.classList.toggle('od-q', !!ws.length);
    if (!ws.length) {
      if (ui.lastQ) { ui.menus.innerHTML = ''; ui.menus.hidden = true; ui.none.hidden = true; ui.lastQ = ''; $('odSt').textContent = ''; }
      st.results = shown; if (fromInput) setFocus(-1);
      return;
    }
    if (!fromInput && ui.lastQ === q + '|' + g) return;
    ui.lastQ = q + '|' + g;
    var rows = [];
    data.apps.forEach(function (a) {
      if (g && a.group.id !== g) return;
      a.screens.forEach(function (s) {
        var ft = fold(s.name), fa = fold(a.name), txt = fold(a.name + ' ' + s.name + ' ' + a.group.name), sc = 0;
        for (var i = 0; i < res.length; i++) {
          if (!res[i].test(txt)) return;
          sc += res[i].test(ft) ? (ft.indexOf(ws[i]) === 0 ? 3 : 2) : res[i].test(fa) ? 1 : 0;
        }
        rows.push({ a: a, s: s, sc: sc });
      });
    });
    rows.sort(function (x, y) { return y.sc - x.sc; });
    rows = rows.slice(0, 24);
    ui.menus.innerHTML = rows.map(function (r, i) {
      return '<a class="od-mi" role="listitem" id="od-m-' + i + '" href="' + esc(r.s.href) + '" data-app="' + esc(r.a.id) + '"><img src="' + esc(r.a.icon) + '" alt="" width="22" height="22">' +
        '<span class="od-mt">' + hl(r.a.name, ws) + '<i> / </i>' + hl(r.s.name, ws) + '</span></a>';
    }).join('') +
      '<button type="button" class="od-mi od-mcmd" role="listitem">' + svg('search', 16) + '<span class="od-mt">Search everything for “' + esc(q) + '”<small>Actions, groups and styles in the command bar</small></span><kbd>' + (isMac ? '⌘K' : 'Ctrl K') + '</kbd></button>';
    ui.menus.hidden = false;
    ui.none.hidden = !!(shown.length || rows.length);
    ui.none.textContent = 'No app or screen' + (g ? ' in ' + groupName(g) : '') + ' matches “' + q + '”.' + (g ? ' Remove the group filter to search all apps.' : '');
    st.results = shown.concat([].slice.call(ui.menus.querySelectorAll('.od-mi')));
    setFocus(st.results.length ? 0 : -1);
    $('odSt').textContent = shown.length + (shown.length === 1 ? ' app' : ' apps') + ' and ' + rows.length + (rows.length === 1 ? ' screen' : ' screens') + ' match';
  }
  function setFocus(i, scroll) {
    var prev = ui.home.querySelector('.od-focus'); if (prev) prev.classList.remove('od-focus');
    st.focus = i;
    var el = st.results[i];
    if (!el) { ui.input.removeAttribute('aria-activedescendant'); return; }
    el.classList.add('od-focus');
    if (el.id) ui.input.setAttribute('aria-activedescendant', el.id);
    if (scroll !== false) el.scrollIntoView({ block: 'nearest' });
  }
  function cols(list) {
    var top = null, n = 0;
    for (var i = 0; i < list.length; i++) { var t = list[i].getBoundingClientRect().top; if (top === null) top = t; if (Math.abs(t - top) > 4) break; n++; }
    return Math.max(1, n);
  }
  function openSearch(focus) { ui.home.classList.add('od-s'); if (focus !== false) ui.input.focus(); }
  function clearSearch(hide) {
    ui.input.value = ''; st.q = ''; ui.home.querySelector('.od-sx').hidden = true;
    results(true);
    if (hide) { ui.home.classList.remove('od-s'); if (doc.activeElement === ui.input) ui.input.blur(); }
  }
  function openCommandBar(q) {
    var qi = $('q'), k = $('qK'); if (!qi || !k) return;
    var was = qi.value; qi.value = q || ''; k.click(); qi.value = was;
  }
  function onInput() {
    st.q = ui.input.value;
    ui.home.querySelector('.od-sx').hidden = !st.q;
    results(true);
  }
  function onInputKey(e) {
    var n = st.results.length, i = st.focus, tilesShown = st.results.filter(function (el) { return el.classList.contains('od-link'); }), nt = tilesShown.length;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (ui.input.value && phone.matches) clearSearch(false); else clearSearch(true); return; }
    if (e.key === 'Enter') { e.preventDefault(); var el = st.results[i] || st.results[0]; if (el) el.click(); return; }
    if (e.key === 'Backspace' && !ui.input.value && curGroup()) { e.preventDefault(); setGroup(''); say('Showing all apps'); return; }
    if (!n || !st.q.trim()) return;
    var c = cols(tilesShown);
    if (e.key === 'ArrowDown') { e.preventDefault(); setFocus(i < 0 ? 0 : i < nt ? (i + c < nt ? i + c : Math.min(nt, n - 1)) : Math.min(i + 1, n - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setFocus(i <= 0 ? 0 : i < nt ? Math.max(i - c, 0) : i === nt ? Math.max(0, nt - 1) : i - 1); }
    else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && i >= 0 && i < nt) { e.preventDefault(); setFocus(Math.max(0, Math.min(nt - 1, i + (e.key === 'ArrowRight' ? 1 : -1)))); }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Activities: the clock in the systray, one row per app with what needs you there
  function renderActs(force) {
    var list = readNeeds(), sig = JSON.stringify(list.map(function (x) { return [x.a.id, x.at, x.items]; }));
    var nItems = list.reduce(function (n, x) { return n + x.items.length; }, 0);
    var badge = $('odActN'), btn = $('odActBtn');
    badge.hidden = !nItems; badge.textContent = nItems > 99 ? '99+' : String(nItems);
    btn.setAttribute('aria-label', 'Activities: needs you today' + (nItems ? ', ' + nItems + (nItems === 1 ? ' item' : ' items') + ' from ' + list.length + (list.length === 1 ? ' app' : ' apps') : ', nothing'));
    if (!force && sig === ui.actSig) return;
    ui.actSig = sig;
    var dd = $('odActDd');
    if (!list.length) {
      dd.innerHTML = '<div class="od-ddh"><b>Needs you today</b></div><div class="od-empty">' + svg('clock', 28) + '<span>Nothing needs you right now. Open an app once and what needs you shows up here.</span></div>';
      return;
    }
    dd.innerHTML = '<div class="od-ddh"><b>Needs you today</b><span>' + (list.length === 1 ? '1 app' : list.length + ' apps') + '</span></div><div class="od-agl">' + list.map(function (x) {
      var a = x.a;
      return '<div class="od-ag" data-app="' + esc(a.id) + '"><img src="' + esc(a.icon) + '" alt="" width="40" height="40"><div class="od-agb">' +
        '<div class="od-agt"><a class="od-agn" href="' + esc(a.href) + '">' + esc(a.name) + '</a><time datetime="' + esc(x.at) + '">' + esc(when(x.at)) + '</time></div>' +
        '<div class="od-ais">' + x.items.map(function (it) {
          var n = typeof it.count === 'number' && isFinite(it.count) ? it.count : null, tn = tone(it.tone);
          return '<a class="od-ai" href="' + esc(safeHref(it.href, a)) + '">' + (n === null ? '<i class="od-dot ' + tn + '" aria-hidden="true"></i>' : '<b class="od-n ' + tn + '">' + esc(n.toLocaleString('en-GB')) + '</b>') +
            '<span>' + esc(it.text.replace(/ %/g, ' %')) + '</span></a>';
        }).join('') + '</div></div></div>';
    }).join('') + '</div>';
  }

  // ---------------------------------------------------------------------------------------------------------------
  // dropdowns: activities, recent (the page's #quick) and groups
  function vw() { return doc.documentElement.clientWidth || window.innerWidth; }
  function ddParts(name) {
    return name === 'act' ? { panel: $('odActDd'), btn: $('odActBtn') } : name === 'rec' ? { panel: $('quick'), btn: $('odRecBtn') } : { panel: $('odGp'), btn: $('odGtog') };
  }
  function openDd(name) {
    if (st.open === name) return;
    closeDd(false);
    var d = ddParts(name); if (!d.panel || !d.btn) return;
    st.open = name;
    d.btn.setAttribute('aria-expanded', 'true');
    if (name === 'act') {
      renderActs(true); d.panel.hidden = false;
      var f = d.panel.querySelector('a'); if (f) f.focus({ preventScroll: true });
    } else if (name === 'rec') {
      var r = d.btn.getBoundingClientRect(), w = Math.min(420, vw() - 16);
      root.style.setProperty('--od-qa-top', Math.round(r.bottom + 2) + 'px');
      root.style.setProperty('--od-qa-right', Math.round(Math.max(8, Math.min(vw() - r.right, vw() - w - 8))) + 'px');
      root.classList.add('od-qa-open');
      var t = doc.querySelector('#qaTabs [aria-selected="true"]'); if (t) t.focus({ preventScroll: true });
    } else {
      var rr = d.btn.getBoundingClientRect();
      d.panel.style.setProperty('--od-gx', Math.round(Math.max(8, Math.min(rr.left, vw() - 288))) + 'px');
      d.panel.style.setProperty('--od-gy', Math.round(rr.bottom + 2) + 'px');
      d.panel.hidden = false; doc.querySelector('.od-scrim').hidden = !phone.matches;
      root.classList.add('od-gp-open');
      var c = d.panel.querySelector('.od-gi[aria-pressed="true"]') || d.panel.querySelector('.od-gi'); if (c) c.focus({ preventScroll: true });
    }
  }
  function closeDd(restore) {
    var name = st && st.open; if (!name) return;
    st.open = null;
    var d = ddParts(name);
    if (d.btn) d.btn.setAttribute('aria-expanded', 'false');
    if (name === 'act') { if (d.panel) d.panel.hidden = true; }
    else if (name === 'rec') root.classList.remove('od-qa-open');
    else { if (d.panel) d.panel.hidden = true; var s = doc.querySelector('.od-scrim'); if (s) s.hidden = true; root.classList.remove('od-gp-open'); }
    if (restore && d.btn) d.btn.focus();
  }
  function toggleDd(name) { if (st.open === name) closeDd(false); else openDd(name); }
  function onDocClick(e) {
    if (!st.open) return;
    var d = ddParts(st.open), path = e.composedPath ? e.composedPath() : [];
    function inside(el) { return !!el && (path.indexOf(el) >= 0 || el.contains(e.target)); }
    if (inside(d.panel) || inside(d.btn)) return;
    closeDd(false);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // reorder: drag a tile (pinned apps come first, in the page's pins order), or Arrange mode's stars and arrows
  function visibleTiles() { return [].filter.call(ui.grid.children, function (t) { return !t.hidden; }); }
  function clearDrop() { [].forEach.call(ui.grid.querySelectorAll('.od-db,.od-da'), function (t) { t.classList.remove('od-db', 'od-da'); }); }
  function dropTarget(e) {
    var best = null, bd = Infinity;
    visibleTiles().forEach(function (t) {
      if (t.getAttribute('data-app') === st.drag) return;
      var r = t.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      var d = Math.pow(e.clientX - cx, 2) + 3 * Math.pow(e.clientY - cy, 2);
      if (d < bd) { bd = d; best = { t: t, after: e.clientX > cx }; }
    });
    return best;
  }
  function moveTo(id, targetId, after) {
    var p = pins(), from = p.indexOf(id), name = data.byId[id].name;
    if (p.indexOf(targetId) >= 0) {
      if (from >= 0) p.splice(from, 1);
      p.splice(p.indexOf(targetId) + (after ? 1 : 0), 0, id);
      setPins(p);
      say(name + (from >= 0 ? ' moved to position ' : ' pinned at position ') + (p.indexOf(id) + 1) + ' of ' + p.length);
      return;
    }
    var firstFree = null;
    visibleTiles().some(function (t) { var tid = t.getAttribute('data-app'); if (p.indexOf(tid) < 0 && tid !== id) { firstFree = tid; return true; } return false; });
    if (targetId === firstFree && !after) {
      if (from >= 0) p.splice(from, 1);
      p.push(id); setPins(p);
      say(name + (from >= 0 ? ' moved to position ' : ' pinned at position ') + p.length + ' of ' + p.length);
    } else if (from >= 0) {
      p.splice(from, 1); setPins(p);
      say(name + ' unpinned');
    }
  }
  function onDragStart(e) {
    var t = e.target.closest && e.target.closest('.od-app');
    if (!t || st.q.trim()) { if (t) e.preventDefault(); return; }
    st.drag = t.getAttribute('data-app');
    try { e.dataTransfer.setData('text/plain', t.querySelector('.od-link').href); e.dataTransfer.effectAllowed = 'copyMove'; } catch (x) {}
    setTimeout(function () { if (st && st.drag) t.classList.add('od-dragging'); }, 0);
    ui.grid.classList.add('od-dnd');
  }
  function onDragOver(e) {
    if (!st.drag) return;
    e.preventDefault();
    try { e.dataTransfer.dropEffect = 'move'; } catch (x) {}
    var d = dropTarget(e); clearDrop();
    if (d) d.t.classList.add(d.after ? 'od-da' : 'od-db');
  }
  function onDrop(e) {
    if (!st.drag) return;
    e.preventDefault();
    var id = st.drag, d = dropTarget(e);
    endDrag();
    if (d) moveTo(id, d.t.getAttribute('data-app'), d.after);
  }
  function endDrag() {
    if (!st) return;
    st.drag = null; clearDrop();
    if (ui && ui.grid) { ui.grid.classList.remove('od-dnd'); [].forEach.call(ui.grid.querySelectorAll('.od-dragging'), function (t) { t.classList.remove('od-dragging'); }); }
  }
  function moveBy(id, dir) {
    var p = pins(), i = p.indexOf(id), j = i + dir;
    if (i < 0 || j < 0 || j >= p.length) return;
    p.splice(i, 1); p.splice(j, 0, id); setPins(p);
    say(data.byId[id].name + ' moved to position ' + (j + 1) + ' of ' + p.length);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // keyboard: typing anywhere starts "Search menus…"; arrows move between the icons (only while this look is on)
  function onKey(e) {
    if (!on || e.defaultPrevented) return;
    var cmdOpen = $('cmdk') && !$('cmdk').hidden;
    if (e.key === 'Escape') {
      if (st.open) { e.preventDefault(); closeDd(true); return; }
      if (st.arrange && !cmdOpen) { st.arrange = false; hint(); return; }
      return;
    }
    if (cmdOpen || e.metaKey || e.ctrlKey || e.altKey || isField(doc.activeElement)) return;
    var lm = $('lookMenu'); if (lm && !lm.hidden) return;
    if (e.key && e.key.length === 1 && e.key !== '/' && e.key.trim()) {
      if (st.open) closeDd(false);
      openSearch(true); // the key's character lands in the field that now has the focus
      return;
    }
    var t = doc.activeElement;
    if (t && t.classList && t.classList.contains('od-link') && /^(Arrow(Left|Right|Up|Down)|Home|End)$/.test(e.key)) {
      var links = visibleTiles().map(function (x) { return x.querySelector('.od-link'); }), i = links.indexOf(t), c = cols(links), j = i;
      if (e.key === 'ArrowRight') j = i + 1; else if (e.key === 'ArrowLeft') j = i - 1;
      else if (e.key === 'ArrowDown') j = i + c; else if (e.key === 'ArrowUp') j = i - c;
      else if (e.key === 'Home') j = 0; else j = links.length - 1;
      if (j >= 0 && j < links.length && j !== i) { e.preventDefault(); links[j].focus(); }
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  function wire() {
    var home = ui.home;
    listen(doc, 'keydown', onKey);
    listen(doc, 'click', onDocClick, true);
    listen(ui.input, 'input', onInput);
    listen(ui.input, 'keydown', onInputKey);
    listen(ui.input, 'focus', function () { openSearch(false); });
    listen(ui.input, 'blur', function () { if (!ui.input.value) setTimeout(function () { if (on && !ui.input.value && doc.activeElement !== ui.input) ui.home.classList.remove('od-s'); }, 120); });
    // Arrange mode: the icons do not open their app
    listen(home, 'click', function (e) {
      if (st.arrange && e.target.closest('.od-link')) { e.preventDefault(); }
    }, true);
    listen(home, 'click', function (e) {
      var t = e.target;
      if (t.closest('.od-sx')) { clearSearch(false); ui.input.focus(); return; }
      if (t.closest('.od-fx')) { setGroup(''); say('Showing all apps'); ui.input.focus(); return; }
      if (t.closest('.od-mcmd')) { var q = st.q.trim(); clearSearch(true); openCommandBar(q); return; }
      var mv = t.closest('.od-mv'); if (mv) { var tile = mv.closest('.od-app'); moveBy(tile.getAttribute('data-app'), +mv.getAttribute('data-od-mv')); return; }
      if (t.closest('.od-arr')) { st.arrange = !st.arrange; hint(); if (st.arrange && st.q) clearSearch(true); return; }
    });
    listen(home, 'mousemove', function (e) {
      if (!st.q.trim()) return;
      var el = e.target.closest('.od-link, .od-mi'), i = el ? st.results.indexOf(el) : -1;
      if (i >= 0 && i !== st.focus) setFocus(i, false);
    });
    listen(ui.grid, 'dragstart', onDragStart);
    listen(ui.grid, 'dragover', onDragOver);
    listen(ui.grid, 'drop', onDrop);
    listen(ui.grid, 'dragleave', function (e) { if (!ui.grid.contains(e.relatedTarget)) clearDrop(); });
    listen(doc, 'dragend', endDrag);
    // navbar and systray
    listen($('odSearchBtn'), 'click', function () { if (ui.home.classList.contains('od-s') && !ui.input.value) { ui.home.classList.remove('od-s'); return; } openSearch(true); window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' }); });
    listen($('odActBtn'), 'click', function () { toggleDd('act'); });
    listen($('odRecBtn'), 'click', function () { toggleDd('rec'); });
    listen($('odGtog'), 'click', function () { toggleDd('grp'); });
    listen(doc.querySelector('.od-secs'), 'click', function (e) {
      var b = e.target.closest('[data-od-g]'); if (!b) return;
      if (st.q) clearSearch(true);
      setGroup(b.getAttribute('data-od-g'));
    });
    var gp = $('odGp');
    listen(gp, 'click', function (e) {
      var t = e.target;
      if (t.closest('.od-gpx')) { closeDd(true); return; }
      var b = t.closest('[data-od-g]');
      if (b) { closeDd(true); if (st.q) clearSearch(true); setGroup(b.getAttribute('data-od-g')); say('Showing ' + groupName(b.getAttribute('data-od-g'))); return; }
      if (t.closest('.od-gpinst')) { closeDd(false); var ib = $('instBtn'); if (ib) ib.click(); return; }
      if (t.closest('.od-gpcmd')) { closeDd(false); openCommandBar(''); return; }
      if (t.closest('a[href]')) closeDd(false);
    });
    listen(gp, 'keydown', function (e) {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      var items = [].slice.call(gp.querySelectorAll('.od-gi')).filter(function (x) { return !x.hidden; }), i = items.indexOf(doc.activeElement);
      e.preventDefault(); items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
    });
    listen(doc.querySelector('.od-scrim'), 'click', function () { closeDd(false); });
    listen($('odActDd'), 'click', function (e) {
      if (e.target.closest('a')) { closeDd(false); return; }
      var row = e.target.closest('.od-ag'), a = row && row.querySelector('.od-agn');
      if (a) a.click();
    });
    listen($('quick'), 'click', function (e) { if (e.target.closest('a[href]')) closeDd(false); });
    // the rest of the page
    listen(window, 'scroll', function () { root.classList.toggle('od-scrolled', window.scrollY > 4); }, { passive: true });
    listen(window, 'resize', function () { if (st.open) closeDd(false); });
    listen(window, 'storage', schedule);
    listen(doc, 'visibilitychange', function () { if (!doc.hidden) { ui.actSig = ''; schedule(); } });
    if (phone.addEventListener) listen(phone, 'change', function () { closeDd(false); schedule(); });
    observe($('chips'), { attributes: true, subtree: true, attributeFilter: ['aria-pressed'] });
    observe($('groupsWrap'), { attributes: true, subtree: true, attributeFilter: ['aria-pressed'] });
    observe($('needsBody'), { childList: true, subtree: true });
    observe($('inst'), { attributes: true, attributeFilter: ['hidden'] });
  }

  function mount() {
    if (on) return;
    if (!doc.querySelector('.tb-l') || !doc.querySelector('.tb-r') || !doc.querySelector('.mi') || !$('groupsWrap')) return;
    on = true;
    if (!data) data = readApps();
    st = { q: '', open: null, arrange: false, focus: -1, results: [], drag: null };
    ui = { nodes: [], obs: [], off: [], tick: 0, sig: '', actSig: '', lastQ: '' };
    // the page's own search box is not part of this look: start from an unfiltered page
    var q = $('q'); if (q && q.value) { q.value = ''; q.dispatchEvent(new Event('input', { bubbles: true })); }
    buildNavbar();
    buildHome();
    wire();
    root.classList.toggle('od-scrolled', window.scrollY > 4);
    sync();
  }
  function unmount() {
    if (!on) return;
    closeDd(false);
    on = false;
    if (ui.tick) cancelAnimationFrame(ui.tick);
    ui.obs.forEach(function (o) { o.disconnect(); });
    ui.off.forEach(function (f) { f(); });
    ui.nodes.forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); });
    root.classList.remove('od-qa-open', 'od-gp-open', 'od-scrolled');
    root.style.removeProperty('--od-qa-top'); root.style.removeProperty('--od-qa-right');
    tiles = {}; ui = null; st = null;
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
