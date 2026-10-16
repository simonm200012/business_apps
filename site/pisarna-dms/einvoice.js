/* Pisarna DMS — branje e-računov v XML: e-SLOG 2.0 (GZS, struktura UN/EDIFACT INVOIC), e-SLOG 1.6
 * (IzdaniRacunEnostavni) in UBL 2.1 (Invoice / CreditNote, tudi Peppol BIS Billing 3.0).
 *
 * Čiste funkcije brez DOM-a in omrežja: deluje v brskalniku (window.DmsEInvoice) in v Node za teste.
 * Lasten mali bralnik XML: brez DTD in brez zunanjih entitet (nič se ne nalaga, ni XXE).
 *
 * Viri (preveri z resničnimi primeri dobaviteljev, preden se zaneseš na avtomatski uvoz):
 *  - e-SLOG 2.0: GZS, »e-SLOG 2.0 – e-račun«, segmenti S_BGM (D_1001 vrsta, D_1004 številka), S_DTM/C_C507
 *    (D_2005 137 = datum izdaje, 35 = datum opravljene storitve/dobave, 13 = rok plačila), G_SG2/S_NAD
 *    (D_3035 SE/II = izdajatelj, BY = kupec), S_FII (TRR), S_RFF (VA = ID za DDV, PQ = sklic), G_SG50/S_MOA
 *    (D_5025 389 = brez DDV, 176 = DDV, 388 = z DDV, 9 = za plačilo), G_SG52 (125 = osnova, 124 = DDV).
 *  - e-SLOG 1.6: GZS, shema IzdaniRacunEnostavni (GlavaRacuna, DatumiRacuna, PodatkiPodjetja,
 *    PovzetekDavkovRacuna, PovzetekZneskovRacuna; enake kode kot zgoraj).
 *  - UBL 2.1 / EN 16931: OASIS UBL 2.1; cbc:ID, cbc:IssueDate, cbc:DueDate, cac:LegalMonetaryTotal …
 */
(function (root) {
  'use strict';

  // ---------- mali bralnik XML ----------

  var ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  function decode(s) {
    return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, function (m, e) {
      if (e[0] === '#') { var n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; }
      return Object.prototype.hasOwnProperty.call(ENT, e.toLowerCase()) ? ENT[e.toLowerCase()] : m;
    });
  }
  function local(name) { var i = name.indexOf(':'); return i >= 0 ? name.slice(i + 1) : name; }
  // { name (brez predpone), attrs, kids, text }
  function parseXml(xml) {
    var s = String(xml || '').replace(/^﻿/, '');
    var rootEl = { name: '#doc', attrs: {}, kids: [], text: '' }, stack = [rootEl], i = 0, n = s.length;
    while (i < n) {
      var lt = s.indexOf('<', i);
      if (lt < 0) { stack[stack.length - 1].text += decode(s.slice(i)); break; }
      if (lt > i) stack[stack.length - 1].text += decode(s.slice(i, lt));
      if (s.startsWith('<!--', lt)) { var c = s.indexOf('-->', lt + 4); if (c < 0) throw new Error('Nezaključen komentar v XML.'); i = c + 3; continue; }
      if (s.startsWith('<![CDATA[', lt)) { var d = s.indexOf(']]>', lt + 9); if (d < 0) throw new Error('Nezaključen CDATA v XML.'); stack[stack.length - 1].text += s.slice(lt + 9, d); i = d + 3; continue; }
      if (s.startsWith('<?', lt)) { var q = s.indexOf('?>', lt + 2); if (q < 0) throw new Error('Napačen XML.'); i = q + 2; continue; }
      if (s.startsWith('<!', lt)) { // DOCTYPE: preskočimo (entitete iz DTD se ne razširjajo)
        var depth = 0, j = lt + 2;
        for (; j < n; j++) { if (s[j] === '[') depth++; else if (s[j] === ']') depth--; else if (s[j] === '>' && depth <= 0) break; }
        i = j + 1; continue;
      }
      var gt = lt + 1, quote = null;
      for (; gt < n; gt++) { var ch = s[gt]; if (quote) { if (ch === quote) quote = null; } else if (ch === '"' || ch === "'") quote = ch; else if (ch === '>') break; }
      if (gt >= n) throw new Error('Napačen XML: nezaključena oznaka.');
      var tag = s.slice(lt + 1, gt);
      i = gt + 1;
      if (tag[0] === '/') {
        var nm = local(tag.slice(1).trim());
        var top = stack.pop();
        if (!top || top.name !== nm || stack.length < 1) throw new Error('Napačen XML: oznaka </' + nm + '> ne ustreza.');
        continue;
      }
      var self = /\/\s*$/.test(tag);
      if (self) tag = tag.replace(/\/\s*$/, '');
      var m = /^([^\s]+)/.exec(tag);
      if (!m) throw new Error('Napačen XML.');
      var el = { name: local(m[1]), attrs: {}, kids: [], text: '' };
      var re = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g, a;
      while ((a = re.exec(tag.slice(m[1].length)))) el.attrs[local(a[1])] = decode(a[3] != null ? a[3] : a[4]);
      stack[stack.length - 1].kids.push(el);
      if (!self) stack.push(el);
    }
    if (stack.length !== 1) throw new Error('Napačen XML: nezaključena oznaka <' + stack[stack.length - 1].name + '>.');
    if (!rootEl.kids.length) throw new Error('Datoteka ni XML.');
    return rootEl.kids[0];
  }
  function kids(el, name) { return el ? el.kids.filter(function (k) { return !name || k.name === name; }) : []; }
  function kid(el, name) { return el ? el.kids.find(function (k) { return k.name === name; }) || null : null; }
  function path(el, p) { var parts = p.split('/'), cur = el; for (var i = 0; i < parts.length && cur; i++) cur = kid(cur, parts[i]); return cur; }
  function txt(el, p) { var e = p ? path(el, p) : el; return e ? (e.text || '').trim() : ''; }
  function all(el, name, out) { out = out || []; if (!el) return out; el.kids.forEach(function (k) { if (k.name === name) out.push(k); all(k, name, out); }); return out; }
  function first(el, name) { if (!el) return null; for (var i = 0; i < el.kids.length; i++) { var k = el.kids[i]; if (k.name === name) return k; var f = first(k, name); if (f) return f; } return null; }

  // ---------- pretvorbe ----------

  function num(s) {
    s = String(s == null ? '' : s).trim().replace(/\s/g, '');
    if (!s) return null;
    // XML uporablja piko; nekateri pošljejo vejico
    if (/,\d{1,4}$/.test(s) && !/\.\d{1,4}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
    var v = Number(s);
    return isFinite(v) ? v : null;
  }
  function r2(v) { return v == null ? null : Math.round(v * 100) / 100; }
  function date(s) {
    s = String(s || '').trim();
    var m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(s);
    if (m) return m[1] + '-' + m[2] + '-' + m[3];
    m = /^(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})/.exec(s);
    return m ? m[3] + '-' + (m[2].length < 2 ? '0' : '') + m[2] + '-' + (m[1].length < 2 ? '0' : '') + m[1] : null;
  }
  function clean(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

  function emptyParty() { return { name: '', address: '', postal: '', city: '', country: '', vatId: '', regNo: '', iban: '', bic: '', email: '' }; }
  function result(format) {
    return { format: format, kind: 'racun', credit: false, number: '', issueDate: null, serviceDate: null, dueDate: null, currency: 'EUR', reference: '',
      seller: emptyParty(), buyer: emptyParty(), lines: [], taxes: [], net: null, vat: null, total: null, payable: null, note: '', warnings: [] };
  }

  // ---------- e-SLOG 2.0 ----------

  function eslog20(inv) {
    var r = result('e-SLOG 2.0');
    var bgm = first(inv, 'S_BGM');
    var type = txt(bgm, 'C_C002/D_1001');
    r.number = clean(txt(bgm, 'C_C106/D_1004'));
    if (type === '381') r.credit = true;
    if (type === '325') r.kind = 'predracun';
    kids(inv, 'S_DTM').forEach(function (d) {
      var code = txt(d, 'C_C507/D_2005'), v = date(txt(d, 'C_C507/D_2380'));
      if (code === '137') r.issueDate = v; else if (code === '35' || code === '432') r.serviceDate = r.serviceDate || v; else if (code === '13') r.dueDate = v;
    });
    kids(inv, 'G_SG1').forEach(function (g) {
      var rff = kid(g, 'S_RFF'); var c = txt(rff, 'C_C506/D_1153'), v = clean(txt(rff, 'C_C506/D_1154'));
      if ((c === 'PQ' || c === 'RF') && v && !r.reference) r.reference = v;
    });
    kids(inv, 'S_FTX').forEach(function (f) { var t = all(f, 'D_4440').map(function (e) { return clean(e.text); }).filter(Boolean).join(' '); if (t && !r.note) r.note = t.slice(0, 300); });
    kids(inv, 'G_SG2').forEach(function (g) {
      var nad = kid(g, 'S_NAD'); if (!nad) return;
      var role = txt(nad, 'D_3035'), p = role === 'BY' ? r.buyer : (role === 'SE' || role === 'II') ? r.seller : null;
      if (!p || (role === 'II' && r.seller.name)) return;
      p.name = clean(all(nad, 'D_3036').map(function (e) { return e.text; }).join(' '));
      p.address = clean(all(nad, 'D_3042').map(function (e) { return e.text; }).join(', '));
      p.city = clean(txt(nad, 'D_3164')); p.postal = clean(txt(nad, 'D_3251')); p.country = clean(txt(nad, 'D_3207'));
      kids(g, 'S_FII').forEach(function (f) { if (!p.iban) { p.iban = clean(txt(f, 'C_C078/D_3194')); p.bic = clean(txt(f, 'C_C088/D_3433')); } });
      all(g, 'S_RFF').forEach(function (rf) {
        var c = txt(rf, 'C_C506/D_1153'), v = clean(txt(rf, 'C_C506/D_1154'));
        if (c === 'VA' || c === 'AHP') { if (!p.vatId || c === 'VA') p.vatId = v; } else if (c === 'GN' || c === '0199' || c === 'XA') p.regNo = p.regNo || v;
      });
      all(g, 'S_COM').forEach(function (cm) { if (txt(cm, 'C_C076/D_3155') === 'EM' && !p.email) p.email = clean(txt(cm, 'C_C076/D_3148')); });
    });
    var cux = first(inv, 'S_CUX'); if (cux) r.currency = txt(cux, 'C_C504/D_6345') || r.currency;
    kids(inv, 'G_SG8').forEach(function (g) {
      kids(g, 'S_DTM').forEach(function (d) { if (txt(d, 'C_C507/D_2005') === '13') r.dueDate = date(txt(d, 'C_C507/D_2380')) || r.dueDate; });
    });
    kids(inv, 'G_SG26').forEach(function (g) {
      var desc = clean(all(kid(g, 'S_IMD'), 'D_7008').map(function (e) { return e.text; }).join(' '));
      var qty = num(txt(first(g, 'S_QTY'), 'C_C186/D_6060'));
      var amount = null, price = null, vat = null;
      all(g, 'S_MOA').forEach(function (mo) { var c = txt(mo, 'C_C516/D_5025'); if (c === '203') amount = num(txt(mo, 'C_C516/D_5004')); });
      all(g, 'S_PRI').forEach(function (pr) { var c = txt(pr, 'C_C509/D_5125'); if (price == null || c === 'AAA') price = num(txt(pr, 'C_C509/D_5118')); });
      all(g, 'S_TAX').forEach(function (tx) { var v = num(txt(tx, 'C_C243/D_5278')); if (v != null) vat = v; });
      r.lines.push({ desc: desc, qty: qty, price: price, amount: amount, vatRate: vat });
    });
    kids(inv, 'G_SG50').forEach(function (g) {
      var mo = kid(g, 'S_MOA'), c = txt(mo, 'C_C516/D_5025'), v = num(txt(mo, 'C_C516/D_5004'));
      if (c === '389' || (c === '79' && r.net == null)) r.net = v; else if (c === '176') r.vat = v; else if (c === '388') r.total = v; else if (c === '9') r.payable = v;
    });
    kids(inv, 'G_SG52').forEach(function (g) {
      var rate = num(txt(first(g, 'S_TAX'), 'C_C243/D_5278')), base = null, amt = null;
      all(g, 'S_MOA').forEach(function (mo) { var c = txt(mo, 'C_C516/D_5025'), v = num(txt(mo, 'C_C516/D_5004')); if (c === '125') base = v; else if (c === '124') amt = v; });
      if (base != null || amt != null) r.taxes.push({ rate: rate == null ? 0 : rate, base: base, amount: amt });
    });
    return r;
  }

  // ---------- e-SLOG 1.6 ----------

  function eslog16(rac) {
    var r = result('e-SLOG 1.6');
    var head = kid(rac, 'GlavaRacuna');
    var type = txt(head, 'VrstaRacuna');
    r.number = clean(txt(head, 'StevilkaRacuna'));
    if (type === '381') r.credit = true;
    if (type === '325') r.kind = 'predracun';
    kids(rac, 'DatumiRacuna').forEach(function (d) {
      var c = txt(d, 'VrstaDatuma'), v = date(txt(d, 'DatumRacuna'));
      if (c === '137') r.issueDate = v; else if (c === '35' || c === '432') r.serviceDate = r.serviceDate || v; else if (c === '13') r.dueDate = v;
    });
    var cur = kid(rac, 'Valuta'); if (cur) r.currency = txt(cur, 'KodaValute') || r.currency;
    kids(rac, 'PodatkiPodjetja').forEach(function (pp) {
      var nn = kid(pp, 'NazivNaslovPodjetja'), role = txt(nn, 'VrstaPartnerja');
      var p = role === 'BY' ? r.buyer : (role === 'II' || role === 'SE') ? r.seller : null;
      if (!p || (role === 'SE' && r.seller.name)) return;
      var nz = kid(nn, 'NazivPartnerja');
      p.name = clean(nz ? nz.kids.map(function (k) { return k.text; }).join(' ') : '');
      var ul = kid(nn, 'Ulica');
      p.address = clean(ul ? ul.kids.map(function (k) { return k.text; }).join(', ') : '');
      p.city = clean(txt(nn, 'Kraj')); p.postal = clean(txt(nn, 'PostnaStevilka')); p.country = clean(txt(nn, 'KodaDrzave') || txt(nn, 'NazivDrzave'));
      var br = first(pp, 'BancniRacun'); if (br) { p.iban = clean(txt(br, 'StevilkaBancnegaRacuna')); p.bic = clean(txt(br, 'BIC')); }
      kids(pp, 'ReferencniPodatkiPodjetja').forEach(function (rp) {
        var c = txt(rp, 'VrstaPodatkaPodjetja'), v = clean(txt(rp, 'PodatekPodjetja'));
        if (c === 'VA' || (c === 'AHP' && !p.vatId)) p.vatId = v; else if (c === 'GN' && !p.regNo) p.regNo = v;
      });
    });
    kids(rac, 'PlacilniPogoji').forEach(function (pp) {
      kids(pp, 'PlacilniRoki').forEach(function (rk) { if (txt(rk, 'VrstaDatumaPlacilnegaRoka') === '13' || !r.dueDate) r.dueDate = date(txt(rk, 'Datum')) || r.dueDate; });
    });
    kids(rac, 'PostavkeRacuna').forEach(function (g) {
      var desc = clean(all(g, 'OpisArtikla1').map(function (e) { return e.text; }).join(' '));
      var qty = num(txt(first(g, 'KolicinaArtikla'), 'Kolicina'));
      var amount = null;
      all(g, 'ZneskiPostavke').forEach(function (z) { if (txt(z, 'VrstaZneskaPostavke') === '203') amount = num(txt(z, 'ZnesekPostavke')); });
      var price = num(txt(first(g, 'CenaPostavke'), 'Cena'));
      var vat = num(txt(first(g, 'DavkiNaPostavki'), 'OdstotekDavkaPostavke'));
      r.lines.push({ desc: desc, qty: qty, price: price, amount: amount, vatRate: vat });
    });
    kids(rac, 'PovzetekDavkovRacuna').forEach(function (g) {
      var rate = num(txt(first(g, 'DavkiRacuna'), 'OdstotekDavka')), base = null, amt = null;
      kids(g, 'ZneskiDavkov').forEach(function (z) { var c = txt(z, 'VrstaZneskaDavka'), v = num(txt(z, 'ZnesekDavka')); if (c === '125') base = v; else if (c === '124') amt = v; });
      if (base != null || amt != null) r.taxes.push({ rate: rate == null ? 0 : rate, base: base, amount: amt });
    });
    kids(rac, 'PovzetekZneskovRacuna').forEach(function (g) {
      kids(g, 'ZneskiRacuna').forEach(function (z) {
        var c = txt(z, 'VrstaZneska'), v = num(txt(z, 'ZnesekRacuna'));
        if (c === '389' || (c === '79' && r.net == null)) r.net = v; else if (c === '176') r.vat = v; else if (c === '388' || c === '86') r.total = v; else if (c === '9') r.payable = v;
      });
      var sk = kid(g, 'SklicZaPlacilo'); if (sk && !r.reference) r.reference = clean(txt(sk, 'StevilkaSklica'));
    });
    return r;
  }

  // ---------- UBL 2.1 ----------

  function ublParty(el, p) {
    var party = kid(el, 'Party'); if (!party) return;
    p.name = clean(txt(party, 'PartyLegalEntity/RegistrationName') || txt(party, 'PartyName/Name'));
    var a = kid(party, 'PostalAddress');
    if (a) { p.address = clean([txt(a, 'StreetName'), txt(a, 'AdditionalStreetName')].filter(Boolean).join(', ')); p.city = clean(txt(a, 'CityName')); p.postal = clean(txt(a, 'PostalZone')); p.country = clean(txt(a, 'Country/IdentificationCode')); }
    kids(party, 'PartyTaxScheme').forEach(function (t) { var id = clean(txt(t, 'CompanyID')); if (id && (!p.vatId || /VAT/i.test(txt(t, 'TaxScheme/ID')))) p.vatId = id; });
    p.regNo = clean(txt(party, 'PartyLegalEntity/CompanyID'));
    p.email = clean(txt(party, 'Contact/ElectronicMail'));
  }
  function ubl(doc) {
    var r = result(doc.name === 'CreditNote' ? 'UBL 2.1 (dobropis)' : 'UBL 2.1');
    r.credit = doc.name === 'CreditNote' || txt(doc, 'InvoiceTypeCode') === '381';
    r.number = clean(txt(doc, 'ID'));
    r.issueDate = date(txt(doc, 'IssueDate'));
    r.dueDate = date(txt(doc, 'DueDate')) || date(txt(doc, 'PaymentMeans/PaymentDueDate')) || date(txt(doc, 'PaymentTerms/PaymentDueDate'));
    r.serviceDate = date(txt(doc, 'Delivery/ActualDeliveryDate')) || date(txt(doc, 'InvoicePeriod/EndDate'));
    r.currency = txt(doc, 'DocumentCurrencyCode') || r.currency;
    r.note = clean(txt(doc, 'Note')).slice(0, 300);
    ublParty(kid(doc, 'AccountingSupplierParty'), r.seller);
    ublParty(kid(doc, 'AccountingCustomerParty'), r.buyer);
    var pm = kid(doc, 'PaymentMeans');
    if (pm) { r.reference = clean(txt(pm, 'PaymentID')); r.seller.iban = clean(txt(pm, 'PayeeFinancialAccount/ID')); r.seller.bic = clean(txt(pm, 'PayeeFinancialAccount/FinancialInstitutionBranch/ID')); }
    var mt = kid(doc, 'LegalMonetaryTotal');
    r.net = num(txt(mt, 'TaxExclusiveAmount')); r.total = num(txt(mt, 'TaxInclusiveAmount')); r.payable = num(txt(mt, 'PayableAmount'));
    var tt = kids(doc, 'TaxTotal').find(function (t) { return kid(t, 'TaxSubtotal') || kid(t, 'TaxAmount'); });
    if (tt) {
      r.vat = num(txt(tt, 'TaxAmount'));
      kids(tt, 'TaxSubtotal').forEach(function (s) { r.taxes.push({ rate: num(txt(s, 'TaxCategory/Percent')) || 0, base: num(txt(s, 'TaxableAmount')), amount: num(txt(s, 'TaxAmount')) }); });
    }
    kids(doc, r.credit && doc.name === 'CreditNote' ? 'CreditNoteLine' : 'InvoiceLine').forEach(function (l) {
      r.lines.push({
        desc: clean(txt(l, 'Item/Name') || txt(l, 'Item/Description')),
        qty: num(txt(l, 'InvoicedQuantity') || txt(l, 'CreditedQuantity')),
        price: num(txt(l, 'Price/PriceAmount')),
        amount: num(txt(l, 'LineExtensionAmount')),
        vatRate: num(txt(l, 'Item/ClassifiedTaxCategory/Percent'))
      });
    });
    return r;
  }

  // ---------- vstop ----------

  function parse(xmlText) {
    var rootEl = parseXml(xmlText), r;
    // the element itself or the first one inside it (e-SLOG often comes in an envelope)
    function find(test) {
      if (test(rootEl)) return rootEl;
      var out = null;
      (function walk(el) { el.kids.forEach(function (k) { if (!out && test(k)) out = k; if (!out) walk(k); }); })(rootEl);
      return out;
    }
    var inv = find(function (e) { return e.name === 'M_INVOIC'; });
    var rac = inv ? null : find(function (e) { return e.name === 'Racun' && !!kid(e, 'GlavaRacuna'); });
    var u = inv || rac ? null : find(function (e) { return (e.name === 'Invoice' || e.name === 'CreditNote') && !!kid(e, 'ID'); });
    if (inv) r = eslog20(inv);
    else if (rac) r = eslog16(rac);
    else if (u) r = ubl(u);
    else throw new Error('To ni e-račun e-SLOG ali UBL (korenski element <' + rootEl.name + '>).');
    finish(r);
    return r;
  }
  function finish(r) {
    // manjkajoče vsote izračunamo iz davkov ali postavk
    if (r.net == null && r.taxes.length) r.net = r2(r.taxes.reduce(function (s, t) { return s + (t.base || 0); }, 0));
    if (r.vat == null && r.taxes.length) r.vat = r2(r.taxes.reduce(function (s, t) { return s + (t.amount || 0); }, 0));
    if (r.net == null && r.lines.length) r.net = r2(r.lines.reduce(function (s, l) { return s + (l.amount != null ? l.amount : (l.qty || 0) * (l.price || 0)); }, 0));
    if (r.total == null && r.net != null && r.vat != null) r.total = r2(r.net + r.vat);
    if (r.total == null) r.total = r.payable;
    if (r.payable == null) r.payable = r.total;
    if (r.vat == null && r.total != null && r.net != null) r.vat = r2(r.total - r.net);
    if (!r.taxes.length && r.net != null) {
      var rates = {};
      r.lines.forEach(function (l) { var k = l.vatRate == null ? 0 : l.vatRate; rates[k] = (rates[k] || 0) + (l.amount || 0); });
      var keys = Object.keys(rates);
      if (keys.length === 1) r.taxes.push({ rate: +keys[0], base: r.net, amount: r.vat });
    }
    r.lines.forEach(function (l) {
      if (l.amount == null && l.qty != null && l.price != null) l.amount = r2(l.qty * l.price);
      if (l.price == null && l.amount != null && l.qty) l.price = r2(l.amount / l.qty);
    });
    if (!r.number) r.warnings.push('Ni številke računa.');
    if (!r.issueDate) r.warnings.push('Ni datuma izdaje.');
    if (!r.seller.name) r.warnings.push('Ni naziva izdajatelja.');
    if (r.total == null) r.warnings.push('Ni zneska računa.');
    if (r.net != null && r.vat != null && r.total != null && Math.abs(r.net + r.vat - r.total) > 0.02) r.warnings.push('Osnova + DDV (' + fmt(r.net + r.vat) + ') se ne ujema z zneskom računa (' + fmt(r.total) + ').');
    if (r.seller.iban && !ibanOk(r.seller.iban)) r.warnings.push('TRR izdajatelja ' + r.seller.iban + ' nima pravilne kontrolne številke.');
    return r;
  }
  function fmt(v) { return v == null ? '' : v.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
  // ISO 13616 mod 97
  function ibanOk(iban) {
    var s = String(iban || '').replace(/\s/g, '').toUpperCase();
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{8,30}$/.test(s)) return false;
    if (/^[A-Z]{2}00/.test(s)) return true; // fiktivni demo računi (kontrolni števki 00)
    var t = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, function (c) { return String(c.charCodeAt(0) - 55); }), rem = 0;
    for (var i = 0; i < t.length; i++) rem = (rem * 10 + +t[i]) % 97;
    return rem === 1;
  }

  // stopnje DDV v Sloveniji (ZDDV-1, 41. in 41.a člen): 22 % splošna, 9,5 % znižana, 5 % (od 2022)
  function vatSlot(rate) {
    if (rate == null) return null;
    if (Math.abs(rate - 22) < 0.01) return 'ddv_osnovna_stopnja';
    if (Math.abs(rate - 9.5) < 0.01) return 'ddv_znizana_stopnja';
    if (Math.abs(rate - 5) < 0.01) return 'ddv_dodatna_stopnja_1';
    if (rate === 0) return 'ddv_neobdavcena';
    return null;
  }
  // polja kartice računa v Pisarni (ključi = imena polj e-SLOG v DMS)
  function toFields(r) {
    var f = {}, s = r.seller, b = r.buyer;
    function set(k, v) { if (v != null && v !== '') f[k] = v; }
    set(r.kind === 'predracun' ? 'stevilka_predracuna' : r.credit ? 'stevilka_dobropisa' : 'stevilka_racuna', r.number);
    if (r.credit) set('stevilka_racuna', r.number);
    set(r.kind === 'predracun' ? 'datum_predracuna' : 'datum_racuna', r.issueDate);
    if (r.credit) set('datum_dobropisa', r.issueDate);
    set('datum_opr_stor_izdaje_blaga', r.serviceDate);
    set('datum_zapadlosti_rok_placila', r.dueDate);
    set('sklic_placila', r.reference);
    set('skupni_znesek_racuna', r.payable != null ? r.payable : r.total);
    set('koncni_znesek', r.total);
    set('skupni_neto_znesek_racuna', r.net);
    set('skupni_znesek_ddv', r.vat);
    set('valuta_racuna', r.currency); set('valuta', r.currency);
    set('naziv_izdajatelja', s.name); set('naslov_izdajatelja', s.address); set('kraj_izdajatelja', s.city);
    set('postna_stevilka_izdajatelja', s.postal); set('koda_drzave_izdajatelja', s.country);
    set('id_za_ddv_izdajatelja', s.vatId); set('maticna_st_izdajatelja', s.regNo); set('izdajateljev_trr', s.iban);
    set('naziv_kupca', b.name); set('naslov_kupca', b.address); set('kraj_kupca', b.city); set('id_za_ddv_kupca', b.vatId);
    set('tip_racuna_sifra', r.kind === 'predracun' ? 'Predračun' : r.credit ? 'Dobropis' : 'Račun');
    r.taxes.forEach(function (t) {
      var k = vatSlot(t.rate);
      if (!k) return;
      if (k === 'ddv_neobdavcena') { set('ddv_neobdavcena_osnova', t.base); set('ddv_neobdavcena_stopnja', 0); return; }
      set(k + '_osnova', t.base); set(k + '_stopnja', t.rate); set(k + '_znesek', t.amount);
    });
    return f;
  }

  var api = { parse: parse, parseXml: parseXml, toFields: toFields, ibanOk: ibanOk, num: num, date: date, vatSlot: vatSlot };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DmsEInvoice = api;
})(typeof window !== 'undefined' ? window : this);
