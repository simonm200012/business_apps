/* Ads & Return: monthly budgets and pacing (plain functions, also run by tools/tests/ads-pacing.test.js).
 * A budget is set per market × platform × campaign type (the rows of "Budget pacing") for one calendar month.
 * Budgets are the user's own plan and are kept in this browser (localStorage "stratum-ads-budgets"); a month without
 * its own budgets uses the latest earlier month's, so a budget set once carries forward until it is changed. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AdsPacing = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const KEY = 'stratum-ads-budgets';
  const fin = (v) => typeof v === 'number' && isFinite(v);
  const rowKey = (r) => r.market + '|' + r.platform + '|' + r.area;
  const monthOf = (iso) => String(iso || '').slice(0, 7);

  function emptyStore() { return { v: 1, months: {} }; }
  // whatever is in storage, only well-formed budgets survive
  function clean(raw) {
    const out = emptyStore();
    if (!raw || typeof raw !== 'object' || !raw.months || typeof raw.months !== 'object') return out;
    Object.keys(raw.months).forEach((m) => {
      if (!/^\d{4}-\d{2}$/.test(m)) return;
      const src = raw.months[m], vals = {};
      if (!src || typeof src !== 'object') return;
      Object.keys(src).forEach((k) => { const v = src[k]; if (/^[^|]+\|[^|]+\|[^|]+$/.test(k) && fin(v) && v >= 0 && v < 1e9) vals[k] = Math.round(v * 100) / 100; });
      out.months[m] = vals;
    });
    return out;
  }
  function load(storage) {
    try { return clean(JSON.parse((storage || localStorage).getItem(KEY) || 'null')); } catch (e) { return emptyStore(); }
  }
  function save(store, storage) {
    try { (storage || localStorage).setItem(KEY, JSON.stringify(clean(store))); return true; } catch (e) { return false; }
  }
  // budgets that apply to a month: its own, else the latest earlier month's (carried forward)
  function budgetsFor(store, month) {
    if (store.months[month]) return { values: store.months[month], from: month, own: true };
    const earlier = Object.keys(store.months).filter((m) => m < month).sort();
    const m = earlier[earlier.length - 1];
    return m ? { values: store.months[m], from: m, own: false } : { values: {}, from: null, own: false };
  }
  // set (or clear with null) one row's budget for a month; carried budgets are copied in first so the other rows keep theirs
  function setBudget(store, month, key, value) {
    const next = clean(store), cur = budgetsFor(next, month);
    const vals = Object.assign({}, cur.values);
    if (value == null || value === '') delete vals[key]; else if (fin(value) && value >= 0) vals[key] = Math.round(value * 100) / 100;
    next.months[month] = vals;
    return next;
  }
  function setMany(store, month, values) {
    const next = clean(store);
    next.months[month] = Object.assign({}, budgetsFor(next, month).values, values);
    return clean(next);
  }
  function clearMonth(store, month) { const next = clean(store); delete next.months[month]; return next; }
  // a whole-euro suggestion from a reference spend (last month's), rounded up to 100 €
  const suggest = (x) => (fin(x) && x > 0 ? Math.ceil(x / 100) * 100 : 0);

  // Amounts as typed: "12.000", "12 000", "12000,50", "12,000.50", "12k" → number; '' → null; anything else → NaN
  function parseAmount(s) {
    let t = String(s == null ? '' : s).trim().replace(/[€\s ]/g, '').replace(/eur$/i, '');
    if (t === '') return null;
    let mult = 1;
    if (/k$/i.test(t)) { mult = 1000; t = t.slice(0, -1); }
    if (t.includes(',') && t.includes('.')) t = t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
    else if (t.includes(',')) t = /^\d{1,3}(,\d{3}){2,}$/.test(t) ? t.replace(/,/g, '') : t.replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
    if (!/^\d+(\.\d+)?$/.test(t)) return NaN;
    return Math.round(+t * mult * 100) / 100;
  }

  // Pacing of one row against its budget.
  //   expected = budget × days with data ÷ days in month (even spend), pace = spent ÷ expected,
  //   forecast = spent + last-7-days daily spend × days left, perDay = what can still be spent per remaining day.
  function pace(row, budget, dayOfMonth, daysInMonth) {
    const left = Math.max(0, daysInMonth - dayOfMonth);
    const forecast = row.mtd + (row.last7_daily || 0) * left;
    const o = { budget: fin(budget) && budget > 0 ? budget : null, mtd: row.mtd, forecast, daysLeft: left };
    if (!o.budget) return Object.assign(o, { expected: null, pace: null, used: null, vsBudget: null, remaining: null, perDay: null, status: 'none' });
    o.expected = o.budget * dayOfMonth / daysInMonth;
    o.pace = o.expected ? row.mtd / o.expected : null;
    o.used = row.mtd / o.budget;
    o.vsBudget = forecast / o.budget - 1;
    o.remaining = o.budget - row.mtd;
    o.perDay = left ? Math.max(0, o.remaining) / left : null;
    o.status = row.mtd >= o.budget ? 'spent' : o.vsBudget > 0.05 ? 'over' : o.vsBudget < -0.1 ? 'under' : 'ok';
    return o;
  }
  function totals(list) {
    const t = { budget: 0, mtd: 0, forecast: 0, expected: 0, withBudget: 0, budgetMtd: 0, budgetForecast: 0 };
    list.forEach((p) => {
      t.mtd += p.mtd; t.forecast += p.forecast;
      if (p.budget) { t.budget += p.budget; t.expected += p.expected; t.withBudget++; t.budgetMtd += p.mtd; t.budgetForecast += p.forecast; }
    });
    // totals compare only rows that have a budget, so a row without one does not look like overspend
    t.pace = t.expected ? t.budgetMtd / t.expected : null;
    t.used = t.budget ? t.budgetMtd / t.budget : null;
    t.vsBudget = t.budget ? t.budgetForecast / t.budget - 1 : null;
    return t;
  }
  return { KEY, rowKey, monthOf, emptyStore, clean, load, save, budgetsFor, setBudget, setMany, clearMonth, suggest, parseAmount, pace, totals };
});
