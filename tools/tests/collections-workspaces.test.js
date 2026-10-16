// Collections team workspaces, end to end: the real Worker (worker/index.js → worker/workspaces.js + worker/access.js,
// real Access tokens signed with a test key) over an in-memory R2, driven by the real client engine
// (site/collections/ws-sync.js createEngine) and the real operation code (site/collections/ws-ops.js) on real
// Collections data (site/collections/data.js). Run: node tools/tests/collections-workspaces.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '../..');
const OPS = require(path.join(ROOT, 'site/collections/ws-ops.js'));
const WS = require(path.join(ROOT, 'site/collections/ws-sync.js'));
const X = require(path.join(ROOT, 'site/collections/data.js'));
const I18N = require(path.join(ROOT, 'site/collections/i18n.js'));
const eq = (a, b, m) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), m);
const TODAY = '2026-10-15';
let n = 0;
async function t(name, fn) { await fn(); n++; console.log('ok', n, name); }

// ── in-memory R2 (head/get/put/delete/list, conditional puts as the Workers binding behaves) ─────────────────────────
function makeR2() {
  const store = new Map(); let k = 0;
  const meta = (key, o) => ({ key, size: o.bytes.byteLength, etag: o.etag, uploaded: o.uploaded, customMetadata: { ...o.customMetadata }, httpMetadata: { ...o.httpMetadata } });
  const r2 = {
    store, puts: 0, gets: 0, heads: 0,
    async head(key) { r2.heads++; const o = store.get(key); return o ? meta(key, o) : null; },
    async get(key, opts = {}) {
      r2.gets++;
      const o = store.get(key); if (!o) return null;
      const m = meta(key, o);
      if (opts.onlyIf && opts.onlyIf.etagMatches && opts.onlyIf.etagMatches !== o.etag) return m;
      const bytes = o.bytes;
      return { ...m, body: new Blob([bytes]).stream(), arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), text: async () => Buffer.from(bytes).toString('utf8') };
    },
    async put(key, body, opts = {}) {
      const bytes = new Uint8Array(await new Response(body).arrayBuffer());
      await new Promise((r) => setImmediate(r)); // let concurrent requests interleave here, as they would in R2
      const cur = store.get(key);
      if (opts.onlyIf && opts.onlyIf.etagMatches && (!cur || cur.etag !== opts.onlyIf.etagMatches)) return null;
      const o = { bytes, etag: 'e' + (++k), uploaded: new Date(), customMetadata: { ...(opts.customMetadata || {}) }, httpMetadata: { ...(opts.httpMetadata || {}) } };
      store.set(key, o); r2.puts++;
      return meta(key, o);
    },
    async delete(keys) { for (const x of [].concat(keys)) store.delete(x); },
    async list(opts = {}) {
      const prefix = opts.prefix || '';
      const objects = [...store.keys()].filter((x) => x.startsWith(prefix)).sort().map((x) => meta(x, store.get(x)));
      return { objects, truncated: false, delimitedPrefixes: [] };
    }
  };
  return r2;
}
const memStore = () => {
  const m = new Map();
  return { m, get: async (key) => (m.has(key) ? JSON.parse(m.get(key)) : undefined), update: async (key, fn) => { const v = fn(m.has(key) ? JSON.parse(m.get(key)) : undefined); m.set(key, JSON.stringify(v)); return JSON.parse(JSON.stringify(v)); } };
};

(async function main() {
  // ── ops: diff and apply on real Collections data ─────────────────────────────────────────────────────────────────
  const demo = X.generate(TODAY);
  await t('diff → apply turns one version of the document into the other (records, payments, settings, log, bank)', async () => {
    const a = OPS.clone(demo), b = OPS.clone(demo), sh = OPS.shadow(a);
    const inv = b.invoices.find((i) => i.payments.length === 0);
    inv.payments.push({ date: TODAY, amount: 10, ref: 'a-x1' });
    b.actions.push({ id: 'a-x1', customerId: inv.customerId, type: 'payment', date: TODAY, amount: 10, invoiceIds: [inv.id], text: '', by: 'Someone' });
    b.customers[0].contact.phone = '+386 1 999 99 99';
    b.customers[1].notes = 'Prefers e-mail.';
    b.settings.target = 123456; b.settings.stages[2].days = 31;
    b.plans[0].instalments[2].paidDate = TODAY;
    b.log.unshift({ at: TODAY, text: 'Payment from X: 10,00 €' });
    b.bankSeen = ['bk-1', 'bk-2'];
    b.customers.splice(5, 1);
    const ops = OPS.diff(sh, b);
    const types = ops.map((o) => o.type);
    for (const ty of ['sub.add', 'rec.put', 'doc.put', 'log.add', 'set.add', 'rec.del']) assert.ok(types.includes(ty), ty);
    const plan = ops.find((o) => o.type === 'rec.put' && o.p.c === 'plans');
    eq(plan.p.f, [[['instalments', 2, 'paidDate'], TODAY]], 'one field of one instalment, not the whole list');
    const phone = ops.find((o) => o.type === 'rec.put' && o.p.c === 'customers' && o.p.id === b.customers[0].id);
    eq(phone.p.f, [[['contact', 'phone'], '+386 1 999 99 99']]);
    const act = ops.find((o) => o.type === 'rec.put' && o.p.c === 'actions');
    assert.ok(!('by' in act.p.f[0][1]), 'who did it is never taken from the device');
    const c = OPS.fold(OPS.clone(a), ops.map((o) => ({ ...o, by: 'ana@example.si' })));
    const strip = (d) => { d = OPS.clone(d); d.actions.forEach((x) => { delete x.by; delete x.byEmail; }); d.invoices.forEach((i) => i.payments.forEach((p) => delete p.by)); d.log.forEach((e) => delete e.by); return d; };
    eq(strip(c), strip(b));
    const added = c.actions.find((x) => x.id === 'a-x1');
    assert.strictEqual(added.by, 'ana@example.si'); assert.strictEqual(added.byEmail, 'ana@example.si');
    assert.strictEqual(c.log[0].by, 'ana@example.si');
    eq(OPS.diff(OPS.shadow(b), b), [], 'nothing changed → no operations');
  });
  await t('two people paying the same invoice at once: both payments are kept, in either order; undo removes only its own', async () => {
    const inv = demo.invoices.find((i) => i.payments.length === 0);
    const base = OPS.clone(demo), sh = OPS.shadow(base);
    const a = OPS.clone(base); a.invoices.find((i) => i.id === inv.id).payments.push({ date: TODAY, amount: 100, ref: 'pa' });
    const b = OPS.clone(base); b.invoices.find((i) => i.id === inv.id).payments.push({ date: TODAY, amount: 200, ref: 'pb' });
    const oa = OPS.diff(sh, a), ob = OPS.diff(sh, b);
    const ab = OPS.fold(OPS.clone(base), oa.concat(ob)), ba = OPS.fold(OPS.clone(base), ob.concat(oa));
    const sum = (d) => d.invoices.find((i) => i.id === inv.id).payments.map((p) => p.amount).sort();
    eq(sum(ab), [100, 200]); eq(sum(ba), [100, 200]);
    const undo = OPS.diff(OPS.shadow(a), base); // A undoes its payment
    eq(sum(OPS.fold(ab, undo)), [200], 'B\'s payment stays');
    const twice = OPS.fold(OPS.clone(base), oa.concat(oa));
    eq(sum(twice), [100], 'the same operation applied twice counts once');
  });
  await t('malformed and hostile operations change nothing (prototype keys, unknown types, puts on deleted records)', async () => {
    const d = OPS.clone(demo), before = JSON.stringify(d);
    OPS.apply(d, { type: 'doc.put', p: { f: [[['__proto__', 'x'], 1], [['customers'], []], [['log'], []]] } });
    OPS.apply(d, { type: 'rec.put', p: { c: '__proto__', id: 'x', n: 1, f: [[[], { a: 1 }]] } });
    OPS.apply(d, { type: 'rec.put', p: { c: 'customers', id: 'gone', f: [[['name'], 'Ghost']] } });
    OPS.apply(d, { type: 'nope', p: {} });
    OPS.apply(d, { type: 'sub.add', p: { c: 'customers', id: d.customers[0].id, k: 'notes', key: 'x', item: {} } });
    assert.strictEqual(JSON.stringify(d), before);
    assert.strictEqual({}.x, undefined);
  });

  // ── the Worker ──────────────────────────────────────────────────────────────────────────────────────────────────
  const TEAM = 'team.example', AUD = 'aud-test', OWNER = 'owner@example.com', ANA = 'ana@example.si', VERA = 'vera@example.si', EVE = 'eve@example.si', VIEWER = 'viewonly@example.com';
  const b64u = (b) => Buffer.from(b).toString('base64url');
  const keyPair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = { ...(await crypto.subtle.exportKey('jwk', keyPair.publicKey)), kid: 'k1' };
  async function token(email, o = {}) {
    const h = b64u(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' }));
    const p = b64u(JSON.stringify({ aud: [o.aud || AUD], email, iss: 'https://' + TEAM, exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000) }));
    return h + '.' + p + '.' + b64u(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keyPair.privateKey, new TextEncoder().encode(h + '.' + p)));
  }
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, i) => (String(u) === 'https://' + TEAM + '/cdn-cgi/access/certs' ? new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'Content-Type': 'application/json' } }) : realFetch(u, i));
  const worker = (await import(pathToFileURL(path.join(ROOT, 'worker/index.js')).href)).default;
  const r2 = makeR2();
  const env = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, OWNER_EMAIL: OWNER, OWNER_NAME: 'Owner', VIEWER_EMAILS: VIEWER, SYNC: r2, ASSETS: null };
  const TOK = {}; for (const e of [OWNER, ANA, VERA, EVE, VIEWER]) TOK[e] = await token(e);
  async function call(email, method, url, body, o = {}) {
    const headers = new Headers(o.headers || {});
    if (email) headers.set('Cf-Access-Jwt-Assertion', TOK[email] || email);
    if (method !== 'GET' && !o.noHeader) headers.set('X-Stratum-Apps', '1');
    if (body !== undefined && typeof body !== 'string') { body = JSON.stringify(body); headers.set('Content-Type', 'application/json'); }
    const res = await worker.fetch(new Request((o.host || 'https://apps.example') + url, { method, headers, body }), o.env || env);
    const text = await res.text();
    let j; try { j = JSON.parse(text); } catch { j = text; }
    return { status: res.status, j, headers: res.headers };
  }
  /** the engine's fetch for one person */
  const fetchAs = (email, gate) => async (url, init) => {
    if (gate && gate.offline) throw new TypeError('Failed to fetch');
    const headers = new Headers(init.headers || {}); headers.set('Cf-Access-Jwt-Assertion', TOK[email]);
    return worker.fetch(new Request('https://apps.example' + url, { method: init.method || 'GET', headers, body: init.body }), env);
  };

  let ws;
  await t('only OWNER_EMAIL creates a workspace; it starts "not set up" with the owner as its only member', async () => {
    let r = await call(ANA, 'POST', '/api/ws', { name: 'Termo d.o.o.', app: 'collections' });
    assert.strictEqual(r.status, 403);
    r = await call(OWNER, 'POST', '/api/ws', { name: 'x', app: 'billing' });
    assert.strictEqual(r.status, 400, 'pilot: Collections only');
    r = await call(OWNER, 'POST', '/api/ws', { name: 'Termo d.o.o.', app: 'collections' }, { noHeader: true });
    assert.strictEqual(r.status, 400, 'every change needs X-Stratum-Apps');
    r = await call(OWNER, 'POST', '/api/ws', { name: '  Termo   d.o.o. ', app: 'collections' });
    assert.strictEqual(r.status, 201); ws = r.j;
    assert.ok(/^w-[a-z0-9]{10}$/.test(ws.id));
    eq([ws.name, ws.role, ws.ready, ws.members.map((m) => [m.email, m.role])], ['Termo d.o.o.', 'owner', false, [[OWNER, 'owner']]]);
    r = await call(OWNER, 'GET', '/api/ws');
    eq(r.j.workspaces.map((w) => [w.id, w.role]), [[ws.id, 'owner']]); assert.strictEqual(r.j.canCreate, true);
    r = await call(ANA, 'GET', '/api/ws');
    eq([r.j.me, r.j.canCreate, r.j.workspaces], [ANA, false, []]);
    assert.ok([...r2.store.keys()].every((k) => !k.includes('@')), 'no e-mail in any R2 key');
  });
  await t('non-members get exactly the same 404 as for a workspace that does not exist; bad ids and no sign-in are refused', async () => {
    const a = await call(ANA, 'GET', '/api/ws/' + ws.id), b = await call(ANA, 'GET', '/api/ws/w-doesnotexist');
    eq([a.status, a.j], [404, { error: 'Not found.' }]); eq([b.status, b.j], [a.status, a.j]);
    for (const p of ['/ops?since=0', '/snapshot', '/activity']) assert.strictEqual((await call(ANA, 'GET', '/api/ws/' + ws.id + p)).status, 404, p);
    assert.strictEqual((await call(ANA, 'POST', '/api/ws/' + ws.id + '/ops', { ops: [{ id: 'op-aaaaaaaa', type: 'log.add', p: { e: { text: 'x' } } }] })).status, 404);
    assert.strictEqual((await call(ANA, 'GET', '/api/ws/..%2Fu')).status, 404);
    assert.strictEqual((await call(ANA, 'GET', '/api/ws/BAD_ID')).status, 404);
    assert.strictEqual((await call(null, 'GET', '/api/ws')).status, 401);
    const wrongAud = await token(ANA, { aud: 'other' });
    assert.strictEqual((await call(wrongAud, 'GET', '/api/ws')).status, 401, 'a token for another Access application');
  });
  await t('the owner adds an editor and a viewer; editors and viewers cannot manage members', async () => {
    let r = await call(OWNER, 'POST', '/api/ws/' + ws.id + '/members', { email: ' Ana@Example.si ', role: 'editor' });
    assert.strictEqual(r.status, 200); eq(r.j.members.map((m) => [m.email, m.role, m.addedBy]), [[OWNER, 'owner', OWNER], [ANA, 'editor', OWNER]]);
    r = await call(OWNER, 'POST', '/api/ws/' + ws.id + '/members', { email: VERA, role: 'viewer' });
    assert.strictEqual(r.status, 200);
    r = await call(OWNER, 'POST', '/api/ws/' + ws.id + '/members', { email: 'not an e-mail', role: 'viewer' });
    assert.strictEqual(r.status, 400);
    r = await call(OWNER, 'POST', '/api/ws/' + ws.id + '/members', { email: EVE, role: 'admin' });
    assert.strictEqual(r.status, 400);
    r = await call(ANA, 'POST', '/api/ws/' + ws.id + '/members', { email: EVE, role: 'editor' });
    assert.strictEqual(r.status, 403, 'an editor cannot add people');
    r = await call(ANA, 'POST', '/api/ws/' + ws.id + '/members', { email: VERA, role: 'owner' });
    assert.strictEqual(r.status, 403, 'nor promote anyone');
    r = await call(VERA, 'POST', '/api/ws/' + ws.id + '/members', { email: VERA, role: 'editor' });
    assert.strictEqual(r.status, 403, 'a viewer cannot promote themselves');
    r = await call(ANA, 'PATCH', '/api/ws/' + ws.id, { name: 'Mine now' });
    assert.strictEqual(r.status, 403, 'only owners rename');
    r = await call(ANA, 'GET', '/api/ws');
    eq(r.j.workspaces.map((w) => [w.id, w.role, w.members]), [[ws.id, 'editor', 3]]);
    r = await call(VERA, 'GET', '/api/ws/' + ws.id);
    eq([r.status, r.j.role], [200, 'viewer']);
  });
  await t('the last owner can never be removed or demoted; with a second owner it can', async () => {
    let r = await call(OWNER, 'POST', '/api/ws/' + ws.id + '/members', { email: OWNER, role: 'remove' });
    assert.strictEqual(r.status, 409);
    r = await call(OWNER, 'POST', '/api/ws/' + ws.id + '/members', { email: OWNER, role: 'editor' });
    assert.strictEqual(r.status, 409);
    r = await call(OWNER, 'POST', '/api/ws/' + ws.id + '/members', { email: EVE, role: 'owner' });
    assert.strictEqual(r.status, 200);
    r = await call(EVE, 'POST', '/api/ws/' + ws.id + '/members', { email: EVE, role: 'remove' });
    assert.strictEqual(r.status, 200, 'with two owners, one may leave');
    r = await call(EVE, 'GET', '/api/ws/' + ws.id);
    assert.strictEqual(r.status, 404, 'and is out');
    r = await call(EVE, 'GET', '/api/ws');
    eq(r.j.workspaces, [], 'the index forgets it too');
  });
  await t('nothing can be written before the owner sets the starting data; only the owner can set it, once', async () => {
    let r = await call(ANA, 'POST', '/api/ws/' + ws.id + '/ops', { ops: [{ id: 'op-early001', type: 'log.add', p: { e: { at: TODAY, text: 'x' } } }] });
    assert.strictEqual(r.status, 409);
    r = await call(ANA, 'PUT', '/api/ws/' + ws.id + '/snapshot?seq=0', JSON.stringify(demo));
    assert.strictEqual(r.status, 403);
    r = await call(OWNER, 'PUT', '/api/ws/' + ws.id + '/snapshot?seq=1', JSON.stringify(demo));
    assert.strictEqual(r.status, 200); assert.ok(r.j.seed);
    r = await call(OWNER, 'PUT', '/api/ws/' + ws.id + '/snapshot?seq=1', JSON.stringify(X.generate('2026-01-01')));
    assert.strictEqual(r.status, 409, 'the seed stays');
    r = await call(VERA, 'GET', '/api/ws/' + ws.id + '/snapshot');
    assert.strictEqual(r.status, 200); assert.strictEqual(r.j.invoices.length, demo.invoices.length);
    assert.ok(+r.headers.get('X-Ws-Seq') >= 1);
  });
  await t('viewers read but every write is refused (403), whatever they send', async () => {
    let r = await call(VERA, 'GET', '/api/ws/' + ws.id + '/ops?since=0');
    assert.strictEqual(r.status, 200);
    r = await call(VERA, 'POST', '/api/ws/' + ws.id + '/ops', { ops: [{ id: 'op-viewer01', type: 'log.add', p: { e: { at: TODAY, text: 'sneaky' } } }] });
    eq([r.status, r.j.viewer], [403, true]);
    r = await call(VERA, 'PUT', '/api/ws/' + ws.id + '/snapshot?seq=1', '{}');
    assert.strictEqual(r.status, 403);
    r = await call(VERA, 'PATCH', '/api/ws/' + ws.id, { name: 'x' });
    assert.strictEqual(r.status, 403);
  });
  await t('ops: the server sets seq, by (from the token) and at; the same op id twice is stored once; limits and checks', async () => {
    const op = { id: 'op-dup00001', type: 'log.add', p: { e: { at: TODAY, text: 'Called the bank' } }, by: 'mallory@example.si', seq: 999, at: '1999-01-01' };
    let r = await call(ANA, 'POST', '/api/ws/' + ws.id + '/ops', { ops: [op] });
    assert.strictEqual(r.status, 200); eq(r.j.dup, []); const seq = r.j.accepted[0].seq;
    r = await call(ANA, 'POST', '/api/ws/' + ws.id + '/ops', { ops: [op] });
    eq([r.j.accepted, r.j.dup, r.j.head], [[], ['op-dup00001'], seq]);
    r = await call(VERA, 'GET', '/api/ws/' + ws.id + '/ops?since=' + (seq - 1));
    eq(r.j.ops.map((o) => [o.seq, o.id, o.by]), [[seq, 'op-dup00001', ANA]]);
    assert.ok(r.j.ops[0].at > '2026');
    const bad = async (ops, status, why) => assert.strictEqual((await call(ANA, 'POST', '/api/ws/' + ws.id + '/ops', { ops })).status, status, why);
    await bad([{ id: 'x', type: 'log.add', p: {} }], 400, 'short id');
    await bad([{ id: 'op-UPPER0001', type: 'log.add', p: {} }], 400, 'id characters');
    await bad([{ id: 'op-type00001', type: 'ws.member', p: { email: EVE, role: 'owner' } }], 400, 'devices cannot write membership events');
    await bad([{ id: 'op-big000001', type: 'log.add', p: { e: { text: 'x'.repeat(40000) } } }], 400, 'op over 32 KB');
    await bad(Array.from({ length: 201 }, (_, i) => ({ id: 'op-many' + String(i).padStart(5, '0'), type: 'log.add', p: { e: { text: 'x' } } })), 413, 'over 200 ops');
    await bad([], 400, 'empty batch');
    r = await call(ANA, 'POST', '/api/ws/' + ws.id + '/ops', 'x'.repeat(600 * 1024));
    assert.strictEqual(r.status, 413, 'over 512 KB');
  });

  // ── two people, two devices, the real engine ──────────────────────────────────────────────────────────────────────
  function device(email, role, gate) {
    const d = { store: memStore(), changes: 0, gate: gate || {} };
    d.engine = WS.createEngine({ id: ws.id, me: email, role, fetch: fetchAs(email, d.gate), store: d.store, valid: (v) => !!(v && Array.isArray(v.invoices)), onChange: () => { d.changes++; } });
    d.edit = async (fn) => { const v = d.engine.view(), sh = OPS.shadow(v); fn(v); return d.engine.local(OPS.diff(sh, v)); };
    return d;
  }
  const owner = device(OWNER, 'owner'), ana = device(ANA, 'editor');
  let invX, custY, custZ;
  await t('both devices open the workspace from the stored state', async () => {
    assert.ok(await owner.engine.load()); assert.ok(await ana.engine.load());
    await Promise.all([owner.engine.sync(), ana.engine.sync()]);
    eq(owner.engine.view(), ana.engine.view());
    invX = demo.invoices.find((i) => i.payments.length === 0 && i.dueDate < TODAY).id;
    custY = demo.customers[3].id; custZ = demo.customers[4].id;
  });
  await t('two people edit at the same time: both end up with the same data, with both people\'s actions and changes', async () => {
    await owner.edit((v) => {
      const inv = v.invoices.find((i) => i.id === invX);
      v.actions.push({ id: 'a-own-pay', customerId: inv.customerId, type: 'payment', date: TODAY, amount: 500, invoiceIds: [invX], text: '', by: 'Owner name' });
      inv.payments.push({ date: TODAY, amount: 500, ref: 'a-own-pay' });
      v.customers.find((c) => c.id === custY).contact.phone = '+386 40 111 222';
      v.customers.find((c) => c.id === custZ).notes = 'Owner was here';
    });
    await ana.edit((v) => {
      const inv = v.invoices.find((i) => i.id === invX);
      v.actions.push({ id: 'a-ana-pay', customerId: inv.customerId, type: 'payment', date: TODAY, amount: 300, invoiceIds: [invX], text: '', by: 'ana' });
      inv.payments.push({ date: TODAY, amount: 300, ref: 'a-ana-pay' });
      v.actions.push({ id: 'a-ana-prom', customerId: custY, type: 'call', outcome: 'promised', date: TODAY, invoiceIds: [], promise: { date: '2026-10-20', amount: 1000, status: 'open' }, text: 'Will pay Monday', by: 'whoever' });
      v.customers.find((c) => c.id === custY).notes = 'Ana: call after 10';
      v.customers.find((c) => c.id === custZ).notes = 'Ana was here';
      v.log.unshift({ at: TODAY, text: 'Promise from Y' });
    });
    await Promise.all([owner.engine.sync(), ana.engine.sync()]);
    await Promise.all([owner.engine.sync(), ana.engine.sync()]);
    const a = owner.engine.view(), b = ana.engine.view();
    eq(a, b, 'identical documents');
    eq(owner.engine._state.base, ana.engine._state.base, 'identical confirmed state and number');
    assert.strictEqual(owner.engine.status().pending + ana.engine.status().pending, 0);
    const inv = a.invoices.find((i) => i.id === invX);
    eq(inv.payments.map((p) => [p.amount, p.by]).sort(), [[300, ANA], [500, OWNER]], 'both payments, each with its author');
    eq(['a-own-pay', 'a-ana-pay', 'a-ana-prom'].map((id) => a.actions.find((x) => x.id === id).by), [OWNER, ANA, ANA], '"Recorded by" comes from the sign-in');
    const y = a.customers.find((c) => c.id === custY);
    eq([y.contact.phone, y.notes], ['+386 40 111 222', 'Ana: call after 10'], 'different fields of one customer: both kept');
    const ops = (await call(OWNER, 'GET', '/api/ws/' + ws.id + '/ops?since=0')).j.ops;
    const last = ops.filter((o) => o.type === 'rec.put' && o.p.id === custZ).pop();
    assert.strictEqual(a.customers.find((c) => c.id === custZ).notes, last.by === ANA ? 'Ana was here' : 'Owner was here', 'same field: the later change in the server order wins, on both');
    assert.ok(owner.changes > 0 && ana.changes > 0, 'each device was told about the other\'s changes');
  });
  await t('offline: changes wait in the stored queue (also across a reload) and go out once back online', async () => {
    const gate = { offline: true }, off = device(ANA, 'editor', gate);
    off.store = ana.store; // the same browser storage as Ana's device: a reload of that page
    off.engine = WS.createEngine({ id: ws.id, me: ANA, role: 'editor', fetch: fetchAs(ANA, gate), store: ana.store, onChange: () => {} });
    assert.ok(await off.engine.load());
    await off.edit((v) => { v.actions.push({ id: 'a-offline-1', customerId: custZ, type: 'note', date: TODAY, invoiceIds: [], text: 'Written on the train' }); });
    assert.strictEqual(await off.engine.sync(), null);
    eq([off.engine.status().status, off.engine.status().pending], ['offline', 1]);
    const again = WS.createEngine({ id: ws.id, me: ANA, role: 'editor', fetch: fetchAs(ANA, gate), store: ana.store, onChange: () => {} });
    await again.load();
    assert.strictEqual(again.status().pending, 1, 'the queue survived the reload');
    assert.ok(again.view().actions.some((x) => x.id === 'a-offline-1'), 'and shows on screen meanwhile');
    gate.offline = false;
    await again.sync();
    eq([again.status().status, again.status().pending], ['synced', 0]);
    await owner.engine.sync();
    assert.strictEqual(owner.engine.view().actions.find((x) => x.id === 'a-offline-1').byEmail, ANA);
    await again.sync(); await off.engine.sync(); // the old page instance sends it again: stored once
    const all = (await call(OWNER, 'GET', '/api/ws/' + ws.id + '/ops?since=0')).j.ops.filter((o) => o.p && o.p.id === 'a-offline-1');
    assert.strictEqual(all.length, 1);
  });
  await t('a viewer\'s device never sends; changes it holds are kept, shown as refused, and dropped only when asked', async () => {
    const v = device(VERA, 'viewer');
    await v.engine.load(); await v.engine.sync();
    eq(v.engine.view(), owner.engine.view());
    await v.edit((d) => { d.customers[0].notes = 'viewer edit'; });
    await v.engine.sync();
    eq([v.engine.status().status, v.engine.status().pending], ['readonly', 1]);
    assert.ok(!(await call(OWNER, 'GET', '/api/ws/' + ws.id + '/ops?since=0')).j.ops.some((o) => JSON.stringify(o).includes('viewer edit')));
    await v.engine.discard();
    eq([v.engine.status().pending, v.engine.view().customers[0].notes], [0, owner.engine.view().customers[0].notes]);
  });
  await t('an editor demoted to viewer: the server refuses the next push and the device switches to read-only', async () => {
    let r = await call(OWNER, 'POST', '/api/ws/' + ws.id + '/members', { email: ANA, role: 'viewer' });
    assert.strictEqual(r.status, 200);
    await ana.edit((d) => { d.customers[1].notes = 'after demotion'; });
    await ana.engine.sync();
    eq([ana.engine.status().status, ana.engine.role()], ['readonly', 'viewer']);
    await ana.engine.discard();
    r = await call(OWNER, 'POST', '/api/ws/' + ws.id + '/members', { email: ANA, role: 'editor' });
    await ana.engine.refreshInfo();
    assert.strictEqual(ana.engine.role(), 'editor');
  });
  await t('many changes: the log seals chunks, a device far behind catches up through them, compaction stores the state', async () => {
    for (let round = 0; round < 4; round++) {
      await owner.edit((v) => { for (let i = 0; i < 90; i++) v.actions.push({ id: 'a-bulk-' + round + '-' + i, customerId: demo.customers[i % 50].id, type: 'note', date: TODAY, invoiceIds: [], text: 'Bulk ' + round + '/' + i }); });
      await owner.engine.sync();
    }
    const keys = [...r2.store.keys()].filter((k) => k.startsWith('ws/' + ws.id + '/collections/ops/'));
    assert.ok(keys.length >= 2, 'sealed chunks: ' + keys.length);
    const log = JSON.parse(await (await r2.get('ws/' + ws.id + '/collections/log.json')).text());
    assert.ok(log.ops.length < 300 && log.first > 1, 'the tail stays small');
    // pulling everything from 0 gives every number exactly once, in order
    let since = 0, seqs = [];
    for (;;) { const p = (await call(VERA, 'GET', '/api/ws/' + ws.id + '/ops?since=' + since)).j; seqs = seqs.concat(p.ops.map((o) => o.seq)); since = seqs[seqs.length - 1]; if (!p.more) break; }
    eq(seqs, Array.from({ length: log.head }, (_, i) => i + 1));
    // Ana's device was not open meanwhile: it catches up
    await ana.engine.sync();
    eq(ana.engine.view(), owner.engine.view());
    const snap = await r2.head('ws/' + ws.id + '/collections/snap.json');
    assert.ok(snap && +snap.customMetadata.seq >= 300, 'a compacted state was stored at ' + (snap && snap.customMetadata.seq));
    assert.ok([OWNER, ANA].includes(snap.customMetadata.by));
    // a brand-new device starts from it and pulls only the rest
    const fresh = device(VERA, 'viewer');
    const gets = r2.gets;
    await fresh.engine.load();
    assert.strictEqual(fresh.engine._state.base.seq, +snap.customMetadata.seq);
    await fresh.engine.sync();
    eq(fresh.engine.view(), owner.engine.view());
    assert.ok(r2.gets - gets < 12, 'few R2 reads: ' + (r2.gets - gets));
    // the seed is kept for good
    assert.ok(await r2.head('ws/' + ws.id + '/collections/seed.json'));
    let r = await call(ANA, 'PUT', '/api/ws/' + ws.id + '/snapshot?seq=' + snap.customMetadata.seq, JSON.stringify(owner.engine.view()));
    assert.strictEqual(r.status, 409, 'compaction needs enough new ops');
    r = await call(ANA, 'PUT', '/api/ws/' + ws.id + '/snapshot?seq=99999', '{}');
    assert.strictEqual(r.status, 400, 'not beyond the log');
  });
  await t('an idle poll costs one R2 HEAD (plus the membership check) and parses no log', async () => {
    await owner.engine.sync();
    const g = r2.gets, h = r2.heads;
    await owner.engine.sync();
    assert.ok(r2.gets - g <= 2 && r2.heads - h <= 2, 'gets ' + (r2.gets - g) + ', heads ' + (r2.heads - h));
  });
  await t('activity: who did what, newest first, with membership events', async () => {
    let r = await call(VERA, 'GET', '/api/ws/' + ws.id + '/activity?limit=300');
    assert.strictEqual(r.status, 200);
    let items = r.j.items;
    while (r.j.more) { r = await call(VERA, 'GET', '/api/ws/' + ws.id + '/activity?limit=300&before=' + items[items.length - 1].seq); items = items.concat(r.j.items); }
    eq(items.map((x) => x.seq), Array.from({ length: items.length }, (_, i) => items.length - i), 'paging back to the start: every op once');
    assert.ok(items[0].seq > items[items.length - 1].seq);
    assert.ok(items.some((x) => x.type === 'ws.member' && x.email === ANA && x.role === 'editor' && x.prev === 'viewer' && x.by === OWNER));
    assert.ok(items.every((x) => typeof x.by === 'string' && x.at));
    assert.ok(!JSON.stringify(items).includes('"f":'), 'summaries only, not the data');
  });

  // ── the rest of the API is untouched ──────────────────────────────────────────────────────────────────────────────
  await t('personal cloud copies work as before and stay separate: members are not owners there', async () => {
    let r = await call(OWNER, 'PUT', '/api/sync/collections?base=0', JSON.stringify({ mine: 1 }));
    assert.strictEqual(r.status, 200);
    r = await call(OWNER, 'GET', '/api/sync/collections');
    eq(r.j, { mine: 1 });
    r = await call(ANA, 'GET', '/api/sync/collections');
    assert.strictEqual(r.status, 403, 'a team member is not the owner');
    r = await call(VIEWER, 'GET', '/api/sync/collections');
    assert.strictEqual(r.status, 200, 'VIEWER_EMAILS still read the owner\'s demo copies');
    r = await call(VIEWER, 'GET', '/api/sync/billing');
    assert.strictEqual(r.status, 403, 'and never the private apps');
    r = await call(VIEWER, 'GET', '/api/ws/' + ws.id);
    assert.strictEqual(r.status, 404, 'VIEWER_EMAILS give no access to team workspaces');
    r = await call(ANA, 'GET', '/api/auth/me');
    assert.strictEqual(r.status, 403);
    assert.ok([...r2.store.keys()].filter((k) => k.startsWith('u/')).every((k) => !k.includes('ws')), 'separate prefixes');
  });
  await t('DEV_BYPASS acts as another e-mail only on localhost (cookie); anywhere else it changes nothing here', async () => {
    const dev = { ...env, DEV_BYPASS: '1' };
    let r = await call(null, 'GET', '/api/ws', undefined, { env: dev, host: 'http://localhost:8311', headers: { Cookie: 'stratum_dev_as=' + encodeURIComponent(ANA) } });
    eq([r.status, r.j.me], [200, ANA]);
    r = await call(null, 'GET', '/api/ws', undefined, { env: dev, host: 'http://localhost:8311' });
    eq([r.status, r.j.me], [200, OWNER]);
    r = await call(null, 'GET', '/api/ws', undefined, { env: dev, headers: { Cookie: 'stratum_dev_as=' + encodeURIComponent(ANA) } });
    assert.strictEqual(r.status, 401, 'on a real host the token is still required');
  });
  await t('every new screen text has Slovene and Croatian translations with the same placeholders', async () => {
    const src = fs.readFileSync(path.join(ROOT, 'site/collections/ws-sync.js'), 'utf8');
    const lit = (s) => s.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, '\\');
    const keys = new Set(); let m;
    const re = /\btx\(\s*('(?:[^'\\]|\\.)*')/g; while ((m = re.exec(src))) keys.add(lit(m[1]));
    for (const name of ['ACT_LABEL', 'COLL_LABEL']) { const at = src.indexOf('var ' + name + ' = '); (src.slice(at, src.indexOf(';\n', at)).match(/:\s*'(?:[^'\\]|\\.)*'/g) || []).forEach((q) => keys.add(lit(q.replace(/^:\s*/, '')))); }
    const tables = /tx\(\{([^}]*)\}\[/g; while ((m = tables.exec(src))) (m[1].match(/'(?:[^'\\]|\\.)*'(?=\s*[,}]|\s*$)/g) || []).forEach((q) => keys.add(lit(q)));
    assert.ok(keys.size > 60, 'found ' + keys.size);
    const holes = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(',');
    const missing = [...keys].filter((k) => !I18N.DICT[k]);
    eq(missing, [], 'missing translations');
    const bad = [...keys].filter((k) => holes(I18N.DICT[k][0]) !== holes(k) || holes(I18N.DICT[k][1]) !== holes(k));
    eq(bad, [], 'placeholders differ');
  });

  globalThis.fetch = realFetch;
  console.log('collections-workspaces: ' + n + ' tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
