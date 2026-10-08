/* AM.E: profile/event index, segments, predictions, attribution, stats, send simulation, flow runner */
(function () {
  const AM = window.AM = window.AM || {}, U = AM.U, M = AM.Email;
  const E = AM.E = { db: null, clock: null, ver: 0, dirty: false, rand: null };
  const DAY = U.DAY, HOUR = U.HOUR, MIN = U.MIN;
  /* The demo clock: always use E.now(), never Date.now() */
  E.now = () => E.clock != null ? E.clock : Date.now() + ((E.db && E.db.meta && E.db.meta.clockOffset) || 0);

  E.EVENT_TYPES = [['view', 'Viewed a product'], ['cart', 'Added to cart'], ['checkout', 'Started checkout'], ['order', 'Placed an order'], ['open', 'Opened an email'], ['click', 'Clicked an email'], ['sms_click', 'Clicked an SMS'], ['form', 'Submitted a form'], ['sub', 'Subscribed'], ['unsub', 'Unsubscribed']];
  E.CATS = ['Frames', 'Sunglasses', 'Contact lenses', 'Solutions', 'Accessories'];
  E.PROP_FIELDS = [
    { k: 'cc', label: 'Country', type: 'str', opts: ['SI', 'HR'], get: p => p.cc },
    { k: 'city', label: 'City', type: 'str', get: p => p.city },
    { k: 'gender', label: 'Gender', type: 'str', opts: ['f', 'm', 'x'], get: p => p.pr.gender },
    { k: 'lang', label: 'Language', type: 'str', opts: ['sl', 'hr', 'en'], get: p => p.pr.lang },
    { k: 'source', label: 'Source', type: 'str', opts: ['store', 'form', 'checkout'], get: p => p.pr.source },
    { k: 'fav', label: 'Favourite category', type: 'str', opts: E.CATS, get: p => p.pr.fav },
    { k: 'lens', label: 'Wears contact lenses', type: 'bool', get: p => !!p.pr.lens },
    { k: 'birthday', label: 'Birthday', type: 'date', get: p => p.pr.birthday },
    { k: 'exam', label: 'Last eye exam', type: 'date', get: p => p.pr.exam },
    { k: 'created', label: 'Profile created', type: 'date', get: p => p.cr },
    { k: 'sunset', label: 'Sunset flag', type: 'bool', get: p => !!p.pr.sunset }
  ];
  E.PRED_FIELDS = [
    { k: 'orders', label: 'Orders (count)' }, { k: 'revenue', label: 'Total revenue (€)' }, { k: 'aov', label: 'Average order value (€)' },
    { k: 'last_order_days', label: 'Days since last order' }, { k: 'churn', label: 'Churn risk (0–100)' }, { k: 'clv', label: 'Predicted CLV (€)' },
    { k: 'next_order_days', label: 'Days until expected next order' }, { k: 'interval', label: 'Average days between orders' }
  ];
  const PF = {}; E.PROP_FIELDS.forEach(f => PF[f.k] = f);

  /* ---------- index ---------- */
  E.init = db => {
    E.db = db; E.P = new Map(); db.profiles.forEach(p => E.P.set(p.id, p));
    if (!E.rand) E.rand = U.rng((Date.now() ^ 0x5bd1e995) >>> 0);
    db.runs = db.runs || [];
    E.rebuild();
  };
  E.base = r => { const a = String(r).split(':'); return a[0] === 'f' ? a.slice(0, 3).join(':') : a.slice(0, 2).join(':'); };
  E.variant = r => { const a = String(r).split(':'); return a[0] === 'c' ? a[2] || '' : ''; };
  E.index = e => {
    let a = E.ev.get(e.p); if (!a) E.ev.set(e.p, a = []);
    let i = a.length; while (i > 0 && a[i - 1].ts > e.ts) i--;
    a.splice(i, 0, e);
    if (e.r) { const b = E.base(e.r); (E.R[b] || (E.R[b] = [])).push(e); }
  };
  E.rebuild = () => {
    const db = E.db, now = E.now();
    E.ev = new Map(); E.R = Object.create(null); E.future = []; E.LM = {};
    db.lists.forEach(l => E.LM[l.id] = new Set());
    db.profiles.forEach(p => (p.l || []).forEach(id => { if (E.LM[id]) E.LM[id].add(p.id); }));
    db.events.forEach(e => {
      if (e.ts > now) E.future.push(e);
      else { let a = E.ev.get(e.p); if (!a) E.ev.set(e.p, a = []); a.push(e); if (e.r) { const b = E.base(e.r); (E.R[b] || (E.R[b] = [])).push(e); } }
    });
    E.ev.forEach(a => a.sort((x, y) => x.ts - y.ts));
    E.future.sort((a, b) => a.ts - b.ts);
    E.bump();
  };
  E.bump = () => { E.ver++; E.dirty = false; E.cache = { seg: {}, pred: new Map(), attr: {}, daily: {} }; };
  E.chk = () => { if (E.dirty) E.bump(); };
  E.events = p => E.ev.get(p.id || p) || [];

  /* ---------- events ---------- */
  E.addEvent = (e, opt) => {
    opt = opt || {};
    E.db.events.push(e);
    if (e.ts > E.now()) { E.future.push(e); E.futureDirty = true; return e; }
    E.apply(e, opt); return e;
  };
  E.apply = (e, opt) => {
    opt = opt || {};
    E.index(e); E.dirty = true;
    const p = E.P.get(e.p);
    if (p) {
      switch (e.t) {
        case 'unsub': if (e.x === 'sms') { p.cs = false; p.ssup = true; } else { p.ce = false; p.sup = p.sup || 'unsub'; } break;
        case 'bounce': if (e.x === 'sms') p.cbad = true; else p.sup = 'bounce'; break;
        case 'spam': p.sup = 'spam'; p.ce = false; break;
        case 'sub': if (e.x) { const l = E.listById(e.x); if (l) { E.joinList(p, l.id); if (l.kind === 'sms') { p.cs = true; p.ssup = false; } else { p.ce = true; if (p.sup === 'unsub') p.sup = ''; } } } break;
        case 'prop': if (e.x && e.x.k) p.pr[e.x.k] = e.x.v; break;
      }
    }
    if (!opt.noflow && !E.noflow && p) E.onEvent(e, p);
  };
  E.releaseDue = () => {
    if (E.futureDirty) { E.future.sort((a, b) => a.ts - b.ts); E.futureDirty = false; }
    const now = E.now(); let n = 0;
    while (E.future.length && E.future[0].ts <= now) { E.apply(E.future.shift()); n++; }
    return n;
  };
  E.listById = id => E.db.lists.find(l => l.id === id);
  E.segById = id => E.db.segments.find(s => s.id === id);
  E.flowById = id => E.db.flows.find(f => f.id === id);
  E.campById = id => E.db.campaigns.find(c => c.id === id);
  E.joinList = (p, id) => { if (p.l.indexOf(id) < 0) p.l.push(id); if (E.LM[id]) E.LM[id].add(p.id); E.dirty = true; };
  E.leaveList = (p, id) => { p.l = p.l.filter(x => x !== id); if (E.LM[id]) E.LM[id].delete(p.id); E.dirty = true; };
  E.search = (q, lim) => {
    q = String(q || '').trim().toLowerCase(); if (!q) return [];
    const out = [];
    for (const p of E.db.profiles) {
      if (p.em.indexOf(q) >= 0 || (p.fn + ' ' + p.ln).toLowerCase().indexOf(q) >= 0 || p.ph.replace(/\s/g, '').indexOf(q.replace(/\s/g, '')) >= 0 || String(p.id) === q) { out.push(p); if (out.length >= (lim || 8)) break; }
    }
    return out;
  };
  E.refName = r => {
    if (!r) return '';
    const a = String(r).split(':');
    if (a[0] === 'c') { const c = E.campById(a[1]); return c ? c.name + (a[2] ? ' (' + a[2] + ')' : '') : 'Campaign'; }
    if (a[0] === 'f') { const f = E.flowById(a[1]); const s = f && f.steps.find(x => x.id === a[2]); return f ? f.name + (s ? ' › ' + (s.name || s.type) : '') : 'Flow'; }
    if (a[0] === 'form') { const fm = E.db.forms.find(x => x.id === a[1]); return fm ? fm.name : 'Form'; }
    return r;
  };

  /* ---------- conditions / segments ---------- */
  const cmp = (op, v, x) => { switch (op) { case 'gt': return v != null && v > x; case 'lt': return v != null && v < x; case 'gte': return v != null && v >= x; case 'lte': return v != null && v <= x; case 'ne': return v == null || v !== x; default: return v === x; } };
  E.cond = (p, c, depth) => {
    const now = E.now();
    switch (c.t) {
      case 'prop': {
        const f = PF[c.f]; if (!f) return false; const v = f.get(p);
        if (f.type === 'bool') { const res = (!!v) === (String(c.v) !== 'false'); return c.op === 'ne' ? !res : res; }
        if (f.type === 'date') {
          const n = +c.v || 0;
          switch (c.op) {
            case 'set': return !!v; case 'unset': return !v;
            case 'within': return !!v && v <= now && now - v <= n * DAY;
            case 'older': return !!v && now - v > n * DAY;
            case 'anniv': { if (!v) return false; const b = new Date(v); for (let i = 0; i <= n; i++) { const d = new Date(now + i * DAY); if (d.getMonth() === b.getMonth() && d.getDate() === b.getDate()) return true; } return false; }
          }
          return false;
        }
        const s = String(v == null ? '' : v).toLowerCase(), q = String(c.v == null ? '' : c.v).toLowerCase();
        switch (c.op) { case 'eq': return s === q; case 'ne': return s !== q; case 'contains': return s.indexOf(q) >= 0; case 'set': return s !== ''; case 'unset': return s === ''; }
        return false;
      }
      case 'did': {
        const from = c.days ? now - c.days * DAY : 0; let n = 0;
        for (const e of E.events(p)) if (e.t === c.ev && e.ts >= from) n++;
        return c.op === 'not' ? n === 0 : n >= (c.min || 1);
      }
      case 'pred': { const v = E.pred(p)[c.f]; return v != null && cmp(c.op || 'gt', v, +c.v); }
      case 'list': { const i = E.LM[c.v] && E.LM[c.v].has(p.id); return c.op === 'out' ? !i : !!i; }
      case 'seg': { if ((depth || 0) > 3) return false; const i = E.segSet(c.v, (depth || 0) + 1).has(p.id); return c.op === 'out' ? !i : i; }
      case 'consent': { const y = c.f === 'sms' ? (p.cs && !p.ssup && !!p.ph) : (p.ce && !p.sup && !!p.em); return c.op === 'no' ? !y : y; }
    }
    return false;
  };
  E.match = (p, def, depth) => {
    const rows = (def && def.rows) || []; if (!rows.length) return false;
    return def.mode === 'any' ? rows.some(c => E.cond(p, c, depth)) : rows.every(c => E.cond(p, c, depth));
  };
  E.segSet = (id, depth) => {
    E.chk(); const hit = E.cache.seg[id]; if (hit) return hit;
    const seg = E.segById(id), s = new Set(); E.cache.seg[id] = s;
    if (seg) for (const p of E.db.profiles) if (E.match(p, seg.cond, depth)) s.add(p.id);
    return s;
  };
  E.members = seg => { const s = E.segSet(seg.id); return E.db.profiles.filter(p => s.has(p.id)); };
  E.matchProfiles = def => E.db.profiles.filter(p => E.match(p, def));
  E.describeCond = c => {
    const L = id => (E.listById(id) || {}).name || id, S = id => (E.segById(id) || {}).name || id;
    switch (c.t) {
      case 'prop': { const f = PF[c.f] || { label: c.f }; return f.label + ' ' + ({ eq: 'is', ne: 'is not', contains: 'contains', set: 'is set', unset: 'is not set', within: 'within last', older: 'older than', anniv: 'anniversary within' }[c.op] || c.op) + (['set', 'unset'].indexOf(c.op) >= 0 ? '' : ' ' + c.v + (f.type === 'date' ? ' days' : '')); }
      case 'did': return (c.op === 'not' ? 'Has not ' : 'Has ') + (E.EVENT_TYPES.find(x => x[0] === c.ev) || [c.ev, c.ev])[1].toLowerCase() + (c.days ? ' in last ' + c.days + ' days' : '');
      case 'pred': return ((E.PRED_FIELDS.find(x => x.k === c.f) || { label: c.f }).label) + ' ' + ({ gt: '>', lt: '<', gte: '≥', lte: '≤', eq: '=' }[c.op] || c.op) + ' ' + c.v;
      case 'list': return (c.op === 'out' ? 'Not in list ' : 'In list ') + L(c.v);
      case 'seg': return (c.op === 'out' ? 'Not in segment ' : 'In segment ') + S(c.v);
      case 'consent': return (c.f === 'sms' ? 'SMS' : 'Email') + ' consent: ' + (c.op === 'no' ? 'no' : 'yes');
    }
    return '';
  };

  /* ---------- predictions ---------- */
  E.pred = p => {
    E.chk(); let r = E.cache.pred.get(p.id); if (r) return r;
    const now = E.now(); let n = 0, rev = 0, first = 0, last = 0; const ts = [];
    for (const e of E.events(p)) if (e.t === 'order') { n++; rev += e.v || 0; ts.push(e.ts); last = e.ts; if (!first) first = e.ts; }
    const interval = n >= 2 ? (last - first) / (n - 1) / DAY : null, lod = n ? (now - last) / DAY : null;
    const aov = n ? rev / n : 0;
    let churn;
    if (!n) churn = U.clamp(0.55 + (1 - p.eng) * 0.4, 0, 1);
    else { const ratio = lod / (interval || 160); churn = U.clamp(U.clamp((ratio - 0.6) / 1.6, 0, 1) * 0.85 + (1 - p.eng) * 0.15, 0, 1); }
    const perYear = interval ? 365 / interval : n ? Math.min(3, n / Math.max(1, (now - first) / 365 / DAY)) : 0.8;
    const clv = rev + (aov || 90) * perYear * 2 * (1 - churn);
    const nextIn = interval ? Math.max(0, Math.round(interval - lod)) : null;
    r = { orders: n, revenue: Math.round(rev * 100) / 100, aov: Math.round(aov * 100) / 100, last_order_days: lod == null ? null : Math.round(lod), interval: interval == null ? null : Math.round(interval), next_order_days: nextIn, next: interval ? last + interval * DAY : null, churn: Math.round(churn * 100), clv: Math.round(clv), first, last };
    E.cache.pred.set(p.id, r); return r;
  };

  /* ---------- attribution (last touch) ---------- */
  E.attrWin = (cw, ow, sw) => {
    E.chk(); const key = cw + '/' + ow + '/' + sw; if (E.cache.attr[key]) return E.cache.attr[key];
    const by = Object.create(null), rows = []; let rev = 0, orders = 0, tot = 0, totO = 0;
    E.ev.forEach((arr, pid) => {
      let lc = null, ls = null, lo = null;
      for (const e of arr) {
        if (e.t === 'click' && e.r) lc = e; else if (e.t === 'sms_click' && e.r) ls = e; else if (e.t === 'open' && e.r) lo = e;
        else if (e.t === 'order') {
          tot += e.v || 0; totO++;
          let hit = null;
          if (lc && e.ts - lc.ts <= cw * DAY) hit = lc;
          if (ls && e.ts - ls.ts <= sw * DAY && (!hit || ls.ts > hit.ts)) hit = ls;
          if (!hit && lo && e.ts - lo.ts <= ow * DAY) hit = lo;
          if (hit) {
            const b = E.base(hit.r), v = e.v || 0;
            const o = by[b] || (by[b] = { rev: 0, orders: 0 }); o.rev += v; o.orders++;
            const o2 = by[hit.r] || (by[hit.r] = { rev: 0, orders: 0 }); o2.rev += v; o2.orders++;
            rev += v; orders++; rows.push({ p: pid, ts: e.ts, v, ref: hit.r, kind: hit.t });
          }
        }
      }
    });
    return E.cache.attr[key] = { by, rows, rev, orders, total: tot, totalOrders: totO };
  };
  E.attr = () => { const s = E.db.settings.attr || {}; return E.attrWin(s.click || 5, s.open || 5, s.sms || 1); };

  /* ---------- stats ---------- */
  E.stat = (base, o) => {
    o = o || {}; const evs = E.R[base] || [], so = new Set(), sc = new Set();
    const s = { sent: 0, opens: 0, clicks: 0, unsub: 0, bounce: 0, spam: 0, orders: 0, rev: 0, flowSent: 0 };
    for (const e of evs) {
      if (o.variant != null && E.variant(e.r) !== o.variant) continue;
      switch (e.t) { case 'open': so.add(e.p); break; case 'click': case 'sms_click': sc.add(e.p); break; case 'unsub': s.unsub++; break; case 'bounce': s.bounce++; break; case 'spam': s.spam++; break; case 'flow': s.flowSent++; break; }
    }
    s.opens = so.size; s.clicks = sc.size;
    s.sent = o.sent != null ? o.sent : s.flowSent; s.delivered = Math.max(0, s.sent - s.bounce);
    const a = E.attr().by[o.variant != null && o.variant !== '' ? base + ':' + o.variant : base] || { rev: 0, orders: 0 };
    s.rev = a.rev; s.orders = a.orders;
    const d = s.delivered || 1;
    s.openRate = s.delivered ? s.opens / d : 0; s.clickRate = s.delivered ? s.clicks / d : 0; s.ctor = s.opens ? s.clicks / s.opens : 0;
    s.unsubRate = s.delivered ? s.unsub / d : 0; s.bounceRate = s.sent ? s.bounce / s.sent : 0; s.rpr = s.delivered ? s.rev / d : 0;
    return s;
  };
  E.campStat = (c, variant) => {
    if (!c.stats) return E.stat('c:' + c.id, { sent: 0 });
    const sent = variant ? ((c.stats.variants || {})[variant] || 0) : c.stats.sent;
    return E.stat('c:' + c.id, { sent, variant });
  };
  E.flowStat = f => {
    const out = { entered: f.stats.entered, completed: f.stats.completed, active: E.db.runs.filter(r => r.fid === f.id).length, sent: 0, opens: 0, clicks: 0, rev: 0, orders: 0, unsub: 0 };
    f.steps.forEach(s => { if (s.type === 'email' || s.type === 'sms') { const t = E.stat('f:' + f.id + ':' + s.id); out.sent += t.sent; out.opens += t.opens; out.clicks += t.clicks; out.rev += t.rev; out.orders += t.orders; out.unsub += t.unsub; } });
    out.openRate = out.sent ? out.opens / out.sent : 0; out.clickRate = out.sent ? out.clicks / out.sent : 0;
    return out;
  };
  E.daily = (from, to) => {
    E.chk(); const key = from + '/' + to; if (E.cache.daily[key]) return E.cache.daily[key];
    const n = Math.max(1, Math.ceil((to - from) / DAY)), d = [], now = E.now();
    for (let i = 0; i < n; i++) d.push({ ts: from + i * DAY, orders: 0, rev: 0, attr: 0, opens: 0, clicks: 0, subs: 0, unsubs: 0, bounces: 0, flowSent: 0, sent: 0 });
    const bin = ts => { const i = Math.floor((ts - from) / DAY); return i >= 0 && i < n && ts <= now ? d[i] : null; };
    for (const e of E.db.events) {
      const b = bin(e.ts); if (!b) continue;
      switch (e.t) { case 'order': b.orders++; b.rev += e.v || 0; break; case 'open': b.opens++; break; case 'click': case 'sms_click': b.clicks++; break; case 'sub': b.subs++; break; case 'unsub': b.unsubs++; break; case 'bounce': b.bounces++; break; case 'flow': b.flowSent++; b.sent++; break; }
    }
    E.attr().rows.forEach(r => { const b = bin(r.ts); if (b) b.attr += r.v; });
    E.db.campaigns.forEach(c => { if (c.status === 'sent' && c.sentAt) { const b = bin(c.sentAt); if (b) b.sent += c.stats.sent; } });
    return E.cache.daily[key] = d;
  };
  E.kpis = (from, to) => {
    const d = E.daily(from, to), k = { orders: 0, rev: 0, attr: 0, opens: 0, clicks: 0, subs: 0, unsubs: 0, bounces: 0, sent: 0 };
    d.forEach(x => { for (const f in k) k[f] += x[f]; });
    const dl = Math.max(1, k.sent - k.bounces);
    k.openRate = k.sent ? Math.min(1, k.opens / dl) : 0; k.clickRate = k.sent ? Math.min(1, k.clicks / dl) : 0; k.unsubRate = k.sent ? k.unsubs / dl : 0;
    k.aov = k.orders ? k.rev / k.orders : 0; k.attrShare = k.rev ? k.attr / k.rev : 0;
    return k;
  };
  E.counts = () => {
    let em = 0, sm = 0, sup = 0;
    for (const p of E.db.profiles) { if (p.ce && !p.sup && p.em) em++; if (p.cs && !p.ssup && p.ph) sm++; if (p.sup) sup++; }
    return { profiles: E.db.profiles.length, email: em, sms: sm, suppressed: sup };
  };
  E.summary = () => {
    const now = E.now(), k = E.kpis(now - 30 * DAY, now), c = E.counts();
    return { app: 'mail', updatedAt: now, profiles: c.profiles, emailSubscribers: c.email, smsSubscribers: c.sms, suppressed: c.suppressed,
      campaignsSent: E.db.campaigns.filter(x => x.status === 'sent').length, flowsLive: E.db.flows.filter(f => f.status === 'live').length,
      last30: { sent: k.sent, openRate: k.openRate, clickRate: k.clickRate, unsubs: k.unsubs, orders: k.orders, revenue: Math.round(k.rev), attributedRevenue: Math.round(k.attr) } };
  };

  /* ---------- send simulation ---------- */
  E.subjScore = s => {
    s = String(s || ''); let sc = 1; const n = s.length;
    if (n >= 28 && n <= 55) sc *= 1.12; else if (n > 70) sc *= 0.88;
    if (/\{\{/.test(s)) sc *= 1.1; if (/[!?]/.test(s)) sc *= 1.03; if (/\d+%/.test(s)) sc *= 1.06;
    if (n > 8 && s === s.toUpperCase()) sc *= 0.85;
    return sc;
  };
  E.pickItems = r => {
    const pr = E.db.products, n = r.w([1, 2, 3], [62, 28, 10]), items = []; let v = 0;
    for (let i = 0; i < n; i++) { const x = r.w(pr, pr.map(q => q.w || 1)); items.push(x.sku); v += x.price; }
    return { s: items[0], x: items.join(','), v: Math.round(v * 100) / 100 };
  };
  E.simEmail = (p, c, r) => {
    const out = [], ref = c.ref, eng = p.eng, ts = c.ts;
    if (r() < 0.006 + (p.badAddr ? 0.25 : 0)) return [{ p: p.id, t: 'bounce', ts: ts + r.int(1, 12) * MIN, r: ref }];
    const po = U.clamp((0.1 + 0.62 * eng) * (c.sub || 1), 0.02, 0.92);
    if (!r.chance(po)) { if (r.chance(0.0004 + (1 - eng) * 0.0012)) out.push({ p: p.id, t: 'unsub', ts: ts + r.int(5, 400) * MIN, r: ref }); return out; }
    const ot = ts + Math.round((r.exp(c.flow ? 70 : 140) + 0.5) * MIN);
    out.push({ p: p.id, t: 'open', ts: ot, r: ref });
    if (c.links && c.links.length && r.chance(U.clamp((0.07 + 0.34 * eng) * (c.promo || 1), 0, 0.8))) {
      const l = r.pick(c.links), ct = ot + Math.round((r.exp(1.5) + 0.2) * MIN);
      out.push({ p: p.id, t: 'click', ts: ct, r: ref, x: l.id });
      if (r.chance(U.clamp((0.05 + 0.17 * eng) * (c.promo || 1), 0, 0.5))) { const it = E.pickItems(r); out.push({ p: p.id, t: 'order', ts: ct + r.int(4, 900) * MIN, r: ref, s: it.s, v: it.v, x: it.x }); }
    }
    if (r.chance(0.0012 + (1 - eng) * 0.0045)) out.push({ p: p.id, t: 'unsub', ts: ot + r.int(1, 30) * MIN, r: ref });
    else if (r.chance(0.00025 * (1 - eng))) out.push({ p: p.id, t: 'spam', ts: ot + r.int(1, 30) * MIN, r: ref });
    return out;
  };
  E.simSms = (p, c, r) => {
    const out = [], ref = c.ref, eng = p.eng, ts = c.ts;
    if (r() < 0.02) return [{ p: p.id, t: 'bounce', ts: ts + r.int(1, 5) * MIN, r: ref, x: 'sms' }];
    if (r.chance(U.clamp((0.04 + 0.2 * eng) * (c.promo || 1), 0, 0.6))) {
      const ct = ts + Math.round((r.exp(25) + 1) * MIN);
      out.push({ p: p.id, t: 'sms_click', ts: ct, r: ref, x: 'sms' });
      if (r.chance(0.1 + 0.16 * eng)) { const it = E.pickItems(r); out.push({ p: p.id, t: 'order', ts: ct + r.int(3, 600) * MIN, r: ref, s: it.s, v: it.v, x: it.x }); }
    }
    if (r.chance(0.003 + (1 - eng) * 0.004)) out.push({ p: p.id, t: 'unsub', ts: ts + r.int(1, 60) * MIN, r: ref, x: 'sms' });
    return out;
  };
  E.targetSet = t => t.t === 'seg' ? E.segSet(t.id) : (E.LM[t.id] || new Set());
  E.audienceInfo = c => {
    E.chk(); const inc = new Set(), exc = new Set(), sms = c.channel === 'sms';
    (c.inc || []).forEach(t => E.targetSet(t).forEach(id => inc.add(id)));
    (c.exc || []).forEach(t => E.targetSet(t).forEach(id => exc.add(id)));
    const info = { selected: inc.size, excluded: 0, noConsent: 0, suppressed: 0, noAddress: 0, list: [] };
    inc.forEach(id => {
      const p = E.P.get(id); if (!p) return;
      if (exc.has(id)) { info.excluded++; return; }
      if (sms) { if (!p.ph) info.noAddress++; else if (!p.cs || p.ssup) info.noConsent++; else info.list.push(p); }
      else { if (!p.em) info.noAddress++; else if (p.sup) info.suppressed++; else if (!p.ce) info.noConsent++; else info.list.push(p); }
    });
    info.list.sort((a, b) => a.id - b.id); info.final = info.list.length;
    return info;
  };
  E.audience = c => E.audienceInfo(c).list;
  E.VLET = ['A', 'B', 'C'];
  E.runSend = (c, opt) => {
    opt = opt || {};
    const r = opt.r || E.rand, sendAt = opt.sendAt || E.now(), sms = c.channel === 'sms';
    const aud = r.shuffle(E.audience(c).slice()), events = [];
    const links = sms ? [{ id: 'sms' }] : M.links(c.design || { blocks: [] }).map(l => ({ id: l.id }));
    const promo = c.promo || 1, variants = {};
    const sim = (list, ref, subj, at) => {
      const ctx = { ref, ts: at, sub: E.subjScore(subj), links, promo };
      list.forEach(p => { const ev = sms ? E.simSms(p, ctx, r) : E.simEmail(p, ctx, r); for (let i = 0; i < ev.length; i++) events.push(ev[i]); });
    };
    let ab = null;
    if (!sms && c.ab && c.ab.on && c.ab.variants.length >= 2 && aud.length >= 40) {
      const k = Math.min(3, c.ab.variants.length), nTest = Math.max(k * 10, Math.round(aud.length * (c.ab.test || 20) / 100)), per = Math.floor(nTest / k);
      const start = events.length, marks = [];
      for (let i = 0; i < k; i++) { const v = E.VLET[i], mark = events.length; sim(aud.slice(i * per, (i + 1) * per), 'c:' + c.id + ':' + v, c.ab.variants[i].subject || c.subject, sendAt); variants[v] = per; marks.push([mark, events.length]); }
      const rates = marks.map(([a, b]) => { let n = 0; const seen = new Set(); for (let j = a; j < b; j++) { const e = events[j]; if (e.t === (c.ab.metric === 'click' ? 'click' : 'open') && !seen.has(e.p)) { seen.add(e.p); n++; } } return n / per; });
      let w = 0; rates.forEach((x, i) => { if (x > rates[w]) w = i; });
      const win = E.VLET[w], restAt = sendAt + (c.ab.wait || 4) * HOUR, rest = aud.slice(k * per);
      sim(rest, 'c:' + c.id + ':' + win, c.ab.variants[w].subject || c.subject, restAt); variants[win] += rest.length;
      ab = { winner: win, metric: c.ab.metric || 'open', rates, testN: k * per, restAt, k };
    } else sim(aud, 'c:' + c.id, c.subject, sendAt);
    return { events, sent: aud.length, ab, variants, sendAt };
  };
  E.commitSend = (c, res) => {
    res.events.forEach(e => E.addEvent(e));
    c.stats = { sent: res.sent, variants: res.variants, ab: res.ab, at: res.sendAt };
    c.status = 'sent'; c.sentAt = res.sendAt; c.progress = 1;
    E.dirty = true;
  };

  /* ---------- flow runner ---------- */
  E.step = (f, id) => f.steps.find(s => s.id === id);
  E.onEvent = (e, p) => {
    const fl = E.db.flows;
    for (let i = 0; i < fl.length; i++) {
      const f = fl[i], t = f.trigger; if (f.status !== 'live' || !t) continue;
      if (t.type === 'event' && t.ev === e.t) E.enter(f, p, e.ts);
      else if (t.type === 'list' && e.t === 'sub' && e.x === t.list) E.enter(f, p, e.ts);
    }
  };
  E.enter = (f, p, ts, opt) => {
    opt = opt || {};
    if (!opt.force && f.status !== 'live') return null;
    const last = f.last[p.id];
    if (!opt.force && last && ts - last < (f.cool == null ? 30 : f.cool) * DAY) return null;
    if (f.filter && f.filter.rows && f.filter.rows.length && !E.match(p, f.filter)) return null;
    if (!f.start) return null;
    const meta = E.db.meta; meta.seq = (meta.seq || 0) + 1;
    f.last[p.id] = ts; f.stats.entered++;
    const run = { id: meta.seq, fid: f.id, pid: p.id, sid: f.start, at: ts, ent: ts };
    E.db.runs.push(run);
    E.advance(run, f, p);
    if (run.done) { const i = E.db.runs.lastIndexOf(run); if (i >= 0) E.db.runs.splice(i, 1); }
    return run;
  };
  E.flowSend = (f, s, p, ts, ch) => {
    const sms = ch === 'sms', ref = 'f:' + f.id + ':' + s.id;
    if (sms ? (!p.cs || p.ssup || !p.ph) : (!p.ce || p.sup || !p.em)) { f.stats.skipped = (f.stats.skipped || 0) + 1; return; }
    E.addEvent({ p: p.id, t: 'flow', ts, r: ref, x: sms ? 'sms' : 'email' }, { noflow: true });
    const ctx = { ref, ts, flow: true, sub: E.subjScore(s.subject), promo: 1, links: sms ? [{ id: 'sms' }] : M.links(s.design || { blocks: [] }).map(l => ({ id: l.id })) };
    const ev = sms ? E.simSms(p, ctx, E.rand) : E.simEmail(p, ctx, E.rand);
    ev.forEach(e => E.addEvent(e));
  };
  E.advance = (run, f, p) => {
    f = f || E.flowById(run.fid); p = p || E.P.get(run.pid);
    const now = E.now(); let guard = 0;
    while (run.sid && guard++ < 60) {
      if (run.at > now) return false;
      const s = E.step(f, run.sid); if (!s) { run.sid = null; break; }
      switch (s.type) {
        case 'delay': run.at += (s.d || 0) * DAY + (s.h || 0) * HOUR + (s.m || 0) * MIN; run.sid = s.next; break;
        case 'email': E.flowSend(f, s, p, run.at, 'email'); run.sid = s.next; break;
        case 'sms': E.flowSend(f, s, p, run.at, 'sms'); run.sid = s.next; break;
        case 'cond': run.sid = E.match(p, s.cond) ? s.yes : s.no; break;
        case 'wait': {
          if (!run.w) { run.w = { since: run.at }; run.at += (s.days || 1) * DAY; if (run.at > now) return false; }
          const since = run.w.since, until = run.at;
          const hit = E.events(p).some(e => e.t === s.ev && e.ts > since && e.ts <= until);
          run.w = null; run.sid = hit ? s.yes : s.no; break;
        }
        case 'prop': p.pr[s.key] = s.val; run.sid = s.next; break;
        default: run.sid = s.next; /* webhook: skipped */
      }
    }
    if (!run.sid) { run.done = true; f.stats.completed++; }
    return true;
  };
  E.tick = () => {
    const now = E.now(); let n = 0;
    E.db.runs.slice().forEach(run => {
      if (run.at > now) return;
      const f = E.flowById(run.fid), p = E.P.get(run.pid);
      if (!f || !p) { run.done = true; return; }
      if (f.status !== 'live') return;
      E.advance(run, f, p); n++;
    });
    if (n) E.db.runs = E.db.runs.filter(r => !r.done);
    return n;
  };
  E.dateHits = (f, from, to) => {
    const t = f.trigger, off = (t.offset || 0) * DAY, hits = [];
    const y1 = new Date(from - off).getFullYear(), y2 = new Date(to - off).getFullYear();
    for (const p of E.db.profiles) {
      if (t.prop === 'birthday') {
        const b = p.pr.birthday; if (!b) continue; const bd = new Date(b);
        for (let y = y1; y <= y2; y++) { const ts = new Date(y, bd.getMonth(), bd.getDate(), 9, 0).getTime() + off; if (ts > from && ts <= to && y > bd.getFullYear()) hits.push([p, ts]); }
      } else if (t.prop === 'exam') { const b = p.pr.exam; if (!b) continue; const ts = b + off; if (ts > from && ts <= to) hits.push([p, ts]); }
      else if (t.prop === 'refill') {
        if (!p.pr.lens) continue; let last = 0; const evs = E.events(p);
        for (let i = evs.length - 1; i >= 0; i--) if (evs[i].t === 'order' && (evs[i].x || '').indexOf('CL-') >= 0) { last = evs[i].ts; break; }
        if (!last) continue; const ts = last + (p.pr.refill || 60) * DAY + off; if (ts > from && ts <= to) hits.push([p, ts]);
      }
    }
    return hits.sort((a, b) => a[1] - b[1]);
  };
  E.runDateTriggers = (fromOverride) => {
    const now = E.now(); let n = 0;
    E.db.flows.forEach(f => {
      if (f.status !== 'live' || !f.trigger || f.trigger.type !== 'date') return;
      const from = fromOverride != null ? fromOverride : (f.lastDate || now - DAY);
      if (fromOverride == null && now - from < HOUR) return;
      E.dateHits(f, from, now).forEach(h => { if (E.enter(f, h[0], h[1])) n++; });
      f.lastDate = now;
    });
    return n;
  };
  E.tickSegments = (initial) => {
    const now = E.now(); let n = 0;
    E.db.flows.forEach(f => {
      if (f.status !== 'live' || !f.trigger || f.trigger.type !== 'segment') return;
      if (!initial && f.lastSeg && now - f.lastSeg < HOUR) return;
      f.lastSeg = now;
      const set = E.segSet(f.trigger.seg);
      set.forEach(id => { const p = E.P.get(id); if (p && E.enter(f, p, initial ? now - E.rand.int(0, 3 * 24) * HOUR : now)) n++; });
    });
    return n;
  };
  /* A profile fires an event by hand (simulator, forms) */
  E.fire = (p, type, o) => {
    o = o || {}; const e = { p: p.id, t: type, ts: o.ts || E.now() };
    ['r', 's', 'v', 'x'].forEach(k => { if (o[k] != null) e[k] = o[k]; });
    return E.addEvent(e);
  };
  E.newProfile = o => {
    const db = E.db, id = db.profiles.reduce((m, p) => Math.max(m, p.id), 0) + 1;
    const p = Object.assign({ id, em: '', ph: '', fn: '', ln: '', cc: 'SI', city: 'Ljubljana', cr: E.now(), eng: 0.5, ce: false, cs: false, sup: '', ssup: false, l: [], pr: { gender: 'x', lang: 'sl', source: 'form', fav: 'Frames', lens: false } }, o);
    db.profiles.push(p); E.P.set(p.id, p); E.dirty = true; return p;
  };
})();
