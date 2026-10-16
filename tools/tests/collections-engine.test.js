// Tests for site/collections/engine.js and data.js. Run: node tools/tests/collections-engine.test.js
'use strict';
const assert = require('assert');
const path = require('path');
const E = require(path.join(__dirname, '../../site/collections/engine.js'));
const D = require(path.join(__dirname, '../../site/collections/data.js'));

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok', n, name); }
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.0051, (msg || '') + ' expected ' + b + ', got ' + a);
const S = E.normSettings({});
const inv = (o) => Object.assign({ id: 'i1', no: '2026-000100', customerId: 'c1', issueDate: '2026-08-01', dueDate: '2026-08-31', amount: 1000, payments: [], disputed: null, writtenOff: null }, o);

// ── dates ──────────────────────────────────────────────────────────────────
t('dates: strict ISO dates, leap years, month arithmetic', () => {
  assert.strictEqual(E.isDate('2028-02-29'), true);
  assert.strictEqual(E.isDate('2026-02-29'), false);
  assert.strictEqual(E.isDate('13.10.2026'), false);
  assert.strictEqual(E.daysInYear(2024), 366);
  assert.strictEqual(E.daysInYear(2100), 365);
  assert.strictEqual(E.daysInYear(2000), 366);
  assert.strictEqual(E.addMonths('2026-01-31', 1), '2026-02-28');
  assert.strictEqual(E.addMonths('2028-01-31', 1), '2028-02-29');
  assert.strictEqual(E.addMonths('2026-11-15', 3), '2027-02-15');
  assert.strictEqual(E.diffDays('2026-10-01', '2026-10-13'), 12);
  assert.strictEqual(E.endOfMonth('2026-02-10'), '2026-02-28');
});

// ── open amounts ───────────────────────────────────────────────────────────
t('open amounts with partial payments, as of any date', () => {
  const i = inv({ amount: 1000, payments: [{ date: '2026-09-05', amount: 400 }, { date: '2026-09-20', amount: 350.5 }] });
  assert.strictEqual(E.openAt(i, '2026-09-01'), 1000);
  assert.strictEqual(E.openAt(i, '2026-09-05'), 600);
  assert.strictEqual(E.openAt(i, '2026-09-30'), 249.5);
  assert.strictEqual(E.openAt(i, '2026-07-01'), 0, 'not issued yet');
  assert.strictEqual(E.paidUpTo(i), 750.5);
  assert.strictEqual(E.settledOn(i), null);
});
t('a remainder of half a cent or less counts as paid; overpayments are never negative', () => {
  const i = inv({ amount: 100, payments: [{ date: '2026-09-01', amount: 99.995 }] });
  assert.strictEqual(E.openAt(i, '2026-09-02'), 0);
  assert.strictEqual(E.settledOn(i), '2026-09-01');
  const j = inv({ amount: 100, payments: [{ date: '2026-09-01', amount: 99.99 }] });
  assert.strictEqual(E.openAt(j, '2026-09-02'), 0.01);
  const k = inv({ amount: 100, payments: [{ date: '2026-09-01', amount: 120 }] });
  assert.strictEqual(E.openAt(k, '2026-09-02'), 0);
});
t('written-off invoices leave the receivables from the write-off date', () => {
  const i = inv({ writtenOff: { date: '2026-09-15', reason: 'Bankruptcy' } });
  assert.strictEqual(E.openAt(i, '2026-09-14'), 1000);
  assert.strictEqual(E.openAt(i, '2026-09-15'), 0);
  assert.strictEqual(E.interestFor(i, '2026-10-13', { rates: E.DEFAULT_RATES }).total, 0);
});

// ── aging ──────────────────────────────────────────────────────────────────
t('aging buckets: boundaries by days overdue', () => {
  const cases = [[-5, 'nd'], [0, 'nd'], [1, 'b30'], [30, 'b30'], [31, 'b60'], [60, 'b60'], [61, 'b90'], [90, 'b90'], [91, 'b180'], [180, 'b180'], [181, 'old'], [900, 'old']];
  cases.forEach(([d, b]) => assert.strictEqual(E.bucketOf(d), b, d + ' days'));
});
t('aging totals: open amounts only, partial payments counted, paid and future invoices left out', () => {
  const today = '2026-10-13';
  const list = [
    inv({ id: 'a', dueDate: '2026-10-20', amount: 500 }),
    inv({ id: 'b', dueDate: '2026-10-12', amount: 300, payments: [{ date: '2026-10-01', amount: 100 }] }),
    inv({ id: 'c', dueDate: '2026-08-01', amount: 700 }),
    inv({ id: 'd', dueDate: '2026-03-01', issueDate: '2026-02-01', amount: 900 }),
    inv({ id: 'e', dueDate: '2026-09-01', amount: 400, payments: [{ date: '2026-09-10', amount: 400 }] }),
    inv({ id: 'f', issueDate: '2026-10-20', dueDate: '2026-11-20', amount: 999 })
  ];
  const a = E.aging(list, today);
  assert.strictEqual(a.buckets.nd.amount, 500);
  assert.strictEqual(a.buckets.b30.amount, 200);
  assert.strictEqual(a.buckets.b90.amount, 700); // 73 days
  assert.strictEqual(a.buckets.old.amount, 900); // 226 days
  assert.strictEqual(a.total, 2300);
  assert.strictEqual(a.overdue, 1800);
  assert.strictEqual(a.count, 4);
});

// ── DSO ────────────────────────────────────────────────────────────────────
t('DSO: receivables ÷ credit sales of the last 90 days × 90, and weighted days late of paid invoices', () => {
  const today = '2026-10-13';
  const list = [
    inv({ id: 'a', issueDate: '2026-09-01', dueDate: '2026-10-01', amount: 300000 }),
    inv({ id: 'b', issueDate: '2026-08-01', dueDate: '2026-08-31', amount: 150000, payments: [{ date: '2026-09-10', amount: 150000 }] }),
    inv({ id: 'c', issueDate: '2026-05-01', dueDate: '2026-05-31', amount: 50000, payments: [{ date: '2026-07-20', amount: 50000 }] })
  ];
  const d = E.dso(list, today);
  assert.strictEqual(d.ar, 300000);
  assert.strictEqual(d.sales, 450000);
  near(d.dso, 60);
  const l = E.avgDaysLate(list, today);
  assert.strictEqual(l.count, 2); // b (10 days late) and c (50 days late) were paid in the last 90 days
  near(l.days, (10 * 150000 + 50 * 50000) / 200000);
  const early = E.avgDaysLate([inv({ issueDate: '2026-09-01', dueDate: '2026-10-01', amount: 100, payments: [{ date: '2026-09-25', amount: 100 }] })], today);
  assert.strictEqual(early.days, 0, 'early payments count as 0 days late');
  assert.strictEqual(E.dso([], today).dso, null);
});

// ── interest ───────────────────────────────────────────────────────────────
const RATES = { rates: E.DEFAULT_RATES };
t('interest across a rate-period boundary (1 July 2025: 11,15 % → 10,15 %)', () => {
  const r = E.interestFor(inv({ amount: 10000, dueDate: '2025-06-20' }), '2025-07-10', RATES);
  assert.strictEqual(r.lines.length, 2);
  assert.deepStrictEqual(r.lines.map((l) => [l.from, l.to, l.days, l.rate, l.amount]), [['2025-06-21', '2025-06-30', 10, 11.15, 30.55], ['2025-07-01', '2025-07-10', 10, 10.15, 27.81]]);
  near(r.total, 58.36);
});
t('interest across a leap year: days ÷ 366 in 2024', () => {
  const r = E.interestFor(inv({ amount: 5000, dueDate: '2023-12-21' }), '2024-01-10', RATES);
  assert.deepStrictEqual(r.lines.map((l) => [l.days, l.rate, l.diy, l.amount]), [[10, 12, 365, 16.44], [10, 12.5, 366, 17.08]]);
  near(r.total, 33.52);
  // a whole leap year at a flat contractual rate is exactly the rate
  near(E.interestFor(inv({ amount: 1000, dueDate: '2023-12-31' }), '2024-12-31', { contractRate: 10 }).total, 100);
});
const PRINCIPAL_FIRST = { rates: E.DEFAULT_RATES, order: 'principal' };
t('interest, principal first (agreed by contract): payments reduce the principal from the next day; a full payment stops it', () => {
  const r = E.interestFor(inv({ amount: 10000, dueDate: '2025-08-31', payments: [{ date: '2025-09-10', amount: 4000 }] }), '2025-09-30', PRINCIPAL_FIRST);
  assert.deepStrictEqual(r.lines.map((l) => [l.from, l.to, l.principal, l.amount]), [['2025-09-01', '2025-09-10', 10000, 27.81], ['2025-09-11', '2025-09-30', 6000, 33.37]]);
  near(r.total, 61.18);
  assert.deepStrictEqual([r.principalOpen, r.interestPaid, r.interestOpen], [6000, 0, 61.18]);
  const paid = E.interestFor(inv({ amount: 10000, dueDate: '2025-08-31', payments: [{ date: '2025-09-10', amount: 10000 }] }), '2025-12-31', PRINCIPAL_FIRST);
  near(paid.total, 27.81);
  assert.strictEqual(paid.principalOpen, 0);
  const before = E.interestFor(inv({ amount: 10000, dueDate: '2025-08-31', payments: [{ date: '2025-08-20', amount: 2500 }] }), '2025-09-10', RATES);
  assert.strictEqual(before.lines[0].principal, 7500, 'a payment before the due date lowers the principal from the start');
  assert.strictEqual(E.interestFor(inv({ dueDate: '2026-10-13' }), '2026-10-13', RATES).total, 0, 'nothing on the due date itself');
});
t('interest cap: stops when unpaid interest reaches the principal (ne ultra alterum tantum)', () => {
  const capped = E.interestFor(inv({ amount: 1000, dueDate: '2025-01-01' }), '2026-06-30', { contractRate: 100, cap: true });
  assert.strictEqual(capped.capped, true);
  near(capped.total, 1000);
  assert.ok(capped.cappedOn >= '2026-01-01' && capped.cappedOn <= '2026-01-02', capped.cappedOn);
  const free = E.interestFor(inv({ amount: 1000, dueDate: '2025-01-01' }), '2026-06-30', { contractRate: 100, cap: false });
  assert.strictEqual(free.capped, false);
  near(free.total, 1493.15);
  // a payment that brings the principal below the interest already accrued stops it at once
  const drop = E.interestFor(inv({ amount: 1000, dueDate: '2025-01-01', payments: [{ date: '2025-10-01', amount: 900 }] }), '2026-06-30', { contractRate: 100, cap: true, order: 'principal' });
  assert.strictEqual(drop.capped, true);
  assert.ok(drop.total < 1000 && drop.total > 100);
  // by law the same payment first pays the interest, so the principal stays higher and the interest runs on
  const law = E.interestFor(inv({ amount: 1000, dueDate: '2025-01-01', payments: [{ date: '2025-10-01', amount: 900 }] }), '2026-06-30', { contractRate: 100, cap: true });
  assert.strictEqual(law.capped, false);
  near(law.interestPaid, law.lines[0].amount);
  near(law.principalOpen, 1000 - (900 - law.interestPaid));
  // unpaid interest that reached the principal stops; a payment of interest lets it run again
  const resume = E.interestFor(inv({ amount: 1000, dueDate: '2025-01-01', payments: [{ date: '2026-03-01', amount: 500 }] }), '2026-06-30', { contractRate: 100, cap: true });
  assert.strictEqual(resume.capped, true);
  assert.strictEqual(resume.allocations[0].interest, 500, 'all 500 € go to the 1.000 € of unpaid interest');
  assert.strictEqual(resume.principalOpen, 1000);
  assert.ok(resume.lines[resume.lines.length - 1].from === '2026-03-02', 'interest runs again the day after the payment');
  near(resume.interestOpen, 500 + E.sum(resume.lines.filter((l) => l.from >= '2026-03-02'), (l) => l.amount));
});
t('interest options: contractual rate per customer, cap on by default in Slovenia only, missing rates flagged', () => {
  const si = E.interestOpts({ country: 'SI', interest: {} }, S), hr = E.interestOpts({ country: 'HR', interest: {} }, S);
  assert.strictEqual(si.cap, true);
  assert.strictEqual(hr.cap, false);
  assert.strictEqual(E.interestOpts({ country: 'HR', interest: { cap: true } }, S).cap, true);
  assert.strictEqual(E.interestOpts({ country: 'SI', interest: { contractRate: 8 } }, S).contractRate, 8);
  assert.strictEqual(E.interestOpts({ country: 'SI', interest: { contractRate: '' } }, S).contractRate, null);
  const c = E.interestFor(inv({ amount: 3650, dueDate: '2026-01-01' }), '2026-01-11', { contractRate: 8 });
  near(c.total, 8);
  assert.strictEqual(c.contract, true);
  const late = E.interestFor(inv({ amount: 1000, dueDate: '2026-12-20' }), '2027-01-20', RATES);
  assert.strictEqual(late.missing, true, 'no rate entered for 2027');
  assert.strictEqual(E.rateFor('2025-03-01', E.normRates(E.DEFAULT_RATES)).rate, 11.15);
  assert.strictEqual(E.rateFor('2026-08-01', E.normRates(E.DEFAULT_RATES)).rate, 10.4, 'ECB 2,40 % on 1 July 2026 + 8 points');
  assert.strictEqual(E.DEFAULT_RATES.some(E.rateAssumed), false, 'no default rate is a guess any more');
});
t('rates still marked assumed are flagged; the untouched old 2026 H2 default is replaced on load', () => {
  const old = { from: '2026-07-01', to: '2026-12-31', rate: 10.15, note: 'Assumed: ECB rate unchanged, check' };
  const rates = E.DEFAULT_RATES.slice(0, -1).concat([old]);
  const r = E.interestFor(inv({ amount: 1000, dueDate: '2026-06-20' }), '2026-07-10', { rates: rates });
  assert.strictEqual(r.assumed, true); assert.deepStrictEqual(r.assumedFrom, ['2026-07-01']);
  assert.strictEqual(E.interestFor(inv({ amount: 1000, dueDate: '2026-05-20' }), '2026-06-10', { rates: rates }).assumed, false, 'only days in the assumed period count');
  assert.strictEqual(E.interestFor(inv({ amount: 1000, dueDate: '2026-06-20' }), '2026-07-10', { rates: [{ from: '2026-01-01', to: '', rate: 9, note: '', assumed: true }] }).assumed, true);
  const S2 = E.normSettings({ rates: rates });
  assert.deepStrictEqual(S2.rates[S2.rates.length - 1], { from: '2026-07-01', to: '2026-12-31', rate: 10.4, note: 'ECB 2,40 % + 8 points' });
  const edited = E.normSettings({ rates: [Object.assign({}, old, { rate: 10.3 })] });
  assert.strictEqual(edited.rates[0].rate, 10.3, 'a row the owner changed is kept as it is');
  assert.strictEqual(S.payOrder, 'law', 'new and old documents default to the legal order');
  assert.strictEqual(E.normSettings({ payOrder: 'principal' }).payOrder, 'principal');
  assert.strictEqual(E.normSettings({ payOrder: 'nonsense' }).payOrder, 'law');
  assert.strictEqual(E.interestOpts(customer(), E.normSettings({ payOrder: 'principal' })).order, 'principal');
});

// ── payment order: costs → interest → principal ───────────────────────────
t('by law (OZ Art. 288): a part-payment pays the costs, then the interest, then the principal', () => {
  // 10.000 € due 31. 8. 2025, 10,15 %: 27,81 € interest by 10. 9.; 4.000 € paid that day
  const r = E.interestFor(inv({ amount: 10000, dueDate: '2025-08-31', payments: [{ date: '2025-09-10', amount: 4000 }] }), '2025-09-30', RATES);
  assert.deepStrictEqual(r.allocations.map((a) => [a.costs, a.interest, a.principal]), [[0, 27.81, 3972.19]]);
  assert.deepStrictEqual(r.lines.map((l) => [l.from, l.to, l.principal, l.amount]), [['2025-09-01', '2025-09-10', 10000, 27.81], ['2025-09-11', '2025-09-30', 6027.81, 33.52]]);
  assert.deepStrictEqual([r.total, r.interestPaid, r.interestOpen, r.principalOpen, r.open], [61.33, 27.81, 33.52, 6027.81, 6061.33]);
  // a payment that covers the 40 € costs and only part of the interest leaves all of the principal open
  const c = E.interestFor(inv({ amount: 10000, dueDate: '2025-08-31', payments: [{ date: '2025-09-10', amount: 50 }] }), '2025-09-30', Object.assign({ costs: 40 }, RATES));
  assert.deepStrictEqual(c.allocations.map((a) => [a.costs, a.interest, a.principal]), [[40, 10, 0]]);
  assert.deepStrictEqual([c.costsOpen, c.interestPaid, c.principalOpen], [0, 10, 10000]);
  near(c.interestOpen, 27.81 - 10 + 55.62); // 20 more days on the whole 10.000 €
  near(c.open, 10000 + c.interestOpen);
  // costs are owed only after the due date: an early payment goes to the principal
  const early = E.interestFor(inv({ amount: 10000, dueDate: '2025-08-31', payments: [{ date: '2025-08-31', amount: 50 }] }), '2025-09-30', Object.assign({ costs: 40 }, RATES));
  assert.deepStrictEqual(early.allocations.map((a) => [a.costs, a.interest, a.principal]), [[0, 0, 50]]);
  assert.deepStrictEqual([early.costsOpen, early.principalOpen], [40, 9950]);
  // several payments: each pays what has accrued by its own day
  const two = E.interestFor(inv({ amount: 1000, dueDate: '2026-01-31', payments: [{ date: '2026-02-10', amount: 100 }, { date: '2026-02-10', amount: 50 }, { date: '2026-03-02', amount: 5 }] }), '2026-03-31', { contractRate: 36.5 });
  assert.deepStrictEqual(two.allocations.map((a) => [a.date, a.amount, a.interest, a.principal]), [['2026-02-10', 150, 10, 140], ['2026-03-02', 5, 5, 0]], 'same-day payments are added together');
  near(two.principalOpen, 860);
});
t('principal first (agreed by contract): the same payments leave the costs and interest open', () => {
  const c = E.interestFor(inv({ amount: 10000, dueDate: '2025-08-31', payments: [{ date: '2025-09-10', amount: 50 }] }), '2025-09-30', Object.assign({ costs: 40, order: 'principal' }, RATES));
  assert.deepStrictEqual(c.allocations.map((a) => [a.costs, a.interest, a.principal]), [[0, 0, 50]]);
  assert.deepStrictEqual([c.costsOpen, c.interestPaid, c.principalOpen], [40, 0, 9950]);
  near(c.interestOpen, 27.81 + E.round2(9950 * 0.1015 / 365 * 20));
  assert.strictEqual(c.principalOpen, E.openAt(inv({ amount: 10000, issueDate: '2025-08-01', payments: [{ date: '2025-09-10', amount: 50 }] }), '2025-09-30'), 'principal first matches the invoice balance');
});

// ── stages ─────────────────────────────────────────────────────────────────
const TODAY = '2026-10-13';
function customer(over) { return Object.assign({ id: 'c1', name: 'Test d.o.o.', country: 'SI', creditLimit: 0, interest: {} }, over || {}); }
function analyze(invs, acts, plans, cust) { return E.analyzeCustomer(customer(cust), invs, acts || [], plans || [], TODAY, S); }
const daysAgo = (n) => E.addDays(TODAY, -n);
const od = (id, days, amount, o) => inv(Object.assign({ id: id, no: '2026-00' + id, issueDate: E.addDays(TODAY, -days - 30), dueDate: daysAgo(days), amount: amount || 1000 }, o || {}));

t('stage: friendly reminder 3 days after due, the first letter skips to stage 1 when already 14+ days late', () => {
  assert.strictEqual(analyze([od('1', 2)]).dunning.due, false);
  let d = analyze([od('1', 5)]).dunning;
  assert.strictEqual(d.due, true); assert.strictEqual(d.next, 0);
  d = analyze([od('1', 20)]).dunning;
  assert.strictEqual(d.due, true); assert.strictEqual(d.next, 1);
  d = analyze([od('1', 70)]).dunning;
  assert.strictEqual(d.next, 1, 'letters go up one stage at a time');
});
t('stage: driven by the letters already sent for the current overdue invoices, the oldest invoice and the 10-day gap', () => {
  const letter = (stage, days, ids) => ({ id: 'L' + stage, customerId: 'c1', type: 'letter', date: daysAgo(days), stage: stage, invoiceIds: ids || ['1'] });
  let d = analyze([od('1', 20)], [letter(0, 12)]).dunning;
  assert.strictEqual(d.due, true); assert.strictEqual(d.next, 1);
  d = analyze([od('1', 20)], [letter(0, 5)]).dunning;
  assert.strictEqual(d.due, false); assert.strictEqual(d.skip.code, 'gap'); assert.strictEqual(d.nextDate, E.addDays(daysAgo(5), 10));
  d = analyze([od('1', 10)], [letter(0, 7)]).dunning;
  assert.strictEqual(d.due, false); assert.strictEqual(d.skip, null, 'not old enough for stage 1 yet');
  assert.strictEqual(d.nextDate, E.addDays(daysAgo(10), 14));
  d = analyze([od('1', 50), od('2', 10)], [letter(2, 15)]).dunning;
  assert.strictEqual(d.due, true); assert.strictEqual(d.next, 3);
  d = analyze([od('1', 35)], [letter(2, 15, ['other-paid-invoice'])]).dunning;
  assert.strictEqual(d.next, 1, 'letters about invoices that are paid since do not count');
  d = analyze([od('1', 80)], [letter(3, 20)]).dunning;
  assert.strictEqual(d.due, false); assert.strictEqual(d.skip.code, 'final');
});
t('stage skips: disputes, open promises, a kept payment plan, recent contact', () => {
  let st = analyze([od('1', 20, 1000, { disputed: { reason: 'damaged', since: daysAgo(3) } })]);
  assert.strictEqual(st.dunning.due, false); assert.strictEqual(st.dunning.skip.code, 'disputed');
  st = analyze([od('1', 20, 1000, { disputed: { reason: 'damaged', since: daysAgo(3) } }), od('2', 18)]);
  assert.strictEqual(st.dunning.due, true, 'one disputed invoice among others does not stop the letter');
  const promise = (date, amount, made) => ({ id: 'p', customerId: 'c1', type: 'call', outcome: 'promised', date: daysAgo(made || 2), promise: { date: date, amount: amount } });
  st = analyze([od('1', 20)], [promise(E.addDays(TODAY, 3), 1000)]);
  assert.strictEqual(st.dunning.skip.code, 'promise', 'the open promise is the reason given, before the recent contact');
  st = analyze([od('1', 20)], [promise(E.addDays(TODAY, 3), 1000, 9)]);
  assert.strictEqual(st.dunning.skip.code, 'promise');
  st = analyze([od('1', 20)], [promise(daysAgo(5), 1000, 12)]);
  assert.strictEqual(st.dunning.due, true, 'a broken promise does not hold the letter back');
  const plan = (paidDate) => ({ id: 'pl', customerId: 'c1', created: daysAgo(40), status: 'active', instalments: [{ due: daysAgo(30), amount: 500, paidDate: paidDate }, { due: E.addDays(TODAY, 1), amount: 500, paidDate: null }] });
  st = analyze([od('1', 60)], [], [plan(daysAgo(30))]);
  assert.strictEqual(st.dunning.skip.code, 'plan');
  st = analyze([od('1', 60)], [], [plan(null)]);
  assert.strictEqual(st.plan.state, 'late');
  assert.strictEqual(st.dunning.due, true, 'a plan that is not being kept does not hold the letter back');
  st = analyze([od('1', 20)], [{ id: 'x', customerId: 'c1', type: 'call', outcome: 'reached', date: daysAgo(3) }]);
  assert.strictEqual(st.dunning.skip.code, 'contact');
  st = analyze([od('1', 20)], [{ id: 'x', customerId: 'c1', type: 'call', outcome: 'no-answer', date: daysAgo(3) }]);
  assert.strictEqual(st.dunning.due, true, 'an unanswered call is not a contact');
  st = analyze([od('1', 20)], [{ id: 'x', customerId: 'c1', type: 'call', outcome: 'reached', date: daysAgo(7) }]);
  assert.strictEqual(st.dunning.due, true, 'contact gap is 7 days');
});

// ── promises and plans ─────────────────────────────────────────────────────
t('promises: kept with 98 % paid by the date + 2 grace days, broken after, open before', () => {
  const a = { customerId: 'c1', date: '2026-10-01', promise: { date: '2026-10-08', amount: 1000 } };
  const paid = (date, amount) => [inv({ payments: [{ date: date, amount: amount }] })];
  assert.strictEqual(E.promiseState(a, paid('2026-10-09', 990), '2026-10-13', 2).state, 'kept');
  assert.strictEqual(E.promiseState(a, paid('2026-10-10', 1000), '2026-10-13', 2).state, 'kept');
  assert.strictEqual(E.promiseState(a, paid('2026-10-11', 1000), '2026-10-13', 2).state, 'broken', 'paid after the grace days');
  assert.strictEqual(E.promiseState(a, paid('2026-10-05', 500), '2026-10-13', 2).state, 'broken');
  assert.strictEqual(E.promiseState(a, paid('2026-10-05', 500), '2026-10-09', 2).state, 'open');
  assert.strictEqual(E.promiseState(a, paid('2026-09-30', 1000), '2026-10-13', 2).state, 'broken', 'a payment before the promise does not count');
});
t('payment plans: split into monthly instalments, kept / late / completed', () => {
  const inst = E.splitPlan(1000, 3, '2026-01-31');
  assert.deepStrictEqual(inst.map((i) => [i.due, i.amount]), [['2026-01-31', 333.33], ['2026-02-28', 333.33], ['2026-03-31', 333.34]]);
  near(E.sum(inst, (i) => i.amount), 1000);
  const plan = { instalments: [{ due: '2026-09-01', amount: 500, paidDate: '2026-09-01' }, { due: '2026-10-01', amount: 500, paidDate: null }] };
  assert.strictEqual(E.planState(plan, '2026-10-02', 2).state, 'kept', 'inside the grace days');
  assert.strictEqual(E.planState(plan, '2026-10-04', 2).state, 'late');
  plan.instalments[1].paidDate = '2026-10-05';
  const done = E.planState(plan, '2026-10-06', 2);
  assert.strictEqual(done.state, 'completed'); assert.strictEqual(done.lateCount, 1); near(done.left, 0);
});
t('payments are allocated to the oldest open invoices first', () => {
  const a = E.allocate([od('new', 5, 300), od('old', 40, 500, { payments: [{ date: daysAgo(10), amount: 100 }] })], 1000, TODAY);
  assert.deepStrictEqual(a.parts.map((p) => [p.id, p.amount]), [['old', 400], ['new', 300]]);
  assert.strictEqual(a.rest, 300);
});

// ── priority ───────────────────────────────────────────────────────────────
t('call priority: explainable points and chips, best first', () => {
  const bigQuiet = analyze([od('1', 40, 60000)], [{ id: 'x', customerId: 'c1', type: 'call', outcome: 'reached', date: daysAgo(21) }]);
  const codes = bigQuiet.priority.reasons.map((r) => r.code);
  assert.deepStrictEqual(codes, ['amount', 'age', 'quiet']);
  assert.strictEqual(bigQuiet.priority.reasons[2].label, 'No contact for 21 days');
  assert.strictEqual(bigQuiet.priority.score, E.sum(bigQuiet.priority.reasons, (r) => r.points));
  const broken = analyze([od('1', 40, 60000)], [{ id: 'p', customerId: 'c1', type: 'call', outcome: 'promised', date: '2026-09-30', promise: { date: '2026-10-07', amount: 15000 } }], [], { creditLimit: 47600 });
  const labels = broken.priority.reasons.filter((r) => r.chip).map((r) => r.label);
  assert.ok(labels.indexOf('Broken promise 7. 10.') >= 0, labels.join(' | '));
  assert.ok(labels.indexOf('Over limit by 12.400 €') >= 0, labels.join(' | '));
  assert.ok(broken.priority.score > bigQuiet.priority.score);
  const small = analyze([od('1', 5, 800)], [{ id: 'x', customerId: 'c1', type: 'call', outcome: 'reached', date: daysAgo(2) }]);
  assert.ok(small.priority.score < bigQuiet.priority.score);
  assert.strictEqual(small.priority.reasons.filter((r) => r.chip).length, 0);
  assert.strictEqual(analyze([od('1', -10, 5000)]).priority.score, 0, 'nothing overdue, nothing to chase');
  // order of a small portfolio
  const db = {
    customers: [{ id: 'a', name: 'A', creditLimit: 0, interest: {} }, { id: 'b', name: 'B', creditLimit: 0, interest: {} }, { id: 'c', name: 'C', creditLimit: 0, interest: {} }],
    invoices: [od('1', 50, 40000, { customerId: 'a' }), od('2', 10, 2000, { customerId: 'b' }), od('3', 30, 9000, { customerId: 'c' })],
    actions: [{ id: 'q', customerId: 'c', type: 'call', outcome: 'promised', date: daysAgo(1), promise: { date: E.addDays(TODAY, 2), amount: 9000 } }], plans: [], settings: S
  };
  const list = E.callList(db, E.analyzeAll(db, TODAY), TODAY);
  assert.deepStrictEqual(list.map((x) => x.c.id), ['a', 'b'], 'C waits for its promise');
});
t('worsening trend: recent payments at least 7 days later than before', () => {
  const invs = [];
  for (let k = 0; k < 6; k++) invs.push(inv({ id: 'o' + k, dueDate: daysAgo(300 - k * 20), amount: 1000, payments: [{ date: daysAgo(290 - k * 20), amount: 1000 }] }));
  for (let k = 0; k < 3; k++) invs.push(inv({ id: 'n' + k, dueDate: daysAgo(100 - k * 10), amount: 1000, payments: [{ date: daysAgo(70 - k * 10), amount: 1000 }] }));
  const b = E.behaviour(invs, TODAY);
  assert.strictEqual(b.trend, 'worse');
  near(b.before, 10); near(b.recent, 30);
  const st = analyze(invs.concat([od('x', 20, 5000)]), [{ id: 'z', customerId: 'c1', type: 'call', outcome: 'reached', date: daysAgo(1) }]);
  assert.ok(st.priority.reasons.some((r) => r.code === 'trend' && r.label === 'Paying later: 10 → 30 days'));
});

// ── references and QR ──────────────────────────────────────────────────────
t('payment reference: SI00 + the invoice number digits, as Billing does', () => {
  assert.strictEqual(E.paymentReference('2026-001234'), 'SI00 2026-001234');
  assert.strictEqual(E.paymentReference('RN 2026/00042'), 'SI00 202600042');
  assert.strictEqual(E.paymentReference('INV-77-'), 'SI00 77');
  assert.strictEqual(E.paymentReference(''), '');
});
const SNAP = {
  customer: { name: 'Vzorec Energija d.o.o.', address: 'Leskoškova cesta 9', postalCity: '1000 Ljubljana', country: 'SI' },
  issuer: { name: 'Nordvik Distribucija d.o.o.', address: 'Tovarniška cesta 14', postalCity: '1000 Ljubljana', iban: 'SI56 9900 0012 3456 721', bic: '' },
  purposeCode: 'GDSV', purpose: 'Plačilo zapadlih računov 2026/0154', dueDate: '2026-10-21', reference: 'SI00 2026-001234'
};
t('UPN QR text: 19 fields in order, amount in cents padded to 11, 3-digit length checksum, Latin-2 bytes', () => {
  const txt = E.upnQrText(SNAP, 1234567);
  const lines = txt.split('\n');
  assert.strictEqual(lines.length, 21); // 19 fields + checksum + the empty string after the last LF
  assert.deepStrictEqual(lines.slice(0, 19), ['UPNQR', '', '', '', '', 'Vzorec Energija d.o.o.', 'Leskoškova cesta 9', '1000 Ljubljana', '00001234567', '', '', 'GDSV', 'Plačilo zapadlih računov 2026/0154', '21.10.2026', 'SI56990000123456721', 'SI002026-001234', 'Nordvik Distribucija d.o.o.', 'Tovarniška cesta 14', '1000 Ljubljana']);
  const body = lines.slice(0, 19).map((f) => f + '\n').join('');
  assert.strictEqual(lines[19], String(body.length).padStart(3, '0'));
  assert.strictEqual(lines[19].length, 3);
  assert.strictEqual(lines[20], '');
  const long = E.upnQrText(Object.assign({}, SNAP, { customer: Object.assign({}, SNAP.customer, { name: 'A'.repeat(50) }) }), 5);
  assert.strictEqual(long.split('\n')[5].length, 33, 'names are clipped to 33 characters');
  assert.strictEqual(long.split('\n')[8], '00000000005');
  const bytes = E.toLatin2Bytes('čšžČŠŽćđ€a');
  assert.deepStrictEqual(bytes, [0xE8, 0xB9, 0xBE, 0xC8, 0xA9, 0xAE, 0xE6, 0xF0, 0x3F, 0x61]);
  assert.strictEqual(E.toLatin2Bytes(txt).length, txt.length, 'one byte per character');
  assert.ok(txt.length <= 411, 'fits QR version 15-M in byte mode');
});
t('EPC QR text for other EU countries', () => {
  const txt = E.epcQrText(SNAP, 2519240);
  assert.deepStrictEqual(txt.split('\n'), ['BCD', '002', '1', 'SCT', '', 'Nordvik Distribucija d.o.o.', 'SI56990000123456721', 'EUR25192.40', '', '', 'Plačilo zapadlih računov 2026/0154 SI00 2026-001234']);
  assert.strictEqual(E.qrKind('SI'), 'upn');
  assert.strictEqual(E.qrKind('HR'), 'epc');
  assert.strictEqual(E.qrKind('US'), null);
});
t('validators: IBAN, Slovenian VAT check digit, Croatian OIB', () => {
  assert.strictEqual(E.ibanValid('SI56 9900 0012 3456 721'), true);
  assert.strictEqual(E.ibanValid('SI56 9900 0012 3456 722'), false);
  assert.strictEqual(E.siTaxValid('SI12345679'), true);   // a made-up example number
  assert.strictEqual(E.siTaxValid('SI12345678'), false);
  assert.strictEqual(E.hrOibValid('HR00000000001'), true);   // a made-up example number
  assert.strictEqual(E.hrOibValid('00000000002'), false);
  assert.strictEqual(E.vatIdValid('ATU12345678'), true);
  assert.strictEqual(E.vatIdValid(''), false);
});

// ── letters ────────────────────────────────────────────────────────────────
const CO = D.COMPANY, SENDER = D.SENDER;
function letter(stage, lang, cust, invs, acts, settings) {
  return E.letterModel({ company: CO, sender: SENDER, customer: cust || customer({ address: { street: 'Leskoškova cesta 9', postal: '1000', city: 'Ljubljana' } }), invoices: invs, actions: acts || [], stage: stage, today: TODAY, lang: lang, settings: settings || S, letterNo: '2026/0154' });
}
t('letter: overdue undisputed invoices, interest only from stage 2, €40 per invoice at the final notice', () => {
  const invs = [od('1', 50, 12400), od('2', 20, 3000, { payments: [{ date: daysAgo(5), amount: 1000 }] }), od('3', 30, 900, { disputed: { reason: 'x', since: daysAgo(2) } }), od('4', -5, 7000)];
  const m1 = letter(1, 'sl', null, invs);
  assert.deepStrictEqual(m1.rows.map((r) => r.id), ['1', '2']);
  assert.strictEqual(m1.principal, 14400);
  assert.strictEqual(m1.interest, 0); assert.strictEqual(m1.fee, 0); assert.strictEqual(m1.total, 14400);
  assert.strictEqual(m1.disputed.length, 1);
  assert.strictEqual(m1.deadline, E.addDays(TODAY, 8));
  assert.strictEqual(m1.reference, 'SI00 2026-001');
  const m3 = letter(3, 'sl', null, invs);
  assert.ok(m3.interest > 0);
  near(m3.interest, E.sum(m3.rows, (r) => r.interest));
  assert.strictEqual(m3.feeFull, 80, '40 € for each of the two invoices');
  assert.strictEqual(m3.fee, 40, 'invoice 2 paid 1.000 € after its due date: by law that covered its 40 € first');
  assert.strictEqual(m3.rows[1].paidCosts, 40);
  near(m3.total, m3.principal + m3.interest + m3.fee);
  near(m3.rows[0].interest, E.interestFor(invs[0], TODAY, E.interestOpts(customer(), S)).total);
  assert.strictEqual(m3.title, 'Zadnji opomin pred tožbo');
  assert.strictEqual(m3.salutation, 'Spoštovani,');
  assert.ok(m3.feeNote.indexOf('40,00') >= 0);
  assert.strictEqual(letter(3, 'hr', null, invs).title, 'Opomena pred tužbu');
  assert.strictEqual(letter(3, 'hr', null, invs).salutation, 'Poštovani,');
  assert.strictEqual(letter(1, 'hr', null, invs).title, 'Opomena');
  assert.strictEqual(letter(3, 'en', null, invs).title, 'Final notice before legal action');
  assert.ok(letter(1, 'hr', null, invs).intro.indexOf('21.\u00a010.\u00a02026.') >= 0, 'Croatian dates end with a full stop');
  ['hr', 'sl', 'en'].forEach((lang) => [0, 1, 2, 3].forEach((st) => {
    const m = letter(st, lang, null, invs), mail = E.emailText(m, CO, SENDER);
    assert.ok(!/\d\.\./.test(m.intro + m.payText + m.interestNote + m.feeNote + mail.body), lang + ' stage ' + st + ': no double full stop after a date');
    assert.strictEqual(/\{\w+\}/.test(m.intro + m.payText + mail.body), false, lang + ' stage ' + st + ': no placeholder left');
  }));
  assert.ok(letter(2, 'sl', null, invs, [{ type: 'letter', date: daysAgo(15), stage: 1 }]).intro.indexOf('28.\u00a09.\u00a02026') >= 0, 'stage 2 names the previous reminder');
  assert.strictEqual(letter(2, 'sl', null, invs).intro.indexOf('{'), -1, 'no placeholders left without a previous letter');
  const edited = E.letterModel({ company: CO, sender: SENDER, customer: customer(), invoices: invs, actions: [], stage: 1, today: TODAY, lang: 'en', settings: S, intro: 'Custom text.' });
  assert.strictEqual(edited.intro, 'Custom text.'); assert.strictEqual(edited.edited, true);
});
t('letter: e-mail text and a mailto link under 1800 characters, even with many invoices', () => {
  const invs = [];
  for (let k = 0; k < 40; k++) invs.push(od(String(100 + k), 20 + k, 1000 + k * 10));
  const m = letter(2, 'sl', customer({ contact: { email: 'a.b@example.com' } }), invs);
  const mail = E.emailText(m, CO, SENDER);
  assert.ok(mail.subject.indexOf('Drugi opomin') === 0, mail.subject);
  assert.ok(mail.body.indexOf('Skupaj za plačilo') >= 0);
  assert.ok(mail.body.indexOf(SENDER.name) >= 0);
  const href = E.mailtoHref('a.b@example.com', m, CO, SENDER, 1800);
  assert.ok(href.length <= 1800, href.length);
  assert.ok(href.indexOf('mailto:a.b%40example.com?subject=') === 0);
  assert.ok(decodeURIComponent(href).indexOf('Skupaj za plačilo') > 0, 'the total is always in the short body');
  const one = E.mailtoHref('x@example.com', letter(0, 'en', null, [od('1', 5, 500)]), CO, SENDER);
  assert.ok(decodeURIComponent(one).indexOf(E.TEXTS.en.intro[0]) > 0, 'a short letter keeps its intro');
});

t('letter: a part-payment shows what went to costs and interest, and the open amounts follow the setting', () => {
  // 3.000 € 20 days overdue; 100 € paid 5 days ago; the final notice claims interest and the 40 € costs
  const invs = [od('1', 20, 3000, { payments: [{ date: daysAgo(5), amount: 100 }] })];
  const it = E.interestFor(invs[0], daysAgo(5), { rates: E.DEFAULT_RATES }).total; // interest accrued by the payment day
  const m = letter(3, 'sl', null, invs);
  const r = m.rows[0];
  assert.deepStrictEqual([r.paid, r.paidCosts], [100, 40]);
  near(r.paidInterest, it); near(r.paidPrincipal, 60 - it);
  near(r.open, 3000 - (60 - it), 'the open principal is higher than the invoice balance');
  assert.strictEqual(r.balance, 2900);
  assert.strictEqual(m.fee, 0, 'the costs are paid');
  near(m.total, m.principal + m.interest);
  assert.ok(/^od tega obresti \d+,\d\d €, stroški 40,00 €$/.test(E.ofWhich(r, 'sl').replace(/ /g, ' ')), E.ofWhich(r, 'sl'));
  assert.ok(m.paymentsNote.indexOf('288. členom Obligacijskega zakonika') > 0 && m.paymentsNote.indexOf('40,00 € za stroške') > 0, m.paymentsNote);
  assert.ok(E.emailText(m, CO, SENDER).body.indexOf(m.paymentsNote) > 0, 'the e-mail says it too');
  assert.ok(letter(3, 'hr', null, invs).paymentsNote.indexOf('člankom 172. Zakona o obveznim odnosima') > 0);
  assert.ok(/applied as the law provides/.test(letter(3, 'en', null, invs).paymentsNote));
  // the second reminder has no costs: the payment goes to interest, then principal
  const m2 = letter(2, 'sl', null, invs);
  assert.deepStrictEqual([m2.rows[0].paidCosts, m2.fee], [0, 0]);
  near(m2.rows[0].paidInterest, it);
  // the first reminder claims neither: the open amount is the invoice balance and there is no note
  const m1 = letter(1, 'sl', null, invs);
  assert.deepStrictEqual([m1.rows[0].open, m1.paymentsNote, E.ofWhich(m1.rows[0], 'sl')], [2900, '', '']);
  // principal first
  const mp = letter(3, 'sl', null, invs, [], E.normSettings({ payOrder: 'principal' }));
  assert.deepStrictEqual([mp.rows[0].open, mp.fee, mp.paymentsNote, mp.payOrder], [2900, 40, '', 'principal']);
  near(mp.total, 2900 + mp.interest + 40);
  // a rate still marked assumed is flagged on the letter model (the app warns; the printed letter does not)
  const assumed = E.DEFAULT_RATES.slice(0, -1).concat([{ from: '2026-07-01', to: '2026-12-31', rate: 10.15, note: 'Assumed, check' }]);
  const ma = letter(2, 'sl', null, invs, [], E.normSettings({ rates: assumed }));
  assert.deepStrictEqual([ma.assumedRate, ma.assumedFrom], [true, ['2026-07-01']]);
  assert.strictEqual(m.assumedRate, false);
  assert.strictEqual(m1.assumedRate, false, 'no interest, no rate used');
});

// ── CSV ────────────────────────────────────────────────────────────────────
t('CSV parser: quotes, escaped quotes, delimiters and line breaks inside quotes, BOM, CRLF, empty rows', () => {
  const p = E.parseCsv('﻿number;customer;amount\r\n"2026-1";"Vzorec; Energija";"1.234,56"\r\n2026-2;"He said ""hi""";5\r\n\r\n"2026-3";"two\nlines";\r\n');
  assert.strictEqual(p.delimiter, ';');
  assert.deepStrictEqual(p.rows, [['number', 'customer', 'amount'], ['2026-1', 'Vzorec; Energija', '1.234,56'], ['2026-2', 'He said "hi"', '5'], ['2026-3', 'two\nlines', '']]);
  assert.strictEqual(E.parseCsv('a,b,c\n1,2,3').delimiter, ',');
  assert.strictEqual(E.parseCsv('a\tb\tc\n1\t2\t3').delimiter, '\t');
  assert.strictEqual(E.parseCsv('"a;b",c,d\n1,2,3').delimiter, ',', 'delimiters inside quotes are not counted');
  assert.deepStrictEqual(E.parseCsv('x;y\rz;w').rows, [['x', 'y'], ['z', 'w']], 'old Mac line ends');
  assert.deepStrictEqual(E.parseCsv('').rows, []);
  const out = E.toCsv([['a;b', 'say "x"', 'line\nbreak', 1.5]]);
  assert.strictEqual(out, '﻿"a;b";"say ""x""";"line\nbreak";1.5\r\n');
  assert.deepStrictEqual(E.parseCsv(out).rows, [['a;b', 'say "x"', 'line\nbreak', '1.5']]);
});
t('numbers: decimal comma, thousand dots, either convention, currency, negatives', () => {
  const cases = [['1.234,56', 1234.56], ['1234,56', 1234.56], ['1,234.56', 1234.56], ['1234.56', 1234.56], ['1.234', 1234], ['12.345.678', 12345678],
    ['0.123', 0.123], ['1,5', 1.5], ['1 234,56 €', 1234.56], ['EUR 99', 99], ['-12,50', -12.5], ['−12', -12], ['(12,00)', -12], ['12.', 12], [',5', 0.5]];
  cases.forEach(([s, v]) => near(E.parseNumber(s), v, s));
  ['', 'abc', '1.2.3', '12,34,5', '1e5', '--1'].forEach((s) => assert.ok(isNaN(E.parseNumber(s)), s));
});
t('dates: dd.mm.yyyy, d. m. yyyy, Croatian trailing dot, ISO, slashes; invalid dates rejected', () => {
  assert.strictEqual(E.parseDate('13.10.2026'), '2026-10-13');
  assert.strictEqual(E.parseDate('3. 1. 2026'), '2026-01-03');
  assert.strictEqual(E.parseDate('13. 10. 2026.'), '2026-10-13');
  assert.strictEqual(E.parseDate('2026-10-13'), '2026-10-13');
  assert.strictEqual(E.parseDate('2026-1-5'), '2026-01-05');
  assert.strictEqual(E.parseDate('13/10/2026'), '2026-10-13');
  assert.strictEqual(E.parseDate('2026-10-13T08:00:00'), '2026-10-13');
  assert.strictEqual(E.parseDate('31.02.2026'), null);
  assert.strictEqual(E.parseDate('13.10.26'), null);
  assert.strictEqual(E.parseDate(''), null);
});
t('import: column guessing in Slovene, validation errors and warnings', () => {
  const head = ['Št. računa', 'Kupec', 'ID za DDV', 'Datum izdaje', 'Zapadlost', 'Znesek', 'Odprto'];
  const map = E.guessMapping(head);
  assert.deepStrictEqual([map.no, map.customer, map.vatId, map.issueDate, map.dueDate, map.amount, map.open], [0, 1, 2, 3, 4, 5, 6]);
  const en = E.guessMapping(['Invoice', 'Customer', 'Issue date', 'Due date', 'Amount', 'Open amount']);
  assert.deepStrictEqual([en.no, en.customer, en.issueDate, en.dueDate, en.amount, en.open], [0, 1, 2, 3, 4, 5]);
  const rows = [head,
    ['2026-1', 'Vzorec Energija d.o.o.', 'SI12345679', '1.9.2026', '1.10.2026', '1.234,56', '1.234,56'],
    ['2026-2', 'Vzorec Energija d.o.o.', '', '', '15.10.2026', '500', '200'],
    ['2026-3', 'Hiša Mojstrov d.o.o.', 'SI12345678', '1.9.2026', '31.9.2026', '100', ''],
    ['2026-4', '', '', '1.9.2026', '1.10.2026', 'abc', ''],
    ['2026-5', 'Polarka Klima d.o.o.', '', '1.9.2026', '1.10.2026', '100', '150'],
    ['2026-1', 'Vzorec Energija d.o.o.', '', '1.9.2026', '1.10.2026', '10', ''],
    ['2026-6', 'Polarka Klima d.o.o.', '', '1.9.2026', '1.10.2026', '100', '0'],
    ['2026-7', 'Polarka Klima d.o.o.', 'SI11111111', '1.9.2026', '1.10.2026', '100', '100'],
    ['OLD-1', 'Polarka Klima d.o.o.', '', '1.9.2026', '1.10.2026', '100', '100']];
  const res = E.buildImport(rows, map, { today: TODAY, existing: { 'OLD-1': true } });
  assert.deepStrictEqual(res.items.map((i) => i.no), ['2026-1', '2026-2', '2026-7']);
  assert.strictEqual(res.items[0].amount, 1234.56);
  assert.strictEqual(res.items[1].open, 200);
  assert.strictEqual(res.items[1].issueDate, '2026-09-15', 'missing issue date: 30 days before the due date');
  const msgs = res.errors.map((e) => e.msg).join('\n');
  assert.ok(/Row 4: due date "31.9.2026" is not a date/.test(msgs), msgs);
  assert.ok(/Row 5: the customer is empty/.test(msgs) && /Row 5: amount "abc"/.test(msgs), msgs);
  assert.ok(/Row 6: the open amount is larger than the invoice amount/.test(msgs), msgs);
  assert.ok(/Row 7: invoice 2026-1 appears twice/.test(msgs), msgs);
  const warns = res.warnings.map((w) => w.msg).join('\n');
  assert.ok(/Row 8: invoice 2026-6 is fully paid, skipped/.test(warns), warns);
  assert.ok(/Row 10: invoice OLD-1 is already in the app/.test(warns), warns);
  assert.ok(/Row 9: VAT ID SI11111111 fails its check digit/.test(warns), warns);
  assert.ok(/1 row has no issue date/.test(warns), warns);
  const noCol = E.buildImport(rows, Object.assign({}, map, { dueDate: -1 }), { today: TODAY });
  assert.ok(/Due date/.test(noCol.errors[0].msg));
});

// ── reports ────────────────────────────────────────────────────────────────
t('reports: collected per week, aging trend, DSO by month, reminder effectiveness', () => {
  const list = [inv({ id: 'a', amount: 1000, issueDate: '2026-08-01', dueDate: '2026-09-01', payments: [{ date: '2026-10-12', amount: 600 }, { date: '2026-10-05', amount: 100 }] })];
  const w = E.collectedByWeek(list, TODAY, 3);
  assert.deepStrictEqual(w.map((x) => [x.start, x.amount]), [['2026-09-28', 0], ['2026-10-05', 100], ['2026-10-12', 600]]);
  const tr = E.agingTrend(list, TODAY, 4);
  assert.deepStrictEqual(tr.map((x) => x.date), ['2026-09-27', '2026-10-04', '2026-10-11', TODAY]); // the Sundays before a Tuesday
  assert.strictEqual(tr[3].total, 300);
  const m = E.dsoByMonth(list, TODAY, 3);
  assert.deepStrictEqual(m.map((x) => x.date), ['2026-08-31', '2026-09-30', TODAY]);
  const acts = [{ type: 'letter', stage: 0, date: '2026-09-25', invoiceIds: ['a'], amount: 1000 }, { type: 'letter', stage: 1, date: '2026-10-04', invoiceIds: ['a'], amount: 900 }];
  const rr = E.reminderReport(acts, { a: list[0] }, TODAY, S.stages);
  assert.strictEqual(rr[0].evaluated, 1); assert.strictEqual(rr[0].part, 1); assert.strictEqual(rr[0].paid, 0);
  assert.strictEqual(rr[1].sent, 1); assert.strictEqual(rr[1].evaluated, 0, 'sent less than 14 days ago');
});

// ── demo data ──────────────────────────────────────────────────────────────
t('generator: deterministic for the same day', () => {
  assert.deepStrictEqual(D.generate(TODAY), D.generate(TODAY));
  assert.notDeepStrictEqual(D.generate(TODAY).invoices[0].issueDate, D.generate('2026-11-20').invoices[0].issueDate);
});
t('generator: valid records on any day of the week', () => {
  for (let k = 0; k < 7; k++) {
    const today = E.addDays(TODAY, k), db = D.generate(today), ids = {}, nos = {};
    assert.strictEqual(db.customers.length, 56);
    assert.strictEqual(db.customers.filter((c) => c.country === 'HR').length, 8);
    db.customers.forEach((c) => {
      assert.ok(E.vatIdValid(c.vatId), c.name + ' ' + c.vatId);
      assert.ok(/@example\.com$/.test(c.contact.email), c.contact.email);
      assert.ok(/^\+38[56] \d/.test(c.contact.phone), c.contact.phone);
      assert.ok(['sl', 'hr', 'en'].indexOf(c.language) >= 0);
    });
    assert.ok(E.ibanValid(db.company.iban) && E.siTaxValid(db.company.vatId));
    const custIds = {}; db.customers.forEach((c) => { custIds[c.id] = 1; });
    db.invoices.forEach((i) => {
      assert.ok(!ids[i.id] && !nos[i.no], 'unique ' + i.id + ' ' + i.no); ids[i.id] = 1; nos[i.no] = 1;
      assert.ok(custIds[i.customerId]);
      assert.ok(E.isDate(i.issueDate) && E.isDate(i.dueDate) && i.dueDate >= i.issueDate, i.no);
      assert.ok(i.issueDate < today);
      assert.ok(i.amount > 0);
      const paid = E.paidUpTo(i);
      assert.ok(paid <= i.amount + 0.005, 'payments never exceed the amount: ' + i.no);
      assert.ok(E.openAt(i, today) >= 0);
      i.payments.forEach((p) => { assert.ok(p.amount > 0 && p.date >= i.issueDate && p.date < today, i.no + ' payment ' + p.date); });
    });
    const invIds = ids;
    db.actions.forEach((a) => {
      assert.ok(custIds[a.customerId], 'action customer');
      assert.ok(E.ACTION_TYPES.indexOf(a.type) >= 0, a.type);
      assert.ok(a.date < today || (a.date === today && a.type !== 'letter'), 'actions are in the past');
      (a.invoiceIds || []).forEach((id) => assert.ok(invIds[id], 'action invoice ' + id));
      if (a.type === 'letter') assert.ok(a.stage >= 0 && a.stage <= 3);
      if (a.promise) assert.ok(a.promise.amount > 0 && E.isDate(a.promise.date));
    });
    db.plans.forEach((p) => { near(E.sum(p.instalments, (x) => x.amount), p.total); });
  }
});
t('generator: plausible totals and a story worth showing', () => {
  for (let k = 0; k < 7; k++) {
    const today = E.addDays(TODAY, k), db = D.generate(today), ix = E.indexDb(db), st = E.analyzeAll(db, today, ix);
    const ag = E.aging(db.invoices, today);
    assert.ok(db.invoices.length >= 900 && db.invoices.length <= 1300, 'invoices ' + db.invoices.length);
    assert.ok(ag.total >= 2.0e6 && ag.total <= 2.6e6, 'open ' + ag.total);
    assert.ok(ag.overdue >= 0.6e6 && ag.overdue <= 0.9e6, 'overdue ' + ag.overdue);
    const months = {}; db.invoices.forEach((i) => { const m = i.issueDate.slice(0, 7); months[m] = (months[m] || 0) + i.amount; });
    const full = Object.keys(months).sort().slice(1, -1).map((m) => months[m]);
    const avg = E.sum(full) / full.length;
    assert.ok(avg > 0.9e6 && avg < 1.25e6, 'monthly sales ' + avg);
    const disputed = db.invoices.filter((i) => i.disputed).length;
    assert.ok(disputed >= 3 && disputed <= 4, 'disputed ' + disputed);
    assert.ok(db.invoices.some((i) => i.writtenOff));
    assert.strictEqual(db.plans.length, 1);
    assert.strictEqual(E.planState(db.plans[0], today, 2).state, 'kept');
    const letters = db.customers.filter((c) => st[c.id].dunning.due).length;
    assert.ok(letters >= 6 && letters <= 15, 'letters due today ' + letters);
    const calls = E.callList(db, st, today);
    assert.ok(calls.length >= 12, 'call list ' + calls.length);
    const struna = db.customers.filter((c) => c.name === 'Struna Gradnje d.o.o.')[0], s = st[struna.id];
    assert.strictEqual(calls[0].c.id, struna.id, 'Struna tops the call list');
    const broken = s.promises.filter((p) => p.state === 'broken');
    assert.deepStrictEqual(broken.map((p) => [p.amount, p.paid]), [[20000, 5000], [15000, 0]], 'Struna promised 20.000 € and paid 5.000 €, then promised 15.000 € and paid nothing');
    assert.ok(/7\.\u00a010\./.test(s.priority.reasons.filter((r) => r.code === 'broken')[0].label) || today !== TODAY, 'the chip names 7. 10. on 13 October');
    assert.strictEqual(s.behaviour.trend, 'worse');
    assert.ok(s.dunning.due && s.dunning.next === 3, 'Struna gets the final notice');
    assert.ok(s.overLimit > 0 && struna.onHold);
    const pr = { kept: 0, broken: 0, open: 0 };
    db.actions.forEach((a) => { if (a.promise) { const ps = E.promiseState(a, ix.invBy[a.customerId], today, 2); pr[ps.state]++; assert.strictEqual(a.promise.status, ps.state); } });
    assert.ok(pr.kept > 3 * pr.broken, 'most promises are kept: ' + JSON.stringify(pr));
    assert.ok(pr.open >= 3, 'open promises ' + pr.open);
    const publicLate = db.customers.filter((c) => c.segment === 'Public sector' && st[c.id].oldestDays > 5);
    assert.strictEqual(publicLate.length, 0, 'public sector pays on time');
    const skips = {}; db.customers.forEach((c) => { if (st[c.id].dunning.skip) skips[st[c.id].dunning.skip.code] = 1; });
    ['disputed', 'promise', 'plan', 'final'].forEach((code) => assert.ok(skips[code], 'skip reason ' + code + ' shown'));
    assert.ok(Object.keys(skips).length >= 4, 'varied skip reasons: ' + Object.keys(skips).join(', '));
  }
});

console.log(n + ' tests passed');
