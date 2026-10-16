// Company details, contact and links for the public site: the ONE place to change them. The build writes them into the
// footer, the contact section, the privacy page and the legal notice (pravno obvestilo).
// Values in [square brackets] are placeholders and are shown on the page exactly like that until you replace them.
// The legal fields are what ZEPT Art. 5 (and ZGD-1 Art. 33 for a d.o.o.) ask a business website to show.
export default {
  brand: 'Clearfigure',                         // no "Clearfigure" company found in the business register (checked 16 Oct 2026); clearfigure.si / clearfigure.eu were free
  legalName: 'Simon Modic, Clearfigure',
  address: 'Cerklje na Gorenjskem, Slovenija', // full street address once the company is registered
  // Empty until the company is registered: never put invented numbers here. Empty fields are left out, and
  // registrationNote is shown instead.
  registrationNumber: '',
  taxNumber: '',                            // or "ID za DDV: SI…" once VAT-registered
  court: '',                                // e.g. "vpis pri Okrožnem sodišču v …, št. vložka …"
  shareCapital: '',                         // e.g. "7.500,00 €"
  registrationNote: {
    sl: 'Podatki o registraciji bodo objavljeni ob vpisu v Poslovni register Slovenije.',
    hr: 'Podaci o registraciji bit će objavljeni nakon upisa u slovenski poslovni registar.',
    en: 'Registration details will be published once the company is entered in the Slovenian Business Register.'
  },
  // Shown under every price list. If the company is not VAT-registered, write e.g.
  // "DDV ni obračunan na podlagi 1. odstavka 94. člena ZDDV-1." (check with your accountant).
  vatNote: { sl: 'Cene so v evrih, brez DDV.', hr: 'Cijene su u eurima, bez PDV-a.', en: 'Prices in euros, excluding VAT.' },

  email: 'simonm2000@outlook.com',          // placeholder for now: change to an address on the company domain once it exists
  phone: '',                                // e.g. '+386 1 000 00 00'; empty = not shown

  // "Book 20 minutes": a Cal.com or Microsoft Bookings link. Until it is an https:// link, the button opens an e-mail
  // asking for a 20-minute call instead.
  bookingUrl: '[Povezava za rezervacijo termina]',

  person: {
    name: 'Simon Modic',
    role: { sl: 'Ustanovitelj', hr: 'Osnivač', en: 'Founder' },
    linkedin: 'https://www.linkedin.com/in/simonmodic/',
    photo: '/assets/img/simon.jpg'          // from his LinkedIn profile
  },

  // Privacy page: how long contact-form messages are kept when no contract follows.
  retentionMonths: 12,
  // Set to true only after checking in the Cloudflare dashboard that the bucket "clearfigure-leads" was created with
  // jurisdiction EU (see public/README.md). Then the privacy page says the messages are stored in the EU.
  leadsBucketEU: true,                      // "clearfigure-leads" created with jurisdiction EU on 16 Oct 2026

  // Optional Cloudflare Turnstile (spam protection on the contact form): the site key from the Cloudflare dashboard.
  // Empty = off. Also set the secret: npx wrangler secret put TURNSTILE_SECRET -c public/wrangler.jsonc
  turnstileSiteKey: '',

  // Optional: the public address once a domain is attached, e.g. 'https://www.example.si' (no trailing slash).
  // Used only for canonical/hreflang links and sitemap.xml; empty = relative links, works on any host.
  siteUrl: ''
};
