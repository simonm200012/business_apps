/* Customer service quality: NPS by queue / contact reason and the agent scorecard (plain functions; tests in
 * tools/tests/cs-quality-nps.test.js).
 * NPS = % promoters (9–10) − % detractors (0–6) of the e-mail survey. With few answers it swings a lot, so every group
 * carries its 95 % margin of error: 1,96 × √((p + d − (p − d)²) ÷ n) × 100 points (p, d = promoter and detractor shares).
 * Groups under MIN answers are shown but marked "few answers". */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CsNps = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const MIN = 30;
  function score(P, Pa, D) {
    const n = (P || 0) + (Pa || 0) + (D || 0);
    if (!n) return { n: 0, P: 0, Pa: 0, D: 0, nps: null, pro: null, det: null, moe: null, few: true };
    const p = P / n, d = D / n;
    return { n, P, Pa, D, pro: p, det: d, nps: Math.round(100 * (p - d)), moe: Math.round(196 * Math.sqrt(Math.max(0, p + d - (p - d) * (p - d)) / n)), few: n < MIN };
  }
  // rows: [{ promoters, passives, detractors, ... }] → groups by keyFn, largest first; keyFn returning null skips a row
  function group(rows, keyFn) {
    const m = new Map();
    (rows || []).forEach((r) => {
      const k = keyFn(r);
      if (k == null) return;
      const o = m.get(k) || { key: k, first: r, P: 0, Pa: 0, D: 0 };
      o.P += r.promoters || 0; o.Pa += r.passives || 0; o.D += r.detractors || 0;
      m.set(k, o);
    });
    return [...m.values()].map((o) => Object.assign({ key: o.key, first: o.first }, score(o.P, o.Pa, o.D))).sort((a, b) => b.n - a.n || String(a.key).localeCompare(String(b.key)));
  }
  // agent rows (summed over the period) → scorecard lines with rates; "flags" are things to talk about in coaching
  function agents(rows) {
    const list = (rows || []).map((r) => {
      const s = score(r.promoters, r.passives, r.detractors);
      return { market: r.market, agent: r.agent, answered: r.answered || 0, faAvg: r.answered ? r.fa_sum_s / r.answered : null, slaPct: r.answered ? r.sla_overdue / r.answered : null,
        reopenPct: r.answered ? r.reopened / r.answered : null, nps: s.nps, n: s.n, moe: s.moe, few: s.few, P: r.promoters || 0, Pa: r.passives || 0, D: r.detractors || 0 };
    });
    // compare each agent with the team of the same market (answered-weighted)
    const byM = {};
    list.forEach((a) => { const t = byM[a.market] || (byM[a.market] = { ans: 0, fa: 0, sla: 0, ro: 0, P: 0, Pa: 0, D: 0 }); t.P += a.P; t.Pa += a.Pa; t.D += a.D; t.ans += a.answered; t.fa += (a.faAvg || 0) * a.answered; t.sla += (a.slaPct || 0) * a.answered; t.ro += (a.reopenPct || 0) * a.answered; });
    list.forEach((a) => {
      const t = byM[a.market], f = [];
      if (t && t.ans && a.answered >= 20) {
        if (a.faAvg > 1.3 * (t.fa / t.ans)) f.push('slow first answers');
        if (a.slaPct > 1.4 * (t.sla / t.ans) && a.slaPct > 0.03) f.push('SLA misses');
        if (a.reopenPct > 1.4 * (t.ro / t.ans) && a.reopenPct > 0.03) f.push('reopened tickets');
      }
      const team = t ? score(t.P, t.Pa, t.D) : null;
      a.teamNps = team ? team.nps : null;
      if (!a.few && team && team.nps != null && a.nps < team.nps - Math.max(10, a.moe || 0)) f.push('low NPS');
      a.flags = f;
    });
    return list.sort((x, y) => x.market.localeCompare(y.market) || y.answered - x.answered);
  }
  return { MIN, score, group, agents };
});
