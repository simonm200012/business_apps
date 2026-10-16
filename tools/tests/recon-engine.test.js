// Tests for site/recon/engine.js. Run: node tools/tests/recon-engine.test.js
'use strict';
const assert = require('assert');
const path = require('path');
const E = require(path.join(__dirname, '../../site/recon/engine.js'));

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok', n, name); }

// ── rules ──────────────────────────────────────────────────────────────────
t('default rules give the scores the app always used', () => {
  const R = E.normRules(null);
  // 40 base + 35 e-mail + 15 name + (10 − days)
  assert.deepStrictEqual(E.scoreOf(R, { email: true, name: true, days: 0 }), { score: 100, ok: true });
  assert.strictEqual(E.scoreOf(R, { email: true, name: false, days: 2 }).score, 83);
  assert.strictEqual(E.scoreOf(R, { email: false, name: true, days: 14 }).score, 55);
  assert.strictEqual(E.scoreOf(R, { email: false, name: true, days: 14 }).ok, true, 'the lowest old suggestion is still shown');
  assert.strictEqual(E.scoreOf(R, { email: false, name: false, days: 0 }).ok, false, 'no customer match → no suggestion');
  assert.strictEqual(E.isDefaultRules({}), true);
  assert.deepStrictEqual(E.normRules({}).windows.cod, [1, 14]);
});
t('rules are clamped and tunable', () => {
  const R = E.normRules({ email: 500, name: -3, minScore: 80, amountTol: 200, windows: { bank: [30, 2] }, needCustomer: false });
  assert.strictEqual(R.email, 100); assert.strictEqual(R.name, 0); assert.deepStrictEqual(R.windows.bank, [2, 30]);
  assert.strictEqual(E.scoreOf(R, { email: false, name: false, days: 0 }).score, 50);
  assert.strictEqual(E.scoreOf(R, { email: false, name: false, days: 0 }).ok, false, 'below min score 80');
  const T = E.normRules({ amountTol: 200 });
  assert.strictEqual(E.scoreOf(T, { email: true, days: 0, amountDiff: 150 }).score, 85 - 2, '2 started euros of difference cost 2 points');
  assert.strictEqual(E.scoreOf(T, { email: true, days: 0, amountDiff: 250 }).ok, false, 'outside the amount tolerance');
  assert.strictEqual(E.inWindow(R, 'bank', 1), false);
  assert.strictEqual(E.inWindow(R, 'bank', 30), true);
  assert.strictEqual(E.isDefaultRules(R), false);
});

// ── parsing ────────────────────────────────────────────────────────────────
t('amounts in Slovenian and English styles', () => {
  const cases = { '1.234,50': 123450, '1234,5': 123450, '-12.30': -1230, '1,234.50': 123450, '(12,00)': -1200, '12,00 €': 1200, '−5,00': -500, '1.234.567': 123456700, '1,234': 123400, '0,99': 99, '15-': -1500, '': null, 'abc': null, 'EUR 3.20': 320 };
  Object.keys(cases).forEach(k => assert.strictEqual(E.parseAmount(k), cases[k], k));
  assert.strictEqual(E.parseAmount(12.345), 1235);
});
t('dates', () => {
  assert.strictEqual(E.parseDate('15.10.2026'), '2026-10-15');
  assert.strictEqual(E.parseDate('5. 1. 2026'), '2026-01-05');
  assert.strictEqual(E.parseDate('2026-10-15T08:00:00+02:00'), '2026-10-15');
  assert.strictEqual(E.parseDate('15/10/2026'), '2026-10-15');
  assert.strictEqual(E.parseDate('20261015'), '2026-10-15');
  assert.strictEqual(E.parseDate('31.02.2026'), '');
  assert.strictEqual(E.parseDate('yesterday'), '');
});
t('CSV with quotes, semicolons, BOM and empty lines', () => {
  const rows = E.parseCsv('﻿Datum;Znesek;Opis\n15.10.2026;"1.234,50";"Plačilo ""SI00 300123"""\n\n16.10.2026;-10,00;x\n');
  assert.deepStrictEqual(rows, [['Datum', 'Znesek', 'Opis'], ['15.10.2026', '1.234,50', 'Plačilo "SI00 300123"'], ['16.10.2026', '-10,00', 'x']]);
  assert.strictEqual(E.detectDelim('a,b,c\n1,2,3'), ',');
  assert.strictEqual(E.detectDelim('a\tb\tc'), '\t');
});

// ── camt.053 ───────────────────────────────────────────────────────────────
const CAMT = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">
 <BkToCstmrStmt><GrpHdr><MsgId>M1</MsgId><CreDtTm>2026-10-15T07:00:00</CreDtTm></GrpHdr>
  <Stmt><Id>STMT-2026-10-14</Id><ElctrncSeqNb>201</ElctrncSeqNb>
   <FrToDt><FrDtTm>2026-10-14T00:00:00</FrDtTm><ToDtTm>2026-10-14T23:59:59</ToDtTm></FrToDt>
   <Acct><Id><IBAN>SI56 0000 0000 0000 000</IBAN></Id><Ccy>EUR</Ccy></Acct>
   <Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">1000.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-10-14</Dt></Dt></Bal>
   <Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">1105.40</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-10-14</Dt></Dt></Bal>
   <Ntry><Amt Ccy="EUR">129.90</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-10-14</Dt></BookgDt><ValDt><Dt>2026-10-14</Dt></ValDt><AcctSvcrRef>BANK-REF-1</AcctSvcrRef>
    <BkTxCd><Domn><Cd>PMNT</Cd><Fmly><Cd>RCDT</Cd><SubFmlyCd>ESCT</SubFmlyCd></Fmly></Domn></BkTxCd>
    <NtryDtls><TxDtls><Refs><EndToEndId>NOTPROVIDED</EndToEndId></Refs>
     <RltdPties><Dbtr><Nm>NOVAK ANA</Nm></Dbtr><DbtrAcct><Id><IBAN>SI56000000000000000</IBAN></Id></DbtrAcct></RltdPties>
     <RmtInf><Strd><CdtrRefInf><Ref>SI00 301234</Ref></CdtrRefInf></Strd><Ustrd>Pla&#269;ilo naro&#269;ila &amp; dostave</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
   <Ntry><Amt Ccy="EUR">24.50</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-10-14</Dt></BookgDt>
    <NtryDtls><TxDtls><RltdPties><Cdtr><Nm>BANKA PROVIZIJA</Nm></Cdtr></RltdPties><RmtInf><Ustrd>Nadomestilo</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
  </Stmt></BkToCstmrStmt></Document>`;
t('camt.053: statement, balances, credit and debit entries, references, entities', () => {
  const r = E.parseCamt053(CAMT);
  assert.strictEqual(r.ok, true, r.error);
  const s = r.statements[0];
  assert.strictEqual(s.iban, 'SI56000000000000000');
  assert.strictEqual(s.from, '2026-10-14');
  assert.strictEqual(s.opening, 100000); assert.strictEqual(s.closing, 110540);
  assert.strictEqual(s.entries.length, 2);
  const a = s.entries[0], b = s.entries[1];
  assert.strictEqual(a.amount, 12990); assert.strictEqual(a.counterparty, 'NOVAK ANA'); assert.strictEqual(a.ref, 'SI00 301234');
  assert.strictEqual(a.text, 'Plačilo naročila & dostave'); assert.strictEqual(a.e2e, ''); assert.strictEqual(a.key, 'camt:SI56000000000000000:BANK-REF-1');
  assert.strictEqual(a.bankTxCode, 'PMNT/RCDT/ESCT');
  assert.strictEqual(b.amount, -2450); assert.strictEqual(b.counterparty, 'BANKA PROVIZIJA');
  assert.strictEqual(E.camtTies(s), true);
  // keys are stable: parsing twice gives the same keys (re-imports are skipped)
  assert.deepStrictEqual(E.parseCamt053(CAMT).statements[0].entries.map(e => e.key), s.entries.map(e => e.key));
});
t('camt.053 with a namespace prefix, and files that are not camt', () => {
  const pref = CAMT.replace(/<(\/?)(?!\?)([A-Za-z])/g, '<$1c:$2').replace('<c:Document xmlns=', '<c:Document xmlns:c=');
  const r = E.parseCamt053(pref);
  assert.strictEqual(r.ok, true); assert.strictEqual(r.statements[0].entries[0].amount, 12990);
  assert.strictEqual(E.parseCamt053('<Document><BkToCstmrNtfctn/></Document>').ok, false);
  assert.strictEqual(E.parseCamt053('Datum;Znesek').ok, false);
});

// ── provider CSV ───────────────────────────────────────────────────────────
t('provider CSV: mapping guess, types, fees from net, duplicates and errors', () => {
  const rows = E.parseCsv('Date,Type,Gross,Fee,Net,Currency,Merchant Reference,Shopper Email,PSP Reference\n' +
    '14/10/2026,Settled,129.90,1.54,128.36,EUR,SI-301234,ana.novak@example.com,P1\n' +
    '14/10/2026,Refunded,-20.00,0.11,-20.11,EUR,SI-301000,ana.novak@example.com,P2\n' +
    '14/10/2026,Settled,50.00,,49.00,EUR,SI-301001,x@example.com,P3\n' +
    '14/10/2026,Settled,10.00,0,10,CHF,SI-1,y@example.com,P4\n' +
    'bad,Settled,10.00,0,10,EUR,SI-2,y@example.com,P5\n');
  const map = E.guessMapping(rows[0]);
  assert.strictEqual(map.date, '0'); assert.strictEqual(map.type, '1'); assert.strictEqual(map.gross, '2'); assert.strictEqual(map.fee, '3');
  assert.strictEqual(map.net, '4'); assert.strictEqual(map.currency, '5'); assert.strictEqual(map.ref, '6'); assert.strictEqual(map.email, '7'); assert.strictEqual(map.id, '8');
  const r = E.buildProviderImport(rows.slice(1), map, { provider: 'adyen', account: 'adyen', existing: { 'csv:adyen:P2': 1 } });
  assert.strictEqual(r.txns.length, 2);
  assert.deepStrictEqual([r.txns[0].type, r.txns[0].gross, r.txns[0].fee, r.txns[0].ref], ['capture', 12990, 154, 'SI-301234']);
  assert.strictEqual(r.txns[1].fee, 100, 'fee = gross − net when the fee column is empty');
  assert.strictEqual(r.skipped, 1, 'P2 was imported before');
  assert.strictEqual(r.errors.length, 2);
  assert.ok(/CHF/.test(r.errors[0].msg)); assert.ok(/date/.test(r.errors[1].msg));
  assert.strictEqual(E.typeOf('Chargeback', 100), 'chargeback');
  assert.strictEqual(E.typeOf('', -100), 'refund');
  assert.strictEqual(E.typeOf('Vračilo', 100), 'refund');
});
t('Slovenian column names are guessed too', () => {
  const m = E.guessMapping(['Datum plačila', 'Znesek', 'Provizija', 'Sklic', 'Kupec', 'Vrsta']);
  assert.deepStrictEqual([m.date, m.gross, m.fee, m.ref, m.payer, m.type], ['0', '1', '2', '3', '4', '5']);
});

// ── journal ────────────────────────────────────────────────────────────────
t('journal documents always balance and use the configured accounts', () => {
  const J = E.journal([
    { kind: 'payout', date: '2026-09-03', amount: 98500, fee: 1500, provider: 'Adyen', ref: 'batch_1' },
    { kind: 'payout', date: '2026-09-03', amount: -2000, fee: 1500, provider: 'Adyen', ref: 'batch_2' },
    { kind: 'capture', date: '2026-09-01', amount: 60000, provider: 'Adyen' },
    { kind: 'capture', date: '2026-09-01', amount: 40000, provider: 'Adyen', customerAbroad: true },
    { kind: 'refund', date: '2026-09-02', amount: 5000, provider: 'Adyen' },
    { kind: 'transfer', date: '2026-09-02', amount: 12990 },
    { kind: 'unmatched', date: '2026-09-02', amount: 777, provider: 'Monri' },
    { kind: 'unmatched_bank', date: '2026-09-02', amount: -300 },
    { kind: 'writeoff_loss', date: '2026-09-04', amount: 2 },
    { kind: 'writeoff_gain', date: '2026-09-04', amount: 1, customerAbroad: true },
    { kind: 'capture', date: '2026-09-05', amount: 0, provider: 'Adyen' }
  ], { fees: '4150', bank: 'x y' });
  assert.strictEqual(J.accounts.fees, '4150'); assert.strictEqual(J.accounts.bank, '110', 'an invalid code falls back');
  assert.strictEqual(J.docs.length, 8);
  const ub = J.docs.find(d => d.kind === 'unmatched_bank');
  assert.deepStrictEqual(ub.lines.map(l => [l.konto, l.debit, l.credit]), [['110', 0, 300], ['230', 300, 0]], 'a negative amount swaps the sides');
  J.docs.forEach(d => { assert.strictEqual(d.debit, d.credit, d.no + ' balances'); d.lines.forEach(l => assert.ok(l.debit >= 0 && l.credit >= 0 && (l.debit === 0 || l.credit === 0))); });
  const pay = J.docs.find(d => d.kind === 'payout');
  assert.deepStrictEqual(pay.lines.map(l => [l.konto, l.debit, l.credit]), [['110', 98500, 0], ['4150', 1500, 0], ['109', 0, 100000], ['110', 0, 2000], ['4150', 1500, 0], ['109', 500, 0]]);
  const cap = J.docs.find(d => d.kind === 'capture');
  assert.deepStrictEqual(cap.lines.map(l => [l.konto, l.debit, l.credit]), [['109', 100000, 0], ['120', 0, 60000], ['121', 0, 40000]]);
  assert.deepStrictEqual(J.docs.map(d => d.no), ['RC-2026-09-0001', 'RC-2026-09-0002', 'RC-2026-09-0003', 'RC-2026-09-0004', 'RC-2026-09-0005', 'RC-2026-09-0006', 'RC-2026-09-0007', 'RC-2026-09-0008']);
  assert.ok(/· 2 postavki$/.test(cap.lines[0].opis), cap.lines[0].opis);
  const rows = E.journalRows(J);
  assert.deepStrictEqual(rows[0].slice(0, 3), ['01.09.2026', 'RC-2026-09-0001', '109']);
  assert.strictEqual(rows[0][5], '1000.00');
  assert.strictEqual(E.JOURNAL_HEADER.length, rows[0].length);
});

// ── month close ────────────────────────────────────────────────────────────
t('fingerprint differences and digest', () => {
  const a = { T1: 'k1|exact', T2: '', 'X:no_order:T9': 'open' }, b = { T1: 'k1|exact', T2: 'k2|manual', 'X:no_order:T9': 'resolved', T3: '' };
  const d = E.fingerprintDiff(a, b);
  assert.deepStrictEqual(d.map(x => x.key), ['T2', 'T3', 'X:no_order:T9']);
  assert.deepStrictEqual(d[0], { key: 'T2', before: '', after: 'k2|manual' });
  assert.strictEqual(d[1].before, null);
  assert.strictEqual(E.fingerprintDiff(a, Object.assign({}, a)).length, 0);
  assert.strictEqual(E.hashFp(a), E.hashFp({ 'X:no_order:T9': 'open', T2: '', T1: 'k1|exact' }), 'order does not matter');
  assert.notStrictEqual(E.hashFp(a), E.hashFp(b));
  assert.ok(/^[0-9a-f]{8}$/.test(E.hashFp({})));
});

console.log('\n' + n + ' recon engine tests passed');
