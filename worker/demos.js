// Branded demos, private API (owner only; routed from worker/index.js after the Access check, which already refuses
// view-only people for /api/demos, see isPrivatePath in worker/access.js). Data: worker/demo-shared.js.
//
//   GET    /api/demos                  { demos: [{ slug, name, lang, apps, expires, expired, created, views: { count, last } }], base, defaults }
//                                      (also removes demos that expired more than 90 days ago, with their counters)
//   POST   /api/demos                  create: { name, lang, accent, accent2, apps, news: { title, text }, booking, expires: 'YYYY-MM-DD', logo: <PNG as base64> }
//                                      → 201 { slug, config, views, path: '/d/<slug>' }
//   GET    /api/demos/<slug>           { config, views }
//   GET    /api/demos/<slug>/logo.png  the logo (to edit it again)
//   PATCH  /api/demos/<slug>           any of the fields above, plus expireNow: true; logo: null removes the logo
//   DELETE /api/demos/<slug>           removes config, logo and counter
// Changes need the X-Stratum-Apps header (checked in index.js). Stored in the R2 bucket LEADS under demos/; never an e-mail or IP.
import { PREFIX, LIMITS, DAY, isSlug, keys, newSlug, buildConfig, isExpired } from './demo-shared.js';
import COMPANY from '../public/data/company.mjs';

const H = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: H });

async function readJson(obj) { if (!obj) return null; try { const v = JSON.parse(await obj.text()); return v && typeof v === 'object' ? v : null; } catch { return null; } }
async function readViews(env, slug) { const v = await readJson(await env.LEADS.get(keys(slug).views)); return { count: Math.max(0, Number(v && v.count) || 0), last: v && typeof v.last === 'string' ? v.last : null }; }
const putJson = (env, key, v) => env.LEADS.put(key, JSON.stringify(v), { httpMetadata: { contentType: 'application/json' } });

async function allSlugs(env) {
  const out = [];
  let cursor;
  for (let i = 0; i < 20; i++) {
    const page = await env.LEADS.list({ prefix: PREFIX, cursor });
    for (const o of page.objects || []) { const m = o.key.match(/^demos\/([^/]+)\/config\.json$/); if (m && isSlug(m[1])) out.push(m[1]); }
    if (!page.truncated) break;
    cursor = page.cursor;
  }
  return out;
}
async function removeDemo(env, slug) { const k = keys(slug); await env.LEADS.delete([k.config, k.logo, k.views]); }

/** Demos that expired more than 90 days ago go (with their counter): the privacy page promises this. Runs when the list is opened. */
async function sweep(env, slugs, now) {
  const gone = new Set();
  for (const slug of slugs) {
    const cfg = await readJson(await env.LEADS.get(keys(slug).config));
    if (cfg && Date.parse(cfg.expires) + LIMITS.cleanAfterDays * DAY < now) { await removeDemo(env, slug); gone.add(slug); }
  }
  return gone;
}

async function readBody(request) {
  if (!/^application\/json\b/i.test(request.headers.get('Content-Type') || '')) return { error: json({ error: 'JSON only.' }, 415) };
  if (Number(request.headers.get('Content-Length') || 0) > LIMITS.bodyBytes) return { error: json({ error: 'The request is too large.' }, 413) };
  const raw = await request.text();
  if (raw.length > LIMITS.bodyBytes) return { error: json({ error: 'The request is too large.' }, 413) };
  try { const v = JSON.parse(raw); if (v && typeof v === 'object' && !Array.isArray(v)) return { value: v }; } catch { /* below */ }
  return { error: json({ error: 'Bad JSON.' }, 400) };
}

/** `now` (ms) only for tests. */
export async function demos(request, env, url, now = Date.now()) {
  if (!env.LEADS) return json({ error: 'The branded demos are not connected to this site.' }, 503);
  const m = url.pathname.match(/^\/api\/demos(?:\/([^/]+)(\/logo\.png)?)?\/?$/);
  if (!m) return json({ error: 'Not found.' }, 404);
  const slug = m[1], logoPath = !!m[2], method = request.method;

  if (slug === undefined) {
    if (method === 'GET') {
      let slugs = await allSlugs(env);
      const gone = await sweep(env, slugs, now);
      slugs = slugs.filter((s) => !gone.has(s));
      const list = [];
      for (const s of slugs.slice(0, LIMITS.maxDemos)) {
        const cfg = await readJson(await env.LEADS.get(keys(s).config));
        if (!cfg) continue;
        list.push({ slug: s, name: cfg.name, lang: cfg.lang, apps: (cfg.apps || []).length, expires: cfg.expires, expired: isExpired(cfg, now), created: cfg.created, views: await readViews(env, s) });
      }
      list.sort((a, b) => String(b.created).localeCompare(String(a.created)));
      return json({ demos: list, base: String(env.PUBLIC_BASE_URL || '').replace(/\/+$/, ''), defaults: { bookingUrl: COMPANY.bookingUrl || '', days: LIMITS.defaultDays } });
    }
    if (method === 'POST') {
      const body = await readBody(request);
      if (body.error) return body.error;
      if ((await allSlugs(env)).length >= LIMITS.maxDemos) return json({ error: 'There are too many demos. Delete old ones first.' }, 409);
      const r = buildConfig(body.value, null, now);
      if (!r.ok) return json({ error: 'invalid', fields: r.fields }, 400);
      const id = newSlug(r.config.name), k = keys(id);
      r.config.slug = id;
      if (r.logo) await env.LEADS.put(k.logo, r.logo, { httpMetadata: { contentType: 'image/png' } });
      await putJson(env, k.views, { count: 0, last: null });
      await putJson(env, k.config, r.config);
      return json({ slug: id, config: r.config, views: { count: 0, last: null }, path: '/d/' + id }, 201);
    }
    return json({ error: 'Method not allowed.' }, 405);
  }

  if (!isSlug(slug)) return json({ error: 'Not found.' }, 404);
  const k = keys(slug);
  const cfg = await readJson(await env.LEADS.get(k.config));
  if (!cfg) return json({ error: 'This demo does not exist.' }, 404);

  if (logoPath) {
    if (method !== 'GET') return json({ error: 'Method not allowed.' }, 405);
    const o = cfg.logo ? await env.LEADS.get(k.logo) : null;
    if (!o) return json({ error: 'This demo has no logo.' }, 404);
    return new Response(o.body, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" } });
  }
  if (method === 'GET') return json({ config: cfg, views: await readViews(env, slug), expired: isExpired(cfg, now) });
  if (method === 'DELETE') { await removeDemo(env, slug); return json({ ok: true }); }
  if (method === 'PATCH') {
    const body = await readBody(request);
    if (body.error) return body.error;
    const r = buildConfig(body.value, cfg, now);
    if (!r.ok) return json({ error: 'invalid', fields: r.fields }, 400);
    if (r.logo) await env.LEADS.put(k.logo, r.logo, { httpMetadata: { contentType: 'image/png' } });
    else if (r.logo === null) await env.LEADS.delete(k.logo);
    await putJson(env, k.config, r.config);
    return json({ slug, config: r.config, views: await readViews(env, slug), expired: isExpired(r.config, now) });
  }
  return json({ error: 'Method not allowed.' }, 405);
}
