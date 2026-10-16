/* Data health check demo files (Business Apps). Every company, person, address, VAT ID, account, phone number and e-mail is
 * fictional; e-mails use example.com and phone numbers the 555 range.
 *
 * file(id, today) builds one of three exports of Nordvik Distribucija d.o.o. (the wholesaler from the Cash forecast demo)
 * as the bytes of a real file, so a demo runs through the same reader as an upload:
 *   customers  kupci_stari_erp.csv   420 rows, UTF-8, semicolons, title lines above the header, Slovene headers
 *   products   cenik_artiklov.csv    260 rows, UTF-8 with BOM, semicolons
 *   suppliers  dobavljaci_eu.txt     120 rows, Windows-1250, tabs, Croatian headers, 7 countries
 * Problems are planted at known rows; `plan[rule]` lists those rows (0-based data rows) and `plan.groups` the duplicate
 * groups, so the tests can check that the engine finds exactly them. The same `today` always gives the same bytes. UMD. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.DataCheckData = factory(root.DataCheckEngine);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';
  var VERSION = 1;

  function rng(seed) {
    var a = seed >>> 0;
    var f = function () { a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    f.int = function (lo, hi) { return Math.floor(lo + (hi - lo + 1) * f()); };
    f.pick = function (a) { return a[Math.floor(f() * a.length)]; };
    f.chance = function (p) { return f() < p; };
    f.digits = function (n) { var s = ''; for (var i = 0; i < n; i++) s += Math.floor(f() * 10); return s; };
    f.shuffle = function (arr) { for (var i = arr.length - 1; i > 0; i--) { var j = Math.floor(f() * (i + 1)), t = arr[i]; arr[i] = arr[j]; arr[j] = t; } return arr; };
    f.weighted = function (items, w) { var s = 0, i; for (i = 0; i < w.length; i++) s += w[i]; var x = f() * s; for (i = 0; i < w.length; i++) { x -= w[i]; if (x < 0) return items[i]; } return items[items.length - 1]; };
    return f;
  }
  function range(n) { var a = []; for (var i = 0; i < n; i++) a.push(i); return a; }
  function pad(n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; }
  function slug(name) { return E.nameTokens(name).slice(0, 2).join('-') || 'partner'; }
  function sl(iso) { return iso.slice(8, 10) + '.' + iso.slice(5, 7) + '.' + iso.slice(0, 4); }
  function money(n) { return n.toFixed(2).replace('.', ','); }
  function money1000(n) { var s = n.toFixed(2).split('.'), i = s[0], out = ''; while (i.length > 3) { out = '.' + i.slice(-3) + out; i = i.slice(0, -3); } return i + out + ',' + s[1]; }

  // ── fictional identifiers that pass the official checks ────────────────
  function siTax(R) { for (;;) { var d7 = String(R.int(1, 9)) + R.digits(6), c = E.siTaxCheckDigit(d7); if (c >= 0) return d7 + c; } }
  function oib(R) { var d10 = String(R.int(1, 9)) + R.digits(9); return d10 + E.oibCheckDigit(d10); }
  function wrongLast(R, s) { var last = +s[s.length - 1], d = (last + R.int(1, 9)) % 10; return s.slice(0, -1) + d; }
  /** a Slovene account (BBAN): bank, branch and account digits, then the 2 national check digits that make every SI IBAN start with SI56 */
  function siBban(R) {
    var base = R.pick(['02', '03', '04', '05', '10', '19', '26', '29', '33', '34', '61', '90']) + R.digits(11);
    var m = 0; for (var i = 0; i < base.length; i++) m = (m * 10 + +base[i]) % 97;
    return base + pad(((1 - (m * 100) % 97) % 97 + 97) % 97, 2);
  }
  var BBAN_LEN = { AT: 16, DE: 18, HU: 24, CZ: 20, HR: 17 };
  function iban(R, cc) {
    var bban = cc === 'SI' ? siBban(R) : cc === 'IT' ? R.pick(['A', 'B', 'C', 'D', 'E', 'G', 'H', 'K', 'L', 'M', 'N', 'P', 'R', 'S', 'T', 'X']) + R.digits(22) : R.digits(BBAN_LEN[cc]);
    return cc + E.ibanCheckDigits(cc, bban) + bban;
  }
  function spaced(iban) { return iban.replace(/(.{4})/g, '$1 ').trim(); }
  function ean13(R, prefix) { var body = prefix + R.digits(12 - prefix.length); return body + E.gtinCheckDigit(body); }
  function sci(digits) { var n = +digits, e = digits.length - 1, m = (n / Math.pow(10, e)).toFixed(5).replace(/\.?0+$/, '').replace('.', ','); return m + 'E+' + e; }
  /** a typing slip: two neighbouring letters of the second word swapped */
  function typo(name) {
    var t = name.split(' '), k = t.length > 2 && t[1].length >= 5 ? 1 : 0, w = t[k];
    if (w.length >= 5) t[k] = w.slice(0, 2) + w[3] + w[2] + w.slice(4);
    return t.join(' ');
  }

  // ── names ──────────────────────────────────────────────────────────────
  var CASHFLOW_CUSTOMERS = ['Termoplan Savinja d.o.o.', 'Vzorec Energija d.o.o.', 'Lumen Gradnje d.o.o.', 'Vetrnica Instalacije d.o.o.', 'Polarka Klima d.o.o.',
    'Gradbeni Sistemi Vrh d.d.', 'Struna Gradnje d.o.o.', 'Hiša Mojstrov d.o.o.', 'Domotehna Center d.o.o.', 'Občina Zelena Dolina', 'Dom upokojencev Breza',
    'Zavod Šolski Center Lipa', 'Elektro Kres s.p.', 'Toplotne Črpalke Sever d.o.o.', 'Vodovod Mreža d.o.o.', 'Strojna Montaža Gaber d.o.o.', 'Klimatika Jadran d.o.o.',
    'Instal Plus Kranjc s.p.', 'Sončna Streha d.o.o.', 'Megagrad Holding d.d.', 'Ogrevanje Bistrica d.o.o.', 'Tehno Dom Mesec d.o.o.', 'Zdravstveni Dom Vrba',
    'Hotel Planika d.d.', 'Ventus Prezračevanje d.o.o.', 'Kopalnice Arkada d.o.o.'];
  var BRANDS = ['Aqualin', 'Brinovec', 'Cevnik', 'Dravex', 'Elkron', 'Fluvia', 'Gradnor', 'Hidrotek', 'Instalix', 'Javornik', 'Kalorik', 'Lipnik', 'Montel', 'Nivelis',
    'Ogrevix', 'Pipex', 'Radiax', 'Sanimont', 'Termika', 'Uvala', 'Vodomer', 'Zidex', 'Žarek', 'Bakrena', 'Cinkarna Vrh', 'Dimex', 'Energal', 'Ferotek', 'Grelec',
    'Iskral', 'Jeklar', 'Klimaro', 'Lesnik', 'Mavrica', 'Nordal', 'Plamenka', 'Rebrač', 'Sončnik', 'Topolar', 'Vetrovnik', 'Zelenjak', 'Kvarcit', 'Mlinarič',
    'Pečnik', 'Ravbar', 'Strelec', 'Amperko', 'Brezar', 'Ciklon', 'Dolinar', 'Eterik', 'Fasadis', 'Gorjanc', 'Hribovc', 'Izolirka', 'Jezerc', 'Kamnolit', 'Ledinek',
    'Mozirnik', 'Nadlesnik', 'Ozimek', 'Podgornik', 'Rožnik', 'Smrekar', 'Tičar', 'Udovč', 'Vrbanc', 'Zavrnik', 'Žibert', 'Arhitekt Plus', 'Bivalnica', 'Celovit',
    'Domus Gradnja', 'Elteh', 'Fortis Bau', 'Grajski', 'Hladilko', 'Inovator', 'Kotlar', 'Lumak', 'Merkurko', 'Novogradnja', 'Obzorje', 'Primat', 'Robnik', 'Stavbar',
    'Trajnica', 'Utripek', 'Vitaltherm', 'Zarjevec', 'Akvaterm', 'Biroterm', 'Cevograd', 'Diatherm', 'Ekotop', 'Fluxtherm', 'Gasterm', 'Heliotop', 'Intertherm', 'Kalortim'];
  var ACTIVITY = ['Instalacije', 'Energija', 'Gradnje', 'Inženiring', 'Storitve', 'Trgovina', 'Servis', 'Tehnika', 'Projekt', 'Elektro', 'Ogrevanje', 'Klima', 'Montaža',
    'Sistemi', 'Center', 'Gradbeništvo'];
  var PLACES = ['Zelena Reber', 'Gorenja Lipa', 'Spodnji Brest', 'Nova Jelša', 'Sončna Dolina', 'Stari Javor', 'Brezova Gora', 'Lipova Ravan', 'Srednji Hrast',
    'Bistri Potok', 'Gornja Vrba', 'Mala Breza', 'Jelova Reber', 'Velika Lipa', 'Hrastov Dol', 'Kamniti Vrh', 'Javorov Laz', 'Lesna Dolina', 'Brinova Gora', 'Topla Reber'];
  var PUBLIC = ['Občina {p}', 'Osnovna šola {p}', 'Vrtec {p}', 'Dom starejših {p}', 'Zdravstveni dom {p}', 'Komunala {p}', 'Knjižnica {p}'];
  var FIRST = ['Janez', 'Marko', 'Andrej', 'Peter', 'Tomaž', 'Matej', 'Luka', 'Nina', 'Maja', 'Petra', 'Mojca', 'Barbara', 'Katja', 'Ana', 'Eva', 'Urška', 'Simona',
    'Gregor', 'Rok', 'Jure', 'Miha', 'Boštjan', 'Primož', 'Tadej', 'Alenka', 'Tanja', 'Mateja', 'Polona', 'Nataša', 'Irena', 'Žiga', 'Špela', 'Črt', 'Jožica'];
  var LAST = ['Novak', 'Horvat', 'Kovačič', 'Krajnc', 'Zupančič', 'Potočnik', 'Kovač', 'Mlakar', 'Vidmar', 'Kos', 'Golob', 'Turk', 'Kralj', 'Božič', 'Korošec',
    'Zupan', 'Bizjak', 'Hribar', 'Kotnik', 'Kavčič', 'Rozman', 'Kastelic', 'Oblak', 'Žagar', 'Petek', 'Hočevar', 'Kolar', 'Košir', 'Koren', 'Klemenčič'];
  var SI_STREETS = ['Industrijska cesta', 'Obrtna ulica', 'Cesta v Gorice', 'Prešernova ulica', 'Kidričeva ulica', 'Gubčeva ulica', 'Cankarjeva cesta',
    'Partizanska cesta', 'Mlinska ulica', 'Kolodvorska ulica', 'Ljubljanska cesta', 'Mariborska cesta', 'Celjska cesta', 'Šolska ulica', 'Vrtna ulica', 'Gozdna pot',
    'Pod hribom', 'Tovarniška cesta', 'Savska cesta', 'Poslovna cona', 'Tržaška cesta', 'Trg svobode', 'Cesta talcev', 'Ulica heroja Šlandra', 'Zagrebška cesta',
    'Koroška cesta', 'Šmartinska cesta', 'Dolenjska cesta', 'Gorenjska cesta', 'Notranjska cesta'];
  var SI_MAIN = [['1000', 25], ['2000', 10], ['3000', 8], ['4000', 6], ['6000', 4], ['8000', 5], ['5000', 3], ['9000', 3]];

  /** distinct names: none is within 0.75 name similarity of another, so the only duplicates in a demo are the planted ones */
  function distinctNames(R, seed, extra, n) {
    var out = [], byTok = {};
    function ok(nm) {
      var toks = E.nameTokens(nm), seen = {};
      for (var i = 0; i < toks.length; i++) {
        var list = (byTok[toks[i]] || []).concat(byTok['#' + toks[i].slice(0, 3)] || []);
        for (var j = 0; j < list.length; j++) { if (seen[list[j]]) continue; seen[list[j]] = 1; if (E.nameSim(nm, out[list[j]]) >= 0.75) return false; }
      }
      return true;
    }
    function add(nm) { var k = out.length; out.push(nm); E.nameTokens(nm).forEach(function (t) { (byTok[t] = byTok[t] || []).push(k); (byTok['#' + t.slice(0, 3)] = byTok['#' + t.slice(0, 3)] || []).push(k); }); }
    seed.forEach(function (nm) { if (out.length < n && ok(nm)) add(nm); });
    var guard = 0;
    while (out.length < n && guard++ < 20000) { var nm = extra(R); if (ok(nm)) add(nm); }
    return out;
  }

  // ════════════════════════════════════════════════════════════════════════
  // Customers from an old ERP
  // ════════════════════════════════════════════════════════════════════════
  var CUST_H = ['Šifra', 'Naziv', 'Ulica', 'Pošta', 'Kraj', 'Država', 'Davčna številka', 'Matična številka', 'Telefon', 'E-pošta', 'TRR', 'Kontaktna oseba', 'Plačilni rok', 'Kreditni limit', 'Datum vnosa'];
  var HR_CITIES = [['10000', 'Zagreb', 'Ilica'], ['21000', 'Split', 'Poljička cesta'], ['51000', 'Rijeka', 'Riječka ulica'], ['31000', 'Osijek', 'Vukovarska cesta'],
    ['23000', 'Zadar', 'Ulica bana Josipa Jelačića'], ['42000', 'Varaždin', 'Zagrebačka ulica'], ['52100', 'Pula', 'Istarska ulica']];
  function siPhone(R, mobile) {
    if (mobile) return R.pick(['30', '31', '40', '41', '51', '64', '68', '70', '71']) + '555' + R.digits(3);
    return R.pick(['1', '1', '1', '2', '3', '4', '5', '7']) + '555' + R.digits(4);
  }
  function siPhoneText(nsn, style) {
    var mob = nsn.length === 8 && /^[3-7]\d/.test(nsn) && !/^[2-57]555/.test(nsn), a = mob ? nsn.slice(0, 2) : nsn.slice(0, 1), rest = nsn.slice(a.length);
    var g = mob ? [rest.slice(0, 3), rest.slice(3)] : [rest.slice(0, 3), rest.slice(3, 5), rest.slice(5)];
    switch (style) {
      case 0: return '0' + a + ' ' + g.join(' ');
      case 1: return '+386 ' + a + ' ' + g.join(' ');
      case 2: return '0' + a + rest;
      case 3: return '0' + a + '/' + g.join('-');
      case 4: return '00386 ' + a + ' ' + rest;
      case 5: return '(0' + a + ') ' + g.join(' ');
      case 6: return '+386 (0)' + a + ' ' + g.join(' ');
      default: return '+386' + nsn;
    }
  }
  function custName(R) {
    var r = R();
    if (r < 0.86) return R.pick(BRANDS) + ' ' + R.pick(ACTIVITY) + ' ' + R.weighted(['d.o.o.', 's.p.', 'd.d.', 'j.d.o.o.', 'k.d.', 'd.n.o.'], [80, 8, 4, 4, 2, 2]);
    if (r < 0.94) return R.pick(PUBLIC).replace('{p}', R.pick(PLACES));
    return R.pick(['Elektro', 'Vodovod', 'Ogrevanje', 'Klima', 'Instalacije', 'Montaža', 'Keramika', 'Kleparstvo']) + ' ' + R.pick(LAST) + ' s.p.';
  }

  function customers(today) {
    var R = rng(0xDC0420), N_BASE = 388;
    var names = distinctNames(R, CASHFLOW_CUSTOMERS, custName, N_BASE);
    var ccs = R.shuffle(range(N_BASE).map(function (i) { return i < 10 ? 'HR' : i < 13 ? 'AT' : i < 15 ? 'IT' : 'SI'; }));
    var siCodes = Object.keys(E.POST_MAIN.SI).filter(function (c) { return SI_MAIN.every(function (m) { return m[0] !== c; }); });
    var usedPhone = {}, usedTax = {}, usedSlug = {};
    function uniq(used, make) { for (var g = 0; g < 50; g++) { var v = make(); if (!used[v]) { used[v] = 1; return v; } } return make(); }
    var list = names.map(function (nm, i) {
      var cc = ccs[i], o = { name: nm, cc: cc, marks: {} }, mob = R.chance(0.35);
      o.contact = R.pick(FIRST) + ' ' + R.pick(LAST);
      var sg = slug(nm); if (usedSlug[sg]) sg = E.nameTokens(nm).join('-'); if (usedSlug[sg]) sg += '-' + i; usedSlug[sg] = 1;
      o.email = R.weighted(['info', 'prodaja', 'nabava', 'racunovodstvo', 'office'], [50, 15, 15, 12, 8]) + '.' + sg + '@example.com';
      o.terms = String(R.pick([15, 30, 30, 30, 45, 45, 60]));
      var lim = R.int(2, 50) * 1000, ls = R();
      o.limit = ls < 0.08 ? '' : ls < 0.92 ? money(lim) : ls < 0.97 ? money1000(lim) : lim % 1000 === 0 && R.chance(0.5) ? String(lim) : money(lim);
      if (o.limit && o.limit.indexOf('.') > 0) o.marks['num.format'] = 1;
      if (cc === 'SI') {
        var code = R.chance(0.64) ? R.weighted(SI_MAIN.map(function (m) { return m[0]; }), SI_MAIN.map(function (m) { return m[1]; })) : R.pick(siCodes);
        var po = E.POST_MAIN.SI[code];
        o.postal = code; o.city = po.names.length > 1 && R.chance(0.2) ? po.names[1] : po.name;
        o.street = R.pick(SI_STREETS) + ' ' + R.int(1, 140) + (R.chance(0.1) ? R.pick(['a', 'b', 'c']) : '');
        o.country = R.weighted(['Slovenija', 'SI', 'SLO', 'Slovenia', 'Republika Slovenija', 'SVN'], [50, 25, 10, 8, 4, 3]);
        var tax = uniq(usedTax, function () { return siTax(R); }), vs = R();
        o.vatDigits = tax;
        o.vat = vs < 0.62 ? 'SI' + tax : vs < 0.82 ? tax : vs < 0.94 ? 'SI ' + tax : 'SI ' + tax.slice(0, 4) + ' ' + tax.slice(4);
        o.regno = String(R.int(1, 9)) + R.digits(6) + (R.chance(0.85) ? '000' : '');
        var nsn = uniq(usedPhone, function () { return siPhone(R, mob); });
        o.phone = siPhoneText(nsn, R.weighted([0, 1, 2, 3, 4, 5, 6, 7], [30, 18, 12, 12, 6, 6, 6, 10]));
        var acct = iban(R, 'SI'), is = R();
        o.ibanNorm = acct;
        o.iban = is < 0.55 ? spaced(acct) : is < 0.86 ? acct : acct.slice(4, 9) + '-' + acct.slice(9);
        if (is >= 0.86) o.marks['iban.local'] = 1;
      } else if (cc === 'HR') {
        var hc = R.pick(HR_CITIES);
        o.postal = hc[0]; o.city = hc[1]; o.street = hc[2] + ' ' + R.int(1, 120);
        o.country = R.pick(['Hrvatska', 'HR', 'Croatia']);
        var oi = oib(R);
        o.vat = R.chance(0.6) ? 'HR' + oi : oi; o.vatDigits = oi;
        o.regno = '';
        o.phone = uniq(usedPhone, function () { return mob ? '09' + R.pick(['1', '5', '8']) + ' 555 ' + R.digits(4) : '+385 1 555 ' + R.digits(4); });
        o.iban = spaced(iban(R, 'HR'));
      } else if (cc === 'AT') {
        var at = R.pick([['8020', 'Graz', 'Annenstraße'], ['9020', 'Klagenfurt', 'Bahnhofstraße'], ['9500', 'Villach', 'Hauptplatz']]);
        o.postal = at[0]; o.city = at[1]; o.street = at[2] + ' ' + R.int(1, 60);
        o.country = R.pick(['Avstrija', 'AT']); o.vat = 'ATU' + R.digits(8); o.regno = '';
        o.phone = '+43 ' + (at[1] === 'Graz' ? '316' : at[1] === 'Klagenfurt' ? '463' : '4242') + ' 555 ' + R.digits(3);
        o.iban = spaced(iban(R, 'AT'));
      } else {
        var it = R.pick([['34121', 'Trieste', 'Via Roma'], ['34170', 'Gorizia', 'Corso Italia']]);
        o.postal = it[0]; o.city = it[1]; o.street = it[2] + ' ' + R.int(1, 60);
        o.country = 'Italija'; o.vat = 'IT' + R.digits(11); o.regno = '';
        o.phone = '+39 040 555 ' + R.digits(3);
        o.iban = spaced(iban(R, 'IT'));
      }
      return o;
    });

    // duplicate groups: the same customer entered again in another way (18 pairs and 7 triples)
    var groups = [], candidates = R.shuffle(range(N_BASE).filter(function (i) { return list[i].cc === 'SI' && / d\.o\.o\.$| d\.d\.$| s\.p\.$/.test(list[i].name); }));
    candidates.slice(0, 25).forEach(function (bi, gi) {
      var base = list[bi], g = [base], extra = gi < 7 ? 2 : 1;
      for (var k = 0; k < extra; k++) {
        var d = { cc: 'SI', marks: {}, dupOf: base, contact: R.chance(0.5) ? base.contact : R.pick(FIRST) + ' ' + R.pick(LAST), terms: base.terms, limit: R.chance(0.5) ? base.limit : '', regno: R.chance(0.6) ? base.regno : '' };
        if (d.limit && d.limit.indexOf('.') > 0) d.marks['num.format'] = 1;
        var nv = (gi * 2 + k) % 5, parts = base.name.split(' '), legal = parts.pop();
        d.name = nv === 0 ? base.name.toUpperCase().replace(/ (D\.O\.O\.|D\.D\.|S\.P\.)$/, ', $1')
          : nv === 1 ? parts[0] + (parts.length > 1 ? ' ' + parts.slice(1).join(' ').toLowerCase() : '') + ' ' + legal.replace(/\./g, '')
          : nv === 2 ? base.name.replace(/ d\.o\.o\.$/, ' d. o. o.') : nv === 3 ? typo(base.name) : parts.join(' ');
        if (nv === 0) d.marks['text.caps'] = 1;
        d.street = R.chance(0.5) ? base.street.replace(/ cesta /, ' c. ').replace(/ ulica /, ' ul. ') : base.street;
        d.postal = base.postal; d.city = base.city; d.country = R.pick(['Slovenija', 'SI', 'SLO']);
        var vv = R();
        d.vat = vv < 0.45 ? 'SI' + base.vatDigits : vv < 0.7 ? 'SI ' + base.vatDigits : ''; d.vatDigits = base.vatDigits;
        if (!d.vat) d.marks['rec.missing:vat'] = 1;
        d.phone = R.chance(0.7) ? E.phoneCheck(base.phone, 'SI').e164 : '';
        if (!d.phone) d.marks['rec.missing:phone'] = 1;
        d.email = R.chance(0.6) ? base.email : '';
        if (!d.email) d.marks['rec.missing:email'] = 1;
        d.iban = R.chance(0.5) ? base.iban : '';
        d.ibanNorm = base.ibanNorm;
        if (d.iban && base.marks['iban.local']) d.marks['iban.local'] = 1;
        g.push(d); list.push(d);
      }
      groups.push(g);
    });
    var inGroup = new Set(); groups.forEach(function (g) { g.forEach(function (o) { inGroup.add(o); }); });

    // planted problems, on rows outside the duplicate groups (so the groups stay what they are)
    var free = R.shuffle(list.filter(function (o) { return !inGroup.has(o); }));
    var at = 0;
    function take(n, filter) { var out = []; for (var i = 0; i < free.length && out.length < n; i++) { var o = free[(at + i) % free.length]; if (!o.used && (!filter || filter(o))) { o.used = true; out.push(o); } } at += n; return out; }
    var si = function (o) { return o.cc === 'SI'; };
    take(17, si).forEach(function (o) { o.vat = wrongLast(R, o.vat); o.marks['vat.checksum'] = 1; });
    take(38, si).forEach(function (o) { o.vat = ''; o.marks['rec.missing:vat'] = 1; });
    take(1, si).forEach(function (o) { var oi = oib(R); o.vat = 'HR' + oi; o.marks['vat.country'] = 1; });
    take(9, function (o) { return o.cc === 'SI' && !o.marks['iban.local']; }).forEach(function (o) { var s = o.ibanNorm, k = R.int(5, 17), d = (+s[k] + R.int(1, 9)) % 10; o.iban = spaced(s.slice(0, k) + d + s.slice(k + 1)); o.marks['iban.checksum'] = 1; });
    take(4, function (o) { return o.cc === 'SI' && !o.marks['iban.local']; }).forEach(function (o) { o.iban = spaced(o.ibanNorm.slice(0, -1)); o.marks['iban.format'] = 1; });
    var badMail = [function (e) { return e.replace('@', '.'); }, function (e) { return e.replace('@', '@@'); }, function (e) { return e.replace('@example.com', '@example'); }, function (e) { return e.replace('example.com', 'example,com'); }];
    take(25).forEach(function (o, i) { o.email = badMail[i % 4](o.email); o.marks['email.invalid'] = 1; });
    take(8).forEach(function (o, i) { o.email = o.email.replace('example.com', i % 2 ? 'example.cmo' : 'example.con'); o.marks['email.typo'] = 1; });
    take(5).forEach(function (o) { o.email = o.email.replace('@', ' @'); o.marks['email.clean'] = 1; });
    take(4).forEach(function (o) { o.email = o.email + '; ' + o.email.replace(/^[^.]+/, 'direktor'); o.marks['email.multi'] = 1; });
    take(13, function (o) { return si(o) && E.POST_MAIN.SI[o.postal]; }).forEach(function (o) {
      var other = E.POST_MAIN.SI[R.pick(SI_MAIN.filter(function (m) { return m[0] !== o.postal; }))[0]];
      o.city = other.name; o.marks['postal.city'] = 1;
    });
    take(6, si).forEach(function (o, i) { o.phone = ['041 55', '01 555 12', 'glej opombo', '0415551234567', '555 1234', '+386 41 555'][i]; o.marks['phone.invalid'] = 1; });
    take(3, si).forEach(function (o) { o.phone = o.phone + ' / 041 555 ' + R.digits(3); o.marks['phone.multi'] = 1; });
    take(21, function (o) { return /[čšžćđČŠŽĆĐ]/.test(o.name + o.street + o.city); }).forEach(function (o) {
      var f = /[čšžćđČŠŽĆĐ]/.test(o.name) ? 'name' : /[čšžćđČŠŽĆĐ]/.test(o.street) ? 'street' : 'city';
      o[f] = E.toMojibake(o[f]); o.marks['text.mojibake'] = 1; o.mojiField = f;
    });
    take(30, function (o) { return / d\.o\.o\.$/.test(o.name); }).forEach(function (o) { o.name = o.name.toUpperCase(); o.marks['text.caps'] = 1; });
    take(8).forEach(function (o) { o.country = ''; o.marks['req.missing:country'] = 1; });
    take(6).forEach(function (o, i) { o.contact = ['-', '/', 'n/a', '?', 'x', '--'][i]; o.marks['text.placeholder'] = 1; });
    take(40).forEach(function (o, i) { if (i % 2) o.name = o.name + ' '; else o.street = o.street + '  '; o.marks['ws.trim'] = 1; });
    take(6, function (o) { return o.name.indexOf(' ') > 0 && !o.marks['text.mojibake']; }).forEach(function (o) { o.name = o.name.replace(' ', '  '); o.marks['ws.double'] = 1; });
    take(3, function (o) { return !o.marks['text.mojibake']; }).forEach(function (o) { o.name = o.name.replace(' ', '\u00A0'); o.marks['ws.nbsp'] = 1; });
    take(2, function (o) { return si(o) && !o.marks['text.mojibake']; }).forEach(function (o) { o.street = o.street + '\n' + o.postal + ' ' + o.city; o.marks['ws.newline'] = 1; });

    // order like an ERP: by code, codes given in the order customers were entered; then two codes typed twice
    R.shuffle(list);
    var span = 15 * 365, dates = list.map(function () { return E.addDays(today, -R.int(30, span)); }).sort();
    var code = 10000;
    list.forEach(function (o, i) { code += R.int(1, 9); o.code = 'K' + code; o.created = dates[i]; });
    groups.forEach(function (g) { g.slice(1).forEach(function (d) { if (d.created < g[0].created) { var t = d.created; d.created = g[0].created; g[0].created = t; } }); });
    var freeList = list.filter(function (o) { return !inGroup.has(o); });
    for (var k = 0; k < 2; k++) { var a = freeList[40 + k * 150], b = freeList[41 + k * 150]; b.code = a.code; a.marks['id.dup'] = 1; b.marks['id.dup'] = 1; }
    list.sort(function (x, y) { return x.code < y.code ? -1 : x.code > y.code ? 1 : 0; });
    [17, 130, 260].forEach(function (i, k) { var o = list[i]; if (inGroup.has(o)) o = list[i + 1]; o.created = E.addDays(today, [3, 45, 170][k]); o.marks['date.future'] = 1; });
    var odd = list.filter(function (o, i) { return i % 41 === 7; });
    odd.forEach(function (o, i) { o.dateText = i % 3 === 0 ? o.created : i % 3 === 1 ? String(Math.round((Date.UTC(+o.created.slice(0, 4), +o.created.slice(5, 7) - 1, +o.created.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 86400000)) : null; if (o.dateText) o.marks['date.mixed'] = 1; });

    var rows = list.map(function (o) {
      return [o.code, o.name, o.street, o.postal, o.city, o.country, o.vat, o.regno, o.phone, o.email, o.iban, o.contact, o.terms, o.limit, o.dateText || sl(o.created)];
    });
    var preamble = ['IZPIS PARTNERJEV - KUPCI', 'Datum izpisa: ' + +today.slice(8, 10) + '.' + +today.slice(5, 7) + '.' + today.slice(0, 4), ''].map(function (l) { return l + new Array(CUST_H.length).join(';'); }).join('\r\n') + '\r\n';
    var text = preamble + E.toCsv(CUST_H, rows, ';', false);
    var plan = planOf(list);
    plan.groups = groups.map(function (g) { return g.map(function (o) { return list.indexOf(o); }).sort(function (x, y) { return x - y; }); }).sort(function (x, y) { return x[0] - y[0]; });
    return { text: text, bytes: new TextEncoder().encode(text), encoding: 'utf-8', rows: rows.length, plan: plan };
  }
  function planOf(list) {
    var plan = {};
    list.forEach(function (o, i) { Object.keys(o.marks).forEach(function (k) { (plan[k] = plan[k] || []).push(i); }); });
    return plan;
  }

  // ════════════════════════════════════════════════════════════════════════
  // Product price list
  // ════════════════════════════════════════════════════════════════════════
  var PROD_H = ['Šifra', 'Naziv', 'EAN', 'EM', 'Cena brez DDV', 'DDV %', 'Dobavitelj', 'Skupina'];
  var SUPP = { nordtherm: ['Nordtherm Heiztechnik GmbH', '40'], vrhnje: ['Radiatorji Vrhnje d.o.o.', '383'], aquaflux: ['Aquaflux Pumps a.s.', '859'],
    balkan: ['Termostat Balkan d.o.o.', '385'], valvex: ['Valvex Componenti S.r.l.', '80'], polytube: ['Polytube Industries Kft.', '599'], inox: ['Inox Profil d.o.o.', '383'],
    kabel: ['Kabelwerk Ostalpen GmbH', '90'], panon: ['Elektro Grosist Panon d.o.o.', '383'], lux: ['Svetila Lux d.o.o.', '383'], klimaflow: ['Klimaflow Systems B.V.', '87'],
    gric: ['Montažni Material Grič d.o.o.', '383'], rob: ['Varilna Tehnika Rob d.o.o.', '383'] };
  // group, code prefix, [name template, options, unit, price range, suppliers]
  var CATALOG = [
    ['Ogrevanje', 'OG', [
      ['Radiator ploščni 22/600/{a}', [400, 500, 600, 700, 800, 900, 1000, 1200, 1400, 1600, 1800, 2000], 'kos', [62, 265], ['vrhnje', 'nordtherm']],
      ['Radiator ploščni 33/500/{a}', [600, 800, 1000, 1200, 1400, 1600], 'kos', [95, 310], ['vrhnje']],
      ['Termostatska glava M30x1,5 {a}', ['bela', 'krom', 'antracit'], 'kos', [12, 38], ['balkan', 'nordtherm']],
      ['Radiatorski ventil {a} 1/2"', ['ravni', 'kotni', 'troosni'], 'kos', [9, 26], ['valvex', 'balkan']],
      ['Toplotna črpalka zrak-voda {a} kW', [6, 8, 10, 12, 16], 'kos', [3800, 9200], ['nordtherm']],
      ['Ekspanzijska posoda {a} l', [8, 12, 18, 25, 35, 50, 80], 'kos', [24, 140], ['aquaflux']],
      ['Obtočna črpalka 25-{a} 180', [40, 60, 80], 'kos', [140, 330], ['aquaflux']],
      ['Plinski kondenzacijski kotel {a} kW', [20, 24, 28, 35], 'kos', [1400, 2650], ['nordtherm']],
      ['Cev PE-RT za talno ogrevanje 16x2 ({a} m)', [200, 240, 600], 'kos', [90, 310], ['polytube']],
      ['Razdelilnik talnega ogrevanja {a}-krožni', [4, 6, 8, 10, 12], 'kos', [180, 520], ['valvex', 'balkan']],
      ['Zalogovnik tople vode {a} l', [200, 300, 500], 'kos', [620, 1450], ['nordtherm', 'vrhnje']],
      ['Priročnik za montažo toplotnih črpalk (knjiga)', [''], 'kos', [29, 29], ['gric']],
      ['Sobni termostat {a}', ['digitalni', 'brezžični', 'programabilni', 'mehanski'], 'kos', [18, 140], ['balkan', 'nordtherm']],
      ['Dimniška cev fi {a} mm', [80, 100, 130], 'kos', [14, 55], ['vrhnje']],
      ['Varnostni ventil {a} bar', ['2,5', '3', '6'], 'kos', [8, 26], ['valvex']],
      ['Mešalni ventil {a}', ['3-potni 1"', '3-potni 5/4"', '4-potni 1"'], 'kos', [45, 120], ['valvex', 'balkan']],
      ['Solarni kolektor {a} m2', ['2,0', '2,5'], 'kos', [420, 780], ['nordtherm']]
    ]],
    ['Vodovod', 'VO', [
      ['PEX cev {a}', ['16x2 (100 m)', '16x2 (200 m)', '20x2 (100 m)', '26x3 (50 m)'], 'kos', [58, 265], ['polytube']],
      ['Krogelni ventil {a}', ['1/2" MŽ', '3/4" MŽ', '1" MŽ', '1/2" ŽŽ', '3/4" ŽŽ', '5/4" ŽŽ'], 'kos', [6, 32], ['valvex']],
      ['Press fiting koleno {a} mm', [16, 20, 26, 32], 'kos', [3, 14], ['valvex', 'inox']],
      ['Press fiting T-kos {a} mm', [16, 20, 26, 32], 'kos', [4, 18], ['valvex', 'inox']],
      ['Enoročna pipa za umivalnik {a}', ['krom', 'mat črna', 'krtačeno jeklo'], 'kos', [45, 165], ['valvex']],
      ['Sifon za umivalnik 5/4"{a}', ['', ' s čepom'], 'kos', [8, 26], ['gric']],
      ['Električni grelnik vode {a} l', [50, 80, 100, 120], 'kos', [180, 430], ['vrhnje']],
      ['Vodomer {a}', ['1/2"', '3/4"'], 'kos', [22, 48], ['valvex']],
      ['Reducirni ventil {a}', ['1/2"', '3/4"', '1"'], 'kos', [38, 95], ['valvex']],
      ['Kanalizacijska cev PVC {a}', ['50 mm (1 m)', '75 mm (1 m)', '110 mm (1 m)', '110 mm (2 m)', '125 mm (2 m)'], 'kos', [3, 26], ['polytube']],
      ['Teflonski trak 12 mm x 12 m', [''], 'kos', [1.2, 3.2], ['gric']],
      ['Tesnilna pasta {a} g', [250, 500], 'kos', [5, 13], ['gric']],
      ['Zaporni ventil {a}', ['1/2"', '3/4"', '1"', '5/4"'], 'kos', [7, 30], ['valvex']],
      ['Fleksibilna cev za pipo {a}', ['30 cm', '40 cm', '50 cm'], 'kos', [3, 8], ['inox']],
      ['Kotni ventil {a}', ['1/2"-3/8"', '1/2"-1/2"'], 'kos', [5, 14], ['valvex']],
      ['Vodni filter {a}', ['1/2"', '3/4"', '1"'], 'kos', [28, 85], ['valvex']],
      ['Potopna črpalka za odpadno vodo {a} W', [400, 750], 'kos', [95, 240], ['aquaflux']]
    ]],
    ['Elektro', 'EL', [
      ['Kabel NYM-J {a}', ['3x1,5 (100 m)', '3x2,5 (100 m)', '5x1,5 (100 m)', '5x2,5 (50 m)', '5x2,5 (100 m)'], 'kos', [48, 265], ['kabel', 'panon']],
      ['Kabel NYY-J {a} na meter', ['3x1,5', '3x2,5', '5x2,5', '5x6'], 'm', [0.8, 4.6], ['kabel']],
      ['Stikalo navadno podometno {a}', ['bela', 'antracit', 'srebrna'], 'kos', [3, 12], ['panon']],
      ['Vtičnica šuko podometna {a}', ['bela', 'antracit', 'srebrna'], 'kos', [3, 13], ['panon']],
      ['Inštalacijski odklopnik B{a} 1P', [6, 10, 13, 16, 20, 25], 'kos', [3, 9], ['panon', 'kabel']],
      ['Zaščitno stikalo FID 40A/30mA {a}P', [2, 4], 'kos', [25, 72], ['panon']],
      ['LED panel 60x60 {a} W', [36, 40, 48], 'kos', [25, 72], ['lux']],
      ['LED reflektor {a} W', [10, 20, 30, 50], 'kos', [12, 58], ['lux']],
      ['Podometna doza fi {a}', [60, 68], 'kos', [0.3, 1.2], ['panon']],
      ['Razdelilna omarica {a} modulov', [12, 24, 36, 48], 'kos', [25, 145], ['panon']],
      ['Rebrasta instalacijska cev fi {a}', ['16 (50 m)', '20 (50 m)', '25 (50 m)', '16 (100 m)'], 'kos', [12, 46], ['polytube']],
      ['Gumijasti kabel H07RN-F {a} na meter', ['3x1,5', '3x2,5', '5x2,5'], 'm', [1.1, 5.2], ['kabel']],
      ['Kabelska uvodnica M{a}', [16, 20, 25, 32], 'kos', [0.4, 1.8], ['panon']],
      ['Senzor gibanja {a}', ['nadometni', 'stropni'], 'kos', [14, 46], ['lux']],
      ['Podaljšek {a}', ['3-vtični 1,5 m', '3-vtični 3 m', '5-vtični 5 m'], 'kos', [6, 19], ['panon']],
      ['Vrstna sponka {a} mm2', ['2,5', '4', '6', '10'], 'kos', [0.6, 2.4], ['panon']]
    ]],
    ['Prezračevanje', 'PR', [
      ['Stenski rekuperator {a} m3/h', [30, 45, 60], 'kos', [380, 760], ['klimaflow']],
      ['Centralna prezračevalna naprava {a} m3/h', [250, 350, 450], 'kos', [2200, 4250], ['klimaflow']],
      ['Kopalniški ventilator fi {a}', ['100', '125', '100 s časovnikom'], 'kos', [18, 72], ['klimaflow']],
      ['Zračni filter {a}', ['G4 za rekuperator', 'F7 za rekuperator', 'G4 komplet 3 kos'], 'kos', [9, 38], ['klimaflow']],
      ['Fleksibilna cev fi {a}', ['100 (3 m)', '125 (3 m)', '160 (10 m)', '125 (10 m)'], 'kos', [8, 46], ['klimaflow']],
      ['Klimatska naprava split {a} kW', ['2,5', '3,5', '5,0', '7,0'], 'kos', [520, 1350], ['klimaflow']],
      ['Prezračevalna rešetka {a}', ['100x100', '150x150', '200x200'], 'kos', [4, 16], ['klimaflow']],
      ['Protipovratna loputa fi {a}', [100, 125, 150], 'kos', [9, 28], ['klimaflow']]
    ]],
    ['Kopalnice', 'KO', [
      ['Tuš kad {a}', ['80x80', '90x90', '100x80', '120x90'], 'kos', [90, 265], ['gric']],
      ['Konzolna WC školjka {a}', ['brez roba', 'klasična', 'kompakt'], 'kos', [140, 330], ['valvex']],
      ['Podometni splakovalnik{a}', ['', ' s tipko'], 'kos', [140, 265], ['valvex']],
      ['Umivalnik {a} cm', [50, 60, 80, 100], 'kos', [60, 185], ['gric']],
      ['Tuš garnitura z drsnikom{a}', ['', ' in polico'], 'kpl', [35, 125], ['valvex']],
      ['Kopalniška omarica {a} cm', [60, 80, 100], 'kos', [120, 340], ['gric']],
      ['Ogledalo z LED osvetlitvijo {a} cm', [60, 80, 100], 'kos', [80, 260], ['gric']],
      ['Odtočni kanal {a} cm', [60, 70, 80, 90], 'kos', [70, 190], ['valvex']],
      ['Kopalniški radiator {a}', ['500x800', '500x1200', '600x1500'], 'kos', [95, 260], ['vrhnje']]
    ]],
    ['Orodje', 'OR', [
      ['Press klešče {a}', ['16-26', 'TH 16-32', 'U 16-32'], 'kos', [180, 640], ['rob']],
      ['Ključ za cevi {a}', ['1"', '1 1/2"', '2"'], 'kos', [18, 62], ['rob']],
      ['Rezalnik za cevi {a} mm', ['3-35', '6-42', '10-63'], 'kos', [16, 58], ['rob']],
      ['Delovne rokavice {a}', ['velikost 9', 'velikost 10', 'zimske'], 'par', [2, 7], ['gric']],
      ['Sanitarni silikon {a} 300 ml', ['bel', 'prozoren', 'siv'], 'kos', [4, 9], ['gric']],
      ['Vijaki za les {a} (200 kos)', ['4x40', '5x50', '6x60'], 'pak', [5, 13], ['gric']],
      ['Varilni aparat {a}', ['MIG 200', 'TIG 180', 'za plastične cevi'], 'kos', [240, 980], ['rob']],
      ['Navojni rezalnik {a}', ['1/2"', '3/4"', '1"'], 'kos', [24, 70], ['rob']],
      ['Akumulatorski vrtalnik {a} V', [12, 18], 'kos', [90, 260], ['rob']],
      ['Merilni trak {a} m', [3, 5, 8], 'kos', [4, 15], ['gric']],
      ['Libela {a} cm', [40, 60, 100], 'kos', [9, 32], ['gric']]
    ]]
  ];

  function products(today) {
    var R = rng(0xDA2600), list = [], seen = {};
    var combos = [];
    CATALOG.forEach(function (cat) { cat[2].forEach(function (tpl) { tpl[1].forEach(function (a) { combos.push({ cat: cat, tpl: tpl, a: a }); }); }); });
    R.shuffle(combos);
    var codeN = {};
    combos.forEach(function (x) {
      if (list.length >= 254) return;
      var name = x.tpl[0].replace('{a}', x.a).replace(/\s+/g, ' ').trim();
      if (seen[name]) return; seen[name] = 1;
      var supKey = R.pick(x.tpl[4]), sup = SUPP[supKey], lo = x.tpl[3][0], hi = x.tpl[3][1];
      var price = Math.round((lo + (hi - lo) * R()) * 100) / 100;
      var us = supKey === 'klimaflow' && R.chance(0.45);
      var pre = us ? '0' + R.digits(2) : sup[1] === '40' ? '40' + R.int(0, 4) : sup[1] === '80' ? '80' + R.int(0, 9) : sup[1] === '90' ? '9' + R.int(0, 1) + R.int(0, 9) : sup[1] === '87' ? '87' + R.int(0, 9) : sup[1];
      codeN[x.cat[1]] = (codeN[x.cat[1]] || 100) + R.int(1, 7);
      list.push({ code: x.cat[1] + '-' + codeN[x.cat[1]], name: name, ean: ean13(R, pre), unit: x.tpl[2], price: price, priceText: price >= 1000 && R.chance(0.3) ? money1000(price) : money(price),
        vat: name.indexOf('(knjiga)') >= 0 ? '5' : '22', supplier: sup[0], group: x.cat[0], marks: {}, us: us });
      if (list[list.length - 1].priceText.indexOf('.') > 0) list[list.length - 1].marks['num.format'] = 1;
    });
    // the same product listed twice (different spelling, same barcode)
    var groups = [];
    var dupBase = R.shuffle(list.filter(function (o) { return /["(]/.test(o.name) || o.name.length > 24; })).slice(0, 6);
    dupBase.forEach(function (b, i) {
      var d = { code: b.code.slice(0, 3) + (900 + i), name: i % 2 ? b.name.toUpperCase().replace(/"/g, '') : b.name.replace(/"/g, ' col').replace(/\s+/g, ' '), ean: b.ean, unit: b.unit, price: b.price, priceText: money(b.price),
        vat: b.vat, supplier: b.supplier, group: b.group, marks: { 'ean.dup': 1 }, dupOf: b };
      if (i % 2) d.marks['text.caps'] = 1;
      b.marks['ean.dup'] = 1;
      list.push(d); groups.push([b, d]);
    });
    var inGroup = new Set(); groups.forEach(function (g) { g.forEach(function (o) { inGroup.add(o); }); });
    var free = R.shuffle(list.filter(function (o) { return !inGroup.has(o); })), at = 0;
    function take(n, f) { var out = []; for (var i = 0; i < free.length && out.length < n; i++) { var o = free[(at + i) % free.length]; if (!o.used && (!f || f(o))) { o.used = true; out.push(o); } } at += n; return out; }
    take(10, function (o) { return !o.us; }).forEach(function (o) { o.ean = wrongLast(R, o.ean); o.marks['ean.checksum'] = 1; });
    take(8, function (o) { return !o.us; }).forEach(function (o) { o.ean = sci(o.ean); o.marks['ean.sci'] = 1; });
    take(5, function (o) { return o.us; }).forEach(function (o) { o.ean = o.ean.slice(1); o.marks['ean.zero'] = 1; });
    take(20).forEach(function (o) { o.ean = ''; o.marks['rec.missing:ean'] = 1; });
    take(6).forEach(function (o) { o.priceText = ''; o.marks['req.missing:price'] = 1; delete o.marks['num.format']; });
    take(2, function (o) { return !o.marks['num.format']; }).forEach(function (o) { o.priceText = '0,00'; o.marks['price.zero'] = 1; });
    take(1, function (o) { return !o.marks['num.format']; }).forEach(function (o) { o.priceText = '-' + money(o.price); o.marks['price.negative'] = 1; });
    take(1, function (o) { return o.price > 20 && o.price < 300 && !o.marks['num.format']; }).forEach(function (o) { o.priceText = money(o.price * 1000); o.marks['price.outlier'] = 1; });
    take(4, function (o) { return !o.marks['num.format'] && o.price < 1000; }).forEach(function (o) { o.priceText = o.price.toFixed(2); o.marks['num.mixed'] = 1; });
    take(2, function (o) { return !o.marks['num.format'] && o.price < 1000; }).forEach(function (o) { o.priceText = '€ ' + money(o.price); o.marks['num.format'] = 1; });
    var variants = ['KOS', 'KOS', 'KOS', 'KOS', 'KOS', 'KOS', 'KOS', 'KOS', 'kom', 'kom', 'kom', 'kom', 'kom', 'pcs', 'pcs', 'pcs', 'Stk', 'Stk', 'Kos', 'Kos'];
    take(variants.length, function (o) { return o.unit === 'kos'; }).forEach(function (o, i) { o.unit = variants[i]; o.marks['unit.variant'] = 1; });
    take(2, function (o) { return o.unit === 'm'; }).forEach(function (o) { o.unit = 'M'; o.marks['unit.variant'] = 1; });
    take(2).forEach(function (o) { o.vat = '20'; o.marks['vatrate.unusual'] = 1; });
    take(1).forEach(function (o) { o.vat = '8,5'; o.marks['vatrate.unusual'] = 1; });
    take(2).forEach(function (o) { o.vat = '0,22'; o.marks['vatrate.fraction'] = 1; });
    take(3).forEach(function (o) { o.vat = '22 %'; o.marks['num.format'] = 1; });
    take(12, function (o) { return !/[a-z]{2}\d/.test(o.name); }).forEach(function (o) { o.name = o.name.toUpperCase(); o.marks['text.caps'] = 1; });
    take(10).forEach(function (o) { o.name = o.name + ' '; o.marks['ws.trim'] = 1; });
    // codes typed twice
    var dups = take(6);
    for (var k = 0; k < 6; k += 2) { dups[k + 1].code = dups[k].code; dups[k].marks['id.dup'] = 1; dups[k + 1].marks['id.dup'] = 1; }
    list.sort(function (x, y) { return x.code < y.code ? -1 : x.code > y.code ? 1 : x.name < y.name ? -1 : 1; });
    var rows = list.map(function (o) { return [o.code, o.name, o.ean, o.unit, o.priceText, o.vat, o.supplier, o.group]; });
    var text = E.toCsv(PROD_H, rows, ';', true);
    var plan = planOf(list);
    plan.groups = groups.map(function (g) { return g.map(function (o) { return list.indexOf(o); }).sort(function (x, y) { return x - y; }); }).sort(function (x, y) { return x[0] - y[0]; });
    return { text: text, bytes: new TextEncoder().encode(text), encoding: 'utf-8', rows: rows.length, plan: plan };
  }

  // ════════════════════════════════════════════════════════════════════════
  // Suppliers in seven countries (Croatian headers, Windows-1250, tabs)
  // ════════════════════════════════════════════════════════════════════════
  var SUP_H = ['Šifra', 'Naziv', 'Adresa', 'Poštanski broj', 'Mjesto', 'Država', 'PDV ID', 'IBAN', 'BIC', 'Telefon', 'E-mail', 'Web', 'Rok plaćanja'];
  var SUP_C = {
    AT: { n: 20, name: 'Austrija', forms: [' GmbH', ' GmbH', ' Handels GmbH', ' AG', ' KG'], banks: ['ALPB', 'DONB', 'KRNB', 'STMB'],
      brands: ['Alpenholz', 'Donauwerk Armaturen', 'Steirische Rohrtechnik', 'Kärntner Armaturen', 'Tiroler Heizsysteme', 'Salzach Elektro', 'Murtal Installationen', 'Wienerwald Haustechnik',
        'Innviertel Kabel', 'Pongauer Metall', 'Ennstal Pumpen', 'Lavanttal Sanitär', 'Mühlviertler Lüftung', 'Gailtal Rohre', 'Drautal Elektrotechnik', 'Waldviertel Wärme',
        'Kaprun Klima', 'Bregenzer Armaturen', 'Ybbstaler Werkzeug', 'Traunsee Thermik', 'Seewinkel Solar'],
      streets: ['Industriestraße', 'Gewerbestraße', 'Bahnhofstraße', 'Hauptstraße', 'Lindenweg', 'Mühlgasse'],
      cities: [['1100', 'Wien'], ['8020', 'Graz'], ['4020', 'Linz'], ['5020', 'Salzburg'], ['9020', 'Klagenfurt'], ['9500', 'Villach'], ['4600', 'Wels'], ['3100', 'St. Pölten'], ['6020', 'Innsbruck']],
      phone: function (R) { return '+43 ' + R.pick(['1 555 ', '316 555 ', '732 555 ', '662 555 ']) + R.digits(4); } },
    DE: { n: 19, name: 'Njemačka', forms: [' GmbH', ' GmbH', ' GmbH & Co. KG', ' AG'], banks: ['ISRB', 'ELBB', 'RHNB', 'WSRB'],
      brands: ['Nordtherm Heiztechnik', 'Elbtal Kabelwerke', 'Schwarzwald Armaturen', 'Isartal Haustechnik', 'Moselland Rohre', 'Spreewald Elektro', 'Harzer Pumpen',
        'Lechtal Sanitär', 'Weserbergland Metall', 'Allgäuer Lüftung', 'Fichtelgebirge Wärme', 'Altmühl Installation', 'Erzgebirge Werkzeug', 'Lausitzer Solar',
        'Odenwald Ventile', 'Rhön Klimatechnik', 'Saaletal Fittings', 'Eifel Gebäudetechnik', 'Chiemgau Heizung', 'Vogtland Leitungen', 'Hunsrück Thermik'],
      streets: ['Industriestraße', 'Gewerbering', 'Am Hafen', 'Hauptstraße', 'Bahnhofstraße', 'Mühlenweg'],
      cities: [['80331', 'München'], ['70173', 'Stuttgart'], ['90402', 'Nürnberg'], ['01067', 'Dresden'], ['04109', 'Leipzig'], ['86150', 'Augsburg'], ['93047', 'Regensburg'], ['28195', 'Bremen']],
      phone: function (R) { return '+49 ' + R.pick(['89 555', '711 555', '911 555', '351 555']) + R.digits(4); } },
    IT: { n: 15, name: 'Italija', forms: [' S.r.l.', ' S.r.l.', ' S.p.A.'], banks: ['ADRB', 'FRLB', 'VENB'],
      brands: ['Valvex Componenti', 'Termoidraulica Friulana', 'Isonzo Impianti', 'Carso Elettrica', 'Adriatica Tubi', 'Dolomiti Clima', 'Veneta Raccordi', 'Lagunare Pompe',
        'Tagliamento Sanitari', 'Euganea Caldaie', 'Garda Ventilazione', 'Natisone Utensili', 'Piave Cavi', 'Brenta Valvole', 'Livenza Solare', 'Collio Termica'],
      streets: ["Via dell'Industria", 'Via Roma', 'Via Trieste', 'Viale Venezia', 'Via San Marco', 'Via Udine'],
      cities: [['34121', 'Trieste'], ['33100', 'Udine'], ['35121', 'Padova'], ['37121', 'Verona'], ['20121', 'Milano'], ['31100', 'Treviso'], ['34170', 'Gorizia']],
      phone: function (R) { return '+39 ' + R.pick(['040 555', '0432 555', '049 555', '02 555']) + R.digits(4); } },
    HU: { n: 12, name: 'Mađarska', forms: [' Kft.', ' Kft.', ' Zrt.'], banks: ['PANB', 'BALB'],
      brands: ['Polytube Industries', 'Dunántúli Szerelvény', 'Balaton Gépészet', 'Rába Kábel', 'Zalai Fűtéstechnika', 'Pannon Csőgyártó', 'Bakony Szivattyú', 'Őrségi Klíma',
        'Mecsek Villamos', 'Kisalföldi Szerszám', 'Tisza Szaniter', 'Hortobágy Napelem', 'Somogyi Hőtechnika'],
      streets: ['Ipari út', 'Fő utca', 'Kossuth Lajos utca', 'Petőfi Sándor utca'],
      cities: [['1051', 'Budapest'], ['9021', 'Győr'], ['9700', 'Szombathely'], ['7621', 'Pécs'], ['8900', 'Zalaegerszeg']],
      phone: function (R) { return '+36 ' + R.pick(['1 555 ', '96 555 ', '94 555 ']) + R.digits(R.chance(0.5) ? 4 : 3); } },
    CZ: { n: 10, name: 'Češka', forms: [' s.r.o.', ' s.r.o.', ' a.s.'], banks: ['MORB', 'VLTB'],
      brands: ['Aquaflux Pumps', 'Moravská Armatura', 'Vltava Kabel', 'Šumava Topení', 'Brněnské Rozvody', 'Krkonoše Instal', 'Beskydy Ventilace', 'Jizera Nářadí',
        'Ostravská Ocel', 'Plzeňské Solární', 'Labe Sanita'],
      streets: ['Průmyslová', 'Hlavní', 'Nádražní', 'Brněnská'],
      cities: [['602 00', 'Brno'], ['110 00', 'Praha'], ['702 00', 'Ostrava'], ['301 00', 'Plzeň']],
      phone: function (R) { return '+420 555 ' + R.digits(3) + ' ' + R.digits(3); } },
    HR: { n: 24, name: 'Hrvatska', forms: [' d.o.o.', ' d.o.o.', ' d.o.o.', ' j.d.o.o.'], banks: ['JADB', 'ZAGB', 'SLAB'],
      brands: ['Termostat Balkan', 'Jadranska Instalacija', 'Zagorje Grijanje', 'Slavonija Cijevi', 'Kvarner Klima', 'Dalmacija Elektro', 'Lika Montaža', 'Podravina Vodovod',
        'Istra Ventili', 'Međimurje Kabeli', 'Posavina Pumpe', 'Kordun Alati', 'Baranja Solar', 'Neretva Sanitarije', 'Gorski Kotar Drvo', 'Žumberak Izolacije',
        'Učka Ventilacija', 'Velebit Oprema', 'Mosor Toplina', 'Biokovo Armature', 'Krka Spojnice', 'Cetina Bojleri', 'Papuk Radijatori', 'Moslavina Električna', 'Banovina Gradnja', 'Turopolje Dizalice'],
      streets: ['Industrijska ulica', 'Ulica grada Vukovara', 'Savska cesta', 'Zagrebačka cesta', 'Obrtnička ulica', 'Ulica Ivana Gundulića'],
      cities: HR_CITIES.map(function (x) { return [x[0], x[1]]; }),
      phone: function (R) { return R.chance(0.5) ? '+385 1 555 ' + R.digits(4) : '01 555 ' + R.digits(4); } },
    SI: { n: 17, name: 'Slovenija', forms: [' d.o.o.', ' d.o.o.', ' d.d.'], banks: ['SAVB', 'DRVB', 'KRAB'],
      brands: ['Radiatorji Vrhnje', 'Svetila Lux', 'Montažni Material Grič', 'Inox Profil', 'Elektro Grosist Panon', 'Varilna Tehnika Rob', 'Pakirni Center Opara',
        'Logistika Hitri Prevoz', 'Toplotna Tehnika Brdo', 'Kabli Sora', 'Sanitarija Krpan', 'Izolacije Mežakla', 'Ventili Kozjak', 'Orodja Snežnik', 'Solarni Sistemi Pohorje',
        'Cevi Ljubljanica', 'Klima Nanos', 'Armature Kum', 'Prezračevanje Boč'],
      streets: SI_STREETS,
      cities: [['1000', 'Ljubljana'], ['2000', 'Maribor'], ['3000', 'Celje'], ['4000', 'Kranj'], ['1230', 'Domžale'], ['8000', 'Novo mesto']],
      phone: function (R) { return R.chance(0.5) ? '+386 1 555 ' + R.digits(2) + ' ' + R.digits(2) : '01 555 ' + R.digits(2) + ' ' + R.digits(2); } }
  };
  function vatFor(R, cc) {
    if (cc === 'AT') return 'ATU' + R.digits(8);
    if (cc === 'DE') return 'DE' + R.int(1, 3) + R.digits(8);
    if (cc === 'IT') return 'IT0' + R.digits(10);
    if (cc === 'HU') return 'HU' + R.int(1, 2) + R.digits(7);
    if (cc === 'CZ') return 'CZ' + R.int(2, 7) + R.digits(7);
    if (cc === 'HR') return 'HR' + oib(R);
    return 'SI' + siTax(R);
  }
  function suppliers(today) {
    var R = rng(0x5E0120), list = [], order = ['AT', 'DE', 'IT', 'HU', 'CZ', 'HR', 'SI'];
    order.forEach(function (cc) {
      var C = SUP_C[cc], names = distinctNames(R, C.brands.map(function (b) { return b + R.pick(C.forms); }), function () { return R.pick(C.brands) + R.pick(C.forms); }, C.n);
      names.forEach(function (nm) {
        var city = R.pick(C.cities), acct = iban(R, cc), bank = R.pick(C.banks);
        list.push({ cc: cc, name: nm, street: R.pick(C.streets) + ' ' + R.int(1, 90), postal: city[0], city: city[1], country: C.name, vat: vatFor(R, cc),
          iban: cc === 'AT' || cc === 'DE' || cc === 'HR' ? spaced(acct) : acct, ibanNorm: acct, bic: bank + cc + R.pick(['W0', 'X0', 'L0']) + (R.chance(0.3) ? 'XXX' : ''),
          phone: C.phone(R), email: R.pick(['office', 'info', 'sales', 'prodaja']) + '.' + slug(nm) + '@example.com', web: R.chance(0.5) ? 'www.' + slug(nm) + '.example' : 'https://' + slug(nm) + '.example',
          terms: String(R.pick([30, 45, 60, 60, 90])), marks: { 'country.code': 1 } });
        if (cc === 'AT' || cc === 'DE' || cc === 'HR') list[list.length - 1].marks['iban.clean'] = 1;
      });
    });
    // three suppliers entered twice
    var groups = [];
    [list[0], list[22], list[95]].forEach(function (b, i) {
      var d = Object.assign({}, b, { marks: { 'country.code': 1 } });
      d.name = i === 0 ? b.name.toUpperCase() : i === 1 ? b.name.replace(' GmbH', ' Gmbh') : b.name.replace(' d.o.o.', ' doo');
      if (i === 0) d.marks['text.caps'] = 1;
      d.phone = i === 2 ? '' : b.phone; d.web = ''; d.vat = i === 1 ? b.vat : b.vat.slice(0, 2) + ' ' + b.vat.slice(2);
      if (i !== 1) d.marks['vat.clean'] = 1;
      if (b.marks['iban.clean']) d.marks['iban.clean'] = 1;
      if (!d.phone) d.marks['rec.missing:phone'] = 1;
      list.push(d); groups.push([b, d]);
    });
    var inGroup = new Set(); groups.forEach(function (g) { g.forEach(function (o) { inGroup.add(o); }); });
    var free = R.shuffle(list.filter(function (o) { return !inGroup.has(o); })), at = 0;
    function take(n, f) { var out = []; for (var i = 0; i < free.length && out.length < n; i++) { var o = free[(at + i) % free.length]; if (!o.used && (!f || f(o))) { o.used = true; out.push(o); } } at += n; return out; }
    var is = function (cc) { return function (o) { return o.cc === cc; }; };
    take(1, is('SI')).forEach(function (o) { o.vat = wrongLast(R, o.vat); o.marks['vat.checksum'] = 1; });
    take(2, is('HR')).forEach(function (o) { o.vat = wrongLast(R, o.vat); o.marks['vat.checksum'] = 1; });
    take(2, is('DE')).forEach(function (o) { o.vat = o.vat.slice(0, -1); o.marks['vat.format'] = 1; });
    take(1, is('AT')).forEach(function (o) { o.vat = o.vat.replace('ATU', 'AT'); o.marks['vat.format'] = 1; });
    take(1, is('IT')).forEach(function (o) { o.vat = o.vat.slice(0, -1); o.marks['vat.format'] = 1; });
    take(1, is('SI')).forEach(function (o) { o.vat = 'HR' + oib(R); o.marks['vat.country'] = 1; });
    take(2, function (o) { return o.cc === 'IT' || o.cc === 'HU' || o.cc === 'CZ'; }).forEach(function (o) { var s = o.ibanNorm, k = R.int(6, s.length - 2), d = (+s[k] + R.int(1, 9)) % 10; o.iban = s.slice(0, k) + d + s.slice(k + 1); o.marks['iban.checksum'] = 1; });
    take(1, is('AT')).forEach(function (o) { o.iban = spaced(o.ibanNorm.slice(0, -1)); o.marks['iban.format'] = 1; delete o.marks['iban.clean']; });
    take(1, function (o) { return o.cc === 'HU' || o.cc === 'CZ'; }).forEach(function (o) { o.bic = 'DONB' + 'AT' + o.bic.slice(6); o.marks['bic.mismatch'] = 1; });
    take(1, is('IT')).forEach(function (o) { o.bic = o.bic.slice(0, 7); o.marks['bic.format'] = 1; });
    take(2, function (o) { return o.city === 'Dresden' || o.city === 'Leipzig'; }).forEach(function (o) { o.postal = o.postal.slice(1); o.marks['postal.zero'] = 1; });
    take(1, function (o) { return o.cc === 'HR' && o.postal === '10000'; }).forEach(function (o) { o.city = 'Split'; o.marks['postal.city'] = 1; });
    take(2).forEach(function (o, i) { o.email = i ? o.email.replace('@', '') : o.email.replace('@example.com', '@example'); o.marks['email.invalid'] = 1; });
    take(1).forEach(function (o) { o.email = o.email.replace('example.com', 'example.con'); o.marks['email.typo'] = 1; });
    take(1, is('SI')).forEach(function (o) { o.phone = '01 555'; o.marks['phone.invalid'] = 1; });
    take(1).forEach(function (o) { o.web = 'www,' + slug(o.name) + ',example'; o.marks['web.invalid'] = 1; });
    take(1).forEach(function (o) { o.web = 'n/a'; o.marks['text.placeholder'] = 1; });
    take(1, function (o) { return !o.marks['postal.zero']; }).forEach(function (o) { o.street = ''; o.marks['req.missing:street'] = 1; });
    R.shuffle(list);
    list.forEach(function (o, i) { o.code = 'D' + (2001 + i * 3); });
    var rows = list.map(function (o) { return [o.code, o.name, o.street, o.postal, o.city, o.country, o.vat, o.iban, o.bic, o.phone, o.email, o.web, o.terms]; });
    var text = E.toCsv(SUP_H, rows, '\t', false);
    var plan = planOf(list);
    plan.groups = groups.map(function (g) { return g.map(function (o) { return list.indexOf(o); }).sort(function (x, y) { return x - y; }); }).sort(function (x, y) { return x[0] - y[0]; });
    return { text: text, bytes: E.encodeCp1250(text), encoding: 'windows-1250', rows: rows.length, plan: plan };
  }

  var DEMOS = [
    { id: 'customers', name: 'kupci_stari_erp.csv', title: 'Customers from an old ERP', sub: '420 rows · Slovene headers · title lines above the header', type: 'customers' },
    { id: 'products', name: 'cenik_artiklov.csv', title: 'Product price list', sub: '260 rows · barcodes, units, prices, VAT rates', type: 'products' },
    { id: 'suppliers', name: 'dobavljaci_eu.txt', title: 'Suppliers in 7 countries', sub: '120 rows · Croatian headers · Windows-1250, tabs', type: 'suppliers' }
  ];
  var GEN = { customers: customers, products: products, suppliers: suppliers };
  /** one demo export: { name, bytes, encoding, text, rows, plan } */
  function file(id, today) {
    var d = DEMOS.filter(function (x) { return x.id === id; })[0];
    if (!d) throw new Error('Unknown demo file ' + id);
    var out = GEN[id](today);
    out.name = d.name; out.id = id; out.type = d.type;
    return out;
  }
  // ════════════════════════════════════════════════════════════════════════
  // The ERP demo's customer list (site/erp): read from this browser, or a bundled sample in the same shape
  // ════════════════════════════════════════════════════════════════════════
  var ERP_H = ['Šifra', 'Naziv', 'Tip', 'Ulica', 'Pošta', 'Kraj', 'Država', 'ID za DDV', 'E-pošta', 'Telefon', 'Plačilni rok'];
  /** ERP customers ({ id, name, type, country, city, address?, email, phone, vatId, terms, walkIn }) → the text of a CSV export.
   * Walk-in customers are left out (as the ERP's own exports do). "Street 1, 1000 City" addresses are split into street and code. */
  function erpCsv(customers) {
    var rows = (customers || []).filter(function (c) { return c && !c.walkIn && c.name; }).map(function (c) {
      var addr = String(c.address || '').trim(), m = /^(.*?),\s*(\d{4,5})\s+(.+)$/.exec(addr), street = m ? m[1] : addr, postal = m ? m[2] : '';
      return ['K' + pad(c.id || 0, 4), c.name, c.type || '', street, postal, c.city || (m ? m[3] : ''), c.country || '', c.vatId || '', c.email || '', c.phone || '', c.terms != null ? String(c.terms) : ''];
    });
    return E.toCsv(ERP_H, rows, ';', false);
  }
  /** a sample in the ERP's shape, for browsers that have not opened the ERP demo: its 22 business customers and 30 named
   * private ones, with full addresses and a few planted problems (two wrong check digits, a postal code that does not exist, a
   * city that does not match its code, a duplicate, a freephone number, missing e-mails). */
  function erpSample() {
    var R = rng(0xE12F05), out = [], id = 0;
    var B2B = [['Optika Nova d.o.o.', 'SI', '1000', 'Ljubljana'], ['Optika Jasni vid d.o.o.', 'SI', '3000', 'Celje'], ['Očesna ambulanta Lipa d.o.o.', 'SI', '4000', 'Kranj'],
      ['Optika Sončnica s.p.', 'SI', '2250', 'Ptuj'], ['Vid Plus d.o.o.', 'SI', '5000', 'Nova Gorica'], ['Optika Modri breg d.o.o.', 'SI', '3320', 'Velenje'],
      ['Delovna medicina Brinje d.o.o.', 'SI', '1000', 'Ljubljana'], ['Optika Kristal d.o.o.', 'SI', '9000', 'Murska Sobota'], ['Optika Iris s.p.', 'SI', '1240', 'Kamnik'],
      ['Športni klub Veter', 'SI', '4260', 'Bled'], ['Optika Vidik d.o.o.', 'HR', '10000', 'Zagreb'], ['Optika Bura j.d.o.o.', 'HR', '52100', 'Pula'],
      ['Očna poliklinika Maslina d.o.o.', 'HR', '22000', 'Šibenik'], ['Optika Lanterna d.o.o.', 'HR', '20000', 'Dubrovnik'], ['Optika Jadranka obrt', 'HR', '47000', 'Karlovac'],
      ['Optika Lavanda d.o.o.', 'HR', '42000', 'Varaždin'], ['Očni centar Gaj d.o.o.', 'HR', '35000', 'Slavonski Brod'], ['Optika Mareta obrt', 'HR', '21300', 'Makarska'],
      ['Optika Smokva j.d.o.o.', 'HR', '21220', 'Trogir'], ['Optika Galeb d.o.o.', 'HR', '52440', 'Poreč'], ['Hotelska grupa Primorje (demo) d.o.o.', 'HR', '51410', 'Opatija'],
      ['Zavod za vid Sora (demo)', 'SI', '4220', 'Škofja Loka']];
    var ST = { SI: ['Slovenska cesta', 'Celovška cesta', 'Glavni trg', 'Partizanska ulica', 'Cankarjeva ulica', 'Prešernova ulica'], HR: ['Ilica', 'Vukovarska ulica', 'Ulica kralja Tomislava', 'Obala', 'Zagrebačka ulica'] };
    B2B.forEach(function (b) {
      var slugN = E.nameTokens(b[0]).slice(0, 2).join('.');
      out.push({ id: ++id, name: b[0], type: 'B2B', country: b[1], city: b[3], address: R.pick(ST[b[1]]) + ' ' + R.int(1, 90) + ', ' + b[2] + ' ' + b[3],
        email: 'info.' + slugN + '@example.com', phone: (b[1] === 'SI' ? '+386 1 555 ' : '+385 1 555 ') + R.digits(4),
        vatId: b[1] + (b[1] === 'SI' ? siTax(R) : oib(R)), terms: R.pick([15, 30, 30, 45, 60]) });
    });
    var FN = ['Ana', 'Maja', 'Nina', 'Eva', 'Sara', 'Petra', 'Jure', 'Luka', 'Matej', 'Rok', 'Ivana', 'Lucija', 'Marko', 'Josip', 'Tea'];
    var LN = ['Zorman', 'Kranjc', 'Lesjak', 'Pirc', 'Rupnik', 'Barić', 'Lovrić', 'Perković', 'Šarić', 'Matić'];
    var PLACES = { SI: [['1000', 'Ljubljana'], ['2000', 'Maribor'], ['6000', 'Koper'], ['8000', 'Novo mesto']], HR: [['10000', 'Zagreb'], ['21000', 'Split'], ['51000', 'Rijeka']] };
    var used = {};
    for (var i = 0; i < 30; i++) {
      var cc = i % 3 === 2 ? 'HR' : 'SI', nm; do { nm = R.pick(FN) + ' ' + R.pick(LN); } while (used[nm]); used[nm] = 1;
      var pl = R.pick(PLACES[cc]);
      out.push({ id: ++id, name: nm, type: 'B2C', country: cc, city: pl[1], address: R.pick(ST[cc]) + ' ' + R.int(1, 120) + ', ' + pl[0] + ' ' + pl[1],
        email: E.fold(nm).replace(/\s+/g, '.') + '@example.com', phone: cc === 'SI' ? '+386 40 555 ' + R.digits(3) : '+385 91 555 ' + R.digits(4), vatId: '', terms: 0 });
    }
    // planted problems
    out[2].vatId = out[2].vatId.slice(0, -1) + ((+out[2].vatId.slice(-1) + 3) % 10);   // wrong SI check digit
    out[12].vatId = out[12].vatId.slice(0, -1) + ((+out[12].vatId.slice(-1) + 4) % 10); // wrong OIB check digit
    out[4].address = out[4].address.replace(/5000 Nova Gorica$/, '5999 Nova Gorica');     // a code that does not exist
    out[7].city = 'Maribor';                                                              // 9000 is Murska Sobota
    out[9].phone = '080 12 34';                                                           // freephone: valid, stays domestic
    out[5].email = ''; out[15].email = 'info@optika-lavanda'; out[27].email = '';
    out[18].name = out[18].name.toUpperCase();
    out.push({ id: ++id, name: 'Optika Nova d.o.o', type: 'B2B', country: 'SI', city: 'Ljubljana', address: out[0].address, email: out[0].email, phone: '', vatId: out[0].vatId, terms: 30 });
    out.push({ id: ++id, name: 'Walk-in customer (SI)', type: 'B2C', country: 'SI', city: '', email: '', phone: '', vatId: '', terms: 0, walkIn: true });
    return out;
  }

  return { VERSION: VERSION, DEMOS: DEMOS, file: file, rng: rng, erpCsv: erpCsv, erpSample: erpSample, ERP_H: ERP_H };
});
