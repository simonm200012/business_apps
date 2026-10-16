// Tests for site/datacheck/engine.js and data.js. Run: node tools/tests/datacheck-engine.test.js
'use strict';
const assert = require('assert');
const path = require('path');
const E = require(path.join(__dirname, '../../site/datacheck/engine.js'));
let D = null;
try { D = require(path.join(__dirname, '../../site/datacheck/data.js')); } catch (e) { if (!/Cannot find module/.test(e.message)) throw e; }

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok', n, name); }
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= (eps || 1e-4), (msg || '') + ' ' + a + ' ≠ ' + b);
const kinds = (res, k) => res.issues.filter((x) => x.k === k);
const rowsOf = (res, k) => Array.from(new Set(kinds(res, k).map((x) => x.r))).sort((a, b) => a - b);
function table(headers, rows) { return { headers, rows: rows.map((r) => r.map(String)), lines: rows.map((_, i) => i + 2) }; }
function run(tb, cfg) {
  const type = cfg && cfg.type || 'customers';
  const roles = cfg && cfg.roles || E.rolesForType(E.guessRoles(tb, 'SI').roles, type);
  return E.analyze(tb, Object.assign({ type, roles, required: E.DEFAULT_REQ[type].required, recommended: E.DEFAULT_REQ[type].recommended, home: 'SI', today: '2026-10-13' }, cfg || {}, { roles }));
}

// ── VAT IDs ──────────────────────────────────────────────────────────────
t('SI tax number: the example from the brief is valid, a changed digit is not', () => {
  assert.strictEqual(E.siTaxOk('12345679'), true);
  assert.strictEqual(E.siTaxOk('12345678'), false);
  assert.strictEqual(E.vatCheck('SI12345679').ok, true);
  assert.strictEqual(E.vatCheck('SI 1234 5679').canon, 'SI12345679');
  assert.strictEqual(E.vatCheck('SI12345678').err, 'checksum');
  assert.strictEqual(E.vatCheck('si12345679').ok, true);
});

t('SI tax number: check 10 becomes 0, remainder 0 is never valid, first digit 0 is a format error', () => {
  // find a 7-digit stem with r = 1 (check 11 − 1 = 10 → 0) and one with r = 0 (check would be 11 → invalid)
  let ten = null, zero = null;
  for (let i = 1000000; i < 1100000 && (!ten || !zero); i++) {
    const d = String(i); let s = 0; for (let k = 0; k < 7; k++) s += +d[k] * (8 - k);
    if (s % 11 === 1 && !ten) ten = d;
    if (s % 11 === 0 && !zero) zero = d;
  }
  assert.ok(ten && zero);
  assert.strictEqual(E.siTaxCheckDigit(ten), 0);
  assert.strictEqual(E.siTaxOk(ten + '0'), true);
  for (let c = 1; c <= 9; c++) assert.strictEqual(E.siTaxOk(ten + c), false);
  assert.strictEqual(E.siTaxCheckDigit(zero), -1);
  for (let c = 0; c <= 9; c++) assert.strictEqual(E.siTaxOk(zero + c), false, 'r = 0 must be invalid for every last digit');
  assert.strictEqual(E.vatCheck('SI02345678').err, 'format');
  assert.strictEqual(E.vatCheck('SI1234567').err, 'format');
});

t('OIB and HR VAT: ISO 7064 MOD 11,10', () => {
  assert.strictEqual(E.oibCheckDigit('1234567890'), 3);
  assert.strictEqual(E.oibOk('12345678903'), true);
  assert.strictEqual(E.oibOk('12345678904'), false);
  assert.strictEqual(E.oibOk('1234567890'), false);
  assert.strictEqual(E.vatCheck('HR12345678903').ok, true);
  assert.strictEqual(E.vatCheck('HR12345678904').err, 'checksum');
  assert.strictEqual(E.vatCheck('12345678903', 'HR').ok, true, 'an OIB without prefix in a Croatian row');
  // every generated OIB passes
  for (let i = 0; i < 200; i++) { const d10 = String(1000000000 + i * 7919); assert.ok(E.oibOk(d10 + E.oibCheckDigit(d10))); }
});

t('other VAT IDs: format only for countries without a check-digit test', () => {
  const ok = ['ATU12345678', 'DE123456789', 'IT12345678901', 'HU12345678', 'CZ12345678', 'CZ1234567890', 'GB123456789', 'CHE-123.456.789 MWST', 'EL123456789',
    'NL123456789B01', 'FR12345678901', 'PL1234567890', 'SK1234567890', 'RS123456789', 'BA123456789012', 'ME12345678', 'MK1234567890123', 'NO123456789MVA', 'BE0123456789', 'ESX1234567X'];
  ok.forEach((v) => assert.strictEqual(E.vatCheck(v).ok, true, v));
  assert.strictEqual(E.vatCheck('ATU12345678').checked, false);
  ['ATU1234567', 'DE12345678', 'IT1234567890', 'HU1234567', 'NL123456789', 'BE2123456789'].forEach((v) => assert.strictEqual(E.vatCheck(v).err, 'format', v));
  assert.strictEqual(E.vatCheck('GR123456789').err, 'format');
  assert.strictEqual(E.vatCheck('XX123456').err, 'prefix');
  assert.strictEqual(E.vatCheck('U12345678', 'AT').ok, true, 'an Austrian UID without the AT prefix in an Austrian row');
  assert.strictEqual(E.vatCheck('12345679', 'SI').ok, true);
  assert.strictEqual(E.vatCheck('12345679', 'US').skip, true);
});

// ── IBAN, BIC ────────────────────────────────────────────────────────────
t('IBAN: mod 97, country lengths, Slovene SI56', () => {
  ['GB82 WEST 1234 5698 7654 32', 'DE89 3704 0044 0532 0130 00', 'SI56 1910 0000 0123 438', 'HR1210010051863000160', 'SI56263300012039086'].forEach((v) => assert.strictEqual(E.ibanCheck(v).ok, true, v));
  assert.strictEqual(E.ibanCheck('GB82 WEST 1234 5698 7654 32').norm, 'GB82WEST12345698765432');
  assert.strictEqual(E.ibanCheck('SI56191000000123439').err, 'checksum');
  assert.strictEqual(E.ibanCheck('GB82WEST12345698765433').err, 'checksum');
  const len = E.ibanCheck('DE8937040044053201300');
  assert.strictEqual(len.err, 'length'); assert.strictEqual(len.len, 22); assert.strictEqual(len.n, 21);
  assert.strictEqual(E.ibanCheck('XX12345678901234').err, 'country');
  assert.strictEqual(E.ibanCheck('1234-ABC').err, 'chars');
  assert.deepStrictEqual(['SI', 'HR', 'AT', 'DE', 'IT', 'HU', 'CZ', 'SK', 'MT', 'NO'].map((k) => E.IBAN_LEN[k]), [19, 21, 20, 22, 27, 28, 24, 24, 31, 15]);
  // a Slovene account number (TRR) without the prefix: SI56 + the 15 digits
  const loc = E.ibanCheck('19100-0000123438', 'SI');
  assert.strictEqual(loc.local, true); assert.strictEqual(loc.fix, 'SI56191000000123438');
  // valid mod 97 but not SI56: the account number's own check digits are wrong
  const bban = '191000000123437', fake = 'SI' + E.ibanCheckDigits('SI', bban) + bban;
  assert.strictEqual(E.ibanMod(fake), 1);
  assert.strictEqual(E.ibanCheck(fake).err, 'si56');
  assert.strictEqual(E.ibanCheckDigits('DE', '370400440532013000'), '89');
});

t('BIC: 8 or 11 characters with a real country code', () => {
  assert.strictEqual(E.bicCheck('LJBASI2X').ok, true);
  assert.strictEqual(E.bicCheck('DEUTDEFF500').cc, 'DE');
  assert.strictEqual(E.bicCheck('ljba si 2x').norm, 'LJBASI2X');
  assert.strictEqual(E.bicCheck('ABCD1X2X').err, true);
  assert.strictEqual(E.bicCheck('ABCDQQ2X').err, true, 'QQ is not a country');
  assert.strictEqual(E.bicCheck('LJBASI2XX').err, true);
});

// ── e-mail ───────────────────────────────────────────────────────────────
t('e-mail: syntax, clean-up, several addresses, typo domains', () => {
  assert.strictEqual(E.emailCheck('info@vzorec.example.com').ok, true);
  assert.strictEqual(E.emailCheck('info.vzorec.example.com').err, 'noat');
  assert.strictEqual(E.emailCheck('info@@vzorec.example.com').err, 'multiat');
  assert.strictEqual(E.emailCheck('info@vzorec').err, 'domain');
  assert.strictEqual(E.emailCheck('info@vzorec,example.com').err, 'domain');
  assert.strictEqual(E.emailCheck('.info@vzorec.example.com').err, 'local');
  assert.strictEqual(E.emailCheck('info @vzorec.example.com').fix, 'info@vzorec.example.com');
  assert.strictEqual(E.emailCheck('mailto:info@vzorec.example.com').fix, 'info@vzorec.example.com');
  assert.strictEqual(E.emailCheck('<info@vzorec.example.com>').fix, 'info@vzorec.example.com');
  assert.strictEqual(E.emailCheck('a@x.si; b@x.si').multi, 2);
  assert.strictEqual(E.emailCheck('a@x.si, b@x').bad, true);
  const typos = { 'ana@gmial.com': 'ana@gmail.com', 'ana@gmai.com': 'ana@gmail.com', 'ana@gmail.con': 'ana@gmail.com', 'ana@hotmial.com': 'ana@hotmail.com',
    'ana@yahooo.com': 'ana@yahoo.com', 'ana@outlok.com': 'ana@outlook.com', 'ana@siol.ne': 'ana@siol.net', 'ana@siol.nett': 'ana@siol.net',
    'ana@t-2.nett': 'ana@t-2.net', 'ana@amis.nett': 'ana@amis.net', 'ana@example.con': 'ana@example.com', 'ana@example.cmo': 'ana@example.com' };
  Object.keys(typos).forEach((k) => { const x = E.emailCheck(k); assert.ok(x.typo, k); assert.strictEqual(x.fix, typos[k], k); });
  assert.strictEqual(E.emailCheck('ana@gmail.com').typo, undefined);
  assert.strictEqual(E.emailCheck('ana@siol.net').typo, undefined);
});

// ── phone numbers ────────────────────────────────────────────────────────
t('phone: Slovene numbers to E.164', () => {
  const si = { '01 234 56 78': '+38612345678', '041 123 456': '+38641123456', '+386 41 123 456': '+38641123456', '00386 1 234 5678': '+38612345678',
    '+386 (0)1 234 56 78': '+38612345678', '041/123-456': '+38641123456', '(01) 234-56-78': '+38612345678', '386 41 123 456': '+38641123456',
    '+386 041 123 456': '+38641123456', '41123456': '+38641123456' };
  Object.keys(si).forEach((k) => assert.strictEqual(E.phoneCheck(k, 'SI').e164, si[k], k));
});
t('phone: Croatian and other numbers, invalid lengths', () => {
  assert.strictEqual(E.phoneCheck('091 123 4567', 'HR').e164, '+385911234567');
  assert.strictEqual(E.phoneCheck('01 2345 678', 'HR').e164, '+38512345678');
  assert.strictEqual(E.phoneCheck('+385 1 2345 678', 'SI').e164, '+38512345678');
  assert.strictEqual(E.phoneCheck('+43 1 234 5678', 'SI').e164, '+4312345678');
  assert.strictEqual(E.phoneCheck('0043 316 123456', 'SI').e164, '+43316123456');
  assert.strictEqual(E.phoneCheck('089 1234567', 'DE').e164, '+49891234567');
  assert.strictEqual(E.phoneCheck('040 123456', 'IT').e164, '+39040123456', 'Italy keeps the 0');
  assert.strictEqual(E.phoneCheck('06 1 234 5678', 'HU').e164, '+3612345678', 'Hungary drops 06');
  assert.strictEqual(E.phoneCheck('123', 'SI').err, 'short');
  assert.strictEqual(E.phoneCheck('041 12', 'SI').err, 'short');
  assert.strictEqual(E.phoneCheck('0411234567', 'SI').err, 'si');
  assert.strictEqual(E.phoneCheck('+386 41 123 45', 'SI').err, 'si');
  assert.strictEqual(E.phoneCheck('+385 91 12', 'SI').err, 'hr');
  assert.strictEqual(E.phoneCheck('+1234567890123456', 'SI').err, 'long');
  assert.strictEqual(E.phoneCheck('pokliči Marka', 'SI').err, 'letters');
  assert.strictEqual(E.phoneCheck('041 123 456 / 01 234 56 78', 'SI').multi, 2);
  assert.strictEqual(E.phoneCheck('01 234 56 78 int. 12', 'SI').ext, true);
});

// ── postal codes and countries ───────────────────────────────────────────
t('postal codes: formats, lookup, prefixes and lost zeros', () => {
  assert.strictEqual(E.postalCheck('1000', 'SI').ok, true);
  assert.deepStrictEqual([E.postalCheck('1000 Ljubljana', 'SI').code, E.postalCheck('1000 Ljubljana', 'SI').city], ['1000', 'Ljubljana']);
  assert.strictEqual(E.postalCheck('SI-1000', 'SI').fix, '1000');
  assert.strictEqual(E.postalCheck('100', 'SI').err, true);
  assert.strictEqual(E.postalCheck('12345', 'SI').err, true);
  assert.strictEqual(E.postalCheck('10000', 'HR').ok, true);
  assert.strictEqual(E.postalCheck('1000', 'HR').err, true);
  assert.strictEqual(E.postalCheck('1067', 'DE').fix, '01067');
  assert.strictEqual(E.postalCheck('1067 Dresden', 'DE').fix, '01067 Dresden');
  assert.strictEqual(E.postalCheck('602 00', 'CZ').ok, true);
  assert.strictEqual(E.postalCheck('A-1010', 'AT').fix, '1010');
  assert.strictEqual(E.postalCheck('12345', 'US').skip, true);
  const lj = E.postOffice('SI', '1000');
  assert.strictEqual(lj.name, 'Ljubljana');
  assert.strictEqual(E.cityMatches('LJUBLJANA', lj), true);
  assert.strictEqual(E.cityMatches('Ljubljana - Šentvid', lj), false);
  assert.strictEqual(E.cityMatches('Koper - Capodistria', E.postOffice('SI', '6000')), true);
  assert.strictEqual(E.cityMatches('Novo Mesto', E.postOffice('SI', '8000')), true);
  assert.strictEqual(E.cityMatches('Skofja Loka', E.postOffice('SI', '4220')), true);
  assert.strictEqual(E.postOffice('HR', '21000').name, 'Split');
  assert.strictEqual(E.postOffice('HR', '52100').name, 'Pula');
  ['1230 Domžale', '2250 Ptuj', '3320 Velenje', '4260 Bled', '5270 Ajdovščina', '6330 Piran', '8270 Krško', '9220 Lendava'].forEach((x) => {
    assert.strictEqual(E.postOffice('SI', x.slice(0, 4)).name, x.slice(5));
  });
});

t('countries: names, codes and variants to ISO alpha-2', () => {
  const m = { 'Slovenija': 'SI', 'Slovenia': 'SI', 'SLO': 'SI', 'SVN': 'SI', 'si': 'SI', 'Republika Slovenija': 'SI', 'R. Slovenija': 'SI', 'Hrvatska': 'HR', 'Croatia': 'HR',
    'HRV': 'HR', 'CRO': 'HR', 'Österreich': 'AT', 'Avstrija': 'AT', 'Italia': 'IT', 'Italija': 'IT', 'Deutschland': 'DE', 'Nemčija': 'DE', 'Njemačka': 'DE',
    'Magyarország': 'HU', 'Madžarska': 'HU', 'Srbija': 'RS', 'BiH': 'BA', 'Bosna i Hercegovina': 'BA', 'Crna Gora': 'ME', 'Češka': 'CZ', 'U.S.A.': 'US', 'UK': 'GB' };
  Object.keys(m).forEach((k) => assert.strictEqual(E.countryOf(k), m[k], k));
  assert.strictEqual(E.countryOf('Mars'), null);
  assert.strictEqual(E.countryOf(''), null);
});

// ── barcodes ─────────────────────────────────────────────────────────────
t('EAN/GTIN: check digits, lengths, lost leading zeros, scientific notation', () => {
  assert.strictEqual(E.gtinCheckDigit('400638133393'), 1);
  assert.strictEqual(E.eanCheck('4006381333931').ok, true);
  assert.strictEqual(E.eanCheck('4006381333932').err, 'checksum');
  assert.strictEqual(E.eanCheck('4006381333932').expect, 1);
  assert.strictEqual(E.eanCheck('96385074').ok, true, 'EAN-8');
  assert.strictEqual(E.eanCheck('036000291452').ok, true, 'UPC-A');
  assert.strictEqual(E.eanCheck('10036000291459').ok, true, 'GTIN-14');
  assert.strictEqual(E.eanCheck('40063813339').err, 'length');
  assert.strictEqual(E.eanCheck('400638133393X').err, 'chars');
  assert.strictEqual(E.eanCheck('3,83101E+12').sci, true);
  assert.strictEqual(E.eanCheck('3.83E+12').sci, true);
  assert.strictEqual(E.eanCheck('400 6381 33393 1').digits, '4006381333931');
  // in a column of 13-digit codes, a valid 12-digit code lost its leading zero
  const tb = table(['Šifra', 'Naziv', 'EAN', 'EM', 'Cena'], [
    ['A1', 'Ventil', '4006381333931', 'kos', '10,00'], ['A2', 'Cev', '3830012345675', 'kos', '5,00'], ['A3', 'Pipa', '036000291452', 'kos', '7,00'], ['A4', 'Kabel', '3,83101E+12', 'kos', '2,00']]);
  const res = run(tb, { type: 'products', roles: ['sku', 'name', 'ean', 'unit', 'price'] });
  assert.deepStrictEqual(kinds(res, 'ean.zero').map((x) => [x.r, x.f]), [[2, '0036000291452']]);
  assert.deepStrictEqual(rowsOf(res, 'ean.sci'), [3]);
  // zeros lost in front of a 13-digit code that starts with 00 (a US or Canadian product): 11 digits left
  const tb2 = table(['Šifra', 'Naziv', 'EAN'], [['A1', 'Ventil', '4006381333931'], ['A2', 'Cev', '3830012345675'], ['A3', 'Pipa', '36000291452'], ['A4', 'Kabel', '36000291453']]);
  const res2 = run(tb2, { type: 'products', roles: ['sku', 'name', 'ean'] });
  assert.deepStrictEqual(kinds(res2, 'ean.zero').map((x) => [x.r, x.f]), [[2, '0036000291452']]);
  assert.deepStrictEqual(rowsOf(res2, 'ean.format'), [3], 'an 11-digit value that is not valid with zeros is a wrong length');
  assert.strictEqual(kinds(res, 'ean.sci')[0].f, undefined, 'lost digits cannot be fixed');
});

// ── text ─────────────────────────────────────────────────────────────────
t('mojibake: UTF-8 read as Windows-1252 round-trips back to the original', () => {
  const s = 'Šolski center Črnomelj – Žiga Đurić, ćevapčići, Größe, € 10';
  const broken = E.toMojibake(s);
  assert.notStrictEqual(broken, s);
  assert.strictEqual(E.fixMojibake(broken), s);
  assert.strictEqual(E.toMojibake('š'), 'Å¡');
  assert.strictEqual(E.toMojibake('č'), 'Ä\u008d');
  assert.strictEqual(E.fixMojibake('Å¡ola'), 'šola');
  assert.strictEqual(E.fixMojibake('Ä\u008drnomelj'), 'črnomelj');
  assert.strictEqual(E.fixMojibake('Ljubljana'), null);
  assert.strictEqual(E.fixMojibake('Škofja Loka'), null, 'correct text stays');
  assert.strictEqual(E.fixMojibake('SÃO PAULO'), null, 'legitimate Ã is not mojibake');
  assert.strictEqual(E.fixMojibake(E.toMojibake(E.toMojibake('Žalec'))), 'Žalec', 'double-encoded');
});

t('Title Case keeps legal forms and Slovene/Croatian letters right', () => {
  const m = { 'VZOREC ENERGIJA, D.O.O.': 'Vzorec Energija, d.o.o.', 'NORDTHERM HEIZTECHNIK GMBH': 'Nordtherm Heiztechnik GmbH', 'VALVEX COMPONENTI S.R.L.': 'Valvex Componenti S.r.l.',
    'POLYTUBE INDUSTRIES KFT.': 'Polytube Industries Kft.', 'ELEKTRO KRES S.P.': 'Elektro Kres s.p.', 'ŠOLSKI CENTER ČRNOMELJ': 'Šolski Center Črnomelj',
    'SOLARIX ENERGY S.A.': 'Solarix Energy S.A.', 'KLIMAFLOW SYSTEMS B.V.': 'Klimaflow Systems B.V.', 'GRADBENI SISTEMI VRH D.D.': 'Gradbeni Sistemi Vrh d.d.',
    'ĐURIĆ TRANSPORT J.D.O.O.': 'Đurić Transport j.d.o.o.', 'MONTAŽA GABER K.D.': 'Montaža Gaber k.d.', 'AQUAFLUX PUMPS A.S.': 'Aquaflux Pumps a.s.',
    'ALPENHOLZ HANDELS AG': 'Alpenholz Handels AG', 'VZOREC ENERGIJA DOO': 'Vzorec Energija d.o.o.', 'ELEKTRO NOVAK SP': 'Elektro Novak s.p.' };
  Object.keys(m).forEach((k) => assert.strictEqual(E.titleCase(k, 'name'), m[k], k));
  assert.strictEqual(E.titleCase('TRŽAŠKA CESTA 116', 'street'), 'Tržaška cesta 116');
  assert.strictEqual(E.titleCase('ULICA HEROJA ŠLANDRA 10', 'street'), 'Ulica Heroja Šlandra 10');
  assert.strictEqual(E.titleCase('ZAGORJE OB SAVI', 'city'), 'Zagorje ob Savi');
  assert.strictEqual(E.titleCase('ŠMARJE PRI JELŠAH', 'city'), 'Šmarje pri Jelšah');
  assert.strictEqual(E.isCaps('VZOREC ENERGIJA'), true);
  assert.strictEqual(E.isCaps('Vzorec Energija'), false);
  assert.strictEqual(E.isCaps('IKEA'), false, 'a short acronym on its own');
});

t('whitespace fixes', () => {
  assert.strictEqual(E.fixTrim('  Vzorec\u00A0 '), 'Vzorec');
  assert.strictEqual(E.fixDouble('Vzorec   Energija'), 'Vzorec Energija');
  assert.strictEqual(E.fixNbsp('Vzorec\u00A0Energija\u200B'), 'Vzorec Energija');
  assert.strictEqual(E.fixBreaks('Tržaška cesta 116\r\n1000 Ljubljana'), 'Tržaška cesta 116, 1000 Ljubljana');
  assert.strictEqual(E.core('  a \u00A0 b\n'), 'a b');
  assert.strictEqual(E.isPlaceholder('-', 'name'), true);
  assert.strictEqual(E.isPlaceholder('n/a', 'email'), true);
  assert.strictEqual(E.isPlaceholder('0', 'vat'), true);
  assert.strictEqual(E.isPlaceholder('0', 'price'), false);
  assert.strictEqual(E.isPlaceholder('NA', 'country'), false, 'Namibia');
});

// ── CSV ──────────────────────────────────────────────────────────────────
t('CSV: quotes with delimiters, escaped quotes, line breaks in quotes', () => {
  const p = E.parseCsv('a;b;c\r\n"x;y";"he said ""hi""";"line1\nline2"\r\n1;2;3', ';');
  assert.deepStrictEqual(p.rows, [['a', 'b', 'c'], ['x;y', 'he said "hi"', 'line1\nline2'], ['1', '2', '3']]);
  assert.deepStrictEqual(p.lines, [1, 2, 4], 'line numbers count the break inside quotes');
  assert.deepStrictEqual(E.parseCsv('"";""\n"a""";b', ';').rows, [['a"', 'b']], 'a row of empty quoted cells is empty');
  assert.deepStrictEqual(E.parseCsv('ab"c;d', ';').rows, [['ab"c', 'd']], 'a quote inside an unquoted cell is literal');
});
t('CSV: BOM, CR/LF/CRLF, empty lines, ragged rows', () => {
  const p = E.parseCsv('\uFEFFa,b\r\n\r\n1,2\r3,4\n;\n,\n5', ',');
  assert.deepStrictEqual(p.rows, [['a', 'b'], ['1', '2'], ['3', '4'], [';'], ['5']]);
  const tb = E.readText('Naziv;Kraj;Telefon\nVzorec;Celje\nLumen;Maribor;01 234 56 78;extra\n', {});
  assert.deepStrictEqual(tb.headers, ['Naziv', 'Kraj', 'Telefon', 'Column 4']);
  assert.deepStrictEqual(tb.rows, [['Vzorec', 'Celje', '', ''], ['Lumen', 'Maribor', '01 234 56 78', 'extra']]);
  assert.strictEqual(tb.short, 1); assert.strictEqual(tb.long, 1);
});
t('CSV: delimiter sniffing and header detection', () => {
  assert.strictEqual(E.sniffDelimiter('a;b;c\n1;2,5;3\n4;5,1;6'), ';');
  assert.strictEqual(E.sniffDelimiter('a,b,c\n1,"2;5",3\n4,5,6'), ',');
  assert.strictEqual(E.sniffDelimiter('a\tb\tc\n1\t2\t3'), '\t');
  assert.strictEqual(E.sniffDelimiter('a|b|c\n1|2|3'), '|');
  assert.strictEqual(E.sniffDelimiter('just one column\nvalue'), ';');
  // title lines above the header are skipped
  const text = 'IZPIS PARTNERJEV;;;;\nDatum izpisa: 13.10.2026;;;;\n;;;;\nŠifra;Naziv;Ulica;Pošta;Kraj\nK001;Vzorec d.o.o.;Cesta 1;3000;Celje\n';
  const tb = E.readText(text);
  assert.deepStrictEqual(tb.headers, ['Šifra', 'Naziv', 'Ulica', 'Pošta', 'Kraj']);
  assert.strictEqual(tb.skipped, 2);
  assert.strictEqual(tb.header, 4);
  assert.deepStrictEqual(tb.lines, [5]);
  // no header: generated names
  const nh = E.readText('Vzorec d.o.o.;info@vzorec.example.com;01 234 56 78\nLumen d.o.o.;info@lumen.example.com;02 234 56 78\nStruna d.o.o.;info@struna.example.com;041 555 123\n');
  assert.strictEqual(nh.hasHeader, false);
  assert.deepStrictEqual(nh.headers, ['Column 1', 'Column 2', 'Column 3']);
  const roles = E.guessRoles(nh, 'SI').roles;
  assert.deepStrictEqual(roles.slice(1), ['email', 'phone'], 'roles from the content');
});
t('CSV: writing quotes what needs quoting and adds the BOM', () => {
  const s = E.toCsv(['a', 'b'], [['x;y', 'he said "hi"'], [' lead', 'ok']], ';', true);
  assert.strictEqual(s, '\uFEFFa;b\r\n"x;y";"he said ""hi"""\r\n" lead";ok\r\n');
  assert.deepStrictEqual(E.parseCsv(s, ';').rows.slice(1), [['x;y', 'he said "hi"'], [' lead', 'ok']]);
});
t('decoding: UTF-8, then Windows-1250 when the bytes are not UTF-8', () => {
  const u = E.decode(new TextEncoder().encode('Šifra;Kraj\n1;Črnomelj'));
  assert.strictEqual(u.encoding, 'utf-8'); assert.strictEqual(u.fallback, false);
  const w = E.decode(E.encodeCp1250('Šifra;Kraj\n1;Črnomelj; Đakovo; Győr'));
  assert.strictEqual(w.encoding, 'windows-1250'); assert.strictEqual(w.fallback, true);
  assert.strictEqual(w.text, 'Šifra;Kraj\n1;Črnomelj; Đakovo; Győr');
  const b = E.decode(new Uint8Array([0xEF, 0xBB, 0xBF, 0x61, 0x3B, 0x62]));
  assert.strictEqual(b.text, 'a;b'); assert.strictEqual(b.bom, true);
  assert.strictEqual(E.decode(E.encodeCp1250('č'), 'windows-1252').text, 'è', 'reading with another code page on request');
});

// ── numbers and dates ────────────────────────────────────────────────────
t('numbers: decimal comma or point, thousand separators, currency', () => {
  const v = (s, h) => E.parseNumber(s, h).n;
  assert.strictEqual(v('1.234,56'), 1234.56);
  assert.strictEqual(v('1,234.56'), 1234.56);
  assert.strictEqual(v('1234,5'), 1234.5);
  assert.strictEqual(v('12.50'), 12.5);
  assert.strictEqual(v('1.234', ','), 1234);
  assert.strictEqual(v('1.234', '.'), 1.234);
  assert.strictEqual(v('1 234,56'), 1234.56);
  assert.strictEqual(v('1.234.567'), 1234567);
  assert.strictEqual(v('-5'), -5);
  assert.strictEqual(v('−12,40'), -12.4);
  const c = E.parseNumber('€ 12,50');
  assert.strictEqual(c.n, 12.5); assert.strictEqual(c.sym, true); assert.strictEqual(c.dec, ','); assert.strictEqual(c.fd, 2);
  assert.strictEqual(E.parseNumber('15.000,00 EUR').thou, true);
  assert.strictEqual(E.parseNumber('22 %').n, 22);
  ['abc', '12,', '1.23.4', '', '1,2,3,4'].forEach((s) => assert.strictEqual(E.parseNumber(s).ok, false, s));
  assert.strictEqual(E.plainNumber(1234.5, ',', 2), '1234,50');
  assert.strictEqual(E.plainNumber(12, '.', 0), '12');
});
t('dates: Slovene and ISO formats, Excel serials, impossible dates', () => {
  assert.deepStrictEqual(E.parseDate('13.10.2026'), { ok: true, iso: '2026-10-13', fam: 'dot', fmt: 'dd.mm.yyyy' });
  assert.strictEqual(E.parseDate('3. 4. 2024').fmt, 'd. m. yyyy');
  assert.strictEqual(E.parseDate('3. 4. 2024').iso, '2024-04-03');
  assert.strictEqual(E.parseDate('2026-10-13').fam, 'iso');
  assert.strictEqual(E.parseDate('2026-10-13 14:35:00').iso, '2026-10-13');
  assert.strictEqual(E.parseDate('13.10.2026 08:15').iso, '2026-10-13');
  assert.strictEqual(E.parseDate('13/10/2026').iso, '2026-10-13');
  assert.strictEqual(E.parseDate('10/13/2026').fam, 'us');
  assert.strictEqual(E.parseDate('13.10.26').iso, '2026-10-13');
  assert.strictEqual(E.parseDate('31.02.2024').why, 'impossible');
  assert.strictEqual(E.parseDate('29.02.2024').ok, true);
  assert.strictEqual(E.parseDate('29.02.2023').ok, false);
  assert.strictEqual(E.parseDate('včeraj').why, 'unparsed');
  assert.strictEqual(E.excelSerialToIso(44927), '2023-01-01');
  assert.strictEqual(E.excelSerialToIso(45000), '2023-03-15');
  assert.strictEqual(E.parseDate('45000', { serial: true }).iso, '2023-03-15');
  assert.strictEqual(E.parseDate('45000').ok, false, 'a plain number is not a date unless the column is a date column');
  assert.strictEqual(E.formatDate('2026-03-04', 'dd.mm.yyyy'), '04.03.2026');
  assert.strictEqual(E.formatDate('2026-03-04', 'd. m. yyyy'), '4. 3. 2026');
});

// ── similarity ───────────────────────────────────────────────────────────
t('Jaro and Jaro-Winkler match the textbook values', () => {
  near(E.jaro('MARTHA', 'MARHTA'), 0.9444);
  near(E.jaroWinkler('MARTHA', 'MARHTA'), 0.9611);
  near(E.jaroWinkler('DWAYNE', 'DUANE'), 0.84);
  near(E.jaroWinkler('DIXON', 'DICKSONX'), 0.8133);
  assert.strictEqual(E.jaroWinkler('abc', 'abc'), 1);
  assert.strictEqual(E.jaroWinkler('', 'abc'), 0);
  assert.deepStrictEqual(E.nameTokens('VZOREC ENERGIJA, D.O.O.'), ['vzorec', 'energija']);
  assert.deepStrictEqual(E.nameTokens('Vzorec energija d. o. o.'), ['vzorec', 'energija']);
  assert.deepStrictEqual(E.nameTokens('Nordtherm Heiztechnik GmbH & Co. KG'), ['nordtherm', 'heiztechnik']);
  assert.strictEqual(E.nameSim('Vzorec Energija d.o.o.', 'VZOREC ENERGIJA, D.O.O.'), 1);
  assert.strictEqual(E.nameSim('Termoplan Savinja', 'Termo-plan Savinja d.o.o.'), 1);
  assert.ok(E.nameSim('Domotehna Center d.o.o.', 'Domotehna Centar d.o.o.') > 0.95);
  assert.ok(E.nameSim('Energija Vzorec', 'Vzorec Energija') > 0.99, 'token order does not matter');
  assert.ok(E.nameSim('Elektro', 'Elektro Kres s.p.') < 0.8, 'a shorter name is not the same partner');
  assert.ok(E.nameSim('Vzorec Energija d.o.o.', 'Vzorec Gradnje d.o.o.') < 0.6, 'a shared first word is not enough');
  near(E.levSim('kitten', 'sitting'), 1 - 3 / 7);
});

// ── analysis ─────────────────────────────────────────────────────────────
t('duplicates: blocking, scores and union-find groups on a fixture', () => {
  const H = ['Šifra', 'Naziv', 'Ulica', 'Pošta', 'Kraj', 'Država', 'Davčna številka', 'Telefon', 'E-pošta'];
  const rows = [
    ['K1', 'Vzorec Energija d.o.o.', 'Tržaška cesta 116', '1000', 'Ljubljana', 'SI', 'SI12345679', '01 234 56 78', 'info@vzorec.example.com'],
    ['K2', 'Hiša Mojstrov d.o.o.', 'Obrtna ulica 4', '3000', 'Celje', 'SI', '', '03 555 12 12', 'prodaja@hisa.example.com'],
    ['K3', 'VZOREC ENERGIJA, D.O.O.', 'Tržaška c. 116', '1000', 'Ljubljana', 'SI', 'SI 1234 5679', '+386 1 234 56 78', ''],
    ['K4', 'Elektro Kres s.p.', 'Kidričeva ulica 1', '2000', 'Maribor', 'SI', '', '02 555 11 11', ''],
    ['K5', 'Hisa mojstrov', 'Obrtna ul. 4', '3000', 'Celje', 'Slovenija', '', '', 'prodaja@hisa.example.com'],
    ['K6', 'Vzorec energija doo', '', '1000', 'Ljubljana', 'SI', '', '', 'info@vzorec.example.com'],
    ['K7', 'Elektro Krek s.p.', 'Partizanska cesta 7', '4000', 'Kranj', 'SI', '', '04 555 22 22', ''],
    ['K8', 'Lumen Gradnje d.o.o.', 'Industrijska cesta 2', '8000', 'Novo mesto', 'SI', '', '07 555 33 33', '']];
  const tb = table(H, rows);
  const res = run(tb);
  assert.deepStrictEqual(res.groups.map((g) => g.rows), [[0, 2, 5], [1, 4]]);
  assert.strictEqual(res.groups[0].survivor, 0, 'the most complete row survives');
  assert.deepStrictEqual(rowsOf(res, 'dup.record'), [2, 4, 5]);
  // a different survivor and "not duplicates"
  const res2 = E.applyDupes(res, tb, { dupThreshold: 85, survivors: { 2: 1 }, notDup: { '1:4': 1 } });
  assert.deepStrictEqual(res2.groups.map((g) => g.rows), [[0, 2, 5]]);
  assert.strictEqual(res2.groups[0].survivor, 2);
  assert.deepStrictEqual(rowsOf(res2, 'dup.record'), [0, 5]);
  // a strict threshold splits the weaker matches off
  const res3 = E.applyDupes(res, tb, { dupThreshold: 101 });
  assert.strictEqual(res3.groups.length, 0);
  // merged row keeps the survivor and fills its gaps
  const merged = E.mergeRow(tb.rows, [0, 2, 5], 5);
  assert.strictEqual(merged[1], 'Vzorec energija doo'); assert.strictEqual(merged[2], 'Tržaška cesta 116'); assert.strictEqual(merged[6], 'SI12345679');
});

t('scoring: 100 × (1 − Σ row weights ÷ 3n); errors weigh 3, warnings 1, info 0', () => {
  // row 1: invalid e-mail (error); row 2: double spaces (info) and trailing space (warning); row 3: phone not in E.164 (info)
  const tb = table(['Naziv', 'E-pošta', 'Telefon'], [['Vzorec', 'a@vzorec.example.com', '+38612345678'], ['Lumen', 'lumen.example.com', '+38612345678'],
    ['Struna  Gradnje ', 'b@x.example.com', '+38612345678'], ['Polarka', 'c@x.example.com', '01 234 56 78']]);
  const res = run(tb, { roles: ['name', 'email', 'phone'], required: [], recommended: [] });
  assert.deepStrictEqual(Array.from(res.rowW), [0, 3, 1, 0]);
  assert.strictEqual(res.score, Math.round(100 * (1 - 4 / 12)));
  assert.deepStrictEqual(res.colScores, [Math.round(100 * (1 - 1 / 12)), Math.round(100 * (1 - 3 / 12)), 100]);
  assert.strictEqual(res.scoreAfter, Math.round(100 * (1 - 3 / 12)), 'after the one-click fixes only the e-mail error remains');
  assert.deepStrictEqual([res.counts.error, res.counts.warning, res.counts.info], [1, 1, 2]);
  assert.strictEqual(res.rowsErr, 1); assert.strictEqual(res.rowsWarn, 1);
  // a single error never shows as 100
  const one = table(['Naziv', 'E-pošta'], Array.from({ length: 400 }, (_, i) => ['N' + i, i ? 'a' + i + '@x.example.com' : 'bad']));
  assert.strictEqual(run(one, { roles: ['name', 'email'], required: [], recommended: [] }).score, 99);
  assert.strictEqual(E.scoreBand(92), 'good'); assert.strictEqual(E.scoreBand(80), 'fair'); assert.strictEqual(E.scoreBand(60), 'poor'); assert.strictEqual(E.scoreBand(20), 'critical');
});

t('analysis: required fields, cross-field checks and column-level rules', () => {
  const H = ['Šifra', 'Naziv', 'Ulica', 'Pošta', 'Kraj', 'Država', 'ID za DDV', 'TRR', 'BIC', 'Datum vnosa', 'Kreditni limit', 'Opomba'];
  const rows = [
    ['K1', 'Vzorec d.o.o.', 'Cesta 1', '2000', 'Celje', 'Slovenija', 'HR12345678903', 'SI56 1910 0000 0123 438', 'LJBASI2X', '13.10.2025', '15000,00', ''],
    ['K1', 'Lumen d.o.o.', 'Cesta 2', '1000', 'LJUBLJANA', 'SI', 'SI12345679', '191000000123438', 'DEUTDEFF', '2025-10-14', '15.000,00', '-'],
    ['K3', 'Struna d.o.o.', '', '10000', 'Zagreb', 'Hrvatska', '', 'HR1210010051863000160', '', '01.03.2027', '12.5', 'n/a'],
    ['K4', 'Polarka d.o.o.', 'Cesta 4', '1000', 'Ljubljana', 'SLO', '12345679', '', '', '45000', '€ 5.000', 'ok']];
  const tb = table(H, rows);
  const res = run(tb);
  assert.deepStrictEqual(res.roles, ['id', 'name', 'street', 'postal', 'city', 'country', 'vat', 'iban', 'bic', 'date', 'number', 'text']);
  assert.deepStrictEqual(rowsOf(res, 'id.dup'), [0, 1]);
  assert.deepStrictEqual(kinds(res, 'postal.city').map((x) => [x.r, x.s]), [[0, 'Maribor']]);
  assert.deepStrictEqual(kinds(res, 'vat.country').map((x) => [x.r, x.p]), [[0, 'HR|SI']]);
  assert.deepStrictEqual(kinds(res, 'iban.local').map((x) => [x.r, x.f]), [[1, 'SI56191000000123438']]);
  assert.deepStrictEqual(kinds(res, 'iban.clean').map((x) => x.r), [0]);
  assert.deepStrictEqual(kinds(res, 'bic.mismatch').map((x) => [x.r, x.p]), [], 'row 1 IBAN is local, so its BIC is not compared');
  assert.deepStrictEqual(kinds(res, 'req.missing').map((x) => [x.r, x.p]), [[2, 'street']]);
  assert.deepStrictEqual(kinds(res, 'rec.missing').map((x) => [x.r, x.p]), [[2, 'vat']], 'VAT is empty in row 2');
  assert.deepStrictEqual(res.structure.map((x) => x.k + ':' + x.p), ['rec.nocolumn:email', 'rec.nocolumn:phone'], 'all required columns exist; two recommended ones do not');
  assert.deepStrictEqual(kinds(res, 'text.caps').map((x) => [x.r, x.f]), [[1, 'Ljubljana']], 'the city in capitals is fixed from the postal lookup');
  assert.deepStrictEqual(kinds(res, 'text.placeholder').map((x) => [x.r, x.p]), [[1, '-'], [2, 'n/a']]);
  assert.deepStrictEqual(kinds(res, 'country.mixed').map((x) => [x.r, x.f]), [[0, 'SI'], [2, 'HR'], [3, 'SI']]);
  assert.deepStrictEqual(kinds(res, 'date.future').map((x) => x.r), [2]);
  assert.deepStrictEqual(kinds(res, 'date.mixed').map((x) => [x.r, x.f]), [[1, '14.10.2025'], [3, '15.03.2023']]);
  assert.deepStrictEqual(kinds(res, 'num.mixed').map((x) => [x.r, x.f]), [[2, '12,5']]);
  assert.deepStrictEqual(kinds(res, 'num.format').map((x) => [x.r, x.f]), [[1, '15000,00'], [3, '5000']]);
  // the Croatian row is checked with Croatian rules
  assert.strictEqual(res.rowCC[2], 'HR');
  assert.deepStrictEqual(rowsOf(res, 'postal.format'), []);
});

t('analysis: products, units, VAT rates, prices and outliers', () => {
  const H = ['Šifra', 'Naziv', 'EAN', 'EM', 'Cena brez DDV', 'DDV %'];
  const rows = [];
  for (let i = 0; i < 30; i++) {
    const body = '383' + String(100000000 + i * 37).slice(0, 9);
    rows.push(['A' + i, 'Artikel ' + i, body + E.gtinCheckDigit(body), i % 5 === 0 ? 'KOS' : 'kos', (10 + i).toFixed(2).replace('.', ','), '22']);
  }
  rows[3][4] = '0,00'; rows[4][4] = '-5,00'; rows[5][4] = '125000,00'; rows[6][5] = '0,22'; rows[7][5] = '20'; rows[8][5] = '9,5'; rows[9][2] = rows[10][2];
  rows[11][0] = 'A12'; rows[12][3] = 'kom';
  const tb = table(H, rows);
  const res = run(tb, { type: 'products' });
  assert.deepStrictEqual(res.roles, ['sku', 'name', 'ean', 'unit', 'price', 'vatrate']);
  assert.deepStrictEqual(rowsOf(res, 'price.zero'), [3]);
  assert.deepStrictEqual(rowsOf(res, 'price.negative'), [4]);
  assert.deepStrictEqual(rowsOf(res, 'price.outlier'), [5]);
  assert.deepStrictEqual(kinds(res, 'vatrate.fraction').map((x) => [x.r, x.f]), [[6, '22']]);
  assert.deepStrictEqual(rowsOf(res, 'vatrate.unusual'), [7]);
  assert.deepStrictEqual(rowsOf(res, 'ean.dup'), [9, 10]);
  assert.deepStrictEqual(rowsOf(res, 'id.dup'), [11, 12]);
  const units = kinds(res, 'unit.variant');
  assert.ok(units.every((x) => x.f === 'kos'), 'the most common spelling wins');
  assert.deepStrictEqual(units.map((x) => x.r), [0, 5, 10, 12, 15, 20, 25]);
  const chosen = run(tb, { type: 'products', unitTarget: 'kom' });
  assert.ok(kinds(chosen, 'unit.variant').every((x) => x.f === 'kom') && kinds(chosen, 'unit.variant').length === 29, 'the unit the person chose');
  assert.deepStrictEqual(res.structure, []);
  assert.strictEqual(res.score <= 99 && res.score >= 0, true);
  const noUnit = run(table(['Šifra', 'Naziv', 'Cena'], [['A', 'B', '1,00'], ['C', 'D', '2,00']]), { type: 'products' });
  assert.deepStrictEqual(noUnit.structure.map((x) => x.k + ':' + x.p), ['req.nocolumn:unit', 'rec.nocolumn:ean']);
  assert.strictEqual(noUnit.score, 0, 'a missing required column means every row lacks that field');
  assert.deepStrictEqual(noUnit.colScores, [100, 100, 100], 'column scores only look at the columns that exist');
  const noEan = run(table(['Šifra', 'Naziv', 'EM', 'Cena'], [['A', 'B', 'kos', '1,00'], ['C', 'D', 'kos', '2,00']]), { type: 'products' });
  assert.strictEqual(noEan.score, 100, 'a missing recommended column is only listed');
});

t('role and type guessing from Slovene, Croatian and English headers', () => {
  const g = (hs) => E.guessRoles({ headers: hs, rows: [] }, 'SI').roles;
  assert.deepStrictEqual(g(['Šifra', 'Naziv', 'Ulica', 'Pošta', 'Kraj', 'Država', 'Davčna številka', 'Matična številka', 'Telefon', 'E-pošta', 'TRR', 'Kontaktna oseba', 'Plačilni rok', 'Kreditni limit', 'Datum vnosa']),
    ['id', 'name', 'street', 'postal', 'city', 'country', 'vat', 'regno', 'phone', 'email', 'iban', 'text', 'number', 'number', 'date']);
  assert.deepStrictEqual(g(['Šifra', 'Naziv', 'EAN', 'EM', 'Cena brez DDV', 'DDV %', 'Dobavitelj', 'Skupina']), ['id', 'name', 'ean', 'unit', 'price', 'vatrate', 'text', 'text']);
  assert.deepStrictEqual(g(['Šifra', 'Naziv', 'Adresa', 'Poštanski broj', 'Mjesto', 'Država', 'PDV ID', 'OIB', 'IBAN', 'BIC', 'Telefon', 'E-mail', 'Web', 'Rok plaćanja']),
    ['id', 'name', 'street', 'postal', 'city', 'country', 'vat', 'oib', 'iban', 'bic', 'phone', 'email', 'website', 'number']);
  assert.deepStrictEqual(g(['Customer ID', 'Company name', 'Address', 'ZIP', 'City', 'Country', 'VAT number', 'Phone', 'Email', 'Website', 'SWIFT', 'Barcode', 'Unit price', 'Created on']),
    ['id', 'name', 'street', 'postal', 'city', 'country', 'vat', 'phone', 'email', 'website', 'bic', 'ean', 'price', 'date']);
  assert.deepStrictEqual(g(['Naziv', 'Naziv 2', 'GSM', 'Telefon']), ['name', 'text', 'phone', 'phone'], 'only one name column; several phone columns are fine');
  const roles = E.rolesForType(['id', 'name', 'ean', 'unit', 'price'], 'products');
  assert.deepStrictEqual(roles, ['sku', 'name', 'ean', 'unit', 'price']);
  assert.strictEqual(E.guessType({ headers: ['Šifra', 'Naziv', 'EAN', 'EM', 'Cena'] }, roles, 'cenik.csv'), 'products');
  assert.strictEqual(E.guessType({ headers: ['Šifra', 'Naziv'] }, ['id', 'name'], 'dobavljaci_eu.txt'), 'suppliers');
  assert.strictEqual(E.guessType({ headers: ['Šifra', 'Naziv dobavitelja'] }, ['id', 'name'], 'export.csv'), 'suppliers');
  assert.strictEqual(E.guessType({ headers: ['Šifra', 'Naziv'] }, ['id', 'name'], 'kupci.csv'), 'customers');
});

t('chunked analysis gives the same result as one pass, with progress', () => {
  const H = ['Šifra', 'Naziv', 'Pošta', 'Kraj', 'E-pošta'];
  const rows = Array.from({ length: 900 }, (_, i) => ['K' + i, (i % 7 ? 'Partner ' : 'PARTNER ') + i, '1000', i % 11 ? 'Ljubljana' : 'Celje', i % 13 ? 'p' + i + '@x.example.com' : 'p' + i + '@x']);
  const tb = table(H, rows), roles = E.guessRoles(tb, 'SI').roles, cfg = { type: 'customers', roles, required: ['name'], recommended: ['email'], home: 'SI', today: '2026-10-13' };
  const one = E.analyze(tb, cfg), job = E.analysisJob(tb, cfg);
  let steps = 0, last = 0;
  while (!job.done) { job.step(500); steps++; assert.ok(job.progress >= last); last = job.progress; }
  assert.ok(steps > 20, 'many small steps');
  assert.strictEqual(job.progress, 1);
  assert.strictEqual(job.result.issues.length, one.issues.length);
  assert.strictEqual(job.result.score, one.score);
  assert.deepStrictEqual(job.result.issues.map((x) => x.k + x.r + ':' + x.c), one.issues.map((x) => x.k + x.r + ':' + x.c));
  assert.strictEqual(E.message(kinds(one, 'postal.city')[0], { table: tb, res: one }), '1000 is the postal code of Ljubljana.');
});

// ── demo files ───────────────────────────────────────────────────────────

if (D) {
  const TODAY = '2026-10-13';
  function demo(id, today) {
    const f = D.file(id, today || TODAY), dec = E.decode(f.bytes), tb = E.readText(dec.text), setup = E.autoSetup(tb, f.name, 'SI');
    const req = E.DEFAULT_REQ[setup.type];
    const res = E.analyze(tb, { type: setup.type, roles: setup.roles, required: req.required, recommended: req.recommended, home: 'SI', today: today || TODAY });
    return { f, dec, tb, setup, res };
  }
  const found = (res, key) => {
    const [k, p] = key.split(':');
    return Array.from(new Set(res.issues.filter((x) => x.k === k && (p == null || x.p === p)).map((x) => x.r))).sort((a, b) => a - b);
  };
  function exact(d, keys) {
    keys.forEach((key) => assert.deepStrictEqual(found(d.res, key), (d.f.plan[key] || []).slice().sort((a, b) => a - b), d.f.id + ' ' + key));
    assert.deepStrictEqual(d.res.groups.map((g) => g.rows).sort((a, b) => a[0] - b[0]), d.f.plan.groups, d.f.id + ' duplicate groups');
  }

  t('demo files are deterministic and shift with today', () => {
    ['customers', 'products', 'suppliers'].forEach((id) => {
      const a = D.file(id, TODAY), b = D.file(id, TODAY);
      assert.deepStrictEqual(Array.from(a.bytes), Array.from(b.bytes), id);
      assert.deepStrictEqual(a.plan, b.plan, id);
    });
    const later = D.file('customers', '2027-03-01');
    assert.notStrictEqual(later.text, D.file('customers', TODAY).text, 'dates move with today');
    assert.ok(later.text.indexOf('Datum izpisa: 1.3.2027') > 0);
  });

  t('demo customers: an old ERP export with exactly the planted problems', () => {
    const d = demo('customers');
    assert.strictEqual(d.f.rows, 420); assert.strictEqual(d.tb.rows.length, 420);
    assert.strictEqual(d.dec.encoding, 'utf-8'); assert.strictEqual(d.tb.delim, ';');
    assert.strictEqual(d.tb.skipped, 2, 'title lines above the header'); assert.strictEqual(d.tb.header, 4);
    assert.strictEqual(d.setup.type, 'customers');
    assert.deepStrictEqual(d.setup.roles, ['id', 'name', 'street', 'postal', 'city', 'country', 'vat', 'regno', 'phone', 'email', 'iban', 'text', 'number', 'number', 'date']);
    exact(d, ['vat.checksum', 'vat.country', 'rec.missing:vat', 'rec.missing:phone', 'rec.missing:email', 'req.missing:country', 'iban.checksum', 'iban.format', 'iban.local',
      'email.invalid', 'email.typo', 'email.clean', 'email.multi', 'postal.city', 'phone.invalid', 'phone.multi', 'text.mojibake', 'text.caps', 'text.placeholder',
      'ws.trim', 'ws.double', 'ws.nbsp', 'ws.newline', 'id.dup', 'date.future', 'date.mixed', 'num.format']);
    const p = d.f.plan, n = 420, share = (k) => p[k].length / n;
    assert.strictEqual(d.res.groups.length, 25);
    assert.ok(d.res.groups.every((g) => g.rows.length === 2 || g.rows.length === 3));
    near(share('email.invalid'), 0.06, 0.01, 'about 6 % invalid e-mails');
    near(share('vat.checksum'), 0.04, 0.01, 'about 4 % VAT check-digit errors');
    near(found(d.res, 'rec.missing:vat').length / n, 0.09, 0.03, 'about 9 % without VAT ID');
    near((p['iban.checksum'].length + p['iban.format'].length) / n, 0.03, 0.01, 'about 3 % IBAN errors');
    near(share('text.mojibake'), 0.05, 0.01, 'about 5 % mojibake');
    near(share('postal.city'), 0.03, 0.01, 'about 3 % postal/city mismatches');
    assert.strictEqual(p['id.dup'].length, 4, 'two codes typed twice');
    assert.ok(p['date.future'].length >= 3);
    assert.ok(found(d.res, 'country.mixed').length > 200, 'country spelt in several ways');
    assert.ok(found(d.res, 'phone.format').length > 200, 'phone numbers in every format');
    assert.deepStrictEqual(found(d.res, 'vat.dup'), [], 'no VAT ID is shared outside the duplicate groups');
    assert.deepStrictEqual(found(d.res, 'vat.format'), []);
    assert.deepStrictEqual(found(d.res, 'date.invalid'), []);
    assert.deepStrictEqual(found(d.res, 'num.mixed'), []);
    assert.ok(d.res.score < d.res.scoreAfter, 'one-click fixes raise the score');
    // every e-mail is fictional, every phone is in the 555 range
    d.tb.rows.forEach((r) => { if (r[9]) assert.ok(/example\.(com|con|cmo|com,)|@example$|example,com/.test(r[9]), r[9]); });
    d.tb.rows.forEach((r, i) => { if (r[8] && !p['phone.invalid'].includes(i)) assert.ok(/555/.test(r[8].replace(/\D/g, '')), r[8]); });
  });

  t('demo products: barcodes, units, prices and VAT rates', () => {
    const d = demo('products');
    assert.strictEqual(d.tb.rows.length, 260);
    assert.strictEqual(d.setup.type, 'products');
    assert.deepStrictEqual(d.setup.roles, ['sku', 'name', 'ean', 'unit', 'price', 'vatrate', 'text', 'text']);
    exact(d, ['ean.checksum', 'ean.sci', 'ean.zero', 'rec.missing:ean', 'req.missing:price', 'price.zero', 'price.negative', 'price.outlier', 'num.mixed', 'num.format',
      'unit.variant', 'vatrate.unusual', 'vatrate.fraction', 'text.caps', 'ws.trim', 'id.dup', 'ean.dup']);
    assert.ok(d.tb.rows.some((r) => /"/.test(r[1])), 'names with inch marks survive the CSV quoting');
    assert.strictEqual(d.res.profiles[3].unit.pc.target, 'kos');
  });

  t('demo suppliers: Windows-1250, tabs, Croatian headers, seven countries', () => {
    const d = demo('suppliers');
    assert.strictEqual(d.tb.rows.length, 120);
    assert.strictEqual(d.dec.encoding, 'windows-1250'); assert.strictEqual(d.dec.fallback, true); assert.strictEqual(d.tb.delim, '\t');
    assert.strictEqual(d.dec.text, d.f.text, 'every character survives Windows-1250');
    assert.strictEqual(d.setup.type, 'suppliers');
    assert.deepStrictEqual(d.setup.roles, ['id', 'name', 'street', 'postal', 'city', 'country', 'vat', 'iban', 'bic', 'phone', 'email', 'website', 'number']);
    exact(d, ['vat.checksum', 'vat.format', 'vat.country', 'iban.checksum', 'iban.format', 'iban.clean', 'bic.mismatch', 'bic.format', 'postal.zero', 'postal.city',
      'email.invalid', 'email.typo', 'phone.invalid', 'web.invalid', 'text.placeholder', 'req.missing:street', 'rec.missing:phone', 'country.code', 'text.caps', 'vat.clean']);
    const countries = new Set(d.res.rowCC);
    assert.deepStrictEqual(Array.from(countries).sort(), ['AT', 'CZ', 'DE', 'HR', 'HU', 'IT', 'SI']);
    assert.deepStrictEqual(found(d.res, 'country.mixed'), [], 'one spelling per country');
  });

  t('demo files: no invalid record slips through as valid', () => {
    // every VAT ID and IBAN that the engine accepts passes the reference checks again
    ['customers', 'suppliers'].forEach((id) => {
      const d = demo(id), cv = d.setup.roles.indexOf('vat'), ci = d.setup.roles.indexOf('iban');
      d.tb.rows.forEach((r, i) => {
        const bad = new Set(d.res.issues.filter((x) => x.r === i).map((x) => x.k));
        const v = E.core(r[cv]).replace(/[\s.-]/g, '').toUpperCase();
        if (v && !bad.has('vat.checksum') && !bad.has('vat.format')) {
          if (/^SI/.test(v) || (/^\d{8}$/.test(v) && d.res.rowCC[i] === 'SI')) assert.ok(E.siTaxOk(v.replace(/^SI/, '')), v);
          if (/^HR/.test(v)) assert.ok(E.oibOk(v.slice(2)), v);
        }
        const b = E.core(r[ci]).replace(/\s/g, '').toUpperCase();
        if (/^[A-Z]{2}\d{2}/.test(b) && !bad.has('iban.checksum') && !bad.has('iban.format')) assert.strictEqual(E.ibanMod(b), 1, b);
      });
    });
  });
}

console.log(n + ' tests passed');
