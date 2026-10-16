// Tests for site/budget/engine.js and data.js. Run: node tools/tests/budget-engine.test.js
'use strict';
const assert = require('assert');
const path = require('path');
const E = require(path.join(__dirname, '../../site/budget/engine.js'));
const D = require(path.join(__dirname, '../../site/budget/data.js'));

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok', n, name); }
const eur = (x) => Math.round(x * 100); // euros → cents
const sum = (a) => a.reduce((s, x) => s + x, 0);
function seeded(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let x = Math.imul(a ^ (a >>> 15), 1 | a); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; }
const ACC = [
  { code: '7600', line: 'sales_si', kind: 'income' }, { code: '7609', line: 'sales_si', kind: 'income' },
  { code: '7610', line: 'sales_hr', kind: 'income' }, { code: '4000', line: 'cogs', kind: 'cost' },
  { code: '4009', line: 'cogs', kind: 'cost' }, { code: '4100', line: 'freight', kind: 'cost' },
  { code: '4200', line: 'personnel', kind: 'cost' }, { code: '4850', line: 'da', kind: 'cost' },
  { code: '7700', line: 'fin', kind: 'income' }, { code: '4900', line: 'fin', kind: 'cost' }
];
function arr(v, m) { const a = E.zeros(); a[(m || 1) - 1] = v; return a; }

// ── structure ──────────────────────────────────────────────────────────────
t('P&L structure: 17 lines, typed, and the display order ends with profit before tax', () => {
  assert.strictEqual(E.LINES.length, 17);
  E.LINES.forEach((l) => assert.ok(l.type === 'income' || l.type === 'cost', l.id));
  assert.strictEqual(E.LINE.fin.type, 'income');
  assert.strictEqual(E.LINE.cogs.type, 'cost');
  const ids = E.ROWS.map((r) => r.id);
  assert.deepStrictEqual(ids.filter((id) => E.SUB[id]), ['rev', 'cos', 'gm', 'opex', 'ebitda', 'ebit', 'pbt']);
  assert.strictEqual(ids[ids.length - 1], 'pbt');
  assert.ok(ids.indexOf('gm_pct') === ids.indexOf('gm') + 1 && ids.indexOf('ebitda_pct') === ids.indexOf('ebitda') + 1);
});

t('demo chart of accounts: Slovenian kontni okvir, classes 4 and 7, 70–75 expenses and 76–78 income, 1–6 accounts per line', () => {
  const accs = D.accountsList();
  accs.forEach((a) => {
    assert.ok(/^[47]\d{3}$/.test(a.code), a.code);
    assert.ok(a.code.slice(0, 2) !== '49', 'no cost transfers: ' + a.code);
    assert.strictEqual(a.kind, a.code[0] === '7' && a.code[1] >= '6' ? 'income' : 'cost', a.code);
    assert.ok(E.siClass(a.code).pl, a.code);
    assert.ok(E.LINE[a.line], a.line);
  });
  const by = Object.fromEntries(accs.map((a) => [a.code, a]));
  assert.strictEqual(by['7020'].line, 'cogs');        // 702 cost of goods sold
  assert.strictEqual(by['4700'].line, 'personnel');   // 470 salaries
  assert.strictEqual(by['7420'].kind, 'cost');        // 742 interest, inside the (income-type) financial result
  assert.strictEqual(by['7710'].kind, 'income');
  E.LINES.forEach((l) => { const k = accs.filter((a) => a.line === l.id).length; assert.ok(k >= 1 && k <= 6, l.id + ' has ' + k); });
  assert.strictEqual(new Set(accs.map((a) => a.code)).size, accs.length);
});

// ── aggregation, subtotals and signs ─────────────────────────────────────
t('aggregation: accounts → lines, with an interest expense counting against an income line', () => {
  const acts = {
    7600: arr(eur(100000)), 7609: arr(-eur(2000)), 7610: arr(eur(30000)), 4000: arr(eur(70000)), 4009: arr(-eur(1000)),
    4100: arr(eur(2500)), 4200: arr(eur(15000)), 4850: arr(eur(4000)), 7700: arr(eur(100)), 4900: arr(eur(900)), 9999: arr(eur(5))
  };
  const ag = E.aggregate(acts, ACC);
  assert.deepStrictEqual(ag.unmapped, ['9999']);
  const L = ag.lines;
  assert.strictEqual(L.sales_si[0], eur(98000));
  assert.strictEqual(L.cogs[0], eur(69000));
  assert.strictEqual(L.fin[0], -eur(800)); // 100 interest income − 900 interest expense
  const r = E.rowsOf(L);
  assert.strictEqual(r.rev[0], eur(128000));
  assert.strictEqual(r.cos[0], eur(71500));
  assert.strictEqual(r.gm[0], eur(56500));
  assert.strictEqual(r.opex[0], eur(15000));
  assert.strictEqual(r.ebitda[0], eur(41500));
  assert.strictEqual(r.ebit[0], eur(37500));
  assert.strictEqual(r.pbt[0], eur(36700));
  assert.strictEqual(r.rev[1], 0);
});

t('subtotals are computed from lines for every month and always tie out', () => {
  const db = D.generate('2026-10-13');
  const r = E.rowsOf(E.aggregate(db.actuals[db.year - 1], db.accounts).lines);
  for (let i = 0; i < 12; i++) {
    const rev = r.sales_si[i] + r.sales_hr[i] + r.sales_eu[i] + r.other_inc[i];
    const opex = ['personnel', 'rent', 'vehicles', 'marketing', 'it', 'prof', 'travel', 'insurance', 'other_cost'].reduce((s, id) => s + r[id][i], 0);
    assert.strictEqual(r.rev[i], rev);
    assert.strictEqual(r.gm[i], rev - r.cogs[i] - r.freight[i]);
    assert.strictEqual(r.ebitda[i], r.gm[i] - opex);
    assert.strictEqual(r.pbt[i], r.ebitda[i] - r.da[i] + r.fin[i]);
  }
  db.versions.forEach((v) => Object.keys(v.values).forEach((k) => assert.ok(E.LINE[k], 'only lines are stored: ' + k)));
});

t('sign logic: income higher is good, cost lower is good, no difference is neither', () => {
  assert.strictEqual(E.variance(110, 100, 'income').fav, true);
  assert.strictEqual(E.variance(90, 100, 'income').fav, false);
  assert.strictEqual(E.variance(110, 100, 'cost').fav, false);
  assert.strictEqual(E.variance(90, 100, 'cost').fav, true);
  assert.strictEqual(E.variance(100, 100, 'cost').fav, null);
  assert.strictEqual(E.variance(-80, -100, 'income').fav, true); // net financial result less negative
  assert.strictEqual(E.typeOf('opex'), 'cost');
  assert.strictEqual(E.typeOf('ebitda'), 'income');
  assert.strictEqual(E.profitEffect('personnel', 500), -500);
  assert.strictEqual(E.profitEffect('sales_hr', 500), 500);
});

t('percent variances: zero budgets, negative bases, share of revenue', () => {
  assert.strictEqual(E.pctVar(0, 0), 0);
  assert.strictEqual(E.pctVar(500, 0), null);
  assert.strictEqual(E.pctVar(-500, 0), null);
  assert.strictEqual(E.pctVar(110, 100), 10);
  assert.strictEqual(E.pctVar(-90, -100), 10);   // the sign follows the difference
  assert.strictEqual(E.pctVar(-110, -100), -10);
  assert.strictEqual(E.share(25, 100), 25);
  assert.strictEqual(E.share(25, 0), null);
});

t('needs-an-explanation flags: both thresholds, at the edge, and against a zero budget', () => {
  const pct = 10, abs = eur(10000);
  assert.strictEqual(E.isFlagged(eur(110000), eur(100000), pct, abs), true);   // exactly 10 % and €10.000
  assert.strictEqual(E.isFlagged(eur(109999.99), eur(100000), pct, abs), false);
  assert.strictEqual(E.isFlagged(eur(90000), eur(100000), pct, abs), true);   // under budget counts too
  assert.strictEqual(E.isFlagged(eur(58000), eur(50000), pct, abs), false);   // 16 % but only €8.000
  assert.strictEqual(E.isFlagged(eur(1210000), eur(1100000), pct, abs), true);
  assert.strictEqual(E.isFlagged(eur(1200000), eur(1100000), pct, abs), false); // €100.000 but 9,1 %
  assert.strictEqual(E.isFlagged(eur(12000), 0, pct, abs), true);              // zero budget: the amount decides
  assert.strictEqual(E.isFlagged(eur(9000), 0, pct, abs), false);
  assert.strictEqual(E.isFlagged(0, 0, pct, abs), false);
  const a = { it: [eur(10000), eur(16000), eur(9000)].concat(Array(9).fill(0)) };
  const b = { it: [eur(10000), eur(10000), eur(10000)].concat(Array(9).fill(0)) };
  const f = E.flags(E.rowsOf(a), E.rowsOf(b), 3, { pct: 10, monthAbs: eur(5000), ytdAbs: eur(10000) });
  assert.deepStrictEqual(f.map((x) => x.scope + x.month), ['month2']); // YTD +5.000 is under €10.000
  assert.strictEqual(f[0].fav, false);
  assert.strictEqual(E.flags(E.rowsOf(a), E.rowsOf(b), 0, { pct: 10, monthAbs: 1, ytdAbs: 1 }).length, 0);
});

// ── periods and outlook ───────────────────────────────────────────────────
t('periods: months, quarters cut at the closed month, YTD and full year', () => {
  assert.deepStrictEqual(E.period('quarter', 3, 8), { kind: 'quarter', n: 3, from: 7, to: 8, partial: true });
  assert.deepStrictEqual(E.period('quarter', 2, 8), { kind: 'quarter', n: 2, from: 4, to: 6, partial: false });
  assert.deepStrictEqual(E.period('ytd', 0, 9), { kind: 'ytd', n: 9, from: 1, to: 9, partial: false });
  assert.strictEqual(E.period('month', 5, 9).from, 5);
  assert.strictEqual(E.sumRange([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 1, 0), 0);
});

t('outlook: actuals up to the closed month, then the chosen version', () => {
  const act = {}, bud = {}, fc = {};
  E.LINES.forEach((l) => { act[l.id] = E.zeros().map(() => 1); bud[l.id] = E.zeros().map(() => 2); fc[l.id] = E.zeros().map(() => 3); });
  const ob = E.outlook(act, bud, 9), of = E.outlook(act, fc, 9);
  assert.deepStrictEqual(ob.personnel, [1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2]);
  assert.deepStrictEqual(of.personnel, [1, 1, 1, 1, 1, 1, 1, 1, 1, 3, 3, 3]);
  assert.deepStrictEqual(E.outlook(act, bud, 0).cogs, Array(12).fill(2));
  assert.deepStrictEqual(E.outlook(act, bud, 12).cogs, Array(12).fill(1));
  const db = D.generate('2026-10-13'), y = db.year, c = E.closedFor(y, '2026-10-13', 10);
  const A = E.aggregate(db.actuals[y], db.accounts).lines, B = db.versions[0].values, F = db.versions[1].values;
  const o1 = E.rowsOf(E.outlook(A, B, c)), o2 = E.rowsOf(E.outlook(A, F, c)), ra = E.rowsOf(A);
  assert.strictEqual(E.sumRange(o1.ebitda, 1, c), E.sumRange(ra.ebitda, 1, c));
  assert.strictEqual(E.sumRange(o1.ebitda, c + 1, 12), E.sumRange(E.rowsOf(B).ebitda, c + 1, 12));
  assert.strictEqual(E.sumRange(o2.ebitda, c + 1, 12), E.sumRange(E.rowsOf(F).ebitda, c + 1, 12));
  assert.notStrictEqual(E.total(o1.ebitda), E.total(o2.ebitda));
});

// ── budget tools ───────────────────────────────────────────────────────────
t('largest remainder: any total, any weights, the parts add up to the cent and stay within one unit', () => {
  const r = seeded(42);
  for (let k = 0; k < 400; k++) {
    const total = Math.round((r() - 0.3) * 1e9) * (k % 3 === 0 ? 100 : 1);
    const w = Array.from({ length: 12 }, () => (k % 5 === 0 ? Math.round((r() - 0.4) * 1e6) : Math.round(r() * 1e8)));
    const unit = k % 2 ? 100 : 1;
    const out = E.allocate(total, w, unit), W = sum(w), u = total % unit === 0 ? unit : 1;
    assert.strictEqual(sum(out), total, 'sum at ' + k);
    out.forEach((x, i) => {
      assert.ok(x % u === 0, 'a whole unit at ' + k);
      const target = W === 0 ? total / 12 : total * w[i] / W;
      assert.ok(Math.abs(x - target) < u + 1e-6, 'within one unit at ' + k);
    });
  }
});

t('spread a yearly total evenly: whole euros, leftovers to the first months; cents when the total has cents', () => {
  const a = E.spreadEven(eur(100000), 12);
  assert.deepStrictEqual(a.slice(0, 5), [833400, 833400, 833400, 833400, 833300]);
  assert.strictEqual(sum(a), eur(100000));
  const b = E.spreadEven(eur(1000.01), 12);
  assert.strictEqual(sum(b), 100001);
  assert.ok(b.every((x) => x === 8333 || x === 8334));
  assert.strictEqual(sum(E.spreadEven(-eur(48000.5), 12)), -4800050);
});

t('spread by last year\'s seasonality keeps the shape and the total', () => {
  const ly = [5, 5, 10, 10, 10, 10, 10, 5, 10, 10, 10, 5].map((x) => eur(x * 1000));
  const out = E.spreadSeasonal(eur(120000), ly);
  assert.strictEqual(sum(out), eur(120000));
  assert.strictEqual(out[0], eur(6000));
  assert.strictEqual(out[2], eur(12000));
  assert.deepStrictEqual(E.spreadSeasonal(eur(1200), E.zeros()), Array(12).fill(eur(100))); // no history: even
  const odd = E.spreadSeasonal(eur(1000), [1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepStrictEqual(odd.slice(0, 3), [33400, 33300, 33300]);
});

t('copy last year with growth: the total is last year × (1 + g) in whole euros, the months keep their shape', () => {
  const ly = [101000, 98000, 120050, 130000, 99999, 100001, 87000, 64000, 133300, 145000, 140000, 90000];
  const out = E.copyGrowth(ly, 4.5);
  const expected = Math.round(sum(ly) * 1.045 / 100) * 100;
  assert.strictEqual(sum(out), expected);
  out.forEach((x, i) => { assert.ok(x % 100 === 0); assert.ok(Math.abs(x - ly[i] * 1.045) <= 100); });
  const fin = E.copyGrowth([-400000, -390000, -380000, -370000, -360000, -350000, -340000, -330000, -320000, -310000, -300000, -290000], -10);
  assert.ok(fin.every((x) => x < 0));
  assert.strictEqual(sum(fin), Math.round(-4140000 * 0.9 / 100) * 100);
  assert.deepStrictEqual(E.copyGrowth(E.zeros(), 10), E.zeros());
});

t('a line as % of revenue: marketing at 2 %, cost of goods at a 26 % target margin', () => {
  const rev = [798, 844, 960, 1041, 1157, 1229, 1182, 821, 1303, 1478, 1389, 987].map((k) => eur(k * 1000 + 0.37));
  const mk = E.pctOf(rev, 2);
  assert.strictEqual(sum(mk), Math.round(sum(rev) * 0.02 / 100) * 100);
  mk.forEach((x, i) => assert.ok(Math.abs(x - rev[i] * 0.02) <= 100));
  const cogs = E.pctOf(rev, 100 - 26);
  assert.strictEqual(sum(cogs), Math.round(sum(rev) * 0.74 / 100) * 100);
  const gm = (sum(rev) - sum(cogs)) / sum(rev) * 100;
  assert.ok(Math.abs(gm - 26) < 0.001, 'margin ' + gm);
});

t('typing a new yearly total re-spreads it in the shape of the current months', () => {
  const cur = [10, 20, 30, 40, 0, 0, 0, 0, 0, 0, 0, 0].map((x) => eur(x));
  assert.deepStrictEqual(E.rescale(cur, eur(200)).slice(0, 4), [eur(20), eur(40), eur(60), eur(80)]);
  assert.strictEqual(sum(E.rescale(E.zeros(), eur(1200), E.zeros().map(() => 1))), eur(1200));
});

t('the demo budget is built with these tools and reconciles to the cent', () => {
  const db = D.generate('2026-10-13'), y = db.year;
  const py = E.aggregate(db.actuals[y - 1], db.accounts).lines, b = db.versions[0].values;
  E.LINES.forEach((l) => { assert.ok(E.isIntArr12(b[l.id]), l.id); b[l.id].forEach((x) => assert.ok(x % 100 === 0, l.id + ' in whole euros')); });
  assert.deepStrictEqual(b.sales_eu, E.spreadSeasonal(Math.round(E.total(py.sales_eu) * 1.06 / 100) * 100, py.sales_eu, 100));
  const rev = E.rowsOf(b).rev;
  const pct = Number(/Cost of goods at ([\d,]+) %/.exec(db.versions[0].note)[1].replace(',', '.'));
  assert.deepStrictEqual(b.cogs, E.pctOf(rev, pct));
  assert.deepStrictEqual(b.freight, E.pctOf(rev, 2.2));
});

// ── forecasts and closing ─────────────────────────────────────────────────
t('closing: a month closes 10 days after its end; the fiscal year follows the last closed month', () => {
  assert.deepStrictEqual(E.lastClosed('2026-10-13', 10), { y: 2026, m: 9 });
  assert.deepStrictEqual(E.lastClosed('2026-10-10', 10), { y: 2026, m: 9 });
  assert.deepStrictEqual(E.lastClosed('2026-10-09', 10), { y: 2026, m: 8 });
  assert.deepStrictEqual(E.lastClosed('2026-03-12', 10), { y: 2026, m: 2 });
  assert.deepStrictEqual(E.lastClosed('2027-01-05', 10), { y: 2026, m: 11 });
  assert.strictEqual(E.closedFor(2026, '2026-10-13', 10), 9);
  assert.strictEqual(E.closedFor(2026, '2027-02-20', 10), 12);
  assert.strictEqual(E.closedFor(2027, '2026-12-31', 10), 0);
  assert.strictEqual(E.fiscalYear('2027-01-05', 10), 2026);
  assert.strictEqual(E.fiscalYear('2027-02-10', 10), 2027);
  assert.strictEqual(E.capByLoaded(9, [true, true, true, true, true, false, true, true, true, false, false, false]), 5);
  assert.strictEqual(E.capByLoaded(3, null), 0);
});

t('a new forecast takes actuals for closed months and the current version for the rest', () => {
  const act = {}, ver = {};
  E.LINES.forEach((l) => { act[l.id] = E.zeros().map((x, i) => i + 1); ver[l.id] = E.zeros().map(() => 100); });
  const f = E.makeForecast(act, ver, 9);
  assert.deepStrictEqual(f.it, [1, 2, 3, 4, 5, 6, 7, 8, 9, 100, 100, 100]);
  assert.strictEqual(E.forecastName(2026, 9), 'Forecast 2026 (Q3)');
  assert.strictEqual(E.forecastName(2026, 8), 'Forecast 2026 (8+4)');
});

// ── EBITDA bridge ──────────────────────────────────────────────────────────
t('EBITDA bridge: budget + every line\'s effect = actual, for YTD and the full-year outlook', () => {
  for (const today of ['2026-10-13', '2026-04-20', '2027-01-25']) {
    const db = D.generate(today), y = db.year, c = E.closedFor(y, today, 10);
    const A = E.aggregate(db.actuals[y], db.accounts).lines, B = db.versions[0].values;
    const ytd = E.bridge(B, A, 1, c);
    assert.strictEqual(ytd.start + sum(ytd.steps.map((s) => s.effect)), ytd.end, today);
    assert.strictEqual(ytd.end, E.sumRange(E.rowsOf(A).ebitda, 1, c));
    assert.strictEqual(ytd.steps.length, 15);
    const fy = E.bridge(B, E.outlook(A, B, c), 1, 12);
    assert.strictEqual(fy.start + sum(fy.steps.map((s) => s.effect)), fy.end);
    const small = E.compactBridge(ytd, 7);
    assert.strictEqual(small.steps.length, 7);
    assert.strictEqual(small.start + sum(small.steps.map((s) => s.effect)), small.end);
    assert.strictEqual(small.steps[6].id, 'other');
    const kept = small.steps.slice(0, 6).map((s) => E.LINE[s.id].order);
    assert.deepStrictEqual(kept, kept.slice().sort((x, y2) => x - y2)); // still in P&L order
  }
  const cost = E.bridge({ personnel: arr(eur(100)) }, { personnel: arr(eur(130)) }, 1, 12);
  assert.strictEqual(cost.steps.filter((s) => s.id === 'personnel')[0].effect, -eur(30));
});

// ── numbers and CSV ───────────────────────────────────────────────────────
t('numbers typed in a cell: decimal comma, thousands, k and M, signs', () => {
  assert.strictEqual(E.parseInput('12.500'), eur(12500));
  assert.strictEqual(E.parseInput('12,5'), eur(12.5));
  assert.strictEqual(E.parseInput('1.234,56'), 123456);
  assert.strictEqual(E.parseInput('1 234,56 €'), 123456);
  assert.strictEqual(E.parseInput('1,234.56'), 123456);
  assert.strictEqual(E.parseInput('12.5'), eur(12.5));
  assert.strictEqual(E.parseInput('12,5k'), eur(12500));
  assert.strictEqual(E.parseInput('1,2345k'), eur(1234.5));
  assert.strictEqual(E.parseInput('1,5M'), eur(1500000));
  assert.strictEqual(E.parseInput('-800'), -eur(800));
  assert.strictEqual(E.parseInput('−1.000'), -eur(1000));
  assert.strictEqual(E.parseInput('0,005'), 1);
  assert.strictEqual(E.parseInput(''), 0);
  assert.ok(isNaN(E.parseInput('12a')));
  assert.ok(isNaN(E.parseInput('1,2,3')));
  assert.strictEqual(E.centsText(-123456), '-1234,56');
  assert.strictEqual(E.centsText(5), '0,05');
});

t('CSV pieces: delimiters, months in many formats, amounts in many formats', () => {
  assert.strictEqual(E.detectDelimiter('month;account;amount\n2026-09;4000;1,5'), ';');
  assert.strictEqual(E.detectDelimiter('month,account,amount\n'), ',');
  assert.strictEqual(E.detectDelimiter('month\taccount\tamount;x\n'), '\t');
  assert.deepStrictEqual(E.splitCsv('a;"b;c";"d ""e"""\r\n1;2;3', ';'), [['a', 'b;c', 'd "e"'], ['1', '2', '3']]);
  for (const s of ['2026-09', '2026-9', '2026-09-30', '30.9.2026', '30. 09. 2026', '30/09/2026', '09/2026', '9.2026', '202609', '2026-09-30T00:00:00']) {
    assert.deepStrictEqual(E.parseMonth(s), { y: 2026, m: 9 }, s);
  }
  assert.strictEqual(E.parseMonth('2026-13'), null);
  assert.strictEqual(E.parseMonth('31.9.2026'), null);
  assert.strictEqual(E.parseMonth('09/30/2026'), null); // US order is not guessed
  assert.strictEqual(E.parseAmount('1.234,56', ','), 123456);
  assert.strictEqual(E.parseAmount('1,234.56', '.'), 123456);
  assert.strictEqual(E.parseAmount('1 234,56', ','), 123456);
  assert.strictEqual(E.parseAmount('(1.234,56)', ','), -123456);
  assert.strictEqual(E.parseAmount('1.234,56-', ','), -123456);
  assert.strictEqual(E.parseAmount('€ 99,9', ','), 9990);
  assert.strictEqual(E.parseAmount('-0,00', ','), 0);
  assert.strictEqual(E.parseAmount('abc', ','), null);
  assert.strictEqual(E.detectDecimal(['1.234,56', '12'], ','), ',');
  assert.strictEqual(E.detectDecimal(['1,234.56', '7.5'], ';'), '.');
  assert.strictEqual(E.detectDecimal(['1234', '1.234'], ';'), ',');
  assert.strictEqual(E.detectDecimal(['1234', '99'], ','), '.');
});

t('CSV import: BOM, Slovenian headers, quotes, unknown accounts listed for mapping, row errors', () => {
  const accounts = [{ code: '7600', kind: 'income' }, { code: '4000', kind: 'cost' }];
  const text = '﻿Mesec;Konto;Znesek;Opis\r\n2026-09;7600;"1.234,56";Prodaja\r\n30.09.2026;4000 Cost of goods;800,00;\r\n2026-09;4777;150,5;New account\r\n2026-10;4777;"-10,00";\r\n\r\n';
  const p = E.parseActuals(text, { accounts, years: [2025, 2026] });
  assert.strictEqual(p.header, true);
  assert.strictEqual(p.delimiter, ';');
  assert.strictEqual(p.decimal, ',');
  assert.deepStrictEqual(p.errors, []);
  assert.strictEqual(p.rows.length, 4);
  assert.deepStrictEqual(p.rows[0], { row: 2, y: 2026, m: 9, code: '7600', cents: 123456, desc: 'Prodaja' });
  assert.strictEqual(p.rows[1].code, '4000'); // "4000 Cost of goods" → 4000
  assert.deepStrictEqual(p.unknown, [{ code: '4777', rows: 2, cents: 14050, desc: 'New account' }]);
  assert.deepStrictEqual(p.months.map((m) => m.key + ':' + m.rows), ['2026-09:3', '2026-10:1']);
  const bad = E.parseActuals('month,account,amount\n2026-09,7600,12.5\n2024-01,7600,1\nxx,,abc\n', { accounts, years: [2025, 2026] });
  assert.strictEqual(bad.delimiter, ',');
  assert.deepStrictEqual(bad.errors.map((e) => e.row), [3, 4]);
  assert.ok(/outside 2025 and 2026/.test(bad.errors[0].msg));
  assert.ok(/not a month/.test(bad.errors[1].msg) && /account is missing/.test(bad.errors[1].msg) && /not an amount/.test(bad.errors[1].msg));
  const tab = E.parseActuals('2026-09\t7600\t1234,5\n2026-09\t4000\t1000\n', { accounts });
  assert.strictEqual(tab.header, false);
  assert.strictEqual(tab.rows[0].cents, 123450);
  assert.strictEqual(E.parseActuals('', {}).errors.length, 1);
  assert.strictEqual(E.parseActuals('foo;bar\n1;2', {}).errors[0].row, 1);
});

t('import: unknown accounts mapped, replace or add per month, ledger signs flipped for income', () => {
  const accounts = [{ code: '7600', kind: 'income', line: 'sales_si' }, { code: '4000', kind: 'cost', line: 'cogs' }];
  const before = { 2026: { 7600: arr(eur(500), 9), 4000: arr(eur(300), 9) } };
  before[2026]['7600'][7] = eur(111);
  const p = E.parseActuals('month;account;amount\n2026-09;7600;-1000\n2026-09;4000;600\n2026-09;4777;50\n2026-08;4777;7\n', { accounts });
  assert.strictEqual(p.signGuess, 'ledger');
  const mapped = accounts.concat([{ code: '4777', kind: 'cost', line: 'it' }]);
  const r = E.applyImport(before, p.rows, mapped, { sign: 'ledger', modes: { '2026-08': 'add' } });
  assert.strictEqual(r.actuals[2026]['7600'][8], eur(1000));  // replaced and flipped
  assert.strictEqual(r.actuals[2026]['4000'][8], eur(600));
  assert.strictEqual(r.actuals[2026]['7600'][7], eur(111));   // August added to, not replaced
  assert.strictEqual(r.actuals[2026]['4777'][7], eur(7));
  assert.strictEqual(r.rows, 4);
  assert.strictEqual(before[2026]['7600'][8], eur(500));      // the input is not changed
  const lines = E.aggregate(r.actuals[2026], mapped).lines;
  assert.strictEqual(lines.it[8], eur(50));
  const skip = E.applyImport(before, p.rows, accounts, { sign: 'pl', skip: { 4777: true } });
  assert.strictEqual(skip.actuals[2026]['7600'][8], -eur(1000));
  assert.ok(!skip.actuals[2026]['4777']);
});

t('export → import round trip gives back the same actuals, to the cent', () => {
  const db = D.generate('2026-10-13'), y = db.year;
  const text = E.toCsv(E.actualsRows(db.actuals, db.accounts, [y - 1, y]), ';');
  const p = E.parseActuals(text, { accounts: db.accounts, years: [y - 1, y] });
  assert.deepStrictEqual(p.errors, []);
  assert.deepStrictEqual(p.unknown, []);
  const back = E.applyImport({}, p.rows, db.accounts, { sign: 'pl' }).actuals;
  [y - 1, y].forEach((yy) => Object.keys(db.actuals[yy]).forEach((code) => {
    const orig = db.actuals[yy][code];
    assert.deepStrictEqual(back[yy][code] || E.zeros(), orig, yy + ' ' + code);
  }));
});

// ── demo data ──────────────────────────────────────────────────────────────
t('generator: deterministic, integers only, nothing after the closed month', () => {
  const a = D.generate('2026-10-13'), b = D.generate('2026-10-13');
  assert.deepStrictEqual(a, b);
  assert.strictEqual(a.year, 2026);
  [a.year - 1, a.year].forEach((y) => Object.keys(a.actuals[y]).forEach((code) => assert.ok(E.isIntArr12(a.actuals[y][code]), y + ' ' + code)));
  Object.keys(a.actuals[2026]).forEach((code) => assert.deepStrictEqual(a.actuals[2026][code].slice(9), [0, 0, 0], code));
  assert.deepStrictEqual(a.loaded[2026], [true, true, true, true, true, true, true, true, true, false, false, false]);
  assert.ok(a.loaded[2025].every(Boolean));
  const bud = a.versions[0];
  assert.strictEqual(bud.kind, 'budget');
  assert.strictEqual(bud.locked, true);
  assert.strictEqual(bud.approvedOn, '2025-12-15');
  assert.strictEqual(bud.name, 'Budget 2026');
});

t('generator: about €13M revenue, 22–28 % gross margin, 5–8 % EBITDA, every month positive', () => {
  for (const today of ['2026-02-12', '2026-04-20', '2026-07-20', '2026-10-13', '2026-12-20', '2027-01-05', '2027-06-01', '2028-11-30']) {
    const db = D.generate(today), y = db.year, c = E.capByLoaded(E.closedFor(y, today, 10), db.loaded[y]);
    const A = E.aggregate(db.actuals[y], db.accounts).lines, B = db.versions[0].values;
    const sets = { 'last year': E.aggregate(db.actuals[y - 1], db.accounts).lines, budget: B, 'outlook on budget': E.outlook(A, B, c) };
    db.versions.filter((v) => v.kind === 'forecast').forEach((v) => { sets['outlook on ' + v.name] = E.outlook(A, v.values, c); });
    Object.keys(sets).forEach((k) => {
      const r = E.rowsOf(sets[k]), rev = E.total(r.rev), gm = E.total(r.gm) / rev * 100, eb = E.total(r.ebitda) / rev * 100;
      assert.ok(rev > eur(11.5e6) && rev < eur(14e6), today + ' ' + k + ' revenue ' + rev);
      assert.ok(gm >= 22 && gm <= 28, today + ' ' + k + ' gross margin ' + gm);
      assert.ok(eb >= 5 && eb <= 8, today + ' ' + k + ' EBITDA ' + eb);
      r.rev.forEach((x, i) => assert.ok(x > 0, today + ' ' + k + ' revenue in month ' + (i + 1)));
    });
    const ra = E.rowsOf(A);
    for (let m = 1; m <= c; m++) assert.ok(ra.rev[m - 1] > 0, today + ' actual revenue in month ' + m);
  }
});

t('generator: the story shows in the variances on 13 October', () => {
  const db = D.generate('2026-10-13'), y = db.year, c = 9;
  const A = E.rowsOf(E.aggregate(db.actuals[y], db.accounts).lines), B = E.rowsOf(db.versions[0].values);
  const v = (id, from, to) => E.pctVar(E.sumRange(A[id], from, to), E.sumRange(B[id], from, to));
  assert.ok(v('sales_si', 7, 8) < -8, 'Slovenia under budget in the summer');
  assert.ok(v('sales_si', 1, 5) > -5, '...but not before');
  assert.ok(v('sales_hr', 5, 9) > 5, 'Croatia ahead');
  assert.ok(v('it', 1, c) > 20, 'IT over budget');
  assert.ok(v('freight', 3, c) > 5, 'freight up with fuel');
  assert.ok(v('personnel', 2, 4) < -8 && v('personnel', 6, 9) > 0, 'personnel under early, then catching up');
  const gmA = E.sumRange(A.gm, 5, 9) / E.sumRange(A.rev, 5, 9), gmB = E.sumRange(B.gm, 5, 9) / E.sumRange(B.rev, 5, 9);
  assert.ok(gmA < gmB - 0.004, 'cost of goods % up from May');
  const fl = E.flags(A, B, c, { pct: 10, monthAbs: eur(5000), ytdAbs: eur(10000) });
  const keys = fl.map((f) => E.commentKey(f.line, f.month, f.scope));
  ['sales_si|7|month', 'sales_hr|9|month', 'it|9|ytd', 'freight|9|ytd', 'personnel|3|month'].forEach((k) => assert.ok(keys.indexOf(k) >= 0, k));
});

t('generator: comments only on earlier flagged months, some explained, one open, and flags left without one', () => {
  const db = D.generate('2026-10-13'), y = db.year, c = 9;
  const A = E.rowsOf(E.aggregate(db.actuals[y], db.accounts).lines), B = E.rowsOf(db.versions[0].values);
  const fl = E.flags(A, B, c, { pct: 10, monthAbs: eur(5000), ytdAbs: eur(10000) }), flagged = new Set(fl.map((f) => E.commentKey(f.line, f.month, f.scope)));
  const ytdBefore = new Set(E.flags(A, B, c - 1, { pct: 10, monthAbs: eur(5000), ytdAbs: eur(10000) }).filter((f) => f.scope === 'ytd').map((f) => E.commentKey(f.line, f.month, f.scope)));
  assert.ok(db.comments.length >= 6);
  db.comments.forEach((cm) => {
    const k = E.commentKey(cm.line, cm.month, cm.scope);
    assert.ok(flagged.has(k) || ytdBefore.has(k), 'comment on a flagged variance: ' + k);
    assert.ok(cm.month < c && cm.at <= '2026-10-13' && cm.text && cm.author);
    assert.ok(cm.status === 'open' || cm.status === 'explained');
  });
  assert.ok(db.comments.some((cm) => cm.status === 'explained') && db.comments.some((cm) => cm.status === 'open'));
  const commented = new Set(db.comments.map((cm) => E.commentKey(cm.line, cm.month, cm.scope)));
  assert.ok(fl.filter((f) => !commented.has(E.commentKey(f.line, f.month, f.scope))).length >= 3, 'open variances without a comment');
});

t('generator: the Q2 forecast holds actuals for January–June and a revised second half', () => {
  const db = D.generate('2026-10-13'), y = db.year;
  const f = db.versions.filter((v) => v.kind === 'forecast');
  assert.strictEqual(f.length, 1);
  assert.strictEqual(f[0].name, 'Forecast 2026 (Q2)');
  assert.strictEqual(f[0].createdOn, '2026-07-08');
  const A = E.aggregate(db.actuals[y], db.accounts).lines, B = db.versions[0].values;
  E.LINES.forEach((l) => {
    assert.deepStrictEqual(f[0].values[l.id].slice(0, 6), A[l.id].slice(0, 6), l.id);
    f[0].values[l.id].slice(6).forEach((x) => assert.ok(x % 100 === 0));
  });
  assert.notDeepStrictEqual(f[0].values.sales_hr.slice(6), B.sales_hr.slice(6));
  assert.strictEqual(D.generate('2026-04-20').versions[1].name, 'Forecast 2026 (Q1)');
  assert.strictEqual(D.generate('2026-03-15').versions.length, 1);
});

t('extend(): months that close later get the same numbers a fresh demo would have', () => {
  const db = D.generate('2026-10-13');
  assert.strictEqual(D.extend(db, '2026-10-20'), false);
  assert.strictEqual(D.extend(db, '2026-11-12'), true);
  assert.strictEqual(db.loaded[2026][9], true);
  const fresh = D.generate('2026-11-12');
  Object.keys(fresh.actuals[2026]).forEach((code) => assert.deepStrictEqual(db.actuals[2026][code], fresh.actuals[2026][code], code));
  db.loaded[2026][10] = true; // an imported November is never overwritten
  db.actuals[2026]['7620'][10] = 1;
  D.extend(db, '2027-01-20');
  assert.strictEqual(db.actuals[2026]['7620'][10], 1);
  assert.ok(db.actuals[2026]['7620'][11] > 0);
  assert.strictEqual(D.extend(Object.assign({}, db, { demo: false }), '2027-03-01'), false);
});

console.log(n + ' tests passed');
