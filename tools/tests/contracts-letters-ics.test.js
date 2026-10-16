// Tests for site/contracts/letters.js and ics.js. Run: node tools/tests/contracts-letters-ics.test.js
'use strict';
const assert = require('assert');
const path = require('path');
const D = require(path.join(__dirname, '../../site/contracts/dates.js'));
const L = require(path.join(__dirname, '../../site/contracts/letters.js'));
const I = require(path.join(__dirname, '../../site/contracts/ics.js'));

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok', n, name); }

const model = {
  sender: { name: 'Primer d.o.o.', address: 'Demo cesta 1', city: '1000 Ljubljana', vat: 'SI00000000' },
  recipient: { name: 'Najem d.o.o.', attn: 'Ana Novak', address: 'Glavna 2\n2000 Maribor' },
  place: 'Ljubljana', date: '2026-10-15', no: 'CT-2026-001', title: 'Office lease', start: '2024-01-01', end: '2027-01-31',
  contract: { noticeN: 3, noticeUnit: 'm', noticeEom: true }, deposit: 1234.5, depositType: 'deposit', withDeposit: true,
  signatory: { name: 'Maja Kos', role: 'Director' }
};

// ── letters ────────────────────────────────────────────────────────────────
t('Slovenian letter: registered mail, subject, end date, notice period, deposit', () => {
  const x = L.noticeLetter(model, 'sl');
  assert.strictEqual(x.registered, 'PRIPOROČENO S POVRATNICO');
  assert.strictEqual(x.subject, 'Zadeva: Odpoved pogodbe CT-2026-001 – Office lease');
  assert.strictEqual(x.placeDate, 'Ljubljana, 15. 10. 2026');
  assert.ok(/Pogodba preneha dne 31\. 1\. 2027\./.test(x.paragraphs[0]), x.paragraphs[0]);
  assert.ok(/odpovedni rok 3 mesece do konca meseca/.test(x.paragraphs[0]));
  assert.ok(/varščino v znesku 1\.234,50 €/.test(x.paragraphs[3]), x.paragraphs[3]);
  assert.deepStrictEqual(x.recipient, ['Najem d.o.o.', 'v roke Ana Novak', 'Glavna 2', '2000 Maribor']);
  assert.deepStrictEqual(x.signature, ['Maja Kos', 'Director', 'Primer d.o.o.']);
  assert.strictEqual(x.bye, 'Lep pozdrav,');
});
t('Croatian letter: dates end with a dot (and no double dot), paucal forms', () => {
  const x = L.noticeLetter(Object.assign({}, model, { contract: { noticeN: 2, noticeUnit: 'm' } }), 'hr');
  assert.strictEqual(x.placeDate, 'Ljubljana, 15. 10. 2026.');
  assert.ok(/Ugovor prestaje s danom 31\. 1\. 2027\.$/.test(x.paragraphs[0]), x.paragraphs[0]);
  assert.ok(!/\.\.$/.test(x.paragraphs[0]));
  assert.ok(/otkazni rok 2 mjeseca/.test(x.paragraphs[0]));
  assert.strictEqual(x.registered, 'PREPORUČENO S POVRATNICOM');
  assert.ok(/^Predmet: Otkaz ugovora/.test(x.subject));
});
t('English letter: name greeting, no deposit sentence when not asked, unknown language falls back', () => {
  const x = L.noticeLetter(Object.assign({}, model, { withDeposit: false }), 'en');
  assert.strictEqual(x.hello, 'Dear Ana Novak,');
  assert.strictEqual(x.bye, 'Kind regards,');
  assert.strictEqual(x.paragraphs.length, 3);
  assert.ok(/ends on 31 January 2027\./.test(x.paragraphs[0]));
  assert.strictEqual(L.noticeLetter(model, 'xx').lang, 'en');
  const anon = L.noticeLetter(Object.assign({}, model, { recipient: { name: 'X' } }), 'en');
  assert.strictEqual(anon.hello, 'Dear Sir or Madam,');
  assert.ok(L.letterText(x).indexOf('BY REGISTERED MAIL WITH RETURN RECEIPT') > 0);
});
t('notice periods in the right grammatical number', () => {
  assert.deepStrictEqual([1, 2, 3, 4, 5, 101, 102].map(k => L.period(k, 'm', 'sl')), ['1 mesec', '2 meseca', '3 mesece', '4 mesece', '5 mesecev', '101 mesec', '102 meseca']);
  assert.deepStrictEqual([1, 2, 5, 30].map(k => L.period(k, 'd', 'sl')), ['1 dan', '2 dneva', '5 dni', '30 dni']);
  assert.deepStrictEqual([1, 2, 5, 11, 21, 22, 12].map(k => L.period(k, 'm', 'hr')), ['1 mjesec', '2 mjeseca', '5 mjeseci', '11 mjeseci', '21 mjesec', '22 mjeseca', '12 mjeseci']);
  assert.strictEqual(L.period(1, 'd', 'en'), '1 day');
  assert.strictEqual(L.noticeText({ noticeN: 0 }, 'sl'), '');
  assert.strictEqual(L.defaultLang('HR', ''), 'hr');
  assert.strictEqual(L.defaultLang('SI', 'DE'), 'en');
});

// ── calendar ───────────────────────────────────────────────────────────────
const base = { id: 'c1', no: 'CT-2025-001', title: 'Cleaning; offices, HQ', party: 'Čistoča d.o.o.', company: 'RSI', owner: 'p1', category: 'facility', status: 'active',
  start: '2025-01-01', end: '2026-12-31', renewal: 'auto', renewMonths: 12, noticeN: 3, noticeUnit: 'm', noticeEom: false, indexType: 'none', history: [], milestones: [{ id: 'm1', date: '2026-11-20', label: 'Ask for an offer' }], decision: { choice: 'undecided', due: '2026-11-01' } };
const ctx = (o) => Object.assign({ D, today: '2026-10-15', months: 12, types: { notice: true, reminder: true, decision: true, milestone: true, end: true, renewal: true, price: true }, alarm: 'cat', remind: { facility: 30 },
  catName: () => 'Cleaning & security', compName: () => 'Tokovi Retail SI', personName: () => 'Maja Kos' }, o || {});
t('events: deadline, its reminder, decision, milestone and renewal; closed contracts are left out', () => {
  const ev = I.calendarEvents([base, Object.assign({}, base, { id: 'c2', status: 'ended' })], ctx());
  const dl = ev.find(e => e.kind === 'notice');
  // the 2026 deadline (30. 9.) has passed, so the next one belongs to the term ending 31. 12. 2027
  assert.strictEqual(dl.date, '2027-09-30');
  assert.strictEqual(dl.alarmDays, 30);
  const rem = ev.find(e => e.kind === 'reminder');
  assert.strictEqual(rem.date, '2027-08-31');
  assert.ok(/^Reminder: notice deadline 30\. 9\. 2027 \(in 30 days\)/.test(rem.summary), rem.summary);
  assert.ok(ev.some(e => e.kind === 'decision' && e.date === '2026-11-01'));
  assert.ok(ev.some(e => e.kind === 'milestone' && e.date === '2026-11-20'));
  assert.ok(ev.some(e => e.kind === 'renewal' && e.date === '2027-01-01'));
  assert.ok(ev.every(e => e.contractId === 'c1'));
  assert.deepStrictEqual(ev.map(e => e.date), ev.map(e => e.date).slice().sort());
});
t('filters: kinds, owner, no reminders, fixed alarm days', () => {
  const only = I.calendarEvents([base], ctx({ types: { notice: true, reminder: false } }));
  assert.deepStrictEqual(only.map(e => e.kind), ['notice']);
  assert.strictEqual(I.calendarEvents([base], ctx({ owner: 'p9' })).length, 0);
  const a7 = I.calendarEvents([base], ctx({ alarm: '7', types: { notice: true, reminder: true } }));
  assert.strictEqual(a7.find(e => e.kind === 'notice').alarmDays, 7);
  assert.strictEqual(a7.find(e => e.kind === 'reminder').date, '2027-09-23');
  assert.strictEqual(I.calendarEvents([base], ctx({ alarm: '0', types: { notice: true, reminder: true } })).filter(e => e.kind === 'reminder').length, 0);
});
t('ics: stable UIDs, escaping, folding at 75 octets, alarms, subscription hints', () => {
  const ev = I.calendarEvents([base], ctx());
  const txt = I.buildIcs(ev, { name: 'Deadlines', stamp: '20261015T080000Z' });
  const again = I.buildIcs(I.calendarEvents([base], ctx()), { name: 'Deadlines', stamp: '20261015T080000Z' });
  assert.strictEqual(txt, again, 'same contracts → same file (UIDs do not change)');
  assert.ok(txt.indexOf('UID:c1-notice-20271231@') > 0);
  assert.ok(txt.indexOf('REFRESH-INTERVAL;VALUE=DURATION:PT12H') > 0);
  assert.ok(/SUMMARY:Notice deadline: Cleaning\\; offices\\, HQ/.test(txt.replace(/\r\n /g, '')));
  assert.ok(txt.indexOf('TRIGGER:-P30D') > 0);
  txt.split('\r\n').forEach(line => assert.ok(Buffer.byteLength(line, 'utf8') <= 75, 'line too long: ' + line));
  assert.ok(/\r\n$/.test(txt));
  assert.strictEqual((txt.match(/BEGIN:VEVENT/g) || []).length, ev.length);
  assert.strictEqual(I.fold('č'.repeat(40)).split('\r\n ')[0].length, 37, 'never splits a UTF-8 character');
});

console.log('\n' + n + ' contracts letter/calendar tests passed');
