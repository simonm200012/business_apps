/* Time & leave demo data (Business Apps). Every person here is fictional; e-mails are @example.com.
 * generate(today) builds Nordvik Distribucija d.o.o., the wholesaler from the Cash forecast demo: 36 employees in
 * Ljubljana (HQ), Maribor and Zagreb; leave for last year and this year (summer holidays in July and August, school
 * holidays, Christmas), sick leave, special leave, training, remote days and business trips; 8 pending requests, four of
 * them with conflicts; and clock events for the last 8 weeks with a handful of anomalies to fix. Approved planned
 * absences never break a team's minimum presence and no one's balance goes negative. Dates are relative to `today`
 * (Europe/Ljubljana) and the same `today` always gives the same data (seeded random numbers). UMD, so it loads in Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.LeaveData = factory(root.LeaveEngine);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';
  var VERSION = 1;

  function rng(seed) {
    var a = seed >>> 0;
    var f = function () { a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    f.int = function (lo, hi) { return Math.floor(lo + (hi - lo + 1) * f()); };
    f.pick = function (arr) { return arr[Math.floor(f() * arr.length)]; };
    return f;
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function ascii(s) { return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D'); }

  var COMPANY = { name: 'Nordvik Distribucija d.o.o.', short: 'Nordvik', what: 'Wholesale of heating, plumbing and electrical supplies',
    address: 'Tovarniška cesta 14, 1000 Ljubljana', branchHr: 'Nordvik Distribucija d.o.o., podružnica Zagreb', addressHr: 'Radnička cesta 101, 10000 Zagreb' };
  var LOCATIONS = [
    { id: 'LJ', name: 'Ljubljana HQ', short: 'Ljubljana', country: 'SI' },
    { id: 'MB', name: 'Maribor branch', short: 'Maribor', country: 'SI' },
    { id: 'ZG', name: 'Zagreb branch', short: 'Zagreb', country: 'HR' }
  ];
  var TEAMS = [
    { id: 'sales', name: 'Sales', location: 'LJ', min: 3 },
    { id: 'purchasing', name: 'Purchasing', location: 'LJ', min: 1 },
    { id: 'finance', name: 'Finance & admin', location: 'LJ', min: 1 },
    { id: 'warehouse', name: 'Warehouse', location: 'LJ', min: 6 },
    { id: 'drivers', name: 'Delivery drivers', location: 'LJ', min: 3 },
    { id: 'maribor', name: 'Counter sales Maribor', location: 'MB', min: 1 },
    { id: 'zagreb', name: 'Sales & warehouse Zagreb', location: 'ZG', min: 1 }
  ];
  // age = age reached this year; here = years with the company (start = that many years ago on sd);
  // joiner = started about that many days ago this year; leaver = leaves at the end of next month;
  // at = usual start time; shift = warehouse rotation (A 6:00–14:00, B 13:00–21:00, swapping every week)
  var ROSTER = [
    { first: 'Andrej', last: 'Novak', team: 'sales', role: 'Head of sales', hours: 40, age: 48, kids: 1, prior: 9, here: 14, bd: '03-14', sd: '04-01', at: 450, mgr: true, trips: 1 },
    { first: 'Katja', last: 'Kralj', team: 'sales', role: 'Key account manager', hours: 40, age: 36, kids: 2, prior: 4, here: 8, bd: '11-02', sd: '09-01', at: 480, trips: 1, remote: 3 },
    { first: 'Matej', last: 'Potočnik', team: 'sales', role: 'Sales representative', hours: 40, age: 33, kids: 1, prior: 3, here: 5, bd: '06-21', sd: '02-01', at: 465, trips: 1 },
    { first: 'Urška', last: 'Vidmar', team: 'sales', role: 'Sales representative', hours: 40, age: 31, kids: 1, prior: 2, here: 4, bd: '01-09', sd: '05-02', at: 480 },
    { first: 'Gregor', last: 'Kos', team: 'sales', role: 'Sales representative', hours: 40, age: 27, kids: 0, prior: 2, joiner: 225, bd: '08-30', at: 480, trips: 1 },
    { first: 'Nika', last: 'Zajc', team: 'sales', role: 'Inside sales', hours: 30, age: 39, kids: 2, prior: 10, here: 6, bd: '04-17', sd: '03-01', at: 510, remote: 5 },
    { first: 'Rok', last: 'Horvat', team: 'purchasing', role: 'Head of purchasing', hours: 40, age: 57, kids: 0, prior: 15, here: 18, bd: '09-05', sd: '01-15', at: 435, mgr: true, trips: 1, remote: 5 },
    { first: 'Špela', last: 'Golob', team: 'purchasing', role: 'Buyer', hours: 40, age: 42, kids: 1, prior: 9, here: 10, bd: '12-12', sd: '06-01', at: 450, remote: 3 },
    { first: 'Luka', last: 'Turk', team: 'purchasing', role: 'Buyer', hours: 40, age: 29, kids: 0, prior: 3, here: 3, bd: '02-26', sd: '10-01', at: 480, leaver: true, remote: 1 },
    { first: 'Mojca', last: 'Hribar', team: 'finance', role: 'Head of finance and administration', hours: 40, age: 51, kids: 1, prior: 12, here: 15, bd: '07-08', sd: '03-01', at: 450, mgr: true, remote: 5, closing: true },
    { first: 'Petra', last: 'Mlakar', team: 'finance', role: 'HR and payroll', hours: 40, age: 45, kids: 2, prior: 11, here: 9, bd: '10-23', sd: '09-01', at: 465, hr: true, remote: 3 },
    { first: 'Tina', last: 'Zupan', team: 'finance', role: 'Accountant', hours: 40, age: 35, kids: 1, prior: 6, here: 7, bd: '05-19', sd: '02-01', at: 450, me: true, remote: 5, closing: true },
    { first: 'Nina', last: 'Kovačič', team: 'finance', role: 'Office administrator', hours: 30, age: 28, kids: 0, prior: 2, here: 3, bd: '03-03', sd: '11-01', at: 480 },
    { first: 'Boris', last: 'Krajnc', team: 'warehouse', role: 'Warehouse manager', hours: 40, age: 60, kids: 0, prior: 14, here: 20, bd: '01-27', sd: '04-01', at: 420, mgr: true },
    { first: 'Dejan', last: 'Petrović', team: 'warehouse', role: 'Warehouse operative', hours: 40, age: 44, kids: 2, prior: 12, here: 11, bd: '10-02', sd: '05-01', shift: 0 },
    { first: 'Marko', last: 'Bizjak', team: 'warehouse', role: 'Forklift operator', hours: 40, age: 38, kids: 1, prior: 9, here: 7, bd: '08-11', sd: '03-01', shift: 1 },
    { first: 'Aleš', last: 'Kavčič', team: 'warehouse', role: 'Order picker', hours: 40, age: 31, kids: 1, prior: 4, here: 5, bd: '12-01', sd: '09-01', shift: 0 },
    { first: 'Jure', last: 'Rozman', team: 'warehouse', role: 'Order picker', hours: 40, age: 23, kids: 0, prior: 1, joiner: 160, bd: '05-30', shift: 1 },
    { first: 'Samir', last: 'Hodžić', team: 'warehouse', role: 'Forklift operator', hours: 40, age: 41, kids: 3, prior: 10, here: 9, bd: '04-04', sd: '06-01', shift: 0 },
    { first: 'Primož', last: 'Zorman', team: 'warehouse', role: 'Warehouse operative', hours: 40, age: 63, kids: 0, prior: 30, here: 12, bd: '02-14', sd: '01-03', shift: 1 },
    { first: 'Tadej', last: 'Kolar', team: 'warehouse', role: 'Goods-in clerk', hours: 40, age: 34, kids: 1, prior: 5, here: 6, bd: '07-22', sd: '04-01', shift: 0 },
    { first: 'Mitja', last: 'Oblak', team: 'warehouse', role: 'Order picker', hours: 30, age: 26, kids: 0, prior: 1, here: 2, bd: '11-15', sd: '02-01', shift: 1 },
    { first: 'Sanja', last: 'Vovk', team: 'warehouse', role: 'Dispatch clerk', hours: 40, age: 47, kids: 1, prior: 15, here: 13, bd: '06-06', sd: '09-01', at: 420, disability: true },
    { first: 'Zoran', last: 'Jovanović', team: 'drivers', role: 'Transport lead', hours: 40, age: 50, kids: 2, prior: 16, here: 12, bd: '03-29', sd: '05-01', at: 330, mgr: true, driver: true },
    { first: 'Bojan', last: 'Kokalj', team: 'drivers', role: 'Delivery driver', hours: 40, age: 62, kids: 0, prior: 25, here: 15, bd: '09-18', sd: '03-01', at: 315, driver: true },
    { first: 'Erik', last: 'Pirc', team: 'drivers', role: 'Delivery driver', hours: 40, age: 37, kids: 2, prior: 8, here: 6, bd: '12-24', sd: '08-01', at: 345, driver: true },
    { first: 'Tomaž', last: 'Erjavec', team: 'drivers', role: 'Delivery driver', hours: 40, age: 45, kids: 1, prior: 13, here: 8, bd: '04-11', sd: '02-01', at: 360, driver: true },
    { first: 'Klemen', last: 'Medved', team: 'drivers', role: 'Delivery driver', hours: 40, age: 25, kids: 0, prior: 2, joiner: 100, bd: '10-07', at: 330, driver: true },
    { first: 'Darja', last: 'Košir', team: 'maribor', role: 'Branch manager', hours: 40, age: 46, kids: 2, prior: 12, here: 10, bd: '05-05', sd: '04-01', at: 420, mgr: true },
    { first: 'Jan', last: 'Rajh', team: 'maribor', role: 'Counter sales', hours: 40, age: 30, kids: 0, prior: 4, here: 4, bd: '01-31', sd: '06-01', at: 420 },
    { first: 'Alenka', last: 'Ferk', team: 'maribor', role: 'Counter sales', hours: 20, age: 56, kids: 0, prior: 22, here: 6, bd: '08-19', sd: '10-01', at: 420 },
    { first: 'Ivana', last: 'Babić', team: 'zagreb', role: 'Branch manager', hours: 40, age: 43, kids: 2, prior: 10, here: 7, bd: '02-02', sd: '03-01', at: 480, mgr: true },
    { first: 'Marko', last: 'Kovačević', team: 'zagreb', role: 'Sales representative', hours: 40, age: 35, kids: 1, prior: 6, here: 5, bd: '06-15', sd: '09-01', at: 480, trips: 1, remote: 3 },
    { first: 'Ana', last: 'Marić', team: 'zagreb', role: 'Sales representative', hours: 40, age: 29, kids: 0, prior: 3, here: 3, bd: '09-09', sd: '04-01', at: 510, remote: 3 },
    { first: 'Tomislav', last: 'Jurić', team: 'zagreb', role: 'Warehouse operative', hours: 40, age: 40, kids: 2, prior: 12, here: 6, bd: '11-28', sd: '05-01', at: 420 },
    { first: 'Josip', last: 'Knežević', team: 'zagreb', role: 'Warehouse and delivery', hours: 40, age: 59, kids: 0, prior: 28, here: 9, bd: '03-16', sd: '02-01', at: 390 }
  ];
  // the shift rota (Settings → shifts A 6:00–14:00, B 13:00–21:00, A6/B6 the 6-hour versions, D 7:00–15:00, E 5:30–13:30): the warehouse rotation
  // swaps A and B every week, as the clock events below do; drivers start early; the warehouse manager and dispatch work days
  function usualShiftOf(x) {
    var a = x.hours < 40 ? 'A6' : 'A', b = x.hours < 40 ? 'B6' : 'B'; // part-timers work 6-hour shifts
    return x.shift !== undefined ? (x.shift ? b + '/' + a : a + '/' + b) : x.driver ? 'E' : x.team === 'warehouse' ? 'D' : '';
  }
  /** usual shifts for demo data saved before the rota existed: matched by name, only for Nordvik's own roster */
  function usualShifts(db) {
    var out = {};
    if (!db || !db.company || db.company.name !== COMPANY.name) return out;
    ROSTER.forEach(function (x) { var s = usualShiftOf(x); if (s) out[x.first + ' ' + x.last] = s; });
    return out;
  }
  var TRIP_NOTES = ['Customer visits in Koper and Nova Gorica', 'Supplier visit in Graz', 'Installer trade fair', 'Customer visits in Celje and Velenje', 'Product training at a supplier', 'Customer visits in Rijeka and Pula', 'Key account meeting in Kranj'];

  function generate(today) {
    var r = rng(0x7E4A5E), Y = E.yearOf(today), Y0 = Y - 1, A = E.addDays;
    var settings = E.defaultSettings();
    var db = {
      version: VERSION, generatedFor: today, since: Y0 + '-01-01', clockSince: A(today, -56),
      company: { name: COMPANY.name, short: COMPANY.short, what: COMPANY.what, address: COMPANY.address, branchHr: COMPANY.branchHr, addressHr: COMPANY.addressHr },
      locations: LOCATIONS.map(function (l) { return { id: l.id, name: l.name, short: l.short, country: l.country }; }),
      teams: [], people: [], requests: [], clock: [], audit: [], settings: settings, log: []
    };

    // a bridge day: the next Slovenian holiday on a Tuesday or Thursday gets the Monday before or the Friday after off
    (function () {
      var hs = E.holidays('SI', Y).concat(E.holidays('SI', Y + 1)), all = {};
      hs.forEach(function (h) { all[h.date] = h; });
      for (var i = 0; i < hs.length; i++) {
        var h = hs[i];
        if (h.date <= A(today, 7) || h.date > A(today, 370)) continue;
        var wd = E.isoDow(h.date), b = wd === 2 ? A(h.date, -1) : wd === 4 ? A(h.date, 1) : null;
        if (b && !all[b]) { settings.companyDays.push({ id: 'cd2', name: 'Bridge day (' + h.name + ')', date: b, half: false, country: 'SI' }); return; }
      }
    })();

    // ── people and teams ──
    var teamBy = {}, prof = {};
    TEAMS.forEach(function (t) { var x = { id: t.id, name: t.name, location: t.location, min: t.min, managerId: '' }; db.teams.push(x); teamBy[t.id] = x; });
    var hasHol = function (d) { return E.holidays('SI', E.yearOf(d)).some(function (h) { return h.date === d; }); };
    function weekdayOnOrAfter(d) { while (E.isoDow(d) > 5 || hasHol(d)) d = A(d, 1); return d; }
    function joinerStart(n) {
      var d = A(today, -n), y0 = Y + '-01-01';
      if (d < y0) d = y0;
      d = E.isoDow(d) === 1 ? d : A(E.mondayOf(d), 7);
      if (d > A(today, -7)) d = E.mondayOf(A(today, -7));
      if (d < y0) d = y0;
      return weekdayOnOrAfter(d);
    }
    var leaverEnd = (function () { var e = E.monthEnd(A(today, 30).slice(0, 7)); return E.yearOf(e) === Y && e > today ? e : ''; })();
    ROSTER.forEach(function (x, i) {
      var id = 'p' + pad2(i + 1), team = teamBy[x.team];
      var p = {
        id: id, first: x.first, last: x.last, name: x.first + ' ' + x.last, team: x.team, location: team.location, role: x.role,
        email: (ascii(x.first) + '.' + ascii(x.last)).toLowerCase() + '@example.com', hours: x.hours, workDays: [1, 2, 3, 4, 5],
        start: x.joiner ? joinerStart(x.joiner) : (Y - x.here) + '-' + x.sd, end: x.leaver ? leaverEnd : '',
        birth: (Y - x.age) + '-' + x.bd, children: x.kids, disability: !!x.disability, priorYears: x.prior,
        carry: {}, carryUntil: {}, hr: !!x.hr, shift: usualShiftOf(x)
      };
      if (x.mgr) team.managerId = id;
      db.people.push(p);
      prof[id] = x;
    });
    var P = {}, byName = {};
    db.people.forEach(function (p) { P[p.id] = p; byName[p.first + ' ' + p.last] = p; });
    function who(name) { return byName[name]; }
    var me = db.people.filter(function (p) { return prof[p.id].me; })[0], hr = db.people.filter(function (p) { return p.hr; })[0];
    // opening balances for the first year in the data, as HR entered them
    db.people.forEach(function (p) { if (p.start < Y0 + '-01-01') p.carry[Y0] = p === me ? 3 : r.int(0, 4); });

    var M = E.model(db, today);
    function approverOf(p) { var t = teamBy[p.team]; return t.managerId && t.managerId !== p.id ? t.managerId : (p.id === hr.id ? teamBy.finance.managerId : hr.id); }

    // ── bookkeeping for placing requests ──
    var occ = {}, awayP = {}, capMemo = {}, seq = 0, keep = {};
    db.people.forEach(function (p) { occ[p.id] = {}; });
    db.teams.forEach(function (t) { awayP[t.id] = {}; });
    // presence in people, as the engine counts it: everyone scheduled counts 1, half a day of leave counts half
    function cap(team, d) {
      var k = team + d;
      if (capMemo[k] === undefined) capMemo[k] = M.members[team].reduce(function (s, m) { return s + (E.dayInfo(M, m, d).frac > 0 ? 1 : 0); }, 0);
      return capMemo[k];
    }
    function share(p, x) { return x.value / E.dayInfo(M, p, x.date).frac; }
    function free(p, from, to) { for (var d = from; d <= to; d = A(d, 1)) if (occ[p.id][d]) return false; return true; }
    function minOk(p, days) {
      var t = teamBy[p.team];
      return days.every(function (x) { return cap(p.team, x.date) - (awayP[p.team][x.date] || 0) - share(p, x) >= t.min - 1e-9; });
    }
    function blackoutHit(p, days) {
      return (settings.blackouts || []).some(function (b) {
        if (b.team && b.team !== p.team) return false;
        return days.some(function (x) { var y = E.yearOf(x.date); return E.blackoutRanges(b, y).concat(E.blackoutRanges(b, y - 1)).some(function (g) { return x.date >= g[0] && x.date <= g[1]; }); });
      });
    }
    function planned(x) { return x.status === 'approved' && E.TYPE[x.type].away && x.type !== 'sick'; }
    function stampAt(d, min) { return d + 'T' + pad2(Math.floor(min / 60)) + ':' + pad2(min % 60); }
    function mk(p, type, from, to, o) {
      o = o || {};
      var status = o.status || 'approved', T = E.TYPE[type];
      var created = o.created || E.minD(A(from, -(o.lead != null ? o.lead : r.int(6, 40))), A(today, -r.int(0, 3)));
      if (created > today) created = today;
      var createdAt = stampAt(created, r.int(7 * 60, 15 * 60)), by = o.by || p.id;
      var x = { id: 'r' + (++seq), personId: p.id, type: type, from: from, to: to, halfStart: !!o.halfStart, halfEnd: !!o.halfEnd, reason: o.reason || '',
        note: o.note || '', status: status, createdAt: createdAt, createdBy: by, decidedAt: '', decidedBy: '', comment: o.comment || '', history: [] };
      x.history.push({ at: createdAt, by: by, action: by === p.id ? 'requested' : 'recorded', text: '' });
      if (status !== 'pending' && (T.approval || status !== 'approved')) {
        var dd = E.minD(A(created, r.int(0, 2)), today), dAt = stampAt(dd, r.int(8 * 60, 16 * 60));
        if (dAt < createdAt) dAt = createdAt;
        var dBy = status === 'cancelled' ? p.id : (o.decidedBy || approverOf(p));
        x.decidedAt = dAt; x.decidedBy = dBy;
        x.history.push({ at: dAt, by: dBy, action: status, text: o.comment || '' });
      }
      return x;
    }
    function add(x) {
      E.addRequest(M, x);
      if (x.status === 'approved' || x.status === 'pending') for (var d = x.from; d <= x.to; d = A(d, 1)) occ[x.personId][d] = x.id;
      if (planned(x)) { var p = P[x.personId]; E.requestDays(M, x).forEach(function (y) { awayP[p.team][y.date] = (awayP[p.team][y.date] || 0) + share(p, y); }); }
      return x;
    }
    function remove(x) {
      db.requests.splice(db.requests.indexOf(x), 1);
      M.req[x.personId].splice(M.req[x.personId].indexOf(x), 1);
      if (planned(x)) { var p = P[x.personId]; E.requestDays(M, x).forEach(function (y) { awayP[p.team][y.date] -= share(p, y); }); }
      for (var d = x.from; d <= x.to; d = A(d, 1)) if (occ[x.personId][d] === x.id) delete occ[x.personId][d];
      E.touch(M);
    }
    function workday(p, d) { return E.dayInfo(M, p, d).frac === 1; }
    function nextWork(p, d) { for (var i = 0; i < 20 && !workday(p, d); i++) d = A(d, 1); return d; }
    function prevWork(p, d) { for (var i = 0; i < 20 && !workday(p, d); i++) d = A(d, -1); return d; }
    function endAfter(p, start, n) {
      var c = 0, d = start;
      for (var k = 0; k < 90; k++) { var f = E.dayInfo(M, p, d).frac; if (f > 0) { c += f; if (c >= n - 1e-9) return d; } d = A(d, 1); }
      return null;
    }
    /** place a request if the dates are free, the team keeps its minimum and (for leave) no blackout is hit */
    function tryPlace(p, type, from, to, o) {
      if (!from || !to || to < from || !E.employedOn(p, from) || !E.employedOn(p, to) || !free(p, from, to)) return null;
      var x = mk(p, type, from, to, o), days = E.requestDays(M, x);
      if (!days.length) return null;
      if (planned(x) && !minOk(p, days)) return null;
      if (E.TYPE[type].away && type !== 'sick' && blackoutHit(p, days)) return null;
      return add(x);
    }
    function fixed(p, type, from, to, o) { var x = tryPlace(p, type, from, to, o); if (x) keep[x.id] = 1; return x; }
    function holidayFreeWeek(m) { for (var i = 0; i < 10; i++) { var ok = true; for (var k = 0; k < 5; k++) if (hasHol(A(m, i * 7 + k))) ok = false; if (ok) return A(m, i * 7); } return m; }

    // ── long absences ──
    var urska = who('Urška Vidmar'), matej = who('Matej Potočnik'), samir = who('Samir Hodžić'), bojan = who('Bojan Kokalj'), dejan = who('Dejan Petrović');
    var parStart = weekdayOnOrAfter(Y0 + '-09-07'), parEnd = nextWork(urska, A(today, 100));
    fixed(urska, 'parental', parStart, parEnd, { status: 'approved', by: hr.id, lead: 30, note: 'Maternity leave, then parental leave' });
    urska.carryUntil[Y] = Y + '-12-31';
    var born = nextWork(matej, A(today, -120));
    fixed(matej, 'special', born, born, { reason: 'birth', note: 'Daughter born', lead: 0 });
    var pat = nextWork(matej, A(E.mondayOf(born), 7));
    fixed(matej, 'parental', pat, endAfter(matej, pat, 15), { by: hr.id, lead: 3, note: 'Paternity leave' });
    var s1 = nextWork(samir, A(today, -160));
    fixed(samir, 'sick', s1, endAfter(samir, s1, 45), { by: hr.id, lead: 0 }); // longer than 30 working days: ZZZS pays from day 31
    var s2 = nextWork(bojan, Y0 + '-10-06');
    fixed(bojan, 'sick', s2, endAfter(bojan, s2, 20), { by: hr.id, lead: 0 });
    var tomislav = who('Tomislav Jurić'), s3 = nextWork(tomislav, Y0 + '-02-09');
    fixed(tomislav, 'sick', s3, endAfter(tomislav, s3, 35), { by: hr.id, lead: 0 }); // longer than 42 days: HZZO pays from day 43
    fixed(dejan, 'sick', nextWork(dejan, A(today, -6)), nextWork(dejan, A(today, 4)), { by: hr.id, lead: 0, created: A(today, -5) });

    // ── this autumn: the situations the approval screen is for ──
    var W0 = holidayFreeWeek(A(E.mondayOf(A(today, 10)), E.isoDow(A(today, 10)) === 1 ? 0 : 7));
    var W1 = holidayFreeWeek(E.maxD(A(E.mondayOf(A(today, 21)), 7), A(W0, 7)));
    var W2 = holidayFreeWeek(A(W1, 7));
    fixed(me, 'annual', W0, A(W0, 4), { lead: 24, note: 'Autumn week off' });
    ['Primož Zorman', 'Tadej Kolar', 'Sanja Vovk', 'Mitja Oblak'].forEach(function (n, i) {
      var p = who(n); fixed(p, 'annual', A(W1, [0, 2, 1, 2][i]), A(W1, 4), { lead: r.int(20, 45) });
    });
    fixed(who('Bojan Kokalj'), 'annual', W2, A(W2, 2), { lead: 30 });
    fixed(who('Tomaž Erjavec'), 'annual', W2, A(W2, 4), { lead: 26, note: 'Family holiday' });
    var nina = who('Nina Kovačič');
    fixed(nina, 'training', A(W1, 3), A(W1, 3), { lead: 21, note: 'Office software course' });
    var pend = [];
    function pending(p, type, from, to, o) { o = o || {}; o.status = 'pending'; o.created = A(today, -r.int(1, 6)); var x = fixed(p, type, from, to, o); if (x) pend.push(x); return x; }
    // pending requests: placed before everyone's leave so nothing else lands on these dates
    var penAles = mk(who('Aleš Kavčič'), 'annual', A(W1, 2), A(W1, 4), { status: 'pending', created: A(today, -2), note: 'Family visit' });
    add(penAles); keep[penAles.id] = 1; pend.push(penAles);
    var penErik = mk(who('Erik Pirc'), 'annual', A(W2, 1), A(W2, 3), { status: 'pending', created: A(today, -1) });
    add(penErik); keep[penErik.id] = 1; pend.push(penErik);
    var xmasY = A(today, 10) <= Y + '-12-28' ? Y : Y + 1;
    var penMarko = mk(who('Marko Bizjak'), 'annual', xmasY + '-12-28', xmasY + '-12-31', { status: 'pending', created: A(today, -3), note: 'Skiing with the family' });
    add(penMarko); keep[penMarko.id] = 1; pend.push(penMarko);
    var penNina = mk(nina, 'annual', A(W1, 2), A(W1, 3), { status: 'pending', created: A(today, -1), note: 'Moving to a new flat' });
    db.requests.push(penNina); M.req[nina.id].push(penNina); E.touch(M); keep[penNina.id] = 1; pend.push(penNina); // overlaps her approved training
    occ[nina.id][penNina.from] = penNina.id;
    var halfDay = xmasY + '-12-24';
    if (!workday(me, halfDay) && E.dayInfo(M, me, halfDay).frac !== 0.5) halfDay = A(W0, 18);
    pending(me, 'annual', halfDay, halfDay, { halfEnd: true, note: 'Morning off before the holidays' });
    pending(hr, 'special', A(W2, 4), A(W2, 4), { reason: 'moving', note: 'Moving house' });
    var ana = who('Ana Marić'), anaFrom = A(today, 10) <= xmasY + '-12-21' ? xmasY + '-12-21' : A(W2, 7);
    pending(ana, 'annual', anaFrom, A(anaFrom, 2), { note: 'Christmas at home in Split' });
    pending(who('Gregor Kos'), 'trip', A(W1, 1), A(W1, 2), { note: 'Customer visits in Koper and Nova Gorica' });

    // ── special leave, training and unpaid leave ──
    function around(p, type, d, len, o) {
      for (var k = 0; k < 8; k++) {
        var s = nextWork(p, A(d, k * 2));
        var x = tryPlace(p, type, s, endAfter(p, s, len), o);
        if (x) return x;
      }
      return null;
    }
    around(who('Katja Kralj'), 'special', Y0 + '-06-11', 2, { reason: 'wedding', note: 'Own wedding' });
    around(who('Primož Zorman'), 'special', A(today, -75), 2, { reason: 'death' });
    around(who('Tadej Kolar'), 'special', A(today, -40), 1, { reason: 'moving' });
    around(who('Mitja Oblak'), 'unpaid', Y0 + '-11-10', 3, { note: 'Personal matters' });
    around(who('Alenka Ferk'), 'unpaid', A(today, -30), 1, {});
    around(me, 'training', A(today, 35), 1, { note: 'Seminar: year-end closing and tax changes' });
    around(hr, 'training', A(today, -25), 1, { note: 'Payroll and labour law update' });
    around(dejan, 'training', Y0 + '-04-14', 1, { note: 'Forklift licence refresher' });
    around(samir, 'training', A(today, -95), 1, { note: 'Forklift licence refresher' });
    around(bojan, 'training', A(today, -50), 1, { note: 'Code 95 driver training' });
    around(who('Klemen Medved'), 'training', A(today, -20), 1, { note: 'Code 95 driver training' });
    around(who('Sanja Vovk'), 'training', A(today, -60), 1, { note: 'First-aid course' });
    around(who('Ivana Babić'), 'training', Y0 + '-10-14', 2, { note: 'Leadership workshop' });
    around(who('Mojca Hribar'), 'training', Y + '-03-10', 1, { note: 'Annual accounts seminar' });

    // ── annual leave: two years, summer first, then school holidays, Christmas and single days ──
    var WINDOWS = [['07-01', '08-21', 10, 0.86], ['12-21', '12-31', 3, 0.5], ['04-20', '05-08', 3, 0.45], ['02-02', '03-06', 4, 0.35], ['10-26', '11-06', 3, 0.35], ['06-22', '09-04', 5, 0.9]];
    function annualIn(p, year) { var s = 0; (M.req[p.id] || []).forEach(function (x) { if (x.type === 'annual' && E.isActive(x)) E.requestDays(M, x).forEach(function (d) { if (E.yearOf(d.date) === year) s += d.value; }); }); return s; }
    function planYear(p, year, leftover) {
      if (!E.employedInYear(p, year)) return;
      var budget = E.entitlement(M, p, year).total + E.carryIn(M, p, year).days - leftover - annualIn(p, year);
      var used = 0, lo = E.maxD(year + '-01-05', p.start || ''), hi = E.minD(year + '-12-31', p.end || '9999');
      function block(wFrom, wTo, len, single) {
        len = Math.min(len, Math.floor(budget - used + 1e-9));
        if (len < 1) return false;
        wFrom = E.maxD(wFrom, lo); wTo = E.minD(wTo, hi);
        if (wTo < wFrom) return false;
        for (var k = 0; k < (len >= 10 ? 16 : 8); k++) {
          var s = A(wFrom, r.int(0, E.diffDays(wFrom, wTo)));
          if (len >= 5) s = E.isoDow(s) === 1 ? s : A(E.mondayOf(s), 7);
          else if (single) s = r() < 0.5 ? A(E.mondayOf(s), 4) : E.mondayOf(s);
          s = nextWork(p, s);
          var e = endAfter(p, s, len);
          if (!e || s < wFrom || e > A(wTo, 6)) continue;
          var half = single && len === 1 && r() < 0.12;
          var cand = mk(p, 'annual', s, e, { halfStart: half });
          var days = E.requestDays(M, cand), n = days.reduce(function (t, x) { return t + x.value; }, 0);
          if (!n || n > budget - used + 1e-9 || !free(p, s, e) || !minOk(p, days) || blackoutHit(p, days)) continue;
          used += n;
          if (s > today && r() > (s <= A(today, 75) ? 0.8 : 0.45)) return true; // planned, not requested yet
          add(cand);
          return true;
        }
        return false;
      }
      var split = r() < 0.2 && p !== me;
      if (p === me) { block(year + '-02-09', year + '-02-27', 2); block(year + '-04-20', year + '-05-08', 3); }
      WINDOWS.forEach(function (w, i) {
        if (i === 0 && split) { block(year + '-07-01', year + '-07-24', 5); block(year + '-08-03', year + '-08-21', 5); return; }
        if (p === me && (i === 2 || i === 3)) return;
        if (r() < w[3] || (p === me && i === 0)) block(year + '-' + w[0], year + '-' + w[1], w[2] === 10 ? 10 : r.int(Math.max(1, w[2] - 1), w[2] + 1));
      });
      for (var g = 0; g < 40 && budget - used >= 1; g++) block(year + '-01-07', year + '-12-18', r() < 0.7 ? 1 : 2, true);
    }
    function settle(p, year) {
      // no negative balances: drop the latest leave that is not part of a scenario
      for (var g = 0; g < 30 && (E.balance(M, p, year).remaining < -1e-9 || E.balance(M, p, year).current < -1e-9); g++) {
        var xs = (M.req[p.id] || []).filter(function (x) { return x.type === 'annual' && E.isActive(x) && !keep[x.id] && E.yearOf(x.to) === year; });
        if (!xs.length) break;
        remove(xs[xs.length - 1]);
      }
    }
    var order0 = db.people.slice(), order1;
    for (var i = order0.length - 1; i > 0; i--) { var j = r.int(0, i), t = order0[i]; order0[i] = order0[j]; order0[j] = t; }
    order0.forEach(function (p) { planYear(p, Y0, p === me ? 4 : r.int(0, 4)); });
    db.people.forEach(function (p) { settle(p, Y0); });
    order1 = order0.slice().reverse();
    order1.forEach(function (p) {
      var x = prof[p.id], left = p === me ? 5 : x.leaver ? 0 : r() < 0.18 ? r.int(9, 13) : r.int(1, 6);
      if (p.id === who('Aleš Kavčič').id || p.id === who('Erik Pirc').id || p.id === who('Marko Bizjak').id) left = Math.max(left, 6);
      planYear(p, Y, left);
    });
    db.people.forEach(function (p) { settle(p, Y); });

    // ── sick leave: short episodes, more of them in winter ──
    db.people.forEach(function (p) {
      [Y0, Y].forEach(function (year) {
        var u = r(), n = u < 0.32 ? 0 : u < 0.64 ? 1 : u < 0.86 ? 2 : 3;
        for (var k = 0; k < n; k++) {
          var len = r.pick([1, 1, 2, 2, 3, 3, 4, 5, 5, 8, 10]);
          if (year === Y && r() > E.diffDays(Y + '-01-01', today) / 365) continue; // only the part of this year that has passed
          for (var g = 0; g < 6; g++) {
            var m = r() < 0.5 ? r.pick([1, 2, 3, 11, 12]) : r.int(1, 12), s = nextWork(p, year + '-' + pad2(m) + '-' + pad2(r.int(1, 26)));
            var e = endAfter(p, s, len);
            if (!e || e >= A(today, -2)) continue;
            if (tryPlace(p, 'sick', s, e, { by: r() < 0.5 ? hr.id : p.id, lead: 0 })) break;
          }
        }
      });
    });

    // ── remote days and business trips ──
    var rFrom = E.mondayOf(A(today, -63)), rTo = A(today, 21);
    db.people.forEach(function (p, i) {
      var x = prof[p.id];
      if (x.remote) {
        var pref = (i % 2) ? 3 : 5;
        for (var w = rFrom; w <= rTo; w = A(w, 7)) {
          if (r() > x.remote / 10 + 0.15) continue;
          var d = A(w, pref - 1);
          if (d > rTo || !workday(p, d)) continue;
          tryPlace(p, 'remote', d, d, { lead: r.int(2, 9) });
        }
      }
      if (x.trips) {
        for (var mo = 0; mo < 24; mo++) {
          var base = E.addMonths(Y0 + '-01-10', mo);
          if (base > A(today, 30) || r() > 0.45) continue;
          var s = nextWork(p, A(E.mondayOf(A(base, r.int(0, 18))), r.int(1, 3)));
          var len = r() < 0.6 ? 1 : 2;
          tryPlace(p, 'trip', s, endAfter(p, s, len), { note: r.pick(TRIP_NOTES), lead: r.int(3, 14) });
        }
      }
    });

    // ── care for a family member (nega / njega), paid by health insurance from the first day ──
    [['Katja Kralj', -45, 3, 'Child with a fever'], ['Ivana Babić', -75, 2, 'Child with a fever'], ['Tadej Kolar', -110, 4, '']].forEach(function (c) {
      var p = who(c[0]), s = nextWork(p, A(today, c[1])), e = s && endAfter(p, s, c[2]);
      if (e && e < today) fixed(p, 'care', s, e, { by: hr.id, lead: 0, note: c[3] });
    });

    // ── declined and cancelled requests ──
    function hist(p, type, from, to, status, comment, o) {
      o = o || {}; o.status = status; o.comment = comment;
      if (!from || !to || !E.employedOn(p, from) || !E.employedOn(p, to) || from >= today) return;
      var x = mk(p, type, from, to, o);
      if (E.requestDays(M, x).length) { E.addRequest(M, x); }
    }
    hist(who('Aleš Kavčič'), 'annual', Y0 + '-12-29', Y0 + '-12-31', 'declined', 'Year-end stock count: the whole warehouse team is needed. Take 22–24 December instead?');
    hist(who('Erik Pirc'), 'annual', weekdayOnOrAfter(E.mondayOf(Y0 + '-07-13')), A(weekdayOnOrAfter(E.mondayOf(Y0 + '-07-13')), 4), 'declined', 'Two drivers are already away that week. The week after is free.');
    hist(who('Katja Kralj'), 'annual', weekdayOnOrAfter(Y0 + '-09-21'), A(weekdayOnOrAfter(Y0 + '-09-21'), 2), 'declined', 'Trade fair week: we need everyone at the stand.');
    hist(who('Jan Rajh'), 'annual', weekdayOnOrAfter(Y0 + '-12-23'), weekdayOnOrAfter(Y0 + '-12-23'), 'declined', 'One of our busiest counter days. Any other day that week is fine.');
    hist(who('Ana Marić'), 'annual', weekdayOnOrAfter(Y + '-03-09'), A(weekdayOnOrAfter(Y + '-03-09'), 3), 'declined', 'Ivana is away that week, so you need to cover the branch.');
    hist(who('Klemen Medved'), 'annual', nextWork(who('Klemen Medved'), A(today, -20)), nextWork(who('Klemen Medved'), A(today, -20)), 'declined', 'Not enough drivers that day. Swap with Tomaž?');
    hist(me, 'annual', weekdayOnOrAfter(Y + '-05-18'), A(weekdayOnOrAfter(Y + '-05-18'), 1), 'cancelled', '');
    hist(who('Marko Kovačević'), 'annual', weekdayOnOrAfter(Y0 + '-11-16'), A(weekdayOnOrAfter(Y0 + '-11-16'), 2), 'cancelled', '');
    hist(who('Nika Zajc'), 'remote', weekdayOnOrAfter(A(today, -33)), weekdayOnOrAfter(A(today, -33)), 'cancelled', '');
    hist(who('Primož Zorman'), 'annual', weekdayOnOrAfter(Y0 + '-08-24'), A(weekdayOnOrAfter(Y0 + '-08-24'), 4), 'cancelled', '');

    // ── clock events for the last 8 weeks ──
    var kseq = 0, aseq = 0, anom = {}, satStock = A(E.mondayOf(A(today, -21)), 5);
    function ev(p, at, kind, src, edited) { var e = { id: 'k' + (++kseq), personId: p.id, at: at, kind: kind, src: src }; if (edited) e.edited = true; db.clock.push(e); return e; }
    function st(d, min) { var dd = A(d, Math.floor(min / 1440)), m = ((min % 1440) + 1440) % 1440; return dd + 'T' + pad2(Math.floor(m / 60)) + ':' + pad2(m % 60); }
    function absOn(p, d) {
      var v = 0, remote = false, trip = false;
      (E.dayIndex(M, p.id)[d] || []).forEach(function (x) { if (x.r.status !== 'approved') return; if (E.TYPE[x.r.type].absence) v += x.value; if (x.r.type === 'remote') remote = true; if (x.r.type === 'trip') trip = true; });
      return { v: v, remote: remote, trip: trip };
    }
    function fullDay(p, d) { return workday(p, d) && absOn(p, d).v === 0; }
    function lastFull(p, before, n) { var d = before; for (var i = 0; i < 30; i++, d = A(d, -1)) if (d >= db.clockSince && fullDay(p, d) && (!n || fullDay(p, A(d, n)))) return d; return null; }
    var d1;
    d1 = lastFull(me, A(today, -3)); if (d1) anom[me.id + d1] = 'noOut';
    d1 = lastFull(who('Jure Rozman'), A(today, -12)); if (d1) anom[who('Jure Rozman').id + d1] = 'noOut';
    d1 = lastFull(who('Erik Pirc'), A(today, -20)); if (d1) anom[who('Erik Pirc').id + d1] = 'noOut';
    d1 = lastFull(who('Marko Bizjak'), A(today, -14), 1); if (d1) { anom[who('Marko Bizjak').id + d1] = 'late'; anom[who('Marko Bizjak').id + A(d1, 1)] = 'early'; }
    d1 = lastFull(bojan, A(today, -9), 1); if (d1) { anom[bojan.id + d1] = 'long'; anom[bojan.id + A(d1, 1)] = 'early'; }
    d1 = lastFull(who('Nika Zajc'), A(today, -6)); if (d1) anom[who('Nika Zajc').id + d1] = 'openBreak';
    d1 = lastFull(who('Luka Turk'), A(today, -9)); if (d1) anom[who('Luka Turk').id + d1] = 'skip';
    var editJure = lastFull(who('Jure Rozman'), A(today, -25)), editKlemen = lastFull(who('Klemen Medved'), A(today, -16));
    var weekendMan = ['Tadej Kolar', 'Aleš Kavčič', 'Samir Hodžić'].map(who).filter(function (p) {
      for (var d = A(satStock, -5); d <= A(satStock, 6); d = A(d, 1)) if (E.isoDow(d) <= 5 && !fullDay(p, d)) return false;
      return true;
    })[0];
    var stockCrew = M.members.warehouse.filter(function (p) { return p !== weekendMan && E.employedOn(p, satStock) && absOn(p, satStock).v === 0 && absOn(p, A(satStock, -1)).v === 0; }).slice(0, 3);
    db.people.forEach(function (p, pi) {
      var x = prof[p.id], dmin = E.dailyMin(p), allow = E.paidBreakAllowance(M, p), src = x.team === 'warehouse' || x.driver ? 'terminal' : 'app';
      for (var d = db.clockSince; d < today; d = A(d, 1)) {
        var info = E.dayInfo(M, p, d), a = absOn(p, d), frac = Math.max(0, info.frac - Math.min(a.v, info.frac)), kind = anom[p.id + d] || '';
        var weekend = (p === weekendMan && (d === satStock || d === A(satStock, 1))) || (stockCrew.indexOf(p) >= 0 && d === satStock);
        if (weekend) { var w0 = 545 + r.int(0, 8); ev(p, st(d, w0), 'in', src); ev(p, st(d, w0 + 300 + r.int(0, 15)), 'out', src); continue; }
        if (frac <= 0 || kind === 'skip') continue;
        var start, dur = Math.round(dmin * frac), extra = 0, brkLen = allow ? allow + r.int(-3, 3) : 0, brkAt;
        if (x.shift !== undefined) {
          var b = ((E.isoWeek(d) + x.shift) % 2) === 1;
          start = (b ? 780 : 360) + r.int(-10, 3);
          if (r() < 0.08) extra = r.int(60, 120);
        } else if (x.driver) {
          start = x.at + r.int(-10, 10);
          if (r() < 0.35) extra = r.int(30, 150);
          if (p.id === who('Zoran Jovanović').id && d >= A(today, -28)) extra = r.int(90, 150);
        } else {
          start = x.at + r.int(-10, 14);
          if (a.trip) { start -= 60; extra = r.int(60, 150); }
          else if (r() < 0.08) extra = r.int(30, 90);
          if (x.closing && E.diffDays(d, E.monthEnd(d.slice(0, 7))) < 4 && !a.trip) extra = r.int(45, 120);
        }
        if (kind === 'late') start = 780 + r.int(-3, 3);
        if (kind === 'early') start = (p === bojan ? 310 : 358);
        if (kind === 'long') { start = 320; extra = 480; }
        if (kind === 'late') dur = 480;
        var end = start + dur + extra + r.int(-3, 8);
        brkAt = start + Math.round((end - start) / 2) + r.int(-25, 20);
        var e1 = ev(p, st(d, start), 'in', src, d === editJure && p.id === who('Jure Rozman').id);
        if (brkLen > 0 && end - start > 150) {
          ev(p, st(d, brkAt), 'bs', src);
          if (kind !== 'openBreak') ev(p, st(d, brkAt + brkLen + (kind === 'long' ? 15 : 0)), 'be', src);
        }
        if (kind === 'noOut') continue;
        var e2 = ev(p, st(d, end), 'out', p.id === who('Klemen Medved').id && d === editKlemen ? 'edit' : src, p.id === who('Klemen Medved').id && d === editKlemen);
        if (e1.edited) {
          db.audit.push({ id: 'a' + (++aseq), personId: p.id, date: d, eventId: e1.id, action: 'change', kind: 'in', old: pad2(Math.floor((start + 14) / 60)) + ':' + pad2((start + 14) % 60), 'new': e1.at.slice(11),
            reason: 'Clocked in late at the terminal; started on time according to the shift plan.', by: teamBy.warehouse.managerId, at: st(A(d, 1), 8 * 60 + 12) });
        }
        if (e2.edited) {
          db.audit.push({ id: 'a' + (++aseq), personId: p.id, date: d, eventId: e2.id, action: 'add', kind: 'out', old: '', 'new': e2.at.slice(11),
            reason: 'Clock-out missing; end time confirmed from the delivery log.', by: teamBy.drivers.managerId, at: st(A(d, 1), 6 * 60 + 40) });
        }
      }
    });
    db.audit.sort(function (a, b) { return a.at < b.at ? -1 : 1; });
    db.personas = { employee: me.id, manager: teamBy[me.team].managerId, hr: hr.id };
    db.log.push({ at: today, text: 'Demo data created.' });
    return db;
  }

  return { VERSION: VERSION, COMPANY: COMPANY, LOCATIONS: LOCATIONS, TEAMS: TEAMS, generate: generate, usualShifts: usualShifts };
});
