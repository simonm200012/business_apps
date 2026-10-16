// Tests for the Marketing calendar's Omnibus checklist line (site/marketing/data.js) and the Refill & win-back demo
// numbers (site/refill/demo-api.js): A/B groups, e-mails and lift that add up. Run: node tools/tests/marketing-refill.test.js
'use strict';
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const SITE = path.join(__dirname, '../../site');

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok', n, name); }
function sandbox() {
  const ctx = { console, Date, Math, JSON, Map, Set, Promise, Intl, setTimeout, clearTimeout };
  ctx.window = ctx;
  ctx.document = { body: null, addEventListener() {}, getElementById() { return null; }, createElement() { return { style: {} }; } };
  vm.createContext(ctx);
  return ctx;
}
function run(ctx, file) { vm.runInContext(fs.readFileSync(path.join(SITE, file), 'utf8'), ctx, { filename: file }); }

// ── Marketing calendar: 30-day lowest price (Omnibus) ────────────────────
const mk = sandbox(); run(mk, 'marketing/data.js');
const D = mk.MKTDATA;
t('price reductions are recognised from the offer', () => {
  ['Sunglasses −20 %', 'Up to −40 % on frames', 'Second pair −50 %', 'Subscribe & save 15 %', '-10 € on lenses', 'Summer sale on frames', 'Popust na okvirje', 'Sconto 15%'].forEach((o) => assert.ok(D.isPriceReduction({ offer: o, type: 'other' }), o));
  ['Gift cards +10 % value', 'Free eye exam with any frame purchase', 'Free sunglasses fitting and cleaning', ''].forEach((o) => assert.ok(!D.isPriceReduction({ offer: o, type: 'newsletter' }), o || '(empty)'));
  assert.ok(D.isPriceReduction({ offer: '', type: 'black_friday' }), 'a sale type without an offer text');
});
t('discount campaigns get the Omnibus checklist line, others do not', () => {
  const a = D.checklistFor({ offer: '−15 % on sunglasses' }), b = D.checklistFor({ offer: 'Free eye exam with any frame purchase', type: 'eye_exam' });
  assert.strictEqual(a.length, D.CHECKLIST.length + 1);
  assert.strictEqual(a[a.length - 1].id, 'omnibus');
  assert.ok(/98\/6\/EC Art\. 6a/.test(a[a.length - 1].law) && /ZVPot-1 Art\. 15\.a/.test(a[a.length - 1].law));
  assert.strictEqual(b.length, D.CHECKLIST.length);
});
t('the demo plan ticks the Omnibus line together with "Legal OK" and changes nothing else', () => {
  const plan = D.generate('2026-10-15');
  const sale = plan.campaigns.filter((c) => D.isPriceReduction(c));
  assert.ok(sale.length > 10);
  sale.forEach((c) => assert.strictEqual(c.checklist.omnibus, !!c.checklist.legal, c.name));
  plan.campaigns.filter((c) => !D.isPriceReduction(c)).forEach((c) => assert.ok(!('omnibus' in c.checklist), c.name));
});

// ── Refill & win-back demo numbers ───────────────────────────────────────
const rf = sandbox(); run(rf, '_shared/demo-api.js');
let H = null; rf.StratumDemo.register = (p, h) => { H = h; };
run(rf, 'refill/demo-api.js');
const q = (route, params) => H(route, new URLSearchParams(params || {}), { method: 'GET' });
t('markets are SI, HR and IT (no "CRO")', () => {
  const m = q('meta');
  assert.deepStrictEqual(Array.from(new Set(m.shops.map((s) => s.market))), ['SI', 'HR', 'IT']);
  assert.ok(q('segments', { market: 'HR' }).rows.length > 0);
  assert.strictEqual(q('segments', { market: 'CRO' }).rows.length, 0);
});
t('e-mails sent = e-mailable customers of the 90% target group in contact actions', () => {
  const sent = q('meta').freshness.filter((f) => f.source === 'emails_sent')[0].n;
  const rows = q('segments', { by: 'market' }).rows;
  const mailable = rows.filter((r) => r.email_marketable && r.suggested_action !== 'No contact').reduce((a, r) => a + r.customers, 0);
  assert.ok(Math.abs(sent - Math.round(mailable * 0.9)) <= 1, sent + ' vs ' + mailable);
});
t('A/B: target + control is the day\'s population, control about 10%, e-mailed ≤ target, reorders grow 7 → 14 → 30', () => {
  const ab = q('ab', { action: 'contact' });
  const days = {};
  ab.cohorts.forEach((r) => { (days[r.cohort] = days[r.cohort] || {})[r.ab_group] = r; });
  const rows = q('segments', { by: 'market' }).rows.filter((r) => r.suggested_action !== 'No contact');
  const N = rows.reduce((a, r) => a + r.customers, 0), M = rows.filter((r) => r.email_marketable).reduce((a, r) => a + r.customers, 0);
  Object.keys(days).forEach((d) => {
    const t1 = days[d].target, c = days[d].control, pop = t1.customers + c.customers;
    assert.ok(Math.abs(pop / N - 1) <= 0.03, 'population ' + pop + ' vs scored ' + N);
    assert.ok(Math.abs(c.customers / pop - 0.1) < 0.01, 'control share');
    assert.strictEqual(c.emailed, 0, 'the hold-out is never e-mailed');
    assert.ok(t1.emailed <= t1.customers && Math.abs(t1.emailed / t1.customers - M / N) < 0.005, 'e-mailed share = e-mailable share');
    [t1, c].forEach((g) => assert.ok(g.reordered_7d <= g.reordered_14d && g.reordered_14d <= g.reordered_30d && g.reordered_30d <= g.customers));
  });
});
t('A/B: the measured lift is the per-e-mail lift diluted by the e-mailed share (no more than any action\'s lift)', () => {
  const ab = q('ab', { action: 'contact' }), fin = {};
  ab.cohorts.filter((r) => r.final).forEach((r) => { const x = fin[r.ab_group] || (fin[r.ab_group] = { n: 0, x: 0, m: 0 }); x.n += r.customers; x.x += r.reordered_30d; x.m += r.emailed; });
  const rt = fin.target.x / fin.target.n, rc = fin.control.x / fin.control.n, share = fin.target.m / fin.target.n;
  const rel = rt / rc - 1;
  assert.ok(rel > 0.03 && rel < 0.36 * share + 0.03, 'relative lift ' + rel.toFixed(3) + ' with ' + (share * 100).toFixed(0) + '% e-mailed');
});

console.log('\nall ' + n + ' marketing/refill tests passed');
