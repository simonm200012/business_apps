/* Demo answers for /api/margin/* (made-up data for a fictional optics retailer; nothing here is real).
 * Loaded after /_shared/demo-api.js and before app.js. One synthetic sales model (stores + web shops x brands x
 * price lists x discount codes x days) is summed up for every route, so totals reconcile across pages:
 *   session, meta, overview, codes, code, pricelists, brands, alerts.
 * Same filters and dates always give the same numbers. */
(function () {
  'use strict';
  var AD = window.AdrialDemo;
  if (!AD) return;

  var DAY = 864e5, NF = 7, ND = 7;
  var DN0 = Math.round(Date.UTC(2024, 0, 1) / DAY);

  function dnOf(s) { var d = AD.parseDay(s); return d ? Math.round(d.getTime() / DAY) : null; }
  function isoOf(dn) { return AD.iso(new Date(dn * DAY)); }
  function r2(x) { return Math.round(x * 100) / 100; }
  function fix(x) { return Math.round(x * 100) / 100; }
  function h2(a, b) {
    var x = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
    x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d); x ^= x >>> 12; x = Math.imul(x, 0x297a2d39); x ^= x >>> 15;
    return (x >>> 0) / 4294967296;
  }

  // ── Model definition ─────────────────────────────────────────────────────
  var CATS = ['Contact lenses', 'Frames', 'Sunglasses', 'Solutions', 'Accessories'];
  var CAT_SHARE = [0.38, 0.30, 0.17, 0.09, 0.06];
  var CAT_LINE = [38, 140, 120, 14, 9];          // average revenue of one line
  var CAT_UPL = [2.1, 1.0, 1.0, 1.4, 1.6];       // units per line
  // seasonality by month (Jan..Dec)
  var CAT_SEASON = [
    [1.05, 1.0, 1.0, 1.0, 1.0, 0.98, 0.97, 0.98, 1.02, 1.02, 1.0, 1.0],
    [0.95, 0.95, 1.0, 1.0, 1.0, 0.95, 0.9, 0.95, 1.1, 1.1, 1.05, 1.15],
    [0.45, 0.5, 0.8, 1.2, 1.5, 1.7, 1.7, 1.5, 1.0, 0.65, 0.45, 0.5],
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.05],
    [0.95, 0.95, 1, 1, 1, 1, 1, 1, 1, 1, 1.05, 1.25]
  ];
  var BRANDS = [
    { n: 'Daily Clear', c: 0, w: 0.35, m: 0.46 }, { n: 'AquaSoft', c: 0, w: 0.28, m: 0.52 },
    { n: 'Monthly Bright', c: 0, w: 0.22, m: 0.50 }, { n: 'ToricFit', c: 0, w: 0.15, m: 0.44 },
    { n: 'Nordlight', c: 1, w: 0.30, m: 0.64 }, { n: 'Kvarner Lines', c: 1, w: 0.25, m: 0.67 },
    { n: 'Bohinj Studio', c: 1, w: 0.25, m: 0.60 }, { n: 'Savanna Classic', c: 1, w: 0.20, m: 0.58 },
    { n: 'Sunvale', c: 2, w: 0.30, m: 0.62 }, { n: 'Coastline', c: 2, w: 0.28, m: 0.60 },
    { n: 'Velo Sun', c: 2, w: 0.24, m: 0.57 }, { n: 'Karst Shades', c: 2, w: 0.18, m: 0.55 },
    { n: 'PureSol', c: 3, w: 0.45, m: 0.56 }, { n: 'ClearDrop', c: 3, w: 0.35, m: 0.60 }, { n: 'EyeCalm', c: 3, w: 0.20, m: 0.58 },
    { n: 'LensCase Co', c: 4, w: 0.60, m: 0.66 }, { n: 'Wipe & Go', c: 4, w: 0.40, m: 0.70 }
  ];
  var PROJECTS = [
    { id: 'optika-si', name: 'Adrial Optika SI', market: 'Slovenia', group: 'Adrial Retail', cats: [0, 1, 2, 3, 4] },
    { id: 'optika-hr', name: 'Adrial Optika HR', market: 'Croatia', group: 'Adrial Retail', cats: [0, 1, 2, 3, 4] },
    { id: 'lensico-si', name: 'Lensico SI', market: 'Slovenia', group: 'Adrial Online', cats: [0, 3, 4] },
    { id: 'lensico-hr', name: 'Lensico HR', market: 'Croatia', group: 'Adrial Online', cats: [0, 3, 4] },
    { id: 'sunvale', name: 'Sunvale Shades', market: 'Slovenia', group: 'Adrial Online', cats: [2, 4] }
  ];
  // kind: 0 store, 1 online, 2 B2B; base = average revenue per day before seasonality
  var PAIRS = [
    { p: 0, ch: 'Ljubljana', kind: 0, base: 5200 }, { p: 0, ch: 'Maribor', kind: 0, base: 2500 },
    { p: 0, ch: 'Celje', kind: 0, base: 1700 }, { p: 0, ch: 'Koper', kind: 0, base: 1500 },
    { p: 1, ch: 'Zagreb', kind: 0, base: 4800 }, { p: 1, ch: 'Split', kind: 0, base: 2300 },
    { p: 0, ch: 'Online', kind: 1, base: 5200 }, { p: 1, ch: 'Online', kind: 1, base: 3300 },
    { p: 2, ch: 'Online', kind: 1, base: 2600 }, { p: 3, ch: 'Online', kind: 1, base: 1900 },
    { p: 4, ch: 'Online', kind: 1, base: 1200 },
    { p: 0, ch: 'B2B', kind: 2, base: 1700, cats: [0, 1, 3] }
  ];
  // d: share of the price given away; ship: margin points lost to free delivery; share: share of a shop/brand's revenue
  var CODES = [
    { code: 'WELCOME10', kind: 'Discount', desc: '10 % off the first online order', d: 0.10, kinds: [1], share: 0.045 },
    { code: 'NEWS5', kind: 'Discount', desc: '5 % for newsletter subscribers', d: 0.05, kinds: [1], share: 0.05 },
    { code: 'LENS15', kind: 'Discount', desc: '15 % off contact lens multipacks', d: 0.15, kinds: [0, 1], cats: [0], share: 0.09 },
    { code: 'FREESHIP40', kind: 'Free delivery', desc: 'Free delivery over 40 EUR', ship: 0.035, kinds: [1], share: 0.12 },
    { code: 'LENSSUB', kind: 'Free delivery', desc: 'Free delivery on lens subscriptions', ship: 0.03, kinds: [1], cats: [0], share: 0.08 },
    { code: 'LOYAL12', kind: 'Discount', desc: 'Loyalty card, 12 % off frames and sunglasses', d: 0.12, kinds: [0], cats: [1, 2], share: 0.10 },
    { code: 'SUMMER20', kind: 'Discount', desc: 'Summer sunglasses sale', d: 0.20, kinds: [0, 1], cats: [2], share: 0.22, win: [6, 1, 8, 31] },
    { code: 'BLACKFRI25', kind: 'Discount', desc: 'Black Friday week', d: 0.30, kinds: [0, 1], share: 0.35, win: [11, 20, 12, 2] },
    { code: 'BUNDLE2', kind: 'Discount', desc: 'Frame and lenses bundle', d: 0.18, kinds: [0, 1], cats: [1], share: 0.07 },
    { code: 'CLEARANCE40', kind: 'Discount', desc: 'Outlet clearance', d: 0.35, kinds: [0, 1], share: 0.45, outlet: true },
    { code: 'STUDENT8', kind: 'Discount', desc: 'Student discount 8 %', d: 0.08, kinds: [0, 1], cats: [0, 1, 2], share: 0.04 },
    { code: 'PARTNER18', kind: 'Discount', desc: 'Partner rebate 18 %', d: 0.08, kinds: [2], share: 0.60 },
    { code: 'SPRING10', kind: 'Discount', desc: 'Spring check-up 10 %', d: 0.10, kinds: [0, 1], share: 0.08, win: [3, 15, 4, 30] },
    { code: 'SOL3FOR2', kind: 'Discount', desc: '3 for 2 on solutions', d: 0.333, kinds: [0, 1], cats: [3], share: 0.10 }
  ];
  var LEAK_BRANDS = { 'Karst Shades': 1, 'Velo Sun': 1, 'Savanna Classic': 1 };
  var MARKETS = ['Slovenia', 'Croatia'];

  // ── Cells: shop x brand x price list x code ──────────────────────────────
  var CELLS = null;
  function inList(a, v) { return !a || a.indexOf(v) >= 0; }
  function build() {
    var r = AD.rng('margin-model');
    var catBrandSum = [0, 0, 0, 0, 0];
    BRANDS.forEach(function (b) { catBrandSum[b.c] += b.w; });
    CELLS = [];
    PAIRS.forEach(function (pr, pi) {
      var proj = PROJECTS[pr.p], cats = pr.cats || proj.cats, cc = proj.market === 'Slovenia' ? 'SI' : 'HR';
      var csum = 0; cats.forEach(function (c) { csum += CAT_SHARE[c]; });
      BRANDS.forEach(function (b) {
        if (cats.indexOf(b.c) < 0) return;
        var outletOk = pr.kind !== 2 && pr.p !== 2 && pr.p !== 3 && (b.c === 1 || b.c === 2 || b.c === 4);
        var pls = outletOk ? [false, true] : [false];
        pls.forEach(function (outlet) {
          var W = pr.base * (CAT_SHARE[b.c] / csum) * (b.w / catBrandSum[b.c]) * (outletOk ? (outlet ? 0.09 : 0.91) : 1);
          var m = b.m + (pr.kind === 1 ? -0.02 : pr.kind === 2 ? -0.10 : 0) + (proj.market === 'Croatia' ? -0.015 : 0) + (r() - 0.5) * 0.03 - (outlet ? 0.12 : 0);
          var plName = outlet ? 'Outlet ' + cc : pr.kind === 2 ? 'B2B partners' : (pr.kind === 1 ? 'Web ' : 'Retail ') + cc;
          var base = { pair: pi, pid: proj.id, kind: pr.kind, brand: b.n, bi: BRANDS.indexOf(b), cat: b.c, pl: plName, outlet: outlet, avg: CAT_LINE[b.c], upl: CAT_UPL[b.c] };
          // codes that apply to this group
          var apply = [], tot = 0;
          CODES.forEach(function (cd, ci) {
            if (cd.kinds.indexOf(pr.kind) < 0 || !inList(cd.cats, b.c)) return;
            if (!!cd.outlet !== outlet) return;
            var s = cd.share * (0.85 + 0.3 * r());
            if (tot + s > 0.8) return;
            tot += s; apply.push({ ci: ci, s: s });
          });
          var none = Object.assign({ code: -1, W: W, m: m, shIdx: apply.map(function (a) { return a.ci; }), shVal: apply.map(function (a) { return a.s; }) }, base);
          finish(none, r);
          CELLS.push(none);
          apply.forEach(function (a) {
            var cd = CODES[a.ci];
            var mm = cd.d ? 1 - (1 - m) / (1 - cd.d) : m - cd.ship;
            mm += (r() - 0.5) * 0.02;
            var c = Object.assign({ code: a.ci, W: W * a.s, m: Math.max(0.03, mm), shIdx: [], shVal: [] }, base);
            finish(c, r);
            if (cd.d && cd.d >= 0.3) c.rate *= 1.4;
            if (cd.code === 'CLEARANCE40' && LEAK_BRANDS[b.n]) c.leak = true;
            CELLS.push(c);
          });
        });
      });
    });
    CELLS.forEach(function (c, i) { c.i = i; });
  }
  function finish(c, r) {
    c.rate = (0.012 + 0.12 * Math.max(0, 0.35 - c.m)) * (c.outlet ? 1.5 : 1);
    c.loss = c.avg * (0.12 + 0.25 * r() + (c.outlet ? 0.12 : 0));
    c.leak = false;
  }

  // ── Time ─────────────────────────────────────────────────────────────────
  var THROUGH, FROM;
  var DI = {};
  function setWindow() {
    var t = dnOf(AD.iso(AD.today())) - 1;
    THROUGH = t; FROM = t - 729;
  }
  function codeOn(cd, month, day) {
    if (!cd.win) return true;
    var md = (month + 1) * 100 + day;
    return md >= cd.win[0] * 100 + cd.win[1] && md <= cd.win[2] * 100 + cd.win[3];
  }
  var WK_STORE = [0.35, 0.95, 1.0, 1.0, 1.05, 1.25, 1.15], WK_ONLINE = [1.05, 1.1, 1.0, 0.95, 0.95, 0.85, 0.95], WK_B2B = [0.05, 1.25, 1.2, 1.15, 1.1, 0.9, 0.05];
  function dayInfo(dn) {
    var di = DI[dn];
    if (di) return di;
    var s = isoOf(dn), dt = new Date(dn * DAY), wd = dt.getUTCDay(), mo = dt.getUTCMonth(), dd = dt.getUTCDate();
    var r = AD.rng('margin-day-' + s);
    var sh = AD.shape(s) * (0.92 + 0.16 * r());
    var dm = 0.02 - 0.000033 * (dn - DN0) + 0.010 * Math.sin(2 * Math.PI * dn / 365.25) + (r() - 0.5) * 0.008;
    var spk = r() < 0.05 ? 1.8 + r() : (r(), 1);
    if (dn === THROUGH && h2(dn, 5) < 0.75) spk = Math.max(spk, 2.4);   // most mornings the latest day looks worse than usual
    var mask = 0;
    CODES.forEach(function (cd, i) { if (codeOn(cd, mo, dd)) mask |= (1 << i); });
    di = DI[dn] = {
      dn: dn, iso: s, ym: s.slice(0, 7), mk: dt.getUTCFullYear() * 12 + mo, mask: mask, dm: dm, spk: spk,
      f: [sh * WK_STORE[wd], sh * WK_ONLINE[wd], sh * WK_B2B[wd]],
      cs: CAT_SEASON.map(function (a) { return a[mo]; }),
      g: Math.max(0.5, 1 + 0.00024 * (dn - DN0))
    };
    return di;
  }

  // ── Aggregation ──────────────────────────────────────────────────────────
  var MEMO = [];
  function select(flt) {
    var out = [];
    for (var i = 0; i < CELLS.length; i++) {
      var c = CELLS[i], pr = PAIRS[c.pair], proj = PROJECTS[pr.p];
      if (flt.market && proj.market !== flt.market) continue;
      if (flt.project && proj.id !== flt.project) continue;
      if (flt.channel) {
        if (flt.channel === 'All stores') { if (pr.kind !== 0) continue; }
        else if (pr.ch !== flt.channel) continue;
      }
      out.push(c);
    }
    return out;
  }
  /** sums every selected cell over [from, to] (day numbers, clamped to the data window) */
  function run(from, to, flt, opt) {
    opt = opt || {};
    var d0 = Math.max(from, FROM), d1 = Math.min(to, THROUGH);
    var key = [d0, d1, flt.market, flt.project, flt.channel, opt.perDay ? 1 : 0, opt.monthCode == null ? '' : opt.monthCode].join('|');
    for (var q = 0; q < MEMO.length; q++) if (MEMO[q].key === key) return MEMO[q].R;
    var sel = select(flt), n = Math.max(0, d1 - d0 + 1), infos = [], j, k, s;
    for (j = 0; j < n; j++) infos.push(dayInfo(d0 + j));
    var acc = new Float64Array(CELLS.length * NF);
    var dayArr = opt.perDay ? new Float64Array(n * ND) : null;
    var m0 = n ? infos[0].mk : 0, mn = n ? infos[n - 1].mk - m0 + 1 : 0;
    var mon = opt.monthCode != null ? new Float64Array(mn * 3) : null;
    for (s = 0; s < sel.length; s++) {
      var c = sel[s], o = c.i * NF, cid = c.i, shI = c.shIdx, shV = c.shVal, isNone = c.code < 0;
      var wantMon = mon && c.code === opt.monthCode;
      for (j = 0; j < n; j++) {
        var di = infos[j], rev0;
        if (isNone) {
          var sum = 0;
          for (k = 0; k < shI.length; k++) if ((di.mask >> shI[k]) & 1) sum += shV[k];
          rev0 = c.W * (1 - sum);
        } else {
          if (!((di.mask >> c.code) & 1)) continue;
          rev0 = c.W;
        }
        var u = h2(cid, di.dn), u2 = h2(cid + 104729, di.dn);
        var rev = fix(rev0 * di.f[c.kind] * di.cs[c.cat] * di.g * (0.93 + 0.14 * u));
        if (rev <= 0) continue;
        var mp = c.m + di.dm; if (mp < 0.02) mp = 0.02;
        var mar = fix(rev * mp);
        var lines = Math.floor(rev / c.avg + u2);
        var units = Math.round(lines * c.upl);
        var nl = 0, nm = 0, nrev = 0;
        if (lines > 0) {
          var x = lines * c.rate * di.spk * (c.leak && di.dn === THROUGH ? 25 : 1);
          nl = Math.floor(x + h2(cid + 7, di.dn + 99991));
          if (nl > lines) nl = lines;
          if (nl > 0) { nm = -fix(nl * c.loss * (0.7 + 0.6 * u)); nrev = fix(nl * c.avg * 0.93); }
        }
        acc[o] += rev; acc[o + 1] += mar; acc[o + 2] += units; acc[o + 3] += lines; acc[o + 4] += nl; acc[o + 5] += nm; acc[o + 6] += nrev;
        if (dayArr) {
          var p = j * ND;
          dayArr[p] += rev; dayArr[p + 1] += mar;
          if (c.code >= 0) { dayArr[p + 2] += rev; dayArr[p + 3] += mar; }
          dayArr[p + 4] += lines; dayArr[p + 5] += nl; dayArr[p + 6] += nm;
        }
        if (wantMon) { var mi = (di.mk - m0) * 3; mon[mi] += rev; mon[mi + 1] += mar; mon[mi + 2] += nm; }
      }
    }
    var R = { d0: d0, d1: d1, n: n, sel: sel, acc: acc, dayArr: dayArr, infos: infos, mon: mon, m0: m0, mn: mn };
    MEMO.push({ key: key, R: R });
    if (MEMO.length > 24) MEMO.shift();
    return R;
  }
  function tot() { return { revenue: 0, margin: 0, units: 0, lines: 0, neg_lines: 0, neg_margin: 0, neg_revenue: 0, disc_revenue: 0, disc_margin: 0 }; }
  function addCell(t, c, a) {
    var o = c.i * NF;
    t.revenue += a[o]; t.margin += a[o + 1]; t.units += a[o + 2]; t.lines += a[o + 3]; t.neg_lines += a[o + 4]; t.neg_margin += a[o + 5]; t.neg_revenue += a[o + 6];
    if (c.code >= 0) { t.disc_revenue += a[o]; t.disc_margin += a[o + 1]; }
  }
  function groupBy(R, kf) {
    var m = Object.create(null), arr = [];
    for (var i = 0; i < R.sel.length; i++) {
      var c = R.sel[i], k = kf(c), g = m[k];
      if (!g) { g = m[k] = { name: k, t: tot(), cell: c }; arr.push(g); }
      addCell(g.t, c, R.acc);
    }
    return { arr: arr, m: m };
  }
  function money(t) {
    return { revenue: r2(t.revenue), cost: r2(t.revenue - t.margin), margin: r2(t.margin), units: Math.round(t.units), lines: Math.round(t.lines), neg_lines: Math.round(t.neg_lines),
      neg_margin: r2(t.neg_margin), neg_revenue: r2(t.neg_revenue), disc_revenue: r2(t.disc_revenue), disc_margin: r2(t.disc_margin) };
  }
  function codeName(c) { return c.code < 0 ? '(none)' : CODES[c.code].code; }
  var DIMS = {
    code: codeName,
    brand: function (c) { return c.brand; },
    category: function (c) { return CATS[c.cat]; },
    pricelist: function (c) { return c.pl; },
    project: function (c) { return PROJECTS[PAIRS[c.pair].p].name; },
    channel: function (c) { return PAIRS[c.pair].ch; }
  };
  var DIM_KEYS = ['code', 'brand', 'category', 'pricelist', 'project', 'channel'];

  // ── Request helpers ──────────────────────────────────────────────────────
  function bad(msg) { return { __status: 400, error: msg }; }
  function filters(params) {
    return { market: params.get('market') || '', project: params.get('project') || '', channel: params.get('channel') || '' };
  }
  /** parsed { from, to } day numbers, or { err } */
  function range(params) {
    var f = params.get('from'), t = params.get('to'), a, b;
    if ((f && dnOf(f) == null) || (t && dnOf(t) == null)) return { err: 'from and to must be dates like 2026-03-31.' };
    b = t ? dnOf(t) : THROUGH;
    a = f ? dnOf(f) : b - 89;
    if (a > b) return { err: 'from must not be after to.' };
    return { a: a, b: b };
  }
  function shiftYear(dn) {
    var d = new Date(dn * DAY), y = d.getUTCFullYear() - 1, m = d.getUTCMonth(), dd = d.getUTCDate();
    if (m === 1 && dd === 29) dd = 28;
    return Math.round(Date.UTC(y, m, dd) / DAY);
  }
  function monthStart(dn) { var d = new Date(dn * DAY); return Math.round(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / DAY); }

  // ── Routes ───────────────────────────────────────────────────────────────
  function meta() {
    var chans = [{ channel: 'Online', markets: MARKETS.slice() }];
    var b2b = [], stores = [];
    PAIRS.forEach(function (pr) {
      var mk = PROJECTS[pr.p].market;
      if (pr.kind === 2) { if (b2b.indexOf(mk) < 0) b2b.push(mk); }
      else if (pr.kind === 0) stores.push({ channel: pr.ch, markets: [mk] });
    });
    chans.push({ channel: 'B2B', markets: b2b });
    stores.forEach(function (s) { chans.push(s); });
    var codes = CODES.map(function (cd, i) {
      var first = null, last = null, projs = {};
      for (var dn = FROM; dn <= THROUGH; dn++) if ((dayInfo(dn).mask >> i) & 1) { if (first == null) first = dn; last = dn; }
      CELLS.forEach(function (c) { if (c.code === i) projs[c.pid] = 1; });
      return { code: cd.code, kind: cd.kind, description: cd.desc, first_used: first == null ? null : isoOf(first), last_used: last == null ? null : isoOf(last), projects: Object.keys(projs).length };
    });
    return {
      dataFrom: isoOf(FROM), dataThrough: isoOf(THROUGH), markets: MARKETS.slice(),
      projects: PROJECTS.map(function (p) { return { project_id: p.id, project: p.name, market: p.market }; }),
      channels: chans, codes: codes
    };
  }

  function overview(params) {
    var rg = range(params); if (rg.err) return bad(rg.err);
    var flt = filters(params), R = run(rg.a, rg.b, flt, { perDay: true });
    var days = [], j, p;
    for (j = 0; j < R.n; j++) {
      p = j * ND;
      days.push({ date: R.infos[j].iso, revenue: r2(R.dayArr[p]), margin: r2(R.dayArr[p + 1]), cost: r2(R.dayArr[p] - R.dayArr[p + 1]), disc_revenue: r2(R.dayArr[p + 2]), disc_margin: r2(R.dayArr[p + 3]),
        lines: Math.round(R.dayArr[p + 4]), neg_lines: Math.round(R.dayArr[p + 5]), neg_margin: r2(R.dayArr[p + 6]) });
    }
    var la = shiftYear(rg.a), lb = shiftYear(rg.b), L = run(la, lb, flt, { perDay: true }), lt = tot(), first = null;
    for (j = 0; j < L.n; j++) { p = j * ND; lt.revenue += L.dayArr[p]; lt.margin += L.dayArr[p + 1]; if (first == null && L.dayArr[p] > 0) first = L.infos[j].iso; }
    var wf = Math.max(monthStart(rg.b), FROM), wt = Math.min(rg.b, THROUGH);
    var W = run(wf, wt, flt), leaks = [];
    DIM_KEYS.forEach(function (dim) {
      groupBy(W, DIMS[dim]).arr.filter(function (g) { return g.t.neg_lines > 0 && g.t.neg_margin < 0; })
        .sort(function (x, y) { return x.t.neg_margin - y.t.neg_margin; }).slice(0, 15).forEach(function (g) {
          var t = g.t; leaks.push({ dim: dim, name: g.name, neg_margin: r2(t.neg_margin), neg_lines: Math.round(t.neg_lines), lines: Math.round(t.lines), revenue: r2(t.revenue), margin: r2(t.margin) });
        });
    });
    return { days: days, lastYear: { from: isoOf(la), to: isoOf(lb), first_day: first, revenue: r2(lt.revenue), margin: r2(lt.margin) },
      leakWindow: { from: isoOf(wf), to: isoOf(wt) }, leaks: leaks };
  }

  function noCodeBase(R) {
    var base = Object.create(null);
    R.sel.forEach(function (c) {
      if (c.code >= 0) return;
      var k = c.pid + '|' + c.cat, b = base[k] || (base[k] = { rev: 0, mar: 0 });
      b.rev += R.acc[c.i * NF]; b.mar += R.acc[c.i * NF + 1];
    });
    return base;
  }
  function codes(params) {
    var rg = range(params); if (rg.err) return bad(rg.err);
    var R = run(rg.a, rg.b, filters(params)), base = noCodeBase(R), g = groupBy(R, codeName), rows = [];
    var exp = Object.create(null);
    R.sel.forEach(function (c) {
      var rev = R.acc[c.i * NF], mar = R.acc[c.i * NF + 1], b = base[c.pid + '|' + c.cat], k = codeName(c);
      exp[k] = (exp[k] || 0) + (c.code < 0 || !b || b.rev <= 0 ? mar : rev * b.mar / b.rev);
    });
    g.arr.forEach(function (x) {
      var t = x.t; if (t.revenue <= 0) return;
      rows.push({ code: x.name, revenue: r2(t.revenue), orders: Math.round(t.lines * 0.58), margin: r2(t.margin), expected_margin: r2(exp[x.name]), neg_lines: Math.round(t.neg_lines),
        neg_margin: r2(t.neg_margin), lines: Math.round(t.lines), units: Math.round(t.units) });
    });
    rows.sort(function (a, b) { return b.revenue - a.revenue; });
    return { rows: rows };
  }

  function codeDetail(params) {
    var rg = range(params); if (rg.err) return bad(rg.err);
    var code = params.get('code') || '', idx = -1;
    if (code !== '(none)') { CODES.forEach(function (cd, i) { if (cd.code === code) idx = i; }); if (idx < 0) return bad('Unknown discount code.'); }
    var flt = filters(params), R = run(rg.a, rg.b, flt, { monthCode: idx }), base = noCodeBase(R), m = Object.create(null), rows = [];
    R.sel.forEach(function (c) {
      if (c.code !== idx) return;
      var k = c.pid + '|' + c.cat, o = c.i * NF, x = m[k];
      if (!x) { x = m[k] = { project: PROJECTS.filter(function (p) { return p.id === c.pid; })[0].name, category: CATS[c.cat], revenue: 0, margin: 0, neg_margin: 0, key: k }; rows.push(x); }
      x.revenue += R.acc[o]; x.margin += R.acc[o + 1]; x.neg_margin += R.acc[o + 5];
    });
    rows = rows.filter(function (x) { return x.revenue > 0; }).map(function (x) {
      var b = base[x.key];
      return { project: x.project, category: x.category, revenue: r2(x.revenue), margin: r2(x.margin), base_pct: b && b.rev > 0 ? Math.round(b.mar / b.rev * 1e5) / 1e5 : null, neg_margin: r2(x.neg_margin) };
    });
    var months = [];
    for (var i = 0; i < R.mn; i++) {
      if (R.mon[i * 3] <= 0) continue;
      var mk = R.m0 + i, y = Math.floor(mk / 12), mo = mk % 12;
      months.push({ month: y + '-' + (mo < 9 ? '0' : '') + (mo + 1), revenue: r2(R.mon[i * 3]), margin: r2(R.mon[i * 3 + 1]), neg_margin: r2(R.mon[i * 3 + 2]) });
    }
    return { code: code, rows: rows, months: months };
  }

  function pricelists(params) {
    var rg = range(params); if (rg.err) return bad(rg.err);
    var R = run(rg.a, rg.b, filters(params)), g = groupBy(R, function (c) { return c.pid + '|' + c.pl; }), rows = [];
    g.arr.forEach(function (x) {
      if (x.t.revenue <= 0) return;
      var proj = PROJECTS.filter(function (p) { return p.id === x.cell.pid; })[0], r = money(x.t);
      r.project_id = proj.id; r.project = proj.name; r.market = proj.market; r.owner_group = proj.group; r.pricelist = x.cell.pl;
      rows.push(r);
    });
    rows.sort(function (a, b) { return b.revenue - a.revenue; });
    return { rows: rows };
  }

  function brands(params) {
    var rg = range(params); if (rg.err) return bad(rg.err);
    var flt = filters(params), kf = function (c) { return c.brand + '|' + CATS[c.cat]; };
    var la = shiftYear(rg.a), lb = shiftYear(rg.b);
    var g = groupBy(run(rg.a, rg.b, flt), kf), ly = groupBy(run(la, lb, flt), kf), rows = [];
    g.arr.forEach(function (x) {
      if (x.t.revenue <= 0 && x.t.lines <= 0) return;
      var r = money(x.t), l = ly.m[x.name];
      r.brand = x.cell.brand; r.category = CATS[x.cell.cat];
      r.ly_revenue = l ? r2(l.t.revenue) : 0; r.ly_margin = l ? r2(l.t.margin) : 0; r.ly_neg_margin = l ? r2(l.t.neg_margin) : 0;
      rows.push(r);
    });
    rows.sort(function (a, b) { return a.neg_margin - b.neg_margin; });
    return { rows: rows, lastYear: { from: isoOf(la), to: isoOf(lb) } };
  }

  function alerts(params) {
    var day = params.get('day') ? dnOf(params.get('day')) : THROUGH;
    if (day == null) return bad('day must be a date like 2026-03-31.');
    day = Math.min(THROUGH, Math.max(FROM, day));
    var flt = filters(params), R = run(day - 28, day, flt, { perDay: true }), days = [], k, p, off = R.d0 - (day - 28);
    for (k = 0; k < 29; k++) {
      var j = k - off, dn = day - 28 + k;
      if (j >= 0 && j < R.n) { p = j * ND; days.push({ date: isoOf(dn), revenue: r2(R.dayArr[p]), margin: r2(R.dayArr[p + 1]), lines: Math.round(R.dayArr[p + 4]), neg_lines: Math.round(R.dayArr[p + 5]), neg_margin: r2(R.dayArr[p + 6]) }); }
      else days.push({ date: isoOf(dn), revenue: 0, margin: 0, lines: 0, neg_lines: 0, neg_margin: 0 });
    }
    var D1 = run(day, day, flt), D0 = run(day - 28, day - 1, flt), rows = [];
    DIM_KEYS.forEach(function (dim) {
      var today = groupBy(D1, DIMS[dim]), prev = groupBy(D0, DIMS[dim]);
      today.arr.filter(function (g) { return g.t.neg_margin < 0; }).sort(function (a, b) { return a.t.neg_margin - b.t.neg_margin; }).slice(0, 25).forEach(function (g) {
        var t = g.t, pv = prev.m[g.name];
        rows.push({ dim: dim, name: g.name, neg_margin: r2(t.neg_margin), avg_neg_margin: pv ? r2(pv.t.neg_margin / 28) : 0, neg_lines: Math.round(t.neg_lines), lines: Math.round(t.lines), revenue: r2(t.revenue), margin: r2(t.margin) });
      });
    });
    return { day: isoOf(day), days: days, rows: rows };
  }

  AD.register('/api/margin/', function (path, params) {
    setWindow();
    if (!CELLS) build();
    switch (path) {
      case 'session': return { signedIn: true, allowed: true, email: 'demo@adrial.example' };
      case 'meta': return meta();
      case 'overview': return overview(params);
      case 'codes': return codes(params);
      case 'code': return codeDetail(params);
      case 'pricelists': return pricelists(params);
      case 'brands': return brands(params);
      case 'alerts': return alerts(params);
      default: return { __status: 404, error: 'Not found.' };
    }
  });
})();
