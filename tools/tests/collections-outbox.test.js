// Tests for site/collections/outbox.js: the letter PDF, the .eml with the PDF attached, the ZIP for bulk sending and
// the customer's statement page. Run: node tools/tests/collections-outbox.test.js
'use strict';
const assert = require('assert');
const path = require('path');
const E = require(path.join(__dirname, '../../site/collections/engine.js'));
const D = require(path.join(__dirname, '../../site/collections/data.js'));
const O = require(path.join(__dirname, '../../site/collections/outbox.js'));

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok', n, name); }
const TODAY = '2026-10-15';
const latin1 = (u) => Array.from(u, (b) => String.fromCharCode(b)).join('');
const fakeQr = { size: 25, dark: (r, c) => (r + c) % 3 === 0 };

const db = D.generate(TODAY), ix = E.indexDb(db), st = E.analyzeAll(db, TODAY, ix);
function letter(lang, stage, pick) {
  const c = db.customers.find(pick || ((x) => st[x.id].overdueUndisputed > 0));
  return { c, m: E.letterModel({ company: db.company, sender: db.sender, customer: c, invoices: ix.invBy[c.id], actions: ix.actBy[c.id], stage, today: TODAY, lang, settings: db.settings, letterNo: '2026/0042' }) };
}

t('PDF text: WinAnsi plus č ć đ Č Ć Đ through /Differences; brackets and backslashes escaped', () => {
  assert.strictEqual(O.pdfStr('a(b)\\c'), '(a\\(b\\)\\\\c)');
  assert.strictEqual(O.pdfStr('čćđČĆĐšžŠŽ€'), '(' + String.fromCharCode(0x81, 0x8F, 0x9D, 0x8D, 0x90, 0x7F, 0x9A, 0x9E, 0x8A, 0x8E, 0x80) + ')');
  assert.strictEqual(O.pdfStr('ä é'), '(' + String.fromCharCode(0xE4, 0x20, 0xE9) + ')');
  assert.strictEqual(O.pdfStr('1−2 →'), '(1-2 ?)', 'the minus sign becomes a hyphen; characters outside the font become ?');
  assert.ok(Math.abs(O.textW('Helvetica', 10) - 41.12) < 0.01, 'Helvetica metrics');
  assert.strictEqual(O.textW('č', 10), O.textW('c', 10));
});

t('wrap: lines fit the width, long words are broken, line breaks are kept', () => {
  const lines = O.wrap('Kljub našemu opominu spodaj navedeni računi še vedno niso poravnani.\nDrugi odstavek.', 10, 150);
  assert.ok(lines.length >= 3);
  lines.forEach((l) => assert.ok(O.textW(l, 10) <= 150 + 0.01, l));
  assert.strictEqual(lines[lines.length - 1], 'Drugi odstavek.');
  assert.ok(O.wrap('x'.repeat(200), 10, 100).every((l) => O.textW(l, 10) <= 100.01));
});

t('letter PDF: a valid file (header, objects, xref offsets, trailer) with the letter text and the QR', () => {
  const { c, m } = letter('sl', 2);
  const bytes = O.pdfLetter(m, c, db.company, db.sender, fakeQr), s = latin1(bytes);
  assert.ok(s.startsWith('%PDF-1.4\n'));
  assert.ok(s.endsWith('%%EOF\n'));
  const xref = +/startxref\n(\d+)\n%%EOF\n$/.exec(s)[1];
  assert.strictEqual(s.slice(xref, xref + 4), 'xref');
  const count = +/xref\n0 (\d+)\n/.exec(s.slice(xref))[1];
  const offs = s.slice(xref).split('\n').slice(3, 2 + count).map((l) => +l.slice(0, 10));
  offs.forEach((o, i) => assert.strictEqual(s.slice(o, o + String(i + 1).length + 6), (i + 1) + ' 0 obj', 'object ' + (i + 1) + ' starts at its xref offset'));
  // every content stream's /Length is its real length
  const re = /<< \/Length (\d+) >>\nstream\n/g; let mm, streams = 0;
  while ((mm = re.exec(s))) { const start = mm.index + mm[0].length, len = +mm[1]; assert.strictEqual(s.slice(start + len, start + len + 10), '\nendstream'); streams++; }
  assert.ok(streams >= 1);
  assert.ok(s.indexOf('/BaseFont /Helvetica-Bold') > 0 && s.indexOf('/Differences [127 /Dcroat 129 /ccaron') > 0);
  assert.ok(s.indexOf(O.pdfStr(m.title)) > 0, 'the title is in the text');
  assert.ok(s.indexOf(O.pdfStr(E.fmtMoney(m.total, 'sl'))) > 0, 'the total is in the text');
  assert.ok(s.indexOf(O.pdfStr(m.reference)) > 0, 'the payment reference is in the text');
  assert.ok(/ re\n/.test(s), 'the QR squares are drawn');
});

t('letter PDF: long letters go on to a second page; the Croatian and English letters work too', () => {
  const { c, m } = letter('hr', 3);
  const many = Object.assign({}, m, { rows: Array.from({ length: 45 }, (x, i) => Object.assign({}, m.rows[0], { no: '2026-' + String(i).padStart(6, '0'), paid: i % 3 ? 0 : 10, paidInterest: 0, paidCosts: 0 })) });
  const s = latin1(O.pdfLetter(many, c, db.company, db.sender, null));
  assert.ok((s.match(/\/Type \/Page /g) || []).length >= 2);
  assert.ok(/\/Count [2-9]/.test(s));
  const en = letter('en', 1);
  assert.ok(latin1(O.pdfLetter(en.m, en.c, db.company, db.sender, null)).indexOf('(Payment details)') > 0);
});

t('e-mail: headers (encoded subject, X-Unsent), the text in UTF-8, the PDF attached in base64', () => {
  const { c, m } = letter('sl', 1, (x) => st[x.id].overdueUndisputed > 0 && x.contact.email);
  const pkg = O.letterPackage(m, c, db.company, db.sender, fakeQr, new Date(Date.UTC(2026, 9, 15, 8, 0, 0)));
  const eml = pkg.eml, [head, ...rest] = eml.split('\r\n\r\n');
  assert.ok(/^From: "Maja Kranjc, Nordvik Distribucija d\.o\.o\." <maja\.kranjc@example\.com>$/m.test(head));
  assert.ok(new RegExp('^To: .* <' + c.contact.email.replace(/\./g, '\\.') + '>$', 'm').test(head));
  assert.ok(/^Subject: =\?UTF-8\?B\?/m.test(head));
  assert.ok(/^Date: Thu, 15 Oct 2026 08:00:00 \+0000$/m.test(head));
  assert.ok(/^X-Unsent: 1$/m.test(head));
  const words = head.match(/=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=/g);
  words.forEach((w) => assert.ok(w.length <= 75, 'encoded words are at most 75 characters'));
  const subject = words.map((w) => Buffer.from(w.slice(10, -2), 'base64').toString('utf8')).join('');
  assert.strictEqual(subject, pkg.subject);
  assert.ok(subject.indexOf('Opomin') === 0 && subject.indexOf('€') > 0);
  // the parts
  const bnd = /boundary="([^"]+)"/.exec(head)[1], parts = rest.join('\r\n\r\n').split('--' + bnd);
  assert.strictEqual(parts.length, 4, 'preamble, text, attachment, end');
  const text = parts[1], pdf = parts[2];
  assert.ok(/Content-Type: text\/plain; charset=UTF-8/.test(text));
  const body = Buffer.from(text.split('\r\n\r\n')[1].replace(/\s+/g, ''), 'base64').toString('utf8');
  assert.ok(body.indexOf('Spoštovani,') === 0 && body.indexOf('V prilogi') > 0 && body.indexOf(m.reference) > 0);
  assert.ok(text.split('\r\n\r\n')[1].split('\r\n').every((l) => l.length <= 76), 'base64 lines of at most 76 characters');
  assert.ok(/Content-Type: application\/pdf; name="[^"]+\.pdf"/.test(pdf) && /Content-Disposition: attachment; filename="/.test(pdf));
  const att = Buffer.from(pdf.split('\r\n\r\n')[1].replace(/\s+/g, ''), 'base64');
  assert.ok(att.equals(Buffer.from(pkg.pdf)), 'the attachment is the PDF, byte for byte');
  assert.ok(parts[3].startsWith('--'), 'closing boundary');
  assert.ok(/^[A-Za-z0-9-]+\.pdf$/.test(pkg.names.pdf) && pkg.names.eml === pkg.names.pdf.replace(/pdf$/, 'eml'));
});

t('e-mail: non-ASCII attachment names get an RFC 2231 name; a customer without an address leaves To empty', () => {
  const eml = O.buildEml({ from: { name: 'Žan', email: 'a@example.com' }, to: { name: '', email: '' }, subject: 'Test', text: 'x', attachments: [{ name: 'Opomin-Čuk.pdf', type: 'application/pdf', bytes: new Uint8Array([1, 2, 3]) }], date: new Date(0) });
  assert.ok(/^To: $/m.test(eml));
  assert.ok(/^From: =\?UTF-8\?B\?xb1hbg==\?= <a@example\.com>$/m.test(eml));
  assert.ok(eml.indexOf("filename*=UTF-8''Opomin-%C4%8Cuk.pdf") > 0 && eml.indexOf('filename="Opomin-Cuk.pdf"') > 0);
  assert.strictEqual(O.encWord('Plain subject'), 'Plain subject');
});

t('ZIP: local headers, central directory, CRC-32, UTF-8 names, duplicate names made unique', () => {
  assert.strictEqual(O.crc32(O.utf8('123456789')), 0xCBF43926);
  const z = O.zipStore([{ name: 'a.txt', data: 'hello' }, { name: 'č.eml', data: new Uint8Array([0, 1, 2]) }, { name: 'a.txt', data: 'again' }], new Date(2026, 9, 15, 10, 30, 0));
  const dv = new DataView(z.buffer);
  assert.strictEqual(dv.getUint32(0, true), 0x04034b50);
  const end = z.length - 22;
  assert.strictEqual(dv.getUint32(end, true), 0x06054b50);
  assert.strictEqual(dv.getUint16(end + 10, true), 3, 'three entries');
  let p = dv.getUint32(end + 16, true); const names = [];
  for (let i = 0; i < 3; i++) {
    assert.strictEqual(dv.getUint32(p, true), 0x02014b50);
    assert.strictEqual(dv.getUint16(p + 8, true) & 0x0800, 0x0800, 'UTF-8 flag');
    const nl = dv.getUint16(p + 28, true), off = dv.getUint32(p + 42, true), crc = dv.getUint32(p + 16, true), size = dv.getUint32(p + 20, true);
    names.push(Buffer.from(z.slice(p + 46, p + 46 + nl)).toString('utf8'));
    const ln = dv.getUint16(off + 26, true), data = z.slice(off + 30 + ln, off + 30 + ln + size);
    assert.strictEqual(O.crc32(data), crc);
    p += 46 + nl;
  }
  assert.deepStrictEqual(names, ['a.txt', 'č.eml', 'a-2.txt']);
});

t('statement page: open invoices, totals, QR, the promise and dispute forms; escaped and self-contained', () => {
  const c = db.customers.find((x) => st[x.id].overdueCount > 0 && x.country === 'HR') || db.customers.find((x) => st[x.id].overdueCount > 0);
  const evil = Object.assign({}, c, { name: c.name + ' <script>x</script>' });
  const html = O.statementHtml({ customer: evil, company: db.company, sender: db.sender, invoices: ix.invBy[c.id], today: TODAY, lang: 'hr', reference: 'HR00 2026-000001', qr: fakeQr });
  assert.ok(html.startsWith('<!doctype html>') && /<html lang="hr">/.test(html));
  assert.ok(html.indexOf('<script>x</script>') < 0, 'the name is escaped');
  assert.strictEqual((html.match(/<script>/g) || []).length, 1, 'one inline script, nothing loaded from elsewhere');
  assert.ok(!/src="http|href="http/.test(html));
  assert.ok(html.indexOf(E.fmtMoney(st[c.id].open, 'hr')) > 0, 'the total open amount');
  assert.ok(html.indexOf('Izvod otvorenih stavki') > 0 && html.indexOf('id="fP"') > 0 && html.indexOf('id="fD"') > 0);
  assert.ok(/<svg viewBox="-2 -2 29 29"/.test(html));
  const none = O.statementHtml({ customer: c, company: db.company, sender: db.sender, invoices: [], today: TODAY, lang: 'sl', reference: '' });
  assert.ok(none.indexOf('nimate odprtih računov') > 0 && none.indexOf('id="fP"') < 0);
});

console.log(n + ' tests passed');
