// Tests for site/team-tasks/recur.js: Slovenian working days and the recurring-deadline rules.
// Run: node tools/tests/team-tasks-recur.test.js
'use strict';
const assert = require('assert');
const path = require('path');
const R = require(path.join(__dirname, '../../site/team-tasks/recur.js'));

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok', n, name); }

t('Easter and Slovenian holidays', () => {
  assert.strictEqual(R.easter(2026), '2026-04-05');
  assert.strictEqual(R.easter(2027), '2027-03-28');
  const h = R.holidaysSI(2026);
  ['2026-01-01', '2026-01-02', '2026-02-08', '2026-04-06', '2026-04-27', '2026-05-01', '2026-05-02', '2026-06-25', '2026-08-15', '2026-10-31', '2026-11-01', '2026-12-25', '2026-12-26']
    .forEach((d) => assert.ok(h[d], d));
  assert.ok(!R.isWorkday('2026-04-06'));
  assert.ok(!R.isWorkday('2026-10-17')); // Saturday
  assert.ok(R.isWorkday('2026-10-15'));
  assert.strictEqual(R.nextWorkday('2026-12-25'), '2026-12-28');
  assert.strictEqual(R.prevWorkday('2026-11-01'), '2026-10-30');
});

t('DDV-O: last working day of the month after the period', () => {
  assert.strictEqual(R.dueFor({ rule: 'ddvo', period: '2026-09' }), '2026-10-30'); // 31. 10. is a Saturday and a holiday
  assert.strictEqual(R.dueFor({ rule: 'ddvo', period: '2026-11' }), '2026-12-31');
  assert.strictEqual(R.dueFor({ rule: 'ddvo', period: '2026-12' }), '2027-01-29');
  assert.strictEqual(R.dueFor({ rule: 'ddvo', period: '2026-04' }), '2026-05-29');
  assert.strictEqual(R.dueFor({ rule: 'ddvo', period: '2027-03' }), '2027-04-30');
});

t('RP-O: the 20th of the next month, or the next working day', () => {
  assert.strictEqual(R.dueFor({ rule: 'rpo', period: '2026-08' }), '2026-09-21'); // 20. 9. 2026 is a Sunday
  assert.strictEqual(R.dueFor({ rule: 'rpo', period: '2026-09' }), '2026-10-20');
});

t('REK-1: on payday; a weekend or holiday payday moves to the working day before', () => {
  assert.strictEqual(R.dueFor({ rule: 'rek1', period: '2026-09', day: 15 }), '2026-10-15');
  assert.strictEqual(R.dueFor({ rule: 'rek1', period: '2026-10', day: 15 }), '2026-11-13'); // 15. 11. is a Sunday
  assert.strictEqual(R.dueFor({ rule: 'rek1', period: '2026-07', day: 15 }), '2026-08-14'); // 15. 8. is a holiday (Saturday)
  assert.strictEqual(R.dueFor({ rule: 'rek1', period: '2027-01', day: 18 }), '2027-02-18');
});

t('DDPO and the annual report: 31 March, or the next working day', () => {
  assert.strictEqual(R.dueFor({ rule: 'ddpo', period: '2025' }), '2026-03-31');
  assert.strictEqual(R.dueFor({ rule: 'ddpo', period: '2026' }), '2027-03-31');
  assert.strictEqual(R.dueFor({ rule: 'ddpo', period: '2027' }), '2028-03-31');
  assert.strictEqual(R.dueFor({ rule: 'ddpo', period: '2028' }), '2029-04-03'); // 31. 3. 2029 is a Saturday, 2. 4. Easter Monday
});

t('generic rules: weekly, monthly on a day (short months, holidays) and the last working day', () => {
  assert.strictEqual(R.dueFor({ rule: 'weekly', period: '2026-10-15' }), '2026-10-15');
  assert.strictEqual(R.next({ rule: 'weekly', period: '2026-10-15' }).period, '2026-10-22');
  assert.strictEqual(R.dueFor({ rule: 'monthly', period: '2026-02', day: 31 }), '2026-03-02'); // 31 → 28. 2., a Saturday → Monday
  assert.strictEqual(R.dueFor({ rule: 'monthly', period: '2026-06', day: 25 }), '2026-06-26'); // Statehood Day
  assert.strictEqual(R.dueFor({ rule: 'monthEnd', period: '2026-05' }), '2026-05-29');
});

t('starting a rule from a day picks the first due date on or after it', () => {
  const a = R.start('ddvo', '2026-10-15');
  assert.deepStrictEqual(a, { rule: 'ddvo', period: '2026-09' });
  assert.strictEqual(R.dueFor(a), '2026-10-30');
  assert.strictEqual(R.start('ddvo', '2026-10-31').period, '2026-10');
  const b = R.start('rek1', '2026-10-16');
  assert.strictEqual(b.day, 15);
  assert.strictEqual(R.dueFor(b), '2026-11-13');
  assert.strictEqual(R.start('ddpo', '2026-10-15').period, '2026');
  assert.strictEqual(R.start('monthly', '2026-10-15').day, 15);
  assert.strictEqual(R.dueFor(R.start('monthly', '2026-10-15')), '2026-10-15');
  assert.strictEqual(R.dueFor(R.start('monthEnd', '2026-10-15')), '2026-10-30');
  assert.strictEqual(R.start('nope', '2026-10-15'), null);
});

t('the next period and its title, across the year end', () => {
  const r = { rule: 'ddvo', period: '2026-12' };
  assert.strictEqual(R.titleFor(r), 'Oddaj DDV-O za december 2026');
  const nx = R.next(r);
  assert.strictEqual(nx.period, '2027-01');
  assert.strictEqual(R.titleFor(nx), 'Oddaj DDV-O za januar 2027');
  assert.strictEqual(R.dueFor(nx), '2027-02-26');
  assert.strictEqual(R.titleFor(R.next({ rule: 'ddpo', period: '2026' })), 'DDPO in letno poročilo AJPES za 2027');
  assert.strictEqual(R.titleFor({ rule: 'rek1', period: '2026-09' }, 'Payroll {period}'), 'Payroll september 2026');
  assert.strictEqual(R.describe({ rule: 'rek1', day: 10 }), 'REK-1 and salaries (payday 10.)');
});

console.log(n + ' tests passed');
