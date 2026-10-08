/* Hub usage demo data (static hosting, no server).
 * Answers /api/hubusage/{session,meta,overview,apps,app,speed,errors,cost} in the browser with made-up numbers.
 * One small simulation (44 anonymous users, 27 Hub apps, ~15 months of days) feeds every route, so a
 * number on one page matches the same number on another (users per app, errors, speed, cost).
 * Nobody is named: like the real API it only returns counts. Everything here is illustrative. */
(function () {
  'use strict';
  var D = window.AdrialDemo;
  if (!D) return;

  var NM = 40, NA = 4, NU = NM + NA;      // 40 members + 4 admins (anonymous: only counts are ever returned)
  var NDAYS = 460, MS = 864e5;

  // id, member users, admin users, intensity, p50 ms, p95 ms, 5xx rate, 4xx rate, extras
  var SPEC = [
    ['mail', 38, 4, 3.2, 120, 850, 0.0003, 0.010, {}],
    ['erp', 26, 4, 2.4, 280, 2300, 0.0012, 0.014, { tr: 0.1, deg: 0.55 }],
    ['crm', 24, 3, 1.9, 190, 1500, 0.0006, 0.012, { tr: -0.25 }],
    ['analytics', 14, 4, 1.2, 900, 6400, 0.0030, 0.018, {}],
    ['invoices', 16, 3, 1.6, 210, 1700, 0.0008, 0.011, {}],
    ['billing', 9, 3, 1.0, 230, 1900, 0.0010, 0.011, {}],
    ['desk', 20, 3, 2.0, 170, 1300, 0.0005, 0.013, { tr: 0.5 }],
    ['ads', 7, 3, 0.9, 340, 3100, 0.0015, 0.012, { tr: 0.2 }],
    ['margin', 6, 2, 0.8, 260, 2400, 0.0007, 0.010, {}],
    ['refill', 8, 2, 1.0, 240, 2000, 0.0006, 0.010, {}],
    ['webshop', 5, 3, 0.9, 520, 5400, 0.0045, 0.020, {}],
    ['cs-quality', 6, 2, 0.8, 200, 1600, 0.0004, 0.009, {}],
    ['parcels', 7, 2, 0.9, 230, 1800, 0.0009, 0.012, {}],
    ['recon', 3, 3, 0.7, 410, 3600, 0.0022, 0.011, {}],
    ['stores', 10, 2, 1.1, 180, 1400, 0.0006, 0.011, { tr: -0.4 }],
    ['onboarding', 6, 1, 0.8, 190, 1250, 0.0004, 0.010, { first: 17 }],
    ['contracts', 5, 2, 0.6, 250, 1900, 0.0006, 0.010, {}],
    ['marketing', 4, 2, 0.6, 280, 2100, 0.0008, 0.010, {}],
    ['team-tasks', 28, 4, 2.6, 150, 700, 0.0003, 0.008, {}],
    ['branch-manager', 5, 2, 0.7, 220, 1700, 0.0007, 0.010, {}],
    ['client-atlas', 2, 1, 0.5, 300, 2200, 0.0010, 0.009, {}],
    ['pisarna-dms', 8, 2, 0.8, 330, 2600, 0.0011, 0.012, {}],
    ['postbench', 1, 1, 0.4, 260, 2000, 0.0010, 0.009, {}],
    ['design-compare', 3, 1, 0.5, 240, 1800, 0.0006, 0.009, { last: 58 }],
    ['showcase', 2, 1, 0.4, 150, 800, 0.0002, 0.008, {}],
    ['n8n', 0, 4, 1.1, 210, 1500, 0.0014, 0.010, {}],
    ['hub-usage', 3, 3, 0.6, 360, 2800, 0.0006, 0.009, {}],
  ];
  var PG = {
    'mail': 'inbox thread compose search settings',
    'erp': 'dashboard orders order-detail inventory suppliers reports settings',
    'crm': 'contacts contact-detail deals pipeline activities reports',
    'analytics': 'overview explorer funnels cohorts reports settings',
    'invoices': 'list invoice-detail new-invoice payments settings',
    'billing': 'overview subscriptions plans dunning reports',
    'desk': 'queue ticket-detail new-ticket customers macros reports',
    'ads': 'campaigns campaign-detail budgets creatives reports',
    'margin': 'overview products categories reports',
    'refill': 'overview forecast suppliers orders',
    'webshop': 'orders order-detail products catalogue-sync promotions reports',
    'cs-quality': 'reviews scorecards agents coaching',
    'parcels': 'shipments shipment-detail carriers returns',
    'recon': 'matching exceptions statements settings',
    'stores': 'overview store-detail staff opening-hours',
    'onboarding': 'checklists checklist-detail templates',
    'contracts': 'list contract-detail templates renewals',
    'marketing': 'calendar campaigns assets reports',
    'team-tasks': 'my-issues inbox board cycle projects issue-detail',
    'branch-manager': 'main bookings branches branch-detail export',
    'client-atlas': 'map client-detail segments',
    'pisarna-dms': 'documents document-detail upload search',
    'postbench': 'benchmarks runs settings',
    'design-compare': 'compare gallery',
    'showcase': 'index detail',
    'n8n': 'runs run-detail workflows failures',
    'hub-usage': 'overview apps speed errors cost',
  };

  // ── small helpers ────────────────────────────────────────────────────────
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function monday(day) { var d = D.parseDay(day); d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7); return D.iso(d); }
  function pickN(n, count, r) {
    var idx = [], i, j, t;
    for (i = 0; i < n; i++) idx.push(i);
    for (i = n - 1; i > 0; i--) { j = Math.floor(r() * (i + 1)); t = idx[i]; idx[i] = idx[j]; idx[j] = t; }
    return idx.slice(0, count);
  }
  /** split an integer total over weights (largest remainder), sums exactly to total */
  function alloc(total, ws) {
    var n = ws.length, out = [], sum = 0, i, used = 0, fr = [];
    for (i = 0; i < n; i++) sum += ws[i];
    for (i = 0; i < n; i++) { var x = total * ws[i] / sum; out[i] = Math.floor(x); fr.push([x - out[i], i]); used += out[i]; }
    fr.sort(function (a, b) { return b[0] - a[0]; });
    for (i = 0; used < total && i < n; i++, used++) out[fr[i][1]]++;
    return out;
  }
  function wavg(sw, swv) { return sw > 0 ? Math.round(swv / sw) : null; }
  function bad(msg) { return { __status: 400, error: msg }; }

  // ── the simulation (built once per page load) ────────────────────────────
  var M = null;
  function build() {
    var Tm = D.addDays(D.today(), -1), Sd = D.addDays(Tm, -(NDAYS - 1)), dates = [], i, u, k;
    for (i = 0; i < NDAYS; i++) dates.push(D.iso(D.addDays(Sd, i)));
    var wkd = dates.map(function (d) { return D.parseDay(d).getUTCDay(); });
    var wmon = dates.map(monday);

    var ur = D.rng('hubusage|users'), base = [];
    for (u = 0; u < NU; u++) base.push(u >= NM ? ur.between(0.5, 0.85) : ur.between(0.3, 0.95));

    var apps = SPEC.map(function (s) {
      var x = s[8], r = D.rng('hubusage|members|' + s[0]);
      var mem = pickN(NM, s[1], r), adm = pickN(NA, s[2], r).map(function (n) { return NM + n; });
      var a = { id: s[0], users: mem.concat(adm), int: s[3], p50: s[4], p95: s[5], r5: s[6], r4: s[7], tr: x.tr || 0, deg: x.deg || 0,
        i0: x.first != null ? NDAYS - 1 - x.first : 0, i1: x.last != null ? NDAYS - 1 - x.last : NDAYS - 1 };
      a.ev = new Array(NDAYS).fill(0); a.op = new Array(NDAYS).fill(0);
      a.us = []; for (i = 0; i < NDAYS; i++) a.us.push([]);
      return a;
    });
    var byId = {}; apps.forEach(function (a) { byId[a.id] = a; });
    var userApps = []; for (u = 0; u < NU; u++) userApps.push([]);
    apps.forEach(function (a) { a.users.forEach(function (n) { userApps[n].push(a); }); });

    // who is active when
    var act = []; for (u = 0; u < NU; u++) act.push(new Uint8Array(NDAYS));
    for (i = 0; i < NDAYS; i++) {
      var date = dates[i], weekend = wkd[i] === 0 || wkd[i] === 6, sh = D.shape(date), ago = NDAYS - 1 - i;
      for (u = 0; u < NU; u++) {
        var r = D.rng('hu|' + u + '|' + date), away = D.rng('away|' + u + '|' + wmon[i])() < 0.07;
        var p = weekend ? 0.07 : clamp(base[u] * sh, 0, 0.97);
        if (away) p = weekend ? 0 : 0.02;
        if (r() >= p) continue;
        var opened = [], avail = [];
        for (k = 0; k < userApps[u].length; k++) {
          var a = userApps[u][k];
          if (i < a.i0 || i > a.i1) continue;
          avail.push(a);
          var q = Math.min(0.92, (0.06 + a.int * 0.14) * clamp(1 + a.tr * (1 - ago / 90), 0.2, 2.5));
          if (r() < q) opened.push(a);
        }
        if (!opened.length && avail.length) {
          var tot = 0; avail.forEach(function (c) { tot += c.int; });
          var pick = r() * tot, acc = 0;
          for (k = 0; k < avail.length; k++) { acc += avail[k].int; if (pick <= acc) { opened.push(avail[k]); break; } }
          if (!opened.length) opened.push(avail[0]);
        }
        if (!opened.length) continue;
        act[u][i] = 1;
        opened.forEach(function (a) {
          var opens = 1 + (r() < 0.5 ? 1 : 0) + (r() < 0.25 ? 1 : 0) + (a.int > 2 && r() < 0.5 ? 1 : 0);
          a.op[i] += opens; a.ev[i] += opens * (3 + Math.floor(r() * 8)); a.us[i].push(u);
        });
      }
    }

    // requests, speed and errors per app and day
    apps.forEach(function (a) {
      var rk = D.rng('hubusage|k|' + a.id), tk = rk.between(1.7, 2.3);
      a.timed = []; a.sl = []; a.e5 = []; a.e4 = []; a.p50d = []; a.p95d = [];
      for (i = 0; i < NDAYS; i++) {
        if (!a.ev[i]) { a.timed.push(0); a.sl.push(0); a.e5.push(0); a.e4.push(0); a.p50d.push(null); a.p95d.push(null); continue; }
        var r = D.rng('ad|' + a.id + '|' + dates[i]), ago = NDAYS - 1 - i;
        var tm = Math.max(1, Math.floor(a.ev[i] * tk * r.between(0.92, 1.1) + r()));
        var spike = r() < 0.03, inc = r() < 0.008 && a.r5 >= 0.0005;
        var dg = a.deg ? 1 + a.deg * clamp(1 - ago / 40, 0, 1) : 1;
        var p95 = a.p95 * dg * r.between(0.82, 1.22) * (spike ? 1.7 : 1) * (inc ? 2 : 1) * (wkd[i] === 0 || wkd[i] === 6 ? 0.95 : 1);
        var p50 = Math.min(p95 * 0.55, a.p50 * r.between(0.9, 1.12));
        a.timed.push(tm); a.p95d.push(Math.round(p95)); a.p50d.push(Math.round(p50));
        a.sl.push(Math.min(tm, Math.floor(tm * clamp((p95 - 1500) / 60000, 0, 0.12) + r())));
        a.e5.push(Math.floor(tm * a.r5 * r.between(0.4, 1.8) * (inc ? r.between(12, 35) : 1) + r()));
        a.e4.push(Math.floor(tm * a.r4 * r.between(0.6, 1.5) + r()));
      }
      // pages and endpoints
      var names = PG[a.id].split(' '), heavy = /report|explorer|cohort|funnel|forecast|sync|matching|search|failures|export/, light = /settings|compose|index|upload|hours|templates/;
      var ps = names.map(function (n, k) { return { key: n, w: Math.pow(0.62, k) + 0.04, mult: heavy.test(n) ? 1.9 : light.test(n) ? 0.6 : 1, ew: (heavy.test(n) ? 3 : 1) * (k === 0 ? 1.4 : 1) }; });
      var last = names.length - 1;
      var rt = [['GET', 'list', 0, 0.30, 1, 1], ['GET', ':id', Math.min(1, last), 0.22, 0.9, 1], ['POST', ':id', Math.min(1, last), 0.08, 1.5, 3],
        ['GET', 'search', last, 0.10, 1.7, 1.5], ['GET', 'summary', 0, 0.18, 1.9, 2], ['POST', 'export', last, 0.04, 2.4, 2]]
        .map(function (x) { return { key: x[0] + ' /api/' + a.id + '/' + x[1], method: x[0], route: '/api/' + a.id + '/' + x[1], page: names[x[2]], w: x[3], mult: x[4], ew: x[5] }; });
      [ps, rt].forEach(function (list) {
        var sw = 0, sm = 0; list.forEach(function (x) { sw += x.w; }); list.forEach(function (x) { sm += x.w / sw * x.mult; });
        list.forEach(function (x) { x.mult /= sm; });
      });
      a.units = { p: ps, r: rt };
    });

    return { T: D.iso(Tm), S: Sd, dates: dates, wmon: wmon, wkd: wkd, apps: apps, byId: byId, act: act, UC: {} };
  }
  function model() { return M || (M = build()); }
  function idx(day) { return Math.round((D.parseDay(day) - model().S) / MS); }
  function cl(i) { return clamp(i, 0, NDAYS - 1); }

  // ── aggregation helpers ──────────────────────────────────────────────────
  function appAgg(a, i0, i1) {
    var m = model(), seen = {}, o = { users: 0, members: 0, opens: 0, events: 0, days: 0, timed: 0, slow: 0, e5: 0, e4: 0, p50: null, p95: null, first: null, last: null }, sw = 0, s50 = 0, s95 = 0;
    for (var i = cl(i0); i <= cl(i1); i++) {
      if (!a.ev[i]) continue;
      o.days++; o.opens += a.op[i]; o.events += a.ev[i]; o.timed += a.timed[i]; o.slow += a.sl[i]; o.e5 += a.e5[i]; o.e4 += a.e4[i];
      sw += a.timed[i]; s50 += a.timed[i] * a.p50d[i]; s95 += a.timed[i] * a.p95d[i];
      a.us[i].forEach(function (u) { if (!seen[u]) { seen[u] = 1; o.users++; if (u < NM) o.members++; } });
      if (o.first == null) o.first = i; o.last = i;
    }
    o.p50 = wavg(sw, s50); o.p95 = wavg(sw, s95);
    return o;
  }
  function unitDay(a, kind, di) {
    var m = model(), key = kind + a.id + di;
    if (m.UC[key]) return m.UC[key];
    var units = a.units[kind], n = units.length, out = [], k;
    var tm = a.timed[di];
    if (!tm) { for (k = 0; k < n; k++) out.push({ ev: 0, tm: 0, e5: 0, e4: 0, sl: 0, p50: null, p95: null, mx: null }); return (m.UC[key] = out); }
    var r = D.rng('un|' + kind + '|' + a.id + '|' + m.dates[di]);
    var wn = units.map(function (x) { return x.w * r.between(0.8, 1.2); });
    var aEv = alloc(kind === 'p' ? a.ev[di] : 0, wn), aTm = alloc(kind === 'p' ? tm : Math.round(tm * 0.8), wn);
    var aE5 = alloc(a.e5[di], units.map(function (x) { return x.ew * r.between(0.5, 1.6); }));
    var aE4 = alloc(a.e4[di], units.map(function (x) { return x.ew * r.between(0.5, 1.6); }));
    var aSl = alloc(a.sl[di], units.map(function (x) { return x.w * x.mult * x.mult * r.between(0.7, 1.3); }));
    for (k = 0; k < n; k++) {
      var t = aTm[k], o = { ev: aEv[k], tm: t, e5: aE5[k], e4: aE4[k], sl: Math.min(aSl[k], t), p50: null, p95: null, mx: null };
      if (t > 0) {
        o.p95 = Math.round(a.p95d[di] * units[k].mult * r.between(0.85, 1.2));
        o.p50 = Math.round(Math.min(o.p95 * 0.6, a.p50d[di] * units[k].mult * r.between(0.9, 1.12)));
        o.mx = Math.round(o.p95 * r.between(1.5, 3.2));
      }
      out.push(o);
    }
    return (m.UC[key] = out);
  }
  /** per page/route totals over a day range */
  function unitAgg(a, kind, i0, i1, wk) {
    var m = model(), units = a.units[kind], res = units.map(function (x) { return { u: x, ev: 0, tm: 0, e5: 0, e4: 0, sl: 0, sw: 0, s50: 0, s95: 0, mx: 0, lastUsed: null, last5: null, last4: null, weeks: {} }; });
    for (var i = cl(i0); i <= cl(i1); i++) {
      if (!a.timed[i]) continue;
      var day = unitDay(a, kind, i);
      for (var k = 0; k < day.length; k++) {
        var d = day[k], g = res[k];
        g.ev += d.ev; g.tm += d.tm; g.e5 += d.e5; g.e4 += d.e4; g.sl += d.sl;
        if (d.tm > 0) { g.sw += d.tm; g.s50 += d.tm * d.p50; g.s95 += d.tm * d.p95; if (d.mx > g.mx) g.mx = d.mx; }
        if (d.ev > 0 || (kind === 'r' && d.tm > 0)) g.lastUsed = i;
        if (d.e5 > 0) { g.last5 = i; g.weeks[m.wmon[i]] = 1; }
        if (d.e4 > 0) { g.last4 = i; g.weeks[m.wmon[i]] = 1; }
      }
    }
    res.forEach(function (g) { g.p50 = wavg(g.sw, g.s50); g.p95 = wavg(g.sw, g.s95); });
    return res;
  }
  function dt(i) { return i == null ? null : model().dates[i]; }
  function range(params) {
    var f = params.get('from'), t = params.get('to'), re = /^\d{4}-\d{2}-\d{2}$/;
    if (!re.test(f || '') || !re.test(t || '')) return null;
    var i0 = idx(f), i1 = idx(t);
    if (i1 < i0) return null;
    return { i0: cl(i0), i1: cl(i1) };
  }
  function weekList(i0, i1) {
    var m = model(), out = [], seen = {};
    for (var i = i0; i <= i1; i++) if (!seen[m.wmon[i]]) { seen[m.wmon[i]] = 1; out.push({ week: m.wmon[i], i0: i, i1: Math.min(i1, idx(D.iso(D.addDays(D.parseDay(m.wmon[i]), 6)))) }); }
    // a week that starts before the range is counted from its Monday
    out.forEach(function (w) { w.i0 = cl(idx(w.week)); });
    return out;
  }

  // ── routes ───────────────────────────────────────────────────────────────
  function meta() {
    var m = model(), iT = NDAYS - 1;
    var apps = m.apps.slice().sort(function (x, y) { return x.id < y.id ? -1 : 1; }).map(function (a) {
      var w30 = appAgg(a, iT - 29, iT), wp = appAgg(a, iT - 59, iT - 30), w7 = appAgg(a, iT - 6, iT), w90 = appAgg(a, iT - 89, iT), all = appAgg(a, 0, iT);
      return {
        app_id: a.id, users_30d: w30.users, member_users_30d: w30.members, users_prev_30d: wp.users, users_7d: w7.users, users_90d: w90.users,
        opens_30d: w30.opens, events_30d: w30.events, active_days_30d: w30.days, p50_30d: w30.p50, p95_30d: w30.p95, p95_prev_30d: wp.p95,
        timed_30d: w30.timed, slow_5s_30d: w30.slow, errors_5xx_30d: w30.e5, errors_4xx_30d: w30.e4, last_seen: dt(all.last), first_seen: dt(all.first),
      };
    });
    var first = m.dates[20], cost = m.dates[NDAYS - 2], stamp = D.iso(D.today()) + 'T04:20:00Z';
    return {
      dataThrough: m.T, costThrough: cost,
      freshness: [{ source: 'Hub usage events', first_day: first, data_through: m.T, refreshed_at: stamp }, { source: 'Cloud billing export', first_day: first, data_through: cost, refreshed_at: stamp }],
      apps: apps,
    };
  }

  function overview(params) {
    var m = model(), rg = range(params);
    if (!rg) return bad('from and to must be dates (YYYY-MM-DD)');
    var days = [], i, u, a, k;
    function distinct(d0, d1, onlyMembers) {
      var n = 0;
      for (u = 0; u < (onlyMembers ? NM : NU); u++) for (k = Math.max(0, d0); k <= d1; k++) if (m.act[u][k]) { n++; break; }
      return n;
    }
    for (i = rg.i0; i <= rg.i1; i++) {
      var ev = 0, op = 0, tm = 0, e5 = 0, us = 0;
      m.apps.forEach(function (a) { ev += a.ev[i]; op += a.op[i]; tm += a.timed[i]; e5 += a.e5[i]; });
      for (u = 0; u < NU; u++) us += m.act[u][i];
      days.push({ date: m.dates[i], users: us, users_7d: distinct(i - 6, i), users_28d: distinct(i - 27, i), member_users_7d: distinct(i - 6, i, true), events: ev, opens: op, errors_5xx: e5, timed: tm });
    }
    var weeks = weekList(rg.i0, rg.i1).map(function (w) {
      var sw = 0, s50 = 0, s95 = 0;
      m.apps.forEach(function (a) { for (var j = w.i0; j <= w.i1; j++) if (a.timed[j]) { sw += a.timed[j]; s50 += a.timed[j] * a.p50d[j]; s95 += a.timed[j] * a.p95d[j]; } });
      return { week: w.week, users: distinct(w.i0, w.i1), p95_ms: wavg(sw, s95), p50_ms: wavg(sw, s50) };
    });
    return { days: days, weeks: weeks };
  }

  function appsRoute() {
    var m = model(), iT = NDAYS - 1, lastW = monday(m.T), wl = [], i;
    for (i = 11; i >= 0; i--) wl.push(D.iso(D.addDays(D.parseDay(lastW), -7 * i)));
    var rows = [];
    m.apps.forEach(function (a) {
      wl.forEach(function (wk) {
        var i0 = idx(wk), g = appAgg(a, i0, Math.min(i0 + 6, iT));
        if (g.users > 0) rows.push({ app_id: a.id, week: wk, users: g.users });
      });
    });
    return { weeks: rows };
  }

  function appDetail(params) {
    var m = model(), a = m.byId[params.get('app') || ''];
    if (!params.get('app')) return bad('app is required');
    if (!a) return { __status: 404, error: 'Unknown app' };
    var rg = range(params);
    if (!rg) return bad('from and to must be dates (YYYY-MM-DD)');
    var days = [], i;
    for (i = rg.i0; i <= rg.i1; i++) {
      var us = a.us[i], t = a.timed[i];
      days.push({ date: m.dates[i], users: us.length, member_users: us.filter(function (u) { return u < NM; }).length, timed: t, p95_ms: t ? a.p95d[i] : null, p50_ms: t ? a.p50d[i] : null, errors_5xx: a.e5[i], errors_4xx: a.e4[i] });
    }
    var w30 = appAgg(a, rg.i1 - 29, rg.i1);
    var pages = [], pageDays = [], routes = [];
    unitAgg(a, 'p', rg.i1 - 29, rg.i1).forEach(function (g, k) {
      if (!g.tm && !g.ev) return;
      var r = D.rng('pu|' + a.id + '|' + g.u.key);
      pages.push({ page: g.u.key, users: g.ev ? Math.min(w30.users, Math.max(1, Math.round(w30.users * clamp(1 - 0.13 * k, 0.25, 1) * r.between(0.9, 1)))) : 0, events: g.ev, timed: g.tm,
        p50_ms: g.p50, p95_ms: g.p95, max_ms: g.tm ? g.mx : null, slow_5s: g.sl, errors_5xx: g.e5, errors_4xx: g.e4, last_used: dt(g.lastUsed), last_5xx: dt(g.last5), last_4xx: dt(g.last4) });
    });
    for (i = rg.i0; i <= rg.i1; i++) {
      if (!a.timed[i]) continue;
      unitDay(a, 'p', i).forEach(function (d, k) { if (d.tm >= 3) pageDays.push({ page: a.units.p[k].key, date: m.dates[i], p95_ms: d.p95 }); });
    }
    unitAgg(a, 'r', rg.i1 - 29, rg.i1).forEach(function (g) {
      if (!g.tm) return;
      var le = Math.max(g.last5 == null ? -1 : g.last5, g.last4 == null ? -1 : g.last4);
      routes.push({ method: g.u.method, route: g.u.route, page: g.u.page, timed: g.tm, p50_ms: g.p50, p95_ms: g.p95, max_ms: g.mx, slow_5s: g.sl, errors_5xx: g.e5, errors_4xx: g.e4, last_error: le < 0 ? null : m.dates[le] });
    });
    return { app: a.id, days: days, pages: pages, pageDays: pageDays, routes: routes };
  }

  function speed(params) {
    var m = model(), rg = range(params);
    if (!rg) return bad('from and to must be dates (YYYY-MM-DD)');
    var only = params.get('app') || '', wl = weekList(rg.i0, rg.i1), apps = [], pages = [];
    m.apps.forEach(function (a) {
      wl.forEach(function (w) {
        var g = appAgg(a, w.i0, w.i1);
        if (!g.timed) return;
        apps.push({ app_id: a.id, week: w.week, timed: g.timed, slow_5s: g.slow, p95_ms: g.p95 });
        if (only && only !== a.id) return;
        var rows = unitAgg(a, 'p', w.i0, w.i1).filter(function (x) { return x.tm >= 3; }).sort(function (x, y) { return y.p95 - x.p95; }).slice(0, 10);
        rows.forEach(function (x) { pages.push({ app_id: a.id, page: x.u.key, week: w.week, timed: x.tm, slow_5s: x.sl, errors_4xx: x.e4, errors_5xx: x.e5, p95_ms: x.p95, max_ms: x.mx }); });
      });
    });
    return { apps: apps, pages: pages };
  }

  function errors(params) {
    var m = model(), rg = range(params);
    if (!rg) return bad('from and to must be dates (YYYY-MM-DD)');
    var only = params.get('app') || '', i, totals = [], days = [];
    if (only && !m.byId[only]) return { __status: 404, error: 'Unknown app' };
    for (i = rg.i0; i <= rg.i1; i++) {
      var e5 = 0, e4 = 0;
      m.apps.forEach(function (a) { e5 += a.e5[i]; e4 += a.e4[i]; });
      totals.push({ date: m.dates[i], errors_4xx: e4, errors_5xx: e5 });
      if (only) days.push({ date: m.dates[i], errors_4xx: m.byId[only].e4[i], errors_5xx: m.byId[only].e5[i] });
    }
    var apps = [], pages = [], routes = [], wk0 = cl(idx(monday(m.dates[rg.i0])));
    m.apps.forEach(function (a) {
      if (only && only !== a.id) return;
      var g = appAgg(a, rg.i0, rg.i1), d5 = 0, l5 = null, l4 = null;
      for (i = rg.i0; i <= rg.i1; i++) { if (a.e5[i]) { d5++; l5 = i; } if (a.e4[i]) l4 = i; }
      if (g.timed || g.e5 || g.e4) apps.push({ app_id: a.id, timed: g.timed, errors_5xx: g.e5, errors_4xx: g.e4, days_with_5xx: d5, last_5xx: dt(l5), last_4xx: dt(l4) });
      unitAgg(a, 'p', wk0, rg.i1).forEach(function (x) {
        if (!x.e5 && !x.e4) return;
        var lw = Math.max(x.last5 == null ? -1 : x.last5, x.last4 == null ? -1 : x.last4);
        pages.push({ app_id: a.id, page: x.u.key, timed: x.tm, errors_5xx: x.e5, errors_4xx: x.e4, weeks_with_errors: Object.keys(x.weeks).length, last_week: m.wmon[lw] });
      });
      unitAgg(a, 'r', rg.i1 - 29, rg.i1).forEach(function (x) {
        if (!x.e5 && !x.e4) return;
        var le = Math.max(x.last5 == null ? -1 : x.last5, x.last4 == null ? -1 : x.last4);
        routes.push({ app_id: a.id, method: x.u.method, route: x.u.route, timed: x.tm, errors_5xx: x.e5, errors_4xx: x.e4, last_error: m.dates[le] });
      });
    });
    return { totals: totals, days: only ? days : totals, apps: apps, pages: pages, routes: routes };
  }

  // ── cost ─────────────────────────────────────────────────────────────────
  // [project, service, attribution, workload, hub_app, base USD/day, kind, credit share]
  var WL = [
    ['adrial-hub', 'Cloud Run', 'Cloud Run service', 'adrial-hub', '(hub platform)', 2.10, 'run:*', 0.18],
    ['adrial-hub', 'Cloud Run', 'Cloud Run service', 'erp-api', 'erp', 0.95, 'run:erp', 0.18],
    ['adrial-hub', 'Cloud Run', 'Cloud Run service', 'crm-api', 'crm', 0.62, 'run:crm', 0.18],
    ['adrial-hub', 'Cloud Run', 'Cloud Run service', 'analytics-api', 'analytics', 0.88, 'run:analytics', 0.18],
    ['adrial-hub', 'Cloud Run', 'Cloud Run service', 'invoices-api', 'invoices', 0.41, 'run:invoices', 0.18],
    ['adrial-hub', 'Cloud Run', 'Cloud Run service', 'billing-api', 'billing', 0.36, 'run:billing', 0.18],
    ['adrial-hub', 'Cloud Run', 'Cloud Run service', 'desk-api', 'desk', 0.52, 'run:desk', 0.18],
    ['adrial-hub', 'Cloud Run', 'Cloud Run service', 'ads-api', 'ads', 0.33, 'run:ads', 0.18],
    ['adrial-hub', 'Cloud Run', 'Cloud Run service', 'margin-api', 'margin', 0.21, 'run:margin', 0.18],
    ['adrial-hub', 'Cloud Run', 'Cloud Run service', 'refill-api', 'refill', 0.24, 'run:refill', 0.18],
    ['adrial-hub', 'Cloud Run', 'Cloud Run service', 'webshop-api', 'webshop', 0.74, 'run:webshop', 0.18],
    ['adrial-hub', 'Cloud Run', 'Cloud Run service', 'parcels-api', 'parcels', 0.27, 'run:parcels', 0.18],
    ['adrial-hub', 'Cloud Run', 'Cloud Run service', 'recon-api', 'recon', 0.19, 'run:recon', 0.18],
    ['adrial-hub', 'Cloud Run', 'Cloud Run service', 'stores-api', 'stores', 0.22, 'run:stores', 0.18],
    ['adrial-hub', 'Cloud Run', 'Cloud Run service', 'team-tasks-api', 'team-tasks', 0.45, 'run:team-tasks', 0.18],
    ['adrial-hub', 'Cloud Run', 'Cloud Run service', 'cs-quality-api', 'cs-quality', 0.12, 'run:cs-quality', 0.18],
    ['adrial-hub', 'Cloud Run', 'Cloud Run service', 'mail-api', 'mail', 0.70, 'run:mail', 0.18],
    ['adrial-hub', 'Cloud Run', 'Cloud Run service', 'onboarding-api', 'onboarding', 0.15, 'run:onboarding', 0.18],
    ['adrial-data', 'Cloud Run', 'Cloud Run job', 'nightly-sync', '', 0.35, 'steady', 0.18],
    ['adrial-data', 'BigQuery', 'BigQuery job label', 'app=analytics', 'analytics', 1.80, 'bq', 0.08],
    ['adrial-data', 'BigQuery', 'BigQuery job label', 'app=margin', 'margin', 0.90, 'bq', 0.08],
    ['adrial-data', 'BigQuery', 'BigQuery job label', 'app=ads', 'ads', 0.70, 'bq', 0.08],
    ['adrial-data', 'BigQuery', 'BigQuery job label', 'app=webshop', 'webshop', 0.60, 'bq', 0.08],
    ['adrial-data', 'BigQuery', 'BigQuery job label', 'app=erp', 'erp', 0.55, 'bq', 0.08],
    ['adrial-data', 'BigQuery', 'BigQuery job label', 'app=recon', 'recon', 0.50, 'bq', 0.08],
    ['adrial-data', 'BigQuery', 'BigQuery job label', 'app=refill', 'refill', 0.40, 'bq', 0.08],
    ['adrial-data', 'BigQuery', 'BigQuery job label', 'app=cs-quality', 'cs-quality', 0.20, 'bq', 0.08],
    ['adrial-data', 'BigQuery', 'BigQuery unlabelled jobs', '(no app label)', '', 7.00, 'bq', 0.08],
    ['adrial-data', 'BigQuery', 'BigQuery scheduled query', 'daily_margin_rollup', '', 0.55, 'steady', 0.05],
    ['adrial-data', 'BigQuery', 'BigQuery scheduled query', 'orders_refresh', '', 0.40, 'steady', 0.05],
    ['adrial-data', 'BigQuery', 'BigQuery storage', 'dataset sales_raw', '', 0.85, 'grow', 0],
    ['adrial-data', 'BigQuery', 'BigQuery storage', 'dataset ads_export', '', 0.46, 'grow', 0],
    ['adrial-data', 'BigQuery', 'BigQuery storage', 'dataset hub_usage', '', 0.12, 'grow', 0],
    ['adrial-data', 'BigQuery', 'BigQuery storage', 'dataset billing_export', '', 0.09, 'grow', 0],
    ['adrial-data', 'Cloud Storage', 'Cloud Storage bucket', 'bucket adrial-docs', '', 0.31, 'grow', 0],
    ['adrial-data', 'Cloud Storage', 'Cloud Storage bucket', 'bucket adrial-exports', '', 0.22, 'grow', 0],
    ['adrial-hub', 'Cloud Logging', 'Other resource', 'Log storage', '', 0.60, 'steady', 0.1],
    ['adrial-hub', 'Artifact Registry', 'Other resource', 'Container images', '', 0.28, 'grow', 0],
    ['adrial-hub', 'Cloud Scheduler', 'Other resource', 'Scheduled jobs', '', 0.06, 'steady', 0],
    ['adrial-hub', 'Secret Manager', 'Other resource', 'Secrets', '', 0.03, 'steady', 0],
    ['adrial-hub', 'Networking', 'Other resource', 'Egress', '', 0.40, 'steady', 0],
  ];
  var MEANEV = {};
  function meanEv(id) {
    if (MEANEV[id] != null) return MEANEV[id];
    var m = model(), s = 0, n = 0, i;
    for (i = 0; i < NDAYS; i++) { var e = 0; if (id === '*') m.apps.forEach(function (a) { e += a.ev[i]; }); else e = m.byId[id].ev[i]; s += e; n++; }
    return (MEANEV[id] = Math.max(1, s / n));
  }
  function evOn(id, i) { var m = model(); if (i < 0) return meanEv(id); if (id === '*') { var e = 0; m.apps.forEach(function (a) { e += a.ev[i]; }); return e; } return m.byId[id].ev[i]; }

  function cost(params) {
    var m = model(), rg = range(params);
    if (!rg) return bad('from and to must be dates (YYYY-MM-DD)');
    var costThru = NDAYS - 2, i1 = Math.min(rg.i1, costThru), days = [], wl = [], sums = {}, i;
    WL.forEach(function (w, wi) {
      var gross = 0, credits = 0, net = 0, n = 0;
      for (i = rg.i0; i <= i1; i++) {
        var date = m.dates[i], wd = m.wkd[i], weekend = wd === 0 || wd === 6, r = D.rng('cost|' + w[3] + '|' + date), kind = w[6], f;
        if (w[3] === 'onboarding-api' && i < NDAYS - 1 - 17) continue;
        if (kind.indexOf('run:') === 0) f = 0.5 + 0.5 * Math.min(2.2, (evOn(kind.slice(4), i) + 1) / meanEv(kind.slice(4)));
        else if (kind === 'bq') f = (weekend ? 0.35 : 1) * D.shape(date) * r.between(0.6, 1.5) * (r() < 0.06 ? r.between(2, 3.2) : 1);
        else if (kind === 'grow') f = 1 + 0.0007 * i;
        else f = 1;
        var g = Math.round(w[5] * f * r.between(0.95, 1.05) * 1e4) / 1e4, c = -Math.round(g * w[7] * 1e4) / 1e4, net1 = Math.round((g + c) * 1e4) / 1e4;
        gross += g; credits += c; net += net1; n++;
        var k = date + '|' + w[1];
        sums[k] = (sums[k] || 0) + net1;
      }
      if (n) wl.push({ project_id: w[0], service: w[1], attribution: w[2], workload: w[3], hub_app: w[4], gross_cost: Math.round(gross * 1e4) / 1e4, credits: Math.round(credits * 1e4) / 1e4, cost: Math.round(net * 1e4) / 1e4, currency: 'USD', days: n });
    });
    Object.keys(sums).sort().forEach(function (k) { var p = k.split('|'); days.push({ date: p[0], service: p[1], cost: Math.round(sums[k] * 1e4) / 1e4 }); });
    return { costThrough: m.dates[costThru], days: days, workloads: wl };
  }

  // ── router ───────────────────────────────────────────────────────────────
  D.register('/api/hubusage/', function (path, params) {
    path = String(path || '').replace(/\/+$/, '');
    switch (path) {
      case 'session': return { signedIn: true, allowed: true, email: 'demo@adrial.example' };
      case 'meta': return meta();
      case 'overview': return overview(params);
      case 'apps': return appsRoute();
      case 'app': return appDetail(params);
      case 'speed': return speed(params);
      case 'errors': return errors(params);
      case 'cost': return cost(params);
      default: return { __status: 404, error: 'Unknown Hub usage endpoint' };
    }
  });
})();
