// Tests for site/invoices/bankfiles.js: SEPA pay-run file (pain.001.001.03), bank statements (camt.053, CSV) and
// matching payments to invoices. Run: node tools/tests/invoices-bank.test.js
'use strict';
const assert = require('assert');
const path = require('path');
const B = require(path.join(__dirname, '../../site/invoices/bankfiles.js'));
const E = require(path.join(__dirname, '../../site/invoices/einvoice.js'));
const S = require(path.join(__dirname, '../../site/invoices/samples.js'));

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok', n, name); }

// valid check digits (ISO 13616 / ISO 11649 examples and a computed Slovenian one)
const IBAN_SI = 'SI56191000000123438';
const IBAN_HR = 'HR1723600001101234565';
const IBAN_DE = 'DE89370400440532013000';

// ── checks ─────────────────────────────────────────────────────────────────
t('IBAN, BIC and references', () => {
  assert.ok(B.ibanValid(IBAN_SI) && B.ibanValid('si56 1910 0000 0123 438') && B.ibanValid(IBAN_HR) && B.ibanValid(IBAN_DE));
  assert.ok(!B.ibanValid('SI56191000000123439'), 'wrong check digits');
  assert.ok(!B.ibanValid('SI5619100000012343'), 'wrong length for SI');
  assert.ok(!B.ibanValid('SI00191000000123438'), 'the samples\' 00 check digits are not valid');
  assert.ok(B.bicValid('LJBASI2X') && B.bicValid('dbsisi2xxxx') && !B.bicValid('LJBA SI') && !B.bicValid('1JBASI2X'));
  assert.deepStrictEqual(B.referenceInfo('RF18 5390 0754 7034'), { kind: 'rf', value: 'RF18539007547034', ok: true });
  assert.strictEqual(B.referenceInfo('RF19539007547034').ok, false);
  assert.strictEqual(B.referenceInfo('SI12 2026-0042').ok, true);
  assert.strictEqual(B.referenceInfo('SI00 2026-0042').model, '00');
  assert.strictEqual(B.referenceInfo('SI13 12345').ok, false, 'model 13 does not exist');
  assert.strictEqual(B.referenceInfo('SI12 1-2-3-4').ok, false, 'at most two hyphens');
  assert.strictEqual(B.referenceInfo('SI99').ok, true, 'model 99: no reference');
  assert.strictEqual(B.referenceInfo('Račun 77').kind, 'text');
  assert.strictEqual(B.referenceInfo('  ').kind, 'none');
});
t('SEPA character set: Slovenian and Croatian letters, & and symbols', () => {
  assert.strictEqual(B.sepaText('Računovodstvo Žaba & Đurić d.o.o. <test> “x”'), 'Racunovodstvo Zaba + Duric d.o.o. test x');
  assert.strictEqual(B.sepaText('ŠČŽ šćž', 4), 'SCZ');
});
t('one payment: what stops it, what only warns', () => {
  const ok = { amount: 10, currency: 'EUR', creditor: { name: 'A', iban: IBAN_SI }, reference: 'SI12 1' };
  assert.deepStrictEqual(B.validatePayment(ok).errors, []);
  const e = (p) => B.validatePayment(Object.assign({}, ok, p)).errors.join(' | ');
  assert.match(e({ creditor: { name: 'A', iban: '' } }), /No IBAN/);
  assert.match(e({ creditor: { name: 'A', iban: 'SI56191000000123439' } }), /not valid/);
  assert.match(e({ creditor: { name: 'A', iban: 'US64SVBKUS6S3300958879' } }), /not valid|outside SEPA/);
  assert.match(e({ creditor: { name: '', iban: IBAN_SI } }), /No vendor name/);
  assert.match(e({ creditor: { name: 'A', iban: IBAN_SI, bic: 'XX' } }), /BIC/);
  assert.match(e({ currency: 'USD' }), /EUR only/);
  assert.match(e({ amount: 0 }), /Nothing to pay/);
  assert.match(e({ amount: 10.005 }), /2 decimals/);
  assert.match(e({ reference: 'RF19539007547034' }), /RF check digits/);
  assert.match(B.validatePayment(Object.assign({}, ok, { reference: '' })).warnings.join(), /No payment reference/);
  // demo accounts (check digits 00) only with the sample option
  const sample = Object.assign({}, ok, { creditor: { name: 'A', iban: 'SI00191000000123438' } });
  assert.match(B.validatePayment(sample).errors.join(), /not valid/);
  assert.deepStrictEqual(B.validatePayment(sample, { sampleIban: true }).errors, []);
});

// ── pain.001.001.03 ────────────────────────────────────────────────────────
const RUN = {
  msgId: 'INV20261015120000ABCD', createdAt: '2026-10-15T12:00:00.000Z', execDate: '2026-10-16',
  debtor: { name: 'Clearfigure d.o.o.', iban: IBAN_SI, bic: 'DBSISI2X' },
  payments: [
    { id: 'a', amount: 976, currency: 'EUR', creditor: { name: 'Lipa svetovanje d.o.o.', iban: IBAN_SI, bic: 'DBSISI2X' }, reference: 'SI00 2026-0042', remittance: 'Racun 2026-0042', endToEnd: '2026-0042' },
    { id: 'b', amount: 171, currency: 'EUR', creditor: { name: 'Oblak Tehnologije d.o.o.', iban: IBAN_HR }, reference: 'RF18 5390 0754 7034', endToEnd: 'OT-1' },
    { id: 'c', amount: 12.5, currency: 'EUR', creditor: { name: 'Müller & Söhne GmbH', iban: IBAN_DE }, reference: '', remittance: 'Rechnung 4711', endToEnd: '' }
  ]
};
t('pain.001: group header, one SEPA payment block, sums, debtor', () => {
  const r = B.buildPain001(RUN);
  assert.strictEqual(r.ok, true, JSON.stringify(r.errors));
  assert.strictEqual(r.count, 3);
  assert.strictEqual(r.total, 1159.5);
  const doc = E.parseXml(r.xml);
  assert.strictEqual(doc.name, 'Document');
  assert.match(r.xml, /xmlns="urn:iso:std:iso:20022:tech:xsd:pain\.001\.001\.03"/);
  const g = E.at(doc, 'CstmrCdtTrfInitn/GrpHdr');
  assert.strictEqual(E.txt(g, 'MsgId'), 'INV20261015120000ABCD');
  assert.strictEqual(E.txt(g, 'CreDtTm'), '2026-10-15T12:00:00');
  assert.strictEqual(E.txt(g, 'NbOfTxs'), '3');
  assert.strictEqual(E.txt(g, 'CtrlSum'), '1159.50');
  const pi = E.at(doc, 'CstmrCdtTrfInitn/PmtInf');
  assert.strictEqual(E.txt(pi, 'PmtMtd'), 'TRF');
  assert.strictEqual(E.txt(pi, 'PmtTpInf/SvcLvl/Cd'), 'SEPA');
  assert.strictEqual(E.txt(pi, 'ReqdExctnDt'), '2026-10-16');
  assert.strictEqual(E.txt(pi, 'DbtrAcct/Id/IBAN'), IBAN_SI);
  assert.strictEqual(E.txt(pi, 'DbtrAgt/FinInstnId/BIC'), 'DBSISI2X');
  assert.strictEqual(E.txt(pi, 'ChrgBr'), 'SLEV');
  // element order inside PmtInf follows the schema sequence
  const order = pi.children.map((c) => c.name);
  assert.deepStrictEqual(order.slice(0, 12), ['PmtInfId', 'PmtMtd', 'BtchBookg', 'NbOfTxs', 'CtrlSum', 'PmtTpInf', 'ReqdExctnDt', 'Dbtr', 'DbtrAcct', 'DbtrAgt', 'ChrgBr', 'CdtTrfTxInf']);
});
t('pain.001: each transfer — amount, creditor, account, structured or unstructured remittance', () => {
  const doc = E.parseXml(B.buildPain001(RUN).xml);
  const tx = E.all(doc, 'CstmrCdtTrfInitn/PmtInf/CdtTrfTxInf');
  assert.strictEqual(tx.length, 3);
  const [a, b, c] = tx;
  assert.strictEqual(E.txt(a, 'PmtId/EndToEndId'), '2026-0042');
  assert.strictEqual(E.txt(a, 'Amt/InstdAmt'), '976.00');
  assert.strictEqual(E.at(a, 'Amt/InstdAmt').attrs.Ccy, 'EUR');
  assert.strictEqual(E.txt(a, 'CdtrAgt/FinInstnId/BIC'), 'DBSISI2X');
  assert.strictEqual(E.txt(a, 'Cdtr/Nm'), 'Lipa svetovanje d.o.o.');
  assert.strictEqual(E.txt(a, 'Purp/Cd'), 'SUPP');
  assert.strictEqual(E.txt(a, 'RmtInf/Strd/CdtrRefInf/Ref'), 'SI002026-0042');
  assert.strictEqual(E.txt(a, 'RmtInf/Strd/CdtrRefInf/Tp/CdOrPrtry/Cd'), 'SCOR');
  assert.strictEqual(E.at(a, 'RmtInf/Ustrd'), null, 'never both structured and unstructured');
  assert.strictEqual(E.at(b, 'CdtrAgt'), null, 'no BIC: no creditor agent (IBAN-only, EEA)');
  assert.strictEqual(E.txt(b, 'RmtInf/Strd/CdtrRefInf/Ref'), 'RF18539007547034');
  assert.strictEqual(E.txt(c, 'PmtId/EndToEndId'), 'NOTPROVIDED');
  assert.strictEqual(E.txt(c, 'Cdtr/Nm'), 'Muller + Sohne GmbH', 'SEPA Latin characters');
  assert.strictEqual(E.txt(c, 'RmtInf/Ustrd'), 'Rechnung 4711');
  assert.ok(E.all(doc, 'CstmrCdtTrfInitn/PmtInf/CdtTrfTxInf/PmtId/InstrId').every((x, i, all) => all.findIndex((y) => y.text === x.text) === i), 'unique InstrId');
});
t('pain.001: refuses a file with any error and says which payment', () => {
  const bad = JSON.parse(JSON.stringify(RUN));
  bad.payments[1].creditor.iban = 'HR1723600001101234566';
  bad.debtor.iban = '';
  bad.execDate = '';
  const r = B.buildPain001(bad);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.xml, '');
  assert.deepStrictEqual(r.errors.map((e) => e.id), ['debtor', 'b']);
  assert.match(r.errors[0].messages.join(), /IBAN/);
  assert.match(r.errors[0].messages.join(), /payment date/);
  assert.strictEqual(B.buildPain001(Object.assign({}, RUN, { payments: [] })).ok, false);
});
t('pain.001: XML special characters are escaped and long names cut to 70', () => {
  const r = B.buildPain001(Object.assign({}, RUN, { payments: [{ id: 'x', amount: 1, currency: 'EUR', creditor: { name: "O'Neil (EU) " + 'x'.repeat(100), iban: IBAN_DE }, reference: '', remittance: 'a<b>' }] }));
  const doc = E.parseXml(r.xml);
  const nm = E.txt(doc, 'CstmrCdtTrfInitn/PmtInf/CdtTrfTxInf/Cdtr/Nm');
  assert.ok(nm.startsWith("O'Neil (EU) x") && nm.length === 70);
  assert.strictEqual(E.txt(doc, 'CstmrCdtTrfInitn/PmtInf/CdtTrfTxInf/RmtInf/Ustrd'), 'a b');
});

// ── camt.053 ───────────────────────────────────────────────────────────────
const CAMT = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08"><BkToCstmrStmt><GrpHdr><MsgId>S1</MsgId></GrpHdr>
<Stmt><Id>1</Id><Acct><Id><IBAN>${IBAN_SI}</IBAN></Id></Acct>
 <Ntry><Amt Ccy="EUR">976.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts><Cd>BOOK</Cd></Sts><BookgDt><Dt>2026-10-16</Dt></BookgDt><AcctSvcrRef>B1</AcctSvcrRef>
  <NtryDtls><TxDtls><Refs><EndToEndId>2026-0042</EndToEndId></Refs><RltdPties><Cdtr><Pty><Nm>Lipa svetovanje d.o.o.</Nm></Pty></Cdtr><CdtrAcct><Id><IBAN>${IBAN_SI}</IBAN></Id></CdtrAcct></RltdPties>
  <RmtInf><Strd><CdtrRefInf><Ref>SI00 2026-0042</Ref></CdtrRefInf></Strd></RmtInf></TxDtls></NtryDtls></Ntry>
 <Ntry><Amt Ccy="EUR">183.50</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><DtTm>2026-10-16T10:00:00</DtTm></BookgDt><AcctSvcrRef>B2</AcctSvcrRef>
  <NtryDtls>
   <TxDtls><Refs><EndToEndId>NOTPROVIDED</EndToEndId></Refs><AmtDtls><TxAmt><Amt Ccy="EUR">171.00</Amt></TxAmt></AmtDtls><RltdPties><Cdtr><Nm>Oblak Tehnologije</Nm></Cdtr><CdtrAcct><Id><IBAN>${IBAN_HR}</IBAN></Id></CdtrAcct></RltdPties><RmtInf><Ustrd>RF18 5390 0754 7034</Ustrd></RmtInf></TxDtls>
   <TxDtls><AmtDtls><TxAmt><Amt Ccy="EUR">12.50</Amt></TxAmt></AmtDtls><RltdPties><Cdtr><Nm>Muller</Nm></Cdtr></RltdPties><RmtInf><Ustrd>Rechnung 4711</Ustrd></RmtInf></TxDtls>
  </NtryDtls></Ntry>
 <Ntry><Amt Ccy="EUR">2440.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-10-16</Dt></BookgDt><NtryDtls><TxDtls><RltdPties><Dbtr><Nm>Kupec</Nm></Dbtr></RltdPties></TxDtls></NtryDtls></Ntry>
 <Ntry><Amt Ccy="EUR">99.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>PDNG</Sts><BookgDt><Dt>2026-10-17</Dt></BookgDt></Ntry>
</Stmt></BkToCstmrStmt></Document>`;

t('camt.053: entries, batch details, directions, pending skipped', () => {
  const r = B.parseCamt(CAMT);
  assert.strictEqual(r.account, IBAN_SI);
  assert.strictEqual(r.transactions.length, 4, 'one + a batch of two + one incoming; pending is left out');
  const [a, b, c, d] = r.transactions;
  assert.deepStrictEqual([a.date, a.amount, a.direction, a.reference, a.endToEnd, a.name, a.iban], ['2026-10-16', 976, 'out', 'SI002026-0042', '2026-0042', 'Lipa svetovanje d.o.o.', IBAN_SI]);
  assert.deepStrictEqual([b.amount, b.endToEnd, b.text, b.id], [171, '', 'RF18 5390 0754 7034', 'B2/1']);
  assert.deepStrictEqual([c.amount, c.name, c.id], [12.5, 'Muller', 'B2/2']);
  assert.deepStrictEqual([d.direction, d.amount], ['in', 2440]);
  assert.throws(() => B.parseCamt('<Document><Other/></Document>'), /not a camt/);
});

// ── CSV ────────────────────────────────────────────────────────────────────
t('CSV: Slovenian bank export with debit/credit columns, quotes and decimal commas', () => {
  const csv = '﻿Izpisek št. 12;;;;;;\n' +
    'Datum knjiženja;Naziv prejemnika/plačnika;Račun prejemnika/plačnika;Znesek v breme;Znesek v dobro;Sklic prejemnika;Namen\n' +
    '16.10.2026;"Lipa svetovanje d.o.o.";SI56 1910 0000 0123 438;976,00;;SI00 2026-0042;Plačilo računa\n' +
    '16.10.2026;Kupec d.o.o.;;;"2.440,00";;"Račun 2026-0050; hvala"\n' +
    '17.10.2026;Pisarna;SI56191000000123438;"1.234,56";;;Toner\n';
  const r = B.parseBankCsv(csv);
  assert.strictEqual(r.transactions.length, 3);
  const [a, b, c] = r.transactions;
  assert.deepStrictEqual([a.date, a.amount, a.direction, a.name, a.iban, a.reference, a.text], ['2026-10-16', 976, 'out', 'Lipa svetovanje d.o.o.', IBAN_SI, 'SI002026-0042', 'Plačilo računa']);
  assert.deepStrictEqual([b.direction, b.amount, b.text], ['in', 2440, 'Račun 2026-0050; hvala']);
  assert.strictEqual(c.amount, 1234.56);
});
t('CSV: one signed amount column, English headers, comma separated', () => {
  const csv = 'Booking date,Counterparty,IBAN,Amount,Reference,Description\n2026-10-16,Oblak,HR1723600001101234565,-171.00,RF18539007547034,hosting\n2026-10-16,Client,,2440.00,,payment\n';
  const r = B.parseBankCsv(csv);
  assert.deepStrictEqual(r.transactions.map((x) => [x.direction, x.amount]), [['out', 171], ['in', 2440]]);
  assert.throws(() => B.parseBankCsv('a;b\n1;2\n'), /no header/);
  assert.strictEqual(B.amountOf('(12,00)'), -12);
  assert.strictEqual(B.amountOf('1.234,5'), 1234.5);
  assert.strictEqual(B.amountOf('1,234.50'), 1234.5);
  assert.strictEqual(B.amountOf('−5,00 €'), -5);
});

// ── matching ───────────────────────────────────────────────────────────────
const OPEN = [
  { id: 'i1', vendor: 'Lipa svetovanje', number: '2026-0042', reference: 'SI00 2026-0042', iban: IBAN_SI, open: 976 },
  { id: 'i2', vendor: 'Oblak Tehnologije', number: 'OT-1', reference: 'RF18539007547034', iban: IBAN_HR, open: 171 },
  { id: 'i3', vendor: 'Pisarna Plus', number: 'PP-7', reference: '', iban: 'SI56020100000000019', open: 50 },
  { id: 'i4', vendor: 'Tiskarna Grafit', number: 'TG-1', reference: '', iban: '', open: 80 },
  { id: 'i5', vendor: 'Avtoservis', number: 'S-1', reference: '', iban: '', open: 80 },
  { id: 'i6', vendor: 'Energija', number: 'E-9', reference: 'SI12 9-2026', iban: '', open: 100, endToEnd: 'E-9' },
  { id: 'i7', vendor: 'Hrast', number: 'H-2026-77', reference: '', iban: '', open: 300 }
];
const tx = (o) => Object.assign({ id: 'x', date: '2026-10-16', amount: 0, direction: 'out', reference: '', endToEnd: '', name: '', iban: '', text: '' }, o);

t('matching: reference + amount, end-to-end id, IBAN, name, number in text', () => {
  const r = B.matchPayments([
    tx({ id: 't1', amount: 976, reference: 'SI002026-0042' }),
    tx({ id: 't2', amount: 171, text: 'RF18 5390 0754 7034 hosting' }),
    tx({ id: 't3', amount: 50, iban: 'SI56 0201 0000 0000 019' }),
    tx({ id: 't6', amount: 100, endToEnd: 'E-9' }),
    tx({ id: 't7', amount: 300, text: 'placilo H-2026-77' })
  ], OPEN);
  const by = Object.fromEntries(r.matches.map((m) => [m.tx.id, [m.invoiceId, m.level]]));
  assert.deepStrictEqual(by, { t1: ['i1', 'exact'], t2: ['i2', 'exact'], t3: ['i3', 'likely'], t6: ['i6', 'exact'], t7: ['i7', 'likely'] });
  assert.strictEqual(r.unmatched.length, 0);
});
t('matching: a part payment by reference, ambiguous amounts left alone, incoming ignored, each invoice once', () => {
  const r = B.matchPayments([
    tx({ id: 'p', amount: 400, reference: 'SI002026-0042' }),
    tx({ id: 'amb', amount: 80 }),
    tx({ id: 'name', amount: 80, name: 'GRAFIT TISKARNA D.O.O.' }),
    tx({ id: 'in', amount: 976, reference: 'SI002026-0042', direction: 'in' }),
    tx({ id: 'dup', amount: 171, reference: 'RF18539007547034' }),
    tx({ id: 'dup2', amount: 171, reference: 'RF18539007547034', date: '2026-10-17' })
  ], OPEN);
  const by = Object.fromEntries(r.matches.map((m) => [m.tx.id, [m.invoiceId, m.level]]));
  assert.deepStrictEqual(by.p, ['i1', 'reference']);
  assert.deepStrictEqual(by.name, ['i4', 'likely']);
  assert.strictEqual(by.amb, undefined, 'two open invoices of 80 € and nothing else: no guess');
  assert.deepStrictEqual(by.dup, ['i2', 'exact']);
  assert.strictEqual(by.dup2, undefined, 'the same invoice is not paid twice');
  assert.strictEqual(r.incoming, 1);
  assert.deepStrictEqual(r.unmatched.map((x) => x.id).sort(), ['amb', 'dup2']);
});
t('matching: a unique amount alone is only a suggestion to check', () => {
  const r = B.matchPayments([tx({ id: 'u', amount: 300 })], OPEN);
  assert.deepStrictEqual(r.matches.map((m) => [m.invoiceId, m.level]), [['i7', 'possible']]);
});

// ── end to end with the demo data ─────────────────────────────────────────
t('demo: pay run of the approved samples → sample statement → every payment matched exactly', () => {
  const today = '2026-10-15';
  const invs = S.build(today).map((o) => o.inv);
  const run = invs.filter((x) => !x.paid && x.total > 0 && x.approval && x.approval.status === 'approved');
  assert.ok(run.length >= 3);
  const pays = run.map((x) => ({ id: x.id, amount: x.total, currency: 'EUR', creditor: { name: x.detectedVendor, iban: x.iban, bic: x.bic }, reference: x.reference, endToEnd: x.number }));
  const pain = B.buildPain001({ execDate: today, debtor: { name: 'Clearfigure d.o.o.', iban: 'SI00020100000000019' }, payments: pays }, { sampleIban: true });
  assert.strictEqual(pain.ok, true, JSON.stringify(pain.errors));
  assert.strictEqual(B.buildPain001({ execDate: today, debtor: { name: 'Clearfigure d.o.o.', iban: 'SI00020100000000019' }, payments: pays }).ok, false, 'never with sample accounts outside the demo');
  run.forEach((x) => { x.payRun = { id: 'r', date: today, endToEnd: x.number }; });
  const st = B.parseCamt(S.statement(invs, today));
  const open = invs.filter((x) => !x.paid && x.total > 0).map((x) => ({ id: x.id, vendor: x.vendor, number: x.number, reference: x.reference, iban: x.iban, open: x.total, endToEnd: x.payRun ? x.payRun.endToEnd : '' }));
  const m = B.matchPayments(st.transactions, open);
  assert.deepStrictEqual(m.matches.map((x) => x.invoiceId).sort(), run.map((x) => x.id).sort());
  assert.ok(m.matches.every((x) => x.level === 'exact'));
});

console.log(n + ' tests passed');
