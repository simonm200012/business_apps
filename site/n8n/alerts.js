/* n8n Runs: alert rules and run-time trends. Pure functions, no DOM; UMD, so they load in Node
 * (tools/tests/n8n-alerts.test.js).
 *   evaluate(rules, runs)      → the alerts the rules would have raised on these runs (newest first)
 *   trend(runs, now)           → run-time trend of one workflow's successful runs: per-day medians, this week vs the week before
 *   describeRule(rule, names)  → a sentence for the rule list
 * A run is { workflow_id, workflow_name, kind: 'run'|'slot', status, mode, started_at, expected_at, duration_s }.
 * The demo page keeps the rules in this browser; a connected version would send the alerts by e-mail or to Teams. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.N8nAlerts = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var KINDS = {
    fail: 'a run fails',
    miss: 'a scheduled run is missed',
    streak: 'several runs in a row fail or are missed',
    slow: 'a run takes much longer than usual'
  };
  function t(r) { return Date.parse(r.started_at || r.expected_at || 0) || 0; }
  function bad(r) { return r.status === 'error' || r.status === 'crashed'; }
  function median(a) { if (!a.length) return null; var b = a.slice().sort(function (x, y) { return x - y; }), m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; }
  function q(a, p) { if (!a.length) return null; var b = a.slice().sort(function (x, y) { return x - y; }); return b[Math.min(b.length - 1, Math.floor(p * b.length))]; }

  /** rules: [{ id, workflow ('' = every workflow), kind, n (streak length, or the slow factor), on (bool) }] */
  function evaluate(rules, runs) {
    var out = [], byWf = {};
    (runs || []).forEach(function (r) { (byWf[r.workflow_id] = byWf[r.workflow_id] || []).push(r); });
    Object.keys(byWf).forEach(function (k) { byWf[k].sort(function (a, b) { return t(a) - t(b); }); });
    (rules || []).forEach(function (rule) {
      if (rule.on === false || !KINDS[rule.kind]) return;
      Object.keys(byWf).forEach(function (wid) {
        if (rule.workflow && rule.workflow !== wid) return;
        var list = byWf[wid];
        if (rule.kind === 'fail') list.forEach(function (r) { if (r.kind === 'run' && bad(r)) out.push({ rule: rule.id, kind: 'fail', workflow_id: wid, workflow_name: r.workflow_name, at: r.started_at, text: 'Run failed' + (r.error_node ? ' at ' + r.error_node : '') }); });
        if (rule.kind === 'miss') list.forEach(function (r) { if (r.status === 'missed') out.push({ rule: rule.id, kind: 'miss', workflow_id: wid, workflow_name: r.workflow_name, at: r.expected_at, text: 'Scheduled run missed' }); });
        if (rule.kind === 'streak') {
          var need = Math.max(2, +rule.n || 3), run = 0;
          list.forEach(function (r) {
            if (r.status === 'running' || r.status === 'due' || r.mode === 'integrated') return;
            if (bad(r) || r.status === 'missed') { run++; if (run === need) out.push({ rule: rule.id, kind: 'streak', workflow_id: wid, workflow_name: r.workflow_name, at: r.started_at || r.expected_at, text: need + ' failed or missed runs in a row' }); }
            else if (r.status === 'success') run = 0;
          });
        }
        if (rule.kind === 'slow') {
          var f = +rule.n > 1 ? +rule.n : 2, ok = list.filter(function (r) { return r.kind === 'run' && r.status === 'success' && r.duration_s != null; }), med = median(ok.map(function (r) { return +r.duration_s; }));
          if (med == null || ok.length < 5) return;
          ok.forEach(function (r) { if (+r.duration_s > f * med && +r.duration_s - med >= 5) out.push({ rule: rule.id, kind: 'slow', workflow_id: wid, workflow_name: r.workflow_name, at: r.started_at, text: 'Took ' + Math.round(r.duration_s) + ' s, usually ' + Math.round(med) + ' s' }); });
        }
      });
    });
    return out.sort(function (a, b) { return (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0); });
  }

  /** run time of one workflow's successful runs: per local day (date string from dayOf) the median, plus this week vs the week before */
  function trend(runs, now, dayOf) {
    dayOf = dayOf || function (iso) { return String(iso).slice(0, 10); };
    var ok = (runs || []).filter(function (r) { return r.kind === 'run' && r.status === 'success' && r.duration_s != null && r.started_at; });
    var days = {}, wk = [], prev = [], n = Date.parse(now) || Date.now();
    ok.forEach(function (r) {
      var d = dayOf(r.started_at), ts = Date.parse(r.started_at), age = (n - ts) / 864e5;
      (days[d] = days[d] || []).push(+r.duration_s);
      if (age < 7) wk.push(+r.duration_s); else if (age < 14) prev.push(+r.duration_s);
    });
    var series = Object.keys(days).sort().map(function (d) { return { day: d, median: median(days[d]), max: Math.max.apply(null, days[d]), runs: days[d].length }; });
    var a = median(wk), b = median(prev);
    return { series: series, median: median(ok.map(function (r) { return +r.duration_s; })), p95: q(ok.map(function (r) { return +r.duration_s; }), 0.95),
      week: a, prevWeek: b, change: a != null && b ? (a - b) / b : null, runs: ok.length };
  }
  function describeRule(rule, names) {
    var who = rule.workflow ? '“' + ((names && names[rule.workflow]) || rule.workflow) + '”' : 'any workflow';
    var what = rule.kind === 'streak' ? Math.max(2, +rule.n || 3) + ' runs in a row fail or are missed' : rule.kind === 'slow' ? 'a run takes over ' + (+rule.n > 1 ? +rule.n : 2) + '× its usual time' : KINDS[rule.kind];
    return 'When ' + what + ' in ' + who;
  }
  var DEFAULT_RULES = [
    { id: 'r1', workflow: '', kind: 'fail', n: 0, on: true, notify: 'teams' },
    { id: 'r2', workflow: '', kind: 'streak', n: 3, on: true, notify: 'email' },
    { id: 'r3', workflow: '', kind: 'slow', n: 3, on: false, notify: 'teams' }
  ];
  return { KINDS: KINDS, evaluate: evaluate, trend: trend, describeRule: describeRule, median: median, DEFAULT_RULES: DEFAULT_RULES };
});
