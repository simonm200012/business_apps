// Local demo of the client portal without Cloudflare: serves portal-site/ with the real security headers from
// portal-site/_headers and answers /api/* with the real portal Worker (worker/portal.js) over an in-memory bucket that the
// real staff Worker (worker/index.js, DEV_BYPASS on localhost) has just been seeded into. Two fictional companies:
//   /__as/client-a@example.test   Elena at Lindgren Café (Alder & Finch Studio)
//   /__as/client-b@example.test   Jonas at Birch Bakery  (same company, other client)
//   /__as/client-x@example.test   Mara at Northwind Outfitters (Harbor Light Studio: another company, another look)
//   (add ?to=/%23/quotes to land on a page)
// Usage: node tools/portal-dev-server.mjs [port]      (default 8788; nothing is written to disk or sent anywhere)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { seedDemo, DEMO_USERS } from './portal-seed-lib.mjs';
import staff from '../worker/index.js';
import portal from '../worker/portal.js';
import { COMPANIES } from './portal-demo-state.js';
const require = createRequire(import.meta.url);
const { makeR2 } = require('./tests/_portal-harness.js');

const root = path.resolve(import.meta.dirname, '..'), site = path.join(root, 'portal-site');
const port = Number(process.argv[2]) || 8788;
const r2 = makeR2();
const owners = { alder: 'owner-alder@example.test', harbor: 'owner-harbor@example.test' };
const staffEnv = (company) => ({ DEV_BYPASS: '1', OWNER_EMAIL: owners[company], PORTAL: r2, SYNC: makeR2() });
await seedDemo(async (company, method, p, body, headers = {}) => {
  const h = { 'X-Stratum-Apps': '1', ...headers };
  let b = body; if (body && typeof body === 'object' && !Buffer.isBuffer(body)) { b = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const r = await staff.fetch(new Request('http://localhost' + p, { method, headers: h, body: b }), staffEnv(company));
  return { status: r.status, text: await r.text() };
}, { log: (m) => console.log('seed:', m) });
console.log('companies:', Object.values(COMPANIES).map((c) => c.name).join(', '));

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
const headersFile = fs.readFileSync(path.join(site, '_headers'), 'utf8').split('\n').filter((l) => /^\s+\S+:/.test(l)).map((l) => { const i = l.indexOf(':'); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; });
const assets = { async fetch(request) {
  let p = new URL(request.url).pathname; if (p === '/') p = '/index.html';
  const file = path.join(site, path.normalize(p));
  if (!file.startsWith(site + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return new Response(fs.readFileSync(path.join(site, '404.html')), { status: 404, headers: { 'Content-Type': MIME['.html'], ...Object.fromEntries(headersFile) } });
  return new Response(fs.readFileSync(file), { headers: { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', ...Object.fromEntries(headersFile) } });
} };
const env = { DEV_BYPASS: '1', PORTAL: r2, ASSETS: assets };

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost:' + port);
    const as = url.pathname.match(/^\/__as\/([^/]+)$/);
    const to = /^\/[#\/\w-]*$/.test(url.searchParams.get('to') || '') ? url.searchParams.get('to') : '/';
    if (as) { res.writeHead(302, { Location: to, 'Set-Cookie': 'portal_dev_as=' + as[1] + '; Path=/; SameSite=Lax' }); return res.end(); }
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = chunks.length && !['GET', 'HEAD'].includes(req.method) ? Buffer.concat(chunks) : undefined;
    const r = await portal.fetch(new Request(url, { method: req.method, headers: req.headers, body }), env);
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
  } catch (e) { console.error(e); res.writeHead(500); res.end('dev server error'); }
}).listen(port, '127.0.0.1', () => console.log('client portal demo: http://localhost:' + port + '/   (switch person: /__as/' + Object.keys(DEMO_USERS).join(' or /__as/') + ')'));
