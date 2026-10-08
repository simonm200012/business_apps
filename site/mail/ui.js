/* Adrial Mail — shared UI pieces: page header, status chips, condition editor (segments, splits,
 * flow filters), profile picker, sandboxed preview frame, pager. */
(function () {
  'use strict';
  var AM = window.AM, U = AM.U, E = AM.E, esc = U.esc, ic = U.ic, I = U.I;
  var UI = AM.UI = {};
  // Route registry (pages register here; app.js consumes it)
  AM.routes = AM.routes || [];
  AM.route = function (re, fn, nav) { AM.routes.push({ re: re, fn: fn, nav: nav }); };

  UI.head = function (o) {
    return '<div class="head"><div>' + (o.crumb ? '<a class="crumb" href="' + esc(o.crumb.href) + '">' + ic(I.back) + esc(o.crumb.label) + '</a>' : '') +
      '<h1 tabindex="-1">' + esc(o.title) + (o.dot ? '<span class="dot">.</span>' : '') + '</h1>' + (o.sub ? '<p class="sub">' + o.sub + '</p>' : '') + '</div>' +
      (o.actions ? '<div class="actions">' + o.actions + '</div>' : '') + '</div>';
  };
  var ST = { draft: ['Draft', 'grey'], scheduled: ['Scheduled', 'blue'], sending: ['Sending', 'violet'], sent: ['Sent', 'green'], live: ['Live', 'green'], manual: ['Manual', 'clay'], subscribed: ['Subscribed', 'green'], unsubscribed: ['Unsubscribed', 'clay'], never: ['No consent', 'grey'], suppressed: ['Suppressed', 'clay'] };
  UI.status = function (s) { var x = ST[s] || [s, 'grey']; return '<span class="chip tone tone-' + x[1] + '"><span class="d"></span>' + esc(x[0]) + '</span>'; };
  UI.consent = function (p, ch) {
    var c = ch === 'sms' ? p.sms : p.em;
    if (p.sup) return UI.status('suppressed');
    return UI.status(c ? c.s : 'never');
  };
  UI.avatar = function (p, lg) { var tones = ['violet', 'blue', 'teal', 'clay', 'green']; return '<span class="av' + (lg ? ' lg' : '') + ' tone-' + tones[p.id % 5] + '" aria-hidden="true">' + esc(U.initials(p.first, p.last)) + '</span>'; };
  UI.who = function (p, link) {
    return '<span class="who">' + UI.avatar(p) + '<span class="nm"><b>' + (link !== false ? '<a class="t1" href="#/profiles/' + p.id + '">' + esc(E.fullName(p)) + '</a>' : esc(E.fullName(p))) + '</b><small>' + esc(p.email) + '</small></span></span>';
  };
  UI.kpi = function (label, value, sub, cls) { return '<div class="card kpi' + (cls ? ' ' + cls : '') + '"><span class="label">' + esc(label) + '</span><span class="v">' + esc(value) + '</span>' + (sub ? '<span class="s">' + sub + '</span>' : '') + '</div>'; };
  UI.delta = function (cur, prev, invert) {
    if (!prev) return '<span class="delta">no prior data</span>';
    var d = (cur - prev) / Math.abs(prev), up = d >= 0, good = invert ? !up : up;
    return '<span class="delta ' + (Math.abs(d) < 0.005 ? '' : good ? 'up' : 'down') + '">' + (up ? '+' : '−') + Math.abs(d * 100).toFixed(1) + '% vs previous</span>';
  };
  UI.pager = function (total, page, size) {
    var pages = Math.max(1, Math.ceil(total / size));
    return '<div class="pager"><span>' + U.n(total ? page * size + 1 : 0) + '–' + U.n(Math.min(total, (page + 1) * size)) + ' of ' + U.n(total) + '</span><span class="actions">' +
      '<button type="button" class="btn sm" data-page="' + (page - 1) + '"' + (page <= 0 ? ' disabled' : '') + '>Previous</button>' +
      '<button type="button" class="btn sm" data-page="' + (page + 1) + '"' + (page >= pages - 1 ? ' disabled' : '') + '>Next</button></span></div>';
  };
  UI.audienceText = function (c) {
    var name = function (r) { var x = r.type === 'list' ? E.list(r.id) : E.segment(r.id); return x ? x.name : '(deleted)'; };
    var inc = (c.audience && c.audience.include || []).map(name), exc = (c.audience && c.audience.exclude || []).map(name);
    return (inc.length ? inc.join(', ') : 'No audience') + (exc.length ? ' · excluding ' + exc.join(', ') : '');
  };
  // Sandboxed preview: no scripts, no same-origin, CSP inside the document blocks any network.
  UI.frame = function (html, o) {
    o = o || {};
    return '<div class="frame-wrap' + (o.mobile ? ' mobile' : '') + (o.cls ? ' ' + o.cls : '') + '"><iframe sandbox="" referrerpolicy="no-referrer" loading="lazy" title="' + esc(o.title || 'Email preview') + '" srcdoc="' + esc(html) + '"></iframe></div>';
  };
  UI.emailHtml = function (design, o) { return AM.Email.render(design, Object.assign({ ctx: E.ctx }, o || {})); };

  // ── Condition editor ──────────────────────────────────────────────────
  var KINDS = [['prop', 'Profile property'], ['consent', 'Consent'], ['event', 'What someone has done (or not)'], ['list', 'List membership'], ['segment', 'Segment membership'], ['pred', 'Predictive analytics']];
  UI.condDefault = function (kind) {
    var db = E.db();
    switch (kind) {
      case 'prop': return { kind: 'prop', field: 'country', op: 'eq', value: 'SI' };
      case 'consent': return { kind: 'consent', channel: 'email', value: 'subscribed' };
      case 'list': return { kind: 'list', op: 'in', list: db.lists[0] ? db.lists[0].id : 1 };
      case 'segment': return { kind: 'segment', op: 'in', seg: db.segments[0] ? db.segments[0].id : 1 };
      case 'pred': return { kind: 'pred', field: 'clv', op: 'gt', value: 300 };
    }
    return { kind: 'event', ev: 'order', op: 'atleast', n: 1, win: { type: 'last', days: 30 } };
  };
  function sel(cf, opts, val, label, cls) {
    return '<label class="sr" for="' + cf.id + '">' + esc(label) + '</label><select class="in ' + (cls || '') + '" id="' + cf.id + '" data-cf="' + cf.f + '">' + opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(val) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>';
  }
  function inp(cf, type, val, label, cls, extra) {
    return '<label class="sr" for="' + cf.id + '">' + esc(label) + '</label><input class="in ' + (cls || '') + '" id="' + cf.id + '" type="' + type + '" data-cf="' + cf.f + '" value="' + esc(val == null ? '' : val) + '"' + (extra || '') + '>';
  }
  var uid = 0;
  function cf(f) { return { id: 'cf' + (++uid), f: f }; }
  var PRODUCT_EVENTS = ['view', 'cart', 'checkout', 'order', 'price_drop', 'bis'];
  UI.condControls = function (c, opts) {
    opts = opts || {};
    var db = E.db(), h = '';
    var kinds = KINDS.filter(function (k) { return !opts.kinds || opts.kinds.indexOf(k[0]) >= 0; });
    h += sel(cf('kind'), kinds, c.kind, 'Condition type', 'w-l');
    if (c.kind === 'prop') {
      var known = E.PROP_FIELDS.some(function (f) { return f.k === c.field; });
      h += sel(cf('field'), E.PROP_FIELDS.map(function (f) { return [f.k, f.label]; }).concat([['__custom', 'Custom property…']]), known ? c.field : '__custom', 'Property');
      if (!known) h += inp(cf('customKey'), 'text', c.field.replace(/^props\./, ''), 'Custom property name', 'w-s', ' placeholder="key"');
      var d = E.fieldDef(c.field);
      h += sel(cf('op'), E.OPS[d.type] || E.OPS.text, c.op, 'Operator');
      if (c.op !== 'set' && c.op !== 'notset') {
        if (d.type === 'enum') h += sel(cf('value'), d.opts, c.value, 'Value');
        else if (d.type === 'date' && (c.op === 'last' || c.op === 'next')) h += inp(cf('value'), 'number', c.value, 'Number of days', 'w-s', ' min="0"') + '<span class="or">days</span>';
        else if (d.type === 'date') h += inp(cf('value'), 'date', c.value, 'Date');
        else h += inp(cf('value'), d.type === 'number' ? 'number' : 'text', c.value, 'Value', d.type === 'number' ? 'w-s' : '');
      }
    } else if (c.kind === 'consent') {
      h += sel(cf('channel'), [['email', 'Email'], ['sms', 'SMS']], c.channel, 'Channel');
      h += sel(cf('value'), [['subscribed', 'is subscribed'], ['unsubscribed', 'is unsubscribed'], ['never', 'was never given'], ['suppressed', 'profile is suppressed'], ['can', 'can receive (subscribed, not suppressed)']], c.value, 'Consent state');
    } else if (c.kind === 'event') {
      h += sel(cf('ev'), E.SEG_EVENTS.map(function (k) { return [k, E.EVENTS[k]]; }), c.ev, 'Event');
      h += sel(cf('op'), [['atleast', 'at least'], ['atmost', 'at most'], ['exactly', 'exactly'], ['zero', 'zero times (has not)']], c.op, 'Frequency');
      if (c.op !== 'zero') h += inp(cf('n'), 'number', c.n, 'Count', 'w-s', ' min="0"') + '<span class="or">times</span>';
      var wins = [['all', 'over all time'], ['last', 'in the last']]; if (opts.since) wins.push(['since', 'since starting this flow']);
      var w = c.win || { type: 'all' };
      h += sel(cf('win.type'), wins, w.type, 'Time window');
      if (w.type === 'last') h += inp(cf('win.days'), 'number', w.days, 'Days', 'w-s', ' min="1"') + '<span class="or">days</span>';
      var wf = [['', 'no filter']];
      if (PRODUCT_EVENTS.indexOf(c.ev) >= 0) wf.push(['category', 'where category is']);
      if (c.ev === 'order' || c.ev === 'checkout' || c.ev === 'cart') wf.push(['value', 'where value']);
      if (c.ev === 'open' || c.ev === 'click' || c.ev === 'unsub' || c.ev === 'sms_click' || c.ev === 'bounce') wf.push(['message', 'where message is']);
      if (c.ev === 'sub') wf.push(['list', 'where list is']);
      var wh = c.where || {};
      if (wf.length > 1) {
        h += sel(cf('where.field'), wf, wh.field || '', 'Event filter');
        if (wh.field === 'category') h += sel(cf('where.value'), E.CATEGORIES.concat(db.products.map(function (p) { return p.category; })).filter(function (x, i, a) { return a.indexOf(x) === i; }).map(function (x) { return [x, x]; }), wh.value, 'Category');
        if (wh.field === 'value') h += sel(cf('where.op'), [['gte', '≥ €'], ['lt', '< €']], wh.op || 'gte', 'Value comparison') + inp(cf('where.value'), 'number', wh.value, 'Value in euro', 'w-s', ' min="0"');
        if (wh.field === 'list') h += sel(cf('where.value'), db.lists.map(function (l) { return [l.id, l.name]; }), wh.value, 'List');
        if (wh.field === 'message') h += sel(cf('where.value'), db.campaigns.filter(function (x) { return x.status === 'sent'; }).slice().reverse().map(function (x) { return ['c:' + x.id, (x.channel === 'sms' ? 'SMS · ' : 'Campaign · ') + x.name]; }).concat(db.flows.map(function (f) { return ['f:' + f.id, 'Flow · ' + f.name]; })), wh.value, 'Message');
      }
    } else if (c.kind === 'list') {
      h += sel(cf('op'), [['in', 'is in list'], ['notin', 'is not in list']], c.op, 'Membership');
      h += sel(cf('list'), db.lists.map(function (l) { return [l.id, l.name]; }), c.list, 'List', 'w-l');
    } else if (c.kind === 'segment') {
      h += sel(cf('op'), [['in', 'is in segment'], ['notin', 'is not in segment']], c.op, 'Membership');
      h += sel(cf('seg'), db.segments.filter(function (s) { return s.id !== opts.selfSeg; }).map(function (s) { return [s.id, s.name]; }), c.seg, 'Segment', 'w-l');
    } else if (c.kind === 'pred') {
      h += sel(cf('field'), E.PRED_FIELDS.map(function (f) { return [f[0], f[1]]; }), c.field, 'Metric');
      if (c.field === 'churn') { h += sel(cf('op'), [['eq', 'is'], ['neq', 'is not']], c.op, 'Operator') + sel(cf('value'), [['low', 'low'], ['medium', 'medium'], ['high', 'high']], c.value, 'Churn risk'); }
      else h += sel(cf('op'), [['gt', 'is greater than'], ['lt', 'is less than'], ['eq', 'equals']], c.op, 'Operator') + inp(cf('value'), 'number', c.value, 'Value', 'w-s');
    }
    return h;
  };
  UI.condRow = function (c, key, opts) {
    opts = opts || {};
    return '<div class="cond" data-cond="' + esc(key) + '">' + UI.condControls(c, opts) + '<span class="grow"></span>' +
      (opts.removable !== false ? '<button type="button" class="btn xs icon ghost" data-cond-rm="' + esc(key) + '" aria-label="Remove condition">' + ic(I.x) + '</button>' : '') + '</div>';
  };
  function setPath(o, path, v) { var a = path.split('.'); for (var i = 0; i < a.length - 1; i++) { o[a[i]] = o[a[i]] || {}; o = o[a[i]]; } o[a[a.length - 1]] = v; }
  // Mutates c. Returns true when the row has to be re-rendered (structure changed).
  UI.setCond = function (c, f, el) {
    var v = el.type === 'number' ? (el.value === '' ? '' : Number(el.value)) : el.value;
    if (f === 'kind') { Object.keys(c).forEach(function (k) { delete c[k]; }); Object.assign(c, UI.condDefault(v)); return true; }
    if (f === 'list' || f === 'seg') v = +v;
    if (c.kind === 'prop' && f === 'field') {
      if (v === '__custom') { c.field = 'props.custom'; c.op = 'eq'; c.value = ''; return true; }
      var d = E.fieldDef(v); c.field = v; c.op = (E.OPS[d.type] || E.OPS.text)[0][0]; c.value = d.type === 'enum' ? d.opts[0][0] : d.type === 'date' ? 30 : '';
      return true;
    }
    if (f === 'customKey') { c.field = 'props.' + String(v).trim().replace(/[^\w-]/g, '_'); return false; }
    if (c.kind === 'prop' && f === 'op') { var d2 = E.fieldDef(c.field); var wasDays = c.op === 'last' || c.op === 'next'; c.op = v; if (d2.type === 'date' && wasDays !== (v === 'last' || v === 'next')) c.value = v === 'last' || v === 'next' ? 30 : U.ymd(E.now()); return true; }
    if (c.kind === 'pred' && f === 'field') { c.field = v; if (v === 'churn') { c.op = 'eq'; c.value = 'high'; } else { c.op = 'gt'; c.value = v === 'clv' ? 300 : 1; } return true; }
    if (f === 'ev') { c.ev = v; delete c.where; return true; }
    if (f === 'where.field') { c.where = v ? { field: v, value: v === 'category' ? E.CATEGORIES[0] : v === 'value' ? 100 : v === 'list' ? E.db().lists[0].id : '', op: 'gte' } : null; if (!v) delete c.where; return true; }
    if (f === 'where.value' && c.where && c.where.field === 'list') v = +v;
    if (f === 'win.type') { c.win = { type: v, days: v === 'last' ? (c.win && c.win.days) || 30 : undefined }; return true; }
    setPath(c, f, v);
    return f === 'op' || f === 'channel';
  };
  // Wire a container: lookup(key) → cond object; changed(structural) callback.
  UI.wireConds = function (root, lookup, changed, opts) {
    var handle = function (e, isInput) {
      var el = e.target.closest('[data-cf]'); if (!el) return;
      var row = el.closest('[data-cond]'); if (!row) return;
      if (isInput && el.tagName === 'SELECT') return;
      var c = lookup(row.dataset.cond); if (!c) return;
      var structural = UI.setCond(c, el.dataset.cf, el);
      if (structural && !isInput) {
        var o = typeof opts === 'function' ? opts(row.dataset.cond) : opts;
        var focusF = el.dataset.cf;
        row.outerHTML = UI.condRow(c, row.dataset.cond, o);
        var nr = root.querySelector('[data-cond="' + row.dataset.cond.replace(/"/g, '') + '"] [data-cf="' + focusF + '"]');
        if (nr) nr.focus();
      }
      changed(structural);
    };
    root.addEventListener('change', function (e) { handle(e, false); });
    root.addEventListener('input', function (e) { if (e.target.closest('[data-cf]') && e.target.tagName !== 'SELECT') handle(e, true); });
  };

  // ── Profile picker (combobox) ─────────────────────────────────────────
  UI.picker = function (id, label, value) {
    var p = value ? E.profile(value) : null;
    return '<div class="field picker"><label for="' + id + '">' + esc(label) + '</label><input class="in" id="' + id + '" role="combobox" aria-expanded="false" aria-controls="' + id + 'R" aria-autocomplete="list" autocomplete="off" placeholder="Type a name or email…" value="' + esc(p ? E.fullName(p) + ' <' + p.email + '>' : '') + '"><div class="picker-res" id="' + id + 'R" role="listbox" hidden></div></div>';
  };
  UI.wirePicker = function (root, id, onPick) {
    var input = root.querySelector('#' + id), res = root.querySelector('#' + id + 'R'), hits = [], act = -1;
    var draw = function () {
      var q = input.value.trim(); var db = E.db();
      hits = []; for (var i = 0; i < db.profiles.length && hits.length < 8; i++) { var p = db.profiles[i]; if (U.matchQ(q, p.first + ' ' + p.last + ' ' + p.email)) hits.push(p); }
      act = -1;
      res.innerHTML = hits.length ? hits.map(function (p, i) { return '<button type="button" role="option" id="' + id + 'o' + i + '" data-pick="' + p.id + '" tabindex="-1">' + UI.avatar(p) + '<span class="nm"><b style="font-weight:500">' + esc(E.fullName(p)) + '</b><small style="display:block;font-size:12px;color:var(--ink3)">' + esc(p.email + ' · ' + p.country) + '</small></span></button>'; }).join('') : '<div class="empty" style="padding:12px">No matching profile</div>';
      res.hidden = false; input.setAttribute('aria-expanded', 'true');
    };
    var pick = function (pid) { var p = E.profile(pid); if (!p) return; input.value = E.fullName(p) + ' <' + p.email + '>'; res.hidden = true; input.setAttribute('aria-expanded', 'false'); onPick(p); };
    input.addEventListener('focus', function () { input.select(); draw(); });
    input.addEventListener('input', draw);
    input.addEventListener('keydown', function (e) {
      var opts = U.$$('[data-pick]', res);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (res.hidden) draw(); act = (act + (e.key === 'ArrowDown' ? 1 : -1) + opts.length) % Math.max(1, opts.length); opts.forEach(function (o, i) { o.setAttribute('aria-selected', i === act ? 'true' : 'false'); }); if (opts[act]) { input.setAttribute('aria-activedescendant', opts[act].id); opts[act].scrollIntoView({ block: 'nearest' }); } }
      else if (e.key === 'Enter') { e.preventDefault(); if (opts[act < 0 ? 0 : act]) pick(opts[act < 0 ? 0 : act].dataset.pick); }
      else if (e.key === 'Escape' && !res.hidden) { e.stopPropagation(); res.hidden = true; input.setAttribute('aria-expanded', 'false'); }
    });
    res.addEventListener('mousedown', function (e) { var b = e.target.closest('[data-pick]'); if (b) { e.preventDefault(); pick(b.dataset.pick); } });
    input.addEventListener('blur', function () { setTimeout(function () { res.hidden = true; input.setAttribute('aria-expanded', 'false'); }, 150); });
  };

  UI.evIcon = function (t) {
    var m = { view: [I.eye, 'blue'], cart: ['<path d="M5 6h15l-2 9H7z"/><circle cx="9" cy="20" r="1.3"/><circle cx="17" cy="20" r="1.3"/>', 'clay'], checkout: ['<path d="M5 6h15l-2 9H7z"/><path d="M10 10l2 2 4-4"/>', 'clay'], order: [I.check, 'green'], open: [I.mail, 'violet'], click: ['<path d="M9 9l11 4-5 2-2 5z"/><path d="M5 5l2 2M12 3v3M3 12h3"/>', 'violet'], sms_click: [I.sms, 'teal'], unsub: [I.x, 'grey'], sub: [I.plus, 'teal'], form: ['<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8"/>', 'teal'], spam: [I.flag, 'clay'], bounce: [I.back, 'clay'], price_drop: ['<path d="M7 7l10 10M17 9v8H9"/>', 'blue'], bis: ['<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/>', 'blue'], flow: [I.zap, 'violet'], prop: [I.edit, 'grey'] }[t] || [I.more, 'grey'];
    return '<span class="dot tone-' + m[1] + '">' + ic(m[0]) + '</span>';
  };
  UI.evText = function (e) {
    var t = '<b>' + esc(E.EVENTS[e.t] || e.t) + '</b>';
    var prod = e.s ? E.product(e.s) : null;
    if (prod) t += ' · ' + esc(prod.name);
    if (e.v && (e.t === 'order' || e.t === 'checkout' || e.t === 'cart')) t += ' · ' + esc(U.money2(e.v));
    if (typeof e.r === 'string') { var href = E.refHref(e.r); t += ' · ' + (href ? '<a href="' + esc(href) + '">' + esc(E.refName(e.r)) + '</a>' : esc(E.refName(e.r))); }
    if (e.t === 'sub') { var l = E.list(e.r); t += ' · ' + esc(l ? l.name : 'list'); }
    if (e.t === 'form') { var f = E.form(e.r); t += ' · ' + esc(f ? f.name : 'form'); }
    if (e.t === 'flow') { var fl = E.flow(e.r); t += ' · ' + (fl ? '<a href="#/flows/' + fl.id + '">' + esc(fl.name) + '</a>' : 'deleted flow'); }
    if (e.t === 'prop' && e.x) t += ' · ' + esc(e.x);
    if (e.t === 'unsub') t += e.x === 'sms' ? ' (SMS)' : ' (email)';
    if (e.t === 'bounce' && e.x) t += ' (' + esc(e.x) + ')';
    return t;
  };
})();
