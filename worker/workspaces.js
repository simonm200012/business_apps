// Team workspaces (pilot: Collections). Several people of one customer company work in the same data, with roles.
// Routed from worker/index.js for /api/ws and /api/ws/*. Same Cloudflare Access token check as the rest of the API
// (worker/access.js, verifiedEmail), but anyone with a valid token may call these routes: what they can do is decided
// here, on the server, from the workspace's member list. Nobody's personal cloud copy (u/<hash>/…) is ever touched.
//
//   GET   /api/ws                        { me, canCreate, workspaces: [{ id, name, app, role, members, ready }] }
//   POST  /api/ws                        { name, app: 'collections' } → the new workspace (only OWNER_EMAIL)
//   GET   /api/ws/:id                    { id, name, app, role, members: [{ email, role, addedBy, addedAt }], ready, head, snap }
//   PATCH /api/ws/:id                    { name }                                   (owner)
//   POST  /api/ws/:id/members            { email, role: 'owner'|'editor'|'viewer'|'remove' }  add, change, remove (owner;
//                                        anyone may remove themselves); the last owner can never be removed or demoted
//   GET   /api/ws/:id/ops?since=N        { ops: [{ seq, id, by, at, type, p }], head, more }  (members)
//   POST  /api/ws/:id/ops                { ops: [{ id, type, p }] } → { accepted: [{ id, seq }], dup: [ids], head }  (editors, owners)
//   GET   /api/ws/:id/snapshot           the newest compacted state (raw JSON); X-Ws-Seq: the op it includes   (members)
//   PUT   /api/ws/:id/snapshot?seq=N     body = the state after op N (editors, owners; the owner's first one is the seed)
//   GET   /api/ws/:id/activity?limit=N&before=S  { items: [{ seq, by, at, type, ...summary }], more }, newest first (members)
//
// R2 layout (bucket SYNC, prefix ws/; e-mails only inside objects, never in keys):
//   ws/<id>/meta.json                    { id, name, app, members, createdAt, createdBy, ready }
//   ws/<id>/<app>/log.json               { v, first, head, ops: [the newest ops, first…head], ids: [recent op ids] };
//                                        customMetadata { head, first } so a poll needs only a HEAD request.
//                                        Every write is conditional on its etag (onlyIf), which gives one strict order.
//   ws/<id>/<app>/ops/<k>.json           sealed chunk k: ops k*CHUNK+1 … (k+1)*CHUNK, never changed again
//   ws/<id>/<app>/seed.json              the first state (the owner's choice at creation), kept for good
//   ws/<id>/<app>/snap.json              the newest compacted state; customMetadata { seq, by, at }
//   wsu/<sha256 of the e-mail>.json      { ids } the workspaces an e-mail was added to (a hint: meta.json decides)
//
// Membership events (created, member added/changed/removed, renamed, snapshot saved) are ops of type ws.* in the same
// log, so the activity list shows who did what in one order. Ops and batches have size limits; ids are checked.
// DEV_BYPASS=1 (local .dev.vars only) on localhost: the caller is OWNER_EMAIL, or the e-mail in the cookie
// stratum_dev_as, so two browser profiles can act as two people. On any other host DEV_BYPASS does nothing here.
import { verifiedEmail } from './access.js';

const WSID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const OPID = /^[a-z0-9][a-z0-9-]{7,39}$/;
const EMAIL = /^[^\s@<>"',;]{1,64}@[a-z0-9.-]{1,190}\.[a-z]{2,24}$/;
const APPS = ['collections'];
const ROLES = ['owner', 'editor', 'viewer'];
const OP_TYPES = ['rec.put', 'rec.del', 'sub.add', 'sub.del', 'doc.put', 'set.add', 'log.add'];
const CHUNK = 100, KEEP_IDS = 3000, MAX_PULL = 500, MAX_MEMBERS = 50;
const MAX_OP = 32 * 1024, MAX_BATCH_OPS = 200, MAX_BATCH = 512 * 1024, MAX_STATE = 60 * 1024 * 1024;
const SNAP_EVERY = 50; // a new compacted state only after at least this many ops
const NO_STORE = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

const json = (body, status = 200, extra) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...NO_STORE, ...(extra || {}) } });
const notFound = () => json({ error: 'Not found.' }, 404);
const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
const pad = (k) => String(k).padStart(9, '0');
const keys = (id, app) => {
  const b = 'ws/' + id + '/';
  return { meta: b + 'meta.json', log: b + app + '/log.json', chunk: (k) => b + app + '/ops/' + pad(k) + '.json', seed: b + app + '/seed.json', snap: b + app + '/snap.json' };
};
async function userKey(email) {
  return 'wsu/' + hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('stratum-ws:' + email))).slice(0, 40) + '.json';
}
const isLocal = (host) => host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost');
function cookie(request, name) {
  const m = String(request.headers.get('Cookie') || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
  try { return m ? decodeURIComponent(m[1]) : ''; } catch { return ''; }
}
const normEmail = (e) => String(e || '').trim().toLowerCase();
const validEmail = (e) => typeof e === 'string' && e.length <= 254 && EMAIL.test(e);

/** → { email } or a Response (not signed in, Access not set up) */
async function caller(request, env, url) {
  const owner = normEmail(env.OWNER_EMAIL);
  if (env.DEV_BYPASS === '1' && isLocal(url.hostname)) {
    const as = normEmail(cookie(request, 'stratum_dev_as'));
    return { email: validEmail(as) ? as : owner || 'owner@local.test' };
  }
  let v;
  try { v = await verifiedEmail(request, env); } catch { return json({ error: 'The sign-in check is temporarily unavailable. Try again in a moment.' }, 503); }
  if (v.error === 'setup' || !owner) return json({ error: 'Cloudflare Access is not configured for this site.' }, 503);
  if (v.error || !validEmail(v.email)) return json({ error: 'Your sign-in has expired. Reload the page to sign in again.' }, 401);
  return { email: v.email };
}

async function readJson(env, key) {
  const obj = await env.SYNC.get(key);
  if (!obj) return { obj: null, val: null };
  try { return { obj, val: JSON.parse(await obj.text()) }; } catch { return { obj, val: null }; }
}
const roleOf = (meta, email) => { const m = meta && Array.isArray(meta.members) && meta.members.find((x) => x.email === email); return m ? m.role : null; };
const owners = (meta) => meta.members.filter((m) => m.role === 'owner').length;
function publicMeta(meta, role, log) {
  return { id: meta.id, name: meta.name, app: meta.app, role, ready: !!meta.ready, createdAt: meta.createdAt,
    members: meta.members.map((m) => ({ email: m.email, role: m.role, addedBy: m.addedBy, addedAt: m.addedAt })), ...(log || {}) };
}
function randomId() {
  const b = crypto.getRandomValues(new Uint8Array(10));
  return 'w-' + Array.from(b, (x) => (x % 36).toString(36)).join('');
}

export async function workspaces(request, env, url) {
  if (!env.SYNC) return json({ error: 'Cloud storage is not configured for this site.' }, 503);
  const who = await caller(request, env, url);
  if (who instanceof Response) return who;
  const me = who.email, method = request.method;
  if (method !== 'GET' && method !== 'HEAD' && request.headers.get('X-Tokovi-Apps') !== '1') return json({ error: 'Missing X-Tokovi-Apps header.' }, 400);
  const m = url.pathname.match(/^\/api\/ws(?:\/([^/]+)(?:\/(members|ops|snapshot|activity))?)?\/?$/);
  if (!m) return notFound();
  const id = m[1], sub = m[2];
  if (!id) {
    if (method === 'GET') return listMine(env, me);
    if (method === 'POST') return create(request, env, me);
    return json({ error: 'Method not allowed.' }, 405);
  }
  if (!WSID.test(id)) return notFound();
  const metaKey = keys(id, 'x').meta;
  const { obj: metaObj, val: meta } = await readJson(env, metaKey);
  const role = roleOf(meta, me);
  if (!meta || !role) return notFound(); // a workspace you are not in looks exactly like one that does not exist
  const K = keys(id, meta.app);
  const canWrite = role === 'owner' || role === 'editor';

  if (!sub) {
    if (method === 'GET') {
      const [head, snap] = await Promise.all([env.SYNC.head(K.log), env.SYNC.head(K.snap)]);
      const h = logMeta(head);
      return json(publicMeta(meta, role, { head: h.head, snap: snap ? { seq: +snap.customMetadata.seq || 0, at: snap.customMetadata.at || null, size: snap.size } : null }));
    }
    if (method === 'PATCH') {
      if (role !== 'owner') return json({ error: 'Only an owner of this workspace can rename it.' }, 403);
      const body = await smallJson(request, 4096);
      const name = cleanName(body && body.name);
      if (!name) return json({ error: 'Enter a name for the workspace.' }, 400);
      const next = { ...meta, name };
      if (await env.SYNC.put(metaKey, JSON.stringify(next), { onlyIf: { etagMatches: metaObj.etag }, httpMetadata: { contentType: 'application/json' } }) === null) return json({ error: 'The workspace was changed at the same time. Try again.' }, 409);
      await append(env, K, [{ type: 'ws.rename', p: { name } }], me);
      return json(publicMeta(next, role));
    }
    return json({ error: 'Method not allowed.' }, 405);
  }
  if (sub === 'members') {
    if (method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
    return members(request, env, K, metaKey, metaObj, meta, me, role);
  }
  if (sub === 'ops') {
    if (method === 'GET') return pull(env, K, url);
    if (method === 'POST') {
      if (!canWrite) return json({ error: 'You can only view this workspace.', viewer: true }, 403);
      if (!meta.ready) return json({ error: 'This workspace is still being set up. Try again in a moment.' }, 409);
      return push(request, env, K, me);
    }
    return json({ error: 'Method not allowed.' }, 405);
  }
  if (sub === 'snapshot') {
    if (method === 'GET') return getSnapshot(env, K);
    if (method === 'PUT') {
      if (!canWrite) return json({ error: 'You can only view this workspace.', viewer: true }, 403);
      return putSnapshot(request, env, K, url, metaKey, metaObj, meta, me, role);
    }
    return json({ error: 'Method not allowed.' }, 405);
  }
  if (sub === 'activity') {
    if (method !== 'GET') return json({ error: 'Method not allowed.' }, 405);
    return activity(env, K, url);
  }
  return notFound();
}

function cleanName(s) { return typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) : ''; }
async function smallJson(request, max) {
  const len = Number(request.headers.get('Content-Length'));
  if (len > max) return null;
  const text = await request.text();
  if (text.length > max) return null;
  try { return JSON.parse(text); } catch { return null; }
}
const logMeta = (obj) => ({ head: obj ? +obj.customMetadata.head || 0 : 0, first: obj ? +obj.customMetadata.first || 1 : 1 });

// ── list and create ───────────────────────────────────────────────────────────────────────────────────────────────
async function listMine(env, me) {
  const owner = normEmail(env.OWNER_EMAIL);
  const { val } = await readJson(env, await userKey(me));
  const ids = (val && Array.isArray(val.ids) ? val.ids : []).filter((x) => WSID.test(x)).slice(0, 100);
  const out = [];
  for (const id of ids) {
    const { val: meta } = await readJson(env, keys(id, 'x').meta);
    const role = roleOf(meta, me);
    if (role) out.push({ id, name: meta.name, app: meta.app, role, members: meta.members.length, ready: !!meta.ready });
  }
  return json({ me, canCreate: me === owner, workspaces: out });
}
async function indexUser(env, email, id, add) {
  const key = await userKey(email);
  for (let i = 0; i < 5; i++) {
    const { obj, val } = await readJson(env, key);
    const ids = (val && Array.isArray(val.ids) ? val.ids : []).filter((x) => x !== id);
    if (add) ids.push(id);
    const opts = { httpMetadata: { contentType: 'application/json' } };
    if (obj) opts.onlyIf = { etagMatches: obj.etag };
    if (await env.SYNC.put(key, JSON.stringify({ ids }), opts) !== null) return;
  }
}
async function create(request, env, me) {
  if (me !== normEmail(env.OWNER_EMAIL)) return json({ error: 'Only the site owner can create team workspaces.' }, 403);
  const body = await smallJson(request, 4096);
  const name = cleanName(body && body.name), app = body && body.app;
  if (!name) return json({ error: 'Enter a name for the workspace.' }, 400);
  if (!APPS.includes(app)) return json({ error: 'Team workspaces are only available for Collections for now.' }, 400);
  let id;
  for (let i = 0; i < 5 && !id; i++) { const c = randomId(); if (!(await env.SYNC.head(keys(c, app).meta))) id = c; }
  if (!id) return json({ error: 'Something went wrong on the server. Try again.' }, 500);
  const K = keys(id, app), at = new Date().toISOString();
  const meta = { v: 1, id, name, app, createdAt: at, createdBy: me, ready: false, members: [{ email: me, role: 'owner', addedBy: me, addedAt: at }] };
  const first = { seq: 1, id: 'ws-create-' + id.slice(2), by: me, at, type: 'ws.create', p: { name } };
  await env.SYNC.put(K.log, JSON.stringify({ v: 1, first: 1, head: 1, ops: [first], ids: [first.id] }), { httpMetadata: { contentType: 'application/json' }, customMetadata: { head: '1', first: '1' } });
  await env.SYNC.put(K.meta, JSON.stringify(meta), { httpMetadata: { contentType: 'application/json' } });
  await indexUser(env, me, id, true);
  return json(publicMeta(meta, 'owner', { head: 1, snap: null }), 201);
}

// ── members ───────────────────────────────────────────────────────────────────────────────────────────────────────
async function members(request, env, K, metaKey, metaObj, meta, me, role) {
  const body = await smallJson(request, 4096);
  const email = normEmail(body && body.email), want = body && body.role;
  if (!validEmail(email)) return json({ error: 'Enter a valid e-mail address.' }, 400);
  if (want !== 'remove' && !ROLES.includes(want)) return json({ error: 'Choose owner, editor or viewer.' }, 400);
  const self = email === me;
  if (role !== 'owner' && !(self && want === 'remove')) return json({ error: 'Only an owner of this workspace can manage its members.' }, 403);
  let cur = meta, curObj = metaObj, prev;
  for (let i = 0; i < 5; i++) {
    const list = cur.members.slice(), at = list.findIndex((x) => x.email === email);
    prev = at >= 0 ? list[at].role : null;
    if (want === 'remove') {
      if (at < 0) return json({ error: 'That person is not a member of this workspace.' }, 404);
      if (prev === 'owner' && owners(cur) <= 1) return json({ error: 'A workspace needs at least one owner. Make someone else an owner first.' }, 409);
      list.splice(at, 1);
    } else if (at >= 0) {
      if (prev === want) return json(publicMeta(cur, roleOf(cur, me)));
      if (prev === 'owner' && owners(cur) <= 1) return json({ error: 'A workspace needs at least one owner. Make someone else an owner first.' }, 409);
      list[at] = { ...list[at], role: want };
    } else {
      if (list.length >= MAX_MEMBERS) return json({ error: 'A workspace has at most ' + MAX_MEMBERS + ' members.' }, 409);
      list.push({ email, role: want, addedBy: me, addedAt: new Date().toISOString() });
    }
    const next = { ...cur, members: list };
    if (await env.SYNC.put(metaKey, JSON.stringify(next), { onlyIf: { etagMatches: curObj.etag }, httpMetadata: { contentType: 'application/json' } }) !== null) {
      if (want === 'remove' || prev === null) await indexUser(env, email, cur.id, want !== 'remove');
      await append(env, K, [{ type: 'ws.member', p: { email, role: want === 'remove' ? null : want, prev } }], me);
      return json(publicMeta(next, roleOf(next, me) || null));
    }
    const again = await readJson(env, metaKey); // changed meanwhile: decide again on the newest list
    cur = again.val; curObj = again.obj;
    if (!cur || roleOf(cur, me) !== role) return json({ error: 'The workspace was changed at the same time. Reload and try again.' }, 409);
  }
  return json({ error: 'The workspace was changed at the same time. Try again.' }, 409);
}

// ── the operation log ─────────────────────────────────────────────────────────────────────────────────────────────
/** appends entries ({ id?, type, p }) in one strict order; ids already in the log are not added again (→ dup) */
async function append(env, K, entries, by) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const { obj, val } = await readJson(env, K.log);
    if (!obj || !val) throw new Error('workspace log missing');
    const log = val, seen = new Set(log.ids), accepted = [], dup = [], at = new Date().toISOString();
    for (const e of entries) {
      const id = e.id || ('s-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10));
      if (seen.has(id)) { dup.push(id); continue; }
      seen.add(id);
      const seq = ++log.head;
      log.ops.push({ seq, id, by, at, type: e.type, p: e.p });
      log.ids.push(id);
      accepted.push({ id, seq });
    }
    if (!accepted.length) return { accepted, dup, head: log.head };
    if (log.ids.length > KEEP_IDS) log.ids = log.ids.slice(-KEEP_IDS);
    // seal full chunks (the same ops always make the same chunk, so a retry writing it again is harmless)
    while (log.ops.length >= 2 * CHUNK) {
      const k = Math.floor((log.first - 1) / CHUNK);
      await env.SYNC.put(K.chunk(k), JSON.stringify(log.ops.slice(0, CHUNK)), { httpMetadata: { contentType: 'application/json' } });
      log.ops = log.ops.slice(CHUNK); log.first += CHUNK;
    }
    const put = await env.SYNC.put(K.log, JSON.stringify(log), { onlyIf: { etagMatches: obj.etag }, httpMetadata: { contentType: 'application/json' },
      customMetadata: { head: String(log.head), first: String(log.first) } });
    if (put !== null) return { accepted, dup, head: log.head };
  }
  return null;
}
function checkOp(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return 'An operation is not an object.';
  if (typeof o.id !== 'string' || !OPID.test(o.id)) return 'An operation has no valid id.';
  if (!OP_TYPES.includes(o.type)) return 'Unknown operation type.';
  if (!o.p || typeof o.p !== 'object' || Array.isArray(o.p)) return 'An operation has no payload.';
  if (JSON.stringify(o.p).length > MAX_OP) return 'An operation is too large.';
  return '';
}
async function push(request, env, K, me) {
  const len = Number(request.headers.get('Content-Length'));
  if (len > MAX_BATCH) return json({ error: 'Too many changes at once. Try again.' }, 413);
  const text = await request.text();
  if (text.length > MAX_BATCH) return json({ error: 'Too many changes at once. Try again.' }, 413);
  let body; try { body = JSON.parse(text); } catch { return json({ error: 'Bad request.' }, 400); }
  const ops = body && Array.isArray(body.ops) ? body.ops : null;
  if (!ops || !ops.length) return json({ error: 'No changes sent.' }, 400);
  if (ops.length > MAX_BATCH_OPS) return json({ error: 'Too many changes at once. Try again.' }, 413);
  for (const o of ops) { const bad = checkOp(o); if (bad) return json({ error: bad }, 400); }
  // only id, type and payload are taken from the device: seq, by (the verified e-mail) and at are the server's
  const r = await append(env, K, ops.map((o) => ({ id: o.id, type: o.type, p: o.p })), me);
  if (!r) return json({ error: 'Many changes arrived at the same time. Try again.' }, 503);
  return json(r);
}
async function pull(env, K, url) {
  const since = Math.max(0, parseInt(url.searchParams.get('since') || '0', 10) || 0);
  const limit = Math.min(MAX_PULL, Math.max(1, parseInt(url.searchParams.get('limit') || String(MAX_PULL), 10) || MAX_PULL));
  const h = logMeta(await env.SYNC.head(K.log));
  if (since >= h.head) return json({ ops: [], head: h.head, more: false }); // the usual poll: one HEAD, nothing parsed
  const { val: log } = await readJson(env, K.log);
  if (!log) return json({ ops: [], head: h.head, more: false });
  const out = [];
  let next = since + 1;
  while (next < log.first && out.length < limit) { // older than the log's tail: the sealed chunks
    const k = Math.floor((next - 1) / CHUNK);
    const { val: chunk } = await readJson(env, K.chunk(k));
    if (!Array.isArray(chunk)) break;
    for (const op of chunk) if (op.seq >= next && out.length < limit) out.push(op);
    next = (k + 1) * CHUNK + 1;
  }
  if (out.length < limit) for (const op of log.ops) if (op.seq >= next && out.length < limit) out.push(op);
  const last = out.length ? out[out.length - 1].seq : since;
  return json({ ops: out, head: log.head, more: last < log.head });
}

// ── compacted state ───────────────────────────────────────────────────────────────────────────────────────────────
async function getSnapshot(env, K) {
  const obj = (await env.SYNC.get(K.snap)) || (await env.SYNC.get(K.seed));
  if (!obj) return json({ error: 'This workspace has no data yet.' }, 404);
  return new Response(obj.body, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Ws-Seq': String(+obj.customMetadata.seq || 0), ...NO_STORE } });
}
async function putSnapshot(request, env, K, url, metaKey, metaObj, meta, me, role) {
  const seq = parseInt(url.searchParams.get('seq') || '', 10);
  const h = logMeta(await env.SYNC.head(K.log));
  if (!(seq >= 0) || seq > h.head) return json({ error: 'Bad address.' }, 400);
  const len = Number(request.headers.get('Content-Length'));
  if (len > MAX_STATE) return json({ error: 'This data is too large to sync.' }, 413);
  const at = new Date().toISOString();
  if (!meta.ready) { // the seed: the owner's first state, chosen when the workspace was made
    if (role !== 'owner') return json({ error: 'Only an owner can set up this workspace.' }, 403);
    if (await env.SYNC.head(K.seed)) return json({ error: 'This workspace already has its data.' }, 409);
    const buf = await request.arrayBuffer();
    if (buf.byteLength > MAX_STATE || buf.byteLength < 2) return json({ error: 'This data is too large to sync.' }, 413);
    await env.SYNC.put(K.seed, buf, { httpMetadata: { contentType: 'application/json' }, customMetadata: { seq: String(h.head), by: me, at } });
    const next = { ...meta, ready: true };
    if (await env.SYNC.put(metaKey, JSON.stringify(next), { onlyIf: { etagMatches: metaObj.etag }, httpMetadata: { contentType: 'application/json' } }) === null) return json({ error: 'The workspace was changed at the same time. Try again.' }, 409);
    return json({ seq: h.head, seed: true });
  }
  const cur = await env.SYNC.head(K.snap), base = cur || (await env.SYNC.head(K.seed));
  const curSeq = base ? +base.customMetadata.seq || 0 : 0;
  if (seq < curSeq + SNAP_EVERY) return json({ error: 'A newer compacted copy is already stored.', seq: curSeq }, 409);
  const buf = await request.arrayBuffer();
  if (buf.byteLength > MAX_STATE || buf.byteLength < 2) return json({ error: 'This data is too large to sync.' }, 413);
  const opts = { httpMetadata: { contentType: 'application/json' }, customMetadata: { seq: String(seq), by: me, at } };
  if (cur) opts.onlyIf = { etagMatches: cur.etag };
  if (await env.SYNC.put(K.snap, buf, opts) === null) return json({ error: 'A newer compacted copy is already stored.' }, 409);
  return json({ seq });
}

// ── activity: who did what, newest first ──────────────────────────────────────────────────────────────────────────
function summarize(op) {
  const p = op.p && typeof op.p === 'object' ? op.p : {}, s = { seq: op.seq, by: op.by, at: op.at, type: op.type };
  if (typeof p.c === 'string') s.c = p.c.slice(0, 20);
  if (op.type === 'rec.put' && p.n && Array.isArray(p.f) && p.f[0] && p.f[0][1] && typeof p.f[0][1] === 'object') {
    const r = p.f[0][1]; s.n = 1;
    if (typeof r.type === 'string') s.actType = r.type.slice(0, 20);
    if (typeof r.customerId === 'string') s.customerId = r.customerId.slice(0, 40);
    if (typeof r.amount === 'number') s.amount = r.amount;
    if (typeof r.name === 'string') s.name = r.name.slice(0, 80);
    if (typeof r.no === 'string') s.no = r.no.slice(0, 40);
  }
  if (op.type === 'rec.put' && !p.n && typeof p.id === 'string') s.id = p.id.slice(0, 40);
  if (op.type === 'sub.add' && p.item && typeof p.item.amount === 'number') s.amount = p.item.amount;
  if (op.type === 'rec.del' && Array.isArray(p.ids)) s.count = p.ids.length;
  if (op.type === 'log.add' && p.e && typeof p.e.text === 'string') s.text = p.e.text.slice(0, 200);
  if (op.type.startsWith('ws.')) { if (p.email) s.email = p.email; if ('role' in p) s.role = p.role; if (p.prev) s.prev = p.prev; if (p.name) s.name = p.name; }
  return s;
}
async function activity(env, K, url) {
  const limit = Math.min(300, Math.max(1, parseInt(url.searchParams.get('limit') || '150', 10) || 150));
  const before = parseInt(url.searchParams.get('before') || '', 10) || Infinity; // paging: ops older than this number
  const { val: log } = await readJson(env, K.log);
  if (!log) return json({ items: [], head: 0, more: false });
  let ops = log.ops.filter((o) => o.seq < before);
  let low = log.first; // the oldest number read so far
  for (let reads = 0; ops.length < limit && low > 1 && reads < 4; reads++) {
    const k = Math.floor((Math.min(low, before) - 2) / CHUNK);
    if (k < 0) break;
    const { val: chunk } = await readJson(env, K.chunk(k));
    if (!Array.isArray(chunk)) break;
    ops = chunk.filter((o) => o.seq < before).concat(ops);
    low = k * CHUNK + 1;
  }
  const items = ops.slice(-limit).reverse().map(summarize);
  const oldest = items.length ? items[items.length - 1].seq : 0;
  return json({ items, head: log.head, more: oldest > 1 });
}
