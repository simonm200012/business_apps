// Team workspaces (pilot: Collections). Several people of one customer company work in the same data, with roles.
// Routed from worker/index.js for /api/ws and /api/ws/*. Same Cloudflare Access token check as the rest of the API
// (worker/access.js, verifiedEmail), but anyone with a valid token may call these routes: what they can do is decided
// here, on the server, from the workspace's member list. Nobody's personal cloud copy (u/<hash>/…) is ever touched.
//
//   GET   /api/ws                        { me, canCreate, workspaces: [{ id, name, app, role, members, ready }] }
//   POST  /api/ws                        { name, app: 'collections' } → the new workspace (only OWNER_EMAIL)
//   GET   /api/ws/:id                    { id, name, app, role, siteOwner, members: [{ email, role, addedBy, addedAt, invitedAt,
//                                        invitedBy, joinedAt }], ready, head, snap }
//   PATCH /api/ws/:id                    { name }                                   (owner)
//   DELETE /api/ws/:id                   { name } (the workspace's name, typed by the owner) → 202 { done: false, moved } while
//                                        objects are still being moved (call again: it resumes), 200 { done: true, deletedAt }
//                                        (owner; anyone else gets the same 404 as for a workspace that does not exist)
//   POST  /api/ws/:id/invite             { email } → the workspace; records that an owner sent that member an invitation
//                                        (invitedAt, invitedBy). The text itself is made in the browser (ws-sync.js).
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
//   ws-deleted/<id>-<time>/…             a deleted workspace: everything that was under ws/<id>/, same relative paths
//   ws-deleted/<id>.json                 its tombstone { id, name, deletedAt, deletedBy, to, members: [e-mails], done }, so
//                                        members get 410 "deleted" (and switch back) while others still get 404
//
// Joining: the first request a member makes to a workspace sets their joinedAt (once; a ws.join entry in the activity).
// Invitations are not sent by the server (there is no mail service): the owner's browser makes an .eml / mailto / text,
// and POST …/invite records invitedAt.
//
// Deleting (owner only) never leaves a half-deleted workspace usable: meta.json first gets `deleting`, from then on every
// request answers 410 to members (404 to everyone else); then the members' wsu/ lists are cleaned, every object is copied
// to ws-deleted/<id>-<time>/ and the original deleted, a few at a time (MOVE_BUDGET R2 calls per request, so it stays far
// inside the Free plan's subrequest limits; the browser repeats the DELETE until done), and meta.json moves last.
// Deleted workspaces are KEPT 30 DAYS, then removed for good by an R2 lifecycle rule on the prefix ws-deleted/ (see
// HANDOFF.md, "Team workspaces"; the rule counts from when the copies were written, i.e. the deletion). No restore
// button: within the 30 days the site owner can copy a ws-deleted/<id>-<time>/ folder back to ws/<id>/ by hand.
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
const MOVE_BUDGET = 40; // R2 calls one DELETE request may spend moving a workspace (it resumes on the next request)
const INVITE_QUIET_MS = 10 * 60e3; // a second "invited" within this time updates invitedAt without a new activity entry
const NO_STORE = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

const json = (body, status = 200, extra) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...NO_STORE, ...(extra || {}) } });
const notFound = () => json({ error: 'Not found.' }, 404);
const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
const pad = (k) => String(k).padStart(9, '0');
const keys = (id, app) => {
  const b = 'ws/' + id + '/';
  return { prefix: b, tomb: 'ws-deleted/' + id + '.json', meta: b + 'meta.json', log: b + app + '/log.json', chunk: (k) => b + app + '/ops/' + pad(k) + '.json', seed: b + app + '/seed.json', snap: b + app + '/snap.json' };
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
    members: meta.members.map((m) => ({ email: m.email, role: m.role, addedBy: m.addedBy, addedAt: m.addedAt,
      invitedAt: m.invitedAt || null, invitedBy: m.invitedBy || null, joinedAt: m.joinedAt || null })), ...(log || {}) };
}
/** a deleted (or being deleted) workspace: members are told so (410), so their devices switch back; nobody else learns it existed */
const deletedFor = (d, extra) => json({ error: 'This workspace was deleted.', deleted: true, deletedAt: d.deletedAt || d.at || null, deletedBy: d.deletedBy || d.by || null, ...(extra || {}) }, 410);
function randomId() {
  const b = crypto.getRandomValues(new Uint8Array(10));
  return 'w-' + Array.from(b, (x) => (x % 36).toString(36)).join('');
}

export async function workspaces(request, env, url) {
  if (!env.SYNC) return json({ error: 'Cloud storage is not configured for this site.' }, 503);
  const who = await caller(request, env, url);
  if (who instanceof Response) return who;
  const me = who.email, method = request.method;
  if (method !== 'GET' && method !== 'HEAD' && request.headers.get('X-Stratum-Apps') !== '1' && request.headers.get('X-Tokovi-Apps') !== '1' /* 16 Oct 2026 build; drop after 2026-12-31 */) return json({ error: 'Missing X-Stratum-Apps header.' }, 400);
  const m = url.pathname.match(/^\/api\/ws(?:\/([^/]+)(?:\/(members|invite|ops|snapshot|activity))?)?\/?$/);
  if (!m) return notFound();
  const id = m[1], sub = m[2];
  if (!id) {
    if (method === 'GET') return listMine(env, me);
    if (method === 'POST') return create(request, env, me);
    return json({ error: 'Method not allowed.' }, 405);
  }
  if (!WSID.test(id)) return notFound();
  const metaKey = keys(id, 'x').meta;
  let { obj: metaObj, val: meta } = await readJson(env, metaKey);
  const role = roleOf(meta, me);
  if (!meta) { // gone: a member of a deleted workspace is told (410); anyone else gets the plain 404
    const { val: tomb } = await readJson(env, keys(id, 'x').tomb);
    return tomb && Array.isArray(tomb.members) && tomb.members.includes(me) ? deletedFor(tomb) : notFound();
  }
  if (!role) return notFound(); // a workspace you are not in looks exactly like one that does not exist
  const K = keys(id, meta.app);
  if (meta.deleting) {
    if (method === 'DELETE' && role === 'owner') return remove(request, env, K, metaKey, metaObj, meta, me);
    // an owner whose deletion stopped half way (tab closed) is told so: their device finishes it (DELETE again)
    return deletedFor(meta.deleting, role === 'owner' ? { unfinished: true, name: meta.name } : null);
  }
  const canWrite = role === 'owner' || role === 'editor';
  const mine = meta.members.find((x) => x.email === me);
  if (!mine.joinedAt) { // the first time this member's sign-in reaches this workspace
    const joined = await markJoined(env, K, metaKey, metaObj, meta, me);
    if (joined) { metaObj = joined.obj; meta = joined.meta; }
  }

  if (!sub) {
    if (method === 'GET') {
      const [head, snap] = await Promise.all([env.SYNC.head(K.log), env.SYNC.head(K.snap)]);
      const h = logMeta(head);
      return json({ ...publicMeta(meta, role, { head: h.head, snap: snap ? { seq: +snap.customMetadata.seq || 0, at: snap.customMetadata.at || null, size: snap.size } : null }), siteOwner: me === normEmail(env.OWNER_EMAIL) });
    }
    if (method === 'DELETE') {
      if (role !== 'owner') return notFound(); // editors and viewers: the same answer as for a workspace that does not exist
      return remove(request, env, K, metaKey, metaObj, meta, me);
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
  if (sub === 'invite') {
    if (method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
    if (role !== 'owner') return json({ error: 'Only an owner of this workspace can invite people.' }, 403);
    return invited(request, env, K, metaKey, metaObj, meta, me);
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
    if (role && !meta.deleting) out.push({ id, name: meta.name, app: meta.app, role, members: meta.members.length, ready: !!meta.ready });
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
  const meta = { v: 1, id, name, app, createdAt: at, createdBy: me, ready: false, members: [{ email: me, role: 'owner', addedBy: me, addedAt: at, joinedAt: at }] };
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

// ── joining and invitations ───────────────────────────────────────────────────────────────────────────────────────
const JSON_TYPE = { contentType: 'application/json' };
/** the member's first request to this workspace: joinedAt, once (a lost race just tries again on the next request) */
async function markJoined(env, K, metaKey, metaObj, meta, me) {
  const at = new Date().toISOString();
  const next = { ...meta, members: meta.members.map((x) => (x.email === me ? { ...x, joinedAt: at } : x)) };
  const put = await env.SYNC.put(metaKey, JSON.stringify(next), { onlyIf: { etagMatches: metaObj.etag }, httpMetadata: JSON_TYPE });
  if (put === null) return null;
  try { await append(env, K, [{ type: 'ws.join', p: { email: me } }], me); } catch { /* no log: joinedAt alone is enough */ }
  return { obj: put, meta: next };
}
/** an owner sent (downloaded, opened or copied) an invitation for a member: invitedAt, invitedBy */
async function invited(request, env, K, metaKey, metaObj, meta, me) {
  const body = await smallJson(request, 4096);
  const email = normEmail(body && body.email);
  if (!validEmail(email)) return json({ error: 'Enter a valid e-mail address.' }, 400);
  let cur = meta, curObj = metaObj;
  for (let i = 0; i < 5; i++) {
    const at = cur.members.findIndex((x) => x.email === email);
    if (at < 0) return json({ error: 'That person is not a member of this workspace.' }, 404);
    const now = new Date(), prev = cur.members[at].invitedAt;
    const quiet = !!prev && now - new Date(prev) < INVITE_QUIET_MS; // the .eml and then "Copy": one entry in the activity
    const list = cur.members.slice();
    list[at] = { ...list[at], invitedAt: now.toISOString(), invitedBy: me };
    const next = { ...cur, members: list };
    if (await env.SYNC.put(metaKey, JSON.stringify(next), { onlyIf: { etagMatches: curObj.etag }, httpMetadata: JSON_TYPE }) !== null) {
      if (!quiet) await append(env, K, [{ type: 'ws.invite', p: { email } }], me);
      return json(publicMeta(next, 'owner'));
    }
    const again = await readJson(env, metaKey);
    cur = again.val; curObj = again.obj;
    if (!cur || cur.deleting || roleOf(cur, me) !== 'owner') return json({ error: 'The workspace was changed at the same time. Reload and try again.' }, 409);
  }
  return json({ error: 'The workspace was changed at the same time. Try again.' }, 409);
}

// ── deleting a workspace (owner) ──────────────────────────────────────────────────────────────────────────────────
// Kept 30 days under ws-deleted/<id>-<time>/ (R2 lifecycle rule on ws-deleted/, see HANDOFF.md), then gone for good.
// Each request spends at most MOVE_BUDGET R2 calls; 202 { done: false } means "call again", and a retry after a
// failure simply carries on (copies are overwritten, deletes of missing keys are harmless).
async function remove(request, env, K, metaKey, metaObj, meta, me) {
  const body = await smallJson(request, 4096);
  if (cleanName(body && body.name) !== meta.name) return json({ error: 'Type the name of the workspace exactly to confirm.' }, 400);
  let budget = MOVE_BUDGET, moved = 0, d = meta.deleting;
  if (!d) { // 1. from now on every request answers 410 to members: nobody works on in a half-deleted workspace
    const at = new Date().toISOString();
    d = { at, by: me, to: 'ws-deleted/' + meta.id + '-' + at.replace(/[-:]/g, '').replace(/\.\d+/, '') + '/', unindexed: 0 };
    const next = { ...meta, deleting: d };
    const put = await env.SYNC.put(metaKey, JSON.stringify(next), { onlyIf: { etagMatches: metaObj.etag }, httpMetadata: JSON_TYPE });
    if (put === null) return json({ error: 'The workspace was changed at the same time. Try again.' }, 409);
    metaObj = put; meta = next; budget--;
  }
  // 2. the members' lists of workspaces (each about two R2 calls); progress is kept in meta.deleting.unindexed
  let k = d.unindexed || 0;
  const from = k;
  while (k < meta.members.length && budget > 4) { await indexUser(env, meta.members[k].email, meta.id, false); k++; budget -= 2; }
  if (k !== from) {
    const next = { ...meta, deleting: { ...d, unindexed: k } };
    const put = await env.SYNC.put(metaKey, JSON.stringify(next), { onlyIf: { etagMatches: metaObj.etag }, httpMetadata: JSON_TYPE });
    budget--;
    if (put !== null) { metaObj = put; meta = next; d = next.deleting; }
  }
  if (k < meta.members.length) return json({ done: false, moved }, 202);
  // 3. every object: copy to ws-deleted/<id>-<time>/, then delete the original (meta.json stays until the end)
  let cursor;
  for (;;) {
    if (budget < 5) return json({ done: false, moved }, 202);
    const page = await env.SYNC.list({ prefix: K.prefix, limit: 50, cursor }); budget--;
    const objs = page.objects.filter((o) => o.key !== metaKey);
    const take = objs.slice(0, Math.max(0, Math.floor((budget - 4) / 2)));
    const gone = [];
    for (const o of take) {
      const src = await env.SYNC.get(o.key); budget--;
      if (src) { await env.SYNC.put(d.to + o.key.slice(K.prefix.length), await src.arrayBuffer(), { httpMetadata: src.httpMetadata, customMetadata: src.customMetadata }); budget--; }
      gone.push(o.key);
    }
    if (gone.length) { await env.SYNC.delete(gone); budget--; moved += gone.length; }
    if (take.length < objs.length) return json({ done: false, moved }, 202);
    if (!page.truncated) break;
    cursor = page.cursor;
  }
  // 4. the tombstone (members get 410 from now on, for the 30 days), the members list with it, and meta.json last
  const tomb = { id: meta.id, name: meta.name, app: meta.app, deletedAt: d.at, deletedBy: d.by, to: d.to, members: meta.members.map((x) => x.email), done: true };
  await env.SYNC.put(K.tomb, JSON.stringify(tomb), { httpMetadata: JSON_TYPE });
  await env.SYNC.put(d.to + 'meta.json', JSON.stringify(meta), { httpMetadata: JSON_TYPE });
  await env.SYNC.delete(metaKey);
  return json({ done: true, moved, deletedAt: d.at, deletedBy: d.by });
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
