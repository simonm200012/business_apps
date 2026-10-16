// Tests for site/collections/bank.js (camt.053 and bank CSV reading, payment matching, the Croatian payment report)
// and the open-items import presets in engine.js. Run: node tools/tests/collections-bank.test.js
'use strict';
const assert = require('assert');
const path = require('path');
const E = require(path.join(__dirname, '../../site/collections/engine.js'));
const B = require(path.join(__dirname, '../../site/collections/bank.js'));

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok', n, name); }
const TODAY = '2026-10-15';

// a small document: three customers, open invoices, one already partly paid
function demoDb() {
  const cust = (id, name, extra) => Object.assign({ id, no: id, name, country: 'SI', vatId: '', address: {}, contact: {}, interest: {}, terms: 30, creditLimit: 0 }, extra || {});
  const inv = (id, no, customerId, dueDate, amount, payments, extra) => Object.assign({ id, no, customerId, issueDate: E.addDays(dueDate, -30), dueDate, amount, payments: payments || [], disputed: null, writtenOff: null }, extra || {});
  return {
    customers: [cust('c1', 'Lumen Gradnje d.o.o.'), cust('c2', 'Vzorec Energija d.o.o.', { bankAccounts: ['SI56 0400 0000 0000 123'] }), cust('c3', 'Primjer Grijanje d.o.o.', { country: 'HR', vatId: 'HR00000000001' }), cust('c4', 'Hiša Mojstrov d.o.o.')],
    invoices: [
      inv('i1', '2026-001234', 'c1', '2026-09-30', 1200),
      inv('i2', '2026-001250', 'c1', '2026-10-10', 800),
      inv('i3', '2026-001300', 'c2', '2026-09-20', 1500.5, [{ date: '2026-09-25', amount: 500 }]),
      inv('i4', '2026-001301', 'c2', '2026-10-01', 640),
      inv('i5', '2026-000777', 'c3', '2026-08-31', 2450, [], { issueDate: '2026-08-01' }),
      inv('i6', '2026-001400', 'c4', '2026-10-05', 333.33),
      inv('i7', '2026-001401', 'c4', '2026-10-20', 99.9, [], { disputed: { reason: 'damaged', since: '2026-10-01' } })
    ],
    actions: [], plans: []
  };
}

const CAMT = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
 <BkToCstmrStmt>
  <GrpHdr><MsgId>STMT-2026-10-14</MsgId><CreDtTm>2026-10-15T06:00:00</CreDtTm></GrpHdr>
  <Stmt>
   <Id>2026-287</Id><CreDtTm>2026-10-15T06:00:00</CreDtTm>
   <FrToDt><FrDtTm>2026-10-14T00:00:00</FrDtTm><ToDtTm>2026-10-14T23:59:59</ToDtTm></FrToDt>
   <Acct><Id><IBAN>SI56990000123456721</IBAN></Id><Ccy>EUR</Ccy></Acct>
   <!-- 1: the reference names invoice 2026-001234, full amount -->
   <Ntry><NtryRef>1</NtryRef><Amt Ccy="EUR">1200.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts>
    <BookgDt><Dt>2026-10-14</Dt></BookgDt><ValDt><Dt>2026-10-14</Dt></ValDt><AcctSvcrRef>BK-0001</AcctSvcrRef>
    <NtryDtls><TxDtls><Refs><EndToEndId>NOTPROVIDED</EndToEndId></Refs>
     <RltdPties><Dbtr><Nm>LUMEN GRADNJE D.O.O.</Nm></Dbtr><DbtrAcct><Id><IBAN>SI56 0201 0000 1111 222</IBAN></Id></DbtrAcct></RltdPties>
     <RmtInf><Strd><CdtrRefInf><Tp><CdOrPrtry><Cd>SCOR</Cd></CdOrPrtry></Tp><Ref>SI00 2026-001234</Ref></CdtrRefInf></Strd></RmtInf>
    </TxDtls></NtryDtls></Ntry>
   <!-- 2: a batch of two payments in one entry; the second names the invoice in the text only -->
   <Ntry><Amt Ccy="EUR">1440.50</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-10-14</Dt></BookgDt><AcctSvcrRef>BK-0002</AcctSvcrRef>
    <NtryDtls>
     <TxDtls><AmtDtls><TxAmt><Amt Ccy="EUR">1000.50</Amt></TxAmt></AmtDtls><RltdPties><Dbtr><Nm>Vzorec Energija d.o.o.</Nm></Dbtr></RltdPties>
      <RmtInf><Strd><CdtrRefInf><Ref>SI002026001300</Ref></CdtrRefInf></Strd></RmtInf></TxDtls>
     <TxDtls><AmtDtls><TxAmt><Amt Ccy="EUR">440.00</Amt></TxAmt></AmtDtls><RltdPties><Dbtr><Nm>Neki Drugi Plačnik d.o.o.</Nm></Dbtr></RltdPties>
      <RmtInf><Ustrd>Placilo racuna 2026-001250 delno</Ustrd></RmtInf></TxDtls>
    </NtryDtls></Ntry>
   <!-- 3: no reference, the payer's account is known: amount fits invoice 2026-001301 -->
   <Ntry><Amt Ccy="EUR">640.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts><Cd>BOOK</Cd></Sts><BookgDt><Dt>2026-10-13</Dt></BookgDt><AcctSvcrRef>BK-0003</AcctSvcrRef>
    <NtryDtls><TxDtls><RltdPties><Dbtr><Pty><Nm>VE d.o.o.</Nm></Pty></Dbtr><DbtrAcct><Id><IBAN>SI56040000000000123</IBAN></Id></DbtrAcct></RltdPties></TxDtls></NtryDtls></Ntry>
   <!-- 4: name only, amount fits -->
   <Ntry><Amt Ccy="EUR">333.33</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-10-14</Dt></BookgDt><AcctSvcrRef>BK-0004</AcctSvcrRef>
    <NtryDtls><TxDtls><RltdPties><Dbtr><Nm>HISA MOJSTROV DOO</Nm></Dbtr></RltdPties><RmtInf><Ustrd>placilo</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
   <!-- 5: an outgoing payment -->
   <Ntry><Amt Ccy="EUR">99.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-10-14</Dt></BookgDt><AcctSvcrRef>BK-0005</AcctSvcrRef></Ntry>
   <!-- 6: nothing fits -->
   <Ntry><Amt Ccy="EUR">57.10</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-10-14</Dt></BookgDt><AcctSvcrRef>BK-0006</AcctSvcrRef>
    <NtryDtls><TxDtls><RltdPties><Dbtr><Nm>Janez Novak</Nm></Dbtr></RltdPties><RmtInf><Ustrd>Vracilo &amp; razlika</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
   <!-- 7: a Croatian payer with an HR model reference, more than is open -->
   <Ntry><Amt Ccy="EUR">2500.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-10-14</Dt></BookgDt><AcctSvcrRef>BK-0007</AcctSvcrRef>
    <NtryDtls><TxDtls><RltdPties><Dbtr><Nm>Primjer Grijanje d.o.o.</Nm></Dbtr></RltdPties><RmtInf><Ustrd>Uplata po opomeni, poziv na broj HR00 2026-000777</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
  </Stmt>
 </BkToCstmrStmt>
</Document>`;

t('XML reader: namespaces, attributes, entities, CDATA, comments; broken files are refused', () => {
  const x = B.parseXml('<?xml version="1.0"?><a:Doc xmlns:a="u"><a:B Ccy="EUR">1 &amp; 2 &#x10D;</a:B><!-- c --><C><![CDATA[<x>]]></C><D/></a:Doc>');
  const doc = x.children[0];
  assert.strictEqual(doc.name, 'Doc');
  assert.strictEqual(doc.children[0].attrs.Ccy, 'EUR');
  assert.strictEqual(doc.children[0].text, '1 & 2 č');
  assert.strictEqual(doc.children[1].text, '<x>');
  assert.strictEqual(doc.children[2].name, 'D');
  assert.throws(() => B.parseXml('<a><b></a>'), /not well formed/);
  assert.throws(() => B.parseXml('<a><b>'), /ends before/);
});

t('camt.053: entries, batched transactions, debtor names (old and new schema), references and texts', () => {
  const p = B.parseCamt053(CAMT);
  assert.strictEqual(p.statements.length, 1);
  assert.strictEqual(p.statements[0].iban, 'SI56990000123456721');
  assert.strictEqual(p.statements[0].from, '2026-10-14');
  assert.strictEqual(p.entries.length, 8, 'the batch counts as two payments');
  const [e1, e2a, e2b, e3, , e5, e6] = p.entries;
  assert.deepStrictEqual([e1.date, e1.amount, e1.credit, e1.name, e1.iban, e1.bankRef], ['2026-10-14', 1200, true, 'LUMEN GRADNJE D.O.O.', 'SI56020100001111222', 'BK-0001']);
  assert.deepStrictEqual(e1.refs, ['SI00 2026-001234'], 'NOTPROVIDED end-to-end ids are dropped');
  assert.strictEqual(e2a.amount, 1000.5); assert.strictEqual(e2b.amount, 440);
  assert.strictEqual(e2a.bankRef, 'BK-0002/1'); assert.strictEqual(e2b.bankRef, 'BK-0002/2');
  assert.strictEqual(e2b.text, 'Placilo racuna 2026-001250 delno');
  assert.strictEqual(e3.name, 'VE d.o.o.', 'Dbtr/Pty/Nm (camt.053.001.08)');
  assert.strictEqual(e3.booked, true, 'Sts/Cd BOOK');
  assert.strictEqual(e5.credit, false);
  assert.strictEqual(e6.text, 'Vracilo & razlika');
  assert.ok(p.entries.every((x) => x.id), 'every payment has an id');
  assert.strictEqual(new Set(p.entries.map((x) => x.id)).size, 8);
});

t('camt.053: a camt.054 or an unrelated XML file gets a clear message', () => {
  assert.throws(() => B.parseCamt053('<Document><BkToCstmrDbtCdtNtfctn/></Document>'), /camt\.054/);
  assert.throws(() => B.parseCamt053('<Invoice/>'), /not a camt\.053/);
});

t('references: SI and HR models, RF, bare numbers, references inside text', () => {
  assert.deepStrictEqual(B.refKeys('SI00 2026-001234'), ['2026001234', '2026', '001234']);
  assert.deepStrictEqual(B.refKeys('si002026001234'), ['2026001234']);
  assert.ok(B.refKeys('HR00 2026-000777').indexOf('2026000777') >= 0);
  assert.ok(B.refKeys('SI12 1003-2026-001234').indexOf('2026001234') >= 0, 'customer number + invoice number');
  assert.deepStrictEqual(B.refKeys('RF182026001234'), ['2026001234']);
  assert.deepStrictEqual(B.refKeys('Placilo'), []);
  assert.deepStrictEqual(B.refsInText('Uplata, poziv na broj HR00 2026-000777 hvala'), ['HR002026-000777']);
  assert.deepStrictEqual(B.refsInText('sklic SI00 2026-001234.'), ['SI002026-001234']);
});

t('names: legal forms, case and diacritics do not matter', () => {
  assert.strictEqual(B.nameScore('HISA MOJSTROV DOO', 'Hiša Mojstrov d.o.o.'), 1);
  assert.strictEqual(B.nameScore('LUMEN GRADNJE D.O.O.', 'Lumen Gradnje d.o.o.'), 1);
  assert.ok(B.nameScore('Janez Novak', 'Lumen Gradnje d.o.o.') === 0);
  assert.ok(B.nameScore('Gradnje Krpan d.o.o.', 'Lumen Gradnje d.o.o.') < 0.6, 'one shared word of two is not enough');
});

t('matching: reference, batch, account + amount, name + amount, text-only invoice number, nothing, outgoing', () => {
  const db = demoDb(), p = B.parseCamt053(CAMT), rows = B.matchEntries(p.entries, db, TODAY);
  const [r1, r2a, r2b, r3, r4, r5, r6, r7] = rows;
  // 1: exact by reference
  assert.deepStrictEqual([r1.status, r1.how, r1.level, r1.customerId, r1.selected], ['match', 'reference', 'high', 'c1', true]);
  assert.deepStrictEqual(r1.parts.map((x) => [x.no, x.amount, x.full]), [['2026-001234', 1200, true]]);
  // 2a: reference without hyphens; the rest of the open balance (1000,50 open after the earlier 500)
  assert.strictEqual(r2a.customerId, 'c2');
  assert.deepStrictEqual(r2a.parts.map((x) => [x.no, x.amount]), [['2026-001300', 1000.5]]);
  assert.strictEqual(r2a.rest, 0);
  // 2b: the invoice number in the text; another payer's name gets a note, it is still pre-selected
  assert.deepStrictEqual([r2b.how, r2b.customerId, r2b.selected], ['reference', 'c1', true]);
  assert.deepStrictEqual(r2b.parts.map((x) => [x.no, x.amount, x.full]), [['2026-001250', 440, false]]);
  assert.ok(r2b.notes.some((x) => x.code === 'name'));
  // 3: the account learned earlier + the exact amount
  assert.deepStrictEqual([r3.how, r3.level, r3.customerId], ['account+amount', 'high', 'c2']);
  assert.deepStrictEqual(r3.parts.map((x) => x.no), ['2026-001301'], 'the amount fits the second invoice, not the oldest');
  // 4: the name + the exact amount; the disputed invoice is never used
  assert.deepStrictEqual([r4.how, r4.level, r4.customerId, r4.selected], ['name+amount', 'medium', 'c4', true]);
  assert.deepStrictEqual(r4.parts.map((x) => x.no), ['2026-001400']);
  // 5: outgoing; 6: nothing fits
  assert.strictEqual(r5.status, 'out');
  assert.deepStrictEqual([r6.status, r6.selected, r6.parts.length], ['none', false, 0]);
  // 7: HR model reference, 50 € more than is open: applied up to the open amount, the rest reported
  assert.deepStrictEqual([r7.customerId, r7.rest], ['c3', 50]);
  assert.deepStrictEqual(r7.parts.map((x) => [x.no, x.amount]), [['2026-000777', 2450]]);
  assert.ok(r7.notes.some((x) => x.code === 'rest' && x.amount === 50));
});

t('matching: a payment already recorded from an earlier import is skipped, also inside one file', () => {
  const db = demoDb(), p = B.parseCamt053(CAMT);
  db.invoices[0].payments.push({ date: '2026-10-14', amount: 1200, bankId: p.entries[0].id });
  const rows = B.matchEntries(p.entries.concat([p.entries[3]]), db, TODAY);
  assert.strictEqual(rows[0].status, 'dup');
  assert.strictEqual(rows[8].status, 'dup', 'the same payment twice in one file');
  db.bankSeen = [p.entries[1].id];
  assert.strictEqual(B.matchEntries(p.entries, db, TODAY)[1].status, 'dup', 'ids remembered for payments that went to deleted invoices');
});

t('matching: the amount alone is only a suggestion; foreign currency and pending entries are left out', () => {
  const db = demoDb();
  const e = (o) => Object.assign({ id: 'x' + Math.random(), date: '2026-10-14', amount: 0, currency: 'EUR', credit: true, reversal: false, booked: true, name: '', iban: '', refs: [], text: '' }, o);
  const rows = B.matchEntries([e({ amount: 640 }), e({ amount: 640, currency: 'USD' }), e({ amount: 640, booked: false }), e({ amount: 800, name: 'Lumen Gradnje' })], db, TODAY);
  assert.deepStrictEqual([rows[0].status, rows[0].how, rows[0].level, rows[0].selected], ['match', 'amount', 'low', false]);
  assert.strictEqual(rows[1].status, 'currency');
  assert.strictEqual(rows[2].status, 'pending');
  // name + amount that matches the second invoice exactly
  assert.deepStrictEqual(rows[3].parts.map((x) => x.no), ['2026-001250']);
});

t('matching: a payment by name alone goes to the oldest invoices and is not pre-selected', () => {
  const db = demoDb();
  const rows = B.matchEntries([{ id: 'y', date: '2026-10-14', amount: 1500, currency: 'EUR', credit: true, reversal: false, booked: true, name: 'Lumen Gradnje d.o.o.', iban: '', refs: [], text: '' }], db, TODAY);
  assert.deepStrictEqual([rows[0].how, rows[0].level, rows[0].selected], ['name', 'low', false]);
  assert.deepStrictEqual(rows[0].parts.map((x) => [x.no, x.amount]), [['2026-001234', 1200], ['2026-001250', 300]]);
});

t('reassign: choosing another customer re-allocates the payment, oldest first', () => {
  const db = demoDb(), p = B.parseCamt053(CAMT), rows = B.matchEntries(p.entries, db, TODAY);
  const r = B.reassign(rows[6], 'c2', db, TODAY);
  assert.deepStrictEqual([r.status, r.how, r.customerId, r.selected], ['match', 'manual', 'c2', true]);
  assert.deepStrictEqual(r.parts.map((x) => [x.no, x.amount]), [['2026-001300', 57.1]]);
  B.reassign(r, '', db, TODAY);
  assert.deepStrictEqual([r.status, r.parts.length, r.selected], ['none', 0, false]);
});

t('bank CSV: credit/debit columns, Slovenian numbers and dates, column guesses', () => {
  const csv = 'Datum knjiženja;Naziv plačnika;IBAN plačnika;Sklic;Namen;V breme;V dobro\n14.10.2026;Lumen Gradnje d.o.o.;SI56 0201 0000 1111 222;SI00 2026-001234;Plačilo;;1.200,00\n14.10.2026;Elektro d.o.o.;;;Najemnina;350,00;\n;;;;Skupaj;350,00;1.200,00\n';
  const rows = E.parseCsv(csv).rows, map = E.guessMapping(rows[0], B.BANK_FIELDS);
  assert.strictEqual(map.date, 0); assert.strictEqual(map.name, 1); assert.strictEqual(map.iban, 2); assert.strictEqual(map.reference, 3);
  assert.strictEqual(map.text, 4); assert.strictEqual(map.debit, 5); assert.strictEqual(map.credit, 6);
  const p = B.parseBankCsv(rows, map);
  assert.deepStrictEqual(p.errors, []);
  assert.strictEqual(p.entries.length, 2, 'the sum line is skipped');
  assert.deepStrictEqual([p.entries[0].amount, p.entries[0].credit, p.entries[0].refs[0]], [1200, true, 'SI00 2026-001234']);
  assert.deepStrictEqual([p.entries[1].amount, p.entries[1].credit], [350, false]);
  const m = B.matchEntries(p.entries, demoDb(), TODAY);
  assert.deepStrictEqual([m[0].customerId, m[0].how, m[1].status], ['c1', 'reference', 'out']);
  // one signed amount column, and a missing date column
  const p2 = B.parseBankCsv([['Datum', 'Znesek'], ['2026-10-14', '-12,50'], ['2026-10-14', '99,90']], { date: 0, amount: 1 });
  assert.deepStrictEqual(p2.entries.map((x) => [x.amount, x.credit]), [[12.5, false], [99.9, true]]);
  assert.ok(B.parseBankCsv([['a']], { date: -1, amount: -1 }).errors.length === 2);
});

t('Croatian payment report: only Croatian customers, e-invoices from 2026, payments of the month, the 20th deadline', () => {
  const db = demoDb();
  db.company = { vatId: 'HR00000000001', name: 'Test d.o.o.' };
  db.invoices[4].payments = [{ date: '2026-09-30', amount: 100 }, { date: '2026-10-02', amount: 200 }, { date: '2026-10-02', amount: 50 }, { date: '2026-10-31', amount: 1000 }];
  db.invoices.push({ id: 'old', no: '2025-000100', customerId: 'c3', issueDate: '2025-12-20', dueDate: '2026-01-20', amount: 500, payments: [{ date: '2026-10-05', amount: 500 }] });
  const r = B.hrPaymentReport(db, '2026-10');
  assert.strictEqual(r.deadline, '2026-11-20');
  assert.deepStrictEqual(r.rows.map((x) => [x.no, x.payDate, x.amount]), [['2026-000777', '2026-10-02', 250], ['2026-000777', '2026-10-31', 1000]], 'payments on one day are added up; 2025 invoices and other months are left out');
  assert.strictEqual(r.total, 1250);
  assert.strictEqual(r.issuerOib, '00000000001'); assert.strictEqual(r.issuerOk, true);
  const csv = B.hrPaymentCsv(r).replace(/^﻿/, '').split('\r\n');
  assert.strictEqual(csv[0], 'Broj eRačuna;Datum izdavanja;OIB izdavatelja;OIB primatelja;Naziv primatelja;Datum naplate;Naplaćeni iznos;Način plaćanja;Valuta;Iznos računa');
  assert.strictEqual(csv[1], '2026-000777;01.08.2026;00000000001;00000000001;Primjer Grijanje d.o.o.;02.10.2026;250,00;T;EUR;2450,00');
  assert.strictEqual(B.hrPaymentReport(db, '2026-12').deadline, '2027-01-20');
});

// ── open-items import presets (engine.js) ────────────────────────────────
t('presets: a Minimax export is recognised and mapped; lines of one document are added up', () => {
  const csv = 'Stranka;Davčna številka;Številka dokumenta;Datum dokumenta;Datum zapadlosti;Znesek;Odprto\n' +
    'Lumen Gradnje d.o.o.;SI12345679;2026-000101;1. 9. 2026;1. 10. 2026;1.000,00;1.000,00\n' +
    'Lumen Gradnje d.o.o.;SI12345679;2026-000101;1. 9. 2026;1. 10. 2026;-200,00;-200,00\n' +
    'Vzorec Energija d.o.o.;;2026-000102;5. 9. 2026;5. 10. 2026;500,00;0,00\n';
  const rows = E.parseCsv(csv).rows, pr = E.detectPreset(rows[0]);
  assert.strictEqual(pr && pr.id, 'minimax');
  const map = E.guessMapping(rows[0], null, pr);
  assert.deepStrictEqual([map.customer, map.vatId, map.no, map.issueDate, map.dueDate, map.amount, map.open, map.debit, map.credit], [0, 1, 2, 3, 4, 5, 6, -1, -1]);
  const res = E.buildImport(rows, map, { today: TODAY, aggregate: pr.aggregate });
  assert.deepStrictEqual(res.errors, []);
  assert.deepStrictEqual(res.items.map((x) => [x.no, x.amount, x.open]), [['2026-000101', 1000, 800]], 'the credit note lowers the open amount; the paid invoice is skipped');
  assert.ok(res.warnings.some((w) => /2 lines added up/.test(w.msg)));
  assert.ok(res.warnings.some((w) => /fully paid/.test(w.msg)));
});

t('presets: a Pantheon ledger export (Debet / Kredit, "Valuta" is the due date) gives one invoice per document', () => {
  const csv = 'Partner;ID za DDV;Dokument;Datum dok.;Valuta;Debet;Kredit;Saldo\n' +
    'Primjer Grijanje d.o.o.;HR00000000001;2026-000500;01.09.2026;01.10.2026;2.450,00;0,00;2.450,00\n' +
    'Primjer Grijanje d.o.o.;HR00000000001;2026-000500;20.09.2026;20.09.2026;0,00;450,00;2.000,00\n' +
    'Hiša Mojstrov d.o.o.;SI12345679;2026-000501;03.09.2026;03.10.2026;100,00;100,00;0,00\n' +
    'Hiša Mojstrov d.o.o.;SI12345679;2026-000502;04.09.2026;04.10.2026;120,00;;120,00\n';
  const rows = E.parseCsv(csv).rows, pr = E.detectPreset(rows[0]);
  assert.strictEqual(pr && pr.id, 'pantheon');
  const map = E.guessMapping(rows[0], null, pr);
  assert.deepStrictEqual([map.customer, map.vatId, map.no, map.issueDate, map.dueDate, map.debit, map.credit, map.amount], [0, 1, 2, 3, 4, 5, 6, -1]);
  const res = E.buildImport(rows, map, { today: TODAY, aggregate: true });
  assert.deepStrictEqual(res.errors, []);
  assert.deepStrictEqual(res.items.map((x) => [x.no, x.dueDate, x.amount, x.open, x.country]), [['2026-000500', '2026-10-01', 2450, 2000, 'HR'], ['2026-000502', '2026-10-04', 120, 120, 'SI']]);
});

t('presets: the generic import still refuses a duplicated invoice number; files in Windows-1250 are read', () => {
  const rows = [['number', 'customer', 'due_date', 'amount'], ['1', 'A', '2026-10-01', '10'], ['1', 'A', '2026-10-01', '10']];
  const res = E.buildImport(rows, E.guessMapping(rows[0]), { today: TODAY });
  assert.ok(res.errors.some((e) => /appears twice/.test(e.msg)));
  assert.strictEqual(E.detectPreset(rows[0]), null);
  const cp1250 = new Uint8Array([0x8A, 0x74, 0x2E, 0x3B, 0xE8, 0x9A, 0x9E]); // "Št.;čšž" in Windows-1250
  assert.deepStrictEqual(E.decodeBytes(cp1250), { text: 'Št.;čšž', encoding: 'windows-1250' });
  assert.deepStrictEqual(E.decodeBytes(new TextEncoder().encode('Št.;čšž')), { text: 'Št.;čšž', encoding: 'utf-8' });
});

console.log(n + ' tests passed');
