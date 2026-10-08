/* Adrial Apps shell: a "← Adrial Apps" button and a Light / Dark / System switch on every app.
 *
 * Include it in <head> (not deferred) so the theme is applied before the page paints:
 *   <script src="/_shared/adrial-shell.js" data-pos="bl"></script>
 * Options (data-*): pos = bl | br | tl | tr (corner), y = distance from the top/bottom edge in px,
 *   x = distance from the side in px, home = "1" on the start page (no back button),
 *   reload = "1" for apps that read the theme only at start-up.
 *
 * The choice is stored in localStorage "adrial-theme" (absent = follow the system), shared by all
 * apps on this site. <html> gets data-theme="light|dark" only for an explicit choice (apps that
 * follow prefers-color-scheme keep doing so) and always data-adrial-mode="light|dark" (resolved). */
(function () {
  'use strict';
  if (window.AdrialShell) return;

  var KEY = 'adrial-theme';
  var script = document.currentScript;
  var opt = (script && script.dataset) || {};
  var root = document.documentElement;
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

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
    root.setAttribute('data-adrial-mode', m);
    if (host) host.setAttribute('data-mode', m);
    if (btn) {
      btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICON[t] + '</svg><span>' + LABEL[t] + '</span>';
      btn.setAttribute('aria-label', 'Theme: ' + LABEL[t] + '. Switch to ' + LABEL[NEXT[t]]);
      btn.title = 'Theme: ' + LABEL[t] + ' (click for ' + LABEL[NEXT[t]] + ')';
    }
    try { window.dispatchEvent(new CustomEvent('adrial-theme', { detail: { theme: t, mode: m } })); } catch (e) {}
  }

  function setTheme(t) {
    write(t);
    if (opt.reload === '1') { location.reload(); return; }
    apply();
  }

  function mount() {
    if (host || !document.body) return;
    host = document.createElement('adrial-shell');
    var corner = opt.pos || 'bl';
    var y = (opt.y || '14') + 'px', x = (opt.x || '14') + 'px';
    var pos = 'position:fixed;z-index:2147483000;' +
      (corner.charAt(0) === 't' ? 'top:' : 'bottom:') + 'calc(' + y + ' + env(safe-area-inset-' + (corner.charAt(0) === 't' ? 'top' : 'bottom') + ',0px));' +
      (corner.charAt(1) === 'r' ? 'right:' : 'left:') + x + ';';
    host.setAttribute('style', pos);
    var shadow = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    var home = opt.home === '1';
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
      '@media (max-width:520px){.lbl,button span{display:none}a,button{padding:0 10px}}' +
      '@media print{.bar{display:none}}' +
      '</style>' +
      '<div class="bar" role="group" aria-label="Adrial Apps">' +
      (home ? '' : '<a href="/" title="Back to Adrial Apps"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg><span class="lbl">Adrial Apps</span></a>') +
      '<button type="button" class="acct" hidden></button><button type="button" class="theme"></button></div>';
    btn = shadow.querySelector('button.theme');
    acctBtn = shadow.querySelector('button.acct');
    acctBtn.addEventListener('click', function () { if (account && account.onClick) account.onClick(); });
    renderAccount();
    var a = shadow.querySelector('a');
    if (a && home === false) a.setAttribute('aria-label', 'Back to Adrial Apps');
    btn.addEventListener('click', function () { setTheme(NEXT[read()]); });
    document.body.appendChild(host);
    apply();
  }

  // Optional account / sync button, set by /_shared/adrial-sync.js on pages that use sync:
  //   AdrialShell.setAccount({ initials, label, title, state: 'ok'|'busy'|'warn'|'off', onClick }) or null
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
  window.AdrialShell = { get: read, set: setTheme, refresh: apply, mode: function () { return resolve(read()); },
    setAccount: function (a) { account = a; renderAccount(); } };
  apply();
  if (mq && mq.addEventListener) mq.addEventListener('change', function () { if (read() === 'system') { if (opt.reload === '1') location.reload(); else apply(); } });
  window.addEventListener('storage', function (e) { if (e.key === KEY || e.key === null) { if (opt.reload === '1') location.reload(); else apply(); } });
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
})();
