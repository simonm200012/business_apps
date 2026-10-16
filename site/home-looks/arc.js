/* Home page look "arc": Arc's sidebar and Spaces, built from the page's own cards and lists (see home-looks/README.md).
   While the look is on it adds, and removes again when another look is chosen:
   - in the top bar (which arc.css turns into Arc's sidebar): the favourite tiles (= the pinned apps; drag to reorder or
     drop any app there to pin it, Edit gives arrow buttons), the current Space's apps as pinned tabs (the Home space has
     shortcuts and every group as a folder), the text of the Install card and the space dots at the bottom;
   - at the top of the page: the Space's title with its icon, Cards/List and a "New in <space>" card;
   - a frame that keeps the page a rounded sheet on the gradient while it scrolls.
   It works through the page's own controls, so everything stays in sync: a Space presses the page's group chip,
   Cards/List press the page's view buttons, stars and edit buttons are the page's [data-pin] / [data-move] /
   [data-unpin] / #pinEdit, and a drop writes the same localStorage list and tells the page with a storage event.
   html[data-arc-space] gives each Space its own colours. */
(function () {
  'use strict';
  var NAME = 'arc', on = false;
  var PKEY = 'stratum-apps-pins', RKEY = 'stratum-apps-recent', FKEY = 'stratum-arc-folders';
  var root = document.documentElement;
  var $ = function (id) { return document.getElementById(id); };
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var P = {
    search: 'M4.5 11a6.5 6.5 0 1 0 13 0a6.5 6.5 0 1 0 -13 0M16 16l4.5 4.5',
    star: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z',
    clock: 'M3.5 12a8.5 8.5 0 1 0 17 0a8.5 8.5 0 1 0 -17 0M12 7.5V12l3 2',
    sparkle: 'M12 3.5l1.9 5.6 5.6 1.9-5.6 1.9L12 18.5l-1.9-5.6L4.5 11l5.6-1.9zM18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z',
    finance: 'M3.5 12a8.5 8.5 0 1 0 17 0a8.5 8.5 0 1 0 -17 0M14.8 8.9a3.6 3.6 0 1 0 0 6.2M7.8 11h5M7.8 13.2h5',
    sales: 'M4 10v4h3l7 4.5v-13L7 10zM17.5 9.2a4 4 0 0 1 0 5.6',
    operations: 'M12 3.5l7.5 4v9l-7.5 4-7.5-4v-9zM4.5 7.5l7.5 4 7.5-4M12 11.5v9',
    people: 'M8.4 8.3a3.6 3.6 0 1 0 7.2 0a3.6 3.6 0 1 0 -7.2 0M5 20c.8-3.9 3.6-5.6 7-5.6s6.2 1.7 7 5.6',
    insights: 'M4.5 20h15M7 16.5v-4M11 16.5V8M15 16.5v-6M19 16.5V5',
    studio: 'M4.5 19.5l3.8-1 10.4-10.4a1.9 1.9 0 0 0-2.7-2.7L5.6 15.8zM14.3 6.7l3 3',
    home: 'M4 10.5l8-6.5 8 6.5V20h-5.5v-5.5h-5V20H4z',
    apps: 'M4.5 4.5h6v6h-6zM13.5 4.5h6v6h-6zM4.5 13.5h6v6h-6zM13.5 13.5h6v6h-6z',
    folder: 'M3.5 7V18.5h17V8.5h-8.5l-2-2.5H3.5z',
    bell: 'M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15zM10 20.5h4',
    chevr: 'M9.5 6l6 6-6 6', chevd: 'M7 10l5 5 5-5', chevu: 'M7 14l5-5 5 5',
    x: 'M6.5 6.5l11 11M17.5 6.5l-11 11', arrow: 'M5 12h14M13 6l6 6-6 6',
    more: 'M6 12h.01M12 12h.01M18 12h.01'
  };
  var NUM = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
  function svg(n, s, w) {
    return '<svg class="i" viewBox="0 0 24 24" width="' + s + '" height="' + s + '" aria-hidden="true" focusable="false"' +
      (w ? ' style="stroke-width:' + w + '"' : '') + '><path d="' + (P[n] || P.folder) + '"/></svg>';
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function stored(k) { try { var v = JSON.parse(localStorage.getItem(k)); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
  function say(t) { var l = $('live'); if (!l) return; l.textContent = ''; setTimeout(function () { l.textContent = t; }, 30); }
  function join(l) { return l.length < 2 ? l.join('') : l.slice(0, -1).join(', ') + ' and ' + l[l.length - 1]; }
  function count(n) { return n + (n === 1 ? ' app' : ' apps'); }

  // the apps and groups, read once from the cards in the page
  var M = null;
  function model() {
    if (M) return M;
    M = { groups: [], apps: [], byId: {} };
    [].forEach.call(document.querySelectorAll('#groupsWrap .group[data-group]'), function (sec) {
      var h = sec.querySelector('.ghead h2'), d = sec.querySelector('.ghead p');
      var g = { id: sec.getAttribute('data-group'), name: h ? h.textContent.trim() : '', desc: d ? d.textContent.trim() : '', apps: [] };
      [].forEach.call(sec.querySelectorAll('.card[data-app]'), function (c) {
        var o = c.querySelector('a.open'), img = c.querySelector('img.ai'), p = c.querySelector('p');
        if (!o) return;
        var desc = p ? p.textContent.trim() : '';
        var a = { id: c.getAttribute('data-app'), name: o.textContent.trim(), href: o.getAttribute('href'), icon: img ? img.getAttribute('src') : '',
          isNew: c.hasAttribute('data-new'), short: desc.replace(/^(.+?[.!?])(\s.*)?$/, '$1').replace(/[.!?]$/, ''), group: g };
        g.apps.push(a); M.apps.push(a); M.byId[a.id] = a;
      });
      M.groups.push(g);
    });
    return M;
  }
  function groupById(id) { for (var i = 0; i < M.groups.length; i++) if (M.groups[i].id === id) return M.groups[i]; return null; }
  function ids(k) { var l = stored(k); return l.filter(function (id, i) { return M.byId[id] && l.indexOf(id) === i; }); }
  function pins() { return ids(PKEY); }
  function lastOpened() { return ids(RKEY)[0] || ''; }
  function editing() { var p = $('pins'); return !!p && p.classList.contains('editing'); }
  // the Space shown: the page's own group filter, read from its chips
  function current() {
    var b = document.querySelector('#chips button[aria-pressed="true"]'), g = b ? b.getAttribute('data-g') : '';
    return g && groupById(g) ? g : '';
  }

  var nav, favBox, spBox, bot, head, ban, frame, instTx, obs = [], cur = null, keys = {}, folders = {}, dragId = null, qPh = null;
  try { folders = JSON.parse(sessionStorage.getItem(FKEY)) || {}; } catch (e) { folders = {}; }

  function el(tag, cls, attrs) {
    var e = document.createElement(tag); e.className = cls;
    if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    return e;
  }
  function star(a, p) {
    var pinned = p.indexOf(a.id) >= 0;
    return '<button type="button" class="arc-star" data-pin="' + a.id + '" aria-pressed="' + pinned + '" aria-label="Pin ' + esc(a.name) + '" title="' +
      (pinned ? 'Pinned to Home. Click to unpin' : 'Pin to Home') + '">' + svg('star', 14) + '</button>';
  }
  function tabs(list, last, p) {
    return '<ul class="arc-tabs">' + list.map(function (a) {
      return '<li class="arc-tab' + (a.id === last ? ' on' : '') + '" data-app="' + a.id + '"><a href="' + esc(a.href) + '" title="' + esc(a.name) + '">' +
        '<img src="' + esc(a.icon) + '" alt="" width="18" height="18"><span class="arc-tn">' + esc(a.name) + '</span>' +
        (a.isNew ? '<span class="arc-nw">New</span>' : '') + '</a>' + star(a, p) + '</li>';
    }).join('') + '</ul>';
  }

  // favourites: the pinned apps as tiles (a list with arrow buttons while the page's Edit is on)
  function renderFavs(force) {
    if (!favBox) return;
    var p = pins(), ed = editing() && p.length, last = lastOpened(), key = JSON.stringify([p, ed, last]);
    if (!force && key === keys.favs) return;
    keys.favs = key;
    // keep the focus on the same control when the list is drawn again (the page's own refocus looks in its hidden row)
    var act = document.activeElement, keep = null;
    if (act && favBox.contains(act)) {
      if (act.hasAttribute('data-move')) keep = { move: act.getAttribute('data-move'), id: act.getAttribute('data-id') };
      else if (act.hasAttribute('data-unpin')) keep = { unpin: act.getAttribute('data-unpin'), at: stored(PKEY).indexOf(act.getAttribute('data-unpin')) };
      else if (act.hasAttribute('data-arc-edit')) keep = { edit: true };
      else if (act.closest('[data-app]')) keep = { app: act.closest('[data-app]').getAttribute('data-app') };
    }
    var h = '<div class="arc-fh"><span id="arcFavH">Favourites</span>' + (p.length ? '<button type="button" class="arc-edit" data-arc-edit aria-pressed="' + !!ed + '" aria-label="' +
      (ed ? 'Done editing favourites' : 'Edit favourites') + '">' + (ed ? 'Done' : 'Edit') + '</button>' : '') + '</div>';
    if (ed) {
      h += '<ul class="arc-favs arc-editing" aria-labelledby="arcFavH">' + p.map(function (id, i) {
        var a = M.byId[id], e = esc(a.name);
        return '<li class="arc-fe" data-app="' + id + '"><img src="' + esc(a.icon) + '" alt="" width="18" height="18"><span class="arc-fn">' + e + '</span>' +
          '<button type="button" data-move="-1" data-id="' + id + '" aria-label="Move ' + e + ' up"' + (i === 0 ? ' disabled' : '') + '>' + svg('chevu', 14) + '</button>' +
          '<button type="button" data-unpin="' + id + '" aria-label="Unpin ' + e + '">' + svg('x', 13) + '</button>' +
          '<button type="button" data-move="1" data-id="' + id + '" aria-label="Move ' + e + ' down"' + (i === p.length - 1 ? ' disabled' : '') + '>' + svg('chevd', 14) + '</button></li>';
      }).join('') + '</ul>';
    } else if (p.length) {
      h += '<ul class="arc-favs" aria-labelledby="arcFavH">' + p.map(function (id) {
        var a = M.byId[id];
        return '<li class="arc-fv' + (id === last ? ' on' : '') + '" data-app="' + id + '"><a href="' + esc(a.href) + '" title="' + esc(a.name) + '">' +
          '<img src="' + esc(a.icon) + '" alt="" width="26" height="26"><span class="sr">' + esc(a.name) + '</span></a></li>';
      }).join('') + '</ul>';
    } else {
      h += '<ul class="arc-favs arc-none" aria-labelledby="arcFavH"><li class="arc-slot" aria-hidden="true"></li><li class="arc-slot" aria-hidden="true"></li>' +
        '<li class="arc-slot" aria-hidden="true"></li><li class="arc-slot" aria-hidden="true"></li></ul>' +
        '<p class="arc-hint">Drag an app here, or tap ' + svg('star', 12) + ' on any app, to keep it up here.</p>';
    }
    favBox.innerHTML = h;
    if (keep) {
      var t = null;
      if (keep.move) t = favBox.querySelector('[data-move="' + keep.move + '"][data-id="' + keep.id + '"]:not(:disabled)') || favBox.querySelector('[data-move="' + (-keep.move) + '"][data-id="' + keep.id + '"]');
      else if (keep.unpin) { var rows = favBox.querySelectorAll('[data-unpin]'); t = rows[Math.min(Math.max(keep.at, 0), rows.length - 1)] || favBox.querySelector('[data-arc-edit]'); }
      else if (keep.edit) t = favBox.querySelector('[data-arc-edit]');
      else if (keep.app) t = favBox.querySelector('[data-app="' + keep.app + '"] a, [data-app="' + keep.app + '"] button');
      if (!t) t = favBox.querySelector('a, button') || spBox.querySelector('a, button');
      if (t) t.focus();
    }
  }

  // the Space's own list: its apps as pinned tabs, or (Home) shortcuts and every group as a folder
  function renderSpace(force) {
    if (!spBox) return;
    var g = groupById(cur), last = lastOpened(), key = JSON.stringify([cur, last, folders]);
    if (!force && key === keys.space) return;
    keys.space = key;
    var act = document.activeElement, keepF = act && spBox.contains(act) && act.getAttribute('data-arc-folder');
    var p = pins(), h;
    if (g) {
      h = '<div class="arc-sh"><span class="arc-gi">' + svg(g.id, 15, 2) + '</span><span class="arc-sn">' + esc(g.name) + '</span><span class="arc-sc">' + g.apps.length + '</span>' +
        '<button type="button" class="arc-more" data-nav="groups" aria-haspopup="menu" aria-expanded="false" aria-label="Show a group" title="Groups">' + svg('more', 16, 2.6) + '</button></div>' +
        tabs(g.apps, last, p);
    } else {
      h = '<div class="arc-sh"><span class="arc-gi">' + svg('home', 15, 2) + '</span><span class="arc-sn">Home</span><span class="arc-sc">' + M.apps.length + '</span>' +
        '<button type="button" class="arc-more" data-nav="groups" aria-haspopup="menu" aria-expanded="false" aria-label="Show a group" title="Groups">' + svg('more', 16, 2.6) + '</button></div>' +
        '<ul class="arc-tabs">' +
        '<li class="arc-tab arc-lnk"><a href="#top" data-nav="home">' + svg('sparkle', 18) + '<span class="arc-tn">Today</span></a></li>' +
        '<li class="arc-tab arc-lnk"><a href="#needs" data-arc-go="needs">' + svg('bell', 18) + '<span class="arc-tn">Needs you today</span><span class="arc-cnt" hidden></span></a></li>' +
        '<li class="arc-tab arc-lnk"><a href="#quick" data-arc-go="quick">' + svg('clock', 18) + '<span class="arc-tn">Quick access</span></a></li>' +
        '<li class="arc-tab arc-lnk"><a href="#apps" data-nav="apps">' + svg('apps', 18) + '<span class="arc-tn">All apps</span></a></li></ul>' +
        '<div class="arc-lbl">Spaces</div><ul class="arc-folders">' + M.groups.map(function (gr) {
          var o = !!folders[gr.id];
          return '<li class="arc-folder' + (o ? ' open' : '') + '"><button type="button" class="arc-fb" data-arc-folder="' + gr.id + '" aria-expanded="' + o + '">' +
            svg('chevr', 12, 2.2) + svg(gr.id, 16) + '<span class="arc-tn">' + esc(gr.name) + '</span><span class="arc-sc">' + gr.apps.length + '</span></button>' +
            '<button type="button" class="arc-fo" data-arc-g="' + gr.id + '" aria-label="Open the ' + esc(gr.name) + ' space" title="Open space">' + svg('arrow', 14) + '</button>' +
            (o ? tabs(gr.apps, last, p) : '') + '</li>';
        }).join('') + '</ul>';
    }
    spBox.innerHTML = h;
    syncNeeds();
    if (keepF) { var f = spBox.querySelector('[data-arc-folder="' + keepF + '"]'); if (f) f.focus(); }
  }

  // the page's head: the Space's title, Cards/List and the "New in" card
  function renderHead(force) {
    if (!head) return;
    var g = groupById(cur), last = lastOpened(), key = JSON.stringify([cur, last]);
    if (!force && key === keys.head) return;
    keys.head = key;
    var list = g ? g.apps : M.apps;
    var title = g ? g.name : ((($('hi') || {}).textContent || '').trim() || 'Welcome');
    var sub = g ? (g.desc ? g.desc + ' · ' : '') + count(g.apps.length) : (((($('today') || {}).textContent || '').trim() + ' · ') + count(M.apps.length));
    head.innerHTML = '<span class="arc-badge" aria-hidden="true">' + svg(g ? g.id : 'home', 24, 1.9) + '</span>' +
      '<div class="arc-ht"><h1>' + esc(title) + '</h1><p>' + esc(sub) + '</p></div>' +
      '<div class="arc-tg" role="group" aria-label="Show apps as"><button type="button" data-arc-view="cards" aria-pressed="false">Cards</button>' +
      '<button type="button" data-arc-view="list" aria-pressed="false">List</button></div>';
    var nw = list.filter(function (a) { return a.isNew; }), feat, kick, text;
    if (nw.length) {
      feat = nw; kick = 'New in ' + (g ? g.name : 'Business Apps');
      if (nw.length === 1) text = nw[0].short + '.';
      else if (g) text = nw.map(function (a, i) {
        var c = a.short.split(/[,:;]\s/)[0]; c = c.length >= 12 ? c : a.short;
        return i ? c.charAt(0).toLowerCase() + c.slice(1) : c;
      }).join(', and ') + '.';
      else {
        var gs = []; nw.forEach(function (a) { if (gs.indexOf(a.group.name) < 0) gs.push(a.group.name); });
        text = (NUM[nw.length] || nw.length) + ' new apps in ' + join(gs) + ', each with demo data to try.';
      }
    } else {
      var r = null, rl = ids(RKEY);
      for (var i = 0; i < rl.length; i++) if (list.indexOf(M.byId[rl[i]]) >= 0) { r = M.byId[rl[i]]; break; }
      feat = [r || list[0]]; kick = (r ? 'Last opened in ' : 'Start in ') + (g ? g.name : 'Business Apps');
      text = feat[0].short + '.';
    }
    ban.setAttribute('aria-label', kick);
    ban.innerHTML = '<div class="arc-bt"><small>' + esc(kick) + '</small><h2>' + join(feat.map(function (a) {
      return '<a href="' + esc(a.href) + '" data-app="' + a.id + '">' + esc(a.name) + '</a>';
    })) + '</h2><p>' + esc(text) + '</p></div><div class="arc-bi" aria-hidden="true">' + feat.slice(0, 3).map(function (a) {
      return '<span><img src="' + esc(a.icon) + '" alt="" width="48" height="48"></span>';
    }).join('') + '</div>';
    syncView();
  }

  function renderDots() {
    if (!bot) return;
    [].forEach.call(bot.querySelectorAll('[data-arc-g]'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-arc-g') === cur)); });
  }
  function syncView() {
    var list = !!$('apps') && $('apps').classList.contains('list');
    if (head) [].forEach.call(head.querySelectorAll('[data-arc-view]'), function (b) { b.setAttribute('aria-pressed', String((b.getAttribute('data-arc-view') === 'list') === list)); });
  }
  function syncNeeds() {
    var n = $('bellN'), c = spBox && spBox.querySelector('.arc-cnt');
    if (!c || !n) return;
    c.hidden = n.hidden; c.textContent = n.textContent;
  }
  // the last opened app stands out, like Arc's open tab (page tiles and cards on a phone, list rows)
  function markTiles() {
    var last = lastOpened();
    [].forEach.call(document.querySelectorAll('.arc-on'), function (e) { if (e.getAttribute('data-app') !== last) e.classList.remove('arc-on'); });
    if (last) [].forEach.call(document.querySelectorAll('#pinRow .pt[data-app="' + last + '"], #groupsWrap .card[data-app="' + last + '"]'), function (e) { e.classList.add('arc-on'); });
  }
  function swap() {
    if (reduce) return;
    [head, ban, spBox, $('groupsWrap')].forEach(function (e) {
      if (!e) return;
      e.classList.remove('arc-swap'); void e.offsetWidth; e.classList.add('arc-swap');
    });
  }
  function onGroup() {
    var g = current();
    if (g === cur) return;
    var first = cur === null;
    cur = g;
    root.setAttribute('data-arc-space', cur || 'home');
    renderSpace(); renderHead(); renderDots();
    if (!first) swap();
  }
  function renderAll() { renderFavs(); renderSpace(); renderHead(); renderDots(); syncView(); syncNeeds(); markTiles(); }

  function selectSpace(g) {
    var b = document.querySelector('#chips button[data-g="' + g + '"]');
    if (!b) return;
    b.click();
    window.scrollTo(0, 0);
    say(g ? groupById(g).name + ' space' : 'Home space, all apps');
  }
  function go(where) {
    if (where === 'needs') { var bell = $('bell'); if (bell) bell.click(); return; }
    var q = $('q');
    if (q && q.value) { q.value = ''; q.dispatchEvent(new Event('input')); }
    var t = $(where); if (t) t.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }
  function onClick(e) {
    var t = e.target, b;
    if (!t.closest) return;
    if ((b = t.closest('[data-arc-g]')) && ((bot && bot.contains(b)) || (nav && nav.contains(b)))) { selectSpace(b.getAttribute('data-arc-g')); return; }
    if ((b = t.closest('[data-arc-folder]'))) {
      var id = b.getAttribute('data-arc-folder');
      if (folders[id]) delete folders[id]; else folders[id] = 1;
      try { sessionStorage.setItem(FKEY, JSON.stringify(folders)); } catch (x) {}
      renderSpace(); return;
    }
    if ((b = t.closest('[data-arc-view]'))) {
      var v = document.querySelector('#apps .view button[data-view="' + b.getAttribute('data-arc-view') + '"]');
      if (v) v.click(); return;
    }
    if (t.closest('[data-arc-edit]')) { var pe = $('pinEdit'); if (pe) pe.click(); return; }
    if ((b = t.closest('[data-arc-go]'))) { e.preventDefault(); go(b.getAttribute('data-arc-go')); }
  }

  // drag any app (a card, a row, a tab, a tile) onto the favourites to pin it there, or a tile to move it
  function favList() { return favBox && favBox.querySelector('.arc-favs'); }
  function clearDrop() { [].forEach.call(document.querySelectorAll('.arc-db, .arc-da'), function (x) { x.classList.remove('arc-db', 'arc-da'); }); }
  function dropAt(e) {
    var f = favList(), tiles = f ? [].slice.call(f.querySelectorAll('.arc-fv[data-app]')) : [], best = null, bd = Infinity;
    tiles.forEach(function (t, i) {
      var r = t.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      var d = Math.pow(e.clientX - cx, 2) + 4 * Math.pow(e.clientY - cy, 2);
      if (d < bd) { bd = d; best = { t: t, i: e.clientX > cx ? i + 1 : i, after: e.clientX > cx }; }
    });
    return best || { i: tiles.length };
  }
  function onDragStart(e) {
    if (editing()) return;
    var h = e.target && e.target.closest && e.target.closest('[data-app]');
    if (!h || !M.byId[h.getAttribute('data-app')]) return;
    dragId = h.getAttribute('data-app');
    if (favBox) favBox.classList.add('arc-drop');
  }
  function onDragEnd() { dragId = null; clearDrop(); if (favBox) favBox.classList.remove('arc-drop', 'arc-over'); }
  function onDragOver(e) {
    if (!dragId || !favBox || !favBox.contains(e.target)) return;
    e.preventDefault();
    try { e.dataTransfer.dropEffect = pins().indexOf(dragId) >= 0 ? 'move' : 'copy'; } catch (x) {}
    favBox.classList.add('arc-over');
    var d = dropAt(e); clearDrop();
    if (d.t) d.t.classList.add(d.after ? 'arc-da' : 'arc-db');
  }
  function onDragLeave(e) { if (favBox && !favBox.contains(e.relatedTarget)) { clearDrop(); favBox.classList.remove('arc-over'); } }
  function onDrop(e) {
    if (!dragId || !favBox || !favBox.contains(e.target)) return;
    e.preventDefault();
    var id = dragId, d = dropAt(e), p = pins(), from = p.indexOf(id), at = d.i;
    if (from >= 0) { p.splice(from, 1); if (from < at) at--; }
    p.splice(Math.max(0, Math.min(at, p.length)), 0, id);
    onDragEnd();
    try { localStorage.setItem(PKEY, JSON.stringify(p)); } catch (x) { return; }
    // the page draws its pins again on a storage event (the same one another tab would send)
    try { window.dispatchEvent(new StorageEvent('storage', { key: PKEY })); } catch (x) {}
    renderFavs(true);
    say(M.byId[id].name + (from >= 0 ? ' moved to position ' : ' pinned at position ') + (p.indexOf(id) + 1) + ' of ' + p.length);
  }
  function onStorage(e) { if (!e.key || e.key === PKEY || e.key === RKEY) setTimeout(renderAll, 0); }
  function onShow() { if (!document.hidden) renderAll(); }

  function watch(target, opts, fn) { if (!target) return; var o = new MutationObserver(fn); o.observe(target, opts); obs.push(o); }

  function mount() {
    if (on) return;
    var tb = $('tb'), mi = document.querySelector('#main .mi');
    if (!tb || !mi) return;
    on = true;
    model();
    nav = el('nav', 'arc-nav', { 'aria-label': 'Favourites and spaces' });
    favBox = el('div', 'arc-favbox'); spBox = el('div', 'arc-spbox');
    nav.appendChild(favBox); nav.appendChild(spBox);
    bot = el('div', 'arc-bot');
    bot.innerHTML = '<button type="button" class="arc-ib" data-nav="groups" aria-haspopup="menu" aria-expanded="false" aria-label="Show a group" title="Groups">' + svg('apps', 16) + '</button>' +
      '<div class="arc-dots" role="group" aria-label="Spaces">' + [{ id: '', name: 'Home' }].concat(M.groups).map(function (g) {
        return '<button type="button" data-arc-g="' + g.id + '" aria-pressed="false" aria-label="' + esc(g.id ? g.name + ' space' : 'Home space, all apps') + '" title="' +
          esc(g.id ? g.name : 'Home') + '">' + svg(g.id || 'home', 16) + '</button>';
      }).join('') + '</div>' +
      '<button type="button" class="arc-ib" data-nav="new" aria-label="New apps" title="New apps">' + svg('sparkle', 16) + '</button>';
    tb.appendChild(nav); tb.appendChild(bot);
    head = el('div', 'arc-head'); ban = el('section', 'arc-ban');
    mi.insertBefore(ban, mi.firstChild); mi.insertBefore(head, ban);
    frame = el('div', 'arc-frame', { 'aria-hidden': 'true' }); document.body.appendChild(frame);
    var inst = $('inst'), ih = $('instH');
    if (inst) {
      var where = ((ih && ih.textContent.match(/your (\w+)\s*$/)) || [])[1] || 'computer';
      instTx = el('div', 'arc-it');
      instTx.innerHTML = '<b>Add to your ' + esc(where) + '</b><small>Opens as an app</small>';
      inst.insertBefore(instTx, inst.firstChild);
    }
    var q = $('q'); if (q) { qPh = q.getAttribute('placeholder'); q.setAttribute('placeholder', 'Search ' + M.apps.length + ' apps'); }
    var ps = $('pSearch'); if (ps) ps.setAttribute('data-arc-label', 'Search ' + M.apps.length + ' apps');

    cur = null; keys = {};
    onGroup();
    renderAll();
    watch($('chips'), { subtree: true, attributes: true, attributeFilter: ['aria-pressed'] }, onGroup);
    watch($('pinRow'), { childList: true }, function () { renderFavs(); markTiles(); });
    watch($('pins'), { attributes: true, attributeFilter: ['class'] }, function () { renderFavs(); });
    watch($('apps'), { attributes: true, attributeFilter: ['class'] }, syncView);
    watch($('bellN'), { attributes: true, childList: true, characterData: true, subtree: true }, syncNeeds);
    document.addEventListener('click', onClick);
    document.addEventListener('dragstart', onDragStart);
    document.addEventListener('dragend', onDragEnd);
    nav.addEventListener('dragover', onDragOver);
    nav.addEventListener('dragleave', onDragLeave);
    nav.addEventListener('drop', onDrop);
    window.addEventListener('storage', onStorage);
    window.addEventListener('pageshow', onShow);
    document.addEventListener('visibilitychange', onShow);
  }
  function unmount() {
    if (!on) return;
    on = false;
    obs.forEach(function (o) { o.disconnect(); }); obs = [];
    document.removeEventListener('click', onClick);
    document.removeEventListener('dragstart', onDragStart);
    document.removeEventListener('dragend', onDragEnd);
    window.removeEventListener('storage', onStorage);
    window.removeEventListener('pageshow', onShow);
    document.removeEventListener('visibilitychange', onShow);
    [nav, bot, head, ban, frame, instTx].forEach(function (e) { if (e && e.parentNode) e.parentNode.removeChild(e); });
    nav = favBox = spBox = bot = head = ban = frame = instTx = null;
    [].forEach.call(document.querySelectorAll('.arc-on, .arc-swap'), function (e) { e.classList.remove('arc-on', 'arc-swap'); });
    var q = $('q'); if (q && qPh !== null) q.setAttribute('placeholder', qPh);
    var ps = $('pSearch'); if (ps) ps.removeAttribute('data-arc-label');
    root.removeAttribute('data-arc-space');
    dragId = null; cur = null; keys = {};
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
