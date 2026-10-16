/* Collections outbox (Business Apps): files the browser hands to the user's own mail app. Nothing is sent from here,
 * because the app has no mail server. Pure functions, no DOM; UMD so Node tests load it
 * (tools/tests/collections-outbox.test.js).
 * - pdfLetter: the reminder letter as a real-text A4 PDF (PDF 1.4, the built-in Helvetica fonts, so no font files
 *   are needed; č ć đ Č Ć Đ are added to the WinAnsi encoding through a /Differences array, š ž are in it already),
 *   with the UPN or EPC QR code drawn as vector squares.
 * - buildEml: a ready e-mail (RFC 5322 + MIME, UTF-8, the PDF attached). "X-Unsent: 1" makes Outlook open it as a
 *   new message to send; Apple Mail and Thunderbird open it too ("Send again" / "Edit as new").
 * - zipStore: several files in one ZIP (stored, no compression), for sending letters in bulk.
 * - statementHtml: a customer's statement as one self-contained page (open invoices, QR, "We will pay on…" and a
 *   dispute note that open the customer's mail app), to attach or print. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.CollOutbox = factory(root.CollEngine);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';

  // ── bytes ────────────────────────────────────────────────────────────────
  function utf8(s) { return new TextEncoder().encode(String(s)); }
  function bin(s) { var u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255; return u; }
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function base64(u) {
    var out = '', i = 0;
    for (; i + 2 < u.length; i += 3) { var n = (u[i] << 16) | (u[i + 1] << 8) | u[i + 2]; out += B64[n >> 18 & 63] + B64[n >> 12 & 63] + B64[n >> 6 & 63] + B64[n & 63]; }
    if (i < u.length) { var m = u[i] << 16 | (i + 1 < u.length ? u[i + 1] << 8 : 0); out += B64[m >> 18 & 63] + B64[m >> 12 & 63] + (i + 1 < u.length ? B64[m >> 6 & 63] : '=') + '='; }
    return out;
  }
  function concat(list) { var n = 0; list.forEach(function (a) { n += a.length; }); var o = new Uint8Array(n), p = 0; list.forEach(function (a) { o.set(a, p); p += a.length; }); return o; }

  // ── PDF text encoding and Helvetica metrics ──────────────────────────────
  var WIN = { '€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, 'Š': 0x8A, 'š': 0x9A, 'Ž': 0x8E, 'ž': 0x9E,
    // added through /Differences (slots WinAnsi leaves empty)
    'Đ': 0x7F, 'č': 0x81, 'Č': 0x8D, 'ć': 0x8F, 'Ć': 0x90, 'đ': 0x9D };
  var DIFFERENCES = '[127 /Dcroat 129 /ccaron 141 /Ccaron 143 /cacute 144 /Cacute 157 /dcroat]';
  var WR = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015,
    667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333,
    556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
  var WB = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975,
    722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333,
    556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];
  var WIDE = { '€': 700, // 556 in the font; a little more, as some viewers draw the glyph wider and it runs into the next word
    '–': 556, '—': 1000, '…': 1000, '•': 350, '×': 584, '·': 278, '°': 400, '„': 333, '“': 333, '”': 333, '‘': 222, '’': 222, 'đ': 556, 'Đ': 722, '\u00a0': 278 };
  function norm(s) { return String(s == null ? '' : s).replace(/[\u2212]/g, '-').replace(/[\u202f\u2009\u2007]/g, ' ').replace(/[\r\n\t]+/g, ' '); }
  function base(ch) { return ch.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
  function charW(ch, bold) {
    var c = ch.charCodeAt(0), T = bold ? WB : WR;
    if (c >= 32 && c <= 126) return T[c - 32];
    if (WIDE[ch]) return bold && /[„“”]/.test(ch) ? 500 : WIDE[ch];
    var b = base(ch); if (b.length === 1 && b.charCodeAt(0) >= 32 && b.charCodeAt(0) <= 126) return T[b.charCodeAt(0) - 32];
    return 556;
  }
  function textW(s, size, bold) { s = norm(s); var w = 0; for (var i = 0; i < s.length; i++) w += charW(s[i], bold); return w * size / 1000; }
  /** the /Widths array for codes 32–255, so every viewer spaces the text exactly as it was measured */
  function widthsFor(bold) {
    var inv = {}; Object.keys(WIN).forEach(function (ch) { inv[WIN[ch]] = ch; });
    var out = [];
    for (var c = 32; c <= 255; c++) { var ch = inv[c] || (c <= 126 || c >= 0xA0 ? String.fromCharCode(c) : null); out.push(ch ? charW(ch, bold) : 0); }
    return out.join(' ');
  }
  /** a string → a PDF literal string in the encoding above */
  function pdfStr(s) {
    s = norm(s); var o = '(';
    for (var i = 0; i < s.length; i++) {
      var ch = s[i], c = ch.charCodeAt(0), code;
      if (c >= 32 && c <= 126) code = c; else if (WIN[ch] !== undefined) code = WIN[ch]; else if (c >= 0xA0 && c <= 0xFF) code = c; else { var b = base(ch); code = b.length === 1 && b.charCodeAt(0) < 127 ? b.charCodeAt(0) : 63; }
      if (code === 40 || code === 41 || code === 92) o += '\\' + String.fromCharCode(code);
      else if (code < 32) o += '\\' + ('00' + code.toString(8)).slice(-3);
      else if (code > 126) o += String.fromCharCode(code); // a raw byte: some viewers drop the space after an octal escape
      else o += String.fromCharCode(code);
    }
    return o + ')';
  }
  /** split text into lines no wider than `width` points */
  function wrap(text, size, width, bold) {
    var out = [];
    String(text == null ? '' : text).split(/\n/).forEach(function (para) {
      var words = norm(para).split(/ +/), line = '';
      words.forEach(function (w) {
        var cand = line ? line + ' ' + w : w;
        if (textW(cand, size, bold) <= width || !line) line = cand; else { out.push(line); line = w; }
        while (textW(line, size, bold) > width && line.length > 1) { // one word wider than the line: break it
          var k = line.length; while (k > 1 && textW(line.slice(0, k), size, bold) > width) k--;
          out.push(line.slice(0, k)); line = line.slice(k);
        }
      });
      out.push(line);
    });
    return out;
  }
  function f2(n) { return (Math.round(n * 100) / 100).toString(); }

  // ── a tiny PDF document ──────────────────────────────────────────────────
  var A4W = 595.28, A4H = 841.89;
  function PdfDoc(meta) { this.pages = []; this.meta = meta || {}; this.addPage(); }
  PdfDoc.prototype.addPage = function () { this.cur = []; this.pages.push(this.cur); };
  /** y is measured from the top of the page */
  PdfDoc.prototype.text = function (x, y, s, o) {
    o = o || {}; var size = o.size || 10, bold = !!o.bold, w = textW(s, size, bold);
    if (o.align === 'right') x -= w; else if (o.align === 'center') x -= w / 2;
    this.cur.push('BT ' + (o.gray != null ? o.gray + ' g ' : '0.1 g ') + '/' + (bold ? 'F2' : 'F1') + ' ' + size + ' Tf ' + f2(x) + ' ' + f2(A4H - y) + ' Td ' + pdfStr(s) + ' Tj ET');
    return w;
  };
  PdfDoc.prototype.line = function (x1, y1, x2, y2, o) { o = o || {}; this.cur.push((o.gray != null ? o.gray : 0.75) + ' G ' + (o.w || 0.6) + ' w ' + f2(x1) + ' ' + f2(A4H - y1) + ' m ' + f2(x2) + ' ' + f2(A4H - y2) + ' l S'); };
  PdfDoc.prototype.rect = function (x, y, w, h, o) { o = o || {}; this.cur.push((o.gray != null ? o.gray : 0.95) + ' g ' + f2(x) + ' ' + f2(A4H - y - h) + ' ' + f2(w) + ' ' + f2(h) + ' re f'); };
  /** a QR matrix ({ size, dark(row, col) }) as filled squares, top-left at x, y */
  PdfDoc.prototype.qr = function (x, y, side, qr) {
    var n = qr.size, cell = side / n, ops = ['0 g'];
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (qr.dark(r, c)) ops.push(f2(x + c * cell) + ' ' + f2(A4H - y - (r + 1) * cell) + ' ' + f2(cell + 0.02) + ' ' + f2(cell + 0.02) + ' re');
    ops.push('f'); this.cur.push(ops.join('\n'));
  };
  /** the finished file as bytes */
  PdfDoc.prototype.bytes = function () {
    var objs = [], np = this.pages.length;
    // 1 catalog, 2 pages, 3 encoding, 4 Helvetica, 5 Helvetica-Bold, 6 info, then page + content pairs
    var kidsRef = this.pages.map(function (p, i) { return (7 + i * 2) + ' 0 R'; }).join(' ');
    objs.push('<< /Type /Catalog /Pages 2 0 R >>');
    objs.push('<< /Type /Pages /Kids [' + kidsRef + '] /Count ' + np + ' >>');
    objs.push('<< /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences ' + DIFFERENCES + ' >>');
    objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding 3 0 R /FirstChar 32 /LastChar 255 /Widths [' + widthsFor(false) + '] >>');
    objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding 3 0 R /FirstChar 32 /LastChar 255 /Widths [' + widthsFor(true) + '] >>');
    var m = this.meta;
    objs.push('<< /Producer (Collections, Business Apps) /Title ' + pdfStr(m.title || '') + ' /Author ' + pdfStr(m.author || '') + (m.date ? ' /CreationDate (D:' + m.date.replace(/-/g, '') + '000000)' : '') + ' >>');
    this.pages.forEach(function (ops, i) {
      var content = ops.join('\n');
      objs.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + A4W + ' ' + A4H + '] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents ' + (8 + i * 2) + ' 0 R >>');
      objs.push('<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream');
    });
    var out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', offs = [];
    objs.forEach(function (o, i) { offs.push(out.length); out += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
    var xref = out.length;
    out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + offs.map(function (o) { return ('000000000' + o).slice(-10) + ' 00000 n \n'; }).join('');
    out += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R /Info 6 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
    return bin(out);
  };

  // ── the reminder letter as a PDF ─────────────────────────────────────────
  /** m: engine.letterModel(); c: the customer; co: the company (letterhead); sd: the sender; qr: { size, dark } or null */
  function pdfLetter(m, c, co, sd, qr) {
    var t = m.labels, L = m.lang, doc = new PdfDoc({ title: m.title + ' ' + (m.letterNo || ''), author: co.name, date: m.today });
    var X = 56, R = A4W - 56, W = R - X, y = 48, BOTTOM = A4H - 62;
    var money = function (n) { return E.fmtMoney(n, L); }, day = function (s) { return E.fmtDateTable(s, L); };
    function need(h) { if (y + h > BOTTOM) { footer(); doc.addPage(); y = 56; } }
    function para(s, o) { o = o || {}; var size = o.size || 10, lh = size * 1.42; wrap(s, size, o.width || W, o.bold).forEach(function (ln) { need(lh); doc.text(o.x || X, y + size, ln, { size: size, bold: o.bold, gray: o.gray }); y += lh; }); y += o.after == null ? 6 : o.after; }
    function footer() {
      doc.line(X, A4H - 50, R, A4H - 50, { gray: 0.82, w: 0.5 });
      var f = [co.name, co.street + ', ' + ((co.postal || '') + ' ' + (co.city || '')).trim(), t.vat + ' ' + co.vatId, 'IBAN ' + E.formatIban(co.iban), co.phone, co.email].filter(Boolean).join(' · ');
      wrap(f, 7.5, W).slice(0, 2).forEach(function (ln, i) { doc.text(X, A4H - 38 + i * 10, ln, { size: 7.5, gray: 0.45 }); });
    }
    // letterhead
    doc.text(X, y + 14, co.name, { size: 14, bold: true });
    var hs = [co.street + ', ' + ((co.postal || '') + ' ' + (co.city || '')).trim(), t.vat + ' ' + co.vatId + ' · IBAN ' + E.formatIban(co.iban), [co.phone, co.email].filter(Boolean).join(' · ')];
    hs.forEach(function (s, i) { doc.text(X, y + 30 + i * 11, s, { size: 8.5, gray: 0.4 }); });
    doc.line(X, y + 72, R, y + 72, { gray: 0.8 });
    y += 90;
    // address and meta
    var a = c.address || {}, country = c.country && c.country !== 'SI' ? (E.COUNTRY_NAMES[L][c.country] || c.country) : '';
    var addr = [c.name, a.street || '', ((a.postal || '') + ' ' + (a.city || '')).trim(), country].filter(Boolean);
    addr.forEach(function (s, i) { doc.text(X, y + i * 13, s, { size: 10.5, bold: i === 0 }); });
    var meta = [[t.placeDate, m.place + ', ' + E.fmtDate(m.today, L)], [t.letterNo, m.letterNo], [t.custNo, c.no], [t.vat, c.vatId]].filter(function (x) { return x[1]; });
    meta.forEach(function (x, i) { doc.text(R - 120, y + i * 13, x[0], { size: 8, gray: 0.45, align: 'right' }); doc.text(R, y + i * 13, String(x[1]), { size: 9, align: 'right' }); });
    y += Math.max(addr.length, meta.length) * 13 + 24;
    // title and text
    para(m.title, { size: 15, bold: true, after: 8 });
    para(m.salutation);
    para(m.intro);
    // invoice table
    var cols = m.withInterest ? [[X, t.th.no, 'l'], [X + 118, t.th.issued, 'l'], [X + 198, t.th.due, 'l'], [R - 170, t.th.open, 'r'], [R - 100, t.th.late, 'r'], [R, t.th.interest, 'r']]
      : [[X, t.th.no, 'l'], [X + 140, t.th.issued, 'l'], [X + 240, t.th.due, 'l'], [R - 80, t.th.open, 'r'], [R, t.th.late, 'r']];
    need(40); y += 4;
    cols.forEach(function (cl) { doc.text(cl[0], y + 8, cl[1], { size: 8, bold: true, gray: 0.35, align: cl[2] === 'r' ? 'right' : 'left' }); });
    y += 14; doc.line(X, y, R, y, { gray: 0.7 }); y += 4;
    m.rows.forEach(function (r) {
      need(r.paid > 0 ? 30 : 18);
      var vals = m.withInterest ? [r.no, day(r.issueDate), day(r.dueDate), money(r.open), String(r.days), money(r.interest)] : [r.no, day(r.issueDate), day(r.dueDate), money(r.open), String(r.days)];
      vals.forEach(function (v, k) { doc.text(cols[k][0], y + 10, v, { size: 9, align: cols[k][2] === 'r' ? 'right' : 'left' }); });
      y += 15;
      if (r.paid > 0) { var ow = E.ofWhich(r, L); doc.text(X + 12, y + 7, t.th.paid + ' ' + money(r.paid) + (ow ? ', ' + ow : ''), { size: 7.5, gray: 0.45 }); y += 12; }
      doc.line(X, y, R, y, { gray: 0.9, w: 0.4 }); y += 2;
    });
    // totals
    y += 6;
    var tots = [[t.tot.principal, m.principal]];
    if (m.withInterest) tots.push([E.fill(t.tot.interest, { date: E.fmtDate(m.today, L) }), m.interest]);
    if (m.withFee) tots.push([t.tot.fee + (m.fee === m.feeFull ? ' (' + m.rows.length + ' × ' + money(m.feeEach) + ')' : ''), m.fee]);
    need(tots.length * 15 + 24);
    tots.forEach(function (x) { doc.text(R - 110, y + 10, x[0], { size: 9, gray: 0.3, align: 'right' }); doc.text(R, y + 10, money(x[1]), { size: 9, align: 'right' }); y += 15; });
    doc.line(R - 260, y + 2, R, y + 2, { gray: 0.4, w: 0.8 });
    doc.text(R - 110, y + 15, t.tot.total, { size: 10.5, bold: true, align: 'right' }); doc.text(R, y + 15, money(m.total), { size: 10.5, bold: true, align: 'right' });
    y += 30;
    para(m.payText);
    // payment box with the QR
    var boxH = qr ? 128 : 100; need(boxH + 10);
    doc.rect(X, y, W, boxH, { gray: 0.955 });
    doc.text(X + 14, y + 20, t.payTitle, { size: 9.5, bold: true });
    var pd = [[t.payee, co.name], [t.iban, E.formatIban(co.iban)], [t.ref, m.reference], [t.purpose, m.purpose], [t.payBy, E.fmtDate(m.deadline, L)], [t.amount, money(m.total)]];
    pd.forEach(function (x, i) { doc.text(X + 14, y + 38 + i * 13, x[0], { size: 8, gray: 0.45 }); doc.text(X + 100, y + 38 + i * 13, String(x[1] || ''), { size: 9, bold: i === 5 }); });
    if (qr) {
      doc.rect(R - 118, y + 8, 106, 106, { gray: 1 });
      doc.qr(R - 113, y + 13, 96, qr);
      doc.text(R - 65, y + boxH - 5, m.qr === 'upn' ? t.qrUpn : t.qrEpc, { size: 7, gray: 0.4, align: 'center' });
    }
    y += boxH + 14;
    [m.paymentsNote, m.interestNote, m.feeNote].filter(Boolean).forEach(function (s) { para(s, { size: 8.5, gray: 0.35, after: 3 }); });
    y += 4;
    para(m.closing + ' ' + m.contactLine);
    need(52);
    para(m.signoff, { after: 10 });
    E.signature(sd, co, L).forEach(function (s, i) { doc.text(X, y + 10, s, { size: i ? 8.5 : 10, bold: i === 0, gray: i ? 0.4 : null }); y += i ? 11 : 14; });
    footer();
    return doc.bytes();
  }

  // ── e-mail ───────────────────────────────────────────────────────────────
  /** "=?UTF-8?B?…?=" words for a header (each at most 75 characters), or the text itself when it is plain ASCII */
  function encWord(s) {
    s = String(s || '');
    if (/^[\x20-\x7e]*$/.test(s)) return s;
    var out = [], chunk = '';
    Array.from(s).forEach(function (ch) { if (utf8(chunk + ch).length > 42) { out.push(chunk); chunk = ''; } chunk += ch; });
    if (chunk) out.push(chunk);
    return out.map(function (c) { return '=?UTF-8?B?' + base64(utf8(c)) + '?='; }).join('\r\n ');
  }
  function addr(name, email) {
    if (!email) return '';
    if (!name) return email;
    return (/^[\x20-\x7e]*$/.test(name) ? '"' + name.replace(/["\\]/g, '') + '"' : encWord(name)) + ' <' + email + '>';
  }
  function wrap76(s) { return s.replace(/.{1,76}/g, '$&\r\n'); }
  function rfcDate(d) {
    var D = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], p = function (n) { return String(n).padStart(2, '0'); };
    return D[d.getUTCDay()] + ', ' + p(d.getUTCDate()) + ' ' + M[d.getUTCMonth()] + ' ' + d.getUTCFullYear() + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds()) + ' +0000';
  }
  function asciiName(n) { return base(String(n)).replace(/[đĐ]/g, function (c) { return c === 'đ' ? 'd' : 'D'; }).replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, ''); }
  /** o: { from: { name, email }, to: { name, email }, subject, text, attachments: [{ name, type, bytes }], date (Date), unsent } → .eml text */
  function buildEml(o) {
    var bnd = '=_coll_' + Math.abs(hash(o.subject + (o.to && o.to.email) + (o.date ? o.date.getTime() : ''))).toString(36) + '_' + (o.attachments || []).length;
    var H = [];
    if (o.from && o.from.email) H.push('From: ' + addr(o.from.name, o.from.email));
    H.push('To: ' + (o.to && o.to.email ? addr(o.to.name, o.to.email) : ''));
    if (o.cc) H.push('Cc: ' + o.cc);
    H.push('Subject: ' + encWord(o.subject));
    H.push('Date: ' + rfcDate(o.date || new Date()));
    H.push('MIME-Version: 1.0');
    if (o.unsent !== false) H.push('X-Unsent: 1');
    H.push('Content-Type: multipart/mixed; boundary="' + bnd + '"');
    var body = ['', 'This is a multi-part message in MIME format.', '', '--' + bnd,
      'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap76(base64(utf8(String(o.text || '').replace(/\r?\n/g, '\r\n')))).replace(/\r\n$/, '')];
    (o.attachments || []).forEach(function (a) {
      var nm = a.name, ascii = asciiName(nm), star = /^[\x20-\x7e]*$/.test(nm) ? '' : '; filename*=UTF-8\'\'' + encodeURIComponent(nm);
      body.push('--' + bnd, 'Content-Type: ' + (a.type || 'application/octet-stream') + '; name="' + ascii + '"', 'Content-Transfer-Encoding: base64',
        'Content-Disposition: attachment; filename="' + ascii + '"' + star, '', wrap76(base64(a.bytes)).replace(/\r\n$/, ''));
    });
    body.push('--' + bnd + '--', '');
    return H.join('\r\n') + '\r\n' + body.join('\r\n');
  }
  function hash(s) { var h = 2166136261; s = String(s); for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h | 0; }

  var COVER = {
    sl: { attached: 'V prilogi vam pošiljamo dopis »{title}« (št. {no}) s seznamom računov in podatki za plačilo.', file: 'dopis' },
    hr: { attached: 'U privitku vam šaljemo dopis „{title}” (br. {no}) s popisom računa i podacima za plaćanje.', file: 'dopis' },
    en: { attached: 'Please find attached our letter "{title}" (ref. {no}) with the list of invoices and the payment details.', file: 'letter' }
  };
  /** subject and body of the e-mail that carries the PDF, in the letter's language */
  function letterMail(m, company, sender) {
    var t = m.labels, L = m.lang, cv = COVER[L] || COVER.sl, B = [];
    var subject = m.title + ' – ' + (company.name || '') + ' – ' + E.fmtMoney(m.total, L);
    B.push(m.salutation, '', m.intro, '', E.fill(cv.attached, { title: m.title, no: m.letterNo || '' }), '', t.listTitle);
    m.rows.forEach(function (r) { B.push('- ' + E.fill(t.line, { no: r.no, due: E.fmtDate(r.dueDate, L), open: E.fmtMoney(r.open, L), days: r.days })); });
    B.push('', t.tot.total + ': ' + E.fmtMoney(m.total, L), E.fill(t.payLine, { iban: E.formatIban(m.iban), reference: m.reference, deadline: E.fmtDate(m.deadline, L) }), '', m.closing, m.contactLine, '', m.signoff);
    E.signature(sender, company, L).forEach(function (x) { B.push(x); });
    return { subject: subject, body: B.join('\n') };
  }
  function slug(s) { return base(String(s || '')).replace(/đ/g, 'd').replace(/Đ/g, 'D').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60); }
  /** file names for one letter: "Drugi-opomin-2026-0012-Lumen-Gradnje.pdf" and the matching .eml */
  function letterFileNames(m, c) {
    var b = [slug(m.title), slug(m.letterNo), slug(c.name).slice(0, 30)].filter(Boolean).join('-');
    return { pdf: b + '.pdf', eml: b + '.eml' };
  }
  /** Everything for one letter: { pdf (bytes), eml (text), names, subject, body, to } */
  function letterPackage(m, c, co, sd, qr, now) {
    var pdf = pdfLetter(m, c, co, sd, qr), names = letterFileNames(m, c), mail = letterMail(m, co, sd), to = (c.contact && c.contact.email) || '';
    var eml = buildEml({ from: { name: (sd && sd.name) ? sd.name + ', ' + co.name : co.name, email: (sd && sd.email) || co.email }, to: { name: (c.contact && c.contact.name) || c.name, email: to },
      subject: mail.subject, text: mail.body, attachments: [{ name: names.pdf, type: 'application/pdf', bytes: pdf }], date: now || new Date() });
    return { pdf: pdf, eml: eml, names: names, subject: mail.subject, body: mail.body, to: to };
  }

  // ── ZIP (stored) ─────────────────────────────────────────────────────────
  var CRC = null;
  function crc32(u) {
    if (!CRC) { CRC = new Uint32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; } }
    var x = 0xFFFFFFFF; for (var i = 0; i < u.length; i++) x = CRC[(x ^ u[i]) & 255] ^ (x >>> 8);
    return (x ^ 0xFFFFFFFF) >>> 0;
  }
  /** files: [{ name, data (Uint8Array or string) }] → the ZIP file's bytes (UTF-8 names, no compression) */
  function zipStore(files, when) {
    var d = when || new Date(), dosT = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), dosD = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    var parts = [], central = [], off = 0, used = {};
    function le(n, b) { var a = new Uint8Array(b); for (var i = 0; i < b; i++) a[i] = (n >>> (8 * i)) & 255; return a; }
    files.forEach(function (f) {
      var nm = f.name, k = 2; while (used[nm.toLowerCase()]) nm = f.name.replace(/(\.[^.]+)?$/, '-' + (k++) + '$1'); used[nm.toLowerCase()] = 1;
      var name = utf8(nm), data = typeof f.data === 'string' ? utf8(f.data) : f.data, crc = crc32(data);
      var head = concat([le(0x04034b50, 4), le(20, 2), le(0x0800, 2), le(0, 2), le(dosT, 2), le(dosD, 2), le(crc, 4), le(data.length, 4), le(data.length, 4), le(name.length, 2), le(0, 2), name]);
      central.push(concat([le(0x02014b50, 4), le(20, 2), le(20, 2), le(0x0800, 2), le(0, 2), le(dosT, 2), le(dosD, 2), le(crc, 4), le(data.length, 4), le(data.length, 4), le(name.length, 2), le(0, 2), le(0, 2), le(0, 2), le(0, 2), le(0, 4), le(off, 4), name]));
      parts.push(head, data); off += head.length + data.length;
    });
    var cd = concat(central);
    return concat(parts.concat([cd, concat([le(0x06054b50, 4), le(0, 2), le(0, 2), le(files.length, 2), le(files.length, 2), le(cd.length, 4), le(off, 4), le(0, 2)])]));
  }

  // ── the customer's statement page ────────────────────────────────────────
  var ST = {
    sl: { title: 'Izpisek odprtih postavk', hello: 'Spoštovani,', intro: 'na dan {date} so pri nas odprti naslednji računi. Prosimo, preverite jih in nam sporočite, kdaj jih boste poravnali.',
      no: 'Račun', issued: 'Izdan', due: 'Zapadlost', open: 'Odprto', late: 'Zamuda', days: '{n} dni', notDue: 'ni zapadel', total: 'Skupaj odprto', overdue: 'od tega zapadlo',
      pay: 'Plačilo', payAll: 'Za plačilo vseh odprtih računov', scan: 'Skenirajte z mobilno banko', promise: 'Plačali bomo', promiseBtn: 'Sporoči datum plačila', date: 'Datum', amount: 'Znesek (€)',
      dispute: 'Nekaj ni v redu?', disputeHint: 'Če se z računom ne strinjate (reklamacija, napačna cena, manjka dobava), nam to sporočite in računa do rešitve ne bomo terjali.',
      which: 'Račun', why: 'Razlog', disputeBtn: 'Pošlji reklamacijo', mailNote: 'Gumba odpreta vaš poštni program s pripravljenim sporočilom za {email}.',
      promiseMail: 'Plačilo odprtih računov – {cust}', promiseBody: 'Spoštovani,\n\nznesek {amount} bomo plačali dne {date}.\n\nLep pozdrav,\n{cust}',
      disputeMail: 'Reklamacija računa {no} – {cust}', disputeBody: 'Spoštovani,\n\nračuna {no} ({open}) ne moremo poravnati, ker: {why}\n\nLep pozdrav,\n{cust}',
      print: 'Natisni', made: 'Pripravljeno {date}', contact: 'Vprašanja: {phone} · {email}', none: 'Na ta dan pri nas nimate odprtih računov. Hvala!', ref: 'Sklic', iban: 'IBAN', payee: 'Prejemnik', purpose: 'Namen' },
    hr: { title: 'Izvod otvorenih stavki', hello: 'Poštovani,', intro: 'na dan {date} kod nas su otvoreni sljedeći računi. Molimo vas da ih provjerite i javite nam kada ćete ih platiti.',
      no: 'Račun', issued: 'Izdan', due: 'Dospijeće', open: 'Otvoreno', late: 'Kašnjenje', days: '{n} dana', notDue: 'nije dospio', total: 'Ukupno otvoreno', overdue: 'od toga dospjelo',
      pay: 'Plaćanje', payAll: 'Za plaćanje svih otvorenih računa', scan: 'Skenirajte i platite', promise: 'Platit ćemo', promiseBtn: 'Javi datum plaćanja', date: 'Datum', amount: 'Iznos (€)',
      dispute: 'Nešto nije u redu?', disputeHint: 'Ako se s računom ne slažete (reklamacija, pogrešna cijena, nedostaje isporuka), javite nam i račun do rješenja nećemo potraživati.',
      which: 'Račun', why: 'Razlog', disputeBtn: 'Pošalji reklamaciju', mailNote: 'Gumbi otvaraju vaš program za e-poštu s pripremljenom porukom za {email}.',
      promiseMail: 'Plaćanje otvorenih računa – {cust}', promiseBody: 'Poštovani,\n\niznos od {amount} platit ćemo {date}.\n\nS poštovanjem,\n{cust}',
      disputeMail: 'Reklamacija računa {no} – {cust}', disputeBody: 'Poštovani,\n\nračun {no} ({open}) ne možemo platiti jer: {why}\n\nS poštovanjem,\n{cust}',
      print: 'Ispiši', made: 'Pripremljeno {date}', contact: 'Pitanja: {phone} · {email}', none: 'Na ovaj dan kod nas nemate otvorenih računa. Hvala!', ref: 'Poziv na broj', iban: 'IBAN', payee: 'Primatelj', purpose: 'Opis plaćanja' },
    en: { title: 'Statement of open items', hello: 'Dear Sir or Madam,', intro: 'on {date} the following invoices are open with us. Please check them and let us know when you will pay.',
      no: 'Invoice', issued: 'Issued', due: 'Due', open: 'Open', late: 'Late', days: '{n} days', notDue: 'not due', total: 'Total open', overdue: 'of which overdue',
      pay: 'Payment', payAll: 'To pay all open invoices', scan: 'Scan to pay', promise: 'We will pay', promiseBtn: 'Send the payment date', date: 'Date', amount: 'Amount (€)',
      dispute: 'Something wrong?', disputeHint: 'If you disagree with an invoice (a complaint, a wrong price, a missing delivery), tell us and we will not chase it until it is sorted out.',
      which: 'Invoice', why: 'Reason', disputeBtn: 'Send the complaint', mailNote: 'The buttons open your mail app with a message to {email}, ready to send.',
      promiseMail: 'Payment of open invoices – {cust}', promiseBody: 'Dear Sir or Madam,\n\nwe will pay {amount} on {date}.\n\nKind regards,\n{cust}',
      disputeMail: 'Complaint about invoice {no} – {cust}', disputeBody: 'Dear Sir or Madam,\n\nwe cannot pay invoice {no} ({open}) because: {why}\n\nKind regards,\n{cust}',
      print: 'Print', made: 'Prepared {date}', contact: 'Questions: {phone} · {email}', none: 'You have no open invoices with us on this day. Thank you!', ref: 'Reference', iban: 'IBAN', payee: 'Payee', purpose: 'Purpose' }
  };
  function h(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function qrSvgFrom(qr) {
    if (!qr) return '';
    var n = qr.size, d = '';
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (qr.dark(r, c)) d += 'M' + c + ' ' + r + 'h1v1h-1z';
    return '<svg viewBox="-2 -2 ' + (n + 4) + ' ' + (n + 4) + '" role="img" aria-label="QR" shape-rendering="crispEdges"><rect x="-2" y="-2" width="' + (n + 4) + '" height="' + (n + 4) + '" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
  }
  /** o: { customer, company, sender, invoices (the customer's), today, lang, reference, qr ({ size, dark } or null), qrKind } → a full HTML document */
  function statementHtml(o) {
    var L = ST[o.lang] ? o.lang : 'sl', t = ST[L], c = o.customer, co = o.company, sd = o.sender || {}, today = o.today;
    var rows = (o.invoices || []).filter(function (i) { return E.openAt(i, today) > 0; }).sort(function (a, b) { return a.dueDate < b.dueDate ? -1 : 1; });
    var total = E.round2(E.sum(rows, function (i) { return E.openAt(i, today); })), overdue = E.round2(E.sum(rows.filter(function (i) { return i.dueDate < today; }), function (i) { return E.openAt(i, today); }));
    var mail = sd.email || co.email || '', money = function (n) { return E.fmtMoney(n, L); };
    var body = '<header><div><b>' + h(co.name) + '</b><small>' + h([co.street, ((co.postal || '') + ' ' + (co.city || '')).trim()].filter(Boolean).join(', ')) + '</small></div><button type="button" onclick="print()">' + h(t.print) + '</button></header>' +
      '<main><p class="eyebrow">' + h(c.name) + (c.no ? ' · ' + h(c.no) : '') + '</p><h1>' + h(t.title) + '</h1><p>' + h(t.hello) + ' ' + h(E.fill(t.intro, { date: E.fmtDate(today, L) })) + '</p>';
    if (!rows.length) body += '<p class="none">' + h(t.none) + '</p>';
    else {
      body += '<div class="tw"><table><thead><tr><th>' + h(t.no) + '</th><th>' + h(t.issued) + '</th><th>' + h(t.due) + '</th><th class="n">' + h(t.late) + '</th><th class="n">' + h(t.open) + '</th></tr></thead><tbody>' +
        rows.map(function (i) { var d = E.diffDays(i.dueDate, today); return '<tr class="' + (d > 0 ? 'od' : '') + '"><td>' + h(i.no) + (i.disputed ? ' *' : '') + '</td><td>' + h(E.fmtDateTable(i.issueDate, L)) + '</td><td>' + h(E.fmtDateTable(i.dueDate, L)) + '</td><td class="n">' + (d > 0 ? h(E.fill(t.days, { n: d })) : h(t.notDue)) + '</td><td class="n">' + h(money(E.openAt(i, today))) + '</td></tr>'; }).join('') +
        '</tbody><tfoot><tr><td colspan="3">' + h(t.total) + (overdue ? ' <small>(' + h(t.overdue) + ' ' + h(money(overdue)) + ')</small>' : '') + '</td><td></td><td class="n">' + h(money(total)) + '</td></tr></tfoot></table></div>';
      body += '<section class="pay"><div><h2>' + h(t.pay) + '</h2><p>' + h(t.payAll) + '</p><dl><dt>' + h(t.payee) + '</dt><dd>' + h(co.name) + '</dd><dt>' + h(t.iban) + '</dt><dd>' + h(E.formatIban(co.iban)) + '</dd><dt>' + h(t.ref) + '</dt><dd>' + h(o.reference || '') + '</dd><dt>' + h(t.amount.replace(/ \(€\)/, '')) + '</dt><dd><b>' + h(money(total)) + '</b></dd></dl></div>' +
        (o.qr ? '<figure>' + qrSvgFrom(o.qr) + '<figcaption>' + h(t.scan) + '</figcaption></figure>' : '') + '</section>';
      var defDate = E.workdayOnOrAfter(E.addDays(today, 3));
      body += '<section class="ask no-print"><h2>' + h(t.promise) + '</h2><form id="fP"><label>' + h(t.date) + '<input type="date" id="pD" value="' + defDate + '" min="' + today + '" required></label><label>' + h(t.amount) + '<input id="pA" inputmode="decimal" value="' + h(E.fmtNum(overdue || total, 2, 'sl')) + '"></label><button>' + h(t.promiseBtn) + '</button></form></section>' +
        '<section class="ask no-print"><h2>' + h(t.dispute) + '</h2><p>' + h(t.disputeHint) + '</p><form id="fD"><label>' + h(t.which) + '<select id="dI">' + rows.map(function (i) { return '<option value="' + h(i.no) + '" data-open="' + h(money(E.openAt(i, today))) + '">' + h(i.no + ' · ' + money(E.openAt(i, today))) + '</option>'; }).join('') + '</select></label><label class="w">' + h(t.why) + '<textarea id="dW" rows="3" required></textarea></label><button>' + h(t.disputeBtn) + '</button></form>' +
        '<p class="hint">' + h(E.fill(t.mailNote, { email: mail })) + '</p></section>';
    }
    body += '<footer>' + h(E.fill(t.contact, { phone: sd.phone || co.phone || '', email: mail })) + ' · ' + h(E.fill(t.made, { date: E.fmtDate(today, L) })) + '</footer></main>';
    var cfg = { to: mail, cust: c.name, L: L, pm: t.promiseMail, pb: t.promiseBody, dm: t.disputeMail, db: t.disputeBody, months: L === 'en' };
    var script = '(function(){var C=' + JSON.stringify(cfg).replace(/</g, '\\u003c') + ';function f(s,v){return s.replace(/\\{(\\w+)\\}/g,function(m,k){return v[k]==null?m:v[k]})}' +
      'function d(s){var p=s.split("-");return +p[2]+". "+ +p[1]+". "+p[0]+(C.L==="hr"?".":"")}' +
      'function go(s,b){location.href="mailto:"+encodeURIComponent(C.to)+"?subject="+encodeURIComponent(s)+"&body="+encodeURIComponent(b)}' +
      'var P=document.getElementById("fP");if(P)P.addEventListener("submit",function(e){e.preventDefault();var v=document.getElementById("pD").value;if(!v)return;go(f(C.pm,{cust:C.cust}),f(C.pb,{amount:document.getElementById("pA").value+" €",date:d(v),cust:C.cust}))});' +
      'var D=document.getElementById("fD");if(D)D.addEventListener("submit",function(e){e.preventDefault();var s=document.getElementById("dI"),w=document.getElementById("dW").value.trim();if(!w)return;var o=s.options[s.selectedIndex];go(f(C.dm,{no:s.value,cust:C.cust}),f(C.db,{no:s.value,open:o.getAttribute("data-open"),why:w,cust:C.cust}))})})();';
    var css = ':root{color-scheme:light dark;--bg:#f6f7f9;--card:#fff;--ink:#16181d;--ink2:#5b616e;--line:#e3e6eb;--acc:#3b5bdb;--od:#b42318}' +
      '@media (prefers-color-scheme:dark){:root{--bg:#121417;--card:#1b1e23;--ink:#eceef2;--ink2:#a2a8b4;--line:#2c3038;--acc:#7c95ff;--od:#ff8a80}}' +
      '*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}' +
      'header{display:flex;justify-content:space-between;align-items:center;gap:12px;max-width:820px;margin:0 auto;padding:18px 16px}header small{display:block;color:var(--ink2);font-size:13px}' +
      'main{max-width:820px;margin:0 auto 32px;padding:20px 16px;background:var(--card);border:1px solid var(--line);border-radius:14px}h1{font-size:24px;margin:2px 0 10px}h2{font-size:16px;margin:0 0 8px}' +
      '.eyebrow{margin:0;color:var(--ink2);font-size:13px;text-transform:uppercase;letter-spacing:.04em}.tw{overflow-x:auto}table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums;margin:14px 0}' +
      'th,td{padding:8px 6px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}th{font-size:12px;color:var(--ink2);font-weight:600}.n{text-align:right}tr.od td:nth-child(4){color:var(--od)}tfoot td{font-weight:700;border-bottom:0}tfoot small{font-weight:400;color:var(--ink2)}' +
      '.pay{display:flex;flex-wrap:wrap;gap:18px;justify-content:space-between;align-items:center;padding:16px;border:1px solid var(--line);border-radius:12px;margin:8px 0 18px}.pay p{margin:0 0 8px;color:var(--ink2)}' +
      'dl{display:grid;grid-template-columns:auto 1fr;gap:4px 14px;margin:0}dt{color:var(--ink2);font-size:13px}dd{margin:0;word-break:break-word}figure{margin:0;text-align:center}figure svg{width:150px;height:150px;display:block}figcaption{font-size:12px;color:var(--ink2);margin-top:4px}' +
      '.ask{padding:16px 0;border-top:1px solid var(--line)}.ask p{margin:0 0 10px;color:var(--ink2)}form{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end}label{display:flex;flex-direction:column;gap:4px;font-size:13px;color:var(--ink2);min-width:0}label.w{flex:1 1 260px}' +
      'input,select,textarea{font:inherit;color:var(--ink);background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:8px 10px;max-width:100%}textarea{width:100%}' +
      'button{font:inherit;font-weight:600;color:#fff;background:var(--acc);border:0;border-radius:8px;padding:9px 14px;cursor:pointer;min-height:40px}header button{background:transparent;color:var(--acc);border:1px solid var(--line)}' +
      '.hint{font-size:13px}.none{padding:20px 0;font-weight:600}footer{margin-top:18px;color:var(--ink2);font-size:13px}' +
      '@media (max-width:560px){main{border-radius:0;border-left:0;border-right:0}th:nth-child(2),td:nth-child(2){display:none}th,td{padding:8px 4px;font-size:14px}tfoot td{white-space:normal}tfoot small{display:block}}' +
      '@media print{body{background:#fff;color:#000}header button,.no-print{display:none}main{border:0;padding:0}}';
    return '<!doctype html>\n<html lang="' + L + '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">' +
      '<title>' + h(t.title + ' – ' + c.name) + '</title><style>' + css + '</style></head><body>' + body + '<script>' + script + '<\/script></body></html>\n';
  }

  return {
    utf8: utf8, base64: base64, textW: textW, wrap: wrap, pdfStr: pdfStr, PdfDoc: PdfDoc, pdfLetter: pdfLetter,
    encWord: encWord, buildEml: buildEml, letterMail: letterMail, letterFileNames: letterFileNames, letterPackage: letterPackage,
    crc32: crc32, zipStore: zipStore, statementHtml: statementHtml, STATEMENT_TEXTS: ST, slug: slug
  };
});
