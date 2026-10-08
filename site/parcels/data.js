/* Parcels & COD demo: deterministic, entirely fictional dataset.
 * window.ParcelsData.generate(anchorTs) builds ~1,500 parcels over the 60 days before the anchor
 * ('YYYY-MM-DDTHH:MM', Europe/Ljubljana wall-clock time) for 9 carrier accounts in SI / HR / IT, each
 * with a full scan history, plus the carriers' cash-on-delivery (COD) payout batches and the bank
 * statement lines they arrived on. The same anchor always gives exactly the same data.
 * Customers, e-mails (@example.com), order numbers, tracking numbers, batch references and IBANs are
 * invented. Timestamps are naive local strings; date maths uses UTC internally so DST never shifts a day. */
(function () {
  'use strict';

  var VERSION = 1;

  // ── small helpers ─────────────────────────────────────────────────────────
  function pad(n, w) { var s = String(n); while (s.length < (w || 2)) s = '0' + s; return s; }
  function r2(n) { return Math.round(n * 100) / 100; }
  function ms(ts) { return Date.UTC(+ts.slice(0, 4), +ts.slice(5, 7) - 1, +ts.slice(8, 10), +(ts.slice(11, 13) || 0), +(ts.slice(14, 16) || 0)); }
  function tsOf(t) { var d = new Date(t); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + 'T' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()); }
  function ymdOf(t) { return tsOf(t).slice(0, 10); }
  function addDays(s, n) { return ymdOf(ms(s.slice(0, 10)) + n * 864e5); }
  function dow(s) { return new Date(ms(s.slice(0, 10))).getUTCDay(); } // 0 = Sunday
  function isWork(s) { var d = dow(s); return d !== 0 && d !== 6; }
  function addWork(s, n) {
    var d = s.slice(0, 10), step = n < 0 ? -1 : 1, left = Math.abs(n);
    while (left > 0) { d = addDays(d, step); if (isWork(d)) left--; }
    return d;
  }
  function nextWork(s) { return addWork(s, 1); }
  /** working days strictly after a up to and including b (0 when b <= a) */
  function wdBetween(a, b) {
    a = a.slice(0, 10); b = b.slice(0, 10);
    if (b <= a) return 0;
    var n = 0, d = a, guard = 0;
    while (d < b && guard++ < 400) { d = addDays(d, 1); if (isWork(d)) n++; }
    return n;
  }
  function daysBetween(a, b) { return Math.round((ms(b.slice(0, 10)) - ms(a.slice(0, 10))) / 864e5); }
  function T(day, h, m) { return day + 'T' + pad(h) + ':' + pad(m); }
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function ascii(s) { return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D'); }
  // UPU S10 check digit (used by the postal tracking numbers)
  function s10check(d8) {
    var w = [8, 6, 4, 2, 3, 5, 9, 7], s = 0;
    for (var i = 0; i < 8; i++) s += +d8[i] * w[i];
    var c = 11 - (s % 11);
    return c === 10 ? 0 : c === 11 ? 5 : c;
  }

  // ── reference data ───────────────────────────────────────────────────────
  // fee = pct * COD + fix per parcel, deducted from the payout. payDays = weekdays the carrier pays out
  // (1 = Monday); lag = working days between delivery and the earliest payout; bankLag = working days
  // until the transfer is on our bank statement. sla = promised working days from pickup to first attempt.
  var CARRIERS = [
    { id: 'GLS-SI', name: 'GLS SI', family: 'GLS', country: 'SI', countries: ['SI'], k: 1, sla: 1, base: 3.25, pm: 0.8, td: [[1, .86], [2, .12], [3, .02]],
      payDays: [2, 5], lag: 2, bankLag: 1, pct: 0.008, fix: 0, ref: 'GLSSI-CP', terms: 'Tue + Fri, 0.8 % of COD',
      url: 'https://gls-group.com/SI/sl/sledenje-paketov?match=', hub: 'GLS hub Ljubljana', pp: 'GLS ParcelShop' },
    { id: 'GLS-HR', name: 'GLS HR', family: 'GLS', country: 'HR', countries: ['HR'], k: 2, sla: 2, base: 3.60, pm: 1.0, td: [[1, .60], [2, .32], [3, .08]],
      payDays: [3], lag: 2, bankLag: 1, pct: 0.010, fix: 0, ref: 'GLSHR-POU', terms: 'Wed, 1.0 % of COD',
      url: 'https://gls-group.com/HR/hr/pracenje-paketa?match=', hub: 'GLS hub Zagreb', pp: 'GLS ParcelShop' },
    { id: 'GLS-IT', name: 'GLS IT', family: 'GLS', country: 'IT', countries: ['IT'], k: 3, sla: 3, base: 6.40, pm: 1.1, td: [[1, .30], [2, .45], [3, .18], [4, .07]],
      payDays: [1], lag: 3, bankLag: 1, pct: 0.012, fix: 0.5, ref: 'GLSIT-CTR', terms: 'Mon, 1.2 % + 0,50 € per parcel',
      url: 'https://www.gls-italy.com/it/servizi-per-destinatari/ricerca-spedizione?match=', hub: 'GLS sede Trieste', pp: 'GLS Shop' },
    { id: 'DPD-SI', name: 'DPD SI', family: 'DPD', country: 'SI', countries: ['SI'], k: 4, sla: 1, base: 3.45, pm: 1.0, td: [[1, .80], [2, .17], [3, .03]],
      payDays: [1, 4], lag: 2, bankLag: 1, pct: 0.009, fix: 0, ref: 'DPDSI-OD', terms: 'Mon + Thu, 0.9 % of COD',
      url: 'https://www.dpdgroup.com/si/mydpd/my-parcels/track?parcelNumber=', hub: 'DPD depot Ljubljana', pp: 'DPD Pickup point' },
    { id: 'DPD-HR', name: 'DPD HR', family: 'DPD', country: 'HR', countries: ['HR'], k: 5, sla: 2, base: 3.80, pm: 1.25, td: [[1, .52], [2, .36], [3, .12]],
      payDays: [4], lag: 3, bankLag: 1, pct: 0.010, fix: 0, ref: 'DPDHR-OTK', terms: 'Thu, 1.0 % of COD',
      url: 'https://www.dpdgroup.com/hr/mydpd/my-parcels/track?parcelNumber=', hub: 'DPD depot Zagreb', pp: 'DPD Pickup point' },
    { id: 'POSTA-SI', name: 'Pošta Slovenije', family: 'Post', country: 'SI', countries: ['SI'], k: 6, sla: 2, base: 3.10, pm: 1.1, td: [[1, .62], [2, .30], [3, .08]],
      payDays: [1, 3, 5], lag: 3, bankLag: 1, pct: 0, fix: 0.95, ref: 'PS-ODK', terms: 'Mon + Wed + Fri, 0,95 € per parcel',
      url: 'https://sledenje.posta.si/?q=', hub: 'Logistics centre Ljubljana', pp: 'post office', post: true },
    { id: 'HP', name: 'HP Ekspres', family: 'Post', country: 'HR', countries: ['HR'], k: 7, sla: 2, base: 3.05, pm: 1.35, td: [[1, .45], [2, .38], [3, .13], [4, .04]],
      payDays: [2], lag: 3, bankLag: 1, pct: 0, fix: 0.8, ref: 'HPE-OTK', terms: 'Tue, 0,80 € per parcel',
      url: 'https://posiljka.posta.hr/hr/tracking/trackingdata?barcode=', hub: 'Sorting centre Velika Gorica', pp: 'post office', post: true },
    { id: 'BOXNOW', name: 'BOX NOW', family: 'BOX NOW', country: 'SI+HR', countries: ['SI', 'HR'], k: 8, sla: 2, base: 2.70, pm: 0.7, td: [[1, .55], [2, .38], [3, .07]],
      payDays: [5], lag: 3, bankLag: 2, pct: 0.015, fix: 0, ref: 'BXN-PAY', terms: 'Fri, 1.5 % of COD (card payment at the locker)',
      url: 'https://boxnow.hr/en/track?parcel=', hub: 'BOX NOW hub', locker: true },
    { id: 'POSTE-IT', name: 'Poste Italiane / SDA', family: 'Poste', country: 'IT', countries: ['IT'], k: 9, sla: 3, base: 5.90, pm: 1.6, td: [[2, .30], [3, .35], [4, .22], [5, .13]],
      payDays: [3], lag: 5, bankLag: 2, pct: 0, fix: 2.0, ref: 'PI-CONTR', terms: 'Wed, 2,00 € per parcel (contrassegno)',
      url: 'https://www.poste.it/cerca/index.html#/risultati-spedizioni/', hub: 'SDA hub Trieste', pp: 'post office', post: true }
  ];
  var CARRIER = {}; CARRIERS.forEach(function (c) { CARRIER[c.id] = c; });

  var SHOPS = [
    { id: 'WEB-SI', name: 'Webshop SI', country: 'SI', web: true, w: .62 },
    { id: 'ST-LJ', name: 'Store Ljubljana', country: 'SI', w: .13 },
    { id: 'ST-MB', name: 'Store Maribor', country: 'SI', w: .10 },
    { id: 'ST-CE', name: 'Store Celje', country: 'SI', w: .08 },
    { id: 'ST-KP', name: 'Store Koper', country: 'SI', w: .07 },
    { id: 'WEB-HR', name: 'Webshop HR', country: 'HR', web: true, w: .65 },
    { id: 'ST-ZG', name: 'Store Zagreb', country: 'HR', w: .15 },
    { id: 'ST-SP', name: 'Store Split', country: 'HR', w: .11 },
    { id: 'ST-RI', name: 'Store Rijeka', country: 'HR', w: .09 },
    { id: 'WEB-IT', name: 'Webshop IT', country: 'IT', web: true, w: 1 }
  ];
  var COUNTRIES = { SI: 'Slovenia', HR: 'Croatia', IT: 'Italy' };
  // our (fictional) receiving accounts for COD payouts
  var ACCOUNTS = { SI: 'SI56 9900 0001 2345 678', HR: 'HR17 9990 0001 1023 4567 8', IT: 'IT60 X099 9900 0000 0001 2345 678' };

  var CITIES = {
    SI: [['Ljubljana', '1000', 'Ljubljana', 20], ['Maribor', '2000', 'Maribor', 9], ['Celje', '3000', 'Celje', 5], ['Kranj', '4000', 'Ljubljana', 5], ['Koper', '6000', 'Koper', 4],
      ['Novo mesto', '8000', 'Novo mesto', 4], ['Velenje', '3320', 'Celje', 3], ['Ptuj', '2250', 'Maribor', 3], ['Nova Gorica', '5000', 'Koper', 3], ['Murska Sobota', '9000', 'Maribor', 3],
      ['Domžale', '1230', 'Ljubljana', 3], ['Kamnik', '1241', 'Ljubljana', 2], ['Škofja Loka', '4220', 'Ljubljana', 2], ['Izola', '6310', 'Koper', 2], ['Trbovlje', '1420', 'Celje', 2]],
    HR: [['Zagreb', '10000', 'Zagreb', 22], ['Split', '21000', 'Split', 9], ['Rijeka', '51000', 'Rijeka', 7], ['Osijek', '31000', 'Osijek', 5], ['Zadar', '23000', 'Split', 4],
      ['Pula', '52100', 'Rijeka', 3], ['Varaždin', '42000', 'Zagreb', 3], ['Šibenik', '22000', 'Split', 2], ['Karlovac', '47000', 'Zagreb', 2], ['Dubrovnik', '20000', 'Split', 2],
      ['Slavonski Brod', '35000', 'Osijek', 2], ['Velika Gorica', '10410', 'Zagreb', 3]],
    IT: [['Milano', '20121', 'Milano', 14], ['Roma', '00184', 'Roma', 12], ['Torino', '10121', 'Torino', 6], ['Bologna', '40121', 'Bologna', 5], ['Firenze', '50122', 'Bologna', 4],
      ['Napoli', '80133', 'Napoli', 5], ['Verona', '37121', 'Verona', 4], ['Padova', '35121', 'Verona', 4], ['Trieste', '34121', 'Verona', 4], ['Udine', '33100', 'Verona', 3],
      ['Genova', '16121', 'Torino', 3], ['Bari', '70121', 'Napoli', 3]]
  };
  var NAMES = {
    SI: { f: ['Ana', 'Maja', 'Nina', 'Eva', 'Petra', 'Mojca', 'Tina', 'Katja', 'Urška', 'Špela', 'Sara', 'Neža', 'Luka', 'Jan', 'Žiga', 'Matej', 'Rok', 'Gregor', 'Andrej', 'Marko', 'Tomaž', 'Blaž', 'Nejc', 'Primož'],
      l: ['Novak', 'Horvat', 'Kovačič', 'Krajnc', 'Zupančič', 'Potočnik', 'Kovač', 'Mlakar', 'Kos', 'Vidmar', 'Golob', 'Turk', 'Kralj', 'Bizjak', 'Hribar', 'Korošec', 'Rozman', 'Kastelic', 'Oblak', 'Žagar', 'Petek', 'Kolar'] },
    HR: { f: ['Ivana', 'Petra', 'Marija', 'Lucija', 'Ana', 'Mia', 'Katarina', 'Iva', 'Martina', 'Josip', 'Ivan', 'Luka', 'Marko', 'Tomislav', 'Filip', 'Matej', 'Ante', 'Stjepan', 'Domagoj', 'Karlo'],
      l: ['Horvat', 'Kovačević', 'Babić', 'Marić', 'Jurić', 'Novak', 'Knežević', 'Vuković', 'Marković', 'Petrović', 'Matić', 'Tomić', 'Pavlović', 'Božić', 'Blažević', 'Grgić', 'Perić', 'Radić', 'Šarić', 'Lovrić'] },
    IT: { f: ['Giulia', 'Francesca', 'Chiara', 'Sara', 'Martina', 'Elena', 'Valentina', 'Federica', 'Marco', 'Luca', 'Andrea', 'Matteo', 'Alessandro', 'Davide', 'Lorenzo', 'Simone', 'Paolo'],
      l: ['Rossi', 'Russo', 'Ferrari', 'Esposito', 'Bianchi', 'Romano', 'Colombo', 'Ricci', 'Marino', 'Greco', 'Bruno', 'Gallo', 'Conti', 'De Luca', 'Costa', 'Giordano', 'Mancini', 'Rizzo', 'Lombardi', 'Moretti'] }
  };
  // [name, min price, max price, kg, max qty, weight in webshop orders, weight in store orders]
  var ITEMS = [
    ['Prescription glasses (frame + lenses)', 89, 329, 0.36, 1, 10, 62],
    ['Optical frame', 49, 189, 0.30, 1, 9, 10],
    ['Sunglasses', 39, 199, 0.30, 1, 16, 12],
    ['Monthly contact lenses, 6 pcs', 19.9, 39.9, 0.10, 4, 26, 6],
    ['Daily contact lenses, 90 pcs', 39.9, 69.9, 0.26, 3, 20, 5],
    ['Lens solution 360 ml', 7.9, 14.9, 0.42, 3, 14, 3],
    ['Glasses case and cloth', 5.9, 12.9, 0.08, 1, 5, 2]
  ];
  var CARRIER_MIX = {
    SI: [['GLS-SI', .36], ['DPD-SI', .22], ['POSTA-SI', .26], ['BOXNOW', .16]],
    HR: [['GLS-HR', .34], ['DPD-HR', .20], ['HP', .26], ['BOXNOW', .20]],
    IT: [['GLS-IT', .62], ['POSTE-IT', .38]]
  };
  var LOCKER_SPOTS = { SI: ['Center', 'Sever', 'Jug', 'Postaja', 'Tržnica', 'Park'], HR: ['Centar', 'Sjever', 'Jug', 'Kolodvor', 'Tržnica', 'Park'] };
  var COD_RATE = { SI: 0.44, HR: 0.47, IT: 0.16 };
  var TEAM = [
    { id: 'maja', name: 'Maja Kralj', role: 'Customer service SI' },
    { id: 'luka', name: 'Luka Zupan', role: 'Customer service SI' },
    { id: 'ivana', name: 'Ivana Babić', role: 'Customer service HR' },
    { id: 'karlo', name: 'Karlo Perić', role: 'Customer service HR' },
    { id: 'giulia', name: 'Giulia Conti', role: 'Customer service IT' },
    { id: 'tina', name: 'Tina Golob', role: 'Finance' },
    { id: 'marko', name: 'Marko Jurić', role: 'Logistics' }
  ];

  // ── generator ────────────────────────────────────────────────────────────
  function generate(anchor) {
    var R = rng(0xC0D5A1);
    function int(a, b) { return a + Math.floor(R() * (b - a + 1)); }
    function pick(a) { return a[Math.floor(R() * a.length)]; }
    function chance(p) { return R() < p; }
    function wpick(list, wi) { var tot = 0, i; for (i = 0; i < list.length; i++) tot += list[i][wi]; var x = R() * tot; for (i = 0; i < list.length; i++) { x -= list[i][wi]; if (x <= 0) return list[i]; } return list[list.length - 1]; }
    function digits(n) { var s = ''; for (var i = 0; i < n; i++) s += int(0, 9); return s; }

    var anchorDay = anchor.slice(0, 10), anchorMs = ms(anchor);
    var start = addDays(anchorDay, -59);
    var used = {};
    function uniq(fn) { var t; do { t = fn(); } while (used[t]); used[t] = 1; return t; }
    function tracking(c, country) {
      return uniq(function () {
        switch (c.id) {
          case 'GLS-SI': return '9' + digits(10);
          case 'GLS-HR': return '7' + digits(10);
          case 'GLS-IT': return pick(['TS', 'VR', 'MI', 'BO']) + digits(9);
          case 'DPD-SI': return '0' + pick(['6', '7']) + digits(12);
          case 'DPD-HR': return '0' + pick(['8', '9']) + digits(12);
          case 'POSTA-SI': { var a = digits(8); return pick(['PE', 'PC']) + a + s10check(a) + 'SI'; }
          case 'HP': { var b = digits(8); return pick(['CE', 'CH']) + b + s10check(b) + 'HR'; }
          case 'BOXNOW': return (country === 'SI' ? '91' : '92') + digits(8);
          default: return '3UW' + digits(10);
        }
      });
    }
    var orderSeq = { SI: 1041870, HR: 2063410, IT: 3017250 };
    var parcels = [];

    for (var day = start; day <= anchorDay; day = addDays(day, 1)) {
      var d = dow(day), n = d === 0 ? int(2, 5) : d === 6 ? int(4, 8) : int(29, 39);
      for (var j = 0; j < n; j++) {
        var country = wpick([['SI', .45], ['HR', .40], ['IT', .15]], 1)[0];
        var shop = wpick(SHOPS.filter(function (s) { return s.country === country; }).map(function (s) { return [s, s.w]; }), 1)[0];
        var h = shop.web ? (d === 0 || d === 6 ? int(9, 13) : int(7, 15)) : int(10, 18), mi = int(0, 59);
        var created = T(day, h, mi);
        if (ms(created) > anchorMs) continue;
        orderSeq[country] += int(1, 9);
        var cid = wpick(CARRIER_MIX[country], 1)[0], c = CARRIER[cid];
        // customer + destination
        var nm = NAMES[country], first = pick(nm.f), last = pick(nm.l);
        var city = wpick(CITIES[country], 3);
        var email = ascii(first + '.' + last).toLowerCase().replace(/[^a-z.]/g, '') + (chance(.35) ? int(2, 98) : '') + '@example.com';
        // items
        var lines = [], value = 0, kg = 0.15, nLines = shop.web ? wpick([[1, .62], [2, .28], [3, .10]], 1)[0] : wpick([[1, .85], [2, .15]], 1)[0];
        for (var li = 0; li < nLines; li++) {
          var it = wpick(ITEMS, shop.web ? 5 : 6), q = it[4] > 1 ? int(1, it[4]) : 1;
          var price = Math.round((it[1] + R() * (it[2] - it[1])) * 10) / 10 - 0.1;
          if (price < it[1]) price = it[1];
          price = r2(price);
          lines.push({ name: it[0], qty: q, price: price });
          value += q * price; kg += q * it[3];
        }
        value = r2(value + (value < 49 ? 3.9 : 0));
        kg = Math.round(kg * 100) / 100;
        var codRate = COD_RATE[country] * (c.locker ? 0.75 : 1);
        var cod = chance(codRate) ? value : 0;
        var cost = r2(c.base + Math.max(0, kg - 1) * 0.45 + (cod ? 0.3 : 0));
        var lockerName = c.locker ? 'BOX NOW ' + city[0] + ' ' + pick(LOCKER_SPOTS[country]) + ' ' + pad(int(1, 60), 3) : '';
        var p = {
          id: 'p' + (parcels.length + 1), order: country + '-' + orderSeq[country], shop: shop.id, country: country,
          customer: first + ' ' + last, email: email, city: city[0], zip: city[1], depot: city[2],
          carrier: cid, tracking: tracking(c, country), locker: lockerName, kg: kg, cost: cost, cod: cod, value: value, lines: lines,
          created: created, events: []
        };
        simulate(p, c, shop, created);
        p.events = p.events.filter(function (e) { return ms(e.ts) <= anchorMs; });
        parcels.push(p);
      }
    }

    function simulate(p, c, shop, created) {
      var ev = p.events, pm = c.pm;
      function add(ts, k, t, loc) { if (ev.length && ts <= ev[ev.length - 1].ts) ts = tsOf(ms(ev[ev.length - 1].ts) + int(4, 25) * 60000); ev.push({ ts: ts, k: k, t: t, loc: loc || '' }); return ts; }
      var day = created.slice(0, 10), from = shop.web ? (p.country === 'HR' ? 'Adrial warehouse Zagreb' : 'Adrial warehouse Komenda') : shop.name;
      add(created, 'label', 'Label created · shipment data sent to ' + c.name, shop.name);
      var pd = isWork(day) && +created.slice(11, 13) < 14 ? day : nextWork(day);
      var pickTs = add(T(pd, int(15, 17), int(0, 59)), 'pickup', 'Picked up by courier', from);
      var hubTs = add(T(pd, int(19, 22), int(0, 59)), 'depot', 'Sorted at ' + c.hub, c.hub.replace(/^.*? (hub|depot|centre|sede) /, ''));
      var td = wpick(c.td, 1)[0], dd = addWork(pd, td);
      for (var i = 1; i < td; i++) add(T(addWork(pd, i), int(2, 6), int(0, 59)), 'transit', 'In transit between depots', '');
      var depotName = p.depot + (p.country === 'IT' ? '' : '') + ' depot';
      var r = R();
      var pStall = 0.008 * pm, pDam = 0.0035 * pm, pRef = 0.009 * pm, pFailRet = (c.locker ? 0.035 : 0.022) * pm, pFailDel = (c.locker ? 0.012 : 0.07) * pm;
      // a stalled parcel: scans stop after the hub or a transit scan
      if (r < pStall) {
        p.flag = 'stall';
        var last = ev[ev.length - 1];
        if (wdBetween(last.ts, anchorDay) > 14 && chance(0.75)) add(T(addWork(last.ts, int(10, 12)), int(9, 15), int(0, 59)), 'lost', 'Parcel declared lost by carrier after investigation', '');
        return;
      }
      r -= pStall;
      add(T(dd, int(4, 6), int(0, 59)), 'depot', 'Arrived at delivery depot', depotName);
      if (r < pDam) {
        p.flag = 'damaged';
        add(T(dd, int(6, 8), int(0, 59)), 'damaged', 'Damage found at depot · parcel held for inspection', depotName);
        return;
      }
      r -= pDam;
      var outTs = add(T(dd, int(7, 8), int(0, 59)), 'out', c.locker ? 'Out for delivery to locker' : 'Out for delivery', p.city);
      var tryDay = dd;
      function returnFrom(dayX, why) {
        var rd = nextWork(dayX);
        add(T(rd, int(8, 11), int(0, 59)), 'return', why, '');
        add(T(nextWork(rd), int(3, 6), int(0, 59)), 'returning', 'In transit back to sender', '');
        add(T(addWork(rd, int(2, 4)), int(9, 15), int(0, 59)), 'returned', 'Delivered back to sender', p.shop.indexOf('WEB') === 0 ? 'Adrial warehouse' : shop.name);
      }
      if (c.locker) {
        var lockTs = add(T(dd, int(9, 16), int(0, 59)), 'locker', 'Placed in locker ' + p.locker.replace('BOX NOW ', '') + ' · PIN sent to customer', p.locker);
        if (r < pFailRet + pRef) {
          var exp = addDays(dd, 7);
          add(T(exp, int(20, 23), int(0, 59)), 'info', 'Pickup deadline passed · not collected from locker', p.locker);
          returnFrom(exp, 'Not collected within 7 days · return to sender started');
          return;
        }
        if (r < pFailRet + pRef + pFailDel) add(T(dd, int(9, 12), int(0, 59)), 'info', 'Locker full · moved to nearest free locker', p.locker);
        var wait = wpick([[0, .45], [1, .30], [2, .12], [3, .07], [4, .04], [6, .02]], 1)[0];
        var cday = addDays(dd, wait), ct = T(cday, int(7, 22), int(0, 59));
        if (ct <= lockTs) ct = tsOf(ms(lockTs) + int(30, 300) * 60000);
        add(ct, 'delivered', 'Collected from locker' + (p.cod ? ' · COD paid by card' : ''), p.locker);
        return;
      }
      if (r < pRef) {
        add(T(dd, int(9, 16), int(0, 59)), 'failed', 'Delivery refused by recipient', p.city);
        returnFrom(dd, 'Refused · return to sender started');
        return;
      }
      r -= pRef;
      var reasons = ['Recipient not at home', 'Recipient not at home', 'Address incomplete · courier could not find recipient', 'Business closed', 'Recipient not reachable by phone'];
      if (r < pFailRet + pFailDel) {
        var willDeliver = r >= pFailRet;
        add(T(dd, int(9, 16), int(0, 59)), 'failed', 'Delivery attempt failed · ' + pick(reasons), p.city);
        if (c.post) {
          var office = c.pp + ' ' + p.zip + ' ' + p.city;
          add(T(dd, int(16, 18), int(0, 59)), 'notice', 'Notice left · parcel waiting at ' + office, office);
          if (willDeliver) { add(T(addWork(dd, wpick([[1, .4], [2, .3], [3, .15], [5, .1], [8, .05]], 1)[0]), int(8, 18), int(0, 59)), 'delivered', 'Collected at ' + office, office); return; }
          var dl = addDays(dd, 15);
          add(T(dl, int(18, 20), int(0, 59)), 'info', 'Storage period expired · not collected', office);
          returnFrom(dl, 'Not collected · return to sender started');
          return;
        }
        tryDay = nextWork(dd);
        add(T(tryDay, int(7, 8), int(0, 59)), 'out', 'Out for delivery · 2nd attempt', p.city);
        if (willDeliver && chance(0.7)) { add(T(tryDay, int(9, 17), int(0, 59)), 'delivered', 'Delivered · signed by recipient', p.city); return; }
        add(T(tryDay, int(9, 16), int(0, 59)), 'failed', 'Delivery attempt failed · ' + pick(reasons), p.city);
        var shopName = c.pp + ' ' + p.city;
        add(T(tryDay, int(17, 19), int(0, 59)), 'notice', 'Taken to ' + shopName + ' · waiting for pickup', shopName);
        if (willDeliver) { add(T(addWork(tryDay, wpick([[1, .5], [2, .3], [4, .15], [6, .05]], 1)[0]), int(9, 19), int(0, 59)), 'delivered', 'Collected at ' + shopName, shopName); return; }
        var dl2 = addDays(tryDay, 7);
        add(T(dl2, int(18, 20), int(0, 59)), 'info', 'Pickup period expired · not collected', shopName);
        returnFrom(dl2, 'Not collected · return to sender started');
        return;
      }
      add(T(dd, int(9, 17), int(0, 59)), 'delivered', pick(['Delivered · signed by recipient', 'Delivered · signed by recipient', 'Delivered · handed to neighbour', 'Delivered · left at reception']), p.city);
    }

    // ── COD payout batches ──────────────────────────────────────────────────
    var byCarrier = {};
    parcels.forEach(function (p) {
      if (!p.cod) return;
      var last = p.events[p.events.length - 1];
      var del = null, ret = null;
      p.events.forEach(function (e) { if (e.k === 'delivered') del = e.ts.slice(0, 10); if (e.k === 'returned') ret = e.ts.slice(0, 10); });
      p._del = del; p._ret = ret && last.k === 'returned' ? ret : null;
      var roll = R();
      p._pay = roll < 0.03 ? 'skip' : roll < 0.05 ? 'partial' : roll < 0.062 ? 'extra' : 'ok';
      p._payRet = chance(0.16);
      (byCarrier[p.carrier] = byCarrier[p.carrier] || []).push(p);
    });
    var batches = [], bseq = 0;
    CARRIERS.forEach(function (c) {
      var list = byCarrier[c.id] || [], paid = {}, n = int(310, 380);
      for (var day = addDays(start, 2); day <= anchorDay; day = addDays(day, 1)) {
        if (c.payDays.indexOf(dow(day)) < 0) continue;
        if (day === anchorDay && +anchor.slice(11, 13) < 10) continue;
        var cut = addWork(day, -c.lag), items = [];
        list.forEach(function (p) {
          if (paid[p.id]) return;
          var fee = r2(p.cod * c.pct + c.fix), exp = r2(p.cod - fee);
          if (p._del && p._del <= cut && p._pay !== 'skip') {
            var it = { pid: p.id, cod: p.cod, fee: fee, expected: exp, paid: exp, note: '' };
            if (p._pay === 'partial') { var cut2 = chance(.5) ? r2(p.cod * pick([0.5, 0.6, 0.8])) : pick([10, 15, 20, 25]); it.paid = r2(Math.max(0, exp - Math.min(cut2, exp - 1))); it.note = 'Remittance line: partial collection'; }
            else if (p._pay === 'extra') { var xf = pick([2.5, 3.0, 4.9]); it.paid = r2(exp - xf); it.note = 'Remittance line: extra fee ' + String(xf.toFixed(2)).replace('.', ',') + ' € (' + pick(['address correction', 'redelivery', 'COD handling surcharge']) + ')'; }
            items.push(it); paid[p.id] = 1;
          } else if (p._ret && p._payRet && p._ret <= cut) {
            items.push({ pid: p.id, cod: p.cod, fee: fee, expected: exp, paid: exp, note: 'Remittance line lists the parcel as delivered' });
            paid[p.id] = 1;
          }
        });
        if (!items.length) continue;
        n += int(1, 3);
        var bank = addWork(day, c.bankLag), cty = c.country === 'SI+HR' ? (chance(.5) ? 'SI' : 'HR') : c.country;
        if (c.id === 'BOXNOW') cty = 'HR';
        var b = {
          id: 'b' + (++bseq), carrier: c.id, ref: c.ref + '-' + day.slice(2, 4) + day.slice(5, 7) + day.slice(8, 10) + '-' + pad(n, 3), date: day,
          bankDate: bank, onBank: bank <= anchorDay, account: ACCOUNTS[cty],
          stmt: bank <= anchorDay ? 'IZP ' + bank.replace(/-/g, '') + ' / line ' + int(3, 48) : '', items: items
        };
        var g = 0, f = 0, net = 0;
        items.forEach(function (it) { g += it.cod; f += it.fee; net += it.paid; });
        b.gross = r2(g); b.fee = r2(f); b.net = r2(net);
        batches.push(b);
      }
    });
    batches.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : a.carrier < b.carrier ? -1 : 1; });
    parcels.forEach(function (p) { delete p._del; delete p._ret; delete p._pay; delete p._payRet; });
    return { anchor: anchor, parcels: parcels, batches: batches };
  }

  window.ParcelsData = {
    VERSION: VERSION, CARRIERS: CARRIERS, CARRIER: CARRIER, SHOPS: SHOPS, COUNTRIES: COUNTRIES, TEAM: TEAM, ACCOUNTS: ACCOUNTS,
    generate: generate,
    util: { pad: pad, r2: r2, ms: ms, tsOf: tsOf, ymdOf: ymdOf, addDays: addDays, addWork: addWork, wdBetween: wdBetween, daysBetween: daysBetween, isWork: isWork, dow: dow, rng: rng, ascii: ascii }
  };
})();
