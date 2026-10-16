// Tests for the Budget vs actual import of accounting exports: the Slovenian chart of accounts (kontni okvir),
// Minimax / Pantheon trial balances and general ledgers, suggested P&L lines, year-to-date trial balances, .xlsx files
// and moving older demo data onto the chart. Run: node tools/tests/budget-import.test.js
'use strict';
const assert = require('assert');
const path = require('path');
const zlib = require('zlib');
const E = require(path.join(__dirname, '../../site/budget/engine.js'));
const D = require(path.join(__dirname, '../../site/budget/data.js'));
const X = require(path.join(__dirname, '../../site/budget/xlsx.js'));

let n = 0;
const queue = [];
function t(name, fn) { queue.push([name, fn]); }
const eur = (x) => Math.round(x * 100);
const ACC = [
  { code: '7620', line: 'sales_si', kind: 'income' }, { code: '7020', line: 'cogs', kind: 'cost' },
  { code: '4700', line: 'personnel', kind: 'cost' }, { code: '7420', line: 'fin', kind: 'cost' }, { code: '7710', line: 'fin', kind: 'income' }
];

// ── the chart of accounts ──────────────────────────────────────────────────
t('kontni okvir: classes 4 and 7 are P&L; 70–75 expenses, 76–78 income; 49 and the balance sheet are not', () => {
  assert.strictEqual(E.kindFromCode('702000'), 'cost');
  assert.strictEqual(E.kindFromCode('7420'), 'cost');
  assert.strictEqual(E.kindFromCode('750'), 'cost');
  assert.strictEqual(E.kindFromCode('7620'), 'income');
  assert.strictEqual(E.kindFromCode('771'), 'income');
  assert.strictEqual(E.kindFromCode('78'), 'income');
  assert.strictEqual(E.kindFromCode('4700'), 'cost');
  assert.deepStrictEqual(E.siClass('470000'), { pl: true, kind: 'cost' });
  assert.deepStrictEqual(E.siClass('7600'), { pl: true, kind: 'income' });
  assert.strictEqual(E.siClass('490000').reason, 'transfer');
  ['0200', '120000', '2200', '3100', '9000'].forEach((c) => assert.strictEqual(E.siClass(c).reason, 'balance', c));
  ['5000', '6300', '8000'].forEach((c) => assert.strictEqual(E.siClass(c).reason, 'other', c));
});

t('suggested P&L line: the nearest known account in the same group first, then the group of the chart', () => {
  assert.strictEqual(E.suggestLine('470000', ACC), 'personnel');     // same group as 4700
  assert.strictEqual(E.suggestLine('7621', ACC), 'sales_si');
  assert.strictEqual(E.suggestLine('742100', ACC), 'fin');
  assert.strictEqual(E.suggestLine('763000', []), 'sales_eu');        // goods sold abroad
  assert.strictEqual(E.suggestLine('762000', []), 'sales_si');
  assert.strictEqual(E.suggestLine('702000', []), 'cogs');
  assert.strictEqual(E.suggestLine('413000', []), 'rent');
  assert.strictEqual(E.suggestLine('417100', []), 'marketing');
  assert.strictEqual(E.suggestLine('432000', []), 'da');
  assert.strictEqual(E.suggestLine('474000', []), 'personnel');
  assert.strictEqual(E.suggestLine('774000', []), 'fin');
  assert.strictEqual(E.suggestLine('120000', []), '');
  assert.strictEqual(E.suggestLine('ABC', []), '');
});

// ── general ledger ─────────────────────────────────────────────────────────
const GL = '﻿Nordvik Distribucija d.o.o.\nGlavna knjiga\nObdobje: 01.09.2026 - 30.09.2026\n\n' +
  'Datum knjiženja;Temeljnica;Konto;Naziv konta;Opis;Debet;Kredit\n' +
  '30.09.2026;T-1;7620;Prodaja blaga;Račun 26-0101;;12.500,00\n' +
  '30.09.2026;T-1;7620;Prodaja blaga;Dobropis;500,00;\n' +
  '30.09.2026;T-1;120000;Kupci;Račun;15.250,00;\n' +
  '15.09.2026;T-2;470000;Plače;Plače 8/2026;88.410,55;\n' +
  '15.09.2026;T-2;474000;Prispevki delodajalca;;14.234,10;\n' +
  '12.08.2026;T-3;742000;Obresti;;3.100,00;\n' +
  '30.09.2026;T-4;490000;Prenos stroškov;;;9.000,00\n' +
  ';;;;Skupaj;133.494,65;21.500,00\n';

t('Minimax general ledger: title lines, debit − credit, months from the dates, balance sheet and 49 left out', () => {
  const p = E.parseExport(GL, { accounts: ACC, years: [2025, 2026] });
  assert.deepStrictEqual(p.errors, []);
  assert.strictEqual(p.format, 'gl');
  assert.strictEqual(p.preset, 'minimax-gl');
  assert.strictEqual(p.heads[p.cols.debit], 'Debet');
  assert.deepStrictEqual(p.rows.map((r) => [r.code, r.cents, r.m]), [
    ['7620', -eur(12500), 9], ['7620', eur(500), 9], ['470000', eur(88410.55), 9], ['474000', eur(14234.10), 9], ['742000', eur(3100), 8]
  ]);
  assert.strictEqual(p.signGuess, 'ledger');
  assert.deepStrictEqual(p.skipped.map((s) => s.code + ':' + s.reason), ['120000:balance', '490000:transfer']);
  assert.strictEqual(p.ignored, 1); // the "Skupaj" row has no account
  assert.deepStrictEqual(p.unknown.map((u) => u.code), ['470000', '474000', '742000']);
  assert.strictEqual(p.unknown[0].desc, 'Plače');
  assert.deepStrictEqual(p.months.map((m) => m.key), ['2026-08', '2026-09']);
  // into the actuals: income flipped to positive by the ledger sign
  const accs = ACC.concat(p.unknown.map((u) => ({ code: u.code, line: E.suggestLine(u.code, ACC), kind: E.LINE[E.suggestLine(u.code, ACC)].type })));
  const r = E.applyImport({}, p.rows, accs, { sign: 'ledger' });
  assert.strictEqual(r.actuals[2026]['7620'][8], eur(12000));
  const lines = E.aggregate(r.actuals[2026], accs).lines;
  assert.strictEqual(lines.personnel[8], eur(88410.55 + 14234.10));
  assert.strictEqual(lines.fin[7], -eur(3100));
});

t('Croatian Pantheon ledger (Duguje / Potražuje), dates as Excel day numbers, a code with its name in one cell', () => {
  const txt = 'Konto\tDatum knj.\tDokument\tOpis\tDuguje\tPotražuje\n7620 Prihodi od prodaje\t46295\tR-1\tRačun\t\t1.000,00\n4700\t46295\tP-1\tPlaće\t800,00\t\n';
  const p = E.parseExport(txt, { accounts: ACC });
  assert.deepStrictEqual(p.errors, []);
  assert.strictEqual(p.preset, 'pantheon-gl');
  assert.deepStrictEqual(p.rows.map((r) => [r.code, r.cents, r.y, r.m]), [['7620', -eur(1000), 2026, 9], ['4700', eur(800), 2026, 9]]);
  assert.deepStrictEqual(E.excelMonth('46295'), { y: 2026, m: 9 });
  assert.strictEqual(E.excelMonth('123'), null);
});

t('a bad amount or date stops the import with the row number', () => {
  const p = E.parseExport('Datum;Konto;Debet;Kredit\n30.09.2026;4700;abc;\n31.09.2026;4700;1,00;\n', { accounts: ACC });
  assert.deepStrictEqual(p.errors.map((e) => e.row), [2, 3]);
  assert.ok(/not a number/.test(p.errors[0].msg) && /not a date/.test(p.errors[1].msg));
});

// ── trial balance ──────────────────────────────────────────────────────────
function tb(period) {
  return 'Nordvik Distribucija d.o.o.;;;;;;;\nBruto bilanca;;;;;;;\nObdobje: ' + period + ';;;;;;;\n' +
    'Konto;Naziv;Otvoritev;;Promet;;Saldo;\n;;Debet;Kredit;Debet;Kredit;Debet;Kredit\n' +
    '1;Kratkoročna sredstva;1.000,00;;50,00;;1.050,00;\n100000;Blagajna;1.000,00;;50,00;;1.050,00;\n101000;Menjalnica;500,00;;;;500,00;\n' +
    '47;Stroški dela;;;300,00;;300,00;\n4700;Plače;;;300,00;;300,00;\n' +
    '7620;Prodaja blaga;;;;1.200,00;;1.200,00\n7710;Obresti;;;;0,00;;0,00\nSkupaj;;;;;;;\n';
}

t('Pantheon trial balance: two-row header, turnover not the opening balance, subtotals left out, period from the title', () => {
  const p0 = E.parseExport(tb('01.09.2026 - 30.09.2026'), { accounts: ACC });
  assert.strictEqual(p0.format, 'tb');
  assert.strictEqual(p0.preset, 'pantheon-tb');
  assert.strictEqual(p0.needsPeriod, true);
  assert.deepStrictEqual(p0.periodGuess, { y: 2026, m: 9, cumulative: false });
  assert.strictEqual(p0.rows.length, 0);
  assert.deepStrictEqual(p0.heads.slice(4, 6), ['Promet Debet', 'Promet Kredit']);
  const p = E.parseExport(tb('01.09.2026 - 30.09.2026'), { accounts: ACC, period: p0.periodGuess });
  assert.deepStrictEqual(p.rows.map((r) => [r.code, r.cents, r.m]), [['4700', eur(300), 9], ['7620', -eur(1200), 9]]);
  assert.deepStrictEqual(p.skipped.map((s) => s.code + ':' + s.reason), ['1:total', '100000:balance', '47:total']);
  assert.deepStrictEqual(E.periodFromText(['Obdobje: 01.01.2026 - 30.06.2026']), { y: 2026, m: 6, cumulative: true });
  assert.strictEqual(E.periodFromText(['Obdobje: 05.01.2026 - 30.06.2026']), null);
  assert.deepStrictEqual(E.periodFromText(['Period 2026-03-01 – 2026-03-31']), { y: 2026, m: 3, cumulative: false });
});

t('columns can be picked by hand when a program names them differently', () => {
  const txt = 'Konto;Naziv;Breme obdobja;Dobro obdobja\n4700;Plače;300,00;\n7620;Prodaja;;1.200,00\n';
  const auto = E.parseExport(txt, { accounts: ACC, period: { y: 2026, m: 9 } });
  assert.strictEqual(auto.errors.length, 1); // no column it knows: the header is not recognised
  const p = E.parseExport(txt, { accounts: ACC, period: { y: 2026, m: 9 }, cols: { account: 0, name: 1, debit: 2, credit: 3 } });
  assert.deepStrictEqual(p.rows.map((r) => [r.code, r.cents]), [['4700', eur(300)], ['7620', -eur(1200)]]);
});

t('a year-to-date trial balance becomes the month: earlier months are subtracted, a missing account goes to zero', () => {
  const actuals = { 2026: { 4700: [100, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 7620: [500, 400, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 7710: [7, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] } };
  const rows = [{ y: 2026, m: 3, code: '4700', cents: 330 }, { y: 2026, m: 3, code: '7620', cents: -1350 }];
  const out = E.deCumulate(rows, actuals, ACC, 2026, 3, 'ledger');
  assert.deepStrictEqual(out.map((r) => [r.code, r.cents]), [['4700', 130], ['7620', -450], ['7710', 10]]);
  const r = E.applyImport(actuals, out, ACC, { sign: 'ledger' }).actuals[2026];
  assert.strictEqual(r['4700'][2], 130);
  assert.strictEqual(r['7620'][2], 450);
  assert.strictEqual(r['7710'][2], -10); // year to date 0 after 10 earlier: the month reverses it
  assert.strictEqual(E.deCumulate(rows, actuals, ACC, 2026, 1, 'ledger')[0].cents, 330); // January: nothing before
});

t('round trip: the demo year exported as Minimax ledger and Pantheon year-to-date trial balances imports to the cent', () => {
  const db = D.generate('2026-10-13'), y = db.year, acc = {}; db.accounts.forEach((a) => { acc[a.code] = a; });
  const led = (code, v) => (acc[code].kind === 'income' ? -v : v);
  const amt = (c) => (c < 0 ? '-' : '') + E.centsText(Math.abs(c)).replace(/^-/, '');
  let gl = 'Datum knjiženja;Temeljnica;Konto;Naziv konta;Opis;Debet;Kredit\n';
  for (let m = 1; m <= 9; m++) Object.keys(db.actuals[y]).forEach((code) => { const v = led(code, db.actuals[y][code][m - 1]); if (v) gl += '15.' + String(m).padStart(2, '0') + '.' + y + ';T;' + code + ';' + acc[code].name + ';x;' + (v > 0 ? amt(v) : '') + ';' + (v < 0 ? amt(-v) : '') + '\n'; });
  const p = E.parseExport(gl, { accounts: db.accounts, years: [y - 1, y] });
  assert.deepStrictEqual(p.errors, []);
  assert.deepStrictEqual(p.unknown, []);
  const back = E.applyImport({}, p.rows, db.accounts, { sign: 'ledger' }).actuals[y];
  Object.keys(db.actuals[y]).forEach((code) => assert.deepStrictEqual(back[code] || E.zeros(), db.actuals[y][code], code));
  // month by month from year-to-date trial balances
  let acts = { [y]: {} };
  for (let m = 1; m <= 9; m++) {
    let txt = 'Konto;Naziv;Promet debet;Promet kredit\n';
    Object.keys(db.actuals[y]).forEach((code) => { const v = led(code, E.sumRange(db.actuals[y][code], 1, m)); if (v) txt += code + ';' + acc[code].name + ';' + (v > 0 ? amt(v) : '') + ';' + (v < 0 ? amt(-v) : '') + '\n'; });
    const q = E.parseExport(txt, { accounts: db.accounts, period: { y, m, cumulative: true } });
    assert.deepStrictEqual(q.errors, []);
    acts = E.applyImport(acts, E.deCumulate(q.rows, acts, db.accounts, y, m, 'ledger'), db.accounts, { sign: 'ledger' }).actuals;
  }
  Object.keys(db.actuals[y]).forEach((code) => assert.deepStrictEqual(acts[y][code] || E.zeros(), db.actuals[y][code], 'YTD ' + code));
});

t('the simple month; account; amount file still goes through the old reader, with balance-sheet accounts left out', () => {
  const p = E.parseExport('month;account;amount\n2026-09;7620;100\n2026-09;120000;55\n', { accounts: ACC });
  assert.strictEqual(p.format, 'simple');
  assert.deepStrictEqual(p.rows.map((r) => r.code), ['7620']);
  assert.deepStrictEqual(p.skipped.map((s) => s.code), ['120000']);
  const own = E.parseExport('month;account;amount\n2026-09;120000;55\n', { accounts: ACC.concat([{ code: '120000', line: 'other_inc', kind: 'income' }]) });
  assert.deepStrictEqual(own.rows.map((r) => r.code), ['120000']); // an account the app knows is always kept
});

// ── Excel files ────────────────────────────────────────────────────────────
function zip(files) { // a minimal ZIP: deflated entries, enough for the reader
  const parts = [], central = []; let off = 0;
  Object.keys(files).forEach((name) => {
    const raw = Buffer.from(files[name], 'utf8'), data = zlib.deflateRawSync(raw), nm = Buffer.from(name);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nm.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(off, 42);
    parts.push(lh, nm, data); central.push(ch, nm); off += 30 + nm.length + data.length;
  });
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat(parts.concat([cd, end]));
}

t('.xlsx: shared strings, inline strings, numbers with a decimal comma, date-formatted cells as dates', async () => {
  const z = zip({
    'xl/sharedStrings.xml': '<sst><si><t>Datum knjiženja</t></si><si><t>Konto</t></si><si><t>Debet</t></si><si><t>Kredit</t></si><si><r><t>Prodaja </t></r><r><t>&amp; storitve</t></r></si></sst>',
    'xl/styles.xml': '<styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy;@"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="4"/></cellXfs></styleSheet>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData>' +
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="inlineStr"><is><t>Opis</t></is></c><c r="D1" t="s"><v>2</v></c><c r="E1" t="s"><v>3</v></c></row>' +
      '<row r="2"><c r="A2" s="1"><v>46295</v></c><c r="B2"><v>7620</v></c><c r="C2" t="s"><v>4</v></c><c r="E2" s="2"><v>12500.5</v></c></row>' +
      '<row r="3"><c r="A3" s="1"><v>46295</v></c><c r="B3"><v>4700</v></c><c r="D3" s="2"><v>800.10000000000002</v></c></row>' +
      '</sheetData></worksheet>'
  });
  assert.ok(X.isZip(z.buffer.slice(z.byteOffset, z.byteOffset + z.length)));
  const text = await X.toText(z);
  assert.strictEqual(text.split('\n')[1], '30.09.2026\t7620\tProdaja & storitve\t\t12500,5');
  const p = E.parseExport(text, { accounts: ACC });
  assert.deepStrictEqual(p.errors, []);
  assert.deepStrictEqual(p.rows.map((r) => [r.code, r.cents, r.m]), [['7620', -1250050, 9], ['4700', 80010, 9]]);
  await assert.rejects(X.toText(Buffer.from('not a zip at all, just text')), /not an Excel file/);
});

// ── demo data on the chart ─────────────────────────────────────────────────
t('older demo data moves onto the Slovenian chart: codes, actuals and names kept, months still added later', () => {
  const fresh = D.generate('2026-10-13');
  const old = JSON.parse(JSON.stringify(fresh)), back = {};
  Object.keys(D.SI_CODE).forEach((k) => { back[D.SI_CODE[k]] = k; });
  delete old.chart;
  old.accounts.forEach((a) => { a.code = back[a.code]; });
  [2025, 2026].forEach((y) => { const o = {}; Object.keys(old.actuals[y]).forEach((c) => { o[back[c]] = old.actuals[y][c]; }); old.actuals[y] = o; });
  old.accounts.filter((a) => a.code === '4200')[0].name = 'Plače (renamed)';
  old.edited = true;
  assert.strictEqual(D.migrate(old), true);
  assert.strictEqual(old.chart, D.CHART_ID);
  assert.deepStrictEqual(old.actuals, fresh.actuals);
  assert.strictEqual(old.accounts.filter((a) => a.code === '4700')[0].name, 'Plače (renamed)');
  assert.strictEqual(D.migrate(old), false); // only once
  // an own account already on a new code: keep the old codes and keep extending on them
  const clash = JSON.parse(JSON.stringify(old));
  delete clash.chart;
  clash.accounts = clash.accounts.map((a) => Object.assign({}, a, { code: back[a.code] })).concat([{ code: '7020', name: 'Mine', line: 'cogs', kind: 'cost' }]);
  const a2 = {}; Object.keys(clash.actuals[2026]).forEach((c) => { a2[back[c]] = clash.actuals[2026][c]; }); clash.actuals[2026] = a2;
  assert.strictEqual(D.migrate(clash), true);
  assert.strictEqual(clash.chart, 'legacy');
  assert.strictEqual(D.extend(clash, '2026-11-12'), true);
  assert.ok(clash.actuals[2026]['7600'][9] > 0 && !clash.actuals[2026]['7629']); // 7600 = the old heating account
  // imported data is never renamed
  const own = { demo: false, accounts: [{ code: '4200' }], actuals: {} };
  D.migrate(own);
  assert.strictEqual(own.accounts[0].code, '4200');
  assert.strictEqual(own.chart, 'own');
});

(async () => {
  for (const [name, fn] of queue) { await fn(); n++; console.log('ok', n, name); }
  console.log(n + ' tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
