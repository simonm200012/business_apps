// Business Apps Worker. The apps themselves are static files in site/ (served by Workers static assets); this Worker
// only answers /api/* (wrangler.jsonc: run_worker_first ["/api/*"]) and gives the apps a private cloud copy of their
// data, so the same data is on the phone and the computer:
//
//   GET  /api/auth/config              { enabled, provider: 'access' }   who signs in is decided by Cloudflare Access
//   GET  /api/auth/me                  { email, name }
//   POST /api/auth/logout              { redirect: '/cdn-cgi/access/logout' }
//   GET  /api/sync/:app?meta=1         { exists, generation, updatedAt }
//   GET  /api/sync/:app                the app's JSON snapshot as stored; X-Sync-Generation, X-Sync-Updated-At
//   PUT  /api/sync/:app?base=N         body = the snapshot; 409 { generation, updatedAt } if the cloud is not at N
//   GET  /api/sync/:app/versions       [{ generation, updatedAt, size }] earlier versions, newest first (at most 30)
//   GET  /api/sync/:app/versions/:gen  that earlier snapshot as stored; X-Sync-Generation, X-Sync-Updated-At
//   HEAD/GET/PUT /api/sync/:app/files/:sha256   binary files (invoice PDFs, photos)
//   GET  /api/vies/:country/:number    { valid, status, name, address } from the EU's VIES service (Data health check, opt-in)
//
// Version history: before a PUT replaces u/<hash>/<app>.json, the copy it replaces is copied (bytes and metadata, still
// unparsed) to u/<hash>/<app>/versions/<its generation>.json; the newest KEEP_VERSIONS are kept, older ones deleted.
//
// Client: site/_shared/stratum-sync.js (provider 'access'). Snapshots are stored and returned as raw bytes and never
// parsed here, so large app data does not cost Worker CPU time. Everything lives in the private R2 bucket SYNC under
// u/<hash of the e-mail>/. Every request must carry a valid Access token for OWNER_EMAIL, or for a view-only e-mail in
// VIEWER_EMAILS, who reads the owner's copies of the demo apps, never the private apps, and can never write
// (worker/access.js), and
// every change must carry the X-Stratum-Apps header the apps send (a custom header cannot be sent cross-site).
// DEV_BYPASS=1 (only ever in a local .dev.vars, never deployed) skips the Access check for wrangler dev.
//
// Team workspaces (/api/ws, /api/ws/*): worker/workspaces.js. Several people of one company share one Collections data
// set with roles (owner, editor, viewer) checked there; the personal copies above are not involved.
import { identity, isPrivatePath, isLocalHost } from './access.js';
import { workspaces } from './workspaces.js';

const APP = /^[a-z0-9][a-z0-9-]{0,39}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const GEN = /^[1-9][0-9]{0,14}$/;
const KEEP_VERSIONS = 30;
const MAX_SNAPSHOT = 60 * 1024 * 1024, MAX_FILE = 30 * 1024 * 1024;
const NO_STORE = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...NO_STORE } });
const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
const generation = (obj) => parseInt((obj && obj.customMetadata && obj.customMetadata.generation) || '0', 10) || 0;
const updatedAt = (obj) => (obj && obj.customMetadata && obj.customMetadata.updatedAt) || null;

async function userPrefix(email) {
  return 'u/' + hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('stratum-apps:' + email))).slice(0, 32) + '/';
}

/** The request body for R2: a fixed-length stream when the size is known, otherwise read into memory. */
async function bodyFor(request, max) {
  const len = Number(request.headers.get('Content-Length'));
  if (len > max) return { tooLarge: true };
  if (len > 0) return { body: request.body };
  const buf = await request.arrayBuffer();
  return buf.byteLength > max ? { tooLarge: true } : { body: buf };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try { return await api(request, env, url); }
    catch (e) { console.error('api error', e && e.stack || e); return json({ error: 'Something went wrong on the server. Try again.' }, 500); }
  }
};

async function api(request, env, url) {
  if (url.pathname === '/api/ws' || url.pathname.startsWith('/api/ws/')) return workspaces(request, env, url); // own access rules
  // DEV_BYPASS must never be set on a deployed Worker: on any host but localhost every request is refused, loudly.
  if (env.DEV_BYPASS && !isLocalHost(url.hostname)) { console.error('DEV_BYPASS is set on a non-local host: refusing every request'); return json({ error: 'This Worker is misconfigured (DEV_BYPASS on a deployed host).' }, 500); }
  let who;
  if (env.DEV_BYPASS === '1') who = { email: String(env.OWNER_EMAIL || 'owner@local.test').toLowerCase() };
  else {
    try { who = await identity(request, env); } catch { return json({ error: 'The sign-in check is temporarily unavailable. Try again in a moment.' }, 503); }
    if (who.error === 'setup') return json({ error: 'Cloudflare Access is not configured for this site.' }, 503);
    if (who.error === 'viewonly') return url.pathname === '/api/auth/logout' ? json({ ok: true, redirect: '/cdn-cgi/access/logout' }) : json({ error: 'You have view-only access: changes are not saved to the cloud.', viewer: true }, 403);
    if (who.error === 'private') return json({ error: 'View-only access does not include this app.', viewer: true }, 403);
    if (who.error) return json({ error: who.error === 'owner' ? 'Owner access required.' : 'Your sign-in has expired. Reload the page to sign in again.' }, who.error === 'owner' ? 403 : 401);
  }
  const method = request.method, path = url.pathname;
  if (who.viewer) { // checked in access.js already; repeated here so no later change can let a viewer write or read private data
    if (method !== 'GET' && method !== 'HEAD') return json({ error: 'You have view-only access: changes are not saved to the cloud.', viewer: true }, 403);
    if (isPrivatePath(path)) return json({ error: 'View-only access does not include this app.', viewer: true }, 403);
  }
  if (method !== 'GET' && method !== 'HEAD' && request.headers.get('X-Stratum-Apps') !== '1' && request.headers.get('X-Tokovi-Apps') !== '1' /* 16 Oct 2026 build; drop after 2026-12-31 */) return json({ error: 'Missing X-Stratum-Apps header.' }, 400);

  if (path === '/api/auth/config') return json({ enabled: true, provider: 'access', devLogin: false, signupDomains: [] });
  if (path === '/api/auth/me') return json(who.viewer ? { email: who.viewer, name: who.viewer.split('@')[0], viewer: true } : { email: who.email, name: env.OWNER_NAME || who.email.split('@')[0] });
  if (path === '/api/auth/logout') return json({ ok: true, redirect: '/cdn-cgi/access/logout' });
  if (path.startsWith('/api/auth/')) return json({ error: 'Sign-in is handled by Cloudflare Access on this site.' }, 400);
  if (path === '/api/private/session') return json({ allowed: ['showcase'] });

  if (path === '/api/leads') return who.viewer ? json({ error: 'View-only access does not include this app.', viewer: true }, 403) : leads(request, env, url);

  const vm = path.match(/^\/api\/vies\/([^/]+)\/([^/]+)\/?$/);
  if (vm) return vies(request, vm[1], vm[2]);

  const m = path.match(/^\/api\/sync\/([^/]+)(?:\/(files|versions)(?:\/([^/]+))?)?\/?$/);
  if (!m) return json({ error: 'Not found.' }, 404);
  if (!env.SYNC) return json({ error: 'Cloud storage is not configured for this site.' }, 503);
  const app = m[1], kind = m[2], id = m[3];
  if (!APP.test(app)) return json({ error: 'Bad address.' }, 400);
  const prefix = await userPrefix(who.email);
  if (kind === 'files') {
    if (id === undefined || !SHA256.test(id)) return json({ error: 'Bad address.' }, 400);
    return file(request, env, prefix + app + '/files/' + id);
  }
  if (kind === 'versions') {
    if (id !== undefined && !GEN.test(id)) return json({ error: 'Bad address.' }, 400);
    return version(request, env, prefix + app + '/versions/', id);
  }
  return snapshot(request, env, prefix + app + '.json', prefix + app + '/versions/', url);
}

const snapshotResponse = (obj) => new Response(obj.body, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Sync-Generation': String(generation(obj)),
  'X-Sync-Updated-At': updatedAt(obj) || '', ...NO_STORE } });

/** Copies the stored object (as it is, never parsed) with its generation and time to versions/<generation>.json. */
async function keepVersion(env, obj, vprefix) {
  let body = obj.body;
  if (typeof FixedLengthStream === 'function') { // R2 needs to know the length of a stream it stores
    const fixed = new FixedLengthStream(obj.size);
    obj.body.pipeTo(fixed.writable).catch(() => {}); // a failed copy fails the put below
    body = fixed.readable;
  }
  await env.SYNC.put(vprefix + generation(obj) + '.json', body, { httpMetadata: { contentType: 'application/json' },
    customMetadata: { generation: String(generation(obj)), updatedAt: updatedAt(obj) || '' } });
}

/** All kept versions as [{ generation, updatedAt, size, key }], newest first. */
async function listVersions(env, vprefix) {
  const out = [];
  let cursor;
  for (let i = 0; i < 20; i++) {
    const page = await env.SYNC.list({ prefix: vprefix, cursor, include: ['customMetadata'] });
    for (const o of page.objects) {
      const g = o.key.slice(vprefix.length).match(/^([1-9][0-9]*)\.json$/);
      if (g) out.push({ generation: Number(g[1]), updatedAt: (o.customMetadata && o.customMetadata.updatedAt) || null, size: o.size, key: o.key });
    }
    if (!page.truncated) break;
    cursor = page.cursor;
  }
  return out.sort((a, b) => b.generation - a.generation);
}

async function pruneVersions(env, vprefix) {
  const old = (await listVersions(env, vprefix)).slice(KEEP_VERSIONS).map((v) => v.key);
  for (let i = 0; i < old.length; i += 1000) await env.SYNC.delete(old.slice(i, i + 1000));
}

async function version(request, env, vprefix, gen) {
  if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);
  if (gen === undefined) return json((await listVersions(env, vprefix)).map(({ generation, updatedAt, size }) => ({ generation, updatedAt, size })));
  const obj = await env.SYNC.get(vprefix + gen + '.json');
  if (!obj) return json({ error: 'This version is no longer kept.' }, 404);
  return snapshotResponse(obj);
}

async function snapshot(request, env, key, vprefix, url) {
  const method = request.method;
  if (method === 'GET' && url.searchParams.get('meta') === '1') {
    const head = await env.SYNC.head(key);
    return json(head ? { exists: true, generation: generation(head), updatedAt: updatedAt(head), size: head.size } : { exists: false, generation: 0, updatedAt: null });
  }
  if (method === 'GET') {
    const obj = await env.SYNC.get(key);
    if (!obj) return json({ error: 'There is no cloud copy yet.' }, 404);
    return snapshotResponse(obj);
  }
  if (method === 'PUT') {
    const base = url.searchParams.get('base') || '0';
    const head = await env.SYNC.head(key);
    const current = generation(head);
    const conflict = (obj) => json({ exists: !!obj, generation: generation(obj), updatedAt: updatedAt(obj), error: 'The cloud copy was changed on another device.' }, 409);
    if (String(current) !== String(base)) return conflict(head);
    const got = await bodyFor(request, MAX_SNAPSHOT);
    if (got.tooLarge) return json({ error: 'This data is too large to sync.' }, 413);
    if (head) { // keep the copy about to be replaced in the history first; if that fails, nothing is replaced
      const prev = await env.SYNC.get(key, { onlyIf: { etagMatches: head.etag } });
      if (!prev || !prev.body) return conflict(await env.SYNC.head(key)); // changed since the check
      await keepVersion(env, prev, vprefix);
    }
    const next = current + 1, at = new Date().toISOString();
    const opts = { httpMetadata: { contentType: 'application/json' }, customMetadata: { generation: String(next), updatedAt: at } };
    if (head) opts.onlyIf = { etagMatches: head.etag };
    const put = await env.SYNC.put(key, got.body, opts);
    if (put === null) return conflict(await env.SYNC.head(key)); // changed between the check and the write
    if (head) { try { await pruneVersions(env, vprefix); } catch (e) { console.error('pruning versions failed', e && e.stack || e); } }
    return json({ generation: next, updatedAt: at });
  }
  return json({ error: 'Method not allowed.' }, 405);
}

async function file(request, env, key) {
  const method = request.method;
  if (method === 'HEAD') {
    const head = await env.SYNC.head(key);
    return new Response(null, { status: head ? 200 : 404, headers: NO_STORE });
  }
  if (method === 'GET') {
    const obj = await env.SYNC.get(key);
    if (!obj) return json({ error: 'This file is not in the cloud.' }, 404);
    // never rendered as a page from this origin: download-only, sandboxed
    return new Response(obj.body, { headers: {
      'Content-Type': (obj.httpMetadata && obj.httpMetadata.contentType) || 'application/octet-stream',
      'Content-Disposition': 'attachment', 'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' } });
  }
  if (method === 'PUT') {
    const got = await bodyFor(request, MAX_FILE);
    if (got.tooLarge) return json({ error: 'This file is too large to sync.' }, 413);
    const type = String(request.headers.get('Content-Type') || 'application/octet-stream').slice(0, 120);
    await env.SYNC.put(key, got.body, { httpMetadata: { contentType: type } });
    return json({ ok: true });
  }
  return json({ error: 'Method not allowed.' }, 405);
}

// ── VIES: is this EU VAT ID registered? (Data health check, only when the person asks for it) ──────────────────────────
// A thin proxy to the European Commission's official VIES REST API, because the browser cannot call it directly (no CORS).
// It sends only the country prefix and the number, keeps nothing and logs nothing (no VAT ID ever reaches a log line or R2).
// The answer: { country, number, valid, status: 'valid'|'invalid', name, address, requestDate } or, when VIES or the member
// state's register cannot be reached, { status: 'unavailable', reason } (TIMEOUT, BAD_ANSWER, HTTP_5xx or the VIES userError,
// e.g. MS_UNAVAILABLE, MS_MAX_CONCURRENT_REQ). Both are 200: the proxy worked, and the page lists the unanswered ones itself.
const VIES_URL = 'https://ec.europa.eu/taxation_customs/vies/rest-api/ms/';
const VIES_CC = new Set('AT BE BG CY CZ DE DK EE EL ES FI FR HR HU IE IT LT LU LV MT NL PL PT RO SE SI SK XI'.split(' '));
const viesText = (s) => (typeof s === 'string' && s.trim() && s.trim() !== '---' ? s.replace(/\s+/g, ' ').trim().slice(0, 300) : '');
async function vies(request, rawCc, rawNum) {
  if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);
  let cc, num;
  try { cc = decodeURIComponent(rawCc).trim().toUpperCase(); num = decodeURIComponent(rawNum).toUpperCase().replace(/[\s.\-\/]/g, ''); } catch { return json({ error: 'Bad address.' }, 400); }
  if (cc === 'GR') cc = 'EL';
  if (num.startsWith(cc)) num = num.slice(cc.length);
  if (!VIES_CC.has(cc) || !/^[0-9A-Z+*]{2,14}$/.test(num)) return json({ error: 'Not a VAT ID that VIES can check.' }, 400);
  let res, body;
  try {
    res = await fetch(VIES_URL + cc + '/vat/' + encodeURIComponent(num), { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    body = res.ok ? await res.json() : null;
  } catch (e) {
    const late = !!e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    return json({ status: 'unavailable', reason: late ? 'TIMEOUT' : 'BAD_ANSWER', error: late ? 'VIES did not answer in time.' : 'VIES could not be reached.' });
  }
  if (!body || typeof body !== 'object') return json({ status: 'unavailable', reason: 'HTTP_' + (res && res.status), error: 'VIES answered with an error.' });
  const ue = String(body.userError || '').toUpperCase().replace(/[^A-Z_]/g, '').slice(0, 40);
  if (typeof body.isValid !== 'boolean' || (ue && ue !== 'VALID' && ue !== 'INVALID')) {
    return json({ status: 'unavailable', reason: ue || 'UNKNOWN', error: 'The VAT register of this country cannot be reached now. Try again later.' });
  }
  return json({ country: cc, number: num, valid: body.isValid, status: body.isValid ? 'valid' : 'invalid', name: viesText(body.name), address: viesText(body.address),
    requestDate: typeof body.requestDate === 'string' ? body.requestDate.slice(0, 30) : null });
}

// ── Website messages (the public site's contact form, public/worker.js) ──────────────────────────────────────────────
// GET /api/leads?after=<key>: up to 50 messages stored after <key> (keys sort by time: leads/<YYYY-MM>/<YYYYMMDDHHMMSS>-<id>.json),
// oldest first, so Client Atlas fetches only what it hasn't imported. Owner only (viewers are refused above and in access.js).
const LEAD_KEY = /^leads\/\d{4}-\d{2}\/[A-Za-z0-9_.-]{1,100}\.json$/;
async function leads(request, env, url) {
  if (request.method !== 'GET') return json({ error: 'Not found.' }, 404);
  if (!env.LEADS) return json({ error: 'The website messages are not connected to this site.' }, 503);
  const after = url.searchParams.get('after') || '';
  if (after && !LEAD_KEY.test(after)) return json({ error: 'Bad address.' }, 400);
  const page = await env.LEADS.list({ prefix: 'leads/', limit: 50, ...(after ? { startAfter: after } : {}) });
  const out = [];
  for (const o of page.objects || []) {
    if (!LEAD_KEY.test(o.key)) continue;
    const got = await env.LEADS.get(o.key);
    if (!got) continue;
    try { const rec = JSON.parse(await got.text()); if (rec && typeof rec === 'object') out.push({ ...rec, key: o.key }); } catch { /* a broken file is skipped */ }
  }
  const objs = page.objects || [];
  return json({ leads: out, last: objs.length ? objs[objs.length - 1].key : after, truncated: !!page.truncated });
}
