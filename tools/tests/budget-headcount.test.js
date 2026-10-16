// Tests for Budget vs actual: the headcount plan, the "always explain above X €" rule and board-pack comments in
// Slovenian and Croatian. Run: node tools/tests/budget-headcount.test.js
'use strict';
const assert = require('assert');
const path = require('path');
const E = require(path.join(__dirname, '../../site/budget/engine.js'));
const D = require(path.join(__dirname, '../../site/budget/data.js'));

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok', n, name); }
const eur = (x) => Math.round(x * 100);
const sum = (a) => a.reduce((s, x) => s + x, 0);

// ── headcount ──────────────────────────────────────────────────────────────
t('employer contribution defaults: Slovenia 16,10 % + 1 % long-term care = 17,10 %, Croatia 16,5 %', () => {
  assert.strictEqual(E.CONTRIB.SI, 17.1);
  assert.strictEqual(E.CONTRIB.HR, 16.5);
  assert.strictEqual(Math.round((8.85 + 6.56 + 0.53 + 0.10 + 0.06) * 100) / 100, 16.1); // the parts of the 16,10 %
});

t('active months: from and until are inclusive, empty means open, other years count', () => {
  assert.deepStrictEqual(E.activeMonths({ from: '2026-04', to: '' }, 2026), [0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
  assert.deepStrictEqual(E.activeMonths({ from: '', to: '2026-02' }, 2026), [1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepStrictEqual(E.activeMonths({ from: '2025-06', to: '2027-01' }, 2026), Array(12).fill(1));
  assert.deepStrictEqual(E.activeMonths({ from: '2027-01', to: '' }, 2026), Array(12).fill(0));
  assert.deepStrictEqual(E.activeMonths({ from: '2026-05', to: '2026-05' }, 2026), [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]);
});

t('headcount cost: gross × FTE, contributions by country, allowances, holiday allowance, other costs; ties out per month', () => {
  const rows = [
    { id: 'a', role: 'Warehouse', country: 'SI', fte: 3, gross: eur(1650), allow: eur(200), from: '', to: '' },
    { id: 'b', role: 'Rep Split', country: 'HR', fte: 1, gross: eur(2400), allow: eur(150), from: '2026-04', to: '' },
    { id: 'c', role: 'Half-time', country: 'SI', fte: 0.5, gross: eur(2000.01), allow: 0, from: '2026-01', to: '2026-06' }
  ];
  const c = E.headcountCost(rows, 2026, { rates: E.CONTRIB, holiday: eur(1300), holidayMonth: 6, other: eur(12000) });
  // January: warehouse 3 × 1.650 + half-time 1.000,005 → 1.000,01 €
  assert.strictEqual(c.gross[0], eur(4950) + 100001);
  assert.strictEqual(c.contrib[0], Math.round(eur(4950) * 0.171) + Math.round(100001 * 0.171));
  assert.strictEqual(c.allow[0], eur(600));
  assert.strictEqual(c.fte[0], 3.5);
  // April: the Croatian rep starts, with 16,5 %
  assert.strictEqual(c.rows[1].contrib[3], Math.round(eur(2400) * 0.165));
  assert.strictEqual(c.rows[1].total[2], 0);
  assert.strictEqual(c.fte[3], 4.5);
  // June: holiday allowance to everyone working, per FTE; July: the half-timer has left
  assert.strictEqual(c.holiday[5], eur(1300) * 4.5);
  assert.strictEqual(c.holiday[6], 0);
  assert.strictEqual(c.fte[6], 4);
  // other staff costs: spread evenly in whole euros
  assert.strictEqual(sum(c.other), eur(12000));
  assert.ok(c.other.every((x) => x === eur(1000)));
  for (let i = 0; i < 12; i++) assert.strictEqual(c.total[i], c.gross[i] + c.contrib[i] + c.allow[i] + c.holiday[i] + c.other[i], 'month ' + (i + 1));
  assert.strictEqual(sum(c.rows.map((r) => r.year)) + eur(12000), sum(c.total));
  // zero FTE or nobody: nothing
  assert.strictEqual(sum(E.headcountCost([{ country: 'SI', fte: 0, gross: eur(5000) }], 2026).total), 0);
  assert.strictEqual(sum(E.headcountCost([], 2026).total), 0);
});

t('the demo headcount explains most of the personnel budget, and the new hires start when the budget says', () => {
  const db = D.generate('2026-10-13'), hc = db.headcount;
  const c = E.headcountCost(hc.rows, db.year, hc);
  const bud = sum(db.versions[0].values.personnel), plan = sum(c.total);
  assert.ok(Math.abs(plan - bud) / bud < 0.06, 'plan ' + plan + ' vs budget ' + bud);
  assert.ok(c.fte[0] < c.fte[3], 'hires during the year');
  assert.ok(hc.rows.some((r) => r.country === 'HR'));
  hc.rows.forEach((r) => { assert.ok(r.gross > 0 && r.fte > 0 && r.role); assert.ok(Number.isInteger(r.gross)); });
});

// ── always explain above X € ───────────────────────────────────────────────
t('always explain above X €: a big variance with a small percentage is flagged, marked why', () => {
  // €60.000 under on a €1,2M line is 5 %: under the 10 % rule, over the €40.000 rule
  assert.strictEqual(E.isFlagged(eur(1140000), eur(1200000), 10, eur(5000)), false);
  assert.strictEqual(E.isFlagged(eur(1140000), eur(1200000), 10, eur(5000), eur(40000)), true);
  assert.strictEqual(E.isFlagged(eur(1170000), eur(1200000), 10, eur(5000), eur(40000)), false);
  assert.strictEqual(E.isFlagged(eur(1160000), eur(1200000), 10, eur(5000), eur(40000)), true); // exactly €40.000
  assert.strictEqual(E.isFlagged(eur(100), eur(100), 10, 0, 1), false);                          // no difference
  const a = { sales_si: Array(12).fill(eur(1140000)), it: [eur(16000)].concat(Array(11).fill(0)) };
  const b = { sales_si: Array(12).fill(eur(1200000)), it: [eur(10000)].concat(Array(11).fill(0)) };
  const th = { pct: 10, monthAbs: eur(5000), ytdAbs: eur(10000) };
  const off = E.flags(E.rowsOf(a), E.rowsOf(b), 2, th);
  assert.deepStrictEqual(off.map((f) => f.line + f.scope + f.month), ['itmonth1']);
  assert.strictEqual(off[0].why, 'threshold');
  const on = E.flags(E.rowsOf(a), E.rowsOf(b), 2, Object.assign({ always: eur(40000) }, th));
  assert.deepStrictEqual(on.map((f) => f.line + f.scope + f.month + ':' + f.why), ['sales_simonth1:always', 'sales_simonth2:always', 'sales_siytd2:always', 'itmonth1:threshold']);
});

t('the demo turns the rule on at €40.000, so the largest year-to-date variance needs a comment', () => {
  const db = D.generate('2026-10-13'), y = db.year, c = 9;
  assert.strictEqual(db.settings.alwaysAbs, 40000);
  const A = E.rowsOf(E.aggregate(db.actuals[y], db.accounts).lines), B = E.rowsOf(db.versions[0].values);
  const th = { pct: db.settings.pct, monthAbs: eur(db.settings.monthAbs), ytdAbs: eur(db.settings.ytdAbs), always: eur(db.settings.alwaysAbs) };
  const fl = E.flags(A, B, c, th), ytd = fl.filter((f) => f.scope === 'ytd');
  const biggest = E.LINES.map((l) => ({ id: l.id, d: Math.abs(E.sumRange(A[l.id], 1, c) - E.sumRange(B[l.id], 1, c)) })).sort((x, z) => z.d - x.d)[0];
  assert.ok(ytd.some((f) => f.line === biggest.id), 'the biggest variance (' + biggest.id + ') is flagged');
  assert.ok(fl.some((f) => f.why === 'always'));
});

// ── comments in the pack's languages ───────────────────────────────────────
t('comment text by language: its own language, a translation, or the original marked as not translated', () => {
  const cm = { text: 'Wet July.', lang: 'en', texts: { sl: 'Deževen julij.', hr: '  ' } };
  assert.deepStrictEqual(E.commentText(cm, 'en'), { text: 'Wet July.', lang: 'en', inLang: true });
  assert.deepStrictEqual(E.commentText(cm, 'sl'), { text: 'Deževen julij.', lang: 'sl', inLang: true });
  assert.deepStrictEqual(E.commentText(cm, 'hr'), { text: 'Wet July.', lang: 'en', inLang: false }); // blank = none
  const sl = { text: 'Zamik zaposlitev.', lang: 'sl', texts: {} };
  assert.strictEqual(E.commentText(sl, 'sl').inLang, true);
  assert.deepStrictEqual(E.commentText(sl, 'en'), { text: 'Zamik zaposlitev.', lang: 'sl', inLang: false });
  assert.strictEqual(E.commentText({ text: 'Old comment' }, 'en').inLang, true); // comments made before: English
});

t('every demo comment has Slovenian and Croatian text for the board pack', () => {
  const db = D.generate('2026-10-13');
  assert.ok(db.comments.length >= 6);
  db.comments.forEach((cm) => {
    assert.strictEqual(cm.lang, 'en');
    ['sl', 'hr'].forEach((k) => {
      const ct = E.commentText(cm, k);
      assert.ok(ct.inLang && ct.text.length > 20 && ct.text !== cm.text, cm.id + ' ' + k);
    });
  });
  assert.ok(db.comments.some((cm) => /[čšž]/.test(cm.texts.sl)) && db.comments.some((cm) => /[čćđšž]/.test(cm.texts.hr)));
});

console.log(n + ' tests passed');
