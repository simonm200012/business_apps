/* ContractDates: pure date and deadline rules. All dates are 'YYYY-MM-DD' strings, compared as strings; arithmetic is UTC. UMD so Node can load it. */
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.ContractDates = factory(); })(this, function () {
  'use strict';
  var D0 = Date.UTC(1970, 0, 1), pad = function (n) { return (n < 10 ? '0' : '') + n; };
  function dn(s) { var p = s.split('-'); return Math.round((Date.UTC(+p[0], +p[1] - 1, +p[2]) - D0) / 864e5); }
  function fromDn(n) { return new Date(D0 + n * 864e5).toISOString().slice(0, 10); }
  function addDays(s, n) { return fromDn(dn(s) + n); }
  function daysBetween(a, b) { return dn(b) - dn(a); }
  function dim(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function isEom(s) { var p = s.split('-'); return +p[2] === dim(+p[0], +p[1]); }
  function eom(s) { var p = s.split('-'); return p[0] + '-' + p[1] + '-' + pad(dim(+p[0], +p[1])); }
  /* Month ends stay month ends (30.6. - 3 = 31.3.); other days are clamped (30.5. - 3 = 28.2.). */
  function addMonths(s, n) {
    var p = s.split('-'), y = +p[0], m = +p[1], d = +p[2], keep = d === dim(y, m), t = y * 12 + (m - 1) + n;
    y = Math.floor(t / 12); m = t - y * 12 + 1; var dm = dim(y, m);
    return y + '-' + pad(m) + '-' + pad(keep ? dm : Math.min(d, dm));
  }
  function sub(end, c) { return c.noticeUnit === 'days' ? addDays(end, -c.noticeN) : addMonths(end, -c.noticeN); }
  function noticeDeadline(termEnd, c) {
    var d = sub(termEnd, c);
    if (c.noticeEom && !isEom(d)) d = eom(addMonths(d, -1));
    return d;
  }
  function termEndK(c, k) { return k ? addMonths(c.end, k * c.renewMonths) : c.end; }
  function currentTermEnd(c, today) { var k = 0, t = termEndK(c, 0), guard = 0; while (t < today && guard++ < 2000) t = termEndK(c, ++k); return t; }
  function earliestOpenEnd(c, day) {
    var e = c.noticeUnit === 'days' ? addDays(day, c.noticeN) : addMonths(day, c.noticeN);
    if (c.noticeEom) e = eom(e);
    return { end: e, deadline: sub(e, c) };
  }
  function noDeadline(c) { return c.status === 'ending' || c.status === 'ended' || c.status === 'draft' || !(c.noticeN > 0); }
  /* { deadline, termEnd, kind: 'notice'|'decide'|'open', locked: {deadline, termEnd}|null } or null */
  function nextDeadline(c, today) {
    if (noDeadline(c)) return null;
    if (c.type === 'auto') {
      var t = currentTermEnd(c, today), d = noticeDeadline(t, c);
      if (d >= today) return { deadline: d, termEnd: t, kind: 'notice', locked: null };
      var k = 0; while (termEndK(c, k) < t) k++;
      var t2 = termEndK(c, k + 1);
      return { deadline: noticeDeadline(t2, c), termEnd: t2, kind: 'notice', locked: { deadline: d, termEnd: t } };
    }
    if (c.type === 'fixed') { var fd = noticeDeadline(c.end, c); return c.end < today || fd < today ? null : { deadline: fd, termEnd: c.end, kind: 'decide', locked: null }; }
    var o = earliestOpenEnd(c, today); return { deadline: o.deadline, termEnd: o.end, kind: 'open', locked: null };
  }
  function nextRenewal(c, today) {
    if (c.type !== 'auto' || c.status !== 'active') return null;
    var t = currentTermEnd(c, today); return { date: addDays(t, 1), locked: noticeDeadline(t, c) < today };
  }
  function effectiveEnd(c, today) {
    if (c.endsOn) return c.endsOn;
    if (c.type === 'fixed') return c.end;
    if (c.type === 'auto') return currentTermEnd(c, today);
    return null;
  }
  function indexDates(c, from, to, today) {
    var ix = c.index; if (!ix || ix.mode === 'none') return [];
    var end = effectiveEnd(c, today || from), out = [], y;
    for (y = +from.slice(0, 4); y <= +to.slice(0, 4); y++) {
      var d = ix.on === 'jan1' ? y + '-01-01' : y + c.start.slice(4);
      if (d > c.start && d >= from && d <= to && (!end || d <= end)) out.push(d);
    }
    return out;
  }
  var LBL = { notice: 'Notice deadline', decide: 'Decide: extend or exit', renewal: 'Renews', end: 'Ends', price: 'Price change', decision: 'Decision due', milestone: 'Milestone', start: 'Starts' };
  /* Dated events of types notice, decide, renewal, end, price, decision, milestone, start. */
  function events(c, from, to, today) {
    var ev = [];
    function add(date, type, text) { if (date >= from && date <= to) ev.push({ date: date, type: type, id: c.id, text: text || LBL[type] }); }
    if (c.start > today || c.status === 'draft') add(c.start, 'start');
    if (c.status === 'ending' || c.status === 'ended') add(c.endsOn || c.end, 'end');
    else if (c.type === 'auto') {
      for (var k = 0, guard = 0; guard++ < 400; k++) {
        var t = termEndK(c, k), d = c.noticeN > 0 ? noticeDeadline(t, c) : t;
        if (d > to && t > to) break;
        if (c.noticeN > 0) add(d, 'notice');
        add(addDays(t, 1), 'renewal');
      }
    } else if (c.type === 'fixed') { if (c.noticeN > 0 && c.status !== 'draft') add(noticeDeadline(c.end, c), 'decide'); add(c.end, 'end'); }
    else if (c.endsOn) add(c.endsOn, 'end');
    indexDates(c, from, to, today).forEach(function (d) { add(d, 'price', 'Indexation'); });
    (c.priceChanges || []).forEach(function (p) { add(p.date, 'price', 'Price step'); });
    if (c.decisionBy) add(c.decisionBy, 'decision');
    (c.milestones || []).forEach(function (m) { add(m.date, 'milestone', m.title || 'Milestone'); });
    return ev.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  }
  return { addDays: addDays, addMonths: addMonths, daysBetween: daysBetween, isEom: isEom, eom: eom, noticeDeadline: noticeDeadline, currentTermEnd: currentTermEnd, termEndK: termEndK, nextDeadline: nextDeadline, nextRenewal: nextRenewal, earliestOpenEnd: earliestOpenEnd, effectiveEnd: effectiveEnd, indexDates: indexDates, events: events, LABELS: LBL, dn: dn };
});
