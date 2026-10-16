// Tests for the Data health check additions in site/datacheck/engine.js and data.js: the official SI/HR postal lists,
// 080/090 numbers, "fix everything" in one step, VIES candidates and results, e-invoice readiness, recipes and the ERP
// customer export. Run: node tools/tests/datacheck-improve.test.js
'use strict';
const assert = require('assert');
const path = require('path');
const E = require(path.join(__dirname, '../../site/datacheck/engine.js'));
const D = require(path.join(__dirname, '../../site/datacheck/data.js'));
const P = require(path.join(__dirname, '../../site/datacheck/postal-data.js'));

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok', n, name); }
const kinds = (res, k) => res.issues.filter((x) => x.k === k);
function table(headers, rows) { return { headers, rows: rows.map((r) => r.map(String)), lines: rows.map((_, i) => i + 2) }; }
function cfgFor(tb, extra) {
  const type = (extra && extra.type) || 'customers';
  const roles = (extra && extra.roles) || E.rolesForType(E.guessRoles(tb, 'SI').roles, type);
  return Object.assign({ type, roles, required: E.DEFAULT_REQ[type].required, recommended: E.DEFAULT_REQ[type].recommended, home: 'SI', today: '2026-10-15' }, extra || {}, { roles });
}
const run = (tb, extra) => E.analyze(tb, cfgFor(tb, extra));
const demo = (id) => { const f = D.file(id, '2026-10-15'), tb = E.readText(E.decode(f.bytes).text), st = E.autoSetup(tb, f.name, 'SI'); return { tb, cfg: cfgFor(tb, { type: st.type, roles: st.roles }), plan: f.plan }; };

// ── postal codes ───────────────────────────────────────────────────────
t('postal lists: the official lists are loaded, with sizes that match the sources', () => {
  assert.strictEqual(E.POST_FULL, true);
  const si = Object.keys(E.POST.SI).length, hr = Object.keys(E.POST.HR).length;
  assert.ok(si > 1400 && si < 1700, 'SI codes ' + si);
  assert.ok(hr > 1000 && hr < 1200, 'HR codes ' + hr);
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(P.retrieved));
  // every code of the small built-in list is in the official one
  Object.keys(E.POST_MAIN.SI).forEach((c) => assert.ok(E.POST.SI[c], 'SI ' + c));
  Object.keys(E.POST_MAIN.HR).forEach((c) => assert.ok(E.POST.HR[c], 'HR ' + c));
});
t('postal lists: names, bilingual spellings and Croatian settlements', () => {
  assert.strictEqual(E.postOffice('SI', '8340').name, 'Črnomelj');
  assert.strictEqual(E.postOffice('SI', '4283').name, 'Rateče - Planica');
  assert.ok(E.cityMatches('Capodistria', E.postOffice('SI', '6000')));
  assert.ok(E.cityMatches('Koper/Capodistria', E.postOffice('SI', '6000')));
  assert.ok(E.cityMatches('Ljubljana', E.postOffice('SI', '1210')), 'Ljubljana for Ljubljana - Šentvid');
  assert.ok(E.cityMatches('Pola', E.postOffice('HR', '52100')));
  assert.ok(E.cityMatches('Premantura', E.postOffice('HR', '52100')), 'a settlement served by Pula');
  assert.ok(!E.cityMatches('Split', E.postOffice('HR', '52100')));
  assert.strictEqual(E.postOffice('HR', '10010').name, 'Zagreb-Sloboština');
});
t('postal codes: a code in the right form that does not exist is flagged; foreign codes are not', () => {
  assert.strictEqual(E.postalCheck('1000', 'SI').unknown, undefined);
  assert.strictEqual(E.postalCheck('1999', 'SI').unknown, true);
  assert.strictEqual(E.postalCheck('59999', 'HR').unknown, true);
  assert.strictEqual(E.postalCheck('8010', 'AT').unknown, undefined);
  const tb = table(['Naziv', 'Ulica', 'Pošta', 'Kraj', 'Država'], [['A d.o.o.', 'Cesta 1', '1999', 'Ljubljana', 'SI'], ['B d.o.o.', 'Cesta 2', '9000', 'Maribor', 'SI'], ['C d.o.o.', 'Ilica 1', '52100', 'Banjole', 'HR']]);
  const res = run(tb, { recommended: [] });
  assert.deepStrictEqual(kinds(res, 'postal.unknown').map((x) => [x.r, x.p]), [[0, 'SI|1999']]);
  assert.deepStrictEqual(kinds(res, 'postal.city').map((x) => [x.r, x.s]), [[1, 'Murska Sobota']]);
});

// ── phone numbers ──────────────────────────────────────────────────────
t('phone: Slovene 080/090/089 and Croatian 0800/060/061 numbers are valid and stay domestic', () => {
  const si = { '080 12 34': ['+386801234', 'free'], '080 1234': ['+386801234', 'free'], '090 12 34': ['+386901234', 'premium'], '089 1234': ['+386891234', 'premium'],
    '+386 80 1234': ['+386801234', 'free'], '080 123 456': ['+38680123456', 'free'] };
  Object.keys(si).forEach((k) => { const x = E.phoneCheck(k, 'SI'); assert.deepStrictEqual([x.ok, x.e164, x.special], [true].concat(si[k]), k); });
  assert.strictEqual(E.phoneCheck('0800 1234', 'HR').special, 'free');
  assert.strictEqual(E.phoneCheck('0800 123 456', 'HR').special, 'free');
  assert.strictEqual(E.phoneCheck('060 123 456', 'HR').special, 'shared');
  assert.strictEqual(E.phoneCheck('061 123 456', 'HR').special, 'premium');
  // ordinary numbers are unchanged
  assert.strictEqual(E.phoneCheck('01 234 56 78', 'SI').special, undefined);
  assert.strictEqual(E.phoneCheck('041 123 456', 'SI').e164, '+38641123456');
  assert.strictEqual(E.phoneCheck('080 12', 'SI').err, 'short');
  assert.strictEqual(E.phoneCheck('091 123 4567', 'HR').special, undefined);
  // no "write it as +386" fix for them
  const res = run(table(['Naziv', 'Telefon'], [['A d.o.o.', '080 12 34'], ['B d.o.o.', '01 234 56 78']]), { required: [], recommended: [] });
  assert.deepStrictEqual(kinds(res, 'phone.format').map((x) => x.r), [1]);
  assert.deepStrictEqual(kinds(res, 'phone.invalid'), []);
});

// ── fix everything ─────────────────────────────────────────────────────
t('planFixes: one value per cell, space fixes combined, other fixes first', () => {
  const tb = table(['Naziv', 'Država', 'Telefon'], [['  Vzorec   d.o.o. ', 'Slovenija', '041 123 456'], ['VZOREC ENERGIJA D.O.O.', 'SI', '+38641123456']]);
  const res = run(tb, { required: [], recommended: [] });
  const plan = E.planFixes(res, tb);
  const cell = (r, c) => plan.filter((x) => x.r === r && x.c === c)[0];
  assert.strictEqual(cell(0, 0).v, 'Vzorec d.o.o.');
  assert.deepStrictEqual(cell(0, 0).k.sort(), ['ws.double', 'ws.trim']);
  assert.strictEqual(cell(0, 1).v, 'SI');
  assert.strictEqual(cell(0, 2).v, '+38641123456');
  assert.strictEqual(cell(1, 0).v, 'Vzorec Energija d.o.o.');
  assert.strictEqual(plan.length, 4);
  assert.deepStrictEqual(E.planFixes(res, tb, ['country.mixed']).map((x) => [x.r, x.c]), [[0, 1]], 'limited to chosen rules');
});
t('fixAll: the demo customers go from 55 to 75 in one step and nothing fixable is left', () => {
  const { tb, cfg } = demo('customers');
  const before = E.analyze(tb, cfg), orig = tb.rows.map((r) => r.slice());
  assert.strictEqual(before.score, 55);
  const out = E.fixAll(tb, cfg);
  assert.strictEqual(out.res.score, before.scoreAfter);
  assert.strictEqual(out.res.score, 75);
  assert.strictEqual(out.res.issues.filter((x) => x.f !== undefined).length, 0);
  assert.ok(out.changes.length >= 1000);
  // every change remembers the original value: undo gives back the file as it was
  for (let i = out.changes.length - 1; i >= 0; i--) { const ch = out.changes[i]; assert.strictEqual(orig[ch[0]][ch[1]], ch[2]); tb.rows[ch[0]][ch[1]] = ch[2]; }
  assert.deepStrictEqual(tb.rows, orig);
});
t('fixAll: a cell needing two fixes after each other gets both (several passes)', () => {
  const tb = table(['Naziv'], [['  ACME   INDUSTRIJA  D.O.O. ']]);
  const out = E.fixAll(tb, { type: 'customers', roles: ['name'], required: [], recommended: [] });
  assert.strictEqual(tb.rows[0][0], 'Acme Industrija d.o.o.');
  assert.ok(out.passes >= 2);
  assert.strictEqual(out.changes.length, 1, 'one change per cell');
});
t('fixAll on products and suppliers leaves no one-click fix behind', () => {
  ['products', 'suppliers'].forEach((id) => {
    const { tb, cfg } = demo(id), out = E.fixAll(tb, cfg);
    assert.strictEqual(out.res.issues.filter((x) => x.f !== undefined).length, 0, id);
    assert.ok(out.res.score >= E.analyze(demo(id).tb, demo(id).cfg).score, id);
  });
});

// ── VIES ───────────────────────────────────────────────────────────────
t('viesCandidates: distinct EU VAT IDs that pass the local checks, with their rows', () => {
  const tb = table(['Naziv', 'Država', 'ID za DDV'], [['A', 'SI', 'SI12345679'], ['B', 'SI', '12345679'], ['C', 'SI', 'SI12345678'], ['D', 'AT', 'ATU12345678'], ['E', 'CH', 'CHE123456789'], ['F', 'GR', 'EL094259216'], ['G', 'SI', '']]);
  const res = run(tb, { required: [], recommended: [] });
  const c = E.viesCandidates(res, tb);
  assert.deepStrictEqual(c.map((x) => [x.norm, x.cc, x.num, x.rows]), [['SI12345679', 'SI', '12345679', [0, 1]], ['ATU12345678', 'AT', 'U12345678', [3]], ['EL094259216', 'EL', '094259216', [5]]]);
});
t('VIES results: an invalid answer becomes an error, valid and unknown ones add nothing', () => {
  const tb = table(['Naziv', 'Država', 'ID za DDV'], [['A', 'SI', 'SI12345679'], ['D', 'AT', 'ATU12345678'], ['E', 'DE', 'DE123456789']]);
  const vies = { SI12345679: { valid: false, at: '2026-10-15T10:00:00Z' }, ATU12345678: { valid: true }, DE123456789: { valid: null } };
  const res = run(tb, { required: [], recommended: [], vies });
  assert.deepStrictEqual(kinds(res, 'vat.vies').map((x) => x.r), [0]);
  assert.strictEqual(E.RULES['vat.vies'].sev, 'warning', 'a warning: a Slovene company without VAT registration still has a valid tax number');
  assert.ok(/15\. 10\. 2026/.test(E.message(kinds(res, 'vat.vies')[0])));
  assert.deepStrictEqual(kinds(run(tb, { required: [], recommended: [] }), 'vat.vies'), [], 'nothing without the online check');
});

// ── e-invoice readiness ────────────────────────────────────────────────
t('einvoice: per row and overall, with the criteria that apply', () => {
  const H = ['Naziv', 'Ulica', 'Pošta', 'Kraj', 'Država', 'ID za DDV', 'E-pošta'];
  const tb = table(H, [
    ['Vzorec d.o.o.', 'Cesta 1', '1000', 'Ljubljana', 'SI', 'SI12345679', 'racuni@example.si'], // ready
    ['Primer d.o.o.', 'Cesta 2', '1000', 'Ljubljana', 'SI', 'SI12345678', 'info@example.si'],    // wrong VAT ID
    ['Ana Novak', 'Pot 3', '2000', 'Maribor', 'SI', '', 'ana@example.si'],                        // private person: no tax ID needed
    ['Test d.o.o.', '', '1999', 'Ljubljana', 'SI', '', 'x@'],                                     // no street, unknown code, no VAT ID, bad e-mail
    ['Swiss AG', 'Weg 1', '8000', 'Zürich', 'CH', '', 'info@example.ch']                          // outside the EU: no tax ID needed
  ]);
  const res = run(tb);
  const ei = E.einvoice(res, tb);
  assert.deepStrictEqual(Array.from(ei.scores), [100, 86, 100, 43, 100]);
  assert.deepStrictEqual([ei.rows, ei.ready, ei.pct, ei.avg], [5, 3, 60, 86]);
  const by = {}; ei.crit.forEach((c) => { by[c.id] = [c.miss, c.n]; });
  assert.deepStrictEqual(by.taxid, [2, 3]);
  const bit = (id) => 1 << E.EINV.findIndex((x) => x[0] === id);
  assert.strictEqual(ei.masks[1], bit('taxid'));
  assert.strictEqual(ei.masks[3], bit('taxid') | bit('street') | bit('postal') | bit('email'));
  assert.strictEqual(ei.masks[0], 0);
  assert.deepStrictEqual(by.street, [1, 5]);
  assert.deepStrictEqual(by.postal, [1, 5]);
  assert.deepStrictEqual(by.email, [1, 5]);
  assert.strictEqual(by.iban, undefined, 'customers without an IBAN column: not counted');
  assert.strictEqual(E.einvoice(Object.assign({}, res, { type: 'products' }), tb), null);
});
t('einvoice: a VIES "not valid" answer makes the row not ready; suppliers need an IBAN', () => {
  const tb = table(['Naziv', 'Ulica', 'Pošta', 'Kraj', 'Država', 'ID za DDV', 'E-pošta'], [['Vzorec d.o.o.', 'Cesta 1', '1000', 'Ljubljana', 'SI', 'SI12345679', 'a@example.si']]);
  assert.strictEqual(E.einvoice(run(tb), tb).ready, 1);
  assert.strictEqual(E.einvoice(run(tb, { vies: { SI12345679: { valid: false } } }), tb).ready, 0);
  const sup = run(tb, { type: 'suppliers' }), ei = E.einvoice(sup, tb);
  assert.deepStrictEqual(ei.crit.filter((c) => c.id === 'iban').map((c) => [c.miss, c.n]), [[1, 1]]);
});
t('einvoice: the demo customers improve after the one-click fixes', () => {
  const { tb, cfg } = demo('customers');
  const before = E.einvoice(E.analyze(tb, cfg), tb), after = E.einvoice(E.fixAll(tb, cfg).res, tb);
  assert.ok(after.pct > before.pct, before.pct + ' → ' + after.pct);
});

// ── recipes ────────────────────────────────────────────────────────────
t('recipes: the mapping is matched by header, ignoring capitals, accents and spacing', () => {
  const data = { headers: ['Šifra', 'Naziv', 'Opomba', 'Davčna št.'], roles: ['id', 'name', 'ignore', 'vat'], unitTarget: null, dupThreshold: 90 };
  const rc = E.makeRecipe('  Kupci mesečno ', 'customers', data, ['ws.trim', 'country.mixed', 'req.missing', 'nope']);
  assert.strictEqual(rc.name, 'Kupci mesečno');
  assert.deepStrictEqual(rc.rules, ['ws.trim', 'country.mixed'], 'only one-click fix rules');
  assert.strictEqual(rc.dupThreshold, 90);
  const m = E.matchRecipe(rc, ['SIFRA', 'naziv', 'Davčna  št', 'Novo polje']);
  assert.deepStrictEqual(m.roles, ['id', 'name', 'vat', null]);
  assert.strictEqual(m.found, 3);
  assert.strictEqual(m.share, 3 / 4);
  assert.strictEqual(E.matchRecipe(rc, ['a', 'b']).found, 0);
});
t('recipes: next month\'s demo file gets the same roles and the same fixes', () => {
  const a = demo('customers'), b = (() => { const f = D.file('customers', '2026-11-15'), tb = E.readText(E.decode(f.bytes).text); return tb; })();
  const roles = a.cfg.roles.slice(); roles[roles.length - 1] = 'ignore';
  const rc = E.makeRecipe('Kupci', 'customers', { headers: a.tb.headers, roles }, ['country.mixed', 'phone.format']);
  const m = E.matchRecipe(rc, b.headers);
  assert.strictEqual(m.found, b.headers.length);
  assert.deepStrictEqual(m.roles, roles);
  const out = E.fixAll(b, Object.assign({}, a.cfg, { roles: m.roles }), rc.rules);
  assert.deepStrictEqual(Object.keys(out.rules).sort(), ['country.mixed', 'phone.format']);
  assert.strictEqual(out.res.issues.filter((x) => x.k === 'country.mixed' || x.k === 'phone.format').length, 0);
  assert.ok(out.res.issues.some((x) => x.k === 'ws.trim'), 'fixes outside the recipe are left alone');
});

// ── the ERP demo's customers ───────────────────────────────────────────
t('ERP customers: export columns, walk-in customers left out, addresses split', () => {
  const csv = D.erpCsv([{ id: 7, name: 'Optika Nova d.o.o.', type: 'B2B', country: 'SI', city: 'Ljubljana', address: 'Slovenska cesta 1, 1000 Ljubljana', email: 'a@example.com', phone: '+386 1 555 0000', vatId: 'SI12345679', terms: 30 },
    { id: 8, name: 'Walk-in customer (SI)', walkIn: true }, { id: 9, name: 'Ana Novak', type: 'B2C', country: 'HR', city: 'Zagreb', email: '', phone: '', vatId: '', terms: 0 }]);
  const tb = E.readText(csv);
  assert.deepStrictEqual(tb.headers, D.ERP_H);
  assert.deepStrictEqual(tb.rows, [['K0007', 'Optika Nova d.o.o.', 'B2B', 'Slovenska cesta 1', '1000', 'Ljubljana', 'SI', 'SI12345679', 'a@example.com', '+386 1 555 0000', '30'],
    ['K0009', 'Ana Novak', 'B2C', '', '', 'Zagreb', 'HR', '', '', '', '0']]);
  const st = E.autoSetup(tb, 'ERP demo customers', 'SI');
  assert.strictEqual(st.type, 'customers');
  assert.deepStrictEqual(st.roles.slice(0, 10), ['id', 'name', 'text', 'street', 'postal', 'city', 'country', 'vat', 'email', 'phone']);
});
t('ERP sample: the planted problems are found', () => {
  const tb = E.readText(D.erpCsv(D.erpSample())), st = E.autoSetup(tb, 'ERP demo customers', 'SI');
  const res = E.analyze(tb, cfgFor(tb, { roles: st.roles }));
  assert.strictEqual(tb.rows.length, 53, 'walk-in left out');
  assert.deepStrictEqual(kinds(res, 'vat.checksum').map((x) => x.r), [2, 12]);
  assert.deepStrictEqual(kinds(res, 'postal.unknown').map((x) => x.r), [4]);
  assert.deepStrictEqual(kinds(res, 'postal.city').map((x) => [x.r, x.s]), [[7, 'Murska Sobota']]);
  assert.deepStrictEqual(kinds(res, 'email.invalid').map((x) => x.r), [15]);
  assert.deepStrictEqual(kinds(res, 'text.caps').map((x) => x.r), [18]);
  assert.deepStrictEqual(kinds(res, 'phone.invalid'), [], 'the freephone number is valid');
  assert.deepStrictEqual(res.groups.map((g) => g.rows), [[0, 52]]);
});

console.log(n + ' tests passed');
