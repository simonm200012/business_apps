/* Business Apps · Invoices — sample invoices for demos. They live only in the separate demo storage (?demo=1), never in
 * your own invoices and never in the cloud copy. Everything is fictional: example.si addresses, +386 1 000 … phones,
 * VAT IDs and IBANs with check digits 00 (not real accounts; the pay run accepts them only in the demo).
 * Dates are counted back from today, so the demo never goes stale.
 *
 *   InvoiceSamples.build(today)            [{ inv, bytes, mime, ext }] — e-SLOG and UBL XML files and small text PDFs
 *   InvoiceSamples.statement(invs, today)  a camt.053 bank statement paying what the demo pay run sent
 *   InvoiceSamples.pdf(items)              a one-page PDF from positioned text (Helvetica, Slovenian letters)
 * Pure functions (window.InvoiceSamples / module.exports).
 */
(function (root) {
  'use strict';

  var E = root && root.InvoiceEInvoice ? root.InvoiceEInvoice : (typeof require === 'function' ? require('./einvoice.js') : null);

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function addDays(iso, n) { var d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function dmy(iso) { return +iso.slice(8, 10) + '. ' + (+iso.slice(5, 7)) + '. ' + iso.slice(0, 4); }
  function eur(v) { return v.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' €'; }
  function r2(n) { return Math.round(n * 100) / 100; }

  // ---------- a tiny PDF writer ----------

  // WinAnsi plus č/Č/š/Š/ž/Ž on spare codes (Differences); € is WinAnsi 128
  var EXTRA = { 'Č': 200, 'č': 201, 'Š': 202, 'š': 203, 'Ž': 204, 'ž': 205, 'ć': 206, 'Ć': 207, 'đ': 208, 'Đ': 209 };
  var DIFF = '[200 /Ccaron /ccaron /Scaron /scaron /Zcaron /zcaron /cacute /Cacute /dcroat /Dcroat]';
  function pdfString(s) {
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      var code = EXTRA[ch] || (ch === '€' ? 128 : ch === '–' ? 150 : ch === '·' ? 183 : ch.charCodeAt(0));
      if (code > 255) code = 63;
      if (ch === '(' || ch === ')' || ch === '\\') out += '\\' + ch;
      else if (code < 32 || code > 126) out += '\\' + ('00' + code.toString(8)).slice(-3);
      else out += ch;
    }
    return '(' + out + ')';
  }
  // items: [{ x, y (from the top, pt), t, s (size), b (bold), r (right-aligned: x is the right edge) }]
  function pdf(items) {
    var W = 595, H = 842;
    var ops = ['BT'];
    items.forEach(function (it) {
      var size = it.s || 9.5;
      var x = it.x;
      // right-aligned text: Helvetica averages ~0.53 em per character, close enough for a demo
      if (it.r) x = it.x - String(it.t).length * size * (it.b ? 0.58 : 0.53);
      ops.push('/' + (it.b ? 'F2' : 'F1') + ' ' + size + ' Tf 1 0 0 1 ' + x.toFixed(1) + ' ' + (H - it.y).toFixed(1) + ' Tm ' + pdfString(String(it.t)) + ' Tj');
    });
    ops.push('ET');
    var stream = ops.join('\n');
    var objs = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + W + ' ' + H + '] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>',
      '<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding << /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences ' + DIFF + ' >> >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding << /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences ' + DIFF + ' >> >>'
    ];
    var out = '%PDF-1.4\n%âãÏÓ\n';
    var offs = [];
    objs.forEach(function (o, i) { offs.push(out.length); out += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
    var xref = out.length;
    out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + offs.map(function (o) { return ('0000000000' + o).slice(-10) + ' 00000 n \n'; }).join('');
    out += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
    var bytes = new Uint8Array(out.length);
    for (var i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 255;
    return bytes;
  }

  // a Slovenian-looking invoice page; returns the PDF bytes and the text lines as the app would read them
  function invoicePdf(d) {
    var it = [];
    var L = function (x, y, t, o) { it.push(Object.assign({ x: x, y: y, t: t }, o || {})); };
    L(48, 60, d.seller.name, { s: 14, b: true });
    L(48, 76, d.seller.street); L(48, 88, d.seller.postCode + ' ' + d.seller.city);
    L(48, 100, 'ID za DDV: ' + d.seller.vatId); L(48, 112, d.seller.email + ' · +386 1 000 00 ' + d.phone);
    L(547, 60, d.credit ? 'DOBROPIS' : 'RAČUN', { s: 18, b: true, r: true });
    L(380, 92, 'Številka'); L(547, 92, d.number, { r: true });
    L(380, 104, 'Datum izdaje'); L(547, 104, dmy(d.issueDate), { r: true });
    L(380, 116, 'Datum opravljene storitve'); L(547, 116, dmy(d.serviceDate || d.issueDate), { r: true });
    if (!d.credit) { L(380, 128, 'Rok plačila'); L(547, 128, dmy(d.dueDate), { r: true }); }
    L(48, 160, 'KUPEC', { s: 8 });
    L(48, 172, d.buyer.name, { b: true }); L(48, 184, d.buyer.street); L(48, 196, d.buyer.postCode + ' ' + d.buyer.city); L(48, 208, 'ID za DDV: ' + d.buyer.vatId);
    if (d.buyer.email) L(48, 220, d.buyer.email);
    var y = 260;
    L(48, y, 'Opis', { s: 8, b: true }); L(330, y, 'Količina', { s: 8, b: true }); L(420, y, 'Cena', { s: 8, b: true }); L(547, y, 'Znesek brez DDV', { s: 8, b: true, r: true });
    var t = E.totalsOf(d);
    d.items.forEach(function (x) { y += 16; L(48, y, x.name); L(330, y, String(x.qty || 1) + ' ' + (x.unitLabel || 'kos')); L(420, y, eur(x.price)); L(547, y, eur(x._net), { r: true }); });
    y += 34;
    var sg = d.credit ? '-' : '';
    t.rows.forEach(function (b) { L(330, y, 'Osnova ' + b.rate + ' %'); L(547, y, sg + eur(b.base), { r: true }); y += 13; L(330, y, 'DDV ' + b.rate + ' %'); L(547, y, sg + eur(b.vat), { r: true }); y += 13; });
    L(330, y, 'Skupaj brez DDV'); L(547, y, sg + eur(t.net), { r: true }); y += 13;
    L(330, y, 'Skupaj DDV'); L(547, y, sg + eur(t.vat), { r: true }); y += 16;
    L(330, y, d.credit ? 'Skupaj dobropis' : 'Za plačilo', { b: true, s: 11 }); L(547, y, sg + eur(t.total), { b: true, s: 11, r: true });
    y += 40;
    if (!d.credit) {
      L(48, y, 'Plačilo: IBAN ' + d.seller.iban.replace(/(.{4})(?=.)/g, '$1 ') + (d.seller.bic ? '   BIC ' + d.seller.bic : ''));
      L(48, y + 12, 'Sklic: ' + d.reference);
    }
    if (d.note) L(48, y + 30, d.note);
    L(48, 800, d.seller.name + ' · ' + d.seller.street + ', ' + d.seller.postCode + ' ' + d.seller.city + ' · ' + d.seller.web, { s: 7 });
    // the text lines as pdf.js gives them, grouped by row
    var rows = {};
    it.forEach(function (x) { var k = Math.round(x.y); (rows[k] = rows[k] || []).push(x); });
    var lines = Object.keys(rows).map(Number).sort(function (a, b) { return a - b; }).map(function (k) {
      return rows[k].sort(function (a, b) { return a.x - b.x; }).map(function (x) { return x.t; }).join('   ');
    });
    return { bytes: pdf(it), lines: lines, totals: t };
  }

  // ---------- the sample set ----------

  var BUYER = { name: 'Tokovi d.o.o.', street: 'Vzorčna ulica 1', postCode: '1000', city: 'Ljubljana', country: 'SI', vatId: 'SI00000019', email: 'nabava@example.si' };
  var V = {
    energija: { name: 'Energija Sava d.o.o.', street: 'Elektrarniška cesta 5', postCode: '4000', city: 'Kranj', country: 'SI', vatId: 'SI00000027', email: 'racuni@energija-sava.example.si', iban: 'SI00 0400 1000 0000 027', bic: 'BAKOSI2X', web: 'energija-sava.example.si' },
    lipa: { name: 'Lipa Net d.o.o.', street: 'Optična ulica 12', postCode: '2000', city: 'Maribor', country: 'SI', vatId: 'SI00000035', email: 'e-racuni@lipanet.example.si', iban: 'SI00 0510 0800 0000 035', bic: 'ABANSI2X', web: 'lipanet.example.si' },
    oblak: { name: 'Oblak Tehnologije d.o.o.', street: 'Ilica 100', postCode: '10000', city: 'Zagreb', country: 'HR', vatId: 'HR00000000043', email: 'billing@oblak.example.hr', iban: 'HR00 2340 0090 0000 0004 3', bic: 'PBZGHR2X', web: 'oblak.example.hr' },
    pisarna: { name: 'Pisarna Plus d.o.o.', street: 'Papirniška 3', postCode: '3000', city: 'Celje', country: 'SI', vatId: 'SI00000051', email: 'info@pisarnaplus.example.si', iban: 'SI00 1910 0001 0000 051', bic: 'DBSISI2X', web: 'pisarnaplus.example.si' },
    breza: { name: 'Računovodstvo Breza d.o.o.', street: 'Bilančna pot 8', postCode: '1000', city: 'Ljubljana', country: 'SI', vatId: 'SI00000060', email: 'breza@example.si', iban: 'SI00 0201 1000 0000 060', bic: 'LJBASI2X', web: 'breza.example.si' },
    grafit: { name: 'Tiskarna Grafit d.o.o.', street: 'Tiskarska 21', postCode: '6000', city: 'Koper', country: 'SI', vatId: 'SI00000078', email: 'grafit@example.si', iban: 'SI00 1010 0005 0000 078', bic: 'BAKOSI2X', web: 'grafit.example.si' },
    servis: { name: 'Avtoservis Mlin d.o.o.', street: 'Mlinska 2', postCode: '8000', city: 'Novo mesto', country: 'SI', vatId: 'SI00000086', email: 'servis@mlin.example.si', iban: 'SI00 6100 0000 0000 08', bic: '', web: 'mlin.example.si' }
  };
  function nospace(s) { return String(s || '').replace(/\s+/g, ''); }

  function build(today) {
    var out = [];
    var seq = 0;
    function base(d, kind) {
      var t = E.totalsOf(d);
      var sign = d.credit ? -1 : 1;
      return {
        id: 'sample-' + (++seq) + '-' + d.number.replace(/[^A-Za-z0-9]/g, ''),
        sample: true, hash: 'sample-' + seq, fileName: (kind === 'pdf' ? 'Racun_' : 'eRacun_') + d.number.replace(/[^A-Za-z0-9-]/g, '') + (kind === 'pdf' ? '.pdf' : '.xml'),
        mime: kind === 'pdf' ? 'application/pdf' : 'application/xml', ext: kind === 'pdf' ? 'pdf' : 'xml', payments: [], size: 0, pages: 1,
        addedAt: new Date(d.issueDate + 'T09:00:00Z').toISOString(),
        vendor: d.seller.name.replace(/\s+d\.o\.o\.$/, ''), detectedVendor: d.seller.name, vendorTaxId: d.seller.vatId, billedTo: 'stratum', billedPerson: d.buyer.email || '',
        number: d.number, issueDate: d.issueDate, dueDate: d.credit ? null : d.dueDate, currency: 'EUR', docType: d.credit ? 'credit' : undefined,
        total: r2(sign * t.total), vat: r2(sign * t.vat), net: r2(sign * t.net), eur: null, serviceDate: d.serviceDate || d.issueDate,
        vatRate: t.rows.length === 1 ? t.rows[0].rate : null, iban: nospace(d.seller.iban), bic: d.seller.bic || '', reference: d.credit ? '' : nospace(d.reference),
        poNumber: d.poNumber || '', category: d.category, notes: d.notes || '', reverseCharge: !!d.reverseCharge, paid: false, paidDate: null,
        status: d.review ? 'review' : 'ok', scanned: false, readError: false, confidence: {}, text: ''
      };
    }
    function approval(status, by, date, comment) {
      var a = { status: status, by: by, date: date, comment: comment || '' };
      a.history = [{ status: status, by: by, date: date, comment: comment || '' }];
      return a;
    }
    function addXml(d, kind, extra) {
      var xml = kind === 'ubl' ? E.buildUbl(d) : E.buildEslog(d);
      var parsed = E.read(xml);
      var inv = Object.assign(base(d, 'xml'), { einvoice: { format: parsed.format, warnings: parsed.warnings, payable: parsed.payable, prepaid: parsed.prepaid, attachments: [] }, text: parsed.lines.join('\n') }, extra || {});
      var bytes = typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(xml) : new Uint8Array(Buffer.from(xml, 'utf8'));
      inv.size = bytes.length;
      out.push({ inv: inv, bytes: bytes, mime: 'application/xml', ext: 'xml' });
      return inv;
    }
    function addPdf(d, extra) {
      d.phone = pad(10 + seq);
      var p = invoicePdf(d);
      var inv = Object.assign(base(d, 'pdf'), { text: p.lines.join('\n') }, extra || {});
      inv.size = p.bytes.length;
      out.push({ inv: inv, bytes: p.bytes, mime: 'application/pdf', ext: 'pdf' });
      return inv;
    }
    var y = today.slice(0, 4);
    var M = 'Maja Kos';
    // six months of electricity (e-SLOG) and accounting (PDF), paid, so the charts have a history
    for (var m = 6; m >= 1; m--) {
      var issue = addDays(today, -30 * m - 3);
      var kwh = 380 + ((m * 37) % 90);
      var e = addXml({ number: 'ES-' + issue.slice(0, 4) + '-' + pad(40 - m) + '15', issueDate: issue, dueDate: addDays(issue, 15), serviceDate: addDays(issue, -1), seller: V.energija, buyer: BUYER,
        reference: 'SI12 ' + issue.slice(2, 4) + pad(40 - m) + '-150027', items: [{ name: 'Električna energija VT/MT', qty: kwh, unit: 'KWH', price: 0.142, rate: 22 }, { name: 'Omrežnina', qty: 1, unit: 'C62', price: 18.4, rate: 22 }], category: 'Utilities' }, 'eslog',
        { approval: approval('approved', M, addDays(issue, 2)) });
      e.paid = true; e.paidDate = addDays(issue, 12); e.payments = [{ id: 'sp-' + e.id, date: e.paidDate, amount: e.total, method: 'Bank transfer', note: 'Sample payment' }];
      var b = addPdf({ number: 'B-' + issue.slice(0, 4) + '/0' + pad(60 - m), issueDate: issue, dueDate: addDays(issue, 8), seller: V.breza, buyer: BUYER, reference: 'SI00 ' + pad(60 - m) + '-' + issue.slice(0, 4),
        items: [{ name: 'Računovodske storitve – mesečni pavšal', qty: 1, price: 260, rate: 22, unitLabel: 'mes.' }], category: 'Accounting & legal' }, { approval: approval('approved', M, addDays(issue, 1)) });
      b.paid = true; b.paidDate = addDays(issue, 7); b.payments = [{ id: 'sp-' + b.id, date: b.paidDate, amount: b.total, method: 'Bank transfer', note: 'Sample payment' }];
    }
    // this month's work: approved and waiting for the pay run, waiting for approval, rejected, overdue, a credit note, one to check
    addXml({ number: 'ES-' + y + '-4015', issueDate: addDays(today, -6), dueDate: addDays(today, 9), serviceDate: addDays(today, -7), seller: V.energija, buyer: BUYER, reference: 'SI12 ' + y.slice(2) + '40-150027',
      items: [{ name: 'Električna energija VT/MT', qty: 412, unit: 'KWH', price: 0.142, rate: 22 }, { name: 'Omrežnina', qty: 1, unit: 'C62', price: 18.4, rate: 22 }], category: 'Utilities' }, 'eslog',
      { approval: approval('approved', M, addDays(today, -4), 'Poraba v mejah plana.') });
    addXml({ number: 'LN-' + y + '-118842', issueDate: addDays(today, -4), dueDate: addDays(today, 14), seller: V.lipa, buyer: BUYER, reference: 'SI05 118842-' + y,
      items: [{ name: 'Optični internet 1000/500 Mbit/s', qty: 1, unit: 'C62', price: 39.9, rate: 22 }, { name: 'Fiksna IP številka', qty: 1, unit: 'C62', price: 5, rate: 22 }, { name: 'Mobilni paket Poslovni L', qty: 3, unit: 'C62', price: 19.99, rate: 22 }], category: 'Telecom & internet' }, 'eslog',
      { approval: { status: 'pending', by: '', date: '', comment: '', history: [] } });
    addXml({ number: 'OT-' + y + '-00731', issueDate: addDays(today, -3), dueDate: addDays(today, 27), serviceDate: addDays(today, -3), seller: V.oblak, buyer: BUYER, reference: 'RF18539007547034',
      items: [{ name: 'Cloud hosting – produkcijski strežnik', qty: 1, unit: 'MON', price: 149, rate: 0, category: 'AE' }, { name: 'Varnostne kopije 500 GB', qty: 1, unit: 'MON', price: 22, rate: 0, category: 'AE' }],
      note: 'Prijenos porezne obveze – reverse charge (čl. 196 Direktive 2006/112/EZ).', category: 'Software & SaaS', reverseCharge: true, notes: 'Reverse charge: VAT is self-assessed by the buyer.' }, 'ubl',
      { approval: approval('approved', M, addDays(today, -2)) });
    addXml({ number: 'LN-' + y + '-118842-D', credit: true, issueDate: addDays(today, -2), seller: V.lipa, buyer: BUYER, reference: '',
      items: [{ name: 'Dobropis – izpad storitve 3 dni', qty: 1, unit: 'C62', price: 12.3, rate: 22 }], category: 'Telecom & internet' }, 'ubl', {});
    addPdf({ number: 'PP-' + y + '-2207', issueDate: addDays(today, -38), dueDate: addDays(today, -8), seller: V.pisarna, buyer: BUYER, reference: 'SI00 2207',
      items: [{ name: 'Papir A4 80 g, 5 x 500 listov', qty: 4, price: 23.5, rate: 22, unitLabel: 'paket' }, { name: 'Toner HP 59A', qty: 2, price: 89.9, rate: 22 }], category: 'Office & supplies' },
      { approval: approval('approved', M, addDays(today, -30)) });
    addPdf({ number: '2026/S-0193', issueDate: addDays(today, -9), dueDate: addDays(today, 6), seller: V.servis, buyer: BUYER, reference: 'SI00 193',
      items: [{ name: 'Menjava zimskih pnevmatik', qty: 1, price: 64, rate: 22 }, { name: 'Pnevmatike 205/55 R16', qty: 4, price: 92, rate: 22 }], category: 'Fuel & travel' },
      { approval: approval('rejected', M, addDays(today, -7), 'Ni naše vozilo – vrnjeno dobavitelju.') });
    addPdf({ number: 'TG-' + y + '-0448', issueDate: addDays(today, -1), dueDate: addDays(today, 29), seller: V.grafit, buyer: BUYER, reference: 'SI99',
      items: [{ name: 'Letaki A5, obojestransko, 1000 kos', qty: 1, price: 186, rate: 22 }, { name: 'Vizitke 2 x 250 kos', qty: 2, price: 34, rate: 22 }], category: 'Marketing', review: true },
      { approval: { status: 'pending', by: '', date: '', comment: '', history: [] } });
    return out;
  }

  // a camt.053 statement from the demo account that pays the invoices a demo pay run sent (and the overdue one)
  function statement(invoices, today, account) {
    var esc = function (s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
    var acct = String(account || 'SI00 0201 0000 0000 019').replace(/\s/g, '');
    var paid = invoices.filter(function (x) { return !x.paid && x.docType !== 'credit' && x.total > 0 && (x.payRun || (x.approval && x.approval.status === 'approved')); });
    var entries = paid.map(function (x, i) {
      var open = r2(x.total - (x.payments || []).reduce(function (s, p) { return s + (+p.amount || 0); }, 0));
      var ref = x.reference ? '<RmtInf><Strd><CdtrRefInf><Tp><CdOrPrtry><Cd>SCOR</Cd></CdOrPrtry></Tp><Ref>' + esc(x.reference) + '</Ref></CdtrRefInf></Strd></RmtInf>' : '<RmtInf><Ustrd>Racun ' + esc(x.number) + '</Ustrd></RmtInf>';
      return '<Ntry><NtryRef>' + (i + 1) + '</NtryRef><Amt Ccy="EUR">' + open.toFixed(2) + '</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>' + today + '</Dt></BookgDt><ValDt><Dt>' + today + '</Dt></ValDt><AcctSvcrRef>SMPL' + (1000 + i) + '</AcctSvcrRef>' +
        '<BkTxCd><Domn><Cd>PMNT</Cd><Fmly><Cd>ICDT</Cd><SubFmlyCd>ESCT</SubFmlyCd></Fmly></Domn></BkTxCd><NtryDtls><TxDtls><Refs><EndToEndId>' + esc((x.payRun && x.payRun.endToEnd) || 'NOTPROVIDED') + '</EndToEndId></Refs>' +
        '<AmtDtls><TxAmt><Amt Ccy="EUR">' + open.toFixed(2) + '</Amt></TxAmt></AmtDtls><RltdPties><Cdtr><Nm>' + esc(x.detectedVendor || x.vendor) + '</Nm></Cdtr><CdtrAcct><Id><IBAN>' + esc(x.iban) + '</IBAN></Id></CdtrAcct></RltdPties>' + ref + '</TxDtls></NtryDtls></Ntry>';
    });
    entries.push('<Ntry><NtryRef>99</NtryRef><Amt Ccy="EUR">2440.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>' + today + '</Dt></BookgDt><AcctSvcrRef>SMPL9999</AcctSvcrRef><NtryDtls><TxDtls><RltdPties><Dbtr><Nm>Kupec Vzorec d.o.o.</Nm></Dbtr></RltdPties><RmtInf><Ustrd>Placilo racuna 2026-0042</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>');
    return '<?xml version="1.0" encoding="UTF-8"?>\n<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><GrpHdr><MsgId>SAMPLE-STMT-' + today + '</MsgId><CreDtTm>' + today + 'T18:00:00</CreDtTm></GrpHdr>' +
      '<Stmt><Id>SAMPLE-' + today + '</Id><CreDtTm>' + today + 'T18:00:00</CreDtTm><Acct><Id><IBAN>' + acct + '</IBAN></Id><Ccy>EUR</Ccy></Acct>' + entries.join('') + '</Stmt></BkToCstmrStmt></Document>\n';
  }

  var api = { build: build, statement: statement, pdf: pdf, invoicePdf: invoicePdf, BUYER: BUYER };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.InvoiceSamples = api;
})(typeof window !== 'undefined' ? window : this);
