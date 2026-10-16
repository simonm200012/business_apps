// Collections team workspaces, administration: invitations (the text, the .eml, invitedAt), joinedAt, ?ws= links and
// deleting a workspace. The real Worker (worker/index.js → worker/workspaces.js, real Access tokens signed with a test
// key) over an in-memory R2 that pages its listings like the real binding, driven by the real client code
// (site/collections/ws-sync.js). Run: node tools/tests/collections-workspaces-admin.test.js
'use strict';
const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '../..');
const OPS = require(path.join(ROOT, 'site/collections/ws-ops.js'));
const WS = require(path.join(ROOT, 'site/collections/ws-sync.js'));
const X = require(path.join(ROOT, 'site/collections/data.js'));
const eq = (a, b, m) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), m);
const TODAY = '2026-10-16';
let n = 0;
async function t(name, fn) { await fn(); n++; console.log('ok', n, name); }

// ── in-memory R2: head/get/put/delete/list (pages of `limit`, with a cursor), conditional puts; counts every call ────
function makeR2() {
  const store = new Map(); let k = 0;
  const meta = (key, o) => ({ key, size: o.bytes.byteLength, etag: o.etag, uploaded: o.uploaded, customMetadata: { ...o.customMetadata }, httpMetadata: { ...o.httpMetadata } });
  const r2 = {
    store, calls: 0,
    async head(key) { r2.calls++; const o = store.get(key); return o ? meta(key, o) : null; },
    async get(key) {
      r2.calls++;
      const o = store.get(key); if (!o) return null;
      const bytes = o.bytes;
      return { ...meta(key, o), body: new Blob([bytes]).stream(), arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), text: async () => Buffer.from(bytes).toString('utf8') };
    },
    async put(key, body, opts = {}) {
      r2.calls++;
      const bytes = new Uint8Array(await new Response(body).arrayBuffer());
      await new Promise((r) => setImmediate(r));
      const cur = store.get(key);
      if (opts.onlyIf && opts.onlyIf.etagMatches && (!cur || cur.etag !== opts.onlyIf.etagMatches)) return null;
      const o = { bytes, etag: 'e' + (++k), uploaded: new Date(), customMetadata: { ...(opts.customMetadata || {}) }, httpMetadata: { ...(opts.httpMetadata || {}) } };
      store.set(key, o);
      return meta(key, o);
    },
    async delete(keys) { r2.calls++; for (const x of [].concat(keys)) store.delete(x); },
    async list(opts = {}) {
      r2.calls++;
      const prefix = opts.prefix || '', limit = Math.min(1000, opts.limit || 1000);
      const all = [...store.keys()].filter((x) => x.startsWith(prefix) && (!opts.cursor || x > opts.cursor)).sort();
      const page = all.slice(0, limit);
      return { objects: page.map((x) => meta(x, store.get(x))), truncated: all.length > limit, cursor: page.length ? page[page.length - 1] : opts.cursor, delimitedPrefixes: [] };
    }
  };
  return r2;
}
const memStore = () => {
  const m = new Map();
  return { m, get: async (key) => (m.has(key) ? JSON.parse(m.get(key)) : undefined), update: async (key, fn) => { const v = fn(m.has(key) ? JSON.parse(m.get(key)) : undefined); m.set(key, JSON.stringify(v)); return JSON.parse(JSON.stringify(v)); }, del: async (key) => { m.delete(key); } };
};

(async function main() {
  const TEAM = 'team.example', AUD = 'aud-test', OWNER = 'owner@example.si', ANA = 'ana@example.si', VERA = 'vera@example.si', EVE = 'eve@example.si';
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
  const env = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, OWNER_EMAIL: OWNER, OWNER_NAME: 'Owner', SYNC: r2, ASSETS: null };
  const TOK = {}; for (const e of [OWNER, ANA, VERA, EVE]) TOK[e] = await token(e);
  async function call(email, method, url, body) {
    const headers = new Headers();
    headers.set('Cf-Access-Jwt-Assertion', TOK[email]);
    if (method !== 'GET') headers.set('X-Stratum-Apps', '1');
    if (body !== undefined && typeof body !== 'string') { body = JSON.stringify(body); headers.set('Content-Type', 'application/json'); }
    const res = await worker.fetch(new Request('https://apps.example' + url, { method, headers, body }), env);
    const text = await res.text();
    let j; try { j = JSON.parse(text); } catch { j = text; }
    return { status: res.status, j };
  }
  const fetchAs = (email, gate) => async (url, init) => {
    if (gate && gate.offline) throw new TypeError('Failed to fetch');
    const headers = new Headers(init.headers || {}); headers.set('Cf-Access-Jwt-Assertion', TOK[email]);
    return worker.fetch(new Request('https://apps.example' + url, { method: init.method || 'GET', headers, body: init.body }), env);
  };
  /** what the browser's api() does: the JSON, or an error with .status */
  const apiAs = (email) => async (method, url) => {
    const r = await call(email, method, url);
    if (r.status >= 400) { const e = new Error(r.j.error || 'HTTP ' + r.status); e.status = r.status; e.code = 'error'; throw e; }
    return r.j;
  };
  function device(email, role, id, gate) {
    const d = { store: memStore(), gate: gate || {} };
    d.engine = WS.createEngine({ id, me: email, role, fetch: fetchAs(email, d.gate), store: d.store, valid: (v) => !!(v && Array.isArray(v.invoices)), onChange: () => {} });
    d.edit = async (fn) => { const v = d.engine.view(), sh = OPS.shadow(v); fn(v); return d.engine.local(OPS.diff(sh, v)); };
    return d;
  }
  const member = (w, email) => w.members.find((m) => m.email === email);
  async function newWorkspace(name) {
    let r = await call(OWNER, 'POST', '/api/ws', { name, app: 'collections' });
    assert.strictEqual(r.status, 201);
    const ws = r.j;
    r = await call(OWNER, 'PUT', '/api/ws/' + ws.id + '/snapshot?seq=1', JSON.stringify(X.generate(TODAY)));
    assert.strictEqual(r.status, 200);
    for (const [e, role] of [[ANA, 'editor'], [VERA, 'viewer']]) assert.strictEqual((await call(OWNER, 'POST', '/api/ws/' + ws.id + '/members', { email: e, role })).status, 200);
    return ws;
  }

  const ws = await newWorkspace('Termo d.o.o.');

  // ── joining ─────────────────────────────────────────────────────────────────────────────────────────────────────
  await t('joinedAt: the creator has joined; others get it on their first request to the workspace, once', async () => {
    let r = await call(OWNER, 'GET', '/api/ws/' + ws.id);
    assert.ok(member(r.j, OWNER).joinedAt, 'the creator');
    eq([member(r.j, ANA).joinedAt, member(r.j, VERA).joinedAt], [null, null], 'added, not joined yet');
    await call(ANA, 'GET', '/api/ws'); // the list of one's workspaces is not "opening" one
    assert.strictEqual(member((await call(OWNER, 'GET', '/api/ws/' + ws.id)).j, ANA).joinedAt, null);
    r = await call(ANA, 'GET', '/api/ws/' + ws.id + '/ops?since=0');
    assert.strictEqual(r.status, 200);
    const first = member((await call(OWNER, 'GET', '/api/ws/' + ws.id)).j, ANA).joinedAt;
    assert.ok(first > '2026', first);
    await new Promise((res) => setTimeout(res, 5));
    await call(ANA, 'GET', '/api/ws/' + ws.id);
    assert.strictEqual(member((await call(OWNER, 'GET', '/api/ws/' + ws.id)).j, ANA).joinedAt, first, 'set once');
    const act = (await call(OWNER, 'GET', '/api/ws/' + ws.id + '/activity')).j.items;
    eq(act.filter((x) => x.type === 'ws.join').map((x) => [x.by, x.email]), [[ANA, ANA]], 'one "joined" entry in the activity');
    assert.strictEqual(member((await call(OWNER, 'GET', '/api/ws/' + ws.id)).j, VERA).joinedAt, null, 'Vera has not opened it yet');
  });

  // ── invitations ─────────────────────────────────────────────────────────────────────────────────────────────────
  await t('invitedAt: only owners record it, only for members; a second one soon after adds no activity entry', async () => {
    let r = await call(ANA, 'POST', '/api/ws/' + ws.id + '/invite', { email: VERA });
    assert.strictEqual(r.status, 403, 'an editor cannot invite');
    r = await call(EVE, 'POST', '/api/ws/' + ws.id + '/invite', { email: VERA });
    eq([r.status, r.j], [404, { error: 'Not found.' }], 'a non-member learns nothing');
    r = await call(OWNER, 'POST', '/api/ws/' + ws.id + '/invite', { email: EVE });
    assert.strictEqual(r.status, 404, 'not a member');
    r = await call(OWNER, 'POST', '/api/ws/' + ws.id + '/invite', { email: 'nope' });
    assert.strictEqual(r.status, 400);
    r = await call(OWNER, 'POST', '/api/ws/' + ws.id + '/invite', { email: ' Vera@Example.si ' });
    assert.strictEqual(r.status, 200);
    const v1 = member(r.j, VERA);
    assert.ok(v1.invitedAt > '2026'); assert.strictEqual(v1.invitedBy, OWNER); assert.strictEqual(v1.joinedAt, null);
    await new Promise((res) => setTimeout(res, 5));
    r = await call(OWNER, 'POST', '/api/ws/' + ws.id + '/invite', { email: VERA });
    assert.ok(member(r.j, VERA).invitedAt > v1.invitedAt, 'updated');
    const act = (await call(OWNER, 'GET', '/api/ws/' + ws.id + '/activity')).j.items;
    eq(act.filter((x) => x.type === 'ws.invite').map((x) => [x.by, x.email]), [[OWNER, VERA]], 'the .eml and then "Copy": one entry');
    r = await call(VERA, 'GET', '/api/ws/' + ws.id);
    const v = member(r.j, VERA);
    assert.ok(v.invitedAt && v.joinedAt, 'Vera opened it: invited and joined');
    assert.strictEqual(r.j.siteOwner, false);
    assert.strictEqual((await call(OWNER, 'GET', '/api/ws/' + ws.id)).j.siteOwner, true, 'the site owner sees the Cloudflare steps as theirs');
  });
  await t('the invitation text in SL, HR and EN: who invites, which workspace and role, the link, the one-time code', async () => {
    const base = { inviter: OWNER, email: VERA, ws: { id: ws.id, name: 'Termo d.o.o.' }, origin: 'https://business-apps.example.workers.dev/', date: new Date('2026-10-16T08:00:00Z') };
    const link = 'https://business-apps.example.workers.dev/collections/?ws=' + ws.id;
    const want = {
      en: ['one-time code', 'as a viewer', 'cannot change anything', 'Clearfigure Collections'],
      sl: ['enkratno kodo', 'z vlogo »Bralec«', 'ničesar pa ne morete spreminjati', 'Clearfigure Terjatve'],
      hr: ['jednokratni kod', 's ulogom „Čitatelj”', 'ništa ne možete mijenjati', 'Clearfigure Naplata']
    };
    for (const lang of ['en', 'sl', 'hr']) {
      const m = WS.inviteMail({ ...base, lang, role: 'viewer' });
      assert.strictEqual(m.link, link);
      assert.ok(m.text.includes('\n' + link + '\n'), lang + ': the link on its own line');
      for (const s of [OWNER, VERA, 'Termo d.o.o.'].concat(want[lang])) assert.ok(m.text.includes(s) || m.subject.includes(s), lang + ': ' + s);
      assert.ok(m.subject.includes('Termo d.o.o.'));
    }
    const ed = WS.inviteMail({ ...base, lang: 'en', role: 'editor' }), ow = WS.inviteMail({ ...base, lang: 'sl', role: 'owner' });
    assert.ok(ed.text.includes('as an editor') && ed.text.includes('record calls, letters, promises and payments'));
    assert.ok(ow.text.includes('»Lastnik«') && ow.text.includes('ga izbrišete'));
    // the .eml: a new, unsent message to Vera that Outlook opens ready to send
    const m = WS.inviteMail({ ...base, lang: 'sl', role: 'viewer' });
    const [head, ...rest] = m.eml.split('\r\n\r\n');
    assert.ok(/^X-Unsent: 1$/m.test(head), 'X-Unsent');
    assert.ok(/^To: vera@example\.si$/m.test(head));
    assert.ok(!/^From:/m.test(head), 'the mail app fills in the sender');
    const subj = head.match(/^Subject: ([\s\S]*?)\r\n(?=[A-Z])/m)[1].split(/\r\n /).map((w) => Buffer.from(w.match(/=\?UTF-8\?B\?(.*)\?=/)[1], 'base64').toString('utf8')).join('');
    assert.strictEqual(subj, m.subject);
    const part = rest.join('\r\n\r\n').split(/--=_coll_\S+/)[1];
    const b64 = part.split('\r\n\r\n')[1].replace(/\s+/g, '');
    assert.strictEqual(Buffer.from(b64, 'base64').toString('utf8'), m.text.replace(/\n/g, '\r\n'), 'the body, UTF-8 (č, š, ž, »«)');
    assert.ok(/^Vabilo-Termo-d-o-o\.eml$/.test(m.fileName), m.fileName);
    // mailto: the same subject and text
    assert.ok(m.mailto.startsWith('mailto:vera@example.si?subject='));
    const q = new URLSearchParams(m.mailto.slice(m.mailto.indexOf('?') + 1));
    eq([q.get('subject'), q.get('body')], [m.subject, m.text]);
  });

  // ── ?ws= links ──────────────────────────────────────────────────────────────────────────────────────────────────
  await t('?ws=<id>: a member is switched to it; a non-member sees the same "no access" as for one that does not exist', async () => {
    eq([WS.linkId('?ws=' + ws.id), WS.linkId('?a=1&ws=' + ws.id.toUpperCase() + '#/team'), WS.linkId(''), WS.linkId('?wsx=1'), WS.linkId('?ws=%E0%A4')], [ws.id, ws.id, null, null, '']);
    let r = await WS.resolveLink(ws.id, apiAs(ANA), null);
    eq(r, { action: 'choose', ws: { id: ws.id, name: 'Termo d.o.o.', role: 'editor', me: ANA, ready: true, head: r.ws.head } });
    r = await WS.resolveLink(ws.id, apiAs(VERA), { id: 'w-other00000' });
    eq([r.action, r.ws.role], ['choose', 'viewer'], 'from another workspace too');
    eq(await WS.resolveLink(ws.id, apiAs(ANA), { id: ws.id }), { action: 'same' });
    const a = await WS.resolveLink(ws.id, apiAs(EVE), null), b = await WS.resolveLink('w-doesnotexist', apiAs(EVE), null);
    eq(a, { action: 'denied', me: EVE }); eq(b, a, 'identical: it does not reveal that the workspace exists');
    eq(await WS.resolveLink('', apiAs(EVE), null), a, 'a broken link: the same');
    eq(await WS.resolveLink('bad!', apiAs(EVE), null), a);
    eq(await WS.resolveLink(null, apiAs(EVE), null), { action: 'none' });
    const off = await WS.resolveLink(ws.id, async () => { const e = new Error('The server cannot be reached.'); e.code = 'offline'; throw e; }, null);
    assert.strictEqual(off.action, 'error');
  });

  // ── deleting ────────────────────────────────────────────────────────────────────────────────────────────────────
  await t('only an owner deletes: editors, viewers and non-members get exactly the 404 of a missing workspace', async () => {
    const missing = await call(EVE, 'DELETE', '/api/ws/w-doesnotexist', { name: 'Termo d.o.o.' });
    eq([missing.status, missing.j], [404, { error: 'Not found.' }]);
    for (const e of [ANA, VERA, EVE]) {
      const r = await call(e, 'DELETE', '/api/ws/' + ws.id, { name: 'Termo d.o.o.' });
      eq([r.status, r.j], [missing.status, missing.j], e);
    }
    let r = await call(OWNER, 'DELETE', '/api/ws/' + ws.id, { name: 'Termo' });
    assert.strictEqual(r.status, 400, 'the typed name must match');
    r = await call(OWNER, 'DELETE', '/api/ws/' + ws.id);
    assert.strictEqual(r.status, 400, 'no name, no deletion');
    r = await call(ANA, 'GET', '/api/ws/' + ws.id);
    assert.strictEqual(r.status, 200, 'still there');
  });

  // a bigger workspace, so the move takes several requests; devices with and without unsent changes
  const owner = device(OWNER, 'owner', ws.id), gate = { offline: false }, ana = device(ANA, 'editor', ws.id, gate), vera = device(VERA, 'viewer', ws.id);
  await owner.engine.load(); await ana.engine.load(); await vera.engine.load();
  for (let round = 0; round < 20; round++) {
    await owner.edit((v) => { for (let i = 0; i < 200; i++) v.actions.push({ id: 'a-big-' + round + '-' + i, customerId: v.customers[i % 40].id, type: 'note', date: TODAY, invoiceIds: [], text: 'Note ' + round + '/' + i }); });
    await owner.engine.sync();
  }
  await ana.engine.sync(); await vera.engine.sync();
  gate.offline = true;
  await ana.edit((v) => { v.customers[0].notes = 'Written offline, never sent'; });
  assert.strictEqual(ana.engine.status().pending, 1);
  const before = [...r2.store.keys()].filter((k) => k.startsWith('ws/' + ws.id + '/')).sort();
  const bytesOf = (k) => Buffer.from(r2.store.get(k).bytes).toString('utf8');
  const copyOf = {}; before.forEach((k) => { copyOf[k.slice(('ws/' + ws.id + '/').length)] = bytesOf(k); });
  assert.ok(before.length > 40, 'objects: ' + before.length);
  const snapBefore = r2.store.get('ws/' + ws.id + '/collections/snap.json');
  assert.ok(snapBefore && +snapBefore.customMetadata.seq >= 300, 'a compacted state exists');

  let steps = 0;
  await t('the first DELETE marks it: from then on members get 410 everywhere, others 404, and it leaves every list', async () => {
    const c0 = r2.calls;
    const r = await call(OWNER, 'DELETE', '/api/ws/' + ws.id, { name: 'Termo d.o.o.' });
    eq([r.status, r.j.done], [202, false], 'not done in one request');
    assert.ok(r2.calls - c0 <= 45, 'R2 calls in one request: ' + (r2.calls - c0));
    steps++;
    for (const e of [ANA, VERA]) {
      for (const [m, p, body] of [['GET', ''], ['GET', '/ops?since=0'], ['GET', '/snapshot'], ['GET', '/activity'], ['PATCH', '', { name: 'x' }], ['POST', '/members', { email: EVE, role: 'editor' }],
        ['POST', '/ops', { ops: [{ id: 'op-late00001', type: 'log.add', p: { e: { text: 'x' } } }] }], ['PUT', '/snapshot?seq=1', '{}'], ['POST', '/invite', { email: ANA }], ['DELETE', '', { name: 'Termo d.o.o.' }]]) {
        const x = await call(e, m, '/api/ws/' + ws.id + p, body);
        eq([x.status, x.j.deleted, x.j.deletedBy], [410, true, OWNER], e + ' ' + m + ' ' + p);
        assert.ok(!x.j.unfinished, 'only an owner is asked to finish');
      }
    }
    const x = await call(EVE, 'GET', '/api/ws/' + ws.id);
    eq([x.status, x.j], [404, { error: 'Not found.' }]);
    const o = await call(OWNER, 'GET', '/api/ws/' + ws.id);
    eq([o.status, o.j.unfinished, o.j.name], [410, true, 'Termo d.o.o.'], 'the owner\'s device is told to finish it');
    for (const e of [OWNER, ANA, VERA]) eq((await call(e, 'GET', '/api/ws')).j.workspaces, [], e + ': not listed any more');
  });
  await t('a member\'s device: the next sync gets 410 → "deleted" (with who and when); unsent changes stay until cleared', async () => {
    gate.offline = false;
    await ana.engine.sync();
    eq([ana.engine.status().status, ana.engine.status().pending, ana.engine.status().deleted.by], ['deleted', 1, OWNER]);
    assert.ok(ana.engine.view().customers[0].notes === 'Written offline, never sent', 'still there to download as JSON');
    await ana.engine.clear();
    eq([ana.store.m.size, ana.engine.status().hasData, ana.engine.status().pending], [0, false, 0], 'nothing of the workspace is left on the device');
    await vera.engine.sync();
    eq([vera.engine.status().status, vera.engine.status().pending], ['deleted', 0]);
  });
  await t('the owner\'s device repeats the DELETE until done; each request stays within the R2 call budget', async () => {
    let maxCalls = 0, c = r2.calls;
    const res = await owner.engine.remove('Termo d.o.o.', () => { maxCalls = Math.max(maxCalls, r2.calls - c); c = r2.calls; steps++; });
    eq([res.done, !!res.already], [true, false]);
    assert.ok(steps >= 3, 'several requests: ' + steps);
    assert.ok(maxCalls <= 45, 'R2 calls per request: ' + maxCalls);
    eq(owner.engine.status().deleted.by, OWNER);
  });
  await t('afterwards: nothing under ws/<id>/, all of it under ws-deleted/<id>-<time>/, wsu lists cleaned, a tombstone', async () => {
    assert.deepStrictEqual([...r2.store.keys()].filter((k) => k.startsWith('ws/' + ws.id + '/')), []);
    const tomb = JSON.parse(bytesOf('ws-deleted/' + ws.id + '.json'));
    eq([tomb.deletedBy, tomb.done, tomb.members.sort(), tomb.name], [OWNER, true, [ANA, OWNER, VERA], 'Termo d.o.o.']);
    assert.ok(new RegExp('^ws-deleted/' + ws.id + '-\\d{8}T\\d{6}Z/$').test(tomb.to), tomb.to);
    const moved = [...r2.store.keys()].filter((k) => k.startsWith(tomb.to)).sort();
    eq(moved.map((k) => k.slice(tomb.to.length)).sort(), Object.keys(copyOf).sort(), 'every object moved');
    for (const rel of Object.keys(copyOf)) if (rel !== 'meta.json') assert.strictEqual(bytesOf(tomb.to + rel), copyOf[rel], rel);
    const meta = JSON.parse(bytesOf(tomb.to + 'meta.json'));
    eq([meta.deleting.by, meta.members.length], [OWNER, 3], 'who deleted it and when, with the members');
    eq(r2.store.get(tomb.to + 'collections/snap.json').customMetadata, snapBefore.customMetadata, 'custom metadata copied');
    assert.ok([...r2.store.keys()].every((k) => !k.includes('@')), 'no e-mail in any key');
    for (const e of [OWNER, ANA, VERA]) {
      const wsu = [...r2.store.keys()].filter((k) => k.startsWith('wsu/'));
      for (const k of wsu) assert.ok(!JSON.parse(bytesOf(k)).ids.includes(ws.id), k + ' still lists it');
      eq((await call(e, 'GET', '/api/ws')).j.workspaces, [], e);
    }
  });
  await t('after the delete every endpoint answers 410 to its members and 404 to everyone else, for good', async () => {
    const missing = await call(EVE, 'GET', '/api/ws/w-doesnotexist');
    for (const [m, p, body] of [['GET', ''], ['GET', '/ops?since=0'], ['GET', '/snapshot'], ['GET', '/activity'], ['PATCH', '', { name: 'x' }], ['POST', '/members', { email: EVE, role: 'owner' }],
      ['POST', '/ops', { ops: [{ id: 'op-after0001', type: 'log.add', p: { e: { text: 'x' } } }] }], ['PUT', '/snapshot?seq=1', '{}'], ['POST', '/invite', { email: ANA }], ['DELETE', '', { name: 'Termo d.o.o.' }]]) {
      for (const e of [OWNER, ANA, VERA]) {
        const x = await call(e, m, '/api/ws/' + ws.id + p, body);
        eq([x.status, x.j.deleted], [410, true], e + ' ' + m + ' ' + p);
      }
      const x = await call(EVE, m, '/api/ws/' + ws.id + p, body);
      eq([x.status, x.j], [missing.status, missing.j], 'eve ' + m + ' ' + p);
    }
    assert.deepStrictEqual([...r2.store.keys()].filter((k) => k.startsWith('ws/' + ws.id + '/')), [], 'nothing was written back');
    eq(await owner.engine.remove('Termo d.o.o.'), { done: true, moved: 0, already: true }, 'deleting again: already done');
    eq(await WS.resolveLink(ws.id, apiAs(ANA), null), { action: 'denied', me: ANA }, 'an old invitation link: "no access"');
  });
  await t('deleting one workspace leaves the others untouched; a DELETE the device repeats finishes or answers "already"', async () => {
    const other = await newWorkspace('Second team'), third = await newWorkspace('Third team');
    let r = await call(OWNER, 'DELETE', '/api/ws/' + other.id, { name: 'Second team' });
    assert.ok(r.status === 202 || r.status === 200);
    const dev = device(OWNER, 'owner', other.id);
    await dev.engine.refreshInfo().catch(() => {});
    if (r.status === 202) eq([dev.engine.status().status, dev.engine.status().deleted.unfinished, dev.engine.status().deleted.name], ['deleted', true, 'Second team']);
    r = await dev.engine.remove(dev.engine.status().deleted ? dev.engine.status().deleted.name || 'Second team' : 'Second team');
    assert.strictEqual(r.done, true);
    assert.deepStrictEqual([...r2.store.keys()].filter((k) => k.startsWith('ws/' + other.id + '/')), []);
    r = await call(ANA, 'GET', '/api/ws');
    eq(r.j.workspaces.map((w) => w.id), [third.id], 'the third one stays');
    assert.strictEqual((await call(VERA, 'GET', '/api/ws/' + third.id + '/snapshot')).status, 200);
  });

  globalThis.fetch = realFetch;
  console.log('collections-workspaces-admin: ' + n + ' tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
