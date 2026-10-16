// Tests for site/desk/extract.js (deadline phrases, due-date suggestions, auto-fill) and
// site/desk/schedule.js (repeating tasks, snooze, .ics). Run: node tools/tests/desk-deadlines.test.js
'use strict';
const assert = require('assert');
const path = require('path');
const X = require(path.join(__dirname, '../../site/desk/extract.js'));
const S = require(path.join(__dirname, '../../site/desk/schedule.js'));

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok', n, name); }

const THU = '2026-10-15'; // a Thursday
function top(text, base, subject) { const r = X.suggestDue(text, subject || '', base || THU); return r[0] || null; }
function due(text, base, subject) { return X.autoDue(X.suggestDue(text, subject || '', base || THU), base || THU); }

t('the phrases from the review are found and filled in (SL)', () => {
  assert.strictEqual(due('Prosim, pošlji ponudbo jutri.'), '2026-10-16');
  assert.strictEqual(due('Rabim to pojutrišnjem.'), '2026-10-17');
  assert.strictEqual(due('Pošljite najkasneje v petek.'), '2026-10-16');
  assert.strictEqual(due('Račun plačajte do 20. 10.'), '2026-10-20');
  assert.strictEqual(due('Pogodbo potrebujem do torka.'), '2026-10-20');
  assert.strictEqual(due('Prosim uredi v torek.'), '2026-10-20');
  assert.strictEqual(due('Ponudbo prosim do konca tedna.'), '2026-10-16');
  assert.strictEqual(due('Plačilo v roku 8 dni.'), '2026-10-23');
  assert.strictEqual(due('Še danes prosim.'), THU);
});

t('Croatian phrases', () => {
  assert.strictEqual(due('Molim te, pošalji sutra.'), '2026-10-16');
  assert.strictEqual(due('Molim rezervaciju u utorak.'), '2026-10-20');
  assert.strictEqual(due('Javite se najkasnije do petka.'), '2026-10-16');
  assert.strictEqual(due('Trebamo to prekosutra.'), '2026-10-17');
  assert.strictEqual(due('Molim do kraja mjeseca.'), '2026-10-31');
  assert.strictEqual(due('Platite u roku od 8 dana.'), '2026-10-23');
  assert.strictEqual(due('Pošaljite do srijede.'), '2026-10-21');
});

t('English phrases', () => {
  assert.strictEqual(due('Please send it tomorrow.'), '2026-10-16');
  assert.strictEqual(due('Please reply by Friday.'), '2026-10-16');
  assert.strictEqual(due('Can you do it by Fri?'), '2026-10-16');
  assert.strictEqual(due('Need the figures by end of next week.'), '2026-10-23');
  assert.strictEqual(due('by EOW please'), '2026-10-16');
  assert.strictEqual(due('Please confirm within 5 days.'), '2026-10-20');
  assert.strictEqual(due('Deadline: 30 October 2026'), '2026-10-30');
});

t('explicit dates with a deadline word', () => {
  assert.strictEqual(due('Rok plačila: 31. 10. 2026'), '2026-10-31');
  assert.strictEqual(due('Najkasneje do 20.10.2026 prosim.'), '2026-10-20');
  assert.strictEqual(due('do 20. 10.'), '2026-10-20');
});

t('weekday arithmetic: the coming day, a week on when it is that day, "this" and "next"', () => {
  assert.strictEqual(top('do četrtka', THU).iso, '2026-10-22'); // on a Thursday, "by Thursday" is next week
  assert.strictEqual(top('this Thursday please', THU).iso, THU);
  assert.strictEqual(top('naslednji petek prosim', THU).iso, '2026-10-23');
  assert.strictEqual(top('next Monday', THU).iso, '2026-10-19');
  assert.strictEqual(top('v ponedeljek', '2026-10-18').iso, '2026-10-19'); // Sunday → Monday
  assert.strictEqual(top('do konca tedna', '2026-10-17').iso, '2026-10-23'); // Saturday → next Friday
  assert.strictEqual(top('do konca meseca', '2026-02-10').iso, '2026-02-28');
  assert.strictEqual(top('v 3 delovnih dneh', '2026-10-16').iso, '2026-10-21'); // Fri + 3 working days
});

t('the base date is the date of the e-mail, not today', () => {
  assert.strictEqual(top('Prosim jutri.', '2026-10-01').iso, '2026-10-02');
});

t('not sure → suggested, never filled in', () => {
  // a mention without a request or deadline word
  const a = top('Sestanek v torek ob 10h.');
  assert.strictEqual(a.iso, '2026-10-20'); assert.strictEqual(a.confidence, 'medium');
  assert.strictEqual(due('Sestanek v torek ob 10h.'), null);
  assert.strictEqual(due('Jutri sem na dopustu.'), null);
  assert.strictEqual(due('Sastanak je u srijedu.'), null);
  // "next Friday" means different days to different people
  assert.strictEqual(due('Please send it next Friday.'), null);
  assert.strictEqual(due('čez 3 dni'), null);
  // two different sure dates
  const two = X.suggestDue('Ponudbo do petka, pogodbo do 30. 10.', '', THU);
  assert.deepStrictEqual(two.map(s => s.iso).sort(), ['2026-10-16', '2026-10-30']);
  assert.ok(two.every(s => s.ambiguous));
  assert.strictEqual(X.autoDue(two, THU), null);
  // the end of a range is a period, not a deadline
  assert.strictEqual(due('Hotel od 20. 10. do 22. 10.'), null);
});

t('no false hits', () => {
  assert.deepStrictEqual(X.suggestDue('Petek je prost dan. Sreda je bila naporna.', '', THU), []);
  assert.deepStrictEqual(X.suggestDue('Do you have a minute? The sredstva are approved.', '', THU), []);
  assert.deepStrictEqual(X.suggestDue('Hvala za včerajšnji sestanek.', '', THU), []);
});

t('relative words in a quoted mail are not counted from this mail', () => {
  const text = 'Lahko urediš?\n\nFrom: Ana <ana@example.com>\nSent: Monday, 5 October 2026\nSubject: Hotel\n\nProsim rezerviraj hotel do jutri.';
  assert.strictEqual(due(text, THU, 'FW: Hotel'), null);
  // explicit dates in the quoted part are still suggested
  const t2 = 'Lahko urediš?\n\nFrom: Ana <ana@example.com>\nSent: Monday, 5 October 2026\nSubject: Hotel\n\nProsim do 22. 10. 2026.';
  const s = top(t2, THU, 'FW: Hotel');
  assert.strictEqual(s.iso, '2026-10-22');
  assert.notStrictEqual(s.confidence, 'high');
});

t('autoDue never fills in a date before today', () => {
  const sug = X.suggestDue('Prosim jutri.', '', '2026-10-01');
  assert.strictEqual(X.autoDue(sug, THU), null);
  assert.strictEqual(X.autoDue(sug, '2026-10-01'), '2026-10-02');
});

t('the phrase and snippet are kept for the Undo hint', () => {
  const s = top('Živjo,\nprosim pošljite najkasneje v petek.\nHvala');
  assert.strictEqual(s.phrase, 'najkasneje v petek');
  assert.ok(s.snippet.indexOf('najkasneje v petek') >= 0);
});

t('repeating tasks: next due dates', () => {
  assert.strictEqual(S.nextDue('2026-10-15', { every: 'daily' }, THU), '2026-10-16');
  assert.strictEqual(S.nextDue('2026-10-16', { every: 'weekdays' }, THU), '2026-10-19'); // Fri → Mon
  assert.strictEqual(S.nextDue('2026-10-15', { every: 'weekly' }, THU), '2026-10-22');
  assert.strictEqual(S.nextDue('2026-10-15', { every: 'biweekly' }, THU), '2026-10-29');
  assert.strictEqual(S.nextDue('2026-01-31', S.makeRepeat('monthly', '2026-01-31'), '2026-01-31'), '2026-02-28');
  // the 31st stays the 31st after a short month
  assert.strictEqual(S.nextDue('2026-02-28', { every: 'monthly', day: 31 }, '2026-02-28'), '2026-03-31');
  assert.strictEqual(S.nextDue('2026-11-30', { every: 'quarterly', day: 30 }, '2026-11-30'), '2027-02-28');
  assert.strictEqual(S.nextDue('2028-02-29', { every: 'yearly', day: 29 }, '2028-02-29'), '2029-02-28');
  // weeks overdue: one new task from today on, not a pile of overdue ones
  assert.strictEqual(S.nextDue('2026-09-01', { every: 'weekly' }, THU), '2026-10-20');
  // no due date: from today
  assert.strictEqual(S.nextDue(null, { every: 'weekly' }, THU), '2026-10-22');
  assert.strictEqual(S.nextDue('2026-10-15', null, THU), null);
});

t('snooze choices and state', () => {
  const c = S.snoozeChoices(THU);
  assert.deepStrictEqual(c.map(x => x.iso), ['2026-10-16', '2026-10-19', '2026-10-22', '2026-11-15']);
  // on a Sunday, tomorrow and next Monday are the same day: listed once
  assert.strictEqual(S.snoozeChoices('2026-10-18').filter(x => x.iso === '2026-10-19').length, 1);
  assert.strictEqual(S.isSnoozed({ status: 'todo', snoozeUntil: '2026-10-16' }, THU), true);
  assert.strictEqual(S.isSnoozed({ status: 'todo', snoozeUntil: THU }, THU), false);
  assert.strictEqual(S.isSnoozed({ status: 'done', snoozeUntil: '2026-10-16' }, THU), false);
  assert.strictEqual(S.backFromSnooze({ status: 'todo', snoozeUntil: THU }, THU), true);
  assert.strictEqual(S.backFromSnooze({ status: 'todo', snoozeUntil: '2026-10-01' }, THU), false);
});

t('.ics: an all-day event Outlook reads', () => {
  const ics = S.taskIcs({ id: 'abc', title: 'Hotel; Zagreb, sejem', due: '2026-10-20', priority: 'high', repeat: { every: 'monthly', day: 31 } },
    { now: new Date('2026-10-15T08:00:00Z'), description: 'Line one\nLine two' });
  assert.ok(/\r\n$/.test(ics) && ics.split('\r\n').length > 10);
  assert.ok(ics.includes('DTSTART;VALUE=DATE:20261020\r\n'));
  assert.ok(ics.includes('DTEND;VALUE=DATE:20261021\r\n'));
  assert.ok(ics.includes('SUMMARY:Hotel\\; Zagreb\\, sejem\r\n'));
  assert.ok(ics.includes('DESCRIPTION:Line one\\nLine two\r\n'));
  assert.ok(ics.includes('RRULE:FREQ=MONTHLY;BYMONTHDAY=-1'));
  assert.ok(ics.includes('DTSTAMP:20261015T080000Z'));
  assert.ok(ics.includes('TRIGGER:-PT15H'));
  assert.ok(ics.includes('UID:abc@desk.stratum'));
  assert.throws(() => S.taskIcs({ id: 'x', title: 'No date' }));
});

t('.ics lines are folded at 75 octets without splitting a character', () => {
  const long = 'Č'.repeat(100);
  const ics = S.taskIcs({ id: 'f', title: long, due: '2026-10-20' }, { now: new Date(0), reminder: false });
  ics.split('\r\n').forEach(l => assert.ok(Buffer.byteLength(l, 'utf8') <= 75, l));
  const unfolded = ics.replace(/\r\n /g, '');
  assert.ok(unfolded.includes('SUMMARY:' + long));
  assert.strictEqual(S.icsFileName({ title: 'Hotel v Zagrebu — sejem' }), 'Hotel-v-Zagrebu-sejem.ics');
});

console.log('\n' + n + ' desk deadline/schedule tests passed');
