/* The page a prospect sees for a branded demo. ONE renderer for the public page (/d/<slug>, public/assets/demo-page.js) and for
   the live preview in Studio > Branded demo (site/demo-builder/), so the preview is exactly what the prospect gets.
   Needs _shared/demo-catalog.js, demo-strings.js, app-sheets.js and app-sheet-panel.js (for the sales sheet), and demo-view.css.
   DemoRender.mount(host, cfg, { logoUrl, preview, theme }) → { set(cfg, moreOptions), theme(mode), el }.
   cfg = what GET /api/demo/<slug> returns: { name, lang, accent, accent2, apps, news: { title, text, date } | null, booking, expires, logo }.
   Colours are set as CSS variables with element.style (allowed by the strict Content-Security-Policy of the public page; no
   inline style attributes are written). The accent is darkened until white text on it has a contrast of at least 4.5:1. */
(function (root) {
  'use strict';
  var CAT = root.DEMO_CATALOG || (typeof require === 'function' ? require('./demo-catalog.js') : null);
  var STR = root.DEMO_STRINGS || (typeof require === 'function' ? require('./demo-strings.js') : {});

  // ── colours ──────────────────────────────────────────────────────────────────────────────────────────────
  function hex2rgb(h) { var m = /^#([0-9a-f]{6})$/i.exec(h || ''); if (!m) return null; var n = parseInt(m[1], 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function rgb2hex(c) { return '#' + c.map(function (v) { return ('0' + Math.round(Math.max(0, Math.min(255, v))).toString(16)).slice(-2); }).join(''); }
  function lum(c) { var l = c.map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]; }
  /** WCAG contrast ratio of two #rrggbb colours (1 to 21). */
  function contrast(a, b) { var x = lum(hex2rgb(a)), y = lum(hex2rgb(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  /** a moved the share t of the way to b. */
  function mix(a, b, t) { var x = hex2rgb(a), y = hex2rgb(b); return rgb2hex([0, 1, 2].map(function (i) { return x[i] + (y[i] - x[i]) * t; })); }
  function moveUntil(hex, toward, bg, min) { var c = hex, i = 0; while (contrast(c, bg) < min && i < 40) { c = mix(c, toward, 0.07); i++; } return c; }
  /** the colour darkened (towards black) until its contrast with bg is at least min */
  function darkenTo(hex, bg, min) { return moveUntil(hex, '#000000', bg, min || 4.5); }
  /** the colour lightened (towards white) until its contrast with bg is at least min */
  function lightenTo(hex, bg, min) { return moveUntil(hex, '#ffffff', bg, min || 4.5); }
  var HEX = /^#[0-9a-f]{6}$/i;
  /** the CSS variables of a demo: --c (buttons, white text on it ≥ 4.5:1), --c2 (bars), --cink / --ct (text and tint, light),
   *  --cinkd / --ctd (the same for dark mode) */
  function palette(accent, accent2) {
    var a = HEX.test(accent) ? accent.toLowerCase() : '#0f6cbd', b = HEX.test(accent2) ? accent2.toLowerCase() : a;
    var tint = mix(a, '#ffffff', 0.88), tintD = mix(a, '#292929', 0.8);
    return { '--c': darkenTo(a, '#ffffff', 4.5), '--c2': b, '--ct': tint, '--cink': darkenTo(a, tint, 4.5), '--ctd': tintD, '--cinkd': lightenTo(a, tintD, 4.5) };
  }

  // ── text ─────────────────────────────────────────────────────────────────────────────────────────────────
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function tx(lang) { return STR[lang] || STR.en; }
  function fill(t, v) { return String(t).replace(/\{(\w+)\}/g, function (m, k) { return v[k] == null ? m : v[k]; }); }
  function fmtDate(iso, lang, short) {
    var d = new Date(String(iso || '').slice(0, 10) + 'T12:00:00Z');
    if (isNaN(d)) return '';
    try { return d.toLocaleDateString(tx(lang).locale, short ? { day: 'numeric', month: 'short', timeZone: 'UTC' } : { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); }
    catch (e) { return String(iso).slice(0, 10); }
  }
  function initials(name) {
    var w = String(name || '').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
    return (w.length > 1 ? w[0][0] + w[1][0] : (w[0] || '?').slice(0, 2)).toUpperCase();
  }
  function appList(cfg) {
    var ok = {}; CAT.offered().forEach(function (a) { ok[a.id] = a; });
    return (cfg.apps || []).filter(function (id) { return ok[id]; }).map(function (id) { return ok[id]; });
  }

  // ── markup ───────────────────────────────────────────────────────────────────────────────────────────────
  function bookBtn(cfg, t, cls) {
    return /^https:\/\//i.test(cfg.booking || '') ? '<a class="dv-btn ' + cls + '" href="' + esc(cfg.booking) + '" target="_blank" rel="noopener noreferrer">' + esc(t.book) + '</a>' : '';
  }
  function sheet(cfg, id, t) {
    var SP = root.AppSheetPanel, SH = root.APP_SHEETS || {};
    if (!SP || !SH[id]) return '';
    var copy = CAT.COPIES.indexOf(id) >= 0;
    return SP.sheetHtml({ id: id, name: CAT.name(id), href: '/' + id + '/', icon: '/icons/apps/' + id + '.png', sheet: SH[id] },
      { headingId: 'dvSheetH', open: copy ? '/' + id + '/?lang=' + cfg.lang : false, openLabel: t.openDemo, playLabel: t.play, pin: false, extra: bookBtn(cfg, t, 'o') });
  }
  function view(cfg, app, o) {
    var t = tx(cfg.lang), list = appList(cfg), n = cfg.news;
    var logo = cfg.logo && o.logoUrl ? '<img class="dv-logo" src="' + esc(o.logoUrl) + '" alt="' + esc(fill(t.logo, { name: cfg.name })) + '" width="32" height="32">' : '<span class="dv-mk" aria-hidden="true">' + esc(initials(cfg.name)) + '</span>';
    return '<header class="dv-top">' + logo + '<span class="dv-nm">' + esc(cfg.name) + '</span><span class="dv-sp"></span>' + bookBtn(cfg, t, 'o dv-topbook') + '</header><div class="dv-bar"></div>' +
      '<main class="dv-mi"><h1>' + esc(fill(t.welcome, { name: cfg.name })) + '</h1><p class="dv-sub">' + esc(t.sub) + '</p>' +
      (n && n.title ? '<article class="dv-news"><small>' + esc(t.news) + (n.date ? ' · ' + esc(fmtDate(n.date, cfg.lang, true)) : '') + '</small><h2>' + esc(n.title) + '</h2>' + (n.text ? '<p>' + esc(n.text) + '</p>' : '') + '</article>' : '') +
      (list.length ? '<h2 class="dv-h">' + esc(t.apps) + '</h2><p class="dv-hint">' + esc(t.hint) + '</p><div class="dv-tiles" role="group" aria-label="' + esc(t.apps) + '">' +
        list.map(function (a) { return '<button type="button" class="dv-t' + (a.id === app ? ' on' : '') + '" data-dv-app="' + esc(a.id) + '" aria-pressed="' + (a.id === app) + '"><img src="/icons/apps/' + esc(a.id) + '.png" alt="" width="40" height="40">' + esc(a.name) + '</button>'; }).join('') +
        '</div><section class="dv-sheet" id="dvSheet" aria-labelledby="dvSheetH">' + (app ? sheet(cfg, app, t) : '') + '</section>' : '') +
      '<footer class="dv-foot"><span>' + esc(fill(t.prepared, { name: cfg.name })) + '</span>' + (cfg.expires ? '<span>' + esc(fill(t.valid, { date: fmtDate(cfg.expires, cfg.lang) })) + '</span>' : '') + '</footer></main>';
  }

  /** Shows the demo in host. o.preview: links do not leave the page (live preview in the editor). o.theme: 'light' | 'dark' | '' (follow the system). */
  function mount(host, cfg, o) {
    o = o || {};
    var el = host.ownerDocument.createElement('div'), app = '';
    el.className = 'dv';
    host.appendChild(el);
    function pick() { var l = appList(cfg); if (!l.some(function (a) { return a.id === app; })) app = l.length ? l[0].id : ''; }
    function paint() {
      pick();
      var p = palette(cfg.accent, cfg.accent2);
      Object.keys(p).forEach(function (k) { el.style.setProperty(k, p[k]); });
      if (o.theme) el.setAttribute('data-theme', o.theme); else el.removeAttribute('data-theme');
      el.setAttribute('lang', cfg.lang || 'en');
      el.innerHTML = view(cfg, app, o);
    }
    el.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-dv-app]');
      if (b) {
        app = b.getAttribute('data-dv-app');
        [].forEach.call(el.querySelectorAll('.dv-t'), function (x) { var on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); });
        el.querySelector('#dvSheet').innerHTML = sheet(cfg, app, tx(cfg.lang));
        return;
      }
      if (o.preview && e.target.closest && e.target.closest('a')) e.preventDefault();
    });
    paint();
    return { el: el, set: function (c, more) { cfg = c; if (more) Object.keys(more).forEach(function (k) { o[k] = more[k]; }); paint(); }, theme: function (th) { o.theme = th; if (th) el.setAttribute('data-theme', th); else el.removeAttribute('data-theme'); } };
  }

  var api = { mount: mount, palette: palette, contrast: contrast, darkenTo: darkenTo, lightenTo: lightenTo, mix: mix, initials: initials, fmtDate: fmtDate, appList: appList };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.DemoRender = api;
})(typeof window !== 'undefined' ? window : this);
