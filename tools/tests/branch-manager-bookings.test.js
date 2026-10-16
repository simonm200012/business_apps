// Tests for site/branch-manager/bm-bookings.js: online self-booking, no-show rate, reminders (SMS, .eml, .ics).
// Run: node tools/tests/branch-manager-bookings.test.js
'use strict';
const assert = require('assert');
const path = require('path');
global.window = global;
require(path.join(__dirname, '../../site/branch-manager/bm-data.js'));
const E = require(path.join(__dirname, '../../site/branch-manager/bm-bookings.js'));

function memStorage() { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; }, _m: m }; }
const TODAY = '2026-10-15'; // Thursday
function eng(o) { return E.create(Object.assign({ storage: memStorage(), today: TODAY, nowMin: 600, now: '2026-10-15T08:00:00Z' }, o || {})); }

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok', n, name); }

t('online slots: free times only, not in the past, at least an hour ahead today', () => {
  const K = eng();
  const today = K.onlineSlots('ljubljana', 'EE20', TODAY);
  assert.ok(today.length > 0);
  assert.ok(today.every(s => s.t >= 600 + 60), 'lead time');
  assert.deepStrictEqual(K.onlineSlots('ljubljana', 'EE20', '2026-10-14'), []); // yesterday
  assert.deepStrictEqual(K.onlineSlots('ljubljana', 'EE20', '2026-10-18'), []); // Sunday
  assert.deepStrictEqual(K.onlineSlots('ljubljana', 'EE20', '2026-10-31'), []); // Reformation Day (SI)
  assert.ok(K.onlineSlots('zagreb', 'EE20', '2026-10-31').length > 0); // a Saturday, open in HR
  assert.deepStrictEqual(K.onlineSlots('osijek', 'EE20', '2026-10-16'), []); // not live yet
  const tomorrow = K.onlineSlots('ljubljana', 'CLF60', '2026-10-16');
  tomorrow.forEach(s => assert.ok(K.roomFree(K.byBranch.ljubljana, '2026-10-16', s.room, s.t, 60)));
});

t('self-booking saves a booking the staff calendar sees, and the slot is gone', () => {
  const store = memStorage();
  const K = eng({ storage: store });
  const s = K.onlineSlots('maribor', 'EE30', '2026-10-16')[0];
  const x = K.selfBook({ branch: 'maribor', svc: 'EE30', date: '2026-10-16', start: s.t, first: 'Ana', last: 'Primer', email: 'ana.primer@example.si', phone: '+386 40 000 111', remindSms: true });
  assert.strictEqual(x.source, 'online');
  assert.strictEqual(x.room, s.room);
  assert.strictEqual(x.dur, 30);
  assert.ok(/^[0-9A-Z]{6}$/.test(x.code));
  assert.deepStrictEqual(x.remind, { sms: true, email: false });
  // a second engine on the same storage (the Bookings page) sees it
  const staff = eng({ storage: store });
  assert.ok(staff.bookingsOn('maribor', '2026-10-16').some(y => y.id === x.id));
  // the same room and time cannot be taken twice
  assert.ok(!staff.onlineSlots('maribor', 'EE30', '2026-10-16').some(y => y.t === s.t && y.room === s.room));
  // cancelling frees it
  staff.cancelOnline(x.id);
  const again = eng({ storage: store });
  assert.strictEqual(again.findBooking(x.id).status, 'cancelled');
  assert.ok(again.onlineSlots('maribor', 'EE30', '2026-10-16').some(y => y.t === s.t));
});

t('self-booking checks the details and refuses a taken time', () => {
  const K = eng();
  const s = K.onlineSlots('celje', 'EE20', '2026-10-16')[0];
  const base = { branch: 'celje', svc: 'EE20', date: '2026-10-16', start: s.t, first: 'Ana', last: 'Primer', email: 'ana@example.si', phone: '+386 40 000 111' };
  assert.throws(() => K.selfBook(Object.assign({}, base, { last: ' ' })), /name/);
  assert.throws(() => K.selfBook(Object.assign({}, base, { email: 'ana@' })), /email/);
  assert.throws(() => K.selfBook(Object.assign({}, base, { phone: '123' })), /phone/);
  assert.throws(() => K.selfBook(Object.assign({}, base, { start: 485 })), /taken/); // not a slot
  assert.throws(() => K.selfBook(Object.assign({}, base, { svc: 'NOPE' })), /service/);
  K.selfBook(base);
  // the slot for one room is gone; if all rooms are full at that time the same start is refused
  const left = K.onlineSlots('celje', 'EE20', '2026-10-16').filter(y => y.t === s.t);
  if (!left.length) assert.throws(() => K.selfBook(base), /taken/);
});

t('no-show rate: past, not cancelled bookings only', () => {
  const K = eng();
  const st = K.noShowStats('ljubljana', '2026-09-15', TODAY);
  assert.ok(st.booked > 500, 'enough bookings: ' + st.booked);
  assert.ok(st.rate > 0 && st.rate < 0.1);
  assert.strictEqual(st.byWeek.reduce((a, w) => a + w.booked, 0), st.booked);
  assert.strictEqual(st.byWeek.reduce((a, w) => a + w.noShows, 0), st.noShows);
  // a future window counts nothing
  assert.strictEqual(K.noShowStats('ljubljana', '2026-10-16', '2026-10-30').booked, 0);
  // marking one more no-show moves the rate by exactly one
  const day = '2026-10-14';
  const x = K.bookingsOn('ljubljana', day).find(y => !y.noShow && y.status !== 'cancelled');
  const before = K.noShowStats('ljubljana', day, day);
  K.setNoShow(x, true);
  const after = K.noShowStats('ljubljana', day, day);
  assert.strictEqual(after.noShows, before.noShows + 1);
  assert.strictEqual(after.booked, before.booked);
  assert.ok(K.customerHistory('ljubljana', x.email, day).noShows >= 1);
  // a booking still to come cannot be a no-show
  const fut = K.bookingsOn('ljubljana', '2026-10-16')[0];
  assert.throws(() => K.setNoShow(fut, true), /after its time/);
});

t('reminder texts in the customer\'s language', () => {
  const K = eng();
  const si = K.bookingsOn('ljubljana', '2026-10-16')[0], hr = K.bookingsOn('zagreb', '2026-10-16')[0];
  const a = K.reminderText(si), b = K.reminderText(hr);
  assert.ok(a.startsWith('Pozdravljeni ' + si.first + ','), a);
  assert.ok(a.includes('v petek, 16. 10. 2026 ob ' + K.hm(si.start)), a);
  assert.ok(a.includes('Clearfigure Optika Ljubljana, Slovenska cesta 41'));
  assert.ok(b.startsWith('Poštovani ' + hr.first + ','), b);
  assert.ok(b.includes('u petak, 16. 10. 2026 u ' + K.hm(hr.start)), b);
  assert.ok(K.reminderText(si, 'en').includes('on Friday, 16. 10. 2026 at'));
  const href = K.smsHref(si);
  assert.ok(href.startsWith('sms:+3861000'), href);
  assert.strictEqual(decodeURIComponent(href.split('&body=')[1]), a);
});

t('.ics: local time with the Ljubljana / Zagreb time zone and two alarms', () => {
  const K = eng();
  const x = K.bookingsOn('ljubljana', '2026-10-16')[0];
  const ics = K.bookingIcs(x, { now: '2026-10-15T08:00:00Z' });
  assert.ok(ics.includes('BEGIN:VTIMEZONE\r\nTZID:Europe/Ljubljana'));
  assert.ok(ics.includes('DTSTART;TZID=Europe/Ljubljana:20261016T' + K.hm(x.start).replace(':', '') + '00'));
  assert.ok(ics.includes('DTEND;TZID=Europe/Ljubljana:20261016T' + K.hm(x.start + x.dur).replace(':', '') + '00'));
  assert.ok(ics.includes('TRIGGER:-P1D') && ics.includes('TRIGGER:-PT2H'));
  assert.ok(ics.includes('DTSTAMP:20261015T080000Z'));
  ics.split('\r\n').forEach(l => assert.ok(Buffer.byteLength(l) <= 75, l));
  const both = K.bookingIcs([x, K.bookingsOn('zagreb', '2026-10-16')[0]], { forStaff: true });
  assert.ok(both.includes('TZID:Europe/Zagreb') && both.split('BEGIN:VEVENT').length === 3);
});

t('.eml: an Outlook draft with the text and the .ics attached', () => {
  const K = eng();
  const x = K.bookingsOn('ljubljana', '2026-10-16')[0];
  const eml = K.bookingEml(x, { now: '2026-10-15T08:00:00Z' });
  assert.ok(eml.startsWith('X-Unsent: 1\r\n'));
  assert.ok(eml.includes('\r\nTo: ' + x.first + ' ' + x.last + ' <' + x.email + '>\r\n') || /\r\nTo: =\?UTF-8\?B\?/.test(eml));
  assert.ok(/\r\nSubject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=\r\n/.test(eml) || eml.includes('Subject: Opomnik'));
  const boundary = /boundary="([^"]+)"/.exec(eml)[1];
  const parts = eml.split('--' + boundary);
  assert.strictEqual(parts.length, 4); // preamble, text, ics, end
  const text = Buffer.from(parts[1].split('\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64').toString('utf8');
  assert.ok(text.startsWith('Pozdravljeni ' + x.first), text);
  assert.ok(text.includes('Slovenska cesta 41'));
  assert.ok(parts[2].includes('Content-Type: text/calendar') && parts[2].includes('filename="termin.ics"'));
  const ics = Buffer.from(parts[2].split('\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64').toString('utf8');
  assert.ok(ics.startsWith('BEGIN:VCALENDAR'));
  // the subject decodes to Slovenian text
  const subj = /Subject: =\?UTF-8\?B\?([^?]+)\?=/.exec(eml);
  if (subj) assert.ok(Buffer.from(subj[1], 'base64').toString('utf8').startsWith('Opomnik: '));
});

t('reminded marks are kept with the bookings', () => {
  const store = memStorage();
  const K = eng({ storage: store });
  const x = K.bookingsOn('kranj', '2026-10-16')[0];
  K.markReminded(x, 'sms');
  assert.ok(eng({ storage: store }).reminded(x).sms);
  // old saved data without "reminded" still loads
  const old = memStorage(); old.setItem('bm-bookings-v1', JSON.stringify({ added: {}, edited: {}, deleted: {} }));
  const K2 = eng({ storage: old });
  assert.deepStrictEqual(K2.store.reminded, {});
  K2.markReminded(x, 'eml');
  assert.ok(JSON.parse(old.getItem('bm-bookings-v1')).reminded[x.id].eml);
});

console.log('\n' + n + ' Branch Manager booking tests passed');
