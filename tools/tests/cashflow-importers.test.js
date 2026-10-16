// Tests for site/cashflow/importers.js (open-items CSV, bank statements). Run: node tools/tests/cashflow-importers.test.js
// Every company, IBAN and amount here is made up (IBAN check digits 00, so none is a real account).
'use strict';
const assert = require('assert');
const path = require('path');
const I = require(path.join(__dirname, '../../site/cashflow/importers.js'));

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok', n, name); }

t('numbers: Slovenian, English, signs and currency', () => {
  assert.strictEqual(I.parseNumber('1.234,56'), 1234.56);
  assert.strictEqual(I.parseNumber('1234,56 €'), 1234.56);
  assert.strictEqual(I.parseNumber('1,234.56'), 1234.56);
  assert.strictEqual(I.parseNumber('1.234'), 1234);
  assert.strictEqual(I.parseNumber('-12,50'), -12.5);
  assert.strictEqual(I.parseNumber('12,50-'), -12.5);
  assert.strictEqual(I.parseNumber('(100)'), -100);
  assert.strictEqual(I.parseNumber('EUR 1 234,00'), 1234);
  assert.ok(isNaN(I.parseNumber('abc')));
  assert.ok(isNaN(I.parseNumber('')));
});

t('dates: d. m. yyyy, two-digit years, ISO, with a time', () => {
  assert.strictEqual(I.parseDate('15.10.2026'), '2026-10-15');
  assert.strictEqual(I.parseDate('15. 10. 2026'), '2026-10-15');
  assert.strictEqual(I.parseDate('5.1.2027.'), '2027-01-05');
  assert.strictEqual(I.parseDate('15.10.26'), '2026-10-15');
  assert.strictEqual(I.parseDate('2026-10-15T00:00:00'), '2026-10-15');
  assert.strictEqual(I.parseDate('31.2.2026'), null);
  assert.strictEqual(I.parseDate('soon'), null);
});

t('decoding: UTF-8 with BOM, and Windows-1250 from Slovenian Excel', () => {
  const utf = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from('Št. računa;Kupec\n', 'utf8')]);
  assert.strictEqual(I.decodeBytes(utf), 'Št. računa;Kupec\n');
  // "Št. računa;Kupec" in Windows-1250: Š = 0x8A, č = 0xE8
  const cp = Buffer.from([0x8A, 0x74, 0x2E, 0x20, 0x72, 0x61, 0xE8, 0x75, 0x6E, 0x61, 0x3B, 0x4B, 0x75, 0x70, 0x65, 0x63]);
  assert.strictEqual(I.decodeBytes(cp), 'Št. računa;Kupec');
  assert.strictEqual(I.encodingOf(cp), 'Windows-1250');
  assert.strictEqual(I.encodingOf(utf), 'UTF-8');
});

t('CSV: delimiter, quotes, sep= line, empty rows', () => {
  let p = I.parseCsv('a;b;c\n1;"x;y";3\n\n');
  assert.strictEqual(p.delimiter, ';');
  assert.deepStrictEqual(p.rows, [['a', 'b', 'c'], ['1', 'x;y', '3']]);
  p = I.parseCsv('sep=,\r\na,b\r\n"he said ""hi""",2\r\n');
  assert.deepStrictEqual(p.rows, [['a', 'b'], ['he said "hi"', '2']]);
  p = I.parseCsv('a\tb\n1\t2');
  assert.strictEqual(p.delimiter, '\t');
});

// A Minimax-style open-items export: title rows above the header, Slovenian names, a total line at the end
const MINIMAX = [
  'Nordvik Distribucija d.o.o.;;;;;;',
  'Odprte postavke kupcev na dan 15.10.2026;;;;;;',
  ';;;;;;',
  'Partner;ID za DDV;Dokument;Datum dokumenta;Datum zapadlosti;Znesek;Odprto',
  'Termoplan Savinja d.o.o.;SI00000001;2026-004101;01.09.2026;16.10.2026;12.400,00;12.400,00',
  'Hiša Mojstrov d.o.o.;SI00000002;2026-004102;03.09.2026;18.10.2026;8.000,00;3.000,00',
  'Lumen Gradnje d.o.o.;;2026-004103;05.09.2026;04.11.2026;5.000,00;0,00',
  'Polarka Klima d.o.o.;;2026-004104;06.09.2026;21.10.2026;-1.200,00;-1.200,00',
  'Skupaj;;;;;24.200,00;14.200,00'
].join('\r\n');

t('open items: header row under title rows and Slovenian column names', () => {
  const rows = I.parseCsv(MINIMAX).rows, F = I.FIELDS.ar;
  const hr = I.findHeaderRow(rows, F);
  assert.strictEqual(hr, 3); // the fourth line of the sheet
  const m = I.guessMapping(rows[hr], F);
  assert.strictEqual(m.party, 0); assert.strictEqual(m.vatId, 1); assert.strictEqual(m.no, 2);
  assert.strictEqual(m.issued, 3); assert.strictEqual(m.due, 4); assert.strictEqual(m.amount, 5); assert.strictEqual(m.open, 6);
});

t('open items: open amounts, paid and credit-note rows skipped, totals ignored', () => {
  const rows = I.parseCsv(MINIMAX).rows, F = I.FIELDS.ar, hr = I.findHeaderRow(rows, F);
  const r = I.buildOpenItems(rows, I.guessMapping(rows[hr], F), { kind: 'ar', headerRow: hr, today: '2026-10-15' });
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(r.items.length, 2);
  assert.deepStrictEqual(r.items[1], { line: 6, no: '2026-004102', party: 'Hiša Mojstrov d.o.o.', vatId: 'SI00000002', issued: '2026-09-03', due: '2026-10-18', amount: 3000, gross: 8000 });
  assert.ok(r.warnings.some((w) => /fully paid/.test(w)));
  assert.ok(r.warnings.some((w) => /negative open amount/.test(w)));
  assert.ok(r.warnings.some((w) => /total line/.test(w)));
});

t('open items: a Pantheon-style export with "Subjekt", "Zapadlost" and "Saldo"', () => {
  const csv = 'Subjekt;Št. dokumenta;Datum;Zapadlost;Saldo\nKabelwerk Ostalpen GmbH;RN-4410;1.10.2026;30.10.2026;"1.250,40"\n';
  const rows = I.parseCsv(csv).rows, m = I.guessMapping(rows[0], I.FIELDS.ap);
  assert.deepStrictEqual([m.party, m.no, m.issued, m.due, m.open], [0, 1, 2, 3, 4]);
  const r = I.buildOpenItems(rows, m, { kind: 'ap' });
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(r.items[0].amount, 1250.4);
});

t('open items: the app\'s own template and English headers', () => {
  const rows = I.parseCsv('number;customer;issued;due;amount\n2026-01001;Example Customer d.o.o.;15.9.2026;15.10.2026;1234,56').rows;
  const m = I.guessMapping(rows[0], I.FIELDS.ar), r = I.buildOpenItems(rows, m, { kind: 'ar' });
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(r.items[0].amount, 1234.56);
  assert.strictEqual(r.items[0].due, '2026-10-15');
});

t('open items: validation errors name the row, and block everything', () => {
  const csv = 'Račun;Kupec;Zapadlost;Znesek;Odprto\nA-1;X d.o.o.;31.13.2026;100;100\nA-2;;1.11.2026;abc;\nA-3;Y d.o.o.;1.11.2026;100;150\nA-3;Y d.o.o.;2.11.2026;10;10';
  const rows = I.parseCsv(csv).rows, m = I.guessMapping(rows[0], I.FIELDS.ar);
  const r = I.buildOpenItems(rows, m, { kind: 'ar' });
  assert.ok(r.errors.some((e) => /^Row 2: due date "31.13.2026"/.test(e)), r.errors.join('\n'));
  assert.ok(r.errors.some((e) => /^Row 3: the customer is empty/.test(e)));
  assert.ok(r.errors.some((e) => /^Row 3: amount "abc"/.test(e)));
  assert.ok(r.errors.some((e) => /^Row 4: the open amount is larger/.test(e)));
  assert.ok(r.errors.some((e) => /^Row 5: .*appears twice/.test(e)));
  const none = I.buildOpenItems(rows, { no: 0, party: -1, due: 2, amount: 3, open: -1, vatId: -1, issued: -1 }, { kind: 'ar' });
  assert.ok(none.errors[0].indexOf('Choose the column for "Customer"') === 0);
});

t('company names compare without the legal form, case or accents', () => {
  assert.strictEqual(I.normName('Hiša Mojstrov d.o.o.'), I.normName('HISA MOJSTROV DOO'));
  assert.strictEqual(I.normName('Gradbeni Sistemi Vrh d. d.'), I.normName('Gradbeni sistemi Vrh'));
  assert.notStrictEqual(I.normName('Vrh d.o.o.'), I.normName('Vrhnika d.o.o.'));
});

const CAMT = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">
 <BkToCstmrStmt>
  <GrpHdr><MsgId>STMT-1</MsgId><CreDtTm>2026-10-15T06:00:00</CreDtTm></GrpHdr>
  <Stmt>
   <Id>1</Id>
   <FrToDt><FrDtTm>2026-10-14T00:00:00</FrDtTm><ToDtTm>2026-10-14T23:59:59</ToDtTm></FrToDt>
   <Acct><Id><IBAN>SI00 1234 5678 9012 345</IBAN></Id><Ccy>EUR</Ccy><Ownr><Nm>Nordvik Distribucija d.o.o.</Nm></Ownr></Acct>
   <Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">400000.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-10-14</Dt></Dt></Bal>
   <Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">412345.67</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-10-14</Dt></Dt></Bal>
   <Ntry><Amt Ccy="EUR">12400.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-10-14</Dt></BookgDt>
    <NtryDtls><TxDtls><RltdPties><Dbtr><Nm>Termoplan Savinja d.o.o.</Nm></Dbtr></RltdPties>
     <RmtInf><Strd><CdtrRefInf><Ref>SI00 2026-004101</Ref></CdtrRefInf></Strd></RmtInf></TxDtls></NtryDtls></Ntry>
   <Ntry><Amt Ccy="EUR">54,32</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-10-14</Dt></BookgDt><AddtlNtryInf>Bank fee &amp; charges</AddtlNtryInf></Ntry>
   <Ntry><Amt Ccy="EUR">5000.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-10-14</Dt></BookgDt>
    <NtryDtls><TxDtls><RltdPties><Cdtr><Nm>Radiatorji Vrhnje d.o.o.</Nm></Cdtr></RltdPties><RmtInf><Ustrd>Placilo racuna FA-41234</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
  </Stmt>
  <Stmt>
   <Acct><Id><IBAN>SI00987654321098765</IBAN></Id><Ccy>EUR</Ccy></Acct>
   <Bal><Tp><CdOrPrtry><Cd>PRCD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">1000.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><Dt><Dt>2026-10-13</Dt></Dt></Bal>
   <Ntry><Amt Ccy="EUR">250.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts><Cd>BOOK</Cd></Sts><BookgDt><Dt>2026-10-14</Dt></BookgDt></Ntry>
  </Stmt>
 </BkToCstmrStmt>
</Document>`;

t('XML reader: namespaces, attributes, entities, CDATA, bad nesting', () => {
  const d = I.parseXml('<?xml version="1.0"?><a:Doc xmlns:a="x"><a:B c="1 &amp; 2"><![CDATA[<raw>]]></a:B><!-- note --></a:Doc>');
  assert.strictEqual(d.children[0].name, 'Doc');
  assert.strictEqual(d.children[0].children[0].attrs.c, '1 & 2');
  assert.strictEqual(d.children[0].children[0].text, '<raw>');
  assert.throws(() => I.parseXml('<a><b></a></b>'));
  assert.throws(() => I.parseXml('<a>'));
});

t('camt.053: closing booked balance, the previous balance plus entries, and the entries', () => {
  const r = I.parseCamt(CAMT);
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(r.statements.length, 2);
  const s = r.statements[0];
  assert.strictEqual(s.iban, 'SI0012345678901234' + '5');
  assert.strictEqual(s.balance, 412345.67);
  assert.strictEqual(s.date, '2026-10-14');
  assert.strictEqual(s.balanceType, 'CLBD');
  assert.strictEqual(s.owner, 'Nordvik Distribucija d.o.o.');
  assert.strictEqual(s.entries.length, 2); // "54,32" is not an XML number, so that entry is ignored
  assert.strictEqual(s.entries[0].amount, 12400);
  assert.ok(/SI00 2026-004101/.test(s.entries[0].text));
  assert.strictEqual(s.entries[1].amount, -5000);
  const s2 = r.statements[1];
  assert.strictEqual(s2.balance, -750); // −1.000 (PRCD, debit) + 250 booked
  assert.strictEqual(s2.date, '2026-10-14');
});

t('camt: not a statement, broken XML, foreign currency', () => {
  assert.ok(/not a camt.053/.test(I.parseCamt('<Document><Other/></Document>').errors[0]));
  assert.ok(/not a readable XML/.test(I.parseCamt('<Document><a></Document>').errors[0]));
  const usd = CAMT.replace(/Ccy="EUR">412345.67/, 'Ccy="USD">412345.67');
  assert.ok(I.parseCamt(usd).errors.some((e) => /USD/.test(e)));
});

t('camt: several daily statements of one account give the latest balance', () => {
  const day = (d, bal) => `<Stmt><Acct><Id><IBAN>SI00111122223333444</IBAN></Id></Acct><Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">${bal}</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>${d}</Dt></Dt></Bal></Stmt>`;
  const r = I.parseCamt('<Document><BkToCstmrStmt>' + day('2026-10-14', '200.00') + day('2026-10-12', '100.00') + '</BkToCstmrStmt></Document>');
  assert.strictEqual(r.statements.length, 1);
  assert.strictEqual(r.statements[0].balance, 200);
});

t('bank CSV: balance of the newest row, credits and debits', () => {
  const csv = 'Datum knjiženja;Naziv;Namen;Breme;Dobro;Stanje\n14.10.2026;Termoplan Savinja d.o.o.;SI00 2026-004101;;12.400,00;412.400,00\n14.10.2026;Banka;Provizija;54,33;;412.345,67\n13.10.2026;;;;;400.000,00';
  const rows = I.parseCsv(csv).rows, m = I.guessMapping(rows[0], I.BANK_FIELDS);
  assert.deepStrictEqual([m.date, m.party, m.text, m.debit, m.credit, m.balance], [0, 1, 2, 3, 4, 5]);
  const r = I.buildBankCsv(rows, m, {});
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(r.statement.balance, 412345.67); // the newest day's last transaction, found from the running balance
  assert.strictEqual(r.statement.date, '2026-10-14');
  assert.deepStrictEqual(r.statement.entries.map((e) => e.amount), [12400, -54.33]);
  const bad = I.buildBankCsv(rows, Object.assign({}, m, { balance: -1 }), {});
  assert.ok(/Balance after the transaction/.test(bad.errors[0]));
});

t('payment matching: exact amount and the invoice number in the reference, nothing ambiguous', () => {
  const s = I.parseCamt(CAMT).statements[0];
  const open = [
    { id: 'i1', no: '2026-004101', amount: 12400, kind: 'ar', issued: '2026-09-01' },
    { id: 'i2', no: '2026-004102', amount: 12400, kind: 'ar', issued: '2026-09-01' }, // same amount, other number
    { id: 'b1', no: 'FA-41234', amount: 5000, kind: 'ap', issued: '2026-09-20' },
    { id: 'b2', no: 'FA-41234', amount: 5000, kind: 'ar', issued: '2026-09-20' } // money in, not out
  ];
  const m = I.matchPayments(s.entries, open);
  assert.deepStrictEqual(m.map((x) => x.id).sort(), ['b1', 'i1']);
  // the amount must be exact
  assert.deepStrictEqual(I.matchPayments(s.entries, [{ id: 'i1', no: '2026-004101', amount: 12399, kind: 'ar' }]), []);
  // two open invoices with the same number and amount: left alone
  assert.deepStrictEqual(I.matchPayments(s.entries, [open[0], Object.assign({}, open[0], { id: 'i9' })]), []);
  // short numbers never match by accident
  assert.deepStrictEqual(I.matchPayments([{ booked: true, amount: 50, date: '2026-10-14', text: 'ref 12' }], [{ id: 'x', no: '12', amount: 50, kind: 'ar' }]), []);
});

console.log(n + ' tests passed');
