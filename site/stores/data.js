/* Store daily board demo: deterministic, entirely fictional data for ten optics stores.
 * Every value is generated from a seeded random generator keyed by (store, date, purpose), so a given
 * day always looks the same, whichever day "today" is. Nothing here is real: store staff, customers,
 * reviewers, phone numbers (000 blocks) and order numbers are invented.
 *
 * window.StoresData exposes:
 *   STORES, staff(storeId), hours(storeId, date), plan(storeId, date), attendance(storeId, date),
 *   day(storeId, date)           → sales, mix, exams, cash for one store-day (null-safe: {open:false})
 *   workOrders(storeId, upTo)    → glasses jobs with lab / ready / pickup dates
 *   complaints(storeId, upTo), reviews(storeId, upTo), monthTarget(storeId, 'YYYY-MM'),
 *   initialState(today)          → the editable part (tasks etc.) that the app keeps in IndexedDB
 *   util                         → date helpers */
(function () {
  'use strict';

  var VERSION = 1;

  // ── date helpers (local calendar dates as YYYY-MM-DD) ─────────────────────
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parse(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2], 12); }
  function addDays(s, n) { var d = parse(s); d.setDate(d.getDate() + n); return ymd(d); }
  function diffDays(a, b) { return Math.round((parse(b) - parse(a)) / 864e5); }
  function dow(s) { return parse(s).getDay(); }
  function monthDays(ym) { var p = ym.split('-'); return new Date(+p[0], +p[1], 0).getDate(); }
  function doy(s) { var d = parse(s); return Math.round((d - new Date(d.getFullYear(), 0, 1, 12)) / 864e5); }
  function weekNo(s) { return Math.floor((diffDays('2024-01-01', s)) / 7); } // 2024-01-01 is a Monday
  function r2(n) { return Math.round(n * 100) / 100; }

  // ── seeded randomness ─────────────────────────────────────────────────────
  function hash(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
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
  function tools(key) {
    var R = rng(hash(key));
    var T = {
      R: R,
      int: function (a, b) { return a + Math.floor(R() * (b - a + 1)); },
      pick: function (a) { return a[Math.floor(R() * a.length)]; },
      chance: function (p) { return R() < p; },
      normal: function () { var u = 1 - R(), v = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); },
      binom: function (n, p) { var k = 0; for (var i = 0; i < n; i++) if (R() < p) k++; return k; },
      weighted: function (items) { var tot = 0, i; for (i = 0; i < items.length; i++) tot += items[i][1]; var x = R() * tot; for (i = 0; i < items.length; i++) { x -= items[i][1]; if (x <= 0) return items[i][0]; } return items[items.length - 1][0]; }
    };
    return T;
  }

  // ── stores ────────────────────────────────────────────────────────────────
  var MALL = [null, [540, 1260], [540, 1260], [540, 1260], [540, 1260], [540, 1260], [540, 1260]];      // Mon–Sat 9–21
  var CITY = [null, [480, 1140], [480, 1140], [480, 1140], [480, 1140], [480, 1140], [480, 780]];       // Mon–Fri 8–19, Sat 8–13
  var COAST = [null, [480, 1200], [480, 1200], [480, 1200], [480, 1200], [480, 1200], [480, 840]];      // Mon–Fri 8–20, Sat 8–14
  var STORES = [
    { id: 'LJ-BTC', code: 'BTC', name: 'Ljubljana BTC', city: 'Ljubljana', country: 'SI', kind: 'Shopping centre', size: 1.35, coast: 0, growth: 0.09, conv: 0.66, quality: 0.86, hours: MALL, staffN: 8, baseReviews: [612, 4.6] },
    { id: 'LJ-CEN', code: 'LJC', name: 'Ljubljana Center', city: 'Ljubljana', country: 'SI', kind: 'City centre', size: 1.1, coast: 0, growth: 0.05, conv: 0.69, quality: 0.9, hours: CITY, staffN: 6, baseReviews: [438, 4.7] },
    { id: 'MB-EUR', code: 'MBE', name: 'Maribor Europark', city: 'Maribor', country: 'SI', kind: 'Shopping centre', size: 1.15, coast: 0, growth: 0.03, conv: 0.61, quality: 0.8, hours: MALL, staffN: 7, baseReviews: [389, 4.5] },
    { id: 'CE', code: 'CEL', name: 'Celje', city: 'Celje', country: 'SI', kind: 'City centre', size: 0.85, coast: 0, growth: 0.07, conv: 0.71, quality: 0.92, hours: CITY, staffN: 4, baseReviews: [241, 4.8] },
    { id: 'KP', code: 'KOP', name: 'Koper', city: 'Koper', country: 'SI', kind: 'City centre', size: 0.9, coast: 1, growth: -0.02, conv: 0.6, quality: 0.83, hours: COAST, staffN: 5, baseReviews: [274, 4.6] },
    { id: 'NM', code: 'NME', name: 'Novo Mesto', city: 'Novo Mesto', country: 'SI', kind: 'City centre', size: 0.75, coast: 0, growth: 0.11, conv: 0.68, quality: 0.88, hours: CITY, staffN: 3, baseReviews: [168, 4.7] },
    { id: 'KR', code: 'KRA', name: 'Kranj', city: 'Kranj', country: 'SI', kind: 'City centre', size: 0.8, coast: 0, growth: 0.04, conv: 0.64, quality: 0.84, hours: CITY, staffN: 4, baseReviews: [203, 4.6] },
    { id: 'ZG-ARE', code: 'ZGA', name: 'Zagreb Arena', city: 'Zagreb', country: 'HR', kind: 'Shopping centre', size: 1.25, coast: 0, growth: 0.13, conv: 0.62, quality: 0.82, hours: MALL, staffN: 7, baseReviews: [527, 4.5] },
    { id: 'RI', code: 'RIJ', name: 'Rijeka', city: 'Rijeka', country: 'HR', kind: 'City centre', size: 0.9, coast: 1, growth: 0.06, conv: 0.65, quality: 0.86, hours: COAST, staffN: 5, baseReviews: [296, 4.6] },
    { id: 'ST', code: 'SPL', name: 'Split', city: 'Split', country: 'HR', kind: 'City centre', size: 1.0, coast: 1, growth: 0.1, conv: 0.63, quality: 0.81, hours: COAST, staffN: 6, baseReviews: [352, 4.5] }
  ];
  var BY_ID = {};
  STORES.forEach(function (s) { BY_ID[s.id] = s; });

  // Public holidays (stores closed). Fixed dates + Easter Monday / Corpus Christi for 2025–2027.
  var HOL = {
    SI: { fixed: ['01-01', '01-02', '02-08', '04-27', '05-01', '05-02', '06-25', '08-15', '10-31', '11-01', '12-25', '12-26'], extra: ['2025-04-21', '2026-04-06', '2027-03-29'] },
    HR: { fixed: ['01-01', '01-06', '05-01', '05-30', '06-22', '08-05', '08-15', '11-01', '11-18', '12-25', '12-26'], extra: ['2025-04-21', '2025-06-19', '2026-04-06', '2026-06-04', '2027-03-29', '2027-05-27'] }
  };
  var HOL_NAMES = { '01-01': 'New Year', '01-02': 'New Year', '02-08': 'Prešeren Day', '04-27': 'Day of Uprising', '05-01': 'Labour Day', '05-02': 'Labour Day', '06-25': 'Statehood Day', '08-15': 'Assumption Day', '10-31': 'Reformation Day', '11-01': 'All Saints’ Day', '12-25': 'Christmas', '12-26': 'Independence / St Stephen’s Day', '01-06': 'Epiphany', '05-30': 'Statehood Day', '06-22': 'Anti-Fascist Struggle Day', '08-05': 'Victory Day', '11-18': 'Remembrance Day' };
  function holiday(storeId, date) {
    var h = HOL[BY_ID[storeId].country];
    if (h.fixed.indexOf(date.slice(5)) >= 0) return HOL_NAMES[date.slice(5)] || 'Public holiday';
    if (h.extra.indexOf(date) >= 0) return 'Public holiday';
    return null;
  }
  function hours(storeId, date) {
    if (holiday(storeId, date)) return null;
    return BY_ID[storeId].hours[dow(date)] || null;
  }

  // ── names (invented combinations) ─────────────────────────────────────────
  var FIRST = {
    SI: ['Ana', 'Maja', 'Nina', 'Eva', 'Tina', 'Petra', 'Katja', 'Urška', 'Špela', 'Nika', 'Mojca', 'Lara', 'Tjaša', 'Jan', 'Luka', 'Matej', 'Rok', 'Žiga', 'Gregor', 'Tomaž', 'Blaž', 'Miha', 'Andrej', 'Nejc'],
    HR: ['Ivana', 'Petra', 'Marija', 'Ana', 'Lucija', 'Martina', 'Kristina', 'Iva', 'Mia', 'Sara', 'Marko', 'Ivan', 'Luka', 'Tomislav', 'Josip', 'Matej', 'Filip', 'Ante', 'Dario', 'Karlo']
  };
  var LAST = {
    SI: ['Kranjc', 'Zupan', 'Hribar', 'Kos', 'Vidmar', 'Golob', 'Turk', 'Bizjak', 'Kralj', 'Zajc', 'Leban', 'Žagar', 'Rozman', 'Pirc', 'Oblak', 'Petek', 'Kavčič', 'Jereb', 'Mlakar', 'Debeljak'],
    HR: ['Babić', 'Marić', 'Jurić', 'Novak', 'Kovačić', 'Vuković', 'Knežević', 'Pavlović', 'Barišić', 'Matić', 'Šarić', 'Lončar', 'Perić', 'Tomić', 'Grgić', 'Radić']
  };
  function personName(T, country) { return T.pick(FIRST[country]) + ' ' + T.pick(LAST[country]); }
  function shortName(T, country) { return T.pick(FIRST[country]) + ' ' + T.pick(LAST[country]).charAt(0) + '.'; }
  function phone(T, country) { return (country === 'SI' ? '+386 4' + T.int(0, 1) + ' 000 ' : '+385 9' + T.pick(['1', '5', '8']) + ' 000 ') + String(T.int(100, 999)); }

  // ── staff ─────────────────────────────────────────────────────────────────
  var staffCache = {};
  function staff(storeId) {
    if (staffCache[storeId]) return staffCache[storeId];
    var s = BY_ID[storeId], T = tools('staff|' + storeId), used = {}, list = [];
    function uniqueName() { var n; do { n = personName(T, s.country); } while (used[n]); used[n] = 1; return n; }
    var nOpto = s.staffN >= 6 ? 2 : 1;
    for (var i = 0; i <= s.staffN; i++) {
      var role = i === 0 ? 'Store manager' : i <= nOpto ? 'Optometrist' : (i % 3 === 0 ? 'Sales advisor' : 'Optician');
      var part = i > 1 && T.chance(0.22);
      var vacStart = addDays('2026-06-29', (role === 'Optometrist' ? (i === 1 ? T.int(0, 3) : T.int(4, 7)) : T.int(0, 7)) * 7); // optometrists never on leave together
      list.push({
        id: storeId + '-' + (i + 1), store: storeId, idx: i, name: uniqueName(), role: role, fte: part ? 0.6 : 1,
        exams: role === 'Optometrist', salesFactor: role === 'Optometrist' ? 0.7 + T.R() * 0.2 : 0.88 + T.R() * 0.24,
        vac: [vacStart, addDays(vacStart, T.chance(0.5) ? 13 : 6)], email: 'staff' + (i + 1) + '.' + s.code.toLowerCase() + '@example.com'
      });
    }
    staffCache[storeId] = list;
    return list;
  }

  // ── planned shifts (who works when) ──────────────────────────────────────
  function onVacation(p, date) {
    var y = date.slice(0, 4), a = y + p.vac[0].slice(4), b = y + p.vac[1].slice(4);
    return date >= a && date <= b;
  }
  var planCache = {};
  function plan(storeId, date) {
    var key = storeId + '|' + date;
    if (planCache[key]) return planCache[key];
    var h = hours(storeId, date), out = [];
    if (h) {
      var o = h[0], c = h[1], span = c - o, d = dow(date), wk = weekNo(date);
      var early = [o, Math.min(c, o + 480)], late = [Math.max(o, c - 480), c];
      staff(storeId).forEach(function (p) {
        if (onVacation(p, date)) return;
        var off;
        if (p.fte < 1) off = ((p.idx + wk + d) % 5) >= 3;                    // part-time: about 3 of 5 days
        else off = ((p.idx + wk) % 6) + 1 === d;                            // one rotating day off Mon–Sat
        if (p.idx === 0 && d === 6 && wk % 2 === 0) off = true;             // manager: every other Saturday off
        if (off) return;
        var sh;
        if (span <= 360) sh = [o, c];
        else if (p.idx === 0) sh = early;
        else sh = ((p.idx + wk + d) % 2) ? late : early;
        out.push({ staffId: p.id, start: sh[0], end: sh[1] });
      });
      // an optometrist is always rostered (eye exams are booked every open day)
      var team = staff(storeId);
      if (!out.some(function (x) { var p = team[+x.staffId.split('-').pop() - 1]; return p && p.exams; })) {
        var cover = team.filter(function (p) { return p.exams && !onVacation(p, date); })[wk % 2] || team.filter(function (p) { return p.exams && !onVacation(p, date); })[0];
        if (cover) out.push({ staffId: cover.id, start: early[0], end: early[1] });
      }
    }
    planCache[key] = out;
    return out;
  }

  // ── time attendance (Codeks-style clock-ins) ──────────────────────────────
  var attCache = {};
  function attendance(storeId, date) {
    var key = storeId + '|' + date;
    if (attCache[key]) return attCache[key];
    var out = plan(storeId, date).map(function (pl) {
      var T = tools('att|' + pl.staffId + '|' + date);
      var rec = { staffId: pl.staffId, start: pl.start, end: pl.end, planned: (pl.end - pl.start) / 60, absent: false, late: 0, missingOut: false, in: null, out: null, actual: 0 };
      if (T.chance(0.015)) { rec.absent = true; rec.reason = T.chance(0.7) ? 'Sick leave' : 'Short-notice leave'; return rec; }
      var inD = Math.round(-7 + T.normal() * 3);
      if (T.chance(0.05)) inD = T.int(6, 32);
      rec.in = pl.start + Math.min(inD, 40);
      if (rec.in > pl.start + 5) rec.late = rec.in - pl.start;
      if (T.chance(0.012)) { rec.missingOut = true; rec.actual = (pl.end - rec.in) / 60; }
      else { rec.out = pl.end + Math.max(-10, Math.round(4 + T.normal() * 6)); rec.actual = (rec.out - rec.in) / 60; }
      rec.actual = Math.round(rec.actual * 100) / 100;
      return rec;
    });
    attCache[key] = out;
    return out;
  }

  // ── daily trading ─────────────────────────────────────────────────────────
  var SEASON = [0.84, 0.86, 0.95, 1.0, 1.04, 1.1, 1.08, 0.98, 1.08, 1.0, 0.95, 1.14];
  function season(date) {
    var m = +date.slice(5, 7) - 1, dd = +date.slice(8, 10), n = monthDays(date.slice(0, 7));
    var a = SEASON[m], b = SEASON[(m + 1) % 12], t = (dd - 1) / n;
    return a + (b - a) * Math.max(0, t - 0.5);
  }
  function summer(date) { var x = Math.cos((doy(date) - 195) / 365 * 2 * Math.PI); return Math.max(0, x) * Math.max(0, x); }
  var WD_MALL = [0, 0.84, 0.9, 0.95, 1.0, 1.16, 1.38], WD_CITY = [0, 1.02, 0.98, 1.0, 1.05, 1.12, 0.66];
  var FEE = { SI: 32, HR: 27 };
  function promo(date) {
    var md = date.slice(5);
    if (md >= '09-01' && md <= '09-15') return { name: 'Back to school', extra: 0.03 };
    if (md >= '06-15' && md <= '06-30') return { name: 'Summer sunglasses', extra: 0.025 };
    if (md >= '11-24' && md <= '11-30') return { name: 'Black week', extra: 0.06 };
    return null;
  }

  var dayCache = {};
  function day(storeId, date) {
    var key = storeId + '|' + date;
    if (dayCache[key]) return dayCache[key];
    var s = BY_ID[storeId], h = hours(storeId, date), res;
    if (!h) { res = { store: storeId, date: date, open: false, holiday: holiday(storeId, date) }; dayCache[key] = res; return res; }
    var T = tools('day|' + key), d = dow(date);
    var years = diffDays('2026-01-01', date) / 365;
    var growth = Math.exp(s.growth * years) * (1 + 0.04 * Math.sin(diffDays('2025-01-01', date) / 37 + s.size * 9)); // slow drift
    var wd = (s.hours === MALL ? WD_MALL : WD_CITY)[d];
    var noise = Math.exp(T.normal() * 0.12);
    var base = 3350 * s.size * season(date) * wd * growth * noise;

    // eye exams: capacity from optometrists who actually worked
    var att = attendance(storeId, date), optoPlan = 0, optoWork = 0, relief = false;
    att.forEach(function (a) { var p = staffById(a.staffId); if (p && p.exams) { optoPlan += a.planned; if (!a.absent) optoWork += a.actual; } });
    if (!optoPlan) { optoPlan = optoWork = 8; relief = true; }            // relief optometrist from another store
    var cap = Math.round(optoPlan * 0.95);
    var booked = Math.max(0, Math.round(cap * Math.min(0.98, 0.62 + 0.18 * season(date) / 1.1 + T.normal() * 0.08)));
    var rescheduled = optoWork >= optoPlan ? 0 : booked - Math.round(booked * optoWork / optoPlan);
    var seen = booked - rescheduled;
    var noShow = T.binom(seen, 0.085), walkIn = optoWork ? T.int(0, 2) : 0, done = seen - noShow + walkIn;
    var converted = T.binom(done, Math.max(0.3, Math.min(0.9, s.conv + T.normal() * 0.05)));

    var sunShare = 0.07 + 0.16 * summer(date) * (s.coast ? 1.6 : 1), clShare = 0.12 + T.R() * 0.03;
    var glassesShare = 1 - sunShare - clShare;
    var convBoost = done ? 0.8 + 0.4 * (converted / Math.max(1, done * s.conv)) : 1;
    var gross = {
      frames: base * glassesShare * 0.46 * convBoost,
      lenses: base * glassesShare * 0.54 * convBoost,
      cl: base * clShare,
      sun: base * sunShare,
      services: done * FEE[s.country] * (0.55 + T.R() * 0.2) + T.int(0, 3) * 8
    };
    var pr = promo(date), discRate = 0.035 + T.R() * 0.035 + (pr ? pr.extra : 0);
    var mix = {}, goodsGross = 0, discount = 0, revenue = 0;
    Object.keys(gross).forEach(function (k) {
      var g = r2(gross[k]), disc = k === 'services' ? 0 : r2(g * discRate);
      mix[k] = r2(g - disc); discount += disc; revenue += mix[k]; if (k !== 'services') goodsGross += g;
    });
    revenue = r2(revenue); discount = r2(discount);
    var units = {
      frames: Math.max(0, Math.round(mix.frames / (128 + T.R() * 30))),
      cl: Math.max(0, Math.round(mix.cl / 27)),
      sun: Math.max(0, Math.round(mix.sun / (92 + T.R() * 25))),
      services: done
    };
    units.lenses = units.frames * 2 + T.int(0, 2) * 2;
    var avgGoods = 150 + 70 * (glassesShare - 0.6) + T.normal() * 12;
    var receipts = Math.max(1, Math.round((revenue - mix.services) / Math.max(60, avgGoods)) + Math.round((done - converted) * 0.55));
    var unitsTotal = units.frames + units.lenses + units.cl + units.sun + units.services;

    // money box: register (POS) totals vs card terminal batch vs cash counted at close
    var cashShare = Math.max(0.06, (s.country === 'HR' ? 0.25 : 0.17) + T.normal() * 0.04);
    var regCash = r2(revenue * cashShare), regCard = r2(revenue - regCash);
    var cardDiff = T.chance(0.03) ? r2((T.chance(0.5) ? -1 : 1) * (5 + T.R() * 55)) : 0;
    var x = T.R(), cashDiff = 0;
    if (x < 0.05) cashDiff = r2((T.chance(0.6) ? -1 : 1) * (5 + T.R() * 45));
    else if (x < 0.16) cashDiff = r2((T.chance(0.5) ? -1 : 1) * (0.01 + T.R() * 1.99));
    var float = 150;

    res = {
      store: storeId, date: date, open: true, hours: h, revenue: revenue, receipts: receipts, avg: r2(revenue / receipts), units: unitsTotal, unitMix: units,
      mix: mix, discount: discount, discountRate: goodsGross ? discount / goodsGross : 0, promo: pr ? pr.name : null,
      exams: { booked: booked, rescheduled: rescheduled, relief: relief, noShow: noShow, walkIn: walkIn, done: done, converted: converted },
      woCount: Math.max(converted, units.frames),
      cash: { float: float, regCash: regCash, regCard: regCard, terminal: r2(regCard + cardDiff), cardDiff: cardDiff, expected: r2(float + regCash), counted: r2(float + regCash + cashDiff), diff: cashDiff }
    };
    dayCache[key] = res;
    return res;
  }
  var staffIx = null;
  function staffById(id) {
    if (!staffIx) { staffIx = {}; STORES.forEach(function (s) { staff(s.id).forEach(function (p) { staffIx[p.id] = p; }); }); }
    return staffIx[id];
  }

  // ── monthly targets: last year's same month + 6–10 % ─────────────────────
  var targetCache = {};
  function monthTarget(storeId, ym) {
    var key = storeId + '|' + ym;
    if (targetCache[key] != null) return targetCache[key];
    var y = +ym.slice(0, 4) - 1, m = ym.slice(5, 7), n = monthDays(y + '-' + m), sum = 0;
    for (var d = 1; d <= n; d++) sum += day(storeId, y + '-' + m + '-' + pad(d)).revenue || 0;
    var T = tools('target|' + key);
    var t = Math.round(sum * (1.03 + T.R() * 0.04) / 500) * 500;
    targetCache[key] = t;
    return t;
  }

  // ── glasses work orders ───────────────────────────────────────────────────
  var KINDS = [
    ['Single-vision glasses', 46, [4, 6], [150, 380]],
    ['Progressive glasses', 24, [7, 11], [420, 980]],
    ['Office / computer lenses', 8, [6, 9], [260, 520]],
    ['Prescription sunglasses', 10, [8, 12], [240, 560]],
    ['Kids’ glasses', 12, [4, 6], [110, 260]]
  ];
  var FRAMES = ['Lumina', 'Serena', 'Nordline', 'Atelier Vero', 'Kestrel', 'Riva Sun', 'Polar Shade', 'Solaris'];
  var LABS = ['Central lens lab', 'Partner lab (free-form)', 'In-store edging'];
  var ORIGIN = '2025-09-01';
  var woCache = {};
  function nextOpen(storeId, date) { var g = 0; while (!hours(storeId, date) && g++ < 7) date = addDays(date, 1); return date; }
  function workOrders(storeId, upTo) {
    var c = woCache[storeId] || (woCache[storeId] = { upTo: null, list: [], from: null });
    var from = addDays(upTo, -190);
    if (c.upTo && c.upTo >= upTo && c.from <= from) return c.list;
    var s = BY_ID[storeId], list = [];
    for (var date = from; date <= upTo; date = addDays(date, 1)) {
      var dd = day(storeId, date);
      if (!dd.open) continue;
      for (var i = 0; i < dd.woCount; i++) {
        var T = tools('wo|' + storeId + '|' + date + '|' + i);
        var k = T.weighted(KINDS.map(function (x) { return [x, x[1]]; }));
        var lead = T.int(k[2][0], k[2][1]);
        var expected = nextOpen(storeId, addDays(date, lead));
        var delay = T.chance(0.065) ? T.int(2, 9) : 0;
        var ready = nextOpen(storeId, addDays(expected, delay));
        var wait = T.chance(0.045) ? T.int(15, 40) : Math.min(13, Math.floor(-Math.log(1 - T.R() * 0.98) * 2.2));
        list.push({
          id: 'WO-' + s.code + '-' + date.slice(2).replace(/-/g, '') + '-' + pad(i + 1), store: storeId, created: date,
          kind: k[0], frame: T.pick(FRAMES) + ' ' + T.int(1000, 9899), lab: k[0] === 'Kids’ glasses' && T.chance(0.4) ? LABS[2] : T.chance(0.7) ? LABS[0] : LABS[1],
          expected: expected, ready: ready, delay: delay, pickedUp: nextOpen(storeId, addDays(ready, wait)),
          customer: shortName(T, s.country), phone: phone(T, s.country), value: Math.round(k[3][0] + T.R() * (k[3][1] - k[3][0])),
          paid: T.chance(0.6) ? 'Paid in full' : 'Deposit paid',
          remindedOn: wait >= 8 && T.chance(0.85) ? nextOpen(storeId, addDays(ready, T.int(7, 9))) : null
        });
      }
    }
    c.upTo = upTo; c.from = from; c.list = list;
    return list;
  }

  // ── complaints / returns ──────────────────────────────────────────────────
  var CTYPES = [['Lens remake', 45], ['Frame defect', 33], ['Wrong prescription', 22]];
  var CDETAIL = {
    'Lens remake': ['Customer reports blurred edges on progressive lenses', 'Scratch on the anti-reflective coating after a week', 'Lens height measured too low, remake requested', 'Coating peeling on the right lens', 'Customer cannot adapt to the progression zone'],
    'Frame defect': ['Hinge loose on the left temple', 'Nose pad arm broke', 'Acetate front cracked near the bridge', 'Colour wearing off on the temples', 'Screw keeps coming out of the hinge'],
    'Wrong prescription': ['Axis on the left lens differs from the prescription', 'Customer reports headaches; recheck booked', 'Wrong addition on progressive lenses', 'PD entered incorrectly on the order', 'External prescription transcribed wrongly']
  };
  var cmpCache = {};
  function complaints(storeId, upTo) {
    var c = cmpCache[storeId];
    if (c && c.upTo >= upTo) return c.list;
    var s = BY_ID[storeId], list = [], from = addDays(upTo, -200);
    for (var date = from; date <= upTo; date = addDays(date, 1)) {
      if (!hours(storeId, date)) continue;
      var T = tools('cmp|' + storeId + '|' + date);
      if (!T.chance(0.2 * s.size * (1.15 - s.quality * 0.3))) continue;
      var type = T.weighted(CTYPES), dur = T.chance(0.035) ? T.int(20, 40) : T.int(2, 12);
      list.push({ id: 'RC-' + s.code + '-' + date.slice(2).replace(/-/g, ''), store: storeId, opened: date, type: type, detail: T.pick(CDETAIL[type]),
        customer: shortName(T, s.country), resolved: addDays(date, dur), resolution: type === 'Frame defect' ? T.pick(['Frame replaced under warranty', 'Repaired in store', 'Sent to supplier']) : T.pick(['Lenses remade', 'Lenses remade free of charge', 'Prescription rechecked and corrected']) });
    }
    cmpCache[storeId] = { upTo: upTo, list: list };
    return list;
  }

  // ── Google reviews (fictional authors and texts) ──────────────────────────
  var RTEXT = {
    5: ['Very friendly staff and a thorough eye exam. My new glasses were ready in five days.', 'Excellent advice choosing frames, they took their time with me.', 'Quick, professional and kind. The optometrist explained everything clearly.', 'Best optician in town. Fixed my old glasses for free while I waited.', 'Great selection of frames and fair prices. Will come back.', 'The whole family got their eyes checked here, everyone was patient with the kids.', 'Contact lens fitting was easy and they showed me how to put them in.', 'Lovely store, helpful team, glasses fit perfectly.', 'Got my progressive lenses here, they adjusted the frame until it was just right.', 'Fast service, friendly people, nothing to complain about.', ''],
    4: ['Good service, but I waited a bit longer than promised for the glasses.', 'Nice staff and good choice of sunglasses. A bit busy on Saturday.', 'Professional eye exam, prices slightly higher than expected.', 'Happy with my new glasses, the pickup took some time.', ''],
    3: ['Okay experience. The exam was fine but I had to wait 20 minutes despite the booking.', 'Glasses are good, but nobody called me when they were ready.', 'Average. Staff seemed rushed.'],
    2: ['My glasses took two weeks longer than promised and I had to call twice.', 'Frame broke after a month, the repair took a long time.'],
    1: ['Wrong lenses in my glasses and I had to come back three times.', 'Booked an eye exam online but the store had no record of it.', 'Unfriendly at the counter, I left without buying.']
  };
  var rvCache = {};
  function reviews(storeId, upTo) {
    var c = rvCache[storeId];
    if (c && c.upTo >= upTo) return c.list;
    var s = BY_ID[storeId], list = [];
    for (var date = ORIGIN; date <= upTo; date = addDays(date, 1)) {
      var T = tools('rv|' + storeId + '|' + date);
      var n = T.chance(0.42 * Math.sqrt(s.size)) ? (T.chance(0.15) ? 2 : 1) : 0;
      for (var i = 0; i < n; i++) {
        var q = s.quality, stars = T.weighted([[5, 52 + q * 20], [4, 20], [3, 9 - q * 4], [2, 6 - q * 4], [1, 9 - q * 7]]);
        var replied = T.chance(stars <= 3 ? 0.9 : 0.82) ? addDays(date, T.int(0, 5)) : null;
        list.push({ id: 'RV-' + s.code + '-' + date.replace(/-/g, '') + '-' + i, store: storeId, date: date, author: shortName(T, s.country), stars: stars, text: T.pick(RTEXT[stars]), repliedOn: replied });
      }
    }
    rvCache[storeId] = { upTo: upTo, list: list };
    return list;
  }

  // ── editable state (tasks seeded relative to today) ───────────────────────
  function initialState(today) {
    var all = STORES.map(function (s) { return s.id; });
    var si = STORES.filter(function (s) { return s.country === 'SI'; }).map(function (s) { return s.id; });
    var hr = STORES.filter(function (s) { return s.country === 'HR'; }).map(function (s) { return s.id; });
    var d = dow(today), toFri = (5 - d + 7) % 7 || 7;
    var eom = today.slice(0, 7) + '-' + pad(monthDays(today.slice(0, 7)));
    var ts = function (date, hm) { return date + 'T' + hm; };
    var tasks = [
      { id: 't1', title: 'Change the window display to the autumn frame collection', details: 'Use the new posters from the head-office parcel. Take a photo of the finished window for the area manager.', due: addDays(today, toFri), stores: all, createdAt: ts(addDays(today, -3), '08:15'), by: 'Head office' },
      { id: 't2', title: 'Check the first-aid kit and fire extinguisher dates', details: 'Write the expiry dates in the store notebook. Order replacements through the usual form if anything expires this year.', due: addDays(today, -2), stores: all, createdAt: ts(addDays(today, -9), '09:02'), by: 'Head office' },
      { id: 't3', title: 'Count contact-lens solution stock and note short expiry dates', details: 'Anything expiring within 3 months goes to the front shelf with the yellow sticker.', due: eom, stores: si, createdAt: ts(addDays(today, -1), '14:40'), by: 'Head office' },
      { id: 't4', title: 'Put up the new eye exam price list', details: 'New prices apply from the first day of next month. Remove the old list the evening before.', due: addDays(today, 9), stores: hr, createdAt: ts(addDays(today, -1), '10:05'), by: 'Head office' }
    ];
    var done = {};
    ['LJ-BTC', 'CE', 'NM', 'ST'].forEach(function (id, i) { done['t1|' + id] = ts(addDays(today, -1 - (i % 2)), '1' + (i + 1) + ':2' + i); });
    all.forEach(function (id, i) { if (id !== 'KP' && id !== 'MB-EUR') done['t2|' + id] = ts(addDays(today, -3 - (i % 4)), '0' + (8 + (i % 2)) + ':3' + (i % 6)); });
    done['t3|KR'] = ts(today, '08:20');
    return { version: VERSION, seededFor: today, cash: {}, called: {}, replied: {}, notes: {}, tasks: tasks, taskDone: done, nextTask: 5 };
  }

  window.StoresData = {
    VERSION: VERSION, STORES: STORES, byId: BY_ID, FEE: FEE,
    staff: staff, staffById: staffById, hours: hours, holiday: holiday, plan: plan, attendance: attendance,
    day: day, monthTarget: monthTarget, workOrders: workOrders, complaints: complaints, reviews: reviews,
    baseReviews: function (id) { return BY_ID[id].baseReviews; },
    initialState: initialState,
    util: { pad: pad, ymd: ymd, parse: parse, addDays: addDays, diffDays: diffDays, dow: dow, monthDays: monthDays, r2: r2 }
  };
})();
