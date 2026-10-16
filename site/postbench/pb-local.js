/* Postbench — local touches for Slovenia and Croatia: public holidays and shopping days for the month planner, and
 * Slovenian / Croatian example texts. Pure data and date maths; tested in tools/tests/postbench-local.test.js.
 * Public holidays (work-free days):
 *  - SI: Zakon o praznikih in dela prostih dnevih v Republiki Sloveniji (Uradni list RS, 112/05 – UPB, with later
 *    changes; 2 January is work-free again since 2017).
 *  - HR: Zakon o blagdanima, spomendanima i neradnim danima u Republici Hrvatskoj (NN 110/19).
 * Dates are local calendar dates as "YYYY-MM-DD". Simon: check the list once a year (laws do change). */
(function (root) {
  'use strict';
  var L = {};
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(y, m, d) { var t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate()); }
  L.ymd = ymd;
  // Easter Sunday (Gregorian, anonymous algorithm) → [month, day]
  L.easter = function (y) {
    var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    var h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    return [Math.floor((h + l - 7 * m + 114) / 31), ((h + l - 7 * m + 114) % 31) + 1];
  };
  function plusDays(y, md, n) { return ymd(y, md[0], md[1] + n); }
  // nth weekday (0 = Sunday) of a month; n = -1 for the last one
  function nthWeekday(y, m, wd, n) {
    if (n < 0) { var last = new Date(Date.UTC(y, m, 0)), back = (last.getUTCDay() - wd + 7) % 7; return ymd(y, m, last.getUTCDate() - back); }
    var first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    return ymd(y, m, 1 + ((wd - first + 7) % 7) + (n - 1) * 7);
  }
  // Black Friday: the day after the fourth Thursday of November
  function blackFriday(y) { var t = nthWeekday(y, 11, 4, 4); return ymd(y, 11, +t.slice(8) + 1); }

  // [date, Slovenian/Croatian name, English name, kind]; kind: 'off' = public holiday (work-free), 'shop' = shopping or greeting day
  L.days = function (y, cc) {
    var e = L.easter(y), out;
    if (cc === 'HR') {
      out = [
        [ymd(y, 1, 1), 'Nova godina', "New Year's Day", 'off'], [ymd(y, 1, 6), 'Bogojavljenje ili Sveta tri kralja', 'Epiphany', 'off'],
        [ymd(y, 2, 14), 'Valentinovo', "Valentine's Day", 'shop'], [ymd(y, 3, 8), 'Međunarodni dan žena', "International Women's Day", 'shop'],
        [plusDays(y, e, 0), 'Uskrs', 'Easter Sunday', 'off'], [plusDays(y, e, 1), 'Uskrsni ponedjeljak', 'Easter Monday', 'off'],
        [ymd(y, 5, 1), 'Praznik rada', 'Labour Day', 'off'], [nthWeekday(y, 5, 0, 2), 'Majčin dan', "Mother's Day", 'shop'],
        [ymd(y, 5, 30), 'Dan državnosti', 'Statehood Day', 'off'], [plusDays(y, e, 60), 'Tijelovo', 'Corpus Christi', 'off'],
        [ymd(y, 6, 22), 'Dan antifašističke borbe', 'Anti-Fascist Struggle Day', 'off'],
        [ymd(y, 8, 5), 'Dan pobjede i domovinske zahvalnosti', 'Victory and Homeland Thanksgiving Day', 'off'], [ymd(y, 8, 15), 'Velika Gospa', 'Assumption Day', 'off'],
        [ymd(y, 11, 1), 'Svi sveti', "All Saints' Day", 'off'], [ymd(y, 11, 18), 'Dan sjećanja na žrtve Domovinskog rata', 'Remembrance Day', 'off'],
        [blackFriday(y), 'Black Friday', 'Black Friday', 'shop'], [ymd(y, 12, 24), 'Badnjak', 'Christmas Eve', 'shop'],
        [ymd(y, 12, 25), 'Božić', 'Christmas Day', 'off'], [ymd(y, 12, 26), 'Sveti Stjepan', "St Stephen's Day", 'off'], [ymd(y, 12, 31), 'Stara godina', "New Year's Eve", 'shop']
      ];
    } else {
      out = [
        [ymd(y, 1, 1), 'Novo leto', "New Year's Day", 'off'], [ymd(y, 1, 2), 'Novo leto (2. januar)', "New Year's Day (2 January)", 'off'],
        [ymd(y, 2, 8), 'Prešernov dan', 'Prešeren Day', 'off'], [ymd(y, 2, 14), 'Valentinovo', "Valentine's Day", 'shop'],
        [ymd(y, 3, 8), 'Dan žena', "International Women's Day", 'shop'], [ymd(y, 3, 25), 'Materinski dan', "Mother's Day", 'shop'],
        [plusDays(y, e, 0), 'Velika noč', 'Easter Sunday', 'off'], [plusDays(y, e, 1), 'Velikonočni ponedeljek', 'Easter Monday', 'off'],
        [ymd(y, 4, 27), 'Dan upora proti okupatorju', 'Day of Uprising Against Occupation', 'off'],
        [ymd(y, 5, 1), 'Praznik dela', 'Labour Day', 'off'], [ymd(y, 5, 2), 'Praznik dela (2. maj)', 'Labour Day (2 May)', 'off'],
        [plusDays(y, e, 49), 'Binkošti', 'Whit Sunday', 'off'], [ymd(y, 6, 25), 'Dan državnosti', 'Statehood Day', 'off'],
        [ymd(y, 8, 15), 'Marijino vnebovzetje', 'Assumption Day', 'off'], [ymd(y, 10, 31), 'Dan reformacije', 'Reformation Day', 'off'],
        [ymd(y, 11, 1), 'Dan spomina na mrtve', 'Remembrance Day', 'off'], [blackFriday(y), 'Črni petek', 'Black Friday', 'shop'],
        [ymd(y, 12, 24), 'Božični večer', 'Christmas Eve', 'shop'], [ymd(y, 12, 25), 'Božič', 'Christmas Day', 'off'],
        [ymd(y, 12, 26), 'Dan samostojnosti in enotnosti', 'Independence and Unity Day', 'off'], [ymd(y, 12, 31), 'Silvestrovo', "New Year's Eve", 'shop']
      ];
    }
    return out.map(function (x) { return { date: x[0], name: x[1], en: x[2], kind: x[3], cc: cc === 'HR' ? 'HR' : 'SI' }; }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  };
  // days from `from` (YYYY-MM-DD) up to `n` days ahead, both countries' lists as asked
  L.upcoming = function (from, n, cc) {
    var y = +from.slice(0, 4), to = new Date(Date.UTC(y, +from.slice(5, 7) - 1, +from.slice(8, 10) + n)).toISOString().slice(0, 10);
    return L.days(y, cc).concat(L.days(y + 1, cc)).filter(function (d) { return d.date >= from && d.date <= to; });
  };
  L.holidayOn = function (date, cc) { var y = +date.slice(0, 4); return L.days(y, cc).filter(function (d) { return d.date === date; })[0] || null; };
  L.fmt = function (date) { return +date.slice(8, 10) + '. ' + +date.slice(5, 7) + '.'; }; // "1. 11."

  // a ready post for a holiday or shopping day: fields for the "bold" layout plus a caption, in the post language
  var GREET = {
    sl: { 'Novo leto': 'Srečno novo leto!', 'Božič': 'Vesel božič!', 'Velika noč': 'Vesele velikonočne praznike!', 'Silvestrovo': 'Srečno v novem letu!', 'Božični večer': 'Lep božični večer!', 'Valentinovo': 'Za vse, ki jih imate radi', 'Dan žena': 'Vse najboljše za dan žena', 'Materinski dan': 'Za najboljše mame', 'Črni petek': 'Črni petek je tu' },
    hr: { 'Nova godina': 'Sretna nova godina!', 'Božić': 'Sretan Božić!', 'Uskrs': 'Sretan Uskrs!', 'Stara godina': 'Sretno u novoj godini!', 'Badnjak': 'Blagoslovljen Badnjak!', 'Valentinovo': 'Za sve koje volite', 'Međunarodni dan žena': 'Sretan Dan žena', 'Majčin dan': 'Za najbolje mame', 'Black Friday': 'Black Friday je tu' }
  };
  L.post = function (day, lang, handle) {
    var hr = lang === 'hr' || (lang !== 'sl' && day.cc === 'HR');
    var g = (GREET[hr ? 'hr' : 'sl'] || {})[day.name.replace(/ \(.*\)$/, '')];
    var f;
    if (day.kind === 'off' && !g) f = hr ? { badge: L.fmt(day.date), headline: day.name, sub: 'Na blagdan ne radimo. Vidimo se sljedeći dan!', cta: '' } : { badge: L.fmt(day.date), headline: day.name, sub: 'Na praznik je zaprto. Vidimo se naslednji dan!', cta: '' };
    else if (day.kind === 'off') f = hr ? { badge: L.fmt(day.date), headline: g, sub: 'Na blagdan ne radimo. Hvala što ste s nama!', cta: '' } : { badge: L.fmt(day.date), headline: g, sub: 'Na praznik je zaprto. Hvala, ker ste z nami!', cta: '' };
    else f = hr ? { badge: L.fmt(day.date), headline: g || day.name, sub: 'Pogledajte našu ponudbu za ' + day.name.toLowerCase() + '.', cta: 'Saznaj više' } : { badge: L.fmt(day.date), headline: g || day.name, sub: 'Oglejte si našo ponudbo za ' + day.name.toLowerCase() + '.', cta: 'Več o tem' };
    f.handle = handle || ''; f.list = '';
    var tags = hr ? '#' + day.name.replace(/[^A-Za-zČĆŠŽĐčćšžđ]/g, '').toLowerCase() + ' #hrvatska' : '#' + day.name.replace(/[^A-Za-zČŠŽčšž]/g, '').toLowerCase() + ' #slovenija';
    return { fields: f, caption: f.headline + (f.sub ? '\n' + f.sub : '') + '\n\n' + tags, alt: (f.badge ? f.badge + ' ' : '') + f.headline + '. ' + f.sub };
  };

  // example texts for each layout in Slovenian and Croatian (English stays in index.html)
  L.SAMPLES = {
    sl: {
      bold: { badge: '−30 %', headline: 'Vikend peke', sub: 'Svež kruh, pecivo in torte. Samo v soboto in nedeljo.', cta: 'Naroči zdaj', handle: '@vogalnapekarna', list: '' },
      clean: { badge: 'Novo', headline: 'Kruh z dostavo', sub: 'Vsak petek zjutraj svež hlebec pred vašimi vrati.', cta: 'Naroči se', handle: '@vogalnapekarna', list: '' },
      photo: { badge: 'Odprto dlje', headline: 'Topel kruh do 21. ure', sub: 'Pridite po službi. Vsak večer spečemo še eno serijo.', cta: 'Obiščite nas', handle: '@vogalnapekarna', list: '' },
      spot: { badge: 'Novo', headline: 'Kardamomova štručka', sub: 'Mehka, sladka in pečena ob 6. uri.', cta: 'Rezerviraj', handle: '@vogalnapekarna', list: '' },
      quote: { badge: '★★★★★', headline: 'Najboljši rogljič izven Pariza.', sub: 'Maja R., ocena na Googlu', cta: '', handle: '@vogalnapekarna', list: '' },
      event: { badge: 'Sob 14. 6.', headline: 'Delavnica peke kruha', sub: '10.00–13.00. 12 mest. Vogalna pekarna, Glavna ulica.', cta: 'Rezerviraj mesto', handle: '@vogalnapekarna', list: '' },
      stat: { badge: '4,9', headline: 'Povprečna ocena 1.200 strank', sub: 'Hvala, ker pečete z nami.', cta: '', handle: '@vogalnapekarna', list: '' },
      frame: { badge: 'Od 2014', headline: 'Pečeno počasi. Deljeno pogosto.', sub: 'Na Glavni ulici, odprto vsak dan od 7. ure.', cta: 'Kje smo', handle: '@vogalnapekarna', list: '' },
      menu: { badge: 'Jesenski meni', headline: 'Sveže iz peči', sub: 'Pečemo vsako jutro od 7. ure.', cta: 'Naroči vnaprej', handle: '@vogalnapekarna', list: 'Hlebec z drožmi — 4,50 €\nKardamomova štručka — 3,20 €\nBučna štručka — 3,40 €\nMasleni rogljič — 2,10 €\nKapučino — 2,80 €' },
      hours: { badge: 'Obiščite nas', headline: 'Delovni čas', sub: 'Ob praznikih zaprto.', cta: '', handle: '@vogalnapekarna', list: 'Ponedeljek–petek — 7.00–19.00\nSobota — 8.00–16.00\nNedelja — 8.00–13.00' },
      steps: { badge: 'Nasveti', headline: '3 načini, da kruh ostane svež', sub: '', cta: 'Shrani objavo', handle: '@vogalnapekarna', list: 'Hranite ga z rezom navzdol na leseni deski\nRezine zamrznite in jih popecite kar zamrznjene\nSkorjo osvežite v vroči pečici 5 minut' }
    },
    hr: {
      bold: { badge: '−30 %', headline: 'Vikend pečenja', sub: 'Svježi kruh, peciva i torte. Samo u subotu i nedjelju.', cta: 'Naruči sada', handle: '@pekarnanauglu', list: '' },
      clean: { badge: 'Novo', headline: 'Kruh na kućnu adresu', sub: 'Svaki petak ujutro svjež kruh pred vašim vratima.', cta: 'Pretplati se', handle: '@pekarnanauglu', list: '' },
      photo: { badge: 'Radimo dulje', headline: 'Topli kruh do 21 sat', sub: 'Svratite nakon posla. Svaku večer pečemo još jednu turu.', cta: 'Posjetite nas', handle: '@pekarnanauglu', list: '' },
      spot: { badge: 'Novo', headline: 'Pecivo s kardamomom', sub: 'Mekano, slatko i pečeno u 6 sati.', cta: 'Rezerviraj', handle: '@pekarnanauglu', list: '' },
      quote: { badge: '★★★★★', headline: 'Najbolji kroasan izvan Pariza.', sub: 'Maja R., recenzija na Googleu', cta: '', handle: '@pekarnanauglu', list: '' },
      event: { badge: 'Sub 14. 6.', headline: 'Radionica pečenja kruha', sub: '10:00–13:00. 12 mjesta. Pekarna na uglu, Glavna ulica.', cta: 'Rezerviraj mjesto', handle: '@pekarnanauglu', list: '' },
      stat: { badge: '4,9', headline: 'Prosječna ocjena 1.200 kupaca', sub: 'Hvala što pečete s nama.', cta: '', handle: '@pekarnanauglu', list: '' },
      frame: { badge: 'Od 2014.', headline: 'Pečeno polako. Dijeljeno često.', sub: 'U Glavnoj ulici, otvoreno svaki dan od 7 sati.', cta: 'Gdje smo', handle: '@pekarnanauglu', list: '' },
      menu: { badge: 'Jesenski meni', headline: 'Svježe iz pećnice', sub: 'Pečemo svako jutro od 7 sati.', cta: 'Naruči unaprijed', handle: '@pekarnanauglu', list: 'Kruh s kiselim tijestom — 4,50 €\nPecivo s kardamomom — 3,20 €\nPecivo s bundevom — 3,40 €\nKroasan s maslacem — 2,10 €\nCappuccino — 2,80 €' },
      hours: { badge: 'Posjetite nas', headline: 'Radno vrijeme', sub: 'Blagdanima ne radimo.', cta: '', handle: '@pekarnanauglu', list: 'Ponedjeljak–petak — 7:00–19:00\nSubota — 8:00–16:00\nNedjelja — 8:00–13:00' },
      steps: { badge: 'Savjeti', headline: '3 načina da kruh ostane svjež', sub: '', cta: 'Spremi objavu', handle: '@pekarnanauglu', list: 'Čuvajte ga prerezanom stranom prema dolje na drvenoj dasci\nZamrznite kriške i tostirajte ih izravno iz zamrzivača\nOsvježite koricu 5 minuta u vrućoj pećnici' }
    }
  };
  // the profile's post language → sample language
  L.langOf = function (profileLang) { return profileLang === 'Slovenian' ? 'sl' : profileLang === 'Croatian' ? 'hr' : 'en'; };

  root.PBLocal = L;
  if (typeof module !== 'undefined' && module.exports) module.exports = L;
})(typeof window !== 'undefined' ? window : globalThis);
