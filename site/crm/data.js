/* CRM demo — catalogues and the deterministic demo-data generator.
 * Everything here is FICTIONAL: companies, people, e-mails (@example.com), phone numbers, VAT ids.
 * generate(nowMs) always produces the same records for the same seed; dates are laid out relative
 * to the day of the first load so the demo always has ~18 months of history up to "today". */
(function (global) {
  'use strict';

  var DAY = 864e5;
  var SEED = 20261007;

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ── Catalogues (constants, not stored) ────────────────────────────────────
  var OWNERS = [
    { id: 'u1', name: 'Nina Kovač', initials: 'NK', role: 'Key accounts · Slovenia', tone: 'violet' },
    { id: 'u2', name: 'Luka Horvat', initials: 'LH', role: 'Key accounts · Croatia', tone: 'blue' },
    { id: 'u3', name: 'Maja Zupan', initials: 'MZ', role: 'Opticians & clinics · SI', tone: 'teal' },
    { id: 'u4', name: 'Ivan Babić', initials: 'IB', role: 'Opticians & clinics · HR', tone: 'clay' },
    { id: 'u5', name: 'Tea Novak', initials: 'TN', role: 'Corporate & partnerships', tone: 'green' }
  ];

  var STAGES = [
    { id: 'lead', name: 'Lead', prob: 10, open: true, tone: 'grey' },
    { id: 'qualified', name: 'Qualified', prob: 25, open: true, tone: 'blue' },
    { id: 'proposal', name: 'Proposal', prob: 50, open: true, tone: 'teal' },
    { id: 'negotiation', name: 'Negotiation', prob: 75, open: true, tone: 'violet' },
    { id: 'won', name: 'Won', prob: 100, open: false, tone: 'green' },
    { id: 'lost', name: 'Lost', prob: 0, open: false, tone: 'clay' }
  ];

  var SEGMENTS = ['Optician', 'Clinic', 'Corporate', 'Reseller', 'Partner'];
  var SEGMENT_TONE = { Optician: 'violet', Clinic: 'teal', Corporate: 'blue', Reseller: 'clay', Partner: 'green' };
  var COUNTRIES = [{ id: 'SI', name: 'Slovenia' }, { id: 'HR', name: 'Croatia' }];

  var PRODUCTS = [
    { id: 'FRM-PRG', name: 'Frames programme (B2B assortment)', short: 'Frames programme', unit: 'frame', price: 38, qty: [60, 400], seg: ['Optician', 'Reseller'] },
    { id: 'CL-SUB', name: 'Contact-lens subscription (12 months)', short: 'Contact-lens subscription', unit: 'patient', price: 168, qty: [10, 160], seg: ['Optician', 'Clinic', 'Corporate'] },
    { id: 'EYE-EXAM', name: 'Corporate eye-exam package', short: 'Corporate eye-exam package', unit: 'employee', price: 29, qty: [40, 600], seg: ['Corporate', 'Partner'] },
    { id: 'SAFE-RX', name: 'Prescription safety eyewear', short: 'Prescription safety eyewear', unit: 'pair', price: 95, qty: [10, 120], seg: ['Corporate'] },
    { id: 'SCR-GL', name: 'Screen glasses for office staff', short: 'Screen glasses', unit: 'pair', price: 49, qty: [20, 300], seg: ['Corporate', 'Reseller'] },
    { id: 'LENS-SUP', name: 'Progressive lens supply contract', short: 'Lens supply contract', unit: 'pair', price: 72, qty: [50, 500], seg: ['Optician', 'Clinic'] },
    { id: 'SUN-SEAS', name: 'Sunglasses seasonal assortment', short: 'Sunglasses assortment', unit: 'piece', price: 24, qty: [100, 600], seg: ['Optician', 'Reseller'] },
    { id: 'SIS-FIX', name: 'Shop-in-shop display fixture', short: 'Shop-in-shop display', unit: 'fixture', price: 1450, qty: [1, 4], seg: ['Reseller', 'Partner', 'Optician'] },
    { id: 'TRAIN', name: 'Optometry training workshop', short: 'Training workshop', unit: 'day', price: 890, qty: [1, 5], seg: ['Optician', 'Clinic'] },
    { id: 'MKT-PART', name: 'Co-marketing partnership package', short: 'Co-marketing partnership', unit: 'quarter', price: 2400, qty: [1, 4], seg: ['Partner'] },
    { id: 'VOUCH', name: 'Eye-care voucher bundle', short: 'Eye-care vouchers', unit: 'voucher', price: 35, qty: [50, 500], seg: ['Partner', 'Corporate'] }
  ];

  var LOST_REASONS = ['Price too high', 'Chose a competitor', 'No budget this year', 'Timing — postponed', 'No decision / went silent', 'Product did not fit needs', 'Other'];

  var ACT_TYPES = [
    { id: 'call', name: 'Call' },
    { id: 'meeting', name: 'Meeting' },
    { id: 'email', name: 'Email' },
    { id: 'task', name: 'Task' }
  ];

  var SOURCES = ['Referral', 'Trade fair', 'Website enquiry', 'Outbound', 'Partner intro', 'Existing customer'];

  // ── Name material ──────────────────────────────────────────────────────────
  var W = {
    SI: ['Lipa', 'Breza', 'Javor', 'Vrba', 'Planika', 'Encijan', 'Kresnica', 'Zarja', 'Jasna', 'Bistra', 'Iris', 'Kristal', 'Obzorje', 'Pogled', 'Zrcalo', 'Svetla', 'Modrina', 'Mavrica', 'Sinji vrh', 'Lučka', 'Zvezda', 'Smreka', 'Gaber', 'Jelka', 'Bor', 'Detelja', 'Sončnica', 'Vidra', 'Lastovka', 'Brinje'],
    HR: ['Lavanda', 'Maslina', 'Bura', 'Zora', 'Vidik', 'Iskra', 'Mareta', 'Galeb', 'Smilje', 'Ružmarin', 'Lastavica', 'Borovina', 'Kamenica', 'Modrina', 'Svjetlost', 'Obala', 'Žalo', 'Dupin', 'Lanterna', 'Pergola', 'Čempres', 'Sidro', 'Jedro', 'Murva', 'Tamaris', 'Konoba', 'Rogač', 'Školjka', 'Valovi', 'Lucija']
  };
  var TPL = {
    SI: {
      Optician: ['Optika {w} d.o.o.', 'Optika {w} s.p.', 'Očesni center {w} d.o.o.'],
      Clinic: ['Očesna klinika {w} d.o.o.', 'Oftalmološka ambulanta {w}', 'Zasebna očesna ordinacija {w}'],
      Corporate: ['{w} Logistika d.o.o.', '{w} Tehnologije d.o.o.', '{w} Energetika d.d.', '{w} Gradnja d.o.o.', '{w} Farmacija d.o.o.', '{w} Software d.o.o.'],
      Reseller: ['{w} Trade d.o.o.', '{w} Medical d.o.o.', '{w} Distribucija d.o.o.'],
      Partner: ['Zavod {w}', '{w} Benefiti d.o.o.', 'Športno društvo {w}', 'Zdravstvena zadruga {w}']
    },
    HR: {
      Optician: ['Optika {w} d.o.o.', 'Optičarski obrt {w}', 'Optika {w} j.d.o.o.'],
      Clinic: ['Poliklinika {w}', 'Očna klinika {w} d.o.o.', 'Specijalistička ordinacija {w}'],
      Corporate: ['{w} Logistika d.o.o.', '{w} Tehnologije d.o.o.', '{w} Energija d.d.', '{w} Gradnja d.o.o.', '{w} Pharma d.o.o.', '{w} Softver d.o.o.'],
      Reseller: ['{w} Trgovina d.o.o.', '{w} Medical d.o.o.', '{w} Distribucija d.o.o.'],
      Partner: ['Udruga {w}', '{w} Benefiti d.o.o.', 'Sportski klub {w}', 'Zaklada {w}']
    }
  };
  var CITIES = {
    SI: [['Ljubljana', '1000'], ['Ljubljana', '1000'], ['Ljubljana', '1000'], ['Maribor', '2000'], ['Maribor', '2000'], ['Celje', '3000'], ['Kranj', '4000'], ['Koper', '6000'], ['Novo mesto', '8000'], ['Velenje', '3320'], ['Murska Sobota', '9000'], ['Nova Gorica', '5000'], ['Ptuj', '2250']],
    HR: [['Zagreb', '10000'], ['Zagreb', '10000'], ['Zagreb', '10000'], ['Split', '21000'], ['Split', '21000'], ['Rijeka', '51000'], ['Osijek', '31000'], ['Zadar', '23000'], ['Pula', '52100'], ['Varaždin', '42000'], ['Šibenik', '22000'], ['Dubrovnik', '20000'], ['Karlovac', '47000']]
  };
  var STREETS = {
    SI: ['Cankarjeva ulica', 'Prešernova cesta', 'Tržaška cesta', 'Celovška cesta', 'Slovenska cesta', 'Glavni trg', 'Partizanska cesta', 'Kidričeva ulica', 'Ulica heroja Šaranoviča', 'Dunajska cesta'],
    HR: ['Ilica', 'Vukovarska ulica', 'Obala kneza Branimira', 'Korzo', 'Savska cesta', 'Frankopanska ulica', 'Zagrebačka cesta', 'Ulica Matije Gupca', 'Put Supavla', 'Riva']
  };
  var FIRST = {
    SI: ['Ana', 'Petra', 'Mojca', 'Urška', 'Tina', 'Katja', 'Matej', 'Rok', 'Gregor', 'Blaž', 'Jure', 'Tomaž', 'Andrej', 'Mateja', 'Polona', 'Barbara', 'Žiga', 'Primož', 'Nejc', 'Alenka', 'Špela', 'Klemen', 'Sara', 'Luka'],
    HR: ['Ivana', 'Marija', 'Petra', 'Ana', 'Lucija', 'Martina', 'Josip', 'Marko', 'Tomislav', 'Ante', 'Domagoj', 'Filip', 'Karlo', 'Nikolina', 'Dora', 'Mateo', 'Mia', 'Hrvoje', 'Katarina', 'Dario', 'Lana', 'Igor', 'Tena', 'Borna']
  };
  var LAST = {
    SI: ['Kranjc', 'Potočnik', 'Vidmar', 'Kos', 'Golob', 'Turk', 'Bizjak', 'Kralj', 'Hribar', 'Rozman', 'Mlakar', 'Kolar', 'Žagar', 'Petek', 'Furlan', 'Oblak', 'Zorman', 'Lesjak', 'Medved', 'Kavčič'],
    HR: ['Kovačević', 'Marić', 'Jurić', 'Knežević', 'Vuković', 'Perić', 'Matić', 'Pavlović', 'Tomić', 'Šarić', 'Lovrić', 'Grgić', 'Radić', 'Božić', 'Pavić', 'Barišić', 'Šimić', 'Galić', 'Mikulić', 'Bašić']
  };
  var TITLES = {
    Optician: ['Owner', 'Store manager', 'Optometrist', 'Purchasing'],
    Clinic: ['Medical director', 'Ophthalmologist', 'Head nurse', 'Procurement officer'],
    Corporate: ['HR manager', 'Benefits coordinator', 'Office manager', 'Health & safety officer', 'CFO'],
    Reseller: ['Sales director', 'Category manager', 'Purchasing manager'],
    Partner: ['Partnership manager', 'Marketing lead', 'Director']
  };

  var SUBJECTS = {
    lead: { call: ['Intro call', 'Discovery call'], email: ['Sent company presentation', 'Intro email with catalogue'], meeting: ['First meeting'], task: ['Research account', 'Find decision maker'] },
    qualified: { call: ['Needs assessment call', 'Call about volumes'], email: ['Sent price list', 'Shared references'], meeting: ['Discovery meeting', 'Showroom visit'], task: ['Prepare sample kit', 'Check credit limit'] },
    proposal: { call: ['Walk through proposal', 'Follow-up call on proposal'], email: ['Sent proposal', 'Sent revised quote'], meeting: ['Proposal presentation', 'Product demo on site'], task: ['Prepare proposal', 'Update price quote'] },
    negotiation: { call: ['Negotiation call', 'Call about payment terms'], email: ['Sent contract draft', 'Sent final offer'], meeting: ['Contract negotiation meeting', 'Final terms meeting'], task: ['Prepare contract draft', 'Get discount approval'] },
    account: { call: ['Quarterly check-in call', 'Service follow-up call'], email: ['Sent newsletter & novelties', 'Sent seasonal catalogue'], meeting: ['Account review meeting', 'Annual business review'], task: ['Update account plan', 'Check open invoices'] }
  };
  var TYPE_BY_STAGE = {
    lead: ['call', 'call', 'email', 'task'],
    qualified: ['meeting', 'call', 'email', 'task'],
    proposal: ['email', 'task', 'meeting', 'call'],
    negotiation: ['meeting', 'call', 'email', 'task'],
    account: ['call', 'meeting', 'email', 'task']
  };
  var NOTES = [
    'Prefers e-mail; purchasing decisions are made at the monthly management meeting.',
    'Interested in adding the contact-lens subscription for walk-in patients.',
    'Asked for a two-week trial of the frames display before committing.',
    'Budget approved — they need the final quote before the end of the month.',
    'A competitor offered 12% off; stress delivery speed and after-sales service.',
    'Very happy with delivery times last season.',
    'New purchasing manager since spring — re-introduce the programme.',
    'Wants co-branded leaflets for their waiting room.',
    'Requested 60-day payment terms; we offered 45.',
    'Asked about screen glasses for the call-centre team.',
    'Decision maker is the owner; store manager only collects offers.',
    'Would like quarterly reporting on vouchers redeemed.',
    'Mentioned possible expansion to a second location next year.',
    'Prefers meetings on Tuesday mornings.',
    'Samples delivered; feedback expected after the staff meeting.',
    'Keep an eye on stock of the bestselling sunglasses models for them.'
  ];

  // ── helpers ────────────────────────────────────────────────────────────────
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(ms) { var d = new Date(ms); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function localDT(ms) { var d = new Date(ms); return ymd(ms) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function startOfDay(ms) { var d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function addDaysMs(ms, n) { var d = new Date(ms); d.setDate(d.getDate() + n); return d.getTime(); }
  function slug(s) {
    return String(s).replace(/[Đđ]/g, 'dj').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }
  function weekdayShift(ms) { // move Saturday/Sunday to Monday, keep the time of day
    var d = new Date(ms), w = d.getDay();
    if (w === 6) return addDaysMs(ms, -1);
    if (w === 0) return addDaysMs(ms, 1);
    return ms;
  }

  // ── generator ──────────────────────────────────────────────────────────────
  function generate(nowMs) {
    var R = mulberry32(SEED);
    function rnd(a, b) { return a + Math.floor(R() * (b - a + 1)); }
    function pick(arr) { return arr[Math.floor(R() * arr.length)]; }
    function chance(p) { return R() < p; }
    function at(dayMs, hour, minute) { var d = new Date(dayMs); d.setHours(hour, minute || 0, 0, 0); return d.getTime(); }

    var today = startOfDay(nowMs);
    var seq = { company: 0, contact: 0, deal: 0, activity: 0, note: 0 };
    var companies = [], contacts = [], deals = [], activities = [], notes = [];
    var usedNames = {}, usedEmails = {};

    function ownerFor(seg, country) {
      if (seg === 'Corporate' || seg === 'Partner') return chance(0.6) ? 'u5' : (country === 'SI' ? 'u1' : 'u2');
      if (seg === 'Optician' || seg === 'Clinic') return chance(0.62) ? (country === 'SI' ? 'u3' : 'u4') : (country === 'SI' ? 'u1' : 'u2');
      return chance(0.7) ? (country === 'SI' ? 'u1' : 'u2') : 'u5';
    }
    function companyName(seg, country) {
      for (var i = 0; i < 40; i++) {
        var n = pick(TPL[country][seg]).replace('{w}', pick(W[country]));
        if (!usedNames[n]) { usedNames[n] = 1; return n; }
      }
      var f = pick(TPL[country][seg]).replace('{w}', pick(W[country]) + ' ' + (seq.company + 1));
      usedNames[f] = 1; return f;
    }
    function phone(country, mobile) {
      if (country === 'SI') return mobile ? '+386 4' + rnd(0, 1) + ' 555 ' + pad(rnd(0, 99)) + pad(rnd(0, 9)) : '+386 ' + pick(['1', '2', '3', '4', '5', '7']) + ' 555 ' + pad(rnd(0, 99)) + ' ' + pad(rnd(0, 99));
      return mobile ? '+385 9' + pick(['1', '2', '5', '8']) + ' 555 ' + pad(rnd(0, 99)) + pad(rnd(0, 99)) : '+385 ' + pick(['1', '21', '51', '31']) + ' 555 ' + pad(rnd(0, 99)) + pad(rnd(0, 99));
    }
    function digits(n) { var s = ''; for (var i = 0; i < n; i++) s += rnd(0, 9); return s; }

    function makeCompany(seg, country, fixedName) {
      var name = fixedName || companyName(seg, country);
      if (fixedName) usedNames[fixedName] = 1;
      var city = pick(CITIES[country]);
      var recent = chance(0.12);
      var created = recent ? addDaysMs(today, -rnd(40, 220)) : addDaysMs(today, -rnd(548, 760));
      var s = slug(name.replace(/\b(d\.o\.o\.|d\.d\.|s\.p\.|j\.d\.o\.o\.)/g, ''));
      var c = {
        id: ++seq.company, name: name, segment: seg, country: country,
        city: city[0], postcode: city[1], address: pick(STREETS[country]) + ' ' + rnd(1, 120),
        phone: phone(country, false), email: 'info.' + s + '@example.com', website: 'www.' + s + '.example',
        vat: country + digits(country === 'SI' ? 8 : 11),
        employees: seg === 'Corporate' ? rnd(4, 60) * 10 : seg === 'Optician' ? rnd(2, 12) : seg === 'Clinic' ? rnd(6, 45) : rnd(5, 80),
        source: pick(SOURCES), owner: ownerFor(seg, country),
        createdAt: at(created, rnd(8, 16), rnd(0, 59)), updatedAt: 0
      };
      c.updatedAt = c.createdAt;
      companies.push(c);
      return c;
    }

    // 80 companies: the first one is fixed, the rest follow a segment plan in shuffled order.
    makeCompany('Clinic', 'SI', 'Očesna klinika Lipa d.o.o.');
    var plan = [];
    [['Optician', 30], ['Clinic', 13], ['Corporate', 18], ['Reseller', 10], ['Partner', 8]].forEach(function (p) {
      for (var i = 0; i < p[1]; i++) plan.push(p[0]);
    });
    for (var i = plan.length - 1; i > 0; i--) { var j = Math.floor(R() * (i + 1)); var t = plan[i]; plan[i] = plan[j]; plan[j] = t; }
    plan.forEach(function (seg) { makeCompany(seg, chance(0.55) ? 'SI' : 'HR'); });

    // Contacts
    function makeContact(company, country) {
      var fn = pick(FIRST[country]), ln = pick(LAST[country]);
      var base = slug(fn) + '.' + slug(ln), email = base + '@example.com', k = 2;
      while (usedEmails[email]) { email = base + k + '@example.com'; k++; }
      usedEmails[email] = 1;
      var created = company ? company.createdAt + rnd(0, 60) * DAY : addDaysMs(today, -rnd(30, 400));
      if (created > nowMs) created = nowMs - DAY;
      var ct = {
        id: ++seq.contact, firstName: fn, lastName: ln,
        title: company ? pick(TITLES[company.segment]) : pick(['Independent consultant', 'Optometrist (freelance)', 'Procurement advisor']),
        email: email, phone: phone(country, true), companyId: company ? company.id : null,
        owner: company ? company.owner : pick(OWNERS).id, createdAt: created, updatedAt: created
      };
      contacts.push(ct);
      return ct;
    }
    var CT_RANGE = { Optician: [2, 3], Clinic: [2, 3], Corporate: [2, 4], Reseller: [2, 3], Partner: [1, 3] };
    var byCompany = {};
    companies.forEach(function (c) {
      var r = CT_RANGE[c.segment], n = rnd(r[0], r[1]);
      byCompany[c.id] = [];
      for (var i = 0; i < n; i++) byCompany[c.id].push(makeContact(c, c.country));
    });
    for (var u = 0; u < 6; u++) makeContact(null, chance(0.5) ? 'SI' : 'HR');

    // Activities helper
    function addActivity(o) {
      var a = {
        id: ++seq.activity, type: o.type, subject: o.subject, due: localDT(o.due),
        duration: o.type === 'meeting' ? pick([30, 45, 60, 90]) : o.type === 'call' ? pick([15, 15, 30]) : 0,
        done: !!o.done, doneAt: o.done ? Math.min(nowMs, o.due + rnd(0, 3) * 3600e3) : null,
        owner: o.owner, companyId: o.companyId || null, contactId: o.contactId || null, dealId: o.dealId || null,
        notes: o.notes || '', createdAt: Math.min(o.due - rnd(1, 10) * DAY, nowMs)
      };
      activities.push(a);
      return a;
    }
    function bizTime(lo, hi) { // random business-hours timestamp between two ms values
      if (hi <= lo) hi = lo + DAY;
      var day = startOfDay(lo + R() * (hi - lo));
      var ms = weekdayShift(at(day, rnd(8, 16), pick([0, 15, 30, 45])));
      return ms;
    }

    // Deals
    var DEAL_RANGE = { Optician: [2, 5], Clinic: [2, 4], Corporate: [2, 5], Reseller: [3, 6], Partner: [2, 3] };
    var LOSS = [0.16, 0.13, 0.15, 0.2];
    var OPEN_STAGES = ['lead', 'qualified', 'proposal', 'negotiation'];
    var earliest = addDaysMs(today, -545);

    function roundQty(q) { return q >= 100 ? Math.round(q / 10) * 10 : q >= 20 ? Math.round(q / 5) * 5 : q; }
    function makeLine(p) {
      return { productId: p.id, qty: roundQty(rnd(p.qty[0], p.qty[1])), price: p.price, discount: pick([0, 0, 0, 5, 5, 10, 15]) };
    }

    companies.forEach(function (c) {
      var r = DEAL_RANGE[c.segment], n = rnd(r[0], r[1]);
      var pool = PRODUCTS.filter(function (p) { return p.seg.indexOf(c.segment) >= 0; });
      var cts = byCompany[c.id];
      for (var k = 0; k < n; k++) {
        var lo = Math.max(c.createdAt + 3 * DAY, earliest), hi = nowMs - DAY;
        if (hi <= lo) continue;
        var start = chance(0.33) ? Math.max(lo, hi - 100 * DAY + R() * 100 * DAY) : lo + R() * (hi - lo);
        start = weekdayShift(at(startOfDay(start), rnd(8, 16), pick([0, 15, 30, 45])));
        if (start > nowMs) start = nowMs - 2 * 3600e3;
        var main = pick(pool), lines = [makeLine(main)];
        if (chance(0.35) && pool.length > 1) {
          var second = pick(pool.filter(function (p) { return p.id !== main.id; }));
          lines.push(makeLine(second));
        }
        var title = main.short;
        if (main.id === 'EYE-EXAM') title += ' (' + lines[0].qty + ' staff)';
        else if (chance(0.3)) title += ' renewal';
        else if (main.id === 'SUN-SEAS') title = pick(['Spring', 'Summer']) + ' sunglasses assortment';
        var contact = cts.length ? pick(cts) : null;
        var owner = chance(0.85) ? c.owner : pick(OWNERS).id;
        var d = {
          id: ++seq.deal, title: title, companyId: c.id, contactId: contact ? contact.id : null, owner: owner,
          stage: 'lead', lines: lines, expectedClose: '', closedAt: null, lostReason: null,
          createdAt: start, updatedAt: start, stageEnteredAt: start,
          history: [{ from: null, to: 'lead', at: start, by: owner }]
        };
        // walk the funnel until today
        var idx = 0, t0 = start, periods = [];
        for (;;) {
          var dur = rnd(3, 21) + (chance(0.25) ? rnd(10, 40) : 0);
          var t1 = weekdayShift(at(addDaysMs(startOfDay(t0), dur), rnd(8, 17), pick([0, 15, 30, 45])));
          if (t1 > nowMs) { periods.push([OPEN_STAGES[idx], t0, nowMs, true]); break; }
          periods.push([OPEN_STAGES[idx], t0, t1, false]);
          if (chance(LOSS[idx])) {
            d.history.push({ from: d.stage, to: 'lost', at: t1, by: owner });
            d.stage = 'lost'; d.lostReason = pick(LOST_REASONS.slice(0, 6)); d.closedAt = ymd(t1); d.stageEnteredAt = t1; break;
          }
          idx++;
          var next = idx === 4 ? 'won' : OPEN_STAGES[idx];
          d.history.push({ from: d.stage, to: next, at: t1, by: owner });
          d.stage = next; d.stageEnteredAt = t1; t0 = t1;
          if (next === 'won') { d.closedAt = ymd(t1); break; }
        }
        d.updatedAt = d.stageEnteredAt;
        if (d.closedAt) {
          d.expectedClose = ymd(addDaysMs(startOfDay(d.stageEnteredAt), rnd(-12, 18)));
        } else {
          var stIdx = OPEN_STAGES.indexOf(d.stage);
          d.expectedClose = chance(0.12) ? ymd(addDaysMs(today, -rnd(1, 15))) : ymd(addDaysMs(today, rnd(5, 25 + (4 - stIdx) * 22)));
        }
        deals.push(d);

        // activities across the stage periods
        periods.forEach(function (p) {
          var cnt = 1 + (chance(0.5) ? 1 : 0);
          for (var a = 0; a < cnt; a++) {
            var due = bizTime(p[1], p[2]);
            if (due > nowMs) due = bizTime(p[1], nowMs - 3600e3);
            if (due > nowMs) due = nowMs - rnd(1, 6) * 3600e3;
            var type = pick(TYPE_BY_STAGE[p[0]]);
            var overdue = p[3] && chance(0.04);
            addActivity({ type: type, subject: pick(SUBJECTS[p[0]][type]), due: due, done: !overdue, owner: owner, companyId: c.id, contactId: contact && chance(0.85) ? contact.id : (cts.length ? pick(cts).id : null), dealId: d.id });
          }
        });
        if (!d.closedAt) { // next step planned
          var nt = pick(TYPE_BY_STAGE[d.stage]);
          addActivity({ type: nt, subject: pick(SUBJECTS[d.stage][nt]), due: weekdayShift(at(addDaysMs(today, rnd(1, 14)), rnd(8, 16), pick([0, 30]))), done: false, owner: owner, companyId: c.id, contactId: contact ? contact.id : null, dealId: d.id });
        }
        if (chance(0.35)) {
          notes.push({ id: ++seq.note, entity: 'deal', entityId: d.id, text: pick(NOTES), at: Math.min(nowMs, start + rnd(1, 20) * DAY), owner: owner });
        }
      }
      // account-management activities (no deal)
      var acc = rnd(1, 3);
      for (var m = 0; m < acc; m++) {
        var ty = pick(TYPE_BY_STAGE.account);
        addActivity({ type: ty, subject: pick(SUBJECTS.account[ty]), due: bizTime(Math.max(c.createdAt, earliest), nowMs - DAY), done: true, owner: c.owner, companyId: c.id, contactId: cts.length ? pick(cts).id : null });
      }
      if (chance(0.35)) {
        var nn = rnd(1, 2);
        for (var q = 0; q < nn; q++) notes.push({ id: ++seq.note, entity: 'company', entityId: c.id, text: pick(NOTES), at: Math.min(nowMs - DAY, c.createdAt + rnd(5, 400) * DAY), owner: c.owner });
      }
    });

    // Contact notes
    contacts.forEach(function (ct) {
      if (chance(0.12)) notes.push({ id: ++seq.note, entity: 'contact', entityId: ct.id, text: pick(NOTES), at: Math.min(nowMs - DAY, ct.createdAt + rnd(5, 300) * DAY), owner: ct.owner });
    });

    // Today's agenda and a few overdue items for every rep
    OWNERS.forEach(function (o) {
      var myOpen = deals.filter(function (d) { return d.owner === o.id && !d.closedAt; });
      var n = rnd(3, 5), hours = [8, 9, 10, 11, 13, 14, 15, 16];
      for (var i = 0; i < n; i++) {
        var d = myOpen.length ? pick(myOpen) : null;
        var st = d ? d.stage : 'account';
        var ty = pick(TYPE_BY_STAGE[st]);
        var due = at(today, hours.splice(Math.floor(R() * hours.length), 1)[0], pick([0, 30]));
        var comp = d ? d.companyId : pick(companies).id;
        addActivity({ type: ty, subject: pick(SUBJECTS[st][ty]), due: due, done: due < nowMs && chance(0.5), owner: o.id, companyId: comp, contactId: d ? d.contactId : null, dealId: d ? d.id : null });
      }
      var od = rnd(1, 3);
      for (var j = 0; j < od; j++) {
        var d2 = myOpen.length ? pick(myOpen) : null;
        var st2 = d2 ? d2.stage : 'account';
        var ty2 = pick(TYPE_BY_STAGE[st2]);
        addActivity({ type: ty2, subject: pick(SUBJECTS[st2][ty2]), due: weekdayShift(at(addDaysMs(today, -rnd(1, 6)), rnd(8, 16), 0)), done: false, owner: o.id, companyId: d2 ? d2.companyId : pick(companies).id, contactId: d2 ? d2.contactId : null, dealId: d2 ? d2.id : null });
      }
    });
    // an overdue item may have been pushed to a weekday that is today or later — keep it in the past
    activities.forEach(function (a) { if (!a.done && a.createdAt > nowMs) a.createdAt = nowMs - DAY; });

    // A few deliberate duplicates so the "Duplicates" page has something to merge (added last, so all
    // earlier records stay exactly the same as before).
    (function addDuplicates() {
      var opt = companies.filter(function (c) { return c.segment === 'Optician' && byCompany[c.id] && byCompany[c.id].length; });
      if (opt.length < 4) return;
      var base = opt[2];
      var dupe = Object.assign({}, base, {
        id: ++seq.company, name: base.name.toUpperCase().replace(/\s+(D\.O\.O\.|S\.P\.|J\.D\.O\.O\.)$/, ', $1').replace(/D\.O\.O\.$/, 'd.o.o.').replace(/S\.P\.$/, 's.p.'),
        phone: '', website: '', owner: base.owner === 'u5' ? 'u1' : 'u5', source: 'Website enquiry',
        createdAt: addDaysMs(today, -rnd(10, 40)), updatedAt: addDaysMs(today, -rnd(1, 9))
      });
      companies.push(dupe); byCompany[dupe.id] = [];
      var p0 = byCompany[base.id][0];
      contacts.push({ id: ++seq.contact, firstName: p0.firstName, lastName: p0.lastName, title: p0.title, email: p0.email, phone: '', companyId: dupe.id, owner: dupe.owner, createdAt: dupe.createdAt, updatedAt: dupe.createdAt });
      addActivity({ type: 'call', subject: 'Website enquiry — call back', due: weekdayShift(at(addDaysMs(today, -rnd(2, 8)), 11, 0)), done: true, owner: dupe.owner, companyId: dupe.id, contactId: seq.contact });

      var base2 = opt[7] || opt[3], word = base2.name.split(' ')[1] || '';
      if (word.length > 4) {
        var typo = Object.assign({}, base2, {
          id: ++seq.company, name: base2.name.replace(word, word.slice(0, -2) + word.slice(-1)), vat: '', email: '',
          createdAt: addDaysMs(today, -rnd(20, 60)), updatedAt: addDaysMs(today, -rnd(3, 15))
        });
        companies.push(typo); byCompany[typo.id] = [];
        notes.push({ id: ++seq.note, entity: 'company', entityId: typo.id, text: 'Added from a trade-fair business card.', at: typo.createdAt + DAY, owner: typo.owner });
      }
      // the same person twice at one company (work and private email)
      var corp = companies.filter(function (c) { return c.segment === 'Corporate' && byCompany[c.id] && byCompany[c.id].length; })[1];
      if (corp) {
        var p1 = byCompany[corp.id][0];
        contacts.push({ id: ++seq.contact, firstName: p1.firstName, lastName: p1.lastName, title: '', email: slug(p1.firstName) + '.' + slug(p1.lastName) + '.private@example.com', phone: p1.phone, companyId: corp.id, owner: corp.owner, createdAt: addDaysMs(today, -rnd(5, 30)), updatedAt: addDaysMs(today, -rnd(1, 4)) });
      }
    })();

    // company/contact updatedAt = latest touch
    var lastTouch = {};
    activities.forEach(function (a) { if (a.done && a.companyId) lastTouch[a.companyId] = Math.max(lastTouch[a.companyId] || 0, a.doneAt || 0); });
    companies.forEach(function (c) { c.updatedAt = Math.max(c.updatedAt, Math.min(nowMs, lastTouch[c.id] || 0)); });

    return {
      version: 1, generatedAt: nowMs, seq: seq,
      companies: companies, contacts: contacts, deals: deals, activities: activities, notes: notes
    };
  }

  global.CRMDATA = {
    OWNERS: OWNERS, STAGES: STAGES, SEGMENTS: SEGMENTS, SEGMENT_TONE: SEGMENT_TONE, COUNTRIES: COUNTRIES,
    PRODUCTS: PRODUCTS, LOST_REASONS: LOST_REASONS, ACT_TYPES: ACT_TYPES, SOURCES: SOURCES,
    generate: generate
  };
})(window);
