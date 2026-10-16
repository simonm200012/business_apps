// Public site contact form (public/worker.js, POST /api/contact): validation and length limits, honeypot, minimum fill
// time, origin and content-type checks, rate limits per hashed IP and per day, storage as JSON in an in-memory R2,
// clean-up of old rate-limit days, optional Turnstile, and the Client Atlas mapping.
// Run: node tools/tests/public-contact.test.js
'use strict';
const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '../..');
const AtlasLeads = require(path.join(ROOT, 'site/client-atlas/leads.js'));
let n = 0;
async function t(name, fn) { await fn(); n++; console.log('ok', n, name); }

// in-memory R2 (only what the route uses), as in tools/tests/home-sync.test.js
function makeR2() {
  const store = new Map(); let k = 0;
  const meta = (key, o) => ({ key, size: o.bytes.byteLength, etag: o.etag, uploaded: o.uploaded, customMetadata: { ...o.customMetadata }, httpMetadata: { ...o.httpMetadata } });
  return {
    store,
    async head(key) { const o = store.get(key); return o ? meta(key, o) : null; },
    async get(key) {
      const o = store.get(key); if (!o) return null;
      return { ...meta(key, o), text: async () => Buffer.from(o.bytes).toString('utf8'), json: async () => JSON.parse(Buffer.from(o.bytes).toString('utf8')) };
    },
    async put(key, body, opts = {}) {
      const bytes = new Uint8Array(await new Response(body).arrayBuffer());
      const o = { bytes, etag: 'e' + (++k), uploaded: new Date(), customMetadata: { ...(opts.customMetadata || {}) }, httpMetadata: { ...(opts.httpMetadata || {}) } };
      store.set(key, o); return meta(key, o);
    },
    async delete(keys) { for (const x of [].concat(keys)) store.delete(x); },
    async list(opts = {}) {
      const prefix = opts.prefix || '';
      const objects = [...store.keys()].filter((x) => x.startsWith(prefix)).sort().slice(0, opts.limit || 1000).map((x) => meta(x, store.get(x)));
      return { objects, truncated: false, delimitedPrefixes: [] };
    }
  };
}

const ORIGIN = 'https://stratum-site.example.workers.dev';
const T0 = Date.parse('2026-10-15T09:20:00Z');
const good = (over) => ({ name: 'Ana Novak', company: 'Primer d.o.o.', email: 'ana@example.si', phone: '+386 1 000 00 00', product: 'collections', message: 'Zanima nas uvod Terjatev za 300 kupcev.', lang: 'sl', website: '', elapsedMs: 8000, page: '/', ...over });
function req(body, opts = {}) {
  const headers = { 'Content-Type': 'application/json', Origin: ORIGIN, 'CF-Connecting-IP': opts.ip || '203.0.113.7', ...(opts.headers || {}) };
  if (opts.noOrigin) delete headers.Origin;
  return new Request(ORIGIN + (opts.path || '/api/contact'), { method: opts.method || 'POST', headers, body: opts.method === 'GET' ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
}
const leads = (r2) => [...r2.store.keys()].filter((k) => k.startsWith('leads/'));

(async function main() {
  const W = await import(pathToFileURL(path.join(ROOT, 'public/worker.js')).href);

  await t('a valid message is stored as JSON under leads/<month>/ and answered 200 { ok, id }', async () => {
    const r2 = makeR2();
    const r = await W.handleContact(req(good()), { LEADS: r2 }, T0);
    assert.strictEqual(r.status, 200);
    const j = await r.json();
    assert.ok(j.ok && /^\d{14}-[0-9a-f]{8}$/.test(j.id));
    assert.deepStrictEqual(Object.keys(j).sort(), ['id', 'ok'], 'nothing of the input is echoed');
    const keys = leads(r2);
    assert.deepStrictEqual(keys, ['leads/2026-10/' + j.id + '.json']);
    const rec = await (await r2.get(keys[0])).json();
    assert.strictEqual(rec.name, 'Ana Novak'); assert.strictEqual(rec.email, 'ana@example.si'); assert.strictEqual(rec.product, 'collections'); assert.strictEqual(rec.lang, 'sl');
    assert.strictEqual(rec.receivedAt, '2026-10-15T09:20:00.000Z'); assert.strictEqual(rec.source, 'website');
    assert.ok(!JSON.stringify(rec).includes('203.0.113.7'), 'no IP address in the lead');
    assert.ok(!('website' in rec) && !('elapsedMs' in rec));
    assert.strictEqual(r.headers.get('Cache-Control'), 'no-store');
    assert.match(r.headers.get('Content-Type'), /application\/json/);
  });

  await t('honeypot filled: a normal-looking 200, nothing stored', async () => {
    const r2 = makeR2();
    const r = await W.handleContact(req(good({ website: 'http://spam.example' })), { LEADS: r2 }, T0);
    assert.strictEqual(r.status, 200); assert.ok((await r.json()).ok);
    assert.strictEqual(r2.store.size, 0);
  });

  await t('sent faster than 3 seconds after the page opened (or no time at all): 400 too_fast', async () => {
    const r2 = makeR2();
    for (const e of [500, 2999, undefined, 'x']) {
      const r = await W.handleContact(req(good({ elapsedMs: e })), { LEADS: r2 }, T0);
      assert.strictEqual(r.status, 400); assert.strictEqual((await r.json()).error, 'too_fast');
    }
    assert.strictEqual(r2.store.size, 0);
  });

  await t('validation and length limits name the bad fields', async () => {
    const r2 = makeR2();
    const bad = async (over, fields) => {
      const r = await W.handleContact(req(good(over)), { LEADS: r2 }, T0);
      assert.strictEqual(r.status, 400, JSON.stringify(over).slice(0, 60));
      const j = await r.json(); assert.strictEqual(j.error, 'invalid'); assert.deepStrictEqual(j.fields, fields);
    };
    await bad({ name: 'A' }, ['name']);
    await bad({ name: 'x'.repeat(101) }, ['name']);
    await bad({ company: 'c'.repeat(121) }, ['company']);
    await bad({ email: 'not-an-email' }, ['email']);
    await bad({ email: 'a@b' }, ['email']);
    await bad({ email: 'ana@example.si\r\nBcc: x@example.si' }, ['email']);
    await bad({ email: 'x'.repeat(250) + '@example.si' }, ['email']);
    await bad({ phone: 'call me maybe' }, ['phone']);
    await bad({ message: 'short' }, ['message']);
    await bad({ message: 'm'.repeat(4001) }, ['message']);
    await bad({ name: 1, email: null, message: {} }, ['name', 'email', 'message']);
    assert.strictEqual(r2.store.size, 0);
    // limits count characters: 100 letters with diacritics are fine
    const ok = await W.handleContact(req(good({ name: 'Č'.repeat(100), message: 'ž'.repeat(4000) })), { LEADS: r2 }, T0);
    assert.strictEqual(ok.status, 200);
  });

  await t('unknown product and language fall back to "other" and "sl"; control characters and line breaks in one-line fields are cleaned', async () => {
    const r2 = makeR2();
    const r = await W.handleContact(req(good({ product: '<script>', lang: 'de', name: 'Ana\u0000\nNovak', company: '  Primer\td.o.o.  ', message: 'Vrstica 1\r\n\r\n\r\n\r\nVrstica 2 <b>html</b>\u0007' })), { LEADS: r2 }, T0);
    assert.strictEqual(r.status, 200);
    const rec = await (await r2.get(leads(r2)[0])).json();
    assert.strictEqual(rec.product, 'other'); assert.strictEqual(rec.lang, 'sl');
    assert.strictEqual(rec.name, 'Ana Novak'); assert.strictEqual(rec.company, 'Primer d.o.o.');
    assert.strictEqual(rec.message, 'Vrstica 1\n\nVrstica 2 <b>html</b>', 'stored as text; the site never puts it into HTML');
  });

  await t('method, content type, size, JSON shape and origin are checked', async () => {
    const r2 = makeR2(), env = { LEADS: r2 };
    let r = await W.handleContact(req(null, { method: 'GET' }), env, T0);
    assert.strictEqual(r.status, 405); assert.strictEqual(r.headers.get('Allow'), 'POST');
    r = await W.handleContact(req('name=Ana', { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }), env, T0);
    assert.strictEqual(r.status, 415);
    r = await W.handleContact(req(JSON.stringify(good({ message: 'x'.repeat(17000) }))), env, T0);
    assert.strictEqual(r.status, 413);
    r = await W.handleContact(req('{not json'), env, T0);
    assert.strictEqual(r.status, 400); assert.strictEqual((await r.json()).error, 'json');
    r = await W.handleContact(req('[1,2]'), env, T0);
    assert.strictEqual(r.status, 400);
    r = await W.handleContact(req(good(), { headers: { Origin: 'https://evil.example' } }), env, T0);
    assert.strictEqual(r.status, 403);
    r = await W.handleContact(req(good(), { headers: { Origin: 'https://www.example.si' } }), { ...env, ALLOWED_ORIGINS: 'https://www.example.si, https://example.si' }, T0);
    assert.strictEqual(r.status, 200, 'an extra allowed origin (custom domain)');
    r = await W.handleContact(req(good(), { noOrigin: true }), env, T0);
    assert.strictEqual(r.status, 200, 'no Origin header (some clients) is allowed; the other checks still apply');
    assert.strictEqual(leads(r2).length, 2);
  });

  await t('rate limit: 5 messages per IP per hour, then 429; another IP and the next hour are fine; the IP is stored only hashed', async () => {
    const r2 = makeR2(), env = { LEADS: r2 };
    for (let i = 0; i < 5; i++) assert.strictEqual((await W.handleContact(req(good()), env, T0 + i * 1000)).status, 200);
    const r = await W.handleContact(req(good()), env, T0 + 6000);
    assert.strictEqual(r.status, 429); assert.strictEqual(r.headers.get('Retry-After'), '3600');
    assert.strictEqual((await W.handleContact(req(good(), { ip: '198.51.100.9' }), env, T0 + 7000)).status, 200);
    assert.strictEqual((await W.handleContact(req(good()), env, T0 + 3600e3)).status, 200, 'next hour');
    assert.strictEqual(leads(r2).length, 7);
    for (const k of r2.store.keys()) assert.ok(!k.includes('203.0.113.7') && !k.includes('198.51.100.9'), k);
    assert.ok(r2.store.has('ratelimit/2026-10-15/salt'));
  });

  await t('a daily cap stops floods from many addresses', async () => {
    const r2 = makeR2(), env = { LEADS: r2 };
    await r2.put('ratelimit/2026-10-15/total', '', { customMetadata: { n: String(W.LIMITS.perDay) } });
    const r = await W.handleContact(req(good(), { ip: '192.0.2.1' }), env, T0);
    assert.strictEqual(r.status, 429);
    assert.strictEqual(leads(r2).length, 0);
  });

  await t('rate-limit days before yesterday are deleted on the next message; leads are never touched', async () => {
    const r2 = makeR2(), env = { LEADS: r2 };
    await r2.put('ratelimit/2026-10-12/salt', 'old'); await r2.put('ratelimit/2026-10-12/08/abc', '', { customMetadata: { n: '1' } });
    await r2.put('ratelimit/2026-10-14/salt', 'yesterday');
    await r2.put('leads/2026-09/x.json', '{}');
    assert.strictEqual((await W.handleContact(req(good()), env, T0)).status, 200);
    assert.ok(!r2.store.has('ratelimit/2026-10-12/salt') && !r2.store.has('ratelimit/2026-10-12/08/abc'));
    assert.ok(r2.store.has('ratelimit/2026-10-14/salt'), 'yesterday is kept');
    assert.ok(r2.store.has('leads/2026-09/x.json'));
  });

  await t('no bucket bound or a storage error: 503, and the form offers e-mail instead', async () => {
    let r = await W.handleContact(req(good()), {}, T0);
    assert.strictEqual(r.status, 503);
    const broken = makeR2(); broken.put = async () => { throw new Error('R2 down'); };
    r = await W.handleContact(req(good()), { LEADS: broken }, T0);
    assert.strictEqual(r.status, 503); assert.strictEqual((await r.json()).error, 'storage');
  });

  await t('Turnstile (optional): with TURNSTILE_SECRET a missing or failed token is refused, a good one passes', async () => {
    const r2 = makeR2(), env = { LEADS: r2, TURNSTILE_SECRET: 'test-secret' };
    const realFetch = global.fetch; let sent = null;
    global.fetch = async (url, init) => { sent = { url, secret: init.body.get('secret'), response: init.body.get('response') }; return new Response(JSON.stringify({ success: init.body.get('response') === 'good-token' })); };
    try {
      let r = await W.handleContact(req(good()), env, T0);
      assert.strictEqual(r.status, 400); assert.strictEqual((await r.json()).error, 'turnstile');
      r = await W.handleContact(req(good({ turnstileToken: 'bad' })), env, T0);
      assert.strictEqual(r.status, 400);
      r = await W.handleContact(req(good({ turnstileToken: 'good-token' })), env, T0);
      assert.strictEqual(r.status, 200);
      assert.strictEqual(sent.url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify'); assert.strictEqual(sent.secret, 'test-secret');
    } finally { global.fetch = realFetch; }
    assert.strictEqual(leads(r2).length, 1);
  });

  await t('the Worker: /api/contact → the handler, other /api/* → 404 JSON, everything else → static files', async () => {
    const r2 = makeR2(); let asset = 0;
    const env = { LEADS: r2, ASSETS: { fetch: async () => { asset++; return new Response('page'); } } };
    let r = await W.default.fetch(req(good({ elapsedMs: 5000 })), env);
    assert.strictEqual(r.status, 200);
    r = await W.default.fetch(req(null, { method: 'GET', path: '/api/sync/billing' }), env);
    assert.strictEqual(r.status, 404); assert.strictEqual((await r.json()).error, 'not_found');
    r = await W.default.fetch(new Request(ORIGIN + '/hr/'), env);
    assert.strictEqual(await r.text(), 'page'); assert.strictEqual(asset, 1);
  });

  await t('a stored message becomes a clean Client Atlas lead (site/client-atlas/leads.js)', async () => {
    const r2 = makeR2();
    await W.handleContact(req(good()), { LEADS: r2 }, T0);
    const rec = await (await r2.get(leads(r2)[0])).json();
    const lead = AtlasLeads.clean(W.toAtlasLead(rec), rec.receivedAt);
    assert.ok(lead);
    assert.strictEqual(lead.company, 'Primer d.o.o.'); assert.strictEqual(lead.channel, 'website'); assert.strictEqual(lead.status, 'new');
    assert.match(lead.contact, /Ana Novak · ana@example\.si · \+386 1 000 00 00/);
    assert.match(lead.notes, /^\[collections, sl\] Zanima nas/);
    assert.strictEqual(W.toAtlasLead({ ...rec, company: '' }).company, 'Ana Novak', 'no company → the person');
  });

  console.log('all ' + n + ' public contact tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
