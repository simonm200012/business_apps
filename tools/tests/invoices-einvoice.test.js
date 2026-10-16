// Tests for site/invoices/einvoice.js (e-SLOG 2.0 / UBL e-invoices), the parser fixes for Billing's own PDFs, and the
// sample invoices. Run: node tools/tests/invoices-einvoice.test.js
'use strict';
const assert = require('assert');
const path = require('path');
const E = require(path.join(__dirname, '../../site/invoices/einvoice.js'));
const P = require(path.join(__dirname, '../../site/invoices/parser.js'));
const S = require(path.join(__dirname, '../../site/invoices/samples.js'));

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok', n, name); }

// ── XML reader ─────────────────────────────────────────────────────────────
t('XML reader: namespaces folded, attributes, entities, CDATA, comments, self-closing tags', () => {
  const x = E.parseXml('﻿<?xml version="1.0"?><!-- c --><a:Root xmlns:a="urn:x" b:k=\'v &amp; w\'><a:Item n="1">A &lt;b&gt; &#269;&#x161;</a:Item><Empty/><C><![CDATA[<raw> & stuff]]></C></a:Root>');
  assert.strictEqual(x.name, 'Root');
  assert.strictEqual(x.attrs.k, 'v & w');
  assert.strictEqual(E.txt(x, 'Item'), 'A <b> čš');
  assert.strictEqual(E.kid(x, 'Item').attrs.n, '1');
  assert.ok(E.kid(x, 'Empty'));
  assert.strictEqual(E.txt(x, 'C'), '<raw> & stuff');
});
t('XML reader: refuses DOCTYPE (no entity tricks) and broken nesting', () => {
  assert.throws(() => E.parseXml('<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><x>&e;</x>'), /DOCTYPE/);
  assert.throws(() => E.parseXml('<a><b></a></b>'), /mismatched/);
  assert.throws(() => E.parseXml('<a><b>'), /unclosed/);
  assert.throws(() => E.parseXml('just text'), /no XML element/);
  // an unknown entity stays as it is instead of being expanded
  assert.strictEqual(E.txt(E.parseXml('<a>&foo;</a>')), '&foo;');
});

// ── e-SLOG 2.0 ─────────────────────────────────────────────────────────────
// shaped like the official e-SLOG 2.0 example (segments, qualifiers); fictional values
const ESLOG = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:eslog:2.00" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
 <M_INVOIC Id="data">
  <S_UNH><D_0062>R-2026-77</D_0062><C_S009><D_0065>INVOIC</D_0065><D_0052>D</D_0052><D_0054>01B</D_0054><D_0051>UN</D_0051></C_S009></S_UNH>
  <S_BGM><C_C002><D_1001>380</D_1001></C_C002><C_C106><D_1004>R-2026-77</D_1004></C_C106></S_BGM>
  <S_DTM><C_C507><D_2005>137</D_2005><D_2380>2026-09-30</D_2380></C_C507></S_DTM>
  <S_DTM><C_C507><D_2005>35</D_2005></C_C507></S_DTM>
  <S_DTM><C_C507><D_2005>35</D_2005><D_2380>2026-09-29</D_2380></C_C507></S_DTM>
  <S_DTM><C_C507><D_2005>167</D_2005><D_2380>2026-09-01</D_2380></C_C507></S_DTM>
  <S_DTM><C_C507><D_2005>168</D_2005><D_2380>2026-09-30</D_2380></C_C507></S_DTM>
  <S_FTX><D_4451>AAI</D_4451><C_C108><D_4440>Hvala za zaupanje</D_4440></C_C108></S_FTX>
  <G_SG1><S_RFF><C_C506><D_1153>ON</D_1153><D_1154>NAR-12</D_1154></C_C506></S_RFF></G_SG1>
  <G_SG1><S_RFF><C_C506><D_1153>PQ</D_1153><D_1154>SI12 2026-77</D_1154></C_C506></S_RFF></G_SG1>
  <G_SG2><S_NAD><D_3035>BY</D_3035><C_C080><D_3036>Clearfigure d.o.o.</D_3036></C_C080><C_C059><D_3042>Ulica 2</D_3042></C_C059><D_3164>Maribor</D_3164><D_3251>2000</D_3251><D_3207>SI</D_3207></S_NAD>
   <S_FII><D_3035>BB</D_3035><C_C078><D_3194>SI56020100000000019</D_3194></C_C078></S_FII>
   <G_SG3><S_RFF><C_C506><D_1153>VA</D_1153><D_1154>SI 0000 0019</D_1154></C_C506></S_RFF></G_SG3></G_SG2>
  <G_SG2><S_NAD><D_3035>SE</D_3035><C_C080><D_3036>Lipa Net d.o.o.</D_3036><D_3036_2>Lipa</D_3036_2></C_C080><C_C059><D_3042>Optična 12</D_3042></C_C059><D_3164>Maribor</D_3164><D_3251>2000</D_3251><D_3207>SI</D_3207></S_NAD>
   <S_FII><D_3035>RB</D_3035><C_C078><D_3194>SI56 1910 0000 0123 438</D_3194><D_3192>Lipa Net d.o.o.</D_3192></C_C078><C_C088><D_3433>DBSISI2X</D_3433></C_C088></S_FII>
   <G_SG3><S_RFF><C_C506><D_1153>VA</D_1153><D_1154>SI00000035</D_1154></C_C506></S_RFF></G_SG3>
   <G_SG5><S_CTA><D_3139>IC</D_3139></S_CTA><S_COM><C_C076><D_3148>racuni@lipa.example.si</D_3148><D_3155>EM</D_3155></C_C076></S_COM></G_SG5></G_SG2>
  <G_SG7><S_CUX><C_C504><D_6347>2</D_6347><D_6345>EUR</D_6345></C_C504></S_CUX></G_SG7>
  <G_SG8><S_PAT><D_4279>1</D_4279></S_PAT><S_DTM><C_C507><D_2005>13</D_2005><D_2380>2026-10-15</D_2380></C_C507></S_DTM></G_SG8>
  <G_SG26><S_LIN><D_1082>1</D_1082></S_LIN><S_IMD><D_7077>F</D_7077><C_C273><D_7008>Internet 1000 Mbit/s</D_7008></C_C273></S_IMD><S_QTY><C_C186><D_6063>47</D_6063><D_6060>1</D_6060><D_6411>C62</D_6411></C_C186></S_QTY>
   <G_SG27><S_MOA><C_C516><D_5025>203</D_5025><D_5004>100.00</D_5004></C_C516></S_MOA></G_SG27><G_SG27><S_MOA><C_C516><D_5025>38</D_5025><D_5004>122.00</D_5004></C_C516></S_MOA></G_SG27></G_SG26>
  <G_SG26><S_LIN><D_1082>2</D_1082></S_LIN><S_IMD><D_7077>F</D_7077><C_C273><D_7008>Priročnik</D_7008></C_C273></S_IMD><S_QTY><C_C186><D_6063>47</D_6063><D_6060>2</D_6060><D_6411>H87</D_6411></C_C186></S_QTY>
   <G_SG27><S_MOA><C_C516><D_5025>203</D_5025><D_5004>20.00</D_5004></C_C516></S_MOA></G_SG27></G_SG26>
  <S_UNS><D_0081>S</D_0081></S_UNS>
  <G_SG50><S_MOA><C_C516><D_5025>79</D_5025><D_5004>120.00</D_5004></C_C516></S_MOA></G_SG50>
  <G_SG50><S_MOA><C_C516><D_5025>389</D_5025><D_5004>120.00</D_5004></C_C516></S_MOA></G_SG50>
  <G_SG50><S_MOA><C_C516><D_5025>388</D_5025><D_5004>143.90</D_5004></C_C516></S_MOA></G_SG50>
  <G_SG50><S_MOA><C_C516><D_5025>113</D_5025><D_5004>43.90</D_5004></C_C516></S_MOA></G_SG50>
  <G_SG50><S_MOA><C_C516><D_5025>9</D_5025><D_5004>100.00</D_5004></C_C516></S_MOA></G_SG50>
  <G_SG50><S_MOA><C_C516><D_5025>176</D_5025><D_5004>23.90</D_5004></C_C516></S_MOA></G_SG50>
  <G_SG52><S_TAX><D_5283>7</D_5283><C_C241><D_5153>VAT</D_5153></C_C241><C_C243><D_5278>22</D_5278></C_C243><D_5305>S</D_5305></S_TAX>
   <S_MOA><C_C516><D_5025>125</D_5025><D_5004>100.00</D_5004></C_C516></S_MOA><S_MOA><C_C516><D_5025>124</D_5025><D_5004>22.00</D_5004></C_C516></S_MOA></G_SG52>
  <G_SG52><S_TAX><D_5283>7</D_5283><C_C241><D_5153>VAT</D_5153></C_C241><C_C243><D_5278>9.5</D_5278></C_C243><D_5305>S</D_5305></S_TAX>
   <S_MOA><C_C516><D_5025>125</D_5025><D_5004>20.00</D_5004></C_C516></S_MOA><S_MOA><C_C516><D_5025>124</D_5025><D_5004>1.90</D_5004></C_C516></S_MOA></G_SG52>
  <G_SG52><S_TAX><D_5283>7</D_5283><C_C241><D_5153>OTH</D_5153></C_C241></S_TAX><S_MOA><C_C516><D_5025>124</D_5025><D_5004>5.00</D_5004></C_C516></S_MOA></G_SG52>
 </M_INVOIC>
</Invoice>`;

t('e-SLOG 2.0: number, dates, parties, payment details, totals, VAT breakdown, items', () => {
  assert.strictEqual(E.detect(ESLOG), 'eslog');
  const r = E.read(ESLOG);
  assert.strictEqual(r.format, 'e-SLOG 2.0');
  assert.strictEqual(r.docType, 'invoice');
  assert.strictEqual(r.number, 'R-2026-77');
  assert.strictEqual(r.issueDate, '2026-09-30');
  assert.strictEqual(r.dueDate, '2026-10-15', 'due date is in SG8 (PAT), qualifier 13');
  assert.strictEqual(r.serviceDate, '2026-09-29', 'the empty DTM 35 is skipped');
  assert.deepStrictEqual([r.periodFrom, r.periodTo], ['2026-09-01', '2026-09-30']);
  assert.strictEqual(r.seller.name, 'Lipa Net d.o.o.');
  assert.strictEqual(r.seller.vatId, 'SI00000035');
  assert.strictEqual(r.seller.email, 'racuni@lipa.example.si');
  assert.strictEqual(r.buyer.name, 'Clearfigure d.o.o.');
  assert.strictEqual(r.buyer.vatId, 'SI00000019', 'spaces removed from the VAT ID');
  assert.strictEqual(r.iban, 'SI56191000000123438', 'the seller\'s RB account, not the buyer\'s BB');
  assert.strictEqual(r.bic, 'DBSISI2X');
  assert.strictEqual(r.reference, 'SI12 2026-77');
  assert.strictEqual(r.poNumber, 'NAR-12');
  assert.strictEqual(r.currency, 'EUR');
  assert.deepStrictEqual([r.net, r.vat, r.total, r.prepaid, r.payable], [120, 23.9, 143.9, 43.9, 100]);
  assert.deepStrictEqual(r.vatBreakdown.map((b) => [b.rate, b.base, b.vat]), [[22, 100, 22], [9.5, 20, 1.9]], 'only VAT groups, not OTH');
  assert.strictEqual(r.vatRate, null, 'two rates: no single rate');
  assert.deepStrictEqual(r.items.map((i) => [i.name, i.qty, i.unit, i.net]), [['Internet 1000 Mbit/s', 1, 'C62', 100], ['Priročnik', 2, 'H87', 20]]);
  assert.deepStrictEqual(r.warnings, []);
  assert.ok(r.notes.includes('Hvala za zaupanje'));
  assert.ok(r.lines.some((l) => /R-2026-77/.test(l)) && r.lines.some((l) => /SI56191000000123438/.test(l)), 'readable lines for search');
});
t('e-SLOG 2.0: a credit note (381) and arithmetic warnings', () => {
  const credit = ESLOG.replace('<D_1001>380</D_1001>', '<D_1001>381</D_1001>');
  assert.strictEqual(E.read(credit).docType, 'credit');
  const broken = ESLOG.replace('<D_5004>143.90</D_5004>', '<D_5004>150.00</D_5004>');
  const r = E.read(broken);
  assert.ok(r.warnings.some((w) => /not the total/.test(w)));
});
t('e-SLOG 2.0: missing totals are filled from the breakdown', () => {
  const x = ESLOG.replace(/<G_SG50>[\s\S]*?<\/G_SG50>/g, '');
  const r = E.read(x);
  assert.deepStrictEqual([r.net, r.vat, r.total], [120, 23.9, 143.9]);
});

// ── UBL / PEPPOL ───────────────────────────────────────────────────────────
const UBL = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
 <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0</cbc:CustomizationID>
 <cbc:ID>HR-123/1/1</cbc:ID><cbc:IssueDate>2026-10-01</cbc:IssueDate><cbc:DueDate>2026-10-31</cbc:DueDate>
 <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode><cbc:Note>Prijenos porezne obveze</cbc:Note><cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
 <cac:InvoicePeriod><cbc:StartDate>2026-09-01</cbc:StartDate><cbc:EndDate>2026-09-30</cbc:EndDate></cac:InvoicePeriod>
 <cac:OrderReference><cbc:ID>PO-9</cbc:ID></cac:OrderReference>
 <cac:AdditionalDocumentReference><cbc:ID>racun.pdf</cbc:ID><cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="application/pdf" filename="racun.pdf">JVBERi0xLjQK
JSVFT0YK</cbc:EmbeddedDocumentBinaryObject></cac:Attachment></cac:AdditionalDocumentReference>
 <cac:AccountingSupplierParty><cac:Party><cac:PartyName><cbc:Name>Oblak</cbc:Name></cac:PartyName>
  <cac:PostalAddress><cbc:StreetName>Ilica 100</cbc:StreetName><cbc:CityName>Zagreb</cbc:CityName><cbc:PostalZone>10000</cbc:PostalZone><cac:Country><cbc:IdentificationCode>HR</cbc:IdentificationCode></cac:Country></cac:PostalAddress>
  <cac:PartyTaxScheme><cbc:CompanyID>HR00000000043</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>
  <cac:PartyLegalEntity><cbc:RegistrationName>Oblak Tehnologije d.o.o.</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party></cac:AccountingSupplierParty>
 <cac:AccountingCustomerParty><cac:Party><cac:PartyName><cbc:Name>Clearfigure</cbc:Name></cac:PartyName>
  <cac:PartyTaxScheme><cbc:CompanyID>SI00000019</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>
  <cac:PartyLegalEntity><cbc:RegistrationName>Clearfigure d.o.o.</cbc:RegistrationName></cac:PartyLegalEntity><cac:Contact><cbc:ElectronicMail>nabava@example.si</cbc:ElectronicMail></cac:Contact></cac:Party></cac:AccountingCustomerParty>
 <cac:PaymentMeans><cbc:PaymentMeansCode>30</cbc:PaymentMeansCode><cbc:PaymentID>HR00 123-1-1</cbc:PaymentID><cac:PayeeFinancialAccount><cbc:ID>HR1723600001101234565</cbc:ID><cac:FinancialInstitutionBranch><cbc:ID>ZABAHR2X</cbc:ID></cac:FinancialInstitutionBranch></cac:PayeeFinancialAccount></cac:PaymentMeans>
 <cac:TaxTotal><cbc:TaxAmount currencyID="HRK">0.00</cbc:TaxAmount></cac:TaxTotal>
 <cac:TaxTotal><cbc:TaxAmount currencyID="EUR">0.00</cbc:TaxAmount><cac:TaxSubtotal><cbc:TaxableAmount currencyID="EUR">171.00</cbc:TaxableAmount><cbc:TaxAmount currencyID="EUR">0.00</cbc:TaxAmount><cac:TaxCategory><cbc:ID>AE</cbc:ID><cbc:Percent>0</cbc:Percent><cbc:TaxExemptionReason>Reverse charge</cbc:TaxExemptionReason><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal></cac:TaxTotal>
 <cac:LegalMonetaryTotal><cbc:LineExtensionAmount currencyID="EUR">171.00</cbc:LineExtensionAmount><cbc:TaxExclusiveAmount currencyID="EUR">171.00</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount currencyID="EUR">171.00</cbc:TaxInclusiveAmount><cbc:PayableAmount currencyID="EUR">171.00</cbc:PayableAmount></cac:LegalMonetaryTotal>
 <cac:InvoiceLine><cbc:ID>1</cbc:ID><cbc:InvoicedQuantity unitCode="MON">1</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="EUR">171.00</cbc:LineExtensionAmount><cac:Item><cbc:Name>Cloud hosting</cbc:Name></cac:Item><cac:Price><cbc:PriceAmount currencyID="EUR">171.00</cbc:PriceAmount></cac:Price></cac:InvoiceLine>
</Invoice>`;

t('UBL / PEPPOL BIS 3: fields, reverse charge, the TaxTotal in the document currency, attachment', () => {
  assert.strictEqual(E.detect(UBL), 'ubl');
  const r = E.read(UBL);
  assert.strictEqual(r.format, 'PEPPOL BIS 3');
  assert.strictEqual(r.number, 'HR-123/1/1');
  assert.deepStrictEqual([r.issueDate, r.dueDate, r.serviceDate], ['2026-10-01', '2026-10-31', '2026-09-30']);
  assert.strictEqual(r.seller.name, 'Oblak Tehnologije d.o.o.', 'the registration name before the trading name');
  assert.strictEqual(r.seller.vatId, 'HR00000000043');
  assert.strictEqual(r.buyer.email, 'nabava@example.si');
  assert.deepStrictEqual([r.iban, r.bic, r.reference, r.poNumber], ['HR1723600001101234565', 'ZABAHR2X', 'HR00 123-1-1', 'PO-9']);
  assert.deepStrictEqual([r.net, r.vat, r.total, r.payable], [171, 0, 171, 171]);
  assert.strictEqual(r.vatBreakdown.length, 1);
  assert.strictEqual(r.reverseCharge, true);
  assert.strictEqual(r.vatRate, 0);
  assert.deepStrictEqual(r.items, [{ name: 'Cloud hosting', qty: 1, unit: 'MON', net: 171 }]);
  assert.strictEqual(r.attachments.length, 1);
  const a = E.attachment(UBL, r.attachments[0].index);
  assert.strictEqual(a.mime, 'application/pdf');
  assert.strictEqual(Buffer.from(a.bytes).toString('latin1'), '%PDF-1.4\n%%EOF\n', 'base64 with a line break inside');
});
t('UBL credit note: CreditNote root, CreditNoteLine, due date from PaymentMeans', () => {
  const d = { number: 'CN-1', credit: true, issueDate: '2026-10-02', dueDate: '2026-10-20', seller: { name: 'A d.o.o.', street: 's', postCode: '1000', city: 'LJ', vatId: 'SI00000094', iban: 'SI56191000000123438' }, buyer: { name: 'B d.o.o.', street: 's', postCode: '1000', city: 'LJ' }, reference: 'SI00 1', items: [{ name: 'Popust', qty: 1, price: 10, rate: 22 }] };
  const r = E.read(E.buildUbl(d));
  assert.strictEqual(r.docType, 'credit');
  assert.strictEqual(r.dueDate, '2026-10-20');
  assert.deepStrictEqual([r.net, r.vat, r.total], [10, 2.2, 12.2]);
  assert.strictEqual(r.items[0].name, 'Popust');
});
t('writers round-trip: e-SLOG and UBL built from the same data read back the same', () => {
  const d = { number: 'X/9', issueDate: '2026-08-31', dueDate: '2026-09-15', serviceDate: '2026-08-31', seller: { name: 'Prodajalec & sin d.o.o.', street: 'Cesta <1>', postCode: '1000', city: 'Ljubljana', vatId: 'SI00000094', iban: 'SI56191000000123438', bic: 'DBSISI2X' }, buyer: { name: 'Kupec d.o.o.', street: 'Ulica', postCode: '2000', city: 'Maribor', vatId: 'SI00000019' }, reference: 'SI00 9', poNumber: 'P1', items: [{ name: 'A', qty: 3, price: 33.33, rate: 22 }, { name: 'B', qty: 1, price: 5, rate: 9.5 }] };
  for (const xml of [E.buildEslog(d), E.buildUbl(d)]) {
    const r = E.read(xml);
    assert.deepStrictEqual([r.number, r.issueDate, r.dueDate, r.seller.name, r.seller.street, r.iban, r.reference, r.poNumber], ['X/9', '2026-08-31', '2026-09-15', 'Prodajalec & sin d.o.o.', 'Cesta <1>', 'SI56191000000123438', 'SI00 9', 'P1']);
    assert.deepStrictEqual([r.net, r.vat, r.total], [104.99, 22.48, 127.47]);
    assert.deepStrictEqual(r.warnings, []);
  }
});
t('not an e-invoice: a clear error', () => {
  assert.strictEqual(E.detect('<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"/>'), null);
  assert.throws(() => E.read('<Order><ID>1</ID></Order>'), /not an e-SLOG 2.0 or UBL/);
});

// ── parser: Billing's own PDFs (quick win 11) ──────────────────────────────
// the lines pdf.js reads from a PDF made by Billing (billing/pdf.js), Slovenian and English
const BILLING_SL = ['Lipa svetovanje d.o.o.   RAČUN', 'Cesta 1', '1000 Ljubljana   2026-0042', 'ID za DDV: SI00000001', 'Matična številka: 1234567000   Številka 2026-0042', 'info@example.si · +386 1 000 00 00', 'Datum izdaje 30. 09. 2026', 'Obdobje opravljanja storitev 01. 09. 2026 – 30. 09. 2026', 'Rok plačila 15. 10. 2026', 'Sklic SI00 2026-0042', 'KUPEC', 'Clearfigure d.o.o.', 'Ulica 2', '2000 Maribor', 'ID za DDV: SI00000002', 'Opis Količina EM Cena brez DDV Popust DDV Znesek brez DDV', 'Svetovanje september 10 h 80,00 22 % 800,00', 'Osnova 22 % 800,00 €', 'DDV 22 % 176,00 €', 'Skupaj brez DDV 800,00 €', 'Skupaj DDV 176,00 €', 'Za plačilo 976,00 €', 'PLAČILO', 'Prosimo, plačajte na transakcijski račun:', 'IBAN SI56 1910 0000 0123 438 BIC DBSISI2X', 'Banka: Banka d.d.', 'Sklic: SI00 2026-0042', 'Za plačilo:976,00 € · Rok plačila:15. 10. 2026', 'UPN QR', 'Lipa svetovanje d.o.o. · Cesta 1, 1000 Ljubljana · ID za DDV SI00000001 · Matična številka 1234567000 1/1'];
const BILLING_EN = ['Lipa svetovanje d.o.o.   INVOICE', 'Cesta 1', '1000 Ljubljana   2026-0042', 'VAT ID: SI00000001', 'Registration no.: 1234567000   Number 2026-0042', 'Issue date 30. 09. 2026', 'Due date 15. 10. 2026', 'Payment reference SI00 2026-0042', 'BILL TO', 'Clearfigure d.o.o.', 'Description Qty Unit Unit price excl.   Discount VAT Amount excl. VAT', 'Consulting September 10 h 80,00 22 % 800,00', 'Total excl. VAT 800,00 €', 'Total VAT 176,00 €', 'Amount due 976,00 €', 'Please pay by bank transfer to:', 'IBAN SI56 1910 0000 0123 438 BIC DBSISI2X', 'Payment reference: SI00 2026-0042'];
const CO = [{ id: 'stratum', name: 'Clearfigure d.o.o.', variants: [], vatId: 'SI00000002', keywords: [] }];

t('parser: the number after "Številka" / "Number" on Billing PDFs, never the registration number', () => {
  const sl = P.parseInvoice(BILLING_SL, { ownNames: ['Clearfigure'], companies: CO });
  assert.strictEqual(sl.number, '2026-0042');
  assert.strictEqual(sl.confidence.number, 'high');
  const en = P.parseInvoice(BILLING_EN, { ownNames: ['Clearfigure'], companies: CO });
  assert.strictEqual(en.number, '2026-0042');
  assert.deepStrictEqual([sl.total, sl.vat, sl.net, sl.dueDate, sl.billedTo], [976, 176, 800, '2026-10-15', 'stratum']);
  // label and number in separate columns
  assert.strictEqual(P.parseInvoice(['ACME d.o.o.   RAČUN', 'Številka        PP-2026-2207', 'Za plačilo 10,00 €'], {}).number, 'PP-2026-2207');
  // "Davčna številka 12345678" / "Matična številka" alone are no invoice numbers
  assert.strictEqual(P.parseInvoice(['ACME d.o.o.', 'Davčna številka 12345678', 'Matična številka: 1234567000', 'Skupaj 10,00 €'], {}).number, '');
});
t('parser: "transakcijski račun" no longer files invoices under Bank & fees', () => {
  assert.notStrictEqual(P.parseInvoice(BILLING_SL, { companies: CO }).category, 'Bank & fees');
  assert.notStrictEqual(P.guessCategory('Mizarstvo Hrast', 'Izdelava omare\nProsimo, plačajte na transakcijski račun\nTRR: SI56 …\nbančni račun', null), 'Bank & fees');
  // a real bank statement of fees still is
  assert.strictEqual(P.guessCategory('', 'Vodenje računa september\nProvizija za transakcije', null), 'Bank & fees');
  assert.strictEqual(P.guessCategory('', 'Bančna provizija za plačilni promet', null), 'Bank & fees');
});

// ── samples ────────────────────────────────────────────────────────────────
t('samples: dated from today, fictional, files that read back to the same amounts', () => {
  const list = S.build('2026-10-15');
  assert.ok(list.length >= 15);
  for (const o of list) {
    const inv = o.inv;
    assert.strictEqual(inv.sample, true);
    assert.ok(/^sample-/.test(inv.id));
    assert.ok(!/adrial|vallis|alensa/i.test(JSON.stringify(inv)));
    assert.ok(!inv.iban || /^[A-Z]{2}00/.test(inv.iban), 'sample IBANs have check digits 00: ' + inv.iban);
    assert.ok(inv.issueDate <= '2026-10-15' && inv.issueDate >= '2026-03-01');
    if (o.ext === 'xml') {
      const r = E.read(Buffer.from(o.bytes).toString('utf8'));
      assert.strictEqual(Math.abs(r.total), Math.abs(inv.total), inv.number);
      assert.strictEqual(r.number, inv.number);
    } else {
      const pdf = Buffer.from(o.bytes).toString('latin1');
      assert.ok(pdf.startsWith('%PDF-1.4') && pdf.trimEnd().endsWith('%%EOF'));
      const xref = +pdf.match(/startxref\n(\d+)/)[1];
      assert.strictEqual(pdf.slice(xref, xref + 4), 'xref', 'xref offset is right');
      const p = P.parseInvoice(inv.text.split('\n'), { ownNames: ['Clearfigure'] });
      assert.strictEqual(p.total, inv.total, inv.number);
      assert.strictEqual(p.number, inv.number);
    }
  }
  const states = list.map((o) => (o.inv.approval || {}).status || '-');
  assert.ok(states.includes('pending') && states.includes('approved') && states.includes('rejected'));
  assert.ok(list.some((o) => o.inv.docType === 'credit' && o.inv.total < 0));
  assert.ok(list.some((o) => o.inv.status === 'review'));
});

console.log(n + ' tests passed');
