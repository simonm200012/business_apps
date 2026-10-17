// eSLOG invoice: our own rule checks. This is NOT a check against the official eSLOG schema (the GZS XSD is not part of
// this project); it catches the things that make an invoice wrong or rejected: missing required fields, bad VAT ID or
// IBAN, dates in the wrong order, lines that do not add up. UJP's structure check (storitve.ujp.gov.si) is the final word.
// validate(inv) → issues [{ level: 'error' | 'warning', code, message, detail, field, fix }]; errors block the download.
// `field` says where to fix it: 'number', 'issueDate', 'dueDate', 'currency', 'seller.vatId' ... or 'line.3.vatRate'.
// Pure; tested by tools/tests/eslog-validate.test.js.
import {
  SI_VAT_RATES, computeTotals, daysBetween, ibanOk, isNum, lineNet, normalizeIban, normalizeVatId, round2, showDate, showMoney, showRate,
  siVatIdOk, unitCode, vatIdShape,
} from './model.mjs';

export const TOLERANCE = 0.011;

const sideName = (f) => (f.startsWith('seller.') ? 'Seller' : f.startsWith('buyer.') ? 'Buyer' : '');
/** The label of a "fix" button for a field. */
export function fixLabel(field) {
  if (field.startsWith('line.')) return `Edit line ${field.split('.')[1]}`;
  if (field.startsWith('seller.') || field.startsWith('buyer.')) return `Fix in ${sideName(field)} box`;
  if (field === 'lines') return 'Check the lines';
  if (field === 'totals') return 'Check the totals';
  return 'Fix in the mapping';
}

export function validate(inv) {
  const out = [];
  const add = (level, code, field, message, detail = '') => out.push({ level, code, field, message, detail, fix: fixLabel(field) });
  const err = (code, field, message, detail) => add('error', code, field, message, detail);
  const warn = (code, field, message, detail) => add('warning', code, field, message, detail);

  // header
  if (!inv.number) err('NUMBER_MISSING', 'number', 'Invoice number is missing', 'Pick the cell that holds it in the field mapping.');
  if (!inv.issueDate) err(inv._raw?.issueDate ? 'ISSUE_DATE_INVALID' : 'ISSUE_DATE_MISSING', 'issueDate', inv._raw?.issueDate ? `Issue date "${inv._raw.issueDate}" is not a date` : 'Issue date is missing', 'Use a real date such as 02.10.2026.');
  if (!inv.dueDate) {
    if (inv._raw?.dueDate) err('DUE_DATE_INVALID', 'dueDate', `Due date "${inv._raw.dueDate}" is not a date`, 'Use a real date such as 01.11.2026.');
    else warn('DUE_DATE_MISSING', 'dueDate', 'Due date is missing', 'The XML will have no payment deadline. Pick the cell with the due date if the file has one.');
  } else if (inv.issueDate && inv.dueDate < inv.issueDate) {
    err('DUE_BEFORE_ISSUE', 'dueDate', 'The due date is before the issue date', `Due ${showDate(inv.dueDate)} is ${daysBetween(inv.dueDate, inv.issueDate)} days before issue ${showDate(inv.issueDate)}.`);
  }
  if (!/^[A-Za-z]{3}$/.test(inv.currency || '')) err('CURRENCY_INVALID', 'currency', 'Currency is missing or not a 3-letter code', 'Use a code such as EUR.');
  else if (inv.currency.toUpperCase() !== 'EUR') warn('CURRENCY_NOT_EUR', 'currency', `Currency is ${inv.currency.toUpperCase()}, not EUR`, 'Invoices in Slovenia are normally in EUR. Check that this is what you want.');

  // parties
  for (const side of ['seller', 'buyer']) {
    const p = inv[side], who = side === 'seller' ? 'Seller' : 'Buyer';
    if (!p.name) err(`${side.toUpperCase()}_NAME_MISSING`, `${side}.name`, `${who} name is missing`, `Type it in the ${who} box.`);
    const vat = normalizeVatId(p.vatId);
    if (!vat) err(`${side.toUpperCase()}_VAT_MISSING`, `${side}.vatId`, `${who} VAT ID is missing`, side === 'buyer' ? 'Add it in the Buyer box. eSLOG needs it for domestic invoices.' : `Add it in the ${who} box, for example SI12345679.`);
    else if (vat.startsWith('SI')) { if (!siVatIdOk(vat)) err(`${side.toUpperCase()}_VAT_INVALID`, `${side}.vatId`, `${who} VAT ID ${vat} does not look valid`, 'A Slovenian VAT ID is SI and 8 digits, the last one a check digit. Check for a typo.'); }
    else if (!vatIdShape(vat)) err(`${side.toUpperCase()}_VAT_INVALID`, `${side}.vatId`, `${who} VAT ID ${vat} does not look valid`, 'It should start with a 2-letter country code and then digits.');
    if (p.iban) { if (!ibanOk(p.iban)) err(`${side.toUpperCase()}_IBAN_INVALID`, `${side}.iban`, `${who} IBAN ${normalizeIban(p.iban)} is not valid`, 'The check digits do not match. Check for a typo; a Slovenian IBAN has 19 characters.'); }
    else if (side === 'seller') warn('SELLER_IBAN_MISSING', 'seller.iban', 'Seller IBAN is missing', 'Without it the XML says nothing about where to pay.');
    if (!p.street || !p.city) warn(`${side.toUpperCase()}_ADDRESS_INCOMPLETE`, `${side}.${p.street ? 'city' : 'street'}`, `${who} address is incomplete`, `Add the street, postal code and city in the ${who} box.`);
  }

  // lines
  if (!inv.lines.length) err('NO_LINES', 'lines', 'The invoice has no lines', 'Check the line columns in the field mapping.');
  inv.lines.forEach((l, i) => {
    const n = i + 1, f = (k) => `line.${n}.${k}`;
    if (!l.description) err('LINE_DESCRIPTION_MISSING', f('description'), `Line ${n} has no description`, 'Every line needs a text.');
    else if (l.description.length > 256) warn('LINE_DESCRIPTION_LONG', f('description'), `Line ${n} has a very long description`, 'It is cut to 256 characters in the XML.');
    if (!isNum(l.quantity) || l.quantity === 0) err('LINE_QUANTITY_INVALID', f('quantity'), `Line ${n} has no valid quantity`, 'Enter a number other than 0.');
    else if (l.quantity < 0) warn('LINE_QUANTITY_NEGATIVE', f('quantity'), `Line ${n} has a negative quantity`, 'Credit notes are not made by this tool. Check that this is what you want.');
    if (!isNum(l.unitPrice) && !isNum(l.net)) err('LINE_PRICE_MISSING', f('unitPrice'), `Line ${n} has no price`, 'Enter the unit price.');
    if (isNum(l.vatRate)) {
      if (!SI_VAT_RATES.includes(l.vatRate)) warn('VAT_RATE_UNUSUAL', f('vatRate'), `Line ${n} uses a ${showRate(l.vatRate)} VAT rate`, `Slovenia has 22 %, 9,5 %, 5 % and 0 %. Check the rate or keep it.`);
      else if (l.vatRate === 0) warn('VAT_RATE_ZERO', f('vatRate'), `Line ${n} has 0 % VAT`, 'Make sure the invoice says why (for example an exemption). This tool does not write the reason into the XML.');
    } else err('LINE_VAT_MISSING', f('vatRate'), `Line ${n} has no VAT rate`, l.rawVat ? `"${l.rawVat}" is not a VAT rate. Use 22, 9,5, 5 or 0.` : 'Pick the VAT column in the field mapping, or type the rate here.');
    if (isNum(l.net) && isNum(l.quantity) && isNum(l.unitPrice)) {
      const calc = round2(l.quantity * l.unitPrice);
      if (Math.abs(calc - l.net) > Math.max(TOLERANCE, Math.abs(l.quantity) * 0.00005)) err('LINE_MATH', f('unitPrice'), `Line ${n}: ${showMoney(l.quantity, 0)} x ${showMoney(l.unitPrice)} is ${showMoney(calc)}, but the amount is ${showMoney(l.net)}`, 'Change the quantity, the price or the amount so they agree.');
    }
    if (l.unit && !unitCode(l.unit).known) warn('UNIT_UNKNOWN', f('unit'), `Line ${n}: the unit "${l.unit}" is not known`, 'It is written as "piece" (C62) in the XML.');
  });

  // totals
  const t = computeTotals(inv);
  if (inv.lines.length && isNum(inv.stated?.net) && Math.abs(inv.stated.net - t.net) > TOLERANCE) err('TOTAL_NET_MISMATCH', 'totals', `The lines add up to ${showMoney(t.net)} without VAT, the file says ${showMoney(inv.stated.net)}`, 'One of the lines, or the total in the file, is wrong.');
  if (inv.lines.length && isNum(inv.stated?.gross) && Math.abs(inv.stated.gross - t.gross) > TOLERANCE) err('TOTAL_MISMATCH', 'totals', `The lines add up to ${showMoney(t.gross)} with VAT, the file says ${showMoney(inv.stated.gross)}`, 'Check the lines and the VAT rates, or the total in the file.');

  for (const w of inv.warnings || []) warn(w.code, 'lines', w.message, '');
  return out;
}

/** The checks that passed, for the green rows: [{ code, message, detail }]. */
export function passedChecks(inv, issues) {
  const has = (...prefixes) => issues.some((i) => i.level === 'error' && prefixes.some((p) => i.field === p || i.field.startsWith(p + '.')));
  const out = [], t = computeTotals(inv);
  if (inv.number && inv.issueDate && !has('number', 'issueDate', 'dueDate')) out.push({ code: 'OK_HEADER', message: 'Invoice number and dates found', detail: `${inv.number}, issued ${showDate(inv.issueDate)}${inv.dueDate ? `, due ${showDate(inv.dueDate)}` : ''}.` });
  if (inv.seller.vatId && !has('seller.vatId')) out.push({ code: 'OK_SELLER_VAT', message: 'Seller VAT ID looks valid', detail: `${normalizeVatId(inv.seller.vatId)} has the right format${normalizeVatId(inv.seller.vatId).startsWith('SI') ? ' and check digit' : ''}.` });
  if (inv.buyer.vatId && !has('buyer.vatId')) out.push({ code: 'OK_BUYER_VAT', message: 'Buyer VAT ID looks valid', detail: `${normalizeVatId(inv.buyer.vatId)} has the right format${normalizeVatId(inv.buyer.vatId).startsWith('SI') ? ' and check digit' : ''}.` });
  if (inv.seller.iban && !has('seller.iban')) out.push({ code: 'OK_IBAN', message: 'Seller IBAN is valid', detail: `${normalizeIban(inv.seller.iban)} passes the check-digit test.` });
  if (inv.lines.length && !issues.some((i) => i.level === 'error' && /^(LINE_|NO_LINES)/.test(i.code))) out.push({ code: 'OK_LINES', message: `${inv.lines.length} ${inv.lines.length === 1 ? 'line' : 'lines'} read`, detail: 'Each has a description, quantity, price and VAT rate.' });
  if (inv.lines.length && !issues.some((i) => i.level === 'error' && /TOTAL|LINE_MATH/.test(i.code))) out.push({ code: 'OK_TOTALS', message: isNum(inv.stated?.gross) || isNum(inv.stated?.net) ? 'Totals add up' : 'Totals calculated', detail: `Lines sum to ${showMoney(t.gross)} ${inv.currency || ''} with VAT${isNum(inv.stated?.gross) ? ', same as the file' : ' (the file has no total to compare with)'}.` });
  return out;
}

export const summary = (issues) => ({ errors: issues.filter((i) => i.level === 'error').length, warnings: issues.filter((i) => i.level === 'warning').length });
export const canDownload = (issues) => !issues.some((i) => i.level === 'error');
