/* Payment reconciliation demo: deterministic, entirely fictional dataset.
 * window.ReconData.generate(genDate) builds 90 days of web/POS orders for an optical retailer
 * (SI/HR/IT webshops + stores) and the payment-provider side: captures, refunds, chargebacks, fees,
 * payout batches and demo bank-statement lines. All amounts are INTEGER CENTS so totals always tie out.
 * The same genDate always gives the same data (seeded PRNG), so the app only stores decisions.
 * Names are random combinations of common first/last names, e-mails are @example.com, IBANs are fake. */
(function () {
  'use strict';

  var VERSION = 1;

  var PROVIDERS = [
    { id: 'monri', name: 'Monri', kind: 'Cards', color: 'violet' },
    { id: 'adyen', name: 'Adyen', kind: 'Cards & wallets', color: 'blue' },
    { id: 'paypal', name: 'PayPal', kind: 'Wallet', color: 'teal' },
    { id: 'klarna', name: 'Klarna', kind: 'Pay later', color: 'clay' },
    { id: 'flik', name: 'Flik/Bankart', kind: 'Instant (SI)', color: 'violet' },
    { id: 'valu', name: 'VALÚ', kind: 'Mobile (SI)', color: 'blue' },
    { id: 'cod', name: 'Cash on delivery', kind: 'Carriers', color: 'teal' },
    { id: 'bank', name: 'Bank transfer', kind: 'Proforma / UPN', color: 'clay' }
  ];
  // Payout / settlement accounts (one batch stream each)
  var ACCOUNTS = [
    { id: 'monri-si', provider: 'monri', name: 'Monri SI', cadence: 'daily', lag: 2, bank: 'MONRI PAYMENTS D.O.O.' },
    { id: 'monri-hr', provider: 'monri', name: 'Monri HR', cadence: 'daily', lag: 2, bank: 'MONRI PAYMENTS D.O.O.' },
    { id: 'adyen', provider: 'adyen', name: 'Adyen', cadence: 'daily', lag: 2, bank: 'ADYEN N.V.' },
    { id: 'paypal-adrial', provider: 'paypal', name: 'PayPal Adrial', cadence: 'weekly', lag: 1, bank: 'PAYPAL EUROPE S.A R.L.' },
    { id: 'paypal-vallis', provider: 'paypal', name: 'PayPal Vallis', cadence: 'weekly', lag: 1, bank: 'PAYPAL EUROPE S.A R.L.' },
    { id: 'klarna-si', provider: 'klarna', name: 'Klarna SI', cadence: 'weekly', lag: 3, bank: 'KLARNA BANK AB' },
    { id: 'klarna-hr', provider: 'klarna', name: 'Klarna HR', cadence: 'weekly', lag: 3, bank: 'KLARNA BANK AB' },
    { id: 'klarna-it', provider: 'klarna', name: 'Klarna IT', cadence: 'weekly', lag: 3, bank: 'KLARNA BANK AB' },
    { id: 'flik', provider: 'flik', name: 'Flik/Bankart', cadence: 'daily', lag: 1, bank: 'BANKART D.O.O.' },
    { id: 'valu', provider: 'valu', name: 'VALÚ', cadence: 'weekly', lag: 2, bank: 'TELEKOM SLOVENIJE VALU' },
    { id: 'cod-posta', provider: 'cod', name: 'Pošta Slovenije', cadence: 'weekly', lag: 3, bank: 'POSTA SLOVENIJE D.O.O.' },
    { id: 'cod-gls-si', provider: 'cod', name: 'GLS Slovenija', cadence: 'weekly', lag: 3, bank: 'GENERAL LOGISTICS SYSTEMS SI' },
    { id: 'cod-hp', provider: 'cod', name: 'Hrvatska pošta', cadence: 'weekly', lag: 4, bank: 'HRVATSKA POSTA D.D.' },
    { id: 'cod-boxnow', provider: 'cod', name: 'BOX NOW HR', cadence: 'weekly', lag: 3, bank: 'BOX NOW CROATIA' },
    { id: 'cod-gls-it', provider: 'cod', name: 'GLS Italy', cadence: 'weekly', lag: 4, bank: 'GLS ITALY S.P.A.' },
    { id: 'bank', provider: 'bank', name: 'Bank transfers', cadence: 'none', lag: 0, bank: '' }
  ];
  var SHOPS = [
    { id: 'WEB-SI', name: 'Webshop SI', country: 'SI', kind: 'web', prefix: 'SI', start: 300000 },
    { id: 'WEB-HR', name: 'Webshop HR', country: 'HR', kind: 'web', prefix: 'HR', start: 500000 },
    { id: 'WEB-IT', name: 'Webshop IT', country: 'IT', kind: 'web', prefix: 'IT', start: 700000 },
    { id: 'POS-KP', name: 'Store Koper', country: 'SI', kind: 'pos', prefix: 'P', start: 900000 },
    { id: 'POS-MB', name: 'Store Maribor', country: 'SI', kind: 'pos', prefix: 'P', start: 900000 },
    { id: 'POS-ZG', name: 'Store Zagreb', country: 'HR', kind: 'pos', prefix: 'P', start: 900000 }
  ];
  var METHOD_LABEL = { card: 'Card', wallet: 'Wallet (Apple/Google Pay)', paypal: 'PayPal', paylater: 'Pay later', instant: 'Instant payment', mobile: 'Mobile payment', cod: 'Cash on delivery', transfer: 'Bank transfer' };
  var OWNERS = ['Petra Kos (demo)', 'Marko Babić (demo)', 'Giulia Conti (demo)'];

  // ── helpers ──────────────────────────────────────────────────────────────
  function pad(n, w) { var s = String(n); while (s.length < (w || 2)) s = '0' + s; return s; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parse(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(s, n) { var d = parse(s); d.setDate(d.getDate() + n); return ymd(d); }
  function dow(s) { return parse(s).getDay(); }
  function diffDays(a, b) { return Math.round((parse(b) - parse(a)) / 864e5); }
  function nextBusiness(s) { while (dow(s) === 0 || dow(s) === 6) s = addDays(s, 1); return s; }
  function addBusiness(s, n) { while (n > 0) { s = addDays(s, 1); if (dow(s) !== 0 && dow(s) !== 6) n--; } return s; }
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function ascii(s) { return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D'); }
  // Ljubljana "today" as YYYY-MM-DD regardless of the viewer's own time zone
  function todayLj() {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Ljubljana', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
    catch (e) { return ymd(new Date()); }
  }

  var NAMES = {
    SI: { f: ['Ana', 'Maja', 'Nina', 'Eva', 'Petra', 'Mojca', 'Urška', 'Katja', 'Luka', 'Jan', 'Matej', 'Nejc', 'Žiga', 'Rok', 'Tomaž', 'Gregor', 'Miha', 'Primož', 'Sara', 'Tina', 'Špela', 'Blaž'],
      l: ['Novak', 'Horvat', 'Kranjc', 'Zupan', 'Potočnik', 'Kovač', 'Mlakar', 'Kos', 'Vidmar', 'Golob', 'Turk', 'Kralj', 'Zupančič', 'Bizjak', 'Hribar', 'Korošec', 'Rozman', 'Kastelic', 'Oblak', 'Žagar'] },
    HR: { f: ['Ivan', 'Marko', 'Luka', 'Ana', 'Petra', 'Ivana', 'Marija', 'Josip', 'Tomislav', 'Matea', 'Lucija', 'Karlo', 'Filip', 'Dora', 'Nikola', 'Mia'],
      l: ['Horvat', 'Kovačević', 'Babić', 'Marić', 'Jurić', 'Novak', 'Knežević', 'Vuković', 'Marković', 'Petrović', 'Matić', 'Tomić', 'Pavlović', 'Božić', 'Grgić', 'Perić'] },
    IT: { f: ['Giulia', 'Marco', 'Luca', 'Francesca', 'Alessandro', 'Chiara', 'Matteo', 'Sara', 'Davide', 'Elena', 'Andrea', 'Federica', 'Lorenzo', 'Martina', 'Paolo', 'Silvia'],
      l: ['Rossi', 'Russo', 'Ferrari', 'Esposito', 'Bianchi', 'Romano', 'Colombo', 'Ricci', 'Marino', 'Greco', 'Bruno', 'Gallo', 'Conti', 'De Luca', 'Costa', 'Fontana'] }
  };

  function generate(genDate) {
    var R = rng(0x5EC0A7);
    function int(a, b) { return a + Math.floor(R() * (b - a + 1)); }
    function pick(a) { return a[Math.floor(R() * a.length)]; }
    function chance(p) { return R() < p; }
    function wpick(pairs) { var t = 0, i; for (i = 0; i < pairs.length; i++) t += pairs[i][1]; var x = R() * t; for (i = 0; i < pairs.length; i++) { x -= pairs[i][1]; if (x <= 0) return pairs[i][0]; } return pairs[pairs.length - 1][0]; }
    function hhmm(a, b) { return pad(int(a == null ? 7 : a, b == null ? 22 : b)) + ':' + pad(int(0, 59)); }

    var START = addDays(genDate, -90), END = addDays(genDate, -1);

    // customers (fictional)
    var customers = [], used = {};
    function newCustomer(country) {
      var p = NAMES[country], f = pick(p.f), l = pick(p.l), base = ascii(f + '.' + l).toLowerCase().replace(/\s+/g, '');
      var n = (used[base] = (used[base] || 0) + 1);
      var c = { id: 'C' + (customers.length + 1), name: f + ' ' + l, email: base + (n > 1 ? n : '') + '@example.com', country: country };
      customers.push(c);
      return c;
    }
    var pool = { SI: [], HR: [], IT: [] };
    ['SI', 'HR', 'IT'].forEach(function (c) { for (var i = 0; i < { SI: 1100, HR: 800, IT: 600 }[c]; i++) pool[c].push(newCustomer(c)); });

    var orders = [], txns = [], payouts = [], bank = [], CAP = {};
    var seq = {}, invSeq = {}, cnSeq = 0, tSeq = 0;
    SHOPS.forEach(function (s) { seq[s.prefix] = s.start + int(1200, 4800); invSeq[s.id] = int(3000, 9000); });

    function amountFor() {
      var kind = wpick([['lens', 34], ['sun', 26], ['frame', 22], ['acc', 18]]);
      var e = kind === 'lens' ? int(2390, 13990) : kind === 'sun' ? int(5990, 24990) : kind === 'frame' ? int(11990, 64990) : int(890, 3990);
      e = Math.floor(e / 100) * 100 + pick([90, 99, 0, 50, 90]);
      return e;
    }
    function methodFor(shop) {
      if (shop.kind === 'pos') return wpick([['adyen', 62], ['monri', 38]]);
      if (shop.country === 'SI') return wpick([['monri', 24], ['adyen', 14], ['paypal', 10], ['klarna', 8], ['flik', 9], ['valu', 6], ['cod', 21], ['bank', 8]]);
      if (shop.country === 'HR') return wpick([['monri', 34], ['adyen', 14], ['paypal', 12], ['klarna', 8], ['cod', 26], ['bank', 6]]);
      return wpick([['adyen', 44], ['paypal', 25], ['klarna', 15], ['cod', 11], ['bank', 5]]);
    }
    function accountFor(provider, shop) {
      switch (provider) {
        case 'monri': return shop.country === 'HR' ? 'monri-hr' : 'monri-si';
        case 'paypal': return shop.country === 'IT' ? 'paypal-vallis' : 'paypal-adrial';
        case 'klarna': return 'klarna-' + shop.country.toLowerCase();
        case 'cod': return shop.country === 'SI' ? (chance(.6) ? 'cod-posta' : 'cod-gls-si') : shop.country === 'HR' ? (chance(.7) ? 'cod-hp' : 'cod-boxnow') : 'cod-gls-it';
        default: return provider;
      }
    }
    function brandFor(provider) {
      if (provider === 'monri') return wpick([['Visa', 46], ['Mastercard', 34], ['Maestro', 10], ['Diners', 6], ['Amex', 4]]);
      return wpick([['Visa', 50], ['Mastercard', 40], ['Maestro', 5], ['Amex', 5]]);
    }
    // fee in cents for a capture
    function feeFor(t) {
      var g = Math.abs(t.gross), a = t.account;
      if (t.type === 'chargeback') return { monri: 2000, adyen: 1500, paypal: 1500, klarna: 0 }[t.provider] || 0;
      if (t.type === 'refund') return t.provider === 'adyen' ? 11 : 0;
      switch (t.provider) {
        case 'monri': return Math.round(g * ({ Visa: .0125, Mastercard: .0125, Maestro: .009, Diners: .022, Amex: .026 }[t.brand] || .0125));
        case 'adyen': return 11 + Math.round(g * ({ Amex: .028, Maestro: .009 }[t.brand] || .011));
        case 'paypal': return 35 + Math.round(g * (a === 'paypal-vallis' && t.origCurrency ? .039 : .0249));
        case 'klarna': return 35 + Math.round(g * .0329);
        case 'flik': return 15;
        case 'valu': return Math.round(g * .01);
        case 'cod': return { 'cod-posta': 110, 'cod-gls-si': 150, 'cod-hp': 130 + Math.round(g * .005), 'cod-boxnow': 90, 'cod-gls-it': 200 }[a] || 120;
        default: return 0;
      }
    }
    function methodOf(provider, brand, wallet) {
      if (provider === 'monri') return 'card';
      if (provider === 'adyen') return wallet ? 'wallet' : 'card';
      return { paypal: 'paypal', klarna: 'paylater', flik: 'instant', valu: 'mobile', cod: 'cod', bank: 'transfer' }[provider];
    }
    function lagFor(provider) {
      switch (provider) {
        case 'klarna': return int(1, 4);
        case 'cod': return int(2, 7);
        case 'bank': return wpick([[0, 10], [1, 30], [2, 25], [3, 15], [5, 10], [8, 6], [12, 4]]);
        default: return chance(.12) ? 1 : 0;
      }
    }
    function refFor(t, o) {
      // what the provider report carries as the merchant reference (with realistic noise)
      switch (t.provider) {
        case 'monri': case 'adyen': return chance(.15) ? '#' + o.no.toLowerCase() : o.no;
        case 'paypal': return chance(.05) ? '' : 'Order ' + o.no;
        case 'klarna': return o.no;
        case 'flik': return 'SI00 ' + o.no.replace(/\D/g, '');
        case 'valu': return o.no.replace('-', '');
        case 'cod': return chance(.16) ? '' : o.no;
        case 'bank': return wpick([['SI00 ' + o.no.replace(/\D/g, ''), 55], ['SI12 ' + o.inv.replace(/\D/g, ''), 20], ['placilo narocila', 13], ['', 12]]);
      }
      return o.no;
    }
    function addTxn(o, provider, type, date, gross, extra) {
      var shop = SHOP[o.shop];
      var t = {
        id: 'T' + (++tSeq), provider: provider, account: (extra && extra.account) || accountFor(provider, shop), type: type,
        date: date, time: hhmm(provider === 'bank' ? 8 : 6, provider === 'bank' ? 16 : 23), gross: gross, fee: 0,
        ref: '', email: o.email, payer: o.name, brand: null, method: null, country: shop.country, oid: o.id
      };
      if (provider === 'monri' || provider === 'adyen') { t.wallet = provider === 'adyen' && shop.kind === 'web' && chance(.3); t.brand = brandFor(provider); }
      if (provider === 'bank') { t.email = ''; t.payer = o.name.toUpperCase().split(' ').reverse().join(' '); t.iban = fakeIban(o.country); }
      if (provider === 'cod') t.parcel = parcelNo(t.account);
      for (var k in extra) if (k !== 'account') t[k] = extra[k];
      t.method = methodOf(provider, t.brand, t.wallet);
      if (t.ref === '' && !(extra && 'ref' in extra)) t.ref = refFor(t, o);
      t.fee = feeFor(t);
      if (provider === 'klarna') t.raw = { amount_minor: Math.abs(gross), type: type === 'capture' ? 'SALE' : type === 'refund' ? 'RETURN' : 'CHARGEBACK', currency: 'EUR', fee_minor: t.fee };
      txns.push(t);
      if (type === 'capture' && t.oid && !CAP[t.oid]) CAP[t.oid] = t;
      return t;
    }
    function fakeIban(c) { var cc = c === 'IT' ? 'IT' : c === 'HR' ? 'HR' : 'SI'; var s = cc + pad(int(10, 99)); for (var i = 0; i < (cc === 'SI' ? 15 : cc === 'HR' ? 17 : 23); i++) s += int(0, 9); return s.replace(/(.{4})/g, '$1 ').trim(); }
    function parcelNo(a) { return a === 'cod-posta' ? 'PS' + int(10000000, 99999999) + 'SI' : a === 'cod-hp' ? 'HP' + int(10000000, 99999999) + 'HR' : a === 'cod-boxnow' ? 'BN' + int(1000000000, 9999999999) : String(int(10000000000, 99999999999)); }

    var SHOP = {};
    SHOPS.forEach(function (s) { SHOP[s.id] = s; });

    // ── orders, day by day ───────────────────────────────────────────────────
    for (var d = START; d <= END; d = addDays(d, 1)) {
      var wd = dow(d), n = Math.round((wd === 0 ? 34 : wd === 6 ? 38 : 49) * (0.85 + R() * 0.3));
      for (var i = 0; i < n; i++) {
        var shop = wpick([[SHOPS[0], 36], [SHOPS[1], 28], [SHOPS[2], 20], [SHOPS[3], 6], [SHOPS[4], 5], [SHOPS[5], 5]]);
        if (shop.kind === 'pos' && wd === 0) shop = SHOPS[0];
        var cust = pick(pool[shop.country]);
        var amt = amountFor();
        if (shop.kind === 'web' && amt < 4900) amt += 390; // shipping
        var no = (shop.prefix === 'P' ? 'P-' : shop.prefix + '-') + (++seq[shop.prefix]);
        var inv = 'R26-' + (shop.kind === 'pos' ? shop.id.slice(4) : shop.country) + '-' + pad(++invSeq[shop.id], 5);
        var o = { id: 'O' + (orders.length + 1), no: no, inv: inv, shop: shop.id, country: shop.country, date: d, time: hhmm(shop.kind === 'pos' ? 9 : 0, shop.kind === 'pos' ? 19 : 23),
          amount: amt, provider: methodFor(shop), name: cust.name, email: cust.email, cid: cust.id, markedPaid: true, cns: [] };
        orders.push(o);
      }
    }

    // ── payments per order ───────────────────────────────────────────────────
    var injected = { noOrder: 0 };
    orders.forEach(function (o) {
      var p = o.provider, lag = lagFor(p), date = addDays(o.date, lag);
      if (p === 'bank' && chance(.06)) { o.markedPaid = false; return; } // proforma never paid
      if (date > genDate) { o.markedPaid = false; return; } // still in transit / awaiting payment
      if (p === 'bank' || p === 'cod') o.markedPaid = true;
      addTxn(o, p, 'capture', date, o.amount);
    });

    // ── inject realistic exceptions and splits (deterministic picks) ─────────
    function candidates(fn) { return orders.filter(function (o) { return fn(o) && !o._x; }); }
    function take(list, k) { var out = []; while (out.length < k && list.length) { var i = int(0, list.length - 1); out.push(list[i]); list[i]._x = 1; list.splice(i, 1); } return out; }
    function capOf(o) { return CAP[o.id] || null; }
    var mid = addDays(START, 10), late = addDays(genDate, -6);
    var older = function (o) { return o.date >= mid && o.date <= late; };

    // order paid twice: second identical capture with the same reference
    take(candidates(function (o) { return older(o) && /monri|adyen|paypal/.test(o.provider) && o.country !== 'IT'; }), 7).forEach(function (o) {
      var c = capOf(o); if (!c) return;
      if (!c.ref) c.ref = c.provider === 'paypal' ? 'Order ' + o.no : o.no;
      var t = addTxn(o, c.provider, 'capture', addDays(c.date, chance(.5) ? 0 : 1), o.amount, { ref: c.ref, brand: c.brand, wallet: c.wallet });
      t.method = c.method; t.fee = feeFor(t); t.dup = true;
    });
    // rounding differences (±1–2 cents)
    take(candidates(function (o) { return older(o) && /adyen|monri/.test(o.provider); }), 8).forEach(function (o) {
      var c = capOf(o); if (!c) return; c.gross = o.amount + pick([-2, -1, 1, 2]); c.fee = feeFor(c); c.ref = o.no;
    });
    // partial capture (Klarna captured less: one item cancelled, no credit note)
    take(candidates(function (o) { return older(o) && o.provider === 'klarna' && o.amount > 6000; }), 6).forEach(function (o) {
      var c = capOf(o); if (!c) return; c.gross = o.amount - pick([1990, 2490, 2990, 990]); c.fee = feeFor(c); c.raw.amount_minor = c.gross; c.raw.fee_minor = c.fee;
    });
    // currency: Swiss/UK customers paying in CHF/GBP, converted EUR differs
    take(candidates(function (o) { return older(o) && o.provider === 'paypal' && o.country === 'IT'; }), 5).forEach(function (o) {
      var c = capOf(o); if (!c) return; c.origCurrency = 'CHF'; c.origAmount = Math.round(o.amount * 0.936); var dd = Math.round(o.amount * (R() * .016 - .009)); c.gross = o.amount + (dd || -37); c.fee = feeFor(c); c.ref = 'Order ' + o.no;
    });
    take(candidates(function (o) { return older(o) && o.provider === 'adyen' && o.country === 'IT'; }), 2).forEach(function (o) {
      var c = capOf(o); if (!c) return; c.origCurrency = 'GBP'; c.origAmount = Math.round(o.amount * 0.862); c.gross = o.amount - int(40, 160); c.fee = feeFor(c); c.ref = o.no;
    });
    // one bank payment covering two orders of the same customer (reference lists both)
    take(candidates(function (o) { return older(o) && o.provider === 'bank' && capOf(o); }), 9).forEach(function (o, k) {
      var c = capOf(o); if (!c) return;
      var shop = SHOP[o.shop];
      var o2 = { id: 'O' + (orders.length + 1), no: shop.prefix + '-' + (++seq[shop.prefix]), inv: 'R26-' + shop.country + '-' + pad(++invSeq[shop.id], 5), shop: o.shop, country: o.country,
        date: addDays(o.date, int(0, 1)), time: hhmm(), amount: amountFor(), provider: 'bank', name: o.name, email: o.email, cid: o.cid, markedPaid: true, cns: [], _x: 1 };
      orders.push(o2);
      c.gross = o.amount + o2.amount; c.date = addDays(o2.date, int(1, 3));
      c.ref = k < 6 ? 'SI00 ' + o.no.replace(/\D/g, '') + ' ' + o2.no.replace(/\D/g, '') : 'placilo dveh narocil';
      c.oid2 = o2.id;
    });
    // two payments for one order: bank instalments and Klarna split shipments
    take(candidates(function (o) { return older(o) && o.provider === 'bank' && o.amount > 8000 && capOf(o); }), 6).forEach(function (o) {
      var c = capOf(o); if (!c) return;
      var first = Math.round(o.amount / 2 / 100) * 100; c.gross = first; c.ref = 'SI00 ' + o.no.replace(/\D/g, '');
      addTxn(o, 'bank', 'capture', addDays(c.date, int(5, 12)), o.amount - first, { ref: 'SI00 ' + o.no.replace(/\D/g, ''), payer: c.payer, iban: c.iban });
    });
    take(candidates(function (o) { return older(o) && o.provider === 'klarna' && o.amount > 9000 && capOf(o); }), 4).forEach(function (o) {
      var c = capOf(o); if (!c) return;
      var part = Math.round(o.amount * .4); c.gross = o.amount - part; c.fee = feeFor(c); c.raw.amount_minor = c.gross; c.raw.fee_minor = c.fee;
      addTxn(o, 'klarna', 'capture', addDays(c.date, int(2, 5)), part, { account: c.account });
    });
    // order marked paid but no payment ever arrived
    take(candidates(function (o) { return older(o) && /cod|bank|paypal/.test(o.provider); }), 6).forEach(function (o) {
      txns = txns.filter(function (t) { return t.oid !== o.id; }); delete CAP[o.id]; o.markedPaid = true; o.noPayment = true;
    });
    // payments without an order (test payments, deleted orders, B2B customers paying to the web account)
    [['monri', 'monri-si', 'SI', '#si-399' + int(100, 999)], ['monri', 'monri-hr', 'HR', 'HR-5' + int(10000, 99999) + '-TEST'], ['adyen', 'adyen', 'IT', 'IT-799' + int(100, 999)],
     ['adyen', 'adyen', 'SI', ''], ['paypal', 'paypal-adrial', 'HR', ''], ['paypal', 'paypal-vallis', 'IT', 'Order IT-798' + int(100, 999)],
     ['bank', 'bank', 'SI', 'AKONTACIJA'], ['bank', 'bank', 'SI', 'SI00 2026-0918'], ['bank', 'bank', 'HR', 'HR99'], ['flik', 'flik', 'SI', 'SI00 3999' + int(10, 99)], ['cod', 'cod-posta', 'SI', '']
    ].forEach(function (x) {
      var c = newCustomer(x[2]), d = addDays(START, int(8, 80));
      var fake = { id: '', no: '', inv: '', shop: x[2] === 'IT' ? 'WEB-IT' : x[2] === 'HR' ? 'WEB-HR' : 'WEB-SI', name: c.name, email: c.email, country: x[2] };
      var t = addTxn(fake, x[0], 'capture', d, int(30, 260) * 100 + pick([0, 40, 90, 99]), { account: x[1], ref: x[3] });
      t.oid = null; t.orphan = true;
      injected.noOrder++;
    });

    // ── refunds with credit notes (+ a few without), chargebacks ─────────────
    var refundable = orders.filter(function (o) { return !o._x && o.markedPaid && !o.noPayment && o.date <= addDays(genDate, -8) && capOf(o) && o.provider !== 'cod'; });
    take(refundable, Math.round(refundable.length * .04)).forEach(function (o, k) {
      var c = capOf(o), full = chance(.6), amt = full ? o.amount : Math.min(o.amount - 100, pick([1990, 2490, 3990, 4990, 990]));
      if (amt <= 0) amt = o.amount;
      var d = addDays(c.date, int(4, 26)); if (d > genDate) d = genDate;
      var noCn = k % 18 === 5;
      if (!noCn) o.cns.push({ no: 'CN26-' + o.country + '-' + pad(++cnSeq + 400, 5), date: addDays(d, -int(0, 1)), amount: amt });
      var r = addTxn(o, o.provider === 'bank' ? 'bank' : c.provider, 'refund', d, -amt, { account: c.account, brand: c.brand, wallet: c.wallet, ref: c.ref || o.no });
      if (o.provider === 'bank') { r.payer = c.payer; r.iban = c.iban; r.ref = 'VRACILO ' + o.no; }
      r.method = c.method;
    });
    take(candidates(function (o) { return o.markedPaid && !o.noPayment && /monri|adyen|paypal/.test(o.provider) && o.date <= addDays(genDate, -25) && capOf(o); }), 6).forEach(function (o) {
      var c = capOf(o);
      var t = addTxn(o, c.provider, 'chargeback', addDays(c.date, int(18, 45)), -o.amount, { account: c.account, brand: c.brand, wallet: c.wallet, ref: c.ref || o.no });
      t.method = c.method;
      t.reason = pick(['Fraud: card not present', 'Goods not received', 'Not as described', 'Duplicate processing']);
      if (t.date > genDate) t.date = genDate;
    });

    // ── payouts per account ──────────────────────────────────────────────────
    txns.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.time < b.time ? -1 : a.time > b.time ? 1 : 0; });
    var byAcc = {};
    txns.forEach(function (t) { if (t.provider !== 'bank') (byAcc[t.account] = byAcc[t.account] || []).push(t); });
    var pSeq = 0, bSeq = 0;
    ACCOUNTS.forEach(function (a) {
      var list = byAcc[a.id] || []; if (!list.length) return;
      var periods = [];
      if (a.cadence === 'daily') {
        // one batch per business day, weekend transactions roll into Monday's batch
        var cur = null;
        list.forEach(function (t) {
          var settle = nextBusiness(t.date);
          if (!cur || cur.key !== settle) { cur = { key: settle, from: t.date, to: t.date, lines: [] }; periods.push(cur); }
          cur.to = t.date; cur.lines.push(t);
        });
        periods.forEach(function (p) { p.payDate = addBusiness(p.key, a.lag); });
      } else {
        var wk = {};
        list.forEach(function (t) {
          var mon = addDays(t.date, -((dow(t.date) + 6) % 7));
          if (!wk[mon]) { wk[mon] = { key: mon, from: mon, to: addDays(mon, 6), lines: [] }; periods.push(wk[mon]); }
          wk[mon].lines.push(t);
        });
        periods.forEach(function (p) { p.payDate = addBusiness(p.to, a.lag); });
      }
      periods.forEach(function (p) {
        if (p.payDate > genDate) return; // not yet paid out
        var gross = 0, fees = 0;
        p.lines.forEach(function (t) { gross += t.gross; fees += t.fee; });
        var po = { id: 'P' + (++pSeq), account: a.id, provider: a.provider, batch: batchId(a, p.payDate, pSeq), date: p.payDate, from: p.from, to: p.to,
          lines: p.lines.map(function (t) { return t.id; }), gross: gross, fees: fees, net: gross - fees, count: p.lines.length };
        p.lines.forEach(function (t) { t.payout = po.id; });
        payouts.push(po);
      });
    });
    function batchId(a, d, n) {
      var c = d.replace(/-/g, '');
      switch (a.provider) {
        case 'monri': return 'MNR-' + a.id.slice(-2).toUpperCase() + '-' + c;
        case 'adyen': return 'AdrialEU_batch_' + (1200 + n);
        case 'paypal': return 'PP-' + (a.id === 'paypal-vallis' ? 'VAL' : 'ADR') + '-' + c;
        case 'klarna': return 'KL-' + a.id.slice(-2).toUpperCase() + '-' + (880000 + n);
        case 'flik': return 'BKT-' + c;
        case 'valu': return 'VALU-' + c;
        default: return 'COD-' + a.id.slice(4).toUpperCase() + '-' + c;
      }
    }

    // ── bank statement lines (demo account, fake IBAN) ───────────────────────
    var ACC = {}; ACCOUNTS.forEach(function (a) { ACC[a.id] = a; });
    var missing = {}, diffs = {};
    var oldPos = payouts.filter(function (p) { return p.date >= addDays(START, 14) && p.date <= addDays(genDate, -10) && p.net > 0; });
    [pick(oldPos.filter(function (p) { return p.provider === 'klarna'; })), pick(oldPos.filter(function (p) { return p.provider === 'cod'; }))].forEach(function (p) { if (p) missing[p.id] = 1; });
    [pick(oldPos.filter(function (p) { return p.provider === 'paypal' && !missing[p.id]; })), pick(oldPos.filter(function (p) { return p.provider === 'monri' && !missing[p.id]; }))].forEach(function (p, k) { if (p) diffs[p.id] = k ? -250 : -1240; });
    payouts.forEach(function (p) {
      if (missing[p.id]) return;
      var a = ACC[p.account], lag = p.provider === 'adyen' || p.provider === 'flik' ? 0 : int(0, 1);
      var arr = addBusiness(p.date, lag); if (lag === 0) arr = p.date;
      if (arr > genDate) return; // in transit
      var amt = p.net + (diffs[p.id] || 0);
      bank.push({ id: 'B' + (++bSeq), date: arr, amount: amt, counterparty: a.bank, text: (amt < 0 ? 'DEBIT ' : 'SETTLEMENT ') + p.batch, payout: p.id, kind: 'payout' });
    });
    txns.forEach(function (t) {
      if (t.provider !== 'bank') return;
      bank.push({ id: 'B' + (++bSeq), date: t.date, amount: t.gross, counterparty: t.payer, text: t.ref || '(no reference)', txn: t.id, kind: t.gross < 0 ? 'refund' : 'customer', iban: t.iban });
    });
    // an unexplained provider credit (reserve release) with no payout report behind it
    bank.push({ id: 'B' + (++bSeq), date: addDays(genDate, -19), amount: 41250, counterparty: 'ADYEN N.V.', text: 'RESERVE RELEASE REF 77120', kind: 'unknown' });
    bank.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });

    orders.forEach(function (o) { delete o._x; });
    txns.forEach(function (t) { delete t.oid; delete t.oid2; });
    return {
      version: VERSION, genDate: genDate, start: START, end: END,
      orders: orders, txns: txns, payouts: payouts, bank: bank, customers: customers.length,
      missingPayouts: Object.keys(missing), diffPayouts: diffs
    };
  }

  window.ReconData = {
    VERSION: VERSION, PROVIDERS: PROVIDERS, ACCOUNTS: ACCOUNTS, SHOPS: SHOPS, METHOD_LABEL: METHOD_LABEL, OWNERS: OWNERS,
    generate: generate, todayLj: todayLj,
    util: { pad: pad, ymd: ymd, parse: parse, addDays: addDays, diffDays: diffDays, dow: dow, addBusiness: addBusiness }
  };
})();
