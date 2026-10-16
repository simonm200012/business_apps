// Tests for site/erp/barcode.js (EAN check digits, SVG, scan-line decoder). Run: node tools/tests/erp-barcode.test.js
'use strict';
const assert = require('assert');
const path = require('path');
const B = require(path.join(__dirname, '../../site/erp/barcode.js'));

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok', n, name); }

// a deterministic pseudo-random source for the noise
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let x = Math.imul(a ^ (a >>> 15), 1 | a); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; }
// renders a code as one camera row: quiet zones, px per module (not a whole number), ink spread, blur, noise, a light gradient
function row(code, opt) {
  opt = opt || {};
  const m = B.modules(code), ppm = opt.ppm || 3.3, spread = opt.spread || 0, R = rng(opt.seed || 7);
  const left = Math.round((opt.lead || 14) * ppm), W = Math.round(left + (m.length + 14) * ppm), out = new Array(W);
  for (let x = 0; x < W; x++) {
    const mod = (x - left) / ppm, i = Math.floor(mod + (spread * (R() - 0.5)));
    const dark = i >= 0 && i < m.length && m[i] === '1';
    out[x] = dark ? 40 : 215;
  }
  const blurred = out.map((v, x) => Math.round(((out[x - 1] ?? v) + 2 * v + (out[x + 1] ?? v)) / 4));
  return blurred.map((v, x) => Math.max(0, Math.min(255, Math.round(v * (opt.gradient ? 0.65 + 0.5 * x / W : 1) + ((opt.noise || 0) * (R() - 0.5))))));
}

t('GS1 check digits', () => {
  assert.strictEqual(B.check('400638133393'), 1);     // 4006381333931
  assert.strictEqual(B.check('978030640615'), 7);     // ISBN 978-0-306-40615-7
  assert.strictEqual(B.check('9638507'), 4);          // EAN-8 96385074
  assert.strictEqual(B.check('03600029145'), 2);      // UPC-A 036000291452
  assert.ok(B.valid('4006381333931') && B.valid('96385074') && B.valid('036000291452'));
  assert.ok(!B.valid('4006381333932') && !B.valid('400638133393') && !B.valid('abc') && !B.valid(''));
});

t('normalize: spaces, hyphens, UPC-A as EAN-13', () => {
  assert.strictEqual(B.normalize(' 4 006381 333931 '), '4006381333931');
  assert.strictEqual(B.normalize('036000-291452'), '0036000291452');
  assert.strictEqual(B.normalize('9638-5074'), '96385074');
  assert.strictEqual(B.normalize('FR-1004'), null);
  assert.strictEqual(B.normalize('12345'), null);
});

t('module patterns have the right length and guards', () => {
  const m = B.modules('4006381333931');
  assert.strictEqual(m.length, 95);
  assert.strictEqual(m.slice(0, 3), '101'); assert.strictEqual(m.slice(45, 50), '01010'); assert.strictEqual(m.slice(92), '101');
  assert.strictEqual(B.modules('96385074').length, 67);
  assert.throws(() => B.modules('123'));
});

t('svg renders only valid codes and escapes the title', () => {
  const s = B.svg('2000100400012', { title: 'A <b>' });
  assert.ok(s.startsWith('<svg') && s.indexOf('A &lt;b&gt;') > 0 && s.indexOf('<b>') < 0);
  assert.strictEqual(B.svg('2000100400013'), '');
  assert.ok(B.svg('96385074').indexOf('9638') > 0);
});

t('decodes clean EAN-13 and EAN-8 rows', () => {
  ['4006381333931', '2000100400012', '0036000291452', '5901234123457'].forEach((c) => assert.strictEqual(B.decodeRow(row(c)), c, c));
  assert.strictEqual(B.decodeRow(row('96385074')), '96385074');
});

t('decodes rows that are upside down, blurred, noisy, unevenly lit', () => {
  const c = '200030120004' + B.check('200030120004');
  assert.ok(B.valid(c));
  assert.strictEqual(B.decodeRow(row(c).reverse()), c);
  assert.strictEqual(B.decodeRow(row(c, { ppm: 2.2, noise: 50, seed: 3 })), c);
  assert.strictEqual(B.decodeRow(row(c, { ppm: 4.7, gradient: true, noise: 30, seed: 11 })), c);
  assert.strictEqual(B.decodeRow(row(c, { ppm: 3.1, spread: 0.35, seed: 5 })), c);
});

t('never returns a code with a wrong check digit or from no barcode', () => {
  const flat = new Array(600).fill(200);
  assert.strictEqual(B.decodeRow(flat), null);
  const R = rng(42), junk = Array.from({ length: 640 }, () => (R() < 0.5 ? 30 : 220));
  assert.strictEqual(B.decodeRow(junk), null);
  // half a barcode (cut off by the frame edge) is not read
  assert.strictEqual(B.decodeRow(row('4006381333931').slice(0, 170)), null);
});

t('decodeImage reads the middle rows of an RGBA frame and counts agreeing rows', () => {
  const code = '2000100600023', line = row(code, { ppm: 3.6 }), W = line.length, H = 120, data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const o = (y * W + x) * 4, v = y > 20 && y < 100 ? line[x] : 230; data[o] = data[o + 1] = data[o + 2] = v; data[o + 3] = 255; }
  const r = B.decodeImage({ data: data, width: W, height: H });
  assert.ok(r && r.code === code && r.hits >= 5, JSON.stringify(r));
  assert.strictEqual(B.decodeImage({ data: new Uint8ClampedArray(400 * 4 * 10).fill(255), width: 400, height: 10 }), null);
});

console.log('\nerp-barcode: all ' + n + ' tests passed');
