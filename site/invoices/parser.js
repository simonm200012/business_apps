/* Invoice text parser for Adrial Apps · Invoices.
 *
 * Input: the lines of text pdf.js read from an invoice (columns separated by 3+ spaces).
 * Output: vendor, VAT ID, invoice number, dates, currency, total / VAT / net, category,
 * plus a confidence per field so the review screen can say what to check.
 *
 * Tuned for Slovenian and English invoices (also understands common German and Croatian
 * labels). Pure function, no DOM: runs in the browser (window.InvoiceParser) and in Node
 * for the tests (module.exports).
 */
(function (root) {
  'use strict';

  var MONTHS = {
    jan: 1, january: 1, januar: 1, januarja: 1, jänner: 1, januar_: 1,
    feb: 2, february: 2, februar: 2, februarja: 2,
    mar: 3, march: 3, marec: 3, marca: 3, märz: 3, mrz: 3,
    apr: 4, april: 4, aprila: 4,
    may: 5, maj: 5, maja: 5, mai: 5,
    jun: 6, june: 6, junij: 6, junija: 6, juni: 6,
    jul: 7, july: 7, julij: 7, julija: 7, juli: 7,
    aug: 8, august: 8, avg: 8, avgust: 8, avgusta: 8,
    sep: 9, sept: 9, september: 9, septembra: 9,
    oct: 10, october: 10, okt: 10, oktober: 10, oktobra: 10,
    nov: 11, november: 11, novembra: 11,
    dec: 12, december: 12, decembra: 12, dez: 12, dezember: 12
  };

  var CURRENCIES = [
    { code: 'EUR', re: /€|\bEUR\b/g },
    { code: 'USD', re: /US\$|\$|\bUSD\b/g },
    { code: 'GBP', re: /£|\bGBP\b/g },
    { code: 'CHF', re: /\bCHF\b/g }
  ];

  var DEFAULT_CATEGORIES = [
    'Software & SaaS', 'Telecom & internet', 'Utilities', 'Fuel & travel', 'Office & supplies',
    'Rent', 'Accounting & legal', 'Marketing', 'Hardware', 'Bank & fees', 'Insurance', 'Other'
  ];

  // Well-known senders: name shown in the app and the category they usually belong to.
  var KNOWN_VENDORS = [
    [/telekom\s+slovenije/i, 'Telekom Slovenije', 'Telecom & internet'],
    [/\ba1\s+slovenija/i, 'A1 Slovenija', 'Telecom & internet'],
    [/telemach/i, 'Telemach', 'Telecom & internet'],
    [/\bt-2\s+d\.o\.o/i, 'T-2', 'Telecom & internet'],
    [/petrol\s+d\.d/i, 'Petrol', 'Fuel & travel'],
    [/\bomv\s+slovenija/i, 'OMV Slovenija', 'Fuel & travel'],
    [/elektro\s+energija/i, 'Elektro energija', 'Utilities'],
    [/\bgen-i\b/i, 'GEN-I', 'Utilities'],
    [/energetika\s+ljubljana/i, 'Energetika Ljubljana', 'Utilities'],
    [/google\s+(cloud|ireland|workspace|llc)/i, 'Google', 'Software & SaaS'],
    [/microsoft\s+(ireland|corporation|365)/i, 'Microsoft', 'Software & SaaS'],
    [/amazon\s+web\s+services/i, 'Amazon Web Services', 'Software & SaaS'],
    [/adobe\s+(systems|inc)/i, 'Adobe', 'Software & SaaS'],
    [/atlassian/i, 'Atlassian', 'Software & SaaS'],
    [/github,?\s+inc/i, 'GitHub', 'Software & SaaS'],
    [/hetzner/i, 'Hetzner', 'Software & SaaS'],
    [/digitalocean/i, 'DigitalOcean', 'Software & SaaS'],
    [/anthropic/i, 'Anthropic', 'Software & SaaS'],
    [/openai/i, 'OpenAI', 'Software & SaaS'],
    [/figma,?\s+inc/i, 'Figma', 'Software & SaaS'],
    [/notion\s+labs/i, 'Notion', 'Software & SaaS'],
    [/slack\s+technologies/i, 'Slack', 'Software & SaaS'],
    [/zoom\s+(video|communications)/i, 'Zoom', 'Software & SaaS'],
    [/dropbox/i, 'Dropbox', 'Software & SaaS'],
    [/canva\s+pty/i, 'Canva', 'Software & SaaS'],
    [/meta\s+platforms/i, 'Meta', 'Marketing'],
    [/linkedin\s+ireland/i, 'LinkedIn', 'Marketing'],
    [/mimovrste/i, 'Mimovrste', 'Hardware'],
    [/big\s+bang/i, 'Big Bang', 'Hardware'],
    [/zavarovalnica\s+triglav/i, 'Zavarovalnica Triglav', 'Insurance'],
    [/generali\s+zavarovalnica/i, 'Generali', 'Insurance'],
    [/\bnlb\s+d\.d/i, 'NLB', 'Bank & fees']
  ];

  // Word stems (Slovenian words inflect, so no closing \b) plus a few short whole words.
  // Matched against text with accents removed (č → c), see norm().
  var CATEGORY_RULES = [
    ['Rent', /\b(najemnin|najem\b|zakup|rent\b|rental|lease\b|leasing)/i],
    ['Accounting & legal', /\b(racunovod|accounting|bookkeeping|odvetni|notar|legal\b|pravn|revizij|audit|davcno\s+svetovanj)/i],
    ['Telecom & internet', /\b(telekom|telecom|mobiln|mobile\b|internet|optik|telefonij|gsm\b|roaming|telemach|a1\b)/i],
    ['Software & SaaS', /\b(software|saas\b|subscription|narocnin|licenc|license|cloud\b|hosting|gostovanj|domen[ae]?\b|domain|workspace|api\b)/i],
    ['Utilities', /\b(elektricn|electricity|elektrika|energij|plin\b|gas\b|voda\b|vodarin|water\b|komunal|ogrevanj|heating|odvoz)/i],
    ['Fuel & travel', /\b(goriv|fuel\b|bencin|dizel|diesel|cestnin|toll\b|vinjet|parking|parkirn|letalsk|flight|hotel|nocitev|taxi\b|avtocest)/i],
    ['Office & supplies', /\b(pisarnisk|office\s+supplies|papir|toner|tiskaln|printer\s+ink|pisarniski\s+material)/i],
    ['Marketing', /\b(oglas|advertis|ads\b|marketing|promocij|kampanj|sponzor|celostn\w*\s+podob|branding)/i],
    ['Hardware', /\b(prenosnik|laptop|monitor|racunalnik|computer|hardware|tipkovnic|keyboard|iphone|macbook)/i],
    ['Bank & fees', /\b(provizij|bank\s+fee|bancn|vodenje\s+racuna|account\s+fee|transakcij)/i],
    ['Insurance', /\b(zavarovan|insurance|polica\b|premij)/i]
  ];

  // ---------- small helpers ----------

  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function isoDate(y, m, d) {
    if (y < 100) y += 2000;
    if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
    var dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCMonth() !== m - 1) return null;
    return y + '-' + pad2(m) + '-' + pad2(d);
  }

  function round2(n) { return Math.round(n * 100) / 100; }

  function near(a, b, tol) { return Math.abs(a - b) <= (tol == null ? 0.011 : tol); }

  // ---------- dates ----------

  var DATE_PATTERNS = [
    { re: /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g, f: function (m) { return isoDate(+m[1], +m[2], +m[3]); } },
    { re: /\b(\d{1,2})\s*[./]\s*(\d{1,2})\s*[./]\s*(\d{4}|\d{2})\b(?![.,]\d)/g, f: function (m) {
      var d = +m[1], mo = +m[2], y = +m[3];
      if (mo > 12 && d <= 12) { var t = d; d = mo; mo = t; }
      return isoDate(y, mo, d);
    } },
    { re: /\b(\d{1,2})\.?\s+([a-zA-Zčšžäöü]{3,10})\.?,?\s+(\d{4})\b/g, f: function (m) {
      var mo = MONTHS[norm(m[2]).replace(/[^a-z]/g, '')] || MONTHS[m[2].toLowerCase()];
      return mo ? isoDate(+m[3], mo, +m[1]) : null;
    } },
    { re: /\b([a-zA-Z]{3,10})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/g, f: function (m) {
      var mo = MONTHS[norm(m[1])];
      return mo ? isoDate(+m[3], mo, +m[2]) : null;
    } }
  ];

  function findDates(line) {
    var out = [];
    DATE_PATTERNS.forEach(function (p) {
      p.re.lastIndex = 0;
      var m;
      while ((m = p.re.exec(line))) {
        var iso = p.f(m);
        if (iso && !out.some(function (o) { return o.index === m.index; })) {
          out.push({ iso: iso, index: m.index, length: m[0].length });
        }
      }
    });
    return out.sort(function (a, b) { return a.index - b.index; });
  }

  function stripDates(line) {
    var s = line;
    findDates(line).forEach(function (d) {
      s = s.slice(0, d.index) + ' '.repeat(d.length) + s.slice(d.index + d.length);
    });
    return s;
  }

  // ---------- amounts ----------

  var NUM_RE = /-?(?:\d{1,3}(?:[.,'  ]\d{3})+|\d{1,3}(?: \d{3})+(?=[.,]\d{2}(?!\d))|\d+)(?:[.,]\d{1,2})?(?!\d)/g;

  function toNumber(raw) {
    var s = String(raw).replace(/[\s  ']/g, '');
    var neg = s.charAt(0) === '-';
    if (neg) s = s.slice(1);
    var lastDot = s.lastIndexOf('.');
    var lastComma = s.lastIndexOf(',');
    var decPos = Math.max(lastDot, lastComma);
    var intPart = s;
    var dec = '';
    if (decPos !== -1) {
      var after = s.length - decPos - 1;
      var both = lastDot !== -1 && lastComma !== -1;
      if (both || after !== 3) { intPart = s.slice(0, decPos); dec = s.slice(decPos + 1); }
    }
    intPart = intPart.replace(/[.,]/g, '');
    var n = parseFloat(intPart + (dec ? '.' + dec : ''));
    return neg ? -n : n;
  }

  function currencyNear(line, start, end) {
    var before = line.slice(Math.max(0, start - 5), start);
    var after = line.slice(end, end + 5);
    var probe = before + ' ' + after;
    for (var i = 0; i < CURRENCIES.length; i++) {
      CURRENCIES[i].re.lastIndex = 0;
      if (CURRENCIES[i].re.test(probe)) return CURRENCIES[i].code;
    }
    return null;
  }

  // Money amounts on a line: numbers with cents or a currency sign, never percentages,
  // dates, years, IDs glued to letters (SI56…, IBANs) or long reference numbers.
  function moneyIn(line) {
    var s = stripDates(line);
    var out = [];
    NUM_RE.lastIndex = 0;
    var m;
    while ((m = NUM_RE.exec(s))) {
      var raw = m[0];
      var start = m.index;
      var end = start + raw.length;
      var prev = s.charAt(start - 1);
      var next = s.slice(end, end + 2);
      if (/[A-Za-z0-9\/#]/.test(prev)) continue;
      if (/^\s?%/.test(next)) continue;
      if (/^[A-Za-z]/.test(next) && !/^(?:EUR|USD|GBP|CHF)/.test(s.slice(end, end + 3))) continue;
      var hasCents = /[.,]\d{2}$/.test(raw);
      var cur = currencyNear(s, start, end);
      if (!hasCents && !cur) continue;
      var digits = raw.replace(/\D/g, '');
      if (digits.length > 11) continue;
      var value = toNumber(raw);
      if (!isFinite(value)) continue;
      out.push({ value: value, currency: cur, index: start, raw: raw });
    }
    return out;
  }

  function detectCurrency(text) {
    var best = 'EUR';
    var bestCount = 0;
    CURRENCIES.forEach(function (c) {
      c.re.lastIndex = 0;
      var count = (text.match(c.re) || []).length;
      if (count > bestCount) { best = c.code; bestCount = count; }
    });
    return best;
  }

  // ---------- labels ----------

  var TOTAL_KEYS = [
    { w: 100, re: /(skupaj\s+)?za\s+pla[cč]ilo|znesek\s+za\s+pla[cč]ilo|za\s+pla[cč]ati|amount\s+due|balance\s+due|total\s+due|total\s+to\s+pay|zu\s+zahlen|za\s+platiti|ukupno\s+za\s+pla/i },
    { w: 90, re: /skupaj\s+z\s+ddv|vrednost\s+z\s+ddv|znesek\s+z\s+ddv|ra[cč]un\s+skupaj|total\s+incl|incl\.?\s+(vat|tax)|including\s+(vat|tax)|grand\s+total|gesamtbetrag|rechnungsbetrag|bruttobetrag|skupni\s+znesek|kon[cč]ni\s+znesek|invoice\s+total|total\s+amount|amount\s+paid|ukupan\s+iznos|ukupno\s+s\s+pdv/i },
    { w: 60, re: /\bskupaj\b|\btotal\b|\bukupno\b|\bsumme\b|\bgesamt\b|\bbruto\b|\bbrutto\b/i },
    { w: 40, re: /\bznesek\b|\bamount\b|\biznos\b|\bbetrag\b/i }
  ];
  var NOT_GROSS = /brez\s+ddv|excl|without\s+(vat|tax)|osnova|sub-?\s?total|\bnet\b|\bneto\b|\bnetto\b|vmesni|davčna\s+osnova|tax\s+base|ohne\s+mwst|bez\s+pdv|popust|discount|rabat|predpla[cč]ilo|avans|prepayment|already\s+paid|že\s+pla[cč]ano/i;
  var VAT_WORD = /\b(ddv|vat|pdv|mwst|ust|tax|davek)\b/i;
  var VAT_NOT_AMOUNT = /\b(id|identifikacijsk|[sš]tevilk|number|no\.?|nr\.?|reg|zavezan|registr|[sš]ifra|mati[cč]n|oib|uid)\b|ID\s*za\s*DDV|DDV\s*ID|VAT\s*ID/i;
  var NET_KEYS = /osnova|brez\s+ddv|sub-?\s?total|\bnet\b|\bneto\b|\bnetto\b|excl\.?\s*(vat|tax)|without\s+(vat|tax)|tax\s+base|davčna\s+osnova|vrednost\s+brez|bez\s+pdv|zwischensumme/i;
  var NO_VAT = /reverse\s+charge|obrnjen\w*\s+dav[cč]n|76\.?\s*a\.?\s*[cč]len|94\.?\s*[cč]len|opro[sš][cč]en\w*\s+(dav|ddv|pla)|ni\s+zavezan(ec)?\s+za\s+ddv|not\s+subject\s+to\s+vat|vat\s+exempt|tax\s+exempt|reverse-charge|steuerschuldnerschaft/i;

  var NUMBER_KEYS = [
    /(?:ra[cč]un|invoice|faktura|rechnung|receipt|potrdilo|dobropis|credit\s+note)\s*(?:[sš]t\.?|[sš]tevilka|st\.?|no\.?|nr\.?|number|num\.?|#|broj|id)\s*[:#.]?\s*([A-Z0-9][A-Z0-9\-\/._]{1,30})/i,
    /(?:[sš]tevilka|[sš]t\.)\s+(?:ra[cč]una|dokumenta)\s*[:#.]?\s*([A-Z0-9][A-Z0-9\-\/._]{1,30})/i,
    /(?:invoice|receipt)\s*[:#]\s*([A-Z0-9][A-Z0-9\-\/._]{1,30})/i,
    /^\s*(?:ra[cč]un|invoice|faktura|rechnung)\s+([A-Z0-9]*\d[A-Z0-9\-\/._]{1,30})\s*$/i
  ];
  var NUMBER_LABEL_ONLY = /(?:ra[cč]un|invoice|faktura|rechnung)\s*(?:[sš]t\.?|[sš]tevilka|no\.?|nr\.?|number|#|broj)\s*[:#.]?\s*$|(?:[sš]tevilka|[sš]t\.)\s+ra[cč]una\s*[:#.]?\s*$/i;

  var ISSUE_KEYS = /datum\s+(ra[cč]una|izdaje|izstavitve|dokumenta|izdaje\s+ra[cč]una)|invoice\s+date|date\s+of\s+issue|issue\s+date|date\s+issued|issued\s+on|rechnungsdatum|datum\s+fakture|datum\s+izdavanja|^\s*datum\s*:|^\s*date\s*:/i;
  var DUE_KEYS = /rok\s+pla[cč]ila|zapadlost|datum\s+zapadlosti|\bvaluta\b|due\s+date|payment\s+due|date\s+due|pay\s+by|due\s+on|f[aä]llig|dospije[cć]e|rok\s+pla[cć]anja/i;
  var SERVICE_KEYS = /opravljen\w*\s+storitv|datum\s+dobave|datum\s+storitve|service\s+date|delivery\s+date|obdobje|period|leistungsdatum/i;

  var BUYER_MARK = /^\s*(kupec|prejemnik|naro[cč]nik|pla[cč]nik|stranka|bill(ed)?\s+to|customer|client|sold\s+to|ship\s+to|invoice\s+to|rechnungsempf|kunde|kupac|naslovnik)\b/i;
  var SELLER_MARK = /^\s*(izdajatelj|dobavitelj|prodajalec|ponudnik|izvajalec|from|supplier|seller|vendor|issued\s+by|lieferant|verk[aä]ufer|prodavatelj|dobavlja[cč])\b\s*:?\s*(.*)$/i;

  var LEGAL_SUFFIX = /(?:^|[\s,])(d\.\s?o\.\s?o\.?|d\.\s?d\.?|s\.\s?p\.?|k\.\s?d\.?|d\.\s?n\.\s?o\.?|z\.\s?o\.\s?o\.?|gmbh|ag|kg|ltd\.?|limited|llc|l\.l\.c\.|inc\.?|corp\.?|corporation|s\.\s?r\.\s?l\.?|srl|s\.a\.?|b\.v\.?|bv|sas|sarl|oy|ab|a\/s|plc|kft\.?|s\.r\.o\.?|sp\.\s?z\s?o\.\s?o\.?|pty\.?\s+ltd\.?|ug)(?=$|[\s,.;)])/i;
  var NOT_A_NAME = /^(ra[cč]un|invoice|faktura|rechnung|receipt|potrdilo|predra[cč]un|stran|page|datum|date|kopija|copy|original|izvirnik|tax\s+invoice)\b/i;

  var TAX_ID_RE = /(?:ID\s*(?:[sš]t\.?\s*)?za\s*DDV|DDV\s*(?:ID|[sš]t\.?)|ID\s*DDV|(?:EU\s+)?VAT\s*(?:ID|No\.?|number|reg(?:istration)?\.?\s*(?:no\.?|number)?)?|USt-?Id(?:Nr)?\.?|UID|OIB|dav[cč]na\s+[sš]tevilka|ID\s+[sš]t\.)\s*[:.]?\s*([A-Z]{2}\s?(?=[0-9A-Z]*\d)[0-9A-Z]{8,12}|\d{8,11})/gi;
  var BARE_SI_ID = /\bSI\s?\d{8}\b/g;

  // ---------- field finders ----------

  function findTotals(lines) {
    var cands = [];
    lines.forEach(function (line, i) {
      var key = null;
      for (var k = 0; k < TOTAL_KEYS.length; k++) {
        if (TOTAL_KEYS[k].re.test(line)) { key = TOTAL_KEYS[k]; break; }
      }
      if (!key) return;
      if (key.w < 100 && NOT_GROSS.test(line)) return;
      if (key.w <= 60 && VAT_WORD.test(line) && !/\bz\s+ddv|incl|including|s\s+pdv|mit\s+mwst/i.test(line)) return;
      var amounts = moneyIn(line);
      var where = 'same';
      if (!amounts.length && lines[i + 1] != null) { amounts = moneyIn(lines[i + 1]); where = 'next'; }
      if (!amounts.length) return;
      var a = amounts[amounts.length - 1];
      cands.push({ value: a.value, currency: a.currency, score: key.w - (where === 'next' ? 5 : 0), line: i });
    });
    cands.sort(function (a, b) { return b.score - a.score || b.line - a.line || b.value - a.value; });
    return cands;
  }

  function findRates(text) {
    var rates = [];
    var re = /(\d{1,2}(?:[.,]\d{1,2})?)\s?%/g;
    var m;
    while ((m = re.exec(text))) {
      var r = parseFloat(m[1].replace(',', '.'));
      if ([5, 7, 8, 9, 9.5, 10, 13, 19, 20, 21, 22, 23, 24, 25, 27].indexOf(r) !== -1 && rates.indexOf(r) === -1) rates.push(r);
    }
    return rates;
  }

  function solveAmounts(lines, text) {
    var totals = findTotals(lines);
    var all = [];
    lines.forEach(function (l) { moneyIn(l).forEach(function (a) { all.push(a.value); }); });
    var res = { total: null, vat: null, net: null, conf: { total: 'none', vat: 'none', net: 'none' } };

    var netCands = [];
    var vatCands = [];
    lines.forEach(function (line, i) {
      var amounts = moneyIn(line);
      if (!amounts.length && lines[i + 1] != null && (NET_KEYS.test(line) || VAT_WORD.test(line))) amounts = moneyIn(lines[i + 1]);
      if (!amounts.length) return;
      if (NET_KEYS.test(line)) netCands.push(amounts.map(function (a) { return a.value; }));
      if (VAT_WORD.test(line) && !NET_KEYS.test(line) && !VAT_NOT_AMOUNT.test(line) && !/\bz\s+ddv|incl|including/i.test(line)) {
        vatCands.push({ values: amounts.map(function (a) { return a.value; }), strong: /skupaj\s+ddv|znesek\s+ddv|ddv\s+skupaj|total\s+(vat|tax)|(vat|tax)\s+amount|vat\s+total|summe\s+mwst|ukupno\s+pdv/i.test(line) });
      }
    });

    if (!totals.length) {
      var money = all.filter(function (v) { return v > 0; });
      if (money.length) {
        res.total = Math.max.apply(null, money);
        res.conf.total = 'low';
      }
    } else {
      res.total = totals[0].value;
      res.conf.total = totals[0].score >= 90 ? 'high' : 'medium';
      // A "total" that is smaller than a confirmed net + VAT pair elsewhere is a subtotal.
    }

    var T = res.total;
    if (T != null) {
      var noVat = NO_VAT.test(text);
      // 0) rate rows: "DDV 22 %  osnova 51,39  DDV 11,30" — one row per rate, summed
      var rateRows = [];
      lines.forEach(function (line) {
        if (!VAT_WORD.test(line) || VAT_NOT_AMOUNT.test(line)) return;
        var rm = line.match(/(\d{1,2}(?:[.,]\d{1,2})?)\s?%/);
        if (!rm) return;
        var rate = parseFloat(rm[1].replace(',', '.'));
        if (!rate) return;
        var vals = moneyIn(line).map(function (a) { return a.value; });
        for (var a = 0; a < vals.length; a++) {
          for (var b = 0; b < vals.length; b++) {
            if (a !== b && vals[b] > vals[a] && near(vals[a], vals[b] * rate / 100, Math.max(0.015, vals[b] * 0.0005))) {
              rateRows.push({ vat: vals[a], net: vals[b] });
              return;
            }
          }
        }
      });
      if (rateRows.length) {
        var sv = round2(rateRows.reduce(function (s, x) { return s + x.vat; }, 0));
        var sn = round2(rateRows.reduce(function (s, x) { return s + x.net; }, 0));
        if (near(sv + sn, T, 0.02)) { res.vat = sv; res.net = sn; res.conf.vat = 'high'; res.conf.net = 'high'; }
      }
      // 1) VAT line whose amount + some net amount = total
      var flatVat = [];
      vatCands.forEach(function (c) { c.values.forEach(function (v) { flatVat.push({ v: v, strong: c.strong }); }); });
      flatVat.sort(function (a, b) { return (b.strong ? 1 : 0) - (a.strong ? 1 : 0); });
      for (var i = 0; i < flatVat.length && res.vat == null; i++) {
        var v = flatVat[i].v;
        if (v <= 0 || v >= T * 0.35) continue;
        for (var j = 0; j < all.length; j++) {
          if (near(all[j] + v, T)) { res.vat = v; res.net = all[j]; res.conf.vat = 'high'; res.conf.net = 'high'; break; }
        }
      }
      // 2) rate-based: total × r / (100 + r) appears in the document
      if (res.vat == null) {
        var rates = findRates(text);
        for (var r = 0; r < rates.length && res.vat == null; r++) {
          var expected = round2(T * rates[r] / (100 + rates[r]));
          for (var k = 0; k < all.length; k++) {
            if (near(all[k], expected, 0.02)) { res.vat = all[k]; res.conf.vat = 'high'; break; }
          }
        }
      }
      // 3) net line → VAT is the difference
      if (res.vat == null) {
        var flatNet = [].concat.apply([], netCands).filter(function (n) { return n > 0 && n <= T && T - n <= T * 0.3; });
        if (flatNet.length) {
          var n0 = Math.max.apply(null, flatNet);
          res.net = n0; res.vat = round2(T - n0); res.conf.vat = 'medium'; res.conf.net = 'medium';
        }
      }
      // 4) strong VAT line alone
      if (res.vat == null) {
        var strongVat = flatVat.filter(function (x) { return x.strong && x.v > 0 && x.v < T * 0.35; });
        if (strongVat.length) { res.vat = strongVat[0].v; res.conf.vat = 'medium'; }
      }
      // 5) explicitly no VAT
      if (res.vat == null && (noVat || flatVat.some(function (x) { return x.v === 0; }))) {
        res.vat = 0; res.conf.vat = noVat ? 'high' : 'medium';
      }
      if (res.vat != null && res.net == null) {
        res.net = round2(T - res.vat);
        res.conf.net = res.conf.vat === 'high' ? 'high' : 'medium';
      }
      // A net + VAT pair that adds up to the total confirms it.
      if (res.net != null && res.vat != null && near(res.net + res.vat, T) && res.conf.total === 'medium') res.conf.total = 'high';
    }
    return res;
  }

  function findNumber(lines) {
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      for (var k = 0; k < NUMBER_KEYS.length; k++) {
        var m = line.match(NUMBER_KEYS[k]);
        if (m && /\d/.test(m[1])) return { value: m[1].replace(/[.,;:]+$/, ''), conf: 'high' };
        // "Invoice number QOVJOVJD 0009": a letters-only block followed by a digits block
        if (m && /^[A-Z]{4,}$/.test(m[1])) {
          var rest = line.slice(m.index + m[0].length).match(/^ (\d[0-9A-Z\-\/._]{1,20})(?=\s{2,}|\s*$)/);
          if (rest) return { value: m[1] + ' ' + rest[1].replace(/[.,;:]+$/, ''), conf: 'high' };
        }
      }
      if (NUMBER_LABEL_ONLY.test(line) && lines[i + 1]) {
        var t = lines[i + 1].trim().split(/\s{2,}|\s/)[0];
        if (t && /\d/.test(t) && /^[A-Z0-9][A-Z0-9\-\/._]{1,30}$/i.test(t)) return { value: t.replace(/[.,;:]+$/, ''), conf: 'high' };
      }
    }
    return { value: '', conf: 'none' };
  }

  function dateAfterKey(lines, i, keyRe) {
    var line = lines[i];
    var km = line.match(keyRe);
    var from = km ? km.index : 0;
    var dates = findDates(line).filter(function (d) { return d.index >= from; });
    if (dates.length) return dates[0].iso;
    // label and value in separate columns: look at the same column on the next line
    if (lines[i + 1]) {
      var nd = findDates(lines[i + 1]);
      if (nd.length) return nd[0].iso;
    }
    return null;
  }

  function findDatesFields(lines) {
    var issue = null;
    var due = null;
    var issueConf = 'none';
    var dueConf = 'none';
    lines.forEach(function (line, i) {
      if (!due && DUE_KEYS.test(line)) {
        var d = dateAfterKey(lines, i, DUE_KEYS);
        if (d) { due = d; dueConf = 'high'; }
      }
      if (!issue && ISSUE_KEYS.test(line) && !DUE_KEYS.test(line.slice(0, (line.match(ISSUE_KEYS) || { index: 0 }).index))) {
        var d2 = dateAfterKey(lines, i, ISSUE_KEYS);
        if (d2 && d2 !== due) { issue = d2; issueConf = 'high'; }
      }
    });
    if (!issue) {
      for (var i = 0; i < lines.length && !issue; i++) {
        if (DUE_KEYS.test(lines[i]) || SERVICE_KEYS.test(lines[i])) continue;
        var ds = findDates(lines[i]);
        if (ds.length) { issue = ds[0].iso; issueConf = 'low'; }
      }
    }
    if (due && issue && due < issue) { due = null; dueConf = 'none'; }
    return { issueDate: issue, dueDate: due, conf: { issueDate: issueConf, dueDate: dueConf } };
  }

  // zone[i] = first column (cell index) of line i that belongs to the buyer; 0 = the whole line
  function findTaxIds(lines, zone, ownIds) {
    var out = [];
    var own = (ownIds || []).map(function (x) { return String(x).replace(/\s/g, '').toUpperCase(); });
    lines.forEach(function (line, i) {
      var cells = line.split(/\s{3,}/);
      cells.forEach(function (cell, c) {
        var ids = [];
        var m;
        TAX_ID_RE.lastIndex = 0;
        while ((m = TAX_ID_RE.exec(cell))) ids.push(m[1]);
        BARE_SI_ID.lastIndex = 0;
        while ((m = BARE_SI_ID.exec(cell))) ids.push(m[0]);
        var buyer = zone[i] != null && (cells.length === 1 || c >= zone[i]);
        ids.forEach(function (id) {
          var clean = id.replace(/\s/g, '').toUpperCase();
          if (own.indexOf(clean) !== -1) return;
          if (out.some(function (o) { return o.id === clean; })) return;
          out.push({ id: clean, line: i, buyer: buyer });
        });
      });
    });
    return out;
  }

  function cutAtSuffix(cell) {
    var m = cell.match(LEGAL_SUFFIX);
    if (!m) return cell;
    var end = m.index + m[0].length;
    return cell.slice(0, end);
  }

  function cleanName(s) {
    return String(s || '')
      .replace(/^[\s:,.\-–|]+/, '')
      .replace(/[\s,;:\-–|]+$/, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function findVendor(lines, opts) {
    var text = lines.join('\n');
    var own = (opts.ownNames || []).map(norm).filter(Boolean);
    var isOwn = function (s) { var n = norm(s); return own.some(function (o) { return n.indexOf(o) !== -1; }); };

    // buyer zone: the block that starts at "Kupec / Bill to / Customer" lines
    var buyerZone = {};
    lines.forEach(function (line, i) {
      if (BUYER_MARK.test(line)) for (var k = i; k < Math.min(lines.length, i + 5); k++) buyerZone[k] = true;
    });
    // VAT IDs printed just under your own company name are yours, even when "Bill to"
    // sits in a side column that shares lines with the vendor's block: track the column.
    var idZone = {};
    Object.keys(buyerZone).forEach(function (k) { idZone[k] = 0; });
    lines.forEach(function (line, i) {
      var cells = line.split(/\s{3,}/);
      for (var c = 0; c < cells.length; c++) {
        if (isOwn(cells[c])) {
          for (var k = i; k < Math.min(lines.length, i + 4); k++) idZone[k] = idZone[k] === 0 ? 0 : c;
          break;
        }
      }
    });

    var taxIds = findTaxIds(lines, idZone, opts.ownTaxIds);
    var vendorTaxId = '';
    var sellerIds = taxIds.filter(function (t) { return !t.buyer; });
    if (sellerIds.length) vendorTaxId = sellerIds[0].id;
    else if (taxIds.length === 1 && !own.length) vendorTaxId = '';

    // 1) a rule the user taught us earlier (by VAT ID, then by name)
    var rules = opts.rules || {};
    if (vendorTaxId && rules['id:' + vendorTaxId]) {
      return { vendor: rules['id:' + vendorTaxId].vendor, vendorTaxId: vendorTaxId, conf: 'high', rule: rules['id:' + vendorTaxId] };
    }
    for (var key in rules) {
      if (key.indexOf('name:') === 0) {
        var needle = key.slice(5);
        if (needle.length >= 3 && norm(text).indexOf(needle) !== -1) {
          return { vendor: rules[key].vendor, vendorTaxId: vendorTaxId, conf: 'high', rule: rules[key] };
        }
      }
    }

    // 2) well-known senders
    for (var v = 0; v < KNOWN_VENDORS.length; v++) {
      var hit = KNOWN_VENDORS[v][0].exec(text);
      if (hit) {
        var lineIdx = text.slice(0, hit.index).split('\n').length - 1;
        if (!buyerZone[lineIdx] && !isOwn(lines[lineIdx])) {
          return { vendor: KNOWN_VENDORS[v][1], vendorTaxId: vendorTaxId, conf: 'high', category: KNOWN_VENDORS[v][2] };
        }
      }
    }

    var cellsOf = function (line) { return line.split(/\s{3,}/).map(function (c) { return c.trim(); }).filter(Boolean); };

    // 3) the line after "Izdajatelj / From / Supplier"
    for (var i = 0; i < lines.length; i++) {
      var sm = lines[i].match(SELLER_MARK);
      if (sm) {
        var rest = cleanName(cellsOf(sm[2] || '')[0] || '');
        var cand = rest && rest.length > 2 ? rest : cleanName(cellsOf(lines[i + 1] || '')[0] || '');
        if (cand && !isOwn(cand) && !NOT_A_NAME.test(cand)) return { vendor: cleanName(cutAtSuffix(cand)), vendorTaxId: vendorTaxId, conf: 'high' };
      }
    }

    // 4) a company name with a legal form (d.o.o., GmbH, Ltd …) outside the buyer block
    var limit = Math.max(8, Math.ceil(lines.length * 0.7));
    var sellerIdLine = sellerIds.length ? sellerIds[0].line : -1;
    var named = [];
    for (var j = 0; j < Math.min(lines.length, limit); j++) {
      if (buyerZone[j]) continue;
      var cells = cellsOf(lines[j]);
      for (var c = 0; c < cells.length; c++) {
        if (LEGAL_SUFFIX.test(cells[c]) && !isOwn(cells[c]) && !NOT_A_NAME.test(cells[c]) && !VAT_NOT_AMOUNT.test(cells[c])) {
          named.push({ name: cleanName(cutAtSuffix(cells[c])), line: j });
          break;
        }
      }
    }
    if (named.length) {
      // the name closest above the seller's VAT ID wins, else the first one on the page
      var pick = named[0];
      if (sellerIdLine >= 0) {
        var above = named.filter(function (n) { return n.line <= sellerIdLine; });
        if (above.length) pick = above[above.length - 1];
      }
      return { vendor: pick.name, vendorTaxId: vendorTaxId, conf: 'medium' };
    }

    // 5) first meaningful line at the top
    for (var t = 0; t < Math.min(lines.length, 10); t++) {
      if (buyerZone[t]) continue;
      var rawCell = (cellsOf(lines[t])[0] || '').trim();
      var first = cleanName(rawCell);
      var isLabel = /:\s*$/.test(rawCell) || ISSUE_KEYS.test(rawCell) || DUE_KEYS.test(rawCell) || NUMBER_LABEL_ONLY.test(rawCell) || TOTAL_KEYS[0].re.test(rawCell);
      if (first.length >= 3 && /[a-zA-Zčšž]{3}/.test(first) && !isLabel && !NOT_A_NAME.test(first) && !isOwn(first) && !findDates(first).length && !moneyIn(first).length) {
        return { vendor: first.slice(0, 60), vendorTaxId: vendorTaxId, conf: 'low' };
      }
    }
    return { vendor: '', vendorTaxId: vendorTaxId, conf: 'none' };
  }

  // ---------- IBAN, reference, PO number, service date ----------

  function ibanValid(iban) {
    var s = String(iban || '').replace(/\s/g, '').toUpperCase();
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
    var r = s.slice(4) + s.slice(0, 4);
    var rem = 0;
    for (var i = 0; i < r.length; i++) {
      var c = r.charCodeAt(i);
      var v = c >= 65 ? String(c - 55) : r.charAt(i);
      for (var k = 0; k < v.length; k++) rem = (rem * 10 + (+v.charAt(k))) % 97;
    }
    return rem === 1;
  }

  // every IBAN-looking run in the text (spaces inside allowed), valid ones first
  function findIbans(text) {
    var out = [];
    var re = /\b[A-Z]{2}\d{2}(?:[  ]?[A-Z0-9]){11,34}/g;
    String(text || '').toUpperCase().split('\n').forEach(function (line) {
      re.lastIndex = 0;
      var m;
      while ((m = re.exec(line))) {
        var compact = m[0].replace(/[\s ]/g, '');
        // the run may have swallowed a following word: shrink until the checksum holds
        var hit = null;
        for (var len = Math.min(34, compact.length); len >= 15 && !hit; len--) if (ibanValid(compact.slice(0, len))) hit = compact.slice(0, len);
        if (hit && out.indexOf(hit) === -1) out.push(hit);
      }
    });
    return out;
  }

  var REF_KEYS = /(?:sklic|referenca|reference|poziv\s+na\s+broj|model\s+in\s+sklic|payment\s+ref\w*|verwendungszweck)/i;
  var REF_VALUE = /\b((?:SI|HR|RF)\s?\d{2}\s*[0-9A-Z][0-9A-Z\-\/ ]{0,28}[0-9A-Z])/i;
  var PO_KEYS = /(?:naro[cč]ilnic\w*|purchase\s+order|\bpo\s*(?:number|no\.?|nr\.?|#)|order\s+(?:number|no\.?)|va[sš]e\s+naro[cč]ilo|[sš]t\.\s*naro[cč]ila|bestellnummer|narud[zž]benic\w*)\s*[:#.]?\s*([A-Z0-9][A-Z0-9\-\/._]{1,30})/i;

  function findReference(lines) {
    for (var i = 0; i < lines.length; i++) {
      if (!REF_KEYS.test(lines[i])) continue;
      var after = lines[i].slice(lines[i].search(REF_KEYS));
      var m = after.match(REF_VALUE) || (lines[i + 1] || '').match(REF_VALUE);
      if (m) return m[1].replace(/\s{2,}/g, ' ').trim().toUpperCase().slice(0, 40);
    }
    return '';
  }

  function findPoNumber(lines) {
    for (var i = 0; i < lines.length; i++) {
      var m = lines[i].match(PO_KEYS);
      if (m && /\d/.test(m[1])) return m[1].replace(/[.,;:]+$/, '');
    }
    return '';
  }

  function findServiceDate(lines) {
    for (var i = 0; i < lines.length; i++) {
      if (SERVICE_KEYS.test(lines[i])) {
        var d = dateAfterKey(lines, i, SERVICE_KEYS);
        if (d) return d;
      }
    }
    return null;
  }

  // ---------- billed to: which of your own companies the invoice is addressed to ----------

  var BUYER_LABEL = /\b(kupec|prejemnik|naro[cč]nik|pla[cč]nik|ra[cč]un\s+za|bill(?:ed)?\s+to|invoice\s+to|sold\s+to|buyer|customer|client|kupac|primatelj|naru[cč]itelj|rechnungsempf\w*|kunde|naslovnik|stranka)\b/i;

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // the words of a company name that identify it ("ADRIAL, trgovina in storitve, d.o.o." → "adrial")
  function companyNeedles(c) {
    var out = [];
    [c.name].concat(c.variants || []).forEach(function (v) {
      var n = norm(v).replace(/\s+/g, ' ').trim();
      if (!n) return;
      out.push(n);
      // the distinctive head before ", trgovina…" / "d.o.o."
      var head = n.split(',')[0].replace(LEGAL_SUFFIX, ' ').replace(/\s+/g, ' ').trim();
      if (head.length >= 3 && out.indexOf(head) === -1) out.push(head);
    });
    return out.filter(function (n) { return n.length >= 3; });
  }

  function companyHits(line, c) {
    var hits = [];
    var nl = norm(line);
    var compactLine = String(line).toUpperCase().replace(/[\s.\-]/g, '');
    var vat = String(c.vatId || '').replace(/[\s.\-]/g, '').toUpperCase();
    if (vat.length >= 8) {
      var bare = vat.replace(/^[A-Z]{2}/, '');
      var vi = compactLine.indexOf(vat);
      if (vi === -1 && bare.length >= 8) vi = compactLine.search(new RegExp('(^|[^0-9])' + bare + '([^0-9]|$)'));
      if (vi !== -1) hits.push({ kind: 'vat', w: 3 });
    }
    companyNeedles(c).forEach(function (n) {
      if (new RegExp('(^|[^a-z0-9])' + escapeRe(n) + '(?![a-z0-9])').test(nl)) hits.push({ kind: 'name', w: 2 + Math.min(1, n.length / 30) });
    });
    (c.keywords || []).forEach(function (k) {
      var nk = norm(k).trim();
      if (nk.length >= 4 && nl.indexOf(nk) !== -1) hits.push({ kind: 'keyword', w: 1 });
    });
    return hits;
  }

  // companies: [{ id, name, variants[], vatId, keywords[] }] → { id, conf, candidates }
  function findBilledTo(lines, companies) {
    lines = (lines || []).map(function (l) { return String(l).replace(/ /g, ' '); });
    var list = (companies || []).filter(function (c) { return c && c.id && c.name; });
    if (!list.length || !lines.length) return { id: '', conf: 'none', candidates: [] };
    var labels = [];
    lines.forEach(function (l, i) {
      var cells = l.split(/\s{3,}/);
      for (var c = 0; c < cells.length; c++) if (BUYER_LABEL.test(cells[c])) { labels.push({ line: i, cell: c }); break; }
    });
    var scores = {};
    list.forEach(function (c) {
      lines.forEach(function (line, i) {
        var cells = line.split(/\s{3,}/);
        cells.forEach(function (cell, ci) {
          var hits = companyHits(cell, c);
          if (!hits.length) return;
          var base = Math.max.apply(null, hits.map(function (h) { return h.w; }));
          var near = null;
          labels.forEach(function (lb) {
            var d = i - lb.line;
            if (d < 0 || d > 7) return;
            var s = 4 - d * 0.35 + (lb.cell === ci || cells.length === 1 ? 1 : 0);
            if (near == null || s > near) near = s;
          });
          var score = base + (near || 0);
          // the vendor's own letterhead: top of the page and no buyer label above it
          if (near == null && i < 4) score -= 1.5;
          var cur = scores[c.id];
          if (!cur || score > cur.score) scores[c.id] = { id: c.id, score: score, buyer: near != null, vat: hits.some(function (h) { return h.kind === 'vat'; }) };
        });
      });
    });
    var cands = Object.keys(scores).map(function (k) { return scores[k]; }).sort(function (a, b) { return b.score - a.score; });
    if (!cands.length) return { id: '', conf: 'none', candidates: [] };
    var top = cands[0];
    var conf;
    if (top.buyer && (cands.length === 1 || top.score - cands[1].score >= 1)) conf = 'high';
    else if (cands.length === 1) conf = top.vat || top.score >= 2 ? 'medium' : 'low';
    else conf = top.score - cands[1].score >= 1.5 ? 'medium' : 'low';
    return { id: top.id, conf: conf, candidates: cands.map(function (c) { return c.id; }) };
  }

  // ---------- billed to person: whose email is in the buyer block ----------

  var EMAIL_RE = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,}/g;
  var GENERIC_LOCAL = /^(support|billing|bill|bills|invoice|invoices|invoicing|noreply|no-reply|donotreply|do-not-reply|info|sales|account|accounts|accounting|receivable|receivables|payment|payments|help|hello|contact|team|service|services|customerservice|customer-service|office|admin|finance|racun|racuni|fakture|podpora|prodaja|narocila|orders|order|mail|post|news|newsletter|marketing)$/i;
  var PERSON_NAME = /^[A-ZČŠŽĆĐÄÖÜ][a-zčšžćđäöüé'’\-]+(?:\s+[A-ZČŠŽĆĐÄÖÜ][a-zčšžćđäöüé'’\-]+){1,3}$/;

  function nameFromEmail(email) {
    var local = String(email || '').split('@')[0].replace(/\+.*$/, '');
    var parts = local.split(/[._\-]+/).map(function (p) { return p.replace(/\d+/g, ''); }).filter(Boolean);
    if (!parts.length) return '';
    return parts.map(function (p) { return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase(); }).join(' ');
  }

  function looksLikePerson(s) {
    var t = String(s || '').replace(/[<(\[,;:|]+\s*$/, '').trim();
    return PERSON_NAME.test(t) && !LEGAL_SUFFIX.test(t) && !BUYER_LABEL.test(t) && !NOT_A_NAME.test(t) ? t : '';
  }

  function emailDomain(e) { return String(e).split('@')[1].toLowerCase(); }

  // opts: { users: [{ email, name, aliases[] }], vendor: 'Anthropic, PBC', companies } → { email, name, conf, known }
  function findBilledPerson(lines, opts) {
    opts = opts || {};
    lines = (lines || []).map(function (l) { return String(l).replace(/[\u0000-\u001f ]/g, ' '); });
    var none = { email: '', name: '', conf: 'none', known: false };
    var users = (opts.users || []).filter(function (u) { return u && u.email; });
    var known = {};
    users.forEach(function (u) {
      [u.email].concat(u.aliases || []).forEach(function (e) { if (e) known[String(e).toLowerCase()] = u; });
    });
    var ownDomains = {};
    users.forEach(function (u) { ownDomains[emailDomain(u.email)] = true; });
    var vendorKey = norm(opts.vendor || '').replace(LEGAL_SUFFIX, ' ').split(/[^a-z0-9]+/).filter(function (w) { return w.length >= 4; });

    var labels = [];
    lines.forEach(function (l, i) {
      var cells = l.split(/\s{3,}/);
      for (var c = 0; c < cells.length; c++) if (BUYER_LABEL.test(cells[c])) { labels.push({ line: i, cell: c, cells: cells.length }); break; }
    });

    var found = [];
    lines.forEach(function (line, i) {
      var cells = line.split(/\s{3,}/);
      cells.forEach(function (cell, ci) {
        EMAIL_RE.lastIndex = 0;
        var m;
        while ((m = EMAIL_RE.exec(cell))) {
          var email = m[0].replace(/[.\-]+$/, '').toLowerCase();
          var near = null;
          labels.forEach(function (lb) {
            var d = i - lb.line;
            if (d < 0 || d > 9) return;
            if (!(cells.length === 1 || lb.cells === 1 || ci === lb.cell)) return;
            var s = 5 - d * 0.3;
            if (near == null || s > near) near = s;
          });
          found.push({ email: email, line: i, cell: ci, cells: cells, at: m.index, near: near });
        }
      });
    });
    if (!found.length) return none;

    // the vendor's domains: emails outside the buyer block, and domains named like the vendor
    var vendorDomains = {};
    found.forEach(function (f) { if (f.near == null && !known[f.email] && !ownDomains[emailDomain(f.email)]) vendorDomains[emailDomain(f.email)] = true; });
    function isVendorDomain(dom) {
      if (vendorDomains[dom] && !ownDomains[dom]) return true;
      var labelsOfDomain = dom.split('.');
      return vendorKey.some(function (w) { return labelsOfDomain.indexOf(w) !== -1; }) && !ownDomains[dom];
    }

    var best = null;
    var accepted = [];
    found.forEach(function (f) {
      var local = f.email.split('@')[0];
      var dom = emailDomain(f.email);
      var isKnown = !!known[f.email];
      if (!isKnown && isVendorDomain(dom)) return;
      if (!isKnown && GENERIC_LOCAL.test(local) && !(f.near != null && ownDomains[dom])) return;
      var score;
      if (f.near != null) score = f.near + (isKnown ? 2 : 0) + (ownDomains[dom] ? 1 : 0);
      else if (isKnown || ownDomains[dom]) score = isKnown ? 1.5 : 1;
      else return;
      accepted.push(f);
      if (!best || score > best.score) best = Object.assign({ score: score, isKnown: isKnown }, f);
    });
    if (!best) return none;
    var rivals = accepted.filter(function (f) { return f.near != null && f.email !== best.email; }).length;
    var conf = best.near != null ? (rivals ? 'medium' : 'high') : (best.isKnown ? 'medium' : 'low');

    // a name next to the email: same cell before it ("Simon Modic <simon@…>"), else the line above
    var name = '';
    var before = best.cells[best.cell].slice(0, best.at).replace(/[<(\[]\s*$/, '').trim();
    name = looksLikePerson(before);
    if (!name && best.line > 0) {
      var prevCells = lines[best.line - 1].split(/\s{3,}/);
      var prev = prevCells.length === 1 ? prevCells[0] : (prevCells[best.cell] || '');
      name = looksLikePerson(prev.trim());
    }
    var user = known[best.email];
    if (user && user.name) name = user.name;
    return { email: user ? user.email.toLowerCase() : best.email, name: name || nameFromEmail(best.email), conf: conf, known: !!user };
  }

  // ---------- one field from a piece of text the user selected on the PDF ----------

  var FIELD_KIND = {
    vendor: 'name', vendorTaxId: 'vatid', number: 'code', poNumber: 'code',
    issueDate: 'date', dueDate: 'date', serviceDate: 'date',
    net: 'amount', vat: 'amount', total: 'amount', vatRate: 'rate',
    currency: 'currency', iban: 'iban', reference: 'reference', category: 'category', billedTo: 'company', billedPerson: 'person'
  };
  var ISO_CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'HRK', 'RSD', 'BAM', 'HUF', 'CZK', 'PLN', 'SEK', 'NOK', 'DKK', 'RON', 'BGN', 'MKD', 'JPY', 'CAD', 'AUD', 'CNY'];

  // "Datum računa: 31.12.2026" → "31.12.2026"; lines that are only a label are dropped
  function stripLabel(text) {
    return String(text || '').split('\n').map(function (l) {
      var m = l.match(/^\s*[^\d:]{2,48}:\s*(\S.*)$/);
      return (m ? m[1] : l).trim();
    }).filter(function (l) { return l && !/^[^\d]{2,48}:$/.test(l); }).join('\n');
  }

  function lastNumber(text) {
    var s = stripDates(String(text || ''));
    var re = /-?\d{1,3}(?:[.,'  ]\d{3})+(?:[.,]\d{1,2})?(?!\d)|-?\d+(?:[.,]\d{1,2})?(?!\d)/g;
    var m;
    var last = null;
    while ((m = re.exec(s))) last = m[0];
    if (last == null) return null;
    var n = toNumber(last);
    return isFinite(n) ? n : null;
  }

  function parseField(field, raw, options) {
    var opts = options || {};
    var text = String(raw || '').replace(/ /g, ' ').replace(/[ \t]+\n/g, '\n').trim();
    var kind = FIELD_KIND[field] || 'code';
    var fail = { ok: false, value: null };
    if (!text) return fail;
    var flat = text.replace(/\s*\n\s*/g, '   ');

    if (kind === 'date') {
      var ds = findDates(flat);
      if (!ds.length) ds = findDates(flat.replace(/\s+/g, ''));
      return ds.length ? { ok: true, value: ds[0].iso } : fail;
    }
    if (kind === 'amount') {
      var found = [];
      text.split('\n').forEach(function (l) { moneyIn(l).forEach(function (a) { found.push(a); }); });
      if (found.length) {
        var a = found[found.length - 1];
        return { ok: true, value: round2(a.value), currency: a.currency || null };
      }
      var n = lastNumber(stripLabel(text));
      return n == null ? fail : { ok: true, value: round2(n), currency: null };
    }
    if (kind === 'rate') {
      var rm = flat.match(/(\d{1,2}(?:[.,]\d{1,2})?)\s?%/);
      var r = rm ? parseFloat(rm[1].replace(',', '.')) : lastNumber(stripLabel(text));
      return r != null && r >= 0 && r <= 30 ? { ok: true, value: r } : fail;
    }
    if (kind === 'currency') {
      for (var c = 0; c < CURRENCIES.length; c++) {
        CURRENCIES[c].re.lastIndex = 0;
        if (CURRENCIES[c].re.test(flat)) return { ok: true, value: CURRENCIES[c].code };
      }
      var codes = flat.toUpperCase().match(/\b[A-Z]{3}\b/g) || [];
      for (var k = 0; k < codes.length; k++) if (ISO_CURRENCIES.indexOf(codes[k]) !== -1) return { ok: true, value: codes[k] };
      return fail;
    }
    if (kind === 'iban') {
      var ibans = findIbans(text);
      if (ibans.length) return { ok: true, value: ibans[0] };
      var loose = flat.toUpperCase().match(/[A-Z]{2}\d{2}(?:[ .\-]?[A-Z0-9]){11,34}/);
      var looseVal = loose ? loose[0].replace(/[\s.\-]/g, '').replace(/[A-Z]+$/, '').slice(0, 34) : '';
      return looseVal.length >= 15 ? { ok: true, value: looseVal, warn: 'The IBAN checksum does not add up — check it.' } : fail;
    }
    if (kind === 'vatid') {
      TAX_ID_RE.lastIndex = 0;
      var tm = TAX_ID_RE.exec(flat);
      if (tm) return { ok: true, value: tm[1].replace(/\s/g, '').toUpperCase() };
      var joined = flat.toUpperCase().replace(/(\d)[\s.](?=\d)/g, '$1').replace(/\b([A-Z]{2})\s(?=\d)/g, '$1');
      var vm = joined.match(/\b([A-Z]{2}\d{8,12})\b/) || joined.match(/\b(ATU\d{8})\b/) || joined.match(/\b([A-Z]{2}(?=[0-9A-Z]*\d{6})[0-9A-Z]{8,12})\b/) || joined.match(/\b(\d{8,11})\b/);
      return vm ? { ok: true, value: vm[1] } : fail;
    }
    if (kind === 'reference') {
      var rf = flat.match(REF_VALUE);
      var refText = rf ? rf[1] : stripLabel(text).replace(/\s+/g, ' ');
      refText = refText.replace(/\s{2,}/g, ' ').trim().toUpperCase().slice(0, 60);
      return refText ? { ok: true, value: refText } : fail;
    }
    if (kind === 'code') {
      var body = stripLabel(text);
      var tokens = body.split(/\s+/);
      for (var t = 0; t < tokens.length; t++) {
        var tok = tokens[t].replace(/^[#:]+|[.,;:]+$/g, '');
        if (/\d/.test(tok) && /^[A-Z0-9][A-Z0-9\-\/._]{0,40}$/i.test(tok)) return { ok: true, value: tok };
      }
      var plain = body.replace(/\s+/g, ' ').trim().slice(0, 80);
      return plain ? { ok: true, value: plain } : fail;
    }
    if (kind === 'person') {
      EMAIL_RE.lastIndex = 0;
      var em = EMAIL_RE.exec(text);
      if (!em) return fail;
      var mail = em[0].replace(/[.\-]+$/, '').toLowerCase();
      var u = (opts.users || []).find(function (x) { return x.email && (x.email.toLowerCase() === mail || (x.aliases || []).some(function (a) { return String(a).toLowerCase() === mail; })); });
      var nm = looksLikePerson(text.slice(0, em.index).split('\n').pop().replace(/[<(\[]\s*$/, '').trim()) ||
        looksLikePerson((text.slice(0, em.index).split('\n').filter(function (l) { return l.trim(); }).slice(-2, -1)[0] || '').trim());
      return { ok: true, value: u ? u.email.toLowerCase() : mail, name: (u && u.name) || nm || nameFromEmail(mail) };
    }
    if (kind === 'company') {
      var found2 = findBilledTo(text.split('\n'), opts.companies || []);
      if (!found2.id) {
        // a selection is usually just the buyer block: drop the letterhead penalty by scoring per line
        var all2 = (opts.companies || []).filter(function (c) { return companyHits(text, c).length; });
        if (all2.length) return { ok: true, value: all2[0].id };
      }
      return found2.id ? { ok: true, value: found2.id } : fail;
    }
    if (kind === 'category') {
      var cats = opts.categories || DEFAULT_CATEGORIES;
      var nt = norm(text);
      for (var ci = 0; ci < cats.length; ci++) if (nt.indexOf(norm(cats[ci])) !== -1) return { ok: true, value: cats[ci] };
      var g = guessCategory('', text, null);
      return { ok: true, value: cats.indexOf(g) !== -1 ? g : 'Other', guessed: true };
    }
    // name: first line that is not just a label, without a "Supplier:" prefix
    var lines = text.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
    for (var li = 0; li < lines.length; li++) {
      var line = lines[li];
      var sm = line.match(SELLER_MARK);
      if (sm) line = sm[2] || '';
      line = line.split(/\s{3,}/)[0];
      line = cleanName(line);
      if (line.length >= 2 && !/:$/.test(line)) return { ok: true, value: line.slice(0, 200) };
    }
    return fail;
  }

  function guessCategory(vendor, text, known) {
    if (known) return known;
    var v = norm(vendor);
    for (var i = 0; i < CATEGORY_RULES.length; i++) if (CATEGORY_RULES[i][1].test(v)) return CATEGORY_RULES[i][0];
    var t = norm(text).slice(0, 6000);
    var best = null;
    var bestHits = 0;
    CATEGORY_RULES.forEach(function (r) {
      var re = new RegExp(r[1].source, 'gi');
      var hits = (t.match(re) || []).length;
      if (hits > bestHits) { best = r[0]; bestHits = hits; }
    });
    return best || 'Other';
  }

  // ---------- main ----------

  function parseInvoice(lines, options) {
    var opts = options || {};
    lines = (lines || []).map(function (l) { return String(l).replace(/ /g, ' '); }).filter(function (l) { return l.trim() !== ''; });
    lines = lines.map(function (l) { return l.replace(/[\u0000-\u0008\u000b-\u001f]/g, ' '); });
    var text = lines.join('\n');
    if (text.replace(/\s/g, '').length < 20) {
      return {
        scanned: true, vendor: '', vendorTaxId: '', number: '', issueDate: null, dueDate: null,
        currency: 'EUR', total: null, vat: null, net: null, category: 'Other', vatRate: null,
        confidence: { vendor: 'none', number: 'none', issueDate: 'none', dueDate: 'none', total: 'none', vat: 'none', net: 'none' }
      };
    }
    var vendor = findVendor(lines, opts);
    var number = findNumber(lines);
    var dates = findDatesFields(lines);
    var amounts = solveAmounts(lines, text);
    var currency = detectCurrency(text);
    var rates = findRates(text);
    var category = (vendor.rule && vendor.rule.category) || guessCategory(vendor.vendor, text, vendor.category);
    var vatRate = null;
    if (amounts.vat && amounts.net) {
      var r = Math.round((amounts.vat / amounts.net) * 1000) / 10;
      var known = rates.filter(function (x) { return Math.abs(x - r) < 0.6; });
      vatRate = known.length ? known[0] : r;
    } else if (amounts.vat === 0) {
      vatRate = 0;
    }
    var ownIbans = (opts.ownIbans || []).map(function (x) { return String(x).replace(/\s/g, '').toUpperCase(); });
    var iban = findIbans(text).filter(function (x) { return ownIbans.indexOf(x) === -1; })[0] || '';
    var billed = findBilledTo(lines, opts.companies);
    var person = findBilledPerson(lines, { users: opts.users, vendor: vendor.vendor, companies: opts.companies });
    return {
      billedTo: billed.id,
      billedPerson: person.email,
      billedPersonName: person.name,
      billedPersonKnown: person.known,
      reverseCharge: NO_VAT.test(text),
      scanned: false,
      vendor: vendor.vendor,
      vendorTaxId: vendor.vendorTaxId || '',
      number: number.value,
      issueDate: dates.issueDate,
      dueDate: dates.dueDate,
      currency: currency,
      total: amounts.total,
      vat: amounts.vat,
      net: amounts.net,
      vatRate: vatRate,
      serviceDate: findServiceDate(lines),
      iban: iban,
      reference: findReference(lines),
      poNumber: findPoNumber(lines),
      category: category,
      confidence: {
        vendor: vendor.conf,
        number: number.conf,
        issueDate: dates.conf.issueDate,
        dueDate: dates.conf.dueDate,
        total: amounts.conf.total,
        vat: amounts.conf.vat,
        net: amounts.conf.net,
        billedTo: billed.conf,
        billedPerson: person.conf
      }
    };
  }

  var api = {
    parseInvoice: parseInvoice,
    parseField: parseField,
    findBilledTo: findBilledTo,
    findBilledPerson: findBilledPerson,
    nameFromEmail: nameFromEmail,
    ibanValid: ibanValid,
    findDates: findDates,
    moneyIn: moneyIn,
    toNumber: toNumber,
    guessCategory: guessCategory,
    norm: norm,
    DEFAULT_CATEGORIES: DEFAULT_CATEGORIES
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.InvoiceParser = api;
})(typeof window !== 'undefined' ? window : this);
