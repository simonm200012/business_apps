/* Contracts & renewals demo: deterministic, entirely FICTIONAL dataset.
 * window.ContractsData.generate(todayYmd) builds ~120 contracts of an optical retailer (stores in SI and HR,
 * a warehouse, a webshop, several group companies). Counterparties, people, e-mails (@example.com), phone
 * numbers and IBANs are invented; a few well-known platforms (Microsoft 365, PayPal, Klarna, GLS, DPD) appear
 * only as category examples with made-up terms. Dates are placed relative to `today`, so the overview always
 * has upcoming deadlines. Same seed → same data on every load. */
(function () {
  'use strict';

  var VERSION = 1;
  var D = window.ContractDates;

  var COMPANIES = [
    { id: 'RSI', name: 'Adrial Retail SI (demo)', country: 'SI' },
    { id: 'RHR', name: 'Adrial Retail HR (demo)', country: 'HR' },
    { id: 'ECOM', name: 'Adrial E-commerce (demo)', country: 'SI' },
    { id: 'LOG', name: 'Adrial Logistics (demo)', country: 'SI' },
    { id: 'HOLD', name: 'Adrial Group Holding (demo)', country: 'SI' }
  ];
  var LOCATIONS = [
    { id: 'HQ', name: 'Head office Komenda', country: 'SI' },
    { id: 'WH', name: 'Central warehouse Komenda', country: 'SI' },
    { id: 'ESHOP', name: 'Webshop', country: 'SI' },
    { id: 'SI-KOM', name: 'Store Komenda', country: 'SI' },
    { id: 'SI-KP', name: 'Store Koper', country: 'SI' },
    { id: 'SI-MB', name: 'Store Maribor', country: 'SI' },
    { id: 'SI-NM', name: 'Store Novo Mesto', country: 'SI' },
    { id: 'SI-LJ', name: 'Store Ljubljana', country: 'SI' },
    { id: 'HR-ZG', name: 'Store Zagreb', country: 'HR' },
    { id: 'HR-ST', name: 'Store Split', country: 'HR' },
    { id: 'HR-RI', name: 'Store Rijeka', country: 'HR' },
    { id: 'HR-ZD', name: 'Store Zadar', country: 'HR' },
    { id: 'HR-OS', name: 'Store Osijek', country: 'HR' }
  ];
  var PEOPLE = [
    { id: 'p1', name: 'Maja Kos', role: 'Finance' },
    { id: 'p2', name: 'Luka Žnidar', role: 'Operations' },
    { id: 'p3', name: 'Petra Hrovat', role: 'Retail SI' },
    { id: 'p4', name: 'Ivan Babić', role: 'Retail HR' },
    { id: 'p5', name: 'Nina Zupan', role: 'E-commerce' },
    { id: 'p6', name: 'Tomaž Kralj', role: 'IT' },
    { id: 'p7', name: 'Ana Marić', role: 'Purchasing' },
    { id: 'p8', name: 'Jure Golob', role: 'Logistics' },
    { id: 'p9', name: 'Sara Vidmar', role: 'Marketing' },
    { id: 'p10', name: 'Marko Perić', role: 'People & HR' }
  ];
  var CATEGORIES = [
    { id: 'lease', name: 'Store leases', short: 'Lease', color: 'violet', remind: 90 },
    { id: 'supplier', name: 'Suppliers', short: 'Supplier', color: 'blue', remind: 45 },
    { id: 'logistics', name: 'Logistics', short: 'Logistics', color: 'teal', remind: 30 },
    { id: 'payments', name: 'Payments', short: 'Payments', color: 'clay', remind: 30 },
    { id: 'software', name: 'Software & SaaS', short: 'Software', color: 'violet', remind: 30 },
    { id: 'telecom', name: 'Telecom & utilities', short: 'Telecom', color: 'blue', remind: 30 },
    { id: 'insurance', name: 'Insurance', short: 'Insurance', color: 'teal', remind: 30 },
    { id: 'vehicles', name: 'Vehicles & leasing', short: 'Vehicles', color: 'clay', remind: 45 },
    { id: 'marketing', name: 'Marketing agencies', short: 'Marketing', color: 'violet', remind: 30 },
    { id: 'maintenance', name: 'Equipment maintenance', short: 'Maintenance', color: 'blue', remind: 30 },
    { id: 'facility', name: 'Cleaning & security', short: 'Facility', color: 'teal', remind: 30 },
    { id: 'nda', name: 'NDAs', short: 'NDA', color: 'clay', remind: 14 },
    { id: 'staffing', name: 'Agency staff', short: 'Staffing', color: 'violet', remind: 30 }
  ];
  var STATUSES = [
    { id: 'active', name: 'Active', cls: 'b-good' },
    { id: 'negotiation', name: 'In negotiation', cls: 'b-blue' },
    { id: 'ending', name: 'Ending', cls: 'b-clay' },
    { id: 'ended', name: 'Ended', cls: '' },
    { id: 'draft', name: 'Draft', cls: 'b-violet' }
  ];
  var RENEWALS = [
    { id: 'auto', name: 'Auto-renew' },
    { id: 'fixed', name: 'Fixed term' },
    { id: 'open', name: 'Open-ended' }
  ];
  var CURRENCIES = { EUR: 1, USD: 0.92, GBP: 1.17, CHF: 1.05 }; // demo conversion to EUR

  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function r2(n) { return Math.round(n * 100) / 100; }

  // ── the contract catalogue (fictional counterparties) ────────────────────
  // p: party, t: title, co: company, loc: location, a: amount, per: month|quarter|year|once, own: owner id ('' = none)
  // r: 'auto' | 'fixed' | 'open', term: initial months, rm: renew months, n/u/eom: notice, plan: soon|later|locked|past|future
  // ix: 'cpi' | 'fixed' | 'none' (+ ixp, ixon), dep: deposit, dept: deposit type, cur, pf: payment frequency, tags, terms, docs
  var CAT = {
    lease: [
      { p: 'Poslovni center Komenda d.o.o.', t: 'Lease: store unit 14, Komenda', co: 'RSI', loc: 'SI-KOM', a: 2350, own: 'p3', r: 'auto', term: 60, rm: 12, n: 6, plan: 'later', tags: ['street shop'] },
      { p: 'Obala Retail Center d.o.o.', t: 'Lease: unit B-112, Obala Retail Center', co: 'RSI', loc: 'SI-KP', a: 6900, own: 'p3', r: 'fixed', term: 84, n: 6, plan: 'soon', tags: ['shopping centre', 'service charge'] },
      { p: 'Drava Park Shopping d.o.o.', t: 'Lease: unit 0.27, Drava Park', co: 'RSI', loc: 'SI-MB', a: 8400, own: 'p3', r: 'auto', term: 60, rm: 36, n: 6, plan: 'later', tags: ['shopping centre', 'turnover rent'] },
      { p: 'Trdina Center d.o.o.', t: 'Lease: ground-floor shop, Trdina Center', co: 'RSI', loc: 'SI-NM', a: 3850, own: 'p3', r: 'auto', term: 36, rm: 12, n: 3, plan: 'soon', tags: ['shopping centre'] },
      { p: 'Nepremičnine Zorko (private landlord)', t: 'Lease: street shop Čopova, Ljubljana', co: 'RSI', loc: 'SI-LJ', a: 4600, own: '', r: 'fixed', term: 120, n: 6, plan: 'later', tags: ['street shop', 'city centre'] },
      { p: 'Jarun City Centar d.o.o.', t: 'Lease: unit 1-045, Jarun City', co: 'RHR', loc: 'HR-ZG', a: 11800, own: 'p4', r: 'auto', term: 60, rm: 12, n: 6, plan: 'soon', tags: ['shopping centre', 'service charge'] },
      { p: 'Marjan Retail Park d.o.o.', t: 'Lease: unit A-19, Marjan Retail Park', co: 'RHR', loc: 'HR-ST', a: 7200, own: 'p4', r: 'fixed', term: 60, n: 6, plan: 'later', tags: ['shopping centre'] },
      { p: 'Kvarner Galerija d.o.o.', t: 'Lease: unit 2.08, Kvarner Galerija', co: 'RHR', loc: 'HR-RI', a: 5100, own: 'p4', r: 'auto', term: 36, rm: 12, n: 3, plan: 'locked', tags: ['shopping centre'] },
      { p: 'Zadar Bay Mall d.o.o.', t: 'Lease: unit G-31, Zadar Bay Mall', co: 'RHR', loc: 'HR-ZD', a: 4300, own: 'p4', r: 'auto', term: 60, rm: 12, n: 6, plan: 'later', tags: ['shopping centre', 'seasonal'] },
      { p: 'Drava Shopping Osijek d.o.o.', t: 'Lease: unit 18, Drava Shopping', co: 'RHR', loc: 'HR-OS', a: 3600, own: 'p4', r: 'fixed', term: 60, n: 6, plan: 'soon', tags: ['shopping centre'] },
      { p: 'Logistični park Mengeš d.o.o.', t: 'Lease: warehouse hall C (2.400 m²)', co: 'LOG', loc: 'WH', a: 14200, own: 'p8', r: 'fixed', term: 120, n: 12, plan: 'later', tags: ['warehouse'] },
      { p: 'Poslovna stavba Tičnica d.o.o.', t: 'Lease: head-office floor 2', co: 'HOLD', loc: 'HQ', a: 4250, own: 'p1', r: 'auto', term: 36, rm: 12, n: 3, plan: 'later', tags: ['office'] }
    ],
    supplier: [
      { p: 'Lumina Eyewear GmbH', t: 'Framework agreement: frames 2025–2026', co: 'RSI', a: 420000, own: 'p7', plan: 'soon', tags: ['frames', 'rebate'], rebate: [150000, 2, 300000, 4] },
      { p: 'Ottica Serena S.r.l.', t: 'Distribution agreement: Serena optical frames', co: 'RSI', a: 285000, own: 'p7', plan: 'later', tags: ['frames', 'exclusive SI'], rebate: [100000, 1.5, 250000, 3] },
      { p: 'Nordline Frames ApS', t: 'Framework agreement: Nordline titanium frames', co: 'RHR', a: 160000, own: 'p7', plan: 'soon', tags: ['frames'], rebate: [80000, 2, 150000, 3.5] },
      { p: 'Atelier Vero SAS', t: 'Supply agreement: premium acetate frames', co: 'RSI', a: 95000, own: 'p7', plan: 'later', cur: 'EUR', tags: ['frames', 'premium'] },
      { p: 'Kestrel Optical Ltd', t: 'Supply agreement: kids frames', co: 'RSI', a: 64000, own: 'p7', plan: 'locked', cur: 'GBP', tags: ['frames', 'kids'] },
      { p: 'Solaris Shades S.L.', t: 'Framework agreement: sunglasses SS/AW collections', co: 'ECOM', a: 210000, own: 'p7', plan: 'soon', tags: ['sunglasses', 'seasonal'], rebate: [120000, 2, 200000, 5] },
      { p: 'Polar Shade Oy', t: 'Supply agreement: polarised sport sunglasses', co: 'ECOM', a: 88000, own: '', plan: 'later', tags: ['sunglasses'] },
      { p: 'Riviera Sun Eyewear S.p.A.', t: 'Consignment agreement: Riviera sunglasses', co: 'RHR', a: 120000, own: 'p7', plan: 'later', tags: ['sunglasses', 'consignment'] },
      { p: 'VistaLab Optics d.o.o.', t: 'Lens lab agreement: single vision & progressive', co: 'RSI', a: 610000, own: 'p7', plan: 'soon', tags: ['lens lab', 'rebate', 'SLA 48 h'], rebate: [400000, 3, 600000, 5] },
      { p: 'Jadran Precision Lens d.o.o.', t: 'Lens lab agreement: HR stores', co: 'RHR', a: 340000, own: 'p4', plan: 'later', tags: ['lens lab', 'SLA 72 h'], rebate: [250000, 2, 400000, 4] },
      { p: 'Prizma Lens Lab GmbH', t: 'Lens lab agreement: freeform specials', co: 'RSI', a: 140000, own: 'p7', plan: 'later', tags: ['lens lab'] },
      { p: 'Opticore Rx Lab s.r.o.', t: 'Backup lens lab agreement', co: 'RSI', a: 36000, own: '', r: 'open', n: 3, plan: 'past', tags: ['lens lab', 'backup'] },
      { p: 'Aquavis Contact Lens Distribution d.o.o.', t: 'Distribution agreement: monthly & daily contact lenses', co: 'ECOM', a: 520000, own: 'p5', plan: 'soon', tags: ['contact lenses', 'webshop', 'rebate'], rebate: [300000, 3, 500000, 6] },
      { p: 'ClearDrop Lenses B.V.', t: 'Supply agreement: daily lenses private label', co: 'ECOM', a: 310000, own: 'p5', plan: 'later', tags: ['contact lenses', 'private label'] },
      { p: 'Hydrafit Vision Kft.', t: 'Supply agreement: toric & multifocal lenses', co: 'RHR', a: 145000, own: 'p4', plan: 'locked', tags: ['contact lenses'] },
      { p: 'PureCare Solutions GmbH', t: 'Supply agreement: lens care solutions', co: 'ECOM', a: 72000, own: 'p5', plan: 'later', tags: ['solutions'] },
      { p: 'Etui Pack d.o.o.', t: 'Supply agreement: cases & cleaning cloths (branded)', co: 'LOG', a: 38000, own: 'p8', plan: 'soon', tags: ['accessories', 'branded'] },
      { p: 'Optiglas Blanks a.s.', t: 'Supply agreement: semi-finished lens blanks', co: 'RSI', a: 54000, own: 'p7', plan: 'later', tags: ['lens lab', 'blanks'] },
      { p: 'Sunhaven Kids Eyewear Ltd', t: 'Supply agreement: kids sunglasses', co: 'ECOM', a: 26000, own: 'p7', r: 'fixed', term: 12, n: 1, plan: 'future', status: 'draft', tags: ['sunglasses', 'kids', 'new brand'] },
      { p: 'Dalmatia Display d.o.o.', t: 'Shop-fitting & display supply agreement', co: 'RHR', a: 42000, own: 'p4', r: 'fixed', term: 24, n: 2, plan: 'past', tags: ['store fit-out'] }
    ],
    logistics: [
      { p: 'GLS', t: 'Parcel delivery agreement SI (example terms)', co: 'ECOM', a: 14500, per: 'month', own: 'p8', r: 'open', n: 3, u: 'm', plan: 'past', tags: ['courier', 'COD'], terms: 'Domestic parcel 0–2 kg 3,05 €; 2–5 kg 3,45 €; COD fee 0,95 €; fuel surcharge per monthly index; pickup daily 15:00 from the warehouse.' },
      { p: 'GLS', t: 'Parcel delivery agreement HR (example terms)', co: 'RHR', a: 6200, per: 'month', own: 'p8', r: 'open', n: 3, u: 'm', plan: 'past', tags: ['courier', 'COD'] },
      { p: 'DPD', t: 'Parcel delivery agreement SI + HR (example terms)', co: 'ECOM', a: 5800, per: 'month', own: 'p8', r: 'auto', term: 12, rm: 12, n: 2, plan: 'soon', tags: ['courier'] },
      { p: 'National post SI', t: 'Postal services & letters agreement', co: 'HOLD', a: 1900, per: 'month', own: 'p8', r: 'open', n: 30, u: 'd', eom: true, plan: 'past', tags: ['post'] },
      { p: 'National post HR', t: 'Parcel & COD agreement HR', co: 'RHR', a: 2400, per: 'month', own: '', r: 'open', n: 30, u: 'd', eom: true, plan: 'past', tags: ['post', 'COD'] },
      { p: 'ParcelPoint Lockers d.o.o.', t: 'Parcel locker network agreement SI + HR', co: 'ECOM', a: 3100, per: 'month', own: 'p5', r: 'auto', term: 12, rm: 12, n: 60, u: 'd', plan: 'soon', tags: ['parcel lockers'] },
      { p: 'Skladišča Vrhnika d.o.o.', t: '3PL overflow storage (peak season)', co: 'LOG', a: 6800, per: 'month', own: 'p8', r: 'fixed', term: 6, n: 1, plan: 'soon', tags: ['warehouse', 'seasonal'] },
      { p: 'Transport Ribnik d.o.o.', t: 'Store replenishment trucking SI + HR', co: 'LOG', a: 9400, per: 'month', own: 'p8', r: 'auto', term: 12, rm: 12, n: 3, plan: 'later', tags: ['trucking', 'stores'] },
      { p: 'Paleta Express d.o.o.', t: 'Pallet freight framework', co: 'LOG', a: 22000, per: 'year', own: 'p8', r: 'open', n: 1, plan: 'past', tags: ['freight'] }
    ],
    payments: [
      { p: 'Acquira Payments d.o.o.', t: 'Card acquiring: SI stores & webshop', co: 'RSI', a: 96000, per: 'year', own: 'p1', r: 'auto', term: 24, rm: 12, n: 3, plan: 'soon', tags: ['card acquiring', 'fees'], terms: 'Consumer cards EEA 0,79 % + 0,05 €; commercial cards 1,85 %; non-EEA 2,4 %; settlement T+1; chargeback fee 15 €.' },
      { p: 'Jadran Card Services d.d.', t: 'Card acquiring: HR stores', co: 'RHR', a: 54000, per: 'year', own: 'p1', r: 'auto', term: 24, rm: 12, n: 3, plan: 'later', tags: ['card acquiring', 'fees'] },
      { p: 'PayPal', t: 'Merchant agreement: webshop (example terms)', co: 'ECOM', a: 31000, per: 'year', own: 'p5', r: 'open', n: 1, plan: 'past', tags: ['wallet', 'fees'], terms: 'Standard merchant rate 2,49 % + fixed fee per currency; cross-border +1,29 %; payouts daily.' },
      { p: 'Klarna', t: 'Pay later agreement: webshop (example terms)', co: 'ECOM', a: 24000, per: 'year', own: 'p5', r: 'auto', term: 24, rm: 12, n: 3, plan: 'locked', tags: ['BNPL', 'fees'] },
      { p: 'TermiPay d.o.o.', t: 'POS terminal rental (14 terminals)', co: 'RSI', a: 420, per: 'month', own: 'p1', r: 'fixed', term: 36, n: 3, plan: 'soon', tags: ['POS terminals'] },
      { p: 'Monetica Gateway d.o.o.', t: 'Payment gateway: webshop 3-D Secure', co: 'ECOM', a: 6600, per: 'year', own: 'p5', r: 'auto', term: 12, rm: 12, n: 30, u: 'd', plan: 'later', tags: ['gateway'] },
      { p: 'Valuta Instant d.o.o.', t: 'Instant bank payments (QR) agreement', co: 'ECOM', a: 2400, per: 'year', own: '', r: 'open', n: 30, u: 'd', eom: true, plan: 'past', tags: ['instant payments', 'pilot'] }
    ],
    software: [
      { p: 'Alpina ERP Cloud d.o.o.', t: 'ERP subscription & support', co: 'HOLD', a: 4800, per: 'month', own: 'p6', r: 'auto', term: 36, rm: 12, n: 3, plan: 'later', ix: 'fixed', ixp: 4, ixon: 'jan', tags: ['ERP', 'critical'] },
      { p: 'Microsoft 365', t: 'Microsoft 365 Business Premium (85 seats, via reseller)', co: 'HOLD', a: 1870, per: 'month', own: 'p6', r: 'auto', term: 12, rm: 12, n: 30, u: 'd', plan: 'soon', tags: ['licences', 'M365'] },
      { p: 'Konto Pro d.o.o.', t: 'Accounting software (group, 5 companies)', co: 'HOLD', a: 9600, per: 'year', own: 'p1', r: 'auto', term: 12, rm: 12, n: 60, u: 'd', plan: 'soon', tags: ['accounting'] },
      { p: 'TimeTrack Systems d.o.o.', t: 'Time & attendance terminals + cloud', co: 'HOLD', a: 640, per: 'month', own: 'p10', r: 'auto', term: 24, rm: 12, n: 3, plan: 'later', tags: ['time attendance', 'HR'] },
      { p: 'Mailwave Ltd', t: 'Newsletter platform (180k contacts)', co: 'ECOM', a: 1150, per: 'month', own: 'p9', r: 'auto', term: 12, rm: 12, n: 30, u: 'd', plan: 'soon', cur: 'USD', tags: ['marketing tool', 'e-mail'] },
      { p: 'Postly Social Ltd', t: 'Social media scheduling', co: 'ECOM', a: 2280, per: 'year', own: 'p9', r: 'auto', term: 12, rm: 12, n: 0, plan: 'later', cur: 'USD', tags: ['marketing tool'] },
      { p: 'RankScope Inc.', t: 'SEO & site audit tool', co: 'ECOM', a: 4790, per: 'year', own: 'p9', r: 'auto', term: 12, rm: 12, n: 14, u: 'd', plan: 'soon', cur: 'USD', tags: ['marketing tool', 'SEO'] },
      { p: 'Cloud data warehouse (Google Cloud)', t: 'Data warehouse & scheduled jobs (pay as you go)', co: 'HOLD', a: 420, per: 'month', own: 'p6', r: 'open', n: 0, plan: 'past', tags: ['data tool', 'usage-based'] },
      { p: 'Datalytic BI d.o.o.', t: 'BI dashboards & data pipeline support', co: 'HOLD', a: 1600, per: 'month', own: 'p6', r: 'auto', term: 12, rm: 12, n: 2, plan: 'locked', tags: ['data tool', 'support'] },
      { p: 'Ticketa Support Desk Ltd', t: 'Customer service helpdesk (22 agents)', co: 'ECOM', a: 1320, per: 'month', own: 'p5', r: 'auto', term: 12, rm: 12, n: 30, u: 'd', plan: 'later', tags: ['customer service'] },
      { p: 'ShopForge Commerce GmbH', t: 'Webshop platform licence (SI, HR, IT shops)', co: 'ECOM', a: 36000, per: 'year', own: 'p5', r: 'auto', term: 36, rm: 12, n: 6, plan: 'later', ix: 'fixed', ixp: 5, ixon: 'jan', tags: ['webshop', 'critical'] },
      { p: 'Productly PIM s.r.o.', t: 'Product information management', co: 'ECOM', a: 890, per: 'month', own: '', r: 'auto', term: 12, rm: 12, n: 1, plan: 'soon', tags: ['PIM'] },
      { p: 'VaultKey Teams AB', t: 'Password manager (60 users)', co: 'HOLD', a: 2880, per: 'year', own: 'p6', r: 'auto', term: 12, rm: 12, n: 0, plan: 'later', cur: 'USD', tags: ['security'] },
      { p: 'BackSafe Cloud d.o.o.', t: 'Backup & disaster recovery', co: 'HOLD', a: 310, per: 'month', own: 'p6', r: 'auto', term: 12, rm: 12, n: 1, plan: 'later', tags: ['security', 'backup'] },
      { p: 'OptiPOS Retail d.o.o.', t: 'Store POS software (12 stores)', co: 'RSI', a: 1450, per: 'month', own: 'p6', r: 'auto', term: 36, rm: 12, n: 3, plan: 'soon', ix: 'cpi', ixon: 'jan', tags: ['POS', 'critical'] },
      { p: 'EyeChart Clinic Suite B.V.', t: 'Eye-exam records software', co: 'RSI', a: 7400, per: 'year', own: 'p3', r: 'auto', term: 24, rm: 12, n: 3, plan: 'later', tags: ['eye exams', 'GDPR'] }
    ],
    telecom: [
      { p: 'Telko Mobile SI d.d.', t: 'Mobile phones & data (48 SIMs)', co: 'HOLD', a: 1240, per: 'month', own: 'p6', r: 'fixed', term: 24, n: 1, plan: 'soon', tags: ['mobile'] },
      { p: 'Telko Mobile HR d.d.', t: 'Mobile phones & data HR (19 SIMs)', co: 'RHR', a: 520, per: 'month', own: 'p6', r: 'fixed', term: 24, n: 1, plan: 'later', tags: ['mobile'] },
      { p: 'Optinet Fiber d.o.o.', t: 'Store internet lines SI (7 sites)', co: 'RSI', a: 560, per: 'month', own: 'p6', r: 'auto', term: 24, rm: 12, n: 30, u: 'd', plan: 'later', tags: ['internet', 'stores'] },
      { p: 'NetMesh SD-WAN Ltd', t: 'SD-WAN & firewall managed service', co: 'HOLD', a: 1890, per: 'month', own: 'p6', r: 'auto', term: 36, rm: 12, n: 3, plan: 'soon', tags: ['network', 'managed service'] },
      { p: 'VoxLine d.o.o.', t: 'Cloud telephony & call centre lines', co: 'ECOM', a: 740, per: 'month', own: 'p5', r: 'open', n: 30, u: 'd', eom: true, plan: 'past', tags: ['telephony'] },
      { p: 'Svetla Energija d.o.o.', t: 'Electricity supply SI (all sites)', co: 'HOLD', a: 5200, per: 'month', own: 'p2', r: 'fixed', term: 12, n: 2, plan: 'soon', tags: ['electricity', 'fixed price'] },
      { p: 'Jadranska Struja d.o.o.', t: 'Electricity supply HR stores', co: 'RHR', a: 2100, per: 'month', own: 'p2', r: 'fixed', term: 12, n: 2, plan: 'later', tags: ['electricity'] },
      { p: 'EkoOdvoz d.o.o.', t: 'Waste & packaging collection (warehouse)', co: 'LOG', a: 480, per: 'month', own: 'p8', r: 'open', n: 3, plan: 'past', tags: ['waste'] },
      { p: 'Komunala Komenda (municipal utility)', t: 'Water & sewage (warehouse + HQ)', co: 'LOG', a: 190, per: 'month', own: '', r: 'open', n: 0, plan: 'past', tags: ['water'] },
      { p: 'Plinarna Sever d.o.o.', t: 'Heating gas supply (warehouse)', co: 'LOG', a: 1150, per: 'month', own: 'p2', r: 'auto', term: 12, rm: 12, n: 2, plan: 'locked', tags: ['gas'] }
    ],
    insurance: [
      { p: 'Zavarovalnica Lipa d.d.', t: 'Property & stock insurance SI', co: 'HOLD', a: 18400, per: 'year', own: 'p1', r: 'auto', term: 12, rm: 12, n: 3, plan: 'soon', tags: ['property', 'stock'] },
      { p: 'Osiguranje Adria Sigurnost d.d.', t: 'Property & stock insurance HR', co: 'RHR', a: 9800, per: 'year', own: 'p1', r: 'auto', term: 12, rm: 12, n: 3, plan: 'later', tags: ['property'] },
      { p: 'Zavarovalnica Lipa d.d.', t: 'General & product liability (group)', co: 'HOLD', a: 7600, per: 'year', own: 'p1', r: 'auto', term: 12, rm: 12, n: 3, plan: 'soon', tags: ['liability'] },
      { p: 'Vozni park Zavarovanja d.d.', t: 'Fleet motor insurance (9 vehicles)', co: 'HOLD', a: 8900, per: 'year', own: 'p2', r: 'auto', term: 12, rm: 12, n: 1, plan: 'locked', tags: ['vehicle'] },
      { p: 'CyberShield Underwriting Ltd', t: 'Cyber insurance (webshop & data)', co: 'ECOM', a: 6400, per: 'year', own: 'p6', r: 'fixed', term: 12, n: 1, plan: 'soon', tags: ['cyber'] },
      { p: 'Zavarovalnica Lipa d.d.', t: 'Goods in transit insurance', co: 'LOG', a: 2300, per: 'year', own: '', r: 'auto', term: 12, rm: 12, n: 3, plan: 'later', tags: ['transit'] },
      { p: 'Osiguranje Adria Sigurnost d.d.', t: 'Optician professional indemnity HR', co: 'RHR', a: 1900, per: 'year', own: 'p4', r: 'auto', term: 12, rm: 12, n: 1, plan: 'later', tags: ['liability', 'professional'] }
    ],
    vehicles: [
      { p: 'Avto Lizing Sava d.o.o.', t: 'Operating lease: delivery van LJ-ADR-01', co: 'LOG', a: 640, per: 'month', own: 'p8', r: 'fixed', term: 48, n: 3, plan: 'soon', tags: ['van', 'operating lease'] },
      { p: 'Avto Lizing Sava d.o.o.', t: 'Operating lease: delivery van LJ-ADR-02', co: 'LOG', a: 655, per: 'month', own: 'p8', r: 'fixed', term: 48, n: 3, plan: 'later', tags: ['van', 'operating lease'] },
      { p: 'Mobilis Fleet d.o.o.', t: 'Operating lease: 4 field cars (area managers)', co: 'HOLD', a: 2160, per: 'month', own: 'p2', r: 'fixed', term: 36, n: 3, plan: 'later', tags: ['cars', 'fleet'] },
      { p: 'Mobilis Fleet d.o.o.', t: 'Operating lease: area manager car HR', co: 'RHR', a: 590, per: 'month', own: 'p4', r: 'fixed', term: 36, n: 3, plan: 'past', tags: ['cars'] },
      { p: 'Viličar Najem d.o.o.', t: 'Forklift rental incl. service', co: 'LOG', a: 780, per: 'month', own: 'p8', r: 'auto', term: 24, rm: 12, n: 3, plan: 'later', tags: ['forklift'] },
      { p: 'EV Polnilnice d.o.o.', t: 'EV charging points at HQ (lease + energy)', co: 'HOLD', a: 260, per: 'month', own: '', r: 'auto', term: 36, rm: 12, n: 3, plan: 'later', tags: ['EV'] },
      { p: 'Avto Lizing Sava d.o.o.', t: 'Finance lease: store fit-out Zagreb', co: 'RHR', a: 1450, per: 'month', own: 'p1', r: 'fixed', term: 60, n: 0, plan: 'later', tags: ['finance lease', 'fit-out'] },
      { p: 'Mobilis Fleet d.o.o.', t: 'Operating lease: e-cargo bike (Ljubljana)', co: 'RSI', a: 120, per: 'month', own: 'p3', r: 'fixed', term: 24, n: 1, plan: 'future', status: 'draft', tags: ['bike', 'pilot'] }
    ],
    marketing: [
      { p: 'Pixel & Pine d.o.o.', t: 'Performance marketing retainer (Google, Meta)', co: 'ECOM', a: 5800, per: 'month', own: 'p9', r: 'open', n: 1, plan: 'past', tags: ['performance', 'retainer'] },
      { p: 'Studio Modra Ura d.o.o.', t: 'Creative agency retainer: campaigns & POS material', co: 'HOLD', a: 4200, per: 'month', own: 'p9', r: 'fixed', term: 12, n: 2, plan: 'soon', tags: ['creative'] },
      { p: 'Glas PR d.o.o.', t: 'PR & media relations SI', co: 'RSI', a: 1800, per: 'month', own: 'p9', r: 'open', n: 30, u: 'd', eom: true, plan: 'past', tags: ['PR'] },
      { p: 'Kreativa Influence j.d.o.o.', t: 'Influencer programme HR (sunglasses season)', co: 'RHR', a: 18000, per: 'once', own: 'p9', r: 'fixed', term: 6, n: 0, plan: 'past', tags: ['influencers', 'seasonal'] },
      { p: 'Digitalna Luka d.o.o.', t: 'SEO content & translations SI/HR/IT', co: 'ECOM', a: 2400, per: 'month', own: '', r: 'auto', term: 12, rm: 6, n: 1, plan: 'soon', tags: ['content', 'SEO'] },
      { p: 'Foto Atelje Brin s.p.', t: 'Product photography framework', co: 'ECOM', a: 14500, per: 'year', own: 'p5', r: 'auto', term: 12, rm: 12, n: 1, plan: 'later', tags: ['photography'] }
    ],
    maintenance: [
      { p: 'OptoServis d.o.o.', t: 'Service contract: autorefractors & tonometers SI', co: 'RSI', a: 6800, per: 'year', own: 'p3', r: 'auto', term: 12, rm: 12, n: 2, plan: 'soon', tags: ['eye-exam devices', 'SLA 48 h'] },
      { p: 'Optotehnika Servis d.o.o.', t: 'Service contract: eye-exam devices HR', co: 'RHR', a: 4900, per: 'year', own: 'p4', r: 'auto', term: 12, rm: 12, n: 2, plan: 'later', tags: ['eye-exam devices'] },
      { p: 'EdgeTech Service GmbH', t: 'Edging machines maintenance (6 machines)', co: 'RSI', a: 11200, per: 'year', own: 'p7', r: 'auto', term: 24, rm: 12, n: 3, plan: 'soon', cur: 'EUR', tags: ['edging machines', 'spare parts'] },
      { p: 'EdgeTech Service GmbH', t: 'Edging machines maintenance HR (3 machines)', co: 'RHR', a: 5600, per: 'year', own: 'p4', r: 'auto', term: 24, rm: 12, n: 3, plan: 'later', tags: ['edging machines'] },
      { p: 'Kalibra Lab d.o.o.', t: 'Lensmeter & PD meter calibration', co: 'RSI', a: 1900, per: 'year', own: '', r: 'auto', term: 12, rm: 12, n: 1, plan: 'later', tags: ['calibration'] },
      { p: 'Retina Imaging Service s.r.l.', t: 'OCT scanner service & software updates', co: 'RSI', a: 7900, per: 'year', own: 'p3', r: 'fixed', term: 36, n: 3, plan: 'soon', tags: ['OCT', 'eye-exam devices'] },
      { p: 'Klima Servis Bor d.o.o.', t: 'HVAC maintenance warehouse + HQ', co: 'LOG', a: 3400, per: 'year', own: 'p8', r: 'auto', term: 12, rm: 12, n: 1, plan: 'locked', tags: ['HVAC'] },
      { p: 'PackLine Service d.o.o.', t: 'Packing line & label printers maintenance', co: 'LOG', a: 4100, per: 'year', own: 'p8', r: 'auto', term: 12, rm: 12, n: 2, plan: 'later', tags: ['packing'] },
      { p: 'LiftCo Servis d.o.o.', t: 'Warehouse dock & lift inspections', co: 'LOG', a: 1600, per: 'year', own: 'p8', r: 'open', n: 3, plan: 'past', tags: ['inspections'] },
      { p: 'OptoServis d.o.o.', t: 'Slit lamp replacement programme', co: 'RSI', a: 22000, per: 'once', own: 'p3', r: 'fixed', term: 12, n: 0, plan: 'later', tags: ['eye-exam devices', 'capex'] }
    ],
    facility: [
      { p: 'Čistoča Bistra d.o.o.', t: 'Store cleaning SI (6 stores)', co: 'RSI', a: 2650, per: 'month', own: 'p3', r: 'open', n: 30, u: 'd', eom: true, plan: 'past', tags: ['cleaning'] },
      { p: 'Čisto More d.o.o.', t: 'Store cleaning HR (5 stores)', co: 'RHR', a: 2100, per: 'month', own: 'p4', r: 'open', n: 30, u: 'd', eom: true, plan: 'past', tags: ['cleaning'] },
      { p: 'Čistoča Bistra d.o.o.', t: 'Warehouse & HQ cleaning', co: 'LOG', a: 1950, per: 'month', own: 'p8', r: 'auto', term: 12, rm: 12, n: 1, plan: 'soon', tags: ['cleaning'] },
      { p: 'Varnost Straža d.o.o.', t: 'Security guard: warehouse nights & weekends', co: 'LOG', a: 4300, per: 'month', own: 'p8', r: 'auto', term: 12, rm: 12, n: 3, plan: 'later', tags: ['security'] },
      { p: 'Alarm Center Sokol d.o.o.', t: 'Alarm monitoring & intervention SI', co: 'RSI', a: 690, per: 'month', own: '', r: 'auto', term: 24, rm: 12, n: 3, plan: 'soon', tags: ['alarm'] },
      { p: 'Zaštita Sigurnost d.o.o.', t: 'Alarm monitoring & intervention HR', co: 'RHR', a: 540, per: 'month', own: 'p4', r: 'auto', term: 24, rm: 12, n: 3, plan: 'later', tags: ['alarm'] },
      { p: 'Deratizacija Zelena d.o.o.', t: 'Pest control warehouse (quarterly)', co: 'LOG', a: 520, per: 'quarter', own: 'p8', r: 'open', n: 1, plan: 'past', tags: ['pest control'] },
      { p: 'Vrtovi Javor s.p.', t: 'Grounds & winter service warehouse', co: 'LOG', a: 3900, per: 'year', own: 'p8', r: 'fixed', term: 12, n: 1, plan: 'soon', tags: ['grounds', 'winter service'] }
    ],
    nda: [
      { p: 'ClearDrop Lenses B.V.', t: 'NDA: private-label contact lens development', co: 'ECOM', own: 'p5', term: 36, plan: 'later', tags: ['private label'] },
      { p: 'Northbay Retail Partners Ltd', t: 'NDA: possible store acquisition (HR coast)', co: 'HOLD', own: 'p1', term: 24, plan: 'soon', tags: ['M&A'] },
      { p: 'Datalytic BI d.o.o.', t: 'NDA: data access for BI project', co: 'HOLD', own: 'p6', term: 36, plan: 'later', tags: ['data'] },
      { p: 'Pixel & Pine d.o.o.', t: 'NDA: campaign & sales data', co: 'ECOM', own: 'p9', term: 24, plan: 'later', tags: ['marketing'] },
      { p: 'Alpine Optics Group AG', t: 'NDA: joint purchasing talks', co: 'HOLD', own: '', term: 24, plan: 'past', tags: ['purchasing'] },
      { p: 'Sunhaven Kids Eyewear Ltd', t: 'NDA: new collection preview', co: 'ECOM', own: 'p7', term: 24, plan: 'later', tags: ['frames'] }
    ],
    staffing: [
      { p: 'Kadrovska agencija Most d.o.o.', t: 'Agency staff: warehouse peak season pickers', co: 'LOG', a: 18500, per: 'month', own: 'p10', r: 'fixed', term: 4, n: 0, plan: 'soon', tags: ['warehouse', 'seasonal'] },
      { p: 'Agencija Rad Plus d.o.o.', t: 'Agency staff: HR store assistants (summer)', co: 'RHR', a: 7200, per: 'month', own: 'p10', r: 'fixed', term: 4, n: 0, plan: 'past', tags: ['stores', 'seasonal'] },
      { p: 'Študentski servis Iskra', t: 'Student work framework (stores & customer service)', co: 'RSI', a: 6400, per: 'month', own: 'p10', r: 'open', n: 0, plan: 'past', tags: ['students'] },
      { p: 'Optometrist Locum Network Ltd', t: 'Locum optometrists for eye exams', co: 'RSI', a: 3900, per: 'month', own: '', r: 'auto', term: 12, rm: 6, n: 1, plan: 'soon', tags: ['optometrists'] }
    ]
  };

  var DEFAULTS = {
    lease: { per: 'month', pf: 'monthly', ix: 'cpi', ixon: 'anniversary', u: 'm' },
    supplier: { per: 'year', pf: 'per order', r: 'auto', term: 24, rm: 12, n: 3, u: 'm', eom: true, ix: 'none' },
    logistics: { pf: 'monthly', u: 'm' },
    payments: { pf: 'monthly', u: 'm' },
    software: { pf: 'monthly', u: 'm' },
    telecom: { pf: 'monthly', u: 'm' },
    insurance: { pf: 'yearly', u: 'm' },
    vehicles: { pf: 'monthly', u: 'm' },
    marketing: { pf: 'monthly', u: 'm' },
    maintenance: { pf: 'yearly', u: 'm' },
    facility: { pf: 'monthly', u: 'm' },
    nda: { a: 0, per: 'once', pf: 'none', r: 'fixed', n: 0, u: 'm', ix: 'none' },
    staffing: { pf: 'monthly', u: 'm' }
  };

  var FIRST = ['Matej', 'Urška', 'Klemen', 'Tjaša', 'Rok', 'Eva', 'Gregor', 'Lea', 'Dario', 'Ivana', 'Marin', 'Lucija', 'Andrej', 'Katja', 'Stefan', 'Hanna', 'Lorenzo', 'Chiara', 'Mads', 'Sofie'];
  var LAST = ['Kranjc', 'Bizjak', 'Mlakar', 'Petek', 'Kovačič', 'Jurić', 'Knežević', 'Pavlović', 'Rossi', 'Bauer', 'Lindqvist', 'Moreau', 'Weber', 'Novak', 'Turk', 'Šimić'];
  function slug(s) { return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '').slice(0, 18) || 'party'; }

  function generate(today) {
    var R = rng(0xC0A7AC7);
    function int(a, b) { return a + Math.floor(R() * (b - a + 1)); }
    function pick(a) { return a[Math.floor(R() * a.length)]; }
    function chance(p) { return R() < p; }
    var A = D.addMonths, AD = D.addDays;
    var seqByYear = {}, nid = 0, hid = 0;
    var contracts = [];

    function ibanFor(country) {
      var s = '';
      for (var i = 0; i < 15; i++) s += int(0, 9);
      return country === 'HR' ? 'HR' + pad2(int(10, 99)) + ' ' + s.slice(0, 4) + ' ' + s.slice(4, 8) + ' ' + s.slice(8, 12) + ' ' + s.slice(12, 15) + '0 0000 0' : 'SI56 ' + s.slice(0, 4) + ' ' + s.slice(4, 8) + ' ' + s.slice(8, 12) + ' ' + s.slice(12, 15);
    }
    function pad2(n) { return (n < 10 ? '0' : '') + n; }
    function firstOfMonth(s) { return s.slice(0, 8) + '01'; }

    Object.keys(CAT).forEach(function (cat) {
      CAT[cat].forEach(function (src) {
        var o = Object.assign({}, DEFAULTS[cat], src);
        if (!o.r) o.r = 'auto';
        if (o.n == null) o.n = 3;
        if (!o.u) o.u = 'm';
        if (!o.per) o.per = 'month';
        if (!o.ix) o.ix = 'none';
        if (!o.term) o.term = 12;
        if (!o.rm) o.rm = 12;
        var c = {
          id: 'c' + (++nid), no: '', title: o.t, party: o.p, company: o.co, owner: o.own || '', category: cat, location: o.loc || '',
          start: '', end: '', renewal: o.r, renewMonths: o.r === 'auto' ? o.rm : 0,
          noticeN: o.n, noticeUnit: o.u, noticeEom: !!o.eom,
          amount: 0, per: o.per, currency: o.cur || 'EUR', payFreq: o.pf || 'monthly',
          indexType: o.ix, indexPct: o.ix === 'fixed' ? (o.ixp || 3) : 0, indexOn: o.ixon || 'anniversary',
          deposit: 0, depositType: 'none', status: o.status || 'active', endsOn: '',
          terms: '', tags: (o.tags || []).slice(), docs: [], notes: [], history: [], milestones: [],
          decision: { choice: 'undecided', due: '', note: '' },
          contact: null, iban: '', createdAt: '', updatedAt: ''
        };
        var probe = { noticeN: o.n, noticeUnit: o.u, noticeEom: !!o.eom, renewal: o.r };

        // ── dates ──
        if (o.plan === 'soon' && cat !== 'lease' && chance(0.3)) o.plan = 'later';
        var monthAligned = cat === 'lease' || cat === 'insurance' || chance(0.55);
        if (o.r === 'auto') {
          var T;
          var target = o.plan === 'soon' ? AD(today, int(3, 88)) : o.plan === 'locked' ? AD(today, -int(3, 40)) : AD(today, int(95, 420));
          T = o.n > 0 ? D.plusPeriod(target, probe) : target;
          if (monthAligned) T = D.endOfMonth(T);
          var dlT = o.n > 0 ? D.noticeDeadline(T, probe) : T;
          if (o.plan === 'soon' && dlT < today) T = A(T, 1);
          if (o.plan === 'locked' && dlT >= today) T = A(T, -1);
          if (T < today) T = monthAligned ? D.endOfMonth(today) : AD(today, 10);
          var k = o.rm >= 24 ? int(0, 1) : int(0, 3);
          var origEnd = A(T, -k * o.rm);
          c.end = origEnd;
          c.start = A(AD(origEnd, 1), -o.term);
          for (var j = 1; j <= k; j++) {
            var renewedOn = AD(A(origEnd, (j - 1) * o.rm), 1);
            c.history.push({ id: 'h' + (++hid), date: renewedOn, kind: 'renewal', text: 'Renewed automatically for ' + o.rm + ' months', oldAmount: null, newAmount: null });
          }
        } else if (o.r === 'fixed') {
          var end;
          if (o.plan === 'soon') end = o.n > 0 ? D.plusPeriod(AD(today, int(5, 85)), probe) : AD(today, int(10, 80));
          else if (o.plan === 'past') end = AD(today, -int(20, 200));
          else if (o.plan === 'future') end = null;
          else end = o.n > 0 ? D.plusPeriod(AD(today, int(95, Math.max(160, o.term * 30 - 30))), probe) : AD(today, int(95, Math.max(160, o.term * 30 - 30)));
          if (end && monthAligned) end = D.endOfMonth(end);
          if (end && o.plan === 'soon' && o.n > 0 && D.noticeDeadline(end, probe) < today) end = A(end, 1);
          if (o.plan === 'future') {
            c.start = firstOfMonth(AD(today, int(35, 80)));
            c.end = AD(A(c.start, o.term), -1);
          } else {
            c.end = end;
            c.start = A(AD(end, 1), -o.term);
          }
          if (o.plan === 'past') { c.status = 'ended'; c.endsOn = c.end; }
        } else {
          c.start = firstOfMonth(AD(today, -int(200, 2400)));
          c.end = '';
        }

        // ── value ──
        var amt = o.a || 0;
        if (amt && o.per !== 'once') amt = amt * (0.92 + R() * 0.16);
        amt = amt >= 1000 ? Math.round(amt / 10) * 10 : r2(amt);
        if (o.ix === 'cpi' && o.per !== 'once' && amt) {
          // history of indexations so far; the current amount is the result
          var dates = D.indexDates(Object.assign({}, c, { status: 'active', renewal: 'auto' }), c.start, today);
          var base = r2(amt / Math.pow(1.03, dates.length)), cur = base;
          dates.forEach(function (d) {
            var pct = r2(1.6 + R() * 3.2), nv = r2(cur * (1 + pct / 100));
            c.history.push({ id: 'h' + (++hid), date: d, kind: 'price', text: 'CPI indexation +' + String(pct).replace('.', ',') + ' %', oldAmount: cur, newAmount: nv, applied: true });
            cur = nv;
          });
          amt = cur;
        }
        c.amount = amt;
        if (o.ix === 'fixed' && amt) {
          var nj = (+today.slice(0, 4) + 1) + '-01-01';
          c.history.push({ id: 'h' + (++hid), date: nj, kind: 'price', text: 'Contractual price step +' + o.ixp + ' % (announced)', oldAmount: amt, newAmount: r2(amt * (1 + o.ixp / 100)) });
        }
        if (cat === 'software' && o.ix === 'none' && chance(0.3) && amt) {
          var sd = D.startOfMonth(AD(today, int(20, 80)));
          var pct2 = pick([6, 8, 9, 12]);
          c.history.push({ id: 'h' + (++hid), date: sd, kind: 'price', text: 'Vendor price list change +' + pct2 + ' % (notice received)', oldAmount: amt, newAmount: r2(amt * (1 + pct2 / 100)) });
        }
        if (cat === 'lease') {
          if (chance(0.6)) { c.deposit = Math.round(amt * 3 / 10) * 10; c.depositType = 'deposit'; } else { c.deposit = Math.round(amt * 6 / 10) * 10; c.depositType = 'bank guarantee'; }
        } else if (cat === 'vehicles' && /Operating/.test(o.t)) { c.deposit = Math.round(amt * 2 / 10) * 10; c.depositType = 'deposit'; }
        else if (cat === 'logistics' && /3PL/.test(o.t)) { c.deposit = 5000; c.depositType = 'bank guarantee'; }

        // ── texts ──
        var y = c.start.slice(0, 4);
        seqByYear[y] = (seqByYear[y] || 0) + 1;
        c.no = 'CT-' + y + '-' + String(seqByYear[y]).padStart(3, '0');
        c.terms = o.terms || termsFor(cat, o, c);
        var fn = pick(FIRST), ln = pick(LAST);
        c.contact = { name: fn + ' ' + ln, email: slug(fn) + '.' + slug(ln) + '@' + slug(o.p) + '.example.com', phone: (c.company === 'RHR' ? '+385 1 555 ' : '+386 1 555 ') + pad2(int(10, 99)) + ' ' + pad2(int(10, 99)) };
        if (o.per !== 'once' && amt) c.iban = ibanFor(c.company === 'RHR' ? 'HR' : 'SI');
        c.createdAt = c.start + 'T09:00';
        c.updatedAt = c.start + 'T09:00';

        // documents (names only in the demo)
        if (!(chance(0.09) || (c.owner === '' && chance(0.4)))) {
          var base2 = c.no + '_' + slug(o.p);
          c.docs.push({ id: 'd' + nid + 'a', name: base2 + '_signed.pdf', size: int(180, 2400) * 1024, type: 'application/pdf', added: c.start, hash: '', demo: true });
          if (cat === 'lease' || cat === 'supplier' || chance(0.25)) c.docs.push({ id: 'd' + nid + 'b', name: base2 + (cat === 'supplier' ? '_rebate_schedule.pdf' : cat === 'lease' ? '_annex_1.pdf' : '_price_list.pdf'), size: int(60, 600) * 1024, type: 'application/pdf', added: AD(c.start, int(20, 300)) < today ? AD(c.start, int(20, 300)) : c.start, hash: '', demo: true });
        }
        // amendments
        if ((cat === 'lease' || cat === 'supplier' || cat === 'software') && chance(0.55) && c.start < AD(today, -120)) {
          var ad = AD(c.start, int(60, Math.max(61, D.diffDays(c.start, today) - 30)));
          c.history.push({ id: 'h' + (++hid), date: ad, kind: 'amendment', text: pick(cat === 'lease' ? ['Annex 1: storage room added (+18 m²)', 'Annex: opening hours aligned with the centre', 'Annex: fit-out contribution 25.000 € agreed'] : cat === 'supplier' ? ['Annex: rebate tiers updated', 'Annex: payment terms 60 → 75 days', 'Annex: free returns of 5 % of yearly volume'] : ['Order form: 10 extra seats', 'Annex: SLA upgraded to 99,9 %', 'Annex: data processing agreement (GDPR)']), oldAmount: null, newAmount: null });
        }
        c.history.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
        contracts.push(c);
      });
    });

    // ── statuses, decisions, notes ──
    var soonList = [];
    contracts.forEach(function (c) {
      if (c.status === 'draft' || c.status === 'ended') return;
      var nd = D.nextDeadline(c, today);
      if (nd && nd.kind !== 'open' && D.diffDays(today, nd.deadline) <= 90) soonList.push({ c: c, nd: nd });
    });
    soonList.sort(function (a, b) { return a.nd.deadline < b.nd.deadline ? -1 : 1; });
    soonList.forEach(function (x, i) {
      var c = x.c, r = i % 6;
      if (r === 0) { c.status = 'negotiation'; c.decision = { choice: 'renegotiate', due: AD(x.nd.deadline, -14) < today ? x.nd.deadline : AD(x.nd.deadline, -14), note: 'Asked for a counter-offer; compare with one alternative supplier.' }; }
      else if (r === 2) c.decision = { choice: 'renew', due: '', note: 'Service fine, price competitive.' };
      else if (r === 4 && c.amount * ({ month: 12, quarter: 4, year: 1 }[c.per] || 0) > 40000) c.decision = { choice: 'renegotiate', due: AD(x.nd.deadline, -14) < today ? x.nd.deadline : AD(x.nd.deadline, -14), note: 'Volume grew; ask for a better tier before the deadline.' };
      else if (r === 4) c.decision = { choice: 'cancel', due: AD(x.nd.deadline, -7) < today ? x.nd.deadline : AD(x.nd.deadline, -7), note: 'Overlaps with another contract; send notice in writing (registered mail).' };
      else c.decision = { choice: 'undecided', due: AD(x.nd.deadline, -10) < today ? x.nd.deadline : AD(x.nd.deadline, -10), note: '' };
    });
    // a few contracts where notice was already given (ending)
    var endingPicks = contracts.filter(function (c) { return c.status === 'active' && c.renewal !== 'fixed' && c.category !== 'lease' && c.category !== 'nda'; });
    [3, 11, 19, 27, 35].forEach(function (i) {
      var c = endingPicks[i];
      if (!c) return;
      var te = c.renewal === 'auto' ? D.currentTermEnd(c, today) : D.earliestOpenEnd(c, AD(today, -int(5, 25))).end;
      c.status = 'ending'; c.endsOn = te;
      c.history.push({ id: 'h' + (++hid), date: AD(today, -int(3, 30)), kind: 'notice', text: 'Notice of termination sent by registered mail; ends ' + D.fmt(te), oldAmount: null, newAmount: null });
      c.decision = { choice: 'cancel', due: '', note: 'Replaced by a group-wide contract.' };
    });
    // an open-ended contract (30 days to a month end) the business wants to leave: its monthly deadline is tracked
    contracts.forEach(function (c) {
      if (c.status !== 'active' || c.renewal !== 'open' || !c.noticeEom || c.party !== 'Valuta Instant d.o.o.') return;
      var nd = D.nextDeadline(c, today);
      c.decision = { choice: 'cancel', due: nd ? nd.deadline : '', note: 'Pilot not used enough; end it at the next possible month end.' };
    });
    // milestones and notes
    contracts.forEach(function (c, i) {
      if (c.category === 'lease' && c.status !== 'ended' && i % 3 === 0) c.milestones.push({ id: 'm' + c.id, date: AD(today, int(10, 70)), label: 'Ask landlord for renewal offer' });
      if (c.category === 'supplier' && i % 4 === 1) c.milestones.push({ id: 'm' + c.id, date: AD(today, int(15, 120)), label: 'Volume review meeting (rebate tier check)' });
      if (i % 5 === 2) c.notes.push({ id: 'n' + c.id, ts: AD(today, -int(5, 120)) + 'T' + pad2(int(8, 17)) + ':' + pad2(int(0, 59)), by: (PEOPLE.filter(function (p) { return p.id === c.owner; })[0] || PEOPLE[0]).name, text: pick(['Invoice amounts match the contract.', 'Counterparty asked for an updated certificate of insurance.', 'Discussed volume forecast for next year.', 'Price comparison requested from two alternatives.', 'Signed copy received by post; scanned.']) });
    });

    return {
      version: VERSION, generatedFor: today, contracts: contracts,
      settings: { remind: CATEGORIES.reduce(function (m, k) { m[k.id] = k.remind; return m; }, {}), cpi: 3.0, handled: {}, me: 'p1' }
    };
  }

  function termsFor(cat, o, c) {
    var pf = { monthly: 'monthly in advance', yearly: 'yearly in advance', quarterly: 'quarterly', 'per order': 'per order, 60 days', none: '—' }[o.pf] || o.pf;
    switch (cat) {
      case 'lease': return 'Rent ' + pf + ', indexed yearly by CPI (SURS/DZS) on the anniversary. Service charge billed separately as an advance with a yearly settlement. Fit-out at tenant\'s cost; reinstatement on exit. ' + (o.r === 'auto' ? 'After the initial term the lease extends by ' + o.rm + ' months unless terminated ' + o.n + ' months before the end.' : 'Option to extend by 5 years on written notice ' + o.n + ' months before expiry.');
      case 'supplier': return 'Framework agreement; prices per the yearly price list. ' + (o.rebate ? 'Volume rebate ' + o.rebate[1] + ' % above ' + o.rebate[0].toLocaleString('sl-SI') + ' € and ' + o.rebate[3] + ' % above ' + o.rebate[2].toLocaleString('sl-SI') + ' € net purchases per year, credited in Q1. ' : '') + 'Payment 60 days; free shipping above 500 €; defective goods replaced within 30 days.';
      case 'logistics': return 'Price per parcel by weight band; fuel surcharge per monthly index; daily pickup at the warehouse; liability per the carrier\'s general terms.';
      case 'payments': return 'Fees deducted from settlements; monthly fee statement; PCI DSS self-assessment yearly.';
      case 'software': return 'Subscription billed ' + pf + '. SLA 99,5 %; support on business days 8–16; data export on exit within 30 days; DPA signed.';
      case 'telecom': return 'Billed ' + pf + '. Early exit fee = remaining monthly fees of the fixed term.';
      case 'insurance': return 'Premium billed ' + pf + '. Deductible 500 € per claim; sums insured reviewed yearly before renewal.';
      case 'vehicles': return 'Monthly instalment incl. service, tyres and insurance; 25.000 km/year; excess km 0,08 €/km. Return condition per the lessor\'s guide.';
      case 'marketing': return 'Retainer billed ' + pf + '; media spend billed at cost; monthly report by the 5th working day.';
      case 'maintenance': return 'Preventive maintenance twice a year; on-site response within 48 h; spare parts at list price −15 %.';
      case 'facility': return 'Service schedule per annex; billed ' + pf + '; replacements for absent staff guaranteed.';
      case 'nda': return 'Mutual confidentiality; no fees. Obligations survive ' + (o.term >= 36 ? '5' : '3') + ' years after expiry. Governing law: Slovenia.';
      case 'staffing': return 'Hourly rate per worker category; billed ' + pf + ' by actual hours; agency is the employer of record.';
    }
    return '';
  }

  window.ContractsData = {
    VERSION: VERSION, COMPANIES: COMPANIES, LOCATIONS: LOCATIONS, PEOPLE: PEOPLE, CATEGORIES: CATEGORIES,
    STATUSES: STATUSES, RENEWALS: RENEWALS, CURRENCIES: CURRENCIES, generate: generate
  };
})();
