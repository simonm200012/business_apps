/* Budget vs actual engine (Business Apps): pure P&L rules, no DOM. UMD, so it also loads in Node.
 *
 * Money is integer cents everywhere, so every total, subtotal, spread and bridge reconciles to the cent.
 * A P&L line has a type: 'income' (higher is good) or 'cost' (lower is good). Accounts feed lines; an account whose
 * kind differs from its line's type (interest expense inside "Net financial result") counts with the opposite sign.
 * Subtotals (revenue, gross margin, EBITDA, EBIT, profit before tax) are always computed, never stored.
 * Months are 1..12 in the API; month arrays are 0-based with 12 entries. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BudgetEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  // ── P&L structure ────────────────────────────────────────────────────────
  var SECTIONS = [
    { id: 'rev', name: 'Revenue' },
    { id: 'cos', name: 'Cost of sales' },
    { id: 'opex', name: 'Operating expenses' },
    { id: 'da', name: 'Depreciation' },
    { id: 'fin', name: 'Financial result' }
  ];
  var LINES = [
    { id: 'sales_si', name: 'Sales — Slovenia', section: 'rev', type: 'income' },
    { id: 'sales_hr', name: 'Sales — Croatia', section: 'rev', type: 'income' },
    { id: 'sales_eu', name: 'Sales — other EU', section: 'rev', type: 'income' },
    { id: 'other_inc', name: 'Other operating income', section: 'rev', type: 'income' },
    { id: 'cogs', name: 'Cost of goods sold', section: 'cos', type: 'cost' },
    { id: 'freight', name: 'Freight and logistics', section: 'cos', type: 'cost' },
    { id: 'personnel', name: 'Personnel', section: 'opex', type: 'cost' },
    { id: 'rent', name: 'Rent and facilities', section: 'opex', type: 'cost' },
    { id: 'vehicles', name: 'Vehicles and delivery fleet', section: 'opex', type: 'cost' },
    { id: 'marketing', name: 'Marketing', section: 'opex', type: 'cost' },
    { id: 'it', name: 'IT and software', section: 'opex', type: 'cost' },
    { id: 'prof', name: 'Professional services', section: 'opex', type: 'cost' },
    { id: 'travel', name: 'Travel', section: 'opex', type: 'cost' },
    { id: 'insurance', name: 'Insurance', section: 'opex', type: 'cost' },
    { id: 'other_cost', name: 'Other operating costs', section: 'opex', type: 'cost' },
    { id: 'da', name: 'Depreciation and amortisation', section: 'da', type: 'cost' },
    { id: 'fin', name: 'Net financial result (interest)', section: 'fin', type: 'income' }
  ];
  var LINE = {};
  LINES.forEach(function (l, i) { l.order = i; LINE[l.id] = l; });
  function linesIn(section) { return LINES.filter(function (l) { return l.section === section; }).map(function (l) { return l.id; }); }
  // Each subtotal is a signed sum of lines or earlier subtotals, in the subtotal's own orientation.
  var SUBS = [
    { id: 'rev', name: 'Total revenue', type: 'income', terms: linesIn('rev').map(function (id) { return [id, 1]; }) },
    { id: 'cos', name: 'Total cost of sales', type: 'cost', terms: linesIn('cos').map(function (id) { return [id, 1]; }) },
    { id: 'gm', name: 'Gross margin', type: 'income', terms: [['rev', 1], ['cos', -1]], margin: true },
    { id: 'opex', name: 'Total operating expenses', type: 'cost', terms: linesIn('opex').map(function (id) { return [id, 1]; }) },
    { id: 'ebitda', name: 'EBITDA', type: 'income', terms: [['gm', 1], ['opex', -1]], margin: true },
    { id: 'ebit', name: 'EBIT', type: 'income', terms: [['ebitda', 1], ['da', -1]] },
    { id: 'pbt', name: 'Profit before tax', type: 'income', terms: [['ebit', 1], ['fin', 1]] }
  ];
  var SUB = {};
  SUBS.forEach(function (s) { SUB[s.id] = s; });
  // Display order of the P&L. kind: head (section title), line, sub (computed), pct (a margin in % of revenue).
  var ROWS = [];
  (function () {
    function head(id, name) { ROWS.push({ kind: 'head', id: 'h_' + id, name: name }); }
    function lines(section) { linesIn(section).forEach(function (id) { ROWS.push({ kind: 'line', id: id, name: LINE[id].name, type: LINE[id].type }); }); }
    function sub(id, strong) { ROWS.push({ kind: 'sub', id: id, name: SUB[id].name, type: SUB[id].type, strong: !!strong }); }
    function pct(id, name) { ROWS.push({ kind: 'pct', id: id + '_pct', of: id, name: name }); }
    head('rev', 'Revenue'); lines('rev'); sub('rev');
    head('cos', 'Cost of sales'); lines('cos'); sub('cos');
    sub('gm', true); pct('gm', 'Gross margin %');
    head('opex', 'Operating expenses'); lines('opex'); sub('opex');
    sub('ebitda', true); pct('ebitda', 'EBITDA %');
    lines('da'); sub('ebit', true);
    lines('fin'); sub('pbt', true);
  })();
  function typeOf(id) { return LINE[id] ? LINE[id].type : SUB[id] ? SUB[id].type : 'income'; }
  function nameOf(id) { return LINE[id] ? LINE[id].name : SUB[id] ? SUB[id].name : String(id); }

  // ── small helpers ────────────────────────────────────────────────────────
  function zeros() { return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; }
  function pad(n) { return String(n).padStart(2, '0'); }
  function sumRange(arr, from, to) {
    var s = 0;
    if (!arr) return 0;
    for (var m = Math.max(1, from); m <= Math.min(12, to); m++) s += arr[m - 1] || 0;
    return s;
  }
  function total(arr) { return sumRange(arr, 1, 12); }
  function sum(list) { var s = 0; for (var i = 0; i < list.length; i++) s += list[i] || 0; return s; }
  /** Income or cost from the account code, on the Slovenian chart of accounts for companies (Kontni okvir za gospodarske
   * družbe, SRS 2016, Slovenski inštitut za revizijo): class 4 holds costs by nature; in class 7 groups 70–75 are
   * expenses (70 cost of goods sold, 72 revaluation expenses, 74 finance costs, 75 other expenses) and 76–78 income
   * (76 operating revenue, 77 finance income, 78 other income). A bare "7" counts as income, as before. */
  function kindFromCode(code) {
    var s = String(code).trim();
    if (s.charAt(0) !== '7') return 'cost';
    var g = s.charAt(1);
    return g >= '0' && g <= '5' ? 'cost' : 'income';
  }
  function isIntArr12(a) { return Array.isArray(a) && a.length === 12 && a.every(function (x) { return typeof x === 'number' && isFinite(x) && Math.floor(x) === x; }); }

  // ── aggregation ──────────────────────────────────────────────────────────
  /** Sign of an account inside its line: +1 when the account's kind matches the line type, else −1. */
  function accountSign(acc) {
    var l = acc && LINE[acc.line];
    if (!l) return 0;
    return (acc.kind || kindFromCode(acc.code)) === l.type ? 1 : -1;
  }
  /** Accounts (natural amounts per account, cents per month) → lines. Values of accounts that are not mapped to a
   * line are left out and their codes returned in `unmapped`. */
  function aggregate(acts, accounts) {
    var lines = {}, unmapped = [], by = {};
    LINES.forEach(function (l) { lines[l.id] = zeros(); });
    (accounts || []).forEach(function (a) { by[String(a.code)] = a; });
    Object.keys(acts || {}).forEach(function (code) {
      var arr = acts[code], a = by[code], sg = accountSign(a);
      if (!sg) { if (arr && arr.some(function (x) { return x; })) unmapped.push(code); return; }
      var t = lines[a.line];
      for (var i = 0; i < 12; i++) t[i] += sg * (arr[i] || 0);
    });
    return { lines: lines, unmapped: unmapped.sort() };
  }
  /** Lines → every P&L row (lines plus computed subtotals), month by month. */
  function rowsOf(lines) {
    var r = {};
    LINES.forEach(function (l) { r[l.id] = ((lines && lines[l.id]) || zeros()).slice(); });
    SUBS.forEach(function (s) {
      var a = zeros();
      s.terms.forEach(function (t) { var src = r[t[0]]; for (var i = 0; i < 12; i++) a[i] += t[1] * src[i]; });
      r[s.id] = a;
    });
    return r;
  }
  /** Closed months from the actuals, open months from a version (budget or forecast). */
  function outlook(act, ver, closed) {
    var o = {};
    LINES.forEach(function (l) {
      var a = (act && act[l.id]) || zeros(), v = (ver && ver[l.id]) || zeros();
      o[l.id] = a.map(function (x, i) { return i < closed ? x : (v[i] || 0); });
    });
    return o;
  }

  // ── periods ──────────────────────────────────────────────────────────────
  /** Months covered by a period. kind: month (n = 1..12), quarter (n = 1..4, cut at the closed month when it is
   * still running), ytd (through the closed month) or fy (all twelve). */
  function period(kind, n, closed) {
    if (kind === 'month') return { kind: kind, n: n, from: n, to: n, partial: false };
    if (kind === 'quarter') {
      var from = n * 3 - 2, to = n * 3, partial = false;
      if (closed >= from && closed < to) { to = closed; partial = true; }
      return { kind: kind, n: n, from: from, to: to, partial: partial };
    }
    if (kind === 'ytd') return { kind: kind, n: closed, from: 1, to: closed, partial: false };
    return { kind: 'fy', n: 12, from: 1, to: 12, partial: false };
  }

  // ── variances ────────────────────────────────────────────────────────────
  /** Percent variance against the base. Negative bases use their absolute value, so the sign always follows the
   * difference. A zero base has no percentage (null), unless both are zero (0 %). */
  function pctVar(actual, base) {
    if (base === 0) return actual === 0 ? 0 : null;
    return (actual - base) / Math.abs(base) * 100;
  }
  /** Difference, percent and whether it is favourable: income higher is good, cost lower is good. fav is null for no
   * difference. */
  function variance(actual, base, type) {
    var d = actual - base;
    return { a: actual, b: base, d: d, pct: pctVar(actual, base), fav: d === 0 ? null : (type === 'cost' ? d < 0 : d > 0) };
  }
  /** value as % of revenue; null when revenue is zero */
  function share(value, revenue) { return revenue ? value / revenue * 100 : null; }
  /** Effect of a line's difference on profit (income +d, cost −d). */
  function profitEffect(id, d) { return typeOf(id) === 'cost' ? -d : d; }
  /** A variance needs an explanation when it is at least `pct` % of the base AND at least `absCents`. A zero base
   * counts as an unlimited percentage, so only the amount threshold applies. */
  function isFlagged(actual, base, pct, absCents, alwaysCents) {
    var d = Math.abs(actual - base);
    if (d === 0) return false;
    if (alwaysCents > 0 && d >= alwaysCents) return true; // "always explain above X €", whatever the percentage
    if (d < absCents) return false;
    if (base === 0) return true;
    return d * 100 >= pct * Math.abs(base) - 1e-6;
  }
  /** Every line × closed month (and the year to date) that needs an explanation. th = { pct, monthAbs, ytdAbs,
   * always } with the amounts in cents; `always` (0 = off) flags any difference of at least that amount, so the
   * biggest variances always need a comment even when they are a small percentage of a big line. A row flagged only
   * by that rule carries why: 'always'. */
  function flags(actRows, cmpRows, closed, th) {
    var out = [], always = th.always || 0;
    LINES.forEach(function (l) {
      var a = actRows[l.id] || zeros(), b = cmpRows[l.id] || zeros();
      for (var m = 1; m <= closed; m++) {
        if (isFlagged(a[m - 1], b[m - 1], th.pct, th.monthAbs, always)) out.push(flagRow(l, 'month', m, a[m - 1], b[m - 1], !isFlagged(a[m - 1], b[m - 1], th.pct, th.monthAbs)));
      }
      if (closed > 0) {
        var ay = sumRange(a, 1, closed), by = sumRange(b, 1, closed);
        if (isFlagged(ay, by, th.pct, th.ytdAbs, always)) out.push(flagRow(l, 'ytd', closed, ay, by, !isFlagged(ay, by, th.pct, th.ytdAbs)));
      }
    });
    return out;
  }
  function flagRow(l, scope, m, a, b, byAlways) {
    var v = variance(a, b, l.type);
    return { line: l.id, scope: scope, month: m, a: a, b: b, d: v.d, pct: v.pct, fav: v.fav, effect: profitEffect(l.id, v.d), why: byAlways ? 'always' : 'threshold' };
  }
  function commentKey(line, month, scope) { return line + '|' + month + '|' + (scope === 'ytd' ? 'ytd' : 'month'); }

  // ── EBITDA bridge ────────────────────────────────────────────────────────
  /** From the base EBITDA to the actual (or outlook) EBITDA over months from..to, one step per line above EBITDA.
   * start + Σ steps = end, exactly. */
  function bridge(baseLines, actLines, from, to) {
    var b = rowsOf(baseLines), a = rowsOf(actLines);
    var steps = LINES.filter(function (l) { return l.section === 'rev' || l.section === 'cos' || l.section === 'opex'; }).map(function (l) {
      var d = sumRange(a[l.id], from, to) - sumRange(b[l.id], from, to);
      return { id: l.id, name: l.name, effect: profitEffect(l.id, d), base: sumRange(b[l.id], from, to), actual: sumRange(a[l.id], from, to) };
    });
    return { start: sumRange(b.ebitda, from, to), end: sumRange(a.ebitda, from, to), steps: steps };
  }
  /** At most `max` steps: the largest effects stay (in P&L order), the rest are merged into "Other lines". */
  function compactBridge(br, max) {
    if (br.steps.length <= max) return { start: br.start, end: br.end, steps: br.steps.slice() };
    var ranked = br.steps.map(function (s, i) { return { s: s, i: i }; }).sort(function (x, y) { return Math.abs(y.s.effect) - Math.abs(x.s.effect) || x.i - y.i; });
    var keep = {};
    ranked.slice(0, Math.max(1, max - 1)).forEach(function (r) { keep[r.i] = true; });
    var steps = [], other = { id: 'other', name: 'Other lines', effect: 0, ids: [] };
    br.steps.forEach(function (s, i) { if (keep[i]) steps.push(s); else { other.effect += s.effect; other.ids.push(s.id); } });
    if (other.ids.length) steps.push(other);
    return { start: br.start, end: br.end, steps: steps };
  }

  // ── budget tools (largest-remainder rounding keeps every total to the cent) ──
  /** Round real targets to multiples of `unit` cents so that they add up to exactly `totalCents`. Each result is
   * within one unit of its target; the leftover units go to the largest fractional parts (ties: earlier month). */
  function roundToTotal(targets, totalCents, unit) {
    unit = unit || 1;
    if (totalCents % unit !== 0) unit = 1;
    var n = targets.length, T = Math.round(totalCents / unit);
    if (!n) return [];
    var xs = targets.map(function (t) { return t / unit; });
    var fl = xs.map(function (x) { return Math.floor(x + 1e-9); });
    var rem = T - sum(fl), idx = xs.map(function (x, i) { return i; }), k;
    if (rem > 0) {
      idx.sort(function (i, j) { return (xs[j] - fl[j]) - (xs[i] - fl[i]) || i - j; });
      for (k = 0; k < rem; k++) fl[idx[k % n]] += 1;
    } else if (rem < 0) {
      idx.sort(function (i, j) { return (xs[i] - fl[i]) - (xs[j] - fl[j]) || j - i; });
      for (k = 0; k < -rem; k++) fl[idx[k % n]] -= 1;
    }
    return fl.map(function (x) { return x * unit + 0; });
  }
  /** Split a total in proportion to weights (even when they add up to zero). */
  function allocate(totalCents, weights, unit) {
    var W = sum(weights), n = weights.length;
    var targets = W === 0 ? weights.map(function () { return totalCents / n; }) : weights.map(function (w) { return totalCents * (w / W); });
    return roundToTotal(targets, totalCents, unit);
  }
  /** Whole euros when the total is in whole euros, otherwise cents. */
  function unitFor(totalCents) { return totalCents % 100 === 0 ? 100 : 1; }
  function roundTo(x, unit) { return Math.round(x / unit) * unit; }
  function spreadEven(totalCents, n, unit) {
    var w = []; for (var i = 0; i < (n || 12); i++) w.push(1);
    return allocate(totalCents, w, unit || unitFor(totalCents));
  }
  /** Spread a total in the shape of last year's months (even when last year was all zero). */
  function spreadSeasonal(totalCents, lastYear, unit) { return allocate(totalCents, lastYear, unit || unitFor(totalCents)); }
  /** Last year × (1 + growth %), the yearly total rounded to whole euros, each month keeping last year's shape. */
  function copyGrowth(lastYear, growthPct, unit) {
    unit = unit || 100;
    var T = roundTo(sum(lastYear) * (1 + growthPct / 100), unit);
    if (sum(lastYear) === 0) return lastYear.map(function () { return 0; });
    return allocate(T, lastYear, unit);
  }
  /** A line as pct % of a base (usually revenue), month by month; the yearly total is rounded to whole euros. */
  function pctOf(base, pct, unit) {
    unit = unit || 100;
    var T = roundTo(sum(base) * pct / 100, unit);
    if (sum(base) === 0) return base.map(function () { return 0; });
    return allocate(T, base, unit);
  }
  /** Keep the shape of the current months but scale them to a new total. Falls back to `fallback` (e.g. last year)
   * and then to an even spread when the current months are all zero. */
  function rescale(current, totalCents, fallback) {
    var w = sum(current) !== 0 ? current : (fallback && sum(fallback) !== 0 ? fallback : current.map(function () { return 1; }));
    return allocate(totalCents, w, unitFor(totalCents));
  }

  // ── forecasts ────────────────────────────────────────────────────────────
  /** A new forecast: actual lines for closed months, the current version for open months. */
  function makeForecast(actLines, verLines, closed) { return outlook(actLines, verLines, closed); }
  function forecastName(year, closed) {
    if (closed > 0 && closed % 3 === 0) return 'Forecast ' + year + ' (Q' + (closed / 3) + ')';
    return 'Forecast ' + year + ' (' + closed + '+' + (12 - closed) + ')';
  }

  // ── dates and closing ────────────────────────────────────────────────────
  var DAY = 86400000;
  function isDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && fromUtc(toUtc(s)) === s; }
  function toUtc(s) { return Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)); }
  function fromUtc(t) { var d = new Date(t); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function addDays(s, n) { return fromUtc(toUtc(s) + Math.round(n) * DAY); }
  function diffDays(a, b) { return Math.round((toUtc(b) - toUtc(a)) / DAY); }
  function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function monthEnd(y, m) { return y + '-' + pad(m) + '-' + pad(daysInMonth(y, m)); }
  function ymKey(y, m) { return y + '-' + pad(m); }
  /** The last month whose end is at least `grace` days before today: { y, m }. */
  function lastClosed(today, grace) {
    grace = grace == null ? 10 : grace;
    var y = +today.slice(0, 4), m = +today.slice(5, 7);
    for (var k = 0; k < 36; k++) {
      m--; if (m < 1) { m = 12; y--; }
      if (diffDays(monthEnd(y, m), today) >= grace) break;
    }
    return { y: y, m: m };
  }
  /** Closed months (0..12) of `year` on `today` by the grace rule. */
  function closedFor(year, today, grace) {
    var lc = lastClosed(today, grace);
    return lc.y > year ? 12 : lc.y < year ? 0 : lc.m;
  }
  /** The fiscal year to show: the year of the last closed month (so early January still shows the year being closed). */
  function fiscalYear(today, grace) { return lastClosed(today, grace).y; }
  /** A month can only count as closed when it has actuals: stop before the first month without them. */
  function capByLoaded(closed, loaded) {
    for (var m = 1; m <= closed; m++) if (!loaded || !loaded[m - 1]) return m - 1;
    return closed;
  }

  // ── numbers typed by people ──────────────────────────────────────────────
  /** "12,34" → 1234 cents, exactly: the third decimal rounds half up, later digits are ignored. */
  function toCents(ip, fp) {
    var f = (String(fp || '') + '000').slice(0, 3);
    return Number(ip || '0') * 100 + Number(f.slice(0, 2)) + (Number(f.charAt(2)) >= 5 ? 1 : 0);
  }
  /** A number typed into a cell, Slovenian style: decimal comma, '.' or space between thousands, optional k / M.
   * "12.500" = 12 500 €, "12,5" = 12,50 €, "12,5k" = 12 500 €, "1.234,56", "-800". Empty = 0. NaN when unreadable. */
  function parseInput(raw) {
    var s = String(raw == null ? '' : raw).trim().replace(/[\s  €']/g, '');
    if (s === '') return 0;
    var shift = 0, k = /^(.*\d)([kKmM])$/.exec(s);
    if (k) { s = k[1]; shift = /k/i.test(k[2]) ? 3 : 6; }
    var neg = false;
    if (/^[-−–]/.test(s)) { neg = true; s = s.slice(1); } else if (s.charAt(0) === '+') s = s.slice(1);
    var lc = s.lastIndexOf(','), ld = s.lastIndexOf('.'), dec = null, ip, fp = '';
    if (lc >= 0 && ld >= 0) dec = lc > ld ? ',' : '.';
    else if (lc >= 0) dec = ',';
    else if (ld >= 0) dec = /^\d{1,3}(\.\d{3})+$/.test(s) ? null : '.';
    if (dec) {
      var parts = s.split(dec === ',' ? '.' : ',').join('').split(dec);
      if (parts.length !== 2) return NaN;
      ip = parts[0]; fp = parts[1];
    } else ip = s.split('.').join('');
    if (!/^\d*$/.test(ip) || !/^\d*$/.test(fp) || (ip === '' && fp === '')) return NaN;
    if (shift) { var f = fp + '000000'; ip = (ip || '0') + f.slice(0, shift); fp = fp.length > shift ? fp.slice(shift) : ''; }
    if (ip.replace(/^0+/, '').length > 12) return NaN;
    var c = toCents(ip, fp);
    return neg && c ? -c : c;
  }
  /** cents → "1234,56" (no thousands separator; for CSV files) */
  function centsText(c, dec) {
    var neg = c < 0, a = Math.abs(c);
    return (neg ? '-' : '') + Math.floor(a / 100) + (dec || ',') + pad(a % 100);
  }

  // ── CSV ──────────────────────────────────────────────────────────────────
  function stripBom(s) { return s && s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s; }
  /** Tab, semicolon or comma, whichever appears most in the first non-empty line (outside quotes). */
  function detectDelimiter(text) {
    var lines = String(text || '').split(/\r?\n/), line = '';
    for (var i = 0; i < lines.length; i++) if (lines[i].trim()) { line = lines[i]; break; }
    var c = { '\t': 0, ';': 0, ',': 0 }, q = false;
    for (i = 0; i < line.length; i++) {
      var ch = line.charAt(i);
      if (ch === '"') q = !q;
      else if (!q && c[ch] !== undefined) c[ch]++;
    }
    if (c['\t'] && c['\t'] >= c[';'] && c['\t'] >= c[',']) return '\t';
    if (c[';'] && c[';'] >= c[',']) return ';';
    if (c[',']) return ',';
    return ';';
  }
  /** RFC 4180 style: quoted cells may hold the delimiter, line breaks and "" for a quote. */
  function splitCsv(text, d) {
    var rows = [], row = [], cell = '', q = false, quoted = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (q) {
        if (ch === '"') { if (text.charAt(i + 1) === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
      } else if (ch === '"' && cell === '' && !quoted) { q = true; quoted = true; }
      else if (ch === d) { row.push(cell); cell = ''; quoted = false; }
      else if (ch === '\r' || ch === '\n') {
        if (ch === '\r' && text.charAt(i + 1) === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = ''; quoted = false;
      } else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }
  function csvCell(v, sep) {
    v = String(v == null ? '' : v);
    return v.indexOf(sep) >= 0 || /["\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  /** rows → CSV text with a BOM, so Excel opens Slovenian characters correctly */
  function toCsv(rows, sep) {
    sep = sep || ';';
    return '﻿' + rows.map(function (r) { return r.map(function (c) { return csvCell(c, sep); }).join(sep); }).join('\r\n') + '\r\n';
  }
  function normHead(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }
  var HEADS = {
    month: ['month', 'period', 'date', 'posting date', 'booking date', 'yyyy mm', 'mesec', 'obdobje', 'datum', 'mjesec', 'razdoblje'],
    account: ['account', 'account code', 'account no', 'account number', 'gl account', 'acct', 'konto', 'racun', 'sifra konta', 'konto st'],
    amount: ['amount', 'value', 'net', 'net amount', 'balance', 'eur', 'amount eur', 'znesek', 'iznos', 'saldo', 'znesek eur', 'iznos eur'],
    desc: ['description', 'text', 'memo', 'note', 'opis', 'naziv', 'tekst', 'account name']
  };
  /** "2026-09", "2026-9", "2026-09-30", "30.9.2026", "30. 09. 2026", "30/09/2026", "09/2026", "9.2026", "202609" → { y, m } */
  function parseMonth(raw) {
    var s = String(raw == null ? '' : raw).trim(), m, y, mo, d = 1;
    if ((m = /^(\d{4})[-\/.](\d{1,2})(?:[-\/.](\d{1,2}))?\.?(?:[T\s].*)?$/.exec(s))) { y = +m[1]; mo = +m[2]; if (m[3]) d = +m[3]; }
    else if ((m = /^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})\.?(?:\s.*)?$/.exec(s))) { d = +m[1]; mo = +m[2]; y = +m[3]; }
    else if ((m = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:\s.*)?$/.exec(s))) { d = +m[1]; mo = +m[2]; y = +m[3]; }
    else if ((m = /^(\d{1,2})\s*[.\/-]\s*(\d{4})\.?$/.exec(s))) { mo = +m[1]; y = +m[2]; }
    else if ((m = /^(\d{4})(\d{2})$/.exec(s))) { y = +m[1]; mo = +m[2]; }
    else if ((m = /^(\d{4})(\d{2})(\d{2})$/.exec(s))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    else return null;
    if (!(mo >= 1 && mo <= 12) || !(y >= 1990 && y <= 2200) || !(d >= 1 && d <= daysInMonth(y, mo))) return null;
    return { y: y, m: mo };
  }
  /** Which character is the decimal separator in a column of amounts: the evidence decides, then the delimiter
   * (a semicolon file is European, so a decimal comma). "1.234" and "1,234" alone are not evidence. */
  function detectDecimal(cells, delim) {
    var comma = 0, dot = 0;
    (cells || []).forEach(function (raw) {
      var s = String(raw == null ? '' : raw).replace(/[\s  '€]/g, '').replace(/[()]/g, '').replace(/^[-+−–]|-$/g, '');
      var lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
      if (lc >= 0 && ld >= 0) { if (lc > ld) comma++; else dot++; return; }
      if (lc >= 0 && !/^\d{1,3}(,\d{3})+$/.test(s)) comma++;
      if (ld >= 0 && !/^\d{1,3}(\.\d{3})+$/.test(s)) dot++;
    });
    if (comma !== dot) return comma > dot ? ',' : '.';
    return delim === ',' ? '.' : ',';
  }
  /** An amount from a file, exactly in cents. Handles 1.234,56 / 1,234.56 / 1 234,56 / -12 / (12,00) / 12,00- / €. */
  function parseAmount(raw, dec) {
    var s = String(raw == null ? '' : raw).trim().replace(/[\s  ']/g, '').replace(/€|EUR$/i, '');
    if (!s) return null;
    var neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    if (/-$/.test(s)) { neg = !neg; s = s.slice(0, -1); }
    if (/^[-−–]/.test(s)) { neg = !neg; s = s.slice(1); } else if (s.charAt(0) === '+') s = s.slice(1);
    dec = dec || ',';
    var parts = s.split(dec === ',' ? '.' : ',').join('').split(dec);
    if (parts.length > 2) return null;
    var ip = parts[0], fp = parts.length === 2 ? parts[1] : '';
    if (!/^\d*$/.test(ip) || !/^\d*$/.test(fp) || (ip === '' && fp === '') || ip.replace(/^0+/, '').length > 12) return null;
    var c = toCents(ip, fp);
    return neg && c ? -c : c;
  }
  /** Read an actuals file: one row per account and month (month; account; amount; optional description).
   * opts: { accounts: [{ code, kind }], years: [allowed years] }. Returns rows, errors, unknown accounts, months found
   * and a guess of the sign convention ('ledger' when income accounts come in negative, as debit/credit exports do). */
  function parseActuals(text, opts) {
    opts = opts || {};
    var res = { rows: [], errors: [], unknown: [], months: [], delimiter: ';', decimal: ',', header: false, signGuess: 'pl' };
    text = stripBom(String(text || ''));
    if (!text.trim()) { res.errors.push({ row: 0, msg: 'The file is empty.' }); return res; }
    var d = detectDelimiter(text);
    res.delimiter = d;
    var rows = [];
    splitCsv(text, d).forEach(function (cells, i) {
      cells = cells.map(function (c) { return String(c).trim(); });
      if (cells.some(function (c) { return c !== ''; })) rows.push({ n: i + 1, cells: cells });
    });
    if (!rows.length) { res.errors.push({ row: 0, msg: 'The file is empty.' }); return res; }
    var first = rows[0].cells, hn = first.map(normHead), col = { month: -1, account: -1, amount: -1, desc: -1 };
    Object.keys(HEADS).forEach(function (k) { for (var i = 0; i < hn.length; i++) if (col[k] < 0 && HEADS[k].indexOf(hn[i]) >= 0) { col[k] = i; break; } });
    if (col.month >= 0 && col.account >= 0 && col.amount >= 0) { res.header = true; rows = rows.slice(1); }
    else if (parseMonth(first[0]) && first.length >= 3) col = { month: 0, account: 1, amount: 2, desc: first.length > 3 ? 3 : -1 };
    else { res.errors.push({ row: 1, msg: 'The first row must name the columns: month, account, amount and (optional) description.' }); return res; }
    var dec = detectDecimal(rows.map(function (r) { return r.cells[col.amount]; }), d);
    res.decimal = dec;
    var known = knownOf(opts.accounts), years = opts.years || null;
    rows.forEach(function (r) {
      var c = r.cells, mm = parseMonth(c[col.month]), code = String(c[col.account] || '').trim(), amt = parseAmount(c[col.amount], dec), errs = [];
      if (!mm) errs.push('"' + (c[col.month] || '') + '" is not a month (use 2026-09 or 30. 9. 2026)');
      else if (years && years.indexOf(mm.y) < 0) errs.push(mm.y + ' is outside ' + years.join(' and '));
      if (!code) errs.push('the account is missing');
      if (amt === null) errs.push('"' + (c[col.amount] || '') + '" is not an amount');
      if (errs.length) { res.errors.push({ row: r.n, msg: errs.join('; ') }); return; }
      if (!known[code]) { var tok = code.split(/[\s–—:-]+/)[0]; if (tok && known[tok]) code = tok; }
      res.rows.push({ row: r.n, y: mm.y, m: mm.m, code: code, cents: amt, desc: col.desc >= 0 ? String(c[col.desc] || '') : '' });
    });
    summarize(res, known);
    return res;
  }
  function knownOf(accounts) { var k = {}; (accounts || []).forEach(function (a) { k[String(a.code)] = a; }); return k; }
  /** Unknown accounts, months found and the sign guess, from res.rows. */
  function summarize(res, known) {
    var unk = {}, mo = {};
    res.rows.forEach(function (row) {
      var key = ymKey(row.y, row.m), o = mo[key] || (mo[key] = { key: key, y: row.y, m: row.m, rows: 0, cents: 0 });
      o.rows++; o.cents += row.cents;
      if (!known[row.code]) { var u = unk[row.code] || (unk[row.code] = { code: row.code, rows: 0, cents: 0, desc: row.desc }); u.rows++; u.cents += row.cents; if (!u.desc && row.desc) u.desc = row.desc; }
    });
    res.unknown = Object.keys(unk).sort().map(function (k) { return unk[k]; });
    res.months = Object.keys(mo).sort().map(function (k) { return mo[k]; });
    var inc = 0, incRows = 0;
    res.rows.forEach(function (r) { var a = known[r.code]; if (a && (a.kind || kindFromCode(a.code)) === 'income') { inc += r.cents; incRows++; } });
    res.signGuess = incRows && inc < 0 ? 'ledger' : 'pl';
    return res;
  }

  /** Put parsed rows into the actuals. opts: { modes: { 'YYYY-MM': 'replace' | 'add' } (default replace),
   * sign: 'pl' (income and costs both positive) | 'ledger' (debit +, credit −: income accounts are flipped),
   * skip: { code: true } }. Returns a new actuals object; the input is not changed. */
  function applyImport(actuals, rows, accounts, opts) {
    opts = opts || {};
    var by = {}, out = {}, touched = {}, n = 0, modes = opts.modes || {}, skip = opts.skip || {}, ledger = opts.sign === 'ledger';
    (accounts || []).forEach(function (a) { by[String(a.code)] = a; });
    Object.keys(actuals || {}).forEach(function (y) {
      out[y] = {};
      Object.keys(actuals[y]).forEach(function (code) { out[y][code] = actuals[y][code].slice(); });
    });
    (rows || []).forEach(function (r) { touched[ymKey(r.y, r.m)] = { y: r.y, m: r.m }; });
    Object.keys(touched).forEach(function (k) {
      if ((modes[k] || 'replace') !== 'replace') return;
      var t = touched[k], yr = out[t.y];
      if (yr) Object.keys(yr).forEach(function (code) { yr[code][t.m - 1] = 0; });
    });
    (rows || []).forEach(function (r) {
      var a = by[r.code];
      if (!a || skip[r.code]) return;
      var v = ledger && (a.kind || kindFromCode(a.code)) === 'income' && r.cents ? -r.cents : r.cents;
      var yr = out[r.y] || (out[r.y] = {}), arr = yr[r.code] || (yr[r.code] = zeros());
      arr[r.m - 1] += v;
      n++;
    });
    return { actuals: out, months: Object.keys(touched).sort(), rows: n };
  }
  /** All actuals of the given years as CSV rows (month; account; amount; description), P&L signs, decimal comma. */
  function actualsRows(actuals, accounts, years) {
    var name = {}, out = [['month', 'account', 'amount', 'description']];
    (accounts || []).forEach(function (a) { name[String(a.code)] = a.name; });
    (years || []).forEach(function (y) {
      var yr = (actuals || {})[y] || {}, codes = Object.keys(yr).sort();
      for (var m = 1; m <= 12; m++) codes.forEach(function (code) { var v = yr[code][m - 1]; if (v) out.push([ymKey(y, m), code, centsText(v), name[code] || '']); });
    });
    return out;
  }


  // ── the Slovenian chart of accounts (kontni okvir) ───────────────────────
  // Kontni okvir za gospodarske družbe (Slovenski inštitut za revizijo, in use since 1. 1. 2016 with SRS 2016): the
  // profit and loss sits in class 4 (costs by nature) and class 7 (expenses and income). Every other class is the
  // balance sheet (0–3, 9), internal accounts (5), finished goods (6) or the result (8), and group 49 moves costs
  // into class 7 or into stock, so importing it as well would count those costs twice.
  /** { pl, kind, reason } for a code on that chart: reason 'balance' | 'other' | 'transfer' when it is not P&L. */
  function siClass(code) {
    var s = String(code || '').trim(), c = s.charAt(0);
    if (c === '4') return s.slice(0, 2) === '49' ? { pl: false, kind: 'cost', reason: 'transfer' } : { pl: true, kind: 'cost' };
    if (c === '7') return { pl: true, kind: kindFromCode(s) };
    if (c === '0' || c === '1' || c === '2' || c === '3' || c === '9') return { pl: false, kind: null, reason: 'balance' };
    return { pl: false, kind: null, reason: 'other' };
  }
  // Which P&L line a group of the chart usually feeds (longest prefix wins; 418, work by people who are not
  // employees such as student work, counts as personnel). Group names from the kontni okvir;
  // domestic and foreign sales are separate accounts there (760/762 domestic, 761/763 abroad), so foreign sales go to
  // "other EU" and Croatian accounts need to be pointed at "Sales — Croatia" once.
  var SI_PREFIX = [
    ['400', 'cogs'], ['401', 'cogs'], ['402', 'rent'], ['403', 'rent'], ['404', 'freight'], ['405', 'other_cost'], ['409', 'other_cost'], ['40', 'other_cost'],
    ['410', 'cogs'], ['411', 'freight'], ['412', 'rent'], ['413', 'rent'], ['414', 'travel'], ['415', 'other_cost'], ['416', 'prof'], ['417', 'marketing'],
    ['418', 'personnel'], ['419', 'other_cost'], ['41', 'other_cost'],
    ['43', 'da'], ['44', 'other_cost'], ['47', 'personnel'], ['48', 'other_cost'],
    ['70', 'cogs'], ['71', 'other_cost'], ['720', 'da'], ['721', 'da'], ['72', 'other_cost'], ['74', 'fin'], ['75', 'other_cost'],
    ['760', 'sales_si'], ['761', 'sales_eu'], ['762', 'sales_si'], ['763', 'sales_eu'], ['76', 'other_inc'], ['77', 'fin'], ['78', 'other_inc']
  ];
  /** A P&L line for an account the app does not know: first an existing account in the same 3-digit group (or the
   * nearest code of the same length below 100 apart), then the usual line for its group of the chart. '' when none. */
  function suggestLine(code, accounts) {
    var s = String(code || '').trim(), best = null, bd = 1e9, g3 = s.slice(0, 3);
    (accounts || []).forEach(function (a) {
      if (!a.line || !LINE[a.line]) return;
      var ac = String(a.code);
      if (!/^\d+$/.test(ac) || !/^\d+$/.test(s)) return;
      var d = ac.slice(0, 3) === g3 && s.length >= 3 ? Math.abs(+(ac + '000000').slice(0, 9) - +(s + '000000').slice(0, 9)) / 1e6 : ac.length === s.length && Math.abs(+ac - +s) < 100 ? 1000 + Math.abs(+ac - +s) : 1e9;
      if (d < bd) { bd = d; best = a; }
    });
    if (best) return best.line;
    for (var len = 3; len >= 2; len--) for (var i = 0; i < SI_PREFIX.length; i++) if (SI_PREFIX[i][0].length === len && s.slice(0, len) === SI_PREFIX[i][0]) return SI_PREFIX[i][1];
    return '';
  }

  // ── exports from accounting systems (Minimax, Pantheon) ──────────────────
  // Column names as the Slovenian and Croatian versions of the programs print them, normalised (lower case, no
  // accents, punctuation → space). Within a list the first name found wins, so "promet debet" (turnover in the
  // period) beats a plain "debet", and opening balances ("otvoritev …", "zacetno stanje …") are never read.
  var XH = {
    account: ['konto', 'sifra konta', 'konto st', 'st konta', 'stevilka konta', 'konto sifra', 'broj konta', 'konto broj', 'account', 'account code', 'account no', 'account number', 'gl account', 'acct', 'racun'],
    date: ['datum knjizenja', 'datum knj', 'datum vknjizbe', 'datum', 'datum dokumenta', 'datum dok', 'datum temeljnice', 'datum naloga', 'posting date', 'booking date', 'date'],
    period: ['obdobje', 'mesec', 'mjesec', 'razdoblje', 'period', 'month', 'yyyy mm'],
    debit: ['promet debet', 'promet breme', 'promet v breme', 'promet duguje', 'debet', 'breme', 'v breme', 'duguje', 'debit'],
    credit: ['promet kredit', 'promet dobro', 'promet v dobro', 'promet potrazuje', 'kredit', 'dobro', 'v dobro', 'potrazuje', 'credit'],
    sd: ['saldo debet', 'saldo breme', 'saldo duguje', 'koncno stanje debet', 'saldo d'],
    sk: ['saldo kredit', 'saldo dobro', 'saldo potrazuje', 'koncno stanje kredit', 'saldo k'],
    amount: ['amount', 'znesek', 'iznos', 'znesek eur', 'iznos eur', 'amount eur', 'net amount', 'value', 'eur'],
    saldo: ['saldo', 'koncno stanje', 'balance'],
    name: ['naziv konta', 'naziv', 'ime konta', 'opis konta', 'naziv racuna', 'account name'],
    desc: ['opis knjizbe', 'opis', 'besedilo', 'tekst', 'opis dokumenta', 'description', 'text', 'memo']
  };
  var XH_ORDER = ['account', 'date', 'period', 'debit', 'credit', 'sd', 'sk', 'amount', 'saldo', 'name', 'desc'];
  /** The import presets. kind: 'tb' (bruto bilanca: one row per account for a period, no dates) or 'gl' (glavna
   * knjiga: one row per posting, with its date). The column names are what the programs' Slovenian/Croatian exports
   * usually carry; the app reads any of the names in XH, so a renamed column still works, and the preview lets you
   * pick the columns by hand. CHECK against a real export from each program before selling. */
  var PRESETS = [
    { id: 'minimax-tb', name: 'Minimax · bruto bilanca', kind: 'tb', heads: ['Konto', 'Naziv konta', 'Otvoritev debet', 'Otvoritev kredit', 'Promet debet', 'Promet kredit', 'Saldo debet', 'Saldo kredit'] },
    { id: 'minimax-gl', name: 'Minimax · glavna knjiga', kind: 'gl', heads: ['Datum knjiženja', 'Temeljnica', 'Konto', 'Naziv konta', 'Opis', 'Debet', 'Kredit'] },
    { id: 'pantheon-tb', name: 'Pantheon · bruto bilanca', kind: 'tb', twoRow: true, heads: ['Konto', 'Naziv', 'Otvoritev Debet', 'Otvoritev Kredit', 'Promet Debet', 'Promet Kredit', 'Saldo Debet', 'Saldo Kredit'] },
    { id: 'pantheon-gl', name: 'Pantheon · glavna knjiga', kind: 'gl', heads: ['Konto', 'Datum knj.', 'Dokument', 'Opis', 'Debet', 'Kredit', 'Duguje', 'Potražuje'] },
    { id: 'simple', name: 'Month, account, amount', kind: 'simple', heads: ['month', 'account', 'amount', 'description'] }
  ];
  /** The preset whose column names match best (a two-row header counts for Pantheon's trial balance). */
  function detectPreset(heads, kind, twoRow) {
    var hn = (heads || []).map(normHead), best = null, bs = -1;
    PRESETS.forEach(function (p) {
      if (p.kind !== kind) return;
      var sc = p.heads.filter(function (x) { return hn.indexOf(normHead(x)) >= 0; }).length + (p.twoRow ? (twoRow ? 3 : -3) : 0);
      if (sc > bs) { bs = sc; best = p; }
    });
    return best ? best.id : 'simple';
  }
  var SUBHEAD = ['debet', 'kredit', 'breme', 'dobro', 'duguje', 'potrazuje', 'd', 'k', 'p', 'debit', 'credit'];
  function detectDelimiterAny(text) {
    var lines = String(text || '').split(/\r?\n/).filter(function (l) { return l.trim(); }).slice(0, 25), best = { '\t': 0, ';': 0, ',': 0 };
    lines.forEach(function (line) {
      var c = { '\t': 0, ';': 0, ',': 0 }, q = false;
      for (var i = 0; i < line.length; i++) { var ch = line.charAt(i); if (ch === '"') q = !q; else if (!q && c[ch] !== undefined) c[ch]++; }
      Object.keys(c).forEach(function (k) { if (c[k] > best[k]) best[k] = c[k]; });
    });
    if (best['\t'] && best['\t'] >= best[';'] && best['\t'] >= best[',']) return '\t';
    if (best[';'] && best[';'] >= best[',']) return ';';
    return best[','] ? ',' : ';';
  }
  function findCols(hn, force) {
    var col = {}, taken = {};
    XH_ORDER.forEach(function (k) {
      col[k] = -1;
      if (force && force[k] != null) { col[k] = +force[k]; if (col[k] >= 0) taken[col[k]] = true; return; }
      for (var a = 0; a < XH[k].length && col[k] < 0; a++) for (var i = 0; i < hn.length; i++) if (!taken[i] && hn[i] === XH[k][a]) { col[k] = i; taken[i] = true; break; }
    });
    return col;
  }
  function mergeHead(top, sub) {
    var out = [], carry = '';
    for (var i = 0; i < Math.max(top.length, sub.length); i++) {
      var t = String(top[i] || '').trim(), s = String(sub[i] || '').trim();
      if (t) carry = t;
      out.push(s ? (carry && normHead(carry) !== normHead(s) ? carry + ' ' + s : s) : t);
    }
    return out;
  }
  /** The period a trial balance covers, from the lines above its header ("Obdobje: 01.01.2026 - 30.09.2026"):
   * { y, m, cumulative } or null. From the 1st of January to a later month end = year to date (cumulative). */
  function periodFromText(lines) {
    var re = /(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})\.?\s*(?:-|–|—|do|to|until)\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/, iso = /(\d{4})-(\d{2})-(\d{2})\s*(?:-|–|—|do|to)\s*(\d{4})-(\d{2})-(\d{2})/;
    for (var i = 0; i < lines.length; i++) {
      var s = lines[i], m = re.exec(s), a, b;
      if (m) { a = [+m[3], +m[2], +m[1]]; b = [+m[6], +m[5], +m[4]]; }
      else if ((m = iso.exec(s))) { a = [+m[1], +m[2], +m[3]]; b = [+m[4], +m[5], +m[6]]; }
      else continue;
      if (a[0] !== b[0] || b[1] < 1 || b[1] > 12 || b[2] !== daysInMonth(b[0], b[1])) continue;
      if (a[1] === b[1] && a[2] === 1) return { y: b[0], m: b[1], cumulative: false };
      if (a[1] === 1 && a[2] === 1) return { y: b[0], m: b[1], cumulative: true };
    }
    return null;
  }
  /** An Excel day number (1900 system) → { y, m }, for dates that came out of an .xlsx file as numbers. */
  function excelMonth(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (!/^\d{5}(\.\d+)?$/.test(s)) return null;
    var n = Math.floor(+s);
    if (n < 32874 || n > 109574) return null; // 1990 … 2199
    var d = new Date(Date.UTC(1899, 11, 30) + n * DAY);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 };
  }
  /** Read an export from an accounting program: a trial balance (bruto bilanca) or a general ledger (glavna knjiga),
   * with Slovenian, Croatian or English column names, title lines above the header and two-row headers ("Promet" over
   * "Debet | Kredit"). Debit − credit becomes the amount (ledger signs: income comes in negative). The simple
   * "month; account; amount" file goes to parseActuals.
   * opts: { accounts, years, period: { y, m, cumulative } for a file without dates, cols: { role: column index } to
   * override the columns found, siChart (default true): leave out accounts outside classes 4 and 7 }.
   * Returns parseActuals' fields plus: format ('tb' | 'gl' | 'simple'), preset (best match), heads (column names),
   * cols, needsPeriod (a trial balance without a period yet), periodGuess, skipped ([{ code, rows, cents, reason }]
   * for accounts left out: 'balance' | 'other' | 'transfer' | 'total'), ignored (rows without an account, e.g. headings
   * and totals). */
  function parseExport(text, opts) {
    opts = opts || {};
    var res = { rows: [], errors: [], unknown: [], months: [], delimiter: ';', decimal: ',', header: true, signGuess: 'ledger', format: 'simple', preset: 'simple',
      heads: [], cols: null, needsPeriod: false, periodGuess: null, skipped: [], ignored: 0, ignoredText: [] };
    text = stripBom(String(text || ''));
    if (!text.trim()) { res.errors.push({ row: 0, msg: 'The file is empty.' }); return res; }
    var d = detectDelimiterAny(text);
    var all = [];
    splitCsv(text, d).forEach(function (cells, i) {
      cells = cells.map(function (c) { return String(c).trim(); });
      if (cells.some(function (c) { return c !== ''; })) all.push({ n: i + 1, cells: cells });
    });
    // the header: the first of the first 25 rows that names an account column and an amount column
    var h = -1, col = null, heads = null, sub = false;
    for (var i = 0; i < Math.min(all.length, 25) && h < 0; i++) {
      var hd = all[i].cells, next = all[i + 1] ? all[i + 1].cells : [];
      var subN = next.filter(function (c) { return SUBHEAD.indexOf(normHead(c)) >= 0; }).length;
      var use = subN >= 2 ? mergeHead(hd, next) : hd, cc = findCols(use.map(normHead), opts.cols);
      if (cc.account >= 0 && (cc.debit >= 0 || cc.sd >= 0 || cc.amount >= 0 || cc.saldo >= 0)) { h = i; col = cc; heads = use; sub = subN >= 2; }
    }
    var simple = col && col.debit < 0 && col.sd < 0 && col.amount >= 0 && heads.map(normHead).some(function (x) { return HEADS.month.indexOf(x) >= 0; });
    if (!col || simple) {
      var p = parseActuals(text, opts);
      p.format = 'simple'; p.preset = 'simple'; p.heads = []; p.cols = null; p.needsPeriod = false; p.periodGuess = null; p.skipped = []; p.ignored = 0; p.ignoredText = [];
      return postFilter(p, opts);
    }
    res.delimiter = d; res.heads = heads; res.cols = col;
    var body = all.slice(h + (sub ? 2 : 1));
    var hasDate = col.date >= 0 || col.period >= 0;
    res.format = hasDate ? 'gl' : 'tb';
    res.preset = detectPreset(heads, res.format, sub);
    if (!hasDate) {
      res.periodGuess = periodFromText(all.slice(0, h).map(function (r) { return r.cells.join(' '); }));
      if (!opts.period) { res.needsPeriod = true; }
    }
    var amtCols = [col.debit, col.credit, col.sd, col.sk, col.amount, col.saldo].filter(function (x) { return x >= 0; });
    var dec = detectDecimal([].concat.apply([], body.map(function (r) { return amtCols.map(function (k) { return r.cells[k]; }); })), d);
    res.decimal = dec;
    var known = knownOf(opts.accounts), years = opts.years || null, per = opts.period;
    function amt(cells, k) { var s = String(cells[k] == null ? '' : cells[k]).trim(); if (!s || s === '-') return 0; return parseAmount(s, dec); }
    body.forEach(function (r) {
      var c = r.cells, raw = String(c[col.account] || '').trim(), code = raw.split(/\s+/)[0], errs = [], cents;
      if (!/^\d[\d.\-\/]*$/.test(code)) {
        if (code && known[raw]) code = raw;
        else { res.ignored++; if (res.ignoredText.length < 4 && c.join('').trim()) res.ignoredText.push(c.filter(Boolean).slice(0, 3).join(' · ')); return; }
      }
      if (col.debit >= 0 && col.credit >= 0) { var dv = amt(c, col.debit), kv = amt(c, col.credit); cents = dv === null || kv === null ? null : dv - kv; }
      else if (col.sd >= 0 && col.sk >= 0) { var sdv = amt(c, col.sd), skv = amt(c, col.sk); cents = sdv === null || skv === null ? null : sdv - skv; }
      else cents = amt(c, col.amount >= 0 ? col.amount : col.saldo >= 0 ? col.saldo : col.debit);
      if (cents === null) errs.push('an amount in this row is not a number');
      var mm = null;
      if (hasDate) {
        var dr = c[col.date >= 0 ? col.date : col.period];
        mm = parseMonth(dr) || excelMonth(dr);
        if (!mm) errs.push('"' + (dr || '') + '" is not a date');
      } else if (per) mm = { y: per.y, m: per.m };
      if (mm && years && years.indexOf(mm.y) < 0) errs.push(mm.y + ' is outside ' + years.join(' and '));
      if (errs.length) { res.errors.push({ row: r.n, msg: errs.join('; ') }); return; }
      if (!hasDate && !cents) return; // a trial balance lists accounts without turnover too
      var desc = col.name >= 0 && c[col.name] ? String(c[col.name]) : col.desc >= 0 ? String(c[col.desc] || '') : raw.slice(code.length).trim();
      if (mm) res.rows.push({ row: r.n, y: mm.y, m: mm.m, code: code, cents: cents, desc: desc });
      else res.rows.push({ row: r.n, y: 0, m: 0, code: code, cents: cents, desc: desc, pending: true });
    });
    if (res.needsPeriod) {
      res.pendingRows = res.rows.length; // read, but they need a month before they can be imported
      res.rows = [];
    }
    summarize(res, known);
    res.signGuess = 'ledger';
    return postFilter(res, opts);
  }
  /** Leave out what must not be imported: subtotal rows (a code that is the start of a longer code in the same file,
   * e.g. "47" or "470" above "470000") and, on the Slovenian chart, accounts outside the P&L. Accounts the app
   * already knows are always kept. */
  function postFilter(res, opts) {
    var known = knownOf(opts.accounts), codes = {}, drop = {}, si = opts.siChart !== false;
    res.rows.forEach(function (r) { codes[r.code] = true; });
    var list = Object.keys(codes);
    list.forEach(function (x) {
      if (known[x]) return;
      if (list.some(function (y) { return y !== x && y.length > x.length && y.indexOf(x) === 0; })) drop[x] = 'total';
      else if (si && /^\d/.test(x)) { var k = siClass(x); if (!k.pl) drop[x] = k.reason; }
    });
    if (!Object.keys(drop).length) return res;
    var sk = {};
    res.rows = res.rows.filter(function (r) {
      if (!drop[r.code]) return true;
      var s = sk[r.code] || (sk[r.code] = { code: r.code, rows: 0, cents: 0, reason: drop[r.code], desc: r.desc });
      s.rows++; s.cents += r.cents;
      return false;
    });
    res.skipped = (res.skipped || []).concat(Object.keys(sk).sort().map(function (k) { return sk[k]; }));
    summarize(res, known);
    if (res.format !== 'simple') res.signGuess = 'ledger';
    return res;
  }
  /** A year-to-date trial balance → one month: subtract what months 1..m−1 already hold for each account (in the
   * file's signs), and add a row for known accounts that had amounts earlier but are missing from the file (their
   * year to date is zero). Months 1..m−1 must hold actuals; the app checks that. Returns the new rows. */
  function deCumulate(rows, actuals, accounts, y, m, sign) {
    var by = knownOf(accounts), yr = (actuals || {})[y] || {}, done = {}, out = [];
    function prior(code) {
      var a = by[code], arr = yr[code]; if (!arr) return 0;
      var s = sumRange(arr, 1, m - 1);
      return sign === 'ledger' && (a ? (a.kind || kindFromCode(a.code)) : kindFromCode(code)) === 'income' ? -s : s;
    }
    (rows || []).forEach(function (r) { var p = done[r.code] ? 0 : prior(r.code); done[r.code] = true; out.push(Object.assign({}, r, { cents: r.cents - p })); });
    Object.keys(yr).forEach(function (code) { if (!done[code] && by[code]) { var p = prior(code); if (p) out.push({ row: 0, y: y, m: m, code: code, cents: -p, desc: 'Not in the file: year to date is zero' }); } });
    return out;
  }

  // ── headcount plan ───────────────────────────────────────────────────────
  // Employer contributions on gross pay (defaults; the rate is a setting because it changes):
  //  - Slovenia 17,10 %: pension and disability 8,85 % (ZPIZ-2, Art. 153), health 6,56 % + injury at work 0,53 %
  //    (ZZVZZ, Art. 48), parental protection 0,10 % (ZSDP-1) and unemployment 0,06 % (ZUTD) = 16,10 %, plus the
  //    long-term care contribution of 1,00 % from 1. 7. 2025 (Zakon o dolgotrajni oskrbi, ZDOsk-1, Uradni list RS,
  //    št. 84/23). Before July 2025 the total was 16,10 %.
  //  - Croatia 16,50 %: health insurance on gross pay (Zakon o doprinosima, NN 84/08 … 114/22, Art. 14), the only
  //    contribution the employer pays on top since 2019; pension contributions (20 %) come out of the gross.
  // Meal and commuting allowances are within the tax-free limits and carry no contributions (SI: Uredba o davčni
  // obravnavi povračil stroškov …; HR: Pravilnik o porezu na dohodak). Holiday allowance (regres) carries no
  // contributions in Slovenia up to the average monthly wage (ZPIZ-2, Art. 144). CHECK each year.
  var CONTRIB = { SI: 17.1, HR: 16.5 };
  function monthIndex(s) { var m = /^(\d{4})-(\d{2})$/.exec(String(s || '')); return m ? +m[1] * 12 + (+m[2] - 1) : null; }
  /** The share of each month of `year` a row works: 1 inside from..to (YYYY-MM, inclusive; empty = open), else 0. */
  function activeMonths(row, year) {
    var f = monthIndex(row.from), t = monthIndex(row.to), out = zeros();
    for (var i = 0; i < 12; i++) { var k = year * 12 + i; out[i] = (f == null || k >= f) && (t == null || k <= t) ? 1 : 0; }
    return out;
  }
  /** The cost of a headcount plan by month, in cents. rows: [{ id, role, country 'SI'|'HR', fte, gross (cents a month
   * at 1 FTE), allow (cents a month at 1 FTE: meal, commuting), from, to }]. opts: { rates: { SI, HR } in %,
   * holiday: cents per FTE, holidayMonth: 1..12 (paid to everyone working that month), other: cents a year of other
   * staff costs (training, bonuses), spread evenly in whole euros }. Each month is rounded to the cent per row, so
   * gross + contrib + allow + holiday + other = total for every month. */
  function headcountCost(rows, year, opts) {
    opts = opts || {};
    var rates = opts.rates || CONTRIB, out = { rows: [], gross: zeros(), contrib: zeros(), allow: zeros(), holiday: zeros(), other: zeros(), total: zeros(), fte: zeros() };
    (rows || []).forEach(function (r) {
      var act = activeMonths(r, year), fte = Math.max(0, +r.fte || 0), rate = rates[r.country] != null ? +rates[r.country] : +rates.SI || 0;
      var x = { id: r.id, gross: zeros(), contrib: zeros(), allow: zeros(), holiday: zeros(), total: zeros(), fte: zeros(), year: 0 };
      for (var i = 0; i < 12; i++) {
        if (!act[i] || !fte) continue;
        var g = Math.round((+r.gross || 0) * fte), c = Math.round(g * rate / 100), a = Math.round((+r.allow || 0) * fte);
        var hol = opts.holiday && opts.holidayMonth === i + 1 ? Math.round(opts.holiday * fte) : 0;
        x.gross[i] = g; x.contrib[i] = c; x.allow[i] = a; x.holiday[i] = hol; x.total[i] = g + c + a + hol; x.fte[i] = fte;
      }
      x.year = total(x.total);
      ['gross', 'contrib', 'allow', 'holiday', 'total', 'fte'].forEach(function (k) { for (var i = 0; i < 12; i++) out[k][i] += x[k][i]; });
      out.rows.push(x);
    });
    out.fte = out.fte.map(function (v) { return Math.round(v * 100) / 100; });
    if (opts.other) { out.other = spreadEven(Math.round(opts.other), 12); for (var i = 0; i < 12; i++) out.total[i] += out.other[i]; }
    return out;
  }

  // ── comments in the board pack's languages ───────────────────────────────
  /** The text to print for a comment in a language: the comment itself when it is written in that language (cm.lang,
   * English when not set), else its translation (cm.texts[lang]), else the comment as written. inLang tells whether the
   * text is in the language asked for; lang is the language it is in. */
  function commentText(cm, lang) {
    var own = (cm && cm.lang) || 'en', text = cm ? String(cm.text || '') : '';
    if (lang === own) return { text: text, lang: own, inLang: true };
    var t = cm && cm.texts && typeof cm.texts[lang] === 'string' ? cm.texts[lang].trim() : '';
    if (t) return { text: t, lang: lang, inLang: true };
    return { text: text, lang: own, inLang: false };
  }

  return {
    MONTHS: MONTHS, MONTHS_LONG: MONTHS_LONG, SECTIONS: SECTIONS, LINES: LINES, LINE: LINE, SUBS: SUBS, SUB: SUB, ROWS: ROWS,
    typeOf: typeOf, nameOf: nameOf, linesIn: linesIn, zeros: zeros, sumRange: sumRange, total: total, sum: sum, pad: pad,
    kindFromCode: kindFromCode, isIntArr12: isIntArr12, accountSign: accountSign, aggregate: aggregate, rowsOf: rowsOf, outlook: outlook,
    period: period, pctVar: pctVar, variance: variance, share: share, profitEffect: profitEffect, isFlagged: isFlagged, flags: flags, commentKey: commentKey,
    bridge: bridge, compactBridge: compactBridge,
    roundToTotal: roundToTotal, allocate: allocate, unitFor: unitFor, spreadEven: spreadEven, spreadSeasonal: spreadSeasonal,
    copyGrowth: copyGrowth, pctOf: pctOf, rescale: rescale, makeForecast: makeForecast, forecastName: forecastName,
    isDate: isDate, addDays: addDays, diffDays: diffDays, daysInMonth: daysInMonth, monthEnd: monthEnd, ymKey: ymKey,
    lastClosed: lastClosed, closedFor: closedFor, fiscalYear: fiscalYear, capByLoaded: capByLoaded,
    toCents: toCents, parseInput: parseInput, centsText: centsText,
    stripBom: stripBom, detectDelimiter: detectDelimiter, splitCsv: splitCsv, toCsv: toCsv, parseMonth: parseMonth,
    detectDecimal: detectDecimal, parseAmount: parseAmount, parseActuals: parseActuals, applyImport: applyImport, actualsRows: actualsRows,
    siClass: siClass, suggestLine: suggestLine, PRESETS: PRESETS, detectPreset: detectPreset, parseExport: parseExport, periodFromText: periodFromText,
    excelMonth: excelMonth, deCumulate: deCumulate, CONTRIB: CONTRIB, activeMonths: activeMonths, headcountCost: headcountCost, commentText: commentText
  };
});
