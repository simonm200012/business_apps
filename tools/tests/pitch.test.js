// Animated pitches (site/pitch/): every app produces a valid scene list, the overall pitch covers every group, durations
// are 25-45 s, and the entry points exist. Run: node tools/tests/pitch.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const html = read('site/index.html');
const SHEETS = require(path.join(ROOT, 'site/_shared/app-sheets.js'));
const { ADJUST } = require(path.join(ROOT, 'site/_shared/app-sheet-panel.js'));
const PS = require(path.join(ROOT, 'site/pitch/scenes.js'));
const groups = PS.parseHome(html);
const byApp = {};
groups.forEach((g) => g.apps.forEach((a) => { byApp[a.id] = Object.assign({ group: g.id }, a); }));
let n = 0;
function t(name, fn) { fn(); n++; console.log('ok', n, name); }
function validScenes(sc, label) {
  assert.ok(Array.isArray(sc) && sc.length >= 6, label + ' scenes');
  const ids = new Set();
  sc.forEach((s) => {
    assert.ok(s.id && !ids.has(s.id), label + ' unique id ' + s.id); ids.add(s.id);
    assert.ok(s.kind && s.dur >= 2 && s.dur <= 8, label + ' ' + s.id + ' duration');
    assert.ok(typeof s.caption === 'string' && s.caption.trim(), label + ' ' + s.id + ' has a caption');
  });
  const sum = PS.total(sc);
  assert.ok(sum >= 25 && sum <= 45, label + ' lasts ' + sum + ' s');
  assert.strictEqual(sc[sc.length - 1].kind, 'cta', label + ' ends with the call to action');
  assert.ok(sc.some((s) => s.kind === 'adjust'), label + ' has the adjust scene');
}

t('the home page parses into the six groups and every app', () => {
  assert.strictEqual(groups.length, 6);
  groups.forEach((g) => assert.ok(g.name && g.desc && g.apps.length, g.id));
  assert.deepStrictEqual(Object.keys(byApp).sort(), Object.keys(SHEETS).sort());
});
t('the booking link is the one on the company site', () => {
  assert.ok(read('public/data/company.mjs').includes("bookingUrl: '" + PS.BOOKING_URL + "'"));
});
t('every app in app-sheets.js produces a valid pitch', () => {
  for (const id of Object.keys(SHEETS)) {
    const sc = PS.buildScenes(SHEETS[id], ADJUST, { id, name: byApp[id].name, group: byApp[id].group, href: '/' + byApp[id].href });
    validScenes(sc, id);
    const kinds = sc.map((s) => s.kind);
    for (const k of ['intro', 'problem', 'what', 'who', 'feature', 'pitch', 'adjust', 'cta']) assert.ok(kinds.includes(k), id + ' has ' + k);
    const feats = sc.filter((s) => s.kind === 'feature');
    assert.strictEqual(feats.length, Math.min(3, SHEETS[id].features.length), id + ' features');
    feats.forEach((f) => assert.ok(['bars', 'table', 'checks', 'calendar'].includes(f.template), id + ' template ' + f.template));
    assert.strictEqual(sc.find((s) => s.kind === 'pitch').text, SHEETS[id].pitch);
    assert.ok(sc.find((s) => s.kind === 'cta').openHref.startsWith('/'), id + ' open link');
  }
});
t('the adjust scene reuses the shared adjust text', () => {
  const a = PS.buildScenes(SHEETS.billing, ADJUST, { id: 'billing', name: 'Billing', group: 'finance' }).find((s) => s.kind === 'adjust');
  assert.strictEqual(a.title, ADJUST.title);
  assert.deepStrictEqual(a.items.map((i) => i.name), ADJUST.items.map((i) => i[0]));
  assert.strictEqual(a.news, ADJUST.news);
  assert.ok(!read('site/pitch/scenes.js').includes('Every app can be adjusted') && !read('site/pitch/pitch.js').includes('Every app can be adjusted'));
});
t('the overall pitch covers every group and lasts 25-45 s', () => {
  const sc = PS.buildAllScenes(groups, ADJUST);
  validScenes(sc, 'all');
  assert.deepStrictEqual(sc.filter((s) => s.kind === 'group').map((s) => s.id), groups.map((g) => 'group-' + g.id));
  sc.filter((s) => s.kind === 'group').forEach((s, i) => assert.deepStrictEqual(s.apps.map((a) => a.id), groups[i].apps.map((a) => a.id)));
  assert.strictEqual(sc.find((s) => s.kind === 'different').items.length, 4);
  assert.strictEqual(sc[sc.length - 1].book, PS.BOOKING_URL);
});
t('the overview is a 35-45 s film: opening montage, per-group mock screens, proofs, live re-brand, call to action', () => {
  const sc = PS.buildAllScenes(groups, ADJUST), sum = PS.total(sc);
  assert.ok(sum >= 35 && sum <= 45, 'overview lasts ' + sum + ' s');
  const intro = sc[0];
  assert.strictEqual(intro.kind, 'allintro');
  assert.ok(intro.promise && intro.total === Object.keys(byApp).length, 'promise and the app count come from the data');
  assert.deepStrictEqual(intro.groups.map((g) => g.id), groups.map((g) => g.id));
  intro.groups.forEach((g, i) => assert.deepStrictEqual(g.apps, groups[i].apps.map((a) => a.id)));
  sc.filter((s) => s.kind === 'group').forEach((s, i) => {
    assert.strictEqual(s.mock, groups[i].id, 'mock screen for ' + s.id);
    assert.ok(s.highlight.length >= 2 && s.highlight.length <= 3 && s.highlight.every((id) => s.apps.some((a) => a.id === id)));
  });
  assert.deepStrictEqual(sc.find((s) => s.kind === 'different').items.map((i) => i.visual), ['devices', 'lock', 'table', 'swatch']);
  const rb = sc.find((s) => s.kind === 'adjust');
  assert.ok(rb.rebrand && rb.rebrand.company && rb.rebrand.accent && rb.rebrand.nav.length >= 3, 're-brand scene');
  rb.rebrand.nav.forEach((n) => assert.ok(n[0] && n[1] && n[0] !== n[1], 'EN and SL label'));
  assert.strictEqual(rb.news, ADJUST.news);
  assert.ok(sc.map((s) => s.kind).indexOf('adjust') > sc.map((s) => s.kind).indexOf('different'));
  assert.ok(sc.every((s) => s.dur >= 3 && s.dur <= 8));
});
t('pitch.js draws the new overview scenes from the shared data', () => {
  const js = read('site/pitch/pitch.js'), css = read('site/pitch/pitch.css');
  for (const k of ['allIntro', 'groupScene', 'gmock', 'proof', 'rebrand']) assert.ok(js.includes('function ' + k), k);
  for (const g of ['finance', 'sales', 'operations', 'people', 'insights']) assert.ok(js.includes("id === '" + g + "'"), 'mock ' + g);
  assert.ok(/\.k-allintro|\.mont/.test(css) && css.includes('.rb{') && css.includes('.portrait .rb'));
});
t('sceneAt finds the scene for a moment', () => {
  const sc = PS.buildAllScenes(groups, ADJUST);
  assert.deepStrictEqual(PS.sceneAt(sc, 0), { index: 0, local: 0 });
  assert.strictEqual(PS.sceneAt(sc, PS.startOf(sc, 3) + 0.5).index, 3);
  assert.strictEqual(PS.sceneAt(sc, 999).index, sc.length - 1);
});
t('entry points: Play pitch on every sheet, Business Apps in 40 seconds in the adjust box and band', () => {
  const panel = read('site/_shared/app-sheet-panel.js');
  assert.ok(panel.includes('/pitch/?app=') && panel.includes('Play pitch'));
  assert.ok(panel.includes('/pitch/?all') && panel.includes('Business Apps in 40 seconds'));
  assert.ok(/function adjustBand[\s\S]*playAll\(\)/.test(panel) && /function fillAdjust[^\n]*playAll\(\)/.test(panel));
});
t('the pitch page loads its scripts and has the phone-app tags', () => {
  const p = read('site/pitch/index.html');
  for (const s of ['/_shared/app-sheets.js', '/_shared/app-sheet-panel.js', '/pitch/scenes.js', '/pitch/pitch.js', '/pitch/pitch.css']) assert.ok(p.includes(s), s);
  assert.ok(p.includes('tools/make-pwa.mjs') && p.includes('rel="manifest"'));
  assert.ok(p.includes('stratum-home-look') && read('site/pitch/pitch.js').includes('prefers-reduced-motion'));
});
