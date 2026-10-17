// eSLOG invoice: from an Excel sheet or a text-layer PDF to a grid of cells, then to a field mapping with a confidence
// for every guess, then to the normalised invoice (model.mjs). Pure (no page): SheetJS is passed in, PDF text comes in as
// pdf.js items. Tested by tools/tests/eslog-extract.test.js.
//
// How the guessing works (no AI, only rules):
//  - Header words are compared after lower-casing and dropping accents (račun = racun), in Slovenian and English.
//  - A label cell ("Datum izdaje", "Invoice date:", "ID za DDV: SI12345679") finds its value in the same cell after the
//    colon, in the next filled cell to the right, or in the cell below. The confidence is how well the label matched
//    (exact 95 %, label followed by the value 80 %, label inside longer text 60 %) times where the value was found
//    (right 100 %, below 85 %) times whether the value looks right for the field (a date field needs a real date).
//  - The line table is the row with the most column headers (Opis, Količina, Cena, DDV ...); lines run down to the first
//    blank or total row.
//  - Seller and buyer: the cells labelled Dobavitelj/Seller and Kupec/Buyer start two blocks; VAT ID, IBAN and address
//    labels belong to the block they sit in (by row, or by column when the blocks stand side by side).
// A mapping ({fields: key → cell, columns: key → column, table}) is what the page lets the user change; buildInvoice
// turns grid + mapping into the invoice again every time, so edits are never lost.
import { cleanText, pdfTable, plainError } from '../lib.mjs';
import {
  emptyInvoice, emptyLine, ibanOk, normalizeIban, normalizeVatId, parseDate, parseNumber, parseVatRate, safeText, round2, vatIdShape,
} from './model.mjs';

export const LIMITS = { fileBytes: 10 * 1024 * 1024, rows: 3000, cols: 60, pdfPages: 40, textChars: 512 };

// ── cells and references ────────────────────────────────────────────────────────────────────────────────
export const colLetter = (c) => { let s = ''; for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
export const colIndex = (letters) => [...String(letters).toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
export const refOf = (r, c) => colLetter(c) + (r + 1);
export function parseRef(ref) { const m = /^([A-Za-z]{1,3})(\d{1,5})$/.exec(String(ref || '')); return m ? { r: +m[2] - 1, c: colIndex(m[1]) } : null; }
const cellAt = (grid, r, c) => (grid[r] && grid[r][c] != null ? grid[r][c] : '');
const text = (v) => (typeof v === 'number' ? String(v) : String(v ?? '')).replace(/\s+/g, ' ').trim();
const filled = (v) => text(v) !== '';

/** Lower case, accents dropped (č → c), everything but letters, digits and % turned into single spaces. */
export const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9%]+/g, ' ').trim();

// ── from files to grids ─────────────────────────────────────────────────────────────────────────────────
/** A SheetJS worksheet (read with dense: true) as a grid of strings and numbers: dates become YYYY-MM-DD, percentages
 * "22 %" (Excel stores 22 % as 0.22), formulas are never run (only the stored value is read), errors are empty. */
export function gridFromSheet(XLSX, ws) {
  const data = ws['!data'] || [], ref = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']) : null;
  if (!ref) return [];
  const grid = [], rows = Math.min(ref.e.r + 1, LIMITS.rows), cols = Math.min(ref.e.c + 1, LIMITS.cols);
  for (let r = ref.s.r; r < rows; r++) {
    const out = [];
    for (let c = ref.s.c; c < cols; c++) {
      const cell = data[r] && data[r][c];
      let v = '';
      if (cell && cell.v != null) {
        if (cell.t === 'n' && cell.z && XLSX.SSF.is_date(cell.z)) { try { v = XLSX.SSF.format('yyyy-mm-dd', cell.v); } catch { v = String(cell.v); } }
        else if (cell.t === 'n' && cell.z && /%/.test(cell.z)) v = `${Math.round(cell.v * 1e6) / 1e4} %`;
        else if (cell.t === 'n') v = cell.v;
        else if (cell.t === 'd') v = cell.v instanceof Date ? cell.v.toISOString().slice(0, 10) : String(cell.v);
        else if (cell.t === 'e') v = '';
        else v = cleanText(String(cell.v));
      }
      out.push(v);
    }
    grid.push(out);
  }
  return trimGrid(grid);
}
/** Cuts empty rows and columns off the edges (keeps the positions: A1 stays A1 as long as the first row/column has data). */
function trimGrid(grid) {
  let last = grid.length - 1;
  while (last >= 0 && !grid[last].some(filled)) last--;
  return grid.slice(0, last + 1);
}

/** The text items of PDF pages ({ str, x, y, w, size }, y going up) as one grid: rows and columns guessed from where the
 * text sits (pdfTable), pages one under the other. Throws a plain error when no page has text (a scan). */
export function gridFromPdfPages(pages) {
  if (!pages.some((p) => p.some((it) => typeof it.str === 'string' && it.str.trim()))) {
    throw Object.assign(plainError('This PDF has no text layer: it looks like a scan or a photo. Convert cannot read text inside pictures (OCR is not supported). Export the invoice as a PDF from your accounting program, or use the Excel file.'), { code: 'NO_TEXT_LAYER' });
  }
  const grid = [];
  for (const items of pages.slice(0, LIMITS.pdfPages)) {
    const t = pdfTable(items);
    for (const row of t.rows) grid.push(row.map((v) => cleanText(v)));
    grid.push([]);
  }
  return trimGrid(grid.slice(0, LIMITS.rows));
}

// ── dictionaries (normalised words) ─────────────────────────────────────────────────────────────────────
export const HEADER_SYNONYMS = {
  number: ['stevilka racuna', 'st racuna', 'racun st', 'racun stevilka', 'racun stev', 'stevilka dokumenta', 'st dokumenta', 'dokument st', 'invoice no', 'invoice number', 'invoice nr', 'invoice num', 'invoice id', 'invoice', 'inv no', 'racun', 'faktura'],
  issueDate: ['datum izdaje', 'datum izdaje racuna', 'datum racuna', 'izdan', 'izdano', 'datum izdaje dokumenta', 'issue date', 'invoice date', 'date of issue', 'date issued', 'dated', 'datum', 'date'],
  dueDate: ['rok placila', 'placilni rok', 'zapadlost', 'datum zapadlosti', 'zapade', 'zapade v placilo', 'placilo do', 'placljivo do', 'valuta placila', 'due date', 'payment due', 'payment due date', 'pay by', 'due'],
  currency: ['valuta', 'currency', 'kovanec', 'denar'],
  paymentReference: ['sklic', 'sklic za placilo', 'sklic na stevilko', 'referenca', 'referenca placila', 'namen placila', 'payment reference', 'reference', 'ref'],
  totalNet: ['skupaj brez ddv', 'znesek brez ddv', 'vrednost brez ddv', 'osnova za ddv', 'osnova', 'neto', 'neto znesek', 'net total', 'total net', 'subtotal', 'sub total', 'total excl vat', 'net amount'],
  totalGross: ['za placilo', 'skupaj za placilo', 'znesek za placilo', 'skupaj z ddv', 'znesek z ddv', 'vrednost z ddv', 'skupni znesek', 'za placati', 'skupaj', 'total', 'grand total', 'total due', 'amount due', 'total incl vat', 'total payable', 'bruto'],
};
const PARTY_LABELS = {
  seller: ['dobavitelj', 'prodajalec', 'izdajatelj', 'izdajatelj racuna', 'izdajatelj dokumenta', 'seller', 'supplier', 'vendor', 'from', 'issuer', 'izdal'],
  buyer: ['kupec', 'narocnik', 'prejemnik', 'prejemnik racuna', 'placnik', 'buyer', 'customer', 'bill to', 'billed to', 'invoice to', 'racun za', 'sold to', 'client', 'stranka', 'to'],
};
const PARTY_ATTRS = {
  vatId: ['id za ddv', 'ddv st', 'ddv stevilka', 'davcna stevilka', 'davcna st', 'identifikacijska stevilka za ddv', 'identifikacijska st za ddv', 'vat id', 'vat no', 'vat number', 'vat reg no', 'vat', 'tax id', 'tax number', 'ddv id', 'id ddv', 'ddv', 'davcna'],
  iban: ['iban', 'transakcijski racun', 'trr', 'tr', 'bank account', 'bančni racun', 'bancni racun', 'racun pri banki', 'ban'],
  address: ['naslov', 'address', 'sedez', 'ulica', 'street'],
  contact: ['kontakt', 'kontaktna oseba', 'contact', 'contact person'],
  name: ['naziv', 'firma', 'podjetje', 'company', 'company name'],
};
export const COLUMN_SYNONYMS = {
  description: ['opis', 'opis storitve', 'opis blaga', 'opis blaga storitve', 'blago storitev', 'blago ali storitev', 'naziv', 'naziv artikla', 'naziv blaga', 'artikel', 'storitev', 'postavka', 'description', 'item', 'product', 'details', 'goods services'],
  quantity: ['kolicina', 'kol', 'stevilo', 'st kosov', 'qty', 'quantity', 'units', 'amount of'],
  unit: ['enota', 'enota mere', 'em', 'e m', 'mera', 'unit', 'uom', 'unit of measure'],
  unitPrice: ['cena', 'cena brez ddv', 'cena na enoto', 'cena enote', 'cena za enoto', 'cena enota', 'enotna cena', 'ec', 'unit price', 'price', 'rate', 'price each', 'cena eur'],
  vatRate: ['stopnja ddv', 'ddv stopnja', 'stopnja', 'ddv %', '% ddv', 'ddv', 'vat rate', 'vat %', '% vat', 'vat', 'tax rate', 'tax', 'ddv v %'],
  net: ['znesek', 'neto znesek', 'neto', 'vrednost', 'vrednost brez ddv', 'znesek brez ddv', 'osnova', 'net amount', 'net', 'amount', 'line total', 'line amount', 'total', 'skupaj'],
};
const STOP_WORDS = ['skupaj', 'skupaj brez ddv', 'skupaj z ddv', 'skupaj za placilo', 'osnova', 'osnova za ddv', 'ddv', 'znesek ddv', 'vsota', 'za placilo', 'total', 'subtotal', 'sub total', 'grand total', 'net total', 'vat', 'rekapitulacija', 'amount due', 'total due', 'popust', 'neto', 'bruto', 'skupaj eur'];

/** How well a cell's text fits a list of label words. { score, inline } with score 0 for no match; `inline` is the part
 * after "label:" or after the label words when the value is in the same cell. */
export function labelMatch(raw, synonyms) {
  const t = text(raw);
  if (!t || t.length > 120) return { score: 0 };
  const strip = (s) => norm(s).replace(/\b(eur|usd|gbp|chf|v eur)\b/g, '').replace(/\s+/g, ' ').trim();
  let best = { score: 0, len: 0 };
  const consider = (score, len, inline) => { if (score > best.score || (score === best.score && len > best.len)) best = { score, len, inline }; };
  const colon = /^([^:：]{1,40})[:：]\s*(.*)$/.exec(t);
  const whole = strip(t);
  for (const syn of synonyms) {
    const words = syn.split(' ').length;
    if (whole === syn) consider(0.95, syn.length);
    if (colon && strip(colon[1]) === syn) consider(0.92, syn.length, colon[2].trim());
    else if (whole.startsWith(syn + ' ') && !colon && whole.split(' ').length <= words + 4 && /\d/.test(t.slice(syn.length))) consider(0.78, syn.length, t.replace(new RegExp('^\\s*' + syn.split(' ').map((w) => w.replace(/[^a-z0-9%]/g, '.')).join('[^A-Za-z0-9]*'), 'i'), '').replace(/^[\s:.#-]+/, '').trim());
    else if (` ${whole} `.includes(` ${syn} `) && whole.split(' ').length <= words + 2) consider(0.6, syn.length);
  }
  return best.score ? { score: best.score, inline: best.inline } : { score: 0 };
}

// ── values by field type ────────────────────────────────────────────────────────────────────────────────
const IBAN_RE = /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,3})?\b/;
const VAT_RE = /\b(?:SI|AT|DE|HR|IT|HU|FR|NL|BE|CZ|PL)\s?\d{8,11}\b/i;
const looksLabelOnly = (v) => HEADER_KEYS_ALL().some((syn) => labelMatch(v, syn).score >= 0.9);
let _all;
function HEADER_KEYS_ALL() { return (_all ||= [...Object.values(HEADER_SYNONYMS), ...Object.values(PARTY_LABELS), ...Object.values(PARTY_ATTRS)]); }

const CHECK = {
  number: (v) => { const t = text(v); return t.length >= 1 && t.length <= 40 && !looksLabelOnly(t) && !parseDate(t) ? 1 : 0; },
  issueDate: (v) => (parseDate(v) ? 1 : 0),
  dueDate: (v) => (parseDate(v) ? 1 : 0),
  currency: (v) => (/^[A-Za-z]{3}$/.test(text(v)) || /^€$/.test(text(v)) ? 1 : 0),
  paymentReference: (v) => (text(v) && text(v).length <= 60 && !looksLabelOnly(v) ? 1 : 0),
  totalNet: (v) => (parseNumber(v) != null ? 1 : 0),
  totalGross: (v) => (parseNumber(v) != null ? 1 : 0),
  vatId: (v) => (vatIdShape(String(v)) ? 1 : 0),
  iban: (v) => (/^[A-Z]{2}\d{2}/.test(normalizeIban(v)) && normalizeIban(v).length >= 15 && normalizeIban(v).length <= 34 ? 1 : 0),
  address: (v) => (text(v) && !looksLabelOnly(v) ? 1 : 0),
  contact: (v) => (text(v) && !looksLabelOnly(v) ? 1 : 0),
  name: (v) => (text(v).length >= 2 && !looksLabelOnly(v) ? 1 : 0),
};

// ── finding label hits ──────────────────────────────────────────────────────────────────────────────────
/** Every cell outside the table that looks like a label, with the best field it fits. */
function findLabels(grid, skip) {
  const fields = { ...HEADER_SYNONYMS, 'party:seller': PARTY_LABELS.seller, 'party:buyer': PARTY_LABELS.buyer };
  for (const [k, v] of Object.entries(PARTY_ATTRS)) fields['attr:' + k] = v;
  const hits = [];
  grid.forEach((row, r) => row.forEach((v, c) => {
    if (typeof v !== 'string' || !v.trim() || skip(r, c)) return;
    let best = null;
    for (const [field, syns] of Object.entries(fields)) {
      const m = labelMatch(v, syns);
      if (m.score && (!best || m.score > best.score)) best = { field, ...m };
    }
    if (best) hits.push({ r, c, ...best });
  }));
  return hits;
}

/** The value for a label: after the colon in the same cell, else the next filled cell to the right (stopping at the next
 * label), else the cell below. `ok(value)` says whether a candidate fits the field. */
function valueFor(grid, hit, labelCells, ok, reach = 6) {
  const options = [];
  if (hit.inline && filled(hit.inline) && ok(hit.inline)) options.push({ ref: refOf(hit.r, hit.c), value: text(hit.inline), loc: 1, inline: true });
  for (let c = hit.c + 1; c <= hit.c + reach && c < (grid[hit.r] || []).length; c++) {
    const v = cellAt(grid, hit.r, c);
    if (!filled(v)) continue;
    if (labelCells.has(hit.r + ',' + c) && !ok(v)) break;
    if (ok(v)) { options.push({ ref: refOf(hit.r, c), value: text(v), loc: 1 }); }
    break;
  }
  const below = cellAt(grid, hit.r + 1, hit.c);
  if (filled(below) && ok(below) && !(labelCells.has(hit.r + 1 + ',' + hit.c) && !ok(below))) options.push({ ref: refOf(hit.r + 1, hit.c), value: text(below), loc: 0.85 });
  return options[0] || null;
}

// ── the line table ──────────────────────────────────────────────────────────────────────────────────────
const isStop = (s) => { const n = norm(s).replace(/\b(eur|usd)\b/g, '').trim(); return STOP_WORDS.some((w) => n === w || n.startsWith(w + ' ') && /^(ddv|vat|\d)/.test(n.slice(w.length + 1))); };

function findTable(grid) {
  let best = null;
  grid.forEach((row, r) => {
    if (row.filter(filled).length < 2) return;
    const found = {};
    row.forEach((v, c) => {
      if (typeof v !== 'string' || !v.trim()) return;
      for (const [key, syns] of Object.entries(COLUMN_SYNONYMS)) {
        const m = labelMatch(v, syns);
        if (m.score >= 0.6 && (!found[key] || m.score > found[key].score)) found[key] = { score: m.score, c };
      }
    });
    const keys = Object.keys(found), core = ['description', 'quantity', 'unitPrice', 'net'].filter((k) => found[k]);
    if (keys.length < 3 || core.length < 2 || (!found.description && !found.unitPrice)) return;
    const score = keys.reduce((t, k) => t + found[k].score, 0);
    if (!best || score > best.score) best = { r, score };
  });
  if (!best) return null;
  const header = grid[best.r];
  // every column gets the key it matches best; a key takes one column; vatRate/"ddv" must hold rates in its values
  const cand = [];
  header.forEach((v, c) => {
    if (typeof v !== 'string' || !v.trim()) return;
    for (const [key, syns] of Object.entries(COLUMN_SYNONYMS)) { const m = labelMatch(v, syns); if (m.score >= 0.6) cand.push({ key, c, score: m.score, len: syns.length }); }
  });
  cand.sort((a, b) => b.score - a.score || a.c - b.c);
  const columns = {}, usedCols = new Set();
  const colValues = (c) => grid.slice(best.r + 1, best.r + 40).map((row) => row[c]).filter(filled);
  for (const m of cand) {
    if (columns[m.key] || usedCols.has(m.c)) continue;
    if (m.key === 'vatRate') { const vals = colValues(m.c); if (vals.length && vals.filter((v) => { const n = parseVatRate(v); return n != null && n <= 30; }).length < vals.length * 0.5) continue; }
    if (m.key === 'description' && colValues(m.c).every((v) => parseNumber(v) != null) && colValues(m.c).length) continue;
    columns[m.key] = { col: m.c, header: text(header[m.c]), confidence: m.score };
    usedCols.add(m.c);
  }
  // rows of lines
  const rowIsLine = (row) => {
    const d = columns.description ? text(row[columns.description.col]) : '';
    const has = (k) => columns[k] && parseNumber(row[columns[k].col]) != null;
    if (columns.description && !d) return false;
    if (d && isStop(d) && !(has('quantity') && has('unitPrice'))) return false;
    return Boolean(has('quantity') || has('unitPrice') || has('net'));
  };
  let first = best.r + 1, last = best.r, blanks = 0;
  for (let r = best.r + 1; r < grid.length; r++) {
    const row = grid[r] || [];
    if (!row.some(filled)) { if (last >= first && ++blanks >= 1) break; continue; }
    if (rowIsLine(row)) { last = r; blanks = 0; } else if (last >= first) break;
    else if (r - best.r > 4) break;
  }
  if (last < first) { first = best.r + 1; last = best.r; } else { while (first < last && !rowIsLine(grid[first] || [])) first++; }
  return { headerRow: best.r, firstRow: first, lastRow: last, columns };
}

// ── parties ─────────────────────────────────────────────────────────────────────────────────────────────
function splitAddress(s) {
  const parts = text(s).split(/\s*[,;]\s*/).filter(Boolean), out = { street: '', postalCode: '', city: '' };
  const pc = (p) => /^(?:[A-Z]{1,2}[- ])?(\d{4,5})\s+(.+)$/.exec(p);
  const last = parts.length ? pc(parts[parts.length - 1]) : null;
  if (last) { out.postalCode = last[1]; out.city = last[2]; parts.pop(); }
  out.street = parts.join(', ');
  return out;
}

/** The whole analysis of one grid: { fields, table, labels, warnings } where fields[key] = { ref, value, confidence }. */
export function extract(grid) {
  const table = findTable(grid);
  const inTable = (r) => table && r >= table.headerRow && r <= table.lastRow;
  const hits = findLabels(grid, (r) => inTable(r));
  const labelCells = new Set(hits.map((h) => h.r + ',' + h.c));
  const fields = {}, warnings = [];
  const put = (key, o, conf) => { if (!o) return; if (!fields[key] || conf > fields[key].confidence) fields[key] = { ref: o.ref, value: o.value, confidence: Math.round(Math.min(1, conf) * 100) / 100, label: o.label || '' }; };

  // header fields
  for (const key of Object.keys(HEADER_SYNONYMS)) {
    for (const h of hits.filter((x) => x.field === key)) {
      const o = valueFor(grid, h, labelCells, CHECK[key], key.startsWith('total') ? 8 : 6);
      if (!o) continue;
      let conf = h.score * o.loc, k = key;
      if (key === 'currency' && parseDate(o.value)) { k = 'dueDate'; conf *= 0.7; } // "Valuta: 01.11.2026" is the due date
      if (k === 'totalGross' && h.score < 0.9) conf *= 0.85;
      const cur = fields[k];
      if (cur && (k === 'totalGross' || k === 'totalNet') && conf >= cur.confidence - 0.05) { put(k, { ...o, label: text(grid[h.r][h.c]) }, conf + 0.001); continue; } // totals sit at the end: the later one wins ties
      put(k, { ...o, label: text(grid[h.r][h.c]) }, conf);
    }
  }
  // "valuta" as a due date must not stay as the currency; a currency word anywhere is the fallback
  if (!fields.currency) {
    outer: for (let r = 0; r < grid.length; r++) for (let c = 0; c < grid[r].length; c++) {
      const v = text(grid[r][c]);
      if (/^(EUR|USD|GBP|CHF)$/.test(v)) { put('currency', { ref: refOf(r, c), value: v }, 0.5); break outer; }
      if (/€/.test(v) && !table) { put('currency', { ref: refOf(r, c), value: 'EUR' }, 0.4); break outer; }
    }
  }
  if (!fields.issueDate || !fields.dueDate) {
    const dates = [];
    grid.forEach((row, r) => { if (!inTable(r)) row.forEach((v, c) => { const d = parseDate(v); if (d && !Object.values(fields).some((f) => f.ref === refOf(r, c))) dates.push({ ref: refOf(r, c), value: text(v), d }); }); });
    if (!fields.issueDate && dates.length) put('issueDate', dates[0], 0.4);
    if (!fields.dueDate && dates.length > (fields.issueDate ? 0 : 1)) { const d = dates.find((x) => !fields.issueDate || x.ref !== fields.issueDate.ref); if (d && (!fields.issueDate || d.d >= parseDate(fields.issueDate.value))) put('dueDate', d, 0.35); }
  }

  // parties
  const labelFor = (side) => hits.filter((h) => h.field === 'party:' + side).sort((a, b) => b.score - a.score || a.r - b.r || a.c - b.c)[0] || null;
  let sl = labelFor('seller'), bl = labelFor('buyer');
  if (sl && bl && sl.r === bl.r && sl.c === bl.c) bl = null;
  const partyAt = (r, c, field, seenOrder) => {
    const labels = [sl && { side: 'seller', ...sl }, bl && { side: 'buyer', ...bl }].filter(Boolean);
    if (labels.length === 2) {
      const [a, b] = labels;
      if (a.r === b.r) { const before = labels.filter((l) => l.c <= c).sort((x, y) => y.c - x.c)[0]; return (before || labels.sort((x, y) => Math.abs(x.c - c) - Math.abs(y.c - c))[0]).side; }
      const before = labels.filter((l) => l.r <= r).sort((x, y) => y.r - x.r)[0];
      return before ? before.side : 'seller';
    }
    if (labels.length === 1) { const l = labels[0]; if (l.side === 'seller') return r >= l.r && seenOrder === 0 ? 'seller' : seenOrder === 0 ? 'seller' : 'buyer'; return seenOrder === 0 ? 'seller' : 'buyer'; }
    return seenOrder === 0 ? 'seller' : 'buyer';
  };
  const seen = {};
  const tag = (field, side) => ((seen[field + side] = (seen[field + side] || 0) + 1), seen[field + side]);
  const labelHits = hits.filter((h) => h.field.startsWith('attr:')).sort((a, b) => a.r - b.r || a.c - b.c);
  const partyFields = { seller: {}, buyer: {} };
  const putParty = (side, key, o, conf) => { const k = `${side}.${key}`; put(k, o, conf); };
  // one cell with "street, 1000 City" feeds three fields: the reference says which part (B8#city)
  const putAddress = (side, o, conf) => {
    const a = splitAddress(o.value);
    if (!a.postalCode) { putParty(side, 'street', o, conf); return; }
    if (a.street) putParty(side, 'street', { ...o, ref: o.ref + '#street', value: a.street }, conf);
    putParty(side, 'postalCode', { ...o, ref: o.ref + '#postalCode', value: a.postalCode }, conf);
    putParty(side, 'city', { ...o, ref: o.ref + '#city', value: a.city }, conf);
  };
  const orderCount = {};
  for (const h of labelHits) {
    const attr = h.field.slice(5);
    if (attr === 'name') continue;
    const o = valueFor(grid, h, labelCells, CHECK[attr]);
    if (!o) continue;
    const order = orderCount[attr] || 0;
    const side = partyAt(h.r, h.c, attr, order);
    orderCount[attr] = order + 1;
    if (attr === 'address') putAddress(side, o, h.score * o.loc);
    else putParty(side, attr, o, h.score * o.loc);
    partyFields[side][attr] = true;
  }
  // blocks under a party label: the name, then address lines, VAT ID and IBAN without labels
  const block = (side, lab) => {
    let nameCell = null;
    const labelText = text(grid[lab.r][lab.c]);
    if (lab.inline && filled(lab.inline) && CHECK.name(lab.inline)) nameCell = { r: lab.r, c: lab.c, value: text(lab.inline), inline: true, loc: 1 };
    else {
      for (let c = lab.c + 1; c <= lab.c + 4 && c < (grid[lab.r] || []).length; c++) { const v = cellAt(grid, lab.r, c); if (!filled(v)) continue; if (!labelCells.has(lab.r + ',' + c) && CHECK.name(v)) nameCell = { r: lab.r, c, value: text(v), loc: 1 }; break; }
      if (!nameCell) { const v = cellAt(grid, lab.r + 1, lab.c); if (filled(v) && !labelCells.has(lab.r + 1 + ',' + lab.c) && CHECK.name(v)) nameCell = { r: lab.r + 1, c: lab.c, value: text(v), loc: 0.85 }; }
    }
    if (!nameCell) return;
    putParty(side, 'name', { ref: refOf(nameCell.r, nameCell.c), value: nameCell.value, label: labelText }, lab.score * nameCell.loc);
    const stopRows = [sl, bl].filter((x) => x && x !== lab).map((x) => x.r);
    const otherCols = [sl, bl].filter((x) => x && x !== lab && x.r === lab.r).map((x) => x.c);
    let street = false, seq = 0;
    for (let r = nameCell.r + 1; r <= nameCell.r + 7 && r < grid.length; r++) {
      if (stopRows.includes(r) && !(otherCols.length === 0)) { if (!otherCols.length) break; }
      const v = cellAt(grid, r, nameCell.c);
      if (!filled(v)) { if (seq) break; continue; }
      if (labelCells.has(r + ',' + nameCell.c) || (inTable(r))) { if (labelCells.has(r + ',' + nameCell.c)) continue; break; }
      const t = text(v);
      if (VAT_RE.test(t) && /^(?:[A-Z]{2}\s?)\d{8,11}$/i.test(t.replace(/[\s.]/g, '')) && !fields[`${side}.vatId`]) putParty(side, 'vatId', { ref: refOf(r, nameCell.c), value: t }, 0.7);
      else if (IBAN_RE.test(t.toUpperCase()) && /^[A-Z]{2}\d{2}/.test(normalizeIban(t)) && !fields[`${side}.iban`]) putParty(side, 'iban', { ref: refOf(r, nameCell.c), value: t }, 0.7);
      else if (/^(?:[A-Z]{1,2}[- ])?\d{4,5}\s+\S/.test(t) && !fields[`${side}.postalCode`]) { const a = splitAddress(t); putParty(side, 'postalCode', { ref: refOf(r, nameCell.c), value: a.postalCode }, 0.75); putParty(side, 'city', { ref: refOf(r, nameCell.c), value: a.city }, 0.75); }
      else if (!street && !fields[`${side}.street`] && /[A-Za-zČŠŽčšž]/.test(t) && !/^(slovenija|slovenia)$/i.test(t)) {
        putAddress(side, { ref: refOf(r, nameCell.c), value: t }, 0.65);
        street = true;
      }
      seq++;
    }
  };
  if (sl) block('seller', sl);
  if (bl) block('buyer', bl);
  // letterhead without a "Dobavitelj" label: the first words of the sheet are the seller
  if (!fields['seller.name']) {
    for (let r = 0; r < Math.min(6, grid.length); r++) for (let c = 0; c < (grid[r] || []).length; c++) {
      const v = grid[r][c];
      if (typeof v !== 'string' || labelCells.has(r + ',' + c) || !/[A-Za-zČŠŽčšž]{3}/.test(v) || parseDate(v) || parseNumber(v) != null || inTable(r)) continue;
      if (/^(racun|invoice|faktura)\b/i.test(norm(v))) continue;
      put('seller.name', { ref: refOf(r, c), value: text(v) }, 0.35); r = 99; break;
    }
  }
  // VAT IDs and IBANs lying around without a label
  grid.forEach((row, r) => row.forEach((v, c) => {
    if (typeof v !== 'string' || inTable(r) || labelCells.has(r + ',' + c)) return;
    const t = text(v);
    if (/^(?:SI)\s?\d{8}$/i.test(t.replace(/\./g, '')) && !Object.values(fields).some((f) => f.ref === refOf(r, c))) { const side = partyAt(r, c, 'vatId', fields['seller.vatId'] ? 1 : 0); put(`${side}.vatId`, { ref: refOf(r, c), value: t }, 0.55); }
    if (/^[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,5}(?:\s?[A-Z0-9]{1,3})?$/.test(t) && !Object.values(fields).some((f) => f.ref === refOf(r, c))) { const side = partyAt(r, c, 'iban', fields['seller.iban'] ? 1 : 0); put(`${side}.iban`, { ref: refOf(r, c), value: t }, 0.55); }
  }));

  // formula-looking cells are reported once
  let formulas = 0;
  grid.forEach((row) => row.forEach((v) => { if (typeof v === 'string' && /^(?:=|@|[+-](?=[A-Za-z(@=]))/.test(v.trim())) formulas++; }));
  if (formulas) warnings.push({ code: 'FORMULA_CELLS', message: `${formulas} ${formulas === 1 ? 'cell starts' : 'cells start'} with = + - or @ and could be read as a formula by a spreadsheet. The leading character is removed before it goes into the XML.` });
  if (!table) warnings.push({ code: 'NO_TABLE', message: 'No table of invoice lines was found: there is no row with column titles such as Description, Quantity and Price.' });
  return { fields, table, warnings, labels: hits.length };
}

/** The mapping the page edits, from an analysis: { fields: key → cell ref or null, columns: key → column index or null,
 * table: { headerRow, firstRow, lastRow } }. */
export function mappingOf(analysis) {
  const fields = {};
  for (const k of FIELD_KEYS) fields[k] = analysis.fields[k]?.ref || null;
  const columns = {};
  for (const k of COLUMN_KEYS) columns[k] = analysis.table?.columns[k]?.col ?? null;
  return { fields, columns, table: analysis.table ? { headerRow: analysis.table.headerRow, firstRow: analysis.table.firstRow, lastRow: analysis.table.lastRow } : { headerRow: -1, firstRow: 0, lastRow: -1 } };
}
export const FIELD_KEYS = ['number', 'issueDate', 'dueDate', 'currency', 'paymentReference', 'totalNet', 'totalGross',
  'seller.name', 'seller.vatId', 'seller.iban', 'seller.street', 'seller.postalCode', 'seller.city', 'seller.contact',
  'buyer.name', 'buyer.vatId', 'buyer.street', 'buyer.postalCode', 'buyer.city'];
export const COLUMN_KEYS = ['description', 'quantity', 'unit', 'unitPrice', 'vatRate', 'net'];

/** The text of the cell a mapping points at; a "Label: value" cell gives the value part. */
export function valueAt(grid, ref) {
  const [cellRef, part] = String(ref || '').split('#');
  if (part) return splitAddress(valueAt(grid, cellRef))[part] || '';
  const p = parseRef(cellRef);
  if (!p) return '';
  const raw = cellAt(grid, p.r, p.c);
  if (typeof raw === 'number') return String(raw);
  const t = text(raw), m = /^([^:：]{1,40})[:：]\s*(.+)$/.exec(t);
  if (m && HEADER_KEYS_ALL().some((syn) => labelMatch(m[1], syn).score >= 0.9)) return m[2].trim();
  return t;
}

/** The invoice from grid + mapping. `parties` (optional) holds the user's edits of the seller and buyer boxes, which win
 * over the cells. Text is cut to 512 characters, control characters are removed, and warnings tell what was changed. */
export function buildInvoice(grid, mapping, parties = {}) {
  const inv = emptyInvoice(), warn = (code, message) => inv.warnings.push({ code, message });
  let formulas = 0;
  const get = (key, max = LIMITS.textChars) => {
    const ref = mapping.fields[key];
    if (!ref) return '';
    const { text: t, formula } = safeText(valueAt(grid, ref), max);
    if (formula) formulas++;
    return t;
  };
  inv.number = get('number');
  inv._raw = { issueDate: get('issueDate'), dueDate: get('dueDate') };
  inv.issueDate = parseDate(inv._raw.issueDate) || '';
  inv.dueDate = parseDate(inv._raw.dueDate) || '';
  const cur = get('currency');
  inv.currency = /^€$/.test(cur) ? 'EUR' : cur.toUpperCase() || (mapping.fields.currency ? '' : 'EUR');
  inv.paymentReference = get('paymentReference', 60);
  inv.stated.net = mapping.fields.totalNet ? parseNumber(valueAt(grid, mapping.fields.totalNet)) : null;
  inv.stated.gross = mapping.fields.totalGross ? parseNumber(valueAt(grid, mapping.fields.totalGross)) : null;
  for (const side of ['seller', 'buyer']) {
    const p = inv[side];
    for (const k of ['name', 'vatId', 'iban', 'street', 'postalCode', 'city', 'contact']) p[k] = get(`${side}.${k}`, k === 'name' || k === 'street' ? 200 : 100);
    p.vatId = normalizeVatId(p.vatId); p.iban = normalizeIban(p.iban);
    Object.assign(p, Object.fromEntries(Object.entries(parties[side] || {}).filter(([, v]) => v != null).map(([k, v]) => [k, k === 'vatId' ? normalizeVatId(v) : k === 'iban' ? normalizeIban(v) : safeText(v, 200).text])));
    if (!p.country) p.country = /^[A-Z]{2}/.test(p.vatId) ? p.vatId.slice(0, 2) : p.name || p.street ? 'SI' : '';
  }
  // lines
  const cols = mapping.columns, t = mapping.table;
  if (cols.description != null || cols.net != null || cols.unitPrice != null) {
    for (let r = t.firstRow; r <= t.lastRow && r < grid.length; r++) {
      const row = grid[r] || [];
      const cell = (k) => (cols[k] == null ? '' : row[cols[k]] ?? '');
      const l = emptyLine(), d = safeText(cell('description'), 256);
      if (d.formula) formulas++;
      if (!d.text && !filled(cell('quantity')) && !filled(cell('unitPrice')) && !filled(cell('net'))) continue;
      l.description = d.text;
      l.quantity = cols.quantity == null ? 1 : parseNumber(cell('quantity'));
      l.unit = safeText(cell('unit'), 20).text;
      l.unitPrice = parseNumber(cell('unitPrice'));
      l.net = parseNumber(cell('net'));
      l.vatRate = cols.vatRate == null ? null : parseVatRate(cell('vatRate'));
      l.rawVat = cols.vatRate == null ? '' : text(cell('vatRate'));
      if (l.unitPrice == null && l.net != null && l.quantity) l.unitPrice = round2(l.net / l.quantity);
      l.row = r + 1;
      inv.lines.push(l);
    }
    if (cols.quantity == null && inv.lines.length) warn('NO_QUANTITY_COLUMN', 'There is no quantity column, so every quantity is taken as 1.');
  }
  if (formulas) warn('FORMULA_CELLS', `${formulas} ${formulas === 1 ? 'value started' : 'values started'} with = + - or @ (like a spreadsheet formula); that character was removed.`);
  return inv;
}

/** All the non-empty cells outside the line table, for the "pick a cell" lists: [{ ref, text }], at most `max`. */
export function cellChoices(grid, table, max = 400) {
  const out = [];
  grid.forEach((row, r) => row.forEach((v, c) => {
    if (out.length >= max || !filled(v) || (table && r >= table.headerRow && r <= table.lastRow)) return;
    out.push({ ref: refOf(r, c), text: text(v).slice(0, 60) });
  }));
  return out;
}
/** The columns of the table with their titles, for the column lists. */
export function columnChoices(grid, table) {
  if (!table || table.headerRow < 0) return [];
  const row = grid[table.headerRow] || [], out = [];
  row.forEach((v, c) => { if (filled(v)) out.push({ col: c, letter: colLetter(c), title: text(v).slice(0, 40) }); });
  return out;
}

/** Of several sheets the one that looks most like an invoice: more mapped fields, more lines. */
export function pickGrid(grids) {
  let best = null;
  grids.forEach((g, index) => {
    const a = extract(g.grid), score = Object.keys(a.fields).length + (a.table ? 6 + (a.table.lastRow - a.table.firstRow + 1) : 0);
    if (!best || score > best.score) best = { ...g, index, analysis: a, score };
  });
  return best;
}

export { ibanOk };
