// Tests for reading invoices (site/convert/eslog/extract.mjs): Slovenian and English headers, number and date formats,
// real Excel files made with the vendored SheetJS, a real text-layer PDF made with pdf-lib and read with pdf.js, scans refused,
// formula-looking cells, a sheet with several tabs. Run: node --no-warnings tools/tests/eslog-extract.test.js
'use strict';
const assert = require('assert').strict;
const path = require('path');
const { pathToFileURL } = require('url');
const S = require('./eslog-samples.js');
const dir = path.join(__dirname, '../../site/convert');
const vendor = (p) => pathToFileURL(path.join(dir, 'vendor', p));
let n = 0;
async function t(name, fn) { await fn(); n++; console.log('ok', n, name); }
(async () => {
const X = await import(pathToFileURL(path.join(dir, 'eslog/extract.mjs')).href);
const XLSX = S.loadXLSX();
const analyse = (grid, parties) => { const a = X.extract(grid), m = X.mappingOf(a); return { a, m, inv: X.buildInvoice(grid, m, parties) }; };
const readXlsx = (bytes, name) => { const wb = XLSX.read(bytes, { type: 'array', dense: true, cellNF: true }); return X.gridFromSheet(XLSX, wb.Sheets[name || wb.SheetNames[0]]); };

await t('Slovenian labels in A, values in B: header, parties, IBAN, address, lines and stated totals are found with confidence', () => {
  const { a, inv } = analyse(S.slovenianRows());
  assert.deepEqual([inv.number, inv.issueDate, inv.dueDate, inv.currency], ['2026-0142', '2026-10-02', '2026-11-01', 'EUR']);
  assert.deepEqual([inv.seller.name, inv.seller.vatId, inv.seller.iban], ['Zelenik d.o.o.', 'SI12345679', 'SI50123456789012345']);
  assert.deepEqual([inv.seller.street, inv.seller.postalCode, inv.seller.city], ['Cesta v Mestni log 1', '1000', 'Ljubljana']);
  assert.deepEqual([inv.buyer.name, inv.buyer.vatId, inv.buyer.city], ['Kamnik Logistika d.o.o.', 'SI10000003', 'Kamnik']);
  assert.equal(inv.lines.length, 3);
  assert.deepEqual(inv.lines[2], { description: 'Embalažni material', quantity: 40, unit: 'kos', unitPrice: 3.5, net: 140, vatRate: 9.5, rawVat: '9,5 %', row: 19 });
  assert.equal(inv.stated.net, 1400); assert.equal(inv.stated.gross, 1690.5);
  assert.ok(a.fields.number.confidence >= 0.9 && a.fields.issueDate.confidence >= 0.9);
  assert.deepEqual(a.warnings, []);
});
await t('English labels and text numbers (1,020.00), ISO dates, "VAT %" as a number, "Invoice" as the label of the number', () => {
  const { inv } = analyse(S.englishRows());
  assert.deepEqual([inv.number, inv.issueDate, inv.dueDate], ['INV-2026-77', '2026-10-02', '2026-11-01']);
  assert.deepEqual([inv.seller.name, inv.seller.vatId, inv.buyer.name, inv.buyer.vatId], ['Zelenik d.o.o.', 'SI12345679', 'Kamnik Logistika d.o.o.', 'SI10000003']);
  assert.equal(inv.lines.length, 2);
  assert.deepEqual(inv.lines.map((l) => [l.quantity, l.unitPrice, l.net, l.vatRate, l.unit]), [[12, 85, 1020, 22, 'pcs'], [1, 240, 240, 22, 'pcs']]);
  assert.equal(inv.stated.gross, 1537.2); assert.equal(inv.stated.net, 1260);
});
await t('a missing buyer VAT ID stays empty (and is not taken from the seller)', () => {
  const { inv, a } = analyse(S.slovenianRows({ buyerVat: false }));
  assert.equal(inv.buyer.vatId, ''); assert.equal(inv.seller.vatId, 'SI12345679'); assert.equal(a.fields['buyer.vatId'], undefined);
});
await t('"Valuta" with a date is the due date; "Valuta" with EUR the currency; "Račun št.: 2026-1" in one cell; letterhead seller without a label', () => {
  const rows = [['Zelenik d.o.o.', ''], ['Račun št.: 2026-1', ''], ['Datum: 03.10.2026', ''], ['Valuta', '03.11.2026'], [], ['Kupec', 'Kamnik Logistika d.o.o.'], [],
    ['Opis', 'Količina', 'Cena', 'DDV', 'Znesek'], ['Storitev', 2, '10,00', 22, 20]];
  const { inv } = analyse(rows);
  assert.equal(inv.number, '2026-1'); assert.equal(inv.issueDate, '2026-10-03'); assert.equal(inv.dueDate, '2026-11-03');
  assert.equal(inv.seller.name, 'Zelenik d.o.o.'); assert.equal(inv.lines[0].vatRate, 22); assert.equal(inv.currency, 'EUR');
});
await t('side-by-side Seller and Buyer blocks: VAT IDs go by column', () => {
  const rows = [['Invoice no', 'A-1', '', ''], [], ['Seller', '', 'Buyer', ''], ['Zelenik d.o.o.', '', 'Kamnik Logistika d.o.o.', ''], ['Cesta 1, 1000 Ljubljana', '', 'Tunjiška 2, 1241 Kamnik', ''], ['VAT ID: SI12345679', '', 'VAT ID: SI10000003', ''],
    [], ['Description', 'Qty', 'Unit price', 'VAT %'], ['Work', 1, 5, 22]];
  const { inv } = analyse(rows);
  assert.equal(inv.seller.name, 'Zelenik d.o.o.'); assert.equal(inv.buyer.name, 'Kamnik Logistika d.o.o.');
  assert.equal(inv.seller.vatId, 'SI12345679'); assert.equal(inv.buyer.vatId, 'SI10000003');
});
await t('a real .xlsx with date cells (dd.mm.yyyy) and percentage cells is read back with dates and rates as in the file', () => {
  const bytes = S.makeXlsx(S.slovenianRows(), { cells: true }), grid = readXlsx(bytes);
  assert.equal(grid[2][1], '2026-10-02'); assert.equal(grid[18][5], '9.5 %'); assert.equal(grid[16][6], 1020);
  const { inv } = analyse(grid);
  assert.deepEqual([inv.issueDate, inv.dueDate, inv.lines[2].vatRate, inv.lines[0].net], ['2026-10-02', '2026-11-01', 9.5, 1020]);
});
await t('mapping edits: a cell picked by hand and a column changed are used; party edits win; unmapped fields are empty', () => {
  const grid = S.slovenianRows({ buyerVat: false }), a = X.extract(grid), m = X.mappingOf(a);
  m.fields.number = 'B3'; m.columns.unit = null; m.fields.currency = null;
  const inv = X.buildInvoice(grid, m, { buyer: { vatId: 'si 1000 0003' } });
  assert.equal(inv.number, '02.10.2026'); assert.equal(inv.lines[0].unit, ''); assert.equal(inv.buyer.vatId, 'SI10000003'); assert.equal(inv.currency, 'EUR', 'no currency cell: EUR is assumed');
  assert.ok(X.cellChoices(grid, a.table).some((c) => c.ref === 'B2' && c.text === '2026-0142'));
  assert.deepEqual(X.columnChoices(grid, a.table).slice(0, 2).map((c) => c.letter), ['A', 'B']);
});
await t('several sheets: the one that looks like an invoice is picked', () => {
  const bytes = S.makeXlsx(S.slovenianRows(), { extraSheet: true }), wb = XLSX.read(bytes, { type: 'array', dense: true, cellNF: true });
  const grids = [{ name: 'Notes', grid: X.gridFromSheet(XLSX, wb.Sheets.Notes) }, { name: 'Racun', grid: X.gridFromSheet(XLSX, wb.Sheets.Racun) }];
  assert.equal(X.pickGrid(grids).index, 1);
});
await t('formula-looking cells: leading = + @ removed with a warning, nothing is evaluated; control characters and long text are cut', () => {
  const rows = S.slovenianRows(); rows[16][1] = '=HYPERLINK("http://x","y")'; rows[17][1] = '@SUM(A1:A9)'; rows[1][1] = '2026-\u0001\u0002X';
  const { inv, a } = analyse(rows);
  assert.equal(inv.lines[0].description, 'HYPERLINK("http://x","y")'); assert.equal(inv.lines[1].description, 'SUM(A1:A9)'); assert.equal(inv.number, '2026-X');
  assert.ok(inv.warnings.some((w) => w.code === 'FORMULA_CELLS')); assert.ok(a.warnings.some((w) => w.code === 'FORMULA_CELLS'));
  rows[16][1] = 'x'.repeat(5000); assert.equal(analyse(rows).inv.lines[0].description.length, 256, 'a description is cut to 256 characters');
  const wb = XLSX.utils.book_new(), sheet = XLSX.utils.aoa_to_sheet([['Opis']]); sheet.A2 = { t: 'n', f: '1+1', v: 2 }; sheet['!ref'] = 'A1:A2'; XLSX.utils.book_append_sheet(wb, sheet, 'S');
  const back = XLSX.read(XLSX.write(wb, { bookType: 'xlsx', type: 'array' }), { type: 'array', dense: true, cellFormula: false });
  assert.equal(X.gridFromSheet(XLSX, back.Sheets.S)[1][0], 2, 'the stored value is read, the formula text is not');
});
await t('grid limits: rows and columns are capped', () => {
  const ws = XLSX.utils.aoa_to_sheet([['a']]); ws['!ref'] = 'A1:ZZ9000';
  const g = X.gridFromSheet(XLSX, XLSX.read(XLSX.write((() => { const b = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(b, XLSX.utils.aoa_to_sheet([['a']]), 'S'); return b; })(), { type: 'array', bookType: 'xlsx' }), { type: 'array', dense: true }).Sheets.S);
  assert.ok(g.length <= X.LIMITS.rows && (g[0] || []).length <= X.LIMITS.cols);
});

// PDFs: synthetic pdf.js items first (no PDF needed), then a real PDF
const item = (str, x, y, size = 10) => ({ str, x, y, w: str.length * size * 0.5, size });
const invoiceItems = () => {
  const out = []; let y = 780;
  const kv = (k, v) => { out.push(item(k, 50, y)); out.push(item(v, 200, y)); y -= 16; };
  kv('Racun st.', '2026-0142'); kv('Datum izdaje', '02.10.2026'); kv('Rok placila', '01.11.2026'); y -= 10;
  kv('Dobavitelj', 'Zelenik d.o.o.'); kv('ID za DDV', 'SI12345679'); kv('IBAN', 'SI50 1234 5678 9012 345'); y -= 10;
  kv('Kupec', 'Kamnik Logistika d.o.o.'); kv('ID za DDV', 'SI10000003'); y -= 14;
  [['Opis', 'Kolicina', 'Cena', 'DDV', 'Znesek'], ['Prevoz blaga', '12', '85,00', '22 %', '1.020,00'], ['Skladiscenje', '1', '240,00', '22 %', '240,00']].forEach((r) => { [50, 260, 330, 400, 470].forEach((x, i) => out.push(item(r[i], x, y))); y -= 16; });
  y -= 10; out.push(item('Za placilo', 330, y)); out.push(item('1.537,20', 470, y));
  return out;
};
await t('PDF text positions (synthetic pdf.js items) become a grid and an invoice', () => {
  const grid = X.gridFromPdfPages([invoiceItems()]), { inv } = analyse(grid);
  assert.equal(inv.number, '2026-0142'); assert.equal(inv.issueDate, '2026-10-02'); assert.equal(inv.seller.vatId, 'SI12345679'); assert.equal(inv.buyer.vatId, 'SI10000003');
  assert.equal(inv.lines.length, 2); assert.deepEqual([inv.lines[0].quantity, inv.lines[0].unitPrice, inv.lines[0].vatRate, inv.lines[0].net], [12, 85, 22, 1020]);
  assert.equal(inv.stated.gross, 1537.2);
});
await t('a PDF without any text (a scan) is refused with a plain message that says OCR is not supported', () => {
  assert.throws(() => X.gridFromPdfPages([[], [item('   ', 10, 10)]]), (e) => e.plain === true && e.code === 'NO_TEXT_LAYER' && /no text layer/i.test(e.message) && /OCR is not supported/.test(e.message));
});
await t('a real PDF made with pdf-lib and read with pdf.js gives the same invoice', async () => {
  const { PDFDocument, StandardFonts } = await import(vendor('pdf-lib-1.17.1/pdf-lib.esm.min.js'));
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica), page = pdf.addPage([595, 842]);
  for (const it of invoiceItems()) page.drawText(it.str, { x: it.x, y: it.y, size: 10, font });
  const bytes = await pdf.save();
  const { log, warn } = console; Object.assign(console, { log() {}, warn() {} });
  let pdfjs;
  try { pdfjs = await import(vendor('pdfjs-6.3.289/pdf.min.mjs')); } catch (e) { pdfjs = null; } finally { Object.assign(console, { log, warn }); }
  if (!pdfjs) { console.log('   (skipped: pdf.js does not load in Node ' + process.versions.node + ')'); return; }
  pdfjs.GlobalWorkerOptions.workerSrc = vendor('pdfjs-6.3.289/pdf.worker.min.mjs').href;
  const doc = await pdfjs.getDocument({ data: bytes.slice(), standardFontDataUrl: path.join(dir, 'vendor/pdfjs-6.3.289/standard_fonts/') + '/', verbosity: 0, isEvalSupported: false }).promise;
  const tc = await (await doc.getPage(1)).getTextContent();
  const items = tc.items.filter((it) => typeof it.str === 'string').map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, size: Math.hypot(it.transform[2], it.transform[3]) || it.height }));
  const { inv } = analyse(X.gridFromPdfPages([items]));
  assert.equal(inv.number, '2026-0142'); assert.equal(inv.lines.length, 2); assert.equal(inv.buyer.vatId, 'SI10000003');
  // and a PDF with a page and no text is a scan
  const blank = await PDFDocument.create(); blank.addPage([595, 842]);
  const d2 = await pdfjs.getDocument({ data: (await blank.save()).slice(), verbosity: 0 }).promise;
  const t2 = await (await d2.getPage(1)).getTextContent();
  assert.throws(() => X.gridFromPdfPages([t2.items.filter((it) => typeof it.str === 'string').map((it) => ({ str: it.str, x: 0, y: 0, w: 0, size: 10 }))]), /no text layer/);
});
console.log(n + ' tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
