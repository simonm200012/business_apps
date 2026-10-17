// Builds the sample portal page in the Business Apps site (site/client-portal/): the real front-end (portal-site/portal.js and
// portal.css, copied unchanged) plus demo-view.json, which is what the real portal Worker answers to Elena at Lindgren Café
// after the demo seed (tools/portal-seed-lib.mjs). Fictional data only. Run: node tools/build-portal-demo.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { seedDemo } from './portal-seed-lib.mjs';
import staff from '../worker/index.js';
import portal from '../worker/portal.js';
const require = createRequire(import.meta.url);
const { makeR2 } = require('./tests/_portal-harness.js');

const root = path.resolve(import.meta.dirname, '..'), out = path.join(root, 'site/client-portal'), src = path.join(root, 'portal-site');
const r2 = makeR2(), owners = { alder: 'owner-alder@example.test', harbor: 'owner-harbor@example.test' };
await seedDemo(async (company, method, p, body, headers = {}) => {
  const h = { 'X-Stratum-Apps': '1', ...headers }; let b = body;
  if (body && typeof body === 'object' && !Buffer.isBuffer(body)) { b = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const r = await staff.fetch(new Request('http://localhost' + p, { method, headers: h, body: b }), { DEV_BYPASS: '1', OWNER_EMAIL: owners[company], PORTAL: r2 });
  return { status: r.status, text: await r.text() };
});
const env = { DEV_BYPASS: '1', PORTAL: r2 }, as = { headers: { Cookie: 'portal_dev_as=client-a@example.test' } };
const view = await (await portal.fetch(new Request('http://localhost/api/view', as), env)).json();
const logo = Buffer.from(await (await portal.fetch(new Request('http://localhost/api/brand/logo', as), env)).arrayBuffer());
for (const q of view.quotes) delete q.pdf; for (const i of view.invoices) delete i.pdf; // sample files are not included
fs.mkdirSync(out, { recursive: true });
for (const f of ['portal.js', 'portal.css', 'favicon.svg']) fs.copyFileSync(path.join(src, f), path.join(out, f));
fs.writeFileSync(path.join(out, 'demo-view.json'), JSON.stringify(view, null, 1) + '\n');
fs.writeFileSync(path.join(out, 'demo-logo.png'), logo);
const html = fs.readFileSync(path.join(src, 'index.html'), 'utf8').replace('<body>', '<body data-demo="1">').replace('href="/favicon.svg"', 'href="favicon.svg"')
  .replace('href="/portal.css"', 'href="portal.css"').replace('src="/portal.js"', 'src="portal.js"').replace('<title>Client portal</title>', '<title>Client portal (sample)</title>');
fs.writeFileSync(path.join(out, 'index.html'), html);
console.log('site/client-portal built:', view.invoices.length, 'invoices,', view.quotes.length, 'quotes,', view.documents.length, 'documents');
