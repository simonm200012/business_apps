// Tests for the data tools of Convert (site/convert/lib.mjs): safe XML names, rows to XML and back, XML with nested
// records to rows, PDF text to XML, and table guessing on a real PDF (made with the vendored pdf-lib, read back with
// the vendored pdf.js, as the browser does). Browsers have DOMParser, Node has not: the XML tests read the XML with a
// tiny stand-in parser that builds the same kind of tree (nodeType, localName, attributes, childNodes); the real
// DOMParser path was run once in headless Chrome (see HANDOFF.md, Convert). Run: node --no-warnings tools/tests/convert-data.test.js
'use strict';
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const dir = path.join(__dirname, '../../site/convert');
const vendor = (p) => pathToFileURL(path.join(dir, 'vendor', p));
let n = 0;
async function t(name, fn) { await fn(); n++; console.log('ok', n, name); }

/** A small XML reader for the tests: elements, attributes, text, CDATA, the five entities; no DTDs or namespaces. */
function parseXml(xml) {
  const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const root = { nodeType: 9, childNodes: [] }, stack = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<\/([^>\s]+)\s*>|<([^\s/>]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(xml))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.childNodes.push({ nodeType: 4, nodeValue: m[1] });
    else if (m[2]) { assert.equal(top.localName, m[2], 'closing tag matches'); stack.pop(); }
    else if (m[3]) {
      const el = { nodeType: 1, localName: m[3], attributes: [], childNodes: [] };
      for (const a of m[4].matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) el.attributes.push({ name: a[1], localName: a[1], value: decode(a[2] ?? a[3]) });
      top.childNodes.push(el);
      if (!m[5]) stack.push(el);
    } else if (m[6] !== undefined) top.childNodes.push({ nodeType: 3, nodeValue: decode(m[6]) });
  }
  assert.equal(stack.length, 1, 'every tag closed');
  return { documentElement: root.childNodes.find((c) => c.nodeType === 1) };
}

(async () => {
const L = await import(pathToFileURL(path.join(dir, 'lib.mjs')).href);

await t('xmlName: letters, digits, _ and - only; never a digit, - or "xml" first; accents dropped; unique', () => {
  const used = new Set();
  assert.equal(L.xmlName('Unit price', used), 'Unit_price');
  assert.equal(L.xmlName('Količina (kg)', used), 'Kolicina_kg');
  assert.equal(L.xmlName('2026 total', used), '_2026_total');
  assert.equal(L.xmlName('xml version', used), '_xml_version');
  assert.equal(L.xmlName('XMLData', used), '_XMLData');
  assert.equal(L.xmlName('-minus', used), '_-minus');
  assert.equal(L.xmlName('Unit  price', used), 'Unit_price_2', 'a name already taken gets _2');
  assert.equal(L.xmlName('unit price', used), 'unit_price_3', 'compared without regard to case');
  assert.equal(L.xmlName('', used), 'column'); assert.equal(L.xmlName('€ / %', used), 'column_2', 'only symbols: a plain name is made up, then numbered');
  assert.equal(L.xmlName(null, used), 'column_3');
  for (const x of ['a<b>', 'tag"quote', 'a&b', "o'clock", 'a.b', 'a:b', '😀', '日本語', '__x__']) assert.match(L.xmlName(x, new Set()), /^[A-Za-z_][A-Za-z0-9_-]*$/, x);
});

await t('xmlEscape: the five characters, and characters XML refuses are left out', () => {
  assert.equal(L.xmlEscape(`Fish & "chips" <b> it's`), 'Fish &amp; &quot;chips&quot; &lt;b&gt; it&apos;s');
  assert.equal(L.xmlEscape('a\u0000b\u000Bc'), 'abc');
  assert.equal(L.xmlEscape(12.5), '12.5'); assert.equal(L.xmlEscape(null), '');
});

const rows = [['Name', 'Unit price', 'Qty', 'Note', 'Name'], ['Kava & mleko', '2,50', '3', 'say "hi" <ok>', 'x'], ['Čaj', '1.20', '', '', 'y'], ['Short']];
await t('rows to XML: <rows><row><Header>…</Header></row></rows>, escaped, unique names, short rows padded', () => {
  const { xml, names } = L.rowsToXml(rows);
  assert.deepEqual(names, ['Name', 'Unit_price', 'Qty', 'Note', 'Name_2']);
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<rows>\n  <row>\n    <Name>Kava &amp; mleko</Name>'));
  assert.match(xml, /<Note>say &quot;hi&quot; &lt;ok&gt;<\/Note>/);
  assert.match(xml, /<Qty><\/Qty>/); assert.match(xml, /<Name>Short<\/Name>\n    <Unit_price><\/Unit_price>/);
  assert.equal((xml.match(/<row>/g) || []).length, 3, 'the header row is not a record');
  const doc = parseXml(xml);
  assert.equal(doc.documentElement.localName, 'rows');
});
await t('rows to XML without a header row: Column_1, Column_2 … and every row is a record', () => {
  const { xml, names } = L.rowsToXml([['a', 'b'], ['c', 'd']], { header: false });
  assert.deepEqual(names, ['Column_1', 'Column_2']); assert.equal((xml.match(/<row>/g) || []).length, 2);
  assert.deepEqual(L.rowsToXml([['', 'x'], ['1', '2']]).names, ['Column_1', 'x'], 'an empty header cell gets its column number');
});

await t('rows to XML and back: the values come back as they went in (names cleaned, short rows padded)', () => {
  const { xml } = L.rowsToXml(rows);
  const back = L.xmlToRows(parseXml(xml));
  assert.equal(back.record, 'row'); assert.equal(back.count, 3); assert.equal(back.flattened, 0);
  assert.deepEqual(back.headers, ['Name', 'Unit_price', 'Qty', 'Note', 'Name_2']);
  assert.deepEqual(back.rows, [['Kava & mleko', '2,50', '3', 'say "hi" <ok>', 'x'], ['Čaj', '1.20', '', '', 'y'], ['Short', '', '', '', '']]);
});

const orders = `<?xml version="1.0"?>
<!-- two orders -->
<orders source="shop">
  <order id="A1" status="paid">
    <customer id="7"><name>Ana Novak</name><city>Maribor</city></customer>
    <lines>
      <line><sku>K-1</sku><qty>2</qty></line>
      <line><sku>K-2</sku><qty>1</qty></line>
    </lines>
    <total currency="EUR">35.50</total>
    <note><![CDATA[Fragile & <heavy>]]></note>
  </order>
  <order id="B2" status="open">
    <customer id="9"><name>Bor Kos</name></customer>
    <lines><line><sku>K-3</sku><qty>5</qty></line></lines>
    <total currency="EUR">12</total>
  </order>
</orders>`;
await t('XML to rows on a nested sample: the order is the record, attributes and nested values are columns named parent/child', () => {
  const r = L.xmlToRows(parseXml(orders));
  assert.equal(r.record, 'order', 'the repeated element highest in the tree, not the more frequent <line>');
  assert.equal(r.count, 2);
  assert.deepEqual(r.headers, ['@id', '@status', 'customer/@id', 'customer/name', 'customer/city', 'lines/line/sku', 'lines/line/qty', 'total', 'total/@currency', 'note']);
  assert.deepEqual(r.rows[0], ['A1', 'paid', '7', 'Ana Novak', 'Maribor', 'K-1; K-2', '2; 1', '35.50', 'EUR', 'Fragile & <heavy>']);
  assert.deepEqual(r.rows[1], ['B2', 'open', '9', 'Bor Kos', '', 'K-3', '5', '12', 'EUR', ''], 'a record without a value leaves the cell empty');
  assert.ok(r.flattened >= 5, 'nested columns are counted so the page can warn'); assert.equal(r.merged, 2, 'two cells joined repeated values');
});
await t('XML to rows: flat records, a single record, a list of leaves', () => {
  assert.deepEqual(L.xmlToRows(parseXml('<list><item><a>1</a><b>x</b></item><item><a>2</a><b>y</b></item></list>')).rows, [['1', 'x'], ['2', 'y']]);
  const leaves = L.xmlToRows(parseXml('<tags><tag>red</tag><tag>blue</tag></tags>'));
  assert.deepEqual([leaves.headers, leaves.rows], [['value'], [['red'], ['blue']]], 'leaves repeat under the root: each is a row');
  const one = L.xmlToRows(parseXml('<person id="1"><name>Ana</name></person>'));
  assert.deepEqual([one.headers, one.rows, one.count], [['@id', 'name'], [['1', 'Ana']], 1]);
  assert.deepEqual(L.xmlToRows(parseXml('<a><b><c>1</c></b></a>')).headers, ['c'], 'one wrapped record is the row');
  assert.deepEqual(L.xmlToRows(parseXml('<config><host>h</host><port>80</port></config>')).headers, ['host', 'port'], 'different leaves: the root is the one record');
  assert.equal(L.xmlToRows(parseXml('<r><row><x>1</x></row><row><x>2</x><y>3</y></row></r>')).headers.join(), 'x,y', 'columns from every record, in order first seen');
});

await t('PDF to XML: <document><page n="1"><p>…</p></page></document>, escaped, an empty page kept', () => {
  const pages = [[{ text: 'Invoice & <terms>' }, { text: 'Second paragraph.' }], [], [{ text: 'Page three' }]];
  const xml = L.pagesToXml(pages);
  assert.equal(xml, '<?xml version="1.0" encoding="UTF-8"?>\n<document>\n  <page n="1">\n    <p>Invoice &amp; &lt;terms&gt;</p>\n    <p>Second paragraph.</p>\n  </page>\n  <page n="2"/>\n  <page n="3">\n    <p>Page three</p>\n  </page>\n</document>\n');
  assert.equal(parseXml(xml).documentElement.childNodes.filter((c) => c.nodeType === 1).length, 3);
});

await t('PDF tables from synthetic text items: rows by y, cells by gaps, columns by gutters, text outside the table kept', () => {
  const it = (str, x, y, w = str.length * 5) => ({ str, x, y, w, size: 10 });
  const items = [it('Statement', 50, 800), it('Date', 50, 760), it('Text', 140, 760), it('Amount', 400, 760),
    it('01.10.2026', 50, 744), it('Coffee shop', 140, 744.4), it('-3,20', 420, 744), it('02.10.2026', 50, 728), it('Salary from an employer', 140, 728), it('1.500,00', 400, 728)];
  const r = L.pdfTable(items);
  assert.equal(r.columns, 3); assert.equal(r.tableRows, 3);
  assert.deepEqual(r.rows, [['Statement', '', ''], ['Date', 'Text', 'Amount'], ['01.10.2026', 'Coffee shop', '-3,20'], ['02.10.2026', 'Salary from an employer', '1.500,00']]);
  assert.deepEqual(L.pdfTable([]), { rows: [], columns: 0, tableRows: 0 });
  const prose = L.pdfTable([it('Just one line of text', 50, 700, 105), it('and another line', 50, 686, 80)]);
  assert.equal(prose.columns, 1); assert.equal(prose.tableRows, 0); assert.equal(prose.rows.length, 2);
  assert.deepEqual(L.pdfTable([it('Two', 50, 700, 15), it('words', 70, 700, 25)]).rows, [['Two words']], 'neighbours close together are one cell');
});

await t('PDF to Excel on a real PDF: a 3-column table made with pdf-lib is read back with pdf.js, columns and numbers found', async () => {
  const { PDFDocument, StandardFonts } = await import(vendor('pdf-lib-1.17.1/pdf-lib.esm.min.js'));
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica), page = pdf.addPage([595, 842]);
  page.drawText('Price list October', { x: 50, y: 790, size: 16, font });
  const table = [['Item', 'Quantity', 'Price'], ['Coffee beans', '12', '8,90'], ['Oat milk', '30', '1,25'], ['Paper cups (50)', '4', '1.234,50'], ['Tea', '7', '3,10']];
  table.forEach((r, i) => {
    const y = 740 - i * 20;
    page.drawText(r[0], { x: 50, y, size: 11, font });
    page.drawText(r[1], { x: 300 - font.widthOfTextAtSize(r[1], 11), y, size: 11, font }); // right-aligned, as numbers are
    page.drawText(r[2], { x: 480 - font.widthOfTextAtSize(r[2], 11), y, size: 11, font });
  });
  const bytes = await pdf.save();
  const { log, warn } = console; console.log = console.warn = () => {};
  let pdfjs;
  try { pdfjs = await import(vendor('pdfjs-6.3.289/pdf.min.mjs')); } catch (e) { pdfjs = null; log('   (skipped: pdf.js does not load in Node ' + process.versions.node + ': ' + e.message + ')'); } finally { Object.assign(console, { log, warn }); }
  if (!pdfjs) return;
  pdfjs.GlobalWorkerOptions.workerSrc = vendor('pdfjs-6.3.289/pdf.worker.min.mjs').href;
  const doc = await pdfjs.getDocument({ data: bytes.slice(), standardFontDataUrl: vendor('pdfjs-6.3.289/standard_fonts/').pathname, verbosity: 0, isEvalSupported: false }).promise;
  const tc = await (await doc.getPage(1)).getTextContent();
  const items = tc.items.filter((x) => typeof x.str === 'string').map((x) => ({ str: x.str, x: x.transform[4], y: x.transform[5], w: x.width, size: Math.hypot(x.transform[2], x.transform[3]) }));
  const r = L.pdfTable(items);
  assert.equal(r.columns, 3, 'three columns');
  assert.deepEqual(r.rows[0], ['Price list October', '', ''], 'the title is kept, in the first column');
  assert.deepEqual(r.rows.slice(1), table);
  const dec = L.guessDecimal(r.rows, ';');
  assert.equal(dec, ',');
  assert.deepEqual(r.rows.slice(2).map((row) => row.slice(1).map((v) => L.cellValue(v, dec))), [[12, 8.9], [30, 1.25], [4, 1234.5], [7, 3.1]], 'numbers become numbers');
  // the same table as XML rows, the way the Excel to XML tool writes it
  assert.match(L.rowsToXml(r.rows.slice(1)).xml, /<Item>Paper cups \(50\)<\/Item>\n    <Quantity>4<\/Quantity>\n    <Price>1\.234,50<\/Price>/);
  await doc.loadingTask.destroy();
});

await t('no personal or hub-only names in the Convert code, no outside URLs, no dependency on the shared kit', () => {
  const files = ['app.mjs', 'lib.mjs', 'tools.mjs', 'ui.mjs', 'convert.css', 'index.html'].map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
  assert.doesNotMatch(files, /My Apps|\/kit\/|ledger-base|ilove/i);
  assert.doesNotMatch(files.replace(/https:\/\/fonts\.(googleapis|gstatic)\.com[^"']*/g, ''), /https?:\/\/(?!localhost)/);
  assert.doesNotMatch(files, /@[a-z0-9-]+\.(com|eu|si)\b/i);
  assert.match(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), /stratum-shell\.js/);
});

console.log(n + ' tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
