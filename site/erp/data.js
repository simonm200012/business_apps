/* Adrial ERP demo: deterministic, entirely fictional demo dataset.
 * window.ERPData.generate(todayYmd) builds ~12 months of history by simulating day by day:
 * opening stock -> sales (stores, e-shop, B2B) -> replenishment transfers -> purchase orders and
 * receipts -> invoices and payments. Every stock change is a movement, so the final stock equals the
 * sum of movements. All names, companies and e-mails are invented (@example.com). */
(function () {
  'use strict';

  var VERSION = 3;

  var LOCATIONS = [
    { id: 'WH', name: 'Central warehouse', short: 'Central WH', city: 'Komenda', country: 'SI', kind: 'warehouse' },
    { id: 'ESHOP', name: 'E-shop', short: 'E-shop', city: 'Komenda', country: 'SI', kind: 'eshop' },
    { id: 'SI-KOM', name: 'Store Komenda', short: 'Komenda', city: 'Komenda', country: 'SI', kind: 'store' },
    { id: 'SI-KP', name: 'Store Koper', short: 'Koper', city: 'Koper', country: 'SI', kind: 'store' },
    { id: 'SI-MB', name: 'Store Maribor', short: 'Maribor', city: 'Maribor', country: 'SI', kind: 'store' },
    { id: 'SI-NM', name: 'Store Novo Mesto', short: 'Novo Mesto', city: 'Novo Mesto', country: 'SI', kind: 'store' },
    { id: 'HR-ZG', name: 'Store Zagreb', short: 'Zagreb', city: 'Zagreb', country: 'HR', kind: 'store' },
    { id: 'HR-ST', name: 'Store Split', short: 'Split', city: 'Split', country: 'HR', kind: 'store' },
    { id: 'HR-RI', name: 'Store Rijeka', short: 'Rijeka', city: 'Rijeka', country: 'HR', kind: 'store' },
    { id: 'HR-ZD', name: 'Store Zadar', short: 'Zadar', city: 'Zadar', country: 'HR', kind: 'store' },
    { id: 'HR-OS', name: 'Store Osijek', short: 'Osijek', city: 'Osijek', country: 'HR', kind: 'store' }
  ];
  var VAT = { SI: 22, HR: 25 };
  var CATEGORIES = ['Frames', 'Sunglasses', 'Contact lenses', 'Solutions', 'Optical lenses', 'Accessories'];

  // ── small date helpers (local dates as YYYY-MM-DD strings) ─────────────────
  function pad(n, w) { var s = String(n); while (s.length < (w || 2)) s = '0' + s; return s; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parse(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(s, n) { var d = parse(s); d.setDate(d.getDate() + n); return ymd(d); }
  function dow(s) { return parse(s).getDay(); } // 0 = Sunday
  function r2(n) { return Math.round(n * 100) / 100; }
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function lineNet(l) { return r2(l.qty * l.price * (1 - (l.disc || 0) / 100)); }
  function docTotals(lines, vat) {
    var net = 0;
    lines.forEach(function (l) { net += lineNet(l); });
    net = r2(net);
    var v = r2(net * vat / 100);
    return { net: net, vat: v, total: r2(net + v) };
  }

  function generate(today) {
    var R = rng(0xAD71A1);
    function int(a, b) { return a + Math.floor(R() * (b - a + 1)); }
    function pick(a) { return a[Math.floor(R() * a.length)]; }
    function chance(p) { return R() < p; }
    function price99(x) { return Math.max(0.9, Math.ceil(x) - 0.1); }
    function hhmm() { return pad(int(9, 18)) + ':' + pad(int(0, 59)); }

    var nextId = { product: 0, customer: 0, supplier: 0, so: 0, po: 0, inv: 0, mov: 0, pay: 0, tr: 0, cn: 0, quote: 0, count: 0 };
    var seq = { SO: {}, PO: {}, INV: {}, TR: {}, CN: {}, QT: {}, CNT: {} };
    function docNo(kind, date) {
      var y = date.slice(0, 4);
      seq[kind][y] = (seq[kind][y] || 0) + 1;
      var n = seq[kind][y];
      if (kind === 'INV') return y + '-' + pad(n, 6);
      if (kind === 'SO') return 'SO-' + y + '-' + pad(n, 5);
      if (kind === 'PO' || kind === 'CN' || kind === 'QT' || kind === 'CNT') return kind + '-' + y + '-' + pad(n, 4);
      return 'TR-' + y + '-' + pad(n, 5);
    }

    // ── Suppliers (fictional) ──────────────────────────────────────────────
    var suppliers = [
      ['Lumina Eyewear GmbH', 'DE', 'Munich', 'Jonas Weber', 30, 14],
      ['Ottica Serena S.r.l.', 'IT', 'Belluno', 'Giulia Ferri', 60, 21],
      ['Nordline Frames ApS', 'DK', 'Aarhus', 'Mads Holm', 30, 18],
      ['Atelier Vero SAS', 'FR', 'Lyon', 'Claire Dumas', 45, 25],
      ['Kestrel Optical Ltd', 'IE', 'Cork', 'Aoife Brennan', 30, 16],
      ['Solaris Shades S.L.', 'ES', 'Valencia', 'Marta Ruiz', 45, 20],
      ['Polar Shade Oy', 'FI', 'Tampere', 'Eero Laine', 30, 24],
      ['ClearView Lenses B.V.', 'NL', 'Eindhoven', 'Sanne de Vries', 30, 7],
      ['HydraSoft Contact GmbH', 'AT', 'Graz', 'Lukas Gruber', 30, 6],
      ['AquaCare Solutions Kft.', 'HU', 'Győr', 'Réka Nagy', 15, 5],
      ['VistaLab Optics d.o.o.', 'SI', 'Kranj', 'Tina Zorman', 30, 4],
      ['Jadran Precision Lens d.o.o.', 'HR', 'Varaždin', 'Ivo Barić', 30, 5],
      ['Kappa Accessories s.r.o.', 'CZ', 'Brno', 'Petra Dvořáková', 15, 10]
    ].map(function (s) {
      var id = ++nextId.supplier;
      var slug = s[0].toLowerCase().split(' ')[0].replace(/[^a-z]/g, '');
      return { id: id, name: s[0], country: s[1], city: s[2], contact: s[3], email: slug + '.orders@example.com', terms: s[4], lead: s[5] };
    });

    // ── Products (120) ─────────────────────────────────────────────────────
    var products = [];
    var skuN = { Frames: 1000, Sunglasses: 2000, 'Contact lenses': 3000, Solutions: 4000, 'Optical lenses': 5000, Accessories: 6000 };
    var PFX = { Frames: 'FR', Sunglasses: 'SG', 'Contact lenses': 'CL', Solutions: 'SO', 'Optical lenses': 'OL', Accessories: 'AC' };
    function addP(cat, brand, supplierId, name, cost, markup, unit) {
      skuN[cat] += int(1, 9);
      products.push({
        id: ++nextId.product, sku: PFX[cat] + '-' + skuN[cat], name: name, brand: brand, cat: cat,
        supplierId: supplierId, cost: r2(cost), price: price99(cost * markup), reorder: 0, unit: unit || 'pc'
      });
    }
    var shapes = ['Round', 'Rectangle', 'Cat-eye', 'Aviator', 'Square', 'Browline', 'Oval', 'Panto'];
    var mats = ['Acetate', 'Titanium', 'Metal', 'TR90'];
    var colors = ['Black', 'Havana', 'Crystal', 'Gold', 'Navy', 'Tortoise', 'Gunmetal', 'Rose'];
    [['Lumina', 1, 'LM', 28, 45], ['Serena', 2, 'SE', 35, 60], ['Nordline', 3, 'NL', 30, 50], ['Atelier Vero', 4, 'AV', 45, 75], ['Kestrel', 5, 'KS', 22, 38]].forEach(function (b) {
      for (var i = 0; i < 8; i++) {
        addP('Frames', b[0], b[1], b[0] + ' ' + b[2] + '-' + int(1000, 9899) + ' ' + pick(shapes) + ' ' + pick(mats) + ', ' + pick(colors) + ' ' + int(48, 56),
          b[3] + R() * (b[4] - b[3]), 2.4 + R() * 0.5);
      }
    });
    var sgStyles = ['Aviator', 'Wayfarer', 'Sport wrap', 'Oversized', 'Round', 'Shield', 'Clubmaster'];
    var sgLens = ['Polarized', 'Gradient', 'Mirror', 'Classic G15', 'Photochromic'];
    [['Solaris', 6, 9, 'SL'], ['Polar Shade', 7, 8, 'PS'], ['Riva Sun', 2, 8, 'RV']].forEach(function (b) {
      for (var i = 0; i < b[2]; i++) {
        addP('Sunglasses', b[0], b[1], b[0] + ' ' + b[3] + '-' + int(100, 989) + ' ' + pick(sgStyles) + ' ' + pick(sgLens) + ', ' + pick(colors),
          18 + R() * 37, 2.2 + R() * 0.5);
      }
    });
    [
      ['ClearView', 8, 'ClearView 1-Day (30 pk)', 14], ['ClearView', 8, 'ClearView 1-Day (90 pk)', 36], ['ClearView', 8, 'ClearView Monthly (6 pk)', 16],
      ['ClearView', 8, 'ClearView Toric Monthly (6 pk)', 22], ['ClearView', 8, 'ClearView Multifocal 1-Day (30 pk)', 24], ['ClearView', 8, 'ClearView Daily Silicone (30 pk)', 18],
      ['ClearView', 8, 'ClearView Extended Wear (6 pk)', 21], ['HydraSoft', 9, 'HydraSoft Daily (30 pk)', 12], ['HydraSoft', 9, 'HydraSoft Daily (90 pk)', 31],
      ['HydraSoft', 9, 'HydraSoft 2-Week (6 pk)', 13], ['HydraSoft', 9, 'HydraSoft Toric 2-Week (6 pk)', 19], ['HydraSoft', 9, 'HydraSoft Comfort Monthly (3 pk)', 10],
      ['HydraSoft', 9, 'HydraSoft Silicone Monthly (6 pk)', 17], ['AquaDay', 9, 'AquaDay 1-Day (30 pk)', 11], ['AquaDay', 9, 'AquaDay 1-Day (90 pk)', 28],
      ['AquaDay', 9, 'AquaDay Monthly (6 pk)', 12], ['AquaDay', 9, 'AquaDay Toric 1-Day (30 pk)', 19], ['AquaDay', 9, 'AquaDay Colour Blue (2 pk)', 9],
      ['AquaDay', 9, 'AquaDay Colour Green (2 pk)', 9], ['AquaDay', 9, 'AquaDay Colour Hazel (2 pk)', 9]
    ].forEach(function (c) { addP('Contact lenses', c[0], c[1], c[2], c[3] * (0.95 + R() * 0.1), 1.8 + R() * 0.3, 'box'); });
    [
      ['AquaCare', 'AquaCare Multi 360 ml', 4.2], ['AquaCare', 'AquaCare Multi 2 × 360 ml', 7.6], ['AquaCare', 'AquaCare Travel 100 ml', 2.4],
      ['AquaCare', 'AquaCare Peroxide 360 ml', 6.1], ['PureRinse', 'PureRinse Saline 360 ml', 2.9], ['PureRinse', 'PureRinse Eye drops 10 ml', 3.6],
      ['PureRinse', 'PureRinse Hyaluron drops 10 ml', 5.2], ['AquaCare', 'AquaCare RGP solution 120 ml', 6.8], ['PureRinse', 'PureRinse Protein remover (10 tabs)', 4.4],
      ['AquaCare', 'AquaCare Multi 3-month pack', 11.5]
    ].forEach(function (c) { addP('Solutions', c[0], 10, c[1], c[2], 2 + R() * 0.3); });
    [
      ['VistaLab', 11, 'VistaLab Single Vision 1.5 hard coat', 18], ['VistaLab', 11, 'VistaLab Single Vision 1.6 AR', 32], ['VistaLab', 11, 'VistaLab Single Vision 1.67 AR Blue', 48],
      ['VistaLab', 11, 'VistaLab Single Vision 1.74 AR', 74], ['VistaLab', 11, 'VistaLab Progressive Standard 1.5', 62], ['VistaLab', 11, 'VistaLab Progressive Premium 1.6', 96],
      ['VistaLab', 11, 'VistaLab Progressive Premium 1.67', 118], ['VistaLab', 11, 'VistaLab Office 1.6', 70], ['Jadran Precision', 12, 'Jadran Photochromic SV 1.5', 44],
      ['Jadran Precision', 12, 'Jadran Photochromic Progressive 1.6', 112], ['Jadran Precision', 12, 'Jadran Drive SV 1.6', 52], ['Jadran Precision', 12, 'Jadran Kids Myopia Control 1.59', 66]
    ].forEach(function (c) { addP('Optical lenses', c[0], c[1], c[2] + ' (pair)', c[3], 2.4 + R() * 0.4, 'pair'); });
    [
      'Hard case, black', 'Soft pouch, grey', 'Microfibre cloth 18 × 18', 'Lens cleaning spray 30 ml', 'Lens cleaning spray 60 ml', 'Eyeglass chain, gold',
      'Sport cord, neoprene', 'Repair kit with screwdriver', 'Anti-fog wipes (30 pk)', 'Contact lens case', 'Contact lens tweezers', 'Sport strap, adjustable', 'Kids case, blue'
    ].forEach(function (n) { addP('Accessories', 'Kappa', 13, 'Kappa ' + n, 0.8 + R() * 6, 2.8 + R() * 0.6); });

    var byPid = {};
    products.forEach(function (p) { byPid[p.id] = p; });
    var byCat = {};
    CATEGORIES.forEach(function (c) { byCat[c] = products.filter(function (p) { return p.cat === c; }); });

    // ── Customers (fictional) ──────────────────────────────────────────────
    var customers = [];
    function addC(o) { o.id = ++nextId.customer; customers.push(o); return o; }
    var b2b = [
      ['Optika Nova d.o.o.', 'SI', 'Ljubljana', 30], ['Optika Jasni vid d.o.o.', 'SI', 'Celje', 30], ['Očesna ambulanta Lipa d.o.o.', 'SI', 'Kranj', 45],
      ['Optika Sončnica s.p.', 'SI', 'Ptuj', 15], ['Vid Plus d.o.o.', 'SI', 'Nova Gorica', 30], ['Optika Modri breg d.o.o.', 'SI', 'Velenje', 60],
      ['Delovna medicina Brinje d.o.o.', 'SI', 'Ljubljana', 30], ['Optika Kristal d.o.o.', 'SI', 'Murska Sobota', 30], ['Optika Iris s.p.', 'SI', 'Kamnik', 15],
      ['Športni klub Veter', 'SI', 'Bled', 15], ['Optika Vidik d.o.o.', 'HR', 'Zagreb', 30], ['Optika Bura j.d.o.o.', 'HR', 'Pula', 30],
      ['Očna poliklinika Maslina d.o.o.', 'HR', 'Šibenik', 45], ['Optika Lanterna d.o.o.', 'HR', 'Dubrovnik', 60], ['Optika Jadranka obrt', 'HR', 'Karlovac', 15],
      ['Optika Lavanda d.o.o.', 'HR', 'Varaždin', 30], ['Očni centar Gaj d.o.o.', 'HR', 'Slavonski Brod', 45], ['Optika Mareta obrt', 'HR', 'Makarska', 30],
      ['Optika Smokva j.d.o.o.', 'HR', 'Trogir', 30], ['Optika Galeb d.o.o.', 'HR', 'Poreč', 60], ['Hotelska grupa Primorje (demo) d.o.o.', 'HR', 'Opatija', 30],
      ['Zavod za vid Sora (demo)', 'SI', 'Škofja Loka', 30]
    ];
    b2b.forEach(function (b, i) {
      var slug = b[0].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '').split('.').slice(0, 2).join('.');
      addC({
        name: b[0], type: 'B2B', country: b[1], city: b[2], email: 'info.' + slug + '@example.com',
        phone: (b[1] === 'SI' ? '+386 1 555 ' : '+385 1 555 ') + pad(int(0, 9999), 4),
        vatId: b[1] + (b[1] === 'SI' ? '00' + pad(int(0, 999999), 6) : '00' + pad(int(0, 999999999), 9)),
        terms: b[3], homeLoc: 'WH', slow: i === 5 || i === 13
      });
    });
    var FN = { SI: ['Ana', 'Maja', 'Nina', 'Eva', 'Sara', 'Petra', 'Tina', 'Mojca', 'Katja', 'Urša', 'Neža', 'Jure', 'Luka', 'Matej', 'Rok', 'Žiga', 'Gregor', 'Miha', 'Tomaž', 'Klemen'],
      HR: ['Ivana', 'Marija', 'Lucija', 'Martina', 'Kristina', 'Tea', 'Iva', 'Nikolina', 'Josipa', 'Helena', 'Ivan', 'Marko', 'Josip', 'Tomislav', 'Filip', 'Ante', 'Karlo', 'Domagoj', 'Dario', 'Bruno'] };
    var LN = { SI: ['Zorman', 'Kranjc', 'Lesjak', 'Pirc', 'Rupnik', 'Mavrič', 'Šuštar', 'Zalar', 'Bergant', 'Jamnik', 'Pogačar', 'Vrhovec', 'Čeh', 'Dolenc', 'Erjavec'],
      HR: ['Barić', 'Lovrić', 'Perković', 'Šarić', 'Vuković', 'Matić', 'Grgić', 'Pavić', 'Bilić', 'Jurić', 'Rukavina', 'Mikulić', 'Tomljenović', 'Dujmović', 'Radić'] };
    var stores = LOCATIONS.filter(function (l) { return l.kind === 'store'; });
    var walkIn = {
      SI: addC({ name: 'Walk-in customer (SI)', type: 'B2C', country: 'SI', city: '', email: '', phone: '', vatId: '', terms: 0, homeLoc: 'SI-KOM', walkIn: true }),
      HR: addC({ name: 'Walk-in customer (HR)', type: 'B2C', country: 'HR', city: '', email: '', phone: '', vatId: '', terms: 0, homeLoc: 'HR-ZG', walkIn: true })
    };
    var used = {};
    for (var ci = 0; ci < 40; ci++) {
      var home = stores[ci % stores.length], cc = home.country, nm;
      do { nm = pick(FN[cc]) + ' ' + pick(LN[cc]); } while (used[nm]);
      used[nm] = 1;
      var mail = nm.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '.') + '@example.com';
      addC({ name: nm, type: 'B2C', country: cc, city: home.city, email: mail, phone: (cc === 'SI' ? '+386 40 555 ' : '+385 91 555 ') + pad(int(0, 9999), 4), vatId: '', terms: 0, homeLoc: home.id });
    }
    var b2bCust = customers.filter(function (c) { return c.type === 'B2B'; });
    var b2cNamed = customers.filter(function (c) { return c.type === 'B2C' && !c.walkIn; });

    // ── Simulation state ───────────────────────────────────────────────────
    var start = addDays(today, -365);
    var stock = {}, reserved = {}, onOrder = {}, target = {};
    products.forEach(function (p) { stock[p.id] = {}; reserved[p.id] = {}; onOrder[p.id] = 0; target[p.id] = {}; });
    var movements = [], sos = [], pos = [], invoices = [], events = [];
    function mv(o) { o.id = ++nextId.mov; movements.push(o); }
    function addStock(pid, loc, d) { stock[pid][loc] = (stock[pid][loc] || 0) + d; if (stock[pid][loc] < 0) throw new Error('negative stock in generator'); }
    function availAt(pid, loc) { return (stock[pid][loc] || 0) - (reserved[pid][loc] || 0); }
    function totalStock(pid) { var t = 0, s = stock[pid]; for (var k in s) t += s[k]; return t; }

    var LEVELS = { // [whMin, whMax, storeMin, storeMax, eshopMin, eshopMax]
      Frames: [3, 8, 1, 2, 0, 1], Sunglasses: [3, 8, 1, 2, 0, 2], 'Contact lenses': [12, 30, 2, 6, 5, 12],
      Solutions: [10, 24, 2, 6, 5, 10], 'Optical lenses': [6, 14, 1, 3, 0, 0], Accessories: [10, 30, 2, 5, 2, 6]
    };
    products.forEach(function (p) {
      var L = LEVELS[p.cat], tot = 0;
      LOCATIONS.forEach(function (l) {
        var q = l.kind === 'warehouse' ? int(L[0], L[1]) : l.kind === 'store' ? int(L[2], L[3]) : int(L[4], L[5]);
        target[p.id][l.id] = l.kind === 'warehouse' ? 0 : Math.max(q, l.kind === 'store' ? 1 : L[5] > 0 ? 1 : 0);
        if (q > 0) {
          addStock(p.id, l.id, q); tot += q;
          mv({ ts: start + 'T07:00', type: 'adjustment', pid: p.id, loc: l.id, qty: q, cost: p.cost, ref: '', note: 'Opening balance' });
        }
      });
      p.reorder = Math.max(3, Math.round(tot * 0.4));
    });

    // ── Documents ──────────────────────────────────────────────────────────
    function createSO(date, cust, loc, lines, age) {
      var L = LOCATIONS.filter(function (x) { return x.id === loc; })[0];
      var so = { id: ++nextId.so, no: docNo('SO', date), date: date, customerId: cust.id, loc: loc, vat: VAT[L.country], status: 'draft', lines: lines, created: date + 'T' + hhmm(), note: '' };
      sos.push(so);
      var shipDate, invDate;
      if (L.kind === 'store') {
        var pkg = lines.some(function (l) { return byPid[l.pid].cat === 'Optical lenses'; });
        shipDate = pkg ? addDays(date, int(3, 7)) : date;
        invDate = shipDate;
        if (!pkg && chance(0.02) && age > 3) { so.status = 'cancelled'; return so; }
      } else if (L.kind === 'eshop') {
        shipDate = addDays(date, age === 0 && chance(0.7) ? 1 : int(0, 1)); invDate = shipDate;
      } else {
        if (age <= 2 && chance(0.4)) return so; // draft, nothing reserved
        shipDate = addDays(date, age <= 2 ? 3 : int(1, 3));
        invDate = addDays(shipDate, age <= 8 && chance(0.6) ? 10 : int(0, 2));
      }
      if (shipDate > today) {
        so.status = 'confirmed';
        lines.forEach(function (l) { reserved[l.pid][loc] = (reserved[l.pid][loc] || 0) + l.qty; });
        return so;
      }
      lines.forEach(function (l) {
        addStock(l.pid, loc, -l.qty);
        mv({ ts: shipDate + 'T' + hhmm(), type: 'sale', pid: l.pid, loc: loc, qty: -l.qty, cost: l.cost, ref: 'SO:' + so.id, note: '' });
      });
      so.status = 'shipped'; so.shipDate = shipDate; so.shipLoc = loc;
      if (invDate > today) return so;
      var t = docTotals(lines, so.vat);
      var inv = { id: 0, no: '', date: invDate, due: addDays(invDate, cust.terms), soId: so.id, customerId: cust.id, loc: loc, vat: so.vat,
        lines: lines.map(function (l) { return { pid: l.pid, qty: l.qty, price: l.price, disc: l.disc }; }), net: t.net, vatAmt: t.vat, total: t.total, payments: [] };
      so.status = 'invoiced'; so._inv = inv;
      // payments
      if (cust.type === 'B2C') {
        inv.payments.push({ date: invDate, amount: t.total, method: L.kind === 'eshop' ? 'Online card' : pick(['Card', 'Card', 'Cash']) });
      } else {
        var unpaid = cust.slow ? chance(0.45) : chance(0.06);
        if (!unpaid) {
          var pd = addDays(inv.due, int(-10, 14));
          if (pd < invDate) pd = addDays(invDate, int(1, 5));
          if (chance(0.1)) {
            var part = r2(Math.round(t.total * 0.5));
            if (pd <= today) inv.payments.push({ date: pd, amount: part, method: 'Bank transfer' });
            var pd2 = addDays(pd, int(20, 45));
            if (pd2 <= today && pd <= today) inv.payments.push({ date: pd2, amount: r2(t.total - part), method: 'Bank transfer' });
          } else if (pd <= today) {
            inv.payments.push({ date: pd, amount: t.total, method: 'Bank transfer' });
          }
        }
      }
      invoices.push(inv);
      return so;
    }

    function pickLines(loc, kind, date) {
      var month = parse(date).getMonth(), summer = month >= 3 && month <= 7, winter = month >= 10 || month <= 1;
      var lines = [], usedP = {};
      function tryAdd(cat, qty, disc) {
        var pool = byCat[cat].filter(function (p) { return !usedP[p.id] && availAt(p.id, loc) >= qty; });
        if (!pool.length) return false;
        var p = pick(pool); usedP[p.id] = 1;
        lines.push({ pid: p.id, qty: qty, price: p.price, disc: disc || 0, cost: p.cost });
        return true;
      }
      if (kind === 'store') {
        var disc = chance(0.15) ? 10 : 0;
        if (chance(0.4)) { // glasses package: frame + lenses (+ case)
          if (tryAdd('Frames', 1, disc)) { tryAdd('Optical lenses', 1, disc); if (chance(0.3)) tryAdd('Accessories', 1, 0); }
        } else {
          var w = [['Frames', 0.22], ['Sunglasses', summer ? 0.32 : winter ? 0.05 : 0.15], ['Contact lenses', 0.22], ['Solutions', 0.16], ['Accessories', 0.1]];
          var n = chance(0.3) ? 2 : 1;
          for (var i = 0; i < n; i++) {
            var tot = 0; w.forEach(function (x) { tot += x[1]; });
            var r = R() * tot, cat = w[0][0];
            for (var j = 0; j < w.length; j++) { r -= w[j][1]; if (r <= 0) { cat = w[j][0]; break; } }
            var q = cat === 'Contact lenses' ? int(1, 4) : cat === 'Solutions' ? int(1, 3) : 1;
            tryAdd(cat, q, disc);
          }
        }
      } else if (kind === 'eshop') {
        var n2 = int(1, 3);
        for (var k = 0; k < n2; k++) {
          var c = pick(['Contact lenses', 'Contact lenses', 'Solutions', 'Solutions', 'Accessories', summer ? 'Sunglasses' : 'Contact lenses']);
          tryAdd(c, c === 'Contact lenses' ? int(1, 4) : c === 'Solutions' ? int(1, 3) : 1, 0);
        }
      } else {
        var n3 = int(2, 5), d = pick([10, 12, 15, 20]);
        for (var m = 0; m < n3; m++) {
          var c2 = pick(['Frames', 'Frames', 'Sunglasses', 'Contact lenses', 'Solutions', 'Optical lenses', 'Accessories']);
          var q2 = c2 === 'Contact lenses' || c2 === 'Solutions' || c2 === 'Accessories' ? int(4, 12) : int(1, 4);
          tryAdd(c2, q2, d);
        }
      }
      return lines;
    }

    function createPO(date, sup, lines, status) {
      var po = { id: ++nextId.po, no: docNo('PO', date), supplierId: sup.id, loc: 'WH', status: status, date: date, created: date + 'T' + hhmm(),
        orderedDate: status === 'draft' ? '' : date, expected: status === 'draft' ? '' : addDays(date, sup.lead), lines: lines, receipts: [], note: '' };
      pos.push(po);
      return po;
    }
    function receive(po, qtyFn, date) {
      var rec = { date: date, loc: po.loc, lines: [] };
      po.lines.forEach(function (l) {
        var q = Math.min(qtyFn(l), l.qty - l.received);
        if (q <= 0) return;
        l.received += q; onOrder[l.pid] -= q;
        addStock(l.pid, po.loc, q);
        mv({ ts: date + 'T' + pad(int(7, 11)) + ':' + pad(int(0, 59)), type: 'receipt', pid: l.pid, loc: po.loc, qty: q, cost: l.cost, ref: 'PO:' + po.id, note: '' });
        rec.lines.push({ pid: l.pid, qty: q });
      });
      if (rec.lines.length) po.receipts.push(rec);
      po.status = po.lines.every(function (l) { return l.received >= l.qty; }) ? 'received' : 'partial';
    }

    // ── Day-by-day simulation ──────────────────────────────────────────────
    var eshop = 'ESHOP', DAYS = 365;
    for (var day = 1; day <= DAYS; day++) {
      var date = addDays(start, day), wd = dow(date), age = DAYS - day;

      // 1. receipts due today
      events.filter(function (e) { return e.date === date; }).forEach(function (e) {
        receive(e.po, e.full ? function (l) { return l.qty - l.received; } : function (l) { return l.qty > 1 ? Math.max(1, Math.floor(l.qty * 0.7)) : 0; }, date);
      });

      // 2. purchase orders on Mondays (none in the last 9 days, so low-stock suggestions exist)
      if (wd === 1) {
        suppliers.forEach(function (s) {
          if (age < 9 && s.lead < 14) return;
          var mine = products.filter(function (p) { return p.supplierId === s.id; });
          if (!mine.some(function (p) { return totalStock(p.id) + onOrder[p.id] <= p.reorder * (age < 30 ? 1.3 : 1); })) return;
          var lines = [];
          mine.forEach(function (p) {
            var tot = totalStock(p.id);
            if (tot + onOrder[p.id] > p.reorder * 1.5) return;
            var q = p.reorder * 2 + int(0, p.reorder) - tot - onOrder[p.id];
            if (p.cat === 'Contact lenses' || p.cat === 'Solutions' || p.cat === 'Accessories') q = Math.ceil(q / 5) * 5;
            if (q > 0) lines.push({ pid: p.id, qty: q, cost: p.cost, received: 0 });
          });
          if (!lines.length) return;
          var po = createPO(date, s, lines, 'ordered');
          lines.forEach(function (l) { onOrder[l.pid] += l.qty; });
          var arrive = addDays(po.expected, int(-2, 3));
          if (arrive <= date) arrive = addDays(date, 1);
          if (chance(0.15)) {
            events.push({ date: arrive, po: po, full: false });
            events.push({ date: addDays(arrive, int(5, 10)), po: po, full: true });
          } else {
            events.push({ date: arrive, po: po, full: true });
          }
        });
      }

      // 3. replenishment transfers from the central warehouse, every second Tuesday
      if (day % 14 === 2) {
        LOCATIONS.forEach(function (l) {
          if (l.kind === 'warehouse') return;
          var cand = [];
          products.forEach(function (p) {
            var gap = target[p.id][l.id] - (stock[p.id][l.id] || 0);
            if (gap > 0 && availAt(p.id, 'WH') > 0) cand.push([p, gap]);
          });
          cand.sort(function (a, b) { return b[1] - a[1]; });
          var trNo = cand.length ? docNo('TR', date) : '';
          cand.slice(0, 10).forEach(function (c) {
            var q = Math.min(c[1], availAt(c[0].id, 'WH'));
            if (q <= 0) return;
            addStock(c[0].id, 'WH', -q); addStock(c[0].id, l.id, q);
            mv({ ts: date + 'T08:' + pad(int(0, 59)), type: 'transfer', pid: c[0].id, loc: 'WH', to: l.id, qty: q, cost: c[0].cost, ref: trNo, note: 'Replenishment' });
          });
        });
      }

      // 4. occasional manual adjustments (damage, count corrections)
      if (chance(0.1)) {
        var al = pick(LOCATIONS), ap = pick(products);
        if ((stock[ap.id][al.id] || 0) - (reserved[ap.id][al.id] || 0) > 0) {
          var reason = pick(['Damaged', 'Stock count correction', 'Lost / theft', 'Display sample']);
          addStock(ap.id, al.id, -1);
          mv({ ts: date + 'T' + hhmm(), type: 'adjustment', pid: ap.id, loc: al.id, qty: -1, cost: ap.cost, ref: '', note: reason });
        }
      }

      // 5. sales
      stores.forEach(function (st) {
        if (wd === 0 || !chance(wd === 6 ? 0.4 : 0.3)) return;
        var lines = pickLines(st.id, 'store', date);
        if (!lines.length) return;
        var cust = chance(0.5) ? walkIn[st.country] : (function () {
          var local = b2cNamed.filter(function (c) { return c.homeLoc === st.id; });
          return local.length && chance(0.8) ? pick(local) : pick(b2cNamed.filter(function (c) { return c.country === st.country; }));
        })();
        createSO(date, cust, st.id, lines, age);
      });
      if (chance(0.6)) {
        var el = pickLines(eshop, 'eshop', date);
        if (el.length) createSO(date, pick(b2cNamed), eshop, el, age);
      }
      if (wd >= 1 && wd <= 5 && chance(0.5)) {
        var bl = pickLines('WH', 'b2b', date);
        if (bl.length) createSO(date, pick(b2bCust), 'WH', bl, age);
      }
    }

    // the oldest open PO arrived short yesterday: book a partial receipt
    (function () {
      var po = pos.filter(function (p) { return p.status === 'ordered'; })[0];
      if (!po) return;
      var first = true;
      receive(po, function (l) { var q = first ? Math.max(1, Math.floor(l.qty / 2)) : 0; first = false; return l.qty > 1 ? q : 0; }, addDays(today, -1));
    })();

    // a draft PO prepared yesterday
    (function () {
      var s = suppliers[12];
      var lines = products.filter(function (p) { return p.supplierId === s.id; }).slice(0, 3).map(function (p) { return { pid: p.id, qty: 20, cost: p.cost, received: 0 }; });
      createPO(addDays(today, -1), s, lines, 'draft').note = 'Prepared for the autumn season';
    })();

    // Reorder points are reviewed now and then: a few fast movers get a higher point than their
    // current stock, so the low-stock list and the PO suggestion have something to show.
    (function () {
      var cand = products.filter(function (p) { return onOrder[p.id] === 0; });
      for (var i = 0; i < 9 && cand.length; i++) {
        var p = cand.splice(int(0, cand.length - 1), 1)[0];
        var avail = 0;
        LOCATIONS.forEach(function (l) { avail += availAt(p.id, l.id); });
        if (avail >= p.reorder) p.reorder = avail + int(1, 4);
      }
    })();

    // Invoices: number in date order so the series is chronological
    invoices.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.soId - b.soId; });
    invoices.forEach(function (inv) {
      inv.id = ++nextId.inv; inv.no = docNo('INV', inv.date);
      inv.payments.forEach(function (p) { p.id = ++nextId.pay; });
    });
    sos.forEach(function (so) { if (so._inv) { so.invoiceId = so._inv.id; delete so._inv; } });
    customers.forEach(function (c) { delete c.slow; });

    // Three transfers currently in transit (shipped from the central warehouse, not received yet)
    var transfers = [];
    [['SI-KP', -3, 1], ['HR-ST', -1, 2], ['HR-OS', 0, 2]].forEach(function (t) {
      var date = addDays(today, t[1]), lines = [], used3 = {};
      for (var i = 0; i < 3; i++) {
        var pool = products.filter(function (p) { return !used3[p.id] && (stock[p.id].WH || 0) - (reserved[p.id].WH || 0) >= 3 && p.cat !== 'Optical lenses'; });
        if (!pool.length) break;
        var p = pick(pool); used3[p.id] = 1;
        lines.push({ pid: p.id, qty: int(1, 2), received: 0, lost: 0 });
      }
      if (!lines.length) return;
      var no = docNo('TR', date), ts = date + 'T08:' + pad(int(10, 50));
      var tr = { id: ++nextId.tr, no: no, from: 'WH', to: t[0], status: 'shipped', created: ts, shippedAt: ts, expected: addDays(date, t[2]), receivedAt: '', lines: lines, receipts: [], note: 'Replenishment' };
      lines.forEach(function (l) {
        addStock(l.pid, 'WH', -l.qty);
        mv({ ts: ts, type: 'transfer', stage: 'ship', pid: l.pid, loc: 'WH', to: t[0], qty: l.qty, cost: byPid[l.pid].cost, ref: no, note: 'Shipped · in transit' });
      });
      transfers.push(tr);
    });

    // A few customer returns in the last months (credit notes, refunded because retail sales were paid)
    var damaged = {}, creditNotes = [];
    (function () {
      var cands = sos.filter(function (so) {
        return so.status === 'invoiced' && LOCATIONS.filter(function (l) { return l.id === so.loc; })[0].kind === 'store' && so.date >= addDays(today, -120) && so.date <= addDays(today, -15) &&
          so.lines.some(function (l) { return byPid[l.pid].cat === 'Frames' || byPid[l.pid].cat === 'Sunglasses'; });
      });
      var picked = [];
      for (var i = 0; i < 4 && cands.length; i++) picked.push(cands.splice(int(0, cands.length - 1), 1)[0]);
      picked.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
      picked.forEach(function (so, i) {
        var inv = invoices.filter(function (x) { return x.id === so.invoiceId; })[0];
        var l = so.lines.filter(function (x) { return byPid[x.pid].cat === 'Frames' || byPid[x.pid].cat === 'Sunglasses'; })[0];
        var cond = i === 2 ? 'damaged' : 'resellable', date = addDays(inv.date, int(2, 10));
        var t = docTotals([{ qty: 1, price: l.price, disc: l.disc }], so.vat);
        var cn = { id: ++nextId.cn, no: docNo('CN', date), date: date, invoiceId: inv.id, soId: so.id, customerId: so.customerId, loc: so.loc, vat: so.vat,
          lines: [{ pid: l.pid, qty: 1, price: l.price, disc: l.disc, cond: cond, cost: l.cost }], net: t.net, vatAmt: t.vat, total: t.total,
          reason: cond === 'damaged' ? 'Defective' : pick(['Customer return', 'Wrong size / fit']), note: '', applied: 0,
          refund: { amount: t.total, date: date, method: inv.payments.length ? inv.payments[0].method : 'Card' }, created: date + 'T' + hhmm() };
        creditNotes.push(cn);
        if (cond === 'damaged') { damaged[l.pid] = damaged[l.pid] || {}; damaged[l.pid][so.loc] = (damaged[l.pid][so.loc] || 0) + 1; }
        else addStock(l.pid, so.loc, 1);
        mv({ ts: cn.created, type: 'return', pid: l.pid, loc: so.loc, qty: 1, cost: l.cost, ref: 'CN:' + cn.id, note: cn.reason + ' · ' + (cond === 'damaged' ? 'Damaged' : 'Resellable'), bucket: cond === 'damaged' ? 'damaged' : undefined });
      });
    })();

    // Open sales quotes for B2B customers
    var quotes = [];
    (function () {
      var qs = [[-45, 'sent'], [-20, 'sent'], [-12, 'sent'], [-6, 'sent'], [-3, 'draft'], [-1, 'draft']];
      qs.forEach(function (q) {
        var date = addDays(today, q[0]), c = pick(b2bCust), d = pick([10, 12, 15]), used2 = {}, lines = [];
        var n = int(2, 4);
        for (var i = 0; i < n; i++) {
          var p = pick(products.filter(function (x) { return !used2[x.id] && x.cat !== 'Accessories'; }));
          used2[p.id] = 1;
          lines.push({ pid: p.id, qty: p.cat === 'Contact lenses' || p.cat === 'Solutions' ? int(6, 20) : int(2, 6), price: p.price, disc: d, cost: p.cost });
        }
        quotes.push({ id: ++nextId.quote, no: docNo('QT', date), date: date, validUntil: addDays(date, 30), customerId: c.id, loc: 'WH', vat: VAT.SI,
          status: q[1], lines: lines, orderId: null, note: q[1] === 'sent' ? 'Sent to buyer by e-mail' : '', created: date + 'T' + hhmm() });
      });
    })();

    // final stock (clean zeros)
    var finalStock = {};
    products.forEach(function (p) {
      finalStock[p.id] = {};
      Object.keys(stock[p.id]).forEach(function (l) { if (stock[p.id][l]) finalStock[p.id][l] = stock[p.id][l]; });
    });

    return {
      version: VERSION, generatedFor: today,
      nextId: nextId, seq: seq,
      suppliers: suppliers, products: products, customers: customers,
      stock: finalStock, sos: sos, pos: pos, invoices: invoices, movements: movements,
      creditNotes: creditNotes, damaged: damaged, quotes: quotes, counts: [], transfers: transfers
    };
  }

  window.ERPData = { VERSION: VERSION, LOCATIONS: LOCATIONS, VAT: VAT, CATEGORIES: CATEGORIES, generate: generate, util: { pad: pad, ymd: ymd, parse: parse, addDays: addDays, r2: r2, lineNet: lineNet, docTotals: docTotals } };
})();
