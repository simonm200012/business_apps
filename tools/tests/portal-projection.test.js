// Client portal projection: what Billing publishes (site/billing/portal-projection.js) and what the Worker lets through
// (worker/portal-schema.js). SENTINEL strings sit in every field that must stay private. Run: node tools/tests/portal-projection.test.js
'use strict';
const assert = require('assert');
const { imp } = require('./_portal-harness');
const P = require('../../site/billing/portal-projection.js');
const { buildDemoState } = require('../portal-demo-state.js');

let n = 0;
async function t(name, fn) { await fn(); n++; console.log('ok', n, name); }
const TODAY = '2026-10-17';

(async function main() {
  const S = await imp('worker/portal-schema.js');
  const state = buildDemoState('alder', { sentinel: true });
  const raw = P.buildProjection(state, 'cl-lindgren', { today: TODAY });
  const sanitized = S.sanitizeView(JSON.parse(JSON.stringify(raw)));
  assert.ok(sanitized.view, sanitized.error);

  await t('the builder publishes issued invoices and quotes of this client only, never drafts', async () => {
    assert.deepStrictEqual(raw.invoices.map((i) => i.number), ['INV-2026-0005', 'INV-2026-0003', 'INV-2026-0002', 'INV-2026-0001']);
    assert.deepStrictEqual(raw.invoices.map((i) => i.status), ['issued', 'overdue', 'paid', 'paid']);
    assert.deepStrictEqual(raw.invoices.map((i) => i.amountDue), [124000, 86000, 0, 0]);
    assert.strictEqual(raw.invoices[2].paidOn, '2026-09-02');
    assert.ok(raw.quotes.every((q) => q.status !== 'draft'));
    assert.strictEqual(raw.quotes.length, 3);
    assert.ok(!JSON.stringify(raw).includes('Birch') && !JSON.stringify(raw).includes('Packaging labels') && !JSON.stringify(raw).includes('Seasonal menu'), 'other client absent');
    const other = P.buildProjection(state, 'cl-birch', { today: TODAY });
    assert.deepStrictEqual(other.invoices.map((i) => i.number), ['INV-2026-0004']);
    assert.ok(!JSON.stringify(other).includes('Lindgren') && !JSON.stringify(other).includes('Brand refresh'));
  });
  await t('SENTINEL texts (payment notes, work log, contracts, settings, client extras, drafts, audit) are absent after the builder and after the sanitiser', async () => {
    for (const [label, v] of [['builder', raw], ['sanitiser', sanitized.view]]) {
      const s = JSON.stringify(v);
      assert.ok(!/SENTINEL/.test(s), label + ' leaked ' + (s.match(/SENTINEL[-\w]*/) || [''])[0]);
      assert.ok(!/elena@|example\.com|example\.net|Example Street|SI56|bank ref/.test(s), label + ': no e-mail, address, IBAN or payment data');
    }
    assert.ok(JSON.stringify(state).includes('SENTINEL-payment-note'), 'the fixture really carries the sentinels');
  });
  await t('the output has exactly the whitelisted keys', async () => {
    assert.deepStrictEqual(Object.keys(sanitized.view), ['v', 'client', 'invoices', 'quotes', 'documents']);
    assert.deepStrictEqual(Object.keys(sanitized.view.client), ['name']);
    assert.deepStrictEqual(Object.keys(sanitized.view.invoices[0]).sort(), ['amountDue', 'dueDate', 'id', 'issueDate', 'kind', 'number', 'paidOn', 'pdf', 'reference', 'status', 'title', 'total']);
    assert.deepStrictEqual(Object.keys(sanitized.view.quotes[0]).sort(), ['id', 'issueDate', 'kind', 'lines', 'note', 'number', 'pdf', 'status', 'totals', 'validUntil']);
  });
  await t('the sanitiser drops unknown keys, whoever added them', async () => {
    const dirty = JSON.parse(JSON.stringify(raw));
    dirty.secret = 'SENTINEL-top'; dirty.client.email = 'SENTINEL-mail'; dirty.invoices[0].payments = [{ note: 'SENTINEL-pay' }]; dirty.invoices[0].clientId = 'cl-birch';
    dirty.quotes[0].lines[0].internalCost = 'SENTINEL-cost'; dirty.quotes[0].hash = 'forged'; dirty.__proto__ = { x: 1 };
    const out = S.sanitizeView(dirty);
    assert.ok(out.view && !/SENTINEL|forged/.test(JSON.stringify(out.view)));
  });
  await t('hashes are computed by the server from the printed fields and change when anything printed changes', async () => {
    const forged = JSON.parse(JSON.stringify(raw)); forged.quotes.forEach((q) => { q.hash = 'a'.repeat(64); });
    const a = await S.withHashes(S.sanitizeView(forged).view);
    assert.ok(a.quotes.every((q) => /^[a-f0-9]{64}$/.test(q.hash)));
    const b = await S.withHashes(S.sanitizeView(JSON.parse(JSON.stringify(raw))).view);
    assert.deepStrictEqual(a.quotes.map((q) => q.hash), b.quotes.map((q) => q.hash), 'same fields, same hash');
    const changed = JSON.parse(JSON.stringify(raw)); changed.quotes[1].lines[0].unitPrice += 1;
    const c = await S.withHashes(S.sanitizeView(changed).view);
    assert.notStrictEqual(c.quotes[1].hash, b.quotes[1].hash);
    const noted = JSON.parse(JSON.stringify(raw)); noted.quotes[1].note += '!';
    assert.notStrictEqual((await S.withHashes(S.sanitizeView(noted).view)).quotes[1].hash, b.quotes[1].hash);
  });
  await t('formats are checked: bad dates, ids, enums, money, file ids, sizes, duplicates', async () => {
    const mut = (fn) => { const v = JSON.parse(JSON.stringify(raw)); fn(v); return S.sanitizeView(v); };
    assert.ok(mut((v) => { v.invoices[0].issueDate = '2026-13-40'; }).error);
    assert.ok(mut((v) => { v.invoices[0].issueDate = '2026-02-30'; }).error);
    assert.ok(mut((v) => { v.invoices[0].status = 'draft'; }).error, 'drafts are refused');
    assert.ok(mut((v) => { v.invoices[0].total = 1.5; }).error);
    assert.ok(mut((v) => { v.invoices[0].total = '100'; }).error);
    assert.ok(mut((v) => { v.invoices[0].id = '../x'; }).error);
    assert.ok(mut((v) => { v.invoices[0].pdf = '../../etc'; }).error);
    assert.ok(mut((v) => { v.invoices[0].pdf = 'A'.repeat(32); }).error, 'upper-case hex');
    assert.ok(mut((v) => { v.quotes[0].id = 'not-a-uuid'; }).error);
    assert.ok(mut((v) => { v.quotes[0].kind = 'order'; }).error);
    assert.ok(mut((v) => { v.quotes[0].lines = []; }).error);
    assert.ok(mut((v) => { v.quotes[0].lines[0].qty = -1; }).error);
    assert.ok(mut((v) => { v.quotes[0].lines[0].discountPct = 101; }).error);
    assert.ok(mut((v) => { v.invoices.push(v.invoices[0]); }).error, 'duplicate id');
    assert.ok(mut((v) => { v.invoices = Array.from({ length: 501 }, (_, i) => ({ ...v.invoices[0], id: 'i' + i })); }).error, 'more than 500');
    assert.ok(mut((v) => { v.client.name = ''; }).error);
    assert.ok(mut((v) => { v.documents = [{ id: 'f'.repeat(32), name: 'x', size: 1, type: 'text/html', sharedAt: '2026-10-01' }]; }).error, 'html is not an allowed type');
    assert.ok(mut((v) => { v.documents = [{ id: 'f'.repeat(32), name: 'x.svg', size: 1, type: 'image/svg+xml', sharedAt: '2026-10-01' }]; }).error);
    assert.ok(mut((v) => { v.documents = [{ id: 'f'.repeat(32), name: 'x', size: 21 * 1024 * 1024, type: 'application/pdf', sharedAt: '2026-10-01' }]; }).error);
    assert.ok(S.sanitizeView(null).error && S.sanitizeView([]).error && S.sanitizeView('x').error);
    assert.ok(S.sanitizeView({ client: { name: 'A' }, invoices: 'x' }).error);
  });
  await t('HTML in a description is plain text: kept as characters, never markup; control and bidi characters are removed', async () => {
    const v = JSON.parse(JSON.stringify(raw));
    v.quotes[0].lines[0].description = '<img src=x onerror=alert(1)>‮evil\u0000​ ok';
    v.client.name = 'Café ⁦X⁩';
    const out = S.sanitizeView(v).view;
    assert.ok(!/[‮\u0000​]/.test(out.quotes[0].lines[0].description));
    assert.ok(out.quotes[0].lines[0].description.startsWith('<img src=x onerror=alert(1)>'), 'text kept as text (the front-end uses textContent)');
    assert.strictEqual(out.client.name, 'Café X');
  });
  await t('brand: colour format and contrast, plain-text name; news: plain text, at most 20', async () => {
    assert.deepStrictEqual(S.sanitizeBrand({ name: ' Alder & Finch ', accent: '#1F6B4F' }).brand, { name: 'Alder & Finch', accent: '#1f6b4f' });
    for (const bad of ['red', '#fff', '#ggg000', 'javascript:alert(1)', '#1f6b4f;background:url(x)', '#f8f800', '']) assert.ok(S.sanitizeBrand({ name: 'X', accent: bad }).error, bad);
    assert.ok(S.sanitizeBrand({ name: '', accent: '#1f6b4f' }).error);
    assert.ok(S.sanitizeBrand({ name: 'X'.repeat(200), accent: '#1f6b4f' }).brand.name.length === 60);
    const news = S.sanitizeNews({ items: [{ date: '2026-10-14', title: '<b>Closed</b>', body: 'line1\nline2' }] }).news;
    assert.strictEqual(news.items[0].title, '<b>Closed</b>'); assert.ok(news.items[0].body.includes('\n'));
    assert.ok(S.sanitizeNews({ items: Array.from({ length: 21 }, () => ({ date: '2026-10-14', title: 'x' })) }).error);
    assert.ok(S.sanitizeNews({ items: [{ date: 'x', title: 'x' }] }).error);
  });
  await t('files: allow-list with content checks, safe download names', async () => {
    const b = (...a) => Uint8Array.from(a);
    assert.ok(S.magicOk('application/pdf', Buffer.from('%PDF-1.7 x')));
    assert.ok(!S.magicOk('application/pdf', Buffer.from('<html><script>alert(1)</script>')));
    assert.ok(!S.magicOk('application/pdf', new Uint8Array(0)));
    assert.ok(S.magicOk('image/png', b(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0)));
    assert.ok(!S.magicOk('image/png', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')));
    assert.ok(!S.magicOk('image/svg+xml', Buffer.from('<svg/>')));
    assert.ok(S.magicOk('text/csv', Buffer.from('a,b\n1,2\n')) && !S.magicOk('text/csv', Buffer.from('<script>x</script>')) && !S.magicOk('text/csv', Buffer.from([97, 0, 98])));
    assert.strictEqual(S.safeFilename('../../etc/passwd'), 'etc_passwd');
    assert.strictEqual(S.safeFilename('a\\b/c‮.pdf'), 'a_b_c.pdf');
    assert.strictEqual(S.safeFilename('\u0000\n', 'pdf'), 'download.pdf');
    assert.ok(S.safeFilename('x'.repeat(500), 'pdf').length <= 120);
    assert.ok(/^attachment; filename\*=UTF-8''[A-Za-z0-9._%-]+$/.test(S.attachment('Brand guidelines v3 č.pdf')));
    assert.ok(!S.attachment('a"b;c\r\nSet-Cookie: x').includes('"') && !/[\r\n]/.test(S.attachment('a\r\nb')));
  });

  console.log('portal-projection: ' + n + ' tests passed');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
