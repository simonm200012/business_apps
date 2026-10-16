// Tests for site/margin/engine.js (price waterfall and discount what-if). Run: node tools/tests/margin-engine.test.js
'use strict';
const assert = require('assert');
const path = require('path');
const E = require(path.join(__dirname, '../../site/margin/engine.js'));

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok', n, name); }
const near = (a, b, eps) => assert.ok(Math.abs(a - b) < (eps || 1e-6), a + ' ≈ ' + b);

// A code sold goods with list value 1.000 € at 20 % off: net 800 €, cost 500 € (no-code margin 50 %).
const CODE = { code: 'SPRING20', revenue: 800, margin: 300, expected_margin: 400 };
const NONE = { code: '(none)', revenue: 2000, margin: 1000, expected_margin: 1000 };
const SHIP = { code: 'FREESHIP', revenue: 500, margin: 200, expected_margin: 250 };

t('list value from the no-code margin', () => {
  near(E.listValue(CODE, 'Discount'), 1000);
  assert.strictEqual(E.listValue(NONE, ''), 2000);
  assert.strictEqual(E.listValue(SHIP, 'Free delivery'), 500); // free delivery does not lower the price
  assert.strictEqual(E.listValue({ code: 'X', revenue: 0, margin: 0, expected_margin: 0 }, 'Discount'), 0);
  // a code that earns more than the baseline never gets a list value below its revenue
  assert.strictEqual(E.listValue({ code: 'X', revenue: 100, margin: 60, expected_margin: 40 }, 'Discount'), 100);
  // a broken baseline (≥ 100 %) falls back to the revenue
  assert.strictEqual(E.listValue({ code: 'X', revenue: 100, margin: 10, expected_margin: 120 }, 'Discount'), 100);
});

t('waterfall from list price to contribution', () => {
  const kind = (c) => (c === 'FREESHIP' ? 'Free delivery' : 'Discount');
  const W = E.waterfall([NONE, CODE, SHIP], kind, { shipPct: 3, feePct: 1, adPct: 5 });
  near(W.list, 3500); near(W.net, 3300); near(W.discount, 200); near(W.cogs, 1800); near(W.margin, 1500);
  near(W.ship, 99); near(W.fees, 33); near(W.ads, 165); near(W.contribution, 1500 - 99 - 33 - 165);
  assert.deepStrictEqual(W.steps.map((s) => s.k), ['list', 'disc', 'net', 'cogs', 'gm', 'ship', 'fees', 'ads', 'contrib']);
  // the bars chain: each change starts where the previous one ended, totals stand on zero
  const S = W.steps;
  for (let i = 1; i < S.length; i++) if (!S[i].total) near(S[i].from, S[i - 1].to);
  near(S[2].to, S[1].to); near(S[4].to, S[3].to); near(S[8].to, S[7].to);
  near(S[1].ofList, -200 / 3500); near(S[2].ofNet, 1);
  assert.deepStrictEqual(W.byCode.map((c) => c.code), ['SPRING20']);
  assert.ok(S[5].assumed && S[6].assumed && S[7].assumed && !S[3].assumed);
});

t('assumptions: defaults and limits', () => {
  assert.deepStrictEqual(E.assumptions({}), E.DEFAULTS);
  assert.deepStrictEqual(E.assumptions({ shipPct: '4', feePct: -1, adPct: 200 }), { shipPct: 4, feePct: E.DEFAULTS.feePct, adPct: E.DEFAULTS.adPct });
  const W = E.waterfall([], null, null);
  assert.strictEqual(W.list, 0); assert.strictEqual(W.steps[0].ofList, null);
});

t('what-if: same discount changes nothing', () => {
  const x = E.whatIf(CODE, 'Discount', 0.2, 0);
  near(x.d0, 0.2); near(x.revenue1, 800); near(x.margin1, 300); near(x.dMargin, 0); near(x.breakEven, 0);
  near(x.noCodePct, 0.5);
});

t('what-if: a smaller discount, a bigger one, and volume', () => {
  const lower = E.whatIf(CODE, 'Discount', 0.1, 0);
  near(lower.revenue1, 900); near(lower.margin1, 400); near(lower.mpct1, 400 / 900);
  near(lower.breakEven, 300 / 400 - 1); // a quarter fewer sales still keep 300 €
  const higher = E.whatIf(CODE, 'Discount', 0.3, 0);
  near(higher.margin1, 200); near(higher.breakEven, 0.5); // needs 50 % more sales
  const vol = E.whatIf(CODE, 'Discount', 0.3, 0.5);
  near(vol.revenue1, 1050); near(vol.margin1, 300); near(vol.dMargin, 0);
  const loss = E.whatIf(CODE, 'Discount', 0.6, 0); // price below cost
  near(loss.margin1, -100); assert.strictEqual(loss.breakEven, null);
  assert.strictEqual(E.whatIf({ code: 'X', revenue: 100, margin: -5, expected_margin: 30 }, 'Discount', 0.1, 0).breakEven, null);
  near(E.whatIf(CODE, 'Discount', 2, 0).d1, 0.9); // clamped
});

console.log(n + ' tests passed');
