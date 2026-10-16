/* Billing: e-SLOG 2.0 e-invoice (XML) from an issued document's frozen snapshot. Pure, no DOM; Node tests load it too.
 *
 * Source: GZS / ROSE project, "e-SLOG 2.0 Electronic Invoice" Part 1 (General Instructions) and Part 2 (Document
 * Composition), August 2020, with the official schema eSLOG20_INVOIC_v200.xsd and the sample
 * sample_eSLOG20_INVOIC_v200.xml, published at https://epos.si/eslog (e-SLOG-2.0-08-2020-EN.zip).
 * e-SLOG 2.0 is not UBL: it is the UN/EDIFACT INVOIC D01B message in XML (namespace urn:eslog:2.00), semantically
 * compliant with EN 16931-1. Segment and code choices below follow Part 2's mapping of each business term (BT-x):
 *   BT-1 S_BGM/C_C106/D_1004 · BT-2 S_DTM 137 · BT-3 S_BGM/C_C002/D_1001 (380 invoice, 381 credit note)
 *   BT-72 S_DTM 35 · BT-73/74 S_DTM 167/168 · BT-9 G_SG8 S_DTM 13 · BT-20 FTX AAB · BT-22 FTX GEN · BT-23/24 FTX DOC
 *   BT-25/26 G_SG1 RFF OI + DTM 384 · BT-83 G_SG1 RFF PQ · BT-120/121 FTX AGM · NBT-041 FTX PAI · NBT-042 FTX ALQ
 *   Seller G_SG2 NAD SE (BT-27, 35–40), FII RB (BT-84–86), RFF VA (BT-31), AHP (BT-32); Buyer NAD BY (BT-44, 50–55),
 *   RFF VA (BT-48), AHP (NBT-013, mandatory in Slovenia) · Lines G_SG26: LIN, IMD F (BT-153), QTY 47 (BT-129/130),
 *   MOA 203 (BT-131), PRI AAA (BT-146), TAX (BT-151/152), ALC A (BT-136–140) · Totals G_SG50 MOA 79/389/176/388/9,
 *   VAT breakdown G_SG52 (BT-116–119).
 * VAT category codes (UNCL 5305, EN 16931): S standard, AE reverse charge, K intra-EU supply, G export, O outside
 * the scope, E exempt; exemption codes from the CEF VATEX list.
 *
 * FIRST VERSION – check the files with your e-invoicing provider (or the UJP validator,
 * https://www.ujp.gov.si) before relying on them. Not covered: electronic signature, the envelope used for sending,
 * the Art. 76.a reverse-charge VAT display (NBG-05), consolidated / prepayment invoices.
 */
(function (root) {
  'use strict';
  const C = root.BillingCore || (typeof require === 'function' ? require('./core.js') : null);

  const xmlEsc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  // a tiny element builder: el('S_BGM', el('C_C002', t('D_1001', 380)))
  const t = (name, value) => (value === undefined || value === null || value === '' ? '' : `<${name}>${xmlEsc(value)}</${name}>`);
  const el = (name, ...kids) => { const body = kids.flat().filter(Boolean).join(''); return body ? `<${name}>${body}</${name}>` : ''; };
  const money = (c) => ((Number(c) || 0) / 100).toFixed(2);
  const dec = (v, max = 6) => String(Number((Number(v) || 0).toFixed(max)));
  const cut = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
  // split a long address over the three 35-character lines (BT-35, 36, 162)
  function addressLines(s) {
    const words = String(s || '').replace(/\s+/g, ' ').trim().split(' ');
    const out = [''];
    for (const w of words) {
      const cur = out[out.length - 1];
      if (!cur) out[out.length - 1] = w.slice(0, 35);
      else if ((cur + ' ' + w).length <= 35) out[out.length - 1] = `${cur} ${w}`;
      else if (out.length < 3) out.push(w.slice(0, 35));
      else break;
    }
    return out;
  }
  // "1000 Ljubljana" → { post: '1000', city: 'Ljubljana' }; "San Francisco, CA 94105" → city only
  function postCity(s, country) {
    const v = String(s || '').trim();
    let m = /^([A-Z]{0,2}-?\d[\dA-Z -]{1,9}?)\s+(.+)$/i.exec(v);
    if (m && /\d/.test(m[1])) return { post: m[1].trim(), city: m[2].trim() };
    m = /^(.+?)[, ]+([A-Z]{2}\s+)?(\d{4,6}(?:-\d{4})?)$/.exec(v);
    if (m) return { post: m[3], city: m[1].replace(/,\s*$/, '').trim() + (m[2] ? `, ${m[2].trim()}` : '') };
    return { post: '', city: v };
  }
  // UN/ECE Recommendation 20 unit codes for the units people type
  const UNIT_CODES = { kos: 'H87', 'kos.': 'H87', kom: 'H87', pc: 'H87', pcs: 'H87', piece: 'H87', ur: 'HUR', ura: 'HUR', ure: 'HUR', h: 'HUR', hour: 'HUR', hours: 'HUR',
    'mes.': 'MON', mes: 'MON', mesec: 'MON', month: 'MON', months: 'MON', dan: 'DAY', dni: 'DAY', day: 'DAY', days: 'DAY', teden: 'WEE', week: 'WEE',
    leto: 'ANN', year: 'ANN', kg: 'KGM', g: 'GRM', t: 'TNE', m: 'MTR', km: 'KMT', m2: 'MTK', 'm²': 'MTK', m3: 'MTQ', 'm³': 'MTQ', l: 'LTR', kpl: 'SET', 'kpl.': 'SET', set: 'SET' };
  const unitCode = (u) => UNIT_CODES[String(u || '').trim().toLowerCase()] || 'C62';

  // VAT category of the whole document (one treatment per document in Billing)
  function category(snap) {
    if (!snap.issuer.vatRegistered) return { code: 'E', rate: 0, vatex: '', reason: snap.clauses[0] || C.SMALL_TAXPAYER_CLAUSE[snap.lang === 'en' ? 'en' : 'sl'] };
    const reason = snap.clauses[0] || '';
    switch (snap.treatment) {
      case 'domestic_reverse': return { code: 'AE', rate: 0, vatex: 'VATEX-EU-AE', reason };
      case 'eu_services': return { code: 'AE', rate: 0, vatex: 'VATEX-EU-AE', reason };
      case 'eu_goods': return { code: 'K', rate: 0, vatex: 'VATEX-EU-IC', reason };
      case 'export_goods': return { code: 'G', rate: 0, vatex: 'VATEX-EU-G', reason };
      case 'export_services': return { code: 'O', rate: null, vatex: 'VATEX-EU-O', reason };
      default: return { code: 'S', rate: null, vatex: '', reason: '' };
    }
  }
  const taxNumberOf = (vatId, taxNumber, country) => {
    const v = C.normVatId(vatId);
    if (country === 'SI' || !country) return String(taxNumber || '').replace(/\s+/g, '') || (v.startsWith('SI') ? v.slice(2) : '');
    return String(taxNumber || '').replace(/\s+/g, '') || v;
  };

  // What blocks the export (errors) and what to know about the file (warnings).
  function problems(snap) {
    const errors = [], warnings = [];
    if (!snap || !snap.number) errors.push('Only issued invoices and credit notes can be exported.');
    if (!snap) return { errors, warnings };
    if (!['invoice', 'credit_note'].includes(snap.kind)) errors.push('e-SLOG covers invoices and credit notes, not quotes.');
    const c = snap.customer, s = snap.issuer;
    if (!taxNumberOf(c.vatId, c.taxNumber, c.country)) errors.push("The client's tax number or VAT ID (e-SLOG NBT-013 is mandatory in Slovenia). Add it to the client; issued invoices keep what they were issued with, so this one can't be exported.");
    if (snap.kind === 'invoice' && !s.iban) errors.push('An IBAN (payment account, BT-84).');
    if (!taxNumberOf(s.vatId, s.taxNumber, 'SI')) errors.push('Your tax number or VAT ID (BT-31/BT-32).');
    if (!postCity(c.postalCity, c.country).post) warnings.push("The client's postcode could not be read from \"" + c.postalCity + '": the city line is sent as written.');
    const cat = category(snap);
    if (snap.treatment === 'domestic_reverse' && s.vatRegistered) warnings.push('Domestic reverse charge (Art. 76.a): the base and the VAT the buyer accounts for (e-SLOG NBG-05) are not included.');
    if (cat.code === 'O') warnings.push('Services outside Slovenia use VAT category O, which by EN 16931 carries no VAT IDs, so your VAT ID is left out of this file (your tax number stays).');
    warnings.push('First version of the e-SLOG export: check it with your e-invoicing provider (or the UJP validator) before relying on it.');
    return { errors, warnings };
  }

  function party(role, p, { vatId, taxNo, iban, bic, accountName, email, phone }) {
    const pc = postCity(p.postalCity, p.country);
    const addr = addressLines(p.address);
    return el('G_SG2',
      el('S_NAD', t('D_3035', role), el('C_C080', t('D_3036', cut(p.name, 70))),
        el('C_C059', t('D_3042', addr[0] || '-'), t('D_3042_2', addr[1]), t('D_3042_3', addr[2])),
        t('D_3164', cut(pc.city, 35)), t('D_3251', cut(pc.post, 17)), t('D_3207', p.country || 'SI')),
      iban ? el('S_FII', t('D_3035', 'RB'), el('C_C078', t('D_3194', iban), t('D_3192', cut(accountName, 35))), bic ? el('C_C088', t('D_3433', cut(bic, 11))) : '') : '',
      vatId ? el('G_SG3', el('S_RFF', el('C_C506', t('D_1153', 'VA'), t('D_1154', vatId)))) : '',
      taxNo ? el('G_SG3', el('S_RFF', el('C_C506', t('D_1153', 'AHP'), t('D_1154', taxNo)))) : '',
      email ? el('G_SG5', el('S_CTA', t('D_3139', 'IC')), el('S_COM', el('C_C076', t('D_3148', email), t('D_3155', 'EM')))) : '',
      phone ? el('G_SG5', el('S_CTA', t('D_3139', role === 'SE' ? 'SU' : 'PD')), el('S_COM', el('C_C076', t('D_3148', phone), t('D_3155', 'TE')))) : '');
  }

  // The e-SLOG 2.0 XML for an issued invoice or credit note (snapshot as frozen at issue).
  function xml(snap) {
    const credit = snap.kind === 'credit_note';
    const sign = credit ? -1 : 1; // EN 16931: a credit note (381) carries positive amounts
    const sl = snap.lang !== 'en';
    const cat = category(snap);
    const s = snap.issuer, c = snap.customer;
    const dtm = (code, date) => (date ? el('S_DTM', el('C_C507', t('D_2005', code), t('D_2380', date))) : '');
    const ftx = (code, text, codeValue) => (text ? el('S_FTX', t('D_4451', code), codeValue ? el('C_C107', t('D_4441', codeValue)) : '', el('C_C108', t('D_4440', cut(text, 512)))) : '');
    const moa = (code, cents) => el('S_MOA', el('C_C516', t('D_5025', code), t('D_5004', money(cents))));
    const tax = (rate) => el('S_TAX', t('D_5283', '7'), el('C_C241', t('D_5153', 'VAT')), rate === null ? '' : el('C_C243', t('D_5278', dec(rate))), t('D_5305', cat.code));
    const period = snap.supplyTo && snap.supplyTo !== snap.supplyFrom;
    const legal = [s.registrationNumber ? `${sl ? 'Matična številka' : 'Registration no.'} ${s.registrationNumber}` : '', s.court ? `${sl ? 'Registrsko sodišče' : 'Registry court'}: ${s.court}` : '',
      s.shareCapital ? `${sl ? 'Osnovni kapital' : 'Share capital'}: ${s.shareCapital}` : ''].filter(Boolean).join(', ');
    const notes = [snap.note, snap.footer].filter(Boolean).join(' · ');

    const lines = snap.lines.map((l, k) => {
      let qty = Number(l.qty) * sign, price = Number(l.unitPrice);
      if (price < 0) { price = -price; qty = -qty; }
      const net = l.net * sign;
      const gross = Math.round(qty * price * 100);
      const allowance = gross - net;
      const code = unitCode(l.unit);
      return el('G_SG26',
        el('S_LIN', t('D_1082', k + 1)),
        el('S_IMD', t('D_7077', 'F'), el('C_C273', t('D_7008', cut(l.description, 256)))),
        el('S_QTY', el('C_C186', t('D_6063', '47'), t('D_6060', dec(qty)), t('D_6411', code))),
        String(l.description || '').length > 256 ? el('S_FTX', t('D_4451', 'ACB'), el('C_C108', t('D_4440', cut(l.description, 512)))) : '',
        el('G_SG27', moa('203', net)),
        el('G_SG29', el('S_PRI', el('C_C509', t('D_5125', 'AAA'), t('D_5118', dec(price)), t('D_5284', '1'), t('D_6411', code)))),
        el('G_SG34', tax(cat.code === 'S' ? Number(l.rate) : cat.rate)),
        allowance && l.discountPct ? el('G_SG39',
          el('S_ALC', t('D_5463', 'A'), el('C_C552', t('D_1230', sl ? 'Popust' : 'Discount'), t('D_5189', '95'))),
          el('G_SG41', el('S_PCD', el('C_C501', t('D_5245', '1'), t('D_5482', dec(l.discountPct))))),
          el('G_SG42', moa('204', allowance)), el('G_SG42', moa('25', gross))) : '');
    });

    const breakdown = snap.totals.byRate.map((r) => el('G_SG52', tax(cat.code === 'S' ? Number(r.rate) : cat.rate), moa('125', r.base * sign), moa('124', r.vat * sign)));
    const net = snap.totals.net * sign, vat = snap.totals.vat * sign, total = snap.totals.total * sign;

    const body = el('M_INVOIC',
      el('S_UNH', t('D_0062', cut(snap.number, 14)), el('C_S009', t('D_0065', 'INVOIC'), t('D_0052', 'D'), t('D_0054', '01B'), t('D_0051', 'UN'))),
      el('S_BGM', el('C_C002', t('D_1001', credit ? '381' : '380')), el('C_C106', t('D_1004', snap.number))),
      dtm('137', snap.issueDate),
      period ? [dtm('167', snap.supplyFrom), dtm('168', snap.supplyTo)] : dtm('35', snap.supplyFrom),
      credit ? '' : ftx('AAB', snap.dueDate ? `${sl ? 'Rok plačila' : 'Payment due by'} ${C.dmy(snap.dueDate)}` : ''),
      ftx('REG', legal),
      ftx('GEN', notes),
      el('S_FTX', t('D_4451', 'DOC'), el('C_C107', t('D_4441', 'P1')), el('C_C108', t('D_4440', 'urn:cen.eu:en16931:2017'))),
      cat.code !== 'S' ? ftx('AGM', cat.reason || (sl ? 'Brez DDV' : 'No VAT'), cat.vatex) : '',
      credit ? '' : ftx('PAI', '0'),
      credit ? '' : ftx('ALQ', ['eu_goods', 'export_goods'].includes(snap.treatment) ? 'GDSV' : 'SCVE'),
      credit && snap.creditOf ? el('G_SG1', el('S_RFF', el('C_C506', t('D_1153', 'OI'), t('D_1154', snap.creditOf.number))), dtm('384', snap.creditOf.issueDate)) : '',
      !credit && snap.reference ? el('G_SG1', el('S_RFF', el('C_C506', t('D_1153', 'PQ'), t('D_1154', snap.reference.replace(/\s+/g, ''))))) : '',
      party('BY', c, { vatId: c.vatId, taxNo: taxNumberOf(c.vatId, c.taxNumber, c.country), email: c.email }),
      party('SE', { ...s, country: 'SI' }, { vatId: cat.code === 'O' ? '' : s.vatId, taxNo: taxNumberOf(s.vatId, s.taxNumber, 'SI'),
        iban: credit ? '' : s.iban, bic: s.bic, accountName: s.name, email: s.email, phone: s.phone }),
      ['eu_goods'].includes(snap.treatment) ? el('G_SG2', el('S_NAD', t('D_3035', 'DP'), t('D_3207', c.country))) : '',
      el('G_SG7', el('S_CUX', el('C_C504', t('D_6347', '2'), t('D_6345', snap.currency || 'EUR')))),
      credit ? '' : el('G_SG8', el('S_PAT', t('D_4279', '1')), dtm('13', snap.dueDate), el('S_PAI', el('C_C534', t('D_4461', '30')))),
      lines,
      el('S_UNS', t('D_0081', 'D')),
      el('G_SG50', moa('79', net)), el('G_SG50', moa('389', net)), el('G_SG50', moa('176', vat)), el('G_SG50', moa('388', total)), el('G_SG50', moa('9', total)),
      breakdown);
    return pretty(`<?xml version="1.0" encoding="UTF-8"?><Invoice xmlns="urn:eslog:2.00" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">${body.replace('<M_INVOIC>', '<M_INVOIC Id="data">')}</Invoice>`);
  }
  // Indent for people reading the file (leaf elements on one line; the content is the same).
  function pretty(x) {
    const tokens = x.match(/<[^>]+>|[^<]+/g) || [];
    const out = [];
    let depth = 0;
    for (let k = 0; k < tokens.length; k++) {
      const tok = tokens[k];
      if (!tok.startsWith('<')) { if (tok.trim()) out.push('  '.repeat(depth) + tok.trim()); continue; }
      if (tok.startsWith('<?')) { out.push(tok); continue; }
      if (tok.startsWith('</')) { depth--; out.push('  '.repeat(Math.max(0, depth)) + tok); continue; }
      if (tok.endsWith('/>')) { out.push('  '.repeat(depth) + tok); continue; }
      const next = tokens[k + 1], after = tokens[k + 2];
      if (next !== undefined && !next.startsWith('<') && after && after.startsWith('</')) { out.push('  '.repeat(depth) + tok + next + after); k += 2; continue; }
      out.push('  '.repeat(depth) + tok);
      depth++;
    }
    return out.join('\n') + '\n';
  }
  const fileName = (snap) => `${snap.number}-eslog.xml`;

  const api = { xml, problems, category, unitCode, postCity, addressLines, fileName, pretty };
  root.BillingEslog = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
