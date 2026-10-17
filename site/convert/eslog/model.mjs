// eSLOG invoice: the normalised invoice object and the parsing of numbers, dates, VAT rates, VAT IDs and IBANs.
// Pure (no page, no libraries): used by extract.mjs, validate.mjs and eslog.mjs and tested by tools/tests/eslog-model.test.js.
// All money is plain numbers rounded to cents with round2; quantities and unit prices keep up to 4 decimals.

/** The VAT rates Slovenia has had since 2013 (22 %, reduced 9.5 %, 5 %) and zero. Anything else is only a warning. */
export const SI_VAT_RATES = [22, 9.5, 5, 0];

export const round2 = (x) => Math.round((Number(x) + Number.EPSILON) * 100) / 100;
export const round4 = (x) => Math.round((Number(x) + Number.EPSILON) * 10000) / 10000;
export const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

/** A number from the text in a cell. Understands Slovenian "1.234,56", English "1,234.56", "1 234,56", "1234.56",
 * "12,5 %", "€ 85,00", "85,00 EUR", "(12,00)" and "12,00-" as negative. A single "." with exactly three digits after it
 * and a 1 to 3 digit non-zero part in front ("1.234") is a thousands separator, as in Slovenian; anything else with a
 * single "." or "," is a decimal separator. Returns null when the text is not a number. */
export function parseNumber(v) {
  if (isNum(v)) return v;
  if (v == null) return null;
  let s = String(v).replace(/[   ]/g, ' ').trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/^(EUR|€|\$|USD|GBP|CHF)\s*/i, '').replace(/\s*(EUR|€|\$|USD|GBP|CHF|%)$/i, '').trim();
  if (/-$/.test(s)) { neg = !neg; s = s.slice(0, -1).trim(); }
  if (/^[-−–]/.test(s)) { neg = !neg; s = s.slice(1).trim(); } else if (s.startsWith('+')) s = s.slice(1).trim();
  if (!/^\d[\d .,']*$/.test(s) && !/^[.,]\d+$/.test(s)) return null;
  s = s.replace(/[ ']/g, '');
  if (/[.,]$/.test(s)) return null;
  const dots = (s.match(/\./g) || []).length, commas = (s.match(/,/g) || []).length;
  let out;
  if (dots && commas) {
    const dec = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.', thou = dec === ',' ? '.' : ',';
    if (s.split(dec).length > 2) return null;
    out = s.split(thou).join('').replace(dec, '.');
  } else if (dots > 1) out = /^\d{1,3}(\.\d{3})+$/.test(s) ? s.split('.').join('') : null; // 22.10.2026 is a date
  else if (commas > 1) out = /^\d{1,3}(,\d{3})+$/.test(s) ? s.split(',').join('') : null;
  else if (dots === 1) { const [a, b] = s.split('.'); out = b.length === 3 && a.length >= 1 && a.length <= 3 && Number(a) !== 0 ? a + b : s; }
  else if (commas === 1) out = s.replace(',', '.'); // a single comma is the Slovenian decimal comma, also "1,234"
  else out = s;
  if (out === null) return null;
  const n = Number(out);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

/** A date as YYYY-MM-DD from "02.10.2026", "2.10.2026", "2. 10. 2026", "02/10/2026", "02-10-2026", "2026-10-02",
 * "2026-10-02T00:00:00", "20261002" or a two-digit year ("02.10.26" is 2026). Day first, as in Slovenia. Returns null
 * for text that is not a real calendar date. */
export function parseDate(v) {
  if (v == null) return null;
  const s = String(v).replace(/[  ]/g, ' ').trim();
  let y, m, d, k;
  if ((k = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:[T ].*)?$/.exec(s))) [, y, m, d] = k;
  else if ((k = /^(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{4}|\d{2})\s*\.?(?:\s.*)?$/.exec(s))) { [, d, m, y] = k; if (y.length === 2) y = '20' + y; }
  else if ((k = /^(\d{4})(\d{2})(\d{2})$/.exec(s))) [, y, m, d] = k;
  else return null;
  y = +y; m = +m; d = +d;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (y < 1990 || y > 2100 || dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
/** 2026-10-02 shown the Slovenian way: 02.10.2026. */
export const showDate = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? `${m[3]}.${m[2]}.${m[1]}` : String(iso || ''); };
/** Days from a to b (ISO dates). */
export const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);

/** A VAT rate in percent from "22", "22 %", "9,5 %", "0.22" (a fraction, as Excel stores 22 %) or "DDV 22%". */
export function parseVatRate(v) {
  if (isNum(v)) return v > 0 && v < 1 ? round4(v * 100) : v;
  const s = String(v ?? '').replace(/ddv|vat|tax/gi, '').trim();
  if (!s) return null;
  const pct = /%/.test(s), n = parseNumber(s.replace('%', ''));
  if (n == null || n < 0 || n > 100) return null;
  return !pct && n > 0 && n < 1 ? round4(n * 100) : n;
}

/** Money and quantities for display: 1.234,56 (Slovenian). */
export function showMoney(n, digits = 2) {
  if (!isNum(n)) return '';
  const [i, f] = Math.abs(n).toFixed(digits).split('.');
  return (n < 0 ? '-' : '') + i.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (f ? ',' + f : '');
}
export const showQty = (n) => (isNum(n) ? showMoney(round4(n), 4).replace(/,?0+$/, '') : '');
/** A unit price: at least 2 and at most 4 decimals, 85,00 or 0,0125. */
export const showPrice = (n) => { if (!isNum(n)) return ''; const k = Math.min(4, Math.max(2, (String(round4(n)).split('.')[1] || '').length)); return showMoney(round4(n), k); };
export const showRate = (r) => (isNum(r) ? String(r).replace('.', ',') + ' %' : '');

// ── identifiers ─────────────────────────────────────────────────────────────────────────────────────────
/** A VAT ID without spaces or dots, upper case: "si 1234 5679" becomes SI12345679. */
export const normalizeVatId = (s) => String(s ?? '').replace(/[\s.\-/]/g, '').toUpperCase();
/** SI + 8 digits, the first not 0; the 8th digit is a check digit (weights 8 to 2 on the first seven, 11 minus the
 * remainder mod 11, 10 counts as 0 and 11 as 1: the same rule as python-stdnum's si.ddv). */
export function siVatIdOk(id) {
  const m = /^SI([1-9]\d{6})(\d)$/.exec(normalizeVatId(id));
  if (!m) return false;
  const sum = [...m[1]].reduce((t, d, i) => t + (8 - i) * Number(d), 0);
  return (11 - (sum % 11)) % 10 === Number(m[2]);
}
export const vatIdShape = (id) => { const n = normalizeVatId(id); return /^[A-Z]{2}[0-9A-Z]{2,12}$/.test(n); };

export const normalizeIban = (s) => String(s ?? '').replace(/[\s.\-]/g, '').toUpperCase();
/** ISO 13616: country, two check digits, up to 30 letters or digits, and the remainder of the digits mod 97 must be 1.
 * Slovenian IBANs are 19 characters (SI56 + 15 digits). */
export function ibanOk(iban) {
  const s = normalizeIban(iban);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  if (s.startsWith('SI') && !/^SI\d{17}$/.test(s)) return false;
  let r = 0;
  for (const ch of s.slice(4) + s.slice(0, 4)) for (const d of /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch) r = (r * 10 + Number(d)) % 97;
  return r === 1;
}
/** An IBAN in groups of four. */
export const showIban = (s) => normalizeIban(s).replace(/(.{4})/g, '$1 ').trim();

// ── the invoice ─────────────────────────────────────────────────────────────────────────────────────────
export const emptyParty = () => ({ name: '', vatId: '', iban: '', street: '', postalCode: '', city: '', country: '', contact: '' });
export const emptyInvoice = () => ({
  number: '', issueDate: '', dueDate: '', currency: 'EUR', paymentReference: '', note: '',
  seller: emptyParty(), buyer: emptyParty(), lines: [], stated: { net: null, gross: null }, warnings: [],
});
export const emptyLine = () => ({ description: '', quantity: null, unit: '', unitPrice: null, vatRate: null, net: null });

/** The amount of a line: what the file says, or quantity times unit price. Null when neither can be known. */
export function lineNet(l) {
  if (isNum(l.net)) return round2(l.net);
  if (isNum(l.quantity) && isNum(l.unitPrice)) return round2(l.quantity * l.unitPrice);
  return null;
}

/** Totals from the lines: per line { net, vat, gross }, per VAT rate { rate, taxable, vat }, and the sums. Lines
 * without an amount or a rate are left out of the VAT summary (validate.mjs reports them). VAT is rounded per rate,
 * as the VAT summary of an invoice is. */
export function computeTotals(inv) {
  const rows = [], byRate = new Map();
  for (const l of inv.lines || []) {
    const net = lineNet(l), rate = isNum(l.vatRate) ? l.vatRate : null;
    rows.push({ net, rate });
    if (net != null && rate != null) byRate.set(rate, round2((byRate.get(rate) || 0) + net));
  }
  const rates = [...byRate.entries()].sort((a, b) => b[0] - a[0]).map(([rate, taxable]) => ({ rate, taxable, vat: round2(taxable * rate / 100) }));
  const lines = rows.map((r) => (r.net != null && r.rate != null ? { net: r.net, vat: round2(r.net * r.rate / 100), gross: round2(r.net + round2(r.net * r.rate / 100)) } : { net: r.net, vat: null, gross: null }));
  const net = round2(rates.reduce((t, r) => t + r.taxable, 0)), vat = round2(rates.reduce((t, r) => t + r.vat, 0));
  return { lines, rates, net, vat, gross: round2(net + vat) };
}

/** Text for an XML or screen field from a cell: control characters out, white space tidied, and a leading = + - @ that
 * would make a spreadsheet read the text as a formula taken off (returns { text, formula } so callers can warn). */
export function safeText(v, max = 512) {
  let s = v == null ? '' : typeof v === 'number' ? String(v) : String(v);
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F￾￿]/g, '').replace(/[\t\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  let formula = false;
  while (/^(?:=|@|[+-](?=[A-Za-z(@=]))/.test(s)) { s = s.slice(1).trim(); formula = true; }
  if (s.length > max) s = s.slice(0, max);
  return { text: s, formula };
}

// ── units ───────────────────────────────────────────────────────────────────────────────────────────────
const UNIT_CODES = { kos: 'C62', kom: 'C62', 'pcs': 'C62', pc: 'C62', piece: 'C62', pieces: 'C62', 'ur': 'HUR', ura: 'HUR', ure: 'HUR', h: 'HUR', hour: 'HUR', hours: 'HUR', hrs: 'HUR', dan: 'DAY', dni: 'DAY', day: 'DAY', days: 'DAY', kg: 'KGM', g: 'GRM', t: 'TNE', m: 'MTR', km: 'KMT', m2: 'MTK', m3: 'MTQ', l: 'LTR', lit: 'LTR', pal: 'PF', paleta: 'PF', pallet: 'PF', mesec: 'MON', mes: 'MON', month: 'MON', kpl: 'SET', set: 'SET', pak: 'PK', pack: 'PK' };
/** UN/ECE Recommendation 20 code for a unit written in a cell (kos → C62); "C62" when unknown, and `known` says which. */
export function unitCode(u) {
  const k = String(u ?? '').replace(/²/g, '2').replace(/³/g, '3').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9.]+/g, '');
  if (!k) return { code: 'C62', known: false };
  if (/^[A-Z0-9]{2,3}$/.test(String(u).trim()) && Object.values(UNIT_CODES).includes(String(u).trim())) return { code: String(u).trim(), known: true };
  const c = UNIT_CODES[k] || UNIT_CODES[k.replace(/\./g, '')];
  return c ? { code: c, known: true } : { code: 'C62', known: false };
}

