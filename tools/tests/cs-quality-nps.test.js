// Tests for site/cs-quality/nps.js (NPS by group, margin of error, agent scorecard). Run: node tools/tests/cs-quality-nps.test.js
'use strict';
const assert = require('assert');
const path = require('path');
const N = require(path.join(__dirname, '../../site/cs-quality/nps.js'));

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok', n, name); }

t('NPS and its 95 % margin of error', () => {
  const s = N.score(50, 30, 20);
  assert.strictEqual(s.n, 100); assert.strictEqual(s.nps, 30);
  // 1,96 × √((0,5 + 0,2 − 0,3²) ÷ 100) × 100 = 15,3
  assert.strictEqual(s.moe, 15);
  assert.strictEqual(s.few, false);
  assert.strictEqual(N.score(5, 0, 5).nps, 0);
  assert.strictEqual(N.score(3, 1, 0).few, true);
  assert.deepStrictEqual(N.score(0, 0, 0).nps, null);
  assert.strictEqual(N.score(10, 0, 0).moe, 0); // all promoters: no spread
  assert.strictEqual(N.score(0, 0, 7).nps, -100);
});

t('grouping by queue or reason', () => {
  const rows = [
    { market: 'SI', queue: 'A', ai_category: 'X', promoters: 3, passives: 1, detractors: 1 },
    { market: 'SI', queue: 'A', ai_category: null, promoters: 1, passives: 0, detractors: 2 },
    { market: 'HR', queue: 'B', ai_category: 'X', promoters: 10, passives: 0, detractors: 0 },
  ];
  const q = N.group(rows, (r) => r.market + '|' + r.queue);
  assert.deepStrictEqual(q.map((g) => [g.key, g.n, g.nps]), [['HR|B', 10, 100], ['SI|A', 8, 13]]);
  assert.strictEqual(q[1].first.queue, 'A');
  const r = N.group(rows, (x) => x.ai_category); // rows without a reason are skipped
  assert.deepStrictEqual(r.map((g) => [g.key, g.n]), [['X', 15]]);
  assert.deepStrictEqual(N.group([], () => 1), []);
});

t('agent scorecard: rates and flags against the own market team', () => {
  const base = { market: 'SI', fa_sum_s: 0, sla_overdue: 0, reopened: 0, promoters: 0, passives: 0, detractors: 0 };
  const rows = [
    Object.assign({}, base, { agent: 'A', answered: 100, fa_sum_s: 100 * 3600, sla_overdue: 2, reopened: 2, promoters: 30, passives: 10, detractors: 5 }),
    Object.assign({}, base, { agent: 'B', answered: 100, fa_sum_s: 100 * 3600, sla_overdue: 3, reopened: 2, promoters: 30, passives: 10, detractors: 5 }),
    Object.assign({}, base, { agent: 'C', answered: 100, fa_sum_s: 100 * 7200, sla_overdue: 10, reopened: 9, promoters: 10, passives: 10, detractors: 25 }),
    Object.assign({}, base, { market: 'HR', agent: 'D', answered: 10, fa_sum_s: 10 * 9000, sla_overdue: 5, reopened: 5, promoters: 1, passives: 0, detractors: 1 }),
  ];
  const L = N.agents(rows);
  assert.deepStrictEqual(L.map((a) => a.agent), ['D', 'A', 'B', 'C']); // by market, then most answered
  const c = L.find((a) => a.agent === 'C');
  assert.strictEqual(c.faAvg, 7200); assert.strictEqual(c.slaPct, 0.1); assert.strictEqual(c.reopenPct, 0.09);
  assert.deepStrictEqual(c.flags, ['slow first answers', 'SLA misses', 'reopened tickets', 'low NPS']);
  assert.deepStrictEqual(L.find((a) => a.agent === 'A').flags, []);
  assert.deepStrictEqual(L.find((a) => a.agent === 'D').flags, [], 'too few tickets and answers to flag');
  assert.strictEqual(c.teamNps, N.score(70, 30, 35).nps);
});

console.log(n + ' tests passed');
