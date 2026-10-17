// Branded demo (Studio > Branded demo): the private API (worker/demos.js, owner only), the public page and data
// (public/demo.js: /d/<slug>, /api/demo/<slug>), validation, view counting, clean-up, the app list, colours and the editor's helpers.
// In-memory R2, real Worker code, real Access tokens signed with a test key. Run: node tools/tests/branded-demo.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '../..');
let n = 0;
async function t(name, fn) { await fn(); n++; console.log('ok', n, name); }

function makeR2() {
  const store = new Map();
  const meta = (key, o) => ({ key, size: o.bytes.byteLength, httpMetadata: { ...o.httpMetadata } });
  return {
    store,
    async head(key) { const o = store.get(key); return o ? meta(key, o) : null; },
    async get(key) {
      const o = store.get(key); if (!o) return null;
      return { ...meta(key, o), body: new Response(o.bytes).body, text: async () => Buffer.from(o.bytes).toString('utf8'), arrayBuffer: async () => o.bytes.buffer.slice(0) };
    },
    async put(key, body, opts = {}) { store.set(key, { bytes: new Uint8Array(await new Response(body).arrayBuffer()), httpMetadata: { ...(opts.httpMetadata || {}) } }); },
    async delete(keys) { for (const x of [].concat(keys)) store.delete(x); },
    async list(opts = {}) { const objects = [...store.keys()].filter((x) => x.startsWith(opts.prefix || '')).sort().map((x) => meta(x, store.get(x))); return { objects, truncated: false }; }
  };
}

// a real (tiny) PNG: 1x1 pixel
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG_BYTES = Buffer.from(PNG_B64, 'base64');
const NOW = Date.parse('2026-10-17T10:00:00Z');
const DAY = 864e5;
const ds = (d) => new Date(Date.now() + d * DAY).toISOString().slice(0, 10); // a date d days from today (the Workers use the real clock)
const BROWSER = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const good = (over) => ({ name: 'Hladilni Sistemi Kovač d.o.o.', lang: 'sl', accent: '#0B7A75', accent2: '#E0A526', apps: ['collections', 'crm', 'erp'], news: { title: 'Servis čez praznike', text: 'Ekipa je na voljo vse dni.' },
  booking: 'https://cal.com/clearfigure/posvet', expires: ds(60), logo: PNG_B64, ...over });

(async function main() {
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

  const priv = (await import(pathToFileURL(path.join(ROOT, 'worker/index.js')).href)).default;
  const demos = await import(pathToFileURL(path.join(ROOT, 'worker/demos.js')).href);
  const S = await import(pathToFileURL(path.join(ROOT, 'worker/demo-shared.js')).href);
  const { PRIVATE_APPS, isPrivatePath } = await import(pathToFileURL(path.join(ROOT, 'worker/access.js')).href);
  const pub = (await import(pathToFileURL(path.join(ROOT, 'public/worker.js')).href)).default;
  const LEADS = makeR2();
  const asked = [];
  const ASSETS = { fetch: async (req) => { asked.push(new URL(req.url).pathname); return new Response('<!doctype html><title>shell</title>', { headers: { 'Content-Type': 'text/html' } }); } };
  const env = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, OWNER_EMAIL: OWNER, VIEWER_EMAILS: VIEWER, SYNC: makeR2(), LEADS, ASSETS: null, PUBLIC_BASE_URL: 'https://clearfigure.example.workers.dev/' };
  const penv = { LEADS, ASSETS };
  async function api(email, method, p, body, extra = {}) {
    const headers = { ...(email ? { 'Cf-Access-Jwt-Assertion': await token(email) } : {}), ...(method !== 'GET' ? { 'X-Stratum-Apps': '1', 'Content-Type': 'application/json' } : {}), ...extra };
    return priv.fetch(new Request('https://apps.example' + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env);
  }
  const pget = (p, ua = BROWSER, h = {}) => pub.fetch(new Request('https://clearfigure.example' + p, { headers: { 'User-Agent': ua, ...h } }), penv);
  const views = async (slug) => JSON.parse(Buffer.from(LEADS.store.get('demos/' + slug + '/views.json').bytes).toString('utf8'));

  // ── the private API ────────────────────────────────────────────────────────────────────────────────────────
  let slug;
  await t('owner creates a demo: 201, slug = readable part + 16 random base32 characters, three objects under demos/<slug>/', async () => {
    const r = await api(OWNER, 'POST', '/api/demos', good());
    assert.strictEqual(r.status, 201);
    const j = await r.json();
    slug = j.slug;
    assert.match(slug, /^hladilni-sistemi-kovac-d-o-o-[a-z2-7]{16}$/, slug);
    assert.strictEqual(j.path, '/d/' + slug);
    assert.deepStrictEqual([...LEADS.store.keys()].filter((k) => k.startsWith('demos/')).sort(), ['demos/' + slug + '/config.json', 'demos/' + slug + '/logo.png', 'demos/' + slug + '/views.json']);
    assert.deepStrictEqual(Buffer.from(LEADS.store.get('demos/' + slug + '/logo.png').bytes), PNG_BYTES);
    assert.strictEqual(LEADS.store.get('demos/' + slug + '/logo.png').httpMetadata.contentType, 'image/png');
    assert.strictEqual(j.config.expires, ds(60) + 'T23:59:59.999Z'); assert.strictEqual(j.config.logo, true);
    assert.deepStrictEqual(await views(slug), { count: 0, last: null });
    assert.strictEqual(r.headers.get('Cache-Control'), 'private, no-store');
  });
  await t('slugs are unguessable: two demos for the same company get different ids; a name with no letters gets just the id', async () => {
    const a = await (await api(OWNER, 'POST', '/api/demos', good({ logo: undefined }))).json(), b = await (await api(OWNER, 'POST', '/api/demos', good({ logo: undefined }))).json();
    assert.notStrictEqual(a.slug, b.slug);
    const c = await (await api(OWNER, 'POST', '/api/demos', good({ name: '東京', logo: undefined }))).json();
    assert.match(c.slug, /^[a-z2-7]{16}$/);
    for (const x of [a, b, c]) await api(OWNER, 'DELETE', '/api/demos/' + x.slug);
    assert.ok(S.isSlug(slug) && !S.isSlug('../x') && !S.isSlug('ABCDEFGHIJ') && !S.isSlug('short') && !S.isSlug('a'.repeat(65)));
    // 80 bits of randomness: 16 base32 characters; the old 10-character form is not a slug any more
    assert.ok(!S.isSlug('abcdefghij') && !S.isSlug('x-abcdefghij') && S.isSlug('abcdefghijklmnop'));
    // no R2 key can be built from anything but a slug, and neither Worker reaches another key with an encoded path
    for (const x of ['../leads', '..', 'a/b', '', 'leads/2026-10/x', 'abcdefghijklmnop/../../leads']) assert.throws(() => S.keys(x), /not a demo slug/);
    for (const p of ['/api/demos/..%2F..%2Fleads', '/api/demos/%2e%2e', '/api/demos/' + slug + '%2F..%2F..%2Fleads']) assert.strictEqual((await api(OWNER, 'GET', p)).status, 404, p);
    for (const p of ['/api/demo/..%2Fleads', '/api/demo/%2e%2e/logo.png', '/d/..%2F..%2Fleads', '/d/%2e%2e%2Fleads']) assert.strictEqual((await pget(p)).status, 404, p);
  });
  await t('list: name, language, number of apps, expiry, views; base address and the default booking link', async () => {
    const r = await api(OWNER, 'GET', '/api/demos'), j = await r.json();
    assert.strictEqual(r.status, 200);
    assert.strictEqual(j.demos.length, 1);
    assert.deepStrictEqual(j.demos[0], { slug, name: 'Hladilni Sistemi Kovač d.o.o.', lang: 'sl', apps: 3, expires: ds(60) + 'T23:59:59.999Z', expired: false, created: j.demos[0].created, views: { count: 0, last: null } });
    assert.strictEqual(j.base, 'https://clearfigure.example.workers.dev');
    assert.match(j.defaults.bookingUrl, /^https:\/\/cal\.com\//); assert.strictEqual(j.defaults.days, 60);
  });
  await t('get one (config + views), its logo, patch (fields, news date, logo removal, expire now, extend), delete', async () => {
    let j = await (await api(OWNER, 'GET', '/api/demos/' + slug)).json();
    assert.strictEqual(j.config.name, 'Hladilni Sistemi Kovač d.o.o.'); assert.match(j.config.news.date, /^\d{4}-\d{2}-\d{2}$/);
    const logo = await api(OWNER, 'GET', '/api/demos/' + slug + '/logo.png');
    assert.strictEqual(logo.status, 200); assert.strictEqual(logo.headers.get('Content-Type'), 'image/png'); assert.deepStrictEqual(Buffer.from(await logo.arrayBuffer()), PNG_BYTES);
    let r = await api(OWNER, 'PATCH', '/api/demos/' + slug, { name: 'Kovač Hlajenje', accent: '#112233', apps: ['erp'], lang: 'de', news: null, booking: '', expires: ds(100) });
    assert.strictEqual(r.status, 200); j = await r.json();
    assert.deepStrictEqual([j.config.name, j.config.accent, j.config.apps, j.config.lang, j.config.news, j.config.booking, j.config.expires, j.config.accent2, j.config.slug], ['Kovač Hlajenje', '#112233', ['erp'], 'de', null, '', ds(100) + 'T23:59:59.999Z', '#e0a526', slug]);
    r = await api(OWNER, 'PATCH', '/api/demos/' + slug, { logo: null });
    assert.strictEqual((await r.json()).config.logo, false); assert.ok(!LEADS.store.has('demos/' + slug + '/logo.png'));
    assert.strictEqual((await api(OWNER, 'GET', '/api/demos/' + slug + '/logo.png')).status, 404);
    r = await api(OWNER, 'PATCH', '/api/demos/' + slug, { expireNow: true });
    j = await r.json(); assert.strictEqual(j.expired, true);
    assert.strictEqual((await (await api(OWNER, 'GET', '/api/demos')).json()).demos[0].expired, true);
    r = await api(OWNER, 'PATCH', '/api/demos/' + slug, { expires: ds(30) });
    assert.strictEqual((await r.json()).expired, false);
    assert.strictEqual((await api(OWNER, 'DELETE', '/api/demos/' + slug)).status, 200);
    assert.deepStrictEqual([...LEADS.store.keys()].filter((k) => k.startsWith('demos/')), [], 'config, logo and counter are all gone');
    assert.strictEqual((await api(OWNER, 'GET', '/api/demos/' + slug)).status, 404);
    assert.strictEqual((await api(OWNER, 'PATCH', '/api/demos/' + slug, { name: 'x' })).status, 404);
  });
  await t('the news date stays when the news text does, and is today when it changes', async () => {
    const cfg = S.buildConfig(good(), null, NOW).config;
    const same = S.buildConfig({ news: { title: cfg.news.title, text: cfg.news.text } }, { ...cfg, news: { ...cfg.news, date: '2026-09-01' } }, NOW).config;
    assert.strictEqual(same.news.date, '2026-09-01');
    const changed = S.buildConfig({ news: { title: 'Nova novica', text: '' } }, { ...cfg, news: { ...cfg.news, date: '2026-09-01' } }, NOW).config;
    assert.deepStrictEqual(changed.news, { title: 'Nova novica', text: '', date: '2026-10-17' });
  });
  await t('view-only people and strangers get 403 on everything, nobody without a token gets in, writes need X-Stratum-Apps', async () => {
    const d = await (await api(OWNER, 'POST', '/api/demos', good())).json();
    for (const [m, p, b] of [['GET', '/api/demos'], ['GET', '/api/demos/' + d.slug], ['GET', '/api/demos/' + d.slug + '/logo.png'], ['POST', '/api/demos', good()], ['PATCH', '/api/demos/' + d.slug, { name: 'X' }], ['DELETE', '/api/demos/' + d.slug]]) {
      assert.strictEqual((await api(VIEWER, m, p, b)).status, 403, 'viewer ' + m + ' ' + p);
      assert.strictEqual((await api('someone@example.org', m, p, b)).status, 403, 'stranger ' + m + ' ' + p);
      assert.strictEqual((await api(null, m, p, b)).status, 401, 'no token ' + m + ' ' + p);
    }
    assert.strictEqual((await api(OWNER, 'POST', '/api/demos', good(), { 'X-Stratum-Apps': '' })).status, 400);
    assert.strictEqual((await api(OWNER, 'DELETE', '/api/demos/' + d.slug, undefined, { 'X-Stratum-Apps': '' })).status, 400);
    assert.ok(LEADS.store.has('demos/' + d.slug + '/config.json'), 'nothing changed');
    assert.ok(isPrivatePath('/api/demos') && isPrivatePath('/api/demos/x') && PRIVATE_APPS.includes('demo-builder'));
    await api(OWNER, 'DELETE', '/api/demos/' + d.slug);
  });
  await t('without the LEADS binding: 503', async () => {
    const r = await priv.fetch(new Request('https://apps.example/api/demos', { headers: { 'Cf-Access-Jwt-Assertion': await token(OWNER) } }), { ...env, LEADS: undefined });
    assert.strictEqual(r.status, 503);
  });

  // ── validation ─────────────────────────────────────────────────────────────────────────────────────────────
  const bad = async (over, field) => {
    const r = await api(OWNER, 'POST', '/api/demos', good(over)), j = await r.json();
    assert.strictEqual(r.status, 400, JSON.stringify(over).slice(0, 80));
    assert.ok(j.fields.includes(field), field + ' in ' + JSON.stringify(j));
  };
  await t('validation: colours must be #rrggbb', async () => {
    for (const c of ['red', '#fff', '#12345', '#GGGGGG', 'rgb(1,2,3)', '#0B7A75; background:url(x)', 5, null]) await bad({ accent: c }, 'accent');
    await bad({ accent2: 'blue' }, 'accent2');
  });
  await t('validation: app ids come from the allowed set; private and Studio apps are refused; no empty or repeated list', async () => {
    for (const id of ['billing', 'invoices', 'desk', 'cashflow', 'client-atlas', 'home', 'demo-builder', 'showcase', 'design-compare', 'nope', '../x', '']) await bad({ apps: ['collections', id] }, 'apps');
    await bad({ apps: [] }, 'apps'); await bad({ apps: 'collections' }, 'apps'); await bad({ apps: ['crm', 'crm'] }, 'apps'); await bad({ apps: undefined }, 'apps');
  });
  await t('validation: lengths (name 80, news title 120, text 600), language, booking https only, expiry', async () => {
    await bad({ name: '' }, 'name'); await bad({ name: '   ' }, 'name'); await bad({ name: 'x'.repeat(81) }, 'name');
    assert.strictEqual((await api(OWNER, 'POST', '/api/demos', good({ name: 'x'.repeat(80), logo: undefined }))).status, 201);
    await bad({ news: { title: 'x'.repeat(121), text: '' } }, 'news'); await bad({ news: { title: 'ok', text: 'x'.repeat(601) } }, 'news'); await bad({ news: { title: '', text: 'only text' } }, 'news');
    assert.strictEqual((await api(OWNER, 'POST', '/api/demos', good({ news: { title: 'x'.repeat(120), text: 'y'.repeat(600) }, logo: undefined }))).status, 201);
    await bad({ lang: 'fr' }, 'lang');
    for (const u of ['http://cal.com/x', 'javascript:alert(1)', 'ftp://x.example/a', 'https://', 'https://user:pw@cal.com/x', '//cal.com/x', 'https://localhost/x', 'https://' + 'a'.repeat(300) + '.com']) await bad({ booking: u }, 'booking');
    await bad({ expires: ds(-3) }, 'expires'); await bad({ expires: 'tomorrow' }, 'expires'); await bad({ expires: '2026-02-30' }, 'expires'); await bad({ expires: ds(500) }, 'expires');
    const all = await (await api(OWNER, 'GET', '/api/demos')).json();
    for (const d of all.demos) await api(OWNER, 'DELETE', '/api/demos/' + d.slug);
  });
  await t('validation: the logo must be a PNG (signature), at most 300 KB; SVG, JPEG, text and broken base64 are refused', async () => {
    // signature + IHDR chunk of the real PNG, filler, its IEND chunk: exactly len bytes
    const png = (len) => Buffer.concat([PNG_BYTES.subarray(0, 33), Buffer.alloc(len - 45, 1), PNG_BYTES.subarray(-12)]).toString('base64');
    assert.strictEqual((await api(OWNER, 'POST', '/api/demos', good({ logo: png(300 * 1024) }))).status, 201, 'exactly 300 KB is fine');
    await bad({ logo: png(300 * 1024 + 1) }, 'logo');
    await bad({ logo: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>' + ' '.repeat(40)).toString('base64') }, 'logo');
    await bad({ logo: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60)]).toString('base64') }, 'logo');
    // a PNG signature in front of something else (HTML, a script) is not a PNG: IHDR must come first and IEND last
    await bad({ logo: Buffer.concat([PNG_BYTES.subarray(0, 8), Buffer.from('<html><script>alert(1)</script></html>' + ' '.repeat(40))]).toString('base64') }, 'logo');
    await bad({ logo: Buffer.concat([PNG_BYTES.subarray(0, 33), Buffer.from('<script>alert(1)</script>' + ' '.repeat(40))]).toString('base64') }, 'logo');
    assert.ok(S.decodeLogo(PNG_B64) && !S.decodeLogo(Buffer.concat([PNG_BYTES, Buffer.from('<x>')]).toString('base64')), 'nothing may follow IEND');
    await bad({ logo: 'not base64 !!!' }, 'logo'); await bad({ logo: 12 }, 'logo'); await bad({ logo: 'iVBORw0KGgo=' }, 'logo');
    assert.strictEqual((await api(OWNER, 'POST', '/api/demos', good({ logo: 'data:image/png;base64,' + PNG_B64 }))).status, 201, 'a data: URL of a PNG is accepted');
    const huge = await priv.fetch(new Request('https://apps.example/api/demos', { method: 'POST', headers: { 'Cf-Access-Jwt-Assertion': await token(OWNER), 'X-Stratum-Apps': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(good({ news: undefined, logo: 'A'.repeat(600 * 1024) })) }), env);
    assert.strictEqual(huge.status, 413);
    assert.strictEqual((await priv.fetch(new Request('https://apps.example/api/demos', { method: 'POST', headers: { 'Cf-Access-Jwt-Assertion': await token(OWNER), 'X-Stratum-Apps': '1', 'Content-Type': 'text/plain' }, body: '{}' }), env)).status, 415);
    const all = await (await api(OWNER, 'GET', '/api/demos')).json();
    for (const d of all.demos) await api(OWNER, 'DELETE', '/api/demos/' + d.slug);
  });
  await t('nothing about a person is stored: no e-mail, no IP address, no user agent in any object', async () => {
    await api(OWNER, 'POST', '/api/demos', good(), { 'CF-Connecting-IP': '203.0.113.9', 'User-Agent': 'TestAgent/1' });
    const text = [...LEADS.store.entries()].filter(([k]) => k.startsWith('demos/') && !k.endsWith('.png')).map(([, o]) => Buffer.from(o.bytes).toString('utf8')).join('\n');
    assert.ok(!/@|203\.0\.113|TestAgent|example\.com/.test(text), text);
  });

  // ── the public page and data ───────────────────────────────────────────────────────────────────────────────
  let live, dead;
  await t('public: a live demo gives its settings as JSON without internal fields, with private headers', async () => {
    live = (await (await api(OWNER, 'POST', '/api/demos', good({ expires: ds(200) }))).json()).slug;
    const r = await pub.fetch(new Request('https://clearfigure.example/api/demo/' + live, { headers: { 'User-Agent': BROWSER } }), penv);
    assert.strictEqual(r.status, 200);
    const j = await r.json();
    assert.deepStrictEqual(Object.keys(j).sort(), ['accent', 'accent2', 'apps', 'booking', 'expires', 'lang', 'logo', 'name', 'news'].sort());
    assert.deepStrictEqual(j.apps, ['collections', 'crm', 'erp']); assert.strictEqual(j.name, 'Hladilni Sistemi Kovač d.o.o.'); assert.strictEqual(j.logo, true);
    const raw = JSON.stringify(j);
    assert.ok(!raw.includes(live) && !/created|updated|slug|"v"/.test(raw));
    for (const [k, v] of [['Cache-Control', 'no-store'], ['Referrer-Policy', 'no-referrer'], ['X-Content-Type-Options', 'nosniff'], ['X-Robots-Tag', 'noindex, nofollow, noarchive']]) assert.strictEqual(r.headers.get(k), v, k);
    assert.match(r.headers.get('Content-Security-Policy'), /default-src 'none'; script-src 'self'; style-src 'self'/);
  });
  await t('public: the logo is image/png with nosniff; a demo without a logo has none', async () => {
    const r = await pget('/api/demo/' + live + '/logo.png');
    assert.strictEqual(r.status, 200); assert.strictEqual(r.headers.get('Content-Type'), 'image/png'); assert.strictEqual(r.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.deepStrictEqual(Buffer.from(await r.arrayBuffer()), PNG_BYTES);
    const nl = (await (await api(OWNER, 'POST', '/api/demos', good({ logo: undefined, expires: ds(200) }))).json()).slug;
    assert.strictEqual((await pget('/api/demo/' + nl + '/logo.png')).status, 404);
    await api(OWNER, 'DELETE', '/api/demos/' + nl);
  });
  await t('public: an expired and an unknown demo give exactly the same 404 (status, body, headers), for the data, the logo and the page', async () => {
    dead = (await (await api(OWNER, 'POST', '/api/demos', good())).json()).slug;
    await api(OWNER, 'PATCH', '/api/demos/' + dead, { expireNow: true });
    const unknown = 'nonexistent-abcdefghij';
    for (const suffix of ['', '/logo.png']) {
      const a = await pget('/api/demo/' + dead + suffix), b = await pget('/api/demo/' + unknown + suffix), c = await pget('/api/demo/not a slug' + suffix);
      assert.strictEqual(a.status, 404);
      const [ta, tb, tc] = [await a.text(), await b.text(), await c.text()];
      assert.strictEqual(ta, tb); assert.strictEqual(tb, tc);
      assert.deepStrictEqual([...a.headers], [...b.headers]);
    }
    const pa = await pget('/d/' + dead), pb = await pget('/d/' + unknown), pc = await pget('/d/x/y');
    assert.strictEqual(pa.status, 404);
    assert.strictEqual(await pa.text(), await pb.text()); assert.strictEqual(pb.status, 404); assert.strictEqual(pc.status, 404);
    assert.deepStrictEqual([...pa.headers], [...pb.headers]);
    assert.strictEqual(pa.headers.get('X-Robots-Tag'), 'noindex, nofollow, noarchive');
    assert.deepStrictEqual(await views(dead), { count: 0, last: null }, 'an expired demo is not counted');
    assert.ok(!(await (await pget('/d/' + dead)).text()).includes(dead));
  });
  await t('public: /d/<slug> serves the page shell (from /demo/) with the strict CSP, noindex and no referrer; no other method gives it', async () => {
    asked.length = 0;
    const before = await views(live);
    const r = await pget('/d/' + live);
    assert.strictEqual(r.status, 200); assert.match(r.headers.get('Content-Type'), /text\/html/);
    assert.deepStrictEqual(asked, ['/demo/']);
    assert.match(await r.text(), /shell/);
    assert.strictEqual(r.headers.get('Referrer-Policy'), 'no-referrer'); assert.strictEqual(r.headers.get('X-Robots-Tag'), 'noindex, nofollow, noarchive'); assert.strictEqual(r.headers.get('X-Frame-Options'), 'DENY');
    assert.match(r.headers.get('Content-Security-Policy'), /frame-ancestors 'none'/);
    assert.strictEqual((await pub.fetch(new Request('https://clearfigure.example/d/' + live, { method: 'POST' }), penv)).status, 404);
    assert.deepStrictEqual(await views(live), before, 'loading the shell is not a view');
  });
  await t('views: one count per config request with the time; link previews, bots, prefetch and ?c=0 do not count; nothing but count and last is stored', async () => {
    await LEADS.put('demos/' + live + '/views.json', JSON.stringify({ count: 0, last: null }));
    const at = (ms) => pub.fetch(new Request('https://clearfigure.example/api/demo/' + live, { headers: { 'User-Agent': BROWSER, 'CF-Connecting-IP': '203.0.113.5', Cookie: 'a=b' } }), penv).then((r) => { assert.strictEqual(r.status, 200); });
    await at(); await at();
    const v = await views(live);
    assert.strictEqual(v.count, 2); assert.ok(Math.abs(Date.parse(v.last) - Date.now()) < 5000);
    assert.deepStrictEqual(Object.keys(v).sort(), ['count', 'last']);
    for (const ua of ['Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)', 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)', 'WhatsApp/2.23.20 A', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Microsoft Teams Preview', 'Twitterbot/1.0', 'LinkedInBot/1.0 (compatible; Mozilla/5.0)', 'curl/8.4.0 (x86_64-apple-darwin)', 'SkypeUriPreview Preview/0.5', 'Mozilla/5.0 (compatible; bingbot/2.0)', '', 'x']) {
      const r = await pub.fetch(new Request('https://clearfigure.example/api/demo/' + live, { headers: ua ? { 'User-Agent': ua } : {} }), penv);
      assert.strictEqual(r.status, 200, 'bots still get the page data');
    }
    await pub.fetch(new Request('https://clearfigure.example/api/demo/' + live, { headers: { 'User-Agent': BROWSER, Purpose: 'prefetch' } }), penv);
    await pub.fetch(new Request('https://clearfigure.example/api/demo/' + live + '?c=0', { headers: { 'User-Agent': BROWSER } }), penv);
    await pget('/api/demo/' + live + '/logo.png');
    assert.strictEqual((await views(live)).count, 2);
    for (const ua of ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 Edg/126.0', 'Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0']) await pget('/api/demo/' + live, ua);
    assert.strictEqual((await views(live)).count, 5, 'phone, Edge and Firefox browsers count');
    const list = await (await api(OWNER, 'GET', '/api/demos')).json();
    assert.strictEqual(list.demos.find((d) => d.slug === live).views.count, 5);
  });
  await t('public worker: only /d/* and /api/demo/* are new; other /api/ paths stay 404, the contact route is untouched', async () => {
    const r = await pget('/api/other'); assert.strictEqual(r.status, 404); assert.deepStrictEqual(await r.json(), { ok: false, error: 'not_found' });
    assert.strictEqual((await pub.fetch(new Request('https://clearfigure.example/api/contact'), penv)).status, 405);
    assert.strictEqual((await pget('/api/demo/')).status, 404);
    assert.strictEqual((await pub.fetch(new Request('https://clearfigure.example/api/demo/' + live, { method: 'POST' }), penv)).status, 404);
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/wrangler.jsonc'), 'utf8').replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1'));
    assert.ok(cfg.assets.run_worker_first.includes('/api/*') && cfg.assets.run_worker_first.includes('/d/*'));
    assert.ok(cfg.r2_buckets.some((b) => b.binding === 'LEADS'));
    const root = JSON.parse(fs.readFileSync(path.join(ROOT, 'wrangler.jsonc'), 'utf8').replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1'));
    assert.ok(root.r2_buckets.some((b) => b.binding === 'LEADS' && b.bucket_name === 'clearfigure-leads'), 'the private Worker has the same bucket');
  });
  await t('clean-up: opening the list removes demos that expired more than 90 days ago (with logo and counter), not newer ones', async () => {
    const old = (await (await api(OWNER, 'POST', '/api/demos', good())).json()).slug, recent = (await (await api(OWNER, 'POST', '/api/demos', good())).json()).slug;
    const put = async (slug, expires) => { const k = 'demos/' + slug + '/config.json'; const c = JSON.parse(Buffer.from(LEADS.store.get(k).bytes).toString()); c.expires = expires; await LEADS.put(k, JSON.stringify(c)); };
    await put(old, new Date(Date.now() - 91 * DAY).toISOString()); await put(recent, new Date(Date.now() - 89 * DAY).toISOString());
    const j = await (await api(OWNER, 'GET', '/api/demos')).json();
    const slugs = j.demos.map((d) => d.slug);
    assert.ok(!slugs.includes(old) && slugs.includes(recent) && slugs.includes(live));
    assert.deepStrictEqual([...LEADS.store.keys()].filter((k) => k.startsWith('demos/' + old + '/')), []);
    assert.ok(j.demos.find((d) => d.slug === recent).expired === true);
  });

  // ── the app list, colours, helpers ────────────────────────────────────────────────────────────────────────
  const CAT = require(path.join(ROOT, 'site/_shared/demo-catalog.js'));
  const SHEETS = require(path.join(ROOT, 'site/_shared/app-sheets.js'));
  const html = fs.readFileSync(path.join(ROOT, 'site/index.html'), 'utf8');
  await t('the app list: every private app of PRIVATE_APPS and the Studio pages are out, every offered app has a sheet, a home page card with the same name and an icon', async () => {
    const ids = CAT.ids();
    for (const id of PRIVATE_APPS) assert.ok(!ids.includes(id) && !S.ALLOWED_APPS.includes(id), id);
    for (const id of ['showcase', 'design-compare', 'client-atlas']) assert.ok(!ids.includes(id), id);
    assert.deepStrictEqual(S.ALLOWED_APPS, ids);
    assert.ok(ids.length >= 25 && ids.includes('collections') && ids.includes('crm'));
    for (const a of CAT.offered()) {
      assert.ok(SHEETS[a.id], a.id + ' sheet');
      assert.ok(fs.existsSync(path.join(ROOT, 'site/icons/apps', a.id + '.png')), a.id + ' icon');
      const m = html.match(new RegExp('<article class="card" data-app="' + a.id + '"[^>]*>[\\s\\S]*?<a class="open" href="[^"]*">([^<]+)</a>'));
      assert.ok(m, a.id + ' card'); assert.strictEqual(m[1].replace(/&amp;/g, '&'), a.name, a.id + ' name');
    }
    for (const a of CAT.APPS) if (a[0] !== 'demo-builder') assert.ok(SHEETS[a[0]], a[0]);
  });
  await t('the public demo copies in the catalog are the build\'s DEMO_APPS', async () => {
    const B = await import(pathToFileURL(path.join(ROOT, 'tools/build-public.mjs')).href);
    assert.deepStrictEqual([...CAT.COPIES].sort(), [...B.DEMO_APPS].sort());
  });
  const R = require(path.join(ROOT, 'site/_shared/demo-render.js'));
  const ST = require(path.join(ROOT, 'site/_shared/demo-strings.js'));
  await t('XSS: every prospect string is escaped in the page markup, a non-https booking link gives no link, colours only ever become #rrggbb', async () => {
    function render(cfg) {
      let el; const props = [];
      const doc = { createElement: () => (el = { style: { setProperty: (k, v) => props.push([k, v]) }, setAttribute() {}, removeAttribute() {}, addEventListener() {}, innerHTML: '' }) };
      R.mount({ ownerDocument: doc, appendChild() {} }, cfg, { logoUrl: '/api/demo/x/logo.png' });
      return { html: el.innerHTML, props };
    }
    const evil = '"><img src=x onerror=alert(1)><script>alert(2)</script>\'';
    const cfg = { name: evil, lang: 'en', accent: 'red;background:url(https://evil.example/x)', accent2: '#000000"; x: y', apps: ['crm'], logo: true,
      news: { title: evil, text: evil + '\n' + evil, date: '2026-10-17' }, booking: 'https://cal.example/a?b="><script>alert(3)</script>', expires: '2026-12-01T23:59:59.999Z' };
    let { html, props } = render(cfg);
    assert.ok(!/<script|<img src=x/.test(html), html);
    assert.ok(html.includes('&lt;script&gt;alert(2)&lt;/script&gt;') && html.includes('&quot;&gt;&lt;img src=x onerror=alert(1)&gt;'), 'escaped, still readable');
    assert.ok(html.includes('href="https://cal.example/a?b=&quot;&gt;&lt;script&gt;alert(3)&lt;/script&gt;"'), 'the booking link stays inside its attribute');
    assert.ok(!/style=/.test(html), 'no inline style attributes (the CSP has no unsafe-inline)');
    assert.ok(props.length && props.every(([k, v]) => /^--c[a-z0-9]*$/.test(k) && /^#[0-9a-f]{6}$/.test(v)), JSON.stringify(props));
    for (const booking of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>alert(1)</script>', 'http://cal.example/', ' https://x.example']) {
      ({ html } = render({ ...cfg, booking }));
      assert.ok(!/javascript:|data:text|http:\/\/cal|x\.example/i.test(html) && !html.includes('dv-topbook'), booking);
    }
    // the same strings pass the server's checks only as plain text (the renderer above is the last line, not the only one)
    const r = S.buildConfig({ ...good(), name: evil.slice(0, 80), booking: 'javascript:alert(1)//https://x' }, null, Date.now());
    assert.deepStrictEqual(r.fields, ['booking']);
    for (const booking of ['data:text/html,x', 'http://x.example/', 'https://user:pw@x.example/', 'https://localhost/', 'https://x.example/' + 'a'.repeat(300)]) assert.deepStrictEqual(S.buildConfig({ ...good(), booking }, null, Date.now()).fields, ['booking'], booking);
  });
  await t('colours: white text on the accent is at least 4.5:1 for any colour (a light colour is darkened), text on the tint too, light and dark', async () => {
    assert.ok(Math.abs(R.contrast('#000000', '#ffffff') - 21) < 0.01);
    for (const c of ['#ffff00', '#ffffff', '#e0a526', '#0b7a75', '#00ff00', '#ff00ff', '#000000', '#123456', '#f5f5f5', '#0f6cbd']) {
      const p = R.palette(c, '#e0a526');
      assert.ok(R.contrast('#ffffff', p['--c']) >= 4.5, c + ' button ' + p['--c']);
      assert.ok(R.contrast(p['--cink'], p['--ct']) >= 4.5, c + ' ink on tint');
      assert.ok(R.contrast(p['--cinkd'], p['--ctd']) >= 4.5, c + ' dark ink on tint');
      assert.strictEqual(p['--c2'], '#e0a526');
    }
    assert.strictEqual(R.palette('#0f6cbd')['--c'], '#0f6cbd', 'a colour that already passes is kept');
    assert.notStrictEqual(R.palette('#ffff00')['--c'], '#ffff00');
    assert.strictEqual(R.palette('nope')['--c'], '#0f6cbd', 'a broken colour falls back');
    assert.strictEqual(R.initials('Bregar & Partnerji'), 'BP'); assert.strictEqual(R.initials('Acme'), 'AC'); assert.strictEqual(R.initials('  '), '?');
  });
  await t('page texts: EN, SL, HR and DE have the same keys, filled; {name} and {date} stay where they are', async () => {
    const keys = Object.keys(ST.en).sort();
    for (const l of S.LANGS) { assert.deepStrictEqual(Object.keys(ST[l]).sort(), keys, l); for (const k of keys) assert.ok(String(ST[l][k]).trim(), l + '.' + k); }
    for (const l of S.LANGS) { assert.ok(ST[l].welcome.includes('{name}') && ST[l].prepared.includes('{name}') && ST[l].valid.includes('{date}'), l); }
    assert.notStrictEqual(ST.sl.book, ST.en.book); assert.notStrictEqual(ST.de.book, ST.en.book);
    assert.ok(R.fmtDate('2026-12-15T23:59:59.999Z', 'de').includes('2026') && R.fmtDate('2026-12-15', 'en', true).includes('15'));
  });
  const L = require(path.join(ROOT, 'site/demo-builder/lib.js'));
  await t('editor helpers: image type by its bytes, resize, expiry date, dominant colours from pixels, views text', async () => {
    assert.strictEqual(L.sniff(PNG_BYTES), 'png'); assert.strictEqual(L.sniff(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)])), 'jpeg');
    assert.strictEqual(L.sniff(Buffer.from('RIFF\0\0\0\0WEBPVP8 ')), 'webp'); assert.strictEqual(L.sniff(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), null); assert.strictEqual(L.sniff(Buffer.from('GIF89a......')), null);
    assert.deepStrictEqual(L.fit(1000, 500, 256), { w: 256, h: 128 }); assert.deepStrictEqual(L.fit(100, 80, 256), { w: 100, h: 80 });
    assert.strictEqual(L.expiryIn(NOW, 60), '2026-12-16');
    const px = []; const add = (c, k) => { for (let i = 0; i < k; i++) px.push(...c, 255); };
    add([11, 122, 117], 500); add([224, 165, 38], 300); add([250, 250, 250], 4000); add([12, 120, 118], 100); px.push(200, 10, 10, 0); add([40, 40, 40], 200);
    const d = L.dominant(Uint8ClampedArray.from(px), 3);
    assert.ok(R.contrast(d[0], '#0b7a75') < 1.1, 'the teal first');
    assert.ok(d.length === 3 && R.contrast(d[1], '#e0a526') < 1.1, 'then the amber (similar teals merge, white and transparent are ignored)');
    assert.ok(d.every((c) => /^#[0-9a-f]{6}$/.test(c)) && !d.includes('#fafafa'));
    assert.strictEqual(L.viewsText({ count: 0, last: null }), 'not opened yet');
    assert.strictEqual(L.viewsText({ count: 3, last: '2026-10-17T14:12:00Z' }, 'UTC'), 'opened 3 times, last 17 Oct 14:12');
    assert.strictEqual(L.viewsText({ count: 1, last: '2026-10-17T14:12:00Z' }, 'UTC'), 'opened once, last 17 Oct 14:12');
  });

  globalThis.fetch = realFetch;
  console.log('branded-demo: ' + n + ' tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
