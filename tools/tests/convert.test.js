// Tests for Convert (site/convert/lib.mjs and its vendored libraries): CSV reading (quotes, line breaks, delimiters, sep=,
// encodings), numbers for Excel, page ranges, fitting pictures, JPEG orientation, file types, which tools fit a file,
// names, the pdfmake table, PDF text grouped into paragraphs and headings; then smoke tests with the vendored libraries
// themselves (pdfmake, pdf-lib, docx, SheetJS, pdf.js) and a check of the vendor folder (versions, licences, no URLs).
// The four data tools (XML, PDF tables) are in convert-data.test.js. Run: node --no-warnings tools/tests/convert.test.js
'use strict';
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { pathToFileURL } = require('url');

const dir = path.join(__dirname, '../../site/convert');
const vendor = (p) => pathToFileURL(path.join(dir, 'vendor', p));
// a classic script, as a <script> tag runs it: in the global scope, without module or exports
const script = (p) => vm.runInThisContext(fs.readFileSync(vendor(p), 'utf8'), { filename: p });
let n = 0;
const log = console.log;
async function t(name, fn) { await fn(); n++; console.log('ok', n, name); }

(async () => {
const L = await import(pathToFileURL(path.join(dir, 'lib.mjs')).href);
let n = 0;
async function t(name, fn) { await fn(); n++; console.log('ok', n, name); }

await t('CSV: quotes, "" inside quotes, line breaks inside quotes, CRLF and CR, empty fields, empty lines skipped', () => {
  assert.deepEqual(L.parseCsv('a,b,c\r\n1,"x, y",3\r\n'), [['a', 'b', 'c'], ['1', 'x, y', '3']]);
  assert.deepEqual(L.parseCsv('name,quote\n"Ana","She said ""hi"""\n'), [['name', 'quote'], ['Ana', 'She said "hi"']]);
  assert.deepEqual(L.parseCsv('a,b\n"line 1\nline 2",x'), [['a', 'b'], ['line 1\nline 2', 'x']]);
  assert.deepEqual(L.parseCsv('a;b\r1;2\r'), [['a;b'], ['1;2']], 'CR only line ends');
  assert.deepEqual(L.parseCsv('a,,c\n,,\n\n\nx,y,z\n'), [['a', '', 'c'], ['', '', ''], ['x', 'y', 'z']], 'a row of empty fields is kept, an empty line is not');
  assert.deepEqual(L.parseCsv('5" screen,ok'), [['5" screen', 'ok']], 'a quote inside an unquoted field stays');
  assert.deepEqual(L.parseCsv('"a","b"\n""'), [['a', 'b'], ['']], 'an explicitly quoted empty line is a row');
  assert.deepEqual(L.parseCsv(''), []);
  assert.deepEqual(L.parseCsv('"unterminated,1\n2'), [['unterminated,1\n2']], 'an open quote takes the rest');
});

await t('CSV: the delimiter is found (semicolon with decimal commas, tab, pipe, comma), sep= and .tsv are honoured', () => {
  assert.equal(L.sniffDelimiter('Datum;Znesek;Opis\n1.10.2026;12,50;Kava, mleko\n2.10.2026;3,20;Kruh\n'), ';');
  assert.equal(L.sniffDelimiter('a\tb\tc\n1\t2\t3\n'), '\t');
  assert.equal(L.sniffDelimiter('a|b\n1|2\n'), '|');
  assert.equal(L.sniffDelimiter('a,b,c\n"1;2",3,4\n'), ',');
  assert.equal(L.sniffDelimiter('just one column\nsecond\n'), ',', 'nothing splits: comma');
  assert.deepEqual(L.readCsv('sep=;\na;b\n1;2'), { rows: [['a', 'b'], ['1', '2']], delimiter: ';' });
  assert.deepEqual(L.readCsv('﻿a,b\n1,2').rows, [['a', 'b'], ['1', '2']], 'BOM dropped');
  assert.equal(L.readCsv('a,b\tc', { ext: 'tsv' }).delimiter, '\t');
  assert.equal(L.readCsv('a,b;c\n1,2;3', { delimiter: ';' }).rows[0].length, 2, 'a chosen delimiter wins');
});

await t('text: UTF-8 with or without BOM, UTF-16 with BOM, anything else as Windows-1250 (č, š, ž)', () => {
  const utf8 = new TextEncoder().encode('Čebelica šž');
  assert.deepEqual(L.decodeText(utf8), { text: 'Čebelica šž', encoding: 'utf-8' });
  assert.equal(L.decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8])).text, 'Čebelica šž');
  assert.deepEqual(L.decodeText(new Uint8Array([0xc8, 0x65, 0x62, 0x65, 0x6c, 0x69, 0x63, 0x61, 0x20, 0x9a, 0x9e])), { text: 'Čebelica šž', encoding: 'windows-1250' });
  assert.equal(L.decodeText(new Uint8Array([0xff, 0xfe, 0x0d, 0x01, 0x61, 0x00])).text, 'ča');
});

await t('Excel numbers: plain numbers become numbers, leading zeros and long digit strings stay text, decimal comma or point', () => {
  assert.equal(L.cellValue('42'), 42); assert.equal(L.cellValue('-12'), -12); assert.equal(L.cellValue('0'), 0);
  assert.equal(L.cellValue('007'), '007'); assert.equal(L.cellValue('1234567890123456'), '1234567890123456'); assert.equal(L.cellValue('SI56 0201 0001 2345 678'), 'SI56 0201 0001 2345 678');
  assert.equal(L.cellValue('1,234.56', '.'), 1234.56); assert.equal(L.cellValue('1.234,56', ','), 1234.56); assert.equal(L.cellValue('12,5', ','), 12.5);
  assert.equal(L.cellValue('12,5', '.'), '12,5'); assert.equal(L.cellValue('12%'), '12%'); assert.equal(L.cellValue('1.10.2026'), '1.10.2026'); assert.equal(L.cellValue('0.5'), 0.5); assert.equal(L.cellValue('00.5'), '00.5');
  assert.equal(L.guessDecimal([['a', 'b'], ['12,50', '3,20'], ['1.5', 'x']], ';'), ',');
  assert.equal(L.guessDecimal([['12,50']], ','), '.', 'a comma CSV cannot have decimal commas outside quotes');
  assert.deepEqual(L.numericColumns([['Name', 'Amount', 'Code'], ['Ana', '12,50', '007'], ['Bor', '3', '010']], ','), [false, true, false]);
});

await t('tidyRows: ragged rows padded, empty columns and empty rows dropped', () => {
  assert.deepEqual(L.tidyRows([['a', '', 'c', ''], ['1'], ['', '', '', ''], ['2', '', '3']]), [['a', 'c'], ['1', ''], ['2', '3']]);
});

await t('page ranges: lists, open ends, dashes and spaces, "all"; mistakes say what to fix', () => {
  assert.deepEqual(L.parseRanges('1-3, 5, 8-', 10), [{ from: 1, to: 3 }, { from: 5, to: 5 }, { from: 8, to: 10 }]);
  assert.deepEqual(L.parseRanges(' -2 ; 4 – 6 ', 10), [{ from: 1, to: 2 }, { from: 4, to: 6 }]);
  assert.deepEqual(L.parseRanges('All', 3), [{ from: 1, to: 3 }]);
  assert.throws(() => L.parseRanges('12', 10), /Page 12 does not exist: the PDF has 10 pages/);
  assert.throws(() => L.parseRanges('2', 1), /the PDF has 1 page\./);
  assert.throws(() => L.parseRanges('5-2', 10), /goes backwards. Write it as 2-5/);
  assert.throws(() => L.parseRanges('0', 10), /Pages start at 1/);
  assert.throws(() => L.parseRanges('two', 10), /“two” is not a page or a range/);
  assert.throws(() => L.parseRanges('-', 10), /is not a page or a range/);
  assert.throws(() => L.parseRanges('  ', 10), /Type the pages/);
  assert.deepEqual(L.expand([{ from: 2, to: 4 }, { from: 7, to: 7 }]), [2, 3, 4, 7]);
  assert.equal(L.rangeLabel([{ from: 1, to: 3 }, { from: 5, to: 5 }]), '1-3_5');
});

await t('pictures: A4 page turned to match, picture fitted inside the margin and centred, render and redraw sizes capped for phones', () => {
  assert.deepEqual(L.pageFor(4000, 3000), [L.A4[1], L.A4[0]]); assert.deepEqual(L.pageFor(3000, 4000), L.A4); assert.deepEqual(L.pageFor(4000, 3000, 'portrait'), L.A4);
  const r = L.fitRect(4000, 3000, 841.89, 595.28, 20);
  assert.ok(Math.abs(r.height - 555.28) < 0.01 && r.width < 841.89 - 40 && Math.abs(r.x - (841.89 - r.width) / 2) < 1e-9 && Math.abs(r.y - 20) < 1e-9, JSON.stringify(r));
  const s = L.fitRect(100, 100, 595.28, 841.89, 0);
  assert.ok(Math.abs(s.width - 595.28) < 1e-9 && Math.abs(s.y - (841.89 - 595.28) / 2) < 1e-9, 'small pictures are scaled up to fit');
  assert.equal(L.renderScale(595.28, 841.89, 72), 1);
  const big = L.renderScale(595.28, 841.89, 600);
  assert.ok(841.89 * big <= 4096.001 && 595.28 * big * 841.89 * big <= 16000001, 'A4 at 600 dpi is held inside the canvas limits');
  assert.deepEqual(L.shrinkTo(8064, 6048), [3200, 2400]); assert.deepEqual(L.shrinkTo(800, 600), [800, 600]);
});

function jpeg(orientation, le = true, jfif = false) {
  const tiff = le ? [0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, orientation, 0, 0, 0, 0, 0, 0, 0] : [0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, 0, 0, 0, 0];
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff], app0 = jfif ? [0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0] : [];
  return new Uint8Array([0xff, 0xd8, ...app0, 0xff, 0xe1, (app1.length + 2) >> 8, (app1.length + 2) & 255, ...app1, 0xff, 0xda, 0, 2, 0xff, 0xd9]);
}
await t('JPEG orientation from EXIF: Intel and Motorola byte order, after a JFIF block, none means upright', () => {
  assert.equal(L.jpegOrientation(jpeg(6)), 6); assert.equal(L.jpegOrientation(jpeg(8, false)), 8); assert.equal(L.jpegOrientation(jpeg(3, true, true)), 3);
  assert.equal(L.jpegOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2])), 1); assert.equal(L.jpegOrientation(new Uint8Array([0x89, 0x50])), 1); assert.equal(L.jpegOrientation(jpeg(9)), 1, 'nonsense values count as upright');
});

await t('file types by their first bytes', () => {
  const b = (s, extra = []) => new Uint8Array([...[...s].map((c) => c.charCodeAt(0)), ...extra]);
  assert.equal(L.sniff(b('%PDF-1.7')), 'pdf'); assert.equal(L.sniff(new Uint8Array([0x50, 0x4b, 3, 4])), 'zip'); assert.equal(L.sniff(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])), 'cfb');
  assert.equal(L.sniff(jpeg(1)), 'jpeg'); assert.equal(L.sniff(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), 'png'); assert.equal(L.sniff(b('RIFF\0\0\0\0WEBP')), 'webp');
  assert.equal(L.sniff(b('\0\0\0\x18ftypheic')), 'heic'); assert.equal(L.sniff(b('\0\0\0\x18ftypavif')), 'avif'); assert.equal(L.sniff(b('hello')), null);
});

await t('tools for dropped files: a .docx opens Word to PDF, one PDF offers six tools (no Merge), several put Merge first (no Split)', () => {
  assert.deepEqual(L.toolsFor(['Report.DOCX']), ['word-pdf']);
  assert.deepEqual(L.toolsFor(['a.pdf']), ['pdf-word', 'pdf-img', 'split', 'pdf-text', 'pdf-excel', 'pdf-xml']);
  assert.deepEqual(L.toolsFor(['a.pdf', 'b.pdf']), ['merge', 'pdf-word', 'pdf-img', 'pdf-text', 'pdf-excel', 'pdf-xml']);
  assert.deepEqual(L.toolsFor(['x.csv']), ['csv-pdf', 'csv-excel', 'excel-xml']);
  assert.deepEqual(L.toolsFor(['data.XML']), ['xml-excel']);
  assert.deepEqual(L.toolsFor(['p.JPG', 'q.webp']), ['img-pdf']);
  assert.deepEqual(L.toolsFor(['notes.md']), ['text-pdf']);
  assert.deepEqual(L.toolsFor(['old.xls']), ['excel-pdf', 'excel-csv', 'excel-xml']);
  assert.deepEqual(L.toolsFor(['a.docx', 'b.pdf']).slice(0, 2), ['word-pdf', 'pdf-word'], 'mixed: the tools that take some of them');
  assert.deepEqual(L.toolsFor(['old.doc']), []);
  assert.match(L.unsupportedHint('old.doc'), /save it as \.docx/); assert.match(L.unsupportedHint('deck.pptx'), /presentation/); assert.match(L.unsupportedHint('a.zip'), /not a file Convert can read/);
  for (const tool of L.TOOLS) assert.ok(L.FORMATS[tool.from] && L.FORMATS[tool.to] && tool.accept.length && L.GROUPS.some(([g]) => g === tool.group), tool.id);
});

await t('names: new extension, (2) for a name already taken, Excel sheet names, sizes, characters Word refuses', () => {
  assert.equal(L.outName('Q3 report.final.docx', 'pdf'), 'Q3 report.final.pdf'); assert.equal(L.outName('scan.PDF', 'png', '-page-1'), 'scan-page-1.png'); assert.equal(L.baseName('.pdf'), 'file');
  assert.equal(L.uniqueName('a.pdf', new Set(['a.pdf', 'a (2).pdf'])), 'a (3).pdf'); assert.equal(L.uniqueName('README', new Set(['README'])), 'README (2)');
  assert.equal(L.sheetName('Q3/2026: [draft] costs and revenue by month'), 'Q3 2026 draft costs and revenue'); assert.equal(L.sheetName(''), 'Sheet1');
  assert.equal(L.formatBytes(512), '512 B'); assert.equal(L.formatBytes(2048), '2 KB'); assert.equal(L.formatBytes(1572864), '1.5 MB'); assert.equal(L.pad(7, 120), '007');
  assert.equal(L.cleanText('a\u0000b\u000Bc\td\ne😀f\uD800'), 'abc\td\ne😀f');
});

await t('errors in plain words', () => {
  assert.match(L.friendlyError(Object.assign(new Error('No password given'), { name: 'PasswordException' }), 'x.pdf'), /x\.pdf is protected with a password/);
  assert.match(L.friendlyError(Object.assign(new Error('Invalid PDF structure.'), { name: 'InvalidPDFException' }), 'x.pdf'), /x\.pdf is not a PDF or it is damaged/);
  assert.match(L.friendlyError(new Error("Can't find end of central directory : is this a zip file ?"), 'a.docx'), /not a real Word or Excel file/);
  assert.match(L.friendlyError(new RangeError('Array buffer allocation failed'), 'big.pdf'), /too big for this device's memory/);
  assert.equal(L.friendlyError(L.plainError('Exactly this.'), 'x'), 'Exactly this.');
  assert.equal(L.friendlyError(new Error('Page 12 does not exist: the PDF has 10 pages.'), 'a.pdf'), 'a.pdf: Page 12 does not exist: the PDF has 10 pages.');
});

await t('table PDF: landscape when wide, a font size that fits, widths by content, numbers right-aligned, header repeated, one section a page', () => {
  const wide = [['Date', 'Shop', 'City', 'Category', 'Amount', 'VAT', 'Card', 'Note', 'Ref'], ['1.10.2026', 'Mercator', 'Ljubljana', 'Groceries', '12,50', '1,10', 'Visa', 'Kava in mleko', 'A1']];
  const lay = L.tableLayout(wide);
  assert.equal(lay.landscape, true); assert.ok(lay.fontSize >= 6 && lay.fontSize <= 10);
  assert.ok(Math.abs(lay.widths.reduce((s, w) => s + parseFloat(w), 0) - 100) < 0.01, lay.widths.join());
  assert.deepEqual(lay.numeric, [false, false, false, false, true, true, false, false, false]);
  assert.equal(L.tableLayout([['a', 'b'], ['1', '2']]).landscape, false, 'narrow: portrait');
  assert.equal(L.tableLayout([['a', 'b']], { orientation: 'landscape' }).landscape, true);
  const doc = L.tableDoc({ title: 'spending.csv', sections: [{ name: 'One', rows: wide }, { name: 'Two', rows: [['x'], ['1']], header: false }, { name: 'Empty', rows: [['', '']] }] });
  assert.equal(doc.pageOrientation, 'landscape');
  const tables = doc.content.filter((c) => c.table);
  assert.equal(tables.length, 2, 'an empty section is skipped');
  assert.equal(tables[0].table.headerRows, 1); assert.deepEqual(tables[0].table.body[0][0], { text: 'Date', style: 'th' }); assert.deepEqual(tables[0].table.body[1][4], { text: '12,50', alignment: 'right' });
  assert.equal(tables[1].table.headerRows, 0);
  assert.deepEqual(doc.content[2], { text: 'Two', style: 'name', pageBreak: 'before', pageOrientation: 'portrait' });
  assert.deepEqual(doc.footer(2, 5).columns[1].text, 'Page 2 of 5');
  assert.throws(() => L.tableDoc({ title: 'e.csv', sections: [{ name: 'e', rows: [['', '']] }] }), /no filled cells/);
  assert.throws(() => L.tableDoc({ title: 'huge.csv', sections: [{ name: 'h', rows: Array(L.MAX_TABLE_ROWS + 1).fill(['x']) }] }), /20,001 rows/);
  assert.equal(L.textDoc('a\n\tb\n\n', 't.txt').content[1].text, '    b'); assert.throws(() => L.textDoc(' \n ', 'e.txt'), /e\.txt is empty/);
});

await t('html-to-pdfmake output fitted: tables share the width (rows padded), pictures never wider than the text', () => {
  const content = L.fitContent([{ table: { body: [[{ text: 'a', colSpan: 2 }, {}], ['b']] } }, { stack: [{ image: 'data:', width: 900, height: 600 }, { image: 'data:', width: 100 }, { image: 'data:' }] }], 480, 700);
  assert.deepEqual(content[0].table.widths, ['*', '*']); assert.equal(content[0].table.body[1].length, 2); assert.equal(content[0].layout, L.GRID_LAYOUT);
  assert.deepEqual(content[1].stack.map((i) => [i.width, i.height]), [[480, undefined], [100, undefined], [480, undefined]]);
});

// one page of pdf.js-like text items: a heading, a paragraph over two lines with a broken word, a gap, a short paragraph,
// two bullets, the second drawn in two pieces with a gap between them
const it = (str, x, y, w, size = 10, extra = {}) => ({ str, x, y, w, size, ...extra });
const PAGE = [
  it('Annual report', 72, 790, 150, 20, { bold: true }), it('', 222, 790, 0, 20, { eol: true }),
  it('This is the first line of a para-', 72, 750, 440), it('', 512, 750, 0, 10, { eol: true }),
  it('graph that continues ', 72, 738, 110), it('here', 182, 738, 20, 10, { bold: true }), it('.', 202, 738, 3, 10, { eol: true }),
  it('Second paragraph after a gap.', 72, 712, 150, 10, { eol: true }),
  it('• first point', 72, 700, 80, 10, { eol: true }),
  it('• second', 72, 688, 45), it('point', 120, 688, 25, 10, { eol: true }),
];
await t('PDF text: lines from items, paragraphs by spacing, bullets and short sentence ends, hyphens joined, bold kept, headings by size', () => {
  const lines = L.textLines(PAGE);
  assert.deepEqual(lines.map((l) => l.text), ['Annual report', 'This is the first line of a para-', 'graph that continues here.', 'Second paragraph after a gap.', '• first point', '• second point']);
  const paras = L.pageParagraphs(PAGE);
  assert.deepEqual(paras.map((p) => p.text), ['Annual report', 'This is the first line of a paragraph that continues here.', 'Second paragraph after a gap.', '• first point', '• second point']);
  assert.deepEqual(paras[1].runs, [{ text: 'This is the first line of a paragraph that continues ', bold: false, italic: false }, { text: 'here', bold: true, italic: false }, { text: '.', bold: false, italic: false }]);
  const pages = L.markHeadings([paras, []]);
  assert.deepEqual(pages[0].map((p) => p.heading), [1, 0, 0, 0, 0]);
  assert.equal(L.pagesToText(pages), 'Annual report\n\nThis is the first line of a para-\ngraph that continues here.\n\nSecond paragraph after a gap.\n\n• first point\n\n• second point\n\n\f');
  assert.deepEqual(L.pageParagraphs([it('', 0, 0, 0)]), []);
  const list = [it('ena', 90, 600, 20, 10, { eol: true }), it('1.', 72, 600, 8), it('dve', 90, 586, 20, 10, { eol: true }), it('2.', 72, 586, 8), it('Total', 300, 572, 30), it('12', 72, 572, 10)];
  assert.deepEqual(L.textLines(list).map((l) => l.text), ['1. ena', '2. dve', 'Total', '12'], 'a list number drawn after its text goes in front; other text on the left does not');
});

// ── smoke tests with the vendored libraries ─────────────────────────────────────────────────────────────
script('pdfmake-0.3.11/pdfmake.min.js'); script('pdfmake-0.3.11/vfs_fonts.js'); script('jszip-3.10.1/jszip.min.js'); script('xlsx-0.20.3/xlsx.full.min.js');
const { pdfMake, JSZip, XLSX } = globalThis;
pdfMake.setUrlAccessPolicy(() => false); pdfMake.setLocalAccessPolicy?.(() => false);
const pdfBytes = async (doc) => new Uint8Array(await pdfMake.createPdf(doc).getBuffer());
const { PDFDocument } = await import(vendor('pdf-lib-1.17.1/pdf-lib.esm.min.js'));
let tablePdf, textPdf;

await t('pdfmake (vendored): a CSV becomes a landscape table PDF with Slovenian letters and page numbers', async () => {
  const csv = 'Datum;Trgovina;Kraj;Kategorija;Znesek;DDV;Kartica;Opomba\n' + Array.from({ length: 120 }, (_, i) => `${i + 1}.10.2026;Čokoladnica Šumi;Žalec;Hrana;${i},50;0,${i % 10}0;Visa;"Kava; mleko"`).join('\n');
  const { rows, delimiter } = L.readCsv(csv);
  assert.equal(delimiter, ';'); assert.equal(rows[1][7], 'Kava; mleko');
  tablePdf = await pdfBytes(L.tableDoc({ title: 'poraba.csv', sections: [{ name: 'poraba.csv', rows }] }));
  assert.equal(L.sniff(tablePdf), 'pdf');
  const doc = await PDFDocument.load(tablePdf);
  assert.ok(doc.getPageCount() >= 3, 'the table runs over several pages'); assert.ok(doc.getPage(0).getWidth() > doc.getPage(0).getHeight(), 'landscape');
  textPdf = await pdfBytes({ pageSize: 'A4', content: [{ text: 'Letno poročilo', fontSize: 22, bold: true, margin: [0, 0, 0, 12] }, { text: 'Prvi odstavek z besedilom, ki se nadaljuje čez dve vrstici, da preverimo, kako se vrstice združijo v en odstavek brez prelomov.', margin: [0, 0, 0, 14] }, { text: 'Drugi odstavek.', pageBreak: 'after' }, { text: 'Stran dve.' }] });
});

await t('pdf-lib (vendored): merge keeps every page in order, split takes ranges', async () => {
  const make = async (sizes) => { const d = await PDFDocument.create(); for (const s of sizes) d.addPage([s, s]); return d.save(); };
  const a = await PDFDocument.load(await make([100, 110])), b = await PDFDocument.load(await make([200, 210, 220])), out = await PDFDocument.create();
  for (const src of [a, b]) for (const p of await out.copyPages(src, src.getPageIndices())) out.addPage(p);
  const merged = await PDFDocument.load(await out.save());
  assert.deepEqual(merged.getPages().map((p) => p.getWidth()), [100, 110, 200, 210, 220]);
  const part = await PDFDocument.create(), pick = L.expand(L.parseRanges('2-3, 5', merged.getPageCount()));
  for (const p of await part.copyPages(merged, pick.map((x) => x - 1))) part.addPage(p);
  assert.deepEqual((await PDFDocument.load(await part.save())).getPages().map((p) => p.getWidth()), [110, 200, 220]);
  await assert.rejects(PDFDocument.load(new TextEncoder().encode('not a pdf')), 'pdf-lib refuses what is not a PDF (the tool says so in words)');
});

await t('docx (vendored): paragraphs, a heading, bold and a page break make a valid Word file', async () => {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import(vendor('docx-9.8.1/docx.mjs'));
  const doc = new Document({ sections: [{ children: [new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: 'Letno poročilo' })] }), new Paragraph({ children: [new TextRun({ text: L.cleanText('Prvi\u0007 odstavek ') }), new TextRun({ text: 'krepko', bold: true })] }), new Paragraph({ pageBreakBefore: true, children: [new TextRun('Stran dve.')] })] }] });
  const zip = await JSZip.loadAsync(await Packer.toBuffer(doc)), xml = await zip.file('word/document.xml').async('string');
  assert.match(xml, /Letno poročilo/); assert.match(xml, /Heading1/); assert.match(xml, /<w:b\/>|<w:b w:val="true"\/>/); assert.match(xml, /pageBreakBefore/); assert.match(xml, /Prvi odstavek/);
});

await t('SheetJS (vendored): CSV to Excel keeps numbers as numbers and codes as text, and Excel back to CSV', async () => {
  const rows = [['Koda', 'Znesek', 'Opis'], ['007', '1.234,56', 'Čaj'], ['010', '3', '=1+1']], dec = L.guessDecimal(rows, ';');
  const ws = XLSX.utils.aoa_to_sheet(rows.map((r) => r.map((v) => L.cellValue(v, dec)))), wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, L.sheetName('poraba/2026'));
  const back = XLSX.read(XLSX.write(wb, { bookType: 'xlsx', type: 'array', compression: true }), { type: 'array' }), s = back.Sheets['poraba 2026'];
  assert.equal(s.A2.t, 's'); assert.equal(s.A2.v, '007'); assert.equal(s.B2.t, 'n'); assert.equal(s.B2.v, 1234.56); assert.equal(s.C3.v, '=1+1'); assert.equal(s.C3.f, undefined, 'text that looks like a formula stays text');
  assert.equal(XLSX.utils.sheet_to_csv(s, { FS: ';' }).split('\n')[1], '007;1234.56;Čaj');
});

await t('pdf.js (vendored): the PDF just made is read back into a heading, a joined paragraph and two pages', async () => {
  let pdfjs;
  const { log, warn } = console; console.log = console.warn = () => {}; // pdf.js tells Node it cannot draw (no canvas): not needed for text
  try { pdfjs = await import(vendor('pdfjs-6.3.289/pdf.min.mjs')); } catch (e) { pdfjs = null; log('   (skipped: pdf.js does not load in Node ' + process.versions.node + ': ' + e.message + ')'); } finally { Object.assign(console, { log, warn }); }
  if (!pdfjs) return;
  pdfjs.GlobalWorkerOptions.workerSrc = vendor('pdfjs-6.3.289/pdf.worker.min.mjs').href;
  const doc = await pdfjs.getDocument({ data: textPdf.slice(), standardFontDataUrl: vendor('pdfjs-6.3.289/standard_fonts/').pathname, verbosity: 0, isEvalSupported: false }).promise, pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    pages.push(L.pageParagraphs(tc.items.filter((x) => typeof x.str === 'string').map((x) => ({ str: x.str, x: x.transform[4], y: x.transform[5], w: x.width, size: Math.hypot(x.transform[2], x.transform[3]), eol: x.hasEOL }))));
  }
  await doc.loadingTask.destroy();
  L.markHeadings(pages);
  assert.equal(pages.length, 2);
  assert.deepEqual(pages[0].map((p) => [p.text, p.heading]), [['Letno poročilo', 1], ['Prvi odstavek z besedilom, ki se nadaljuje čez dve vrstici, da preverimo, kako se vrstice združijo v en odstavek brez prelomov.', 0], ['Drugi odstavek.', 0]]);
  assert.equal(pages[1][0].text, 'Stran dve.');
});

await t('vendored files: exact versions in the folder names, each with its licence, nothing loaded from a CDN', () => {
  const dirs = fs.readdirSync(vendor('')).sort();
  assert.deepEqual(dirs, ['docx-9.8.1', 'html-to-pdfmake-2.5.34', 'jszip-3.10.1', 'mammoth-1.13.0', 'marked-18.0.14', 'pdf-lib-1.17.1', 'pdfjs-6.3.289', 'pdfmake-0.3.11', 'xlsx-0.20.3']);
  for (const d of dirs) assert.ok(fs.readdirSync(vendor(d)).some((f) => /^licen[cs]e/i.test(f)), d + ' has its licence');
  const tools = fs.readFileSync(path.join(__dirname, '../../site/convert/tools.mjs'), 'utf8'), app = fs.readFileSync(path.join(__dirname, '../../site/convert/app.mjs'), 'utf8');
  for (const d of dirs) assert.ok(tools.includes(`'${d}/`), d + ' is the version tools.mjs loads');
  assert.doesNotMatch(tools + app, /https?:\/\/(?!localhost)/, 'no URLs to other sites in the app code');
  assert.match(tools, /setUrlAccessPolicy\(\(\) => false\)/, 'pdfmake refuses every URL');
});
console.log(n + ' tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
