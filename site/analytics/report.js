/* Clearfigure Analytics: the monthly report in English, Slovenian and Croatian, as text, as an A4 PDF (pdfmake) and as a
 * ready-to-send e-mail (.eml with the PDF attached). app.js builds the report model (plain numbers and names);
 * everything that depends on the language lives here, so Node tests can check it (tools/tests/analytics-report.test.js).
 * Numbers and dates use Slovenian formats in every language: "1.234 €", "12,3 %", "15. 10. 2026".
 * No network: the PDF library is loaded by app.js on first use; the .eml is built in the browser and downloaded. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AnalyticsReport = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const LANGS = ['en', 'sl', 'hr'];
  const fin = v => typeof v === 'number' && isFinite(v);
  const div = (a, b) => (b ? a / b : NaN);
  const chg = (c, p) => (fin(c) && fin(p) && p !== 0 ? (c - p) / Math.abs(p) : NaN);

  // ── Formats (Slovenian, also right for Croatia) ─────────────────────────────
  const nfo = o => new Intl.NumberFormat('sl-SI', Object.assign({ useGrouping: 'always' }, o));
  const NF = nfo({ maximumFractionDigits: 0 }), NF1 = nfo({ minimumFractionDigits: 1, maximumFractionDigits: 1 }), NF2 = nfo({ minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const MINUS = '−', NB = ' ';
  const F = {
    eur: v => (fin(v) ? (v < 0 ? MINUS : '') + NF.format(Math.abs(Math.round(v))) + NB + '€' : '—'),
    eur2: v => (fin(v) ? (v < 0 ? MINUS : '') + NF2.format(Math.abs(v)) + NB + '€' : '—'),
    int: v => (fin(v) ? NF.format(Math.round(v)) : '—'),
    pct: v => (fin(v) ? NF1.format(v * 100) + NB + '%' : '—'),
    pct2: v => (fin(v) ? NF2.format(v * 100) + NB + '%' : '—'),
    pct0: v => (fin(v) ? NF.format(Math.round(v * 100)) + NB + '%' : '—'),
    x: v => (fin(v) ? NF2.format(v) + '×' : '—'),
    num1: v => (fin(v) ? NF1.format(v) : '—')
  };
  // "+4,2 %" / "−3,1 %" (a change given as a fraction)
  const signedPct = v => (fin(v) ? (v >= 0 ? '+' : MINUS) + NF1.format(Math.abs(v * 100)) + NB + '%' : '—');
  // ISO date "2026-10-15" → "15. 10. 2026" (or "15. 10." without the year)
  function dmy(iso, year = true) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m) return '';
    return +m[3] + '. ' + +m[2] + '.' + (year ? ' ' + m[1] : '');
  }
  function range(a, b) {
    if (!a) return '';
    if (a === b) return dmy(a);
    return dmy(a, a.slice(0, 4) !== b.slice(0, 4)) + ' – ' + dmy(b);
  }

  // ── Words ───────────────────────────────────────────────────────────────────
  const MONTHS = {
    en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    sl: ['januar', 'februar', 'marec', 'april', 'maj', 'junij', 'julij', 'avgust', 'september', 'oktober', 'november', 'december'],
    hr: ['siječanj', 'veljača', 'ožujak', 'travanj', 'svibanj', 'lipanj', 'srpanj', 'kolovoz', 'rujan', 'listopad', 'studeni', 'prosinac']
  };
  const WEEKDAYS = {
    en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    sl: ['nedelja', 'ponedeljek', 'torek', 'sreda', 'četrtek', 'petek', 'sobota'],
    hr: ['nedjelja', 'ponedjeljak', 'utorak', 'srijeda', 'četvrtak', 'petak', 'subota']
  };
  const WD_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const CATS = {
    frames: ['Frames', 'Okvirji', 'Okviri'],
    sunglasses: ['Sunglasses', 'Sončna očala', 'Sunčane naočale'],
    'contact-lenses': ['Contact lenses', 'Kontaktne leče', 'Kontaktne leće'],
    solutions: ['Solutions', 'Tekočine za leče', 'Otopine za leće'],
    'optical-lenses': ['Optical lenses', 'Korekcijska stekla', 'Dioptrijske leće'],
    'eye-exams': ['Eye exams', 'Pregledi vida', 'Pregledi vida']
  };
  const CHANNELS = { store: ['Store', 'Trgovina', 'Prodavaonica'], eshop: ['E-shop', 'Spletna trgovina', 'Web-trgovina'], mkt: ['Marketplace', 'Spletna tržnica', 'Online tržnica'] };
  const SOURCES = { 'google-ads': ['Google Ads', 'Google Ads', 'Google Ads'], meta: ['Meta', 'Meta', 'Meta'], organic: ['Organic', 'Organsko', 'Organski'], email: ['Email', 'E-pošta', 'E-pošta'], direct: ['Direct', 'Neposredno', 'Izravno'] };
  const LI = { en: 0, sl: 1, hr: 2 };
  const pick = (table, id, lang, fallback) => (table[id] ? table[id][LI[lang] || 0] : fallback || id);

  const T = {
    en: {
      brand: 'Clearfigure · management report · demo data', title: 'Monthly report', mtd: '(month to date)', sameDays: ' (same days)',
      compared: (a, b) => 'compared with ' + a + ' and ' + b, lyNone: 'last year (no data)', generated: 'Generated',
      summary: 'Summary', key: 'Key figures', top: 'Top locations', bottom: 'Bottom locations', cats: 'Category mix', mk: 'Marketing efficiency', alerts: 'Notable alerts',
      noEshop: 'No e-shop in the current filter.', noAlerts: 'No unusual days or weeks were detected.',
      foot: g => 'Targets: last year +' + g + ' % unless edited. Figures are fictional demo data generated in the browser.',
      metric: 'Metric', actual: 'Actual', prevMonth: 'Prev. month', lastYear: 'Last year', target: 'Target', location: 'Location', revenue: 'Revenue', yoy: 'YoY',
      attainment: 'Attainment', category: 'Category', share: 'Share', margin: 'Margin', source: 'Source', spend: 'Spend', total: 'Total', allSources: 'All sources',
      kpi: { rev: 'Revenue', gm: 'Gross margin', orders: 'Orders', aov: 'Avg order value', units: 'Units sold', rr: 'Return rate', newC: 'New customers', sessions: 'E-shop sessions', cr: 'E-shop conversion', spend: 'Marketing spend', roas: 'ROAS (blended)' },
      allLocs: 'All locations', SI: 'Slovenia', HR: 'Croatia', allIn: c => c + ' · all locations', nLocs: n => n + ' locations', allCh: 'All channels', allCats: 'All categories',
      sev: { high: 'High', medium: 'Medium', low: 'Low', info: 'Expected' }, pp: 'pp', page: (i, n) => 'Page ' + i + ' of ' + n,
      email: {
        subject: (mon) => 'Monthly report – ' + mon + ' (Clearfigure)', hello: 'Hello,', intro: (mon, r, mtd) => 'attached is the management report for ' + mon + ' (' + r + (mtd ? ', month to date' : '') + ').',
        sumLabel: 'Summary:', bye: 'Best regards', note: 'The figures are fictional demo data.', file: 'Clearfigure-monthly-report'
      }
    },
    sl: {
      brand: 'Clearfigure · poslovno poročilo · demo podatki', title: 'Mesečno poročilo', mtd: '(od začetka meseca do danes)', sameDays: ' (enako število dni)',
      compared: (a, b) => 'primerjava: ' + a + ' in ' + b, lyNone: 'lani (ni podatkov)', generated: 'Pripravljeno',
      summary: 'Povzetek', key: 'Ključni podatki', top: 'Najboljše lokacije', bottom: 'Najšibkejše lokacije', cats: 'Prodaja po kategorijah', mk: 'Učinkovitost oglaševanja', alerts: 'Opazna odstopanja',
      noEshop: 'V izbranem filtru ni spletne trgovine.', noAlerts: 'Ni bilo neobičajnih dni ali tednov.',
      foot: g => 'Cilji: isti mesec lani +' + g + ' %, če niso urejeni ročno. Številke so izmišljeni demo podatki, ustvarjeni v brskalniku.',
      metric: 'Kazalnik', actual: 'Dejansko', prevMonth: 'Prejšnji mesec', lastYear: 'Lani', target: 'Cilj', location: 'Lokacija', revenue: 'Prihodki', yoy: 'Medletno',
      attainment: 'Doseganje cilja', category: 'Kategorija', share: 'Delež', margin: 'Marža', source: 'Vir', spend: 'Strošek', total: 'Skupaj', allSources: 'Vsi viri',
      kpi: { rev: 'Prihodki', gm: 'Bruto marža', orders: 'Naročila', aov: 'Povprečna vrednost naročila', units: 'Prodani kosi', rr: 'Delež vračil', newC: 'Novi kupci', sessions: 'Obiski spletne trgovine', cr: 'Konverzija spletne trgovine', spend: 'Stroški oglaševanja', roas: 'ROAS (skupaj)' },
      allLocs: 'Vse lokacije', SI: 'Slovenija', HR: 'Hrvaška', allIn: c => c + ' · vse lokacije', nLocs: n => 'Lokacije: ' + n, allCh: 'Vsi kanali', allCats: 'Vse kategorije',
      sev: { high: 'Visoka', medium: 'Srednja', low: 'Nizka', info: 'Pričakovano' }, pp: 'o. t.', page: (i, n) => 'Stran ' + i + ' od ' + n,
      email: {
        subject: (mon) => 'Mesečno poročilo – ' + mon + ' (Clearfigure)', hello: 'Pozdravljeni,', intro: (mon, r, mtd) => 'v prilogi je mesečno poslovno poročilo za ' + mon + ' (' + r + (mtd ? ', od začetka meseca do danes' : '') + ').',
        sumLabel: 'Povzetek:', bye: 'Lep pozdrav', note: 'Številke so izmišljeni demo podatki.', file: 'Clearfigure-mesecno-porocilo'
      }
    },
    hr: {
      brand: 'Clearfigure · upravljačko izvješće · demo podaci', title: 'Mjesečno izvješće', mtd: '(od početka mjeseca do danas)', sameDays: ' (isti broj dana)',
      compared: (a, b) => 'usporedba: ' + a + ' i ' + b, lyNone: 'prošla godina (nema podataka)', generated: 'Izrađeno',
      summary: 'Sažetak', key: 'Ključni pokazatelji', top: 'Najbolje lokacije', bottom: 'Najslabije lokacije', cats: 'Prodaja po kategorijama', mk: 'Učinkovitost oglašavanja', alerts: 'Značajna odstupanja',
      noEshop: 'U odabranom filtru nema web-trgovine.', noAlerts: 'Nije bilo neuobičajenih dana ni tjedana.',
      foot: g => 'Ciljevi: isti mjesec prošle godine +' + g + ' %, osim ako su ručno izmijenjeni. Brojke su izmišljeni demo podaci izrađeni u pregledniku.',
      metric: 'Pokazatelj', actual: 'Ostvareno', prevMonth: 'Prethodni mjesec', lastYear: 'Prošla godina', target: 'Cilj', location: 'Lokacija', revenue: 'Prihod', yoy: 'Međugodišnje',
      attainment: 'Ostvarenje cilja', category: 'Kategorija', share: 'Udio', margin: 'Marža', source: 'Izvor', spend: 'Trošak', total: 'Ukupno', allSources: 'Svi izvori',
      kpi: { rev: 'Prihod', gm: 'Bruto marža', orders: 'Narudžbe', aov: 'Prosječna vrijednost narudžbe', units: 'Prodani komadi', rr: 'Stopa povrata', newC: 'Novi kupci', sessions: 'Posjeti web-trgovini', cr: 'Konverzija web-trgovine', spend: 'Troškovi oglašavanja', roas: 'ROAS (ukupno)' },
      allLocs: 'Sve lokacije', SI: 'Slovenija', HR: 'Hrvatska', allIn: c => c + ' · sve lokacije', nLocs: n => 'Lokacije: ' + n, allCh: 'Svi kanali', allCats: 'Sve kategorije',
      sev: { high: 'Visoka', medium: 'Srednja', low: 'Niska', info: 'Očekivano' }, pp: 'p. b.', page: (i, n) => 'Stranica ' + i + ' od ' + n,
      email: {
        subject: (mon) => 'Mjesečno izvješće – ' + mon + ' (Clearfigure)', hello: 'Poštovani,', intro: (mon, r, mtd) => 'u privitku je mjesečno upravljačko izvješće za ' + mon + ' (' + r + (mtd ? ', od početka mjeseca do danas' : '') + ').',
        sumLabel: 'Sažetak:', bye: 'Lijep pozdrav', note: 'Brojke su izmišljeni demo podaci.', file: 'Clearfigure-mjesecno-izvjesce'
      }
    }
  };
  const lang0 = l => (LANGS.includes(l) ? l : 'en');
  const t = l => T[lang0(l)];
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const monthName = (lang, y, m) => MONTHS[lang0(lang)][m] + ' ' + y;
  const monthTitle = (lang, y, m) => cap(monthName(lang, y, m));
  const catName = (lang, id) => pick(CATS, id, lang0(lang));
  const chName = (lang, id) => pick(CHANNELS, id, lang0(lang));
  const srcName = (lang, id) => pick(SOURCES, id, lang0(lang));
  // a change in percentage points: "+0,4 pp" / "+0,4 o. t." / "+0,4 p. b." (d = difference of two fractions)
  const ppTxt = (lang, d) => (fin(d) ? (d >= 0 ? '+' : MINUS) + NF1.format(Math.abs(d * 100)) + NB + t(lang).pp : '—');

  // ── Scope line ("All locations · All channels · All categories") ─────────────
  function scopeText(scope, lang) {
    const L = t(lang), s = scope || {};
    const where = !s.locNames ? (s.co === 'SI' || s.co === 'HR' ? L.allIn(L[s.co]) : L.allLocs) : (s.locNames.length <= 3 ? s.locNames.join(', ') : L.nLocs(s.locNames.length));
    return [where, s.ch ? chName(lang, s.ch) : L.allCh, s.cat ? catName(lang, s.cat) : L.allCats].join(' · ');
  }

  // ── Alerts (structured in app.js: a.tr = what happened, a.lp = where) ───────
  function alertLabel(lp, lang) {
    if (!lp) return '';
    const l = lang0(lang);
    if (lp.k === 'loc') return lp.loc;
    if (lp.k === 'combo') return lp.loc + ' · ' + catName(l, lp.cat) + (lp.ch && lp.ch !== 'store' ? ' (' + chName(l, lp.ch) + ')' : '');
    if (lp.k === 'cat') return catName(l, lp.cat) + ({ en: ' (all locations)', sl: ' (vse lokacije)', hr: ' (sve lokacije)' }[l]);
    if (lp.k === 'ch') return l === 'en' ? chName(l, lp.ch) + ' channel' : 'Kanal: ' + chName(l, lp.ch);
    if (lp.k === 'roas') return lp.loc + ' · ' + srcName(l, lp.src);
    return '';
  }
  function alertTitle(tr, lang) {
    if (!tr) return '';
    const l = lang0(lang), up = tr.dir > 0;
    if (tr.t === 'day') {
      if (l === 'sl') return (up ? 'Skok' : 'Padec') + ' prihodkov: ' + F.pct0(tr.p) + (up ? ' nad' : ' pod') + ' običajnim dnem (' + WEEKDAYS.sl[tr.wd] + ')';
      if (l === 'hr') return (up ? 'Skok' : 'Pad') + ' prihoda: ' + F.pct0(tr.p) + (up ? ' iznad' : ' ispod') + ' uobičajenog dana (' + WEEKDAYS.hr[tr.wd] + ')';
      return 'Revenue ' + (up ? 'spike' : 'drop') + ': ' + F.pct0(tr.p) + ' ' + (up ? 'above' : 'below') + ' a typical ' + WD_EN[tr.wd];
    }
    if (tr.t === 'week') {
      if (l === 'sl') return 'Tedenski prihodki ' + (up ? 'višji' : 'nižji') + ' za ' + F.pct0(tr.p) + ' glede na prejšnjih 8 tednov';
      if (l === 'hr') return 'Tjedni prihod ' + (up ? 'viši' : 'niži') + ' za ' + F.pct0(tr.p) + ' u odnosu na prethodnih 8 tjedana';
      return 'Weekly revenue ' + (up ? 'up' : 'down') + ' ' + F.pct0(tr.p) + ' vs the previous 8 weeks';
    }
    if (tr.t === 'ret') {
      if (l === 'sl') return 'Skok deleža vračil: ' + F.pct(tr.x) + ' (običajno ' + F.pct(tr.m) + ')';
      if (l === 'hr') return 'Skok stope povrata: ' + F.pct(tr.x) + ' (uobičajeno ' + F.pct(tr.m) + ')';
      return 'Return-rate spike: ' + F.pct(tr.x) + ' vs usual ' + F.pct(tr.m);
    }
    if (tr.t === 'roas') {
      if (l === 'sl') return 'Padec ROAS: ' + F.x(tr.x) + ' (običajno ' + F.x(tr.m) + ')';
      if (l === 'hr') return 'Pad ROAS-a: ' + F.x(tr.x) + ' (uobičajeno ' + F.x(tr.m) + ')';
      return 'ROAS drop: ' + F.x(tr.x) + ' vs usual ' + F.x(tr.m);
    }
    return '';
  }
  // lower-case the first letter inside a sentence, but keep acronyms ("ROAS drop" stays)
  const lcFirst = s => (/^[A-ZČŠŽĆĐ][A-ZČŠŽĆĐ]/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1));
  const alertWhen = a => (a.d0 && a.d0 !== a.d1 ? dmy(a.d0, false) + ' – ' + dmy(a.d1) : dmy(a.d1));

  // ── Commentary (the summary bullets) ───────────────────────────────────────
  // m: the model app.js builds (see buildReportModel there); returns plain-text sentences.
  function commentary(m, lang) {
    const l = lang0(lang), L = t(l), K = kpiMap(m), out = [];
    const rev = K.rev || {}, mon = mi => (mi ? monthName(l, mi.y, mi.m) : '');
    const vsLy = chg(rev.v, rev.l), vsPm = chg(rev.v, rev.p);
    if (l === 'en') {
      const up = v => (v >= 0 ? 'up ' : 'down ') + NF1.format(Math.abs(v * 100)) + NB + '%';
      out.push('Revenue ' + (m.mtd ? 'month to date ' : '') + 'was ' + F.eur(rev.v) + (fin(vsLy) ? ', ' + up(vsLy) + ' on ' + mon(m.lyMonth) : '') +
        (fin(vsPm) ? (fin(vsLy) ? ' and ' : ', ') + up(vsPm) + ' on ' + mon(m.pmMonth) + (m.mtd ? L.sameDays : '') : '') + '.');
    } else {
      const more = v => NF1.format(Math.abs(v * 100)) + NB + '% ' + (l === 'sl' ? (v >= 0 ? 'več' : 'manj') : (v >= 0 ? 'više' : 'manje'));
      const parts = [];
      if (fin(vsLy)) parts.push(more(vsLy) + (l === 'sl' ? ' kot v istem mesecu lani' : ' nego u istom mjesecu prošle godine'));
      if (fin(vsPm)) parts.push(more(vsPm) + (l === 'sl' ? ' kot v prejšnjem mesecu' : ' nego u prethodnom mjesecu') + (m.mtd ? L.sameDays : ''));
      out.push(l === 'sl'
        ? 'Prihodki ' + (m.mtd ? 'od začetka meseca ' : '') + 'so znašali ' + F.eur(rev.v) + (parts.length ? ', kar je ' + parts.join(' in ') : '') + '.'
        : 'Prihod ' + (m.mtd ? 'od početka mjeseca ' : '') + 'iznosio je ' + F.eur(rev.v) + (parts.length ? ', što je ' + parts.join(' i ') : '') + '.');
    }
    if (fin(rev.tg) && rev.tg > 0) {
      const att = div(rev.v, rev.tg), gap = F.eur(Math.abs(rev.v - rev.tg)), ahead = rev.v >= rev.tg;
      out.push(l === 'sl' ? 'To je ' + F.pct0(att) + ' cilja; ' + (ahead ? 'cilj je presežen za ' : 'do cilja manjka ') + gap + '.'
        : l === 'hr' ? 'To je ' + F.pct0(att) + ' cilja; ' + (ahead ? 'cilj je premašen za ' : 'do cilja nedostaje ') + gap + '.'
          : 'That is ' + F.pct0(att) + ' of target, ' + (ahead ? 'ahead by ' : 'short by ') + gap + '.');
    }
    const gm = K.gm || {};
    if (fin(gm.v) && fin(gm.l)) {
      const d = NF1.format(Math.abs(gm.v - gm.l) * 100), better = gm.v >= gm.l, tg = fin(gm.tg) ? ' (' + (l === 'en' ? 'target ' : 'cilj ') + F.pct(gm.tg) + ')' : '';
      out.push(l === 'sl' ? 'Bruto marža se je medletno ' + (better ? 'izboljšala' : 'znižala') + ' za ' + d + NB + 'o. t. na ' + F.pct(gm.v) + tg + '.'
        : l === 'hr' ? 'Bruto marža je međugodišnje ' + (better ? 'porasla' : 'pala') + ' za ' + d + NB + 'p. b. na ' + F.pct(gm.v) + tg + '.'
          : 'Gross margin ' + (better ? 'improved' : 'slipped') + ' ' + d + ' pp year on year to ' + F.pct(gm.v) + tg + '.');
    }
    if (m.top && m.top.length && m.bottom && m.bottom.length) {
      const b0 = m.top[0], w0 = m.bottom[0];
      const why = x => (m.rankKey === 'att' ? F.pct0(x.att) + ' ' + (l === 'en' ? 'of target' : 'cilja') : l === 'en' ? (x.yoy >= 0 ? 'up ' : 'down ') + NF1.format(Math.abs(x.yoy * 100)) + NB + '% YoY' : signedPct(x.yoy) + ' ' + L.yoy.toLowerCase());
      out.push(l === 'sl' ? 'Najboljša lokacija: ' + b0.name + ' (' + why(b0) + '); najšibkejša: ' + w0.name + ' (' + why(w0) + ').'
        : l === 'hr' ? 'Najbolja lokacija: ' + b0.name + ' (' + why(b0) + '); najslabija: ' + w0.name + ' (' + why(w0) + ').'
          : 'Strongest location: ' + b0.name + ' (' + why(b0) + '); weakest: ' + w0.name + ' (' + why(w0) + ').');
    }
    if (m.cats && m.cats.length) {
      const big = m.cats.slice().sort((p, q) => q.rev - p.rev)[0], grow = m.cats.length > 1 ? m.cats.filter(x => fin(x.yoy)).sort((p, q) => q.yoy - p.yoy)[0] : null;
      const bn = catName(l, big.id), gn = grow ? catName(l, grow.id) : '';
      if (l === 'sl') out.push('Največja kategorija: ' + bn + ' (' + F.pct(big.share) + ' prihodkov)' + (grow ? '; najhitrejša rast: ' + gn + ' (' + signedPct(grow.yoy) + ' medletno).' : '.'));
      else if (l === 'hr') out.push('Najveća kategorija: ' + bn + ' (' + F.pct(big.share) + ' prihoda)' + (grow ? '; najbrži rast: ' + gn + ' (' + signedPct(grow.yoy) + ' međugodišnje).' : '.'));
      else out.push(bn + ' was the largest category (' + F.pct(big.share) + ' of revenue)' + (grow ? '; fastest growth: ' + gn + ' (' + (grow.yoy >= 0 ? 'up ' : 'down ') + NF1.format(Math.abs(grow.yoy * 100)) + NB + '% YoY).' : '.'));
    }
    if (m.mk && m.mkTot && m.mkTot.spend > 0) {
      const g = m.mk.find(x => x.id === 'google-ads'), me = m.mk.find(x => x.id === 'meta');
      const det = '(Google Ads ' + F.x(g ? div(g.rev, g.spend) : NaN) + ', Meta ' + F.x(me ? div(me.rev, me.spend) : NaN) + ')';
      const roas = div(m.mkTot.rev, m.mkTot.spend);
      out.push(l === 'sl' ? 'Skupni ROAS je bil ' + F.x(roas) + ' pri ' + F.eur(m.mkTot.spend) + ' stroškov oglaševanja ' + det + '.'
        : l === 'hr' ? 'Ukupni ROAS bio je ' + F.x(roas) + ' uz ' + F.eur(m.mkTot.spend) + ' troškova oglašavanja ' + det + '.'
          : 'Blended ROAS was ' + F.x(roas) + ' on ' + F.eur(m.mkTot.spend) + ' marketing spend ' + det + '.');
    }
    const rr = K.rr || {};
    if (fin(rr.v)) {
      const d = fin(rr.l) ? ppTxt(l, rr.v - rr.l) : '';
      out.push(l === 'sl' ? 'Delež vračil: ' + F.pct(rr.v) + (d ? ' (' + d + ' glede na lani)' : '') + '.'
        : l === 'hr' ? 'Stopa povrata: ' + F.pct(rr.v) + (d ? ' (' + d + ' u odnosu na prošlu godinu)' : '') + '.'
          : 'Return rate ' + F.pct(rr.v) + (d ? ' (' + d + ' vs last year)' : '') + '.');
    }
    const al = m.alerts || [];
    if (al.length) {
      const a = al[0], what = lcFirst(alertTitle(a.tr, l)), where = alertLabel(a.lp, l), when = alertWhen(a);
      out.push(l === 'sl' ? 'Opazna odstopanja: ' + al.length + '; najizrazitejše: ' + what + ' – ' + where + ' (' + when + ').'
        : l === 'hr' ? 'Značajna odstupanja: ' + al.length + '; najizraženije: ' + what + ' – ' + where + ' (' + when + ').'
          : al.length + ' notable alert' + (al.length > 1 ? 's' : '') + '; most notable: ' + what + ' at ' + where + ' (' + when + ').');
    } else out.push(L.noAlerts);
    return out;
  }
  function kpiMap(m) { const o = {}; (m.kpis || []).forEach(k => { o[k.k] = k; }); return o; }

  // ── Table cells shared by the page and the PDF ──────────────────────────────
  // delta of a key figure against a reference: { txt, cls: 'good' | 'bad' | 'flat' }
  function kpiDelta(k, ref, lang) {
    if (!fin(k.v) || !fin(ref)) return { txt: '—', cls: 'flat' };
    if (k.pp) { const d = k.v - ref; return { txt: ppTxt(lang, d), cls: Math.abs(d) < 0.0005 ? 'flat' : (d > 0) !== !!k.inv ? 'good' : 'bad' }; }
    const c = chg(k.v, ref);
    if (!fin(c)) return { txt: '—', cls: 'flat' };
    return { txt: signedPct(c), cls: Math.abs(c) < 0.0005 ? 'flat' : (c > 0) !== !!k.inv ? 'good' : 'bad' };
  }
  const fmtKpi = (k, v) => (F[k.t] || F.int)(v);
  function headerLine(m, lang) {
    const L = t(lang);
    return range(m.a, m.b) + ' · ' + scopeText(m.scope, lang) + ' · ' + L.compared(m.prev ? range(m.prev[0], m.prev[1]) : '—', m.ly ? range(m.ly[0], m.ly[1]) : L.lyNone);
  }

  // ── PDF (pdfmake document definition, A4) ───────────────────────────────────
  function pdfDoc(m, lang) {
    const l = lang0(lang), L = t(l);
    const C = { ink: '#1A1A1A', muted: '#616161', line: '#DDDDDD', good: '#1E7F4F', bad: '#B42318', head: '#F3F3F3', accent: '#1F5199' };
    const th = s => ({ text: s, bold: true, fontSize: 7.5, color: C.muted, fillColor: C.head });
    const thr = s => Object.assign(th(s), { alignment: 'right' });
    const num = (s, extra) => Object.assign({ text: s, alignment: 'right', noWrap: true }, extra || {});
    const dl = d => num(d.txt, { color: d.cls === 'good' ? C.good : d.cls === 'bad' ? C.bad : C.muted });
    const layout = { hLineWidth: (i, node) => (i === 0 || i === node.table.body.length ? 0 : 0.5), vLineWidth: () => 0, hLineColor: () => C.line, paddingLeft: () => 4, paddingRight: () => 4, paddingTop: () => 3, paddingBottom: () => 3 };
    const sec = s => ({ text: s.toUpperCase(), fontSize: 7.5, bold: true, color: C.muted, characterSpacing: 0.6, margin: [0, 12, 0, 5] });
    const kRows = (m.kpis || []).map(k => [L.kpi[k.k] || k.k, num(fmtKpi(k, k.v), { bold: true }), num(fmtKpi(k, k.p)), dl(kpiDelta(k, k.p, l)), num(fmtKpi(k, k.l)), dl(kpiDelta(k, k.l, l)), num(fmtKpi(k, k.tg)), dl(kpiDelta(k, k.tg, l))]);
    const locTable = list => ({ fontSize: 8, table: { headerRows: 1, widths: ['*', 'auto', 'auto', 'auto'], body: [[th(L.location), thr(L.revenue), thr(L.yoy), thr(L.attainment)]].concat(list.length ? list.map(x => [x.name, num(F.eur(x.act)), num(signedPct(x.yoy)), num(F.pct(x.att))]) : [[{ text: '—', colSpan: 4 }, '', '', '']]) }, layout });
    const catBody = [[th(L.category), thr(L.revenue), thr(L.share), thr(L.yoy), thr(L.margin)]].concat((m.cats || []).map(x => [catName(l, x.id), num(F.eur(x.rev)), num(F.pct(x.share)), num(signedPct(x.yoy)), num(F.pct(x.gm))]));
    if (m.catTot) catBody.push([{ text: L.total, bold: true }, num(F.eur(m.catTot.rev), { bold: true }), num(F.pct(1)), num(signedPct(m.catTot.yoy)), num(F.pct(m.catTot.gm))]);
    let mkBlock;
    if (m.mk) {
      const body = [[th(L.source), thr(L.spend), thr(L.revenue), thr('ROAS'), thr('CPA')]].concat(m.mk.map(x => [srcName(l, x.id), num(x.spend ? F.eur(x.spend) : '—'), num(F.eur(x.rev)), num(x.spend ? F.x(div(x.rev, x.spend)) : '—'), num(x.spend ? F.eur2(div(x.spend, x.orders)) : '—')]));
      if (m.mkTot) body.push([{ text: L.allSources, bold: true }, num(F.eur(m.mkTot.spend), { bold: true }), num(F.eur(m.mkTot.rev)), num(F.x(div(m.mkTot.rev, m.mkTot.spend))), num(F.eur2(div(m.mkTot.spend, m.mkTot.orders)))]);
      mkBlock = { fontSize: 8, table: { headerRows: 1, widths: ['*', 'auto', 'auto', 'auto', 'auto'], body }, layout };
    } else mkBlock = { text: L.noEshop, color: C.muted };
    const alerts = (m.alerts || []).length
      ? { ul: m.alerts.map(a => ({ text: [{ text: (L.sev[a.sev] || a.sev) + '  ', bold: true, color: a.sev === 'high' ? C.bad : C.muted }, { text: alertLabel(a.lp, l), bold: true }, ' · ' + alertTitle(a.tr, l) + ' ', { text: '(' + alertWhen(a) + ')', color: C.muted }] })), margin: [0, 0, 0, 0] }
      : { text: L.noAlerts, color: C.muted };
    return {
      pageSize: 'A4', pageMargins: [40, 44, 40, 48],
      info: { title: L.title + ' – ' + monthName(l, m.y, m.m), author: 'Clearfigure', subject: L.brand },
      defaultStyle: { font: 'Roboto', fontSize: 8.8, color: C.ink, lineHeight: 1.2 },
      footer: (i, n) => ({ columns: [{ text: L.foot(F.num1(m.growth).replace(/,0$/, '')), fontSize: 7, color: C.muted }, { text: L.page(i, n), alignment: 'right', fontSize: 7, color: C.muted, width: 90 }], margin: [40, 12, 40, 0] }),
      content: [
        { columns: [{ text: L.brand, fontSize: 7.5, bold: true, color: C.accent, characterSpacing: 0.4 }, { text: L.generated + ' ' + dmy(m.generated), alignment: 'right', fontSize: 7.5, color: C.muted, width: 140 }] },
        { text: [monthTitle(l, m.y, m.m), m.mtd ? { text: '  ' + L.mtd, fontSize: 11, color: C.muted, bold: false } : ''], fontSize: 20, bold: true, margin: [0, 6, 0, 2] },
        { text: headerLine(m, l), fontSize: 8, color: C.muted, margin: [0, 0, 0, 2] },
        sec(L.summary),
        { ul: commentary(m, l), margin: [0, 0, 0, 0] },
        sec(L.key),
        { table: { headerRows: 1, widths: ['*', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto'], body: [[th(L.metric), thr(L.actual), thr(L.prevMonth), thr('Δ'), thr(L.lastYear), thr('Δ'), thr(L.target), thr('Δ')]].concat(kRows) }, layout },
        { columns: [[sec(L.top), locTable(m.top || [])], [sec(L.bottom), locTable(m.bottom || [])]], columnGap: 18 },
        { columns: [[sec(L.cats), { fontSize: 8, table: { headerRows: 1, widths: ['*', 'auto', 'auto', 'auto', 'auto'], body: catBody }, layout }], [sec(L.mk), mkBlock]], columnGap: 18 },
        sec(L.alerts), alerts
      ]
    };
  }

  // ── E-mail: subject, plain-text body and the .eml file ──────────────────────
  function emailParts(m, lang) {
    const l = lang0(lang), E = t(l).email, mon = monthName(l, m.y, m.m);
    const lines = commentary(m, l);
    const body = [E.hello, '', E.intro(mon, range(m.a, m.b), m.mtd), '', E.sumLabel].concat(lines.map(s => '• ' + s), ['', E.note, '', E.bye, '']).join('\r\n');
    const base = E.file + '-' + m.y + '-' + String(m.m + 1).padStart(2, '0') + (m.mtd ? '-' + String(+m.b.slice(8, 10)).padStart(2, '0') : '');
    return { subject: E.subject(mon), body, pdfName: base + '.pdf', emlName: base + '.eml' };
  }
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function base64(bytes) {
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
      const a = bytes[i], b = i + 1 < bytes.length ? bytes[i + 1] : 0, c = i + 2 < bytes.length ? bytes[i + 2] : 0, n = (a << 16) | (b << 8) | c;
      out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? B64[n & 63] : '=');
    }
    return out;
  }
  const utf8 = s => new TextEncoder().encode(String(s));
  const wrap76 = s => (s.match(/.{1,76}/g) || ['']).join('\r\n');
  // RFC 2047 encoded words for a header (each word at most 75 characters; never splits a UTF-8 character)
  function encodeHeader(s) {
    s = String(s).replace(/[\r\n]+/g, ' ');
    if (/^[\x20-\x7e]*$/.test(s)) return s;
    const words = [];
    let chunk = [];
    for (const ch of s) {
      const b = Array.from(utf8(ch));
      if (chunk.length + b.length > 45) { words.push(chunk); chunk = []; }
      chunk = chunk.concat(b);
    }
    if (chunk.length) words.push(chunk);
    return words.map(w => '=?UTF-8?B?' + base64(w) + '?=').join('\r\n ');
  }
  function rfcDate(d) {
    const DN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const p = n => String(n).padStart(2, '0'), off = -d.getTimezoneOffset(), oa = Math.abs(off);
    return DN[d.getDay()] + ', ' + d.getDate() + ' ' + MN[d.getMonth()] + ' ' + d.getFullYear() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + ' ' + (off >= 0 ? '+' : '-') + p(Math.floor(oa / 60)) + p(oa % 60);
  }
  // Recipients typed by the user: "a@x.si, b@y.hr" → valid addresses only (no header injection)
  function parseRecipients(s) {
    const ok = [], bad = [];
    String(s || '').split(/[,;\s]+/).map(x => x.trim()).filter(Boolean).forEach(x => { (/^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/i.test(x) ? ok : bad).push(x); });
    return { ok, bad };
  }
  // A draft e-mail as an .eml file (RFC 5322 + MIME). "X-Unsent: 1" makes Outlook open it as a new message ready to
  // send; Apple Mail and Thunderbird open it as a message you can forward or send again. Nothing is sent from here.
  function buildEml(o) {
    const bnd = o.boundary || '=_stratum_' + Math.random().toString(16).slice(2, 12);
    const H = [];
    if (o.to && o.to.length) H.push('To: ' + o.to.join(', '));
    H.push('Subject: ' + encodeHeader(o.subject || ''));
    H.push('Date: ' + rfcDate(o.date || new Date()));
    H.push('MIME-Version: 1.0');
    H.push('X-Unsent: 1');
    H.push('Content-Type: multipart/mixed; boundary="' + bnd + '"');
    const parts = ['--' + bnd, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap76(base64(utf8(o.text || '')))];
    (o.attachments || []).forEach(a => {
      const name = String(a.filename).replace(/[^\w.\-]+/g, '_');
      parts.push('--' + bnd, 'Content-Type: ' + (a.type || 'application/octet-stream') + '; name="' + name + '"', 'Content-Transfer-Encoding: base64', 'Content-Disposition: attachment; filename="' + name + '"', '', wrap76(base64(a.bytes)));
    });
    parts.push('--' + bnd + '--', '');
    return H.join('\r\n') + '\r\n\r\n' + parts.join('\r\n');
  }

  return { LANGS, T, t, F, dmy, range, signedPct, ppTxt, monthName, monthTitle, catName, chName, srcName, scopeText, alertLabel, alertTitle, alertWhen,
    commentary, kpiDelta, fmtKpi, headerLine, pdfDoc, emailParts, base64, encodeHeader, buildEml, parseRecipients, rfcDate };
});
