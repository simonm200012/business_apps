/* Adrial Mail — shared helpers: escaping, formatting, seeded random, dates, dialogs, toast, CSV. */
(function () {
  'use strict';
  var AM = window.AM = window.AM || {};
  var U = AM.U = {};

  U.DAY = 864e5; U.HOUR = 36e5; U.MIN = 6e4;

  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  U.esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ESC[c]; }); };
  U.attr = U.esc;
  // Only allow plain hex colours in inline styles (prevents CSS injection through design JSON).
  U.color = function (c, fb) { return /^#[0-9a-f]{3,8}$/i.test(String(c || '')) ? c : (fb || '#000000'); };
  U.num = function (v, fb) { v = Number(v); return isFinite(v) ? v : (fb || 0); };
  U.clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };

  // ── Seeded random (mulberry32) ──────────────────────────────────────────
  U.rng = function (seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  U.hash = function (s) { s = String(s); var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  U.pick = function (r, a) { return a[Math.floor(r() * a.length)]; };
  U.int = function (r, a, b) { return a + Math.floor(r() * (b - a + 1)); };
  U.wpick = function (r, pairs) { // [[value, weight], ...]
    var t = 0, i; for (i = 0; i < pairs.length; i++) t += pairs[i][1];
    var x = r() * t; for (i = 0; i < pairs.length; i++) { x -= pairs[i][1]; if (x <= 0) return pairs[i][0]; }
    return pairs[pairs.length - 1][0];
  };
  U.uid = function (p) { return (p || '') + Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 7); };

  // ── Formatting ─────────────────────────────────────────────────────────
  var nf = new Intl.NumberFormat('en-GB');
  var mf = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  var mf2 = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  U.n = function (v) { return nf.format(Math.round(v || 0)); };
  U.money = function (v) { return mf.format(v || 0); };
  U.money2 = function (v) { return mf2.format(v || 0); };
  U.short = function (v) {
    v = v || 0; var a = Math.abs(v);
    if (a >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (a >= 1e4) return Math.round(v / 1e3) + 'k';
    if (a >= 1e3) return (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(Math.round(v));
  };
  U.moneyShort = function (v) { return '€' + U.short(v); };
  U.pct = function (v, d) { if (!isFinite(v)) v = 0; return (v * 100).toFixed(d == null ? 1 : d) + '%'; };
  U.rate = function (a, b, d) { return U.pct(b ? a / b : 0, d); };

  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  U.MON = MON;
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  U.p2 = p2;
  U.date = function (ts) { if (!ts) return '—'; var d = new Date(ts); return d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear(); };
  U.dateShort = function (ts) { var d = new Date(ts); return d.getDate() + ' ' + MON[d.getMonth()]; };
  U.time = function (ts) { var d = new Date(ts); return p2(d.getHours()) + ':' + p2(d.getMinutes()); };
  U.dateTime = function (ts) { return ts ? U.date(ts) + ', ' + U.time(ts) : '—'; };
  U.ymd = function (ts) { var d = new Date(ts); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); };
  U.ym = function (ts) { var d = new Date(ts); return d.getFullYear() + '-' + p2(d.getMonth() + 1); };
  U.ymLabel = function (ym) { var a = ym.split('-'); return MON[+a[1] - 1] + ' ' + a[0].slice(2); };
  U.parseYmd = function (s) { var m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : null; };
  U.dayStart = function (ts) { var d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
  U.monthStart = function (ts) { var d = new Date(ts); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); };
  U.addMonths = function (ts, n) { var d = new Date(ts); return new Date(d.getFullYear(), d.getMonth() + n, 1).getTime(); };
  U.localInput = function (ts) { var d = new Date(ts); return U.ymd(ts) + 'T' + p2(d.getHours()) + ':' + p2(d.getMinutes()); };
  U.ago = function (ts, now) {
    var s = Math.round(((now || Date.now()) - ts) / 1000), fut = s < 0; s = Math.abs(s);
    var t = s < 60 ? 'just now' : s < 3600 ? Math.round(s / 60) + ' min' : s < 86400 ? Math.round(s / 3600) + ' h' : s < 86400 * 45 ? Math.round(s / 86400) + ' d' : Math.round(s / 86400 / 30.4) + ' mo';
    if (t === 'just now') return t;
    return fut ? 'in ' + t : t + ' ago';
  };
  U.dur = function (amount, unit) { return amount + ' ' + (amount === 1 ? unit.replace(/s$/, '') : unit); };
  U.plural = function (n, one, many) { return U.n(n) + ' ' + (n === 1 ? one : (many || one + 's')); };
  U.initials = function (a, b) { return ((a || '?').charAt(0) + (b || '').charAt(0)).toUpperCase(); };
  U.deaccent = function (s) { return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D'); };
  U.clone = function (o) { return JSON.parse(JSON.stringify(o)); };
  U.debounce = function (fn, ms) { var t; return function () { var a = arguments, s = this; clearTimeout(t); t = setTimeout(function () { fn.apply(s, a); }, ms); }; };
  U.matchQ = function (q, text) {
    if (!q) return true; text = U.deaccent(String(text).toLowerCase());
    return U.deaccent(q.toLowerCase()).split(/\s+/).every(function (w) { return !w || text.indexOf(w) >= 0; });
  };

  // ── DOM ────────────────────────────────────────────────────────────────
  U.$ = function (sel, root) { return (root || document).querySelector(sel); };
  U.$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  U.ic = function (path, cls) { return '<svg class="ic' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true">' + path + '</svg>'; };
  U.I = {
    plus: '<path d="M12 5v14M5 12h14"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>', up: '<path d="M12 19V5M6 11l6-6 6 6"/>', down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/>', trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>', back: '<path d="M15 6l-6 6 6 6"/>', send: '<path d="M4 12l16-8-6 16-3-7z"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>', sms: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 10h8"/>',
    clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>', split: '<path d="M12 4v6M12 10l-6 6v4M12 10l6 6v4"/>', zap: '<path d="M13 3L5 13h6l-1 8 8-10h-6z"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>', hook: '<path d="M8 16a4 4 0 1 1 4-4v3a3 3 0 0 0 6 0"/>', filter: '<path d="M4 5h16l-6 8v6l-4-2v-4z"/>',
    drag: '<circle cx="9" cy="6" r="1.2"/><circle cx="15" cy="6" r="1.2"/><circle cx="9" cy="12" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="9" cy="18" r="1.2"/><circle cx="15" cy="18" r="1.2"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>', download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
    play: '<path d="M7 4l13 8-13 8z"/>', search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>', reset: '<path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4"/>',
    check: '<path d="M5 12l5 5 9-10"/>', more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
    undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>', redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>',
    zoomin: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5M8 11h6M11 8v6"/>', zoomout: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5M8 11h6"/>',
    flag: '<path d="M5 21V4h11l-2 4 2 4H5"/>', ab: '<path d="M4 18l4-12 4 12M5.5 14h5M14 6h4a3 3 0 0 1 0 6h-4zM14 12h5a3 3 0 0 1 0 6h-5z"/>'
  };

  // ── Toast ──────────────────────────────────────────────────────────────
  U.toast = function (msg) {
    var t = document.getElementById('toast'); if (!t) return;
    t.textContent = msg; t.classList.add('on');
    clearTimeout(U.toast.t); U.toast.t = setTimeout(function () { t.classList.remove('on'); }, 3400);
  };

  // ── Layers (modal / drawer / menu) with Esc + focus trap ───────────────
  var stack = [];
  function focusables(el) {
    return U.$$('a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"]),iframe', el)
      .filter(function (x) { return x.offsetParent !== null || x === document.activeElement; });
  }
  U.layerOpen = function () { return stack.length > 0; };
  U.open = function (html, opts) {
    opts = opts || {};
    var host = document.createElement('div');
    host.className = 'layer';
    host.innerHTML = html;
    document.body.appendChild(host);
    var rec = { host: host, prev: document.activeElement, onClose: opts.onClose };
    stack.push(rec);
    host.addEventListener('click', function (e) {
      if (e.target.closest('[data-close]')) { e.preventDefault(); U.close(host); }
    });
    var f = opts.focus ? U.$(opts.focus, host) : null;
    setTimeout(function () { (f || focusables(host.querySelector('[role="dialog"],[role="alertdialog"],[role="menu"]') || host)[0] || host).focus(); }, 0);
    return host;
  };
  U.close = function (host) {
    var i = host ? stack.findIndex(function (r) { return r.host === host; }) : stack.length - 1;
    if (i < 0) return;
    var rec = stack.splice(i, 1)[0];
    rec.host.remove();
    if (rec.onClose) try { rec.onClose(); } catch (e) { console.error(e); }
    if (rec.prev && rec.prev.focus && document.contains(rec.prev)) rec.prev.focus();
  };
  U.closeAll = function () { while (stack.length) U.close(); };
  document.addEventListener('keydown', function (e) {
    if (!stack.length) return;
    var top = stack[stack.length - 1].host;
    if (e.key === 'Escape') { e.preventDefault(); U.close(top); return; }
    if (e.key === 'Tab') {
      var f = focusables(top); if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      else if (!top.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    }
  });
  var MID = 0;
  U.modal = function (o) {
    var id = 'md' + (++MID);
    return U.open('<div class="scrim" data-close></div><div class="modal' + (o.wide ? ' wide' : '') + '" role="dialog" aria-modal="true" aria-labelledby="' + id + '">' +
      '<div class="md-head"><div><h2 id="' + id + '">' + U.esc(o.title) + '</h2>' + (o.sub ? '<p class="hint" style="margin:4px 0 0">' + o.sub + '</p>' : '') + '</div><button type="button" class="btn icon ghost" data-close aria-label="Close">' + U.ic(U.I.x) + '</button></div>' +
      '<div class="md-body">' + o.body + '</div>' + (o.foot ? '<div class="md-foot">' + o.foot + '</div>' : '') + '</div>', o);
  };
  U.drawer = function (o) {
    var id = 'dr' + (++MID);
    return U.open('<div class="scrim" data-close></div><aside class="drawer' + (o.wide ? ' wide' : '') + '" role="dialog" aria-modal="true" aria-labelledby="' + id + '">' +
      '<div class="dr-head"><div>' + (o.eyebrow ? '<span class="label">' + U.esc(o.eyebrow) + '</span>' : '') + '<h2 id="' + id + '">' + U.esc(o.title) + '</h2></div><button type="button" class="btn icon ghost" data-close aria-label="Close">' + U.ic(U.I.x) + '</button></div>' +
      '<div class="dr-body">' + o.body + '</div>' + (o.foot ? '<div class="md-foot">' + o.foot + '</div>' : '') + '</aside>', o);
  };
  U.confirm = function (o) {
    return new Promise(function (resolve) {
      var done = false;
      var host = U.open('<div class="scrim" data-close></div><div class="modal" role="alertdialog" aria-modal="true" aria-labelledby="cfT" aria-describedby="cfB">' +
        '<div class="md-head"><h2 id="cfT">' + U.esc(o.title) + '</h2></div><div class="md-body"><p id="cfB" style="margin:0;color:var(--ink2)">' + (o.html || U.esc(o.text || '')) + '</p></div>' +
        '<div class="md-foot"><button type="button" class="btn" data-close>Cancel</button><button type="button" class="btn ' + (o.danger ? 'danger' : 'pri') + '" data-ok>' + U.esc(o.ok || 'OK') + '</button></div></div>',
        { focus: '[data-ok]', onClose: function () { if (!done) resolve(false); } });
      host.querySelector('[data-ok]').addEventListener('click', function () { done = true; U.close(host); resolve(true); });
    });
  };
  // Popover menu: items [{label, act, icon, disabled, danger}] → calls onPick(act)
  U.menu = function (anchor, items, onPick, label) {
    var r = anchor.getBoundingClientRect();
    var html = '<div class="scrim clear" data-close></div><div class="pop" role="menu" aria-label="' + U.esc(label || 'Menu') + '">' +
      items.map(function (it, i) {
        if (it.sep) return '<div class="pop-sep" role="separator"></div>';
        if (it.head) return '<div class="pop-head">' + U.esc(it.head) + '</div>';
        return '<button type="button" role="menuitem" data-i="' + i + '"' + (it.disabled ? ' disabled' : '') + (it.danger ? ' class="danger"' : '') + '>' + (it.icon ? U.ic(it.icon) : '') + '<span>' + U.esc(it.label) + '</span>' + (it.hint ? '<small>' + U.esc(it.hint) + '</small>' : '') + '</button>';
      }).join('') + '</div>';
    var host = U.open(html);
    var pop = host.querySelector('.pop');
    var w = pop.offsetWidth, h = pop.offsetHeight;
    var left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
    var top = r.bottom + 6; if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
    pop.style.left = left + 'px'; pop.style.top = top + 'px';
    pop.addEventListener('click', function (e) {
      var b = e.target.closest('[data-i]'); if (!b) return;
      U.close(host); onPick(items[+b.dataset.i].act, items[+b.dataset.i]);
    });
    pop.addEventListener('keydown', function (e) {
      var bs = U.$$('button:not([disabled])', pop), i = bs.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); bs[(i + 1) % bs.length].focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); bs[(i - 1 + bs.length) % bs.length].focus(); }
    });
    return host;
  };

  // ── CSV / download (local file generated in the browser, no network) ────
  U.csv = function (rows) {
    return rows.map(function (r) {
      return r.map(function (v) { v = v == null ? '' : String(v); return /[",\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(',');
    }).join('\r\n');
  };
  U.download = function (name, text, mime) {
    var blob = new Blob(['﻿' + text], { type: (mime || 'text/csv') + ';charset=utf-8' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  };

  // ── UI prefs (small; the only localStorage key this app uses) ──────────
  var UIKEY = 'adrial-mail-ui', ui = {};
  try { ui = JSON.parse(localStorage.getItem(UIKEY) || '{}') || {}; } catch (e) { ui = {}; }
  U.pref = function (k, v) {
    if (arguments.length < 2) return ui[k];
    ui[k] = v; try { localStorage.setItem(UIKEY, JSON.stringify(ui)); } catch (e) {}
    return v;
  };

  // SMS segment calculation (GSM-7 vs UCS-2)
  var GSM = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
  var GSMX = '^{}\\[~]|€\f';
  U.smsInfo = function (text) {
    text = String(text || ''); var gsm = true, len = 0;
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (GSM.indexOf(ch) >= 0) len += 1; else if (GSMX.indexOf(ch) >= 0) len += 2; else { gsm = false; break; }
    }
    if (!gsm) len = text.length;
    var single = gsm ? 160 : 70, multi = gsm ? 153 : 67;
    var segs = len === 0 ? 0 : len <= single ? 1 : Math.ceil(len / multi);
    var bad = gsm ? [] : Array.from(new Set(text.split('').filter(function (c) { return GSM.indexOf(c) < 0 && GSMX.indexOf(c) < 0; }))).slice(0, 8);
    return { encoding: gsm ? 'GSM-7' : 'UCS-2 (Unicode)', chars: len, segments: segs, perSeg: segs > 1 ? multi : single, left: (segs <= 1 ? single : segs * multi) - len, nonGsm: bad };
  };
})();
