/* Marketing calendar demo — catalogues, key dates and the deterministic demo-data generator.
 * Everything here is FICTIONAL: people, e-mails (@example.com), brands, influencer handles, codes and every number.
 * generate(todayYmd) always produces the same records for the same day: campaigns span 12 months back and
 * 3 months ahead of the month of the first load. Daily performance is NOT stored: perfFor() derives it from
 * each campaign (seeded by the campaign's own perf seed), so it is identical on every load and stays small. */
(function (global) {
  'use strict';

  var SEED = 20261007;

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // stateless hash → [0,1) for (seed, a, b, c)
  function h01(s, a, b, c) {
    var x = (s | 0) ^ Math.imul(a | 0, 0x9E3779B1) ^ Math.imul((b | 0) + 0x7F4A7C15, 0x85EBCA77) ^ Math.imul((c | 0) + 0x165667B1, 0xC2B2AE3D);
    x = Math.imul(x ^ (x >>> 16), 0x7FEB352D); x = Math.imul(x ^ (x >>> 15), 0x846CA68B); x ^= x >>> 16;
    return (x >>> 0) / 4294967296;
  }
  function strHash(str) { var h = 2166136261; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  // ── Day numbers (UTC days since 1970-01-01; no DST surprises) ─────────────
  function dnum(ymd) { var p = String(ymd).split('-'); return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 864e5); }
  function ymdOf(n) { return new Date(n * 864e5).toISOString().slice(0, 10); }
  function dow(n) { return ((n + 3) % 7 + 7) % 7; } // 0 = Monday … 6 = Sunday
  function ymParts(n) { var d = new Date(n * 864e5); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() }; }
  function dmake(y, m, d) { return Math.round(Date.UTC(y, m - 1, d) / 864e5); }
  function nthDow(y, m, wd, n) { var first = dmake(y, m, 1); var off = (wd - dow(first) + 7) % 7; return first + off + (n - 1) * 7; }
  function lastOfMonth(y, m) { return dmake(y, m + 1, 0); }
  function easter(y) {
    var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    var h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    var month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return dmake(y, month, day);
  }
  function blackFriday(y) { return nthDow(y, 11, 3, 4) + 1; } // the day after the 4th Thursday of November
  function todayLj() {
    try {
      var p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Ljubljana', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
      var o = {}; p.forEach(function (x) { o[x.type] = x.value; });
      return o.year + '-' + o.month + '-' + o.day;
    } catch (e) { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  }

  // ── Catalogues (constants, not stored) ────────────────────────────────────
  var MARKETS = [
    { id: 'SI', name: 'Slovenia', short: 'SI', tone: 'violet', aov: 92, list: 42000, sms: 12000, reach: 5200, base: 6400 },
    { id: 'HR', name: 'Croatia', short: 'HR', tone: 'blue', aov: 84, list: 55000, sms: 15000, reach: 6600, base: 7600 },
    { id: 'IT', name: 'Italy', short: 'IT', tone: 'teal', aov: 108, list: 70000, sms: 9000, reach: 8100, base: 9800 },
    { id: 'ALL', name: 'All markets', short: 'All', tone: 'clay', aov: 96, list: 167000, sms: 36000, reach: 19900, base: 23800 }
  ];
  // share of an all-market campaign's money that counts toward each market (budget view)
  var ALL_SPLIT = { SI: 0.3, HR: 0.3, IT: 0.4 };

  var GROUPS = [
    { id: 'search', name: 'Search & shopping', tone: 'blue' },
    { id: 'social', name: 'Paid social', tone: 'violet' },
    { id: 'crm', name: 'E-mail & SMS', tone: 'teal' },
    { id: 'organic', name: 'Organic & influencers', tone: 'green' },
    { id: 'affiliate', name: 'Affiliate & comparison', tone: 'clay' },
    { id: 'offline', name: 'In-store & radio/outdoor', tone: 'grey' }
  ];

  // kind: cpc = paid per click, list = paid per send, reach = free reach, fee = paid reach (cpm), store = footfall, broadcast = radio/outdoor
  var CHANNELS = [
    { id: 'gads_search', name: 'Google Ads · Search', short: 'Search', group: 'search', kind: 'cpc', w: 2, cpc: 0.55, ctr: 0.048, cvr: 0.034, nc: 0.45, utm: ['google', 'cpc'] },
    { id: 'gads_shopping', name: 'Google Ads · Shopping', short: 'Shopping', group: 'search', kind: 'cpc', w: 3, cpc: 0.32, ctr: 0.012, cvr: 0.024, nc: 0.5, utm: ['google', 'cpc'] },
    { id: 'gads_pmax', name: 'Google Ads · PMax', short: 'PMax', group: 'search', kind: 'cpc', w: 3, cpc: 0.38, ctr: 0.016, cvr: 0.022, nc: 0.48, utm: ['google', 'cpc'] },
    { id: 'meta', name: 'Meta (Facebook/Instagram)', short: 'Meta', group: 'social', kind: 'cpc', w: 3, cpc: 0.48, ctr: 0.011, cvr: 0.014, nc: 0.55, utm: ['facebook', 'paid_social'] },
    { id: 'tiktok', name: 'TikTok', short: 'TikTok', group: 'social', kind: 'cpc', w: 2, cpc: 0.36, ctr: 0.008, cvr: 0.007, nc: 0.7, utm: ['tiktok', 'paid_social'] },
    { id: 'newsletter', name: 'Newsletter (e-mail)', short: 'Newsletter', group: 'crm', kind: 'list', w: 0, unit: 0.0015, ctr: 0.016, cvr: 0.032, nc: 0.08, utm: ['newsletter', 'email'] },
    { id: 'sms', name: 'SMS', short: 'SMS', group: 'crm', kind: 'list', w: 0, unit: 0.045, ctr: 0.05, cvr: 0.035, nc: 0.05, utm: ['sms', 'sms'] },
    { id: 'organic', name: 'Organic social posts', short: 'Organic', group: 'organic', kind: 'reach', w: 0, ctr: 0.006, cvr: 0.015, nc: 0.4, utm: ['instagram', 'social'] },
    { id: 'influencer', name: 'Influencers', short: 'Influencers', group: 'organic', kind: 'fee', w: 2.5, cpm: 9, ctr: 0.007, cvr: 0.012, nc: 0.65, utm: ['instagram', 'influencer'] },
    { id: 'affiliate', name: 'Affiliate / price comparison', short: 'Affiliate', group: 'affiliate', kind: 'cpc', w: 1.2, cpc: 0.28, ctr: 0.03, cvr: 0.03, nc: 0.4, utm: ['pricecompare', 'affiliate'] },
    { id: 'pos', name: 'In-store POS material', short: 'In-store POS', group: 'offline', kind: 'store', w: 1, cvr: 0.003, nc: 0.3, utm: ['instore', 'qr'] },
    { id: 'radio', name: 'Radio / outdoor', short: 'Radio/outdoor', group: 'offline', kind: 'broadcast', w: 3, cpm: 2.5, cvr: 0.02, nc: 0.5, utm: ['radio', 'offline'] }
  ];

  var TYPES = [
    { id: 'seasonal_sale', name: 'Seasonal sale', big: true, sale: true, roas: 5 },
    { id: 'brand_launch', name: 'Brand launch', roas: 2.5 },
    { id: 'new_collection', name: 'New collection', roas: 3 },
    { id: 'cl_subscription', name: 'Contact-lens subscription push', roas: 4, aovF: 0.7 },
    { id: 'eye_exam', name: 'Eye-exam promotion (stores)', roas: 3 },
    { id: 'black_friday', name: 'Black Friday', big: true, sale: true, roas: 6, aovF: 0.95 },
    { id: 'back_to_school', name: 'Back-to-school', big: true, sale: true, roas: 4, aovF: 0.9 },
    { id: 'summer_sun', name: 'Summer sunglasses', big: true, sale: true, roas: 5, aovF: 1.25 },
    { id: 'valentines', name: "Valentine's", roas: 4 },
    { id: 'newsletter', name: 'Newsletter', roas: 20 },
    { id: 'influencer', name: 'Influencer', roas: 2.5 },
    { id: 'pr', name: 'PR', roas: 1.5 },
    { id: 'instore_event', name: 'In-store event', roas: 3 },
    { id: 'other', name: 'Other / always-on ads', roas: 3 } // used by live-mode imports; the demo generator never picks it
  ];

  var STATUSES = [
    { id: 'idea', name: 'Idea', tone: 'grey' },
    { id: 'planned', name: 'Planned', tone: 'blue' },
    { id: 'production', name: 'In production', tone: 'violet' },
    { id: 'live', name: 'Live', tone: 'green' },
    { id: 'done', name: 'Done', tone: 'teal' },
    { id: 'cancelled', name: 'Cancelled', tone: 'clay' }
  ];

  var CHECKLIST = [
    { id: 'brief', name: 'Brief' },
    { id: 'creatives', name: 'Creatives' },
    { id: 'landing', name: 'Landing page' },
    { id: 'tracking', name: 'Tracking / UTM set up' },
    { id: 'legal', name: 'Legal OK (T&Cs, price claims)' },
    { id: 'scheduled', name: 'Scheduled in all channels' }
  ];

  var TEAM = [
    { id: 'u1', name: 'Ana Kralj', initials: 'AK', role: 'Performance marketing · SI', email: 'ana.kralj@example.com', tone: 'violet', owner: true },
    { id: 'u2', name: 'Marko Perić', initials: 'MP', role: 'Market lead · HR', email: 'marko.peric@example.com', tone: 'blue', owner: true },
    { id: 'u3', name: 'Giulia Moretti', initials: 'GM', role: 'Market lead · IT', email: 'giulia.moretti@example.com', tone: 'teal', owner: true },
    { id: 'u4', name: 'Eva Zajc', initials: 'EZ', role: 'CRM: newsletter & SMS', email: 'eva.zajc@example.com', tone: 'green', owner: true },
    { id: 'u5', name: 'Tomaž Golob', initials: 'TG', role: 'Content & social', email: 'tomaz.golob@example.com', tone: 'clay', owner: true },
    { id: 'u6', name: 'Petra Vukić', initials: 'PV', role: 'Brand & retail', email: 'petra.vukic@example.com', tone: 'grey', owner: true },
    { id: 'u7', name: 'Lara Mlakar', initials: 'LM', role: 'Design', email: 'lara.mlakar@example.com', tone: 'violet', owner: false },
    { id: 'u8', name: 'Jan Kos', initials: 'JK', role: 'Copywriting', email: 'jan.kos@example.com', tone: 'blue', owner: false }
  ];

  var STORES = [
    { id: 'SI-LJC', market: 'SI', name: 'Ljubljana Center' }, { id: 'SI-LJS', market: 'SI', name: 'Ljubljana Šiška' },
    { id: 'SI-MB', market: 'SI', name: 'Maribor' }, { id: 'SI-CE', market: 'SI', name: 'Celje' },
    { id: 'SI-KR', market: 'SI', name: 'Kranj' }, { id: 'SI-KP', market: 'SI', name: 'Koper' }, { id: 'SI-NM', market: 'SI', name: 'Novo mesto' },
    { id: 'HR-ZGC', market: 'HR', name: 'Zagreb Centar' }, { id: 'HR-ZGN', market: 'HR', name: 'Novi Zagreb' },
    { id: 'HR-ST', market: 'HR', name: 'Split' }, { id: 'HR-RI', market: 'HR', name: 'Rijeka' },
    { id: 'HR-OS', market: 'HR', name: 'Osijek' }, { id: 'HR-ZD', market: 'HR', name: 'Zadar' }
  ];

  var CONTENT_STATUSES = [
    { id: 'brief', name: 'Brief', tone: 'grey' },
    { id: 'design', name: 'Design', tone: 'clay' },
    { id: 'review', name: 'Review', tone: 'violet' },
    { id: 'approved', name: 'Approved', tone: 'blue' },
    { id: 'scheduled', name: 'Scheduled', tone: 'teal' },
    { id: 'published', name: 'Published', tone: 'green' }
  ];
  var CONTENT_CHANNELS = [
    { id: 'instagram', name: 'Instagram', group: 'organic' },
    { id: 'facebook', name: 'Facebook', group: 'organic' },
    { id: 'tiktok', name: 'TikTok', group: 'social' },
    { id: 'newsletter', name: 'Newsletter', group: 'crm' },
    { id: 'sms', name: 'SMS', group: 'crm' }
  ];

  var BRANDS = ['Lumen Eyewear', 'Nordlys', 'Vista Nova', 'Aurelia', 'Kestrel Sport', 'Mareo', 'Tessa Kids', 'Solano'];
  var HANDLES = ['vida.looks', 'tina.travels', 'marko.runs', 'lea.style', 'ivo.cooks', 'sara.reads', 'nika.daily', 'matteo.urbano', 'chiara.viaggia', 'luka.outdoor'];
  var TAGS = ['frames', 'sunglasses', 'contact lenses', 'kids', 'gifting', 'premium', 'always-on', 'test', 'stores', 'webshop', 'retargeting', 'brand'];

  var CAPTIONS = [
    'New season, new view. Meet the {brand} collection — {offer}.',
    'Sun is out, lenses on. Polarised styles from {brand} for every road trip.',
    'Your eyes deserve a check-up too. Book a free eye exam in {store}.',
    'Two pairs, one smile: {offer} with code {code}.',
    'Contact lenses delivered every month — no more running out on a Sunday evening.',
    'Behind the counter: how our opticians fit progressive lenses.',
    'Five frame shapes and the faces they flatter. Which one is you?',
    'Last chance: {offer} ends at midnight. Code {code}.',
    'Back to class with frames that survive the playground. {offer}.',
    'Gift idea: a voucher for a full eye exam and new frames.',
    'Screen all day? Here is how blue-light lenses actually help (and when they do not).',
    'Our team picks: the three sunglasses everyone tried on this week.',
    'Black Friday is here: {offer}. Code {code} at checkout.',
    'Weekend in {store}: free frame adjustment and cleaning, no appointment needed.',
    'Swipe to see the {brand} colours in daylight.',
    'Customer story: from fogged glasses to daily lenses in one week.',
    'Spring cleaning for your glasses: four tips from our opticians.',
    'Free shipping on contact lenses this week — and a case on us.',
    'Valentine’s for two: {offer}.',
    'Ask an optician live tonight at 20:00 — bring your questions about lenses.'
  ];
  var NL_SUBJECTS = ['Your monthly view: what is new', 'Fresh frames just landed', 'Lenses running low? Reorder in one click', 'The sunglasses edit', 'Last days of the sale', 'Eye exam season — book now', 'Gift guide: for everyone who wears glasses', 'Black Friday starts now', 'Back to school checklist'];
  var COMMENTS = [
    'Creatives v2 are in the shared folder — please review by Thursday.',
    'Legal OK’d the T&Cs for the code; price claims checked against the shop.',
    'Can we shift the start by two days? Stock for the hero frames arrives on Tuesday.',
    'Shopping feed checked — all products in the promo are active.',
    'ROAS below target after week 1, moving 20 % of the TikTok budget to PMax.',
    'Landing page is live on staging, waiting for final copy.',
    'Store teams briefed; POS posters ship on Monday.',
    'Newsletter segment excludes customers who bought in the last 14 days.',
    'Influencer content approved, posting schedule attached.',
    'Great week: orders up compared with the same promo last year.',
    'Please add UTM parameters to the SMS link before sending.',
    'Discount code tested on mobile checkout — works.'
  ];
  var NOTES = [
    'Hero product: lightweight titanium frames. Keep the message simple — one offer, one code.',
    'Last year this promo peaked on the second weekend; front-load social budget.',
    'Coordinate with the stores: posters, window stickers and a short staff briefing.',
    'Exclude contact lenses from the discount (margin).',
    'Test two creatives on Meta: lifestyle vs product-on-white.',
    ''
  ];

  // ── Key dates per market (computed, never stored) ────────────────────────
  // kind: holiday (public holiday), commerce (retail moment), school (school holidays, approximate), season (range)
  function keyDatesYear(y) {
    var out = [];
    function add(market, d, name, kind, end) { out.push({ market: market, d: d, e: end == null ? d : end, name: name, kind: kind }); }
    var E = easter(y);
    // Slovenia — public holidays (work-free days)
    [[1, 1, 'New Year'], [1, 2, 'New Year'], [2, 8, 'Prešeren Day'], [4, 27, 'Day of Uprising Against Occupation'], [5, 1, 'Labour Day'], [5, 2, 'Labour Day'],
      [6, 25, 'Statehood Day'], [8, 15, 'Assumption Day'], [10, 31, 'Reformation Day'], [11, 1, 'Remembrance Day'], [12, 25, 'Christmas'], [12, 26, 'Independence and Unity Day']]
      .forEach(function (h) { add('SI', dmake(y, h[0], h[1]), h[2], 'holiday'); });
    add('SI', E, 'Easter Sunday', 'holiday'); add('SI', E + 1, 'Easter Monday', 'holiday'); add('SI', E + 49, 'Whit Sunday', 'holiday');
    // Croatia
    [[1, 1, 'New Year'], [1, 6, 'Epiphany'], [5, 1, 'Labour Day'], [5, 30, 'Statehood Day'], [6, 22, 'Anti-Fascist Struggle Day'], [8, 5, 'Victory Day'],
      [8, 15, 'Assumption Day'], [11, 1, 'All Saints’ Day'], [11, 18, 'Remembrance Day'], [12, 25, 'Christmas'], [12, 26, 'St Stephen’s Day']]
      .forEach(function (h) { add('HR', dmake(y, h[0], h[1]), h[2], 'holiday'); });
    add('HR', E, 'Easter Sunday', 'holiday'); add('HR', E + 1, 'Easter Monday', 'holiday'); add('HR', E + 60, 'Corpus Christi', 'holiday');
    // Italy
    [[1, 1, 'Capodanno'], [1, 6, 'Epifania'], [4, 25, 'Liberation Day'], [5, 1, 'Labour Day'], [6, 2, 'Republic Day'], [8, 15, 'Ferragosto'],
      [11, 1, 'All Saints’ Day'], [12, 8, 'Immaculate Conception'], [12, 25, 'Christmas'], [12, 26, 'St Stephen’s Day']]
      .forEach(function (h) { add('IT', dmake(y, h[0], h[1]), h[2], 'holiday'); });
    add('IT', E, 'Easter Sunday', 'holiday'); add('IT', E + 1, 'Easter Monday (Pasquetta)', 'holiday');
    // Retail moments
    add('ALL', dmake(y, 2, 14), 'Valentine’s Day', 'commerce');
    add('SI', dmake(y, 3, 25), 'Mother’s Day (SI)', 'commerce');
    add('HR', nthDow(y, 5, 6, 2), 'Mother’s Day (HR)', 'commerce');
    add('IT', nthDow(y, 5, 6, 2), 'Mother’s Day (IT)', 'commerce');
    add('HR', dmake(y, 3, 19), 'Father’s Day (HR)', 'commerce');
    add('IT', dmake(y, 3, 19), 'Father’s Day (IT)', 'commerce');
    var BF = blackFriday(y);
    add('ALL', BF, 'Black Friday', 'commerce'); add('ALL', BF + 3, 'Cyber Monday', 'commerce');
    add('SI', dmake(y, 9, 1), 'Back to school (SI)', 'commerce');
    add('HR', nthDow(y, 9, 0, 1), 'Back to school (HR)', 'commerce');
    add('IT', dmake(y, 9, 14), 'Back to school (IT, varies by region)', 'commerce');
    add('ALL', dmake(y, 6, 1), 'Summer sunglasses season', 'season', dmake(y, 8, 31));
    add('ALL', dmake(y, 12, 1), 'Christmas shopping', 'season', dmake(y, 12, 24));
    // School holidays (approximate — exact dates vary by year and region)
    var oct31 = dmake(y, 10, 31), autumnMon = oct31 - dow(oct31);
    add('SI', autumnMon, 'Autumn school holidays (approx.)', 'school', autumnMon + 4);
    add('SI', nthDow(y, 2, 0, 3), 'Winter school holidays (approx., by region)', 'school', nthDow(y, 2, 0, 3) + 11);
    add('SI', dmake(y, 6, 25), 'Summer school holidays (approx.)', 'school', dmake(y, 8, 31));
    add('SI', dmake(y, 12, 25), 'Christmas school holidays (approx.)', 'school', dmake(y + 1, 1, 2));
    add('HR', dmake(y, 6, 20), 'Summer school holidays (approx.)', 'school', nthDow(y, 9, 0, 1) - 1);
    add('HR', dmake(y, 12, 24), 'Winter school holidays (approx.)', 'school', dmake(y + 1, 1, 9));
    add('HR', E - 3, 'Spring school holidays (approx.)', 'school', E + 5);
    add('IT', dmake(y, 6, 10), 'Summer school holidays (approx., by region)', 'school', dmake(y, 9, 13));
    add('IT', dmake(y, 12, 23), 'Christmas school holidays (approx.)', 'school', dmake(y + 1, 1, 6));
    add('IT', E - 3, 'Easter school holidays (approx.)', 'school', E + 2);
    return out;
  }
  var kdCache = {};
  function keyDates(from, to) {
    var a = ymParts(from).y - 1, b = ymParts(to).y, out = [];
    for (var y = a; y <= b; y++) { if (!kdCache[y]) kdCache[y] = keyDatesYear(y); out = out.concat(kdCache[y]); }
    return out.filter(function (k) { return k.e >= from && k.d <= to; }).sort(function (x, y2) { return x.d - y2.d || x.e - y2.e; });
  }

  // ── Generator ─────────────────────────────────────────────────────────────
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var MKT_ONLY = ['SI', 'HR', 'IT'];
  var OWNER_OF = { SI: 'u1', HR: 'u2', IT: 'u3', ALL: 'u6' };

  function slug(s) { return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

  function generate(todayYmd) {
    var R = mulberry32(SEED);
    function rnd(a, b) { return a + R() * (b - a); }
    function ri(a, b) { return Math.floor(rnd(a, b + 1)); }
    function pick(arr) { return arr[Math.floor(R() * arr.length)]; }
    function chance(p) { return R() < p; }
    function round(v, step) { return Math.round(v / step) * step; }

    var today = dnum(todayYmd), nowMs = today * 864e5 + 8 * 36e5;
    var tp = ymParts(today);
    var rangeFrom = dmake(tp.y, tp.m - 12, 1), rangeTo = lastOfMonth(tp.y, tp.m + 3);
    var campaigns = [], seq = 0;

    function camp(o) {
      if (o.e < rangeFrom || o.s > rangeTo) return null;
      var market = o.market, t = TYPES.filter(function (x) { return x.id === o.type; })[0];
      var y = ymParts(o.s).y;
      var c = {
        id: ++seq,
        name: o.name.replace('{y}', y).replace('{m}', MONTHS[ymParts(o.s).m - 1]) + (market !== 'ALL' && !o.noSuffix ? ' · ' + market : ''),
        market: market, type: o.type, channels: o.ch.slice(),
        owner: o.owner || OWNER_OF[market],
        status: 'planned', start: ymdOf(o.s), end: ymdOf(o.e),
        budget: o.budget, code: o.code ? o.code + (market !== 'ALL' ? '-' + market : '') : '', offer: o.offer || '',
        url: 'https://example.com/' + (market === 'ALL' ? 'campaign' : market.toLowerCase()) + '/' + slug(o.name.replace('{y}', y).replace('{m}', MONTHS[ymParts(o.s).m - 1])),
        targets: null, tags: o.tags || [], stores: [],
        checklist: {}, notes: '', comments: [], files: [], utms: [], content: [],
        seed: (strHash(o.name + '|' + market + '|' + o.s) ^ SEED) >>> 0,
        createdAt: (o.s - 21) * 864e5 + 9 * 36e5, updatedAt: 0
      };
      // stores for in-store work
      if ((o.type === 'eye_exam' || o.type === 'instore_event' || c.channels.indexOf('pos') >= 0) && market !== 'IT') {
        var pool = STORES.filter(function (st) { return market === 'ALL' ? true : st.market === market; });
        var n = o.type === 'instore_event' ? ri(1, 2) : ri(2, Math.min(5, pool.length));
        pool = pool.slice().sort(function () { return R() - 0.5; });
        c.stores = pool.slice(0, n).map(function (st) { return st.id; }).sort();
      }
      if (market === 'IT') c.channels = c.channels.filter(function (ch) { return ch !== 'pos'; });
      if (!c.channels.length) c.channels = ['organic'];
      // targets
      var aov = mkt(market).aov * (t.aovF || 1);
      var rev = Math.max(500, c.budget * t.roas);
      var ord = Math.max(5, Math.round(rev / aov));
      c.targets = { roas: t.roas, revenue: round(rev, 100), orders: ord, cpa: c.budget ? Math.round(c.budget / ord * 100) / 100 : 0 };
      campaigns.push(c);
      return c;
    }
    function mkt(id) { return MARKETS.filter(function (m) { return m.id === id; })[0]; }
    function bud(a, b, market) { var f = market === 'ALL' ? 2.2 : market === 'IT' ? 1.2 : market === 'HR' ? 1.05 : 1; return round(rnd(a, b) * f, 100); }

    // month by month, from 12 months back to 3 months ahead
    for (var mi = -12; mi <= 3; mi++) {
      var y = tp.y + Math.floor((tp.m - 1 + mi) / 12), m = ((tp.m - 1 + mi) % 12 + 12) % 12 + 1;
      var D = function (d) { return dmake(y, m, d); };
      var each = function (fn) { MKT_ONLY.forEach(function (mk, i) { fn(mk, i); }); };
      var brand = BRANDS[(y * 12 + m) % BRANDS.length];
      if (m === 1) {
        each(function (mk, i) { camp({ name: 'Winter sale {y}', market: mk, type: 'seasonal_sale', s: D(2) + i, e: D(31), ch: ['gads_shopping', 'gads_pmax', 'meta', 'newsletter', 'affiliate'], budget: bud(6000, 10000, mk), code: 'WINTER30', offer: '−30 % on selected frames', tags: ['frames', 'webshop'] }); });
        each(function (mk) { if (mk !== 'IT') camp({ name: 'New year, new lenses', market: mk, type: 'cl_subscription', s: D(12), e: D(12) + 20, ch: ['gads_search', 'meta', 'newsletter', 'sms'], budget: bud(2500, 4000, mk), code: 'LENS50', offer: 'First box of lenses −50 % with a subscription', tags: ['contact lenses'] }); });
      }
      if (m === 2) {
        each(function (mk) { camp({ name: 'Valentine’s 2nd pair', market: mk, type: 'valentines', s: D(1), e: D(14), ch: ['meta', 'tiktok', 'influencer', 'newsletter'], budget: bud(2500, 5000, mk), code: 'LOVE50', offer: 'Second pair −50 %', tags: ['gifting'] }); });
        ['SI', 'HR'].forEach(function (mk) { camp({ name: 'Free eye exam weeks', market: mk, type: 'eye_exam', s: D(16), e: D(16) + 20, ch: ['pos', 'organic', 'sms'].concat(mk === 'SI' ? ['radio'] : []), budget: bud(2000, 3500, mk), code: '', offer: 'Free eye exam with any frame purchase', tags: ['stores'] }); });
      }
      if (m === 3) {
        camp({ name: 'Spring collection {y} — ' + brand, market: 'ALL', type: 'new_collection', s: D(3), e: D(30), ch: ['meta', 'gads_pmax', 'influencer', 'organic', 'newsletter'], budget: bud(5000, 7000, 'ALL'), tags: ['frames', 'brand'] });
        camp({ name: 'Mother’s Day gift card', market: 'SI', type: 'seasonal_sale', s: D(12), e: D(25), ch: ['meta', 'newsletter', 'gads_search'], budget: bud(1800, 2600, 'SI'), code: 'MAMA10', offer: 'Gift cards +10 % value', tags: ['gifting'] });
        camp({ name: 'Lens care month', market: 'IT', type: 'cl_subscription', s: D(9), e: D(31), ch: ['gads_search', 'meta', 'newsletter'], budget: bud(3000, 4500, 'IT'), code: 'CURA15', offer: 'Subscribe & save 15 %', tags: ['contact lenses'] });
      }
      if (m === 4) {
        camp({ name: 'Brand launch — ' + brand, market: 'ALL', type: 'brand_launch', s: D(7), e: D(27), ch: ['meta', 'tiktok', 'influencer', 'gads_search', 'radio'], budget: bud(6000, 8000, 'ALL'), tags: ['brand', 'premium'] });
        camp({ name: 'Press day: ' + brand + ' in Ljubljana', market: 'SI', type: 'pr', s: D(14), e: D(24), ch: ['organic', 'influencer'], budget: bud(1200, 2000, 'SI'), tags: ['brand'], noSuffix: false });
        camp({ name: 'Spring eye-exam weeks', market: 'HR', type: 'eye_exam', s: D(13), e: D(30), ch: ['pos', 'organic', 'sms', 'meta'], budget: bud(1800, 3000, 'HR'), offer: 'Free eye exam + −15 % on lenses', code: 'PREGLED15', tags: ['stores'] });
      }
      if (m === 5) {
        ['HR', 'IT'].forEach(function (mk) { var md = nthDow(y, 5, 6, 2); camp({ name: 'Mother’s Day {y}', market: mk, type: 'seasonal_sale', s: md - 13, e: md, ch: ['meta', 'newsletter', 'gads_search'], budget: bud(1800, 2800, mk), code: 'MAMMA10', offer: '−10 % on sunglasses for mum', tags: ['gifting', 'sunglasses'] }); });
        each(function (mk, i) { camp({ name: 'Summer sunglasses {y}', market: mk, type: 'summer_sun', s: D(25) + i, e: dmake(y, 7, 31), ch: ['gads_shopping', 'gads_pmax', 'meta', 'tiktok', 'influencer', 'affiliate'].concat(mk !== 'IT' ? ['radio'] : []), budget: bud(11000, 17000, mk), code: 'SUN20', offer: 'Sunglasses −20 %', tags: ['sunglasses', 'webshop'] }); });
      }
      if (m === 6) {
        camp({ name: 'Sunglasses fitting day', market: 'SI', type: 'instore_event', s: D(13), e: D(14), ch: ['pos', 'organic', 'sms'], budget: bud(1200, 1800, 'SI'), offer: 'Free sunglasses fitting and cleaning', tags: ['stores', 'sunglasses'] });
        camp({ name: 'Summer with ' + pick(HANDLES), market: 'IT', type: 'influencer', s: D(10), e: D(30), ch: ['influencer', 'tiktok', 'meta'], budget: bud(3500, 5000, 'IT'), code: 'ESTATE15', offer: '−15 % on sunglasses', tags: ['sunglasses'] });
      }
      if (m === 7) {
        camp({ name: 'Summer sale {y}', market: 'SI', type: 'seasonal_sale', s: D(20), e: dmake(y, 8, 17), ch: ['gads_shopping', 'gads_pmax', 'meta', 'newsletter', 'affiliate'], budget: bud(6000, 9000, 'SI'), code: 'SALE40', offer: 'Up to −40 % on frames', tags: ['frames', 'webshop'] });
        ['HR', 'IT'].forEach(function (mk) { camp({ name: 'Summer sale {y}', market: mk, type: 'seasonal_sale', s: dmake(y, 8, 1), e: dmake(y, 8, 24), ch: ['gads_shopping', 'gads_pmax', 'meta', 'newsletter', 'affiliate'], budget: bud(6000, 9000, mk), code: 'SALE40', offer: 'Up to −40 % on frames', tags: ['frames', 'webshop'] }); });
      }
      if (m === 8) {
        each(function (mk, i) { var s2 = mk === 'IT' ? D(28) : D(20) + i; camp({ name: 'Back to school {y}', market: mk, type: 'back_to_school', s: s2, e: s2 + 25, ch: ['gads_search', 'meta', 'tiktok', 'newsletter'].concat(mk !== 'IT' ? ['pos'] : []), budget: bud(4500, 7500, mk), code: 'SCHOOL25', offer: 'Kids’ frames −25 % (lenses included)', tags: ['kids', 'frames'] }); });
      }
      if (m === 9) {
        camp({ name: 'Autumn/winter collection {y} — ' + brand, market: 'ALL', type: 'new_collection', s: D(15), e: D(15) + 27, ch: ['meta', 'gads_pmax', 'influencer', 'organic', 'newsletter', 'radio'], budget: bud(6000, 8000, 'ALL'), tags: ['frames', 'brand'] });
        camp({ name: 'Eye-exam autumn weeks', market: 'SI', type: 'eye_exam', s: D(21), e: D(21) + 27, ch: ['pos', 'organic', 'sms', 'gads_search'], budget: bud(2200, 3200, 'SI'), offer: 'Free eye exam with any frame purchase', tags: ['stores'] });
      }
      if (m === 10) {
        each(function (mk) { camp({ name: 'Contact-lens subscription push', market: mk, type: 'cl_subscription', s: D(1), e: D(31), ch: ['gads_search', 'meta', 'newsletter', 'sms'], budget: bud(3000, 4500, mk), code: 'CLSUB15', offer: 'Subscribe & save 15 % on every delivery', tags: ['contact lenses'] }); });
        camp({ name: 'Optics open day', market: 'HR', type: 'instore_event', s: D(17), e: D(18), ch: ['pos', 'organic', 'sms'], budget: bud(1200, 1800, 'HR'), offer: 'Free vision screening and frame adjustment', tags: ['stores'] });
        camp({ name: 'Brand launch — ' + brand, market: 'IT', type: 'brand_launch', s: D(20), e: D(20) + 20, ch: ['meta', 'tiktok', 'influencer', 'gads_search'], budget: bud(5000, 7000, 'IT'), tags: ['brand', 'premium'] });
      }
      if (m === 11) {
        var BFd = blackFriday(y);
        each(function (mk) { camp({ name: 'Black Friday {y}', market: mk, type: 'black_friday', s: BFd - 7, e: BFd + 3, ch: ['gads_shopping', 'gads_pmax', 'gads_search', 'meta', 'tiktok', 'newsletter', 'sms', 'affiliate'], budget: bud(14000, 22000, mk), code: 'BF50', offer: '−50 % on frames, −30 % on sunglasses', tags: ['frames', 'sunglasses', 'webshop'] }); });
        camp({ name: 'Singles’ week teaser', market: 'HR', type: 'newsletter', s: D(8), e: D(12), ch: ['newsletter', 'sms'], budget: 900, tags: ['test'] });
      }
      if (m === 12) {
        each(function (mk) { camp({ name: 'Christmas gifts {y}', market: mk, type: 'seasonal_sale', s: D(1), e: D(23), ch: ['meta', 'gads_shopping', 'newsletter', 'influencer'], budget: bud(5000, 8000, mk), code: 'XMAS15', offer: 'Free gift box and −15 % on sunglasses', tags: ['gifting', 'sunglasses'] }); });
      }
      // every month: one newsletter programme per market
      each(function (mk) {
        var s0 = D(1), e0 = lastOfMonth(y, m), sends = 0;
        for (var d = s0; d <= e0; d++) if (dow(d) === 1 || dow(d) === 3) sends++;
        camp({ name: 'Newsletter — {m} {y}', market: mk, type: 'newsletter', s: s0, e: e0, ch: ['newsletter'], budget: round(sends * mkt(mk).list * 0.0015 * 1.05, 50), owner: 'u4', tags: ['always-on'] });
      });
      // every month: a small lens-reorder push in a rotating market (contact-lens customers run out every month)
      var lm = MKT_ONLY[(m + y + 1) % 3], ls = D(ri(4, 14));
      camp({ name: 'Lens reorder reminder — {m}', market: lm, type: 'cl_subscription', s: ls, e: ls + ri(6, 10), ch: ['sms', 'newsletter', 'gads_search'], budget: bud(700, 1200, lm), code: 'REORDER10', offer: '−10 % on your next lens order', owner: 'u4', tags: ['contact lenses', 'retargeting'] });
      // every month: one influencer collaboration (rotating market) + every other month PR
      var im = MKT_ONLY[(m + y) % 3], hs = HANDLES[(m * 7 + y) % HANDLES.length], is = D(ri(3, 12));
      camp({ name: 'Influencer: @' + hs, market: im, type: 'influencer', s: is, e: is + ri(10, 18), ch: ['influencer', 'organic'].concat(chance(0.5) ? ['meta'] : []), budget: bud(1500, 3500, im), code: hs.split('.')[0].toUpperCase() + '15', offer: '−15 % with the creator’s code', owner: 'u5', tags: ['brand'] });
      if (m % 2 === 0) { var pm = pick(['SI', 'HR', 'IT', 'ALL']); var ps = D(ri(5, 18)); camp({ name: 'PR: ' + pick(['optician of the year story', 'eye-health survey release', 'store anniversary', 'kids’ vision check tour', 'sustainability report']), market: pm, type: 'pr', s: ps, e: ps + ri(5, 10), ch: ['organic'].concat(chance(0.5) ? ['influencer'] : []), budget: bud(800, 1600, pm), owner: 'u6', tags: ['brand'] }); }
    }

    // statuses, checklists, quality — relative to today
    campaigns.forEach(function (c) {
      var s = dnum(c.start), e = dnum(c.end), lead = s - today;
      if (e < today) c.status = chance(0.04) ? 'cancelled' : 'done';
      else if (s <= today) c.status = 'live';
      else if (lead <= 14) c.status = chance(0.8) ? 'production' : 'planned';
      else if (lead <= 45) c.status = chance(0.65) ? 'planned' : 'production';
      else c.status = chance(0.45) ? 'idea' : 'planned';
      if (c.status !== 'done' && c.status !== 'live' && c.status !== 'cancelled' && chance(0.03)) c.status = 'cancelled';
      var ck = {};
      CHECKLIST.forEach(function (it, i) {
        var v;
        if (c.status === 'done' || c.status === 'live') v = it.id === 'legal' && !c.code ? true : chance(0.97);
        else if (c.status === 'production') v = i < 2 ? true : chance(0.45);
        else if (c.status === 'planned') v = i === 0 ? chance(0.8) : false;
        else v = false;
        ck[it.id] = v;
      });
      c.checklist = ck;
      c.notes = chance(0.35) ? pick(NOTES) : '';
      c.updatedAt = c.createdAt;
      // seeded comments
      if (c.status !== 'idea' && chance(0.42)) {
        var n = ri(1, 3), at = c.createdAt + 3 * 864e5;
        for (var k = 0; k < n; k++) {
          var who = pick(TEAM);
          at += ri(1, 6) * 864e5 + ri(1, 8) * 36e5;
          c.comments.push({ id: c.id * 10 + k, at: at, by: who.email, name: who.name, text: pick(COMMENTS) });
        }
        c.comments = c.comments.filter(function (x) { return x.at <= nowMs; });
      }
    });

    // ── Content items ─────────────────────────────────────────────────────
    var content = [], cseq = 0;
    var assignees = ['u5', 'u5', 'u7', 'u8', 'u4', 'u1', 'u2', 'u3'];
    function contentStatus(d) {
      var lead = d - today;
      if (lead < 0) return chance(0.97) ? 'published' : 'approved';
      if (lead <= 2) return chance(0.75) ? 'scheduled' : 'approved';
      if (lead <= 7) return pick(['scheduled', 'approved', 'approved', 'review']);
      if (lead <= 21) return pick(['review', 'design', 'design', 'approved', 'brief']);
      return pick(['brief', 'brief', 'design']);
    }
    function fill(tpl, c) {
      return tpl.replace('{brand}', pick(BRANDS)).replace('{offer}', c && c.offer ? c.offer.charAt(0).toLowerCase() + c.offer.slice(1) : 'new styles in store')
        .replace('{code}', c && c.code ? c.code : 'no code needed').replace('{store}', pick(STORES).name);
    }
    function addContent(d, ch, market, title, caption, c) {
      var cid = ++cseq, st = contentStatus(d);
      var item = { id: cid, date: ymdOf(d), time: ch === 'newsletter' ? '09:00' : ch === 'sms' ? '10:30' : pick(['08:30', '12:00', '17:30', '19:00', '20:30']), channel: ch, market: market,
        title: title, caption: caption, status: st, assignee: ch === 'newsletter' || ch === 'sms' ? 'u4' : pick(assignees), campaignId: c ? c.id : null };
      content.push(item);
      if (c) c.content.push(cid);
    }
    campaigns.forEach(function (c) {
      if (c.status === 'cancelled') return;
      var s = dnum(c.start), e = dnum(c.end), len = e - s + 1;
      var social = c.channels.some(function (ch) { return ch === 'meta' || ch === 'organic' || ch === 'tiktok' || ch === 'influencer'; });
      if (c.type === 'newsletter') {
        var nls = ri(1, 2);
        for (var k = 0; k < nls; k++) { var dd = s + 1 + Math.floor((len - 3) * (k + 0.3) / nls); addContent(dd, 'newsletter', c.market, pick(NL_SUBJECTS), 'Monthly newsletter. Hero: ' + pick(BRANDS) + '; blocks: new arrivals, lens reorder, store events.', c); }
        return;
      }
      if (social) {
        var n = Math.min(3, 1 + Math.floor(len / 12));
        for (var j = 0; j < n; j++) {
          var d = s + Math.floor(len * j / n) + ri(0, 1);
          var ch = c.channels.indexOf('tiktok') >= 0 && chance(0.35) ? 'tiktok' : chance(0.6) ? 'instagram' : 'facebook';
          addContent(Math.min(d, e), ch, c.market, c.name.split(' · ')[0] + (j ? ' — post ' + (j + 1) : ' — launch post'), fill(pick(CAPTIONS), c), c);
        }
      }
      if (c.channels.indexOf('sms') >= 0) addContent(s, 'sms', c.market, c.name.split(' · ')[0] + ' — SMS', (c.offer || 'News from your optician') + (c.code ? ' Code ' + c.code + '.' : '') + ' Reply STOP to opt out.', c);
      if (c.channels.indexOf('newsletter') >= 0) addContent(s + (len > 6 ? 1 : 0), 'newsletter', c.market, c.name.split(' · ')[0] + ' — newsletter', 'Dedicated send: ' + (c.offer || 'campaign news') + '.', c);
    });
    // evergreen organic posts until we have about 300 items
    var evergreen = ['Frame shapes guide', 'Optician tip of the week', 'Behind the scenes in the lab', 'Customer story', 'Lens care basics', 'Team picks', 'Ask an optician live', 'Store spotlight'];
    var guard = 0;
    while (content.length < 300 && guard++ < 1000) {
      var d2 = ri(rangeFrom + 3, rangeTo - 3), mk2 = pick(['SI', 'HR', 'IT']);
      addContent(d2, pick(['instagram', 'instagram', 'facebook', 'tiktok']), mk2, pick(evergreen), fill(pick(CAPTIONS), null), null);
    }
    content.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id; });

    // annual budgets per market: planned spend + some headroom (some months will run over)
    var budgets = {};
    campaigns.forEach(function (c) {
      if (c.status === 'cancelled') return;
      var yy = c.start.slice(0, 4);
      budgets[yy] = budgets[yy] || { SI: 0, HR: 0, IT: 0 };
      if (c.market === 'ALL') MKT_ONLY.forEach(function (mk) { budgets[yy][mk] += c.budget * ALL_SPLIT[mk]; });
      else budgets[yy][c.market] += c.budget;
    });
    Object.keys(budgets).forEach(function (yy) {
      var full = +yy === tp.y;
      MKT_ONLY.forEach(function (mk, i) { budgets[yy][mk] = round(budgets[yy][mk] * (full ? [1.06, 0.98, 1.1][i] : 1.08), 5000) || 5000; });
    });

    return {
      version: 1, generatedFor: todayYmd, range: { from: ymdOf(rangeFrom), to: ymdOf(rangeTo) },
      seq: { campaign: seq, content: cseq, comment: 1000 },
      campaigns: campaigns, content: content, budgets: budgets
    };
  }

  // ── Daily performance (derived, deterministic) ────────────────────────────
  var CH = {}; CHANNELS.forEach(function (c) { CH[c.id] = c; });
  var MK = {}; MARKETS.forEach(function (m) { MK[m.id] = m; });
  var TY = {}; TYPES.forEach(function (t) { TY[t.id] = t; });

  function seasonFactor(type, d) {
    var p = ymParts(d), m = p.m, f;
    if (type === 'summer_sun') f = m >= 6 && m <= 8 ? 1.35 : m === 5 || m === 9 ? 1.0 : 0.6;
    else f = [1.0, 0.88, 0.95, 0.95, 1.0, 1.05, 0.95, 0.92, 1.0, 1.0, 1.2, 1.1][m - 1];
    var bf = blackFriday(p.y);
    if (d === bf) f *= 2.2; else if (d > bf && d <= bf + 3) f *= 1.6; else if (d >= bf - 7 && d < bf) f *= 1.2;
    return f;
  }
  // campaign-level hidden factors: quality (some flop) and pacing (some overspend)
  function campFactors(c) {
    var s = c.seed >>> 0, u = h01(s, 1, 2, 3), v = h01(s, 4, 5, 6);
    var q = u < 0.13 ? 0.28 + u * 2 : u > 0.86 ? 1.3 + (u - 0.86) * 3.5 : 0.75 + (u - 0.13) * 0.75;
    var pf = v < 0.09 ? 1.14 + v * 1.8 : 0.84 + v * 0.27;
    return { q: q, pf: pf };
  }
  // how a campaign's budget splits: e-mail/SMS sending costs come off the top, the rest goes by channel weight
  function sendDays(c, chId) {
    var s = dnum(c.start), e = dnum(c.end), len = e - s + 1, n = 0;
    if (chId === 'newsletter') { for (var d = s; d <= e; d++) if (dow(d) === 1 || dow(d) === 3) n++; return n; }
    return len > 10 ? 2 : 1;
  }
  function planSplit(c) {
    var mk = MK[c.market] || MK.ALL, chs = c.channels.filter(function (x) { return CH[x]; }), alloc = {}, listCost = 0;
    chs.forEach(function (x) { var ch = CH[x]; if (ch.kind === 'list') { alloc[x] = sendDays(c, x) * (x === 'newsletter' ? mk.list : mk.sms) * ch.unit * 0.97; listCost += alloc[x]; } });
    var rest = Math.max(0, (c.budget || 0) - listCost), wsum = chs.reduce(function (a, x) { return a + CH[x].w; }, 0);
    chs.forEach(function (x) { if (CH[x].kind !== 'list') alloc[x] = wsum ? rest * CH[x].w / wsum : 0; });
    return { alloc: alloc, listCost: listCost };
  }
  // returns rows [{d, ch, imp, clk, sp, ses, ord, rev, nc}] for days up to (but excluding) `today`
  function perfFor(c, today) {
    if (!c || c.status === 'cancelled' || c.status === 'idea' || c.status === 'planned') return [];
    var s = dnum(c.start), e = Math.min(dnum(c.end), today - 1);
    if (e < s) return [];
    var len = dnum(c.end) - s + 1, f = campFactors(c), mk = MK[c.market] || MK.ALL, ty = TY[c.type] || { roas: 3 };
    var chs = c.channels.filter(function (x) { return CH[x]; });
    var sp = planSplit(c);
    var aov = mk.aov * (ty.aovF || 1);
    var stores = Math.max(1, (c.stores || []).length);
    var rows = [], seed = c.seed >>> 0;
    chs.forEach(function (chId, ci) {
      var ch = CH[chId], alloc = sp.alloc[chId] || 0, daily = alloc / len;
      for (var d = s; d <= e; d++) {
        var wd = dow(d), u1 = h01(seed, ci, d, 11), u2 = h01(seed, ci, d, 22), u3 = h01(seed, ci, d, 33), u4 = h01(seed, ci, d, 44);
        var noise = 0.82 + u1 * 0.36, season = seasonFactor(c.type, d);
        var wkOrd = wd === 5 ? 0.86 : wd === 6 ? 0.8 : 1.0;
        var r = { d: d, ch: chId, imp: 0, clk: 0, sp: 0, ses: 0, ord: 0, rev: 0, nc: 0 };
        var cvr = ch.cvr * f.q * season * wkOrd;
        if (ch.kind === 'cpc' || ch.kind === 'fee' || ch.kind === 'broadcast') {
          if (ch.kind === 'broadcast' && wd >= 5) { rows.push(r); continue; }
          r.sp = daily * f.pf * noise * (wd >= 5 && ch.kind === 'cpc' ? 0.9 : 1) * (ch.kind === 'broadcast' ? 7 / 5 : 1);
          // diminishing returns: conversion rate drops as daily spend rises
          cvr *= Math.min(1.25, Math.pow(140 / Math.max(20, r.sp), 0.2));
          if (ch.kind === 'cpc') { r.clk = r.sp / (ch.cpc * (0.9 + u2 * 0.2) * (season > 1.3 ? 1.25 : 1)); r.imp = r.clk / (ch.ctr * (0.85 + u3 * 0.3)); r.ses = r.clk * (0.86 + u4 * 0.08); }
          else if (ch.kind === 'fee') { r.imp = r.sp / ch.cpm * 1000 * (0.8 + u2 * 0.4); r.clk = r.imp * ch.ctr * (0.85 + u3 * 0.3); r.ses = r.clk * 0.9; }
          else { r.imp = r.sp / ch.cpm * 1000; r.clk = 0; r.ses = r.imp * 0.0006 * (0.8 + u3 * 0.4); }
        } else if (ch.kind === 'list') {
          var sendDay = chId === 'newsletter' ? (wd === 1 || wd === 3) : (d === s || (len > 10 && d === dnum(c.end) - 2));
          if (!sendDay) { rows.push(r); continue; }
          var size = (chId === 'newsletter' ? mk.list : mk.sms) * (0.92 + u2 * 0.1);
          r.imp = size; r.sp = size * ch.unit; r.clk = size * ch.ctr * (0.8 + u3 * 0.4) * Math.sqrt(f.q); r.ses = r.clk * 0.92;
        } else if (ch.kind === 'reach') {
          r.imp = mk.reach * (0.6 + u2 * 0.8) * (wd >= 5 ? 1.1 : 1); r.clk = r.imp * ch.ctr * (0.8 + u3 * 0.4); r.ses = r.clk * 0.9;
        } else if (ch.kind === 'store') {
          if (d === s) r.sp = alloc * f.pf;                // print + install on day one
          var foot = wd === 6 ? 0 : stores * 380 * (wd === 5 ? 1.15 : 1) * (0.85 + u2 * 0.3);
          r.imp = foot; r.ses = 0;
          r.ord = foot * ch.cvr * f.q * season;
        }
        if (ch.kind !== 'store') r.ord = r.ses * cvr;
        // stochastic rounding keeps small days honest (0/1/2 orders)
        r.ord = Math.floor(r.ord + u4);
        r.rev = r.ord * (ch.kind === 'store' ? 190 : aov) * (0.85 + u3 * 0.3);
        r.nc = Math.floor(r.ord * ch.nc * (0.8 + u1 * 0.4) + u2);
        if (r.nc > r.ord) r.nc = r.ord;
        r.imp = Math.round(r.imp); r.clk = Math.round(r.clk); r.ses = Math.round(r.ses);
        r.sp = Math.round(r.sp * 100) / 100; r.rev = Math.round(r.rev * 100) / 100;
        rows.push(r);
      }
    });
    return rows;
  }

  // total webshop + store revenue per market per day: an organic baseline plus the incremental part of campaign revenue
  function baselineRevenue(market, d) {
    var m = MK[market] || MK.ALL, wd = dow(d);
    var season = [0.95, 0.85, 0.92, 0.95, 1.0, 1.12, 1.15, 1.08, 1.0, 0.98, 1.1, 1.18][ymParts(d).m - 1];
    return m.base * season * (wd === 5 ? 0.88 : wd === 6 ? 0.8 : 1) * (0.85 + h01(strHash(market), d, 7, 9) * 0.3);
  }

  global.MKTDATA = {
    SEED: SEED, MARKETS: MARKETS, ALL_SPLIT: ALL_SPLIT, GROUPS: GROUPS, CHANNELS: CHANNELS, TYPES: TYPES, STATUSES: STATUSES, CHECKLIST: CHECKLIST,
    TEAM: TEAM, STORES: STORES, CONTENT_STATUSES: CONTENT_STATUSES, CONTENT_CHANNELS: CONTENT_CHANNELS, TAGS: TAGS, BRANDS: BRANDS,
    dnum: dnum, ymdOf: ymdOf, dow: dow, ymParts: ymParts, dmake: dmake, lastOfMonth: lastOfMonth, blackFriday: blackFriday, easter: easter,
    todayLj: todayLj, keyDates: keyDates, generate: generate, perfFor: perfFor, planSplit: planSplit, campFactors: campFactors, baselineRevenue: baselineRevenue,
    slug: slug, strHash: strHash
  };
})(window);
