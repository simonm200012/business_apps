/* Business Apps cloud sync (browser side). Server side: worker/index.js on Cloudflare (provider 'access').
 *
 *   <script src="/_shared/stratum-sync.js"></script>      →  window.StratumSync
 *
 * Accounts: on Cloudflare, whoever Cloudflare Access let in is signed in (no extra password); snapshots go up and
 * down as raw JSON with the generation in the query (?base=N) and in response headers, so the Worker never parses
 * them. On the Node server, anyone creates an account with their e-mail and a password.
 * Each person's data per app is stored privately; this file decides when to
 * upload, download or ask. Apps only describe their data:
 *
 *   const sync = StratumSync.attach({
 *     app: 'erp',                                   // 'erp' | 'crm' | 'mail' | 'invoices' | 'desk' | 'parcels' | 'recon' | 'stores' | 'onboarding' | 'contracts' | 'marketing' | 'tasks'
 *     label: 'ERP data',
 *     getSnapshot: async () => wholeStateObject,    // JSON-serialisable, no Blobs
 *     applySnapshot: async (data) => {...},         // replace local state with data (from cloud) and re-render
 *     isEmpty: async () => bool,                    // optional: true when this browser holds nothing of the person's own
 *                                                   //   yet, so a new device takes the cloud copy without asking
 *     files: {                                      // optional, for binary files (e.g. invoice PDFs/photos)
 *       list: async () => [{ hash, type, getBlob: async () => Blob }],   // hash = sha256 hex of the bytes
 *       has: async (hash) => bool,                  // is this file stored locally?
 *       put: async (hash, blob, type) => {...}      // store a downloaded file locally
 *     },
 *     describeLoss: (fromData, toData) => [...]     // optional: short lines for important items in fromData that are
 *                                                   //   missing from toData (e.g. issued invoices); see "Loss check"
 *   });
 *   sync.changed();          // call after every local save (debounced upload)
 *   sync.syncNow();          // manual "Sync now"
 *   sync.ensureFresh()       // sync now and say how it went: → { status: 'off' | 'fresh' | 'offline' | 'conflict', message? }
 *   sync.fetchFile(hash)     // → Blob from the cloud (also stored locally via files.put)
 *   sync.mountPanel(el)      // standard status card ("Signed in as … · last synced … · Sync now · Restore an earlier version…")
 *   sync.on(fn)              // fn(state) whenever status changes; state.status in
 *                            //   'off' | 'signed-out' | 'idle' | 'syncing' | 'synced' | 'error' | 'conflict' | 'choose' |
 *                            //   'offline' (can't reach the cloud) | 'expired' (sign-in expired) | 'view-only'
 *
 * Rules: the first time a browser signs in for an app and both sides have data, the person chooses
 * (use cloud / upload this browser / not now). Afterwards uploads use the last known cloud version
 * as a precondition; if the cloud changed elsewhere, clean local data simply takes the cloud copy,
 * and local unsaved changes ask (keep this browser / take cloud). Nothing is ever merged silently.
 * - Every local change counts up a change number (rev); an upload only marks the data synced if no change came in while
 *   it was on its way, otherwise it uploads again. The mark lives in localStorage, so a change made while the account
 *   was unknown (offline at load, sign-in expired) is carried over and uploaded once the account is known again.
 * - Loss check: before the sync replaces data (a choice in a dialog, a newer cloud copy taken automatically, restoring a
 *   version), describeLoss(the data that would be replaced, the data replacing it) is asked. A choice that would lose
 *   something is turned off and the items are listed; "Download both copies" saves both as JSON files.
 * - Version history (Cloudflare): the cloud keeps the 30 copies before the current one; the panel can restore one.
 * - View-only people (auth/me says viewer) never upload and are never asked to replace the cloud copy.
 * - Requests use redirect: 'manual', so an expired Cloudflare Access session (a redirect to the Access login) is told
 *   apart from being offline; the panel then offers "Sign in again" (a reload through Access).
 */
(function () {
  'use strict';
  if (window.StratumSync) return;

  var H = { 'X-Tokovi-Apps': '1' };
  // expired: Cloudflare Access wants a new sign-in; unreachable: the last check could not reach the server
  var auth = { enabled: false, provider: '', devLogin: false, signupDomains: [], user: null, loaded: false, expired: false, unreachable: false };
  var listeners = [], controllers = [];
  // Public site (public/, built by tools/build-public.mjs): the demo copies carry <meta name="stratum-public" content="1">.
  // There sync is off for good: no /api/auth calls, no account button, and mountPanel shows nothing. Without the meta
  // (the private site) nothing here changes.
  var PUBLIC = (function () { try { var m = document.querySelector('meta[name="stratum-public"]'); return !!m && m.getAttribute('content') === '1'; } catch (e) { return false; } })();
  var MSG = {
    offline: 'Can’t reach the cloud right now. Your changes are kept in this browser and sync when the connection is back.',
    expired: 'Your sign-in has expired, so nothing is syncing. Sign in again; nothing in this browser is lost.'
  };
  function syncError(kind) { var e = new Error(MSG[kind]); e.kind = kind; return e; }
  // Every API request: redirect 'manual' turns an Access login redirect into an 'opaqueredirect' answer (not a CORS
  // "Failed to fetch"), so an expired sign-in is told apart from a missing connection.
  function req(url, init) {
    return fetch(url, Object.assign({ credentials: 'same-origin', cache: 'no-store', redirect: 'manual' }, init || {})).then(function (r) {
      if (r.type === 'opaqueredirect' || (r.status >= 300 && r.status < 400) || (r.status === 401 && viaAccess())) throw syncError('expired');
      return r;
    }, function () { throw syncError('offline'); });
  }

  var checking = null;
  function authSig() { var u = auth.user; return [auth.enabled, auth.provider, auth.expired, auth.unreachable, u && u.email, u && !!u.viewer].join('|'); }
  /** (Re)checks who is signed in; again whenever the connection comes back or the page is shown while it failed. */
  function checkAuth() {
    if (checking) return checking;
    var before = auth.loaded ? authSig() : null;
    var p = !PUBLIC && /^https?:$/.test(location.protocol) ? req('/api/auth/config').then(function (r) {
      if (r.status === 401) throw syncError('expired'); // only Cloudflare Access answers this with 401
      return r.ok ? r.json().catch(function () { return { enabled: false }; }) : { enabled: false };
    })
      .then(function (c) {
        auth.enabled = !!c.enabled; auth.provider = c.provider || ''; auth.devLogin = !!c.devLogin; auth.signupDomains = c.signupDomains || [];
        if (!auth.enabled) return null;
        return req('/api/auth/me').then(function (r) { return r.ok ? r.json() : null; });
      })
      .then(function (u) { auth.user = u && u.email ? u : null; auth.expired = false; auth.unreachable = false; }, function (e) {
        // the account stays as it was known (a change is then saved under it); it is checked again later
        if (e && e.kind === 'expired') { auth.enabled = true; if (!auth.provider) auth.provider = 'access'; auth.expired = true; auth.unreachable = false; }
        else auth.unreachable = true;
      }) : Promise.resolve();
    checking = p.then(function () {
      checking = null; auth.loaded = true;
      if (authSig() !== before) { emit(); renderShell(); }
      return auth;
    });
    return checking;
  }
  var ready = checkAuth();
  function recheck() { if (auth.loaded && (auth.unreachable || auth.expired)) checkAuth(); }
  window.addEventListener('online', function () { if (auth.unreachable || auth.expired) checkAuth(); else controllers.forEach(function (c) { c._retry(); }); });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') recheck(); });
  setInterval(function () { if (auth.unreachable && document.visibilityState !== 'hidden') checkAuth(); }, 60000);
  function reauth() { location.reload(); } // a full page load goes through Cloudflare Access, which signs in again

  function emit() { listeners.forEach(function (fn) { try { fn(auth); } catch (e) { console.error(e); } }); controllers.forEach(function (c) { c._authChanged(); }); }
  function viaAccess() { return auth.provider === 'access'; } // Cloudflare Access signs people in; no passwords here
  function initials(u) { var n = (u && (u.name || u.email) || '?').replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean); return ((n[0] || '?')[0] + (n[1] ? n[1][0] : '')).toUpperCase(); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function ago(iso) { if (!iso) return 'never'; var s = (Date.now() - new Date(iso)) / 1000; if (s < 60) return 'just now'; if (s < 3600) return Math.round(s / 60) + ' min ago'; if (s < 86400) return Math.round(s / 3600) + ' h ago'; return new Date(iso).toLocaleDateString(); }

  // ── shell account button ─────────────────────────────────────────────────
  function worstState() {
    var st = controllers.map(function (c) { return c.state.status; });
    if (auth.expired || ['conflict', 'choose', 'error', 'offline', 'expired'].some(function (x) { return st.indexOf(x) >= 0; })) return 'warn';
    if (st.indexOf('syncing') >= 0) return 'busy';
    return 'ok';
  }
  function renderShell() {
    if (!window.StratumShell || !window.StratumShell.setAccount) return setTimeout(renderShell, 200);
    if (!auth.loaded) return;
    if (auth.expired) return window.StratumShell.setAccount({ label: 'Sign in again', title: 'Your sign-in has expired: your data is not syncing', state: 'warn', onClick: signIn });
    if (!auth.enabled) return window.StratumShell.setAccount(auth.unreachable ? { label: 'Offline', title: MSG.offline, state: 'warn', onClick: function () { checkAuth(); } } : null);
    if (!auth.user) return window.StratumShell.setAccount({ label: 'Sign in', title: 'Sign in to sync your data across devices', state: 'off', onClick: signIn });
    window.StratumShell.setAccount({ initials: initials(auth.user), label: '', title: auth.user.email + (auth.user.viewer ? ' · view only' : ' · cloud sync ' + ({ ok: 'up to date', busy: 'syncing…', warn: 'needs attention' })[worstState()]), state: worstState(), onClick: accountMenu });
  }

  // ── small dialog helper (own styles, follows light/dark) ─────────────────
  var css = document.createElement('style');
  css.textContent =
    '.as-scrim{position:fixed;inset:0;z-index:2147483100;background:rgba(12,12,13,.38);display:flex;align-items:center;justify-content:center;padding:16px}' +
    '.as-box{width:min(440px,100%);max-height:calc(100vh - 32px);overflow:auto;background:#fff;color:#0C0C0D;border-radius:20px;box-shadow:0 50px 110px -40px rgba(12,12,13,.5);font:15px/1.5 Geist,ui-sans-serif,system-ui,sans-serif;padding:22px}' +
    'html[data-stratum-mode="dark"] .as-box{background:#161618;color:#F4F3EF}' +
    '.as-box h2{margin:0 0 6px;font-size:20px;font-weight:500;letter-spacing:-.02em}' +
    '.as-box p{margin:0 0 14px;color:#55544F;font-size:14px}html[data-stratum-mode="dark"] .as-box p{color:#BAB7AF}' +
    '.as-row{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;margin-top:16px}' +
    '.as-btn{display:inline-flex;align-items:center;justify-content:center;min-height:40px;padding:0 16px;border-radius:999px;border:1px solid #E0DDD6;background:transparent;color:inherit;font:500 14px Geist,system-ui,sans-serif;cursor:pointer}' +
    'html[data-stratum-mode="dark"] .as-btn{border-color:#2E2E33}' +
    '.as-btn.pri{background:#0C0C0D;border-color:#0C0C0D;color:#F4F3EF}html[data-stratum-mode="dark"] .as-btn.pri{background:#F4F3EF;border-color:#F4F3EF;color:#0C0C0D}' +
    '.as-btn:focus-visible{outline:2px solid #7B66F0;outline-offset:2px}' +
    '.as-in{width:100%;min-height:42px;box-sizing:border-box;border-radius:12px;border:1px solid #E0DDD6;padding:0 12px;font:inherit;background:transparent;color:inherit}' +
    'html[data-stratum-mode="dark"] .as-in{border-color:#2E2E33}.as-in:focus{outline:2px solid #7B66F0;outline-offset:1px}' +
    '.as-lbl{display:block;margin:12px 0 5px;font-size:13px;font-weight:500}' +
    '.as-pw{position:relative}.as-pw .as-in{padding-right:64px}.as-pw button{position:absolute;right:6px;top:50%;transform:translateY(-50%);border:0;background:transparent;color:inherit;font:500 12.5px Geist,system-ui,sans-serif;padding:6px 8px;border-radius:8px;cursor:pointer;opacity:.75}' +
    '.as-tabs{display:flex;gap:4px;padding:4px;border-radius:999px;background:#EFEDE7;margin:2px 0 14px}html[data-stratum-mode="dark"] .as-tabs{background:#232327}' +
    '.as-tabs button{flex:1;min-height:36px;border:0;border-radius:999px;background:transparent;color:inherit;font:500 14px Geist,system-ui,sans-serif;cursor:pointer;opacity:.7}' +
    '.as-tabs button[aria-selected="true"]{background:#fff;opacity:1;box-shadow:0 1px 3px rgba(12,12,13,.12)}html[data-stratum-mode="dark"] .as-tabs button[aria-selected="true"]{background:#0C0C0D}' +
    '.as-ok{margin:10px 0 0;padding:10px 12px;border-radius:12px;background:#E1EEE5;color:#2F5E43;font-size:13.5px}' +
    '.as-err{margin:10px 0 0;padding:10px 12px;border-radius:12px;background:#F6E3D6;color:#9A3412;font-size:13.5px}' +
    '.as-note{font:12px/1.5 "Geist Mono",ui-monospace,monospace;color:#6B6964}' +
    '.as-menu .as-btn{width:100%;justify-content:flex-start}' +
    '.as-card{display:flex;flex-wrap:wrap;gap:10px 14px;align-items:center;justify-content:space-between;padding:12px 14px;border:1px solid var(--line,#E0DDD6);border-radius:14px;font-size:13.5px}' +
    '.as-card b{font-weight:500}.as-card .as-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;background:#8F8C85}' +
    '.as-card[data-s="synced"] .as-dot,.as-card[data-s="view-only"] .as-dot{background:#3F7D58}.as-card[data-s="syncing"] .as-dot{background:#3E5BA9}' +
    '.as-card[data-s="error"] .as-dot,.as-card[data-s="conflict"] .as-dot,.as-card[data-s="choose"] .as-dot,.as-card[data-s="offline"] .as-dot,.as-card[data-s="expired"] .as-dot{background:#C2410C}' +
    '.as-card .as-txt{flex:1 1 auto;min-width:0;overflow-wrap:anywhere}.as-card .as-acts{display:flex;flex-wrap:wrap;gap:8px}' +
    '.as-card .as-btn{min-height:36px;padding:0 14px;font-size:13.5px}' +
    '.as-pill{display:inline-block;margin-right:6px;padding:1px 8px;border-radius:999px;background:#EFEDE7;font-size:12px;font-weight:500;vertical-align:1px}html[data-stratum-mode="dark"] .as-pill{background:#232327}' +
    '.as-btn:disabled{opacity:.42;cursor:not-allowed}' +
    '.as-loss ul{margin:6px 0 0;padding-left:18px}.as-loss li{margin:2px 0;overflow-wrap:anywhere}' +
    '.as-list{list-style:none;margin:0;padding:0;max-height:min(52vh,420px);overflow:auto;border:1px solid #E0DDD6;border-radius:14px}html[data-stratum-mode="dark"] .as-list{border-color:#2E2E33}' +
    '.as-list li+li{border-top:1px solid #E0DDD6}html[data-stratum-mode="dark"] .as-list li+li{border-color:#2E2E33}' +
    '.as-ver{display:flex;flex-wrap:wrap;gap:2px 12px;justify-content:space-between;align-items:baseline;width:100%;min-height:44px;box-sizing:border-box;padding:10px 14px;border:0;background:transparent;color:inherit;font:inherit;font-size:14px;text-align:left;cursor:pointer}' +
    '.as-ver:hover{background:rgba(12,12,13,.05)}html[data-stratum-mode="dark"] .as-ver:hover{background:rgba(255,255,255,.06)}.as-ver:focus-visible{outline:2px solid #7B66F0;outline-offset:-2px}';
  (document.head || document.documentElement).appendChild(css);

  function dialog(html, wire) {
    return new Promise(function (resolve) {
      var prev = document.activeElement;
      var el = document.createElement('div');
      el.className = 'as-scrim';
      el.innerHTML = '<div class="as-box" role="dialog" aria-modal="true">' + html + '</div>';
      document.body.appendChild(el);
      function close(v) { document.removeEventListener('keydown', key, true); el.remove(); if (prev && prev.focus) prev.focus(); resolve(v); }
      function key(e) { if (e.key === 'Escape') { e.stopPropagation(); close(null); } }
      document.addEventListener('keydown', key, true);
      el.addEventListener('click', function (e) { if (e.target === el) close(null); var b = e.target.closest('[data-v]'); if (b && !b.disabled) close(b.getAttribute('data-v')); });
      if (wire) wire(el.querySelector('.as-box'), close);
      // focus what the dialog marks with autofocus, else its first button or field (the safe choice comes first)
      var f = el.querySelector('[autofocus]') || el.querySelector('.as-btn, input'); if (f) f.focus();
    });
  }

  // ── sign in / out ─────────────────────────────────────────────────────────
  function post(path, body) {
    return fetch(path, { method: 'POST', credentials: 'same-origin', headers: Object.assign({ 'Content-Type': 'application/json' }, H), body: JSON.stringify(body || {}) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || 'Something went wrong (' + r.status + ')'); return j; }); });
  }
  function finishSignIn(path, body) {
    return post(path, body).then(function (u) { auth.user = u; emit(); renderShell(); return u; });
  }
  function pwField(id, label, autocomplete) {
    return '<label class="as-lbl" for="' + id + '">' + label + '</label><div class="as-pw"><input class="as-in" id="' + id + '" type="password" autocomplete="' + autocomplete + '" required>' +
      '<button type="button" data-show="' + id + '" aria-label="Show password">Show</button></div>';
  }
  function wirePwToggles(box) {
    box.querySelectorAll('[data-show]').forEach(function (b) {
      b.addEventListener('click', function () {
        var inp = box.querySelector('#' + b.getAttribute('data-show')), show = inp.type === 'password';
        inp.type = show ? 'text' : 'password'; b.textContent = show ? 'Hide' : 'Show'; b.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      });
    });
  }
  function signIn(mode) {
    return ready.then(function () {
      if (!auth.enabled) return dialog('<h2>Sync is not set up</h2><p>Cloud sync has not been configured on this server yet. Your data stays in this browser.</p><div class="as-row"><button class="as-btn pri" data-v="ok">OK</button></div>');
      if (auth.user && !auth.expired) return accountMenu();
      if (viaAccess()) return dialog('<h2>Sign in again</h2><p>Your sign-in to Business Apps has expired, so your data is not syncing. Reload the page to sign in again. Nothing in this browser is lost.</p>' +
        '<div class="as-row"><button class="as-btn" data-v="cancel">Not now</button><button class="as-btn pri" data-v="reload">Reload and sign in</button></div>')
        .then(function (v) { if (v === 'reload') reauth(); });
      var limit = auth.signupDomains.length ? ' Accounts are for ' + auth.signupDomains.map(function (d) { return '@' + d; }).join(', ') + ' addresses.' : '';
      return dialog('<h2>Cloud sync</h2><p>Sign in to save your ERP, CRM, Mail and Invoices data privately to the cloud and continue on another device.</p>' +
        '<div class="as-tabs" role="tablist"><button type="button" role="tab" data-tab="in">Sign in</button><button type="button" role="tab" data-tab="up">Create account</button></div>' +
        '<form id="as-form" novalidate>' +
        '<div data-only="up" hidden><label class="as-lbl" for="as-name">Your name</label><input class="as-in" id="as-name" autocomplete="name" maxlength="80"></div>' +
        '<label class="as-lbl" for="as-email">E-mail</label><input class="as-in" id="as-email" type="email" autocomplete="username" required autofocus>' +
        '<label class="as-lbl" for="as-pass">Password</label><div class="as-pw"><input class="as-in" id="as-pass" type="password" required><button type="button" data-show="as-pass" aria-label="Show password">Show</button></div>' +
        '<p class="as-note" data-only="up" hidden style="margin:8px 0 0">At least 10 characters. Any e-mail works: it is only your user name, nothing is sent to it.' + esc(limit) + '</p>' +
        '<p class="as-note" data-only="in" style="margin:8px 0 0">Forgot your password? Ask your admin to reset your account. Your synced data is kept.</p>' +
        '<div id="as-err" class="as-err" role="alert" hidden></div>' +
        '<div class="as-row"><button type="button" class="as-btn" data-v="cancel">Cancel</button><button type="submit" class="as-btn pri" id="as-go">Sign in</button></div></form>' +
        (auth.devLogin ? '<p class="as-note" style="margin-top:18px">Local test sign-in (development server only, no password)</p><div style="display:flex;gap:8px"><input class="as-in" id="as-dev" type="email" placeholder="name@example.com" aria-label="E-mail for test sign-in"><button type="button" class="as-btn" id="as-devgo">Test</button></div>' : ''),
      function (box, close) {
        var err = box.querySelector('#as-err'), form = box.querySelector('#as-form'), go = box.querySelector('#as-go'), pass = box.querySelector('#as-pass'), tab = mode === 'up' ? 'up' : 'in';
        function fail(e) { err.hidden = false; err.textContent = e.message || String(e); go.disabled = false; }
        function setTab(t) {
          tab = t; err.hidden = true;
          box.querySelectorAll('[data-tab]').forEach(function (b) { b.setAttribute('aria-selected', String(b.getAttribute('data-tab') === t)); });
          box.querySelectorAll('[data-only]').forEach(function (el) { el.hidden = el.getAttribute('data-only') !== t; });
          pass.setAttribute('autocomplete', t === 'up' ? 'new-password' : 'current-password');
          go.textContent = t === 'up' ? 'Create account' : 'Sign in';
        }
        box.querySelectorAll('[data-tab]').forEach(function (b) { b.addEventListener('click', function () { setTab(b.getAttribute('data-tab')); }); });
        wirePwToggles(box);
        setTab(tab);
        form.addEventListener('submit', function (e) {
          e.preventDefault(); err.hidden = true;
          var email = box.querySelector('#as-email').value.trim(), pw = pass.value;
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail(new Error('Enter a valid e-mail address.'));
          if (!pw) return fail(new Error('Enter your password.'));
          if (tab === 'up' && pw.length < 10) return fail(new Error('Use at least 10 characters.'));
          go.disabled = true;
          var req = tab === 'up'
            ? finishSignIn('/api/auth/signup', { email: email, password: pw, name: box.querySelector('#as-name').value.trim() })
            : finishSignIn('/api/auth/login', { email: email, password: pw });
          req.then(function () { close('ok'); }, fail);
        });
        var dev = box.querySelector('#as-devgo');
        if (dev) dev.addEventListener('click', function () { finishSignIn('/api/auth/dev', { email: box.querySelector('#as-dev').value.trim() }).then(function () { close('ok'); }, fail); });
      });
    });
  }
  function signOut() {
    if (viaAccess()) { location.href = '/cdn-cgi/access/logout'; return Promise.resolve(); }
    return fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', headers: H }).catch(function () {}).then(function () {
      auth.user = null; emit(); renderShell();
    });
  }
  function changePassword() {
    return dialog('<h2>Change password</h2><p>Other devices where you are signed in will be signed out.</p><form id="as-form" novalidate>' +
      '<input type="email" autocomplete="username" value="' + esc(auth.user.email) + '" hidden>' +
      pwField('as-cur', 'Current password', 'current-password') + pwField('as-new', 'New password (at least 10 characters)', 'new-password') +
      '<div id="as-err" class="as-err" role="alert" hidden></div><div id="as-ok" class="as-ok" hidden>Password changed.</div>' +
      '<div class="as-row"><button type="button" class="as-btn" data-v="cancel">Cancel</button><button type="submit" class="as-btn pri" id="as-go">Change password</button></div></form>',
    function (box, close) {
      var err = box.querySelector('#as-err'), go = box.querySelector('#as-go');
      wirePwToggles(box);
      setTimeout(function () { box.querySelector('#as-cur').focus(); }, 0);
      box.querySelector('#as-form').addEventListener('submit', function (e) {
        e.preventDefault(); err.hidden = true;
        var next = box.querySelector('#as-new').value;
        if (next.length < 10) { err.hidden = false; err.textContent = 'Use at least 10 characters.'; return; }
        go.disabled = true;
        post('/api/auth/password', { current: box.querySelector('#as-cur').value, next: next }).then(function () {
          box.querySelector('#as-ok').hidden = false; setTimeout(function () { close('ok'); }, 900);
        }, function (x) { err.hidden = false; err.textContent = x.message; go.disabled = false; });
      });
    });
  }
  function deleteAccount() {
    return dialog('<h2>Delete account?</h2><p>This deletes your account and everything synced to the cloud (all apps). The data in this browser stays here. This cannot be undone.</p><form id="as-form" novalidate>' +
      pwField('as-cur', 'Your password', 'current-password') +
      '<div id="as-err" class="as-err" role="alert" hidden></div>' +
      '<div class="as-row"><button type="button" class="as-btn" data-v="cancel">Cancel</button><button type="submit" class="as-btn pri" id="as-go" style="background:#B42318;border-color:#B42318;color:#fff">Delete account</button></div></form>',
    function (box, close) {
      var err = box.querySelector('#as-err'), go = box.querySelector('#as-go');
      wirePwToggles(box);
      setTimeout(function () { box.querySelector('#as-cur').focus(); }, 0);
      box.querySelector('#as-form').addEventListener('submit', function (e) {
        e.preventDefault(); err.hidden = true; go.disabled = true;
        post('/api/auth/delete', { password: box.querySelector('#as-cur').value }).then(function () {
          controllers.forEach(function (c) { c._forget(); });
          auth.user = null; emit(); renderShell(); close('ok');
        }, function (x) { err.hidden = false; err.textContent = x.message; go.disabled = false; });
      });
    });
  }
  function accountMenu() {
    var rows = controllers.map(function (c) { return '<li style="margin:4px 0">' + esc(c.opts.label || c.opts.app) + ': <b style="font-weight:500">' + esc(c.describe()) + '</b></li>'; }).join('');
    return dialog('<h2>' + esc(auth.user.name || auth.user.email) + '</h2><p>' + esc(auth.user.email) + '</p>' +
      (rows ? '<ul style="margin:0 0 6px;padding-left:18px;font-size:14px">' + rows + '</ul>' : '') +
      (auth.user.viewer ? '<p class="as-note" style="margin:10px 0 0">View only: you see the owner’s copy of the demo apps. Nothing you change here is saved to the cloud.</p>'
        : viaAccess() ? '<p class="as-note" style="margin:10px 0 0">' + (controllers.length ? 'This app’s data is kept in your private cloud copy, so it is the same on your phone and your computer.' : 'This app keeps no data of its own. Apps that do keep it in your private cloud copy, so it is the same on your phone and your computer.') + '</p>'
        : '<div class="as-row" style="justify-content:flex-start"><button class="as-btn" data-v="pw">Change password</button><button class="as-btn" data-v="del">Delete account…</button></div>') +
      '<div class="as-row"><button class="as-btn" data-v="out">Sign out</button>' + (controllers.length ? '<button class="as-btn" data-v="sync">Sync now</button>' : '') + '<button class="as-btn pri" data-v="close" autofocus>Close</button></div>')
      .then(function (v) {
        if (v === 'out') return signOut();
        if (v === 'pw') return changePassword();
        if (v === 'del') return deleteAccount();
        if (v === 'sync') controllers.forEach(function (c) { c.syncNow(); });
      });
  }

  // ── per-app controller ────────────────────────────────────────────────────
  function asJson(r) { return r.json().catch(function () { return {}; }).then(function (j) { j = j && typeof j === 'object' ? j : {}; j._status = r.status; return j; }); }
  /** A raw snapshot answer (Cloudflare): the data as the body, its generation and time in the headers. */
  function snapshotOf(r) {
    if (!r.ok) return asJson(r);
    return r.json().then(function (data) {
      return { data: data, generation: Number(r.headers.get('X-Sync-Generation')) || 0, updatedAt: r.headers.get('X-Sync-Updated-At') || null, _status: 200 };
    });
  }
  function api(app, method, body, query) {
    if (viaAccess() && method === 'PUT') // raw snapshot, generation in the query
      return req('/api/sync/' + app + '?base=' + encodeURIComponent(String(body.baseGeneration == null ? '0' : body.baseGeneration)),
        { method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/json' }, H), body: JSON.stringify(body.data) }).then(asJson);
    if (viaAccess() && method === 'GET' && !query) // raw snapshot back, generation in the headers
      return req('/api/sync/' + app).then(snapshotOf);
    return req('/api/sync/' + app + (query || ''), { method: method, headers: Object.assign(body ? { 'Content-Type': 'application/json' } : {}, H), body: body ? JSON.stringify(body) : undefined })
      .then(asJson);
  }
  function sha256(blob) { return blob.arrayBuffer().then(function (b) { return crypto.subtle.digest('SHA-256', b); }).then(function (d) { return Array.prototype.map.call(new Uint8Array(d), function (x) { return ('0' + x.toString(16)).slice(-2); }).join(''); }); }
  function when(iso) { if (!iso) return 'unknown time'; var d = new Date(iso); return isNaN(d) ? String(iso) : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); }
  function size(n) { n = Number(n) || 0; return n < 1024 ? n + ' B' : n < 1048576 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(1) + ' MB'; }
  function stamp() { var d = new Date(), p = function (x) { return ('0' + x).slice(-2); }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()); }
  /** Saves each { name, data } as a JSON file (Blob link), one after the other. */
  function downloadJson(items) {
    items.forEach(function (it, i) {
      setTimeout(function () {
        var url = URL.createObjectURL(new Blob([JSON.stringify(it.data, null, 2)], { type: 'application/json' }));
        var a = document.createElement('a');
        a.href = url; a.download = it.name; a.style.display = 'none';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
      }, i * 400);
    });
  }
  /** "These would be lost" block for a choice that is turned off; '' when nothing is lost. */
  function lossBlock(choice, items) {
    if (!items || !items.length) return '';
    return '<div class="as-err as-loss" role="note"><b>' + esc(choice) + '</b> is turned off. These would be lost:<ul>' +
      items.slice(0, 10).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') +
      (items.length > 10 ? '<li>and ' + (items.length - 10) + ' more</li>' : '') + '</ul></div>';
  }
  var DL_NOTE = '<p class="as-note" style="margin:12px 0 0">Download both copies to keep everything. Nothing is replaced until you choose.</p>';

  function attach(opts) {
    var ANON = 'stratum-sync:' + opts.app + ':'; // where a change is marked while the account is not known
    var metaKey = function () { return ANON + (auth.user ? auth.user.email : ''); };
    function readKey(k) { try { var v = JSON.parse(localStorage.getItem(k) || '{}'); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; } }
    function meta() { return readKey(metaKey()); }
    function saveMeta(m) { try { localStorage.setItem(metaKey(), JSON.stringify(m)); } catch (e) {} }
    function rev() { return Number(meta().rev) || 0; }
    function viewer() { return !!(auth.user && auth.user.viewer); }
    // a change marked before the account was known (offline at load, sign-in expired) now counts for the account
    function adoptAnon() {
      if (!auth.user) return;
      var a = readKey(ANON);
      if (!a.dirty && !a.rev) return;
      var m = meta(); m.dirty = true; m.rev = (Number(m.rev) || 0) + (Number(a.rev) || 1); saveMeta(m);
      try { localStorage.removeItem(ANON); } catch (e) {}
    }
    function isEmpty() { return Promise.resolve().then(function () { return opts.isEmpty ? opts.isEmpty() : false; }).catch(function () { return false; }); }
    /** describeLoss(from, to) → [lines]; an error counts as a loss, so a choice is never offered blind. */
    function lossOf(from, to) {
      if (!opts.describeLoss) return Promise.resolve([]);
      return Promise.resolve().then(function () { return opts.describeLoss(from, to); }).then(function (x) {
        if (Array.isArray(x)) return x.map(function (s) { return String(s); }).filter(Boolean);
        return x ? [String(x)] : [];
      }, function (e) { return ['Could not check what would be lost (' + ((e && e.message) || e) + ')']; });
    }
    function fetchCloud() {
      return api(opts.app, 'GET').then(function (r) {
        if (r._status !== 200) throw new Error(r.error || 'Download failed (' + r._status + ')');
        return r;
      });
    }

    var timer = null, running = null, subs = [], dialogOpen = false, dialogWaiters = [], ownerCopy = false;
    var c = {
      opts: opts,
      state: { status: 'off', message: '', syncedAt: null },
      on: function (fn) { subs.push(fn); fn(c.state); return function () { subs = subs.filter(function (f) { return f !== fn; }); }; },
      describe: function () {
        var s = c.state;
        return { off: 'not available', 'signed-out': 'signed out', idle: 'nothing to sync yet', syncing: 'syncing…', synced: 'synced ' + ago(s.syncedAt), error: 'error: ' + s.message, conflict: 'changed in two places', choose: 'choose what to keep',
          offline: 'offline: changes are kept here and sync later', expired: 'sign-in expired: not syncing', 'view-only': 'view only' + (s.message ? ' · ' + s.message : '') }[s.status] || s.status;
      },
      _forget: function () { try { localStorage.removeItem(metaKey()); } catch (e) {} },
      _authChanged: function () {
        if (!auth.loaded) return;
        if (!auth.user) return set(auth.expired ? 'expired' : auth.unreachable ? 'offline' : auth.enabled ? 'signed-out' : 'off', auth.expired ? MSG.expired : auth.unreachable ? MSG.offline : '');
        adoptAnon();
        if (auth.expired) return set('expired', MSG.expired);
        c.syncNow();
      },
      _retry: function () { if (auth.user && !auth.expired && !dialogOpen && (c.state.status === 'offline' || c.state.status === 'error' || meta().dirty)) c.syncNow(); },
      changed: function () {
        var m = meta(); m.dirty = true; m.rev = (Number(m.rev) || 0) + 1; saveMeta(m);
        if (!auth.user || auth.expired) return;
        clearTimeout(timer); timer = setTimeout(function () { timer = null; c.syncNow(); }, 2500);
      },
      syncNow: function () {
        if (!auth.user || auth.expired) return Promise.resolve();
        if (running) { running.again = true; return running.p; }
        return startJob(run);
      },
      ensureFresh: function () { return ensureFresh(); },
      fetchFile: function (hash) {
        return req('/api/sync/' + opts.app + '/files/' + hash).then(function (r) {
          if (!r.ok) throw new Error('File not in the cloud');
          return r.blob();
        }).then(function (b) { return (opts.files && opts.files.put ? Promise.resolve(opts.files.put(hash, b, b.type)) : Promise.resolve()).then(function () { return b; }); });
      },
      mountPanel: function (el) {
        if (PUBLIC) { el.innerHTML = ''; el.hidden = true; return function () {}; } // public demo: no sync panel
        function btn(a, label, pri) { return '<button type="button" class="as-btn' + (pri ? ' pri' : '') + '" data-a="' + a + '">' + label + '</button>'; }
        function draw() {
          var s = c.state, u = auth.user, st = s.status, line, acts = '';
          if (st === 'off') line = 'not set up on this server — data stays in this browser';
          else if (st === 'expired') { line = 'your sign-in has expired — changes stay in this browser and sync after you sign in again'; acts = btn('reauth', 'Sign in again', true); }
          else if (!u && st === 'offline') { line = 'can’t reach the cloud — changes stay in this browser and sync when the connection is back'; acts = btn('retry', 'Try again'); }
          else if (!u) { line = 'sign in to keep this data in sync across your devices'; acts = btn('in', 'Sign in', true); }
          else if (u.viewer) {
            line = '<span class="as-pill">View only</span>' + esc(u.email) + ' · ' + esc(st === 'view-only' ? (s.message || 'the owner’s copy') : c.describe()) + ' · nothing is uploaded';
            acts = btn('sync', 'Refresh') + (ownerCopy ? btn('load', 'Use the owner’s copy') : '') + btn('out', 'Sign out');
          } else {
            line = esc(u.email) + ' · ' + esc(c.describe());
            acts = btn('sync', 'Sync now') + (viaAccess() ? btn('restore', 'Restore an earlier version…') : '') + btn('out', 'Sign out');
          }
          el.innerHTML = '<div class="as-card" data-s="' + esc(st) + '"><div class="as-txt"><span class="as-dot"></span><b>Cloud sync</b> · ' + line + '</div>' +
            (acts ? '<div class="as-acts">' + acts + '</div>' : '') + '</div>';
        }
        el.onclick = function (e) {
          var b = e.target.closest('[data-a]'); if (!b) return;
          var a = b.getAttribute('data-a');
          if (a === 'in') signIn(); else if (a === 'out') signOut(); else if (a === 'reauth') reauth(); else if (a === 'retry') checkAuth();
          else if (a === 'restore') exclusive(restoreFlow); else if (a === 'load') exclusive(loadOwnerCopy); else c.syncNow();
        };
        var off1 = c.on(draw), off2 = StratumSync.on(draw);
        return function () { off1(); off2(); };
      }
    };
    function set(status, message) {
      c.state = { status: status, message: message || '', syncedAt: meta().syncedAt || null };
      subs.forEach(function (fn) { try { fn(c.state); } catch (e) { console.error(e); } });
      renderShell();
    }
    function synced() { if (viewer()) set('view-only', 'up to date'); else set('synced'); }

    // ── jobs: one at a time; a sync asked for meanwhile runs right after ──
    function startJob(fn) {
      var job = { again: false };
      job.p = Promise.resolve().then(fn).catch(failed).then(function () { running = null; if (job.again) return c.syncNow(); });
      running = job;
      return job.p;
    }
    function whenIdle() { return running ? running.p.then(whenIdle, whenIdle) : Promise.resolve(); }
    function exclusive(fn) { return whenIdle().then(function () { return running ? exclusive(fn) : startJob(fn); }); }
    function again() { if (running) running.again = true; else setTimeout(function () { c.syncNow(); }, 0); }
    function failed(e) {
      if (e && e.kind === 'expired') { if (!auth.expired) { auth.expired = true; emit(); renderShell(); } return set('expired', MSG.expired); }
      if (e && e.kind === 'offline') return set('offline', MSG.offline);
      set('error', (e && e.message) || String(e));
    }
    // a dialog that asks which copy to keep: ensureFresh answers 'conflict' as soon as it is open
    function choiceDialog(html, wire) {
      dialogOpen = true;
      var ws = dialogWaiters; dialogWaiters = []; ws.forEach(function (f) { f(); });
      return dialog(html, wire).then(function (v) { dialogOpen = false; return v; });
    }
    function raceDialog(p) {
      if (dialogOpen) return Promise.resolve();
      return new Promise(function (res) {
        var w = function () { res(); };
        dialogWaiters.push(w);
        Promise.resolve(p).then(function () { dialogWaiters = dialogWaiters.filter(function (f) { return f !== w; }); res(); });
      });
    }
    function settle() { return !running || dialogOpen ? Promise.resolve() : raceDialog(running.p).then(settle); }

    function uploadFiles() {
      if (!opts.files || !opts.files.list) return Promise.resolve();
      var done = meta().files || {};
      return Promise.resolve(opts.files.list()).then(function (list) {
        return list.reduce(function (p, f) {
          return p.then(function () {
            if (done[f.hash]) return;
            return req('/api/sync/' + opts.app + '/files/' + f.hash, { method: 'HEAD' }).then(function (r) {
              if (r.ok) return;
              return Promise.resolve(f.getBlob()).then(function (blob) {
                return req('/api/sync/' + opts.app + '/files/' + f.hash, { method: 'PUT', headers: Object.assign({ 'Content-Type': f.type || blob.type || 'application/octet-stream' }, H), body: blob })
                  .then(function (r2) { if (!r2.ok) throw new Error('Uploading a file failed (' + r2.status + ')'); });
              });
            }).then(function () { done[f.hash] = 1; var mm = meta(); mm.files = done; saveMeta(mm); });
          });
        }, Promise.resolve());
      });
    }
    /** Uploads this browser's data over cloud generation `base`. pre = { data, rev }: upload exactly that snapshot. */
    function push(base, pre) {
      if (viewer()) return set('view-only', 'nothing is uploaded'); // never, whatever asked for it
      set('syncing');
      var at;
      return uploadFiles().then(function () {
        if (pre) { at = pre.rev; return pre.data; }
        at = rev(); return opts.getSnapshot(); // the change number this snapshot contains
      }).then(function (data) {
        return api(opts.app, 'PUT', { data: data, baseGeneration: base });
      }).then(function (r) {
        if (r._status === 409) return decide('conflict', r);
        if (r._status !== 200) throw new Error(r.error || 'Upload failed (' + r._status + ')');
        var m = meta(), same = (Number(m.rev) || 0) === at;
        m.generation = r.generation; m.syncedAt = r.updatedAt;
        if (same) m.dirty = false; // otherwise a change came in during the upload: it stays marked and goes up next
        saveMeta(m);
        if (same) set('synced'); else { set('syncing'); again(); }
      });
    }
    /** Replaces this browser's data with `cloud` (or the cloud copy fetched now). at: the change number the decision was
     * made on; if this browser changed since, nothing is replaced and the sync looks again (and asks). */
    function pull(cloud, at) {
      set('syncing');
      return (cloud ? Promise.resolve(cloud) : fetchCloud()).then(function (r) {
        if (at !== undefined && rev() !== at) { again(); return; }
        return Promise.resolve(opts.applySnapshot(r.data)).then(function () {
          var m = meta(); m.generation = r.generation; m.syncedAt = r.updatedAt; m.dirty = false; saveMeta(m); synced();
        });
      });
    }
    /** A newer cloud copy and no changes here: take it, unless it lacks something this browser has (then ask). */
    function autoPull(r) {
      var at = rev();
      if (!opts.describeLoss) return pull(null, at);
      return fetchCloud().then(function (cloud) {
        return Promise.resolve(opts.getSnapshot()).then(function (local) {
          return lossOf(local, cloud.data).then(function (lost) {
            if (!lost.length) return pull(cloud, at);
            if (viewer()) { ownerCopy = true; return set('view-only', 'the owner’s copy is not loaded: it lacks something this browser has'); }
            return decide('loss', cloud, { cloud: cloud, local: local, rev: at, lossCloud: lost });
          });
        });
      });
    }
    /** Asks which copy to keep. kind: 'choose' (first sync here), 'conflict' (changed in two places), 'loss' (the newer
     * cloud copy lacks something). With describeLoss, a choice that loses something is turned off. */
    function decide(kind, r, pre) {
      if (viewer()) return set('view-only', 'your changes here stay in this browser');
      var waiting = kind === 'choose' ? 'choose' : 'conflict';
      set(waiting);
      var prep;
      if (!opts.describeLoss) prep = Promise.resolve({ rev: rev(), lossCloud: [], lossMine: [] });
      else if (pre) prep = lossOf(pre.cloud.data, pre.local).then(function (lm) { pre.lossMine = lm; return pre; });
      else {
        var at = rev();
        prep = fetchCloud().then(function (cloud) {
          return Promise.resolve(opts.getSnapshot()).then(function (local) {
            return Promise.all([lossOf(local, cloud.data), lossOf(cloud.data, local)]).then(function (x) { return { cloud: cloud, local: local, rev: at, lossCloud: x[0], lossMine: x[1] }; });
          });
        });
      }
      return prep.then(function (p) {
        var cm = p.cloud || r, L = esc(opts.label || opts.app);
        var mineLabel = kind === 'choose' ? 'Replace the cloud copy' : 'Keep this browser’s', cloudLabel = 'Use the cloud copy';
        var lossy = p.lossCloud.length || p.lossMine.length;
        var bCloud = '<button class="as-btn' + (kind === 'choose' ? ' pri' : '') + '" data-v="cloud"' + (p.lossCloud.length ? ' disabled' : '') + '>' + cloudLabel + '</button>';
        var bMine = '<button class="as-btn' + (kind === 'choose' ? '' : ' pri') + '" data-v="mine"' + (p.lossMine.length ? ' disabled' : '') + '>' + mineLabel + '</button>';
        var head = kind === 'choose'
          ? '<h2>' + L + ' is already in the cloud</h2><p>Saved from another device ' + esc(ago(cm.updatedAt)) + '. Continue with the cloud copy here (this browser’s data is replaced), or replace the cloud copy with this browser’s data? Choose the one that has the changes you want to keep.</p>'
          : kind === 'loss'
            ? '<h2>' + L + ': the cloud copy is missing something</h2><p>The cloud copy was updated on another device (' + esc(ago(cm.updatedAt)) + '), but it lacks something this browser has, so it was not loaded. Which one do you want to keep? The other is replaced.</p>'
            : '<h2>' + L + ' changed in two places</h2><p>The cloud copy was updated on another device (' + esc(ago(cm.updatedAt)) + '), and this browser also has changes that are not synced. Which one do you want to keep? The other is replaced.</p>';
        var html = head + lossBlock(cloudLabel, p.lossCloud) + lossBlock(mineLabel, p.lossMine) + (lossy ? DL_NOTE : '') +
          '<div class="as-row"><button class="as-btn" data-v="later">Decide later</button>' + (lossy ? '<button class="as-btn" data-dl="1">Download both copies</button>' : '') +
          (kind === 'choose' ? bMine + bCloud : bCloud + bMine) + '</div>';
        return choiceDialog(html, function (box) {
          var dl = box.querySelector('[data-dl]');
          if (dl) dl.addEventListener('click', function () {
            downloadJson([{ name: opts.app + '-this-browser-' + stamp() + '.json', data: p.local }, { name: opts.app + '-cloud-copy-' + stamp() + '.json', data: p.cloud.data }]);
          });
        }).then(function (v) {
          if (v === 'cloud' && !p.lossCloud.length) return pull(p.cloud || null, p.rev);
          if (v === 'mine' && !p.lossMine.length) return push(cm.generation, p.local !== undefined ? { data: p.local, rev: p.rev } : null);
          set(waiting, kind === 'choose' ? 'not decided' : 'unresolved');
        });
      });
    }
    function run() {
      set('syncing');
      var m = meta();
      return api(opts.app, 'GET', null, '?meta=1').then(function (r) {
        if (r._status === 401) { auth.user = null; emit(); renderShell(); return; } // signed out (Node server)
        if (viewer()) return viewerRun(m, r);
        if (r._status !== 200) throw new Error(r.error || 'Sync unavailable (' + r._status + ')');
        if (!r.exists) {                                                        // first upload from this person
          // an empty browser uploads nothing, so it can never stand in for real data on another device
          return isEmpty().then(function (empty) { return empty ? set('idle') : push('0'); });
        }
        if (!m.generation) {                                                    // first sync on this device, cloud has data
          // nothing of the person's own here yet (opts.isEmpty): just take the cloud copy
          return isEmpty().then(function (empty) { return empty ? autoPull(r) : decide('choose', r); });
        }
        if (String(m.generation) === String(r.generation)) return m.dirty ? push(m.generation) : set('synced');
        return m.dirty ? decide('conflict', r) : autoPull(r);                   // cloud changed elsewhere
      });
    }
    // View only: the owner's copy is shown when nothing of this browser's own would be replaced; nothing goes up.
    function viewerRun(m, r) {
      ownerCopy = false;
      if (r._status === 403) return set('view-only', 'this app is not shared with you; its data stays in this browser');
      if (r._status !== 200) throw new Error(r.error || 'Sync unavailable (' + r._status + ')');
      if (!r.exists) return set('view-only', 'nothing in the cloud yet');
      if (m.generation && String(m.generation) === String(r.generation)) return set('view-only', m.dirty ? 'your changes here stay in this browser' : 'up to date');
      ownerCopy = true;
      if (m.dirty) return set('view-only', 'your changes here stay in this browser; the owner’s newer copy is not loaded');
      return (m.generation ? Promise.resolve(true) : isEmpty()).then(function (ok) {
        if (!ok) return set('view-only', 'this browser’s own data is shown');
        ownerCopy = false;
        return autoPull(r);
      });
    }
    // View only, from the panel: replace this browser's data with the owner's copy (asks first).
    function loadOwnerCopy() {
      if (!viewer()) return;
      var at = rev();
      return fetchCloud().then(function (cloud) {
        return Promise.resolve(opts.getSnapshot()).then(function (local) {
          return lossOf(local, cloud.data).then(function (lost) {
            return dialog('<h2>Use the owner’s copy?</h2><p>This browser’s ' + esc(opts.label || opts.app) + ' data is replaced by the owner’s copy (saved ' + esc(ago(cloud.updatedAt)) + '). Nothing is uploaded.</p>' +
              lossBlock('Use the owner’s copy', lost) + (lost.length ? DL_NOTE : '') +
              '<div class="as-row"><button class="as-btn" data-v="later">Cancel</button>' + (lost.length ? '<button class="as-btn" data-dl="1">Download both copies</button>' : '') +
              '<button class="as-btn pri" data-v="use"' + (lost.length ? ' disabled' : '') + '>Use the owner’s copy</button></div>', function (box) {
              var dl = box.querySelector('[data-dl]');
              if (dl) dl.addEventListener('click', function () { downloadJson([{ name: opts.app + '-this-browser-' + stamp() + '.json', data: local }, { name: opts.app + '-owner-copy-' + stamp() + '.json', data: cloud.data }]); });
            }).then(function (v) { if (v === 'use' && !lost.length) { ownerCopy = false; return pull(cloud, at); } });
          });
        });
      });
    }
    // ── version history (Cloudflare): restore one of the 30 kept copies here and as the new cloud copy ──
    function restoreFlow() {
      if (!auth.user || viewer() || auth.expired) return;
      var L = esc(opts.label || opts.app);
      return req('/api/sync/' + opts.app + '/versions').then(function (r) {
        return r.json().catch(function () { return null; }).then(function (j) { if (!r.ok || !Array.isArray(j)) throw new Error((j && j.error) || 'Could not load the earlier versions (' + r.status + ')'); return j; });
      }).then(function (list) {
        if (!list.length) return dialog('<h2>Restore an earlier version</h2><p>There are no earlier versions of ' + L + ' in the cloud yet. From now on, every sync keeps the copy it replaces (the last 30).</p><div class="as-row"><button class="as-btn pri" data-v="ok">OK</button></div>');
        return dialog('<h2>Restore an earlier version</h2><p>The cloud keeps the last ' + list.length + ' copies of ' + L + ' before the current one. Choose one to see what restoring it would replace.</p><ul class="as-list">' +
          list.map(function (v) { return '<li><button type="button" class="as-ver" data-v="v:' + esc(v.generation) + '"><span>' + esc(when(v.updatedAt)) + '</span><span class="as-note">' + esc(size(v.size)) + ' · version ' + esc(v.generation) + '</span></button></li>'; }).join('') +
          '</ul><div class="as-row"><button class="as-btn" data-v="later">Cancel</button></div>').then(function (v) {
          if (!v || v.indexOf('v:') !== 0) return;
          var gen = v.slice(2), info = list.filter(function (x) { return String(x.generation) === gen; })[0] || {};
          return req('/api/sync/' + opts.app + '/versions/' + encodeURIComponent(gen)).then(snapshotOf).then(function (ver) {
            if (ver._status !== 200) throw new Error(ver.error || 'Could not load that version (' + ver._status + ')');
            var at = rev();
            return Promise.resolve(opts.getSnapshot()).then(function (local) {
              return lossOf(local, ver.data).then(function (lost) {
                return dialog('<h2>Restore the copy from ' + esc(when(info.updatedAt || ver.updatedAt)) + '?</h2><p>' + L + ' in this browser and the cloud copy are replaced by this version. The current cloud copy is kept in the history, so you can go back to it.</p>' +
                  lossBlock('Restore this version', lost) + (lost.length ? DL_NOTE : '') +
                  '<div class="as-row"><button class="as-btn" data-v="later">Cancel</button>' + (lost.length ? '<button class="as-btn" data-dl="1">Download both copies</button>' : '') +
                  '<button class="as-btn pri" data-v="restore"' + (lost.length ? ' disabled' : '') + '>Restore this version</button></div>', function (box) {
                  var dl = box.querySelector('[data-dl]');
                  if (dl) dl.addEventListener('click', function () { downloadJson([{ name: opts.app + '-this-browser-' + stamp() + '.json', data: local }, { name: opts.app + '-version-' + gen + '.json', data: ver.data }]); });
                }).then(function (choice) {
                  if (choice !== 'restore' || lost.length) return;
                  if (rev() !== at) return dialog('<h2>Not restored</h2><p>' + L + ' changed in this browser while you were choosing, so nothing was replaced. Try again.</p><div class="as-row"><button class="as-btn pri" data-v="ok">OK</button></div>');
                  return api(opts.app, 'GET', null, '?meta=1').then(function (cur) {
                    if (cur._status !== 200) throw new Error(cur.error || 'Sync unavailable (' + cur._status + ')');
                    var base = cur.exists ? cur.generation : 0;
                    set('syncing');
                    return Promise.resolve(opts.applySnapshot(ver.data)).then(function () {
                      // the restored data is a local change over the current cloud copy: it goes up as the new version
                      var m = meta(); m.generation = base; m.dirty = true; m.rev = (Number(m.rev) || 0) + 1; saveMeta(m);
                      return push(String(base));
                    });
                  });
                });
              });
            });
          });
        });
      });
    }
    // ── ensureFresh: sync now and report; used before something that must see the other devices' latest data ──
    function ensureFresh() {
      return ready.then(function () { return auth.unreachable || auth.expired ? checkAuth() : null; }).then(settle).then(function () {
        if (dialogOpen) return { status: 'conflict' };
        if (auth.expired) return { status: 'offline', message: MSG.expired };
        if (!auth.user) return auth.unreachable ? { status: 'offline', message: MSG.offline } : { status: 'off' };
        if (viewer()) return { status: 'off' };
        var tries = 0;
        function attempt() {
          return raceDialog(c.syncNow()).then(settle).then(function () {
            var st = c.state.status;
            if (dialogOpen || st === 'conflict' || st === 'choose') return { status: 'conflict' };
            if (st === 'expired' || auth.expired) return { status: 'offline', message: MSG.expired };
            if (st === 'idle') return { status: 'fresh' };
            if (st === 'synced') {
              if (!meta().dirty) return { status: 'fresh' };
              if (++tries < 3) return attempt();
            }
            if (st === 'off' || st === 'signed-out' || st === 'view-only') return { status: 'off' };
            return { status: 'offline', message: c.state.message || MSG.offline };
          });
        }
        return attempt();
      });
    }
    controllers.push(c);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && auth.user && !auth.expired && c.state.status !== 'choose' && c.state.status !== 'conflict') c.syncNow(); });
    window.addEventListener('pagehide', function () { if (timer && auth.user && !auth.expired) { clearTimeout(timer); c.syncNow(); } });
    ready.then(function () { c._authChanged(); });
    return c;
  }

  window.StratumSync = {
    ready: ready, attach: attach, signIn: signIn, signOut: signOut, changePassword: changePassword, sha256: sha256,
    user: function () { return auth.user; }, enabled: function () { return auth.enabled; },
    on: function (fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (f) { return f !== fn; }); }; }
  };
})();
