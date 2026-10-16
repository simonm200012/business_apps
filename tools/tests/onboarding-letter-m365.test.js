// Tests for site/onboarding/letter-m365.js: the welcome letter (SL/HR/EN) and the simulated Microsoft 365 run.
// Run: node tools/tests/onboarding-letter-m365.test.js
'use strict';
const assert = require('assert');
const path = require('path');
const J = require(path.join(__dirname, '../../site/onboarding/letter-m365.js'));

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok', n, name); }

const STORE = { id: 'S-MB', short: 'Maribor', kind: 'store', country: 'SI' }, ZG = { id: 'ZGO', short: 'Office Zagreb', kind: 'office', country: 'HR' };
const task = (id, title, team, o) => Object.assign({ id, title, team, offset: 0, status: 'todo' }, o || {});
function joiner(o) {
  return Object.assign({ type: 'joiner', first: 'Nina', last: 'Kos', email: 'nina.kos@example.com', role: 'Optician', date: '2026-11-02', loc: STORE, company: { name: 'Tokovi d.o.o.' },
    manager: 'Maja Novak', hr: 'Tina Zupan', licencePlan: 'Microsoft 365 F3', today: '2026-10-15', tasks: [
      task('t1', 'Pre-employment medical check passed', 'HR', { offset: -5 }),
      task('t2', 'Payroll data form received (tax + bank account)', 'HR', { offset: -7, status: 'done' }),
      task('t3', 'Safety at work training (varstvo pri delu) + fire safety', 'HR'),
      task('t4', 'Microsoft 365 account + licence', 'IT', { offset: -3, licence: 'assign' }),
      task('t5', 'E-mail groups: store team + all staff', 'IT', { offset: -2 }),
      task('t6', 'Teams: added to the store channel', 'IT', { offset: -1 }),
      task('t7', 'Store tablet issued (asset tag)', 'IT', { offset: -1, asset: 'tablet' }),
      task('t8', 'MFA set up with the person', 'IT'),
      task('t9', 'POS login for the store', 'IT', { offset: -2 }),
      task('t10', 'Probation review (+30 days)', 'MGR', { offset: 30 })
    ] }, o || {});
}

t('Slovenian welcome letter: date, time, place, e-mail, first days and what to bring', () => {
  const l = J.welcome(joiner(), 'sl');
  assert.strictEqual(l.place, 'Maribor, 15. 10. 2026');
  assert.strictEqual(l.greeting, 'Dobrodošli, Nina!');
  assert.ok(l.paras[0].indexOf('na delovnem mestu »optik« v poslovalnici Maribor') > 0, l.paras[0]);
  assert.ok(l.paras[0].indexOf('ponedeljek, 2. 11. 2026, ob 8.30') > 0, l.paras[0]);
  assert.strictEqual(l.paras[1], 'Prvi dan vas sprejme Maja Novak.');
  assert.ok(l.paras[2].indexOf('nina.kos@example.com') > 0);
  const day1 = l.schedule[0].items.join(' | ');
  assert.ok(/varno delo/.test(day1) && /MFA/.test(day1) && /tablica/.test(day1), day1);
  assert.ok(l.schedule.some((s) => s.when === 'Po 30 dneh'));
  assert.ok(!l.schedule.some((s) => s.when === 'Po 90 dneh'));
  assert.ok(l.bring.some((b) => /Zdravniško spričevalo/.test(b)), 'medical still open');
  assert.ok(!l.bring.some((b) => /obrazec s podatki/.test(b)), 'payroll form already received');
  assert.ok(l.bring.some((b) => /obutev/.test(b)), 'store staff');
  assert.deepStrictEqual(l.sign.map((s) => s.name), ['Maja Novak', 'Tina Zupan']);
});

t('Croatian letter for the Zagreb office, with a time, meeting point and own note', () => {
  const l = J.welcome(joiner({ loc: ZG, role: 'Data analyst', time: '09:00', meet: 'recepcija, 3. kat', note: 'Parkiralište je iza zgrade.', tasks: [] }), 'hr');
  assert.strictEqual(l.greeting, 'Dobro došli, Nina!');
  assert.ok(l.paras[0].indexOf('na radnom mjestu „analitičar podataka” u uredu u Zagrebu') > 0, l.paras[0]);
  assert.ok(l.paras[0].indexOf('ponedjeljak, 2. 11. 2026, u 9.00 sati') > 0, l.paras[0]);
  assert.strictEqual(l.paras[1], 'Prvoga dana dočeka vas Maja Novak (recepcija, 3. kat).');
  assert.ok(l.paras.indexOf('Parkiralište je iza zgrade.') >= 0);
  assert.ok(!l.bring.some((b) => /obuću/.test(b)), 'office: no shoes line');
  assert.strictEqual(l.place, 'Zagreb, 15. 10. 2026');
});

t('English letter and plain text', () => {
  const l = J.welcome(joiner(), 'en'), txt = J.letterText(l);
  assert.ok(l.paras[0].indexOf('as our new optician at the Maribor store') > 0, l.paras[0]);
  assert.ok(l.paras[0].indexOf('Monday, 2. 11. 2026, at 8:30') > 0);
  assert.ok(J.welcome(joiner({ role: 'Lens grinder' }), 'sl').paras[0].indexOf('»Lens grinder«') > 0, 'unknown titles stay as typed');
  assert.ok(txt.indexOf('Welcome to the team') > 0 && txt.indexOf('- An ID card or passport') > 0);
  assert.ok(/^We are glad/m.test(txt), 'first paragraph capitalised');
  assert.strictEqual(J.welcome(joiner(), 'de').lang, 'sl', 'unknown language falls back to Slovenian');
});

t('Microsoft 365 plan for a joiner: create, licence, manager, groups, Teams, MFA; ticks the matching IT items only', () => {
  const ctx = joiner(), plan = J.m365Plan(ctx);
  assert.deepStrictEqual(plan.map((s) => s.id), ['user', 'licence', 'manager', 'groups', 'teams', 'mfa']);
  assert.ok(plan[0].graph === 'POST /users' && /nina\.kos@example\.com/.test(plan[0].text));
  assert.ok(/Store Maribor/.test(plan[3].text));
  const r = J.m365Run(ctx, '2026-10-15T10:00');
  assert.deepStrictEqual(r.tick.sort(), ['t4', 't5', 't6']);
  assert.ok(r.tick.indexOf('t8') < 0, 'MFA is set up with the person');
  assert.ok(r.tick.indexOf('t9') < 0, 'POS is not Microsoft 365');
  assert.strictEqual(r.waiting.length, 0);
  // done items are never ticked again, and their steps are shown as already done
  ctx.tasks[3].status = 'done';
  const r2 = J.m365Run(ctx, '2026-10-15T10:00');
  assert.deepStrictEqual(r2.tick.sort(), ['t5', 't6']);
  assert.ok(r2.steps[0].already && !r2.steps[0].run && r2.steps[1].already);
  assert.ok(r2.steps[2].run, 'the manager step has no checklist item and still runs');
});

t('Microsoft 365 plan for a leaver waits for the last day at 17:00 and the day after', () => {
  const ctx = { type: 'leaver', first: 'Rok', last: 'Turk', email: 'rok.turk@example.com', role: 'Buyer', date: '2026-10-30', loc: { id: 'HQ', kind: 'office', country: 'SI' }, manager: 'Ana Kos',
    licence: 'Microsoft 365 Business Standard', tasks: [
      task('a', 'Disable accounts on the last day at 17:00', 'IT'), task('b', 'Remove the Microsoft 365 licence', 'IT', { offset: 1, licence: 'remove' }),
      task('c', 'Mailbox converted to shared, forwarded to the manager for 90 days', 'IT', { offset: 1 }), task('d', 'Remove from POS, ERP and shop admin', 'IT')] };
  const before = J.m365Run(ctx, '2026-10-20T09:00');
  assert.deepStrictEqual(before.tick, []);
  assert.deepStrictEqual(before.waiting.sort(), ['a', 'b', 'c']);
  assert.ok(before.steps.every((s) => !s.run));
  assert.strictEqual(before.steps[0].when, '2026-10-30T17:00');
  assert.strictEqual(before.steps.filter((s) => s.id === 'licence')[0].when, '2026-10-31');
  const lastDay = J.m365Run(ctx, '2026-10-30T17:05');
  assert.deepStrictEqual(lastDay.tick, ['a']);
  assert.deepStrictEqual(J.m365Run(ctx, '2026-10-30T16:59').tick, []);
  assert.deepStrictEqual(J.m365Run(ctx, '2026-10-31T08:00').tick.sort(), ['a', 'b', 'c']);
});

t('Microsoft 365 plan for a move between stores: profile, groups, licence change', () => {
  const ctx = { type: 'change', first: 'Eva', last: 'Kralj', email: 'eva.kralj@example.com', role: 'Optician', toRole: 'Store manager', date: '2026-11-02',
    loc: { id: 'S-MB', short: 'Maribor', kind: 'store', country: 'SI' }, toLoc: { id: 'S-CE', short: 'Celje', kind: 'store', country: 'SI' }, manager: 'Jan Kos',
    licence: 'Microsoft 365 F3', licencePlan: 'Microsoft 365 Business Standard',
    tasks: [task('x', 'E-mail groups and Teams channel switched', 'IT', { offset: -2 }), task('y', 'Licence change if needed', 'IT', { offset: -1, licence: 'change' }), task('z', 'POS access moved to the new store', 'IT')] };
  const plan = J.m365Plan(ctx);
  assert.deepStrictEqual(plan.map((s) => s.id), ['profile', 'groups', 'licence']);
  assert.ok(/Store Maribor → Store Celje/.test(plan[1].text));
  assert.deepStrictEqual(J.m365Run(ctx, '2026-10-15T10:00').tick.sort(), ['x', 'y']);
  const same = Object.assign({}, ctx, { toLoc: ctx.loc, licencePlan: ctx.licence });
  assert.deepStrictEqual(J.m365Plan(same).map((s) => s.id), ['profile']);
});

console.log(n + ' tests passed');
