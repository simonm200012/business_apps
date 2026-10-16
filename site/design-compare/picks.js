/* Pick your look: the looks on offer, and a client's picks as a short link and as text.
 * Used by index.html (window.PickLooks) and tools/tests/design-compare-picks.test.js (require).
 * Picks: { by: 'Ana, Primer d.o.o.', note: '…', fav: { app: id|null, home: id|null }, like: [ids] }.
 * Link: ?by=…&fa=<app look>&fh=<home look>&l=<liked ids joined with .>&n=<note>  (unknown ids are dropped)
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.PickLooks = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // kind 'app': the look of a whole app (shown in one of the demo apps); kind 'home': a style of the launcher page.
  // shot: design-compare/shots/<id>-desk-light.webp, -desk-dark.webp, -phone.webp (shots/make-shots.mjs)
  var LOOKS = [
    { id: 'pipedrive', kind: 'app', name: 'Pipedrive', app: 'CRM', href: '/crm/', traits: ['Green actions', 'Pipeline boards', 'Compact tables'] },
    { id: 'upflow', kind: 'app', name: 'Upflow', app: 'Collections', href: '/collections/', traits: ['Navy sidebar', 'Calm white cards', 'Who to call first'] },
    { id: 'agicap', kind: 'app', name: 'Agicap', app: 'Cash forecast', href: '/cashflow/', traits: ['Big charts', 'Warnings up front', 'Scenario tabs'] },
    { id: 'pigment', kind: 'app', name: 'Pigment', app: 'Budget vs actual', href: '/budget/', traits: ['Planning grids', 'Blue bars', 'Dense numbers'] },
    { id: 'shopify', kind: 'app', name: 'Shopify', app: 'ERP', href: '/erp/', traits: ['Grey canvas', 'White cards', 'Clear status pills'] },
    { id: 'jobber', kind: 'app', name: 'Jobber', app: 'Service jobs', href: '/service/#/board', traits: ['Dark green sidebar', 'Schedule board', 'Field-team friendly'] },
    { id: 'timetastic', kind: 'app', name: 'Timetastic', app: 'Time & leave', href: '/leave/', traits: ['Bold colour band', 'Friendly cards', 'Big numbers'] },
    { id: 'ironclad', kind: 'app', name: 'Ironclad', app: 'Contracts & renewals', href: '/contracts/', traits: ['Serif headlines', 'Colour tiles', 'Editorial calm'] },
    { id: 'asana', kind: 'app', name: 'Asana', app: 'Team Tasks', href: '/team-tasks/', traits: ['Dark sidebar', 'Coral accents', 'Lists and boards'] },
    { id: 'lightspeed', kind: 'app', name: 'Lightspeed', app: 'Store daily board', href: '/stores/', traits: ['Shop-floor tiles', 'Red accents', 'Per-store view'] },
    { id: 'meta', kind: 'app', name: 'Meta Ads Manager', app: 'Ads & Return', href: '/ads/', traits: ['Blue', 'Reporting tables', 'Date presets'] },
    { id: 'gx', kind: 'app', name: 'Great Expectations', app: 'Data health check', href: '/datacheck/', traits: ['Orange', 'Upload first', 'Plain checks'] },
    { id: 'm365', kind: 'home', name: 'Microsoft 365', app: 'Home page', href: '/?look=m365', traits: ['Familiar Office feel', 'Pinned apps', 'Quick access table'] },
    { id: 'appstore', kind: 'home', name: 'App Store', app: 'Home page', href: '/?look=appstore', traits: ['Story cards', 'Open pills', 'Sidebar on a computer'] },
    { id: 'raycast', kind: 'home', name: 'Raycast', app: 'Home page', href: '/?look=raycast', traits: ['Dark command window', 'Keyboard first', 'Detail pane'] },
    { id: 'arc', kind: 'home', name: 'Arc', app: 'Home page', href: '/?look=arc', traits: ['Gradient spaces', 'Favourites sidebar', 'Playful'] },
    { id: 'odoo', kind: 'home', name: 'Odoo', app: 'Home page', href: '/?look=odoo', traits: ['Grid of app icons', 'Menu search', 'ERP feel'] },
    { id: 'classic', kind: 'home', name: 'Classic', app: 'Home page', href: '/?look=classic', traits: ['Clean website look', 'Big headline', 'Monospace details'] }
  ];
  var BY = {}; LOOKS.forEach(function (l) { BY[l.id] = l; });
  function kindOf(id) { return BY[id] ? BY[id].kind : null; }

  function empty() { return { by: '', note: '', fav: { app: null, home: null }, like: [] }; }
  /** Picks from anything (saved data, a link): unknown looks dropped, a favourite of the wrong kind dropped, text capped. */
  function clean(o) {
    var p = empty();
    if (!o || typeof o !== 'object') return p;
    p.by = typeof o.by === 'string' ? o.by.trim().slice(0, 80) : '';
    p.note = typeof o.note === 'string' ? o.note.trim().slice(0, 400) : '';
    var f = o.fav && typeof o.fav === 'object' ? o.fav : {};
    p.fav.app = kindOf(f.app) === 'app' ? f.app : null;
    p.fav.home = kindOf(f.home) === 'home' ? f.home : null;
    p.like = Array.isArray(o.like) ? o.like.filter(function (id, i, a) { return BY[id] && a.indexOf(id) === i; }) : [];
    return p;
  }
  function isEmpty(p) { return !p.fav.app && !p.fav.home && !p.like.length; }
  /** The query string for a link ('' when nothing is picked). */
  function encode(p) {
    p = clean(p);
    var q = [];
    if (p.by) q.push('by=' + encodeURIComponent(p.by));
    if (p.fav.app) q.push('fa=' + p.fav.app);
    if (p.fav.home) q.push('fh=' + p.fav.home);
    // liked ids in the order of the catalogue, so the same picks always give the same link
    var liked = LOOKS.filter(function (l) { return p.like.indexOf(l.id) >= 0; }).map(function (l) { return l.id; });
    if (liked.length) q.push('l=' + liked.join('.'));
    if (p.note) q.push('n=' + encodeURIComponent(p.note));
    return q.length ? '?' + q.join('&') : '';
  }
  /** Picks from a query string, or null when it carries none. */
  function decode(search) {
    var s = String(search || '').replace(/^\?/, ''), o = {};
    s.split('&').forEach(function (kv) {
      if (!kv) return;
      var i = kv.indexOf('='), k = i < 0 ? kv : kv.slice(0, i), v = i < 0 ? '' : kv.slice(i + 1);
      try { o[k] = decodeURIComponent(v.replace(/\+/g, ' ')); } catch (e) { o[k] = ''; }
    });
    if (!o.fa && !o.fh && !o.l) return null;
    var p = clean({ by: o.by, note: o.n, fav: { app: o.fa, home: o.fh }, like: (o.l || '').split('.') });
    return isEmpty(p) ? null : p;
  }
  function label(id) { var l = BY[id]; return l ? (l.kind === 'home' ? l.name + ' (home page)' : l.name + ' look (as in ' + l.app + ')') : id; }
  /** Plain text to paste into an e-mail or a chat. */
  function summary(p, link) {
    p = clean(p);
    var lines = ['Pick your look' + (p.by ? ': ' + p.by : '')];
    lines.push('Favourite app style: ' + (p.fav.app ? label(p.fav.app) : 'not chosen'));
    lines.push('Favourite home page: ' + (p.fav.home ? label(p.fav.home) : 'not chosen'));
    var liked = LOOKS.filter(function (l) { return p.like.indexOf(l.id) >= 0; });
    if (liked.length) lines.push('Also liked: ' + liked.map(function (l) { return l.kind === 'home' ? l.name + ' (home page)' : l.name; }).join(', '));
    if (p.note) lines.push('Notes: ' + p.note);
    if (link) lines.push('', 'See the picks: ' + link);
    return lines.join('\n');
  }
  return { LOOKS: LOOKS, BY: BY, empty: empty, clean: clean, isEmpty: isEmpty, encode: encode, decode: decode, summary: summary };
});
