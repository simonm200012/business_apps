/* Business Apps · Invoices — XML e-invoices: e-SLOG 2.0 (Slovenia) and UBL 2.1 / PEPPOL BIS Billing 3.0 (also the
 * Croatian e-Račun CIUS, which is UBL). Pure functions, no DOM: window.InvoiceEInvoice in the browser, module.exports in
 * Node for the tests.
 *
 *   parseXml(text)            a small, strict XML reader (elements, attributes, text; namespaces folded to local names).
 *                             No DTDs and no entity definitions are processed, so a file can't pull in anything.
 *   detect(text)              'eslog' | 'ubl' | null — without reading the whole file
 *   read(text)                { format, docType, number, issueDate, dueDate, serviceDate, currency, total, vat, net, payable,
 *                               prepaid, vatBreakdown[], items[], seller{}, buyer{}, iban, bic, reference, poNumber, notes[],
 *                               attachments[], warnings[], lines[] (readable text for search) }
 *   attachment(text, index)   { name, mime, bytes: Uint8Array } of a PDF/image embedded in a UBL file
 *   buildUbl(data) / buildEslog(data)   write the same shapes back out (sample invoices, tests)
 *
 * Sources: e-SLOG 2.0 (GZS / EN 16931 syntax binding on UN/EDIFACT INVOIC D.01B, namespace urn:eslog:2.00): BGM 1001
 * 380 invoice / 381 credit note, DTM 2005 137 issue · 35 delivery · 167/168 period · 13 due (in SG8 PAT), RFF 1153 PQ
 * payment reference (BT-83) · ON order (BT-13), NAD 3035 SE seller · BY buyer, FII 3035 RB payee account (BT-84) +
 * 3433 BIC (BT-86), RFF VA VAT ID, CUX 6347=2 invoice currency, MOA 5025 79 lines · 389 without VAT (BT-109) · 176 VAT
 * (BT-110) · 388 with VAT (BT-112) · 113 prepaid (BT-113) · 9 payable (BT-115), SG52 TAX + MOA 125 base / 124 VAT.
 * UBL: OASIS UBL 2.1 Invoice-2 / CreditNote-2 with the PEPPOL BIS 3.0 business terms (cbc:ID BT-1, cbc:IssueDate BT-2,
 * cbc:DueDate BT-9, cac:PaymentMeans/cbc:PaymentID BT-83, cac:PayeeFinancialAccount BT-84, cac:LegalMonetaryTotal).
 */
(function (root) {
  'use strict';

  // ---------- XML reader ----------

  var ENT = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
  function decode(s) {
    return s.indexOf('&') === -1 ? s : s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, function (m, e) {
      if (e[0] === '#') {
        var cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : '';
      }
      return Object.prototype.hasOwnProperty.call(ENT, e) ? ENT[e] : m;
    });
  }
  function localName(q) { var i = q.indexOf(':'); return i === -1 ? q : q.slice(i + 1); }

  function parseXml(text) {
    var s = String(text || '').replace(/^﻿/, '');
    if (s.length > 30 * 1024 * 1024) throw new Error('the XML file is too large');
    var i = 0;
    var top = { name: '#doc', attrs: {}, children: [], text: '' };
    var stack = [top];
    var tagRe = /^<([A-Za-z_][\w.\-:]*)((?:\s+[A-Za-z_][\w.\-:]*\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/;
    var attrRe = /([A-Za-z_][\w.\-:]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
    while (i < s.length) {
      var lt = s.indexOf('<', i);
      if (lt === -1) { stack[stack.length - 1].text += decode(s.slice(i)); break; }
      if (lt > i) stack[stack.length - 1].text += decode(s.slice(i, lt));
      if (s.startsWith('<!--', lt)) { var ce = s.indexOf('-->', lt + 4); if (ce === -1) throw new Error('unclosed comment'); i = ce + 3; continue; }
      if (s.startsWith('<![CDATA[', lt)) { var de = s.indexOf(']]>', lt + 9); if (de === -1) throw new Error('unclosed CDATA'); stack[stack.length - 1].text += s.slice(lt + 9, de); i = de + 3; continue; }
      if (s.startsWith('<?', lt)) { var pe = s.indexOf('?>', lt + 2); if (pe === -1) throw new Error('unclosed declaration'); i = pe + 2; continue; }
      if (s.startsWith('<!', lt)) throw new Error('DOCTYPE declarations are not accepted');
      if (s[lt + 1] === '/') {
        var ge = s.indexOf('>', lt);
        if (ge === -1) throw new Error('unclosed end tag');
        var name = localName(s.slice(lt + 2, ge).trim());
        var open = stack.pop();
        if (!open || open === top || open.name !== name) throw new Error('mismatched </' + name + '>');
        i = ge + 1;
        continue;
      }
      var m = tagRe.exec(s.slice(lt, lt + 4000));
      if (!m) throw new Error('malformed tag near character ' + lt);
      var node = { name: localName(m[1]), attrs: {}, children: [], text: '' };
      attrRe.lastIndex = 0;
      var a;
      while ((a = attrRe.exec(m[2]))) node.attrs[localName(a[1])] = decode(a[3] != null ? a[3] : a[4]);
      stack[stack.length - 1].children.push(node);
      if (!m[3]) stack.push(node);
      i = lt + m[0].length;
    }
    if (stack.length !== 1) throw new Error('unclosed <' + stack[stack.length - 1].name + '>');
    var rootEl = top.children[0];
    if (!rootEl) throw new Error('no XML element found');
    return rootEl;
  }

  // ---------- tree helpers ----------

  function kids(n, name) { return n ? n.children.filter(function (c) { return c.name === name; }) : []; }
  function kid(n, name) { if (!n) return null; for (var i = 0; i < n.children.length; i++) if (n.children[i].name === name) return n.children[i]; return null; }
  function at(n, path) { var parts = path.split('/'); for (var i = 0; i < parts.length && n; i++) n = kid(n, parts[i]); return n || null; }
  function all(n, path) {
    var parts = path.split('/');
    var cur = n ? [n] : [];
    parts.forEach(function (p) { var next = []; cur.forEach(function (c) { next = next.concat(kids(c, p)); }); cur = next; });
    return cur;
  }
  function txt(n, path) { var x = path ? at(n, path) : n; return x ? x.text.trim() : ''; }
  function num(s) {
    s = String(s == null ? '' : s).trim();
    if (!s) return null;
    var v = Number(s);
    return isFinite(v) ? Math.round(v * 100) / 100 : null;
  }
  function isoDate(s) {
    var m = String(s || '').trim().match(/^(\d{4})-?(\d{2})-?(\d{2})/);
    return m ? m[1] + '-' + m[2] + '-' + m[3] : null;
  }
  function r2(n) { return Math.round(n * 100) / 100; }
  function cleanId(s) { return String(s || '').replace(/[\s.\-]/g, '').toUpperCase(); }

  function detect(text) {
    var head = String(text || '').slice(0, 4000);
    if (/urn:eslog:2\.00/.test(head) || /<(?:\w+:)?M_INVOIC\b/.test(head)) return 'eslog';
    if (/urn:oasis:names:specification:ubl:schema:xsd:(?:Invoice|CreditNote)-2/.test(head)) return 'ubl';
    return null;
  }

  // ---------- e-SLOG 2.0 ----------

  function eslogParty(g) {
    var nad = kid(g, 'S_NAD');
    var p = {
      role: txt(nad, 'D_3035'),
      name: txt(nad, 'C_C080/D_3036') || txt(nad, 'C_C080/D_3036_2'),
      street: [txt(nad, 'C_C059/D_3042'), txt(nad, 'C_C059/D_3042_2')].filter(Boolean).join(', '),
      postCode: txt(nad, 'D_3251'), city: txt(nad, 'D_3164'), country: txt(nad, 'D_3207'),
      vatId: '', taxNumber: '', email: '', iban: '', bic: ''
    };
    all(g, 'G_SG3/S_RFF/C_C506').forEach(function (r) {
      var q = txt(r, 'D_1153');
      var v = txt(r, 'D_1154');
      if (q === 'VA' && !p.vatId) p.vatId = cleanId(v);
      else if (q === 'AHP' && !p.taxNumber) p.taxNumber = cleanId(v);
    });
    kids(g, 'S_FII').forEach(function (f) {
      // RB = the payee's (seller's) receiving account
      if (txt(f, 'D_3035') === 'RB' && !p.iban) { p.iban = cleanId(txt(f, 'C_C078/D_3194')); p.bic = cleanId(txt(f, 'C_C088/D_3433')); }
    });
    all(g, 'G_SG5/S_COM/C_C076').forEach(function (c) { if (txt(c, 'D_3155') === 'EM' && !p.email) p.email = txt(c, 'D_3148'); });
    return p;
  }

  function readEslog(rootEl) {
    var m = rootEl.name === 'M_INVOIC' ? rootEl : kid(rootEl, 'M_INVOIC');
    if (!m) throw new Error('not an e-SLOG 2.0 invoice (no M_INVOIC)');
    var out = blank('e-SLOG 2.0');
    var code = txt(m, 'S_BGM/C_C002/D_1001');
    out.typeCode = code;
    out.docType = code === '381' ? 'credit' : 'invoice';
    out.number = txt(m, 'S_BGM/C_C106/D_1004');
    var dates = {};
    kids(m, 'S_DTM').forEach(function (d) {
      var q = txt(d, 'C_C507/D_2005');
      var v = isoDate(txt(d, 'C_C507/D_2380'));
      if (q && v && !dates[q]) dates[q] = v;
    });
    out.issueDate = dates['137'] || null;
    out.serviceDate = dates['35'] || dates['168'] || null;
    out.periodFrom = dates['167'] || null;
    out.periodTo = dates['168'] || null;
    all(m, 'G_SG8/S_DTM/C_C507').forEach(function (c) { if (txt(c, 'D_2005') === '13' && !out.dueDate) out.dueDate = isoDate(txt(c, 'D_2380')); });
    all(m, 'G_SG1/S_RFF/C_C506').forEach(function (r) {
      var q = txt(r, 'D_1153');
      var v = txt(r, 'D_1154');
      if (q === 'PQ' && !out.reference) out.reference = v.replace(/\s+/g, ' ').trim().toUpperCase();
      else if (q === 'ON' && !out.poNumber) out.poNumber = v;
    });
    kids(m, 'G_SG2').forEach(function (g) {
      var p = eslogParty(g);
      if (p.role === 'SE' || (p.role === 'II' && !out.seller.name)) out.seller = p;
      else if (p.role === 'BY' || (p.role === 'IV' && !out.buyer.name)) out.buyer = p;
    });
    var cux = all(m, 'G_SG7/S_CUX/C_C504');
    var cur = cux.filter(function (c) { return txt(c, 'D_6347') === '2'; })[0] || cux[0];
    out.currency = (cur && txt(cur, 'D_6345')) || 'EUR';
    var moa = {};
    all(m, 'G_SG50/S_MOA/C_C516').forEach(function (c) {
      var q = txt(c, 'D_5025');
      if (q && moa[q] == null) moa[q] = num(txt(c, 'D_5004'));
    });
    out.total = moa['388'];
    out.net = moa['389'] != null ? moa['389'] : moa['79'];
    out.vat = moa['176'];
    out.payable = moa['9'];
    out.prepaid = moa['113'];
    kids(m, 'G_SG52').forEach(function (g) {
      var tax = kid(g, 'S_TAX');
      if (txt(tax, 'C_C241/D_5153') !== 'VAT') return;
      var row = { rate: num(txt(tax, 'C_C243/D_5278')), category: txt(tax, 'D_5305'), base: null, vat: null };
      all(g, 'S_MOA/C_C516').forEach(function (c) {
        var q = txt(c, 'D_5025');
        if (q === '125') row.base = num(txt(c, 'D_5004'));
        if (q === '124') row.vat = num(txt(c, 'D_5004'));
      });
      out.vatBreakdown.push(row);
    });
    kids(m, 'G_SG26').forEach(function (g) {
      var name = '';
      kids(g, 'S_IMD').forEach(function (imd) { if (!name) name = txt(imd, 'C_C273/D_7008'); });
      var line = { name: name, qty: num(txt(g, 'S_QTY/C_C186/D_6060')), unit: txt(g, 'S_QTY/C_C186/D_6411'), net: null };
      all(g, 'G_SG27/S_MOA/C_C516').forEach(function (c) { if (txt(c, 'D_5025') === '203' && line.net == null) line.net = num(txt(c, 'D_5004')); });
      out.items.push(line);
    });
    kids(m, 'S_FTX').forEach(function (f) {
      var q = txt(f, 'D_4451');
      if (q === 'AAI' || q === 'GEN' || q === 'AAB' || q === 'REG') {
        var t = (kid(f, 'C_C108') ? kid(f, 'C_C108').children : []).map(function (c) { return c.text.trim(); }).filter(Boolean).join(' ');
        if (t) out.notes.push(t);
      }
    });
    out.iban = out.seller.iban;
    out.bic = out.seller.bic;
    return finish(out);
  }

  // ---------- UBL 2.1 / PEPPOL BIS 3 ----------

  function ublParty(p) {
    if (!p) return emptyParty();
    var vat = '';
    var tax = '';
    kids(p, 'PartyTaxScheme').forEach(function (ts) {
      var id = cleanId(txt(ts, 'CompanyID'));
      if (!id) return;
      if (txt(ts, 'TaxScheme/ID').toUpperCase() === 'VAT') { if (!vat) vat = id; } else if (!tax) tax = id;
    });
    var addr = kid(p, 'PostalAddress');
    return {
      role: '',
      name: txt(p, 'PartyLegalEntity/RegistrationName') || txt(p, 'PartyName/Name'),
      street: [txt(addr, 'StreetName'), txt(addr, 'AdditionalStreetName')].filter(Boolean).join(', '),
      postCode: txt(addr, 'PostalZone'), city: txt(addr, 'CityName'), country: txt(addr, 'Country/IdentificationCode'),
      vatId: vat, taxNumber: tax || cleanId(txt(p, 'PartyLegalEntity/CompanyID')), email: txt(p, 'Contact/ElectronicMail'), iban: '', bic: ''
    };
  }

  function readUbl(rootEl) {
    var credit = rootEl.name === 'CreditNote';
    if (rootEl.name !== 'Invoice' && !credit) throw new Error('not a UBL Invoice or CreditNote');
    var out = blank(/peppol|poacc:billing:3/i.test(txt(rootEl, 'CustomizationID')) ? 'PEPPOL BIS 3' : 'UBL 2.1');
    out.typeCode = txt(rootEl, credit ? 'CreditNoteTypeCode' : 'InvoiceTypeCode');
    out.docType = credit || out.typeCode === '381' ? 'credit' : 'invoice';
    out.number = txt(rootEl, 'ID');
    out.issueDate = isoDate(txt(rootEl, 'IssueDate'));
    out.dueDate = isoDate(txt(rootEl, 'DueDate')) || isoDate(txt(rootEl, 'PaymentMeans/PaymentDueDate'));
    out.currency = txt(rootEl, 'DocumentCurrencyCode') || 'EUR';
    out.poNumber = txt(rootEl, 'OrderReference/ID');
    out.periodFrom = isoDate(txt(rootEl, 'InvoicePeriod/StartDate'));
    out.periodTo = isoDate(txt(rootEl, 'InvoicePeriod/EndDate'));
    out.serviceDate = isoDate(txt(rootEl, 'Delivery/ActualDeliveryDate')) || out.periodTo;
    kids(rootEl, 'Note').forEach(function (n) { if (n.text.trim()) out.notes.push(n.text.trim()); });
    out.seller = ublParty(at(rootEl, 'AccountingSupplierParty/Party'));
    out.buyer = ublParty(at(rootEl, 'AccountingCustomerParty/Party'));
    kids(rootEl, 'PaymentMeans').forEach(function (pm) {
      if (!out.reference && txt(pm, 'PaymentID')) out.reference = txt(pm, 'PaymentID').replace(/\s+/g, ' ').trim().toUpperCase();
      var acct = cleanId(txt(pm, 'PayeeFinancialAccount/ID'));
      if (acct && !out.iban) { out.iban = acct; out.bic = cleanId(txt(pm, 'PayeeFinancialAccount/FinancialInstitutionBranch/ID')); }
    });
    // several TaxTotals: the one in the document currency carries the breakdown
    var taxTotals = kids(rootEl, 'TaxTotal');
    var tt = taxTotals.filter(function (t) { var a = kid(t, 'TaxAmount'); return a && (!a.attrs.currencyID || a.attrs.currencyID === out.currency); })[0] || taxTotals[0];
    if (tt) {
      out.vat = num(txt(tt, 'TaxAmount'));
      kids(tt, 'TaxSubtotal').forEach(function (st) {
        out.vatBreakdown.push({ rate: num(txt(st, 'TaxCategory/Percent')), category: txt(st, 'TaxCategory/ID'), base: num(txt(st, 'TaxableAmount')), vat: num(txt(st, 'TaxAmount')), reason: txt(st, 'TaxCategory/TaxExemptionReason') });
      });
    }
    var lmt = kid(rootEl, 'LegalMonetaryTotal');
    out.net = num(txt(lmt, 'TaxExclusiveAmount'));
    if (out.net == null) out.net = num(txt(lmt, 'LineExtensionAmount'));
    out.total = num(txt(lmt, 'TaxInclusiveAmount'));
    out.prepaid = num(txt(lmt, 'PrepaidAmount'));
    out.payable = num(txt(lmt, 'PayableAmount'));
    kids(rootEl, credit ? 'CreditNoteLine' : 'InvoiceLine').forEach(function (l) {
      var q = kid(l, credit ? 'CreditedQuantity' : 'InvoicedQuantity');
      out.items.push({ name: txt(l, 'Item/Name') || txt(l, 'Item/Description'), qty: q ? num(q.text) : null, unit: q ? q.attrs.unitCode || '' : '', net: num(txt(l, 'LineExtensionAmount')) });
    });
    kids(rootEl, 'AdditionalDocumentReference').forEach(function (d, idx) {
      var b = at(d, 'Attachment/EmbeddedDocumentBinaryObject');
      if (!b) return;
      out.attachments.push({ index: idx, name: b.attrs.filename || txt(d, 'ID') || 'attachment', mime: b.attrs.mimeCode || 'application/octet-stream', size: Math.floor(b.text.replace(/\s/g, '').length * 3 / 4) });
    });
    return finish(out);
  }

  function emptyParty() { return { role: '', name: '', street: '', postCode: '', city: '', country: '', vatId: '', taxNumber: '', email: '', iban: '', bic: '' }; }
  function blank(format) {
    return { format: format, typeCode: '', docType: 'invoice', number: '', issueDate: null, dueDate: null, serviceDate: null, periodFrom: null, periodTo: null,
      currency: 'EUR', total: null, net: null, vat: null, payable: null, prepaid: null, vatBreakdown: [], items: [], seller: emptyParty(), buyer: emptyParty(),
      iban: '', bic: '', reference: '', poNumber: '', notes: [], attachments: [], warnings: [], lines: [] };
  }

  // fill gaps from the other amounts, check the arithmetic, and write readable lines (search, "text read from the file")
  function finish(o) {
    var bd = o.vatBreakdown;
    if (o.vat == null && bd.length) o.vat = r2(bd.reduce(function (s, b) { return s + (b.vat || 0); }, 0));
    if (o.net == null && bd.length) o.net = r2(bd.reduce(function (s, b) { return s + (b.base || 0); }, 0));
    if (o.total == null && o.net != null && o.vat != null) o.total = r2(o.net + o.vat);
    if (o.vat == null && o.total != null && o.net != null) o.vat = r2(o.total - o.net);
    if (o.total != null && o.net != null && o.vat != null && Math.abs(o.net + o.vat - o.total) > 0.011) o.warnings.push('Net + VAT (' + r2(o.net + o.vat).toFixed(2) + ') is not the total (' + o.total.toFixed(2) + ').');
    if (bd.length && o.vat != null) {
      var sv = r2(bd.reduce(function (s, b) { return s + (b.vat || 0); }, 0));
      if (Math.abs(sv - o.vat) > 0.011) o.warnings.push('The VAT breakdown adds up to ' + sv.toFixed(2) + ', the VAT total is ' + o.vat.toFixed(2) + '.');
    }
    if (o.payable != null && o.total != null && o.prepaid == null && Math.abs(o.payable - o.total) > 0.011) o.warnings.push('The amount to pay (' + o.payable.toFixed(2) + ') differs from the total (' + o.total.toFixed(2) + ').');
    if (!o.number) o.warnings.push('The e-invoice has no invoice number.');
    o.vatRate = bd.length === 1 ? bd[0].rate : (bd.length === 0 && o.vat === 0 ? 0 : null);
    // EN 16931 VAT category codes: AE reverse charge, K intra-community supply, G export, E exempt, O outside scope
    o.reverseCharge = bd.some(function (b) { return b.category === 'AE' || b.category === 'K'; });
    var L = [];
    var t = o.docType === 'credit' ? 'Credit note' : 'Invoice';
    L.push(t + ' ' + o.number + '   (' + o.format + ' e-invoice)');
    L.push('Seller: ' + o.seller.name + (o.seller.vatId ? '   VAT ID ' + o.seller.vatId : ''));
    if (o.seller.street || o.seller.city) L.push('   ' + [o.seller.street, [o.seller.postCode, o.seller.city].filter(Boolean).join(' '), o.seller.country].filter(Boolean).join(', '));
    L.push('Buyer: ' + o.buyer.name + (o.buyer.vatId ? '   VAT ID ' + o.buyer.vatId : ''));
    if (o.buyer.street || o.buyer.city) L.push('   ' + [o.buyer.street, [o.buyer.postCode, o.buyer.city].filter(Boolean).join(' '), o.buyer.country].filter(Boolean).join(', '));
    if (o.buyer.email) L.push('   ' + o.buyer.email);
    L.push('Issue date ' + (o.issueDate || '–') + (o.dueDate ? '   Due date ' + o.dueDate : '') + (o.serviceDate ? '   Delivery ' + o.serviceDate : ''));
    o.items.forEach(function (it) { L.push('  ' + it.name + (it.qty != null ? '   ' + it.qty + ' ' + (it.unit || '') : '') + (it.net != null ? '   ' + it.net.toFixed(2) : '')); });
    bd.forEach(function (b) { L.push('VAT ' + (b.rate != null ? b.rate + ' %' : b.category) + '   base ' + (b.base != null ? b.base.toFixed(2) : '–') + '   VAT ' + (b.vat != null ? b.vat.toFixed(2) : '–')); });
    L.push('Total ' + (o.total != null ? o.total.toFixed(2) : '–') + ' ' + o.currency + (o.payable != null ? '   To pay ' + o.payable.toFixed(2) : ''));
    if (o.iban) L.push('IBAN ' + o.iban + (o.bic ? '   BIC ' + o.bic : ''));
    if (o.reference) L.push('Reference ' + o.reference);
    if (o.poNumber) L.push('Order ' + o.poNumber);
    o.notes.forEach(function (n) { L.push(n); });
    o.lines = L;
    return o;
  }

  function read(text) {
    var kind = detect(text);
    var rootEl = parseXml(text);
    if (kind === 'eslog' || rootEl.name === 'M_INVOIC' || kid(rootEl, 'M_INVOIC')) return readEslog(rootEl);
    if (rootEl.name === 'Invoice' || rootEl.name === 'CreditNote') return readUbl(rootEl);
    throw new Error('this XML is not an e-SLOG 2.0 or UBL invoice');
  }

  function b64ToBytes(b64) {
    var clean = String(b64 || '').replace(/[^A-Za-z0-9+/=]/g, '');
    if (typeof atob === 'function') {
      var bin = atob(clean);
      var out = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    return new Uint8Array(Buffer.from(clean, 'base64'));
  }
  function attachment(text, index) {
    var rootEl = parseXml(text);
    var d = kids(rootEl, 'AdditionalDocumentReference')[index];
    var b = d && at(d, 'Attachment/EmbeddedDocumentBinaryObject');
    if (!b) return null;
    return { name: b.attrs.filename || txt(d, 'ID') || 'attachment', mime: b.attrs.mimeCode || 'application/octet-stream', bytes: b64ToBytes(b.text) };
  }

  // ---------- writers (sample invoices and tests) ----------

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function f2(n) { return (Math.round(n * 100) / 100).toFixed(2); }

  // data: { number, credit, issueDate, dueDate, serviceDate, currency, seller{name, street, postCode, city, country, vatId,
  //   email, iban, bic}, buyer{…}, reference, poNumber, items[{name, qty, unit, price, rate}], note, attachment{name, mime, base64} }
  function totalsOf(d) {
    var by = {};
    var net = 0;
    (d.items || []).forEach(function (it) {
      var ln = r2((it.qty || 1) * it.price);
      it._net = ln;
      net = r2(net + ln);
      var k = String(it.rate);
      by[k] = by[k] || { rate: it.rate, base: 0, vat: 0, category: it.category || (it.rate ? 'S' : 'Z') };
      by[k].base = r2(by[k].base + ln);
    });
    var rows = Object.keys(by).map(function (k) { var b = by[k]; b.vat = r2(b.base * b.rate / 100); return b; });
    var vat = r2(rows.reduce(function (s, b) { return s + b.vat; }, 0));
    return { net: net, vat: vat, total: r2(net + vat), rows: rows };
  }

  function buildUbl(d) {
    var t = totalsOf(d);
    var C = d.credit;
    var cur = d.currency || 'EUR';
    var party = function (p, tag) {
      return '<cac:' + tag + '><cac:Party>' + (p.endpoint ? '<cbc:EndpointID schemeID="9949">' + esc(p.endpoint) + '</cbc:EndpointID>' : '') +
        '<cac:PartyName><cbc:Name>' + esc(p.name) + '</cbc:Name></cac:PartyName>' +
        '<cac:PostalAddress><cbc:StreetName>' + esc(p.street) + '</cbc:StreetName><cbc:CityName>' + esc(p.city) + '</cbc:CityName><cbc:PostalZone>' + esc(p.postCode) + '</cbc:PostalZone><cac:Country><cbc:IdentificationCode>' + esc(p.country || 'SI') + '</cbc:IdentificationCode></cac:Country></cac:PostalAddress>' +
        (p.vatId ? '<cac:PartyTaxScheme><cbc:CompanyID>' + esc(p.vatId) + '</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>' : '') +
        '<cac:PartyLegalEntity><cbc:RegistrationName>' + esc(p.name) + '</cbc:RegistrationName></cac:PartyLegalEntity>' +
        (p.email ? '<cac:Contact><cbc:ElectronicMail>' + esc(p.email) + '</cbc:ElectronicMail></cac:Contact>' : '') +
        '</cac:Party></cac:' + tag + '>';
    };
    var x = '<?xml version="1.0" encoding="UTF-8"?>\n<' + (C ? 'CreditNote' : 'Invoice') + ' xmlns="urn:oasis:names:specification:ubl:schema:xsd:' + (C ? 'CreditNote' : 'Invoice') + '-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">\n' +
      '<cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0</cbc:CustomizationID>\n<cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>\n' +
      '<cbc:ID>' + esc(d.number) + '</cbc:ID>\n<cbc:IssueDate>' + esc(d.issueDate) + '</cbc:IssueDate>\n' +
      (!C && d.dueDate ? '<cbc:DueDate>' + esc(d.dueDate) + '</cbc:DueDate>\n' : '') +
      '<cbc:' + (C ? 'CreditNoteTypeCode>381</cbc:CreditNoteTypeCode' : 'InvoiceTypeCode>380</cbc:InvoiceTypeCode') + '>\n' +
      (d.note ? '<cbc:Note>' + esc(d.note) + '</cbc:Note>\n' : '') +
      '<cbc:DocumentCurrencyCode>' + cur + '</cbc:DocumentCurrencyCode>\n' +
      (d.poNumber ? '<cac:OrderReference><cbc:ID>' + esc(d.poNumber) + '</cbc:ID></cac:OrderReference>\n' : '') +
      (d.attachment ? '<cac:AdditionalDocumentReference><cbc:ID>' + esc(d.attachment.name) + '</cbc:ID><cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="' + esc(d.attachment.mime) + '" filename="' + esc(d.attachment.name) + '">' + d.attachment.base64 + '</cbc:EmbeddedDocumentBinaryObject></cac:Attachment></cac:AdditionalDocumentReference>\n' : '') +
      party(d.seller, 'AccountingSupplierParty') + '\n' + party(d.buyer, 'AccountingCustomerParty') + '\n' +
      (d.serviceDate ? '<cac:Delivery><cbc:ActualDeliveryDate>' + esc(d.serviceDate) + '</cbc:ActualDeliveryDate></cac:Delivery>\n' : '') +
      (d.seller.iban ? '<cac:PaymentMeans><cbc:PaymentMeansCode>30</cbc:PaymentMeansCode>' + (C && d.dueDate ? '<cbc:PaymentDueDate>' + esc(d.dueDate) + '</cbc:PaymentDueDate>' : '') + (d.reference ? '<cbc:PaymentID>' + esc(d.reference) + '</cbc:PaymentID>' : '') + '<cac:PayeeFinancialAccount><cbc:ID>' + esc(d.seller.iban) + '</cbc:ID>' + (d.seller.bic ? '<cac:FinancialInstitutionBranch><cbc:ID>' + esc(d.seller.bic) + '</cbc:ID></cac:FinancialInstitutionBranch>' : '') + '</cac:PayeeFinancialAccount></cac:PaymentMeans>\n' : '') +
      '<cac:TaxTotal><cbc:TaxAmount currencyID="' + cur + '">' + f2(t.vat) + '</cbc:TaxAmount>' + t.rows.map(function (b) {
        return '<cac:TaxSubtotal><cbc:TaxableAmount currencyID="' + cur + '">' + f2(b.base) + '</cbc:TaxableAmount><cbc:TaxAmount currencyID="' + cur + '">' + f2(b.vat) + '</cbc:TaxAmount><cac:TaxCategory><cbc:ID>' + b.category + '</cbc:ID><cbc:Percent>' + b.rate + '</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal>';
      }).join('') + '</cac:TaxTotal>\n' +
      '<cac:LegalMonetaryTotal><cbc:LineExtensionAmount currencyID="' + cur + '">' + f2(t.net) + '</cbc:LineExtensionAmount><cbc:TaxExclusiveAmount currencyID="' + cur + '">' + f2(t.net) + '</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount currencyID="' + cur + '">' + f2(t.total) + '</cbc:TaxInclusiveAmount><cbc:PayableAmount currencyID="' + cur + '">' + f2(t.total) + '</cbc:PayableAmount></cac:LegalMonetaryTotal>\n' +
      (d.items || []).map(function (it, i) {
        var q = C ? 'CreditedQuantity' : 'InvoicedQuantity';
        return '<cac:' + (C ? 'CreditNoteLine' : 'InvoiceLine') + '><cbc:ID>' + (i + 1) + '</cbc:ID><cbc:' + q + ' unitCode="' + esc(it.unit || 'C62') + '">' + (it.qty || 1) + '</cbc:' + q + '><cbc:LineExtensionAmount currencyID="' + cur + '">' + f2(it._net) + '</cbc:LineExtensionAmount><cac:Item><cbc:Name>' + esc(it.name) + '</cbc:Name><cac:ClassifiedTaxCategory><cbc:ID>' + (it.category || (it.rate ? 'S' : 'Z')) + '</cbc:ID><cbc:Percent>' + it.rate + '</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory></cac:Item><cac:Price><cbc:PriceAmount currencyID="' + cur + '">' + f2(it.price) + '</cbc:PriceAmount></cac:Price></cac:' + (C ? 'CreditNoteLine' : 'InvoiceLine') + '>';
      }).join('\n') + '\n</' + (C ? 'CreditNote' : 'Invoice') + '>\n';
    return x;
  }

  function buildEslog(d) {
    var t = totalsOf(d);
    var dtm = function (q, v) { return v ? '<S_DTM><C_C507><D_2005>' + q + '</D_2005><D_2380>' + esc(v) + '</D_2380></C_C507></S_DTM>' : ''; };
    var rff = function (q, v) { return v ? '<G_SG1><S_RFF><C_C506><D_1153>' + q + '</D_1153><D_1154>' + esc(v) + '</D_1154></C_C506></S_RFF></G_SG1>' : ''; };
    var moa = function (q, v) { return '<G_SG50><S_MOA><C_C516><D_5025>' + q + '</D_5025><D_5004>' + f2(v) + '</D_5004></C_C516></S_MOA></G_SG50>'; };
    var party = function (p, role) {
      return '<G_SG2><S_NAD><D_3035>' + role + '</D_3035><C_C080><D_3036>' + esc(p.name) + '</D_3036></C_C080><C_C059><D_3042>' + esc(p.street) + '</D_3042></C_C059><D_3164>' + esc(p.city) + '</D_3164><D_3251>' + esc(p.postCode) + '</D_3251><D_3207>' + esc(p.country || 'SI') + '</D_3207></S_NAD>' +
        (role === 'SE' && p.iban ? '<S_FII><D_3035>RB</D_3035><C_C078><D_3194>' + esc(p.iban) + '</D_3194><D_3192>' + esc(p.name) + '</D_3192></C_C078>' + (p.bic ? '<C_C088><D_3433>' + esc(p.bic) + '</D_3433></C_C088>' : '') + '</S_FII>' : '') +
        (p.vatId ? '<G_SG3><S_RFF><C_C506><D_1153>VA</D_1153><D_1154>' + esc(p.vatId) + '</D_1154></C_C506></S_RFF></G_SG3>' : '') +
        (p.email ? '<G_SG5><S_CTA><D_3139>IC</D_3139></S_CTA><S_COM><C_C076><D_3148>' + esc(p.email) + '</D_3148><D_3155>EM</D_3155></C_C076></S_COM></G_SG5>' : '') +
        '</G_SG2>';
    };
    return '<?xml version="1.0" encoding="UTF-8"?>\n<Invoice xmlns="urn:eslog:2.00" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n<M_INVOIC Id="data">\n' +
      '<S_UNH><D_0062>' + esc(d.number) + '</D_0062><C_S009><D_0065>INVOIC</D_0065><D_0052>D</D_0052><D_0054>01B</D_0054><D_0051>UN</D_0051></C_S009></S_UNH>\n' +
      '<S_BGM><C_C002><D_1001>' + (d.credit ? '381' : '380') + '</D_1001></C_C002><C_C106><D_1004>' + esc(d.number) + '</D_1004></C_C106></S_BGM>\n' +
      dtm('137', d.issueDate) + dtm('35', d.serviceDate) + '\n' +
      (d.note ? '<S_FTX><D_4451>AAI</D_4451><C_C108><D_4440>' + esc(d.note) + '</D_4440></C_C108></S_FTX>\n' : '') +
      rff('ON', d.poNumber) + rff('PQ', d.reference) + '\n' +
      party(d.seller, 'SE') + '\n' + party(d.buyer, 'BY') + '\n' +
      '<G_SG7><S_CUX><C_C504><D_6347>2</D_6347><D_6345>' + (d.currency || 'EUR') + '</D_6345></C_C504></S_CUX></G_SG7>\n' +
      (d.dueDate ? '<G_SG8><S_PAT><D_4279>1</D_4279></S_PAT>' + dtm('13', d.dueDate) + '</G_SG8>\n' : '') +
      (d.items || []).map(function (it, i) {
        return '<G_SG26><S_LIN><D_1082>' + (i + 1) + '</D_1082></S_LIN><S_IMD><D_7077>F</D_7077><C_C273><D_7008>' + esc(it.name) + '</D_7008></C_C273></S_IMD><S_QTY><C_C186><D_6063>47</D_6063><D_6060>' + (it.qty || 1) + '</D_6060><D_6411>' + esc(it.unit || 'C62') + '</D_6411></C_C186></S_QTY>' +
          '<G_SG27><S_MOA><C_C516><D_5025>203</D_5025><D_5004>' + f2(it._net) + '</D_5004></C_C516></S_MOA></G_SG27>' +
          '<G_SG29><S_PRI><C_C509><D_5125>AAA</D_5125><D_5118>' + f2(it.price) + '</D_5118></C_C509></S_PRI></G_SG29>' +
          '<G_SG34><S_TAX><D_5283>7</D_5283><C_C241><D_5153>VAT</D_5153></C_C241><C_C243><D_5278>' + it.rate + '</D_5278></C_C243><D_5305>' + (it.category || (it.rate ? 'S' : 'Z')) + '</D_5305></S_TAX></G_SG34></G_SG26>';
      }).join('\n') + '\n<S_UNS><D_0081>S</D_0081></S_UNS>\n' +
      moa('79', t.net) + moa('389', t.net) + moa('388', t.total) + moa('9', t.total) + moa('176', t.vat) + '\n' +
      t.rows.map(function (b) {
        return '<G_SG52><S_TAX><D_5283>7</D_5283><C_C241><D_5153>VAT</D_5153></C_C241><C_C243><D_5278>' + b.rate + '</D_5278></C_C243><D_5305>' + b.category + '</D_5305></S_TAX><S_MOA><C_C516><D_5025>125</D_5025><D_5004>' + f2(b.base) + '</D_5004></C_C516></S_MOA><S_MOA><C_C516><D_5025>124</D_5025><D_5004>' + f2(b.vat) + '</D_5004></C_C516></S_MOA></G_SG52>';
      }).join('\n') + '\n</M_INVOIC>\n</Invoice>\n';
  }

  var api = { parseXml: parseXml, detect: detect, read: read, attachment: attachment, buildUbl: buildUbl, buildEslog: buildEslog, totalsOf: totalsOf,
    kids: kids, kid: kid, at: at, all: all, txt: txt, num: num, isoDate: isoDate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.InvoiceEInvoice = api;
})(typeof window !== 'undefined' ? window : this);
