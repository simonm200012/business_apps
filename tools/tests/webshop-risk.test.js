// Tests for site/webshop/risk.js (revenue at risk, content pages). Run: node tools/tests/webshop-risk.test.js
'use strict';
const assert = require('assert');
const path = require('path');
const R = require(path.join(__dirname, '../../site/webshop/risk.js'));

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok', n, name); }
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, a + ' ≈ ' + b);

t('content pages: blog, help and friends, in several languages', () => {
  ['/blog/how-to-insert-lenses', '/help/returns', '/blog', '/pomoc/dostava', '/pomoć/povrat', '/faq', '/nasveti/suhe-oci', '/savjeti/leće', '/it/blog/occhiali', '/sl-si/help/delivery', '/novice/akcija?utm=x'].forEach((p) => assert.ok(R.isContentPage(p), p));
  ['/', '/sunglasses', '/products/blog-frame-x', '/promo/black-week-preview', '/helpdesk-stand', '(not set)', '(other pages)', '', null].forEach((p) => assert.ok(!R.isContentPage(p), String(p)));
});

const ROWS = [
  { shop: 'si', page: '/sunglasses', sessions: 1000, transactions: 20, revenue: 2000 },
  { shop: 'si', page: '/promo/x', sessions: 500, transactions: 0, revenue: 0 },
  { shop: 'si', page: '/blog/tips', sessions: 800, transactions: 0, revenue: 0 },
  { shop: 'si', page: '(not set)', sessions: 300, transactions: 30, revenue: 9000 },
  { shop: 'hr', page: '/', sessions: 200, transactions: 4, revenue: 300 },
];

t('filter pages', () => {
  assert.strictEqual(R.filterPages(ROWS, 'all').length, 5);
  assert.deepStrictEqual(R.filterPages(ROWS, 'content').map((r) => r.page), ['/blog/tips']);
  assert.strictEqual(R.filterPages(ROWS, 'shop').length, 4);
});

t('usual revenue per session counts shop pages only', () => {
  const m = R.shopRps(ROWS);
  near(m.get('si'), 2000 / 1500); // blog and "(not set)" left out
  near(m.get('hr'), 1.5);
  assert.strictEqual(m.has('it'), false);
});

t('no-sale pages, drops, browsers, conversion drops', () => {
  const rps = R.shopRps(ROWS).get('si');
  near(R.noSaleRisk(ROWS[1], rps), 500 * rps);
  assert.strictEqual(R.noSaleRisk(ROWS[2], rps), 0); // blog
  assert.strictEqual(R.noSaleRisk(ROWS[0], rps), 0); // sells
  assert.strictEqual(R.noSaleRisk(ROWS[1], null), 0);
  assert.strictEqual(R.dropRisk({ page: '/a', d_revenue: -350 }), 350);
  assert.strictEqual(R.dropRisk({ page: '/a', d_revenue: 120 }), 0);
  assert.strictEqual(R.dropRisk({ page: '/help/x', d_revenue: -350 }), 0);
  assert.strictEqual(R.browserRisk({ flag: 'broken', missing: 12.5 }, 80), 1000);
  assert.strictEqual(R.browserRisk({ flag: 'low', missing: 2 }, 50), 100);
  assert.strictEqual(R.browserRisk({ flag: 'high', missing: -5 }, 50), 0);
  assert.strictEqual(R.browserRisk({ flag: 'ok', missing: 3 }, 50), 0);
  near(R.convDropRisk(10000, 0.02, 0.015, 80), 0.005 * 10000 * 80);
  assert.strictEqual(R.convDropRisk(10000, 0.015, 0.02, 80), 0);
  assert.strictEqual(R.convDropRisk(10000, null, 0.02, 80), 0);
});

t('ranking: one amount per issue, largest first, with the total', () => {
  const r = R.rank([{ key: 'a', eur: 100 }, { key: 'b', eur: 300 }, { key: 'a', eur: 250 }, { key: 'c', eur: 0 }, { key: 'd', eur: NaN }]);
  assert.deepStrictEqual(r.list.map((x) => [x.key, x.eur]), [['b', 300], ['a', 250]]);
  assert.strictEqual(r.total, 550);
});

console.log(n + ' tests passed');
