/* ERP & BI Client Atlas: the Leads list (companies and people you are talking to), without the page around it.
 * Used by index.html (window.AtlasLeads) and by tools/tests/client-atlas-leads.test.js (require).
 * A lead: { id, company, contact, channel (a channel id or ''), status, next ('YYYY-MM-DD' or ''), notes, created, updated }.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.AtlasLeads = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var STATUS = [
    ['new', 'New'], ['contacted', 'Contacted'], ['meeting', 'Meeting booked'], ['proposal', 'Proposal sent'], ['won', 'Won'], ['lost', 'Lost']
  ];
  var STATUS_NAME = {}; STATUS.forEach(function (s) { STATUS_NAME[s[0]] = s[1]; });
  var CLOSED = { won: 1, lost: 1 };
  var DATE = /^\d{4}-\d{2}-\d{2}$/;

  function str(v, max) { return typeof v === 'string' ? v.trim().slice(0, max) : ''; }
  function validDate(s) {
    if (!DATE.test(s)) return false;
    var d = new Date(s + 'T12:00:00Z');
    return !isNaN(d) && d.toISOString().slice(0, 10) === s;
  }
  /** A clean lead from whatever was saved (unknown fields dropped, lengths capped); null when it has no company or contact. */
  function clean(o, now) {
    if (!o || typeof o !== 'object') return null;
    var l = {
      id: str(o.id, 40) || ('l' + Math.random().toString(36).slice(2, 10)),
      company: str(o.company, 120), contact: str(o.contact, 120), channel: str(o.channel, 40),
      status: STATUS_NAME[o.status] ? o.status : 'new',
      next: validDate(o.next) ? o.next : '',
      notes: typeof o.notes === 'string' ? o.notes.slice(0, 4000) : '',
      created: str(o.created, 40) || now || '', updated: str(o.updated, 40) || now || ''
    };
    return l.company || l.contact ? l : null;
  }
  /** The saved list, cleaned: bad entries and duplicate ids dropped (the first one is kept). */
  function cleanList(list, now) {
    var seen = {}, out = [];
    (Array.isArray(list) ? list : []).forEach(function (o) {
      var l = clean(o, now); if (!l || seen[l.id]) return;
      seen[l.id] = 1; out.push(l);
    });
    return out;
  }
  function open(l) { return !CLOSED[l.status]; }
  /** 'overdue' (follow-up date before today), 'today', 'soon' (within 7 days), 'later', or '' (no date or closed). */
  function due(l, today) {
    if (!open(l) || !l.next) return '';
    if (l.next < today) return 'overdue';
    if (l.next === today) return 'today';
    return l.next <= addDays(today, 7) ? 'soon' : 'later';
  }
  function addDays(iso, n) { var d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  /** Open leads first by follow-up date (no date last), then closed ones, newest change first. */
  function sort(list) {
    return list.slice().sort(function (a, b) {
      var oa = open(a) ? 0 : 1, ob = open(b) ? 0 : 1;
      if (oa !== ob) return oa - ob;
      if (!oa) {
        var na = a.next || '9999', nb = b.next || '9999';
        if (na !== nb) return na < nb ? -1 : 1;
      }
      return a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : 0;
    });
  }
  /** What the home page's "Needs you today" shows (StratumShell.needs items). */
  function needs(list, today) {
    var over = 0, now = 0;
    list.forEach(function (l) { var d = due(l, today); if (d === 'overdue') over++; else if (d === 'today') now++; });
    var out = [];
    if (over) out.push({ text: over === 1 ? 'Lead follow-up overdue' : 'Lead follow-ups overdue', count: over, href: '/client-atlas/#leads', tone: 'bad' });
    if (now) out.push({ text: now === 1 ? 'Lead to follow up today' : 'Leads to follow up today', count: now, href: '/client-atlas/#leads', tone: 'warn' });
    return out;
  }
  /** "15. 10. 2026" */
  function slDate(iso) { return iso && DATE.test(iso) ? +iso.slice(8, 10) + '. ' + +iso.slice(5, 7) + '. ' + iso.slice(0, 4) : ''; }
  /** CSV for Excel with Slovenian or Croatian settings: ";" between fields, quotes where needed, a BOM so Excel reads UTF-8. */
  function csv(list, channelName) {
    var head = ['Company', 'Contact', 'Channel', 'Status', 'Next follow-up', 'Notes', 'Created', 'Last change'];
    var q = function (v) { v = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; return /[";\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var rows = sort(list).map(function (l) {
      return [l.company, l.contact, channelName ? channelName(l.channel) : l.channel, STATUS_NAME[l.status], slDate(l.next), l.notes,
        slDate((l.created || '').slice(0, 10)), slDate((l.updated || '').slice(0, 10))].map(q).join(';');
    });
    return '﻿' + [head.join(';')].concat(rows).join('\r\n') + '\r\n';
  }
  return { STATUS: STATUS, STATUS_NAME: STATUS_NAME, clean: clean, cleanList: cleanList, open: open, due: due, addDays: addDays, sort: sort, needs: needs, slDate: slDate, csv: csv };
});
