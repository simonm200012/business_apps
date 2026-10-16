/* Cash forecast demo data (Business Apps). Every company, person, invoice and amount is fictional.
 * generate(today) builds a wholesale distributor of heating, plumbing and electrical supplies (about €13M a year)
 * with open receivables and payables made relative to `today`, recurring payments (payroll, VAT, rent, loans),
 * planned one-offs and pipeline deals. The opening bank balance is set so the base case dips below the
 * company's minimum cash buffer in the middle of the forecast: the situation the app exists to catch.
 * The same `today` always gives the same data (seeded random numbers). UMD, so it also loads in Node.
 *
 * Demo generations (db.demoGen):
 *  - 2 (current): the open receivables and the customers are Collections' demo invoices for the same day
 *    (collections/data.js, read only, loaded next to this file), so both apps show the same 2,25 M€ owed by the same
 *    customers: open amount after part-payments, disputes left out, written-off invoices gone, promises to pay and
 *    the payment plan used as expected dates. Payables, recurring items and plans are as in generation 1.
 *  - 1 (no demoGen field): the original stand-alone demo, kept so an older saved demo can still be recognised as
 *    untouched (generateV1). It is also the fallback when Collections' scripts are not loaded. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    var CE = null, CD = null;
    try { CE = require('../collections/engine.js'); CD = require('../collections/data.js'); } catch (e) { CE = CD = null; }
    module.exports = factory(require('./engine.js'), CE, CD);
  } else root.CashData = factory(root.CashEngine, root.CollEngine, root.CollData);
})(typeof self !== 'undefined' ? self : this, function (E, CE, CD) {
  'use strict';
  var VERSION = 1;

  function rng(seed) {
    var a = seed >>> 0;
    var f = function () { a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    f.between = function (lo, hi) { return lo + (hi - lo) * f(); };
    f.int = function (lo, hi) { return Math.floor(lo + (hi - lo + 1) * f()); };
    f.norm = function () { var u = 0, v = 0; while (u === 0) u = f(); while (v === 0) v = f(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    return f;
  }
  function round2(x) { return Math.round(x * 100) / 100; }
  function roundTo(x, n) { return Math.round(x / n) * n; }

  var COMPANY = { name: 'Nordvik Distribucija d.o.o.', short: 'Nordvik', what: 'Wholesale of heating, plumbing and electrical supplies', currency: 'EUR' };

  // name, segment, payment terms (days), average days late, spread, share of monthly sales
  var CUSTOMERS = [
    ['Termoplan Savinja d.o.o.', 'Installer', 45, 6, 4, 6.5],
    ['Vzorec Energija d.o.o.', 'Installer', 45, 18, 7, 5.8],
    ['Lumen Gradnje d.o.o.', 'Contractor', 60, 24, 10, 7.2],
    ['Vetrnica Instalacije d.o.o.', 'Installer', 30, 3, 3, 3.1],
    ['Polarka Klima d.o.o.', 'Installer', 45, 11, 5, 4.4],
    ['Gradbeni Sistemi Vrh d.d.', 'Contractor', 60, 31, 12, 8.6],
    ['Struna Gradnje d.o.o.', 'Contractor', 60, 44, 18, 3.2],
    ['Hiša Mojstrov d.o.o.', 'Retail chain', 45, 2, 2, 9.4],
    ['Domotehna Center d.o.o.', 'Retail chain', 45, 9, 4, 7.9],
    ['Občina Zelena Dolina', 'Public sector', 30, 0, 1, 2.6],
    ['Dom upokojencev Breza', 'Public sector', 30, 1, 1, 1.4],
    ['Zavod Šolski Center Lipa', 'Public sector', 30, 0, 1, 2.2],
    ['Elektro Kres s.p.', 'Installer', 30, 7, 5, 1.6],
    ['Toplotne Črpalke Sever d.o.o.', 'Installer', 45, 4, 3, 3.6],
    ['Vodovod Mreža d.o.o.', 'Contractor', 60, 15, 8, 4.9],
    ['Strojna Montaža Gaber d.o.o.', 'Installer', 30, 12, 6, 2.3],
    ['Klimatika Jadran d.o.o.', 'Installer', 45, 21, 9, 3.4],
    ['Instal Plus Kranjc s.p.', 'Installer', 30, 5, 4, 1.2],
    ['Sončna Streha d.o.o.', 'Installer', 45, 8, 5, 2.9],
    ['Megagrad Holding d.d.', 'Contractor', 60, 27, 11, 6.3],
    ['Ogrevanje Bistrica d.o.o.', 'Installer', 30, 2, 2, 1.8],
    ['Tehno Dom Mesec d.o.o.', 'Retail chain', 45, 6, 3, 3.9],
    ['Zdravstveni Dom Vrba', 'Public sector', 30, 0, 1, 1.1],
    ['Hotel Planika d.d.', 'End customer', 30, 14, 7, 1.5],
    ['Ventus Prezračevanje d.o.o.', 'Installer', 45, 10, 5, 2.4],
    ['Kopalnice Arkada d.o.o.', 'Retail chain', 45, 13, 6, 2.0]
  ];
  // name, terms, critical (stock we cannot sell without), share of monthly purchases
  var SUPPLIERS = [
    ['Nordtherm Heiztechnik GmbH', 60, true, 16],
    ['Valvex Componenti S.r.l.', 60, true, 11],
    ['Kabelwerk Ostalpen GmbH', 45, true, 10],
    ['Aquaflux Pumps a.s.', 45, false, 7],
    ['Radiatorji Vrhnje d.o.o.', 30, false, 6],
    ['Klimaflow Systems B.V.', 60, true, 9],
    ['Polytube Industries Kft.', 45, false, 6],
    ['Svetila Lux d.o.o.', 30, false, 4],
    ['Montažni Material Grič d.o.o.', 30, false, 4],
    ['Termostat Balkan d.o.o.', 30, false, 3],
    ['Inox Profil d.o.o.', 30, false, 3],
    ['Logistika Hitri Prevoz d.o.o.', 15, true, 5],
    ['Pakirni Center Opara d.o.o.', 30, false, 2],
    ['Elektro Grosist Panon d.o.o.', 45, false, 6],
    ['Solarix Energy S.A.', 60, false, 5],
    ['Varilna Tehnika Rob d.o.o.', 30, false, 3]
  ];
  var MONTHLY_SALES = 1080000, MONTHLY_PURCHASES = 760000;

  function generateV1(today) { return build(today, 1); }
  /** Collections' demo is available (its engine and data scripts are loaded) */
  function canGenerate(gen) { return gen === 2 ? !!(CE && CD && CD.generate && CE.openAt && CE.settledOn) : true; }
  function generate(today) {
    if (canGenerate(2)) { try { return build(today, 2); } catch (e) { if (typeof console !== 'undefined') console.warn('Cash forecast: Collections demo not usable, using the stand-alone demo.', e); } }
    return build(today, 1);
  }
  function build(today, gen) {
    var r = rng(0xCA5F10);
    var A = E.addDays;
    var db = {
      version: VERSION, generatedFor: today,
      company: { name: COMPANY.name, what: COMPANY.what, currency: COMPANY.currency },
      settings: { minCash: 150000, creditLine: 400000, owner: 'Finance team' },
      accounts: [
        { id: 'a1', name: 'Main current account', bank: 'Bank A', balance: 0 },
        { id: 'a2', name: 'Payroll and tax account', bank: 'Bank B', balance: 0 }
      ],
      customers: [], suppliers: [], ar: [], ap: [], recurring: [], planned: [], history: [], log: []
    };

    if (gen === 2) { db.demoGen = 2; receivablesFromCollections(db, today); } else receivablesV1(db, today, r);
    suppliersAndRest(db, today, r);
    return db;
  }

  // Generation 2: Collections' customers and open invoices on `today`.
  function receivablesFromCollections(db, today) {
    var c = CD.generate(today), invBy = {};
    c.invoices.forEach(function (inv) { (invBy[inv.customerId] = invBy[inv.customerId] || []).push(inv); });
    // promises still open on `today` and the payment plan's instalments become expected dates
    var expected = {}, notes = {};
    function note(id, at, text) { (notes[id] = notes[id] || []).push({ at: at, text: text }); }
    (c.actions || []).forEach(function (a) {
      if (!a.promise || a.promise.status !== 'open' || !E.isDate(a.promise.date) || a.promise.date < today) return;
      (a.invoiceIds || []).forEach(function (id) {
        if (!expected[id] || a.promise.date < expected[id]) expected[id] = a.promise.date;
        note(id, a.date, 'Promised to pay ' + round2(+a.promise.amount || 0).toFixed(2).replace('.', ',') + ' € by ' + a.promise.date.split('-').reverse().map(Number).join('. ') + ' (in Collections).');
      });
    });
    (c.plans || []).forEach(function (pl) {
      if (pl.status !== 'active') return;
      var left = (pl.instalments || []).filter(function (it) { return !it.paidDate && E.isDate(it.due); }).sort(function (a, b) { return a.due < b.due ? -1 : 1; });
      var invs = (pl.invoiceIds || []).map(function (id) { return c.invoices.filter(function (i) { return i.id === id; })[0]; }).filter(Boolean)
        .sort(function (a, b) { return a.dueDate < b.dueDate ? -1 : 1; });
      var need = 0, k = 0, got = 0;
      invs.forEach(function (inv) {
        need += CE.openAt(inv, today);
        while (k < left.length && got < need - 0.005) { got += +left[k].amount || 0; k++; }
        var d = left[Math.max(0, k - 1)] && left[Math.max(0, k - 1)].due;
        if (d) expected[inv.id] = d > today ? d : today;
        note(inv.id, pl.created, 'On a payment plan of ' + left.length + ' more instalments (in Collections).');
      });
    });
    c.customers.forEach(function (cc) {
      var list = invBy[cc.id] || [], settled = [];
      list.forEach(function (inv) { var st = CE.settledOn(inv, today); if (st && st < today) settled.push({ no: inv.no, due: inv.dueDate, paid: st, amount: inv.amount }); });
      settled.sort(function (a, b) { return a.paid < b.paid ? -1 : a.paid > b.paid ? 1 : 0; });
      var pays = settled.slice(-8);
      var cust = { id: cc.id, name: cc.name, segment: cc.segment, terms: cc.terms, avgLate: 0, vatId: cc.vatId || '', payments: pays };
      if (pays.length) cust.avgLate = Math.round(pays.reduce(function (s, p) { return s + E.diffDays(p.due, p.paid); }, 0) / pays.length);
      db.customers.push(cust);
    });
    c.invoices.slice().sort(function (a, b) { return a.issueDate < b.issueDate ? -1 : a.issueDate > b.issueDate ? 1 : 0; }).forEach(function (inv) {
      var open = CE.openAt(inv, today);
      if (!(open > 0)) return;
      var n = (notes[inv.id] || []).slice();
      if (open < (+inv.amount || 0) - 0.005) n.unshift({ at: today, text: 'Part-paid: ' + round2(open).toFixed(2).replace('.', ',') + ' € still open of ' + round2(inv.amount).toFixed(2).replace('.', ',') + ' €.' });
      if (inv.disputed) n.push({ at: inv.disputed.since || today, text: 'Disputed: ' + (inv.disputed.reason || '') });
      db.ar.push({ id: inv.id, no: inv.no, customerId: inv.customerId, issued: inv.issueDate, due: inv.dueDate, amount: round2(open), paid: false, disputed: !!inv.disputed, expected: expected[inv.id] || '', notes: n });
    });
  }

  // Generation 1: the stand-alone customers and invoices (unchanged, so older saved demos still compare equal).
  function receivablesV1(db, today, r) {
    var A = E.addDays;
    // ── customers and their invoices ──
    var shareSum = CUSTOMERS.reduce(function (s, c) { return s + c[5]; }, 0), arSeq = 3800;
    var allInv = [];
    CUSTOMERS.forEach(function (c, i) {
      var cust = { id: 'c' + String(i + 1).padStart(2, '0'), name: c[0], segment: c[1], terms: c[2], avgLate: c[3], spread: c[4], payments: [] };
      db.customers.push(cust);
      var monthly = MONTHLY_SALES * c[5] / shareSum;
      var perMonth = Math.max(1, Math.round(monthly / 21000)); // bigger customers get more, not only larger, invoices
      var gap = 30 / perMonth;
      for (var d = -150 + r.between(0, gap); d <= -1; d += gap * r.between(0.6, 1.4)) {
        var issued = E.workdayOnOrBefore(A(today, Math.round(d)));
        var amount = round2(monthly / perMonth * r.between(0.55, 1.5));
        allInv.push({ cust: cust, issued: issued, amount: amount });
      }
    });
    allInv.sort(function (a, b) { return a.issued < b.issued ? -1 : 1; });
    allInv.forEach(function (x) {
      var cust = x.cust, due = A(x.issued, cust.terms);
      var late = Math.max(-4, Math.round(cust.avgLate + r.norm() * cust.spread));
      var paidOn = E.workdayOnOrAfter(A(due, late));
      var no = x.issued.slice(0, 4) + '-' + String(++arSeq).padStart(5, '0');
      if (paidOn < today) {
        cust.payments.push({ no: no, due: due, paid: paidOn, amount: x.amount });
        if (cust.payments.length > 8) cust.payments.shift();
        return;
      }
      db.ar.push({ id: 'ar' + arSeq, no: no, customerId: cust.id, issued: x.issued, due: due, amount: x.amount, paid: false, disputed: false, expected: '', notes: [] });
    });
    // what the forecast uses: each customer's average lateness over their recent payments, as a real system would
    db.customers.forEach(function (cust) {
      if (cust.payments.length) cust.avgLate = Math.round(cust.payments.reduce(function (s, p) { return s + E.diffDays(p.due, p.paid); }, 0) / cust.payments.length);
      delete cust.spread;
    });
    // a contractor in trouble: two old invoices nobody expects any more
    var struna = db.customers[6];
    [[-158, 41850.4], [-141, 27310.9]].forEach(function (x) {
      var issued = E.workdayOnOrBefore(A(today, x[0]));
      db.ar.push({ id: 'ar' + (++arSeq), no: issued.slice(0, 4) + '-' + String(arSeq).padStart(5, '0'), customerId: struna.id, issued: issued, due: A(issued, struna.terms), amount: x[1], paid: false, disputed: false, expected: '', notes: [{ at: A(today, -12), text: 'Second reminder sent. Customer asks for an instalment plan.' }] });
    });
    // a retail chain disputes a delivery
    var chain = db.customers[8], dispIssued = E.workdayOnOrBefore(A(today, -38));
    db.ar.push({ id: 'ar' + (++arSeq), no: dispIssued.slice(0, 4) + '-' + String(arSeq).padStart(5, '0'), customerId: chain.id, issued: dispIssued, due: A(dispIssued, chain.terms), amount: 18640.0, paid: false, disputed: true, expected: '', notes: [{ at: A(today, -6), text: 'Customer says 40 radiators arrived damaged. Credit note under review.' }] });
  }

  function suppliersAndRest(db, today, r) {
    var A = E.addDays;

    // ── suppliers and their bills ──
    var supShare = SUPPLIERS.reduce(function (s, x) { return s + x[3]; }, 0), apSeq = 0;
    SUPPLIERS.forEach(function (s, i) {
      var sup = { id: 's' + String(i + 1).padStart(2, '0'), name: s[0], terms: s[1], critical: s[2] };
      db.suppliers.push(sup);
      var monthly = MONTHLY_PURCHASES * s[3] / supShare;
      var perMonth = Math.max(1, Math.round(monthly / 26000));
      var gap = 30 / perMonth, prefix = ['INV', 'RN', 'FA', 'R'][i % 4];
      for (var d = -95 + r.between(0, gap); d <= -1; d += gap * r.between(0.7, 1.3)) {
        var issued = E.workdayOnOrBefore(A(today, Math.round(d)));
        var due = A(issued, sup.terms);
        apSeq++;
        if (due < today) continue; // paid on time
        db.ap.push({ id: 'ap' + apSeq, no: prefix + '-' + (40000 + r.int(100, 9899)), supplierId: sup.id, issued: issued, due: due, amount: round2(monthly / perMonth * r.between(0.6, 1.4)), paid: false, hold: false, planned: '', notes: [] });
      }
    });
    // two bills already stretched past their due date
    [[3, -6, 14280.5], [8, -3, 6120.0]].forEach(function (x) {
      var sup = db.suppliers[x[0]], due = A(today, x[1]);
      db.ap.push({ id: 'ap' + (++apSeq), no: 'RN-' + (50000 + apSeq), supplierId: sup.id, issued: A(due, -sup.terms), due: due, amount: x[2], paid: false, hold: false, planned: '', notes: [{ at: A(today, -2), text: 'Agreed by phone to pay with the next run.' }] });
    });
    // one bill on hold: quantity does not match the delivery
    var held = db.ap.filter(function (b) { return b.supplierId === 's07'; })[0];
    if (held) { held.hold = true; held.notes.push({ at: A(today, -4), text: 'On hold: 12 coils short on delivery note 7731.' }); }

    // ── recurring ──
    var rid = 0;
    function rec(o) { o.id = 'r' + (++rid); o.start = o.start || A(today, -400); db.recurring.push(o); }
    rec({ name: 'Net salaries', cat: 'payroll', freq: 'monthly', day: 18, shift: 'before', amount: 118400, note: '46 employees, paid by the 18th for the previous month' });
    rec({ name: 'Payroll taxes and contributions', cat: 'payroll', freq: 'monthly', day: 18, shift: 'before', amount: 71250 });
    rec({ name: 'VAT payment', cat: 'tax', freq: 'monthly', day: 0, amount: 96500, note: 'Last working day of the month, for the month before' });
    rec({ name: 'Corporate income tax advance', cat: 'tax', freq: 'monthly', day: 10, amount: 14300 });
    rec({ name: 'Warehouse rent', cat: 'rent', freq: 'monthly', day: 5, amount: 26400 });
    rec({ name: 'Vehicle leases (9 vans)', cat: 'rent', freq: 'monthly', day: 20, amount: 9380 });
    rec({ name: 'Term loan instalment', cat: 'loans', freq: 'monthly', day: 15, amount: 22150, end: A(today, 900), note: 'Bank A, €1.2M, 5 years' });
    rec({ name: 'Utilities and telecoms', cat: 'opex', freq: 'monthly', day: 25, amount: 7820 });
    rec({ name: 'Software and subscriptions', cat: 'opex', freq: 'monthly', day: 3, amount: 4210 });
    rec({ name: 'Insurance premium', cat: 'opex', freq: 'quarterly', day: 15, amount: 12480, start: A(today, -60) });
    rec({ name: 'Trade counter takings', cat: 'otherin', freq: 'weekly', day: 1, amount: 17600, note: 'Cash and card sales at the counter' });
    // run-rate lines: invoices not issued yet, collected and paid later
    rec({ name: 'Collections from sales not yet invoiced (ramp-up)', cat: 'newsales', freq: 'weekly', day: 3, amount: 118000, start: A(today, 30), end: A(today, 50), note: 'Sales invoiced from today on, first customers on 30-day terms' });
    rec({ name: 'Collections from sales not yet invoiced', cat: 'newsales', freq: 'weekly', day: 3, amount: 242000, start: A(today, 51), note: 'About €1.08M of sales a month, collected on average 52 days after invoicing' });
    rec({ name: 'Purchases not yet invoiced (ramp-up)', cat: 'purchases', freq: 'weekly', day: 5, amount: 74000, start: A(today, 16), end: A(today, 42) });
    rec({ name: 'Purchases not yet invoiced', cat: 'purchases', freq: 'weekly', day: 5, amount: 168000, start: A(today, 43), note: 'About €760k of stock a month, paid on average 47 days after invoicing' });

    // ── planned one-offs and pipeline ──
    var pid = 0;
    function plan(o) { o.id = 'p' + (++pid); o.date = E.workdayOnOrAfter(A(today, o.in)); delete o.in; o.done = false; db.planned.push(o); }
    plan({ name: 'Pre-season stock order, Nordtherm (prepayment)', cat: 'otherout', in: 30, amount: 236000, prob: 100, note: '3% discount for paying in advance' });
    plan({ name: 'Two new delivery vans', cat: 'capex', in: 24, amount: 48600, prob: 100 });
    plan({ name: 'Warehouse racking extension', cat: 'capex', in: 41, amount: 31200, prob: 100 });
    plan({ name: 'Year-end bonus', cat: 'payroll', in: 70, amount: 61800, prob: 100 });
    plan({ name: 'Annual ERP licence renewal', cat: 'opex', in: 86, amount: 18400, prob: 100 });
    plan({ name: 'Hospital renovation, phase 1 (advance)', cat: 'pipeline', in: 61, amount: 310000, prob: 40, note: 'Tender result expected in 4 weeks' });
    plan({ name: 'Hotel Planika HVAC retrofit (advance)', cat: 'pipeline', in: 46, amount: 185000, prob: 60 });
    plan({ name: 'School energy upgrade, Lipa', cat: 'pipeline', in: 33, amount: 96000, prob: 75 });
    plan({ name: 'Sale of old forklift', cat: 'otherin', in: 19, amount: 14000, prob: 80 });

    // ── opening balance: the base case dips to about €92k, below the €150k minimum ──
    var f0 = E.forecast(db, { today: today, scenario: E.SCENARIOS.base });
    var lowAtZero = f0.weeks.reduce(function (m, w) { return Math.min(m, w.low); }, Infinity);
    var opening = roundTo(Math.max(180000, 92000 - lowAtZero), 10) + round2(r.between(0, 999));
    db.accounts[0].balance = round2(opening * 0.74);
    db.accounts[1].balance = round2(opening - db.accounts[0].balance);

    // ── how good past forecasts were: the closing balance predicted 4 weeks ahead vs what happened ──
    var mon = E.mondayOf(today), bal = opening;
    for (var k = 1; k <= 10; k++) {
      var wk = A(mon, -7 * k);
      bal = bal - r.between(-90000, 110000);
      var actual = Math.round(Math.max(120000, bal));
      db.history.unshift({ week: wk, actual: actual, forecast: Math.round(actual * (1 + r.norm() * 0.045)) });
    }
    db.log.push({ at: today, text: db.demoGen === 2 ? 'Demo data created (receivables shared with Collections).' : 'Demo data created.' });
  }

  return { VERSION: VERSION, COMPANY: COMPANY, generate: generate, generateV1: generateV1, canGenerate: canGenerate };
});
