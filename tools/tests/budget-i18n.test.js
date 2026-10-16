// Tests for site/budget/i18n.js: every screen text app.js uses has a Slovene and a Croatian translation with the same
// {placeholders}; plural forms; the P&L line names; the patterns that translate the engine's English texts (import
// errors of the chart of accounts, general ledger, trial balance and .xlsx reader) and what older data saved in English
// (version names and notes, the activity log). Run: node tools/tests/budget-i18n.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const I = require(path.join(__dirname, '../../site/budget/i18n.js'));
const E = require(path.join(__dirname, '../../site/budget/engine.js'));
const X = require(path.join(__dirname, '../../site/budget/data.js'));

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok', n, name); }
const APP = fs.readFileSync(path.join(__dirname, '../../site/budget/app.js'), 'utf8');
const XLSX = fs.readFileSync(path.join(__dirname, '../../site/budget/xlsx.js'), 'utf8');
const unq = (q) => q.slice(1, -1).replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, '\\');
const holes = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(',');

/** The string literals in the first argument of every tx( and th( call (also both sides of a ternary and the values of
 * an { a: 'Text' }[k] table), skipping the literals that are compared with (=== 'budget' ?). */
function callKeys(src) {
  const keys = new Set(), re = /\b(?:tx|th)\(/g;
  let m;
  while ((m = re.exec(src))) {
    let i = re.lastIndex, depth = 0;
    const lits = [];
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === "'" || c === '"') {
        let j = i + 1;
        while (j < src.length && src[j] !== c) { if (src[j] === '\\') j++; j++; }
        const before = src.slice(Math.max(0, i - 5), i), after = src.slice(j + 1, j + 6);
        if (!/[=!]==?\s*$/.test(before) && !/^\s*(\?|[=!]==?)/.test(after)) lits.push(unq(src.slice(i, j + 1)));
        i = j; continue;
      }
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') { if (!depth) break; depth--; }
      else if (c === ',' && !depth) break;
    }
    lits.forEach((s) => { if (/[A-Za-z]{2}/.test(s)) keys.add(s); }); // object keys like ';' carry no text
  }
  return keys;
}
/** texts in a table app.js passes through tx(): `var NAME = …;` */
function tableKeys(name, keys) {
  const at = APP.search(new RegExp('var ' + name + ' = [\\[{]'));
  assert.ok(at >= 0, 'table ' + name);
  const body = APP.slice(at, APP.indexOf(';\n', at));
  (body.match(/'(?:[^'\\]|\\.)*'/g) || []).map(unq).filter((s) => /[A-Z ]/.test(s) && !/^[a-z_-]+$/.test(s)).forEach((s) => keys.add(s));
}
function appKeys() {
  const keys = callKeys(APP);
  ['ROUTES', 'TITLES', 'LINE_HINT', 'REASON', 'ROLE', 'SHORT', 'segs', 'per', 'names'].forEach((nm) => tableKeys(nm, keys));
  // the CSV headers and rows of the headcount export, the template and the P&L export (mapped through tx)
  ['role', 'country', 'fte', 'gross a month', 'allowances a month', 'from', 'until', 'year', 'Gross pay', 'Employer contributions', 'Allowances', 'Holiday allowance', 'Other staff costs', 'Total'].forEach((s) => keys.add(s));
  // the structure of the P&L the engine defines: sections, margin rows, the merged bridge step
  E.SECTIONS.forEach((s) => keys.add(s.name));
  E.ROWS.filter((r) => r.kind === 'head').forEach((r) => keys.add(r.name));
  keys.add(E.compactBridge({ start: 0, end: 0, steps: E.LINES.map((l, i) => ({ id: l.id, name: l.name, effect: i })) }, 3).steps.pop().name);
  // the names of the Excel reader's errors
  (XLSX.match(/new Error\('((?:[^'\\]|\\.)*)'\)/g) || []).forEach((s) => keys.add(unq(s.slice(10, -1))));
  // the index.html texts shellText() sets
  ['Skip to content', 'Menu', 'Budget vs actual', 'Budget vs actual navigation', 'Sections', 'Language', 'Demo data · saved in this browser only', 'Adding up the year…'].forEach((s) => keys.add(s));
  return keys;
}

t('every screen text has a Slovene and a Croatian translation with the same placeholders', () => {
  const keys = appKeys(), missing = [], bad = [];
  assert.ok(keys.size > 550, 'found ' + keys.size + ' texts');
  keys.forEach((k) => {
    const e = I.DICT[k];
    if (!e) { missing.push(k); return; }
    if (!(e.length === 2 && e[0] && e[1])) bad.push(k + ' (empty)');
    else if (holes(e[0]) !== holes(k) || holes(e[1]) !== holes(k)) bad.push(k + ' → ' + e.join(' | '));
  });
  assert.deepStrictEqual(missing, [], 'missing translations');
  assert.deepStrictEqual(bad, [], 'placeholders differ');
  // no entry of the dictionary has English left in it by mistake (same text in all three)
  const same = Object.keys(I.DICT).filter((k) => /[a-z]{4,} [a-z]{3,}/.test(k) && I.DICT[k][0] === k && I.DICT[k][1] === k);
  assert.deepStrictEqual(same, [], 'untranslated entries');
});

t('the shell texts in index.html are the ones shellText() sets', () => {
  const html = fs.readFileSync(path.join(__dirname, '../../site/budget/index.html'), 'utf8');
  ['skipLink', 'menuLabel', 'appName', 'demoPill', 'demoText', 'langLabel', 'uiLang', 'brandSub'].forEach((id) => assert.ok(html.includes('id="' + id + '"'), id));
  assert.ok(/<script src="i18n\.js\?v=\d+"><\/script>\s*<script src="app\.js\?v=\d+">/.test(html), 'i18n.js loads before app.js');
  assert.ok(html.includes('<option value="sl" lang="sl">Slovenščina</option>') && html.includes('<option value="hr" lang="hr">Hrvatski</option>'));
});

t('translate: placeholders are filled, English stays English, an unknown text falls back to English', () => {
  const sl = I.make('sl'), hr = I.make('hr'), en = I.make('en');
  assert.strictEqual(sl.t('Closed through {month}', { month: sl.monthsGen[8] }), 'Zaključeno do septembra');
  assert.strictEqual(hr.t('Closed through {month}', { month: hr.monthsGen[8] }), 'Zaključeno do rujna');
  assert.strictEqual(en.t('Closed through {month}', { month: en.monthsGen[8] }), 'Closed through September');
  assert.strictEqual(sl.t('Settings'), 'Nastavitve');
  assert.strictEqual(hr.t('Settings'), 'Postavke');
  assert.strictEqual(sl.t('Not in the dictionary {x}', { x: 1 }), 'Not in the dictionary 1');
  assert.strictEqual(I.make('de').lang, 'en');
});

t('terminology: plan / realizacija (ostvarenje), odmik (odstupanje), IPI (RDG), kontni načrt (plan)', () => {
  const sl = I.make('sl'), hr = I.make('hr');
  assert.strictEqual(sl.t('Budget'), 'Plan'); assert.strictEqual(hr.t('Budget'), 'Plan');
  assert.strictEqual(sl.t('Actual'), 'Realizacija'); assert.strictEqual(hr.t('Actual'), 'Ostvarenje');
  assert.strictEqual(sl.t('Forecast'), 'Napoved'); assert.strictEqual(hr.t('Forecast'), 'Prognoza');
  assert.strictEqual(sl.t('Board pack'), 'Poročilo za upravo'); assert.strictEqual(hr.t('Board pack'), 'Izvješće za upravu');
  assert.strictEqual(sl.t('Headcount'), 'Število zaposlenih'); assert.strictEqual(hr.t('Headcount'), 'Broj zaposlenih');
  assert.ok(/odmik/i.test(sl.t('Variance comments')) && /odstupanj/i.test(hr.t('Variance comments')));
  assert.ok(/IPI/.test(sl.t('P&L')) && /RDG/.test(hr.t('P&L')));
  assert.ok(/kontni načrt/i.test(sl.t('Chart of accounts')) && /kontni plan/i.test(hr.t('Chart of accounts')));
});

t('plural forms: Slovene 1 / 2 / 3–4 / 5+, Croatian 1 / 2–4 / 5+ (11–14 take the many form)', () => {
  const sl = I.make('sl'), hr = I.make('hr'), en = I.make('en');
  assert.deepStrictEqual([1, 2, 3, 4, 5, 11, 101, 102, 0].map((k) => sl.noun(k, 'account', 'accounts')), ['konto', 'konta', 'konti', 'konti', 'kontov', 'kontov', 'konto', 'konta', 'kontov']);
  assert.deepStrictEqual([1, 2, 4, 5, 11, 12, 21, 22, 25].map((k) => hr.noun(k, 'row', 'rows')), ['redak', 'retka', 'retka', 'redaka', 'redaka', 'redaka', 'redak', 'retka', 'redaka']);
  assert.deepStrictEqual([1, 2].map((k) => en.noun(k, 'month', 'months')), ['month', 'months']);
  // every noun app.js counts has its forms
  const used = new Set(); let m; const re = /plural\([^,]+,\s*'([^']+)'/g;
  while ((m = re.exec(APP))) used.add(m[1]);
  assert.ok(used.size >= 5, [...used].join(', '));
  used.forEach((w) => { assert.ok(I.NOUNS[w], 'forms for ' + w); assert.strictEqual(I.NOUNS[w][0].length, 4); assert.strictEqual(I.NOUNS[w][1].length, 3); });
});

t('P&L line names: English as in the engine, every line, subtotal and margin in Slovene and Croatian', () => {
  E.LINES.concat(E.SUBS || []).forEach((l) => assert.strictEqual(I.LINE_NAMES.en[l.id], E.nameOf(l.id), l.id));
  E.ROWS.filter((r) => r.kind !== 'head').forEach((r) => {
    assert.ok(I.LINE_NAMES.en[r.id], 'en ' + r.id);
    ['sl', 'hr'].forEach((L) => { assert.ok(I.LINE_NAMES[L][r.id], L + ' ' + r.id); });
  });
  assert.strictEqual(I.LINE_NAMES.sl.personnel, 'Stroški dela');
  assert.strictEqual(I.LINE_NAMES.hr.rev, 'Ukupni prihodi');
});

const ENGLISH = /\b(the|is|not|are|month|account|amount|row|file|date|actuals?|budget|forecast|created|deleted|imported|locked|approved|comment|through|outside|missing|number|empty|sheet|row|rows|and|for|of)\b/i;
function noEnglish(L, msgs) {
  const x = I.make(L).x;
  msgs.forEach((s) => {
    const out = x(s);
    assert.notStrictEqual(out, s, L + ': not translated: ' + s);
    assert.ok(!ENGLISH.test(out.replace(/»[^«]*«|„[^”]*”|\([^)]*\.(?:csv|xlsx)\)|Nordvik[^,.;]*/g, '')), L + ': English left in "' + out + '" (from "' + s + '")');
  });
}

t('engine texts: import errors of the actuals file, general ledger, trial balance and Excel reader are translated', () => {
  const accounts = X.generate('2026-10-15').accounts, years = [2025, 2026], msgs = [];
  const take = (p) => p.errors.forEach((e) => msgs.push(e.msg));
  take(E.parseExport('', { accounts, years }));
  take(E.parseExport('\n;;\n', { accounts, years }));
  take(E.parseActuals('foo;bar;baz\nx;y;z', { accounts, years }));
  take(E.parseExport('month;account;amount;description\n2026-13;7620;12,00;x\n2024-09;7620;12,00;x\n2026-09;;abc;x\nlater;4700;5;y', { accounts, years }));
  take(E.parseExport('Datum;Konto;Opis;Debet;Kredit\n32.9.2026;4700;x;10,00;0\n30.9.2026;4700;x;abc;0\n30.9.2024;4700;x;1;0', { accounts, years }));
  take(E.parseExport('Konto;Naziv;Promet debet;Promet kredit\n4700;Plače;12x;0', { accounts, years, period: { y: 2026, m: 9, cumulative: false } }));
  (XLSX.match(/new Error\('((?:[^'\\]|\\.)*)'\)/g) || []).forEach((s) => msgs.push(unq(s.slice(10, -1))));
  const uniq = [...new Set(msgs)];
  assert.ok(uniq.length >= 9, uniq.length + ' messages: ' + uniq.join(' | '));
  assert.ok(uniq.some((s) => s.indexOf('; ') > 0), 'a row with several problems');
  ['sl', 'hr'].forEach((L) => noEnglish(L, uniq));
  assert.strictEqual(I.make('sl').x('"later" is not a month (use 2026-09 or 30. 9. 2026)'), '»later« ni mesec (uporabite 2026-09 ali 30. 9. 2026)');
  assert.strictEqual(I.make('hr').x('2024 is outside 2025 and 2026; the account is missing'), 'godina 2024. nije dopuštena (samo 2025 i 2026); nedostaje konto');
});

t('saved data: version names and notes, and every activity-log text the app and the demo data write', () => {
  const today = '2026-10-15', db = X.generate(today), texts = new Set();
  db.versions.forEach((v) => { texts.add(v.name); if (v.note) texts.add(v.note); });
  db.log.forEach((l) => texts.add(l.text));
  [E.forecastName(2026, 9), E.forecastName(2026, 7) + ' · 2', 'Made on 15. 10. 2026 from actuals for January–September and Budget 2026 for October–December.'].forEach((s) => texts.add(s));
  // every log text app.js commits, with example values
  ['Full-year outlook now uses the budget', 'Full-year outlook now uses the newest forecast', 'Budget 2026: Personnel filled in (spread like last year)', 'Forecast 2026 (Q3): Cost of goods sold filled in (% of revenue)',
    'Created Forecast 2026 (Q3)', 'Imported 1.234 rows of actuals for September 2026, October 2026, 2 new accounts', 'Imported 1 row of actuals for September 2026', 'Unlocked Budget 2026', 'Approved and locked Budget 2026',
    'Deleted Forecast 2026 (Q2)', 'Deleted a comment on Travel', 'Added a row to the headcount plan', 'Removed Warehouse operatives from the headcount plan', 'Removed a row from the headcount plan',
    'Closed through September by hand', 'Deleted account 4180', 'Edited a comment on Personnel, year to date', 'Added a comment on Marketing, March', 'Settings updated', 'Headcount plan assumptions updated',
    'Added account 4180', 'Headcount plan: a row changed', 'Account 4180 now feeds Other operating costs', 'Account 7620 is now an income account', 'Account 4180 is now a cost account',
    'Forecast 2026 (Q3): Personnel filled in from the headcount plan', 'Demo data created: 2026, closed through no month yet.'].forEach((s) => texts.add(s));
  // the commit texts in app.js all have an example here
  const commits = (APP.match(/commit\('([^']+)'/g) || []).map((s) => s.slice(8, -1));
  commits.forEach((c) => assert.ok([...texts].some((s) => s.indexOf(c.trim()) === 0), 'an example for commit text "' + c + '"'));
  ['sl', 'hr'].forEach((L) => noEnglish(L, [...texts]));
  assert.strictEqual(I.make('sl').x('Budget 2026'), 'Plan 2026');
  assert.strictEqual(I.make('hr').x('Forecast 2026 (Q3)'), 'Prognoza 2026 (Q3)');
  assert.strictEqual(I.make('sl').x('Closed through September by hand'), 'Ročno zaključeno do septembra');
  assert.strictEqual(I.make('hr').x('Made on 15. 10. 2026 from actuals for January–September and Budget 2026 for October–December.'), 'Izrađeno 15. 10. 2026. iz ostvarenja za siječanj–rujan i verzije Plan 2026 za listopad–prosinac.');
});

t('demo comments carry Slovene and Croatian texts, so the screens and the pack show them in the language', () => {
  const db = X.generate('2026-10-15');
  assert.ok(db.comments.length >= 5);
  db.comments.forEach((c) => ['sl', 'hr'].forEach((L) => assert.ok(E.commentText(c, L).inLang, L + ' ' + c.id)));
});

t('month names', () => {
  assert.strictEqual(I.make('sl').monthsLong[9], 'oktober');
  assert.strictEqual(I.make('hr').monthsLong[9], 'listopad');
  assert.strictEqual(I.make('sl').monthsGen[2], 'marca');
  assert.strictEqual(I.make('hr').monthsGen[10], 'studenoga');
  assert.strictEqual(I.make('hr').months[0], 'sij');
  assert.strictEqual(I.make('en').months[0], 'Jan');
  assert.deepStrictEqual(I.make('en').monthsLong, E.MONTHS_LONG);
});

t('app.js: ?lang= is read at startup, the choice is saved in the UI prefs, the pack follows the screens unless chosen', () => {
  assert.ok(/\[\?&\]lang=\(en\|sl\|hr\)/.test(APP), '?lang=');
  assert.ok(/ui\.lang = q\[1\]; saveUi\(\)/.test(APP), 'saved');
  assert.ok(/function packLang\(\) \{ return uPk\.picked && PACK_LANGS\[uPk\.lang\] \? uPk\.lang : LANG; \}/.test(APP), 'pack follows the screens');
  assert.ok(APP.includes("' — Business Apps'"), 'title suffix kept for the public build');
});

console.log(n + ' tests passed');
