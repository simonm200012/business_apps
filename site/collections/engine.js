/* Collections engine (Business Apps): pure receivables follow-up rules, no DOM. UMD, so it also loads in Node.
 * Dates are 'YYYY-MM-DD' strings compared as strings; arithmetic is done in UTC. Amounts are EUR, rounded to cents.
 * Covers open amounts and aging, DSO, statutory default interest (half-year rate periods, leap years, payments,
 * the "ne ultra alterum tantum" cap), reminder stages and their skip rules, the call priority, promises and
 * payment plans, letter texts in Slovene, Croatian and English, payment references, UPN and EPC QR payloads,
 * CSV parsing and import validation, and the report series. Nothing here is legal advice: rates and rules are
 * defaults the owner checks in Settings. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CollEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ── dates ────────────────────────────────────────────────────────────────
  var DAY = 86400000, EPS = 0.005;
  function toUtc(s) { return Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)); }
  function fromUtc(t) { var d = new Date(t); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0'); }
  function isDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && fromUtc(toUtc(s)) === s; }
  function addDays(s, n) { return fromUtc(toUtc(s) + Math.round(n) * DAY); }
  function diffDays(a, b) { return Math.round((toUtc(b) - toUtc(a)) / DAY); } // b − a
  function dow(s) { return new Date(toUtc(s)).getUTCDay(); } // 0 = Sunday
  function mondayOf(s) { var d = dow(s); return addDays(s, d === 0 ? -6 : 1 - d); }
  function isWeekend(s) { var d = dow(s); return d === 0 || d === 6; }
  function workdayOnOrAfter(s) { while (isWeekend(s)) s = addDays(s, 1); return s; }
  function workdayOnOrBefore(s) { while (isWeekend(s)) s = addDays(s, -1); return s; }
  function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
  function daysInYear(y) { return isLeap(y) ? 366 : 365; }
  function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); } // m is 1-based
  function ymd(y, m, d) { return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0'); }
  function startOfMonth(s) { return s.slice(0, 8) + '01'; }
  function endOfMonth(s) { return ymd(+s.slice(0, 4), +s.slice(5, 7), daysInMonth(+s.slice(0, 4), +s.slice(5, 7))); }
  /** same day n months later, clamped to the month's last day (31. 1. + 1 month = 28. 2.) */
  function addMonths(s, n) {
    var t = +s.slice(0, 4) * 12 + (+s.slice(5, 7) - 1) + n, y = Math.floor(t / 12), m = t % 12 + 1;
    return ymd(y, m, Math.min(+s.slice(8, 10), daysInMonth(y, m)));
  }
  function minDate(a, b) { return a < b ? a : b; }
  function maxDate(a, b) { return a > b ? a : b; }

  // ── money ────────────────────────────────────────────────────────────────
  function round2(x) { x = +x || 0; var s = x < 0 ? -1 : 1; return s * Math.round(Math.abs(x) * 100 + 1e-6) / 100; }
  function sum(list, f) { var s = 0; for (var i = 0; i < list.length; i++) s += f ? f(list[i]) : list[i]; return s; }

  // ── formatting (letters use these; the app uses Intl for the UI) ─────────
  var MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function fmtNum(n, dec, lang) {
    var neg = n < 0, s = Math.abs(round2(n)).toFixed(dec), parts = s.split('.'), en = lang === 'en';
    var int = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, en ? ',' : '.');
    return (neg ? '−' : '') + int + (dec ? (en ? '.' : ',') + parts[1] : '');
  }
  /** 1.234,56 € (sl, hr) or EUR 1,234.56 (en) */
  function fmtMoney(n, lang) { return lang === 'en' ? 'EUR ' + fmtNum(n, 2, 'en') : fmtNum(n, 2, lang) + ' €'; }
  function fmtMoney0(n) { return fmtNum(Math.round(n), 0, 'sl') + ' €'; }
  /** 13. 10. 2026 (sl), 13. 10. 2026. (hr), 13 October 2026 (en) */
  function fmtDate(s, lang) {
    if (!isDate(s)) return '';
    var d = +s.slice(8, 10), m = +s.slice(5, 7), y = s.slice(0, 4);
    if (lang === 'en') return d + ' ' + MONTHS_EN[m - 1] + ' ' + y;
    return d + '. ' + m + '. ' + y + (lang === 'hr' ? '.' : '');
  }
  function fmtDateTable(s, lang) {
    if (!isDate(s)) return '';
    var d = +s.slice(8, 10), m = +s.slice(5, 7), y = s.slice(0, 4);
    if (lang === 'en') return d + ' ' + MONTHS_EN[m - 1].slice(0, 3) + ' ' + y;
    return d + '. ' + m + '. ' + y + (lang === 'hr' ? '.' : '');
  }
  function fmtDayMonth(s) { return isDate(s) ? +s.slice(8, 10) + '. ' + +s.slice(5, 7) + '.' : ''; }
  function fmtPct(r) { return fmtNum(r, 2, 'sl') + ' %'; }

  // ── invoices: open amounts ───────────────────────────────────────────────
  /** sum of payments dated on or before `date` (all payments when date is empty) */
  function paidUpTo(inv, date) {
    var s = 0, p = inv.payments || [];
    for (var i = 0; i < p.length; i++) if (!date || p[i].date <= date) s += +p[i].amount || 0;
    return round2(s);
  }
  /** what is still owed on `date`; 0 when paid (≤ 0,005 € left), written off, or not issued yet */
  function openAt(inv, date) {
    if (!inv) return 0;
    if (date && inv.issueDate > date) return 0;
    if (inv.writtenOff && (!date || !inv.writtenOff.date || inv.writtenOff.date <= date)) return 0;
    var o = round2((+inv.amount || 0) - paidUpTo(inv, date));
    return o <= EPS ? 0 : o;
  }
  /** the date the invoice became fully paid (looking only at payments up to asOf), or null */
  function settledOn(inv, asOf) {
    if (inv.writtenOff) return null;
    var p = (inv.payments || []).filter(function (x) { return !asOf || x.date <= asOf; }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    var s = 0, amt = +inv.amount || 0;
    for (var i = 0; i < p.length; i++) { s += +p[i].amount || 0; if (amt - s <= EPS) return p[i].date; }
    return null;
  }
  function isDisputedAt(inv, date) { return !!(inv.disputed && (!inv.disputed.since || !date || inv.disputed.since <= date)); }
  function daysOverdue(inv, date) { return diffDays(inv.dueDate, date); }

  // ── aging ────────────────────────────────────────────────────────────────
  var BUCKETS = [
    { id: 'nd', name: 'Not due', short: 'Not due', min: -Infinity, max: 0 },
    { id: 'b30', name: '1–30 days', short: '1–30', min: 1, max: 30 },
    { id: 'b60', name: '31–60 days', short: '31–60', min: 31, max: 60 },
    { id: 'b90', name: '61–90 days', short: '61–90', min: 61, max: 90 },
    { id: 'b180', name: '91–180 days', short: '91–180', min: 91, max: 180 },
    { id: 'old', name: 'Over 180 days', short: '180+', min: 181, max: Infinity }
  ];
  function bucketOf(days) { for (var i = 0; i < BUCKETS.length; i++) if (days >= BUCKETS[i].min && days <= BUCKETS[i].max) return BUCKETS[i].id; return 'nd'; }
  /** open receivables on `date` by days overdue */
  function aging(invoices, date) {
    var res = { date: date, total: 0, overdue: 0, count: 0, overdueCount: 0, buckets: {} };
    BUCKETS.forEach(function (b) { res.buckets[b.id] = { amount: 0, count: 0 }; });
    invoices.forEach(function (inv) {
      var o = openAt(inv, date); if (o <= 0) return;
      var b = bucketOf(diffDays(inv.dueDate, date));
      res.buckets[b].amount += o; res.buckets[b].count++;
      res.total += o; res.count++;
      if (b !== 'nd') { res.overdue += o; res.overdueCount++; }
    });
    res.total = round2(res.total); res.overdue = round2(res.overdue);
    BUCKETS.forEach(function (b) { res.buckets[b.id].amount = round2(res.buckets[b.id].amount); });
    return res;
  }

  // ── DSO and lateness ─────────────────────────────────────────────────────
  /** Days sales outstanding on `date`: receivables ÷ credit sales of the last `window` days × window. */
  function dso(invoices, date, window) {
    window = window || 90;
    var from = addDays(date, -window), ar = 0, sales = 0;
    invoices.forEach(function (inv) {
      ar += openAt(inv, date);
      if (inv.issueDate > from && inv.issueDate <= date) sales += +inv.amount || 0;
    });
    return { date: date, ar: round2(ar), sales: round2(sales), window: window, dso: sales > 0 ? ar / sales * window : null };
  }
  /** Average days late of invoices fully paid in the `window` days up to `date`, weighted by amount. Early payments count as 0. */
  function avgDaysLate(invoices, date, window) {
    window = window || 90;
    var from = addDays(date, -window), w = 0, s = 0, n = 0;
    invoices.forEach(function (inv) {
      var st = settledOn(inv, date); if (!st || st <= from) return;
      var amt = +inv.amount || 0;
      s += Math.max(0, diffDays(inv.dueDate, st)) * amt; w += amt; n++;
    });
    return { date: date, days: w ? s / w : null, count: n, amount: round2(w) };
  }

  // ── statutory default interest ───────────────────────────────────────────
  // Slovenia: ECB main refinancing rate on 1 January / 1 July + 8 percentage points (ZPOMZO-1); Croatia: the same for
  // commercial contracts (ZOO Article 29). A period whose note says "assumed" (or that has assumed: true) is a guess the
  // owner still has to check: letters that use it get a warning in the app (never on the printed letter).
  var DEFAULT_RATES = [
    { from: '2023-01-01', to: '2023-06-30', rate: 10.5, note: 'ECB 2,50 % + 8 points' },
    { from: '2023-07-01', to: '2023-12-31', rate: 12, note: 'ECB 4,00 % + 8 points' },
    { from: '2024-01-01', to: '2024-06-30', rate: 12.5, note: 'ECB 4,50 % + 8 points' },
    { from: '2024-07-01', to: '2024-12-31', rate: 12.25, note: 'ECB 4,25 % + 8 points' },
    { from: '2025-01-01', to: '2025-06-30', rate: 11.15, note: 'ECB 3,15 % + 8 points' },
    { from: '2025-07-01', to: '2025-12-31', rate: 10.15, note: 'ECB 2,15 % + 8 points' },
    { from: '2026-01-01', to: '2026-06-30', rate: 10.15, note: 'ECB 2,15 % + 8 points' },
    // The ECB raised its main refinancing operations rate from 2,15 % to 2,40 % with effect from 17 June 2026
    // (decision of 11 June 2026), so 2,40 % was in force on 1 July 2026; the next change (2,65 %) took effect on
    // 16 September 2026 and counts only from 1 January 2027. Source: ECB, Key ECB interest rates,
    // https://www.ecb.europa.eu/stats/policy_and_exchange_rates/key_ecb_interest_rates/html/index.en.html
    // (checked 15 October 2026). Croatia publishes the same 10,40 % for 1. 7.–31. 12. 2026 (Narodne novine 68/2026).
    { from: '2026-07-01', to: '2026-12-31', rate: 10.4, note: 'ECB 2,40 % + 8 points' }
  ];
  /** the 2026 H2 row as the app first shipped it, before the ECB rate was known; replaced on load while untouched */
  var OLD_ASSUMED_ROWS = [{ from: '2026-07-01', to: '2026-12-31', rate: 10.15, note: 'Assumed: ECB rate unchanged, check' }];
  /** a rate period the owner still has to check */
  function rateAssumed(r) { return !!r && (r.assumed === true || /assum/i.test(String(r.note || ''))); }
  function normRates(rates) {
    return (rates || []).filter(function (r) { return r && isDate(r.from) && isFinite(+r.rate) && r.rate !== '' && r.rate !== null; })
      .map(function (r) { var o = { from: r.from, to: isDate(r.to) ? r.to : '', rate: +r.rate, note: r.note || '' }; if (r.assumed === true) o.assumed = true; return o; })
      .sort(function (a, b) { return a.from < b.from ? -1 : a.from > b.from ? 1 : 0; });
  }
  /** rate (% a year) on day d; missing = true when d falls outside every period (the nearest one is used) */
  function rateFor(d, sortedRates) {
    var rs = sortedRates;
    if (!rs.length) return { rate: 0, missing: true, period: null };
    for (var i = rs.length - 1; i >= 0; i--) {
      if (rs[i].from <= d) return { rate: rs[i].rate, missing: !!(rs[i].to && d > rs[i].to), period: rs[i] };
    }
    return { rate: rs[0].rate, missing: true, period: rs[0] };
  }
  /** How part-payments are applied. 'law': costs, then interest, then the principal (Slovenia: Obligacijski zakonik
   * Article 288; Croatia: Zakon o obveznim odnosima Article 172), which applies unless the parties agreed otherwise.
   * 'principal': the principal first, then interest, then costs, for customers whose contract says so. */
  var PAY_ORDERS = ['law', 'principal'];
  /** Interest options for a customer: its contractual rate if set, else the table; the cap defaults by country;
   * the payment order comes from Settings. */
  function interestOpts(cust, settings) {
    var S = settings || {}, it = (cust && cust.interest) || {};
    var cr = it.contractRate;
    var hasContract = cr !== null && cr !== undefined && cr !== '' && isFinite(+cr) && +cr >= 0;
    var cap = typeof it.cap === 'boolean' ? it.cap : (cust && cust.country === 'SI' ? S.capSI !== false : !!S.capOther);
    return { rates: S.rates || DEFAULT_RATES, contractRate: hasContract ? +cr : null, cap: cap, order: S.payOrder === 'principal' ? 'principal' : 'law' };
  }
  /** Simple default interest on one invoice from the day after its due date up to and including `calcDate`, and how
   * the payments made up to `calcDate` were applied.
   * Periods split at every rate change, every payment and every 1 January (days ÷ 365 or 366). A payment made on day p
   * is applied at the end of day p, so interest for day p still runs on the old principal.
   * opt.order 'law' (the default): a payment goes first to the costs (opt.costs, a fixed amount such as the 40 €
   * compensation, owed from the day after the due date), then to the interest accrued and still unpaid, then to the
   * principal. opt.order 'principal': principal, interest, costs. A payment on or before the due date always goes to
   * the principal, as nothing else is owed yet.
   * opt.cap: no interest accrues while the unpaid interest is at least the open principal (OZ Article 376,
   * "ne ultra alterum tantum"); it runs again once a payment brings the unpaid interest back under the principal.
   * opt.interest = false: no interest is charged (costs and the order still apply). Each line is rounded to cents.
   * total is all the interest accrued; interestOpen the part still unpaid; principalOpen the principal still owed. */
  function interestFor(inv, calcDate, opt) {
    opt = opt || {};
    var order = opt.order === 'principal' ? 'principal' : 'law', withInt = opt.interest !== false;
    var amount = round2(inv ? +inv.amount || 0 : 0);
    var out = {
      total: 0, lines: [], capped: false, cappedOn: null, missing: false, assumed: false, assumedFrom: [], contract: false, order: order,
      amount: amount, paid: 0, costs: 0, costsPaid: 0, costsOpen: 0, interestPaid: 0, interestOpen: 0, principalPaid: 0, principalOpen: 0, open: 0, over: 0, allocations: []
    };
    if (!inv || !isDate(inv.dueDate) || !isDate(calcDate) || inv.writtenOff) {
      out.principalOpen = inv && isDate(calcDate) ? openAt(inv, calcDate) : 0; out.open = out.principalOpen; return out;
    }
    var start = addDays(inv.dueDate, 1), endEx = addDays(calcDate, 1);
    var contract = opt.contractRate !== null && opt.contractRate !== undefined && opt.contractRate !== '' && isFinite(+opt.contractRate);
    out.contract = contract;
    var rates = contract ? [] : normRates(opt.rates || DEFAULT_RATES);
    // the payments up to calcDate, one per day, in date order
    var byDay = {};
    (inv.payments || []).forEach(function (p) { if (isDate(p.date) && +p.amount > 0 && p.date <= calcDate) byDay[p.date] = round2((byDay[p.date] || 0) + +p.amount); });
    var pays = Object.keys(byDay).sort().map(function (d) { return { date: d, amount: byDay[d] }; });
    var P = amount, acc = 0, ip = 0, cp = 0, pi = 0;
    var costs = calcDate >= start ? round2(Math.max(0, +opt.costs || 0)) : 0;
    var apply = function (p) {
      var x = p.amount, a = { date: p.date, amount: p.amount, costs: 0, interest: 0, principal: 0, over: 0 };
      var take = function (k, owed) { var y = round2(Math.max(0, Math.min(x, owed))); a[k] = y; x = round2(x - y); return y; };
      var owedC = p.date >= start ? round2(costs - cp) : 0;
      if (order === 'law') { cp = round2(cp + take('costs', owedC)); ip = round2(ip + take('interest', acc - ip)); P = round2(P - take('principal', P)); }
      else { P = round2(P - take('principal', P)); ip = round2(ip + take('interest', acc - ip)); cp = round2(cp + take('costs', owedC)); }
      a.over = x > EPS ? x : 0;
      out.allocations.push(a);
    };
    var applyBefore = function (d) { while (pi < pays.length && pays[pi].date < d) apply(pays[pi++]); };
    applyBefore(start); // on or before the due date: principal only
    if (calcDate >= start) {
      var cut = {}, mark = function (d) { if (d > start && d < endEx) cut[d] = 1; };
      pays.forEach(function (p) { mark(addDays(p.date, 1)); });
      rates.forEach(function (r) { mark(r.from); if (r.to) mark(addDays(r.to, 1)); });
      for (var y = +start.slice(0, 4) + 1; y <= +calcDate.slice(0, 4); y++) mark(y + '-01-01');
      var pts = [start].concat(Object.keys(cut).sort(), [endEx]);
      for (var i = 0; i < pts.length - 1; i++) {
        var a = pts[i], b = pts[i + 1], days = diffDays(a, b);
        applyBefore(a);
        if (!withInt || P <= EPS) continue; // nothing to charge interest on
        var room = round2(P - (acc - ip));
        if (opt.cap && room <= EPS) { if (!out.capped) { out.capped = true; out.cappedOn = addDays(a, -1); } continue; }
        var rr = contract ? { rate: +opt.contractRate, missing: false, period: null } : rateFor(a, rates);
        if (rr.missing) out.missing = true;
        if (rr.period && rateAssumed(rr.period)) { out.assumed = true; if (out.assumedFrom.indexOf(rr.period.from) < 0) out.assumedFrom.push(rr.period.from); }
        var diy = daysInYear(+a.slice(0, 4)), perDay = P * rr.rate / 100 / diy;
        var line = { from: a, to: addDays(b, -1), days: days, principal: P, rate: rr.rate, diy: diy, amount: round2(perDay * days) };
        if (opt.cap && line.amount >= room - EPS) {
          var need = perDay > 0 ? Math.ceil(room / perDay - 1e-9) : days;
          line.amount = room; line.days = Math.max(1, Math.min(days, need)); line.to = addDays(a, line.days - 1);
          if (!out.capped) { out.capped = true; out.cappedOn = line.to; }
        }
        out.lines.push(line);
        acc = round2(acc + line.amount);
      }
    }
    applyBefore(endEx);
    out.total = acc; out.costs = costs;
    out.costsPaid = cp; out.costsOpen = round2(costs - cp);
    out.interestPaid = ip; out.interestOpen = round2(acc - ip);
    out.principalPaid = round2(amount - P); out.principalOpen = P > EPS ? P : 0;
    out.paid = round2(sum(pays, function (p) { return p.amount; }));
    out.over = round2(sum(out.allocations, function (x) { return x.over; }));
    out.open = round2(out.principalOpen + out.interestOpen + out.costsOpen);
    return out;
  }

  // ── settings ─────────────────────────────────────────────────────────────
  var DEFAULT_STAGES = [
    { id: 0, name: 'Friendly reminder', days: 3, interest: false, fee: false },
    { id: 1, name: 'First reminder', days: 14, interest: false, fee: false },
    { id: 2, name: 'Second reminder', days: 30, interest: true, fee: false },
    { id: 3, name: 'Final notice before legal action', days: 45, interest: true, fee: true }
  ];
  var DEFAULT_SETTINGS = {
    stages: DEFAULT_STAGES, rates: DEFAULT_RATES, fixedFee: 40, capSI: true, capOther: false,
    contactGap: 7, letterGap: 10, payDays: 8, promiseGrace: 2, target: 1100000, purposeCode: 'GDSV',
    payOrder: 'law' // part-payments: costs → interest → principal (OZ Art. 288 / ZOO Art. 172); 'principal' when agreed
  };
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  /** fills missing settings with the defaults (older documents, imports) */
  function normSettings(s) {
    s = s || {};
    var o = {};
    Object.keys(DEFAULT_SETTINGS).forEach(function (k) { o[k] = s[k] === undefined || s[k] === null ? clone(DEFAULT_SETTINGS[k]) : s[k]; });
    if (!Array.isArray(o.stages) || o.stages.length !== DEFAULT_STAGES.length) o.stages = clone(DEFAULT_STAGES);
    o.stages = o.stages.map(function (st, i) { return { id: i, name: st.name || DEFAULT_STAGES[i].name, days: Math.max(0, Math.round(+st.days || 0)), interest: !!st.interest, fee: !!st.fee }; });
    if (!Array.isArray(o.rates)) o.rates = clone(DEFAULT_RATES);
    // a default row the app shipped as "assumed" and the owner never touched becomes the checked default
    o.rates = o.rates.map(function (r) {
      var old = r && OLD_ASSUMED_ROWS.filter(function (x) { return x.from === r.from && x.to === r.to && +r.rate === x.rate && r.note === x.note; })[0];
      if (!old) return r;
      var now = DEFAULT_RATES.filter(function (x) { return x.from === old.from; })[0];
      return now ? clone(now) : r;
    });
    if (PAY_ORDERS.indexOf(o.payOrder) < 0) o.payOrder = 'law';
    ['fixedFee', 'contactGap', 'letterGap', 'payDays', 'promiseGrace', 'target'].forEach(function (k) { o[k] = Math.max(0, +o[k] || 0); });
    return o;
  }

  // ── contacts, promises and plans ─────────────────────────────────────────
  var ACTION_TYPES = ['call', 'email', 'letter', 'promise', 'dispute', 'note', 'hold', 'plan', 'payment'];
  var OUTCOMES = ['no-answer', 'reached', 'promised', 'paid', 'dispute'];
  /** a two-way contact: a call that got through, an e-mail, a promise, a plan or a dispute (letters count separately) */
  function isContact(a) {
    if (!a) return false;
    if (a.type === 'call') return a.outcome !== 'no-answer';
    return a.type === 'email' || a.type === 'promise' || a.type === 'plan' || a.type === 'dispute';
  }
  /** Kept when the customer paid at least 98 % of the promised amount between the promise and its date + grace days;
   * broken once that window has passed; open before. Payments after `today` are ignored. */
  function promiseState(act, invs, today, grace) {
    var p = act && act.promise; if (!p) return null;
    if (p.status === 'cancelled') return { state: 'cancelled', paid: 0, amount: +p.amount || 0, date: p.date };
    var end = addDays(p.date, grace == null ? 2 : grace), lim = minDate(end, today), paid = 0, last = null;
    invs.forEach(function (inv) {
      (inv.payments || []).forEach(function (x) { if (x.date >= act.date && x.date <= lim) { paid += +x.amount || 0; if (!last || x.date > last) last = x.date; } });
    });
    paid = round2(paid);
    var amt = +p.amount || 0, state = paid >= amt * 0.98 - EPS ? 'kept' : today > end ? 'broken' : 'open';
    return { state: state, paid: paid, amount: amt, date: p.date, keptOn: state === 'kept' ? last : null, due: end };
  }
  /** instalments: paid (on time or late), overdue (past due + grace and unpaid), next upcoming */
  function planState(plan, today, grace) {
    grace = grace == null ? 2 : grace;
    var res = { state: 'kept', paid: 0, paidCount: 0, lateCount: 0, overdue: [], next: null, total: 0, left: 0 };
    if (!plan) return null;
    (plan.instalments || []).forEach(function (it) {
      res.total += +it.amount || 0;
      if (it.paidDate && it.paidDate <= today) {
        res.paid += +it.amount || 0; res.paidCount++;
        if (diffDays(it.due, it.paidDate) > grace) res.lateCount++;
      } else if (addDays(it.due, grace) < today) res.overdue.push(it);
      else if (!res.next) res.next = it;
    });
    res.total = round2(res.total); res.paid = round2(res.paid); res.left = round2(res.total - res.paid);
    if (plan.status === 'cancelled') res.state = 'cancelled';
    else if (res.paidCount === (plan.instalments || []).length && res.paidCount) res.state = 'completed';
    else if (res.overdue.length) res.state = 'late';
    else res.state = 'kept';
    return res;
  }
  /** split `total` into n monthly instalments starting on firstDue; the last one takes the rounding */
  function splitPlan(total, n, firstDue) {
    n = Math.max(1, Math.round(n)); total = round2(total);
    var base = Math.floor(total * 100 / n) / 100, out = [];
    for (var i = 0; i < n; i++) out.push({ due: addMonths(firstDue, i), amount: i === n - 1 ? round2(total - base * (n - 1)) : base, paidDate: null });
    return out;
  }
  /** spread a payment over invoices in the given order (oldest first by default); returns the parts and what is left over */
  function allocate(invs, amount, date) {
    var left = round2(amount), parts = [];
    invs.slice().sort(function (a, b) { return a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0; }).forEach(function (inv) {
      if (left <= EPS) return;
      var o = openAt(inv, date); if (o <= 0) return;
      var x = round2(Math.min(o, left));
      parts.push({ id: inv.id, no: inv.no, amount: x }); left = round2(left - x);
    });
    return { parts: parts, rest: left > EPS ? left : 0 };
  }

  // ── payment behaviour ────────────────────────────────────────────────────
  /** days late per invoice paid in the last year, the weighted average and the trend (last 90 days vs the 9 months before) */
  function behaviour(invs, today) {
    var yearAgo = addDays(today, -365), q = addDays(today, -90), rows = [];
    invs.forEach(function (inv) {
      var st = settledOn(inv, today); if (!st || st <= yearAgo) return;
      rows.push({ id: inv.id, no: inv.no, due: inv.dueDate, paid: st, late: diffDays(inv.dueDate, st), amount: +inv.amount || 0 });
    });
    rows.sort(function (a, b) { return a.paid < b.paid ? -1 : a.paid > b.paid ? 1 : 0; });
    function wavg(list) { var w = sum(list, function (r) { return r.amount; }); return w ? sum(list, function (r) { return Math.max(0, r.late) * r.amount; }) / w : null; }
    var recent = rows.filter(function (r) { return r.paid > q; }), before = rows.filter(function (r) { return r.paid <= q; });
    var res = { rows: rows, avg: wavg(rows), recent: wavg(recent), before: wavg(before), nRecent: recent.length, nBefore: before.length, delta: null, trend: null };
    if (recent.length >= 2 && before.length >= 2) {
      res.delta = res.recent - res.before;
      res.trend = res.delta >= 7 && res.recent >= 10 ? 'worse' : res.delta <= -7 ? 'better' : 'steady';
    }
    return res;
  }

  // ── one customer: balances, contact, dunning, priority, risk ─────────────
  /** Everything the screens need about one customer on `today`. acts and plans are the customer's own. */
  function analyzeCustomer(cust, invs, acts, plans, today, settings) {
    var S = settings && settings.stages ? settings : normSettings(settings);
    var st = {
      id: cust.id, open: 0, overdue: 0, overdueUndisputed: 0, disputed: 0, notDue: 0, count: 0, overdueCount: 0,
      oldestDays: 0, oldestAny: 0, oldestInv: null, openInvs: [], overdueInvs: [], disputedInvs: []
    };
    invs.forEach(function (inv) {
      var o = openAt(inv, today); if (o <= 0) return;
      st.open += o; st.count++; st.openInvs.push(inv);
      var d = diffDays(inv.dueDate, today), disp = isDisputedAt(inv, today);
      if (disp) { st.disputed += o; st.disputedInvs.push(inv); }
      if (d > 0) {
        st.overdue += o; st.overdueCount++; st.oldestAny = Math.max(st.oldestAny, d);
        if (!disp) { st.overdueUndisputed += o; st.overdueInvs.push(inv); if (d > st.oldestDays) { st.oldestDays = d; st.oldestInv = inv; } }
      } else st.notDue += o;
    });
    ['open', 'overdue', 'overdueUndisputed', 'disputed', 'notDue'].forEach(function (k) { st[k] = round2(st[k]); });
    st.overdueInvs.sort(function (a, b) { return a.dueDate < b.dueDate ? -1 : 1; });
    var past = acts.filter(function (a) { return a.date <= today; }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    st.lastContact = null; st.lastLetter = null; st.lastCall = null; st.calledToday = false;
    past.forEach(function (a) {
      if (isContact(a)) st.lastContact = a;
      if (a.type === 'letter') st.lastLetter = a;
      if (a.type === 'call') { st.lastCall = a; if (a.date === today) st.calledToday = true; }
    });
    st.daysSinceContact = st.lastContact ? diffDays(st.lastContact.date, today) : null;
    // promises
    st.promises = past.filter(function (a) { return a.promise; }).map(function (a) { var p = promiseState(a, invs, today, S.promiseGrace); p.act = a; return p; });
    st.openPromise = null; st.brokenRecent = null;
    st.promises.forEach(function (p) {
      if (p.state === 'open') st.openPromise = p;
      if (p.state === 'broken' && p.date >= addDays(today, -60) && (!st.brokenRecent || p.date > st.brokenRecent.date)) st.brokenRecent = p;
    });
    st.brokenCount = st.promises.filter(function (p) { return p.state === 'broken'; }).length;
    // plan
    st.plan = null;
    (plans || []).forEach(function (pl) {
      if (pl.status === 'cancelled' || (pl.created && pl.created > today)) return;
      var ps = planState(pl, today, S.promiseGrace);
      if (ps.state !== 'completed') { st.plan = ps; st.plan.plan = pl; }
    });
    st.creditLimit = +cust.creditLimit || 0;
    st.overLimit = st.creditLimit > 0 ? round2(Math.max(0, st.open - st.creditLimit)) : 0;
    st.behaviour = behaviour(invs, today);
    st.dunning = dunning(st, past, today, S);
    st.priority = priority(st, today, S);
    st.risk = risk(st);
    return st;
  }

  /** Which reminder is due. A customer's stage is the highest letter already sent for its current overdue invoices.
   * Letters go up one stage at a time; the first one is the friendly reminder, or the first reminder when the
   * oldest invoice is already past that stage's day. Skips: all overdue invoices disputed, an open promise,
   * a payment plan being kept, a contact in the last `contactGap` days, less than `letterGap` days since the
   * last letter. After the final notice, the next step is a decision, not another letter. */
  function dunning(st, past, today, S) {
    var stages = S.stages, maxStage = stages.length - 1;
    var res = { reached: -1, target: -1, next: -1, due: false, skip: null, nextDate: null, final: false };
    if (!st.overdueCount) return res;
    if (!st.overdueInvs.length) { res.skip = { code: 'disputed', text: 'All overdue invoices are disputed' }; return res; }
    var ids = {};
    st.overdueInvs.forEach(function (i) { ids[i.id] = 1; });
    past.forEach(function (a) {
      if (a.type !== 'letter' || !a.invoiceIds) return;
      for (var k = 0; k < a.invoiceIds.length; k++) if (ids[a.invoiceIds[k]] && a.stage > res.reached) res.reached = a.stage;
    });
    for (var k = 0; k <= maxStage; k++) if (st.oldestDays >= stages[k].days) res.target = k;
    res.final = res.reached >= maxStage;
    res.next = res.final ? maxStage : res.reached >= 0 ? res.reached + 1 : Math.min(res.target, 1);
    if (!res.final && (res.next < 0 || res.next > res.target)) {
      var stg = stages[Math.max(0, res.reached + 1)];
      if (st.oldestInv && stg) res.nextDate = addDays(st.oldestInv.dueDate, stg.days);
      if (res.next < 0) res.next = 0;
      return res;
    }
    var gapEnd = st.lastLetter ? addDays(st.lastLetter.date, S.letterGap) : null;
    if (st.openPromise) res.skip = { code: 'promise', text: 'Promised ' + fmtMoney0(st.openPromise.amount) + ' by ' + fmtDayMonth(st.openPromise.date) };
    else if (st.plan && st.plan.state === 'kept') res.skip = { code: 'plan', text: 'On a payment plan, instalments paid on time' };
    else if (st.lastContact && diffDays(st.lastContact.date, today) < S.contactGap) res.skip = { code: 'contact', text: contactText(st.lastContact, today) };
    else if (gapEnd && today < gapEnd) { res.skip = { code: 'gap', text: 'Last letter ' + agoText(diffDays(st.lastLetter.date, today)) + ', next possible ' + fmtDayMonth(gapEnd) }; res.nextDate = gapEnd; }
    else if (res.final) res.skip = { code: 'final', text: 'Final notice sent ' + fmtDayMonth(st.lastLetter ? st.lastLetter.date : today) + ': decide on legal action' };
    else res.due = true;
    return res;
  }
  function agoText(n) { return n === 0 ? 'today' : n === 1 ? 'yesterday' : n + ' days ago'; }
  function contactText(a, today) {
    var when = agoText(diffDays(a.date, today));
    if (a.type === 'call') return 'Spoke to them ' + when + (a.outcome === 'promised' ? ' (promise)' : '');
    if (a.type === 'email') return 'E-mail exchange ' + when;
    if (a.type === 'promise') return 'Promise logged ' + when;
    if (a.type === 'plan') return 'Payment plan agreed ' + when;
    if (a.type === 'dispute') return 'Dispute logged ' + when;
    return 'Contacted ' + when;
  }

  /** Call priority: points for the overdue amount (up to 30, log scale, 100.000 € = 30) and the oldest days
   * overdue (up to 25 at 90 days); +20 for a promise broken in the last 60 days (+5 for each other one broken in
   * the last 90 days, up to +10); +10 when over the credit limit (up to +5 more the further over); +10 with no
   * two-way contact for 14 days or more; +10 when the customer is paying later than before; +5 once the final
   * notice has gone out. */
  function priority(st, today, S) {
    var od = st.overdueUndisputed, reasons = [];
    if (od <= 0 && !st.brokenRecent) return { score: 0, reasons: reasons };
    var pA = od > 0 ? Math.round(30 * Math.min(1, Math.log(1 + od / 1000) / Math.log(101))) : 0;
    var pD = Math.round(25 * Math.min(1, st.oldestDays / 90));
    reasons.push({ code: 'amount', points: pA, label: fmtMoney0(od) + ' overdue', chip: false });
    reasons.push({ code: 'age', points: pD, label: st.oldestDays + ' days overdue', chip: false });
    if (st.brokenRecent) {
      var more = (st.promises || []).filter(function (p) { return p.state === 'broken' && p !== st.brokenRecent && p.date >= addDays(today, -90); }).length;
      reasons.push({ code: 'broken', points: 20 + Math.min(10, 5 * more), label: 'Broken promise ' + fmtDayMonth(st.brokenRecent.date), detail: more ? (more + 1) + ' broken in 90 days' : '', chip: true });
    }
    if (st.overLimit >= 500) {
      var lim = st.creditLimit || 0, extra = lim > 0 ? Math.min(5, Math.floor(10 * st.overLimit / lim)) : 0;
      reasons.push({ code: 'limit', points: 10 + extra, label: 'Over limit by ' + fmtMoney0(st.overLimit), chip: true });
    }
    if (od > 0) {
      var quiet = st.daysSinceContact == null ? st.oldestDays : st.daysSinceContact;
      if (quiet >= 14) reasons.push({ code: 'quiet', points: 10, label: st.daysSinceContact == null ? 'No contact yet (' + quiet + ' days)' : 'No contact for ' + quiet + ' days', chip: true });
    }
    var b = st.behaviour;
    if (b && b.trend === 'worse') reasons.push({ code: 'trend', points: 10, label: 'Paying later: ' + Math.round(b.before) + ' → ' + Math.round(b.recent) + ' days', chip: true });
    if (st.dunning && st.dunning.final && od > 0) reasons.push({ code: 'final', points: 5, label: 'Final notice sent', chip: true });
    return { score: sum(reasons, function (r) { return r.points; }), reasons: reasons };
  }
  function risk(st) {
    var b = st.behaviour || {}, od = st.overdueUndisputed;
    if (!st.overdueCount && !st.brokenRecent) return { level: 'ok', label: 'OK' };
    if (st.brokenRecent || st.oldestDays > 60 || (st.dunning && st.dunning.final && od > 0) || (b.trend === 'worse' && od > 0)) return { level: 'high', label: 'High' };
    if (st.oldestDays > 30 || st.overLimit > 0 || b.trend === 'worse') return { level: 'watch', label: 'Watch' };
    return { level: 'ok', label: 'OK' };
  }

  /** index the document by customer and analyse every customer */
  function indexDb(db) {
    var ix = { cust: {}, inv: {}, invBy: {}, actBy: {}, planBy: {} };
    (db.customers || []).forEach(function (c) { ix.cust[c.id] = c; ix.invBy[c.id] = []; ix.actBy[c.id] = []; ix.planBy[c.id] = []; });
    (db.invoices || []).forEach(function (i) { ix.inv[i.id] = i; (ix.invBy[i.customerId] = ix.invBy[i.customerId] || []).push(i); });
    (db.actions || []).forEach(function (a) { (ix.actBy[a.customerId] = ix.actBy[a.customerId] || []).push(a); });
    (db.plans || []).forEach(function (p) { (ix.planBy[p.customerId] = ix.planBy[p.customerId] || []).push(p); });
    return ix;
  }
  function analyzeAll(db, today, ix) {
    ix = ix || indexDb(db);
    var S = normSettings(db.settings), out = {};
    (db.customers || []).forEach(function (c) { out[c.id] = analyzeCustomer(c, ix.invBy[c.id] || [], ix.actBy[c.id] || [], ix.planBy[c.id] || [], today, S); });
    return out;
  }
  /** customers worth a call today, best first: not waiting on a promise or a kept plan. Customers already called
   * today keep their place (the screen marks them), so the list does not jump while someone works through it. */
  function callList(db, states, today) {
    var out = [];
    (db.customers || []).forEach(function (c) {
      var st = states[c.id]; if (!st || st.priority.score <= 0) return;
      if (st.openPromise) return;
      if (st.plan && st.plan.state === 'kept') return;
      out.push({ c: c, st: st });
    });
    out.sort(function (a, b) { return b.st.priority.score - a.st.priority.score || b.st.overdueUndisputed - a.st.overdueUndisputed; });
    return out;
  }

  // ── payment reference, QR payloads, validators ───────────────────────────
  /** model SI00 + the invoice number's digits and hyphens, as Billing does (paymentReference) */
  function paymentReference(no) {
    var s = String(no == null ? '' : no).replace(/[^0-9-]/g, '').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '').slice(0, 22);
    return s ? 'SI00 ' + s : '';
  }
  var EU = ['AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK'];
  function clip(v, n) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n); }
  function ddmmyyyy(iso) { return iso ? iso.slice(8, 10) + '.' + iso.slice(5, 7) + '.' + iso.slice(0, 4) : ''; }
  function compactIban(s) { return String(s || '').replace(/\s+/g, '').toUpperCase(); }
  /** UPN QR (ZBS): 19 LF-terminated fields + a 3-digit checksum (characters of the first 19 fields with their LFs).
   * Encoded as ISO-8859-2, QR version 15, error correction M. Ported from Billing (core.js upnQrText). */
  function upnQrText(snap, amountCents) {
    var c = snap.customer, s = snap.issuer;
    var fields = ['UPNQR', '', '', '', '', clip(c.name, 33), clip(c.address, 33), clip(c.postalCity, 33),
      String(Math.max(0, Math.round(amountCents))).padStart(11, '0'), '', '', clip(snap.purposeCode || 'GDSV', 4), clip(snap.purpose, 42), ddmmyyyy(snap.dueDate),
      compactIban(s.iban), String(snap.reference || '').replace(/\s+/g, ''), clip(s.name, 33), clip(s.address, 33), clip(s.postalCity, 33)];
    var body = fields.map(function (f) { return f + '\n'; }).join('');
    return body + String(body.length).padStart(3, '0') + '\n';
  }
  /** EPC069-12 SEPA credit transfer QR (version 002, UTF-8) for payers in other EU countries. Ported from Billing. */
  function epcQrText(snap, amountCents) {
    var s = snap.issuer;
    return ['BCD', '002', '1', 'SCT', s.bic || '', clip(s.name, 70), compactIban(s.iban), 'EUR' + (Math.max(0, Math.round(amountCents)) / 100).toFixed(2), '', '',
      clip((snap.purpose || '') + ' ' + (snap.reference || ''), 140)].join('\n');
  }
  function qrKind(country) { if (country === 'SI') return 'upn'; return EU.indexOf(country) >= 0 ? 'epc' : null; }
  var LATIN2_FALLBACK = { 'Š': 0xA9, 'Ž': 0xAE, 'š': 0xB9, 'ž': 0xBE, 'Ć': 0xC6, 'Č': 0xC8, 'Đ': 0xD0, 'ć': 0xE6, 'č': 0xE8, 'đ': 0xF0, 'Ä': 0xC4, 'ä': 0xE4, 'Ö': 0xD6, 'ö': 0xF6, 'Ü': 0xDC, 'ü': 0xFC, 'ß': 0xDF, 'é': 0xE9, 'É': 0xC9, ' ': 0xA0 };
  var latin2 = null;
  /** string → ISO-8859-2 bytes ('?' for characters outside it). Ported from Billing (toLatin2Bytes). */
  function toLatin2Bytes(str) {
    if (!latin2) {
      latin2 = {};
      try {
        var dec = new TextDecoder('iso-8859-2');
        for (var b = 0xa0; b <= 0xff; b++) latin2[dec.decode(Uint8Array.of(b))] = b;
      } catch (e) { latin2 = LATIN2_FALLBACK; }
    }
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var ch = str[i], code = ch.charCodeAt(0);
      if (code < 0x80) out.push(code);
      else out.push(latin2[ch] !== undefined ? latin2[ch] : 0x3f);
    }
    return out;
  }
  function ibanValid(iban) {
    var s = compactIban(iban);
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
    var r = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, function (c) { return String(c.charCodeAt(0) - 55); }), m = 0;
    for (var i = 0; i < r.length; i++) m = (m * 10 + Number(r[i])) % 97;
    return m === 1;
  }
  function formatIban(s) { return compactIban(s).replace(/(.{4})(?=.)/g, '$1 '); }
  /** Slovenian tax number (davčna številka): 8 digits, mod-11 check digit */
  function siTaxValid(v) {
    var s = String(v || '').replace(/^SI/i, '').replace(/\s+/g, '');
    if (!/^[1-9]\d{7}$/.test(s)) return false;
    var t = 0; for (var i = 0; i < 7; i++) t += Number(s[i]) * (8 - i);
    var check = 11 - (t % 11);
    if (check === 10) return false;
    if (check === 11) check = 0;
    return check === Number(s[7]);
  }
  /** Croatian OIB: 11 digits, ISO 7064 MOD 11,10 check digit */
  function hrOibValid(v) {
    var s = String(v || '').replace(/^HR/i, '').replace(/\s+/g, '');
    if (!/^\d{11}$/.test(s)) return false;
    var a = 10;
    for (var i = 0; i < 10; i++) { a = (a + Number(s[i])) % 10; if (a === 0) a = 10; a = (a * 2) % 11; }
    var check = 11 - a; if (check === 10) check = 0;
    return check === Number(s[10]);
  }
  function vatIdValid(v) {
    var s = String(v || '').replace(/[\s.-]+/g, '').toUpperCase();
    if (!s) return false;
    if (s.indexOf('SI') === 0) return siTaxValid(s);
    if (s.indexOf('HR') === 0) return hrOibValid(s);
    return /^(EL|[A-Z]{2})[0-9A-Z]{2,13}$/.test(s);
  }

  // ── letters ──────────────────────────────────────────────────────────────
  var LANGS = ['sl', 'hr', 'en'];
  var COUNTRY_NAMES = {
    sl: { SI: 'Slovenija', HR: 'Hrvaška', AT: 'Avstrija', IT: 'Italija', DE: 'Nemčija', HU: 'Madžarska' },
    hr: { SI: 'Slovenija', HR: 'Hrvatska', AT: 'Austrija', IT: 'Italija', DE: 'Njemačka', HU: 'Mađarska' },
    en: { SI: 'Slovenia', HR: 'Croatia', AT: 'Austria', IT: 'Italy', DE: 'Germany', HU: 'Hungary' }
  };
  var T = {
    sl: {
      titles: ['Obvestilo o zapadlih računih', 'Opomin', 'Drugi opomin', 'Zadnji opomin pred tožbo'],
      salutation: 'Spoštovani,',
      intro: [
        'Pri pregledu odprtih postavk smo ugotovili, da spodaj navedeni računi še niso poravnani, čeprav je rok plačila že potekel. Verjamemo, da gre za spregled, zato vas prijazno prosimo, da zapadli znesek poravnate v prihodnjih dneh.',
        'Ugotavljamo, da do danes nismo prejeli plačila spodaj navedenih zapadlih računov. Prosimo, da skupni znesek poravnate najpozneje do {deadline}.',
        'Kljub našemu opominu z dne {last} spodaj navedeni računi še vedno niso poravnani. Za čas zamude vam zaračunavamo zakonske zamudne obresti, obračunane do današnjega dne. Prosimo, da dolg skupaj z obrestmi poravnate najpozneje do {deadline}.',
        'Kljub večkratnim opominom spodaj navedeni računi ostajajo neporavnani. To je naš zadnji opomin pred sodno izterjavo. Če celotnega dolga skupaj z zakonskimi zamudnimi obrestmi in nadomestilom izterjevalnih stroškov ne poravnate do {deadline}, bomo brez nadaljnjega obvestila vložili predlog za izvršbo oziroma tožbo pri pristojnem sodišču. Stroški postopka bodo bremenili vas.'
      ],
      introNoLast: 'Kljub našemu predhodnemu obvestilu spodaj navedeni računi še vedno niso poravnani. Za čas zamude vam zaračunavamo zakonske zamudne obresti, obračunane do današnjega dne. Prosimo, da dolg skupaj z obrestmi poravnate najpozneje do {deadline}.',
      pay: 'Prosimo, da znesek {total} nakažete na transakcijski račun {iban}, sklic {reference}, najpozneje do {deadline}.',
      interestNote: 'Zakonske zamudne obresti so obračunane od prvega dne po zapadlosti do {date} in tečejo do dneva plačila.',
      contractNote: 'Zamudne obresti so obračunane po pogodbeni obrestni meri {rate} od prvega dne po zapadlosti do {date} in tečejo do dneva plačila.',
      feeNote: 'Nadomestilo izterjevalnih stroškov znaša {fee} za vsak zapadli račun (Zakon o preprečevanju zamud pri plačilih, Direktiva 2011/7/EU).',
      closing: ['Če ste zapadle račune medtem že poravnali, se vam zahvaljujemo in vas prosimo, da ta dopis štejete za brezpredmeten.', 'Če ste dolg medtem že poravnali, vas prosimo, da ta dopis štejete za brezpredmeten.'],
      contact: 'Za vprašanja smo vam na voljo na telefonski številki {phone} ali na e-naslovu {email}.',
      signoff: ['Lep pozdrav,', 'S spoštovanjem,'],
      th: { no: 'Račun', issued: 'Datum izdaje', due: 'Zapadlost', paid: 'Plačano', open: 'Odprto', late: 'Dni zamude', interest: 'Zamudne obresti' },
      ofWhich: 'od tega {list}', ofCosts: 'stroški {x}', ofInterest: 'obresti {x}',
      paidNote: 'Prejeta delna plačila v skupnem znesku {paid} smo v skladu z 288. členom Obligacijskega zakonika najprej poračunali s stroški, nato z obrestmi in nazadnje z glavnico: {split}.',
      split: { costs: '{x} za stroške', interest: '{x} za obresti', principal: '{x} za glavnico', and: 'in' },
      tot: { principal: 'Glavnica', interest: 'Zamudne obresti do {date}', fee: 'Nadomestilo izterjevalnih stroškov', total: 'Skupaj za plačilo' },
      payTitle: 'Podatki za plačilo', payee: 'Prejemnik', iban: 'IBAN', ref: 'Sklic', purpose: 'Namen', payBy: 'Rok plačila', amount: 'Znesek',
      placeDate: 'Kraj in datum', qrUpn: 'UPN QR: skenirajte z mobilno banko', qrEpc: 'Plačilni QR (SEPA)', letterNo: 'Številka', custNo: 'Šifra kupca', vat: 'ID za DDV',
      purposeText: 'Plačilo zapadlih računov {no}', listTitle: 'Zapadli računi:', more: '… in še {n} računov (glejte priloženi dopis)',
      line: '{no}, zapadel {due}, odprto {open} ({days} dni zamude)', payLine: 'Podatki za plačilo: IBAN {iban}, sklic {reference}, rok plačila {deadline}.'
    },
    hr: {
      titles: ['Podsjetnik na plaćanje', 'Opomena', 'Druga opomena', 'Opomena pred tužbu'],
      salutation: 'Poštovani,',
      intro: [
        'Uvidom u naše poslovne knjige utvrdili smo da niže navedeni računi još nisu plaćeni, iako im je istekao rok dospijeća. Vjerujemo da se radi o propustu te vas ljubazno molimo da dospjeli iznos podmirite u narednih nekoliko dana.',
        'Utvrdili smo da do danas nismo zaprimili uplatu za niže navedene dospjele račune. Molimo vas da ukupan iznos podmirite najkasnije do {deadline}.',
        'Unatoč našoj opomeni od {last} niže navedeni računi još uvijek nisu plaćeni. Za razdoblje kašnjenja obračunavamo zakonske zatezne kamate do današnjeg dana. Molimo vas da dug zajedno s kamatama podmirite najkasnije do {deadline}.',
        'Unatoč ponovljenim opomenama niže navedeni računi i dalje nisu plaćeni. Ovo je naša posljednja opomena prije pokretanja sudskog postupka. Ako cjelokupni dug zajedno sa zakonskim zateznim kamatama i naknadom troškova naplate ne podmirite do {deadline}, bez daljnje ćemo obavijesti podnijeti prijedlog za ovrhu odnosno tužbu nadležnom sudu. Svi troškovi postupka padaju na vaš teret.'
      ],
      introNoLast: 'Unatoč našoj prethodnoj obavijesti niže navedeni računi još uvijek nisu plaćeni. Za razdoblje kašnjenja obračunavamo zakonske zatezne kamate do današnjeg dana. Molimo vas da dug zajedno s kamatama podmirite najkasnije do {deadline}.',
      pay: 'Molimo vas da iznos od {total} uplatite na račun {iban}, uz referencu {reference}, najkasnije do {deadline}.',
      interestNote: 'Zakonske zatezne kamate obračunate su od prvog dana nakon dospijeća do {date} i teku do dana plaćanja.',
      contractNote: 'Zatezne kamate obračunate su po ugovorenoj kamatnoj stopi od {rate} od prvog dana nakon dospijeća do {date} i teku do dana plaćanja.',
      feeNote: 'Naknada troškova naplate iznosi {fee} za svaki dospjeli račun (Direktiva 2011/7/EU o borbi protiv kašnjenja u plaćanju u poslovnim transakcijama).',
      closing: ['Ako ste dospjele račune u međuvremenu podmirili, zahvaljujemo vam i molimo vas da ovaj dopis smatrate bespredmetnim.', 'Ako ste dug u međuvremenu podmirili, molimo vas da ovaj dopis smatrate bespredmetnim.'],
      contact: 'Za sva pitanja stojimo vam na raspolaganju na broj telefona {phone} ili na adresi e-pošte {email}.',
      signoff: ['S poštovanjem,', 'S poštovanjem,'],
      th: { no: 'Račun', issued: 'Datum izdavanja', due: 'Dospijeće', paid: 'Plaćeno', open: 'Otvoreno', late: 'Dana kašnjenja', interest: 'Zatezne kamate' },
      ofWhich: 'od toga {list}', ofCosts: 'troškovi {x}', ofInterest: 'kamate {x}',
      paidNote: 'Primljene djelomične uplate u ukupnom iznosu od {paid} uračunali smo, u skladu s člankom 172. Zakona o obveznim odnosima, najprije u troškove, zatim u kamate i na kraju u glavnicu: {split}.',
      split: { costs: '{x} na troškove', interest: '{x} na kamate', principal: '{x} na glavnicu', and: 'i' },
      tot: { principal: 'Glavnica', interest: 'Zatezne kamate do {date}', fee: 'Naknada troškova naplate', total: 'Ukupno za plaćanje' },
      payTitle: 'Podaci za plaćanje', payee: 'Primatelj', iban: 'IBAN', ref: 'Referenca', purpose: 'Opis plaćanja', payBy: 'Rok plaćanja', amount: 'Iznos',
      placeDate: 'Mjesto i datum', qrUpn: 'Skenirajte i platite', qrEpc: 'Skenirajte i platite (SEPA QR)', letterNo: 'Broj', custNo: 'Šifra kupca', vat: 'PDV ID',
      purposeText: 'Plaćanje dospjelih računa {no}', listTitle: 'Dospjeli računi:', more: '… i još {n} računa (vidi priloženi dopis)',
      line: '{no}, dospio {due}, otvoreno {open} ({days} dana kašnjenja)', payLine: 'Podaci za plaćanje: IBAN {iban}, referenca {reference}, rok plaćanja {deadline}.'
    },
    en: {
      titles: ['Payment reminder', 'First reminder', 'Second reminder', 'Final notice before legal action'],
      salutation: 'Dear Sir or Madam,',
      intro: [
        'Our records show that the invoices listed below are still unpaid, although their due date has passed. We assume this is an oversight and kindly ask you to settle the overdue amount within the next few days.',
        'We have not yet received payment for the overdue invoices listed below. Please pay the total amount by {deadline} at the latest.',
        'Despite our reminder of {last}, the invoices listed below are still unpaid. We are charging statutory default interest for the period of delay, calculated up to today. Please pay the debt together with the interest by {deadline} at the latest.',
        'Despite repeated reminders, the invoices listed below remain unpaid. This is our final notice before legal action. If the full amount, including statutory default interest and the compensation for recovery costs, is not paid by {deadline}, we will apply to the competent court for enforcement or bring legal proceedings without further notice. All costs of the proceedings will be charged to you.'
      ],
      introNoLast: 'Despite our earlier notice, the invoices listed below are still unpaid. We are charging statutory default interest for the period of delay, calculated up to today. Please pay the debt together with the interest by {deadline} at the latest.',
      pay: 'Please transfer {total} to IBAN {iban}, quoting reference {reference}, by {deadline}.',
      interestNote: 'Statutory default interest is calculated from the day after the due date up to {date} and continues to accrue until payment.',
      contractNote: 'Default interest is calculated at the contractual rate of {rate} from the day after the due date up to {date} and continues to accrue until payment.',
      feeNote: 'The compensation for recovery costs is {fee} for each overdue invoice (Directive 2011/7/EU on combating late payment in commercial transactions).',
      closing: ['If you have already paid, thank you, and please disregard this letter.', 'If you have settled the debt in the meantime, please disregard this letter.'],
      contact: 'If you have any questions, please contact us on {phone} or at {email}.',
      signoff: ['Yours faithfully,', 'Yours faithfully,'],
      th: { no: 'Invoice', issued: 'Issue date', due: 'Due date', paid: 'Paid', open: 'Open amount', late: 'Days late', interest: 'Interest' },
      ofWhich: 'of which {list}', ofCosts: 'costs {x}', ofInterest: 'interest {x}',
      paidNote: 'The part-payments we received, {paid} in total, have been applied as the law provides: first to costs, then to interest and finally to the principal: {split}.',
      split: { costs: '{x} to costs', interest: '{x} to interest', principal: '{x} to the principal', and: 'and' },
      tot: { principal: 'Principal', interest: 'Default interest to {date}', fee: 'Compensation for recovery costs', total: 'Total due' },
      payTitle: 'Payment details', payee: 'Payee', iban: 'IBAN', ref: 'Reference', purpose: 'Purpose', payBy: 'Pay by', amount: 'Amount',
      placeDate: 'Place and date', qrUpn: 'Scan to pay', qrEpc: 'Scan to pay (SEPA QR)', letterNo: 'Our ref.', custNo: 'Customer no.', vat: 'VAT ID',
      purposeText: 'Payment of overdue invoices {no}', listTitle: 'Overdue invoices:', more: '… and {n} more invoices (see the attached letter)',
      line: '{no}, due {due}, open {open} ({days} days late)', payLine: 'Payment details: IBAN {iban}, reference {reference}, pay by {deadline}.'
    }
  };
  /** fills {placeholders}; a Croatian date ends with a full stop, so a sentence ending in one does not get a second */
  function fill(tpl, vars) { return String(tpl).replace(/\{(\w+)\}/g, function (m, k) { return vars[k] == null ? m : vars[k]; }).replace(/(\d)\.\./g, '$1.'); }
  /** the default intro paragraph for a stage and language */
  function defaultIntro(lang, stage, vars) {
    var t = T[lang] || T.sl;
    var tpl = stage === 2 && !vars.last ? t.introNoLast : t.intro[stage];
    return fill(tpl, vars);
  }
  /** letter number: year / running number of letters sent that year */
  function nextLetterNo(actions, today, offset) {
    var y = today.slice(0, 4), n = (actions || []).filter(function (a) { return a.type === 'letter' && a.date && a.date.slice(0, 4) === y; }).length;
    return y + '/' + String(n + 1 + (offset || 0)).padStart(4, '0');
  }
  /** Everything a reminder letter shows. o: { company, sender, customer, invoices (the customer's), actions (the
   * customer's), stage, today, lang, settings, letterNo, intro } */
  function letterModel(o) {
    var S = normSettings(o.settings), today = o.today, lang = LANGS.indexOf(o.lang) >= 0 ? o.lang : 'sl', t = T[lang];
    var stage = Math.max(0, Math.min(S.stages.length - 1, +o.stage || 0)), stg = S.stages[stage], c = o.customer;
    var iopt = interestOpts(c, S), costsEach = stg.fee ? S.fixedFee : 0;
    // an invoice still open in the books; the payments on it go to costs, interest and principal in the order set in
    // Settings (the law: costs, interest, principal), counting only what this stage claims
    var rows = (o.invoices || []).filter(function (inv) { return openAt(inv, today) > 0 && inv.dueDate < today && !isDisputedAt(inv, today); })
      .sort(function (a, b) { return a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : a.no < b.no ? -1 : 1; })
      .map(function (inv) {
        var it = interestFor(inv, today, { rates: iopt.rates, contractRate: iopt.contractRate, cap: iopt.cap, order: iopt.order, interest: !!stg.interest, costs: costsEach });
        return {
          id: inv.id, no: inv.no, issueDate: inv.issueDate, dueDate: inv.dueDate, amount: it.amount, balance: openAt(inv, today), open: it.principalOpen, days: diffDays(inv.dueDate, today),
          interest: stg.interest ? it.interestOpen : 0, costs: it.costsOpen, paid: it.paid, paidCosts: it.costsPaid, paidInterest: it.interestPaid, paidPrincipal: it.principalPaid,
          calc: stg.interest ? it : null, split: it, reference: paymentReference(inv.no)
        };
      });
    var disputed = (o.invoices || []).filter(function (inv) { return openAt(inv, today) > 0 && inv.dueDate < today && isDisputedAt(inv, today); });
    var principal = round2(sum(rows, function (r) { return r.open; })), interest = round2(sum(rows, function (r) { return r.interest; }));
    var fee = stg.fee ? round2(sum(rows, function (r) { return r.costs; })) : 0, total = round2(principal + interest + fee);
    var paid = { total: 0, costs: 0, interest: 0, principal: 0 };
    rows.forEach(function (r) { paid.total += r.paid; paid.costs += r.paidCosts; paid.interest += r.paidInterest; paid.principal += r.paidPrincipal; });
    Object.keys(paid).forEach(function (k) { paid[k] = round2(paid[k]); });
    var assumedFrom = [];
    rows.forEach(function (r) { (r.calc ? r.calc.assumedFrom : []).forEach(function (d) { if (assumedFrom.indexOf(d) < 0) assumedFrom.push(d); }); });
    var deadline = addDays(today, S.payDays);
    var past = (o.actions || []).filter(function (a) { return a.type === 'letter' && a.date < today; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var lastLetter = past.length ? past[past.length - 1] : null;
    var vars = { deadline: fmtDate(deadline, lang), last: lastLetter ? fmtDate(lastLetter.date, lang) : '', date: fmtDate(today, lang) };
    var intro = o.intro != null && String(o.intro).trim() ? String(o.intro) : defaultIntro(lang, stage, vars);
    var reference = rows.length ? rows[0].reference : '';
    var co = o.company || {}, firm = stage === 0 ? 0 : 1;
    var contract = iopt.contractRate !== null;
    var m = {
      lang: lang, stage: stage, stageName: stg.name, title: t.titles[stage], today: today, deadline: deadline, letterNo: o.letterNo || '',
      rows: rows, disputed: disputed, principal: principal, interest: interest, fee: fee, feeEach: S.fixedFee, feeFull: round2(costsEach * rows.length), total: total,
      paid: paid, payOrder: iopt.order, paymentsNote: paidNote(t, lang, paid), assumedRate: assumedFrom.length > 0, assumedFrom: assumedFrom.sort(),
      withInterest: stg.interest, withFee: stg.fee, capped: rows.some(function (r) { return r.calc && r.calc.capped; }),
      missingRate: rows.some(function (r) { return r.calc && r.calc.missing; }), contractRate: iopt.contractRate, cap: iopt.cap,
      reference: reference, iban: co.iban || '', lastLetter: lastLetter, intro: intro, defaultIntro: defaultIntro(lang, stage, vars), edited: intro !== defaultIntro(lang, stage, vars),
      salutation: t.salutation, signoff: t.signoff[firm], closing: t.closing[firm],
      contactLine: fill(t.contact, { phone: (o.sender && o.sender.phone) || co.phone || '', email: (o.sender && o.sender.email) || co.email || '' }),
      payText: fill(t.pay, { total: fmtMoney(total, lang), iban: formatIban(co.iban), reference: reference, deadline: fmtDate(deadline, lang) }),
      interestNote: stg.interest && rows.length ? fill(contract ? t.contractNote : t.interestNote, { date: fmtDate(today, lang), rate: fmtNum(iopt.contractRate || 0, 2, lang) + (lang === 'en' ? '%' : ' %') }) : '',
      feeNote: stg.fee && rows.length ? fill(t.feeNote, { fee: fmtMoney(S.fixedFee, lang) }) : '',
      purpose: clip(fill(t.purposeText, { no: o.letterNo || '' }), 42),
      qr: qrKind(c && c.country), labels: t, place: (co.city || 'Ljubljana').replace(/\s*-\s*.*$/, '')
    };
    return m;
  }
  /** "of which interest 27,81 €, costs 40,00 €" for one letter row, or "" when the payments went to the principal only */
  function ofWhich(r, lang) {
    var t = T[lang] || T.sl, parts = [];
    if (r.paidInterest > 0) parts.push(fill(t.ofInterest, { x: fmtMoney(r.paidInterest, lang) }));
    if (r.paidCosts > 0) parts.push(fill(t.ofCosts, { x: fmtMoney(r.paidCosts, lang) }));
    return parts.length ? fill(t.ofWhich, { list: parts.join(', ') }) : '';
  }
  /** the sentence on how part-payments were applied; empty when they all went to the principal */
  function paidNote(t, lang, paid) {
    if (!(paid.costs > 0 || paid.interest > 0)) return '';
    var parts = [];
    if (paid.costs > 0) parts.push(fill(t.split.costs, { x: fmtMoney(paid.costs, lang) }));
    if (paid.interest > 0) parts.push(fill(t.split.interest, { x: fmtMoney(paid.interest, lang) }));
    if (paid.principal > 0) parts.push(fill(t.split.principal, { x: fmtMoney(paid.principal, lang) }));
    var split = parts.length > 1 ? parts.slice(0, -1).join(', ') + ' ' + t.split.and + ' ' + parts[parts.length - 1] : parts[0];
    return fill(t.paidNote, { paid: fmtMoney(paid.total, lang), split: split });
  }
  /** what goes into the payment QR: the issuer's account and the letter's total, due on the letter's deadline */
  function qrSnapshot(m, company, cust) {
    var a = (cust && cust.address) || {};
    return {
      customer: { name: cust ? cust.name : '', address: a.street || '', postalCity: ((a.postal || '') + ' ' + (a.city || '')).trim(), country: cust ? cust.country : '' },
      issuer: { name: company.name, address: company.street, postalCity: ((company.postal || '') + ' ' + (company.city || '')).trim(), iban: company.iban, bic: company.bic || '' },
      purposeCode: company.purposeCode || 'GDSV', purpose: m.purpose, dueDate: m.deadline, reference: m.reference
    };
  }
  function signature(sender, company, lang) {
    var title = sender && sender.title ? (sender.title[lang] || sender.title.en || '') : '';
    return [sender && sender.name, title, company && company.name].filter(Boolean);
  }
  /** e-mail subject and plain-text body (the whole letter) */
  function emailText(m, company, sender) {
    var t = m.labels, lang = m.lang, L = [];
    var subject = m.title + ' – ' + (company.name || '') + ' – ' + fmtMoney(m.total, lang);
    L.push(m.salutation, '', m.intro, '', t.listTitle);
    m.rows.forEach(function (r) { L.push('- ' + fill(t.line, { no: r.no, due: fmtDate(r.dueDate, lang), open: fmtMoney(r.open, lang), days: r.days })); });
    L.push('');
    L.push(t.tot.principal + ': ' + fmtMoney(m.principal, lang));
    if (m.withInterest) L.push(fill(t.tot.interest, { date: fmtDate(m.today, lang) }) + ': ' + fmtMoney(m.interest, lang));
    if (m.withFee) L.push(t.tot.fee + ': ' + fmtMoney(m.fee, lang));
    L.push(t.tot.total + ': ' + fmtMoney(m.total, lang), '');
    L.push(m.payText);
    if (m.paymentsNote) L.push(m.paymentsNote);
    if (m.interestNote) L.push(m.interestNote);
    if (m.feeNote) L.push(m.feeNote);
    L.push('', m.closing, m.contactLine, '', m.signoff);
    signature(sender, company, lang).forEach(function (x) { L.push(x); });
    return { subject: subject, body: L.join('\n') };
  }
  /** mailto: link with a short body, kept under `limit` characters in total (default 1800) */
  function mailtoHref(to, m, company, sender, limit) {
    limit = limit || 1800;
    var t = m.labels, lang = m.lang, subject = m.title + ' – ' + (company.name || '') + ' – ' + fmtMoney(m.total, lang);
    function build(nLines, withIntro) {
      var L = [m.salutation, ''];
      if (withIntro) L.push(m.intro, '');
      L.push(t.listTitle);
      m.rows.slice(0, nLines).forEach(function (r) { L.push('- ' + fill(t.line, { no: r.no, due: fmtDate(r.dueDate, lang), open: fmtMoney(r.open, lang), days: r.days })); });
      if (m.rows.length > nLines) L.push(fill(t.more, { n: m.rows.length - nLines }));
      L.push('', t.tot.total + ': ' + fmtMoney(m.total, lang), fill(t.payLine, { iban: formatIban(m.iban), reference: m.reference, deadline: fmtDate(m.deadline, lang) }), '', m.signoff);
      signature(sender, company, lang).forEach(function (x) { L.push(x); });
      return 'mailto:' + encodeURIComponent(to || '') + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(L.join('\n'));
    }
    var withIntro = true;
    for (var n = m.rows.length; n >= 0; n--) { var href = build(n, withIntro); if (href.length <= limit) return href; }
    withIntro = false;
    for (n = m.rows.length; n >= 0; n--) { href = build(n, withIntro); if (href.length <= limit) return href; }
    return build(0, false).slice(0, limit);
  }

  // ── CSV ──────────────────────────────────────────────────────────────────
  /** RFC 4180 parser: quoted fields with "" escapes, delimiters and line breaks inside quotes, ; , or tab
   * (detected on the first line, outside quotes), a byte-order mark, CRLF / LF / CR. Empty rows are dropped. */
  function parseCsv(text, delim) {
    text = String(text == null ? '' : text).replace(/^﻿/, '');
    if (!delim) {
      var counts = { ';': 0, ',': 0, '\t': 0 }, q = false;
      for (var j = 0; j < text.length; j++) {
        var c = text[j];
        if (c === '"') q = !q;
        else if (!q && (c === '\n' || c === '\r')) break;
        else if (!q && counts[c] !== undefined) counts[c]++;
      }
      delim = counts['\t'] > counts[';'] && counts['\t'] > counts[','] ? '\t' : counts[','] > counts[';'] ? ',' : ';';
    }
    var rows = [], row = [], cell = '', inQ = false, i = 0, n = text.length;
    for (; i < n; i++) {
      var ch = text[i];
      if (inQ) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false; }
        else cell += ch;
      } else if (ch === '"' && cell === '') inQ = true;
      else if (ch === delim) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return { delimiter: delim, rows: rows.filter(function (r) { return r.some(function (x) { return String(x).trim() !== ''; }); }) };
  }
  /** 1.234,56 · 1234,56 · 1,234.56 · 1234.56 · 1.234 (thousands) · −12 · (12) · with € / EUR / spaces; NaN when not a number */
  function parseNumber(s) {
    s = String(s == null ? '' : s).trim();
    if (!s) return NaN;
    var neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    s = s.replace(/EUR|€/gi, '').replace(/[\s  ']/g, '');
    if (/^[−-]/.test(s)) { neg = !neg; s = s.slice(1); }
    if (/[−-]$/.test(s)) { neg = !neg; s = s.slice(0, -1); }
    if (!/^[\d.,]+$/.test(s)) return NaN;
    var lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',');
    if (lastDot >= 0 && lastComma >= 0) {
      if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
      else s = s.replace(/,/g, '');
    } else if (lastComma >= 0) {
      if ((s.match(/,/g) || []).length > 1) { if (!/^[1-9]\d{0,2}(,\d{3})+$/.test(s)) return NaN; s = s.replace(/,/g, ''); }
      else s = s.replace(',', '.');
    } else if (lastDot >= 0) {
      if (/^[1-9]\d{0,2}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
      else if ((s.match(/\./g) || []).length > 1) return NaN;
    }
    if (!/^\d*\.?\d+$|^\d+\.$/.test(s)) return NaN;
    var v = Number(s);
    return isFinite(v) ? (neg ? -v : v) : NaN;
  }
  /** 13.10.2026 · 13. 10. 2026 · 13.10.2026. · 2026-10-13 · 13/10/2026 → '2026-10-13'; null when not a valid date */
  function parseDate(s) {
    s = String(s == null ? '' : s).trim().replace(/[T ]\d{1,2}:\d{2}(:\d{2})?.*$/, '');
    if (isDate(s)) return s;
    var m = /^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})\.?$/.exec(s) || /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
    if (m) { var d = m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0'); return isDate(d) ? d : null; }
    m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
    if (m) { d = m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0'); return isDate(d) ? d : null; }
    return null;
  }
  function csvCell(v, delim) { v = String(v == null ? '' : v); return v.indexOf(delim) >= 0 || /["\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  /** rows → CSV text with a byte-order mark, ; between cells and CRLF line ends (opens cleanly in Slovenian Excel) */
  function toCsv(rows, delim) { delim = delim || ';'; return '﻿' + rows.map(function (r) { return r.map(function (c) { return csvCell(c, delim); }).join(delim); }).join('\r\n') + '\r\n'; }
  function num2(n) { return round2(n).toFixed(2).replace('.', ','); }

  var IMPORT_FIELDS = [
    { id: 'no', label: 'Invoice number', required: true, hints: ['invoice number', 'invoice no', 'invoice', 'number', 'no', 'št. računa', 'številka', 'stevilka', 'račun', 'racun', 'broj računa', 'broj', 'document', 'dokument'] },
    { id: 'customer', label: 'Customer', required: true, hints: ['customer', 'kupec', 'partner', 'stranka', 'kupac', 'naziv kupca', 'naziv', 'client', 'name'] },
    { id: 'vatId', label: 'Customer VAT ID', hints: ['vat id', 'vat', 'id za ddv', 'ddv', 'davčna', 'davcna', 'oib', 'pdv', 'tax'] },
    { id: 'dueDate', label: 'Due date', required: true, hints: ['due date', 'due', 'zapadlost', 'datum zapadlosti', 'valuta', 'rok plačila', 'rok', 'dospijeće', 'dospijece', 'datum dospijeća'] },
    { id: 'issueDate', label: 'Issue date', hints: ['issue date', 'issued', 'issue', 'datum izdaje', 'datum računa', 'datum izdavanja', 'invoice date', 'datum', 'date'] },
    { id: 'open', label: 'Open amount', hints: ['open amount', 'open', 'odprto', 'odprti znesek', 'saldo', 'balance', 'outstanding', 'neplačano', 'otvoreno', 'preostalo'] },
    { id: 'amount', label: 'Invoice amount (gross)', required: true, hints: ['amount', 'gross', 'znesek', 'znesek računa', 'iznos', 'total', 'bruto', 'vrednost', 'vrijednost'] },
    { id: 'country', label: 'Country', hints: ['country', 'država', 'drzava', 'zemlja'] },
    { id: 'email', label: 'E-mail', hints: ['e-mail', 'email', 'e-pošta', 'e-posta', 'mail'] },
    { id: 'phone', label: 'Phone', hints: ['phone', 'telefon', 'tel', 'gsm', 'mobile'] },
    { id: 'debit', label: 'Debit (ledger exports)', hints: ['debet', 'breme', 'duguje', 'debit'] },
    { id: 'credit', label: 'Credit / paid (ledger exports)', hints: ['kredit', 'dobro', 'potražuje', 'potrazuje', 'credit', 'plačano', 'placano', 'plaćeno'] }
  ];
  /* Column presets for the open-items exports of the two most common Slovenian accounting programs. The header names
   * are the ones their Slovenian exports use as far as we know (Minimax: Poslovanje → Odprte postavke → Izvoz;
   * Pantheon: Saldakonti → Odprte postavke / Kartica partnerja → Izvoz v Excel/CSV, where "Valuta" is the due date and
   * a document can have several lines: the invoice in Debet and its payments in Kredit). SIMON MUST CONFIRM them
   * against a real export of each customer's version: anything the preset misses can still be mapped by hand. */
  var IMPORT_PRESETS = [
    { id: 'minimax', name: 'Minimax', aggregate: true, headers: {
      no: ['številka dokumenta', 'št. dokumenta', 'dokument', 'številka računa', 'račun'], customer: ['stranka', 'naziv stranke', 'kupec', 'naziv'],
      vatId: ['davčna številka', 'id za ddv', 'davčna št.', 'id številka za ddv'], issueDate: ['datum dokumenta', 'datum računa', 'datum izdaje', 'datum'],
      dueDate: ['datum zapadlosti', 'zapadlost', 'rok plačila', 'datum valute'], amount: ['znesek', 'znesek dokumenta', 'znesek v dv', 'za plačilo', 'vrednost'],
      open: ['odprto', 'odprti znesek', 'neplačano', 'saldo'], credit: ['plačano', 'zaprto'], country: ['država'], email: ['e-pošta', 'e-mail', 'email'], phone: ['telefon'] } },
    { id: 'pantheon', name: 'Pantheon', aggregate: true, headers: {
      no: ['dokument', 'št. dokumenta', 'številka dokumenta', 'vezni dokument', 'račun'], customer: ['partner', 'naziv partnerja', 'kupec', 'subjekt'],
      vatId: ['id za ddv', 'davčna številka', 'davčna št.', 'ddv št.'], issueDate: ['datum dok.', 'datum dokumenta', 'datum', 'dat. dok.'],
      dueDate: ['valuta', 'datum valute', 'dat. valute', 'zapadlost', 'datum zapadlosti'], debit: ['debet', 'breme'], credit: ['kredit', 'dobro'],
      amount: ['znesek'], open: ['odprto', 'saldo'], country: ['država'], email: ['e-pošta', 'e-mail'], phone: ['telefon'] } }
  ];
  /** the preset whose header names the file uses most (at least three of them), or null */
  function detectPreset(headers) {
    var H = headers.map(normHead), best = null, bestN = 2;
    IMPORT_PRESETS.forEach(function (p) {
      var n = 0;
      Object.keys(p.headers).forEach(function (k) { if (p.headers[k].some(function (h) { return H.indexOf(h) >= 0; })) n++; });
      if (p.id === 'pantheon' && H.indexOf('debet') >= 0 && H.indexOf('kredit') >= 0) n += 2;
      if (n > bestN) { bestN = n; best = p; }
    });
    return best;
  }
  /** bytes of an uploaded file → text: UTF-8 when it is valid UTF-8, else Windows-1250 (older Slovenian/Croatian exports) */
  function decodeBytes(bytes) {
    try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' }; }
    catch (e) {
      try { return { text: new TextDecoder('windows-1250').decode(bytes), encoding: 'windows-1250' }; }
      catch (e2) { return { text: new TextDecoder('utf-8').decode(bytes), encoding: 'utf-8' }; }
    }
  }
  function normHead(h) { return String(h || '').toLowerCase().replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  /** column for each field, guessed from the header names (English, Slovene, Croatian); -1 when not found */
  function guessMapping(headers, fields, preset) {
    var H = headers.map(normHead), used = {}, map = {};
    (fields || IMPORT_FIELDS).forEach(function (f) {
      var best = -1, bestScore = 0, ph = preset && preset.headers && preset.headers[f.id];
      if (ph) ph.forEach(function (hint, k) { var i = H.indexOf(hint); if (i >= 0 && !used[i] && 200 - k > bestScore) { bestScore = 200 - k; best = i; } });
      if (preset && preset.headers && !ph && f.id !== 'country' && f.id !== 'email' && f.id !== 'phone') { map[f.id] = -1; return; }
      H.forEach(function (h, i) {
        if (used[i] || !h || best >= 0) return;
        f.hints.forEach(function (hint, k) {
          var sc = h === hint ? 100 - k : (h.indexOf(hint) === 0 ? 60 - k : (hint.length > 2 && h.indexOf(hint) > 0 ? 30 - k : 0));
          if (sc > bestScore) { bestScore = sc; best = i; }
        });
      });
      map[f.id] = best;
      if (best >= 0) used[best] = 1;
    });
    return map;
  }
  /** Validate mapped rows. Returns items to import, errors (block the import) and warnings (rows skipped or defaults used). */
  function buildImport(rows, mapping, opts) {
    opts = opts || {};
    var today = opts.today, existing = opts.existing || {}, seen = {}, items = [], errors = [], warnings = [], missingIssue = 0;
    var body = rows.slice(opts.hasHeader === false ? 0 : 1);
    var ledger = mapping.debit >= 0, agg = !!opts.aggregate || ledger, byNo = {};
    IMPORT_FIELDS.forEach(function (f) { if (f.required && !(mapping[f.id] >= 0) && !(f.id === 'amount' && ledger)) errors.push({ line: 0, msg: 'Choose the column for "' + f.label + '".' }); });
    if (errors.length) return { items: items, errors: errors, warnings: warnings };
    function get(r, k) { return mapping[k] >= 0 ? String(r[mapping[k]] == null ? '' : r[mapping[k]]).trim() : ''; }
    body.forEach(function (r, i) {
      var line = i + (opts.hasHeader === false ? 1 : 2), errs = [];
      var no = get(r, 'no'), cust = get(r, 'customer'), due = parseDate(get(r, 'dueDate')), issRaw = get(r, 'issueDate'), iss = issRaw ? parseDate(issRaw) : null;
      var amtRaw = ledger ? get(r, 'debit') : get(r, 'amount'), amount = amtRaw === '' && ledger ? 0 : parseNumber(amtRaw);
      var crRaw = get(r, 'credit'), credit = crRaw === '' ? 0 : parseNumber(crRaw);
      var openRaw = mapping.credit >= 0 && agg ? '' : get(r, 'open'), open = openRaw === '' ? amount - (isFinite(credit) ? credit : 0) : parseNumber(openRaw);
      if (agg && no && (byNo[no] || amount < 0 || (ledger && amount === 0))) {
        // a further line of a document already read (its payments, a credit note), or a payment line: add it up
        if (crRaw !== '' && !isFinite(credit)) { errors.push({ line: line, msg: 'Row ' + line + ': credit "' + crRaw + '" is not a number.' }); return; }
        if (!isFinite(amount)) { errors.push({ line: line, msg: 'Row ' + line + ': amount "' + amtRaw + '" is not a number.' }); return; }
        var pend = byNo[no] || (byNo[no] = { line: line, no: no, rows: [], amount: 0, paid: 0, base: null });
        pend.amount = round2(pend.amount + Math.max(0, amount)); pend.paid = round2(pend.paid + (amount < 0 ? -amount : 0) + (isFinite(credit) ? credit : 0));
        if (!pend.base && amount > 0) pend.base = { r: r, line: line };
        pend.rows.push(line);
        return;
      }
      if (!no) errs.push('the invoice number is empty');
      if (!cust) errs.push('the customer is empty');
      if (!due) errs.push('due date "' + get(r, 'dueDate') + '" is not a date (use 31.10.2026 or 2026-10-31)');
      if (issRaw && !iss) errs.push('issue date "' + issRaw + '" is not a date');
      if (!(amount > 0)) errs.push('amount "' + get(r, 'amount') + '" is not a positive number');
      if (openRaw !== '' && !(open >= 0)) errs.push('open amount "' + openRaw + '" is not a number');
      if (amount > 0 && open > amount + EPS) errs.push('the open amount is larger than the invoice amount');
      if (due && iss && iss > due) errs.push('the due date is before the issue date');
      if (no && seen[no]) errs.push('invoice ' + no + ' appears twice in the file (rows ' + seen[no] + ' and ' + line + ')');
      if (no) seen[no] = seen[no] || line;
      if (errs.length) { errs.forEach(function (e) { errors.push({ line: line, msg: 'Row ' + line + ': ' + e + '.' }); }); return; }
      if (agg) { byNo[no] = { line: line, no: no, rows: [line], amount: round2(amount), paid: round2(amount - open), base: { r: r, line: line }, first: true }; return; }
      if (open <= EPS) { warnings.push({ line: line, msg: 'Row ' + line + ': invoice ' + no + ' is fully paid, skipped.' }); return; }
      if (existing[no]) { warnings.push({ line: line, msg: 'Row ' + line + ': invoice ' + no + ' is already in the app, skipped.' }); return; }
      if (!iss) { iss = addDays(due, -30); missingIssue++; }
      var vat = get(r, 'vatId').replace(/\s+/g, '').toUpperCase();
      if (vat && !vatIdValid(vat)) warnings.push({ line: line, msg: 'Row ' + line + ': VAT ID ' + vat + ' fails its check digit; imported as it is.' });
      var country = get(r, 'country').toUpperCase().slice(0, 2) || (/^[A-Z]{2}/.test(vat) ? vat.slice(0, 2) : 'SI');
      items.push({ line: line, no: no, customer: cust, vatId: vat, issueDate: iss, dueDate: due, amount: round2(amount), open: round2(open), country: country, email: get(r, 'email'), phone: get(r, 'phone') });
    });
    if (agg) Object.keys(byNo).forEach(function (no) {
      var d = byNo[no];
      if (!d.base) { warnings.push({ line: d.line, msg: 'Row ' + d.line + ': document ' + no + ' has only payment or credit lines, skipped.' }); return; }
      var r = d.base.r, line = d.base.line, due = parseDate(get(r, 'dueDate')), issRaw = get(r, 'issueDate'), iss = issRaw ? parseDate(issRaw) : null;
      var errs = [];
      if (!get(r, 'customer')) errs.push('the customer is empty');
      if (!due) errs.push('due date "' + get(r, 'dueDate') + '" is not a date (use 31.10.2026 or 2026-10-31)');
      if (issRaw && !iss) errs.push('issue date "' + issRaw + '" is not a date');
      if (!(d.amount > 0)) errs.push('the invoice amount is not a positive number');
      if (due && iss && iss > due) errs.push('the due date is before the issue date');
      if (errs.length) { errs.forEach(function (e) { errors.push({ line: line, msg: 'Row ' + line + ': ' + e + '.' }); }); return; }
      var open = round2(d.amount - d.paid);
      if (d.rows.length > 1) warnings.push({ line: line, msg: 'Invoice ' + no + ': ' + d.rows.length + ' lines added up (rows ' + d.rows.join(', ') + ').' });
      if (open < -EPS) { warnings.push({ line: line, msg: 'Invoice ' + no + ' is overpaid by ' + fmtNum(-open, 2, 'sl') + ', skipped.' }); return; }
      if (open <= EPS) { warnings.push({ line: line, msg: 'Row ' + line + ': invoice ' + no + ' is fully paid, skipped.' }); return; }
      if (existing[no]) { warnings.push({ line: line, msg: 'Row ' + line + ': invoice ' + no + ' is already in the app, skipped.' }); return; }
      if (!iss) { iss = addDays(due, -30); missingIssue++; }
      var vat = get(r, 'vatId').replace(/\s+/g, '').toUpperCase();
      if (vat && !vatIdValid(vat)) warnings.push({ line: line, msg: 'Row ' + line + ': VAT ID ' + vat + ' fails its check digit; imported as it is.' });
      var country = get(r, 'country').toUpperCase().slice(0, 2) || (/^[A-Z]{2}/.test(vat) ? vat.slice(0, 2) : 'SI');
      items.push({ line: line, no: no, customer: get(r, 'customer'), vatId: vat, issueDate: iss, dueDate: due, amount: d.amount, open: open, country: country, email: get(r, 'email'), phone: get(r, 'phone') });
    });
    items.sort(function (a, b) { return a.line - b.line; });
    if (missingIssue) warnings.push({ line: 0, msg: missingIssue + (missingIssue === 1 ? ' row has' : ' rows have') + ' no issue date: set to 30 days before the due date.' });
    if (!body.length) errors.push({ line: 0, msg: 'The file has no rows under the header.' });
    if (today) items.forEach(function (it) { if (it.issueDate > today) warnings.push({ line: it.line, msg: 'Row ' + it.line + ': issue date is in the future.' }); });
    return { items: items, errors: errors, warnings: warnings };
  }

  // ── reports ──────────────────────────────────────────────────────────────
  /** payments received per Monday–Sunday week, the last n weeks (the current week last) */
  function collectedByWeek(invoices, today, n) {
    var start = addDays(mondayOf(today), -7 * (n - 1)), weeks = [];
    for (var i = 0; i < n; i++) weeks.push({ start: addDays(start, 7 * i), end: addDays(start, 7 * i + 6), amount: 0, count: 0 });
    invoices.forEach(function (inv) {
      (inv.payments || []).forEach(function (p) {
        if (p.date < start || p.date > today) return;
        var w = weeks[Math.floor(diffDays(start, p.date) / 7)];
        if (w) { w.amount += +p.amount || 0; w.count++; }
      });
    });
    weeks.forEach(function (w) { w.amount = round2(w.amount); });
    return weeks;
  }
  function collectedBetween(invoices, from, to) {
    var s = 0;
    invoices.forEach(function (inv) { (inv.payments || []).forEach(function (p) { if (p.date >= from && p.date <= to) s += +p.amount || 0; }); });
    return round2(s);
  }
  /** aging on today and on the n − 1 Sundays before it */
  function agingTrend(invoices, today, n) {
    var dates = [today], d = dow(today) === 0 ? addDays(today, -7) : addDays(today, -dow(today));
    while (dates.length < n) { dates.unshift(d); d = addDays(d, -7); }
    return dates.map(function (x) { return aging(invoices, x); });
  }
  /** DSO and average days late at the end of each of the last n months (the current month up to today) */
  function dsoByMonth(invoices, today, n) {
    var out = [];
    for (var i = n - 1; i >= 0; i--) {
      var ms = addMonths(startOfMonth(today), -i), me = i === 0 ? today : endOfMonth(ms), r = dso(invoices, me, 90), l = avgDaysLate(invoices, me, 90);
      out.push({ month: ms.slice(0, 7), date: me, dso: r.dso, ar: r.ar, sales: r.sales, late: l.days, paidCount: l.count, partial: i === 0 });
    }
    return out;
  }
  /** promises by month they were due: kept, broken, open */
  function promiseReport(actions, invBy, today, grace, months) {
    var res = { kept: 0, broken: 0, open: 0, keptAmount: 0, brokenAmount: 0, byMonth: [], rate: null };
    var from = addMonths(startOfMonth(today), -(months - 1)), byM = {};
    for (var i = 0; i < months; i++) { var k = addMonths(from, i).slice(0, 7); byM[k] = { month: k, kept: 0, broken: 0, open: 0 }; res.byMonth.push(byM[k]); }
    actions.forEach(function (a) {
      if (!a.promise || a.date > today) return;
      var p = promiseState(a, invBy[a.customerId] || [], today, grace);
      if (!p || p.state === 'cancelled') return;
      var m = byM[p.date.slice(0, 7)];
      if (m) m[p.state]++;
      if (p.date >= from) { res[p.state]++; if (p.state === 'kept') res.keptAmount += p.amount; if (p.state === 'broken') res.brokenAmount += p.amount; }
    });
    res.rate = res.kept + res.broken ? res.kept / (res.kept + res.broken) : null;
    return res;
  }
  /** per stage: letters sent at least 14 days ago, and how many were followed within 14 days by payments on their
   * invoices of at least 90 % of the principal (paid) or of something (part-paid) */
  function reminderReport(actions, invIndex, today, stages, windowDays) {
    windowDays = windowDays || 14;
    var res = stages.map(function (s) { return { stage: s.id, name: s.name, sent: 0, evaluated: 0, paid: 0, part: 0, rate: null, partRate: null }; });
    var since = addDays(today, -365);
    actions.forEach(function (a) {
      if (a.type !== 'letter' || a.date > today || a.date < since || !res[a.stage]) return;
      var r = res[a.stage]; r.sent++;
      var end = addDays(a.date, windowDays);
      if (end > today) return;
      r.evaluated++;
      var principal = +a.amount || 0, got = 0;
      (a.invoiceIds || []).forEach(function (id) {
        var inv = invIndex[id]; if (!inv) return;
        (inv.payments || []).forEach(function (p) { if (p.date > a.date && p.date <= end) got += +p.amount || 0; });
      });
      if (principal > 0 && got >= principal * 0.9 - EPS) r.paid++;
      else if (got > EPS) r.part++;
    });
    res.forEach(function (r) { r.rate = r.evaluated ? r.paid / r.evaluated : null; r.partRate = r.evaluated ? (r.paid + r.part) / r.evaluated : null; });
    return res;
  }
  /** slowest payers over the last year (weighted days late, at least `minPaid` paid invoices) */
  function slowPayers(customers, invBy, states, today, n, minPaid) {
    minPaid = minPaid || 3;
    return customers.map(function (c) {
      var b = states && states[c.id] ? states[c.id].behaviour : behaviour(invBy[c.id] || [], today);
      return { c: c, days: b.avg, count: b.rows.length, trend: b.trend, overdue: states && states[c.id] ? states[c.id].overdue : 0 };
    }).filter(function (x) { return x.count >= minPaid && x.days != null; })
      .sort(function (a, b) { return b.days - a.days; }).slice(0, n);
  }

  return {
    // dates and money
    DAY: DAY, EPS: EPS, isDate: isDate, addDays: addDays, diffDays: diffDays, dow: dow, mondayOf: mondayOf, isWeekend: isWeekend,
    workdayOnOrAfter: workdayOnOrAfter, workdayOnOrBefore: workdayOnOrBefore, isLeap: isLeap, daysInYear: daysInYear, daysInMonth: daysInMonth,
    startOfMonth: startOfMonth, endOfMonth: endOfMonth, addMonths: addMonths, minDate: minDate, maxDate: maxDate, round2: round2, sum: sum,
    fmtNum: fmtNum, fmtMoney: fmtMoney, fmtMoney0: fmtMoney0, fmtDate: fmtDate, fmtDateTable: fmtDateTable, fmtDayMonth: fmtDayMonth, fmtPct: fmtPct,
    // invoices, aging, DSO
    paidUpTo: paidUpTo, openAt: openAt, settledOn: settledOn, isDisputedAt: isDisputedAt, daysOverdue: daysOverdue,
    BUCKETS: BUCKETS, bucketOf: bucketOf, aging: aging, dso: dso, avgDaysLate: avgDaysLate,
    // interest and settings
    DEFAULT_RATES: DEFAULT_RATES, DEFAULT_STAGES: DEFAULT_STAGES, DEFAULT_SETTINGS: DEFAULT_SETTINGS, normSettings: normSettings, normRates: normRates,
    rateFor: rateFor, rateAssumed: rateAssumed, interestOpts: interestOpts, interestFor: interestFor, PAY_ORDERS: PAY_ORDERS,
    // follow-up
    ACTION_TYPES: ACTION_TYPES, OUTCOMES: OUTCOMES, isContact: isContact, promiseState: promiseState, planState: planState, splitPlan: splitPlan,
    allocate: allocate, behaviour: behaviour, analyzeCustomer: analyzeCustomer, dunning: dunning, priority: priority, risk: risk,
    indexDb: indexDb, analyzeAll: analyzeAll, callList: callList,
    // references, QR, validators
    paymentReference: paymentReference, upnQrText: upnQrText, epcQrText: epcQrText, qrKind: qrKind, toLatin2Bytes: toLatin2Bytes,
    ibanValid: ibanValid, formatIban: formatIban, siTaxValid: siTaxValid, hrOibValid: hrOibValid, vatIdValid: vatIdValid, EU: EU,
    // letters
    LANGS: LANGS, TEXTS: T, COUNTRY_NAMES: COUNTRY_NAMES, defaultIntro: defaultIntro, nextLetterNo: nextLetterNo, letterModel: letterModel,
    qrSnapshot: qrSnapshot, ofWhich: ofWhich, signature: signature, emailText: emailText, mailtoHref: mailtoHref, fill: fill,
    // CSV
    parseCsv: parseCsv, parseNumber: parseNumber, parseDate: parseDate, toCsv: toCsv, num2: num2, IMPORT_FIELDS: IMPORT_FIELDS, IMPORT_PRESETS: IMPORT_PRESETS, detectPreset: detectPreset, decodeBytes: decodeBytes, guessMapping: guessMapping, buildImport: buildImport,
    // reports
    collectedByWeek: collectedByWeek, collectedBetween: collectedBetween, agingTrend: agingTrend, dsoByMonth: dsoByMonth,
    promiseReport: promiseReport, reminderReport: reminderReport, slowPayers: slowPayers
  };
});
