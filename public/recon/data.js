/* Payment reconciliation: demo data generator. All money is integer cents. */
(function () {
  'use strict';
  var VERSION = 1;
  function rng(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  function dn(s) { return Math.round(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 864e5); }
  function ymd(n) { var d = new Date(n * 864e5); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function dowN(n) { return (((n + 4) % 7) + 7) % 7; }
  function add(s, n) { return ymd(dn(s) + n); }
  function diff(a, b) { return dn(b) - dn(a); }
  function addWd(s, n) { var d = dn(s); while (n > 0) { d++; var w = dowN(d); if (w > 0 && w < 6) n--; } return ymd(d); }
  function todayLj() { var p = {}; new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Ljubljana', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; }); return p.year + '-' + p.month + '-' + p.day; }
  function cents2(c) { var s = c < 0 ? '-' : ''; c = Math.abs(c); return s + Math.floor(c / 100) + '.' + pad(c % 100); }
  var util = { rng: rng, pad: pad, dn: dn, ymd: ymd, add: add, dow: function (s) { return dowN(dn(s)); }, diff: diff, addWd: addWd, todayLj: todayLj, cents2: cents2 };

  var PROVIDERS = { adyen: { n: 'Adyen', k: 1 }, paypal: { n: 'PayPal', k: 2 }, klarna: { n: 'Klarna', k: 3 }, flik: { n: 'Flik', k: 4 }, valu: { n: 'VALÚ', k: 5 }, cod: { n: 'COD carriers', k: 6 }, bank: { n: 'Bank transfer', k: 7 } };
  var METHOD_LABEL = { card: 'Card', paypal: 'PayPal', klarna: 'Klarna', flik: 'Flik', valu: 'VALÚ', cod: 'Cash on delivery', bank: 'Bank transfer' };
  var ACCOUNTS = [
    { id: 'adyen-si', provider: 'adyen', method: 'card', label: 'Adyen cards SI', cur: 'EUR', cadence: 'daily', lag: 2, pct: 0.0165, fix: 11 },
    { id: 'adyen-hr', provider: 'adyen', method: 'card', label: 'Adyen cards HR', cur: 'EUR', cadence: 'daily', lag: 2, pct: 0.0185, fix: 11 },
    { id: 'adyen-it', provider: 'adyen', method: 'card', label: 'Adyen cards IT', cur: 'EUR', cadence: 'daily', lag: 2, pct: 0.0190, fix: 11 },
    { id: 'adyen-gbp', provider: 'adyen', method: 'card', label: 'Adyen cards GBP', cur: 'GBP', cadence: 'weekly', wd: 3, lag: 2, pct: 0.0220, fix: 12 },
    { id: 'paypal-eur', provider: 'paypal', method: 'paypal', label: 'PayPal EUR', cur: 'EUR', cadence: 'daily', lag: 1, pct: 0.0340, fix: 35 },
    { id: 'paypal-chf', provider: 'paypal', method: 'paypal', label: 'PayPal CHF', cur: 'CHF', cadence: 'weekly', wd: 1, lag: 1, pct: 0.0390, fix: 35 },
    { id: 'klarna-si', provider: 'klarna', method: 'klarna', label: 'Klarna SI', cur: 'EUR', cadence: 'weekly', wd: 2, lag: 3, pct: 0.0249, fix: 30 },
    { id: 'klarna-hr', provider: 'klarna', method: 'klarna', label: 'Klarna HR', cur: 'EUR', cadence: 'weekly', wd: 4, lag: 3, pct: 0.0269, fix: 30 },
    { id: 'flik', provider: 'flik', method: 'flik', label: 'Flik', cur: 'EUR', cadence: 'daily', lag: 1, pct: 0.0050, fix: 0 },
    { id: 'valu', provider: 'valu', method: 'valu', label: 'VALÚ', cur: 'EUR', cadence: 'weekly', wd: 4, lag: 2, pct: 0.0290, fix: 0 },
    { id: 'cod-gls', provider: 'cod', method: 'cod', label: 'COD GLS', cur: 'EUR', cadence: 'weekly', wd: 2, lag: 2, pct: 0.0110, fix: 55 },
    { id: 'cod-dpd', provider: 'cod', method: 'cod', label: 'COD DPD', cur: 'EUR', cadence: 'weekly', wd: 3, lag: 2, pct: 0.0095, fix: 55 },
    { id: 'cod-ps', provider: 'cod', method: 'cod', label: 'COD Pošta SI', cur: 'EUR', cadence: 'weekly', wd: 1, lag: 3, pct: 0.0120, fix: 45 },
    { id: 'cod-hp', provider: 'cod', method: 'cod', label: 'COD Hrvatska pošta', cur: 'EUR', cadence: 'weekly', wd: 4, lag: 3, pct: 0.0150, fix: 50 },
    { id: 'cod-brt', provider: 'cod', method: 'cod', label: 'COD BRT', cur: 'EUR', cadence: 'weekly', wd: 5, lag: 3, pct: 0.0160, fix: 60 },
    { id: 'cod-pi', provider: 'cod', method: 'cod', label: 'COD Poste Italiane', cur: 'EUR', cadence: 'weekly', wd: 2, lag: 4, pct: 0.0200, fix: 50 }
  ];
  var SHOPS = [{ id: 'asi', name: 'adrial.si', cc: 'SI' }, { id: 'ahr', name: 'adrial.hr', cc: 'HR' }, { id: 'ait', name: 'adrial.it', cc: 'IT' }];
  var OWNERS = [{ id: 'tina', name: 'Tina K.', role: 'Accounts receivable' }, { id: 'miha', name: 'Miha P.', role: 'Finance' }, { id: 'ana', name: 'Ana R.', role: 'Customer service' }, { id: 'luka', name: 'Luka B.', role: 'Accounting' }];
  var NAMES = {
    SI: { f: ['Ana', 'Maja', 'Nina', 'Petra', 'Tina', 'Jure', 'Luka', 'Matej', 'Marko', 'Andrej', 'Eva', 'Tomaž', 'Špela', 'Žiga'], l: ['Novak', 'Horvat', 'Kovačič', 'Krajnc', 'Zupančič', 'Potočnik', 'Mlakar', 'Vidmar', 'Kos', 'Golob', 'Božič', 'Korošec'] },
    HR: { f: ['Ivana', 'Marija', 'Petra', 'Ivan', 'Marko', 'Josip', 'Luka', 'Katarina', 'Ante', 'Matea'], l: ['Horvat', 'Kovačević', 'Babić', 'Marić', 'Jurić', 'Knežević', 'Vuković', 'Božić', 'Pavlović', 'Matić'] },
    IT: { f: ['Giulia', 'Chiara', 'Sofia', 'Marco', 'Luca', 'Matteo', 'Andrea', 'Francesca', 'Paolo'], l: ['Rossi', 'Russo', 'Ferrari', 'Esposito', 'Bianchi', 'Romano', 'Colombo', 'Ricci', 'Greco', 'Conti'] }
  };
  var METHOD_MIX = { SI: [['card', .38], ['paypal', .12], ['klarna', .08], ['flik', .12], ['valu', .05], ['cod', .15], ['bank', .10]], HR: [['card', .40], ['paypal', .10], ['klarna', .08], ['cod', .30], ['bank', .12]], IT: [['card', .60], ['paypal', .25], ['klarna', .10], ['cod', .05]] };
  var deacc = function (s) { return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, ''); };
  function pickW(r, list) { var x = r(), a = 0; for (var i = 0; i < list.length; i++) { a += list[i][1]; if (x < a) return list[i][0]; } return list[list.length - 1][0]; }
  function amountFor(r) { return 2390 + Math.floor(Math.pow(r(), 1.8) * 62600); }
  function feeFor(a, amount) { return Math.round(amount * a.pct + a.fix); }
  function lagFor(r, m) { return m === 'klarna' ? 1 + Math.floor(r() * 3) : m === 'cod' ? 3 + Math.floor(r() * 7) : m === 'bank' ? Math.floor(r() * 7) : m === 'valu' ? 1 + Math.floor(r() * 2) : m === 'flik' ? 0 : Math.floor(r() * 2); }

  function generate(genDate) {
    var r = rng(0x5EC0A7), REF = genDate, orders = [], used = {}, cust = { SI: [], HR: [], IT: [] }, txns = [], seq = 0, invN = { SI: 10000, HR: 10000, IT: 10000 };
    ['SI', 'HR', 'IT'].forEach(function (cc) {
      var N = NAMES[cc], n = cc === 'SI' ? 1250 : cc === 'HR' ? 950 : 300;
      for (var i = 0; i < n; i++) { var f = N.f[Math.floor(r() * N.f.length)], l = N.l[Math.floor(r() * N.l.length)]; cust[cc].push({ name: f + ' ' + l, email: deacc(f) + '.' + deacc(l) + (10 + Math.floor(r() * 990)) + '@example.com', cc: cc }); }
    });
    function newNo() { var no; do { no = String([3, 5, 7, 9][Math.floor(r() * 4)]) + String(10000 + Math.floor(r() * 90000)); } while (used[no]); used[no] = 1; return no; }
    function mkOrder(date, cc, c, method, total) {
      var o = { no: newNo(), inv: 'R26-' + cc + '-' + String(invN[cc]++).padStart(5, '0'), date: date, shop: cc === 'SI' ? 'asi' : cc === 'HR' ? 'ahr' : 'ait', cc: cc, name: c.name, email: c.email, total: total, method: method, brand: method === 'card' ? (r() < 0.55 ? 'visa' : r() < 0.85 ? 'mastercard' : 'amex') : '', paid: false, _seq: seq++ };
      orders.push(o); return o;
    }
    for (var off = 90; off >= 1; off--) {
      var day = add(REF, -off), w = dowN(dn(day)), cnt = Math.round((w === 0 ? 34 : w === 6 ? 38 : 49) * (0.85 + r() * 0.3));
      for (var i = 0; i < cnt; i++) {
        var cc = pickW(r, [['SI', 0.5], ['HR', 0.38], ['IT', 0.12]]), c = cust[cc][Math.floor(r() * cust[cc].length)];
        mkOrder(day, cc, c, pickW(r, METHOD_MIX[cc]), amountFor(r));
      }
    }
    /* injections */
    var age = function (o) { return diff(o.date, REF); };
    function take(pred, n, tag) { var cand = orders.filter(function (o) { return !o.inj && pred(o); }), out = []; for (var i = 0; i < n && cand.length; i++) { var o = cand.splice(Math.floor(r() * cand.length), 1)[0]; o.inj = tag; out.push(o); } return out; }
    take(function (o) { return (o.method === 'card' || o.method === 'paypal') && age(o) >= 12; }, 7, 'double');
    take(function (o) { return o.method === 'card' && age(o) >= 12; }, 8, 'round');
    take(function (o) { return o.method === 'klarna' && age(o) >= 12; }, 6, 'partial');
    take(function (o) { return o.method === 'paypal' && age(o) >= 12; }, 5, 'chf');
    take(function (o) { return o.method === 'card' && age(o) >= 12; }, 2, 'gbp');
    take(function (o) { return o.method === 'klarna' && age(o) >= 12; }, 4, 'ksplit');
    take(function (o) { return o.method === 'bank' && o.total >= 30000 && age(o) >= 14; }, 6, 'instal');
    take(function (o) { return (o.method === 'card' || o.method === 'paypal') && age(o) >= 12; }, 6, 'nopay');
    var bankOld = orders.filter(function (o) { return o.method === 'bank' && age(o) >= 14 && !o.inj; });
    take(function (o) { return o.method === 'bank' && age(o) >= 14; }, Math.round(bankOld.length * 0.06), 'proforma');
    take(function (o) { return o.method === 'card' && age(o) >= 47; }, 6, 'chargeback');
    take(function (o) { return o.method === 'bank' && age(o) >= 12; }, 9, 'multi').forEach(function (o) {
      var t = mkOrder(add(o.date, r() < 0.5 ? 0 : 1), o.cc, { name: o.name, email: o.email }, 'bank', amountFor(r)); t.inj = 'multi2'; o.twin = t;
    });
    /* txn builder */
    var accOf = {}; ACCOUNTS.forEach(function (a) { accOf[a.id] = a; });
    function accFor(o) {
      if (o.method === 'card') return o.inj === 'gbp' ? 'adyen-gbp' : 'adyen-' + o.cc.toLowerCase();
      if (o.method === 'paypal') return o.inj === 'chf' ? 'paypal-chf' : 'paypal-eur';
      if (o.method === 'klarna') return o.cc === 'HR' ? 'klarna-hr' : 'klarna-si';
      if (o.method === 'cod') { var x = r(); return o.cc === 'SI' ? (x < 0.4 ? 'cod-gls' : x < 0.7 ? 'cod-dpd' : 'cod-ps') : o.cc === 'HR' ? (x < 0.5 ? 'cod-hp' : x < 0.8 ? 'cod-gls' : 'cod-dpd') : (x < 0.6 ? 'cod-brt' : 'cod-pi'); }
      return o.method;
    }
    function refFor(o, x) {
      var m = o.method;
      if (m === 'card') return x < 0.15 ? '#' + o.no : o.no;
      if (m === 'paypal') return x < 0.05 ? '' : 'Adrial order ' + o.no;
      if (m === 'cod') return x < 0.16 ? '' : 'COD ' + o.no;
      if (m === 'bank') { var pre = o.cc === 'SI' ? 'SI' : o.cc === 'HR' ? 'HR' : 'RF'; return x < 0.45 ? pre + '00 26' + o.inv.slice(-5) : x < 0.60 ? pre + '12 ' + o.no : x < 0.80 ? 'Plačilo računa ' + o.inv : x < 0.90 ? 'Nakup očal' : ''; }
      return o.no;
    }
    function payerName(o, x) { var n = o.name.split(' '); if (o.method === 'bank') return x < 0.12 ? cust[o.cc][Math.floor(r() * cust[o.cc].length)].name.split(' ').reverse().join(' ').toUpperCase() : n.slice().reverse().join(' ').toUpperCase(); return o.name; }
    function mk(o, p) {
      var a = accOf[p.acc] || null, t = { _o: o, _s: seq++, date: p.date, provider: a ? a.provider : 'bank', account: p.acc, method: o ? o.method : p.method, brand: o ? o.brand : '', kind: p.kind || 'capture', amount: p.amount, cur: a ? a.cur : 'EUR', fee: p.fee != null ? p.fee : (a ? feeFor(a, Math.abs(p.amount)) : 0), ref: p.ref, name: p.name, email: p.email || '', cc: p.cc, cn: p.cn };
      if (t.kind === 'refund') t.fee = 0; txns.push(t); return t;
    }
    var refundK = 0;
    orders.forEach(function (o) {
      var x = r(), x2 = r(), lag = lagFor(r, o.method), acc = accFor(o), a = accOf[acc];
      if (o.inj === 'nopay') { o.paid = true; return; }
      if (o.inj === 'proforma') return;
      var date = add(o.date, lag); if (date > REF) return;
      var cur = a ? a.cur : 'EUR', amount = o.total, ref = refFor(o, x), email = o.method === 'card' || o.method === 'paypal' || o.method === 'klarna' || o.method === 'valu' ? o.email : '', name = payerName(o, x2);
      if (cur === 'CHF') amount = Math.round(o.total * 0.93); if (cur === 'GBP') amount = Math.round(o.total * 0.85);
      if (o.inj === 'round') amount += (r() < 0.5 ? -1 : 1) * (1 + Math.floor(r() * 2));
      if (o.inj === 'partial') amount = Math.round(o.total * (0.85 + r() * 0.1));
      if (o.inj === 'multi') { var tw = o.twin; ref = 'Plačilo ' + o.no + ' in ' + tw.no; amount = o.total + tw.total; name = o.name.split(' ').reverse().join(' ').toUpperCase(); tw.paid = true; }
      if (o.inj === 'multi2') return;
      var base = { acc: acc, date: date, amount: amount, ref: ref, name: name, email: email, cc: o.cc };
      if (o.inj === 'instal') { var a1 = Math.round(o.total * 0.6); mk(o, Object.assign({}, base, { amount: a1, ref: 'SI00 26' + o.inv.slice(-5) })); mk(o, Object.assign({}, base, { date: add(date, 4 + Math.floor(r() * 6)), amount: o.total - a1, ref: 'SI00 26' + o.inv.slice(-5) })); o.paid = true; return; }
      if (o.inj === 'ksplit') { var k1 = Math.round(o.total * 0.5); mk(o, Object.assign({}, base, { amount: k1 })); mk(o, Object.assign({}, base, { date: add(date, 1 + Math.floor(r() * 3)), amount: o.total - k1 })); o.paid = true; return; }
      mk(o, base); o.paid = true;
      if (o.inj === 'double') mk(o, Object.assign({}, base, { date: add(date, Math.floor(r() * 3)) }));
      if (o.inj === 'chargeback') mk(o, Object.assign({}, base, { kind: 'chargeback', date: add(o.date, 20 + Math.floor(r() * 25)), amount: -o.total, fee: 1500, ref: o.no }));
      else if (!o.inj && (o.method === 'card' || o.method === 'paypal' || o.method === 'klarna') && age(o) >= 5 && r() < 0.04) {
        var k = refundK++, rd = add(date, 3 + Math.floor(r() * 18)); if (rd <= REF) mk(o, Object.assign({}, base, { kind: 'refund', date: rd, amount: -o.total, ref: base.ref || o.no, cn: k % 18 === 5 ? null : 'CN26-' + String(2000 + k) }));
      }
    });
    /* orphan payments (no order) */
    for (var i = 0; i < 11; i++) {
      var cc2 = pickW(r, [['SI', 0.5], ['HR', 0.38], ['IT', 0.12]]), m = ['card', 'paypal', 'bank', 'card'][i % 4], N = NAMES[cc2], nm = N.f[Math.floor(r() * N.f.length)] + ' ' + N.l[Math.floor(r() * N.l.length)];
      var acc2 = m === 'card' ? 'adyen-' + cc2.toLowerCase() : m === 'paypal' ? 'paypal-eur' : 'bank', d = add(REF, -(5 + Math.floor(r() * 75)));
      mk(null, { acc: acc2, method: m, date: d, amount: amountFor(r), ref: i % 3 === 0 ? '' : m === 'bank' ? 'Nakup ' + newNo() : newNo(), name: m === 'bank' ? nm.split(' ').reverse().join(' ').toUpperCase() : nm, email: m === 'bank' ? '' : deacc(nm) + '@example.org', cc: cc2 });
    }
    /* finalise ids, drop hidden truth */
    orders.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a._seq - b._seq; });
    orders.forEach(function (o, i) { o.id = 'O' + (i + 1); });
    txns.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a._s - b._s; });
    txns.forEach(function (t, i) { t.id = 'T' + (i + 1); });
    /* payouts */
    var pmap = {}, payouts = [];
    txns.forEach(function (t) {
      var a = accOf[t.account]; if (!a) return;
      var pd; if (a.cadence === 'daily') pd = addWd(t.date, a.lag); else { pd = add(t.date, a.lag); while (dowN(dn(pd)) !== a.wd) pd = add(pd, 1); }
      if (pd > REF) { t.payout = null; return; }
      var k = a.id + '|' + pd, p = pmap[k]; if (!p) { p = pmap[k] = { account: a.id, date: pd, gross: 0, fees: 0, net: 0, txnIds: [] }; payouts.push(p); }
      p.gross += t.amount; p.fees += t.fee; p.net = p.gross - p.fees; p.txnIds.push(t.id); t.payout = p;
    });
    payouts.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.account < b.account ? -1 : 1; });
    payouts.forEach(function (p, i) { p.id = 'P' + (i + 1); });
    txns.forEach(function (t) { t.payout = t.payout ? t.payout.id : null; delete t._o; delete t._s; });
    orders.forEach(function (o) { delete o._seq; delete o.inj; delete o.twin; });
    /* bank statement */
    var bank = [], bankOk = payouts.filter(function (p) { return addWd(p.date, 2) <= add(REF, -5); });
    var miss = {}, dif = {};
    ['klarna', 'cod'].forEach(function (pv) { var c = bankOk.filter(function (p) { return accOf[p.account].provider === pv && p.net > 20000; }); if (c.length) miss[c[Math.floor(c.length / 2)].id] = 1; });
    [['adyen', -1240], ['paypal', -250]].forEach(function (x) { var c = bankOk.filter(function (p) { return accOf[p.account].provider === x[0] && accOf[p.account].cur === 'EUR' && !miss[p.id] && p.net > 30000; }); if (c.length) dif[c[Math.floor(c.length / 3)].id] = x[1]; });
    var PN = { adyen: 'ADYEN N.V. SETTLEMENT', paypal: 'PAYPAL (EUROPE) S.A.R.L.', klarna: 'KLARNA BANK AB PAYOUT', flik: 'FLIK PAYMENTS', valu: 'VALU D.O.O. PAYOUT', cod: 'COD REMITTANCE' };
    payouts.forEach(function (p) {
      var a = accOf[p.account], bd = addWd(p.date, 2); if (bd > REF || miss[p.id]) return;
      bank.push({ date: bd, amount: p.net + (dif[p.id] || 0), cur: a.cur, text: PN[a.provider] + ' ' + a.label.toUpperCase() + ' ' + p.date, payoutId: p.id });
    });
    txns.forEach(function (t) { if (t.provider === 'bank' && t.kind === 'capture') bank.push({ date: t.date, amount: t.amount, cur: 'EUR', text: 'INCOMING TRANSFER ' + t.name + (t.ref ? ' / ' + t.ref : ''), txnId: t.id }); });
    bank.push({ date: add(REF, -22), amount: 41250, cur: 'EUR', text: 'ADYEN N.V. RESERVE RELEASE', unknown: true });
    bank.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.amount - b.amount; });
    bank.forEach(function (b, i) { b.id = 'B' + (i + 1); });
    return { genDate: REF, orders: orders, txns: txns, payouts: payouts, bank: bank };
  }
  window.ReconData = { VERSION: VERSION, PROVIDERS: PROVIDERS, ACCOUNTS: ACCOUNTS, SHOPS: SHOPS, METHOD_LABEL: METHOD_LABEL, OWNERS: OWNERS, generate: generate, todayLj: todayLj, util: util };
})();
