// Design Comparison, "Pick your look" (site/design-compare/picks.js): the catalogue, picks as a link and as text.
// Run: node tools/tests/design-compare-picks.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const PL = require(path.join(__dirname, '../../site/design-compare/picks.js'));
let n = 0;
function t(name, fn) { fn(); n++; console.log('ok', n, name); }

t('every look has its three screenshots, and the shot script lists the same looks', () => {
  const dir = path.join(__dirname, '../../site/design-compare/shots');
  const script = fs.readFileSync(path.join(dir, 'make-shots.mjs'), 'utf8');
  PL.LOOKS.forEach((l) => {
    ['-desk-light', '-desk-dark', '-phone'].forEach((s) => assert.ok(fs.existsSync(path.join(dir, l.id + s + '.webp')), l.id + s));
    assert.ok(new RegExp('\\b' + l.id + ': ').test(script), l.id + ' in make-shots.mjs');
  });
  assert.strictEqual(PL.LOOKS.filter((l) => l.kind === 'home').length, 6);
});
t('a link round-trips the picks; liked looks come out in catalogue order', () => {
  const p = { by: 'Ana, Primer d.o.o.', note: 'Blue please & no red', fav: { app: 'upflow', home: 'arc' }, like: ['raycast', 'pipedrive', 'upflow', 'arc'] };
  const q = PL.encode(p);
  assert.strictEqual(q, '?by=Ana%2C%20Primer%20d.o.o.&fa=upflow&fh=arc&l=pipedrive.upflow.raycast.arc&n=Blue%20please%20%26%20no%20red');
  assert.deepStrictEqual(PL.decode(q), { by: 'Ana, Primer d.o.o.', note: 'Blue please & no red', fav: { app: 'upflow', home: 'arc' }, like: ['pipedrive', 'upflow', 'raycast', 'arc'] });
});
t('decode ignores unknown looks, favourites of the wrong kind and broken encoding; no picks → null', () => {
  assert.deepStrictEqual(PL.decode('?fa=arc&fh=pipedrive&l=nope.gx.gx&by=%E0%A4'), { by: '', note: '', fav: { app: null, home: null }, like: ['gx'] });
  assert.strictEqual(PL.decode(''), null);
  assert.strictEqual(PL.decode('?by=Someone'), null);
  assert.strictEqual(PL.decode('?l=nope'), null);
  assert.strictEqual(PL.encode(PL.empty()), '');
});
t('clean caps text and survives junk saved data', () => {
  const p = PL.clean({ by: 'x'.repeat(200), note: 'y'.repeat(900), fav: 'z', like: 'pipedrive' });
  assert.strictEqual(p.by.length, 80); assert.strictEqual(p.note.length, 400);
  assert.deepStrictEqual(p.fav, { app: null, home: null }); assert.deepStrictEqual(p.like, []);
  assert.deepStrictEqual(PL.clean(null), PL.empty());
});
t('summary reads well in an e-mail', () => {
  const s = PL.summary({ by: 'Ana', fav: { app: 'pigment', home: null }, like: ['pigment', 'm365'], note: 'Dense is fine' }, 'https://example.si/design-compare/?fa=pigment');
  assert.strictEqual(s, 'Pick your look: Ana\nFavourite app style: Pigment look (as in Budget vs actual)\nFavourite home page: not chosen\nAlso liked: Pigment, Microsoft 365 (home page)\nNotes: Dense is fine\n\nSee the picks: https://example.si/design-compare/?fa=pigment');
});
console.log('design-compare-picks: ' + n + ' tests passed');
