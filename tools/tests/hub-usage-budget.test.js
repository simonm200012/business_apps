// Tests for site/hub-usage/usage-lib.js: app names and the monthly budget forecast in €.
// Run: node tools/tests/hub-usage-budget.test.js
'use strict';
const assert = require('assert');
const path = require('path');
const U = require(path.join(__dirname, '../../site/hub-usage/usage-lib.js'));

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok', n, name); }
function days(from, to, usd, services) {
  const out = [];
  for (let d = new Date(from + 'T00:00:00Z'); d <= new Date(to + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    (services || ['Cloud Run']).forEach((s, k) => out.push({ date: iso, service: s, cost: typeof usd === 'function' ? usd(iso, k) : usd / (services || [1]).length }));
  }
  return out;
}

t('app names as on the home page, folder ids for anything unknown', () => {
  assert.strictEqual(U.appName('cs-quality'), 'Customer service quality');
  assert.strictEqual(U.appName('portal-usage'), 'Portal usage & speed');
  assert.strictEqual(U.appName('leave'), 'Time & leave');
  assert.strictEqual(U.appName('service'), 'Service jobs');
  assert.strictEqual(U.appName('something-new'), 'something-new');
  ['cashflow', 'collections', 'budget', 'leave', 'datacheck', 'service'].forEach((id) => assert.notStrictEqual(U.appName(id), id, id));
});

t('forecast: spent so far + 14-day run rate × days left, in € at the rate', () => {
  // October 2026, data through the 13th, 30 US$ a day → spent 390 US$; 18 days left → forecast 930 US$
  const f = U.forecast({ days: days('2026-09-20', '2026-10-13', 30, ['Cloud Run', 'BigQuery']), through: '2026-10-13', month: '2026-10', budget: 900, rate: 0.9 });
  assert.strictEqual(f.daysIn, 31);
  assert.strictEqual(f.daysLeft, 18);
  assert.strictEqual(f.daysKnown, 13);
  assert.strictEqual(f.spentUsd, 390);
  assert.strictEqual(f.spentEur, 351);
  assert.strictEqual(f.avgEur, 27);
  assert.strictEqual(f.forecastUsd, 930);
  assert.strictEqual(f.forecastEur, 837);
  assert.strictEqual(f.status, 'warn'); // 93 % of the budget
  assert.strictEqual(f.overBy, 0);
  assert.deepStrictEqual(f.crossed, []);
});

t('forecast over the budget, and already over', () => {
  const d = days('2026-09-20', '2026-10-20', (iso) => (iso >= '2026-10-07' ? 50 : 20));
  const f = U.forecast({ days: d, through: '2026-10-20', month: '2026-10', budget: 800, rate: 1 });
  assert.strictEqual(f.spentEur, 6 * 20 + 14 * 50); // 1.–6. at 20, 7.–20. at 50
  assert.strictEqual(f.avgEur, 50);
  assert.strictEqual(f.forecastEur, 820 + 11 * 50);
  assert.strictEqual(f.status, 'over');
  assert.deepStrictEqual(f.crossed, [0.5, 0.9, 1]);
  const g = U.forecast({ days: d, through: '2026-10-20', month: '2026-10', budget: 1300, rate: 1 });
  assert.strictEqual(g.status, 'forecastOver');
  assert.strictEqual(g.overBy, 70);
});

t('the first days of a month: no billing rows yet, the whole month is forecast from the run rate', () => {
  const f = U.forecast({ days: days('2026-09-17', '2026-09-30', 10), through: '2026-09-30', month: '2026-10', budget: 400, rate: 1 });
  assert.strictEqual(f.spentEur, 0);
  assert.strictEqual(f.daysLeft, 31);
  assert.strictEqual(f.forecastEur, 310);
  assert.strictEqual(f.status, 'ok');
  assert.strictEqual(U.monthEnd('2028-02'), '2028-02-29');
});

t('no budget: no status, no percentages', () => {
  const f = U.forecast({ days: [], through: '2026-10-13', month: '2026-10', budget: 0, rate: 0.92 });
  assert.strictEqual(f.status, 'none');
  assert.strictEqual(f.pctForecast, null);
});

console.log(n + ' tests passed');
