/* Business Apps · Desk — repeating tasks, snooze dates and the Outlook calendar file (.ics) of a task.
 * Pure functions, no DOM, no network. Runs in the browser (window.DeskSchedule) and in Node for tests.
 *
 * Dates are plain 'YYYY-MM-DD' strings (days in Europe/Ljubljana, as everywhere in Desk).
 * The .ics follows RFC 5545 (iCalendar): CRLF line ends, lines folded at 75 octets, text escaped
 * (\\ ; , and new lines), all-day events as DTSTART;VALUE=DATE with DTEND the next day.
 */
(function (root) {
  'use strict';

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function addDays(iso, n) { var d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function weekday(iso) { return new Date(iso + 'T00:00:00Z').getUTCDay(); }
  function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  // the same day of the month n months later; the 31st becomes the last day of a shorter month
  function addMonths(iso, n, anchorDay) {
    var y = +iso.slice(0, 4), m = +iso.slice(5, 7) + n, d = anchorDay || +iso.slice(8, 10);
    while (m > 12) { m -= 12; y++; }
    while (m < 1) { m += 12; y--; }
    return y + '-' + pad2(m) + '-' + pad2(Math.min(d, daysInMonth(y, m)));
  }

  var REPEATS = [
    { k: '', l: 'Does not repeat' },
    { k: 'daily', l: 'Every day' },
    { k: 'weekdays', l: 'Every working day (Mon–Fri)' },
    { k: 'weekly', l: 'Every week' },
    { k: 'biweekly', l: 'Every 2 weeks' },
    { k: 'monthly', l: 'Every month' },
    { k: 'quarterly', l: 'Every 3 months' },
    { k: 'yearly', l: 'Every year' }
  ];
  function repeatLabel(r) { var k = r && r.every; var x = REPEATS.find(function (o) { return o.k === k; }); return x && k ? x.l : ''; }

  function step(iso, r) {
    var anchor = r.day || +iso.slice(8, 10);
    switch (r.every) {
      case 'daily': return addDays(iso, 1);
      case 'weekdays': var d = addDays(iso, 1); while (weekday(d) === 0 || weekday(d) === 6) d = addDays(d, 1); return d;
      case 'weekly': return addDays(iso, 7);
      case 'biweekly': return addDays(iso, 14);
      case 'monthly': return addMonths(iso, 1, anchor);
      case 'quarterly': return addMonths(iso, 3, anchor);
      case 'yearly': return addMonths(iso, 12, anchor);
      default: return null;
    }
  }
  // the next due date after finishing a repeating task: one step on from its due date (or from
  // today when it had none). Steps that already lie in the past are skipped, so finishing a task
  // that is weeks overdue gives one new task from today on, not a pile of overdue copies.
  function nextDue(dueIso, r, todayIso) {
    if (!r || !r.every) return null;
    var d = step(dueIso || todayIso, r), guard = 0;
    while (d && todayIso && d < todayIso && guard++ < 2000) d = step(d, r);
    return d;
  }
  // what a repeat looks like when it is first set on a task (remembers the day of the month)
  function makeRepeat(every, dueIso) {
    if (!every) return null;
    var r = { every: every };
    if (/monthly|quarterly|yearly/.test(every) && dueIso) r.day = +dueIso.slice(8, 10);
    return r;
  }

  // ---------- snooze ----------

  var WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function snoozeChoices(todayIso) {
    var wd = weekday(todayIso);
    var monday = addDays(todayIso, wd === 1 ? 7 : (8 - wd) % 7 || 7);
    var out = [
      { k: 'tomorrow', l: 'Tomorrow', iso: addDays(todayIso, 1) },
      { k: 'monday', l: 'Next Monday', iso: monday },
      { k: 'week', l: 'In a week', iso: addDays(todayIso, 7) },
      { k: 'month', l: 'In a month', iso: addMonths(todayIso, 1) }
    ];
    // two choices on the same day (on a Sunday, tomorrow is Monday): keep the first
    var seen = {};
    return out.filter(function (c) { if (seen[c.iso]) return false; seen[c.iso] = 1; return true; }).map(function (c) { c.wd = WD[weekday(c.iso)]; return c; });
  }
  function isSnoozed(t, todayIso) { return !!(t && t.status !== 'done' && t.snoozeUntil && t.snoozeUntil > todayIso); }
  // back from a snooze in the last 7 days: shown again in Today
  function backFromSnooze(t, todayIso) { return !!(t && t.status !== 'done' && t.snoozeUntil && t.snoozeUntil <= todayIso && t.snoozeUntil > addDays(todayIso, -7)); }

  // ---------- .ics ----------

  function icsText(s) { return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }
  // fold at 75 octets (UTF-8), never inside a multi-byte character
  function foldLine(line) {
    var out = [], cur = '', bytes = 0, limit = 75;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i], code = line.charCodeAt(i);
      if (code >= 0xD800 && code <= 0xDBFF && i + 1 < line.length) { ch += line[i + 1]; i++; }
      var b = unescape(encodeURIComponent(ch)).length;
      if (bytes + b > limit) { out.push(cur); cur = ' '; bytes = 1; limit = 75; }
      cur += ch; bytes += b;
    }
    out.push(cur);
    return out.join('\r\n');
  }
  function stampOf(date) { return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); }
  function rrule(r, dueIso) {
    if (!r || !r.every) return null;
    var map = { daily: 'FREQ=DAILY', weekdays: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', weekly: 'FREQ=WEEKLY', biweekly: 'FREQ=WEEKLY;INTERVAL=2', monthly: 'FREQ=MONTHLY', quarterly: 'FREQ=MONTHLY;INTERVAL=3', yearly: 'FREQ=YEARLY' };
    var s = map[r.every];
    if (!s) return null;
    // the 29th–31st: Outlook would skip shorter months; "the last day" (-1) is the closest rule for the 31st
    if (/MONTHLY/.test(s) && dueIso) { var d = r.day || +dueIso.slice(8, 10); s += ';BYMONTHDAY=' + (d === 31 ? -1 : d); }
    return 'RRULE:' + s;
  }
  // one all-day event on the due date with a reminder the day before at 9:00 (opens in Outlook,
  // Apple and Google Calendar). opts: { now: Date, description, reminder: false to leave it out }
  function taskIcs(t, opts) {
    opts = opts || {};
    if (!t || !t.due) throw new Error('Set a due date first.');
    var day = t.due.replace(/-/g, ''), end = addDays(t.due, 1).replace(/-/g, '');
    var lines = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Clearfigure//Desk//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      'UID:' + icsText(t.id || 'task') + '@desk.stratum',
      'DTSTAMP:' + stampOf(opts.now || new Date()),
      'DTSTART;VALUE=DATE:' + day,
      'DTEND;VALUE=DATE:' + end,
      'SUMMARY:' + icsText(t.title || 'Task'),
      'TRANSP:TRANSPARENT'
    ];
    var rr = rrule(t.repeat, t.due);
    if (rr) lines.push(rr);
    if (opts.description) lines.push('DESCRIPTION:' + icsText(opts.description));
    if (t.priority === 'high') lines.push('PRIORITY:1');
    if (opts.reminder !== false) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + icsText(t.title || 'Task'), 'TRIGGER:-PT15H', 'END:VALARM');
    lines.push('END:VEVENT', 'END:VCALENDAR');
    return lines.map(foldLine).join('\r\n') + '\r\n';
  }
  function icsFileName(t) {
    var base = String((t && t.title) || 'task').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'task';
    return base + '.ics';
  }

  var api = {
    REPEATS: REPEATS, repeatLabel: repeatLabel, nextDue: nextDue, makeRepeat: makeRepeat, addMonths: addMonths,
    snoozeChoices: snoozeChoices, isSnoozed: isSnoozed, backFromSnooze: backFromSnooze,
    taskIcs: taskIcs, icsFileName: icsFileName, icsText: icsText, foldLine: foldLine, rrule: rrule
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DeskSchedule = api;
})(typeof window !== 'undefined' ? window : this);
