// Tests for site/cashflow/engine.js and data.js. Run: node tools/tests/cashflow-engine.test.js
'use strict';
const assert = require('assert');
const path = require('path');
const E = require(path.join(__dirname, '../../site/cashflow/engine.js'));
const D = require(path.join(__dirname, '../../site/cashflow/data.js'));

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok', n, name); }

t('isDate is strict', () => {
  assert.strictEqual(E.isDate('2026-10-08'), true);
  assert.strictEqual(E.isDate('2026-13-01'), false);
  assert.strictEqual(E.isDate('2026-02-29'), false);
  assert.strictEqual(E.isDate('2028-02-29'), true);
  assert.strictEqual(E.isDate('8.10.2026'), false);
});

t('mondayOf and working days', () => {
  assert.strictEqual(E.mondayOf('2026-10-08'), '2026-10-05'); // Thursday
  assert.strictEqual(E.mondayOf('2026-10-11'), '2026-10-05'); // Sunday
  assert.strictEqual(E.workdayOnOrAfter('2026-10-10'), '2026-10-12');
  assert.strictEqual(E.workdayOnOrBefore('2026-10-18'), '2026-10-16');
});

t('monthly rule: day 18 moved before a weekend', () => {
  const r = { freq: 'monthly', day: 18, shift: 'before', start: '2025-01-01' };
  assert.deepStrictEqual(E.occurrences(r, '2026-10-01', '2026-12-31'), ['2026-10-16', '2026-11-18', '2026-12-18']);
});

t('monthly rule: last working day', () => {
  const r = { freq: 'monthly', day: 0, start: '2025-01-01' };
  assert.deepStrictEqual(E.occurrences(r, '2026-10-01', '2026-12-31'), ['2026-10-30', '2026-11-30', '2026-12-31']);
});

t('monthly rule: day 31 in a 30-day month, moved after a weekend', () => {
  const r = { freq: 'monthly', day: 31, start: '2026-01-31' };
  assert.deepStrictEqual(E.occurrences(r, '2026-09-01', '2026-11-30'), ['2026-09-30', '2026-11-02', '2026-11-30']); // 31.10. is a Saturday
});

t('quarterly rule follows the start month', () => {
  const r = { freq: 'quarterly', day: 15, start: '2026-08-15' };
  assert.deepStrictEqual(E.occurrences(r, '2026-08-01', '2027-03-01'), ['2026-08-17', '2026-11-16', '2027-02-15']);
});

t('weekly rule with start and end', () => {
  const r = { freq: 'weekly', day: 3, start: '2026-10-08', end: '2026-10-28' };
  assert.deepStrictEqual(E.occurrences(r, '2026-10-01', '2026-12-31'), ['2026-10-14', '2026-10-21', '2026-10-28']);
});

t('expected receipt: behaviour, due dates, override, disputed, doubtful', () => {
  const c = { avgLate: 12 };
  const inv = { due: '2026-10-20' };
  assert.strictEqual(E.expectedReceipt(inv, c, '2026-10-08', 'behaviour', E.SCENARIOS.base).date, '2026-11-02'); // 1.11. is a Sunday
  assert.strictEqual(E.expectedReceipt(inv, c, '2026-10-08', 'due', E.SCENARIOS.base).date, '2026-10-20');
  assert.strictEqual(E.expectedReceipt(inv, c, '2026-10-08', 'behaviour', E.SCENARIOS.pessimistic).date, '2026-11-16');
  assert.strictEqual(E.expectedReceipt({ due: '2026-10-20', expected: '2026-12-01' }, c, '2026-10-08', 'behaviour').date, '2026-12-01');
  assert.strictEqual(E.expectedReceipt({ due: '2026-10-20', disputed: true }, c, '2026-10-08', 'behaviour').why, 'disputed');
  assert.strictEqual(E.expectedReceipt({ due: '2026-06-01' }, c, '2026-10-08', 'behaviour').why, 'doubtful');
  // already late: expected a few days after today, never in the past
  assert.ok(E.expectedReceipt({ due: '2026-09-20' }, c, '2026-10-08', 'behaviour').date > '2026-10-08');
});

t('payables: critical suppliers are not stretched, holds are left out', () => {
  const bill = { due: '2026-10-20' };
  const scn = E.clampScenario({ payDelay: 14 });
  assert.strictEqual(E.expectedPayment(bill, { critical: false }, '2026-10-08', scn).date, '2026-11-03');
  assert.strictEqual(E.expectedPayment(bill, { critical: true }, '2026-10-08', scn).date, '2026-10-20');
  assert.strictEqual(E.expectedPayment({ due: '2026-10-20', hold: true }, {}, '2026-10-08', scn).date, null);
});

t('generated data is deterministic and dips below the minimum in the base case', () => {
  const a = D.generate('2026-10-08'), b = D.generate('2026-10-08');
  assert.deepStrictEqual(a, b);
  const f = E.forecast(a, { today: '2026-10-08' });
  assert.strictEqual(f.weeks.length, 13);
  assert.ok(f.lowest.low < f.minCash && f.lowest.low > 0, 'low point between 0 and the minimum: ' + f.lowest.low);
  const fp = E.forecast(a, { today: '2026-10-08', scenario: E.SCENARIOS.pessimistic });
  assert.ok(fp.lowest.low < f.lowest.low);
  const fo = E.forecast(a, { today: '2026-10-08', scenario: E.SCENARIOS.optimistic });
  assert.ok(fo.lowest.low > f.lowest.low);
});

t('forecast arithmetic: each week closes at opening + receipts − payments, and chains', () => {
  for (const today of ['2026-10-08', '2027-02-27', '2026-12-31']) {
    const db = D.generate(today), f = E.forecast(db, { today });
    let run = E.cashToday(db);
    f.weeks.forEach((w) => {
      assert.ok(Math.abs(w.opening - run) < 1e-6);
      const ins = w.items.filter((i) => i.kind === 'in').reduce((s, i) => s + i.amount, 0);
      const outs = w.items.filter((i) => i.kind === 'out').reduce((s, i) => s + i.amount, 0);
      assert.ok(Math.abs(ins - w.inTotal) < 1e-6 && Math.abs(outs - w.outTotal) < 1e-6);
      assert.ok(Math.abs(w.closing - (w.opening + ins - outs)) < 1e-6);
      assert.ok(w.low <= w.closing + 1e-6);
      w.items.forEach((i) => assert.ok(i.date >= today && i.date >= w.start && i.date <= w.end, i.label + ' ' + i.date));
      run = w.closing;
    });
  }
});

t('remedies: the gap equals the minimum minus the low point', () => {
  const db = D.generate('2026-10-08'), f = E.forecast(db, { today: '2026-10-08' }), r = E.remedies(db, f);
  assert.ok(Math.abs(r.gap - (f.minCash - f.lowest.low)) < 1e-6);
  assert.ok(r.list.some((x) => x.id === 'chase'));
  assert.ok(r.list.every((x) => x.amount > 0));
});

console.log(n + ' tests passed');
