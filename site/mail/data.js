/* Adrial Mail — seeded, deterministic demo data: ~3,000 fictional profiles (emails @example.*, fake
 * phones), shopping events, lists, segments, templates, 12 months of sent campaigns + SMS, flows with
 * history (run through the same flow engine), sign-up forms. Nothing here is real. */
(function () {
  'use strict';
  var AM = window.AM, U = AM.U, DAY = U.DAY, HOUR = U.HOUR;
  var D = AM.Data = {};
  D.VERSION = 3;
  D.SEED = 20261007;
  D.N = 3000;

  D.PRODUCTS = [
    ['FR-1001', 'Lumen Round 52 Black', 'Frames', 'Lumen', 129], ['FR-1002', 'Vista Nord Square Tortoise', 'Frames', 'Vista Nord', 149], ['FR-1003', 'Adria Classic Cat-eye Burgundy', 'Frames', 'Adria Eyewear', 119],
    ['FR-1004', 'Kras Titanium Rimless', 'Frames', 'Kras', 229], ['FR-1005', 'Soča Acetate Clear', 'Frames', 'Adria Eyewear', 99], ['FR-1006', 'Piran Oval Gold', 'Frames', 'Lumen', 139],
    ['FR-1007', 'Bled Browline Havana', 'Frames', 'Vista Nord', 159], ['FR-1008', 'Triglav Sport Matte Grey', 'Frames', 'Kras', 109], ['FR-1009', 'Kvarner Kids Blue', 'Frames', 'Adria Eyewear', 69], ['FR-1010', 'Lika Panto Crystal Pink', 'Frames', 'Lumen', 119],
    ['SG-2001', 'Solaro Aviator Gold G15', 'Sunglasses', 'Solaro', 139], ['SG-2002', 'Solaro Wayfarer Polarised', 'Sunglasses', 'Solaro', 159], ['SG-2003', 'Riva Cat-eye Tortoise', 'Sunglasses', 'Riva', 99],
    ['SG-2004', 'Marina Round Mirror Blue', 'Sunglasses', 'Riva', 89], ['SG-2005', 'Istra Sport Wrap', 'Sunglasses', 'Solaro', 119], ['SG-2006', 'Dalmacija Oversized Black', 'Sunglasses', 'Riva', 79],
    ['SG-2007', 'Opatija Clubmaster Brown', 'Sunglasses', 'Solaro', 129], ['SG-2008', 'Hvar Kids Sun Pink', 'Sunglasses', 'Riva', 39], ['SG-2009', 'Portorož Pilot Silver', 'Sunglasses', 'Solaro', 149],
    ['CL-3001', 'AquaLens Daily 30 pack', 'Contact lenses', 'AquaLens', 24.9], ['CL-3002', 'AquaLens Daily 90 pack', 'Contact lenses', 'AquaLens', 64.9], ['CL-3003', 'ClearView Monthly 6 pack', 'Contact lenses', 'ClearView', 29.9],
    ['CL-3004', 'ClearView Toric Monthly 3 pack', 'Contact lenses', 'ClearView', 34.9], ['CL-3005', 'OptiSoft Bi-weekly 6 pack', 'Contact lenses', 'OptiSoft', 21.9], ['CL-3006', 'AquaLens Multifocal Daily 30', 'Contact lenses', 'AquaLens', 39.9],
    ['CL-3007', 'ClearView Colour Monthly 2 pack', 'Contact lenses', 'ClearView', 27.9], ['CL-3008', 'OptiSoft Daily Comfort 30', 'Contact lenses', 'OptiSoft', 22.9],
    ['SO-4001', 'OptiSoft All-in-one 360 ml', 'Solutions', 'OptiSoft', 11.9], ['SO-4002', 'OptiSoft Travel Pack 2×100 ml', 'Solutions', 'OptiSoft', 9.9], ['SO-4003', 'Peroxide Care 360 ml', 'Solutions', 'ClearView', 14.9],
    ['SO-4004', 'Hydra Eye Drops 10 ml', 'Solutions', 'AquaLens', 8.9], ['SO-4005', 'Saline Rinse 360 ml', 'Solutions', 'OptiSoft', 6.9],
    ['OL-5001', 'Single vision lens 1.6 AR', 'Optical lenses', 'Adria Lab', 89], ['OL-5002', 'Progressive Comfort 1.6', 'Optical lenses', 'Adria Lab', 289], ['OL-5003', 'Blue-filter lens 1.5 AR', 'Optical lenses', 'Adria Lab', 69], ['OL-5004', 'Photochromic lens 1.6', 'Optical lenses', 'Adria Lab', 149],
    ['AC-6001', 'Microfibre cloth 3 pack', 'Accessories', 'Adria', 7.9], ['AC-6002', 'Hard case Teal', 'Accessories', 'Adria', 14.9], ['AC-6003', 'Lens case set', 'Accessories', 'Adria', 4.9], ['AC-6004', 'Anti-fog spray 30 ml', 'Accessories', 'Adria', 9.9]
  ].map(function (a) { return { sku: a[0], name: a[1], category: a[2], brand: a[3], price: a[4] }; });

  var SI_F = ['Ana', 'Maja', 'Nina', 'Eva', 'Sara', 'Petra', 'Mojca', 'Katja', 'Tina', 'Urška', 'Špela', 'Tjaša', 'Lara', 'Neža', 'Zala', 'Manca', 'Mateja', 'Barbara', 'Nataša', 'Alenka'];
  var SI_M = ['Luka', 'Jan', 'Žiga', 'Matej', 'Rok', 'Nejc', 'Tilen', 'Blaž', 'Gregor', 'Miha', 'Andrej', 'Marko', 'Aljaž', 'Klemen', 'Jure', 'Boštjan', 'Primož', 'Uroš', 'David', 'Anže'];
  var SI_L = ['Novak', 'Horvat', 'Kovačič', 'Krajnc', 'Zupančič', 'Potočnik', 'Kovač', 'Mlakar', 'Kos', 'Vidmar', 'Golob', 'Turk', 'Božič', 'Kralj', 'Zupan', 'Bizjak', 'Hribar', 'Korošec', 'Rozman', 'Kotnik', 'Oblak', 'Petek', 'Kastelic', 'Kolar', 'Žagar'];
  var HR_F = ['Ivana', 'Ana', 'Marija', 'Petra', 'Lucija', 'Mia', 'Ema', 'Lana', 'Nikolina', 'Dora', 'Katarina', 'Iva', 'Martina', 'Josipa', 'Tea', 'Sanja', 'Marina', 'Antonija', 'Helena', 'Klara'];
  var HR_M = ['Ivan', 'Marko', 'Luka', 'Josip', 'Tomislav', 'Matej', 'Ante', 'Filip', 'Karlo', 'Stjepan', 'Domagoj', 'Hrvoje', 'Dario', 'Mario', 'Nikola', 'Petar', 'Toni', 'Bruno', 'Dino', 'Fran'];
  var HR_L = ['Horvat', 'Kovačević', 'Babić', 'Marić', 'Jurić', 'Novak', 'Kovačić', 'Knežević', 'Vuković', 'Marković', 'Petrović', 'Matić', 'Tomić', 'Pavlović', 'Božić', 'Blažević', 'Grgić', 'Pavić', 'Radić', 'Perić', 'Šarić', 'Lovrić', 'Vidović', 'Perković', 'Bašić'];
  var SI_C = ['Ljubljana', 'Ljubljana', 'Ljubljana', 'Maribor', 'Maribor', 'Celje', 'Kranj', 'Koper', 'Novo mesto', 'Velenje', 'Nova Gorica', 'Murska Sobota', 'Ptuj', 'Domžale'];
  var HR_C = ['Zagreb', 'Zagreb', 'Zagreb', 'Split', 'Split', 'Rijeka', 'Osijek', 'Zadar', 'Pula', 'Varaždin', 'Šibenik', 'Dubrovnik', 'Karlovac'];
  var SI_STORES = ['Ljubljana Center', 'Ljubljana BTC', 'Maribor', 'Celje', 'Koper', 'Kranj', 'Novo mesto'];
  var HR_STORES = ['Zagreb Ilica', 'Zagreb Arena', 'Split', 'Rijeka', 'Osijek', 'Zadar'];
  var SI_MON = ['januar', 'februar', 'marec', 'april', 'maj', 'junij', 'julij', 'avgust', 'september', 'oktober', 'november', 'december'];
  var HR_MON = ['siječanj', 'veljača', 'ožujak', 'travanj', 'svibanj', 'lipanj', 'srpanj', 'kolovoz', 'rujan', 'listopad', 'studeni', 'prosinac'];

  function fillStatic(design, products, cat, r) {
    design.blocks.forEach(function (b) {
      if (b.type === 'products' && b.mode === 'static' && (!b.skus || !b.skus.length)) {
        var pool = products.filter(function (p) { return p.category === cat; }); if (pool.length < 3) pool = products;
        b.skus = pool.slice(0, 6).map(function (p) { return p.sku; }).filter(function (s, i) { return i < 3; });
      }
    });
    return design;
  }
  D.fillStatic = fillStatic;

  D.generate = function (products) {
    var E = AM.E, r = U.rng(D.SEED);
    var anchor = Math.floor(Date.now() / 60e3) * 60e3;
    var products0 = products && products.length ? products : D.PRODUCTS;
    var db = {
      meta: { version: D.VERSION, seed: D.SEED, anchor: anchor, clockOffset: 0, ids: {}, lastDateCheck: anchor, productSource: products && products.length ? 'erp.catalog' : 'built-in' },
      settings: { openWin: 5, clickWin: 5, smsWin: 1, senderName: 'Adrial Optika', senderEmail: 'novice@example.si', replyTo: 'pomoc@example.si', smsSender: 'ADRIAL', smsCost: 0.045 },
      products: products0.map(function (p) { return { sku: String(p.sku), name: String(p.name), category: String(p.category || 'Other'), brand: String(p.brand || ''), price: +p.price || 0 }; }),
      profiles: [], events: [], lists: [], segments: [], campaigns: [], flows: [], templates: [], forms: [], runs: []
    };
    var P = db.products, byCat = {};
    P.forEach(function (p) { (byCat[p.category] = byCat[p.category] || []).push(p); });
    var catPool = function (c) { return byCat[c] && byCat[c].length ? byCat[c] : P; };
    var ev = db.events;
    var start18 = anchor - 540 * DAY;
    var emails = new Set();

    // Lists (members filled below)
    var L = {};
    [['si', 'Newsletter SI', 'Slovenian newsletter subscribers (moje-lece.si, SI stores).', 'double'], ['hr', 'Newsletter HR', 'Croatian newsletter subscribers (adrialece.hr, HR stores).', 'double'],
      ['vip', 'VIP customers', 'Top ~6% customers by spend — early access and private offers.', 'single'], ['lens', 'Contact-lens subscribers', 'Contact-lens wearers who opted in to reorder reminders.', 'single'],
      ['sms', 'SMS subscribers', 'Profiles with SMS consent (SI + HR).', 'single'], ['store', 'In-store sign-ups', 'Signed up on the store tablet.', 'single'], ['test', 'Internal test list', 'Seed list for test sends (demo).', 'single']
    ].forEach(function (a, i) { var l = { id: i + 1, key: a[0], name: a[1], desc: a[2], optin: a[3], created: anchor - (900 - i * 40) * DAY, members: [] }; db.lists.push(l); L[a[0]] = l; });
    db.meta.ids.list = db.lists.length;
    var FORMS = { si: 1, hr: 2, footer: 3, exit: 4 };

    // ── Profiles + base shopping events ─────────────────────────────────
    for (var i = 1; i <= D.N; i++) {
      var si = r() < 0.58, male = r() < 0.42;
      var first = U.pick(r, si ? (male ? SI_M : SI_F) : (male ? HR_M : HR_F)), last = U.pick(r, si ? SI_L : HR_L);
      var lang = si ? (r() < 0.9 ? 'sl' : 'en') : (r() < 0.9 ? 'hr' : 'en');
      var created = anchor - Math.floor(1095 * Math.pow(r(), 1.5)) * DAY - U.int(r, 0, 23) * HOUR - U.int(r, 0, 59) * 60e3;
      var source = U.wpick(r, [['Checkout', 40], ['Popup form', 22], ['Footer form', 9], ['In-store tablet', 16], ['Import 2023', created < anchor - 700 * DAY ? 10 : 0], ['Contest', 4]]);
      var dom = si ? U.wpick(r, [['example.si', 6], ['example.com', 4]]) : U.wpick(r, [['example.hr', 6], ['example.com', 4]]);
      var local = U.deaccent(first.toLowerCase()) + '.' + U.deaccent(last.toLowerCase()), email = local + '@' + dom;
      while (emails.has(email)) email = local + U.int(r, 2, 99) + '@' + dom;
      emails.add(email);
      var phone = r() < 0.72 ? (si ? '+386 00 5' : '+385 00 5') + U.int(r, 10, 99) + ' ' + U.int(r, 100, 999) : '';
      var eng = Math.pow(r(), 1.35);
      var emS = source === 'Checkout' ? (r() < 0.6 ? 'subscribed' : 'never') : 'subscribed';
      var smsS = phone && r() < 0.34 ? 'subscribed' : 'never';
      var props = { preferred_store: U.pick(r, si ? SI_STORES : HR_STORES) };
      var lensSku = null;
      if (r() < 0.27) {
        props.lens_supply_days = U.wpick(r, [[30, 25], [90, 50], [180, 25]]);
        var lp = U.pick(r, catPool('Contact lenses')); lensSku = lp.sku; props.lens_brand = lp.brand || lp.name.split(' ')[0];
      }
      if (r() < 0.55) props.next_eye_exam = U.ymd(anchor + U.int(r, -150, 330) * DAY);
      var by = U.int(r, 1952, 2006);
      var p = { id: i, first: first, last: last, email: email, phone: phone, country: si ? 'SI' : 'HR', lang: lang, city: U.pick(r, si ? SI_C : HR_C), source: source, created: created,
        birthday: by + '-' + U.p2(U.int(r, 1, 12)) + '-' + U.p2(U.int(r, 1, 28)), em: { s: emS, at: created }, sms: { s: smsS, at: created }, sup: null, props: props, eng: Math.round(eng * 1000) / 1000 };
      db.profiles.push(p);

      if (emS === 'subscribed') { (si ? L.si : L.hr).members.push(i); ev.push({ p: i, t: 'sub', ts: created, r: (si ? L.si : L.hr).id }); }
      if (source === 'In-store tablet') L.store.members.push(i);
      if (smsS === 'subscribed') L.sms.members.push(i);
      if (lensSku && emS === 'subscribed' && r() < 0.8) L.lens.members.push(i);
      if (source === 'Popup form' || source === 'Footer form') ev.push({ p: i, t: 'form', ts: created - 5000, r: source === 'Footer form' ? FORMS.footer : si ? FORMS.si : FORMS.hr });

      var from = Math.max(created, start18), span = anchor - from;
      if (span <= DAY) continue;
      // events spread at a constant rate per profile (not squeezed into short histories)
      var at = function () { var t = from + Math.floor(r() * 540 * DAY); return t < anchor - HOUR ? t : null; };
      var shop = function (ts, cat, buy, prodOverride) {
        var prod = prodOverride || U.pick(r, catPool(cat)), t = ts;
        if (!prodOverride) {
          var nv = U.int(r, 1, 4);
          for (var k = 0; k < nv; k++) { var pv = k === nv - 1 ? prod : U.pick(r, catPool(cat)); ev.push({ p: i, t: 'view', ts: t, s: pv.sku }); t += U.int(r, 1, 9) * 60e3; }
          ev.push({ p: i, t: 'cart', ts: t, s: prod.sku, v: prod.price }); t += U.int(r, 1, 15) * 60e3;
        }
        var val = cat === 'Contact lenses' ? Math.round(prod.price * Math.max(1, Math.round((props.lens_supply_days || 90) / 30)) * 100) / 100 : Math.round(prod.price * (r() < 0.12 ? 2 : 1) * 100) / 100;
        ev.push({ p: i, t: 'checkout', ts: t, s: prod.sku, v: val }); t += U.int(r, 2, 12) * 60e3;
        if (buy && t < anchor) ev.push({ p: i, t: 'order', ts: t, s: prod.sku, v: val });
      };
      if (lensSku) {
        var sup = props.lens_supply_days * DAY, t0 = from + Math.floor(r() * sup), lastLens = null;
        while (t0 < anchor - HOUR) {
          if (r() < 0.8) { shop(t0, 'Contact lenses', true, catPool('Contact lenses').filter(function (x) { return x.sku === lensSku; })[0]); lastLens = t0; if (r() < 0.35) shop(t0 + 4 * 60e3, 'Solutions', true, U.pick(r, catPool('Solutions'))); }
          t0 += sup * (0.88 + r() * 0.3);
        }
        if (lastLens) props.lens_refill_date = U.ymd(lastLens + sup);
      }
      var nOrd = r() < 0.32 + 0.4 * eng ? 1 + Math.floor(r() * r() * 4) : 0;
      for (var o = 0; o < nOrd; o++) {
        var cat = U.wpick(r, [['Frames', 30], ['Sunglasses', 28], ['Optical lenses', 10], ['Accessories', 12], ['Solutions', 10], ['Contact lenses', lensSku ? 0 : 6]]);
        var ts = o === 0 && source === 'Checkout' && created > start18 ? created - 20 * 60e3 : at();
        if (ts == null) continue;
        if (cat === 'Sunglasses' && r() < 0.7) { var d = new Date(ts); d.setMonth(U.int(r, 4, 7)); d.setDate(U.int(r, 1, 28)); if (d.getTime() < anchor && d.getTime() > from) ts = d.getTime(); }
        shop(ts, cat, true);
      }
      var nAb = r() < 0.2 + 0.3 * eng ? U.int(r, 1, 2) : 0;
      for (o = 0; o < nAb; o++) { var ta = at(); if (ta != null) shop(ta, U.wpick(r, [['Frames', 35], ['Sunglasses', 35], ['Contact lenses', 15], ['Accessories', 15]]), false); }
      var nBr = U.int(r, 0, Math.round(1 + 3 * eng));
      for (o = 0; o < nBr; o++) { var bt = at(); if (bt == null) continue; var bc = U.wpick(r, [['Frames', 40], ['Sunglasses', 40], ['Contact lenses', 10], ['Accessories', 10]]), nv2 = U.int(r, 1, 3); for (var v = 0; v < nv2; v++) ev.push({ p: i, t: 'view', ts: bt + v * 90e3, s: U.pick(r, catPool(bc)).sku }); }
    }
    db.meta.ids.profile = D.N;
    L.test.members = [1, 2, 3, 4];
    ev.sort(function (a, b) { return a.ts - b.ts; });

    // VIP list: top ~6% by spend
    var spend = {}; ev.forEach(function (e) { if (e.t === 'order') spend[e.p] = (spend[e.p] || 0) + e.v; });
    L.vip.members = Object.keys(spend).sort(function (a, b) { return spend[b] - spend[a]; }).slice(0, Math.round(D.N * 0.06)).map(Number).sort(function (a, b) { return a - b; });
    db.profiles.forEach(function (p) { if (L.vip.members.indexOf(p.id) >= 0) p.props.vip = 'yes'; });

    // ── Templates ───────────────────────────────────────────────────────
    AM.Email.TEMPLATES.forEach(function (t, k) {
      db.templates.push({ id: k + 1, key: t.key, name: t.name, category: t.category, subject: t.subject, preview: t.preview, builtin: true, created: anchor - (400 - k) * DAY, updated: anchor - (400 - k) * DAY, design: fillStatic(t.design(), P, 'Sunglasses', r) });
    });
    db.meta.ids.template = db.templates.length;
    var tplDesign = function (key, tweak) { var d = AM.Email.reid(db.templates.filter(function (t) { return t.key === key; })[0].design); if (tweak) tweak(d); return d; };
    var setImg = function (h, s) { return function (d) { d.blocks.forEach(function (b) { if (b.type === 'image') { b.headline = h; if (s != null) b.sub = s; } }); }; };

    // ── Segments ────────────────────────────────────────────────────────
    var SEG = [
      ['Engaged — last 30 days', 'Opened or clicked an email in the last 30 days.', { match: 'all', groups: [{ match: 'any', conds: [{ kind: 'event', ev: 'open', op: 'atleast', n: 1, win: { type: 'last', days: 30 } }, { kind: 'event', ev: 'click', op: 'atleast', n: 1, win: { type: 'last', days: 30 } }] }] }],
      ['Repeat buyers — 90 days', 'Placed order at least 2 times in the last 90 days.', { match: 'all', groups: [{ match: 'all', conds: [{ kind: 'event', ev: 'order', op: 'atleast', n: 2, win: { type: 'last', days: 90 } }] }] }],
      ['Sunglasses browsers, no purchase', 'Viewed a sunglasses product in the last 30 days but has not placed an order in the last 30 days.', { match: 'all', groups: [{ match: 'all', conds: [{ kind: 'event', ev: 'view', op: 'atleast', n: 1, win: { type: 'last', days: 30 }, where: { field: 'category', value: 'Sunglasses' } }, { kind: 'event', ev: 'order', op: 'zero', n: 0, win: { type: 'last', days: 30 } }] }] }],
      ['Lapsed customers (180 days)', 'Bought before, but nothing in the last 180 days.', { match: 'all', groups: [{ match: 'all', conds: [{ kind: 'event', ev: 'order', op: 'atleast', n: 1, win: { type: 'all' } }, { kind: 'event', ev: 'order', op: 'zero', n: 0, win: { type: 'last', days: 180 } }] }] }],
      ['High predicted CLV', 'Predicted customer lifetime value above €600.', { match: 'all', groups: [{ match: 'all', conds: [{ kind: 'pred', field: 'clv', op: 'gt', value: 600 }] }] }],
      ['High churn risk, emailable', 'Churn risk is high and the profile can receive email.', { match: 'all', groups: [{ match: 'all', conds: [{ kind: 'pred', field: 'churn', op: 'eq', value: 'high' }, { kind: 'consent', channel: 'email', value: 'can' }] }] }],
      ['Lens refill due in 14 days', 'Contact-lens refill date falls in the next 14 days.', { match: 'all', groups: [{ match: 'all', conds: [{ kind: 'prop', field: 'props.lens_refill_date', op: 'next', value: 14 }] }] }],
      ['Croatian or Slovenian speakers in HR', 'Lives in Croatia and speaks Croatian or Slovenian.', { match: 'all', groups: [{ match: 'all', conds: [{ kind: 'prop', field: 'country', op: 'eq', value: 'HR' }] }, { match: 'any', conds: [{ kind: 'prop', field: 'lang', op: 'eq', value: 'hr' }, { kind: 'prop', field: 'lang', op: 'eq', value: 'sl' }] }] }],
      ['Subscribed, never opened (90 days)', 'Can receive email but has not opened anything in 90 days — sunset candidates.', { match: 'all', groups: [{ match: 'all', conds: [{ kind: 'consent', channel: 'email', value: 'can' }, { kind: 'event', ev: 'open', op: 'zero', n: 0, win: { type: 'last', days: 90 } }] }] }],
      ['SMS reachable', 'Has SMS consent, a phone number and is not suppressed.', { match: 'all', groups: [{ match: 'all', conds: [{ kind: 'consent', channel: 'sms', value: 'can' }] }] }]
    ];
    SEG.forEach(function (s, k) { db.segments.push({ id: k + 1, name: s[0], desc: s[1], def: s[2], created: anchor - (300 - k * 20) * DAY, updated: anchor - (200 - k * 10) * DAY }); });
    db.meta.ids.segment = db.segments.length;

    // ── Forms ───────────────────────────────────────────────────────────
    var FS = { bg: '#FFFFFF', text: '#1E2A2E', btn: '#0E5A63', btnText: '#FFFFFF', overlay: '#0B1E22' };
    db.forms = [
      { id: 1, name: 'Welcome popup — SI', type: 'popup', status: 'live', list: L.si.id, title: 'Dobrodošli! −10 % na prvo naročilo', body: 'Prijavite se na e-novice in prejmite kodo za 10 % popust.', button: 'Želim popust', consent: 'Strinjam se s prejemanjem e-novic. Odjava je možna kadarkoli.', success: 'Hvala! Koda je na poti v vaš nabiralnik.', fields: ['email', 'first_name'], rules: { trigger: 'delay', delay: 8, scroll: 40, device: 'all', freq: 7, pages: 'all' }, style: Object.assign({}, FS), img: 'frames', created: anchor - 700 * DAY },
      { id: 2, name: 'Welcome popup — HR', type: 'popup', status: 'live', list: L.hr.id, title: 'Dobrodošli! −10 % na prvu narudžbu', body: 'Prijavite se na newsletter i dobijte kod za 10 % popusta.', button: 'Želim popust', consent: 'Slažem se s primanjem newslettera. Odjava je moguća u bilo kojem trenutku.', success: 'Hvala! Kod je na putu.', fields: ['email', 'first_name'], rules: { trigger: 'delay', delay: 8, scroll: 40, device: 'all', freq: 7, pages: 'all' }, style: Object.assign({}, FS), img: 'frames', created: anchor - 650 * DAY },
      { id: 3, name: 'Footer newsletter', type: 'embedded', status: 'live', list: L.si.id, title: 'Novice in nasveti optikov', body: 'Enkrat mesečno. Brez spama.', button: 'Prijava', consent: 'Strinjam se s prejemanjem e-novic.', success: 'Hvala za prijavo!', fields: ['email'], rules: { trigger: 'always', delay: 0, scroll: 0, device: 'all', freq: 0, pages: 'all' }, style: Object.assign({}, FS, { bg: '#F3EFE8' }), img: '', created: anchor - 800 * DAY },
      { id: 4, name: 'Exit intent — lens reminders', type: 'flyout', status: 'draft', list: L.lens.id, title: 'Never run out of lenses', body: 'We will remind you when your supply is running low.', button: 'Remind me', consent: 'I agree to receive reorder reminders by email.', success: 'Done — we will remind you.', fields: ['email', 'first_name', 'phone'], rules: { trigger: 'exit', delay: 0, scroll: 0, device: 'desktop', freq: 14, pages: 'Contact lenses' }, style: Object.assign({}, FS, { btn: '#1F6F7A' }), img: 'lenses', created: anchor - 20 * DAY }
    ];
    db.meta.ids.form = 4;
    var RATE = { 1: 0.034, 2: 0.031, 3: 0.009, 4: 0.05 };
    db.forms.forEach(function (f) { f.st = { views: {}, subs: {} }; });
    ev.forEach(function (e) {
      if (e.t !== 'form') return; var f = db.forms[e.r - 1], m = U.ym(e.ts);
      f.st.subs[m] = (f.st.subs[m] || 0) + 1;
    });
    db.forms.forEach(function (f) {
      for (var k = 0; k < 24; k++) { var m = U.ym(U.addMonths(U.monthStart(anchor), -k)); if (U.addMonths(U.monthStart(anchor), -k) < f.created) continue; var s = f.st.subs[m] || 0; f.st.views[m] = Math.round((s + 0.5) / RATE[f.id] * (0.85 + r() * 0.3)); }
    });

    // ── Index + flows definitions ───────────────────────────────────────
    E.init(db);
    var created12 = anchor - 370 * DAY;
    var S = function (type, props) { var s = E.newStep(type); s.st = {}; return Object.assign(s, props || {}); };
    var em = function (name, key, subject, tweak, extra) { return S('email', Object.assign({ name: name, subject: subject, preview: '', design: tplDesign(key, tweak) }, extra || {})); };
    var noOrderSince = { kind: 'event', ev: 'order', op: 'zero', n: 0, win: { type: 'since' } };
    var F = [];
    F.push({ name: 'Welcome series', desc: 'New newsletter subscribers: welcome gift, then brand story and eye-exam invitation unless they buy.', status: 'live', trigger: { type: 'list', lists: [L.si.id, L.hr.id] }, filters: [], reentry: { mode: 'once' }, conv: 0.08,
      steps: [em('Welcome #1 — 10% code', 'welcome', 'Welcome to Adrial, {{ first_name|default:"friend" }} 👓'), S('delay', { amount: 2, unit: 'days' }),
        S('split', { cond: { kind: 'event', ev: 'order', op: 'atleast', n: 1, win: { type: 'since' } }, yes: [em('Thanks for your first order', 'news', 'Thank you for your first order!', setImg('Thank you!', 'Here is what happens next'))],
          no: [em('Welcome #2 — your code expires soon', 'welcome', 'Your 10% code expires in 3 days', setImg('Your 10% code', 'Expires in 3 days')), S('delay', { amount: 3, unit: 'days' }), em('Welcome #3 — book a free eye exam', 'exam', 'A free eye exam is waiting for you')] })] });
    F.push({ name: 'Abandoned cart', desc: 'Started checkout but did not order: reminder after 4 hours, then a second nudge split by cart value.', status: 'live', trigger: { type: 'event', ev: 'checkout' }, filters: [noOrderSince], reentry: { mode: 'days', days: 7 }, conv: 0.35, cq: 1.9,
      steps: [S('delay', { amount: 4, unit: 'hours' }), em('Cart reminder #1', 'cart', '{{ first_name|default:"Hi" }}, you left something in your cart'), S('delay', { amount: 1, unit: 'days' }),
        S('tsplit', { cond: { field: 'value', op: 'gt', value: 100 }, yes: [em('Cart #2 — free delivery + optician help', 'cart', 'Free delivery on your cart — today only')], no: [em('Cart #2 — 5% off', 'cart', 'A little extra: 5% off your cart'), S('delay', { amount: 1, unit: 'days' }), S('sms', { name: 'Cart SMS', body: 'Adrial: {{ first_name|default:"Pozdravljeni" }}, vaša košarica vas čaka. Zaključite naročilo: https://ex.am/k Odjava: STOP' })] })] });
    F.push({ name: 'Browse abandonment', desc: 'Viewed products but did not check out — one reminder with the items they looked at.', status: 'live', trigger: { type: 'event', ev: 'view' }, filters: [noOrderSince, { kind: 'event', ev: 'checkout', op: 'zero', n: 0, win: { type: 'since' } }, { kind: 'consent', channel: 'email', value: 'can' }], reentry: { mode: 'days', days: 30 }, conv: 0.1, cq: 1.4,
      steps: [S('delay', { amount: 2, unit: 'hours' }), em('Still looking?', 'bis', 'Still thinking about it, {{ first_name|default:"there" }}?', function (d) { d.blocks.forEach(function (b) { if (b.type === 'image') { b.art = 'frames'; b.headline = 'Still looking?'; b.sub = 'The items you viewed are waiting'; } if (b.type === 'products') { b.mode = 'last_viewed'; b.count = 3; } }); })] });
    F.push({ name: 'Post-purchase + review request', desc: 'Thank-you right after the order, then care tips (lenses) or a review request (everything else).', status: 'live', trigger: { type: 'event', ev: 'order' }, filters: [], reentry: { mode: 'days', days: 20 }, conv: 0.05,
      steps: [em('Thank you for your order', 'news', 'Thank you for your order, {{ first_name|default:"there" }}!', setImg('Thank you!', 'Your order is on its way')), S('delay', { amount: 10, unit: 'days' }),
        S('split', { cond: { kind: 'event', ev: 'order', op: 'atleast', n: 1, win: { type: 'since' }, where: { field: 'category', value: 'Contact lenses' } }, yes: [em('Lens care tips', 'lens', '5 tips for comfortable lenses all day', setImg('Lens care 101', '5 optician tips'))], no: [em('How do you like them? Leave a review', 'news', 'How are your new glasses? Tell us in 1 minute', setImg('How did we do?', 'Leave a quick review'))] })] });
    F.push({ name: 'Contact-lens reorder', desc: 'Reminder before the lens supply runs out — timing depends on the pack size (30 / 90 / 180 days).', status: 'live', trigger: { type: 'event', ev: 'order', where: { field: 'category', value: 'Contact lenses' } }, filters: [{ kind: 'event', ev: 'order', op: 'atmost', n: 1, win: { type: 'since' }, where: { field: 'category', value: 'Contact lenses' } }], reentry: { mode: 'always' }, conv: 0.3, cq: 1.5,
      steps: [S('split', { cond: { kind: 'prop', field: 'props.lens_supply_days', op: 'eq', value: 30 },
        yes: [S('delay', { amount: 23, unit: 'days' }), em('Reorder reminder — 30-day pack', 'lens', 'Time for fresh lenses, {{ first_name|default:"there" }}'), S('delay', { amount: 3, unit: 'days' }), S('sms', { name: 'Reorder SMS', body: 'Adrial: vaše leče kmalu poidejo. Naročite v 1 kliku: https://ex.am/l Odjava: STOP' })],
        no: [S('split', { cond: { kind: 'prop', field: 'props.lens_supply_days', op: 'eq', value: 90 }, yes: [S('delay', { amount: 80, unit: 'days' }), em('Reorder reminder — 90-day pack', 'lens', 'Your lenses run out in about 10 days')], no: [S('delay', { amount: 165, unit: 'days' }), em('Reorder reminder — 180-day pack', 'lens', 'Your 6-month lens supply is almost finished')] })] })] });
    F.push({ name: 'Win-back', desc: '120 days without a new order → "we miss you", then a 15% code.', status: 'live', trigger: { type: 'event', ev: 'order' }, filters: [{ kind: 'event', ev: 'order', op: 'atmost', n: 1, win: { type: 'since' } }], reentry: { mode: 'days', days: 180 }, conv: 0.14,
      steps: [S('delay', { amount: 120, unit: 'days' }), em('We miss you', 'winback', 'We miss you, {{ first_name|default:"friend" }}', setImg('We miss you', 'New arrivals since your last visit')), S('delay', { amount: 14, unit: 'days' }), em('Last chance — 15% off', 'winback', 'Your 15% code expires on Sunday'), S('update', { key: 'winback_contacted', value: 'yes' })] });
    F.push({ name: 'Eye-exam reminder', desc: 'One week before the next eye exam is due; SMS follow-up if the email was not clicked.', status: 'live', trigger: { type: 'date', prop: 'props.next_eye_exam', offset: -7, annual: false }, filters: [], reentry: { mode: 'days', days: 300 }, conv: 0.04,
      steps: [em('Eye exam due next week', 'exam', 'Your eye exam is due next week'), S('delay', { amount: 5, unit: 'days' }), S('split', { cond: { kind: 'event', ev: 'click', op: 'atleast', n: 1, win: { type: 'since' } }, yes: [], no: [S('sms', { name: 'Exam SMS reminder', body: 'Adrial: čas je za pregled vida. Rezervirajte termin: https://ex.am/p Odjava: STOP' })] })] });
    F.push({ name: 'Back in stock alert', desc: 'Sends when an item a customer asked about is available again.', status: 'draft', trigger: { type: 'event', ev: 'bis' }, filters: [], reentry: { mode: 'always' }, conv: 0.18, steps: [em('Back in stock', 'bis', 'Good news — it is back in stock')] });
    F.push({ name: 'Birthday greeting', desc: 'Annual birthday email with a small gift. Manual mode: messages are queued for review, not sent.', status: 'manual', trigger: { type: 'date', prop: 'birthday', offset: 0, annual: true }, filters: [{ kind: 'consent', channel: 'email', value: 'can' }], reentry: { mode: 'always' }, conv: 0.05, steps: [em('Happy birthday', 'welcome', 'Happy birthday, {{ first_name|default:"friend" }}! 🎂', setImg('Happy birthday!', 'A small gift from us inside'))] });
    F.forEach(function (f, k) { f.id = k + 1; f.created = f.status === 'draft' ? anchor - 15 * DAY : f.status === 'manual' ? anchor - 45 * DAY : created12 + k * DAY; f.updated = f.created + 30 * DAY; f.st = {}; db.flows.push(f); });
    db.meta.ids.flow = db.flows.length;

    // ── Campaigns (12 months, chronological; flows run after) ───────────
    var C = [];
    var secondTue = function (ms) { var d = new Date(ms); while (d.getDay() !== 2) d.setDate(d.getDate() + 1); d.setDate(d.getDate() + 7); return d.getTime(); };
    var monthNow = U.monthStart(anchor);
    for (var k = 12; k >= 0; k--) {
      var ms = U.addMonths(monthNow, -k), mo = new Date(ms).getMonth(), tue = secondTue(ms);
      C.push({ ts: tue + 10 * HOUR, name: 'Newsletter SI — ' + U.MON[mo] + ' ' + new Date(ms).getFullYear(), lists: [L.si.id], key: 'news', subject: 'Novosti za ' + SI_MON[mo] + ': nove okvirje in nasveti optikov', preview: 'Nova kolekcija, nasveti za leče in dogodki v trgovinah.', head: SI_MON[mo].charAt(0).toUpperCase() + SI_MON[mo].slice(1) + ' pri Adrialu' });
      C.push({ ts: tue + 11 * HOUR, name: 'Newsletter HR — ' + U.MON[mo] + ' ' + new Date(ms).getFullYear(), lists: [L.hr.id], key: 'news', subject: 'Novosti za ' + HR_MON[mo] + ': novi okviri i savjeti optičara', preview: 'Nova kolekcija, savjeti za leće i događanja.', head: HR_MON[mo].charAt(0).toUpperCase() + HR_MON[mo].slice(1) + ' u Adrialu' });
      var promo = { 10: ['Black Friday — 25% off frames', 'news', 'Black Friday: −25% on all frames', 'Black Friday −25%', [L.si.id, L.hr.id], { on: true, type: 'subject', variants: [{ subject: 'Black Friday: −25% on all frames' }, { subject: '{{ first_name|default:"Hi" }}, your Black Friday −25% is here 🖤' }], testPct: 20, metric: 'open', wait: 4 }, 27],
        11: ['Gift guide — sunglasses & accessories', 'summer', 'The gift guide: sunglasses and accessories under €50', 'Gifts they will love', [L.si.id, L.hr.id], null, 4], 0: ['Lens stock-up — 3+1 free', 'lens', 'Stock up: buy 3 boxes, get 1 free', '3 + 1 free', [L.lens.id], null, 14],
        2: ['Eye-exam month', 'exam', 'March is eye-exam month — book for free', 'Eye-exam month', [L.si.id, L.hr.id], null, 5], 4: ['New sunglasses collection', 'summer', 'New in: the 2026 sunglasses collection', 'New collection', [L.si.id, L.hr.id], null, 19],
        5: ['Summer sale — sunglasses −30%', 'summer', 'Summer sale: up to 30% off sunglasses ☀️', 'Summer sale −30%', [L.si.id, L.hr.id], { on: true, type: 'subject', variants: [{ subject: 'Summer sale: up to 30% off sunglasses ☀️' }, { subject: 'Only this week: −30% on sunglasses' }], testPct: 30, metric: 'click', wait: 3 }, 24],
        6: ['Last chance — summer sale', 'summer', 'Last chance: summer sale ends Sunday', 'Ends Sunday', [L.si.id, L.hr.id], null, 9], 8: ['Back to school — kids frames', 'news', 'Back to school: kids frames from €49', 'Back to school', [L.si.id, L.hr.id], null, 3],
        9: ['VIP early access — autumn collection', 'news', 'VIP early access: the autumn collection', 'VIP early access', [L.vip.id], null, 1] }[mo];
      if (promo) { var pd = new Date(ms); pd.setDate(promo[6]); C.push({ ts: pd.getTime() + 18 * HOUR, name: promo[0], key: promo[1], subject: promo[2], head: promo[3], lists: promo[4], ab: promo[5], preview: '' }); }
    }
    C = C.filter(function (c) { return c.ts < anchor - 2 * HOUR && c.ts > anchor - 380 * DAY; }).sort(function (a, b) { return a.ts - b.ts; });
    var SMS = [
      { days: 320, name: 'Black Friday SMS — SI', lists: [L.sms.id], body: 'Adrial: BLACK FRIDAY −25 % na vse okvirje do nedelje. https://ex.am/bf Odjava: STOP' },
      { days: 230, name: 'Lens stock-up SMS', lists: [L.sms.id], body: 'Adrial: 3+1 gratis na kontaktne leče ta teden. https://ex.am/3p1 Odjava: STOP' },
      { days: 110, name: 'Summer sale SMS — HR', lists: [L.sms.id], body: 'Adrial: ljetno sniženje −30 % na sunčane naočale. https://ex.am/ljeto Odjava: STOP' },
      { days: 45, name: 'Flash sale 24h', lists: [L.sms.id], body: 'Adrial: 24h flash sale - extra 20% off sunglasses with code FLASH20. https://ex.am/f Reply STOP to opt out' }
    ];
    var jobs = C.map(function (c) { return { ts: c.ts, c: c }; }).concat(SMS.map(function (s) { return { ts: anchor - s.days * DAY + 17 * HOUR, s: s }; })).sort(function (a, b) { return a.ts - b.ts; });
    var cid = 0;
    jobs.forEach(function (j) {
      var c;
      if (j.c) {
        var design = tplDesign(j.c.key, setImg(j.c.head));
        if (j.c.ab) j.c.ab.variants.forEach(function (v) { v.design = null; });
        c = { id: ++cid, name: j.c.name, channel: 'email', status: 'sent', created: j.ts - 6 * DAY, updated: j.ts, audience: { include: j.c.lists.map(function (id) { return { type: 'list', id: id }; }), exclude: j.c.lists.length > 1 || j.c.lists[0] === L.si.id ? [{ type: 'segment', id: 9 }] : [] },
          subject: j.c.subject, preview: j.c.preview || '', fromName: 'Adrial Optika', fromEmail: j.c.lists[0] === L.hr.id ? 'novosti@example.hr' : 'novice@example.si', replyTo: 'pomoc@example.si', design: design, tpl: j.c.key,
          ab: j.c.ab || { on: false, type: 'subject', variants: [{ subject: j.c.subject }, { subject: '' }], testPct: 20, metric: 'open', wait: 4 }, schedule: { type: 'at', at: j.ts }, utm: true };
        // exclusion of the "never opened" segment only applies to sends from the last 4 months (sunsetting policy)
        c.audience.exclude = [];
      } else {
        c = { id: ++cid, name: j.s.name, channel: 'sms', status: 'sent', created: j.ts - 3 * DAY, updated: j.ts, audience: { include: j.s.lists.map(function (id) { return { type: 'list', id: id }; }), exclude: [] }, body: j.s.body, sender: 'ADRIAL', stop: true, schedule: { type: 'at', at: j.ts } };
      }
      db.campaigns.push(c);
      var res = E.runSend(c, { ts: j.ts, r: r, live: false, limit: anchor });
      E.commitSend(c, res, j.ts);
    });
    // Scheduled + drafts
    var tom = U.dayStart(anchor + 3 * DAY) + 10 * HOUR;
    var addC = function (o) { o.id = ++cid; db.campaigns.push(o); return o; };
    addC({ name: 'Autumn newsletter SI — lens care', channel: 'email', status: 'scheduled', created: anchor - 2 * DAY, updated: anchor - DAY, audience: { include: [{ type: 'list', id: L.si.id }], exclude: [{ type: 'segment', id: 9 }] }, subject: 'Suhe oči jeseni? 5 nasvetov optikov', preview: 'Plus: nova kolekcija okvirjev.', fromName: 'Adrial Optika', fromEmail: 'novice@example.si', replyTo: 'pomoc@example.si', design: tplDesign('news', setImg('Jesen pri Adrialu')), tpl: 'news', ab: { on: false, type: 'subject', variants: [{ subject: '' }, { subject: '' }], testPct: 20, metric: 'open', wait: 4 }, schedule: { type: 'at', at: tom }, utm: true });
    addC({ name: 'Autumn newsletter HR — smart send', channel: 'email', status: 'scheduled', created: anchor - 2 * DAY, updated: anchor - DAY, audience: { include: [{ type: 'list', id: L.hr.id }], exclude: [] }, subject: 'Suhe oči na jesen? 5 savjeta optičara', preview: '', fromName: 'Adrial Optika', fromEmail: 'novosti@example.hr', replyTo: 'pomoc@example.si', design: tplDesign('news', setImg('Jesen u Adrialu')), tpl: 'news', ab: { on: false, type: 'subject', variants: [{ subject: '' }, { subject: '' }], testPct: 20, metric: 'open', wait: 4 }, schedule: { type: 'smart', day: U.ymd(anchor + 4 * DAY) }, utm: true });
    addC({ name: 'Black Friday 2026 — teaser (draft)', channel: 'email', status: 'draft', created: anchor - DAY, updated: anchor - DAY, audience: { include: [{ type: 'list', id: L.si.id }, { type: 'list', id: L.hr.id }], exclude: [] }, subject: 'Something big is coming on 27 November…', preview: 'Mark your calendar.', fromName: 'Adrial Optika', fromEmail: 'novice@example.si', replyTo: 'pomoc@example.si', design: tplDesign('summer', function (d) { setImg('Coming soon', '27 November')(d); d.blocks.forEach(function (b) { if (b.type === 'image') b.art = 'sale'; }); }), tpl: 'summer', ab: { on: true, type: 'subject', variants: [{ subject: 'Something big is coming on 27 November…' }, { subject: '{{ first_name|default:"Psst" }}, save the date: 27/11' }], testPct: 20, metric: 'open', wait: 4 }, schedule: { type: 'now' }, utm: true });
    addC({ name: 'SMS — autumn eye-exam week (draft)', channel: 'sms', status: 'draft', created: anchor - DAY, updated: anchor - DAY, audience: { include: [{ type: 'list', id: L.sms.id }], exclude: [] }, body: 'Adrial: teden pregledov vida — brezplačen pregled ob nakupu očal. Rezerviraj: https://ex.am/pv Odjava: STOP', sender: 'ADRIAL', stop: true, schedule: { type: 'now' } });
    db.meta.ids.campaign = cid;

    // ── Flow history (same engine, deterministic RNG) ───────────────────
    var hist = new Map(), jobsF = [];
    db.flows.forEach(function (f) {
      if (f.status !== 'live' && f.status !== 'manual') return;
      var t = f.trigger;
      if (t.type === 'date') { E.dateFires(f, f.created, anchor).forEach(function (x) { jobsF.push({ ts: x.ts, f: f, p: x.p, e: { t: 'date' } }); }); return; }
      db.events.forEach(function (e) {
        if (e.ts < f.created || e.ts > anchor) return;
        if (t.type === 'list' ? (e.t === 'sub' && t.lists.indexOf(e.r) >= 0) : e.t === t.ev) jobsF.push({ ts: e.ts, f: f, p: E.profile(e.p), e: e });
      });
    });
    jobsF.sort(function (a, b) { return a.ts - b.ts; });
    jobsF.forEach(function (j) { E.enter(j.f, j.p, j.e, j.ts, { live: false, until: anchor, r: r, limit: anchor, hist: hist }); });
    db.runs = db.runs.filter(function (x) { return !x.done; });
    db.events.sort(function (a, b) { return a.ts - b.ts; });
    E.init(db);
    return db;
  };
})();
