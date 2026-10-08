/* Parcels & COD: demo data generator (deterministic, relative to an anchor 'YYYY-MM-DDTHH:MM' Ljubljana time). */
(function () {
  'use strict';
  var VERSION = 1;
  function rng(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  var r2 = function (x) { return Math.round(x * 100) / 100; };
  /* naive date maths on 'YYYY-MM-DD' (UTC, no DST) */
  function dn(s) { return Math.round(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 864e5); }
  function ymd(n) { var d = new Date(n * 864e5); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function add(s, n) { return ymd(dn(s) + n); }
  function dowN(n) { return (((n + 4) % 7) + 7) % 7; }
  function dow(s) { return dowN(dn(s.slice(0, 10))); }
  function diff(a, b) { return dn(b.slice(0, 10)) - dn(a.slice(0, 10)); }
  function wdBetween(a, b) { a = dn(a.slice(0, 10)); b = dn(b.slice(0, 10)); var c = 0; for (var d = a + 1; d <= b; d++) { var w = dowN(d); if (w > 0 && w < 6) c++; } return c; }
  function addWd(s, n) { var d = dn(s.slice(0, 10)); while (n > 0) { d++; var w = dowN(d); if (w > 0 && w < 6) n--; } return ymd(d); }
  function mins(ts) { return dn(ts.slice(0, 10)) * 1440 + (+ts.slice(11, 13)) * 60 + (+ts.slice(14, 16)); }
  function fromMins(m) { var d = Math.floor(m / 1440), x = m - d * 1440; return ymd(d) + 'T' + pad(Math.floor(x / 60)) + ':' + pad(x % 60); }
  function anchorNow() {
    var p = {}; new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Ljubljana', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; });
    return p.year + '-' + p.month + '-' + p.day + 'T' + p.hour + ':00';
  }
  var util = { rng: rng, pad: pad, r2: r2, dn: dn, ymd: ymd, add: add, dow: dow, diff: diff, wdBetween: wdBetween, addWd: addWd, mins: mins, fromMins: fromMins, anchorNow: anchorNow };

  var CARRIERS = [
    { id: 'gls-si', name: 'GLS Slovenija', short: 'GLS SI', country: 'SI', k: 1, payDays: [2, 5], lag: 2, bankLag: 2, pct: 0.011, fix: 0.30, sla: 2, td: 1, pm: 1.0, lk: 0.10 },
    { id: 'dpd-si', name: 'DPD Slovenija', short: 'DPD SI', country: 'SI', k: 2, payDays: [3], lag: 3, bankLag: 2, pct: 0.009, fix: 0.35, sla: 2, td: 1, pm: 0.8, lk: 0.28 },
    { id: 'ps-si', name: 'Pošta Slovenije', short: 'Pošta SI', country: 'SI', k: 3, payDays: [1, 4], lag: 3, bankLag: 3, pct: 0.012, fix: 0.25, sla: 3, td: 2, pm: 1.2, lk: 0.05 },
    { id: 'gls-hr', name: 'GLS Hrvatska', short: 'GLS HR', country: 'HR', k: 4, payDays: [2, 5], lag: 3, bankLag: 2, pct: 0.012, fix: 0.40, sla: 3, td: 2, pm: 1.1, lk: 0.12 },
    { id: 'dpd-hr', name: 'DPD Hrvatska', short: 'DPD HR', country: 'HR', k: 5, payDays: [3], lag: 3, bankLag: 2, pct: 0.010, fix: 0.40, sla: 3, td: 2, pm: 0.9, lk: 0.30 },
    { id: 'hp-hr', name: 'Hrvatska pošta', short: 'HP HR', country: 'HR', k: 6, payDays: [1, 4], lag: 4, bankLag: 3, pct: 0.015, fix: 0.30, sla: 4, td: 3, pm: 1.6, lk: 0.04 },
    { id: 'brt-it', name: 'BRT Italia', short: 'BRT IT', country: 'IT', k: 7, payDays: [2, 4], lag: 4, bankLag: 3, pct: 0.016, fix: 0.60, sla: 5, td: 4, pm: 1.3, lk: 0.08 },
    { id: 'gls-it', name: 'GLS Italia', short: 'GLS IT', country: 'IT', k: 8, payDays: [3], lag: 4, bankLag: 3, pct: 0.015, fix: 0.55, sla: 5, td: 4, pm: 1.2, lk: 0.10 },
    { id: 'pi-it', name: 'Poste Italiane', short: 'Poste IT', country: 'IT', k: 9, payDays: [1, 5], lag: 5, bankLag: 4, pct: 0.020, fix: 0.50, sla: 6, td: 5, pm: 1.8, lk: 0.03 }
  ];
  var CARRIER_MIX = { SI: [['gls-si', 0.38], ['dpd-si', 0.30], ['ps-si', 0.32]], HR: [['gls-hr', 0.35], ['dpd-hr', 0.35], ['hp-hr', 0.30]], IT: [['brt-it', 0.40], ['gls-it', 0.30], ['pi-it', 0.30]] };
  var COD_RATE = { SI: 0.44, HR: 0.47, IT: 0.16 };
  var SHOPS = [{ id: 'asi', name: 'adrial.si', country: 'SI' }, { id: 'ahr', name: 'adrial.hr', country: 'HR' }, { id: 'ait', name: 'adrial.it', country: 'IT' }, { id: 'lens', name: 'LensDirect', country: '*' }];
  var TEAM = [{ id: 'tina', name: 'Tina K.' }, { id: 'miha', name: 'Miha P.' }, { id: 'ana', name: 'Ana R.' }, { id: 'luka', name: 'Luka B.' }];
  var NAMES = {
    SI: { f: ['Ana', 'Maja', 'Nina', 'Petra', 'Tina', 'Jure', 'Luka', 'Matej', 'Marko', 'Andrej', 'Eva', 'Tomaž'], l: ['Novak', 'Horvat', 'Kovačič', 'Krajnc', 'Zupančič', 'Potočnik', 'Mlakar', 'Vidmar', 'Kos', 'Golob'], c: ['Ljubljana', 'Maribor', 'Celje', 'Kranj', 'Koper', 'Novo mesto', 'Velenje'] },
    HR: { f: ['Ivana', 'Marija', 'Petra', 'Ivan', 'Marko', 'Josip', 'Luka', 'Katarina', 'Ante', 'Matea'], l: ['Horvat', 'Kovačević', 'Babić', 'Marić', 'Jurić', 'Knežević', 'Vuković', 'Božić', 'Pavlović'], c: ['Zagreb', 'Rijeka', 'Split', 'Osijek', 'Zadar', 'Pula', 'Varaždin'] },
    IT: { f: ['Giulia', 'Chiara', 'Sofia', 'Marco', 'Luca', 'Matteo', 'Andrea', 'Francesca', 'Paolo'], l: ['Rossi', 'Russo', 'Ferrari', 'Esposito', 'Bianchi', 'Romano', 'Colombo', 'Ricci', 'Greco'], c: ['Trieste', 'Udine', 'Verona', 'Milano', 'Padova', 'Venezia', 'Bologna'] }
  };
  var DEPOT = { SI: ['Ljubljana hub', 'Maribor depot', 'Celje depot'], HR: ['Zagreb hub', 'Rijeka depot', 'Split depot'], IT: ['Trieste hub', 'Verona hub', 'Milano hub'] };
  var FAIL = ['Recipient not at home', 'Address not found', 'Phone not answered', 'Business closed', 'Access to building blocked'];
  var STATUS = { label: 'created', collected: 'transit', transit: 'transit', out: 'out', failed: 'failed', ready: 'pickup', delivered: 'delivered', returning: 'returning', returned: 'returned', damaged: 'damaged', lost: 'lost' };
  function statusOf(ev) { for (var i = ev.length - 1; i >= 0; i--) if (ev[i].code !== 'info') return STATUS[ev[i].code]; return 'created'; }
  util.statusOf = statusOf;
  var deacc = function (s) { return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, ''); };
  function pickW(r, list) { var x = r(), a = 0; for (var i = 0; i < list.length; i++) { a += list[i][1]; if (x < a) return list[i][0]; } return list[list.length - 1][0]; }

  function simulate(r, p, c, created) {
    var ev = [], f = { dmg: r(), stall: r(), lost: r(), refuse: r(), fail: r(), after: r(), keep: r(), step: r(), c1: r(), c2: r(), c3: r() };
    var dep = DEPOT[c.country], t = mins(created);
    function push(m, code, text, loc) { ev.push({ ts: fromMins(m), code: code, text: text, loc: loc || '' }); }
    function dayAt(ymdS, h, mi) { return dn(ymdS) * 1440 + h * 60 + mi; }
    function nextDay(m, n) { var d = Math.floor(m / 1440); for (var i = 0; i < (n || 1); i++) { d++; if (dowN(d) === 0) d++; } return d; }
    var m = t + 10 + Math.floor(r() * 100);
    push(m, 'label', 'Label created, shipment registered', 'Warehouse Ljubljana');
    push(m + 3, 'info', 'Recipient notified by e-mail', '');
    var cd = fromMins(t).slice(0, 10), same = f.c1 < 0.3 && dowN(dn(cd)) > 0 && dowN(dn(cd)) < 6 && +created.slice(11, 13) < 11;
    var cday = same ? cd : addWd(cd, 1);
    m = dayAt(cday, 15 + Math.floor(f.c2 * 2), Math.floor(f.c3 * 60));
    push(m, 'collected', 'Picked up from sender', 'Warehouse Ljubljana');
    var steps = Math.max(1, Math.round(c.td * (0.6 + f.step * 0.8))), stallAt = f.stall < 0.02 + 0.008 * c.pm ? 1 + Math.floor(f.step * steps) : -1;
    var dmgAt = f.dmg < 0.0035 ? 1 + Math.floor(f.step * steps) : -1;
    for (var i = 1; i <= steps; i++) {
      m = nextDay(m, 1) * 1440 + 120 + Math.floor((i * 97 + f.step * 300) % 240);
      if (i === stallAt) {
        if (f.lost < 0.4) push(m + 6 * 1440 + Math.floor(f.step * 2880), 'lost', 'Declared lost by carrier', '');
        return ev;
      }
      if (i === dmgAt) { push(m, 'damaged', 'Damaged in handling, shipment stopped', dep[i % dep.length]); return ev; }
      push(m, 'transit', 'Arrived at ' + dep[(i + p.n) % dep.length], dep[(i + p.n) % dep.length]);
    }
    function ret(mm, td) { push(mm, 'returning', 'Return to sender started', ''); push(mm + (td + 1) * 1440, 'returned', 'Returned to sender', 'Warehouse Ljubljana'); }
    var pt = ['Parcel shop', 'Post office', 'Parcel shop'][p.n % 3] + ' ' + p.city;
    function ready(mm, txt, loc) {
      push(mm, 'ready', txt, loc);
      if (f.keep < 0.88) push(mm + (1 + Math.floor(f.c1 * 8)) * 1440 + Math.floor(f.c2 * 600), 'delivered', 'Collected by recipient', loc);
      else ret(mm + 10 * 1440, c.td);
    }
    if (p.kind === 'locker') {
      m = nextDay(m, 1) * 1440 + 480 + Math.floor(f.c3 * 240);
      var lk = 'Locker ' + p.city + ' #' + (100 + p.n % 40);
      ready(m, 'Parcel placed in locker, code sent', lk);
      return ev;
    }
    m = nextDay(m, 1) * 1440 + 420 + Math.floor(f.c1 * 120);
    push(m, 'out', 'Out for delivery', dep[p.n % dep.length]);
    push(m + 5, 'info', 'SMS with delivery window sent', '');
    var refuse = f.refuse < (p.cod ? 0.065 : 0.022);
    if (refuse) { push(m + 240 + Math.floor(f.c2 * 360), 'failed', 'Recipient refused delivery', p.city); ret(nextDay(m, 1) * 1440 + 600, c.td); return ev; }
    if (f.fail < 0.09) {
      push(m + 240 + Math.floor(f.c2 * 360), 'failed', FAIL[p.n % FAIL.length], p.city);
      var m2 = nextDay(m, 1) * 1440 + 420;
      if (f.after < 0.5) { push(m2, 'out', 'Out for delivery', dep[p.n % dep.length]); push(m2 + 300 + Math.floor(f.c3 * 400), 'delivered', 'Delivered to recipient', p.city); }
      else if (f.after < 0.75) ready(m2 + 120, 'Left at ' + pt + ', notice sent', pt);
      else { push(m2, 'out', 'Out for delivery', dep[p.n % dep.length]); push(m2 + 400, 'failed', FAIL[(p.n + 1) % FAIL.length], p.city); ret(nextDay(m2, 1) * 1440 + 600, c.td); }
      return ev;
    }
    push(m + 200 + Math.floor(f.c2 * 640), 'delivered', 'Delivered to recipient', p.city);
    return ev;
  }

  function generate(anchor) {
    var r = rng(0xC0D5A1), today = anchor.slice(0, 10), parcels = [], used = {}, n = 0, byC = {};
    CARRIERS.forEach(function (c) { byC[c.id] = c; });
    for (var off = 59; off >= 0; off--) {
      var day = add(today, -off), w = dow(day), cnt = w === 0 ? 2 + Math.floor(r() * 4) : w === 6 ? 4 + Math.floor(r() * 5) : 29 + Math.floor(r() * 11);
      for (var i = 0; i < cnt; i++) {
        var created = day + 'T' + pad(7 + Math.floor(r() * 13)) + ':' + pad(Math.floor(r() * 60));
        var cc = pickW(r, [['SI', 0.45], ['HR', 0.40], ['IT', 0.15]]), c = byC[pickW(r, CARRIER_MIX[cc])], N = NAMES[cc];
        var kind = r() < c.lk ? 'locker' : 'home', cod = r() < COD_RATE[cc] * (kind === 'locker' ? 0.75 : 1);
        var value = r2(24 + Math.pow(r(), 1.7) * 330), fn = N.f[Math.floor(r() * N.f.length)], ln = N.l[Math.floor(r() * N.l.length)];
        var city = N.c[Math.floor(r() * N.c.length)], shop = r() < 0.22 ? 'lens' : (cc === 'SI' ? 'asi' : cc === 'HR' ? 'ahr' : 'ait');
        var no; do { no = String([3, 5, 7, 9][Math.floor(r() * 4)]) + String(10000 + Math.floor(r() * 90000)); } while (used[no]); used[no] = 1;
        var trk = c.id.slice(0, 3).toUpperCase().replace('-', '') + String(Math.floor(r() * 1e11)).padStart(11, '0');
        var p = { id: 'p' + (n + 1), n: n, no: no, track: trk, carrier: c.id, cc: cc, created: created, name: fn + ' ' + ln, email: deacc(fn) + '.' + deacc(ln) + (Math.floor(r() * 90) + 10) + '@example.com', city: city, shop: shop, kind: kind, weight: r2(0.2 + r() * 1.1), value: value, cod: cod ? value : 0 };
        p.ev = simulate(r, p, c, created).filter(function (e) { return e.ts <= anchor; });
        if (created > anchor) continue;
        n++; p.n = n - 1; parcels.push(p);
      }
    }
    /* payout batches */
    var r3 = rng(0xB47C42), pend = {}, bats = [];
    CARRIERS.forEach(function (c) { pend[c.id] = []; });
    parcels.forEach(function (p) {
      var q = r3(), q2 = r3(), q3 = r3(), q4 = r3(), q5 = r3(); if (!p.cod) return;
      var st = statusOf(p.ev), base = null, last = p.ev[p.ev.length - 1];
      if (st === 'delivered') base = last.ts.slice(0, 10);
      else if (st === 'returned' && q5 < 0.16) base = last.ts.slice(0, 10);
      if (!base || q < 0.03) return;
      var paid = q2 < 0.02 ? r2(p.cod * (0.5 + q3 * 0.4)) : p.cod, c = byC[p.carrier];
      pend[p.carrier].push({ pid: p.id, base: base, expected: p.cod, paid: paid, fee: r2(p.cod * c.pct + c.fix + (q4 < 0.012 ? 2 + Math.floor(q3 * 4) : 0)), xfee: q4 < 0.012 });
    });
    CARRIERS.forEach(function (c) {
      var list = pend[c.id].sort(function (a, b) { return a.base < b.base ? -1 : a.base > b.base ? 1 : 0; });
      for (var d = add(today, -59); d <= today; d = add(d, 1)) {
        if (c.payDays.indexOf(dow(d)) < 0) continue;
        var take = list.filter(function (x) { return !x.done && wdBetween(x.base, d) >= c.lag; });
        if (!take.length) continue;
        take.forEach(function (x) { x.done = 1; });
        var bank = addWd(d, c.bankLag), gross = 0, fees = 0;
        var items = take.map(function (x) { gross += Math.round(x.paid * 100); fees += Math.round(x.fee * 100); return { pid: x.pid, expected: x.expected, paid: x.paid, fee: x.fee, xfee: x.xfee }; });
        bats.push({ carrier: c.id, payDate: d, bankDate: bank, onBank: bank <= today, items: items, gross: gross / 100, fees: fees / 100, net: (gross - fees) / 100 });
      }
    });
    bats.sort(function (a, b) { return a.payDate < b.payDate ? -1 : a.payDate > b.payDate ? 1 : a.carrier < b.carrier ? -1 : 1; });
    bats.forEach(function (b, i) { b.id = 'b' + (i + 1); b.ref = 'COD-' + b.payDate.replace(/-/g, '') + '-' + b.carrier.toUpperCase().replace('-', ''); });
    return { anchor: anchor, parcels: parcels, batches: bats };
  }
  window.ParcelsData = { VERSION: VERSION, CARRIERS: CARRIERS, SHOPS: SHOPS, TEAM: TEAM, STATUS: STATUS, generate: generate, simulate: simulate, util: util };
})();
