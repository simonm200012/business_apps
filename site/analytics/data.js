/* Adrial Analytics: deterministic demo-data generator.
 * Everything here is FICTIONAL. Values depend only on the calendar date and a fixed seed,
 * so the same day always produces the same numbers, whatever "today" is.
 *
 * Exposes window.AA with dense typed arrays:
 *   S   [day][combo][measure]   sales per location x category x channel (7 measures, see MEASURES)
 *   OPS [day][store][3]         foot traffic, eye-exam bookings, eye exams performed
 *   FUN [day][eshop][source][6] sessions, product views, add to cart, checkout, orders, marketing spend
 * E-shop orders in FUN equal the E-shop channel orders in S for the same e-shop and day. */
(function (root) {
  'use strict';
  var t0 = (root.performance && performance.now) ? performance.now() : Date.now();
  var DAYMS = 864e5;
  function dnOf(y, m, d) { return Math.round(Date.UTC(y, m, d) / DAYMS); }
  function dateOf(dn) { return new Date(dn * DAYMS); }
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  function iso(dn) { var d = dateOf(dn); return d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate()); }
  function dim(y, m) { return new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); }

  // ── Calendar window: first day of the month 24 months ago … today (local date) ──
  var now = new Date();
  var TODAY = dnOf(now.getFullYear(), now.getMonth(), now.getDate());
  var START = dnOf(now.getFullYear() - 2, now.getMonth(), 1);
  var ND = TODAY - START + 1;
  var EPOCH = dnOf(2024, 0, 1);

  var monthStart = [], monthLabel = [];
  var dayMonth = new Uint16Array(ND);
  (function () {
    var y = now.getFullYear() - 2, m = now.getMonth(), mi = -1, last = '';
    for (var d = 0; d < ND; d++) {
      var dt = dateOf(START + d), key = dt.getUTCFullYear() + '-' + dt.getUTCMonth();
      if (key !== last) { mi++; last = key; monthStart.push(START + d); monthLabel.push(dt.getUTCFullYear() * 100 + dt.getUTCMonth()); }
      dayMonth[d] = mi;
    }
    void y; void m;
  })();
  var NMONTH = monthStart.length;

  // ── PRNG: hash → mulberry32 ──
  function hash(a, b, c) {
    var h = 0x811c9dc5 ^ (a | 0);
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b); h ^= (b | 0) * 0x27d4eb2f;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); h ^= (c | 0) * 0x165667b1;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    return (h ^ (h >>> 13)) >>> 0;
  }
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gauss(r) { var u = r() || 1e-9, v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  function ln(r, s) { return Math.exp(s * gauss(r) - s * s / 2); }         // mean-1 lognormal noise
  function cnt(r, x) { return x > 0 ? Math.floor(x + r()) : 0; }            // stochastic rounding
  function noise(a, b, c) { var r = rng(hash(a, b, c)); return ln(r, 0.08); }

  // ── Dimensions ──
  var LOCS = [
    { id: 'si-komenda', name: 'Komenda', country: 'SI', type: 'store', size: 1.0, sunday: 0, tourism: 0, lon: 14.54, lat: 46.20 },
    { id: 'si-koper', name: 'Koper', country: 'SI', type: 'store', size: 0.85, sunday: 0.45, tourism: 0.3, lon: 13.73, lat: 45.55 },
    { id: 'si-maribor', name: 'Maribor', country: 'SI', type: 'store', size: 1.1, sunday: 0.5, tourism: 0, lon: 15.65, lat: 46.55 },
    { id: 'si-novo-mesto', name: 'Novo Mesto', country: 'SI', type: 'store', size: 0.7, sunday: 0, tourism: 0, lon: 15.17, lat: 45.80 },
    { id: 'hr-zagreb', name: 'Zagreb', country: 'HR', type: 'store', size: 1.45, sunday: 0.55, tourism: 0.05, lon: 15.98, lat: 45.81 },
    { id: 'hr-split', name: 'Split', country: 'HR', type: 'store', size: 1.0, sunday: 0.5, tourism: 0.4, lon: 16.44, lat: 43.51 },
    { id: 'hr-rijeka', name: 'Rijeka', country: 'HR', type: 'store', size: 0.9, sunday: 0.4, tourism: 0.2, lon: 14.44, lat: 45.33 },
    { id: 'hr-zadar', name: 'Zadar', country: 'HR', type: 'store', size: 0.65, sunday: 0.45, tourism: 0.5, lon: 15.23, lat: 44.12 },
    { id: 'hr-osijek', name: 'Osijek', country: 'HR', type: 'store', size: 0.7, sunday: 0, tourism: 0, lon: 18.69, lat: 45.55 },
    { id: 'si-eshop', name: 'moje-lece.si', country: 'SI', type: 'eshop', size: 1.0 },
    { id: 'hr-eshop', name: 'adrialece.hr', country: 'HR', type: 'eshop', size: 0.68 }
  ];
  var CHANNELS = [{ id: 'store', name: 'Store' }, { id: 'eshop', name: 'E-shop' }, { id: 'mkt', name: 'Marketplace' }];
  // aov = average order value (EUR, ex VAT) at 2024 prices; upo = units per order
  var CATS = [
    { id: 'frames', name: 'Frames', aov: 168, upo: 1.04, margin: 0.62, newShare: 0.34, ret: { store: 0.04, eshop: 0.11, mkt: 0.13 } },
    { id: 'sunglasses', name: 'Sunglasses', aov: 118, upo: 1.06, margin: 0.55, newShare: 0.46, ret: { store: 0.045, eshop: 0.10, mkt: 0.12 } },
    { id: 'contact-lenses', name: 'Contact lenses', aov: 61, upo: 2.4, margin: 0.38, newShare: 0.22, ret: { store: 0.025, eshop: 0.05, mkt: 0.06 } },
    { id: 'solutions', name: 'Solutions', aov: 17, upo: 1.8, margin: 0.46, newShare: 0.18, ret: { store: 0.015, eshop: 0.03, mkt: 0.035 } },
    { id: 'optical-lenses', name: 'Optical lenses', aov: 205, upo: 2.0, margin: 0.68, newShare: 0.30, ret: { store: 0.05, eshop: 0.07, mkt: 0.08 } },
    { id: 'eye-exams', name: 'Eye exams', aov: 34, upo: 1.0, margin: 0.85, newShare: 0.42, ret: { store: 0.005, eshop: 0, mkt: 0 } }
  ];
  var NEW_CH = { store: 1, eshop: 1.12, mkt: 1.6 };
  // E-shop marketing sources: session share, view rate, add-to-cart rate, checkout→order close rate, sensitivity to promo traffic
  var SOURCES = [
    { id: 'google-ads', name: 'Google Ads', share: 0.30, pv: 0.66, atc: 0.135, close: 0.52, promo: 1.0, newMult: 1.15, ret: 0.9, paid: true },
    { id: 'meta', name: 'Meta', share: 0.18, pv: 0.52, atc: 0.10, close: 0.42, promo: 1.2, newMult: 1.35, ret: 0.75, paid: true },
    { id: 'organic', name: 'Organic', share: 0.28, pv: 0.64, atc: 0.13, close: 0.52, promo: 0.6, newMult: 1.1, ret: 1.0, paid: false },
    { id: 'email', name: 'Email', share: 0.09, pv: 0.72, atc: 0.17, close: 0.55, promo: 1.4, newMult: 0.25, ret: 1.35, paid: true },
    { id: 'direct', name: 'Direct', share: 0.15, pv: 0.68, atc: 0.16, close: 0.55, promo: 0.8, newMult: 0.7, ret: 1.2, paid: false }
  ];

  // Category seasonality by month (Jan..Dec), interpolated daily so there are no month steps.
  var CATSEAS = [
    [0.80, 0.88, 0.98, 0.98, 1.00, 0.95, 0.90, 0.93, 1.18, 1.05, 1.03, 1.22],
    [0.35, 0.45, 0.70, 1.00, 1.45, 2.10, 2.45, 2.05, 1.05, 0.55, 0.42, 0.72],
    [0.86, 0.92, 1.00, 1.00, 1.03, 1.08, 1.10, 1.05, 1.00, 0.98, 1.02, 1.18],
    [0.90, 0.95, 1.00, 1.00, 1.02, 1.05, 1.05, 1.03, 1.00, 0.98, 1.00, 1.10],
    [0.82, 0.90, 1.00, 1.00, 1.00, 0.92, 0.85, 0.90, 1.20, 1.08, 1.05, 1.15],
    [0.85, 0.95, 1.05, 1.05, 1.00, 0.95, 0.85, 0.90, 1.22, 1.10, 1.05, 0.90]
  ];
  var E_SEAS = [0.90, 0.92, 1.00, 1.00, 1.02, 1.07, 1.08, 1.02, 0.98, 0.98, 1.10, 1.12];
  var SUMMER = [0, 0, 0, 0, 0.3, 0.8, 1, 1, 0.3, 0, 0, 0];
  var MIX_S = [0.22, 0.14, 0.25, 0.20, 0.19];          // store, non-exam order mix
  var MIX_E = [0.08, 0.12, 0.55, 0.20, 0.05];          // e-shop order mix
  var MKT_CATS = [1, 2, 3], MIX_M = [0.25, 0.5, 0.25]; // marketplace sells sunglasses, lenses, solutions
  var BASE_STORE = 24, BASE_EXAM_BOOK = 7.5, SHOW_RATE = 0.86, BASE_SESS = 4200, BASE_MKT = 9;

  function seasonVal(arr, m, day, dmo) {
    var p = m + (day - 0.5) / dmo - 0.5, i0 = Math.floor(p), f = p - i0;
    var a = arr[(i0 + 12) % 12], b = arr[(i0 + 13) % 12];
    return a + (b - a) * f;
  }

  // ── Combos (location × category × channel) ──
  var COMBOS = [], COMBO_INDEX = LOCS.map(function () { return [[], [], []]; });
  function addCombo(li, ch, c) { COMBO_INDEX[li][ch][c] = COMBOS.length; COMBOS.push({ loc: li, ch: ch, cat: c }); }
  LOCS.forEach(function (L, li) {
    if (L.type === 'store') { for (var c = 0; c < 6; c++) addCombo(li, 0, c); }
    else { for (var c2 = 0; c2 < 5; c2++) addCombo(li, 1, c2); MKT_CATS.forEach(function (c3) { addCombo(li, 2, c3); }); }
  });
  var NC = COMBOS.length, NM = 7;
  var MEASURES = ['rev', 'cogs', 'orders', 'units', 'newOrders', 'retRev', 'retUnits'];
  var STORES = [], ESHOPS = [];
  LOCS.forEach(function (L, li) { (L.type === 'store' ? STORES : ESHOPS).push(li); });
  var NST = STORES.length, NE = ESHOPS.length, NSRC = SOURCES.length;

  // Acquisition keys for cohorts: store / e-shop / marketplace per location
  var KEYS = [];
  var COMBO_KEY = new Int16Array(NC);
  LOCS.forEach(function (L, li) {
    if (L.type === 'store') KEYS.push({ loc: li, ch: 0, type: 'store' });
    else { KEYS.push({ loc: li, ch: 1, type: 'eshop' }); KEYS.push({ loc: li, ch: 2, type: 'mkt' }); }
  });
  COMBOS.forEach(function (cb, ci) {
    for (var k = 0; k < KEYS.length; k++) if (KEYS[k].loc === cb.loc && KEYS[k].ch === cb.ch) COMBO_KEY[ci] = k;
  });

  // ── Holidays & promotions ──
  function easter(y) {
    var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25),
      g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4,
      l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
      mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1;
    return dnOf(y, mo - 1, da);
  }
  var HOL = { SI: {}, HR: {} };
  var y0 = dateOf(START).getUTCFullYear(), y1 = dateOf(TODAY).getUTCFullYear();
  for (var yy = y0; yy <= y1; yy++) {
    var common = [[0, 1], [4, 1], [10, 1], [11, 25], [11, 26], [7, 15]];
    var si = [[0, 2], [1, 8], [3, 27], [4, 2], [5, 25], [9, 31]];
    var hr = [[0, 6], [4, 30], [5, 22], [7, 5], [10, 18]];
    var em = easter(yy) + 1;
    common.concat(si).forEach(function (x) { HOL.SI[dnOf(yy, x[0], x[1])] = 1; });
    common.concat(hr).forEach(function (x) { HOL.HR[dnOf(yy, x[0], x[1])] = 1; });
    HOL.SI[em] = 1; HOL.HR[em] = 1; HOL.HR[em + 59] = 1; // Easter Monday, Corpus Christi (HR)
  }

  var PROMOS = [];
  for (var py = y0; py <= y1; py++) {
    var nov1 = dnOf(py, 10, 1), wdN = dateOf(nov1).getUTCDay();
    var thanks = nov1 + ((4 - wdN + 7) % 7) + 21, bf = thanks + 1;
    PROMOS.push({ name: 'January sale', a: dnOf(py, 0, 3), b: dnOf(py, 0, 16), boost: [1.35, 1.5, 1, 1, 1, 1], disc: 0.2, sess: 1.15, conv: 1.05, storeK: 1 });
    PROMOS.push({ name: 'Contact lens week', a: dnOf(py, 2, 16), b: dnOf(py, 2, 22), boost: [1, 1, 1.7, 1.5, 1, 1], disc: 0.15, sess: 1.3, conv: 1.1, storeK: 0.4 });
    PROMOS.push({ name: 'Summer sunglasses', a: dnOf(py, 6, 1), b: dnOf(py, 6, 12), boost: [1, 1.6, 1, 1, 1, 1], disc: 0.2, sess: 1.2, conv: 1.05, storeK: 1 });
    PROMOS.push({ name: 'Back to school', a: dnOf(py, 8, 1), b: dnOf(py, 8, 14), boost: [1.25, 1, 1, 1, 1.25, 1.3], disc: 0.1, sess: 1.05, conv: 1.03, storeK: 1 });
    PROMOS.push({ name: 'Black Friday', a: bf, b: bf + 3, boost: [1.9, 1.9, 1.9, 1.9, 1.9, 1], disc: 0.25, sess: 2.1, conv: 1.25, storeK: 0.55 });
  }
  var promoOfDay = new Int8Array(ND).fill(-1);
  PROMOS.forEach(function (p, pi) { for (var dn = p.a; dn <= p.b; dn++) { var i = dn - START; if (i >= 0 && i < ND) promoOfDay[i] = pi; } });

  // ── Incidents: a few deterministic one-off events per quarter (keyed by calendar week, so a given date
  //    never changes) that the Alerts page should be able to find on its own:
  //    outage (store sells ~20 % of normal for a day), bulk (one corporate order: one category ×3 for a day),
  //    returns (one location × category returns ×4 for 5–7 days), roas (one paid source's spend ×2.6 for 4–6 days),
  //    checkout (e-shop payment outage: orders ×0.35 for a day). ──
  var EVENTS = [], EV_DAY = {};
  (function () {
    var k0 = Math.floor((START - EPOCH) / 7), k1 = Math.floor((TODAY - EPOCH) / 7), TYPES = ['outage', 'bulk', 'returns', 'roas', 'checkout'];
    for (var k = k0; k <= k1; k++) {
      var r = rng(hash(k, 4242, 3));
      if (r() >= 0.42) continue;
      var type = TYPES[Math.floor(r() * 5)], a = EPOCH + k * 7 + Math.floor(r() * 7);
      var store = STORES[Math.floor(r() * STORES.length)], eshop = ESHOPS[Math.floor(r() * ESHOPS.length)];
      var cat = [0, 1, 2, 4][Math.floor(r() * 4)], src = Math.floor(r() * 2), dur = 4 + Math.floor(r() * 3);
      var ev = { type: type, a: a, b: a, loc: store, cat: cat, src: src, mult: 1 };
      if (type === 'outage') ev.mult = 0.2;
      else if (type === 'bulk') { ev.cat = [0, 1, 4][Math.floor(r() * 3)]; ev.mult = 3; }
      else if (type === 'returns') { ev.loc = r() < 0.5 ? store : eshop; ev.b = a + dur + 1; ev.mult = 4; }
      else if (type === 'roas') { ev.loc = eshop; ev.b = a + dur - 1; ev.mult = 2.6; }
      else { ev.loc = eshop; ev.mult = 0.35; }
      EVENTS.push(ev);
      for (var dn = ev.a; dn <= ev.b; dn++) (EV_DAY[dn - START] = EV_DAY[dn - START] || []).push(ev);
    }
  })();
  function evOf(d, li, type) { var l = EV_DAY[d]; if (!l) return null; for (var i = 0; i < l.length; i++) if (l[i].loc === li && l[i].type === type) return l[i]; return null; }

  // ── Storage ──
  var S = new Float64Array(ND * NC * NM);
  var OPS = new Float64Array(ND * NST * 3);
  var FUN = new Float64Array(ND * NE * NSRC * 6);

  function r2(v) { return Math.round(v * 100) / 100; }
  function writeSales(d, ci, orders, c, chKey, priceF, disc, r, retMult) {
    if (!(orders > 0)) return;
    var C = CATS[c];
    var units = Math.max(orders, Math.round(orders * C.upo * ln(r, 0.08)));
    var list = orders * C.aov * priceF * ln(r, 0.06) * (chKey === 'mkt' ? 0.93 : 1);
    var rev = list * (1 - disc);
    var cogs = list * (1 - C.margin) * ln(r, 0.02);
    var rr = Math.min(0.6, C.ret[chKey] * ln(r, 0.35) * (retMult || 1));
    var retUnits = Math.min(units, cnt(r, units * rr));
    var retRev = retUnits ? Math.min(rev, retUnits * (rev / units) * ln(r, 0.1)) : 0;
    var newO = Math.min(orders, cnt(r, orders * C.newShare * NEW_CH[chKey] * ln(r, 0.12)));
    var b = (d * NC + ci) * NM;
    S[b] = r2(rev); S[b + 1] = r2(cogs); S[b + 2] = orders; S[b + 3] = units; S[b + 4] = newO; S[b + 5] = r2(retRev); S[b + 6] = retUnits;
  }
  // Split an integer total over weights (largest remainder) so the parts always add up.
  function split(total, w) {
    var sw = 0, i, out = [], rem = [];
    for (i = 0; i < w.length; i++) sw += w[i];
    var used = 0;
    for (i = 0; i < w.length; i++) { var e = sw ? total * w[i] / sw : 0; out[i] = Math.floor(e); rem[i] = [e - out[i], i]; used += out[i]; }
    rem.sort(function (a, b) { return b[0] - a[0] || a[1] - b[1]; });
    for (i = 0; i < total - used; i++) out[rem[i % rem.length][1]]++;
    return out;
  }

  for (var d = 0; d < ND; d++) {
    var dn = START + d, dt = dateOf(dn), Y = dt.getUTCFullYear(), M = dt.getUTCMonth(), D = dt.getUTCDate(), wd = dt.getUTCDay();
    var dmo = dim(Y, M), yrs = (dn - EPOCH) / 365.25;
    var pi = promoOfDay[d], P = pi >= 0 ? PROMOS[pi] : null;
    var priceF = Math.exp(0.025 * yrs);
    var seas = CATSEAS.map(function (arr) { return seasonVal(arr, M, D, dmo); });
    var summer = seasonVal(SUMMER, M, D, dmo);
    var xmasS = (M === 11 && D >= 15 && D <= 23) ? 1.25 : (M === 11 && D === 24) ? 0.6 : (M === 11 && D >= 27) ? 0.9 : 1;
    var xmasE = (M === 11 && D <= 18) ? 1.1 : (M === 11) ? 0.8 : 1;

    // Stores
    for (var si2 = 0; si2 < NST; si2++) {
      var li = STORES[si2], L = LOCS[li], r = rng(hash(dn, li, 11));
      var closed = HOL[L.country][dn] || (M === 11 && D === 31 && false);
      var openF = closed ? 0 : (wd === 0 ? L.sunday : 1);
      if (!openF) continue;
      var wdF = [1, 0.92, 0.95, 1, 1.05, 1.2, 1.32][wd] * (wd === 0 ? openF : 1);
      var g = Math.exp(0.07 * yrs), dayN = ln(r, 0.10), nonExam = 0, disc = 0;
      var evO = evOf(d, li, 'outage'), evB = evOf(d, li, 'bulk'), evR = evOf(d, li, 'returns'), outM = evO ? evO.mult : 1;
      for (var c = 0; c < 5; c++) {
        var boost = P ? 1 + (P.boost[c] - 1) * P.storeK : 1;
        disc = P && P.boost[c] > 1 ? P.disc : 0;
        var tour = c === 1 ? 1 + L.tourism * summer : 1;
        var e = BASE_STORE * L.size * MIX_S[c] * seas[c] * wdF * g * dayN * xmasS * boost * tour * ln(r, 0.18) * outM * (evB && evB.cat === c ? evB.mult : 1);
        var o = cnt(r, e);
        nonExam += o;
        writeSales(d, COMBO_INDEX[li][0][c], o, c, 'store', priceF, disc, r, evR && evR.cat === c ? evR.mult : 1);
      }
      var exBoost = P ? 1 + (P.boost[5] - 1) * P.storeK : 1;
      var wdX = [1, 1, 1, 1.02, 1.05, 1.05, 1.1][wd] * (wd === 0 ? openF : 1);
      var book = cnt(r, BASE_EXAM_BOOK * L.size * seas[5] * wdX * g * dayN * exBoost * (M === 11 && D >= 20 ? 0.6 : 1) * ln(r, 0.15));
      var exams = Math.min(book, cnt(r, book * SHOW_RATE * ln(r, 0.05)));
      writeSales(d, COMBO_INDEX[li][0][5], exams, 5, 'store', priceF, P && P.boost[5] > 1 ? P.disc : 0, r);
      var conv = 0.215 * ln(r, 0.07) * (P ? 1.06 : 1);
      var traffic = cnt(r, nonExam / outM / conv + exams);
      var ob = (d * NST + si2) * 3;
      OPS[ob] = traffic; OPS[ob + 1] = book; OPS[ob + 2] = exams;
    }

    // E-shops + marketplace
    for (var ei = 0; ei < NE; ei++) {
      var lj = ESHOPS[ei], LE = LOCS[lj], re = rng(hash(dn, lj, 23));
      var gE = Math.exp(0.18 * yrs), wdE = [0.97, 1.14, 1.1, 1.05, 1, 0.92, 0.83][wd];
      var hol = HOL[LE.country][dn] ? 0.75 : 1, es = seasonVal(E_SEAS, M, D, dmo), dayE = ln(re, 0.08);
      var totO = 0, evS = evOf(d, lj, 'roas'), evC = evOf(d, lj, 'checkout'), evRe = evOf(d, lj, 'returns');
      for (var s = 0; s < NSRC; s++) {
        var SR = SOURCES[s];
        var sb = P ? Math.pow(P.sess, SR.promo) : 1;
        var emailDay = s === 3 ? ((wd === 2 || wd === 4) ? 1.6 : 0.75) : 1;
        var sess = cnt(re, BASE_SESS * LE.size * SR.share * wdE * es * gE * hol * dayE * xmasE * sb * emailDay * ln(re, 0.1));
        var views = cnt(re, sess * SR.pv * ln(re, 0.03));
        var atc = cnt(re, views * SR.atc * ln(re, 0.06) * (P ? P.conv : 1));
        var chk = Math.min(atc, cnt(re, atc * 0.56 * ln(re, 0.05)));
        var ord = Math.min(chk, cnt(re, chk * SR.close * ln(re, 0.06) * (evC ? evC.mult : 1) * (evS && evS.src === s ? 0.8 : 1)));
        var spend = s === 0 ? sess * 0.42 * ln(re, 0.08) : s === 1 ? sess * 0.29 * ln(re, 0.1) : s === 3 ? LE.size * ((wd === 2 || wd === 4) ? 240 : 55) * ln(re, 0.1) : 0;
        if (evS && evS.src === s) spend *= evS.mult;
        var fb = ((d * NE + ei) * NSRC + s) * 6;
        FUN[fb] = sess; FUN[fb + 1] = views; FUN[fb + 2] = atc; FUN[fb + 3] = chk; FUN[fb + 4] = ord; FUN[fb + 5] = r2(spend);
        totO += ord;
      }
      var wE = [], c4;
      for (c4 = 0; c4 < 5; c4++) wE.push(MIX_E[c4] * seas[c4] * (P ? P.boost[c4] : 1) * ln(re, 0.1));
      var parts = split(totO, wE);
      for (c4 = 0; c4 < 5; c4++) writeSales(d, COMBO_INDEX[lj][1][c4], parts[c4], c4, 'eshop', priceF, P && P.boost[c4] > 1 ? P.disc : 0, re, evRe && evRe.cat === c4 ? evRe.mult : 1);
      var totM = cnt(re, BASE_MKT * LE.size * Math.exp(0.35 * yrs) * wdE * es * ln(re, 0.15));
      var wM = MKT_CATS.map(function (cc, k) { return MIX_M[k] * seas[cc] * ln(re, 0.1); });
      var partsM = split(totM, wM);
      MKT_CATS.forEach(function (cc, k) { writeSales(d, COMBO_INDEX[lj][2][cc], partsM[k], cc, 'mkt', priceF, 0, re); });
    }
  }

  // ── Cohort sizes: new customers per acquisition key per month ──
  var NK = KEYS.length;
  var COH_NEW = new Float64Array(NK * NMONTH);
  for (var d2 = 0; d2 < ND; d2++) {
    var mi2 = dayMonth[d2];
    for (var ci = 0; ci < NC; ci++) COH_NEW[COMBO_KEY[ci] * NMONTH + mi2] += S[(d2 * NC + ci) * NM + 4];
  }
  // Share of a cohort that buys again in month k after acquisition (k = 1…11; k = 0 is 100 %).
  function retention(type, k) {
    if (k === 0) return 1;
    if (type === 'store') return 0.055 + 0.075 * Math.exp(-k / 3) + (k === 11 ? 0.05 : k === 10 ? 0.02 : 0);
    if (type === 'eshop') return 0.10 + 0.15 * Math.exp(-k / 4) + (k % 3 === 0 ? 0.035 : 0);
    return 0.03 + 0.06 * Math.exp(-k / 2);
  }

  // ── Products (fictional brands): [name, weight, trend per year, price vs category, margin, return factor] ──
  var PRODUCT_DEFS = [
    [0, 'Lumen Acetate 52', 1.3, 0.10, 1.0, 0.63, 1.0], [0, 'Nordvik Titanium Round', 0.9, 0.25, 1.45, 0.60, 0.8],
    [0, 'Arca Classic Square', 1.2, -0.10, 0.85, 0.64, 1.0], [0, 'Vela Kids Flex', 0.8, 0.05, 0.65, 0.58, 1.3],
    [0, 'Mira Cat-eye', 0.7, 0.30, 1.1, 0.62, 1.1], [0, 'Brera Rimless', 0.5, -0.05, 1.6, 0.59, 0.9],
    [0, 'Kaya Bold Acetate', 0.6, 0.15, 1.2, 0.65, 1.1],
    [1, 'Riva Polarized Aviator', 1.3, 0.05, 1.25, 0.55, 0.9], [1, 'Costa Blu Wayfarer', 1.2, 0.10, 1.0, 0.56, 1.0],
    [1, 'Sol Sport Wrap', 0.7, 0.20, 1.15, 0.52, 1.2], [1, 'Lido Round Gradient', 0.8, 0.0, 0.9, 0.57, 1.0],
    [1, 'Isola Oversized', 0.6, 0.25, 1.05, 0.58, 1.3], [1, 'Mare Kids UV400', 0.5, 0.05, 0.45, 0.50, 0.8],
    [2, 'AquaDay 1-Day 30 pk', 1.6, 0.05, 0.75, 0.36, 0.8], [2, 'AquaDay 1-Day 90 pk', 1.1, 0.18, 1.9, 0.34, 0.7],
    [2, 'ClearMonth Monthly 6 pk', 1.3, -0.08, 1.0, 0.42, 1.0], [2, 'ClearMonth Toric 6 pk', 0.6, 0.06, 1.35, 0.40, 1.5],
    [2, 'FlexWeek Bi-weekly 6 pk', 0.5, -0.15, 0.8, 0.41, 1.0], [2, 'Iris Colour 1-Day 10 pk', 0.3, 0.20, 0.6, 0.45, 1.8],
    [2, 'MultiFocal Monthly 3 pk', 0.4, 0.22, 1.5, 0.38, 1.6],
    [3, 'PureCare All-in-one 360 ml', 1.6, 0.0, 1.0, 0.46, 0.8], [3, 'PureCare Travel 100 ml', 0.6, 0.05, 0.55, 0.50, 0.9],
    [3, 'OxyClean Peroxide 300 ml', 0.7, 0.08, 1.25, 0.44, 1.2], [3, 'HydraDrops Eye drops 10 ml', 0.9, 0.15, 0.75, 0.52, 1.0],
    [3, 'SalineSoft 360 ml', 0.4, -0.10, 0.7, 0.40, 1.0],
    [4, 'Single vision 1.5 AR', 1.2, -0.10, 0.55, 0.70, 0.8], [4, 'Single vision 1.6 Blue filter', 1.1, 0.15, 0.8, 0.69, 0.9],
    [4, 'Progressive Comfort', 0.8, 0.05, 1.7, 0.66, 1.5], [4, 'Progressive Premium', 0.5, 0.15, 2.6, 0.67, 1.6],
    [4, 'Photochromic 1.6', 0.5, 0.10, 1.3, 0.68, 1.1], [4, 'Digital office lens', 0.4, 0.20, 1.1, 0.70, 1.0],
    [5, 'Standard eye exam', 1.5, 0.0, 1.0, 0.86, 1], [5, 'Contact lens fitting', 0.7, 0.08, 1.3, 0.84, 1],
    [5, 'Kids eye exam', 0.5, 0.05, 0.8, 0.85, 1], [5, 'Driving licence check', 0.4, -0.05, 0.9, 0.88, 1]
  ];
  var PREFIX = ['FR', 'SG', 'CL', 'SO', 'OL', 'EX'];
  var PRODUCTS = PRODUCT_DEFS.map(function (p, i) {
    return { idx: i, sku: PREFIX[p[0]] + '-' + (1001 + i), cat: p[0], name: p[1], w: p[2], trend: p[3], price: p[4], margin: p[5], ret: p[6] };
  });
  var NP = PRODUCTS.length;
  var SHARE = new Float64Array(NMONTH * NP);
  for (var mi = 0; mi < NMONTH; mi++) {
    var yrsM = (monthStart[mi] - EPOCH) / 365.25 - 1.5, sums = [0, 0, 0, 0, 0, 0];
    PRODUCTS.forEach(function (p) { var v = p.w * Math.exp(p.trend * yrsM) * noise(mi, p.idx, 7); SHARE[mi * NP + p.idx] = v; sums[p.cat] += v; });
    PRODUCTS.forEach(function (p) { SHARE[mi * NP + p.idx] /= sums[p.cat]; });
  }

  var t1 = (root.performance && performance.now) ? performance.now() : Date.now();
  root.AA = {
    START: START, TODAY: TODAY, ND: ND, NMONTH: NMONTH, monthStart: monthStart, monthLabel: monthLabel, dayMonth: dayMonth,
    LOCS: LOCS, CATS: CATS, CHANNELS: CHANNELS, SOURCES: SOURCES, COMBOS: COMBOS, COMBO_INDEX: COMBO_INDEX, COMBO_KEY: COMBO_KEY,
    STORES: STORES, ESHOPS: ESHOPS, KEYS: KEYS, NC: NC, NM: NM, MEASURES: MEASURES, NSRC: NSRC,
    S: S, OPS: OPS, FUN: FUN, COH_NEW: COH_NEW, retention: retention, noise: noise,
    PRODUCTS: PRODUCTS, NP: NP, SHARE: SHARE, PROMOS: PROMOS, promoOfDay: promoOfDay, SHOW_RATE: SHOW_RATE,
    iso: iso, dnOf: dnOf, dateOf: dateOf, daysInMonth: dim, genMs: t1 - t0, EVENTS: EVENTS,
    isHoliday: function (country, dn) { return !!(HOL[country] && HOL[country][dn]); }
  };
})(window);
