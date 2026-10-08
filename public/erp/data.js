/* ERPData: constants and the deterministic demo-data generator for the ERP demo (optical retailer). */
(function () {
  'use strict';
  var VERSION = 3, DAYS = 365;
  var LOCATIONS = [
    { id: 'WH', name: 'Central warehouse', type: 'wh', country: 'SI' },
    { id: 'ESHOP', name: 'E-shop', type: 'web', country: 'SI' },
    { id: 'SI-KOM', name: 'Komenda store', type: 'store', country: 'SI' },
    { id: 'SI-KP', name: 'Koper store', type: 'store', country: 'SI' },
    { id: 'SI-MB', name: 'Maribor store', type: 'store', country: 'SI' },
    { id: 'SI-NM', name: 'Novo Mesto store', type: 'store', country: 'SI' },
    { id: 'HR-ZG', name: 'Zagreb store', type: 'store', country: 'HR' },
    { id: 'HR-ST', name: 'Split store', type: 'store', country: 'HR' },
    { id: 'HR-RI', name: 'Rijeka store', type: 'store', country: 'HR' },
    { id: 'HR-ZD', name: 'Zadar store', type: 'store', country: 'HR' },
    { id: 'HR-OS', name: 'Osijek store', type: 'store', country: 'HR' }
  ];
  var VAT = { SI: 22, HR: 25 };
  var CATEGORIES = [
    { id: 'frames', name: 'Frames', prefix: 'FR', n: 40, cost: [18, 45] },
    { id: 'sun', name: 'Sunglasses', prefix: 'SG', n: 25, cost: [25, 70] },
    { id: 'contacts', name: 'Contact lenses', prefix: 'CL', n: 20, cost: [8, 30] },
    { id: 'solutions', name: 'Solutions', prefix: 'SL', n: 10, cost: [3, 9] },
    { id: 'lenses', name: 'Optical lenses', prefix: 'OL', n: 12, cost: [12, 60] },
    { id: 'acc', name: 'Accessories', prefix: 'AC', n: 13, cost: [1, 8] }
  ];
  var DOC = { SO: ['SO-', 5], PO: ['PO-', 4], INV: ['', 6], TR: ['TR-', 5], CN: ['CN-', 5], QT: ['QT-', 5], CNT: ['CNT-', 4] };

  function p2(n) { return (n < 10 ? '0' : '') + n; }
  function parse(s) { var p = s.split('-'); return Date.UTC(+p[0], p[1] - 1, +p[2]); }
  var U = {
    ymd: function (d) { return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); },
    add: function (s, n) { return new Date(parse(s) + n * 864e5).toISOString().slice(0, 10); },
    diff: function (a, b) { return Math.round((parse(a) - parse(b)) / 864e5); },
    dow: function (s) { return new Date(parse(s)).getUTCDay(); },
    r2: function (n) { return Math.round((n + 1e-9) * 100) / 100; }
  };
  function rng(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function docNo(seq, kind, date) {
    var d = DOC[kind], y = date.slice(0, 4), k = kind + y;
    seq[k] = (seq[k] || 0) + 1;
    return d[0] + y + '-' + ('000000' + seq[k]).slice(-d[1]);
  }

  var SUPPLIERS = [
    ['Luxora Eyewear S.p.A.', 'IT', 12], ['Vitrum Frames GmbH', 'DE', 8], ['Nordic Optik AB', 'SE', 10], ['Lumiere Montures SAS', 'FR', 9],
    ['SunVista Distribution', 'ES', 11], ['ClearView Contacts Ltd', 'IE', 7], ['Optilens Medical d.o.o.', 'SI', 3], ['PureSight Labs', 'NL', 6],
    ['Kristal Lens Group', 'AT', 5], ['Alpine Optical Supply', 'CH', 8], ['Zagreb Optika Veleprodaja', 'HR', 2], ['CasePro Accessories', 'PL', 9], ['Mediterraneo Glass', 'IT', 10]
  ];
  var BRANDS = ['Aurelia', 'Brenner', 'Corvo', 'Delmar', 'Elan', 'Fjord', 'Gaia', 'Halden', 'Iris', 'Jura', 'Kestrel', 'Lumen'];
  var MODELS = ['Classic', 'Aviator', 'Round', 'Square', 'Cat-eye', 'Panto', 'Slim', 'Titan', 'Air', 'Urban', 'Retro', 'Sport', 'Studio', 'Metro'];
  var NAMES = {
    contacts: ['Daily 30-pack', 'Monthly 6-pack', 'Toric daily 30', 'Multifocal monthly', 'Colour daily 10', 'Silicone hydrogel 90', 'Weekly 6-pack'],
    solutions: ['All-in-one solution 360 ml', 'Saline 100 ml', 'Cleaning spray 30 ml', 'Eye drops 10 ml', 'Peroxide solution 360 ml'],
    lenses: ['Single vision 1.5', 'Single vision 1.6 AR', 'Progressive 1.6', 'Blue-light filter 1.5', 'Photochromic 1.6', 'High-index 1.74'],
    acc: ['Hard case', 'Soft pouch', 'Cleaning cloth', 'Neck cord', 'Nose pads', 'Repair kit', 'Lens wipes 50', 'Travel case']
  };
  var FIRST = ['Ana', 'Marko', 'Petra', 'Luka', 'Nina', 'Matej', 'Ivana', 'Josip', 'Maja', 'Tomislav', 'Sara', 'Andrej', 'Katja', 'Ivan', 'Eva', 'Dario', 'Mia', 'Jan', 'Lara', 'Filip'];
  var LAST = ['Novak', 'Horvat', 'Kovač', 'Krajnc', 'Zupan', 'Babić', 'Marić', 'Potočnik', 'Kos', 'Vidmar', 'Jurić', 'Petrović', 'Golob', 'Knez', 'Pavlović'];
  var CITIES = { SI: ['Ljubljana', 'Maribor', 'Koper', 'Celje', 'Kranj', 'Novo Mesto'], HR: ['Zagreb', 'Split', 'Rijeka', 'Zadar', 'Osijek', 'Pula'] };

  function generate(today) {
    var R = rng(0xAD71A1);
    var db = { version: VERSION, generatedFor: today, nextId: 1, seq: {}, suppliers: [], products: [], customers: [], stock: {}, sos: [], pos: [], invoices: [], movements: [], creditNotes: [], damaged: [], quotes: [], counts: [], transfers: [] };
    function id() { return db.nextId++; }
    function ri(a, b) { return a + Math.floor(R() * (b - a + 1)); }
    function pick(a) { return a[Math.floor(R() * a.length)]; }
    function no(kind, date) { return docNo(db.seq, kind, date); }
    var cat = {};
    CATEGORIES.forEach(function (c) { cat[c.id] = c; });

    SUPPLIERS.forEach(function (s) { db.suppliers.push({ id: id(), name: s[0], country: s[1], leadDays: s[2], currency: 'EUR', email: 'orders@' + s[0].toLowerCase().replace(/[^a-z]+/g, '') + '.example.com' }); });
    CATEGORIES.forEach(function (c, ci) {
      for (var i = 0; i < c.n; i++) {
        var name = NAMES[c.id] ? NAMES[c.id][i % NAMES[c.id].length] + (i >= NAMES[c.id].length ? ' ' + String.fromCharCode(65 + Math.floor(i / NAMES[c.id].length)) : '')
          : pick(BRANDS) + ' ' + MODELS[i % MODELS.length] + ' ' + (100 + i * 7);
        var cost = U.r2(c.cost[0] + R() * (c.cost[1] - c.cost[0]));
        var price = Math.floor(cost * (1.9 + R() * 0.9)) + 0.9;
        db.products.push({ id: id(), sku: c.prefix + '-' + (1001 + i), name: name, cat: c.id, cost: cost, price: price, supplierId: db.suppliers[(ci * 2 + ri(0, 1)) % db.suppliers.length].id });
      }
    });
    var walk = {};
    ['SI', 'HR'].forEach(function (cc) { var c = { id: id(), name: 'Walk-in customer (' + cc + ')', type: 'walkin', country: cc, vatId: '', email: '', city: '', terms: 0 }; walk[cc] = c; db.customers.push(c); });
    var b2b = [], b2c = [], OPT = ['Optika', 'Vid', 'Okular', 'Pogled', 'Zornica', 'Oko', 'Vizija', 'Fokus', 'Dioptrija', 'Lupa', 'Bistro oko'];
    for (var ci = 0; ci < 22; ci++) {
      var cc = ci % 3 === 2 ? 'HR' : 'SI', city = pick(CITIES[cc]);
      var cu = { id: id(), name: OPT[ci % OPT.length] + ' ' + city + (ci >= OPT.length ? ' 2' : '') + (cc === 'SI' ? ' d.o.o.' : ' d.o.o.'), type: 'B2B', country: cc, vatId: cc + String(10000000 + ri(0, 8999999)) + (cc === 'HR' ? '123' : ''), email: 'purchasing' + (ci + 1) + '@example.com', city: city, terms: pick([14, 30, 30, 45]) };
      b2b.push(cu); db.customers.push(cu);
    }
    for (ci = 0; ci < 40; ci++) {
      cc = R() < 0.6 ? 'SI' : 'HR';
      var nm = pick(FIRST) + ' ' + pick(LAST);
      cu = { id: id(), name: nm, type: 'B2C', country: cc, vatId: '', email: nm.toLowerCase().replace(/[^a-z]+/g, '.') + ci + '@example.com', city: pick(CITIES[cc]), terms: 0 };
      b2c.push(cu); db.customers.push(cu);
    }

    var st = db.stock, byId = {}, stores = LOCATIONS.filter(function (l) { return l.type === 'store'; });
    db.products.forEach(function (p) { byId[p.id] = p; });
    function move(date, pid, loc, qty, type, ref) {
      st[pid][loc] = (st[pid][loc] || 0) + qty;
      if (st[pid][loc] < 0) throw new Error('negative stock ' + pid + ' ' + loc);
      db.movements.push({ id: id(), date: date, pid: pid, loc: loc, qty: qty, type: type, ref: ref || '' });
    }
    function availAt(pid, loc) { return st[pid][loc] || 0; }
    var start = U.add(today, -DAYS);
    db.products.forEach(function (p) {
      st[p.id] = {};
      var big = p.cat === 'contacts' || p.cat === 'solutions';
      LOCATIONS.forEach(function (l) {
        var q = l.id === 'WH' ? (big ? ri(150, 300) : p.cat === 'lenses' ? ri(40, 90) : ri(70, 140)) : l.id === 'ESHOP' ? ri(10, 24) : ri(6, 14);
        move(start, p.id, l.id, q, 'init', 'Opening stock');
      });
    });

    function totals(lines, country) {
      var net = 0; lines.forEach(function (l) { net += l.qty * l.price; }); net = U.r2(net);
      var vat = U.r2(net * VAT[country] / 100);
      return { net: net, vat: vat, total: U.r2(net + vat) };
    }
    function sell(date, loc, channel, cust, nLines, qtyMax, disc) {
      var lines = [], used = {}, t;
      for (var k = 0; k < nLines; k++) {
        var p = db.products[Math.floor(R() * R() * db.products.length)];
        if (used[p.id]) continue;
        var q = ri(1, qtyMax); if (availAt(p.id, loc) < q) q = availAt(p.id, loc);
        if (q < 1) continue;
        used[p.id] = 1; lines.push({ pid: p.id, qty: q, price: U.r2(p.price * (1 - disc)) });
      }
      if (!lines.length) return;
      var country = channel === 'store' ? LOCATIONS.filter(function (l) { return l.id === loc; })[0].country : cust.country;
      t = totals(lines, country);
      var so = { id: id(), no: no('SO', date), date: date, custId: cust.id, loc: loc, channel: channel, status: 'invoiced', country: country, lines: lines };
      lines.forEach(function (l) { move(date, l.pid, loc, -l.qty, 'sale', so.no); });
      var due = U.add(date, cust.terms || 0);
      var inv = { id: id(), no: no('INV', date), date: date, due: due, soId: so.id, custId: cust.id, loc: loc, country: country, lines: lines.map(function (l) { return { pid: l.pid, qty: l.qty, price: l.price }; }), net: t.net, vat: t.vat, total: t.total, payments: [] };
      if (!cust.terms) inv.payments.push({ date: date, amount: t.total, method: channel === 'eshop' ? 'online' : (R() < 0.6 ? 'card' : 'cash') });
      else { var pd = U.add(due, ri(-5, 15)); if (pd <= today && R() < 0.9) inv.payments.push({ date: pd, amount: t.total, method: 'bank' }); }
      so.invoiceId = inv.id; db.sos.push(so); db.invoices.push(inv);
    }
    function supplierOrder(sup, lines, date, recvDate) {
      var po = { id: id(), no: no('PO', date), date: date, supplierId: sup.id, status: 'received', cur: 'EUR', lines: lines };
      lines.forEach(function (l) { l.recv = l.qty; move(recvDate, l.pid, 'WH', l.qty, 'receipt', po.no); });
      db.pos.push(po);
    }

    for (var i = -DAYS + 1; i <= 0; i++) {
      var d = U.add(today, i), dw = U.dow(d);
      if (dw === 1) {
        var groups = {};
        db.products.forEach(function (p) {
          var big = p.cat === 'contacts' || p.cat === 'solutions';
          if (availAt(p.id, 'WH') < (big ? 70 : 35)) (groups[p.supplierId] = groups[p.supplierId] || []).push({ pid: p.id, qty: big ? ri(120, 220) : ri(50, 100), cost: p.cost });
        });
        Object.keys(groups).forEach(function (sid) { var sup = db.suppliers.filter(function (s) { return s.id == sid; })[0]; supplierOrder(sup, groups[sid], U.add(d, -sup.leadDays), d); });
      }
      if (i % 14 === 0) {
        LOCATIONS.slice(1).forEach(function (l) {
          var ls = [];
          db.products.forEach(function (p, pi) { var q = 10 - availAt(p.id, l.id); if (pi < 70 && q >= 5 && availAt(p.id, 'WH') > q + 25 && ls.length < 14) ls.push({ pid: p.id, qty: q }); });
          if (!ls.length) return;
          var tr = { id: id(), no: no('TR', d), date: d, from: 'WH', to: l.id, status: 'received', lines: ls, shippedAt: d, receivedAt: d };
          ls.forEach(function (x) { move(d, x.pid, 'WH', -x.qty, 'transfer_out', tr.no); move(d, x.pid, l.id, x.qty, 'transfer_in', tr.no); });
          db.transfers.push(tr);
        });
      }
      stores.forEach(function (l) { if (R() < (dw === 0 ? 0.15 : dw === 6 ? 0.6 : 0.4)) sell(d, l.id, 'store', R() < 0.75 ? walk[l.country] : pick(b2c), ri(1, 2), 2, 0); });
      var ne = R() < 0.5 ? 1 : R() < 0.5 ? 2 : 0;
      for (var e = 0; e < ne; e++) sell(d, 'ESHOP', 'eshop', pick(b2c), ri(1, 3), 2, 0);
      if (dw >= 1 && dw <= 5 && R() < 0.45) sell(d, 'WH', 'b2b', pick(b2b), ri(2, 5), 8, 0.15);
      if (i % 9 === 0) {
        var l2 = pick(stores), pr = pick(db.products);
        if (availAt(pr.id, l2.id) > 1) { move(d, pr.id, l2.id, -1, 'adjust', 'Damaged'); db.damaged.push({ id: id(), date: d, pid: pr.id, loc: l2.id, qty: 1, reason: pick(['Scratched lens', 'Broken hinge', 'Packaging damaged']) }); }
      }
    }
    // partial receipt, draft PO, transfers in transit, credit notes, quotes
    var s0 = db.suppliers[0], pf = db.products.filter(function (p) { return p.supplierId === s0.id; }).slice(0, 2);
    var ppo = { id: id(), no: no('PO', U.add(today, -6)), date: U.add(today, -6), supplierId: s0.id, status: 'partial', cur: 'EUR', lines: pf.map(function (p, k) { return { pid: p.id, qty: 50, cost: p.cost, recv: k ? 0 : 20 }; }) };
    move(U.add(today, -2), pf[0].id, 'WH', 20, 'receipt', ppo.no); db.pos.push(ppo);
    var s1 = db.suppliers[1], pg = db.products.filter(function (p) { return p.supplierId === s1.id; }).slice(0, 3);
    db.pos.push({ id: id(), no: no('PO', today), date: today, supplierId: s1.id, status: 'draft', cur: 'EUR', lines: pg.map(function (p) { return { pid: p.id, qty: 40, cost: p.cost, recv: 0 }; }) });
    ['SI-KP', 'HR-ZG', 'HR-ST'].forEach(function (to, k) {
      var dt = U.add(today, -1 - k), ls = db.products.slice(k * 4, k * 4 + 3).map(function (p) { return { pid: p.id, qty: 4 }; });
      var tr = { id: id(), no: no('TR', dt), date: dt, from: 'WH', to: to, status: 'shipped', lines: ls, shippedAt: dt };
      ls.forEach(function (x) { move(dt, x.pid, 'WH', -x.qty, 'transfer_out', tr.no); }); db.transfers.push(tr);
    });
    var recent = db.invoices.filter(function (v) { return v.payments.length && !db.customers.filter(function (c) { return c.id === v.custId; })[0].terms && v.date >= U.add(today, -30); }).slice(-4);
    recent.forEach(function (v) {
      var l = v.lines[0], t = totals([{ qty: 1, price: l.price }], v.country), dt = U.add(v.date, 1) > today ? today : U.add(v.date, 1);
      db.creditNotes.push({ id: id(), no: no('CN', dt), date: dt, invoiceId: v.id, custId: v.custId, loc: v.loc, country: v.country, reason: 'Customer return', lines: [{ pid: l.pid, qty: 1, price: l.price }], net: t.net, vat: t.vat, total: t.total, restock: true });
      v.payments.push({ date: dt, amount: -t.total, method: 'refund' });
      move(dt, l.pid, v.loc, 1, 'return', 'CN');
    });
    var qs = ['sent', 'draft', 'accepted', 'sent', 'sent', 'draft'];
    qs.forEach(function (s, k) {
      var dt = U.add(today, -[3, 1, 12, 50, 8, 0][k]), ls = [0, 1, 2].map(function (j) { var p = db.products[(k * 5 + j * 3) % 40]; return { pid: p.id, qty: ri(5, 20), price: U.r2(p.price * 0.85) }; });
      db.quotes.push({ id: id(), no: no('QT', dt), date: dt, valid: U.add(dt, 30), custId: b2b[k].id, status: s, lines: ls, country: b2b[k].country });
    });
    return db;
  }

  window.ERPData = { VERSION: VERSION, DAYS: DAYS, LOCATIONS: LOCATIONS, VAT: VAT, CATEGORIES: CATEGORIES, U: U, rng: rng, docNo: docNo, generate: generate };
})();
