/* Contracts & renewals: the calendar feed (RFC 5545 iCalendar), pure functions, UMD (browser + Node tests).
 *
 * calendarEvents() turns contracts into dated events (notice deadlines, decide-by dates, decisions due, milestones,
 * renewals, ends, price increases) plus a separate REMINDER event that many calendars need, because Google Calendar
 * and others ignore alarms (VALARM) in imported or subscribed files. buildIcs() writes the file: stable UIDs (contract
 * id + kind + the date it belongs to), so importing the file again, or a subscription refreshing it, updates the events
 * instead of duplicating them; REFRESH-INTERVAL / X-PUBLISHED-TTL tell subscribing calendars how often to re-read it.
 * The same module can render the feed on the server once a subscription URL exists (see the report: a Worker route that
 * reads the cloud copy and returns buildIcs(calendarEvents(...))). */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ContractIcs = api;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var KINDS = ['notice', 'decision', 'milestone', 'renewal', 'end', 'price', 'reminder'];
  var NAME = { notice: 'Notice deadline', decide: 'Decide by', renewal: 'Renewal', end: 'Ends', price: 'Price increase', decision: 'Decision due', milestone: 'Milestone', start: 'Starts', reminder: 'Reminder' };

  function esc(s) { return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }
  function utf8Len(ch) { var c = ch.codePointAt(0); return c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4; }
  /** lines longer than 75 octets are folded (CRLF + space); never inside a UTF-8 character */
  function fold(line) {
    var out = [], cur = '', bytes = 0;
    for (var ch of line) {
      var b = utf8Len(ch);
      if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; }
      cur += ch; bytes += b;
    }
    out.push(cur);
    return out.join('\r\n ');
  }
  function compact(d) { return d.replace(/-/g, ''); }

  /** contracts → events. ctx: { D (ContractDates), today, months (horizon), types: {notice, decision, milestone, renewal, end,
   *  price, reminder: bool}, owner ('' = all), alarm ('cat' | days), remind: {category: days}, openDeadline(c) → bool,
   *  catName(id), compName(id), personName(id) } */
  function calendarEvents(contracts, ctx) {
    var D = ctx.D, today = ctx.today, to = D.addMonths(today, +ctx.months || 12), out = [], ty = ctx.types || {};
    function on(t) { return ty[t] !== false && (ty[t] || t === 'notice'); }
    contracts.forEach(function (c) {
      if (ctx.owner && c.owner !== ctx.owner) return;
      if (!(c.status === 'active' || c.status === 'negotiation' || c.status === 'ending')) return;
      var days = ctx.alarm === 'cat' || ctx.alarm == null ? (ctx.remind && typeof ctx.remind[c.category] === 'number' ? ctx.remind[c.category] : 30) : +ctx.alarm || 0;
      var meta = c.no + ' · ' + (ctx.catName ? ctx.catName(c.category) : c.category) + ' · ' + (ctx.compName ? ctx.compName(c.company) : c.company) + '\nOwner: ' + ((ctx.personName && ctx.personName(c.owner)) || 'none') + '\nNotice: ' + D.describeNotice(c);
      D.events(c, today, to, { today: today, openDeadline: ctx.openDeadline ? ctx.openDeadline(c) : false }).forEach(function (e) {
        var k = e.type === 'decide' ? 'notice' : e.type;
        if (k === 'start' || !on(k)) return;
        var anchor = e.termEnd || e.milestoneId || e.date;
        var summary = (NAME[e.type] || e.type) + ': ' + c.title + ' (' + c.party + ')';
        var isDl = k === 'notice';
        out.push({ uid: c.id + '-' + e.type + '-' + compact(anchor), date: e.date, kind: k, summary: summary, description: e.label + '\n' + meta,
          category: ctx.catName ? ctx.catName(c.category) : c.category, alarmDays: isDl ? days : (ctx.alarm === '0' || ctx.alarm === 0 ? 0 : 1), contractId: c.id });
        // a reminder of its own on the day the reminder window opens (calendars that drop VALARM still show it)
        if (isDl && on('reminder') && days > 0) {
          var rd = D.addDays(e.date, -days);
          if (rd >= today) out.push({ uid: c.id + '-reminder-' + compact(anchor), date: rd, kind: 'reminder', summary: 'Reminder: ' + (NAME[e.type] || e.type).toLowerCase() + ' ' + D.fmt(e.date) + ' (in ' + days + ' days) · ' + c.title + ' (' + c.party + ')',
            description: 'Deadline ' + D.fmt(e.date) + ': ' + e.label + '\n' + meta, category: 'Reminder', alarmDays: 0, contractId: c.id });
        }
      });
    });
    return out.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.uid < b.uid ? -1 : 1; });
  }

  /** events → .ics text. o: { name, stamp (UTC 'YYYYMMDDTHHMMSSZ'), refreshHours, domain } */
  function buildIcs(events, o) {
    o = o || {};
    var h = +o.refreshHours || 12, dom = o.domain || 'contracts.stratum-apps.demo';
    var L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Business Apps//Contracts and renewals//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      'X-WR-CALNAME:' + esc(o.name || 'Contract deadlines'), 'X-WR-TIMEZONE:Europe/Ljubljana', 'REFRESH-INTERVAL;VALUE=DURATION:PT' + h + 'H', 'X-PUBLISHED-TTL:PT' + h + 'H'];
    events.forEach(function (e) {
      L.push('BEGIN:VEVENT', 'UID:' + e.uid + '@' + dom, 'DTSTAMP:' + o.stamp, 'DTSTART;VALUE=DATE:' + compact(e.date), 'DTEND;VALUE=DATE:' + compact(nextDay(e.date)),
        'SUMMARY:' + esc(e.summary), 'DESCRIPTION:' + esc(e.description), 'CATEGORIES:' + esc(e.category), 'TRANSP:TRANSPARENT');
      if (e.alarmDays > 0) L.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + esc(e.summary), 'TRIGGER:-P' + e.alarmDays + 'D', 'END:VALARM');
      L.push('END:VEVENT');
    });
    L.push('END:VCALENDAR');
    return L.map(fold).join('\r\n') + '\r\n';
  }
  function nextDay(s) { var d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10) + 1)); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0'); }

  return { KINDS: KINDS, NAME: NAME, esc: esc, fold: fold, calendarEvents: calendarEvents, buildIcs: buildIcs };
}));
