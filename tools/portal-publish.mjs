// Staff-side publish tool for the client portal (Billing's "Publish to portal" will call the same endpoints).
//   node tools/portal-publish.mjs seed [--base http://localhost:8787] [--company alder|harbor]
//        seeds the fictional demo company into a LOCAL staff Worker (wrangler dev with DEV_BYPASS=1 in .dev.vars)
//   node tools/portal-publish.mjs publish --state billing-state.json --client <billing client id> --portal-id <32 hex> [--base URL]
//        builds the projection (site/billing/portal-projection.js) from a Billing state JSON and publishes it (files are
//        not handled here: PDFs and shared documents are uploaded with PUT /api/portal/clients/:c/files/:fid first)
// Only local development is supported: the production staff API needs a Cloudflare Access sign-in that a script cannot do.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { seedDemo, DEMO_USERS } from './portal-seed-lib.mjs';
const require = createRequire(import.meta.url);
const P = require('../site/billing/portal-projection.js');

const args = Object.fromEntries(process.argv.slice(3).reduce((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1]]] : a), []));
const base = args.base || 'http://localhost:8787';
if (!/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(base)) { console.error('Refusing: --base must be a local address (' + base + ').'); process.exit(2); }
const call = async (method, p, body, headers = {}) => {
  const h = { 'X-Stratum-Apps': '1', ...headers }; let b = body;
  if (body && typeof body === 'object' && !Buffer.isBuffer(body)) { b = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const r = await fetch(base + p, { method, headers: h, body: b });
  return { status: r.status, text: await r.text() };
};
const cmd = process.argv[2];
if (cmd === 'seed') {
  const out = await seedDemo((company, ...rest) => call(...rest), { companies: [args.company || 'alder'], log: console.log });
  console.log('Seeded. In the portal dev server set the cookie portal_dev_as to one of:', Object.entries(DEMO_USERS).filter(([, u]) => u.company === (args.company || 'alder')).map(([e]) => e).join(', '));
} else if (cmd === 'publish') {
  if (!args.state || !args.client || !/^[a-f0-9]{32}$/.test(args['portal-id'] || '')) { console.error('Needs --state, --client and --portal-id (32 hex).'); process.exit(2); }
  const state = JSON.parse(fs.readFileSync(args.state, 'utf8'));
  const view = P.buildProjection(state, args.client, {});
  const cur = await call('GET', '/api/portal/clients/' + args['portal-id'] + '/view');
  let etag = ''; if (cur.status === 200) { const head = await fetch(base + '/api/portal/clients/' + args['portal-id'] + '/view', { headers: { 'X-Stratum-Apps': '1' } }); etag = head.headers.get('ETag') || ''; }
  const r = await call('PUT', '/api/portal/clients/' + args['portal-id'] + '/view' + (etag ? '?base=' + encodeURIComponent(etag) : ''), view);
  console.log(r.status, r.text);
  process.exit(r.status < 300 ? 0 : 1);
} else { console.error('Usage: node tools/portal-publish.mjs seed|publish ...'); process.exit(2); }
