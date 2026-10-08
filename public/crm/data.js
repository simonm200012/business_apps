/* CRM demo data: catalogues + seeded generator (window.CRMDATA). */
(function () {
  'use strict';
  var SEED = 20261007;
  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  function iso(d) { return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); }
  function pd(s) { var a = String(s).split('-'); return new Date(+a[0], a[1] - 1, +a[2]); }
  function sod(ms) { var d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function addD(d, n) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); return x; }

  var OWNERS = [
    { id: 'u1', name: 'Maja Novak', initials: 'MN', tone: 'blue' },
    { id: 'u2', name: 'Luka Kovač', initials: 'LK', tone: 'green' },
    { id: 'u3', name: 'Eva Horvat', initials: 'EH', tone: 'violet' },
    { id: 'u4', name: 'Marko Zupan', initials: 'MZ', tone: 'amber' },
    { id: 'u5', name: 'Nina Kralj', initials: 'NK', tone: 'teal' }
  ];
  var STAGES = [
    { id: 'lead', name: 'Lead', prob: 10, tone: 'gray' },
    { id: 'qualified', name: 'Qualified', prob: 30, tone: 'blue' },
    { id: 'proposal', name: 'Proposal', prob: 50, tone: 'violet' },
    { id: 'negotiation', name: 'Negotiation', prob: 75, tone: 'amber' },
    { id: 'won', name: 'Won', prob: 100, tone: 'green' },
    { id: 'lost', name: 'Lost', prob: 0, tone: 'red' }
  ];
  var SEGMENTS = [
    { id: 'Optician', name: 'Optician', tone: 'blue' }, { id: 'Clinic', name: 'Eye clinic', tone: 'teal' },
    { id: 'Corporate', name: 'Corporate', tone: 'violet' }, { id: 'Reseller', name: 'Reseller', tone: 'amber' },
    { id: 'Partner', name: 'Partner', tone: 'green' }
  ];
  var COUNTRIES = [{ id: 'SI', name: 'Slovenia' }, { id: 'HR', name: 'Croatia' }];
  var PRODUCTS = [
    { id: 'p1', name: 'Practice Suite licence', unit: 'licence / yr', price: 1450 },
    { id: 'p2', name: 'Patient Portal', unit: 'site / yr', price: 790 },
    { id: 'p3', name: 'Lens Ordering Connector', unit: 'site / yr', price: 640 },
    { id: 'p4', name: 'Exam Camera Bundle', unit: 'unit', price: 3900 },
    { id: 'p5', name: 'Training day', unit: 'day', price: 680 },
    { id: 'p6', name: 'Onsite installation', unit: 'day', price: 820 },
    { id: 'p7', name: 'Support Gold', unit: 'site / yr', price: 1190 },
    { id: 'p8', name: 'Support Silver', unit: 'site / yr', price: 590 },
    { id: 'p9', name: 'Frame Catalogue Feed', unit: 'site / yr', price: 480 },
    { id: 'p10', name: 'Analytics Add-on', unit: 'site / yr', price: 360 },
    { id: 'p11', name: 'Hardware Kit', unit: 'kit', price: 2250 }
  ];
  var LOST_REASONS = ['Price too high', 'Chose a competitor', 'No budget this year', 'No response', 'Project cancelled', 'Missing feature'];
  var ACT_TYPES = [
    { id: 'call', name: 'Call', icon: '☎' }, { id: 'email', name: 'E-mail', icon: '✉' },
    { id: 'meeting', name: 'Meeting', icon: '◐' }, { id: 'demo', name: 'Demo', icon: '▶' }, { id: 'task', name: 'Task', icon: '✓' }
  ];
  var SOURCES = ['Website', 'Referral', 'Trade fair', 'Cold call', 'Partner', 'Newsletter'];

  var SURN = ['Novak', 'Horvat', 'Kovač', 'Krajnc', 'Zupančič', 'Potočnik', 'Mlakar', 'Kos', 'Vidmar', 'Golob', 'Turk', 'Božič', 'Korošec', 'Bizjak', 'Kovačič', 'Zupan', 'Kralj', 'Hribar', 'Babić', 'Jurić', 'Marić', 'Perić', 'Tomić', 'Matić', 'Pavlović', 'Knežević', 'Vuk', 'Lah', 'Rozman', 'Oblak'];
  var FIRST = ['Ana', 'Marko', 'Petra', 'Luka', 'Nina', 'Matej', 'Maja', 'Jure', 'Eva', 'Tomaž', 'Katja', 'Andrej', 'Ivana', 'Ivan', 'Marija', 'Josip', 'Tina', 'Gregor', 'Sara', 'Boris', 'Mateja', 'Dino'];
  var ROLES = ['Owner', 'Practice manager', 'Purchasing', 'Head optometrist', 'IT lead', 'Finance', 'CEO', 'Procurement manager'];
  var CITY = { SI: ['Ljubljana', 'Maribor', 'Celje', 'Kranj', 'Koper', 'Novo mesto', 'Ptuj', 'Murska Sobota'], HR: ['Zagreb', 'Split', 'Rijeka', 'Osijek', 'Zadar', 'Pula'] };
  var W1 = ['Alpina', 'Adria', 'Triglav', 'Savinja', 'Krka', 'Soča', 'Pohorje', 'Jadran', 'Kvarner', 'Drava', 'Panonija', 'Karst', 'Nova', 'Prima', 'Vista', 'Lumen', 'Focus', 'Optima'];
  var W2 = ['Vision', 'Group', 'Retail', 'Health', 'Logistika', 'Holding', 'Medical', 'Services', 'Systems', 'Commerce'];
  var PLAN = [['Optician', 30], ['Clinic', 13], ['Corporate', 18], ['Reseller', 10], ['Partner', 8]];
  var LOSS = [0.16, 0.13, 0.15, 0.2];
  var CHAIN = ['lead', 'qualified', 'proposal', 'negotiation'];
  var STAGE_ACT = { lead: ['call', 'Intro call'], qualified: ['meeting', 'Discovery meeting'], proposal: ['email', 'Send proposal'], negotiation: ['call', 'Negotiate terms'], won: ['task', 'Kick-off planning'], lost: ['email', 'Closing e-mail'] };
  var NOTES = ['Prefers e-mail over phone.', 'Decision maker is on leave until next month.', 'Asked for a reference customer in the region.', 'Budget approved for this year.', 'Competitor already quoted a lower price.', 'Wants a demo for the whole team.', 'Interested in the patient portal as a second step.', 'Needs the offer in Croatian as well.'];

  function slug(s) { return s.toLowerCase().replace(/[čć]/g, 'c').replace(/š/g, 's').replace(/ž/g, 'z').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '').slice(0, 14); }

  function generate(nowMs) {
    var R = mulberry32(SEED), today = sod(nowMs || Date.now()), seq = 0;
    function rnd(n) { return Math.floor(R() * n); }
    function pick(a) { return a[rnd(a.length)]; }
    function ch(p) { return R() < p; }
    function nid() { return ++seq; }
    function wd(d) { var w = d.getDay(); return w === 6 ? addD(d, -1) : w === 0 ? addD(d, -2) : d; }
    var companies = [], contacts = [], deals = [], activities = [], notes = [], names = {};

    function uniq(n) { var k = n, i = 2; while (names[k]) k = n + ' ' + (i++); names[k] = 1; return k; }
    function nameFor(seg) {
      var s = pick(SURN), w = pick(W1);
      if (seg === 'Optician') return uniq(pick(['Optika ', 'Optika ', 'Očala ', 'Optik ']) + s + (ch(0.3) ? ' d.o.o.' : ''));
      if (seg === 'Clinic') return uniq(pick(['Očesna ordinacija ', 'Oftalmološka klinika ', 'Poliklinika ', 'Očesni center ']) + pick(['Vid', 'Oko', 'Bistri', 'Lipa', 'Sonce', 'Zora', 'Jasna']) + ' ' + w);
      if (seg === 'Corporate') return uniq(w + ' ' + pick(W2) + ' d.o.o.');
      if (seg === 'Reseller') return uniq(w + ' Trade d.o.o.');
      return uniq(w + ' Partners');
    }
    function makeCompany(name, seg, fixed) {
      var country = fixed || ch(0.55) ? 'SI' : 'HR', c = { id: nid(), name: name, segment: seg, country: country, city: pick(CITY[country]), ownerId: pick(OWNERS).id, source: pick(SOURCES) };
      var digits = ''; for (var i = 0; i < (country === 'SI' ? 8 : 11); i++) digits += rnd(10);
      c.vat = country + digits; c.email = 'info@' + slug(name) + '.example.com'; c.phone = '+' + (country === 'SI' ? '386 1 ' : '385 1 ') + (100 + rnd(900)) + ' ' + (1000 + rnd(9000));
      c.website = 'www.' + slug(name) + '.example.com'; c.created = iso(addD(today, -(60 + rnd(520)))); c.tags = []; companies.push(c); return c;
    }
    function makeContact(co) {
      var f = pick(FIRST), l = pick(SURN), c = { id: nid(), companyId: co ? co.id : null, first: f, last: l, role: pick(ROLES), email: slug(f) + '.' + slug(l) + '@' + (co ? slug(co.name) : 'freelance') + '.example.com', phone: '+386 40 ' + (100 + rnd(900)) + ' ' + (100 + rnd(900)), ownerId: co ? co.ownerId : pick(OWNERS).id };
      contacts.push(c); return c;
    }
    function makeActivity(o) { var a = { id: nid(), type: o.type, title: o.title, dealId: o.dealId || null, companyId: o.companyId || null, contactId: o.contactId || null, ownerId: o.ownerId, due: o.due, done: !!o.done, doneAt: o.done ? o.due : null }; activities.push(a); return a; }

    var fixed = makeCompany('Očesna klinika Lipa d.o.o.', 'Clinic', true); fixed.city = 'Ljubljana'; fixed.ownerId = 'u1'; fixed.vat = 'SI12345678';
    PLAN.forEach(function (p) { for (var i = 0; i < p[1]; i++) makeCompany(nameFor(p[0]), p[0]); });
    // shuffle (seeded)
    for (var i = companies.length - 1; i > 0; i--) { var j = rnd(i + 1), t = companies[i]; companies[i] = companies[j]; companies[j] = t; }

    companies.forEach(function (co) {
      var n = 2 + rnd(3), cts = []; for (var k = 0; k < n; k++) cts.push(makeContact(co));
      var nd = 2 + rnd(5);
      for (var k2 = 0; k2 < nd; k2++) {
        var ct = pick(cts), lines = [], nl = 1 + rnd(3), used = {};
        for (var q = 0; q < nl; q++) { var pr = pick(PRODUCTS); if (used[pr.id]) continue; used[pr.id] = 1; lines.push({ productId: pr.id, name: pr.name, qty: pr.unit === 'day' ? 1 + rnd(3) : 1 + rnd(co.segment === 'Corporate' || co.segment === 'Reseller' ? 8 : 3), price: pr.price, disc: ch(0.25) ? 5 * (1 + rnd(3)) : 0 }); }
        var cur = addD(today, -(8 + rnd(537))), hist = [{ stage: 'lead', date: iso(wd(cur)) }], stage = 'lead', lost = '', periods = [];
        for (var s = 0; s < 4; s++) {
          var next = addD(cur, 5 + rnd(26)); if (next > today) break;
          if (ch(LOSS[s])) { stage = 'lost'; lost = pick(LOST_REASONS); hist.push({ stage: 'lost', date: iso(wd(next)) }); break; }
          stage = s < 3 ? CHAIN[s + 1] : 'won'; hist.push({ stage: stage, date: iso(wd(next)) }); cur = next;
        }
        var d = { id: nid(), companyId: co.id, contactId: ct.id, ownerId: ch(0.8) ? co.ownerId : pick(OWNERS).id, title: lines[0].name + ' · ' + co.name.replace(/ d\.o\.o\.$/, ''), stage: stage, created: hist[0].date, expected: iso(wd(addD(pd(hist[hist.length - 1].date), 14 + rnd(45)))), lines: lines, source: pick(SOURCES), lostReason: lost, history: hist, updated: pd(hist[hist.length - 1].date).getTime() + 36e5 * 10 };
        deals.push(d);
        hist.forEach(function (h, hi) {
          var st = h.stage, a0 = pd(h.date), a1 = hi + 1 < hist.length ? pd(hist[hi + 1].date) : today, span = Math.max(0, Math.round((a1 - a0) / 864e5));
          if (st !== 'lead' && st !== 'won' && st !== 'lost' && hi + 1 >= hist.length && span < 2) return;
          var sa = STAGE_ACT[st], due = wd(addD(a0, Math.min(span, 1 + rnd(Math.max(1, span))))); if (due > today) due = today;
          makeActivity({ type: sa[0], title: sa[1] + ' · ' + ct.last, dealId: d.id, companyId: co.id, contactId: ct.id, ownerId: d.ownerId, due: iso(due), done: true });
        });
        if (ch(0.33)) notes.push({ id: nid(), dealId: d.id, companyId: co.id, text: pick(NOTES), at: pd(hist[hist.length - 1].date).getTime() + 36e5 * 14, ownerId: d.ownerId });
      }
    });
    // loose contacts
    for (var z = 0; z < 6; z++) makeContact(null);
    // open tasks: today + overdue per owner
    var open = deals.filter(function (d) { return d.stage !== 'won' && d.stage !== 'lost'; });
    OWNERS.forEach(function (o) {
      var mine = open.filter(function (d) { return d.ownerId === o.id; }); if (!mine.length) mine = open;
      var nt = 3 + rnd(3), no = 1 + rnd(3), nf = 2 + rnd(3), k;
      function mk(day, title, type) { var d = pick(mine); makeActivity({ type: type || pick(ACT_TYPES).id, title: title + ' · ' + contacts.filter(function (c) { return c.id === d.contactId; })[0].last, dealId: d.id, companyId: d.companyId, contactId: d.contactId, ownerId: o.id, due: iso(day), done: false }); }
      for (k = 0; k < nt; k++) mk(today, pick(['Follow up', 'Call back', 'Prepare offer', 'Confirm demo', 'Send contract']));
      for (k = 0; k < no; k++) mk(wd(addD(today, -(1 + rnd(9)))), pick(['Reply to question', 'Chase signature', 'Update quote']));
      for (k = 0; k < nf; k++) mk(wd(addD(today, 1 + rnd(12))), pick(['Check in', 'Demo session', 'Review proposal', 'Onboarding call']));
    });
    addDuplicates();
    function addDuplicates() {
      var base = companies.filter(function (c) { return c.segment === 'Optician'; }).slice(0, 3);
      base.forEach(function (c, i) {
        var dup = JSON.parse(JSON.stringify(c)); dup.id = nid(); dup.name = i === 0 ? c.name.replace(/ d\.o\.o\.$/, '') + ' d.o.o.' : i === 1 ? c.name.toUpperCase() : c.name + ' (stara)';
        if (i === 0 && dup.name === c.name) dup.name = c.name + ' d.o.o.'; dup.phone = ''; dup.created = iso(addD(today, -30 - i)); companies.push(dup);
        var oc = contacts.filter(function (x) { return x.companyId === c.id; })[0];
        if (oc) { var cc = JSON.parse(JSON.stringify(oc)); cc.id = nid(); cc.companyId = dup.id; cc.role = ''; cc.phone = ''; contacts.push(cc); }
      });
    }
    return { version: 1, generatedAt: nowMs || Date.now(), seq: seq, companies: companies, contacts: contacts, deals: deals, activities: activities, notes: notes };
  }
  window.CRMDATA = { SEED: SEED, OWNERS: OWNERS, STAGES: STAGES, SEGMENTS: SEGMENTS, COUNTRIES: COUNTRIES, PRODUCTS: PRODUCTS, LOST_REASONS: LOST_REASONS, ACT_TYPES: ACT_TYPES, SOURCES: SOURCES, mulberry32: mulberry32, iso: iso, pd: pd, generate: generate };
})();
