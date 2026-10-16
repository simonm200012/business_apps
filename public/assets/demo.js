/* Public demo copies (built by tools/build-public.mjs from site/<app>/): a "Demo — sample data, stays in your browser"
 * bar with a link back to the contact section, and small fixes for things that only make sense on the private site.
 * Loaded in <head>, before the app's own scripts. Sync is off through <meta name="stratum-public" content="1">, which
 * _shared/stratum-shell.js and _shared/stratum-sync.js read. */
(function () {
  'use strict';
  var TEXT = {
    sl: { demo: 'Demo', note: 'Vzorčni podatki – vse ostane v vašem brskalniku.', talk: 'Pogovorimo se', home: 'Tokovi', pill: 'Izmišljeni demo podatki. Vse, kar spremenite ali uvozite, ostane v tem brskalniku; nič se ne pošlje.' },
    hr: { demo: 'Demo', note: 'Ogledni podaci – sve ostaje u vašem pregledniku.', talk: 'Razgovarajmo', home: 'Tokovi', pill: 'Izmišljeni demo podaci. Sve što promijenite ili uvezete ostaje u ovom pregledniku; ništa se ne šalje.' },
    en: { demo: 'Demo', note: 'Sample data – everything stays in your browser.', talk: 'Talk to us', home: 'Tokovi', pill: 'Fictional demo data. Whatever you change or import stays in this browser; nothing is sent.' }
  };
  var HOME = { sl: '/', hr: '/hr/', en: '/en/' };
  var app = (location.pathname.split('/')[1] || '').toLowerCase();

  // language: ?lang= from the site's deep links, else the language last used on the site, else the browser's
  var lang = null;
  try { lang = new URLSearchParams(location.search).get('lang'); } catch (e) { lang = null; }
  if (!TEXT[lang]) { try { lang = localStorage.getItem('stratum-site-lang'); } catch (e) { lang = null; } }
  if (!TEXT[lang]) { var n = String(navigator.language || '').toLowerCase(); lang = n.indexOf('sl') === 0 ? 'sl' : n.indexOf('hr') === 0 || n.indexOf('bs') === 0 || n.indexOf('sr') === 0 ? 'hr' : 'en'; }
  var t = TEXT[lang];

  // Collections has Slovenian and Croatian screens: a deep link with ?lang= opens it in that language
  // (its own choice lives in localStorage "stratum-collections-ui", read when app.js starts, which is after this file)
  if (app === 'collections' && /[?&]lang=(sl|hr|en)\b/.test(location.search)) {
    try {
      var ui = JSON.parse(localStorage.getItem('stratum-collections-ui') || '{}') || {};
      if (ui.lang !== lang) { ui.lang = lang; localStorage.setItem('stratum-collections-ui', JSON.stringify(ui)); }
    } catch (e) { /* storage blocked: the app picks the browser language */ }
  }

  function bar() {
    if (document.getElementById('stratumDemoBar')) return;
    var b = document.createElement('div');
    b.id = 'stratumDemoBar'; b.className = 'sdb'; b.setAttribute('role', 'note'); b.setAttribute('lang', lang);
    var home = document.createElement('a'); home.className = 'sdb-home'; home.href = HOME[lang]; home.textContent = t.home; home.setAttribute('aria-label', t.home);
    var chip = document.createElement('b'); chip.textContent = t.demo;
    var note = document.createElement('span'); note.className = 'sdb-note'; note.textContent = t.note;
    var talk = document.createElement('a'); talk.className = 'sdb-talk'; talk.href = HOME[lang] + '#contact'; talk.textContent = t.talk;
    b.appendChild(home); b.appendChild(chip); b.appendChild(note); b.appendChild(talk);
    document.body.insertBefore(b, document.body.firstChild);
  }
  // the apps' "Demo data" pills say "…and your private cloud copy" on the private site
  function pills() {
    var l = document.querySelectorAll('.demo-pill');
    for (var i = 0; i < l.length; i++) if (l[i].title !== t.pill) l[i].title = t.pill;
  }
  // document titles end in "— Business Apps" on the private site
  function title() { if (/Business Apps/.test(document.title)) document.title = document.title.replace(/\s*[—–-]\s*Business Apps\s*$/, '') + ' — Tokovi demo'; }
  function tidy() { pills(); title(); }
  function start() {
    bar(); tidy();
    if (window.MutationObserver) {
      var q = false;
      new MutationObserver(function () { if (q) return; q = true; setTimeout(function () { q = false; tidy(); }, 50); })
        .observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['title'] });
      var tEl = document.querySelector('title');
      if (tEl) new MutationObserver(title).observe(tEl, { childList: true, characterData: true, subtree: true });
    }
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
