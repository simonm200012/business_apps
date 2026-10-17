// Shared test harness for the client-portal tests: an in-memory R2 that records every key a request touches, real Access
// tokens signed with a test key (RS256, as Cloudflare Access signs them) and a fake Access certs endpoint.
// Not a test itself (no .test.js), so the test loop skips it.
'use strict';
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '../..');
const imp = (rel, q = '') => import(pathToFileURL(path.join(ROOT, rel)).href + q);

function makeR2() {
  const store = new Map(); let n = 0;
  const meta = (key, o) => ({ key, size: o.bytes.byteLength, etag: o.etag, httpEtag: '"' + o.etag + '"', uploaded: o.uploaded, customMetadata: { ...o.customMetadata }, httpMetadata: { ...o.httpMetadata } });
  const r2 = {
    store, touched: [], ops: [], listLimit: 1000, putDelay: 0,
    touch(op, key) { r2.touched.push(key); r2.ops.push([op, key]); },
    reset() { r2.touched = []; r2.ops = []; },
    async head(key) { r2.touch('head', key); const o = store.get(key); return o ? meta(key, o) : null; },
    async get(key, opts = {}) {
      r2.touch('get', key);
      const o = store.get(key); if (!o) return null;
      const m = meta(key, o);
      if (opts.onlyIf && opts.onlyIf.etagMatches && opts.onlyIf.etagMatches !== o.etag) return m;
      const bytes = o.bytes;
      return { ...m, body: new Blob([bytes]).stream(), arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), text: async () => Buffer.from(bytes).toString('utf8'), json: async () => JSON.parse(Buffer.from(bytes).toString('utf8')) };
    },
    async put(key, body, opts = {}) {
      r2.touch('put', key);
      const bytes = new Uint8Array(await new Response(body).arrayBuffer());
      if (r2.putDelay) await new Promise((r) => setTimeout(r, r2.putDelay));
      const cur = store.get(key), c = opts.onlyIf || {};
      if (c.etagMatches && (!cur || cur.etag !== c.etagMatches)) return null;
      if (c.etagDoesNotMatch && cur && (c.etagDoesNotMatch === '*' || cur.etag === c.etagDoesNotMatch)) return null;
      const o = { bytes, etag: 'e' + (++n), uploaded: new Date(), customMetadata: { ...(opts.customMetadata || {}) }, httpMetadata: { ...(opts.httpMetadata || {}) } };
      store.set(key, o);
      return meta(key, o);
    },
    async delete(keys) { for (const k of [].concat(keys)) { r2.touch('delete', k); store.delete(k); } },
    async list(opts = {}) {
      const prefix = opts.prefix || '';
      r2.touch('list', prefix);
      const limit = Math.min(opts.limit || 1000, r2.listLimit);
      let keys = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
      if (opts.startAfter) keys = keys.filter((k) => k > opts.startAfter);
      const start = opts.cursor ? Number(opts.cursor) : 0;
      const page = keys.slice(start, start + limit);
      const inc = (opts.include || []).includes('customMetadata');
      const objects = page.map((k) => { const m = meta(k, store.get(k)); if (!inc) delete m.customMetadata; return m; });
      const truncated = start + limit < keys.length;
      return { objects, truncated, cursor: truncated ? String(start + limit) : undefined, delimitedPrefixes: [] };
    },
    put_json(key, v) { return r2.put(key, JSON.stringify(v), { httpMetadata: { contentType: 'application/json' } }); },
    json(key) { const o = store.get(key); return o ? JSON.parse(Buffer.from(o.bytes).toString('utf8')) : null; },
    keys(prefix = '') { return [...store.keys()].filter((k) => k.startsWith(prefix)).sort(); }
  };
  return r2;
}

const TEAM = 'team.example', STAFF_AUD = 'staff-aud-test', PORTAL_AUD = 'portal-aud-test';
const OWNER = 'owner@example.com';
const b64u = (buf) => Buffer.from(buf).toString('base64url');

async function setupKeys() {
  const keyPair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const other = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = { ...(await crypto.subtle.exportKey('jwk', keyPair.publicKey)), kid: 'k1' };
  const harness = { certsOk: true, certFetches: 0, keyPair, otherKey: other };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, i) => {
    if (String(u) === 'https://' + TEAM + '/cdn-cgi/access/certs') {
      harness.certFetches++;
      if (!harness.certsOk) return new Response('nope', { status: 500 });
      return new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'Content-Type': 'application/json' } });
    }
    return realFetch(u, i);
  };
  // token(email, { aud, exp, nbf, iss, kid, alg, key, noEmail, payload }) → compact JWS
  harness.token = async (email, o = {}) => {
    const now = Math.floor(Date.now() / 1000);
    const h = b64u(JSON.stringify({ alg: o.alg || 'RS256', kid: o.kid === undefined ? 'k1' : o.kid, typ: 'JWT' }));
    const payload = { aud: o.aud || [STAFF_AUD], iss: o.iss || 'https://' + TEAM, exp: now + (o.expIn === undefined ? 3600 : o.expIn), iat: now, ...(o.nbf ? { nbf: o.nbf } : {}), ...(o.noEmail ? {} : { email }), ...(o.payload || {}) };
    const p = b64u(JSON.stringify(payload));
    if (o.alg === 'none') return h + '.' + p + '.';
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', (o.key || keyPair).privateKey || keyPair.privateKey, new TextEncoder().encode(h + '.' + p));
    return h + '.' + p + '.' + b64u(sig);
  };
  harness.staffToken = (email, o = {}) => harness.token(email, { aud: [STAFF_AUD], ...o });
  harness.portalToken = (email, o = {}) => harness.token(email, { aud: [PORTAL_AUD], ...o });
  return harness;
}

module.exports = { ROOT, imp, makeR2, setupKeys, TEAM, STAFF_AUD, PORTAL_AUD, OWNER, b64u };
