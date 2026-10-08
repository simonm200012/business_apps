/* Joiners & leavers demo: deterministic, entirely fictional dataset.
 * window.JLData.generate(todayYmd) builds the staff register, the asset register, the checklist templates,
 * ~60 finished cases over the last 12 months and 25 open cases (12 joiners, 8 leavers, 5 changes) at
 * different stages. A seeded random generator makes it identical on every load; dates are relative to
 * "today" (Europe/Ljubljana). All names are invented, e-mails are @example.com, there are no ID numbers,
 * bank details or salaries anywhere. */
(function () {
  'use strict';

  var VERSION = 1;

  var COMPANIES = [
    { id: 'ASI', name: 'Adrial d.o.o.', country: 'SI', label: 'Adrial d.o.o. (SI)' },
    { id: 'AHR', name: 'Adrial d.o.o.', country: 'HR', label: 'Adrial d.o.o. (HR)' },
    { id: 'VAL', name: 'Vallis d.o.o.', country: 'SI', label: 'Vallis d.o.o. (SI)' }
  ];
  var KINDS = { store: 'Optics store', office: 'Office', warehouse: 'Warehouse', callcentre: 'Call centre' };
  var LOCATIONS = [
    { id: 'HQ', name: 'Head office Komenda', short: 'Head office', kind: 'office', country: 'SI', company: 'ASI', code: 'HQ' },
    { id: 'ZGO', name: 'Office Zagreb', short: 'Office Zagreb', kind: 'office', country: 'HR', company: 'AHR', code: 'ZO' },
    { id: 'WH', name: 'Central warehouse Komenda', short: 'Warehouse', kind: 'warehouse', country: 'SI', company: 'VAL', code: 'WH' },
    { id: 'CC', name: 'Call centre Ljubljana', short: 'Call centre', kind: 'callcentre', country: 'SI', company: 'VAL', code: 'CC' },
    { id: 'S-LJ', name: 'Store Ljubljana BTC', short: 'Ljubljana', kind: 'store', country: 'SI', company: 'ASI', code: 'LJ' },
    { id: 'S-MB', name: 'Store Maribor', short: 'Maribor', kind: 'store', country: 'SI', company: 'ASI', code: 'MB' },
    { id: 'S-KP', name: 'Store Koper', short: 'Koper', kind: 'store', country: 'SI', company: 'ASI', code: 'KP' },
    { id: 'S-CE', name: 'Store Celje', short: 'Celje', kind: 'store', country: 'SI', company: 'ASI', code: 'CE' },
    { id: 'S-NM', name: 'Store Novo mesto', short: 'Novo mesto', kind: 'store', country: 'SI', company: 'ASI', code: 'NM' },
    { id: 'S-ZG', name: 'Store Zagreb', short: 'Zagreb', kind: 'store', country: 'HR', company: 'AHR', code: 'ZG' },
    { id: 'S-ST', name: 'Store Split', short: 'Split', kind: 'store', country: 'HR', company: 'AHR', code: 'ST' },
    { id: 'S-RI', name: 'Store Rijeka', short: 'Rijeka', kind: 'store', country: 'HR', company: 'AHR', code: 'RI' },
    { id: 'S-ZD', name: 'Store Zadar', short: 'Zadar', kind: 'store', country: 'HR', company: 'AHR', code: 'ZD' },
    { id: 'S-OS', name: 'Store Osijek', short: 'Osijek', kind: 'store', country: 'HR', company: 'AHR', code: 'OS' }
  ];
  var ROLES = {
    store: ['Optician', 'Optometrist', 'Contact lens specialist', 'Sales assistant', 'Store manager'],
    office: ['Finance accountant', 'Buyer', 'Marketing specialist', 'E-commerce specialist', 'Data analyst', 'HR generalist', 'IT support', 'Payroll specialist',
      'Facilities coordinator', 'Head of finance', 'Head of e-commerce', 'Head of retail', 'Operations director', 'Country manager'],
    warehouse: ['Warehouse operative', 'Picker / packer', 'Lens lab technician', 'Logistics coordinator', 'Warehouse shift lead', 'Warehouse manager'],
    callcentre: ['Customer service agent', 'Live-chat agent', 'Customer service team lead', 'Customer service manager']
  };
  var TEAMS = [
    { id: 'HR', name: 'HR', tone: 'violet' },
    { id: 'IT', name: 'IT', tone: 'blue' },
    { id: 'MGR', name: 'Manager', tone: 'teal' },
    { id: 'PAY', name: 'Payroll', tone: 'clay' },
    { id: 'FAC', name: 'Facilities', tone: 'good' },
    { id: 'SELF', name: 'Person', long: 'The person themself', tone: 'plain' }
  ];
  var CONTRACTS = { permanent: 'Permanent', fixed: 'Fixed-term', student: 'Student work', agency: 'Agency' };
  // Approximate monthly list prices per user, for the "licence freed" estimate only.
  var LICENCES = {
    F3: { name: 'Microsoft 365 F3', eur: 7.5 },
    BB: { name: 'Microsoft 365 Business Basic', eur: 5.6 },
    BS: { name: 'Microsoft 365 Business Standard', eur: 11.7 },
    BP: { name: 'Microsoft 365 Business Premium', eur: 20.6 }
  };
  var ASSET_TYPES = {
    laptop: { label: 'Laptop', prefix: 'ADR-LT-', models: ['Lenovo ThinkPad E14', 'Dell Latitude 5440', 'HP ProBook 440'] },
    phone: { label: 'Phone', prefix: 'ADR-PH-', models: ['Samsung Galaxy A55', 'Apple iPhone 15'] },
    tablet: { label: 'Tablet', prefix: 'ADR-TB-', models: ['Samsung Galaxy Tab A9+', 'Apple iPad (10th gen)'] },
    scanner: { label: 'Handheld scanner', prefix: 'ADR-SC-', models: ['Zebra TC22', 'Honeywell CT30 XP'] },
    card: { label: 'Codeks card', prefix: 'CDK-', models: ['Codeks RFID card'] },
    key: { label: 'Key set', prefix: 'KEY-', models: ['Store key set + alarm fob', 'Office key fob'] }
  };
  var NA_REASONS = ['Not relevant for this role', 'Already done earlier', 'EU citizen: not needed', 'Handled by the agency', 'Declined by the person', 'Other'];

  // Fixed demo users who tick tasks (no real login roles: "Acting as" picks one of these or a manager).
  var ACTORS = [
    { name: 'Tina Zupan', team: 'HR', note: 'HR · Slovenia' },
    { name: 'Ivana Perić', team: 'HR', note: 'HR · Croatia' },
    { name: 'Marko Kranjc', team: 'IT', note: 'IT · Slovenia' },
    { name: 'Luka Babić', team: 'IT', note: 'IT · Croatia' },
    { name: 'Petra Golob', team: 'PAY', note: 'Payroll' },
    { name: 'Janez Vidmar', team: 'FAC', note: 'Facilities' }
  ];

  // ── small date helpers (local dates as YYYY-MM-DD strings) ─────────────────
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parse(s) { var p = String(s).slice(0, 10).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(s, n) { var d = parse(s); d.setDate(d.getDate() + n); return ymd(d); }
  function dow(s) { return parse(s).getDay(); }
  function diff(a, b) { return Math.round((parse(b) - parse(a)) / 864e5); } // b − a in days
  // A due date on a weekend moves to the previous Friday (before or on the anchor) or the next Monday (after).
  function workday(s, dir) { var d = dow(s); if (d === 6) return addDays(s, dir > 0 ? 2 : -1); if (d === 0) return addDays(s, dir > 0 ? 1 : -2); return s; }
  function dueFor(anchor, offset) { return workday(addDays(anchor, offset), offset > 0 ? 1 : -1); }
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function atl(type) { return type === 'card' ? 'Codeks card' : ASSET_TYPES[type].label.toLowerCase(); }
  function licenceFor(kind, role) {
    if (/Head of|Director|Country manager|IT support/i.test(role)) return 'BP';
    if (/manager|lead/i.test(role) || kind === 'office') return 'BS';
    if (kind === 'callcentre') return 'BB';
    return 'F3';
  }

  // ── checklist templates ───────────────────────────────────────────────────
  function I(team, offset, required, title, text, x) {
    var o = { team: team, offset: offset, required: !!required, title: title, text: text || '' };
    if (x) Object.keys(x).forEach(function (k) { o[k] = x[k]; });
    return o;
  }
  var PAYROLL_NOTE = 'Record only that the form was received (yes/no). Never type tax numbers, bank accounts or ID numbers in this app.';
  var SKIP_INS = { student: 'Student work: registered by the student service', agency: 'Agency worker: handled by the agency' };
  var SKIP_PAY = { agency: 'Agency worker: paid by the agency' };
  function hrStart(med) {
    return [
      I('HR', -10, true, 'Employment contract signed', 'Both copies signed; the scan goes to the personnel file. The contract type must match this case.', { skipFor: { agency: 'Agency worker: contract is with the agency' } }),
      I('HR', -10, false, 'Work permit checked (non-EU citizens only)', 'Only for non-EU citizens. Keep the permit itself in the HR system, not here.', { naHint: 'EU citizen: not needed' }),
      I('HR', -7, true, 'Payroll data form received (tax + bank account)', PAYROLL_NOTE, { skipFor: SKIP_PAY }),
      I('HR', -5, true, 'Pre-employment medical check passed', med || 'Book with the occupational health provider and file the certificate (fit / not fit only, no health details).'),
      I('HR', -3, true, 'Registered for social insurance', 'Slovenia: M-1 form to ZZZS. Croatia: HZZO / HZMO registration. Before day 1.', { skipFor: SKIP_INS })
    ];
  }
  function makeTemplates() {
    var T = [
      { id: 'T-store', name: 'Joiner – optics store', type: 'joiner', kinds: ['store'], items: hrStart().concat([
        I('HR', 0, true, 'Safety at work training (varstvo pri delu) + fire safety', 'Signed attendance sheet. Store staff also cover handling of lens-care chemicals.'),
        I('IT', -3, true, 'Microsoft 365 account + licence', 'Create the first.last@ address. Store staff get Microsoft 365 F3, store managers Business Standard.', { licence: 'assign', key: true }),
        I('IT', -2, false, 'E-mail groups: store team + all staff'),
        I('IT', -2, true, 'POS login for the store', 'Cashier role. The PIN is handed over in person on day 1.'),
        I('IT', -1, false, 'Teams: added to the store channel'),
        I('IT', -1, false, 'Store tablet issued (asset tag)', 'Only if the store has no shared tablet for the eye-exam forms.', { asset: 'tablet', naHint: 'Uses the shared store tablet' }),
        I('IT', 0, true, 'MFA set up with the person', 'Authenticator app on their own phone or the store phone.'),
        I('FAC', -1, true, 'Codeks time-attendance card issued', 'Link the card to the store’s Codeks place before day 1.', { asset: 'card' }),
        I('FAC', 0, false, 'Store keys + alarm code', 'Only for staff who open or close the store.', { asset: 'key', naHint: 'Does not open or close the store' }),
        I('FAC', -7, false, 'Uniform and name badge ordered'),
        I('MGR', -3, true, 'First-day plan sent to the person'),
        I('MGR', -3, false, 'Buddy assigned'),
        I('MGR', 0, true, 'Day 1: welcome, store tour, house rules', '', { key: true }),
        I('SELF', 3, true, 'Read the store handbook and sign the policies'),
        I('MGR', 14, true, 'Product training: frames, lenses, contact lenses'),
        I('MGR', 14, false, 'Eye-exam equipment training (autorefractor, slit lamp)', 'For optometrists and contact lens specialists.', { onlyRoles: ['Optometrist', 'Contact lens specialist'] }),
        I('PAY', 20, true, 'Added to the first payroll run', '', { skipFor: SKIP_PAY }),
        I('MGR', 30, true, 'Probation review (+30 days)', '', { key: true }),
        I('MGR', 90, true, 'Probation review (+90 days)', '', { key: true })
      ]) },
      { id: 'T-office', name: 'Joiner – head office', type: 'joiner', kinds: ['office'], items: hrStart().concat([
        I('HR', 0, true, 'Safety at work training (varstvo pri delu) + fire safety'),
        I('IT', -5, true, 'Laptop prepared and issued (asset tag)', 'Standard image, BitLocker on, asset tag recorded here.', { asset: 'laptop' }),
        I('IT', -5, false, 'Company phone issued (asset tag)', '', { asset: 'phone', naHint: 'No company phone for this role' }),
        I('IT', -3, true, 'Microsoft 365 account + licence', 'Office staff get Microsoft 365 Business Standard; heads of department Business Premium.', { licence: 'assign', key: true }),
        I('IT', -2, false, 'E-mail groups and shared mailboxes'),
        I('IT', -2, true, 'ERP / shop admin access (role-based)', 'Request the role from the system owner; no shared logins.'),
        I('IT', -1, false, 'Teams and SharePoint team sites'),
        I('IT', 0, true, 'MFA set up with the person'),
        I('FAC', -1, true, 'Codeks time-attendance card issued', '', { asset: 'card' }),
        I('FAC', 0, false, 'Office key fob', '', { asset: 'key', naHint: 'Works office hours only' }),
        I('MGR', -3, true, 'First-day plan sent to the person'),
        I('MGR', -3, false, 'Buddy assigned'),
        I('MGR', 0, true, 'Day 1: welcome, intro to the team', '', { key: true }),
        I('SELF', 5, true, 'IT security e-learning completed'),
        I('MGR', 10, false, 'Intro meetings: finance, purchasing, e-commerce, warehouse'),
        I('MGR', 14, false, 'Product basics: frames, lenses, contact lenses'),
        I('PAY', 20, true, 'Added to the first payroll run', '', { skipFor: SKIP_PAY }),
        I('MGR', 30, true, 'Probation review (+30 days)', '', { key: true }),
        I('MGR', 90, true, 'Probation review (+90 days)', '', { key: true })
      ]) },
      { id: 'T-wh', name: 'Joiner – warehouse', type: 'joiner', kinds: ['warehouse'], items: hrStart('Includes fitness for lifting and shift work. File fit / not fit only.').concat([
        I('HR', 0, true, 'Warehouse safety induction: lifting, racking, pallet truck', 'Signed attendance sheet; no forklift without a valid licence.'),
        I('IT', -2, true, 'Microsoft 365 account + licence', 'Warehouse staff get Microsoft 365 F3.', { licence: 'assign', key: true }),
        I('IT', -1, true, 'WMS / ERP picking login'),
        I('IT', 0, false, 'Handheld scanner issued (asset tag)', '', { asset: 'scanner', naHint: 'Uses a pool scanner' }),
        I('IT', 0, false, 'MFA set up with the person'),
        I('FAC', -1, true, 'Codeks time-attendance card issued', '', { asset: 'card' }),
        I('FAC', -5, true, 'Safety shoes and work clothes'),
        I('MGR', 0, true, 'Day 1: welcome and shift plan', '', { key: true }),
        I('MGR', 0, true, 'Buddy assigned for the first two weeks'),
        I('MGR', 5, true, 'Picking and packing training: frames, lenses, contact lenses'),
        I('MGR', 10, false, 'Lens lab training (edging, fitting)', '', { onlyRoles: ['Lens lab technician'] }),
        I('PAY', 20, true, 'Added to the first payroll run', '', { skipFor: SKIP_PAY }),
        I('MGR', 30, true, 'Probation review (+30 days)', '', { key: true }),
        I('MGR', 90, true, 'Probation review (+90 days)', '', { key: true })
      ]) },
      { id: 'T-cc', name: 'Joiner – call centre', type: 'joiner', kinds: ['callcentre'], items: hrStart().concat([
        I('HR', 0, true, 'Safety at work training (varstvo pri delu) + fire safety'),
        I('IT', -3, true, 'Microsoft 365 account + licence', 'Agents get Microsoft 365 Business Basic.', { licence: 'assign', key: true }),
        I('IT', -2, true, 'Contact-centre phone and chat login'),
        I('IT', -2, true, 'ERP order lookup access (read-only)'),
        I('IT', -1, false, 'Headset issued'),
        I('IT', 0, true, 'MFA set up with the person'),
        I('FAC', -1, true, 'Codeks time-attendance card issued', '', { asset: 'card' }),
        I('MGR', -3, true, 'First-day plan sent to the person'),
        I('MGR', 0, true, 'Day 1: welcome, systems tour', '', { key: true }),
        I('MGR', 0, false, 'Buddy assigned'),
        I('SELF', 3, true, 'Read the customer-service scripts and the GDPR guide'),
        I('MGR', 5, true, 'Product training: contact lenses, glasses orders, returns'),
        I('MGR', 10, true, 'Shadowing: 20 calls with a senior agent'),
        I('PAY', 20, true, 'Added to the first payroll run', '', { skipFor: SKIP_PAY }),
        I('MGR', 30, true, 'Probation review (+30 days)', '', { key: true }),
        I('MGR', 90, true, 'Probation review (+90 days)', '', { key: true })
      ]) },
      { id: 'T-leave', name: 'Leaver – any', type: 'leaver', kinds: [], items: [
        I('HR', -20, true, 'Resignation or termination documented'),
        I('HR', -15, true, 'Last day confirmed with payroll and the manager'),
        I('MGR', -10, true, 'Handover plan agreed'),
        I('HR', -2, false, 'Exit interview', 'Short, voluntary. Summarise themes only, no names of colleagues.', { naHint: 'Declined by the person' }),
        I('SELF', -1, false, 'Uniform and name badge returned', '', { naHint: 'Office role: no uniform' }),
        I('MGR', 0, true, 'Last-day handover done', '', { key: true }),
        I('IT', 0, true, 'Disable accounts on the last day at 17:00', 'Block sign-in, revoke sessions and reset MFA at 17:00 Ljubljana time. Demo: ticking only records the step; nothing changes in Microsoft 365.', { key: true }),
        I('IT', 0, true, 'Remove from POS, ERP and shop admin'),
        I('IT', 0, true, 'Collect laptop / phone / tablet / scanner', 'Check the asset tags against the register. Wipe before re-issuing.', { collect: ['laptop', 'phone', 'tablet', 'scanner'] }),
        I('FAC', 0, true, 'Collect keys and the Codeks card', '', { collect: ['key', 'card'] }),
        I('FAC', 0, false, 'Alarm code changed or removed', '', { naHint: 'Had no alarm code' }),
        I('IT', 1, true, 'Remove the Microsoft 365 licence', 'Frees the licence for the next joiner.', { licence: 'remove', key: true }),
        I('IT', 1, false, 'Mailbox converted to shared, forwarded to the manager for 90 days'),
        I('HR', 1, true, 'Deregistered from social insurance', 'Slovenia: M-2 form. Croatia: HZZO / HZMO.', { skipFor: SKIP_INS }),
        I('PAY', 10, true, 'Final payroll incl. unused leave', '', { key: true, skipFor: SKIP_PAY }),
        I('HR', 14, false, 'Reference letter sent', '', { naHint: 'Not requested' })
      ] },
      { id: 'T-move', name: 'Move between stores', type: 'change', kinds: ['store'], items: [
        I('HR', -10, true, 'Transfer letter / contract annex signed'),
        I('PAY', -5, true, 'New cost centre from the effective date', 'Cost centre only; no amounts in this app.'),
        I('IT', -2, true, 'POS access moved to the new store'),
        I('IT', -2, false, 'E-mail groups and Teams channel switched'),
        I('FAC', -1, true, 'Codeks card re-linked to the new store place'),
        I('FAC', 0, false, 'Keys for the old store returned', '', { collect: ['key'], naHint: 'Had no keys' }),
        I('FAC', 0, false, 'Keys + alarm code for the new store', '', { asset: 'key', naHint: 'Does not open or close the store' }),
        I('MGR', -1, true, 'Handover from the old store manager'),
        I('MGR', 0, true, 'Welcome in the new store', '', { key: true }),
        I('MGR', 30, false, 'Check-in after 30 days')
      ] },
      { id: 'T-role', name: 'Role or team change', type: 'change', kinds: [], items: [
        I('HR', -10, true, 'Contract annex for the new role signed'),
        I('PAY', -5, true, 'Payroll updated: role and cost centre', 'No amounts in this app.'),
        I('IT', -2, true, 'Access review: remove what the old role needed'),
        I('IT', -2, true, 'Access for the new role (ERP, shop admin, shared mailboxes)'),
        I('IT', -1, false, 'Licence change if needed', '', { licence: 'change', naHint: 'Same licence' }),
        I('MGR', 0, true, 'New role briefing and goals', '', { key: true }),
        I('MGR', 14, true, 'Training for the new role'),
        I('MGR', 60, false, 'Review in the new role (+60 days)')
      ] }
    ];
    T.forEach(function (t) { t.items.forEach(function (it, i) { it.id = t.id + '-' + (i + 1); }); t.seq = t.items.length; });
    return T;
  }

  /* Generate the concrete tasks of a case from a template. ctx = { role, contract, now, newId } */
  function buildTasks(tpl, anchor, ctx) {
    return tpl.items.map(function (it) {
      var t = { id: ctx.newId(), title: it.title, team: it.team, offset: it.offset, due: dueFor(anchor, it.offset), required: !!it.required, text: it.text || '',
        status: 'todo', reason: '', by: '', at: '', note: '' };
      ['key', 'asset', 'licence', 'naHint'].forEach(function (k) { if (it[k]) t[k] = it[k]; });
      if (it.collect) t.collect = it.collect.slice();
      if (it.onlyRoles && it.onlyRoles.length && it.onlyRoles.indexOf(ctx.role) < 0) { t.status = 'na'; t.reason = 'Not relevant for ' + ctx.role + ' (template rule)'; t.by = 'Template rule'; t.at = ctx.now; }
      else if (it.skipFor && it.skipFor[ctx.contract]) { t.status = 'na'; t.reason = it.skipFor[ctx.contract] + ' (template rule)'; t.by = 'Template rule'; t.at = ctx.now; }
      return t;
    });
  }

  var SI_FIRST = ['Ana', 'Maja', 'Nina', 'Eva', 'Sara', 'Urška', 'Katja', 'Mojca', 'Špela', 'Tjaša', 'Lara', 'Neža', 'Manca', 'Zala', 'Jan', 'Žiga', 'Rok', 'Nejc', 'Gašper', 'Blaž', 'Miha', 'Anže', 'Tilen', 'Jure', 'Aljaž', 'Domen', 'Primož', 'Klemen'];
  var SI_LAST = ['Novak', 'Kovačič', 'Krajnc', 'Zupančič', 'Potočnik', 'Kovač', 'Mlakar', 'Kos', 'Turk', 'Božič', 'Kralj', 'Korošec', 'Bizjak', 'Hribar', 'Kavčič', 'Rozman', 'Žagar', 'Kolar', 'Oblak', 'Rupnik', 'Jereb', 'Sever', 'Logar', 'Pirc'];
  var HR_FIRST = ['Ana', 'Petra', 'Marija', 'Lucija', 'Mia', 'Ema', 'Katarina', 'Martina', 'Iva', 'Dora', 'Ivan', 'Marko', 'Josip', 'Filip', 'Matej', 'Tomislav', 'Ante', 'Karlo', 'Dario', 'Nikola'];
  var HR_LAST = ['Horvat', 'Kovačević', 'Marić', 'Jurić', 'Novak', 'Kovačić', 'Knežević', 'Vuković', 'Marković', 'Matić', 'Tomić', 'Pavlović', 'Božić', 'Blažević', 'Grgić', 'Šarić', 'Lončar', 'Radić'];

  function fold(s) { return String(s).toLowerCase().replace(/đ/g, 'd').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, ''); }

  function generate(today) {
    var R = rng(0x0B0A2D17);
    function int(a, b) { return a + Math.floor(R() * (b - a + 1)); }
    function pick(a) { return a[Math.floor(R() * a.length)]; }
    function chance(p) { return R() < p; }
    var LOC = {}; LOCATIONS.forEach(function (l) { LOC[l.id] = l; });

    var seq = { person: 0, kase: 0, task: 0, asset: 0, log: 0, tag: {} };
    var caseNoByYear = {};
    var templates = makeTemplates(), TPL = {};
    templates.forEach(function (t) { TPL[t.id] = t; });
    var people = [], cases = [], assets = [], P = {};
    var usedName = {}, usedEmail = {};

    function ts(d, h, m) { return d + 'T' + pad(h) + ':' + pad(m == null ? int(0, 59) : m); }
    function workTs(d) { return d === today ? ts(d, int(7, 8)) : ts(d, int(8, 16)); }
    function emailFor(first, last) {
      var base = fold(first) + '.' + fold(last), e = base + '@example.com', n = 2;
      while (usedEmail[e]) e = base + (n++) + '@example.com';
      usedEmail[e] = 1; return e;
    }
    function newName(country) {
      for (var i = 0; i < 400; i++) {
        var f = pick(country === 'HR' ? HR_FIRST : SI_FIRST), l = pick(country === 'HR' ? HR_LAST : SI_LAST);
        if (!usedName[f + ' ' + l]) { usedName[f + ' ' + l] = 1; return [f, l]; }
      }
      return ['Demo', 'Person ' + (seq.person + 1)];
    }
    function addPerson(o) {
      var nm = o.name ? o.name.split(' ') : newName(LOC[o.loc].country);
      usedName[nm.join(' ')] = 1;
      var p = { id: 'p' + (++seq.person), first: nm[0], last: nm.slice(1).join(' '), email: emailFor(nm[0], nm.slice(1).join(' ')), company: LOC[o.loc].company, loc: o.loc,
        role: o.role, manager: o.manager || '', contract: o.contract || 'permanent', licence: o.licence === undefined ? licenceFor(LOC[o.loc].kind, o.role) : o.licence,
        status: o.status || 'active', start: o.start, end: '' };
      people.push(p); P[p.id] = p; return p;
    }
    function fullName(p) { return p.first + ' ' + p.last; }

    // ── assets ─────────────────────────────────────────────────────────────
    function newTag(type, loc) {
      var A = ASSET_TYPES[type];
      if (type === 'key') { seq.tag[loc] = (seq.tag[loc] || 0) + 1; return A.prefix + LOC[loc].code + '-' + pad(seq.tag[loc]); }
      seq.tag[type] = (seq.tag[type] || 0) + 1;
      return A.prefix + (type === 'card' ? String(10400 + seq.tag[type] * 7) : ('0000' + (100 + seq.tag[type])).slice(-4));
    }
    function newAsset(type, loc, at, model) {
      var a = { id: 'a' + (++seq.asset), tag: newTag(type, loc), type: type, model: model || (type === 'key' ? (LOC[loc].kind === 'store' ? ASSET_TYPES.key.models[0] : ASSET_TYPES.key.models[1]) : pick(ASSET_TYPES[type].models)),
        status: 'stock', holder: null, loc: loc, since: at.slice(0, 10), note: '', history: [{ at: at, action: 'added', personId: null, by: type === 'card' || type === 'key' ? 'Janez Vidmar' : 'Marko Kranjc', note: '' }] };
      assets.push(a); return a;
    }
    function lastAt(a) { return a.history[a.history.length - 1].at; }
    function issue(a, p, at, by, caseId, loc) {
      a.status = 'issued'; a.holder = p.id; a.loc = loc || p.loc; a.since = at.slice(0, 10);
      a.history.push({ at: at, action: 'issued', personId: p.id, by: by, note: '', caseId: caseId || null });
    }
    function giveNew(type, p, d, by) { var a = newAsset(type, p.loc, ts(addDays(d, -int(2, 6)), int(9, 15)), null); issue(a, p, ts(d, int(8, 11)), by); return a; }
    function takeStock(type, loc, at) {
      var cand = assets.filter(function (a) { return a.type === type && a.status === 'stock' && lastAt(a) < at && (type !== 'key' || a.loc === loc); });
      cand.sort(function (x, y) { return (x.loc === loc ? 0 : 1) - (y.loc === loc ? 0 : 1) || (x.id < y.id ? -1 : 1); });
      return cand[0] || null;
    }
    function returnAsset(a, at, by, caseId) {
      var p = P[a.holder];
      a.history.push({ at: at, action: 'returned', personId: a.holder, by: by, note: '', caseId: caseId || null });
      a.status = 'stock'; a.holder = null; a.since = at.slice(0, 10);
      if (p && (a.type === 'laptop' || a.type === 'phone') && chance(0.12)) {
        a.history.push({ at: ts(addDays(at.slice(0, 10), int(1, 5)), 11), action: 'retired', personId: null, by: 'Marko Kranjc', note: 'Old device, battery worn: retired after return' });
        a.status = 'retired';
      }
    }

    // ── staff register before the 12-month window ──────────────────────────
    var mgrs = {};
    var HEADS = { SI: 'Barbara Lesjak', HR: 'Kristina Lovrić' };
    function pastStart() { return addDays(today, -int(420, 3600)); }
    LOCATIONS.forEach(function (L) {
      var people0 = [];
      function add(role, o) {
        o = o || {};
        var st = o.start || pastStart();
        var p = addPerson({ loc: L.id, role: role, name: o.name, manager: o.manager, contract: o.contract || (L.kind === 'warehouse' && chance(0.2) ? 'agency' : L.kind !== 'office' && chance(0.08) ? 'student' : chance(0.15) ? 'fixed' : 'permanent'), start: st });
        people0.push(p); return p;
      }
      var boss, m;
      if (L.id === 'HQ') {
        var dir = add('Operations director', { name: 'Matej Zorko', contract: 'permanent' });
        add('Head of retail', { name: HEADS.SI, manager: 'Matej Zorko', contract: 'permanent' });
        var fin = add('Head of finance', { manager: 'Matej Zorko', contract: 'permanent' });
        var ecom = add('Head of e-commerce', { manager: 'Matej Zorko', contract: 'permanent' });
        mgrs.HQ = [fullName(fin), fullName(ecom), 'Matej Zorko'];
        add('HR generalist', { name: 'Tina Zupan', manager: 'Matej Zorko', contract: 'permanent' });
        add('IT support', { name: 'Marko Kranjc', manager: 'Matej Zorko', contract: 'permanent' });
        add('Payroll specialist', { name: 'Petra Golob', manager: fullName(fin), contract: 'permanent' });
        add('Facilities coordinator', { name: 'Janez Vidmar', manager: 'Matej Zorko', contract: 'permanent' });
        dir.manager = '';
        for (var i = 0; i < 8; i++) add(pick(['Finance accountant', 'Buyer', 'Marketing specialist', 'E-commerce specialist', 'Data analyst']), { manager: pick(mgrs.HQ.slice(0, 2)) });
      } else if (L.id === 'ZGO') {
        m = add('Country manager', { manager: 'Matej Zorko', contract: 'permanent' });
        add('Head of retail', { name: HEADS.HR, manager: fullName(m), contract: 'permanent' });
        mgrs.ZGO = [fullName(m)];
        add('HR generalist', { name: 'Ivana Perić', manager: fullName(m), contract: 'permanent' });
        add('IT support', { name: 'Luka Babić', manager: fullName(m), contract: 'permanent' });
        add('Finance accountant', { manager: fullName(m) });
      } else if (L.kind === 'store') {
        boss = HEADS[L.country];
        m = add('Store manager', { manager: boss, contract: 'permanent' });
        mgrs[L.id] = [fullName(m)];
        add('Optometrist', { manager: fullName(m) });
        var n = int(3, 4);
        for (var j = 0; j < n; j++) add(pick(['Optician', 'Optician', 'Sales assistant', 'Contact lens specialist']), { manager: fullName(m) });
      } else if (L.kind === 'warehouse') {
        m = add('Warehouse manager', { manager: 'Matej Zorko', contract: 'permanent' });
        var lead = add('Warehouse shift lead', { manager: fullName(m), contract: 'permanent' });
        mgrs.WH = [fullName(m), fullName(lead)];
        add('Logistics coordinator', { manager: fullName(m) });
        for (var k = 0; k < 9; k++) add(pick(['Warehouse operative', 'Warehouse operative', 'Picker / packer', 'Lens lab technician']), { manager: pick(mgrs.WH) });
      } else {
        m = add('Customer service manager', { manager: 'Matej Zorko', contract: 'permanent' });
        var tl = add('Customer service team lead', { manager: fullName(m), contract: 'permanent' });
        mgrs.CC = [fullName(m), fullName(tl)];
        for (var q = 0; q < 8; q++) add(pick(['Customer service agent', 'Customer service agent', 'Live-chat agent']), { manager: pick(mgrs.CC) });
      }
      // their equipment
      var by = function (t) { return t === 'card' || t === 'key' ? 'Janez Vidmar' : (L.country === 'HR' ? 'Luka Babić' : 'Marko Kranjc'); };
      people0.forEach(function (p, idx) {
        var d = p.start, isBoss = /manager|Head of|director|lead/i.test(p.role);
        giveNew('card', p, d, by('card'));
        if (L.kind === 'office') { giveNew('laptop', p, d, by('laptop')); giveNew('key', p, d, by('key')); if (isBoss || chance(0.35)) giveNew('phone', p, d, by('phone')); }
        if (L.kind === 'store') {
          if (isBoss) { giveNew('key', p, d, by('key')); giveNew('phone', p, d, by('phone')); giveNew('tablet', p, d, by('tablet')); }
          else if (idx === 1) giveNew('key', p, d, by('key'));
        }
        if (L.kind === 'warehouse') {
          if (isBoss || p.role === 'Logistics coordinator') giveNew('laptop', p, d, by('laptop'));
          else if (chance(0.55)) giveNew('scanner', p, d, by('scanner'));
          if (p.role === 'Warehouse manager') giveNew('key', p, d, by('key'));
        }
        if (L.kind === 'callcentre' && isBoss) giveNew('laptop', p, d, by('laptop'));
      });
    });
    // spares in stock
    var stockDay = addDays(today, -int(380, 420));
    [['laptop', 'HQ', 4], ['phone', 'HQ', 3], ['tablet', 'HQ', 2], ['scanner', 'WH', 3], ['card', 'HQ', 12], ['card', 'ZGO', 6]].forEach(function (s) {
      for (var i = 0; i < s[2]; i++) newAsset(s[0], s[1], ts(stockDay, int(9, 15)), null);
    });
    LOCATIONS.forEach(function (L) { if (L.kind === 'store') newAsset('key', L.id, ts(stockDay, 10), null); });
    for (var r = 0; r < 3; r++) {
      var old = newAsset('laptop', 'HQ', ts(addDays(today, -int(1500, 2000)), 10), 'Lenovo ThinkPad E14');
      var rd = addDays(today, -int(60, 300));
      old.history.push({ at: ts(rd, 11), action: 'retired', personId: null, by: 'Marko Kranjc', note: 'End of life (5 years)' }); old.status = 'retired'; old.since = rd;
    }

    // ── cases ──────────────────────────────────────────────────────────────
    var KIND_LOCS = {}; LOCATIONS.forEach(function (l) { (KIND_LOCS[l.kind] = KIND_LOCS[l.kind] || []).push(l.id); });
    var SPECIAL = ['Tina Zupan', 'Ivana Perić', 'Marko Kranjc', 'Luka Babić', 'Petra Golob', 'Janez Vidmar', 'Matej Zorko', HEADS.SI, HEADS.HR];
    function isSpecial(p) {
      var n = fullName(p);
      if (SPECIAL.indexOf(n) >= 0) return true;
      return Object.keys(mgrs).some(function (k) { return mgrs[k].indexOf(n) >= 0; });
    }
    function who(team, c) {
      var hr = LOC[c.loc].country === 'HR';
      if (team === 'HR') return hr ? 'Ivana Perić' : 'Tina Zupan';
      if (team === 'IT') return hr ? 'Luka Babić' : 'Marko Kranjc';
      if (team === 'PAY') return 'Petra Golob';
      if (team === 'FAC') return 'Janez Vidmar';
      if (team === 'MGR') return c.manager || 'Manager';
      return fullName(P[c.personId]);
    }
    function log(c, at, who2, text) { c.log.push({ id: 'l' + (++seq.log), at: at, by: who2, text: text }); }
    var openPeople = {};

    var JOIN_KIND = ['store', 'store', 'store', 'store', 'store', 'warehouse', 'warehouse', 'callcentre', 'callcentre', 'office'];
    function joinerRole(kind) {
      if (kind === 'store') return pick(['Optician', 'Optician', 'Optometrist', 'Sales assistant', 'Sales assistant', 'Contact lens specialist']);
      if (kind === 'warehouse') return pick(['Warehouse operative', 'Picker / packer', 'Picker / packer', 'Lens lab technician']);
      if (kind === 'callcentre') return pick(['Customer service agent', 'Customer service agent', 'Live-chat agent']);
      return pick(['Finance accountant', 'Buyer', 'Marketing specialist', 'E-commerce specialist', 'Data analyst']);
    }
    function joinerContract(kind) {
      var x = R();
      if (kind === 'warehouse') return x < 0.35 ? 'agency' : x < 0.65 ? 'fixed' : 'permanent';
      if (kind === 'store' || kind === 'callcentre') return x < 0.15 ? 'student' : x < 0.55 ? 'fixed' : 'permanent';
      return x < 0.3 ? 'fixed' : 'permanent';
    }
    var PROMO = { 'Sales assistant': 'Optician', 'Optician': 'Contact lens specialist', 'Customer service agent': 'Customer service team lead', 'Live-chat agent': 'Customer service agent',
      'Picker / packer': 'Warehouse operative', 'Warehouse operative': 'Warehouse shift lead', 'Finance accountant': 'Buyer', 'Data analyst': 'E-commerce specialist' };

    function pDone(due) {
      var d = diff(due, today);
      if (d > 7) return 0.93; if (d >= 1) return 0.7; if (d === 0) return 0.45; if (d >= -5) return 0.2; return 0.04;
    }

    function makeCase(spec) {
      var anchor = spec.anchor, type = spec.type, p, loc, role, toLoc = null, toRole = null, tplId;
      if (type === 'joiner') {
        loc = spec.loc || pick(KIND_LOCS[spec.kind]);
        role = joinerRole(LOC[loc].kind);
        p = addPerson({ loc: loc, role: role, manager: mgrs[loc][0], contract: joinerContract(LOC[loc].kind), start: anchor, status: anchor > today ? 'joining' : 'active', licence: null });
        tplId = { store: 'T-store', office: 'T-office', warehouse: 'T-wh', callcentre: 'T-cc' }[LOC[loc].kind];
      } else {
        var cand = people.filter(function (x) {
          if (x.status !== 'active' || openPeople[x.id] || isSpecial(x) || diff(x.start, anchor) < 60) return false;
          if (type === 'change' && spec.sub === 'move') return LOC[x.loc].kind === 'store' && x.role !== 'Store manager';
          if (type === 'change') return !!PROMO[x.role];
          return !spec.kind || LOC[x.loc].kind === spec.kind;
        });
        if (!cand.length) return null;
        p = pick(cand); loc = p.loc; role = p.role;
        if (type === 'leaver') tplId = 'T-leave';
        else if (spec.sub === 'move') {
          var others = KIND_LOCS.store.filter(function (l) { return l !== loc && LOC[l].country === LOC[loc].country; });
          toLoc = pick(others); toRole = role; tplId = 'T-move';
        } else { toLoc = loc; toRole = PROMO[role]; tplId = 'T-role'; }
      }
      var lead = type === 'joiner' ? int(18, 35) : type === 'leaver' ? int(22, 40) : int(12, 25);
      var cDay = addDays(anchor, -lead); if (cDay > today) cDay = today;
      var created = cDay === today ? ts(today, 7, int(0, 30)) : ts(cDay, int(8, 15));
      var yr = cDay.slice(0, 4); caseNoByYear[yr] = (caseNoByYear[yr] || 0) + 1;
      var c = { id: 'c' + (++seq.kase), no: 'JL-' + yr + '-' + ('00' + caseNoByYear[yr]).slice(-3), type: type, personId: p.id, date: anchor,
        company: LOC[loc].company, loc: loc, role: role, manager: p.manager, contract: p.contract, toLoc: toLoc, toRole: toRole,
        templateId: tplId, templateName: TPL[tplId].name, status: 'open', created: created, closedAt: '', override: null,
        licencePlan: type === 'joiner' ? licenceFor(LOC[loc].kind, role) : type === 'change' ? licenceFor(LOC[toLoc].kind, toRole) : null, licenceFreed: null, tasks: [], log: [] };
      if (type === 'change' && toLoc !== loc) c.manager = mgrs[toLoc][0];
      c.tasks = buildTasks(TPL[tplId], anchor, { role: type === 'change' ? toRole : role, contract: c.contract, now: created, newId: function () { return 't' + (++seq.task); } });
      var creator = who('HR', c);
      log(c, created, creator, 'Case created from template “' + c.templateName + '” · ' + c.tasks.length + ' tasks');
      c.tasks.forEach(function (t) { if (t.status === 'na') log(c, created, 'Template rule', 'Not needed: ' + t.title + ' (' + t.reason.replace(' (template rule)', '') + ')'); });

      // settle the task statuses
      var cDate = created.slice(0, 10);
      c.tasks.forEach(function (t) {
        if (t.status !== 'todo') return;
        if (spec.keepOpen && (t.collect || (spec.keepOpenAll && t.required && t.offset >= 0))) return;
        var finished = !!spec.finished;
        if (!t.required && chance(0.2) && (finished || t.due <= addDays(today, 3))) {
          t.status = 'na'; t.reason = t.naHint || (t.asset ? 'Not relevant for this role' : pick(['Not relevant for this role', 'Already done earlier']));
        } else if (finished || chance(pDone(t.due))) {
          t.status = 'done';
        } else return;
        var d = addDays(t.due, int(-3, 1));
        if (d < cDate) d = cDate;
        if (d > today) d = today;
        if (finished && d >= today) d = addDays(today, -1);
        t.at = workTs(d); if (t.at < created) t.at = created.slice(0, 11) + pad(Math.min(23, +created.slice(11, 13) + 1)) + ':05';
        t.by = who(t.team, c);
      });
      // side effects in time order
      var done = c.tasks.filter(function (t) { return t.status !== 'todo' && t.by !== 'Template rule'; }).sort(function (a, b) { return a.at < b.at ? -1 : 1; });
      done.forEach(function (t) {
        if (t.status === 'na') { log(c, t.at, t.by, 'Not needed: ' + t.title + ' (' + t.reason + ')'); return; }
        log(c, t.at, t.by, 'Done: ' + t.title);
        if (t.asset && t.status === 'done') {
          var a = takeStock(t.asset, type === 'change' ? toLoc : loc, t.at);
          if (!a) a = newAsset(t.asset, type === 'change' ? toLoc : loc, ts(addDays(t.at.slice(0, 10), -int(2, 5)), 10), null);
          issue(a, p, t.at, t.by, c.id, type === 'change' ? toLoc : loc); t.assetId = a.id;
          log(c, t.at, t.by, 'Issued ' + atl(a.type) + ' ' + a.tag);
        }
        if (t.collect) {
          assets.filter(function (a2) { return a2.holder === p.id && t.collect.indexOf(a2.type) >= 0; }).forEach(function (a2) {
            if (type === 'change' && a2.type === 'key' && a2.loc !== loc) return;
            returnAsset(a2, t.at, t.by, c.id);
            log(c, t.at, t.by, 'Returned ' + atl(a2.type) + ' ' + a2.tag);
          });
        }
        if (t.licence === 'assign') { p.licence = c.licencePlan; log(c, t.at, t.by, 'Licence assigned: ' + LICENCES[c.licencePlan].name); }
        if (t.licence === 'change') { if (p.licence !== c.licencePlan) log(c, t.at, t.by, 'Licence changed: ' + (LICENCES[p.licence] ? LICENCES[p.licence].name : 'none') + ' → ' + LICENCES[c.licencePlan].name); p.licence = c.licencePlan; }
        if (t.licence === 'remove' && p.licence) { c.licenceFreed = { code: p.licence, at: t.at }; log(c, t.at, t.by, 'Licence freed: ' + LICENCES[p.licence].name + ' (≈ ' + LICENCES[p.licence].eur.toFixed(2).replace('.', ',') + ' €/month)'); p.licence = null; }
      });
      if (spec.finished) {
        var last = done.length ? done[done.length - 1].at.slice(0, 10) : anchor;
        var cl = addDays(last, int(0, 2)); if (cl >= today) cl = addDays(today, -1);
        c.status = 'closed'; c.closedAt = ts(cl, int(9, 16));
        if (done.length && c.closedAt < done[done.length - 1].at) c.closedAt = done[done.length - 1].at;
        if (spec.override) {
          var held = assets.filter(function (a3) { return a3.holder === p.id; }), lost = [];
          held.forEach(function (a3) {
            if (a3.type === 'card' || a3.type === 'key') { returnAsset(a3, c.closedAt, who('FAC', c), c.id); log(c, c.closedAt, who('FAC', c), 'Returned ' + atl(a3.type) + ' ' + a3.tag); return; }
            a3.history.push({ at: c.closedAt, action: 'lost', personId: p.id, by: who('IT', c), note: 'Not returned by the leaver; written off', caseId: c.id });
            a3.status = 'lost'; a3.holder = null; a3.since = c.closedAt.slice(0, 10); lost.push(ASSET_TYPES[a3.type].label + ' ' + a3.tag);
            log(c, c.closedAt, who('IT', c), 'Marked lost: ' + atl(a3.type) + ' ' + a3.tag);
          });
          var reason = lost.length ? lost.join(', ') + ' not returned after several reminders. ' + spec.override : 'Person unreachable after the last day. ' + spec.override;
          c.override = { reason: reason, by: who('HR', c), at: c.closedAt };
          log(c, c.closedAt, who('HR', c), 'Closed with override: ' + reason);
        } else log(c, c.closedAt, who('HR', c), 'Case closed');
        if (type === 'leaver') { p.status = 'left'; p.end = anchor; }
        if (type === 'change') { p.loc = toLoc; p.role = toRole; p.company = LOC[toLoc].company; p.manager = c.manager; assets.forEach(function (a4) { if (a4.holder === p.id) a4.loc = toLoc; }); }
        if (type === 'joiner') p.status = 'active';
      } else {
        openPeople[p.id] = c.id;
        if (type === 'leaver') { p.status = 'leaving'; p.end = anchor; }
      }
      c.log.sort(function (a, b) { return a.at < b.at ? -1 : a.at > b.at ? 1 : 0; });
      cases.push(c);
      return c;
    }

    var specs = [];
    for (var i1 = 0; i1 < 27; i1++) specs.push({ type: 'joiner', kind: pick(JOIN_KIND), anchor: workday(addDays(today, -int(100, 362)), 1), finished: true });
    for (var i2 = 0; i2 < 23; i2++) specs.push({ type: 'leaver', anchor: workday(addDays(today, -int(22, 355)), -1), finished: true, override: i2 === 4 ? 'Written off with IT; agreed with payroll.' : i2 === 15 ? 'Written off; insurance claim filed.' : null, keepOpen: i2 === 4 || i2 === 15 });
    for (var i3 = 0; i3 < 10; i3++) specs.push({ type: 'change', sub: i3 % 2 ? 'move' : 'role', anchor: workday(addDays(today, -int(25, 340)), 1), finished: true });
    // open cases: 12 joiners, 8 leavers, 5 changes, spread around today
    [[-50, 'store'], [-36, 'office'], [-23, 'warehouse'], [-12, 'store'], [-8, 'callcentre'], [-3, 'store'], [1, 'store'], [6, 'office'], [9, 'warehouse'], [14, 'store'], [20, 'callcentre'], [27, 'store']]
      .forEach(function (s) { specs.push({ type: 'joiner', kind: s[1], anchor: workday(addDays(today, s[0]), 1), open: true }); });
    [[-10, 'office', 1], [-5, 'store', 1], [-2, 'warehouse', 0], [0, 'callcentre', 0], [4, 'store', 0], [11, 'office', 0], [18, 'store', 0], [25, 'warehouse', 0]]
      .forEach(function (s) { specs.push({ type: 'leaver', kind: s[1], anchor: workday(addDays(today, s[0]), -1), open: true, keepOpen: !!s[2] }); });
    [[-6, 'move'], [-1, 'role'], [5, 'move'], [12, 'role'], [21, 'move']]
      .forEach(function (s) { specs.push({ type: 'change', sub: s[1], anchor: workday(addDays(today, s[0]), 1), open: true }); });
    // finished leavers with an override must actually hold a laptop or phone: give them one if needed
    specs.sort(function (a, b) { return a.anchor < b.anchor ? -1 : a.anchor > b.anchor ? 1 : 0; });
    specs.forEach(function (s) {
      if (s.type === 'leaver' && s.override) {
        s.kind = 'office';
      }
      makeCase(s);
    });

    // open leavers past their last day keep their equipment (blocked); leavers in the future still have theirs anyway.
    return {
      version: VERSION, generatedFor: today, seq: { person: seq.person, kase: seq.kase, task: seq.task, asset: seq.asset, log: seq.log, tag: seq.tag, caseNoByYear: caseNoByYear },
      people: people, cases: cases, assets: assets, templates: templates, mgrs: mgrs
    };
  }

  window.JLData = {
    VERSION: VERSION, COMPANIES: COMPANIES, KINDS: KINDS, LOCATIONS: LOCATIONS, ROLES: ROLES, TEAMS: TEAMS, CONTRACTS: CONTRACTS, LICENCES: LICENCES,
    ASSET_TYPES: ASSET_TYPES, NA_REASONS: NA_REASONS, ACTORS: ACTORS,
    generate: generate, makeTemplates: makeTemplates, buildTasks: buildTasks,
    util: { pad: pad, ymd: ymd, parse: parse, addDays: addDays, dow: dow, diff: diff, workday: workday, dueFor: dueFor, licenceFor: licenceFor, fold: fold }
  };
})();
