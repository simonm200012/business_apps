// Tests for site/erp/data.js against the Store daily board (site/stores/data.js) and the Data health check's validators.
// Run: node tools/tests/erp-data.test.js
'use strict';
const assert = require('assert');
const path = require('path');
global.window = {};
require(path.join(__dirname, '../../site/stores/data.js'));
require(path.join(__dirname, '../../site/erp/data.js'));
const SD = window.StoresData, D = window.ERPData;
const B = require(path.join(__dirname, '../../site/erp/barcode.js'));
const DC = require(path.join(__dirname, '../../site/datacheck/engine.js'));

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok', n, name); }
const TODAY = '2026-10-15', db = D.generate(TODAY);

t('the ERP stores are the Store board stores (ids, names, cities, countries)', () => {
  const stores = D.LOCATIONS.filter((l) => l.kind === 'store');
  assert.strictEqual(stores.length, SD.STORES.length);
  SD.STORES.forEach((s, i) => {
    assert.strictEqual(stores[i].id, s.id);
    assert.strictEqual(stores[i].short, s.name);
    assert.strictEqual(stores[i].city, s.city);
    assert.strictEqual(stores[i].country, s.country);
  });
  Object.keys(D.LEGACY_IDS).forEach((k) => assert.ok(SD.byId[D.LEGACY_IDS[k]], k));
  D.CLOSED_LOCATIONS.forEach((l) => assert.ok(l.closed && !SD.byId[l.id]));
});

t('till postings carry the Store board day: gross = its revenue, VAT by country, closed days empty', () => {
  ['LJ-EAS', 'ZG-WES', 'KP'].forEach((id) => {
    const d = SD.day(id, '2026-10-14'), tl = D.tillDay(id, '2026-10-14'), rate = SD.byId[id].country === 'SI' ? 22 : 25;
    assert.strictEqual(tl.gross, d.revenue);
    assert.strictEqual(tl.receipts, d.receipts);
    assert.strictEqual(tl.rate, rate);
    assert.ok(Math.abs(tl.net * (1 + rate / 100) - tl.gross) < 0.01);
    assert.ok(Math.abs(tl.net + tl.vat - tl.gross) < 0.005);
    assert.ok(Math.abs(tl.cash + tl.card - tl.gross) < 0.02);
    assert.ok(tl.cogs > 0 && tl.cogs < tl.net);
  });
  assert.strictEqual(D.tillDay('LJ-EAS', '2026-10-11'), null);       // a Sunday
  assert.strictEqual(D.tillDay('LJ-CEN', '2026-11-01'), null);       // All Saints' Day
  assert.strictEqual(D.tillDay('WH', '2026-10-14'), null);
  assert.strictEqual(D.tillDay('HR-ZD', '2026-10-14'), null);
});

t('generated store sales happen only on the Store board\'s open days and are flagged as till receipts', () => {
  const store = {};
  D.LOCATIONS.forEach((l) => { store[l.id] = l.kind === 'store'; });
  const soStore = db.sos.filter((s) => store[s.loc]);
  assert.ok(soStore.length > 500);
  soStore.forEach((s) => assert.ok(SD.hours(s.loc, s.date), s.no + ' on a closed day'));
  db.invoices.forEach((i) => assert.strictEqual(!!i.till, !!store[i.loc], i.no));
});

t('every product has a unique, valid EAN-13 in the in-store range (prefix 20)', () => {
  const seen = {};
  db.products.forEach((p) => {
    assert.ok(B.valid(p.ean) && /^20\d{11}$/.test(p.ean), p.sku + ' ' + p.ean);
    assert.ok(!seen[p.ean]); seen[p.ean] = 1;
    assert.strictEqual(D.util.eanFor(p), p.ean);
  });
  assert.strictEqual(D.util.eanCheck('400638133393'), B.check('400638133393'));
});

t('invoices carry a date of supply on or before the invoice date', () => {
  db.invoices.forEach((i) => assert.ok(i.supply && i.supply <= i.date, i.no));
  assert.ok(db.invoices.some((i) => i.supply < i.date)); // B2B invoices issued after delivery
});

t('customers: real postal codes, valid demo VAT IDs and 8-digit numbers, with a few planted problems', () => {
  const cs = db.customers.filter((c) => !c.walkIn), problems = [];
  cs.forEach((c) => {
    assert.ok(c.street && c.address && c.city, c.name);
    if (c.vatId) { const v = DC.vatCheck(c.vatId, c.country); if (!v.ok) problems.push('vat'); else assert.ok(/^(SI99|HR99)/.test(c.vatId), c.vatId); }
    if (!DC.phoneCheck(c.phone, c.country).ok) problems.push('phone');
    const po = DC.postOffice(c.country, c.postal);
    if (!po) problems.push('postal'); else if (po.name.toLowerCase() !== c.city.toLowerCase()) problems.push('city');
    if (!c.email) problems.push('email');
    assert.ok(/^\+38[56] 1 000 /.test(c.phone), c.phone);
  });
  assert.deepStrictEqual(problems.sort(), ['city', 'email', 'phone', 'postal', 'vat', 'vat']);
  assert.ok(cs.filter((c) => c.type === 'B2B').every((c) => c.vatId));
});

t('company bank details are clearly demo (IBAN check digits 00)', () => {
  assert.ok(/^SI00/.test(D.COMPANIES.SI.iban) && /^HR00/.test(D.COMPANIES.HR.iban));
});

console.log('\nerp-data: all ' + n + ' tests passed');
