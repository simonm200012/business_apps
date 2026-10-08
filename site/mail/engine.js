/* Adrial Mail — engine: profile/event index, segment evaluation, predictive metrics, attribution,
 * message stats, flow runner (history + live), campaign/SMS send simulation. Nothing leaves the browser. */
(function () {
  'use strict';
  var AM = window.AM, U = AM.U, DAY = U.DAY, HOUR = U.HOUR;
  var E = AM.E = {};
  var db = null, idx = null;

  E.EVENTS = {
    view: 'Viewed product', cart: 'Added to cart', checkout: 'Started checkout', order: 'Placed order',
    open: 'Opened email', click: 'Clicked email', sms_click: 'Clicked SMS', unsub: 'Unsubscribed', sub: 'Subscribed to list',
    form: 'Submitted form', spam: 'Marked email as spam', bounce: 'Bounced email', price_drop: 'Price drop', bis: 'Back in stock',
    flow: 'Entered flow', prop: 'Profile updated'
  };
  E.SEG_EVENTS = ['order', 'view', 'cart', 'checkout', 'open', 'click', 'sms_click', 'sub', 'form', 'unsub', 'bounce', 'spam', 'price_drop', 'bis'];
  E.TRIGGER_EVENTS = ['checkout', 'order', 'view', 'cart', 'price_drop', 'bis', 'form'];
  E.CATEGORIES = ['Frames', 'Sunglasses', 'Contact lenses', 'Solutions', 'Optical lenses', 'Accessories'];
  E.SOURCES = ['Checkout', 'Popup form', 'Footer form', 'In-store tablet', 'Import 2023', 'Contest', 'Event simulator'];
  E.STORES = ['Ljubljana Center', 'Ljubljana BTC', 'Maribor', 'Celje', 'Koper', 'Kranj', 'Novo mesto', 'Zagreb Ilica', 'Zagreb Arena', 'Split', 'Rijeka', 'Osijek', 'Zadar'];

  // ── Index ──────────────────────────────────────────────────────────────
  function byTs(a, b) { return a.ts - b.ts; }
  E.init = function (d) { db = d; rebuild(); };
  E.db = function () { return db; };
  function rebuild() {
    idx = { ver: 1, byId: new Map(), ev: new Map(), lists: new Map(), pred: new Map(), cache: {}, products: new Map() };
    db.products.forEach(function (p) { idx.products.set(p.sku, p); });
    db.profiles.forEach(function (p) { idx.byId.set(p.id, p); });
    db.events.forEach(function (e) { var a = idx.ev.get(e.p); if (!a) { a = []; idx.ev.set(e.p, a); } a.push(e); });
    idx.ev.forEach(function (a) { a.sort(byTs); });
    db.lists.forEach(function (l) { idx.lists.set(l.id, new Set(l.members)); });
  }
  E.rebuild = rebuild;
  E.touch = function () { idx.ver++; idx.cache = {}; idx.pred.clear(); };
  E.ver = function () { return idx.ver; };
  E.now = function () { return Date.now() + ((db && db.meta.clockOffset) || 0); };
  E.profile = function (id) { return idx.byId.get(+id) || null; };
  E.product = function (sku) { return idx.products.get(sku) || null; };
  E.catOf = function (sku) { var p = idx.products.get(sku); return p ? p.category : ''; };
  E.events = function (pid) { return idx.ev.get(+pid) || []; };
  function find(arr, id) { id = +id; for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i]; return null; }
  E.campaign = function (id) { return find(db.campaigns, id); };
  E.flow = function (id) { return find(db.flows, id); };
  E.list = function (id) { return find(db.lists, id); };
  E.segment = function (id) { return find(db.segments, id); };
  E.template = function (id) { return find(db.templates, id); };
  E.form = function (id) { return find(db.forms, id); };
  E.nextId = function (kind) { var ids = db.meta.ids; ids[kind] = (ids[kind] || 0) + 1; return ids[kind]; };
  E.fullName = function (p) { return p ? p.first + ' ' + p.last : 'Unknown profile'; };

  E.canEmail = function (p) { return p && p.em && p.em.s === 'subscribed' && !p.sup && !!p.email; };
  E.canSms = function (p) { return p && p.sms && p.sms.s === 'subscribed' && !p.sup && !!p.phone; };

  // ── Events ─────────────────────────────────────────────────────────────
  // live: run flow triggers for this event (simulator, forms, sends). Returns [{flow, run}] entries.
  E.addEvent = function (e, opt) {
    opt = opt || {};
    db.events.push(e);
    var a = idx.ev.get(e.p); if (!a) { a = []; idx.ev.set(e.p, a); }
    if (!a.length || a[a.length - 1].ts <= e.ts) a.push(e);
    else { var i = a.length; while (i > 0 && a[i - 1].ts > e.ts) i--; a.splice(i, 0, e); }
    idx.ver++; idx.cache = {}; idx.pred.delete(e.p);
    var p = idx.byId.get(e.p);
    if (p) {
      if (e.t === 'unsub') { if (e.x === 'sms') p.sms = { s: 'unsubscribed', at: e.ts }; else p.em = { s: 'unsubscribed', at: e.ts }; }
      if (e.t === 'spam') p.em = { s: 'unsubscribed', at: e.ts };
      if (e.t === 'bounce' && e.x === 'hard') p.sup = { r: 'Hard bounce', at: e.ts };
      if (e.t === 'order' && E.catOf(e.s) === 'Contact lenses' && p.props && p.props.lens_supply_days) p.props.lens_refill_date = U.ymd(e.ts + p.props.lens_supply_days * DAY);
    }
    if (opt.live) return E.onEvent(e, opt);
    return [];
  };

  // ── Field model for segments ───────────────────────────────────────────
  E.PROP_FIELDS = [
    { k: 'country', label: 'Country', type: 'enum', opts: [['SI', 'Slovenia'], ['HR', 'Croatia']] },
    { k: 'lang', label: 'Language', type: 'enum', opts: [['sl', 'Slovenian'], ['hr', 'Croatian'], ['en', 'English']] },
    { k: 'city', label: 'City', type: 'text' },
    { k: 'source', label: 'Signup source', type: 'enum', opts: E.SOURCES.map(function (s) { return [s, s]; }) },
    { k: 'created', label: 'Profile created', type: 'date' },
    { k: 'email', label: 'Email address', type: 'text' },
    { k: 'phone', label: 'Phone number', type: 'text' },
    { k: 'birthday', label: 'Birthday', type: 'date' },
    { k: 'props.preferred_store', label: 'Preferred store', type: 'enum', opts: E.STORES.map(function (s) { return [s, s]; }) },
    { k: 'props.lens_supply_days', label: 'Lens supply (days)', type: 'number' },
    { k: 'props.lens_brand', label: 'Lens brand', type: 'text' },
    { k: 'props.lens_refill_date', label: 'Lens refill date', type: 'date' },
    { k: 'props.next_eye_exam', label: 'Next eye exam', type: 'date' },
    { k: 'props.vip', label: 'VIP flag', type: 'text' }
  ];
  E.OPS = {
    text: [['eq', 'equals'], ['neq', 'does not equal'], ['contains', 'contains'], ['ncontains', 'does not contain'], ['set', 'is set'], ['notset', 'is not set']],
    enum: [['eq', 'is'], ['neq', 'is not'], ['set', 'is set'], ['notset', 'is not set']],
    number: [['eq', 'equals'], ['neq', 'does not equal'], ['gt', 'is greater than'], ['lt', 'is less than'], ['set', 'is set'], ['notset', 'is not set']],
    date: [['last', 'is in the last … days'], ['next', 'is in the next … days'], ['before', 'is before'], ['after', 'is after'], ['set', 'is set'], ['notset', 'is not set']]
  };
  E.PRED_FIELDS = [['clv', 'Predicted CLV (€)', 'number'], ['churn', 'Churn risk', 'enum'], ['orders', 'Historic orders', 'number'], ['spent', 'Historic spend (€)', 'number'], ['aov', 'Average order value (€)', 'number'], ['nextDays', 'Days until predicted next order', 'number'], ['sinceDays', 'Days since last order', 'number']];
  E.fieldDef = function (k) { for (var i = 0; i < E.PROP_FIELDS.length; i++) if (E.PROP_FIELDS[i].k === k) return E.PROP_FIELDS[i]; return { k: k, label: k.replace(/^props\./, '') + ' (custom)', type: 'text' }; };
  function getField(p, k) { if (k.indexOf('props.') === 0) return p.props ? p.props[k.slice(6)] : undefined; return p[k]; }
  function toTs(v) { if (typeof v === 'number') return v; return U.parseYmd(v); }

  function propCond(c, p, now) {
    var def = E.fieldDef(c.field), v = getField(p, c.field), has = v != null && v !== '';
    if (c.op === 'set') return has; if (c.op === 'notset') return !has;
    if (!has) return c.op === 'neq' || c.op === 'ncontains';
    if (def.type === 'date') {
      var t = toTs(v); if (t == null) return false;
      var n = U.num(c.value, 0);
      if (c.op === 'last') return t <= now && t >= now - n * DAY;
      if (c.op === 'next') return t >= U.dayStart(now) && t <= now + n * DAY;
      var ref = toTs(c.value); if (ref == null) return false;
      return c.op === 'before' ? t < ref : t > ref;
    }
    if (def.type === 'number') {
      var a = Number(v), b = Number(c.value);
      return c.op === 'eq' ? a === b : c.op === 'neq' ? a !== b : c.op === 'gt' ? a > b : c.op === 'lt' ? a < b : false;
    }
    var s = String(v).toLowerCase(), q = String(c.value == null ? '' : c.value).toLowerCase();
    return c.op === 'eq' ? s === q : c.op === 'neq' ? s !== q : c.op === 'contains' ? s.indexOf(q) >= 0 : c.op === 'ncontains' ? s.indexOf(q) < 0 : false;
  }
  function whereOk(e, w) {
    if (!w || !w.field || w.value === '' || w.value == null) return true;
    switch (w.field) {
      case 'category': return E.catOf(e.s) === w.value;
      case 'sku': return e.s === w.value;
      case 'value': return w.op === 'lt' ? (e.v || 0) < +w.value : (e.v || 0) >= +w.value;
      case 'message': return typeof e.r === 'string' && (e.r === w.value || e.r.indexOf(w.value + ':') === 0);
      case 'list': return +e.r === +w.value;
    }
    return true;
  }
  E.evCount = function (pid, c, ctx) {
    var arr = E.events(pid), now = ctx.now, from = -Infinity, n = 0;
    var win = c.win || { type: 'all' };
    if (win.type === 'last') from = now - U.num(win.days, 30) * DAY;
    else if (win.type === 'since') from = ctx.since != null ? ctx.since : -Infinity;
    for (var i = 0; i < arr.length; i++) {
      var e = arr[i];
      if (e.t !== c.ev || e.ts < from) continue;
      if (ctx.cap && e.ts > now) break;
      if (c.where && !whereOk(e, c.where)) continue;
      n++;
    }
    return n;
  };
  E.cond = function (c, p, ctx) {
    ctx = ctx || { now: E.now() };
    switch (c.kind) {
      case 'prop': return propCond(c, p, ctx.now);
      case 'consent':
        var st = c.channel === 'sms' ? p.sms : p.em;
        if (c.value === 'suppressed') return !!p.sup;
        if (c.value === 'can') return c.channel === 'sms' ? E.canSms(p) : E.canEmail(p);
        return !!st && st.s === c.value;
      case 'event':
        var n = E.evCount(p.id, c, ctx), k = U.num(c.n, 1);
        return c.op === 'zero' ? n === 0 : c.op === 'atmost' ? n <= k : c.op === 'exactly' ? n === k : n >= k;
      case 'list':
        var inl = E.inList(c.list, p.id);
        return c.op === 'notin' ? !inl : inl;
      case 'pred':
        var pr = E.pred(p), v = pr[c.field];
        if (c.field === 'churn') return c.op === 'neq' ? v !== c.value : v === c.value;
        if (v == null) return false;
        return c.op === 'gt' ? v > +c.value : c.op === 'lt' ? v < +c.value : Math.round(v) === +c.value;
      case 'segment':
        var sg = E.segment(c.seg); if (!sg) return false;
        var inS = E.segSet(sg).has(p.id); return c.op === 'notin' ? !inS : inS;
    }
    return false;
  };
  E.match = function (def, p, ctx) {
    var groups = (def && def.groups) || [];
    if (!groups.length) return false;
    var f = function (g) {
      var cs = g.conds || []; if (!cs.length) return true;
      return g.match === 'any' ? cs.some(function (c) { return E.cond(c, p, ctx); }) : cs.every(function (c) { return E.cond(c, p, ctx); });
    };
    return def.match === 'any' ? groups.some(f) : groups.every(f);
  };
  E.members = function (def) {
    var key = 'm:' + JSON.stringify(def);
    if (idx.cache[key]) return idx.cache[key];
    var ctx = { now: E.now() }, out = [];
    for (var i = 0; i < db.profiles.length; i++) if (E.match(def, db.profiles[i], ctx)) out.push(db.profiles[i].id);
    idx.cache[key] = out;
    return out;
  };
  E.segSet = function (seg) {
    var key = 's:' + seg.id + ':' + JSON.stringify(seg.def);
    if (!idx.cache[key]) idx.cache[key] = new Set(E.members(seg.def));
    return idx.cache[key];
  };
  E.inList = function (lid, pid) { var s = idx.lists.get(+lid); return !!s && s.has(+pid); };
  E.listSize = function (l) { return l.members.length; };
  E.profileLists = function (pid) { return db.lists.filter(function (l) { return E.inList(l.id, pid); }); };
  E.profileSegments = function (p) { return db.segments.filter(function (s) { return E.segSet(s).has(p.id); }); };
  E.addToList = function (lid, pid, opt) {
    opt = opt || {}; var l = E.list(lid); if (!l || E.inList(lid, pid)) return [];
    l.members.push(+pid); idx.lists.get(l.id).add(+pid);
    return E.addEvent({ p: +pid, t: 'sub', ts: opt.ts || E.now(), r: l.id }, { live: opt.live !== false });
  };
  E.removeFromList = function (lid, pid) {
    var l = E.list(lid); if (!l) return;
    l.members = l.members.filter(function (x) { return x !== +pid; }); idx.lists.get(l.id).delete(+pid); E.touch();
  };
  E.addListIndex = function (l) { idx.lists.set(l.id, new Set(l.members)); };

  // ── Condition descriptions ─────────────────────────────────────────────
  var OPWORD = { atleast: 'at least', atmost: 'at most', exactly: 'exactly' };
  E.winText = function (w) { w = w || { type: 'all' }; return w.type === 'last' ? 'in the last ' + w.days + ' days' : w.type === 'since' ? 'since starting this flow' : 'over all time'; };
  E.condText = function (c) {
    if (!c) return '';
    switch (c.kind) {
      case 'prop':
        var d = E.fieldDef(c.field), op = (E.OPS[d.type] || E.OPS.text).filter(function (o) { return o[0] === c.op; })[0];
        var val = c.value;
        if (d.type === 'enum' && d.opts) d.opts.forEach(function (o) { if (o[0] === c.value) val = o[1]; });
        if (c.op === 'set' || c.op === 'notset') return d.label + ' ' + (op ? op[1] : c.op);
        if (c.op === 'last' || c.op === 'next') return d.label + ' is in the ' + c.op + ' ' + c.value + ' days';
        return d.label + ' ' + (op ? op[1] : c.op) + ' "' + val + '"';
      case 'consent':
        return (c.channel === 'sms' ? 'SMS' : 'Email') + ' consent ' + ({ subscribed: 'is subscribed', unsubscribed: 'is unsubscribed', never: 'was never given', suppressed: '— profile is suppressed', can: '— can receive' }[c.value] || c.value);
      case 'event':
        var t = E.EVENTS[c.ev] || c.ev;
        var where = c.where && c.where.field && c.where.value !== '' && c.where.value != null ? ' where ' + c.where.field + (c.where.field === 'value' ? (c.where.op === 'lt' ? ' < €' : ' ≥ €') : ' is ') + (c.where.field === 'list' ? ((E.list(c.where.value) || {}).name || c.where.value) : c.where.field === 'message' ? E.refName(c.where.value) : c.where.value) : '';
        if (c.op === 'zero') return 'Has not ' + t.toLowerCase().replace(/^(\w+)/, '$1') + where + ' ' + E.winText(c.win);
        return t + where + ' ' + OPWORD[c.op] + ' ' + U.plural(+c.n || 0, 'time') + ' ' + E.winText(c.win);
      case 'list': var l = E.list(c.list); return (c.op === 'notin' ? 'Not in list ' : 'In list ') + (l ? '"' + l.name + '"' : '#' + c.list);
      case 'segment': var sg = E.segment(c.seg); return (c.op === 'notin' ? 'Not in segment ' : 'In segment ') + (sg ? '"' + sg.name + '"' : '#' + c.seg);
      case 'pred':
        var pf = E.PRED_FIELDS.filter(function (f) { return f[0] === c.field; })[0];
        return (pf ? pf[1] : c.field) + ' ' + ({ gt: 'is greater than', lt: 'is less than', eq: 'is', neq: 'is not' }[c.op] || c.op) + ' ' + c.value;
    }
    return '';
  };
  E.defText = function (def) {
    if (!def || !def.groups || !def.groups.length) return 'No conditions';
    return def.groups.map(function (g) {
      var t = (g.conds || []).map(E.condText).join(g.match === 'any' ? ' OR ' : ' AND ');
      return def.groups.length > 1 && (g.conds || []).length > 1 ? '(' + t + ')' : t;
    }).join(def.match === 'any' ? ' OR ' : ' AND ');
  };

  // ── Predictive metrics (simulated, derived from events) ────────────────
  E.pred = function (p) {
    var c = idx.pred.get(p.id); if (c) return c;
    var now = E.now(), ev = E.events(p.id), orders = [], i;
    for (i = 0; i < ev.length; i++) if (ev[i].t === 'order' && ev[i].ts <= now + HOUR) orders.push(ev[i]);
    var n = orders.length, spent = 0;
    orders.forEach(function (o) { spent += o.v || 0; });
    var first = n ? orders[0].ts : null, last = n ? orders[n - 1].ts : null;
    var supply = p.props && p.props.lens_supply_days ? +p.props.lens_supply_days : 0;
    var interval = n > 1 ? (last - first) / (n - 1) : supply ? supply * DAY : 240 * DAY;
    interval = Math.max(interval, 14 * DAY);
    var next = n ? last + interval : null;
    if (supply && p.props.lens_refill_date) next = U.parseYmd(p.props.lens_refill_date);
    var since = n ? (now - last) / DAY : null;
    var ratio = n ? since / (interval / DAY) : 2;
    var score = U.clamp(0.08 + 0.45 * Math.max(0, ratio - 0.8) + 0.35 * (1 - (p.eng || 0.3)) - 0.03 * n + (p.em && p.em.s !== 'subscribed' ? 0.1 : 0), 0.02, 0.97);
    var aov = n ? spent / n : 0;
    var exp12 = n ? Math.min(12, 365 / (interval / DAY)) : 0.25 * (p.eng || 0.3);
    var clv = spent + (aov || 70) * exp12 * (1 - score);
    c = { orders: n, spent: spent, aov: aov, first: first, last: last, next: next, nextDays: next ? Math.round((next - now) / DAY) : null, sinceDays: since == null ? null : Math.round(since), churnScore: score, churn: score < 0.35 ? 'low' : score < 0.65 ? 'medium' : 'high', clv: Math.round(clv) };
    idx.pred.set(p.id, c);
    return c;
  };

  // ── Message refs, stats, attribution ───────────────────────────────────
  // refs: 'c:<id>' / 'c:<id>:<variant>' (campaign or SMS campaign), 'f:<flowId>:<stepId>' (flow message)
  E.refKind = function (ref) {
    if (typeof ref !== 'string') return null;
    if (ref.charAt(0) === 'f') return 'flow';
    var c = E.campaign(ref.split(':')[1]);
    return c && c.channel === 'sms' ? 'sms' : 'campaign';
  };
  E.refName = function (ref) {
    if (typeof ref !== 'string') return '';
    var a = ref.split(':');
    if (a[0] === 'c') { var c = E.campaign(a[1]); return c ? c.name + (a[2] ? ' (variant ' + a[2] + ')' : '') : 'Deleted campaign'; }
    if (a[0] === 'f') { var f = E.flow(a[1]); if (!f) return 'Deleted flow'; var s = E.findStep(f.steps, a[2]); return f.name + ' · ' + (s ? s.step.name || E.STEPS[s.step.type].label : 'removed step'); }
    return ref;
  };
  E.refHref = function (ref) {
    if (typeof ref !== 'string') return '';
    var a = ref.split(':'); if (a[0] === 'c') { var c = E.campaign(a[1]); return c ? (c.channel === 'sms' ? '#/sms/' : '#/campaigns/') + c.id : ''; }
    return '#/flows/' + a[1];
  };
  E.msgStats = function () {
    if (idx.cache.msg) return idx.cache.msg;
    var out = {}, seen = new Set();
    for (var i = 0; i < db.events.length; i++) {
      var e = db.events[i]; if (typeof e.r !== 'string') continue;
      var t = e.t; if (t !== 'open' && t !== 'click' && t !== 'sms_click' && t !== 'unsub' && t !== 'spam' && t !== 'bounce') continue;
      var s = out[e.r] || (out[e.r] = { open: 0, click: 0, clickTotal: 0, links: {}, unsub: 0, spam: 0, bounce: 0, hard: 0 });
      if (t === 'click' || t === 'sms_click') { s.clickTotal++; if (e.x) s.links[e.x] = (s.links[e.x] || 0) + 1; }
      var k = t + '|' + e.r + '|' + e.p; if (seen.has(k)) continue; seen.add(k);
      if (t === 'open') s.open++; else if (t === 'click' || t === 'sms_click') s.click++; else if (t === 'bounce') { s.bounce++; if (e.x === 'hard') s.hard++; } else s[t]++;
    }
    idx.cache.msg = out; return out;
  };
  E.attr = function () {
    if (idx.cache.attr) return idx.cache.attr;
    var st = db.settings, ow = st.openWin * DAY, cw = st.clickWin * DAY, sw = st.smsWin * DAY;
    var byRef = {}, months = {}, list = [], orderRef = new Map();
    idx.ev.forEach(function (arr) {
      var lo = null, lc = null, ls = null;
      for (var i = 0; i < arr.length; i++) {
        var e = arr[i];
        if (e.t === 'open') lo = e; else if (e.t === 'click') lc = e; else if (e.t === 'sms_click') ls = e;
        else if (e.t === 'order') {
          var ref = null, best = null;
          if (lc && e.ts - lc.ts <= cw) best = lc;
          if (ls && e.ts - ls.ts <= sw && (!best || ls.ts > best.ts)) best = ls;
          if (best) ref = best.r; else if (lo && e.ts - lo.ts <= ow) ref = lo.r;
          var m = U.ym(e.ts), mm = months[m] || (months[m] = { campaign: 0, flow: 0, sms: 0, total: 0, orders: 0, attributed: 0 });
          mm.total += e.v || 0; mm.orders++;
          var kind = ref ? E.refKind(ref) : null;
          list.push({ ts: e.ts, v: e.v || 0, ref: ref, kind: kind });
          if (ref) {
            orderRef.set(e, ref);
            var b = byRef[ref] || (byRef[ref] = { orders: 0, revenue: 0 }); b.orders++; b.revenue += e.v || 0;
            mm[kind] += e.v || 0; mm.attributed += e.v || 0;
          }
        }
      }
    });
    idx.cache.attr = { byRef: byRef, months: months, list: list, orderRef: orderRef };
    return idx.cache.attr;
  };
  // Sum message stats + attribution for a ref and its sub-refs (variants / flow steps).
  E.agg = function (prefix) {
    var key = 'agg:' + prefix; if (idx.cache[key]) return idx.cache[key];
    var ms = E.msgStats(), at = E.attr().byRef, o = { open: 0, click: 0, clickTotal: 0, links: {}, unsub: 0, spam: 0, bounce: 0, hard: 0, orders: 0, revenue: 0 };
    var test = function (r) { return r === prefix || r.indexOf(prefix + ':') === 0; };
    Object.keys(ms).forEach(function (r) {
      if (!test(r)) return; var s = ms[r];
      ['open', 'click', 'clickTotal', 'unsub', 'spam', 'bounce', 'hard'].forEach(function (k) { o[k] += s[k]; });
      Object.keys(s.links).forEach(function (l) { o.links[l] = (o.links[l] || 0) + s.links[l]; });
    });
    Object.keys(at).forEach(function (r) { if (test(r)) { o.orders += at[r].orders; o.revenue += at[r].revenue; } });
    idx.cache[key] = o; return o;
  };
  function rates(o, recipients) {
    o.recipients = recipients; o.delivered = Math.max(0, recipients - o.bounce);
    var d = o.delivered || 0;
    o.openRate = d ? o.open / d : 0; o.clickRate = d ? o.click / d : 0; o.ctor = o.open ? o.click / o.open : 0;
    o.convRate = d ? o.orders / d : 0; o.unsubRate = d ? o.unsub / d : 0; o.bounceRate = recipients ? o.bounce / recipients : 0;
    o.spamRate = d ? o.spam / d : 0; o.rpr = recipients ? o.revenue / recipients : 0;
    return o;
  }
  E.cStats = function (c) { return rates(Object.assign({}, E.agg('c:' + c.id)), (c.st && c.st.recipients) || 0); };
  E.variantStats = function (c, v) { var n = c.st && c.st.ab && c.st.ab.counts ? c.st.ab.counts[v] || 0 : 0; return rates(Object.assign({}, E.agg('c:' + c.id + ':' + v)), n); };
  E.stepStats = function (f, s) {
    var st = s.st || {};
    var o = rates(Object.assign({}, E.agg('f:' + f.id + ':' + s.id)), st.sent || 0);
    o.entered = st.entered || 0; o.sent = st.sent || 0; o.skipped = st.skipped || 0; o.yes = st.yes || 0; o.no = st.no || 0;
    return o;
  };
  E.flowStats = function (f) {
    var sent = 0, smsSent = 0;
    E.walk(f.steps, function (s) { if (s.st) { if (s.type === 'email') sent += s.st.sent || 0; if (s.type === 'sms') smsSent += s.st.sent || 0; } });
    var o = rates(Object.assign({}, E.agg('f:' + f.id)), sent + smsSent);
    o.entered = (f.st && f.st.entered) || 0; o.completed = (f.st && f.st.completed) || 0; o.exited = (f.st && f.st.exited) || 0;
    o.waiting = db.runs.filter(function (r) { return r.f === f.id && !r.done; }).length;
    o.emailSent = sent; o.smsSent = smsSent;
    return o;
  };
  // Totals for a time window (dashboard)
  E.period = function (from, to) {
    var key = 'per:' + from + ':' + to; if (idx.cache[key]) return idx.cache[key];
    var o = { recipients: 0, campaignRecipients: 0, flowRecipients: 0, smsRecipients: 0, open: 0, click: 0, smsClick: 0, unsub: 0, spam: 0, bounce: 0, hard: 0, subs: 0, revenue: 0, campaignRev: 0, flowRev: 0, smsRev: 0, totalRev: 0, orders: 0, attrOrders: 0, sends: 0 };
    db.campaigns.forEach(function (c) {
      if (c.status !== 'sent' || !c.sentAt || c.sentAt < from || c.sentAt > to) return;
      var n = (c.st && c.st.recipients) || 0;
      if (c.channel === 'sms') o.smsRecipients += n; else o.campaignRecipients += n;
    });
    var f1 = U.ymd(from), f2 = U.ymd(to);
    db.flows.forEach(function (f) { E.walk(f.steps, function (s) {
      if (!s.st || !s.st.d || (s.type !== 'email' && s.type !== 'sms')) return;
      Object.keys(s.st.d).forEach(function (d) { if (d >= f1 && d <= f2) { if (s.type === 'sms') o.smsRecipients += s.st.d[d]; else o.flowRecipients += s.st.d[d]; } });
    }); });
    o.recipients = o.campaignRecipients + o.flowRecipients;
    var seen = new Set();
    for (var i = 0; i < db.events.length; i++) {
      var e = db.events[i]; if (e.ts < from || e.ts > to) continue;
      switch (e.t) {
        case 'open': o.open++; break; case 'click': if (!seen.has('c' + e.r + e.p)) { seen.add('c' + e.r + e.p); o.click++; } break;
        case 'sms_click': o.smsClick++; break; case 'unsub': if (e.x !== 'sms') o.unsub++; break; case 'spam': o.spam++; break;
        case 'bounce': o.bounce++; if (e.x === 'hard') o.hard++; break; case 'sub': o.subs++; break;
      }
    }
    E.attr().list.forEach(function (a) {
      if (a.ts < from || a.ts > to) return;
      o.totalRev += a.v; o.orders++;
      if (a.kind) { o.attrOrders++; o.revenue += a.v; if (a.kind === 'flow') o.flowRev += a.v; else if (a.kind === 'sms') o.smsRev += a.v; else o.campaignRev += a.v; }
    });
    var del = Math.max(1, o.recipients - o.bounce);
    o.delivered = o.recipients - o.bounce;
    o.openRate = o.open / del; o.clickRate = o.click / del; o.convRate = o.attrOrders / Math.max(1, o.recipients + o.smsRecipients); o.unsubRate = o.unsub / del;
    o.bounceRate = o.recipients ? o.bounce / o.recipients : 0; o.spamRate = o.spam / del; o.netGrowth = o.subs - o.unsub;
    idx.cache[key] = o; return o;
  };
  // Opens/clicks per hour after send (campaign report chart)
  E.series = function (prefix, start, hours) {
    var opens = new Array(hours).fill(0), clicks = new Array(hours).fill(0), orders = new Array(hours).fill(0);
    var test = function (r) { return typeof r === 'string' && (r === prefix || r.indexOf(prefix + ':') === 0); };
    var orderRef = E.attr().orderRef;
    db.events.forEach(function (e) {
      var h = Math.floor((e.ts - start) / HOUR); if (h < 0 || h >= hours) return;
      if ((e.t === 'open') && test(e.r)) opens[h]++;
      else if ((e.t === 'click' || e.t === 'sms_click') && test(e.r)) clicks[h]++;
      else if (e.t === 'order' && test(orderRef.get(e) || '')) orders[h] += e.v || 0;
    });
    return { opens: opens, clicks: clicks, revenue: orders };
  };

  // ── Products for dynamic blocks ───────────────────────────────────────
  E.popular = function (cat) {
    var key = 'pop:' + (cat || ''); if (idx.cache[key]) return idx.cache[key];
    var cnt = {};
    db.events.forEach(function (e) { if (e.s && (e.t === 'order' || e.t === 'view')) cnt[e.s] = (cnt[e.s] || 0) + (e.t === 'order' ? 3 : 1); });
    var arr = db.products.filter(function (p) { return !cat || p.category === cat; }).slice().sort(function (a, b) { return (cnt[b.sku] || 0) - (cnt[a.sku] || 0); });
    idx.cache[key] = arr; return arr;
  };
  E.dynamic = function (mode, p, n) {
    var uniq = function (skus) { var s = []; skus.forEach(function (k) { if (s.indexOf(k) < 0 && E.product(k)) s.push(k); }); return s.slice(0, n).map(E.product); };
    if (!p) return E.popular(mode === 'reorder' ? 'Contact lenses' : '').slice(0, n);
    var ev = E.events(p.id).slice().reverse();
    if (mode === 'last_viewed') return uniq(ev.filter(function (e) { return e.t === 'view'; }).map(function (e) { return e.s; }));
    if (mode === 'cart') {
      var out = [];
      for (var i = 0; i < ev.length; i++) { if (ev[i].t === 'order') break; if ((ev[i].t === 'cart' || ev[i].t === 'checkout') && ev[i].s) out.push(ev[i].s); }
      return uniq(out);
    }
    if (mode === 'reorder') return uniq(ev.filter(function (e) { return e.t === 'order' && /Contact lenses|Solutions/.test(E.catOf(e.s)); }).map(function (e) { return e.s; }));
    var cats = {}; ev.forEach(function (e) { if (e.s) cats[E.catOf(e.s)] = (cats[E.catOf(e.s)] || 0) + 1; });
    var top = Object.keys(cats).sort(function (a, b) { return cats[b] - cats[a]; })[0];
    var bought = new Set(ev.filter(function (e) { return e.t === 'order'; }).map(function (e) { return e.s; }));
    var pool = E.popular(top).filter(function (x) { return !bought.has(x.sku); });
    if (pool.length < n) pool = pool.concat(E.popular('').filter(function (x) { return pool.indexOf(x) < 0; }));
    return pool.slice(0, n);
  };
  E.ctx = { product: function (s) { return E.product(s); }, dynamic: function (m, p, n) { return E.dynamic(m, p, n); } };
  E.pickProduct = function (p, r, cat) {
    var ev = E.events(p.id), viewed = [];
    for (var i = ev.length - 1; i >= 0 && viewed.length < 6; i--) if ((ev[i].t === 'view' || ev[i].t === 'cart') && ev[i].s) viewed.push(ev[i].s);
    if (!cat && viewed.length && r() < 0.6) return E.product(U.pick(r, viewed)) || U.pick(r, db.products);
    var pool = cat ? db.products.filter(function (x) { return x.category === cat; }) : db.products;
    return U.pick(r, pool.length ? pool : db.products);
  };
  E.orderValue = function (prod, r, p) {
    if (prod.category === 'Contact lenses') { var sup = (p && p.props && +p.props.lens_supply_days) || 90; return Math.round(prod.price * Math.max(1, Math.round(sup / 30)) * 100) / 100; }
    var v = prod.price * (r() < 0.15 ? 2 : 1); if (r() < 0.2) v += 9.9;
    return Math.round(v * 100) / 100;
  };

  // ── Message outcome simulation ─────────────────────────────────────────
  function linkPick(r, links) { if (!links.length) return null; var i = Math.min(links.length - 1, Math.floor(Math.pow(r(), 1.7) * links.length)); return links[i]; }
  E.linkIds = function (design) { return AM.Email.linkBlocks(design).map(function (b) { return b.id; }); };
  E.qualityOf = function (subject) {
    subject = String(subject || '');
    var q = 0.88 + (U.hash(subject) % 25) / 100;
    if (/\{\{\s*first_name/.test(subject)) q += 0.06;
    if (subject.length > 70) q -= 0.06;
    return q;
  };
  // Returns new events for one email delivery (does not add them).
  E.simEmail = function (p, ref, links, ts, r, o) {
    o = o || {}; var out = [], live = o.live;
    if (r() < 0.007 * (o.bounceMul || 1)) { out.push({ p: p.id, t: 'bounce', ts: ts + 30e3, r: ref, x: r() < 0.4 ? 'hard' : 'soft' }); return out; }
    var pOpen = U.clamp((0.1 + 0.62 * (p.eng || 0.3)) * (o.q || 1), 0.02, 0.93);
    if (r() >= pOpen) return out;
    var to = live ? ts + U.int(r, 2, 40) * 1000 : ts + Math.round(Math.min(96, -Math.log(1 - r() * 0.999) * 7) * HOUR) + U.int(r, 1, 50) * 60e3;
    out.push({ p: p.id, t: 'open', ts: to, r: ref });
    var pClick = U.clamp((0.035 + 0.16 * (p.eng || 0.3)) * (o.cq || 1), 0.01, 0.5);
    if (links.length && r() < pClick) {
      var tc = to + (live ? U.int(r, 2, 30) * 1000 : U.int(r, 1, 25) * 60e3);
      out.push({ p: p.id, t: 'click', ts: tc, r: ref, x: linkPick(r, links) });
      if (r() < (o.conv || 0.07)) {
        var prod = (o.sku && E.product(o.sku)) || E.pickProduct(p, r, o.cat);
        out.push({ p: p.id, t: 'order', ts: tc + (live ? U.int(r, 5, 40) * 1000 : U.int(r, 8, 36 * 60) * 60e3), s: prod.sku, v: E.orderValue(prod, r, p) });
      }
    }
    if (r() < 0.0035 * (o.unsubMul || 1)) out.push({ p: p.id, t: 'unsub', ts: to + (live ? 3000 : 90e3), r: ref, x: 'email' });
    else if (r() < 0.0005) out.push({ p: p.id, t: 'spam', ts: to + (live ? 4000 : 120e3), r: ref });
    return out;
  };
  E.simSms = function (p, ref, ts, r, o) {
    o = o || {}; var out = [], live = o.live;
    var pc = U.clamp((0.03 + 0.14 * (p.eng || 0.3)) * (o.q || 1), 0.01, 0.4);
    if (r() < pc) {
      var tc = ts + (live ? U.int(r, 2, 30) * 1000 : U.int(r, 1, 180) * 60e3);
      out.push({ p: p.id, t: 'sms_click', ts: tc, r: ref, x: 'link' });
      if (r() < (o.conv || 0.1)) { var prod = (o.sku && E.product(o.sku)) || E.pickProduct(p, r, o.cat); out.push({ p: p.id, t: 'order', ts: tc + (live ? 20000 : U.int(r, 5, 600) * 60e3), s: prod.sku, v: E.orderValue(prod, r, p) }); }
    }
    if (r() < 0.004) out.push({ p: p.id, t: 'unsub', ts: ts + (live ? 5000 : U.int(r, 1, 120) * 60e3), r: ref, x: 'sms' });
    return out;
  };

  // ── Audience ───────────────────────────────────────────────────────────
  E.refMembers = function (ref) {
    if (ref.type === 'list') { var l = E.list(ref.id); return l ? l.members : []; }
    var s = E.segment(ref.id); return s ? Array.from(E.segSet(s)) : [];
  };
  E.audience = function (c, at) {
    var inc = new Set(), exc = new Set();
    (c.audience && c.audience.include || []).forEach(function (r) { E.refMembers(r).forEach(function (id) { inc.add(id); }); });
    (c.audience && c.audience.exclude || []).forEach(function (r) { E.refMembers(r).forEach(function (id) { exc.add(id); }); });
    var o = { total: inc.size, excluded: 0, noConsent: 0, suppressed: 0, noAddress: 0, ids: [] };
    inc.forEach(function (id) {
      var p = E.profile(id); if (!p) return;
      if (at && p.created > at) { o.total--; return; }
      if (exc.has(id)) { o.excluded++; return; }
      if (p.sup) { o.suppressed++; return; }
      if (c.channel === 'sms') { if (!p.phone) { o.noAddress++; return; } if (!p.sms || p.sms.s !== 'subscribed') { o.noConsent++; return; } }
      else if (!p.em || p.em.s !== 'subscribed') { o.noConsent++; return; }
      o.ids.push(id);
    });
    return o;
  };
  E.bestHour = function () {
    var key = 'bh'; if (idx.cache[key] != null) return idx.cache[key];
    var h = new Array(24).fill(0), from = E.now() - 120 * DAY;
    db.events.forEach(function (e) { if (e.t === 'open' && e.ts > from) h[new Date(e.ts).getHours()]++; });
    var best = 0; for (var i = 8; i < 22; i++) if (h[i] > h[best] || best < 8) best = i;
    idx.cache[key] = best; return best;
  };
  E.sendTime = function (c) {
    var sc = c.schedule || {};
    if (sc.type === 'at') return sc.at || E.now();
    if (sc.type === 'smart') { var d = U.parseYmd(sc.day) || U.dayStart(E.now() + DAY); return d + E.bestHour() * HOUR; }
    return E.now();
  };

  // Simulate a campaign send. opt: {ts, r, live, limit}. Returns {events, recipients, ab}
  E.runSend = function (c, opt) {
    var r = opt.r, ts = opt.ts, live = !!opt.live, aud = E.audience(c, live ? null : ts);
    var ids = aud.ids.slice();
    for (var i = ids.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)); var t = ids[i]; ids[i] = ids[j]; ids[j] = t; }
    var events = [], st = { recipients: ids.length, excluded: aud.excluded, noConsent: aud.noConsent, suppressed: aud.suppressed, noAddress: aud.noAddress, audienceTotal: aud.total };
    var sms = c.channel === 'sms';
    var links = sms ? [] : E.linkIds(c.design || { blocks: [] });
    var conv = c.conv || (sms ? 0.1 : 0.075);
    var deliver = function (pid, ref, q, cq, at, variantDesign) {
      var p = E.profile(pid);
      // engagement timing is always realistic (spread over hours/days after the send) so reports show a real curve
      var evs = sms ? E.simSms(p, ref, at, r, { live: false, q: q, conv: conv }) : E.simEmail(p, ref, variantDesign ? E.linkIds(variantDesign) : links, at, r, { live: false, q: q, cq: cq, conv: conv });
      for (var k = 0; k < evs.length; k++) if (!opt.limit || evs[k].ts <= opt.limit) events.push(evs[k]);
      return evs;
    };
    var ab = c.ab && c.ab.on && !sms && c.ab.variants && c.ab.variants.length > 1 ? c.ab : null;
    if (!ab) {
      var q0 = sms ? 1 : E.qualityOf(c.subject) * (c.q || 1);
      ids.forEach(function (pid) { deliver(pid, 'c:' + c.id, q0, c.cq || 1, ts); });
    } else {
      var V = ab.variants, keys = V.map(function (v, i) { return String.fromCharCode(65 + i); });
      var testN = Math.max(V.length, Math.round(ids.length * U.clamp(+ab.testPct || 20, 5, 100) / 100));
      var counts = {}, res = {};
      keys.forEach(function (k) { counts[k] = 0; res[k] = { n: 0, open: 0, click: 0, revenue: 0 }; });
      var vq = function (k) { var v = V[keys.indexOf(k)]; return ab.type === 'content' ? { q: E.qualityOf(c.subject), cq: 0.85 + (U.hash(JSON.stringify((v.design || c.design).blocks.map(function (b) { return b.type; }))) % 35) / 100, design: v.design } : { q: E.qualityOf(v.subject), cq: 1 }; };
      ids.slice(0, testN).forEach(function (pid, i) {
        var k = keys[i % keys.length], qv = vq(k); counts[k]++; res[k].n++;
        deliver(pid, 'c:' + c.id + ':' + k, qv.q, qv.cq, ts, qv.design).forEach(function (e) { if (e.t === 'open') res[k].open++; if (e.t === 'click') res[k].click++; if (e.t === 'order') res[k].revenue += e.v; });
      });
      var metric = ab.metric || 'open';
      var score = function (k) { var x = res[k]; return x.n ? (metric === 'click' ? x.click / x.n : metric === 'revenue' ? x.revenue / x.n : x.open / x.n) : 0; };
      var winner = keys.slice().sort(function (a, b) { return score(b) - score(a); })[0];
      var wait = U.clamp(+ab.wait || 4, 1, 72) * HOUR, qw = vq(winner);
      var restTs = ts + wait;
      ids.slice(testN).forEach(function (pid) { counts[winner]++; deliver(pid, 'c:' + c.id + ':' + winner, qw.q, qw.cq, restTs, qw.design); });
      st.ab = { winner: winner, metric: metric, testN: testN, counts: counts, test: res, wait: ab.wait, decidedAt: ts + wait, restN: ids.length - testN };
    }
    return { events: events, st: st };
  };
  // Apply a prepared send: add events (live triggers for orders/unsubs are not needed), set stats.
  E.commitSend = function (c, res, ts) {
    res.events.sort(byTs).forEach(function (e) { E.addEvent(e); });
    c.st = res.st; c.status = 'sent'; c.sentAt = ts; c.updated = E.now();
    E.touch();
  };

  // ── Flows ──────────────────────────────────────────────────────────────
  E.STEPS = {
    email: { label: 'Email', icon: U.I.mail },
    sms: { label: 'SMS (simulated)', icon: U.I.sms },
    delay: { label: 'Time delay', icon: U.I.clock },
    split: { label: 'Conditional split', icon: U.I.split },
    tsplit: { label: 'Trigger split', icon: U.I.split },
    update: { label: 'Update profile property', icon: U.I.user },
    webhook: { label: 'Webhook (disabled in demo)', icon: U.I.hook }
  };
  E.TRIGGERS = [['list', 'Added to list'], ['checkout', 'Started checkout (abandoned cart)'], ['order', 'Placed order'], ['view', 'Viewed product'], ['cart', 'Added to cart'], ['date', 'Date property'], ['price_drop', 'Price drop'], ['bis', 'Back in stock'], ['form', 'Submitted form']];
  E.triggerText = function (t) {
    if (!t) return 'No trigger';
    if (t.type === 'list') return 'Added to list: ' + (t.lists || []).map(function (id) { var l = E.list(id); return l ? l.name : '#' + id; }).join(', ');
    if (t.type === 'date') { var d = E.fieldDef(t.prop); var off = +t.offset || 0; return 'Date: ' + d.label + (off ? ' (' + Math.abs(off) + ' days ' + (off < 0 ? 'before' : 'after') + ')' : ' (on the day)') + (t.annual ? ', every year' : ''); }
    var lab = (E.TRIGGERS.filter(function (x) { return x[0] === t.ev; })[0] || [0, t.ev])[1];
    var w = t.where && t.where.field && t.where.value !== '' && t.where.value != null ? ' · ' + (t.where.field === 'value' ? 'value ' + (t.where.op === 'lt' ? '< €' : '≥ €') + t.where.value : t.where.field + ' is ' + t.where.value) : '';
    return lab + w;
  };
  E.newStep = function (type) {
    var s = { id: 's' + U.uid(), type: type, st: {} };
    if (type === 'email') { var t = AM.Email.templateByKey('news'); s.name = 'Email'; s.subject = 'A message from Adrial'; s.preview = ''; s.design = AM.Email.reid(t.design()); }
    if (type === 'sms') { s.name = 'SMS'; s.body = 'Adrial: Hi {{ first_name|default:"there" }}, ...  Reply STOP to opt out.'; }
    if (type === 'delay') { s.amount = 1; s.unit = 'days'; }
    if (type === 'split') { s.cond = { kind: 'event', ev: 'order', op: 'atleast', n: 1, win: { type: 'since' } }; s.yes = []; s.no = []; }
    if (type === 'tsplit') { s.cond = { field: 'value', op: 'gt', value: 100 }; s.yes = []; s.no = []; }
    if (type === 'update') { s.key = 'vip'; s.value = 'yes'; }
    if (type === 'webhook') { s.url = 'https://example.com/webhook'; }
    return s;
  };
  E.findStep = function (list, id, parent) {
    for (var i = 0; i < list.length; i++) {
      var s = list[i]; if (s.id === id) return { list: list, i: i, step: s, parent: parent || null };
      if (s.yes) { var r = E.findStep(s.yes, id, s) || E.findStep(s.no, id, s); if (r) return r; }
    }
    return null;
  };
  E.walk = function (list, fn) { (list || []).forEach(function (s) { fn(s); if (s.yes) { E.walk(s.yes, fn); E.walk(s.no, fn); } }); };
  E.delayMs = function (s) { return (+s.amount || 0) * (s.unit === 'minutes' ? 60e3 : s.unit === 'hours' ? HOUR : s.unit === 'weeks' ? 7 * DAY : DAY); };
  function bump(o, k, ts, day) { o.st = o.st || {}; o.st[k] = (o.st[k] || 0) + 1; if (day) { o.st.d = o.st.d || {}; var d = U.ymd(ts); o.st.d[d] = (o.st.d[d] || 0) + 1; } }
  E.trigCond = function (c, trig) {
    if (!c || !trig) return false;
    if (c.field === 'value') { var v = +trig.v || 0; return c.op === 'lt' ? v < +c.value : c.op === 'eq' ? v === +c.value : v > +c.value; }
    var val = c.field === 'category' ? E.catOf(trig.s) : c.field === 'sku' ? trig.s : '';
    return c.op === 'neq' ? val !== c.value : val === c.value;
  };
  E.trigCondText = function (c) { if (!c) return ''; return c.field === 'value' ? 'Trigger value ' + ({ gt: '>', lt: '<', eq: '=' }[c.op] || c.op) + ' €' + c.value : 'Trigger ' + c.field + (c.op === 'neq' ? ' is not ' : ' is ') + '"' + c.value + '"'; };
  function passFilters(f, p, run) {
    var ctx = { now: run.at, since: run.ts0, cap: true };
    for (var i = 0; i < (f.filters || []).length; i++) if (!E.cond(f.filters[i], p, ctx)) return false;
    return true;
  }
  function finish(run, f, how) { run.done = how; f.st = f.st || {}; f.st[how] = (f.st[how] || 0) + 1; if (run.log) run.log.push({ ts: run.at, m: how === 'exited' ? 'Left the flow (flow filter no longer matched)' : 'Completed the flow' }); }
  E.advance = function (run, until, o) {
    var f = E.flow(run.f), p = E.profile(run.p), added = [];
    if (!f || !p) { run.done = 'removed'; return added; }
    var r = o.r || Math.random, guard = 0;
    var push = function (evs) { evs.forEach(function (e) { if (!o.limit || e.ts <= o.limit) { E.addEvent(e); added.push(e); } }); };
    while (guard++ < 300) {
      if (run.wake) { if (run.wake > until) return added; run.at = run.wake; run.wake = 0; }
      if (!run.sid) { finish(run, f, 'completed'); return added; }
      var loc = E.findStep(f.steps, run.sid);
      if (!loc) { finish(run, f, 'completed'); return added; }
      if (f.status === 'draft' && o.live) { run.done = 'stopped'; return added; }
      var s = loc.step, next = loc.list[loc.i + 1] ? loc.list[loc.i + 1].id : null;
      if (s.type !== 'delay' && !passFilters(f, p, run)) { finish(run, f, 'exited'); return added; }
      bump(s, 'entered', run.at);
      var log = run.log ? function (m) { run.log.push({ ts: run.at, m: m }); } : function () {};
      switch (s.type) {
        case 'delay':
          run.wake = run.at + E.delayMs(s); run.sid = next; log('Waiting ' + U.dur(+s.amount, s.unit)); continue;
        case 'email':
          if (f.status === 'manual') { bump(s, 'skipped', run.at); log('Email "' + (s.name || 'Email') + '" queued — flow is in Manual mode, not sent'); }
          else if (!E.canEmail(p)) { bump(s, 'skipped', run.at); log('Email "' + (s.name || 'Email') + '" skipped — no email consent / suppressed'); }
          else {
            bump(s, 'sent', run.at, true);
            var ev = E.simEmail(p, 'f:' + f.id + ':' + s.id, E.linkIds(s.design || { blocks: [] }), run.at, r, { live: o.live, q: E.qualityOf(s.subject) * (s.q || 1), cq: f.cq || 1, conv: f.conv || 0.12, sku: run.trig && run.trig.s && /checkout|cart|view|price_drop|bis/.test(run.trig.t) ? run.trig.s : null });
            push(ev); log('Email "' + (s.name || 'Email') + '" delivered (simulated)' + (ev.some(function (e) { return e.t === 'open'; }) ? ' · opened' : '') + (ev.some(function (e) { return e.t === 'click'; }) ? ' · clicked' : '') + (ev.some(function (e) { return e.t === 'order'; }) ? ' · ordered' : ''));
          }
          run.sid = next; break;
        case 'sms':
          if (f.status === 'manual') { bump(s, 'skipped', run.at); log('SMS queued — Manual mode'); }
          else if (!E.canSms(p)) { bump(s, 'skipped', run.at); log('SMS skipped — no SMS consent'); }
          else { bump(s, 'sent', run.at, true); var ev2 = E.simSms(p, 'f:' + f.id + ':' + s.id, run.at, r, { live: o.live, conv: 0.14 }); push(ev2); log('SMS delivered (simulated)' + (ev2.length ? ' · clicked' : '')); }
          run.sid = next; break;
        case 'split':
        case 'tsplit':
          var ok = s.type === 'split' ? E.cond(s.cond, p, { now: run.at, since: run.ts0, cap: true }) : E.trigCond(s.cond, run.trig);
          bump(s, ok ? 'yes' : 'no', run.at);
          var br = ok ? s.yes : s.no;
          log((s.type === 'split' ? 'Conditional split' : 'Trigger split') + ' → ' + (ok ? 'YES' : 'NO'));
          run.sid = br && br.length ? br[0].id : null; break;
        case 'update':
          if (s.key) { p.props = p.props || {}; p.props[s.key] = s.value; E.addEvent({ p: p.id, t: 'prop', ts: run.at, x: s.key + ' = ' + s.value, r: f.id }); log('Set property ' + s.key + ' = ' + s.value); }
          run.sid = next; break;
        default:
          bump(s, 'skipped', run.at); log('Webhook skipped (disabled in demo — nothing is sent)'); run.sid = next;
      }
    }
    return added;
  };
  E.reentryOk = function (f, pid, ts) {
    var re = f.reentry || { mode: 'once' }, ev = E.events(pid);
    for (var i = ev.length - 1; i >= 0; i--) {
      var e = ev[i]; if (e.t !== 'flow' || e.r !== f.id || e.ts > ts) continue;
      if (re.mode === 'always') return true;
      if (re.mode === 'once') return false;
      return ts - e.ts > (+re.days || 30) * DAY;
    }
    return true;
  };
  function reOk(f, last, ts) { var re = f.reentry || { mode: 'once' }; if (last == null || re.mode === 'always') return true; if (re.mode === 'once') return false; return ts - last > (+re.days || 30) * DAY; }
  // o.hist (generator only): Map of last entry per flow+profile instead of storing an 'Entered flow' event.
  E.enter = function (f, p, trig, ts, o) {
    if (o.hist) { var hk = f.id + ':' + p.id; if (!reOk(f, o.hist.get(hk), ts)) return null; }
    else if (!E.reentryOk(f, p.id, ts)) return null;
    if (f.trigger && f.trigger.type !== 'date' && f.trigger.type !== 'list' && f.trigger.where && !trigWhere(f.trigger.where, trig)) return null;
    var run = { id: U.uid('r'), f: f.id, p: p.id, ts0: ts, at: ts, sid: f.steps[0] ? f.steps[0].id : null, trig: trig ? { t: trig.t, s: trig.s, v: trig.v } : null, wake: 0 };
    if (o.live) run.log = [{ ts: ts, m: 'Entered flow "' + f.name + '"' }];
    f.st = f.st || {}; f.st.entered = (f.st.entered || 0) + 1; f.st.d = f.st.d || {}; var d = U.ymd(ts); f.st.d[d] = (f.st.d[d] || 0) + 1;
    if (o.hist) o.hist.set(f.id + ':' + p.id, ts); else E.addEvent({ p: p.id, t: 'flow', ts: ts, r: f.id });
    if (f.status === 'live' || f.status === 'manual') E.advance(run, o.until, o);
    if (!run.done) db.runs.push(run);
    return run;
  };
  function trigWhere(w, e) { if (!w || !w.field || w.value === '' || w.value == null) return true; return whereOk(e, w); }
  function trigMatches(f, e) {
    var t = f.trigger; if (!t) return false;
    if (t.type === 'list') return e.t === 'sub' && (t.lists || []).indexOf(+e.r) >= 0;
    if (t.type === 'event') return e.t === t.ev && (e.t !== 'form' || !t.form || +t.form === +e.r);
    return false;
  }
  // Live trigger processing. Returns [{flow, run}]
  E.onEvent = function (e, opt) {
    var out = [], p = E.profile(e.p); if (!p) return out;
    if ((opt.depth || 0) > 2) return out;
    db.flows.forEach(function (f) {
      if ((f.status !== 'live' && f.status !== 'manual') || !trigMatches(f, e)) return;
      var run = E.enter(f, p, e, e.ts, { live: true, until: E.now(), r: Math.random, depth: (opt.depth || 0) + 1 });
      out.push({ flow: f, run: run });
    });
    return out;
  };
  E.tick = function () {
    var until = E.now(), moved = [];
    db.runs.forEach(function (run) {
      if (run.done || (run.wake && run.wake > until)) return;
      E.advance(run, until, { live: true, r: Math.random });
      moved.push(run);
    });
    db.runs = db.runs.filter(function (r) { return !r.done; });
    return moved;
  };
  E.dateFires = function (f, from, to) {
    var t = f.trigger, out = [];
    if (!t || t.type !== 'date') return out;
    var off = (+t.offset || 0) * DAY;
    db.profiles.forEach(function (p) {
      var v = getField(p, t.prop), base = toTs(v); if (base == null) return;
      if (t.annual) {
        var b = new Date(base);
        for (var y = new Date(from).getFullYear(); y <= new Date(to).getFullYear(); y++) {
          var at = new Date(y, b.getMonth(), b.getDate(), 9, 0).getTime() + off;
          if (at > from && at <= to) out.push({ p: p, ts: at });
        }
      } else { var at2 = base + 9 * HOUR + off; if (at2 > from && at2 <= to) out.push({ p: p, ts: at2 }); }
    });
    return out;
  };
  E.runDateTriggers = function (from, to) {
    var n = 0;
    db.flows.forEach(function (f) {
      if (f.status !== 'live' && f.status !== 'manual') return;
      E.dateFires(f, from, to).forEach(function (x) { if (E.enter(f, x.p, { t: 'date' }, x.ts, { live: true, until: E.now(), r: Math.random })) n++; });
    });
    return n;
  };

  // ── Profiles ───────────────────────────────────────────────────────────
  E.createProfile = function (d) {
    var id = E.nextId('profile'), now = E.now();
    var p = { id: id, first: d.first || 'New', last: d.last || 'Subscriber', email: d.email || '', phone: d.phone || '', country: d.country || 'SI', lang: d.lang || 'sl', city: d.city || '', source: d.source || 'Event simulator', created: d.created || now, birthday: d.birthday || '', em: { s: d.emailConsent === false ? 'never' : 'subscribed', at: now }, sms: { s: d.smsConsent ? 'subscribed' : 'never', at: now }, sup: null, props: d.props || {}, eng: d.eng != null ? d.eng : 0.55 };
    db.profiles.push(p); idx.byId.set(id, p); E.touch();
    return p;
  };

  // ── Summary for the Analytics app (bus snapshot mail.summary) ─────────
  E.summary = function () {
    var now = E.now(), months = [], at = E.attr().months;
    for (var i = 11; i >= 0; i--) {
      var ms = U.addMonths(U.monthStart(now), -i), me = U.addMonths(ms, 1) - 1, ym = U.ym(ms), per = E.period(ms, me), a = at[ym] || {};
      months.push({ month: ym, sends: per.recipients + per.smsRecipients, emailSends: per.recipients, smsSends: per.smsRecipients, opens: per.open, clicks: per.click + per.smsClick, revenue: Math.round((a.attributed || 0) * 100) / 100, campaignRevenue: Math.round((a.campaign || 0) * 100) / 100, flowRevenue: Math.round((a.flow || 0) * 100) / 100, smsRevenue: Math.round((a.sms || 0) * 100) / 100, unsubscribes: per.unsub, newSubscribers: per.subs });
    }
    return {
      asOf: new Date(now).toISOString(), currency: 'EUR', demo: true,
      profiles: db.profiles.length, emailSubscribers: db.profiles.filter(E.canEmail).length, smsSubscribers: db.profiles.filter(E.canSms).length,
      months: months, lists: db.lists.map(function (l) { return { id: l.id, name: l.name, size: l.members.length }; }),
      attribution: { openWindowDays: db.settings.openWin, clickWindowDays: db.settings.clickWin, smsClickWindowDays: db.settings.smsWin }
    };
  };
})();
