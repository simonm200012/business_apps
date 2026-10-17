// Client portal, staff side (worker/portal-staff.js through the real staff Worker): who may call it, what gets stored, what is
// refused. Run: node tools/tests/portal-staff.test.js
'use strict';
const assert = require('assert');
const H = require('./_portal-harness');
const P = require('../../site/billing/portal-projection.js');
const { buildDemoState } = require('../portal-demo-state.js');

let n = 0;
async function t(name, fn) { await fn(); n++; console.log('ok', n, name); }
const C1 = 'a'.repeat(32), C2 = 'b'.repeat(32), F1 = 'c'.repeat(32);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);

(async function main() {
  const realErr = console.error; console.error = () => {};
  const staff = (await H.imp('worker/index.js')).default;
  const S = await H.imp('worker/portal-schema.js');
  const Cm = await H.imp('worker/portal-common.js');
  const k = await H.setupKeys();
  const r2 = H.makeR2(), sync = H.makeR2();
  const env = { ACCESS_TEAM_DOMAIN: H.TEAM, ACCESS_AUD: H.STAFF_AUD, PORTAL_ACCESS_AUD: H.PORTAL_AUD, OWNER_EMAIL: H.OWNER, VIEWER_EMAILS: 'viewer@example.com', SYNC: sync, PORTAL: r2, ASSETS: null };
  const ownerTok = await k.staffToken(H.OWNER), viewerTok = await k.staffToken('viewer@example.com'), strangerTok = await k.staffToken('stranger@example.com');
  const T = await Cm.tenantOf(H.OWNER);
  const call = async (tok, method, p, body, headers = {}) => {
    const h = new Headers({ 'X-Stratum-Apps': '1', ...headers });
    if (tok) h.set('Cf-Access-Jwt-Assertion', tok);
    let b = body;
    if (body !== undefined && typeof body === 'object' && !(body instanceof Uint8Array) && !Buffer.isBuffer(body)) { b = JSON.stringify(body); if (!h.has('Content-Type')) h.set('Content-Type', 'application/json'); }
    const r = await staff.fetch(new Request('https://apps.example' + p, { method, headers: h, body: b }), env);
    const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, json: j, text, headers: r.headers };
  };
  const owner = (m, p, b, h) => call(ownerTok, m, p, b, h);
  const state = buildDemoState('alder', { sentinel: true });
  const proj = (pdfs = {}) => P.buildProjection(state, 'cl-lindgren', { today: '2026-10-17', pdfs });

  await t('who may call: no token 401, stranger 403, viewer 403 on every route and method, portal token 401', async () => {
    const routes = [['GET', '/api/portal/clients'], ['PUT', '/api/portal/clients/' + C1], ['DELETE', '/api/portal/clients/' + C1], ['GET', '/api/portal/clients/' + C1 + '/view'], ['PUT', '/api/portal/clients/' + C1 + '/view'],
      ['PUT', '/api/portal/clients/' + C1 + '/files/' + F1], ['DELETE', '/api/portal/clients/' + C1 + '/files/' + F1], ['PUT', '/api/portal/users'], ['DELETE', '/api/portal/users'], ['PUT', '/api/portal/brand'],
      ['PUT', '/api/portal/brand/logo'], ['PUT', '/api/portal/news'], ['GET', '/api/portal/responses'], ['GET', '/api/portal/audit'], ['GET', '/api/portal']];
    for (const [m, p] of routes) {
      assert.strictEqual((await call(null, m, p, m === 'GET' ? undefined : {})).status, 401, 'no token ' + m + ' ' + p);
      assert.strictEqual((await call(strangerTok, m, p, m === 'GET' ? undefined : {})).status, 403, 'stranger ' + m + ' ' + p);
      assert.strictEqual((await call(viewerTok, m, p, m === 'GET' ? undefined : {})).status, 403, 'viewer ' + m + ' ' + p);
      assert.strictEqual((await call(await k.portalToken(H.OWNER), m, p, m === 'GET' ? undefined : {})).status, 401, 'portal token ' + m + ' ' + p);
    }
    assert.strictEqual(r2.store.size, 0, 'nothing was written');
  });
  await t('changes need X-Stratum-Apps; unknown routes 404; wrong methods 405', async () => {
    const h = new Headers({ 'Cf-Access-Jwt-Assertion': ownerTok, 'Content-Type': 'application/json' });
    const r = await staff.fetch(new Request('https://apps.example/api/portal/news', { method: 'PUT', headers: h, body: '{}' }), env);
    assert.strictEqual(r.status, 400);
    assert.strictEqual((await owner('GET', '/api/portal/nothing')).status, 404);
    assert.strictEqual((await owner('POST', '/api/portal/clients')).status, 405);
    assert.strictEqual((await owner('GET', '/api/portal/news')).status, 405);
    assert.strictEqual((await owner('PUT', '/api/portal/clients/' + C1 + '/view')).status, 404, 'no such client yet');
  });
  await t('enable a client: created once (201), renamed after (200); bad ids and names refused', async () => {
    assert.strictEqual((await owner('PUT', '/api/portal/clients/' + C1, { name: 'Lindgren Café', billingId: 'cl-lindgren' })).status, 201);
    assert.strictEqual((await owner('PUT', '/api/portal/clients/' + C1, { name: 'Lindgren Café Ltd' })).status, 200);
    assert.strictEqual((await owner('PUT', '/api/portal/clients/' + C1, { name: '  ' })).status, 400);
    for (const bad of ['../x', 'A'.repeat(32), 'a'.repeat(31), '%2e%2e']) assert.strictEqual((await owner('PUT', '/api/portal/clients/' + bad, { name: 'x' })).status, bad === '%2e%2e' || bad === '../x' ? 404 : 400, bad);
    assert.strictEqual((await owner('PUT', '/api/portal/clients/' + C2, { name: 'Birch Bakery', billingId: 'cl-birch' })).status, 201);
    const list = (await owner('GET', '/api/portal/clients')).json.clients;
    assert.deepStrictEqual(list.map((c) => [c.c, c.name, c.billingId, c.published, c.users]).sort(), [[C1, 'Lindgren Café Ltd', 'cl-lindgren', null, 0], [C2, 'Birch Bakery', 'cl-birch', null, 0]].sort());
    assert.ok([...r2.store.keys()].every((key) => key.startsWith('p/' + T + '/')), 'everything is under the staff tenant');
  });
  await t('files: allow-list, content check, size limit; no HTML or SVG ever', async () => {
    const put = (type, body, f = F1) => owner('PUT', '/api/portal/clients/' + C1 + '/files/' + f, body, { 'Content-Type': type });
    assert.strictEqual((await put('text/html', '<script>x</script>')).status, 415);
    assert.strictEqual((await put('image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg"/>')).status, 415);
    assert.strictEqual((await put('application/javascript', 'alert(1)')).status, 415);
    assert.strictEqual((await put('application/pdf', Buffer.from('<html>pretending</html>'))).status, 415, 'a PDF that is HTML');
    assert.strictEqual((await put('application/pdf', Buffer.alloc(0))).status, 415);
    assert.strictEqual((await put('application/pdf', Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(21 * 1024 * 1024)]))).status, 413);
    assert.strictEqual((await put('application/pdf', PDF, 'nothex')).status, 400);
    assert.strictEqual((await put('application/pdf', PDF, F1.toUpperCase())).status, 400);
    assert.strictEqual((await put('application/pdf', PDF)).status, 200);
    assert.strictEqual(r2.store.get('p/' + T + '/c/' + C1 + '/files/' + F1).httpMetadata.contentType, 'application/pdf');
    assert.strictEqual((await put('application/pdf', PDF, 'd'.repeat(32))).status, 200);
    assert.strictEqual((await owner('DELETE', '/api/portal/clients/' + C1 + '/files/' + 'd'.repeat(32))).status, 200);
    assert.ok(!r2.store.has('p/' + T + '/c/' + C1 + '/files/' + 'd'.repeat(32)));
    assert.strictEqual((await owner('PUT', '/api/portal/clients/' + 'e'.repeat(32) + '/files/' + F1, PDF, { 'Content-Type': 'application/pdf' })).status, 404, 'a client id that does not exist under this tenant');
  });
  await t('publish: sanitised, hashed, files first; stale base 409; sentinels never stored', async () => {
    const view = proj({ [state.invoices.find((i) => i.number === 'INV-2026-0005').id]: F1 });
    // the pdf of a quote that was never uploaded
    const missing = proj({ [state.invoices[0].id]: 'f'.repeat(32) });
    assert.strictEqual((await owner('PUT', '/api/portal/clients/' + C1 + '/view', missing)).status, 409);
    const ok = await owner('PUT', '/api/portal/clients/' + C1 + '/view', { ...view, notes: 'SENTINEL-extra' });
    assert.strictEqual(ok.status, 200, ok.text);
    assert.ok(Object.values(ok.json.quoteHashes).every((h) => /^[a-f0-9]{64}$/.test(h)));
    const stored = r2.json('p/' + T + '/c/' + C1 + '/view.json');
    assert.ok(!/SENTINEL/.test(JSON.stringify(stored)));
    assert.strictEqual(stored.client.name, 'Lindgren Café');
    // a second publish needs the current etag
    assert.strictEqual((await owner('PUT', '/api/portal/clients/' + C1 + '/view', view)).status, 409);
    assert.strictEqual((await owner('PUT', '/api/portal/clients/' + C1 + '/view?base=stale', view)).status, 409);
    const next = await owner('PUT', '/api/portal/clients/' + C1 + '/view?base=' + encodeURIComponent(ok.json.etag), view);
    assert.strictEqual(next.status, 200);
    const got = await owner('GET', '/api/portal/clients/' + C1 + '/view');
    assert.strictEqual(got.headers.get('ETag'), next.json.etag);
    // invalid content is refused and leaves the published view alone
    const before = r2.store.get('p/' + T + '/c/' + C1 + '/view.json').etag;
    const broken = JSON.parse(JSON.stringify(view)); broken.invoices[0].status = 'draft';
    assert.strictEqual((await owner('PUT', '/api/portal/clients/' + C1 + '/view?base=' + encodeURIComponent(next.json.etag), broken)).status, 400);
    assert.strictEqual((await owner('PUT', '/api/portal/clients/' + C1 + '/view?base=' + encodeURIComponent(next.json.etag), '{not json')).status, 400);
    assert.strictEqual(r2.store.get('p/' + T + '/c/' + C1 + '/view.json').etag, before);
    // two publishes at once with the same base: exactly one wins
    r2.putDelay = 15;
    const base = '?base=' + encodeURIComponent(before);
    const both = await Promise.all([owner('PUT', '/api/portal/clients/' + C1 + '/view' + base, view), owner('PUT', '/api/portal/clients/' + C1 + '/view' + base, view)]);
    r2.putDelay = 0;
    assert.deepStrictEqual(both.map((r) => r.status).sort(), [200, 409]);
  });
  await t('users: one e-mail → one client; owner and viewer e-mails refused; no e-mail in any key; removal works', async () => {
    const add = (email, c = C1, extra = {}) => owner('PUT', '/api/portal/users', { email, c, ...extra });
    assert.strictEqual((await add('client-a@example.test')).status, 201);
    assert.strictEqual((await add('Client-A@Example.Test')).status, 200, 'same person, other spelling, same client: idempotent');
    assert.strictEqual((await add('client-a@example.test', C2)).status, 409, 'cannot belong to two clients');
    assert.strictEqual((await add(H.OWNER)).status, 400);
    assert.strictEqual((await add(H.OWNER.toUpperCase())).status, 400);
    assert.strictEqual((await add('viewer@example.com')).status, 400);
    for (const bad of ['', 'nope', 'a b@example.com', 'a@b', '<x>@example.com', 'a@example.com, b@example.com']) assert.strictEqual((await add(bad)).status, 400, bad);
    assert.strictEqual((await add('x@example.test', 'e'.repeat(32))).status, 404, 'unknown client');
    assert.strictEqual((await add('client-b@example.test', C2)).status, 201);
    const rec = r2.json('pu/' + await Cm.emailHash('client-a@example.test') + '.json');
    assert.deepStrictEqual([rec.t, rec.c, rec.disabled], [T, C1, false]);
    assert.ok(!JSON.stringify(rec).includes('client-a'), 'the mapping holds no e-mail');
    assert.ok([...r2.store.keys()].every((key) => !/client-a|client-b|example|owner@/.test(key)), 'no e-mail in any key: ' + [...r2.store.keys()].filter((x) => /example|client-/.test(x)));
    assert.strictEqual((await add('client-a@example.test', C1, { disabled: true })).json.disabled, true);
    assert.strictEqual(r2.json('pu/' + await Cm.emailHash('client-a@example.test') + '.json').disabled, true);
    assert.strictEqual((await add('client-a@example.test', C1, { disabled: false })).json.disabled, false);
    // a rename (no "disabled" in the body) never re-enables a disabled person
    await add('client-a@example.test', C1, { disabled: true });
    const renamed = await add('client-a@example.test', C1, { name: 'Elena' });
    assert.strictEqual(renamed.json.disabled, true);
    assert.strictEqual(r2.json('pu/' + await Cm.emailHash('client-a@example.test') + '.json').disabled, true, 'still disabled after a rename');
    // a lost race on the mapping write is reported, never a silent "ok, disabled"
    await add('client-a@example.test', C1, { disabled: false });
    const realPut = r2.put; r2.put = async (key, body, opts) => (key.startsWith('pu/') ? null : realPut(key, body, opts));
    const raced = await add('client-a@example.test', C1, { disabled: true });
    r2.put = realPut;
    assert.strictEqual(raced.status, 409);
    assert.strictEqual(r2.json('pu/' + await Cm.emailHash('client-a@example.test') + '.json').disabled, false);
    // look-alike addresses: non-ASCII refused before lowercasing (the Kelvin sign U+212A would fold onto "k")
    assert.strictEqual((await add('\u212Aate@example.test')).status, 400);
    assert.strictEqual((await add('ana@\u0161ola.si')).status, 400);
    assert.ok(!r2.store.has('pu/' + await Cm.emailHash('kate@example.test') + '.json'));
    assert.strictEqual((await owner('DELETE', '/api/portal/users', { email: 'client-a@example.test', c: C2 })).status, 404, 'wrong client');
    assert.strictEqual((await owner('DELETE', '/api/portal/users', { email: 'client-a@example.test', c: C1 })).status, 200);
    assert.strictEqual(r2.store.has('pu/' + await Cm.emailHash('client-a@example.test') + '.json'), false);
    assert.strictEqual((await add('client-a@example.test', C2)).status, 201, 'free again');
    assert.strictEqual((await owner('DELETE', '/api/portal/users', { email: 'client-a@example.test', c: C2 })).status, 200);
    assert.strictEqual((await add('client-a@example.test')).status, 201);
  });
  await t('brand, logo (raster only, ≤ 256 KB) and news', async () => {
    assert.strictEqual((await owner('PUT', '/api/portal/brand/logo', PNG, { 'Content-Type': 'image/png' })).status, 409, 'brand first');
    assert.strictEqual((await owner('PUT', '/api/portal/brand', { name: 'Alder & Finch Studio', accent: '#1f6b4f' })).status, 200);
    assert.strictEqual((await owner('PUT', '/api/portal/brand', { name: 'X', accent: 'url(x)' })).status, 400);
    assert.strictEqual((await owner('PUT', '/api/portal/brand/logo', '<svg xmlns="http://www.w3.org/2000/svg"/>', { 'Content-Type': 'image/svg+xml' })).status, 415);
    assert.strictEqual((await owner('PUT', '/api/portal/brand/logo', Buffer.from('<svg/>'), { 'Content-Type': 'image/png' })).status, 415, 'svg disguised as png');
    assert.strictEqual((await owner('PUT', '/api/portal/brand/logo', Buffer.concat([PNG, Buffer.alloc(300 * 1024)]), { 'Content-Type': 'image/png' })).status, 413);
    assert.strictEqual((await owner('PUT', '/api/portal/brand/logo', PNG, { 'Content-Type': 'image/png' })).status, 200);
    assert.strictEqual(r2.json('p/' + T + '/brand.json').logo, true);
    assert.strictEqual((await owner('PUT', '/api/portal/brand', { name: 'Alder & Finch', accent: '#1f6b4f' })).status, 200);
    assert.strictEqual(r2.json('p/' + T + '/brand.json').logo, true, 'renaming keeps the logo flag');
    assert.strictEqual((await owner('PUT', '/api/portal/news', { items: [{ date: '2026-10-14', title: 'Studio closed 2 to 4 November', body: 'We are at a print fair.' }] })).status, 200);
    assert.strictEqual((await owner('PUT', '/api/portal/news', { items: [{ title: 'no date' }] })).status, 400);
  });
  await t('responses and audit endpoints list this tenant only; audit has no e-mail in keys', async () => {
    const q = proj().quotes[0];
    r2.store.set('p/' + T + '/c/' + C1 + '/responses/' + q.id + '.json', { bytes: Buffer.from(JSON.stringify({ decision: 'accept', at: '2026-10-17T10:00:00.000Z', quoteHash: 'h', number: q.number })), etag: 'x1', uploaded: new Date(), customMetadata: {}, httpMetadata: {} });
    r2.store.set('p/' + 'f'.repeat(32) + '/c/' + C1 + '/responses/' + q.id + '.json', { bytes: Buffer.from(JSON.stringify({ decision: 'accept', other: 'tenant' })), etag: 'x2', uploaded: new Date(), customMetadata: {}, httpMetadata: {} });
    const r = (await owner('GET', '/api/portal/responses')).json;
    assert.strictEqual(r.responses.length, 1); assert.strictEqual(r.responses[0].decision, 'accept'); assert.strictEqual(r.responses[0].c, C1);
    assert.strictEqual((await owner('GET', '/api/portal/responses?after=' + encodeURIComponent(r.last))).json.responses.length, 0);
    assert.strictEqual((await owner('GET', '/api/portal/responses?after=../../x')).status, 400);
    const a = (await owner('GET', '/api/portal/audit')).json;
    assert.ok(a.events.length >= 8, 'staff changes were logged: ' + a.events.length);
    assert.ok(a.events.every((e) => e.at && e.action && e.t === T));
    assert.ok(a.events.some((e) => e.action === 'staff.user.add' && e.result === 'refused-staff-email'));
    assert.ok([...r2.store.keys()].filter((key) => key.includes('/audit/')).every((key) => !/@|owner|example/.test(key)));
    assert.strictEqual((await owner('GET', '/api/portal/audit?day=yesterday')).status, 400);
  });
  await t('unpublish deletes the view, files, mappings and meta, keeps responses and audit', async () => {
    // a stale marker under C1 for a person who now belongs to C2 (e.g. a half-finished removal): C2's mapping must survive
    assert.strictEqual((await owner('PUT', '/api/portal/users', { email: 'moved@example.test', c: C2 })).status, 201);
    const movedHash = await Cm.emailHash('moved@example.test');
    await r2.put_json('p/' + T + '/c/' + C1 + '/users/' + movedHash + '.json', { at: 'stale' });
    const del = await owner('DELETE', '/api/portal/clients/' + C1);
    assert.strictEqual(del.status, 200); assert.strictEqual(del.json.removedUsers, 1);
    assert.deepStrictEqual([r2.json('pu/' + movedHash + '.json').t, r2.json('pu/' + movedHash + '.json').c], [T, C2], 'the other client\'s person keeps their access');
    assert.strictEqual(r2.keys('p/' + T + '/c/' + C1 + '/').filter((x) => !x.includes('/responses/')).length, 0);
    assert.strictEqual(r2.store.has('pu/' + await Cm.emailHash('client-a@example.test') + '.json'), false);
    assert.ok(r2.keys('p/' + T + '/c/' + C1 + '/responses/').length === 1);
    assert.strictEqual((await owner('DELETE', '/api/portal/clients/' + C1)).status, 404);
    assert.ok(r2.keys('p/' + T + '/c/' + C2 + '/').length > 0, 'the other client is untouched');
  });
  await t('the staff Worker still never reads the SYNC bucket for any portal call', async () => {
    assert.strictEqual(sync.touched.length, 0);
  });

  console.log('portal-staff: ' + n + ' tests passed');
  process.exit(0);
})().catch((e) => { process.stderr.write(String(e && e.stack || e) + '\n'); process.exit(1); });
