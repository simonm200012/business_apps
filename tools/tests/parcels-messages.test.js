// Tests for site/parcels/messages.js (customer message templates). Run: node tools/tests/parcels-messages.test.js
'use strict';
const assert = require('assert');
const path = require('path');
const M = require(path.join(__dirname, '../../site/parcels/messages.js'));

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok', n, name); }
const VARS = { first: 'Ana', name: 'Ana Novak', order: 'SI-1041901', tracking: '91234567890', carrier: 'GLS SI', point: 'GLS ParcelShop Kranj', deadline: '', eta: '', cod: '', shop: 'Tokovi Optika', contact: 'info@example.si · +386 1 000 00 00' };

t('language from country and template kind from the exception rule', () => {
  assert.strictEqual(M.langFor('SI'), 'sl'); assert.strictEqual(M.langFor('HR'), 'hr'); assert.strictEqual(M.langFor('IT'), 'en');
  assert.strictEqual(M.kindFor('noscan'), 'late'); assert.strictEqual(M.kindFor('pickup'), 'pickup'); assert.strictEqual(M.kindFor('returned'), 'returned');
  assert.strictEqual(M.kindFor('damlost'), 'damaged'); assert.strictEqual(M.kindFor('failed'), 'failed');
  assert.strictEqual(M.kindFor('manual', 'pickup'), 'pickup'); assert.strictEqual(M.kindFor('manual', 'returned'), 'returned'); assert.strictEqual(M.kindFor('manual', 'transit'), 'late');
});
t('every kind exists in every language with subject, body and SMS, and no placeholder is left', () => {
  M.LANGS.forEach(([lang]) => M.KINDS.forEach(([kind]) => {
    const v = Object.assign({}, VARS, { eta: M.fmtDate('2026-10-20', lang), deadline: M.fmtDate('2026-10-22', lang), cod: M.fmtMoney(49.9) });
    const m = M.compose(kind, lang, v);
    [m.subject, m.body, m.sms].forEach((x) => { assert.ok(x && x.length > 10, lang + ' ' + kind); assert.ok(!/\{[?/]?\w+\}/.test(x), lang + ' ' + kind + ': ' + x); });
    assert.ok(m.body.indexOf('Tokovi Optika') > 0 && m.sms.indexOf('Tokovi Optika') === 0);
  }));
});
t('placeholders filled: locker point and deadline, ETA, COD only when COD', () => {
  const pick = M.compose('pickup', 'sl', Object.assign({}, VARS, { deadline: M.fmtDate('2026-10-22', 'sl'), cod: M.fmtMoney(1234.5) }));
  assert.strictEqual(pick.subject, 'Pošiljka SI-1041901 vas čaka – prevzem do 22. 10. 2026');
  assert.ok(pick.body.indexOf('na prevzemnem mestu GLS ParcelShop Kranj') > 0);
  assert.ok(pick.body.indexOf('Ob prevzemu plačate 1.234,50 € (odkupnina).') > 0);
  assert.ok(pick.body.startsWith('Pozdravljeni, Ana,'));
  const late = M.compose('late', 'hr', Object.assign({}, VARS, { eta: M.fmtDate('2026-10-20', 'hr') }));
  assert.ok(late.body.indexOf('Novi očekivani datum dostave je 20. 10. 2026.') > 0, late.body); // one dot, not two
  assert.ok(late.body.indexOf('otkupnina') < 0); // prepaid: no COD sentence
  const ret = M.compose('returned', 'en', VARS);
  assert.ok(ret.body.indexOf('refund you') > 0 && ret.body.indexOf('owe us nothing') < 0);
  const retCod = M.compose('returned', 'en', Object.assign({}, VARS, { cod: M.fmtMoney(20) }));
  assert.ok(retCod.body.indexOf('You did not pay the 20,00 € cash on delivery') > 0 && retCod.body.indexOf('refund you') < 0);
  assert.ok(M.compose('damaged', 'sl', Object.assign({}, VARS, { lost: true })).body.indexOf('izgubljena') > 0);
  assert.ok(M.compose('damaged', 'hr', VARS).sms.indexOf('oštećena') > 0);
  const noContact = M.compose('late', 'sl', Object.assign({}, VARS, { contact: '' }));
  assert.ok(/Tokovi Optika$/.test(noContact.body));
});
t('formats: dates per language, money with thousands dot and decimal comma', () => {
  assert.strictEqual(M.fmtDate('2026-10-05', 'sl'), '5. 10. 2026');
  assert.strictEqual(M.fmtDate('2026-10-05', 'hr'), '5. 10. 2026.');
  assert.strictEqual(M.fmtDate('2026-10-05', 'en'), '5 October 2026');
  assert.strictEqual(M.fmtMoney(1234.5), '1.234,50 €');
  assert.strictEqual(M.fmtMoney(0.1 + 0.2), '0,30 €');
});
t('mailto and sms links', () => {
  const m = M.mailto('ana.novak@example.com', 'Pošiljka SI-1 & več', 'Vrstica 1\nVrstica 2');
  assert.strictEqual(m, 'mailto:ana.novak@example.com?subject=Po%C5%A1iljka%20SI-1%20%26%20ve%C4%8D&body=Vrstica%201%0D%0AVrstica%202');
  assert.strictEqual(M.normPhone('+386 1 000 12 34'), '+38610001234');
  assert.strictEqual(M.smsHref('+386 1 000 12 34', 'Živjo & hvala'), 'sms:+38610001234?&body=%C5%BDivjo%20%26%20hvala');
  assert.deepStrictEqual(M.smsInfo('Hello'), { chars: 5, gsm: true, parts: 1 });
  assert.strictEqual(M.smsInfo('x'.repeat(161)).parts, 2);
  assert.strictEqual(M.smsInfo('č'.repeat(71)).gsm, false);
  assert.strictEqual(M.smsInfo('č'.repeat(71)).parts, 2);
});
t('fill keeps unknown placeholders visible and drops empty optional parts', () => {
  assert.strictEqual(M.fill('A {x} {?y}B{/y}C', {}), 'A {x} C');
  assert.strictEqual(M.fill('{?y}[{y}]{/y}', { y: 'ok' }), '[ok]');
});
console.log(n + ' parcels-messages tests passed');
