// Access tokens for the staff app and the client portal: the audience is the only thing that separates a client's token from
// a staff token (same team, same issuer), so every way a token can be wrong is tested here, on verifiedEmail() and on the
// staff Worker's routes. The portal Worker's own token tests are in portal-worker.test.js. Run: node tools/tests/portal-access.test.js
'use strict';
const assert = require('assert');
const H = require('./_portal-harness');

let n = 0;
async function t(name, fn) { await fn(); n++; console.log('ok', n, name); }

(async function main() {
  const { verifiedEmail, isLocalHost } = await H.imp('worker/access.js');
  const staff = (await H.imp('worker/index.js')).default;
  const k = await H.setupKeys();
  const r2 = H.makeR2();
  const env = { ACCESS_TEAM_DOMAIN: H.TEAM, ACCESS_AUD: H.STAFF_AUD, PORTAL_ACCESS_AUD: H.PORTAL_AUD, OWNER_EMAIL: H.OWNER, SYNC: r2, PORTAL: r2, ASSETS: null };
  const req = (tok, p = '/api/auth/me', method = 'GET') => new Request('https://apps.example' + p, { method, headers: tok ? { 'Cf-Access-Jwt-Assertion': tok, 'X-Stratum-Apps': '1' } : {} });
  const staffVerify = (tok) => verifiedEmail(req(tok), env);
  const portalVerify = (tok, e = env) => verifiedEmail(req(tok), e, { aud: e.PORTAL_ACCESS_AUD, otherAud: e.ACCESS_AUD });
  const cases = async (verify, good, label) => {
    const ok = await verify(await good('a@example.com'));
    assert.deepStrictEqual(ok, { email: 'a@example.com' }, label + ': valid token');
    assert.deepStrictEqual(await verify(await good('Mixed.Case@Example.COM')), { email: 'mixed.case@example.com' }, label + ': e-mail is lowercased');
    assert.strictEqual((await verify(null)).error, 'signin', label + ': missing');
    assert.strictEqual((await verify('garbage')).error, 'signin', label + ': malformed');
    assert.strictEqual((await verify('a.b.c')).error, 'signin', label + ': not JSON');
    assert.strictEqual((await verify(await good('a@example.com', { alg: 'none' }))).error, 'signin', label + ': alg none');
    assert.strictEqual((await verify(await good('a@example.com', { alg: 'HS256' }))).error, 'signin', label + ': HS256');
    assert.strictEqual((await verify(await good('a@example.com', { kid: 'nope' }))).error, 'signin', label + ': unknown kid');
    assert.strictEqual((await verify(await good('a@example.com', { kid: null }))).error, 'signin', label + ': no kid');
    assert.strictEqual((await verify(await good('a@example.com', { key: { privateKey: k.otherKey.privateKey } }))).error, 'signin', label + ': bad signature');
    assert.strictEqual((await verify(await good('a@example.com', { expIn: -10 }))).error, 'signin', label + ': expired');
    assert.strictEqual((await verify(await good('a@example.com', { nbf: Math.floor(Date.now() / 1000) + 3600 }))).error, 'signin', label + ': future nbf');
    assert.strictEqual((await verify(await good('a@example.com', { iss: 'https://evil.example' }))).error, 'signin', label + ': wrong issuer');
    assert.strictEqual((await verify(await good(null, { noEmail: true }))).error, 'signin', label + ': no e-mail (service token)');
    assert.strictEqual((await verify(await good('', {}))).error, 'signin', label + ': empty e-mail');
    assert.strictEqual((await verify(await good('no-at-sign'))).error, 'signin', label + ': e-mail without @');
    assert.strictEqual((await verify(await good(12345, { payload: { email: 12345 } }))).error, 'signin', label + ': e-mail not a string');
    // a tampered payload keeps the old signature
    const tok = await good('a@example.com'), parts = tok.split('.');
    const forged = parts[0] + '.' + H.b64u(JSON.stringify({ aud: [label === 'staff' ? H.STAFF_AUD : H.PORTAL_AUD], iss: 'https://' + H.TEAM, exp: 9999999999, email: 'owner@example.com' })) + '.' + parts[2];
    assert.strictEqual((await verify(forged)).error, 'signin', label + ': payload swapped, signature kept');
  };

  await t('staff tokens: the whole matrix', () => cases(staffVerify, k.staffToken, 'staff'));
  await t('portal tokens: the whole matrix', () => cases(portalVerify, k.portalToken, 'portal'));

  await t('a staff-audience token is refused by the portal check, and a portal-audience token by the staff check', async () => {
    assert.strictEqual((await portalVerify(await k.staffToken('a@example.com'))).error, 'signin');
    assert.strictEqual((await staffVerify(await k.portalToken('a@example.com'))).error, 'signin');
  });
  await t('a token listing BOTH audiences is refused by both checks', async () => {
    const both = await k.token('a@example.com', { aud: [H.STAFF_AUD, H.PORTAL_AUD] });
    assert.strictEqual((await portalVerify(both)).error, 'signin');
    assert.strictEqual((await staffVerify(both)).error, 'signin');
    const bothStr = await k.token('a@example.com', { payload: { aud: H.PORTAL_AUD } });
    assert.strictEqual((await portalVerify(bothStr)).email, 'a@example.com', 'a plain string aud still works');
  });
  await t('asciiOnly (the portal): a non-ASCII e-mail is refused before lowercasing (U+212A would fold onto "k")', async () => {
    const look = await k.portalToken('\u212Aate@example.com');
    assert.strictEqual((await verifiedEmail(req(look), env, { aud: H.PORTAL_AUD, otherAud: H.STAFF_AUD, asciiOnly: true })).error, 'signin');
    assert.strictEqual((await verifiedEmail(req(await k.portalToken('Kate@Example.com')), env, { aud: H.PORTAL_AUD, otherAud: H.STAFF_AUD, asciiOnly: true })).email, 'kate@example.com');
  });
  await t('missing configuration answers setup (the callers turn it into 503); the same audience on both apps is a setup error', async () => {
    const tok = await k.portalToken('a@example.com');
    assert.strictEqual((await portalVerify(tok, { ...env, PORTAL_ACCESS_AUD: '' })).error, 'setup');
    assert.strictEqual((await portalVerify(tok, { ...env, PORTAL_ACCESS_AUD: undefined })).error, 'setup');
    assert.strictEqual((await portalVerify(tok, { ...env, ACCESS_TEAM_DOMAIN: '' })).error, 'setup');
    assert.strictEqual((await portalVerify(tok, { ...env, ACCESS_AUD: H.PORTAL_AUD })).error, 'setup');
    assert.strictEqual((await verifiedEmail(req(tok), { ...env, ACCESS_AUD: '' })).error, 'setup');
  });
  await t('Access keys unavailable: verifiedEmail throws (the callers answer 503)', async () => {
    const tok = await k.staffToken('a@example.com', { kid: 'k1' });
    const fresh = await H.imp('worker/access.js', '?fresh=' + Date.now()); // a module copy with an empty certs cache
    k.certsOk = false;
    await assert.rejects(() => fresh.verifiedEmail(req(tok), env));
    k.certsOk = true;
    assert.strictEqual((await fresh.verifiedEmail(req(tok), env)).email, 'a@example.com');
  });

  await t('staff Worker: a portal-audience token never gets in (sync, workspaces, portal admin, even for the owner e-mail)', async () => {
    const bad = await k.portalToken(H.OWNER);
    for (const p of ['/api/auth/me', '/api/sync/billing?meta=1', '/api/sync/crm', '/api/ws', '/api/portal/clients']) {
      const r = await staff.fetch(req(bad, p), env);
      assert.ok(r.status === 401 || r.status === 403, p + ' → ' + r.status);
    }
    const ws = await staff.fetch(req(bad, '/api/ws'), env);
    assert.strictEqual(ws.status, 401);
    const good = await staff.fetch(req(await k.staffToken(H.OWNER)), env);
    assert.strictEqual(good.status, 200);
  });

  await t('DEV_BYPASS: honoured only on localhost; on any other host every request is refused with 500', async () => {
    const dev = { ...env, DEV_BYPASS: '1' };
    const local = await staff.fetch(new Request('http://localhost:8787/api/auth/me'), dev);
    assert.strictEqual(local.status, 200);
    for (const host of ['https://apps.example', 'https://business-apps.workers.dev', 'https://localhost.evil.example', 'https://127.0.0.1.evil.example']) {
      const r = await staff.fetch(new Request(host + '/api/auth/me'), dev);
      assert.strictEqual(r.status, 500, host);
      const s = await staff.fetch(new Request(host + '/api/sync/billing'), dev);
      assert.strictEqual(s.status, 500, host + ' sync');
    }
    // set to any value, not only "1": still refused on a deployed host
    assert.strictEqual((await staff.fetch(new Request('https://apps.example/api/auth/me'), { ...env, DEV_BYPASS: 'true' })).status, 500);
    assert.ok(isLocalHost('localhost') && isLocalHost('127.0.0.1') && isLocalHost('[::1]') && isLocalHost('app.localhost'));
    assert.ok(!isLocalHost('localhost.example') && !isLocalHost('example.com') && !isLocalHost(''));
  });
  await t('DEV_BYPASS appears in no wrangler config and .dev.vars is git-ignored', async () => {
    const fs = require('fs'), path = require('path');
    for (const f of fs.readdirSync(H.ROOT).filter((x) => /^wrangler.*\.jsonc?$/.test(x))) assert.ok(!/DEV_BYPASS/.test(fs.readFileSync(path.join(H.ROOT, f), 'utf8')), f);
    assert.ok(/^\.dev\.vars$/m.test(fs.readFileSync(path.join(H.ROOT, '.gitignore'), 'utf8')));
  });

  console.log('portal-access: ' + n + ' tests passed');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
