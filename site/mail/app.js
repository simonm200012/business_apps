/* Adrial Mail — boot, hash router, persistence wiring, cross-tab sync, send jobs, demo clock. */
(function () {
  'use strict';
  var AM = window.AM, U = AM.U, E = AM.E, S = AM.S, esc = U.esc;
  var App = AM.App = { routes: AM.routes || [], state: {}, jobs: {}, leave: [] };
  var db = null, main = document.getElementById('main'), Bus = window.AdrialBus || null;

  App.db = function () { return db; };
  App.route = function (re, fn, nav) { App.routes.push({ re: re, fn: fn, nav: nav }); };
  App.onLeave = function (fn) { App.leave.push(fn); };
  App.save = function (keys) { S.save(keys); App.publishSoon(); App.navCounts(); };
  App.go = function (h) { if (location.hash === h) App.render(); else location.hash = h; };

  function parse() { var h = location.hash.replace(/^#/, '') || '/'; return h.split('?')[0]; }
  App.render = function (keep) {
    if (!db) return;
    App.leave.splice(0).forEach(function (fn) { try { fn(); } catch (e) { console.error(e); } });
    var path = parse(), y = window.scrollY;
    for (var i = 0; i < App.routes.length; i++) {
      var r = App.routes[i], m = path.match(r.re);
      if (!m) continue;
      App.cur = { r: r, m: m, path: path };
      var page = document.createElement('div'); page.className = 'page';
      main.innerHTML = ''; main.appendChild(page);
      try { r.fn(page, m); } catch (e) { console.error(e); page.innerHTML = '<div class="empty box">Something went wrong rendering this page: ' + esc(e.message) + '</div>'; }
      U.$$('.nav a').forEach(function (a) { if (a.dataset.nav === r.nav) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
      if (keep) window.scrollTo(0, y); else { window.scrollTo(0, 0); var h1 = page.querySelector('h1'); if (h1 && App.navigated) h1.focus({ preventScroll: true }); }
      App.navigated = true;
      document.title = (App.title || 'Adrial Mail') + ' — Adrial Apps';
      App.title = null;
      return;
    }
    main.innerHTML = '<div class="page"><div class="empty box">Page not found. <a href="#/">Back to the dashboard</a></div></div>';
  };
  App.isEditing = function () {
    var a = document.activeElement;
    return U.layerOpen() || (a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) && main.contains(a));
  };
  App.navCounts = function () {
    if (!db) return;
    var set = function (id, v) { var el = document.getElementById(id); if (el) el.textContent = v; };
    set('navCampaigns', db.campaigns.filter(function (c) { return c.status === 'scheduled' || c.status === 'sending'; }).length || '');
    set('navFlows', db.flows.filter(function (f) { return f.status === 'live'; }).length + ' live');
    set('navProfiles', U.short(db.profiles.length));
    var off = db.meta.clockOffset || 0, now = E.now();
    document.getElementById('clockBtn').innerHTML = 'Demo clock ' + esc(U.dateShort(now) + ' ' + U.time(now)) + (off ? ' <b>+' + esc(U.short(off / U.HOUR)) + ' h</b>' : '');
  };

  // ── Bus snapshot for the Analytics app ───────────────────────────────
  App.publishSoon = U.debounce(function () {
    if (!Bus || !db) return;
    try { Bus.publish('mail.summary', E.summary()); } catch (e) { console.error(e); }
  }, 2500);

  // ── Campaign sending (simulated, with progress) ──────────────────────
  App.sendCampaign = function (c, instant) {
    var ts = E.now();
    if (c.schedule && c.schedule.type !== 'now' && !instant) ts = Math.max(ts, E.sendTime(c));
    var res = E.runSend(c, { ts: E.now(), r: Math.random, live: true });
    if (instant) { E.commitSend(c, res, E.now()); App.save(['campaigns', 'events', 'profiles']); return; }
    c.status = 'sending'; c.updated = E.now(); App.save(['campaigns']);
    var ab = !!(res.st.ab), dur = ab ? 6500 : 4200, start = Date.now();
    var job = App.jobs[c.id] = { c: c, res: res, p: 0, phase: '' };
    var timer = setInterval(function () {
      var p = Math.min(1, (Date.now() - start) / dur); job.p = p;
      var n = res.st.recipients;
      if (ab) {
        var t = res.st.ab.testN;
        job.phase = p < 0.35 ? 'Sending test group: ' + U.n(Math.round(t * p / 0.35)) + ' of ' + U.n(t) : p < 0.55 ? 'Waiting ' + (res.st.ab.wait || 4) + ' h for results (fast-forwarded)… winner: variant ' + res.st.ab.winner : 'Sending winner (' + res.st.ab.winner + ') to the rest: ' + U.n(Math.round(res.st.ab.restN * (p - 0.55) / 0.45)) + ' of ' + U.n(res.st.ab.restN);
      } else job.phase = (c.channel === 'sms' ? 'Delivering SMS (simulated): ' : 'Delivering (simulated): ') + U.n(Math.round(n * p)) + ' of ' + U.n(n);
      U.$$('[data-progress="' + c.id + '"]').forEach(function (el) { el.querySelector('i').style.width = (p * 100).toFixed(1) + '%'; var s = el.parentNode.querySelector('[data-phase]'); if (s) s.textContent = job.phase; });
      if (p >= 1) {
        clearInterval(timer); delete App.jobs[c.id];
        E.commitSend(c, res, ts);
        App.save(['campaigns', 'events', 'profiles']);
        U.toast((c.channel === 'sms' ? 'SMS campaign' : 'Campaign') + ' "' + c.name + '" sent to ' + U.n(res.st.recipients) + ' recipients — simulated, nothing left this browser.');
        if (App.cur && /^\/(campaigns|sms)/.test(App.cur.path) && !App.isEditing()) App.render(true);
      }
    }, 100);
  };
  App.checkScheduled = function () {
    var now = E.now(), sent = [];
    db.campaigns.forEach(function (c) {
      if (c.status === 'sending' && !App.jobs[c.id]) { App.sendCampaign(c, true); sent.push(c); }
      else if (c.status === 'scheduled' && E.sendTime(c) <= now) { App.sendCampaign(c, true); c.sentAt = E.sendTime(c); sent.push(c); }
    });
    return sent;
  };
  // Process waiting flow runs, date triggers and scheduled campaigns up to the demo clock.
  App.heartbeat = function (quiet) {
    if (!db) return;
    var now = E.now(), msgs = [];
    var moved = E.tick();
    var from = db.meta.lastDateCheck || now;
    var dated = now > from ? E.runDateTriggers(from, now) : 0;
    db.meta.lastDateCheck = now;
    var sent = App.checkScheduled();
    if (moved.length) msgs.push(U.plural(moved.length, 'flow run') + ' advanced');
    if (dated) msgs.push(U.plural(dated, 'profile') + ' entered date-triggered flows');
    sent.forEach(function (c) { msgs.push('scheduled "' + c.name + '" sent (simulated)'); });
    if (moved.length || dated || sent.length) {
      App.save(['runs', 'flows', 'events', 'profiles', 'campaigns', 'meta']);
      if (!quiet) U.toast(msgs.join(' · '));
      if (!quiet && !App.isEditing() && App.cur && /^\/(|campaigns|flows|sms|simulator)$/.test(App.cur.path)) App.render(true);
    }
    App.navCounts();
    return { moved: moved, dated: dated, sent: sent };
  };
  App.advanceClock = function (ms) {
    db.meta.clockOffset = (db.meta.clockOffset || 0) + ms;
    E.touch();
    var r = App.heartbeat(true);
    App.save(['meta']);
    App.navCounts();
    return r;
  };

  // ── Product catalogue from the ERP app (bus) ─────────────────────────
  function readCatalog() {
    if (!Bus) return Promise.resolve(null);
    return Bus.read('erp.catalog').then(function (rec) {
      var ps = rec && rec.data && Array.isArray(rec.data.products) ? rec.data.products : null;
      if (!ps || !ps.length) return null;
      return ps.filter(function (p) { return p && p.sku && p.name; }).map(function (p) { return { sku: String(p.sku), name: String(p.name), category: String(p.category || 'Other'), brand: String(p.brand || ''), price: +p.price || 0 }; });
    }).catch(function () { return null; });
  }
  function mergeCatalog(ps) {
    if (!ps || !db) return 0;
    var bySku = new Map(db.products.map(function (p) { return [p.sku, p]; })), added = 0;
    ps.forEach(function (p) { var x = bySku.get(p.sku); if (x) { x.name = p.name; x.price = p.price; x.category = p.category; x.brand = p.brand; } else { db.products.push(p); added++; } });
    db.meta.productSource = 'erp.catalog';
    return added;
  }

  // ── Boot / reset ─────────────────────────────────────────────────────
  function fresh(catalog) {
    db = AM.Data.generate(catalog);
    return S.saveAll(db).then(function (ok) { if (!ok) storageWarning(); });
  }
  var warned = false;
  function storageWarning() { if (warned) return; warned = true; U.toast('This browser blocks IndexedDB — the demo runs in memory and resets when you close the tab.'); }
  App.reset = function () {
    return U.confirm({ title: 'Reset demo data?', text: 'This replaces all profiles, campaigns, flows, templates and forms in this browser with fresh demo data. Your changes will be lost. Other open tabs reload too.', ok: 'Reset demo data', danger: true }).then(function (ok) {
      if (!ok) return;
      main.innerHTML = '<p class="loading">Generating fresh demo data…</p>';
      Object.keys(App.jobs).forEach(function (k) { delete App.jobs[k]; });
      return S.clear().then(function () { return Bus ? Bus.reset('mail') : null; }).then(readCatalog).then(fresh).then(function () {
        E.init(db); S.broadcast({ type: 'reset' }); App.publishSoon(); App.navCounts();
        location.hash = '#/'; App.render(); U.toast('Demo data reset' + (App.sync && window.AdrialSync && AdrialSync.user() ? ' — the cloud copy will be replaced on the next sync.' : '.'));
        if (App.sync) App.sync.changed(); // the cloud copy is never deleted; the reset data is uploaded like any other change
      });
    });
  };
  function boot() {
    S.bind(function () { return db; });
    S.on(function (m) {
      if (m.type === 'unavailable') return storageWarning();
      if (m.type === 'reset') { location.reload(); return; }
      if (m.type === 'saved') { (App.pending = App.pending || new Set()); m.keys.forEach(function (k) { App.pending.add(k); }); applyRemote(); }
    });
    Promise.all([S.load(), readCatalog()]).then(function (r) {
      var loaded = r[0], catalog = r[1];
      if (!S.available) storageWarning();
      if (loaded && loaded.meta && loaded.meta.version === AM.Data.VERSION) { db = loaded; if (catalog) mergeCatalog(catalog); E.init(db); return null; }
      return fresh(catalog).then(function () { E.init(db); });
    }).then(function () {
      App.heartbeat(true);
      attachSync();
      App.navCounts(); App.publishSoon();
      App.render();
      setInterval(function () { App.heartbeat(false); }, 15000);
    });
    if (Bus) Bus.on(function (evt) {
      if (evt.kind === 'snapshot' && evt.key === 'erp.catalog') readCatalog().then(function (ps) { var n = mergeCatalog(ps); if (ps) { E.init(db); App.save(['products', 'meta']); U.toast('Product catalogue updated from ERP' + (n ? ' (' + n + ' new)' : '') + '.'); } });
    });
  }
  function applyRemote() {
    if (!App.pending || !App.pending.size) return;
    if (App.isEditing()) { clearTimeout(applyRemote.t); applyRemote.t = setTimeout(applyRemote, 1200); return; }
    var keys = Array.from(App.pending); App.pending.clear();
    S.loadKeys(keys).then(function (data) {
      if (!data) return;
      keys.forEach(function (k) { if (data[k] !== undefined) db[k] = data[k]; });
      E.init(db); App.navCounts();
      if (App.cur && !/\/(content|email\/|edit)/.test(App.cur.path) && !/^\/templates\/\d+/.test(App.cur.path)) App.render(true);
      else U.toast('Data changed in another tab.');
    });
  }

  // ── Cloud sync (shared AdrialSync library; server stores one snapshot per person) ──
  var EVK = ['p', 't', 'ts', 'r', 's', 'v', 'x'];
  App.snapshot = function () {
    S.flush();
    var out = { format: 'adrial-mail/1', version: AM.Data.VERSION, savedAt: new Date().toISOString() };
    S.KEYS.forEach(function (k) { if (k !== 'events') out[k] = db[k]; });
    // events are the bulk of the data → compact rows instead of objects (~40% smaller)
    out.events = { cols: EVK, rows: db.events.map(function (e) { var r = EVK.map(function (k) { return e[k] === undefined ? null : e[k]; }); while (r.length && r[r.length - 1] === null) r.pop(); return r; }) };
    return out;
  };
  App.applySnapshot = function (data) {
    if (!data || data.format !== 'adrial-mail/1' || !data.meta) throw new Error('This cloud copy is not Adrial Mail data.');
    if (data.version !== AM.Data.VERSION) throw new Error('The cloud copy was made by a different version of Adrial Mail (' + data.version + ').');
    var cols = (data.events && data.events.cols) || EVK;
    var next = {};
    S.KEYS.forEach(function (k) { if (k !== 'events') next[k] = data[k]; });
    next.events = ((data.events && data.events.rows) || []).map(function (r) { var e = {}; for (var i = 0; i < r.length; i++) if (r[i] !== null) e[cols[i]] = r[i]; return e; });
    Object.keys(App.jobs).forEach(function (k) { delete App.jobs[k]; });
    U.closeAll(); App.state = {};
    db = next; E.init(db);
    return S.saveAll(db).then(function () {
      S.broadcast({ type: 'saved', keys: S.KEYS.slice() });
      App.navCounts(); App.publishSoon(); App.render(true);
      U.toast('Loaded Adrial Mail data from the cloud.');
    });
  };
  function attachSync() {
    if (!window.AdrialSync || App.sync) return;
    App.sync = AdrialSync.attach({ app: 'mail', label: 'Adrial Mail data', getSnapshot: function () { return Promise.resolve(App.snapshot()); }, applySnapshot: function (d) { return App.applySnapshot(d); } });
    S.afterSave = function () { App.sync.changed(); };
    var el = document.getElementById('syncPanel'); if (el) App.sync.mountPanel(el);
  }

  // ── Global UI wiring ─────────────────────────────────────────────────
  window.addEventListener('hashchange', function () { closeSide(); U.closeAll(); App.render(); });
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'); if (!b) return;
    if (b.dataset.act === 'reset') { closeSide(); App.reset(); }
    if (b.dataset.act === 'clock') location.hash = '#/simulator';
  });
  var side = document.getElementById('side'), scrim = document.getElementById('sideScrim'), menuBtn = document.getElementById('menuBtn');
  function closeSide() { side.classList.remove('open'); scrim.hidden = true; menuBtn.setAttribute('aria-expanded', 'false'); }
  menuBtn.addEventListener('click', function () { var o = !side.classList.contains('open'); side.classList.toggle('open', o); scrim.hidden = !o; menuBtn.setAttribute('aria-expanded', String(o)); if (o) side.querySelector('a').focus(); });
  scrim.addEventListener('click', closeSide);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && side.classList.contains('open') && !U.layerOpen()) { closeSide(); menuBtn.focus(); } });
  document.getElementById('topSearch').addEventListener('submit', function (e) {
    e.preventDefault(); App.state.profileQ = document.getElementById('topQ').value.trim(); App.state.profilePage = 0;
    App.go('#/profiles');
  });

  boot();
})();
