// Screenshots for "Pick your look" (design-compare/index.html): every look in LOOKS, on a computer in light and dark
// and on a phone in light, saved as WebP next to this file (<id>-desk-light.webp, <id>-desk-dark.webp, <id>-phone.webp).
//
// Use a FRESH Chrome profile, so the apps open with their made-up demo data and never with your own:
//   cd site && python3 -m http.server 8090 --bind 127.0.0.1 &
//   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --remote-debugging-port=9333 \
//       --user-data-dir="$(mktemp -d)" about:blank &
//   node site/design-compare/shots/make-shots.mjs http://127.0.0.1:8090 9333 [id …]
// Run it again after an app's look changes (optionally only for some ids). Needs Node 22+ (built-in WebSocket).
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] || 'http://127.0.0.1:8090', PORT = process.argv[3] || 9333, ONLY = process.argv.slice(4);
// id → page to open (the same list as LOOKS in ../index.html)
const LOOKS = {
  pipedrive: 'crm/', upflow: 'collections/', agicap: 'cashflow/', pigment: 'budget/', shopify: 'erp/', jobber: 'service/#/board',
  timetastic: 'leave/', ironclad: 'contracts/', asana: 'team-tasks/', lightspeed: 'stores/', meta: 'ads/', gx: 'datacheck/',
  m365: '?look=m365', appstore: '?look=appstore', raycast: '?look=raycast', arc: '?look=arc', odoo: '?look=odoo', classic: '?look=classic'
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pg = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page');
if (!pg) pg = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(pg.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0; const pend = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => ((await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result || {}).result?.value;
await send('Page.enable');

async function shot(look, path, w, h, dark, name) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: w < 768 ? 2 : 1, mobile: w < 768 });
  await send('Emulation.setTouchEmulationEnabled', { enabled: w < 768 });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
  await send('Page.navigate', { url: BASE + '/' + path });
  for (let i = 0; i < 80 && (await ev('document.readyState')) !== 'complete'; i++) await sleep(100);
  await sleep(2200);
  // the shell's theme button follows the system unless it was set: make sure it does here
  await ev("try{localStorage.removeItem('stratum-theme')}catch(e){};window.scrollTo(0,0);1");
  await sleep(300);
  const r = await send('Page.captureScreenshot', { format: 'webp', quality: w < 768 ? 62 : 70 });
  writeFileSync(join(OUT, name), Buffer.from(r.result.data, 'base64'));
  console.log('saved', name);
}
for (const [look, path] of Object.entries(LOOKS)) {
  if (ONLY.length && !ONLY.includes(look)) continue;
  await shot(look, path, 1280, 800, false, look + '-desk-light.webp');
  await shot(look, path, 1280, 800, true, look + '-desk-dark.webp');
  await shot(look, path, 390, 844, false, look + '-phone.webp');
}
// leave the home page on its default style in this profile
await ev("try{localStorage.removeItem('stratum-home-look')}catch(e){};1");
ws.close();
