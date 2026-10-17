// Tests for the eSLOG rule checks and the XML builder: errors and warnings, totals mismatch, bad IBAN, VAT-rate warning,
// well-formed XML (read back with a small strict parser), escaping and XML injection, deterministic output.
// Run: node --no-warnings tools/tests/eslog-validate.test.js
'use strict';
const assert = require('assert').strict;
const path = require('path');
const { pathToFileURL } = require('url');
const S = require('./eslog-samples.js');
const dir = path.join(__dirname, '../../site/convert');
let n = 0;
async function t(name, fn) { await fn(); n++; console.log('ok', n, name); }

/** A strict little XML reader: prolog, elements, text, the five entities only; throws on anything that is not well-formed. */
function parseXml(xml) {
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n'), 'declaration');
  assert.doesNotMatch(xml, /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/, 'no control characters');
  const decode = (s) => { assert.doesNotMatch(s.replace(/&(amp|lt|gt|quot|apos);/g, ''), /[&<>]/, 'stray & < > in text'); return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&'); };
  const root = { children: [], name: '#root' }, stack = [root];
  const re = /<\/([A-Za-z_][\w.-]*)>|<([A-Za-z_][\w.-]*)((?:\s+[\w:.-]+="[^"<&]*")*)\s*(\/?)>|([^<]+)/g;
  let m, pos = xml.indexOf('\n') + 1; re.lastIndex = pos;
  while ((m = re.exec(xml))) {
    assert.equal(m.index, pos, 'unparsed text at ' + pos); pos = re.lastIndex;
    const top = stack[stack.length - 1];
    if (m[1]) { assert.equal(top.name, m[1], 'closing tag'); stack.pop(); }
    else if (m[2]) { const el = { name: m[2], attrs: m[3], children: [], text: '' }; top.children.push(el); if (!m[4]) stack.push(el); }
    else if (m[5].trim()) top.text += decode(m[5]);
  }
  assert.equal(pos, xml.length); assert.equal(stack.length, 1, 'all tags closed'); assert.equal(root.children.length, 1);
  return root.children[0];
}
const find = (el, name, out = []) => { if (el.name === name) out.push(el); el.children.forEach((c) => find(c, name, out)); return out; };

(async () => {
const X = await import(pathToFileURL(path.join(dir, 'eslog/extract.mjs')).href);
const V = await import(pathToFileURL(path.join(dir, 'eslog/validate.mjs')).href);
const E = await import(pathToFileURL(path.join(dir, 'eslog/eslog.mjs')).href);
const M = await import(pathToFileURL(path.join(dir, 'eslog/model.mjs')).href);
const invoice = (opts, edit) => { const grid = S.slovenianRows(opts), inv = X.buildInvoice(grid, X.mappingOf(X.extract(grid))); if (edit) edit(inv); return inv; };
const codes = (issues, level) => issues.filter((i) => !level || i.level === level).map((i) => i.code);

await t('a good invoice has no errors and no warnings; the passed list says what was checked', () => {
  const inv = invoice(), issues = V.validate(inv);
  assert.deepEqual(issues, []); assert.ok(V.canDownload(issues));
  const ok = V.passedChecks(inv, issues).map((p) => p.code);
  assert.deepEqual(ok, ['OK_HEADER', 'OK_SELLER_VAT', 'OK_BUYER_VAT', 'OK_IBAN', 'OK_LINES', 'OK_TOTALS']);
});
await t('missing buyer VAT ID is an error with a fix button for the Buyer box; it blocks the download', () => {
  const issues = V.validate(invoice({ buyerVat: false })), i = issues.find((x) => x.code === 'BUYER_VAT_MISSING');
  assert.equal(i.level, 'error'); assert.equal(i.field, 'buyer.vatId'); assert.equal(i.fix, 'Fix in Buyer box'); assert.match(i.message, /Buyer VAT ID is missing/);
  assert.ok(!V.canDownload(issues)); assert.deepEqual(V.summary(issues), { errors: 1, warnings: 0 });
});
await t('bad IBAN, bad VAT check digit, wrong date order, bad currency, no number: errors with a field each', () => {
  const issues = V.validate(invoice({}, (inv) => { inv.seller.iban = 'SI56000000000000000'; inv.seller.vatId = 'SI12345678'; inv.dueDate = '2026-09-01'; inv.currency = 'EU'; inv.number = ''; }));
  assert.deepEqual(codes(issues, 'error').sort(), ['CURRENCY_INVALID', 'DUE_BEFORE_ISSUE', 'NUMBER_MISSING', 'SELLER_IBAN_INVALID', 'SELLER_VAT_INVALID']);
  assert.equal(issues.find((i) => i.code === 'SELLER_IBAN_INVALID').field, 'seller.iban');
  for (const i of issues) { assert.ok(i.message.length > 10 && i.fix && i.level); assert.doesNotMatch(i.message, /undefined|null|NaN/); }
});
await t('VAT rate outside 22 / 9,5 / 5 / 0 is a warning that does not block; 0 % warns about the reason; a missing rate is an error', () => {
  let issues = V.validate(invoice({}, (inv) => { inv.lines[2].vatRate = 13; }));
  assert.ok(codes(issues).includes('VAT_RATE_UNUSUAL'));
  assert.equal(issues.find((i) => i.code === 'VAT_RATE_UNUSUAL').level, 'warning'); assert.equal(issues.find((i) => i.code === 'VAT_RATE_UNUSUAL').field, 'line.3.vatRate');
  issues = V.validate(invoice({}, (inv) => { inv.lines[2].vatRate = 9.5; inv.stated.gross = null; inv.stated.net = null; inv.lines[0].vatRate = 0; inv.stated.gross = null; }));
  assert.ok(codes(issues, 'warning').includes('VAT_RATE_ZERO')); assert.ok(V.canDownload(issues));
  issues = V.validate(invoice({}, (inv) => { inv.lines[1].vatRate = null; inv.lines[1].rawVat = 'abc'; }));
  assert.ok(codes(issues, 'error').includes('LINE_VAT_MISSING'));
});
await t('totals: the lines against the total in the file; line maths; the message says both numbers', () => {
  let issues = V.validate(invoice({}, (inv) => { inv.stated.gross = 1700; }));
  const tm = issues.find((i) => i.code === 'TOTAL_MISMATCH'); assert.equal(tm.level, 'error'); assert.equal(tm.field, 'totals'); assert.match(tm.message, /1\.690,50/); assert.match(tm.message, /1\.700,00/);
  issues = V.validate(invoice({}, (inv) => { inv.lines[0].net = 1021; }));
  const lm = issues.find((i) => i.code === 'LINE_MATH'); assert.ok(lm); assert.match(lm.message, /Line 1: 12 x 85,00 is 1\.020,00, but the amount is 1\.021,00/);
  assert.ok(!V.canDownload(issues));
  assert.deepEqual(codes(V.validate(invoice({}, (inv) => { inv.lines = []; })), 'error'), ['NO_LINES']);
});
await t('other checks: no due date is a warning, missing IBAN and address are warnings, unknown unit, long description, non-EUR', () => {
  const issues = V.validate(invoice({}, (inv) => { inv.dueDate = ''; inv._raw.dueDate = ''; inv.seller.iban = ''; inv.buyer.street = ''; inv.lines[0].unit = 'banana'; inv.lines[1].description = 'x'.repeat(300); inv.currency = 'USD'; inv.stated = { net: null, gross: null }; }));
  assert.deepEqual(codes(issues, 'error'), []);
  assert.deepEqual(codes(issues, 'warning').sort(), ['BUYER_ADDRESS_INCOMPLETE', 'CURRENCY_NOT_EUR', 'DUE_DATE_MISSING', 'LINE_DESCRIPTION_LONG', 'SELLER_IBAN_MISSING', 'UNIT_UNKNOWN']);
});

await t('XML: well-formed, declaration, the invoice data in the right elements', () => {
  const inv = invoice(), xml = E.buildEslog(inv), root = parseXml(xml);
  assert.equal(root.name, 'Invoice'); assert.equal(root.children[0].name, 'M_INVOIC');
  const val = (el, name) => find(el, name)[0]?.text;
  assert.equal(val(root, 'D_1004'), '2026-0142'); assert.equal(find(root, 'D_1001')[0].text, '380');
  const nads = find(root, 'S_NAD'); assert.deepEqual(nads.map((x) => find(x, 'D_3035')[0].text), ['SE', 'BY']);
  assert.equal(find(nads[0], 'D_3036')[0].text, 'Zelenik d.o.o.');
  assert.deepEqual(find(root, 'D_1154').map((x) => x.text), ['SI12345679', 'SI10000003']);
  assert.equal(find(root, 'D_3194')[0].text, 'SI50123456789012345');
  assert.equal(find(root, 'G_SG26').length, 3); assert.equal(find(root, 'G_SG52').length, 2);
  const moa = (q) => find(root, 'G_SG50').map((g) => [find(g, 'D_5025')[0].text, find(g, 'D_5004')[0].text]).find((x) => x[0] === q)[1];
  assert.equal(moa('79'), '1400.00'); assert.equal(moa('176'), '290.50'); assert.equal(moa('9'), '1690.50');
  assert.deepEqual(find(find(root, 'G_SG26')[2], 'D_6060').map((x) => x.text), ['40']); assert.deepEqual(find(find(root, 'G_SG26')[2], 'D_5278').map((x) => x.text), ['9.50']);
  assert.ok(find(root, 'D_2380').some((x) => x.text === '2026-10-02') && find(root, 'D_2380').some((x) => x.text === '2026-11-01'));
  assert.match(xml, /Slovenian|Ljubljana/); assert.equal(E.eslogFileName(inv), 'eslog-2026-0142.xml');
});
await t('XML is deterministic: the same invoice twice is the same bytes, and has no time stamp or random id', () => {
  const a = E.buildEslog(invoice()), b = E.buildEslog(invoice());
  assert.equal(a, b); assert.doesNotMatch(a, /\d{4}-\d{2}-\d{2}T|\bgenerat/i);
});
await t('XML escaping: & < > quotes in names and descriptions are escaped; markup in a cell never becomes markup', () => {
  const evil = '</D_3036><S_EVIL x="1"/>&amp; "q" \'a\' <![CDATA[x]]>';
  const inv = invoice({}, (i) => { i.seller.name = evil; i.lines[0].description = evil; i.number = 'A&B<1>'; i.buyer.name = 'Ž\u0001č\u0007š'; });
  const xml = E.buildEslog(inv), root = parseXml(xml);
  assert.doesNotMatch(xml, /<S_EVIL|<!\[CDATA/); assert.equal(find(root, 'S_EVIL').length, 0);
  assert.equal(find(root, 'D_3036')[0].text, evil); assert.equal(find(root, 'D_7008')[0].text, evil); assert.equal(find(root, 'D_1004')[0].text, 'A&B<1>');
  assert.equal(find(root, 'D_3036')[1].text, 'Žčš', 'control characters XML refuses are dropped');
  assert.equal(E.eslogFileName(inv), 'eslog-A-B-1.xml'); assert.equal(E.eslogFileName({ number: '../../etc/passwd' }), 'eslog-etc-passwd.xml');
});
await t('XML limits: long text is cut to what the element allows; empty optional parts are left out', () => {
  const inv = invoice({}, (i) => { i.lines[0].description = 'd'.repeat(400); i.dueDate = ''; i.seller.iban = ''; i.paymentReference = ''; });
  const xml = E.buildEslog(inv), root = parseXml(xml);
  assert.equal(find(root, 'D_7008')[0].text.length, 256); assert.equal(find(root, 'S_FII').length, 0); assert.equal(find(root, 'G_SG8').length, 0); assert.equal(find(root, 'G_SG1').length, 0);
  const withRef = parseXml(E.buildEslog(invoice({}, (i) => { i.paymentReference = 'SI00 2026-0142'; i.note = 'Hvala'; })));
  assert.equal(find(withRef, 'G_SG1').length, 1); assert.equal(find(withRef, 'D_4440')[0].text, 'Hvala');
});
await t('the header comment of eslog.mjs says the XSD was checked but is not included', () => {
  const src = require('fs').readFileSync(path.join(dir, 'eslog/eslog.mjs'), 'utf8').split('\n').slice(0, 10).join('\n');
  assert.match(src, /validates against that XSD/); assert.match(src, /NOT copied into this repo/);
});
await t('XML carries the eSLOG namespace, S_UNH first and an S_UNT whose count matches', () => {
  const xml = E.buildEslog(invoice()), root = parseXml(xml);
  assert.match(xml, /<Invoice xmlns="urn:eslog:2\.00">/);
  const m = root.children[0]; assert.equal(m.children[0].name, 'S_UNH'); assert.equal(m.children[m.children.length - 1].name, 'S_UNT');
  let segs = 0; (function walk(e) { if (e.name.startsWith('S_')) segs++; e.children.forEach(walk); })(m);
  assert.equal(find(m, 'D_0074')[0].text, String(segs));
  assert.equal(find(m, 'D_0062')[0].text, find(m, 'D_0062')[1].text);
});
await t('optional: the XML validates against the official XSD when ESLOG_XSD points at eSLOG20_INVOIC_v200.xsd (xmllint)', () => {
  if (!process.env.ESLOG_XSD) { console.log('   (skipped: set ESLOG_XSD to the XSD from epos.si/eslog)'); return; }
  const { spawnSync } = require('child_process'), os = require('os'), fs = require('fs'), f = path.join(os.tmpdir(), 'eslog-test-' + process.pid + '.xml');
  fs.writeFileSync(f, E.buildEslog(invoice())); const r = spawnSync('xmllint', ['--noout', '--schema', process.env.ESLOG_XSD, f], { encoding: 'utf8' }); fs.unlinkSync(f);
  assert.equal(r.status, 0, r.stderr);
});
await t('rounding', () => {
  assert.equal(M.round2(0.1 + 0.2), 0.3);
});
console.log(n + ' tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
