// Tests for Service jobs: automatic service-plan visits, the "On my way" text, the payment block (UPN / SEPA QR,
// paid on site), Slovene and Croatian demo texts on the report, safe demo phone numbers.
// Run: node tools/tests/service-plan.test.js
'use strict';
const assert = require('assert');
const path = require('path');
const E = require(path.join(__dirname, '../../site/service/engine.js'));
const D = require(path.join(__dirname, '../../site/service/data.js'));
const Q = require(path.join(__dirname, '../../site/service/qr.js'));

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok', n, name); }
const copy = (o) => JSON.parse(JSON.stringify(o));

// ── automatic plan visits on a small hand-made data set ──────────────────
const HOL = E.siHolidays(2026).concat(E.siHolidays(2027));
function small() {
  return {
    settings: { farKm: 35, holidays: HOL, planAuto: { on: true, horizon: 28, early: 10, perDay: 3, searchDays: 60 } },
    techs: [
      { id: 't1', name: 'A', base: 'Celje', skills: ['gas', 'hp'], active: true },
      { id: 't2', name: 'B', base: 'Velenje', skills: ['gas', 'ac'], active: true },
      { id: 't3', name: 'C', base: 'Žalec', skills: ['vent'], active: false }
    ],
    customers: [
      { id: 'c1', plan: 'premium', city: 'Celje' }, { id: 'c2', plan: 'basic', city: 'Velenje' }, { id: 'c3', plan: 'none', city: 'Celje' },
      { id: 'c4', plan: 'basic', city: 'Celje' }
    ],
    assets: [
      { id: 'a1', customerId: 'c1', kind: 'gas', installed: '2020-01-01', lastService: '2025-09-01', interval: 12 }, // overdue since 1. 9.
      { id: 'a2', customerId: 'c2', kind: 'ac', installed: '2020-01-01', lastService: '2025-11-02', interval: 12 }, // due 2. 11. (in 20 days)
      { id: 'a3', customerId: 'c3', kind: 'gas', installed: '2020-01-01', lastService: '2025-09-01', interval: 12 }, // no plan
      { id: 'a4', customerId: 'c4', kind: 'gas', installed: '2020-01-01', lastService: '2026-01-10', interval: 12 }, // due in 2027
      { id: 'a5', customerId: 'c4', kind: 'vent', installed: '2020-01-01', lastService: '2026-04-01', interval: 6 }, // due 1. 10., only an inactive tech
      { id: 'a6', customerId: 'c1', kind: 'hp', installed: '2026-11-01', lastService: '', interval: 12 } // not installed yet
    ],
    jobs: []
  };
}
const TD = '2026-10-13'; // a Tuesday

t('plan visits: plan customers only, due within 28 days or overdue, booked within capacity', () => {
  const db = small(), before = copy(db);
  const v = E.planVisits(db, TD);
  assert.deepStrictEqual(db, before, 'pure: nothing in the data changes');
  assert.deepStrictEqual(v.map((x) => x.assetId), ['a1', 'a5', 'a2'], 'by due date: 1. 9., 1. 10., 2. 11.');
  const a1 = v.find((x) => x.assetId === 'a1'), a2 = v.find((x) => x.assetId === 'a2'), a5 = v.find((x) => x.assetId === 'a5');
  assert.strictEqual(a1.due, '2026-09-01');
  assert.strictEqual(a1.date, '2026-10-14', 'overdue: the next working day');
  assert.strictEqual(a1.techId, 't1', 'the nearest technician with the skill');
  assert.ok(E.winIndex(a1.window) >= 0);
  assert.strictEqual(a2.due, '2026-11-02');
  assert.strictEqual(a2.date, '2026-10-23', 'ten days early at the most (a working day)');
  assert.strictEqual(a2.techId, 't2', 'air conditioning: only t2 has the skill');
  assert.strictEqual(a5.techId, '', 'ventilation: the only technician with the skill is inactive, so it waits in the queue');
  assert.strictEqual(a5.id, E.planVisitId('a5', '2026-10-01'));
  assert.ok(!v.some((x) => x.assetId === 'a3' || x.assetId === 'a4' || x.assetId === 'a6'), 'no plan, not due yet, not installed');
});

t('plan visits: idempotent, open jobs and decided (cancelled) visits are left alone', () => {
  const db = small();
  const v = E.planVisits(db, TD);
  const now = TD + 'T07:00';
  v.forEach((x, i) => db.jobs.push(E.planJob(x, db.assets.find((a) => a.id === x.assetId), db.customers.find((c) => c.id === x.customerId), now, E.jobNo(2026, i + 1))));
  assert.strictEqual(E.planVisits(db, TD).length, 0, 'a second run adds nothing');
  const j1 = db.jobs.find((j) => j.assetId === 'a1');
  assert.ok(j1.status === 'scheduled' && j1.date === '2026-10-14' && j1.source === 'plan' && j1.planDue === '2026-09-01' && j1.type === 'service');
  assert.deepStrictEqual(j1.billing, E.defaultBilling('service', 'premium', false), 'covered by the plan');
  assert.strictEqual(db.jobs.find((j) => j.assetId === 'a5').status, 'new');
  // someone cancels a1's visit: it is not booked again for that due date
  j1.status = 'cancelled'; j1.date = ''; j1.techId = ''; j1.window = '';
  assert.strictEqual(E.planVisits(db, TD).length, 0, 'cancelled by a person: not made again');
  // an open service job made by hand covers the equipment too
  const db2 = small(); db2.jobs.push({ id: 'x1', assetId: 'a1', type: 'service', status: 'new' });
  assert.ok(!E.planVisits(db2, TD).some((x) => x.assetId === 'a1'));
  // turned off: nothing
  const db3 = small(); db3.settings.planAuto.on = false;
  assert.deepStrictEqual(E.planVisits(db3, TD), []);
});

t('plan visits: capacity per technician and day, holidays and weekends skipped', () => {
  const db = small();
  // ten Premium gas boilers in Celje, all overdue: t1 gets 3 a day, t2 (Velenje, 24 km) the rest of the day's capacity
  for (let i = 0; i < 10; i++) { db.customers.push({ id: 'p' + i, plan: 'premium', city: 'Celje' }); db.assets.push({ id: 'g' + i, customerId: 'p' + i, kind: 'gas', installed: '2020-01-01', lastService: '2025-08-0' + (i % 9 + 1), interval: 12 }); }
  // t1 already has one window booked on 14. 10.
  db.jobs.push({ id: 'b1', no: 'SJ-2026-0001', assetId: 'a4', customerId: 'c4', type: 'repair', status: 'scheduled', date: '2026-10-14', window: '08', span: 1, techId: 't1' });
  const v = E.planVisits(db, TD), per = {};
  v.filter((x) => x.techId).forEach((x) => { const k = x.date + '|' + x.techId; per[k] = (per[k] || 0) + 1; });
  assert.strictEqual(per['2026-10-14|t1'], 2, 'one window was already taken: 3 at most in total');
  Object.keys(per).forEach((k) => { assert.ok(per[k] <= 3, k); assert.ok(E.isWorkday(k.slice(0, 10), E.holidayMap(HOL)), k + ' is a working day'); });
  // no two visits in the same window
  const seen = {};
  v.filter((x) => x.techId).forEach((x) => { const k = x.date + x.techId + x.window; assert.ok(!seen[k], 'double booked ' + k); seen[k] = 1; assert.ok(!(x.date === '2026-10-14' && x.techId === 't1' && x.window === '08')); });
  // the Friday before All Saints' Day: 30. 10. is a working day, 31. 10. (Sat, Reformation Day) and 2. 11. a Monday
  assert.ok(!v.some((x) => x.date === '2026-10-31' || x.date === '2026-11-01'));
});

t('plan visits: done → next due one interval later; a later day books only what came due', () => {
  const db = small();
  // a1 serviced on 14. 10. 2026: next due 14. 10. 2027, nothing until the 28-day horizon reaches it
  db.assets[0].lastService = '2026-10-14';
  assert.ok(!E.planVisits(db, '2026-10-15').some((x) => x.assetId === 'a1'));
  assert.ok(!E.planVisits(db, '2027-09-15').some((x) => x.assetId === 'a1'), '29 days before: not yet');
  const later = E.planVisits(db, '2027-09-16').find((x) => x.assetId === 'a1');
  assert.ok(later && later.due === '2027-10-14' && later.date >= '2027-10-04', 'booked at most 10 days early');
  // ventilation every 6 months
  assert.strictEqual(E.nextDue({ lastService: '2026-04-01', interval: 6 }), '2026-10-01');
});

t('plan visits in the demo: none overdue but a handful, the rest booked in the coming weeks, stable from day to day', () => {
  const T = '2026-10-15', db = D.generate(T, { now: '11:00' });
  const auto = db.jobs.filter((j) => j.planDue);
  assert.ok(auto.length > 150, 'automatic visits ' + auto.length);
  assert.strictEqual(E.planVisits(db, T).length, 0, 'the demo already holds every visit due today');
  const ml = E.maintenanceList(db, T, 90), over = ml.filter((r) => r.bucket === 'overdue');
  assert.ok(over.length >= 1 && over.length <= 5, 'a handful overdue: ' + over.length);
  over.forEach((r) => assert.ok(E.hasPlan(r.customer) && !r.open));
  assert.ok(ml.filter((r) => r.bucket === 'remind').every((r) => r.customer.plan === 'none' && !r.open));
  const booked = auto.filter((j) => j.status === 'scheduled');
  assert.ok(booked.every((j) => j.date > T && j.date <= E.addDays(T, 50)), 'booked within the coming weeks');
  assert.ok(new Set(booked.map((j) => j.techId)).size >= 6, 'spread over the technicians');
  assert.ok(new Set(booked.map((j) => j.date)).size >= 10, 'spread over the days');
  // nobody is booked for more than 3 plan visits plus what was there before, never all four windows by plan visits
  const per = {}; booked.forEach((j) => { const k = j.date + j.techId; per[k] = (per[k] || 0) + 1; });
  assert.ok(Object.values(per).every((x) => x <= 3));
  // the next day: only the newly due ones, with new ids, and nothing twice
  const next = E.planVisits(db, '2026-10-16');
  assert.ok(next.length > 0 && next.length < 40, 'next day ' + next.length);
  const ids = new Set(db.jobs.map((j) => j.id)); next.forEach((x) => assert.ok(!ids.has(x.id), x.id));
  assert.strictEqual(new Set(next.map((x) => x.assetId)).size, next.length);
  // stored and read back: the due date of the visit survives
  const back = D.unpack(JSON.parse(JSON.stringify(D.pack(db))));
  assert.deepStrictEqual(back.jobs.filter((j) => j.planDue).map((j) => j.planDue), auto.map((j) => j.planDue));
  // adding them keeps the numbering: one above the highest of the year
  const g = copy(db), made = D.addPlanVisits(g, next, '2026-10-16T07:00'), last = E.parseJobNo(E.nextJobNo(db.jobs, 2026)).seq;
  assert.deepStrictEqual(made.map((j) => E.parseJobNo(j.no).seq), made.map((j, i) => last + i));
});

// ── "On my way" ──────────────────────────────────────────────────────────
t('on my way: arrival rounded up to 5 minutes, texts in sl / hr / en, sms link', () => {
  assert.strictEqual(E.etaStamp('2026-10-15T10:12', 20), '2026-10-15T10:35');
  assert.strictEqual(E.etaStamp('2026-10-15T10:15', 20), '2026-10-15T10:35');
  assert.strictEqual(E.etaStamp('2026-10-15T10:10', 25), '2026-10-15T10:35');
  assert.strictEqual(E.etaStamp('2026-10-15T23:52', 15), '2026-10-16T00:10', 'past midnight');
  assert.strictEqual(E.travelMinutes(16), 23); assert.strictEqual(E.travelMinutes(0), 9); assert.strictEqual(E.travelMinutes(null), 32);
  const o = { name: 'Matej Kovačič', company: 'Termoplan Savinja d.o.o.', eta: '2026-10-15T10:35' };
  assert.strictEqual(E.omwText('sl', o), 'Pozdravljeni, tukaj Matej Kovačič iz Termoplan Savinja. Na poti sem k vam, prispem približno ob 10.35. Lep pozdrav');
  assert.strictEqual(E.omwText('hr', o), 'Poštovani, ovdje Matej Kovačič iz Termoplan Savinja. Na putu sam prema vama, stižem oko 10.35. Lijep pozdrav');
  assert.ok(/arrive at about 10:35\. Kind regards$/.test(E.omwText('en', o)));
  assert.strictEqual(E.shortCompany('Pekarna Lipa s.p.'), 'Pekarna Lipa');
  assert.strictEqual(E.shortCompany('Nordvik d. o. o.'), 'Nordvik');
  assert.strictEqual(E.smsHref('+386 1 000 12 34', 'Ob 10.35 & lep pozdrav'), 'sms:+38610001234?&body=Ob%2010.35%20%26%20lep%20pozdrav');
  assert.strictEqual(E.dialable('01 000 12 34'), '010001234');
  assert.ok(E.isSafeDemoPhone('+386 1 000 12 34') && E.isSafeDemoPhone('+385 1 000 98 76'));
  assert.ok(!E.isSafeDemoPhone('+386 41 512 330') && !E.isSafeDemoPhone('+386 1 234 56 78'));
});

t('countries: Croatian towns give Croatian customers; everyone else is Slovenian', () => {
  assert.strictEqual(E.countryOf({ city: 'Pregrada' }), 'HR');
  assert.strictEqual(E.countryOf({ city: 'Celje' }), 'SI');
  assert.strictEqual(E.countryOf({ city: 'Atlantis' }), 'SI');
  assert.strictEqual(E.countryOf({ city: 'Celje', country: 'AT' }), 'AT');
  assert.deepStrictEqual([E.langOf({ city: 'Hum na Sutli' }), E.langOf({ city: 'Laško' }), E.langOf({ city: 'x', country: 'DE' })], ['hr', 'sl', 'en']);
  const db = D.generate('2026-10-15', { now: '11:00' }), hr = db.customers.filter((c) => E.countryOf(c) === 'HR');
  assert.ok(hr.length >= 10 && hr.length <= 80, 'Croatian customers ' + hr.length);
  hr.forEach((c) => assert.ok(/^\+385 1 000 /.test(c.phone) && /@example\.hr$/.test(c.email) && /^49\d{3}$/.test(c.postal), c.id));
});

// ── payment on the report ────────────────────────────────────────────────
const CO = { name: 'Termoplan Savinja d.o.o.', street: 'Opekarniška cesta 15', postal: '3000', city: 'Celje', iban: 'SI00 1010 0001 2345 678', bic: '' };
const ST = { payDays: 8, purposeCode: 'GDSV' };
const DONE = { no: 'SJ-2026-0412', status: 'done', finishAt: '2026-10-15T11:20' };

t('payment reference, QR kind, IBAN check', () => {
  assert.strictEqual(E.paymentReference('SJ-2026-0412'), 'SI00 2026-0412');
  assert.strictEqual(E.paymentReference(''), '');
  assert.deepStrictEqual(['SI', 'HR', 'AT', 'CH'].map(E.qrKind), ['upn', 'epc', 'epc', null]);
  assert.deepStrictEqual(E.ibanInfo('SI56 1910 0000 0123 438'), { iban: 'SI56191000000123438', format: true, checks: true });
  assert.deepStrictEqual(E.ibanInfo(CO.iban), { iban: 'SI00101000012345678', format: true, checks: false }, 'the demo account cannot receive money');
  assert.strictEqual(E.ibanText('SI00101000012345678'), 'SI00 1010 0001 2345 678');
  assert.ok(!E.ibanInfo('SI00 12').format);
});

t('report payment: UPN for Slovenia, SEPA for Croatia, paid on site replaces the code, part payments leave the rest', () => {
  const price = { total: 124.44 };
  const upn = E.reportPayment(DONE, price, { company: CO, settings: ST, country: 'SI', lang: 'en' });
  assert.strictEqual(upn.kind, 'upn');
  assert.strictEqual(upn.amount, 124.44);
  assert.strictEqual(upn.reference, 'SI00 2026-0412');
  assert.strictEqual(upn.dueDate, '2026-10-23', 'visit day + 8 days');
  assert.strictEqual(upn.purpose, 'Servisno poročilo SJ-2026-0412', 'UPN purpose in Slovene whatever the report language');
  assert.strictEqual(upn.city, '3000 Celje');
  const epc = E.reportPayment(DONE, price, { company: CO, settings: ST, country: 'HR', lang: 'hr' });
  assert.strictEqual(epc.kind, 'epc'); assert.strictEqual(epc.purpose, 'Servisno izvješće SJ-2026-0412');
  assert.strictEqual(epc.text, 'Servisno izvješće SJ-2026-0412, SI00 2026-0412');
  assert.strictEqual(E.reportPayment(DONE, { total: 0 }, { company: CO, settings: ST }), null, 'nothing to pay');
  assert.strictEqual(E.reportPayment(Object.assign({}, DONE, { status: 'onsite' }), price, { company: CO, settings: ST }), null, 'not done');
  assert.strictEqual(E.reportPayment(DONE, price, { company: Object.assign({}, CO, { iban: '' }), settings: ST, country: 'SI' }).kind, 'none');
  assert.strictEqual(E.reportPayment(DONE, price, { company: CO, settings: ST, country: 'US' }).kind, 'none');
  const paid = Object.assign({}, DONE, { paidOnSite: { method: 'cash', amount: 124.44, at: '2026-10-15T11:25' } });
  const pp = E.reportPayment(paid, price, { company: CO, settings: ST, country: 'SI' });
  assert.strictEqual(pp.kind, 'paid'); assert.strictEqual(pp.paid.full, true); assert.strictEqual(pp.paid.method, 'cash');
  const part = Object.assign({}, DONE, { paidOnSite: { method: 'card', amount: 100, at: '2026-10-15T11:25' } });
  const pr = E.reportPayment(part, price, { company: CO, settings: ST, country: 'SI' });
  assert.strictEqual(pr.kind, 'upn'); assert.strictEqual(pr.amount, 24.44); assert.strictEqual(pr.paid.paid, 100);
  assert.deepStrictEqual(E.paidState({}, 50), { paid: 0, remaining: 50, full: false, method: '' });
});

t('QR payloads: UPN QR (ZBS, ISO 8859-2, version 15) and EPC SEPA "BCD"', () => {
  const p = E.reportPayment(DONE, { total: 1234.5 }, { company: CO, settings: ST, country: 'SI' });
  const u = Q.upnQr({ iban: p.iban, amount: p.amount, reference: p.reference, name: p.name, street: p.street, city: p.city, purpose: p.purpose, purposeCode: p.purposeCode, dueDate: p.dueDate });
  const f = u.payload.fields;
  assert.strictEqual(f[0], 'UPNQR');
  assert.strictEqual(f[8], '00000123450', 'amount in cents, 11 digits');
  assert.strictEqual(f[11], 'GDSV');
  assert.strictEqual(f[12], 'Servisno poročilo SJ-2026-0412');
  assert.strictEqual(f[13], '23.10.2026');
  assert.strictEqual(f[14], 'SI00101000012345678');
  assert.strictEqual(f[15], 'SI002026-0412', 'reference without the space');
  assert.strictEqual(f[16], 'Termoplan Savinja d.o.o.');
  assert.strictEqual(u.payload.bytes.length, 411);
  assert.strictEqual(u.qr.size, 77, 'version 15');
  const e = Q.epcQr({ iban: p.iban, amount: 1234.5, name: p.name, reference: p.reference, text: 'Servisno izvješće SJ-2026-0412, SI00 2026-0412' });
  const lines = e.payload.text.split('\n');
  assert.deepStrictEqual(lines.slice(0, 8), ['BCD', '002', '1', 'SCT', '', 'Termoplan Savinja d.o.o.', 'SI00101000012345678', 'EUR1234.50']);
  assert.strictEqual(lines[10], 'Servisno izvješće SJ-2026-0412, SI00 2026-0412', 'SI00 is not an RF reference: it goes into the text');
  assert.ok(/^<svg [^>]*viewBox="0 0 85 85"/.test(Q.svg(u.qr, { title: 'UPN QR' })));
});

// ── demo texts in the report's language ──────────────────────────────────
t('demo texts: every stored demo text has Slovene and Croatian; typed text stays as it is', () => {
  D.TEXTS.forEach((s) => {
    assert.notStrictEqual(D.localText(s, 'sl'), s, 'sl: ' + s);
    assert.ok(D.localText(s, 'hr') !== s || /^(Recepcija|Kuhinja)$/.test(D.localText(s, 'sl')) || s === 'Reception' || s === 'Kitchen', 'hr: ' + s);
    assert.strictEqual(D.localText(s, 'en'), s);
  });
  assert.strictEqual(D.localText('Annual service done. Electrodes adjusted, burner door gasket replaced. Combustion values good.', 'sl'), 'Letni servis opravljen. Elektrodi nastavljeni, tesnilo vrat gorilnika zamenjano. Vrednosti zgorevanja dobre.');
  assert.strictEqual(D.localText('Install a new Klimaflow Breeze 3.5 as per the quote.', 'sl'), 'Montaža nove naprave Klimaflow Breeze 3.5 po ponudbi.');
  assert.strictEqual(D.localText('Follow-up to SJ-2026-0101: the same fault came back.', 'hr'), 'Ponovni dolazak nakon SJ-2026-0101: isti kvar se ponovio.');
  assert.strictEqual(D.localText('Fault found: gas valve faulty. Part ordered from Nordvik Distribucija.', 'sl'), 'Napaka ugotovljena, v okvari: plinski ventil. Del je naročen pri dobavitelju Nordvik Distribucija.');
  assert.strictEqual(D.localText('Fault found: ntc temperature sensor faulty. Part ordered from Nordvik Distribucija.', 'sl'), 'Napaka ugotovljena, v okvari: NTC tipalo temperature. Del je naročen pri dobavitelju Nordvik Distribucija.');
  assert.strictEqual(D.localText('Replaced the pump myself.', 'sl'), 'Replaced the pump myself.');
  assert.strictEqual(D.localText('Follow-up to SJ-2026-0101: typed by hand', 'sl'), 'Follow-up to SJ-2026-0101: typed by hand');
  assert.strictEqual(D.localText('', 'sl'), ''); assert.strictEqual(D.localText(null, 'sl'), null);
  // every text a demo job carries onto a report has a translation
  const db = D.generate('2026-10-15', { now: '11:00' }), miss = new Set();
  const A = {}; db.assets.forEach((a) => { A[a.id] = a; });
  db.jobs.filter(E.isDone).forEach((j) => {
    [j.problem, j.notes, A[j.assetId].location, j.signature && j.signature.reason].concat(j.visits.map((v) => v.note), j.photos.map((p) => p.caption)).forEach((s) => { if (s && D.localText(s, 'sl') === s) miss.add(s); });
  });
  assert.deepStrictEqual([...miss], []);
});

t('old demo phone numbers: recognised exactly and replaced by safe ones', () => {
  const o = D.OLD_PHONES;
  assert.ok(o.customer.test('+386 41 512 330') && o.customer.test('+386 3 428 61 20'));
  assert.ok(!o.customer.test('041 512 330') && !o.customer.test('+38641512330') && !o.customer.test('+386 1 000 12 34'), 'typed in another format: left alone');
  assert.strictEqual(D.safePhone('+386 41 512 330'), '+386 1 000 23 30');
  assert.ok(E.isSafeDemoPhone(D.safePhone('+386 3 428 61 20')));
  assert.strictEqual(o.techs.t1, '+386 41 512 330');
});

console.log(n + ' tests passed');
