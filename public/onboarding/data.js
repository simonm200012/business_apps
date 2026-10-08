/* Joiners & leavers: demo data generator, catalogues, templates and asset helpers. */
window.JLData = (function () {
  'use strict';
  var VERSION = 1;
  var COMPANIES = [{ id: 'SI', name: 'Adrial SI' }, { id: 'HR', name: 'Adrial HR' }, { id: 'VAL', name: 'Vallis' }];
  var LOCATIONS = [
    { id: 'LJ-HQ', name: 'Ljubljana HQ', co: 'SI', kind: 'office', code: 'LJ' },
    { id: 'LJ-WH', name: 'Ljubljana warehouse', co: 'SI', kind: 'wh', code: 'LW' },
    { id: 'LJ-CC', name: 'Ljubljana contact centre', co: 'SI', kind: 'cc', code: 'LC' },
    { id: 'LJ-BTC', name: 'Store BTC City', co: 'SI', kind: 'store', code: 'BT' },
    { id: 'LJ-CP', name: 'Store Citypark', co: 'SI', kind: 'store', code: 'CP' },
    { id: 'MB-1', name: 'Store Maribor', co: 'SI', kind: 'store', code: 'MB' },
    { id: 'CE-1', name: 'Store Celje', co: 'SI', kind: 'store', code: 'CE' },
    { id: 'KP-1', name: 'Store Koper', co: 'SI', kind: 'store', code: 'KP' },
    { id: 'ZG-HQ', name: 'Zagreb office', co: 'HR', kind: 'office', code: 'ZH' },
    { id: 'ZG-AV', name: 'Store Zagreb Avenue', co: 'HR', kind: 'store', code: 'ZA' },
    { id: 'ST-1', name: 'Store Split', co: 'HR', kind: 'store', code: 'ST' },
    { id: 'RI-1', name: 'Store Rijeka', co: 'HR', kind: 'store', code: 'RI' },
    { id: 'VL-1', name: 'Vallis Gorizia', co: 'VAL', kind: 'store', code: 'VG' },
    { id: 'VL-2', name: 'Vallis Trieste', co: 'VAL', kind: 'store', code: 'VT' }
  ];
  var ROLES = [
    { id: 'Optician', kind: 'store' }, { id: 'Optometrist', kind: 'store' }, { id: 'Sales assistant', kind: 'store' },
    { id: 'Store manager', kind: 'store' }, { id: 'Warehouse operator', kind: 'wh' }, { id: 'Contact centre agent', kind: 'cc' },
    { id: 'Accountant', kind: 'office' }, { id: 'HR partner', kind: 'office' }, { id: 'IT support', kind: 'office' },
    { id: 'Marketing specialist', kind: 'office' }, { id: 'Buyer', kind: 'office' }
  ];
  var TEAMS = [{ id: 'HR', name: 'HR' }, { id: 'IT', name: 'IT' }, { id: 'MGR', name: 'Manager' }, { id: 'PAY', name: 'Payroll' }, { id: 'FAC', name: 'Facilities' }, { id: 'SELF', name: 'Person' }];
  var CONTRACTS = [{ id: 'permanent', name: 'Permanent' }, { id: 'fixed', name: 'Fixed term' }, { id: 'agency', name: 'Agency worker' }, { id: 'student', name: 'Student' }];
  var LICENCES = ['Microsoft 365', 'Optics ERP', 'CRM', 'Telephony'];
  var ASSET_TYPES = [
    { id: 'laptop', name: 'Laptop', pre: 'ADR-LT-', base: 101, pad: 4, models: ['Lenovo T14', 'Dell Latitude 5440', 'HP ProBook 450'] },
    { id: 'phone', name: 'Phone', pre: 'ADR-PH-', base: 201, pad: 4, models: ['Samsung A54', 'iPhone SE'] },
    { id: 'tablet', name: 'Tablet', pre: 'ADR-TB-', base: 301, pad: 4, models: ['iPad 10.9', 'Samsung Tab A9'] },
    { id: 'scanner', name: 'Scanner', pre: 'ADR-SC-', base: 401, pad: 4, models: ['Zebra TC21', 'Honeywell CT30'] },
    { id: 'card', name: 'Codeks card', pre: 'CDK-', base: 10407, pad: 5, models: ['Codeks access card'] },
    { id: 'key', name: 'Store key', pre: 'KEY-', base: 1, pad: 2, models: ['Store key set'] }
  ];
  var FIRST = ['Maja', 'Luka', 'Ana', 'Marko', 'Nina', 'Jure', 'Eva', 'Matej', 'Katja', 'Tomaž', 'Petra', 'Andrej', 'Sara', 'Ivan', 'Lana', 'Filip', 'Mia', 'Davor', 'Tina', 'Gregor', 'Ivana', 'Marta', 'Luca', 'Giulia', 'Matija', 'Klara', 'Nik', 'Zala', 'Boris', 'Dora'];
  var LAST = ['Novak', 'Horvat', 'Kovač', 'Krajnc', 'Zupan', 'Potočnik', 'Mlakar', 'Kos', 'Vidmar', 'Golob', 'Babić', 'Marić', 'Jurić', 'Knežević', 'Rossi', 'Bianchi', 'Furlan', 'Kralj', 'Petek', 'Žagar', 'Hribar', 'Tomšič', 'Bogdan', 'Perić', 'Colja'];

  /* ---------- date utils (strings YYYY-MM-DD, UTC arithmetic) ---------- */
  var D0 = Date.UTC(1970, 0, 1);
  function dn(s) { var p = s.split('-'); return Math.round((Date.UTC(+p[0], +p[1] - 1, +p[2]) - D0) / 864e5); }
  function fromDn(n) { return new Date(D0 + n * 864e5).toISOString().slice(0, 10); }
  function addDays(s, n) { return fromDn(dn(s) + n); }
  function diffDays(a, b) { return dn(a) - dn(b); }
  function dow(s) { return (dn(s) + 3) % 7; } /* 0 = Monday */
  function workday(s, dir) { var w = dow(s); if (w === 5) return addDays(s, dir < 0 ? -1 : 2); if (w === 6) return addDays(s, dir < 0 ? -2 : 1); return s; }
  function dueFor(anchor, offset) { return workday(addDays(anchor, offset), offset > 0 ? 1 : -1); }
  function todayLj() {
    try { var p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Ljubljana', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); if (/^\d{4}-\d\d-\d\d$/.test(p)) return p; } catch (e) {}
    return new Date().toISOString().slice(0, 10);
  }
  function rng(seed) { var a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  /* ---------- templates ---------- */
  function I(team, offset, required, title, text, x) { return Object.assign({ team: team, offset: offset, required: !!required, title: title, text: text || '' }, x || {}); }
  function makeTemplates() {
    var common = [
      I('HR', -10, 1, 'Send contract and welcome pack', 'Contract signed by both sides.', { key: 'contract' }),
      I('PAY', -7, 1, 'Register payroll data', 'Tax card, bank account, start date.', { skipFor: ['agency'] }),
      I('IT', -5, 1, 'Create accounts and mailbox', 'Assign Microsoft 365 licence.', { licence: 'assign:Microsoft 365', key: 'accounts' }),
      I('MGR', -3, 0, 'Prepare first-week plan', 'Buddy, shifts and training slots.'),
      I('FAC', 0, 1, 'Issue Codeks access card', 'Card is registered to the person.', { asset: 'card' }),
      I('MGR', 0, 1, 'Welcome and tour', 'Meet the team, show safety exits.', { key: 'welcome' }),
      I('SELF', 0, 1, 'Sign house rules and data-protection notice', ''),
      I('SELF', 1, 0, 'Complete safety and fire training', 'Online course, 40 minutes.'),
      I('MGR', 5, 0, 'First-week check-in', ''),
      I('HR', 30, 0, 'Probation review', 'Manager and HR meet the person.', { skipFor: ['agency', 'student'] }),
      I('HR', -2, 1, 'Check optometrist licence', 'Valid licence copy on file.', { onlyRoles: ['Optometrist'] })
    ];
    var store = common.concat([
      I('IT', -3, 1, 'Issue tablet', 'Set up the store tablet.', { asset: 'tablet' }),
      I('FAC', -2, 1, 'Issue store key', 'Key set for the home store.', { asset: 'key' }),
      I('IT', -4, 0, 'Optics ERP access', 'Role: store.', { licence: 'assign:Optics ERP' })
    ]);
    var office = common.concat([I('IT', -3, 1, 'Issue laptop', 'Image, VPN and encryption.', { asset: 'laptop' }), I('IT', -3, 0, 'CRM access', '', { licence: 'assign:CRM' })]);
    var wh = common.concat([I('IT', -3, 1, 'Issue handheld scanner', '', { asset: 'scanner' }), I('FAC', -2, 1, 'Issue warehouse key', '', { asset: 'key' }), I('FAC', 1, 1, 'Forklift permit check', 'Only for operators with a permit.')]);
    var cc = common.concat([I('IT', -3, 1, 'Issue laptop and headset', '', { asset: 'laptop' }), I('IT', -3, 1, 'Telephony licence', '', { licence: 'assign:Telephony' })]);
    var leave = [
      I('HR', -14, 1, 'Confirm termination paperwork', 'Letter received and signed.', { key: 'paperwork' }),
      I('MGR', -7, 1, 'Agree handover plan', 'Open tasks, customers and keys.'),
      I('PAY', -3, 1, 'Calculate final pay and leave balance', '', { skipFor: ['agency'] }),
      I('HR', -2, 0, 'Exit interview', ''),
      I('SELF', 0, 1, 'Return laptop, tablet, scanner and phone', 'Everything issued by IT.', { collect: ['laptop', 'tablet', 'scanner', 'phone'], key: 'return' }),
      I('FAC', 0, 1, 'Collect Codeks card and keys', 'Remove access rights.', { collect: ['card', 'key'], key: 'collect' }),
      I('IT', 0, 1, 'Disable accounts and remove licences', 'Forward mailbox to manager for 30 days.', { licence: 'remove:all', key: 'accounts' }),
      I('PAY', 1, 1, 'Send final payslip', '', { skipFor: ['agency'] }),
      I('HR', 3, 0, 'Send certificate of employment', '')
    ];
    var move = [
      I('HR', -7, 1, 'Confirm new role or location in writing', '', { key: 'paperwork' }),
      I('PAY', -3, 1, 'Update payroll cost centre', '', { skipFor: ['agency'] }),
      I('IT', -2, 1, 'Update access groups and licences', '', { licence: 'assign:CRM' }),
      I('FAC', 0, 1, 'Return old store key', '', { collect: ['key'] }),
      I('FAC', 0, 1, 'Issue key for the new location', '', { asset: 'key' }),
      I('MGR', 1, 0, 'Introduce to the new team', '')
    ];
    var role = [
      I('HR', -7, 1, 'Confirm new role in writing', ''),
      I('PAY', -3, 1, 'Update salary grade', '', { skipFor: ['agency'] }),
      I('IT', -2, 1, 'Update access and licences', '', { licence: 'assign:Optics ERP' }),
      I('MGR', 0, 0, 'Agree goals for the new role', ''),
      I('SELF', 7, 0, 'Complete role training', '')
    ];
    return [
      { id: 'T-store', name: 'Joiner: store', type: 'joiner', kind: 'store', items: store },
      { id: 'T-office', name: 'Joiner: office', type: 'joiner', kind: 'office', items: office },
      { id: 'T-wh', name: 'Joiner: warehouse', type: 'joiner', kind: 'wh', items: wh },
      { id: 'T-cc', name: 'Joiner: contact centre', type: 'joiner', kind: 'cc', items: cc },
      { id: 'T-leave', name: 'Leaver', type: 'leaver', kind: '', items: leave },
      { id: 'T-move', name: 'Change of store or location', type: 'change', kind: '', items: move },
      { id: 'T-role', name: 'Change of role', type: 'change', kind: '', items: role }
    ];
  }

  /* Copies template items into dated tasks; items that do not apply start as 'na'. */
  function buildTasks(tpl, anchor, ctx) {
    ctx = ctx || {};
    return tpl.items.map(function (it, i) {
      var t = { id: 't' + (i + 1), team: it.team, title: it.title, text: it.text || '', offset: it.offset, required: !!it.required, due: dueFor(anchor, it.offset), status: 'open', by: '', at: '', asset: it.asset || '', collect: it.collect || null, licence: it.licence || '', key: it.key || '' };
      if (it.onlyRoles && it.onlyRoles.length && it.onlyRoles.indexOf(ctx.role) < 0) { t.status = 'na'; t.by = 'Template rule'; t.why = 'Only for ' + it.onlyRoles.join(', ') + '.'; }
      else if (it.skipFor && it.skipFor.indexOf(ctx.contract) >= 0) { t.status = 'na'; t.by = 'Template rule'; t.why = 'Not needed for contract type "' + ctx.contract + '".'; }
      return t;
    });
  }

  /* ---------- assets ---------- */
  function typeOf(id) { return ASSET_TYPES.filter(function (t) { return t.id === id; })[0]; }
  function locOf(id) { return LOCATIONS.filter(function (l) { return l.id === id; })[0]; }
  function nextTag(db, type, loc) {
    var T = typeOf(type), pre = T.pre;
    if (type === 'key') pre += ((locOf(loc) || { code: 'LJ' }).code) + '-';
    var max = T.base - 1;
    db.assets.forEach(function (a) { if (a.tag.indexOf(pre) === 0) { var n = parseInt(a.tag.slice(pre.length), 10); if (n > max) max = n; } });
    var s = String(max + 1); while (s.length < T.pad) s = '0' + s;
    return pre + s;
  }
  function stamp(day) { return day + 'T09:00'; }
  function addAsset(db, type, loc, day, status, by) {
    var T = typeOf(type), id = 'A' + String(++db.seq.a).padStart(4, '0');
    var a = { id: id, tag: nextTag(db, type, loc), type: type, model: T.models[db.assets.length % T.models.length], status: status || 'stock', holder: '', loc: loc, log: [{ at: stamp(day), ev: 'added', who: '', by: by || 'IT', note: '' }] };
    db.assets.push(a); return a;
  }
  function issueAsset(db, pid, type, loc, day, by, assetId) {
    var a = assetId ? db.assets.filter(function (x) { return x.id === assetId; })[0] : null;
    if (!a) a = db.assets.filter(function (x) { return x.type === type && x.status === 'stock' && (type !== 'key' || x.loc === loc); })[0];
    if (!a) a = addAsset(db, type, loc, day, 'stock', by);
    a.status = 'issued'; a.holder = pid; a.log.push({ at: stamp(day), ev: 'issued', who: pid, by: by || 'IT', note: '' });
    return a;
  }
  function returnAsset(db, a, day, by, note) { a.log.push({ at: stamp(day), ev: 'returned', who: a.holder, by: by || 'IT', note: note || '' }); a.status = 'stock'; a.holder = ''; }
  function equipFor(kind, role) {
    var e = kind === 'store' ? ['tablet', 'card', 'key'] : kind === 'wh' ? ['scanner', 'card', 'key'] : ['laptop', 'card'];
    if (role === 'Store manager' || role === 'Buyer') e = e.concat('phone');
    return e;
  }
  var ACTOR_BY_TEAM = { HR: 'Maja Novak (HR)', IT: 'Luka Horvat (IT)', MGR: 'Manager', PAY: 'Petra Zupan (Payroll)', FAC: 'Marko Kos (Facilities)', SELF: 'Person' };

  /* ---------- generator ---------- */
  function generate(today) {
    var R = rng(0x0B0A2D17), pick = function (a) { return a[Math.floor(R() * a.length)]; };
    var db = { version: VERSION, generatedFor: today, seq: { p: 0, a: 0, c: {} }, people: [], cases: [], assets: [], templates: makeTemplates(), mgrs: {} };
    var usedNames = {};
    function newName() { var n; do { n = pick(FIRST) + ' ' + pick(LAST); } while (usedNames[n]); usedNames[n] = 1; return n; }
    function email(n) { return n.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ /g, '.') + '@example.com'; }
    function addPerson(o) {
      var name = newName();
      var p = Object.assign({ id: 'P' + String(++db.seq.p).padStart(3, '0'), name: name, email: email(name), status: 'active', contract: R() < .12 ? pick(['fixed', 'agency', 'student']) : 'permanent', licences: ['Microsoft 365'] }, o);
      db.people.push(p); return p;
    }
    LOCATIONS.forEach(function (l) { db.mgrs[l.id] = newName(); });
    function roleFor(loc) { var rs = ROLES.filter(function (r) { return r.kind === loc.kind; }); if (loc.kind === 'store') return R() < .12 ? 'Store manager' : R() < .25 ? 'Optometrist' : R() < .55 ? 'Optician' : 'Sales assistant'; return pick(rs).id; }
    /* stock first (380-420 days ago) */
    var sd = addDays(today, -400);
    [['laptop', 8], ['phone', 5], ['tablet', 8], ['scanner', 4], ['card', 15]].forEach(function (s) { for (var i = 0; i < s[1]; i++) addAsset(db, s[0], 'LJ-HQ', addDays(sd, Math.floor(R() * 40)), 'stock'); });
    LOCATIONS.filter(function (l) { return l.kind === 'store' || l.kind === 'wh'; }).forEach(function (l) { for (var i = 0; i < 2; i++) addAsset(db, 'key', l.id, sd, 'stock'); });
    for (var r = 0; r < 3; r++) { var ra = addAsset(db, 'laptop', 'LJ-HQ', sd, 'stock'); ra.status = 'retired'; ra.log.push({ at: stamp(addDays(today, -120)), ev: 'retired', who: '', by: 'IT', note: 'End of life' }); }
    /* existing staff */
    var weights = [3, 1, 1, 6, 6, 6, 6, 6, 3, 6, 6, 6, 4, 4], total = 97, counts = [], wsum = weights.reduce(function (a, b) { return a + b; }, 0), acc = 0;
    weights.forEach(function (w, i) { var n = Math.round(w * total / wsum); counts.push(n); acc += n; });
    counts[3] += total - acc;
    LOCATIONS.forEach(function (loc, li) {
      for (var i = 0; i < counts[li]; i++) {
        var role = i === 0 && loc.kind === 'store' ? 'Store manager' : roleFor(loc), start = addDays(today, -(420 + Math.floor(R() * 3180)));
        var p = addPerson({ co: loc.co, loc: loc.id, role: role, start: start, mgr: db.mgrs[loc.id] });
        equipFor(loc.kind, role).forEach(function (t) { issueAsset(db, p.id, t, loc.id, addDays(start, 1), 'IT'); });
        if (loc.kind !== 'wh') p.licences.push(loc.kind === 'store' ? 'Optics ERP' : 'CRM');
      }
    });
    var existing = db.people.slice(), taken = {};
    function takePerson(pred) { var c = existing.filter(function (p) { return !taken[p.id] && p.status === 'active' && (!pred || pred(p)); }); var p = c[Math.floor(R() * c.length)]; taken[p.id] = 1; return p; }
    /* case specs */
    var specs = [], i;
    for (i = 0; i < 27; i++) specs.push({ type: 'joiner', off: -(100 + Math.floor(R() * 262)), closed: true });
    for (i = 0; i < 23; i++) specs.push({ type: 'leaver', off: -(100 + Math.floor(R() * 262)), closed: true, override: i === 5 || i === 14 });
    for (i = 0; i < 10; i++) specs.push({ type: 'change', off: -(100 + Math.floor(R() * 262)), closed: true });
    [-50, -21, -8, -3, 2, 5, 9, 13, 17, 21, 24, 27].forEach(function (o) { specs.push({ type: 'joiner', off: o }); });
    [-9, -4, -1, 3, 7, 12, 19, 25].forEach(function (o) { specs.push({ type: 'leaver', off: o }); });
    [-3, 5, 10, 16, 22].forEach(function (o) { specs.push({ type: 'change', off: o }); });
    specs.forEach(function (s) { s.date = s.type === 'leaver' ? workday(addDays(today, s.off), -1) : workday(addDays(today, s.off), 1); });
    specs.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    function pDone(due) { var d = diffDays(today, due); return d >= 14 ? .97 : d >= 7 ? .9 : d >= 3 ? .75 : d >= 0 ? .5 : d >= -3 ? .12 : 0; }
    function tplFor(type, kind, change) { return db.templates.filter(function (t) { return type === 'joiner' ? t.type === 'joiner' && t.kind === kind : type === 'leaver' ? t.id === 'T-leave' : t.id === (change ? 'T-move' : 'T-role'); })[0]; }
    specs.forEach(function (s) {
      var c = { id: '', no: '', type: s.type, pid: '', date: s.date, status: 'open', created: addDays(s.date, s.type === 'joiner' ? -21 : -14), closedAt: '', override: null, to: null, tasks: [], log: [], prev: null };
      var p, loc, tpl, change = false;
      if (s.type === 'joiner') {
        loc = pick(LOCATIONS); var role = loc.kind === 'store' ? roleFor(loc) : roleFor(loc);
        p = addPerson({ co: loc.co, loc: loc.id, role: role, start: s.date, status: (!s.closed && s.date > today) ? 'pending' : 'active', mgr: db.mgrs[loc.id] });
        tpl = tplFor('joiner', loc.kind);
      } else if (s.type === 'leaver') {
        p = takePerson(); loc = locOf(p.loc); tpl = tplFor('leaver');
      } else {
        p = takePerson(function (q) { return locOf(q.loc).kind === 'store'; }); loc = locOf(p.loc); change = R() < .5;
        var nl = change ? pick(LOCATIONS.filter(function (l) { return l.kind === 'store' && l.id !== p.loc; })) : loc;
        c.to = { role: change ? p.role : (p.role === 'Sales assistant' ? 'Optician' : 'Store manager'), loc: nl.id }; tpl = tplFor('change', '', change);
      }
      var yr = s.date.slice(0, 4); db.seq.c[yr] = (db.seq.c[yr] || 0) + 1;
      c.id = 'c' + (db.cases.length + 1); c.no = 'JL-' + yr + '-' + String(db.seq.c[yr]).padStart(3, '0');
      c.pid = p.id; c.co = p.co; c.loc = p.loc; c.role = p.role; c.contract = p.contract; c.tpl = tpl.id; c.mgr = db.mgrs[p.loc];
      c.tasks = buildTasks(tpl, s.date, { role: p.role, contract: p.contract });
      c.log.push({ at: stamp(c.created), by: ACTOR_BY_TEAM.HR, msg: 'Case created from template "' + tpl.name + '".' });
      c.tasks.forEach(function (t) { if (t.status === 'na') c.log.push({ at: stamp(c.created), by: 'Template rule', msg: 'Task "' + t.title + '" marked not needed. ' + t.why }); });
      var held = function () { return db.assets.filter(function (a) { return a.status === 'issued' && a.holder === p.id; }); };
      c.tasks.forEach(function (t) {
        if (t.status === 'na') return;
        var done = s.closed || R() < pDone(t.due) * (t.collect ? .45 : 1);
        if (!done) return;
        t.status = 'done'; t.by = ACTOR_BY_TEAM[t.team]; t.at = stamp(t.due > today ? today : t.due);
        if (!s.closed) {
          if (t.asset && s.type !== 'leaver') issueAsset(db, p.id, t.asset, (c.to && c.to.loc) || p.loc, t.due > today ? today : t.due, t.by);
          if (t.collect) held().filter(function (a) { return t.collect.indexOf(a.type) >= 0; }).forEach(function (a) { returnAsset(db, a, t.due > today ? today : t.due, t.by); });
        }
      });
      if (s.closed) {
        c.status = 'closed'; c.closedAt = stamp(addDays(s.date, 1));
        if (s.type === 'leaver') { held().forEach(function (a) { returnAsset(db, a, s.date, 'IT'); }); p.status = 'left'; p.left = s.date; }
        if (s.type === 'change') { p.role = c.to.role; p.loc = c.to.loc; p.co = locOf(p.loc).co; }
        if (s.override) { c.override = { reason: 'Final laptop returned by courier; confirmed by manager.', by: ACTOR_BY_TEAM.HR, at: c.closedAt }; c.tasks.forEach(function (t) { if (t.status === 'open') { t.status = 'done'; } }); }
        c.log.push({ at: c.closedAt, by: ACTOR_BY_TEAM.HR, msg: s.override ? 'Case closed with override.' : 'Case closed.' });
      }
      db.cases.push(c);
    });
    return db;
  }

  return { VERSION: VERSION, COMPANIES: COMPANIES, LOCATIONS: LOCATIONS, ROLES: ROLES, TEAMS: TEAMS, CONTRACTS: CONTRACTS, LICENCES: LICENCES, ASSET_TYPES: ASSET_TYPES, ACTOR_BY_TEAM: ACTOR_BY_TEAM,
    makeTemplates: makeTemplates, buildTasks: buildTasks, generate: generate, todayLj: todayLj, addDays: addDays, diffDays: diffDays, dow: dow, workday: workday, dueFor: dueFor,
    nextTag: nextTag, addAsset: addAsset, issueAsset: issueAsset, returnAsset: returnAsset, equipFor: equipFor, locOf: locOf, typeOf: typeOf, rng: rng, stamp: stamp };
})();
