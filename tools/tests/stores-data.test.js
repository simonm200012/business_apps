// Tests for site/stores/data.js: staff cost as a share of sales, safe demo phone numbers. Run: node tools/tests/stores-data.test.js
'use strict';
const assert = require('assert');
const path = require('path');
global.window = {};
require(path.join(__dirname, '../../site/stores/data.js'));
const D = window.StoresData;
const DC = require(path.join(__dirname, '../../site/datacheck/engine.js'));

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok', n, name); }

t('staff cost = clocked hours × role rate, against sales net of VAT', () => {
  ['LJ-EAS', 'ZG-WES'].forEach((id) => {
    const date = '2026-10-14', s = D.byId[id], c = D.staffCost(id, date);
    let hours = 0, cost = 0;
    D.attendance(id, date).forEach((a) => { if (a.absent) return; const p = D.staffById(a.staffId); hours += a.actual; cost += a.actual * D.HOURLY_COST[s.country][p.role]; });
    assert.ok(Math.abs(c.cost - cost) < 0.01 && Math.abs(c.hours - hours) < 0.01);
    assert.ok(Math.abs(c.net - D.day(id, date).revenue / (1 + D.VAT[s.country] / 100)) < 0.01);
    assert.ok(Math.abs(c.share - c.cost / c.net) < 1e-4);
  });
  const closed = D.staffCost('LJ-EAS', '2026-10-11'); // Sunday
  assert.strictEqual(closed.open, false); assert.strictEqual(closed.share, null);
});

t('staff cost stays in a plausible band for optical retail (10–30 % of net sales over a month)', () => {
  D.STORES.forEach((s) => {
    let c = 0, net = 0;
    for (let d = '2026-09-01'; d <= '2026-09-30'; d = D.util.addDays(d, 1)) { const x = D.staffCost(s.id, d); c += x.cost; net += x.net; }
    assert.ok(c / net > 0.1 && c / net < 0.3, s.id + ' ' + (c / net));
  });
});

t('pickup phone numbers are fictional fixed-line numbers with a valid length', () => {
  D.STORES.forEach((s) => D.workOrders(s.id, '2026-10-14').slice(-40).forEach((w) => {
    assert.ok(/^\+38[56] 1 000 \d{4}$/.test(w.phone), w.phone);
    assert.ok(DC.phoneCheck(w.phone, s.country).ok, w.phone);
  }));
});

t('work orders are unchanged apart from the phone number (same random draws)', () => {
  const w = D.workOrders('KP', '2026-10-14').find((x) => x.id === 'WO-KOP-260902-06');
  assert.ok(w && w.kind === 'Prescription sunglasses' && w.customer === 'Matej B.');
});

t('seeded tasks ask for photo proof on the window display', () => {
  const st = D.initialState('2026-10-15');
  assert.ok(st.tasks.find((x) => x.id === 't1').photo === true);
  assert.deepStrictEqual(st.photos, {});
});

console.log('\nstores-data: all ' + n + ' tests passed');
