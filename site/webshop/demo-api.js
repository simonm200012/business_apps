/* Webshop conversion health: DEMO API (made-up sample data, static hosting only).
 * Answers /api/webshop/* in the browser through /_shared/demo-api.js so app.js runs unchanged.
 * Everything here is invented: the shops are fictional (.example domains), nothing is real company data.
 *
 * Model: one deterministic "cell" per (shop, device, day) holds every GA4 daily aggregate (sessions, funnel events,
 * orders, revenue, sessionless orders ...). Every route is built by summing cells, so totals equal the sum of
 * their rows, overlapping date ranges give identical per-day values, and all pages agree with each other.
 * Routes: session, meta, overview, quality, categories, landing, browsers, promotions. */
(function () {
  'use strict';
  var D = window.AdrialDemo;
  if (!D || !D.register) return;

  var TOT_KEYS = ['sessions', 'engaged_sessions', 'new_users', 'page_views', 'transactions', 'revenue', 'untracked_sessions', 'untracked_transactions', 'untracked_revenue',
    'ev_session_start', 'ev_view_item', 'view_item_users', 'ev_view_cart', 'ev_add_to_cart', 'ev_begin_checkout', 'ev_add_shipping_info', 'ev_add_payment_info', 'ev_purchase'];
  var EXTRA_KEYS = ['_vx', '_neg', '_negRev', '_dup', '_mism', '_zero'];
  var ACC_KEYS = TOT_KEYS.concat(EXTRA_KEYS);
  var MONEY = { revenue: 1, untracked_revenue: 1, _negRev: 1 };
  var DEVICES = ['mobile', 'desktop', 'tablet'];
  var DEV_SHARE = { mobile: 0.62, desktop: 0.33, tablet: 0.05 };
  var ISO = /^\d{4}-\d{2}-\d{2}$/;

  // ── fictional shops ─────────────────────────────────────────────────────
  // base = sessions per day (all devices); convF = conversion factor; sless = sessionless orders per tracked desktop order;
  // neg = refunds sent as purchases; dup = duplicate purchase rows; infl/inflU = inflated desktop item views (views, users per session)
  var SHOPS = [
    { shop: 'lenses.example.si', label: 'Lenses SI', market: 'SI', fam: 'lens', base: 2400, convF: 1.12, aov: 58, sless: 0.30, neg: 0.02, dup: 0.004, mism: 0 },
    { shop: 'lece.example.hr', label: 'Lece HR', market: 'HR', fam: 'lens', base: 1500, convF: 1.0, aov: 49, sless: 0.12, neg: 0, dup: 0, mism: 0 },
    { shop: 'eyewear.example.si', label: 'Eyewear SI', market: 'SI', fam: 'eye', base: 1700, convF: 0.95, aov: 128, sless: 0.16, neg: 0.008, dup: 0.03, mism: 1, infl: 11.5, inflU: 1.7 },
    { shop: 'eyewear.example.hr', label: 'Eyewear HR', market: 'HR', fam: 'eye', base: 1100, convF: 0.85, aov: 112, sless: 0.7, neg: 0.035, dup: 0.012, mism: 1, infl: 16, inflU: 2.1 },
    { shop: 'lenti.example.it', label: 'Lenti IT', market: 'IT', fam: 'lens', base: 700, convF: 0.9, aov: 54, sless: 0.07, neg: 0, dup: 0, mism: 0, spike: true },
  ];

  // ── dates ───────────────────────────────────────────────────────────────
  function dn(s) { return Math.round(D.parseDay(s).getTime() / 864e5); }
  function add(s, n) { return D.iso(D.addDays(D.parseDay(s), n)); }
  function span(a, b) { return dn(b) - dn(a) + 1; }
  function dow(s) { return D.parseDay(s).getUTCDay(); }
  function round2(x) { return Math.round(x * 100) / 100; }
  var NOW = new Date();
  var THROUGH = D.iso(new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), NOW.getUTCDate() - 1)));
  var FIRST = add(THROUGH, -395);
  var SPIKE_FROM = add(THROUGH, -6);
  var INFL_START = '2026-06-01';

  function trend(day) { return 1 + 0.06 * (dn(day) - dn('2026-01-01')) / 365; }
  function eventF(day) {
    var d = D.parseDay(day), m = d.getUTCMonth(), dd = d.getUTCDate(), f = 1;
    if (m === 10 && dd >= 20 && dd <= 30) f *= 1.3;
    if (m === 11 && dd >= 24 && dd <= 26) f *= 0.6;
    if (m === 11 && dd >= 27) f *= 0.8;
    return f;
  }

  // ── the cell: every daily aggregate for one shop, device and day ────────
  var BASE_ATC = { mobile: 0.085, desktop: 0.105, tablet: 0.09 };
  var CPA = { mobile: 0.44, desktop: 0.48, tablet: 0.45 };   // begin_checkout per add_to_cart
  var PCO = { mobile: 0.44, desktop: 0.52, tablet: 0.5 };    // tracked purchases per begin_checkout
  var VIPS = { mobile: 0.6, desktop: 0.74, tablet: 0.68 };   // view_item events per session
  var PVPS = { mobile: 3.4, desktop: 4.9, tablet: 4.2 };
  var AOVF = { mobile: 0.95, desktop: 1.1, tablet: 1.0 };
  var CELLS = {};

  function cell(sh, dev, day) {
    var key = sh.shop + '|' + dev + '|' + day;
    if (CELLS[key]) return CELLS[key];
    var r = D.rng('webshop|cell|' + key);
    var ev = eventF(day);
    var st = Math.round(sh.base * DEV_SHARE[dev] * D.shape(day) * trend(day) * ev * r.between(0.92, 1.08));
    var bot = (sh.spike && dev === 'mobile' && day >= SPIKE_FROM) ? Math.round(st * r.between(1.0, 1.3)) : 0;
    // funnel, built top-down so every step is <= the one before
    var atc = Math.round(st * BASE_ATC[dev] * sh.convF * Math.pow(ev, 0.4) * r.between(0.9, 1.1));
    var begin = Math.round(atc * Math.min(0.95, CPA[dev] * r.between(0.92, 1.08)));
    var txT = Math.round(begin * Math.min(0.95, PCO[dev] * r.between(0.92, 1.08)));
    // purchases GA4 received without a browser session (almost all desktop)
    var slRate = dev === 'desktop' ? sh.sless : dev === 'mobile' ? 0.012 : 0;
    var utx = Math.round(txT * slRate * r.between(0.6, 1.4));
    var usess = utx ? Math.round(utx * r.between(0.1, 0.45)) : 0;
    if (dev === 'desktop') usess += r.int(0, 3);
    var tx = txT + utx;
    if (begin < Math.ceil(tx * 1.03)) begin = Math.ceil(tx * 1.03);
    if (atc < begin) atc = begin;
    var pay = Math.max(tx, Math.round(begin * r.between(0.74, 0.9)));
    var ship = Math.max(pay, Math.round(begin * r.between(0.86, 0.96)));
    var vcart = Math.max(begin, Math.min(atc, Math.round(atc * r.between(0.62, 0.8))));
    // item views (inflated on desktop in two shops since June 2026)
    var normalView = Math.max(atc, Math.round(st * VIPS[dev] * r.between(0.92, 1.08)));
    var ramp = 0;
    if (dev === 'desktop' && sh.infl && day >= INFL_START) ramp = Math.min(1, (dn(day) - dn(INFL_START)) / 12 + 0.1);
    var view = normalView, vusers = Math.min(normalView, Math.round(st * 0.52 * r.between(0.94, 1.06)));
    if (ramp) {
      view = Math.max(normalView, Math.round(st * (VIPS[dev] + (sh.infl - VIPS[dev]) * ramp) * r.between(0.85, 1.15)));
      vusers = Math.round(st * (0.5 + (sh.inflU - 0.5) * ramp) * r.between(0.92, 1.08));
    }
    var sessions = st + bot + usess;
    var aov = sh.aov * AOVF[dev] * r.between(0.93, 1.07);
    var negRows = dev === 'desktop' && sh.neg ? Math.min(tx, Math.floor(tx * sh.neg * r.between(0.5, 1.5) + r())) : 0;
    var negRev = negRows ? round2(negRows * aov * r.between(0.5, 1.1)) : 0;
    var c = {
      sessions: sessions,
      engaged_sessions: Math.min(sessions, Math.round(st * (dev === 'desktop' ? 0.68 : 0.62) * r.between(0.95, 1.05) + bot * r.between(0.05, 0.12) + usess * 0.1)),
      new_users: Math.min(sessions, Math.round(st * 0.56 * r.between(0.95, 1.05) + bot * 0.92 + usess * 0.6)),
      page_views: Math.round(st * PVPS[dev] * r.between(0.95, 1.05) + bot * 1.2 + usess * 1.5),
      transactions: tx,
      revenue: round2((tx - negRows) * aov * r.between(0.97, 1.03) - negRev),
      untracked_sessions: usess,
      untracked_transactions: utx,
      untracked_revenue: round2(utx * aov * r.between(0.95, 1.05)),
      ev_session_start: sessions,
      ev_view_item: view,
      view_item_users: vusers,
      ev_view_cart: vcart,
      ev_add_to_cart: atc,
      ev_begin_checkout: begin,
      ev_add_shipping_info: ship,
      ev_add_payment_info: pay,
      ev_purchase: tx,
      _vx: view - normalView,
      _neg: negRows,
      _negRev: negRev,
      _dup: Math.floor(tx * sh.dup * r.between(0.5, 1.5) + r()),
      _mism: sh.mism && r() < 0.12 ? Math.min(tx, 1) : 0,
      _zero: Math.floor(tx * 0.004 * r.between(0, 2) + r()),
    };
    CELLS[key] = c;
    return c;
  }

  // sum of cells over a list of devices and a date range (days outside the kept data are skipped)
  var AGG = {};
  function agg(sh, devs, from, to) {
    var key = sh.shop + '|' + devs.join(',') + '|' + from + '|' + to, hit = AGG[key];
    if (hit) return hit;
    var o = {}, i, k;
    for (i = 0; i < ACC_KEYS.length; i++) o[ACC_KEYS[i]] = 0;
    var list = D.days(from < FIRST ? FIRST : from, to > THROUGH ? THROUGH : to);
    for (var di = 0; di < list.length; di++) for (var vi = 0; vi < devs.length; vi++) {
      var c = cell(sh, devs[vi], list[di]);
      for (i = 0; i < ACC_KEYS.length; i++) { k = ACC_KEYS[i]; o[k] += c[k]; }
    }
    for (k in MONEY) o[k] = round2(o[k]);
    AGG[key] = o;
    return o;
  }

  // ── request helpers ─────────────────────────────────────────────────────
  function bad(msg) { return { __status: 400, error: msg }; }
  function readWindow(params) {
    var from = params.get('from'), to = params.get('to');
    if (!from && !to) { to = THROUGH; from = add(THROUGH, -27); }
    if (!ISO.test(from || '') || !ISO.test(to || '') || !D.parseDay(from) || !D.parseDay(to)) return bad('Invalid date range: use from and to as YYYY-MM-DD.');
    if (from > to) return bad('The start date is after the end date.');
    if (to > THROUGH) to = THROUGH;
    if (from < FIRST) from = FIRST;
    if (from > to) from = to;
    if (span(from, to) > 400) return bad('The date range is too long (400 days at most).');
    return { from: from, to: to };
  }
  function readCompare(params) {
    var m = params.get('compare') || 'prev';
    return m === 'prev' || m === 'yoy' ? m : null;
  }
  function cmpWindow(w, mode) {
    if (mode === 'yoy') return { from: add(w.from, -364), to: add(w.to, -364), mode: 'yoy' };
    var n = span(w.from, w.to);
    return { from: add(w.from, -n), to: add(w.from, -1), mode: 'prev' };
  }
  function readFilters(params) {
    var shop = params.get('shop') || '', device = params.get('device') || '', market = params.get('market') || '';
    if (device && DEVICES.indexOf(device) < 0) return bad('Unknown device.');
    if (shop && !SHOPS.some(function (s) { return s.shop === shop; })) return bad('Unknown shop.');
    var shops = SHOPS.filter(function (s) { return (!shop || s.shop === shop) && (!market || s.market === market); });
    return { shops: shops, devs: device ? [device] : DEVICES.slice(), device: device };
  }
  function setup(params) {
    var w = readWindow(params); if (w.__status) return w;
    var f = readFilters(params); if (f.__status) return f;
    var mode = readCompare(params); if (!mode) return bad('Unknown compare mode.');
    return { w: w, f: f, mode: mode, c: cmpWindow(w, mode) };
  }
  function totalsRows(shops, devs, w, period) {
    var rows = [];
    shops.forEach(function (sh) { devs.forEach(function (d) {
      var a = agg(sh, [d], w.from, w.to), o = { period: period, shop: sh.shop, device: d };
      TOT_KEYS.forEach(function (k) { o[k] = a[k]; });
      rows.push(o);
    }); });
    return rows;
  }

  // ── routes ──────────────────────────────────────────────────────────────
  function routeMeta() {
    var upd = D.iso(new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), NOW.getUTCDate())));
    return {
      shops: SHOPS.map(function (s) { return { shop: s.shop, label: s.label, market: s.market }; }),
      dataFrom: FIRST,
      dataThrough: THROUGH,
      freshness: [
        { source: 'GA4 load', updated_at: upd + 'T05:42:00Z' },
        { source: 'Summary rebuilt', updated_at: upd + 'T06:15:00Z' },
      ],
    };
  }

  function routeOverview(params) {
    var s = setup(params); if (s.__status) return s;
    var daily = [];
    D.days(s.w.from, s.w.to).forEach(function (day) {
      s.f.devs.forEach(function (d) {
        var o = { date: day, device: d, sessions: 0, transactions: 0, revenue: 0, untracked_transactions: 0 };
        s.f.shops.forEach(function (sh) {
          var c = cell(sh, d, day);
          o.sessions += c.sessions; o.transactions += c.transactions; o.revenue += c.revenue; o.untracked_transactions += c.untracked_transactions;
        });
        o.revenue = round2(o.revenue);
        daily.push(o);
      });
    });
    return {
      window: s.w, compare: s.c,
      totals: totalsRows(s.f.shops, s.f.devs, s.w, 'cur').concat(totalsRows(s.f.shops, s.f.devs, s.c, 'cmp')),
      daily: daily,
    };
  }

  function routeQuality(params) {
    var s = setup(params); if (s.__status) return s;
    var orders = s.f.shops.map(function (sh) {
      var a = agg(sh, DEVICES, s.w.from, s.w.to);
      return {
        shop: sh.shop, tx_rows: a.transactions + a._dup, orders: a.transactions - a._mism, duplicate_rows: a._dup,
        revenue: a.revenue, negative_rows: a._neg, negative_revenue: -a._negRev, zero_rows: a._zero,
        unassigned_rows: a.untracked_transactions + a._neg + Math.round(a.transactions * 0.004),
        unassigned_revenue: round2(a.untracked_revenue - a._negRev),
      };
    });
    return {
      window: s.w, compare: s.c,
      totals: totalsRows(s.f.shops, s.f.devs, s.w, 'cur').concat(totalsRows(s.f.shops, s.f.devs, s.c, 'cmp')),
      orders: orders,
    };
  }

  // categories: item metrics per shop and category, always all devices
  var CATS = {
    lens: [['Contact lenses', 'Daily lenses', 0.32, 34, 1.0], ['Contact lenses', 'Monthly lenses', 0.20, 24, 1.0], ['Contact lenses', 'Toric lenses', 0.12, 40, 1.0],
      ['Contact lenses', 'Multifocal lenses', 0.05, 52, 1.1], ['Contact lenses', 'Colour lenses', 0.03, 22, 1.2], ['Contact lenses', 'Solutions & care', 0.20, 11, 0.7],
      ['Accessories', 'Lens cases', 0.03, 7, 0.5], ['Accessories', 'Cleaning cloths', 0.05, 4, 0.5]],
    eye: [['Frames', 'Men frames', 0.12, 95, 3.0], ['Frames', 'Women frames', 0.15, 98, 3.0], ['Frames', 'Kids frames', 0.06, 70, 2.4],
      ['Sunglasses', 'Men sunglasses', 0.09, 88, 3.0], ['Sunglasses', 'Women sunglasses', 0.10, 92, 3.0], ['Sunglasses', 'Sport sunglasses', 0.05, 80, 2.4],
      ['Lenses for glasses', 'Single vision lenses', 0.12, 70, 0.02], ['Lenses for glasses', 'Progressive lenses', 0.12, 150, 0.02], ['Lenses for glasses', 'Blue-light filter', 0.04, 40, 0.02],
      ['Accessories', 'Cases', 0.03, 7, 0.5], ['Accessories', 'Cleaning cloths', 0.02, 4, 0.5],
      ['Contact lenses', 'Daily lenses', 0.04, 34, 1.0], ['Contact lenses', 'Solutions & care', 0.06, 11, 0.7]],
  };
  function categoryRows(sh, w, period) {
    var cats = CATS[sh.fam], acc = {}, list = D.days(w.from < FIRST ? FIRST : w.from, w.to > THROUGH ? THROUGH : w.to);
    var vnorm = cats.reduce(function (a, c) { return a + c[2] * c[4]; }, 0);
    var frameSun = cats.reduce(function (a, c) { return a + (c[0] === 'Frames' || c[0] === 'Sunglasses' ? c[2] : 0); }, 0);
    list.forEach(function (day) {
      var a = DEVICES.reduce(function (t, d) { var c = cell(sh, d, day); ACC_KEYS.forEach(function (k) { t[k] = (t[k] || 0) + c[k]; }); return t; }, {});
      var r = D.rng('webshop|cat|' + sh.shop + '|' + day);
      var raw = cats.map(function (c) { return a.transactions * 1.35 * c[2] * c[3]; });
      var rawSum = raw.reduce(function (x, y) { return x + y; }, 0) || 1;
      cats.forEach(function (c, i) {
        var key = c[0] + '|' + c[1], o = acc[key] || (acc[key] = { period: period, shop: sh.shop, category_group: c[0], category: c[1], item_views: 0, add_to_cart: 0, checkouts: 0, purchases: 0, revenue: 0, refunds: 0, list_views: 0, list_clicks: 0 });
        var nv = (a.ev_view_item - a._vx) * c[2] * c[4] / vnorm * r.between(0.9, 1.1);
        var xv = (c[0] === 'Frames' || c[0] === 'Sunglasses') ? a._vx * c[2] / frameSun : 0;
        var purchases = Math.round(a.transactions * 1.35 * c[2] * r.between(0.88, 1.12));
        var rev = a.revenue * raw[i] / rawSum * r.between(0.92, 1.08);
        o.item_views += Math.round(nv + xv);
        o.add_to_cart += Math.round(a.ev_add_to_cart * 1.25 * c[2] * (c[0] === 'Lenses for glasses' ? 1.6 : 1) * r.between(0.88, 1.12));
        o.checkouts += Math.round(a.ev_begin_checkout * 1.35 * c[2] * r.between(0.9, 1.1));
        o.purchases += purchases;
        o.revenue += rev;
        o.refunds += rev * r.between(0.004, 0.03);
      });
    });
    return Object.keys(acc).map(function (k) { var o = acc[k]; o.revenue = round2(o.revenue); o.refunds = round2(o.refunds); return o; }).filter(function (o) { return o.item_views || o.purchases || o.add_to_cart; });
  }
  function routeCategories(params) {
    var s = setup(params); if (s.__status) return s;
    var rows = [];
    s.f.shops.forEach(function (sh) { rows = rows.concat(categoryRows(sh, s.w, 'cur'), categoryRows(sh, s.c, 'cmp')); });
    return { window: s.w, compare: s.c, rows: rows };
  }

  // landing pages: whole weeks (Monday to Sunday)
  var PAGES = {
    lens: [
      ['/', 0.20, 0.7, 0.55, 0.05], ['/contact-lenses', 0.08, 1.3, 0.62, 0.1], ['/contact-lenses/daily', 0.07, 1.6, 0.64, 0.1], ['/contact-lenses/monthly', 0.05, 1.5, 0.63, 0.1],
      ['/contact-lenses/toric', 0.03, 1.8, 0.66, 0.1], ['/contact-lenses/multifocal', 0.015, 1.4, 0.65, 0.1], ['/contact-lenses/colour', 0.015, 0.9, 0.6, 0.15],
      ['/solutions', 0.03, 1.0, 0.6, 0.1], ['/brands/clearday', 0.035, 1.5, 0.66, 0.1], ['/brands/aquavita', 0.02, 1.4, 0.65, 0.1], ['/brands/focusline', 0.02, 1.3, 0.64, 0.1],
      ['/p/clearday-1-day-90', 0.03, 2.0, 0.7, 0.15], ['/p/aquavita-monthly-6', 0.02, 1.9, 0.7, 0.15], ['/p/focusline-toric-6', 0.012, 2.0, 0.7, 0.15],
      ['/blog/how-to-insert-lenses', 0.03, 0, 0.72, 0.1], ['/blog/dry-eyes-tips', 0.02, 0, 0.7, 0.1], ['/help/delivery', 0.012, 0, 0.5, 0.05], ['/help/returns', 0.01, 0, 0.5, 0.05],
      ['/promo/free-delivery', 0.02, 1.1, 0.6, 0.7], ['/promo/2plus1-dailies', 0.025, 2.0, 0.66, 0.7], ['/promo/black-week-preview', 0.018, 0, 0.55, 0.6], ['/search', 0.01, 0.5, 0.5, 0.05],
      ['(not set)', 0.09, 1.0, 0.3, 0.05], ['(other pages)', 0.12, 0.9, 0.55, 0.05],
    ],
    eye: [
      ['/', 0.20, 0.7, 0.55, 0.05], ['/frames', 0.07, 1.2, 0.62, 0.1], ['/frames/men', 0.05, 1.3, 0.63, 0.1], ['/frames/women', 0.06, 1.3, 0.64, 0.1], ['/frames/kids', 0.02, 1.1, 0.62, 0.1],
      ['/sunglasses', 0.06, 1.0, 0.6, 0.5], ['/sunglasses/men', 0.03, 1.0, 0.6, 0.5], ['/sunglasses/women', 0.035, 1.0, 0.6, 0.5], ['/sunglasses/sport', 0.015, 0.9, 0.58, 0.5],
      ['/lens-configurator', 0.03, 2.4, 0.74, 0.1], ['/brands/northline', 0.025, 1.3, 0.64, 0.1], ['/brands/aurelia', 0.02, 1.3, 0.64, 0.1], ['/brands/vistaline', 0.015, 1.2, 0.64, 0.1],
      ['/p/frame-oslo-black', 0.02, 1.8, 0.7, 0.15], ['/p/frame-bled-tortoise', 0.018, 1.8, 0.7, 0.15], ['/p/sun-adria-gold', 0.016, 1.5, 0.68, 0.4],
      ['/blog/choosing-frames-for-face-shape', 0.03, 0, 0.72, 0.1], ['/blog/uv-protection-guide', 0.02, 0, 0.7, 0.3], ['/help/eye-test-booking', 0.015, 0, 0.55, 0.05], ['/help/returns', 0.01, 0, 0.5, 0.05],
      ['/promo/summer-sunglasses', 0.025, 1.2, 0.62, 0.8], ['/promo/back-to-school', 0.02, 1.4, 0.64, 0.8], ['/promo/black-week-preview', 0.02, 0, 0.55, 0.6],
      ['(not set)', 0.09, 1.0, 0.3, 0.05], ['(other pages)', 0.12, 0.9, 0.55, 0.05],
    ],
  };
  function weekWindow(w) {
    var fd = dow(w.from), first = add(w.from, (8 - fd) % 7), last = add(w.to, -dow(w.to));
    if (span(first, last) < 7) { last = add(w.to, -dow(w.to)); first = add(last, -6); }
    return { from: first, to: last, weeks: span(first, last) / 7 };
  }
  function landingSide(sh, devs, ww) {
    var out = {}, pages = PAGES[sh.fam];
    for (var wk = ww.from; wk <= ww.to; wk = add(wk, 7)) {
      var a = agg(sh, devs, wk, add(wk, 6));
      if (!a.sessions) continue;
      var r = D.rng('webshop|land|' + sh.shop + '|' + wk);
      var share = pages.map(function (p, i) {
        var seas = 1 + p[4] * Math.sin(2 * Math.PI * (dn(wk) / (90 + i * 7) + i * 0.37));
        return p[1] * Math.max(0.05, seas) * r.between(0.9, 1.1);
      });
      var ss = share.reduce(function (x, y) { return x + y; }, 0);
      var as = pages.reduce(function (x, p, i) { return x + p[2] * share[i]; }, 0) || 1;
      pages.forEach(function (p, i) {
        var s = Math.round(a.sessions * share[i] / ss);
        var tx = p[2] ? Math.round(a.transactions * p[2] * share[i] / as * r.between(0.8, 1.2)) : 0;
        var o = out[p[0]] || (out[p[0]] = { sessions: 0, engaged: 0, tx: 0, rev: 0 });
        o.sessions += s;
        o.engaged += Math.round(s * p[3] * r.between(0.92, 1.08));
        o.tx += tx;
        o.rev += tx * (a.transactions ? a.revenue / a.transactions : 0) * r.between(0.85, 1.15);
      });
    }
    return out;
  }
  function routeLanding(params) {
    var s = setup(params); if (s.__status) return s;
    var ww = weekWindow(s.w), cw = cmpWindow(ww, s.mode), rows = [];
    s.f.shops.forEach(function (sh) {
      var cur = landingSide(sh, s.f.devs, ww), cmp = landingSide(sh, s.f.devs, cw);
      Object.keys(cur).concat(Object.keys(cmp).filter(function (k) { return !cur[k]; })).forEach(function (page) {
        var c = cur[page] || { sessions: 0, engaged: 0, tx: 0, rev: 0 }, p = cmp[page] || { sessions: 0, engaged: 0, tx: 0, rev: 0 };
        if (!c.sessions && !p.sessions) return;
        rows.push({ shop: sh.shop, page: page, sessions: c.sessions, engaged_sessions: Math.min(c.sessions, c.engaged), transactions: c.tx, revenue: round2(c.rev),
          c_sessions: p.sessions, c_transactions: p.tx, c_revenue: round2(p.rev) });
      });
    });
    return { window: ww, compare: cw, rows: rows };
  }

  // browsers: shares of tracked sessions per device, plus planted problems (relative to the latest data day)
  var BROWSERS = {
    mobile: [['Chrome', 'Android', 0.36, 0.62], ['Safari', 'iOS', 0.38, 0.64], ['Samsung Internet', 'Android', 0.08, 0.6], ['Safari (in-app)', 'iOS', 0.06, 0.45],
      ['Android Webview', 'Android', 0.05, 0.5], ['Firefox', 'Android', 0.02, 0.6], ['Chrome', 'iOS', 0.04, 0.62], ['Edge', 'Android', 0.01, 0.6]],
    desktop: [['Chrome', 'Windows', 0.42, 0.7], ['Chrome', 'Macintosh', 0.08, 0.72], ['Safari', 'Macintosh', 0.10, 0.7], ['Edge', 'Windows', 0.17, 0.68],
      ['Firefox', 'Windows', 0.10, 0.68], ['Firefox', 'Linux', 0.02, 0.66], ['Chrome', 'Linux', 0.02, 0.68], ['Opera', 'Windows', 0.03, 0.66]],
    tablet: [['Safari', 'iOS', 0.60, 0.66], ['Chrome', 'Android', 0.25, 0.62], ['Samsung Internet', 'Android', 0.15, 0.6]],
  };
  var BREAKS = [
    { shop: 'eyewear.example.hr', dev: 'mobile', browser: 'Samsung Internet', os: 'Android', factor: 0.2, from: add(THROUGH, -33) },
    { shop: 'lece.example.hr', dev: 'mobile', browser: 'Safari', os: 'iOS', factor: 0.25, from: add(THROUGH, -24) },
    { shop: 'lenses.example.si', dev: 'mobile', browser: 'Android Webview', os: 'Android', factor: 0.5, from: add(THROUGH, -70) },
    { shop: 'lenses.example.si', dev: 'desktop', browser: 'Opera', os: 'Windows', factor: 3.5, from: add(THROUGH, -400) },
  ];
  function breakFactor(sh, dev, b, w) {
    for (var i = 0; i < BREAKS.length; i++) {
      var x = BREAKS[i];
      if (x.shop !== sh.shop || x.dev !== dev || x.browser !== b[0] || x.os !== b[1]) continue;
      var from = x.from > w.from ? x.from : w.from;
      if (from > w.to) return 1;
      var f = span(from, w.to) / span(w.from, w.to);
      return 1 + f * (x.factor - 1);
    }
    return 1;
  }
  function browserRows(sh, devs, w, period) {
    var rows = [];
    devs.forEach(function (dev) {
      var a = agg(sh, [dev], w.from, w.to);
      if (!a.sessions) return;
      var list = BROWSERS[dev], tSess = a.sessions - a.untracked_sessions, tTx = a.transactions - a.untracked_transactions, tRev = a.revenue - a.untracked_revenue;
      var r = D.rng('webshop|br|' + sh.shop + '|' + dev + '|' + w.from);
      var ws = list.map(function (b) { return b[2] * D.rng('webshop|brw|' + sh.shop + '|' + dev + '|' + b[0] + b[1]).between(0.92, 1.08); });
      var wsum = ws.reduce(function (x, y) { return x + y; }, 0);
      var aff = list.map(function (b, i) { return ws[i] * D.rng('webshop|bra|' + sh.shop + '|' + dev + '|' + b[0] + b[1]).between(0.88, 1.12) * breakFactor(sh, dev, b, w); });
      var asum = aff.reduce(function (x, y) { return x + y; }, 0);
      var part = list.map(function (b, i) {
        var s = Math.round(tSess * ws[i] / wsum * r.between(0.97, 1.03));
        var t = Math.round(tTx * aff[i] / asum);
        return { b: b, s: s, t: t };
      });
      var big = 0; part.forEach(function (p, i) { if (p.s > part[big].s) big = i; });
      part[big].s += tSess - part.reduce(function (x, p) { return x + p.s; }, 0);
      part[big].t += tTx - part.reduce(function (x, p) { return x + p.t; }, 0);
      part.forEach(function (p) {
        if (p.s < 0) p.s = 0; if (p.t < 0) p.t = 0;
        if (!p.s && !p.t) return;
        rows.push({ period: period, shop: sh.shop, device: dev, browser: p.b[0], os: p.b[1], sessions: p.s,
          engaged_sessions: Math.min(p.s, Math.round(p.s * p.b[3] * r.between(0.95, 1.05))), transactions: p.t, revenue: round2(tTx ? tRev * p.t / tTx : 0) });
      });
      if (a.untracked_sessions || a.untracked_transactions) {
        rows.push({ period: period, shop: sh.shop, device: dev, browser: '(not set)', os: '(not set)', sessions: a.untracked_sessions,
          engaged_sessions: Math.round(a.untracked_sessions * 0.1), transactions: a.untracked_transactions, revenue: a.untracked_revenue });
      }
    });
    return rows;
  }
  function routeBrowsers(params) {
    var s = setup(params); if (s.__status) return s;
    var rows = [];
    s.f.shops.forEach(function (sh) { rows = rows.concat(browserRows(sh, s.f.devs, s.w, 'cur'), browserRows(sh, s.f.devs, s.c, 'cmp')); });
    return { window: s.w, compare: s.c, rows: rows };
  }

  // promotions: views, clicks and what they sold, per shop and promotion (device filter does not apply)
  // [name, placement, views per session, CTR, add-to-cart per click, purchase per add-to-cart, active 'MM-DD' window or null]
  var PROMOS = {
    common: [
      ['Free delivery over 49 EUR', 'Header ribbon', 0.9, 0.004, 0.02, 0.15, null],
      ['Welcome 10% newsletter', 'Popup', 0.05, 0.03, 0.01, 0.1, null],
      ['Cart upsell: lens solution', 'Cart upsell', 4.0, 0.0012, 0.5, 0.3, null],
      ['Product page cross-sell: care kit', 'Product page cross-sell', 0.5, 0.006, 0.4, 0.25, null],
      ['Newsletter popup, variant B', 'Popup', 0.04, 0.026, 0.01, 0.1, ['09-01', '10-31']],
      ['Black week -25%', 'Homepage hero banner', 0.5, 0.014, 0.06, 0.2, ['11-18', '12-02']],
    ],
    lens: [
      ['Daily lenses 2+1', 'Homepage hero banner', 0.5, 0.011, 0.06, 0.2, null],
      ['Switch to monthly -15%', 'Category banner', 0.3, 0.008, 0.05, 0.15, ['09-15', '11-15']],
      ['Autumn dry-eye guide', 'Homepage hero banner', 0.4, 0.009, 0.03, 0.1, ['09-20', '11-10']],
      ['Summer eye-care guide', 'Homepage hero banner', 0.4, 0.009, 0.03, 0.1, ['06-01', '08-31']],
      ['Free solution with 6 boxes', 'Category banner', 0.3, 0.01, 0.07, 0.2, null],
    ],
    eye: [
      ['Sunglasses -20% summer', 'Homepage hero banner', 0.5, 0.012, 0.05, 0.15, ['06-01', '08-31']],
      ['Back to school frames', 'Homepage hero banner', 0.5, 0.011, 0.05, 0.15, ['08-15', '09-30']],
      ['Autumn collection', 'Homepage hero banner', 0.5, 0.012, 0.05, 0.15, ['09-15', '11-15']],
      ['Free lens upgrade with frames', 'Category banner', 0.35, 0.009, 0.06, 0.18, null],
      ['Gift cards', 'Homepage hero banner', 0.45, 0.01, 0.04, 0.2, ['12-01', '12-24']],
      ['Eye test booking', 'Header ribbon', 0.8, 0.005, 0.0, 0.0, null],
    ],
  };
  function promoSide(sh, w) {
    var out = {}, list = D.days(w.from < FIRST ? FIRST : w.from, w.to > THROUGH ? THROUGH : w.to);
    var tpl = PROMOS.common.concat(PROMOS[sh.fam]);
    list.forEach(function (day) {
      var md = day.slice(5), sess = null;
      tpl.forEach(function (p, i) {
        if (p[6] && (md < p[6][0] || md > p[6][1])) return;
        if (sess === null) sess = agg(sh, DEVICES, day, day).sessions;
        var r = D.rng('webshop|promo|' + sh.shop + '|' + i + '|' + day);
        var views = Math.round(sess * p[2] * r.between(0.85, 1.15)), clicks = Math.floor(views * p[3] * r.between(0.8, 1.2) + r());
        var atc = Math.floor(clicks * p[4] * r.between(0.7, 1.3) + r()), buy = Math.floor(atc * p[5] * r.between(0.6, 1.4) + r());
        var o = out[p[0]] || (out[p[0]] = { p: p, views: 0, clicks: 0, atc: 0, buy: 0, rev: 0, days: 0 });
        o.views += views; o.clicks += clicks; o.atc += atc; o.buy += buy; o.days++;
        o.rev += buy * sh.aov * 0.55 * r.between(0.8, 1.2);
      });
    });
    return out;
  }
  function routePromotions(params) {
    var s = setup(params); if (s.__status) return s;
    var rows = [];
    s.f.shops.forEach(function (sh) {
      var cur = promoSide(sh, s.w), cmp = promoSide(sh, s.c);
      Object.keys(cur).forEach(function (name) {
        var c = cur[name], p = cmp[name];
        if (!c.views) return;
        rows.push({ shop: sh.shop, promotion: name, creative: c.p[1], views: c.views, clicks: c.clicks, add_to_cart: c.atc, purchases: c.buy, revenue: round2(c.rev), days: c.days,
          c_views: p ? p.views : 0, c_clicks: p ? p.clicks : 0 });
      });
    });
    return { window: s.w, compare: s.c, rows: rows };
  }

  // ── router ──────────────────────────────────────────────────────────────
  D.register('/api/webshop/', function (path, params) {
    path = String(path || '').replace(/^\/+|\/+$/g, '');
    switch (path) {
      case 'session': return { signedIn: true, allowed: true, email: 'demo@adrial.example' };
      case 'meta': return routeMeta();
      case 'overview': return routeOverview(params);
      case 'quality': return routeQuality(params);
      case 'categories': return routeCategories(params);
      case 'landing': return routeLanding(params);
      case 'browsers': return routeBrowsers(params);
      case 'promotions': return routePromotions(params);
      default: return { __status: 404, error: 'Unknown route: ' + path };
    }
  });
})();
