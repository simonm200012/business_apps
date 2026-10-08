/* Contracts & renewals: catalogues and the deterministic demo generator. All parties are fictional. */
window.ContractsData = (function () {
  'use strict';
  var D = window.ContractDates, VERSION = 1;
  var CATEGORIES = [
    { id: 'lease', name: 'Leases and premises', remind: 120 }, { id: 'utilities', name: 'Utilities', remind: 45 }, { id: 'software', name: 'Software and SaaS', remind: 60 },
    { id: 'insurance', name: 'Insurance', remind: 90 }, { id: 'frames', name: 'Suppliers: frames', remind: 60 }, { id: 'lenses', name: 'Suppliers: lenses', remind: 60 },
    { id: 'logistics', name: 'Logistics', remind: 45 }, { id: 'marketing', name: 'Agencies and media', remind: 45 }, { id: 'telecom', name: 'Telecom', remind: 45 },
    { id: 'facility', name: 'Cleaning and maintenance', remind: 45 }, { id: 'professional', name: 'Professional services', remind: 60 }, { id: 'vehicles', name: 'Vehicles and leasing', remind: 90 },
    { id: 'equipment', name: 'Equipment and lab', remind: 60 }
  ];
  var CURRENCIES = { EUR: 1, USD: 0.92, GBP: 1.17, CHF: 1.04 };
  var COMPANIES = ['Adrial SI', 'Adrial HR', 'Vallis', 'Adrial Group'];
  var LOCATIONS = ['Ljubljana HQ', 'Ljubljana warehouse', 'Store BTC City', 'Store Citypark', 'Store Maribor', 'Store Celje', 'Store Koper', 'Zagreb office', 'Store Zagreb Avenue', 'Store Split', 'Vallis Gorizia', 'Vallis Trieste', 'All locations'];
  var DECISIONS = { undecided: 'Undecided', negotiation: 'In negotiation', renew: 'Renew', renegotiate: 'Renegotiate', cancel: 'Cancel' };
  var STATUSES = { draft: 'Draft', active: 'Active', ending: 'Ending', ended: 'Ended' };
  var TYPES = { auto: 'Auto-renewing', fixed: 'Fixed term', open: 'Open-ended' };
  var PERIODS = { month: 'per month', quarter: 'per quarter', year: 'per year', once: 'one-off' };
  var DEFAULTS = {
    lease: { type: 'fixed', fixedMonths: 60, noticeN: 6, noticeUnit: 'months', noticeEom: true, period: 'month', amt: [1800, 9500], index: { mode: 'cpi', on: 'anniversary' } },
    utilities: { type: 'auto', renewMonths: 12, noticeN: 30, noticeUnit: 'days', period: 'month', amt: [180, 2400], index: { mode: 'none' } },
    software: { type: 'auto', renewMonths: 12, noticeN: 2, noticeUnit: 'months', noticeEom: true, period: 'year', amt: [900, 42000], index: { mode: 'fixed', step: 4 } },
    insurance: { type: 'auto', renewMonths: 12, noticeN: 3, noticeUnit: 'months', noticeEom: true, period: 'year', amt: [1500, 28000], index: { mode: 'none' } },
    frames: { type: 'open', noticeN: 3, noticeUnit: 'months', noticeEom: true, period: 'year', amt: [20000, 260000], index: { mode: 'none' } },
    lenses: { type: 'fixed', fixedMonths: 36, noticeN: 6, noticeUnit: 'months', period: 'year', amt: [30000, 180000], index: { mode: 'fixed', step: 2 } },
    logistics: { type: 'auto', renewMonths: 12, noticeN: 60, noticeUnit: 'days', period: 'month', amt: [900, 7500], index: { mode: 'cpi', on: 'jan1' } },
    marketing: { type: 'fixed', fixedMonths: 12, noticeN: 30, noticeUnit: 'days', period: 'month', amt: [1500, 12000], index: { mode: 'none' } },
    telecom: { type: 'auto', renewMonths: 24, noticeN: 3, noticeUnit: 'months', period: 'month', amt: [250, 3800], index: { mode: 'cpi', on: 'anniversary' } },
    facility: { type: 'auto', renewMonths: 12, noticeN: 3, noticeUnit: 'months', noticeEom: true, period: 'month', amt: [400, 4200], index: { mode: 'cpi', on: 'jan1' } },
    professional: { type: 'open', noticeN: 30, noticeUnit: 'days', noticeEom: true, period: 'month', amt: [600, 6500], index: { mode: 'none' } },
    vehicles: { type: 'fixed', fixedMonths: 48, noticeN: 3, noticeUnit: 'months', period: 'month', amt: [380, 950], index: { mode: 'none' } },
    equipment: { type: 'fixed', fixedMonths: 60, noticeN: 6, noticeUnit: 'months', period: 'year', amt: [1200, 24000], index: { mode: 'fixed', step: 3 } }
  };
  var CAT = {
    lease: ['Ljubljana HQ office lease|Kapitol Nepremičnine', 'Warehouse lease Brnik|Logis Park d.o.o.', 'Store lease BTC City|BTC Real Estate', 'Store lease Citypark|Citypark Management', 'Store lease Maribor|Europark Maribor', 'Store lease Celje|Celeia Mall', 'Store lease Koper|Planet Koper', 'Zagreb office lease|Zagreb Tower d.o.o.', 'Store lease Zagreb Avenue|Avenue Mall', 'Store lease Split|Joker Centar'],
    utilities: ['Electricity HQ|Elektro Energija', 'Electricity stores SI|Elektro Energija', 'Electricity Croatia|HEP Opskrba', 'Gas heating warehouse|Plinara Sever', 'Water and sewage HQ|Javno podjetje Vodovod', 'District heating Maribor|Toplarna Maribor', 'Waste collection stores|Snaga Okolje', 'Electricity Vallis Italy|Energia Nord', 'Electricity Vallis Trieste|Energia Nord'],
    software: ['ERP licences|Optivision Software', 'CRM subscription|Clientia Cloud', 'Email and office suite|Cloudoffice Ltd', 'Webshop platform|Shopline GmbH', 'Payment gateway|PayRail', 'HR and payroll system|PeopleDesk', 'Accounting software|Ledgerly', 'Endpoint security|ShieldNet', 'Backup service|SafeVault', 'Customer survey tool|FeedbackFox', 'Email marketing platform|MailBloom', 'Analytics suite|DataLens', 'Video meetings|MeetBox', 'Contract signing service|SignRight'],
    insurance: ['Property insurance HQ|Triglav Zavarovanje', 'Stock and inventory insurance|Triglav Zavarovanje', 'Liability insurance|Adriatic Insurance', 'Cyber insurance|CyberSure Europe', 'Business interruption|Adriatic Insurance', 'Fleet insurance|Generali Adria', 'Employee accident insurance|Sava Re', 'Croatia property insurance|Croatia Osiguranje'],
    frames: ['Frames Italy: premium range|Montecchia Occhiali', 'Frames Denmark: minimalist|Nordic Frames A/S', 'Frames Germany: sport|Bergwerk Optik', 'Frames Slovenia: own brand|Okvir d.o.o.', 'Frames France: designer|Atelier Lunette', 'Frames Japan: titanium|Kyoto Metal Works', 'Sunglasses Italy|Sole Mare Spa', 'Children frames|Mini Vision', 'Frames Spain|Gafas del Sur', 'Reading glasses|ClearRead Trading'],
    lenses: ['Lens supply single vision|Optilens GmbH', 'Progressive lenses|Varilux Partners', 'Lens coatings|CoatTech', 'Contact lenses monthly|SoftSight', 'Contact lenses daily|DailyClear', 'Lens treatment blue filter|BlueGuard Labs', 'Photochromic lenses|ShadeShift', 'Lens cases and cleaning|ClearCare'],
    logistics: ['Parcel delivery SI|Pošta Express', 'Parcel delivery Croatia|HP Dostava', 'Pallet transport EU|Alpe Transport', 'Courier same-day Ljubljana|Hitra Pošta', 'Returns handling|ReturnPoint', 'Customs broker Italy|Dogana Servizi', 'Packaging materials|Embalaža Plus'],
    marketing: ['Social media agency|Pixel Pivot', 'Performance marketing agency|ClickHarbor', 'Radio campaign slots|Radio Val', 'Billboard network SI|Plakat Media', 'Influencer agency|Creatorly', 'Print and flyers|Tiskarna Zlatorog', 'Photography studio|Studio Lumen', 'PR retainer|Kommuna PR', 'Local TV sponsorship|TV Adria'],
    telecom: ['Mobile plans staff|Telekom Slovenije', 'Fixed lines HQ|A1 Slovenija', 'Internet stores|Telemach', 'Mobile plans Croatia|HT Mobile', 'SD-WAN connectivity|NetBridge', 'Contact centre telephony|VoiceHub', 'Mobile plans Vallis|Telecom Nord'],
    facility: ['Cleaning HQ|Čisto d.o.o.', 'Cleaning stores Ljubljana|Čisto d.o.o.', 'Cleaning stores Maribor and Celje|Blesk Servis', 'HVAC maintenance|Klima Servis', 'Fire alarm inspection|Požar Varnost', 'Lift maintenance HQ|Dvigala Alpe', 'Security patrol warehouse|Varnost Plus', 'Alarm monitoring stores|Varnost Plus', 'Pest control|Dezinfekt'],
    professional: ['External accountant|Računovodstvo Plus', 'Legal counsel retainer|Odvetniki Kranjc', 'Tax advisory Croatia|Porezni Savjet', 'Auditor|Revizija Balkan', 'Data-protection officer|Zasebnost d.o.o.', 'Recruitment partner|Talent Bridge', 'Occupational health|Medicina Dela', 'Translation services|Lingua Pro', 'IT support partner|Sistemika'],
    vehicles: ['Delivery van lease 1|Sparkasse Leasing', 'Delivery van lease 2|Sparkasse Leasing', 'Company car manager SI|Porsche Leasing', 'Company car manager HR|Porsche Leasing', 'Company car sales|Avto Aktiv Leasing', 'Electric van lease|GreenFleet', 'Forklift lease|Lift Rent', 'Fuel cards|Petrol Fleet'],
    equipment: ['Edging machine service|Optimatic Service', 'Autorefractor maintenance|Vision Devices', 'Slit lamp maintenance|Vision Devices', 'Lens blocker service|Optimatic Service', 'Tonometer calibration|Calibra Lab', 'Visual field analyser|PerimetriX', 'OCT scanner service|RetinaTech', 'Frame tracer service|Optimatic Service', 'Photocopier lease|Konica Partner', 'Label printers maintenance|Print Tech', 'Barcode scanners support|ScanLogic', 'Cash registers service|Kasa Servis', 'Store display fixtures|Display Studio', 'Ultrasonic cleaners service|Optimatic Service', 'POS terminals rental|PayRail']
  };
  var CPI = { 2019: 1.6, 2020: 0.2, 2021: 1.9, 2022: 8.8, 2023: 7.2, 2024: 2.9, 2025: 2.3, 2026: 2.4 };
  var FIRST = ['Maja Novak', 'Luka Horvat', 'Ana Kovač', 'Marko Zupan', 'Petra Krajnc', 'Jure Kos'];

  function rng(seed) { var a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function todayLj() {
    try { var p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Ljubljana', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); if (/^\d{4}-\d\d-\d\d$/.test(p)) return p; } catch (e) {}
    return new Date().toISOString().slice(0, 10);
  }
  function normalize(c) { return c; }

  function generate(today) {
    var R = rng(0xC0A7AC7), ri = function (a, b) { return a + Math.floor(R() * (b - a + 1)); }, pick = function (a) { return a[Math.floor(R() * a.length)]; };
    var contracts = [], idx = 0;
    var plans = ['soon', 'later', 'later', 'soon', 'later', 'locked', 'later', 'soon', 'past', 'later', 'soon', 'later', 'future', 'later', 'past', 'soon', 'later', 'locked', 'later', 'later'];
    var decCycle = ['negotiation', 'renew', 'renegotiate', 'cancel', 'undecided'], dc = 0;
    var noticeGiven = [3, 11, 19, 27, 35];
    CATEGORIES.forEach(function (cat) {
      var df = DEFAULTS[cat.id];
      CAT[cat.id].forEach(function (row, n) {
        var p = row.split('|'), plan = plans[(idx * 7 + n) % plans.length], forced = noticeGiven.indexOf(idx) >= 0;
        if (forced) plan = 'soon';
        var loc = pick(LOCATIONS), co = /Croatia|Zagreb|Split|HP |HEP|HT /.test(row) ? 'Adrial HR' : /Vallis|Trieste|Italy/.test(row) ? 'Vallis' : pick(['Adrial SI', 'Adrial SI', 'Adrial Group']);
        if (co === 'Adrial HR' && /Split/.test(row)) loc = 'Store Split'; if (/HQ/.test(row)) loc = 'Ljubljana HQ';
        var amt = Math.round((df.amt[0] + R() * (df.amt[1] - df.amt[0])) / 10) * 10;
        var c = { id: 'K' + String(idx + 1).padStart(3, '0'), name: p[0], category: cat.id, party: p[1], company: co, location: loc, status: 'active', type: df.type, start: '', end: '', renewMonths: df.renewMonths || 12, noticeN: df.noticeN, noticeUnit: df.noticeUnit, noticeEom: !!df.noticeEom, amount: amt, currency: cat.id === 'frames' && R() < .15 ? 'USD' : cat.id === 'lenses' && R() < .12 ? 'CHF' : 'EUR', period: df.period, index: Object.assign({}, df.index), priceChanges: [], decision: 'undecided', decisionBy: '', notes: '', contact: { name: pick(FIRST), email: 'contact' + (idx + 1) + '@example.com', phone: '+386 1 555 ' + String(1000 + idx * 7).slice(-4) }, iban: 'SI56 0000 0000 ' + String(1000 + idx).slice(-4) + ' ' + String(idx * 37 % 1000).padStart(3, '0'), owner: pick(FIRST), docs: [], history: [], milestones: [], noticeGivenOn: '', endsOn: '' };
        var lo, hi, planWin = { soon: [3, 88], later: [95, 420], locked: [-40, -1], past: [95, 420], future: [95, 420] }[plan];
        lo = planWin[0]; hi = planWin[1];
        /* find a term end whose notice deadline lands in the wanted window */
        function findTerm(c) {
          var t0 = today, L = D.addDays(today, lo), H = D.addDays(today, hi);
          for (var s = 0; s < 900; s++) {
            var t = D.addDays(t0, s), d = c.noticeUnit === 'days' ? D.addDays(t, -c.noticeN) : D.addMonths(t, -c.noticeN);
            if (c.noticeEom && !D.isEom(d)) d = D.eom(D.addMonths(d, -1));
            if (d >= L && d <= H && t >= today) return t;
          }
          return D.addDays(today, hi + c.noticeN * 30);
        }
        if (c.type === 'auto') {
          var T = findTerm(c), k = ri(0, 3);
          c.end = D.addMonths(T, -k * c.renewMonths); c.start = D.addDays(D.addMonths(c.end, -c.renewMonths), 1);
          for (var j = 0; j < k; j++) c.history.push({ date: D.termEndK(c, j), kind: 'renewal', text: 'Renewed automatically for ' + c.renewMonths + ' months.' });
          if (plan === 'future') { c.status = 'draft'; c.start = D.addDays(today, ri(35, 80)); c.end = D.addDays(D.addMonths(c.start, c.renewMonths), -1); c.history = []; }
        } else if (c.type === 'fixed') {
          if (plan === 'past') { c.end = D.addDays(today, -ri(20, 400)); c.status = 'ended'; }
          else if (plan === 'future') { c.status = 'draft'; c.start = D.addDays(today, ri(35, 80)); c.end = D.addDays(D.addMonths(c.start, df.fixedMonths), -1); }
          else c.end = findTerm(c);
          if (plan !== 'future') c.start = D.addDays(D.addMonths(c.end, -df.fixedMonths), 1);
        } else {
          c.start = D.addDays(today, -ri(200, 2400)); c.end = '';
          if (plan === 'future') { c.status = 'draft'; c.start = D.addDays(today, ri(35, 80)); }
        }
        if (c.type !== 'fixed' && c.type !== 'auto') c.end = '';
        /* values: CPI history so the current amount is the result of yearly indexations */
        if (c.status !== 'draft' && c.index.mode === 'cpi') {
          var a = c.amount, ds = D.indexDates(Object.assign({}, c, { endsOn: '' }), D.addDays(c.start, 1), today, today), hist = [];
          ds.forEach(function (d) { var r = CPI[+d.slice(0, 4)] || 2.5; hist.push({ date: d, kind: 'price', text: 'Indexed +' + r.toFixed(1) + '% (CPI)', pct: r }); });
          var f = 1; hist.forEach(function (h) { f *= 1 + h.pct / 100; });
          var base = c.amount / f; hist.forEach(function (h) { base *= 1 + h.pct / 100; h.to = Math.round(base * 100) / 100; });
          c.amount = hist.length ? hist[hist.length - 1].to : a; c.history = c.history.concat(hist);
        } else if (c.index.mode === 'fixed') {
          var jan = (+today.slice(0, 4) + 1) + '-01-01'; c.priceChanges.push({ date: jan, amount: Math.round(c.amount * (1 + c.index.step / 100)) });
        }
        c.history.sort(function (x, y) { return x.date < y.date ? -1 : 1; });
        /* decisions for deadlines in the next 90 days */
        var nd = D.nextDeadline(c, today);
        if (nd && nd.deadline >= today && D.daysBetween(today, nd.deadline) <= 90 && c.type !== 'open') { c.decision = decCycle[dc++ % decCycle.length]; if (c.decision !== 'undecided') c.decisionBy = D.addDays(nd.deadline, -ri(7, 21)); }
        /* notice already given */
        if (forced) {
          c.noticeGivenOn = D.addDays(today, -ri(5, 30)); c.decision = 'cancel';
          if (c.type === 'open') { var oe = D.earliestOpenEnd(c, c.noticeGivenOn); c.endsOn = oe.end; } else c.endsOn = D.effectiveEnd(c, today);
          c.status = 'ending'; c.history.push({ date: c.noticeGivenOn, kind: 'notice', text: 'Notice given. Contract ends on ' + c.endsOn + '.' });
        }
        /* documents are names only */
        c.docs.push({ hash: '', name: c.id + '-contract.pdf', type: 'application/pdf', size: 0, demo: true, at: c.start });
        if (R() < .5) c.docs.push({ hash: '', name: c.id + '-annex.pdf', type: 'application/pdf', size: 0, demo: true, at: c.start });
        if (idx % 17 === 5) c.docs = [];
        if (R() < .2) c.milestones.push({ date: D.addDays(today, ri(5, 60)), title: pick(['Price review meeting', 'Service level review', 'Volume report due', 'Insurance certificate update']) });
        contracts.push(c); idx++;
      });
    });
    return { version: VERSION, generatedFor: today, contracts: contracts, settings: { remind: {}, cpi: 2.5, handled: {}, me: 'Maja Novak' } };
  }
  return { VERSION: VERSION, CATEGORIES: CATEGORIES, CURRENCIES: CURRENCIES, COMPANIES: COMPANIES, LOCATIONS: LOCATIONS, DECISIONS: DECISIONS, STATUSES: STATUSES, TYPES: TYPES, PERIODS: PERIODS, DEFAULTS: DEFAULTS, CAT: CAT, generate: generate, todayLj: todayLj, rng: rng };
})();
