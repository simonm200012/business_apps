// Tests for site/pisarna-dms/einvoice.js (e-SLOG 2.0, e-SLOG 1.6 and UBL 2.1 e-invoices).
// Run: node tools/tests/pisarna-einvoice.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const E = require(path.join(__dirname, '../../site/pisarna-dms/einvoice.js'));
const dir = path.join(__dirname, '../../site/pisarna-dms/vzorci');
const sample = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok', n, name); }

t('e-SLOG 2.0: supplier, number, dates, amounts, VAT, IBAN, reference', () => {
  const r = E.parse(sample('eslog20-papirnica-bela.xml'));
  assert.strictEqual(r.format, 'e-SLOG 2.0');
  assert.strictEqual(r.number, '2026-00418');
  assert.strictEqual(r.issueDate, '2026-10-12');
  assert.strictEqual(r.serviceDate, '2026-10-09');
  assert.strictEqual(r.dueDate, '2026-11-11');
  assert.strictEqual(r.seller.name, 'Papirnica Bela d.o.o.');
  assert.strictEqual(r.seller.vatId, 'SI00000108');
  assert.strictEqual(r.seller.iban, 'SI00 0000 0000 1234 567');
  assert.strictEqual(r.buyer.vatId, 'SI00000017');
  assert.strictEqual(r.reference, 'SI00 2026-00418');
  assert.deepStrictEqual([r.net, r.vat, r.total, r.payable], [304, 66.88, 370.88, 370.88]);
  assert.deepStrictEqual(r.taxes, [{ rate: 22, base: 304, amount: 66.88 }]);
  assert.strictEqual(r.lines.length, 2);
  assert.deepStrictEqual(r.lines[0], { desc: 'Papir A4, 80 g, škatla 5 × 500 listov', qty: 10, price: 24.5, amount: 245, vatRate: 22 });
  assert.deepStrictEqual(r.warnings, []);
});

t('e-SLOG 1.6: two VAT rates (9,5 % and 22 %)', () => {
  const r = E.parse(sample('eslog16-kava-in-caj.xml'));
  assert.strictEqual(r.format, 'e-SLOG 1.6');
  assert.strictEqual(r.number, 'KC-26-1187');
  assert.strictEqual(r.issueDate, '2026-10-08');
  assert.strictEqual(r.dueDate, '2026-10-23');
  assert.strictEqual(r.seller.name, 'Kava in Čaj d.o.o.');
  assert.strictEqual(r.seller.city, 'Koper');
  assert.strictEqual(r.reference, 'SI00 261187');
  assert.deepStrictEqual([r.net, r.vat, r.payable], [148, 19.06, 167.06]);
  assert.strictEqual(r.total, 167.06); // computed: net + VAT
  const f = E.toFields(r);
  assert.strictEqual(f.ddv_znizana_stopnja_osnova, 108);
  assert.strictEqual(f.ddv_znizana_stopnja_znesek, 10.26);
  assert.strictEqual(f.ddv_osnovna_stopnja_osnova, 40);
  assert.strictEqual(f.ddv_osnovna_stopnja_znesek, 8.8);
});

t('UBL 2.1 (Peppol): EU supplier with reverse charge at 0 %', () => {
  const r = E.parse(sample('ubl-cloudberry-hosting.xml'));
  assert.strictEqual(r.format, 'UBL 2.1');
  assert.strictEqual(r.number, 'CBH-2026-5531');
  assert.strictEqual(r.seller.name, 'Cloudberry Hosting B.V.');
  assert.strictEqual(r.seller.country, 'NL');
  assert.strictEqual(r.seller.vatId, 'NL000000000B01');
  assert.strictEqual(r.buyer.vatId, 'SI00000017');
  assert.strictEqual(r.serviceDate, '2026-10-31');
  assert.deepStrictEqual([r.net, r.vat, r.total, r.payable], [480, 0, 480, 480]);
  assert.strictEqual(r.lines[1].desc, 'Backup storage & snapshots, 100 GB'); // &amp; decoded
  const f = E.toFields(r);
  assert.strictEqual(f.ddv_neobdavcena_osnova, 480);
  assert.strictEqual(f.ddv_osnovna_stopnja_osnova, undefined);
});

t('fields use the DMS card keys', () => {
  const f = E.toFields(E.parse(sample('eslog20-papirnica-bela.xml')));
  assert.deepStrictEqual(
    [f.stevilka_racuna, f.datum_racuna, f.datum_opr_stor_izdaje_blaga, f.datum_zapadlosti_rok_placila, f.skupni_znesek_racuna, f.skupni_neto_znesek_racuna, f.skupni_znesek_ddv, f.sklic_placila, f.naziv_izdajatelja, f.id_za_ddv_izdajatelja, f.izdajateljev_trr, f.valuta_racuna, f.tip_racuna_sifra],
    ['2026-00418', '2026-10-12', '2026-10-09', '2026-11-11', 370.88, 304, 66.88, 'SI00 2026-00418', 'Papirnica Bela d.o.o.', 'SI00000108', 'SI00 0000 0000 1234 567', 'EUR', 'Račun']);
});

t('UBL credit note', () => {
  const xml = `<?xml version="1.0"?><CreditNote xmlns="urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2" xmlns:cbc="c" xmlns:cac="a">
    <cbc:ID>DB-7</cbc:ID><cbc:IssueDate>2026-10-02</cbc:IssueDate><cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
    <cac:AccountingSupplierParty><cac:Party><cac:PartyName><cbc:Name>Primer d.o.o.</cbc:Name></cac:PartyName></cac:Party></cac:AccountingSupplierParty>
    <cac:LegalMonetaryTotal><cbc:TaxExclusiveAmount>-100.00</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount>-122.00</cbc:TaxInclusiveAmount><cbc:PayableAmount>-122.00</cbc:PayableAmount></cac:LegalMonetaryTotal>
    <cac:CreditNoteLine><cbc:ID>1</cbc:ID><cbc:CreditedQuantity>1</cbc:CreditedQuantity><cbc:LineExtensionAmount>-100.00</cbc:LineExtensionAmount><cac:Item><cbc:Name>Vračilo</cbc:Name></cac:Item></cac:CreditNoteLine>
  </CreditNote>`;
  const r = E.parse(xml);
  assert.strictEqual(r.credit, true);
  assert.strictEqual(r.vat, -22);
  assert.strictEqual(r.lines[0].amount, -100);
  const f = E.toFields(r);
  assert.strictEqual(f.stevilka_dobropisa, 'DB-7');
  assert.strictEqual(f.tip_racuna_sifra, 'Dobropis');
});

t('an e-SLOG 2.0 invoice inside an envelope, with entities, CDATA and comments', () => {
  const xml = `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><Ovojnica><!-- envelope -->
    <Invoice xmlns="urn:eslog:2.00"><M_INVOIC Id="data">
      <S_BGM><C_C002><D_1001>380</D_1001></C_C002><C_C106><D_1004><![CDATA[R-1/26]]></D_1004></C_C106></S_BGM>
      <S_DTM><C_C507><D_2005>137</D_2005><D_2380>20261001</D_2380></C_C507></S_DTM>
      <G_SG2><S_NAD><D_3035>SE</D_3035><C_C080><D_3036>Tiskarna &#268;rka &amp; sinovi</D_3036></C_C080></S_NAD></G_SG2>
      <G_SG50><S_MOA><C_C516><D_5025>9</D_5025><D_5004>12.20</D_5004></C_C516></S_MOA></G_SG50>
      <G_SG50><S_MOA><C_C516><D_5025>389</D_5025><D_5004>10.00</D_5004></C_C516></S_MOA></G_SG50>
    </M_INVOIC></Invoice></Ovojnica>`;
  const r = E.parse(xml);
  assert.strictEqual(r.number, 'R-1/26');
  assert.strictEqual(r.issueDate, '2026-10-01');
  assert.strictEqual(r.seller.name, 'Tiskarna Črka & sinovi');
  assert.strictEqual(r.payable, 12.2);
  assert.strictEqual(r.total, 12.2);
  assert.strictEqual(r.vat, 2.2);
  // the DTD entity is never expanded
  assert.ok(!JSON.stringify(r).includes('passwd'));
});

t('warnings: totals that do not add up, a wrong IBAN, missing data', () => {
  const xml = sample('eslog20-papirnica-bela.xml')
    .replace('<D_5025>388</D_5025><D_5004>370.88', '<D_5025>388</D_5025><D_5004>371.88')
    .replace('SI00 0000 0000 1234 567', 'SI56 1234 5678 9012 345');
  const r = E.parse(xml);
  assert.ok(r.warnings.some(w => /se ne ujema/.test(w)), r.warnings.join('|'));
  assert.ok(r.warnings.some(w => /TRR/.test(w)));
  const bare = E.parse('<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"><ID>1</ID></Invoice>');
  assert.ok(bare.warnings.includes('Ni datuma izdaje.'));
  assert.ok(bare.warnings.includes('Ni naziva izdajatelja.'));
});

t('not an e-invoice, or broken XML: clear Slovenian errors', () => {
  assert.throws(() => E.parse('<Narocilo><ID>1</ID></Narocilo>'), /ni e-račun/);
  assert.throws(() => E.parse('<Invoice><ID>1</Invoice>'), /Napačen XML/);
  assert.throws(() => E.parse('to ni xml'), /ni XML/);
});

t('numbers, dates and IBAN checks', () => {
  assert.strictEqual(E.num('1234.50'), 1234.5);
  assert.strictEqual(E.num('1.234,50'), 1234.5);
  assert.strictEqual(E.num(''), null);
  assert.strictEqual(E.date('2026-10-01T00:00:00'), '2026-10-01');
  assert.strictEqual(E.date('20261001'), '2026-10-01');
  assert.strictEqual(E.date('1. 10. 2026'), '2026-10-01');
  assert.strictEqual(E.ibanOk('SI56 0510 0801 2345 678'), false);
  assert.strictEqual(E.ibanOk('DE89 3704 0044 0532 0130 00'), true); // the standard example IBAN
  assert.strictEqual(E.vatSlot(9.5), 'ddv_znizana_stopnja');
  assert.strictEqual(E.vatSlot(5), 'ddv_dodatna_stopnja_1');
  assert.strictEqual(E.vatSlot(13), null);
});

console.log('\n' + n + ' Pisarna e-invoice tests passed');
