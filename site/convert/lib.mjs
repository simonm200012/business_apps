// Convert: the pure parts (no page, no libraries), shared by app.mjs and tools.mjs and tested by tests/convert.test.mjs:
// the tools and which files fit them, file names, text decoding, CSV reading, page ranges, fitting pictures on a page,
// JPEG orientation, the pdfmake table and text documents, and PDF text grouped into lines and paragraphs.

// ── formats and tools ───────────────────────────────────────────────────────────────────────────────────
export const FORMATS = {
  pdf: { label: 'PDF', color: '#E5322D' }, docx: { label: 'Word', color: '#2B5FD9' }, xlsx: { label: 'Excel', color: '#1E7B45' },
  csv: { label: 'CSV', color: '#0F9D8A' }, img: { label: 'JPG · PNG', color: '#E8A317' }, png: { label: 'PNG', color: '#E8A317' },
  txt: { label: 'TXT', color: '#64748B' }, md: { label: 'Text · MD', color: '#64748B' }, zip: { label: 'ZIP', color: '#8B5CF6' }, xml: { label: 'XML', color: '#B45309' },
};
const IMG = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'gif', 'bmp'], SHEET = ['xlsx', 'xls', 'xlsm', 'ods'];
// group: the filter chips on the start page; combine: all files make one result; order: the list can be reordered;
// single: one file at a time; min: files needed before it can run.
export const TOOLS = [
  { id: 'word-pdf', group: 'to', from: 'docx', to: 'pdf', title: 'Word to PDF', text: 'Headings, paragraphs, bold and italic, lists, tables and pictures, as real text.', accept: ['docx'], glyph: 'doc' },
  { id: 'pdf-word', group: 'from', from: 'pdf', to: 'docx', title: 'PDF to Word', text: 'Editable text in paragraphs, page by page. The layout is simplified.', accept: ['pdf'], glyph: 'edit' },
  { id: 'img-pdf', group: 'to', from: 'img', to: 'pdf', title: 'Images to PDF', text: 'JPG, PNG or WEBP, one page each, fitted on A4. Drag to set the order.', accept: IMG, combine: true, order: true, glyph: 'image' },
  { id: 'pdf-img', group: 'from', from: 'pdf', to: 'png', title: 'PDF to images', text: 'Every page as a PNG picture, zipped when there is more than one.', accept: ['pdf'], glyph: 'images' },
  { id: 'merge', group: 'organize', from: 'pdf', to: 'pdf', title: 'Merge PDF', text: 'Join several PDFs into one, in the order you choose.', accept: ['pdf'], combine: true, order: true, min: 2, glyph: 'merge', color: '#B5179E' },
  { id: 'split', group: 'organize', from: 'pdf', to: 'pdf', title: 'Split PDF', text: 'Every page as its own PDF, or only the pages you choose.', accept: ['pdf'], single: true, glyph: 'split', color: '#F77F00' },
  { id: 'csv-pdf', group: 'to', from: 'csv', to: 'pdf', title: 'CSV to PDF', text: 'A clean table with a header row and page numbers, landscape when it is wide.', accept: ['csv', 'tsv'], glyph: 'table' },
  { id: 'excel-pdf', group: 'to', from: 'xlsx', to: 'pdf', title: 'Excel to PDF', text: 'Every sheet as a table, each on its own pages.', accept: SHEET, glyph: 'sheet' },
  { id: 'text-pdf', group: 'to', from: 'md', to: 'pdf', title: 'Text to PDF', text: 'Plain text, or Markdown with headings, lists, tables and code.', accept: ['txt', 'md', 'markdown'], glyph: 'text' },
  { id: 'pdf-text', group: 'from', from: 'pdf', to: 'txt', title: 'PDF to text', text: 'All the text of a PDF as a .txt file, page by page.', accept: ['pdf'], glyph: 'type' },
  { id: 'csv-excel', group: 'sheets', from: 'csv', to: 'xlsx', title: 'CSV to Excel', text: 'An .xlsx workbook in which numbers are real numbers.', accept: ['csv', 'tsv'], glyph: 'sheet' },
  { id: 'excel-csv', group: 'sheets', from: 'xlsx', to: 'csv', title: 'Excel to CSV', text: 'One CSV file for every sheet, in UTF-8.', accept: SHEET, glyph: 'table' },
  { id: 'pdf-excel', group: 'data', from: 'pdf', to: 'xlsx', title: 'PDF to Excel', text: 'Tables in a computer-made PDF, as rows and columns with real numbers.', accept: ['pdf'], glyph: 'sheet' },
  { id: 'excel-xml', group: 'data', from: 'xlsx', to: 'xml', title: 'Excel or CSV to XML', text: 'One XML file per sheet: a row element for every line, tags from the header.', accept: [...SHEET, 'csv', 'tsv'], glyph: 'code' },
  { id: 'xml-excel', group: 'data', from: 'xml', to: 'xlsx', title: 'XML to Excel', text: 'The repeated records of an XML file as rows; nested values become columns.', accept: ['xml'], glyph: 'sheet' },
  { id: 'pdf-xml', group: 'data', from: 'pdf', to: 'xml', title: 'PDF to XML', text: 'The text of a PDF as XML: pages and paragraphs. Text only.', accept: ['pdf'], glyph: 'code' },
  { id: 'invoice-eslog', group: 'data', from: 'xlsx', to: 'xml', title: 'Invoice to eSLOG XML', text: 'An Excel or PDF invoice as an eSLOG 2.0 XML file, checked in five steps. Nothing leaves this device.', accept: [...SHEET, 'pdf'], glyph: 'invoice', custom: 'eslog', eyebrow: 'Excel or PDF → eSLOG XML', takes: 'Excel (.xlsx, .xls) or PDF invoices' },
];
export const GROUPS = [['all', 'All'], ['to', 'To PDF'], ['from', 'From PDF'], ['organize', 'Organize PDF'], ['sheets', 'Spreadsheets'], ['data', 'Data & XML']];
export const tool = (id) => TOOLS.find((t) => t.id === id) || null;

export const ext = (name) => { const m = /\.([a-z0-9]+)$/i.exec(String(name || '')); return m ? m[1].toLowerCase() : ''; };
export const baseName = (name) => String(name || 'file').replace(/\.[a-z0-9]{1,8}$/i, '') || 'file';
export const fits = (t, name) => t.accept.includes(ext(name));

/** The tools for dropped files, best first: the ones that take every file, then the ones that take some. A single PDF
 * does not suggest Merge, and several do not suggest Split. */
export function toolsFor(names) {
  const pdfs = names.filter((n) => ext(n) === 'pdf').length;
  return TOOLS.map((t, i) => ({ t, i, n: names.filter((n) => fits(t, n)).length }))
    .filter(({ t, n }) => n > 0 && !(t.id === 'merge' && pdfs < 2) && !(t.id === 'split' && pdfs > 1))
    .sort((a, b) => (b.n === names.length) - (a.n === names.length) || (b.t.id === 'merge') - (a.t.id === 'merge') || a.i - b.i)
    .map(({ t }) => t.id);
}

/** Why a file that no tool takes cannot be converted, in plain words. */
export function unsupportedHint(name) {
  const e = ext(name);
  if (e === 'doc') return `${name} is an old Word .doc file. Open it in Word or Pages, save it as .docx and drop that here.`;
  if (['ppt', 'pptx', 'key'].includes(e)) return `${name} is a presentation. Export it as PDF from PowerPoint or Keynote; Convert does not read slides.`;
  if (e === 'pages') return `${name} is a Pages file. In Pages choose File › Export To › Word, then drop the .docx here.`;
  if (e === 'numbers') return `${name} is a Numbers file. In Numbers choose File › Export To › Excel or CSV, then drop that here.`;
  if (e === 'rtf' || e === 'odt') return `${name} cannot be read here. Save it as .docx in your word processor first.`;
  return `${name} is not a file Convert can read. It takes PDF, Word (.docx), Excel (.xlsx, .xls), CSV, XML, JPG, PNG, WEBP, text and Markdown.`;
}

// ── names and sizes ─────────────────────────────────────────────────────────────────────────────────────
export const outName = (name, newExt, suffix = '') => `${baseName(name)}${suffix}.${newExt}`;
/** report.pdf, then report (2).pdf, report (3).pdf … for names already taken. */
export function uniqueName(name, taken) {
  if (!taken.has(name)) return name;
  const m = /^(.*?)(\.[^.]+)?$/.exec(name);
  for (let i = 2; ; i++) { const n = `${m[1]} (${i})${m[2] || ''}`; if (!taken.has(n)) return n; }
}
export const formatBytes = (n) => n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(n < 10485760 ? 1 : 0)} MB`;
export const pad = (n, total) => String(n).padStart(String(total).length, '0');
/** A sheet name Excel accepts: at most 31 characters and none of : \ / ? * [ ]. */
export const sheetName = (s) => String(s || 'Sheet1').replace(/[:\\/?*[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Sheet1';
/** Characters Word (XML) refuses, which PDFs sometimes carry: control characters and broken surrogate pairs. */
export const cleanText = (s) => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '').replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g, (m) => (m.length === 2 ? m : '')); // no lookbehind: older iPhones cannot parse it

// ── what is inside a file ───────────────────────────────────────────────────────────────────────────────
/** The file type from its first bytes, whatever its name says. */
export function sniff(b) {
  const s = (i, str) => [...str].every((c, k) => b[i + k] === c.charCodeAt(0));
  if (s(0, '%PDF-')) return 'pdf';
  if (b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5 || b[2] === 7)) return 'zip'; // docx, xlsx, ods
  if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) return 'cfb'; // old .doc and .xls, or a password-protected docx/xlsx
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b[0] === 0x89 && s(1, 'PNG')) return 'png';
  if (s(0, 'RIFF') && s(8, 'WEBP')) return 'webp';
  if (s(0, 'GIF8')) return 'gif';
  if (s(0, 'BM')) return 'bmp';
  if (s(4, 'ftyp') && /^(heic|heix|hevc|heim|heis|mif1|msf1|avif)$/.test(String.fromCharCode(...b.slice(8, 12)))) return String.fromCharCode(...b.slice(8, 12)) === 'avif' ? 'avif' : 'heic';
  return null;
}

/** Text from bytes: UTF-8 (with or without BOM) or UTF-16 with a BOM; anything else is read as Windows-1250, the
 * Central European code page older Slovenian Excel and Notepad files use. */
export function decodeText(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return { text: new TextDecoder('utf-8').decode(b.subarray(3)), encoding: 'utf-8' };
  if (b[0] === 0xff && b[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(b.subarray(2)), encoding: 'utf-16le' };
  if (b[0] === 0xfe && b[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(b.subarray(2)), encoding: 'utf-16be' };
  try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(b), encoding: 'utf-8' }; } catch { return { text: new TextDecoder('windows-1250').decode(b), encoding: 'windows-1250' }; }
}

// ── CSV ─────────────────────────────────────────────────────────────────────────────────────────────────
/** RFC 4180 CSV: quoted fields may hold the delimiter, line breaks and "" for a quote; CRLF, LF or CR line ends.
 * Lenient like Excel: a quote inside an unquoted field is kept as it is. Empty lines are skipped. */
export function parseCsv(text, delimiter = ',') {
  const rows = [], n = text.length;
  let row = [], field = '', i = 0, quoted = false, wasQuoted = false, wasQuotedRow = false;
  const endField = () => { row.push(field); field = ''; wasQuoted = false; };
  const endRow = () => { endField(); if (row.length > 1 || row[0] !== '' || wasQuotedRow) rows.push(row); row = []; wasQuotedRow = false; };
  while (i < n) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } quoted = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"' && field === '' && !wasQuoted) { quoted = true; wasQuoted = wasQuotedRow = true; i++; continue; }
    if (c === delimiter) { endField(); i++; continue; }
    if (c === '\r' || c === '\n') { endRow(); i += c === '\r' && text[i + 1] === '\n' ? 2 : 1; continue; }
    field += c; i++;
  }
  if (field !== '' || row.length || wasQuoted) endRow();
  return rows;
}

const CANDIDATES = [',', ';', '\t', '|'];
/** The delimiter that splits the first lines into the same number of fields (more than one), most consistently. */
export function sniffDelimiter(text) {
  const sample = text.slice(0, 20000);
  let best = ',', bestScore = 0;
  for (const d of CANDIDATES) {
    const rows = parseCsv(sample, d).slice(0, 30);
    if (rows.length > 1 && sample.length === 20000) rows.pop(); // the last sampled line may be cut short
    const counts = rows.map((r) => r.length), freq = {};
    for (const c of counts) freq[c] = (freq[c] || 0) + 1;
    const [mode, hits] = Object.entries(freq).sort((a, b) => b[1] - a[1] || b[0] - a[0])[0] || [1, 0];
    if (+mode < 2) continue;
    const score = (hits / counts.length) * 100 + Math.min(+mode, 50) / 100; // consistency first, then more columns
    if (score > bestScore) { best = d; bestScore = score; }
  }
  return best;
}

/** CSV text to rows. delimiter: 'auto' or the character; .tsv is tab; Excel's "sep=;" first line is honoured. */
export function readCsv(text, { delimiter = 'auto', ext: e = 'csv' } = {}) {
  text = text.replace(/^﻿/, '');
  const sep = /^sep=(.)\r?\n/i.exec(text);
  if (sep) text = text.slice(sep[0].length);
  const d = sep ? sep[1] : delimiter && delimiter !== 'auto' ? delimiter : e === 'tsv' ? '\t' : sniffDelimiter(text);
  return { rows: parseCsv(text, d), delimiter: d };
}

/** The same number of cells in every row, without columns and rows that are empty all the way. */
export function tidyRows(rows) {
  const width = Math.max(0, ...rows.map((r) => r.length));
  const filled = Array.from({ length: width }, (_, c) => rows.some((r) => String(r[c] ?? '').trim() !== ''));
  return rows.map((r) => filled.flatMap((f, c) => f ? [String(r[c] ?? '')] : [])).filter((r) => r.some((v) => v.trim() !== ''));
}

/** Decimal comma or point: Slovenian exports write 1234,56 (and use ; between fields). */
export function guessDecimal(rows, delimiter = ',') {
  if (delimiter === ',') return '.';
  let comma = 0, point = 0;
  for (const r of rows.slice(0, 500)) for (const v of r) { const s = String(v).trim(); if (/^[+-]?(\d{1,3}(\.\d{3})+|\d+),\d+$/.test(s)) comma++; else if (/^[+-]?(\d{1,3}(,\d{3})+|\d+)\.\d+$/.test(s)) point++; }
  return comma > point ? ',' : '.';
}

/** A CSV cell as Excel should see it: a number when it is plainly one, else the text. Leading zeros (postcodes, phone
 * numbers) and long digit strings (IBANs, card numbers) stay text so nothing is lost. */
export function cellValue(v, decimal = '.') {
  const s = String(v ?? '').trim();
  if (!s || s.length > 20) return v;
  if (/^[+-]?\d+$/.test(s)) return /^[+-]?0\d/.test(s) || s.replace(/^[+-]/, '').length > 15 ? v : Number(s);
  const re = decimal === ',' ? /^[+-]?(\d{1,3}(\.\d{3})+|\d+),\d+$/ : /^[+-]?(\d{1,3}(,\d{3})+|\d+)\.\d+$/;
  if (!re.test(s) || /^[+-]?0\d/.test(s)) return v;
  return Number(decimal === ',' ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, ''));
}
const isNum = (v, decimal) => typeof cellValue(v, decimal) === 'number';
/** Columns that hold numbers (four in five filled cells below the header), to right-align them. */
export function numericColumns(rows, decimal = '.', header = true) {
  const body = rows.slice(header ? 1 : 0, 2001), width = Math.max(0, ...rows.map((r) => r.length));
  return Array.from({ length: width }, (_, c) => { const vals = body.map((r) => String(r[c] ?? '').trim()).filter(Boolean); return vals.length > 0 && vals.filter((v) => isNum(v, decimal)).length / vals.length >= 0.8; });
}

// ── pdfmake documents ───────────────────────────────────────────────────────────────────────────────────
export const A4 = [595.28, 841.89];
export const MAX_TABLE_ROWS = 20000;
const pageNumbers = (title) => (page, pages) => ({ columns: [{ text: title, alignment: 'left' }, { text: `Page ${page} of ${pages}`, alignment: 'right' }], margin: [36, 10, 36, 0], fontSize: 7.5, color: '#7a8394' });
const longest = (v) => Math.max(0, ...String(v).split('\n').map((l) => l.length));

/** A pdfmake table layout for one table: column widths by content, a font size that fits them, landscape for wide
 * tables (orientation 'auto'), numbers right-aligned and a header row that repeats on every page. */
export function tableLayout(rows, { orientation = 'auto', header = true } = {}) {
  const body = tidyRows(rows), cols = Math.max(1, ...body.map((r) => r.length));
  const sample = body.slice(0, 2000), chars = Array.from({ length: cols }, (_, c) => Math.min(40, Math.max(3, ...sample.map((r) => longest(r[c] ?? '')))));
  const total = chars.reduce((a, b) => a + b, 0);
  const landscape = orientation === 'landscape' || (orientation === 'auto' && (cols > 7 || total > 110));
  const width = (landscape ? A4[1] : A4[0]) - 72;
  const fontSize = Math.max(6, Math.min(10, Math.floor(((width - cols * 8) / (total * 0.52)) * 2) / 2)); // Roboto: about half an em per character; 8pt of padding per cell
  const point = numericColumns(body, '.', header), comma = numericColumns(body, ',', header);
  return { body, cols, landscape, fontSize, widths: chars.map((c) => +((c / total) * 100).toFixed(3) + '%'), numeric: point.map((n, c) => n || comma[c]) };
}

/** A PDF of tables, one section (a CSV, an Excel sheet) after another, each starting on a new page. */
export function tableDoc({ title, sections, orientation = 'auto' }) {
  const total = sections.reduce((n, s) => n + s.rows.length, 0);
  if (total > MAX_TABLE_ROWS) throw new Error(`${title} has ${total.toLocaleString('en-GB')} rows; a PDF that long would take too long to make here. Split it into parts of up to ${MAX_TABLE_ROWS.toLocaleString('en-GB')} rows, or use CSV to Excel.`);
  const content = [];
  let first = null;
  sections.forEach((s, i) => {
    const header = s.header !== false, t = tableLayout(s.rows, { orientation, header });
    if (!t.body.length) return;
    const orient = t.landscape ? 'landscape' : 'portrait';
    if (!first) first = orient;
    content.push({ text: s.name, style: 'name', ...(content.length ? { pageBreak: 'before', pageOrientation: orient } : {}) });
    const cell = (v, r, c) => header && r === 0 ? { text: v, style: 'th' } : t.numeric[c] ? { text: v, alignment: 'right' } : v;
    content.push({ table: { headerRows: header ? 1 : 0, widths: t.widths, body: t.body.map((row, r) => row.map((v, c) => cell(v, r, c))) }, fontSize: t.fontSize, layout: TABLE_LAYOUT });
  });
  if (!content.length) throw new Error(`${title} has no filled cells to put in a table.`);
  return {
    pageSize: 'A4', pageOrientation: first, pageMargins: [36, 36, 36, 40], info: { title: baseName(title) }, content,
    footer: pageNumbers(title), defaultStyle: { fontSize: 9, lineHeight: 1.15 },
    styles: { name: { fontSize: 11, bold: true, margin: [0, 0, 0, 8] }, th: { bold: true, color: '#13151b' } },
  };
}
// the table layout: hairlines between rows, a grey header and light zebra stripes (an inline pdfmake layout)
export const TABLE_LAYOUT = {
  hLineWidth: (i, node) => (i === 0 || i === node.table.body.length ? 0.6 : 0.4), vLineWidth: () => 0,
  hLineColor: (i) => (i <= 1 ? '#aeb4c0' : '#dfe2e8'), fillColor: (r, node) => (r < node.table.headerRows ? '#e9ecf2' : r % 2 === 0 ? '#f6f7f9' : null),
  paddingLeft: () => 4, paddingRight: () => 4, paddingTop: () => 2.5, paddingBottom: () => 2.5,
};

/** Plain text as a PDF: lines kept as they are (leading spaces too), tabs as four spaces. */
export function textDoc(text, title) {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (!lines.length) throw new Error(`${title} is empty.`);
  return { pageSize: 'A4', pageMargins: [56, 56, 56, 56], info: { title: baseName(title) }, content: lines.map((l) => ({ text: l || ' ', preserveLeadingSpaces: true })), footer: pageNumbers(title), defaultStyle: { fontSize: 10.5, lineHeight: 1.3 } };
}

/** Styles for HTML from Word (mammoth) and Markdown (marked) turned into pdfmake by html-to-pdfmake. Only Roboto is
 * embedded, so code keeps the same font on a grey background. */
export const HTML_STYLES = {
  h1: { fontSize: 20, bold: true, marginTop: 10, marginBottom: 6 }, h2: { fontSize: 16, bold: true, marginTop: 10, marginBottom: 5 }, h3: { fontSize: 13.5, bold: true, marginTop: 8, marginBottom: 4 },
  h4: { fontSize: 12, bold: true, marginTop: 6, marginBottom: 4 }, h5: { fontSize: 11, bold: true, marginBottom: 3 }, h6: { fontSize: 11, bold: true, italics: true, marginBottom: 3 },
  p: { margin: [0, 0, 0, 7] }, a: { color: '#2B5FD9', decoration: 'underline' }, table: { marginBottom: 8 }, th: { bold: true, fillColor: '#eef0f4' },
  code: { background: '#f0f1f4', fontSize: 9.5 }, pre: { background: '#f0f1f4', fontSize: 9.5, margin: [0, 2, 0, 8] }, blockquote: { color: '#566072', italics: true, margin: [12, 0, 0, 8] },
  ul: { marginBottom: 7, marginLeft: 6 }, ol: { marginBottom: 7, marginLeft: 6 },
};

/** Fixes html-to-pdfmake output for the page: tables share the page width, pictures are never wider than the text. */
export function fitContent(node, maxWidth, maxHeight) {
  if (Array.isArray(node)) { node.forEach((n) => fitContent(n, maxWidth, maxHeight)); return node; }
  if (!node || typeof node !== 'object') return node;
  if (node.table && Array.isArray(node.table.body) && node.table.body.length) {
    const cols = Math.max(...node.table.body.map((r) => r.length)); // html-to-pdfmake already adds the cells a colspan covers
    node.table.widths = Array(cols).fill('*');
    node.table.body.forEach((r) => { while (r.length < cols) r.push(''); });
    node.layout = GRID_LAYOUT;
  }
  if (node.image) {
    if (!node.width || node.width > maxWidth) { node.width = Math.min(node.width || maxWidth, maxWidth); delete node.height; }
    if (node.height && node.height > maxHeight) { node.fit = [maxWidth, maxHeight]; delete node.width; delete node.height; }
  }
  for (const k of ['stack', 'columns', 'ul', 'ol', 'text']) if (Array.isArray(node[k])) fitContent(node[k], maxWidth, maxHeight);
  if (node.table) node.table.body.forEach((r) => fitContent(r, maxWidth, maxHeight));
  return node;
}
export const GRID_LAYOUT = { hLineWidth: () => 0.5, vLineWidth: () => 0.5, hLineColor: () => '#c9ced8', vLineColor: () => '#c9ced8', paddingLeft: () => 5, paddingRight: () => 5, paddingTop: () => 3, paddingBottom: () => 3 };

// ── pages and pictures ──────────────────────────────────────────────────────────────────────────────────
/** "1-3, 5, 8-" → [{ from: 1, to: 3 }, { from: 5, to: 5 }, { from: 8, to: count }] (1-based, inclusive). "-3" is from
 * the start, "all" every page. Throws a message that says what to fix. */
export function parseRanges(text, count) {
  const s = String(text || '').trim().toLowerCase().replace(/\s*[-–—]\s*/g, '-');
  if (!s) throw new Error('Type the pages you want, for example 1-3, 5.');
  if (s === 'all') return [{ from: 1, to: count }];
  return s.split(/[,;\s]+/).filter(Boolean).map((part) => {
    const m = /^(\d*)-(\d*)$/.exec(part) || /^(\d+)()$/.exec(part);
    if (!m || (m[1] === '' && m[2] === '')) throw new Error(`“${part}” is not a page or a range. Use numbers like 2 or 1-3.`);
    const single = !part.includes('-'), from = m[1] === '' ? 1 : +m[1], to = single ? from : m[2] === '' ? count : +m[2];
    if (from < 1 || to < 1) throw new Error('Pages start at 1.');
    for (const p of [from, to]) if (p > count) throw new Error(`Page ${p} does not exist: the PDF has ${count} ${count === 1 ? 'page' : 'pages'}.`);
    if (from > to) throw new Error(`“${part}” goes backwards. Write it as ${to}-${from}.`);
    return { from, to };
  });
}
export const expand = (ranges) => ranges.flatMap((r) => Array.from({ length: r.to - r.from + 1 }, (_, i) => r.from + i));
export const rangeLabel = (ranges) => ranges.map((r) => (r.from === r.to ? r.from : `${r.from}-${r.to}`)).join('_').slice(0, 40);

/** The A4 page for a picture: 'auto' turns the page to match the picture. */
export const pageFor = (w, h, mode = 'auto') => (mode === 'landscape' || (mode === 'auto' && w > h) ? [A4[1], A4[0]] : [...A4]);
/** A picture scaled to fill the page inside the margin, keeping its proportions, centred. */
export function fitRect(iw, ih, pw, ph, margin = 0) {
  const scale = Math.min((pw - 2 * margin) / iw, (ph - 2 * margin) / ih), width = iw * scale, height = ih * scale;
  return { x: (pw - width) / 2, y: (ph - height) / 2, width, height };
}
/** The render scale for a page at dpi, kept inside what phones can draw: iPhone Safari refuses canvases above about
 * 16.7 million pixels, and sides above 4096 are risky on older ones. */
export function renderScale(wPt, hPt, dpi, maxSide = 4096, maxArea = 16000000) {
  let s = dpi / 72;
  s = Math.min(s, maxSide / Math.max(wPt, hPt), Math.sqrt(maxArea / (wPt * hPt)));
  return Math.max(0.1, s);
}
/** A picture's long side kept at most `max` pixels (and its area inside the canvas limit) when it has to be redrawn. */
export function shrinkTo(w, h, max = 3200, maxArea = 16000000) {
  const s = Math.min(1, max / Math.max(w, h), Math.sqrt(maxArea / (w * h)));
  return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))];
}

/** The EXIF orientation of a JPEG (1 = upright, 6 = turned right …), 1 when there is none. Phone photos are often
 * stored sideways with this tag, which PDF viewers ignore, so those get redrawn upright. */
export function jpegOrientation(b) {
  if (b[0] !== 0xff || b[1] !== 0xd8) return 1;
  let i = 2;
  while (i + 4 < b.length) {
    if (b[i] !== 0xff) return 1;
    const marker = b[i + 1], len = (b[i + 2] << 8) | b[i + 3];
    if (marker === 0xda || marker === 0xd9) return 1; // image data starts: no EXIF before it
    if (marker === 0xe1 && b[i + 4] === 0x45 && b[i + 5] === 0x78 && b[i + 6] === 0x69 && b[i + 7] === 0x66) { // "Exif"
      const t = i + 10, le = b[t] === 0x49;
      const u16 = (o) => (le ? b[t + o] | (b[t + o + 1] << 8) : (b[t + o] << 8) | b[t + o + 1]);
      const u32 = (o) => (le ? (b[t + o] | (b[t + o + 1] << 8) | (b[t + o + 2] << 16)) + b[t + o + 3] * 16777216 : b[t + o] * 16777216 + ((b[t + o + 1] << 16) | (b[t + o + 2] << 8) | b[t + o + 3]));
      const ifd = u32(4), entries = u16(ifd);
      for (let k = 0; k < entries; k++) { const e = ifd + 2 + k * 12; if (t + e + 10 > b.length) break; if (u16(e) === 0x0112) { const v = u16(e + 8); return v >= 1 && v <= 8 ? v : 1; } }
      return 1;
    }
    i += 2 + len;
  }
  return 1;
}

// ── PDF text into lines and paragraphs ──────────────────────────────────────────────────────────────────
const quantile = (a, q) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const BULLET = /^\s*([•●▪◦‣∙·*–-]|\(?\d{1,3}[.)]|\(?[a-z][.)])\s/, MARKER = /^\s*([•●▪◦‣∙·*–-]|\(?\d{1,3}[.)]|\(?[a-zA-Z][.)])\s*$/;

/** One page of pdf.js text items ({ str, x, y, w, size, eol, bold, italic }, PDF units with y going up, in the order
 * the PDF draws them) as lines: a new line when the text moves down or back, a space where there is a gap. */
export function textLines(items) {
  const lines = [];
  let line = null, breakNext = false;
  for (const it of items) {
    const size = it.size || 10;
    if (it.str === '') { if (it.eol) breakNext = true; continue; }
    const dy = line ? Math.abs(it.y - line.y) : 0;
    if (line && dy <= 0.3 * Math.max(size, line.size) && MARKER.test(it.str) && it.x + (it.w || 0) <= line.x + 0.5 && it.x >= line.x - 4 * size) {
      // a list number or bullet drawn after its text (pdfmake does), just left of it on the same baseline: put it in front
      line.runs.unshift({ text: it.str.trim() + ' ', bold: Boolean(it.bold), italic: Boolean(it.italic) }); line.text = it.str.trim() + ' ' + line.text; line.x = it.x;
      continue;
    }
    if (!line || breakNext || dy > 0.5 * Math.max(size, line.size) || it.x < line.endX - 2 * size) {
      line = { y: it.y, x: it.x, endX: it.x, size, runs: [], text: '' }; lines.push(line);
    } else {
      const gap = it.x - line.endX;
      if (gap > size * 0.18 && !/\s$/.test(line.text) && !/^\s/.test(it.str)) add(line, gap > size * 3 ? '   ' : ' ', it);
    }
    add(line, it.str, it);
    line.endX = Math.max(line.endX, it.x + (it.w || 0));
    line.size = Math.max(line.size, size);
    breakNext = Boolean(it.eol);
  }
  return lines.map((l) => ({ ...l, text: l.text.replace(/\s+$/, '') })).filter((l) => l.text.trim());
}
function add(line, str, it) {
  const last = line.runs[line.runs.length - 1], bold = Boolean(it.bold), italic = Boolean(it.italic);
  if (last && last.bold === bold && last.italic === italic) last.text += str; else line.runs.push({ text: str, bold, italic });
  line.text += str;
}

/** Lines of one page grouped into paragraphs: a new one after a bigger gap than the usual line spacing, at a change of
 * text size, at a list bullet, or after a short line that ends a sentence. Lines are joined with a space; a word
 * broken with a hyphen at a line end is joined again. */
export function pageParagraphs(items) {
  const lines = textLines(items);
  if (!lines.length) return [];
  // the line spacing inside a paragraph is the small regular gap (lower quartile; between lines of the same size, so a
  // heading does not count), and a full line ends near the right edge most lines reach
  const gaps = [];
  for (let i = 1; i < lines.length; i++) { const a = lines[i - 1], b = lines[i], g = a.y - b.y; if (Math.abs(a.size - b.size) <= 0.1 * a.size && g >= 0.8 * b.size && g < 3 * b.size) gaps.push(g); }
  const spacing = quantile(gaps, 0.25) || lines[0].size * 1.2, right = quantile(lines.map((l) => l.endX), 0.9);
  const paras = [];
  let p = null;
  lines.forEach((l, i) => {
    const prev = lines[i - 1], gap = prev ? prev.y - l.y : 0;
    const fresh = !p || gap <= 0 || gap > spacing * 1.45 || Math.abs(l.size - prev.size) > 0.15 * prev.size || BULLET.test(l.text)
      || (/[.!?:]["”’)]?$/.test(prev.text) && prev.endX < right * 0.8);
    if (fresh) { p = { runs: l.runs.map((r) => ({ ...r })), size: l.size, lines: [l.text], chars: l.text.length }; paras.push(p); return; }
    const last = p.runs[p.runs.length - 1], hyphen = /\p{L}-$/u.test(last.text) && /^\p{Ll}/u.test(l.text);
    if (hyphen) last.text = last.text.slice(0, -1); else last.text += ' ';
    for (const r of l.runs) { const end = p.runs[p.runs.length - 1]; if (end.bold === r.bold && end.italic === r.italic) end.text += r.text; else p.runs.push({ ...r }); }
    p.lines.push(l.text); p.chars += l.text.length;
  });
  return paras.map((x) => ({ ...x, runs: x.runs.map((r) => ({ ...r, text: cleanText(r.text) })).filter((r) => r.text), text: cleanText(x.runs.map((r) => r.text).join('')) }));
}

/** Marks headings across the document: short paragraphs set clearly larger than the body text (the size most of the
 * characters have) become heading 1 (half again as big) or heading 2. */
export function markHeadings(pages) {
  const bySize = new Map();
  for (const page of pages) for (const p of page) { const k = Math.round(p.size * 2) / 2; bySize.set(k, (bySize.get(k) || 0) + p.chars); }
  const body = [...bySize.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 10;
  for (const page of pages) for (const p of page) p.heading = p.text.length > 160 ? 0 : p.size >= body * 1.5 ? 1 : p.size >= body * 1.2 ? 2 : 0;
  return pages;
}

/** The text of every page: lines as in the PDF, a blank line between paragraphs and a form feed between pages (like
 * pdftotext). */
export const pagesToText = (pages) => pages.map((page) => page.map((p) => p.lines.map(cleanText).join('\n')).join('\n\n')).join('\n\n\f');

// ── errors in plain words ───────────────────────────────────────────────────────────────────────────────
/** A library's error message turned into what happened and what to do. */
export function friendlyError(e, name = 'This file') {
  const msg = String((e && (e.message || e.name)) || e || ''), kind = String((e && e.name) || '');
  if (e && e.plain) return msg;
  if (/password|encrypt/i.test(msg + kind)) return `${name} is protected with a password or encryption. Open it, then print or save it as a new PDF without the password, and try again.`;
  if (/InvalidPDF|Invalid PDF|No PDF header|Failed to parse PDF|PDF header|parse.*xref|MissingPDF/i.test(msg + kind)) return `${name} is not a PDF or it is damaged.`;
  if (/central directory|corrupted zip|end of data|not a valid zip|zip file|Can't find end/i.test(msg)) return `${name} could not be opened: it is not a real Word or Excel file, or it is damaged.`;
  if (kind === 'RangeError' || /out of memory|allocation failed|Array buffer allocation|too large/i.test(msg)) return `${name} is too big for this device's memory. Try a smaller file, or use a computer.`;
  return `${name}: ${msg || 'something went wrong'}.`.replace(/\.\.$/, '.');
}
/** An error whose message is already in plain words (shown as it is). */
export const plainError = (message) => Object.assign(new Error(message), { plain: true });

// ── XML ─────────────────────────────────────────────────────────────────────────────────────────────────
/** A safe XML element name from a header cell: letters, digits, _ and - only (accents dropped: č becomes c), spaces and
 * other characters become _, it never starts with a digit, - or "xml" (a _ goes in front), and it is not in `used`
 * (then _2, _3 … is added). The chosen name is added to `used`. */
export function xmlName(text, used = new Set()) {
  let n = String(text ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/_{2,}/g, '_').replace(/^_+|_+$/g, '');
  if (!n) n = 'column';
  if (/^[0-9-]/.test(n) || /^xml/i.test(n)) n = '_' + n;
  let name = n;
  for (let i = 2; used.has(name.toLowerCase()); i++) name = `${n}_${i}`;
  used.add(name.toLowerCase());
  return name;
}
/** Text for an XML element or attribute: & < > " ' escaped, characters XML refuses left out. */
export const xmlEscape = (s) => cleanText(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
export const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>\n';

/** Rows (the first one the header) as <rows><row><Header_Name>value</Header_Name></row></rows>. Without a header the
 * elements are Column_1, Column_2 … Cells beyond the header get Column_<n> names too. Returns { xml, names }. */
export function rowsToXml(rows, { header = true } = {}) {
  const width = Math.max(0, ...rows.map((r) => r.length)), used = new Set();
  const head = header && rows.length ? rows[0] : [], body = header ? rows.slice(1) : rows;
  const names = Array.from({ length: width }, (_, c) => (String(head[c] ?? '').trim() ? xmlName(head[c], used) : xmlName(`Column_${c + 1}`, used)));
  const lines = [XML_DECLARATION.trim(), '<rows>'];
  for (const r of body) {
    lines.push('  <row>');
    for (let c = 0; c < width; c++) lines.push(`    <${names[c]}>${xmlEscape(r[c] ?? '')}</${names[c]}>`);
    lines.push('  </row>');
  }
  lines.push('</rows>');
  return { xml: lines.join('\n') + '\n', names };
}

const childEls = (el) => [...el.childNodes].filter((n) => n.nodeType === 1);
const nm = (el) => el.localName || el.nodeName;
const ownText = (el) => [...el.childNodes].filter((n) => n.nodeType === 3 || n.nodeType === 4).map((n) => n.nodeValue).join('').replace(/\s+/g, ' ').trim();
/** The records of an XML document (a DOM Document or its root element; any DOM-like tree with nodeType, localName,
 * attributes, childNodes works). The record element is the repeated element that has child elements and sits highest in the tree
 * (the most frequent one when several do); with none repeated, the root's same-named children are the records (or the root itself is the one record). Each record is
 * a row: attributes are columns named @name, leaf elements are named by their path below the record
 * (customer/name, customer/@id), and repeated leaves under one path are joined with "; ". Returns
 * { headers, rows, record, count, flattened, merged } where `flattened` counts the nested columns and `merged` the
 * cells that joined repeated values. */
export function xmlToRows(docOrRoot) {
  const root = docOrRoot.documentElement || docOrRoot;
  const seen = new Map();
  (function walk(el, depth) {
    const kids = childEls(el);
    if (el !== root && kids.length) { const e = seen.get(nm(el)) || { n: 0, depth, el: nm(el) }; e.n++; e.depth = Math.min(e.depth, depth); seen.set(nm(el), e); }
    for (const k of kids) walk(k, depth + 1);
  })(root, 0);
  const repeated = [...seen.values()].filter((e) => e.n >= 2).sort((a, b) => a.depth - b.depth || b.n - a.n)[0];
  let records;
  if (repeated) { records = []; (function find(el) { for (const k of childEls(el)) { if (nm(k) === repeated.el && childEls(k).length) records.push(k); else find(k); } })(root); }
  else {
    const kids = childEls(root); // nothing repeats: a list of same-named leaves is rows, a lone wrapped record is the row, else the root itself
    records = kids.length >= 2 && kids.every((k) => nm(k) === nm(kids[0])) ? kids : kids.length === 1 && childEls(kids[0]).length ? kids : [root];
  }
  const headers = [], index = new Map();
  let merged = 0;
  const rows = records.map((rec) => {
    const cells = new Map();
    const put = (path, v) => { if (cells.has(path)) { cells.set(path, cells.get(path) + '; ' + v); merged++; } else cells.set(path, v); };
    (function read(el, path) {
      const base = path ? path + '/' : '';
      const kids = childEls(el), text = ownText(el), attrs = () => { for (const a of [...(el.attributes || [])]) put(base + '@' + (a.localName || a.name), a.value); };
      if (!kids.length) { if (path) { put(path, text); attrs(); } else { attrs(); put('value', text); } return; } // a leaf: its value, then its attributes
      attrs();
      if (text) put(base + '#text', text);
      for (const k of kids) read(k, base + nm(k));
    })(rec, '');
    for (const p of cells.keys()) if (!index.has(p)) { index.set(p, headers.length); headers.push(p); }
    return cells;
  });
  const out = rows.map((m) => headers.map((h) => m.get(h) ?? ''));
  return { headers, rows: out, record: repeated ? repeated.el : nm(root), count: records.length, flattened: headers.filter((h) => h.replace(/@.*$/, '').includes('/')).length, merged };
}

/** The pages of paragraphs (as pageParagraphs gives them) as <document><page n="1"><p>…</p></page></document>. */
export function pagesToXml(pages) {
  const lines = [XML_DECLARATION.trim(), '<document>'];
  pages.forEach((paras, i) => {
    if (!paras.length) { lines.push(`  <page n="${i + 1}"/>`); return; }
    lines.push(`  <page n="${i + 1}">`);
    for (const p of paras) lines.push(`    <p>${xmlEscape(p.text)}</p>`);
    lines.push('  </page>');
  });
  lines.push('</document>');
  return lines.join('\n') + '\n';
}

// ── tables in PDFs ──────────────────────────────────────────────────────────────────────────────────────
/** One page of pdf.js text items ({ str, x, y, w, size }, y going up) as table rows. Rows: items whose baselines are
 * within 40 % of the text size. Cells: neighbours closer than 60 % of the text size are one cell. Columns: the
 * horizontal bands that rows with two or more cells fill, with gutters between them; a cell goes to the column its
 * left edge is in. Returns { rows, columns, tableRows } where tableRows counts the rows that really have two or
 * more cells. Nothing is ever dropped: text outside any table lands in the column where it starts. */
export function pdfTable(items, { rowTol = 0.4, cellGap = 0.6, gutter = 0.3 } = {}) {
  const its = items.filter((it) => typeof it.str === 'string' && it.str.trim()).map((it) => ({ ...it, size: it.size || 10, w: it.w || 0 }));
  if (!its.length) return { rows: [], columns: 0, tableRows: 0 };
  const size = quantile(its.map((i) => i.size), 0.5) || 10;
  its.sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const it of its) {
    const l = lines[lines.length - 1];
    if (l && Math.abs(l.y - it.y) <= rowTol * Math.max(size, it.size)) { l.items.push(it); l.y = (l.y * (l.items.length - 1) + it.y) / l.items.length; } else lines.push({ y: it.y, items: [it] });
  }
  const rows = lines.map((l) => {
    const cells = [];
    for (const it of l.items.sort((a, b) => a.x - b.x)) {
      const c = cells[cells.length - 1];
      if (c && it.x - c.x1 < cellGap * size) { c.text += (it.x - c.x1 > 0.15 * size && !/\s$/.test(c.text) && !/^\s/.test(it.str) ? ' ' : '') + it.str; c.x1 = Math.max(c.x1, it.x + it.w); }
      else cells.push({ x0: it.x, x1: it.x + it.w, text: it.str });
    }
    return cells.map((c) => ({ ...c, text: cleanText(c.text).replace(/\s+/g, ' ').trim() })).filter((c) => c.text);
  }).filter((r) => r.length);
  const multi = rows.filter((r) => r.length >= 2);
  const spans = multi.flat().map((c) => [c.x0, Math.max(c.x1, c.x0 + 1)]).sort((a, b) => a[0] - b[0]);
  const cols = [];
  for (const [a, b] of spans) { const c = cols[cols.length - 1]; if (c && a - c[1] < gutter * size) c[1] = Math.max(c[1], b); else cols.push([a, b]); }
  const colOf = (x) => { if (!cols.length) return 0; let k = cols.findIndex((c) => x < c[1] + gutter * size / 2); if (k < 0) k = cols.length - 1; return k; };
  const width = Math.max(1, cols.length), table = rows.map((r) => {
    const out = Array(width).fill('');
    for (const c of r) { const k = Math.min(width - 1, colOf(c.x0 + 0.5)); out[k] = out[k] ? out[k] + ' ' + c.text : c.text; }
    return out;
  });
  const used = Array.from({ length: width }, (_, c) => table.some((r) => r[c]));
  return { rows: table.map((r) => r.filter((_, c) => used[c])), columns: used.filter(Boolean).length, tableRows: multi.length };
}
