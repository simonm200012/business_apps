// Cloud sync, end to end: the real browser client (site/_shared/stratum-sync.js, run in a vm with a small DOM) against
// the real Worker (worker/index.js + worker/access.js, real Access tokens signed with a test key) over an in-memory R2.
// Run: node tools/tests/sync.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { pathToFileURL } = require('url');
const { resolveObjectURL } = require('buffer');

const ROOT = path.join(__dirname, '../..');
const CLIENT = fs.readFileSync(path.join(ROOT, 'site/_shared/stratum-sync.js'), 'utf8');
// values from the vm window come from another realm: compare them as plain JSON
const eq = (a, b, m) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TIME = 50; // the client's timers run this many times faster (2.5 s debounce → 50 ms)

// ── in-memory R2 (head/get/put/delete/list as the Workers binding behaves) ──────────────────────────────────────────
function makeR2() {
  const store = new Map(); let n = 0;
  const meta = (key, o) => ({ key, size: o.bytes.byteLength, etag: o.etag, httpEtag: '"' + o.etag + '"', uploaded: o.uploaded, customMetadata: { ...o.customMetadata }, httpMetadata: { ...o.httpMetadata } });
  const r2 = {
    store, listLimit: 1000, ops: [],
    async head(key) { const o = store.get(key); return o ? meta(key, o) : null; },
    async get(key, opts = {}) {
      const o = store.get(key); if (!o) return null;
      const m = meta(key, o);
      if (opts.onlyIf && opts.onlyIf.etagMatches && opts.onlyIf.etagMatches !== o.etag) return m; // no body
      const bytes = o.bytes;
      return { ...m, body: new Blob([bytes]).stream(), arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), text: async () => Buffer.from(bytes).toString('utf8') };
    },
    async put(key, body, opts = {}) {
      const bytes = new Uint8Array(await new Response(body).arrayBuffer());
      const cur = store.get(key);
      if (opts.onlyIf && opts.onlyIf.etagMatches && (!cur || cur.etag !== opts.onlyIf.etagMatches)) return null;
      const o = { bytes, etag: 'e' + (++n), uploaded: new Date(), customMetadata: { ...(opts.customMetadata || {}) }, httpMetadata: { ...(opts.httpMetadata || {}) } };
      store.set(key, o); r2.ops.push(['put', key]);
      return meta(key, o);
    },
    async delete(keys) { for (const k of [].concat(keys)) { store.delete(k); r2.ops.push(['delete', k]); } },
    async list(opts = {}) {
      const prefix = opts.prefix || '', limit = Math.min(opts.limit || 1000, r2.listLimit);
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = opts.cursor ? Number(opts.cursor) : 0;
      const page = keys.slice(start, start + limit);
      const inc = (opts.include || []).includes('customMetadata');
      const objects = page.map((k) => { const m = meta(k, store.get(k)); if (!inc) delete m.customMetadata; return m; });
      const truncated = start + limit < keys.length;
      return { objects, truncated, cursor: truncated ? String(start + limit) : undefined, delimitedPrefixes: [] };
    }
  };
  return r2;
}

// ── a small DOM: enough HTML parsing, selectors and click events for the sync dialogs and panel ───────────────────
const VOID = new Set(['input', 'br', 'img', 'hr', 'meta', 'link']);
const decode = (s) => s.replace(/&(amp|lt|gt|quot|#39);/g, (m, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[e]);
class Text { constructor(t) { this.nodeType = 3; this.data = t; this.parentNode = null; } get textContent() { return this.data; } }
class Element {
  constructor(tag, doc) { this.nodeType = 1; this.tagName = tag.toUpperCase(); this.attrs = new Map(); this.children = []; this.parentNode = null; this.doc = doc; this.listeners = {}; this.style = {}; this.onclick = null; }
  getAttribute(n) { return this.attrs.has(n) ? this.attrs.get(n) : null; }
  setAttribute(n, v) { this.attrs.set(n, String(v)); }
  hasAttribute(n) { return this.attrs.has(n); }
  removeAttribute(n) { this.attrs.delete(n); }
  get className() { return this.getAttribute('class') || ''; } set className(v) { this.setAttribute('class', v); }
  get id() { return this.getAttribute('id') || ''; }
  get disabled() { return this.hasAttribute('disabled'); } set disabled(v) { if (v) this.setAttribute('disabled', ''); else this.removeAttribute('disabled'); }
  get hidden() { return this.hasAttribute('hidden'); } set hidden(v) { if (v) this.setAttribute('hidden', ''); else this.removeAttribute('hidden'); }
  get textContent() { return this.children.map((c) => c.textContent).join(''); }
  set textContent(t) { this.children = []; this.appendChild(new Text(String(t))); }
  set innerHTML(html) { this.children.forEach((c) => { c.parentNode = null; }); this.children = []; parseInto(this, String(html), this.doc); }
  get innerHTML() { return this.children.map(serialize).join(''); }
  appendChild(c) { if (c.parentNode) c.parentNode.children.splice(c.parentNode.children.indexOf(c), 1); c.parentNode = this; this.children.push(c); return c; }
  remove() { if (this.parentNode) { this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null; } }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter((x) => x !== f); }
  focus() { this.doc.activeElement = this; }
  get elements() { const out = []; const walk = (e) => e.children.forEach((c) => { if (c.nodeType === 1) { out.push(c); walk(c); } }); walk(this); return out; }
  querySelectorAll(sel) { return this.elements.filter((e) => matches(e, sel)); }
  querySelector(sel) { return this.elements.find((e) => matches(e, sel)) || null; }
  matches(sel) { return matches(this, sel); }
  closest(sel) { for (let e = this; e && e.nodeType === 1; e = e.parentNode) if (matches(e, sel)) return e; return null; }
  click() {
    for (let e = this; e && e.nodeType === 1; e = e.parentNode) if (e.tagName === 'BUTTON' && e.disabled) return; // as browsers do
    if (this.tagName === 'A' && this.download) this.doc.downloads.push({ name: this.download, href: this.href });
    const ev = { type: 'click', target: this, stopped: false, stopPropagation() { this.stopped = true; }, preventDefault() {} };
    for (let e = this; e && !ev.stopped; e = e.parentNode) {
      (e.listeners.click || []).slice().forEach((f) => f.call(e, ev));
      if (typeof e.onclick === 'function') e.onclick(ev);
    }
  }
}
function serialize(n) {
  if (n.nodeType === 3) return n.data;
  const a = [...n.attrs].map(([k, v]) => ' ' + k + '="' + v + '"').join('');
  const t = n.tagName.toLowerCase();
  return '<' + t + a + '>' + (VOID.has(t) ? '' : n.children.map(serialize).join('') + '</' + t + '>');
}
function parseInto(root, html, doc) {
  const stack = [root]; let i = 0;
  const top = () => stack[stack.length - 1];
  while (i < html.length) {
    if (html.startsWith('<!--', i)) { const j = html.indexOf('-->', i); i = j < 0 ? html.length : j + 3; continue; }
    if (html[i] === '<' && html[i + 1] === '/') {
      const j = html.indexOf('>', i); const tag = html.slice(i + 2, j).trim().toUpperCase();
      for (let k = stack.length - 1; k > 0; k--) if (stack[k].tagName === tag) { stack.length = k; break; }
      i = j + 1; continue;
    }
    if (html[i] === '<' && /[a-zA-Z]/.test(html[i + 1] || '')) {
      const m = /^<([a-zA-Z][\w-]*)/.exec(html.slice(i)); const el = new Element(m[1].toLowerCase(), doc);
      i += m[0].length;
      const re = /\s*(?:([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?|(\/))/y;
      for (;;) {
        if (html[i] === '>') { i++; break; }
        re.lastIndex = i; const a = re.exec(html);
        if (!a || a.index !== i || re.lastIndex === i) { const j = html.indexOf('>', i); i = j + 1; break; }
        i = re.lastIndex;
        if (a[1]) el.setAttribute(a[1].toLowerCase(), decode(a[2] ?? a[3] ?? a[4] ?? ''));
        while (html[i] === ' ' || html[i] === '\n') i++;
      }
      top().appendChild(el);
      if (!VOID.has(el.tagName.toLowerCase())) stack.push(el);
      continue;
    }
    const j = html.indexOf('<', i + 1); const t = html.slice(i, j < 0 ? html.length : j);
    top().appendChild(new Text(decode(t))); i = j < 0 ? html.length : j;
  }
}
function matchCompound(e, c) {
  const m = /^([a-zA-Z][\w-]*|\*)?((?:[#.][\w-]+|\[[^\]]+\])*)$/.exec(c);
  if (!m) throw new Error('selector not supported here: ' + c);
  if (m[1] && m[1] !== '*' && e.tagName !== m[1].toUpperCase()) return false;
  const parts = m[2].match(/[#.][\w-]+|\[[^\]]+\]/g) || [];
  return parts.every((p) => {
    if (p[0] === '#') return e.id === p.slice(1);
    if (p[0] === '.') return e.className.split(/\s+/).includes(p.slice(1));
    const a = /^\[([\w-]+)(?:="?([^"\]]*)"?)?\]$/.exec(p);
    return a[2] === undefined ? e.hasAttribute(a[1]) : e.getAttribute(a[1]) === a[2];
  });
}
function matches(e, sel) {
  return sel.split(',').some((g) => {
    const cs = g.trim().split(/\s+/);
    if (!matchCompound(e, cs[cs.length - 1])) return false;
    let k = cs.length - 2;
    for (let p = e.parentNode; k >= 0 && p && p.nodeType === 1; p = p.parentNode) if (matchCompound(p, cs[k])) k--;
    return k < 0;
  });
}
function makeDocument() {
  const doc = { listeners: {}, visibilityState: 'visible', downloads: [], activeElement: null };
  doc.documentElement = new Element('html', doc);
  doc.head = doc.documentElement.appendChild(new Element('head', doc));
  doc.body = doc.documentElement.appendChild(new Element('body', doc));
  doc.createElement = (t) => new Element(t, doc);
  doc.addEventListener = (t, f) => { (doc.listeners[t] = doc.listeners[t] || []).push(f); };
  doc.removeEventListener = (t, f) => { doc.listeners[t] = (doc.listeners[t] || []).filter((x) => x !== f); };
  doc.querySelector = (s) => doc.documentElement.querySelector(s);
  doc.querySelectorAll = (s) => doc.documentElement.querySelectorAll(s);
  doc.fire = (t) => (doc.listeners[t] || []).slice().forEach((f) => f({ type: t }));
  return doc;
}

// ── Access tokens (RS256, as Cloudflare Access signs them) ─────────────────────────────────────────────────────────
const TEAM = 'team.example', AUD = 'aud-test', OWNER = 'owner@example.com', VIEWER = 'viewer@example.com';
const b64u = (buf) => Buffer.from(buf).toString('base64url');
let keyPair, jwk;
async function token(email, expIn = 3600) {
  const h = b64u(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' }));
  const p = b64u(JSON.stringify({ aud: [AUD], email, iss: 'https://' + TEAM, exp: Math.floor(Date.now() / 1000) + expIn, iat: Math.floor(Date.now() / 1000) }));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keyPair.privateKey, new TextEncoder().encode(h + '.' + p));
  return h + '.' + p + '.' + b64u(sig);
}

// ── the "server" and "devices" ──────────────────────────────────────────────────────────────────────────────────
let worker, env, r2;
const server = { putDelay: 0, gate: null }; // gate: snapshot uploads wait until it is opened
function gate() { let open; const promise = new Promise((r) => { open = r; }); return { promise, open }; }
function opaqueRedirect() { return { type: 'opaqueredirect', status: 0, ok: false, headers: new Headers(), json: async () => { throw new SyntaxError('opaque'); }, blob: async () => new Blob([]) }; }
async function call(tok, method, p, body) { // a request straight to the Worker (as the test, not a device)
  const headers = new Headers({ 'X-Stratum-Apps': '1' });
  if (tok) headers.set('Cf-Access-Jwt-Assertion', tok);
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  return worker.fetch(new Request('https://apps.example' + p, { method, headers, body }), env);
}
function device(name, tok) { return { name, token: tok, ls: new Map(), net: 'up', requests: [], inflight: 0, puts: 0, pages: [] }; }
async function deviceFetch(dev, page, url, init = {}) {
  if (page.dead) return new Promise(() => {}); // the page is gone
  const u = new URL(url, 'https://apps.example'); const method = (init.method || 'GET').toUpperCase();
  dev.requests.push(method + ' ' + u.pathname + u.search);
  if (dev.net === 'down') throw new TypeError('Failed to fetch');
  if (dev.net === 'nosync') return new Response('Not found', { status: 404 });
  if (dev.net === 'expired') { // Access answers with a redirect to its login page on another origin
    if (init.redirect === 'manual') return opaqueRedirect();
    throw new TypeError('Failed to fetch'); // what a followed cross-origin redirect looks like (CORS)
  }
  const headers = new Headers(init.headers || {});
  if (dev.token) headers.set('Cf-Access-Jwt-Assertion', dev.token);
  let body = method === 'GET' || method === 'HEAD' ? undefined : init.body;
  if (typeof body === 'string') headers.set('Content-Length', String(Buffer.byteLength(body)));
  else if (body && typeof body.size === 'number') headers.set('Content-Length', String(body.size));
  const isPut = method === 'PUT' && /^\/api\/sync\/[^/]+$/.test(u.pathname);
  if (isPut) { dev.inflight++; dev.puts++; if (server.gate) await server.gate.promise; else await sleep(server.putDelay); }
  try { return await worker.fetch(new Request(u, { method, headers, body, duplex: 'half' }), env); }
  finally { if (isPut) dev.inflight--; }
}
/** Opens an app page on a device: the real client script in a fresh window, and a tiny app keeping { items } in localStorage. */
function openPage(dev, app, extra = {}) {
  dev.pages.forEach((p) => { p.dead = true; });
  const doc = makeDocument(), wl = {};
  const page = { dead: false, doc, reloads: 0, accounts: [] };
  const later = (f) => function () { if (!page.dead) f(); };
  const ctx = {
    console, JSON, URL, Blob, crypto, Headers, Response,
    document: doc,
    location: { protocol: 'https:', href: 'https://apps.example/' + app + '/', reload() { page.reloads++; } },
    localStorage: { getItem: (k) => (dev.ls.has(k) ? dev.ls.get(k) : null), setItem: (k, v) => { dev.ls.set(k, String(v)); }, removeItem: (k) => { dev.ls.delete(k); } },
    fetch: (u, i) => deviceFetch(dev, page, u, i),
    setTimeout: (f, ms) => setTimeout(later(f), (ms || 0) / TIME), clearTimeout,
    setInterval: (f, ms) => { const t = setInterval(later(f), ms / TIME); t.unref(); return t; }, clearInterval,
    addEventListener: (t, f) => { (wl[t] = wl[t] || []).push(f); }, removeEventListener() {},
    StratumShell: { setAccount: (a) => { page.accounts.push(a); } }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(CLIENT, ctx, { filename: 'stratum-sync.js' });
  const KEY = 'state:' + app;
  let state = JSON.parse(dev.ls.get(KEY) || '{"items":[]}');
  const persist = () => dev.ls.set(KEY, JSON.stringify(state));
  page.app = {
    get items() { return state.items.slice(); },
    add(x) { state.items.push(x); persist(); page.sync.changed(); },
    remove(x) { state.items = state.items.filter((y) => y !== x); persist(); page.sync.changed(); }
  };
  page.applied = 0;
  page.sync = ctx.StratumSync.attach(Object.assign({
    app, label: 'Test ' + app,
    getSnapshot: async () => JSON.parse(JSON.stringify(state)),
    applySnapshot: async (d) => { if (!d || !Array.isArray(d.items)) throw new Error('not test data'); state = JSON.parse(JSON.stringify(d)); persist(); page.applied++; },
    isEmpty: async () => !state.items.length
  }, extra));
  page.fire = (t) => (wl[t] || []).slice().forEach((f) => f({ type: t }));
  page.dialogs = () => doc.body.children.filter((e) => e.nodeType === 1 && e.className === 'as-scrim');
  page.dialog = () => page.dialogs()[0] || null;
  page.buttons = (root) => (root || page.dialog()).querySelectorAll('button').map((b) => ({ el: b, text: b.textContent.trim(), v: b.getAttribute('data-v'), disabled: b.disabled }));
  page.button = (text, root) => { const b = page.buttons(root).find((x) => x.text.startsWith(text)); if (!b) throw new Error('no button "' + text + '" in ' + JSON.stringify(page.buttons(root).map((x) => x.text))); return b; };
  page.panel = () => { const el = doc.createElement('div'); doc.body.appendChild(el); page.sync.mountPanel(el); return el; };
  page.ctx = ctx;
  dev.pages.push(page);
  return page;
}
async function until(cond, what, ms = 4000) {
  const t0 = Date.now();
  for (;;) {
    let v; try { v = await cond(); } catch (e) { v = false; }
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('timed out waiting for: ' + what);
    await sleep(5);
  }
}
async function cloud(app) { const r = await call(await token(OWNER), 'GET', '/api/sync/' + app); return r.status === 200 ? { data: await r.json(), generation: Number(r.headers.get('X-Sync-Generation')) } : null; }
const meta = (dev, app) => JSON.parse(dev.ls.get('stratum-sync:' + app + ':' + OWNER) || '{}');
const status = (page) => page.sync.state.status;
async function synced(page, app, items) {
  await until(async () => status(page) === 'synced' && JSON.stringify((await cloud(app) || { data: {} }).data.items) === JSON.stringify(items), app + ' synced with ' + JSON.stringify(items));
}
// Billing-like loss check: items starting with INV are "issued" and must never disappear
const describeLoss = (from, to) => from.items.filter((x) => /^INV/.test(x) && !to.items.includes(x)).map((x) => 'Invoice ' + x);
const readDownload = async (d) => JSON.parse(await resolveObjectURL(d.href).text());

// ── tests ────────────────────────────────────────────────────────────────────────────────────────────────────────
let n = 0;
async function t(name, fn) { await fn(); n++; console.log('ok', n, name); }

(async function main() {
  worker = (await import(pathToFileURL(path.join(ROOT, 'worker/index.js')).href)).default;
  keyPair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  jwk = { ...(await crypto.subtle.exportKey('jwk', keyPair.publicKey)), kid: 'k1' };
  const realFetch = globalThis.fetch; // access.js fetches the team's public keys
  globalThis.fetch = async (u, i) => (String(u) === 'https://' + TEAM + '/cdn-cgi/access/certs' ? new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'Content-Type': 'application/json' } }) : realFetch(u, i));
  r2 = makeR2();
  env = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, OWNER_EMAIL: OWNER, OWNER_NAME: 'Owner', VIEWER_EMAILS: ' ' + VIEWER + ', ', SYNC: r2, ASSETS: null };
  const ownerTok = await token(OWNER), viewerTok = await token(VIEWER);

  await t('an empty device never uploads; ensureFresh is "fresh" (nothing on either side)', async () => {
    const d = device('empty', ownerTok), p = openPage(d, 'e1');
    await until(() => status(p) === 'idle', 'idle');
    eq(await p.sync.ensureFresh(), { status: 'fresh' });
    assert.ok(!d.requests.some((r) => r.startsWith('PUT')), 'no upload');
    assert.strictEqual(await cloud('e1'), null);
  });

  await t('a change made while an upload is on its way is not marked synced, and goes up next', async () => {
    const d = device('A', ownerTok), p = openPage(d, 'race');
    await until(() => status(p) === 'idle', 'idle');
    p.app.add('a');
    await synced(p, 'race', ['a']);
    const g1 = server.gate = gate(), puts = d.puts;
    p.app.add('b');
    await until(() => d.inflight > 0, 'upload of b on its way');
    p.app.add('c'); // while b's upload is in flight
    await sleep(150); // c's debounced sync asks while b's upload still runs
    const g2 = server.gate = gate();
    g1.open(); // b's upload finishes
    await until(() => d.puts === puts + 2 && d.inflight > 0, 'a second upload (for c) after b');
    eq((await cloud('race')).data.items, ['a', 'b']);
    assert.strictEqual(meta(d, 'race').dirty, true, 'c is still marked as not synced after b was uploaded');
    assert.notStrictEqual(status(p), 'synced');
    server.gate = null; g2.open();
    await synced(p, 'race', ['a', 'b', 'c']);
    assert.strictEqual(meta(d, 'race').dirty, false);
  });

  await t('a change made while the server could not be reached at load is uploaded when the connection is back', async () => {
    const d = device('B', ownerTok);
    let p = openPage(d, 'blip');
    await until(() => status(p) === 'idle', 'idle'); p.app.add('one'); await synced(p, 'blip', ['one']);
    d.net = 'down';
    p = openPage(d, 'blip'); // reload while offline
    await until(() => status(p) === 'offline', 'offline at load');
    p.app.add('two');
    assert.strictEqual(JSON.parse(d.ls.get('stratum-sync:blip:')).dirty, true, 'marked under the anonymous key');
    d.net = 'up';
    p.fire('online');
    await synced(p, 'blip', ['one', 'two']);
    assert.strictEqual(d.ls.get('stratum-sync:blip:'), undefined, 'the anonymous mark was carried over');
    assert.strictEqual(meta(d, 'blip').dirty, false);
    // and through a visibility change instead of the online event
    d.net = 'down'; p = openPage(d, 'blip');
    await until(() => status(p) === 'offline', 'offline at load (2)');
    p.app.add('three'); d.net = 'up'; p.doc.fire('visibilitychange');
    await synced(p, 'blip', ['one', 'two', 'three']);
  });

  await t('an expired sign-in (Access redirect or 401) shows "Sign in again", never marks anything synced', async () => {
    const d = device('C', ownerTok);
    let p = openPage(d, 'exp');
    await until(() => status(p) === 'idle', 'idle'); p.app.add('x'); await synced(p, 'exp', ['x']);
    // the session ends during use: the Access edge redirects to its login (fetch without redirect:'manual' would only say "Failed to fetch")
    d.net = 'expired';
    p.app.add('y');
    await until(() => status(p) === 'expired', 'expired state');
    assert.strictEqual(meta(d, 'exp').dirty, true);
    const panel = p.panel();
    assert.match(panel.textContent, /sign-in has expired/);
    p.button('Sign in again', panel).el.click();
    assert.strictEqual(p.reloads, 1, 'reloads the page through Access');
    const ef = await p.sync.ensureFresh();
    assert.strictEqual(ef.status, 'offline'); assert.match(ef.message, /sign-in has expired/);
    assert.ok(p.accounts.length && /Sign in again/.test(p.accounts[p.accounts.length - 1].label), 'account button says sign in again');
    // reloaded while still expired: the change is kept under the anonymous key
    p = openPage(d, 'exp');
    await until(() => status(p) === 'expired', 'expired at load');
    p.app.add('z');
    // signed in again (the reload went through Access)
    d.net = 'up';
    p = openPage(d, 'exp');
    await synced(p, 'exp', ['x', 'y', 'z']);
    // the Worker itself says 401 (token expired)
    d.token = await token(OWNER, -60);
    p.app.add('w');
    await until(() => status(p) === 'expired', 'expired via 401');
    assert.strictEqual(meta(d, 'exp').dirty, true);
    assert.strictEqual(JSON.stringify((await cloud('exp')).data.items), JSON.stringify(['x', 'y', 'z']));
    d.token = ownerTok; p = openPage(d, 'exp');
    await synced(p, 'exp', ['x', 'y', 'z', 'w']);
  });

  await t('the Worker keeps the 30 newest earlier versions and lists them newest first', async () => {
    r2.listLimit = 7; // exercise list paging
    let gen = 0;
    for (let i = 1; i <= 36; i++) {
      const r = await call(ownerTok, 'PUT', '/api/sync/hist?base=' + gen, JSON.stringify({ items: ['v' + i] }));
      assert.strictEqual(r.status, 200); gen = (await r.json()).generation;
    }
    assert.strictEqual(gen, 36);
    const stale = await call(ownerTok, 'PUT', '/api/sync/hist?base=3', JSON.stringify({ items: ['stale'] }));
    assert.strictEqual(stale.status, 409);
    const list = await (await call(ownerTok, 'GET', '/api/sync/hist/versions')).json();
    assert.strictEqual(list.length, 30);
    eq(list.map((v) => v.generation), Array.from({ length: 30 }, (_, i) => 35 - i));
    assert.ok(list.every((v) => v.updatedAt && v.size === JSON.stringify({ items: ['v' + v.generation] }).length), 'time and size of each');
    const keys = [...r2.store.keys()].filter((k) => k.includes('/hist/versions/'));
    assert.strictEqual(keys.length, 30, 'older versions deleted');
    const v20 = await call(ownerTok, 'GET', '/api/sync/hist/versions/20');
    assert.strictEqual(v20.status, 200);
    assert.strictEqual(v20.headers.get('X-Sync-Generation'), '20');
    assert.ok(v20.headers.get('X-Sync-Updated-At'));
    assert.match(v20.headers.get('Cache-Control'), /no-store/);
    eq(await v20.json(), { items: ['v20'] });
    assert.strictEqual((await call(ownerTok, 'GET', '/api/sync/hist/versions/2')).status, 404, 'pruned');
    assert.strictEqual((await call(ownerTok, 'GET', '/api/sync/hist/versions/abc')).status, 400);
    assert.strictEqual((await call(ownerTok, 'PUT', '/api/sync/hist/versions/20', '{}')).status, 405);
    assert.strictEqual((await call(null, 'GET', '/api/sync/hist/versions')).status, 401, 'same sign-in rule');
    assert.strictEqual((await call(await token('someone@else.com'), 'GET', '/api/sync/hist/versions')).status, 403);
    r2.listLimit = 1000;
  });

  await t('restore an earlier version from the panel: applied here and uploaded as the new current copy', async () => {
    const d = device('D', ownerTok), p = openPage(d, 'rest');
    await until(() => status(p) === 'idle', 'idle');
    p.app.add('first'); await synced(p, 'rest', ['first']);
    p.app.add('second'); await synced(p, 'rest', ['first', 'second']);
    p.app.remove('first'); await synced(p, 'rest', ['second']);
    const before = await cloud('rest');
    const panel = p.panel();
    p.button('Restore an earlier version', panel).el.click();
    await until(() => p.dialog() && p.dialog().querySelectorAll('.as-ver').length === 2, 'list of 2 versions');
    const vers = p.dialog().querySelectorAll('.as-ver');
    assert.match(vers[0].textContent, /version 2/); assert.match(vers[1].textContent, /version 1/);
    assert.match(vers[0].textContent, /\d+ B/);
    vers[0].click(); // version 2: ['first', 'second']
    await until(() => p.dialog() && /Restore the copy from/.test(p.dialog().textContent), 'confirm dialog');
    p.button('Restore this version').el.click();
    await synced(p, 'rest', ['first', 'second']);
    eq(p.app.items, ['first', 'second']);
    const after = await cloud('rest');
    assert.strictEqual(after.generation, before.generation + 1, 'uploaded over the current generation');
    const list = await (await call(ownerTok, 'GET', '/api/sync/rest/versions')).json();
    assert.strictEqual(list[0].generation, before.generation, 'the replaced copy is in the history');
  });

  await t('describeLoss: restoring a version that lacks an issued invoice is turned off; both copies can be downloaded', async () => {
    const d = device('E', ownerTok), p = openPage(d, 'rl', { describeLoss });
    await until(() => status(p) === 'idle', 'idle');
    p.app.add('draft'); await synced(p, 'rl', ['draft']);
    p.app.add('INV-1'); await synced(p, 'rl', ['draft', 'INV-1']);
    p.button('Restore an earlier version', p.panel()).el.click();
    await until(() => p.dialog() && p.dialog().querySelectorAll('.as-ver').length === 1, 'list');
    p.dialog().querySelector('.as-ver').click();
    await until(() => p.dialog() && /Restore the copy from/.test(p.dialog().textContent), 'confirm');
    const txt = p.dialog().textContent;
    assert.match(txt, /These would be lost/); assert.match(txt, /Invoice INV-1/);
    const rb = p.button('Restore this version');
    assert.strictEqual(rb.disabled, true);
    rb.el.click(); await sleep(20);
    assert.ok(p.dialog(), 'a turned-off choice does nothing');
    p.button('Download both copies').el.click();
    await until(() => p.doc.downloads.length === 2, 'two downloads');
    eq((await readDownload(p.doc.downloads[0])).items, ['draft', 'INV-1']);
    eq((await readDownload(p.doc.downloads[1])).items, ['draft']);
    p.button('Cancel').el.click();
    eq(p.app.items, ['draft', 'INV-1']);
    eq((await cloud('rl')).data.items, ['draft', 'INV-1']);
  });

  await t('describeLoss: first sync on a second device — the lossy choice is turned off, the other stays', async () => {
    const a = device('F1', ownerTok), pa = openPage(a, 'ch', { describeLoss });
    await until(() => status(pa) === 'idle', 'idle'); pa.app.add('INV-1'); await synced(pa, 'ch', ['INV-1']);
    const b = device('F2', ownerTok);
    b.ls.set('state:ch', JSON.stringify({ items: ['note'] }));
    const pb = openPage(b, 'ch', { describeLoss });
    await until(() => pb.dialog(), 'choose dialog');
    const fresh = await pb.sync.ensureFresh();
    eq(fresh, { status: 'conflict' }, 'ensureFresh answers while the dialog is open');
    assert.match(pb.dialog().textContent, /already in the cloud/);
    assert.match(pb.dialog().textContent, /Replace the cloud copy is turned off\. These would be lost:Invoice INV-1/);
    assert.strictEqual(pb.button('Replace the cloud copy').disabled, true);
    assert.strictEqual(pb.button('Use the cloud copy').disabled, false);
    assert.strictEqual(pb.button('Decide later').disabled, false);
    pb.button('Replace the cloud copy').el.click(); await sleep(20);
    assert.ok(pb.dialog(), 'still open');
    pb.button('Use the cloud copy').el.click();
    await until(() => status(pb) === 'synced', 'synced');
    eq(pb.app.items, ['INV-1']);
    eq((await cloud('ch')).data.items, ['INV-1']);
  });

  await t('describeLoss: changed in two places with an invoice on each side — both choices off, "Decide later" and downloads stay', async () => {
    const a = device('G1', ownerTok), pa = openPage(a, 'cf', { describeLoss });
    await until(() => status(pa) === 'idle', 'idle'); pa.app.add('base'); await synced(pa, 'cf', ['base']);
    const b = device('G2', ownerTok), pb = openPage(b, 'cf', { describeLoss });
    await until(() => status(pb) === 'synced', 'b took the cloud copy');
    b.net = 'down'; pb.app.add('INV-B'); await until(() => status(pb) === 'offline', 'b offline');
    pa.app.add('INV-A'); await synced(pa, 'cf', ['base', 'INV-A']);
    b.net = 'up';
    const res = pb.sync.ensureFresh();
    eq(await res, { status: 'conflict' });
    await until(() => pb.dialog(), 'conflict dialog');
    const txt = pb.dialog().textContent;
    assert.match(txt, /changed in two places/);
    assert.match(txt, /Use the cloud copy is turned off\. These would be lost:Invoice INV-B/);
    assert.match(txt, /Keep this browser’s is turned off\. These would be lost:Invoice INV-A/);
    assert.strictEqual(pb.button('Use the cloud copy').disabled, true);
    assert.strictEqual(pb.button('Keep this browser').disabled, true);
    pb.button('Download both copies').el.click();
    await until(() => pb.doc.downloads.length === 2, 'two downloads');
    eq((await readDownload(pb.doc.downloads[0])).items, ['base', 'INV-B']);
    eq((await readDownload(pb.doc.downloads[1])).items, ['base', 'INV-A']);
    pb.button('Decide later').el.click();
    await until(() => status(pb) === 'conflict', 'conflict kept');
    eq(pb.app.items, ['base', 'INV-B']);
    eq((await cloud('cf')).data.items, ['base', 'INV-A']);
  });

  await t('describeLoss: a newer cloud copy that lacks an invoice is not taken automatically', async () => {
    const a = device('H1', ownerTok), pa = openPage(a, 'al', { describeLoss });
    await until(() => status(pa) === 'idle', 'idle'); pa.app.add('INV-1'); pa.app.add('x'); await synced(pa, 'al', ['INV-1', 'x']);
    const b = device('H2', ownerTok), pb = openPage(b, 'al', { describeLoss });
    await until(() => status(pb) === 'synced', 'b synced');
    pa.app.remove('INV-1'); await synced(pa, 'al', ['x']);
    pb.sync.syncNow();
    await until(() => pb.dialog(), 'loss dialog');
    assert.match(pb.dialog().textContent, /missing something/);
    assert.strictEqual(pb.button('Use the cloud copy').disabled, true);
    assert.strictEqual(pb.button('Keep this browser').disabled, false);
    eq(pb.app.items, ['INV-1', 'x'], 'not replaced');
    pb.button('Keep this browser').el.click();
    await synced(pb, 'al', ['INV-1', 'x']);
  });

  await t('without describeLoss the dialogs work as before (no check, no downloads)', async () => {
    const a = device('I1', ownerTok), pa = openPage(a, 'nd');
    await until(() => status(pa) === 'idle', 'idle'); pa.app.add('INV-1'); await synced(pa, 'nd', ['INV-1']);
    const b = device('I2', ownerTok); b.ls.set('state:nd', JSON.stringify({ items: ['mine'] }));
    const pb = openPage(b, 'nd');
    await until(() => pb.dialog(), 'choose dialog');
    assert.ok(pb.buttons().every((x) => !x.disabled));
    assert.ok(!pb.buttons().some((x) => /Download/.test(x.text)));
    pb.button('Replace the cloud copy').el.click();
    await synced(pb, 'nd', ['mine']);
  });

  await t('ensureFresh: pushes pending changes, pulls a newer copy, waits for a running upload, offline/off', async () => {
    const a = device('J1', ownerTok), pa = openPage(a, 'ef');
    await until(() => status(pa) === 'idle', 'idle');
    pa.app.add('1');
    eq(await pa.sync.ensureFresh(), { status: 'fresh' });
    eq((await cloud('ef')).data.items, ['1'], 'pending change pushed');
    const b = device('J2', ownerTok), pb = openPage(b, 'ef');
    await until(() => status(pb) === 'synced', 'b synced');
    pa.app.add('2');
    eq(await pa.sync.ensureFresh(), { status: 'fresh' });
    eq(await pb.sync.ensureFresh(), { status: 'fresh' });
    eq(pb.app.items, ['1', '2'], 'newer cloud copy pulled');
    server.putDelay = 250;
    pa.app.add('3'); pa.sync.syncNow();
    await until(() => a.inflight > 0, 'upload on its way');
    pa.app.add('4');
    eq(await pa.sync.ensureFresh(), { status: 'fresh' });
    server.putDelay = 0;
    eq((await cloud('ef')).data.items, ['1', '2', '3', '4']);
    assert.strictEqual(meta(a, 'ef').dirty, false);
    a.net = 'down';
    const off = await pa.sync.ensureFresh();
    assert.strictEqual(off.status, 'offline'); assert.ok(off.message);
    a.net = 'nosync';
    const pn = openPage(a, 'ef');
    await until(() => status(pn) === 'off', 'off');
    eq(await pn.sync.ensureFresh(), { status: 'off' });
    a.net = 'down';
    const po = openPage(a, 'ef');
    await until(() => status(po) === 'offline', 'offline at load');
    const r = await po.sync.ensureFresh();
    assert.strictEqual(r.status, 'offline');
    a.net = 'up';
    eq(await po.sync.ensureFresh(), { status: 'fresh' }, 'checks the sign-in again first');
  });

  await t('viewers: the Worker refuses every change and the private apps', async () => {
    await call(ownerTok, 'PUT', '/api/sync/crm?base=0', JSON.stringify({ items: ['demo'] }));
    await call(ownerTok, 'PUT', '/api/sync/billing?base=0', JSON.stringify({ items: ['INV-1'] }));
    await call(ownerTok, 'PUT', '/api/sync/billing?base=1', JSON.stringify({ items: ['INV-1', 'INV-2'] }));
    const me = await (await call(viewerTok, 'GET', '/api/auth/me')).json();
    eq(me, { email: VIEWER, name: 'viewer', viewer: true });
    assert.strictEqual((await call(viewerTok, 'GET', '/api/sync/crm')).status, 200);
    eq(await (await call(viewerTok, 'GET', '/api/sync/crm')).json(), { items: ['demo'] }, 'the owner’s demo copy');
    assert.strictEqual((await call(viewerTok, 'GET', '/api/sync/crm/versions')).status, 200);
    assert.strictEqual((await call(viewerTok, 'PUT', '/api/sync/crm?base=1', JSON.stringify({ items: [] }))).status, 403);
    assert.strictEqual((await call(viewerTok, 'PUT', '/api/sync/newapp?base=0', '{}')).status, 403);
    assert.strictEqual((await call(viewerTok, 'PUT', '/api/sync/crm/files/' + 'a'.repeat(64), 'x')).status, 403);
    assert.strictEqual((await call(viewerTok, 'DELETE', '/api/sync/crm')).status, 403);
    for (const app of ['billing', 'invoices', 'desk', 'cashflow', 'client-atlas']) {
      for (const p of ['', '?meta=1', '/versions', '/versions/1', '/files/' + 'b'.repeat(64)]) {
        const r = await call(viewerTok, 'GET', '/api/sync/' + app + p);
        assert.strictEqual(r.status, 403, app + p);
        assert.strictEqual((await call(viewerTok, 'HEAD', '/api/sync/' + app + p)).status, 403, 'HEAD ' + app + p);
      }
    }
    assert.notStrictEqual((await call(viewerTok, 'GET', '/api/sync/%62illing')).status, 200, 'an encoded name is refused too');
    assert.notStrictEqual((await call(viewerTok, 'GET', '/api/sync/Billing')).status, 200);
    assert.strictEqual((await call(ownerTok, 'GET', '/api/sync/billing')).status, 200, 'the owner still reads it');
    eq((await cloud('crm')).data, { items: ['demo'] }, 'nothing changed');
    const noViewers = { ...env, VIEWER_EMAILS: '' };
    assert.strictEqual((await worker.fetch(new Request('https://apps.example/api/sync/crm', { headers: { 'Cf-Access-Jwt-Assertion': viewerTok } }), noViewers)).status, 403, 'an empty VIEWER_EMAILS lets nobody else in');
  });

  await t('viewers: the client shows "View only", takes the owner’s copy, never uploads or asks', async () => {
    const v = device('V', viewerTok), p = openPage(v, 'crm');
    await until(() => status(p) === 'view-only' && p.app.items.length, 'took the owner’s copy');
    eq(p.app.items, ['demo']);
    const panel = p.panel();
    assert.match(panel.textContent, /View only/);
    assert.ok(!p.buttons(panel).some((b) => /Restore/.test(b.text)), 'no restore for viewers');
    p.app.add('viewer-edit');
    await sleep(200);
    assert.strictEqual(status(p), 'view-only');
    await p.sync.syncNow();
    assert.strictEqual(await p.sync.ensureFresh().then((r) => r.status), 'off');
    assert.ok(!v.requests.some((r) => /^(PUT|POST)/.test(r)), 'never uploads: ' + v.requests.filter((r) => /^(PUT|POST)/.test(r)));
    assert.strictEqual(p.dialogs().length, 0, 'no dialogs');
    eq((await cloud('crm')).data, { items: ['demo'] });
    // a device that already has its own data: nothing replaced, nothing asked
    const v2 = device('V2', viewerTok); v2.ls.set('state:crm', JSON.stringify({ items: ['own'] }));
    const p2 = openPage(v2, 'crm');
    await until(() => status(p2) === 'view-only', 'view only');
    await sleep(50);
    eq(p2.app.items, ['own']); assert.strictEqual(p2.dialogs().length, 0);
    // a private app: refused by the Worker, shown as view only, local data untouched
    const v3 = device('V3', viewerTok); v3.ls.set('state:billing', JSON.stringify({ items: ['viewer-own'] }));
    const p3 = openPage(v3, 'billing', { describeLoss });
    await until(() => status(p3) === 'view-only', 'view only (billing)');
    assert.match(p3.sync.state.message, /not shared/);
    eq(p3.app.items, ['viewer-own']);
    assert.ok(!v3.requests.some((r) => /^(PUT|POST)/.test(r)));
  });

  await t('every app keeps working with the old attach() call (no new options)', async () => {
    const d = device('K', ownerTok), p = openPage(d, 'plain');
    assert.strictEqual(typeof p.sync.ensureFresh, 'function');
    await until(() => status(p) === 'idle', 'idle'); p.app.add('q'); await synced(p, 'plain', ['q']);
    assert.match(p.sync.describe(), /^synced/);
  });

  console.log('all ' + n + ' sync tests passed');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
