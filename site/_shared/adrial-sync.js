/* Adrial Apps cloud sync (browser side). Server side: C:\hub\sync.js.
 *
 *   <script src="/_shared/adrial-sync.js"></script>      →  window.AdrialSync
 *
 * Accounts: anyone creates one with their e-mail and a password (no Microsoft/Google setup).
 * Each person's data per app is stored privately in Cloud Storage; this file decides when to
 * upload, download or ask. Apps only describe their data:
 *
 *   const sync = AdrialSync.attach({
 *     app: 'erp',                                   // 'erp' | 'crm' | 'mail' | 'invoices' | 'desk' | 'parcels' | 'recon' | 'stores' | 'onboarding' | 'contracts' | 'marketing' | 'tasks'
 *     label: 'ERP data',
 *     getSnapshot: async () => wholeStateObject,    // JSON-serialisable, no Blobs
 *     applySnapshot: async (data) => {...},         // replace local state with data (from cloud) and re-render
 *     files: {                                      // optional, for binary files (e.g. invoice PDFs/photos)
 *       list: async () => [{ hash, type, getBlob: async () => Blob }],   // hash = sha256 hex of the bytes
 *       has: async (hash) => bool,                  // is this file stored locally?
 *       put: async (hash, blob, type) => {...}      // store a downloaded file locally
 *     }
 *   });
 *   sync.changed();          // call after every local save (debounced upload)
 *   sync.syncNow();          // manual "Sync now"
 *   sync.fetchFile(hash)     // → Blob from the cloud (also stored locally via files.put)
 *   sync.mountPanel(el)      // standard status card ("Signed in as … · last synced … · Sync now")
 *   sync.on(fn)              // fn(state) whenever status changes; state.status in
 *                            //   'off' | 'signed-out' | 'idle' | 'syncing' | 'synced' | 'error' | 'conflict' | 'choose'
 *
 * Rules: the first time a browser signs in for an app and both sides have data, the person chooses
 * (use cloud / upload this browser / not now). Afterwards uploads use the last known cloud version
 * as a precondition; if the cloud changed elsewhere, clean local data simply takes the cloud copy,
 * and local unsaved changes ask (keep this browser / take cloud). Nothing is ever merged silently.
 */
(function () {
  'use strict';
  if (window.AdrialSync) return;

  var H = { 'X-Adrial-Apps': '1' };
  var auth = { enabled: false, devLogin: false, signupDomains: [], user: null, loaded: false };
  var listeners = [], controllers = [];
  var ready = fetch('/api/auth/config', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : { enabled: false }; }).catch(function () { return { enabled: false }; })
    .then(function (c) {
      auth.enabled = !!c.enabled; auth.devLogin = !!c.devLogin; auth.signupDomains = c.signupDomains || [];
      if (!auth.enabled) return null;
      return fetch('/api/auth/me', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    })
    .then(function (u) { auth.user = u; auth.loaded = true; emit(); renderShell(); return auth; });

  function emit() { listeners.forEach(function (fn) { try { fn(auth); } catch (e) { console.error(e); } }); controllers.forEach(function (c) { c._authChanged(); }); }
  function initials(u) { var n = (u && (u.name || u.email) || '?').replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean); return ((n[0] || '?')[0] + (n[1] ? n[1][0] : '')).toUpperCase(); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function ago(iso) { if (!iso) return 'never'; var s = (Date.now() - new Date(iso)) / 1000; if (s < 60) return 'just now'; if (s < 3600) return Math.round(s / 60) + ' min ago'; if (s < 86400) return Math.round(s / 3600) + ' h ago'; return new Date(iso).toLocaleDateString(); }

  // ── shell account button ─────────────────────────────────────────────────
  function worstState() {
    var st = controllers.map(function (c) { return c.state.status; });
    if (st.indexOf('conflict') >= 0 || st.indexOf('choose') >= 0 || st.indexOf('error') >= 0) return 'warn';
    if (st.indexOf('syncing') >= 0) return 'busy';
    return 'ok';
  }
  function renderShell() {
    if (!window.AdrialShell || !window.AdrialShell.setAccount) return setTimeout(renderShell, 200);
    if (!auth.loaded) return;
    if (!auth.enabled) return window.AdrialShell.setAccount(null);
    if (!auth.user) return window.AdrialShell.setAccount({ label: 'Sign in', title: 'Sign in to sync your data across devices', state: 'off', onClick: signIn });
    window.AdrialShell.setAccount({ initials: initials(auth.user), label: '', title: auth.user.email + ' · cloud sync ' + ({ ok: 'up to date', busy: 'syncing…', warn: 'needs attention' })[worstState()], state: worstState(), onClick: accountMenu });
  }

  // ── small dialog helper (own styles, follows light/dark) ─────────────────
  var css = document.createElement('style');
  css.textContent =
    '.as-scrim{position:fixed;inset:0;z-index:2147483100;background:rgba(12,12,13,.38);display:flex;align-items:center;justify-content:center;padding:16px}' +
    '.as-box{width:min(440px,100%);max-height:calc(100vh - 32px);overflow:auto;background:#fff;color:#0C0C0D;border-radius:20px;box-shadow:0 50px 110px -40px rgba(12,12,13,.5);font:15px/1.5 Geist,ui-sans-serif,system-ui,sans-serif;padding:22px}' +
    'html[data-adrial-mode="dark"] .as-box{background:#161618;color:#F4F3EF}' +
    '.as-box h2{margin:0 0 6px;font-size:20px;font-weight:500;letter-spacing:-.02em}' +
    '.as-box p{margin:0 0 14px;color:#55544F;font-size:14px}html[data-adrial-mode="dark"] .as-box p{color:#BAB7AF}' +
    '.as-row{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;margin-top:16px}' +
    '.as-btn{display:inline-flex;align-items:center;justify-content:center;min-height:40px;padding:0 16px;border-radius:999px;border:1px solid #E0DDD6;background:transparent;color:inherit;font:500 14px Geist,system-ui,sans-serif;cursor:pointer}' +
    'html[data-adrial-mode="dark"] .as-btn{border-color:#2E2E33}' +
    '.as-btn.pri{background:#0C0C0D;border-color:#0C0C0D;color:#F4F3EF}html[data-adrial-mode="dark"] .as-btn.pri{background:#F4F3EF;border-color:#F4F3EF;color:#0C0C0D}' +
    '.as-btn:focus-visible{outline:2px solid #7B66F0;outline-offset:2px}' +
    '.as-in{width:100%;min-height:42px;box-sizing:border-box;border-radius:12px;border:1px solid #E0DDD6;padding:0 12px;font:inherit;background:transparent;color:inherit}' +
    'html[data-adrial-mode="dark"] .as-in{border-color:#2E2E33}.as-in:focus{outline:2px solid #7B66F0;outline-offset:1px}' +
    '.as-lbl{display:block;margin:12px 0 5px;font-size:13px;font-weight:500}' +
    '.as-pw{position:relative}.as-pw .as-in{padding-right:64px}.as-pw button{position:absolute;right:6px;top:50%;transform:translateY(-50%);border:0;background:transparent;color:inherit;font:500 12.5px Geist,system-ui,sans-serif;padding:6px 8px;border-radius:8px;cursor:pointer;opacity:.75}' +
    '.as-tabs{display:flex;gap:4px;padding:4px;border-radius:999px;background:#EFEDE7;margin:2px 0 14px}html[data-adrial-mode="dark"] .as-tabs{background:#232327}' +
    '.as-tabs button{flex:1;min-height:36px;border:0;border-radius:999px;background:transparent;color:inherit;font:500 14px Geist,system-ui,sans-serif;cursor:pointer;opacity:.7}' +
    '.as-tabs button[aria-selected="true"]{background:#fff;opacity:1;box-shadow:0 1px 3px rgba(12,12,13,.12)}html[data-adrial-mode="dark"] .as-tabs button[aria-selected="true"]{background:#0C0C0D}' +
    '.as-ok{margin:10px 0 0;padding:10px 12px;border-radius:12px;background:#E1EEE5;color:#2F5E43;font-size:13.5px}' +
    '.as-err{margin:10px 0 0;padding:10px 12px;border-radius:12px;background:#F6E3D6;color:#9A3412;font-size:13.5px}' +
    '.as-note{font:12px/1.5 "Geist Mono",ui-monospace,monospace;color:#6B6964}' +
    '.as-menu .as-btn{width:100%;justify-content:flex-start}' +
    '.as-card{display:flex;flex-wrap:wrap;gap:10px 14px;align-items:center;justify-content:space-between;padding:12px 14px;border:1px solid var(--line,#E0DDD6);border-radius:14px;font-size:13.5px}' +
    '.as-card b{font-weight:500}.as-card .as-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;background:#8F8C85}' +
    '.as-card[data-s="synced"] .as-dot{background:#3F7D58}.as-card[data-s="syncing"] .as-dot{background:#3E5BA9}.as-card[data-s="error"] .as-dot,.as-card[data-s="conflict"] .as-dot,.as-card[data-s="choose"] .as-dot{background:#C2410C}';
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
      el.addEventListener('click', function (e) { if (e.target === el) close(null); var b = e.target.closest('[data-v]'); if (b) close(b.getAttribute('data-v')); });
      if (wire) wire(el.querySelector('.as-box'), close);
      var f = el.querySelector('[autofocus], .as-btn.pri, .as-btn, input'); if (f) f.focus();
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
      if (auth.user) return accountMenu();
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
      '<div class="as-row" style="justify-content:flex-start"><button class="as-btn" data-v="pw">Change password</button><button class="as-btn" data-v="del">Delete account…</button></div>' +
      '<div class="as-row"><button class="as-btn" data-v="out">Sign out</button>' + (controllers.length ? '<button class="as-btn" data-v="sync">Sync now</button>' : '') + '<button class="as-btn pri" data-v="close">Close</button></div>')
      .then(function (v) {
        if (v === 'out') return signOut();
        if (v === 'pw') return changePassword();
        if (v === 'del') return deleteAccount();
        if (v === 'sync') controllers.forEach(function (c) { c.syncNow(); });
      });
  }

  // ── per-app controller ────────────────────────────────────────────────────
  function api(app, method, body, query) {
    return fetch('/api/sync/' + app + (query || ''), { method: method, credentials: 'same-origin', headers: Object.assign(body ? { 'Content-Type': 'application/json' } : {}, H), body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { j._status = r.status; return j; }); });
  }
  function sha256(blob) { return blob.arrayBuffer().then(function (b) { return crypto.subtle.digest('SHA-256', b); }).then(function (d) { return Array.prototype.map.call(new Uint8Array(d), function (x) { return ('0' + x.toString(16)).slice(-2); }).join(''); }); }

  function attach(opts) {
    var metaKey = function () { return 'adrial-sync:' + opts.app + ':' + (auth.user ? auth.user.email : ''); };
    function meta() { try { return JSON.parse(localStorage.getItem(metaKey()) || '{}'); } catch (e) { return {}; } }
    function saveMeta(m) { try { localStorage.setItem(metaKey(), JSON.stringify(m)); } catch (e) {} }
    var timer = null, running = null, subs = [];
    var c = {
      opts: opts,
      state: { status: 'off', message: '', syncedAt: null },
      on: function (fn) { subs.push(fn); fn(c.state); return function () { subs = subs.filter(function (f) { return f !== fn; }); }; },
      describe: function () {
        var s = c.state;
        return { off: 'not available', 'signed-out': 'signed out', idle: 'waiting', syncing: 'syncing…', synced: 'synced ' + ago(s.syncedAt), error: 'error: ' + s.message, conflict: 'changed in two places', choose: 'choose what to keep' }[s.status] || s.status;
      },
      _forget: function () { try { localStorage.removeItem(metaKey()); } catch (e) {} },
      _authChanged: function () {
        if (!auth.loaded) return;
        if (!auth.enabled) return set('off');
        if (!auth.user) return set('signed-out');
        c.syncNow();
      },
      changed: function () {
        var m = meta(); m.dirty = true; saveMeta(m);
        if (!auth.user) return;
        clearTimeout(timer); timer = setTimeout(function () { c.syncNow(); }, 2500);
      },
      syncNow: function () {
        if (!auth.user) return Promise.resolve();
        if (running) { running.again = true; return running.p; }
        var job = { again: false };
        job.p = run().catch(function (e) { set('error', e.message || String(e)); }).then(function () { running = null; if (job.again) return c.syncNow(); });
        running = job;
        return job.p;
      },
      fetchFile: function (hash) {
        return fetch('/api/sync/' + opts.app + '/files/' + hash, { credentials: 'same-origin' }).then(function (r) {
          if (!r.ok) throw new Error('File not in the cloud');
          return r.blob();
        }).then(function (b) { return (opts.files && opts.files.put ? Promise.resolve(opts.files.put(hash, b, b.type)) : Promise.resolve()).then(function () { return b; }); });
      },
      mountPanel: function (el) {
        function draw() {
          var s = c.state, u = auth.user;
          el.innerHTML = '<div class="as-card" data-s="' + esc(s.status) + '"><div><span class="as-dot"></span><b>Cloud sync</b> · ' +
            (s.status === 'off' ? 'not set up on this server — data stays in this browser' : !u ? 'sign in to keep this data in sync across your devices' : esc(u.email) + ' · ' + esc(c.describe())) + '</div><div style="display:flex;gap:8px">' +
            (s.status === 'off' ? '' : !u ? '<button type="button" class="as-btn pri" data-a="in">Sign in</button>' : '<button type="button" class="as-btn" data-a="sync">Sync now</button><button type="button" class="as-btn" data-a="out">Sign out</button>') + '</div></div>';
        }
        el.onclick = function (e) { var b = e.target.closest('[data-a]'); if (!b) return; var a = b.getAttribute('data-a'); if (a === 'in') signIn(); else if (a === 'out') signOut(); else c.syncNow(); };
        var off1 = c.on(draw), off2 = AdrialSync.on(draw);
        return function () { off1(); off2(); };
      }
    };
    function set(status, message) {
      c.state = { status: status, message: message || '', syncedAt: meta().syncedAt || null };
      subs.forEach(function (fn) { try { fn(c.state); } catch (e) { console.error(e); } });
      renderShell();
    }
    function uploadFiles() {
      if (!opts.files || !opts.files.list) return Promise.resolve();
      var m = meta(), done = m.files || {};
      return Promise.resolve(opts.files.list()).then(function (list) {
        return list.reduce(function (p, f) {
          return p.then(function () {
            if (done[f.hash]) return;
            return fetch('/api/sync/' + opts.app + '/files/' + f.hash, { method: 'HEAD', credentials: 'same-origin' }).then(function (r) {
              if (r.ok) return;
              return Promise.resolve(f.getBlob()).then(function (blob) {
                return fetch('/api/sync/' + opts.app + '/files/' + f.hash, { method: 'PUT', credentials: 'same-origin', headers: Object.assign({ 'Content-Type': f.type || blob.type || 'application/octet-stream' }, H), body: blob })
                  .then(function (r2) { if (!r2.ok) throw new Error('Uploading a file failed (' + r2.status + ')'); });
              });
            }).then(function () { done[f.hash] = 1; var mm = meta(); mm.files = done; saveMeta(mm); });
          });
        }, Promise.resolve());
      });
    }
    function push(base) {
      set('syncing');
      return uploadFiles().then(function () { return opts.getSnapshot(); }).then(function (data) {
        return api(opts.app, 'PUT', { data: data, baseGeneration: base });
      }).then(function (r) {
        if (r._status === 409) return conflict(r);
        if (r._status !== 200) throw new Error(r.error || 'Upload failed (' + r._status + ')');
        var m = meta(); m.generation = r.generation; m.syncedAt = r.updatedAt; m.dirty = false; saveMeta(m); set('synced');
      });
    }
    function pull(cloud) {
      set('syncing');
      return (cloud && cloud.data ? Promise.resolve(cloud) : api(opts.app, 'GET')).then(function (r) {
        if (r._status && r._status !== 200) throw new Error(r.error || 'Download failed');
        return Promise.resolve(opts.applySnapshot(r.data)).then(function () {
          var m = meta(); m.generation = r.generation; m.syncedAt = r.updatedAt; m.dirty = false; saveMeta(m); set('synced');
        });
      });
    }
    function conflict(cloud) {
      set('conflict');
      return dialog('<h2>' + esc(opts.label || opts.app) + ' changed in two places</h2><p>The cloud copy was updated on another device (' + esc(ago(cloud.updatedAt)) + '), and this browser also has changes that are not synced. Which one do you want to keep? The other is replaced.</p>' +
        '<div class="as-row"><button class="as-btn" data-v="later">Decide later</button><button class="as-btn" data-v="cloud">Use the cloud copy</button><button class="as-btn pri" data-v="mine">Keep this browser’s</button></div>')
        .then(function (v) { if (v === 'cloud') return pull(); if (v === 'mine') return push(cloud.generation); set('conflict', 'unresolved'); });
    }
    function run() {
      set('syncing');
      var m = meta();
      return api(opts.app, 'GET', null, '?meta=1').then(function (r) {
        if (r._status === 401) { auth.user = null; emit(); return; }
        if (r._status !== 200) throw new Error(r.error || 'Sync unavailable (' + r._status + ')');
        if (!r.exists) return push('0');                                       // first upload from this person
        if (!m.generation) {                                                    // first sync on this device, cloud has data
          set('choose');
          return dialog('<h2>' + esc(opts.label || opts.app) + ' is already in the cloud</h2><p>Saved from another device ' + esc(ago(r.updatedAt)) + '. Do you want to continue with the cloud copy here, or replace it with the data in this browser?</p>' +
            '<div class="as-row"><button class="as-btn" data-v="later">Not now</button><button class="as-btn" data-v="mine">Upload this browser’s data</button><button class="as-btn pri" data-v="cloud">Use the cloud copy</button></div>')
            .then(function (v) { if (v === 'cloud') return pull(); if (v === 'mine') return push(r.generation); set('choose', 'not decided'); });
        }
        if (String(m.generation) === String(r.generation)) return m.dirty ? push(m.generation) : set('synced');
        return m.dirty ? conflict(r) : pull();                                  // cloud changed elsewhere
      });
    }
    controllers.push(c);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && auth.user && c.state.status !== 'choose' && c.state.status !== 'conflict') c.syncNow(); });
    window.addEventListener('pagehide', function () { if (timer && auth.user) { clearTimeout(timer); c.syncNow(); } });
    ready.then(function () { c._authChanged(); });
    return c;
  }

  window.AdrialSync = {
    ready: ready, attach: attach, signIn: signIn, signOut: signOut, changePassword: changePassword, sha256: sha256,
    user: function () { return auth.user; }, enabled: function () { return auth.enabled; },
    on: function (fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (f) { return f !== fn; }); }; }
  };
})();
