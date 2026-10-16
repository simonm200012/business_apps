// Tests for site/leave/engine.js and data.js. Run: node tools/tests/leave-engine.test.js
'use strict';
const assert = require('assert');
const path = require('path');
const E = require(path.join(__dirname, '../../site/leave/engine.js'));
const D = require(path.join(__dirname, '../../site/leave/data.js'));

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok', n, name); }

// a small document: one team, people in Ljubljana (SI) or Zagreb (HR)
function mini(o) {
  o = o || {};
  const settings = E.defaultSettings();
  if (o.settings) o.settings(settings);
  const db = {
    since: o.since || '2025-01-01', clockSince: o.clockSince || '',
    locations: [{ id: 'LJ', country: 'SI' }, { id: 'ZG', country: 'HR' }],
    teams: [{ id: 't1', name: 'Warehouse', min: o.min != null ? o.min : 1, managerId: 'a' }],
    people: (o.people || [{ id: 'a' }]).map((p, i) => Object.assign({ name: 'Person ' + (p.id || i), team: 't1', location: 'LJ', hours: 40, workDays: [1, 2, 3, 4, 5],
      start: '2020-01-01', end: '', birth: '1990-06-01', children: 0, disability: false, priorYears: 0, carry: {}, carryUntil: {} }, p)),
    requests: (o.requests || []).map((r, i) => Object.assign({ id: 'r' + (i + 1), type: 'annual', status: 'approved', halfStart: false, halfEnd: false, reason: '' }, r)),
    clock: (o.clock || []).map((c, i) => Object.assign({ id: 'k' + (i + 1) }, c)),
    settings
  };
  return E.model(db, o.today || '2026-10-13');
}
function day(M, pid, d) { return E.timeline(M, M.P[pid], +d.slice(0, 4)).map[d]; }
function shift(pid, d, a, b, br) {
  const out = [{ personId: pid, at: d + 'T' + a, kind: 'in' }];
  if (br) out.push({ personId: pid, at: d + 'T' + br[0], kind: 'bs' }, { personId: pid, at: d + 'T' + br[1], kind: 'be' });
  if (b) out.push({ personId: pid, at: d + 'T' + b, kind: 'out' });
  return out;
}

// ── dates and holidays ───────────────────────────────────────────────────
t('isDate, month periods and full months', () => {
  assert.strictEqual(E.isDate('2026-02-29'), false);
  assert.strictEqual(E.isDate('2028-02-29'), true);
  assert.strictEqual(E.fullMonths('2026-01-01', '2026-12-31'), 12);
  assert.strictEqual(E.fullMonths('2026-03-02', '2026-12-31'), 9);
  assert.strictEqual(E.fullMonths('2026-03-15', '2026-12-31'), 9);
  assert.strictEqual(E.fullMonths('2026-01-01', '2026-11-30'), 11);
  assert.strictEqual(E.fullMonths('2026-01-31', '2026-02-28'), 1);
  assert.strictEqual(E.fullMonths('2026-05-10', '2026-05-31'), 0);
  assert.strictEqual(E.monthPeriodEnd('2026-03-15', 1), '2026-04-14');
  assert.strictEqual(E.fmtRange('2026-11-04', '2026-11-06'), '4.–6. 11. 2026');
  assert.strictEqual(E.fmtRange('2026-12-28', '2027-01-02'), '28. 12. 2026 – 2. 1. 2027');
});

t('Easter by the anonymous Gregorian algorithm', () => {
  assert.deepStrictEqual([2024, 2025, 2026, 2027].map(E.easter), ['2024-03-31', '2025-04-20', '2026-04-05', '2027-03-28']);
  assert.strictEqual(E.easter(2000), '2000-04-23');
  assert.strictEqual(E.easter(2038), '2038-04-25'); // latest possible date
  assert.strictEqual(E.easter(2285), '2285-03-22'); // earliest possible date
});

t('Slovenian holidays 2024–2027', () => {
  assert.deepStrictEqual(E.holidays('SI', 2026).map((h) => h.date), ['2026-01-01', '2026-01-02', '2026-02-08', '2026-04-05', '2026-04-06', '2026-04-27', '2026-05-01',
    '2026-05-02', '2026-05-24', '2026-06-25', '2026-08-15', '2026-10-31', '2026-11-01', '2026-12-25', '2026-12-26']);
  const by = (y) => Object.fromEntries(E.holidays('SI', y).map((h) => [h.name, h.date]));
  assert.strictEqual(by(2026)['Easter Monday'], '2026-04-06');
  assert.strictEqual(by(2024)['Easter Monday'], '2024-04-01');
  assert.strictEqual(by(2025)['Easter Monday'], '2025-04-21');
  assert.strictEqual(by(2027)['Easter Monday'], '2027-03-29');
  assert.strictEqual(by(2025)['Whit Sunday'], '2025-06-08');
  assert.strictEqual(by(2027)['Whit Sunday'], '2027-05-16');
  [2024, 2025, 2026, 2027].forEach((y) => {
    assert.strictEqual(E.holidays('SI', y).length, 15);
    E.holidays('SI', y).forEach((h) => { assert.ok(E.isDate(h.date) && h.local && h.name); });
    assert.strictEqual(E.dow(by(y)['Whit Sunday']), 0);
  });
});

t('Croatian holidays 2024–2027', () => {
  const by = (y) => Object.fromEntries(E.holidays('HR', y).map((h) => [h.name, h.date]));
  assert.deepStrictEqual([2024, 2025, 2026, 2027].map((y) => by(y)['Corpus Christi']), ['2024-05-30', '2025-06-19', '2026-06-04', '2027-05-27']);
  assert.deepStrictEqual([2024, 2025, 2026, 2027].map((y) => by(y)['Easter Monday']), ['2024-04-01', '2025-04-21', '2026-04-06', '2027-03-29']);
  assert.deepStrictEqual(E.holidays('HR', 2026).map((h) => h.date), ['2026-01-01', '2026-01-06', '2026-04-05', '2026-04-06', '2026-05-01', '2026-05-30', '2026-06-04',
    '2026-06-22', '2026-08-05', '2026-08-15', '2026-11-01', '2026-11-18', '2026-12-25', '2026-12-26']);
  // 2024: Corpus Christi falls on Statehood Day, 30 May
  assert.strictEqual(E.holidays('HR', 2024).filter((h) => h.date === '2024-05-30').length, 2);
  assert.ok(E.holidays('HR', 2026).every((h) => h.local));
});

t('company days off: every year or once, all or one country', () => {
  const s = E.defaultSettings();
  s.companyDays.push({ id: 'x', name: 'Bridge', date: '2027-04-26', half: false, country: 'SI' });
  assert.deepStrictEqual(E.companyDays(s, 'SI', 2026).map((c) => [c.date, c.half]), [['2026-12-24', true]]);
  assert.deepStrictEqual(E.companyDays(s, 'SI', 2027).map((c) => c.date), ['2026-12-24'.replace('2026', '2027'), '2027-04-26'].sort());
  assert.deepStrictEqual(E.companyDays(s, 'HR', 2027).map((c) => c.date), ['2027-12-24']);
});

// ── counting leave days ──────────────────────────────────────────────────
t('working days across weekends and holidays, per country', () => {
  const M = mini({ people: [{ id: 'a' }, { id: 'h', location: 'ZG' }] });
  const c = (pid, from, to, x) => E.countDays(M, Object.assign({ personId: pid, from, to }, x || {}));
  assert.strictEqual(c('a', '2026-10-12', '2026-10-16'), 5);           // Mon–Fri
  assert.strictEqual(c('a', '2026-10-15', '2026-10-20'), 4);           // Thu–Tue over a weekend
  assert.strictEqual(c('a', '2026-10-17', '2026-10-18'), 0);           // weekend only
  assert.strictEqual(c('a', '2026-04-27', '2026-05-01'), 3);           // SI: 27. 4. and 1. 5. are holidays
  assert.strictEqual(c('h', '2026-04-27', '2026-05-01'), 4);           // HR: only 1. 5.
  assert.strictEqual(c('a', '2026-06-01', '2026-06-05'), 5);           // SI works on Corpus Christi
  assert.strictEqual(c('h', '2026-06-01', '2026-06-05'), 4);           // HR: 4. 6. is Corpus Christi
  assert.strictEqual(c('a', '2026-12-21', '2027-01-04'), 8.5);         // 21.–23. 12., ½ on 24. 12., 28.–31. 12., 4. 1.; 25. 12. and 1. 1. are holidays
  const info = E.rangeInfo(M, M.P.a, '2026-04-27', '2026-05-03');
  assert.strictEqual(info.weekend, 2);
  assert.deepStrictEqual(info.holidays.map((h) => h.date), ['2026-04-27', '2026-05-01']);
});

t('half days at the start and the end', () => {
  const M = mini();
  const c = (from, to, hs, he) => E.countDays(M, { personId: 'a', from, to, halfStart: hs, halfEnd: he });
  assert.strictEqual(c('2026-10-14', '2026-10-14', true, false), 0.5);
  assert.strictEqual(c('2026-10-14', '2026-10-14', false, true), 0.5);
  assert.strictEqual(c('2026-10-14', '2026-10-14', true, true), 0.5);
  assert.strictEqual(c('2026-10-12', '2026-10-16', true, false), 4.5);
  assert.strictEqual(c('2026-10-12', '2026-10-16', true, true), 4);
  assert.strictEqual(c('2026-10-10', '2026-10-16', true, false), 5);   // starts on a Saturday: the half does not apply
  assert.strictEqual(c('2026-12-24', '2026-12-24', false, true), 0.5); // half company day stays half
});

t('part-time days, joining and leaving dates', () => {
  const M = mini({ people: [{ id: 'a', workDays: [1, 2, 3], hours: 24 }, { id: 'b', start: '2026-10-14', end: '2026-10-15' }] });
  assert.strictEqual(E.countDays(M, { personId: 'a', from: '2026-10-12', to: '2026-10-18' }), 3);
  assert.strictEqual(E.countDays(M, { personId: 'b', from: '2026-10-12', to: '2026-10-16' }), 2);
  assert.strictEqual(E.dailyMin(M.P.a), 480);
});

// ── entitlement ──────────────────────────────────────────────────────────
t('entitlement: base, 55+ in the year, disability counted once, children, service', () => {
  const M = mini({ people: [
    { id: 'base' },
    { id: 'old', birth: '1971-12-31' },          // turns 55 in 2026
    { id: 'young', birth: '1972-01-01' },        // 54 in 2026
    { id: 'dis', disability: true },
    { id: 'both', birth: '1960-03-01', disability: true },
    { id: 'kids', children: 2 },
    { id: 's9', start: '2020-01-01', priorYears: 3 },     // 3 + 6 = 9
    { id: 's10', start: '2020-01-01', priorYears: 4 },    // 10
    { id: 's20', start: '2016-07-01', priorYears: 10 },   // 10 + 10 = 20 by 31. 12.
    { id: 's30', start: '2000-01-01', priorYears: 4 },    // 30
    { id: 'six', workDays: [1, 2, 3, 4, 5, 6], hours: 40 },
    { id: 'hr', location: 'ZG', birth: '1960-01-01', disability: true, children: 3, start: '2010-01-01', priorYears: 5 }
  ] });
  const e = (id) => E.entitlement(M, M.P[id], 2026);
  assert.strictEqual(e('base').total, 20);
  assert.strictEqual(e('old').total, 23);
  assert.strictEqual(e('young').total, 20);
  assert.strictEqual(e('dis').total, 23);
  assert.strictEqual(e('both').total, 23);
  assert.ok(/counted once/.test(e('both').lines.filter((l) => l.key === 'protected')[0].note));
  assert.strictEqual(e('kids').total, 22);
  assert.strictEqual(e('s9').total, 20);
  assert.strictEqual(e('s10').total, 21);
  assert.strictEqual(e('s20').service, 20);
  assert.strictEqual(e('s20').total, 22);
  assert.strictEqual(e('s30').total, 23);
  assert.strictEqual(e('six').total, 24);
  assert.strictEqual(e('hr').total, 22);            // HR defaults: 20 + service only (21 years)
  assert.deepStrictEqual(e('hr').lines.map((l) => l.key), ['base', 'service']);
  assert.strictEqual(e('s30').lines.filter((l) => l.key === 'service')[0].note, 'company rule, example');
});

t('entitlement pro rata for joiners and leavers, with each rounding', () => {
  const people = [{ id: 'j', start: '2026-03-02' }, { id: 'l', end: '2026-11-30' }, { id: 'k', start: '2026-03-02', children: 2 }, { id: 'out', start: '2027-02-01' }];
  const up = mini({ people });
  assert.strictEqual(E.entitlement(up, up.P.j, 2026).total, 15);           // 20 × 9/12
  assert.strictEqual(E.entitlement(up, up.P.j, 2026).proRata.months, 9);
  assert.strictEqual(E.entitlement(up, up.P.l, 2026).total, 19);           // 20 × 11/12 = 18,33 → 19
  assert.strictEqual(E.entitlement(up, up.P.k, 2026).total, 17);           // 22 × 9/12 = 16,5 → 17
  assert.strictEqual(E.entitlement(up, up.P.out, 2026).total, 0);
  assert.strictEqual(E.entitlement(up, up.P.j, 2027).proRata, null);
  const near = mini({ people, settings: (s) => { s.rounding = 'nearest'; } });
  assert.strictEqual(E.entitlement(near, near.P.l, 2026).total, 18);
  assert.strictEqual(E.entitlement(near, near.P.k, 2026).total, 17);
  const half = mini({ people, settings: (s) => { s.rounding = 'half'; } });
  assert.strictEqual(E.entitlement(half, half.P.l, 2026).total, 18.5);
  assert.strictEqual(E.entitlement(half, half.P.k, 2026).total, 16.5);
  const off = mini({ people, settings: (s) => { s.proRata = false; } });
  assert.strictEqual(E.entitlement(off, off.P.j, 2026).total, 20);
  assert.strictEqual(E.roundDays(18.0000000001, 'up'), 18);
});

// ── carry-over and balance ───────────────────────────────────────────────
t('carried-over days are used first and expire on 30 June', () => {
  const reqs = [{ personId: 'a', from: '2026-03-02', to: '2026-03-04' }, { personId: 'a', from: '2026-07-06', to: '2026-07-09' }];
  const after = mini({ today: '2026-10-13', people: [{ id: 'a', carry: { 2026: 5 } }], requests: reqs });
  const b = E.balance(after, after.P.a, 2026);
  assert.strictEqual(b.carry.days, 5);
  assert.strictEqual(b.carry.used, 3);
  assert.strictEqual(b.carry.expired, 2);
  assert.strictEqual(b.carry.available, 0);
  assert.strictEqual(b.taken, 7);
  assert.strictEqual(b.remaining, 16);              // 20 − 4 of this year's days
  const before = mini({ today: '2026-05-15', people: [{ id: 'a', carry: { 2026: 5 } }], requests: reqs });
  const c = E.balance(before, before.P.a, 2026);
  assert.strictEqual(c.carry.available, 2);
  assert.strictEqual(c.carry.expired, 0);
  assert.strictEqual(c.carry.warn, true);           // May: warn before 30 June
  assert.strictEqual(c.taken, 3);
  assert.strictEqual(c.planned, 4);
  assert.strictEqual(c.remaining, 18);              // 20 − 4 + 2 still usable
  const early = mini({ today: '2026-02-01', people: [{ id: 'a', carry: { 2026: 5 } }], requests: reqs });
  assert.strictEqual(E.balance(early, early.P.a, 2026).carry.warn, false);
  const ext = mini({ today: '2026-10-13', people: [{ id: 'a', carry: { 2026: 5 }, carryUntil: { 2026: '2026-12-31' } }], requests: reqs });
  const d = E.balance(ext, ext.P.a, 2026);
  assert.strictEqual(d.carry.used, 5);              // July days may use it too
  assert.strictEqual(d.remaining, 18);
});

t('carry-over from the previous year, automatically', () => {
  const M = mini({ since: '2025-01-01', today: '2026-10-13', people: [{ id: 'a', carry: { 2025: 0 } }],
    requests: [{ personId: 'a', from: '2025-07-07', to: '2025-07-18' }, { personId: 'a', from: '2025-08-04', to: '2025-08-13' }] });
  assert.strictEqual(E.balance(M, M.P.a, 2025).remaining, 2);
  assert.deepStrictEqual(E.carryIn(M, M.P.a, 2026), { days: 2, src: 'auto' });
  const M2 = mini({ since: '2026-01-01', people: [{ id: 'a' }] });
  assert.strictEqual(E.carryIn(M2, M2.P.a, 2026).days, 0);
  const M3 = mini({ people: [{ id: 'a', carry: { 2026: 7 } }] });
  assert.deepStrictEqual(E.carryIn(M3, M3.P.a, 2026), { days: 7, src: 'set' });
});

t('balance: taken, planned, pending and a draft request', () => {
  const M = mini({ today: '2026-10-13', requests: [
    { personId: 'a', from: '2026-08-03', to: '2026-08-14' },                       // 10 taken
    { personId: 'a', from: '2026-11-02', to: '2026-11-04' },                       // 3 planned
    { personId: 'a', from: '2026-12-21', to: '2026-12-23', status: 'pending' },    // 3 pending
    { personId: 'a', from: '2026-09-07', to: '2026-09-07', status: 'declined' },
    { personId: 'a', from: '2026-09-08', to: '2026-09-08', status: 'cancelled' },
    { personId: 'a', from: '2026-09-09', to: '2026-09-09', type: 'sick' }
  ] });
  const b = E.balance(M, M.P.a, 2026);
  assert.deepStrictEqual([b.taken, b.planned, b.pending, b.remaining, b.afterPending], [10, 3, 3, 7, 4]);
  const draft = { personId: 'a', type: 'annual', from: '2026-11-16', to: '2026-11-20' };
  assert.strictEqual(E.balance(M, M.P.a, 2026, { extra: draft }).remaining, 2);
  assert.strictEqual(E.balance(M, M.P.a, 2026).remaining, 7, 'the draft is not kept');
  const u = E.usage(M, M.P.a, 2026);
  assert.strictEqual(u.annual.days, 13);
  assert.strictEqual(u.sick.days, 1);
});

t('longest block of leave: two working weeks bridged by a weekend and a holiday', () => {
  const M = mini({ requests: [{ personId: 'a', from: '2026-07-06', to: '2026-07-17' }, { personId: 'a', from: '2026-04-28', to: '2026-04-30' }] });
  assert.deepStrictEqual(E.longestBlock(M, M.P.a, 2026), { days: 10, from: '2026-07-06', to: '2026-07-17' });
  const M2 = mini({ requests: [{ personId: 'a', from: '2026-04-28', to: '2026-04-30' }] });
  assert.deepStrictEqual(E.longestBlock(M2, M2.P.a, 2026), { days: 5, from: '2026-04-27', to: '2026-05-01' }); // holidays on 27. 4. and 1. 5. bridge it
});

// ── conflicts ────────────────────────────────────────────────────────────
t('team minimum presence', () => {
  const people = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
  const M = mini({ min: 3, people, requests: [{ personId: 'b', from: '2026-11-09', to: '2026-11-13' }, { personId: 'c', from: '2026-11-12', to: '2026-11-12', status: 'pending' }] });
  const r = { personId: 'a', type: 'annual', from: '2026-11-11', to: '2026-11-13' };
  const cs = E.conflicts(M, r);
  const min = cs.filter((c) => c.kind === 'min')[0];
  assert.ok(min, 'minimum conflict');
  assert.deepStrictEqual(min.days.map((d) => d.date), ['2026-11-11', '2026-11-12', '2026-11-13']);
  assert.strictEqual(min.days[0].present, 2);
  assert.ok(/2 of 4/.test(min.text));
  assert.ok(cs.some((c) => c.kind === 'info'), 'pending colleague mentioned');
  assert.strictEqual(E.needsNote(cs), true);
  assert.strictEqual(E.needsNote(cs.filter((c) => c.kind === 'info')), false);
  assert.strictEqual(E.conflicts(M, { personId: 'a', type: 'annual', from: '2026-11-16', to: '2026-11-17' }).length, 0);
  assert.strictEqual(E.conflicts(M, { personId: 'a', type: 'remote', from: '2026-11-11', to: '2026-11-11' }).filter((c) => c.kind === 'min').length, 0);
  // half a day away counts half; a half company day off still counts everyone present
  assert.strictEqual(E.presence(M, 't1', '2026-12-24').present, 4);
  const M2 = mini({ min: 4, people, requests: [{ personId: 'b', from: '2026-11-11', to: '2026-11-11', halfEnd: true }] });
  assert.strictEqual(E.presence(M2, 't1', '2026-11-11').present, 3.5);
});

t('the same person already away, and blackout periods', () => {
  const M = mini({ settings: (s) => { s.blackouts.push({ id: 'b2', name: 'Inventory', team: '', from: '2026-03-30', to: '2026-03-31' }); }, people: [{ id: 'a' }],
    requests: [{ personId: 'a', type: 'training', from: '2026-11-12', to: '2026-11-12' }] });
  M.T.t1.id = 'warehouse'; // the default blackout is for the team "warehouse"
  M.P.a.team = 'warehouse'; M.members.warehouse = [M.P.a]; M.T.warehouse = M.T.t1;
  const ov = E.conflicts(M, { personId: 'a', type: 'annual', from: '2026-11-11', to: '2026-11-13' });
  assert.ok(ov.some((c) => c.kind === 'overlap' && c.from === '2026-11-12'));
  const bo = E.conflicts(M, { personId: 'a', type: 'annual', from: '2026-12-28', to: '2027-01-04' }).filter((c) => c.kind === 'blackout');
  assert.deepStrictEqual(bo[0].dates, ['2026-12-29', '2026-12-30', '2026-12-31']);
  assert.deepStrictEqual(E.blackoutRanges({ from: '12-30', to: '01-02' }, 2026), [['2026-12-30', '2027-01-02']]);
  assert.ok(E.conflicts(M, { personId: 'a', type: 'annual', from: '2026-03-30', to: '2026-03-31' }).some((c) => c.kind === 'blackout' && c.blackout.name === 'Inventory'));
  assert.strictEqual(E.conflicts(M, { personId: 'a', type: 'trip', from: '2026-12-29', to: '2026-12-29' }).filter((c) => c.kind === 'blackout').length, 0);
});

t('balance and special-leave limits', () => {
  const M = mini({ requests: [{ personId: 'a', from: '2026-07-06', to: '2026-07-31' }, { personId: 'a', type: 'special', reason: 'wedding', from: '2026-05-04', to: '2026-05-08' }] });
  const bal = E.conflicts(M, { personId: 'a', type: 'annual', from: '2026-11-02', to: '2026-11-04' }).filter((c) => c.kind === 'balance')[0];
  assert.ok(bal && bal.short === 3, 'three days short: all 20 used, 3 more asked');
  assert.strictEqual(E.conflicts(M, { personId: 'a', type: 'annual', from: '2027-01-04', to: '2027-01-05' }).filter((c) => c.kind === 'balance').length, 0);
  const sp = E.conflicts(M, { personId: 'a', type: 'special', reason: 'moving', from: '2026-11-02', to: '2026-11-04' }).filter((c) => c.kind === 'special');
  assert.strictEqual(sp.length, 2, 'more than the reason allows and over the 7-day yearly limit');
  const e = E.validateRequest(M, { personId: 'a', type: 'special', from: '2026-11-07', to: '2026-11-08' });
  assert.ok(e.reason && e.to, 'reason missing and no working days');
  // carried-over days cannot pay for leave after they expire
  const C = mini({ today: '2026-05-15', people: [{ id: 'a', carry: { 2026: 5 } }], requests: [{ personId: 'a', from: '2026-07-06', to: '2026-07-31' }] });
  const b = E.balance(C, C.P.a, 2026);
  assert.deepStrictEqual([b.current, b.remaining, b.carry.available], [0, 5, 5]);
  const late = E.conflicts(C, { personId: 'a', type: 'annual', from: '2026-08-03', to: '2026-08-05' }).filter((c) => c.kind === 'balance')[0];
  assert.ok(late && late.short === 3 && /until 30\. 6\. 2026/.test(late.text), 'August cannot use days that expire in June');
  assert.strictEqual(E.conflicts(C, { personId: 'a', type: 'annual', from: '2026-06-01', to: '2026-06-03' }).filter((c) => c.kind === 'balance').length, 0, 'June can');
});

// ── working time ─────────────────────────────────────────────────────────
t('hours: the 30-minute break is paid, longer breaks are not', () => {
  const M = mini({ clock: [].concat(
    shift('a', '2026-10-05', '08:00', '16:00', ['12:00', '12:30']),
    shift('a', '2026-10-06', '08:00', '16:30', ['12:00', '12:30']),
    shift('a', '2026-10-07', '08:00', '16:00', ['12:00', '12:45']),
    shift('a', '2026-10-08', '08:00', '16:10', ['12:00', '12:30'])
  ) });
  assert.deepStrictEqual(['05', '06', '07', '08'].map((d) => day(M, 'a', '2026-10-' + d)).map((r) => [r.worked, r.overtime]), [[480, 0], [510, 30], [465, 0], [490, 0]]);
  const unpaid = mini({ settings: (s) => { s.time.SI.breakPaid = false; }, clock: shift('a', '2026-10-05', '08:00', '16:00', ['12:00', '12:30']) });
  assert.strictEqual(day(unpaid, 'a', '2026-10-05').worked, 450);
  const zero = mini({ settings: (s) => { s.time.overtimeFrom = 0; }, clock: shift('a', '2026-10-08', '08:00', '16:10', ['12:00', '12:30']) });
  assert.strictEqual(day(zero, 'a', '2026-10-08').overtime, 10);
});

t('paid break for part time: in proportion in Slovenia, from 6 hours in Croatia', () => {
  const M = mini({ people: [{ id: 'si30', hours: 30 }, { id: 'si20', hours: 20 }, { id: 'si15', hours: 15 }, { id: 'hr30', hours: 30, location: 'ZG' }, { id: 'hr20', hours: 20, location: 'ZG' }] });
  assert.deepStrictEqual(['si30', 'si20', 'si15', 'hr30', 'hr20'].map((id) => E.paidBreakAllowance(M, M.P[id])), [23, 15, 0, 30, 0]);
});

t('overtime: on a weekend all hours count; weekly basis evens out the week; half-day leave lowers the hours expected', () => {
  const evs = [].concat(shift('a', '2026-10-05', '07:00', '16:00', ['12:00', '12:30']), shift('a', '2026-10-06', '08:00', '15:00', ['12:00', '12:30']),
    shift('a', '2026-10-07', '08:00', '16:00'), shift('a', '2026-10-08', '08:00', '16:00'), shift('a', '2026-10-09', '08:00', '16:00'), shift('a', '2026-10-10', '09:00', '12:00'));
  const daily = mini({ clock: evs });
  assert.strictEqual(day(daily, 'a', '2026-10-05').overtime, 60);
  assert.strictEqual(day(daily, 'a', '2026-10-10').overtime, 180);
  const weekly = mini({ clock: evs, settings: (s) => { s.time.overtimeBasis = 'weekly'; } });
  const wk = E.timeline(weekly, weekly.P.a, 2026).weeks['2026-10-05'];
  assert.deepStrictEqual([wk.worked, wk.expected, wk.overtime], [2580, 2400, 180]);
  assert.strictEqual(day(weekly, 'a', '2026-10-05').overtime, 0);
  assert.strictEqual(day(weekly, 'a', '2026-10-10').overtime, 180);
  const half = mini({ clock: shift('a', '2026-10-12', '08:00', '12:00'), requests: [{ personId: 'a', from: '2026-10-12', to: '2026-10-12', halfEnd: true }] });
  const r = day(half, 'a', '2026-10-12');
  assert.deepStrictEqual([r.expected, r.worked, r.overtime], [240, 240, 0]);
});

t('checks: missing clock-out, open break, short rest (summer time aware), days in a row, no clock events, leave', () => {
  const evs = [].concat(
    shift('a', '2026-09-28', '13:00', '21:00', ['17:00', '17:30']), shift('a', '2026-09-29', '06:00', '14:00'),  // 9 h rest
    shift('a', '2026-09-30', '07:00', null),                                                                    // no clock-out
    [{ personId: 'a', at: '2026-10-01T07:00', kind: 'in' }, { personId: 'a', at: '2026-10-01T11:00', kind: 'bs' }, { personId: 'a', at: '2026-10-01T15:00', kind: 'out' }],
    shift('a', '2026-10-24', '10:00', '22:00'), shift('a', '2026-10-25', '10:00', '12:00'),                       // 12 h by the clock, 13 h really
    shift('a', '2026-10-13', '07:00', null)                                                                     // today, still working
  );
  const M = mini({ today: '2026-10-13', clockSince: '2026-09-28', clock: evs, requests: [{ personId: 'a', type: 'sick', from: '2026-10-05', to: '2026-10-06' }] });
  const codes = (d) => day(M, 'a', d).flags.map((f) => f.code);
  assert.deepStrictEqual(codes('2026-09-29'), ['shortRest']);
  assert.strictEqual(day(M, 'a', '2026-09-29').flags[0].rest, 540);
  assert.ok(codes('2026-09-30').indexOf('missingOut') >= 0);
  assert.ok(codes('2026-10-01').indexOf('openBreak') >= 0);
  assert.ok(codes('2026-10-02').indexOf('noClock') >= 0);
  assert.strictEqual(codes('2026-10-05').length, 0, 'sick leave: no clock events expected');
  assert.strictEqual(codes('2026-10-13').indexOf('missingOut'), -1, 'today is not flagged');
  assert.strictEqual(codes('2026-10-25').indexOf('shortRest'), -1, 'the clocks went back: 13 hours of rest');
  const run = [];
  for (let d = '2026-08-03'; d <= '2026-08-14'; d = E.addDays(d, 1)) run.push(...shift('a', d, '08:00', '12:00'));
  const R = mini({ clock: run });
  const flags = E.timeline(R, R.P.a, 2026).days.filter((x) => x.flags.some((f) => f.code === 'daysInRow'));
  assert.strictEqual(flags.length, 1, 'one flag per streak');
  assert.strictEqual(flags[0].date, '2026-08-09');
  assert.strictEqual(flags[0].flags.filter((f) => f.code === 'daysInRow')[0].count, 12);
  const L = mini({ clock: shift('a', '2026-08-04', '08:00', '16:00'), requests: [{ personId: 'a', from: '2026-08-03', to: '2026-08-07' }] });
  assert.ok(day(L, 'a', '2026-08-04').flags.some((f) => f.code === 'onLeave'));
  const O = mini({ clock: [{ personId: 'a', at: '2026-08-04T16:00', kind: 'out' }] });
  assert.ok(day(O, 'a', '2026-08-04').flags.some((f) => f.code === 'orphan'));
});

t('overtime limits: 8 h a week, 20 h a month, 170 h a year (Slovenian defaults)', () => {
  const evs = [];
  for (let d = '2026-09-01'; d <= '2026-09-30'; d = E.addDays(d, 1)) if (E.isoDow(d) <= 5) evs.push(...shift('a', d, '06:00', '16:00', ['10:00', '10:30'])); // 2 h overtime a day
  const M = mini({ clock: evs });
  const fl = E.timeline(M, M.P.a, 2026).days.filter((x) => x.date.slice(0, 7) === '2026-09').reduce((a, x) => a.concat(x.flags.map((f) => Object.assign({ date: x.date }, f))), []);
  const week = fl.filter((f) => f.code === 'otWeek'), month = fl.filter((f) => f.code === 'otMonth');
  assert.strictEqual(week.length, 3, 'the three full weeks have 10 h; 1.–4. 9. and 28.–30. 9. stay at or under 8 h');
  assert.strictEqual(week[0].date, '2026-09-11');  // the Friday the week goes over 8 h
  assert.strictEqual(month.length, 1);
  assert.strictEqual(month[0].date, '2026-09-15');  // the 11th working day passes 20 h (the 10th reaches exactly 20 h)
  assert.strictEqual(month[0].total, 44 * 60);
  const Y = mini({ clock: evs, settings: (s) => { s.time.SI.year = 30; } });
  assert.strictEqual(E.timeline(Y, Y.P.a, 2026).days.filter((x) => x.flags.some((f) => f.code === 'otYear')).length, 1);
  const rec = E.monthRecord(M, M.P.a, '2026-09');
  assert.strictEqual(rec.totals.overtime, 44 * 60);
  assert.strictEqual(rec.ytdOvertime, 44 * 60);
  assert.strictEqual(rec.totals.workDays, 22);
  assert.strictEqual(E.flagText(month[0]), 'Overtime 44 h this month (limit 20 h)');
});

t('month record totals: absences by who pays, holidays, remote days', () => {
  const M = mini({ requests: [
    { personId: 'a', from: '2026-12-01', to: '2026-12-02' }, { personId: 'a', type: 'sick', from: '2026-12-03', to: '2026-12-03' },
    { personId: 'a', type: 'unpaid', from: '2026-12-04', to: '2026-12-04' }, { personId: 'a', type: 'parental', from: '2026-12-07', to: '2026-12-07' },
    { personId: 'a', type: 'remote', from: '2026-12-08', to: '2026-12-08' }] });
  const t1 = E.monthRecord(M, M.P.a, '2026-12').totals;
  assert.strictEqual(t1.absence.annual.days, 2);
  assert.strictEqual(t1.paidAbsMin, 3 * 480);
  assert.strictEqual(t1.unpaidAbsMin, 480);
  assert.strictEqual(t1.otherAbsMin, 480);
  assert.strictEqual(t1.remote, 1);
  assert.strictEqual(t1.holidays, 1);                 // 25. 12. 2026 is a Friday; 26. 12. is a Saturday
  assert.strictEqual(t1.companyMin, 240);             // 24. 12. afternoon
});

t('clock state and validating an edited day', () => {
  const evs = [{ at: '2026-10-13T07:58', kind: 'in' }];
  assert.deepStrictEqual(E.clockState([], '2026-10-13T09:00').next, ['in']);
  assert.strictEqual(E.clockState(evs, '2026-10-13T09:00').state, 'working');
  assert.deepStrictEqual(E.clockState(evs.concat([{ at: '2026-10-13T12:00', kind: 'bs' }]), '2026-10-13T12:10').next, ['be', 'out']);
  assert.strictEqual(E.clockState(evs.concat([{ at: '2026-10-13T16:00', kind: 'out' }]), '2026-10-13T17:00').state, 'done');
  const stale = E.clockState([{ at: '2026-10-09T07:30', kind: 'in' }], '2026-10-13T08:00');
  assert.strictEqual(stale.state, 'off');
  assert.ok(stale.stale);
  const ok = [{ kind: 'in', at: '2026-10-12T08:00' }, { kind: 'bs', at: '2026-10-12T12:00' }, { kind: 'be', at: '2026-10-12T12:30' }, { kind: 'out', at: '2026-10-12T16:00' }];
  assert.deepStrictEqual(E.validateDay(ok), []);
  assert.strictEqual(E.validateDay(ok.slice(0, 3)).length, 1);
  assert.deepStrictEqual(E.validateDay(ok.slice(0, 3), true), []);
  assert.ok(E.validateDay([{ kind: 'in', at: '2026-10-12T08:00' }, { kind: 'out', at: '2026-10-12T07:00' }]).length >= 1);
  assert.ok(E.validateDay([{ kind: 'out', at: '2026-10-12T16:00' }]).length >= 1);
  assert.ok(E.validateDay([{ kind: 'in', at: '2026-10-12T08:00' }, { kind: 'bs', at: '2026-10-12T12:00' }, { kind: 'out', at: '2026-10-12T16:00' }]).length >= 1);
});

// ── iCalendar ────────────────────────────────────────────────────────────
t('iCalendar: all-day events, exclusive end, CRLF, escaping and folding at 75 octets', () => {
  const long = 'Letni dopust – Čevljarska ulica, Šmartno; obisk "naš" \\ dom\nDruga vrstica ' + 'žžžžžžžžžž'.repeat(6);
  const s = E.ics([{ uid: 'r1@leave.stratum-apps', start: '2026-11-09', end: '2026-11-13', summary: 'Annual leave, Tina; half day', description: long, categories: 'Annual leave', status: 'CONFIRMED', busy: true },
    { uid: 'r2@leave.stratum-apps', start: '2026-12-24', summary: 'One day' }], { stamp: '20261013T080000Z', name: 'Leave, team' });
  assert.ok(s.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'));
  assert.ok(s.endsWith('END:VCALENDAR\r\n'));
  assert.ok(!/[^\r]\n/.test(s), 'every line ends with CRLF');
  const physical = s.split('\r\n').slice(0, -1);
  physical.forEach((l) => assert.ok(Buffer.byteLength(l, 'utf8') <= 75, 'line over 75 octets: ' + l));
  const logical = s.replace(/\r\n /g, '').split('\r\n');
  assert.ok(logical.indexOf('DTSTART;VALUE=DATE:20261109') >= 0);
  assert.ok(logical.indexOf('DTEND;VALUE=DATE:20261114') >= 0);
  assert.ok(logical.indexOf('DTEND;VALUE=DATE:20261225') >= 0);
  assert.ok(logical.indexOf('UID:r1@leave.stratum-apps') >= 0);
  assert.strictEqual(logical.filter((l) => l === 'DTSTAMP:20261013T080000Z').length, 2);
  assert.ok(logical.indexOf('SUMMARY:Annual leave\\, Tina\\; half day') >= 0);
  assert.ok(logical.indexOf('X-WR-CALNAME:Leave\\, team') >= 0);
  const desc = logical.filter((l) => l.startsWith('DESCRIPTION:'))[0];
  assert.strictEqual(desc, 'DESCRIPTION:' + long.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n'));
  assert.ok(physical.some((l) => l.startsWith(' ')), 'long lines are folded');
  assert.strictEqual(logical.filter((l) => l === 'BEGIN:VEVENT').length, 2);
  assert.strictEqual(E.icsFold('x'.repeat(75)), 'x'.repeat(75));
  assert.strictEqual(E.icsFold('x'.repeat(76)), 'x'.repeat(75) + '\r\n x');
  assert.ok(/^\d{8}T\d{6}Z$/.test(E.icsStamp(new Date(Date.UTC(2026, 9, 13, 8, 5, 9)))));
});

// ── demo data ────────────────────────────────────────────────────────────
const TODAYS = ['2026-10-13', '2026-01-04', '2026-06-15', '2026-12-27', '2027-03-01'];
t('generator is deterministic', () => {
  const a = D.generate('2026-10-13'), b = D.generate('2026-10-13');
  assert.deepStrictEqual(a, b);
  assert.notDeepStrictEqual(D.generate('2026-10-14').requests.map((r) => r.from), a.requests.map((r) => r.from));
});

TODAYS.forEach((today) => {
  t('generated data is sane and consistent (' + today + ')', () => {
    const db = D.generate(today), M = E.model(db, today), Y = +today.slice(0, 4);
    // people, teams, roles
    assert.strictEqual(db.people.length, 36);
    assert.strictEqual(db.teams.length, 7);
    const sizes = {}; db.people.forEach((p) => { sizes[p.team] = (sizes[p.team] || 0) + 1; });
    assert.deepStrictEqual(sizes, { sales: 6, purchasing: 3, finance: 4, warehouse: 10, drivers: 5, maribor: 3, zagreb: 5 });
    db.teams.forEach((t) => assert.ok(M.P[t.managerId] && M.P[t.managerId].team === t.id, 'manager of ' + t.id));
    assert.strictEqual(db.people.filter((p) => p.hr).length, 1);
    assert.strictEqual(db.people.filter((p) => p.disability).length, 1);
    assert.ok(db.people.filter((p) => E.ageInYear(p, Y) >= 55).length >= 4);
    assert.ok(db.people.filter((p) => p.start >= Y + '-01-01').length >= 3, 'joiners this year');
    assert.strictEqual(new Set(db.people.map((p) => p.email)).size, 36);
    db.people.forEach((p) => {
      assert.ok(/^[a-z.]+@example\.com$/.test(p.email), p.email);
      assert.ok(E.isDate(p.start) && E.isDate(p.birth) && (!p.end || E.isDate(p.end)));
      assert.ok([20, 30, 40].indexOf(p.hours) >= 0);
    });
    // requests are well-formed
    db.requests.forEach((r) => {
      assert.ok(M.P[r.personId], 'person of ' + r.id);
      assert.ok(E.TYPE[r.type] && E.STATUSES[r.status]);
      assert.ok(E.isDate(r.from) && E.isDate(r.to) && r.from <= r.to, r.id);
      assert.ok(E.countDays(M, r) > 0, 'counts days: ' + r.id);
      assert.ok(E.isStamp(r.createdAt) && r.createdAt.slice(0, 10) <= today, 'created ' + r.id);
      if (r.status === 'declined' || r.status === 'cancelled' || (r.status === 'approved' && E.TYPE[r.type].approval)) assert.ok(r.decidedBy && E.isStamp(r.decidedAt) && r.decidedAt >= r.createdAt, 'decided ' + r.id);
      assert.ok(E.employedOn(M.P[r.personId], r.from) && E.employedOn(M.P[r.personId], r.to));
    });
    assert.strictEqual(new Set(db.requests.map((r) => r.id)).size, db.requests.length);
    // no overlapping approved requests for one person
    db.people.forEach((p) => {
      const ap = M.req[p.id].filter((r) => r.status === 'approved').sort((a, b) => (a.from < b.from ? -1 : 1));
      for (let i = 1; i < ap.length; i++) assert.ok(ap[i].from > ap[i - 1].to, p.name + ': ' + ap[i - 1].id + ' overlaps ' + ap[i].id);
    });
    // balances never negative; planned absences never break a team minimum
    db.people.forEach((p) => [Y - 1, Y].forEach((y) => {
      if (!E.employedInYear(p, y)) return;
      assert.ok(E.balance(M, p, y).remaining >= 0, p.name + ' ' + y + ' ' + E.balance(M, p, y).remaining);
      assert.ok(E.balance(M, p, y).current >= 0);
    }));
    db.teams.forEach((tm) => {
      for (let d = (Y - 1) + '-01-01'; d <= Y + '-12-31'; d = E.addDays(d, 1)) {
        let size = 0, away = 0;
        M.members[tm.id].forEach((m) => {
          const di = E.dayInfo(M, m, d);
          if (!di.frac) return;
          size++;
          (E.dayIndex(M, m.id)[d] || []).forEach((x) => { if (x.r.status === 'approved' && E.TYPE[x.r.type].away && x.r.type !== 'sick') away += x.value / di.frac; });
        });
        if (size) assert.ok(size - away >= tm.min - 1e-9, tm.name + ' on ' + d + ': ' + (size - away) + ' of ' + size);
      }
    });
    // pending requests: 5–8, at least two that need an override note
    const pend = db.requests.filter((r) => r.status === 'pending');
    assert.ok(pend.length >= 5 && pend.length <= 8, 'pending ' + pend.length);
    const kinds = pend.map((r) => E.conflicts(M, r).filter((c) => c.kind !== 'info').map((c) => c.kind)).filter((k) => k.length);
    assert.ok(kinds.length >= 2, 'conflicting pending requests: ' + kinds.length);
    const flat = [].concat.apply([], kinds);
    assert.ok(flat.indexOf('min') >= 0 && flat.indexOf('blackout') >= 0 && flat.indexOf('overlap') >= 0);
    assert.ok(db.requests.filter((r) => r.status === 'declined' && r.comment).length >= 3);
    assert.ok(db.requests.filter((r) => r.type === 'sick').length >= 20);
    assert.ok(db.requests.filter((r) => r.type === 'remote').length >= 20);
    // summer holidays are concentrated in July and August
    const months = {}; db.requests.filter((r) => r.type === 'annual' && r.status === 'approved').forEach((r) => E.requestDays(M, r).forEach((x) => { const m = x.date.slice(5, 7); months[m] = (months[m] || 0) + x.value; }));
    const summer = (months['07'] || 0) + (months['08'] || 0), total = Object.keys(months).reduce((s, k) => s + months[k], 0);
    assert.ok(summer / total > 0.3, 'July and August hold a good share of the leave: ' + summer + ' of ' + total);
    // the demo "me": days left, a carry-over and a week off coming up
    const me = db.people[11];
    assert.strictEqual(me.name, 'Tina Zupan');
    const b = E.balance(M, me, Y);
    assert.ok(b.carry.days > 0 && b.remaining > 0, 'me: carry ' + b.carry.days + ', remaining ' + b.remaining);
    assert.ok(M.req[me.id].some((r) => r.status === 'approved' && r.type === 'annual' && r.from > today && r.from <= E.addDays(today, 30) && E.countDays(M, r) >= 5), 'me: a week off coming up');
    // clock events: well-formed and in order, for the last 8 weeks
    assert.ok(db.clock.length > 3000 && db.clock.length < 9000, 'clock ' + db.clock.length);
    assert.strictEqual(new Set(db.clock.map((c) => c.id)).size, db.clock.length);
    db.people.forEach((p) => {
      const evs = M.clock[p.id];
      const ss = E.sessionsOf(evs);
      assert.strictEqual(ss.orphans.length, 0, p.name);
      ss.sessions.forEach((s) => {
        const ats = s.events.map((e) => e.at);
        for (let i = 1; i < ats.length; i++) assert.ok(ats[i] > ats[i - 1], p.name + ' ' + s.date);
        assert.ok(s.date >= db.clockSince && s.date < today);
        if (s.outAt) assert.ok(E.minutesBetween(s.inAt, s.outAt) > 60 && E.minutesBetween(s.inAt, s.outAt) < 17 * 60);
        assert.strictEqual(s.events[0].kind, 'in');
      });
    });
    // a handful of anomalies to fix
    const flags = {};
    db.people.forEach((p) => { E.timeline(M, p, Y).days.concat(Y > +db.clockSince.slice(0, 4) ? E.timeline(M, p, Y - 1).days : []).forEach((d) => { if (d.date >= db.clockSince && d.date < today) d.flags.forEach((f) => { flags[f.code] = (flags[f.code] || 0) + 1; }); }); });
    assert.ok(flags.missingOut >= 2 && flags.missingOut <= 6, 'missing clock-outs ' + flags.missingOut);
    assert.ok(flags.shortRest >= 1 && flags.shortRest <= 6, 'short rests ' + flags.shortRest);
    assert.ok((flags.noClock || 0) <= 3);
    // the audit trail matches the events it describes
    db.audit.forEach((a) => {
      const ev = db.clock.filter((c) => c.id === a.eventId)[0];
      assert.ok(ev && ev.edited && ev.at.slice(11) === a['new'] && ev.personId === a.personId && a.reason);
    });
    assert.ok(JSON.stringify(db).length < 1500000);
  });
});

console.log(n + ' tests passed');
