// Tests for site/crm/engine.js. Run: node tools/tests/crm-engine.test.js
'use strict';
const assert = require('assert');
const path = require('path');
const E = require(path.join(__dirname, '../../site/crm/engine.js'));

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok', n, name); }

t('Slovenian and Croatian VAT IDs: check digits, formats, messages', () => {
  // SI: 1234567 → weights 8..2 → 112, 11 − (112 mod 11 = 2) = 9
  assert.strictEqual(E.siCheck('1234567'), 9);
  assert.strictEqual(E.siValid('SI12345679'), true);
  assert.strictEqual(E.siValid('SI 1234 5679'), true);
  assert.strictEqual(E.siValid('SI12345678'), false);
  assert.strictEqual(E.siValid('SI02345679'), false, 'no leading zero');
  // HR: the OIB 69435151530 is the textbook ISO 7064 example
  assert.strictEqual(E.hrValid('69435151530'), true);
  assert.strictEqual(E.hrValid('HR69435151530'), true);
  assert.strictEqual(E.hrValid('HR69435151531'), false);
  assert.deepStrictEqual(E.checkVat('', 'SI'), { ok: true, msg: '' });
  assert.strictEqual(E.checkVat('12345679', 'SI').ok, true, 'digits only get the country prefix');
  assert.strictEqual(E.checkVat('HR1', 'HR').ok, false);
  assert.ok(/Croatian/.test(E.checkVat('HR12345678901', 'HR').msg));
  assert.strictEqual(E.checkVat('ATU12345678', 'AT').ok, true, 'other countries: format only');
  assert.strictEqual(E.normVat(' si 1234-5679 ', 'SI'), 'SI12345679');
});
t('demo VAT IDs get a valid check digit', () => {
  for (let i = 0; i < 300; i++) {
    const si = 'SI' + String(10000000 + i * 31337 % 89999999).padStart(8, '0');
    const hr = 'HR' + String(i * 7919 + 12345678901).slice(0, 11);
    assert.strictEqual(E.siValid(E.repairVat(si)), true, si + ' → ' + E.repairVat(si));
    assert.strictEqual(E.hrValid(E.repairVat(hr)), true, hr);
    assert.strictEqual(E.repairVat(si).slice(0, 7), si.slice(0, 7), 'the first digits stay');
  }
  assert.strictEqual(E.repairVat('SI12345679'), 'SI12345679', 'valid stays');
  assert.strictEqual(E.repairVat(''), '');
});
t('VIES answers: the Worker shape, the EU shape, "---", unavailable', () => {
  const w = E.parseVies({ country: 'SI', number: '12345679', valid: true, status: 'valid', name: 'PRIMER D.O.O.', address: 'DUNAJSKA CESTA 1 1000 LJUBLJANA' }, 'SI', '12345679');
  assert.deepStrictEqual([w.valid, w.name, w.street, w.postcode, w.city, w.vat], [true, 'PRIMER D.O.O.', 'Dunajska cesta 1', '1000', 'Ljubljana', 'SI12345679']);
  const eu = E.parseVies({ isValid: true, name: 'Primjer d.o.o.', address: 'ILICA 1\n10000 ZAGREB', countryCode: 'HR', vatNumber: '69435151530' });
  assert.deepStrictEqual([eu.street, eu.postcode, eu.city, eu.vat], ['Ilica 1', '10000', 'Zagreb', 'HR69435151530']);
  const hidden = E.parseVies({ valid: true, name: '---', address: '---' }, 'DE', '123456789');
  assert.deepStrictEqual([hidden.valid, hidden.name, hidden.address], [true, '', '']);
  assert.strictEqual(E.parseVies({ valid: false }, 'SI', '1').valid, false);
  assert.ok(/reached/.test(E.parseVies({ status: 'unavailable', reason: 'MS_UNAVAILABLE', error: 'The VAT register of this country cannot be reached now.' }).error));
  assert.deepStrictEqual(E.splitAddress('Cesta 24. junija 23, 1231 Ljubljana - Črnuče'), { street: 'Cesta 24. junija 23', postcode: '1231', city: 'Ljubljana - Črnuče' });
  assert.deepStrictEqual(E.splitAddress('Cesta 24. junija 23 1231 LJUBLJANA'), { street: 'Cesta 24. junija 23', postcode: '1231', city: 'Ljubljana' });
});
t('quotes: language by country, Slovenian and Croatian labels and the reverse-charge note', () => {
  assert.strictEqual(E.quoteLang('SI'), 'sl'); assert.strictEqual(E.quoteLang('HR'), 'hr'); assert.strictEqual(E.quoteLang('AT'), 'en');
  assert.strictEqual(E.qt('sl').title, 'Ponudba'); assert.strictEqual(E.qt('hr').title, 'Ponuda'); assert.strictEqual(E.qt('xx').title, 'Quote');
  assert.ok(/196\. člen Direktive Sveta 2006\/112\/ES/.test(E.qt('sl').rc));
  assert.ok(/čl\. 196\. Direktive Vijeća 2006\/112\/EZ/.test(E.qt('hr').rc));
  ['en', 'sl', 'hr'].forEach(l => { const q = E.qt(l); ['title', 'date', 'valid', 'item', 'qty', 'price', 'vat', 'net', 'total', 'terms', 'sign', 'terms0', 'rc'].forEach(k => assert.ok(q[k], l + '.' + k)); assert.strictEqual(Object.keys(q.st).length, 5); });
  assert.strictEqual(E.productName('FRM-PRG', 'Frames programme', 'hr'), 'Program okvira (B2B asortiman)');
  assert.strictEqual(E.productName('FRM-PRG', 'Frames programme', 'en'), 'Frames programme');
  assert.strictEqual(E.productName('SKU-1', 'ERP item', 'sl'), 'ERP item');
  assert.strictEqual(E.unitName('pair', 'sl'), 'par'); assert.strictEqual(E.unitName('pcs', 'hr'), 'kom');
  assert.strictEqual(E.quoteRef('Q-2026-0001', 'sl'), ', ponudba Q-2026-0001'); assert.strictEqual(E.quoteRef('', 'hr'), '');
});
t('Slovenian and Croatian templates: one of each default, only known placeholders', () => {
  const known = ['first_name', 'last_name', 'full_name', 'job_title', 'company', 'city', 'deal', 'value', 'stage', 'close_date', 'quote_no', 'quote_ref', 'owner', 'today'];
  ['sl', 'hr'].forEach(l => {
    const list = E.TEMPLATES_I18N.filter(x => x.lang === l);
    assert.deepStrictEqual(list.map(x => x.key.split('-')[0]), ['intro', 'followup', 'proposal', 'reminder', 'thanks', 'winback']);
    list.forEach(x => (x.subject + x.body).replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => { assert.ok(known.includes(k), x.key + ': ' + k); return m; }));
  });
});
t('amounts and dates in import files', () => {
  assert.strictEqual(E.parseAmount('12.500'), 12500);
  assert.strictEqual(E.parseAmount('12.500,50 €'), 12500.5);
  assert.strictEqual(E.parseAmount('1,234.50'), 1234.5);
  assert.strictEqual(E.parseAmount('980,4'), 980.4);
  assert.strictEqual(E.parseAmount('12.5'), 12.5);
  assert.strictEqual(E.parseAmount('abc'), null);
  assert.strictEqual(E.parseDate('31.12.2026'), '2026-12-31');
  assert.strictEqual(E.parseDate('31. 12. 2026.'), '2026-12-31');
  assert.strictEqual(E.parseDate('2026-02-30'), '');
  assert.deepStrictEqual(['Lead', 'Ponudba', 'pogajanja', 'Pregovori', 'Dobljen', 'Izgubljen', 'Qualified', '', 'weird'].map(E.stageOf), ['lead', 'proposal', 'negotiation', 'negotiation', 'won', 'lost', 'qualified', 'lead', null]);
});
const owners = [{ id: 'u1', name: 'Nina Kovač', initials: 'NK' }, { id: 'u2', name: 'Luka Horvat', initials: 'LH' }];
const companies = [{ id: 1, name: 'Optika Lipa d.o.o.', vat: 'SI12345679', owner: 'u2' }, { id: 2, name: 'Poliklinika Bura', vat: '', owner: 'u1' }];
t('companies import: mapping guess, new / update / skip with reasons', () => {
  const head = ['Naziv', 'ID za DDV', 'Država', 'Naslov', 'Poštna št.', 'Kraj', 'E-mail', 'Segment', 'Skrbnik'];
  const map = E.guessMap(head, E.CO_FIELDS);
  assert.deepStrictEqual([map.name, map.vat, map.country, map.address, map.postcode, map.city, map.email, map.segment, map.owner], ['0', '1', '2', '3', '4', '5', '6', '7', '8']);
  const rows = [
    ['Optika Nova d.o.o.', 'SI 1234 5679', 'Slovenija', 'Glavna 1', '1000', 'Ljubljana', 'info@example.com', 'Optician', 'Nina Kovač'],
    ['Optika Lipa d.o.o.', '', 'SI', '', '', '', '', '', ''],
    ['Novo podjetje', 'SI11111111', 'SI', '', '', '', 'bad-mail', 'Bakery', 'Nobody'],
    ['', '', '', '', '', '', '', '', ''],
    ['Optika Nova d.o.o.', 'SI12345679', 'SI', '', '', '', '', '', ''],
    ['Austria GmbH', '', 'Austria', '', '', '', '', '', '']
  ];
  const ctx = { companies, owners, segments: ['Optician', 'Clinic', 'Corporate'], defaults: { owner: 'u2', segment: 'Corporate', country: 'SI' }, update: false };
  const P = E.planCompanies(rows, map, ctx);
  assert.deepStrictEqual(P.rows.map(p => p.status), ['skip', 'skip', 'new', 'skip', 'skip', 'skip']);
  assert.ok(/Already in the CRM \(Optika Lipa/.test(P.rows[0].note), 'SI12345679 belongs to Optika Lipa: found by VAT ID');
  assert.ok(/Already in the CRM/.test(P.rows[1].note));
  assert.ok(/not valid/.test(P.rows[2].note) && /Segment/.test(P.rows[2].note) && /Owner/.test(P.rows[2].note) && /e-mail/.test(P.rows[2].note), P.rows[2].note);
  assert.deepStrictEqual([P.rows[2].rec.vat, P.rows[2].rec.segment, P.rows[2].rec.owner, P.rows[2].rec.email], ['', 'Corporate', 'u2', '']);
  assert.ok(/No company name/.test(P.rows[3].note));
  assert.ok(/not SI or HR/.test(P.rows[5].note));
  const U = E.planCompanies(rows.slice(0, 2), map, Object.assign({}, ctx, { update: true }));
  assert.deepStrictEqual(U.rows.map(p => p.status), ['update', 'update']);
  assert.strictEqual(U.rows[0].target.id, 1);
  assert.deepStrictEqual(U.counts, { new: 0, update: 2, skip: 0 });
});
t('deals import: company by name or VAT ID, stages, values, owners, new companies', () => {
  const head = ['Deal', 'Company', 'Value EUR', 'Stage', 'Expected close', 'Owner', 'Contact e-mail'];
  const map = E.guessMap(head, E.DEAL_FIELDS);
  assert.deepStrictEqual([map.title, map.company, map.value, map.stage, map.close, map.owner, map.contact], ['0', '1', '2', '3', '4', '5', '6']);
  const rows = [
    ['Frames 2027', 'SI12345679', '12.500,00', 'Ponudba', '31.12.2026', '', 'a@example.com'],
    ['Lenses', 'poliklinika bura', '980', 'won', '', 'Nina Kovač', ''],
    ['New one', 'Zavod Novi', '100', '', 'soon', '', ''],
    ['No value', 'Poliklinika Bura', 'n/a', '', '', '', ''],
    ['Unknown VAT', 'SI99999999', '10', '', '', '', '']
  ];
  const ctx = { companies, contacts: [{ id: 7, companyId: 1, email: 'a@example.com' }], owners, defaults: { owner: 'u1' }, createCompanies: true };
  const P = E.planDeals(rows, map, ctx);
  assert.deepStrictEqual(P.rows.map(p => p.status), ['new', 'new', 'new', 'skip', 'skip']);
  assert.deepStrictEqual(P.rows[0].rec, { title: 'Frames 2027', companyId: 1, contactId: 7, value: 12500, stage: 'proposal', expectedClose: '2026-12-31', owner: 'u2' });
  assert.deepStrictEqual([P.rows[1].rec.companyId, P.rows[1].rec.stage, P.rows[1].rec.owner], [2, 'won', 'u1']);
  assert.strictEqual(P.rows[2].newCompany, 'Zavod Novi');
  assert.ok(/not understood/.test(P.rows[2].note));
  assert.strictEqual(P.counts.newCompanies, 1);
  assert.ok(/not in the CRM/.test(P.rows[4].note), 'an unknown VAT ID never creates a company');
  const N = E.planDeals(rows.slice(2, 3), map, Object.assign({}, ctx, { createCompanies: false }));
  assert.strictEqual(N.rows[0].status, 'skip');
});

console.log('\n' + n + ' CRM engine tests passed');
