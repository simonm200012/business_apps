/* Contracts & renewals: notice-of-termination letters in Slovenian, Croatian and English (pure, no DOM; UMD so
 * tools/tests/contracts-letters.test.js loads it in Node).
 *
 * The letter terminates "in accordance with the contract's termination and notice provisions" and names the end date;
 * it deliberately quotes no statute. Under both the Slovenian Obligacijski zakonik and the Croatian Zakon o obveznim
 * odnosima a notice takes effect when the other party RECEIVES it, which is why the letter is headed "registered mail
 * with return receipt" and asks for a written confirmation. The wording is a template, not legal advice: Simon should
 * have it checked once (e.g. contracts that require notice by a specific channel, e-mail, or a signature by two
 * directors). */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ContractLetters = api;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LANGS = [{ id: 'sl', name: 'Slovenščina' }, { id: 'hr', name: 'Hrvatski' }, { id: 'en', name: 'English' }];
  var MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  function dateIn(s, lang) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return '';
    var y = s.slice(0, 4), m = +s.slice(5, 7), d = +s.slice(8, 10);
    if (lang === 'en') return d + ' ' + MONTHS_EN[m - 1] + ' ' + y;
    return d + '. ' + m + '. ' + y + (lang === 'hr' ? '.' : ''); // Croatian writes a dot after the year
  }
  function money(n) {
    var s = (Math.round((+n || 0) * 100) / 100).toFixed(2).split('.');
    return s[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + s[1] + ' €';
  }
  // Slovenian has singular, dual, plural (3–4) and plural (5+); Croatian singular, paucal (2–4) and plural
  function slForm(n, f) { var r = n % 100; return r === 1 ? f[0] : r === 2 ? f[1] : r === 3 || r === 4 ? f[2] : f[3]; }
  function hrForm(n, f) { var r10 = n % 10, r100 = n % 100; return r10 === 1 && r100 !== 11 ? f[0] : r10 >= 2 && r10 <= 4 && (r100 < 12 || r100 > 14) ? f[1] : f[2]; }
  function period(n, unit, lang) {
    n = +n || 0;
    if (lang === 'sl') return n + ' ' + (unit === 'd' ? slForm(n, ['dan', 'dneva', 'dni', 'dni']) : slForm(n, ['mesec', 'meseca', 'mesece', 'mesecev']));
    if (lang === 'hr') return n + ' ' + (unit === 'd' ? hrForm(n, ['dan', 'dana', 'dana']) : hrForm(n, ['mjesec', 'mjeseca', 'mjeseci']));
    return n + ' ' + (unit === 'd' ? (n === 1 ? 'day' : 'days') : (n === 1 ? 'month' : 'months'));
  }
  function noticeText(c, lang) {
    if (!(+c.noticeN > 0)) return '';
    var p = period(c.noticeN, c.noticeUnit, lang);
    if (lang === 'sl') return 'odpovedni rok ' + p + (c.noticeEom ? ' do konca meseca' : '');
    if (lang === 'hr') return 'otkazni rok ' + p + (c.noticeEom ? ' do kraja mjeseca' : '');
    return 'notice period of ' + p + (c.noticeEom ? ' to the end of a month' : '');
  }

  var T = {
    sl: { registered: 'PRIPOROČENO S POVRATNICO', attn: 'v roke', vat: 'ID za DDV', subject: 'Zadeva: Odpoved pogodbe', hello: 'Spoštovani,', helloName: 'Spoštovani,',
      body: function (m) { return 'v imenu družbe ' + m.sender.name + ' odpovedujemo pogodbo »' + m.title + '«' + (m.no ? ' (naša oznaka ' + m.no + (m.start ? ', sklenjena ' + dateIn(m.start, 'sl') : '') + ')' : '') + ' v skladu z njenimi določili o odpovedi' + (m.notice ? ' (' + m.notice + ')' : '') + '. Pogodba preneha dne ' + dateIn(m.end, 'sl') + '.'; },
      confirm: 'Prosimo, da nam prejem odpovedi pisno potrdite in nam pošljete končni obračun do dneva prenehanja pogodbe.',
      deposit: function (m) { return 'Prosimo tudi, da nam po prenehanju pogodbe ' + (m.depositType === 'bank guarantee' ? 'vrnete bančno garancijo' : 'vrnete varščino') + ' v znesku ' + money(m.deposit) + '.'; },
      until: function (m) { return 'Do dneva prenehanja bomo svoje obveznosti iz pogodbe izpolnjevali kot doslej.'; },
      bye: 'Lep pozdrav,', page: 'Odpoved pogodbe' },
    hr: { registered: 'PREPORUČENO S POVRATNICOM', attn: 'n/p', vat: 'PDV ID', subject: 'Predmet: Otkaz ugovora', hello: 'Poštovani,', helloName: 'Poštovani,',
      body: function (m) { return 'u ime društva ' + m.sender.name + ' otkazujemo ugovor »' + m.title + '«' + (m.no ? ' (naša oznaka ' + m.no + (m.start ? ', sklopljen ' + dateIn(m.start, 'hr') : '') + ')' : '') + ' u skladu s njegovim odredbama o otkazu' + (m.notice ? ' (' + m.notice + ')' : '') + '. Ugovor prestaje s danom ' + dateIn(m.end, 'hr'); }, // the Croatian date already ends with a dot
      confirm: 'Molimo da nam primitak otkaza pisano potvrdite te nam dostavite konačni obračun do dana prestanka ugovora.',
      deposit: function (m) { return 'Molimo i da nam nakon prestanka ugovora ' + (m.depositType === 'bank guarantee' ? 'vratite bankovno jamstvo' : 'vratite jamčevinu') + ' u iznosu od ' + money(m.deposit) + '.'; },
      until: function () { return 'Do dana prestanka ugovora svoje ćemo obveze iz ugovora izvršavati kao i dosad.'; },
      bye: 'S poštovanjem,', page: 'Otkaz ugovora' },
    en: { registered: 'BY REGISTERED MAIL WITH RETURN RECEIPT', attn: 'Attn.', vat: 'VAT ID', subject: 'Subject: Notice of termination', hello: 'Dear Sir or Madam,', helloName: 'Dear',
      body: function (m) { return 'On behalf of ' + m.sender.name + ' we hereby give notice of termination of the contract “' + m.title + '”' + (m.no ? ' (our reference ' + m.no + (m.start ? ', concluded on ' + dateIn(m.start, 'en') : '') + ')' : '') + ' in accordance with its termination provisions' + (m.notice ? ' (' + m.notice + ')' : '') + '. The contract ends on ' + dateIn(m.end, 'en') + '.'; },
      confirm: 'Please confirm receipt of this notice in writing and send us the final statement up to the end date.',
      deposit: function (m) { return 'Please also ' + (m.depositType === 'bank guarantee' ? 'return the bank guarantee' : 'return the deposit') + ' of ' + money(m.deposit) + ' after the contract has ended.'; },
      until: function () { return 'Until the end date we will continue to perform our obligations under the contract.'; },
      bye: 'Yours faithfully,', byeName: 'Kind regards,', page: 'Notice of termination' }
  };

  /** model → letter parts. m: { sender: {name, address, city, vat}, recipient: {name, attn, address}, place, date, no, title,
   *  start, end, contract (for the notice period: noticeN, noticeUnit, noticeEom), deposit, depositType, withDeposit,
   *  signatory: {name, role} } */
  function noticeLetter(m, lang) {
    lang = T[lang] ? lang : 'en';
    var t = T[lang], mm = Object.assign({}, m, { notice: noticeText(m.contract || {}, lang) });
    var attn = (m.recipient && m.recipient.attn) || '';
    var hello = attn ? (lang === 'en' ? 'Dear ' + attn + ',' : t.helloName) : t.hello;
    var paras = [t.body(mm), t.until(mm), t.confirm];
    if (m.withDeposit && +m.deposit > 0) paras.push(t.deposit(mm));
    var s = m.sender || {}, r = m.recipient || {};
    return {
      lang: lang, title: t.page,
      sender: [s.name, s.address, s.city, s.vat ? t.vat + ': ' + s.vat : ''].filter(Boolean),
      registered: t.registered,
      recipient: [r.name, attn ? t.attn + ' ' + attn : '', r.address].join('\n').split('\n').map(function (x) { return x.trim(); }).filter(Boolean),
      placeDate: (m.place ? m.place + ', ' : '') + dateIn(m.date, lang),
      subject: t.subject + (m.no ? ' ' + m.no : '') + ' – ' + m.title,
      hello: hello, paragraphs: paras, bye: attn && lang === 'en' ? t.byeName : t.bye,
      signature: [(m.signatory && m.signatory.name) || '', (m.signatory && m.signatory.role) || '', s.name].filter(Boolean)
    };
  }
  /** the letter as plain text (for e-mail or copy-paste) */
  function letterText(L) {
    return L.sender.join('\n') + '\n\n' + L.registered + '\n\n' + L.recipient.join('\n') + '\n\n' + L.placeDate + '\n\n' + L.subject + '\n\n' + L.hello + '\n\n' + L.paragraphs.join('\n\n') + '\n\n' + L.bye + '\n\n\n' + L.signature.join('\n') + '\n';
  }
  /** default language: the counterparty's country if known, else our company's */
  function defaultLang(ourCountry, partyCountry) { var c = partyCountry || ourCountry; return c === 'SI' ? 'sl' : c === 'HR' ? 'hr' : 'en'; }

  return { LANGS: LANGS, noticeLetter: noticeLetter, letterText: letterText, dateIn: dateIn, period: period, noticeText: noticeText, defaultLang: defaultLang, money: money };
}));
