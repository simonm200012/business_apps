/* Adrial Apps · Desk — text helpers: subject clean-up, due-date suggestions, booking details from a
 * confirmation (reference, dates, total, provider), provider detection from a URL, pasted-mail
 * parsing. Pure functions, no DOM, no network. Slovenian, Croatian and English.
 *
 * Runs in the browser (window.DeskExtract) and in Node for tests (module.exports).
 */
(function (root) {
  'use strict';

  // ---------- small helpers ----------

  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd'); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function isoDate(y, m, d) {
    if (y < 100) y += 2000;
    if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
    var dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCMonth() !== m - 1) return null;
    return y + '-' + pad2(m) + '-' + pad2(d);
  }
  function addDays(iso, n) { var d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function weekday(iso) { return new Date(iso + 'T00:00:00Z').getUTCDay(); } // 0 = Sunday
  function daysBetween(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); }

  // month names, accents removed (see norm). Slovenian and Croatian inflect, so several forms.
  var MONTHS = {
    jan: 1, january: 1, januar: 1, januarja: 1, sijecanj: 1, sijecnja: 1, sij: 1,
    feb: 2, february: 2, februar: 2, februarja: 2, veljaca: 2, veljace: 2, velj: 2,
    mar: 3, march: 3, marec: 3, marca: 3, ozujak: 3, ozujka: 3, ozu: 3,
    apr: 4, april: 4, aprila: 4, travanj: 4, travnja: 4, tra: 4,
    may: 5, maj: 5, maja: 5, svibanj: 5, svibnja: 5, svi: 5,
    jun: 6, june: 6, junij: 6, junija: 6, lipanj: 6, lipnja: 6, lip: 6,
    jul: 7, july: 7, julij: 7, julija: 7, srpanj: 7, srpnja: 7, srp: 7,
    aug: 8, august: 8, avg: 8, avgust: 8, avgusta: 8, kolovoz: 8, kolovoza: 8, kol: 8,
    sep: 9, sept: 9, september: 9, septembra: 9, rujan: 9, rujna: 9, ruj: 9,
    oct: 10, october: 10, okt: 10, oktober: 10, oktobra: 10, listopad: 10, listopada: 10, lis: 10,
    nov: 11, november: 11, novembra: 11, studeni: 11, studenoga: 11, studenog: 11, stu: 11,
    dec: 12, december: 12, decembra: 12, prosinac: 12, prosinca: 12, pro: 12
  };
  function monthOf(word) { return MONTHS[norm(word).replace(/[^a-z]/g, '')] || 0; }

  // weekday words → JS day number
  var WEEKDAYS = [
    [/^(sunday|sun|nedelj[aeo]?|nedjelj[aeu]?)$/, 0],
    [/^(monday|mon|ponedeljk[aeu]?|ponedeljek|ponedjeljk[aeu]?|ponedjeljak)$/, 1],
    [/^(tuesday|tue|tues|tork[aeu]?|torek|utork[aeu]?|utorak)$/, 2],
    [/^(wednesday|wed|sred[aeo]|srijed[aeu])$/, 3],
    [/^(thursday|thu|thurs|cetrtk[aeu]?|cetrtek|cetvrtk[aeu]?|cetvrtak)$/, 4],
    [/^(friday|fri|petk[aeu]?|petek|petak)$/, 5],
    [/^(saturday|sat|sobot[aeou])$/, 6]
  ];
  function weekdayOf(word) {
    var w = norm(word);
    for (var i = 0; i < WEEKDAYS.length; i++) if (WEEKDAYS[i][0].test(w)) return WEEKDAYS[i][1];
    return -1;
  }
  function nextWeekday(baseIso, wd) {
    var diff = (wd - weekday(baseIso) + 7) % 7;
    return addDays(baseIso, diff === 0 ? 7 : diff);
  }

  // ---------- subject ----------

  var PREFIX = /^\s*(?:\[[^\]]{1,40}\]\s*)?(?:re|fw|fwd|aw|wg|tr|sv|vs|odg|odgovor|posl|proslijedi|antw|rv|ynt|ilt)\s*(?:\[\d+\]|\(\d+\))?\s*[:：]\s*/i;
  function cleanSubject(s) {
    s = String(s || '').replace(/\s+/g, ' ').trim();
    var guard = 0;
    while (PREFIX.test(s) && guard++ < 10) s = s.replace(PREFIX, '');
    s = s.replace(/^\s*posl\.\s*:?\s*/i, '');
    return s.trim();
  }

  // ---------- dates in free text ----------

  // every date-looking thing in the text: { iso, index, length, raw, weak }
  function findDates(text, baseIso) {
    var out = [];
    var t = String(text || '');
    var baseYear = +(baseIso || '2026').slice(0, 4);
    function push(iso, m, weak) {
      if (!iso) return;
      if (out.some(function (o) { return m.index < o.index + o.length && o.index < m.index + m[0].length; })) return;
      out.push({ iso: iso, index: m.index, length: m[0].length, raw: m[0], weak: !!weak });
    }
    function guessYear(mo, d) {
      // a date without a year: the next one on or after the base date (allowing one month back)
      var y = baseYear, iso = isoDate(y, mo, d);
      if (iso && baseIso && daysBetween(baseIso, iso) < -31) iso = isoDate(y + 1, mo, d);
      return iso;
    }
    var m, re;
    re = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
    while ((m = re.exec(t))) push(isoDate(+m[1], +m[2], +m[3]), m);
    // 15.10.2026 · 15. 10. 2026 · 15/10/2026 · 15.10.26
    re = /\b(\d{1,2})\s?[./]\s?(\d{1,2})\s?[./]\s?(\d{4}|\d{2})\b(?![.,:]\d)/g;
    while ((m = re.exec(t))) push(isoDate(+m[3], +m[2], +m[1]), m);
    // 15. 10. (no year) — only with dots, and not a time like 15.10 h
    re = /\b(\d{1,2})\.\s?(\d{1,2})\.(?!\s?\d)/g;
    while ((m = re.exec(t))) push(guessYear(+m[2], +m[1]), m, true);
    // 15 Oct · 15. oktobra 2026 · 15th October · 15. listopada
    re = /\b(\d{1,2})(?:\.|st|nd|rd|th)?\s+(?:of\s+)?([A-Za-zčšžćđČŠŽĆĐ]{3,10})\.?(?:,?\s+(\d{4}))?(?![A-Za-z])/g;
    while ((m = re.exec(t))) {
      var mo = monthOf(m[2]);
      if (!mo || (m[2].length < 4 && !/^[A-Z]?[a-z]{2}$/.test(m[2]) && !/^[A-Z]{3}$/.test(m[2]))) continue;
      if (!m[3] && /^(maj|mar|lis|pro|svi|sij|stu|tra|kol|lip|ruj|srp|ozu|velj|sat|sun|wed)$/i.test(norm(m[2])) && !/\./.test(m[0])) continue; // ambiguous words
      push(m[3] ? isoDate(+m[3], mo, +m[1]) : guessYear(mo, +m[1]), m, !m[3]);
    }
    // Oct 15 · October 15th, 2026
    re = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b(?![.:]\d)/g;
    while ((m = re.exec(t))) {
      var mo2 = MONTHS[m[1].toLowerCase()];
      if (!mo2 || !/^[A-Z]/.test(m[1])) continue;
      push(m[3] ? isoDate(+m[3], mo2, +m[2]) : guessYear(mo2, +m[2]), m, !m[3]);
    }
    out.sort(function (a, b) { return a.index - b.index; });
    return out;
  }

  var DUE_KEY = /(\bdo\b|\bby\b|\buntil\b|\btill\b|\bbefore\b|\bdeadline\b|\brok\b|\broka\b|najkasneje|najkasnije|\bdue\b|\bprije\b|\bpred\b|latest|check[\s-]?in|arrival|prihod|dolazak|\btermin|\bon\b|\bdne\b|\bza\b|\bna dan\b|\bdatum\b|sestanek|sastanak|meeting|\bod\b|\bfrom\b|departure|odhod|polazak|potovanj|putovanj|travel|flight|\blet\b)/i;
  var QUOTE_LINE = /^\s*(>|(from|sent|date|to|cc|subject|od|poslano|datum|za|zadeva|šalje|salje|poslano|prima|predmet|kp)\s*:|on .{3,80} wrote:|.{3,80}(je napisal|je napisala|napisao je|napisala je).{0,40}:)/i;

  // due-date suggestions for an e-mail: [{ iso, snippet, score }] best first, max 3
  function suggestDue(text, subject, baseIso) {
    baseIso = baseIso || null;
    var src = String(subject || '') + '\n' + String(text || '');
    // only the newest message: cut at the first quoted header block / reply marker
    var lines = src.split(/\r?\n/), kept = [], quoted = 0;
    for (var i = 0; i < lines.length; i++) {
      var L = lines[i];
      if (/^\s*>/.test(L)) continue;
      if (i > 0 && QUOTE_LINE.test(L)) { quoted++; if (quoted >= 2 || /wrote:|napisa/i.test(L)) break; continue; }
      if (/^[-_]{5,}\s*(original message|izvirno sporo|izvorna poruka|prosleđena|forwarded)/i.test(L) || /^-{2,}\s*original message/i.test(L)) break;
      kept.push(L);
    }
    var t = kept.join('\n');
    // a forward ("FW: …", or a short note above a quoted mail) carries the request in the quoted
    // part: if the newest message has no usable date, look at the whole thread (without "> " lines)
    var usable = function (list) { return list.some(function (d) { return !baseIso || d.iso >= baseIso; }); };
    var all = findDates(t, baseIso);
    if (!usable(all) && kept.length < lines.length) {
      t = lines.filter(function (L, k) { return !(k > 0 && QUOTE_LINE.test(L)) && !/^\s*>/.test(L); }).join('\n');
      all = findDates(t, baseIso);
    }
    var found = [];
    all.forEach(function (d, k) {
      if (baseIso && d.iso < baseIso) return;
      if (baseIso && daysBetween(baseIso, d.iso) > 730) return;
      var before = t.slice(Math.max(0, d.index - 28), d.index);
      var score = d.weak ? 1 : 2;
      if (DUE_KEY.test(before)) score += 3;
      if (/(do|by|until|till|prije|before)\s*$/i.test(before)) score += 2;
      if (/(\brok\b|\broka\b|deadline|\bdue\b|najkasne|najkasni|at the latest|latest by)/i.test(t.slice(Math.max(0, d.index - 40), d.index))) score += 4;
      // the end of a range ("od 20. 10. do 22. 10.", "from 3 to 5 May") is a period, not a deadline
      var prev = all[k - 1];
      if (prev && d.index - (prev.index + prev.length) <= 8 && /^\s*(do|to|until|till|–|-|—|bis)\s*$/i.test(t.slice(prev.index + prev.length, d.index))) score -= 4;
      if (d.index < (String(subject || '').length + 1)) score += 1; // in the subject
      found.push({ iso: d.iso, index: d.index, score: score, snippet: snippet(t, d.index, d.length) });
    });
    // relative words: "do petka", "by Friday", "until Monday", "do jutri", "by tomorrow"
    if (baseIso) {
      var re = /\b(do|by|until|till|before|najkasneje do|najkasnije do|prije|pred|for|za|on|v|u)\s+(?:(?:this|next|naslednji|naslednjega|ta|ovaj|ovog|sljedeći|sljedećeg|slijedeći)\s+)?([A-Za-zčšžćđČŠŽĆĐ]{3,12})\b/gi, m;
      while ((m = re.exec(t))) {
        var w = norm(m[2]);
        var iso = null;
        if (/^(jutri|tomorrow|sutra)$/.test(w)) iso = addDays(baseIso, 1);
        else if (/^(danes|today|danas)$/.test(w)) iso = baseIso;
        else if (/^(pojutrisnjem|prekosutra)$/.test(w)) iso = addDays(baseIso, 2);
        else {
          var wd = weekdayOf(m[2]);
          if (wd < 0) continue;
          if (/^(for|za|on|v|u)$/i.test(m[1]) && !/day$|[aeu]$/.test(w)) continue;
          iso = nextWeekday(baseIso, wd);
          if (/next|naslednj|sljede|slijede/i.test(m[0]) && daysBetween(baseIso, iso) < 7) iso = addDays(iso, 7);
        }
        if (found.some(function (f) { return f.iso === iso; })) continue;
        found.push({ iso: iso, index: m.index, score: /^(do|by|until|till|before|najkas|prije)/i.test(m[1]) ? 6 : 2, snippet: snippet(t, m.index, m[0].length), relative: true });
      }
    }
    found.sort(function (a, b) { return b.score - a.score || a.index - b.index; });
    var seen = {}, out = [];
    found.forEach(function (f) { if (!seen[f.iso] && out.length < 3) { seen[f.iso] = 1; out.push({ iso: f.iso, snippet: f.snippet, score: f.score }); } });
    return out;
  }
  function snippet(t, idx, len) {
    var a = Math.max(0, idx - 40), b = Math.min(t.length, idx + len + 40);
    return ((a > 0 ? '…' : '') + t.slice(a, b) + (b < t.length ? '…' : '')).replace(/\s+/g, ' ').trim();
  }

  // a date (and maybe time) typed in a pasted header: "sreda, 7. oktober 2026 10:15", "Wednesday, October 7, 2026 10:15 AM"
  function parseLooseDate(s) {
    s = String(s || '').trim();
    if (!s) return null;
    var d = findDates(s, null)[0];
    var iso = d ? d.iso : null;
    if (!iso) { var t = Date.parse(s); if (!isNaN(t)) return new Date(t).toISOString(); return null; }
    var tm = /(\d{1,2})[:.](\d{2})(?:\s*([AaPp])\.?[Mm]\.?)?(?!\d)/.exec(s.slice(d.index + d.length));
    var hh = 12, mm = 0;
    if (tm) { hh = +tm[1] % 24; mm = +tm[2]; if (tm[3] && /p/i.test(tm[3]) && hh < 12) hh += 12; if (tm[3] && /a/i.test(tm[3]) && hh === 12) hh = 0; }
    return iso + 'T' + pad2(hh) + ':' + pad2(mm) + ':00';
  }

  // ---------- amounts ----------

  function toNumber(s) {
    s = String(s || '').replace(/[\s ']/g, '');
    var neg = /^-/.test(s); s = s.replace(/^-/, '');
    var lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',');
    var dec = -1;
    if (lastDot >= 0 && lastComma >= 0) dec = Math.max(lastDot, lastComma);
    else if (lastComma >= 0) dec = s.length - lastComma - 1 === 3 && s.indexOf(',') === lastComma && s.length > 4 ? -1 : lastComma;
    else if (lastDot >= 0) dec = s.length - lastDot - 1 === 3 && (s.indexOf('.') !== lastDot || s.length > 4) && !/^0\./.test(s) ? -1 : lastDot;
    var intPart = (dec >= 0 ? s.slice(0, dec) : s).replace(/[.,]/g, '');
    var frac = dec >= 0 ? s.slice(dec + 1) : '';
    var n = parseFloat(intPart + (frac ? '.' + frac : ''));
    return isFinite(n) ? (neg ? -n : n) : NaN;
  }
  function parseAmount(s) {
    s = String(s || '').trim().replace(/[€$£]|EUR|USD|GBP|CHF|HRK|kn\b/gi, '');
    if (!s) return null;
    var n = toNumber(s);
    return isFinite(n) ? Math.round(n * 100) / 100 : null;
  }
  var CUR = '(€|EUR|USD|US\\$|\\$|£|GBP|CHF|HRK|kn|RSD|BAM|KM)';
  var NUM = '(-?\\d{1,3}(?:[.,\\s\\u00a0]\\d{3})*(?:[.,]\\d{1,2})?|-?\\d+(?:[.,]\\d{1,2})?)';
  var AMOUNT_RE = new RegExp('(?:' + CUR + '\\s?' + NUM + ')|(?:' + NUM + '\\s?' + CUR + ')(?![A-Za-z])', 'g');
  function curCode(c) {
    c = String(c || '').toUpperCase();
    if (c === '€') return 'EUR';
    if (c === '$' || c === 'US$') return 'USD';
    if (c === '£') return 'GBP';
    if (c === 'KN') return 'HRK';
    if (c === 'KM') return 'BAM';
    return c || 'EUR';
  }
  function amountsIn(line) {
    var out = [], m;
    AMOUNT_RE.lastIndex = 0;
    while ((m = AMOUNT_RE.exec(line))) {
      var num = m[2] || m[3], cur = m[1] || m[4];
      var v = toNumber(num);
      if (isFinite(v) && v > 0) out.push({ value: Math.round(v * 100) / 100, currency: curCode(cur), index: m.index });
    }
    return out;
  }

  // ---------- providers ----------

  var KINDS = { hotel: 'Hotel', stay: 'Stay', flight: 'Flight', train: 'Train', bus: 'Bus', car: 'Rent-a-car', event: 'Event', ferry: 'Ferry', link: 'Link' };
  var PROVIDERS = [
    { name: 'Booking.com', kind: 'hotel', hosts: ['booking.com'], text: /booking\.com/i },
    { name: 'Airbnb', kind: 'stay', hosts: [/(^|\.)airbnb\.[a-z.]+$/], text: /\bairbnb\b/i },
    { name: 'Hotels.com', kind: 'hotel', hosts: ['hotels.com'], text: /hotels\.com/i },
    { name: 'Expedia', kind: 'hotel', hosts: [/(^|\.)expedia\.[a-z.]+$/], text: /\bexpedia\b/i },
    { name: 'Agoda', kind: 'hotel', hosts: ['agoda.com'], text: /\bagoda\b/i },
    { name: 'Trip.com', kind: 'hotel', hosts: ['trip.com'], text: /\btrip\.com\b/i },
    { name: 'HRS', kind: 'hotel', hosts: ['hrs.com', 'hrs.de'], text: null },
    { name: 'Marriott', kind: 'hotel', hosts: ['marriott.com'], text: /\bmarriott\b/i },
    { name: 'Hilton', kind: 'hotel', hosts: ['hilton.com'], text: /\bhilton\b/i },
    { name: 'Accor', kind: 'hotel', hosts: ['accor.com', 'all.accor.com', 'accorhotels.com'], text: /\baccor\b/i },
    { name: 'IHG', kind: 'hotel', hosts: ['ihg.com'], text: null },
    { name: 'Hyatt', kind: 'hotel', hosts: ['hyatt.com'], text: /\bhyatt\b/i },
    { name: 'Radisson', kind: 'hotel', hosts: ['radissonhotels.com'], text: /\bradisson\b/i },
    { name: 'Best Western', kind: 'hotel', hosts: ['bestwestern.com'], text: /best western/i },
    { name: 'Valamar', kind: 'hotel', hosts: ['valamar.com'], text: /\bvalamar\b/i },
    { name: 'Maistra', kind: 'hotel', hosts: ['maistra.com'], text: /\bmaistra\b/i },
    { name: 'Falkensteiner', kind: 'hotel', hosts: ['falkensteiner.com'], text: /falkensteiner/i },
    { name: 'Ryanair', kind: 'flight', hosts: ['ryanair.com'], text: /\bryanair\b/i },
    { name: 'easyJet', kind: 'flight', hosts: ['easyjet.com'], text: /\beasyjet\b/i },
    { name: 'Lufthansa', kind: 'flight', hosts: ['lufthansa.com'], text: /\blufthansa\b/i },
    { name: 'Croatia Airlines', kind: 'flight', hosts: ['croatiaairlines.com', 'croatiaairlines.hr'], text: /croatia airlines/i },
    { name: 'Turkish Airlines', kind: 'flight', hosts: ['turkishairlines.com', 'thy.com'], text: /turkish airlines/i },
    { name: 'Wizz Air', kind: 'flight', hosts: ['wizzair.com'], text: /\bwizz\s?air\b/i },
    { name: 'Austrian Airlines', kind: 'flight', hosts: ['austrian.com'], text: /austrian airlines/i },
    { name: 'SWISS', kind: 'flight', hosts: ['swiss.com'], text: /swiss international air/i },
    { name: 'Air France', kind: 'flight', hosts: [/(^|\.)airfrance\.[a-z.]+$/], text: /\bair france\b/i },
    { name: 'KLM', kind: 'flight', hosts: ['klm.com', /(^|\.)klm\.[a-z.]+$/], text: /\bklm\b/i },
    { name: 'British Airways', kind: 'flight', hosts: ['britishairways.com', 'ba.com'], text: /british airways/i },
    { name: 'Emirates', kind: 'flight', hosts: ['emirates.com'], text: /\bemirates\b/i },
    { name: 'Qatar Airways', kind: 'flight', hosts: ['qatarairways.com'], text: /qatar airways/i },
    { name: 'Air Serbia', kind: 'flight', hosts: ['airserbia.com'], text: /air serbia/i },
    { name: 'LOT', kind: 'flight', hosts: ['lot.com'], text: /\bLOT Polish/ },
    { name: 'Transavia', kind: 'flight', hosts: ['transavia.com'], text: /\btransavia\b/i },
    { name: 'Vueling', kind: 'flight', hosts: ['vueling.com'], text: /\bvueling\b/i },
    { name: 'Eurowings', kind: 'flight', hosts: ['eurowings.com'], text: /\beurowings\b/i },
    { name: 'Slovenske železnice', kind: 'train', hosts: ['sz.si', 'slo-zeleznice.si'], text: /slovenske [žz]eleznice|\bsz\.si\b/i },
    { name: 'HŽPP', kind: 'train', hosts: ['hzpp.hr'], text: /\bh[žz]\s?pp\b|hrvatske [žz]eljeznice/i },
    { name: 'ÖBB', kind: 'train', hosts: ['oebb.at'], text: /\b(ÖBB|oebb)\b/ },
    { name: 'Deutsche Bahn', kind: 'train', hosts: ['bahn.de', 'bahn.com'], text: /deutsche bahn/i },
    { name: 'Trenitalia', kind: 'train', hosts: ['trenitalia.com', 'trenitalia.it'], text: /\btrenitalia\b/i },
    { name: 'Italo', kind: 'train', hosts: ['italotreno.it', 'italotreno.com'], text: /\bitalo treno\b/i },
    { name: 'SBB', kind: 'train', hosts: ['sbb.ch'], text: null },
    { name: 'FlixBus', kind: 'bus', hosts: [/(^|\.)flixbus\.[a-z.]+$/], text: /\bflix\s?bus\b/i },
    { name: 'Arriva', kind: 'bus', hosts: ['arriva.si'], text: null },
    { name: 'Nomago', kind: 'bus', hosts: ['nomago.si'], text: /\bnomago\b/i },
    { name: 'GetByBus', kind: 'bus', hosts: ['getbybus.com'], text: /getbybus/i },
    { name: 'Jadrolinija', kind: 'ferry', hosts: ['jadrolinija.hr'], text: /\bjadrolinija\b/i },
    { name: 'Sixt', kind: 'car', hosts: [/(^|\.)sixt\.[a-z.]+$/], text: /\bsixt\b/i },
    { name: 'Hertz', kind: 'car', hosts: [/(^|\.)hertz\.[a-z.]+$/], text: /\bhertz\b/i },
    { name: 'Avis', kind: 'car', hosts: [/(^|\.)avis\.[a-z.]+$/], text: /\bavis\b(?! [a-z])/i },
    { name: 'Europcar', kind: 'car', hosts: [/(^|\.)europcar\.[a-z.]+$/], text: /\beuropcar\b/i },
    { name: 'Enterprise', kind: 'car', hosts: [/(^|\.)enterprise\.[a-z.]+$/], text: /enterprise rent-a-car/i },
    { name: 'Budget', kind: 'car', hosts: [/(^|\.)budget\.[a-z.]+$/], text: null },
    { name: 'Rentalcars.com', kind: 'car', hosts: ['rentalcars.com'], text: /rentalcars\.com/i },
    { name: 'Discover Cars', kind: 'car', hosts: ['discovercars.com'], text: /discover ?cars/i },
    { name: 'Eventbrite', kind: 'event', hosts: [/(^|\.)eventbrite\.[a-z.]+$/], text: /\beventbrite\b/i },
    { name: 'Eventim', kind: 'event', hosts: [/(^|\.)eventim\.[a-z.]+$/], text: /\beventim\b/i },
    { name: 'Entrio', kind: 'event', hosts: ['entrio.hr'], text: /\bentrio\b/i },
    { name: 'Moje karte', kind: 'event', hosts: ['mojekarte.si'], text: /mojekarte/i },
    { name: 'Ticketmaster', kind: 'event', hosts: [/(^|\.)ticketmaster\.[a-z.]+$/], text: /\bticketmaster\b/i }
  ];
  function hostOf(url) {
    try { return new URL(/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : 'https://' + url).hostname.toLowerCase().replace(/^www\./, ''); } catch (e) { return ''; }
  }
  function hostMatches(host, h) {
    if (h instanceof RegExp) return h.test(host);
    return host === h || host.slice(-(h.length + 1)) === '.' + h;
  }
  // provider of a booking URL: { name, kind, kindLabel, host } (generic when unknown)
  function detectProvider(url) {
    var host = hostOf(url);
    for (var i = 0; i < PROVIDERS.length; i++) {
      var p = PROVIDERS[i];
      if (host && p.hosts.some(function (h) { return hostMatches(host, h); })) return { name: p.name, kind: p.kind, kindLabel: KINDS[p.kind], host: host, known: true };
    }
    var kind = /hotel|hostel|apartma|apartment|resort|stay|sobe|rooms/.test(host) ? 'hotel' : /air|fly|flight/.test(host) ? 'flight' : /rent|car/.test(host) ? 'car' : /ticket|event|karte|ulaznic/.test(host) ? 'event' : 'link';
    return { name: host || 'Link', kind: kind, kindLabel: KINDS[kind], host: host, known: false };
  }
  // provider named in a confirmation's text
  function providerFromText(text) {
    var t = String(text || ''), best = null;
    PROVIDERS.forEach(function (p) {
      if (!p.text) return;
      var m = p.text.exec(t);
      if (m && (!best || m.index < best.index)) best = { index: m.index, p: p };
    });
    if (best) return { name: best.p.name, kind: best.p.kind, kindLabel: KINDS[best.p.kind], known: true };
    var lines = t.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean).slice(0, 40);
    for (var i = 0; i < lines.length; i++) {
      var hm = /\b((?:hotel|hostel|apartma|apartmaji|apartments?|pension|penzion|vila|villa|resort|guesthouse|motel)\b[^,;:|\n]{2,40}|[^,;:|\n]{2,40}\b(?:hotel|hostel|resort|apartments?))\b/i.exec(lines[i]);
      if (hm && !/confirmation|potrdil|potvrd|booking|reservation|rezervacij/i.test(hm[1])) return { name: hm[1].trim().replace(/\s{2,}/g, ' '), kind: 'hotel', kindLabel: KINDS.hotel, known: false };
    }
    return null;
  }

  var URL_RE = /\bhttps?:\/\/[^\s<>"'()\[\]{}]+[^\s<>"'()\[\]{}.,;:!?]/gi;
  function findUrls(text) {
    var seen = {}, out = [];
    (String(text || '').match(URL_RE) || []).forEach(function (u) { if (!seen[u]) { seen[u] = 1; out.push(u); } });
    return out;
  }
  // links in a mail that look like bookings (known provider, or words like booking / reservation)
  function bookingLinks(text) {
    return findUrls(text).filter(function (u) {
      var p = detectProvider(u);
      if (/unsubscribe|odjava|privacy|zasebnost|facebook|instagram|twitter|linkedin|youtube|\.(png|jpe?g|gif)(\?|$)/i.test(u)) return false;
      return p.known || /book|reserv|rezerv|confirm|potrd|potvrd|itinerar|ticket|karta|order/i.test(u);
    }).slice(0, 5);
  }

  // ---------- booking confirmation ----------

  var REF_LABEL = '(?:booking\\s*(?:number|no\\.?|nr\\.?|reference|ref\\.?|id|code)|confirmation\\s*(?:number|no\\.?|nr\\.?|code|#)|reservation\\s*(?:number|no\\.?|nr\\.?|code|id)|reference\\s*(?:number|no\\.?)?|booking\\s*#|ref\\.\\s*(?:no\\.?)?|pnr|record\\s*locator|številka\\s+(?:rezervacije|potrdila|potrditve|naročila)|št\\.\\s*rezervacije|rezervacija\\s*(?:št\\.?|številka|br\\.?|broj)|broj\\s+(?:rezervacije|potvrde|narudžbe)|šifra\\s+rezervacije|potvrda\\s*(?:br\\.?|broj)|order\\s*(?:number|no\\.?|#)|ticket\\s*(?:number|no\\.?)|itinerary\\s*(?:number|no\\.?))';
  var REF_RE = new RegExp(REF_LABEL + '\\s*[:#.]?\\s*(?:is\\s+)?([A-Z0-9][A-Z0-9\\-/.]{3,24}(?:\\s\\d{3}(?!\\d)){0,3})', 'gi');
  function findRef(text) {
    var m;
    REF_RE.lastIndex = 0;
    while ((m = REF_RE.exec(text))) {
      var v = m[1].replace(/[-/.]+$/, '');
      if (/\d/.test(v) || /^[A-Z]{5,8}$/.test(v)) return v;
    }
    return '';
  }

  var FROM_LABEL = /(check[\s-]?in|arrival|arriving|prihod|dolazak|prijava|departure date|date of travel|travel date|datum potovanja|datum putovanja|datum leta|flight date|outbound|pick[\s-]?up|prevzem|preuzimanje|event date|datum dogodka|datum događaja|valid from|velja od|\bod\s*:|\bfrom\s*:)/gi;
  var TO_LABEL = /(check[\s-]?out|odjava|odlazak|return|povratek|povratak|drop[\s-]?off|vračilo|vraćanje|povrat vozila|valid until|velja do|\bdo\s*:|\bto\s*:|\buntil\s*:)/gi;
  // "odhod" / "departure" / "polazak": the check-out of a stay, but the travel date of a trip
  var AMBIG_LABEL = /(\bodhod\b|\bdeparture\b(?!\s+date)|\bdeparting\b|\bpolazak\b)/gi;
  var BOOKED_LABEL = /(cancel|odpoved|storno|otkaz|booked on|booking date|date of booking|reservation date|datum rezervacije|issued|izdano|izdan|invoice date|order date|datum naročila|datum narudžbe|created|printed|natisnjeno)/i;

  function labelsIn(line, haveFrom) {
    var out = [], m;
    [[FROM_LABEL, 'from'], [TO_LABEL, 'to'], [AMBIG_LABEL, '?']].forEach(function (x) {
      x[0].lastIndex = 0;
      while ((m = x[0].exec(line))) out.push({ index: m.index, end: m.index + m[0].length, kind: x[1] });
    });
    out.sort(function (a, b) { return a.index - b.index; });
    var seenFrom = haveFrom;
    out.forEach(function (l) { if (l.kind === '?') l.kind = seenFrom ? 'to' : 'from'; if (l.kind === 'from') seenFrom = true; });
    return out.filter(function (l, i) { return !out.some(function (o, j) { return j !== i && o.index <= l.index && o.end >= l.end && (o.end - o.index) > (l.end - l.index); }); });
  }

  // "3" / "OCTOBER" / "2026" on separate lines (date boxes in PDFs such as Booking.com) → "3 OCTOBER 2026"
  function joinStackedDates(lines) {
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var day = /^\s*(\d{1,2})\.?\s*$/.exec(lines[i]);
      var mon = i + 1 < lines.length ? /^\s*([A-Za-zčšžćđČŠŽĆĐ]{3,12})\.?\s*$/.exec(lines[i + 1]) : null;
      if (day && mon && monthOf(mon[1]) && +day[1] >= 1 && +day[1] <= 31) {
        var yr = i + 2 < lines.length ? /^\s*(\d{4})\s*$/.exec(lines[i + 2]) : null;
        out.push(day[1] + ' ' + mon[1] + (yr ? ' ' + yr[1] : ''));
        i += yr ? 2 : 1;
        continue;
      }
      // boxes side by side, read across: "3 25 1 /22" then "OCTOBER OCTOBER" → "3 OCTOBER  25 OCTOBER"
      var nums = /^[\s\d/.]+$/.test(lines[i]) ? (lines[i].match(/\d{1,2}(?!\d)/g) || []) : [];
      var mons = i + 1 < lines.length ? lines[i + 1].trim().split(/\s+/) : [];
      if (nums.length >= 2 && mons.length >= 2 && mons.every(function (w) { return monthOf(w); }) && nums.length >= mons.length) {
        out.push(mons.map(function (w, k) { return nums[k] + ' ' + w; }).join('  '));
        i += 1;
      } else out.push(lines[i]);
    }
    return out;
  }

  function extractBooking(text, opts) {
    opts = opts || {};
    var t = String(text || '');
    var lines = joinStackedDates(t.split(/\r?\n/));
    var out = { ref: '', dateFrom: '', dateTo: '', amount: null, currency: '', provider: null };
    out.ref = findRef(t);

    // dates: each date belongs to the nearest label before it on its line (or a label alone on
    // the line before); unlabelled dates are the fallback
    var labelled = { from: '', to: '' }, all = [];
    lines.forEach(function (line, i) {
      var ds = findDates(line, opts.baseIso || null);
      ds.forEach(function (d) { if (!BOOKED_LABEL.test(line.slice(0, d.index))) all.push(d.iso); });
      var labels = labelsIn(line, !!labelled.from);
      if (!labels.length) return;
      if (!ds.length) {
        // the dates follow on the next lines (up to 4, stopping at the next label); two labels on
        // one line ("CHECK-IN  CHECK-OUT") take the following dates in order
        var ahead = [];
        for (var j = i + 1; j < lines.length && j <= i + 4; j++) {
          if (labelsIn(lines[j], true).length) break;
          findDates(lines[j], opts.baseIso || null).forEach(function (d) { ahead.push(d.iso); });
        }
        labels.forEach(function (l, k) { var iso = ahead[labels.length > 1 ? k : 0]; if (iso && !labelled[l.kind]) labelled[l.kind] = iso; });
        return;
      }
      ds.forEach(function (d) {
        var lab = null;
        labels.forEach(function (l) { if (l.end <= d.index) lab = l; });
        if (lab && !labelled[lab.kind]) labelled[lab.kind] = d.iso;
      });
    });
    out.dateFrom = labelled.from;
    out.dateTo = labelled.to && (!labelled.from || labelled.to >= labelled.from) ? labelled.to : '';
    if (!out.dateFrom && all.length) {
      var uniq = all.filter(function (v, i) { return all.indexOf(v) === i; }).sort();
      if (opts.baseIso) { var fut = uniq.filter(function (v) { return v >= opts.baseIso; }); if (fut.length) uniq = fut; }
      out.dateFrom = uniq[0];
      if (!out.dateTo && uniq[1] && daysBetween(uniq[0], uniq[1]) <= 60) out.dateTo = uniq[1];
    }

    // total: an amount on a "total" line (or the line after it), else the largest amount
    var TOTAL = /(final price|končna cena|koncna cena|konačna cijena|konacna cijena|grand total|total price|total amount|total due|amount paid|amount due|total|skupaj za plačilo|za plačilo|skupaj|skupni znesek|skupno|ukupno za platiti|ukupan iznos|ukupno|za platiti|iznos|plačano|plaćeno|price|cena|cijena|znesek)/i;
    var best = null, rank = 99;
    lines.forEach(function (line, i) {
      var lm = TOTAL.exec(line);
      if (!lm) return;
      var r = /total|skupaj|ukupno|za pla/i.test(lm[1]) ? (/grand|za pla|amount paid|plačano|plaćeno/i.test(lm[1]) ? 0 : 1) : (/final|končna|koncna|konačna|konacna/i.test(lm[1]) ? 0 : 2);
      var am = amountsIn(line.slice(lm.index));
      if (!am.length && i + 1 < lines.length) am = amountsIn(lines[i + 1]);
      if (am.length && r < rank) { rank = r; best = am[am.length - 1]; }
      else if (am.length && r === rank && am[am.length - 1].value > best.value) best = am[am.length - 1];
    });
    if (!best) {
      var every = [];
      lines.forEach(function (l) { every = every.concat(amountsIn(l)); });
      every.sort(function (a, b) { return b.value - a.value; });
      best = every[0] || null;
    }
    if (best) { out.amount = best.value; out.currency = best.currency; }

    out.provider = providerFromText(t);
    return out;
  }

  // ---------- pasted e-mail text ----------

  var HDR = [
    [/^(from|od|šalje|salje|pošiljatelj|posiljatelj|sender)$/i, 'from'],
    [/^(sent|poslano|poslan|date|datum|poslato)$/i, 'date'],
    [/^(to|za|prima|prejemnik|primatelj)$/i, 'to'],
    [/^(cc|kp|kopija)$/i, 'cc'],
    [/^(subject|zadeva|predmet|tema)$/i, 'subject']
  ];
  function parsePasted(text) {
    var lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
    var h = {}, i = 0, seen = 0;
    while (i < lines.length && !lines[i].trim()) i++;
    for (; i < lines.length && i < 40; i++) {
      var m = /^\s*([A-Za-zčšžČŠŽ]{2,14})\s*:\s*(.*)$/.exec(lines[i]);
      var key = null;
      if (m) HDR.forEach(function (x) { if (!key && x[0].test(m[1])) key = x[1]; });
      if (key) { if (!(key in h)) h[key] = m[2].trim(); seen++; continue; }
      if (seen && /^\s+\S/.test(lines[i]) && h.to != null) continue;
      break;
    }
    var body = (seen ? lines.slice(i) : lines).join('\n').replace(/^\s*\n/, '').trim();
    var from = { name: '', address: '' };
    if (h.from) {
      var fm = /^(.*?)\s*[<\[](?:mailto:)?([^>\]\s]+@[^>\]\s]+)[>\]]/.exec(h.from);
      if (fm) from = { name: fm[1].replace(/^["'\s]+|["'\s]+$/g, ''), address: fm[2] };
      else if (/@/.test(h.from)) from = { name: '', address: h.from.trim() };
      else from = { name: h.from.trim(), address: '' };
    }
    function list(s) {
      return String(s || '').split(/[;,](?![^<\[]*[>\]])/).map(function (x) {
        var mm = /^(.*?)\s*[<\[](?:mailto:)?([^>\]\s]+@[^>\]\s]+)[>\]]/.exec(x.trim());
        if (mm) return { name: mm[1].replace(/^["'\s]+|["'\s]+$/g, ''), address: mm[2] };
        x = x.trim();
        return /@/.test(x) ? { name: '', address: x } : { name: x, address: '' };
      }).filter(function (a) { return a.name || a.address; });
    }
    var subject = h.subject || '';
    if (!subject) {
      var first = body.split('\n').map(function (l) { return l.trim(); }).filter(Boolean)[0] || '';
      subject = first.length > 120 ? first.slice(0, 117) + '…' : first;
    }
    return { subject: subject, from: from, to: list(h.to), cc: list(h.cc), date: h.date ? parseLooseDate(h.date) : null, messageId: '', text: body, html: '', rtfOnly: false, headers: {}, attachments: [], hadHeaders: seen > 0 };
  }

  var api = {
    norm: norm, isoDate: isoDate, addDays: addDays, daysBetween: daysBetween,
    cleanSubject: cleanSubject, findDates: findDates, suggestDue: suggestDue, parseLooseDate: parseLooseDate,
    toNumber: toNumber, parseAmount: parseAmount, amountsIn: amountsIn,
    detectProvider: detectProvider, providerFromText: providerFromText, hostOf: hostOf, findUrls: findUrls, bookingLinks: bookingLinks,
    extractBooking: extractBooking, parsePasted: parsePasted, KINDS: KINDS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DeskExtract = api;
})(typeof window !== 'undefined' ? window : this);
