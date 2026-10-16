// Tests for site/parcels/import.js (carrier COD files, bank CSV, camt.053, matching). Run: node tools/tests/parcels-import.test.js
'use strict';
const assert = require('assert');
const path = require('path');
const I = require(path.join(__dirname, '../../site/parcels/import.js'));

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok', n, name); }

// ── CSV basics ─────────────────────────────────────────────────────────────
t('delimiter: ; with decimal commas, comma with decimal points, tab', () => {
  assert.strictEqual(I.sniffDelimiter('Številka pošiljke;Odkupnina;Znesek\n91234567890;49,90;49,50\n91234567891;12,00;11,90\n'), ';');
  assert.strictEqual(I.sniffDelimiter('Tracking,COD,Amount\n123,49.90,49.50\n124,"1,234.00",1220.00\n'), ',');
  assert.strictEqual(I.sniffDelimiter('Broj pošiljke\tIznos\n700001\t12,50\n'), '\t');
  // quoted cells with ; inside do not fool a comma file
  assert.strictEqual(I.sniffDelimiter('a,b,c\n"x;y",1,2\n"p;q",3,4\n'), ',');
});
t('parseCsv: BOM, quotes, "" escapes, line breaks in quotes, CRLF, empty rows dropped', () => {
  const r = I.parseCsv('﻿a;b\r\n"x ""y""";"two\nlines"\r\n\r\n;;\r\n1;2');
  assert.strictEqual(r.delimiter, ';');
  assert.deepStrictEqual(r.rows, [['a', 'b'], ['x "y"', 'two\nlines'], ['1', '2']]);
});
t('decimal detection and amounts in SI / HR / EN styles', () => {
  assert.strictEqual(I.detectDecimal(['49,90', '1.234,50', '12']), ',');
  assert.strictEqual(I.detectDecimal(['49.90', '1,234.50']), '.');
  assert.strictEqual(I.detectDecimal(['1.234', '2.500']), ','); // only thousands: default comma
  assert.strictEqual(I.parseAmount('1.234,50', ','), 1234.5);
  assert.strictEqual(I.parseAmount('1 234,50 €', ','), 1234.5);
  assert.strictEqual(I.parseAmount('-12,30', ','), -12.3);
  assert.strictEqual(I.parseAmount('(12,30)', ','), -12.3);
  assert.strictEqual(I.parseAmount('12,30-', ','), -12.3);
  assert.strictEqual(I.parseAmount('1,234.50', '.'), 1234.5);
  assert.strictEqual(I.parseAmount('1.234', ','), 1234);
  assert.strictEqual(I.parseAmount('12.5', ','), 12.5); // clearly a decimal point after all
  assert.strictEqual(I.parseAmount('49,9', '.'), 49.9);
  assert.ok(Number.isNaN(I.parseAmount('abc', ',')));
  assert.ok(Number.isNaN(I.parseAmount('1,2,3', ',')));
});
t('dates: dd.mm.yyyy, with spaces, trailing dot, ISO with time, yyyymmdd, invalid', () => {
  assert.strictEqual(I.parseDate('15.10.2026'), '2026-10-15');
  assert.strictEqual(I.parseDate('5. 10. 2026'), '2026-10-05');
  assert.strictEqual(I.parseDate('15.10.2026.'), '2026-10-15');
  assert.strictEqual(I.parseDate('2026-10-15T08:30:00+02:00'), '2026-10-15');
  assert.strictEqual(I.parseDate('20261015'), '2026-10-15');
  assert.strictEqual(I.parseDate('15/10/2026'), '2026-10-15');
  assert.strictEqual(I.parseDate('15.10.26'), '2026-10-15');
  assert.strictEqual(I.parseDate('31.02.2026'), null);
  assert.strictEqual(I.parseDate('soon'), null);
});

// ── header mapping ─────────────────────────────────────────────────────────
t('carrier headers in Slovenian, Croatian and English', () => {
  const sl = I.guessMapping(['Številka pošiljke', 'Številka naročila', 'Datum izplačila', 'Odkupnina', 'Provizija', 'Znesek izplačila', 'Sklic'], I.CARRIER_FIELDS);
  assert.deepStrictEqual(sl, { tracking: 0, order: 1, date: 2, cod: 3, fee: 4, amount: 5, ref: 6 });
  const sl2 = I.guessMapping(['Št. pošiljke', 'Odkupnina', 'Znesek'], I.CARRIER_FIELDS);
  assert.strictEqual(sl2.tracking, 0); assert.strictEqual(sl2.cod, 1); assert.strictEqual(sl2.amount, 2);
  const hr = I.guessMapping(['Broj pošiljke', 'Otkupnina', 'Naknada', 'Iznos', 'Datum', 'Poziv na broj'], I.CARRIER_FIELDS);
  assert.deepStrictEqual([hr.tracking, hr.cod, hr.fee, hr.amount, hr.date, hr.ref], [0, 1, 2, 3, 4, 5]);
  const en = I.guessMapping(['Date', 'Tracking', 'COD amount', 'Amount', 'Reference'], I.CARRIER_FIELDS);
  assert.deepStrictEqual([en.date, en.tracking, en.cod, en.amount, en.ref], [0, 1, 2, 3, 4]);
  assert.deepStrictEqual(I.missingRequired({ tracking: 0, amount: -1 }, I.CARRIER_FIELDS), ['Amount paid out']);
});
t('bank headers and a remembered mapping by header name', () => {
  const m = I.guessMapping(['Datum knjiženja', 'Datum valute', 'Partner', 'V breme', 'V dobro', 'Namen', 'Referenca'], I.BANK_FIELDS);
  assert.deepStrictEqual([m.date, m.party, m.debit, m.credit, m.text, m.ref], [0, 2, 3, 4, 5, 6]);
  const heads = ['Col A', 'Col B', 'Col C'];
  const saved = { tracking: 'col c', amount: 'Col A', cod: '' };
  const r = I.mapFromSaved(heads, saved, I.CARRIER_FIELDS);
  assert.strictEqual(r.fromSaved, true);
  assert.strictEqual(r.map.tracking, 2); assert.strictEqual(r.map.amount, 0); assert.strictEqual(r.map.cod, -1);
  assert.deepStrictEqual(I.mapToSaved(heads, { tracking: 2, amount: 0, cod: -1 }), { tracking: 'Col C', amount: 'Col A', cod: '' });
});

// ── carrier rows ───────────────────────────────────────────────────────────
t('readCarrierRows: net column, COD − fee, gross only, totals skipped, bad rows reported', () => {
  const csv = I.parseCsv('Številka pošiljke;Datum izplačila;Odkupnina;Provizija;Znesek izplačila;Sklic\n' +
    '91234567890;9.10.2026;49,90;0,40;49,50;GLSSI-CP-261009-347\n' +
    '91234567891;9.10.2026;1.210,00;9,68;1.200,32;GLSSI-CP-261009-347\n' +
    '91234567892;ni datum;10,00;0,08;9,92;X\n' +
    '91234567893;9.10.2026;10,00;0,08;abc;X\n' +
    'Skupaj;;;;1.249,82;\n');
  const map = I.guessMapping(csv.rows[0], I.CARRIER_FIELDS);
  const r = I.readCarrierRows(csv.rows, map);
  assert.strictEqual(r.dec, ',');
  assert.strictEqual(r.lines.length, 2);
  assert.deepStrictEqual(r.lines[1], { n: 3, tracking: '91234567891', key: '91234567891', amount: 1200.32, cod: 1210, fee: 9.68, date: '2026-10-09', ref: 'GLSSI-CP-261009-347', order: '' });
  assert.strictEqual(r.errors.length, 2);
  assert.strictEqual(r.errors[0].n, 4);
  assert.strictEqual(r.skipped, 1);
  // COD and fee but no paid-out column → COD − fee
  const r2 = I.readCarrierRows([['Tracking', 'COD', 'Fee'], ['A1', '20.00', '-0.50']], { tracking: 0, cod: 1, fee: 2, amount: -1, date: -1, ref: -1, order: -1 });
  assert.strictEqual(r2.lines[0].amount, 19.5); assert.strictEqual(r2.basis, 'net'); assert.strictEqual(r2.dec, '.');
  // only a COD column → compared on the gross amount
  const r3 = I.readCarrierRows([['Tracking', 'COD'], ['A1', '20,00']], { tracking: 0, cod: 1, fee: -1, amount: -1, date: -1, ref: -1, order: -1 });
  assert.strictEqual(r3.basis, 'gross'); assert.strictEqual(r3.lines[0].amount, 20);
});

// ── bank CSV ───────────────────────────────────────────────────────────────
t('readBankRows: debit/credit columns, signed amounts, Slovenian B/D marker', () => {
  const rows = I.parseCsv('Datum knjiženja;Partner;V breme;V dobro;Namen;Referenca\n12.10.2026;GLS;;1.200,32;Izplačilo odkupnin;GLSSI-CP-261009-347\n12.10.2026;Banka;3,50;;Provizija;\n').rows;
  const r = I.readBankRows(rows, I.guessMapping(rows[0], I.BANK_FIELDS));
  assert.strictEqual(r.entries.length, 2);
  assert.strictEqual(r.entries[0].cd, 'CRDT'); assert.strictEqual(r.entries[0].amount, 1200.32); assert.deepStrictEqual(r.entries[0].refs, ['GLSSI-CP-261009-347']);
  assert.strictEqual(r.entries[1].cd, 'DBIT'); assert.strictEqual(r.entries[1].amount, 3.5);
  const signed = I.readBankRows([['Date', 'Amount', 'Details'], ['2026-10-12', '-3.50', 'Fee'], ['2026-10-12', '120.00', 'In']], { date: 0, amount: 1, text: 2, dc: -1, credit: -1, debit: -1, ref: -1, party: -1 });
  assert.deepStrictEqual(signed.entries.map((e) => e.cd), ['DBIT', 'CRDT']);
  const bd = I.readBankRows([['Datum', 'Znesek', 'B/D'], ['12.10.2026', '10,00', 'B'], ['12.10.2026', '20,00', 'D']], { date: 0, amount: 1, dc: 2, credit: -1, debit: -1, ref: -1, text: -1, party: -1 });
  assert.deepStrictEqual(bd.entries.map((e) => e.cd), ['DBIT', 'CRDT']);
  assert.strictEqual(I.dcOf('D', false), 'D'); assert.strictEqual(I.dcOf('CRDT'), 'C');
});

// ── camt.053 ───────────────────────────────────────────────────────────────
const CAMT = `<?xml version="1.0" encoding="UTF-8"?>
<!-- a comment -->
<n:Document xmlns:n="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">
 <n:BkToCstmrStmt><n:GrpHdr><n:MsgId>M1</n:MsgId></n:GrpHdr>
  <n:Stmt><n:Id>STMT-2026-10-12</n:Id>
   <n:FrToDt><n:FrDtTm>2026-10-12T00:00:00</n:FrDtTm><n:ToDtTm>2026-10-12T23:59:59</n:ToDtTm></n:FrToDt>
   <n:Acct><n:Id><n:IBAN>SI00990000012345678</n:IBAN></n:Id><n:Ccy>EUR</n:Ccy></n:Acct>
   <n:Ntry><n:Amt Ccy="EUR">1200.32</n:Amt><n:CdtDbtInd>CRDT</n:CdtDbtInd><n:Sts>BOOK</n:Sts>
    <n:BookgDt><n:Dt>2026-10-12</n:Dt></n:BookgDt><n:ValDt><n:Dt>2026-10-12</n:Dt></n:ValDt><n:AcctSvcrRef>B-1</n:AcctSvcrRef>
    <n:NtryDtls><n:TxDtls><n:Refs><n:EndToEndId>NOTPROVIDED</n:EndToEndId></n:Refs>
     <n:RltdPties><n:Dbtr><n:Nm>GLS d.o.o. &amp; Co</n:Nm></n:Dbtr></n:RltdPties>
     <n:RmtInf><n:Ustrd>Izplačilo odkupnin</n:Ustrd><n:Strd><n:CdtrRefInf><n:Ref>GLSSI-CP-261009-347</n:Ref></n:CdtrRefInf></n:Strd></n:RmtInf>
    </n:TxDtls></n:NtryDtls></n:Ntry>
   <n:Ntry><n:Amt Ccy="EUR">3.50</n:Amt><n:CdtDbtInd>DBIT</n:CdtDbtInd><n:Sts><n:Cd>BOOK</n:Cd></n:Sts>
    <n:BookgDt><n:DtTm>2026-10-12T10:00:00</n:DtTm></n:BookgDt><n:AddtlNtryInf>Bank fee</n:AddtlNtryInf></n:Ntry>
   <n:Ntry><n:Amt Ccy="EUR">30.00</n:Amt><n:CdtDbtInd>CRDT</n:CdtDbtInd><n:BookgDt><n:Dt>2026-10-12</n:Dt></n:BookgDt>
    <n:NtryDtls>
     <n:TxDtls><n:Amt Ccy="EUR">10.00</n:Amt><n:RmtInf><n:Ustrd>part one</n:Ustrd></n:RmtInf></n:TxDtls>
     <n:TxDtls><n:AmtDtls><n:TxAmt><n:Amt Ccy="EUR">20.00</n:Amt></n:TxAmt></n:AmtDtls><n:RmtInf><n:Ustrd><![CDATA[part <two>]]></n:Ustrd></n:RmtInf></n:TxDtls>
    </n:NtryDtls></n:Ntry>
  </n:Stmt>
 </n:BkToCstmrStmt>
</n:Document>`;
t('camt.053: prefixed namespace, credit/debit, Strd/Ustrd/AddtlNtryInf, DtTm, batch booking split', () => {
  const r = I.parseCamt053(CAMT);
  assert.strictEqual(r.stmts.length, 1);
  assert.strictEqual(r.stmts[0].iban, 'SI00990000012345678');
  assert.strictEqual(r.stmts[0].from, '2026-10-12');
  assert.strictEqual(r.entries.length, 4);
  const [a, b, c, d] = r.entries;
  assert.strictEqual(a.amount, 1200.32); assert.strictEqual(a.cd, 'CRDT'); assert.strictEqual(a.bookDate, '2026-10-12');
  assert.deepStrictEqual(a.refs, ['GLSSI-CP-261009-347']); // NOTPROVIDED left out
  assert.strictEqual(a.text, 'Izplačilo odkupnin'); assert.strictEqual(a.party, 'GLS d.o.o. & Co'); assert.strictEqual(a.acctRef, 'B-1'); assert.strictEqual(a.status, 'BOOK');
  assert.strictEqual(b.cd, 'DBIT'); assert.strictEqual(b.text, 'Bank fee'); assert.strictEqual(b.bookDate, '2026-10-12'); assert.strictEqual(b.status, 'BOOK');
  assert.strictEqual(c.amount, 10); assert.strictEqual(d.amount, 20); assert.strictEqual(d.text, 'part <two>');
});
t('camt.053: default namespace, camt.054 notification, errors', () => {
  const x = '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.054.001.08"><BkToCstmrDbtCdtNtfctn><Ntfctn><Id>N1</Id><Ntry><Amt Ccy="EUR">5.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><BookgDt><Dt>2026-10-01</Dt></BookgDt></Ntry></Ntfctn></BkToCstmrDbtCdtNtfctn></Document>';
  const r = I.parseCamt053(x);
  assert.strictEqual(r.entries.length, 1); assert.strictEqual(r.entries[0].amount, 5);
  assert.throws(() => I.parseCamt053('<Document><Stmt></Document>'), /Not valid XML/);
  assert.throws(() => I.parseCamt053('<html><body/></html>'), /not a camt/);
});
t('camt.053: the sample builder round-trips', () => {
  const xml = I.buildCamt053({ id: 'S1', iban: 'SI00 9900 0001 2345 678', from: '2026-10-01', to: '2026-10-14' }, [
    { amount: 49.5, cd: 'CRDT', bookDate: '2026-10-02', ref: 'DPDSI-OD-260930-401', party: 'DPD' },
    { amount: 12, cd: 'DBIT', bookDate: '2026-10-03', addtl: 'Card fees <Oct>' },
    { amount: 7.25, cd: 'CRDT', bookDate: '2026-10-04', ustrd: 'Izplačilo PS-ODK-261002-332' }
  ]);
  const r = I.parseCamt053(xml);
  assert.strictEqual(r.stmts[0].iban, 'SI00990000012345678');
  assert.deepStrictEqual(r.entries.map((e) => [e.amount, e.cd, e.bookDate]), [[49.5, 'CRDT', '2026-10-02'], [12, 'DBIT', '2026-10-03'], [7.25, 'CRDT', '2026-10-04']]);
  assert.deepStrictEqual(r.entries[0].refs, ['DPDSI-OD-260930-401']);
  assert.strictEqual(r.entries[1].text, 'Card fees <Oct>');
  assert.strictEqual(r.entries[2].text, 'Izplačilo PS-ODK-261002-332');
});

// ── matching ───────────────────────────────────────────────────────────────
const PARCELS = {
  '91000000001': { pid: 'p1', carrier: 'GLS-SI', cod: 50, net: 49.6, delivered: true, returned: false, batch: null, imported: null },
  '91000000002': { pid: 'p2', carrier: 'GLS-SI', cod: 20, net: 19.84, delivered: true, returned: false, batch: { id: 'b1', ref: 'GLSSI-CP-1', paid: 19.84, expected: 19.84 }, imported: null },
  '91000000003': { pid: 'p3', carrier: 'GLS-SI', cod: 30, net: 29.76, delivered: true, returned: false, batch: { id: 'b1', ref: 'GLSSI-CP-1', paid: 25, expected: 29.76 }, imported: null },
  '91000000004': { pid: 'p4', carrier: 'GLS-SI', cod: 40, net: 39.68, delivered: false, returned: true, batch: null, imported: null },
  '91000000005': { pid: 'p5', carrier: 'GLS-SI', cod: 0, net: 0, delivered: true, returned: false, batch: null, imported: null },
  '91000000006': { pid: 'p6', carrier: 'DPD-SI', carrierName: 'DPD SI', cod: 10, net: 9.91, delivered: true, returned: false, batch: null, imported: null },
  '91000000007': { pid: 'p7', carrier: 'GLS-SI', cod: 10, net: 9.92, delivered: true, returned: false, batch: null, imported: { ref: 'OLD' } },
  '6123': { pid: 'p8', carrier: 'GLS-SI', cod: 10, net: 9.92, delivered: true, returned: false, batch: null, imported: null }
};
const line = (n, tracking, amount) => ({ n, tracking, key: I.normRef(tracking), amount, date: '2026-10-12', ref: 'R1' });
t('matchCarrier: new payout, batch confirm, known short, returned, prepaid, other carrier, duplicates, unknown, leading zeros', () => {
  const res = I.matchCarrier([
    line(2, '91000000001', 49.6), line(3, '91000000002', 19.84), line(4, '91000000003', 25), line(5, '91000000004', 39.68),
    line(6, '91000000005', 5), line(7, '91000000006', 9.91), line(8, '91000000007', 9.92), line(9, '91000000001', 49.6),
    line(10, '99999', 1), line(11, '0006123', 9.92), line(12, '91 0000 0000 1', 1)
  ], { find: (k) => PARCELS[k] || null, carrier: 'GLS-SI' });
  const brief = res.map((r) => r.status + ':' + r.kind);
  assert.deepStrictEqual(brief, ['matched:new', 'matched:batch', 'mismatch:batch', 'mismatch:returned', 'unmatched:notcod', 'unmatched:carrier', 'duplicate:again', 'duplicate:twice', 'unmatched:unknown', 'matched:new', 'duplicate:twice']);
  assert.strictEqual(res[0].apply, true);
  assert.strictEqual(res[2].diff, -4.76); assert.ok(/already in Mismatches/.test(res[2].note));
  assert.strictEqual(res[3].expected, 0); assert.strictEqual(res[3].diff, 39.68); assert.strictEqual(res[3].apply, false);
  const mis = I.matchCarrier([line(2, '91000000001', 45)], { find: (k) => PARCELS[k] || null });
  assert.strictEqual(mis[0].status, 'mismatch'); assert.strictEqual(mis[0].diff, -4.6); assert.strictEqual(mis[0].apply, false);
  const s = I.summary(res);
  assert.strictEqual(s.matched, 3); assert.strictEqual(s.mismatch, 2); assert.strictEqual(s.unmatched, 3); assert.strictEqual(s.duplicate, 3);
});
t('matchBank: reference, amount + date within tolerance, ambiguous, mismatch, debit, already done, other account', () => {
  const targets = [
    { key: 'b:1', ref: 'GLSSI-CP-261009-347', amount: 1200.32, date: '2026-10-12', account: 'SI00 9900 0001 2345 678' },
    { key: 'b:2', ref: 'DPDSI-OD-261008-402', amount: 88.1, date: '2026-10-09', account: 'SI00 9900 0001 2345 678' },
    { key: 'b:3', ref: 'PS-ODK-261007-330', amount: 15, date: '2026-10-08', account: 'SI00 9900 0001 2345 678' },
    { key: 'b:4', ref: 'PS-ODK-261008-331', amount: 15, date: '2026-10-09', account: 'SI00 9900 0001 2345 678' },
    { key: 'b:5', ref: 'GLSHR-POU-261007-310', amount: 70, date: '2026-10-08', account: 'HR00 9990 0001 1023 4567 8' },
    { key: 'b:6', ref: 'BXN-PAY-261002-355', amount: 33, date: '2026-10-06', account: 'SI00 9900 0001 2345 678', done: true }
  ];
  const E = (o) => Object.assign({ cd: 'CRDT', bookDate: '2026-10-12', refs: [], text: '' }, o);
  const res = I.matchBank([
    E({ amount: 1200.32, refs: ['GLS SI CP 261009 347'] }),
    E({ amount: 88.1, bookDate: '2026-10-13', text: 'DPD izplačilo' }), // amount + date (4 days)
    E({ amount: 15, bookDate: '2026-10-09' }), // two payouts of 15 → ambiguous
    E({ amount: 1100, text: 'GLSSI-CP-261009-347' }), // same ref again → duplicate
    E({ amount: 3.5, cd: 'DBIT', text: 'fee' }),
    E({ amount: 70, bookDate: '2026-10-08' }), // HR account only → not on this SI statement
    E({ amount: 33, text: 'BXN-PAY-261002-355' }),
    E({ amount: 88.1, bookDate: '2026-10-30' })
  ], targets, { iban: 'SI00990000012345678', tolDays: 5 });
  assert.deepStrictEqual(res.map((r) => r.status), ['matched', 'matched', 'unmatched', 'duplicate', 'ignored', 'unmatched', 'duplicate', 'unmatched']);
  assert.strictEqual(res[0].by, 'reference'); assert.strictEqual(res[1].by, 'amount and date'); assert.strictEqual(res[0].apply, true);
  assert.ok(/2 payouts/.test(res[2].note));
  const mm = I.matchBank([E({ amount: 1190, refs: ['GLSSI-CP-261009-347'] })], targets, {});
  assert.strictEqual(mm[0].status, 'mismatch'); assert.strictEqual(mm[0].diff, -10.32); assert.strictEqual(mm[0].apply, false);
});

// ── sample files read back ─────────────────────────────────────────────────
t('sample carrier CSVs (sl with ";" and commas, en with "," and points) read back with auto-detection', () => {
  const lines = [{ tracking: '91000000001', order: 'SI-1', date: '2026-10-12', cod: 1234.5, fee: 9.88, amount: 1224.62, ref: 'GLSSI-CP-261012-900' }];
  ['sl', 'hr', 'en'].forEach((lang) => {
    const csv = I.parseCsv(I.buildCarrierCsv(lines, lang));
    assert.strictEqual(csv.delimiter, lang === 'en' ? ',' : ';');
    const r = I.readCarrierRows(csv.rows, I.guessMapping(csv.rows[0], I.CARRIER_FIELDS));
    assert.strictEqual(r.dec, lang === 'en' ? '.' : ',');
    assert.strictEqual(r.lines.length, 1, lang); assert.strictEqual(r.skipped, 1, lang);
    assert.deepStrictEqual([r.lines[0].amount, r.lines[0].cod, r.lines[0].fee, r.lines[0].date, r.lines[0].ref], [1224.62, 1234.5, 9.88, '2026-10-12', 'GLSSI-CP-261012-900'], lang);
  });
  const bank = I.parseCsv(I.buildBankCsv([{ amount: 1224.62, cd: 'CRDT', bookDate: '2026-10-13', party: 'GLS', ustrd: 'Izplačilo', ref: 'GLSSI-CP-261012-900' }, { amount: 2, cd: 'DBIT', bookDate: '2026-10-13', addtl: 'fee' }]));
  const br = I.readBankRows(bank.rows, I.guessMapping(bank.rows[0], I.BANK_FIELDS));
  assert.deepStrictEqual(br.entries.map((e) => [e.amount, e.cd]), [[1224.62, 'CRDT'], [2, 'DBIT']]);
});

console.log(n + ' parcels-import tests passed');
