/* Business Apps — runtime for the "New design" dashboard pages.
 * Gives a page the same `dash` object the claude.ai Dashboard pages use, so a dashboard's
 * index.html runs here unchanged: datasets are static JSON files next to the page, calculations
 * run in the browser, filters live in memory (and this browser's localStorage).
 *
 * Configure before loading this script:
 *   window.DASH_CONFIG = { app: 'recon', datasets: { txns: 'data/txns.json', … }, params: { … } };
 */
(function () {
  'use strict';
  var cfg = window.DASH_CONFIG || {};
  var datasets = cfg.datasets || {};
  var defaults = cfg.params || {};
  var storeKey = 'stratum-dash-params:' + (cfg.app || location.pathname);

  var store = {};   // id -> {status, data, columns, meta, message, refreshing}
  var calcs = {};   // id -> {inputs, fn, cacheKey, cache}
  var listeners = [];
  var params = Object.assign({}, defaults);
  try {
    var saved = JSON.parse(localStorage.getItem(storeKey) || 'null');
    if (saved && typeof saved === 'object') Object.assign(params, saved);
  } catch (e) { /* storage blocked: defaults only */ }

  function empty(status, message) {
    return { status: status, data: [], rows: [], columns: [], meta: [], message: message || '', refreshing: false };
  }

  function load(id) {
    if (store[id]) return;
    store[id] = empty('loading');
    fetch(datasets[id], { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (json) {
        var rows = Array.isArray(json) ? json : (json && (json.rows || json.data || json.results)) || [];
        var columns = rows.length ? Object.keys(rows[0]) : [];
        store[id] = { status: 'ok', data: rows, rows: rows, columns: columns, meta: [], message: '', refreshing: false };
        schedule();
      })
      .catch(function (err) {
        store[id] = empty('error', String(err && err.message || err));
        schedule();
      });
  }

  function calcResult(id) {
    var c = calcs[id];
    var inputs = c.inputs.map(function (i) { return dash.data(i); });
    if (inputs.some(function (s) { return s.status === 'error' || s.status === 'missing'; })) return empty('error', 'An input failed to load');
    if (inputs.some(function (s) { return s.status !== 'ok'; })) return empty('loading');
    var key = inputs.map(function (s) { return s.data; });
    if (c.cacheKey && c.cacheKey.length === key.length && c.cacheKey.every(function (d, i) { return d === key[i]; })) return c.cache;
    var result;
    try {
      var out = c.fn.apply(null, key);
      var rows = Array.isArray(out) ? out : (out == null ? [] : [out]);
      result = { status: 'ok', data: out, rows: rows, columns: rows.length && typeof rows[0] === 'object' ? Object.keys(rows[0]) : [], meta: [], message: '', refreshing: false };
    } catch (err) {
      console.error('Calculation "' + id + '" failed', err);
      result = empty('error', String(err && err.message || err));
    }
    c.cacheKey = key;
    c.cache = result;
    return result;
  }

  var pending = false;
  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () {
      pending = false;
      listeners.forEach(run);
    });
  }
  function run(fn) {
    try { fn(); } catch (err) { console.error('Dashboard draw failed', err); }
  }

  var dash = {
    colors: ['var(--dash-c1)', 'var(--dash-c2)', 'var(--dash-c3)', 'var(--dash-c4)', 'var(--dash-c5)', 'var(--dash-c6)', 'var(--dash-c7)', 'var(--dash-c8)'],
    data: function (id) {
      if (calcs[id]) return calcResult(id);
      if (!datasets[id]) return empty('missing', 'Unknown source ' + id);
      if (!store[id]) load(id);
      return store[id];
    },
    onData: function (fn) { listeners.push(fn); run(fn); },
    calc: function (id, def) { calcs[id] = { inputs: def.inputs || [], fn: def.fn }; },
    loader: function () { /* static files need no loader */ },
    refresh: function () { /* static demo data: nothing to refresh */ },
    params: function () { return Object.assign({}, params); },
    setParams: function (o) {
      Object.keys(o || {}).forEach(function (k) {
        if (o[k] === null || o[k] === undefined) delete params[k]; else params[k] = o[k];
      });
      try { localStorage.setItem(storeKey, JSON.stringify(params)); } catch (e) {}
      schedule();
    },
    resetParams: function () {
      params = Object.assign({}, defaults);
      try { localStorage.removeItem(storeKey); } catch (e) {}
      schedule();
    },
    setLink: function (name) {
      try { history.replaceState(null, '', name ? '#' + name : location.pathname + location.search); } catch (e) {}
    }
  };
  window.dash = dash;

  // Start every download at once; pages read them as they arrive.
  Object.keys(datasets).forEach(load);

  // Redraw on width changes (charts size from clientWidth) and on theme changes.
  var lastWidth = 0;
  function watchWidth() {
    var root = document.getElementById('dash-root');
    if (!root || !window.ResizeObserver) return;
    new ResizeObserver(function (entries) {
      var w = Math.round(entries[0].contentRect.width);
      if (w !== lastWidth) { lastWidth = w; schedule(); }
    }).observe(root);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchWidth); else watchWidth();
  window.addEventListener('stratum-theme', schedule);

  // A link to a tab (#exceptions) opens that tab; keep the header in view instead of the browser's anchor jump.
  window.addEventListener('load', function () {
    var name = location.hash.slice(1);
    if (name && document.querySelector('[role="tab"][data-tab="' + CSS.escape(name) + '"]')) window.scrollTo(0, 0);
  });
})();
