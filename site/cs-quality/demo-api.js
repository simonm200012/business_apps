/* DEMO layer for the customer service quality app (static hosting, no server).
 * Answers /api/csquality/{session,meta,nps,npsdetail,agents,tickets,bots,calls,reasons} in the browser with MADE-UP numbers.
 * Everything here is fictional: no real shops, customers, agents, tickets, figures or e-mail addresses.
 * Loaded after /_shared/demo-api.js and before app.js.
 *
 * Every figure is generated per calendar day from a seeded random generator (StratumDemo.rng, seed = the day
 * plus the market/queue/bot), so the same day always has the same numbers whatever range is asked for, and the
 * pages agree with each other (tickets = answered + closed without answer + open, handed over + ended in the
 * bot = chats, histogram counts = answered tickets, ...). Market and date filters change the sums. */
(function () {
  'use strict';
  var D = window.StratumDemo;
  if (!D) return;

  var MARKETS = ['IT', 'CRO', 'SI', 'Other'];
  var EDGES = [300, 900, 1800, 3600, 7200, 10800, 14400, 21600, 28800, 43200, 57600, 86400, 129600, 172800, 259200, 345600, 432000, 604800, 1209600];
  var NB = EDGES.length + 1;
  var LIVE_EMAIL = 'demo@tokovi.example';

  // ── small helpers ──────────────────────────────────────────────────────
  function normal(r) { var u = Math.max(r(), 1e-9), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  function count(r, mean) { return Math.max(0, Math.round(mean + Math.sqrt(Math.max(mean, 0.25)) * 0.8 * normal(r))); }
  function binom(r, n, p) { var k = 0; for (var i = 0; i < n; i++) if (r() < p) k++; return k; }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function dayNum(day) { return Math.round(D.parseDay(day).getTime() / 864e5); }
  function addDay(day, n) { return D.iso(D.addDays(D.parseDay(day), n)); }
  function isWeekend(day) { var w = D.parseDay(day).getUTCDay(); return w === 0 || w === 6; }
  function mondayOf(day) { var d = D.parseDay(day), wd = (d.getUTCDay() + 6) % 7; return D.iso(D.addDays(d, -wd)); }
  function dataThrough() { return D.iso(D.addDays(D.today(), -1)); }
  function seed(tag) { return D.rng('csq|' + tag); }
  // the AI contact-reason classification starts 20 weeks before the latest data day (a Monday)
  function reasonsStart(dt) { return mondayOf(addDay(dt, -140)); }
  function memo(store, key, fn) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : (store[key] = fn()); }

  // ── definitions (all fictional) ─────────────────────────────────────────
  // ticket queues: base = tickets per working day, ans = share that gets a first answer,
  // med = median hours to first answer, sig = spread (log-normal)
  var QUEUES = [
    { m: 'IT', q: 'Customer care', base: 38, ans: 0.72, med: 2.6, sig: 1.4 },
    { m: 'IT', q: 'Orders & delivery', base: 26, ans: 0.78, med: 3.4, sig: 1.3 },
    { m: 'IT', q: 'Returns & complaints', base: 14, ans: 0.82, med: 5.5, sig: 1.3 },
    { m: 'IT', q: 'Contact lens advice', base: 8, ans: 0.85, med: 4.0, sig: 1.2 },
    { m: 'CRO', q: 'Korisnička podrška', base: 24, ans: 0.74, med: 2.0, sig: 1.4 },
    { m: 'CRO', q: 'Narudžbe i dostava', base: 15, ans: 0.8, med: 2.8, sig: 1.3 },
    { m: 'CRO', q: 'Povrati i reklamacije', base: 7, ans: 0.84, med: 4.6, sig: 1.3 },
    { m: 'SI', q: 'Podpora strankam', base: 16, ans: 0.76, med: 1.6, sig: 1.3 },
    { m: 'SI', q: 'Naročila in dostava', base: 9, ans: 0.8, med: 2.4, sig: 1.3 },
    { m: 'SI', q: 'Vračila in reklamacije', base: 5, ans: 0.85, med: 4.2, sig: 1.3 },
    { m: 'Other', q: 'General inbox', base: 8, ans: 0.35, med: 9.0, sig: 1.5 }
  ];
  var NPS_MK = [
    { m: 'IT', base: 7, pro: 0.5, det: 0.24 },
    { m: 'CRO', base: 4.5, pro: 0.58, det: 0.17 },
    { m: 'SI', base: 3.2, pro: 0.52, det: 0.22 }
  ];
  var BOTS = [
    { m: 'IT', bot: 'Tokovi Lenses IT', base: 48, ho: 0.34 },
    { m: 'CRO', bot: 'Tokovi Optika HR', base: 24, ho: 0.30 },
    { m: 'SI', bot: 'Tokovi Optika SI', base: 15, ho: 0.27 }
  ];
  var TOPICS = [
    ['Order status', 0.34, 0.18], ['Delivery & tracking', 0.26, 0.24], ['Returns & refunds', 0.2, 0.52],
    ['Contact lens advice', 0.16, 0.3], ['Frame fitting & sizing', 0.12, 0.28], ['Prescription questions', 0.1, 0.46],
    ['Payment problems', 0.09, 0.5], ['Discount codes', 0.08, 0.2], ['Product availability', 0.14, 0.26], ['Other', 0.07, 0.4]
  ];
  // inbound calls per working day and the usual answered rate (with a mild summer dip when people are on leave)
  var CALL_MK = {
    IT: { base: 40, rate: 0.82 },
    CRO: { base: 28, rate: 0.86 },
    SI: { base: 22, rate: 0.88 }
  };
  // AI contact reasons: category share of classified tickets, and the detail reasons (ticket statuses) inside it
  var CATS = [
    ['ORDER_INQUIRY', 0.34, [['delivery_status', 0.4], ['order_change', 0.18], ['order_cancellation', 0.1], ['(no status)', 0.32]]],
    ['PRODUCT_INQUIRY', 0.2, [['lens_advice', 0.34], ['frame_sizing', 0.24], ['availability', 0.26], ['(no status)', 0.16]]],
    ['PAYMENT_INQUIRY', 0.1, [['payment_failed', 0.42], ['refund_status', 0.38], ['(no status)', 0.2]]],
    ['INVOICE_REQUEST', 0.08, [['invoice_copy', 0.7], ['company_details', 0.18], ['(no status)', 0.12]]],
    ['RETURN_REQUEST', 0.1, [['return_label', 0.5], ['warranty_claim', 0.3], ['(no status)', 0.2]]],
    ['DELIVERY_ISSUE', 0.08, [['parcel_delayed', 0.55], ['damaged_parcel', 0.25], ['wrong_item', 0.2]]],
    ['UNCLASSIFIED', 0.1, [['(no status)', 1]]]
  ];

  // ── per-day generators (memoised) ───────────────────────────────────────
  var M_TK = {}, M_NPS = {}, M_BOT = {}, M_CALL = {}, M_RS = {}, M_DT = '';
  function resetIfNewDay(dt) { if (M_DT !== dt) { M_DT = dt; M_TK = {}; M_NPS = {}; M_BOT = {}; M_CALL = {}; M_RS = {}; M_ND = {}; } }

  function ticketDay(day, dt) {
    return memo(M_TK, day, function () {
      var age = dayNum(dt) - dayNum(day), wk = isWeekend(day), out = [];
      QUEUES.forEach(function (Q) {
        var r = seed('tk|' + day + '|' + Q.m + '|' + Q.q);
        var created = count(r, Q.base * D.shape(day) * (wk ? 0.3 : 1));
        if (!created) return;
        var drift = 1 + 0.3 * Math.sin(dayNum(day) / 19 + Q.base), avail = (age + 0.5) * 86400;
        var rec = { date: day, market: Q.m, queue: Q.q, created: created, answered: 0, closed_no_answer: 0, still_open: 0, sla_overdue: 0, fa_overdue: 0, fa_sum_s: 0, hist: [] };
        var i, h = []; for (i = 0; i < NB; i++) h.push(0);
        var slaExtra = 0;
        for (i = 0; i < created; i++) {
          var u = r();
          if (u < Q.ans) {
            var t = Math.max(90, Q.med * 3600 * drift * Math.exp(Q.sig * normal(r)));
            if (t > avail) { rec.still_open++; slaExtra += age > 2 ? 1 : 0; continue; }
            t = Math.round(t);
            rec.answered++; rec.fa_sum_s += t;
            if (t > 86400) rec.fa_overdue++; else if (r() < 0.012) slaExtra++;
            var b = 0; while (b < EDGES.length && t >= EDGES[b]) b++;
            h[b]++;
          } else {
            var pOpen = age < 14 ? 0.35 * (1 - age / 14) + 0.01 : 0.008;
            if (r() < pOpen) { rec.still_open++; slaExtra += age > 2 ? 1 : 0; } else rec.closed_no_answer++;
          }
        }
        rec.sla_overdue = Math.min(created, rec.fa_overdue + slaExtra);
        rec.hist = h;
        out.push(rec);
      });
      return out;
    });
  }

  function npsDay(day) {
    return memo(M_NPS, day, function () {
      var wk = isWeekend(day), out = [];
      NPS_MK.forEach(function (K, ki) {
        var r = seed('nps|' + day + '|' + K.m);
        var n = count(r, K.base * D.shape(day) * (wk ? 0.5 : 1));
        var drift = 0.06 * Math.sin(dayNum(day) / 45 + ki * 2);
        var pro = K.pro + drift, det = K.det - drift / 2;
        var P = 0, Pa = 0, De = 0, sum = 0, i, u;
        for (i = 0; i < n; i++) {
          u = r();
          if (u < pro) { P++; sum += r() < 0.55 ? 10 : 9; }
          else if (u > 1 - det) { De++; sum += 6 - Math.floor(r() * r() * 7); }
          else { Pa++; sum += r() < 0.5 ? 8 : 7; }
        }
        if (n) out.push({ date: day, market: K.m, channel: 'E-mail', scale: '0-10', responses: n, promoters: P, passives: Pa, detractors: De, score_sum: sum });
        if (!wk && r() < 0.18) {
          var pn = r() < 0.3 ? 2 : 1, ps = 0, opts = [2, 3, 4, 4, 5, 5];
          for (i = 0; i < pn; i++) ps += opts[Math.floor(r() * opts.length)];
          out.push({ date: day, market: K.m, channel: 'Phone', scale: '1-5', responses: pn, promoters: 0, passives: 0, detractors: 0, score_sum: ps });
        }
      });
      return out;
    });
  }

  function botDay(day) {
    return memo(M_BOT, day, function () {
      var out = [], progress = (dayNum(day) - dayNum('2025-09-01')) / 400;
      BOTS.forEach(function (B, bi) {
        var r = seed('bot|' + day + '|' + B.m);
        var chats = count(r, B.base * D.shape(day) * (isWeekend(day) ? 0.7 : 1));
        if (!chats) return;
        var p = clamp(B.ho - 0.06 * progress + 0.03 * Math.sin(dayNum(day) / 23 + bi) + (r() - 0.5) * 0.06, 0.05, 0.9);
        var ho = binom(r, chats, p), em = binom(r, ho, 0.35);
        var wanted = binom(r, chats, clamp(p * 0.7 + 0.05, 0, 1));
        var errP = 0.025 + (B.m === 'SI' && Math.sin(dayNum(day) / 31) > 0.85 ? 0.05 : 0);
        var rated = binom(r, chats, 0.12), happy = 0, unsure = 0, unhappy = 0, i, u;
        for (i = 0; i < rated; i++) { u = r(); if (u < 0.65) happy++; else if (u < 0.77) unsure++; else unhappy++; }
        out.push({ date: day, market: B.m, bot: B.bot, chats: chats, handed_over: ho, handed_over_email: em, wanted_person: wanted, bot_only_end: chats - ho, bot_errors: binom(r, chats, errP), rated_happy: happy, rated_unsure: unsure, rated_unhappy: unhappy, user_messages: Math.round(chats * (3.4 + r())) });
      });
      return out;
    });
  }

  function callDay(day) {
    return memo(M_CALL, day, function () {
      var out = [], wk = isWeekend(day);
      Object.keys(CALL_MK).forEach(function (m) {
        var C = CALL_MK[m], r = seed('call|' + day + '|' + m), vol = C.base * D.shape(day), mo = D.parseDay(day).getUTCMonth();
        var rate = C.rate - (mo === 6 || mo === 7 ? 0.07 : 0) + 0.03 * Math.sin(dayNum(day) / 17);
        rate = clamp(rate + (r() - 0.5) * 0.08, 0.05, 0.97);
        var calls, ans, un, callers, row;
        if (!wk) {
          calls = count(r, vol * (0.85 + 0.3 * r()));
          if (calls) {
            ans = binom(r, calls, rate); un = calls - ans;
            callers = Math.max(1, Math.min(calls, Math.round(calls * (0.55 + 0.1 * r()))));
            out.push({ date: day, market: m, direction: 'Inbound', hours: 'Inside hours', calls: calls, answered: ans, unanswered: un, abandoned: Math.round(un * 0.96), callers: callers, callers_answered: Math.min(callers, ans, Math.round(callers * rate * 1.1)), wait_answered_sum_s: Math.round(ans * (20 + 35 * r())), wait_unanswered_sum_s: Math.round(un * (100 + 40 * r())) });
          }
          var ob = count(r, vol * 0.3);
          if (ob) { var oa = binom(r, ob, 0.6); out.push({ date: day, market: m, direction: 'Outbound', hours: 'Inside hours', calls: ob, answered: oa, unanswered: ob - oa, abandoned: 0, callers: ob, callers_answered: oa, wait_answered_sum_s: oa * 8, wait_unanswered_sum_s: (ob - oa) * 25 }); }
          if (m === 'IT' && r() < 0.4) out.push({ date: day, market: m, direction: 'Internal', hours: 'Inside hours', calls: 2, answered: 2, unanswered: 0, abandoned: 0, callers: 2, callers_answered: 2, wait_answered_sum_s: 10, wait_unanswered_sum_s: 0 });
        }
        calls = count(r, vol * (wk ? 0.1 : 0.14));
        if (calls) out.push({ date: day, market: m, direction: 'Inbound', hours: 'Outside hours', calls: calls, answered: 0, unanswered: calls, abandoned: calls, callers: Math.max(1, Math.round(calls * 0.8)), callers_answered: 0, wait_answered_sum_s: 0, wait_unanswered_sum_s: calls * 15 });
      });
      return out;
    });
  }

  // classified (AI) tickets of one day: [{market, ai_category, reason, tickets}]
  function reasonDay(day, dt) {
    return memo(M_RS, day, function () {
      var out = [];
      if (day < reasonsStart(dt)) return out;
      var tk = ticketDay(day, dt);
      ['IT', 'CRO', 'SI'].forEach(function (m) {
        var total = 0; tk.forEach(function (t) { if (t.market === m) total += t.created; });
        total *= 0.5;
        var r = seed('rs|' + day + '|' + m);
        CATS.forEach(function (c) {
          var drift = 1 + 0.15 * Math.sin(dayNum(day) / 13 + c[1] * 40);
          c[2].forEach(function (rs) {
            var n = count(r, total * c[1] * rs[1] * drift);
            if (n) out.push({ market: m, ai_category: c[0], reason: rs[0], tickets: n });
          });
        });
      });
      return out;
    });
  }

  // ── NPS answers by queue and AI contact reason (each e-mail answer belongs to one ticket) ──────────
  // The day's answers of a market (npsDay) are dealt out to its queues and, once the AI classification runs, to a
  // contact reason; returns and delivery problems get more detractors, product advice more promoters. Totals by market
  // and day equal the NPS rows.
  var QBIAS = function (q) { return /return|povrat|vračil|reklam/i.test(q) ? [0.7, 1, 1.8] : /order|naru|naro|dostav/i.test(q) ? [0.95, 1, 1.25] : /advice|lens/i.test(q) ? [1.25, 1, 0.7] : [1, 1, 1]; };
  var CBIAS = { DELIVERY_ISSUE: [0.6, 1, 2], RETURN_REQUEST: [0.75, 1, 1.6], PAYMENT_INQUIRY: [0.85, 1, 1.4], PRODUCT_INQUIRY: [1.3, 1, 0.7], INVOICE_REQUEST: [1.1, 1, 0.9], ORDER_INQUIRY: [1, 1, 1], UNCLASSIFIED: [1, 1, 1] };
  function pickW(r, items, w) { var t = 0, i; for (i = 0; i < w.length; i++) t += w[i]; var u = r() * t; for (i = 0; i < w.length; i++) { u -= w[i]; if (u <= 0) return items[i]; } return items[items.length - 1]; }
  var M_ND = {};
  function npsDetailDay(day, dt) {
    return memo(M_ND, day, function () {
      var acc = {}, keys = [], classified = day >= reasonsStart(dt);
      npsDay(day).forEach(function (x) {
        if (x.scale !== '0-10') return;
        var r = seed('npsd|' + day + '|' + x.market), qs = QUEUES.filter(function (q) { return q.m === x.market; });
        [['promoters', x.promoters, 0], ['passives', x.passives, 1], ['detractors', x.detractors, 2]].forEach(function (k) {
          for (var i = 0; i < k[1]; i++) {
            var q = pickW(r, qs, qs.map(function (Q) { return Q.base * QBIAS(Q.q)[k[2]]; }));
            var c = classified ? pickW(r, CATS, CATS.map(function (C) { return C[1] * (CBIAS[C[0]] || [1, 1, 1])[k[2]]; }))[0] : null;
            var key = x.market + '|' + q.q + '|' + c;
            if (!acc[key]) { acc[key] = { date: day, market: x.market, queue: q.q, ai_category: c, promoters: 0, passives: 0, detractors: 0 }; keys.push(key); }
            acc[key][k[0]]++;
          }
        });
      });
      return keys.map(function (k) { return acc[k]; });
    });
  }
  function npsDetail(R, dt) {
    var rows = [];
    R.days.forEach(function (day) { npsDetailDay(day, dt).forEach(function (x) { if (inMarket(R, x.market)) rows.push(x); }); });
    return { rows: rows, reasonsFrom: reasonsStart(dt) };
  }

  // ── Agent scorecard (optional in the app; fictional agents) ─────────────
  // Each market's answered tickets, first-answer time, SLA misses and e-mail NPS answers are shared out among its
  // agents, so the agents of a market add up to the market's totals.
  var AGENTS = [
    { m: 'IT', a: 'Giulia R.', w: 1.2, speed: 0.8, sla: 0.7, q: [1.15, 1, 0.8], ro: 0.8 }, { m: 'IT', a: 'Marco B.', w: 1, speed: 1.1, sla: 1.1, q: [1, 1, 1], ro: 1 },
    { m: 'IT', a: 'Sara L.', w: 0.9, speed: 1, sla: 0.9, q: [1.05, 1, 0.9], ro: 0.9 }, { m: 'IT', a: 'Luca F.', w: 0.6, speed: 1.5, sla: 1.6, q: [0.85, 1, 1.35], ro: 1.6 },
    { m: 'CRO', a: 'Ivana K.', w: 1.1, speed: 0.9, sla: 0.8, q: [1.1, 1, 0.85], ro: 0.9 }, { m: 'CRO', a: 'Marko P.', w: 1, speed: 1.15, sla: 1.2, q: [0.95, 1, 1.1], ro: 1.2 },
    { m: 'CRO', a: 'Petra Š.', w: 0.7, speed: 1, sla: 1, q: [1, 1, 1], ro: 1 },
    { m: 'SI', a: 'Nina Z.', w: 1, speed: 0.85, sla: 0.8, q: [1.15, 1, 0.8], ro: 0.8 }, { m: 'SI', a: 'Jure M.', w: 0.9, speed: 1.2, sla: 1.3, q: [0.9, 1, 1.25], ro: 1.3 },
    { m: 'SI', a: 'Tjaša K.', w: 0.6, speed: 1, sla: 1, q: [1, 1, 1], ro: 1 }
  ];
  function share(total, ws) { var t = 0, out = [], i, given = 0; ws.forEach(function (w) { t += w; }); for (i = 0; i < ws.length; i++) { var v = i === ws.length - 1 ? total - given : Math.round(total * ws[i] / t); out.push(v); given += v; } return out; }
  function agents(R, dt) {
    var acc = {};
    AGENTS.forEach(function (A) { if (inMarket(R, A.m)) acc[A.a] = { market: A.m, agent: A.a, answered: 0, fa_sum_s: 0, sla_overdue: 0, reopened: 0, promoters: 0, passives: 0, detractors: 0 }; });
    R.days.forEach(function (day) {
      ['IT', 'CRO', 'SI'].forEach(function (m) {
        if (!inMarket(R, m)) return;
        var ag = AGENTS.filter(function (A) { return A.m === m; }), ans = 0, fa = 0, sla = 0, r = seed('agt|' + day + '|' + m);
        ticketDay(day, dt).forEach(function (t) { if (t.market === m) { ans += t.answered; fa += t.fa_sum_s; sla += t.sla_overdue; } });
        var a1 = share(ans, ag.map(function (A) { return A.w * (0.85 + 0.3 * r()); })), s1 = share(sla, ag.map(function (A, i) { return a1[i] * A.sla + 0.001; }));
        var fw = ag.map(function (A, i) { return a1[i] * A.speed; }), ft = fw.reduce(function (x, y) { return x + y; }, 0);
        ag.forEach(function (A, i) { var o = acc[A.a]; o.answered += a1[i]; o.fa_sum_s += ft ? Math.round(fa * fw[i] / ft) : 0; o.sla_overdue += s1[i]; o.reopened += binom(r, a1[i], 0.035 * A.ro); });
        npsDay(day).forEach(function (x) {
          if (x.market !== m || x.scale !== '0-10') return;
          [['promoters', x.promoters, 0], ['passives', x.passives, 1], ['detractors', x.detractors, 2]].forEach(function (k) {
            for (var i = 0; i < k[1]; i++) acc[pickW(r, ag, ag.map(function (A) { return A.w * A.q[k[2]]; })).a][k[0]]++;
          });
        });
      });
    });
    return { rows: Object.keys(acc).map(function (k) { return acc[k]; }) };
  }

  // ── request handling ───────────────────────────────────────────────────
  function bad(msg) { return { __status: 400, error: msg }; }
  function range(params, dt) {
    var from = params.get('from'), to = params.get('to'), market = params.get('market') || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '')) return bad('Choose a valid From and To date.');
    if (from > to) return bad('"From" must be on or before "To".');
    if (dayNum(to) - dayNum(from) > 400) return bad('Choose at most 400 days.');
    if (market && MARKETS.indexOf(market) < 0) return bad('Unknown market.');
    var end = to > dt ? dt : to;
    return { from: from, to: to, end: end, market: market, days: from > end ? [] : D.days(from, end) };
  }
  function inMarket(R, m) { return !R.market || R.market === m; }

  function meta(dt) {
    var f = function (source, t) { return { source: source, data_through: t }; };
    return { dataThrough: dt, reasonsFrom: reasonsStart(dt), freshness: [f('Tickets', dt), f('NPS surveys', dt), f('Calls', dt), f('AI chatbot', dt), f('AI contact reasons', dt), f('Summary rebuilt', D.iso(D.today()))] };
  }

  function tickets(R, dt) {
    var rows = [], hw = {}, hq = {};
    R.days.forEach(function (day) {
      ticketDay(day, dt).forEach(function (t) {
        if (!inMarket(R, t.market)) return;
        rows.push({ date: t.date, market: t.market, queue: t.queue, created: t.created, answered: t.answered, closed_no_answer: t.closed_no_answer, still_open: t.still_open, sla_overdue: t.sla_overdue, fa_overdue: t.fa_overdue, fa_sum_s: t.fa_sum_s });
        var kw = mondayOf(day) + '|' + t.market, kq = t.market + '|' + t.queue;
        var a = hw[kw] || (hw[kw] = new Array(NB).fill(0)), b = hq[kq] || (hq[kq] = new Array(NB).fill(0));
        for (var i = 0; i < NB; i++) { a[i] += t.hist[i]; b[i] += t.hist[i]; }
      });
    });
    var histWeek = [], histQueue = [];
    Object.keys(hw).sort().forEach(function (k) { var p = k.split('|'); hw[k].forEach(function (n, i) { if (n) histWeek.push({ week: p[0], market: p[1], bucket: i, n: n }); }); });
    Object.keys(hq).sort().forEach(function (k) { var p = k.split('|'); hq[k].forEach(function (n, i) { if (n) histQueue.push({ market: p[0], queue: p[1], bucket: i, n: n }); }); });
    return { rows: rows, histWeek: histWeek, histQueue: histQueue };
  }

  function nps(R) {
    var rows = [];
    R.days.forEach(function (day) { npsDay(day).forEach(function (x) { if (inMarket(R, x.market)) rows.push(x); }); });
    return { rows: rows };
  }

  function bots(R, dt) {
    var rows = [];
    R.days.forEach(function (day) { botDay(day).forEach(function (x) { if (inMarket(R, x.market)) rows.push(x); }); });
    // topics: whole weeks overlapping the range (up to the last loaded day)
    var topics = [];
    if (R.days.length) {
      for (var wk = mondayOf(R.from); wk <= R.end; wk = addDay(wk, 7)) {
        var tot = {};
        for (var i = 0; i < 7; i++) { var d = addDay(wk, i); if (d > dt) break; botDay(d).forEach(function (x) { tot[x.market] = (tot[x.market] || 0) + x.chats; }); }
        BOTS.forEach(function (B) {
          if (!inMarket(R, B.m) || !tot[B.m]) return;
          var r = seed('topic|' + wk + '|' + B.m);
          TOPICS.forEach(function (T) {
            var c = Math.round(tot[B.m] * T[1] * (0.85 + 0.3 * r()));
            if (c) topics.push({ week: wk, market: B.m, topic: T[0], chats: c, handed_over: Math.min(c, Math.round(c * clamp(T[2] + (r() - 0.5) * 0.1, 0.02, 0.95))) });
          });
        });
      }
    }
    return { rows: rows, topics: topics };
  }

  function calls(R) {
    var rows = [];
    R.days.forEach(function (day) { callDay(day).forEach(function (x) { if (inMarket(R, x.market)) rows.push(x); }); });
    return { rows: rows };
  }

  function reasons(R, dt) {
    var acc = {}, keys = [];
    R.days.forEach(function (day) {
      var wk = mondayOf(day);
      reasonDay(day, dt).forEach(function (x) {
        if (!inMarket(R, x.market)) return;
        var k = wk + '|' + x.market + '|' + x.ai_category + '|' + x.reason;
        if (!acc[k]) { acc[k] = { week: wk, market: x.market, ai_category: x.ai_category, reason: x.reason, tickets: 0 }; keys.push(k); }
        acc[k].tickets += x.tickets;
      });
    });
    return { rows: keys.sort().map(function (k) { return acc[k]; }) };
  }

  D.register('/api/csquality/', function (path, params) {
    var dt = dataThrough();
    resetIfNewDay(dt);
    path = String(path || '').replace(/\/+$/, '');
    if (path === 'session') return { signedIn: true, allowed: true, email: LIVE_EMAIL };
    if (path === 'meta') return meta(dt);
    var R;
    if (['nps', 'npsdetail', 'agents', 'tickets', 'bots', 'calls', 'reasons'].indexOf(path) < 0) return { __status: 404, error: 'Unknown demo endpoint.' };
    R = range(params, dt);
    if (R.__status) return R;
    if (path === 'nps') return nps(R);
    if (path === 'npsdetail') return npsDetail(R, dt);
    if (path === 'agents') return agents(R, dt);
    if (path === 'tickets') return tickets(R, dt);
    if (path === 'bots') return bots(R, dt);
    if (path === 'calls') return calls(R);
    return reasons(R, dt);
  });
})();
