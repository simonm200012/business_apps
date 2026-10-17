// Tests for the eSLOG model: numbers and dates in Slovenian and English notation, VAT rates, VAT ID and IBAN checks, totals.
// Run: node --no-warnings tools/tests/eslog-model.test.js
'use strict';
const assert = require('assert').strict;
const path = require('path');
const { pathToFileURL } = require('url');
let n = 0;
async function t(name, fn) { await fn(); n++; console.log('ok', n, name); }
(async () => {
const M = await import(pathToFileURL(path.join(__dirname, '../../site/convert/eslog/model.mjs')).href);

await t('numbers: Slovenian 1.234,56, English 1,234.56, spaces, currency signs, negatives, rubbish', () => {
  for (const [s, v] of [['1.234,56', 1234.56], ['1,234.56', 1234.56], ['1 234,56', 1234.56], ['85,00', 85], ['85.00', 85], ['1.234', 1234], ['0.125', 0.125], ['1.5', 1.5], ['12,5 %', 12.5],
    ['€ 85,00', 85], ['85,00 EUR', 85], ['(12,00)', -12], ['12,00-', -12], ['-3,5', -3.5], ['1.234.567,89', 1234567.89], ['7', 7]]) assert.equal(M.parseNumber(s), v, s);
  for (const s of ['', 'abc', '12abc', '1,2,3,x', '--', null, undefined, '22.10.2026']) assert.equal(M.parseNumber(s), null, String(s));
  assert.equal(M.parseNumber(42.5), 42.5);
});
await t('dates: day first, several separators, ISO, two-digit year, impossible dates refused', () => {
  for (const [s, v] of [['02.10.2026', '2026-10-02'], ['2.10.2026', '2026-10-02'], ['2. 10. 2026', '2026-10-02'], ['02/10/2026', '2026-10-02'], ['02-10-2026', '2026-10-02'], ['2026-10-02', '2026-10-02'],
    ['2026-10-02T00:00:00', '2026-10-02'], ['20261002', '2026-10-02'], ['02.10.26', '2026-10-02'], ['29.02.2028', '2028-02-29']]) assert.equal(M.parseDate(s), v, s);
  for (const s of ['31.02.2026', '29.02.2027', '13.13.2026', 'hello', '', '1.234', '02.10.1850']) assert.equal(M.parseDate(s), null, s);
  assert.equal(M.showDate('2026-10-02'), '02.10.2026');
});
await t('VAT rates: 22, "9,5 %", Excel fractions, "DDV 22%"; showing money Slovenian style', () => {
  assert.equal(M.parseVatRate('22 %'), 22); assert.equal(M.parseVatRate('9,5 %'), 9.5); assert.equal(M.parseVatRate(0.22), 22); assert.equal(M.parseVatRate('0,095'), 9.5); assert.equal(M.parseVatRate('DDV 22%'), 22);
  assert.equal(M.parseVatRate('0'), 0); assert.equal(M.parseVatRate('abc'), null); assert.equal(M.parseVatRate('250'), null);
  assert.equal(M.showMoney(1690.5), '1.690,50'); assert.equal(M.showQty(2.5), '2,5'); assert.equal(M.showQty(12), '12'); assert.equal(M.showPrice(85), '85,00'); assert.equal(M.showPrice(0.0125), '0,0125');
});
await t('SI VAT ID: format and check digit; IBAN: mod 97 and the Slovenian length', () => {
  assert.ok(M.siVatIdOk('SI12345679')); assert.ok(M.siVatIdOk('si 1234 5679')); assert.ok(M.siVatIdOk('SI10000003'));
  assert.ok(!M.siVatIdOk('SI12345678')); assert.ok(!M.siVatIdOk('SI1234567')); assert.ok(!M.siVatIdOk('SI02345678')); assert.ok(!M.siVatIdOk('DE12345679'));
  assert.ok(M.ibanOk('SI50 1234 5678 9012 345')); assert.ok(M.ibanOk('SI56 1910 0000 0123 438')); assert.ok(M.ibanOk('DE89 3704 0044 0532 0130 00'));
  assert.ok(!M.ibanOk('SI56 0000 0000 0000 000')); assert.ok(!M.ibanOk('SI50 1234 5678 9012 346')); assert.ok(!M.ibanOk('SI50 1234')); assert.ok(!M.ibanOk(''));
  assert.equal(M.showIban('si50123456789012345'), 'SI50 1234 5678 9012 345');
});
await t('totals: per line, per VAT rate, rounded to cents; the file amount wins over quantity times price', () => {
  const inv = M.emptyInvoice();
  inv.lines = [{ quantity: 12, unitPrice: 85, vatRate: 22, net: null }, { quantity: 1, unitPrice: 240, vatRate: 22 }, { quantity: 40, unitPrice: 3.5, vatRate: 9.5 }];
  const t2 = M.computeTotals(inv);
  assert.equal(t2.net, 1400); assert.equal(t2.vat, 290.5); assert.equal(t2.gross, 1690.5);
  assert.deepEqual(t2.rates, [{ rate: 22, taxable: 1260, vat: 277.2 }, { rate: 9.5, taxable: 140, vat: 13.3 }]);
  assert.equal(M.lineNet({ quantity: 3, unitPrice: 10, net: 31 }), 31);
  assert.equal(M.round2(1.005), 1.01);
});
await t('safeText: control characters out, formula starts removed and reported, length cut', () => {
  assert.deepEqual(M.safeText('=HYPERLINK("x")'), { text: 'HYPERLINK("x")', formula: true });
  assert.deepEqual(M.safeText('@SUM(A1)'), { text: 'SUM(A1)', formula: true });
  assert.deepEqual(M.safeText('-12,50'), { text: '-12,50', formula: false });
  assert.deepEqual(M.safeText('a\u0000b\tc\nd'), { text: 'ab c d', formula: false });
  assert.equal(M.safeText('x'.repeat(900), 100).text.length, 100);
  assert.equal(M.unitCode('kos').code, 'C62'); assert.equal(M.unitCode('ur').code, 'HUR'); assert.equal(M.unitCode('m²').code, 'MTK'); assert.equal(M.unitCode('xyz').known, false);
});
console.log(n + ' tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
