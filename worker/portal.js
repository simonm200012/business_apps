// Client portal Worker (business-apps-portal): what a company's clients see of their invoices, quotes, documents and news.
// Separate from the staff Worker on purpose: its own hostname (own origin, storage and CSP), its own Access app and audience,
// and NO SYNC binding, so even a bug here cannot reach Billing or any staff data. It only reads what staff published to the
// PORTAL bucket (worker/portal-staff.js) and writes quote decisions, audit objects and nothing else.
//
//   GET  /api/me                          { name, client }
//   GET  /api/view                        { client, brand, news, today, invoices, quotes (+ response), documents }
//   GET  /api/files/:fid                  a PDF or shared document, only if it is listed in the caller's own view
//   GET  /api/brand/logo                  the company logo (PNG, JPEG or WebP)
//   POST /api/quotes/:id/decision         { decision: accept|decline, quoteHash, comment } → a recorded request staff confirm in Billing
//   POST /api/logout                      { redirect: '/cdn-cgi/access/logout' }
//
// Who is calling comes only from the verified Access token (e-mail), then the mapping pu/<hash> → { t, c }. No client id in
// the URL, query, body or headers is ever read: a client cannot ask for another client's data, because there is no way to
// name it. Not yours and not existing both answer the same 404. No CORS headers are ever sent.
// Local development: DEV_BYPASS=1 (a git-ignored .dev.vars) replaces ONLY the token check, on localhost, with the e-mail from
// the cookie portal_dev_as; on any other host DEV_BYPASS makes every request fail with 500 so a mistaken deploy breaks loudly.
import { verifiedEmail, isLocalHost } from './access.js';
import { HEX32, QUOTE_ID, HEX64, fileIds, safeFilename, attachment, FILE_TYPES, LOGO_TYPES, emailOk, clean } from './portal-schema.js';
import { json, NO_STORE, userKey, emailHash, K, cPrefix, audit, nowDate, todayLj, randHex } from './portal-common.js';

const MAX_DECISION_BODY = 2048;
const denied = () => json({ error: 'Not found.' }, 404);
const noAccess = () => json({ error: 'This e-mail address has no access to the client portal. Ask your contact at the company to add it.' }, 403);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS ? env.ASSETS.fetch(request) : denied();
    try { return await api(request, env, url); }
    catch (e) { console.error('portal error', e && e.stack || e); return json({ error: 'Something went wrong. Try again.' }, 500); }
  }
};

async function whoIs(request, env, url) {
  if (env.DEV_BYPASS) { // never on a deployed host
    if (!isLocalHost(url.hostname)) { console.error('DEV_BYPASS is set on a non-local host: refusing every request'); return { response: json({ error: 'This Worker is misconfigured (DEV_BYPASS on a deployed host).' }, 500) }; }
    if (env.DEV_BYPASS === '1') {
      const m = String(request.headers.get('Cookie') || '').match(/(?:^|;\s*)portal_dev_as=([^;]+)/);
      let e = 'client-a@example.test';
      try { if (m) e = decodeURIComponent(m[1]).trim().toLowerCase(); } catch { /* default */ }
      return emailOk(e) ? { email: e, dev: true } : { response: json({ error: 'Bad portal_dev_as cookie.' }, 400) };
    }
  }
  if (!env.ACCESS_TEAM_DOMAIN || !env.PORTAL_ACCESS_AUD) return { response: json({ error: 'The client portal is not set up yet.' }, 503) };
  let v;
  try { v = await verifiedEmail(request, env, { aud: env.PORTAL_ACCESS_AUD, otherAud: env.ACCESS_AUD }); }
  catch { return { response: json({ error: 'The sign-in check is temporarily unavailable. Try again in a moment.' }, 503) }; }
  if (v.error === 'setup') return { response: json({ error: 'The client portal is not set up yet.' }, 503) };
  if (v.error) return { response: json({ error: 'Your sign-in has expired. Reload the page to sign in again.' }, 401) };
  return { email: v.email };
}

const ROUTES = [
  { re: /^\/api\/me$/, method: 'GET', name: 'me', limit: 'RL_READ' },
  { re: /^\/api\/view$/, method: 'GET', name: 'view', limit: 'RL_READ' },
  { re: /^\/api\/files\/([^/]+)$/, method: 'GET', name: 'file', limit: 'RL_DOWNLOAD' },
  { re: /^\/api\/brand\/logo$/, method: 'GET', name: 'logo', limit: 'RL_READ' },
  { re: /^\/api\/quotes\/([^/]+)\/decision$/, method: 'POST', name: 'decision', limit: 'RL_DECIDE' },
  { re: /^\/api\/logout$/, method: 'POST', name: 'logout', limit: null },
];

async function api(request, env, url) {
  const who = await whoIs(request, env, url);
  if (who.response) return who.response;
  const path = url.pathname; // exact: no trailing-slash or case tolerance
  let route, arg;
  for (const r of ROUTES) { const m = path.match(r.re); if (m) { route = r; arg = m[1]; break; } }
  if (!route) return denied();
  if (request.method !== route.method) return json({ error: 'Method not allowed.' }, 405, { Allow: route.method });
  if (route.name === 'logout') return json({ ok: true, redirect: '/cdn-cgi/access/logout' });
  if (!env.PORTAL) return json({ error: 'The client portal is not set up yet.' }, 503);

  const eh = await emailHash(who.email);
  const mapRaw = await env.PORTAL.get(await userKey(who.email));
  let map = null;
  if (mapRaw) { try { map = JSON.parse(await mapRaw.text()); } catch { map = null; } }
  if (!map || map.disabled === true || !HEX32.test(String(map.t)) || !HEX32.test(String(map.c))) {
    console.log('portal: no access', eh.slice(0, 8), map ? 'disabled-or-bad' : 'unmapped');
    if (map && HEX32.test(String(map.t))) await audit(env, map.t, { email: who.email, c: map.c, action: 'access', target: route.name, result: 'refused-disabled' }, request);
    return noAccess();
  }
  const { t, c } = map;
  const ctx = { env, request, url, who, eh, t, c, log: (action, target, result) => audit(env, t, { email: who.email, c, action, target, result }, request) };

  // rate limit (Workers Rate Limiting binding, keyed by e-mail hash). A missing binding fails closed for decisions on a
  // deployed host; reads and downloads still work without one (local development).
  const rl = route.limit && env[route.limit];
  if (rl && typeof rl.limit === 'function') {
    let ok = true;
    try { ok = (await rl.limit({ key: eh })).success !== false; } catch (e) { console.error('rate limit binding failed', e && e.message); ok = route.name !== 'decision'; }
    if (!ok) { await ctx.log('rate-limited', route.name, '429'); return json({ error: 'Too many requests. Wait a minute and try again.' }, 429, { 'Retry-After': '60' }); }
  } else if (route.name === 'decision' && !who.dev) return json({ error: 'Answering quotes is not available right now.' }, 503);

  switch (route.name) {
    case 'me': return me(ctx);
    case 'view': return view(ctx);
    case 'file': return download(ctx, arg);
    case 'logo': return logo(ctx);
    case 'decision': return decision(ctx, arg);
  }
  return denied();
}

async function readJsonKey(env, key) {
  const o = await env.PORTAL.get(key);
  if (!o) return null;
  try { return JSON.parse(await o.text()); } catch { return null; }
}
const effective = (v, today) => ({
  ...v,
  invoices: v.invoices.map((i) => ({ ...i, status: (i.status === 'issued' || i.status === 'partly_paid') && i.dueDate && i.dueDate < today ? 'overdue' : i.status })),
});

async function me({ env, t, c, who, eh, log }) {
  const meta = await readJsonKey(env, K.meta(t, c));
  if (!meta) return denied();
  const map = await readJsonKey(env, await userKey(who.email));
  // first request of the day by this person: one audit object, created once
  const today = todayLj(env), rec = { at: nowDate(env).toISOString(), email: who.email, t, c, action: 'signin', target: '', result: 'ok', ray: '', country: '' };
  try { await env.PORTAL.put('p/' + t + '/audit/' + today + '/signin-' + eh.slice(0, 16) + '.json', JSON.stringify(rec), { httpMetadata: { contentType: 'application/json' }, onlyIf: { etagDoesNotMatch: '*' } }); } catch { /* audit is best effort */ }
  return json({ name: (map && map.name) || '', client: meta.name });
}

async function view({ env, t, c }) {
  const [v, brand, news] = await Promise.all([readJsonKey(env, K.view(t, c)), readJsonKey(env, K.brand(t)), readJsonKey(env, K.news(t))]);
  if (!v) return denied(); // unpublished, or removed
  const today = todayLj(env), pre = cPrefix(t, c) + 'responses/', answers = {};
  const page = await env.PORTAL.list({ prefix: pre, include: ['customMetadata'] });
  for (const o of page.objects || []) { const id = o.key.slice(pre.length).replace(/\.json$/, ''); if (QUOTE_ID.test(id) && o.customMetadata) answers[id] = { decision: o.customMetadata.decision, at: o.customMetadata.at }; }
  const e = effective(v, today);
  const quotes = e.quotes.map((q) => {
    const status = q.status === 'open' && q.validUntil && q.validUntil < today ? 'expired' : q.status;
    const response = answers[q.id] || null;
    return { ...q, status, response, canDecide: q.kind === 'quote' && status === 'open' && !response };
  });
  return json({ client: e.client, brand: { name: (brand && brand.name) || e.client.name, accent: (brand && brand.accent) || '#1f4e79', logo: !!(brand && brand.logo) },
    news: (news && news.items) || [], today, publishedAt: v.publishedAt || null, invoices: e.invoices, quotes, documents: e.documents });
}

async function download({ env, t, c, log }, fid) {
  if (!HEX32.test(fid)) { await log('file.denied', 'bad-format', '404'); return denied(); }
  const v = await readJsonKey(env, K.view(t, c));
  if (!v || !fileIds(v).includes(fid)) { await log('file.denied', fid.slice(0, 8), '404'); return denied(); }
  const obj = await env.PORTAL.get(K.file(t, c, fid));
  if (!obj) { await log('file.denied', fid.slice(0, 8), '404-missing'); return denied(); }
  const type = obj.httpMetadata && obj.httpMetadata.contentType, ext = FILE_TYPES[type];
  const doc = v.documents.find((d) => d.id === fid), inv = v.invoices.find((i) => i.pdf === fid), quo = v.quotes.find((q) => q.pdf === fid);
  const name = safeFilename(doc ? doc.name : (inv ? inv.number : quo ? quo.number : 'document'), ext || '');
  await log('file.download', fid.slice(0, 8) + ' ' + name, 'ok');
  return new Response(obj.body, { headers: { 'Content-Type': ext ? type : 'application/octet-stream', 'Content-Disposition': attachment(name), 'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin', 'Referrer-Policy': 'no-referrer' } });
}

async function logo({ env, t }) {
  const brand = await readJsonKey(env, K.brand(t));
  if (!brand || !brand.logo) return denied();
  const obj = await env.PORTAL.get(K.logo(t));
  const type = obj && obj.httpMetadata && obj.httpMetadata.contentType;
  if (!obj || !LOGO_TYPES[type]) return denied();
  return new Response(obj.body, { headers: { 'Content-Type': type, ...NO_STORE, 'Content-Security-Policy': "default-src 'none'; sandbox" } });
}

async function decision({ env, request, url, who, t, c, log }, qid) {
  const expected = env.PORTAL_ORIGIN || (who.dev ? url.origin : '');
  if (!expected) return json({ error: 'Answering quotes is not available right now.' }, 503);
  const h = (n) => request.headers.get(n);
  if (h('Origin') !== expected) { await log('quote.decision', 'origin', '403'); return json({ error: 'Request refused.' }, 403); }
  const sfs = h('Sec-Fetch-Site');
  if (sfs && sfs !== 'same-origin') { await log('quote.decision', 'fetch-site', '403'); return json({ error: 'Request refused.' }, 403); }
  if (h('X-Portal') !== '1') return json({ error: 'Missing X-Portal header.' }, 400);
  if (String(h('Content-Type') || '').split(';')[0].trim().toLowerCase() !== 'application/json') return json({ error: 'Send JSON.' }, 415);
  if (Number(h('Content-Length')) > MAX_DECISION_BODY) return json({ error: 'Too large.' }, 413);
  const raw = new Uint8Array(await request.arrayBuffer());
  if (raw.byteLength > MAX_DECISION_BODY) return json({ error: 'Too large.' }, 413);
  if (!QUOTE_ID.test(qid)) return json({ error: 'Bad address.' }, 400);
  let body;
  try { body = JSON.parse(new TextDecoder().decode(raw)); } catch { return json({ error: 'The body is not valid JSON.' }, 400); }
  if (!body || typeof body !== 'object' || !['accept', 'decline'].includes(body.decision) || typeof body.quoteHash !== 'string' || !HEX64.test(body.quoteHash) || (body.comment != null && typeof body.comment !== 'string')) return json({ error: 'Bad request.' }, 400);
  const comment = clean(body.comment || '', 500, { multiline: true });

  const v = await readJsonKey(env, K.view(t, c));
  const q = v && v.quotes.find((x) => x.id === qid);
  if (!q) { await log('quote.decision', qid.slice(0, 8), '404'); return denied(); }
  if (q.kind !== 'quote') return json({ error: 'This document cannot be answered online.' }, 409);
  const key = K.response(t, c, qid), existing = async () => readJsonKey(env, key);
  const replay = (rec) => (rec.decision === body.decision ? json({ ok: true, decision: rec.decision, at: rec.at, replay: true }) : json({ error: 'This quote was already answered differently.' }, 409));
  const before = await existing();
  if (before) return replay(before); // an answered quote stays answered, whatever its status says now
  if (q.status !== 'open') return json({ error: 'This quote can no longer be answered (it is ' + q.status + ').' }, 409);
  if (q.validUntil && q.validUntil < todayLj(env)) return json({ error: 'This quote has expired.' }, 409);
  if (q.hash !== body.quoteHash) return json({ error: 'This quote changed since you opened it. Reload the page and look at it again.' }, 409);
  const at = nowDate(env).toISOString();
  const rec = { decision: body.decision, at, email: who.email, quoteHash: q.hash, number: q.number, total: q.totals.total, comment, ray: request.headers.get('CF-Ray') || '' };
  const put = await env.PORTAL.put(key, JSON.stringify(rec), { httpMetadata: { contentType: 'application/json' }, customMetadata: { decision: rec.decision, at }, onlyIf: { etagDoesNotMatch: '*' } });
  if (put === null) { const won = await existing(); return won ? replay(won) : json({ error: 'Try again.' }, 409); }
  await log('quote.decision', q.number + ' ' + rec.decision, 'ok');
  return json({ ok: true, decision: rec.decision, at });
}
