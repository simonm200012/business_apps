// The Worker's VIES proxy for the Data health check (worker/index.js, GET /api/vies/:country/:number), with fetch stubbed:
// the address it calls, the answers it passes on, the timeout, the same sign-in check as the other routes, and that no VAT
// ID is ever written to the console. Run: node tools/tests/datacheck-vies.test.js
'use strict';
const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

let n = 0;
async function t(name, fn) { await fn(); n++; console.log('ok', n, name); }

(async () => {
  const worker = (await import(pathToFileURL(path.join(__dirname, '../../worker/index.js')).href)).default;
  const DEV = { DEV_BYPASS: '1', OWNER_EMAIL: 'owner@example.com' };
  const realFetch = global.fetch, logs = [];
  ['log', 'error', 'warn', 'info'].forEach((k) => { const orig = console[k]; console[k] = (...a) => { logs.push(a.map(String).join(' ')); if (k === 'log') orig(...a); }; });
  let calls = [], answer = null;
  global.fetch = async (url, opts) => { calls.push({ url: String(url), opts }); return typeof answer === 'function' ? answer(url, opts) : answer; };
  const get = (p, env) => worker.fetch(new Request('https://apps.example.test' + p), env || DEV);
  const viesJson = (o, status) => new Response(JSON.stringify(o), { status: status || 200, headers: { 'Content-Type': 'application/json' } });

  await t('valid VAT ID: calls the official VIES REST address and passes on name and address', async () => {
    calls = []; answer = viesJson({ isValid: true, requestDate: '2026-10-15T10:00:00.000Z', userError: 'VALID', name: 'VZOREC D.O.O.', address: 'Cesta 1\n1000 LJUBLJANA', vatNumber: '12345679' });
    const r = await get('/api/vies/SI/12345679');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].url, 'https://ec.europa.eu/taxation_customs/vies/rest-api/ms/SI/vat/12345679');
    assert.ok(calls[0].opts.signal, 'a timeout signal is set');
    const j = await r.json();
    assert.deepStrictEqual([j.valid, j.status, j.country, j.number, j.name, j.address], [true, 'valid', 'SI', '12345679', 'VZOREC D.O.O.', 'Cesta 1 1000 LJUBLJANA']);
    assert.strictEqual(r.headers.get('Cache-Control'), 'private, no-store');
  });

  await t('prefix in the number, spaces and GR are normalised; invalid answers come back as invalid', async () => {
    calls = []; answer = viesJson({ isValid: false, userError: 'INVALID', name: '---', address: '---' });
    const j = await (await get('/api/vies/gr/EL%20094%20259%20216')).json();
    assert.strictEqual(calls[0].url, 'https://ec.europa.eu/taxation_customs/vies/rest-api/ms/EL/vat/094259216');
    assert.deepStrictEqual([j.valid, j.status, j.name, j.address], [false, 'invalid', '', '']);
  });

  await t('a member state that cannot be reached is "unavailable", never "invalid"', async () => {
    answer = viesJson({ isValid: false, userError: 'MS_UNAVAILABLE' });
    const ask = async () => { const r = await get('/api/vies/DE/123456789'); assert.strictEqual(r.status, 200, 'the proxy worked: no failed request in the console'); const j = await r.json(); return [j.status, j.reason, j.valid]; };
    assert.deepStrictEqual(await ask(), ['unavailable', 'MS_UNAVAILABLE', undefined]);
    answer = () => { const e = new Error('The operation timed out'); e.name = 'TimeoutError'; throw e; };
    assert.deepStrictEqual(await ask(), ['unavailable', 'TIMEOUT', undefined]);
    answer = new Response('Service down', { status: 500 });
    assert.deepStrictEqual(await ask(), ['unavailable', 'HTTP_500', undefined]);
    answer = () => { throw new TypeError('fetch failed'); };
    assert.deepStrictEqual(await ask(), ['unavailable', 'BAD_ANSWER', undefined]);
  });

  await t('only EU prefixes and plausible numbers are sent on', async () => {
    calls = []; answer = viesJson({ isValid: true });
    for (const p of ['/api/vies/US/123456789', '/api/vies/CH/123456789', '/api/vies/SI/1', '/api/vies/SI/' + '1'.repeat(20), '/api/vies/SI/12%3C45']) {
      assert.strictEqual((await get(p)).status, 400, p);
    }
    assert.strictEqual(calls.length, 0);
    assert.strictEqual((await worker.fetch(new Request('https://apps.example.test/api/vies/SI/12345679', { method: 'POST', headers: { 'X-Stratum-Apps': '1' } }), DEV)).status, 405);
  });

  await t('the same sign-in check as the other routes: no Access setup or token, no VIES call', async () => {
    calls = [];
    assert.strictEqual((await get('/api/vies/SI/12345679', { OWNER_EMAIL: 'owner@example.com' })).status, 503, 'Access not configured');
    assert.strictEqual((await get('/api/vies/SI/12345679', { OWNER_EMAIL: 'owner@example.com', ACCESS_TEAM_DOMAIN: 'team.example.test', ACCESS_AUD: 'aud' })).status, 401, 'no token');
    assert.strictEqual(calls.length, 0);
  });

  await t('no VAT ID is written to the console', async () => {
    const seen = logs.filter((l) => /12345679|123456789|094259216/.test(l) && !/^ok \d/.test(l));
    assert.deepStrictEqual(seen, []);
  });

  global.fetch = realFetch;
  console.log(n + ' tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
