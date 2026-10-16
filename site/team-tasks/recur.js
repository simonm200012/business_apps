/* Team Tasks: recurring tasks with Slovenian deadlines. Pure date rules, no DOM; UMD, so it also loads in Node
 * (tools/tests/team-tasks-recur.test.js). Dates are 'YYYY-MM-DD' strings, periods 'YYYY-MM' (a month) or 'YYYY' (a year).
 *
 * A recurring issue carries recur = { rule, period, day? }. When it is completed, the next one is created for the next
 * period with the due date the rule gives (dueFor). The Slovenian presets follow the rules as we understand them;
 * they are defaults to check with the accountant, not tax advice:
 *   ddvo   DDV-O, the monthly VAT return: by the last working day of the month after the tax period
 *          (ZDDV-1, Art. 89; eDavki).
 *   rpo    RP-O, the recapitulative statement of EU supplies: by the 20th day of the month after the period
 *          (ZDDV-1, Art. 90); a deadline on a weekend or holiday moves to the next working day (ZUP Art. 101, which
 *          ZDavP-2 applies to tax procedures).
 *   rek1   REK-1 with the salary for the month: the withholding-tax return is filed on the day the salary is paid
 *          (ZDavP-2); payday is day `day` of the next month (default 15; ZDR-1 Art. 134 sets the 18th as the latest).
 *          On a weekend or holiday we pay and file on the working day before (a company choice; check it).
 *   ddpo   Corporate income tax return (DDPO) and the annual report to AJPES for year Y: by 31 March of Y+1
 *          (ZDDPO-2, Art. 63; ZGD-1 Art. 58), the next working day when 31 March is not one.
 * Generic rules: weekly (period = the due date), monthly on day `day` (next working day), monthEnd (last working day). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TeamTasksRecur = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var DAY = 864e5;
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }
  function toUtc(s) { return Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)); }
  function fromUtc(t) { var d = new Date(t); return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); }
  function addDays(s, n) { return fromUtc(toUtc(s) + n * DAY); }
  function dow(s) { return new Date(toUtc(s)).getUTCDay(); }
  function daysIn(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function isDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && fromUtc(toUtc(s)) === s; }
  function addMonthsYm(ym, n) { var t = +ym.slice(0, 4) * 12 + (+ym.slice(5, 7) - 1) + n, y = Math.floor(t / 12); return y + '-' + pad(t - y * 12 + 1); }

  // Slovenian public holidays that are days off (Zakon o praznikih in dela prostih dnevih); Easter by the anonymous
  // Gregorian algorithm. Whit Sunday is always a Sunday, so it needs no entry.
  function easter(y) {
    var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    var h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    var month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return ymd(y, month, day);
  }
  var hcache = {};
  function holidaysSI(y) {
    if (hcache[y]) return hcache[y];
    var out = {};
    ['01-01', '01-02', '02-08', '04-27', '05-01', '05-02', '06-25', '08-15', '10-31', '11-01', '12-25', '12-26'].forEach(function (x) { out[y + '-' + x] = true; });
    out[addDays(easter(y), 1)] = true; // Easter Monday
    hcache[y] = out;
    return out;
  }
  function isWorkday(s) { var w = dow(s); return w !== 0 && w !== 6 && !holidaysSI(+s.slice(0, 4))[s]; }
  function nextWorkday(s) { while (!isWorkday(s)) s = addDays(s, 1); return s; }   // s itself when it is one
  function prevWorkday(s) { while (!isWorkday(s)) s = addDays(s, -1); return s; }
  function lastWorkday(ym) { return prevWorkday(ym + '-' + pad(daysIn(+ym.slice(0, 4), +ym.slice(5, 7)))); }
  function dayOf(ym, day) { var n = daysIn(+ym.slice(0, 4), +ym.slice(5, 7)); return ym + '-' + pad(Math.min(Math.max(1, +day || 1), n)); }

  var SL_MONTHS = ['januar', 'februar', 'marec', 'april', 'maj', 'junij', 'julij', 'avgust', 'september', 'oktober', 'november', 'december'];
  var RULES = {
    ddvo: { name: 'DDV-O · VAT return', hint: 'last working day of the next month', title: 'Oddaj DDV-O za {period}', step: 'month', si: true },
    rek1: { name: 'REK-1 and salaries', hint: 'on payday', title: 'Plače in REK-1 za {period}', step: 'month', si: true, day: 15 },
    rpo: { name: 'RP-O · EU sales list', hint: 'by the 20th of the next month', title: 'Oddaj RP-O za {period}', step: 'month', si: true },
    ddpo: { name: 'DDPO and AJPES annual report', hint: 'by 31 March', title: 'DDPO in letno poročilo AJPES za {period}', step: 'year', si: true },
    weekly: { name: 'Every week', hint: 'same weekday', step: 'week' },
    monthly: { name: 'Every month on the same day', hint: 'next working day if needed', step: 'month' },
    monthEnd: { name: 'Last working day of every month', hint: 'skips weekends and holidays', step: 'month' }
  };
  /** the due date of the rule's obligation for a period */
  function dueFor(r) {
    var p = r && r.period;
    switch (r && r.rule) {
      case 'ddvo': return lastWorkday(addMonthsYm(p, 1));
      case 'rpo': return nextWorkday(addMonthsYm(p, 1) + '-20');
      case 'rek1': return prevWorkday(dayOf(addMonthsYm(p, 1), r.day || 15));
      case 'ddpo': return nextWorkday((+p + 1) + '-03-31');
      case 'weekly': return p;
      case 'monthly': return nextWorkday(dayOf(p, r.day || 1));
      case 'monthEnd': return lastWorkday(p);
      default: return null;
    }
  }
  function nextPeriod(r) {
    var p = r.period, st = (RULES[r.rule] || {}).step;
    return st === 'year' ? String(+p + 1) : st === 'week' ? addDays(p, 7) : addMonthsYm(p, 1);
  }
  function next(r) { var n = Object.assign({}, r, { period: nextPeriod(r) }); return n; }
  /** start a rule from a day: the first period whose due date is on or after `from` (a date) */
  function start(rule, from, day) {
    var R = RULES[rule];
    if (!R || !isDate(from)) return null;
    var r = { rule: rule };
    if (rule === 'rek1' || rule === 'monthly') r.day = +day || (rule === 'rek1' ? R.day : +from.slice(8, 10));
    if (R.step === 'week') { r.period = from; return r; }
    if (R.step === 'year') r.period = String(+from.slice(0, 4) - 2);
    else r.period = addMonthsYm(from.slice(0, 7), rule === 'monthly' || rule === 'monthEnd' ? -1 : -2);
    for (var k = 0; k < 40 && dueFor(r) < from; k++) r.period = nextPeriod(r);
    return r;
  }
  function periodText(r) {
    var p = r.period;
    if (/^\d{4}$/.test(p)) return p;
    if (/^\d{4}-\d{2}$/.test(p)) return SL_MONTHS[+p.slice(5, 7) - 1] + ' ' + p.slice(0, 4);
    return p;
  }
  /** the title for a period: the preset's Slovenian title, with {period} filled in */
  function titleFor(r, tpl) { return String(tpl || (RULES[r.rule] || {}).title || '').replace('{period}', periodText(r)); }
  function describe(r) {
    var R = r && RULES[r.rule];
    if (!R) return '';
    if (r.rule === 'rek1') return R.name + ' (payday ' + (r.day || 15) + '.)';
    if (r.rule === 'monthly') return 'Every month on the ' + (r.day || 1) + '.';
    return R.name;
  }
  return { RULES: RULES, easter: easter, holidaysSI: holidaysSI, isWorkday: isWorkday, nextWorkday: nextWorkday, prevWorkday: prevWorkday, lastWorkday: lastWorkday,
    addDays: addDays, addMonthsYm: addMonthsYm, dueFor: dueFor, nextPeriod: nextPeriod, next: next, start: start, periodText: periodText, titleFor: titleFor, describe: describe };
});
