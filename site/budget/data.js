/* Budget vs actual demo data (Business Apps). Every company, person and amount is fictional.
 * generate(today) builds the year's P&L of Nordvik Distribucija d.o.o. (the Cash forecast company: wholesale of heating,
 * plumbing and electrical supplies in Ljubljana, about €13M of revenue a year) on a demo chart of accounts:
 *   - last year's actuals per account and month, with HVAC seasonality (heating peaks Sep–Nov, air conditioning
 *     May–Jul, January and August are quiet);
 *   - the budget, approved on 15 December of last year: last year × growth, plus a Croatian sales rep from April,
 *     a spring marketing push and an ERP project in the second half;
 *   - this year's actuals for every closed month, with deviations that need explaining (wet summer in Slovenia,
 *     Croatia ahead, a supplier price increase from May, a hiring delay, the ERP project starting early, fuel prices);
 *   - the Q2 reforecast made in early July (Q1 in April when July is not closed yet), and comments on earlier months.
 * Months are generated one by one from their own seed, so the same month always has the same numbers, whatever the
 * day the data is made; extend() adds months that close later. UMD, so it also loads in Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.BudgetData = factory(root.BudgetEngine);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';
  var VERSION = 1;
  var GRACE = 10; // days after month end before a month counts as closed

  function rng(seed) {
    var a = seed >>> 0;
    var f = function () { a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    f.norm = function () { var u = 0, v = 0; while (u === 0) u = f(); while (v === 0) v = f(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    return f;
  }
  function seedOf() { // FNV-1a over the arguments
    var s = Array.prototype.join.call(arguments, '|'), h = 0x811C9DC5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  }
  function norm12(a) { var s = a.reduce(function (x, y) { return x + y; }, 0); return a.map(function (x) { return x * 12 / s; }); }
  function cents(euros) { return Math.round(euros * 100); }
  function euros(c) { return Math.round(c / 100) * 100; } // whole euros, in cents
  function add(a, b) { return a.map(function (x, i) { return x + (b[i] || 0); }); }
  function lineTotal(arr) { return E.total(arr); }

  var COMPANY = { name: 'Nordvik Distribucija d.o.o.', short: 'Nordvik', what: 'Wholesale of heating, plumbing and electrical supplies', city: 'Ljubljana', currency: 'EUR' };
  var PEOPLE = {
    controller: 'Maja Kovač', cfo: 'Tomaž Zupan', salesHr: 'Ivana Horvat', logistics: 'Rok Novak'
  };

  // Seasonal shapes, average 1.
  var S = {
    flat: norm12([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]),
    heat: norm12([0.85, 0.75, 0.70, 0.60, 0.55, 0.55, 0.60, 0.60, 1.35, 1.75, 1.65, 1.00]),
    ac: norm12([0.20, 0.30, 0.60, 1.20, 2.00, 2.40, 2.20, 1.10, 0.60, 0.40, 0.30, 0.20]),
    plumb: norm12([0.70, 0.85, 1.05, 1.10, 1.10, 1.10, 1.05, 0.70, 1.10, 1.15, 1.05, 0.75]),
    elec: norm12([0.75, 0.90, 1.05, 1.05, 1.05, 1.05, 1.00, 0.70, 1.10, 1.15, 1.10, 0.95]),
    exp: norm12([0.80, 0.85, 1.00, 0.95, 0.95, 0.95, 0.90, 0.65, 1.15, 1.30, 1.30, 1.05]),
    winter: norm12([1.55, 1.40, 1.15, 0.90, 0.70, 0.60, 0.60, 0.60, 0.75, 1.00, 1.30, 1.45]),
    workdays: norm12([1.05, 0.95, 1.05, 1.00, 1.00, 1.00, 1.00, 0.85, 1.05, 1.05, 1.00, 0.95]),
    tyres: norm12([0.8, 0.7, 0.9, 1.7, 0.9, 0.8, 0.8, 0.7, 0.8, 1.0, 1.7, 0.8]),
    vignette: norm12([2.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8]),
    adv: norm12([0.6, 0.7, 1.3, 1.4, 1.2, 0.9, 0.7, 0.5, 1.3, 1.4, 1.2, 0.8]),
    fairs: norm12([0.1, 0.1, 6, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 3.5, 0.1, 1.8]),
    catalogue: norm12([0.4, 4.5, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 3.0, 0.4, 0.4, 0.4]),
    audit: norm12([0.4, 0.4, 3.2, 3.0, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 2.6]),
    abroad: norm12([0.6, 0.8, 1.6, 1.0, 1.0, 0.8, 0.6, 0.3, 1.2, 1.8, 1.4, 0.9]),
    member: norm12([3.0, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8]),
    creditline: norm12([0.6, 0.6, 0.7, 0.8, 0.9, 1.0, 1.0, 1.0, 1.3, 1.5, 1.4, 1.2])
  };

  // The demo chart of accounts: model code, name, line, model. Model: s = seasonal shape, py = last year's total in
  // euros, g = planned growth, sd = month-to-month noise; drv = computed from other accounts (see monthValues).
  // The model codes are the first demo's own; SI_CODE below gives each one its account on the Slovenian chart.
  var CHART = [
    ['7600', 'Sales of goods — Slovenia, heating', 'sales_si', { s: 'heat', py: 2800000, g: 1.046, sd: 0.02 }],
    ['7601', 'Sales of goods — Slovenia, plumbing', 'sales_si', { s: 'plumb', py: 2050000, g: 1.046, sd: 0.02 }],
    ['7602', 'Sales of goods — Slovenia, electrical', 'sales_si', { s: 'elec', py: 1850000, g: 1.046, sd: 0.02 }],
    ['7603', 'Sales of goods — Slovenia, air conditioning', 'sales_si', { s: 'ac', py: 1050000, g: 1.05, sd: 0.03 }],
    ['7609', 'Customer rebates — Slovenia', 'sales_si', { drv: 'rebates' }],
    ['7610', 'Sales of goods — Croatia, heating', 'sales_hr', { s: 'heat', py: 1250000, g: 1.06, sd: 0.035 }],
    ['7611', 'Sales of goods — Croatia, plumbing and electrical', 'sales_hr', { s: 'plumb', py: 1100000, g: 1.06, sd: 0.035 }],
    ['7612', 'Sales of goods — Croatia, air conditioning', 'sales_hr', { s: 'ac', py: 600000, g: 1.06, sd: 0.045 }],
    ['7620', 'Sales of goods — Austria and Italy', 'sales_eu', { s: 'exp', py: 1100000, g: 1.06, sd: 0.04 }],
    ['7621', 'Sales of goods — other EU countries', 'sales_eu', { s: 'exp', py: 500000, g: 1.06, sd: 0.05 }],
    ['7680', 'Rental income (sublet warehouse space)', 'other_inc', { s: 'flat', py: 60000, g: 1, sd: 0 }],
    ['7685', 'Gains on sale of fixed assets', 'other_inc', { drv: 'gains' }],
    ['7690', 'Other operating income', 'other_inc', { s: 'flat', py: 42000, g: 1, sd: 0.2 }],
    ['4000', 'Cost of goods sold — heating', 'cogs', { drv: 'cogs', cat: 'heat' }],
    ['4001', 'Cost of goods sold — plumbing', 'cogs', { drv: 'cogs', cat: 'plumb' }],
    ['4002', 'Cost of goods sold — electrical', 'cogs', { drv: 'cogs', cat: 'elec' }],
    ['4003', 'Cost of goods sold — air conditioning', 'cogs', { drv: 'cogs', cat: 'ac' }],
    ['4005', 'Inventory write-downs and shrinkage', 'cogs', { drv: 'writedown' }],
    ['4009', 'Supplier volume rebates', 'cogs', { drv: 'suprebates' }],
    ['4100', 'Inbound freight and customs', 'freight', { drv: 'freight', pct: 0.0102 }],
    ['4110', 'Outbound deliveries (carriers)', 'freight', { drv: 'freight', pct: 0.0098 }],
    ['4120', 'Packaging materials', 'freight', { drv: 'freight', pct: 0.002 }],
    ['4200', 'Gross salaries', 'personnel', { s: 'flat', py: 1000000, g: 1.045, sd: 0.006 }],
    ['4210', 'Employer social security contributions', 'personnel', { drv: 'contrib' }],
    ['4220', 'Meal and commuting allowances', 'personnel', { s: 'workdays', py: 92000, g: 1.045, sd: 0.02 }],
    ['4230', 'Holiday allowance and bonuses', 'personnel', { drv: 'bonus' }],
    ['4240', 'Training and other staff costs', 'personnel', { s: 'flat', py: 18000, g: 1.05, sd: 0.3 }],
    ['4300', 'Warehouse rent', 'rent', { drv: 'rent' }],
    ['4310', 'Utilities (electricity, heating, water)', 'rent', { s: 'winter', py: 58000, g: 1.03, sd: 0.06 }],
    ['4320', 'Cleaning and security', 'rent', { s: 'flat', py: 21600, g: 1.03, sd: 0 }],
    ['4330', 'Maintenance of premises', 'rent', { s: 'flat', py: 14000, g: 1.03, sd: 0.4 }],
    ['4400', 'Vehicle leases (9 vans)', 'vehicles', { s: 'flat', py: 112560, g: 1, sd: 0 }],
    ['4410', 'Fuel', 'vehicles', { drv: 'fuel', py: 64000 }],
    ['4420', 'Vehicle maintenance and tyres', 'vehicles', { s: 'tyres', py: 22000, g: 1.04, sd: 0.15 }],
    ['4430', 'Tolls and vignettes', 'vehicles', { s: 'vignette', py: 8400, g: 1.04, sd: 0.05 }],
    ['4500', 'Advertising and digital', 'marketing', { s: 'adv', py: 52000, g: 1.03, sd: 0.12 }],
    ['4510', 'Trade fairs and events', 'marketing', { s: 'fairs', py: 30000, g: 1.03, sd: 0.08 }],
    ['4520', 'Catalogues and promotional material', 'marketing', { s: 'catalogue', py: 16000, g: 1.03, sd: 0.1 }],
    ['4600', 'Software licences and subscriptions', 'it', { drv: 'licences' }],
    ['4610', 'IT services and support', 'it', { s: 'flat', py: 32000, g: 1.03, sd: 0.15 }],
    ['4620', 'ERP project (external consulting)', 'it', { drv: 'erp' }],
    ['4650', 'Audit and tax advice', 'prof', { s: 'audit', py: 22000, g: 1.04, sd: 0.1 }],
    ['4660', 'Legal services', 'prof', { s: 'flat', py: 12000, g: 1.04, sd: 0.45 }],
    ['4670', 'Consulting and other services', 'prof', { s: 'flat', py: 14000, g: 1.04, sd: 0.35 }],
    ['4700', 'Business travel — domestic', 'travel', { s: 'flat', py: 12000, g: 1.05, sd: 0.25 }],
    ['4710', 'Business travel — abroad', 'travel', { s: 'abroad', py: 16000, g: 1.05, sd: 0.2 }],
    ['4750', 'Property and stock insurance', 'insurance', { s: 'flat', py: 30000, g: 1.04, sd: 0 }],
    ['4760', 'Liability and credit insurance', 'insurance', { s: 'flat', py: 16000, g: 1.04, sd: 0 }],
    ['4800', 'Office supplies and postage', 'other_cost', { s: 'flat', py: 14000, g: 1.03, sd: 0.2 }],
    ['4810', 'Telephone and internet', 'other_cost', { s: 'flat', py: 18000, g: 1.03, sd: 0.04 }],
    ['4820', 'Bank charges and card fees', 'other_cost', { drv: 'bank', py: 10000 }],
    ['4830', 'Fees, memberships and other costs', 'other_cost', { s: 'member', py: 10000, g: 1.03, sd: 0.15 }],
    ['4850', 'Depreciation — warehouse building and racking', 'da', { s: 'flat', py: 118000, g: 1.03, sd: 0 }],
    ['4860', 'Depreciation — vehicles and forklifts', 'da', { s: 'flat', py: 58000, g: 1.05, sd: 0 }],
    ['4870', 'Amortisation — software', 'da', { s: 'flat', py: 24000, g: 1.06, sd: 0 }],
    ['7700', 'Interest income', 'fin', { s: 'flat', py: 3000, g: 0.9, sd: 0.3 }],
    ['4900', 'Interest on the term loan', 'fin', { drv: 'loan' }],
    ['4910', 'Interest on the credit line and other financing costs', 'fin', { s: 'creditline', py: 9500, g: 0.95, sd: 0.12 }]
  ];
  var MODEL = {};
  CHART.forEach(function (c) { MODEL[c[0]] = c[3]; });

  // The demo accounts on the Slovenian chart of accounts for companies (Kontni okvir za gospodarske družbe, SRS 2016,
  // Slovenski inštitut za revizijo): 4-digit analytic accounts under the 3-digit synthetic accounts of class 4 (costs
  // by nature) and class 7 (expenses and income). The groups used:
  //   402 energy · 404 packaging · 405 office supplies · 411 transport services · 412 maintenance · 413 rents ·
  //   414 reimbursed travel · 415 bank charges and insurance premiums · 416 intellectual services · 417 fairs,
  //   advertising · 419 other services · 430/431/432 amortisation (intangibles, buildings, equipment) ·
  //   470 salaries · 473 holiday allowance, reimbursements and other labour costs · 474 employer contributions ·
  //   489 other costs · 702 cost of goods sold · 722 revaluation expenses on current assets (stock write-downs) ·
  //   742 finance costs on financial liabilities (interest) · 760 sales of services · 762 sales of goods at home ·
  //   763 sales of goods abroad · 768 other operating income · 769 revaluation operating income (gains on disposals) ·
  //   771 finance income from loans and deposits.
  // CHECK with an accountant: the analytic codes (4th digit) are this demo's own, and the 3-digit numbering of
  // labour costs (47x) differs slightly between versions of the chart.
  var SI_CODE = {
    7600: '7620', 7601: '7621', 7602: '7622', 7603: '7623', 7609: '7629', 7610: '7630', 7611: '7631', 7612: '7632',
    7620: '7635', 7621: '7636', 7680: '7600', 7685: '7690', 7690: '7680',
    4000: '7020', 4001: '7021', 4002: '7022', 4003: '7023', 4005: '7220', 4009: '7029',
    4100: '4110', 4110: '4111', 4120: '4040',
    4200: '4700', 4210: '4740', 4220: '4732', 4230: '4730', 4240: '4739',
    4300: '4130', 4310: '4020', 4320: '4190', 4330: '4120',
    4400: '4131', 4410: '4021', 4420: '4121', 4430: '4191',
    4500: '4170', 4510: '4171', 4520: '4172',
    4600: '4192', 4610: '4193', 4620: '4160',
    4650: '4161', 4660: '4162', 4670: '4163',
    4700: '4140', 4710: '4141', 4750: '4150', 4760: '4151',
    4800: '4050', 4810: '4194', 4820: '4152', 4830: '4890',
    4850: '4310', 4860: '4320', 4870: '4300',
    7700: '7710', 4900: '7420', 4910: '7421'
  };
  var CHART_ID = 'si-2016';
  function siCodes(vals) { var o = {}; Object.keys(vals).forEach(function (k) { o[SI_CODE[k] || k] = vals[k]; }); return o; }

  // Gross margin by product group last year, and what changed this year: a supplier price increase on heating and
  // plumbing from May, air-conditioning stock cleared at lower prices from June.
  var MARGIN = { heat: 0.289, plumb: 0.309, elec: 0.279, ac: 0.259 };
  function marginCy(cat, m) {
    var x = MARGIN[cat];
    if (m >= 5 && cat === 'heat') x -= 0.010;
    if (m >= 5 && cat === 'plumb') x -= 0.008;
    if (m >= 6 && cat === 'ac') x -= 0.008;
    return x;
  }
  // which sales feed which cost-of-goods account (Croatian plumbing+electrical and export sales are split)
  var COGS_BASE = {
    heat: [['7600', 1], ['7610', 1], ['7620', 0.5], ['7621', 0.5]],
    plumb: [['7601', 1], ['7611', 0.5], ['7620', 0.25], ['7621', 0.25]],
    elec: [['7602', 1], ['7611', 0.5], ['7620', 0.25], ['7621', 0.25]],
    ac: [['7603', 1], ['7612', 1]]
  };
  var GROSS_SALES = ['7600', '7601', '7602', '7603', '7610', '7611', '7612', '7620', '7621'];
  var SALES_PY_MONTH = 12300000 / 12; // average gross sales a month last year, for volume-driven costs

  // This year's initiatives, in euros a month (Jan..Dec).
  var REP_BUDGET = [0, 0, 0, 15000, 25000, 30000, 35000, 25000, 40000, 45000, 40000, 35000]; // Croatian sales rep from April
  var REP_ACTUAL = [0, 0, 0, 0, 0, 12000, 30000, 25000, 42000, 46000, 42000, 36000];         // ...who started in June
  var HIRES_BUDGET = [0, 9000, 12600, 17800, 17800, 17800, 17800, 17800, 17800, 17800, 17800, 17800]; // 3 warehouse from Feb, coordinator from Mar, rep from Apr
  var HIRES_ACTUAL = [0, 0, 0, 0, 9200, 18200, 18200, 18200, 18200, 18200, 18200, 18200];           // warehouse from May, the other two from June
  var OVERTIME = [0, 0, 0, 0, 0, 5200, 6800, 7400, 5600, 3000, 2000, 1500];                          // catching up in the season
  var PUSH_BUDGET = [0, 0, 14000, 7000, 4000, 0, 0, 0, 0, 0, 0, 0];                                // spring marketing push
  var PUSH_ACTUAL = [0, 0, 22400, 6600, 3100, 0, 0, 0, 0, 0, 0, 0];                                // the fair stand cost more
  var ERP_BUDGET = [0, 0, 0, 0, 0, 0, 8000, 8000, 8000, 8000, 8000, 8000];                         // ERP project in H2
  var ERP_ACTUAL = [0, 0, 0, 0, 13600, 15200, 12900, 9800, 14300, 12500, 11000, 9000];            // ...started in May
  var HR_STORY = [1, 1, 1, 1, 1.13, 1.17, 1.14, 1.11, 1.13, 1.08, 1.06, 1.05];   // coastal hotel projects
  var AC_SI_STORY = [1, 1, 1, 1, 1, 0.85, 0.66, 0.62, 0.95, 1, 1, 1];             // wet summer
  var SI_STORY = [1, 1, 1, 1, 1, 1, 0.965, 0.94, 0.99, 1, 1, 1];              // the rest of Slovenia, a little soft
  var FREIGHT_STORY = [1, 1, 1.11, 1.12, 1.12, 1.13, 1.12, 1.12, 1.12, 1.1, 1.1, 1.1]; // fuel prices from March
  var FUEL_STORY = [1, 1, 1.09, 1.1, 1.1, 1.11, 1.1, 1.1, 1.1, 1.08, 1.08, 1.08];

  /** One month of actuals for every account (model codes), in cents. cy = this year's story; otherwise last year. */
  function modelValues(year, m, cy) {
    var i = m - 1, out = {}, r = {};
    function noise(code, sd) {
      if (!sd) return 1;
      var g = r[code] || (r[code] = rng(seedOf('nordvik', year, m, code)));
      return 1 + Math.max(-2.5, Math.min(2.5, g.norm())) * sd;
    }
    function plain(code) {
      var md = MODEL[code], v = md.py * S[md.s][i] / 12;
      if (cy) v *= md.g;
      return v * noise(code, md.sd);
    }
    // sales
    GROSS_SALES.forEach(function (code) {
      var v = plain(code);
      if (cy) {
        if (code === '7603') v *= AC_SI_STORY[i];
        else if (code === '7600' || code === '7601' || code === '7602') v *= SI_STORY[i];
        if (code === '7610' || code === '7611' || code === '7612') {
          v *= HR_STORY[i];
          var md = MODEL[code], share = md.py * S[md.s][i] / (MODEL['7610'].py * S.heat[i] + MODEL['7611'].py * S.plumb[i] + MODEL['7612'].py * S.ac[i]);
          v += REP_ACTUAL[i] * share;
        }
      }
      out[code] = cents(v);
    });
    var siGross = out['7600'] + out['7601'] + out['7602'] + out['7603'];
    out['7609'] = -cents(siGross / 100 * 0.026 * noise('7609', 0.04));
    var gross = GROSS_SALES.reduce(function (s, c) { return s + out[c]; }, 0) / 100;
    out['7680'] = cents(plain('7680'));
    out['7690'] = cents(plain('7690'));
    var gains = 0;
    if (!cy && m === 5) gains = 11400;
    if (!cy && m === 11) gains = 6600;
    if (cy && m === 3) gains = 6850;
    out['7685'] = cents(gains);
    // cost of goods
    var cogsSum = 0;
    Object.keys(COGS_BASE).forEach(function (cat, k) {
      var base = COGS_BASE[cat].reduce(function (s, p) { return s + out[p[0]] * p[1]; }, 0) / 100;
      var mg = cy ? marginCy(cat, m) : MARGIN[cat];
      var v = base * (1 - mg) * noise('40' + k + 'x', 0.006);
      out['400' + k] = cents(v);
      cogsSum += v;
    });
    var wd = { 6: 0.45, 12: 0.4 }[m] || 0.015;
    out['4005'] = cents(40000 * wd * (cy ? 1.04 : 1) * noise('4005', 0.15));
    out['4009'] = -cents(cogsSum * 0.014 * noise('4009', 0.05));
    // freight
    CHART.forEach(function (c) {
      if (c[3].drv === 'freight') out[c[0]] = cents(gross * c[3].pct * (cy ? 1.02 * FREIGHT_STORY[i] : 1) * noise(c[0], 0.04));
    });
    // personnel
    var sal = plain('4200');
    if (cy && m < 4) sal /= MODEL['4200'].g; // the wage increase budgeted from January was agreed for April
    if (cy) {
      var hires = HIRES_ACTUAL[i] + OVERTIME[i];
      sal += hires * 0.79;
    }
    out['4200'] = cents(sal);
    // employer contributions: 16,10 %, and 17,10 % from July 2025 with the long-term care contribution (ZDOsk-1)
    out['4210'] = cents(sal * (cy || m >= 7 ? 0.171 : 0.161));
    var allow = plain('4220');
    if (cy) allow += (HIRES_ACTUAL[i] + OVERTIME[i] * 0.2) * 0.06;
    out['4220'] = cents(allow);
    var bonus = m === 6 ? 58000 : m === 12 ? 52000 : 0;
    if (cy) bonus *= m === 6 ? 1.07 : 1.05;
    out['4230'] = cents(bonus);
    out['4240'] = cents(plain('4240'));
    // rent and facilities
    out['4300'] = cents(cy ? 26400 : 25800);
    ['4310', '4320', '4330'].forEach(function (c) { out[c] = cents(plain(c)); });
    // vehicles
    out['4400'] = cents(plain('4400'));
    out['4410'] = cents(64000 / 12 * (gross / SALES_PY_MONTH) * (cy ? FUEL_STORY[i] : 1) * noise('4410', 0.05));
    out['4420'] = cents(plain('4420'));
    out['4430'] = cents(plain('4430'));
    // marketing
    out['4500'] = cents(plain('4500'));
    out['4510'] = cents(plain('4510') + (cy ? PUSH_ACTUAL[i] : 0));
    out['4520'] = cents(plain('4520'));
    // IT
    out['4600'] = cents((m === 1 ? (cy ? 18400 : 17800) : 0) + (cy ? 1900 : 1850) * noise('4600', 0.03));
    out['4610'] = cents(plain('4610'));
    out['4620'] = cents(cy ? ERP_ACTUAL[i] * noise('4620', 0.03) : 0);
    // the rest
    ['4650', '4660', '4670', '4700', '4710', '4750', '4760', '4800', '4810', '4830', '4850', '4860', '4870', '7700', '4910'].forEach(function (c) { out[c] = cents(plain(c)); });
    out['4820'] = cents(10000 / 12 * (gross / SALES_PY_MONTH) * (cy ? 1.02 : 1) * noise('4820', 0.05));
    // term loan: €1.2M over five years, the balance and the interest fall every month; rates came down this year
    var k = (cy ? 12 : 0) + i, rate = cy ? 0.0415 : 0.0445;
    out['4900'] = cents((1200000 - 17600 * (k + 14)) * rate / 12);
    return out;
  }

  /** One month of actuals for every account on the Slovenian chart (legacy: the first demo's codes), in cents. */
  function monthValues(year, m, cy, legacy) { var v = modelValues(year, m, cy); return legacy ? v : siCodes(v); }
  /** Build every account's 12 months from monthValues (months 1..upto; the rest stay zero). */
  function yearActuals(year, upto, cy) {
    var acts = {};
    CHART.forEach(function (c) { acts[SI_CODE[c[0]]] = E.zeros(); });
    for (var m = 1; m <= upto; m++) {
      var mv = monthValues(year, m, cy);
      Object.keys(mv).forEach(function (code) { acts[code][m - 1] = mv[code]; });
    }
    return acts;
  }
  function accountsList() {
    return CHART.map(function (c) { var code = SI_CODE[c[0]]; return { code: code, name: c[1], line: c[2], kind: E.kindFromCode(code) }; });
  }
  function eurosArr(a) { return a.map(function (x) { return cents(x); }); }

  /** The approved budget, built with the same tools the app offers (whole euros). */
  function buildBudget(py) {
    var B = {};
    B.sales_si = E.spreadSeasonal(euros(lineTotal(py.sales_si) * 1.046), py.sales_si, 100);
    B.sales_hr = add(E.spreadSeasonal(euros(lineTotal(py.sales_hr) * 1.06), py.sales_hr, 100), eurosArr(REP_BUDGET));
    B.sales_eu = E.spreadSeasonal(euros(lineTotal(py.sales_eu) * 1.06), py.sales_eu, 100);
    B.other_inc = E.spreadEven(euros(lineTotal(py.other_inc)), 12, 100);
    var rev = E.zeros().map(function (x, i) { return B.sales_si[i] + B.sales_hr[i] + B.sales_eu[i] + B.other_inc[i]; });
    var pyRev = lineTotal(py.sales_si) + lineTotal(py.sales_hr) + lineTotal(py.sales_eu) + lineTotal(py.other_inc);
    var cogsPct = Math.round(lineTotal(py.cogs) / pyRev * 1000) / 10; // last year's cost of goods % of revenue
    B.cogs = E.pctOf(rev, cogsPct, 100);
    B.freight = E.pctOf(rev, 2.2, 100);
    B.personnel = add(E.copyGrowth(py.personnel, 4.5, 100), eurosArr(HIRES_BUDGET.map(function (x) { return x * (0.79 * 1.171 + 0.06); })).map(function (x) { return euros(x); }));
    B.rent = E.copyGrowth(py.rent, 2.5, 100);
    B.vehicles = E.copyGrowth(py.vehicles, 4, 100);
    B.marketing = add(E.copyGrowth(py.marketing, 3, 100), eurosArr(PUSH_BUDGET));
    B.it = add(E.copyGrowth(py.it, 3, 100), eurosArr(ERP_BUDGET));
    B.prof = E.copyGrowth(py.prof, 4, 100);
    B.travel = E.copyGrowth(py.travel, 5, 100);
    B.insurance = E.copyGrowth(py.insurance, 4, 100);
    B.other_cost = E.copyGrowth(py.other_cost, 3, 100);
    B.da = E.spreadEven(euros(lineTotal(py.da) * 1.04), 12, 100);
    B.fin = E.spreadEven(euros(lineTotal(py.fin) * 0.92), 12, 100);
    return { values: B, cogsPct: cogsPct };
  }

  /** The reforecast after quarter q: actual lines for months 1..3q, the budget revised for the rest (whole euros). */
  function buildForecast(act, bud, q) {
    var from = q * 3, F = {};
    E.LINES.forEach(function (l) { F[l.id] = bud[l.id].slice(); });
    var adj = {
      sales_si: q >= 2 ? [1, 1, 1, 1, 1, 1, 0.94, 0.95, 0.97, 0.99, 1, 1] : null,
      sales_hr: q >= 2 ? [1, 1, 1, 1, 1, 1, 1.07, 1.09, 1.08, 1.06, 1.05, 1.05] : [1, 1, 1, 0.75, 0.85, 1, 1.02, 1.02, 1.02, 1.02, 1.02, 1.02],
      freight: [1, 1, 1, 1.08, 1.08, 1.08, 1.1, 1.1, 1.1, 1.1, 1.1, 1.1],
      personnel: q >= 2 ? [1, 1, 1, 1, 1, 1, 1.03, 1.035, 1.03, 1.02, 1.01, 1.01] : [1, 1, 1, 0.9, 0.93, 1, 1, 1, 1, 1, 1, 1],
      it: q >= 2 ? null : null
    };
    Object.keys(adj).forEach(function (id) {
      if (!adj[id]) return;
      for (var i = from; i < 12; i++) F[id][i] = euros(bud[id][i] * adj[id][i]);
    });
    if (q >= 2) for (var i = from; i < 12; i++) F.it[i] = bud.it[i] + cents([0, 0, 0, 0, 0, 0, 4500, 2000, 5500, 4500, 3000, 1000][i]);
    // cost of goods follows the revised revenue, at the margin seen since the supplier price increase
    var rows = E.rowsOf(F), budRows = E.rowsOf(bud);
    for (i = from; i < 12; i++) {
      var pct = budRows.cogs[i] / budRows.rev[i] + (q >= 2 ? 0.007 : 0.002);
      F.cogs[i] = euros(rows.rev[i] * pct);
    }
    var out = E.makeForecast(act, F, from);
    E.LINES.forEach(function (l) { out[l.id] = out[l.id].map(function (x) { return x + 0; }); });
    return out;
  }

  // Comments already written for earlier months: line, month, scope, status, author, text, and the same text in
  // Slovenian and Croatian for the board pack.
  var NOTES = [
    ['marketing', 3, 'month', 'explained', 'controller', 'The spring trade fair stand cost more than quoted: a bigger stand and extra AV equipment. The rest of the spring campaign ran to plan.',
      'Razstavni prostor na spomladanskem sejmu je stal več od ponudbe: večji prostor in dodatna AV oprema. Preostanek spomladanske kampanje je potekal po načrtu.',
      'Izložbeni prostor na proljetnom sajmu stajao je više od ponude: veći prostor i dodatna AV oprema. Ostatak proljetne kampanje odvijao se prema planu.'],
    ['other_inc', 3, 'month', 'explained', 'controller', 'One-off gain on the sale of an old forklift. It will not repeat.',
      'Enkraten dobiček od prodaje starega viličarja. Ne bo se ponovil.',
      'Jednokratni dobitak od prodaje starog viličara. Neće se ponoviti.'],
    ['personnel', 2, 'month', 'explained', 'cfo', 'Hiring delay: the three warehouse hires planned for February start in May. The 4,5 % wage increase was budgeted from January but agreed for April.',
      'Zamik zaposlitev: trije skladiščniki, načrtovani za februar, začnejo maja. Povišanje plač za 4,5 % je bilo v planu od januarja, dogovorjeno pa je od aprila.',
      'Kašnjenje zapošljavanja: tri skladištara planirana za veljaču počinju u svibnju. Povećanje plaća od 4,5 % bilo je planirano od siječnja, a dogovoreno je od travnja.'],
    ['personnel', 3, 'month', 'explained', 'cfo', 'Same as February, and the sales-support coordinator planned for March has not started yet.',
      'Enako kot februarja; poleg tega koordinator prodajne podpore, načrtovan za marec, še ni začel z delom.',
      'Isto kao u veljači; uz to koordinator prodajne podrške planiran za ožujak još nije počeo raditi.'],
    ['personnel', 4, 'month', 'explained', 'controller', 'The Croatian sales rep and the coordinator start in June, the warehouse hires in May. The wage increase is paid from this month.',
      'Prodajni zastopnik za Hrvaško in koordinator začneta junija, skladiščniki maja. Povišanje plač se izplačuje od tega meseca.',
      'Prodajni predstavnik za Hrvatsku i koordinator počinju u lipnju, skladištari u svibnju. Povećanje plaća isplaćuje se od ovog mjeseca.'],
    ['sales_hr', 5, 'month', 'explained', 'salesHr', 'Two hotel renovations on the coast were delivered earlier than planned. The new rep in Split only starts in June.',
      'Dve prenovi hotelov na obali sta bili dobavljeni prej, kot je bilo načrtovano. Novi zastopnik v Splitu začne šele junija.',
      'Dvije obnove hotela na obali isporučene su ranije od planiranog. Novi predstavnik u Splitu počinje tek u lipnju.'],
    ['it', 5, 'month', 'explained', 'controller', 'The ERP project started in May instead of July at the vendor’s request, so consulting days were billed earlier. The scope is unchanged.',
      'Projekt ERP se je na željo izvajalca začel maja namesto julija, zato so bili svetovalni dnevi zaračunani prej. Obseg projekta je nespremenjen.',
      'Projekt ERP počeo je u svibnju umjesto u srpnju na zahtjev dobavljača, pa su konzultantski dani ranije fakturirani. Opseg projekta je nepromijenjen.'],
    ['sales_hr', 6, 'month', 'explained', 'salesHr', 'Coastal hotel projects again, plus a strong start for the new rep: three installer accounts in Split and Zadar.',
      'Ponovno hotelski projekti na obali in dober začetek novega zastopnika: trije novi kupci, monterji v Splitu in Zadru.',
      'Ponovno hotelski projekti na obali i dobar početak novog predstavnika: tri nova kupca, instalatera u Splitu i Zadru.'],
    ['it', 6, 'month', 'explained', 'controller', 'ERP data migration workshops, second month of the project.',
      'Delavnice za prenos podatkov v ERP, drugi mesec projekta.',
      'Radionice za migraciju podataka u ERP, drugi mjesec projekta.'],
    ['sales_si', 7, 'month', 'explained', 'cfo', 'Wet July: air-conditioning sales were well below plan. Heating pre-orders for the autumn are on track.',
      'Deževen julij: prodaja klimatskih naprav je bila precej pod planom. Prednaročila ogrevalne opreme za jesen so v skladu s pričakovanji.',
      'Kišni srpanj: prodaja klima-uređaja bila je znatno ispod plana. Prednarudžbe opreme za grijanje za jesen u skladu su s očekivanjima.'],
    ['sales_hr', 7, 'month', 'explained', 'salesHr', 'The coastal projects continue; the new rep is ahead of his targets.',
      'Projekti na obali se nadaljujejo; novi zastopnik presega svoje cilje.',
      'Projekti na obali se nastavljaju; novi predstavnik premašuje svoje ciljeve.'],
    ['sales_si', 8, 'month', 'open', 'controller', 'Air conditioning again. Waiting for the sell-through report from the two retail chains before we close this one.',
      'Spet klimatske naprave. Preden pojasnilo zaključimo, čakamo na poročilo o prodaji končnim kupcem od obeh trgovskih verig.',
      'Opet klima-uređaji. Prije zatvaranja objašnjenja čekamo izvješće o prodaji krajnjim kupcima od obaju trgovačkih lanaca.'],
    ['sales_hr', 8, 'month', 'explained', 'salesHr', 'Ahead of plan for the fourth month in a row: hotel projects and the Split installers.',
      'Že četrti mesec zapored nad planom: hotelski projekti in monterji iz Splita.',
      'Četvrti mjesec zaredom iznad plana: hotelski projekti i instalateri iz Splita.']
  ];
  var IT_YTD = ['Year to date over budget because the ERP project started two months early. The vendor expects some extra migration days; the full-year overrun should stay modest.',
    'Od začetka leta nad planom, ker se je projekt ERP začel dva meseca prej. Izvajalec pričakuje nekaj dodatnih dni za prenos podatkov; prekoračitev za celo leto naj bi ostala zmerna.',
    'Od početka godine iznad plana jer je projekt ERP počeo dva mjeseca ranije. Dobavljač očekuje nekoliko dodatnih dana migracije; prekoračenje za cijelu godinu trebalo bi ostati umjereno.'];

  // The headcount behind the personnel budget: role, country, FTE, monthly gross at 1 FTE (€), meal and commuting
  // allowances a month (€), from, to (month numbers of the budget year; 0 = all year). Gross pay already includes the
  // 4,5 % increase. The people are groups (14 warehouse operatives), so no person is named.
  var HEADCOUNT = [
    ['Managing director', 'SI', 1, 6500, 180, 0, 0],
    ['Finance and controlling', 'SI', 3, 2950, 180, 0, 0],
    ['Sales — Slovenia (field and inside)', 'SI', 8, 2550, 190, 0, 0],
    ['Purchasing', 'SI', 2, 2700, 180, 0, 0],
    ['Customer service', 'SI', 3, 1950, 180, 0, 0],
    ['Warehouse operatives', 'SI', 13, 1650, 200, 0, 0],
    ['Drivers', 'SI', 8, 1700, 200, 0, 0],
    ['IT and office', 'SI', 1, 2800, 180, 0, 0],
    ['Warehouse operatives — new', 'SI', 3, 1650, 200, 2, 0],
    ['Sales-support coordinator — new', 'SI', 1, 2300, 180, 3, 0],
    ['Sales rep Croatia (Split) — new', 'HR', 1, 2400, 150, 4, 0]
  ];
  function headcountRows(year) {
    return HEADCOUNT.map(function (h, i) {
      return { id: 'h' + (i + 1), role: h[0], country: h[1], fte: h[2], gross: cents(h[3]), allow: cents(h[4]), from: h[5] ? year + '-' + E.pad(h[5]) : '', to: h[6] ? year + '-' + E.pad(h[6]) : '' };
    });
  }

  function stamp(year, m, plusDays) {
    var y = m === 12 ? year + 1 : year, mm = m === 12 ? 1 : m + 1;
    var d = E.addDays(y + '-' + E.pad(mm) + '-01', plusDays);
    var dow = new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10))).getUTCDay();
    if (dow === 6) d = E.addDays(d, 2); else if (dow === 0) d = E.addDays(d, 1);
    return d;
  }

  function generate(today) {
    var year = E.fiscalYear(today, GRACE), closed = E.closedFor(year, today, GRACE);
    var accounts = accountsList();
    var pyActs = yearActuals(year - 1, 12, false), cyActs = yearActuals(year, closed, true);
    var py = E.aggregate(pyActs, accounts).lines, act = E.aggregate(cyActs, accounts).lines;
    var bud = buildBudget(py);
    var db = {
      version: VERSION, demo: true, edited: false, generatedFor: today, year: year,
      company: { name: COMPANY.name, what: COMPANY.what, city: COMPANY.city },
      chart: CHART_ID,
      settings: { closed: 'auto', grace: GRACE, pct: 10, ytdAbs: 10000, monthAbs: 5000, alwaysAbs: 40000, basis: 'forecast', author: PEOPLE.controller },
      accounts: accounts,
      actuals: {}, loaded: {},
      versions: [{ id: 'budget', kind: 'budget', name: 'Budget ' + year, locked: true, approvedOn: (year - 1) + '-12-15', createdOn: (year - 1) + '-11-24',
        note: 'Approved by the management board. Revenue +7 % with a new sales rep in Croatia from April; four new people, a spring marketing push and the ERP project in the second half, so EBITDA is planned below last year. Cost of goods at ' + String(Math.round(bud.cogsPct * 10) / 10).replace('.', ',') + ' % of revenue, freight at 2,2 %.', values: bud.values }],
      comments: [], log: []
    };
    db.actuals[year - 1] = pyActs; db.actuals[year] = cyActs;
    db.loaded[year - 1] = E.zeros().map(function () { return true; });
    db.loaded[year] = E.zeros().map(function (x, i) { return i < closed; });
    var q = closed >= 6 ? 2 : closed >= 3 ? 1 : 0;
    if (q) {
      var made = E.addDays(year + '-' + E.pad(q * 3 + 1) + '-08', 0);
      db.versions.push({ id: 'fc-q' + q, kind: 'forecast', name: E.forecastName(year, q * 3), locked: false, createdOn: made, basedOn: 'budget', actualThrough: q * 3,
        note: q === 2 ? 'Reforecast after the half year: weaker air conditioning in Slovenia, Croatia ahead, supplier price increase, ERP project started early.' : 'First-quarter reforecast: hiring delay and the Croatian rep starting later.',
        values: buildForecast(act, bud.values, q) });
    }
    // comments on flagged variances of earlier months
    var th = { pct: 10, monthAbs: 500000, ytdAbs: 1000000 };
    var fl = E.flags(E.rowsOf(act), E.rowsOf(bud.values), closed, th), flagged = {};
    fl.forEach(function (f) { flagged[E.commentKey(f.line, f.month, f.scope)] = f; });
    var seq = 0;
    NOTES.forEach(function (n) {
      var key = E.commentKey(n[0], n[1], n[2]);
      if (n[1] >= closed || !flagged[key]) return;
      var at = stamp(year, n[1], 11 + (seq % 4));
      if (at > today) return;
      db.comments.push({ id: 'n' + (++seq), line: n[0], month: n[1], scope: n[2], status: n[3], author: PEOPLE[n[4]], at: at, text: n[5], lang: 'en', texts: { sl: n[6], hr: n[7] } });
    });
    // the year-to-date note written last month for IT, if IT was already flagged then
    if (closed >= 2) {
      var prev = E.flags(E.rowsOf(act), E.rowsOf(bud.values), closed - 1, th).filter(function (f) { return f.scope === 'ytd' && f.line === 'it'; })[0];
      var atY = stamp(year, closed - 1, 13);
      if (prev && atY <= today) db.comments.push({ id: 'n' + (++seq), line: 'it', month: closed - 1, scope: 'ytd', status: 'explained', author: PEOPLE.controller, at: atY, text: IT_YTD[0], lang: 'en', texts: { sl: IT_YTD[1], hr: IT_YTD[2] } });
    }
    db.headcount = { rows: headcountRows(year), rates: { SI: E.CONTRIB.SI, HR: E.CONTRIB.HR }, holiday: cents(1300), holidayMonth: 6, other: cents(110000) };
    db.log.push({ at: today, text: 'Demo data created: ' + year + ', closed through ' + (closed ? E.MONTHS_LONG[closed - 1] : 'no month yet') + '.' });
    return db;
  }

  /** Add demo actuals for months that have closed since the data was made (never over imported months). */
  function extend(db, today) {
    if (!db || !db.demo) return false;
    var year = db.year, closed = E.closedFor(year, today, db.settings && db.settings.grace != null ? db.settings.grace : GRACE), changed = false;
    var loaded = db.loaded[year] || (db.loaded[year] = E.zeros().map(function () { return false; }));
    var acts = db.actuals[year] || (db.actuals[year] = {});
    for (var m = 1; m <= closed; m++) {
      if (loaded[m - 1]) continue;
      var mv = monthValues(year, m, true, db.chart !== CHART_ID);
      Object.keys(mv).forEach(function (code) { (acts[code] || (acts[code] = E.zeros()))[m - 1] = mv[code]; });
      loaded[m - 1] = true; changed = true;
    }
    if (changed) db.log.unshift({ at: today, text: 'Demo actuals added through ' + E.MONTHS_LONG[closed - 1] + '.' });
    return changed;
  }

  /** Move demo data made before the Slovenian chart (no db.chart) onto it: rename the demo accounts and their actuals,
   * keeping names people changed and everything else as it is. Only demo data (never imported) is moved, and only
   * when no account of the person's own already uses one of the new codes; otherwise db.chart becomes 'legacy' and
   * extend() keeps adding months on the old codes. Returns true when something changed. */
  function migrate(db) {
    if (!db || db.chart) return false;
    if (!db.demo) { db.chart = 'own'; return true; }
    var old = {}, legacyName = {};
    CHART.forEach(function (c) { old[c[0]] = true; legacyName[c[0]] = c[1]; });
    var clash = (db.accounts || []).some(function (a) { return !old[a.code] && Object.keys(SI_CODE).some(function (k) { return SI_CODE[k] === a.code; }); });
    if (clash) { db.chart = 'legacy'; return true; }
    (db.accounts || []).forEach(function (a) { if (old[a.code]) a.code = SI_CODE[a.code]; });
    Object.keys(db.actuals || {}).forEach(function (y) { db.actuals[y] = siCodes(db.actuals[y]); });
    db.chart = CHART_ID;
    (db.log || (db.log = [])).unshift({ at: new Date().toISOString().slice(0, 10), text: 'Demo accounts moved to the Slovenian chart of accounts (kontni okvir).' });
    return true;
  }

  return { VERSION: VERSION, GRACE: GRACE, COMPANY: COMPANY, PEOPLE: PEOPLE, CHART: CHART, SI_CODE: SI_CODE, CHART_ID: CHART_ID, generate: generate, extend: extend, migrate: migrate, monthValues: monthValues, accountsList: accountsList, buildBudget: buildBudget, headcountRows: headcountRows };
});
