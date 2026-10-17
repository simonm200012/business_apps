// eSLOG invoice: builds an eSLOG 2.0 invoice (INVOIC) as XML from the normalised invoice (model.mjs).
//
// ┌─ ELEMENT MAPPING: TO VERIFY against e-SLOG-2.0 documentation from epos.si/eslog ───────────────────────────────┐
// │ This project does NOT contain or copy the official GZS XSD or sample files (licence unclear). The structure below │
// │ is written from knowledge of eSLOG 2.0 as a UN/EDIFACT INVOIC (D.01B) message in XML: segments are S_xxx, segment │
// │ groups G_SGnn, composites C_Cnnn, data elements D_nnnn. Names, order, code values, the date format and whether    │
// │ S_UNH/S_UNT, namespaces and further parties (II, IV, DP, PE) are required are UNVERIFIED. Run the output through │
// │ UJP's structure check (storitve.ujp.gov.si) before relying on it; that check is the final word.                   │
// └─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
//
//   Invoice
//     M_INVOIC Id="data"
//       S_BGM        document: C_C002/D_1001 380 (commercial invoice), C_C106/D_1004 invoice number
//       S_DTM        C_C507: D_2005 137 (document date), D_2380 CCYYMMDD, D_2379 102
//       S_PAI        C_C534/D_4461 42 (payment to a bank account)
//       S_FTX        D_4451 AAI, C_C108/D_4440 free text (only when the invoice has a note)
//       G_SG1        S_RFF C_C506: D_1153 PQ (payment reference), D_1154 value (only when the invoice has one)
//       G_SG2 ×2     S_NAD D_3035 SE (seller) or BY (buyer), C_C080/D_3036 name, C_C059/D_3042 street, D_3164 city,
//                    D_3251 postal code, D_3207 country; S_FII (seller only, with an IBAN): D_3035 RB, C_C078/D_3194 IBAN;
//                    G_SG3/S_RFF D_1153 VA, D_1154 VAT ID; G_SG5/S_CTA D_3139 IC, C_C056/D_3412 name (seller contact)
//       G_SG7        S_CUX C_C504: D_6347 2, D_6345 currency, D_6343 4 (invoice currency)
//       G_SG8        S_PAT D_4279 3 (fixed date) + S_DTM D_2005 13 (due date) (only when the invoice has a due date)
//       G_SG26 ×n    S_LIN D_1082 line number; S_IMD D_7077 F, C_C273/D_7008 description; S_QTY C_C186: D_6063 47, D_6060
//                    quantity, D_6411 unit (UN/ECE Rec. 20); G_SG27/S_MOA C_C516: D_5025 203, D_5004 line amount;
//                    G_SG29/S_PRI C_C509: D_5125 AAA, D_5118 net unit price; G_SG34/S_TAX D_5283 7, C_C241/D_5153 VAT,
//                    C_C243/D_5278 rate, D_5305 S (or Z at 0 %), and S_MOA D_5025 124 (VAT of the line)
//       S_UNS        D_0081 S
//       G_SG50 ×5    S_MOA C_C516 D_5025: 79 (sum of line amounts), 125 (taxable amount), 176 (VAT), 77 (invoice total),
//                    9 (amount due)
//       G_SG52 ×n    VAT summary, one per rate: S_TAX (as in G_SG34), S_MOA 125 (taxable amount) and S_MOA 124 (VAT)
//
// Output is deterministic (no time stamps, no random ids): the same invoice gives the same bytes. Everything that goes
// between tags passes through xmlEscape (& < > " ' escaped, characters XML 1.0 refuses removed) and is cut to the
// length the data element allows; the element names are fixed in this file, so no cell can add markup.
import { xmlEscape, XML_DECLARATION } from '../lib.mjs';
import { computeTotals, isNum, lineNet, normalizeIban, normalizeVatId, round2, unitCode } from './model.mjs';

export const ESLOG_VERSION = '2.0';

const money = (n) => round2(n).toFixed(2);
/** A number with at least `min` and at most `max` decimals: 85 → "85.00", 3.5 → "3.50", 0.125 → "0.125". */
export function dec(n, min = 2, max = 4) {
  let s = Number(n).toFixed(max);
  while (s.includes('.') && s.endsWith('0') && s.split('.')[1].length > min) s = s.slice(0, -1);
  return s.endsWith('.') ? s.slice(0, -1) : s;
}
const compactDate = (iso) => String(iso || '').replace(/-/g, '');
const cut = (s, n) => Array.from(String(s ?? '')).slice(0, n).join('');
const chunks = (s, size, max) => { const a = Array.from(String(s ?? '').trim()), out = []; for (let i = 0; i < a.length && out.length < max; i += size) out.push(a.slice(i, i + size).join('')); return out; };

/** A tiny XML writer: el('S_BGM', [children]) or el('D_1001', 'text'). Children that are null are skipped. */
const el = (name, content) => ({ name, content: Array.isArray(content) ? content.filter(Boolean) : content });
const d = (code, value) => (value === '' || value == null ? null : el('D_' + code, String(value)));
const c = (code, ...kids) => (kids.some(Boolean) ? el('C_C' + code, kids) : null);
const seg = (name, ...kids) => el('S_' + name, kids);
const grp = (name, ...kids) => el('G_SG' + name, kids);

function inline(node) {
  if (typeof node.content === 'string') return `<${node.name}>${xmlEscape(node.content)}</${node.name}>`;
  return `<${node.name}>${node.content.map(inline).join('')}</${node.name}>`;
}
function write(node, depth, lines) {
  const pad = '  '.repeat(depth), open = node.name + (node.attrs ? ' ' + node.attrs : '');
  if (typeof node.content === 'string' || node.name.startsWith('C_')) lines.push(pad + inline(node)); // data elements and composites stay on one line
  else if (!node.content.length) lines.push(`${pad}<${open}/>`);
  else { lines.push(`${pad}<${open}>`); for (const k of node.content) write(k, depth + 1, lines); lines.push(`${pad}</${node.name}>`); }
}

const moa = (qual, amount) => seg('MOA', c('516', d('5025', qual), d('5004', money(amount))));
const tax = (rate, ...extra) => seg('TAX', d('5283', '7'), c('241', d('5153', 'VAT')), c('243', d('5278', dec(rate, 2, 2))), d('5305', rate > 0 ? 'S' : 'Z'), ...extra);

function party(role, p, inv) {
  const vat = normalizeVatId(p.vatId), iban = normalizeIban(p.iban);
  return grp('2',
    seg('NAD', d('3035', role),
      c('080', ...chunks(p.name, 70, 5).map((x) => d('3036', x))),
      c('059', ...chunks(p.street, 35, 4).map((x) => d('3042', x))),
      d('3164', cut(p.city, 35)), d('3251', cut(p.postalCode, 17)), d('3207', cut(p.country, 3))),
    role === 'SE' && iban ? seg('FII', d('3035', 'RB'), c('078', d('3194', cut(iban, 34)), d('3192', cut(p.name, 35)))) : null,
    vat ? grp('3', seg('RFF', c('506', d('1153', 'VA'), d('1154', cut(vat, 35))))) : null,
    role === 'SE' && p.contact ? grp('5', seg('CTA', d('3139', 'IC'), c('056', d('3412', cut(p.contact, 35))))) : null);
}

/** The eSLOG 2.0 XML text of an invoice. The caller checks validate() first; this builds whatever it is given. */
export function buildEslog(inv) {
  const t = computeTotals(inv), cur = (inv.currency || 'EUR').toUpperCase().slice(0, 3);
  const lines = inv.lines.map((l, i) => {
    const net = lineNet(l) ?? 0, rate = isNum(l.vatRate) ? l.vatRate : 0, qty = isNum(l.quantity) ? l.quantity : 1;
    const price = isNum(l.unitPrice) ? l.unitPrice : qty ? net / qty : net;
    return grp('26',
      seg('LIN', d('1082', i + 1)),
      seg('IMD', d('7077', 'F'), c('273', ...chunks(l.description, 256, 1).map((x) => d('7008', x)))),
      seg('QTY', c('186', d('6063', '47'), d('6060', dec(qty, 0, 4)), d('6411', unitCode(l.unit).code))),
      grp('27', moa('203', net)),
      grp('29', seg('PRI', c('509', d('5125', 'AAA'), d('5118', dec(price, 2, 4))))),
      grp('34', tax(rate), moa('124', round2(net * rate / 100))));
  });
  const doc = el('M_INVOIC', [
    seg('BGM', c('002', d('1001', '380')), c('106', d('1004', cut(inv.number, 35)))),
    inv.issueDate ? seg('DTM', c('507', d('2005', '137'), d('2380', compactDate(inv.issueDate)), d('2379', '102'))) : null,
    seg('PAI', c('534', d('4461', '42'))),
    inv.note ? seg('FTX', d('4451', 'AAI'), c('108', d('4440', cut(inv.note, 512)))) : null,
    inv.paymentReference ? grp('1', seg('RFF', c('506', d('1153', 'PQ'), d('1154', cut(inv.paymentReference, 35))))) : null,
    party('SE', inv.seller, inv),
    party('BY', inv.buyer, inv),
    grp('7', seg('CUX', c('504', d('6347', '2'), d('6345', cur), d('6343', '4')))),
    inv.dueDate ? grp('8', seg('PAT', d('4279', '3')), seg('DTM', c('507', d('2005', '13'), d('2380', compactDate(inv.dueDate)), d('2379', '102')))) : null,
    ...lines,
    seg('UNS', d('0081', 'S')),
    grp('50', moa('79', t.net)), grp('50', moa('125', t.net)), grp('50', moa('176', t.vat)), grp('50', moa('77', t.gross)), grp('50', moa('9', t.gross)),
    ...t.rates.map((r) => grp('52', tax(r.rate), moa('125', r.taxable), moa('124', r.vat))),
  ]);
  doc.attrs = 'Id="data"';
  const out = [];
  write(el('Invoice', [doc]), 0, out);
  return XML_DECLARATION + out.join('\n') + '\n';
}

/** A file name for the XML: eslog-<invoice number>.xml with only safe characters. */
export function eslogFileName(inv) {
  const n = String(inv.number || 'invoice').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 60) || 'invoice';
  return `eslog-${n}.xml`;
}
