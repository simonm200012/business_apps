/* Business Apps shell: a "← Business Apps" button and a Light / Dark / System switch on every app.
 *
 * Include it in <head> (not deferred) so the theme is applied before the page paints:
 *   <script src="/_shared/stratum-shell.js" data-pos="bl"></script>
 * Options (data-*): pos = bl | br | tl | tr (corner), y = distance from the top/bottom edge in px,
 *   x = distance from the side in px, home = "1" on the start page (no back button),
 *   reload = "1" for apps that read the theme only at start-up.
 *
 * The choice is stored in localStorage "stratum-theme" (absent = follow the system), shared by all
 * apps on this site. <html> gets data-theme="light|dark" only for an explicit choice (apps that
 * follow prefers-color-scheme keep doing so) and always data-stratum-mode="light|dark" (resolved).
 *
 * The bar keeps out of the way of the app (see "Keeping out of the way" below):
 *  - it fades out (and cannot be clicked or focused) while a dialog, drawer, sheet or menu scrim is open;
 *  - it moves up above a bar fixed to the bottom of the screen (selection bars, action bars) instead of covering it;
 *  - on phones it also fades out while you type (an input has focus or the on-screen keyboard is up), shrinks to a
 *    small round back button while you scroll down, comes back in full when you scroll up, and fades out at the end
 *    of a list when it would cover the last row.
 * Apps can still place it with their own `stratum-shell{bottom:…!important}` rules (above a tab bar): the bar only
 * adds a transform on top of that. StratumShell.demo(true) shows a small DEMO chip inside the bar (demo-api.js). */
/* One-time move of what this browser saved under the suite's former name (localStorage keys and IndexedDB databases
 * with that prefix) to the "stratum-" names. Runs before any app opens its data: an app's indexedDB.open waits until its
 * database has been copied across (same version, stores, indexes and records) and the old one deleted. Once nothing is
 * left to move, "stratum-moved" is set and this does nothing. Remove after 2026-12-31, when every device has run it. */
(function () {
  'use strict';
  var OLD = String.fromCharCode(97, 100, 114, 105, 97, 108), NEW = 'stratum', DONE = 'stratum-moved';
  try {
    var ls = window.localStorage, keys = [];
    if (ls.getItem(DONE)) return;
    for (var i = 0; i < ls.length; i++) { var k = ls.key(i); if (k && k.indexOf(OLD) === 0) keys.push(k); }
    keys.forEach(function (k) {
      var n = NEW + k.slice(OLD.length);
      if (ls.getItem(n) === null) ls.setItem(n, ls.getItem(k));
      ls.removeItem(k);
    });
  } catch (e) { return; }
  var idb = window.indexedDB;
  if (!idb || !idb.databases) { try { ls.setItem(DONE, '1'); } catch (e) {} return; }
  var realOpen = idb.open.bind(idb), moves = {};
  var listed = idb.databases().then(function (l) { return l.map(function (d) { return d.name; }); }, function () { return []; });
  listed.then(function (names) {
    if (!names.some(function (n) { return n && n.indexOf(OLD) === 0; })) { try { ls.setItem(DONE, '1'); } catch (e) {} }
  });

  function done(r) {
    return new Promise(function (ok, no) { r.onsuccess = function () { ok(r.result); }; r.onerror = function () { no(r.error); }; });
  }
  function copy(from, to) {
    return done(realOpen(from)).then(function (src) {
      var stores = [].slice.call(src.objectStoreNames), version = src.version, dump = {};
      if (!stores.length) { src.close(); return; }
      var t = src.transaction(stores, 'readonly');
      return Promise.all(stores.map(function (name) {
        var os = t.objectStore(name);
        var meta = { keyPath: os.keyPath, autoIncrement: os.autoIncrement, indexes: [].slice.call(os.indexNames).map(function (n) {
          var ix = os.index(n); return { name: n, keyPath: ix.keyPath, unique: ix.unique, multiEntry: ix.multiEntry };
        }) };
        return Promise.all([done(os.getAll()), done(os.getAllKeys())]).then(function (r) { dump[name] = { meta: meta, values: r[0], keys: r[1] }; });
      })).then(function () {
        src.close();
        return new Promise(function (ok, no) {
          var r = realOpen(to, version);
          r.onupgradeneeded = function () {
            var db = r.result;
            stores.forEach(function (name) {
              var m = dump[name].meta;
              var os = db.createObjectStore(name, m.keyPath === null ? { autoIncrement: m.autoIncrement } : { keyPath: m.keyPath, autoIncrement: m.autoIncrement });
              m.indexes.forEach(function (ix) { os.createIndex(ix.name, ix.keyPath, { unique: ix.unique, multiEntry: ix.multiEntry }); });
            });
            stores.forEach(function (name) {
              var d = dump[name], os = r.transaction.objectStore(name);
              d.values.forEach(function (v, i) { if (d.meta.keyPath === null) os.put(v, d.keys[i]); else os.put(v); });
            });
          };
          r.onsuccess = function () { r.result.close(); ok(); };
          r.onerror = function () { no(r.error); };
        });
      });
    });
  }
  function move(name) {
    if (!moves[name]) moves[name] = listed.then(function (names) {
      var from = OLD + name.slice(NEW.length);
      if (names.indexOf(from) < 0 || names.indexOf(name) >= 0) return;
      return copy(from, name).then(function () { idb.deleteDatabase(from); });
    }).catch(function (e) { if (window.console) console.warn('Business Apps: could not move saved data for ' + name, e); });
    return moves[name];
  }
  // a stand-in for the IDBOpenDBRequest that opens the real database once the move is done and passes its events on
  function later(wait, open) {
    var fake = { result: undefined, error: null, readyState: 'pending', transaction: null, source: null,
      onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null }, on = {};
    fake.addEventListener = function (type, f) { (on[type] = on[type] || []).push(f); };
    fake.removeEventListener = function (type, f) { on[type] = (on[type] || []).filter(function (g) { return g !== f; }); };
    wait.then(function () {
      var r = open();
      ['upgradeneeded', 'success', 'error', 'blocked'].forEach(function (type) {
        r.addEventListener(type, function (e) {
          fake.readyState = r.readyState; fake.transaction = r.transaction;
          try { fake.result = r.result; } catch (x) {}
          try { fake.error = r.error; } catch (x) {}
          var ev = { type: type, target: fake, currentTarget: fake, oldVersion: e.oldVersion, newVersion: e.newVersion,
            preventDefault: function () { e.preventDefault(); }, stopPropagation: function () { e.stopPropagation(); } };
          if (typeof fake['on' + type] === 'function') fake['on' + type].call(fake, ev);
          (on[type] || []).slice().forEach(function (f) { f.call(fake, ev); });
        });
      });
    });
    return fake;
  }
  idb.open = function (name, version) {
    var open = function () { return version === undefined ? realOpen(name) : realOpen(name, version); };
    if (typeof name !== 'string' || name.indexOf(NEW) !== 0) return open();
    return later(move(name), open);
  };
})();
(function () {
  'use strict';
  if (window.StratumShell) return;

  var KEY = 'stratum-theme';
  var script = document.currentScript;
  var opt = (script && script.dataset) || {};
  var root = document.documentElement;
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  // Public site (public/, built by tools/build-public.mjs): <meta name="stratum-public" content="1"> before this script
  // drops the "← Business Apps" link (only the theme switch stays) and turns needs() into a no-op, so a demo copy never
  // links into the private apps or writes "Needs you today". Without the meta (the private site) nothing changes.
  var PUBLIC = (function () { try { var m = document.querySelector('meta[name="stratum-public"]'); return !!m && m.getAttribute('content') === '1'; } catch (e) { return false; } })();

  function read() {
    try { var t = localStorage.getItem(KEY); return t === 'light' || t === 'dark' ? t : 'system'; } catch (e) { return 'system'; }
  }
  function write(t) {
    try { if (t === 'system') localStorage.removeItem(KEY); else localStorage.setItem(KEY, t); } catch (e) {}
  }
  function resolve(t) { return t === 'system' ? (mq && mq.matches ? 'dark' : 'light') : t; }

  var host = null, btn = null, acctBtn = null, account = null;
  var LABEL = { system: 'Auto', light: 'Light', dark: 'Dark' };
  var ICON = {
    system: '<circle cx="12" cy="12" r="8"/><path d="M12 4v16" /><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none"/>',
    light: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    dark: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>'
  };
  var NEXT = { system: 'light', light: 'dark', dark: 'system' };

  function apply() {
    var t = read(), m = resolve(t);
    if (t === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', t);
    root.setAttribute('data-stratum-mode', m);
    if (host) host.setAttribute('data-mode', m);
    if (btn) {
      btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICON[t] + '</svg><span>' + LABEL[t] + '</span>';
      btn.setAttribute('aria-label', 'Theme: ' + LABEL[t] + '. Switch to ' + LABEL[NEXT[t]]);
      btn.title = 'Theme: ' + LABEL[t] + ' (click for ' + LABEL[NEXT[t]] + ')';
    }
    try { window.dispatchEvent(new CustomEvent('stratum-theme', { detail: { theme: t, mode: m } })); } catch (e) {}
  }

  function setTheme(t) {
    write(t);
    if (opt.reload === '1') { location.reload(); return; }
    apply();
  }

  function mount() {
    if (host || !document.body) return;
    host = document.createElement('stratum-shell');
    var corner = opt.pos || 'bl';
    var y = (opt.y || '14') + 'px', x = (opt.x || '14') + 'px';
    var pos = 'position:fixed;z-index:2147483000;' +
      (corner.charAt(0) === 't' ? 'top:' : 'bottom:') + 'calc(' + y + ' + env(safe-area-inset-' + (corner.charAt(0) === 't' ? 'top' : 'bottom') + ',0px));' +
      (corner.charAt(1) === 'r' ? 'right:' : 'left:') + x + ';';
    host.setAttribute('style', pos);
    var shadow = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    var home = opt.home === '1' || PUBLIC;
    shadow.innerHTML =
      '<style>' +
      ':host{--s:#FFFFFF;--i:#0C0C0D;--i2:#55544F;--ln:#E0DDD6;--fill:#EAE8E3;--sh:0 1px 2px rgba(12,12,13,.06),0 12px 32px -14px rgba(12,12,13,.32);all:initial}' +
      ':host([data-mode="dark"]){--s:#161618;--i:#F4F3EF;--i2:#BAB7AF;--ln:#2E2E33;--fill:#26262A;--sh:0 1px 2px rgba(0,0,0,.5),0 12px 32px -14px rgba(0,0,0,.8)}' +
      '.bar{display:flex;gap:2px;padding:3px;border-radius:999px;background:var(--s);border:1px solid var(--ln);box-shadow:var(--sh);font:500 13px/1 Geist,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--i);-webkit-font-smoothing:antialiased}' +
      'a,button{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;gap:7px;height:32px;padding:0 12px;border-radius:999px;cursor:pointer;color:var(--i);white-space:nowrap}' +
      'a{background:var(--i);color:var(--s);padding:0 14px 0 10px}' +
      'a:hover{opacity:.88}' +
      'button{color:var(--i2);padding:0 11px}' +
      '[hidden]{display:none!important}' +
      '.acct .av{display:inline-grid;place-items:center;width:20px;height:20px;border-radius:50%;background:#5B3FE0;color:#fff;font:600 10px/1 Geist,system-ui,sans-serif}' +
      '.acct .dot{width:7px;height:7px;border-radius:50%;background:var(--st,#8F8C85)}' +
      'button:hover{background:var(--fill);color:var(--i)}' +
      'a:focus-visible,button:focus-visible{outline:2px solid #7B66F0;outline-offset:2px}' +
      'svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;flex:none}' +
      '.demo{display:inline-flex;align-items:center;height:22px;align-self:center;margin:0 3px;padding:0 7px;border-radius:999px;background:#FFF7E0;color:#7A5200;border:1px solid #E9D28A;font:600 9.5px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em;cursor:default;white-space:nowrap}' +
      ':host([data-mode="dark"]) .demo{background:#3A2E12;color:#F2D58A;border-color:#5C4A1E}' +
      '.bar{transition:opacity .16s ease,visibility 0s linear 0s}' +
      ':host([data-away]){pointer-events:none}' +
      ':host([data-away]) .bar{opacity:0;visibility:hidden;transition:opacity .16s ease,visibility 0s linear .16s}' +
      ':host([data-compact]) .bar>:not(a){display:none!important}' +
      ':host([data-compact]) a{width:38px;height:38px;padding:0;justify-content:center}' +
      ':host([data-compact]) .lbl{display:none}' +
      '@media (max-width:520px){.lbl,button span{display:none}a,button{padding:0 10px}}' +
      '@media (prefers-reduced-motion:reduce){.bar,:host([data-away]) .bar{transition:none}}' +
      '@media print{.bar{display:none}}' +
      '</style>' +
      '<div class="bar" role="group" aria-label="' + (PUBLIC ? 'Display' : 'Business Apps') + '">' +
      (home ? '' : '<a href="/" title="Back to Business Apps"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg><span class="lbl">Business Apps</span></a>') +
      '<span class="demo" title="Made-up sample data. Nothing here is real." hidden>DEMO</span>' +
      '<button type="button" class="acct" hidden></button><button type="button" class="theme"></button></div>';
    btn = shadow.querySelector('button.theme');
    acctBtn = shadow.querySelector('button.acct');
    acctBtn.addEventListener('click', function () { if (account && account.onClick) account.onClick(); });
    renderAccount();
    var a = shadow.querySelector('a');
    if (a && home === false) a.setAttribute('aria-label', 'Back to Business Apps');
    btn.addEventListener('click', function () { setTheme(NEXT[read()]); });
    demoEl = shadow.querySelector('.demo');
    demoEl.hidden = !demoOn;
    barEl = shadow.querySelector('.bar');
    document.body.appendChild(host);
    apply();
    keepClear();
  }

  // ── Keeping out of the way ───────────────────────────────────────────────────────────────────────────────────────
  // Dialogs, drawers and sheets as the apps build them: <dialog open>, role="dialog"/"alertdialog", aria-modal, the
  // shared .modal/.drawer layers and their scrims (Collections, CRM, Recon, Parcels, Branch Manager, Contracts,
  // Service, Team Tasks, …), and the usual "open" class patterns. Only ones actually on screen count; a scrim only
  // when it covers most of the screen (a small one is a picture of a scrim, as in Design Comparison).
  var LAYERS = 'dialog[open],[role="dialog"],[role="alertdialog"],[aria-modal="true"],.modal,' +
    '.drawer.open,.drawer.on,.drawer.show,.drawer.is-open,.sheet.open,.sheet.on,.sheet.show,.sheet.is-open';
  var SCRIMS = '.scrim,.side-scrim,.layer-scrim,.s-scrim,.palette-scrim,.backdrop,.overlay';
  var TEXTY = /^(text|search|email|url|tel|password|number|date|datetime-local|month|week|time)$/;
  var phoneMq = window.matchMedia ? window.matchMedia('(max-width: 760px)') : null;
  var demoOn = false, demoEl = null, barEl = null, lift = 0, queued = false;
  var st = { compact: false, end: false, typing: false, kbd: false };
  function phone() { return !!(phoneMq && phoneMq.matches); }
  function onScreen(el, big) {
    if (!el || el === host || el.nodeType !== 1 || (window.SVGElement && el instanceof SVGElement)) return false;
    var r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.bottom <= 0 || r.right <= 0 || r.top >= innerHeight || r.left >= innerWidth) return false;
    if (big && (Math.min(r.right, innerWidth) - Math.max(r.left, 0)) * (Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)) < innerWidth * innerHeight * 0.5) return false;
    var cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') return false;
    for (var n = el; n && n.nodeType === 1; n = n.parentElement) if (parseFloat(getComputedStyle(n).opacity) < 0.05) return false;
    return true;
  }
  function layerOpen() {
    var list = document.querySelectorAll(LAYERS), i;
    for (i = 0; i < list.length; i++) if (onScreen(list[i])) return true;
    list = document.querySelectorAll(SCRIMS);
    for (i = 0; i < list.length; i++) if (onScreen(list[i], true)) return true;
    return false;
  }
  function typingIn(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.isContentEditable) return true;
    var t = el.tagName;
    return t === 'TEXTAREA' || t === 'SELECT' || (t === 'INPUT' && TEXTY.test((el.getAttribute('type') || 'text').toLowerCase()));
  }
  // the page elements under a few points of the bar (the bar itself left out); top = only the one you would tap
  function under(r, top) {
    var out = [], xs = [], ys = [], k, n = Math.max(2, Math.ceil((r.right - r.left - 2) / 12)), m = Math.max(2, Math.ceil((r.bottom - r.top - 2) / 9));
    for (k = 0; k <= n; k++) xs.push(r.left + 1 + (r.right - r.left - 2) * k / n);
    for (k = 0; k <= m; k++) ys.push(r.top + 1 + (r.bottom - r.top - 2) * k / m);
    // the bar lets hit-testing through for a moment (elementFromPoint is much cheaper than elementsFromPoint)
    var pe = host.style.pointerEvents;
    host.style.pointerEvents = 'none';
    xs.forEach(function (x) { ys.forEach(function (y) {
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return;
      var l = top ? [document.elementFromPoint(x, y)] : document.elementsFromPoint ? document.elementsFromPoint(x, y) : [document.elementFromPoint(x, y)];
      for (var i = 0; i < l.length; i++) {
        var e = l[i];
        if (!e || e === host) continue;
        if (e !== document.documentElement && e !== document.body && out.indexOf(e) < 0) out.push(e);
        if (top) break;
      }
    }); });
    host.style.pointerEvents = pe;
    return out;
  }
  // a bar fixed (or stuck) to the bottom of the screen under the shell bar: its top edge, or null
  function bottomBarTop(r) {
    var top = null, seen = [];
    under(r, true).forEach(function (e) {
      for (var n = e; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
        var cs = getComputedStyle(n), p = cs.position;
        if (p !== 'fixed' && p !== 'sticky') continue;
        if (seen.indexOf(n) >= 0 || n.id === 'stratum-demo-badge' || n.tagName === 'TOKOVI-DESIGN-SWITCH') return;
        seen.push(n);
        if (p === 'sticky' && cs.bottom === 'auto') return;
        var b = n.getBoundingClientRect();
        if (b.height > innerHeight * 0.45 || b.top < innerHeight * 0.45 || b.bottom < innerHeight - 160) return;
        if (cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05) return;
        if (top === null || b.top < top) top = b.top;
        return;
      }
    });
    return top;
  }
  // does the bar sit over something you read or tap (a row, a link, a button, a field)?
  var CONTENT = 'a[href],button,input,select,textarea,label,summary,[role="button"],[role="link"],[role="row"],[role="tab"],[data-act],tr,li,td,th,p,h1,h2,h3,h4,dd,dt';
  function coversContent(r) {
    return under(r, true).some(function (e) {
      var c = e.closest ? e.closest(CONTENT) : null;
      return !!c && c !== document.body && c.tagName !== 'MAIN';
    });
  }
  // …or over a button, a field or a control, which must always stay tappable, at rest too: any part of a button-sized
  // one, but of a big clickable card or row only a fifth of it or its middle (the rest stays tappable), and
  // text links styled as links (class "…link…", as in table rows) do not count.
  var BUTTONS = '.btn,button,[role="button"],[role="switch"],[role="checkbox"],[role="tab"],input:not([type="hidden"]),select,textarea';
  function coversButton(r) {
    var seen = [];
    return under(r, true).some(function (e) {
      var c = e.closest ? e.closest(BUTTONS) : null;
      if (!c || seen.indexOf(c) >= 0) return false;
      seen.push(c);
      var cls = typeof c.className === 'string' ? c.className : '';
      if (!/\bbtn\b/.test(cls) && /link/i.test(cls)) return false;
      var b = c.getBoundingClientRect(), area = b.width * b.height;
      if (!area) return false;
      var cx = (b.left + b.right) / 2, cy = (b.top + b.bottom) / 2;
      if (cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) return true;
      var ix = Math.min(b.right, r.right) - Math.max(b.left, r.left), iy = Math.min(b.bottom, r.bottom) - Math.max(b.top, r.top);
      // a button-sized control may not lose even a corner; a large card only a fifth of it
      return ix > 1 && iy > 1 && (area <= 12000 || ix * iy >= area * 0.2);
    });
  }
  var cover = { away: false, compact: false, shift: 0 }, lastScroll = 0, lastInput = 0, typedIn = null;
  function moved(r, d) { return { left: r.left, right: r.right, top: r.top - d, bottom: r.bottom - d }; }
  function layout() {
    queued = false;
    if (!host || !barEl) return;
    st.typing = !!typedIn && typedIn === document.activeElement && typingIn(typedIn);
    var away = layerOpen();
    if (!away && phone() && (st.typing || st.kbd)) away = true;
    var canCompact = phone() && opt.home !== '1', compact = canCompact && st.compact;
    setCompact(compact);
    // where the bar sits without any lift of ours
    var r = barEl.getBoundingClientRect(), nat = moved(r, -lift);
    // lift above a bar fixed to the bottom of the screen (selection bars, action bars)
    var base = 0;
    if (!away && opt.home !== '1' && nat.top > innerHeight / 2) {
      var t = bottomBarTop(nat);
      if (t !== null && nat.bottom > t - 8) base = Math.min(Math.round(nat.bottom - (t - 8)), Math.round(innerHeight * 0.5));
    }
    // over a button or a field: the round back button if that clears it (phones), otherwise a little higher up where
    // nothing can be tapped, and only if there is no such place, out of the way. Decided once the page stands still,
    // so the bar does not jump while rows scroll past under it.
    if (away || opt.home === '1') cover = { away: false, compact: false, shift: 0 };
    else if (Date.now() - lastScroll > 250) {
      cover = { away: false, compact: false, shift: 0 };
      var full = moved(nat, base), small = full;
      if (canCompact && !compact) { setCompact(true); small = moved(moved(barEl.getBoundingClientRect(), -lift), base); setCompact(false); }
      var found = false, top = nat.top > innerHeight / 2, max = top ? Math.round(innerHeight * 0.3) : 0;
      for (var d = 0; d <= max && !found; d += 12) {
        if (!coversButton(moved(full, d))) { cover.shift = d; found = true; }
        else if (small !== full && !coversButton(moved(small, d))) { cover.shift = d; cover.compact = true; found = true; }
      }
      if (!found) cover.away = true;
      // at the end of a list the round button would sit on the last row: out of the way until you scroll back up
      else if ((compact || cover.compact) && st.end && !cover.shift && coversContent(moved(compact ? full : small, 0))) cover.away = true;
    }
    setCompact(compact || cover.compact);
    if (cover.away) away = true;
    var want = away ? lift : base + cover.shift;
    if (want !== lift) { lift = want; host.style.transform = lift ? 'translateY(' + (-lift) + 'px)' : ''; }
    if (away) {
      if (!host.hasAttribute('data-away')) {
        host.setAttribute('data-away', '');
        host.setAttribute('aria-hidden', 'true');
        try { host.inert = true; } catch (e) {}
        if (host.shadowRoot && host.shadowRoot.activeElement && document.activeElement && document.activeElement.blur) document.activeElement.blur();
      }
    } else if (host.hasAttribute('data-away')) {
      host.removeAttribute('data-away'); host.removeAttribute('aria-hidden');
      try { host.inert = false; } catch (e) {}
    }
  }
  function setCompact(on) { if (on) host.setAttribute('data-compact', ''); else host.removeAttribute('data-compact'); }
  function schedule() { if (queued) return; queued = true; (window.requestAnimationFrame || setTimeout)(layout); }
  function keepClear() {
    if (window.MutationObserver) {
      new MutationObserver(function (recs) {
        for (var i = 0; i < recs.length; i++) if (recs[i].target !== host) { schedule(); return; }
      }).observe(document.documentElement, { subtree: true, childList: true, attributes: true,
        attributeFilter: ['open', 'class', 'hidden', 'style', 'aria-hidden', 'aria-modal', 'role', 'inert'] });
    }
    ['transitionend', 'animationend', 'resize', 'orientationchange'].forEach(function (t) { window.addEventListener(t, schedule, true); });
    if (phoneMq && phoneMq.addEventListener) phoneMq.addEventListener('change', schedule);
    // typing: a field with focus, or the on-screen keyboard (the visual viewport shrinks)
    // only a field the person tapped or tabbed into: a search box an app focuses on load does not bring up a keyboard
    ['pointerdown', 'touchstart', 'keydown'].forEach(function (t) { document.addEventListener(t, function () { lastInput = Date.now(); }, true); });
    document.addEventListener('focusin', function (e) { typedIn = Date.now() - lastInput < 1500 ? e.target : null; schedule(); }, true);
    document.addEventListener('focusout', function () { setTimeout(schedule, 0); }, true);
    var vv = window.visualViewport;
    if (vv && vv.addEventListener) vv.addEventListener('resize', function () { st.kbd = vv.height < window.innerHeight - 150; schedule(); });
    // scrolling (the page or any large scroll box inside it): down → round back button, up → the whole bar
    var lastY = window.WeakMap ? new WeakMap() : null, run = 0, settle = 0;
    document.addEventListener('scroll', function (e) {
      if (!lastY) return;
      var el = e.target === document ? (document.scrollingElement || document.documentElement) : e.target;
      if (!el || el.nodeType !== 1) return;
      var y = el.scrollTop, prev = lastY.has(el) ? lastY.get(el) : y, dy = y - prev;
      lastY.set(el, y);
      if (!dy) return; // sideways
      var box = el === document.scrollingElement || el === document.documentElement ? innerHeight : el.clientHeight;
      if (box < innerHeight * 0.4 || el.scrollHeight - box < 40) return; // small lists and menus do not count
      run = (dy > 0) === (run > 0) ? run + dy : dy;
      if (y <= 24) { st.compact = false; st.end = false; }
      else if (run > 12) st.compact = true;
      else if (run < -12) { st.compact = false; st.end = false; }
      if (dy > 0) st.end = y + box >= el.scrollHeight - 4;
      lastScroll = Date.now();
      clearTimeout(settle); settle = setTimeout(schedule, 300);
      schedule();
    }, true);
    setInterval(function () { if (!document.hidden) schedule(); }, 800);
    schedule();
  }

  // Optional account / sync button, set by /_shared/stratum-sync.js on pages that use sync:
  //   StratumShell.setAccount({ initials, label, title, state: 'ok'|'busy'|'warn'|'off', onClick }) or null
  function renderAccount() {
    if (!acctBtn) return;
    if (!account) { acctBtn.hidden = true; return; }
    var colours = { ok: '#3F7D58', busy: '#3E5BA9', warn: '#C2410C', off: '#8F8C85' };
    acctBtn.hidden = false;
    acctBtn.style.setProperty('--st', colours[account.state] || colours.off);
    acctBtn.innerHTML = (account.initials ? '<span class="av" aria-hidden="true"></span>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18a4.5 4.5 0 0 1-.5-9 6 6 0 0 1 11.6 1.5A3.75 3.75 0 0 1 17.5 18z"/></svg>') +
      '<span></span><i class="dot" aria-hidden="true"></i>';
    if (account.initials) acctBtn.querySelector('.av').textContent = String(account.initials).slice(0, 2);
    acctBtn.querySelector('span:not(.av)').textContent = account.label || '';
    acctBtn.title = account.title || account.label || '';
    acctBtn.setAttribute('aria-label', account.title || account.label || 'Account');
  }
  // "Needs you today" on the home page: an app reports up to 3 things waiting for the user once its data is ready:
  //   StratumShell.needs('collections', [{ text: 'Letters ready to send', count: 15, href: '/collections/#/reminders', tone: 'warn' }])
  // tone = 'warn' | 'bad' | 'info'; href = a path on this site. Items with a count of 0 are left out, and an empty list
  // clears the app. Saved in localStorage "stratum-needs" as one object { app: { at: ISO time, items } } for all apps.
  var NEEDS = 'stratum-needs';
  function needs(app, items) {
    if (PUBLIC) return true;
    try {
      if (typeof app !== 'string' || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(app) || !Array.isArray(items)) return false;
      var list = [];
      items.forEach(function (it) {
        if (list.length >= 3 || !it || typeof it !== 'object' || typeof it.text !== 'string' || !it.text.trim()) return;
        var o = { text: it.text.trim().slice(0, 90) };
        if (it.count !== undefined && it.count !== null) {
          var n = Number(it.count);
          if (!isFinite(n) || n <= 0) return;
          o.count = Math.round(n * 10) / 10;
        }
        if (typeof it.href === 'string' && /^\/(?!\/)/.test(it.href)) o.href = it.href.slice(0, 200);
        if (it.tone === 'warn' || it.tone === 'bad' || it.tone === 'info') o.tone = it.tone;
        list.push(o);
      });
      var all = null;
      try { all = JSON.parse(localStorage.getItem(NEEDS)); } catch (e) {}
      if (!all || typeof all !== 'object' || Array.isArray(all)) all = {};
      if (list.length) all[app] = { at: new Date().toISOString(), items: list }; else if (all[app]) delete all[app]; else return true;
      localStorage.setItem(NEEDS, JSON.stringify(all));
      return true;
    } catch (e) { return false; }
  }
  // DEMO chip inside the bar (instead of a badge floating over the app): StratumShell.demo(true)
  function demo(on) { demoOn = on !== false; if (demoEl) demoEl.hidden = !demoOn; schedule(); return true; }
  window.StratumShell = { get: read, set: setTheme, refresh: apply, mode: function () { return resolve(read()); },
    setAccount: function (a) { account = a; renderAccount(); }, needs: needs, demo: demo };
  apply();
  if (mq && mq.addEventListener) mq.addEventListener('change', function () { if (read() === 'system') { if (opt.reload === '1') location.reload(); else apply(); } });
  window.addEventListener('storage', function (e) { if (e.key === KEY || e.key === null) { if (opt.reload === '1') location.reload(); else apply(); } });
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);

  // Home-screen app (iPhone "Add to Home Screen", installed app elsewhere): a link that opens a new tab would leave
  // the app for the browser, which has its own sign-in, so links to this site open in place. Other sites, downloads
  // and links an app handles itself are left alone. Normal browser tabs are not affected.
  var standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  if (standalone) {
    var sameSite = function (href) { try { var u = new URL(href, location.href); return u.origin === location.origin && /^https?:$/.test(u.protocol) ? u.href : null; } catch (e) { return null; } };
    document.addEventListener('click', function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a[target="_blank"][href]') : null;
      if (!a || e.defaultPrevented || a.hasAttribute('download') || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      var href = sameSite(a.getAttribute('href'));
      if (href) { e.preventDefault(); location.assign(href); }
    });
    var openWindow = window.open;
    window.open = function (url, target) {
      var href = url && (!target || target === '_blank') ? sameSite(url) : null;
      if (href) { location.assign(href); return null; }
      return openWindow.apply(window, arguments);
    };
  }
})();
