/*
 * Branch Manager demo data: "Clearfigure Optika", a fictional optics chain with branches in Slovenia and Croatia.
 * Every name, address, e-mail, phone number and ID here is made up. Nothing comes from a real account.
 *
 * The figures are generated from a fixed seed relative to today, so the demo never goes stale:
 * the account opened about seven months ago, the current month runs to date (later days are
 * appointments already scheduled), and every total is the sum of the figures below it
 * (lifetime = sum of the months = sum of the branches = sum of the rooms).
 */
(function () {
  'use strict';

  var DAY = 864e5;
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function midnight(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function addDays(d, n) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); return x; }
  function daysIn(y, m) { return new Date(y, m + 1, 0).getDate(); }

  // ---------- public holidays (shops closed) ----------
  function easter(y) { var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451), mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1; return new Date(y, mo - 1, da); }
  var HOL = {};
  function holidays(country, y) {
    var key = country + y; if (HOL[key]) return HOL[key];
    var fixed = country === 'SI'
      ? { '01-01': 'New Year', '01-02': 'New Year', '02-08': 'Prešeren Day', '04-27': 'Day of Uprising Against Occupation', '05-01': 'Labour Day', '05-02': 'Labour Day', '06-25': 'Statehood Day', '08-15': 'Assumption Day', '10-31': 'Reformation Day', '11-01': 'All Saints’ Day', '12-25': 'Christmas', '12-26': 'Independence and Unity Day' }
      : { '01-01': 'New Year', '01-06': 'Epiphany', '05-01': 'Labour Day', '05-30': 'Statehood Day', '06-22': 'Anti-Fascist Struggle Day', '08-05': 'Victory Day', '08-15': 'Assumption Day', '11-01': 'All Saints’ Day', '11-18': 'Remembrance Day', '12-25': 'Christmas', '12-26': 'St Stephen’s Day' };
    var out = {};
    Object.keys(fixed).forEach(function (md) { out[y + '-' + md] = fixed[md]; });
    var e = easter(y);
    out[ymd(e)] = 'Easter Sunday';
    out[ymd(addDays(e, 1))] = 'Easter Monday';
    if (country === 'SI') out[ymd(addDays(e, 49))] = 'Whit Sunday';
    if (country === 'HR') out[ymd(addDays(e, 60))] = 'Corpus Christi';
    return (HOL[key] = out);
  }
  function holidayName(country, d) { return holidays(country, d.getFullYear())[ymd(d)] || ''; }

  // ---------- seeded random numbers ----------
  function hash(str) { var h = 2166136261; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) { var a = seed; return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  // split n into parts proportional to weights, summing exactly to n (largest remainder)
  function split(n, weights) {
    var tot = weights.reduce(function (a, b) { return a + b; }, 0) || 1;
    var raw = weights.map(function (w) { return n * w / tot; });
    var out = raw.map(Math.floor), left = n - out.reduce(function (a, b) { return a + b; }, 0);
    raw.map(function (v, i) { return [v - Math.floor(v), i]; }).sort(function (a, b) { return b[0] - a[0]; }).slice(0, left).forEach(function (x) { out[x[1]]++; });
    return out;
  }

  // ---------- catalogue ----------
  var SERVICES = [
    // name, mix weight, minutes, fee (EUR), customer booking?
    ['Eye Exam 20 minutes', 34, 20, 25, true],
    ['Eye Exam 30 minutes', 9, 30, 35, true],
    ['Sight measurement for kids', 4, 30, 20, true],
    ['Sight measurement with intraocular pressure', 13, 20, 30, true],
    ['Sight measurement for contact lenses', 9, 20, 30, true],
    ['Contact Lenses Check-up', 6, 20, 15, true],
    ['Contact Lenses Fitting 30 minutes', 7, 30, 40, true],
    ['Contact Lenses Fitting 60 minutes', 3, 60, 60, true],
    ['Contact Lenses Fitting for Selected Brands', 2, 45, 45, true],
    ['Eye Pressure Test', 0, 10, 10, true],
    ['BLOCK', 8, 30, 0, false]
  ];
  var SV = SERVICES.map(function (s) { return s[0]; });
  var BLOCK = SV.length - 1;

  // id, country, city, street, postcode, rooms, utilisation, opens (days after the account), manager
  var BR = [
    ['ljubljana', 'SI', 'Ljubljana', 'Slovenska cesta 41', '1000', 3, 0.72, 0, 'Maja Kovač'],
    ['maribor', 'SI', 'Maribor', 'Partizanska cesta 12', '2000', 2, 0.68, 0, 'Rok Zupan'],
    ['celje', 'SI', 'Celje', 'Prešernova ulica 8', '3000', 2, 0.61, 1, 'Špela Kos'],
    ['kranj', 'SI', 'Kranj', 'Koroška cesta 5', '4000', 2, 0.56, 1, 'Gregor Jereb'],
    ['koper', 'SI', 'Koper', 'Pristaniška ulica 3', '6000', 2, 0.52, 62, 'Neža Petek'],
    ['zagreb', 'HR', 'Zagreb', 'Ilica 52', '10000', 3, 0.74, 0, 'Ivana Perić'],
    ['split', 'HR', 'Split', 'Marmontova ulica 7', '21000', 2, 0.65, 2, 'Ante Radić'],
    ['rijeka', 'HR', 'Rijeka', 'Korzo 18', '51000', 2, 0.58, 2, 'Petra Lovrić'],
    ['osijek', 'HR', 'Osijek', 'Kapucinska ulica 20', '31000', 2, 0.6, null, 'Karlo Matić']
  ];
  var ROOM_W = { 2: [60, 40], 3: [48, 34, 18] };

  function build(now) {
    now = now ? new Date(now) : new Date();
    var today = midnight(now), todayKey = ymd(today);
    var opened = addDays(today, -214); // account created about seven months ago
    var firstLive = addDays(opened, 7); // the first calendars go live a week after the account opens
    var startK = firstLive.getFullYear() * 12 + firstLive.getMonth();
    var curK = today.getFullYear() * 12 + today.getMonth();
    var R0 = rng(hash('stratum-optika'));

    // branches
    var branches = BR.map(function (x, bi) {
      var reg = x[7] === null ? addDays(today, -12) : addDays(opened, x[7]);
      var regAt = new Date(reg.getFullYear(), reg.getMonth(), reg.getDate(), 8 + (bi % 3), 5 + bi * 6);
      var live = x[7] === null ? null : addDays(reg, 7); // calendars go live a week after registration
      var rooms = [];
      for (var i = 0; i < x[5]; i++) rooms.push({ code: 'E' + (i + 1), name: 'Examination ' + (i + 1), rid: 'demo-rs-' + pad(bi + 1) + pad(i + 1), bookings: 0, owner: true });
      return {
        id: x[0], country: x[1], city: x[2], street: x[3], postcode: x[4],
        address: x[3] + ', ' + x[4] + ' ' + x[2] + ', ' + (x[1] === 'SI' ? 'Slovenija' : 'Hrvatska'),
        email: x[0] + '@example.' + x[1].toLowerCase(),
        phone: (x[1] === 'SI' ? '+386' : '+385') + ' (0) 000 000 000',
        bmId: 'demo-br-' + pad(bi + 1) + '00', owner: x[8], manager: x[8],
        registeredAt: regAt, registered: pad(regAt.getDate()) + '/' + pad(regAt.getMonth() + 1) + '/' + regAt.getFullYear() + ' ' + pad(regAt.getHours()) + ':' + pad(regAt.getMinutes()),
        live: live, util: x[6], roomsN: x[5], rooms: rooms, services: SV, offAll: !live,
        mix: SERVICES.map(function (s) { return s[1] * (0.8 + R0() * 0.4); }),
        st: { adhoc: 0, cal: 0, total: 0, su: 0, cu: 0, rev: 0, svc: SV.map(function () { return 0; }), share: '', top: [] }
      };
    });

    // months
    var M = {}, months = [];
    for (var k = startK; k <= curK; k++) {
      var y = Math.floor(k / 12), m = k % 12, nd = daysIn(y, m), isCur = k === curK;
      var mo = { k: k, y: y, m: m, days: nd, isCurrent: isCur, daily: [], sb: [0, 0, 0], su: [0, 0, 0], cu: 0, rev: 0, svc: SV.map(function () { return 0; }),
        workH: 0, bookH: 0, bookAvail: 0, bookUsed: 0, rooms: [], perBranch: [], resources: 0 };
      for (var di = 0; di < nd; di++) mo.daily.push(0);
      branches.forEach(function (b, bi) {
        var n = 0, openDays = 0, satDays = 0;
        if (b.live) for (var dd = 1; dd <= nd; dd++) {
          var date = new Date(y, m, dd);
          if (date < b.live) continue;
          var dow = date.getDay();
          if (dow === 0 || holidayName(b.country, date)) continue;
          if (dow === 6) satDays++; else openDays++;
          var r = rng(hash(b.id + ymd(date)));
          var slots = b.roomsN * (dow === 6 ? 7 : 14);
          var ramp = Math.min(1, 0.35 + (date - b.live) / DAY / 40);
          var season = m === 7 ? 0.84 : (m === 11 ? 0.9 : 1);
          var v = slots * b.util * ramp * season * (0.84 + r() * 0.32);
          var ahead = Math.round((date - today) / DAY);
          if (ahead > 0) v *= Math.max(0.12, 0.88 - 0.035 * ahead); // already scheduled
          v = Math.round(v);
          n += v; mo.daily[dd - 1] += v;
        }
        var rr = rng(hash(b.id + 'm' + k));
        var adhoc = n > 0 ? Math.floor(rr() * 3) : 0; if (adhoc > n) adhoc = n;
        var svc = split(n - adhoc, b.mix);
        var su = svc.reduce(function (a, c, i) { return a + (SERVICES[i][4] ? c : 0); }, 0);
        var suAd = Math.floor(adhoc / 2);
        var rev = svc.reduce(function (a, c, i) { return a + c * SERVICES[i][3]; }, 0);
        var mins = svc.reduce(function (a, c, i) { return a + c * SERVICES[i][2]; }, 0) + adhoc * 20;
        var custMins = svc.reduce(function (a, c, i) { return a + (SERVICES[i][4] ? c * SERVICES[i][2] : 0); }, 0);
        var cu = Math.round((su + suAd) * (0.55 + rr() * 0.1)) + (k === startK && n > 0 ? 400 + Math.floor(rr() * 300) : 0); // first month: customer import
        var roomSplit = split(n, ROOM_W[b.roomsN]);
        roomSplit.forEach(function (c, i) { b.rooms[i].bookings += c; if (c) mo.rooms.push([b.rooms[i].name + ' · ' + b.city, c]); });
        if (n > 0) mo.resources += b.roomsN;
        mo.workH += b.roomsN * (openDays * 10.5 + satDays * 5);
        mo.bookAvail += b.roomsN * (openDays * 10 + satDays * 5);
        mo.bookH += mins / 60; mo.bookUsed += custMins / 60;
        mo.sb[0] += adhoc; mo.sb[1] += n - adhoc; mo.sb[2] += n;
        mo.su[0] += suAd; mo.su[1] += su; mo.su[2] += suAd + su;
        mo.cu += cu; mo.rev += rev;
        svc.forEach(function (c, i) { mo.svc[i] += c; b.st.svc[i] += c; });
        mo.perBranch.push({ b: b, n: n, su: suAd + su });
        b.st.adhoc += adhoc; b.st.cal += n - adhoc; b.st.total += n; b.st.su += suAd + su; b.st.cu += cu; b.st.rev += rev;
      });
      var rm = rng(hash('month' + k));
      var two = function (v) { return Math.round(v * 100) / 100; };
      var sb = mo.sb[2], suT = mo.su[2];
      mo.cx = [Math.round(suT * (0.04 + rm() * 0.01)), Math.round(suT * (0.01 + rm() * 0.006))]; mo.cx.push(mo.cx[0] + mo.cx[1]);
      mo.rs = Math.round(suT * (0.055 + rm() * 0.015));
      mo.res = [mo.resources, sb ? Math.floor(rm() * 7) : 0, sb ? 2 + Math.floor(rm() * 10) : 0, mo.resources ? two(sb / mo.resources) : 0];
      mo.avg = [two(sb / nd), two(sb / (nd / 7))];
      mo.cxw = two(mo.cx[2] / (nd / 7));
      mo.wcap = [two(mo.bookH), two(mo.workH), mo.workH ? two(100 - mo.bookH / mo.workH * 100) : 100];
      mo.bcap = [two(mo.bookUsed), two(mo.bookAvail), mo.bookAvail ? two(100 - mo.bookUsed / mo.bookAvail * 100) : 100];
      mo.tr = mo.rooms.slice().sort(function (a, b) { return b[1] - a[1]; }).slice(0, 5);
      mo.ms = mo.svc.map(function (c, i) { return [SV[i], c]; }).filter(function (x) { return x[1] > 0; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 5);
      mo.lb = mo.perBranch.filter(function (x) { return x.su > 0; }).sort(function (a, b) { return b.su - a.su; }).map(function (x) { return [x.b.country + ' - ' + x.b.city + ' - ' + x.b.street, x.su]; });
      M[k] = mo; months.push(k);
    }

    // lifetime
    var life = { sb: [0, 0, 0], su: [0, 0, 0], cu: 0, rev: 0, svc: SV.map(function () { return 0; }) };
    months.forEach(function (k) { var mo = M[k]; for (var i = 0; i < 3; i++) { life.sb[i] += mo.sb[i]; life.su[i] += mo.su[i]; } life.cu += mo.cu; life.rev += mo.rev; mo.svc.forEach(function (c, i) { life.svc[i] += c; }); });
    branches.forEach(function (b) {
      var top = b.st.svc.map(function (c, i) { return [SV[i], c]; }).filter(function (x) { return x[1] > 0; }).sort(function (a, c) { return c[1] - a[1]; }).slice(0, 5);
      b.st.top = top; b.st.share = top.length && b.st.total ? (top[0][1] / b.st.total * 100).toFixed(2) + '%' : '';
    });
    life.top = life.svc.map(function (c, i) {
      var best = branches.slice().sort(function (a, b) { return b.st.svc[i] - a.st.svc[i]; })[0];
      return [SV[i], c, best && best.st.svc[i] ? best.city : ''];
    }).filter(function (x) { return x[1] > 0; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 5);

    return {
      today: today, todayKey: todayKey, opened: opened, startK: startK, curK: curK, months: months, M: M,
      branches: branches, life: life, services: SV, holidays: holidays, holidayName: holidayName
    };
  }

  // ---------- people (all fictional) ----------
  // name, permission type, country code, confirmed, account owner
  var PEOPLE = [
    ['Vesna Kralj', 'admin', '+386', 1, 1], ['Nina Zupan', 'admin', '+386', 1, 0], ['Tomislav Šarić', 'admin', '+385', 1, 0],
    ['IT operations team', 'admin', '+386', 1, 0],
    ['Urška Hribar', 'regional', '+386', 1, 0], ['Dario Knežević', 'regional', '+385', 1, 0],
    ['Maja Kovač', 'branch', '+386', 1, 0], ['Rok Zupan', 'branch', '+386', 1, 0], ['Špela Kos', 'branch', '+386', 1, 0],
    ['Gregor Jereb', 'branch', '+386', 1, 0], ['Neža Petek', 'branch', '+386', 0, 0], ['Ivana Perić', 'branch', '+385', 1, 0],
    ['Ante Radić', 'branch', '+385', 1, 0], ['Petra Lovrić', 'branch', '+385', 1, 0], ['Karlo Matić', 'branch', '+385', 0, 0],
    ['Tjaša Oblak', 'service', '+386', 1, 0], ['Miha Rozman', 'service', '+386', 1, 0], ['Lana Babić', 'service', '+385', 1, 0],
    ['Filip Vuković', 'service', '+385', 1, 0], ['Eva Koren', 'service', '+386', 0, 0],
    ['Klemen Vovk', 'optom', '+386', 1, 0], ['Iva Grgić', 'optom', '+385', 1, 0], ['Jaka Kolar', 'optom', '+386', 1, 0],
    ['Helena Pavić', 'optom', '+385', 1, 0],
    ['Bruno Tomić', 'custom', '+385', 1, 0], ['Mojca Bizjak', 'custom', '+386', 1, 0]
  ];

  window.StratumBM = { build: build, people: PEOPLE, holidays: holidays, holidayName: holidayName, services: SERVICES };
})();
