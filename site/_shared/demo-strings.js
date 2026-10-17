/* Page texts of a branded demo (public page /d/<slug> and the live preview in Studio > Branded demo) in English, Slovenian,
   Croatian and German. Only the page around the apps is translated; the sales sheets (_shared/app-sheets.js) and the
   pitch stay in English for now. {name} and {date} are filled in by _shared/demo-render.js. */
(function (root) {
  'use strict';
  var S = {
    en: { locale: 'en-GB', welcome: 'Welcome, {name}', sub: 'Business apps shown with your own branding', news: 'Company news', apps: 'Your apps', hint: 'Tap an app to see what it does',
      book: 'Book a call', play: 'Play pitch', openDemo: 'Open demo', prepared: 'Prepared for {name}', valid: 'Link valid until {date}', loading: 'Loading…',
      notFound: 'This page is not available.', logo: 'Logo of {name}', preview: 'Preview' },
    sl: { locale: 'sl-SI', welcome: 'Dobrodošli, {name}', sub: 'Poslovne aplikacije v vaši podobi', news: 'Novice podjetja', apps: 'Vaše aplikacije', hint: 'Izberite aplikacijo in poglejte, kaj zna',
      book: 'Rezerviraj pogovor', play: 'Predvajaj predstavitev', openDemo: 'Odpri demo', prepared: 'Pripravljeno za {name}', valid: 'Povezava velja do {date}', loading: 'Nalaganje …',
      notFound: 'Ta stran ni na voljo.', logo: 'Logotip podjetja {name}', preview: 'Predogled' },
    hr: { locale: 'hr-HR', welcome: 'Dobrodošli, {name}', sub: 'Poslovne aplikacije u vašem izgledu', news: 'Novosti tvrtke', apps: 'Vaše aplikacije', hint: 'Odaberite aplikaciju i pogledajte što radi',
      book: 'Rezerviraj razgovor', play: 'Pokreni prezentaciju', openDemo: 'Otvori demo', prepared: 'Pripremljeno za {name}', valid: 'Poveznica vrijedi do {date}', loading: 'Učitavanje …',
      notFound: 'Ova stranica nije dostupna.', logo: 'Logotip tvrtke {name}', preview: 'Pretpregled' },
    de: { locale: 'de-DE', welcome: 'Willkommen, {name}', sub: 'Business-Apps in Ihrem eigenen Erscheinungsbild', news: 'Neues aus dem Unternehmen', apps: 'Ihre Apps', hint: 'Wählen Sie eine App, um zu sehen, was sie kann',
      book: 'Gespräch buchen', play: 'Pitch abspielen', openDemo: 'Demo öffnen', prepared: 'Vorbereitet für {name}', valid: 'Link gültig bis {date}', loading: 'Wird geladen …',
      notFound: 'Diese Seite ist nicht verfügbar.', logo: 'Logo von {name}', preview: 'Vorschau' }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = S; else root.DEMO_STRINGS = S;
})(typeof window !== 'undefined' ? window : this);
