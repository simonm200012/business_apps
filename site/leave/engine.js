/* Time & leave engine (Business Apps): pure rules for leave, public holidays and working time. No DOM. UMD, so it also loads in Node.
 * Dates are 'YYYY-MM-DD' strings and clock times 'YYYY-MM-DDTHH:MM' in local Central European time (Ljubljana and Zagreb),
 * compared as strings. Arithmetic is done in UTC; durations across a summer-time change follow the EU rules.
 * Every legal or company rule is a setting (defaultSettings): Slovenian (ZDR-1, ZEPDSV) and Croatian (ZOR) practice as we
 * understand it, plus clearly labelled company examples. They are defaults to check with an HR or legal advisor, not legal advice.
 *
 *   model(db, today)        indexes a document: people, teams, requests and clock events per person, with caches
 *   holidays(country, year) public holidays; Easter by the anonymous Gregorian algorithm
 *   requestDays(M, r)       the working days a request counts (half days count 0.5)
 *   entitlement / balance   annual leave with its breakdown, carry-over and its expiry, taken, planned, pending
 *   conflicts(M, r)         team minimums, the same person already away, blackout periods, balance, special-leave limits
 *   timeline / monthRecord  hours, breaks, overtime and checks from clock events
 *   ics(events, opts)       an iCalendar file of all-day events */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LeaveEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ── dates ────────────────────────────────────────────────────────────────
  var DAY = 86400000;
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }
  function toUtc(s) { return Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)); }
  function fromUtc(t) { var d = new Date(t); return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); }
  function isDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && fromUtc(toUtc(s)) === s; }
  function addDays(s, n) { return fromUtc(toUtc(s) + Math.round(n) * DAY); }
  function diffDays(a, b) { return Math.round((toUtc(b) - toUtc(a)) / DAY); } // b − a
  function dow(s) { return new Date(toUtc(s)).getUTCDay(); } // 0 = Sunday
  function isoDow(s) { return dow(s) || 7; } // 1 = Monday … 7 = Sunday
  function mondayOf(s) { return addDays(s, 1 - isoDow(s)); }
  function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); } // m is 1-based
  function addMonths(s, n) {
    var t = +s.slice(0, 4) * 12 + (+s.slice(5, 7) - 1) + n, y = Math.floor(t / 12), m = t - y * 12 + 1;
    return ymd(y, m, Math.min(+s.slice(8, 10), daysInMonth(y, m)));
  }
  function yearOf(s) { return +s.slice(0, 4); }
  function monthStart(ym) { return ym + '-01'; } // ym = 'YYYY-MM'
  function monthEnd(ym) { return ym + '-' + pad(daysInMonth(+ym.slice(0, 4), +ym.slice(5, 7))); }
  function addMonthsYm(ym, n) { return addMonths(ym + '-01', n).slice(0, 7); }
  function minD(a, b) { return a < b ? a : b; }
  function maxD(a, b) { return a > b ? a : b; }
  function isoWeek(s) {
    var d = new Date(toUtc(s)); d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    return Math.ceil(((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / DAY + 1) / 7);
  }
  /** the last day of the n-th month counted from `from` (from 15. 3. one month ends on 14. 4.; from 31. 1. it ends on 28./29. 2.) */
  function monthPeriodEnd(from, n) {
    var t = addMonths(from, n);
    return +t.slice(8, 10) < +from.slice(8, 10) ? t : addDays(t, -1);
  }
  /** full months between two dates, both included (1. 1.–31. 12. is 12) */
  function fullMonths(from, to) {
    if (!isDate(from) || !isDate(to) || to < from) return 0;
    var n = 0;
    while (n < 1200 && monthPeriodEnd(from, n + 1) <= to) n++;
    return n;
  }
  function fmtDate(s) { return isDate(s) ? +s.slice(8, 10) + '. ' + +s.slice(5, 7) + '. ' + s.slice(0, 4) : ''; }
  function fmtRange(a, b) {
    if (!b || a === b) return fmtDate(a);
    if (a.slice(0, 4) !== b.slice(0, 4)) return fmtDate(a) + ' – ' + fmtDate(b);
    if (a.slice(5, 7) !== b.slice(5, 7)) return +a.slice(8, 10) + '. ' + +a.slice(5, 7) + '. – ' + fmtDate(b);
    return +a.slice(8, 10) + '.–' + fmtDate(b);
  }
  /** sorted unique dates → [[from, to], …] of consecutive calendar days */
  function groupDates(dates) {
    var out = [];
    dates.forEach(function (d) { var last = out[out.length - 1]; if (last && addDays(last[1], 1) === d) last[1] = d; else out.push([d, d]); });
    return out;
  }
  function fmtRanges(dates) { return groupDates(dates).map(function (g) { return fmtRange(g[0], g[1]); }).join(', '); }
  function r2(x) { return Math.round(x * 100) / 100; }

  // ── clock times ──────────────────────────────────────────────────────────
  function isTime(s) { return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s); }
  function isStamp(s) { return typeof s === 'string' && s.length === 16 && s.charAt(10) === 'T' && isDate(s.slice(0, 10)) && isTime(s.slice(11)); }
  function lastSunday(y, m) { var d = ymd(y, m, daysInMonth(y, m)); return addDays(d, -dow(d)); }
  /** minutes since 1970 (UTC) of a Central European local time, with EU summer time (last Sunday of March to the last
   *  Sunday of October, switching at 01:00 UTC). In the repeated autumn hour the first (summer) one is taken. */
  function absMin(stamp) {
    var y = +stamp.slice(0, 4), local = toUtc(stamp.slice(0, 10)) / 60000 + (+stamp.slice(11, 13)) * 60 + (+stamp.slice(14, 16));
    var on = toUtc(lastSunday(y, 3)) / 60000 + 60, off = toUtc(lastSunday(y, 10)) / 60000 + 60, summer = local - 120;
    return summer >= on && summer < off ? summer : local - 60;
  }
  function minutesBetween(a, b) { return absMin(b) - absMin(a); }
  function hm(min) { min = Math.round(min); var s = min < 0 ? '−' : ''; min = Math.abs(min); return s + Math.floor(min / 60) + ':' + pad(min % 60); }
  function fmtMin(min) {
    min = Math.round(min); var s = min < 0 ? '−' : ''; min = Math.abs(min);
    var h = Math.floor(min / 60), m = min % 60;
    return s + (h && m ? h + ' h ' + m + ' min' : h ? h + ' h' : m + ' min');
  }

  // ── public holidays ──────────────────────────────────────────────────────
  /** Easter Sunday, anonymous Gregorian algorithm (Meeus/Jones/Butcher) */
  function easter(y) {
    var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25),
      g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4,
      l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
      n = h + l - 7 * m + 114;
    return ymd(y, Math.floor(n / 31), (n % 31) + 1);
  }
  // [month-day or days after Easter Sunday, English name, local name]
  var HOLIDAY_DEFS = {
    SI: [
      ['01-01', 'New Year’s Day', 'novo leto'],
      ['01-02', 'New Year holiday', 'novo leto'],
      ['02-08', 'Prešeren Day, the Slovenian Cultural Holiday', 'Prešernov dan, slovenski kulturni praznik'],
      [0, 'Easter Sunday', 'velikonočna nedelja'],
      [1, 'Easter Monday', 'velikonočni ponedeljek'],
      ['04-27', 'Day of Uprising Against Occupation', 'dan upora proti okupatorju'],
      ['05-01', 'Labour Day', 'praznik dela'],
      ['05-02', 'Labour Day holiday', 'praznik dela'],
      [49, 'Whit Sunday', 'binkoštna nedelja, binkošti'],
      ['06-25', 'Statehood Day', 'dan državnosti'],
      ['08-15', 'Assumption Day', 'Marijino vnebovzetje'],
      ['10-31', 'Reformation Day', 'dan reformacije'],
      ['11-01', 'Remembrance Day', 'dan spomina na mrtve'],
      ['12-25', 'Christmas Day', 'božič'],
      ['12-26', 'Independence and Unity Day', 'dan samostojnosti in enotnosti']
    ],
    HR: [
      ['01-01', 'New Year’s Day', 'Nova godina'],
      ['01-06', 'Epiphany', 'Bogojavljenje ili Sveta tri kralja'],
      [0, 'Easter Sunday', 'Uskrs'],
      [1, 'Easter Monday', 'Uskrsni ponedjeljak'],
      ['05-01', 'Labour Day', 'Praznik rada'],
      ['05-30', 'Statehood Day', 'Dan državnosti'],
      [60, 'Corpus Christi', 'Tijelovo'],
      ['06-22', 'Anti-Fascist Struggle Day', 'Dan antifašističke borbe'],
      ['08-05', 'Victory and Homeland Thanksgiving Day and the Day of Croatian Defenders', 'Dan pobjede i domovinske zahvalnosti i Dan hrvatskih branitelja'],
      ['08-15', 'Assumption Day', 'Velika Gospa'],
      ['11-01', 'All Saints’ Day', 'Svi sveti'],
      ['11-18', 'Remembrance Day', 'Dan sjećanja na žrtve Domovinskog rata i Dan sjećanja na žrtvu Vukovara i Škabrnje'],
      ['12-25', 'Christmas Day', 'Božić'],
      ['12-26', 'St Stephen’s Day', 'Sveti Stjepan']
    ]
  };
  var COUNTRIES = { SI: 'Slovenia', HR: 'Croatia' };
  var holCache = {};
  function holidays(country, year) {
    var k = country + year;
    if (holCache[k]) return holCache[k];
    var e = easter(year);
    var list = (HOLIDAY_DEFS[country] || []).map(function (h) {
      return { date: typeof h[0] === 'number' ? addDays(e, h[0]) : year + '-' + h[0], name: h[1], local: h[2], country: country };
    }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    holCache[k] = list;
    return list;
  }
  /** company days off for a country and year: settings.companyDays = [{ id, name, date: 'MM-DD' (every year) or
   *  'YYYY-MM-DD' (once), half, country: '' (all) | 'SI' | 'HR' }]. Paid by the company, not taken from leave. */
  function companyDays(settings, country, year) {
    return ((settings && settings.companyDays) || []).map(function (c) {
      if (!c || typeof c.date !== 'string' || (c.country && c.country !== country)) return null;
      var date = c.date.length === 5 ? year + '-' + c.date : c.date;
      if (!isDate(date) || yearOf(date) !== year) return null;
      return { id: c.id, date: date, name: c.name || 'Company day off', half: !!c.half, recurring: c.date.length === 5 };
    }).filter(Boolean).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  }

  // ── leave types and statuses ─────────────────────────────────────────────
  // away: not at the workplace (team minimums, calendar); absence: reduces the hours expected that day;
  // balance: taken from annual leave; approval: needs a manager's approval (otherwise recorded straight away);
  // payer: who pays the hours (employer, other = state or health insurance, none = unpaid).
  var TYPES = [
    { id: 'annual', name: 'Annual leave', short: 'Annual', away: true, absence: true, balance: true, approval: true, payer: 'employer', color: 'violet', sl: 'Letni dopust', hr: 'Godišnji odmor' },
    { id: 'sick', name: 'Sick leave', short: 'Sick', away: true, absence: true, balance: false, approval: false, payer: 'employer', color: 'clay', sl: 'Bolniška odsotnost', hr: 'Bolovanje' },
    // nega / njega: care for a sick family member, on a doctor's certificate; paid by health insurance from day 1 (see sickPay)
    { id: 'care', name: 'Care for a family member', short: 'Care', away: true, absence: true, balance: false, approval: false, payer: 'other', color: 'clay', sl: 'Nega družinskega člana', hr: 'Njega člana obitelji' },
    { id: 'special', name: 'Special paid leave', short: 'Special', away: true, absence: true, balance: false, approval: true, payer: 'employer', color: 'teal', sl: 'Izredni plačani dopust', hr: 'Plaćeni dopust' },
    { id: 'unpaid', name: 'Unpaid leave', short: 'Unpaid', away: true, absence: true, balance: false, approval: true, payer: 'none', color: 'grey', sl: 'Neplačana odsotnost', hr: 'Neplaćeni dopust' },
    { id: 'training', name: 'Training', short: 'Training', away: true, absence: true, balance: false, approval: true, payer: 'employer', color: 'blue', sl: 'Izobraževanje', hr: 'Obrazovanje i osposobljavanje' },
    { id: 'parental', name: 'Parental leave', short: 'Parental', away: true, absence: true, balance: false, approval: false, payer: 'other', color: 'green', sl: 'Starševski dopust', hr: 'Roditeljski dopust' },
    { id: 'remote', name: 'Remote work', short: 'Remote', away: false, absence: false, balance: false, approval: true, payer: 'employer', color: 'sky', sl: 'Delo na domu', hr: 'Rad od kuće' },
    { id: 'trip', name: 'Business trip', short: 'Trip', away: false, absence: false, balance: false, approval: true, payer: 'employer', color: 'amber', sl: 'Službena pot', hr: 'Službeni put' }
  ];
  var TYPE = {};
  TYPES.forEach(function (t) { TYPE[t.id] = t; });
  var STATUSES = { pending: 'Pending', approved: 'Approved', declined: 'Declined', cancelled: 'Cancelled' };
  function typeOf(M, id) {
    var t = TYPE[id] || TYPE.annual, o = M && M.s && M.s.types && M.s.types[id];
    if (!o) return t;
    var c = {}; Object.keys(t).forEach(function (k) { c[k] = t[k]; });
    if (typeof o.name === 'string' && o.name.trim()) c.name = o.name.trim();
    if (typeof o.approval === 'boolean') c.approval = o.approval;
    if (typeof o.away === 'boolean') c.away = o.away;
    return c;
  }
  function isActive(r) { return r && (r.status === 'approved' || r.status === 'pending'); }

  // ── settings ─────────────────────────────────────────────────────────────
  var SERVICE_EXAMPLE = [{ years: 10, days: 1 }, { years: 20, days: 2 }, { years: 30, days: 3 }];
  function defaultSettings() {
    return {
      rules: {
        // SI: ZDR-1 minimum of 4 weeks; +3 for workers aged 55+ or with a disability (once); +1 per child under 15
        SI: { base: 20, olderAge: 55, older: 3, disability: 3, perChild: 1, childAge: 15, service: SERVICE_EXAMPLE.map(copy) },
        // HR: ZOR minimum of 4 weeks; extra days come from collective agreements and company rules
        HR: { base: 20, olderAge: 55, older: 0, disability: 0, perChild: 0, childAge: 15, service: SERVICE_EXAMPLE.map(copy) }
      },
      proRata: true, rounding: 'up', carryExpiry: '06-30', carryWarnDays: 61,
      // colleagues see "Away" instead of sick, special, unpaid or parental leave; managers and HR see the reason
      privacy: true,
      types: {},
      special: { cap: 7, reasons: [
        { id: 'wedding', name: 'Own wedding', days: 2 },
        { id: 'death', name: 'Death of a close family member', days: 2 },
        { id: 'moving', name: 'Moving house', days: 1 },
        { id: 'birth', name: 'Birth of a child', days: 1 }
      ] },
      // who pays sick leave (see sickPay): the employer for the first `employerDays` of each absence, then health insurance.
      // unit: 'working' counts the person's working days, 'calendar' every day from the first; yearCap: employer days a year (0 = none)
      sickPay: {
        SI: { employerDays: 30, unit: 'working', yearCap: 120, insurer: 'ZZZS' },
        HR: { employerDays: 42, unit: 'calendar', yearCap: 0, insurer: 'HZZO' }
      },
      // shift rota: shift times, and how many minutes late or early still count as on time
      shifts: [
        { id: 'A', name: 'Morning', start: '06:00', end: '14:00' },
        { id: 'B', name: 'Afternoon', start: '13:00', end: '21:00' },
        { id: 'A6', name: 'Short morning', start: '06:00', end: '12:00' },
        { id: 'B6', name: 'Short afternoon', start: '13:00', end: '19:00' },
        { id: 'D', name: 'Day', start: '07:00', end: '15:00' },
        { id: 'E', name: 'Early', start: '05:30', end: '13:30' }
      ],
      rotaTolerance: 10,
      blackouts: [{ id: 'bo1', name: 'Year-end stock count', team: 'warehouse', from: '12-29', to: '12-31' }],
      companyDays: [{ id: 'cd1', name: 'Christmas Eve afternoon', date: '12-24', half: true, country: '' }],
      time: {
        overtimeBasis: 'daily', overtimeFrom: 15, minRestHours: 12, maxDaysInRow: 6,
        SI: { breakPaid: true, paidBreak: 30, breakFromHours: 4, breakProRata: true, week: 8, month: 20, year: 170 },
        HR: { breakPaid: true, paidBreak: 30, breakFromHours: 6, breakProRata: false, week: 10, month: 0, year: 180 }
      }
    };
  }
  function copy(o) { return JSON.parse(JSON.stringify(o)); }
  var TIME_FALLBACK = { breakPaid: true, paidBreak: 30, breakFromHours: 4, breakProRata: true, week: 8, month: 20, year: 170 };

  // ── model ────────────────────────────────────────────────────────────────
  function byFrom(a, b) { return a.from < b.from ? -1 : a.from > b.from ? 1 : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0); }
  var KIND_ORDER = { 'in': 0, bs: 1, be: 2, out: 3 };
  var KIND_NAME = { 'in': 'Start', bs: 'Break start', be: 'Break end', out: 'End' };
  function byAt(a, b) { return a.at < b.at ? -1 : a.at > b.at ? 1 : KIND_ORDER[a.kind] - KIND_ORDER[b.kind]; }
  /** Index a document. today = 'YYYY-MM-DD' (Ljubljana); caches live on the model, so build a new one after edits
   *  (or call touch(M) after changing requests or clock events in place). */
  function model(db, today) {
    var M = { db: db, s: db.settings || defaultSettings(), today: today, P: {}, T: {}, L: {}, members: {}, req: {}, clock: {},
      firstYear: isDate(db.since) ? yearOf(db.since) : 0, hc: {}, c: {} };
    (db.locations || []).forEach(function (l) { M.L[l.id] = l; });
    (db.teams || []).forEach(function (t) { M.T[t.id] = t; M.members[t.id] = []; });
    (db.people || []).forEach(function (p) { M.P[p.id] = p; M.req[p.id] = []; M.clock[p.id] = []; if (M.members[p.team]) M.members[p.team].push(p); });
    (db.requests || []).forEach(function (r) { if (M.req[r.personId]) M.req[r.personId].push(r); });
    Object.keys(M.req).forEach(function (k) { M.req[k].sort(byFrom); });
    (db.clock || []).forEach(function (c) { if (M.clock[c.personId]) M.clock[c.personId].push(c); });
    Object.keys(M.clock).forEach(function (k) { M.clock[k].sort(byAt); });
    return M;
  }
  function touch(M) { M.c = {}; }
  function addRequest(M, r) {
    if (M.db.requests.indexOf(r) < 0) M.db.requests.push(r);
    (M.req[r.personId] = M.req[r.personId] || []).push(r);
    M.req[r.personId].sort(byFrom);
    M.c = {};
  }
  function countryOf(M, p) { var l = M.L[p.location]; return (l && l.country) || p.country || 'SI'; }
  function workDays(p) { return p.workDays && p.workDays.length ? p.workDays : [1, 2, 3, 4, 5]; }
  function dailyMin(p) { return Math.round((+p.hours || 40) * 60 / workDays(p).length); }
  function employedOn(p, d) { return (!p.start || d >= p.start) && (!p.end || d <= p.end); }
  function employedInYear(p, y) { return (!p.start || p.start <= y + '-12-31') && (!p.end || p.end >= y + '-01-01'); }
  function dayMaps(M, country, year) {
    var k = country + year, h = M.hc[k];
    if (!h) {
      h = { hol: {}, comp: {} };
      holidays(country, year).forEach(function (x) { h.hol[x.date] = x; });
      companyDays(M.s, country, year).forEach(function (x) { h.comp[x.date] = x; });
      M.hc[k] = h;
    }
    return h;
  }
  /** what kind of day `d` is for person p. frac = share of a normal working day expected (0, 0.5 or 1). */
  function dayInfo(M, p, d) {
    var maps = dayMaps(M, countryOf(M, p), yearOf(d)), hol = maps.hol[d] || null, comp = maps.comp[d] || null;
    var employed = employedOn(p, d), scheduled = workDays(p).indexOf(isoDow(d)) >= 0;
    var frac = !employed || !scheduled || hol ? 0 : comp ? (comp.half ? 0.5 : 0) : 1;
    return { date: d, employed: employed, scheduled: scheduled, holiday: hol, company: comp, frac: frac };
  }

  // ── counting leave days ──────────────────────────────────────────────────
  /** the days a request counts: the person's working days that are not public holidays in their country or full
   *  company days off. A half-day start (afternoon off) or end (morning off) counts 0.5; on a one-day request either flag
   *  makes it a half day. A half company day off counts at most 0.5. */
  function requestDays(M, r) {
    var p = M.P[r.personId];
    if (!p || !isDate(r.from) || !isDate(r.to) || r.to < r.from || diffDays(r.from, r.to) > 800) return [];
    var key = r.personId + '|' + r.from + '|' + r.to + '|' + (r.halfStart ? 1 : 0) + (r.halfEnd ? 1 : 0), cache = M.c.rd || (M.c.rd = {});
    if (cache[key]) return cache[key];
    var out = [], single = r.from === r.to;
    for (var d = r.from; d <= r.to; d = addDays(d, 1)) {
      var di = dayInfo(M, p, d);
      if (!di.frac) continue;
      var v = di.frac;
      if (single ? (r.halfStart || r.halfEnd) : ((d === r.from && r.halfStart) || (d === r.to && r.halfEnd))) v = Math.min(v, 0.5);
      out.push({ date: d, value: v });
    }
    cache[key] = out;
    return out;
  }
  function countDays(M, r) { return requestDays(M, r).reduce(function (s, x) { return s + x.value; }, 0); }
  /** what a date range contains besides the counted days, to explain the count */
  function rangeInfo(M, p, from, to) {
    var o = { calDays: 0, weekend: 0, holidays: [], company: [], notEmployed: 0 };
    if (!isDate(from) || !isDate(to) || to < from || diffDays(from, to) > 800) return o;
    for (var d = from; d <= to; d = addDays(d, 1)) {
      var di = dayInfo(M, p, d);
      o.calDays++;
      if (!di.employed) o.notEmployed++;
      else if (!di.scheduled) o.weekend++;
      else if (di.holiday) o.holidays.push(di.holiday);
      else if (di.company) o.company.push(di.company);
    }
    return o;
  }
  /** date → [{ r, value }] for one person's approved and pending requests (counted days only) */
  function dayIndex(M, pid) {
    var c = M.c.di || (M.c.di = {});
    if (c[pid]) return c[pid];
    var idx = {};
    (M.req[pid] || []).forEach(function (r) {
      if (!isActive(r)) return;
      requestDays(M, r).forEach(function (x) { (idx[x.date] = idx[x.date] || []).push({ r: r, value: x.value }); });
    });
    c[pid] = idx;
    return idx;
  }
  function isAway(M, type) { return !!typeOf(M, type).away; }

  // ── who pays sick leave ──────────────────────────────────────────────────
  // Slovenia: ZDR-1 Art. 137(3) and ZZVZZ Art. 31: for an illness or injury not connected with work the employer pays the
  //   wage compensation for the first 30 working days of each absence, but for no more than 120 working days in a calendar
  //   year; from the 31st working day (or once the 120 are used) the health insurer ZZZS pays. Care for a family member
  //   (nega družinskega člana, ZZVZZ Art. 30 and 31) is paid by ZZZS from the first day.
  // Croatia: Zakon o obveznom zdravstvenom osiguranju (ZOZO, NN 80/13 and later) Art. 40: the employer pays the first 42
  //   days of sick leave, HZZO from the 43rd day; care for a family member (njega člana obitelji) is paid by HZZO from the
  //   first day. Defaults to check with payroll: we count the 42 days as calendar days, we treat back-to-back sick notes
  //   (no working day between them) as one absence, and we do not join a relapse of the same illness within a few days
  //   (ZZVZZ continuation rule) or treat work injuries separately.
  var SICK_FALLBACK = { employerDays: 30, unit: 'working', yearCap: 0, insurer: 'Health insurance' };
  function sickRules(M, p) {
    var c = countryOf(M, p), sp = (M.s && M.s.sickPay) || {}, d = sp[c] || {}, out = {};
    Object.keys(SICK_FALLBACK).forEach(function (k) { out[k] = d[k] !== undefined && d[k] !== '' ? d[k] : SICK_FALLBACK[k]; });
    out.employerDays = Math.max(0, +out.employerDays || 0); out.yearCap = Math.max(0, +out.yearCap || 0);
    out.unit = out.unit === 'calendar' ? 'calendar' : 'working';
    return out;
  }
  /** date → { payer: 'employer' | 'other', n: day of the absence, insurer } for one person's approved sick leave and care
   *  for a family member (cached). n counts working days or calendar days, as the country's rule says. */
  function sickPay(M, p) {
    var c = M.c.sp || (M.c.sp = {});
    if (c[p.id]) return c[p.id];
    var rules = sickRules(M, p), out = {}, usedYear = {};
    var list = (M.req[p.id] || []).filter(function (r) { return r.status === 'approved' && (r.type === 'sick' || r.type === 'care'); }).slice().sort(byFrom);
    list.filter(function (r) { return r.type === 'care'; }).forEach(function (r) {
      var n = 0;
      requestDays(M, r).forEach(function (x) { n += x.value; out[x.date] = { payer: 'other', n: n, insurer: rules.insurer, value: x.value }; });
    });
    // join back-to-back sick notes into one absence: no working day of the person between them
    var chains = [];
    list.filter(function (r) { return r.type === 'sick'; }).forEach(function (r) {
      var last = chains[chains.length - 1];
      if (last) {
        var gapWork = false;
        for (var d = addDays(last.to, 1); d < r.from; d = addDays(d, 1)) if (dayInfo(M, p, d).frac > 0) { gapWork = true; break; }
        if (!gapWork && r.from <= addDays(last.to, 400)) { last.reqs.push(r); if (r.to > last.to) last.to = r.to; return; }
      }
      chains.push({ from: r.from, to: r.to, reqs: [r] });
    });
    chains.forEach(function (ch) {
      var val = {};
      ch.reqs.forEach(function (r) { requestDays(M, r).forEach(function (x) { val[x.date] = Math.max(val[x.date] || 0, x.value); }); });
      var n = 0;
      for (var d = ch.from; d <= ch.to; d = addDays(d, 1)) {
        var v = val[d] || 0;
        if (rules.unit === 'calendar') n += 1; else n += v;
        if (!v) continue;
        var y = yearOf(d), used = usedYear[y] || 0;
        var employer = n <= rules.employerDays + 1e-9 && (!rules.yearCap || used + v <= rules.yearCap + 1e-9);
        if (employer) usedYear[y] = used + v;
        out[d] = { payer: employer ? 'employer' : 'other', n: n, insurer: rules.insurer, value: v };
      }
    });
    c[p.id] = out;
    return out;
  }
  /** sick-leave days in a period split by payer: { employer, insurer, care, insurerName } (working days) */
  function sickSplit(M, p, from, to) {
    var sp = sickPay(M, p), o = { employer: 0, insurer: 0, care: 0, insurerName: sickRules(M, p).insurer };
    (M.req[p.id] || []).forEach(function (r) {
      if (r.status !== 'approved' || (r.type !== 'sick' && r.type !== 'care')) return;
      requestDays(M, r).forEach(function (x) {
        if (x.date < from || x.date > to) return;
        if (r.type === 'care') { o.care += x.value; return; }
        if ((sp[x.date] || {}).payer === 'other') o.insurer += x.value; else o.employer += x.value;
      });
    });
    return o;
  }

  // ── entitlement ──────────────────────────────────────────────────────────
  function ageInYear(p, year) { return isDate(p.birth) ? year - yearOf(p.birth) : null; }
  /** years of service on 31 December of the year (or the leaving date): prior service plus full years here */
  function serviceYears(p, year) {
    var ref = year + '-12-31';
    if (p.end && p.end < ref) ref = p.end;
    var here = 0;
    if (isDate(p.start) && p.start <= ref) here = yearOf(ref) - yearOf(p.start) - (ref.slice(5) < p.start.slice(5) ? 1 : 0);
    return Math.max(0, (+p.priorYears || 0) + Math.max(0, here));
  }
  function roundDays(x, mode) {
    if (mode === 'nearest') return Math.floor(x + 0.5 + 1e-9);
    if (mode === 'half') return Math.ceil(x * 2 - 1e-9) / 2;
    return Math.ceil(x - 1e-9);
  }
  function rulesFor(M, country) {
    var R = (M.s.rules && M.s.rules[country]) || (M.s.rules && M.s.rules.SI) || defaultSettings().rules.SI;
    return R;
  }
  /** annual leave entitlement for a calendar year, with the lines that make it up */
  function entitlement(M, p, year) {
    var cache = M.c.ent || (M.c.ent = {}), key = p.id + ':' + year;
    if (cache[key]) return cache[key];
    var country = countryOf(M, p), R = rulesFor(M, country), y0 = year + '-01-01', y1 = year + '-12-31';
    var from = p.start && p.start > y0 ? p.start : y0, to = p.end && p.end < y1 ? p.end : y1;
    var res = { year: year, country: country, employed: from <= to, full: 0, total: 0, lines: [], proRata: null, age: ageInYear(p, year), service: serviceYears(p, year), from: from, to: to };
    if (from > to) { cache[key] = res; return res; }
    var wd = workDays(p).length, base = wd === 5 ? +R.base || 0 : Math.ceil((+R.base || 0) * wd / 5 - 1e-9);
    res.lines.push({ key: 'base', days: base, label: 'Minimum for a ' + wd + '-day week', src: 'law' });
    var prot = [];
    if (+R.older > 0 && res.age !== null && res.age >= +R.olderAge) prot.push({ days: +R.older, label: 'aged ' + R.olderAge + ' or older in ' + year });
    if (+R.disability > 0 && p.disability) prot.push({ days: +R.disability, label: 'disability' });
    if (prot.length) {
      var best = Math.max.apply(null, prot.map(function (x) { return x.days; }));
      var lbl = prot.map(function (x) { return x.label; }).join(' and ');
      res.lines.push({ key: 'protected', days: best, label: lbl.charAt(0).toUpperCase() + lbl.slice(1), note: prot.length > 1 ? 'counted once' : '', src: 'law' });
    }
    var kids = Math.max(0, Math.round(+p.children || 0));
    if (+R.perChild > 0 && kids > 0) res.lines.push({ key: 'children', days: +R.perChild * kids, label: kids + (kids === 1 ? ' child' : ' children') + ' under ' + R.childAge, src: 'law' });
    var tiers = (R.service || []).slice().sort(function (a, b) { return a.years - b.years; }), extra = 0;
    tiers.forEach(function (t) { if (res.service >= +t.years) extra = +t.days; });
    if (extra > 0) res.lines.push({ key: 'service', days: extra, label: res.service + ' years of service', note: 'company rule, example', src: 'company' });
    res.full = res.lines.reduce(function (s, l) { return s + l.days; }, 0);
    res.total = res.full;
    if (M.s.proRata !== false && (from > y0 || to < y1)) {
      var months = fullMonths(from, to), raw = res.full * months / 12;
      res.proRata = { months: months, raw: r2(raw), rounding: M.s.rounding || 'up' };
      res.total = roundDays(raw, M.s.rounding);
    }
    cache[key] = res;
    return res;
  }

  // ── balance and carry-over ───────────────────────────────────────────────
  function carryExpiry(M, p, year) {
    var o = p.carryUntil && p.carryUntil[year];
    if (isDate(o)) return o;
    var md = /^\d{2}-\d{2}$/.test(M.s.carryExpiry || '') ? M.s.carryExpiry : '06-30', d = year + '-' + md;
    return isDate(d) ? d : year + '-06-30';
  }
  /** days carried into `year`: set by HR on the person (carry[year]), otherwise what was left of the previous year's
   *  own entitlement, as long as the previous year is in the data (since db.since) */
  function carryIn(M, p, year) {
    var set = p.carry && p.carry[year];
    if (set !== undefined && set !== null && set !== '' && isFinite(+set)) return { days: Math.max(0, +set), src: 'set' };
    if (!M.firstYear || year <= M.firstYear || !employedInYear(p, year - 1)) return { days: 0, src: 'none' };
    return { days: balance(M, p, year - 1).nextCarry, src: 'auto' };
  }
  /** Annual leave balance for a year. Approved days use carried-over days first (up to the expiry), then this year's.
   *  o.extra: a draft request counted as if approved; o.exclude: a request id left out. */
  function balance(M, p, year, o) {
    o = o || {};
    var plain = !o.extra && !o.exclude, cache = M.c.bal || (M.c.bal = {}), key = p.id + ':' + year;
    if (plain && cache[key]) return cache[key];
    var today = M.today || '9999-12-31', ent = entitlement(M, p, year), ci = carryIn(M, p, year), exp = carryExpiry(M, p, year);
    var appr = [], pend = [], extra = 0;
    (M.req[p.id] || []).forEach(function (r) {
      if (r.type !== 'annual' || !isActive(r) || (o.exclude && r.id === o.exclude) || (o.extra && o.extra.id && r.id === o.extra.id)) return;
      var list = r.status === 'approved' ? appr : pend;
      requestDays(M, r).forEach(function (x) { if (yearOf(x.date) === year) list.push({ date: x.date, value: x.value }); });
    });
    if (o.extra && o.extra.type === 'annual') requestDays(M, o.extra).forEach(function (x) { if (yearOf(x.date) === year) { appr.push({ date: x.date, value: x.value, extra: true }); extra += x.value; } });
    var byDate = function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; };
    appr.sort(byDate); pend.sort(byDate);
    var left = ci.days, cUsed = 0, cur = 0, taken = 0, planned = 0;
    appr.forEach(function (x) {
      var v = x.value;
      if (x.date <= exp && left > 0) { var t = Math.min(v, left); left -= t; cUsed += t; v -= t; }
      cur += v;
      if (!x.extra) { if (x.date <= today) taken += x.value; else planned += x.value; }
    });
    var expired = today > exp ? left : 0, avail = today > exp ? 0 : left;
    var pending = 0, curP = cur, leftP = left;
    pend.forEach(function (x) { var v = x.value; pending += v; if (x.date <= exp && leftP > 0) { var t = Math.min(v, leftP); leftP -= t; v -= t; } curP += v; });
    var availP = today > exp ? 0 : leftP;
    var res = {
      year: year, ent: ent,
      carry: { days: ci.days, src: ci.src, expiry: exp, used: r2(cUsed), expired: r2(expired), available: r2(avail),
        warn: avail > 0 && today <= exp && diffDays(today, exp) <= (+M.s.carryWarnDays || 61) },
      taken: r2(taken), planned: r2(planned), pending: r2(pending), extra: r2(extra), used: r2(taken + planned),
      current: r2(ent.total - cur), remaining: r2(ent.total - cur + avail), afterPending: r2(ent.total - curP + availP),
      nextCarry: Math.max(0, r2(ent.total - cur))
    };
    if (plain) cache[key] = res;
    return res;
  }
  /** approved and pending days per type in a year */
  function usage(M, p, year) {
    var out = {};
    TYPES.forEach(function (t) { out[t.id] = { days: 0, pending: 0, count: 0 }; });
    (M.req[p.id] || []).forEach(function (r) {
      if (!isActive(r) || !out[r.type]) return;
      var d = 0;
      requestDays(M, r).forEach(function (x) { if (yearOf(x.date) === year) d += x.value; });
      if (!d) return;
      if (r.status === 'approved') { out[r.type].days += d; out[r.type].count++; } else out[r.type].pending += d;
    });
    return out;
  }
  /** longest stretch of annual leave in a year, counted in scheduled weekdays: weekends, holidays and company days off
   *  inside it bridge the stretch, and holidays on weekdays count (two working weeks = 10 days for a 5-day week) */
  function longestBlock(M, p, year) {
    var idx = dayIndex(M, p.id), best = { days: 0, from: null, to: null }, run = null;
    function close() { if (run && run.leave && run.days > best.days) best = { days: run.days, from: run.first, to: run.last }; run = null; }
    for (var d = year + '-01-01'; d <= year + '-12-31'; d = addDays(d, 1)) {
      var di = dayInfo(M, p, d);
      if (!di.employed) { close(); continue; }
      var full = (idx[d] || []).some(function (x) { return x.r.status === 'approved' && x.r.type === 'annual' && x.value >= di.frac && di.frac > 0; });
      if (di.scheduled && di.frac > 0 && !full) { close(); continue; }
      if (!run) run = { days: 0, leave: false, first: null, last: null };
      if (di.scheduled) {
        run.days++;
        if (!run.first) run.first = d;
        run.last = d;
        if (full) run.leave = true;
      }
    }
    close();
    return best;
  }

  // ── presence and conflicts ───────────────────────────────────────────────
  /** who of a team is at work on a date, counted in people: everyone scheduled that day counts 1 (also on a half
   *  company day off); half a day of leave makes them half present. o.extra: a draft request counted as approved;
   *  o.excludeId: a request left out; o.pending: count pending requests as away too */
  function presence(M, teamId, date, o) {
    o = o || {};
    var t = M.T[teamId], size = 0, present = 0, away = [];
    (M.members[teamId] || []).forEach(function (m) {
      var di = dayInfo(M, m, date);
      if (!di.frac) return;
      size += 1;
      var a = 0, items = [];
      (dayIndex(M, m.id)[date] || []).forEach(function (x) {
        if ((o.excludeId && x.r.id === o.excludeId) || (o.extra && o.extra.id && x.r.id === o.extra.id)) return;
        if (x.r.status !== 'approved' && !(o.pending && x.r.status === 'pending')) return;
        if (!isAway(M, x.r.type)) return;
        a += x.value; items.push(x);
      });
      if (o.extra && o.extra.personId === m.id && isAway(M, o.extra.type)) {
        requestDays(M, o.extra).forEach(function (x) { if (x.date === date) { a += x.value; items.push({ r: o.extra, value: x.value, draft: true }); } });
      }
      a = Math.min(a, di.frac);
      var share = (di.frac - a) / di.frac;
      present += share;
      if (a > 0) away.push({ p: m, value: a, share: 1 - share, items: items });
    });
    return { team: t, date: date, size: r2(size), present: r2(present), min: t ? +t.min || 0 : 0, away: away };
  }
  /** a blackout period as concrete ranges for a year: from/to are 'MM-DD' (every year, may run into the next year)
   *  or 'YYYY-MM-DD' (once) */
  function blackoutRanges(b, year) {
    if (!b) return [];
    if (isDate(b.from) && isDate(b.to)) return b.to >= b.from ? [[b.from, b.to]] : [];
    if (!/^\d{2}-\d{2}$/.test(b.from || '') || !/^\d{2}-\d{2}$/.test(b.to || '')) return [];
    var f = year + '-' + b.from, t = (b.to >= b.from ? year : year + 1) + '-' + b.to;
    return isDate(f) && isDate(t) ? [[f, t]] : [];
  }
  function plural(n, one, many) { return (Math.round(n * 10) / 10 + '').replace('.', ',') + ' ' + (n === 1 ? one : many); }
  function fmtHalf(n) { var w = Math.floor(n + 1e-9), h = n - w > 0.25; return (w ? w : '') + (h ? '½' : '') || '0'; }
  /** warnings to show before a request is approved. Each has kind, text and details; kind 'info' needs no override note. */
  function conflicts(M, r, o) {
    o = o || {};
    var p = M.P[r.personId], out = [];
    if (!p || !isDate(r.from) || !isDate(r.to)) return out;
    var T = typeOf(M, r.type), days = requestDays(M, r), team = M.T[p.team];
    // 1. the same person already away or with another request
    (M.req[p.id] || []).forEach(function (x) {
      if (x === r || (r.id && x.id === r.id) || !isActive(x)) return;
      if (x.from <= r.to && x.to >= r.from) {
        out.push({ kind: 'overlap', other: x, from: maxD(x.from, r.from), to: minD(x.to, r.to),
          text: p.name + ' already has ' + typeOf(M, x.type).name.toLowerCase() + (x.status === 'pending' ? ' (pending)' : '') + ' on ' + fmtRange(maxD(x.from, r.from), minD(x.to, r.to)) + '.' });
      }
    });
    if (T.away && team && +team.min > 0) {
      var bad = [];
      days.forEach(function (d) {
        var pr = presence(M, p.team, d.date, { extra: r, excludeId: r.id });
        if (pr.present < pr.min - 1e-9) bad.push(pr);
      });
      if (bad.length) {
        var low = bad.reduce(function (a, b) { return b.present < a.present ? b : a; });
        out.push({ kind: 'min', days: bad, team: team,
          text: team.name + ' would have ' + (bad.every(function (b) { return b.present === low.present; }) ? '' : 'as few as ') + fmtHalf(low.present) + ' of ' + fmtHalf(low.size) + ' at work on ' + fmtRanges(bad.map(function (b) { return b.date; })) + ' (minimum ' + team.min + ').' });
      }
    }
    if (T.away) {
      (M.s.blackouts || []).forEach(function (b) {
        if (b.team && b.team !== p.team) return;
        var hit = [];
        for (var y = yearOf(r.from) - 1; y <= yearOf(r.to); y++) {
          blackoutRanges(b, y).forEach(function (rg) { days.forEach(function (d) { if (d.date >= rg[0] && d.date <= rg[1] && hit.indexOf(d.date) < 0) hit.push(d.date); }); });
        }
        if (hit.length) { hit.sort(); out.push({ kind: 'blackout', blackout: b, dates: hit, text: (b.name || 'Blackout period') + (b.team && M.T[b.team] ? ' (' + M.T[b.team].name + ')' : '') + ': no leave on ' + fmtRanges(hit) + '.' }); }
      });
    }
    if (T.balance) {
      var years = {};
      days.forEach(function (d) { years[yearOf(d.date)] = 1; });
      Object.keys(years).forEach(function (y) {
        // carried-over days only cover days up to their expiry, so this year's own days must not run out either
        var b = balance(M, p, +y, { extra: r, exclude: r.id }), short = Math.max(-b.remaining, -b.current);
        if (short > 1e-9) out.push({ kind: 'balance', year: +y, short: r2(short), text: 'Not enough annual leave in ' + y + ': ' + plural(r2(short), 'day', 'days') + ' short' +
          (b.remaining >= 0 ? ' (carried-over days can only be used until ' + fmtDate(b.carry.expiry) + ')' : '') + '.' });
      });
    }
    if (r.type === 'special') {
      var sp = M.s.special || {}, reason = (sp.reasons || []).filter(function (x) { return x.id === r.reason; })[0], n = days.reduce(function (s, x) { return s + x.value; }, 0);
      if (reason && n > +reason.days + 1e-9) out.push({ kind: 'special', text: reason.name + ' allows ' + plural(+reason.days, 'day', 'days') + '; this request counts ' + plural(n, 'day', 'days') + '.' });
      if (+sp.cap > 0) {
        var per = {};
        days.forEach(function (x) { var y = yearOf(x.date); per[y] = (per[y] || 0) + x.value; });
        Object.keys(per).forEach(function (y) {
          var used = 0;
          (M.req[p.id] || []).forEach(function (x) { if (x.type === 'special' && x.status === 'approved' && x.id !== r.id) requestDays(M, x).forEach(function (d) { if (yearOf(d.date) === +y) used += d.value; }); });
          if (used + per[y] > +sp.cap + 1e-9) out.push({ kind: 'special', text: 'Special leave in ' + y + ' would reach ' + plural(used + per[y], 'day', 'days') + ', over the yearly limit of ' + sp.cap + '.' });
        });
      }
    }
    if (r.type === 'care' && countryOf(M, p) === 'SI') {
      // ZZVZZ Art. 30: the personal doctor certifies up to 7 working days per case (15 for a child under 7 or an older
      // child with a severe disability); longer needs the ZZZS medical commission
      var nc = days.reduce(function (s, x) { return s + x.value; }, 0);
      if (nc > 7) out.push({ kind: 'info', text: 'Care for a family member over 7 working days per case (15 for a child under 7) needs the ZZZS medical commission’s approval.' });
    }
    if (!o.noInfo && T.away && team) {
      var others = [];
      (M.members[p.team] || []).forEach(function (m) {
        if (m.id === p.id) return;
        (M.req[m.id] || []).forEach(function (x) { if (x.status === 'pending' && x.id !== r.id && isAway(M, x.type) && x.from <= r.to && x.to >= r.from) others.push(x); });
      });
      if (others.length) out.push({ kind: 'info', others: others, text: 'Also waiting for approval in ' + team.name + ': ' + others.map(function (x) { return M.P[x.personId].name + ' (' + fmtRange(x.from, x.to) + ')'; }).join(', ') + '.' });
    }
    return out;
  }
  function needsNote(list) { return (list || []).some(function (c) { return c.kind !== 'info'; }); }
  function validateRequest(M, r) {
    var e = {}, p = M.P[r.personId];
    if (!p) e.person = 'Choose a person.';
    if (!TYPE[r.type]) e.type = 'Choose a type.';
    if (!isDate(r.from)) e.from = 'Enter the first day.';
    if (!isDate(r.to)) e.to = 'Enter the last day.';
    else if (isDate(r.from) && r.to < r.from) e.to = 'The last day is before the first.';
    else if (isDate(r.from) && diffDays(r.from, r.to) > 366) e.to = 'Enter at most one year at a time.';
    if (r.type === 'special' && !((M.s.special && M.s.special.reasons) || []).some(function (x) { return x.id === r.reason; })) e.reason = 'Choose the reason.';
    if (p && !e.from && !e.to && countDays(M, r) === 0) e.to = 'These dates have no working days for ' + p.name + '.';
    if (r.note && String(r.note).length > 500) e.note = 'At most 500 characters.';
    return e;
  }

  // ── working time ─────────────────────────────────────────────────────────
  function timeRules(M, p) {
    var t = M.s.time || {}, c = t[countryOf(M, p)] || {}, out = {};
    Object.keys(TIME_FALLBACK).forEach(function (k) { out[k] = c[k] !== undefined ? c[k] : TIME_FALLBACK[k]; });
    out.overtimeBasis = t.overtimeBasis === 'weekly' ? 'weekly' : 'daily';
    out.overtimeFrom = +t.overtimeFrom >= 0 ? +t.overtimeFrom : 0;
    out.minRestHours = +t.minRestHours >= 0 ? +t.minRestHours : 12;
    out.maxDaysInRow = +t.maxDaysInRow > 0 ? +t.maxDaysInRow : 6;
    return out;
  }
  /** minutes of break per day that count as working time (SI: 30 min for full time, in proportion for part time of at
   *  least 4 h a day; HR: 30 min from 6 h a day) */
  function paidBreakAllowance(M, p) {
    var tr = timeRules(M, p), dh = dailyMin(p) / 60;
    if (!tr.breakPaid || dh < (+tr.breakFromHours || 0)) return 0;
    return Math.round((+tr.paidBreak || 0) * (tr.breakProRata ? Math.min(1, dh / 8) : 1));
  }
  /** group one person's clock events (sorted) into sessions: in → (bs → be)* → out */
  function sessionsOf(events) {
    var out = [], cur = null, orphans = [];
    (events || []).forEach(function (ev) {
      if (ev.kind === 'in') { if (cur) out.push(cur); cur = { date: ev.at.slice(0, 10), inAt: ev.at, outAt: null, breaks: [], events: [ev] }; return; }
      if (!cur) { orphans.push(ev); return; }
      cur.events.push(ev);
      var open = cur.breaks.filter(function (b) { return !b.end; })[0];
      if (ev.kind === 'bs') { if (open) open.end = ev.at; cur.breaks.push({ start: ev.at, end: null }); }
      else if (ev.kind === 'be') { if (open) open.end = ev.at; else orphans.push(ev); }
      else if (ev.kind === 'out') { cur.outAt = ev.at; out.push(cur); cur = null; }
    });
    if (cur) out.push(cur);
    return { sessions: out, orphans: orphans };
  }
  function sessionMetrics(s) {
    var gross = s.outAt ? Math.max(0, minutesBetween(s.inAt, s.outAt)) : 0, brk = 0, openBreak = false;
    s.breaks.forEach(function (b) {
      var end = b.end || s.outAt;
      if (!b.end) openBreak = true;
      if (end) brk += Math.max(0, minutesBetween(b.start, end));
    });
    return { gross: gross, brk: brk, openBreak: openBreak, open: !s.outAt };
  }
  /** where someone is right now: 'off', 'working', 'break' or 'done' (clocked out today), and the next actions */
  function clockState(events, now) {
    var ss = sessionsOf((events || []).filter(function (e) { return e.at <= now; })).sessions, last = ss[ss.length - 1];
    if (last && !last.outAt && minutesBetween(last.inAt, now) < 20 * 60) {
      var ob = last.breaks.filter(function (b) { return !b.end; })[0];
      return ob ? { state: 'break', since: ob.start, session: last, next: ['be', 'out'] } : { state: 'working', since: last.inAt, session: last, next: ['bs', 'out'] };
    }
    if (last && last.outAt && last.outAt.slice(0, 10) === now.slice(0, 10)) return { state: 'done', since: last.outAt, session: last, next: ['in'] };
    return { state: 'off', next: ['in'], stale: last && !last.outAt ? last : null };
  }
  /** check one day's edited events (in time order): times never go back and the order is in → (bs → be)* → out.
   *  Two events may share a minute (ending a break and the day at once). */
  function validateDay(list, allowOpen) {
    var errs = [], st = 'off', prev = null;
    (list || []).forEach(function (e, i) {
      if (!isStamp(e.at)) { errs.push('Row ' + (i + 1) + ': enter a time.'); return; }
      if (prev && e.at < prev) errs.push(KIND_NAME[e.kind] + ' at ' + e.at.slice(11) + ' must not be before ' + prev.slice(11) + '.');
      prev = e.at;
      var ok = (st === 'off' && e.kind === 'in') || (st === 'work' && (e.kind === 'bs' || e.kind === 'out')) || (st === 'break' && e.kind === 'be');
      if (!ok) errs.push(KIND_NAME[e.kind] + ' at ' + e.at.slice(11) + ' cannot come ' + (st === 'off' ? 'before a start.' : st === 'break' ? 'before the break ends.' : 'here.'));
      st = e.kind === 'in' ? 'work' : e.kind === 'bs' ? 'break' : e.kind === 'be' ? 'work' : 'off';
    });
    if (st !== 'off' && !allowOpen) errs.push(st === 'break' ? 'The break has no end.' : 'The day has no end time.');
    return errs;
  }
  var FLAG_TEXT = {
    missingOut: function () { return 'No clock-out'; },
    openBreak: function () { return 'Break not ended'; },
    orphan: function () { return 'Clock event without a start'; },
    shortRest: function (f) { return 'Rest of ' + fmtMin(f.rest) + ' before this shift (minimum ' + f.min + ' h)'; },
    daysInRow: function (f) { return f.count + ' days worked in a row without a rest day (limit ' + f.max + ')'; },
    otWeek: function (f) { return 'Overtime ' + fmtMin(f.total) + ' this week (limit ' + f.limit + ' h)'; },
    otMonth: function (f) { return 'Overtime ' + fmtMin(f.total) + ' this month (limit ' + f.limit + ' h)'; },
    otYear: function (f) { return 'Overtime ' + fmtMin(f.total) + ' this year (limit ' + f.limit + ' h)'; },
    noClock: function () { return 'No clock events on a working day'; },
    onLeave: function () { return 'Clock events on a day of leave'; }
  };
  function flagText(f) { return FLAG_TEXT[f.code] ? FLAG_TEXT[f.code](f) : f.code; }
  /** day records for a whole calendar year (plus the weeks around it), cached on the model */
  function timeline(M, p, year) {
    var cache = M.c.tl || (M.c.tl = {}), key = p.id + ':' + year;
    if (cache[key]) return cache[key];
    var today = M.today || '9999-12-31', tr = timeRules(M, p), dmin = dailyMin(p), allow = paidBreakAllowance(M, p);
    var from = addDays(mondayOf(year + '-01-01'), -7), to = addDays(mondayOf(year + '-12-31'), 6);
    var evs = (M.clock[p.id] || []).filter(function (e) { return e.at >= addDays(from, -2) && e.at <= addDays(to, 1) + 'T23:59'; });
    var ss = sessionsOf(evs), byDate = {}, orphans = {};
    ss.sessions.forEach(function (s) { (byDate[s.date] = byDate[s.date] || []).push(s); });
    ss.orphans.forEach(function (e) { var d = e.at.slice(0, 10); (orphans[d] = orphans[d] || []).push(e); });
    var idx = dayIndex(M, p.id), sp = sickPay(M, p), since = M.db.clockSince || '', days = [], map = {}, prevOut = null, run = 0, prevWorkDate = null;
    ss.sessions.forEach(function (s) { if (s.date < from && s.outAt) prevOut = s.outAt; });
    for (var d = from; d <= to; d = addDays(d, 1)) {
      var info = dayInfo(M, p, d), items = (idx[d] || []).filter(function (x) { return x.r.status === 'approved'; });
      var absVal = 0, absence = [];
      items.forEach(function (x) {
        var T = typeOf(M, x.r.type), pay = (x.r.type === 'sick' || x.r.type === 'care') ? sp[d] : null;
        if (T.absence) absVal += x.value;
        absence.push({ type: x.r.type, value: x.value, r: x.r, payer: pay ? pay.payer : (TYPE[x.r.type] || TYPE.annual).payer, insurer: pay && pay.payer === 'other' ? pay.insurer : '' });
      });
      absVal = Math.min(absVal, info.frac);
      var rec = { date: d, info: info, absence: absence, absVal: absVal, expected: Math.round((info.frac - absVal) * dmin), dmin: dmin,
        sessions: byDate[d] || [], start: '', end: '', endNext: false, gross: 0, brk: 0, unpaidBrk: 0, worked: 0, overtime: 0, flags: [] };
      rec.sessions.forEach(function (s) {
        var m = sessionMetrics(s);
        s.m = m; rec.gross += m.gross; rec.brk += m.brk;
        if (m.open && d < today) rec.flags.push({ code: 'missingOut' });
        if (m.openBreak && !m.open) rec.flags.push({ code: 'openBreak' });
      });
      if (orphans[d]) rec.flags.push({ code: 'orphan' });
      if (rec.sessions.length) {
        rec.start = rec.sessions[0].inAt.slice(11);
        var lastS = rec.sessions[rec.sessions.length - 1];
        if (lastS.outAt) { rec.end = lastS.outAt.slice(11); rec.endNext = lastS.outAt.slice(0, 10) !== d; }
        if (prevOut) {
          var rest = minutesBetween(prevOut, rec.sessions[0].inAt);
          if (rest >= 0 && rest < tr.minRestHours * 60) rec.flags.push({ code: 'shortRest', rest: rest, min: tr.minRestHours });
        }
        prevOut = lastS.outAt || null;
        run = prevWorkDate && addDays(prevWorkDate, 1) === d ? run + 1 : 1;
        prevWorkDate = d;
        rec.run = run;
        if (info.frac > 0 && absVal >= info.frac) rec.flags.push({ code: 'onLeave' });
      } else if (rec.expected > 0 && d < today && since && d >= since) {
        rec.flags.push({ code: 'noClock' });
      }
      rec.unpaidBrk = Math.max(0, rec.brk - allow);
      rec.worked = Math.max(0, rec.gross - rec.unpaidBrk);
      days.push(rec); map[d] = rec;
    }
    // more days in a row than allowed: one flag per streak, on the first day over the limit, with the streak's length
    days.forEach(function (rec, k) {
      if (rec.run !== tr.maxDaysInRow + 1) return;
      var n = rec.run;
      for (var j = k + 1; j < days.length && days[j].run === n + 1; j++) n++;
      rec.flags.push({ code: 'daysInRow', count: n, max: tr.maxDaysInRow });
    });
    // overtime: time beyond the hours expected that day, or that week (allocated to the days that go over). Extra time
    // under tr.overtimeFrom minutes (per day, or per week on a weekly basis) is not counted.
    var i, weeks = {}, thr = tr.overtimeFrom;
    for (i = 0; i < days.length; i += 7) {
      var wk = days.slice(i, i + 7), X = 0, W = 0, cum = 0;
      wk.forEach(function (r) { X += r.expected; W += r.worked; });
      wk.forEach(function (r) {
        if (tr.overtimeBasis === 'weekly') {
          var before = Math.max(0, cum - X); cum += r.worked;
          r.overtime = W - X >= thr ? Math.max(0, cum - X) - before : 0;
        } else {
          var ot = r.worked > 0 ? Math.max(0, r.worked - r.expected) : 0;
          r.overtime = ot >= thr ? ot : 0;
        }
      });
      weeks[wk[0].date] = { from: wk[0].date, worked: W, expected: X, overtime: wk.reduce(function (s, r) { return s + r.overtime; }, 0) };
    }
    // limits on overtime per week, month and year: flag the day that goes over
    function limitPass(groupKey, limitH, code) {
      if (!(+limitH > 0)) return;
      var tot = {}, cum = {};
      days.forEach(function (r) { var k = groupKey(r.date); if (k) tot[k] = (tot[k] || 0) + r.overtime; });
      days.forEach(function (r) {
        var k = groupKey(r.date); if (!k || !r.overtime) return;
        var before = cum[k] || 0; cum[k] = before + r.overtime;
        if (before <= limitH * 60 && cum[k] > limitH * 60) r.flags.push({ code: code, total: tot[k], limit: +limitH });
      });
    }
    limitPass(function (d) { return mondayOf(d); }, tr.week, 'otWeek');
    limitPass(function (d) { return d.slice(0, 7); }, tr.month, 'otMonth');
    limitPass(function (d) { return yearOf(d) === year ? String(year) : null; }, tr.year, 'otYear');
    var months = {};
    days.forEach(function (r) {
      if (yearOf(r.date) !== year) return;
      var k = r.date.slice(0, 7), m = months[k] || (months[k] = { worked: 0, expected: 0, overtime: 0 });
      m.worked += r.worked; m.expected += r.expected; m.overtime += r.overtime;
    });
    var res = { person: p, year: year, from: from, to: to, days: days, map: map, weeks: weeks, months: months, rules: tr, allowance: allow };
    cache[key] = res;
    return res;
  }
  /** one person's working-time record for a month: a row per day and the totals */
  function monthRecord(M, p, ym) {
    var y = +ym.slice(0, 4), tl = timeline(M, p, y), from = monthStart(ym), to = monthEnd(ym);
    var days = tl.days.filter(function (r) { return r.date >= from && r.date <= to; });
    var t = { worked: 0, expected: 0, overtime: 0, brk: 0, unpaidBrk: 0, workDays: 0, daysWorked: 0, holidays: 0, holidayMin: 0, companyMin: 0,
      absence: {}, paidAbsMin: 0, otherAbsMin: 0, unpaidAbsMin: 0, remote: 0, trip: 0, flags: 0,
      sickEmployer: { days: 0, min: 0 }, sickInsurer: { days: 0, min: 0 } };
    TYPES.forEach(function (x) { t.absence[x.id] = { days: 0, min: 0 }; });
    days.forEach(function (r) {
      t.worked += r.worked; t.expected += r.expected; t.overtime += r.overtime; t.brk += r.brk; t.unpaidBrk += r.unpaidBrk; t.flags += r.flags.length;
      if (r.info.frac > 0) t.workDays += r.info.frac;
      if (r.worked > 0) t.daysWorked++;
      if (r.info.holiday && r.info.scheduled && r.info.employed) { t.holidays++; t.holidayMin += r.dmin; }
      if (r.info.company && r.info.scheduled && r.info.employed && !r.info.holiday) t.companyMin += Math.round((r.info.company.half ? 0.5 : 1) * r.dmin);
      r.absence.forEach(function (a) {
        var T = TYPE[a.type] || TYPE.annual, mins = Math.round(a.value * r.dmin), slot = t.absence[a.type];
        if (slot) { slot.days += a.value; slot.min += mins; }
        if (a.type === 'remote') t.remote += a.value;
        if (a.type === 'trip') t.trip += a.value;
        if (!T.absence) return;
        var payer = a.payer || T.payer;
        if (a.type === 'sick') { var sk = payer === 'other' ? t.sickInsurer : t.sickEmployer; sk.days += a.value; sk.min += mins; }
        if (payer === 'employer') t.paidAbsMin += mins; else if (payer === 'other') t.otherAbsMin += mins; else t.unpaidAbsMin += mins;
      });
    });
    var ytd = 0;
    tl.days.forEach(function (r) { if (yearOf(r.date) === y && r.date <= to) ytd += r.overtime; });
    var weeks = [];
    Object.keys(tl.weeks).forEach(function (k) { var w = tl.weeks[k]; if (addDays(k, 6) >= from && k <= to) weeks.push(w); });
    return { person: p, ym: ym, from: from, to: to, days: days, totals: t, weeks: weeks, ytdOvertime: ytd, rules: tl.rules, allowance: tl.allowance };
  }
  // ── shift rota ───────────────────────────────────────────────────────────
  // A person's usual shift is p.shift: a shift id ('A'), or two ids that swap every week ('A/B': the first in even ISO
  // weeks, the second in odd ones). db.rota[personId][date] overrides it for one day: a shift id, or 'off'. Approved
  // absences always win over the plan. Past days are compared with the clock times.
  function shiftsOf(M) { var l = M.s && M.s.shifts; return Array.isArray(l) && l.length ? l : defaultSettings().shifts; }
  function shiftById(M, id) { return shiftsOf(M).filter(function (x) { return x.id === id; })[0] || null; }
  function shiftMinutes(sh) {
    if (!sh || !isTime(sh.start) || !isTime(sh.end)) return 0;
    var a = +sh.start.slice(0, 2) * 60 + +sh.start.slice(3), b = +sh.end.slice(0, 2) * 60 + +sh.end.slice(3);
    return b > a ? b - a : b + 1440 - a; // a night shift ends the next day
  }
  /** the shift's start and end stamps on date d (a night shift ends on the next day) */
  function shiftWindow(d, sh) {
    var night = sh.end <= sh.start;
    return { start: d + 'T' + sh.start, end: (night ? addDays(d, 1) : d) + 'T' + sh.end, min: shiftMinutes(sh) };
  }
  function usualShift(M, p, d) {
    var u = typeof p.shift === 'string' ? p.shift.trim() : '';
    if (!u) return null;
    var parts = u.split('/'), id = parts.length === 2 ? parts[isoWeek(d) % 2 === 0 ? 0 : 1] : parts[0];
    return shiftById(M, id) ? id : null;
  }
  /** the plan for one person and day: { shift (id or null), explicit, leave (approved absence type), pending (type), info } */
  function rotaDay(M, p, d) {
    var info = dayInfo(M, p, d), own = M.db.rota && M.db.rota[p.id], ex = own && Object.prototype.hasOwnProperty.call(own, d) ? own[d] : undefined;
    var shift = ex !== undefined ? (ex === 'off' || !shiftById(M, ex) ? null : ex) : (info.frac > 0 ? usualShift(M, p, d) : null);
    if (!info.employed) shift = null;
    var leave = null, pending = null, absVal = 0;
    (dayIndex(M, p.id)[d] || []).forEach(function (x) {
      var T = typeOf(M, x.r.type);
      if (!T.absence) return;
      if (x.r.status === 'approved') { absVal += x.value; leave = leave || x.r.type; } else pending = pending || x.r.type;
    });
    var fullLeave = leave && (info.frac === 0 || absVal >= info.frac);
    return { date: d, shift: fullLeave ? null : shift, planned: shift, explicit: ex !== undefined, leave: leave, fullLeave: !!fullLeave, pending: pending, info: info };
  }
  /** compare a planned day with the clock: status '' (nothing to say), 'ok', 'late', 'early', 'lateEarly', 'noShow',
   *  'unplanned' (worked without a shift), 'open' (still at work or not clocked out) or 'future' */
  function rotaCheck(M, p, day, now) {
    var tol = +(M.s && M.s.rotaTolerance) >= 0 ? +M.s.rotaTolerance : 10, rec = timeline(M, p, yearOf(day.date)).map[day.date];
    var ss = rec ? rec.sessions : [], o = { status: '', lateMin: 0, earlyMin: 0, start: '', end: '' };
    if (ss.length) { o.start = ss[0].inAt; o.end = ss[ss.length - 1].outAt || ''; }
    var sh = day.shift ? shiftById(M, day.shift) : null;
    // work without a shift only matters for people on the rota (a usual shift or a planned day)
    if (!sh) { if (ss.length && (p.shift || (M.db.rota && M.db.rota[p.id] && Object.keys(M.db.rota[p.id]).length))) o.status = 'unplanned'; return o; }
    var w = shiftWindow(day.date, sh);
    // no clock events: judged only once the day is over (a shift may still start, or the terminal syncs later)
    if (!ss.length) { o.status = now < w.start ? 'future' : day.date < now.slice(0, 10) && now >= w.end ? 'noShow' : ''; return o; }
    o.lateMin = Math.max(0, minutesBetween(w.start, o.start));
    if (!o.end) { o.status = o.lateMin > tol ? 'late' : 'open'; return o; }
    o.earlyMin = Math.max(0, minutesBetween(o.end, w.end));
    var late = o.lateMin > tol, early = o.earlyMin > tol;
    o.status = late && early ? 'lateEarly' : late ? 'late' : early ? 'early' : 'ok';
    return o;
  }
  /** a team's rota for the week starting on Monday `monday`: rows per person employed that week, coverage per day */
  function rotaWeek(M, teamId, monday, now) {
    var dates = [];
    for (var i = 0; i < 7; i++) dates.push(addDays(monday, i));
    var team = M.T[teamId] || {}, people = (M.members[teamId] || []).filter(function (p) { return employedOn(p, dates[0]) || employedOn(p, dates[6]); });
    var cover = dates.map(function (d) { return { date: d, planned: 0, byShift: {}, min: +team.min || 0, short: false, working: false }; });
    var rows = people.map(function (p) {
      var planned = 0, contract = 0;
      var cells = dates.map(function (d, k) {
        var day = rotaDay(M, p, d), sh = day.shift ? shiftById(M, day.shift) : null;
        day.check = rotaCheck(M, p, day, now || '0000-01-01T00:00');
        if (day.info.frac > 0) { contract += Math.round(day.info.frac * dailyMin(p)); cover[k].working = true; }
        if (day.fullLeave) contract -= Math.round(day.info.frac * dailyMin(p));
        if (sh) { planned += shiftMinutes(sh); cover[k].planned++; cover[k].byShift[sh.id] = (cover[k].byShift[sh.id] || 0) + 1; }
        return day;
      });
      return { person: p, cells: cells, plannedMin: planned, contractMin: Math.max(0, contract) };
    });
    var anyPlan = rows.some(function (r) { return r.cells.some(function (c) { return c.shift; }); });
    cover.forEach(function (c) { c.short = anyPlan && c.working && c.min > 0 && c.planned < c.min; });
    return { team: team, monday: monday, dates: dates, rows: rows, cover: cover };
  }

  /** share of the working time a team was away: mode 'all' (every absence type), 'sick' or 'annual' */
  function absenceRate(M, teamId, from, to, mode) {
    var cap = 0, away = 0;
    (M.members[teamId] || []).forEach(function (m) {
      var idx = dayIndex(M, m.id);
      for (var d = from; d <= to; d = addDays(d, 1)) {
        var di = dayInfo(M, m, d);
        if (!di.frac) continue;
        cap += di.frac;
        var a = 0;
        (idx[d] || []).forEach(function (x) {
          if (x.r.status !== 'approved') return;
          var T = typeOf(M, x.r.type);
          if (!T.absence) return;
          if (mode === 'sick' ? x.r.type === 'sick' : mode === 'annual' ? x.r.type === 'annual' : true) a += x.value;
        });
        away += Math.min(a, di.frac);
      }
    });
    return { capacity: r2(cap), away: r2(away), rate: cap ? away / cap : 0 };
  }

  // ── e-mail notices (drafted for the person's own mail app; the app never sends anything) ──────────────────
  function daysWord(n, lang) {
    var t = (Math.round(n * 10) / 10 + '').replace('.', ','), whole = Math.abs(n - Math.round(n)) < 1e-9, k = Math.round(n) % 100, k10 = k % 10;
    if (lang === 'sl') return t + ' ' + (!whole ? 'delovnega dne' : k === 1 ? 'delovni dan' : k === 2 ? 'delovna dneva' : k === 3 || k === 4 ? 'delovni dnevi' : 'delovnih dni');
    if (lang === 'hr') return t + ' ' + (!whole ? 'radnih dana' : k10 === 1 && k !== 11 ? 'radni dan' : k10 >= 2 && k10 <= 4 && (k < 12 || k > 14) ? 'radna dana' : 'radnih dana');
    return t + ' ' + (n === 1 ? 'working day' : 'working days');
  }
  var MAIL = {
    sl: { hi: function (n) { return 'Pozdravljeni' + (n ? ', ' + n : '') + ','; }, bye: 'Lep pozdrav,',
      reqSubj: function (x) { return 'Zahtevek: ' + x.type + ', ' + x.range + ' (' + x.name + ')'; },
      reqLead: function (x) { return x.name + ' prosi za odobritev: ' + x.type.toLowerCase() + '.'; },
      period: 'Obdobje', days: 'Šteje se', note: 'Opomba', left: 'Ostanek letnega dopusta po odobritvi', warns: 'Opozorila',
      reqAsk: 'Zahtevek odobrite ali zavrnite v aplikaciji Čas in dopust:',
      decSubj: function (x) { return x.type + ' ' + x.range + ': ' + (x.ok ? 'odobreno' : 'zavrnjeno'); },
      decLead: function (x) { return 'vaš zahtevek (' + x.type.toLowerCase() + ', ' + x.range + ') je ' + (x.ok ? 'odobren' : 'zavrnjen') + '.'; },
      why: function (ok) { return ok ? 'Opomba ob odobritvi' : 'Razlog'; }, open: 'Podrobnosti v aplikaciji Čas in dopust:' },
    hr: { hi: function (n) { return 'Poštovani' + (n ? ' ' + n : '') + ','; }, bye: 'Lijep pozdrav,',
      reqSubj: function (x) { return 'Zahtjev: ' + x.type + ', ' + x.range + ' (' + x.name + ')'; },
      reqLead: function (x) { return x.name + ' traži odobrenje: ' + x.type.toLowerCase() + '.'; },
      period: 'Razdoblje', days: 'Računa se', note: 'Napomena', left: 'Preostali godišnji odmor nakon odobrenja', warns: 'Upozorenja',
      reqAsk: 'Zahtjev odobrite ili odbijte u aplikaciji Vrijeme i odsutnosti:',
      decSubj: function (x) { return x.type + ' ' + x.range + ': ' + (x.ok ? 'odobreno' : 'odbijeno'); },
      decLead: function (x) { return 'vaš zahtjev (' + x.type.toLowerCase() + ', ' + x.range + ') je ' + (x.ok ? 'odobren' : 'odbijen') + '.'; },
      why: function (ok) { return ok ? 'Napomena uz odobrenje' : 'Razlog'; }, open: 'Pojedinosti u aplikaciji Vrijeme i odsutnosti:' },
    en: { hi: function (n) { return 'Hello' + (n ? ' ' + n : '') + ','; }, bye: 'Best regards,',
      reqSubj: function (x) { return 'Leave request: ' + x.type + ', ' + x.range + ' (' + x.name + ')'; },
      reqLead: function (x) { return x.name + ' asks you to approve: ' + x.type.toLowerCase() + '.'; },
      period: 'Dates', days: 'Counts', note: 'Note', left: 'Annual leave left after approval', warns: 'Warnings',
      reqAsk: 'Approve or decline it in Time & leave:',
      decSubj: function (x) { return x.type + ' ' + x.range + ': ' + (x.ok ? 'approved' : 'declined'); },
      decLead: function (x) { return 'your request (' + x.type.toLowerCase() + ', ' + x.range + ') was ' + (x.ok ? 'approved' : 'declined') + '.'; },
      why: function (ok) { return ok ? 'Approval note' : 'Reason'; }, open: 'Details in Time & leave:' }
  };
  /** the text of a notice. kind 'request' (to the approver) or 'decision' (to the employee); o: { lang, to (person),
   *  from (person), link, warnings: [text], left (days or null) } → { subject, body } with CRLF line ends */
  function mailText(M, r, kind, o) {
    o = o || {};
    var lang = MAIL[o.lang] ? o.lang : 'en', L = MAIL[lang], p = M.P[r.personId] || { name: '', first: '' }, T = TYPE[r.type] || TYPE.annual;
    var type = lang === 'en' ? typeOf(M, r.type).name : T[lang], x = { name: p.name, type: type, range: fmtRange(r.from, r.to), ok: r.status === 'approved' };
    var to = o.to || {}, from = o.from || {}, n = countDays(M, r), lines;
    if (kind === 'request') {
      lines = [L.hi(to.first), '', L.reqLead(x), '', L.period + ': ' + x.range + (r.from === r.to && (r.halfStart || r.halfEnd) ? ' (½)' : ''), L.days + ': ' + daysWord(n, lang)];
      if (r.note) lines.push(L.note + ': ' + r.note);
      if (o.left !== null && o.left !== undefined) lines.push(L.left + ': ' + (Math.round(o.left * 10) / 10 + '').replace('.', ','));
      if (o.warnings && o.warnings.length) { lines.push('', L.warns + ':'); o.warnings.forEach(function (w) { lines.push('- ' + w); }); }
      lines.push('', L.reqAsk, o.link || '', '', L.bye, from.name || p.name);
      return { subject: L.reqSubj(x), body: lines.join('\r\n') };
    }
    lines = [L.hi(to.first) , '', L.decLead(x)];
    if (r.comment) lines.push('', L.why(x.ok) + ': ' + r.comment);
    lines.push('', L.open, o.link || '', '', L.bye, from.name || '');
    return { subject: L.decSubj(x), body: lines.join('\r\n') };
  }
  /** UTF-8 text → base64 (works in browsers and in Node without Buffer) */
  function base64Utf8(str) {
    var bin = unescape(encodeURIComponent(String(str))), A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', out = '';
    for (var i = 0; i < bin.length; i += 3) {
      var a = bin.charCodeAt(i), b = bin.charCodeAt(i + 1), c = bin.charCodeAt(i + 2), t = (a << 16) | ((b || 0) << 8) | (c || 0);
      out += A.charAt(t >> 18 & 63) + A.charAt(t >> 12 & 63) + (i + 1 < bin.length ? A.charAt(t >> 6 & 63) : '=') + (i + 2 < bin.length ? A.charAt(t & 63) : '=');
    }
    return out;
  }
  function mimeWord(s) { return /^[\x20-\x7e]*$/.test(s) ? s : '=?UTF-8?B?' + base64Utf8(s) + '?='; }
  function mailbox(x) { x = x || {}; var e = String(x.email || '').replace(/[\r\n<>]/g, ''); var nm = String(x.name || '').replace(/[\r\n"\\]/g, ''); return nm ? (/^[\x20-\x7e]*$/.test(nm) ? '"' + nm + '"' : mimeWord(nm)) + ' <' + e + '>' : e; }
  /** a draft e-mail file (.eml, RFC 5322 + MIME): X-Unsent makes Outlook open it as a new message to send.
   *  o: { from: {name, email}, to: {name, email}, subject, body, date (Date) } */
  function eml(o) {
    var b64 = base64Utf8(String(o.body || '').replace(/\r?\n/g, '\r\n')), wrapped = [];
    for (var i = 0; i < b64.length; i += 76) wrapped.push(b64.slice(i, i + 76));
    var head = [];
    if (o.from && o.from.email) head.push('From: ' + mailbox(o.from));
    head.push('To: ' + mailbox(o.to), 'Subject: ' + mimeWord(String(o.subject || '').replace(/[\r\n]+/g, ' ')));
    if (o.date) head.push('Date: ' + o.date.toUTCString().replace('GMT', '+0000'));
    head.push('MIME-Version: 1.0', 'X-Unsent: 1', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64');
    return head.join('\r\n') + '\r\n\r\n' + wrapped.join('\r\n') + '\r\n';
  }
  function mailtoUrl(to, subject, body) {
    return 'mailto:' + encodeURIComponent(to || '').replace(/%40/g, '@') + '?subject=' + encodeURIComponent(subject || '') + '&body=' + encodeURIComponent(String(body || '').replace(/\r?\n/g, '\r\n'));
  }

  // ── iCalendar ────────────────────────────────────────────────────────────
  function icsEscape(s) { return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n'); }
  function utf8Length(ch) { var c = ch.codePointAt(0); return c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4; }
  /** fold a content line at 75 octets (RFC 5545 3.1); continuation lines start with one space; never splits a character */
  function icsFold(line) {
    var out = [], cur = '', bytes = 0;
    Array.from(line).forEach(function (ch) {
      var b = utf8Length(ch), max = out.length ? 74 : 75;
      if (bytes + b > max) { out.push(cur); cur = ''; bytes = 0; }
      cur += ch; bytes += b;
    });
    out.push(cur);
    return out.join('\r\n ');
  }
  function icsDate(d) { return d.replace(/-/g, ''); }
  /** events: [{ uid, start, end (last day, inclusive), summary, description?, categories?, status?, busy? }];
   *  opts: { stamp: 'YYYYMMDDTHHMMSSZ', name, prodId } */
  function ics(events, opts) {
    opts = opts || {};
    var lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:' + (opts.prodId || '-//Business Apps//Time and leave//EN'), 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
    if (opts.name) lines.push('X-WR-CALNAME:' + icsEscape(opts.name));
    (events || []).forEach(function (e) {
      lines.push('BEGIN:VEVENT', 'UID:' + e.uid, 'DTSTAMP:' + opts.stamp, 'DTSTART;VALUE=DATE:' + icsDate(e.start), 'DTEND;VALUE=DATE:' + icsDate(addDays(e.end || e.start, 1)),
        'SUMMARY:' + icsEscape(e.summary));
      if (e.description) lines.push('DESCRIPTION:' + icsEscape(e.description));
      if (e.categories) lines.push('CATEGORIES:' + icsEscape(e.categories));
      if (e.status) lines.push('STATUS:' + e.status);
      lines.push('TRANSP:' + (e.busy ? 'OPAQUE' : 'TRANSPARENT'), 'END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    return lines.map(icsFold).join('\r\n') + '\r\n';
  }
  function icsStamp(date) {
    var d = date || new Date();
    return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + 'T' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z';
  }

  return {
    // dates and times
    isDate: isDate, isTime: isTime, isStamp: isStamp, addDays: addDays, diffDays: diffDays, dow: dow, isoDow: isoDow, mondayOf: mondayOf,
    daysInMonth: daysInMonth, addMonths: addMonths, addMonthsYm: addMonthsYm, yearOf: yearOf, monthStart: monthStart, monthEnd: monthEnd,
    isoWeek: isoWeek, fullMonths: fullMonths, monthPeriodEnd: monthPeriodEnd, minD: minD, maxD: maxD, ymd: ymd, pad: pad,
    fmtDate: fmtDate, fmtRange: fmtRange, fmtRanges: fmtRanges, groupDates: groupDates, fmtMin: fmtMin, hm: hm, fmtHalf: fmtHalf,
    absMin: absMin, minutesBetween: minutesBetween,
    // holidays and types
    easter: easter, holidays: holidays, companyDays: companyDays, HOLIDAY_DEFS: HOLIDAY_DEFS, COUNTRIES: COUNTRIES,
    TYPES: TYPES, TYPE: TYPE, STATUSES: STATUSES, typeOf: typeOf, isActive: isActive, isAway: isAway, KIND_NAME: KIND_NAME, KIND_ORDER: KIND_ORDER,
    defaultSettings: defaultSettings,
    // model and leave
    model: model, touch: touch, addRequest: addRequest, countryOf: countryOf, workDays: workDays, dailyMin: dailyMin, employedOn: employedOn,
    employedInYear: employedInYear, dayInfo: dayInfo, requestDays: requestDays, countDays: countDays, rangeInfo: rangeInfo, dayIndex: dayIndex,
    ageInYear: ageInYear, serviceYears: serviceYears, roundDays: roundDays, entitlement: entitlement, carryExpiry: carryExpiry, carryIn: carryIn,
    balance: balance, usage: usage, longestBlock: longestBlock, presence: presence, blackoutRanges: blackoutRanges, conflicts: conflicts,
    needsNote: needsNote, validateRequest: validateRequest,
    // working time
    timeRules: timeRules, paidBreakAllowance: paidBreakAllowance, sessionsOf: sessionsOf, clockState: clockState, validateDay: validateDay,
    flagText: flagText, timeline: timeline, monthRecord: monthRecord, absenceRate: absenceRate, byAt: byAt,
    // sick pay and the shift rota
    sickRules: sickRules, sickPay: sickPay, sickSplit: sickSplit,
    shiftsOf: shiftsOf, shiftById: shiftById, shiftMinutes: shiftMinutes, shiftWindow: shiftWindow, usualShift: usualShift, rotaDay: rotaDay, rotaCheck: rotaCheck, rotaWeek: rotaWeek,
    // e-mail notices
    mailText: mailText, eml: eml, mailtoUrl: mailtoUrl, base64Utf8: base64Utf8,
    // iCalendar
    icsEscape: icsEscape, icsFold: icsFold, utf8Length: utf8Length, ics: ics, icsStamp: icsStamp
  };
});
