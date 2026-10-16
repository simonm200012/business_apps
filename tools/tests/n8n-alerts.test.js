// Tests for site/n8n/alerts.js: alert rules and run-time trends.
// Run: node tools/tests/n8n-alerts.test.js
'use strict';
const assert = require('assert');
const path = require('path');
const A = require(path.join(__dirname, '../../site/n8n/alerts.js'));

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok', n, name); }
const at = (day, h) => '2026-10-' + String(day).padStart(2, '0') + 'T' + String(h).padStart(2, '0') + ':00:00.000Z';
const run = (wf, day, h, status, o) => Object.assign({ workflow_id: wf, workflow_name: wf.toUpperCase(), kind: 'run', status, mode: 'trigger', started_at: at(day, h), expected_at: at(day, h), duration_s: 40 }, o || {});
const slot = (wf, day, h) => ({ workflow_id: wf, workflow_name: wf.toUpperCase(), kind: 'slot', status: 'missed', mode: null, started_at: null, expected_at: at(day, h), duration_s: null });

const RUNS = [
  run('a', 1, 6, 'success'), run('a', 2, 6, 'error', { error_node: 'Match payments' }), slot('a', 3, 6), run('a', 4, 6, 'crashed'), run('a', 5, 6, 'success'),
  run('b', 1, 2, 'success', { duration_s: 400 }), run('b', 2, 2, 'success', { duration_s: 410 }), run('b', 3, 2, 'success', { duration_s: 390 }),
  run('b', 4, 2, 'success', { duration_s: 420 }), run('b', 5, 2, 'success', { duration_s: 1300 }), run('b', 6, 2, 'running', { duration_s: null }),
  run('c', 1, 9, 'success', { mode: 'integrated' })
];

t('a failed run raises an alert per failure, with the node', () => {
  const al = A.evaluate([{ id: 'r1', workflow: '', kind: 'fail', on: true }], RUNS);
  assert.strictEqual(al.length, 2);
  assert.ok(al.every((x) => x.workflow_id === 'a'));
  assert.strictEqual(al[1].text, 'Run failed at Match payments');
  assert.ok(al[0].at > al[1].at, 'newest first');
});

t('missed slots, streaks (failed or missed in a row, reset by a success) and a workflow filter', () => {
  assert.strictEqual(A.evaluate([{ id: 'm', kind: 'miss' }], RUNS).length, 1);
  const s3 = A.evaluate([{ id: 's', kind: 'streak', n: 3 }], RUNS);
  assert.strictEqual(s3.length, 1);
  assert.strictEqual(s3[0].at, at(4, 6));
  assert.strictEqual(A.evaluate([{ id: 's', kind: 'streak', n: 4 }], RUNS).length, 0);
  assert.strictEqual(A.evaluate([{ id: 'f', kind: 'fail', workflow: 'b' }], RUNS).length, 0);
  assert.strictEqual(A.evaluate([{ id: 'f', kind: 'fail', on: false }], RUNS).length, 0, 'switched off');
});

t('slow runs: over the factor × the median of successful runs, needing five runs to know the usual', () => {
  const al = A.evaluate([{ id: 'sl', kind: 'slow', n: 3 }], RUNS);
  assert.strictEqual(al.length, 1);
  assert.strictEqual(al[0].workflow_id, 'b');
  assert.strictEqual(al[0].text, 'Took 1300 s, usually 410 s');
  assert.strictEqual(A.evaluate([{ id: 'sl', kind: 'slow', n: 4 }], RUNS).length, 0);
});

t('run-time trend: per-day medians, this week against the week before', () => {
  const runs = [];
  for (let d = 1; d <= 14; d++) for (let h = 0; h < 3; h++) runs.push(run('x', d, 6 + h, 'success', { duration_s: d <= 7 ? 40 + h : 60 + h }));
  runs.push(run('x', 14, 12, 'error', { duration_s: 5 }));
  const tr = A.trend(runs, '2026-10-15T00:00:00.000Z');
  assert.strictEqual(tr.series.length, 14);
  assert.strictEqual(tr.series[0].median, 41);
  assert.strictEqual(tr.series[13].max, 62);
  assert.strictEqual(tr.runs, 42, 'failed runs are left out');
  assert.strictEqual(tr.week, 61);
  assert.strictEqual(tr.prevWeek, 41);
  assert.ok(Math.abs(tr.change - 20 / 41) < 1e-9);
});

t('rule sentences and the default rules', () => {
  assert.strictEqual(A.describeRule({ kind: 'streak', n: 3, workflow: 'a' }, { a: 'Nightly stock sync' }), 'When 3 runs in a row fail or are missed in “Nightly stock sync”');
  assert.strictEqual(A.describeRule({ kind: 'fail', workflow: '' }), 'When a run fails in any workflow');
  assert.ok(A.DEFAULT_RULES.length >= 2 && A.DEFAULT_RULES.every((r) => A.KINDS[r.kind]));
});

console.log(n + ' tests passed');
