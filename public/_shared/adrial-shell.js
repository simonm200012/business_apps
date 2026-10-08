/* Adrial shell: floating bar (back, account slot, Light/Dark/Auto). Include in <head>, not deferred. */
(function () {
  var s = document.currentScript, ds = (s && s.dataset) || {};
  var KEY = 'adrial-theme', root = document.documentElement;
  var mq = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
  function get() { try { var v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : 'system'; } catch (e) { return 'system'; } }
  function mode() { var g = get(); return g === 'system' ? (mq && mq.matches ? 'dark' : 'light') : g; }
  var last = null;
  function apply() {
    var g = get(), m = mode();
    if (g === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', g);
    root.setAttribute('data-adrial-mode', m);
    if (last !== m + g) { last = m + g; window.dispatchEvent(new CustomEvent('adrial-theme', { detail: { theme: g, mode: m } })); }
    paint();
  }
  function set(v) {
    try { v === 'system' ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, v); } catch (e) {}
    if (ds.reload === '1') location.reload(); else apply();
  }
  var el, acct = null;
  function paint() {
    if (!el || !el.shadowRoot) return;
    var r = el.shadowRoot, g = get();
    r.getElementById('t').textContent = g === 'system' ? 'Auto' : g === 'light' ? 'Light' : 'Dark';
    var a = r.getElementById('a');
    if (acct) { a.hidden = false; a.className = acct.state || 'off'; a.title = acct.title || ''; a.firstChild.textContent = acct.initials || ''; a.lastChild.textContent = acct.label || ''; } else a.hidden = true;
  }
  function build() {
    if (el) return;
    el = document.createElement('adrial-shell');
    var r = el.attachShadow({ mode: 'open' }), pos = ds.pos || 'bl', x = ds.x || 14, y = ds.y || 14;
    var h = /t/.test(pos) ? 'top' : 'bottom', v = /r/.test(pos) ? 'right' : 'left';
    r.innerHTML = '<style>:host{all:initial}.bar{position:fixed;' + h + ':' + y + 'px;' + v + ':' + x + 'px;z-index:2147483000;display:flex;gap:6px;font:500 12px system-ui,sans-serif}' +
      'a,button{font:inherit;color:#222;background:rgba(255,255,255,.92);border:1px solid rgba(0,0,0,.15);border-radius:999px;padding:6px 11px;cursor:pointer;text-decoration:none;box-shadow:0 1px 4px rgba(0,0,0,.15)}' +
      ':host-context(html[data-adrial-mode=dark]) a,:host-context(html[data-adrial-mode=dark]) button{color:#eee;background:rgba(30,32,36,.92);border-color:rgba(255,255,255,.2)}' +
      '#a i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;background:#999}.ok i{background:#2a9d4a}.busy i{background:#d9a400}.warn i{background:#d33}</style>' +
      '<div class="bar">' + (ds.home === '1' ? '' : '<a href="/" id="h">← Apps</a>') + '<button id="a" hidden><span></span><span></span></button><button id="b" title="Theme"><span id="t"></span></button></div>';
    r.getElementById('b').onclick = function () { var g = get(); set(g === 'system' ? 'light' : g === 'light' ? 'dark' : 'system'); };
    r.getElementById('a').onclick = function () { acct && acct.onClick && acct.onClick(); };
    (document.body || root).appendChild(el); paint();
  }
  apply();
  if (mq && mq.addEventListener) mq.addEventListener('change', apply);
  window.addEventListener('storage', function (e) { if (e.key === KEY) apply(); });
  if (document.body) build(); else document.addEventListener('DOMContentLoaded', build);
  window.AdrialShell = { get: get, set: set, mode: mode, refresh: apply, setAccount: function (a) { acct = a || null; paint(); } };
})();
