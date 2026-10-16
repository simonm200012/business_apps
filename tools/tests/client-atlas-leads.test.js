// ERP & BI Client Atlas: the Leads list (site/client-atlas/leads.js): cleaning saved data, due dates, order, the
// "Needs you today" report and the CSV export. Run: node tools/tests/client-atlas-leads.test.js
'use strict';
const assert = require('assert');
const path = require('path');
const L = require(path.join(__dirname, '../../site/client-atlas/leads.js'));
let n = 0;
function t(name, fn) { fn(); n++; console.log('ok', n, name); }
const NOW = '2026-10-15T09:00:00.000Z', TODAY = '2026-10-15';

t('clean keeps a good lead and caps what is too long; drops leads with neither company nor contact', () => {
  const l = L.clean({ id: 'a1', company: '  Primer d.o.o. ', contact: 'Ana Novak, CFO', channel: 'bizi', status: 'meeting', next: '2026-10-20', notes: 'x'.repeat(5000), extra: 1 }, NOW);
  assert.strictEqual(l.company, 'Primer d.o.o.');
  assert.strictEqual(l.notes.length, 4000);
  assert.strictEqual(l.extra, undefined);
  assert.strictEqual(L.clean({ company: ' ', contact: '' }, NOW), null);
  assert.strictEqual(L.clean(null, NOW), null);
});
t('clean fixes unknown status and impossible dates instead of failing', () => {
  const l = L.clean({ company: 'X', status: 'maybe', next: '2026-02-30' }, NOW);
  assert.strictEqual(l.status, 'new');
  assert.strictEqual(l.next, '');
  assert.ok(l.id && l.created === NOW);
});
t('cleanList drops bad entries and duplicate ids, keeps the rest in order', () => {
  const list = L.cleanList([{ id: 'a', company: 'A' }, { id: 'a', company: 'A2' }, 'junk', { id: 'b', contact: 'B' }], NOW);
  assert.deepStrictEqual(list.map((x) => x.id + x.company + x.contact), ['aA', 'bB']);
  assert.deepStrictEqual(L.cleanList(undefined, NOW), []);
});
t('due: overdue, today, soon (7 days), later; closed leads and leads without a date are never due', () => {
  const mk = (next, status) => L.clean({ company: 'X', next, status: status || 'contacted' }, NOW);
  assert.strictEqual(L.due(mk('2026-10-14'), TODAY), 'overdue');
  assert.strictEqual(L.due(mk('2026-10-15'), TODAY), 'today');
  assert.strictEqual(L.due(mk('2026-10-22'), TODAY), 'soon');
  assert.strictEqual(L.due(mk('2026-10-23'), TODAY), 'later');
  assert.strictEqual(L.due(mk('2026-10-01', 'won'), TODAY), '');
  assert.strictEqual(L.due(mk('2026-10-01', 'lost'), TODAY), '');
  assert.strictEqual(L.due(mk(''), TODAY), '');
});
t('addDays crosses months and years', () => {
  assert.strictEqual(L.addDays('2026-10-29', 7), '2026-11-05');
  assert.strictEqual(L.addDays('2026-12-30', 3), '2027-01-02');
});
t('sort: open leads by follow-up date (no date last), then closed ones by last change', () => {
  const list = [
    { id: 'c1', company: 'Won', status: 'won', next: '2026-01-01', updated: '2026-10-01' },
    { id: 'o3', company: 'No date', status: 'new', next: '', updated: '2026-10-10' },
    { id: 'o2', company: 'Later', status: 'new', next: '2026-11-01' },
    { id: 'o1', company: 'Soon', status: 'new', next: '2026-10-16' },
    { id: 'c2', company: 'Lost', status: 'lost', updated: '2026-10-12' }
  ].map((o) => L.clean(o, NOW));
  assert.deepStrictEqual(L.sort(list).map((x) => x.id), ['o1', 'o2', 'o3', 'c2', 'c1']);
});
t('needs: overdue and due-today counts for the home page; nothing when nothing is due', () => {
  const list = L.cleanList([
    { company: 'A', next: '2026-10-10' }, { company: 'B', next: '2026-10-14' }, { company: 'C', next: TODAY },
    { company: 'D', next: '2026-10-20' }, { company: 'E', next: '2026-10-01', status: 'won' }
  ], NOW);
  assert.deepStrictEqual(L.needs(list, TODAY), [
    { text: 'Lead follow-ups overdue', count: 2, href: '/client-atlas/#leads', tone: 'bad' },
    { text: 'Lead to follow up today', count: 1, href: '/client-atlas/#leads', tone: 'warn' }
  ]);
  assert.deepStrictEqual(L.needs(list.slice(3), TODAY), []);
});
t('CSV: semicolons, Slovenian dates, quoting, a BOM, and no formulas from cell text', () => {
  const list = L.cleanList([{ id: 'x', company: 'Kovina; d.o.o.', contact: '=HYPERLINK("http://example.si")', channel: 'bizi', status: 'meeting',
    next: '2026-11-05', notes: 'Said "yes"\nCall back', created: '2026-10-01T08:00:00Z', updated: '2026-10-15T08:00:00Z' }], NOW);
  const out = L.csv(list, (id) => (id === 'bizi' ? 'Bizi.si advanced search' : ''));
  assert.ok(out.startsWith('﻿Company;Contact;Channel;Status;Next follow-up;Notes;Created;Last change\r\n'));
  const row = out.slice(out.indexOf('\r\n') + 2);
  assert.strictEqual(row, '"Kovina; d.o.o.";"\'=HYPERLINK(""http://example.si"")";Bizi.si advanced search;Meeting booked;5. 11. 2026;"Said ""yes""\nCall back";1. 10. 2026;15. 10. 2026\r\n');
});
t('slDate', () => {
  assert.strictEqual(L.slDate('2026-01-05'), '5. 1. 2026');
  assert.strictEqual(L.slDate(''), '');
  assert.strictEqual(L.slDate('soon'), '');
});
console.log('client-atlas-leads: ' + n + ' tests passed');
