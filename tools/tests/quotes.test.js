// Tests for site/quotes/core.js: totals, VAT, discounts, expiry, decisions, share links and the quote -> Billing invoice
// mapping (checked against Billing's own computeTotals). Run: node tools/tests/quotes.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Q = require(path.join(__dirname, '../../site/quotes/core.js'));
const B = require(path.join(__dirname, '../../site/billing/core.js'));

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok', n, name); }
const TODAY = '2026-10-17';
const seed = () => Q.seedQuotes(TODAY);
const bySeq = (seq) => seed().find((q) => q.seq === seq);
const BILLING_SETTINGS = { vatRegistered: true };
const asInvoice = (q) => ({ ...Q.invoiceDraftFromQuote(q, { today: TODAY }), clientId: 'x' });

t('money formatting: thousands dots, decimal comma, real minus', () => {
  assert.strictEqual(Q.eur(1070916), '10.709,16 €');
  assert.strictEqual(Q.eur(5), '0,05 €');
  assert.strictEqual(Q.eur(-46200), '−462,00 €');
  assert.strictEqual(Q.eur(123456789, { plain: true }), '1.234.567,89');
});

t('the mockup quote Q-2026-014 adds up exactly', () => {
  const x = Q.totals(bySeq(14));
  assert.deepStrictEqual(x.lines.map((l) => l.amount), [240000, 324000, 180000, 126000, 54000]);
  assert.strictEqual(x.subtotal, 924000);
  assert.strictEqual(x.discount, 46200);
  assert.strictEqual(x.net, 877800);
  assert.strictEqual(x.vat, 193116);
  assert.strictEqual(x.total, 1070916);
});

t('the other demo quotes match their stated totals', () => {
  const want = { 13: 146400, 12: 305000, 11: 109800, 10: 536800, 9: 207400 };
  for (const [seq, total] of Object.entries(want)) assert.strictEqual(Q.totals(bySeq(Number(seq))).total, total, 'Q-' + seq);
});

t('line discount, overall discount and VAT round per step, to the cent', () => {
  const q = { vatPct: 22, discountPct: 3, lines: [{ qty: 3, unitPrice: 33.33, discountPct: 7.5 }, { qty: 1.5, unitPrice: 19.99, discountPct: 0 }] };
  const x = Q.totals(q);
  assert.deepStrictEqual(x.lines.map((l) => l.amount), [9249, 2999]);   // 3 x 33,33 x 0,925 = 92,4908 -> 92,49; 1,5 x 19,99 = 29,985 -> 29,99
  assert.strictEqual(x.subtotal, 12248);
  assert.strictEqual(x.discount, 367);                                   // 3 % of 122,48 = 3,6744
  assert.strictEqual(x.net, 11881);
  assert.strictEqual(x.vat, 2614);                                       // 22 % of 118,81 = 26,1382
  assert.strictEqual(x.total, 14495);
  assert.deepStrictEqual(Q.totals({ vatPct: 0, discountPct: 0, lines: [] }), { lines: [], subtotal: 0, discount: 0, net: 0, vat: 0, total: 0 });
});

t('a quote is Expired only when sent and past its valid-until day (that day still counts)', () => {
  const q = bySeq(11);
  assert.strictEqual(Q.statusOf(q, TODAY), 'expired');
  const s = { status: 'sent', validUntil: '2026-10-17' };
  assert.strictEqual(Q.statusOf(s, '2026-10-17'), 'sent');
  assert.strictEqual(Q.statusOf(s, '2026-10-18'), 'expired');
  assert.strictEqual(Q.statusOf({ status: 'draft', validUntil: '2020-01-01' }, TODAY), 'draft');
  assert.strictEqual(Q.statusOf({ status: 'accepted', validUntil: '2020-01-01' }, TODAY), 'accepted');
  assert.strictEqual(Q.statusOf({ status: 'declined', validUntil: '2020-01-01' }, TODAY), 'declined');
});

t('tab counts and KPIs from the demo quotes', () => {
  const qs = seed();
  assert.deepStrictEqual(Q.counts(qs, TODAY), { all: 6, draft: 1, sent: 1, accepted: 2, expired: 1, declined: 1 });
  const k = Q.kpis(qs, TODAY);
  assert.strictEqual(k.open, 1070916);
  assert.strictEqual(k.accepted, 146400 + 207400);                       // both accepted this month: 1.464,00 + 2.074,00 = 3.538,00
  assert.strictEqual(k.rate, 50);                                        // 2 won of 4 decided (accepted, declined, expired)
});

t('the demo dates are relative to today', () => {
  const a = Q.seedQuotes('2026-10-17'), b = Q.seedQuotes('2027-01-05');
  assert.strictEqual(a[0].validUntil, '2026-11-14');                     // the mockup's 14 Nov
  assert.strictEqual(Q.statusOf(b[0], '2027-01-05'), 'sent');
  assert.ok(a.every((q) => Q.isIso(q.issueDate) && Q.isIso(q.validUntil)));
});

t('numbering continues after the highest number of the year', () => {
  assert.deepStrictEqual(Q.nextNumber(seed(), 2026), { number: 'Q-2026-015', year: 2026, seq: 15 });
  assert.deepStrictEqual(Q.nextNumber([], 2027), { number: 'Q-2027-001', year: 2027, seq: 1 });
});

t('a decision is applied only to a quote that is out and not expired; text is limited', () => {
  const q = bySeq(14);
  assert.deepStrictEqual(Q.applyDecision(q, { kind: 'maybe' }, TODAY), { ok: false, reason: 'Unknown answer.' });
  const r = Q.applyDecision(q, { kind: 'accepted', name: 'A'.repeat(200), note: 'N'.repeat(900), at: TODAY }, TODAY);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(q.status, 'accepted');
  assert.strictEqual(q.decision.name.length, 80);
  assert.strictEqual(q.decision.note.length, 500);
  assert.strictEqual(Q.applyDecision(q, { kind: 'declined', at: TODAY }, TODAY).ok, false, 'cannot change an answer');
  assert.strictEqual(Q.applyDecision(bySeq(11), { kind: 'accepted', at: TODAY }, TODAY).ok, false, 'expired');
  assert.strictEqual(Q.applyDecision(bySeq(12), { kind: 'accepted', at: TODAY }, TODAY).ok, false, 'draft');
  assert.strictEqual(Q.applyDecision(bySeq(10), { kind: 'accepted', at: TODAY }, TODAY).ok, false, 'declined stays declined');
});

t('quote -> Billing draft: same lines, VAT and discount, and Billing computes the same totals', () => {
  for (const q of seed()) {
    const inv = asInvoice(q);
    const bt = B.computeTotals(inv, BILLING_SETTINGS), qt = Q.totals(q);
    assert.strictEqual(bt.net, qt.net, q.number + ' net');
    assert.strictEqual(bt.vat, qt.vat, q.number + ' vat');
    assert.strictEqual(bt.total, qt.total, q.number + ' total');
    assert.strictEqual(inv.kind, 'invoice');
    assert.strictEqual(inv.fromQuote, q.id);
    assert.strictEqual(inv.note, 'As per quote ' + q.number);
    assert.ok(inv.lines.every((l) => l.vatRate === q.vatPct));
  }
});

t('the overall discount becomes one negative line; no discount adds no line', () => {
  const withDisc = Q.invoiceDraftFromQuote(bySeq(14), { today: TODAY });
  assert.strictEqual(withDisc.lines.length, 6);
  const last = withDisc.lines[5];
  assert.deepStrictEqual([last.description, last.qty, last.unitPrice, last.vatRate], ['Discount 5 %', 1, -462, 22]);
  assert.strictEqual(withDisc.lines[1].discountPct, 10, 'a line discount stays a line discount');
  assert.strictEqual(Q.invoiceDraftFromQuote(bySeq(13), { today: TODAY }).lines.length, 2);
});

t('random quotes: Billing and Quotes agree to the cent', () => {
  let seedN = 12345;
  const rnd = () => { seedN = (seedN * 1103515245 + 12345) & 0x7fffffff; return seedN / 0x7fffffff; };
  for (let i = 0; i < 300; i++) {
    const q = { id: 'r' + i, number: 'Q-x', vatPct: [0, 9.5, 22][i % 3], discountPct: Math.round(rnd() * 20 * 10) / 10,
      lines: Array.from({ length: 1 + Math.floor(rnd() * 5) }, () => ({ description: 'x', note: '', qty: Math.round(rnd() * 90) / 10 + 0.1, unitPrice: Math.round(rnd() * 100000) / 100, discountPct: Math.round(rnd() * 15 * 10) / 10 })) };
    const bt = B.computeTotals(asInvoice(q), BILLING_SETTINGS), qt = Q.totals(q);
    assert.deepStrictEqual([bt.net, bt.vat, bt.total], [qt.net, qt.vat, qt.total], JSON.stringify(q));
  }
});

t('the client link round-trips and carries nothing internal', () => {
  const q = bySeq(14);
  q.internalNote = 'secret'; q.client.name = 'Čebelnjak "Šum" <b>d.o.o.</b>';
  const enc = Q.encodeShare(q, Q.COMPANY);
  assert.ok(/^[\w-]+$/.test(enc), 'safe for a URL fragment');
  const d = Q.decodeShare(enc);
  assert.strictEqual(d.id, q.id);
  assert.strictEqual(d.client.name, q.client.name);
  assert.strictEqual(d.company.name, 'Lipa Studio d.o.o.');
  assert.strictEqual(Q.totals(d).total, Q.totals(q).total);
  assert.ok(!Q.b64uDecode(enc).includes('secret'));
});

t('a damaged or hostile link is refused or cleaned', () => {
  assert.strictEqual(Q.decodeShare('%%%'), null);
  assert.strictEqual(Q.decodeShare(Q.b64uEncode('not json')), null);
  assert.strictEqual(Q.decodeShare(Q.b64uEncode(JSON.stringify({ v: 2, lines: [] }))), null);
  assert.strictEqual(Q.decodeShare(Q.b64uEncode(JSON.stringify({ v: 1, id: 'a', n: 'Q', lines: [] }))), null, 'no lines');
  const many = { v: 1, id: 'a', n: 'Q', lines: Array.from({ length: 61 }, () => ['x', '', 1, 1, 0]) };
  assert.strictEqual(Q.decodeShare(Q.b64uEncode(JSON.stringify(many))), null, 'too many lines');
  const odd = Q.decodeShare(Q.b64uEncode(JSON.stringify({ v: 1, id: 'a', n: 'Q', vat: 5000, disc: -4, valid: 'tomorrow', lines: [['x'.repeat(999), 1, 'NaN', null, 400]] })));
  assert.strictEqual(odd.vatPct, 100);
  assert.strictEqual(odd.discountPct, 0);
  assert.strictEqual(odd.validUntil, '');
  assert.strictEqual(odd.lines[0].description.length, 200);
  assert.strictEqual(odd.lines[0].discountPct, 100);
  assert.ok(Number.isFinite(Q.totals(odd).total));
});

t('the reply link round-trips and refuses anything else', () => {
  const r = { id: 'demo-q-14', kind: 'accepted', name: 'Ana', note: 'Start in November', at: TODAY };
  assert.deepStrictEqual(Q.decodeReply(Q.encodeReply(r)), r);
  assert.strictEqual(Q.decodeReply(Q.b64uEncode(JSON.stringify({ v: 1, id: 'x', kind: 'delete', at: TODAY }))), null);
  assert.strictEqual(Q.decodeReply(Q.b64uEncode(JSON.stringify({ v: 1, id: 'x', kind: 'accepted', at: 'soon' }))), null);
  assert.strictEqual(Q.decodeReply('!!'), null);
});

t('demo data is fictional: no e-mail addresses or personal contact data', () => {
  const text = JSON.stringify(seed()) + JSON.stringify(Q.COMPANY);
  assert.ok(!/@/.test(text));
  assert.ok(!/adrial/i.test(text));
});

t('the app is wired up: home page, sheet, icon, Billing hand-off, sync privacy', () => {
  const root = path.join(__dirname, '../..');
  const home = fs.readFileSync(path.join(root, 'site/index.html'), 'utf8');
  assert.ok(home.includes('data-app="quotes"') && home.includes('href="quotes/"'));
  assert.ok(require(path.join(root, 'site/_shared/app-sheets.js')).quotes);
  assert.ok(fs.existsSync(path.join(root, 'site/icons/apps/quotes.png')));
  for (const f of ['index.html', 'accept.html']) assert.ok(fs.readFileSync(path.join(root, 'site/quotes', f), 'utf8').includes('<!-- phone app: tools/make-pwa.mjs -->'), f);
  const billing = fs.readFileSync(path.join(root, 'site/billing/app.js'), 'utf8');
  assert.ok(billing.includes("'external'") && billing.includes('stratum-billing-external-change'));
  assert.ok(fs.readFileSync(path.join(root, 'worker/access.js'), 'utf8').includes("'quotes'"));
});

console.log(`\n${n} tests passed`);
