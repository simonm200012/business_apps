/* CRM engine (Business Apps): pure functions, no DOM. UMD, so tools/tests/crm-engine.test.js loads it in Node.
 *   - VAT IDs: Slovenian davčna številka (mod 11) and Croatian OIB (ISO 7064 MOD 11,10), the same rules as the
 *     Collections and Data health check apps; check-digit repair for the generated demo IDs;
 *   - VIES lookup answers (EU VAT number check, via the Worker route GET /api/vies/:country/:number) normalised,
 *     with the address split into street / postcode / city;
 *   - quotes in Slovenian ("Ponudba"), Croatian ("Ponuda") and English, with the reverse-charge note of
 *     Art. 196 of Council Directive 2006/112/EC in each language;
 *   - default e-mail templates in Slovenian and Croatian;
 *   - CSV import of companies and deals: column guesses (EN/SL/HR headers), amount/date parsing, and a plan that says
 *     per row what will happen (new, update, skip and why) before anything is written. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CRMEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ── VAT IDs ──────────────────────────────────────────────────────────────
  function digitsOf(v, cc) { return String(v || '').toUpperCase().replace(/[\s.\-]/g, '').replace(new RegExp('^' + cc), ''); }
  function siCheck(d7) { var t = 0; for (var i = 0; i < 7; i++) t += +d7[i] * (8 - i); var c = 11 - (t % 11); return c === 10 ? null : c === 11 ? 0 : c; }
  function hrCheck(d10) { var a = 10; for (var i = 0; i < 10; i++) { a = (a + +d10[i]) % 10; if (a === 0) a = 10; a = (a * 2) % 11; } var c = 11 - a; return c === 10 ? 0 : c; }
  function siValid(v) { var s = digitsOf(v, 'SI'); return /^[1-9]\d{7}$/.test(s) && siCheck(s) === +s[7]; }
  function hrValid(v) { var s = digitsOf(v, 'HR'); return /^\d{11}$/.test(s) && hrCheck(s) === +s[10]; }
  function normVat(v, country) {
    var s = String(v || '').toUpperCase().replace(/[\s.\-]/g, '');
    if (!s) return '';
    if (/^\d+$/.test(s) && country) s = country + s;
    return s;
  }
  /** → { ok, msg } (unknown countries: format only) */
  function checkVat(v, country) {
    var s = normVat(v, country);
    if (!s) return { ok: true, msg: '' };
    var cc = s.slice(0, 2);
    if (!/^[A-Z]{2}[0-9A-Z]{2,13}$/.test(s)) return { ok: false, msg: 'A VAT ID is the country code and the number, e.g. SI12345678.' };
    if (cc === 'SI') return siValid(s) ? { ok: true, msg: '' } : { ok: false, msg: 'This is not a valid Slovenian VAT ID (8 digits with a check digit).' };
    if (cc === 'HR') return hrValid(s) ? { ok: true, msg: '' } : { ok: false, msg: 'This is not a valid Croatian VAT ID / OIB (11 digits with a check digit).' };
    return { ok: true, msg: '' };
  }
  /** the generated demo IDs had random check digits: give them the right one (SI: if no digit fits, the 7th digit moves on) */
  function repairVat(v) {
    var s = String(v || '');
    if (/^SI\d{8}$/.test(s)) {
      var d = s.slice(2, 9).split('').map(Number);
      if (d[0] === 0) d[0] = 1;
      for (var k = 0; k < 10; k++) { var c = siCheck(d.join('')); if (c != null) return 'SI' + d.join('') + c; d[6] = (d[6] + 1) % 10; }
    }
    if (/^HR\d{11}$/.test(s)) return 'HR' + s.slice(2, 12) + hrCheck(s.slice(2, 12));
    return s;
  }

  // ── VIES ─────────────────────────────────────────────────────────────────
  // worker/index.js answers GET /api/vies/:cc/:number with { country, number, valid, status, name, address } (line breaks
  // folded into spaces), or { status: 'unavailable', reason, error } when the member state's register is down.
  function cap(s) { s = String(s || '').trim(); return s === s.toUpperCase() ? s.charAt(0) + s.slice(1).toLowerCase() : s; }
  /** "DUNAJSKA CESTA 1\n1000 LJUBLJANA" / "Ilica 1, 10000 Zagreb" → { street, postcode, city } */
  function splitAddress(a) {
    var parts = String(a || '').split(/\n|,\s*/).map(function (x) { return x.trim(); }).filter(Boolean), out = { street: '', postcode: '', city: '' }, rest = [];
    parts.forEach(function (p) {
      var m = /^(?:[A-Z]{2}[-\s])?(\d{4,5})\s+(.+)$/.exec(p);
      if (m && !out.postcode) { out.postcode = m[1]; out.city = cap(m[2]); } else rest.push(p);
    });
    // the Worker folds VIES's line breaks into spaces: "DUNAJSKA CESTA 1 1000 LJUBLJANA" → the last 4–5 digit group before a word
    if (!out.postcode && rest.length) {
      var all = rest.join(', '), m2 = /^(.*\S)[,\s]+(?:[A-Z]{2}[-\s])?(\d{4,5})\s+(\D.*)$/.exec(all);
      if (m2) { out.postcode = m2[2]; out.city = cap(m2[3]); rest = [m2[1].replace(/,$/, '')]; }
    }
    out.street = rest.map(cap).join(', ');
    return out;
  }
  /** a VIES answer (the EU REST API's own fields, or a Worker that renamed them) → { valid, name, address, street, postcode, city, country, vat } */
  function parseVies(j, cc, num) {
    j = j || {};
    var valid = j.valid != null ? !!j.valid : j.isValid != null ? !!j.isValid : null;
    var name = j.name || j.traderName || j.companyName || '', addr = j.address || j.traderAddress || '';
    if (/^-{2,}$/.test(String(name).trim())) name = ''; // VIES shows "---" when a member state does not share it
    if (/^-{2,}$/.test(String(addr).trim())) addr = '';
    var a = splitAddress(addr);
    return { valid: valid, name: String(name).trim(), address: String(addr).trim(), street: a.street, postcode: a.postcode, city: a.city,
      country: (j.countryCode || j.country || cc || '').toUpperCase(), vat: (j.countryCode || j.country || cc || '').toUpperCase() + String(j.vatNumber || j.number || num || '').replace(/^[A-Z]{2}/, ''), error: j.status === 'unavailable' ? (j.error || 'VIES is not available right now.') : j.error ? String(j.error) : j.userError && j.userError !== 'VALID' && j.userError !== 'INVALID' ? j.userError : '' };
  }

  // ── Quotes in SL / HR / EN ───────────────────────────────────────────────
  var QT = {
    en: { title: 'Quote', date: 'Date', valid: 'Valid until', status: 'Status', for: 'Prepared for', attn: 'Attn.', re: 'Re:', item: 'Item', qty: 'Qty', price: 'Unit price', disc: 'Disc.', vat: 'VAT', net: 'Net', total: 'Total EUR', note: 'Note', terms: 'Terms', sign: 'Accepted by the customer (date, signature)', vatId: 'VAT ID', rcShort: 'RC', rcLabel: 'reverse charge',
      rc: 'Reverse charge – Article 196 of Council Directive 2006/112/EC', st: { Draft: 'Draft', Sent: 'Sent', Accepted: 'Accepted', Declined: 'Declined', Expired: 'Expired' }, country: { SI: 'Slovenia', HR: 'Croatia' },
      terms0: 'Prices in EUR, VAT shown separately. Payment 30 days net from invoice date. Delivery 5–10 working days after order confirmation. This quote is a demo and not a binding offer.',
      seller: ['Demo cesta 1, 1000 Ljubljana, Slovenia', 'VAT ID SI00000000 · b2b@example.com · +386 1 555 00 00'] },
    sl: { title: 'Ponudba', date: 'Datum', valid: 'Veljavna do', status: 'Stanje', for: 'Za', attn: 'V roke:', re: 'Zadeva:', item: 'Artikel', qty: 'Količina', price: 'Cena na enoto', disc: 'Popust', vat: 'DDV', net: 'Znesek brez DDV', total: 'Skupaj EUR', note: 'Opomba', terms: 'Pogoji', sign: 'Ponudbo sprejemamo (datum, podpis)', vatId: 'ID za DDV', rcShort: 'ODO', rcLabel: 'obrnjena davčna obveznost',
      rc: 'Obrnjena davčna obveznost – 196. člen Direktive Sveta 2006/112/ES', st: { Draft: 'Osnutek', Sent: 'Poslana', Accepted: 'Sprejeta', Declined: 'Zavrnjena', Expired: 'Potekla' }, country: { SI: 'Slovenija', HR: 'Hrvaška' },
      terms0: 'Cene so v EUR, DDV je prikazan posebej. Plačilo 30 dni od datuma računa. Dobava 5–10 delovnih dni po potrditvi naročila. Ponudba je demo in ni zavezujoča.',
      seller: ['Demo cesta 1, 1000 Ljubljana, Slovenija', 'ID za DDV SI00000000 · b2b@example.com · +386 1 555 00 00'] },
    hr: { title: 'Ponuda', date: 'Datum', valid: 'Vrijedi do', status: 'Status', for: 'Za', attn: 'N/p:', re: 'Predmet:', item: 'Stavka', qty: 'Količina', price: 'Jedinična cijena', disc: 'Popust', vat: 'PDV', net: 'Iznos bez PDV-a', total: 'Ukupno EUR', note: 'Napomena', terms: 'Uvjeti', sign: 'Ponudu prihvaćamo (datum, potpis)', vatId: 'PDV ID', rcShort: 'PPO', rcLabel: 'prijenos porezne obveze',
      rc: 'Prijenos porezne obveze – čl. 196. Direktive Vijeća 2006/112/EZ', st: { Draft: 'Nacrt', Sent: 'Poslana', Accepted: 'Prihvaćena', Declined: 'Odbijena', Expired: 'Istekla' }, country: { SI: 'Slovenija', HR: 'Hrvatska' },
      terms0: 'Cijene su u EUR, PDV je iskazan zasebno. Plaćanje 30 dana od datuma računa. Isporuka 5–10 radnih dana nakon potvrde narudžbe. Ova ponuda je demo i nije obvezujuća.',
      seller: ['Demo cesta 1, 1000 Ljubljana, Slovenija', 'PDV ID SI00000000 · b2b@example.com · +386 1 555 00 00'] }
  };
  var QUOTE_LANGS = [['sl', 'Slovenščina'], ['hr', 'Hrvatski'], ['en', 'English']];
  function quoteLang(country) { return country === 'SI' ? 'sl' : country === 'HR' ? 'hr' : 'en'; }
  function qt(lang) { return QT[lang] || QT.en; }
  // product names and units of the demo catalogue (data.js PRODUCTS) for SL / HR quotes
  var PRODUCT_I18N = {
    'FRM-PRG': ['Program okvirjev (B2B asortiment)', 'Program okvira (B2B asortiman)'], 'CL-SUB': ['Naročnina na kontaktne leče (12 mesecev)', 'Pretplata na kontaktne leće (12 mjeseci)'],
    'EYE-EXAM': ['Paket pregledov vida za zaposlene', 'Paket pregleda vida za zaposlenike'], 'SAFE-RX': ['Korekcijska zaščitna očala', 'Korektivne zaštitne naočale'],
    'SCR-GL': ['Očala za delo z zaslonom', 'Naočale za rad na zaslonu'], 'LENS-SUP': ['Pogodba za dobavo progresivnih leč', 'Ugovor o isporuci progresivnih leća'],
    'SUN-SEAS': ['Sezonski asortiment sončnih očal', 'Sezonski asortiman sunčanih naočala'], 'SIS-FIX': ['Prodajni stalaž shop-in-shop', 'Prodajni stalak shop-in-shop'],
    'TRAIN': ['Strokovna delavnica za optometriste', 'Stručna radionica za optometriste'], 'MKT-PART': ['Paket skupnega trženja', 'Paket zajedničkog marketinga'],
    'VOUCH': ['Paket bonov za nego oči', 'Paket vaučera za njegu očiju'], 'IMPORT': ['Uvožena vrednost posla', 'Uvezena vrijednost posla']
  };
  // units as they stand after a quantity on SL / HR documents (abbreviations, so no declension is needed: "400 kos")
  var UNIT_I18N = { frame: ['kos', 'kom'], patient: ['os.', 'os.'], employee: ['os.', 'os.'], pair: ['par', 'par'], piece: ['kos', 'kom'], fixture: ['kos', 'kom'], day: ['dan', 'dan'], quarter: ['četrtl.', 'tromj.'], voucher: ['kos', 'kom'], pcs: ['kos', 'kom'], deal: ['posel', 'posao'] };
  function productName(id, fallback, lang) { var x = PRODUCT_I18N[id]; return x && (lang === 'sl' || lang === 'hr') ? x[lang === 'sl' ? 0 : 1] : fallback; }
  function unitName(u, lang) { var x = UNIT_I18N[u]; return x && (lang === 'sl' || lang === 'hr') ? x[lang === 'sl' ? 0 : 1] : u; }

  // ── e-mail templates in Slovenian and Croatian (keys end in -sl / -hr) ────
  var TEMPLATES_I18N = [
    { key: 'intro-sl', lang: 'sl', category: 'Intro', name: 'Predstavitev — B2B program', subject: 'Tokovi B2B program za {{company}}', body: 'Spoštovani,\n\nhvala za vaše zanimanje za sodelovanje s podjetjem Tokovi. Optikam, klinikam in podjetjem v Sloveniji in na Hrvaškem dobavljamo okvirje, leče, naročnine na kontaktne leče in programe skrbi za vid zaposlenih.\n\nZ veseljem vam predstavimo, kaj lahko ponudimo podjetju {{company}}. Bi vam prihodnji teden ustrezal kratek klic?\n\nLep pozdrav,\n{{owner}}\nTokovi B2B' },
    { key: 'followup-sl', lang: 'sl', category: 'Follow-up', name: 'Po sestanku — naslednji koraki', subject: 'Hvala za sestanek — naslednji koraki', body: 'Spoštovani,\n\nhvala za vaš čas danes. Kot smo se dogovorili, bomo pripravili ponudbo za {{deal}} in vam jo kmalu poslali.\n\nČe se medtem karkoli pojavi, preprosto odgovorite na to sporočilo.\n\nLep pozdrav,\n{{owner}}' },
    { key: 'proposal-sl', lang: 'sl', category: 'Proposal', name: 'Ponudba poslana', subject: 'Naša ponudba: {{deal}}', body: 'Spoštovani,\n\nv priponki vam pošiljamo ponudbo za {{deal}} ({{value}} brez DDV){{quote_ref}}. Ponudba velja 30 dni.\n\nZ veseljem vam jo predstavimo — sporočite nam, kdaj vam ustreza.\n\nLep pozdrav,\n{{owner}}\nTokovi B2B' },
    { key: 'reminder-sl', lang: 'sl', category: 'Follow-up', name: 'Prijazen opomnik', subject: 'Ponudba za {{deal}}', body: 'Spoštovani,\n\nželimo preveriti, ali ste si že utegnili ogledati našo ponudbo za {{deal}}. Če vam olajša odločitev, lahko prilagodimo količine ali roke dobave.\n\nLep pozdrav,\n{{owner}}' },
    { key: 'thanks-sl', lang: 'sl', category: 'Thank you', name: 'Zahvala za naročilo', subject: 'Hvala za naročilo, {{company}}', body: 'Spoštovani,\n\nhvala, ker ste izbrali Tokovi. Vaše naročilo za {{deal}} je v obdelavi; datum dobave vam potrdimo v kratkem.\n\nLep pozdrav,\n{{owner}}\nTokovi B2B' },
    { key: 'winback-sl', lang: 'sl', category: 'Win-back', name: 'Ponovno sodelovanje', subject: 'Bi nadaljevali sodelovanje?', body: 'Spoštovani,\n\nnekaj časa je minilo od našega zadnjega sodelovanja s podjetjem {{company}}. Letos imamo nove kolekcije okvirjev, naročnine na kontaktne leče in pakete skrbi za vid zaposlenih — z veseljem vam predstavimo novosti.\n\nBi si prihodnji teden vzeli 20 minut?\n\nLep pozdrav,\n{{owner}}\nTokovi B2B' },
    { key: 'intro-hr', lang: 'hr', category: 'Intro', name: 'Predstavljanje — B2B program', subject: 'Tokovi B2B program za {{company}}', body: 'Poštovani,\n\nzahvaljujemo na interesu za suradnju s tvrtkom Tokovi. Optikama, klinikama i tvrtkama u Sloveniji i Hrvatskoj isporučujemo okvire, leće, pretplate na kontaktne leće i programe skrbi o vidu zaposlenika.\n\nRado ćemo vam pokazati što možemo ponuditi tvrtki {{company}}. Bi li vam odgovarao kratak razgovor sljedeći tjedan?\n\nLijep pozdrav,\n{{owner}}\nTokovi B2B' },
    { key: 'followup-hr', lang: 'hr', category: 'Follow-up', name: 'Nakon sastanka — sljedeći koraci', subject: 'Hvala na sastanku — sljedeći koraci', body: 'Poštovani,\n\nhvala na vašem vremenu danas. Kako smo dogovorili, pripremit ćemo ponudu za {{deal}} i uskoro vam je poslati.\n\nAko se u međuvremenu nešto pojavi, slobodno odgovorite na ovu poruku.\n\nLijep pozdrav,\n{{owner}}' },
    { key: 'proposal-hr', lang: 'hr', category: 'Proposal', name: 'Ponuda poslana', subject: 'Naša ponuda: {{deal}}', body: 'Poštovani,\n\nu privitku vam šaljemo ponudu za {{deal}} ({{value}} bez PDV-a){{quote_ref}}. Ponuda vrijedi 30 dana.\n\nRado ćemo vam je predstaviti — javite nam kada vam odgovara.\n\nLijep pozdrav,\n{{owner}}\nTokovi B2B' },
    { key: 'reminder-hr', lang: 'hr', category: 'Follow-up', name: 'Ljubazni podsjetnik', subject: 'Ponuda za {{deal}}', body: 'Poštovani,\n\nželimo provjeriti jeste li stigli pogledati našu ponudu za {{deal}}. Ako vam to olakšava odluku, možemo prilagoditi količine ili rokove isporuke.\n\nLijep pozdrav,\n{{owner}}' },
    { key: 'thanks-hr', lang: 'hr', category: 'Thank you', name: 'Zahvala na narudžbi', subject: 'Hvala na narudžbi, {{company}}', body: 'Poštovani,\n\nhvala što ste odabrali Tokovi. Vaša narudžba za {{deal}} je u obradi; datum isporuke potvrdit ćemo uskoro.\n\nLijep pozdrav,\n{{owner}}\nTokovi B2B' },
    { key: 'winback-hr', lang: 'hr', category: 'Win-back', name: 'Ponovna suradnja', subject: 'Nastavimo suradnju?', body: 'Poštovani,\n\nprošlo je neko vrijeme od naše posljednje suradnje s tvrtkom {{company}}. Ove sezone imamo nove kolekcije okvira, pretplate na kontaktne leće i pakete skrbi o vidu zaposlenika — rado ćemo vam predstaviti novosti.\n\nImate li 20 minuta sljedeći tjedan?\n\nLijep pozdrav,\n{{owner}}\nTokovi B2B' }
  ];
  function quoteRef(no, lang) { return no ? (lang === 'sl' ? ', ponudba ' : lang === 'hr' ? ', ponuda ' : ', quote ') + no : ''; }

  // ── CSV import of companies and deals ────────────────────────────────────
  function fold(s) { return String(s || '').replace(/[Đđ]/g, 'dj').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
  function parseAmount(v) {
    var s = String(v == null ? '' : v).trim().replace(/[−–]/g, '-').replace(/€|EUR|kn/gi, '').replace(/[\s ']/g, '');
    if (!s) return null;
    var neg = /^-/.test(s); s = s.replace(/^[-+]/, '');
    if (!/^[\d.,]+$/.test(s)) return null;
    var lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
    if (lc >= 0 && ld >= 0) s = lc > ld ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    else if (lc >= 0) s = /^[1-9]\d{0,2}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
    else if (ld >= 0 && /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ''); // 12.500 = twelve thousand five hundred
    var n = parseFloat(s);
    return isFinite(n) ? Math.round((neg ? -n : n) * 100) / 100 : null;
  }
  function parseDate(v) {
    var s = String(v == null ? '' : v).trim(), m, y, mo, d;
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    else if ((m = /^(\d{1,2})\s*[.\/]\s*(\d{1,2})\s*[.\/]\s*(\d{4})\.?$/.exec(s))) { y = +m[3]; mo = +m[2]; d = +m[1]; }
    else return '';
    var dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return '';
    return y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }
  var CO_FIELDS = [
    { key: 'name', label: 'Company name', req: true, re: /^(company|company name|name|naziv|ime podjetja|podjetje|tvrtka|naziv tvrtke|firma|account|account name|organi[sz]ation)$/ },
    { key: 'vat', label: 'VAT ID', re: /vat|ddv|pdv|oib|davcna|tax ?id|id za ddv/ },
    { key: 'country', label: 'Country', re: /^(country|drzava|country code)$/ },
    { key: 'address', label: 'Street address', re: /^(address|street|naslov|ulica|adresa|street address)$/ },
    { key: 'postcode', label: 'Postcode', re: /post|zip|postna|postanski/ },
    { key: 'city', label: 'City', re: /^(city|town|kraj|mesto|grad|posta|mjesto)$/ },
    { key: 'phone', label: 'Phone', re: /phone|tel|telefon/ },
    { key: 'email', label: 'Email', re: /e ?mail|mail/ },
    { key: 'website', label: 'Website', re: /web|url|spletna|stran/ },
    { key: 'segment', label: 'Segment', re: /segment|type|vrsta|tip|kategorija|category/ },
    { key: 'employees', label: 'Employees', re: /employees|zaposleni|zaposlenika|staff|headcount/ },
    { key: 'owner', label: 'Owner (sales rep)', re: /owner|rep|skrbnik|komercialist|prodajalec|vlasnik|account manager/ }
  ];
  var DEAL_FIELDS = [
    { key: 'title', label: 'Deal title', req: true, re: /^(title|deal|deal name|deal title|naziv|posel|naziv posla|opportunity|prilika|name)$/ },
    { key: 'company', label: 'Company (name or VAT ID)', req: true, re: /^(company|account|organi[sz]ation|podjetje|tvrtka|kupec|kupac|stranka|customer|company name)$/ },
    { key: 'value', label: 'Value (EUR excl. VAT)', req: true, re: /value|amount|vrednost|znesek|iznos|vrijednost|revenue|eur/ },
    { key: 'stage', label: 'Stage', re: /stage|faza|status|stopnja/ },
    { key: 'close', label: 'Expected close date', re: /close|zakljucek|zakljucka|datum|date|rok/ },
    { key: 'owner', label: 'Owner (sales rep)', re: /owner|rep|skrbnik|komercialist|prodajalec|vlasnik/ },
    { key: 'contact', label: 'Contact e-mail', re: /e ?mail|contact|kontakt/ }
  ];
  function guessMap(headers, fields) {
    var map = {}, used = {};
    fields.forEach(function (f) {
      map[f.key] = '';
      for (var i = 0; i < headers.length; i++) if (!used[i] && f.re.test(fold(headers[i]))) { map[f.key] = String(i); used[i] = 1; return; }
    });
    return map;
  }
  var STAGE_WORDS = [['lead', /^(lead|new|nov|nova|novo|potencial)/], ['qualified', /^(qualif|kvalific)/], ['proposal', /^(proposal|quote|ponudb|ponud|offer)/], ['negotiation', /^(negotia|pogaj|pregovor)/], ['won', /^(won|win|dobljen|dobiven|osvojen|zaklju[cč]en uspe|closed won)/], ['lost', /^(lost|izgubljen|closed lost)/]];
  function stageOf(v) { var s = fold(v); if (!s) return 'lead'; for (var i = 0; i < STAGE_WORDS.length; i++) if (STAGE_WORDS[i][1].test(s)) return STAGE_WORDS[i][0]; return null; }
  function countryOf(v, vat) {
    var s = fold(v);
    if (/^(si|svn|slovenia|slovenija)$/.test(s)) return 'SI';
    if (/^(hr|hrv|croatia|hrvaska|hrvatska)$/.test(s)) return 'HR';
    if (!s && /^(SI|HR)/.test(String(vat || '').toUpperCase())) return String(vat).toUpperCase().slice(0, 2);
    return s ? null : '';
  }
  function ownerOf(v, owners) {
    var s = fold(v); if (!s) return '';
    var o = owners.filter(function (x) { return fold(x.name) === s || x.id === v || fold(x.initials) === s || fold(x.name).split(' ')[0] === s; })[0];
    return o ? o.id : null;
  }
  function g(r, map, k) { var ix = map[k]; return ix === '' || ix == null ? '' : String(r[+ix] == null ? '' : r[+ix]).trim(); }
  /** companies: rows + map + { companies, owners, segments, defaults: {owner, segment, country}, update: bool } →
   *  { rows: [{line, status: 'new'|'update'|'skip', note, rec, target}], counts } — a VAT ID or the exact name finds an existing company */
  function planCompanies(rows, map, ctx) {
    var byVat = {}, byName = {}, seen = {}, out = [];
    ctx.companies.forEach(function (c) { if (c.vat) byVat[normVat(c.vat)] = c; byName[fold(c.name)] = c; });
    rows.forEach(function (r, i) {
      var p = { line: i + 1, status: 'new', note: '', rec: {} }, name = g(r, map, 'name'), vatRaw = g(r, map, 'vat');
      if (!name) { p.status = 'skip'; p.note = 'No company name'; out.push(p); return; }
      var country = countryOf(g(r, map, 'country'), vatRaw);
      if (country === null) { p.status = 'skip'; p.note = 'Country “' + g(r, map, 'country') + '” is not SI or HR'; out.push(p); return; }
      country = country || ctx.defaults.country;
      var vat = normVat(vatRaw, country), vc = checkVat(vat, country);
      var notes = [];
      if (!vc.ok) { notes.push('VAT ID “' + vatRaw + '” is not valid: left empty'); vat = ''; }
      var seg = g(r, map, 'segment'), segOk = ctx.segments.filter(function (s) { return fold(s) === fold(seg); })[0];
      if (seg && !segOk) notes.push('Segment “' + seg + '” unknown: ' + ctx.defaults.segment);
      var own = ownerOf(g(r, map, 'owner'), ctx.owners);
      if (own === null) { notes.push('Owner “' + g(r, map, 'owner') + '” unknown: default owner'); own = ''; }
      var em = g(r, map, 'email').toLowerCase();
      if (em && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) { notes.push('Invalid e-mail dropped'); em = ''; }
      var emp = g(r, map, 'employees').replace(/\D/g, '');
      p.rec = { name: name, vat: vat, country: country, address: g(r, map, 'address'), postcode: g(r, map, 'postcode'), city: g(r, map, 'city'), phone: g(r, map, 'phone'), email: em, website: g(r, map, 'website'),
        segment: segOk || ctx.defaults.segment, employees: emp ? +emp : '', owner: own || ctx.defaults.owner };
      var key = vat ? 'v:' + vat : 'n:' + fold(name);
      if (seen[key]) { p.status = 'skip'; p.note = 'Duplicate of row ' + seen[key]; out.push(p); return; }
      seen[key] = p.line;
      var ex = (vat && byVat[vat]) || byName[fold(name)];
      if (ex) {
        if (!ctx.update) { p.status = 'skip'; p.note = 'Already in the CRM (' + ex.name + ')'; }
        else { p.status = 'update'; p.target = ex; notes.unshift('Fills empty fields of ' + ex.name); }
      }
      p.note = p.note || notes.join(' · ');
      out.push(p);
    });
    return { rows: out, counts: count(out) };
  }
  /** deals: rows + map + { companies, contacts, owners, today, defaults: {owner}, createCompanies: bool, defaultCountry } */
  function planDeals(rows, map, ctx) {
    var byVat = {}, byName = {}, out = [], newCos = {};
    ctx.companies.forEach(function (c) { if (c.vat) byVat[normVat(c.vat)] = c; byName[fold(c.name)] = c; });
    rows.forEach(function (r, i) {
      var p = { line: i + 1, status: 'new', note: '', rec: {} }, notes = [];
      var title = g(r, map, 'title'), coRaw = g(r, map, 'company'), val = parseAmount(g(r, map, 'value'));
      if (!title) { p.status = 'skip'; p.note = 'No deal title'; out.push(p); return; }
      if (!coRaw) { p.status = 'skip'; p.note = 'No company'; out.push(p); return; }
      if (val == null || val < 0) { p.status = 'skip'; p.note = 'Value “' + g(r, map, 'value') + '” is not an amount'; out.push(p); return; }
      var stage = stageOf(g(r, map, 'stage'));
      if (stage === null) { notes.push('Stage “' + g(r, map, 'stage') + '” unknown: Lead'); stage = 'lead'; }
      var close = g(r, map, 'close') ? parseDate(g(r, map, 'close')) : '';
      if (g(r, map, 'close') && !close) notes.push('Close date “' + g(r, map, 'close') + '” not understood: in 45 days');
      var vatKey = normVat(coRaw), co = byVat[vatKey] || byName[fold(coRaw)] || null;
      if (!co) {
        if (!ctx.createCompanies || /^[A-Z]{2}\d{6,13}$/.test(vatKey)) { p.status = 'skip'; p.note = 'Company “' + coRaw + '” is not in the CRM'; out.push(p); return; }
        p.newCompany = coRaw; newCos[fold(coRaw)] = 1; notes.push('New company');
      }
      var own = ownerOf(g(r, map, 'owner'), ctx.owners);
      if (own === null) { notes.push('Owner “' + g(r, map, 'owner') + '” unknown'); own = ''; }
      var em = g(r, map, 'contact').toLowerCase(), ct = em && co ? ctx.contacts.filter(function (x) { return x.companyId === co.id && (x.email || '').toLowerCase() === em; })[0] : null;
      if (em && !ct) notes.push('Contact ' + em + ' not found at the company');
      p.rec = { title: title, companyId: co ? co.id : null, contactId: ct ? ct.id : null, value: val, stage: stage, expectedClose: close, owner: own || (co && co.owner) || ctx.defaults.owner };
      p.note = notes.join(' · ');
      out.push(p);
    });
    var c = count(out); c.newCompanies = Object.keys(newCos).length;
    return { rows: out, counts: c };
  }
  function count(rows) { var c = { new: 0, update: 0, skip: 0 }; rows.forEach(function (p) { c[p.status]++; }); return c; }

  return {
    siValid: siValid, hrValid: hrValid, normVat: normVat, checkVat: checkVat, repairVat: repairVat, siCheck: siCheck, hrCheck: hrCheck,
    splitAddress: splitAddress, parseVies: parseVies,
    QT: QT, QUOTE_LANGS: QUOTE_LANGS, quoteLang: quoteLang, qt: qt, productName: productName, unitName: unitName, quoteRef: quoteRef, TEMPLATES_I18N: TEMPLATES_I18N,
    fold: fold, parseAmount: parseAmount, parseDate: parseDate, CO_FIELDS: CO_FIELDS, DEAL_FIELDS: DEAL_FIELDS, guessMap: guessMap, stageOf: stageOf, countryOf: countryOf,
    planCompanies: planCompanies, planDeals: planDeals
  };
});
