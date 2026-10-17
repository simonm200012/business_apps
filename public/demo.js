// Branded demos on the public site (no sign-in): the personal page /d/<slug> and its data. Written by the private site's
// Studio > Branded demo (worker/demos.js, same bucket LEADS under demos/); this Worker only reads, and counts views.
//
//   GET /d/<slug>                    the page shell (public build: dist/demo/index.html), or the plain 404 page
//   GET /api/demo/<slug>             the public part of the settings (publicConfig); counts one view
//   GET /api/demo/<slug>/logo.png    the logo (image/png, nosniff)
// An unknown and an expired slug get exactly the same answer (404, same body). A view is { count, last } in views.json: no IP
// address, no cookie, no user agent is stored. Link previews and bots, and requests with ?c=0 (the owner's "Open as prospect"),
// are not counted. The page's script asks for the settings once per page load, so one load is one view.
import { keys, isSlug, isExpired, publicConfig, isBot, DEMO_HEADERS } from '../worker/demo-shared.js';

const NOT_FOUND_HTML = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>Not found</title></head>' +
  '<body style="font:16px/1.5 system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;color:#424242"><p>This page is not available.</p></body></html>';
// the plain page uses an inline style attribute, so its own CSP allows it; it has no script
const NOT_FOUND_CSP = "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'";

export const notFoundPage = () => new Response(NOT_FOUND_HTML, { status: 404, headers: { ...DEMO_HEADERS, 'Content-Security-Policy': NOT_FOUND_CSP, 'Content-Type': 'text/html; charset=utf-8' } });
export const notFoundJson = () => new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers: { ...DEMO_HEADERS, 'Content-Type': 'application/json; charset=utf-8' } });

async function liveConfig(env, slug, now) {
  if (!env.LEADS || !isSlug(slug)) return null;
  const o = await env.LEADS.get(keys(slug).config);
  if (!o) return null;
  let cfg;
  try { cfg = JSON.parse(await o.text()); } catch { return null; }
  return cfg && !isExpired(cfg, now) ? cfg : null;
}

/** GET /d/<slug>: the page shell when the demo is live. `now` (ms) only for tests. */
export async function handleDemoPage(request, env, url, now = Date.now()) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return notFoundPage();
  const slug = (url.pathname.match(/^\/d\/([^/]+)\/?$/) || [])[1];
  if (!slug || !(await liveConfig(env, slug, now))) return notFoundPage();
  const shell = env.ASSETS ? await env.ASSETS.fetch(new Request(new URL('/demo/', url).href, { method: 'GET' })) : null;
  if (!shell || !shell.ok) return notFoundPage();
  const h = new Headers(shell.headers);
  for (const [k, v] of Object.entries(DEMO_HEADERS)) h.set(k, v);
  h.set('Content-Type', 'text/html; charset=utf-8');
  return new Response(request.method === 'HEAD' ? null : shell.body, { status: 200, headers: h });
}

/** GET /api/demo/<slug>[/logo.png] */
export async function handleDemoApi(request, env, url, now = Date.now()) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return notFoundJson();
  const m = url.pathname.match(/^\/api\/demo\/([^/]+)(\/logo\.png)?\/?$/);
  if (!m) return notFoundJson();
  const cfg = await liveConfig(env, m[1], now);
  if (!cfg) return notFoundJson();
  if (m[2]) {
    const logo = cfg.logo ? await env.LEADS.get(keys(m[1]).logo) : null;
    if (!logo) return notFoundJson();
    return new Response(logo.body, { headers: { ...DEMO_HEADERS, 'Content-Type': 'image/png', 'Cross-Origin-Resource-Policy': 'same-origin' } });
  }
  if (url.searchParams.get('c') !== '0' && !isBot(request.headers.get('User-Agent'), request.headers)) await countView(env, m[1], now);
  return new Response(JSON.stringify(publicConfig(cfg)), { headers: { ...DEMO_HEADERS, 'Content-Type': 'application/json; charset=utf-8' } });
}

async function countView(env, slug, now) {
  const key = keys(slug).views;
  try {
    const o = await env.LEADS.get(key);
    let v = {};
    if (o) { try { v = JSON.parse(await o.text()) || {}; } catch { v = {}; } }
    await env.LEADS.put(key, JSON.stringify({ count: (Number(v.count) || 0) + 1, last: new Date(now).toISOString() }), { httpMetadata: { contentType: 'application/json' } });
  } catch { /* a counter that cannot be written never stops the page */ }
}
