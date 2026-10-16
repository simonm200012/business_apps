// Tests for the monthly forecast (site/cashflow/engine.js) and the demo receivables shared with Collections
// (site/cashflow/data.js reads site/collections/data.js, read only). Run: node tools/tests/cashflow-months.test.js
'use strict';
const assert = require('assert');
const path = require('path');
const E = require(path.join(__dirname, '../../site/cashflow/engine.js'));
const D = require(path.join(__dirname, '../../site/cashflow/data.js'));
const CE = require(path.join(__dirname, '../../site/collections/engine.js'));
const CD = require(path.join(__dirname, '../../site/collections/data.js'));

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok', n, name); }
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, (msg || '') + ' ' + a + ' vs ' + b);

t('months: calendar months from today, the first one partial', () => {
  const db = D.generate('2026-10-15'), f = E.forecastMonths(db, { today: '2026-10-15', months: 12 });
  assert.strictEqual(f.months.length, 12);
  assert.deepStrictEqual([f.months[0].start, f.months[0].end, f.months[0].month], ['2026-10-15', '2026-10-31', '2026-10']);
  assert.deepStrictEqual([f.months[3].start, f.months[3].end], ['2027-01-01', '2027-01-31']);
  assert.strictEqual(f.months[11].end, '2027-09-30');
  assert.strictEqual(f.months[0].beyond, false);
  assert.strictEqual(f.months[11].beyond, true);
  assert.strictEqual(E.forecastMonths(db, { today: '2026-10-15', months: 99 }).months.length, 24);
});

t('months: balances chain and add up, item by item', () => {
  for (const today of ['2026-10-15', '2027-02-28', '2026-12-31']) {
    const db = D.generate(today), f = E.forecastMonths(db, { today, months: 15 });
    let run = E.cashToday(db);
    f.months.forEach((m) => {
      near(m.opening, run, 'opening');
      const ins = m.items.filter((i) => i.kind === 'in').reduce((s, i) => s + i.amount, 0);
      const outs = m.items.filter((i) => i.kind === 'out').reduce((s, i) => s + i.amount, 0);
      near(ins, m.inTotal); near(outs, m.outTotal);
      near(m.closing, m.opening + ins - outs, 'closing');
      near(Object.values(m.in).reduce((s, v) => s + v, 0), m.inTotal, 'in by category');
      near(Object.values(m.out).reduce((s, v) => s + v, 0), m.outTotal, 'out by category');
      assert.ok(m.low <= m.closing + 1e-6);
      m.items.forEach((i) => assert.ok(i.date >= m.start && i.date <= m.end, i.label));
      run = m.closing;
    });
  }
});

t('months agree with the 13 weeks over the same days', () => {
  const today = '2026-10-05'; // a Monday, so the weeks start today
  const db = D.generate(today), w = E.forecast(db, { today }), m = E.forecastMonths(db, { today, months: 6 });
  const until = w.end, sumW = (k) => w.weeks.reduce((s, x) => s + x[k], 0);
  const sumM = (kind) => m.items.filter((i) => i.kind === kind && i.date <= until).reduce((s, i) => s + i.amount, 0);
  near(sumW('inTotal'), sumM('in'), 'receipts');
  near(sumW('outTotal'), sumM('out'), 'payments');
  // every open invoice that the weeks expect is in the months too, on the same date
  const wd = {}; w.items.filter((i) => i.src === 'ar').forEach((i) => { wd[i.id] = i.date; });
  m.items.filter((i) => i.src === 'ar' && wd[i.id]).forEach((i) => assert.strictEqual(i.date, wd[i.id]));
  // the run-rate lines keep going after the 13 weeks
  assert.ok(m.months[5].in.newsales > 0 && m.months[5].out.payroll > 0 && m.months[5].out.tax > 0);
});

t('scenarios move the months the same way as the weeks', () => {
  const today = '2026-10-15', db = D.generate(today);
  const b = E.forecastMonths(db, { today, scenario: E.SCENARIOS.base }), p = E.forecastMonths(db, { today, scenario: E.SCENARIOS.pessimistic });
  assert.ok(p.months[11].closing < b.months[11].closing);
});

t('demo: the open receivables are Collections\' open invoices on the same day', () => {
  for (const today of ['2026-10-15', '2027-03-02']) {
    const db = D.generate(today), c = CD.generate(today);
    assert.strictEqual(db.demoGen, 2);
    const open = c.invoices.map((i) => ({ i, o: CE.openAt(i, today) })).filter((x) => x.o > 0);
    const total = open.reduce((s, x) => s + x.o, 0), ours = db.ar.filter((a) => !a.paid);
    near(Math.round(ours.reduce((s, a) => s + a.amount, 0) * 100), Math.round(total * 100), 'open total');
    assert.strictEqual(ours.length, open.length);
    const byNo = {}; open.forEach((x) => { byNo[x.i.no] = x; });
    ours.forEach((a) => {
      const x = byNo[a.no]; assert.ok(x, 'invoice ' + a.no + ' is in Collections');
      assert.strictEqual(a.customerId, x.i.customerId);
      assert.strictEqual(a.due, x.i.dueDate);
      assert.strictEqual(a.disputed, !!x.i.disputed);
    });
    // the same customers, by name
    const names = (list) => list.map((x) => x.name).sort();
    assert.deepStrictEqual(names(db.customers), names(c.customers));
    // written-off invoices are not receivables any more
    c.invoices.filter((i) => i.writtenOff).forEach((i) => assert.ok(!db.ar.some((a) => a.no === i.no)));
  }
});

t('demo: promises to pay and the payment plan become expected dates', () => {
  const today = '2026-10-15', db = D.generate(today);
  const set = db.ar.filter((a) => a.expected);
  assert.ok(set.length > 0);
  set.forEach((a) => assert.ok(E.isDate(a.expected) && a.expected >= today));
  // and the story still holds: the base case dips below the minimum but stays above zero
  const f = E.forecast(db, { today });
  assert.ok(f.lowest.low < f.minCash && f.lowest.low > 0, 'low point ' + f.lowest.low);
});

t('demo: the older stand-alone generation is still reproducible', () => {
  const a = D.generateV1('2026-10-08'), b = D.generateV1('2026-10-08');
  assert.deepStrictEqual(a, b);
  assert.strictEqual(a.demoGen, undefined);
  assert.strictEqual(a.customers.length, 26);
  assert.deepStrictEqual(D.generate('2026-10-08'), D.generate('2026-10-08'));
});

console.log(n + ' tests passed');
