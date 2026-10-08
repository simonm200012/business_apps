/* Ads & Return: demo data for /api/ads/* (made-up sample numbers, answered in the browser).
 * Needs /_shared/demo-api.js loaded first. Everything here is fictional: campaigns, stores' figures and the
 * account e-mail. Numbers are generated per campaign and day from a seeded generator, so every page
 * (overview, campaigns, stores, pacing, waste, channels) adds up to the same totals and a given day always
 * has the same values whatever date range is asked for. */
(function () {
  'use strict';
  var D = window.AdrialDemo;
  if (!D || !D.register) return;

  // ---------- helpers ----------
  function r1(x) { return Math.round(x * 10) / 10; }
  function r2(x) { return Math.round(x * 100) / 100; }
  function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function daysInMonth(y, m) { return new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); }
  function shiftYear(day, n) { // same calendar day n years earlier (29 Feb falls back to 28 Feb)
    var d = D.parseDay(day), y = d.getUTCFullYear() + n, m = d.getUTCMonth(), dd = Math.min(d.getUTCDate(), daysInMonth(y, m));
    return D.iso(new Date(Date.UTC(y, m, dd)));
  }
  var ANCHOR = D.parseDay('2026-10-01').getTime();
  function trend(day) { var t = (D.parseDay(day).getTime() - ANCHOR) / 86400000 / 365; return clamp(1 + 0.14 * t, 0.7, 1.3); }

  function dataThrough() { return D.iso(D.addDays(D.today(), -1)); }
  function apptThrough() { return D.iso(D.addDays(D.today(), -3)); } // the booking export lags a couple of days

  var MARKETS = ['SI', 'HR', 'IT'];
  var AOV = { SI: 68, HR: 64, IT: 70 };

  // ---------- campaign catalogue (fictional) ----------
  var CAMPS = [];
  function add(c, x) {
    var base = { store: '', claim: 0, match: true, aware: false, dud: '', start: '2024-01-01', end: '', ch: '', roas: 0, aov: 0, cpl: 0, cpa: 0 };
    var k; for (k in base) if (c[k] === undefined) c[k] = base[k]; for (k in x || {}) c[k] = x[k];
    c.i = CAMPS.length; CAMPS.push(c);
  }
  // web shop campaigns: name, platform, market, category, daily budget, cpc, ctr, GA4 roas, avg order, GA4 channel
  function E(name, p, m, cat, base, cpc, ctr, roas, aov, ch, x) {
    var c = { name: name, p: p, m: m, a: 'E-commerce', cat: cat, base: base, cpc: cpc, ctr: ctr, roas: roas, aov: aov, ch: ch };
    add(c, x); if (p === 'Meta' && !CAMPS[c.i].claim) CAMPS[c.i].claim = roas * 2.3;
  }
  // optics (store booking) campaigns
  function O(store, m, p, base, x) {
    var g = p === 'Google';
    add({ name: m + ' | ' + store + ' | ' + (g ? 'Search | Eye Exam & Lenses' : 'Meta | Free Eye Exam Leads'), p: p, m: m, a: 'Optics / retail', cat: 'Optics', store: store,
      base: base, cpc: g ? 0.55 : 0.45, ctr: g ? 0.06 : 0.012, cpl: g ? 8.5 : 6.5, cpa: g ? 28 : 22 }, x);
  }
  var PS = 'Paid Search', SH = 'Paid Shopping', XN = 'Cross-network', SO = 'Paid Social';
  // Google, Slovenia
  E('SI | Search | ClearDay Lenses | Brand', 'Google', 'SI', 'Contact lenses', 55, 0.14, 0.11, 8.2, 68, PS);
  E('SI | Search | Contact Lenses | Generic', 'Google', 'SI', 'Contact lenses', 70, 0.42, 0.045, 4.4, 64, PS);
  E('SI | Shopping | Daily Lenses', 'Google', 'SI', 'Contact lenses', 85, 0.28, 0.022, 4.8, 66, SH);
  E('SI | PMax | Nordvik Frames', 'Google', 'SI', 'Frames', 60, 0.33, 0.018, 3.2, 142, XN);
  E('SI | PMax | Solenne Sunglasses', 'Google', 'SI', 'Sunglasses', 48, 0.38, 0.016, 2.9, 128, XN, { start: '2025-03-01' });
  E('SI | Search | Lens Solutions & Care', 'Google', 'SI', 'Solutions', 20, 0.22, 0.06, 5.1, 24, PS);
  E('SI | YouTube Reach | Summer Sunglasses', 'Google', 'SI', 'Sunglasses', 25, 0.07, 0.006, 0, 0, 'Paid Video', { aware: true });
  E('SI | PMax | Summer Sunglasses Sale', 'Google', 'SI', 'Sunglasses', 52, 0.36, 0.017, 3.1, 124, XN, { start: '2026-05-20', end: '2026-08-31' });
  E('SI | Search | Black Friday 2025', 'Google', 'SI', 'Mixed', 120, 0.31, 0.058, 5.5, 74, PS, { start: '2025-11-14', end: '2025-12-01' });
  E('SI | Display | Remarketing Test', 'Google', 'SI', 'Mixed', 14, 0.12, 0.004, 1.2, 60, 'Display', { dud: 'always' });
  // Google, Croatia
  E('HR | Search | Kontaktne leće | Brand', 'Google', 'HR', 'Contact lenses', 40, 0.12, 0.10, 7.6, 62, PS);
  E('HR | Shopping | Daily Lenses', 'Google', 'HR', 'Contact lenses', 55, 0.24, 0.02, 4.6, 61, SH);
  E('HR | PMax | Nordvik Frames', 'Google', 'HR', 'Frames', 38, 0.30, 0.017, 3.0, 138, XN);
  E('HR | PMax | Solenne Sunglasses', 'Google', 'HR', 'Sunglasses', 30, 0.34, 0.015, 2.7, 120, XN);
  E('HR | Search | Lens Solutions', 'Google', 'HR', 'Solutions', 12, 0.20, 0.055, 4.9, 22, PS);
  E('HR | Demand Gen | Prospecting Frames', 'Google', 'HR', 'Frames', 22, 0.18, 0.009, 0, 0, XN, { aware: true });
  E('HR | Search | Frames Broad Match', 'Google', 'HR', 'Frames', 13, 0.36, 0.03, 1.6, 120, PS, { dud: '2026-08-25' });
  // Google, Italy
  E('IT | Search | Lenti a contatto | Generic', 'Google', 'IT', 'Contact lenses', 32, 0.38, 0.04, 3.6, 69, PS);
  E('IT | Shopping | Lenti giornaliere', 'Google', 'IT', 'Contact lenses', 36, 0.26, 0.02, 4.0, 67, SH);
  E('IT | PMax | Occhiali da sole', 'Google', 'IT', 'Sunglasses', 22, 0.33, 0.015, 2.5, 118, XN);
  // Meta, Slovenia
  E('SI | Meta | Retargeting 30d', 'Meta', 'SI', 'Mixed', 45, 0.30, 0.012, 4.2, 66, SO);
  E('SI | Meta | Prospecting Lookalike', 'Meta', 'SI', 'Contact lenses', 55, 0.40, 0.009, 1.9, 62, SO);
  E('SI | Meta | Catalog Sales', 'Meta', 'SI', 'Frames', 40, 0.34, 0.011, 3.0, 110, SO);
  E('SI | Meta | Brand Awareness Reach', 'Meta', 'SI', 'Brand', 18, 0.20, 0.006, 0, 0, SO, { aware: true });
  E('SI | Meta | Sunglasses Carousel', 'Meta', 'SI', 'Sunglasses', 25, 0.37, 0.010, 2.4, 120, SO);
  E('SI | Meta | Story Ads Test', 'Meta', 'SI', 'Mixed', 11, 0.33, 0.008, 1.5, 60, SO, { dud: '2026-09-12', match: false });
  // Meta, Croatia
  E('HR | Meta | Retargeting 30d', 'Meta', 'HR', 'Mixed', 30, 0.28, 0.012, 4.0, 63, SO);
  E('HR | Meta | Prospecting Lookalike', 'Meta', 'HR', 'Contact lenses', 36, 0.38, 0.009, 1.8, 59, SO);
  E('HR | Meta | Catalog Sales', 'Meta', 'HR', 'Frames', 26, 0.33, 0.011, 2.9, 104, SO);
  E('HR | Meta | Video Views Lens Explainer', 'Meta', 'HR', 'Contact lenses', 14, 0.10, 0.007, 0, 0, SO, { aware: true });
  E('HR | Meta | Black Friday 2025 Catalog', 'Meta', 'HR', 'Mixed', 60, 0.32, 0.011, 3.6, 70, SO, { start: '2025-11-14', end: '2025-12-01' });
  // Meta, Italy
  E('IT | Meta | Retargeting', 'Meta', 'IT', 'Mixed', 18, 0.27, 0.012, 3.8, 68, SO);
  E('IT | Meta | Prospecting', 'Meta', 'IT', 'Contact lenses', 22, 0.36, 0.009, 1.7, 64, SO);
  E('IT | Meta | Catalog Sales', 'Meta', 'IT', 'Frames', 14, 0.32, 0.010, 2.6, 108, SO, { match: false });
  E('IT | Meta | Prospecting Test B', 'Meta', 'IT', 'Mixed', 9, 0.35, 0.008, 1.4, 60, SO, { dud: 'always' });
  // optics
  var STORES = [
    { name: 'Ljubljana', m: 'SI', g: 38, me: 26 }, { name: 'Maribor', m: 'SI', g: 20, me: 14 }, { name: 'Celje', m: 'SI', g: 13, me: 9 },
    { name: 'Koper', m: 'SI', g: 11, me: 0 }, { name: 'Zagreb', m: 'HR', g: 30, me: 22 }, { name: 'Split', m: 'HR', g: 16, me: 11 },
  ];
  STORES.forEach(function (s) {
    O(s.name, s.m, 'Google', s.g);
    if (s.me) O(s.name, s.m, 'Meta', s.me, s.name === 'Split' ? { name: 'HR | Split | Meta | Lead Form Test', dud: '2026-09-01' } : null);
  });

  var BY_MARKET_E = {}, BY_STORE = {};
  MARKETS.forEach(function (m) { BY_MARKET_E[m] = []; });
  CAMPS.forEach(function (c) {
    if (c.a === 'E-commerce') BY_MARKET_E[c.m].push(c.i);
    else (BY_STORE[c.store] = BY_STORE[c.store] || []).push(c.i);
  });

  // ---------- one campaign, one day ----------
  var ZERO = { spend: 0, clicks: 0, impr: 0, conv: 0, cv: 0, sess: 0, orders: 0, rev: 0, appts: 0 };
  var dayCache = {};
  function campDay(ci, date) {
    var key = ci + '|' + date, hit = dayCache[key];
    if (hit) return hit;
    var c = CAMPS[ci], out;
    if (date < c.start || (c.end && date > c.end)) out = ZERO;
    else {
      var r = D.rng('ads|' + c.i + '|' + date);
      var spend = r2(c.base * D.shape(date) * trend(date) * (0.78 + 0.44 * r()));
      var clicks = Math.round(spend / (c.cpc * (0.9 + 0.2 * r())));
      var impr = Math.round(clicks / (c.ctr * (0.9 + 0.2 * r())));
      var sess = Math.round(clicks * (0.8 + 0.12 * r()));
      var conv = 0, cv = 0, orders = 0, rev = 0, appts = 0;
      var live = !c.aware && !(c.dud === 'always' || (c.dud && date >= c.dud));
      if (live) {
        if (c.a === 'E-commerce') {
          var want = spend * c.roas * (0.7 + 0.6 * r());
          orders = Math.round(want / (c.aov * (0.9 + 0.2 * r())));
          if (orders) {
            rev = r2(orders * c.aov * (0.92 + 0.16 * r()));
            conv = r1(orders * (c.p === 'Meta' ? 1.3 + 0.9 * r() : 1 + 0.4 * r()));
            cv = c.p === 'Meta' ? r2(spend * c.claim * (0.8 + 0.4 * r())) : r2(rev * (1.05 + 0.25 * r()));
          }
        } else {
          conv = r1(spend / c.cpl * (0.7 + 0.6 * r()));
          appts = Math.floor(spend / (c.cpa * (0.8 + 0.4 * r())) + r());
        }
      }
      out = { spend: spend, clicks: clicks, impr: impr, conv: conv, cv: cv, sess: sess, orders: orders, rev: rev, appts: appts };
    }
    dayCache[key] = out;
    return out;
  }

  // ---------- GA4 per market and day (web shops), with channels ----------
  var ENG = { 'Paid Search': 0.62, 'Paid Shopping': 0.58, 'Cross-network': 0.55, 'Paid Social': 0.42, 'Paid Video': 0.35, 'Display': 0.3, 'Paid Other': 0.5,
    'Organic Search': 0.64, 'Direct': 0.66, 'Email': 0.7, 'Referral': 0.55, 'Organic Social': 0.4, 'Affiliates': 0.5, 'Unassigned': 0.45 };
  var NONPAID = [['Organic Search', 0.34, 0.021], ['Direct', 0.26, 0.032], ['Email', 0.20, 0.045], ['Referral', 0.07, 0.016],
    ['Organic Social', 0.05, 0.008], ['Affiliates', 0.05, 0.03], ['Unassigned', 0.03, 0.01]];
  var ga4Cache = {};
  function ga4Day(m, date) {
    var key = m + '|' + date, hit = ga4Cache[key];
    if (hit) return hit;
    var ch = {}, gRev = 0, mRev = 0;
    function put(name, sessions, orders, rev) {
      var x = ch[name] || (ch[name] = { sessions: 0, orders: 0, revenue: 0, paid: true });
      x.sessions += sessions; x.orders += orders; x.revenue += rev;
    }
    BY_MARKET_E[m].forEach(function (ci) {
      var c = CAMPS[ci], d = campDay(ci, date);
      if (!d.spend) return;
      put(c.ch, d.sess, d.orders, d.rev);
      if (c.p === 'Google') gRev += d.rev; else mRev += d.rev;
    });
    var r = D.rng('ga4|' + m + '|' + date);
    var other = r2((gRev + mRev) * 0.04 * (0.8 + 0.4 * r()));
    var otherOrders = Math.round(other / (AOV[m] * 0.95));
    put('Paid Other', Math.round(otherOrders / 0.02), otherOrders, other);
    var paidRev = 0;
    Object.keys(ch).forEach(function (k) { paidRev += ch[k].revenue; });
    var share = clamp(0.64 + 0.12 * (r() - 0.5) * 2 - (m === 'IT' ? 0.1 : 0), 0.45, 0.78);
    var nonPaid = paidRev * (1 / share - 1);
    var ws = NONPAID.map(function (n) { return n[1] * (0.85 + 0.3 * r()); }), wt = ws.reduce(function (a, b) { return a + b; }, 0);
    NONPAID.forEach(function (n, i) {
      var rev = r2(nonPaid * ws[i] / wt), orders = Math.round(rev / (AOV[m] * (0.92 + 0.16 * r())));
      ch[n[0]] = { sessions: Math.round(orders / n[2]), orders: orders, revenue: rev, paid: false };
    });
    var tot = { revenue: 0, orders: 0, sessions: 0, paid_revenue: 0, gRev: r2(gRev), mRev: r2(mRev), ch: {} };
    Object.keys(ch).forEach(function (k) {
      var x = ch[k], eng = Math.round(x.sessions * ENG[k] * (0.92 + 0.16 * r()));
      var atc = x.sessions ? Math.max(x.orders, Math.round(x.orders * (4.5 + 1.5 * r()))) : 0;
      var co = x.sessions ? Math.max(x.orders, Math.round(atc * (0.5 + 0.1 * r()))) : 0;
      tot.ch[k] = { sessions: x.sessions, engaged: Math.min(eng, x.sessions), orders: x.orders, revenue: r2(x.revenue), add_to_carts: Math.min(atc, x.sessions || atc), checkouts: co };
      tot.revenue += x.revenue; tot.orders += x.orders; tot.sessions += x.sessions;
      if (x.paid) tot.paid_revenue += x.revenue;
    });
    tot.revenue = r2(tot.revenue); tot.paid_revenue = r2(tot.paid_revenue);
    ga4Cache[key] = tot;
    return tot;
  }

  // ---------- optics: bookings per store and day ----------
  var storeCache = {};
  function storeDay(s, date) {
    var key = s.name + '|' + date, hit = storeCache[key];
    if (hit) return hit;
    var g = 0, me = 0, ads = 0;
    BY_STORE[s.name].forEach(function (ci) {
      var d = campDay(ci, date);
      if (CAMPS[ci].p === 'Google') g += d.spend; else me += d.spend;
      ads += d.appts;
    });
    var r = D.rng('store|' + s.name + '|' + date);
    var paid = ads + Math.round(ads * (0.5 + 0.4 * r()));
    var total = Math.round(paid / (0.5 + 0.15 * r())) + ((g + me) > 0 && r() < 0.35 ? 1 : 0);
    var out = { google: r2(g), meta: r2(me), ads: ads, paid: paid, total: total };
    storeCache[key] = out;
    return out;
  }

  // ---------- request window ----------
  function win(params) {
    var thr = dataThrough();
    var t = D.parseDay(thr);
    var from = params.get('from'), to = params.get('to');
    if (!D.parseDay(from)) from = D.iso(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1)));
    if (!D.parseDay(to)) to = thr;
    if (from > to) { var sw = from; from = to; to = sw; }
    if (to > thr) to = thr;
    var cur = D.days(from, to);
    if (cur.length > 800) { cur = cur.slice(cur.length - 800); from = cur[0]; }
    var compare = params.get('compare') === 'prev' ? 'prev' : 'yoy';
    var len = Math.max(1, D.days(from, to).length);
    var prev = cur.map(function (d) { return compare === 'yoy' ? shiftYear(d, -1) : D.iso(D.addDays(D.parseDay(d), -len)); });
    var market = params.get('market');
    return { from: from, to: to, compare: compare, cur: cur, prev: prev, market: MARKETS.indexOf(market) >= 0 ? market : '',
      markets: MARKETS.indexOf(market) >= 0 ? [market] : MARKETS.slice(),
      platform: params.get('platform') || '', area: params.get('area') || '' };
  }
  function windowObj(w) { return { from: w.from, to: w.to, compare: w.compare }; }
  // bookings are cut at the export's last day; the comparison is cut at the same offset
  function apptOk(w, per, i) { return w.cur[i] <= apptThrough(); }

  // ---------- routes ----------
  function session() { return { signedIn: true, allowed: true, email: 'demo@adrial.example' }; }

  function meta() {
    var thr = dataThrough();
    return { dataThrough: thr, freshness: { 'Google Ads': thr, 'Meta Ads': thr, 'GA4': thr, 'Appointments': apptThrough() } };
  }

  function overview(params) {
    var w = win(params), AP = apptThrough();
    var out = { window: windowObj(w), freshness: { 'Google Ads': dataThrough(), 'Meta Ads': dataThrough(), 'GA4': dataThrough(), 'Appointments': AP },
      ads: [], ga4: [], paid: [], appointments: [] };
    [['cur', w.cur], ['prev', w.prev]].forEach(function (pp) {
      var per = pp[0], list = pp[1];
      list.forEach(function (date, i) {
        w.markets.forEach(function (m) {
          var acc = {};
          CAMPS.forEach(function (c) {
            if (c.m !== m) return;
            var d = campDay(c.i, date);
            if (!d.spend) return;
            var k = c.p + '|' + c.a, x = acc[k] || (acc[k] = { period: per, date: date, platform: c.p, market: m, area: c.a, spend: 0, conv_value: 0 });
            x.spend += d.spend; x.conv_value += d.cv;
          });
          Object.keys(acc).forEach(function (k) { var x = acc[k]; x.spend = r2(x.spend); x.conv_value = r2(x.conv_value); out.ads.push(x); });
          var g = ga4Day(m, date);
          out.ga4.push({ period: per, date: date, market: m, revenue: g.revenue, orders: g.orders, sessions: g.sessions, paid_revenue: g.paid_revenue });
          out.paid.push({ period: per, date: date, market: m, platform: 'Google', revenue: g.gRev }, { period: per, date: date, market: m, platform: 'Meta', revenue: g.mRev });
          if (apptOk(w, per, i)) {
            var n = 0, any = false;
            STORES.forEach(function (s) { if (s.m === m) { n += storeDay(s, date).total; any = true; } });
            if (any) out.appointments.push({ period: per, date: date, market: m, appointments: n });
          }
        });
      });
    });
    // rows must be tagged for the right day when cut applies to the comparison: prev rows were already limited above by cur-date offset
    return out;
  }

  function campaigns(params) {
    var w = win(params), AP = apptThrough();
    var rows = [];
    CAMPS.forEach(function (c) {
      if (w.market && c.m !== w.market) return;
      if (w.platform && c.p !== w.platform) return;
      if (w.area && c.a !== w.area) return;
      var t = { spend: 0, clicks: 0, impressions: 0, conversions: 0, conv_value: 0, sessions: 0, orders: 0, revenue: 0, appointments: 0 }, prev = 0;
      w.cur.forEach(function (date) {
        var d = campDay(c.i, date);
        t.spend += d.spend; t.clicks += d.clicks; t.impressions += d.impr; t.conversions += d.conv; t.conv_value += d.cv;
        t.sessions += d.sess; t.orders += d.orders; t.revenue += d.rev; if (date <= AP) t.appointments += d.appts;
      });
      w.prev.forEach(function (date) { prev += campDay(c.i, date).spend; });
      if (!(t.spend > 0)) return;
      var matched = c.match;
      rows.push({ campaign: c.name, platform: c.p, market: c.m, area: c.a, category: c.cat, store: c.store || null,
        spend: r2(t.spend), prev_spend: r2(prev), clicks: t.clicks, impressions: t.impressions, conversions: r1(t.conversions), conv_value: r2(t.conv_value),
        sessions: matched ? t.sessions : 0, orders: matched ? t.orders : 0, revenue: matched ? r2(t.revenue) : 0, appointments: t.appointments });
    });
    rows.sort(function (a, b) { return b.spend - a.spend; });
    return { window: windowObj(w), campaigns: rows };
  }

  function stores(params) {
    var w = win(params), AP = apptThrough();
    var none = w.from > AP, partial = !none && w.to > AP;
    var rows = [], daily = [];
    STORES.forEach(function (s) {
      if (w.market && s.m !== w.market) return;
      var o = { store: s.name, market: s.m, google: 0, meta: 0, appointments: 0, prev_appointments: 0, from_paid: 0, from_store_ads: 0 };
      w.cur.forEach(function (date) {
        var d = storeDay(s, date), ok = date <= AP;
        o.google += d.google; o.meta += d.meta;
        daily.push({ store: s.name, date: date, kind: 'spend', value: r2(d.google + d.meta) });
        if (ok) {
          o.appointments += d.total; o.from_paid += d.paid; o.from_store_ads += d.ads;
          daily.push({ store: s.name, date: date, kind: 'appointments', value: d.total });
        }
      });
      w.prev.forEach(function (date, i) { if (w.cur[i] <= AP) o.prev_appointments += storeDay(s, date).total; });
      o.google = r2(o.google); o.meta = r2(o.meta);
      rows.push(o);
    });
    return { window: windowObj(w), appointmentsThrough: AP, bookings: { partial: partial, none: none, ato: AP }, stores: rows, daily: daily };
  }

  function sumRange(from, to, byKey) {
    var out = {};
    D.days(from, to).forEach(function (date) {
      CAMPS.forEach(function (c) {
        var d = campDay(c.i, date);
        if (!d.spend) return;
        var k = c.m + '|' + c.p + '|' + c.a;
        out[k] = (out[k] || 0) + d.spend;
      });
    });
    return out;
  }
  function pacing() {
    var thr = dataThrough(), t = D.parseDay(thr), y = t.getUTCFullYear(), mo = t.getUTCMonth(), dom = t.getUTCDate(), dim = daysInMonth(y, mo);
    var first = D.iso(new Date(Date.UTC(y, mo, 1)));
    var py = mo === 0 ? y - 1 : y, pm = mo === 0 ? 11 : mo - 1, pdim = daysInMonth(py, pm);
    var lmFirst = D.iso(new Date(Date.UTC(py, pm, 1)));
    var mtd = sumRange(first, thr);
    var same = sumRange(lmFirst, D.iso(new Date(Date.UTC(py, pm, Math.min(dom, pdim)))));
    var last7 = sumRange(D.iso(D.addDays(t, -6)), thr);
    var lm = sumRange(lmFirst, D.iso(new Date(Date.UTC(py, pm, pdim))));
    var ly = sumRange(D.iso(new Date(Date.UTC(y - 1, mo, 1))), D.iso(new Date(Date.UTC(y - 1, mo, daysInMonth(y - 1, mo)))));
    var keys = {};
    [mtd, same, last7, lm, ly].forEach(function (o) { Object.keys(o).forEach(function (k) { keys[k] = 1; }); });
    var rows = Object.keys(keys).sort().map(function (k) {
      var p = k.split('|');
      return { market: p[0], platform: p[1], area: p[2], mtd: r2(mtd[k] || 0), last_month_same_days: r2(same[k] || 0), last7_daily: r2((last7[k] || 0) / 7),
        last_month_total: r2(lm[k] || 0), last_year_total: r2(ly[k] || 0) };
    });
    return { month: MONTHS[mo] + ' ' + y, dayOfMonth: dom, daysInMonth: dim, asof: thr, rows: rows };
  }

  function waste(params) {
    var days = clamp(parseInt(params.get('days'), 10) || 30, 1, 365);
    var min = Math.max(0, Number(params.get('min')) || 0);
    var market = MARKETS.indexOf(params.get('market')) >= 0 ? params.get('market') : '';
    var to = dataThrough(), from = D.iso(D.addDays(D.parseDay(to), -(days - 1)));
    var list = D.days(from, to), rows = [];
    CAMPS.forEach(function (c) {
      if (market && c.m !== market) return;
      var t = { spend: 0, clicks: 0, impressions: 0, conv: 0, orders: 0, appts: 0, sessions: 0 }, last = '';
      list.forEach(function (date) {
        var d = campDay(c.i, date);
        if (d.spend > 0) last = date;
        t.spend += d.spend; t.clicks += d.clicks; t.impressions += d.impr; t.conv += d.conv; t.orders += d.orders; t.appts += d.appts; t.sessions += d.sess;
      });
      if (t.spend < min || t.spend <= 0 || t.conv > 0 || t.orders > 0 || t.appts > 0) return;
      rows.push({ campaign: c.name, platform: c.p, market: c.m, area: c.a, category: c.cat, store: c.store || null, spend: r2(t.spend), clicks: t.clicks,
        impressions: t.impressions, sessions: c.match ? t.sessions : 0, last_spend: last });
    });
    rows.sort(function (a, b) { return b.spend - a.spend; });
    return { minSpend: min, window: { from: from, to: to }, campaigns: rows };
  }

  function channels(params) {
    var w = win(params), map = {}, rows = [];
    [['cur', w.cur], ['prev', w.prev]].forEach(function (pp) {
      pp[1].forEach(function (date) {
        w.markets.forEach(function (m) {
          var g = ga4Day(m, date);
          Object.keys(g.ch).forEach(function (name) {
            var k = pp[0] + '|' + name, x = map[k];
            if (!x) { x = map[k] = { period: pp[0], channel: name, sessions: 0, engaged: 0, orders: 0, revenue: 0, add_to_carts: 0, checkouts: 0 }; rows.push(x); }
            var s = g.ch[name];
            x.sessions += s.sessions; x.engaged += s.engaged; x.orders += s.orders; x.revenue += s.revenue; x.add_to_carts += s.add_to_carts; x.checkouts += s.checkouts;
          });
        });
      });
    });
    rows.forEach(function (x) { x.revenue = r2(x.revenue); });
    return { window: windowObj(w), rows: rows };
  }

  D.register('/api/ads/', function (path, params) {
    path = String(path || '').replace(/\/+$/, '');
    switch (path) {
      case 'session': return session();
      case 'meta': return meta();
      case 'overview': return overview(params);
      case 'campaigns': return campaigns(params);
      case 'stores': return stores(params);
      case 'pacing': return pacing();
      case 'waste': return waste(params);
      case 'channels': return channels(params);
      default: return { __status: 404, error: 'Not found' };
    }
  });

  // The "Data & definitions" page says the numbers are real company data; say what they are in the demo.
  (function () {
    if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return;
    function fix(root) {
      if (!root || !root.querySelectorAll) return;
      var subs = root.querySelectorAll('.sub');
      for (var i = 0; i < subs.length; i++) if (subs[i].textContent === 'Real company data') {
        subs[i].textContent = 'Demo data';
        var p = subs[i].nextElementSibling;
        if (p && /^Only approved/.test(p.textContent)) p.textContent = 'This is made-up sample data, generated in your browser for demonstration. Nothing here comes from a real account, campaign or customer.';
      }
    }
    function go() {
      var main = document.getElementById('main');
      if (!main) return;
      new MutationObserver(function () { fix(main); }).observe(main, { childList: true, subtree: true });
      fix(main);
    }
    if (document.getElementById('main')) go(); else document.addEventListener('DOMContentLoaded', go);
  })();
})();
