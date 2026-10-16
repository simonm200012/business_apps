/* Portal usage & speed: app names and the monthly cloud budget forecast. Pure functions, no DOM; UMD, so they load in
 * Node (tools/tests/hub-usage-budget.test.js).
 *   appName(id)          the app's name as on the Business Apps home page (folder ids stay in CSVs and links)
 *   forecast(o)          spent so far this month, the run rate and the month-end forecast against a budget in € */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.UsageLib = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var NAMES = {
    'mail': 'Tokovi Mail', 'erp': 'ERP', 'crm': 'CRM', 'analytics': 'Analytics', 'invoices': 'Invoices', 'billing': 'Billing', 'desk': 'Desk',
    'ads': 'Ads & Return', 'margin': 'Margin guard', 'refill': 'Refill & win-back', 'webshop': 'Webshop conversion health', 'cs-quality': 'Customer service quality',
    'parcels': 'Parcels & COD', 'recon': 'Payment reconciliation', 'stores': 'Store daily board', 'onboarding': 'Joiners & leavers', 'contracts': 'Contracts & renewals',
    'marketing': 'Marketing calendar', 'team-tasks': 'Team Tasks', 'branch-manager': 'Branch Manager', 'client-atlas': 'ERP & BI Client Atlas', 'pisarna-dms': 'Pisarna DMS Demo',
    'postbench': 'Postbench', 'design-compare': 'Design Comparison', 'showcase': 'Tokovi (showcase)', 'n8n': 'n8n Runs', 'portal-usage': 'Portal usage & speed',
    'cashflow': 'Cash forecast', 'collections': 'Collections', 'budget': 'Budget vs actual', 'leave': 'Time & leave', 'datacheck': 'Data health check', 'service': 'Service jobs',
    '(portal platform)': 'Portal platform'
  };
  function appName(id) { return NAMES[id] || id || ''; }

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function toUtc(s) { return Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)); }
  function addDays(s, n) { var d = new Date(toUtc(s) + n * 864e5); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function diff(a, b) { return Math.round((toUtc(b) - toUtc(a)) / 864e5); }
  function monthEnd(ym) { return ym + '-' + pad(new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate()); }

  /** o: { days: [{ date, cost }] (USD, several rows per day allowed), through: last day with billing data, month: 'YYYY-MM'
   *  (the month to forecast, usually today's), budget: € a month, rate: € per US$, window: days for the run rate (14) }
   *  The run rate is the average of the last `window` days up to `through` (two weekends in it), so the forecast is
   *  spent so far + run rate × the days still to come in the month. */
  function forecast(o) {
    var ym = o.month, start = ym + '-01', end = monthEnd(ym), win = o.window || 14, rate = +o.rate > 0 ? +o.rate : 1, budget = +o.budget > 0 ? +o.budget : 0;
    var through = o.through, byDay = {};
    (o.days || []).forEach(function (r) { byDay[r.date] = (byDay[r.date] || 0) + (+r.cost || 0); });
    var spent = 0, d;
    for (d = start; d <= end && d <= through; d = addDays(d, 1)) spent += byDay[d] || 0;
    var w0 = addDays(through, -(win - 1)), recent = 0;
    for (d = w0; d <= through; d = addDays(d, 1)) recent += byDay[d] || 0;
    var avg = recent / win;
    var lastKnown = through < start ? addDays(start, -1) : through > end ? end : through;
    var left = Math.max(0, diff(lastKnown, end)), daysIn = diff(start, end) + 1;
    var fUsd = spent + avg * left;
    var r2 = function (x) { return Math.round(x * 100) / 100; };
    var out = { month: ym, from: start, to: end, through: through, daysIn: daysIn, daysLeft: left, daysKnown: daysIn - left,
      spentUsd: r2(spent), spentEur: r2(spent * rate), avgEur: r2(avg * rate), forecastUsd: r2(fUsd), forecastEur: r2(fUsd * rate), budget: budget, rate: rate,
      pctSpent: budget ? spent * rate / budget : null, pctForecast: budget ? fUsd * rate / budget : null };
    out.overBy = budget ? r2(Math.max(0, out.forecastEur - budget)) : 0;
    out.status = !budget ? 'none' : out.spentEur > budget ? 'over' : out.forecastEur > budget ? 'forecastOver' : out.forecastEur > budget * 0.9 ? 'warn' : 'ok';
    // the budget alert thresholds Google Cloud uses by default, on actual spend
    out.crossed = budget ? [0.5, 0.9, 1].filter(function (t) { return out.spentEur >= budget * t; }) : [];
    return out;
  }
  return { NAMES: NAMES, appName: appName, forecast: forecast, monthEnd: monthEnd };
});
