/* Collections demo data (Business Apps). Every company, person, address, phone number, invoice and amount is fictional.
 * generate(today) builds the receivables of Nordvik Distribucija d.o.o. (the Cash forecast company: wholesale of
 * heating, plumbing and electrical supplies, about €1.08M of sales a month) for 56 customers in Slovenia and
 * Croatia: about 14 months of invoices, payments drawn from each customer's lateness profile (some partial), a
 * year of reminder letters and calls replayed through the engine's own rules, promises (most kept, some broken),
 * disputes, a write-off and a payment plan. Struna Gradnje d.o.o. is the customer whose lateness keeps getting
 * worse. Everything is relative to `today`, and the same `today` always gives the same data (seeded random
 * numbers). UMD, so it also loads in Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.CollData = factory(root.CollEngine);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';
  var VERSION = 1;

  function rng(seed) {
    var a = seed >>> 0;
    var f = function () { a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    f.between = function (lo, hi) { return lo + (hi - lo) * f(); };
    f.int = function (lo, hi) { return Math.floor(lo + (hi - lo + 1) * f()); };
    f.norm = function () { var u = 0, v = 0; while (u === 0) u = f(); while (v === 0) v = f(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    f.pick = function (list) { return list[Math.floor(f() * list.length)]; };
    return f;
  }
  var r2 = E.round2;

  var COMPANY = {
    name: 'Nordvik Distribucija d.o.o.', short: 'Nordvik', what: 'Wholesale of heating, plumbing and electrical supplies',
    street: 'Tovarniška cesta 14', postal: '1000', city: 'Ljubljana', country: 'SI', vatId: 'SI12345679',
    iban: 'SI56990000123456721', bic: '', phone: '+386 1 000 48 10', email: 'finance.nordvik@example.com', web: '', purposeCode: 'GDSV'
  };
  var SENDER = { name: 'Maja Kranjc', title: { sl: 'Vodja terjatev', hr: 'Voditeljica potraživanja', en: 'Credit controller' }, phone: '+386 1 000 48 17', email: 'maja.kranjc@example.com' };
  var COLLEAGUE = 'Tine Zorman';
  var MONTHLY_SALES = 1080000;

  // postal code, town, phone area code
  var CITY = {
    LJ: ['1000', 'Ljubljana', '1'], MB: ['2000', 'Maribor', '2'], CE: ['3000', 'Celje', '3'], KR: ['4000', 'Kranj', '4'], NG: ['5000', 'Nova Gorica', '5'],
    KP: ['6000', 'Koper', '5'], NM: ['8000', 'Novo mesto', '7'], MS: ['9000', 'Murska Sobota', '2'], ZA: ['3310', 'Žalec', '3'], AJ: ['5270', 'Ajdovščina', '5'],
    PT: ['2250', 'Ptuj', '2'], DO: ['1230', 'Domžale', '1'], VE: ['3320', 'Velenje', '3'], IZ: ['6310', 'Izola', '5'], SKL: ['4220', 'Škofja Loka', '4'],
    BR: ['8250', 'Brežice', '7'], SB: ['2310', 'Slovenska Bistrica', '2'], KK: ['8270', 'Krško', '7'], ZI: ['4274', 'Žirovnica', '4'], KG: ['4280', 'Kranjska Gora', '4'],
    SJ: ['3240', 'Šmarje pri Jelšah', '3'], RA: ['4240', 'Radovljica', '4'], KA: ['1241', 'Kamnik', '1'], TR: ['1420', 'Trbovlje', '3'], GR: ['1290', 'Grosuplje', '1'],
    SG: ['2380', 'Slovenj Gradec', '2'], TO: ['5220', 'Tolmin', '5'], LI: ['1270', 'Litija', '1'],
    ZG: ['10000', 'Zagreb', '1'], ST: ['21000', 'Split', '21'], RI: ['51000', 'Rijeka', '51'], OS: ['31000', 'Osijek', '31'], VZ: ['42000', 'Varaždin', '42']
  };
  // The first 26 are the Cash forecast customers (name, segment, terms, average days late, spread, share of sales).
  // Then: country, town, street, lateness trend (days a year, + = getting later), share of invoices paid in two parts.
  var CUSTOMERS = [
    ['Termoplan Savinja d.o.o.', 'Installer', 45, 6, 4, 6.5, 'SI', 'ZA', 'Mariborska cesta 41', 0, 0.06],
    ['Vzorec Energija d.o.o.', 'Installer', 45, 18, 7, 5.8, 'SI', 'LJ', 'Leskoškova cesta 9', 0, 0.08],
    ['Lumen Gradnje d.o.o.', 'Contractor', 60, 24, 10, 7.2, 'SI', 'MB', 'Tržaška cesta 63', 12, 0.1],
    ['Vetrnica Instalacije d.o.o.', 'Installer', 30, 3, 3, 3.1, 'SI', 'AJ', 'Goriška cesta 25', 0, 0.03],
    ['Polarka Klima d.o.o.', 'Installer', 45, 11, 5, 4.4, 'SI', 'KP', 'Ankaranska cesta 7', 0, 0.06],
    ['Gradbeni Sistemi Vrh d.d.', 'Contractor', 60, 31, 12, 8.6, 'SI', 'LJ', 'Šmartinska cesta 130', 4, 0.12],
    ['Struna Gradnje d.o.o.', 'Contractor', 60, 44, 18, 3.2, 'SI', 'KR', 'Savska loka 21', 40, 0.3],
    ['Hiša Mojstrov d.o.o.', 'Retail chain', 45, 2, 2, 9.4, 'SI', 'LJ', 'Letališka cesta 16', 0, 0.02],
    ['Domotehna Center d.o.o.', 'Retail chain', 45, 9, 4, 7.9, 'SI', 'CE', 'Mariborska cesta 128', 0, 0.04],
    ['Občina Zelena Dolina', 'Public sector', 30, 0, 1, 2.6, 'SI', 'SJ', 'Trg Zelene doline 1', 0, 0],
    ['Dom upokojencev Breza', 'Public sector', 30, 1, 1, 1.4, 'SI', 'PT', 'Brezova ulica 12', 0, 0],
    ['Zavod Šolski Center Lipa', 'Public sector', 30, 0, 1, 2.2, 'SI', 'DO', 'Šolska ulica 5', 0, 0],
    ['Elektro Kres s.p.', 'Installer', 30, 7, 5, 1.6, 'SI', 'NM', 'Ljubljanska cesta 27', 0, 0.05],
    ['Toplotne Črpalke Sever d.o.o.', 'Installer', 45, 4, 3, 3.6, 'SI', 'MS', 'Lendavska ulica 33', 0, 0.03],
    ['Vodovod Mreža d.o.o.', 'Contractor', 60, 15, 8, 4.9, 'SI', 'NG', 'Industrijska cesta 9', 0, 0.08],
    ['Strojna Montaža Gaber d.o.o.', 'Installer', 30, 12, 6, 2.3, 'SI', 'VE', 'Koroška cesta 58', 0, 0.06],
    ['Klimatika Jadran d.o.o.', 'Installer', 45, 21, 9, 3.4, 'SI', 'IZ', 'Cankarjev drevored 14', 10, 0.15],
    ['Instal Plus Kranjc s.p.', 'Installer', 30, 5, 4, 1.2, 'SI', 'SKL', 'Kidričeva cesta 61', 0, 0.03],
    ['Sončna Streha d.o.o.', 'Installer', 45, 8, 5, 2.9, 'SI', 'BR', 'Cesta bratov Milavcev 40', 0, 0.05],
    ['Megagrad Holding d.d.', 'Contractor', 60, 27, 11, 6.3, 'SI', 'LJ', 'Dunajska cesta 160', -10, 0.1],
    ['Ogrevanje Bistrica d.o.o.', 'Installer', 30, 2, 2, 1.8, 'SI', 'SB', 'Partizanska ulica 22', 0, 0.02],
    ['Tehno Dom Mesec d.o.o.', 'Retail chain', 45, 6, 3, 3.9, 'SI', 'KK', 'Cesta krških žrtev 132', 0, 0.03],
    ['Zdravstveni Dom Vrba', 'Public sector', 30, 0, 1, 1.1, 'SI', 'ZI', 'Zdravstvena pot 3', 0, 0],
    ['Hotel Planika d.d.', 'End customer', 30, 14, 7, 1.5, 'SI', 'KG', 'Borovška cesta 76', 0, 0.05],
    ['Ventus Prezračevanje d.o.o.', 'Installer', 45, 10, 5, 2.4, 'SI', 'LJ', 'Cesta v Mestni log 55', 0, 0.05],
    ['Kopalnice Arkada d.o.o.', 'Retail chain', 45, 13, 6, 2.0, 'SI', 'MB', 'Zagrebška cesta 84', 0, 0.04],
    // more Slovenian customers
    ['Inštalacije Golob d.o.o.', 'Installer', 30, 9, 5, 1.6, 'SI', 'CE', 'Ljubljanska cesta 77', 0, 0.05],
    ['Toplota Pomurje d.o.o.', 'Installer', 45, 7, 4, 1.4, 'SI', 'MS', 'Noršinska ulica 12', 0, 0.04],
    ['Gradnje Krpan d.o.o.', 'Contractor', 60, 19, 8, 2.8, 'SI', 'NM', 'Podbevškova ulica 18', 6, 0.1],
    ['Elektroinštalacije Zupan s.p.', 'Installer', 30, 4, 3, 0.8, 'SI', 'KR', 'Delavska cesta 26', 0, 0.02],
    ['Vodomont Primorska d.o.o.', 'Installer', 45, 12, 6, 1.9, 'SI', 'KP', 'Šmarska cesta 5', 0, 0.06],
    ['Kovinar Lipnica d.o.o.', 'Contractor', 60, 22, 9, 1.7, 'SI', 'RA', 'Gorenjska cesta 19', 0, 0.1],
    ['Mojster Dom Trgovina d.o.o.', 'Retail chain', 45, 5, 3, 4.6, 'SI', 'MB', 'Puhova ulica 15', 0, 0.02],
    ['Občina Brezova Gora', 'Public sector', 30, 1, 1, 1.0, 'SI', 'LI', 'Trg svobode 3', 0, 0],
    ['Javni zavod Športni park Mlin', 'Public sector', 30, 2, 1, 0.9, 'SI', 'DO', 'Kopališka cesta 4', 0, 0],
    ['Dom za starejše Topli Dom', 'Public sector', 30, 1, 1, 1.0, 'SI', 'VE', 'Kidričeva cesta 19', 0, 0],
    ['Termika Velenje d.o.o.', 'Installer', 45, 6, 3, 1.6, 'SI', 'VE', 'Stari trg 31', 0, 0.03],
    ['Hidro Servis Ptuj d.o.o.', 'Installer', 30, 10, 5, 1.2, 'SI', 'PT', 'Ormoška cesta 48', 0, 0.05],
    ['Prenova Plus d.o.o.', 'Contractor', 60, 17, 7, 2.2, 'SI', 'DO', 'Ljubljanska cesta 101', 0, 0.08],
    ['Gradbeništvo Kos d.o.o.', 'Contractor', 60, 26, 11, 1.9, 'SI', 'KA', 'Šutna 42', 5, 0.12],
    ['Klima Center Gorenjska d.o.o.', 'Installer', 45, 8, 4, 1.3, 'SI', 'RA', 'Kranjska cesta 4', 0, 0.04],
    ['Ekoterm Sistemi d.o.o.', 'Installer', 45, 3, 2, 1.5, 'SI', 'SKL', 'Kidričeva cesta 89', 0, 0.02],
    ['Kamp Soča Dolina d.o.o.', 'End customer', 30, 9, 6, 0.6, 'SI', 'TO', 'Brunov drevored 11', 0, 0.03],
    ['Upravnik Domus d.o.o.', 'End customer', 30, 11, 6, 1.1, 'SI', 'LJ', 'Vojkova cesta 63', 0, 0.05],
    ['Montaže Lesjak s.p.', 'Installer', 30, 35, 15, 0.7, 'SI', 'TR', 'Trg revolucije 27', 0, 0.2],
    ['Zidarstvo in fasade Novak s.p.', 'Contractor', 45, 14, 7, 0.9, 'SI', 'GR', 'Adamičeva cesta 36', 0, 0.06],
    ['Korotherm d.o.o.', 'Installer', 45, 8, 4, 1.2, 'SI', 'SG', 'Meškova ulica 21', 0, 0.03],
    ['Rastlinjaki Ločnik d.o.o.', 'End customer', 30, 6, 4, 0.8, 'SI', 'BR', 'Cesta prvih borcev 50', 0, 0.03],
    // Croatian customers
    ['Termo Sustavi Zagreb d.o.o.', 'Installer', 45, 12, 6, 2.4, 'HR', 'ZG', 'Radnička cesta 52', 0, 0.05],
    ['Grijanje i Klima Sava d.o.o.', 'Installer', 45, 9, 5, 1.8, 'HR', 'ZG', 'Savska cesta 141', 0, 0.04],
    ['Kvarner Instalacije d.o.o.', 'Installer', 45, 16, 7, 1.6, 'HR', 'RI', 'Ulica Milutina Barača 26', 0, 0.06],
    ['Slavonija Gradnja d.d.', 'Contractor', 60, 28, 10, 3.0, 'HR', 'OS', 'Vukovarska cesta 219', 15, 0.12],
    ['Varaždinski Elektro Centar d.o.o.', 'Retail chain', 45, 7, 4, 2.2, 'HR', 'VZ', 'Optujska ulica 72', 0, 0.03],
    ['Marjan Vodoinstalacije j.d.o.o.', 'Installer', 30, 10, 5, 0.8, 'HR', 'ST', 'Put Supavla 21', 0, 0.05],
    ['Adriatic Coast Hotels d.o.o.', 'End customer', 30, 13, 6, 1.4, 'HR', 'ST', 'Poljička cesta 39', 0, 0.04],
    ['Panonija Toplinarstvo d.o.o.', 'Contractor', 60, 20, 8, 1.5, 'HR', 'OS', 'Ulica Svetog Roka 44', 0, 0.08]
  ];
  var IDX = {};
  CUSTOMERS.forEach(function (c, i) { IDX[c[0]] = i; });
  var FIRST_SI = ['Mateja', 'Andrej', 'Petra', 'Boštjan', 'Nina', 'Gregor', 'Tanja', 'Rok', 'Katja', 'Matej', 'Barbara', 'Jure', 'Urška', 'Aleš', 'Simona', 'Marko', 'Tina', 'Primož', 'Sabina', 'Luka', 'Mojca', 'Blaž', 'Alenka', 'Dejan', 'Vesna', 'Robert', 'Polona', 'Uroš', 'Irena', 'Klemen', 'Darja', 'Žiga', 'Metka', 'Tomaž', 'Špela', 'Igor'];
  var LAST_SI = ['Kos', 'Zupančič', 'Novak', 'Horvat', 'Potočnik', 'Mlakar', 'Vidmar', 'Kovač', 'Golob', 'Turk', 'Kralj', 'Zajc', 'Bizjak', 'Hribar', 'Kastelic', 'Oblak', 'Erjavec', 'Rozman', 'Žagar', 'Pirc', 'Koren', 'Jereb', 'Kolar', 'Bezjak', 'Medved', 'Majcen', 'Leban', 'Furlan', 'Vovk', 'Petek', 'Kavčič', 'Debeljak', 'Hočevar', 'Kokalj', 'Pečnik', 'Rupnik'];
  var FIRST_HR = ['Ivana', 'Marko', 'Ana', 'Tomislav', 'Petra', 'Davor', 'Martina', 'Josip', 'Kristina', 'Ante', 'Mirela', 'Luka'];
  var LAST_HR = ['Babić', 'Kovačević', 'Marić', 'Jurić', 'Knežević', 'Vuković', 'Pavlović', 'Perić', 'Tomić', 'Blažević', 'Matić', 'Grgić'];
  var REACHED = [
    'Accounting confirms the invoices are approved for the next payment run.',
    'Spoke to accounting: they pay on Fridays, our invoices are on the list.',
    'Says the payment is waiting for the director\'s signature.',
    'Invoice was missing in their system; sent a copy by e-mail.',
    'Asked for a statement of open items; sent it the same day.',
    'Their client is late with a project payment; they will pay when it arrives.',
    'New person in accounting, promised to check and call back.',
    'Confirmed the amount, payment planned with the end-of-month run.'
  ];
  var NO_ANSWER = ['No answer.', 'Voicemail, left a message.', 'Line busy, try again tomorrow.', 'Reception says accounting is out today.'];
  var PROMISED = ['Promised to pay with the next payment run.', 'Will pay on {date}, confirmed by accounting.', 'Payment approved, they will transfer it by {date}', 'Promised the transfer for {date}'];

  function strip(s) { return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D'); }
  function siVatFrom(r) {
    for (;;) {
      var d = [r.int(1, 9)]; for (var i = 1; i < 7; i++) d.push(r.int(0, 9));
      var t = 0; for (i = 0; i < 7; i++) t += d[i] * (8 - i);
      var c = 11 - (t % 11); if (c === 10) continue; if (c === 11) c = 0;
      return 'SI' + d.join('') + c;
    }
  }
  function hrOibFrom(r) {
    var d = []; for (var i = 0; i < 10; i++) d.push(r.int(0, 9));
    var a = 10; for (i = 0; i < 10; i++) { a = (a + d[i]) % 10; if (a === 0) a = 10; a = (a * 2) % 11; }
    var c = 11 - a; if (c === 10) c = 0;
    return 'HR' + d.join('') + c;
  }
  function digits(r, n) { var s = ''; for (var i = 0; i < n; i++) s += r.int(0, 9); return s; }
  function phoneFor(r, country, area, mobile) {
    if (country === 'HR') {
      if (mobile) return '+385 ' + r.pick(['91', '92', '95', '98', '99']) + ' ' + r.int(100, 999) + ' ' + digits(r, 4);
      return '+385 ' + area + ' ' + (area === '1' ? r.int(200, 699) + ' ' + digits(r, 4) : r.int(200, 699) + ' ' + digits(r, 3));
    }
    if (mobile) return '+386 ' + r.pick(['31', '40', '41', '51', '70']) + ' ' + r.int(200, 899) + ' ' + digits(r, 3);
    return '+386 ' + area + ' ' + r.int(200, 899) + ' ' + digits(r, 2) + ' ' + digits(r, 2);
  }

  /** Build the whole demo document for `today` ('YYYY-MM-DD', Europe/Ljubljana). */
  function generate(today) {
    var r = rng(0xC011EC7), A = E.addDays, S = E.normSettings({});
    var db = {
      version: VERSION, generatedFor: today, demo: true,
      company: JSON.parse(JSON.stringify(COMPANY)), sender: JSON.parse(JSON.stringify(SENDER)), settings: S,
      customers: [], invoices: [], actions: [], plans: [], log: []
    };
    var shareSum = CUSTOMERS.reduce(function (s, c) { return s + c[5]; }, 0);
    var START = A(today, -425);

    // ── customers ──
    CUSTOMERS.forEach(function (x, i) {
      var city = CITY[x[7]], hr = x[6] === 'HR';
      var first = hr ? FIRST_HR[(i * 5) % FIRST_HR.length] : FIRST_SI[(i * 7) % FIRST_SI.length];
      var last = hr ? LAST_HR[(i * 7 + 3) % LAST_HR.length] : LAST_SI[(i * 11 + 5) % LAST_SI.length];
      var monthly = MONTHLY_SALES * x[5] / shareSum, seg = x[1];
      var limit = seg === 'Public sector' ? 0 : Math.max(10000, Math.round(monthly * (x[2] / 30 + 1) * 1.1 / 5000) * 5000);
      var c = {
        id: 'c' + String(i + 1).padStart(2, '0'), no: String(1001 + i), name: x[0], country: x[6], vatId: hr ? hrOibFrom(r) : siVatFrom(r),
        address: { street: x[8], postal: city[0], city: city[1] },
        contact: { name: first + ' ' + last, email: strip(first + '.' + last).toLowerCase() + '@example.com', phone: phoneFor(r, x[6], city[2], r() < 0.45) },
        segment: seg, terms: x[2], creditLimit: limit, onHold: false, language: hr ? 'hr' : 'sl', notes: '',
        interest: { contractRate: null, cap: null },
        profile: { avgLate: x[3], spread: x[4], share: x[5], trend: x[9], partial: x[10], monthly: Math.round(monthly) }
      };
      db.customers.push(c);
    });
    var C = function (name) { return db.customers[IDX[name]]; };
    var struna = C('Struna Gradnje d.o.o.'), lesjak = C('Montaže Lesjak s.p.'), klimatika = C('Klimatika Jadran d.o.o.');
    C('Adriatic Coast Hotels d.o.o.').language = 'en';
    C('Megagrad Holding d.d.').interest.contractRate = 8;
    C('Megagrad Holding d.d.').notes = 'Framework agreement 2025: default interest at 8 % a year instead of the statutory rate.';
    var strunaHold = A(today, -30), lesjakStop = A(today, -270);

    // ── invoices, sized from each customer's share of sales ──
    var raw = [];
    db.customers.forEach(function (c, ci) {
      var p = c.profile, perMonth = Math.max(1, Math.round(p.monthly / 14000)), gap = 30.4 / perMonth;
      for (var d = -425 + r.between(0, gap); d <= -1; d += gap * r.between(0.6, 1.4)) {
        var issue = E.workdayOnOrBefore(A(today, Math.round(d)));
        if (issue < START) continue;
        if (c === struna && issue >= strunaHold) continue;
        if (c === lesjak && issue >= lesjakStop) continue;
        raw.push({ c: c, ci: ci, issue: issue, amount: r2(p.monthly / perMonth * r.between(0.55, 1.45)) });
      }
    });
    // Struna's two big spring invoices (the same ones Cash forecast leaves out as doubtful)
    [[-158, 41850.4], [-141, 27310.9]].forEach(function (x) { raw.push({ c: struna, ci: IDX[struna.name], issue: E.workdayOnOrBefore(A(today, x[0])), amount: x[1], stuck: true }); });
    // Domotehna: the delivery with 40 damaged radiators
    raw.push({ c: C('Domotehna Center d.o.o.'), ci: IDX['Domotehna Center d.o.o.'], issue: E.workdayOnOrBefore(A(today, -38)), amount: 18640, dispute: { reason: '40 radiators arrived damaged. Credit note under review.', since: A(today, -6) } });
    // Upravnik Domus: says it paid, nobody can find the payment
    raw.push({ c: C('Upravnik Domus d.o.o.'), ci: IDX['Upravnik Domus d.o.o.'], issue: E.workdayOnOrBefore(A(today, -236)), amount: 2318.4, stuck: true });
    raw.sort(function (a, b) { return a.issue < b.issue ? -1 : a.issue > b.issue ? 1 : a.ci - b.ci; });
    // Montaže Lesjak never paid its last two deliveries before the bankruptcy
    raw.filter(function (x) { return x.c === lesjak; }).slice(-2).forEach(function (x) { x.stuck = true; });

    // invoice numbers run through the year, with gaps for counter and cash sales
    var seq = {}, future = {};
    raw.forEach(function (x, k) {
      var y = x.issue.slice(0, 4);
      if (!seq[y]) seq[y] = y === START.slice(0, 4) ? Math.round(E.diffDays(y + '-01-01', x.issue) * 3.9) : 0;
      seq[y] += 1 + (r() < 0.3 ? r.int(1, 3) : 0);
      var c = x.c, p = c.profile, due = A(x.issue, c.terms);
      var inv = { id: 'i' + String(k + 1).padStart(4, '0'), no: y + '-' + String(seq[y]).padStart(6, '0'), customerId: c.id, issueDate: x.issue, dueDate: due, amount: x.amount, payments: [], disputed: null, writtenOff: null };
      if (x.dispute) inv.disputed = x.dispute;
      db.invoices.push(inv);
      if (x.stuck) return;
      var monthsAgo = E.diffDays(x.issue, today) / 30.4;
      var late = p.avgLate + p.trend * (7 - monthsAgo) / 12 + r.norm() * p.spread;
      if (c.segment !== 'Public sector' && r() < 0.07) late += r.int(15, 50); // waiting for an approval, a lost invoice
      late = Math.max(-5, Math.round(late));
      if (x.dispute) late = 400;
      var payDate = E.workdayOnOrAfter(A(due, late));
      if (r() < p.partial) {
        var first = Math.max(100, Math.round(x.amount * r.between(0.3, 0.7) / 10) * 10);
        var d1 = E.workdayOnOrAfter(E.maxDate(A(x.issue, 6), A(payDate, -r.int(8, 30))));
        if (d1 < payDate && d1 < today) inv.payments.push({ date: d1, amount: first });
      }
      if (payDate < today) inv.payments.push({ date: payDate, amount: r2(x.amount - E.paidUpTo(inv)) });
      else future[inv.id] = payDate;
    });
    var invBy = {};
    db.invoices.forEach(function (i) { (invBy[i.customerId] = invBy[i.customerId] || []).push(i); });
    function custInv(c) { return invBy[c.id] || []; }
    function overdueOpen(c, date) { return custInv(c).filter(function (i) { return E.openAt(i, date) > 0 && i.dueDate < date; }); }

    // ── special cases ──
    var acts = [];
    function act(o) { o.by = o.by || SENDER.name; o.invoiceIds = o.invoiceIds || []; acts.push(o); return o; }
    // Struna: a broken promise in August with 5.000 € paid, a second one on the date Cash forecast shows.
    // Nothing else of theirs arrives while those promises run, so the story holds.
    var w1 = [E.workdayOnOrBefore(A(today, -48)), A(E.workdayOnOrBefore(A(today, -41)), 2)], w2 = [E.workdayOnOrBefore(A(today, -12)), A(today, -4)];
    custInv(struna).forEach(function (inv) {
      inv.payments.forEach(function (p) {
        [w1, w2].forEach(function (w) {
          if (p.date < w[0] || p.date > w[1]) return;
          var after = E.workdayOnOrAfter(A(w[1], 1));
          p.date = after < today ? after : E.workdayOnOrBefore(A(w[0], -1));
        });
      });
    });
    var sOld = custInv(struna).filter(function (i) { return i.amount === 41850.4; })[0];
    sOld.payments.push({ date: E.workdayOnOrBefore(A(today, -41)), amount: 5000 }); // on the promised day, a quarter of what was promised
    var sIds = function (d) { return overdueOpen(struna, d).filter(function (i) { return !i.disputed; }).map(function (i) { return i.id; }); };
    var sAmt = function (d) { return r2(overdueOpen(struna, d).reduce(function (s, i) { return s + E.openAt(i, d); }, 0)); };
    var d0 = E.workdayOnOrBefore(A(today, -90)), d1 = E.workdayOnOrBefore(A(today, -76)), d2 = E.workdayOnOrBefore(A(today, -13));
    act({ customerId: struna.id, type: 'letter', date: d0, stage: 0, invoiceIds: sIds(d0), amount: sAmt(d0), lang: 'sl' });
    act({ customerId: struna.id, type: 'call', date: E.workdayOnOrBefore(A(today, -84)), outcome: 'reached', text: 'Director on holiday until Monday; accounting confirms both spring invoices were received.' });
    act({ customerId: struna.id, type: 'letter', date: d1, stage: 1, invoiceIds: sIds(d1), amount: sAmt(d1), lang: 'sl' });
    act({ customerId: struna.id, type: 'call', date: E.workdayOnOrBefore(A(today, -55)), outcome: 'no-answer', text: 'No answer.' });
    var p1 = E.workdayOnOrBefore(A(today, -41));
    act({ customerId: struna.id, type: 'call', date: E.workdayOnOrBefore(A(today, -48)), outcome: 'promised', mustBreak: true, promise: { date: p1, amount: 20000, status: 'open' }, text: 'Promised 20.000 € by ' + E.fmtDayMonth(p1) + ' from a project payment they expect from their own client.' });
    act({ customerId: struna.id, type: 'call', date: E.workdayOnOrBefore(A(today, -34)), outcome: 'reached', text: 'Paid only 5.000 €. Says the investor is late; will pay the rest "as soon as possible".' });
    act({ customerId: struna.id, type: 'hold', date: strunaHold, text: 'Deliveries stopped until the overdue balance is paid.', hold: true });
    act({ customerId: struna.id, type: 'letter', date: d2, stage: 2, invoiceIds: sIds(d2), amount: sAmt(d2), lang: 'sl' });
    var p2 = A(today, -6);
    act({ customerId: struna.id, type: 'call', date: E.workdayOnOrBefore(A(today, -12)), outcome: 'promised', mustBreak: true, promise: { date: p2, amount: 15000, status: 'open' }, text: 'Second reminder received. Asks for an instalment plan; we asked for 15.000 € by ' + E.fmtDayMonth(p2) + ' first.' });
    act({ customerId: struna.id, type: 'call', date: E.workdayOnOrBefore(A(today, -3)), outcome: 'no-answer', text: 'Director\'s phone switched off. Left a message with reception.' });
    struna.onHold = true;
    struna.notes = 'Contractor in Kranj. Pays later every quarter: about 3 weeks late a year ago, two months now. Two big spring invoices still open. Asked for an instalment plan.';

    // Lumen Gradnje and Slavonija Gradnja: recent broken promises
    [['Lumen Gradnje d.o.o.', -25, -18, 30000, 0.33], ['Slavonija Gradnja d.d.', -17, -11, 18000, 0.25]].forEach(function (x) {
      var c = C(x[0]), od = overdueOpen(c, A(today, x[1])).filter(function (i) { return !i.disputed; });
      if (!od.length) return;
      var pd = E.workdayOnOrBefore(A(today, x[2]));
      var amt = Math.min(x[3], Math.floor(od.reduce(function (s, i) { return s + E.openAt(i, today); }, 0) / 1000) * 1000) || x[3];
      act({ customerId: c.id, type: 'call', date: E.workdayOnOrBefore(A(today, x[1])), outcome: 'promised', mustBreak: true, promise: { date: pd, amount: amt, status: 'open' }, text: 'Promised ' + E.fmtMoney0(amt) + ' by ' + E.fmtDayMonth(pd) });
      // part of it arrived: too little to count as kept
      var part = Math.round(amt * x[4] / 100) * 100, target = od[0];
      if (part > 0 && E.openAt(target, today) > part) { target.payments.push({ date: E.workdayOnOrAfter(A(pd, -1)), amount: part }); delete future[target.id]; future[target.id] = A(today, 20); }
    });

    // Kopalnice Arkada: its only overdue invoice is disputed (the others are paid)
    var kop = C('Kopalnice Arkada d.o.o.'), kopOd = overdueOpen(kop, today).sort(function (a, b) { return b.amount - a.amount; });
    if (!kopOd.length) {
      var k0 = custInv(kop).filter(function (i) { return i.dueDate < A(today, -20) && i.dueDate > A(today, -60); })[0];
      if (k0) { k0.payments = []; kopOd = [k0]; }
    }
    kopOd.forEach(function (inv, k) {
      if (k === 0) { inv.disputed = { reason: 'Charged list prices instead of the agreed 12 % project discount. Asked for a credit note.', since: E.workdayOnOrBefore(A(today, -20)) }; delete future[inv.id]; return; }
      inv.payments.push({ date: E.workdayOnOrBefore(A(today, -2)), amount: E.openAt(inv, today) }); delete future[inv.id];
    });
    // Kvarner Instalacije and Hotel Planika: one disputed invoice each, among others
    // Kvarner: one of several overdue invoices (the letter leaves it out); Hotel Planika: its newest invoice
    var kv = C('Kvarner Instalacije d.o.o.'), kvOd = overdueOpen(kv, today).sort(function (a, b) { return a.dueDate < b.dueDate ? -1 : 1; });
    if (kvOd.length < 2) {
      custInv(kv).filter(function (i) { return i.dueDate < A(today, -5) && i.dueDate > A(today, -40) && kvOd.indexOf(i) < 0; }).slice(0, 2 - kvOd.length).forEach(function (i) {
        i.payments = i.payments.filter(function (p) { return p.date < A(today, -60); }); future[i.id] = A(today, r.int(8, 20)); kvOd.push(i);
      });
      kvOd.sort(function (a, b) { return a.dueDate < b.dueDate ? -1 : 1; });
    }
    if (kvOd.length) { var kvi = kvOd[kvOd.length - 1]; kvi.disputed = { reason: 'Short delivery: 6 of 20 circulation pumps missing on delivery note 26-4471.', since: E.workdayOnOrBefore(A(today, -9)) }; delete future[kvi.id]; }
    var hp = C('Hotel Planika d.d.'), hpi = custInv(hp).filter(function (i) { return E.openAt(i, today) > 0 && i.dueDate >= today; }).sort(function (a, b) { return a.issueDate < b.issueDate ? 1 : -1; })[0];
    if (hpi) { hpi.disputed = { reason: 'Invoice addressed to the wrong cost centre. Asked for a corrected invoice.', since: E.workdayOnOrBefore(A(today, -3)) }; delete future[hpi.id]; }
    db.invoices.forEach(function (inv) {
      if (inv.disputed) act({ customerId: inv.customerId, type: 'dispute', date: inv.disputed.since, invoiceIds: [inv.id], text: inv.disputed.reason });
    });
    // Montaže Lesjak: bankrupt, the last two invoices written off
    var lesOpen = custInv(lesjak).filter(function (i) { return E.openAt(i, today) > 0; });
    var woDate = E.workdayOnOrBefore(A(today, -120)), woSum = 0;
    lesOpen.forEach(function (inv) { inv.payments = inv.payments.filter(function (p) { return p.date < woDate; }); woSum += E.openAt(inv, woDate); inv.writtenOff = { date: woDate, reason: 'Bankruptcy (stečaj) opened. Claim filed with the administrator.' }; delete future[inv.id]; });
    if (lesOpen.length) {
      act({ customerId: lesjak.id, type: 'note', date: woDate, invoiceIds: lesOpen.map(function (i) { return i.id; }), text: 'Bankruptcy proceedings opened. Claim of ' + E.fmtMoney(woSum, 'sl') + ' filed with the administrator; ' + lesOpen.length + ' invoices written off.' });
      lesjak.onHold = true; lesjak.notes = 'Closed. Bankruptcy proceedings opened; claim filed. No new deliveries.';
    }
    // Upravnik Domus: claims it paid
    var dom = C('Upravnik Domus d.o.o.'), domInv = custInv(dom).filter(function (i) { return i.amount === 2318.4; })[0];
    act({ customerId: dom.id, type: 'call', date: E.workdayOnOrBefore(A(today, -61)), outcome: 'reached', invoiceIds: [domInv.id], text: 'Says invoice ' + domInv.no + ' was paid in spring. Asked for proof of payment; nothing found in our bank.' });
    dom.notes = 'Property manager. One old invoice they believe is paid; waiting for their proof of payment.';

    // Klimatika Jadran: three old invoices on a 6-month payment plan, two instalments paid on time
    var kOld = custInv(klimatika).filter(function (i) { return i.dueDate < A(today, -95) && i.dueDate > A(today, -200); }).sort(function (a, b) { return b.amount - a.amount; }).slice(0, 3)
      .sort(function (a, b) { return a.dueDate < b.dueDate ? -1 : 1; });
    var planCreated = E.workdayOnOrBefore(A(today, -72)), plan = null;
    if (kOld.length) {
      kOld.forEach(function (inv) { inv.payments = inv.payments.filter(function (p) { return p.date < A(inv.dueDate, 20); }); delete future[inv.id]; });
      var tot = r2(kOld.reduce(function (s, i) { return s + E.openAt(i, planCreated); }, 0));
      var n = 6, inst = E.splitPlan(tot, n, E.workdayOnOrAfter(A(today, -57)));
      plan = { id: 'p1', customerId: klimatika.id, created: planCreated, total: tot, invoiceIds: kOld.map(function (i) { return i.id; }), instalments: inst, status: 'active', note: 'Agreed with the owner after the second reminder.' };
      inst.forEach(function (it) {
        if (it.due >= today) return;
        it.paidDate = E.workdayOnOrAfter(A(it.due, r.int(-1, 1)));
        var al = E.allocate(kOld, it.amount, it.paidDate);
        al.parts.forEach(function (pt) { var inv = kOld.filter(function (i) { return i.id === pt.id; })[0]; inv.payments.push({ date: it.paidDate, amount: pt.amount }); });
      });
      db.plans.push(plan);
      act({ customerId: klimatika.id, type: 'plan', date: planCreated, invoiceIds: plan.invoiceIds, text: 'Payment plan agreed: ' + E.fmtMoney(tot, 'sl') + ' in ' + n + ' monthly instalments.' });
      klimatika.notes = 'Owner asked for a payment plan in summer after a slow season. Plan is being paid on time so far.';
    }

    // promises made in the last few days, not due yet: from invoices these customers will really pay soon
    var used = {}; [struna, klimatika, kop, C('Lumen Gradnje d.o.o.'), C('Slavonija Gradnja d.d.'), dom].forEach(function (c) { used[c.id] = 1; });
    var cands = [];
    db.customers.forEach(function (c) {
      if (used[c.id] || c.segment === 'Public sector') return;
      var od = overdueOpen(c, today).filter(function (i) { return !i.disputed && future[i.id]; });
      od.forEach(function (i) { var fd = future[i.id]; if (fd > today && fd <= A(today, 6)) cands.push({ c: c, inv: i, date: fd }); });
    });
    cands.sort(function (a, b) { return b.inv.amount - a.inv.amount; });
    // not enough real ones: customers with something overdue promise a date in the next few days
    db.customers.forEach(function (c) {
      if (used[c.id] || c.segment === 'Public sector' || cands.length >= 8) return;
      var od = overdueOpen(c, today).filter(function (i) { return !i.disputed && E.diffDays(i.dueDate, today) >= 4; });
      if (od.length && cands.every(function (x) { return x.c !== c; })) cands.push({ c: c, inv: od[0], date: E.workdayOnOrAfter(A(today, r.int(1, 5))) });
    });
    var nUp = 0;
    cands.forEach(function (x) {
      if (nUp >= 4 || used[x.c.id]) return;
      used[x.c.id] = 1; nUp++;
      var amt = Math.floor(E.openAt(x.inv, today) / 100) * 100, made = E.workdayOnOrBefore(A(today, -r.int(1, 4)));
      act({ customerId: x.c.id, type: nUp === 3 ? 'email' : 'call', date: made, outcome: nUp === 3 ? undefined : 'promised', invoiceIds: [x.inv.id], promise: { date: x.date, amount: amt, status: 'open' },
        text: nUp === 3 ? 'Replied by e-mail: payment of ' + E.fmtMoney0(amt) + ' scheduled for ' + E.fmtDayMonth(x.date) : PROMISED[nUp % PROMISED.length].replace('{date}', E.fmtDayMonth(x.date)) });
    });
    // one promise due today
    var dueToday = db.customers.filter(function (c) { return !used[c.id] && c.segment !== 'Public sector' && overdueOpen(c, today).some(function (i) { return !i.disputed; }) && !custInv(c).some(function (i) { return i.disputed; }); })[3];
    if (dueToday) {
      used[dueToday.id] = 1;
      var odt = overdueOpen(dueToday, today).filter(function (i) { return !i.disputed; });
      var amtT = Math.floor(odt.reduce(function (s, i) { return s + E.openAt(i, today); }, 0) / 100) * 100;
      act({ customerId: dueToday.id, type: 'call', date: E.workdayOnOrBefore(A(today, -5)), outcome: 'promised', invoiceIds: odt.map(function (i) { return i.id; }), promise: { date: today, amount: amtT, status: 'open' }, text: 'Promised the transfer for today.' });
    }

    // ── a year of follow-up, replayed through the engine's own rules ──
    var actBy = {}, planBy = {};
    db.customers.forEach(function (c) { actBy[c.id] = []; planBy[c.id] = []; });
    acts.forEach(function (a) { actBy[a.customerId].push(a); });
    db.plans.forEach(function (p) { planBy[p.customerId].push(p); });
    var scripted = {}; scripted[struna.id] = 1;
    var lastBatch = E.workdayOnOrBefore(A(today, -6)), batch = {};
    for (var b = lastBatch; b >= A(today, -365); b = A(b, -7)) batch[b] = 1;
    var lastCall = {};
    function stateOf(c, D) { return E.analyzeCustomer(c, custInv(c), actBy[c.id], planBy[c.id], D, S); }
    function hasOverdue(c, D) { return custInv(c).some(function (i) { return i.dueDate < D && E.openAt(i, D) > 0; }); }
    function paymentsBetween(c, from, to) {
      var list = [];
      custInv(c).forEach(function (i) { i.payments.forEach(function (p) { if (p.date > from && p.date <= to) list.push(p); }); });
      return list.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    }
    for (var D = A(today, -365); D < today; D = A(D, 1)) {
      if (E.isWeekend(D)) continue;
      var states = {};
      db.customers.forEach(function (c) { if (!scripted[c.id] && hasOverdue(c, D)) states[c.id] = stateOf(c, D); });
      // calls: the top of that day's list, not the ones called in the last week or waiting on a promise or a plan
      var lastWeek = D > A(today, -7);
      if (r() < (lastWeek ? 0.6 : 0.75)) {
        var list = db.customers.filter(function (c) {
          var st = states[c.id];
          return st && st.priority.score > 0 && !st.openPromise && !(st.plan && st.plan.state === 'kept') && !(lastCall[c.id] && E.diffDays(lastCall[c.id], D) < 7) && (D < A(today, -45) || !used[c.id]) &&
            !(lastWeek && st.dunning.due); // in the last week, the ones due a letter wait for it
        }).sort(function (x, y) { return states[y.id].priority.score - states[x.id].priority.score; });
        var nCalls = lastWeek ? r.int(1, 2) : r.int(1, 3);
        list.slice(0, nCalls).forEach(function (c) {
          var st = states[c.id], pays = paymentsBetween(c, D, A(D, 12)), got = pays.reduce(function (s, p) { return s + p.amount; }, 0);
          var by = r() < 0.7 ? SENDER.name : COLLEAGUE, a;
          lastCall[c.id] = D;
          if (got >= Math.max(100, 0.25 * st.overdueUndisputed) && r() < 0.55) {
            var amt = Math.max(100, Math.floor(got / 100) * 100), pd = pays[pays.length - 1].date;
            a = { customerId: c.id, type: 'call', date: D, outcome: 'promised', invoiceIds: st.overdueInvs.map(function (i) { return i.id; }), promise: { date: pd, amount: amt, status: 'open' }, text: r.pick(PROMISED).replace('{date}', E.fmtDayMonth(pd)), by: by };
          } else if (!got && D < A(today, -100) && c.segment !== 'Public sector' && r() < 0.25) {
            // a promise nobody keeps
            var pdB = E.workdayOnOrAfter(A(D, r.int(3, 8))), amtB = Math.max(100, Math.floor(st.overdueUndisputed / 100) * 100);
            a = { customerId: c.id, type: 'call', date: D, outcome: 'promised', invoiceIds: st.overdueInvs.map(function (i) { return i.id; }), promise: { date: pdB, amount: amtB, status: 'open' }, text: r.pick(PROMISED).replace('{date}', E.fmtDayMonth(pdB)), by: by };
          } else if (r() < 0.42) a = { customerId: c.id, type: 'call', date: D, outcome: 'no-answer', invoiceIds: [], text: r.pick(NO_ANSWER), by: by };
          else a = { customerId: c.id, type: 'call', date: D, outcome: 'reached', invoiceIds: [], text: r.pick(REACHED), by: by };
          acts.push(a); actBy[c.id].push(a);
          states[c.id] = stateOf(c, D);
        });
      }
      // letters: one batch a week, whatever the rules say is due
      if (batch[D]) {
        db.customers.forEach(function (c) {
          var st = states[c.id];
          if (!st || !st.dunning.due || r() > 0.93) return;
          var a = { customerId: c.id, type: 'letter', date: D, stage: st.dunning.next, invoiceIds: st.overdueInvs.map(function (i) { return i.id; }), amount: st.overdueUndisputed, lang: c.language, by: SENDER.name, text: '' };
          acts.push(a); actBy[c.id].push(a);
        });
      }
    }

    // a quiet week: when fewer than 8 letters are due today, last week's batch skipped a few customers whose
    // only reason to wait is the 10-day gap, so their letter is due today instead
    var dueNow = db.customers.filter(function (c) { return stateOf(c, today).dunning.due; }).length;
    db.customers.forEach(function (c) {
      if (dueNow >= 8 || scripted[c.id]) return;
      var st = stateOf(c, today);
      if (!st.dunning.skip || st.dunning.skip.code !== 'gap' || !st.lastLetter || st.lastLetter.date !== lastBatch) return;
      var drop = st.lastLetter;
      actBy[c.id] = actBy[c.id].filter(function (a) { return a !== drop; });
      if (stateOf(c, today).dunning.due) { acts = acts.filter(function (a) { return a !== drop; }); dueNow++; }
      else actBy[c.id].push(drop);
    });

    // ── tidy up ──
    acts.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    var invByAll = {};
    db.invoices.forEach(function (i) { (invByAll[i.customerId] = invByAll[i.customerId] || []).push(i); });
    // the scripted broken promises stay broken, whatever else the customer paid in that window
    acts.forEach(function (a) {
      if (!a.promise || !a.mustBreak) return;
      var ps = E.promiseState(a, invByAll[a.customerId] || [], today, S.promiseGrace);
      if (ps.state !== 'broken') {
        a.promise.amount = Math.ceil((ps.paid + Math.max(5000, a.promise.amount * 0.4)) / 1000) * 1000;
        a.text = a.text.replace(/Promised [\d.]+[ \u00a0]€/, 'Promised ' + E.fmtMoney0(a.promise.amount));
      }
      delete a.mustBreak;
    });
    acts.forEach(function (a, k) {
      a.id = 'a' + String(k + 1).padStart(5, '0');
      if (a.promise) a.promise.status = E.promiseState(a, invByAll[a.customerId] || [], today, S.promiseGrace).state;
      if (a.outcome === undefined) delete a.outcome;
    });
    db.actions = acts;
    db.invoices.forEach(function (i) { i.payments.sort(function (a, b) { return a.date < b.date ? -1 : 1; }); i.payments.forEach(function (p) { p.amount = r2(p.amount); }); });
    // credit limits: Gradbeni Sistemi Vrh is just over its limit, Struna well over
    var gsv = C('Gradbeni Sistemi Vrh d.d.'), gsvOpen = custInv(gsv).reduce(function (s, i) { return s + E.openAt(i, today); }, 0);
    gsv.creditLimit = Math.max(50000, Math.floor((gsvOpen - 6000) / 10000) * 10000);
    struna.creditLimit = 75000;
    db.log.push({ at: today, text: 'Demo data created.' });
    return db;
  }

  return { VERSION: VERSION, COMPANY: COMPANY, SENDER: SENDER, CUSTOMERS: CUSTOMERS, rng: rng, generate: generate };
});
