/* Demo data for the refill app (static hosting, no server). Answers /api/refill/* in the browser with made-up
 * numbers: session, meta, segments, calendar, ab, model. Fictional markets' sample figures; no real customers,
 * e-mail addresses or amounts. Calendar and segments are built from the same list of "cells", so totals agree. */
(function () {
  'use strict';
  var D = window.AdrialDemo;
  if (!D) return;

  var EMAIL = 'demo@adrial.example';
  var MARKETS = ['SI', 'CRO', 'IT'];
  var MKT = {
    SI: { scale: 1.0, consent: 0.63, vper: 124, shops: [['Adrial SI', 0.72], ['Adrial Lenses SI', 0.28]] },
    CRO: { scale: 0.64, consent: 0.57, vper: 112, shops: [['Adrial HR', 0.69], ['Adrial Lenses HR', 0.31]] },
    IT: { scale: 0.26, consent: 0.49, vper: 131, shops: [['Adrial IT', 1.0]] }
  };
  var A_REFILL = 'Refill reminder', A_INC = 'Reminder + small incentive', A_WIN = 'Win-back offer', A_LOW = 'Low-cost win-back (email only)', A_NONE = 'No contact';
  var ACTIONS = [A_REFILL, A_INC, A_WIN, A_LOW, A_NONE];
  var CONSENT_ADJ = {}; CONSENT_ADJ[A_REFILL] = 0.05; CONSENT_ADJ[A_INC] = 0.0; CONSENT_ADJ[A_WIN] = -0.05; CONSENT_ADJ[A_LOW] = 0.02; CONSENT_ADJ[A_NONE] = -0.08;
  // relative lift of the 30-day reorder chance when the customer is actually e-mailed
  var UPLIFT = {}; UPLIFT[A_REFILL] = 0.14; UPLIFT[A_INC] = 0.24; UPLIFT[A_WIN] = 0.10; UPLIFT[A_LOW] = 0.04; UPLIFT[A_NONE] = 0;
  // customers whose supply already ran out (overdue / lapsed) or whose gap is unknown: [action, bucket, customers (SI), value each, 30d reorder chance, margin share]
  var STATIC = [
    [A_REFILL, '0 overdue', 1650, 96, 0.27, 0.40],
    [A_INC, '0 overdue', 5400, 58, 0.115, 0.37],
    [A_WIN, '0 overdue', 2500, 188, 0.075, 0.42],
    [A_LOW, '0 overdue', 10000, 24, 0.018, 0.35],
    [A_NONE, '9 unknown', 4200, 41, 0.03, 0.34]
  ];
  var DAILY_BASE = 238;          // customers running out per day in Slovenia
  var MAX_OFFSET = 150;

  function round(x, d) { var p = Math.pow(10, d); return Math.round(x * p) / p; }
  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
  function gauss(r) { var u = r() || 1e-9, v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  // share of the 30-day reorders that has arrived after t days
  function F(t) { return (1 - Math.exp(-t / 13)) / (1 - Math.exp(-30 / 13)); }
  function bucketOf(d) { return d <= 7 ? '1 0-7' : d <= 14 ? '2 8-14' : d <= 30 ? '3 15-30' : d <= 60 ? '4 31-60' : '5 60+'; }
  function actionOk(a, filter) { return !filter || (filter === 'contact' ? a !== A_NONE : a === filter); }
  function refillShare(d) { return d <= 10 ? 1 : d <= 30 ? 1 - 0.7 * (d - 10) / 20 : d <= 60 ? 0.3 * (1 - (d - 30) / 30) : 0; }

  // ── the model behind every route (rebuilt when the day changes) ──────────
  var cached = null;
  function model() {
    var T = D.iso(D.today());
    if (cached && cached.today === T) return cached;
    var cells = [];
    MARKETS.forEach(function (m) {
      var mk = MKT[m];
      for (var d = 0; d <= MAX_OFFSET; d++) {
        var date = D.iso(D.addDays(D.today(), d)), r = D.rng('refill-day|' + T + '|' + m + '|' + d);
        var total = Math.round(DAILY_BASE * mk.scale * D.shape(date) * (0.9 + 0.2 * r()) * (d > 60 ? 0.8 : 1));
        var nR = Math.round(total * refillShare(d)), nN = total - nR;
        [[A_REFILL, nR, 0.60 * Math.exp(-d / 55), mk.vper, 0.40], [A_NONE, nN, 0.30 * Math.exp(-d / 45), 78, 0.34]].forEach(function (x) {
          if (x[1] <= 0) return;
          var cons = clamp(mk.consent + CONSENT_ADJ[x[0]] + (r() - 0.5) * 0.06, 0.2, 0.9);
          var vp = x[3] * (0.92 + 0.16 * r()), pe = x[2] * (0.94 + 0.12 * r());
          cells.push({ m: m, a: x[0], b: bucketOf(d), d: d, date: date, n: x[1], nm: Math.round(x[1] * cons), exp: x[1] * pe, val: x[1] * vp, mar: x[1] * vp * x[4] });
        });
      }
      STATIC.forEach(function (s, i) {
        var r = D.rng('refill-static|' + T + '|' + m + '|' + i);
        var n = Math.round(s[2] * mk.scale * (0.95 + 0.1 * r()));
        var cons = clamp(mk.consent + CONSENT_ADJ[s[0]] + (r() - 0.5) * 0.04, 0.2, 0.9);
        var vp = s[3] * mk.vper / 124 * (0.97 + 0.06 * r());
        cells.push({ m: m, a: s[0], b: s[1], d: null, date: null, n: n, nm: Math.round(n * cons), exp: n * s[4] * (0.97 + 0.06 * r()), val: n * vp, mar: n * vp * s[5] });
      });
    });
    var total = 0; cells.forEach(function (c) { total += c.n; });
    cached = { today: T, cells: cells, total: total };
    return cached;
  }
  function sumCells(M, markets, filter) {
    var o = { n: 0, exp: 0 };
    M.cells.forEach(function (c) { if (markets.indexOf(c.m) >= 0 && actionOk(c.a, filter)) { o.n += c.n; o.exp += c.exp; } });
    return o;
  }

  // ── session / meta ───────────────────────────────────────────────────────
  function meta(M) {
    var T = M.today, shops = [];
    MARKETS.forEach(function (m) { MKT[m].shops.forEach(function (s) { shops.push({ market: m, project_name: s[0] }); }); });
    return {
      shops: shops,
      freshness: [
        { source: 'scores', day: T, n: M.total, updated_at: T + 'T04:35:12Z' },
        { source: 'orders', day: D.iso(D.addDays(D.today(), -1)) },
        { source: 'models_trained', day: D.iso(D.addDays(D.today(), -5)) },
        { source: 'models_backtested', day: D.iso(D.addDays(D.today(), -5)) },
        { source: 'training_labels', day: D.iso(D.addDays(D.today(), -38)) },
        { source: 'score_history', day: D.iso(D.addDays(D.today(), -35)), n: 13 },
        { source: 'emails_sent', day: D.iso(D.addDays(D.today(), -1)), n: 3860 },
        { source: 'summary', day: T }
      ]
    };
  }

  // ── segments ─────────────────────────────────────────────────────────────
  function segments(M, market, by) {
    if (market && !MKT[market]) return { rows: [] };
    var agg = {}, order = [];
    M.cells.forEach(function (c) {
      if (market && c.m !== market) return;
      var k = c.m + '|' + c.a + '|' + c.b;
      var x = agg[k] || (agg[k] = { m: c.m, a: c.a, b: c.b, n: 0, nm: 0, exp: 0, val: 0, mar: 0 });
      if (order.indexOf(k) < 0) order.push(k);
      x.n += c.n; x.nm += c.nm; x.exp += c.exp; x.val += c.val; x.mar += c.mar;
    });
    var rows = [];
    function push(m, proj, a, b, mail, n, exp, val, mar) {
      if (n <= 0) return;
      rows.push({ market: m, project_name: proj, suggested_action: a, runout_bucket: b, email_marketable: mail, customers: n, exp_reorders_30d: round(exp, 2), value_365: round(val, 2), margin_365: round(mar, 2) });
    }
    order.forEach(function (k) {
      var x = agg[k], s = x.n ? x.nm / x.n : 0;
      var parts = [[true, x.nm, s], [false, x.n - x.nm, 1 - s]];
      parts.forEach(function (p) {
        var n = p[1], f = p[2];
        if (n <= 0) return;
        if (by === 'project') {
          var shops = MKT[x.m].shops, left = n, e = x.exp * f, v = x.val * f, g = x.mar * f;
          shops.forEach(function (sh, i) {
            var last = i === shops.length - 1, cn = last ? left : Math.round(n * sh[1]), q = n ? cn / n : 0;
            left -= cn;
            push(x.m, sh[0], x.a, x.b, p[0], cn, e * q, v * q, g * q);
          });
        } else push(x.m, '', x.a, x.b, p[0], n, x.exp * f, x.val * f, x.mar * f);
      });
    });
    return { rows: rows };
  }

  // ── runout calendar ──────────────────────────────────────────────────────
  function calendar(M, market, action, days) {
    if (market && !MKT[market]) return { rows: [] };
    var agg = {}, keys = [];
    M.cells.forEach(function (c) {
      if (c.d == null || c.d > days || (market && c.m !== market) || !actionOk(c.a, action)) return;
      var k = c.date + '|' + c.m;
      var x = agg[k] || (agg[k] = { date: c.date, market: c.m, customers: 0, emailable: 0, exp_reorders_30d: 0, value_365: 0 });
      if (keys.indexOf(k) < 0) keys.push(k);
      x.customers += c.n; x.emailable += c.nm; x.exp_reorders_30d += c.exp; x.value_365 += c.val;
    });
    var rows = keys.map(function (k) { var x = agg[k]; x.exp_reorders_30d = round(x.exp_reorders_30d, 2); x.value_365 = round(x.value_365, 2); return x; });
    rows.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : MARKETS.indexOf(a.market) - MARKETS.indexOf(b.market); });
    return { rows: rows };
  }

  // ── A/B: reminders vs 10% hold-out ───────────────────────────────────────
  // scoring days (days before today) that have a stored read: 1..35 with a few days missing
  var SKIP = { 4: 1, 21: 1, 28: 1 };
  function cohortOffsets() { var a = []; for (var o = 35; o >= 1; o--) if (!SKIP[o]) a.push(o); return a; }
  function ab(M, market, action) {
    if (market && !MKT[market]) return { cohorts: [], baseline: [] };
    var mks = market ? [market] : MARKETS, today = D.today(), out = { cohorts: [], baseline: [] };
    // reorder chances per action for the selected markets
    var N = 0, rc = 0, rt = 0;
    ACTIONS.forEach(function (a) {
      if (!actionOk(a, action)) return;
      var s = sumCells(M, mks, a); N += s.n; rc += s.exp; rt += s.exp * (1 + UPLIFT[a]);
    });
    if (N > 0) {
      rc /= N; rt /= N;
      var mkey = market || 'All', akey = action || 'all';
      cohortOffsets().forEach(function (o) {
        var cohort = D.iso(D.addDays(today, -o)), obs = Math.min(o, 30), final = o >= 30;
        var r = D.rng('abf|' + mkey + '|' + akey + '|' + cohort);
        var pop = Math.round(N * (0.975 + 0.05 * r()));
        var nc = Math.max(1, Math.round(pop * 0.1 + gauss(r) * Math.sqrt(pop * 0.09))), nt = pop - nc;
        [['target', nt, rt], ['control', nc, rc]].forEach(function (g) {
          var n = g[1], rate = g[2], z = gauss(r), prev = 0, xs = {};
          [7, 14, 30].forEach(function (h) {
            var mean = n * rate * F(Math.min(h, obs)), sd = Math.sqrt(Math.max(0, mean * (1 - mean / n)));
            xs[h] = Math.max(prev, clamp(Math.round(mean + z * sd), 0, n)); prev = xs[h];
          });
          out.cohorts.push({
            cohort: cohort, ab_group: g[0], customers: n, reordered_7d: xs[7], reordered_14d: xs[14], reordered_30d: xs[30],
            sales_30d: round(xs[30] * (51 + 6 * r()) * 1.06, 2), days_observed: obs, final: final
          });
        });
      });
    }
    // A/A check: the same hash on past training periods (30-day reorders, all actions, no filter on action)
    var all = sumCells(M, mks, ''), tlDay = D.addDays(today, -38);
    var base = all.n ? all.exp / all.n : 0.1;
    for (var k = 0; k < 8; k++) {
      var asof = D.iso(D.addDays(tlDay, -30 - 14 * k)), rb = D.rng('aa|' + (market || 'All') + '|' + asof);
      var pop2 = Math.round(all.n * (0.93 - 0.015 * k) * (0.98 + 0.04 * rb()));
      var nc2 = Math.max(1, Math.round(pop2 * 0.1 + gauss(rb) * Math.sqrt(pop2 * 0.09))), nt2 = pop2 - nc2;
      var rate2 = clamp(base * (0.92 + 0.16 * rb()), 0.01, 0.9);
      [['target', nt2], ['control', nc2]].forEach(function (g) {
        var mean = g[1] * rate2, sd = Math.sqrt(mean * (1 - rate2));
        out.baseline.push({ asof: asof, ab_group: g[0], customers: g[1], reordered_30d: clamp(Math.round(mean + gauss(rb) * sd), 0, g[1]) });
      });
    }
    return out;
  }

  // ── model health ─────────────────────────────────────────────────────────
  var DECILES = {
    reorder_30d: { pred: [0.41, 0.29, 0.21, 0.16, 0.125, 0.10, 0.075, 0.055, 0.04, 0.02], auc: 0.782, drift: [0, -0.006, 0.003, -0.011] },
    reorder_90d: { pred: [0.66, 0.50, 0.38, 0.30, 0.24, 0.18, 0.13, 0.09, 0.05, 0.02], auc: 0.764, drift: [0, 0.004, -0.007, -0.002] },
    value_365d: { pred: [286, 171, 118, 84, 60, 43, 30, 19, 10, 3], auc: null, drift: [0, 0, 0, 0] }
  };
  function metricsRows() {
    var rows = [], today = D.today();
    for (var run = 0; run < 4; run++) {
      var day = D.addDays(today, -5 - 28 * run), computed = D.iso(day) + 'T03:' + (10 + run * 7) + ':20Z', test = D.iso(D.addDays(day, -40));
      Object.keys(DECILES).forEach(function (model) {
        var def = DECILES[model], r = D.rng('metrics|' + model + '|' + run), d = [], tot = 0, wsum = 0, ncust = 0;
        def.pred.forEach(function (p, i) {
          var cust = 4050 + Math.round((r() - 0.5) * 120 - run * 160);
          var act = p * (1 + 0.07 * gauss(r)) * (i === 0 ? 0.97 : 1);
          if (model === 'value_365d') act = round(act, 2); else act = round(clamp(act, 0.005, 0.95), 4);
          d.push({ i: i, cust: cust, p: model === 'value_365d' ? p : round(p, 4), act: act });
          tot += cust * act; ncust += cust;
        });
        var auc = def.auc == null ? null : round(def.auc + def.drift[run], 3);
        d.forEach(function (x) {
          rows.push({
            computed_at: computed, model: model, test_asof: test, decile: x.i + 1, customers: x.cust, predicted: x.p, actual: x.act,
            share_of_actual: round(x.cust * x.act / tot, 4), base_rate: round(tot / ncust, model === 'value_365d' ? 2 : 4), auc: auc
          });
        });
      });
    }
    return rows;
  }
  var BAND_P = [0.03, 0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75], BAND_W = [0, 0.14, 0.075, 0.045, 0.03, 0.02, 0.013, 0.008];
  function bands(target) {
    // weights per band so that the customer-weighted mean predicted chance equals `target`
    var sw = 0, swp = 0;
    for (var i = 1; i < 8; i++) { sw += BAND_W[i]; swp += BAND_W[i] * BAND_P[i]; }
    var s = clamp((target - BAND_P[0]) / (swp - BAND_P[0] * sw), 0.2, 3), w = [];
    for (var j = 1; j < 8; j++) w[j] = BAND_W[j] * s;
    var rest = 1; for (var k = 1; k < 8; k++) rest -= w[k];
    w[0] = Math.max(0.05, rest);
    return w;
  }
  function accuracyAndCalibration(M) {
    var acc = [], cal = [], today = D.today(), cohorts = cohortOffsets().filter(function (o) { return o >= 7; }).reverse();
    var allRate = sumCells(M, MARKETS, '');
    var rateAll = allRate.n ? allRate.exp / allRate.n : 0.1;
    var calDone = false;
    cohorts.forEach(function (o) {
      var cohort = D.iso(D.addDays(today, -o)), obs = Math.min(o, 30), final = o >= 30, f = F(obs);
      var r = D.rng('acc|' + cohort), per = {};
      MARKETS.forEach(function (m) {
        var s = sumCells(M, [m], ''), rm = D.rng('acc|' + cohort + '|' + m);
        var cust = Math.round(s.n * (0.98 + 0.04 * rm())), mean = clamp((s.n ? s.exp / s.n : rateAll) * (0.96 + 0.08 * rm()), 0.01, 0.9);
        var actual = clamp(mean * f * (1 + 0.03 * gauss(rm)), 0.001, 0.95);
        var sd = (m === 'IT' ? 0.016 : m === 'CRO' ? 0.009 : 0.006) * Math.sqrt(7 / obs) + 0.002;
        per[m] = { customers: cust, mean: mean, actual: actual, auc: clamp((m === 'IT' ? 0.762 : m === 'CRO' ? 0.775 : 0.784) + gauss(rm) * sd, 0.6, 0.92) };
      });
      var tc = 0, tm = 0, ta = 0, tauc = 0;
      MARKETS.forEach(function (m) { var p = per[m]; tc += p.customers; tm += p.customers * p.mean; ta += p.customers * p.actual; tauc += p.customers * p.auc; });
      var rows = [{ market: 'All', customers: tc, mean: tm / tc, actual: ta / tc, auc: clamp(tauc / tc + 0.006 + gauss(r) * 0.002, 0.6, 0.92) }]
        .concat(MARKETS.map(function (m) { var p = per[m]; return { market: m, customers: p.customers, mean: p.mean, actual: p.actual, auc: p.auc }; }));
      rows.forEach(function (x) {
        acc.push({
          cohort: cohort, market: x.market, days_observed: obs, final: final, customers: x.customers, reordered: Math.round(x.customers * x.actual),
          mean_p30: round(x.mean, 4), actual_rate: round(x.actual, 4), auc: round(x.auc, 4)
        });
      });
      if (o === 7 && !calDone) {   // live calibration is shown for the latest scoring day with a first read
        calDone = true;
        var w = bands(tm / tc), rc = D.rng('cal|' + cohort);
        for (var b = 0; b < 8; b++) {
          var c = Math.round(tc * w[b]), p = BAND_P[b] * (b ? 1 : 1) * (0.97 + 0.06 * rc());
          cal.push({ cohort: cohort, days_observed: obs, final: final, band: b, customers: c, mean_p30: round(p, 4), actual_rate: round(clamp(p * f * (1 + 0.05 * gauss(rc)), 0.001, 0.95), 4) });
        }
      }
    });
    return { accuracy: acc, calibration: cal };
  }
  function modelHealth(M) {
    var ac = accuracyAndCalibration(M);
    return { metrics: metricsRows(), accuracy: ac.accuracy, calibration: ac.calibration };
  }

  // ── router ───────────────────────────────────────────────────────────────
  D.register('/api/refill/', function (path, params, ctx) {
    path = String(path || '').replace(/^\/+|\/+$/g, '');
    if (path === 'session') return { signedIn: true, allowed: true, email: EMAIL };
    if (ctx && ctx.method && ctx.method !== 'GET') return { ok: true, demo: true, message: 'Demo mode: nothing was sent or saved.' };
    var M = model(), market = (params.get('market') || '').trim(), action = params.get('action') || '';
    switch (path) {
      case 'meta': return meta(M);
      case 'segments': return segments(M, market, params.get('by') === 'project' ? 'project' : 'market');
      case 'calendar': return calendar(M, market, action, clamp(parseInt(params.get('days'), 10) || 60, 1, MAX_OFFSET));
      case 'ab': return ab(M, market, action);
      case 'model': return modelHealth(M);
      default: return { __status: 404, error: 'Unknown demo route: ' + path };
    }
  });
})();
