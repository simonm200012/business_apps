// Client portal Worker end to end: real staff publish (worker/index.js → portal bucket), then real portal requests
// (worker/portal.js) with real Access tokens over an in-memory R2 that records every key a portal request touches.
// Run: node tools/tests/portal-worker.test.js
'use strict';
const assert = require('assert');
const H = require('./_portal-harness');
const P = require('../../site/billing/portal-projection.js');
const { buildDemoState } = require('../portal-demo-state.js');

let n = 0;
async function t(name, fn) { await fn(); n++; console.log('ok', n, name); }
const CA = 'a'.repeat(32), CB = 'b'.repeat(32), CX = 'c'.repeat(32);
const FA = '1'.repeat(32), FB = '2'.repeat(32), FX = '3'.repeat(32);
const PDF = (s) => Buffer.from('%PDF-1.4\n' + s + '\n');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
const ORIGIN = 'https://portal.example';
const A = 'client-a@example.test', B = 'client-b@example.test', X = 'client-x@example.test', U = 'nobody@example.test';

(async function main() {
  const realErr = console.error; console.error = () => {}; console.log = ((l) => (...a) => { if (/^ok |tests passed/.test(String(a[0]))) l(...a); })(console.log);
  const staff = (await H.imp('worker/index.js')).default, portal = (await H.imp('worker/portal.js')).default;
  const Cm = await H.imp('worker/portal-common.js');
  const k = await H.setupKeys();
  const r2 = H.makeR2();
  const OTHER_OWNER = 'other-owner@example.com';
  const staffEnv = (owner) => ({ ACCESS_TEAM_DOMAIN: H.TEAM, ACCESS_AUD: H.STAFF_AUD, PORTAL_ACCESS_AUD: H.PORTAL_AUD, OWNER_EMAIL: owner, SYNC: H.makeR2(), PORTAL: r2, ASSETS: null });
  const hits = { read: 0, download: 0, decide: 0 }, limits = { read: Infinity, download: Infinity, decide: Infinity };
  const rl = (name) => ({ async limit() { hits[name]++; return { success: hits[name] <= limits[name] }; } });
  const clock = { now: new Date('2026-10-17T09:00:00Z') };
  const penv = { ACCESS_TEAM_DOMAIN: H.TEAM, ACCESS_AUD: H.STAFF_AUD, PORTAL_ACCESS_AUD: H.PORTAL_AUD, PORTAL_ORIGIN: ORIGIN, PORTAL: r2, ASSETS: null,
    RL_READ: rl('read'), RL_DOWNLOAD: rl('download'), RL_DECIDE: rl('decide'), __now: () => clock.now };
  const tokenOf = {};
  for (const e of [A, B, X, U]) tokenOf[e] = await k.portalToken(e);

  const owner = async (env, ownerEmail, method, p, body, headers = {}) => {
    const h = new Headers({ 'X-Stratum-Apps': '1', 'Cf-Access-Jwt-Assertion': await k.staffToken(ownerEmail), ...headers });
    let b = body; if (body !== undefined && typeof body === 'object' && !Buffer.isBuffer(body)) { b = JSON.stringify(body); h.set('Content-Type', 'application/json'); }
    const r = await staff.fetch(new Request('https://apps.example' + p, { method, headers: h, body: b }), env);
    const text = await r.text(); if (r.status >= 400) throw new Error('seed ' + method + ' ' + p + ' → ' + r.status + ' ' + text);
    return JSON.parse(text);
  };
  const senv = staffEnv(H.OWNER), senv2 = staffEnv(OTHER_OWNER);
  const T1 = await Cm.tenantOf(H.OWNER), T2 = await Cm.tenantOf(OTHER_OWNER);
  assert.notStrictEqual(T1, T2);
  const state = buildDemoState('alder', { sentinel: true }), state2 = buildDemoState('harbor', { sentinel: true });
  const find = (s, num) => s.invoices.find((i) => i.number === num).id;

  // ---- seed: tenant 1 has clients A and B (and brand, news, logo), tenant 2 has client X --------------------------------------------
  const pub = async (env, ownerEmail, c, billingId, billingState, fidByInvoice, fileBytes, extraDocs) => {
    const name = billingState.clients.find((x) => x.id === billingId).name;
    await owner(env, ownerEmail, 'PUT', '/api/portal/clients/' + c, { name, billingId });
    for (const [fid, bytes] of Object.entries(fileBytes)) await owner(env, ownerEmail, 'PUT', '/api/portal/clients/' + c + '/files/' + fid, bytes, { 'Content-Type': 'application/pdf' });
    const view = P.buildProjection(billingState, billingId, { today: '2026-10-17', pdfs: fidByInvoice, documents: extraDocs });
    return owner(env, ownerEmail, 'PUT', '/api/portal/clients/' + c + '/view', view);
  };
  await pub(senv, H.OWNER, CA, 'cl-lindgren', state, { [find(state, 'INV-2026-0005')]: FA }, { [FA]: PDF('A-invoice'), ['4'.repeat(32)]: PDF('A-doc') },
    [{ id: '4'.repeat(32), name: 'Brand guidelines v3.pdf', size: 4400000, type: 'application/pdf', sharedAt: '2026-10-09' }]);
  await pub(senv, H.OWNER, CB, 'cl-birch', state, { [find(state, 'INV-2026-0004')]: FB }, { [FB]: PDF('B-secret-invoice') }, []);
  await pub(senv2, OTHER_OWNER, CX, 'cl-north', state2, { [find(state2, 'HL-2026-0002')]: FX }, { [FX]: PDF('X-secret-invoice') }, []);
  await owner(senv, H.OWNER, 'PUT', '/api/portal/brand', { name: 'Alder & Finch Studio', accent: '#1f6b4f' });
  await owner(senv, H.OWNER, 'PUT', '/api/portal/brand/logo', PNG, { 'Content-Type': 'image/png' });
  await owner(senv, H.OWNER, 'PUT', '/api/portal/news', { items: [{ date: '2026-10-14', title: 'Studio closed 2 to 4 November', body: 'Print fair.' }] });
  await owner(senv2, OTHER_OWNER, 'PUT', '/api/portal/brand', { name: 'Harbor Light Studio', accent: '#1d4e89' });
  await owner(senv, H.OWNER, 'PUT', '/api/portal/users', { email: A, c: CA, name: 'Elena' });
  await owner(senv, H.OWNER, 'PUT', '/api/portal/users', { email: B, c: CB });
  await owner(senv2, OTHER_OWNER, 'PUT', '/api/portal/users', { email: X, c: CX });
  const aView = P.buildProjection(state, 'cl-lindgren', { today: '2026-10-17' });
  const QA = aView.quotes.find((q) => q.kind === 'quote' && q.status === 'open' && q.totals.total === 480000).id;
  const QA_PRO = aView.quotes.find((q) => q.kind === 'proforma').id, QA_EXP = aView.quotes.find((q) => q.status === 'expired').id;
  const QB = P.buildProjection(state, 'cl-birch', { today: '2026-10-17' }).quotes[0].id;

  const ALLOWED = (c, t1) => [new RegExp('^pu/[a-f0-9]{64}\\.json$'), new RegExp('^p/' + t1 + '/c/' + c + '/'), new RegExp('^p/' + t1 + '/(brand\\.json|brand/logo|news\\.json|audit/)')];
  const call = async (email, method, p, { body, headers = {}, tok, host = 'portal.example', noToken } = {}) => {
    const h = new Headers(headers);
    if (!noToken) h.set('Cf-Access-Jwt-Assertion', tok || tokenOf[email]);
    r2.reset();
    const r = await portal.fetch(new Request('https://' + host + p, { method, headers: h, body }), penv);
    const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, json: j, text, headers: r.headers, touched: r2.touched.slice(), ops: r2.ops.slice() };
  };
  const guard = (res, c, t1, label) => { const ok = ALLOWED(c, t1); for (const key of res.touched) assert.ok(ok.some((re) => re.test(key)), (label || '') + ' touched outside the caller\'s prefix: ' + key); };
  const decide = (email, qid, body, { origin = ORIGIN, extra = {}, raw } = {}) => call(email, 'POST', '/api/quotes/' + qid + '/decision', { body: raw !== undefined ? raw : JSON.stringify(body),
    headers: { Origin: origin, 'Sec-Fetch-Site': 'same-origin', 'X-Portal': '1', 'Content-Type': 'application/json', ...extra } });
  const hashOf = (view, qid) => view.quotes.find((q) => q.id === qid).hash;

  await t('tokens: the whole matrix on the portal (401 for everything wrong, 503 when Access is not configured or unreachable)', async () => {
    const get = (tok, o = {}) => call(A, 'GET', '/api/me', { tok, noToken: tok === null, ...o });
    assert.strictEqual((await get(null)).status, 401);
    assert.strictEqual((await get('garbage')).status, 401);
    assert.strictEqual((await get(await k.portalToken(A, { alg: 'none' }))).status, 401);
    assert.strictEqual((await get(await k.portalToken(A, { alg: 'HS256' }))).status, 401);
    assert.strictEqual((await get(await k.portalToken(A, { kid: 'nope' }))).status, 401);
    assert.strictEqual((await get(await k.portalToken(A, { key: { privateKey: k.otherKey.privateKey } }))).status, 401);
    assert.strictEqual((await get(await k.portalToken(A, { expIn: -5 }))).status, 401);
    assert.strictEqual((await get(await k.portalToken(A, { nbf: Math.floor(Date.now() / 1000) + 3600 }))).status, 401);
    assert.strictEqual((await get(await k.portalToken(A, { iss: 'https://evil.example' }))).status, 401);
    assert.strictEqual((await get(await k.portalToken(null, { noEmail: true }))).status, 401, 'service token without e-mail');
    assert.strictEqual((await get(await k.staffToken(A))).status, 401, 'a staff-audience token');
    assert.strictEqual((await get(await k.token(A, { aud: [H.PORTAL_AUD, H.STAFF_AUD] }))).status, 401, 'both audiences');
    assert.strictEqual((await get(await k.staffToken(H.OWNER))).status, 401, 'even the owner with a staff token');
    for (const [m, p] of [['GET', '/api/view'], ['GET', '/api/files/' + FA], ['GET', '/api/brand/logo'], ['POST', '/api/quotes/' + QA + '/decision'], ['POST', '/api/logout'], ['GET', '/api/whatever']]) assert.strictEqual((await call(A, m, p, { noToken: true })).status, 401, m + ' ' + p);
    const mixed = await get(await k.portalToken('Client-A@EXAMPLE.test'));
    assert.strictEqual(mixed.status, 200, 'mixed-case e-mail finds the mapping');
    const real = penv.PORTAL_ACCESS_AUD;
    penv.PORTAL_ACCESS_AUD = ''; assert.strictEqual((await get()).status, 503); penv.PORTAL_ACCESS_AUD = real;
    const team = penv.ACCESS_TEAM_DOMAIN; penv.ACCESS_TEAM_DOMAIN = ''; assert.strictEqual((await get()).status, 503); penv.ACCESS_TEAM_DOMAIN = team;
    k.certsOk = false;
    assert.strictEqual((await get(await k.portalToken(A, { kid: 'unseen-kid' }))).status, 503, 'certs unavailable');
    k.certsOk = true;
    assert.strictEqual((await get()).status, 200);
  });
  await t('mapping: unmapped 403, disabled 403, removed → 403 on the next request, unpublished → 404, owner and staff addresses cannot be mapped', async () => {
    const un = await call(U, 'GET', '/api/view'); assert.strictEqual(un.status, 403);
    assert.ok(!un.touched.some((x) => x.startsWith('p/')), 'an unmapped person reads nothing but their own mapping key');
    for (const p of ['/api/me', '/api/files/' + FA, '/api/brand/logo']) assert.strictEqual((await call(U, 'GET', p)).status, 403, p);
    assert.strictEqual((await decide(U, QA, { decision: 'accept', quoteHash: 'a'.repeat(64) })).status, 403);
    // disabled
    await owner(senv, H.OWNER, 'PUT', '/api/portal/users', { email: B, c: CB, disabled: true });
    assert.strictEqual((await call(B, 'GET', '/api/view')).status, 403);
    await owner(senv, H.OWNER, 'PUT', '/api/portal/users', { email: B, c: CB, disabled: false });
    assert.strictEqual((await call(B, 'GET', '/api/view')).status, 200);
    // removed
    await owner(senv, H.OWNER, 'DELETE', '/api/portal/users', { email: B, c: CB });
    assert.strictEqual((await call(B, 'GET', '/api/view')).status, 403);
    await owner(senv, H.OWNER, 'PUT', '/api/portal/users', { email: B, c: CB });
    // unpublished client: the mapping can survive in odd cases (view deleted by hand) → 404, never data
    const saved = r2.store.get('p/' + T1 + '/c/' + CB + '/view.json'); r2.store.delete('p/' + T1 + '/c/' + CB + '/view.json');
    assert.strictEqual((await call(B, 'GET', '/api/view')).status, 404);
    r2.store.set('p/' + T1 + '/c/' + CB + '/view.json', saved);
    assert.strictEqual((await call(B, 'GET', '/api/view')).status, 200);
  });
  await t('a look-alike e-mail (Kelvin sign U+212A, which toLowerCase() folds to "k") never lands on a mapped person', async () => {
    await owner(senv, H.OWNER, 'PUT', '/api/portal/users', { email: 'kate@example.test', c: CA });
    assert.strictEqual((await call(null, 'GET', '/api/view', { tok: await k.portalToken('kate@example.test') })).status, 200, 'the real person');
    const look = await call(null, 'GET', '/api/view', { tok: await k.portalToken('\u212Aate@example.test') });
    assert.strictEqual(look.status, 401, 'the look-alike is refused at the token check');
    assert.strictEqual(look.touched.length, 0, 'and reads nothing');
    await owner(senv, H.OWNER, 'DELETE', '/api/portal/users', { email: 'kate@example.test', c: CA });
  });
  await t('A sees exactly A: the view has A\'s data, brand and news, and never B\'s, X\'s or anything private', async () => {
    const r = await call(A, 'GET', '/api/view'); assert.strictEqual(r.status, 200);
    guard(r, CA, T1, 'view');
    const s = r.text;
    assert.ok(!/Birch|Packaging|Seasonal|Northwind|Harbor|HL-2026|SENTINEL|INV-2026-0004|elena@|example\.com/.test(s), 'no other client, other tenant, sentinel or e-mail: ' + (s.match(/Birch|Packaging|Seasonal|Northwind|Harbor|SENTINEL/) || ''));
    assert.deepStrictEqual(r.json.invoices.map((i) => i.number), ['INV-2026-0005', 'INV-2026-0003', 'INV-2026-0002', 'INV-2026-0001']);
    assert.deepStrictEqual(r.json.brand, { name: 'Alder & Finch Studio', accent: '#1f6b4f', logo: true });
    assert.strictEqual(r.json.news[0].title, 'Studio closed 2 to 4 November');
    assert.strictEqual(r.json.client.name, 'Lindgren Café');
    assert.strictEqual(r.headers.get('Cache-Control'), 'private, no-store');
    assert.strictEqual(r.headers.get('Access-Control-Allow-Origin'), null);
    assert.ok(r.json.quotes.find((q) => q.id === QA).canDecide && !r.json.quotes.find((q) => q.id === QA_PRO).canDecide && !r.json.quotes.find((q) => q.id === QA_EXP).canDecide);
    const me = await call(A, 'GET', '/api/me'); assert.deepStrictEqual(me.json, { name: 'Elena', client: 'Lindgren Café' }); guard(me, CA, T1, 'me');
    // tenant 2 renders another company
    const x = await call(X, 'GET', '/api/view'); guard(x, CX, T2, 'x view');
    assert.deepStrictEqual(x.json.brand, { name: 'Harbor Light Studio', accent: '#1d4e89', logo: false });
    assert.ok(!/Alder|Lindgren|Elena/.test(x.text));
    assert.deepStrictEqual((await call(B, 'GET', '/api/view')).json.brand.name, 'Alder & Finch Studio', 'B shares A\'s company brand but not A\'s data');
  });
  await t('effective status is computed on read: a quote past its date is expired, an unpaid invoice past its due date is overdue', async () => {
    clock.now = new Date('2026-11-02T09:00:00Z');
    const r = await call(A, 'GET', '/api/view');
    assert.strictEqual(r.json.quotes.find((q) => q.id === QA).status, 'expired');
    assert.strictEqual(r.json.quotes.find((q) => q.id === QA).canDecide, false);
    assert.strictEqual(r.json.invoices.find((i) => i.number === 'INV-2026-0005').status, 'overdue');
    assert.strictEqual(r.json.invoices.find((i) => i.number === 'INV-2026-0002').status, 'paid');
    clock.now = new Date('2026-10-17T09:00:00Z');
  });
  await t('downloads: own files only (the id must be listed in the caller\'s view); the same 404 for not-yours and not-existing; safe headers', async () => {
    const ok = await call(A, 'GET', '/api/files/' + FA);
    assert.strictEqual(ok.status, 200); assert.ok(ok.text.startsWith('%PDF')); guard(ok, CA, T1, 'download');
    assert.strictEqual(ok.headers.get('Content-Disposition'), "attachment; filename*=UTF-8''INV-2026-0005.pdf");
    assert.strictEqual(ok.headers.get('Content-Type'), 'application/pdf');
    assert.strictEqual(ok.headers.get('Content-Security-Policy'), "default-src 'none'; sandbox");
    assert.strictEqual(ok.headers.get('Cache-Control'), 'private, no-store'); assert.strictEqual(ok.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.strictEqual((await call(A, 'GET', '/api/files/' + '4'.repeat(32))).headers.get('Content-Disposition'), "attachment; filename*=UTF-8''Brand%20guidelines%20v3.pdf");
    const notYours = await call(A, 'GET', '/api/files/' + FB), tenant = await call(A, 'GET', '/api/files/' + FX), missing = await call(A, 'GET', '/api/files/' + '9'.repeat(32));
    for (const r of [notYours, tenant, missing]) { assert.strictEqual(r.status, 404); guard(r, CA, T1, 'denied'); assert.ok(!/secret/.test(r.text)); }
    assert.strictEqual(notYours.text, missing.text, 'identical answers');
    // B downloads A's real id
    const b = await call(B, 'GET', '/api/files/' + FA); assert.strictEqual(b.status, 404); assert.ok(!b.text.includes('A-invoice')); guard(b, CB, T1, 'B');
    // the object exists in A's folder but is not listed in A's view → still refused
    r2.store.set('p/' + T1 + '/c/' + CA + '/files/' + '7'.repeat(32), { bytes: PDF('unlisted'), etag: 'u1', uploaded: new Date(), customMetadata: {}, httpMetadata: { contentType: 'application/pdf' } });
    assert.strictEqual((await call(A, 'GET', '/api/files/' + '7'.repeat(32))).status, 404);
    assert.strictEqual((await call(A, 'GET', '/api/brand/logo')).headers.get('Content-Type'), 'image/png');
    assert.strictEqual((await call(X, 'GET', '/api/brand/logo')).status, 404, 'a company without a logo');
  });
  await t('client ids in query, body and headers are ignored: nothing outside the caller\'s prefix is ever touched', async () => {
    const evil = { 'X-Client-Id': CB, 'X-Tenant': T2, 'X-Forwarded-For': '1.2.3.4', Cookie: 'c=' + CB + '; t=' + T2 };
    const qs = '?c=' + CB + '&clientId=' + CB + '&t=' + T2 + '&tenant=' + T2 + '&email=' + B + '&as=' + B;
    for (const p of ['/api/view', '/api/me', '/api/brand/logo', '/api/files/' + FA]) {
      const r = await call(A, 'GET', p + qs, { headers: evil });
      assert.ok(r.status === 200, p + ' ' + r.status); guard(r, CA, T1, p);
      if (p === '/api/view') assert.ok(!/Birch|Northwind/.test(r.text));
    }
    const d = await decide(A, QB, { decision: 'accept', quoteHash: 'a'.repeat(64), clientId: CB, c: CB, t: T1 }, { extra: evil });
    assert.strictEqual(d.status, 404); guard(d, CA, T1, 'decide B quote');
    assert.ok(!r2.keys('p/' + T1 + '/c/' + CB + '/responses/').length, 'B\'s responses untouched');
  });
  await t('traversal and bad formats: fid and quote id with ../, encodings, NUL, unicode, upper case, long, trailing junk → 400/404, never outside the prefix', async () => {
    const bads = ['../' + FB, '..%2f' + FB, '%2e%2e/' + FB, '%2e%2e%2f' + FB, '..%5c' + FB, '%2F' + FB, '%5C' + FB, '%252e%252e%252f' + FB, FA + '%00', FA + '%0a', FA + '%20', FA + 'x', FA + '.pdf', FA + '/', FA.toUpperCase().replace(/1/g, 'A'),
      '%EF%BC%8E%EF%BC%8E', '%E2%80%AEfdp', 'a'.repeat(33), 'a'.repeat(5000), '', '.', '..', FA.slice(1), '%', '%zz', 'p/' + T1 + '/c/' + CB + '/files/' + FB, '*', '?', '#'];
    for (const b of bads) {
      for (const [m, p] of [['GET', '/api/files/' + b], ['POST', '/api/quotes/' + b + '/decision']]) {
        const r = m === 'GET' ? await call(A, m, p) : await decide(A, b, { decision: 'accept', quoteHash: 'a'.repeat(64) });
        assert.ok([400, 404, 405].includes(r.status), m + ' ' + p.slice(0, 60) + ' → ' + r.status);
        guard(r, CA, T1, m + ' ' + b.slice(0, 40));
        assert.ok(!r.touched.some((x) => /files\/|responses\//.test(x) && !x.startsWith('p/' + T1 + '/c/' + CA + '/')));
      }
    }
    assert.ok(!r2.keys('p/' + T1 + '/c/' + CA + '/responses/').length, 'no response was stored by any of these');
  });
  await t('routes: unknown paths 404, wrong methods 405 (no CORS headers, ever), preflight gets nothing', async () => {
    for (const p of ['/api', '/api/', '/api/admin', '/api/portal/clients', '/api/sync/billing', '/api/ws', '/api/files', '/api/files/', '/api/quotes', '/api/quotes/x', '/api/view/x']) assert.strictEqual((await call(A, 'GET', p)).status, 404, p);
    for (const [m, p] of [['POST', '/api/view'], ['PUT', '/api/me'], ['DELETE', '/api/files/' + FA], ['GET', '/api/quotes/' + QA + '/decision'], ['PUT', '/api/quotes/' + QA + '/decision'], ['GET', '/api/logout'], ['PATCH', '/api/view']]) {
      const r = await call(A, m, p); assert.strictEqual(r.status, 405, m + ' ' + p);
    }
    const pre = await call(A, 'OPTIONS', '/api/quotes/' + QA + '/decision', { headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'x-portal,content-type' } });
    assert.ok(![...pre.headers.keys()].some((h) => /^access-control-/i.test(h)), 'no CORS headers');
    const lo = await call(A, 'POST', '/api/logout'); assert.deepStrictEqual(lo.json, { ok: true, redirect: '/cdn-cgi/access/logout' });
  });
  await t('decision: accept an open quote → 200; replay → 200 and one write; opposite → 409', async () => {
    const hash = hashOf((await call(A, 'GET', '/api/view')).json, QA);
    const first = await decide(A, QA, { decision: 'accept', quoteHash: hash, comment: 'Looks good, thank you.' });
    assert.strictEqual(first.status, 200, first.text); assert.strictEqual(first.json.decision, 'accept'); guard(first, CA, T1, 'decision');
    const stored = r2.json('p/' + T1 + '/c/' + CA + '/responses/' + QA + '.json');
    assert.deepStrictEqual([stored.decision, stored.quoteHash, stored.number, stored.total, stored.email], ['accept', hash, 'Q-2026-0001', 480000, A]);
    assert.ok(/^2026-10-17T09:00:00/.test(stored.at), 'server time, not the client\'s');
    const puts = () => r2.ops.filter(([op, key]) => op === 'put' && key.includes('/responses/')).length;
    const again = await decide(A, QA, { decision: 'accept', quoteHash: hash }); assert.strictEqual(again.status, 200); assert.strictEqual(again.json.replay, true);
    assert.strictEqual(r2.json('p/' + T1 + '/c/' + CA + '/responses/' + QA + '.json').comment, 'Looks good, thank you.', 'the replay did not overwrite');
    assert.strictEqual(again.ops.filter(([op, key]) => op === 'put' && key.includes('/responses/')).length, 0);
    const opposite = await decide(A, QA, { decision: 'decline', quoteHash: hash }); assert.strictEqual(opposite.status, 409);
    assert.strictEqual(r2.json('p/' + T1 + '/c/' + CA + '/responses/' + QA + '.json').decision, 'accept');
    const v = (await call(A, 'GET', '/api/view')).json.quotes.find((q) => q.id === QA);
    assert.deepStrictEqual([v.response.decision, v.canDecide, v.status], ['accept', false, 'open']);
    // B sees nothing of it
    assert.ok(!/accept/.test((await call(B, 'GET', '/api/view')).text));
  });
  await t('decision: refused for proforma, expired (fake clock), stale hash, unknown quote, other client\'s quote', async () => {
    const view = (await call(A, 'GET', '/api/view')).json, h = (id) => hashOf(view, id);
    assert.strictEqual((await decide(A, QA_PRO, { decision: 'accept', quoteHash: h(QA_PRO) })).status, 409, 'proforma');
    assert.strictEqual((await decide(A, QA_EXP, { decision: 'accept', quoteHash: h(QA_EXP) })).status, 409, 'published as expired');
    assert.strictEqual((await decide(A, '00000000-0000-0000-0000-000000000000', { decision: 'accept', quoteHash: 'a'.repeat(64) })).status, 404);
    assert.strictEqual((await decide(A, QB, { decision: 'accept', quoteHash: 'a'.repeat(64) })).status, 404, 'B\'s quote');
    assert.strictEqual((await decide(B, QA, { decision: 'accept', quoteHash: h(QA) })).status, 404, 'A\'s quote, by B');
    // a second open quote in A's view for the other cases: use fake edits through a fresh publish
    const edit = JSON.parse(JSON.stringify(P.buildProjection(state, 'cl-lindgren', { today: '2026-10-17', pdfs: { [find(state, 'INV-2026-0005')]: FA }, documents: [{ id: '4'.repeat(32), name: 'Brand guidelines v3.pdf', size: 4400000, type: 'application/pdf', sharedAt: '2026-10-09' }] })));
    const q2 = edit.quotes.find((q) => q.kind === 'quote' && q.status === 'open'); q2.id = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'; q2.number = 'Q-2026-0090'; q2.validUntil = '2026-10-20';
    const etag = r2.store.get('p/' + T1 + '/c/' + CA + '/view.json').etag;
    await owner(senv, H.OWNER, 'PUT', '/api/portal/clients/' + CA + '/view?base=' + encodeURIComponent(etag), edit);
    const v2 = (await call(A, 'GET', '/api/view')).json, Q2 = q2.id;
    assert.strictEqual((await decide(A, Q2, { decision: 'accept', quoteHash: 'f'.repeat(64) })).status, 409, 'stale hash');
    assert.ok(!r2.store.has('p/' + T1 + '/c/' + CA + '/responses/' + Q2 + '.json'));
    clock.now = new Date('2026-10-21T09:00:00Z'); // the day after validUntil
    assert.strictEqual((await decide(A, Q2, { decision: 'accept', quoteHash: hashOf(v2, Q2) })).status, 409, 'expired');
    clock.now = new Date('2026-10-20T22:30:00Z'); // 00:30 on the 21st in Ljubljana: already expired there
    assert.strictEqual((await decide(A, Q2, { decision: 'accept', quoteHash: hashOf(v2, Q2) })).status, 409, 'expiry uses Slovenian time');
    clock.now = new Date('2026-10-20T21:30:00Z'); // 23:30 on the 20th: last valid day
    assert.strictEqual((await decide(A, Q2, { decision: 'decline', quoteHash: hashOf(v2, Q2), comment: 'No.' })).status, 200);
    clock.now = new Date('2026-10-17T09:00:00Z');
    // accepted / declined / invoiced quotes: re-publish with those statuses → 409 for a first answer
    for (const status of ['accepted', 'declined', 'invoiced']) {
      const e = JSON.parse(JSON.stringify(edit)); const q3 = e.quotes.find((q) => q.id === Q2); q3.id = '00000000-0000-4000-8000-00000000000' + status.length; q3.status = status; q3.number = 'Q-X' + status;
      const et = r2.store.get('p/' + T1 + '/c/' + CA + '/view.json').etag;
      await owner(senv, H.OWNER, 'PUT', '/api/portal/clients/' + CA + '/view?base=' + encodeURIComponent(et), e);
      const vv = (await call(A, 'GET', '/api/view')).json;
      assert.strictEqual((await decide(A, q3.id, { decision: 'accept', quoteHash: hashOf(vv, q3.id) })).status, 409, status);
    }
  });
  await t('decision: header, origin, content-type, size and body checks', async () => {
    const edit0 = (await call(A, 'GET', '/api/view')).json;
    const open = edit0.quotes.find((q) => q.canDecide);
    // re-open a fresh quote id for these checks
    const e = JSON.parse(JSON.stringify(P.buildProjection(state, 'cl-lindgren', { today: '2026-10-17', pdfs: { [find(state, 'INV-2026-0005')]: FA }, documents: [{ id: '4'.repeat(32), name: 'Brand guidelines v3.pdf', size: 4400000, type: 'application/pdf', sharedAt: '2026-10-09' }] })));
    const q = e.quotes.find((x) => x.kind === 'quote' && x.status === 'open'); q.id = 'dddddddd-0000-4000-8000-000000000001'; q.number = 'Q-2026-0091';
    await owner(senv, H.OWNER, 'PUT', '/api/portal/clients/' + CA + '/view?base=' + encodeURIComponent(r2.store.get('p/' + T1 + '/c/' + CA + '/view.json').etag), e);
    const Q = q.id, hash = hashOf((await call(A, 'GET', '/api/view')).json, Q), body = { decision: 'accept', quoteHash: hash };
    const stored = () => r2.store.has('p/' + T1 + '/c/' + CA + '/responses/' + Q + '.json');
    assert.strictEqual((await decide(A, Q, body, { extra: { 'X-Portal': '' } })).status, 400, 'no X-Portal');
    const noHeader = await call(A, 'POST', '/api/quotes/' + Q + '/decision', { body: JSON.stringify(body), headers: { Origin: ORIGIN, 'Content-Type': 'application/json' } }); assert.strictEqual(noHeader.status, 400);
    assert.strictEqual((await decide(A, Q, body, { origin: 'https://evil.example' })).status, 403, 'wrong origin');
    assert.strictEqual((await decide(A, Q, body, { origin: ORIGIN + '.evil.example' })).status, 403);
    assert.strictEqual((await decide(A, Q, body, { origin: 'null' })).status, 403);
    const noOrigin = await call(A, 'POST', '/api/quotes/' + Q + '/decision', { body: JSON.stringify(body), headers: { 'X-Portal': '1', 'Content-Type': 'application/json' } }); assert.strictEqual(noOrigin.status, 403);
    assert.strictEqual((await decide(A, Q, body, { extra: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403, 'cross-site');
    assert.strictEqual((await decide(A, Q, body, { extra: { 'Sec-Fetch-Site': 'same-site' } })).status, 403);
    assert.strictEqual((await decide(A, Q, body, { extra: { 'Content-Type': 'text/plain' } })).status, 415);
    assert.strictEqual((await decide(A, Q, body, { extra: { 'Content-Type': 'application/x-www-form-urlencoded' } })).status, 415);
    assert.strictEqual((await decide(A, Q, null, { raw: JSON.stringify({ ...body, comment: 'x'.repeat(3000) }) })).status, 413, '3 KB body');
    assert.strictEqual((await decide(A, Q, { decision: 'accept', quoteHash: hash, comment: 'x'.repeat(1500) })).status, 200, 'a 1.5 KB comment is cut to 500, not refused');
    assert.strictEqual(r2.json('p/' + T1 + '/c/' + CA + '/responses/' + Q + '.json').comment.length, 500);
    assert.ok(stored());
    r2.store.delete('p/' + T1 + '/c/' + CA + '/responses/' + Q + '.json');
    for (const raw of ['{', '[]', 'null', '"x"', JSON.stringify({ decision: 'maybe', quoteHash: hash }), JSON.stringify({ decision: 'accept' }), JSON.stringify({ decision: 'accept', quoteHash: 'xyz' }), JSON.stringify({ decision: 'accept', quoteHash: hash, comment: 5 }), JSON.stringify({ decision: ['accept'], quoteHash: hash })]) assert.strictEqual((await decide(A, Q, null, { raw })).status, 400, raw);
    assert.ok(!stored(), 'none of the refused requests stored anything');
    // two at once: exactly one stored, both answered 200 (same decision), one with replay
    r2.putDelay = 15;
    const both = await Promise.all([decide(A, Q, body), decide(A, Q, body)]);
    r2.putDelay = 0;
    assert.deepStrictEqual(both.map((r) => r.status), [200, 200]);
    assert.strictEqual(both.filter((r) => r.json.replay).length, 1, 'one created it, one replayed');
    assert.ok(stored());
    r2.store.delete('p/' + T1 + '/c/' + CA + '/responses/' + Q + '.json'); r2.putDelay = 15;
    const mixed = await Promise.all([decide(A, Q, body), decide(A, Q, { ...body, decision: 'decline' })]);
    r2.putDelay = 0;
    assert.deepStrictEqual(mixed.map((r) => r.status).sort(), [200, 409], 'opposite decisions at once: exactly one wins');
  });
  await t('rate limits: reads, downloads and decisions answer 429 (and are audited); decisions fail closed without a binding; reads do not', async () => {
    hits.read = 0; limits.read = 2;
    const rs = []; for (let i = 0; i < 4; i++) rs.push((await call(A, 'GET', '/api/me')).status);
    assert.deepStrictEqual(rs, [200, 200, 429, 429]); limits.read = Infinity;
    hits.download = 0; limits.download = 1;
    assert.deepStrictEqual([(await call(A, 'GET', '/api/files/' + FA)).status, (await call(A, 'GET', '/api/files/' + FA)).status], [200, 429]); limits.download = Infinity;
    hits.decide = 0; limits.decide = 0;
    const d = await decide(A, QA, { decision: 'accept', quoteHash: 'a'.repeat(64) }); assert.strictEqual(d.status, 429); assert.strictEqual(d.headers.get('Retry-After'), '60'); limits.decide = Infinity;
    const day = (await owner(senv, H.OWNER, 'GET', '/api/portal/audit?day=2026-10-17')).events;
    assert.ok(day.filter((e) => e.action === 'rate-limited').length >= 3);
    const saved = penv.RL_DECIDE; delete penv.RL_DECIDE;
    assert.strictEqual((await decide(A, QA, { decision: 'accept', quoteHash: 'a'.repeat(64) })).status, 503, 'no binding in production → refused');
    assert.strictEqual((await call(A, 'GET', '/api/view')).status, 200, 'reads still work');
    penv.RL_DECIDE = saved;
    assert.ok((await call(A, 'GET', '/api/view')).touched.every((x) => !/audit\/.*rate/.test(x)));
  });
  await t('audit: sign-in once a day per person, downloads, decisions, denied ids, rate limits; no e-mail in any key; none readable by the portal', async () => {
    const events = (await owner(senv, H.OWNER, 'GET', '/api/portal/audit?day=2026-10-17')).events;
    const acts = new Set(events.map((e) => e.action));
    for (const a of ['signin', 'file.download', 'file.denied', 'quote.decision', 'rate-limited', 'staff.view.publish']) assert.ok(acts.has(a), 'audited: ' + a + ' (got ' + [...acts] + ')');
    assert.strictEqual(events.filter((e) => e.action === 'signin' && e.email === A).length, 1, 'one sign-in entry per person per day');
    assert.ok(events.every((e) => e.at && e.t === T1 && typeof e.result === 'string'));
    assert.ok(r2.keys().filter((key) => key.includes('/audit/')).every((key) => !/@|example|client-/.test(key)));
    assert.ok(events.filter((e) => e.action === 'quote.decision').every((e) => e.target));
    // no portal route can read the audit prefix back
    for (const p of ['/api/audit', '/api/portal/audit', '/api/files/audit']) assert.ok([404].includes((await call(A, 'GET', p)).status));
  });
  await t('DEV_BYPASS in the portal: cookie e-mail on localhost only (mapping still applies), 500 for every request anywhere else', async () => {
    const dev = { ...penv, DEV_BYPASS: '1' }; /* PORTAL_ORIGIN stays set, as in wrangler.portal.jsonc */ const old = Object.assign({}, penv);
    const go = async (host, cookie, method = 'GET', p = '/api/view', extra = {}) => { r2.reset(); return portal.fetch(new Request('http://' + host + p, { method, headers: { ...(cookie ? { Cookie: 'portal_dev_as=' + encodeURIComponent(cookie) } : {}), ...extra } }), dev); };
    assert.strictEqual((await go('localhost:8788', A)).status, 200);
    const b = await (await go('localhost:8788', B)).json(); assert.ok(!/Lindgren/.test(JSON.stringify(b)) && /Birch/.test(JSON.stringify(b)), 'the cookie picks the person; mapping decides the data');
    assert.strictEqual((await go('127.0.0.1:8788', null)).status, 200, 'the default dev person is client-a@example.test');
    assert.strictEqual((await go('localhost:8788', U)).status, 403, 'unmapped');
    assert.strictEqual((await go('localhost:8788', 'not an email')).status, 400);
    for (const host of ['portal.example', 'business-apps-portal.workers.dev', 'localhost.evil.example', '127.0.0.1.evil.example', 'evil.localhost.example']) {
      assert.strictEqual((await go(host, A)).status, 500, host);
      assert.strictEqual((await go(host, A, 'POST', '/api/logout')).status, 500, host + ' logout');
    }
    assert.strictEqual((await portal.fetch(new Request('https://portal.example/api/me'), { ...penv, DEV_BYPASS: 'true' })).status, 500);
    // a decision from the dev page works without PORTAL_ORIGIN (same origin) and without a rate-limit binding
    const vw = await (await go('localhost:8788', B)).json(); const open = vw.quotes.find((q) => q.canDecide);
    const dd = await portal.fetch(new Request('http://localhost:8788/api/quotes/' + open.id + '/decision', { method: 'POST', headers: { Cookie: 'portal_dev_as=' + B, Origin: 'http://localhost:8788', 'X-Portal': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ decision: 'accept', quoteHash: open.hash }) }), { ...dev, RL_DECIDE: undefined });
    assert.strictEqual(dd.status, 200);
    // a real deployed host without a token is never rescued by a cookie
    const noDev = await portal.fetch(new Request('https://portal.example/api/view', { headers: { Cookie: 'portal_dev_as=' + A } }), penv);
    assert.strictEqual(noDev.status, 401);
  });
  await t('the portal Worker config has no SYNC binding and the Worker never touches anything but the PORTAL bucket', async () => {
    const fs = require('fs'), path = require('path');
    const cfg = fs.readFileSync(path.join(H.ROOT, 'wrangler.portal.jsonc'), 'utf8').replace(/\/\/.*$/gm, '');
    assert.ok(!/SYNC|LEADS|business-apps-sync/.test(cfg), 'no SYNC or LEADS binding');
    assert.ok(/"PORTAL"/.test(cfg) && /run_worker_first"\s*:\s*\["\/api\/\*"\]/.test(cfg) && /"workers_dev"\s*:\s*true/.test(cfg) && /"preview_urls"\s*:\s*false/.test(cfg));
    const src = fs.readFileSync(path.join(H.ROOT, 'worker/portal.js'), 'utf8') + fs.readFileSync(path.join(H.ROOT, 'worker/portal-common.js'), 'utf8');
    assert.ok(!/env\.SYNC|env\.LEADS/.test(src));
    assert.ok(!/Access-Control-/i.test(src), 'no CORS headers anywhere');
  });

  console.log('portal-worker: ' + n + ' tests passed');
  process.exit(0);
})().catch((e) => { process.stderr.write(String(e && e.stack || e) + '\n'); process.exit(1); });
