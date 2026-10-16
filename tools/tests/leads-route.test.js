// Website messages: GET /api/leads in the private Worker (owner only, paging by key) and Client Atlas's import
// (site/client-atlas/leads.js fromWebsite/addWebsite). Run: node tools/tests/leads-route.test.js
'use strict';
const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');
const ROOT = path.join(__dirname, '../..');
const L = require(path.join(ROOT, 'site/client-atlas/leads.js'));
let n = 0;
async function t(name, fn) { await fn(); n++; console.log('ok', n, name); }

function makeR2() {
  const store = new Map();
  return {
    store,
    async get(key) { const v = store.get(key); return v == null ? null : { text: async () => v }; },
    async list(o = {}) {
      let keys = [...store.keys()].filter((k) => k.startsWith(o.prefix || '')).sort();
      if (o.startAfter) keys = keys.filter((k) => k > o.startAfter);
      const lim = o.limit || 1000;
      return { objects: keys.slice(0, lim).map((key) => ({ key })), truncated: keys.length > lim };
    }
  };
}
const rec = (i, extra) => ({ v: 1, id: 'm' + i, receivedAt: '2026-10-1' + (i % 10) + 'T08:00:00.000Z', source: 'website', name: 'Ana Novak', company: 'Primer d.o.o.', email: 'ana@example.si', phone: '', product: 'collections', message: 'Zanima me pregled terjatev ' + i, lang: 'sl', page: '/', ...extra });

(async function main() {
  await t('fromWebsite: company, contact, due on the day it came in, notes with the product and the message', async () => {
    const l = L.fromWebsite(rec(5));
    assert.strictEqual(l.id, 'wm5'); assert.strictEqual(l.company, 'Primer d.o.o.'); assert.strictEqual(l.contact, 'Ana Novak · ana@example.si');
    assert.strictEqual(l.status, 'new'); assert.strictEqual(l.next, '2026-10-15'); assert.strictEqual(l.channel, 'website');
    assert.ok(l.notes.startsWith('Website enquiry · Collections · SL · 15. 10. 2026\n')); assert.ok(l.notes.endsWith('terjatev 5'));
    assert.strictEqual(L.fromWebsite(rec(1, { company: '' })).company, 'Ana Novak', 'no company: the name');
    assert.strictEqual(L.fromWebsite({}), null); assert.strictEqual(L.fromWebsite(null), null);
  });
  await t('addWebsite adds each message once and counts only the new ones', async () => {
    const list = [];
    assert.strictEqual(L.addWebsite(list, [rec(1), rec(2)]), 2);
    assert.strictEqual(L.addWebsite(list, [rec(2), rec(3)]), 1);
    assert.deepStrictEqual(list.map((l) => l.id), ['wm1', 'wm2', 'wm3']);
    assert.deepStrictEqual(L.needs(list, '2026-10-13').map((x) => x.count), [2, 1], 'two overdue, one today');
  });

  // the real Worker with real Access tokens (as in home-sync.test.js)
  const TEAM = 'team.example', AUD = 'aud-test', OWNER = 'owner@example.com', VIEWER = 'viewer@example.com';
  const b64u = (b) => Buffer.from(b).toString('base64url');
  const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = { ...(await crypto.subtle.exportKey('jwk', kp.publicKey)), kid: 'k1' };
  async function token(email) {
    const h = b64u(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' }));
    const p = b64u(JSON.stringify({ aud: [AUD], email, iss: 'https://' + TEAM, exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000) }));
    return h + '.' + p + '.' + b64u(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', kp.privateKey, new TextEncoder().encode(h + '.' + p)));
  }
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, i) => (String(u) === 'https://' + TEAM + '/cdn-cgi/access/certs' ? new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'Content-Type': 'application/json' } }) : realFetch(u, i));
  const worker = (await import(pathToFileURL(path.join(ROOT, 'worker/index.js')).href)).default;
  const LEADS = makeR2();
  for (let i = 1; i <= 60; i++) LEADS.store.set('leads/2026-10/2026101' + String(i).padStart(7, '0') + '-m' + i + '.json', JSON.stringify(rec(i)));
  LEADS.store.set('leads/2026-10/20261019999999-broken.json', '{not json');
  LEADS.store.set('ratelimit/2026-10-16/salt', 'x');
  const env = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, OWNER_EMAIL: OWNER, VIEWER_EMAILS: VIEWER, SYNC: makeR2(), LEADS, ASSETS: null };
  const get = async (email, q) => worker.fetch(new Request('https://apps.example/api/leads' + (q || ''), { headers: { 'Cf-Access-Jwt-Assertion': await token(email) } }), env);

  await t('the owner pages through all messages oldest first; broken files and rate-limit records are skipped', async () => {
    let r = await get(OWNER), d = await r.json();
    assert.strictEqual(r.status, 200); assert.strictEqual(r.headers.get('Cache-Control'), 'private, no-store');
    assert.strictEqual(d.leads.length, 50); assert.strictEqual(d.truncated, true); assert.strictEqual(d.leads[0].id, 'm1');
    r = await get(OWNER, '?after=' + encodeURIComponent(d.last)); d = await r.json();
    assert.strictEqual(d.leads.length, 10); assert.strictEqual(d.truncated, false); assert.strictEqual(d.leads[9].id, 'm60');
    r = await get(OWNER, '?after=' + encodeURIComponent(d.last)); const d2 = await r.json();
    assert.deepStrictEqual(d2.leads, []); assert.strictEqual(d2.last, d.last, 'nothing new: the same key back');
  });
  await t('view-only people and strangers never read the messages; a bad "after" is refused', async () => {
    assert.strictEqual((await get(VIEWER)).status, 403);
    assert.strictEqual((await get('someone@example.org')).status, 403);
    assert.strictEqual((await worker.fetch(new Request('https://apps.example/api/leads'), env)).status, 401);
    assert.strictEqual((await get(OWNER, '?after=' + encodeURIComponent('../u/x.json'))).status, 400);
    const post = await worker.fetch(new Request('https://apps.example/api/leads', { method: 'POST', headers: { 'Cf-Access-Jwt-Assertion': await token(OWNER), 'X-Stratum-Apps': '1' } }), env);
    assert.strictEqual(post.status, 404);
  });
  await t('without the LEADS binding the route says so (503)', async () => {
    const r = await worker.fetch(new Request('https://apps.example/api/leads', { headers: { 'Cf-Access-Jwt-Assertion': await token(OWNER) } }), { ...env, LEADS: undefined });
    assert.strictEqual(r.status, 503);
  });
  globalThis.fetch = realFetch;
  console.log('leads-route: ' + n + ' tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
