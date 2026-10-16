// Tests for site/datacheck/i18n.js: every screen text app.js uses has a Slovene and a Croatian translation with the same
// {placeholders}; plural forms; the texts engine.js writes in English (rule titles and explanations, roles, groups, the
// sentence for every problem the real engine finds in the three demo files and in deliberately bad input, progress labels,
// undo steps) translate with no English left; the report's languages; month names.
// Run: node tools/tests/datacheck-i18n.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const I = require(path.join(__dirname, '../../site/datacheck/i18n.js'));
const E = require(path.join(__dirname, '../../site/datacheck/engine.js'));
const X = require(path.join(__dirname, '../../site/datacheck/data.js'));

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok', n, name); }
const APP = fs.readFileSync(path.join(__dirname, '../../site/datacheck/app.js'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, '../../site/datacheck/index.html'), 'utf8');
const lit = (s) => s.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, '\\').replace(/\\t/g, '\t');
const holes = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(',');
const TODAY = '2026-10-16';

/** every literal passed to tx(), plus the texts app.js passes through tables (TABS, SEV_NAME, BAND, row labels…) */
function appKeys() {
  const keys = new Set();
  let m;
  const direct = /\btx\(\s*('(?:[^'\\]|\\.)*')/g;
  while ((m = direct.exec(APP))) keys.add(lit(m[1]));
  // tx(cond ? 'a' : other ? 'b' : 'c'): the first argument, read with balanced brackets, and every literal after ? or :
  const open = /\btx\(/g;
  while ((m = open.exec(APP))) {
    let i = m.index + 3, depth = 0, q = false, arg = '';
    for (; i < APP.length; i++) {
      const ch = APP[i];
      if (q) { arg += ch; if (ch === '\\') { arg += APP[++i]; continue; } if (ch === "'") q = false; continue; }
      if (ch === "'") { q = true; arg += ch; continue; }
      if (ch === '(' || ch === '[' || ch === '{') depth++;
      if (ch === ')' || ch === ']' || ch === '}') { if (!depth) break; depth--; }
      if (ch === ',' && !depth) break;
      arg += ch;
    }
    if (/^\s*'/.test(arg) || !/\?/.test(arg.replace(/'(?:[^'\\]|\\.)*'/g, ''))) continue;
    let k; const after = /[?:]\s*('(?:[^'\\]|\\.)*')/g;
    while ((k = after.exec(arg))) keys.add(lit(k[1]));
  }
  // object tables whose values go through tx(): tx({ a: 'Text' }[k])
  const tables = /tx\(\{([^}]*)\}\[/g;
  while ((m = tables.exec(APP))) { (m[1].match(/'(?:[^'\\]|\\.)*'(?=\s*[,}]|\s*$)/g) || []).forEach((q) => keys.add(lit(q))); }
  ['TABS', 'SEV_NAME', 'BAND', 'ISSUE_COLS', 'MAP_COLS'].forEach((name) => {
    const at = APP.indexOf('var ' + name + ' = '); assert.ok(at >= 0, name);
    const body = APP.slice(at, APP.indexOf(';\n', at));
    (body.match(/'(?:[^'\\]|\\.)*'/g) || []).map(lit).filter((s) => /[A-Z ]/.test(s)).forEach((s) => keys.add(s));
  });
  // the rows-tab filters, the severity filter, delimiter buttons and the tables in functions (seen in tx(x[1]) / tx(t[1]))
  ['All', 'Errors', 'Warnings', 'Notes', 'semicolon-separated', 'comma-separated', 'tab-separated', 'pipe-separated', 'semicolon', 'comma', 'tab', 'pipe'].forEach((s) => keys.add(s));
  X.DEMOS.forEach((d) => { keys.add(d.title); keys.add(d.sub); });
  // the static texts of index.html are set by shellText() through tx() literals; make sure each is one of them
  ['Skip to content', 'Menu', 'Data health check', 'Files stay in this browser', 'Language', 'Demo data · saved in this browser only', 'Opening the data health check…', 'Drop the file to check it', 'Progress'].forEach((s) => {
    assert.ok(HTML.includes(s), 'index.html has ' + s); assert.ok(keys.has(s), 'shellText translates ' + s);
  });
  return keys;
}

t('every screen text has a Slovene and a Croatian translation with the same placeholders', () => {
  const keys = appKeys(), missing = [], bad = [];
  assert.ok(keys.size > 450, 'found ' + keys.size + ' texts');
  keys.forEach((k) => {
    const e = I.DICT[k];
    if (!e) { missing.push(k); return; }
    if (!(e.length === 2 && e[0] && e[1])) bad.push(k + ' (empty)');
    else if (holes(e[0]) !== holes(k) || holes(e[1]) !== holes(k)) bad.push(k + ' → ' + e.join(' | '));
  });
  if (missing.length && process.env.DC_MISSING) fs.writeFileSync(process.env.DC_MISSING, missing.map((s) => JSON.stringify(s)).join('\n') + '\n');
  assert.deepStrictEqual(missing, [], 'missing translations');
  assert.deepStrictEqual(bad, [], 'placeholders differ');
});

t('every dictionary entry has both translations, and markup and quotes stay balanced', () => {
  const bad = [];
  Object.keys(I.DICT).forEach((k) => {
    const e = I.DICT[k];
    if (!Array.isArray(e) || e.length !== 2 || !e[0] || !e[1]) { bad.push(k); return; }
    const tags = (s) => (s.match(/<\/?[a-z]+/g) || []).sort().join(',');
    if (tags(e[0]) !== tags(k) || tags(e[1]) !== tags(k)) bad.push('tags: ' + k);
    if ((e[0].match(/»/g) || []).length !== (e[0].match(/«/g) || []).length) bad.push('sl quotes: ' + k);
    if ((e[1].match(/„/g) || []).length !== (e[1].match(/”/g) || []).length) bad.push('hr quotes: ' + k);
    if (/[»«]/.test(e[1])) bad.push('hr uses Slovene quotes: ' + k);
  });
  assert.deepStrictEqual(bad, []);
});

t('translate: placeholders are filled, English stays English, an unknown text falls back to English', () => {
  const sl = I.make('sl'), hr = I.make('hr'), en = I.make('en');
  assert.strictEqual(sl.t('Fix {n} values', { n: 12 }), 'Popravi 12 vrednosti');
  assert.strictEqual(hr.t('Settings'), 'Postavke');
  assert.strictEqual(en.t('Settings'), 'Settings');
  assert.strictEqual(sl.t('Not in the dictionary {x}', { x: 1 }), 'Not in the dictionary 1');
  assert.strictEqual(I.make('de').lang, 'en');
  assert.strictEqual(sl.q('Naziv'), '»Naziv«');
  assert.strictEqual(hr.q('Naziv'), '„Naziv”');
  assert.strictEqual(en.q('Name'), 'Name');
  assert.strictEqual(en.q('Name', true), '“Name”');
});

t('plural forms: Slovene 1 / 2 / 3–4 / 5+, Croatian 1 / 2–4 / 5+ (11–14 take the many form)', () => {
  const sl = I.make('sl'), hr = I.make('hr'), en = I.make('en');
  assert.deepStrictEqual([1, 2, 3, 4, 5, 11, 101, 102, 0].map((k) => sl.noun(k, 'row', 'rows')), ['vrstica', 'vrstici', 'vrstice', 'vrstice', 'vrstic', 'vrstic', 'vrstica', 'vrstici', 'vrstic']);
  assert.deepStrictEqual([1, 2, 4, 5, 11, 12, 21, 22, 25].map((k) => hr.noun(k, 'row', 'rows')), ['redak', 'retka', 'retka', 'redaka', 'redaka', 'redaka', 'redak', 'retka', 'redaka']);
  assert.deepStrictEqual([1, 2, 5].map((k) => sl.noun(k, 'row', 'rows', 'in')), ['vrstici', 'vrsticah', 'vrsticah']);
  assert.deepStrictEqual([1, 3, 5].map((k) => hr.noun(k, 'group', 'groups', 'in')), ['skupini', 'skupine', 'skupina']);
  assert.deepStrictEqual([1, 2].map((k) => en.noun(k, 'cell', 'cells')), ['cell', 'cells']);
  assert.strictEqual(en.noun(3, 'row', 'rows', 'in'), 'rows');
  // every noun app.js counts has its forms (the types' one/many too)
  const used = new Set(); let m; const re = /plural\([^,]+,\s*'([^']+)',\s*'[^']+'(?:,\s*'([^']+)')?/g;
  while ((m = re.exec(APP))) { used.add(m[1]); if (m[2]) used.add(m[1] + '@' + m[2]); }
  E.TYPES.forEach((x) => used.add(x.one));
  assert.ok(used.size >= 12, [...used].join(', '));
  used.forEach((w) => { assert.ok(I.NOUNS[w], 'forms for ' + w); assert.strictEqual(I.NOUNS[w][0].length, 4, w); assert.strictEqual(I.NOUNS[w][1].length, 3, w); });
});

const SAME = new Set(['OIB', 'IBAN', 'BIC', 'Date', 'ISO-8859-2 (Latin-2)']); // the same word in all three languages
// common English words that must not survive a translation (demo data and codes aside)
const ENGLISH = /\b(the|and|with|is|are|not|of|for|has|have|row|rows|column|value|values|digits?|characters?|postal|code|country|prefix|missing|empty|should|written|format|number|numbers|spaces?|valid|looks?|duplicate|same|fixed|edited|recommended|official|list|while|most|date|dates|between)\b/i;
function noEnglish(L, s, out) {
  const clean = out.replace(/"[^"]*"|»[^«]*«|„[^”]*”|@\S+|https?:\S+|\b[A-Z]{2,}[\w-]*\b|Pošta Slovenije|Hrvatska pošta|Jaro-Winkler|mod 97|Word|Excel|d\.o\.o\.|GmbH|s\.p\.|obrt|BT-\d+|EN 16931/g, '');
  const w = ENGLISH.exec(clean);
  assert.ok(!w, L + ': English "' + (w && w[0]) + '" left in "' + out + '" (from "' + s + '")');
}

t('engine texts: rule titles and explanations, roles, groups, types, e-invoice criteria and progress labels', () => {
  const texts = [];
  E.RULE_LIST.forEach((k) => { texts.push(E.RULES[k].title, E.RULES[k].why); });
  E.ROLES.forEach((r) => texts.push(r.name));
  E.GROUPS.forEach((g) => texts.push(g[1]));
  E.TYPES.forEach((x) => texts.push(x.name, x.many));
  E.EINV.forEach((x) => texts.push(x[1], x[2]));
  ['Reading columns', 'Checking values', 'Profiling columns', 'Looking for duplicates', 'Scoring'].forEach((s) => texts.push(s));
  E.ENCODINGS.forEach((x) => { if (/\(/.test(x[1])) texts.push(x[1]); });
  E.DELIMS.forEach((d) => texts.push(E.delimName(d)));
  ['sl', 'hr'].forEach((L) => {
    const x = I.make(L).x;
    texts.forEach((s) => {
      const out = x(s);
      if (!SAME.has(s)) assert.notStrictEqual(out, s, L + ': not translated: ' + s);
      noEnglish(L, s, out);
    });
  });
  // the engine's own texts stay English
  assert.strictEqual(E.RULES['vat.checksum'].title, 'VAT ID check digit is wrong');
});

/** every message the real engine writes for a table: issues, structure notes */
function messages(table, cfg) {
  const res = E.analyze(table, cfg), out = new Set();
  res.issues.forEach((x) => out.add(E.message(x, { table, res })));
  res.structure.forEach((x) => out.add(E.message(x, { table, res })));
  return { res, out };
}
function cfgFor(table, name, type) {
  const setup = E.autoSetup(table, name, 'SI'), ty = type || setup.type;
  return { type: ty, roles: setup.roles, required: E.DEFAULT_REQ[ty].required, recommended: E.DEFAULT_REQ[ty].recommended, home: 'SI', vatRates: [22, 9.5, 5], today: TODAY,
    unitTarget: null, dupThreshold: 85, survivors: {}, notDup: {}, vies: null };
}
function tableOf(text) {
  const p = E.parseCsv(text, E.sniffDelimiter(text));
  return E.buildTable(p.rows, p.lines, E.detectHeader(p.rows).index);
}

t('engine texts: every message for the three demo files translates with no English left', () => {
  const all = new Set(), kinds = new Set();
  X.DEMOS.forEach((d) => {
    const f = X.file(d.id, TODAY), dec = E.decode(f.bytes);
    const table = tableOf(dec.text), cfg = cfgFor(table, f.name, d.type);
    const { res, out } = messages(table, cfg);
    assert.ok(out.size > 20, d.id + ': ' + out.size + ' messages');
    out.forEach((s) => all.add(s));
    res.issues.forEach((x) => kinds.add(x.k));
    const ei = E.einvoice(res, table); if (ei) ei.crit.forEach((c) => all.add(c.name));
  });
  assert.ok(kinds.size > 35, kinds.size + ' kinds of problem');
  ['sl', 'hr'].forEach((L) => {
    const x = I.make(L).x;
    all.forEach((s) => { const out = x(s); if (!SAME.has(s)) assert.notStrictEqual(out, s, L + ': not translated: ' + s); noEnglish(L, s, out); });
  });
});

t('engine texts: deliberately bad input (every kind of message) translates', () => {
  const bad = [
    'Šifra;Naziv;Ulica;Pošta;Kraj;Država;ID za DDV;OIB;Matična;IBAN;BIC;E-pošta;Telefon;Splet;Datum',
    'A1;ACME D.O.O.;Glavna 1;1000;Maribor;Slovenija;SI12345678;12345678901;123;SI56 0110 0100 0000 000;ABCDSI2X;ana@gmial.com;041 123;www;31.02.2026',
    'A1;  Beta  d.o.o. ;Cesta 2;99999;Celje;SLO;DE123;1234567890;12345678901;HR12 3456;LJBASI2X;x y@z;+385 1 12;ht tp://x;2030-01-01',
    'A3;Gama;Ulica 3;SI-1000;Ljubljana;Neverland;XX123456789;abc;1234567;0510-0801-0000-000;BANKHRXX;a@b.c, d@e.f;041 111 222 / 031 222 333;x.si;5.4.2026',
    'A4;-;n/a;1000;Ljubljana;HR;GR123456789;;;DE89370400440532013000;LJBASI2X;mailto:ana@x.si;+386 41 123 456 789;;45000',
    'A5;Delta �;Ulica 5;10000;Zagreb;Hrvatska;HR12345678901;12345678903;;SI56011001000000000;;ana@@x.si;abc;;2026/13/45',
    'A6;Ã…Â¡ola;Ulica\t6;2000;Celje;SI;SI 1234 5678;;;si56 0110 0100 0000 000;ljbasi2x;ana@gmail.con;0038641123456;;1.1.2026',
    'A7;Epsilon;Ulica 7;1067;Berlin;DE;ATU1234567;;;HR1210010051863000160;ZABAHR2X;ana.x@;01 4567 890;;2026-01-01',
    'A8;Zeta;Ulica 8;10115;Berlin;Germany;FR12345678901;;;AT611904300234573201;BKAUATWW;ana@x;;;3.4.2026'
  ].join('\n');
  const t1 = tableOf(bad), m1 = messages(t1, cfgFor(t1, 'bad.csv', 'customers'));
  const prod = [
    'Šifra;Naziv;EAN;Enota;Cena;DDV;Datum',
    'P1;Vijak M8;3,83E+12;kos;12,50;22;1.1.2026',
    'P2;Vijak M8;3830000000013;KOS;12.50;0,22;2.1.2026',
    'P3;Matica;383000000001;kom;-5;9,5;3.1.2026',
    'P4;Podložka;12345;pcs;0;8;4.1.2026',
    'P5;Ključ;383000000001x;kos;1.234,00 €;abc;2026-01-05',
    'P6;Ključ 2;3830000000020;kos;99999;22;45000',
    'P7;Ključ 3;3830000000037;kos;12,40;22;7.1.2026',
    'P8;Ključ 4;3830000000044;kos;12,60;22;8.1.2026',
    'P9;Ključ 5;3830000000051;kos;abc;22;9.1.2026',
    'P1;Ključ 6;3830000000013;kos;12,70;22;2099-01-01'
  ].join('\n');
  const t2 = tableOf(prod), m2 = messages(t2, cfgFor(t2, 'cenik.csv', 'products'));
  const t3 = tableOf('Naziv;Telefon\nAlfa;041 123 456\nBeta;01 234 56 78'), m3 = messages(t3, cfgFor(t3, 'x.csv', 'customers'));
  const all = new Set([...m1.out, ...m2.out, ...m3.out]);
  // sentences with variants the files above may not reach
  ['Croatian numbers have 8 or 9 digits after +385; this one has 6.', 'Slovene numbers have 8 digits after +386 (9 with the leading 0).', 'Too many digits for a phone number.',
    'Lost its leading zeros (11 digits): Excel drops zeros at the start of numbers. With them back it is a valid barcode.', 'Written as an Excel serial number, while most dates in this column use another format.',
    'Not a valid the Netherlands VAT ID: expected NL, 9 digits, B and 2 digits. Format check only: there is no check-digit test for this country here.', 'Not a valid Slovenia VAT ID: expected SI and 8 digits, not starting with 0.',
    'Not a valid Sweden VAT ID: expected SE and 12 digits ending in 01. Format check only: there is no check-digit test for this country here.',
    'Poland postal codes have the form 12-345.', 'the Netherlands postal codes have 4 digits and 2 letters.', 'Czechia postal codes have 5 digits (123 45).', 'Lost its leading zero: Germany postal codes have 5 digits.',
    'VIES says this VAT ID is not valid (checked 16. 10. 2026).', 'VIES says this VAT ID is not valid.', '"XX" is not an IBAN country.', 'Austria IBANs have 20 characters; this one has 22.',
    'The BIC is for a bank in Croatia but the IBAN is from Slovenia.', 'Spaces at the start or end fixed in row 12', 'Written in capitals fixed', 'Row 7 edited', 'Recipe "Monthly ERP export"', 'All one-click fixes',
    'Same VAT ID as row 3, 5, 9, but the records look different: a branch, or a VAT ID copied to the wrong record.', 'Same barcode as row 4.', '22,5 % is not a Croatia VAT rate in Settings.',
    'Far from the other prices (the middle half is between 10,00 € and 14,00 €).', 'Unknown country.', 'Not a valid date.'].forEach((s) => all.add(s));
  assert.ok(all.size > 70, all.size + ' messages');
  ['sl', 'hr'].forEach((L) => {
    const x = I.make(L).x;
    all.forEach((s) => { const out = x(s); if (!SAME.has(s)) assert.notStrictEqual(out, s, L + ': not translated: ' + s); noEnglish(L, s, out); });
  });
  const sl = I.make('sl').x, hr = I.make('hr').x;
  assert.strictEqual(sl('No Postal code column, which customers need. Mark a column with this role on the Columns tab, or add it to the export.'), 'Ni stolpca »Poštna številka«, ki ga potrebujejo kupci. To vlogo dodelite stolpcu na zavihku Stolpci ali ga dodajte v izvoz.');
  assert.strictEqual(hr('Name is empty, and suppliers need it.'), 'Polje „Naziv” je prazno, a dobavljači ga trebaju.');
  assert.strictEqual(sl('Austria IBANs have 20 characters; this one has 22.'), 'IBAN-i (država: Avstrija) imajo 20 znakov; ta jih ima 22.');
  assert.strictEqual(hr('Not a valid Slovenia VAT ID: expected SI and 8 digits, not starting with 0.'), 'Nije valjan PDV ID (država: Slovenija): očekuje se SI i 8 znamenki, prva nije 0.');
  assert.strictEqual(sl('Czechia postal codes have 5 digits (123 45).'), 'Poštne številke (država: Češka) imajo 5 števk (123 45).');
  assert.strictEqual(hr('1000 is the postal code of Ljubljana.'), '1000 je poštanski broj mjesta Ljubljana.');
  assert.strictEqual(sl('Spaces at the start or end fixed in row 12'), 'Presledki na začetku ali koncu – popravljeno v vrstici 12');
});

t('import and parse texts: Excel, encodings, the column names of a file without a header', () => {
  ['sl', 'hr'].forEach((L) => {
    const x = I.make(L).x;
    ['The Excel reader did not start.', 'Windows-1250 (Central European)', 'Windows-1252 (Western)'].forEach((s) => { assert.notStrictEqual(x(s), s); noEnglish(L, s, x(s)); });
  });
  // a file without a header row gets "Column 1, 2…" from the engine: these are column names (data), kept as they are
  const tb = E.buildTable([['1', '2'], ['3', '4']], [1, 2], -1);
  assert.deepStrictEqual(tb.headers, ['Column 1', 'Column 2']);
});

t('the report keeps its three languages and takes rule titles and roles from the dictionary', () => {
  const at = APP.indexOf('var L = {'), body = APP.slice(at, APP.indexOf('\n  };\n', at));
  ['en:', 'sl:', 'hr:'].forEach((k) => assert.ok(body.includes(k + ' {'), k));
  assert.ok(/function reportLang\(\) \{ return L\[db\.settings\.reportLang\] \? db\.settings\.reportLang : LANG; \}/.test(APP), 'report follows the screen language unless one is picked');
  assert.ok(/reportLang === 'en' && !s\.reportLangSet/.test(APP), 'an old default "en" does not force English');
  const sl = I.make('sl').x;
  assert.strictEqual(sl(E.RULES['vat.vies'].title), 'ID za DDV ni veljaven v sistemu VIES');
  assert.strictEqual(sl(E.ROLE.postal.name), 'Poštna številka');
  assert.strictEqual(I.make('hr').x('E-mail for invoices'), 'E-pošta za račune');
});

t('the screen language is saved with the UI preferences and read from ?lang=', () => {
  assert.ok(/saveUi\(\) \{ lsSet\(UIKEY, JSON\.stringify\(\{ sev: ui\.sev, exp: ui\.exp, lang: ui\.lang \}\)\); \}/.test(APP));
  assert.ok(/URLSearchParams\(location\.search\)\.get\('lang'\)/.test(APP));
  assert.ok(/<select id="uiLang">/.test(HTML) && /Slovenščina/.test(HTML) && /Hrvatski/.test(HTML));
  assert.ok(/i18n\.js\?v=\d+"><\/script>\s*<script src="data\.js/.test(HTML), 'i18n.js loads before app.js');
});

t('month and weekday names', () => {
  assert.strictEqual(I.make('sl').monthsLong[9], 'oktober');
  assert.strictEqual(I.make('hr').monthsLong[9], 'listopad');
  assert.strictEqual(I.make('hr').weekdays[4], 'četvrtak');
  assert.strictEqual(I.make('en').months[0], 'Jan');
});

console.log(n + ' tests passed');
