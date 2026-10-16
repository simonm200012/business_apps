/* Parcels & COD: ready messages to the customer for parcels in the exception queue, in Slovenian, Croatian and English.
 * Pure functions: the app fills the placeholders and opens the person's own mail or SMS app (mailto: / sms: links);
 * nothing is sent from the browser. Browser: window.ParcelsMessages. Node (tests): module.exports.
 * Test: node tools/tests/parcels-messages.test.js
 *
 * Placeholders: {first} {name} {order} {tracking} {carrier} {point} {deadline} {eta} {cod} {shop} {contact} {what}
 * Optional parts: {?cod}…{/cod} only when the parcel is cash on delivery, {?prepaid}…{/prepaid} only when it is not,
 * {?contact}…{/contact} only when the shop has a contact line. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ParcelsMessages = api;
})(this, function () {
  'use strict';

  var LANGS = [['sl', 'Slovenščina'], ['hr', 'Hrvatski'], ['en', 'English']];
  /** message language from the customer's country (Italian customers get English) */
  function langFor(country) { return country === 'SI' ? 'sl' : country === 'HR' ? 'hr' : 'en'; }

  // kinds, in the order of the template picker; the exception rules map onto them (kindFor)
  var KINDS = [['late', 'Late / delayed'], ['failed', 'Failed delivery attempt'], ['pickup', 'Waiting at locker / pickup point'], ['returned', 'Returned to sender'], ['damaged', 'Damaged or lost']];
  /** exception rule (noscan, failed, pickup, returned, damlost, manual) + parcel status → template kind */
  function kindFor(rule, status) {
    if (rule === 'noscan') return 'late';
    if (rule === 'failed') return 'failed';
    if (rule === 'pickup') return 'pickup';
    if (rule === 'returned') return 'returned';
    if (rule === 'damlost') return 'damaged';
    if (status === 'pickup') return 'pickup';
    if (status === 'failed') return 'failed';
    if (status === 'returning' || status === 'returned') return 'returned';
    if (status === 'damaged' || status === 'lost') return 'damaged';
    return 'late';
  }

  var T = {
    sl: {
      late: {
        subject: 'Vaša pošiljka {order} zamuja',
        body: 'Pozdravljeni, {first},\n\nvaša pošiljka za naročilo {order} ({carrier}, številka za sledenje {tracking}) potuje dlje, kot smo predvideli. Pri prevozniku smo že preverili, kje je. Novi predvideni datum dostave je {eta}.{?cod} Ob prevzemu plačate {cod} (odkupnina).{/cod}\n\nZa zamudo se opravičujemo. Če imate vprašanje, preprosto odgovorite na to sporočilo.\n\nLep pozdrav,\n{shop}{?contact}\n{contact}{/contact}',
        sms: '{shop}: pošiljka {order} ({carrier} {tracking}) zamuja. Novi predvideni datum dostave: {eta}.{?cod} Odkupnina: {cod}.{/cod} Opravičujemo se.'
      },
      failed: {
        subject: 'Pošiljke {order} ni bilo mogoče dostaviti',
        body: 'Pozdravljeni, {first},\n\n{carrier} vam ni mogel dostaviti pošiljke za naročilo {order} (številka za sledenje {tracking}). Prosimo, potrdite naslov in telefonsko številko ali nam sporočite, kdaj boste doma, da se dogovorimo za ponovno dostavo.{?cod} Ob prevzemu plačate {cod} (odkupnina).{/cod}\n\nLep pozdrav,\n{shop}{?contact}\n{contact}{/contact}',
        sms: '{shop}: {carrier} vam ni mogel dostaviti pošiljke {order} ({tracking}). Odgovorite nam, kdaj boste doma, ali potrdite naslov.{?cod} Odkupnina: {cod}.{/cod}'
      },
      pickup: {
        subject: 'Pošiljka {order} vas čaka – prevzem do {deadline}',
        body: 'Pozdravljeni, {first},\n\nvaša pošiljka za naročilo {order} vas čaka na prevzemnem mestu {point}. Prevzamete jo lahko do {deadline}, potem jo {carrier} vrne nam.{?cod} Ob prevzemu plačate {cod} (odkupnina).{/cod}\n\nŠtevilka za sledenje: {tracking}\n\nLep pozdrav,\n{shop}{?contact}\n{contact}{/contact}',
        sms: '{shop}: pošiljka {order} vas čaka na prevzemnem mestu {point}. Prevzem do {deadline}.{?cod} Plačilo ob prevzemu: {cod}.{/cod} Sledenje: {tracking}'
      },
      returned: {
        subject: 'Pošiljka {order} se vrača k nam',
        body: 'Pozdravljeni, {first},\n\nvaša pošiljka za naročilo {order} ({carrier}, {tracking}) se vrača k nam, ker je ni bilo mogoče dostaviti ali prevzeti.{?cod} Odkupnine {cod} niste plačali, zato nam ne dolgujete ničesar. Če naročilo še želite, odgovorite na to sporočilo in vam ga pošljemo znova.{/cod}{?prepaid} Ko jo prejmemo, vam vrnemo denar ali pošiljko pošljemo znova – sporočite nam, kaj vam ustreza.{/prepaid}\n\nLep pozdrav,\n{shop}{?contact}\n{contact}{/contact}',
        sms: '{shop}: pošiljka {order} ({tracking}) se vrača k nam. Jo še želite? Odgovorite in vam jo pošljemo znova.'
      },
      damaged: {
        subject: 'Težava s pošiljko {order}',
        body: 'Pozdravljeni, {first},\n\n{carrier} nam je sporočil, da je vaša pošiljka za naročilo {order} ({tracking}) {what}. Opravičujemo se. Pri prevozniku smo odprli reklamacijo, vam pa takoj pošljemo novo pošiljko ali vrnemo denar – sporočite nam, kaj vam ustreza.{?cod} Odkupnine {cod} niste plačali.{/cod}\n\nLep pozdrav,\n{shop}{?contact}\n{contact}{/contact}',
        sms: '{shop}: pošiljka {order} ({tracking}) je {what}. Pošljemo novo ali vrnemo denar – odgovorite, kaj vam ustreza.'
      },
      what: { damaged: 'poškodovana', lost: 'izgubljena' }
    },
    hr: {
      late: {
        subject: 'Vaša pošiljka {order} kasni',
        body: 'Dobar dan, {first},\n\nvaša pošiljka za narudžbu {order} ({carrier}, broj za praćenje {tracking}) putuje dulje nego što smo predvidjeli. Već smo kod prijevoznika provjerili gdje se nalazi. Novi očekivani datum dostave je {eta}.{?cod} Pri preuzimanju plaćate {cod} (otkupnina).{/cod}\n\nIspričavamo se zbog kašnjenja. Ako imate pitanje, jednostavno odgovorite na ovu poruku.\n\nLijep pozdrav,\n{shop}{?contact}\n{contact}{/contact}',
        sms: '{shop}: pošiljka {order} ({carrier} {tracking}) kasni. Novi očekivani datum dostave: {eta}.{?cod} Otkupnina: {cod}.{/cod} Ispričavamo se.'
      },
      failed: {
        subject: 'Pošiljku {order} nije bilo moguće dostaviti',
        body: 'Dobar dan, {first},\n\n{carrier} vam nije uspio dostaviti pošiljku za narudžbu {order} (broj za praćenje {tracking}). Molimo potvrdite adresu i broj telefona ili nam javite kada ste kod kuće kako bismo dogovorili ponovnu dostavu.{?cod} Pri preuzimanju plaćate {cod} (otkupnina).{/cod}\n\nLijep pozdrav,\n{shop}{?contact}\n{contact}{/contact}',
        sms: '{shop}: {carrier} vam nije uspio dostaviti pošiljku {order} ({tracking}). Javite nam kada ste kod kuće ili potvrdite adresu.{?cod} Otkupnina: {cod}.{/cod}'
      },
      pickup: {
        subject: 'Pošiljka {order} čeka vas – preuzimanje do {deadline}',
        body: 'Dobar dan, {first},\n\nvaša pošiljka za narudžbu {order} čeka vas na mjestu preuzimanja {point}. Možete je preuzeti do {deadline}, nakon toga je {carrier} vraća nama.{?cod} Pri preuzimanju plaćate {cod} (otkupnina).{/cod}\n\nBroj za praćenje: {tracking}\n\nLijep pozdrav,\n{shop}{?contact}\n{contact}{/contact}',
        sms: '{shop}: pošiljka {order} čeka vas na mjestu preuzimanja {point}. Preuzimanje do {deadline}.{?cod} Plaćanje pri preuzimanju: {cod}.{/cod} Praćenje: {tracking}'
      },
      returned: {
        subject: 'Pošiljka {order} vraća se nama',
        body: 'Dobar dan, {first},\n\nvaša pošiljka za narudžbu {order} ({carrier}, {tracking}) vraća se nama jer je nije bilo moguće dostaviti ili preuzeti.{?cod} Otkupninu od {cod} niste platili pa nam ništa ne dugujete. Ako narudžbu još želite, odgovorite na ovu poruku i ponovno ćemo je poslati.{/cod}{?prepaid} Kad je zaprimimo, vratit ćemo vam novac ili ponovno poslati pošiljku – javite nam što vam odgovara.{/prepaid}\n\nLijep pozdrav,\n{shop}{?contact}\n{contact}{/contact}',
        sms: '{shop}: pošiljka {order} ({tracking}) vraća se nama. Želite li je još? Odgovorite i ponovno ćemo je poslati.'
      },
      damaged: {
        subject: 'Problem s pošiljkom {order}',
        body: 'Dobar dan, {first},\n\n{carrier} nas je obavijestio da je vaša pošiljka za narudžbu {order} ({tracking}) {what}. Ispričavamo se. Kod prijevoznika smo otvorili reklamaciju, a vama odmah šaljemo novu pošiljku ili vraćamo novac – javite nam što vam odgovara.{?cod} Otkupninu od {cod} niste platili.{/cod}\n\nLijep pozdrav,\n{shop}{?contact}\n{contact}{/contact}',
        sms: '{shop}: pošiljka {order} ({tracking}) je {what}. Šaljemo novu ili vraćamo novac – odgovorite što vam odgovara.'
      },
      what: { damaged: 'oštećena', lost: 'izgubljena' }
    },
    en: {
      late: {
        subject: 'Your parcel {order} is delayed',
        body: 'Hello {first},\n\nYour parcel for order {order} ({carrier}, tracking number {tracking}) is taking longer than we expected. We have already checked with the carrier where it is. The new expected delivery date is {eta}.{?cod} You pay {cod} on delivery (cash on delivery).{/cod}\n\nWe are sorry for the delay. If you have a question, just reply to this message.\n\nKind regards,\n{shop}{?contact}\n{contact}{/contact}',
        sms: '{shop}: parcel {order} ({carrier} {tracking}) is delayed. New expected delivery date: {eta}.{?cod} Cash on delivery: {cod}.{/cod} Sorry for the wait.'
      },
      failed: {
        subject: 'We could not deliver your parcel {order}',
        body: 'Hello {first},\n\n{carrier} could not deliver your parcel for order {order} (tracking number {tracking}). Please confirm your address and phone number, or tell us when you will be at home so we can arrange a new delivery.{?cod} You pay {cod} on delivery (cash on delivery).{/cod}\n\nKind regards,\n{shop}{?contact}\n{contact}{/contact}',
        sms: '{shop}: {carrier} could not deliver parcel {order} ({tracking}). Reply with a time you are at home or confirm your address.{?cod} Cash on delivery: {cod}.{/cod}'
      },
      pickup: {
        subject: 'Your parcel {order} is waiting – collect it by {deadline}',
        body: 'Hello {first},\n\nYour parcel for order {order} is waiting for you at {point}. You can collect it until {deadline}; after that {carrier} sends it back to us.{?cod} You pay {cod} when you collect it (cash on delivery).{/cod}\n\nTracking number: {tracking}\n\nKind regards,\n{shop}{?contact}\n{contact}{/contact}',
        sms: '{shop}: parcel {order} is waiting for you at {point}. Collect it by {deadline}.{?cod} Pay on collection: {cod}.{/cod} Tracking: {tracking}'
      },
      returned: {
        subject: 'Your parcel {order} is coming back to us',
        body: 'Hello {first},\n\nYour parcel for order {order} ({carrier}, {tracking}) is on its way back to us because it could not be delivered or collected.{?cod} You did not pay the {cod} cash on delivery, so you owe us nothing. If you still want the order, reply to this message and we will send it again.{/cod}{?prepaid} Once it is back, we will refund you or send the parcel again – just tell us which you prefer.{/prepaid}\n\nKind regards,\n{shop}{?contact}\n{contact}{/contact}',
        sms: '{shop}: parcel {order} ({tracking}) is coming back to us. Still want it? Reply and we will send it again.'
      },
      damaged: {
        subject: 'A problem with your parcel {order}',
        body: 'Hello {first},\n\n{carrier} has told us that your parcel for order {order} ({tracking}) was {what}. We are sorry. We have opened a claim with the carrier, and we will send you a new parcel or refund you straight away – tell us which you prefer.{?cod} You did not pay the {cod} cash on delivery.{/cod}\n\nKind regards,\n{shop}{?contact}\n{contact}{/contact}',
        sms: '{shop}: parcel {order} ({tracking}) was {what}. We will send a new one or refund you – reply with what you prefer.'
      },
      what: { damaged: 'damaged', lost: 'lost' }
    }
  };

  var MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  /** 'YYYY-MM-DD' → "20. 10. 2026" (sl), "20. 10. 2026." (hr), "20 October 2026" (en) */
  function fmtDate(s, lang) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return '';
    var d = +s.slice(8, 10), m = +s.slice(5, 7), y = s.slice(0, 4);
    if (lang === 'en') return d + ' ' + MONTHS_EN[m - 1] + ' ' + y;
    return d + '. ' + m + '. ' + y + (lang === 'hr' ? '.' : '');
  }
  /** 49.9 → "49,90 €" (the customers pay in euros in SI, HR and IT) */
  function fmtMoney(n) {
    var v = Math.round((+n || 0) * 100) / 100, neg = v < 0, s = Math.abs(v).toFixed(2).split('.');
    return (neg ? '−' : '') + s[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + s[1] + ' €';
  }
  /** fill a template: optional parts first, then the placeholders; a date ending in "." before a full stop keeps one dot */
  function fill(tpl, vars) {
    vars = vars || {};
    var s = String(tpl || '').replace(/\{\?(\w+)\}([\s\S]*?)\{\/\1\}/g, function (m, k, inner) { return vars[k] ? inner : ''; });
    s = s.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null && vars[k] !== '' ? String(vars[k]) : (k in vars ? '' : m); });
    return s.replace(/(\d{4}\.)\./g, '$1').replace(/[ \t]+\n/g, '\n');
  }
  /** { subject, body, sms } for a kind and language; vars as for fill (cod / eta / deadline already formatted) */
  function compose(kind, lang, vars) {
    var L = T[lang] || T.en, t = L[kind] || L.late;
    var v = {}; Object.keys(vars || {}).forEach(function (k) { v[k] = vars[k]; });
    v.what = L.what[v.lost ? 'lost' : 'damaged'];
    v.prepaid = v.cod ? '' : 'yes';
    return { subject: fill(t.subject, v), body: fill(t.body, v), sms: fill(t.sms, v) };
  }
  /** "+386 1 000 12 34" → "+38610001234" (for sms: links) */
  function normPhone(p) { var s = String(p || '').trim(); return (s[0] === '+' ? '+' : '') + s.replace(/\D/g, ''); }
  /** mailto: link with subject and body; line breaks as CRLF (Outlook keeps them) */
  function mailto(email, subject, body) {
    return 'mailto:' + encodeURIComponent(String(email || '').trim()).replace(/%40/g, '@') + '?subject=' + encodeURIComponent(subject || '') + '&body=' + encodeURIComponent(String(body || '').replace(/\r?\n/g, '\r\n'));
  }
  /** sms: link in the form both iOS and Android open with the text filled in: sms:<number>?&body=<text> */
  function smsHref(phone, text) { return 'sms:' + normPhone(phone) + '?&body=' + encodeURIComponent(text || ''); }
  /** characters and SMS parts: GSM-7 160 / 153 per part (€ counts double), else UCS-2 70 / 67 (č, š, ž, ć, đ need UCS-2) */
  var GSM = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà', GSMX = '^{}\\[~]|€';
  function smsInfo(text) {
    var s = String(text || ''), gsm = true, units = 0;
    for (var i = 0; i < s.length; i++) { var c = s[i]; if (GSM.indexOf(c) >= 0) units++; else if (GSMX.indexOf(c) >= 0) units += 2; else { gsm = false; break; } }
    var len = gsm ? units : s.length, one = gsm ? 160 : 70, many = gsm ? 153 : 67;
    return { chars: s.length, gsm: gsm, parts: len === 0 ? 0 : len <= one ? 1 : Math.ceil(len / many) };
  }

  return { LANGS: LANGS, KINDS: KINDS, TEMPLATES: T, langFor: langFor, kindFor: kindFor, fmtDate: fmtDate, fmtMoney: fmtMoney, fill: fill, compose: compose, normPhone: normPhone, mailto: mailto, smsHref: smsHref, smsInfo: smsInfo };
});
