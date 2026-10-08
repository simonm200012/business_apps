/* InvoiceParser: text lines -> vendor, VAT ID, number, dates, amounts, IBAN, reference, category (+ per-field confidence). Also runs in Node. */
(function (root) {
  'use strict';
  var DEFAULT_CATEGORIES = [
    { id: 'software', name: 'Software & SaaS' }, { id: 'hosting', name: 'Hosting & cloud' }, { id: 'marketing', name: 'Advertising & marketing' },
    { id: 'telecom', name: 'Phone & internet' }, { id: 'utilities', name: 'Utilities' }, { id: 'rent', name: 'Rent & premises' },
    { id: 'travel', name: 'Travel & accommodation' }, { id: 'vehicle', name: 'Fuel & vehicles' }, { id: 'office', name: 'Office & supplies' },
    { id: 'professional', name: 'Accounting & legal' }, { id: 'insurance', name: 'Insurance' }, { id: 'other', name: 'Other' }];
  var KNOWN_VENDORS = [
    { re: /telekom\s+slovenije/i, name: 'Telekom Slovenije, d.d.', cat: 'telecom' }, { re: /\ba1\s+slovenija/i, name: 'A1 Slovenija, d.d.', cat: 'telecom' },
    { re: /\btelemach\b/i, name: 'Telemach d.o.o.', cat: 'telecom' }, { re: /\bpetrol\s+d\.?\s?d\.?|\bpetrol\b.*ljubljana/i, name: 'Petrol d.d., Ljubljana', cat: 'vehicle' },
    { re: /\bomv\b/i, name: 'OMV Slovenija d.o.o.', cat: 'vehicle' }, { re: /\bdars\b/i, name: 'DARS d.d.', cat: 'vehicle' },
    { re: /elektro\s+(ljubljana|celje|maribor|gorenjska|primorska)/i, name: null, cat: 'utilities' }, { re: /energetika\s+ljubljana/i, name: 'Energetika Ljubljana d.o.o.', cat: 'utilities' },
    { re: /\bvo-?ka\s+snaga\b/i, name: 'JP VOKA SNAGA d.o.o.', cat: 'utilities' }, { re: /zavarovalnica\s+triglav/i, name: 'Zavarovalnica Triglav, d.d.', cat: 'insurance' },
    { re: /\bgoogle\s+(ireland|cloud|workspace|commerce)|google\s+llc/i, name: 'Google', cat: 'software' }, { re: /\bmeta\s+platforms|facebook\s+ireland/i, name: 'Meta Platforms Ireland Ltd', cat: 'marketing' },
    { re: /microsoft\s+(ireland|corporation)/i, name: 'Microsoft', cat: 'software' }, { re: /amazon\s+web\s+services/i, name: 'Amazon Web Services EMEA SARL', cat: 'hosting' },
    { re: /adobe\s+(systems|inc)/i, name: 'Adobe Systems Software Ireland Ltd', cat: 'software' }, { re: /\bhetzner\b/i, name: 'Hetzner Online GmbH', cat: 'hosting' },
    { re: /digitalocean|cloudflare/i, name: null, cat: 'hosting' }, { re: /\bslack\b|atlassian|\bnotion\b|github,? inc/i, name: null, cat: 'software' },
    { re: /po[sš]ta\s+slovenije/i, name: 'Pošta Slovenije d.o.o.', cat: 'office' }, { re: /slovenske\s+[zž]eleznice/i, name: 'Slovenske železnice d.o.o.', cat: 'travel' },
    { re: /booking\.com|airbnb|ryanair|wizz\s*air|lufthansa|adria\s+airways|air\s+france/i, name: null, cat: 'travel' }, { re: /\bmercator\b|\bspar\b|\bhofer\b|\bmueller\b|\bmüller\b|\binterspar\b/i, name: null, cat: 'office' }];
  var CATEGORY_RULES = [
    { cat: 'telecom', re: /mobil|telefon|internet|broadband|roaming|sim\b|telekom|gsm/i }, { cat: 'hosting', re: /hosting|cloud|server|domain|domena|vps|aws|azure|cdn/i },
    { cat: 'software', re: /licen[cs]|software|subscription|naro[cč]nina|saas|app\b|workspace|plugin/i }, { cat: 'marketing', re: /advertis|oglas|marketing|google ads|facebook ads|campaign|kampanj|seo\b/i },
    { cat: 'utilities', re: /elektri|električn|plin\b|voda\b|vodovod|odpadk|komunal|heating|ogrevanje|energy|energij/i }, { cat: 'rent', re: /najemnin|rent\b|lease|poslovni prostor|stroški upravljanja/i },
    { cat: 'travel', re: /hotel|nastanitev|accommodation|flight|let\b|airline|vlak|train|taxi|prevoz|potni stro/i }, { cat: 'vehicle', re: /gorivo|diesel|bencin|fuel|vinjeta|cestnina|parkiranje|leasing vozil|servis vozil|avto/i },
    { cat: 'professional', re: /računovod|racunovod|odvetnik|notar|svetovanje|consult|revizij|accounting|legal|knjigovod/i }, { cat: 'insurance', re: /zavarovanj|insurance|polica\b|premium|zavarovalnica/i },
    { cat: 'office', re: /pisarn|office|papir|toner|oprema|material|supplies|pošt|stationery/i }];
  var KNOWN_RATES = [0, 5, 7, 8.5, 9.5, 10, 13, 19, 20, 21, 22, 23, 24, 25, 27];
  var LEGAL = /\b(d\.\s?o\.\s?o\.|d\.\s?d\.|s\.\s?p\.|d\.\s?n\.\s?o\.|k\.\s?d\.|j\.\s?d\.\s?o\.\s?o\.|gmbh(?:\s*&\s*co\.?\s*kg)?|ag|kg|ltd\.?|limited|llc|inc\.?|corp\.?|s\.\s?r\.\s?l\.?|s\.\s?a\.?|sarl|b\.\s?v\.|oy|ab|a\/s|sp\.\s?z\s?o\.\s?o\.|s\.\s?r\.\s?o\.|zavod|z\.o\.o\.)(?=[\s,.;:)]|$)/i;
  var CURRENCIES = [['EUR', /EUR|€/g], ['USD', /USD|US\$|\$/g], ['GBP', /GBP|£/g], ['CHF', /CHF/g], ['HRK', /HRK|\bkn\b/g], ['PLN', /PLN|zł/g], ['CZK', /CZK|Kč/g], ['HUF', /HUF|\bFt\b/g], ['SEK', /SEK/g], ['RSD', /RSD/g]];
  var IBAN_LEN = { AL: 28, AD: 24, AT: 20, BE: 16, BA: 20, BG: 22, HR: 21, CY: 28, CZ: 24, DK: 18, EE: 20, FI: 18, FR: 27, DE: 22, GR: 27, HU: 28, IE: 22, IT: 27, LV: 21, LT: 20, LU: 20, MT: 31, MK: 19, ME: 22, NL: 18, NO: 15, PL: 28, PT: 25, RO: 24, RS: 22, SK: 24, SI: 19, ES: 24, SE: 24, CH: 21, GB: 22, TR: 26 };

  function strip(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D'); }
  function normName(s) { return strip(s).toLowerCase().replace(LEGAL, ' ').replace(/[^a-z0-9]+/g, ' ').trim(); }
  function vatNorm(s) { return String(s || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase(); }
  function round2(x) { return Math.round(x * 100) / 100; }
  function near(a, b, t) { return Math.abs(a - b) <= (t == null ? 0.011 : t); }
  function esc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  /* "1.234,56" "1,234.56" "1 234,56" "1'234.56": last . or , is the decimal point unless exactly 3 digits follow it and it is the only separator kind */
  function toNumber(s) {
    if (typeof s === 'number') return s;
    var t = String(s || '').replace(/[\s\u00a0']/g, '').replace(/[^\d.,\-]/g, ''), neg = /^-/.test(t) || /-$/.test(t);
    t = t.replace(/-/g, '');
    if (!/\d/.test(t)) return NaN;
    var li = Math.max(t.lastIndexOf('.'), t.lastIndexOf(',')), r;
    if (li < 0) r = parseFloat(t);
    else {
      var after = t.slice(li + 1), sepKinds = (t.indexOf('.') >= 0 ? 1 : 0) + (t.indexOf(',') >= 0 ? 1 : 0), cnt = (t.match(/[.,]/g) || []).length;
      if (after.length === 3 && sepKinds === 1 && (cnt >= 1)) r = parseFloat(t.replace(/[.,]/g, ''));
      else r = parseFloat(t.slice(0, li).replace(/[.,]/g, '') + '.' + after);
    }
    return neg ? -r : r;
  }
  var AMOUNT_RE = /(?<![\d.,])-?(?:\d{1,3}(?:[ \u00a0'.,]\d{3})*[.,]\d{2}|\d+[.,]\d{2})(?![\d]|[.,]\d)/g;
  function amountsIn(line) {
    var out = [], m; AMOUNT_RE.lastIndex = 0;
    while ((m = AMOUNT_RE.exec(line))) {
      var rest = line.slice(m.index + m[0].length);
      if (/^\s*%/.test(rest)) continue;
      var v = toNumber(m[0]); if (isFinite(v)) out.push({ v: v, i: m.index, raw: m[0] });
    }
    return out;
  }

  /* ---------- dates ---------- */
  var MONTH_PREFIX = { jan: 1, feb: 2, vel: 2, mar: 3, apr: 4, maj: 5, may: 5, mai: 5, jun: 6, jul: 7, avg: 8, aug: 8, sep: 9, okt: 10, oct: 10, nov: 11, dec: 12, dez: 12, sij: 1, ozu: 3, tra: 4, svi: 5, lip: 6, srp: 7, kol: 8, ruj: 9, lis: 10, stu: 11, pro: 12 };
  function monthNum(w) { return MONTH_PREFIX[strip(w).toLowerCase().slice(0, 3)] || 0; }
  function iso(y, m, d) {
    y = +y; m = +m; d = +d; if (y < 100) y += 2000;
    if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
    var dt = new Date(Date.UTC(y, m - 1, d)); if (dt.getUTCMonth() !== m - 1) return null;
    return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }
  var DATE_PATTERNS = [
    { re: /(?<![\d.])(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?![\d])/g, f: function (m) { return iso(m[1], m[2], m[3]); } },
    { re: /(?<![\d.\/])(\d{1,2})\s?[./-]\s?(\d{1,2})\s?[./-]\s?(\d{4})(?![\d])/g, f: function (m) { return iso(m[3], m[2], m[1]); } },
    { re: /(?<![\d.\/])(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{2})(?![\d.,])/g, f: function (m) { return iso(m[3], m[2], m[1]); } },
    { re: /(?<![\d])(\d{1,2})(?:st|nd|rd|th)?\.?\s+(?:of\s+)?([A-Za-zÀ-žčšžćđäöü]{3,10})\.?,?\s+(\d{4})(?![\d])/g, f: function (m) { var mo = monthNum(m[2]); return mo ? iso(m[3], mo, m[1]) : null; } },
    { re: /\b([A-Za-zäöü]{3,10})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})(?![\d])/g, f: function (m) { var mo = monthNum(m[1]); return mo ? iso(m[3], mo, m[2]) : null; } }];
  function findDates(line) {
    var all = [];
    DATE_PATTERNS.forEach(function (p) {
      p.re.lastIndex = 0; var m;
      while ((m = p.re.exec(line))) { var d = p.f(m); if (d) all.push({ iso: d, i: m.index, end: m.index + m[0].length }); }
    });
    all.sort(function (a, b) { return a.i - b.i || (b.end - a.end); });
    var out = []; all.forEach(function (d) { if (!out.length || d.i >= out[out.length - 1].end) out.push(d); });
    return out;
  }

  /* ---------- IBAN ---------- */
  function ibanValid(s) {
    s = String(s || '').replace(/\s+/g, '').toUpperCase();
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
    if (IBAN_LEN[s.slice(0, 2)] && IBAN_LEN[s.slice(0, 2)] !== s.length) return false;
    var t = s.slice(4) + s.slice(0, 4), rem = 0;
    for (var i = 0; i < t.length; i++) { var c = t.charCodeAt(i); var v = c >= 65 ? String(c - 55) : t[i]; for (var k = 0; k < v.length; k++) rem = (rem * 10 + (+v[k])) % 97; }
    return rem === 1;
  }
  function findIbans(lines, skip) {
    var out = [], seen = {}; skip = (skip || []).map(function (x) { return x.replace(/\s+/g, '').toUpperCase(); });
    lines.forEach(function (ln, li) {
      var re = /[A-Z]{2}\d{2}[A-Z0-9 ]{11,40}/g, m, up = ln.toUpperCase();
      while ((m = re.exec(up))) {
        var s = m[0].replace(/ /g, '');
        for (var L = Math.min(s.length, 34); L >= 15; L--) {
          var c = s.slice(0, L);
          if (ibanValid(c)) { if (!seen[c] && skip.indexOf(c) < 0) { seen[c] = 1; out.push({ iban: c, li: li }); } re.lastIndex = m.index + 4; break; }
        }
      }
    });
    return out;
  }

  /* ---------- amounts ---------- */
  var VAT_KEY = /ddv|\bvat\b|mwst|\bust\b|\btax\b|pdv|davek|\bgst\b|moms/i;
  var NET_KEY = /osnova|neto\b|netto|net amount|\bnet\b|subtotal|sub-total|zwischensumme|brez ddv|excl|ex\.? vat|without vat|before vat|ohne|bez pdv/i;
  function totalWeight(line) {
    var s = strip(line).toLowerCase(), w = 0;
    if (/skupaj za placilo|za placilo|za placati|znesek za placilo|amount due|total due|balance due|grand total|zu zahlen|gesamtbetrag|rechnungsbetrag|za uplatu|iznos za plac|amount payable|total payable|payable amount|zahlbetrag/.test(s)) w = 10;
    else if (/skupaj z ddv|skupaj \(?z ddv|total incl|incl\.? vat|inkl|brutto|gross|z ddv|with vat|invoice total|total amount|ukupno s pdv|mit mwst|total \(eur\)/.test(s)) w = 7;
    else if (/\bskupaj\b|\btotal\b|ukupno|\bsumme\b|\bgesamt\b|\bsum\b/.test(s)) w = 4;
    else if (/\bznesek\b|\bamount\b|\biznos\b|\bbetrag\b/.test(s)) w = 2;
    if (w && w < 7 && (NET_KEY.test(s) || VAT_KEY.test(s))) w -= 6;
    return w;
  }
  function currencyOf(text) {
    var best = null, bc = 0;
    CURRENCIES.forEach(function (c) { var m = text.match(c[1]); if (m && m.length > bc) { bc = m.length; best = c[0]; } });
    return best;
  }
  function snapRate(r) { for (var i = 0; i < KNOWN_RATES.length; i++) if (Math.abs(KNOWN_RATES[i] - r) <= 0.35) return KNOWN_RATES[i]; return Math.round(r * 10) / 10; }
  function ratesIn(text) {
    var out = [], re = /(\d{1,2}(?:[.,]\d)?)\s*%/g, m;
    while ((m = re.exec(text))) { var r = parseFloat(m[1].replace(',', '.')); if (KNOWN_RATES.indexOf(r) >= 0 && r > 0 && out.indexOf(r) < 0) out.push(r); }
    return out;
  }

  function solveAmounts(lines, opts) {
    var text = lines.join('\n'), all = [], cands = [], i, j;
    lines.forEach(function (ln, li) { amountsIn(ln).forEach(function (a) { a.li = li; all.push(a); }); });
    var res = { total: null, vat: null, net: null, vatRate: null, reverseCharge: false, confidence: { total: 'none', vat: 'none', net: 'none' }, method: '' };
    lines.forEach(function (ln, li) {
      var w = totalWeight(ln); if (w <= 0) return;
      var am = amountsIn(ln);
      if (am.length) cands.push({ w: w, v: am[am.length - 1].v, li: li, n: am.length, am: am });
      else if (li + 1 < lines.length) {
        var nx = amountsIn(lines[li + 1]);
        if (nx.length && nx.length <= 2 && totalWeight(lines[li + 1]) <= 0) cands.push({ w: w - 0.5, v: nx[nx.length - 1].v, li: li + 1, n: nx.length, am: nx });
      }
    });
    cands = cands.filter(function (c) { return c.v > 0; });
    cands.sort(function (a, b) { return b.w - a.w || b.v - a.v; });
    var T, tl = -1, tc = null;
    if (cands.length) { tc = cands[0]; T = tc.v; tl = tc.li; res.confidence.total = tc.w >= 7 ? 'high' : 'medium'; }
    else if (all.length) { T = all.reduce(function (m, a) { return Math.max(m, a.v); }, 0); res.confidence.total = 'low'; }
    if (!T) return res;
    res.total = round2(T);
    var vatLines = {}; lines.forEach(function (ln, li) { if (VAT_KEY.test(strip(ln)) && !/^\s*(id|identifikacijska|davčna)/i.test(ln) && totalWeight(ln) < 7) vatLines[li] = true; });
    // 0: per-rate rows
    var rows = [], seen = {};
    lines.forEach(function (ln, li) {
      var rs = []; var re = /(\d{1,2}(?:[.,]\d)?)\s*%/g, m; while ((m = re.exec(ln))) rs.push(parseFloat(m[1].replace(',', '.')));
      if (!rs.length) return;
      var am = amountsIn(ln).filter(function (a) { return a.v > 0; });
      rs.forEach(function (r) {
        if (!r) return;
        for (var a = 0; a < am.length; a++) for (var b = 0; b < am.length; b++) {
          if (a === b || !(am[b].v < am[a].v)) continue;
          if (near(am[a].v * r / 100, am[b].v, Math.max(0.02, am[b].v * 0.005))) { var key = r + '|' + am[a].v + '|' + am[b].v; if (!seen[key]) { seen[key] = 1; rows.push({ r: r, base: am[a].v, vat: am[b].v }); } return; }
        }
      });
    });
    function trySet(set) { var b = 0, v = 0; set.forEach(function (x) { b += x.base; v += x.vat; }); return near(b + v, T, 0.03) ? { base: round2(b), vat: round2(v) } : null; }
    var found = null;
    if (rows.length) {
      found = trySet(rows);
      if (!found) for (i = 0; i < rows.length && !found; i++) found = trySet([rows[i]]);
      if (!found) { var byRate = {}; rows.forEach(function (x) { if (!byRate[x.r] || byRate[x.r].base < x.base) byRate[x.r] = x; }); found = trySet(Object.keys(byRate).map(function (k) { return byRate[k]; })); }
    }
    if (found) { res.vat = found.vat; res.net = found.base; res.method = 'rate rows'; }
    // 1: a VAT amount + any other amount = total
    if (res.vat == null) {
      var vc = [];
      all.forEach(function (a) { if (a.v > 0 && a.v < T && (vatLines[a.li] || (a.li === tl && tc && tc.n >= 3))) vc.push(a); });
      vc.sort(function (a, b) { return (vatLines[b.li] ? 1 : 0) - (vatLines[a.li] ? 1 : 0); });
      for (i = 0; i < vc.length && res.vat == null; i++) for (j = 0; j < all.length; j++) {
        if (all[j] !== vc[i] && all[j].v > vc[i].v && all[j].v < T && near(all[j].v + vc[i].v, T)) { res.vat = round2(vc[i].v); res.net = round2(all[j].v); res.method = 'vat+amount'; break; }
      }
    }
    // 2: total * r / (100 + r) appears in the document
    if (res.vat == null) {
      var rs2 = ratesIn(text);
      for (i = 0; i < rs2.length && res.vat == null; i++) {
        var v = round2(T * rs2[i] / (100 + rs2[i]));
        if (all.some(function (a) { return near(a.v, v) && a.v !== T; })) { res.vat = v; res.net = round2(T - v); res.method = 'rate formula'; }
      }
    }
    // 3: a net line
    if (res.vat == null) {
      var nets = [];
      lines.forEach(function (ln, li) { if (NET_KEY.test(strip(ln)) && totalWeight(ln) < 7) amountsIn(ln).forEach(function (a) { if (a.v > 0 && a.v < T) nets.push(a); }); });
      for (i = 0; i < nets.length; i++) {
        var vv = round2(T - nets[i].v), ratio = vv / nets[i].v * 100;
        if (KNOWN_RATES.some(function (r) { return Math.abs(r - ratio) < 0.8; })) { res.vat = vv; res.net = round2(nets[i].v); res.method = 'net line'; break; }
      }
    }
    // 4: a strong VAT line alone
    if (res.vat == null) {
      Object.keys(vatLines).forEach(function (k) {
        if (res.vat != null) return;
        amountsIn(lines[k]).forEach(function (a) {
          if (res.vat != null || !(a.v > 0 && a.v < T)) return;
          var ratio = a.v / (T - a.v) * 100;
          if (KNOWN_RATES.some(function (r) { return r && Math.abs(r - ratio) < 0.6; })) { res.vat = round2(a.v); res.net = round2(T - a.v); res.method = 'vat line'; }
        });
      });
    }
    // 5: reverse charge / exempt
    var rc = /reverse charge|obrnjena davčna|obrnjeno davčno|oproščen|oprosceno|ni zavezanec|ni zavezanka|ni zavezan|nije obveznik|steuerfrei|vat exempt|exempt from vat|tax exempt|0\s?% vat|ddv 0\s?%|ddv ni obračunan|ne obračunava/i.test(strip(text) + '\n' + text);
    res.reverseCharge = rc && /reverse charge|obrnjena davčna|obrnjeno davčno/i.test(text);
    if (res.vat == null && rc) { res.vat = 0; res.net = res.total; res.method = 'exempt'; }
    if (res.vat != null) {
      res.confidence.vat = res.method === 'exempt' || res.method === 'vat line' ? 'medium' : 'high';
      res.confidence.net = res.confidence.vat;
      if (res.net > 0 && res.vat > 0 && near(res.net + res.vat, res.total, 0.02)) res.confidence.total = 'high';
      var distinct = {}; rows.forEach(function (x) { distinct[x.r] = 1; });
      if (res.method === 'rate rows' && Object.keys(distinct).length > 1) res.vatRate = null; else if (res.net > 0) res.vatRate = snapRate(res.vat / res.net * 100); else res.vatRate = 0;
    }
    return res;
  }

  /* ---------- vendor / VAT ID ---------- */
  var BUYER_LABEL = /^\s*(kupec|naro[cč]nik|pla[cč]nik|bill(?:ed)?\s*to|invoice\s*to|customer|buyer|sold\s*to|ship\s*to|rechnung\s*an|rechnungsempf\w+|kunde|prejemnik|odjemalec|kupac)\b/i;
  var SELLER_LABEL = /^\s*(dobavitelj|izdajatelj|prodajalec|seller|supplier|vendor|from|issued by|izdao|dobavlja[cč])\b[:\s]+(.*)$/i;
  function splitSegs(line) { return line.split(/\s{3,}/).map(function (s) { return s.trim(); }).filter(Boolean); }
  function findVatIds(lines) {
    var out = [], re = /(?:\b(?:ID\s*(?:za\s*)?DDV|VAT(?:\s*(?:ID|No\.?|number|reg\w*|identification\s*number))?|DDV|UID(?:-Nr\.?)?|OIB|PDV|USt-?Id\w*|Davčna\s*(?:št\.?|številka)|Tax\s*ID|ID\s*št\.?|MwSt\.?-?Nr\.?)[\s:.#]*)?(?<![A-Z0-9])((?:SI|HR|AT|DE|IT|FR|NL|BE|IE|CZ|SK|HU|PL|GB|RS|BG|RO|ES|PT|SE|DK|FI|LU|CY|MT|EE|LV|LT|GR|EL)\s?\d[\d\s]{6,13}\d|ATU\d{8})(?![A-Z0-9])/gi;
    lines.forEach(function (ln, li) {
      var segs = splitSegs(ln); var m;
      re.lastIndex = 0;
      while ((m = re.exec(ln))) {
        var id = vatNorm(m[1]);
        if (!/^(?:SI\d{8}|HR\d{11}|ATU\d{8}|DE\d{9}|[A-Z]{2}\d{8,12})$/.test(id)) continue;
        if (ibanValid(id) || /^[A-Z]{2}\d{2}\d{12,}/.test(id) && ibanValid(id)) continue;
        var labelled = /VAT|DDV|UID|OIB|PDV|USt|Davčna|Tax|MwSt/i.test(m[0].slice(0, m[0].length - m[1].length));
        var seg = 0, pos = 0; for (var k = 0; k < segs.length; k++) { var p = ln.indexOf(segs[k], pos); if (m.index < p + segs[k].length) { seg = k; break; } pos = p + segs[k].length; seg = k; }
        out.push({ id: id, li: li, seg: seg, nsegs: segs.length, labelled: labelled });
      }
    });
    return out;
  }
  function companyMatchers(opts) {
    var list = (opts.companies || []).map(function (c) {
      var names = [c.name].concat(c.aliases || []).filter(Boolean).map(normName).filter(function (n) { return n.length >= 4; });
      return { id: c.id, names: names, vat: vatNorm(c.vatId), ibans: (c.ibans || []).map(vatNorm) };
    });
    (opts.ownNames || []).forEach(function (n) { if (normName(n).length >= 4) list.push({ id: null, names: [normName(n)], vat: '', ibans: [] }); });
    (opts.ownVatIds || []).forEach(function (v) { list.push({ id: null, names: [], vat: vatNorm(v), ibans: [] }); });
    return list;
  }
  function ownIbans(opts) { var o = (opts.ownIbans || []).slice(); (opts.companies || []).forEach(function (c) { (c.ibans || []).forEach(function (x) { o.push(x); }); }); return o; }
  function buyerInfo(lines, cm) {
    var zone = {}, ownLine = {};
    lines.forEach(function (ln, li) {
      var m = BUYER_LABEL.exec(ln), segs = splitSegs(ln);
      if (m) {
        var si = 0; for (var k = 0; k < segs.length; k++) if (BUYER_LABEL.test(segs[k])) { si = k; break; }
        for (var d = 0; d <= 5 && li + d < lines.length; d++) zone[li + d] = { seg: si, nsegs: segs.length };
      }
      var n = strip(ln).toLowerCase().replace(/[^a-z0-9]+/g, ' ');
      cm.forEach(function (c) {
        if (c.names.some(function (nm) { return n.indexOf(nm) >= 0; })) {
          var si2 = 0; segs.forEach(function (s, k) { var sn = strip(s).toLowerCase().replace(/[^a-z0-9]+/g, ' '); if (c.names.some(function (nm) { return sn.indexOf(nm) >= 0; })) si2 = k; });
          for (var d2 = 0; d2 <= 4 && li + d2 < lines.length; d2++) if (!ownLine[li + d2]) ownLine[li + d2] = { seg: si2, nsegs: segs.length };
        }
      });
    });
    return { zone: zone, ownLine: ownLine };
  }
  function isBuyerId(v, bi, ownVat) {
    if (ownVat.indexOf(v.id) >= 0) return true;
    var z = bi.zone[v.li] || bi.ownLine[v.li]; if (!z) return false;
    if (z.nsegs <= 1) return true;
    if (v.nsegs === z.nsegs) return v.seg >= z.seg;
    return v.nsegs === 1 ? false : v.seg >= z.seg;
  }
  function cleanVendor(s) {
    s = String(s || '').replace(/^[\s:\-–|]+|[\s|]+$/g, '').replace(/^(dobavitelj|izdajatelj|seller|supplier|from|vendor)[:\s]+/i, '');
    var m = LEGAL.exec(s);
    if (m) s = s.slice(0, m.index + m[0].length);
    else s = s.split(/\s*[,|]\s*/)[0];
    return s.replace(/[\s,;:]+$/, '').slice(0, 80);
  }
  var NOT_NAME = /^(ra[cč]un|invoice|faktura|rechnung|datum|date|stran|page|seite|tel|e-?mail|www|http|iban|trr|bic|swift|ddv|vat|id|št|no\.|original|kopija|predra[cč]un|ponudba|quote|dobavnica|\d)/i;
  function findVendor(lines, opts, vats, bi, cm, ownVat) {
    var rules = opts.rules || {}, res = { vendor: '', vatId: '', confidence: 'none', source: '', category: '', rule: null };
    var seller = vats.filter(function (v) { return !isBuyerId(v, bi, ownVat); });
    seller.sort(function (a, b) { return (b.labelled ? 1 : 0) - (a.labelled ? 1 : 0) || a.li - b.li; });
    if (seller.length) res.vatId = seller[0].id;
    var head = lines.slice(0, 25).concat(lines.slice(-8)).join('\n');
    if (res.vatId && rules['id:' + res.vatId]) { var r = rules['id:' + res.vatId]; res.vendor = r.vendor || ''; res.rule = r; res.confidence = 'rule'; res.source = 'rule'; if (res.vendor) return res; }
    var rk = Object.keys(rules).filter(function (k) { return k.indexOf('name:') === 0; });
    for (var i = 0; i < rk.length; i++) { var nm = rk[i].slice(5); if (nm && normName(head).indexOf(normName(nm)) >= 0) { res.vendor = rules[rk[i]].vendor || nm; res.rule = rules[rk[i]]; res.confidence = 'rule'; res.source = 'rule'; return res; } }
    for (i = 0; i < KNOWN_VENDORS.length; i++) {
      var kv = KNOWN_VENDORS[i], m = kv.re.exec(head);
      if (m) {
        var line = lines.filter(function (l) { return kv.re.test(l); })[0] || '';
        res.vendor = kv.name || cleanVendor(splitSegs(line).filter(function (s) { return kv.re.test(s); })[0] || m[0]); res.category = kv.cat; res.confidence = 'high'; res.source = 'known'; return res;
      }
    }
    var own = cm.reduce(function (a, c) { return a.concat(c.names); }, []);
    function isOwn(s) { var n = normName(s); return own.some(function (o) { return n.indexOf(o) >= 0 || (n.length > 3 && o.indexOf(n) >= 0); }); }
    for (i = 0; i < lines.length; i++) { var sm = SELLER_LABEL.exec(lines[i]); if (sm && sm[2] && !isOwn(sm[2])) { var cn = cleanVendor(splitSegs(sm[2])[0]); if (cn.length > 2) { res.vendor = cn; res.confidence = 'medium'; res.source = 'label'; return res; } } }
    for (i = 0; i < Math.min(lines.length, 18); i++) {
      if (bi.zone[i] || bi.ownLine[i] && i > 0) continue;
      var segs = splitSegs(lines[i]);
      for (var k = 0; k < segs.length; k++) if (LEGAL.test(segs[k]) && !isOwn(segs[k]) && /[A-Za-zČŠŽčšž]{3}/.test(segs[k]) && !/^(ID|VAT|TRR)/i.test(segs[k])) {
        var c = cleanVendor(segs[k]); if (c.length > 3) { res.vendor = c; res.confidence = 'medium'; res.source = 'legal'; return res; }
      }
    }
    for (i = 0; i < Math.min(lines.length, 8); i++) {
      var s0 = splitSegs(lines[i])[0] || '';
      if (s0.length >= 3 && s0.length <= 50 && /[A-Za-zČŠŽčšž]{3}/.test(s0) && !NOT_NAME.test(s0) && !isOwn(s0) && !bi.zone[i]) { res.vendor = cleanVendor(s0); res.confidence = 'low'; res.source = 'top'; return res; }
    }
    return res;
  }

  /* ---------- number / dates / misc ---------- */
  var NUMBER_KEYS = /(?:ra[cč]un\s*(?:št\.?|štev\w*|st\.?|br\.?|broj|no\.?|nr\.?)|(?:št\.?|štev\w*|številka|broj)\s*(?:ra[cč]una|dokumenta|fakture|izdanega)|faktura\s*(?:št\.?|br\.?|no\.?|nr\.?|broj)?|invoice\s*(?:no\.?|number|nr\.?|#|num\.?|id)?|rechnung(?:s)?\s*(?:nr\.?|nummer|number)?|dokument\s*(?:št\.?|br\.?)|document\s*(?:no|number)|ra[cč]un\s*[:#]|ra[cč]un\b)/i;
  function tokenWithDigit(s) {
    var toks = s.split(/[\s:;]+/);
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i].replace(/^[#:.,()\-]+|[.,;:()]+$/g, '');
      if (t.length >= 3 && t.length <= 30 && /\d/.test(t) && /^[A-Za-z0-9][A-Za-z0-9\-\/._]*$/.test(t) && !/^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(t) && !/^\d{4}-\d{2}-\d{2}$/.test(t) && !/^\d+[.,]\d{2}$/.test(t) && !ibanValid(t) && !/^(SI|HR)\d{8,11}$/.test(t)) return t;
    }
    return '';
  }
  function findNumber(lines) {
    var best = null;
    for (var i = 0; i < lines.length; i++) {
      var m = NUMBER_KEYS.exec(lines[i]); if (!m) continue;
      if (/datum|date|rok|due|valuta|plačilo/i.test(lines[i].slice(Math.max(0, m.index - 8), m.index + 1)) && !/št|no|nr/i.test(m[0])) continue;
      var after = lines[i].slice(m.index + m[0].length), t = tokenWithDigit(after.replace(/^\s*(?:za|for|dne|of)\b.*$/i, ''));
      var strong = /št|no\b|nr|number|#|broj|nummer|stev|br\./i.test(m[0]);
      if (t) { if (strong) return { v: t, conf: 'high' }; if (!best) best = { v: t, conf: 'medium' }; continue; }
      if (!after.trim() || /^[:#\s]*$/.test(after) || /^\s*[:#]?\s*(?:št|no|nr)\.?\s*$/i.test(after)) {
        var nx = lines[i + 1] ? splitSegs(lines[i + 1])[0] || '' : ''; var t2 = tokenWithDigit(nx);
        if (t2 && !best) best = { v: t2, conf: 'medium' };
      }
    }
    return best || { v: '', conf: 'none' };
  }
  var ISSUE_K = /datum\s*(?:izdaje|ra[cč]una|izstavitve|dokumenta|izdavanja)|izdan[ao]?\b|izdaje\b|issue\s*date|invoice\s*date|date\s*of\s*issue|rechnungsdatum|ausstellungsdatum|izdano|\bdatum\b|\bdate\b|dne\b/i;
  var DUE_K = /rok\s*(?:pla[cč]ila|za\s*pla[cč]ilo|pla[cč]anja|zapadlosti)|zapadlost|zapade|valuta|due\s*date|payment\s*due|pay\s*by|\bdue\b|f[aä]llig\w*|zahlbar\s*bis|dospije[cć]e|datum\s*dospije[cć]a|pla[cč]ljiv\w*\s*do|rok\s*pl\./i;
  var SERVICE_K = /datum\s*(?:opravljene\s*storitve|storitve|dobave|prometa|opravljanja|izvršitve)|opravljene\s*storitve|service\s*date|delivery\s*date|date\s*of\s*supply|leistungsdatum|lieferdatum|obdobje|period|datum\s*isporuke/i;
  function findDatesFields(lines) {
    var out = { issue: null, due: null, service: null, issueConf: 'none', dueConf: 'none', serviceConf: 'none' }, dated = [];
    var KINDS = [['due', DUE_K], ['service', SERVICE_K], ['issue', ISSUE_K]];
    lines.forEach(function (ln, li) {
      var s = strip(ln), labels = [];
      KINDS.forEach(function (kd) { var re = new RegExp(kd[1].source, 'gi'), m; while ((m = re.exec(s))) { if (!m[0]) { re.lastIndex++; continue; } labels.push({ kind: kd[0], i: m.index, end: m.index + m[0].length }); } });
      labels.sort(function (a, b) { return a.i - b.i || (b.end - b.i) - (a.end - a.i); });
      var lab = []; labels.forEach(function (l) { if (!lab.length || l.i >= lab[lab.length - 1].end) lab.push(l); });
      var ds = findDates(ln); ds.forEach(function (d) { d.li = li; d.kind = null; });
      lab.forEach(function (l, k) {
        var limit = k + 1 < lab.length ? lab[k + 1].i : ln.length;
        var d = ds.filter(function (x) { return x.i >= l.end && x.i < limit; })[0];
        if (!d) { var gap = ds.filter(function (x) { return x.i >= l.end; })[0]; if (gap && k + 1 === lab.length) d = gap; }
        if (d && !d.kind) { d.kind = l.kind; }
      });
      var undated = lab.filter(function (l) { return !ds.some(function (x) { return x.kind === l.kind && x.i >= l.end; }); });
      if (undated.length && lines[li + 1]) {
        var nds = findDates(lines[li + 1]), nlab = KINDS.some(function (kd) { return new RegExp(kd[1].source, 'i').test(strip(lines[li + 1])); });
        if (nds.length && !nlab) {
          if (lab.length > 1 && nds.length === lab.length) lab.forEach(function (l, k) { out[l.kind] = out[l.kind] || nds[k].iso; out[l.kind + 'Conf'] = out[l.kind + 'Conf'] === 'none' ? 'medium' : out[l.kind + 'Conf']; });
          else if (undated.length === 1) { var u = undated[0].kind; if (!out[u]) { out[u] = nds[0].iso; out[u + 'Conf'] = 'medium'; } }
        }
      }
      ds.forEach(function (d) { if (d.kind && !out[d.kind]) { out[d.kind] = d.iso; out[d.kind + 'Conf'] = 'high'; } });
      dated.push({ li: li, ds: ds, lab: lab });
    });
    if (!out.issue) {
      for (var i = 0; i < dated.length && !out.issue; i++) {
        var e = dated[i]; if (e.lab.some(function (l) { return l.kind === 'due' || l.kind === 'service'; })) continue;
        var d0 = e.ds.filter(function (x) { return !x.kind; })[0]; if (d0 && d0.iso !== out.due && d0.iso !== out.service) { out.issue = d0.iso; out.issueConf = 'low'; }
      }
    }
    if (out.due && out.issue && out.due < out.issue) { out.due = null; out.dueConf = 'none'; }
    return out;
  }
  function findReference(lines) {
    for (var i = 0; i < lines.length; i++) {
      var m = /(?:sklic|referenca|reference|poziv\s*na\s*broj|payment\s*ref\w*|verwendungszweck|zahlungsreferenz|model)\b[\s:.#]*(.*)$/i.exec(lines[i]);
      if (!m) continue;
      var rest = m[1] + ' ' + (lines[i + 1] || '').slice(0, 40), t = /\b((?:SI|HR|RF)\s?\d{2}(?:[\s\-\/]?[A-Za-z0-9]+){1,4})/.exec(rest);
      if (t) return { v: t[1].replace(/\s+/g, ' ').trim().replace(/\s+(?=[A-Za-z]{3,})(.*)$/, ''), conf: 'high' };
      var t2 = /^\s*(\d{2}\s+)?([0-9][0-9\-\/]{4,25})/.exec(m[1]); if (t2) return { v: (t2[1] || '') + t2[2], conf: 'low' };
    }
    return { v: '', conf: 'none' };
  }
  function findPo(lines) {
    for (var i = 0; i < lines.length; i++) {
      var m = /(?:naro[cč]ilnic[aeoi]|order\s*(?:no\.?|number|ref\w*)|purchase\s*order|\bPO\b\s*(?:no\.?|number|#)?|bestell\w*|[šs]t\.?\s*naro[cč]ila)[\s:#]*([A-Z0-9][\w\-\/]{2,})/i.exec(lines[i]);
      if (m && /\d/.test(m[1])) return m[1];
    }
    return '';
  }
  function guessCategory(vendor, text) {
    var s = vendor + '\n' + text.slice(0, 3000);
    for (var i = 0; i < CATEGORY_RULES.length; i++) if (CATEGORY_RULES[i].re.test(s)) return CATEGORY_RULES[i].cat;
    return 'other';
  }
  function findBilledTo(lines, cm, bi, vats) {
    var best = null;
    (cm || []).forEach(function (c) {
      if (!c.id) return;
      var score = 0;
      if (c.vat && vats.some(function (v) { return v.id === c.vat; })) score = 3;
      lines.forEach(function (ln, li) {
        var n = strip(ln).toLowerCase().replace(/[^a-z0-9]+/g, ' ');
        if (c.names.some(function (nm) { return n.indexOf(nm) >= 0; })) score = Math.max(score, bi.zone[li] ? 2.5 : 1);
      });
      if (score && (!best || score > best.score)) best = { id: c.id, score: score };
    });
    return best ? { id: best.id, conf: best.score >= 2.5 ? 'high' : 'medium' } : null;
  }
  function findBilledPerson(text, users) {
    var low = text.toLowerCase();
    for (var i = 0; i < (users || []).length; i++) if (users[i].email && low.indexOf(users[i].email.toLowerCase()) >= 0) return users[i].email;
    return '';
  }

  /* parseInvoice(lines, { companies:[{id,name,vatId,aliases,ibans}], ownNames, ownVatIds, ownIbans, users:[{email}], rules }) */
  function parseInvoice(lines, opts) {
    opts = opts || {}; lines = (lines || []).map(function (l) { return String(l); });
    var text = lines.join('\n'), out = { scanned: false, confidence: {} };
    if (text.replace(/\s/g, '').length < 20) { out.scanned = true; ['vendor', 'detectedVendor', 'vendorTaxId', 'number', 'issueDate', 'dueDate', 'serviceDate', 'currency', 'iban', 'reference', 'poNumber', 'category'].forEach(function (k) { out[k] = ''; }); ['total', 'vat', 'net', 'eur', 'vatRate'].forEach(function (k) { out[k] = null; }); return out; }
    var cm = companyMatchers(opts), bi = buyerInfo(lines, cm), vats = findVatIds(lines), ownVat = cm.map(function (c) { return c.vat; }).filter(Boolean);
    var v = findVendor(lines, opts, vats, bi, cm, ownVat), c = out.confidence;
    out.vendor = v.vendor; out.detectedVendor = v.vendor; out.vendorTaxId = v.vatId; c.vendor = v.confidence; c.vendorTaxId = v.vatId ? 'high' : 'none';
    var n = findNumber(lines); out.number = n.v; c.number = n.conf;
    var d = findDatesFields(lines); out.issueDate = d.issue || ''; out.dueDate = d.due || ''; out.serviceDate = d.service || ''; c.issueDate = d.issueConf; c.dueDate = d.dueConf; c.serviceDate = d.serviceConf;
    var a = solveAmounts(lines, opts); out.total = a.total; out.vat = a.vat; out.net = a.net; out.vatRate = a.vatRate; out.reverseCharge = a.reverseCharge; c.total = a.confidence.total; c.vat = a.confidence.vat; c.net = a.confidence.net;
    var cur = currencyOf(text); out.currency = cur || 'EUR'; c.currency = cur ? 'high' : 'low'; out.eur = out.currency === 'EUR' ? out.total : null;
    var ib = findIbans(lines, ownIbans(opts)), sellerIb = ib.filter(function (x) { return !bi.zone[x.li] || vats.length === 0; });
    out.iban = (sellerIb[0] || ib[0] || {}).iban || ''; c.iban = out.iban ? 'high' : 'none';
    var rf = findReference(lines); out.reference = rf.v; c.reference = rf.conf;
    out.poNumber = findPo(lines);
    var rule = v.rule || {};
    out.category = rule.category || v.category || guessCategory(out.vendor, text); c.category = rule.category ? 'rule' : v.category ? 'high' : out.category === 'other' ? 'low' : 'medium';
    var bt = findBilledTo(lines, cm, bi, vats); out.billedTo = rule.billedTo || (bt && bt.id) || ''; c.billedTo = rule.billedTo ? 'rule' : bt ? bt.conf : 'none';
    out.billedPerson = rule.billedPerson || findBilledPerson(text, opts.users); c.billedPerson = out.billedPerson ? 'high' : 'none';
    return out;
  }

  var api = { parseInvoice: parseInvoice, solveAmounts: solveAmounts, toNumber: toNumber, amountsIn: amountsIn, findDates: findDates, findDatesFields: findDatesFields, findNumber: findNumber,
    ibanValid: ibanValid, findIbans: findIbans, findVatIds: findVatIds, findVendor: findVendor, guessCategory: guessCategory, normName: normName, vatNorm: vatNorm, snapRate: snapRate,
    DEFAULT_CATEGORIES: DEFAULT_CATEGORIES, KNOWN_VENDORS: KNOWN_VENDORS, CATEGORY_RULES: CATEGORY_RULES, KNOWN_RATES: KNOWN_RATES, NUMBER_KEYS: NUMBER_KEYS, TOTAL_KEYS: totalWeight, DUE_KEYS: DUE_K, ISSUE_KEYS: ISSUE_K };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.InvoiceParser = api;
})(typeof window !== 'undefined' ? window : globalThis);
