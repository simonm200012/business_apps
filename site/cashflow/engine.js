/* Cash forecast engine (Adrial Apps): pure date and money rules, no DOM. UMD, so it also loads in Node.
 * Dates are 'YYYY-MM-DD' strings compared as strings; arithmetic is done in UTC.
 * forecast(db, opts) turns open receivables, open payables, recurring rules and planned one-offs into
 * a 13-week (Monday–Sunday) cash forecast for one scenario. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CashEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ── dates ────────────────────────────────────────────────────────────────
  var DAY = 86400000;
  function isDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && fromUtc(toUtc(s)) === s; }
  function toUtc(s) { return Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)); }
  function fromUtc(t) { var d = new Date(t); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0'); }
  function addDays(s, n) { return fromUtc(toUtc(s) + Math.round(n) * DAY); }
  function diffDays(a, b) { return Math.round((toUtc(b) - toUtc(a)) / DAY); } // b − a
  function dow(s) { return new Date(toUtc(s)).getUTCDay(); } // 0 = Sunday
  function mondayOf(s) { var d = dow(s); return addDays(s, d === 0 ? -6 : 1 - d); }
  function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); } // m is 1-based
  function ymd(y, m, d) { return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0'); }
  function isWeekend(s) { var d = dow(s); return d === 0 || d === 6; }
  /** next working day on or after s (weekends only; public holidays are not modelled) */
  function workdayOnOrAfter(s) { while (isWeekend(s)) s = addDays(s, 1); return s; }
  /** last working day on or before s */
  function workdayOnOrBefore(s) { while (isWeekend(s)) s = addDays(s, -1); return s; }
  function minDate(a, b) { return a < b ? a : b; }
  function maxDate(a, b) { return a > b ? a : b; }

  // ── categories ───────────────────────────────────────────────────────────
  var CATS_IN = [
    { id: 'customers', name: 'Customer invoices', hint: 'Open receivables, dated by how each customer really pays' },
    { id: 'newsales', name: 'Sales not yet invoiced', hint: 'Run-rate collections from future invoices' },
    { id: 'pipeline', name: 'Pipeline deals', hint: 'Planned deals, weighted by probability' },
    { id: 'otherin', name: 'Other receipts', hint: 'Asset sales, refunds, grants' }
  ];
  var CATS_OUT = [
    { id: 'suppliers', name: 'Supplier invoices', hint: 'Open payables on their due date' },
    { id: 'purchases', name: 'Purchases not yet invoiced', hint: 'Run-rate payments for future supplier invoices' },
    { id: 'payroll', name: 'Payroll', hint: 'Net pay, contributions and bonuses' },
    { id: 'tax', name: 'Taxes', hint: 'VAT, corporate income tax advances' },
    { id: 'rent', name: 'Rent & leases', hint: 'Premises, vehicles' },
    { id: 'loans', name: 'Loan repayments', hint: 'Principal and interest' },
    { id: 'opex', name: 'Operating costs', hint: 'Utilities, software, insurance' },
    { id: 'capex', name: 'Investments', hint: 'Vehicles, equipment' },
    { id: 'otherout', name: 'Other payments', hint: '' }
  ];
  var CAT = {};
  CATS_IN.forEach(function (c) { c.kind = 'in'; CAT[c.id] = c; });
  CATS_OUT.forEach(function (c) { c.kind = 'out'; CAT[c.id] = c; });

  // ── scenarios ────────────────────────────────────────────────────────────
  // delay: extra days customers take; sales: % change of not-yet-invoiced sales (and of the purchases that
  // follow them, at `purchasesFollow` of the change); pipeline: % of the probability-weighted value counted;
  // payDelay: days non-critical supplier invoices are paid after their due date.
  var SCENARIOS = {
    base: { id: 'base', name: 'Base', delay: 0, sales: 0, pipeline: 100, payDelay: 0 },
    pessimistic: { id: 'pessimistic', name: 'Pessimistic', delay: 14, sales: -15, pipeline: 50, payDelay: 0 },
    optimistic: { id: 'optimistic', name: 'Optimistic', delay: -5, sales: 5, pipeline: 120, payDelay: 0 }
  };
  var LIMITS = { delay: [-15, 45], sales: [-50, 30], pipeline: [0, 150], payDelay: [0, 45] };
  var PURCHASES_FOLLOW = 0.7; // purchases move with sales, but less than one for one
  var DOUBTFUL_DAYS = 90;
  function clampScenario(s) {
    var o = { id: s && s.id || 'custom', name: s && s.name || 'Custom' };
    Object.keys(LIMITS).forEach(function (k) {
      var v = Number(s && s[k]); if (!isFinite(v)) v = SCENARIOS.base[k];
      o[k] = Math.max(LIMITS[k][0], Math.min(LIMITS[k][1], Math.round(v)));
    });
    return o;
  }

  // ── receivables ──────────────────────────────────────────────────────────
  /** Status of an open receivable on `today`. */
  function arStatus(inv, today) {
    if (inv.disputed) return 'disputed';
    var late = diffDays(inv.due, today);
    if (late > DOUBTFUL_DAYS) return 'doubtful';
    if (late > 0) return 'overdue';
    return 'open';
  }
  /** When an open receivable is expected to be paid, or why it is left out.
   * mode 'behaviour': due date + the customer's average days late (+ scenario delay); 'due': the due date.
   * A date the user set (inv.expected) always wins. Dates in the past move to today. */
  function expectedReceipt(inv, cust, today, mode, scn) {
    if (isDate(inv.expected)) return { date: maxDate(inv.expected, today), set: true };
    var st = arStatus(inv, today);
    if (st === 'disputed') return { date: null, why: 'disputed' };
    if (st === 'doubtful') return { date: null, why: 'doubtful' };
    var lag = 0;
    if (mode !== 'due') lag = Math.max(0, Math.round((cust && cust.avgLate) || 0) + ((scn && scn.delay) || 0));
    else if (scn && scn.delay > 0) lag = scn.delay;
    var d = addDays(inv.due, lag);
    // a customer who is already late keeps being late: expect it a few days after today, not today
    if (d < today) d = mode === 'due' ? today : addDays(today, Math.min(10, Math.max(2, Math.round(((cust && cust.avgLate) || 0) / 3))));
    return { date: workdayOnOrAfter(d), set: false };
  }

  // ── payables ─────────────────────────────────────────────────────────────
  function apStatus(bill, today) {
    if (bill.hold) return 'hold';
    return bill.due < today ? 'overdue' : 'open';
  }
  function expectedPayment(bill, supp, today, scn) {
    if (bill.hold) return { date: null, why: 'hold' };
    if (isDate(bill.planned)) return { date: maxDate(bill.planned, today), set: true };
    var d = bill.due;
    if (scn && scn.payDelay > 0 && !(supp && supp.critical)) d = addDays(d, scn.payDelay);
    if (d < today) d = today;
    return { date: workdayOnOrAfter(d), set: false };
  }

  // ── recurring rules ──────────────────────────────────────────────────────
  // r = { freq: 'weekly'|'monthly'|'quarterly'|'yearly', day, start, end?, shift?: 'before'|'after' }
  // weekly: day = 1..5 (Mon..Fri). monthly/quarterly/yearly: day = 1..31, or 0 for the last working day.
  // quarterly runs in the months of `start` + 3n; yearly in the month of `start`.
  function occurrences(r, from, to) {
    var out = [];
    if (!r || !isDate(r.start)) return out;
    var lo = maxDate(from, r.start), hi = isDate(r.end) ? minDate(to, r.end) : to;
    if (lo > hi) return out;
    if (r.freq === 'weekly') {
      var wd = Math.min(7, Math.max(1, +r.day || 1)) % 7; // 7 → Sunday (0)
      var d = lo; while (dow(d) !== wd) d = addDays(d, 1);
      for (; d <= hi; d = addDays(d, 7)) out.push(d);
      return out;
    }
    var step = r.freq === 'quarterly' ? 3 : r.freq === 'yearly' ? 12 : 1;
    var sy = +r.start.slice(0, 4), sm = +r.start.slice(5, 7);
    var y = +lo.slice(0, 4), m = +lo.slice(5, 7);
    // first month on the rule's cycle at or after lo's month (one month earlier too, because a shift can move a date forward)
    var idx = (y * 12 + m - 1) - (sy * 12 + sm - 1) - 1;
    idx = Math.ceil(idx / step) * step;
    for (var guard = 0; guard < 200; guard++, idx += step) {
      if (idx < 0) continue;
      var tot = sy * 12 + sm - 1 + idx, yy = Math.floor(tot / 12), mm = tot % 12 + 1;
      var dim = daysInMonth(yy, mm), day = +r.day || 0;
      var dt = day <= 0 ? workdayOnOrBefore(ymd(yy, mm, dim)) : ymd(yy, mm, Math.min(day, dim));
      if (day > 0) dt = r.shift === 'before' ? workdayOnOrBefore(dt) : workdayOnOrAfter(dt);
      if (dt > hi) break;
      if (dt >= lo) out.push(dt);
    }
    return out;
  }

  // ── forecast ─────────────────────────────────────────────────────────────
  function cashToday(db) { return (db.accounts || []).reduce(function (s, a) { return s + (+a.balance || 0); }, 0); }

  /** Build the forecast. opts: { today, weeks = 13, mode = 'behaviour'|'due', scenario } */
  function forecast(db, opts) {
    opts = opts || {};
    var today = opts.today, nW = opts.weeks || 13, mode = opts.mode === 'due' ? 'due' : 'behaviour';
    var scn = clampScenario(opts.scenario || SCENARIOS.base);
    var start = mondayOf(today), end = addDays(start, nW * 7 - 1);
    var custBy = {}, suppBy = {};
    (db.customers || []).forEach(function (c) { custBy[c.id] = c; });
    (db.suppliers || []).forEach(function (s) { suppBy[s.id] = s; });
    var items = [], left = [];

    (db.ar || []).forEach(function (inv) {
      if (inv.paid) return;
      var c = custBy[inv.customerId], e = expectedReceipt(inv, c, today, mode, scn);
      var it = { src: 'ar', id: inv.id, kind: 'in', cat: 'customers', label: (c ? c.name : 'Customer') + ' · ' + inv.no, amount: +inv.amount || 0, date: e.date, due: inv.due, set: e.set };
      if (!e.date) { it.why = e.why; left.push(it); } else items.push(it);
    });
    (db.ap || []).forEach(function (bill) {
      if (bill.paid) return;
      var s = suppBy[bill.supplierId], e = expectedPayment(bill, s, today, scn);
      var it = { src: 'ap', id: bill.id, kind: 'out', cat: 'suppliers', label: (s ? s.name : 'Supplier') + ' · ' + bill.no, amount: +bill.amount || 0, date: e.date, due: bill.due, set: e.set };
      if (!e.date) { it.why = e.why; left.push(it); } else items.push(it);
    });
    (db.recurring || []).forEach(function (r) {
      if (r.off) return;
      var kind = CAT[r.cat] ? CAT[r.cat].kind : (r.kind || 'out');
      var f = 1;
      if (r.cat === 'newsales') f = 1 + scn.sales / 100;
      if (r.cat === 'purchases') f = 1 + scn.sales * PURCHASES_FOLLOW / 100;
      occurrences(r, today, end).forEach(function (d) {
        items.push({ src: 'rec', id: r.id, kind: kind, cat: r.cat, label: r.name, amount: Math.max(0, (+r.amount || 0) * f), date: d });
      });
    });
    (db.planned || []).forEach(function (p) {
      if (!isDate(p.date) || p.done) return;
      var kind = CAT[p.cat] ? CAT[p.cat].kind : (p.kind || 'out');
      var d = maxDate(p.date, today);
      if (d > end) return;
      var amt = +p.amount || 0, prob = p.prob == null ? 100 : Math.max(0, Math.min(100, +p.prob));
      if (kind === 'in') {
        amt = amt * prob / 100;
        if (p.cat === 'pipeline') amt = amt * scn.pipeline / 100;
      }
      items.push({ src: 'plan', id: p.id, kind: kind, cat: p.cat, label: p.name, amount: amt, full: +p.amount || 0, prob: prob, date: d });
    });

    items = items.filter(function (it) { return it.date && it.date <= end && it.amount > 0; });
    items.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : b.amount - a.amount; });

    var weeks = [], bal = cashToday(db);
    for (var i = 0; i < nW; i++) {
      var ws = addDays(start, i * 7), we = addDays(ws, 6);
      var w = { i: i, start: ws, end: we, opening: bal, in: {}, out: {}, inTotal: 0, outTotal: 0, items: [] };
      CATS_IN.forEach(function (c) { w.in[c.id] = 0; });
      CATS_OUT.forEach(function (c) { w.out[c.id] = 0; });
      weeks.push(w);
      bal = 0; // filled below
    }
    items.forEach(function (it) {
      var wi = Math.floor(diffDays(start, it.date) / 7);
      if (wi < 0) wi = 0;
      if (wi >= nW) return;
      var w = weeks[wi];
      w.items.push(it);
      if (it.kind === 'in') { w.in[it.cat] = (w.in[it.cat] || 0) + it.amount; w.inTotal += it.amount; }
      else { w.out[it.cat] = (w.out[it.cat] || 0) + it.amount; w.outTotal += it.amount; }
    });
    var run = cashToday(db), lowest = null;
    weeks.forEach(function (w) {
      w.opening = run;
      w.net = w.inTotal - w.outTotal;
      w.closing = run + w.net;
      // lowest balance inside the week: payments before receipts on the same day (cautious)
      var b = run, low = run, byDay = {};
      w.items.forEach(function (it) { (byDay[it.date] = byDay[it.date] || []).push(it); });
      Object.keys(byDay).sort().forEach(function (d) {
        byDay[d].forEach(function (it) { if (it.kind === 'out') b -= it.amount; });
        low = Math.min(low, b);
        byDay[d].forEach(function (it) { if (it.kind === 'in') b += it.amount; });
      });
      w.low = Math.min(low, w.closing);
      run = w.closing;
      if (!lowest || w.low < lowest.low) lowest = w;
    });
    var minCash = +(db.settings && db.settings.minCash) || 0, credit = +(db.settings && db.settings.creditLine) || 0;
    var firstBelowMin = null, firstBelowZero = null, firstOverCredit = null;
    weeks.forEach(function (w) {
      if (firstBelowMin === null && w.low < minCash) firstBelowMin = w.i;
      if (firstBelowZero === null && w.low < 0) firstBelowZero = w.i;
      if (firstOverCredit === null && w.low < -credit) firstOverCredit = w.i;
    });
    return {
      today: today, start: start, end: end, mode: mode, scenario: scn, cash: cashToday(db), minCash: minCash, creditLine: credit,
      weeks: weeks, items: items, left: left, lowest: lowest,
      firstBelowMin: firstBelowMin, firstBelowZero: firstBelowZero, firstOverCredit: firstOverCredit,
      inTotal: weeks.reduce(function (s, w) { return s + w.inTotal; }, 0),
      outTotal: weeks.reduce(function (s, w) { return s + w.outTotal; }, 0)
    };
  }

  /** Ways to close a gap below the minimum, each with the amount it would add by the low point. */
  function remedies(db, f) {
    var out = [];
    if (!f.lowest) return out;
    var lowEnd = f.lowest.end, today = f.today;
    var gap = Math.max(0, f.minCash - f.lowest.low);
    var custBy = {}, suppBy = {};
    (db.customers || []).forEach(function (c) { custBy[c.id] = c; });
    (db.suppliers || []).forEach(function (s) { suppBy[s.id] = s; });
    // 1. invoices due before the low point that are expected after it, because the customer pays late
    var late = [], lateSum = 0;
    f.items.forEach(function (it) { if (it.src === 'ar' && it.due <= lowEnd && it.date > lowEnd) { late.push(it); lateSum += it.amount; } });
    (f.left || []).forEach(function (it) { if (it.src === 'ar' && it.why === 'disputed') { late.push(it); lateSum += it.amount; } });
    if (lateSum > 0) out.push({ id: 'chase', amount: lateSum, count: late.length, title: 'Get late payers to pay on time', text: late.length + ' invoices are due before the low point but arrive after it, or are disputed. Chasing them now brings the money in before the low point.', items: late.sort(function (a, b) { return b.amount - a.amount; }) });
    // 2. move non-critical supplier invoices due up to the low point back by 14 days
    var mv = [], mvSum = 0;
    f.items.forEach(function (it) {
      if (it.src !== 'ap' || it.date > lowEnd || it.set) return;
      var bill = (db.ap || []).filter(function (b) { return b.id === it.id; })[0], s = bill && suppBy[bill.supplierId];
      if (s && s.critical) return;
      if (addDays(it.date, 14) > lowEnd) { mv.push(it); mvSum += it.amount; }
    });
    if (mvSum > 0) out.push({ id: 'stretch', amount: mvSum, count: mv.length, title: 'Pay non-critical suppliers 14 days later', text: mv.length + ' supplier invoices would move past the low point. Agree it with the suppliers first.', items: mv.sort(function (a, b) { return b.amount - a.amount; }) });
    // 3. one-off payments that could move
    var pl = f.items.filter(function (it) { return it.src === 'plan' && it.kind === 'out' && it.date <= lowEnd && (it.cat === 'capex' || it.cat === 'otherout'); });
    var plSum = pl.reduce(function (s, it) { return s + it.amount; }, 0);
    if (plSum > 0) out.push({ id: 'defer', amount: plSum, count: pl.length, title: 'Move investments after the low point', text: pl.map(function (it) { return it.label; }).join(', '), items: pl });
    // 4. credit line
    if (f.creditLine > 0) out.push({ id: 'credit', amount: f.creditLine, count: 0, title: 'Draw on the credit line', text: 'Keeps the account positive, at the cost of interest.', items: [] });
    out.forEach(function (r) { r.cover = gap > 0 ? Math.min(1, r.amount / gap) : 1; });
    return { gap: gap, list: out };
  }

  return {
    isDate: isDate, addDays: addDays, diffDays: diffDays, dow: dow, mondayOf: mondayOf, daysInMonth: daysInMonth,
    workdayOnOrAfter: workdayOnOrAfter, workdayOnOrBefore: workdayOnOrBefore, isWeekend: isWeekend,
    CATS_IN: CATS_IN, CATS_OUT: CATS_OUT, CAT: CAT, SCENARIOS: SCENARIOS, LIMITS: LIMITS, DOUBTFUL_DAYS: DOUBTFUL_DAYS,
    clampScenario: clampScenario, arStatus: arStatus, apStatus: apStatus, expectedReceipt: expectedReceipt, expectedPayment: expectedPayment,
    occurrences: occurrences, cashToday: cashToday, forecast: forecast, remedies: remedies
  };
});
