// Tests for site/ads/pacing.js (monthly budgets and pacing). Run: node tools/tests/ads-pacing.test.js
'use strict';
const assert = require('assert');
const path = require('path');
const P = require(path.join(__dirname, '../../site/ads/pacing.js'));

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok', n, name); }
function mem() { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, raw: m }; }

t('amounts as typed in Slovenia, Croatia or English', () => {
  assert.strictEqual(P.parseAmount('12.000'), 12000);
  assert.strictEqual(P.parseAmount('12 000 €'), 12000);
  assert.strictEqual(P.parseAmount('12000,50'), 12000.5);
  assert.strictEqual(P.parseAmount('1.234,56'), 1234.56);
  assert.strictEqual(P.parseAmount('12,000.50'), 12000.5);
  assert.strictEqual(P.parseAmount('1,5'), 1.5);
  assert.strictEqual(P.parseAmount('12k'), 12000);
  assert.strictEqual(P.parseAmount(''), null);
  assert.ok(Number.isNaN(P.parseAmount('-5')));
  assert.ok(Number.isNaN(P.parseAmount('abc')));
});

t('budgets carry forward to later months until changed', () => {
  let s = P.emptyStore();
  s = P.setBudget(s, '2026-09', 'SI|Google|E-commerce', 5000);
  s = P.setBudget(s, '2026-09', 'SI|Meta|E-commerce', 2000);
  const oct = P.budgetsFor(s, '2026-10');
  assert.deepStrictEqual(oct, { values: { 'SI|Google|E-commerce': 5000, 'SI|Meta|E-commerce': 2000 }, from: '2026-09', own: false });
  assert.deepStrictEqual(P.budgetsFor(s, '2026-08'), { values: {}, from: null, own: false });
  // changing one line in October copies the carried ones, September stays as it was
  s = P.setBudget(s, '2026-10', 'SI|Meta|E-commerce', 2500);
  assert.deepStrictEqual(P.budgetsFor(s, '2026-10').values, { 'SI|Google|E-commerce': 5000, 'SI|Meta|E-commerce': 2500 });
  assert.strictEqual(P.budgetsFor(s, '2026-09').values['SI|Meta|E-commerce'], 2000);
  s = P.setBudget(s, '2026-10', 'SI|Google|E-commerce', null);
  assert.deepStrictEqual(P.budgetsFor(s, '2026-10').values, { 'SI|Meta|E-commerce': 2500 });
  s = P.clearMonth(s, '2026-10');
  assert.strictEqual(P.budgetsFor(s, '2026-10').from, '2026-09');
});

t('storage keeps only well-formed budgets', () => {
  const st = mem();
  st.setItem(P.KEY, JSON.stringify({ v: 1, months: { '2026-10': { 'SI|Google|E-commerce': 100, bad: 5, 'HR|Meta|E-commerce': -3, 'IT|Google|E-commerce': 'x' }, nonsense: {} } }));
  assert.deepStrictEqual(P.load(st), { v: 1, months: { '2026-10': { 'SI|Google|E-commerce': 100 } } });
  st.setItem(P.KEY, '{broken');
  assert.deepStrictEqual(P.load(st), P.emptyStore());
  assert.ok(P.save(P.setBudget(P.emptyStore(), '2026-10', 'SI|Google|E-commerce', 1234.567), st));
  assert.strictEqual(P.load(st).months['2026-10']['SI|Google|E-commerce'], 1234.57);
});

t('pacing against a budget', () => {
  // 14 of 31 days, 3.000 € spent, 250 €/day lately, budget 6.200 €
  const p = P.pace({ mtd: 3000, last7_daily: 250 }, 6200, 14, 31);
  assert.strictEqual(p.expected, 6200 * 14 / 31);
  assert.ok(Math.abs(p.pace - 3000 / 2800) < 1e-9);
  assert.strictEqual(p.forecast, 3000 + 250 * 17);
  assert.ok(Math.abs(p.vsBudget - (7250 / 6200 - 1)) < 1e-9);
  assert.strictEqual(p.status, 'over');
  assert.strictEqual(p.perDay, 3200 / 17);
  assert.strictEqual(P.pace({ mtd: 3000, last7_daily: 170 }, 6200, 14, 31).status, 'ok'); // forecast 5.890 € = −5 %
  assert.strictEqual(P.pace({ mtd: 1000, last7_daily: 50 }, 6200, 14, 31).status, 'under');
  assert.strictEqual(P.pace({ mtd: 6300, last7_daily: 200 }, 6200, 14, 31).status, 'spent');
  const none = P.pace({ mtd: 100, last7_daily: 10 }, undefined, 14, 31);
  assert.strictEqual(none.status, 'none'); assert.strictEqual(none.forecast, 270); assert.strictEqual(none.budget, null);
  // last day of the month: nothing left to forecast, no per-day amount
  const last = P.pace({ mtd: 5000, last7_daily: 200 }, 6000, 31, 31);
  assert.strictEqual(last.forecast, 5000); assert.strictEqual(last.perDay, null);
});

t('totals compare only lines with a budget', () => {
  const a = P.pace({ mtd: 3000, last7_daily: 200 }, 6000, 15, 30), b = P.pace({ mtd: 1000, last7_daily: 100 }, null, 15, 30);
  const T = P.totals([a, b]);
  assert.strictEqual(T.budget, 6000); assert.strictEqual(T.mtd, 4000); assert.strictEqual(T.budgetMtd, 3000);
  assert.strictEqual(T.forecast, 3000 + 3000 + 1000 + 1500);
  assert.strictEqual(T.used, 0.5); assert.strictEqual(T.pace, 1);
  assert.strictEqual(T.vsBudget, 0);
  assert.strictEqual(P.totals([b]).vsBudget, null);
});

t('suggested budget rounds last month up to 100 €', () => {
  assert.strictEqual(P.suggest(6269.4), 6300);
  assert.strictEqual(P.suggest(6300), 6300);
  assert.strictEqual(P.suggest(0), 0);
  assert.strictEqual(P.rowKey({ market: 'SI', platform: 'Meta', area: 'Optics / retail' }), 'SI|Meta|Optics / retail');
  assert.strictEqual(P.monthOf('2026-10-14'), '2026-10');
});

console.log(n + ' tests passed');
