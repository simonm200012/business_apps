// Tests for site/collections/i18n.js: every screen text app.js uses has a Slovene and a Croatian translation with the
// same {placeholders}; plural forms; the patterns that translate the engine's English texts (reasons, skips, import
// and bank messages). Run: node tools/tests/collections-i18n.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const I = require(path.join(__dirname, '../../site/collections/i18n.js'));
const E = require(path.join(__dirname, '../../site/collections/engine.js'));
const D = require(path.join(__dirname, '../../site/collections/data.js'));
const B = require(path.join(__dirname, '../../site/collections/bank.js'));

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok', n, name); }
const APP = fs.readFileSync(path.join(__dirname, '../../site/collections/app.js'), 'utf8');
const lit = (s) => s.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, '\\');
const holes = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(',');

/** every literal passed to tx(), plus the texts app.js passes through tables (NAV, status maps, field labels…) */
function appKeys() {
  const keys = new Set();
  let m;
  const direct = /\btx\(\s*('(?:[^'\\]|\\.)*')/g;
  while ((m = direct.exec(APP))) keys.add(lit(m[1]));
  const ternary = /\btx\(\s*[\w.!=' ]+\?\s*('(?:[^'\\]|\\.)*')\s*:\s*('(?:[^'\\]|\\.)*')/g;
  while ((m = ternary.exec(APP))) { keys.add(lit(m[1])); keys.add(lit(m[2])); }
  // object and array tables whose values go through tx(): { a: 'Text' }[k] and [['id', 'Text', …]]
  const tables = /tx\(\{([^}]*)\}\[/g;
  while ((m = tables.exec(APP))) { (m[1].match(/'(?:[^'\\]|\\.)*'(?=\s*[,}]|\s*$)/g) || []).forEach((q) => keys.add(lit(q))); }
  ['NAV', 'OUTS', 'STAGE_SHORT', 'BANK_NOTE', 'TITLES'].forEach((name) => {
    const at = APP.indexOf('var ' + name + ' = '); assert.ok(at >= 0, name);
    const body = APP.slice(at, APP.indexOf(';\n', at));
    (body.match(/'(?:[^'\\]|\\.)*'/g) || []).map(lit).filter((s) => /[A-Z ]/.test(s) && !/^[a-z-]+$/.test(s)).forEach((s) => keys.add(s));
  });
  // labels and lists in app.js passed on through tx(x[1]), tx(label[1]), tx(o[1]), tx(r[0]) and the CSV headers
  ['Overdue', 'On hold', 'Open promise', 'Over credit limit', 'On track', 'Instalment late', 'Completed', 'Cancelled', 'Call · reached', 'Call · no answer', 'E-mail', 'Note',
    'Invoice number', 'Customer', 'Due date', 'Invoice amount (gross)', 'Issue date', 'Open amount', 'Customer VAT ID', 'Country', 'E-mail, phone', 'Debit / credit', 'yes', 'no',
    'By reference', 'By payer and amount', 'To check', 'Not matched', 'Skipped (already recorded, other currency, pending)', 'Outgoing, ignored',
    'The payment reference (sklic, poziv na broj): SI00 or HR00 with the invoice number, as on the letters and invoices, also RF references and the invoice number in the purpose text.',
    'The payer: a bank account remembered from an earlier payment, or the payer\'s name, together with the amount (one invoice, or the oldest ones adding up to it).', 'The amount alone, only as a suggestion you have to tick.',
    'customer no', 'customer', 'country', 'VAT ID', 'segment', 'terms', 'credit limit', 'open', 'overdue', 'disputed', 'oldest days overdue', 'last letter', 'letter due today', 'last contact', 'open promise', 'risk', 'days late 12 months', 'on hold',
    'invoice', 'customer VAT ID', 'issue date', 'due date', 'amount', 'paid', 'days overdue', 'bucket', 'dispute reason', 'payment reference', 'worse', 'better', 'steady',
    'Installer', 'Contractor', 'Retail chain', 'Public sector', 'End customer', 'Imported', 'OK', 'Watch', 'High'].forEach((s) => keys.add(s));
  E.IMPORT_FIELDS.forEach((f) => keys.add(f.label));
  B.BANK_FIELDS.forEach((f) => keys.add(f.label));
  E.DEFAULT_STAGES.forEach((s) => keys.add(s.name));
  return keys;
}

t('every screen text has a Slovene and a Croatian translation with the same placeholders', () => {
  const keys = appKeys(), missing = [], bad = [];
  assert.ok(keys.size > 600, 'found ' + keys.size + ' texts');
  keys.forEach((k) => {
    const e = I.DICT[k];
    if (!e) { missing.push(k); return; }
    if (!(e.length === 2 && e[0] && e[1])) bad.push(k + ' (empty)');
    else if (k !== '{x} by {date}' && (holes(e[0]) !== holes(k) || holes(e[1]) !== holes(k))) bad.push(k + ' → ' + e.join(' | '));
  });
  assert.deepStrictEqual(missing, [], 'missing translations');
  assert.deepStrictEqual(bad, [], 'placeholders differ');
});

t('translate: placeholders are filled, English stays English, an unknown text falls back to English', () => {
  const sl = I.make('sl'), hr = I.make('hr'), en = I.make('en');
  assert.strictEqual(sl.t('Letters ready ({n})', { n: 4 }), 'Pripravljeni dopisi (4)');
  assert.strictEqual(hr.t('Who to chase today'), 'Koga danas požuriti');
  assert.strictEqual(en.t('Who to chase today'), 'Who to chase today');
  assert.strictEqual(sl.t('Not in the dictionary {x}', { x: 1 }), 'Not in the dictionary 1');
  assert.strictEqual(I.make('de').lang, 'en');
});

t('plural forms: Slovene 1 / 2 / 3–4 / 5+, Croatian 1 / 2–4 / 5+ (11–14 take the many form)', () => {
  const sl = I.make('sl'), hr = I.make('hr'), en = I.make('en');
  assert.deepStrictEqual([1, 2, 3, 4, 5, 11, 101, 102, 0].map((k) => sl.noun(k, 'invoice', 'invoices')), ['račun', 'računa', 'računi', 'računi', 'računov', 'računov', 'račun', 'računa', 'računov']);
  assert.deepStrictEqual([1, 2, 4, 5, 11, 12, 21, 22, 25].map((k) => hr.noun(k, 'customer', 'customers')), ['kupac', 'kupca', 'kupca', 'kupaca', 'kupaca', 'kupaca', 'kupac', 'kupca', 'kupaca']);
  assert.deepStrictEqual([1, 2].map((k) => en.noun(k, 'letter', 'letters')), ['letter', 'letters']);
  // every noun app.js counts has its forms
  const used = new Set(); let m; const re = /plural\([^,]+,\s*'([^']+)'/g;
  while ((m = re.exec(APP))) used.add(m[1]);
  used.add('day');
  used.forEach((w) => { assert.ok(I.NOUNS[w], 'forms for ' + w); assert.strictEqual(I.NOUNS[w][0].length, 4); assert.strictEqual(I.NOUNS[w][1].length, 3); });
});

t('engine texts: every skip reason, call-priority reason and bucket of the demo data is translated', () => {
  const today = '2026-10-15', db = D.generate(today), st = E.analyzeAll(db, today), texts = new Set();
  Object.keys(st).forEach((id) => { const s = st[id]; if (s.dunning.skip) texts.add(s.dunning.skip.text); s.priority.reasons.forEach((r) => { texts.add(r.label); if (r.detail) texts.add(r.detail); }); });
  E.BUCKETS.forEach((b) => { texts.add(b.name); texts.add(b.short); });
  ['Spoke to them yesterday (promise)', 'E-mail exchange 3 days ago', 'Promise logged today', 'Payment plan agreed 2 days ago', 'Dispute logged today', 'Contacted yesterday', 'Last letter 4 days ago, next possible 21. 10.', 'Final notice sent 2. 10.: decide on legal action', 'All overdue invoices are disputed', 'On a payment plan, instalments paid on time', 'Promised 1.200 € by 20. 10.'].forEach((s) => texts.add(s));
  ['sl', 'hr'].forEach((L) => {
    const x = I.make(L).x;
    texts.forEach((s) => {
      if (/^(\d+–\d+|180\+)$/.test(s)) return; // bucket shorts are numbers
      const out = x(s);
      assert.notStrictEqual(out, s, L + ': not translated: ' + s);
      assert.ok(!/\b(days|overdue|promise|letter|today|yesterday|ago)\b/.test(out), L + ': English left in "' + out + '" (from "' + s + '")');
    });
  });
  assert.strictEqual(I.make('sl').x('45 days overdue'), '45 dni zamude');
  assert.strictEqual(I.make('hr').x('12.400 € overdue'), 'dospjelo 12.400 €');
  assert.strictEqual(I.make('sl').x('Spoke to them yesterday (promise)'), 'Pogovor včeraj (obljuba)');
  assert.strictEqual(I.make('hr').x('Last letter 4 days ago, next possible 21. 10.'), 'Zadnji dopis prije 4 dana, sljedeći moguć 21. 10.');
});

t('engine texts: import and bank-statement messages are translated', () => {
  const rows = [['number', 'customer', 'issue_date', 'due_date', 'amount', 'open', 'vat_id'], ['A1', '', '1.9.2026', 'x', '-5', 'y', ''], ['A2', 'B', '', '1.10.2026', '100', '0', ''], ['A2', 'B', '', '1.10.2026', '100', '', 'SI11111111'], ['A3', 'C', '5.10.2026', '1.10.2026', '50', '60', '']];
  const msgs = [];
  const r1 = E.buildImport(rows, E.guessMapping(rows[0]), { today: '2026-10-15' }); r1.errors.concat(r1.warnings).forEach((e) => msgs.push(e.msg));
  const r2 = E.buildImport([['number', 'customer', 'due_date', 'amount', 'vat_id'], ['Z1', 'X', '1.10.2026', '10', 'SI11111111'], ['Z2', 'X', '1.10.2026', '10', '']], E.guessMapping(['number', 'customer', 'due_date', 'amount', 'vat_id']), { today: '2026-10-15', existing: { Z2: 1 } });
  r2.errors.concat(r2.warnings).forEach((e) => msgs.push(e.msg));
  msgs.push(E.buildImport([['x']], { no: -1 }, {}).errors[0].msg);
  const r3 = E.buildImport([['Dokument', 'Partner', 'Valuta', 'Debet', 'Kredit'], ['D1', 'P', '1.10.2026', '100', '0'], ['D1', 'P', '1.10.2026', '0', '150'], ['D2', 'P', '1.10.2026', '0', '20']], { no: 0, customer: 1, dueDate: 2, debit: 3, credit: 4, amount: -1 }, { today: '2026-10-15', aggregate: true });
  r3.errors.concat(r3.warnings).forEach((e) => msgs.push(e.msg));
  B.parseBankCsv([['Datum', 'Znesek'], ['xx', '1'], ['1.10.2026', 'abc']], { date: 0, amount: 1 }).errors.forEach((e) => msgs.push(e.msg));
  B.parseBankCsv([['a']], { date: -1, amount: -1 }).errors.forEach((e) => msgs.push(e.msg));
  ['<Document><BkToCstmrDbtCdtNtfctn/></Document>', '<Invoice/>', '<a><b>'].forEach((x) => { try { B.parseCamt053(x); } catch (e) { msgs.push(e.message); } });
  assert.ok(msgs.length >= 14, msgs.length + ' messages');
  ['sl', 'hr'].forEach((L) => {
    const x = I.make(L).x;
    msgs.forEach((s) => assert.notStrictEqual(x(s), s, L + ': not translated: ' + s));
  });
  assert.strictEqual(I.make('sl').x('Row 3: the customer is empty.'), 'Vrstica 3: kupec je prazen.');
  assert.strictEqual(I.make('hr').x('Choose the column for "Due date".'), 'Odaberite stupac za „Datum dospijeća”.');
});

t('month and weekday names', () => {
  assert.strictEqual(I.make('sl').monthsLong[9], 'oktober');
  assert.strictEqual(I.make('hr').monthsLong[9], 'listopad');
  assert.strictEqual(I.make('hr').weekdays[4], 'četvrtak');
  assert.strictEqual(I.make('en').months[0], 'Jan');
});

console.log(n + ' tests passed');
