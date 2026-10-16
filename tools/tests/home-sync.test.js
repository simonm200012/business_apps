// Home page: pins and "Needs you today" on two devices (site/home-looks/sync.js), the merge rules and a run against the
// real Worker (worker/index.js + worker/access.js, Access tokens signed with a test key) over an in-memory R2.
// Run: node tools/tests/home-sync.test.js
'use strict';
const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '../..');
const H = require(path.join(ROOT, 'site/home-looks/sync.js'));
const eq = (a, b, m) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), m);
const T0 = Date.parse('2026-10-15T08:00:00Z');
const iso = (t) => new Date(t).toISOString();
const need = (t, text, n) => ({ at: iso(t), items: [{ text: text || 'Something waits', count: n || 1, href: '/x/', tone: 'warn' }] });
let n = 0;
async function t(name, fn) { await fn(); n++; console.log('ok', n, name); }

// ── in-memory R2, as the Workers binding behaves (only what the snapshot routes use) ─────────────────────────────────
function makeR2() {
  const store = new Map(); let k = 0;
  const meta = (key, o) => ({ key, size: o.bytes.byteLength, etag: o.etag, uploaded: o.uploaded, customMetadata: { ...o.customMetadata }, httpMetadata: { ...o.httpMetadata } });
  return {
    store,
    async head(key) { const o = store.get(key); return o ? meta(key, o) : null; },
    async get(key, opts = {}) {
      const o = store.get(key); if (!o) return null;
      const m = meta(key, o);
      if (opts.onlyIf && opts.onlyIf.etagMatches && opts.onlyIf.etagMatches !== o.etag) return m;
      return { ...m, body: new Blob([o.bytes]).stream(), text: async () => Buffer.from(o.bytes).toString('utf8') };
    },
    async put(key, body, opts = {}) {
      const bytes = new Uint8Array(await new Response(body).arrayBuffer());
      const cur = store.get(key);
      if (opts.onlyIf && opts.onlyIf.etagMatches && (!cur || cur.etag !== opts.onlyIf.etagMatches)) return null;
      const o = { bytes, etag: 'e' + (++k), uploaded: new Date(), customMetadata: { ...(opts.customMetadata || {}) }, httpMetadata: { ...(opts.httpMetadata || {}) } };
      store.set(key, o); return meta(key, o);
    },
    async delete(keys) { for (const x of [].concat(keys)) store.delete(x); },
    async list(opts = {}) {
      const prefix = opts.prefix || '';
      const objects = [...store.keys()].filter((x) => x.startsWith(prefix)).sort().map((x) => meta(x, store.get(x)));
      return { objects, truncated: false, delimitedPrefixes: [] };
    }
  };
}

(async function main() {
  // ── merge rules ──────────────────────────────────────────────────────────────────────────────────────────────────
  await t('first sync, nothing in the cloud: this device uploads its pins and needs, the private apps\' too ("home" is private)', async () => {
    const r = H.merge({ pins: ['crm', 'billing'], needs: { crm: need(T0 - 6e4), billing: need(T0 - 6e4, 'Overdue invoices', 3) } }, null, null, T0);
    eq(r.cloud.pins, ['crm', 'billing']);
    eq(Object.keys(r.cloud.needs).sort(), ['billing', 'crm'], 'Billing\'s report syncs: only the owner reads "home"');
    assert.ok(r.cloudChanged);
  });
  await t('first sync on a second device keeps the cloud order and adds its own pins after it', async () => {
    const cloud = { v: 1, pins: ['erp', 'crm'], pinsAt: iso(T0 - 864e5), needs: {} };
    const r = H.merge({ pins: ['leave', 'crm'], needs: {} }, cloud, null, T0);
    eq(r.local.pins, ['erp', 'crm', 'leave']);
    assert.ok(r.localChanged && r.cloudChanged);
  });
  await t('pins: only the cloud changed → take it; only this device changed → upload; both → the later change wins', async () => {
    const meta = { gen: 3, pins: ['erp'], pinsAt: iso(T0 - 2 * 36e5), needs: {} };
    let r = H.merge({ pins: ['erp'], needs: {} }, { v: 1, pins: ['erp', 'crm'], pinsAt: iso(T0 - 36e5), needs: {} }, meta, T0);
    eq(r.local.pins, ['erp', 'crm']); assert.ok(r.localChanged && !r.cloudChanged);
    r = H.merge({ pins: ['crm'], needs: {} }, { v: 1, pins: ['erp'], pinsAt: meta.pinsAt, needs: {} }, { ...meta, dirtyPinsAt: iso(T0 - 6e5) }, T0);
    eq(r.cloud.pins, ['crm']); eq(r.cloud.pinsAt, iso(T0 - 6e5)); assert.ok(r.cloudChanged && !r.localChanged);
    r = H.merge({ pins: ['crm'], needs: {} }, { v: 1, pins: ['leave'], pinsAt: iso(T0 - 6e4), needs: {} }, { ...meta, dirtyPinsAt: iso(T0 - 6e5) }, T0);
    eq(r.local.pins, ['leave'], 'the other device changed later');
    r = H.merge({ pins: ['crm'], needs: {} }, { v: 1, pins: ['leave'], pinsAt: iso(T0 - 9e5), needs: {} }, { ...meta, dirtyPinsAt: iso(T0 - 6e5) }, T0);
    eq(r.cloud.pins, ['crm'], 'this device changed later');
  });
  await t('needs: the newest report per app wins, from either device; reports older than 7 days are dropped', async () => {
    const cloud = { v: 1, pins: [], pinsAt: '', needs: { crm: need(T0 - 36e5, 'cloud crm'), erp: need(T0 - 6e4, 'cloud erp'), old: need(T0 - 8 * 864e5) } };
    const r = H.merge({ pins: [], needs: { crm: need(T0 - 6e4, 'local crm'), erp: need(T0 - 36e5, 'local erp') } }, cloud, { gen: 1, pins: [], pinsAt: '', needs: {} }, T0);
    eq(r.local.needs.crm.items[0].text, 'local crm');
    eq(r.local.needs.erp.items[0].text, 'cloud erp');
    assert.ok(!r.cloud.needs.old && !r.local.needs.old);
  });
  await t('needs: an app cleared on this device leaves a cleared mark, so the other device drops it too', async () => {
    const seen = need(T0 - 36e5, 'Letters ready');
    const meta = { gen: 2, pins: [], pinsAt: '', needs: { collections: seen.at } };
    const r = H.merge({ pins: [], needs: {} }, { v: 1, pins: [], pinsAt: '', needs: { collections: seen } }, meta, T0);
    eq(r.cloud.needs.collections, { at: iso(T0), items: [] });
    assert.ok(!r.local.needs.collections && r.cloudChanged);
    // the other device, which still shows it, takes the mark
    const r2 = H.merge({ pins: [], needs: { collections: seen } }, r.cloud, meta, T0 + 6e4);
    assert.ok(!r2.local.needs.collections && r2.localChanged);
    // ...unless it reported again after the clear
    const r3 = H.merge({ pins: [], needs: { collections: need(T0 + 3e4, 'Again') } }, r.cloud, meta, T0 + 6e4);
    eq(r3.local.needs.collections.items[0].text, 'Again');
  });
  await t('needs: a newer report from the other device is taken, not mistaken for a clear', async () => {
    const meta = { gen: 2, pins: [], pinsAt: '', needs: { parcels: iso(T0 - 36e5) } };
    const r = H.merge({ pins: [], needs: {} }, { v: 1, pins: [], pinsAt: '', needs: { parcels: need(T0 - 6e4, 'New') } }, meta, T0);
    eq(r.local.needs.parcels.items[0].text, 'New');
  });
  await t('bad data is ignored: unknown ids, foreign links, junk in the cloud copy', async () => {
    const cloud = { v: 1, pins: ['crm', '../x', 'crm', 7], pinsAt: 'no', needs: { 'Bad Id': need(T0), crm: { at: iso(T0 - 6e4), items: [{ text: 'x', href: 'https://evil.example/' }, null, { text: '' }] } } };
    const r = H.merge({ pins: [], needs: {} }, cloud, null, T0);
    eq(r.local.pins, ['crm']);
    eq(r.local.needs, { crm: { at: iso(T0 - 6e4), items: [{ text: 'x' }] } });
    eq(H.merge({ pins: [], needs: {} }, 'junk', null, T0).cloudChanged, false, 'nothing to upload from an empty device');
  });
  await t('nothing changed on either side → nothing to upload, nothing to redraw', async () => {
    const cloud = { v: 1, pins: ['crm'], pinsAt: iso(T0 - 36e5), needs: { crm: need(T0 - 6e4) } };
    const r = H.merge({ pins: ['crm'], needs: { crm: need(T0 - 6e4) } }, cloud, { gen: 4, pins: ['crm'], pinsAt: cloud.pinsAt, needs: { crm: cloud.needs.crm.at } }, T0);
    assert.ok(!r.cloudChanged && !r.localChanged);
  });

  // ── two devices against the real Worker ──────────────────────────────────────────────────────────────────────────
  const TEAM = 'team.example', AUD = 'aud-test', OWNER = 'owner@example.com', VIEWER = 'viewer@example.com';
  const b64u = (b) => Buffer.from(b).toString('base64url');
  const keyPair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = { ...(await crypto.subtle.exportKey('jwk', keyPair.publicKey)), kid: 'k1' };
  async function token(email) {
    const h = b64u(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' }));
    const p = b64u(JSON.stringify({ aud: [AUD], email, iss: 'https://' + TEAM, exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000) }));
    return h + '.' + p + '.' + b64u(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keyPair.privateKey, new TextEncoder().encode(h + '.' + p)));
  }
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, i) => (String(u) === 'https://' + TEAM + '/cdn-cgi/access/certs' ? new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'Content-Type': 'application/json' } }) : realFetch(u, i));
  const worker = (await import(pathToFileURL(path.join(ROOT, 'worker/index.js')).href)).default;
  const r2 = makeR2();
  const env = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, OWNER_EMAIL: OWNER, OWNER_NAME: 'Owner', VIEWER_EMAILS: VIEWER, SYNC: r2, ASSETS: null };
  let clock = T0;
  function device(email, tok) {
    const ls = new Map(), d = { ls, redraws: 0, puts: 0 };
    d.storage = { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)) };
    d.runner = H.createRunner({
      storage: d.storage, now: () => clock, onLocalChange: () => { d.redraws++; },
      fetch: async (url, init = {}) => {
        const headers = new Headers(init.headers || {}); headers.set('Cf-Access-Jwt-Assertion', tok);
        if ((init.method || 'GET') === 'PUT') { d.puts++; headers.set('Content-Length', String(Buffer.byteLength(init.body))); }
        return worker.fetch(new Request('https://apps.example' + url, { method: init.method || 'GET', headers, body: init.body }), env);
      }
    });
    d.pins = () => JSON.parse(ls.get('stratum-apps-pins') || '[]');
    d.needs = () => JSON.parse(ls.get('stratum-needs') || '{}');
    d.set = (k, v) => ls.set(k, JSON.stringify(v));
    return d;
  }
  const ownerTok = await token(OWNER);
  const mac = device(OWNER, ownerTok), phone = device(OWNER, ownerTok);

  await t('Mac pins two apps; the phone opens the home page and shows them, with the Mac\'s needs', async () => {
    mac.set('stratum-apps-pins', ['crm', 'erp']);
    mac.set('stratum-needs', { crm: need(clock - 6e4, 'Deals to follow up', 4), billing: need(clock - 6e4, 'Overdue', 2) });
    assert.strictEqual(await mac.runner.run(), 'uploaded');
    const saved = JSON.parse(await (await r2.get([...r2.store.keys()].find((k) => k.endsWith('/home.json')))).text());
    assert.ok(saved.needs.billing && saved.needs.crm, 'Billing\'s report is in the (private) cloud copy');
    phone.set('stratum-needs', { invoices: need(clock - 3e4, 'Unpaid', 1) });
    assert.strictEqual(await phone.runner.run(), 'uploaded', 'the phone adds its own Invoices report to the cloud copy');
    eq(phone.pins(), ['crm', 'erp']);
    eq(Object.keys(phone.needs()).sort(), ['billing', 'crm', 'invoices']);
    assert.strictEqual(phone.redraws, 1);
  });
  await t('the phone unpins one; the Mac follows; nothing uploads when nothing changed', async () => {
    clock += 6e4;
    phone.set('stratum-apps-pins', ['erp']);
    assert.ok(phone.runner.dirty());
    assert.strictEqual(await phone.runner.check(), 'uploaded');
    clock += 6e4;
    assert.strictEqual(await mac.runner.run(), 'downloaded');
    eq(mac.pins(), ['erp']);
    const puts = mac.puts;
    assert.strictEqual(await mac.runner.check(), 'same');
    assert.strictEqual(await mac.runner.run(), 'same');
    assert.strictEqual(mac.puts, puts, 'no upload');
  });
  await t('both change at once: the second upload gets a conflict, merges again and keeps both reports', async () => {
    clock += 6e4;
    mac.set('stratum-needs', Object.assign(mac.needs(), { parcels: need(clock, 'COD payouts overdue', 3) }));
    phone.set('stratum-needs', Object.assign(phone.needs(), { leave: need(clock + 1e3, 'Requests to approve', 2) }));
    const before = mac.puts + phone.puts;
    eq(await Promise.all([mac.runner.run(), phone.runner.run()]), ['uploaded', 'uploaded']);
    assert.strictEqual(mac.puts + phone.puts - before, 3, 'one of the two uploads was refused (409) and sent again');
    assert.strictEqual(await mac.runner.run(), 'downloaded');
    for (const d of [mac, phone]) assert.ok(d.needs().parcels && d.needs().leave, 'both reports on both devices');
  });
  await t('an app clears its report on the Mac; the phone drops it too', async () => {
    clock += 6e4;
    const m = mac.needs(); delete m.parcels; mac.set('stratum-needs', m);
    assert.strictEqual(await mac.runner.check(), 'uploaded');
    await phone.runner.run();
    assert.ok(!phone.needs().parcels && phone.needs().leave);
  });
  await t('a view-only person never uploads and never takes the owner\'s pins', async () => {
    const v = device(VIEWER, await token(VIEWER));
    v.set('stratum-apps-pins', ['crm']);
    assert.strictEqual(await v.runner.run(), 'off');
    assert.strictEqual(v.puts, 0); eq(v.pins(), ['crm']);
    assert.strictEqual(await v.runner.check(), 'off');
    const res = await worker.fetch(new Request('https://apps.example/api/sync/home', { headers: { 'Cf-Access-Jwt-Assertion': await token(VIEWER), 'X-Stratum-Apps': '1' } }), env);
    assert.strictEqual(res.status, 403, 'view-only people never read "home" (PRIVATE_APPS)');
  });
  await t('a site without the sync server (auth config says off) stays off', async () => {
    const d = device(OWNER, ownerTok);
    const r = H.createRunner({ storage: d.storage, now: () => clock, onLocalChange() {}, fetch: async () => new Response('{"enabled":false}', { headers: { 'Content-Type': 'application/json' } }) });
    d.set('stratum-apps-pins', ['crm']);
    assert.strictEqual(await r.run(), 'off');
  });

  globalThis.fetch = realFetch;
  console.log('home-sync: ' + n + ' tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
