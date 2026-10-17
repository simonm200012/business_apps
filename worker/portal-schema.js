// Client portal: the server-side whitelist and format rules (pure, no R2). The portal and staff Workers both import this.
// Whatever staff publish is rebuilt here key by key: unknown keys dropped, types, lengths, enums and formats checked, plain
// text only (the portal front-end renders everything with textContent), lists capped. Quote hashes are computed here, never
// taken from the publisher. Money is in cents; unitPrice is in euros as printed.

export const MAX_VIEW_BYTES = 1024 * 1024, MAX_ITEMS = 500, MAX_FILE = 20 * 1024 * 1024, MAX_LOGO = 256 * 1024;
export const HEX32 = /^[a-f0-9]{32}$/, HEX64 = /^[a-f0-9]{64}$/, QUOTE_ID = /^[0-9a-f-]{36}$/, DOC_ID = /^[A-Za-z0-9_-]{1,64}$/, DAY = /^\d{4}-\d{2}-\d{2}$/;
export const INVOICE_STATUS = ['issued', 'partly_paid', 'overdue', 'paid', 'credited', 'refund_due'];
export const QUOTE_STATUS = ['open', 'expired', 'accepted', 'declined', 'invoiced'];

/** Plain text: control characters (but \n when allowed) and bidi/invisible overrides removed, trimmed, cut to max. */
export function clean(v, max, { multiline = false } = {}) {
  let s = typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
  s = s.normalize('NFC').replace(multiline ? /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g : /[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/[​-‏‪-‮⁦-⁩﻿]/g, '');
  return s.trim().slice(0, max);
}
const isDay = (v) => typeof v === 'string' && DAY.test(v) && !Number.isNaN(Date.parse(v + 'T12:00:00Z')) && new Date(v + 'T12:00:00Z').toISOString().slice(0, 10) === v;
const day = (v) => (isDay(v) ? v : null);
const cents = (v) => (Number.isSafeInteger(v) && Math.abs(v) <= 1e12 ? v : null);
const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
const fid = (v) => (typeof v === 'string' && HEX32.test(v) ? v : null);
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** Every file id a view refers to (invoice/quote PDFs and shared documents). */
export const fileIds = (view) => [...view.invoices.map((i) => i.pdf), ...view.quotes.map((q) => q.pdf), ...view.documents.map((d) => d.id)].filter(Boolean);

/** → { view } or { error }. `raw` is the parsed JSON the publisher sent. Hashes are added by withHashes(). */
export function sanitizeView(raw) {
  if (!isObj(raw)) return { error: 'The view must be an object.' };
  for (const k of ['invoices', 'quotes', 'documents']) if (!Array.isArray(raw[k] ?? [])) return { error: k + ' must be a list.' };
  const inv = raw.invoices || [], quo = raw.quotes || [], docs = raw.documents || [];
  if (inv.length > MAX_ITEMS || quo.length > MAX_ITEMS || docs.length > MAX_ITEMS) return { error: 'Too many items (at most ' + MAX_ITEMS + ' per list).' };
  const name = clean(isObj(raw.client) ? raw.client.name : '', 120);
  if (!name) return { error: 'The client needs a name.' };
  const seen = new Set(), view = { v: 1, client: { name }, invoices: [], quotes: [], documents: [] };
  const once = (kind, id) => { const k = kind + ':' + id; if (seen.has(k)) return false; seen.add(k); return true; };
  for (const i of inv) {
    if (!isObj(i)) return { error: 'An invoice is not an object.' };
    const id = typeof i.id === 'string' && DOC_ID.test(i.id) ? i.id : null, number = clean(i.number, 40);
    const row = { id, number, kind: i.kind === 'credit_note' ? 'credit_note' : i.kind === 'invoice' ? 'invoice' : null, issueDate: day(i.issueDate),
      dueDate: i.dueDate == null ? null : day(i.dueDate), total: cents(i.total), amountDue: cents(i.amountDue),
      status: INVOICE_STATUS.includes(i.status) ? i.status : null, paidOn: i.paidOn == null ? null : day(i.paidOn),
      reference: clean(i.reference, 40), title: clean(i.title, 120), pdf: i.pdf == null ? null : fid(i.pdf) };
    if (!row.id || !number || !row.kind || !row.issueDate || row.total == null || row.amountDue == null || !row.status) return { error: 'Invoice ' + (number || '?') + ' is incomplete or has a bad value (drafts are never published).' };
    if ((i.dueDate != null && !row.dueDate) || (i.paidOn != null && !row.paidOn) || (i.pdf != null && !row.pdf)) return { error: 'Invoice ' + number + ' has a bad date or file id.' };
    if (!once('i', id)) return { error: 'Invoice id used twice.' };
    view.invoices.push(row);
  }
  for (const q of quo) {
    if (!isObj(q)) return { error: 'A quote is not an object.' };
    const number = clean(q.number, 40), t = isObj(q.totals) ? q.totals : {};
    if (!Array.isArray(q.lines) || q.lines.length > 200) return { error: 'Quote ' + (number || '?') + ' needs 1 to 200 lines.' };
    const lines = [];
    for (const l of q.lines) {
      if (!isObj(l)) return { error: 'A quote line is not an object.' };
      const line = { description: clean(l.description, 300), qty: num(l.qty, 0, 1e9), unit: clean(l.unit, 20), unitPrice: num(l.unitPrice, 0, 1e9),
        discountPct: num(l.discountPct ?? 0, 0, 100), rate: num(l.rate ?? 0, 0, 100), net: cents(l.net) };
      if (!line.description || line.qty == null || line.unitPrice == null || line.discountPct == null || line.rate == null || line.net == null) return { error: 'A line of quote ' + number + ' is incomplete or has a bad value.' };
      lines.push(line);
    }
    const row = { id: typeof q.id === 'string' && QUOTE_ID.test(q.id) ? q.id : null, number, kind: q.kind === 'proforma' ? 'proforma' : q.kind === 'quote' ? 'quote' : null,
      issueDate: day(q.issueDate), validUntil: q.validUntil == null ? null : day(q.validUntil), status: QUOTE_STATUS.includes(q.status) ? q.status : null,
      totals: { net: cents(t.net), vat: cents(t.vat), total: cents(t.total) }, lines, note: clean(q.note, 2000, { multiline: true }), pdf: q.pdf == null ? null : fid(q.pdf) };
    if (!row.id || !number || !row.kind || !row.issueDate || !row.status || row.totals.net == null || row.totals.vat == null || row.totals.total == null || !lines.length) return { error: 'Quote ' + (number || '?') + ' is incomplete or has a bad value (quote ids are UUIDs).' };
    if ((q.validUntil != null && !row.validUntil) || (q.pdf != null && !row.pdf)) return { error: 'Quote ' + number + ' has a bad date or file id.' };
    if (!once('q', row.id)) return { error: 'Quote id used twice.' };
    view.quotes.push(row);
  }
  for (const d of docs) {
    if (!isObj(d)) return { error: 'A document is not an object.' };
    const row = { id: fid(d.id), name: clean(d.name, 200), size: Number.isSafeInteger(d.size) && d.size >= 0 && d.size <= MAX_FILE ? d.size : null, type: clean(d.type, 100), sharedAt: day(d.sharedAt) };
    if (!row.id || !row.name || row.size == null || !FILE_TYPES[row.type] || !row.sharedAt) return { error: 'A shared document is incomplete or has a bad value.' };
    if (!once('d', row.id)) return { error: 'Document id used twice.' };
    view.documents.push(row);
  }
  return { view };
}

/** Canonical JSON (sorted keys), the same as Billing's canonical(). */
export function canonical(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
}
export const sha256hex = async (s) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, '0')).join('');
/** SHA-256 of the printed fields of a quote: what the client saw is what they accept. */
export const quoteHash = (q) => sha256hex(canonical({ number: q.number, kind: q.kind, issueDate: q.issueDate, validUntil: q.validUntil, totals: q.totals, lines: q.lines, note: q.note }));
export async function withHashes(view) { for (const q of view.quotes) q.hash = await quoteHash(q); return view; }

// ── brand and news ──────────────────────────────────────────────────────────────────────────────────────────────────
const luminance = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
/** → { brand } or { error }. Name plain text, accent #rrggbb dark enough for white text (contrast at least 4.5). */
export function sanitizeBrand(raw) {
  if (!isObj(raw)) return { error: 'The brand must be an object.' };
  const name = clean(raw.name, 60), accent = typeof raw.accent === 'string' ? raw.accent.toLowerCase() : '';
  if (!name) return { error: 'The company name is needed.' };
  if (!/^#[0-9a-f]{6}$/.test(accent)) return { error: 'The accent colour must be like #1f6b4f.' };
  if (1.05 / (luminance(accent) + 0.05) < 4.5) return { error: 'The accent colour is too light for white text. Pick a darker one.' };
  return { brand: { name, accent } };
}
/** → { news } or { error }: up to 20 plain-text items, newest first as given. */
export function sanitizeNews(raw) {
  const items = isObj(raw) ? raw.items : raw;
  if (!Array.isArray(items) || items.length > 20) return { error: 'News must be a list of at most 20 items.' };
  const out = [];
  for (const it of items) {
    if (!isObj(it)) return { error: 'A news item is not an object.' };
    const row = { id: typeof it.id === 'string' && /^[a-z0-9-]{1,36}$/.test(it.id) ? it.id : 'n' + out.length, date: day(it.date), title: clean(it.title, 120), body: clean(it.body, 500, { multiline: true }) };
    if (!row.date || !row.title) return { error: 'A news item needs a date and a title.' };
    out.push(row);
  }
  return { news: { items: out } };
}

// ── files ───────────────────────────────────────────────────────────────────────────────────────────────────────────
export const FILE_TYPES = {
  'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx', 'text/csv': 'csv',
};
export const LOGO_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const starts = (b, sig, at = 0) => sig.every((x, i) => b[at + i] === x);
/** Does the content look like the type it claims? (A shared "PDF" that is really HTML never goes out as a PDF.) */
export function magicOk(type, b) {
  if (!(b instanceof Uint8Array) || !b.length) return false;
  switch (type) {
    case 'application/pdf': return starts(b, [0x25, 0x50, 0x44, 0x46, 0x2d]);
    case 'image/png': return starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/jpeg': return starts(b, [0xff, 0xd8, 0xff]);
    case 'image/webp': return starts(b, [0x52, 0x49, 0x46, 0x46]) && starts(b, [0x57, 0x45, 0x42, 0x50], 8);
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': return starts(b, [0x50, 0x4b, 0x03, 0x04]);
    case 'text/csv': return !b.subarray(0, 4096).includes(0) && !/^\s*</.test(new TextDecoder().decode(b.subarray(0, 64)));
    default: return false;
  }
}
/** A download name that cannot carry a path, control or bidi characters, ≤ 120 chars; falls back to "download". */
export function safeFilename(name, ext = '') {
  let s = clean(String(name || ''), 400).replace(/[\\/:*?"<>|%]/g, '_').replace(/^[.\s_]+/, '').slice(0, 120).trim();
  if (!s) s = 'download';
  if (ext && !s.toLowerCase().endsWith('.' + ext)) s = s.slice(0, 120 - ext.length - 1) + '.' + ext;
  return s;
}
/** RFC 5987 Content-Disposition value for an attachment. */
export const attachment = (name) => "attachment; filename*=UTF-8''" + encodeURIComponent(name).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

/** A portal e-mail: printable ASCII only (the portal's token check refuses non-ASCII addresses, see access.js asciiOnly). */
export const emailOk = (e) => typeof e === 'string' && e.length <= 254 && /^[\x21-\x7e]+$/.test(e) && /^[^\s@<>()",;:\\]+@[^\s@<>()",;:\\]+\.[^\s@<>()",;:\\]+$/.test(e);
