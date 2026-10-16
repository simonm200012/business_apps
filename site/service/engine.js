/* Service jobs engine (Business Apps): pure field-service rules, no DOM. UMD, so it also loads in Node.
 * Dates are 'YYYY-MM-DD'; times are local (Europe/Ljubljana) wall-clock stamps 'YYYY-MM-DDTHH:MM'. Both compare as strings;
 * durations use UTC arithmetic on the wall-clock values, so a daylight-saving change can shift one duration by an hour.
 * Money is computed in whole cents and returned in euros (two decimals). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ServiceEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ── dates ────────────────────────────────────────────────────────────────
  var DAY = 86400000;
  function pad(n) { return String(n).padStart(2, '0'); }
  function toUtc(s) { return Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)); }
  function fromUtc(t) { var d = new Date(t); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function isDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && fromUtc(toUtc(s)) === s; }
  function addDays(s, n) { return fromUtc(toUtc(s) + Math.round(n) * DAY); }
  function diffDays(a, b) { return Math.round((toUtc(b) - toUtc(a)) / DAY); } // b − a
  function dow(s) { return new Date(toUtc(s)).getUTCDay(); } // 0 = Sunday
  function mondayOf(s) { var d = dow(s); return addDays(s, d === 0 ? -6 : 1 - d); }
  function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); } // m is 1-based
  function ymd(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }
  /** s + n months; the day is clamped to the end of a shorter month (31. 1. + 1 month = 28. or 29. 2.) */
  function addMonths(s, n) {
    var y = +s.slice(0, 4), m = +s.slice(5, 7), d = +s.slice(8, 10);
    var t = y * 12 + (m - 1) + Math.round(n), yy = Math.floor(t / 12), mm = t - yy * 12 + 1;
    return ymd(yy, mm, Math.min(d, daysInMonth(yy, mm)));
  }
  function isWeekend(s) { var d = dow(s); return d === 0 || d === 6; }
  function isoWeek(s) {
    var d = new Date(toUtc(s)), day = d.getUTCDay() || 7; d.setUTCDate(d.getUTCDate() + 4 - day);
    var y0 = Date.UTC(d.getUTCFullYear(), 0, 1);
    return Math.ceil(((d - y0) / DAY + 1) / 7);
  }
  function fmtDate(s) { return isDate(s) ? +s.slice(8, 10) + '. ' + +s.slice(5, 7) + '. ' + s.slice(0, 4) : '—'; }

  // ── times ────────────────────────────────────────────────────────────────
  function isStamp(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s) && isDate(s.slice(0, 10)) && +s.slice(11, 13) < 24 && +s.slice(14, 16) < 60; }
  function toMin(s) { return Math.round(toUtc(s.slice(0, 10)) / 60000) + (+s.slice(11, 13)) * 60 + (+s.slice(14, 16)); }
  function fromMin(m) { m = Math.round(m); var day = Math.floor(m / 1440), r = m - day * 1440; return fromUtc(day * DAY) + 'T' + pad(Math.floor(r / 60)) + ':' + pad(r % 60); }
  function addMin(s, n) { return fromMin(toMin(s) + Math.round(n)); }
  function minutesBetween(a, b) { return toMin(b) - toMin(a); } // b − a
  function stamp(date, hm) { return date + 'T' + hm; }
  function hmOf(s) { return isStamp(s) ? s.slice(11, 16) : ''; }
  function dateOf(s) { return typeof s === 'string' ? s.slice(0, 10) : ''; }
  function fmtStamp(s) { return isStamp(s) ? fmtDate(s.slice(0, 10)) + ' ' + s.slice(11, 16) : '—'; }

  // ── public holidays (Slovenia; defaults the owner checks in Settings) ────
  function easter(y) { // anonymous Gregorian algorithm: Easter Sunday
    var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    var h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    var n = h + l - 7 * m + 114;
    return ymd(y, Math.floor(n / 31), (n % 31) + 1);
  }
  var SI_FIXED = [['01-01', 'New Year'], ['01-02', 'New Year'], ['02-08', 'Prešeren Day'], ['04-27', 'Day of Uprising Against Occupation'], ['05-01', 'Labour Day'], ['05-02', 'Labour Day'],
    ['06-25', 'Statehood Day'], ['08-15', 'Assumption Day'], ['10-31', 'Reformation Day'], ['11-01', 'Remembrance Day'], ['12-25', 'Christmas Day'], ['12-26', 'Independence and Unity Day']];
  function siHolidays(y) {
    var e = easter(y);
    var out = SI_FIXED.map(function (h) { return { date: y + '-' + h[0], name: h[1] }; });
    out.push({ date: e, name: 'Easter Sunday' }, { date: addDays(e, 1), name: 'Easter Monday' }, { date: addDays(e, 49), name: 'Whit Sunday' });
    return out.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  }
  /** list [{date, name}] → { date: name } */
  function holidayMap(list) { var m = {}; (list || []).forEach(function (h) { if (h && isDate(h.date)) m[h.date] = h.name || 'Holiday'; }); return m; }
  function isWorkday(s, hmap) { return !isWeekend(s) && !(hmap && hmap[s]); }
  function nextWorkday(s, hmap) { var d = addDays(s, 1); while (!isWorkday(d, hmap)) d = addDays(d, 1); return d; }
  function workdayOnOrAfter(s, hmap) { var d = s; while (!isWorkday(d, hmap)) d = addDays(d, 1); return d; }
  function prevWorkday(s, hmap) { var d = addDays(s, -1); while (!isWorkday(d, hmap)) d = addDays(d, -1); return d; }
  /** working days from `from` to `to`, both included */
  function workdays(from, to, hmap) { var n = 0; for (var d = from; d <= to; d = addDays(d, 1)) if (isWorkday(d, hmap)) n++; return n; }

  // ── reference lists ──────────────────────────────────────────────────────
  var WINDOWS = [
    { id: '08', start: '08:00', end: '10:00', label: '08–10' },
    { id: '10', start: '10:00', end: '12:00', label: '10–12' },
    { id: '12', start: '12:00', end: '14:00', label: '12–14' },
    { id: '14', start: '14:00', end: '16:00', label: '14–16' }
  ];
  function winIndex(id) { for (var i = 0; i < WINDOWS.length; i++) if (WINDOWS[i].id === id) return i; return -1; }
  /** index of the arrival window a time falls in: −1 before 08:00, 4 from 16:00 */
  function windowAt(hm) { if (hm < WINDOWS[0].start) return -1; for (var i = 0; i < WINDOWS.length; i++) if (hm < WINDOWS[i].end) return i; return WINDOWS.length; }

  var STATUSES = [
    { id: 'new', name: 'New', open: true },
    { id: 'scheduled', name: 'Scheduled', open: true },
    { id: 'travelling', name: 'Travelling', open: true },
    { id: 'onsite', name: 'On site', open: true },
    { id: 'parts', name: 'Waiting for parts', open: true },
    { id: 'done', name: 'Done', open: false },
    { id: 'invoiced', name: 'Invoiced', open: false },
    { id: 'cancelled', name: 'Cancelled', open: false }
  ];
  var STATUS = {}; STATUSES.forEach(function (s) { STATUS[s.id] = s; });
  var TRANSITIONS = {
    new: ['scheduled', 'cancelled'],
    scheduled: ['new', 'travelling', 'onsite', 'cancelled'],
    travelling: ['onsite', 'scheduled', 'cancelled'],
    onsite: ['done', 'parts'],
    parts: ['scheduled', 'new', 'cancelled'],
    done: ['invoiced'],
    invoiced: [],
    cancelled: ['new']
  };
  function canMove(from, to) { return !!(TRANSITIONS[from] && TRANSITIONS[from].indexOf(to) >= 0); }
  function isOpen(status) { return !!(STATUS[status] && STATUS[status].open); }
  /** statuses that occupy a technician's window on the board */
  var BOOKED = { scheduled: 1, travelling: 1, onsite: 1, done: 1, invoiced: 1 };
  function isBooked(job) { return !!(job && BOOKED[job.status] && job.techId && isDate(job.date) && winIndex(job.window) >= 0); }

  var TYPES = [
    { id: 'service', name: 'Annual service', span: 1 },
    { id: 'repair', name: 'Repair', span: 1 },
    { id: 'install', name: 'Installation', span: 4 },
    { id: 'commission', name: 'Commissioning', span: 2 },
    { id: 'warranty', name: 'Warranty check', span: 1 }
  ];
  var TYPE = {}; TYPES.forEach(function (t) { TYPE[t.id] = t; });
  var PRIORITIES = [{ id: 'normal', name: 'Normal' }, { id: 'high', name: 'High' }, { id: 'emergency', name: 'Emergency' }];
  var PRIORITY = {}; PRIORITIES.forEach(function (p) { PRIORITY[p.id] = p; });

  var KINDS = [
    { id: 'hp', name: 'Air-to-water heat pump', short: 'Heat pump', skill: 'hp', interval: 12, refrigerant: true },
    { id: 'gas', name: 'Gas condensing boiler', short: 'Gas boiler', skill: 'gas', interval: 12, refrigerant: false },
    { id: 'ac', name: 'Split air conditioner', short: 'Air conditioner', skill: 'ac', interval: 12, refrigerant: true },
    { id: 'vent', name: 'Ventilation unit with heat recovery', short: 'Ventilation', skill: 'vent', interval: 6, refrigerant: false },
    { id: 'solar', name: 'Solar thermal', short: 'Solar thermal', skill: 'hp', interval: 24, refrigerant: false }
  ];
  var KIND = {}; KINDS.forEach(function (k) { KIND[k.id] = k; });
  var SKILLS = [{ id: 'hp', name: 'Heat pumps' }, { id: 'gas', name: 'Gas boilers' }, { id: 'ac', name: 'Air conditioning' }, { id: 'vent', name: 'Ventilation' }, { id: 'el', name: 'Electrical' }];
  var SKILL = {}; SKILLS.forEach(function (s) { SKILL[s.id] = s; });
  var PLANS = [
    { id: 'none', name: 'No plan', text: 'Pays for every visit' },
    { id: 'basic', name: 'Basic', text: 'Annual service included' },
    { id: 'premium', name: 'Premium', text: 'Annual service included, repairs within 24 h, no call-out fee' }
  ];
  var PLAN = {}; PLANS.forEach(function (p) { PLAN[p.id] = p; });
  var PLAN_RANK = { premium: 0, basic: 1, none: 2 };
  function planRank(p) { return PLAN_RANK[p] != null ? PLAN_RANK[p] : 2; }

  /** skills a technician needs for this kind of equipment and job; installing or commissioning a heat pump or an
   * air conditioner also needs an electrician */
  function requiredSkills(kind, type) {
    var k = KIND[kind], s = k ? [k.skill] : [];
    if ((type === 'install' || type === 'commission') && (kind === 'hp' || kind === 'ac')) s.push('el');
    return s;
  }
  function missingSkills(tech, kind, type) { var have = (tech && tech.skills) || []; return requiredSkills(kind, type).filter(function (s) { return have.indexOf(s) < 0; }); }
  /** default number of two-hour windows a job takes */
  function defaultSpan(type, kind) {
    if (type === 'install') return kind === 'ac' ? 2 : 4;
    return TYPE[type] ? TYPE[type].span : 1;
  }
  function jobSpan(job) { return Math.max(1, Math.min(WINDOWS.length, Math.round(+(job && job.span) || 1))); }
  /** [first, last + 1) window indexes a booked job occupies, or null */
  function winRange(job) { var i = winIndex(job && job.window); return i < 0 ? null : [i, Math.min(WINDOWS.length, i + jobSpan(job))]; }

  // ── towns and road distances (approximate km, one way) ───────────────────
  // the last two are just across the border in Croatia (customers there get Croatian texts and a SEPA QR code)
  var TOWNS = [
    ['Celje', '3000'], ['Žalec', '3310'], ['Velenje', '3320'], ['Laško', '3270'], ['Šentjur', '3230'], ['Slovenske Konjice', '3210'],
    ['Šmarje pri Jelšah', '3240'], ['Mozirje', '3330'], ['Ljubljana', '1000'], ['Vojnik', '3212'], ['Štore', '3220'], ['Polzela', '3313'],
    ['Šoštanj', '3325'], ['Prebold', '3312'], ['Rogaška Slatina', '3250'], ['Zreče', '3214'], ['Nazarje', '3331'], ['Braslovče', '3314'],
    ['Hum na Sutli', '49231', 'HR'], ['Pregrada', '49218', 'HR']
  ].map(function (t) { return { name: t[0], postal: t[1], country: t[2] || 'SI' }; });
  // lower triangle: row i lists the distance to towns 0 … i−1
  var DIST_ROWS = [
    [], [10], [24, 16], [11, 16, 32], [14, 24, 35, 19], [22, 28, 31, 32, 17], [26, 36, 45, 30, 12, 18], [34, 24, 15, 38, 47, 46, 58],
    [76, 66, 75, 75, 92, 100, 104, 61], [10, 15, 22, 21, 14, 13, 23, 35, 87], [6, 16, 29, 12, 8, 20, 21, 39, 84, 10],
    [20, 10, 12, 24, 34, 36, 45, 14, 65, 23, 26], [30, 22, 7, 38, 42, 38, 52, 10, 72, 28, 35, 15], [17, 8, 18, 19, 31, 36, 43, 20, 62, 23, 22, 7, 21],
    [38, 47, 56, 42, 24, 26, 12, 69, 117, 35, 33, 57, 63, 55], [24, 28, 28, 35, 23, 6, 25, 42, 99, 14, 23, 34, 34, 35, 32],
    [34, 24, 17, 37, 47, 47, 59, 3, 58, 36, 39, 14, 13, 19, 70, 44], [24, 14, 12, 28, 37, 39, 49, 10, 63, 26, 29, 4, 13, 9, 60, 37, 10],
    [42, 51, 60, 45, 28, 31, 15, 73, 118, 39, 37, 61, 67, 59, 6, 37, 74, 64], [52, 61, 70, 53, 38, 41, 25, 83, 120, 49, 47, 71, 77, 69, 16, 47, 84, 74, 11]
  ];
  var TOWN_IX = {}; TOWNS.forEach(function (t, i) { TOWN_IX[t.name] = i; });
  /** one-way road km between two towns of the table; 0 for the same town, null when a town is not in the table */
  function distanceKm(a, b) {
    var i = TOWN_IX[a], j = TOWN_IX[b];
    if (i == null || j == null) return null;
    if (i === j) return 0;
    return i > j ? DIST_ROWS[i][j] : DIST_ROWS[j][i];
  }
  var LOCAL_KM = 4; // a visit inside the home town, one way
  /** km driven for one visit: base → customer → base */
  function tripKm(base, town) { var d = distanceKm(base, town); if (d == null) d = 25; return 2 * Math.max(d, LOCAL_KM); }
  function postalOf(town) { var i = TOWN_IX[town]; return i == null ? '' : TOWNS[i].postal; }
  /** two-letter country of a customer: their own `country` when set, else the country of their town (Slovenia by default) */
  function countryOf(c) {
    if (c && typeof c.country === 'string' && /^[A-Z]{2}$/.test(c.country)) return c.country;
    var i = c ? TOWN_IX[c.city] : null;
    return i == null ? 'SI' : TOWNS[i].country;
  }
  var COUNTRY_NAMES = { SI: 'Slovenia', HR: 'Croatia' };
  /** language for texts to a customer: Croatian for Croatia, Slovene for Slovenia, English for anyone else */
  function langOf(c) { var k = countryOf(c); return k === 'HR' ? 'hr' : k === 'SI' ? 'sl' : 'en'; }

  // ── SLA ──────────────────────────────────────────────────────────────────
  var DEFAULT_SLA = { premium: 24, basic: 72, none: 120 };
  var RISK_MIN = 240; // "at risk" when the due time is 4 hours away or less
  /** response time in hours: repairs only; services, installations and checks are agreed with the customer */
  function slaHours(job, plan, settings) {
    if (!job || job.type !== 'repair') return null;
    var t = (settings && settings.sla) || DEFAULT_SLA, h = +t[PLAN[plan] ? plan : 'none'];
    return h > 0 ? h : null;
  }
  function slaDue(job, plan, settings) { var h = slaHours(job, plan, settings); return h && isStamp(job.reportedAt) ? addMin(job.reportedAt, h * 60) : null; }
  /** when the technician first arrived (first visit of a job that needed several) */
  function firstArrival(job) { var v = (job.visits || []).filter(function (x) { return isStamp(x.arriveAt); }); return v.length ? v[0].arriveAt : (isStamp(job.arriveAt) ? job.arriveAt : null); }
  /** state: none | ok | risk (due within 4 h) | overdue | met | missed. The SLA counts until the technician arrives. */
  function slaState(job, plan, now, settings) {
    var due = slaDue(job, plan, settings);
    if (!due || job.status === 'cancelled') return { state: 'none', due: due };
    var hit = firstArrival(job);
    if (hit) return { state: hit <= due ? 'met' : 'missed', due: due, at: hit };
    var left = minutesBetween(now, due), wi = winIndex(job.window);
    var planned = isDate(job.date) && wi >= 0 ? stamp(job.date, WINDOWS[wi].start) : null;
    return { state: left < 0 ? 'overdue' : left <= RISK_MIN ? 'risk' : 'ok', due: due, left: left, plannedLate: !!(planned && planned > due) };
  }

  // ── checklist ────────────────────────────────────────────────────────────
  /** item: { id, t: 'pf' | 'num' | 'choice', req, unit, lo, hi, opts }; a value is 'pass' | 'fail' | 'na', a number or an option id */
  function answered(item, v) {
    if (v === undefined || v === null || v === '') return false;
    if (item.t === 'pf') return v === 'pass' || v === 'fail' || v === 'na';
    if (item.t === 'num') return v === 'na' || (typeof v === 'number' && isFinite(v));
    if (item.t === 'choice') return typeof v === 'string' && (!item.opts || item.opts.some(function (o) { return o.id === v; }));
    return true;
  }
  function hasNum(x) { return x !== null && x !== undefined && x !== '' && isFinite(+x); }
  function outOfRange(item, v) {
    if (!item || item.t !== 'num' || typeof v !== 'number' || !isFinite(v)) return false;
    return (hasNum(item.lo) && v < +item.lo) || (hasNum(item.hi) && v > +item.hi);
  }
  function checklistStatus(items, res) {
    res = res || {};
    var o = { total: 0, answered: 0, required: 0, missing: [], fails: 0, out: 0 };
    (items || []).forEach(function (it) {
      if (!it || it.off) return;
      var v = res[it.id], a = answered(it, v);
      o.total++;
      if (a) o.answered++;
      if (it.req) { o.required++; if (!a) o.missing.push(it.id); }
      if (it.t === 'pf' && v === 'fail') o.fails++;
      if (outOfRange(it, v)) o.out++;
    });
    o.complete = o.missing.length === 0;
    return o;
  }

  // ── pricing ──────────────────────────────────────────────────────────────
  function cents(x) { return Math.round((+x || 0) * 100); }
  function eur(c) { return Math.round(c) / 100; }
  /** labour is billed in started quarter hours */
  function billedMinutes(min, step) { step = step || 15; min = Math.max(0, Math.round(+min || 0)); return Math.ceil(min / step) * step; }
  /** what a job charges by default. Plan customers' annual services are covered (parts are charged), Premium repairs have
   * no call-out fee, warranty work is free; installations and commissioning are quoted, so there is no call-out fee. */
  function defaultBilling(type, plan, underWarranty) {
    if (type === 'warranty' || (type === 'repair' && underWarranty)) return { labour: false, callout: false, km: false, parts: false, why: 'warranty' };
    if (type === 'service' && (plan === 'basic' || plan === 'premium')) return { labour: false, callout: false, km: false, parts: true, why: 'plan' };
    var b = { labour: true, callout: true, km: true, parts: true, why: '' };
    if (type === 'repair' && plan === 'premium') { b.callout = false; b.why = 'plan'; }
    if (type === 'install' || type === 'commission') b.callout = false;
    return b;
  }
  var RATE_KEYS = ['labourRate', 'callout', 'freeKm', 'kmRate', 'emergencyPct', 'vat'];
  /** the rates a job is priced with, kept on the job when it is signed so later rate changes do not alter it */
  function frozenRates(settings) { var o = {}; RATE_KEYS.forEach(function (k) { o[k] = +(settings && settings[k]) || 0; }); return o; }
  /** Price a job. settings: { labourRate, callout, freeKm, kmRate, emergencyPct, vat }; a job's own `rates` win.
   * partsById: { id: {code, name, unit} }. Returns euros; lines are what goes on the invoice. VAT is charged on the net total. */
  function priceJob(job, settings, partsById) {
    var s = job.rates || settings || {}, b = job.billing || { labour: true, callout: true, km: true, parts: true }, lines = [];
    var minutes = Math.max(0, Math.round(+job.labourMin || 0)), billed = billedMinutes(minutes, 15);
    var labourC = b.labour ? Math.round(billed * cents(s.labourRate) / 60) : 0;
    var emergency = job.priority === 'emergency' && b.labour;
    var surC = emergency ? Math.round(labourC * (+s.emergencyPct || 0) / 100) : 0;
    var callC = b.callout ? cents(s.callout) : 0;
    var km = Math.max(0, Math.round(+job.km || 0)), kmCharged = b.km ? Math.max(0, km - Math.max(0, Math.round(+s.freeKm || 0))) : 0;
    var kmC = Math.round(kmCharged * cents(s.kmRate));
    if (billed > 0) lines.push({ kind: 'labour', code: 'LAB', qty: billed / 60, unit: 'h', unitPrice: b.labour ? +s.labourRate || 0 : 0, net: eur(labourC), covered: !b.labour });
    if (surC > 0) lines.push({ kind: 'surcharge', code: 'EMR', qty: 1, unit: 'pc', unitPrice: eur(surC), net: eur(surC), pct: +s.emergencyPct || 0 });
    if (callC > 0) lines.push({ kind: 'callout', code: 'CALL', qty: 1, unit: 'pc', unitPrice: eur(callC), net: eur(callC) });
    if (kmC > 0) lines.push({ kind: 'km', code: 'KM', qty: kmCharged, unit: 'km', unitPrice: +s.kmRate || 0, net: eur(kmC) });
    var partsC = 0;
    (job.parts || []).forEach(function (p) {
      var qty = Math.max(0, +p.qty || 0); if (!qty) return;
      var unitC = cents(p.price), lineC = b.parts ? Math.round(qty * unitC) : 0, cat = (partsById && partsById[p.partId]) || {};
      partsC += lineC;
      lines.push({ kind: 'part', partId: p.partId, code: cat.code || p.partId, qty: qty, unit: cat.unit || 'pc', unitPrice: b.parts ? eur(unitC) : 0, net: eur(lineC), covered: !b.parts });
    });
    var netC = labourC + surC + callC + kmC + partsC, vatRate = +s.vat || 0, vatC = Math.round(netC * vatRate / 100);
    return {
      lines: lines, labourMin: minutes, billedMin: billed, labour: eur(labourC), surcharge: eur(surC), callout: eur(callC), km: km, kmCharged: kmCharged,
      kmCost: eur(kmC), parts: eur(partsC), other: eur(callC + kmC), net: eur(netC), vatRate: vatRate, vat: eur(vatC), total: eur(netC + vatC), billing: b
    };
  }

  // ── maintenance ──────────────────────────────────────────────────────────
  /** next service date: last service (or installation) + interval months */
  function nextDue(asset) {
    if (!asset) return null;
    var base = isDate(asset.lastService) ? asset.lastService : isDate(asset.installed) ? asset.installed : null, iv = Math.round(+asset.interval || 0);
    return base && iv > 0 ? addMonths(base, iv) : null;
  }
  function dueBucket(due, today) {
    if (!isDate(due)) return null;
    var d = diffDays(today, due);
    return d < 0 ? 'overdue' : d <= 30 ? 'd30' : d <= 60 ? 'd60' : d <= 90 ? 'd90' : 'later';
  }
  function hasPlan(c) { return !!(c && (c.plan === 'basic' || c.plan === 'premium')); }
  /** assets due for service within `horizon` days (and overdue ones), plan customers first, then by due date.
   * Equipment not installed yet is left out; `open` is an open service job that already covers the asset.
   * `when` is the day the service happens: the booked day of the open job, else the due date; the bucket follows it,
   * so a plan visit that is booked for next week is not "overdue" (it is overdue again if that day passes undone).
   * Customers without a plan have no visit owed: when their equipment is past due and nobody booked it, the bucket is
   * 'remind' (send them a reminder) instead of 'overdue'. */
  function maintenanceList(db, today, horizon) {
    var cust = {}, open = {};
    (db.customers || []).forEach(function (c) { cust[c.id] = c; });
    (db.jobs || []).forEach(function (j) { if (j.type === 'service' && isOpen(j.status)) open[j.assetId] = j; });
    var end = addDays(today, horizon == null ? 90 : horizon), rows = [];
    (db.assets || []).forEach(function (a) {
      if (a.removed || !isDate(a.installed) || a.installed > today) return;
      var due = nextDue(a); if (!due || due > end) return;
      var c = cust[a.customerId]; if (!c) return;
      var o = open[a.id] || null, booked = o && isDate(o.date) && o.status !== 'new' && o.status !== 'parts' ? o.date : '', when = booked || due;
      var bucket = !hasPlan(c) && !o && due < today ? 'remind' : dueBucket(when, today);
      rows.push({ asset: a, customer: c, due: due, days: diffDays(today, due), when: when, booked: booked, bucket: bucket, open: o });
    });
    rows.sort(function (x, y) { return planRank(x.customer.plan) - planRank(y.customer.plan) || (x.due < y.due ? -1 : x.due > y.due ? 1 : 0) || (x.asset.id < y.asset.id ? -1 : 1); });
    return rows;
  }

  // ── automatic visits for service-plan customers ──────────────────────────
  var PLAN_AUTO = { on: true, horizon: 28, early: 10, perDay: 3, searchDays: 60 };
  /** the automatic-visit settings with defaults filled in */
  function planAuto(settings) {
    var s = (settings && settings.planAuto) || {}, o = {};
    Object.keys(PLAN_AUTO).forEach(function (k) { o[k] = s[k] == null || (k !== 'on' && !(+s[k] >= 0)) ? PLAN_AUTO[k] : k === 'on' ? s[k] !== false : Math.round(+s[k]); });
    return o;
  }
  /** id of the automatic visit for one asset and one due date: the same on every device, so it is never made twice */
  function planVisitId(assetId, due) { return 'jv-' + assetId + '-' + due; }
  /** Service-plan visits that are due and not covered yet, booked onto technicians within capacity. Pure: returns
   * [{ id, assetId, customerId, due, techId, date, window }] (techId '' when no free window was found in `searchDays`
   * working days; such a visit waits in the queue) and changes nothing.
   *  - Basic and Premium customers only (the plan includes the service); equipment installed and not removed.
   *  - Due = last service (or installation) + the equipment's interval (12 months, 6 for ventilation, 24 for solar),
   *    so when a visit is done the next one is due a year (one interval) later.
   *  - Booked when it is due within `horizon` days (28) or already overdue, at the earliest `early` days (10) before the due
   *    date and never before the next working day.
   *  - Skipped when the asset already has an open service job (whoever made it), or a job made for this due date exists
   *    in any state (also cancelled: someone decided), so running it again, every day or on another device, adds nothing.
   *  - Capacity: a technician with the right skills, at most `perDay` (3) of the 4 windows booked that day, all jobs
   *    counted, so a window stays free for repairs; nearest technician first (more than `farKm` away counts as far),
   *    then the emptier day. Overdue visits first, then by due date, Premium before Basic.
   * opts: { now, hmap, techs, settings } — settings default to db.settings. */
  function planVisits(db, today, opts) {
    opts = opts || {};
    var st = opts.settings || db.settings || {}, pa = planAuto(st);
    if (!pa.on) return [];
    var hmap = opts.hmap || holidayMap(st.holidays), far = +st.farKm > 0 ? +st.farKm : 35;
    var techs = (opts.techs || db.techs || []).filter(function (t) { return t && t.active !== false; });
    var cust = {}, openSvc = {}, made = {}, recent = {}, occ = {};
    (db.customers || []).forEach(function (c) { cust[c.id] = c; });
    (db.jobs || []).forEach(function (j) {
      if (j.type === 'service' && isOpen(j.status)) openSvc[j.assetId] = 1;
      if (j.planDue) made[j.assetId + '|' + j.planDue] = 1;
      if (j.id) made['id|' + j.id] = 1;
      if (j.type === 'service' && isDone(j)) { var fd = dateOf(j.finishAt); if (!recent[j.assetId] || fd > recent[j.assetId]) recent[j.assetId] = fd; }
      if (isBooked(j)) { var k = j.date + '|' + j.techId, o = occ[k] || (occ[k] = [0, 0, 0, 0]), r = winRange(j); for (var w = r[0]; w < r[1]; w++) o[w] = 1; }
    });
    var first = nextWorkday(today, hmap), end = addDays(today, pa.horizon), want = [];
    (db.assets || []).forEach(function (a) {
      var c = cust[a.customerId];
      if (!hasPlan(c) || a.removed || !isDate(a.installed) || a.installed > today || !KIND[a.kind]) return;
      var due = nextDue(a); if (!due || due > end) return;
      if (openSvc[a.id] || made[a.id + '|' + due] || made['id|' + planVisitId(a.id, due)]) return;
      // a service finished in the second half of the interval already counts (lastService not updated by hand yet)
      if (recent[a.id] && recent[a.id] >= addMonths(due, -Math.max(1, Math.round((+a.interval || 12) / 2)))) return;
      want.push({ a: a, c: c, due: due });
    });
    want.sort(function (x, y) { return (x.due < y.due ? -1 : x.due > y.due ? 1 : 0) || planRank(x.c.plan) - planRank(y.c.plan) || (x.a.id < y.a.id ? -1 : 1); });
    function used(k) { var o = occ[k]; return o ? o[0] + o[1] + o[2] + o[3] : 0; }
    var out = [];
    want.forEach(function (x) {
      var need = requiredSkills(x.a.kind, 'service'), who = techs.filter(function (t) { return need.every(function (s) { return (t.skills || []).indexOf(s) >= 0; }); });
      var start = workdayOnOrAfter(addDays(x.due, -pa.early), hmap); if (start < first) start = first;
      var h = 0; for (var i = 0; i < x.a.id.length; i++) h = (h * 31 + x.a.id.charCodeAt(i)) % 9973;
      var order = [h % 4, (h + 1) % 4, (h + 2) % 4, (h + 3) % 4], v = { id: planVisitId(x.a.id, x.due), assetId: x.a.id, customerId: x.c.id, due: x.due, techId: '', date: '', window: '' };
      for (var d = start, n = 0; n < pa.searchDays && !v.techId; d = nextWorkday(d, hmap), n++) {
        var best = null;
        who.forEach(function (t, ti) {
          var k = d + '|' + t.id, u = used(k); if (u >= pa.perDay) return;
          var km = distanceKm(t.base, x.c.city); if (km == null) km = 40;
          var cost = (km > far ? km + 100 : km) + u * 6 + ti * 0.01;
          if (!best || cost < best.cost) best = { t: t, k: k, cost: cost };
        });
        if (!best) continue;
        var o = occ[best.k] || (occ[best.k] = [0, 0, 0, 0]);
        for (var wi = 0; wi < 4; wi++) if (!o[order[wi]]) { o[order[wi]] = 1; v.techId = best.t.id; v.date = d; v.window = WINDOWS[order[wi]].id; break; }
      }
      out.push(v);
    });
    return out;
  }

  // ── KPIs ─────────────────────────────────────────────────────────────────
  function isDone(job) { return (job.status === 'done' || job.status === 'invoiced') && isStamp(job.finishAt); }
  var FTF_DAYS = 30;
  /** repairs (not cancelled) by equipment, so first-time fix does not scan every job for every job */
  function repairIndex(jobs) {
    var idx = {};
    (jobs || []).forEach(function (o) { if (o.type === 'repair' && o.status !== 'cancelled' && isStamp(o.reportedAt)) (idx[o.assetId] = idx[o.assetId] || []).push(o); });
    return idx;
  }
  /** done in one visit, and no repair on the same equipment was reported in the 30 days after it was finished */
  function isFirstTimeFix(job, jobs, days, idx) {
    if (!isDone(job)) return null;
    if (job.visits && job.visits.length) return false;
    var end = addMin(job.finishAt, (days || FTF_DAYS) * 1440), list = idx ? (idx[job.assetId] || []) : (jobs || []);
    return !list.some(function (o) {
      return o.id !== job.id && o.assetId === job.assetId && o.type === 'repair' && o.status !== 'cancelled' && isStamp(o.reportedAt) && o.reportedAt > job.finishAt && o.reportedAt <= end;
    });
  }
  /** first-time-fix rate of repairs and services finished from `from` to `to`; jobs whose 30 days are not over by `asOf` wait.
   * opts.index: a repairIndex(jobs) to reuse across calls */
  function ftfRate(jobs, opts) {
    opts = opts || {};
    var types = opts.types || ['repair', 'service'], n = 0, ok = 0, idx = opts.index || repairIndex(jobs);
    (jobs || []).forEach(function (j) {
      if (!isDone(j) || types.indexOf(j.type) < 0) return;
      var d = dateOf(j.finishAt);
      if ((opts.from && d < opts.from) || (opts.to && d > opts.to)) return;
      if (opts.asOf && addDays(d, FTF_DAYS) > opts.asOf) return;
      n++; if (isFirstTimeFix(j, jobs, null, idx)) ok++;
    });
    return { n: n, ok: ok, rate: n ? ok / n : null };
  }
  /** on-site intervals of a job, one per visit: [{ techId, date, min }] */
  function onsiteSpans(job) {
    var out = [];
    (job.visits || []).forEach(function (v) { if (isStamp(v.arriveAt) && isStamp(v.leftAt)) out.push({ techId: v.techId, date: dateOf(v.arriveAt), min: Math.max(0, minutesBetween(v.arriveAt, v.leftAt)) }); });
    if (isStamp(job.arriveAt) && isStamp(job.finishAt)) out.push({ techId: job.techId, date: dateOf(job.arriveAt), min: Math.max(0, minutesBetween(job.arriveAt, job.finishAt)) });
    return out;
  }
  function onsiteMinutes(job) { return onsiteSpans(job).reduce(function (s, x) { return s + x.min; }, 0); }
  /** driving time of each visit (travel start to arrival): [{ techId, date, min }] */
  function travelSpans(job) {
    var out = [];
    (job.visits || []).forEach(function (v) { if (isStamp(v.travelAt) && isStamp(v.arriveAt)) out.push({ techId: v.techId, date: dateOf(v.arriveAt), min: Math.max(0, minutesBetween(v.travelAt, v.arriveAt)) }); });
    if (isStamp(job.travelAt) && isStamp(job.arriveAt)) out.push({ techId: job.techId, date: dateOf(job.arriveAt), min: Math.max(0, minutesBetween(job.travelAt, job.arriveAt)) });
    return out;
  }
  /** for one technician: on-site hours and driving hours ÷ available hours (working days × hours a day).
   * rate = on site only; rateTravel counts driving between jobs as productive too */
  function utilisation(jobs, techId, from, to, hmap, hoursPerDay) {
    var on = 0, tr = 0, inR = function (s) { return s.techId === techId && s.date >= from && s.date <= to; };
    (jobs || []).forEach(function (j) {
      if (!(j.visits && j.visits.length)) { // quick skip: most jobs are one visit by someone else or on another day
        if (j.techId !== techId || typeof j.arriveAt !== 'string') return;
        var d = j.arriveAt.slice(0, 10); if (d < from || d > to) return;
      }
      onsiteSpans(j).forEach(function (s) { if (inR(s)) on += s.min; });
      travelSpans(j).forEach(function (s) { if (inR(s)) tr += s.min; });
    });
    var days = workdays(from, to, hmap), avail = days * (hoursPerDay > 0 ? hoursPerDay : 8) * 60;
    return { onsite: on, travel: tr, avail: avail, days: days, rate: avail ? on / avail : null, rateTravel: avail ? (on + tr) / avail : null };
  }

  // ── scheduling conflicts ─────────────────────────────────────────────────
  /** Warnings for putting `job` on technician / date / window. ctx: { jobs, tech, asset, customer, settings, hmap, now }.
   * Each: { code, level: 'error' | 'warn', text }. Errors block; warnings ask for a confirmation. */
  function conflicts(job, a, ctx) {
    var out = [], tech = ctx.tech, i = winIndex(a.window), span = jobSpan(job);
    if (!tech) return [{ code: 'tech', level: 'error', text: 'Choose a technician.' }];
    if (!isDate(a.date)) return [{ code: 'date', level: 'error', text: 'Choose a date.' }];
    if (i < 0) return [{ code: 'window', level: 'error', text: 'Choose a time window.' }];
    var label = WINDOWS[i].start + '–' + WINDOWS[Math.min(WINDOWS.length, i + span) - 1].end;
    if (i + span > WINDOWS.length) out.push({ code: 'span', level: 'error', text: 'It takes ' + span + ' windows and does not fit after ' + WINDOWS[i].start + '.' });
    (ctx.jobs || []).forEach(function (o) {
      if (o.id === job.id || o.techId !== tech.id || o.date !== a.date || !isBooked(o)) return;
      var r = winRange(o);
      if (r && r[0] < i + span && i < r[1]) out.push({ code: 'double', level: 'warn', job: o.id, text: tech.name + ' already has ' + (o.no || 'a job') + ' at ' + WINDOWS[r[0]].start + '–' + WINDOWS[r[1] - 1].end + '.' });
    });
    var miss = missingSkills(tech, ctx.asset && ctx.asset.kind, job.type);
    if (miss.length) out.push({ code: 'skill', level: 'warn', text: tech.name + ' has no ' + miss.map(function (s) { return (SKILL[s] ? SKILL[s].name : s).toLowerCase(); }).join(' or ') + ' skill.' });
    var s = ctx.settings || {}, town = ctx.customer && ctx.customer.city, km = distanceKm(tech.base, town), far = +s.farKm > 0 ? +s.farKm : 35;
    if (km == null && town) out.push({ code: 'far', level: 'warn', text: 'No distance known from ' + tech.base + ' to ' + town + '.' });
    else if (km != null && km > far) out.push({ code: 'far', level: 'warn', km: km, text: town + ' is ' + km + ' km from ' + tech.base + ' (more than ' + far + ' km).' });
    if (!isWorkday(a.date, ctx.hmap)) out.push({ code: 'dayoff', level: 'warn', text: (ctx.hmap && ctx.hmap[a.date] ? ctx.hmap[a.date] + ' (public holiday)' : 'A weekend day') + '.' });
    var due = slaDue(job, ctx.customer && ctx.customer.plan, s);
    if (due && stamp(a.date, WINDOWS[i].start) > due) out.push({ code: 'sla', level: 'warn', text: 'Starts after the SLA is due (' + fmtStamp(due) + ').' });
    if (ctx.now && stamp(a.date, WINDOWS[Math.min(WINDOWS.length, i + span) - 1].end) <= ctx.now) out.push({ code: 'past', level: 'warn', text: label + ' on ' + fmtDate(a.date) + ' is already over.' });
    return out;
  }

  // ── numbering ────────────────────────────────────────────────────────────
  function jobNo(year, seq) { return 'SJ-' + year + '-' + String(seq).padStart(4, '0'); }
  function parseJobNo(no) { var m = /^SJ-(\d{4})-(\d{4,})$/.exec(String(no || '')); return m ? { year: +m[1], seq: +m[2] } : null; }
  /** next number of the year: one above the highest used, so cancelled numbers are never reused */
  function nextJobNo(jobs, year) {
    var max = 0;
    (jobs || []).forEach(function (j) { var p = parseJobNo(j.no); if (p && p.year === +year && p.seq > max) max = p.seq; });
    return jobNo(year, max + 1);
  }

  /** the job for one automatic visit (from planVisits): an annual service, booked (status scheduled) when a technician
   * was found, else new with the due date as the preferred day. `now` is the creation time; `no` its job number. */
  function planJob(v, asset, customer, now, no) {
    var booked = !!(v.techId && isDate(v.date) && winIndex(v.window) >= 0), day = dateOf(now);
    return {
      id: v.id, no: no, customerId: customer.id, assetId: asset.id, type: 'service', priority: 'normal', problem: 'Annual service as per the service plan.', source: 'plan',
      reportedAt: now, createdAt: now, preferredDate: booked ? '' : (v.due > day ? v.due : ''), status: booked ? 'scheduled' : 'new', date: booked ? v.date : '', window: booked ? v.window : '',
      span: defaultSpan('service', asset.kind), techId: booked ? v.techId : '', travelAt: '', arriveAt: '', finishAt: '', stage: '', checklist: { key: 'service|' + asset.kind, res: {} }, notes: '', parts: [],
      labourMin: 0, km: 0, billing: defaultBilling('service', customer.plan, !!(asset.warrantyUntil && day <= asset.warrantyUntil)), photos: [], signature: null, followUp: false, followUpOf: '',
      followUpId: '', visits: [], invoicedAt: '', cancelledAt: '', cancelReason: '', partsNote: '', planDue: v.due,
      log: [{ at: now, by: 'Service plan', text: 'Created automatically: ' + (customer.plan === 'premium' ? 'Premium' : 'Basic') + ' plan visit due ' + fmtDate(v.due) + (booked ? '; booked ' + fmtDate(v.date) + ' ' + WINDOWS[winIndex(v.window)].label : '; no free window yet') }]
    };
  }

  // ── "on my way" text ─────────────────────────────────────────────────────
  /** driving minutes for a one-way distance, as the demo plans them: about 60 km/h plus parking; unknown towns 25 km */
  function travelMinutes(km) { if (km == null || !isFinite(+km)) km = 25; return 6 + Math.round(Math.max(3, +km) * 1.05); }
  /** arrival time: `now` (local wall clock) + minutes, rounded up to the next 5 minutes (better early than late) */
  function etaStamp(now, minutes) { var m = toMin(now) + Math.max(0, Math.round(+minutes || 0)); return fromMin(Math.ceil(m / 5) * 5); }
  /** time as written in Slovene and Croatian texts: 10.35 (the English text uses 10:35) */
  function clockText(s, lang) { var hm = hmOf(s); return lang === 'en' ? hm : hm.replace(':', '.'); }
  /** company name without the legal form, for a short message: "Termoplan Savinja d.o.o." → "Termoplan Savinja" */
  function shortCompany(name) { return String(name || '').replace(/,?\s+(d\.\s?o\.\s?o\.|j\.\s?d\.\s?o\.\s?o\.|d\.\s?d\.|s\.\s?p\.)$/i, '').trim(); }
  /** the text itself (sl / hr / en), filled with the technician, the company and the arrival time */
  function omwText(lang, o) {
    var L = I18N[lang] ? lang : 'sl';
    return t(L, 'omwSms', { name: o.name || '', company: shortCompany(o.company), time: clockText(o.eta, L) });
  }
  /** phone number reduced to + and digits, as tel: and sms: links want it */
  function dialable(p) { var s = String(p || '').replace(/[^\d+]/g, ''); return s.charAt(0) === '+' ? '+' + s.slice(1).replace(/\+/g, '') : s.replace(/\+/g, ''); }
  /** sms: link with the body: "?&body=" works on both iOS (reads &body=) and Android (reads ?body=) */
  function smsHref(phone, body) { return 'sms:' + dialable(phone) + '?&body=' + encodeURIComponent(body || ''); }
  /** numbers the demo uses: +386 1 000 … and +385 1 000 … are not given to subscribers, so a tap never rings anyone */
  function isSafeDemoPhone(p) { return /^\+38[56]10{3}\d{4}$/.test(dialable(p)); }

  // ── payment on the report ────────────────────────────────────────────────
  /** payment reference model SI00 + the job number's digits and hyphens, as Billing and Collections do:
   * SJ-2026-0412 → "SI00 2026-0412". Model 00 has no check digit (ZBS, "Navodila za uporabo modelov sklicevanja") */
  function paymentReference(no) {
    var s = String(no == null ? '' : no).replace(/[^0-9-]/g, '').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '').slice(0, 22);
    return s ? 'SI00 ' + s : '';
  }
  var EU = ['AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK'];
  /** which QR code a payer can scan: UPN QR (Slovenian banks, ZBS standard) for Slovenia, the EPC "BCD" SEPA QR
   * (EPC069-12) for the rest of the EU, none elsewhere (as Collections' qrKind) */
  function qrKind(country) { if (country === 'SI') return 'upn'; return EU.indexOf(country) >= 0 ? 'epc' : null; }
  function compactIban(s) { return String(s || '').replace(/\s+/g, '').toUpperCase(); }
  /** IBAN format check, plus whether the mod-97 check digits add up (the demo uses 00, which never does) */
  function ibanInfo(s) {
    var x = compactIban(s), ok = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(x), sum = false;
    if (ok) { var r = x.slice(4) + x.slice(0, 4), m = 0; for (var i = 0; i < r.length; i++) { var c = r.charCodeAt(i), v = c >= 65 ? String(c - 55) : r.charAt(i); for (var k = 0; k < v.length; k++) m = (m * 10 + +v.charAt(k)) % 97; } sum = m === 1; }
    return { iban: x, format: ok, checks: sum };
  }
  function ibanText(s) { return compactIban(s).replace(/(.{4})/g, '$1 ').trim(); }
  var PAY_METHODS = ['cash', 'card'];
  /** what the customer still owes after a payment taken on site; amounts in euros */
  function paidState(job, total) {
    var p = job && job.paidOnSite, totC = cents(total);
    if (!p || !(+p.amount > 0)) return { paid: 0, remaining: eur(Math.max(0, totC)), full: false, method: '' };
    var paidC = Math.min(cents(p.amount), Math.max(0, totC));
    return { paid: eur(cents(p.amount)), remaining: eur(Math.max(0, totC - paidC)), full: totC - paidC <= 0, method: p.method, at: p.at || '' };
  }
  /** Payment block of a done job's report. Returns null when nothing is to be paid; else
   * { kind: 'paid' | 'upn' | 'epc' | 'none', amount, reference, purpose, dueDate, iban, bic, name, street, city, paid } where
   * amount is what is left to pay (the full total unless part was paid on site).
   * UPN QR fields follow the ZBS "UPN QR" specification (as site/invoices/qr.js); purpose code GDSV (goods and services,
   * ISO 20022 ExternalPurpose1Code, as Collections); due date = report date + settings.payDays (8 by default). */
  function reportPayment(job, price, ctx) {
    ctx = ctx || {};
    var total = price ? price.total : 0; if (!(total > 0) || !isDone(job)) return null;
    var co = ctx.company || {}, st = ctx.settings || {}, lang = ctx.lang || 'sl', ps = paidState(job, total);
    var day = dateOf(job.finishAt) || ctx.today || '', payDays = +st.payDays >= 0 ? Math.round(+st.payDays) : 8;
    var base = { amount: ps.remaining, total: total, paid: ps, reference: paymentReference(job.no), dueDate: isDate(day) ? addDays(day, payDays) : '',
      iban: compactIban(co.iban), bic: String(co.bic || '').trim(), name: co.name || '', street: co.street || '', city: ((co.postal ? co.postal + ' ' : '') + (co.city || '')).trim(),
      purposeCode: /^[A-Z]{4}$/.test(st.purposeCode || '') ? st.purposeCode : 'GDSV' };
    if (ps.full) { base.kind = 'paid'; return base; }
    var kind = qrKind(ctx.country || 'SI');
    if (!kind || !ibanInfo(co.iban).format) { base.kind = 'none'; return base; }
    base.kind = kind;
    // UPN purpose is read by a Slovenian bank, so it is Slovene; the SEPA text follows the report's language
    base.purpose = (kind === 'upn' ? t('sl', 'payPurpose', { no: job.no }) : t(lang, 'payPurpose', { no: job.no })).slice(0, kind === 'upn' ? 42 : 100);
    base.text = kind === 'epc' ? (base.purpose + ', ' + base.reference).slice(0, 140) : '';
    return base;
  }

  // ── photos ───────────────────────────────────────────────────────────────
  /** size of a photo scaled to fit inside max × max without enlarging it */
  function fitWithin(w, h, max) {
    w = +w; h = +h; max = +max || 1600;
    if (!(w > 0 && h > 0)) return { w: 0, h: 0, scale: 0 };
    var s = Math.min(1, max / Math.max(w, h));
    return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)), scale: s };
  }

  // ── reports ──────────────────────────────────────────────────────────────
  function monthOf(d) { return d.slice(0, 7); }
  function inRange(d, from, to) { return (!from || d >= from) && (!to || d <= to); }
  /** done jobs per ISO week (Monday) from `from` to `to` */
  function jobsPerWeek(jobs, from, to) {
    var weeks = [], idx = {};
    for (var m = mondayOf(from); m <= to; m = addDays(m, 7)) { idx[m] = weeks.length; weeks.push({ week: m, n: 0, byType: {} }); }
    (jobs || []).forEach(function (j) {
      if (!isDone(j)) return; var d = dateOf(j.finishAt); if (!inRange(d, from, to)) return;
      var w = weeks[idx[mondayOf(d)]]; if (!w) return;
      w.n++; w.byType[j.type] = (w.byType[j.type] || 0) + 1;
    });
    return weeks;
  }
  /** share of repairs with an SLA where the technician arrived in time, by month of the report */
  function slaStats(jobs, planOf, settings, from, to) {
    var o = { n: 0, met: 0, byMonth: {} };
    (jobs || []).forEach(function (j) {
      if (j.status === 'cancelled' || !isStamp(j.reportedAt)) return;
      var d = dateOf(j.reportedAt); if (!inRange(d, from, to)) return;
      var st = slaState(j, planOf(j), '9999-12-31T00:00', settings);
      if (st.state !== 'met' && st.state !== 'missed') return;
      var m = monthOf(d), b = o.byMonth[m] || (o.byMonth[m] = { n: 0, met: 0 });
      o.n++; b.n++; if (st.state === 'met') { o.met++; b.met++; }
    });
    o.rate = o.n ? o.met / o.n : null;
    return o;
  }
  function avgOnsiteByType(jobs, from, to) {
    var by = {};
    (jobs || []).forEach(function (j) {
      if (!isDone(j) || !inRange(dateOf(j.finishAt), from, to)) return;
      var b = by[j.type] || (by[j.type] = { type: j.type, n: 0, min: 0 });
      b.n++; b.min += onsiteMinutes(j);
    });
    return TYPES.map(function (t) { var b = by[t.id] || { type: t.id, n: 0, min: 0 }; b.avg = b.n ? b.min / b.n : null; return b; });
  }
  /** net revenue of done jobs by month of completion: labour (with surcharges), parts, other (call-out, km) */
  function revenueByMonth(jobs, settings, partsById, from, to) {
    var by = {};
    (jobs || []).forEach(function (j) {
      if (!isDone(j)) return; var d = dateOf(j.finishAt); if (!inRange(d, from, to)) return;
      var p = priceJob(j, settings, partsById), m = monthOf(d), b = by[m] || (by[m] = { month: m, labour: 0, parts: 0, other: 0, net: 0, jobs: 0 });
      b.labour += cents(p.labour + p.surcharge); b.parts += cents(p.parts); b.other += cents(p.other); b.net += cents(p.net); b.jobs++;
    });
    return Object.keys(by).sort().map(function (k) { var b = by[k]; return { month: k, labour: eur(b.labour), parts: eur(b.parts), other: eur(b.other), net: eur(b.net), jobs: b.jobs }; });
  }
  function topParts(jobs, from, to) {
    var by = {};
    (jobs || []).forEach(function (j) {
      if (!isDone(j) || !inRange(dateOf(j.finishAt), from, to)) return;
      (j.parts || []).forEach(function (p) {
        var b = by[p.partId] || (by[p.partId] = { partId: p.partId, qty: 0, jobs: 0, net: 0 });
        b.qty += +p.qty || 0; b.jobs++; b.net += Math.round((+p.qty || 0) * cents(p.price));
      });
    });
    return Object.keys(by).map(function (k) { var b = by[k]; b.net = eur(b.net); b.qty = Math.round(b.qty * 100) / 100; return b; })
      .sort(function (a, b) { return b.jobs - a.jobs || b.qty - a.qty || (a.partId < b.partId ? -1 : 1); });
  }
  /** repairs per model, against how many units of that model are installed */
  function failingModels(jobs, assets, from, to) {
    var units = {}, kinds = {}, aById = {}, rep = {};
    (assets || []).forEach(function (a) { aById[a.id] = a; var k = a.brand + '|' + a.model; units[k] = (units[k] || 0) + 1; kinds[k] = a.kind; });
    (jobs || []).forEach(function (j) {
      if (j.type !== 'repair' || j.status === 'cancelled' || !isStamp(j.reportedAt) || !inRange(dateOf(j.reportedAt), from, to)) return;
      var a = aById[j.assetId]; if (!a) return;
      var k = a.brand + '|' + a.model; rep[k] = (rep[k] || 0) + 1;
    });
    return Object.keys(units).map(function (k) {
      var p = k.split('|');
      return { brand: p[0], model: p[1], kind: kinds[k] || '', units: units[k], repairs: rep[k] || 0, per100: (rep[k] || 0) * 100 / units[k] };
    }).sort(function (x, y) { return y.per100 - x.per100 || y.repairs - x.repairs || (x.model < y.model ? -1 : 1); });
  }

  // ── service report wording (sl / hr / en) ───────────────────────────────
  var I18N = {
    en: {
      omwSms: 'Hello, this is {name} from {company}. I am on my way to you and will arrive at about {time}. Kind regards',
      payTitle: 'Payment', payUpn: 'Pay with UPN QR', payEpc: 'Pay with a SEPA QR code', payScan: 'Scan the code with your banking app.', payee: 'Payee', iban: 'IBAN', reference: 'Reference',
      purpose: 'Purpose', payBy: 'Pay by', toPay: 'Amount to pay', payPurpose: 'Service report {no}', paidOnSite: 'Paid on site', paidCash: 'cash', paidCard: 'card',
      paidAmount: 'Paid', paidAt: 'Time', remaining: 'Left to pay', payNoQr: 'Pay by bank transfer to the account below.',
      title: 'Service report', reportNo: 'Report no.', date: 'Date', customer: 'Customer', site: 'Site', contact: 'Contact', phone: 'Phone', email: 'E-mail', vatId: 'VAT ID',
      equipment: 'Equipment', model: 'Model', serial: 'Serial no.', installed: 'Installed', warranty: 'Warranty until', refrigerant: 'Refrigerant', charge: 'charge',
      location: 'Location', jobType: 'Job type', priority: 'Priority', technician: 'Technician', arrival: 'Arrived', finished: 'Finished', onSite: 'Time on site',
      request: 'Request', workDone: 'Work done', checklist: 'Checklist', item: 'Item', result: 'Result', measured: 'Measured',
      pass: 'Pass', fail: 'Fail', na: 'N/A', outOfRange: 'outside the typical range',
      partsLabour: 'Parts and labour', code: 'Code', description: 'Description', qty: 'Qty', unitPrice: 'Unit price', amount: 'Amount',
      labour: 'Labour', surcharge: 'Emergency surcharge {n} %', callout: 'Call-out fee', km: 'Travel beyond {n} km', net: 'Net total', vat: 'VAT {n} %', total: 'Total',
      coveredPlan: 'Covered by the service plan', coveredService: 'Labour and travel are covered by the service plan', coveredCallout: 'Call-out fee included in the service plan', coveredWarranty: 'Under warranty, no charge', included: 'included',
      photos: 'Photos', signature: 'Customer signature', signedBy: 'Name', signedAt: 'Signed', notSigned: 'Not signed', reason: 'Reason',
      followUp: 'A follow-up visit is needed.', prices: 'Prices in EUR.', visits: 'Earlier visit', page: 'Page',
      units: { pc: 'pc', kg: 'kg', m: 'm', h: 'h', km: 'km' },
      types: { service: 'Annual service', repair: 'Repair', install: 'Installation', commission: 'Commissioning', warranty: 'Warranty check' },
      kinds: { hp: 'Air-to-water heat pump', gas: 'Gas condensing boiler', ac: 'Split air conditioner', vent: 'Ventilation unit with heat recovery', solar: 'Solar thermal system' },
      priorities: { normal: 'Normal', high: 'High', emergency: 'Emergency' },
      mailSubject: 'Service report {no}',
      mailBody: 'Dear customer,\n\nhere is a summary of our visit on {date}.\n\n{type}: {equipment}\nTechnician: {tech}\nWork done: {work}\nTotal incl. VAT: {total}\n\nThe full service report is attached as a PDF.\n\nKind regards,\n{company}\n{phone}'
    },
    sl: {
      omwSms: 'Pozdravljeni, tukaj {name} iz {company}. Na poti sem k vam, prispem približno ob {time}. Lep pozdrav',
      payTitle: 'Plačilo', payUpn: 'Plačilo z UPN QR', payEpc: 'Plačilo s kodo SEPA QR', payScan: 'Kodo skenirajte z aplikacijo svoje banke.', payee: 'Prejemnik', iban: 'IBAN', reference: 'Referenca',
      purpose: 'Namen', payBy: 'Rok plačila', toPay: 'Znesek za plačilo', payPurpose: 'Servisno poročilo {no}', paidOnSite: 'Plačano na kraju samem', paidCash: 'gotovina', paidCard: 'kartica',
      paidAmount: 'Plačano', paidAt: 'Čas', remaining: 'Ostane za plačilo', payNoQr: 'Plačilo z nakazilom na spodnji račun.',
      title: 'Servisno poročilo', reportNo: 'Številka poročila', date: 'Datum', customer: 'Naročnik', site: 'Lokacija', contact: 'Kontaktna oseba', phone: 'Telefon', email: 'E-pošta', vatId: 'ID za DDV',
      equipment: 'Naprava', model: 'Model', serial: 'Serijska številka', installed: 'Datum vgradnje', warranty: 'Garancija do', refrigerant: 'Hladivo', charge: 'polnitev',
      location: 'Mesto vgradnje', jobType: 'Vrsta storitve', priority: 'Prioriteta', technician: 'Serviser', arrival: 'Prihod', finished: 'Zaključek', onSite: 'Čas na lokaciji',
      request: 'Opis naročila', workDone: 'Opravljeno delo', checklist: 'Kontrolni seznam', item: 'Postavka', result: 'Rezultat', measured: 'Izmerjena vrednost',
      pass: 'Ustrezno', fail: 'Neustrezno', na: 'Ne velja', outOfRange: 'zunaj običajnega območja',
      partsLabour: 'Material in delo', code: 'Šifra', description: 'Opis', qty: 'Količina', unitPrice: 'Cena na enoto', amount: 'Znesek',
      labour: 'Delo', surcharge: 'Dodatek za nujni poseg {n} %', callout: 'Prihod na lokacijo', km: 'Prevoz nad {n} km', net: 'Skupaj brez DDV', vat: 'DDV {n} %', total: 'Skupaj z DDV',
      coveredPlan: 'Vključeno v servisni paket', coveredService: 'Delo in prevoz sta vključena v servisni paket', coveredCallout: 'Prihod na lokacijo je vključen v servisni paket', coveredWarranty: 'V okviru garancije, brez plačila', included: 'vključeno',
      photos: 'Fotografije', signature: 'Podpis naročnika', signedBy: 'Ime in priimek', signedAt: 'Podpisano', notSigned: 'Ni podpisano', reason: 'Razlog',
      followUp: 'Potreben je ponovni obisk.', prices: 'Cene so v EUR.', visits: 'Prejšnji obisk', page: 'Stran',
      units: { pc: 'kos', kg: 'kg', m: 'm', h: 'h', km: 'km' },
      types: { service: 'Letni servis', repair: 'Popravilo', install: 'Montaža', commission: 'Zagon', warranty: 'Garancijski pregled' },
      kinds: { hp: 'Toplotna črpalka zrak-voda', gas: 'Plinski kondenzacijski kotel', ac: 'Split klimatska naprava', vent: 'Prezračevalna naprava z rekuperacijo toplote', solar: 'Solarni sistem za pripravo tople vode' },
      priorities: { normal: 'Običajna', high: 'Visoka', emergency: 'Nujno' },
      mailSubject: 'Servisno poročilo {no}',
      mailBody: 'Spoštovani,\n\nv nadaljevanju je povzetek našega obiska dne {date}.\n\n{type}: {equipment}\nServiser: {tech}\nOpravljeno delo: {work}\nSkupaj z DDV: {total}\n\nCelotno servisno poročilo je priloženo v obliki PDF.\n\nLep pozdrav,\n{company}\n{phone}'
    },
    hr: {
      omwSms: 'Poštovani, ovdje {name} iz {company}. Na putu sam prema vama, stižem oko {time}. Lijep pozdrav',
      payTitle: 'Plaćanje', payUpn: 'Plaćanje UPN QR kodom', payEpc: 'Plaćanje SEPA QR kodom', payScan: 'Skenirajte kod aplikacijom svoje banke.', payee: 'Primatelj', iban: 'IBAN', reference: 'Poziv na broj',
      purpose: 'Opis plaćanja', payBy: 'Rok plaćanja', toPay: 'Iznos za plaćanje', payPurpose: 'Servisno izvješće {no}', paidOnSite: 'Plaćeno na licu mjesta', paidCash: 'gotovina', paidCard: 'kartica',
      paidAmount: 'Plaćeno', paidAt: 'Vrijeme', remaining: 'Preostalo za plaćanje', payNoQr: 'Plaćanje uplatom na račun u nastavku.',
      title: 'Servisno izvješće', reportNo: 'Broj izvješća', date: 'Datum', customer: 'Naručitelj', site: 'Lokacija', contact: 'Kontakt osoba', phone: 'Telefon', email: 'E-pošta', vatId: 'PDV ID',
      equipment: 'Uređaj', model: 'Model', serial: 'Serijski broj', installed: 'Datum ugradnje', warranty: 'Jamstvo do', refrigerant: 'Rashladno sredstvo', charge: 'punjenje',
      location: 'Mjesto ugradnje', jobType: 'Vrsta usluge', priority: 'Prioritet', technician: 'Serviser', arrival: 'Dolazak', finished: 'Završetak', onSite: 'Vrijeme na lokaciji',
      request: 'Opis zahtjeva', workDone: 'Izvršeni radovi', checklist: 'Kontrolna lista', item: 'Stavka', result: 'Rezultat', measured: 'Izmjerena vrijednost',
      pass: 'Ispravno', fail: 'Neispravno', na: 'Nije primjenjivo', outOfRange: 'izvan uobičajenog raspona',
      partsLabour: 'Materijal i rad', code: 'Šifra', description: 'Opis', qty: 'Količina', unitPrice: 'Jedinična cijena', amount: 'Iznos',
      labour: 'Rad', surcharge: 'Dodatak za hitnu intervenciju {n} %', callout: 'Izlazak na teren', km: 'Prijevoz iznad {n} km', net: 'Ukupno bez PDV-a', vat: 'PDV {n} %', total: 'Ukupno s PDV-om',
      coveredPlan: 'Uključeno u servisni paket', coveredService: 'Rad i prijevoz uključeni su u servisni paket', coveredCallout: 'Izlazak na teren uključen je u servisni paket', coveredWarranty: 'U okviru jamstva, bez naplate', included: 'uključeno',
      photos: 'Fotografije', signature: 'Potpis naručitelja', signedBy: 'Ime i prezime', signedAt: 'Potpisano', notSigned: 'Nije potpisano', reason: 'Razlog',
      followUp: 'Potreban je ponovni dolazak.', prices: 'Cijene su u EUR.', visits: 'Prethodni dolazak', page: 'Stranica',
      units: { pc: 'kom', kg: 'kg', m: 'm', h: 'h', km: 'km' },
      types: { service: 'Godišnji servis', repair: 'Popravak', install: 'Montaža', commission: 'Puštanje u rad', warranty: 'Jamstveni pregled' },
      kinds: { hp: 'Dizalica topline zrak-voda', gas: 'Plinski kondenzacijski kotao', ac: 'Split klima-uređaj', vent: 'Ventilacijski uređaj s rekuperacijom topline', solar: 'Solarni sustav za pripremu tople vode' },
      priorities: { normal: 'Uobičajen', high: 'Visok', emergency: 'Hitno' },
      mailSubject: 'Servisno izvješće {no}',
      mailBody: 'Poštovani,\n\nu nastavku je sažetak našeg posjeta {date}.\n\n{type}: {equipment}\nServiser: {tech}\nIzvršeni radovi: {work}\nUkupno s PDV-om: {total}\n\nCjelovito servisno izvješće nalazi se u privitku u PDF obliku.\n\nSrdačan pozdrav,\n{company}\n{phone}'
    }
  };
  var LANGS = ['sl', 'hr', 'en'];
  /** report wording; {name} placeholders are filled from vars */
  function t(lang, key, vars) {
    var d = I18N[lang] || I18N.en, v = d[key] != null ? d[key] : I18N.en[key];
    if (typeof v !== 'string') return v == null ? key : v;
    return vars ? v.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? String(vars[k]) : m; }) : v;
  }

  return {
    // dates and times
    isDate: isDate, addDays: addDays, diffDays: diffDays, dow: dow, mondayOf: mondayOf, daysInMonth: daysInMonth, addMonths: addMonths, isWeekend: isWeekend,
    isoWeek: isoWeek, fmtDate: fmtDate, isStamp: isStamp, toMin: toMin, fromMin: fromMin, addMin: addMin, minutesBetween: minutesBetween, stamp: stamp,
    hmOf: hmOf, dateOf: dateOf, fmtStamp: fmtStamp,
    easter: easter, siHolidays: siHolidays, holidayMap: holidayMap, isWorkday: isWorkday, nextWorkday: nextWorkday, prevWorkday: prevWorkday,
    workdayOnOrAfter: workdayOnOrAfter, workdays: workdays,
    // reference
    WINDOWS: WINDOWS, winIndex: winIndex, windowAt: windowAt, STATUSES: STATUSES, STATUS: STATUS, TRANSITIONS: TRANSITIONS, canMove: canMove, isOpen: isOpen,
    isBooked: isBooked, TYPES: TYPES, TYPE: TYPE, PRIORITIES: PRIORITIES, PRIORITY: PRIORITY, KINDS: KINDS, KIND: KIND, SKILLS: SKILLS, SKILL: SKILL,
    PLANS: PLANS, PLAN: PLAN, PLAN_RANK: PLAN_RANK, planRank: planRank, requiredSkills: requiredSkills, missingSkills: missingSkills, defaultSpan: defaultSpan, jobSpan: jobSpan, winRange: winRange,
    TOWNS: TOWNS, distanceKm: distanceKm, tripKm: tripKm, postalOf: postalOf, LOCAL_KM: LOCAL_KM, countryOf: countryOf, COUNTRY_NAMES: COUNTRY_NAMES, langOf: langOf,
    // rules
    DEFAULT_SLA: DEFAULT_SLA, RISK_MIN: RISK_MIN, slaHours: slaHours, slaDue: slaDue, slaState: slaState, firstArrival: firstArrival,
    answered: answered, outOfRange: outOfRange, checklistStatus: checklistStatus,
    cents: cents, billedMinutes: billedMinutes, defaultBilling: defaultBilling, priceJob: priceJob, frozenRates: frozenRates, RATE_KEYS: RATE_KEYS,
    nextDue: nextDue, dueBucket: dueBucket, maintenanceList: maintenanceList, hasPlan: hasPlan, PLAN_AUTO: PLAN_AUTO, planAuto: planAuto, planVisitId: planVisitId, planVisits: planVisits, planJob: planJob,
    travelMinutes: travelMinutes, etaStamp: etaStamp, clockText: clockText, shortCompany: shortCompany, omwText: omwText, dialable: dialable, smsHref: smsHref, isSafeDemoPhone: isSafeDemoPhone,
    paymentReference: paymentReference, qrKind: qrKind, ibanInfo: ibanInfo, ibanText: ibanText, PAY_METHODS: PAY_METHODS, paidState: paidState, reportPayment: reportPayment,
    isDone: isDone, FTF_DAYS: FTF_DAYS, repairIndex: repairIndex, isFirstTimeFix: isFirstTimeFix, ftfRate: ftfRate, onsiteSpans: onsiteSpans, travelSpans: travelSpans, onsiteMinutes: onsiteMinutes, utilisation: utilisation,
    conflicts: conflicts, jobNo: jobNo, parseJobNo: parseJobNo, nextJobNo: nextJobNo, fitWithin: fitWithin,
    jobsPerWeek: jobsPerWeek, slaStats: slaStats, avgOnsiteByType: avgOnsiteByType, revenueByMonth: revenueByMonth, topParts: topParts, failingModels: failingModels,
    I18N: I18N, LANGS: LANGS, t: t
  };
});
