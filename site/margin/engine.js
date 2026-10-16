/* Margin guard: price waterfall and discount what-if (plain functions; tests in tools/tests/margin-engine.test.js).
 *
 * The API gives, per discount code, net revenue, margin and "expected_margin" = what the same projects and categories
 * earn without a code, applied to this code's revenue. The list-price value of a code's sales is estimated from that:
 * with the same goods (same cost) sold at the no-code margin m0, list = cost ÷ (1 − m0); the discount is list − net.
 * Free-delivery codes do not lower the price, so their list value is their net revenue.
 * Shipping, payment fees and ad spend are not in the sales data: they are the user's assumptions, as % of net revenue. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MarginEngine = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const fin = (x) => typeof x === 'number' && isFinite(x);
  const DEFAULTS = { shipPct: 2.5, feePct: 1.2, adPct: 4 }; // % of net revenue, editable in the app

  // estimated list-price value of one code row ({ code, revenue, margin, expected_margin }) of the given kind
  function listValue(row, kind) {
    const rev = row.revenue || 0;
    if (row.code === '(none)' || kind === 'Free delivery' || !(rev > 0)) return rev;
    const base = row.expected_margin / rev, cost = rev - row.margin;
    if (!fin(base) || base >= 1 || !(cost > 0)) return rev;
    return Math.max(rev, cost / (1 - base));
  }
  function assumptions(a) {
    const o = Object.assign({}, DEFAULTS);
    ['shipPct', 'feePct', 'adPct'].forEach((k) => { const v = a && Number(a[k]); if (fin(v) && v >= 0 && v <= 100) o[k] = v; });
    return o;
  }
  // rows: the codes endpoint rows (incl. "(none)"); kindOf(code) → 'Discount' | 'Free delivery'; a: assumptions in %
  function waterfall(rows, kindOf, a) {
    const A = assumptions(a);
    let list = 0, net = 0, margin = 0;
    const byCode = [];
    (rows || []).forEach((r) => {
      const kind = r.code === '(none)' ? '' : (kindOf ? kindOf(r.code) : 'Discount') || 'Discount';
      const L = listValue(r, kind);
      list += L; net += r.revenue || 0; margin += r.margin || 0;
      if (L - (r.revenue || 0) > 0.005) byCode.push({ code: r.code, kind, discount: L - r.revenue, list: L, revenue: r.revenue });
    });
    byCode.sort((x, y) => y.discount - x.discount);
    const cogs = net - margin, ship = net * A.shipPct / 100, fees = net * A.feePct / 100, ads = net * A.adPct / 100;
    const contribution = margin - ship - fees - ads;
    const steps = [
      { k: 'list', label: 'List price', short: 'List', value: list, total: true },
      { k: 'disc', label: 'Discount codes', short: 'Codes', value: -(list - net) },
      { k: 'net', label: 'Net revenue', short: 'Net', value: net, total: true },
      { k: 'cogs', label: 'Cost of goods', short: 'COGS', value: -cogs },
      { k: 'gm', label: 'Gross margin', short: 'Margin', value: margin, total: true },
      { k: 'ship', label: 'Shipping', short: 'Shipping', value: -ship, assumed: true },
      { k: 'fees', label: 'Payment fees', short: 'Fees', value: -fees, assumed: true },
      { k: 'ads', label: 'Ad spend', short: 'Ads', value: -ads, assumed: true },
      { k: 'contrib', label: 'Contribution margin', short: 'Contrib.', value: contribution, total: true },
    ];
    // running level for drawing: totals stand on zero, changes float from the previous level
    let level = 0;
    steps.forEach((s) => {
      if (s.total) { s.from = 0; s.to = s.value; level = s.value; } else { s.from = level; s.to = level + s.value; level = s.to; }
      s.ofList = list ? s.value / list : null;
      s.ofNet = net ? s.value / net : null;
    });
    return { steps, list, net, discount: list - net, cogs, margin, ship, fees, ads, contribution, A, byCode };
  }

  // What if a code gave d1 (0..0.9) instead of today's estimated discount, with sales volume changed by vol (−0.9..5)?
  // The goods sold stay the same mix: list value and cost scale with volume.
  function whatIf(row, kind, d1, vol) {
    const L = listValue(row, kind), C = (row.revenue || 0) - (row.margin || 0), R0 = row.revenue || 0, M0 = row.margin || 0;
    const v = fin(vol) ? Math.max(-0.9, Math.min(5, vol)) : 0, d = Math.max(0, Math.min(0.9, fin(d1) ? d1 : 0));
    const d0 = L > 0 ? 1 - R0 / L : 0;
    const R1 = L * (1 - d) * (1 + v), C1 = C * (1 + v), M1 = R1 - C1;
    const unit = L > 0 ? (1 - d) - C / L : null;          // margin per € of list value at the new discount
    const breakEven = unit > 0 && L > 0 && M0 > 0 ? M0 / (L * unit) - 1 : null; // volume change that keeps today's margin €
    return { list: L, cost: C, d0, d1: d, vol: v, revenue0: R0, margin0: M0, mpct0: R0 ? M0 / R0 : null, revenue1: R1, margin1: M1, mpct1: R1 ? M1 / R1 : null,
      dMargin: M1 - M0, dRevenue: R1 - R0, breakEven, noCodePct: R0 ? row.expected_margin / R0 : null };
  }
  return { DEFAULTS, listValue, assumptions, waterfall, whatIf };
});
