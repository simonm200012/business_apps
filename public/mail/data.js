/* AM.Data.generate(products): seeded demo database for a fictional optical retailer */
(function () {
  const AM = window.AM = window.AM || {}, U = AM.U, E = AM.E, M = AM.Email;
  const D = AM.Data = { SEED: 20261007, VERSION: 3, N: 3000 };
  const P = (sku, name, cat, price, w, art, c1, c2) => ({ sku, name, cat, price, w, art, c1, c2 });
  D.PRODUCTS = [
    P('FR-101', 'Aurora round frame', 'Frames', 129, 5, 'frames', '#2f5d62', '#d9b98a'), P('FR-102', 'Nordic square frame', 'Frames', 149, 5, 'frames', '#3b4a6b', '#9fb8ad'),
    P('FR-103', 'Piran acetate frame', 'Frames', 169, 4, 'frames', '#7a3b2e', '#e6a57e'), P('FR-104', 'Soča titanium frame', 'Frames', 219, 3, 'frames', '#4a5a66', '#cfd8dc'),
    P('FR-105', 'Bled cat-eye frame', 'Frames', 159, 3, 'frames', '#a8456b', '#f0b8c9'), P('FR-106', 'Triglav sport frame', 'Frames', 139, 2, 'frames', '#1f6f8b', '#99c2d0'),
    P('FR-107', 'Kids Pika frame', 'Frames', 89, 2, 'frames', '#e08a2d', '#f7d79a'), P('FR-108', 'Classic Ljubljana frame', 'Frames', 119, 4, 'frames', '#3d3d3d', '#b9b9b9'),
    P('SG-201', 'Riviera sunglasses', 'Sunglasses', 99, 4, 'sun', '#d98324', '#f5d76e'), P('SG-202', 'Adria polarised sunglasses', 'Sunglasses', 139, 4, 'sun', '#1f6f8b', '#e6a57e'),
    P('SG-203', 'Sava aviator', 'Sunglasses', 119, 3, 'sun', '#4a3b6b', '#b9a6d9'), P('SG-204', 'Kvarner wayfarer', 'Sunglasses', 109, 3, 'sun', '#7a3b2e', '#f0b8c9'),
    P('SG-205', 'Dolomiti ski goggles', 'Sunglasses', 159, 1, 'sun', '#2f5d62', '#cfd8dc'), P('SG-206', 'Kids sun Pika', 'Sunglasses', 49, 2, 'sun', '#e08a2d', '#f7d79a'),
    P('CL-301', 'Daily lenses 30-pack', 'Contact lenses', 24, 6, 'lens', '#1f6f8b', '#99c2d0'), P('CL-302', 'Monthly lenses 6-pack', 'Contact lenses', 39, 5, 'lens', '#2f5d62', '#9fb8ad'),
    P('CL-303', 'Toric monthly 6-pack', 'Contact lenses', 54, 2, 'lens', '#3b4a6b', '#b9a6d9'), P('CL-304', 'Daily lenses 90-pack', 'Contact lenses', 59, 3, 'lens', '#1f6f8b', '#cfd8dc'),
    P('SO-401', 'Multi-purpose solution 360 ml', 'Solutions', 9, 5, 'plain', '#4a8f8b', '#cfe8e6'), P('SO-402', 'Travel solution 60 ml', 'Solutions', 4, 3, 'plain', '#4a8f8b', '#e8f4f2'),
    P('SO-403', 'Eye drops comfort', 'Solutions', 12, 3, 'eye', '#2f5d62', '#99c2d0'),
    P('AC-501', 'Hard case with cloth', 'Accessories', 12, 3, 'plain', '#b9a98a', '#f3efe6'), P('AC-502', 'Cleaning spray', 'Accessories', 7, 4, 'plain', '#7aa6b8', '#e3eff3'), P('AC-503', 'Beaded glasses chain', 'Accessories', 15, 1, 'gift', '#a8456b', '#f0b8c9')
  ];
  D.mapCatalog = raw => {
    const arr = Array.isArray(raw) ? raw : (raw && (raw.products || raw.items || raw.catalog)) || [];
    const out = [], seen = new Set();
    arr.forEach(o => {
      if (!o || typeof o !== 'object') return;
      const sku = String(o.sku || o.SKU || o.code || '').trim(), name = String(o.name || o.title || '').trim(), price = +(o.price || o.retail || o.unitPrice || o.salePrice || 0);
      const cat = String(o.category || o.cat || o.type || 'Accessories');
      if (!sku || !name || !(price > 0) || seen.has(sku)) return; seen.add(sku);
      const h = U.hash(sku), hue = h % 360;
      out.push({ sku, name, cat: E.CATS.find(c => c.toLowerCase() === cat.toLowerCase()) || cat, price: Math.round(price * 100) / 100, w: 1 + (h % 4), art: /sun/i.test(cat) ? 'sun' : /lens/i.test(cat) ? 'lens' : /frame/i.test(cat) ? 'frames' : 'plain', c1: hsl(hue, 45, 36), c2: hsl((hue + 40) % 360, 50, 75) });
    });
    return out.slice(0, 60);
  };
  function hsl(h, s, l) { s /= 100; l /= 100; const a = s * Math.min(l, 1 - l), f = n => { const k = (n + h / 30) % 12, c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); return Math.round(255 * c).toString(16).padStart(2, '0'); }; return '#' + f(0) + f(8) + f(4); }
  D.mergeCatalog = (db, raw) => {
    const list = D.mapCatalog(raw); if (!list.length) return false; let ch = false;
    list.forEach(n => {
      const o = db.products.find(x => x.sku === n.sku);
      if (!o) { db.products.push(n); ch = true; } else if (o.price !== n.price || o.name !== n.name) { o.price = n.price; o.name = n.name; ch = true; }
    });
    return ch;
  };

  const SI = { f: 'Ana Maja Nina Eva Katja Petra Tina Mateja Urška Sara Nika Lara Tjaša Barbara Mojca Jasna Polona Špela Maša Tanja'.split(' '), m: 'Luka Jan Matej Nejc Žiga Andrej Marko Gregor Rok Blaž Tilen Miha Domen Jure Anže Primož Klemen Uroš Matic David'.split(' '), l: 'Novak Horvat Kovačič Krajnc Zupančič Potočnik Kovač Mlakar Vidmar Golob Turk Kralj Bizjak Zupan Hribar Kotnik Kavčič Rozman Kos Petek'.split(' '), c: ['Ljubljana', 'Maribor', 'Celje', 'Kranj', 'Koper', 'Novo mesto', 'Velenje', 'Nova Gorica', 'Ptuj', 'Murska Sobota'], cw: [30, 14, 8, 8, 7, 7, 5, 5, 4, 3] };
  const HR = { f: 'Ivana Marija Petra Ana Katarina Lucija Matea Mia Nikolina Sara Maja Iva Lana Dora Josipa'.split(' '), m: 'Ivan Marko Josip Luka Ante Filip Mateo Tomislav Dario Ivo Karlo Nikola Domagoj Hrvoje Mario'.split(' '), l: 'Horvat Kovačević Babić Marić Jurić Knežević Vuković Perić Blažević Tomić Matić Pavlović Božić Radić Šarić'.split(' '), c: ['Zagreb', 'Split', 'Rijeka', 'Osijek', 'Zadar', 'Pula', 'Varaždin', 'Karlovac', 'Slavonski Brod', 'Sisak'], cw: [34, 14, 10, 8, 7, 6, 5, 4, 4, 3] };
  const fold = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]/gi, '').toLowerCase();

  D.generate = catalog => {
    const r = U.rng(D.SEED), now = Math.floor(Date.now() / U.MIN) * U.MIN, DAY = U.DAY, HOUR = U.HOUR, MIN = U.MIN;
    const cat = D.mapCatalog(catalog);
    const products = (cat.length >= 8 ? cat : D.PRODUCTS).map(x => Object.assign({}, x));
    const db = {
      meta: { version: D.VERSION, seed: D.SEED, anchor: now, clockOffset: 0, seq: 0, created: now },
      settings: { brand: 'Lumina Optika', fromName: 'Lumina Optika', fromEmail: 'hello@lumina-optika.example', replyTo: 'support@lumina-optika.example', address: 'Slovenska cesta 12, 1000 Ljubljana', smsSender: 'LUMINA', attr: { click: 5, open: 5, sms: 1 } },
      products, profiles: [], events: [], lists: [], segments: [], campaigns: [], flows: [], templates: [], forms: [], runs: []
    };
    E.clock = now; E.rand = r; E.db = db; E.noflow = false;
    const ev = db.events, push = (p, t, ts, o) => { const e = { p, t, ts }; if (o) for (const k in o) e[k] = o[k]; ev.push(e); return e; };

    /* lists */
    db.lists = [
      { id: 'l_news_si', name: 'Newsletter (SI)', kind: 'email', desc: 'Slovenian newsletter subscribers', created: now - 540 * DAY },
      { id: 'l_news_hr', name: 'Newsletter (HR)', kind: 'email', desc: 'Croatian newsletter subscribers', created: now - 540 * DAY },
      { id: 'l_vip', name: 'VIP customers', kind: 'email', desc: 'Top spenders, invited to previews', created: now - 400 * DAY },
      { id: 'l_lens', name: 'Contact-lens wearers', kind: 'email', desc: 'Refill reminders and lens offers', created: now - 500 * DAY },
      { id: 'l_sms', name: 'SMS offers', kind: 'sms', desc: 'Consent-based text messages', created: now - 450 * DAY },
      { id: 'l_store', name: 'In-store sign-ups', kind: 'email', desc: 'Collected at the till or on a tablet', created: now - 540 * DAY },
      { id: 'l_test', name: 'Test list', kind: 'email', desc: 'Internal addresses for test sends', created: now - 540 * DAY }
    ];

    /* profiles */
    const emails = new Set(), spend = new Map();
    for (let i = 1; i <= D.N; i++) {
      const test = i <= 6, cc = test ? 'SI' : r.chance(0.58) ? 'SI' : 'HR', N = cc === 'SI' ? SI : HR;
      const g = r.w(['f', 'm', 'x'], [52, 45, 3]), fn = test ? 'Test' : r.pick(g === 'm' ? N.m : g === 'f' ? N.f : N.f.concat(N.m)), ln = test ? 'User ' + i : r.pick(N.l);
      let em = test ? 'test' + i + '@example.com' : fold(fn) + '.' + fold(ln) + (r.chance(0.45) ? r.int(1, 99) : '') + '@' + r.w(['example.si', 'example.hr', 'example.com'], cc === 'SI' ? [70, 5, 25] : [5, 70, 25]);
      if (emails.has(em)) em = em.replace('@', i + '@'); emails.add(em);
      const source = test ? 'form' : r.w(['store', 'form', 'checkout'], [38, 40, 22]), cr = now - Math.round(Math.pow(r(), 0.85) * 540 * DAY) - r.int(0, 20) * HOUR;
      const ph = (cc === 'SI' ? '+386 00 5' : '+385 00 5') + r.int(10, 99) + ' ' + r.int(100, 999);
      const eng = test ? 0.9 : U.clamp(r.norm(0.42, 0.22), 0.03, 0.97);
      const lens = r.chance(0.22), bad = !test && r.chance(0.012);
      const p = { id: i, em, ph: !test && r.chance(0.12) ? '' : ph, fn, ln, cc, city: r.w(N.c, N.cw), cr, eng: Math.round(eng * 100) / 100, ce: test || (source === 'checkout' ? r.chance(0.55) : r.chance(0.94)), cs: false, sup: bad ? 'bounce' : '', ssup: false, l: [],
        pr: { gender: g, lang: cc === 'SI' ? 'sl' : 'hr', source, fav: r.w(E.CATS, [42, 26, lens ? 28 : 10, 6, 8]), lens, refill: r.pick([30, 60, 90]), birthday: new Date(r.int(1950, 2004), r.int(0, 11), r.int(1, 28)).getTime(), exam: r.chance(0.7) ? now - r.int(30, 1000) * DAY : null } };
      if (bad) p.badAddr = true;
      p.cs = test || (!!p.ph && r.chance(0.36));
      db.profiles.push(p);
    }
    E.P = new Map(db.profiles.map(p => [p.id, p]));
    db.forms = [
      { id: 'fm_pop_si', name: 'Newsletter popup (SI)', type: 'popup', list: 'l_news_si', headline: 'Get 10% off your first order', body: 'Join the Lumina newsletter for new frames, eye-care tips and offers.', button: 'Subscribe', fields: ['email', 'first_name'], consent: 'I agree to receive marketing emails. I can unsubscribe at any time.', success: 'Thanks! Check your inbox for your code.', status: 'live', views: 0, created: now - 520 * DAY },
      { id: 'fm_foot_hr', name: 'Footer sign-up (HR)', type: 'embedded', list: 'l_news_hr', headline: 'Pretplatite se na novosti', body: 'Novi okviri i savjeti za oči, jednom mjesečno.', button: 'Pretplati me', fields: ['email', 'first_name'], consent: 'Pristajem na primanje marketinških e-poruka.', success: 'Hvala! Provjerite pretinac.', status: 'live', views: 0, created: now - 500 * DAY },
      { id: 'fm_lens', name: 'Lens refill reminders', type: 'embedded', list: 'l_lens', headline: 'Never run out of lenses', body: 'We will remind you a week before you need a refill.', button: 'Remind me', fields: ['email', 'first_name'], consent: 'I agree to receive refill reminders by email.', success: 'You are on the list.', status: 'live', views: 0, created: now - 480 * DAY },
      { id: 'fm_sms', name: 'SMS offers flyout', type: 'flyout', list: 'l_sms', headline: 'Text offers, once or twice a month', body: 'Exclusive store events and flash sales by SMS.', button: 'Join', fields: ['phone'], consent: 'I agree to receive marketing text messages. Reply STOP to opt out.', success: 'Welcome! You will hear from us soon.', status: 'draft', views: 0, created: now - 300 * DAY }
    ];
    /* subscriptions, forms, VIP */
    db.profiles.forEach(p => {
      const t0 = p.cr + r.int(1, 30) * MIN;
      const join = id => { p.l.push(id); push(p.id, 'sub', t0 + r.int(0, 9) * MIN, { x: id }); };
      if (p.id <= 6) { join('l_test'); join('l_news_si'); join('l_sms'); return; }
      if (p.pr.source === 'form') push(p.id, 'form', t0 - MIN, { r: 'form:' + (p.cc === 'SI' ? 'fm_pop_si' : 'fm_foot_hr'), x: p.cc === 'SI' ? 'fm_pop_si' : 'fm_foot_hr' });
      if (p.ce) { join(p.cc === 'SI' ? 'l_news_si' : 'l_news_hr'); if (p.pr.source === 'store') join('l_store'); if (p.pr.lens && r.chance(0.7)) { join('l_lens'); if (p.pr.source === 'form' && r.chance(0.4)) push(p.id, 'form', t0, { r: 'form:fm_lens', x: 'fm_lens' }); } }
      if (p.cs) join('l_sms');
    });

    /* shopping behaviour */
    const byCat = c => products.filter(x => x.cat === c), lensP = byCat('Contact lenses'), solP = byCat('Solutions');
    db.profiles.forEach(p => {
      let n = r.w([0, 1, 2, 3, 4, 5, 6], [24, 28, 18, 11, 8, 6, 5]); if (p.pr.lens) n += r.int(1, 4); if (p.eng < 0.2 && n > 1) n--;
      let t = p.cr + r.int(1, 20) * DAY, rev = 0;
      for (let k = 0; k < n; k++) {
        if (k) t += (p.pr.lens && r.chance(0.7) ? p.pr.refill + r.int(-6, 12) : r.int(30, 170)) * DAY;
        if (t > now - 2 * HOUR) break;
        let it = E.pickItems(r);
        if (p.pr.lens && k > 0 && lensP.length && r.chance(0.65)) { const l = r.pick(lensP), s = solP.length ? r.pick(solP) : null; it = { s: l.sku, x: l.sku + (s ? ',' + s.sku : ''), v: Math.round((l.price + (s ? s.price : 0)) * 100) / 100 }; }
        const sk = it.x.split(',');
        for (let j = r.int(1, 3); j > 0; j--) push(p.id, 'view', t - r.int(60, 3000) * MIN, { s: r.pick(sk) });
        push(p.id, 'cart', t - r.int(15, 50) * MIN, { s: it.s, v: it.v }); push(p.id, 'checkout', t - r.int(3, 14) * MIN, { s: it.s, v: it.v });
        push(p.id, 'order', t, { s: it.s, v: it.v, x: it.x }); rev += it.v;
      }
      for (let j = r.int(0, 6); j > 0; j--) { const ts = p.cr + r.int(0, Math.max(1, Math.floor((now - p.cr) / MIN - 10))) * MIN; push(p.id, 'view', ts, { s: r.pick(products).sku }); }
      if (r.chance(0.17)) { const q = r.pick(products), ts = now - Math.round(r.exp(30) * DAY); if (ts > p.cr && ts < now - 3 * HOUR) { push(p.id, 'view', ts - 10 * MIN, { s: q.sku }); push(p.id, 'cart', ts, { s: q.sku, v: q.price }); if (r.chance(0.4)) push(p.id, 'checkout', ts + 6 * MIN, { s: q.sku, v: q.price }); } }
      spend.set(p.id, rev);
    });
    const vip = Array.from(spend.entries()).sort((a, b) => b[1] - a[1]).slice(0, Math.round(D.N * 0.04)).map(x => x[0]);
    vip.forEach(id => { const p = E.P.get(id); if (!p.ce || p.id <= 6) return; p.l.push('l_vip'); push(id, 'sub', now - r.int(10, 300) * DAY, { x: 'l_vip' }); });
    ev.sort((a, b) => a.ts - b.ts);

    /* segments */
    const row = (o) => o;
    db.segments = [
      { id: 'sg_engaged', name: 'Engaged last 30 days', desc: 'Opened or clicked an email in the last 30 days', cond: { mode: 'any', rows: [row({ t: 'did', ev: 'open', op: 'did', days: 30 }), row({ t: 'did', ev: 'click', op: 'did', days: 30 })] } },
      { id: 'sg_lapsed', name: 'Lapsed customers (180d)', desc: 'Bought before, nothing in the last 180 days', cond: { mode: 'all', rows: [row({ t: 'pred', f: 'orders', op: 'gte', v: 1 }), row({ t: 'pred', f: 'last_order_days', op: 'gt', v: 180 }), row({ t: 'consent', f: 'email', op: 'yes' })] } },
      { id: 'sg_big', name: 'Big spenders', desc: 'More than €400 lifetime revenue', cond: { mode: 'all', rows: [row({ t: 'pred', f: 'revenue', op: 'gt', v: 400 })] } },
      { id: 'sg_lens', name: 'Lens refill due soon', desc: 'Lens wearers expected to reorder within 14 days', cond: { mode: 'all', rows: [row({ t: 'prop', f: 'lens', op: 'eq', v: 'true' }), row({ t: 'pred', f: 'next_order_days', op: 'lte', v: 14 }), row({ t: 'consent', f: 'email', op: 'yes' })] } },
      { id: 'sg_si', name: 'Slovenian subscribers', desc: 'Country SI with email consent', cond: { mode: 'all', rows: [row({ t: 'prop', f: 'cc', op: 'eq', v: 'SI' }), row({ t: 'consent', f: 'email', op: 'yes' })] } },
      { id: 'sg_hr', name: 'Croatian subscribers', desc: 'Country HR with email consent', cond: { mode: 'all', rows: [row({ t: 'prop', f: 'cc', op: 'eq', v: 'HR' }), row({ t: 'consent', f: 'email', op: 'yes' })] } },
      { id: 'sg_unengaged', name: 'Unengaged 120 days', desc: 'Subscribed but no opens or clicks in 120 days', cond: { mode: 'all', rows: [row({ t: 'consent', f: 'email', op: 'yes' }), row({ t: 'did', ev: 'open', op: 'not', days: 120 }), row({ t: 'did', ev: 'click', op: 'not', days: 120 }), row({ t: 'prop', f: 'created', op: 'older', v: 150 })] } },
      { id: 'sg_cart', name: 'Cart added, no order (14d)', desc: 'Added to cart but did not order recently', cond: { mode: 'all', rows: [row({ t: 'did', ev: 'cart', op: 'did', days: 14 }), row({ t: 'did', ev: 'order', op: 'not', days: 14 })] } },
      { id: 'sg_new', name: 'New subscribers (30d)', desc: 'Profiles created in the last 30 days', cond: { mode: 'all', rows: [row({ t: 'prop', f: 'created', op: 'within', v: 30 }), row({ t: 'consent', f: 'email', op: 'yes' })] } },
      { id: 'sg_churn', name: 'High churn risk', desc: 'Repeat customers with churn score above 70', cond: { mode: 'all', rows: [row({ t: 'pred', f: 'orders', op: 'gte', v: 2 }), row({ t: 'pred', f: 'churn', op: 'gt', v: 70 })] } }
    ].map(s => Object.assign({ created: now - 300 * DAY }, s));

    /* templates */
    db.templates = M.TEMPLATES.map((t, i) => ({ id: 't_' + t.key, key: t.key, name: t.name, category: t.category, subject: t.subject, preview: t.preview, design: t.design(), custom: false, updated: now - (60 + i * 17) * DAY }));
    const tpl = k => U.copy(db.templates.find(t => t.key === k).design);
    const T = k => db.templates.find(t => t.key === k);

    /* flows */
    const cond = (rows, mode) => ({ mode: mode || 'all', rows });
    const mk = (id, name, status, trigger, steps, o) => {
      steps.forEach((s, i) => { s.id = s.id || 's' + (i + 1); });
      steps.forEach((s, i) => { if (s.next === undefined && ['cond', 'wait'].indexOf(s.type) < 0) s.next = steps[i + 1] ? steps[i + 1].id : null; });
      return Object.assign({ id, name, status, trigger, steps, start: steps[0].id, last: {}, stats: { entered: 0, completed: 0 }, cool: 30, created: now - 480 * DAY }, o || {});
    };
    const em = (name, key, subject, preview) => ({ type: 'email', name, subject: subject || T(key).subject, preview: preview || T(key).preview, design: tpl(key) });
    const dl = (d, h) => ({ type: 'delay', d: d || 0, h: h || 0 });
    db.flows = [
      mk('fl_welcome_si', 'Welcome series (SI)', 'live', { type: 'list', list: 'l_news_si' }, [em('Welcome', 'welcome'), dl(2), em('Bestsellers', 'newsletter', 'Our bestsellers, picked for you', 'What people love most'), dl(3), { type: 'cond', cond: cond([{ t: 'pred', f: 'orders', op: 'gte', v: 1 }]), yes: null, no: 's6' }, { type: 'email', name: 'First order nudge', subject: 'Your 10% is waiting', preview: 'Use it on your first pair.', design: tpl('welcome') }], { cool: 365 }),
      mk('fl_welcome_hr', 'Welcome series (HR)', 'live', { type: 'list', list: 'l_news_hr' }, [em('Welcome', 'welcome', 'Dobrodošli u Lumina, {{ first_name|default:"prijatelju" }}'), dl(3), em('Bestsellers', 'newsletter', 'Naši bestseleri za vas')], { cool: 365 }),
      mk('fl_cart', 'Abandoned cart', 'live', { type: 'event', ev: 'cart' }, [dl(0, 4), { type: 'wait', ev: 'order', days: 1, yes: null, no: 's3' }, em('Cart reminder', 'cart'), dl(2), em('Last call', 'cart', 'Last chance to complete your order', 'Your frames may sell out.')], { cool: 7 }),
      mk('fl_checkout', 'Abandoned checkout', 'live', { type: 'event', ev: 'checkout' }, [dl(0, 1), { type: 'wait', ev: 'order', days: 1, yes: null, no: 's3' }, { type: 'email', name: 'Checkout reminder', subject: 'You were so close', preview: 'Finish your order in one click.', design: tpl('cart') }], { cool: 7 }),
      mk('fl_browse', 'Browse abandonment', 'draft', { type: 'event', ev: 'view' }, [dl(1), { type: 'wait', ev: 'cart', days: 1, yes: null, no: 's3' }, { type: 'email', name: 'Still looking?', subject: 'Still looking at these frames?', preview: 'A few ideas for you.', design: tpl('arrivals') }], { cool: 14 }),
      mk('fl_post', 'Post-purchase care', 'live', { type: 'event', ev: 'order' }, [dl(3), em('Care tips', 'newsletter', 'Care tips for your new glasses', 'Keep them like new.'), dl(14), em('Review request', 'newsletter', 'How do you like them?', 'Tell us in one minute.')], { cool: 30 }),
      mk('fl_refill', 'Contact-lens refill', 'live', { type: 'date', prop: 'refill', offset: -7 }, [em('Refill reminder', 'refill'), dl(3), { type: 'sms', name: 'Refill SMS', text: 'Lumina: your lenses run low soon. Reorder in two clicks: lumina-optika.example/lens Reply STOP to opt out' }], { cool: 20 }),
      mk('fl_exam', 'Eye-exam reminder', 'live', { type: 'date', prop: 'exam', offset: 700 }, [em('Exam reminder', 'exam')], { cool: 300 }),
      mk('fl_bday', 'Birthday gift', 'live', { type: 'date', prop: 'birthday', offset: 0 }, [em('Birthday', 'birthday')], { cool: 300 }),
      mk('fl_winback', 'Win-back (lapsed)', 'live', { type: 'segment', seg: 'sg_lapsed' }, [em('We miss you', 'newsletter', 'We miss you, {{ first_name|default:"friend" }}', 'Here is a reason to come back.'), dl(7), { type: 'cond', cond: cond([{ t: 'did', ev: 'open', op: 'did', days: 8 }]), yes: null, no: 's4' }, { type: 'email', name: 'Win-back offer', subject: 'A little something to welcome you back', preview: '15% off, just for you.', design: tpl('birthday') }], { cool: 180 }),
      mk('fl_vip', 'VIP welcome', 'live', { type: 'list', list: 'l_vip' }, [em('VIP welcome', 'welcome', 'You are now a Lumina VIP', 'Early access to every collection.')], { cool: 365 }),
      mk('fl_sunset', 'Sunset unengaged', 'paused', { type: 'segment', seg: 'sg_unengaged' }, [em('Still interested?', 'newsletter', 'Still want to hear from us?', 'Tell us if you would like to stay.'), dl(7), { type: 'cond', cond: cond([{ t: 'did', ev: 'open', op: 'did', days: 8 }]), yes: null, no: 's4' }, { type: 'prop', key: 'sunset', val: true }], { cool: 120 })
    ];

    E.init(db);
    E.rand = r; E.clock = now;
    /* flow history: run the real engine over the generated shopping events */
    E.noflow = false;
    const raw = ev.slice();
    raw.forEach(e => { if (e.t === 'sub' || e.t === 'cart' || e.t === 'checkout' || e.t === 'order') { const p = E.P.get(e.p); if (p && e.ts > now - 540 * DAY) E.onEvent(e, p); } });
    E.runDateTriggers(now - 540 * DAY);
    E.tickSegments(true);

    /* campaigns */
    const stores = { name: 'Lumina Optika', email: db.settings.fromEmail };
    const mon = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const at10 = d => { const t = new Date(now - d * DAY); t.setHours(10, 0, 0, 0); return t.getTime(); };
    let cn = 0;
    const camp = (o) => Object.assign({ id: 'c' + String(++cn).padStart(3, '0'), channel: 'email', status: 'draft', from: stores, inc: [], exc: [], ab: { on: false, test: 20, metric: 'open', wait: 4, variants: [{ subject: '' }, { subject: '' }] }, created: now - 20 * DAY, promo: 1, utm: 'mail' }, o);
    const camps = [];
    for (let m = 11; m >= 0; m--) {
      const d = m * 30 + 6, mn = mon[new Date(at10(d)).getMonth()];
      ['SI', 'HR'].forEach((cc, j) => {
        const design = tpl('newsletter'), si = cc === 'SI';
        const subj = si ? 'Vaše novice: ' + mn + ' pri Lumini' : mn + ' u Lumini: novosti za vas';
        camps.push(camp({ name: cc + ' newsletter – ' + mn, subject: si ? 'Your ' + mn + ' at Lumina' : subj, preview: 'New frames, eye-care tips and store news.', design, inc: [{ t: 'list', id: si ? 'l_news_si' : 'l_news_hr' }], exc: [], sendAt: at10(d) + j * 3 * HOUR, ab: { on: m % 3 === 1 && si, test: 20, metric: 'open', wait: 4, variants: [{ subject: 'Your ' + mn + ' at Lumina' }, { subject: 'Eye-care tips and new frames for ' + mn + '!' }] } }));
      });
    }
    [[330, 'Black Friday sale', 'sale', 'Up to 30% off: Black Friday at Lumina', 1.3], [300, 'Christmas gift guide', 'arrivals', 'Gifts that help them see the world', 1.15], [255, 'Valentine’s offer', 'arrivals', 'Fall in love with new frames', 1.1], [200, 'Spring collection', 'arrivals', 'Spring is here: meet the new collection', 1.1], [140, 'Sunglasses sale', 'sale', 'Sunglasses from €49 this weekend', 1.25], [80, 'Back-to-school eye check', 'exam', 'Back to school: book a free eye check', 1.0]].forEach(x => {
      camps.push(camp({ name: x[1], subject: x[3], preview: 'Limited time in stores and online.', design: tpl(x[2]), inc: [{ t: 'list', id: 'l_news_si' }, { t: 'list', id: 'l_news_hr' }], exc: [], sendAt: at10(x[0]) + 2 * HOUR, promo: x[4] }));
    });
    [[320, 'Black Friday SMS', 'Lumina: Black Friday -30% on all frames today only. lumina-optika.example/bf Reply STOP to opt out'], [170, 'Lens reminder SMS', 'Lumina: stock up on lenses and get free delivery this week. lumina-optika.example/lens STOP: reply STOP'], [95, 'Weekend -20% SMS', 'Lumina: this weekend -20% on sunglasses in all stores. Reply STOP to opt out'], [40, 'Store opening Maribor', 'Lumina: our new Maribor store opens Saturday. First 50 visitors get a free case! Reply STOP to opt out']].forEach(x => {
      camps.push(camp({ channel: 'sms', name: x[1], text: x[2], inc: [{ t: 'list', id: 'l_sms' }], exc: [], sendAt: at10(x[0]) + HOUR, promo: 1.1 }));
    });
    camps.sort((a, b) => a.sendAt - b.sendAt);
    camps.forEach((c, i) => c.id = 'c' + String(i + 1).padStart(3, '0')); cn = camps.length;
    E.noflow = true;
    camps.forEach(c => { c.created = c.sendAt - 6 * DAY; c.sched = { mode: 'at', at: c.sendAt }; const res = E.runSend(c, { sendAt: c.sendAt, r }); E.commitSend(c, res); });
    E.noflow = false;
    db.campaigns = camps;
    /* a draft and two scheduled campaigns */
    const nd = new Date(now + 3 * DAY); nd.setHours(10, 0, 0, 0);
    const nd2 = new Date(now + 9 * DAY); nd2.setHours(9, 0, 0, 0);
    db.campaigns.push(camp({ id: 'c' + String(++cn).padStart(3, '0'), name: 'Winter frames preview (draft)', subject: 'First look: the winter collection', preview: 'Our VIPs see it first.', design: tpl('arrivals'), inc: [{ t: 'list', id: 'l_vip' }], step: 'content', created: now - 2 * DAY }));
    db.campaigns.push(camp({ id: 'c' + String(++cn).padStart(3, '0'), name: 'SI newsletter – ' + mon[nd.getMonth()], status: 'scheduled', subject: 'Your ' + mon[nd.getMonth()] + ' at Lumina', preview: 'New frames, eye-care tips and store news.', design: tpl('newsletter'), inc: [{ t: 'list', id: 'l_news_si' }], sched: { mode: 'at', at: nd.getTime() }, sendAt: nd.getTime(), created: now - 3 * DAY, step: 'review' }));
    db.campaigns.push(camp({ id: 'c' + String(++cn).padStart(3, '0'), name: 'Autumn promotion', status: 'scheduled', subject: '{{ first_name|default:"Hello" }}, autumn frames from €89', preview: 'Warm colours, soft shapes.', design: tpl('sale'), inc: [{ t: 'list', id: 'l_news_si' }, { t: 'list', id: 'l_news_hr' }], exc: [{ t: 'seg', id: 'sg_unengaged' }], sched: { mode: 'at', at: nd2.getTime() }, sendAt: nd2.getTime(), promo: 1.2, created: now - 1 * DAY, step: 'review' }));
    db.forms.forEach(fm => { const sub = (E.R['form:' + fm.id] || []).length; fm.views = Math.round(sub / (0.03 + r() * 0.04)); });
    db.flows.forEach(f => { f.lastDate = now; f.lastSeg = now; });
    /* finalise */
    ev.sort((a, b) => a.ts - b.ts);
    E.clock = null; E.rand = U.rng((Date.now() ^ 0x9e3779b9) >>> 0); E.noflow = false;
    E.init(db);
    return db;
  };
})();
