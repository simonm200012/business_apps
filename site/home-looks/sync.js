/* Home page: the pinned apps and "Needs you today" the same on the phone and the computer.
 *
 * Uses the cloud copy server the apps use (worker/index.js) under the app name "home", with no change to
 * /_shared/stratum-sync.js: that client never merges and asks "which copy do you keep?", which would be wrong here, so
 * this file talks to the same /api routes itself and merges the two small lists instead:
 *   - pins: the list changed last wins (each device stamps when it saw its list change); a device that syncs for the
 *     first time keeps the cloud's order and adds its own pins after it, so nothing is lost;
 *   - needs: per app, the newest report wins, whichever device made it; an app that cleared its report on one device
 *     (StratumShell.needs(app, [])) leaves a dated "cleared" mark so the other device drops it too; older than 7 days
 *     is dropped (the home page shows 7 days).
 * Cloud copy: { v: 1, pins: [ids], pinsAt: ISO, needs: { app: { at: ISO, items: [...] } } } (items [] = cleared).
 * localStorage "stratum-home-sync": what this device last agreed with the cloud ({ gen, pins, pinsAt, needs: {app: at},
 * dirtyPinsAt }), so it can tell its own changes from the other device's.
 *
 * Privacy: "home" is in PRIVATE_APPS in worker/access.js, so view-only people never read it, and the reports from the
 * private apps (PRIVATE below) sync too (SHARE_PRIVATE). If 'home' is ever taken out of PRIVATE_APPS, set SHARE_PRIVATE
 * back to false so those reports stay on the device.
 * Off when the site has no sync server (a static server, file://), for view-only people, and while signed out.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.StratumHomeSync = api; try { if (root.document && root.localStorage) api.boot(root); } catch (e) { /* no storage: nothing to sync */ } }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var APP = 'home', PKEY = 'stratum-apps-pins', NKEY = 'stratum-needs', MKEY = 'stratum-home-sync';
  var PRIVATE = ['billing', 'invoices', 'desk', 'cashflow', 'client-atlas'];
  var SHARE_PRIVATE = true;
  var KEEP = 7 * 864e5, ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

  function shareable(app) { return ID.test(app) && (SHARE_PRIVATE || PRIVATE.indexOf(app) < 0); }
  function time(iso) { var t = Date.parse(iso); return isFinite(t) ? t : 0; }
  function cleanPins(l) { return Array.isArray(l) ? l.filter(function (id, i) { return typeof id === 'string' && ID.test(id) && l.indexOf(id) === i; }).slice(0, 60) : []; }
  function cleanItems(items) {
    return Array.isArray(items) ? items.filter(function (it) { return it && typeof it === 'object' && typeof it.text === 'string' && it.text.trim(); }).slice(0, 3).map(function (it) {
      var o = { text: it.text.slice(0, 90) };
      if (typeof it.count === 'number' && isFinite(it.count)) o.count = it.count;
      if (typeof it.href === 'string' && /^\/(?!\/)/.test(it.href)) o.href = it.href.slice(0, 200);
      if (it.tone === 'warn' || it.tone === 'bad' || it.tone === 'info') o.tone = it.tone;
      return o;
    }) : [];
  }
  /** The shareable, recent reports of a "stratum-needs" object (or of a cloud copy's needs, with cleared marks). */
  function cleanNeeds(obj, now, keepCleared) {
    var out = {};
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
    Object.keys(obj).sort().forEach(function (k) { // sorted: copies compare as JSON
      var v = obj[k], t = v && time(v.at);
      if (!shareable(k) || !t || t < now - KEEP || t > now + 3e5) return;
      var items = cleanItems(v.items);
      if (items.length || (keepCleared && Array.isArray(v.items))) out[k] = { at: new Date(t).toISOString(), items: items };
    });
    return out;
  }
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  /**
   * Merges this device's lists with the cloud copy.
   *   local: { pins: [ids], needs: { app: { at, items } } }   (needs: shareable reports only)
   *   cloud: the cloud copy, or null when there is none
   *   meta:  what this device last agreed with the cloud (or null the first time)
   * → { cloud: the new cloud copy, local: { pins, needs }, cloudChanged, localChanged }
   */
  function merge(local, cloud, meta, now) {
    meta = meta && typeof meta === 'object' ? meta : null;
    var lp = cleanPins(local && local.pins), ln = cleanNeeds(local && local.needs, now, false);
    var c = cloud && typeof cloud === 'object' ? cloud : null;
    var cp = c ? cleanPins(c.pins) : [], cpAt = c ? time(c.pinsAt) : 0, cn = c ? cleanNeeds(c.needs, now, true) : {};
    var nowIso = new Date(now).toISOString();

    // pins
    var pins, pinsAt;
    var mine = !meta ? lp.length > 0 : !same(lp, cleanPins(meta.pins));
    var theirs = !!c && (!meta ? cp.length > 0 : cpAt > time(meta.pinsAt));
    if (!meta && mine && theirs) { pins = cp.concat(lp.filter(function (id) { return cp.indexOf(id) < 0; })); pinsAt = nowIso; }
    else if (mine && theirs) {
      var myAt = meta && time(meta.dirtyPinsAt) || now;
      if (myAt >= cpAt) { pins = lp; pinsAt = new Date(myAt).toISOString(); } else { pins = cp; pinsAt = new Date(cpAt).toISOString(); }
    } else if (mine) { pins = lp; pinsAt = new Date(meta && time(meta.dirtyPinsAt) || now).toISOString(); }
    else if (theirs) { pins = cp; pinsAt = new Date(cpAt).toISOString(); }
    else { pins = c ? cp : lp; pinsAt = c && cpAt ? new Date(cpAt).toISOString() : (meta && meta.pinsAt) || (lp.length ? nowIso : ''); }

    // needs, app by app
    var seen = meta && meta.needs && typeof meta.needs === 'object' ? meta.needs : {};
    var needs = {}, keys = {};
    [ln, cn, seen].forEach(function (o) { Object.keys(o).forEach(function (k) { if (shareable(k)) keys[k] = 1; }); });
    Object.keys(keys).sort().forEach(function (k) {
      var L = ln[k], C = cn[k], S = time(seen[k]);
      if (L && C) needs[k] = time(L.at) >= time(C.at) ? L : C;
      else if (L) needs[k] = L;
      else if (C) {
        // gone here: cleared on this device if the cloud still has what this device last saw; otherwise the other
        // device reported (or cleared) something newer, which wins
        if (S && C.items.length && time(C.at) <= S) needs[k] = { at: nowIso, items: [] };
        else needs[k] = C;
      }
    });
    Object.keys(needs).forEach(function (k) { if (time(needs[k].at) < now - KEEP) delete needs[k]; });

    var next = { v: 1, pins: pins, pinsAt: pinsAt, needs: needs };
    var localNeeds = {};
    Object.keys(needs).forEach(function (k) { if (needs[k].items.length) localNeeds[k] = needs[k]; });
    var before = c ? { v: 1, pins: cp, pinsAt: c.pinsAt || '', needs: cn } : null;
    return {
      cloud: next,
      local: { pins: pins, needs: localNeeds },
      cloudChanged: !before ? (pins.length > 0 || Object.keys(needs).length > 0) : !same(before, next),
      localChanged: !same(lp, pins) || !same(ln, localNeeds)
    };
  }

  /**
   * The sync loop for one page. env: { fetch, storage (getItem/setItem), now(), onLocalChange(), log? }.
   * run() syncs now; check() syncs when this device's lists changed since the last sync.
   */
  function createRunner(env) {
    var st = { busy: null, again: false, off: false, ready: null };
    function get(k, d) { try { var v = JSON.parse(env.storage.getItem(k)); return v === null || v === undefined ? d : v; } catch (e) { return d; } }
    function put(k, v) { try { env.storage.setItem(k, JSON.stringify(v)); } catch (e) {} }
    function readLocal() {
      var all = get(NKEY, {}), needs = {};
      if (all && typeof all === 'object' && !Array.isArray(all)) Object.keys(all).forEach(function (k) { if (shareable(k)) needs[k] = all[k]; });
      return { pins: cleanPins(get(PKEY, [])), needs: needs };
    }
    function writeLocal(l) {
      // keep the private apps' reports and anything an app wrote meanwhile for an app this merge did not touch
      var all = get(NKEY, {}); if (!all || typeof all !== 'object' || Array.isArray(all)) all = {};
      Object.keys(all).forEach(function (k) { if (shareable(k) && !l.needs[k]) delete all[k]; });
      Object.keys(l.needs).forEach(function (k) { all[k] = l.needs[k]; });
      put(NKEY, all);
      put(PKEY, l.pins);
    }
    function meta() { var m = get(MKEY, null); return m && typeof m === 'object' && !Array.isArray(m) ? m : null; }
    function req(url, init) {
      return env.fetch(url, Object.assign({ credentials: 'same-origin', cache: 'no-store', redirect: 'manual' }, init || {}));
    }
    // signed in as the owner on a site with the sync server (once per page; again after a failure)
    function allowed() {
      if (st.ready) return st.ready;
      st.ready = req('/api/auth/config').then(function (r) { return r.ok ? r.json() : { enabled: false }; }).then(function (c) {
        if (!c || !c.enabled) { st.off = true; return false; }
        return req('/api/auth/me').then(function (r) { return r.ok ? r.json() : null; }).then(function (u) {
          if (!u || !u.email) { st.ready = null; return false; } // signed out or expired: ask again next time
          if (u.viewer) { st.off = true; return false; }
          return true;
        });
      }).catch(function () { st.ready = null; return false; });
      return st.ready;
    }
    async function once() {
      if (st.off || !(await allowed())) return 'off';
      for (var i = 0; i < 3; i++) {
        var r = await req('/api/sync/' + APP);
        if (r.type === 'opaqueredirect' || r.status === 401) { st.ready = null; return 'expired'; }
        var gen = 0, data = null;
        if (r.status === 200) { gen = Number(r.headers.get('X-Sync-Generation')) || 0; data = await r.json().catch(function () { return null; }); }
        else if (r.status !== 404) return 'error';
        var m = meta(), now = env.now();
        var res = merge(readLocal(), data, m, now);
        if (res.localChanged) { writeLocal(res.local); env.onLocalChange(); }
        // what both sides now have (cleared marks are not shown here, so they are not listed)
        var agreed = { gen: gen, pins: res.cloud.pins, pinsAt: res.cloud.pinsAt, needs: {} };
        Object.keys(res.local.needs).forEach(function (k) { agreed.needs[k] = res.local.needs[k].at; });
        if (res.cloudChanged) {
          var w = await req('/api/sync/' + APP + '?base=' + gen, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Stratum-Apps': '1' }, body: JSON.stringify(res.cloud) });
          if (w.status === 409) continue; // the other device saved meanwhile: merge again with its copy
          if (w.type === 'opaqueredirect' || w.status === 401) { st.ready = null; return 'expired'; }
          if (w.status === 403) { st.off = true; return 'off'; } // view only after all
          if (!w.ok) return 'error';
          var j = await w.json().catch(function () { return {}; });
          agreed.gen = Number(j.generation) || gen + 1;
        }
        put(MKEY, agreed);
        return res.cloudChanged ? 'uploaded' : res.localChanged ? 'downloaded' : 'same';
      }
      return 'busy';
    }
    function run() {
      if (st.busy) { st.again = true; return st.busy; }
      st.busy = once().catch(function (e) { if (env.log) env.log(e); return 'offline'; }).then(function (v) {
        st.busy = null;
        if (st.again) { st.again = false; return run(); }
        return v;
      });
      return st.busy;
    }
    // has this device changed something since the last sync? (pins get their change time stamped here)
    function dirty() {
      var m = meta(), l = readLocal(), now = env.now(), ln = cleanNeeds(l.needs, now, false);
      if (!m) return l.pins.length > 0 || Object.keys(ln).length > 0;
      var pinsChanged = !same(l.pins, cleanPins(m.pins));
      if (pinsChanged && !m.dirtyPinsAt) { m.dirtyPinsAt = new Date(now).toISOString(); put(MKEY, m); }
      var o = {}, mo = {};
      Object.keys(ln).forEach(function (k) { o[k] = ln[k].at; });
      Object.keys(m.needs || {}).forEach(function (k) { if (time(m.needs[k]) >= now - KEEP) mo[k] = new Date(time(m.needs[k])).toISOString(); });
      return pinsChanged || !same(sorted(o), sorted(mo));
    }
    function sorted(o) { var r = {}; Object.keys(o).sort().forEach(function (k) { r[k] = o[k]; }); return r; }
    function check() { if (st.off) return Promise.resolve('off'); return dirty() ? run() : Promise.resolve('same'); }
    return { run: run, check: check, dirty: dirty, state: st };
  }

  /** In the page: sync shortly after load, when the page is shown again, when the connection is back, and a few
   *  seconds after this device changed a pin or an app reported something. */
  function boot(win) {
    if (!/^https?:$/.test(win.location.protocol)) return;
    // a plain static server on this computer has no /api (asking would only log a 404); `npx wrangler dev` (port 8787) has
    if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(win.location.hostname) && win.location.port !== '8787') return;
    var runner = createRunner({
      fetch: win.fetch.bind(win), storage: win.localStorage, now: function () { return Date.now(); },
      onLocalChange: function () {
        // the home page redraws its pins and needs on a storage event (as when another tab changed them)
        try { win.dispatchEvent(new win.StorageEvent('storage', { key: PKEY })); } catch (e) {}
      }
    });
    win.StratumHomeSync.runner = runner;
    var timer = 0;
    function soon(ms) { clearTimeout(timer); timer = setTimeout(function () { runner.check(); }, ms); }
    function start() { runner.run(); }
    if (win.document.readyState === 'complete') setTimeout(start, 1200); else win.addEventListener('load', function () { setTimeout(start, 1200); });
    win.document.addEventListener('visibilitychange', function () { if (win.document.visibilityState === 'visible') runner.run(); else runner.check(); });
    win.addEventListener('online', function () { runner.run(); });
    win.addEventListener('storage', function (e) { if (!e.key || e.key === PKEY || e.key === NKEY) soon(1500); });
    // pins changed on this page itself raise no storage event: look every few seconds while the page is shown
    setInterval(function () { if (win.document.visibilityState === 'visible' && !runner.state.off) soon(400); }, 5000);
  }

  return { merge: merge, createRunner: createRunner, boot: boot, cleanNeeds: cleanNeeds, PRIVATE: PRIVATE };
});
