/* Analytics demo data: deterministic by calendar date. Builds window.AA (typed arrays + dimensions). */
(function () {
  'use strict';
  var t0 = performance.now(), now = new Date();
  var START = new Date(now.getFullYear() - 2, now.getMonth(), 1);                 // first day of the month 24 months ago
  function dnOf(y, m, d) { return Math.floor(Date.UTC(y, m, d) / 864e5); }
  var DN0 = dnOf(START.getFullYear(), START.getMonth(), 1), DNEND = dnOf(now.getFullYear(), now.getMonth(), now.getDate()), ND = DNEND - DN0 + 1, EPOCH = dnOf(2024, 0, 1);
  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function hash(a, b, c) { var h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1274126177)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return h >>> 0; }
  var rng = function (seed) { return mulberry32(seed); };
  function p2(n) { return (n < 10 ? '0' : '') + n; }

  var LOCS = [
    { id: 'si-lj', name: 'Ljubljana Center', country: 'SI', type: 'store', size: 1.6 }, { id: 'si-mb', name: 'Maribor', country: 'SI', type: 'store', size: 1.15 },
    { id: 'si-ce', name: 'Celje', country: 'SI', type: 'store', size: 0.8 }, { id: 'si-kr', name: 'Kranj', country: 'SI', type: 'store', size: 0.75 },
    { id: 'si-kp', name: 'Koper', country: 'SI', type: 'store', size: 0.7 }, { id: 'si-nm', name: 'Novo mesto', country: 'SI', type: 'store', size: 0.65 },
    { id: 'hr-zg', name: 'Zagreb Centar', country: 'HR', type: 'store', size: 1.3 }, { id: 'hr-st', name: 'Split', country: 'HR', type: 'store', size: 0.9 },
    { id: 'hr-ri', name: 'Rijeka', country: 'HR', type: 'store', size: 0.7 },
    { id: 'si-eshop', name: 'E-shop SI', country: 'SI', type: 'eshop', size: 1.0 }, { id: 'hr-eshop', name: 'E-shop HR', country: 'HR', type: 'eshop', size: 0.55 }
  ];
  var CHANNELS = [{ id: 'store', name: 'Stores' }, { id: 'eshop', name: 'E-shop' }, { id: 'marketplace', name: 'Marketplace' }];
  var CATS = [{ id: 'frames', name: 'Frames' }, { id: 'sunglasses', name: 'Sunglasses' }, { id: 'contacts', name: 'Contact lenses' }, { id: 'lenses', name: 'Optical lenses' }, { id: 'solutions', name: 'Solutions' }, { id: 'accessories', name: 'Accessories' }];
  var SOURCES = [{ id: 'organic', name: 'Organic search' }, { id: 'paid', name: 'Paid search' }, { id: 'social', name: 'Social' }, { id: 'email', name: 'E-mail' }, { id: 'direct', name: 'Direct' }];
  var MEASURES = ['rev', 'cogs', 'orders', 'units', 'newOrders', 'retRev', 'retUnits'], NMS = 7;
  var CATMIX = [0.34, 0.2, 0.16, 0.2, 0.04, 0.06], CATSEAS = [[1, 1, 1.05, 1.05, 1, 0.95, 0.9, 0.95, 1.25, 1.1, 1.05, 1.1], [0.5, 0.55, 0.8, 1.1, 1.7, 1.9, 1.8, 1.5, 0.8, 0.6, 0.5, 0.7], [1, 1, 1, 1, 1, 1, 0.95, 0.95, 1.05, 1.05, 1.05, 1], [1, 0.95, 1, 1, 0.95, 0.9, 0.85, 0.95, 1.3, 1.25, 1.1, 1], [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.05], [0.9, 0.9, 0.95, 1, 1, 1, 1, 1, 1, 1, 1.25, 1.9]];
  var AOV = [180, 140, 60, 220, 14, 18], UPO = [1.1, 1.05, 2.2, 1.0, 1.4, 1.6], MARGIN = [0.62, 0.58, 0.38, 0.66, 0.45, 0.55], RETR = [0.09, 0.08, 0.03, 0.04, 0.02, 0.03];
  var CHAOV = [1, 0.85, 0.8], CHMAR = [0, -0.04, -0.12], CHRET = [0.01, 1, 1.3], CHNEW = [0.3, 0.45, 0.6];
  var WD_STORE = [1, 1.05, 1.05, 1.1, 1.25, 1.35, 0.05], WD_ESHOP = [1.1, 1.05, 1, 1, 0.95, 0.85, 1.0];
  var BASE_STORE = 2600, BASE_ESHOP = 2300, BASE_EXAM_BOOK = 7;
  var SRC_W = [0.3, 0.26, 0.1, 0.12, 0.22], SRC_CR = [0.021, 0.016, 0.009, 0.042, 0.034], SRC_CPC = [0, 0.5, 0.3, 0.02, 0];
  var PROMOS = [{ id: 'spring', name: 'Spring sale', lift: 1.25 }, { id: 'sun', name: 'Sunglasses season', lift: 1.2, cat: 1 }, { id: 'school', name: 'Back to school', lift: 1.2 }, { id: 'bf', name: 'Black Friday', lift: 1.7, eshop: 2.1 }, { id: 'xmas', name: 'Christmas', lift: 1.3 }];

  // calendar
  var DATE_ISO = new Array(ND), WD = new Uint8Array(ND), MIX = new Uint8Array(ND), DOM = new Uint8Array(ND), MONTHS = [];
  for (var d = 0; d < ND; d++) {
    var dt = new Date((DN0 + d) * 864e5), y = dt.getUTCFullYear(), m = dt.getUTCMonth(), dd = dt.getUTCDate();
    DATE_ISO[d] = y + '-' + p2(m + 1) + '-' + p2(dd); WD[d] = (dt.getUTCDay() + 6) % 7; DOM[d] = dd;
    var mi = (y - START.getFullYear()) * 12 + (m - START.getMonth()); MIX[d] = mi;
    if (!MONTHS[mi]) MONTHS[mi] = { key: y + '-' + p2(m + 1), y: y, m: m, a: d, b: d, days: 0, label: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m] + ' ' + y };
    MONTHS[mi].b = d; MONTHS[mi].days++;
  }
  var NM = MONTHS.length;
  function easter(y) { var a = y % 19, b = Math.floor(y / 100), c = y % 100, dd = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - dd - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, mm = Math.floor((a + 11 * h + 22 * l) / 451), mo = Math.floor((h + l - 7 * mm + 114) / 31), da = (h + l - 7 * mm + 114) % 31 + 1; return dnOf(y, mo - 1, da); }
  var HOL = { SI: {}, HR: {} };
  for (var yy = START.getFullYear(); yy <= now.getFullYear(); yy++) {
    ['01-01', '01-02', '02-08', '04-27', '05-01', '05-02', '06-25', '08-15', '10-31', '11-01', '12-25', '12-26'].forEach(function (s) { HOL.SI[dnOf(yy, +s.slice(0, 2) - 1, +s.slice(3))] = 1; });
    ['01-01', '01-06', '05-01', '05-30', '06-22', '08-05', '08-15', '10-08', '11-01', '12-25', '12-26'].forEach(function (s) { HOL.HR[dnOf(yy, +s.slice(0, 2) - 1, +s.slice(3))] = 1; });
    var e = easter(yy); HOL.SI[e] = HOL.SI[e + 1] = HOL.HR[e] = HOL.HR[e + 1] = 1;
  }
  function promo(dn, cat, eshop) {
    var dt = new Date(dn * 864e5), m = dt.getUTCMonth(), dd = dt.getUTCDate(), f = 1;
    if (m === 2 && dd >= 10 && dd <= 17) f = 1.25; else if (m === 5 && dd <= 14 && cat === 1) f = 1.2; else if (m === 8 && dd <= 10) f = 1.2; else if (m === 11 && dd >= 10 && dd <= 23) f = 1.3;
    else if (m === 10 && dd >= 24 && dd <= 30) f = eshop ? 2.1 : 1.7; return f;
  }

  // dimensions
  var COMBOS = [], STORES = [], ESHOPS = [];
  LOCS.forEach(function (l, li) { if (l.type === 'store') STORES.push(li); else ESHOPS.push(li); });
  LOCS.forEach(function (l, li) {
    if (l.type === 'store') CATS.forEach(function (c, ci) { COMBOS.push({ li: li, ch: 0, cat: ci }); });
    else { CATS.forEach(function (c, ci) { COMBOS.push({ li: li, ch: 1, cat: ci }); }); [0, 1].forEach(function (ci) { COMBOS.push({ li: li, ch: 2, cat: ci }); }); }
  });
  var NC = COMBOS.length, byLoc = LOCS.map(function () { return []; }); COMBOS.forEach(function (c, i) { byLoc[c.li].push(i); });

  // events (hash of week + key)
  var EVENTS = [], KINDS = ['outage', 'bulk', 'returns', 'roas', 'checkout'];
  for (var k = Math.floor(DN0 / 7); k <= Math.floor(DNEND / 7); k++) {
    var r = rng(hash(k, 4242, 3)); if (r() > 0.5) continue; var kind = KINDS[Math.floor(r() * 5)], ev = { kind: kind, d0: k * 7 + Math.floor(r() * 6) - DN0, len: 1, li: 0, cat: Math.floor(r() * 4) };
    if (kind === 'outage' || kind === 'bulk') { ev.li = STORES[Math.floor(r() * STORES.length)]; ev.len = kind === 'outage' ? 1 + Math.floor(r() * 2) : 1; }
    else { ev.li = ESHOPS[Math.floor(r() * 2)]; ev.len = kind === 'checkout' ? 3 + Math.floor(r() * 3) : 5 + Math.floor(r() * 3); }
    if (ev.d0 < 14 || ev.d0 + ev.len > ND) continue; if (kind === 'outage' && WD[ev.d0] === 6) ev.d0++; EVENTS.push(ev);
  }
  function evFor(d, li, kind) { for (var i = 0; i < EVENTS.length; i++) { var e = EVENTS[i]; if (e.li === li && e.kind === kind && d >= e.d0 && d < e.d0 + e.len) return e; } return null; }

  // measures
  var S = new Float32Array(ND * NC * NMS), OPS = new Float32Array(ND * 9 * 3), FUN = new Float32Array(ND * 2 * 5 * 6);
  for (var d2 = 0; d2 < ND; d2++) {
    var dn = DN0 + d2, wd = WD[d2], mo = MONTHS[MIX[d2]].m, growth = 1 + 0.12 * (dn - EPOCH) / 365;
    LOCS.forEach(function (L, li) {
      var rr = rng(hash(dn, li, L.type === 'store' ? 11 : 23)), dayN = 0.88 + 0.24 * rr(), isStore = L.type === 'store', hol = HOL[L.country][dn] ? 1 : 0, wf = isStore ? (hol ? 0.04 : WD_STORE[wd]) : WD_ESHOP[wd] * (hol ? 1.05 : 1);
      var out = ev('outage'), eorders = 0, erev = 0;
      function ev(kind) { return evFor(d2, li, kind); }
      byLoc[li].forEach(function (ci) {
        var C = COMBOS[ci], cat = C.cat, base = (isStore ? BASE_STORE : BASE_ESHOP) * L.size * (C.ch === 2 ? 0.14 : 1) * CATMIX[cat] * CATSEAS[cat][mo] * wf * promo(dn, cat, !isStore) * growth * dayN * (0.85 + 0.3 * rr());
        var bulk = ev('bulk'); if (bulk && bulk.cat === cat) base *= 3.4; if (out) base *= 0.03; var chk = ev('checkout'); if (chk && C.ch === 1) base *= 0.5;
        var aov = AOV[cat] * CHAOV[C.ch] * (0.92 + 0.16 * rr()), mar = Math.max(0.15, MARGIN[cat] + CHMAR[C.ch] + (rr() - 0.5) * 0.03), orders = base > 0 ? Math.max(1, Math.round(base / aov)) : 0, rev = orders * aov, o = (d2 * NC + ci) * NMS;
        var rrate = RETR[cat] * (C.ch === 0 ? CHRET[0] : CHRET[C.ch] * (C.ch === 1 ? 1 : 1.3)) * (0.7 + 0.6 * rr()), rt = ev('returns'); if (rt && rt.cat === cat && C.ch === 1) rrate *= 4.5;
        S[o] = rev; S[o + 1] = rev * (1 - mar); S[o + 2] = orders; S[o + 3] = Math.round(orders * UPO[cat]); S[o + 4] = Math.round(orders * CHNEW[C.ch] * (0.9 + 0.2 * rr())); S[o + 5] = rev * rrate; S[o + 6] = Math.round(orders * UPO[cat] * rrate);
        if (C.ch === 1) { eorders += orders; erev += rev; }
        if (isStore) { var so = S[o + 2]; OPS[(d2 * 9 + li) * 3] += so; }
      });
      if (isStore) {
        var oi = (d2 * 9 + li) * 3, ord = OPS[oi], tr = ord / (0.24 * (0.9 + 0.2 * rr())), bk = Math.round(BASE_EXAM_BOOK * L.size * (hol || wd === 6 ? 0.05 : WD_STORE[wd]) * growth * dayN * (0.8 + 0.4 * rr()));
        if (out) { tr *= 0.5; bk = 0; } OPS[oi] = Math.round(tr); OPS[oi + 1] = bk; OPS[oi + 2] = Math.round(bk * (0.8 + 0.15 * rr()));
      } else {
        var ei = li - 9, chkE = ev('checkout'), unaff = chkE ? eorders * 2 : eorders;
        for (var s = 0; s < 5; s++) {
          var fo = (((d2 * 2 + ei) * 5) + s) * 6, ordS = unaff * SRC_W[s] * (0.9 + 0.2 * rr()), sess = ordS / SRC_CR[s], chk2 = ordS / (0.55 + 0.08 * rr()), atc = chk2 / (0.42 + 0.06 * rr());
          var sp = sess * SRC_CPC[s] * (0.85 + 0.3 * rr()), re = ev('roas'); if (re && s === 1) sp *= 4.5;
          FUN[fo] = Math.round(sess); FUN[fo + 1] = Math.round(sess * (0.52 + 0.1 * rr())); FUN[fo + 2] = Math.round(atc); FUN[fo + 3] = Math.round(chk2); FUN[fo + 4] = Math.round(chkE ? ordS / 2 : ordS); FUN[fo + 5] = sp;
        }
      }
    });
  }
  // new customers per location and month (acquisition key = location)
  var COH_NEW = new Float32Array(LOCS.length * NM);
  for (var d3 = 0; d3 < ND; d3++) for (var ci2 = 0; ci2 < NC; ci2++) COH_NEW[COMBOS[ci2].li * NM + MIX[d3]] += S[(d3 * NC + ci2) * NMS + 4];
  // products
  var PNAMES = [['Aviator Slim', 'Round Metal', 'Cat-Eye Acetate', 'Rectangle Titan', 'Browline Classic', 'Rimless Air'], ['Wayfarer Polar', 'Sport Wrap', 'Oversize Sun', 'Mirror Pilot', 'Kids Sun', 'Clip-on'], ['Daily Soft 30', 'Daily Soft 90', 'Monthly Hydro', 'Toric Daily', 'Multifocal Monthly', 'Colour Fresh'], ['Single Vision 1.5', 'Single Vision 1.6', 'Progressive Std', 'Progressive Premium', 'Blue-light Filter', 'Photochromic'], ['Multi-purpose 360 ml', 'Travel 60 ml', 'Peroxide Care', 'Hydrate Drops', 'Cleaning Spray', 'Wipes 50'], ['Hard Case', 'Microfibre Cloth', 'Chain Strap', 'Repair Kit', 'Soft Pouch', 'Lens Pen']];
  var PRODUCTS = [], SHARE = new Float32Array(36 * NM);
  PNAMES.forEach(function (list, ci) { list.forEach(function (n, j) { var rp = rng(hash(ci, j, 77)); PRODUCTS.push({ id: 'p' + (ci * 6 + j), name: n, cat: ci, price: Math.round(AOV[ci] * (0.6 + 0.9 * rp())), margin: Math.min(0.85, MARGIN[ci] + (rp() - 0.5) * 0.16), w: 1 / (j + 0.6) * (0.8 + 0.4 * rp()) }); }); });
  CATS.forEach(function (c, ci) {
    var walk = [0, 0, 0, 0, 0, 0];
    for (var m2 = 0; m2 < NM; m2++) {
      var ws = [], tot = 0; for (var j = 0; j < 6; j++) { var rw = rng(hash(ci * 6 + j, m2, 5)); walk[j] = clampN(walk[j] * 0.8 + (rw() - 0.5) * 0.25, -0.5, 0.5); ws[j] = PRODUCTS[ci * 6 + j].w * Math.exp(walk[j]); tot += ws[j]; }
      for (var j2 = 0; j2 < 6; j2++) SHARE[(ci * 6 + j2) * NM + m2] = ws[j2] / tot;
    }
  });
  function clampN(v, a, b) { return Math.max(a, Math.min(b, v)); }

  window.AA = { genMs: Math.round(performance.now() - t0), START: START, DN0: DN0, ND: ND, NM: NM, NC: NC, NMS: NMS, EPOCH: EPOCH, LOCS: LOCS, STORES: STORES, ESHOPS: ESHOPS, CHANNELS: CHANNELS, CATS: CATS, SOURCES: SOURCES, MEASURES: MEASURES, COMBOS: COMBOS, BYLOC: byLoc, S: S, OPS: OPS, FUN: FUN, COH_NEW: COH_NEW, SHARE: SHARE, PRODUCTS: PRODUCTS, MONTHS: MONTHS, DATE_ISO: DATE_ISO, WD: WD, MIX: MIX, DOM: DOM, PROMOS: PROMOS, EVENTS: EVENTS, HOL: HOL, dnOf: dnOf, hash: hash, rng: rng };
})();
