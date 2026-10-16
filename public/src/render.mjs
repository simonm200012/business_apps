// HTML for the public site: the landing page in three languages, the privacy page and the legal notice (Slovenian),
// and the 404 page. Pure functions: render*(ctx) → HTML string. The build (tools/build-public.mjs) calls them.
// Every value from the data files goes through esc(); strings from content.mjs may contain the little markup they need
// (<b>, <span class="grad">, a link to the privacy page) and are trusted.
import { LANGS, PRODUCTS, BUILT, HR_DATE, SI_DATE, content } from './content.mjs';
import { daysUntil, plural, date, num } from './format.mjs';

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const isUrl = (s) => typeof s === 'string' && /^https:\/\/[^\s<>"']+$/.test(s);
export const HOME = { sl: '/', hr: '/hr/', en: '/en/' };
const LANG_NAME = { sl: 'Slovenščina', hr: 'Hrvatski', en: 'English' };
const ICON_APPS = { datacheck: 'datacheck', collections: 'collections', cashflow: 'cashflow', budget: 'budget' };

// the Tokovi mark (three layers), inline so it needs no request
const MARK = (s) => '<svg width="' + s + '" height="' + s + '" viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="gm' + s + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7B66F0"/><stop offset=".55" stop-color="#5B3FE0"/><stop offset="1" stop-color="#17869C"/></linearGradient></defs><rect width="32" height="32" rx="9" fill="url(#gm' + s + ')"/><rect x="11.5" y="8.6" width="13" height="3.4" rx="1.7" fill="#fff" opacity=".55"/><rect x="9.5" y="14.3" width="15" height="3.4" rx="1.7" fill="#fff" opacity=".8"/><rect x="7.5" y="20" width="17" height="3.4" rx="1.7" fill="#fff"/></svg>';

/** <head> shared by every page. ctx: { lang, title, description, robots (bool noindex), assets, siteUrl, path, alternates } */
function head(ctx) {
  const abs = (p) => (ctx.siteUrl ? ctx.siteUrl + p : p);
  return '<!doctype html>\n<html lang="' + ctx.lang + '">\n<head>\n<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' +
    (ctx.noindex ? '<meta name="robots" content="noindex, nofollow">\n' : '') +
    '<title>' + esc(ctx.title) + '</title>\n<meta name="description" content="' + esc(ctx.description) + '">\n' +
    '<meta name="color-scheme" content="light dark">\n' +
    '<meta name="theme-color" media="(prefers-color-scheme: light)" content="#FBFBFD"><meta name="theme-color" media="(prefers-color-scheme: dark)" content="#070708">\n' +
    '<meta property="og:type" content="website"><meta property="og:title" content="' + esc(ctx.title) + '"><meta property="og:description" content="' + esc(ctx.description) + '">\n' +
    (ctx.siteUrl ? '<link rel="canonical" href="' + esc(abs(ctx.path)) + '">\n' : '') +
    (ctx.siteUrl && ctx.alternates ? Object.keys(ctx.alternates).map((l) => '<link rel="alternate" hreflang="' + l + '" href="' + esc(abs(ctx.alternates[l])) + '">').join('') + '<link rel="alternate" hreflang="x-default" href="' + esc(abs('/')) + '">\n' : '') +
    '<link rel="icon" type="image/svg+xml" href="/assets/favicon.svg">\n' +
    '<link rel="stylesheet" href="' + ctx.assets.css + '">\n' +
    '<script src="' + ctx.assets.js + '" defer></script>\n</head>\n';
}

function header(lang, t, langLinks) {
  const h = HOME[lang];
  const links = [['einvoices', t.nav.einv], ['products', t.nav.products], ['demo', t.nav.demo], ['about', t.nav.about], ['faq', t.nav.faq]];
  const navA = links.map((l) => '<a href="' + h + '#' + l[0] + '">' + esc(l[1]) + '</a>').join('');
  return '<a class="skip" href="#main">' + esc(t.skip) + '</a>\n' +
    '<header class="nav" id="nav"><div class="nav-in">' +
    '<a class="logo" href="' + h + '" aria-label="Tokovi">' + MARK(28) + '<span>Tokovi</span></a>' +
    '<nav class="links" aria-label="' + esc(t.nav.menu) + '">' + navA + '</nav>' +
    '<nav class="langs" aria-label="' + esc(t.nav.lang) + '">' + langLinks + '</nav>' +
    '<a class="btn primary sm cta" href="' + h + '#contact">' + esc(t.nav.cta) + '</a>' +
    '<button type="button" class="menu-btn" id="menuBtn" aria-expanded="false" aria-controls="mnav" aria-label="' + esc(t.nav.menu) + '"><span></span><span></span></button>' +
    '</div><nav class="mnav" id="mnav" aria-label="' + esc(t.nav.menu) + '" hidden>' + navA + '<a href="' + h + '#contact">' + esc(t.nav.contact) + '</a></nav></header>\n';
}

function langSwitch(lang, hrefs) {
  return LANGS.map((l) => '<a href="' + hrefs[l] + '" hreflang="' + l + '" lang="' + l + '"' + (l === lang ? ' aria-current="true"' : '') + ' title="' + LANG_NAME[l] + '">' + l.toUpperCase() + '</a>').join('');
}

function footer(lang, t, C) {
  const f = t.footer, h = HOME[lang];
  // empty fields are left out (no company registered yet: registrationNote says so instead of invented numbers)
  const co = [C.legalName, C.address, C.registrationNumber && f.reg + ': ' + C.registrationNumber, C.taxNumber && f.tax + ': ' + C.taxNumber, C.court, C.shareCapital && f.capital + ': ' + C.shareCapital,
    !C.registrationNumber && C.registrationNote && C.registrationNote[lang]].filter(Boolean).map(esc).join(' · ');
  return '<footer class="foot"><div class="wrap foot-in">' +
    '<div class="foot-brand"><a class="logo" href="' + h + '">' + MARK(24) + '<span>Tokovi</span></a><p>' + esc(f.tagline) + '</p></div>' +
    '<nav aria-label="' + esc(f.legal) + '"><a href="/zasebnost/">' + esc(f.privacy + f.legalLang) + '</a><a href="/pravno-obvestilo/">' + esc(f.legal + f.legalLang) + '</a><a href="' + h + '#contact">' + esc(f.contact) + '</a></nav>' +
    '<p class="co">' + co + ' · <a href="mailto:' + esc(C.email) + '">' + esc(C.email) + '</a>' + (C.phone ? ' · ' + esc(C.phone) : '') + '</p>' +
    '<p class="note">' + esc(f.demoNote) + '</p>' +
    '</div></footer>\n';
}

/** the demo address of a product, with the language for its screens */
export const demoHref = (app, hash, lang) => '/' + app + '/?lang=' + lang + (hash || '');

function price(rows) {
  return '<dl class="price">' + rows.map((r) => '<div><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>').join('') + '</dl>';
}

/** booking link: the data file's https link, or an e-mail asking for a call while it is a placeholder */
function bookHref(C, t) {
  return isUrl(C.bookingUrl) ? C.bookingUrl : 'mailto:' + C.email + '?subject=' + encodeURIComponent(t.contact.bookSubject);
}

export function renderLanding(ctx) {
  const { lang, P, C, today } = ctx;
  const t = content(lang, P, C), h = HOME[lang];
  const days = daysUntil(today, SI_DATE);
  const siStatus = plural(days, lang, t.deadlines.si.status).replace('{n}', num(days, lang));
  const book = bookHref(C, t);
  const bookAttrs = isUrl(C.bookingUrl) ? ' target="_blank" rel="noopener"' : '';
  const text = { // what assets/site.js needs: form messages, calculator words, number format
    lang, msg: t.contact.msg, sending: t.contact.sending, submit: t.contact.submit, email: C.email, mailSubject: t.contact.mailSubject,
    calc: { hoursLine: t.calc.hoursLine, line: t.calc.line, used: t.calc.used }, siStatus: t.deadlines.si.status, siDate: SI_DATE
  };
  const productCard = (id) => {
    const p = t.products.items[id];
    return '<article class="card prod" id="p-' + id + '"><div class="prod-h"><img src="/assets/apps/' + ICON_APPS[id] + '.png" alt="" width="44" height="44" loading="lazy" decoding="async"><div><h3>' + esc(p.name) + '</h3>' +
      (id === 'datacheck' ? '<span class="tag">' + esc(t.products.tagFree) + '</span>' : '') + '</div></div>' +
      '<p>' + esc(p.text) + '</p>' + price(p.rows) + '<p class="small">' + esc(p.small) + '</p>' +
      '<div class="acts"><a class="btn primary" href="' + demoHref(id, '', lang) + '">' + esc(t.products.open) + '</a><a class="btn" href="#contact" data-product="' + id + '">' + esc(t.products.ask) + '</a></div></article>';
  };
  const builtName = BUILT.map((b) => { const x = b[LANGS.indexOf(lang) + 1]; return '<li><img src="/assets/apps/' + b[0] + '.png" alt="" width="36" height="36" loading="lazy" decoding="async"><div><b>' + esc(x[0]) + '</b><span>' + esc(x[1]) + '</span></div></li>'; }).join('');
  const caseCard = (c) => '<article class="card case"><span class="kicker">' + esc(c.kicker) + '</span><h4>' + esc(c.title) + '</h4><dl>' + c.metrics.map((m) => '<div><dt>' + esc(m[0]) + '</dt><dd>' + esc(m[1]) + '</dd></div>').join('') + '</dl><p>' + esc(c.text) + '</p></article>';
  const person = C.person;
  const photo = person.photo ? '<img class="photo" src="' + esc(person.photo) + '" alt="' + esc(person.name) + '" width="160" height="160">' :
    '<div class="photo ph" role="img" aria-label="' + esc(t.about.photo) + '"><span aria-hidden="true">' + esc(person.name.split(' ').map((w) => w[0]).join('')) + '</span><small>' + esc(t.about.photo) + '</small></div>';
  const linkedin = isUrl(person.linkedin) ? '<a class="btn sm" href="' + esc(person.linkedin) + '" target="_blank" rel="noopener">LinkedIn</a>' : '<span class="btn sm ph-btn" aria-disabled="true">LinkedIn ' + esc(person.linkedin) + '</span>';
  const opts = Object.keys(t.contact.options).map((k) => '<option value="' + k + '">' + esc(t.contact.options[k]) + '</option>').join('');
  const hrefs = { sl: '/', hr: '/hr/', en: '/en/' };

  return head({ ...ctx, title: t.title, description: t.description, path: h, alternates: hrefs }) +
    '<body data-page="landing">\n' + header(lang, t, langSwitch(lang, hrefs)) +
    '<main id="main">\n' +
    // ── hero + deadlines
    '<section class="hero" id="top" aria-labelledby="heroTitle"><div class="glow g1" aria-hidden="true"></div><div class="glow g2" aria-hidden="true"></div><div class="wrap hero-in">' +
    '<p class="tagline"><span class="pulse" aria-hidden="true"></span>' + esc(t.hero.eyebrow) + '</p>' +
    '<h1 id="heroTitle">' + t.hero.h1 + '</h1><p class="lead">' + esc(t.hero.lead) + '</p>' +
    '<div class="ctas"><a class="btn primary lg" href="' + demoHref('datacheck', '', lang) + '">' + esc(t.hero.cta1) + '</a><a class="btn lg" href="' + esc(book) + '"' + bookAttrs + '>' + esc(t.hero.cta2) + '</a></div>' +
    '<p class="note hero-note">' + esc(t.hero.note) + '</p></div>' +
    '<div class="wrap" id="einvoices"><h2 class="sr">' + esc(t.deadlines.label) + '</h2><div class="deadlines">' +
    '<article class="card dl live"><span class="kicker">' + esc(t.deadlines.hr.kicker) + '</span><b class="when">' + esc(t.deadlines.hr.when) + '</b><span class="status ok">' + esc(t.deadlines.hr.status) + '</span><p>' + esc(t.deadlines.hr.text) + '</p></article>' +
    '<article class="card dl"><span class="kicker">' + esc(t.deadlines.si.kicker) + '</span><b class="when">' + esc(t.deadlines.si.when) + '</b><span class="status warn" id="siDays">' + esc(siStatus) + '</span><p>' + esc(t.deadlines.si.text) + '</p></article>' +
    '</div><p class="note center">' + esc(t.deadlines.foot) + '</p></div></section>\n' +
    // ── three steps
    '<section class="sec" id="steps" aria-labelledby="stepsTitle"><div class="wrap"><p class="eyebrow">' + esc(t.steps.eyebrow) + '</p><h2 id="stepsTitle">' + esc(t.steps.h2) + '</h2>' +
    '<ol class="steps">' + t.steps.items.map((s, i) => '<li class="card"><span class="num">' + (i + 1) + '</span><h3>' + esc(s[0]) + '</h3><p>' + esc(s[1]) + '</p><b class="step-price">' + esc(s[2]) + '</b></li>').join('') + '</ol>' +
    '<p class="bundle">' + t.steps.bundle + '</p><p class="center"><a class="btn primary" href="' + demoHref('datacheck', '', lang) + '">' + esc(t.steps.cta) + '</a></p></div></section>\n' +
    // ── products
    '<section class="sec alt" id="products" aria-labelledby="prodTitle"><div class="wrap"><p class="eyebrow">' + esc(t.products.eyebrow) + '</p><h2 id="prodTitle">' + esc(t.products.h2) + '</h2><p class="lead">' + esc(t.products.lead) + '</p>' +
    '<div class="prods">' + PRODUCTS.map(productCard).join('') + '</div>' +
    '<ul class="extras"><li>' + t.products.bundle + '</li><li>' + t.products.custom + '</li>' + (P.founding.show ? '<li>' + t.products.founding + '</li>' : '') + '</ul>' +
    '<p class="note">' + esc(t.products.terms) + '</p></div></section>\n' +
    // ── guided demo
    '<section class="sec band" id="demo" aria-labelledby="storyTitle"><div class="wrap"><p class="eyebrow">' + esc(t.story.eyebrow) + '</p><h2 id="storyTitle">' + esc(t.story.h2) + '</h2><p class="lead">' + esc(t.story.lead) + '</p>' +
    '<ol class="story">' + t.story.items.map((s, i) => '<li><span class="num">' + (i + 1) + '</span><div><span class="kicker">' + esc(s[2]) + '</span><h3>' + esc(s[3]) + '</h3><p>' + esc(s[4]) + '</p><a class="go" href="' + demoHref(s[0], s[1], lang) + '">' + esc(t.story.open) + ' <span aria-hidden="true">→</span></a></div></li>').join('') + '</ol>' +
    '<p class="note">' + esc(t.story.note) + '</p></div></section>\n' +
    // ── calculator (from the showcase)
    '<section class="sec" id="savings" aria-labelledby="calcTitle"><div class="wrap"><p class="eyebrow">' + esc(t.calc.eyebrow) + '</p><h2 id="calcTitle">' + esc(t.calc.h2) + '</h2><p class="lead">' + esc(t.calc.lead) + '</p>' +
    '<div class="calc"><form class="calc-in" id="calc" novalidate>' +
    '<label class="calc-f" for="cPeople"><span class="calc-l">' + esc(t.calc.people) + '</span><output id="oPeople">4</output><input type="range" id="cPeople" min="1" max="30" step="1" value="4"></label>' +
    '<label class="calc-f" for="cHours"><span class="calc-l">' + esc(t.calc.hours) + '</span><output id="oHours">6 h</output><input type="range" id="cHours" min="1" max="20" step="1" value="6"></label>' +
    '<label class="calc-f" for="cRate"><span class="calc-l">' + esc(t.calc.rate) + '</span><output id="oRate"></output><input type="range" id="cRate" min="15" max="90" step="1" value="32"></label>' +
    '<label class="calc-f" for="cShare"><span class="calc-l">' + esc(t.calc.share) + '</span><output id="oShare">70 %</output><input type="range" id="cShare" min="30" max="90" step="5" value="70"></label>' +
    '<p class="note">' + esc(t.calc.note) + '</p></form>' +
    '<div class="calc-out" aria-live="polite"><div class="calc-big"><span class="kicker">' + esc(t.calc.back) + '</span><b id="rValue">–</b><span id="rHours"></span></div>' +
    '<div class="calc-bars" aria-hidden="true"><div><span>' + esc(t.calc.now) + '</span><i id="barNow"></i><b id="hNow"></b></div><div><span>' + esc(t.calc.after) + '</span><i id="barNew"></i><b id="hNew"></b></div></div>' +
    '<ul class="calc-facts"><li><b id="rFte">–</b><span>' + esc(t.calc.fte) + '</span></li><li><b id="rWeeks">–</b><span>' + esc(t.calc.weeks) + '</span></li></ul>' +
    '<button type="button" class="btn primary" id="calcUse">' + esc(t.calc.use) + '</button><p class="note" id="calcStatus" role="status"></p></div></div></div></section>\n' +
    // ── built for clients
    '<section class="sec alt" id="built" aria-labelledby="builtTitle"><div class="wrap"><p class="eyebrow">' + esc(t.built.eyebrow) + '</p><h2 id="builtTitle">' + esc(t.built.h2) + '</h2><p class="lead">' + esc(t.built.lead) + '</p>' +
    '<ul class="built">' + builtName + '</ul></div></section>\n' +
    // ── about
    '<section class="sec" id="about" aria-labelledby="aboutTitle"><div class="wrap"><p class="eyebrow">' + esc(t.about.eyebrow) + '</p><h2 id="aboutTitle">' + esc(t.about.h2) + '</h2>' +
    '<div class="about"><div class="me">' + photo + '<div><h3>' + esc(person.name) + '</h3><p class="role">' + esc(person.role[lang]) + ', Tokovi</p><p>' + esc(t.about.bio) + '</p><p>' + esc(t.about.bio2) + '</p>' + linkedin + '</div></div>' +
    '<div class="cases"><h3>' + esc(t.about.cases) + '</h3><div class="case-grid">' + caseCard(t.about.case1) + caseCard(t.about.case2) + '</div><p class="note">' + esc(t.about.casesNote) + '</p></div></div></div></section>\n' +
    // ── FAQ
    '<section class="sec alt" id="faq" aria-labelledby="faqTitle"><div class="wrap narrow"><p class="eyebrow">' + esc(t.faq.eyebrow) + '</p><h2 id="faqTitle">' + esc(t.faq.h2) + '</h2>' +
    '<div class="faq">' + t.faq.items.map((q) => '<details><summary>' + esc(q[0]) + '</summary><p>' + q[1] + '</p></details>').join('') + '</div></div></section>\n' +
    // ── contact
    '<section class="sec contact" id="contact" aria-labelledby="ctaTitle"><div class="wrap"><p class="eyebrow">' + esc(t.contact.eyebrow) + '</p><h2 id="ctaTitle">' + esc(t.contact.h2) + '</h2><p class="lead">' + esc(t.contact.lead) + '</p>' +
    '<div class="contact-grid"><form class="card form" id="contactForm" action="mailto:' + esc(C.email) + '" method="post" enctype="text/plain" novalidate data-turnstile="' + esc(C.turnstileSiteKey || '') + '">' +
    '<input type="hidden" name="lang" value="' + lang + '">' +
    '<div class="row2"><div class="f"><label for="fName">' + esc(t.contact.name) + '</label><input id="fName" name="name" autocomplete="name" required minlength="2" maxlength="100" aria-describedby="eName"><small class="err" id="eName"></small></div>' +
    '<div class="f"><label for="fCompany">' + esc(t.contact.company) + '</label><input id="fCompany" name="company" autocomplete="organization" maxlength="120" aria-describedby="eCompany"><small class="err" id="eCompany"></small></div></div>' +
    '<div class="row2"><div class="f"><label for="fEmail">' + esc(t.contact.email) + '</label><input id="fEmail" name="email" type="email" autocomplete="email" required maxlength="254" aria-describedby="eEmail"><small class="err" id="eEmail"></small></div>' +
    '<div class="f"><label for="fPhone">' + esc(t.contact.phone) + ' <span class="opt">(' + esc(t.contact.optional) + ')</span></label><input id="fPhone" name="phone" type="tel" autocomplete="tel" maxlength="40" aria-describedby="ePhone"><small class="err" id="ePhone"></small></div></div>' +
    '<div class="f"><label for="fProduct">' + esc(t.contact.product) + '</label><select id="fProduct" name="product">' + opts + '</select></div>' +
    '<div class="f"><label for="fMessage">' + esc(t.contact.message) + '</label><textarea id="fMessage" name="message" rows="5" required minlength="10" maxlength="4000" placeholder="' + esc(t.contact.placeholder) + '" aria-describedby="eMessage"></textarea><small class="err" id="eMessage"></small></div>' +
    '<div class="hp" aria-hidden="true"><label for="fWebsite">' + esc(t.contact.honeypot) + '</label><input id="fWebsite" name="website" tabindex="-1" autocomplete="off"></div>' +
    '<div class="ts" id="tsBox"></div>' +
    '<p class="small">' + t.contact.privacy + '</p>' +
    '<div class="form-acts"><button type="submit" class="btn primary lg" id="fSubmit">' + esc(t.contact.submit) + '</button></div>' +
    '<div class="form-status" id="fStatus" role="status" aria-live="polite" tabindex="-1"></div></form>' +
    '<aside class="card side"><h3>' + esc(t.contact.side) + '</h3><p>' + esc(t.contact.sideText) + '</p><a class="btn primary" href="' + esc(book) + '"' + bookAttrs + '>' + esc(t.contact.book) + '</a>' +
    '<p class="small">' + esc(t.contact.orWrite) + ' <a href="mailto:' + esc(C.email) + '">' + esc(C.email) + '</a>' + (C.phone ? '<br><a href="tel:' + esc(C.phone.replace(/[^\d+]/g, '')) + '">' + esc(C.phone) + '</a>' : '') + '</p></aside></div></div></section>\n' +
    '</main>\n' + footer(lang, t, C) +
    '<script type="application/json" id="siteText">' + JSON.stringify(text).replace(/</g, '\\u003c') + '</script>\n' +
    '</body>\n</html>\n';
}

// ── legal pages (Slovenian) ─────────────────────────────────────────────────────────────────────────────────────────
function legalPage(ctx, title, description, path, body) {
  const t = content('sl', ctx.P, ctx.C);
  return head({ ...ctx, lang: 'sl', title: title + ' – Tokovi', description, path }) +
    '<body data-page="legal">\n' + header('sl', t, langSwitch('sl', { sl: '/', hr: '/hr/', en: '/en/' })) +
    '<main id="main" class="legal"><div class="wrap narrow"><h1>' + esc(title) + '</h1>' + body + '</div></main>\n' + footer('sl', t, ctx.C) + '</body>\n</html>\n';
}

export function renderPrivacy(ctx) {
  const C = ctx.C, e = esc;
  const ctl = '<p>' + e(C.legalName) + '<br>' + e(C.address) + (C.registrationNumber ? '<br>Matična številka: ' + e(C.registrationNumber) : '') + '<br>E-pošta: <a href="mailto:' + e(C.email) + '">' + e(C.email) + '</a>' + (C.phone ? '<br>Telefon: ' + e(C.phone) : '') + '</p>';
  const body =
    '<p class="lead">Ta izjava pojasnjuje, katere osebne podatke zbiramo prek spletne strani ' + e(C.brand) + ' in kako z njimi ravnamo, skladno s Splošno uredbo o varstvu podatkov (GDPR) in Zakonom o varstvu osebnih podatkov (ZVOP-2).</p>' +
    '<h2>1. Upravljavec</h2>' + ctl +
    '<h2>2. Katere podatke obdelujemo</h2>' +
    '<h3>Kontaktni obrazec</h3><p>Ko pošljete sporočilo, shranimo: ime in priimek, podjetje, e-naslov, telefon (če ga vpišete), izbrano področje, besedilo sporočila, jezik in naslov strani, s katere ste pisali, ter čas oddaje. IP-naslova in podatkov o brskalniku ob sporočilu ne shranjujemo.</p>' +
    '<p>Za zaščito pred zlorabo (omejitev števila sporočil z istega naslova) strežnik za kratek čas hrani enosmerni zgoščeni zapis (hash) vašega IP-naslova, izračunan z naključnim ključem, ki se menja vsak dan. Iz zapisa IP-naslova ni mogoče razbrati in ga ne povezujemo s sporočilom.</p>' +
    '<h3>Demo aplikacije</h3><p>Demo aplikacije na tej strani (Terjatve, Napoved likvidnosti, Plan in realizacija, Pregled podatkov) delujejo v vašem brskalniku. Kar v njih vnesete ali naložite, ostane v shrambi brskalnika na vaši napravi (localStorage, IndexedDB) in se nam ne pošilja. Podatke izbrišete s ponastavitvijo v nastavitvah aplikacije ali z brisanjem podatkov te strani v brskalniku.</p>' +
    '<p>Ko v demu Terjatve odprete opomin s QR kodo oziroma v Pregledu podatkov odprete Excelovo datoteko, brskalnik s strežnika cdnjs.cloudflare.com (Cloudflare, Inc.) naloži programsko knjižnico. Pri tem Cloudflare kot pri vsakem obisku spletne strani vidi vaš IP-naslov; vaši podatki in datoteke se ne pošiljajo.</p>' +
    '<h3>Piškotki in analitika</h3><p>Stran ne uporablja piškotkov, analitike, oglasnih ali drugih sledilnikov in ne nalaga zunanjih pisav.</p>' +
    '<h3>Tehnični podatki</h3><p>Stran gostuje pri ponudniku Cloudflare, Inc., ki za dostavo strani in zaščito pred napadi obdeluje tehnične podatke (npr. IP-naslov, vrsto brskalnika). Teh podatkov ne uporabljamo za analitiko.</p>' +
    '<h2>3. Nameni in pravne podlage</h2><ul><li>Odgovor na vaše povpraševanje in priprava ponudbe: izvajanje ukrepov pred sklenitvijo pogodbe na vašo zahtevo (točka (b) prvega odstavka 6. člena GDPR).</li><li>Zaščita obrazca pred zlorabo in varnost strani: zakoniti interes (točka (f) prvega odstavka 6. člena GDPR).</li></ul>' +
    '<h2>4. Koliko časa hranimo podatke</h2><ul><li>Sporočila iz obrazca: ' + e(C.retentionMonths) + ' mesecev od zadnjega stika, nato jih izbrišemo. Če sklenemo pogodbo, podatke hranimo, dokler traja poslovno sodelovanje, in toliko časa, kolikor zahtevajo predpisi.</li><li>Zgoščeni zapisi IP-naslovov: najpozneje 2 dni.</li></ul>' +
    '<h2>5. Obdelovalci in prenos podatkov</h2><p>Sporočila iz obrazca so shranjena v storitvi Cloudflare R2 (Cloudflare, Inc.)' + (C.leadsBucketEU ? ', v jurisdikciji Evropske unije' : '') + '. S Cloudflarom velja pogodba o obdelavi podatkov; Cloudflare, Inc. je vključen v okvir EU-ZDA za zasebnost podatkov (EU-U.S. Data Privacy Framework).</p>' +
    '<p>Če nam pišete po e-pošti, sporočilo obdeluje ponudnik naše e-pošte (Microsoft). Vaših podatkov ne prodajamo in jih ne posredujemo za oglaševanje.</p>' +
    '<h2>6. Vaše pravice</h2><p>Imate pravico do dostopa do svojih podatkov, popravka, izbrisa, omejitve obdelave, ugovora obdelavi na podlagi zakonitega interesa in prenosljivosti podatkov. Pišite nam na <a href="mailto:' + e(C.email) + '">' + e(C.email) + '</a>; odgovorimo najpozneje v enem mesecu.</p>' +
    '<p>Če menite, da vaše podatke obdelujemo v nasprotju s predpisi, se lahko pritožite pri Informacijskem pooblaščencu Republike Slovenije, Dunajska cesta 22, 1000 Ljubljana, <a href="https://www.ip-rs.si/">www.ip-rs.si</a>.</p>' +
    '<h2>7. Spremembe</h2><p>Izjavo lahko posodobimo; veljavna je različica na tej strani. Zadnja sprememba: ' + e(date(ctx.today, 'sl')) + '.</p>';
  return legalPage(ctx, 'Izjava o varstvu osebnih podatkov', 'Kako Tokovi ravna z osebnimi podatki iz kontaktnega obrazca in v demo aplikacijah.', '/zasebnost/', body);
}

export function renderLegal(ctx) {
  const C = ctx.C, e = esc;
  const body =
    '<h2>1. Podatki o ponudniku</h2><dl class="facts">' +
    [['Ponudnik', C.legalName], ['Naslov', C.address], ['Matična številka', C.registrationNumber], ['Davčna številka', C.taxNumber], ['Vpis v sodni register', C.court], ['Osnovni kapital', C.shareCapital],
      ['Registracija', !C.registrationNumber && C.registrationNote ? C.registrationNote.sl : '']].filter((r) => r[1]).map((r) => '<div><dt>' + e(r[0]) + '</dt><dd>' + e(r[1]) + '</dd></div>').join('') +
    '<div><dt>E-pošta</dt><dd><a href="mailto:' + e(C.email) + '">' + e(C.email) + '</a></dd></div>' + (C.phone ? '<div><dt>Telefon</dt><dd>' + e(C.phone) + '</dd></div>' : '') + '</dl>' +
    '<h2>2. Demo aplikacije</h2><p>Demo aplikacije so namenjene preizkusu. Vsa podjetja, osebe, računi in zneski v njih so izmišljeni. Aplikacije delujejo v vašem brskalniku; kar vanje vnesete ali naložite, ostane na vaši napravi in ste zanj odgovorni sami. Demo aplikacije so na voljo brez jamstva za delovanje ali pravilnost izračunov.</p>' +
    '<h2>3. Ni pravni ali davčni nasvet</h2><p>Povzetki predpisov (npr. roki za e-račune), zakonske zamudne obresti in besedila opominov so informativni in ne nadomeščajo pravnega ali davčnega svetovanja.</p>' +
    '<h2>4. Cene in ponudbe</h2><p>' + e(C.vatNote.sl) + ' Cene na strani so informativne; zavezujoča sta le pisna ponudba in pogodba.</p>' +
    '<h2>5. Avtorske pravice</h2><p>Besedila, oblikovanje in programska koda na tej strani so avtorsko delo ponudnika ' + e(C.legalName) + '. Kopiranje ali uporaba brez pisnega dovoljenja ni dovoljena.</p>' +
    '<h2>6. Odgovornost</h2><p>Za škodo, ki bi nastala zaradi uporabe strani ali demo aplikacij, odgovarjamo v mejah, ki jih določa zakon. Za vsebino zunanjih strani, na katere vodijo povezave, ne odgovarjamo.</p>' +
    '<h2>7. Varstvo podatkov</h2><p>Kako ravnamo z osebnimi podatki, piše v <a href="/zasebnost/">izjavi o varstvu osebnih podatkov</a>.</p>' +
    '<h2>8. Pravo in spori</h2><p>Za uporabo strani velja pravo Republike Slovenije. Za spore je pristojno [Pristojno sodišče].</p>';
  return legalPage(ctx, 'Pravno obvestilo in pogoji uporabe', 'Podatki o ponudniku in pogoji uporabe spletne strani in demo aplikacij Tokovi.', '/pravno-obvestilo/', body);
}

export function render404(ctx) {
  return head({ ...ctx, lang: 'sl', title: 'Stran ne obstaja – Tokovi', description: 'Stran ne obstaja.', path: '/404.html', noindex: true }) +
    '<body data-page="404"><main id="main" class="nf"><div class="wrap narrow"><a class="logo" href="/">' + MARK(28) + '<span>Tokovi</span></a>' +
    '<p class="eyebrow">404</p><h1>Te strani ni.</h1><p lang="hr">Ova stranica ne postoji.</p><p lang="en">This page does not exist.</p>' +
    '<p><a class="btn primary" href="/">Na začetno stran</a> <a class="btn" href="/hr/" lang="hr">Početna</a> <a class="btn" href="/en/" lang="en">Home</a></p></div></main></body>\n</html>\n';
}
