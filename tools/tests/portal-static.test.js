// Client portal pages: security headers file, no inline script or style, no innerHTML, the sample page copy in the Business
// Apps site stays identical to the real front-end. Run: node tools/tests/portal-static.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '../..'), PS = path.join(ROOT, 'portal-site');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let n = 0;
function t(name, fn) { fn(); n++; console.log('ok', n, name); }

const headers = Object.fromEntries(read('portal-site/_headers').split('\n').filter((l) => /^\s+\S+:/.test(l)).map((l) => { const i = l.indexOf(':'); return [l.slice(0, i).trim().toLowerCase(), l.slice(i + 1).trim()]; }));

t('_headers: strict CSP (no unsafe-inline, no unsafe-eval, nothing but self) and the other security headers', () => {
  const csp = headers['content-security-policy'];
  assert.ok(csp && !/unsafe-|data:|blob:|\*|https?:/.test(csp), csp);
  for (const d of ["default-src 'none'", "script-src 'self'", "style-src 'self'", "img-src 'self'", "connect-src 'self'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'"]) assert.ok(csp.includes(d), d);
  assert.strictEqual(headers['x-frame-options'], 'DENY');
  assert.strictEqual(headers['referrer-policy'], 'no-referrer');
  assert.strictEqual(headers['x-content-type-options'], 'nosniff');
  assert.strictEqual(headers['cross-origin-opener-policy'], 'same-origin');
  assert.strictEqual(headers['cross-origin-resource-policy'], 'same-origin');
  assert.ok(/camera=\(\)/.test(headers['permissions-policy']) && /geolocation=\(\)/.test(headers['permissions-policy']));
  assert.ok(/^\/\*/m.test(read('portal-site/_headers')), 'applies to every path');
});
t('every portal page: no inline script, no <style>, no style="", no on*= handlers, no external resources', () => {
  for (const f of fs.readdirSync(PS).filter((x) => x.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(PS, f), 'utf8');
    assert.ok(!/<script(?![^>]*\ssrc=)[^>]*>/i.test(html), f + ': inline script');
    assert.ok(!/<style/i.test(html) && !/\sstyle\s*=/i.test(html), f + ': inline style');
    assert.ok(!/\son[a-z]+\s*=/i.test(html), f + ': event handler attribute');
    assert.ok(!/(src|href)\s*=\s*["']?(https?:)?\/\//i.test(html), f + ': external resource');
    assert.ok(!/javascript:/i.test(html));
  }
});
t('portal.js and portal.css: text-only rendering, no eval, no inline style attributes, no remote URLs', () => {
  const js = read('portal-site/portal.js'), css = read('portal-site/portal.css');
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function|setAttribute\(\s*['"]style|\.cssText/.test(js));
  assert.ok(!/https?:\/\//.test(js.replace(/http:\/\/www\.w3\.org\/2000\/svg/, '')) , 'no remote URL in portal.js');
  assert.ok(!/@import|url\(/i.test(css), 'portal.css loads nothing');
});
t('staff-written text goes through textContent: the builder has no HTML path', () => {
  const js = read('portal-site/portal.js');
  assert.ok(/createTextNode/.test(js) && /\.textContent =/.test(js));
  assert.ok(/\/\^\(#\\\/\|\\\/api\\\/files/.test(js), 'links are limited to internal addresses');
});
t('the front-end only calls the portal API (no staff or other endpoints)', () => {
  const js = read('portal-site/portal.js');
  const used = [...js.matchAll(/'(\/api\/[^']*)'/g)].map((m) => m[1]);
  assert.ok(used.length > 3);
  for (const u of used) assert.ok(/^\/api\/(me|view|logout|brand\/logo|files\/|quotes\/)/.test(u), u);
});
t('the sample page in the Business Apps site uses an identical copy of the front-end', () => {
  if (!fs.existsSync(path.join(ROOT, 'site/client-portal/portal.js'))) return;
  for (const f of ['portal.js', 'portal.css']) assert.strictEqual(read('site/client-portal/' + f), read('portal-site/' + f), f + ' differs: run node tools/build-portal-demo.mjs');
});
console.log('portal-static: ' + n + ' tests passed');
