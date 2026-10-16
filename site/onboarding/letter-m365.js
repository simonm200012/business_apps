/* Joiners & leavers: the welcome letter (SL / HR / EN) and the simulated "Run in Microsoft 365" plan.
 * Pure functions, no DOM; UMD, so they load in Node (tools/tests/onboarding-letter-m365.test.js).
 *
 *   welcome(ctx, lang)    → the letter as data: place and date, greeting, paragraphs, the first days, what to bring, sign-off
 *   m365Plan(ctx)         → what a connected version would do in Microsoft 365 for this case (create, assign, disable, …),
 *                           each step with the Microsoft Graph call it would make and the checklist items it completes
 *   m365Run(ctx, now)     → which of those steps can run now and which would wait for the last day (scheduled)
 *
 * ctx = { type: 'joiner'|'leaver'|'change', first, last, email, role, toRole, date, loc: {id, short, kind, country},
 *         toLoc (same shape, for a change), company: {name}, manager, managerEmail, hr, licence (name), licencePlan (name),
 *         tasks: [{ id, title, team, offset, status, asset, licence }], time, meet, note, today }
 * Nothing here talks to Microsoft 365: the app only shows the plan and ticks the matching checklist items. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.JLLetter = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function parse(s) { var p = String(s).slice(0, 10).split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); }
  function fmt(s) { return s ? +s.slice(8, 10) + '. ' + +s.slice(5, 7) + '. ' + s.slice(0, 4) : ''; }
  function addDays(s, n) { var d = parse(s); d.setUTCDate(d.getUTCDate() + n); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  var WD = {
    sl: ['nedelja', 'ponedeljek', 'torek', 'sreda', 'četrtek', 'petek', 'sobota'],
    hr: ['nedjelja', 'ponedjeljak', 'utorak', 'srijeda', 'četvrtak', 'petak', 'subota'],
    en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  };
  function wday(s, lang) { return WD[lang][parse(s).getUTCDay()]; }

  // where: the place in the language of the letter (location names in the app are English)
  var PLACE = {
    HQ: { sl: 'na sedežu podjetja v Ljubljani', hr: 'u sjedištu tvrtke u Ljubljani', en: 'at the head office in Ljubljana', city: 'Ljubljana' },
    ZGO: { sl: 'v pisarni v Zagrebu', hr: 'u uredu u Zagrebu', en: 'at the Zagreb office', city: 'Zagreb' },
    WH: { sl: 'v centralnem skladišču v Domžalah', hr: 'u središnjem skladištu u Domžalama', en: 'at the central warehouse in Domžale', city: 'Domžale' },
    CC: { sl: 'v klicnem centru v Ljubljani', hr: 'u kontaktnom centru u Ljubljani', en: 'at the call centre in Ljubljana', city: 'Ljubljana' }
  };
  function where(loc, lang) {
    if (!loc) return '';
    if (PLACE[loc.id]) return PLACE[loc.id][lang];
    var s = loc.short || loc.name || '';
    return lang === 'sl' ? 'v poslovalnici ' + s : lang === 'hr' ? 'u poslovnici ' + s : 'at the ' + s + ' store';
  }
  function city(loc) { return loc ? (PLACE[loc.id] ? PLACE[loc.id].city : String(loc.short || '').replace(/ Center$/, '')) : ''; }
  // job titles in the letter's language (the app keeps them in English); unknown titles stay as typed
  var ROLE = {
    'Optician': ['optik', 'optičar'], 'Optometrist': ['optometrist', 'optometrist'], 'Contact lens specialist': ['specialist za kontaktne leče', 'specijalist za kontaktne leće'],
    'Sales assistant': ['prodajni svetovalec', 'prodajni savjetnik'], 'Store manager': ['vodja poslovalnice', 'voditelj poslovnice'], 'Finance accountant': ['računovodja', 'računovođa'],
    'Buyer': ['nabavni referent', 'referent nabave'], 'Marketing specialist': ['strokovnjak za marketing', 'stručnjak za marketing'], 'E-commerce specialist': ['strokovnjak za spletno prodajo', 'stručnjak za e-trgovinu'],
    'Data analyst': ['podatkovni analitik', 'analitičar podataka'], 'HR generalist': ['kadrovski referent', 'referent za ljudske potencijale'], 'IT support': ['podpora IT', 'IT podrška'],
    'Payroll specialist': ['referent za plače', 'referent za plaće'], 'Facilities coordinator': ['koordinator vzdrževanja', 'koordinator održavanja'], 'Head of finance': ['vodja financ', 'voditelj financija'],
    'Head of e-commerce': ['vodja spletne prodaje', 'voditelj e-trgovine'], 'Head of retail': ['vodja maloprodaje', 'voditelj maloprodaje'], 'Operations director': ['operativni direktor', 'operativni direktor'],
    'Country manager': ['direktor za trg', 'direktor za tržište'], 'Warehouse operative': ['skladiščnik', 'skladištar'], 'Picker / packer': ['komisioner', 'komisionar'],
    'Lens lab technician': ['tehnik v laboratoriju za leče', 'tehničar u laboratoriju za leće'], 'Logistics coordinator': ['koordinator logistike', 'koordinator logistike'],
    'Warehouse shift lead': ['vodja izmene v skladišču', 'voditelj smjene u skladištu'], 'Warehouse manager': ['vodja skladišča', 'voditelj skladišta'],
    'Customer service agent': ['svetovalec za pomoč strankam', 'savjetnik korisničke podrške'], 'Live-chat agent': ['svetovalec v spletnem klepetu', 'savjetnik u chatu'],
    'Customer service team lead': ['vodja ekipe za pomoč strankam', 'voditelj tima korisničke podrške'], 'Customer service manager': ['vodja službe za pomoč strankam', 'voditelj korisničke podrške']
  };
  function roleIn(role, lang) { var r = ROLE[role]; return lang === 'sl' && r ? r[0] : lang === 'hr' && r ? r[1] : lang === 'en' ? String(role || '').toLowerCase() : role || ''; }
  var START = { store: '08:30', office: '08:00', warehouse: '07:00', callcentre: '08:00' };
  function startTime(loc) { return (loc && START[loc.kind]) || '08:00'; }

  var T = {
    sl: {
      heading: 'Dobrodošli v ekipi', hi: function (f) { return 'Dobrodošli, ' + f + '!'; },
      intro: function (x) { return 'veseli smo, da se nam pridružujete na delovnem mestu »' + x.role + '« ' + x.where + '. Vaš prvi delovni dan je ' + x.wd + ', ' + x.date + ', ob ' + x.time + '.'; },
      meet: function (x) { return 'Prvi dan vas sprejme ' + x.manager + (x.meet ? ' (' + x.meet + ')' : '') + '.'; },
      mail: function (e) { return 'Vaš službeni e-poštni naslov bo ' + e + '. Geslo in prijavo z aplikacijo Microsoft Authenticator boste nastavili prvi dan skupaj s sodelavcem iz IT.'; },
      days: 'Vaši prvi dnevi', bring: 'Prinesite s seboj',
      d1: 'Sprejem, ogled delovnega mesta in predstavitev sodelavcev', safety: 'Usposabljanje za varno delo in požarno varnost', it: 'Prijava v Microsoft 365 in nastavitev varne prijave (MFA)',
      eq: function (l) { return 'Prevzem opreme: ' + l; }, week: 'Uvajanje z mentorjem in spoznavanje delovnih postopkov', p30: 'Pogovor po prvem mesecu z vodjo', p90: 'Pogovor ob koncu poskusnega dela',
      day1: 'Prvi dan', firstWeek: 'Prvi teden', after: function (n) { return 'Po ' + n + ' dneh'; },
      id: 'Osebni dokument s fotografijo', med: 'Zdravniško spričevalo o predhodnem pregledu, če ga še niste oddali', pay: 'Izpolnjen obrazec s podatki za izplačilo plače, če ga še niste oddali',
      shoes: 'Udobno obutev; delovno oblačilo in priponko z imenom dobite prvi dan', lunch: 'Malico lahko prinesete s seboj; odmor je del delovnega časa',
      eqNames: { laptop: 'prenosni računalnik', phone: 'službeni telefon', tablet: 'tablica', scanner: 'ročni čitalnik', card: 'kartica za evidenco prisotnosti', key: 'ključi' },
      close: 'Če imate pred začetkom kakršno koli vprašanje, nam pišite ali nas pokličite. Veselimo se sodelovanja!', bye: 'Lep pozdrav,', mgr: 'vodja', hrRole: 'kadrovska služba'
    },
    hr: {
      heading: 'Dobro došli u tim', hi: function (f) { return 'Dobro došli, ' + f + '!'; },
      intro: function (x) { return 'drago nam je što nam se pridružujete na radnom mjestu „' + x.role + '” ' + x.where + '. Vaš prvi radni dan je ' + x.wd + ', ' + x.date + ', u ' + x.time + ' sati.'; },
      meet: function (x) { return 'Prvoga dana dočeka vas ' + x.manager + (x.meet ? ' (' + x.meet + ')' : '') + '.'; },
      mail: function (e) { return 'Vaša službena adresa e-pošte bit će ' + e + '. Lozinku i prijavu putem aplikacije Microsoft Authenticator postavit ćete prvog dana s kolegom iz IT-a.'; },
      days: 'Vaši prvi dani', bring: 'Ponesite sa sobom',
      d1: 'Doček, obilazak radnog mjesta i upoznavanje s kolegama', safety: 'Osposobljavanje za rad na siguran način i zaštitu od požara', it: 'Prijava u Microsoft 365 i postavljanje sigurne prijave (MFA)',
      eq: function (l) { return 'Preuzimanje opreme: ' + l; }, week: 'Uvođenje u posao s mentorom i upoznavanje radnih postupaka', p30: 'Razgovor s voditeljem nakon prvog mjeseca', p90: 'Razgovor na kraju probnog rada',
      day1: 'Prvi dan', firstWeek: 'Prvi tjedan', after: function (n) { return 'Nakon ' + n + ' dana'; },
      id: 'Osobnu iskaznicu ili putovnicu', med: 'Liječničko uvjerenje o prethodnom pregledu, ako ga još niste predali', pay: 'Ispunjen obrazac s podacima za isplatu plaće, ako ga još niste predali',
      shoes: 'Udobnu obuću; radnu odjeću i pločicu s imenom dobit ćete prvog dana', lunch: 'Obrok možete ponijeti sa sobom; stanka je dio radnog vremena',
      eqNames: { laptop: 'prijenosno računalo', phone: 'službeni mobitel', tablet: 'tablet', scanner: 'ručni čitač', card: 'kartica za evidenciju radnog vremena', key: 'ključevi' },
      close: 'Ako prije početka imate bilo kakvo pitanje, slobodno nam se javite. Radujemo se suradnji!', bye: 'Srdačan pozdrav,', mgr: 'voditelj tima', hrRole: 'služba ljudskih potencijala'
    },
    en: {
      heading: 'Welcome to the team', hi: function (f) { return 'Welcome, ' + f + '!'; },
      intro: function (x) { return 'we are glad you are joining us as our new ' + x.role + ' ' + x.where + '. Your first working day is ' + x.wd + ', ' + x.date + ', at ' + x.time + '.'; },
      meet: function (x) { return 'On your first day ' + x.manager + ' will meet you' + (x.meet ? ' (' + x.meet + ')' : '') + '.'; },
      mail: function (e) { return 'Your work e-mail address will be ' + e + '. You will set your password and sign-in with the Microsoft Authenticator app on day 1 with a colleague from IT.'; },
      days: 'Your first days', bring: 'Please bring',
      d1: 'Welcome, a tour of your workplace and meeting the team', safety: 'Health and safety at work and fire safety training', it: 'Signing in to Microsoft 365 and setting up secure sign-in (MFA)',
      eq: function (l) { return 'Your equipment: ' + l; }, week: 'Training with a mentor and learning the way we work', p30: 'A first-month check-in with your manager', p90: 'The end-of-probation review',
      day1: 'Day 1', firstWeek: 'First week', after: function (n) { return 'After ' + n + ' days'; },
      id: 'An ID card or passport', med: 'The pre-employment medical certificate, if you have not handed it in yet', pay: 'The completed payroll details form, if you have not handed it in yet',
      shoes: 'Comfortable shoes; you get your work clothes and name badge on day 1', lunch: 'You may bring a meal; the break counts as working time',
      eqNames: { laptop: 'laptop', phone: 'company phone', tablet: 'tablet', scanner: 'handheld scanner', card: 'attendance card', key: 'keys' },
      close: 'If you have any questions before you start, just write or call us. We look forward to working with you!', bye: 'Kind regards,', mgr: 'Manager', hrRole: 'HR'
    }
  };
  function has(tasks, re) { return (tasks || []).some(function (t) { return t.status !== 'na' && re.test(t.title); }); }
  function open(tasks, re) { return (tasks || []).some(function (t) { return t.status === 'todo' && re.test(t.title); }); }

  /** the welcome letter as data (the app renders and prints it) */
  function welcome(ctx, lang) {
    var L = T[lang] ? T[lang] : T.sl, lg = T[lang] ? lang : 'sl', tasks = ctx.tasks || [], loc = ctx.loc || {};
    var x = { role: roleIn(ctx.role, lg), where: where(loc, lg), wd: wday(ctx.date, lg), date: fmt(ctx.date), time: (ctx.time || startTime(loc)).replace(/^0(\d)/, '$1').replace(':', lg === 'en' ? ':' : '.'),
      manager: ctx.manager || (lg === 'en' ? 'your manager' : lg === 'hr' ? 'vaš voditelj' : 'vaš vodja'), meet: ctx.meet || '' };
    var paras = [L.intro(x), L.meet(x)];
    if (ctx.email) paras.push(L.mail(ctx.email));
    if (ctx.note) paras.push(ctx.note);
    var eqTypes = [];
    tasks.forEach(function (t) { if (t.asset && t.status !== 'na' && t.offset <= 0 && eqTypes.indexOf(t.asset) < 0) eqTypes.push(t.asset); });
    var day1 = [L.d1];
    if (has(tasks, /safety|varstvo pri delu/i)) day1.push(L.safety);
    if (has(tasks, /Microsoft 365 account|MFA/i)) day1.push(L.it);
    if (eqTypes.length) day1.push(L.eq(eqTypes.map(function (k) { return L.eqNames[k] || k; }).join(', ')));
    var sched = [{ when: L.day1 + ' · ' + fmt(ctx.date), items: day1 }, { when: L.firstWeek, items: [L.week] }];
    if (has(tasks, /\+30 days|30 days/i)) sched.push({ when: L.after(30), items: [L.p30] });
    if (has(tasks, /\+90 days|90 days/i)) sched.push({ when: L.after(90), items: [L.p90] });
    var bring = [L.id];
    if (open(tasks, /medical check/i)) bring.push(L.med);
    if (open(tasks, /Payroll data form/i)) bring.push(L.pay);
    if (loc.kind === 'store' || loc.kind === 'warehouse') bring.push(L.shoes);
    bring.push(L.lunch);
    var sign = [];
    if (ctx.manager) sign.push({ name: ctx.manager, role: L.mgr });
    if (ctx.hr) sign.push({ name: ctx.hr, role: L.hrRole });
    return { lang: lg, place: city(loc) + ', ' + fmt(ctx.today), heading: L.heading, company: ctx.company ? ctx.company.name : '', greeting: L.hi(ctx.first || ''),
      paras: paras, schedule: sched, daysTitle: L.days, bringTitle: L.bring, bring: bring, close: L.close, bye: L.bye, sign: sign };
  }
  /** plain text of a letter (for e-mail or copying) */
  function letterText(l) {
    var out = [l.place, '', l.heading, '', l.greeting, ''];
    l.paras.forEach(function (p, i) { out.push(i === 0 ? p.charAt(0).toUpperCase() + p.slice(1) : p); });
    out.push('', l.daysTitle);
    l.schedule.forEach(function (s) { out.push(s.when + ': ' + s.items.join('; ')); });
    out.push('', l.bringTitle);
    l.bring.forEach(function (b) { out.push('- ' + b); });
    out.push('', l.close, '', l.bye);
    l.sign.forEach(function (s) { out.push(s.name + ', ' + s.role); });
    return out.join('\n');
  }

  // ── simulated Microsoft 365 run ─────────────────────────────────────────
  // Each step: what a connected version would do, the Graph call, and which checklist items it completes (by title).
  // `at`: 'now' or 'last' (on the last day at 17:00) or 'after' (the day after the last day).
  var GROUPS = { store: 'Stores', office: 'Head office', warehouse: 'Warehouse', callcentre: 'Customer service' };
  function locGroup(loc) { return loc ? (loc.kind === 'store' ? 'Store ' + (loc.short || '') : GROUPS[loc.kind] || loc.short) : ''; }
  function m365Plan(ctx) {
    var up = ctx.email || '', steps = [], loc = ctx.loc || {}, to = ctx.toLoc || loc, mgr = ctx.manager || '';
    var usage = (ctx.type === 'change' ? to : loc).country || 'SI';
    function S(id, at, text, detail, graph, match) { steps.push({ id: id, at: at, text: text, detail: detail, graph: graph, match: match || null }); }
    if (ctx.type === 'joiner') {
      S('user', 'now', 'Create the user ' + up, ctx.first + ' ' + ctx.last + ' · ' + ctx.role + ' · usage location ' + usage + ' · must change the password at first sign-in', 'POST /users', /Microsoft 365 account/i);
      if (ctx.licencePlan) S('licence', 'now', 'Assign the licence: ' + ctx.licencePlan, 'From the company’s licence pool', 'POST /users/' + up + '/assignLicense', /Microsoft 365 account/i);
      if (mgr) S('manager', 'now', 'Set the manager: ' + mgr, 'For approvals and the org chart', 'PUT /users/' + up + '/manager/$ref');
      S('groups', 'now', 'Add to groups: All staff, ' + locGroup(loc), 'E-mail distribution and the shared calendars', 'POST /groups/{id}/members/$ref', /E-mail groups/i);
      S('teams', 'now', 'Add to the Teams team “' + locGroup(loc) + '”', 'Channels for the location', 'POST /teams/{id}/members', /^Teams/i);
      S('mfa', 'now', 'Require MFA registration at the first sign-in', 'The person registers the Authenticator app with IT on day 1, so this item stays open', 'Conditional Access policy (group membership)');
    } else if (ctx.type === 'leaver') {
      S('block', 'last', 'Block sign-in for ' + up, 'On the last day at 17:00 (Europe/Ljubljana)', 'PATCH /users/' + up + ' {accountEnabled:false}', /Disable accounts/i);
      S('revoke', 'last', 'Sign out of every device', 'Revokes the refresh tokens', 'POST /users/' + up + '/revokeSignInSessions', /Disable accounts/i);
      S('mfa', 'last', 'Remove the MFA methods', 'So a lost phone cannot be used', 'DELETE /users/' + up + '/authentication/methods/{id}', /Disable accounts/i);
      S('groups', 'last', 'Remove from all groups and Teams', 'Keeps the history of the channels', 'DELETE /groups/{id}/members/{id}/$ref');
      S('shared', 'after', 'Convert the mailbox to a shared mailbox and give ' + (mgr || 'the manager') + ' access for 90 days', 'Customers’ e-mails keep arriving; an automatic reply names the new contact', 'Exchange Online: Set-Mailbox -Type Shared, Add-MailboxPermission', /Mailbox converted/i);
      if (ctx.licence) S('licence', 'after', 'Remove the licence: ' + ctx.licence, 'Frees it for the next joiner', 'POST /users/' + up + '/assignLicense {removeLicenses}', /Remove the Microsoft 365 licence/i);
    } else {
      var moved = to && loc && to.id !== loc.id;
      S('profile', 'now', 'Update the profile: ' + (ctx.toRole || ctx.role) + (moved ? ', ' + (to.short || '') : ''), 'Job title, department, office and manager' + (mgr ? ' (' + mgr + ')' : ''), 'PATCH /users/' + up);
      if (moved) S('groups', 'now', 'Move groups and Teams: ' + locGroup(loc) + ' → ' + locGroup(to), 'Leaves the old location’s channels, joins the new ones', 'DELETE + POST /groups/{id}/members', /E-mail groups and Teams|Teams channel switched/i);
      if (ctx.licencePlan && ctx.licencePlan !== ctx.licence) S('licence', 'now', 'Change the licence: ' + (ctx.licence || 'none') + ' → ' + ctx.licencePlan, 'Swaps the subscription', 'POST /users/' + up + '/assignLicense', /Licence change/i);
    }
    return steps;
  }
  /** which steps run now, which are scheduled; and the checklist items that would be ticked now */
  function m365Run(ctx, now) {
    var today = String(now || ctx.today || '').slice(0, 10), time = String(now || '').slice(11, 16) || '00:00';
    var lastOk = ctx.type !== 'leaver' || today > ctx.date || (today === ctx.date && time >= '17:00');
    var afterOk = ctx.type !== 'leaver' || today >= addDays(ctx.date, 1);
    var it = (ctx.tasks || []).filter(function (t) { return t.team === 'IT'; });
    var steps = m365Plan(ctx).map(function (s) {
      // a step whose checklist items are all done (or not needed) already happened: shown, not run again
      var mine = s.match ? it.filter(function (t) { return s.match.test(t.title); }) : [];
      var already = mine.length > 0 && mine.every(function (t) { return t.status !== 'todo'; });
      var run = !already && (s.at === 'now' || (s.at === 'last' ? lastOk : afterOk));
      return Object.assign({}, s, { run: run, already: already, when: run || already ? '' : s.at === 'last' ? ctx.date + 'T17:00' : addDays(ctx.date, 1) });
    });
    var tick = [], waiting = [];
    (ctx.tasks || []).forEach(function (t) {
      if (t.team !== 'IT' || t.status !== 'todo') return;
      var hits = steps.filter(function (s) { return s.match && s.match.test(t.title); });
      if (!hits.length) return;
      if (hits.every(function (s) { return s.run; })) tick.push(t.id); else waiting.push(t.id);
    });
    return { steps: steps, tick: tick, waiting: waiting };
  }
  return { welcome: welcome, letterText: letterText, startTime: startTime, where: where, m365Plan: m365Plan, m365Run: m365Run, fmt: fmt };
});
