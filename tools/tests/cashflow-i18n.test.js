// Tests for site/cashflow/i18n.js: every screen text app.js uses has a Slovene and a Croatian translation with the same
// {placeholders}; plural forms; the patterns that translate the English texts of the engine (remedies, categories),
// the importers (open items, camt.053 and bank CSV messages) and the demo data; the public build's rewrite of the two
// cloud-copy sentences. Run: node tools/tests/cashflow-i18n.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { pathToFileURL } = require('url');
const ROOT = path.join(__dirname, '../..');
const I18N_FILE = path.join(ROOT, 'site/cashflow/i18n.js');
const I = require(I18N_FILE);
const E = require(path.join(ROOT, 'site/cashflow/engine.js'));
const X = require(path.join(ROOT, 'site/cashflow/data.js'));
const IM = require(path.join(ROOT, 'site/cashflow/importers.js'));

let n = 0;
const tests = [];
function t(name, fn) { tests.push([name, fn]); }
const APP = fs.readFileSync(path.join(ROOT, 'site/cashflow/app.js'), 'utf8');
const I18N_SRC = fs.readFileSync(I18N_FILE, 'utf8');
const lit = (s) => s.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, '\\');
const holes = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(',');
const Q = "'(?:[^'\\\\]|\\\\.)*'";
// English words that must not be left in a Slovene or Croatian text
const ENGLISH = /\b(the|and|of|is|are|was|has|have|invoice|invoices|bill|bills|days?|rows?|amount|date|not|open|paid|skipped|statement|balance|customer|supplier|file|column|week|weeks|due|empty|number|closing|unclosed|tag|only|accounts?|used|line|total|future|header|check)\b/i;

/** every literal passed to tx(), th(), msg() and mini(), the {k: '…'} parts of stored texts, fld() labels, and the
 * tables of labels app.js passes through tx()/th() (pages, tabs, filters, sorts, frequencies, levers…) */
function appKeys(src) {
  const keys = new Set();
  let m;
  for (const re of [new RegExp('\\b(?:tx|th|msg|mini)\\(\\s*(' + Q + ')', 'g'), new RegExp('\\bk: (' + Q + ')', 'g'), new RegExp('\\bfld\\(\\s*' + Q + ',\\s*(' + Q + ')', 'g')]) {
    while ((m = re.exec(src))) keys.add(lit(m[1]));
  }
  const tern = new RegExp('\\b(?:tx|th)\\(\\s*[\\w.!=\' ]+\\?\\s*(' + Q + ')\\s*:\\s*(' + Q + ')', 'g');
  while ((m = tern.exec(src))) { keys.add(lit(m[1])); keys.add(lit(m[2])); }
  ['ROUTES', 'TABS', 'SCN_BTNS', 'AR_FILTERS', 'AR_SORTS', 'AP_FILTERS', 'AP_SORTS', 'FREQ', 'EVERY', 'ON_DAY', 'ON_LAST', 'LEVERS', 'BAL_TYPE', 'AR_STATUS', 'AP_STATUS'].forEach((name) => {
    const at = src.indexOf('var ' + name + ' = '); assert.ok(at >= 0, name);
    const body = src.slice(at, src.indexOf(';\n', at));
    (body.match(new RegExp(Q, 'g')) || []).map(lit)
      .filter((s) => /[A-Za-z]{2}/.test(s) && !/^[a-z]+[A-Z]\w*$/.test(s) && !/^[A-Z]{4}(\+entries)?$/.test(s) && !/^(CSV|days|base|pessimistic|optimistic|custom|weeks|months|receivables|payables|plan|scenarios|settings|home|grid|cal|ar|ap|scn|set|in|out|all|soon|hold|critical|expected|due|amount|customer|pay|supplier|weekly|monthly|quarterly|yearly|delay|sales|pipeline|open|overdue|disputed|doubtful)$/.test(s))
      .forEach((s) => keys.add(s));
  });
  // texts app.js passes on as variables: the cloud warning, the importer cards, the record-form hint, open/overdue statuses
  const cw = /var CLOUD_WARN = ('(?:[^'\\]|\\.)*');/.exec(src); assert.ok(cw, 'CLOUD_WARN'); keys.add(lit(cw[1]));
  ['Billing → Receivables', 'Invoices → Payables', '1–31, or 0 for the last working day. Weekly: 1 = Monday … 5 = Friday.', 'open', 'overdue', 'disputed', 'doubtful', 'on hold', 'Imported', 'Customer', 'Supplier'].forEach((s) => keys.add(s));
  // names from the engine and the importers that the app shows through tx()/th()
  E.CATS_IN.concat(E.CATS_OUT).forEach((c) => keys.add(c.name));
  Object.keys(E.SCENARIOS).forEach((k) => keys.add(E.SCENARIOS[k].name));
  keys.add(E.clampScenario({}).name);
  IM.FIELDS.ar.concat(IM.FIELDS.ap, IM.BANK_FIELDS).forEach((f) => keys.add(f.label));
  return keys;
}
function checkDict(keys, DICT) {
  const missing = [], bad = [];
  keys.forEach((k) => {
    const e = DICT[k];
    if (!e) { missing.push(k); return; }
    if (!(e.length === 2 && e[0] && e[1])) bad.push(k + ' (empty)');
    else if (holes(e[0]) !== holes(k) || holes(e[1]) !== holes(k)) bad.push(k + ' → ' + e.join(' | '));
  });
  assert.deepStrictEqual(missing, [], 'missing translations');
  assert.deepStrictEqual(bad, [], 'placeholders differ');
}

t('every screen text has a Slovene and a Croatian translation with the same placeholders', () => {
  const keys = appKeys(APP);
  assert.ok(keys.size > 600, 'found ' + keys.size + ' texts');
  checkDict(keys, I.DICT);
  // and the dictionary has no key twice (a second one would silently replace the first)
  const seen = {}, dup = []; let m; const re = new RegExp('^    (' + Q + '): \\[', 'gm');
  while ((m = re.exec(I18N_SRC))) { const k = lit(m[1]); if (seen[k]) dup.push(k); seen[k] = 1; }
  assert.deepStrictEqual(dup, []);
});

t('index.html: the texts shellText() sets are there, i18n.js loads before app.js', () => {
  const html = fs.readFileSync(path.join(ROOT, 'site/cashflow/index.html'), 'utf8');
  ['skipLink', 'menuLabel', 'brandName', 'brandSub', 'side', 'nav', 'tabbar', 'demoPill', 'demoText', 'settingsText', 'langLabel', 'uiLang', 'loadText'].forEach((id) => assert.ok(html.includes('id="' + id + '"'), id));
  assert.ok(html.indexOf('i18n.js?v=') > 0 && html.indexOf('i18n.js?v=') < html.indexOf('app.js?v='));
  assert.ok(/<option value="sl"[^>]*>Slovenščina<\/option>/.test(html) && /<option value="hr"[^>]*>Hrvatski<\/option>/.test(html));
  // the document title keeps the suffix the public build rewrites
  assert.ok(APP.includes("' — Business Apps';"));
});

t('translate: placeholders are filled, English stays English, an unknown text falls back to English', () => {
  const sl = I.make('sl'), hr = I.make('hr'), en = I.make('en');
  assert.strictEqual(sl.t('Week {n} · {range}', { n: 43, range: '19.–25. 10.' }), '43. teden · 19.–25. 10.');
  assert.strictEqual(hr.t('Payables'), 'Obveze');
  assert.strictEqual(en.t('Payables'), 'Payables');
  assert.strictEqual(sl.t('Not in the dictionary {x}', { x: 1 }), 'Not in the dictionary 1');
  assert.strictEqual(I.make('de').lang, 'en');
  assert.strictEqual(I.make('hr').t('Cash forecast'), 'Prognoza likvidnosti');
});

t('plural forms: Slovene 1 / 2 / 3–4 / 5+, Croatian 1 / 2–4 / 5+ (11–14 take the many form)', () => {
  const sl = I.make('sl'), hr = I.make('hr'), en = I.make('en');
  assert.deepStrictEqual([1, 2, 3, 4, 5, 11, 101, 102, 0].map((k) => sl.noun(k, 'invoice', 'invoices')), ['račun', 'računa', 'računi', 'računi', 'računov', 'računov', 'račun', 'računa', 'računov']);
  assert.deepStrictEqual([1, 2, 4, 5, 11, 12, 21, 22, 25].map((k) => hr.noun(k, 'bank account', 'bank accounts')), ['bankovni račun', 'bankovna računa', 'bankovna računa', 'bankovnih računa', 'bankovnih računa', 'bankovnih računa', 'bankovni račun', 'bankovna računa', 'bankovnih računa']);
  assert.deepStrictEqual([1, 2, 3, 5].map((k) => sl.noun(k, 'day', 'days')), ['dan', 'dneva', 'dnevi', 'dni']);
  assert.deepStrictEqual([1, 2].map((k) => en.noun(k, 'bill', 'bills')), ['bill', 'bills']);
  // every noun app.js counts has its four Slovene and three Croatian forms
  const used = new Set(['day']); let m;
  const re = /\b(?:plural|cnt)\([^,]+,\s*(?:\w+ \? )?'([^']+)'(?:\s*:\s*'([^']+)')?/g;
  while ((m = re.exec(APP))) { used.add(m[1]); if (m[2] && !/s$/.test(m[2])) used.add(m[2]); }
  assert.ok(used.size >= 15, [...used].join(', '));
  used.forEach((w) => { assert.ok(I.NOUNS[w], 'forms for ' + w); assert.strictEqual(I.NOUNS[w][0].length, 4, w); assert.strictEqual(I.NOUNS[w][1].length, 3, w); });
});

t('engine texts: categories, scenarios, remedies and forecast lines of the demo translate with no English left', () => {
  const today = '2026-10-16', texts = new Set();
  [X.generate(today), X.generateV1(today)].forEach((db) => {
    ['base', 'pessimistic', 'optimistic'].forEach((s) => ['behaviour', 'due'].forEach((mode) => {
      const f = E.forecast(db, { today, scenario: E.SCENARIOS[s], mode }), r = E.remedies(db, f);
      r.list.forEach((x) => { texts.add(x.title); if (x.id !== 'defer') texts.add(x.text); x.items.forEach((it) => { if (it.src !== 'ar' && it.src !== 'ap') texts.add(it.label); }); });
      f.items.forEach((it) => { if (it.src === 'rec' || it.src === 'plan') texts.add(it.label); });
      E.forecastMonths(db, { today, months: 15, scenario: E.SCENARIOS[s], mode }).items.forEach((it) => { if (it.src === 'rec' || it.src === 'plan') texts.add(it.label); });
    }));
    // the demo data shown on the screens: names, notes, segments, accounts, activity
    db.recurring.concat(db.planned).forEach((x) => { texts.add(x.name); if (x.note) texts.add(x.note); });
    db.accounts.forEach((a) => texts.add(a.name));
    db.customers.forEach((c) => texts.add(c.segment));
    db.ar.concat(db.ap).forEach((x) => (x.notes || []).forEach((no) => texts.add(no.text)));
    db.log.forEach((l) => texts.add(l.text));
  });
  ['Customer · 2026-00012', 'Supplier · RN-50001', 'Bank account 3', 'Account 4471'].forEach((s) => texts.add(s));
  assert.ok(texts.size > 60, texts.size + ' texts');
  ['sl', 'hr'].forEach((L) => {
    const x = I.make(L).x;
    texts.forEach((s) => {
      const out = x(s);
      assert.notStrictEqual(out, s, L + ': not translated: ' + s);
      assert.ok(!ENGLISH.test(out.replace(/Nordtherm|Planika|Lipa/g, '')), L + ': English left in "' + out + '" (from "' + s + '")');
    });
  });
  assert.strictEqual(I.make('sl').x('12 invoices are due before the low point but arrive after it, or are disputed. Chasing them now brings the money in before the low point.').indexOf('Računi: 12.'), 0);
  assert.strictEqual(I.make('hr').x('Part-paid: 1200,00 € still open of 5000,00 € .'.replace(' .', '.')), 'Djelomično plaćeno: otvoreno je još 1200,00 € od 5000,00 €.');
  assert.strictEqual(I.make('sl').x('Disputed: 40 radiators arrived damaged. Credit note under review.'), 'Sporno: 40 radiatorjev je prispelo poškodovanih. Dobropis v pregledu.');
});

/** every message the importers write for good and bad files */
function importerMessages() {
  const msgs = [];
  const add = (r) => { (r.errors || []).concat(r.warnings || []).forEach((m) => msgs.push(m)); };
  const today = '2026-10-15';
  ['ar', 'ap'].forEach((kind) => {
    const F = IM.FIELDS[kind], head = ['Number', 'Partner', 'VAT', 'Due', 'Issued', 'Open', 'Amount'];
    const map = IM.guessMapping(['št. računa', 'partner', 'id za ddv', 'datum zapadlosti', 'datum izdaje', 'odprto', 'znesek'], F);
    // a file with an error of every kind (any error blocks the whole import)
    add(IM.buildOpenItems([head,
      ['', 'X d.o.o.', '', '1.10.2026', '', '10', '10'],
      ['A1', '', '', '1.10.2026', '', '10', '10'],
      ['A2', 'X d.o.o.', '', '', '', '10', '10'],
      ['A3', 'X d.o.o.', '', 'soon', '', '10', '10'],
      ['A4', 'X d.o.o.', '', '1.10.2026', 'later', '10', '10'],
      ['A5', 'X d.o.o.', '', '1.10.2026', '', 'x', 'y'],
      ['A6', 'X d.o.o.', '', '1.10.2026', '', '', ''],
      ['A7', 'X d.o.o.', '', '1.9.2026', '1.10.2026', '10', '10'],
      ['A8', 'X d.o.o.', '', '1.10.2026', '', '10', '10'], ['A8', 'X d.o.o.', '', '1.10.2026', '', '10', '10'],
      ['A9', 'X d.o.o.', '', '1.10.2026', '', '20', '10']], map, { kind, headerRow: 0, today }));
    // a good file with notes: a total line, a credit note, a paid line, no issue date, dated in the future
    add(IM.buildOpenItems([head,
      ['B1', 'Y d.o.o.', '', '1.11.2026', '', '100', '100'],
      ['B2', 'Y d.o.o.', '', '1.11.2026', '1.10.2026', '-5', '-5'],
      ['B3', 'Y d.o.o.', '', '1.11.2026', '1.10.2026', '0', '50'],
      ['B4', 'Y d.o.o.', '', '1.12.2026', '20.10.2026', '40', '40'],
      ['', 'Skupaj', '', '', '', '140', '']], map, { kind, headerRow: 0, today }));
    add(IM.buildOpenItems([head, ['C1', 'Z d.o.o.', '', '1.11.2026', '', '0', '50']], map, { kind, headerRow: 0, today }));
    add(IM.buildOpenItems([head], map, { kind, headerRow: 0, today }));
    add(IM.buildOpenItems([['x']], { no: -1, party: -1, due: -1, open: -1, amount: -1 }, { kind, headerRow: 0, today }));
  });
  // bank CSV
  const bm = IM.guessMapping(['datum', 'stanje', 'znesek'], IM.BANK_FIELDS);
  add(IM.buildBankCsv([['Datum', 'Stanje', 'Znesek'], ['xx', '1', '1'], ['1.10.2026', 'abc', '1']], bm, { headerRow: 0 }));
  add(IM.buildBankCsv([['Datum', 'Stanje', 'Znesek'], ['', '', '']], bm, { headerRow: 0 }));
  add(IM.buildBankCsv([['Datum', 'Stanje', 'Znesek'], ['1.10.2026', '100', '10'], ['1.10.2026', '300', '200'], ['1.10.2026', '50', '-1']], bm, { headerRow: 0 }));
  add(IM.buildBankCsv([['a']], { date: -1, balance: -1 }, { headerRow: 0 }));
  // camt.053
  const bal = (cd, ccy) => '<Bal><Tp><CdOrPrtry><Cd>' + cd + '</Cd></CdOrPrtry></Tp><Amt Ccy="' + ccy + '">100.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-10-15</Dt></Dt></Bal>';
  ['<Document><BkToCstmrStmt><Stmt><Acct><Id><IBAN>SI56000000000000000</IBAN></Id></Acct></Stmt><Stmt><Acct><Id><IBAN>SI56000000000000001</IBAN></Id></Acct>' + bal('CLBD', 'USD') + '</Stmt></BkToCstmrStmt></Document>',
    '<Document><BkToCstmrStmt><Stmt><Acct></Acct></Stmt></BkToCstmrStmt></Document>',
    '<Document><BkToCstmrStmt></BkToCstmrStmt></Document>', '<Invoice/>', '<a><b>', '<a></b>', '<a><!-- x', '<a><![CDATA[ x', '<a><? x', '<a', '<a>< ></a>'].forEach((xml) => add(IM.parseCamt(xml)));
  return msgs;
}

t('importer texts: open-items, bank CSV and camt.053 messages translate with no English left', () => {
  const msgs = [...new Set(importerMessages())];
  assert.ok(msgs.length >= 35, msgs.length + ' messages');
  ['Choose the column for "Invoice number".', 'Row 2: the invoice number is empty.', 'This is not a readable XML file (Unclosed tag <b>).', 'Statement 1 (SI56000000000000000): no closing balance in the file.', 'The statement has no accounts in it.']
    .forEach((s) => assert.ok(msgs.includes(s), 'expected message: ' + s + '\n' + msgs.join('\n')));
  ['sl', 'hr'].forEach((L) => {
    const x = I.make(L).x;
    msgs.forEach((s) => {
      const out = x(s);
      assert.notStrictEqual(out, s, L + ': not translated: ' + s);
      assert.ok(!ENGLISH.test(out.replace(/BkToCstmrStmt|camt\.05\d|<\/?\w+>|"[^"]*"|X d\.o\.o\.|Y d\.o\.o\.|SI\d+/g, '')), L + ': English left in "' + out + '" (from "' + s + '")');
    });
  });
  assert.strictEqual(I.make('sl').x('Row 3: the customer is empty.'), 'Vrstica 3: kupec je prazen.');
  assert.strictEqual(I.make('hr').x('Choose the column for "Due date".'), 'Odaberite stupac za „Datum dospijeća”.');
  assert.strictEqual(I.make('sl').x('Row 5: due date "soon" is not a date (use 31.10.2026 or 2026-10-31).'), 'Vrstica 5: datum zapadlosti »soon« ni datum (uporabite 31.10.2026 ali 2026-10-31).');
});

t('CSV templates: the translated column names are recognised by the importer in every language', () => {
  ['en', 'sl', 'hr'].forEach((L) => {
    const tr = I.make(L).t;
    ['ar', 'ap'].forEach((kind) => {
      const head = [tr('Invoice number'), kind === 'ar' ? tr('Customer') : tr('Supplier'), tr('Issue date'), tr('Due date'), tr('Amount')];
      const m = IM.guessMapping(head, IM.FIELDS[kind]);
      assert.deepStrictEqual([m.no, m.party, m.issued, m.due, m.amount], [0, 1, 2, 3, 4], L + ' ' + kind + ': ' + head.join(';'));
    });
  });
});

t('month and weekday names', () => {
  assert.strictEqual(I.make('sl').monthsLong[9], 'oktober');
  assert.strictEqual(I.make('hr').monthsLong[0], 'siječanj');
  assert.strictEqual(I.make('hr').months[1], 'velj');
  assert.strictEqual(I.make('sl').weekdays[1], 'ponedeljek');
  assert.strictEqual(I.make('en').months[0], 'Jan');
});

t('public build: the rewritten cloud-copy sentences still translate, and the dictionary is not corrupted', async () => {
  const { publicAppJs } = await import(pathToFileURL(path.join(ROOT, 'tools/build-public.mjs')).href);
  const pubApp = publicAppJs(APP), pubI18n = publicAppJs(I18N_SRC);
  assert.ok(pubApp.includes("th('Nothing is sent anywhere: it all stays in this browser.')"), 'app.js sentence rewritten');
  assert.ok(pubApp.includes("var CLOUD_WARN = 'It only changes the data in this browser.';"), 'CLOUD_WARN rewritten');
  assert.ok(!pubApp.includes('Nothing is sent anywhere except your private cloud copy.') && !pubApp.includes('It also replaces your private cloud copy'));
  assert.strictEqual(pubI18n, I18N_SRC, 'the public build leaves i18n.js as it is');
  // load the public i18n.js as the browser would and check the public app.js against it
  const box = { self: {} }; vm.runInNewContext(pubI18n, box);
  const PI = box.self.CfI18n;
  checkDict(appKeys(pubApp), PI.DICT);
  ['sl', 'hr'].forEach((L) => {
    const tr = PI.make(L).t;
    ['Nothing is sent anywhere: it all stays in this browser.', 'It only changes the data in this browser.', 'Nothing is sent anywhere except your private cloud' + ' copy.', 'It also replaces your private cloud copy, so every device you use' + ' (phone and computer) gets it too.']
      .forEach((s) => { assert.notStrictEqual(tr(s), s, L + ': ' + s); assert.ok(!ENGLISH.test(tr(s)), tr(s)); });
  });
  assert.strictEqual(PI.make('sl').t('It only changes the data in this browser.'), 'Spremeni samo podatke v tem brskalniku.');
  assert.ok(!/ — Business Apps['"]/.test(publicAppJs(APP)), 'title suffix rewritten');
});

(async () => {
  for (const [name, fn] of tests) { await fn(); n++; console.log('ok', n, name); }
  console.log(n + ' tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
