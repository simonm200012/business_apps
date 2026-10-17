// Clearfigure public site Worker (public/wrangler.jsonc). Static files come from public/dist (the build output); only
// /api/* reaches this code. The one route is POST /api/contact: the contact form's message, checked and stored as JSON
// in the private R2 bucket "clearfigure-leads" (binding LEADS). No Cloudflare Access, no cloud sync, no cookies.
//
//   leads/<YYYY-MM>/<time>-<id>.json   one message (see leadRecord), never parsed again by this Worker
//   ratelimit/<YYYY-MM-DD>/salt         a random key for that day's IP hashes
//   ratelimit/<YYYY-MM-DD>/<HH>/<hash>  how many messages one (hashed) IP sent in that hour (customMetadata.n)
//   ratelimit/<YYYY-MM-DD>/total        all messages that day (customMetadata.n), a cap against floods
// Days before yesterday are deleted on the next message (and by the bucket's lifecycle rule, public/README.md).
//
// Branded demos (public/demo.js): GET /d/<slug> (page), GET /api/demo/<slug>[/logo.png] (data), read from the same bucket under demos/.
//
// Optional secrets/vars: TURNSTILE_SECRET (then a Turnstile token is required), ALLOWED_ORIGINS (comma-separated extra
// origins allowed to post, e.g. a custom domain during a move; the Worker's own origin is always allowed).

import { handleDemoPage, handleDemoApi, notFoundPage } from './demo.js';

export const LIMITS = { bodyBytes: 16384, name: 100, company: 120, email: 254, phone: 40, message: 4000, minMessage: 10, minName: 2, minFillMs: 3000, perHour: 5, perDay: 200 };
export const PRODUCTS = ['datacheck', 'einvoice', 'collections', 'cashflow', 'budget', 'custom', 'other'];
export const LANGS = ['sl', 'hr', 'en'];
const EMAIL = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const PHONE = /^[0-9+()/.\- ]{6,40}$/;

const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const json = (status, obj, extra) => new Response(JSON.stringify(obj), { status, headers: { ...HEADERS, ...(extra || {}) } });

// one line of text: control characters and line breaks become spaces, runs of spaces collapse
function line(v) { return typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim() : ''; }
// a message: keeps line breaks (at most two in a row), drops other control characters
function text(v) { return typeof v === 'string' ? v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim() : ''; }

/** Checks the form's JSON. → { ok: true, lead } or { ok: false, fields: [...] }. Lengths count characters, not bytes. */
export function validateLead(body) {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const lead = {
    name: line(b.name), company: line(b.company), email: line(b.email).toLowerCase(), phone: line(b.phone),
    product: PRODUCTS.includes(b.product) ? b.product : 'other', message: text(b.message), lang: LANGS.includes(b.lang) ? b.lang : 'sl',
    page: typeof b.page === 'string' && /^\/[A-Za-z0-9/_-]{0,60}$/.test(b.page) ? b.page : ''
  };
  const fields = [];
  const len = (s) => [...s].length;
  if (len(lead.name) < LIMITS.minName || len(lead.name) > LIMITS.name) fields.push('name');
  if (len(lead.company) > LIMITS.company) fields.push('company');
  if (lead.email.length > LIMITS.email || !EMAIL.test(lead.email)) fields.push('email');
  if (lead.phone && !PHONE.test(lead.phone)) fields.push('phone');
  if (len(lead.message) < LIMITS.minMessage || len(lead.message) > LIMITS.message) fields.push('message');
  return fields.length ? { ok: false, fields } : { ok: true, lead };
}

/** What is stored for one message. No IP address, no user agent. */
export function leadRecord(lead, id, at) {
  return { v: 1, id, receivedAt: at, source: 'website', ...lead };
}

/** The same message as a lead for Client Atlas (site/client-atlas/leads.js: { id, company, contact, channel, status, next,
 *  notes, created, updated }), for the private site's import (public/README.md, "Leads into Client Atlas"). */
export function toAtlasLead(rec) {
  const contact = [rec.name, rec.email, rec.phone].filter(Boolean).join(' · ');
  const notes = ['[' + rec.product + ', ' + rec.lang + '] ' + rec.message].join('');
  return { id: 'w' + String(rec.id).slice(0, 38), company: rec.company || rec.name, contact, channel: 'website', status: 'new', next: '', notes: notes.slice(0, 4000), created: rec.receivedAt, updated: rec.receivedAt };
}

async function sha256hex(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
function randomHex(n) { const a = new Uint8Array(n); crypto.getRandomValues(a); return [...a].map((x) => x.toString(16).padStart(2, '0')).join(''); }
async function count(obj) { return obj ? Number((obj.customMetadata || {}).n) || 0 : 0; }

// The day's random salt: IP hashes from different days can't be linked, and nobody can reverse them once it is deleted.
async function daySalt(bucket, day) {
  const key = 'ratelimit/' + day + '/salt';
  const got = await bucket.get(key);
  if (got) return got.text();
  const salt = randomHex(16);
  await bucket.put(key, salt, { httpMetadata: { contentType: 'text/plain' } });
  return salt;
}

/** Older rate-limit days (before yesterday) are removed. Cheap: at most one listing and a few deletes per message. */
async function sweep(bucket, today) {
  const yesterday = new Date(Date.parse(today + 'T00:00:00Z') - 864e5).toISOString().slice(0, 10);
  const l = await bucket.list({ prefix: 'ratelimit/', limit: 200 });
  const old = (l.objects || []).map((o) => o.key).filter((k) => k.slice(10, 20) < yesterday);
  if (old.length) await bucket.delete(old);
}

/** POST /api/contact. `now` (ms) only for tests. */
export async function handleContact(request, env, now) {
  const t = now === undefined ? Date.now() : now;
  if (request.method !== 'POST') return json(405, { ok: false, error: 'method' }, { Allow: 'POST' });
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  const allowed = [url.origin].concat(String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean));
  if (origin && !allowed.includes(origin)) return json(403, { ok: false, error: 'origin' });
  if (!/^application\/json\b/i.test(request.headers.get('Content-Type') || '')) return json(415, { ok: false, error: 'type' });
  const declared = Number(request.headers.get('Content-Length') || 0);
  if (declared > LIMITS.bodyBytes) return json(413, { ok: false, error: 'size' });
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > LIMITS.bodyBytes) return json(413, { ok: false, error: 'size' });
  let body;
  try { body = JSON.parse(raw); } catch { return json(400, { ok: false, error: 'json' }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json(400, { ok: false, error: 'json' });

  // bots: a filled honeypot gets a normal-looking answer and nothing is stored
  if (typeof body.website === 'string' && body.website.trim()) return json(200, { ok: true });
  const elapsed = Number(body.elapsedMs);
  if (!Number.isFinite(elapsed) || elapsed < LIMITS.minFillMs) return json(400, { ok: false, error: 'too_fast' });

  const v = validateLead(body);
  if (!v.ok) return json(400, { ok: false, error: 'invalid', fields: v.fields });

  if (env.TURNSTILE_SECRET) {
    const token = typeof body.turnstileToken === 'string' ? body.turnstileToken.slice(0, 4096) : '';
    if (!token) return json(400, { ok: false, error: 'turnstile' });
    const f = new FormData();
    f.append('secret', env.TURNSTILE_SECRET); f.append('response', token);
    const ip0 = request.headers.get('CF-Connecting-IP'); if (ip0) f.append('remoteip', ip0);
    let okTs = false;
    try { const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: f }); okTs = !!(await r.json()).success; } catch { okTs = false; }
    if (!okTs) return json(400, { ok: false, error: 'turnstile' });
  }

  const bucket = env.LEADS;
  if (!bucket) return json(503, { ok: false, error: 'storage' });

  // rate limit: per hashed IP per hour, and a daily cap for everything
  const iso = new Date(t).toISOString(), day = iso.slice(0, 10), hour = iso.slice(11, 13);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  try {
    const salt = await daySalt(bucket, day);
    const ipKey = 'ratelimit/' + day + '/' + hour + '/' + (await sha256hex(salt + '|' + ip)).slice(0, 40);
    const totalKey = 'ratelimit/' + day + '/total';
    const [mine, total] = await Promise.all([bucket.head(ipKey).then(count), bucket.head(totalKey).then(count)]);
    if (mine >= LIMITS.perHour || total >= LIMITS.perDay) return json(429, { ok: false, error: 'rate' }, { 'Retry-After': '3600' });
    const id = iso.replace(/[-:.TZ]/g, '').slice(0, 14) + '-' + randomHex(4);
    const rec = leadRecord(v.lead, id, iso);
    await bucket.put('leads/' + day.slice(0, 7) + '/' + id + '.json', JSON.stringify(rec), { httpMetadata: { contentType: 'application/json' }, customMetadata: { product: rec.product, lang: rec.lang } });
    await Promise.all([
      bucket.put(ipKey, '', { customMetadata: { n: String(mine + 1) } }),
      bucket.put(totalKey, '', { customMetadata: { n: String(total + 1) } })
    ]);
    try { await sweep(bucket, day); } catch { /* the lifecycle rule cleans up too */ }
    return json(200, { ok: true, id });
  } catch {
    return json(503, { ok: false, error: 'storage' });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/contact') return handleContact(request, env);
    if (url.pathname.startsWith('/d/') || url.pathname === '/d') return url.pathname.startsWith('/d/') ? handleDemoPage(request, env, url) : notFoundPage(); // branded demos (public/demo.js)
    if (url.pathname.startsWith('/api/demo/')) return handleDemoApi(request, env, url);
    if (url.pathname.startsWith('/api/')) return json(404, { ok: false, error: 'not_found' });
    // everything else is a static file (run_worker_first only sends /api/* here)
    return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
  }
};
