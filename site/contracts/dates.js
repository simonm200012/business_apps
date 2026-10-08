/* Contracts & renewals: date rules (pure functions, no DOM). Used by the app and by test-dates.js (node).
 *
 * Dates are local calendar dates as 'YYYY-MM-DD' strings (no time zone involved; "today" is taken in
 * Europe/Ljubljana by the app).
 *
 * Contract fields used here:
 *   start, end ('YYYY-MM-DD' | '' for open-ended), renewal ('auto' | 'fixed' | 'open'), renewMonths (auto),
 *   noticeN (number), noticeUnit ('m' | 'd'), noticeEom (bool), status, endsOn (set when notice was given),
 *   indexType ('none' | 'cpi' | 'fixed'), indexPct, indexOn ('anniversary' | 'jan'), history[] (price changes).
 *
 * Rules:
 *   - "N months before the end": deadline = term end minus N calendar months. A term ending on the last day
 *     of a month keeps month ends (30.6. minus 3 months = 31.3.); other days are clamped (31.5. minus 3 months = 28.2./29.2.).
 *   - "N days before the end": term end minus N days.
 *   - noticeEom ("to the end of the month"): for open-ended contracts the notice period must run to the end
 *     of a calendar month, so a contract can only end on a month end E and notice is due by E minus the
 *     period. For term contracts the deadline is moved back to the last month end on or before it (the
 *     notice must be in by the end of a month; never later than the plain rule).
 *   - Auto-renew: the term rolls forward by renewMonths from the original end date until it reaches today.
 *     The "current term" ends on the first rolled end on or after today; the next renewal is the day after.
 *     If that term's notice deadline has already passed the renewal is locked in, and the next actionable
 *     notice deadline belongs to the following term.
 *   - Open-ended: there is no renewal. The earliest end if notice is given today is today + period
 *     (rounded up to the month end with noticeEom); the matching deadline is that end minus the period.
 *   - Fixed term: ends on the end date; the notice deadline (if a notice period is set) is the date by which
 *     an extension or exit has to be agreed.
 *   - status 'ending' (notice given) or 'ended': no more deadlines or renewals; ends on endsOn or the term end. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ContractDates = api;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function parts(s) { return { y: +s.slice(0, 4), m: +s.slice(5, 7), d: +s.slice(8, 10) }; }
  function ymd(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }
  function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function isDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var p = parts(s);
    return p.y >= 1900 && p.y <= 2200 && p.m >= 1 && p.m <= 12 && p.d >= 1 && p.d <= daysInMonth(p.y, p.m);
  }
  function toUTC(s) { var p = parts(s); return Date.UTC(p.y, p.m - 1, p.d); }
  function fromUTC(t) { var d = new Date(t); return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); }
  function addDays(s, n) { return fromUTC(toUTC(s) + n * 864e5); }
  function diffDays(a, b) { return Math.round((toUTC(b) - toUTC(a)) / 864e5); } // b - a
  function isEom(s) { var p = parts(s); return p.d === daysInMonth(p.y, p.m); }
  function endOfMonth(s) { var p = parts(s); return ymd(p.y, p.m, daysInMonth(p.y, p.m)); }
  function startOfMonth(s) { return s.slice(0, 8) + '01'; }
  function addMonths(s, n) {
    var p = parts(s), idx = p.y * 12 + (p.m - 1) + n, y = Math.floor(idx / 12), m = idx - y * 12 + 1;
    var dim = daysInMonth(y, m);
    return ymd(y, m, isEom(s) ? dim : Math.min(p.d, dim));
  }
  function min(a, b) { return !a ? b : !b ? a : (a < b ? a : b); }
  function max(a, b) { return !a ? b : !b ? a : (a > b ? a : b); }

  // ── notice period arithmetic ─────────────────────────────────────────────
  function hasNotice(c) { return +c.noticeN > 0; }
  function minusPeriod(s, c) { return c.noticeUnit === 'd' ? addDays(s, -(+c.noticeN || 0)) : addMonths(s, -(+c.noticeN || 0)); }
  function plusPeriod(s, c) { return c.noticeUnit === 'd' ? addDays(s, +c.noticeN || 0) : addMonths(s, +c.noticeN || 0); }
  /** notice deadline for a term that ends on termEnd */
  function noticeDeadline(termEnd, c) {
    var d = minusPeriod(termEnd, c);
    if (c.noticeEom && !isEom(d)) d = addDays(startOfMonth(d), -1);
    return d;
  }
  function describeNotice(c) {
    if (!hasNotice(c)) return 'No notice period';
    var n = +c.noticeN, u = c.noticeUnit === 'd' ? (n === 1 ? 'day' : 'days') : (n === 1 ? 'month' : 'months');
    if (c.renewal === 'open') return n + ' ' + u + (c.noticeEom ? ' to the end of a month' : ' notice');
    return n + ' ' + u + ' before the end' + (c.noticeEom ? ' (by a month end)' : '');
  }

  // ── terms ────────────────────────────────────────────────────────────────
  /** k-th term end of an auto-renewing contract (k = 0 is the original end date) */
  function termEndK(c, k) { return addMonths(c.end, k * (+c.renewMonths || 12)); }
  /** first term end on or after `today` (auto), the end date (fixed), null (open) */
  function currentTermEnd(c, today) {
    if (c.renewal === 'open' || !isDate(c.end)) return null;
    if (c.renewal !== 'auto') return c.end;
    if (c.end >= today) return c.end;
    var k = 0, t = c.end;
    while (t < today && k < 2000) { k++; t = termEndK(c, k); }
    return t;
  }
  function isClosed(c) { return c.status === 'ending' || c.status === 'ended'; }
  /** the date the contract actually stops, or null if it runs on */
  function effectiveEnd(c, today) {
    if (c.status === 'ended') return isDate(c.endsOn) ? c.endsOn : (isDate(c.end) ? c.end : null);
    if (c.status === 'ending') return isDate(c.endsOn) ? c.endsOn : currentTermEnd(c, today) || (isDate(c.end) ? c.end : null);
    if (c.renewal === 'fixed') return isDate(c.end) ? c.end : null;
    return null;
  }
  /** earliest possible end if notice is given on `day` (open-ended), with its deadline */
  function earliestOpenEnd(c, day) {
    var e = hasNotice(c) ? plusPeriod(day, c) : day;
    if (c.noticeEom) e = endOfMonth(e);
    var dl = hasNotice(c) ? minusPeriod(e, c) : e;
    if (dl < day) { // month arithmetic can land a day short: move to the next month end
      e = c.noticeEom ? endOfMonth(addDays(e, 1)) : addDays(e, 1);
      dl = minusPeriod(e, c);
    }
    return { end: e, deadline: dl };
  }

  /** The next notice deadline that can still be met (or null).
   *  → { deadline, termEnd, kind: 'notice' | 'decide' | 'open', locked: {deadline, termEnd} | null } */
  function nextDeadline(c, today) {
    if (isClosed(c) || c.status === 'draft' || !hasNotice(c)) return null;
    if (c.renewal === 'open') {
      if (!isDate(c.start)) return null;
      var o = earliestOpenEnd(c, max(today, c.start));
      return { deadline: o.deadline, termEnd: o.end, kind: 'open', locked: null };
    }
    if (!isDate(c.end)) return null;
    if (c.renewal === 'fixed') {
      if (c.end < today) return null;
      var d = noticeDeadline(c.end, c);
      return d >= today ? { deadline: d, termEnd: c.end, kind: 'decide', locked: null } : null;
    }
    var t = currentTermEnd(c, today), k = 0, locked = null;
    // find the k of the current term
    var tt = c.end; while (tt < t && k < 2000) { k++; tt = termEndK(c, k); }
    var dl = noticeDeadline(t, c);
    if (dl < today) { locked = { deadline: dl, termEnd: t }; t = termEndK(c, k + 1); dl = noticeDeadline(t, c); }
    return { deadline: dl, termEnd: t, kind: 'notice', locked: locked };
  }

  /** next automatic renewal → { termEnd, date (first day of the new term), locked } or null */
  function nextRenewal(c, today) {
    if (c.renewal !== 'auto' || isClosed(c) || c.status === 'draft' || !isDate(c.end)) return null;
    var t = currentTermEnd(c, today);
    var dl = hasNotice(c) ? noticeDeadline(t, c) : t;
    return { termEnd: t, date: addDays(t, 1), locked: dl < today };
  }

  // ── price changes ────────────────────────────────────────────────────────
  /** indexation dates in [from, to] (inclusive) */
  function indexDates(c, from, to) {
    if (!c.indexType || c.indexType === 'none' || !isDate(c.start)) return [];
    var out = [], d;
    if (c.indexOn === 'jan') {
      for (var y = +from.slice(0, 4); y <= +to.slice(0, 4); y++) {
        d = y + '-01-01';
        if (d > c.start && d >= from && d <= to) out.push(d);
      }
    } else {
      var k = 1; d = addMonths(c.start, 12);
      while (d < from && k < 400) { k++; d = addMonths(c.start, 12 * k); }
      while (d <= to && k < 400) { out.push(d); k++; d = addMonths(c.start, 12 * k); }
    }
    var stop = effectiveEnd(c, from);
    return out.filter(function (x) { return !stop || x <= stop; });
  }

  /** every dated event of a contract in [from, to] → [{date, type, label, contractId}]
   *  types: notice, decide, renewal, end, price, decision, milestone, start */
  function events(c, from, to, opts) {
    opts = opts || {};
    var out = [], today = opts.today || from;
    function add(date, type, label, extra) { if (date >= from && date <= to) out.push(Object.assign({ date: date, type: type, label: label, id: c.id }, extra || {})); }
    if (c.status === 'draft') return out;
    if (isDate(c.start)) add(c.start, 'start', 'Starts');
    var stop = effectiveEnd(c, today);
    if (isClosed(c) || c.renewal === 'fixed') {
      if (stop) add(stop, 'end', c.status === 'ended' ? 'Ended' : 'Ends');
      if (c.renewal === 'fixed' && !isClosed(c) && hasNotice(c) && isDate(c.end)) add(noticeDeadline(c.end, c), 'decide', 'Decide on extension or exit');
    } else if (c.renewal === 'auto' && isDate(c.end)) {
      var k = 0, t = c.end;
      while (k < 2000) {
        var dl = hasNotice(c) ? noticeDeadline(t, c) : null;
        if (dl && dl > to) break;
        if (dl) add(dl, 'notice', 'Notice deadline (renews ' + fmt(addDays(t, 1)) + ')', { termEnd: t });
        if (addDays(t, 1) > to) break;
        add(addDays(t, 1), 'renewal', 'Renews for ' + (+c.renewMonths || 12) + ' months', { termEnd: t });
        k++; t = termEndK(c, k);
      }
    } else if (c.renewal === 'open' && opts.openDeadline !== false) {
      var nd = nextDeadline(c, today);
      if (nd) add(nd.deadline, 'notice', 'Notice by this date to end on ' + fmt(nd.termEnd), { termEnd: nd.termEnd, open: true });
    }
    indexDates(c, from, to).forEach(function (d) {
      add(d, 'price', c.indexType === 'cpi' ? 'CPI indexation' : 'Price +' + String(c.indexPct).replace('.', ',') + ' % (contractual)', { index: true });
    });
    (c.history || []).forEach(function (h) {
      if (h.kind === 'price' && h.newAmount != null && h.date > today) add(h.date, 'price', 'Scheduled price change', { scheduled: true, newAmount: h.newAmount });
    });
    if (c.decision && c.decision.due && c.decision.choice !== 'renew' && !isClosed(c)) add(c.decision.due, 'decision', 'Decision due: ' + (c.decision.choice || 'undecided'));
    (c.milestones || []).forEach(function (m) { if (isDate(m.date)) add(m.date, 'milestone', m.label || 'Milestone', { milestoneId: m.id }); });
    return out.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  }

  function fmt(s) { return s ? +s.slice(8, 10) + '. ' + +s.slice(5, 7) + '. ' + s.slice(0, 4) : '—'; }

  return {
    isDate: isDate, addDays: addDays, addMonths: addMonths, diffDays: diffDays, endOfMonth: endOfMonth, startOfMonth: startOfMonth,
    isEom: isEom, daysInMonth: daysInMonth, min: min, max: max, fmt: fmt,
    noticeDeadline: noticeDeadline, describeNotice: describeNotice, hasNotice: hasNotice, minusPeriod: minusPeriod, plusPeriod: plusPeriod,
    currentTermEnd: currentTermEnd, termEndK: termEndK, effectiveEnd: effectiveEnd, earliestOpenEnd: earliestOpenEnd,
    nextDeadline: nextDeadline, nextRenewal: nextRenewal, indexDates: indexDates, events: events, isClosed: isClosed
  };
}));
