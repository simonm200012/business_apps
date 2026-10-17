// Home page: every app linked on site/index.html has an entry in site/_shared/app-sheets.js (the sales sheet of the
// list view) and the other way round, and each entry is complete. Run: node tools/tests/home-sheets.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const html = fs.readFileSync(path.join(ROOT, 'site/index.html'), 'utf8');
const SHEETS = require(path.join(ROOT, 'site/_shared/app-sheets.js'));
const ids = [...html.matchAll(/<article class="card" data-app="([^"]+)"/g)].map((m) => m[1]);
let n = 0;
function t(name, fn) { fn(); n++; console.log('ok', n, name); }

t('the home page lists apps, each once', () => {
  assert.ok(ids.length >= 30);
  assert.strictEqual(new Set(ids).size, ids.length);
});
t('every app on the home page has a sheet', () => {
  assert.deepStrictEqual(ids.filter((id) => !SHEETS[id]), []);
});
t('no sheet is left over for an app that is not on the home page', () => {
  assert.deepStrictEqual(Object.keys(SHEETS).filter((id) => !ids.includes(id)), []);
});
t('every sheet is complete', () => {
  for (const id of ids) {
    const s = SHEETS[id];
    for (const k of ['short', 'what', 'who', 'problem', 'pitch']) assert.ok(typeof s[k] === 'string' && s[k].trim(), id + '.' + k);
    assert.ok(Array.isArray(s.features) && s.features.length > 0 && s.features.every((f) => typeof f === 'string' && f.trim()), id + '.features');
  }
});
t('the sheet script and the list container are in the page', () => {
  assert.ok(html.includes('/_shared/app-sheets.js'));
  assert.ok(html.includes('id="bList"') && html.includes('id="bSheet"'));
});

t('the shared sheet panel script is loaded by the page and every look uses it', () => {
  assert.ok(html.includes('/_shared/app-sheet-panel.js'));
  const panel = fs.readFileSync(path.join(ROOT, 'site/_shared/app-sheet-panel.js'), 'utf8');
  assert.ok(panel.includes('sheetHtml') && panel.includes('adjustBand'));
  for (const look of ['appstore', 'raycast', 'arc', 'odoo', 'classic']) {
    const js = fs.readFileSync(path.join(ROOT, 'site/home-looks/' + look + '.js'), 'utf8');
    assert.ok(js.includes('AppSheetPanel') && js.includes('data-sp-open') || js.includes('cardButtons'), look + '.js uses the shared panel');
    assert.ok(js.includes('adjustBand'), look + '.js shows the adjust band');
    const css = fs.readFileSync(path.join(ROOT, 'site/home-looks/' + look + '.css'), 'utf8');
    assert.ok(css.includes('.sp-pane') && css.includes('.sp-adj'), look + '.css styles the panel');
  }
});
t('the adjust texts live only in the shared panel script', () => {
  assert.ok(!html.includes('Every app can be adjusted for your company'));
});
