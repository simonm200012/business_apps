// Tests for Postbench: SI/HR holidays and texts (site/postbench/pb-local.js) and the photo store helpers that keep
// pictures out of localStorage (site/postbench/pb-pics.js). Run: node tools/tests/postbench-local.test.js
'use strict';
const assert = require('assert');
const path = require('path');
const L = require(path.join(__dirname, '../../site/postbench/pb-local.js'));
const P = require(path.join(__dirname, '../../site/postbench/pb-pics.js'));

let n = 0;
function t(name, fn) { const r = fn(); n++; console.log('ok', n, name); return r; }
const by = (list, name) => list.filter((d) => d.name === name)[0];

t('Easter dates', () => {
  assert.deepStrictEqual(L.easter(2026), [4, 5]);
  assert.deepStrictEqual(L.easter(2027), [3, 28]);
  assert.deepStrictEqual(L.easter(2025), [4, 20]);
});
t('Slovenian work-free days 2026', () => {
  const d = L.days(2026, 'SI'), off = d.filter((x) => x.kind === 'off').map((x) => x.date);
  assert.deepStrictEqual(off, ['2026-01-01', '2026-01-02', '2026-02-08', '2026-04-05', '2026-04-06', '2026-04-27', '2026-05-01', '2026-05-02', '2026-05-24', '2026-06-25', '2026-08-15', '2026-10-31', '2026-11-01', '2026-12-25', '2026-12-26']);
  assert.strictEqual(by(d, 'Binkošti').date, '2026-05-24');
  assert.strictEqual(by(d, 'Črni petek').date, '2026-11-27');
  assert.strictEqual(by(d, 'Materinski dan').date, '2026-03-25');
});
t('Croatian public holidays 2026', () => {
  const d = L.days(2026, 'HR'), off = d.filter((x) => x.kind === 'off').map((x) => x.date);
  assert.deepStrictEqual(off, ['2026-01-01', '2026-01-06', '2026-04-05', '2026-04-06', '2026-05-01', '2026-05-30', '2026-06-04', '2026-06-22', '2026-08-05', '2026-08-15', '2026-11-01', '2026-11-18', '2026-12-25', '2026-12-26']);
  assert.strictEqual(by(d, 'Tijelovo').date, '2026-06-04');
  assert.strictEqual(by(d, 'Majčin dan').date, '2026-05-10');
});
t('upcoming crosses the year end; holidayOn', () => {
  const u = L.upcoming('2026-12-20', 20, 'SI').map((x) => x.date);
  assert.deepStrictEqual(u, ['2026-12-24', '2026-12-25', '2026-12-26', '2026-12-31', '2027-01-01', '2027-01-02']);
  assert.strictEqual(L.holidayOn('2026-11-01', 'HR').name, 'Svi sveti');
  assert.strictEqual(L.holidayOn('2026-11-02', 'SI'), null);
  assert.strictEqual(L.fmt('2026-11-01'), '1. 11.');
});
t('holiday posts in Slovenian and Croatian', () => {
  const si = L.post(L.holidayOn('2026-11-01', 'SI'), 'sl', '@vogal');
  assert.strictEqual(si.fields.headline, 'Dan spomina na mrtve');
  assert.ok(/zaprto/.test(si.fields.sub));
  assert.strictEqual(si.fields.handle, '@vogal');
  assert.strictEqual(si.fields.badge, '1. 11.');
  const hr = L.post(L.holidayOn('2026-12-25', 'HR'), 'hr');
  assert.strictEqual(hr.fields.headline, 'Sretan Božić!');
  assert.ok(/#hrvatska/.test(hr.caption));
  const bf = L.post(L.holidayOn('2026-11-27', 'SI'), 'sl');
  assert.strictEqual(bf.fields.cta, 'Več o tem');
});
t('SL/HR example texts exist for every layout', () => {
  const layouts = ['bold', 'clean', 'photo', 'spot', 'quote', 'event', 'stat', 'frame', 'menu', 'hours', 'steps'];
  ['sl', 'hr'].forEach((lg) => layouts.forEach((id) => {
    const x = L.SAMPLES[lg][id];
    assert.ok(x && x.headline, lg + ' ' + id);
    ['badge', 'headline', 'sub', 'cta', 'handle', 'list'].forEach((k) => assert.strictEqual(typeof x[k], 'string', lg + ' ' + id + ' ' + k));
  }));
  assert.ok(/€/.test(L.SAMPLES.sl.menu.list) && /4,50 €/.test(L.SAMPLES.hr.menu.list), 'Slovenian/Croatian prices');
  assert.strictEqual(L.langOf('Slovenian'), 'sl');
  assert.strictEqual(L.langOf(''), 'en');
});

// ── pictures out of localStorage ─────────────────────────────────────────
const pic = 'data:image/jpeg;base64,' + 'A'.repeat(500);
const pic2 = 'data:image/png;base64,' + 'B'.repeat(800);
t('externalize swaps pictures for small references, once per picture', () => {
  const saved = {};
  const put = (k, v) => { saved[k] = (saved[k] || 0) + 1; };
  const st = { photo: pic, logo: pic2, extras: [{ id: 'a', kind: 'image', src: pic }, { id: 'b', kind: 'text', text: 'data:image/png;base64,short' }], fields: { headline: 'x' } };
  const out = P.externalize(st, put);
  assert.ok(P.isRef(out.photo) && P.isRef(out.logo) && P.isRef(out.extras[0].src));
  assert.strictEqual(out.photo, out.extras[0].src, 'same picture → same key');
  assert.strictEqual(out.extras[1].text, 'data:image/png;base64,short', 'short strings are not pictures');
  assert.strictEqual(st.photo, pic, 'the original is not changed');
  assert.ok(JSON.stringify(out).length < 300);
  assert.deepStrictEqual(Object.keys(P.refsIn(JSON.stringify(out))).sort(), Object.keys(saved).sort());
});
t('hash is stable and tells pictures apart', () => {
  assert.strictEqual(P.hash(pic), P.hash(pic));
  assert.notStrictEqual(P.hash(pic), P.hash(pic + 'A'));
  assert.notStrictEqual(P.hash(pic), P.hash(pic2));
});
const roundTrip = t('internalize brings the pictures back; a missing one becomes null; old saves pass through', () => {
  const store = {};
  const out = P.externalize({ photo: pic, plan: [{ design: { photo: pic2 } }] }, (k, v) => { store[k] = v; });
  return Promise.all([
    P.internalize(out, (k) => Promise.resolve(store[k])).then((back) => assert.deepStrictEqual(back, { photo: pic, plan: [{ design: { photo: pic2 } }] })),
    P.internalize({ photo: 'pbimg:missing' }, () => Promise.resolve(null)).then((x) => assert.strictEqual(x.photo, null)),
    P.internalize({ photo: pic, n: 3, s: null }, () => { throw new Error('not called'); }).then((x) => assert.deepStrictEqual(x, { photo: pic, n: 3, s: null }))
  ]);
});
roundTrip.then(() => console.log('\nall ' + n + ' postbench tests passed'), (e) => { console.error(e); process.exit(1); });
