// Tests for site/service/engine.js and data.js. Run: node tools/tests/service-engine.test.js
'use strict';
const assert = require('assert');
const path = require('path');
const E = require(path.join(__dirname, '../../site/service/engine.js'));
const D = require(path.join(__dirname, '../../site/service/data.js'));

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok', n, name); }
const S = { labourRate: 46, callout: 35, freeKm: 20, kmRate: 0.55, emergencyPct: 50, vat: 22, farKm: 35, sla: { premium: 24, basic: 72, none: 120 } };

// ── dates and times ──────────────────────────────────────────────────────
t('addMonths is month-end safe', () => {
  assert.strictEqual(E.addMonths('2026-01-31', 1), '2026-02-28');
  assert.strictEqual(E.addMonths('2028-01-31', 1), '2028-02-29');
  assert.strictEqual(E.addMonths('2026-03-31', 1), '2026-04-30');
  assert.strictEqual(E.addMonths('2026-12-15', 1), '2027-01-15');
  assert.strictEqual(E.addMonths('2026-01-31', -1), '2025-12-31');
  assert.strictEqual(E.addMonths('2024-02-29', 12), '2025-02-28');
  assert.strictEqual(E.addMonths('2026-08-31', 6), '2027-02-28');
  assert.strictEqual(E.addMonths('2026-10-13', 24), '2028-10-13');
});

t('isDate, stamps and minutes', () => {
  assert.ok(E.isDate('2028-02-29') && !E.isDate('2026-02-29') && !E.isDate('13. 10. 2026'));
  assert.ok(E.isStamp('2026-10-13T09:05') && !E.isStamp('2026-10-13T24:00') && !E.isStamp('2026-10-13 09:05'));
  assert.strictEqual(E.fromMin(E.toMin('2026-10-13T09:05')), '2026-10-13T09:05');
  assert.strictEqual(E.addMin('2026-10-13T23:50', 20), '2026-10-14T00:10');
  assert.strictEqual(E.addMin('2026-03-01T00:10', -20), '2026-02-28T23:50');
  assert.strictEqual(E.minutesBetween('2026-10-13T08:10', '2026-10-13T09:35'), 85);
  assert.strictEqual(E.fmtDate('2026-10-03'), '3. 10. 2026');
  assert.strictEqual(E.fmtStamp('2026-10-03T07:05'), '3. 10. 2026 07:05');
});

t('Easter and Slovenian public holidays', () => {
  assert.strictEqual(E.easter(2024), '2024-03-31');
  assert.strictEqual(E.easter(2025), '2025-04-20');
  assert.strictEqual(E.easter(2026), '2026-04-05');
  assert.strictEqual(E.easter(2027), '2027-03-28');
  const h = E.holidayMap(E.siHolidays(2026));
  assert.strictEqual(h['2026-04-06'], 'Easter Monday');
  assert.ok(h['2026-06-25'] && h['2026-01-02'] && h['2026-12-26'] && h['2026-05-24']); // Whit Sunday 2026
  assert.strictEqual(E.isWorkday('2026-06-25', h), false); // Statehood Day, a Thursday
  assert.strictEqual(E.isWorkday('2026-10-17', h), false); // Saturday
  assert.strictEqual(E.isWorkday('2026-10-13', h), true);
  assert.strictEqual(E.nextWorkday('2026-04-03', h), '2026-04-07'); // Friday → over Easter Monday
  assert.strictEqual(E.prevWorkday('2026-04-07', h), '2026-04-03');
  assert.strictEqual(E.workdays('2026-04-06', '2026-04-10', h), 4);
});

t('arrival windows', () => {
  assert.deepStrictEqual(E.WINDOWS.map((w) => w.label), ['08–10', '10–12', '12–14', '14–16']);
  assert.strictEqual(E.windowAt('07:59'), -1);
  assert.strictEqual(E.windowAt('08:00'), 0);
  assert.strictEqual(E.windowAt('09:59'), 0);
  assert.strictEqual(E.windowAt('10:00'), 1);
  assert.strictEqual(E.windowAt('15:59'), 3);
  assert.strictEqual(E.windowAt('16:00'), 4);
  assert.deepStrictEqual(E.winRange({ window: '10', span: 2 }), [1, 3]);
  assert.deepStrictEqual(E.winRange({ window: '12', span: 4 }), [2, 4]); // clipped at the end of the day
  assert.strictEqual(E.winRange({ window: '' }), null);
  assert.strictEqual(E.defaultSpan('install', 'hp'), 4);
  assert.strictEqual(E.defaultSpan('install', 'ac'), 2);
  assert.strictEqual(E.defaultSpan('commission', 'hp'), 2);
  assert.strictEqual(E.defaultSpan('repair', 'gas'), 1);
});

// ── SLA ──────────────────────────────────────────────────────────────────
t('SLA due by plan; services have none', () => {
  const j = { type: 'repair', reportedAt: '2026-10-12T09:00', status: 'new' };
  assert.strictEqual(E.slaDue(j, 'premium', S), '2026-10-13T09:00');
  assert.strictEqual(E.slaDue(j, 'basic', S), '2026-10-15T09:00');
  assert.strictEqual(E.slaDue(j, 'none', S), '2026-10-17T09:00');
  assert.strictEqual(E.slaDue(j, 'unknown-plan', S), '2026-10-17T09:00');
  assert.strictEqual(E.slaDue({ type: 'service', reportedAt: '2026-10-12T09:00' }, 'premium', S), null);
  assert.strictEqual(E.slaDue(j, 'premium', Object.assign({}, S, { sla: { premium: 8, basic: 72, none: 120 } })), '2026-10-12T17:00');
  assert.strictEqual(E.slaDue({ type: 'repair', reportedAt: '' }, 'premium', S), null);
});

t('SLA risk (4 h), overdue, met and missed', () => {
  const j = { type: 'repair', reportedAt: '2026-10-12T09:00', status: 'new' };
  assert.strictEqual(E.slaState(j, 'premium', '2026-10-13T04:59', S).state, 'ok');
  assert.strictEqual(E.slaState(j, 'premium', '2026-10-13T05:00', S).state, 'risk'); // exactly 4 h left
  assert.strictEqual(E.slaState(j, 'premium', '2026-10-13T08:59', S).left, 1);
  assert.strictEqual(E.slaState(j, 'premium', '2026-10-13T09:01', S).state, 'overdue');
  assert.strictEqual(E.slaState(Object.assign({}, j, { arriveAt: '2026-10-13T08:40' }), 'premium', '2026-10-20T10:00', S).state, 'met');
  assert.strictEqual(E.slaState(Object.assign({}, j, { arriveAt: '2026-10-13T09:20' }), 'premium', '2026-10-20T10:00', S).state, 'missed');
  // the first visit counts, even when the job needed a second one
  const twice = Object.assign({}, j, { visits: [{ arriveAt: '2026-10-12T15:00' }], arriveAt: '2026-10-16T09:00' });
  assert.strictEqual(E.slaState(twice, 'premium', '2026-10-20T10:00', S).state, 'met');
  assert.strictEqual(E.slaState(Object.assign({}, j, { status: 'cancelled' }), 'premium', '2026-10-20T10:00', S).state, 'none');
  // planned after the due time
  const late = Object.assign({}, j, { status: 'scheduled', date: '2026-10-13', window: '10' });
  assert.strictEqual(E.slaState(late, 'premium', '2026-10-12T12:00', S).plannedLate, true);
  assert.strictEqual(E.slaState(Object.assign({}, late, { window: '08' }), 'premium', '2026-10-12T12:00', S).plannedLate, false);
});

// ── statuses ─────────────────────────────────────────────────────────────
t('valid status transitions', () => {
  ['scheduled', 'cancelled'].forEach((s) => assert.ok(E.canMove('new', s)));
  assert.ok(E.canMove('scheduled', 'travelling') && E.canMove('travelling', 'onsite') && E.canMove('onsite', 'done') && E.canMove('done', 'invoiced'));
  assert.ok(E.canMove('onsite', 'parts') && E.canMove('parts', 'scheduled') && E.canMove('cancelled', 'new'));
  assert.ok(E.canMove('scheduled', 'onsite')); // arrived without pressing "Start travel"
  assert.ok(!E.canMove('new', 'done') && !E.canMove('done', 'onsite') && !E.canMove('invoiced', 'done') && !E.canMove('onsite', 'cancelled') && !E.canMove('bogus', 'new'));
  assert.deepStrictEqual(E.TRANSITIONS.invoiced, []);
  assert.ok(E.isOpen('parts') && !E.isOpen('done') && !E.isOpen('cancelled'));
  assert.ok(E.isBooked({ status: 'done', techId: 't1', date: '2026-10-13', window: '08' }));
  assert.ok(!E.isBooked({ status: 'new', techId: 't1', date: '2026-10-13', window: '08' }));
});

// ── checklist ────────────────────────────────────────────────────────────
t('checklist completeness: required items, numbers, n.a., choices', () => {
  const items = [
    { id: 'a', t: 'pf', req: true }, { id: 'b', t: 'pf', req: false }, { id: 'c', t: 'num', req: true, unit: 'bar', lo: 1, hi: 2 },
    { id: 'd', t: 'num', req: true, unit: 'ppm', lo: 0, hi: 100 }, { id: 'e', t: 'choice', req: true, opts: [{ id: 'clean' }, { id: 'dirty' }] }, { id: 'f', t: 'pf', req: true, off: true }
  ];
  let s = E.checklistStatus(items, {});
  assert.deepStrictEqual(s.missing, ['a', 'c', 'd', 'e']);
  assert.strictEqual(s.total, 5); // archived items do not count
  assert.strictEqual(s.complete, false);
  s = E.checklistStatus(items, { a: 'fail', c: 0.8, d: 0, e: 'clean' });
  assert.strictEqual(s.complete, true); // 0 is a measured value
  assert.strictEqual(s.fails, 1);
  assert.strictEqual(s.out, 1); // 0.8 bar is below the typical 1–2 bar
  assert.strictEqual(E.checklistStatus(items, { a: 'pass', c: 'na', d: 12, e: 'clean' }).complete, true);
  assert.strictEqual(E.checklistStatus(items, { a: 'pass', c: NaN, d: 12, e: 'clean' }).complete, false);
  assert.strictEqual(E.checklistStatus(items, { a: 'maybe', c: 1.5, d: 12, e: 'clean' }).complete, false);
  assert.strictEqual(E.checklistStatus(items, { a: 'pass', c: 1.5, d: 12, e: 'shiny' }).complete, false);
  assert.strictEqual(E.outOfRange({ t: 'num', lo: null, hi: 100 }, 150), true);
  assert.strictEqual(E.outOfRange({ t: 'num', lo: -40, hi: -20 }, -25), false);
  assert.strictEqual(E.outOfRange({ t: 'num', lo: '', hi: '' }, 99999), false);
});

// ── pricing ──────────────────────────────────────────────────────────────
t('labour is billed in started quarter hours', () => {
  assert.strictEqual(E.billedMinutes(0), 0);
  assert.strictEqual(E.billedMinutes(1), 15);
  assert.strictEqual(E.billedMinutes(15), 15);
  assert.strictEqual(E.billedMinutes(61), 75);
  assert.strictEqual(E.billedMinutes(-5), 0);
  assert.strictEqual(E.billedMinutes(44.6), 45);
});

t('price: labour, emergency surcharge, call-out, km beyond the free ones, parts and VAT to the cent', () => {
  const job = { labourMin: 61, priority: 'emergency', km: 47, parts: [{ partId: 'GB-ELC-01', qty: 2, price: 24.6 }, { partId: 'RF-R32', qty: 0.35, price: 46 }], billing: { labour: true, callout: true, km: true, parts: true } };
  const p = E.priceJob(job, S, { 'GB-ELC-01': { code: 'GB-ELC-01', unit: 'pc' }, 'RF-R32': { code: 'RF-R32', unit: 'kg' } });
  assert.strictEqual(p.billedMin, 75);
  assert.strictEqual(p.labour, 57.5);
  assert.strictEqual(p.surcharge, 28.75);
  assert.strictEqual(p.callout, 35);
  assert.strictEqual(p.kmCharged, 27);
  assert.strictEqual(p.kmCost, 14.85);
  assert.strictEqual(p.parts, 65.3);
  assert.strictEqual(p.net, 201.4);
  assert.strictEqual(p.vat, 44.31);
  assert.strictEqual(p.total, 245.71);
  assert.deepStrictEqual(p.lines.map((l) => l.code), ['LAB', 'EMR', 'CALL', 'KM', 'GB-ELC-01', 'RF-R32']);
  assert.strictEqual(p.lines.reduce((s, l) => s + Math.round(l.net * 100), 0), 20140); // the lines add up to the net total
});

t('price: no surcharge on a normal job, nothing under the free km, rounding of odd rates', () => {
  const p = E.priceJob({ labourMin: 50, priority: 'normal', km: 18, parts: [], billing: { labour: true, callout: false, km: true, parts: true } }, Object.assign({}, S, { labourRate: 47.3 }));
  assert.strictEqual(p.labour, 47.3);
  assert.strictEqual(p.surcharge, 0);
  assert.strictEqual(p.kmCost, 0);
  assert.strictEqual(p.net, 47.3);
  assert.strictEqual(p.vat, 10.41); // 10.406
  const q = E.priceJob({ labourMin: 7, parts: [{ partId: 'x', qty: 1.5, price: 0.33 }, { partId: 'y', qty: 3, price: 0.333 }] }, Object.assign({}, S, { labourRate: 0.2, callout: 0, vat: 22 }));
  assert.strictEqual(q.labour, 0.05); // 15 min × 0.20 €/h
  assert.strictEqual(q.parts, 1.49); // 1.5 m × 0.33 = 0.495 → 0.50; unit prices are whole cents: 3 × 0.33 = 0.99
  assert.strictEqual(q.net, 1.54);
  assert.strictEqual(q.vat, 0.34); // 0.3388
  assert.strictEqual(q.total, 1.88);
});

t('price: plan and warranty cover work; the surcharge needs billed labour', () => {
  const planSvc = { labourMin: 80, priority: 'normal', km: 60, parts: [{ partId: 'GN-SEA-01', qty: 1, price: 6.8 }], billing: E.defaultBilling('service', 'basic', false) };
  const p = E.priceJob(planSvc, S);
  assert.strictEqual(p.labour, 0);
  assert.strictEqual(p.callout, 0);
  assert.strictEqual(p.kmCost, 0);
  assert.strictEqual(p.parts, 6.8);
  assert.strictEqual(p.total, 8.3);
  assert.ok(p.lines[0].covered);
  const w = E.priceJob({ labourMin: 45, priority: 'emergency', km: 80, parts: [{ partId: 'x', qty: 1, price: 300 }], billing: E.defaultBilling('repair', 'none', true) }, S);
  assert.strictEqual(w.total, 0);
  assert.strictEqual(w.surcharge, 0);
});

t('price: a signed job keeps the rates it was signed with', () => {
  const job = { labourMin: 60, priority: 'normal', km: 0, parts: [], billing: { labour: true, callout: true, km: true, parts: true } };
  const signed = Object.assign({}, job, { rates: E.frozenRates(S) });
  const raised = Object.assign({}, S, { labourRate: 60, callout: 40, vat: 25 });
  assert.strictEqual(E.priceJob(job, raised).net, 100);
  assert.strictEqual(E.priceJob(signed, raised).net, 81);
  assert.strictEqual(E.priceJob(signed, raised).vatRate, 22);
  assert.deepStrictEqual(Object.keys(E.frozenRates(S)).sort(), ['callout', 'emergencyPct', 'freeKm', 'kmRate', 'labourRate', 'vat']);
});

t('default billing by job type, plan and warranty', () => {
  assert.deepStrictEqual(E.defaultBilling('service', 'premium', false), { labour: false, callout: false, km: false, parts: true, why: 'plan' });
  assert.deepStrictEqual(E.defaultBilling('service', 'none', false), { labour: true, callout: true, km: true, parts: true, why: '' });
  assert.strictEqual(E.defaultBilling('repair', 'premium', false).callout, false);
  assert.strictEqual(E.defaultBilling('repair', 'basic', false).callout, true);
  assert.strictEqual(E.defaultBilling('repair', 'basic', true).why, 'warranty');
  assert.strictEqual(E.defaultBilling('warranty', 'none', false).labour, false);
  assert.strictEqual(E.defaultBilling('install', 'none', false).callout, false);
});

// ── maintenance ──────────────────────────────────────────────────────────
t('next service date = last service + interval, month-end safe', () => {
  assert.strictEqual(E.nextDue({ lastService: '2026-01-31', interval: 1 }), '2026-02-28');
  assert.strictEqual(E.nextDue({ lastService: '2025-08-31', interval: 6 }), '2026-02-28');
  assert.strictEqual(E.nextDue({ lastService: '2025-10-20', interval: 12 }), '2026-10-20');
  assert.strictEqual(E.nextDue({ lastService: '', installed: '2024-05-15', interval: 24 }), '2026-05-15');
  assert.strictEqual(E.nextDue({ lastService: '', installed: '', interval: 12 }), null);
  assert.strictEqual(E.nextDue({ lastService: '2025-10-20', interval: 0 }), null);
  const today = '2026-10-13';
  assert.strictEqual(E.dueBucket('2026-10-12', today), 'overdue');
  assert.strictEqual(E.dueBucket('2026-10-13', today), 'd30');
  assert.strictEqual(E.dueBucket('2026-11-12', today), 'd30');
  assert.strictEqual(E.dueBucket('2026-11-13', today), 'd60');
  assert.strictEqual(E.dueBucket('2027-01-11', today), 'd90');
  assert.strictEqual(E.dueBucket('2027-01-12', today), 'later');
});

t('maintenance list: plan customers first, open jobs found, future installations left out', () => {
  const db = {
    customers: [{ id: 'c1', plan: 'none' }, { id: 'c2', plan: 'premium' }, { id: 'c3', plan: 'basic' }],
    assets: [
      { id: 'a1', customerId: 'c1', installed: '2020-01-01', lastService: '2025-10-01', interval: 12 }, // overdue, no plan
      { id: 'a2', customerId: 'c2', installed: '2020-01-01', lastService: '2025-11-01', interval: 12 }, // due 1. 11., premium
      { id: 'a3', customerId: 'c3', installed: '2020-01-01', lastService: '2025-10-20', interval: 12 }, // due 20. 10., basic
      { id: 'a4', customerId: 'c2', installed: '2026-10-20', lastService: '', interval: 12 }, // not installed yet
      { id: 'a5', customerId: 'c3', installed: '2020-01-01', lastService: '2026-05-01', interval: 12 } // later than 90 days
    ],
    jobs: [{ id: 'j1', assetId: 'a3', type: 'service', status: 'scheduled' }, { id: 'j2', assetId: 'a1', type: 'service', status: 'invoiced' }]
  };
  const rows = E.maintenanceList(db, '2026-10-13', 90);
  assert.deepStrictEqual(rows.map((r) => r.asset.id), ['a2', 'a3', 'a1']);
  assert.strictEqual(rows[1].open.id, 'j1');
  assert.strictEqual(rows[2].open, null);
  // no plan, past due and nobody booked it: a reminder to send, not an overdue visit owed under a plan
  assert.strictEqual(rows[2].bucket, 'remind');
  assert.strictEqual(rows[0].days, 19);
  assert.strictEqual(rows[0].bucket, 'd30');
  // a plan visit overdue with no job is overdue; booked for a later day it follows the booked day
  db.assets[1].lastService = '2025-09-01';
  assert.strictEqual(E.maintenanceList(db, '2026-10-13', 90)[0].bucket, 'overdue');
  db.jobs.push({ id: 'j3', assetId: 'a2', type: 'service', status: 'scheduled', date: '2026-10-20', techId: 't1', window: '08' });
  const r2 = E.maintenanceList(db, '2026-10-13', 90)[0];
  assert.strictEqual(r2.bucket, 'd30'); assert.strictEqual(r2.booked, '2026-10-20'); assert.strictEqual(r2.when, '2026-10-20'); assert.ok(r2.days < 0);
  assert.strictEqual(E.maintenanceList(db, '2026-10-21', 90)[0].bucket, 'overdue', 'the booked day passed and the job is still open');
});

// ── first-time fix and utilisation ───────────────────────────────────────
t('first-time fix: no repair on the same equipment within 30 days, one visit', () => {
  const base = { id: 'j1', assetId: 'a1', type: 'repair', status: 'done', finishAt: '2026-09-01T10:00', visits: [] };
  const again = (at, extra) => Object.assign({ id: 'j2', assetId: 'a1', type: 'repair', status: 'new', reportedAt: at }, extra || {});
  assert.strictEqual(E.isFirstTimeFix(base, [base]), true);
  assert.strictEqual(E.isFirstTimeFix(base, [base, again('2026-09-20T08:00')]), false);
  assert.strictEqual(E.isFirstTimeFix(base, [base, again('2026-10-01T10:00')]), false); // exactly 30 days
  assert.strictEqual(E.isFirstTimeFix(base, [base, again('2026-10-01T10:01')]), true);
  assert.strictEqual(E.isFirstTimeFix(base, [base, again('2026-09-20T08:00', { assetId: 'a2' })]), true);
  assert.strictEqual(E.isFirstTimeFix(base, [base, again('2026-09-20T08:00', { status: 'cancelled' })]), true);
  assert.strictEqual(E.isFirstTimeFix(base, [base, again('2026-09-20T08:00', { type: 'service' })]), true);
  assert.strictEqual(E.isFirstTimeFix(Object.assign({}, base, { visits: [{ arriveAt: '2026-08-28T09:00', leftAt: '2026-08-28T09:40' }] }), [base]), false);
  assert.strictEqual(E.isFirstTimeFix(Object.assign({}, base, { status: 'onsite' }), [base]), null);
  const list = [base, again('2026-09-20T08:00'), Object.assign({}, base, { id: 'j3', assetId: 'a9', finishAt: '2026-10-10T10:00' })];
  const r = E.ftfRate(list, { asOf: '2026-10-13' });
  assert.deepStrictEqual([r.n, r.ok, r.rate], [1, 0, 0]); // the job finished 10. 10. waits until its 30 days are over
  // the repair index (built once for big lists) gives the same answers
  const idx = E.repairIndex(list);
  assert.deepStrictEqual(Object.keys(idx).sort(), ['a1']);
  assert.deepStrictEqual(E.ftfRate(list, { asOf: '2026-10-13', index: idx }), r);
  assert.strictEqual(E.isFirstTimeFix(base, list, null, idx), false);
});

t('utilisation: on-site hours, and on site + travel, ÷ available hours on working days', () => {
  const hmap = E.holidayMap(E.siHolidays(2026));
  const jobs = [
    { id: 'j1', techId: 't1', travelAt: '2026-04-07T07:45', arriveAt: '2026-04-07T08:10', finishAt: '2026-04-07T09:40', visits: [] },
    { id: 'j2', techId: 't1', travelAt: '2026-04-09T09:40', arriveAt: '2026-04-09T10:00', finishAt: '2026-04-09T11:30', visits: [{ techId: 't1', travelAt: '2026-04-08T07:30', arriveAt: '2026-04-08T08:00', leftAt: '2026-04-08T08:30' }] },
    { id: 'j3', techId: 't2', travelAt: '2026-04-07T07:30', arriveAt: '2026-04-07T08:00', finishAt: '2026-04-07T12:00', visits: [] },
    { id: 'j4', techId: 't1', arriveAt: '2026-04-14T08:00', finishAt: '2026-04-14T12:00', visits: [] },
    { id: 'j5', techId: 't1', travelAt: '2026-04-10T13:00', status: 'travelling', visits: [] } // still on the road: not counted yet
  ];
  const u = E.utilisation(jobs, 't1', '2026-04-06', '2026-04-10', hmap, 8); // Easter Monday is off
  assert.strictEqual(u.days, 4);
  assert.strictEqual(u.onsite, 210);
  assert.strictEqual(u.travel, 25 + 30 + 20);
  assert.strictEqual(u.avail, 4 * 8 * 60);
  assert.ok(Math.abs(u.rate - 210 / 1920) < 1e-9);
  assert.ok(Math.abs(u.rateTravel - 285 / 1920) < 1e-9);
  assert.strictEqual(E.onsiteMinutes(jobs[1]), 120);
  assert.deepStrictEqual(E.travelSpans(jobs[1]).map((x) => [x.date, x.min]), [['2026-04-08', 30], ['2026-04-09', 20]]);
  const none = E.utilisation(jobs, 't9', '2026-04-06', '2026-04-10', hmap, 8);
  assert.deepStrictEqual([none.onsite, none.travel, none.rate, none.rateTravel], [0, 0, 0, 0]);
});

// ── scheduling conflicts ─────────────────────────────────────────────────
t('conflicts: double booking, skills, distance, day off, SLA, fit and the past', () => {
  const hmap = E.holidayMap(E.siHolidays(2026));
  const techs = { t1: { id: 't1', name: 'Ana', skills: ['hp', 'ac'], base: 'Velenje' } };
  const other = { id: 'x', no: 'SJ-2026-0100', techId: 't1', date: '2026-10-14', window: '10', span: 2, status: 'scheduled' };
  const job = { id: 'j', type: 'repair', reportedAt: '2026-10-13T09:00', span: 1 };
  const ctx = (o) => Object.assign({ jobs: [other], tech: techs.t1, asset: { kind: 'hp' }, customer: { city: 'Šoštanj', plan: 'basic' }, settings: S, hmap: hmap, now: '2026-10-13T10:00' }, o || {});
  const codes = (a, c, j) => E.conflicts(j || job, a, ctx(c)).map((x) => x.code);
  assert.deepStrictEqual(codes({ date: '2026-10-14', window: '08' }), []);
  assert.deepStrictEqual(codes({ date: '2026-10-14', window: '12' }), ['double']); // the other job spans 10–14
  assert.deepStrictEqual(codes({ date: '2026-10-14', window: '14' }), []);
  assert.deepStrictEqual(codes({ date: '2026-10-14', window: '12' }, { jobs: [Object.assign({}, other, { status: 'cancelled' })] }), []);
  assert.deepStrictEqual(codes({ date: '2026-10-14', window: '08' }, { asset: { kind: 'gas' } }), ['skill']);
  assert.deepStrictEqual(codes({ date: '2026-10-14', window: '08' }, { customer: { city: 'Šmarje pri Jelšah', plan: 'basic' } }), ['far']); // 45 km from Velenje
  assert.deepStrictEqual(codes({ date: '2026-10-17', window: '08' }, { customer: { city: 'Šoštanj', plan: 'none' } }), ['dayoff']);
  assert.deepStrictEqual(codes({ date: '2026-10-16', window: '14' }, { customer: { city: 'Šoštanj', plan: 'premium' } }), ['sla']);
  assert.deepStrictEqual(codes({ date: '2026-10-13', window: '08' }), ['past']);
  const install = { id: 'i', type: 'install', span: 4, reportedAt: '2026-10-01T09:00' };
  assert.deepStrictEqual(codes({ date: '2026-10-15', window: '10' }, {}, install).slice(0, 2), ['span', 'skill']); // needs the whole day and an electrician
  assert.strictEqual(E.conflicts(install, { date: '2026-10-15', window: '10' }, ctx()).filter((c) => c.level === 'error').length, 1);
  assert.strictEqual(E.conflicts(job, { date: '2026-10-14', window: '' }, ctx())[0].code, 'window');
  assert.strictEqual(E.conflicts(job, { date: '2026-10-14', window: '08' }, ctx({ tech: null }))[0].code, 'tech');
});

t('required skills and the distance table', () => {
  assert.deepStrictEqual(E.requiredSkills('gas', 'repair'), ['gas']);
  assert.deepStrictEqual(E.requiredSkills('hp', 'install'), ['hp', 'el']);
  assert.deepStrictEqual(E.requiredSkills('solar', 'service'), ['hp']);
  assert.deepStrictEqual(E.missingSkills({ skills: ['ac'] }, 'ac', 'commission'), ['el']);
  E.TOWNS.forEach((a) => E.TOWNS.forEach((b) => {
    const d = E.distanceKm(a.name, b.name);
    assert.strictEqual(d, E.distanceKm(b.name, a.name));
    assert.ok(a.name === b.name ? d === 0 : d >= 3 && d <= 120, a.name + '–' + b.name + ' ' + d);
  }));
  assert.strictEqual(E.distanceKm('Celje', 'Ljubljana'), 76);
  assert.strictEqual(E.distanceKm('Celje', 'Atlantis'), null);
  assert.strictEqual(E.tripKm('Celje', 'Celje'), 8);
  assert.strictEqual(E.tripKm('Celje', 'Žalec'), 20);
  assert.strictEqual(E.postalOf('Velenje'), '3320');
});

// ── numbering, photos ────────────────────────────────────────────────────
t('job numbers per year', () => {
  const jobs = [{ no: 'SJ-2026-0411' }, { no: 'SJ-2026-0007' }, { no: 'SJ-2025-0999' }, { no: 'junk' }, {}];
  assert.strictEqual(E.nextJobNo(jobs, 2026), 'SJ-2026-0412');
  assert.strictEqual(E.nextJobNo(jobs, 2027), 'SJ-2027-0001');
  assert.strictEqual(E.nextJobNo([], 2026), 'SJ-2026-0001');
  assert.strictEqual(E.jobNo(2026, 10000), 'SJ-2026-10000');
  assert.strictEqual(E.nextJobNo([{ no: 'SJ-2026-9999' }], 2026), 'SJ-2026-10000');
  assert.deepStrictEqual(E.parseJobNo('SJ-2026-0412'), { year: 2026, seq: 412 });
  assert.strictEqual(E.parseJobNo('SJ-26-12'), null);
});

t('photo downscale fits inside 1600 px and never enlarges', () => {
  assert.deepStrictEqual(E.fitWithin(4032, 3024, 1600), { w: 1600, h: 1200, scale: 1600 / 4032 });
  assert.deepStrictEqual([E.fitWithin(3024, 4032).w, E.fitWithin(3024, 4032).h], [1200, 1600]);
  assert.deepStrictEqual(E.fitWithin(800, 600, 1600), { w: 800, h: 600, scale: 1 });
  assert.deepStrictEqual([E.fitWithin(1600, 1601).w, E.fitWithin(1600, 1601).h], [1599, 1600]);
  assert.deepStrictEqual([E.fitWithin(6000, 10).w, E.fitWithin(6000, 10).h], [1600, 3]);
  assert.deepStrictEqual([E.fitWithin(10000, 1).w, E.fitWithin(10000, 1).h], [1600, 1]);
  assert.deepStrictEqual(E.fitWithin(0, 100), { w: 0, h: 0, scale: 0 });
  assert.deepStrictEqual(E.fitWithin('x', 100), { w: 0, h: 0, scale: 0 });
});

// ── reports ──────────────────────────────────────────────────────────────
t('report figures: jobs per week, revenue by month, time on site, parts, failing models', () => {
  const jobs = [
    { id: 'j1', assetId: 'a1', type: 'repair', status: 'done', priority: 'normal', reportedAt: '2026-09-01T08:00', arriveAt: '2026-09-01T10:00', finishAt: '2026-09-01T11:00', labourMin: 60, km: 10, parts: [{ partId: 'p1', qty: 2, price: 10 }], billing: { labour: true, callout: true, km: true, parts: true }, techId: 't1' },
    { id: 'j2', assetId: 'a2', type: 'service', status: 'invoiced', priority: 'normal', reportedAt: '2026-08-20T08:00', arriveAt: '2026-09-03T08:00', finishAt: '2026-09-03T09:30', labourMin: 90, km: 30, parts: [{ partId: 'p1', qty: 1, price: 10 }], billing: { labour: false, callout: false, km: false, parts: true }, techId: 't1' },
    { id: 'j3', assetId: 'a1', type: 'repair', status: 'cancelled', reportedAt: '2026-09-05T08:00', parts: [] },
    { id: 'j4', assetId: 'a1', type: 'repair', status: 'done', priority: 'normal', reportedAt: '2026-10-02T08:00', arriveAt: '2026-10-05T08:00', finishAt: '2026-10-05T08:30', labourMin: 30, km: 0, parts: [], billing: { labour: true, callout: false, km: true, parts: true }, techId: 't1' }
  ];
  const w = E.jobsPerWeek(jobs, '2026-08-31', '2026-10-11');
  assert.strictEqual(w[0].week, '2026-08-31');
  assert.strictEqual(w[0].n, 2);
  assert.strictEqual(w[5].n, 1);
  const rev = E.revenueByMonth(jobs, S, {});
  assert.deepStrictEqual(rev.map((m) => m.month), ['2026-09', '2026-10']);
  assert.strictEqual(rev[0].labour, 46);
  assert.strictEqual(rev[0].parts, 30);
  assert.strictEqual(rev[0].other, 35); // call-out; 10 km are free
  assert.strictEqual(rev[0].net, 111);
  assert.strictEqual(rev[1].net, 23);
  const avg = E.avgOnsiteByType(jobs);
  assert.strictEqual(avg.find((x) => x.type === 'repair').avg, 45);
  assert.strictEqual(avg.find((x) => x.type === 'install').avg, null);
  const tp = E.topParts(jobs);
  assert.deepStrictEqual([tp[0].partId, tp[0].qty, tp[0].jobs, tp[0].net], ['p1', 3, 2, 30]);
  const fm = E.failingModels(jobs, [{ id: 'a1', brand: 'B', model: 'M1', kind: 'gas' }, { id: 'a2', brand: 'B', model: 'M2', kind: 'hp' }, { id: 'a3', brand: 'B', model: 'M2', kind: 'hp' }]);
  assert.deepStrictEqual(fm.map((x) => [x.model, x.units, x.repairs, x.per100]), [['M1', 1, 2, 200], ['M2', 2, 0, 0]]);
  const sla = E.slaStats(jobs, () => 'premium', S, null, null);
  assert.deepStrictEqual([sla.n, sla.met], [2, 1]); // j1 arrived within 24 h, j4 did not
});

t('report wording exists in Slovene, Croatian and English', () => {
  const keys = (o, p) => Object.keys(o).reduce((a, k) => a.concat(o[k] && typeof o[k] === 'object' ? keys(o[k], p + k + '.') : [p + k]), []);
  const en = keys(E.I18N.en, '').sort();
  ['sl', 'hr'].forEach((l) => {
    assert.deepStrictEqual(keys(E.I18N[l], '').sort(), en, l + ' has the same keys');
    keys(E.I18N[l], '').forEach((k) => { const v = k.split('.').reduce((o, x) => o[x], E.I18N[l]); assert.ok(typeof v === 'string' && v.trim(), l + '.' + k); });
  });
  assert.strictEqual(E.t('sl', 'title'), 'Servisno poročilo');
  assert.strictEqual(E.t('hr', 'title'), 'Servisno izvješće');
  assert.strictEqual(E.t('en', 'vat', { n: 22 }), 'VAT 22 %');
  assert.strictEqual(E.t('sl', 'km', { n: 20 }), 'Prevoz nad 20 km');
  assert.strictEqual(E.t('xx', 'title'), 'Service report');
  assert.strictEqual(E.t('hr', 'kinds').hp, 'Dizalica topline zrak-voda');
});

// ── demo data ────────────────────────────────────────────────────────────
t('demo clock and signatures are deterministic', () => {
  assert.strictEqual(D.demoClock('07:15'), '10:40');
  assert.strictEqual(D.demoClock('12:05'), '12:05');
  assert.strictEqual(D.demoClock('19:00'), '15:50');
  assert.strictEqual(D.demoClock(undefined), '10:40');
  const s = D.squiggle('Mojca Kotnik');
  assert.strictEqual(s, D.squiggle('Mojca Kotnik'));
  assert.notStrictEqual(s, D.squiggle('Marko Novak'));
  assert.ok(/^<svg [^>]*viewBox="0 0 \d+ 80"[^>]*><path d="M[^"]+"[^>]*\/><\/svg>$/.test(s));
});

t('templates: every job type and kind of equipment, items in three languages', () => {
  const tpl = D.makeTemplates();
  assert.strictEqual(Object.keys(tpl).length, E.TYPES.length * E.KINDS.length);
  Object.keys(tpl).forEach((k) => {
    const ids = tpl[k].items.map((i) => i.id);
    assert.strictEqual(new Set(ids).size, ids.length, k + ' has unique items');
    assert.ok(tpl[k].items.some((i) => i.req), k + ' has required items');
    tpl[k].items.forEach((i) => {
      assert.ok(i.en && i.sl && i.hr && ['pf', 'num', 'choice'].includes(i.t), k + ' ' + i.id);
      if (i.t === 'num') assert.ok(i.unit, k + ' ' + i.id + ' has a unit');
      if (i.t === 'choice') assert.ok(i.opts.length && i.opts.every((o) => o.en && o.sl && o.hr));
    });
  });
});

const TODAY = '2026-10-13', NOWHM = '10:40';
const db = D.generate(TODAY, { now: NOWHM });

t('generator is deterministic for the same day and clock', () => {
  assert.deepStrictEqual(D.generate(TODAY, { now: NOWHM }), db);
  const other = D.generate(TODAY, { now: '14:20' });
  assert.notDeepStrictEqual(other, db);
  assert.strictEqual(other.customers.length, db.customers.length);
});

function checkInvariants(db, today, nowHM) {
  const NOW = today + 'T' + nowHM;
  const C = {}, A = {}, T = {}, P = {}, J = {};
  db.customers.forEach((c) => { C[c.id] = c; });
  db.assets.forEach((a) => { A[a.id] = a; });
  db.techs.forEach((t) => { T[t.id] = t; });
  db.parts.forEach((p) => { P[p.id] = p; });
  db.jobs.forEach((j) => { J[j.id] = j; });
  assert.strictEqual(Object.keys(J).length, db.jobs.length, 'unique job ids');
  db.customers.forEach((c) => {
    const hr = E.countryOf(c) === 'HR';
    assert.ok((hr ? /@example\.hr$/ : /@example\.com$/).test(c.email), c.email);
    // numbers nobody has: +386 1 000 … in Slovenia, +385 1 000 … in Croatia
    assert.ok((hr ? /^\+385 1 000 \d{2} \d{2}$/ : /^\+386 1 000 \d{2} \d{2}$/).test(c.phone) && E.isSafeDemoPhone(c.phone), c.phone);
    assert.strictEqual(c.postal, E.postalOf(c.city), c.city);
    assert.ok(E.PLAN[c.plan] && ['household', 'business', 'public'].includes(c.type));
  });
  assert.ok(E.isSafeDemoPhone(db.company.phone), db.company.phone);
  db.techs.forEach((t) => {
    assert.ok(E.isSafeDemoPhone(t.phone), t.phone);
    assert.ok(E.distanceKm(t.base, 'Celje') != null && t.skills.every((s) => E.SKILL[s]));
    Object.keys(t.van).forEach((k) => assert.ok(P[k] && t.van[k] >= 0, k));
  });
  db.assets.forEach((a) => {
    assert.ok(C[a.customerId] && E.KIND[a.kind] && E.isDate(a.installed) && a.interval > 0, a.id);
    if (a.lastService) assert.ok(a.lastService >= a.installed && a.lastService <= today, a.id + ' ' + a.lastService);
    if (E.KIND[a.kind].refrigerant) assert.ok(a.refrigerant && a.charge > 0, a.id);
  });
  const nos = {};
  db.jobs.forEach((j) => {
    const tag = j.no + ' ';
    assert.ok(C[j.customerId], tag + 'customer');
    assert.ok(A[j.assetId] && A[j.assetId].customerId === j.customerId, tag + 'asset belongs to the customer');
    assert.ok(!j.techId || T[j.techId], tag + 'technician');
    assert.ok(E.STATUS[j.status] && E.TYPE[j.type] && E.PRIORITY[j.priority], tag + 'enums');
    assert.ok(db.templates[j.checklist.key] && j.checklist.key === j.type + '|' + A[j.assetId].kind, tag + 'template');
    assert.ok(E.parseJobNo(j.no) && !nos[j.no], tag + 'number'); nos[j.no] = 1;
    assert.ok(E.isStamp(j.reportedAt) && j.reportedAt <= NOW, tag + 'reported');
    assert.ok(!/\{no\}/.test(j.problem) && j.problem, tag + 'problem');
    j.parts.forEach((p) => assert.ok(P[p.partId] && p.qty > 0 && p.price >= 0, tag + p.partId));
    if (j.followUpOf) assert.ok(J[j.followUpOf] && J[j.followUpOf].followUpId === j.id && J[j.followUpOf].assetId === j.assetId, tag + 'follow-up link');
    if (E.isBooked(j)) {
      assert.ok(E.winIndex(j.window) + j.span <= 4, tag + 'fits the day');
      assert.deepStrictEqual(E.missingSkills(T[j.techId], A[j.assetId].kind, j.type), [], tag + 'skills');
    }
    if (E.isDone(j)) {
      assert.ok(j.travelAt <= j.arriveAt && j.arriveAt <= j.finishAt && j.finishAt <= NOW, tag + 'times ' + j.travelAt + ' ' + j.arriveAt + ' ' + j.finishAt);
      assert.strictEqual(j.arriveAt.slice(0, 10), j.date, tag + 'arrived on the day');
      assert.ok(j.reportedAt <= j.arriveAt, tag + 'reported before arrival');
      assert.ok(E.checklistStatus(db.templates[j.checklist.key].items, j.checklist.res).complete, tag + 'checklist');
      assert.ok(j.labourMin > 0 && j.labourMin === E.onsiteMinutes(j), tag + 'labour');
      assert.ok(j.km > 0, tag + 'km');
      assert.ok(j.signature && (j.signature.none ? j.signature.reason : j.signature.name && j.signature.demo === true && j.signature.at >= j.finishAt), tag + 'signature');
      assert.deepStrictEqual(j.rates, E.frozenRates(db.settings), tag + 'rates frozen at signing');
      j.visits.forEach((v) => assert.ok(v.travelAt <= v.arriveAt && v.arriveAt <= v.leftAt && v.leftAt <= j.travelAt, tag + 'visit before the final visit'));
    }
    if (j.status === 'invoiced') assert.ok(j.invoicedAt >= j.finishAt.slice(0, 10) && j.invoicedAt < today, tag + 'invoiced after it was done');
    if (j.status === 'cancelled') assert.ok(!j.techId && !j.date && j.cancelReason, tag + 'cancelled');
    if (j.status === 'new') assert.ok(!j.techId && !j.date, tag + 'new is unassigned');
    if (j.status === 'scheduled') assert.ok(E.isBooked(j) && j.date >= today, tag + 'scheduled');
    if (j.status === 'parts') assert.ok(j.visits.length === 1 && !j.date && j.techId && j.partsNote, tag + 'waiting for parts');
  });
  // nobody is in two places at once: no double-booked windows, and travel starts after the previous job
  const occ = {}, days = {};
  db.jobs.filter(E.isBooked).forEach((j) => {
    const r = E.winRange(j);
    for (let w = r[0]; w < r[1]; w++) { const k = j.date + '|' + j.techId + '|' + w; assert.ok(!occ[k], 'double-booked ' + j.no + ' and ' + occ[k]); occ[k] = j.no; }
    if (j.arriveAt) (days[j.date + '|' + j.techId] = days[j.date + '|' + j.techId] || []).push(j);
  });
  Object.keys(days).forEach((k) => {
    const l = days[k].sort((a, b) => (a.arriveAt < b.arriveAt ? -1 : 1));
    for (let i = 1; i < l.length; i++) if (l[i - 1].finishAt) assert.ok(l[i].travelAt >= l[i - 1].finishAt, k + ' ' + l[i - 1].no + ' → ' + l[i].no);
  });
  // numbers follow the order the jobs were created, per year
  const byYear = {};
  db.jobs.slice().sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0)).forEach((j) => {
    const p = E.parseJobNo(j.no); assert.strictEqual(p.year, +j.createdAt.slice(0, 4));
    if (byYear[p.year] != null) assert.strictEqual(p.seq, byYear[p.year] + 1, j.no);
    byYear[p.year] = p.seq;
  });
}

t('generator invariants: references, times, no double booking, signatures, invoicing', () => {
  checkInvariants(db, TODAY, NOWHM);
});

t('generator volumes: a busy installer, 3–4 visits per technician and working day', () => {
  const J = db.jobs, past = J.filter((j) => (j.status === 'done' || j.status === 'invoiced' || j.status === 'cancelled') && !(j.finishAt && j.finishAt.slice(0, 10) === TODAY));
  assert.ok(db.customers.length >= 2850 && db.customers.length <= 3150, 'customers ' + db.customers.length);
  assert.ok(db.assets.length >= 4200 && db.assets.length <= 4800, 'assets ' + db.assets.length);
  assert.ok(past.length >= 4500 && past.length <= 5500, 'past jobs ' + past.length);
  const types = {}; past.forEach((j) => { types[j.type] = (types[j.type] || 0) + 1; });
  assert.ok(types.service > past.length * 0.6 && types.repair > past.length * 0.2, 'mostly services and repairs ' + JSON.stringify(types));
  // repairs per unit stay plausible: about one repair for every four units in 9 months, a few units more than once
  const reps = J.filter((j) => j.type === 'repair' && j.status !== 'cancelled'), perUnit = {};
  reps.forEach((j) => { perUnit[j.assetId] = (perUnit[j.assetId] || 0) + 1; });
  assert.ok(reps.length / db.assets.length > 0.2 && reps.length / db.assets.length < 0.36, 'repairs per unit ' + reps.length / db.assets.length);
  assert.ok(Math.max(...Object.values(perUnit)) <= 4, 'no unit is repaired every few weeks');
  const kinds = {}; db.customers.forEach((c) => { kinds[c.type] = (kinds[c.type] || 0) + 1; });
  assert.ok(kinds.household > kinds.business && kinds.business > kinds.public && kinds.public > 50, JSON.stringify(kinds));
  const org = db.customers.filter((c) => c.type !== 'household'), homes = db.customers.filter((c) => c.type === 'household');
  assert.strictEqual(new Set(org.map((c) => c.name)).size, org.length, 'every business and public body has its own name');
  assert.ok(new Set(homes.map((c) => c.name)).size >= homes.length * 0.75, 'households: mostly different names (some Novaks repeat, as in real life)');
  assert.strictEqual(new Set(db.customers.map((c) => c.email)).size, db.customers.length, 'unique e-mails');
  // each technician: 3–4 visits a working day over the last four weeks, days end at a decent hour
  const hmap = E.holidayMap(db.settings.holidays), from = E.addDays(TODAY, -28), to = E.addDays(TODAY, -1);
  let team = { on: 0, tr: 0, av: 0, visits: 0, days: 0 };
  db.techs.forEach((t) => {
    const u = E.utilisation(J, t.id, from, to, hmap, 8);
    const visits = J.filter((j) => j.techId === t.id && E.isDone(j) && j.date >= from && j.date <= to).length;
    assert.ok(visits / u.days >= 2.6 && visits / u.days <= 4, t.name + ' visits a day ' + visits / u.days);
    assert.ok(u.rate > 0.4 && u.rateTravel < 1 && u.rateTravel > u.rate, t.name + ' ' + u.rate + ' ' + u.rateTravel);
    team.on += u.onsite; team.tr += u.travel; team.av += u.avail; team.visits += visits; team.days += u.days;
  });
  assert.ok(team.visits / team.days >= 3 && team.visits / team.days <= 4, 'team visits a day ' + team.visits / team.days);
  assert.ok(team.on / team.av > 0.55 && team.on / team.av < 0.8, 'team on site ' + team.on / team.av);
  assert.ok((team.on + team.tr) / team.av > 0.7 && (team.on + team.tr) / team.av < 0.95, 'team on site + travel ' + (team.on + team.tr) / team.av);
  const ends = {}; J.filter((j) => j.finishAt && j.date && j.date < TODAY).forEach((j) => { const k = j.date + j.techId; if (!ends[k] || j.finishAt > ends[k]) ends[k] = j.finishAt; });
  const late = Object.values(ends).filter((x) => x.slice(11) > '17:45').length;
  assert.ok(late <= Object.keys(ends).length * 0.01, 'days ending after 17:45: ' + late);
  assert.ok(past.every((j) => (j.finishAt || j.cancelledAt || j.reportedAt).slice(0, 10) >= E.addDays(TODAY, -D.HISTORY_DAYS - 1)));
  assert.strictEqual(db.techs.length, 7);
  assert.ok(db.parts.length >= 55 && db.parts.length <= 70, 'parts ' + db.parts.length);
  // services peak before the heating season (Sep–Nov) and before summer (Apr–Jun); a full team spreads the rest over the year
  const svc = J.filter((j) => j.type === 'service' && E.isDone(j)), mon = (j) => +j.finishAt.slice(5, 7);
  const heatSep = svc.filter((j) => ['gas', 'hp'].includes(db.assets.find((a) => a.id === j.assetId).kind) && mon(j) === 9).length;
  const heatJul = svc.filter((j) => ['gas', 'hp'].includes(db.assets.find((a) => a.id === j.assetId).kind) && mon(j) === 7).length;
  const acMay = svc.filter((j) => db.assets.find((a) => a.id === j.assetId).kind === 'ac' && mon(j) === 5).length;
  const acFeb = svc.filter((j) => db.assets.find((a) => a.id === j.assetId).kind === 'ac' && mon(j) === 2).length;
  assert.ok(heatSep > heatJul * 1.15 && acMay > acFeb * 2, 'seasons ' + [heatSep, heatJul, acMay, acFeb]);
  // repairs of heating equipment are more frequent in the cold months
  const rep = J.filter((j) => j.type === 'repair' && ['gas', 'hp'].includes(db.assets.find((a) => a.id === j.assetId).kind));
  const winter = rep.filter((j) => [1, 2].includes(+j.reportedAt.slice(5, 7))).length, summer = rep.filter((j) => [6, 7].includes(+j.reportedAt.slice(5, 7))).length;
  assert.ok(winter > summer * 2, 'cold weeks ' + winter + ' vs ' + summer);
});

t('this week: on site, travelling, done today, the next four days, the queue, parts', () => {
  const J = db.jobs, today = J.filter((j) => j.date === TODAY);
  assert.strictEqual(J.filter((j) => j.status === 'onsite').length, 1);
  assert.strictEqual(J.filter((j) => j.status === 'travelling').length, 1);
  const on = J.find((j) => j.status === 'onsite'), tr = J.find((j) => j.status === 'travelling');
  assert.ok(on.date === TODAY && on.arriveAt < TODAY + 'T' + NOWHM && on.stage === 'work');
  assert.ok(tr.date === TODAY && tr.travelAt < TODAY + 'T' + NOWHM && !tr.arriveAt);
  assert.ok(today.filter((j) => j.status === 'done').length >= 2, 'done today');
  assert.ok(today.filter((j) => j.status === 'done').every((j) => !j.invoicedAt));
  const hmap = E.holidayMap(db.settings.holidays);
  let d = TODAY;
  const slots = (day) => J.filter((j) => j.date === day && E.isBooked(j)).reduce((s, j) => s + j.span, 0);
  assert.ok(slots(TODAY) >= 14 && slots(TODAY) <= 26, 'today busy with some free windows: ' + slots(TODAY) + ' of 28');
  const ahead = [];
  for (let i = 0; i < 4; i++) { d = E.nextWorkday(d, hmap); const c = J.filter((j) => j.date === d && j.status === 'scheduled').length; ahead.push(slots(d)); assert.ok(c >= 2 && c <= 26, d + ' ' + c); }
  assert.ok(ahead[0] > ahead[3] && ahead[0] < 28, 'the next days fill up, nearest first: ' + ahead);
  const queue = J.filter((j) => j.status === 'new');
  assert.ok(queue.length >= 6 && queue.length <= 10, 'queue ' + queue.length);
  assert.strictEqual(queue.filter((j) => j.priority === 'emergency').length, 2);
  const C = {}; db.customers.forEach((c) => { C[c.id] = c; });
  const states = queue.map((j) => E.slaState(j, C[j.customerId].plan, TODAY + 'T' + NOWHM, db.settings).state);
  assert.ok(states.includes('risk') && states.includes('overdue'), states.join());
  // the demo plan itself respects the SLA: nothing this week is planned after it is due, and today's visits met it
  J.filter((j) => j.type === 'repair' && j.date >= TODAY).forEach((j) => {
    const st = E.slaState(j, C[j.customerId].plan, TODAY + 'T' + NOWHM, db.settings);
    assert.ok(!st.plannedLate && st.state !== 'missed', j.no + ' ' + st.state);
  });
  const parts = J.filter((j) => j.status === 'parts');
  assert.ok(parts.length >= 2 && parts.length <= 5);
  parts.forEach((j) => assert.strictEqual(E.slaState(j, C[j.customerId].plan, TODAY + 'T' + NOWHM, db.settings).state, 'met', j.no + ' first visit within the SLA'));
  assert.ok(J.filter((j) => j.status === 'done').length >= 8, 'done, waiting for invoicing');
  const ml = E.maintenanceList(db, TODAY, 90), d30 = ml.filter((r) => r.bucket === 'd30').length, over = ml.filter((r) => r.bucket === 'overdue').length;
  assert.ok(d30 >= db.assets.length * 0.04 && d30 <= db.assets.length * 0.15, 'due in 30 days ' + d30);
  assert.ok(over <= db.assets.length * 0.15, 'overdue ' + over);
  assert.ok(ml.some((r) => r.open) && ml.some((r) => !r.open && r.bucket === 'overdue'));
  // headline rates are believable
  const ftf = E.ftfRate(J, { asOf: TODAY });
  assert.ok(ftf.rate > 0.8 && ftf.rate < 0.97, 'FTF ' + ftf.rate);
  const sla = E.slaStats(J, (j) => C[j.customerId].plan, db.settings, null, null);
  assert.ok(sla.rate > 0.85 && sla.rate < 0.99, 'SLA ' + sla.rate);
  assert.ok(db.techs.some((t) => Object.keys(t.van).some((k) => t.van[k] < db.parts.find((p) => p.id === k).vanMin)), 'some van stock is low');
});

t('generator invariants on other days: a Saturday, February, a year boundary, late afternoon', () => {
  [['2026-10-17', '11:30'], ['2026-02-10', '14:20'], ['2027-01-04', '15:50'], ['2026-06-30', '09:00'], ['2026-12-24', '13:10']].forEach(([day, hm]) => {
    const g = D.generate(day, { now: hm });
    checkInvariants(g, day, D.demoClock(hm));
    assert.strictEqual(g.jobs.filter((j) => j.status === 'onsite').length, 1, day);
    assert.strictEqual(g.jobs.filter((j) => j.status === 'travelling').length, 1, day);
    assert.strictEqual(g.jobs.filter((j) => j.status === 'new' && j.priority === 'emergency').length, 2, day);
    const CC = {}; g.customers.forEach((c) => { CC[c.id] = c; });
    g.jobs.filter((j) => j.type === 'repair' && j.date >= day).forEach((j) => { const st = E.slaState(j, CC[j.customerId].plan, day + 'T' + D.demoClock(hm), g.settings); assert.ok(!st.plannedLate && st.state !== 'missed', day + ' ' + j.no + ' ' + st.state); });
  });
});

// ── compact storage ──────────────────────────────────────────────────────
t('pack / unpack: the stored form gives the same data back and stays small', () => {
  const doc = D.pack(db), json = JSON.stringify(doc);
  assert.ok(doc.packed && doc.version === db.version);
  assert.deepStrictEqual(D.unpack(JSON.parse(json)), db);
  assert.ok(Buffer.byteLength(json) < 6 * 1024 * 1024, 'packed ' + Buffer.byteLength(json));
  assert.ok(Buffer.byteLength(json) < JSON.stringify(db).length * 0.5, 'at least halves the size');
  assert.strictEqual(D.unpack(db), db, 'unpacked data passes through');
  assert.strictEqual(D.unpack(null), null);
  // finished demo jobs keep only a seed for their checklist answers
  const done = doc.jobs.filter((j) => typeof j.k === 'string');
  assert.ok(done.length > db.jobs.length * 0.9, 'checklists stored as seeds ' + done.length);
});

t('pack / unpack: edits by people survive, unknown fields too', () => {
  const g = JSON.parse(JSON.stringify(db)); // a copy to change
  const j = g.jobs.find((x) => x.status === 'invoiced' && x.checklist.seed && x.type === 'service');
  const key = Object.keys(j.checklist.res).find((k) => typeof j.checklist.res[k] === 'number');
  j.checklist.res[key] = j.checklist.res[key] + 0.5; // a correction after signing, seed left behind
  j.notes = '§7 starts with the marker';
  j.problem = 'Annual service.';
  j.extra = { kept: true };
  const c = g.customers.find((x) => x.type === 'business'); c.contact = c.name; c.postal = '9999'; c.newField = 1;
  const a = g.assets[0]; a.interval = 6; a.warrantyUntil = '2030-01-01';
  const k = g.jobs.find((x) => x.status === 'scheduled'); k.checklist.res = { x: 'pass' }; k.billing = { labour: true, callout: false, km: true, parts: true, why: 'plan', custom: 1 };
  const back = D.unpack(JSON.parse(JSON.stringify(D.pack(g))));
  assert.deepStrictEqual(back, g);
  // the user's template changes do not change the answers rebuilt from a seed
  const g2 = JSON.parse(JSON.stringify(db)); g2.templates['service|gas'].items.shift();
  const back2 = D.unpack(D.pack(g2));
  assert.deepStrictEqual(back2.jobs, g2.jobs);
});

t('demo signatures are drawn from the name; nothing is stored per signer', () => {
  assert.ok(!('sigs' in db));
  const sg = db.jobs.find((j) => j.signature && j.signature.demo).signature;
  assert.ok(/^<svg /.test(D.squiggle(sg.name)) && D.squiggle(sg.name) === D.squiggle(sg.name));
});

t('first load: generating the demo takes well under 1.5 s', () => {
  const t0 = Date.now(); D.generate('2026-11-20', { now: '12:00' }); const ms = Date.now() - t0;
  assert.ok(ms < 1500, 'generate took ' + ms + ' ms');
  const t1 = Date.now(); D.unpack(JSON.parse(JSON.stringify(D.pack(db)))); const ms2 = Date.now() - t1;
  assert.ok(ms2 < 600, 'pack and unpack took ' + ms2 + ' ms');
});

console.log(n + ' tests passed');
