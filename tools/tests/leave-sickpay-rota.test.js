// Tests for the Oct 2026 additions to site/leave/engine.js: who pays sick leave (employer / ZZZS / HZZO), care for a
// family member, the shift rota with clock checks, and the e-mail notices (.eml and mailto).
// Run: node tools/tests/leave-sickpay-rota.test.js
'use strict';
const assert = require('assert');
const path = require('path');
const E = require(path.join(__dirname, '../../site/leave/engine.js'));
const D = require(path.join(__dirname, '../../site/leave/data.js'));

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok', n, name); }

function mini(o) {
  o = o || {};
  const settings = E.defaultSettings();
  if (o.settings) o.settings(settings);
  const db = {
    since: '2025-01-01', clockSince: o.clockSince || '',
    locations: [{ id: 'LJ', country: 'SI' }, { id: 'ZG', country: 'HR' }],
    teams: [{ id: 't1', name: 'Warehouse', min: o.min != null ? o.min : 0, managerId: 'm' }],
    people: (o.people || [{ id: 'a' }]).map((p) => Object.assign({ name: 'Person ' + p.id, first: 'P' + p.id, last: 'X', team: 't1', location: 'LJ', hours: 40, workDays: [1, 2, 3, 4, 5],
      start: '2020-01-01', end: '', birth: '1990-06-01', children: 0, disability: false, priorYears: 0, carry: {}, carryUntil: {}, email: p.id + '@example.com' }, p)),
    requests: (o.requests || []).map((r, i) => Object.assign({ id: 'r' + (i + 1), type: 'sick', status: 'approved', halfStart: false, halfEnd: false, reason: '', note: '' }, r)),
    clock: (o.clock || []).map((c, i) => Object.assign({ id: 'k' + (i + 1) }, c)),
    rota: o.rota || {},
    settings
  };
  return E.model(db, o.today || '2026-10-15');
}
function working(M, p, from, n) { // the date of the n-th working day from `from`
  let c = 0, d = from;
  for (;;) { if (E.dayInfo(M, p, d).frac > 0 && ++c === n) return d; d = E.addDays(d, 1); }
}

// ── sick pay ─────────────────────────────────────────────────────────────
t('SI: the employer pays the first 30 working days of an absence, ZZZS from the 31st', () => {
  let M = mini();
  const p = M.P.a, to = working(M, p, '2026-03-02', 40);
  M = mini({ requests: [{ personId: 'a', from: '2026-03-02', to }] });
  const pay = E.sickPay(M, M.P.a), d30 = working(M, M.P.a, '2026-03-02', 30), d31 = working(M, M.P.a, '2026-03-02', 31);
  assert.strictEqual(pay[d30].payer, 'employer');
  assert.strictEqual(pay[d31].payer, 'other');
  assert.strictEqual(pay[d31].insurer, 'ZZZS');
  assert.strictEqual(pay[d31].n, 31);
  const s = E.sickSplit(M, M.P.a, '2026-01-01', '2026-12-31');
  assert.deepStrictEqual([s.employer, s.insurer], [30, 10]);
});

t('SI: Easter Monday inside the absence is not a sick day and does not count towards the 30', () => {
  // Easter Monday 2026 = 6 April
  const M = mini({ requests: [{ personId: 'a', from: '2026-03-30', to: '2026-05-29' }] });
  const pay = E.sickPay(M, M.P.a);
  assert.ok(!pay['2026-04-06'], 'holiday');
  assert.strictEqual(pay['2026-04-07'].n, 6); // Mon–Fri 30.3.–3.4. = 5, Easter Monday skipped
});

t('SI: back-to-back sick notes (Friday, then Monday) are one absence; a working day between starts a new one', () => {
  const M = mini({ requests: [
    { personId: 'a', from: '2026-01-05', to: working(mini(), mini().P.a, '2026-01-05', 25) },
    { personId: 'a', from: '2026-02-09', to: '2026-02-20' } // starts the Monday after 25 working days end on Friday 6. 2.
  ] });
  assert.strictEqual(working(M, M.P.a, '2026-01-05', 25), '2026-02-06');
  const pay = E.sickPay(M, M.P.a);
  assert.strictEqual(pay['2026-02-13'].payer, 'employer'); // day 30
  assert.strictEqual(pay['2026-02-16'].payer, 'other');    // day 31
  // with a working day in between it starts again from day 1
  const M2 = mini({ requests: [
    { personId: 'a', from: '2026-01-05', to: '2026-02-06' },
    { personId: 'a', from: '2026-02-10', to: '2026-02-20' }
  ] });
  const p2 = E.sickPay(M2, M2.P.a);
  assert.strictEqual(p2['2026-02-10'].n, 1);
  assert.strictEqual(p2['2026-02-20'].payer, 'employer');
});

t('SI: at most 120 employer days in a calendar year, then ZZZS even for a short absence', () => {
  const reqs = [], M0 = mini(), p = M0.P.a;
  // five absences of 25 working days each, separated by a working week
  let d = '2026-01-05';
  for (let i = 0; i < 5; i++) { const end = working(M0, p, d, 25); reqs.push({ personId: 'a', from: d, to: end }); d = working(M0, p, E.addDays(end, 1), 6); }
  const M = mini({ requests: reqs }), s = E.sickSplit(M, M.P.a, '2026-01-01', '2026-12-31');
  assert.strictEqual(s.employer, 120);
  assert.strictEqual(s.insurer, 5);
  // a new year starts a new count
  const M3 = mini({ requests: reqs.concat([{ personId: 'a', from: '2027-01-11', to: '2027-01-15' }]) });
  assert.strictEqual(E.sickSplit(M3, M3.P.a, '2027-01-01', '2027-12-31').employer, 5);
});

t('HR: the employer pays the first 42 calendar days, HZZO from the 43rd', () => {
  const M = mini({ people: [{ id: 'z', location: 'ZG' }], requests: [{ personId: 'z', from: '2026-03-02', to: '2026-04-30' }] });
  const pay = E.sickPay(M, M.P.z);
  // 2. 3. is day 1, so 12. 4. (a Sunday) is day 42 and Monday 13. 4. is day 43; Easter Monday 6. 4. is a holiday in HR too
  assert.strictEqual(E.diffDays('2026-03-02', '2026-04-13') + 1, 43);
  assert.strictEqual(pay['2026-04-10'].payer, 'employer');
  assert.strictEqual(pay['2026-04-13'].payer, 'other');
  assert.strictEqual(pay['2026-04-13'].insurer, 'HZZO');
  assert.strictEqual(E.sickRules(M, M.P.z).unit, 'calendar');
});

t('settings change the rule: 20 working days and no yearly limit', () => {
  const M = mini({ settings: (s) => { s.sickPay.SI = { employerDays: 20, unit: 'working', yearCap: 0, insurer: 'ZZZS' }; }, requests: [{ personId: 'a', from: '2026-03-02', to: '2026-04-30' }] });
  const s = E.sickSplit(M, M.P.a, '2026-01-01', '2026-12-31');
  assert.strictEqual(s.employer, 20);
  assert.ok(s.insurer > 0);
});

t('care for a family member: health insurance pays from day 1; pending sick days are not counted', () => {
  const M = mini({ requests: [{ personId: 'a', type: 'care', from: '2026-03-02', to: '2026-03-04' }, { personId: 'a', from: '2026-05-04', to: '2026-05-05', status: 'pending' }] });
  const pay = E.sickPay(M, M.P.a);
  assert.strictEqual(pay['2026-03-02'].payer, 'other');
  assert.ok(!pay['2026-05-04']);
  const s = E.sickSplit(M, M.P.a, '2026-01-01', '2026-12-31');
  assert.deepStrictEqual([s.employer, s.insurer, s.care], [0, 0, 3]);
  assert.strictEqual(E.TYPE.care.payer, 'other');
  assert.strictEqual(E.TYPE.care.approval, false);
});

t('care over 7 working days in SI gets an info note about the ZZZS commission', () => {
  const M = mini();
  const cf = E.conflicts(M, { personId: 'a', type: 'care', from: '2026-03-02', to: '2026-03-12' });
  assert.ok(cf.some((c) => c.kind === 'info' && /ZZZS/.test(c.text)));
  assert.ok(!E.needsNote(cf));
});

t('the monthly record splits sick hours by payer and puts ZZZS days with "paid by others"', () => {
  const M0 = mini(), to = working(M0, M0.P.a, '2026-03-02', 35);
  const M = mini({ requests: [{ personId: 'a', from: '2026-03-02', to }] });
  const rec = E.monthRecord(M, M.P.a, '2026-04'), t2 = rec.totals;
  assert.ok(t2.sickInsurer.days > 0 && t2.sickEmployer.days > 0);
  assert.strictEqual(t2.sickEmployer.days + t2.sickInsurer.days, t2.absence.sick.days);
  assert.strictEqual(t2.otherAbsMin, t2.sickInsurer.min);
  assert.strictEqual(t2.paidAbsMin, t2.sickEmployer.min);
  const day = rec.days.filter((d) => d.absence.some((a) => a.payer === 'other'))[0];
  assert.strictEqual(day.absence[0].insurer, 'ZZZS');
});

t('demo data: a long sick leave in each country goes over to ZZZS and HZZO', () => {
  const today = '2026-10-15', db = D.generate(today), M = E.model(db, today);
  const si = db.people.filter((p) => p.name === 'Samir Hodžić')[0], hr = db.people.filter((p) => p.name === 'Tomislav Jurić')[0];
  assert.ok(E.sickSplit(M, si, '2025-01-01', '2026-12-31').insurer > 0);
  assert.ok(E.sickSplit(M, hr, '2025-01-01', '2026-12-31').insurer > 0);
  assert.ok(db.requests.some((r) => r.type === 'care'));
});

// ── shift rota ───────────────────────────────────────────────────────────
t('usual shifts: a fixed shift, a weekly swap by ISO week, nothing on weekends and holidays', () => {
  const M = mini({ people: [{ id: 'a', shift: 'A/B' }, { id: 'b', shift: 'D' }, { id: 'c' }] });
  assert.strictEqual(E.isoWeek('2026-10-12'), 42);
  assert.strictEqual(E.usualShift(M, M.P.a, '2026-10-12'), 'A');
  assert.strictEqual(E.usualShift(M, M.P.a, '2026-10-19'), 'B');
  assert.strictEqual(E.rotaDay(M, M.P.b, '2026-10-12').shift, 'D');
  assert.strictEqual(E.rotaDay(M, M.P.b, '2026-10-17').shift, null); // Saturday
  assert.strictEqual(E.rotaDay(M, M.P.b, '2026-11-01').shift, null); // Sunday + holiday
  assert.strictEqual(E.rotaDay(M, M.P.c, '2026-10-12').shift, null);
  assert.strictEqual(E.shiftMinutes(E.shiftById(M, 'A')), 480);
  assert.strictEqual(E.shiftMinutes({ start: '22:00', end: '06:00' }), 480);
  assert.deepStrictEqual(E.shiftWindow('2026-10-12', { start: '22:00', end: '06:00' }), { start: '2026-10-12T22:00', end: '2026-10-13T06:00', min: 480 });
});

t('a one-day change overrides the usual shift; "off" removes it; approved leave wins over both', () => {
  const M = mini({ people: [{ id: 'a', shift: 'A' }], rota: { a: { '2026-10-13': 'B', '2026-10-14': 'off', '2026-10-17': 'D' } },
    requests: [{ personId: 'a', type: 'annual', from: '2026-10-15', to: '2026-10-15' }, { personId: 'a', type: 'annual', from: '2026-10-16', to: '2026-10-16', status: 'pending' }] });
  const d = (x) => E.rotaDay(M, M.P.a, x);
  assert.strictEqual(d('2026-10-13').shift, 'B');
  assert.ok(d('2026-10-13').explicit);
  assert.strictEqual(d('2026-10-14').shift, null);
  assert.strictEqual(d('2026-10-15').shift, null);
  assert.ok(d('2026-10-15').fullLeave);
  assert.strictEqual(d('2026-10-15').planned, 'A');
  assert.strictEqual(d('2026-10-16').shift, 'A');
  assert.strictEqual(d('2026-10-16').pending, 'annual');
  assert.strictEqual(d('2026-10-17').shift, 'D'); // a Saturday shift planned by hand
});

t('clock check: on time within the tolerance, late, left early, no-show and work without a shift', () => {
  const ev = (d, a, b) => [{ personId: 'a', at: d + 'T' + a, kind: 'in' }, { personId: 'a', at: d + 'T' + b, kind: 'out' }];
  const M = mini({ people: [{ id: 'a', shift: 'A' }], clockSince: '2026-10-01', rota: { a: { '2026-10-10': 'off' } },
    clock: [].concat(ev('2026-10-05', '06:08', '14:02'), ev('2026-10-06', '06:25', '14:00'), ev('2026-10-07', '05:58', '13:20'), ev('2026-10-10', '08:00', '12:00'), ev('2026-10-12', '06:30', '13:00')) });
  const now = '2026-10-15T12:00', c = (d) => E.rotaCheck(M, M.P.a, E.rotaDay(M, M.P.a, d), now);
  assert.strictEqual(c('2026-10-05').status, 'ok');
  assert.strictEqual(c('2026-10-06').status, 'late');
  assert.strictEqual(c('2026-10-06').lateMin, 25);
  assert.strictEqual(c('2026-10-07').status, 'early');
  assert.strictEqual(c('2026-10-07').earlyMin, 40);
  assert.strictEqual(c('2026-10-08').status, 'noShow');
  assert.strictEqual(c('2026-10-10').status, 'unplanned');
  assert.strictEqual(c('2026-10-12').status, 'lateEarly');
  assert.strictEqual(c('2026-10-16').status, 'future');
});

t('the week: planned hours against contract hours less leave, coverage against the team minimum', () => {
  const M = mini({ min: 2, people: [{ id: 'a', shift: 'A' }, { id: 'b', shift: 'B' }, { id: 'c', shift: 'A6', hours: 30 }],
    requests: [{ personId: 'b', type: 'annual', from: '2026-10-14', to: '2026-10-14' }], rota: { c: { '2026-10-15': 'off' } } });
  const w = E.rotaWeek(M, 't1', '2026-10-12', '2026-10-12T05:00');
  assert.strictEqual(w.dates.length, 7);
  const rb = w.rows.filter((r) => r.person.id === 'b')[0], rc = w.rows.filter((r) => r.person.id === 'c')[0];
  assert.strictEqual(rb.plannedMin, 4 * 480);
  assert.strictEqual(rb.contractMin, 4 * 480);
  assert.strictEqual(rc.plannedMin, 4 * 360);
  assert.strictEqual(rc.contractMin, 5 * 360);
  assert.strictEqual(w.cover[0].planned, 3);
  assert.deepStrictEqual(w.cover[0].byShift, { A: 1, B: 1, A6: 1 });
  assert.strictEqual(w.cover[2].planned, 2);   // b on leave
  assert.strictEqual(w.cover[3].planned, 2);   // c off
  assert.ok(!w.cover[3].short);
  assert.ok(!w.cover[5].short);                // weekends are not short
});

t('demo data: the warehouse rota matches its clock times (A/B swap weekly, part-timers on 6-hour shifts)', () => {
  const today = '2026-10-15', db = D.generate(today), M = E.model(db, today);
  const w = E.rotaWeek(M, 'warehouse', E.addDays(E.mondayOf(today), -7), today + 'T12:00');
  let ok = 0, all = 0;
  w.rows.forEach((r) => r.cells.forEach((c) => { if (c.shift && c.check.status) { all++; if (c.check.status === 'ok') ok++; } }));
  assert.ok(all >= 30, 'checked days ' + all);
  assert.ok(ok / all > 0.8, 'mostly on time: ' + ok + ' of ' + all);
  const mitja = db.people.filter((p) => p.name === 'Mitja Oblak')[0];
  assert.ok(/^(A6\/B6|B6\/A6)$/.test(mitja.shift));
  assert.ok(D.usualShifts(db)['Zoran Jovanović'] === 'E');
  assert.deepStrictEqual(D.usualShifts({ company: { name: 'Other d.o.o.' } }), {});
});

// ── e-mail notices ───────────────────────────────────────────────────────
t('request e-mail to the approver in Slovenian, with days, note, balance and warnings', () => {
  const M = mini({ people: [{ id: 'a', name: 'Ana Novak', first: 'Ana' }, { id: 'm', name: 'Marko Kos', first: 'Marko' }] });
  const r = { id: 'x', personId: 'a', type: 'annual', from: '2026-11-02', to: '2026-11-06', status: 'pending', note: 'Družinski dopust' };
  const m = E.mailText(M, r, 'request', { lang: 'sl', to: M.P.m, from: M.P.a, link: 'https://example.si/leave/#/requests', warnings: ['Warehouse would have 1 of 3 at work.'], left: 12.5 });
  assert.strictEqual(m.subject, 'Zahtevek: Letni dopust, 2.–6. 11. 2026 (Ana Novak)');
  assert.ok(m.body.indexOf('Pozdravljeni, Marko,') === 0);
  assert.ok(m.body.indexOf('5 delovnih dni') > 0);
  assert.ok(m.body.indexOf('Opomba: Družinski dopust') > 0);
  assert.ok(m.body.indexOf('12,5') > 0);
  assert.ok(m.body.indexOf('- Warehouse would have') > 0);
  assert.ok(m.body.indexOf('https://example.si/leave/#/requests') > 0);
  assert.ok(/\r\n/.test(m.body) && !/[^\r]\n/.test(m.body));
});

t('decision e-mail to the employee in Croatian and English, with the reason', () => {
  const M = mini({ people: [{ id: 'a', name: 'Ana Marić', first: 'Ana', location: 'ZG' }, { id: 'm', name: 'Ivana Babić', first: 'Ivana' }] });
  const r = { id: 'x', personId: 'a', type: 'annual', from: '2026-11-02', to: '2026-11-03', status: 'declined', comment: 'Inventura', decidedBy: 'm' };
  const hr = E.mailText(M, r, 'decision', { lang: 'hr', to: M.P.a, from: M.P.m });
  assert.strictEqual(hr.subject, 'Godišnji odmor 2.–3. 11. 2026: odbijeno');
  assert.ok(hr.body.indexOf('Poštovani Ana,') === 0 && hr.body.indexOf('Razlog: Inventura') > 0);
  const en = E.mailText(M, Object.assign({}, r, { status: 'approved', comment: '' }), 'decision', { lang: 'en', to: M.P.a, from: M.P.m });
  assert.strictEqual(en.subject, 'Annual leave 2.–3. 11. 2026: approved');
  assert.ok(en.body.indexOf('was approved') > 0);
});

t('Slovenian and Croatian day words', () => {
  const M = mini({ people: [{ id: 'a', first: 'A' }, { id: 'm', first: 'M' }] });
  const words = (lang, from, to) => E.mailText(M, { personId: 'a', type: 'annual', from, to, status: 'pending' }, 'request', { lang, to: M.P.m }).body;
  assert.ok(words('sl', '2026-11-02', '2026-11-02').indexOf('1 delovni dan') > 0);
  assert.ok(words('sl', '2026-11-02', '2026-11-03').indexOf('2 delovna dneva') > 0);
  assert.ok(words('sl', '2026-11-02', '2026-11-04').indexOf('3 delovni dnevi') > 0);
  assert.ok(words('hr', '2026-11-02', '2026-11-03').indexOf('2 radna dana') > 0);
  assert.ok(words('hr', '2026-11-02', '2026-11-06').indexOf('5 radnih dana') > 0);
});

t('.eml draft: UTF-8 headers encoded, base64 body, X-Unsent for Outlook, no header injection', () => {
  const text = E.eml({ from: { name: 'Tina Župan', email: 'tina@example.com' }, to: { name: 'Andrej\r\nBcc: x@evil.test', email: 'andrej@example.com' }, subject: 'Zahtevek: letni dopust\r\nBcc: y', body: 'Pozdravljeni,\nčrka ž', date: new Date(Date.UTC(2026, 9, 15, 8, 0, 0)) });
  const [head, body] = text.split('\r\n\r\n');
  assert.ok(/^From: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?= <tina@example\.com>$/m.test(head));
  assert.ok(/^X-Unsent: 1$/m.test(head));
  assert.ok(/^Date: Thu, 15 Oct 2026 08:00:00 \+0000$/m.test(head));
  assert.ok(!/^Bcc:/m.test(head), 'no injected header');
  assert.strictEqual(Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8'), 'Pozdravljeni,\r\nčrka ž');
  assert.ok(/^Subject: Zahtevek: letni dopust Bcc: y$/m.test(head), 'newlines in the subject become spaces');
  assert.ok(/^To: "AndrejBcc: x@evil\.test" <andrej@example\.com>$/m.test(head), 'an ASCII name is quoted');
  const s2 = E.eml({ to: { email: 'a@example.com' }, subject: 'Bolniška', body: '' }).match(/^Subject: =\?UTF-8\?B\?(.+)\?=$/m)[1];
  assert.strictEqual(Buffer.from(s2, 'base64').toString('utf8'), 'Bolniška');
  assert.strictEqual(E.base64Utf8('ab'), Buffer.from('ab').toString('base64'));
  assert.strictEqual(E.base64Utf8('Čas'), Buffer.from('Čas').toString('base64'));
});

t('mailto link: encoded subject and body with CRLF', () => {
  const u = E.mailtoUrl('a.b@example.com', 'Dopust & bolniška', 'Vrstica 1\nVrstica 2');
  assert.ok(u.indexOf('mailto:a.b@example.com?subject=Dopust%20%26%20bolni%C5%A1ka&body=') === 0);
  assert.ok(u.indexOf('Vrstica%201%0D%0AVrstica%202') > 0);
});

console.log(n + ' tests passed');
