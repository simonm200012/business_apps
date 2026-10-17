/* Scene lists for the animated pitches (site/pitch/). Pure data, no DOM, so Node can load it (tools/tests/pitch.test.js)
   and the page (pitch.js) draws the same scenes.
   - buildScenes(sheet, adjust, meta): one app. sheet = an entry of _shared/app-sheets.js, adjust = AppSheetPanel.ADJUST
     (_shared/app-sheet-panel.js, the one place the adjust texts live), meta = { id, name, group, href }.
   - buildAllScenes(groups, adjust): "Business Apps in 40 seconds". groups come from parseHome(index.html), so the group and
     app lists are never typed by hand here.
   Durations are in seconds; every list sums to 25-45 s. */
(function (root) {
  'use strict';
  // same link as public/data/company.mjs (bookingUrl); tools/tests/pitch.test.js checks they match
  var BOOKING_URL = 'https://cal.com/clearfigure/posvet';
  // mock-screen template per feature, by group (the n-th feature of an app takes the n-th entry)
  var TEMPLATES = {
    finance: ['bars', 'table', 'checks'], sales: ['table', 'bars', 'checks'], operations: ['checks', 'table', 'calendar'],
    people: ['calendar', 'checks', 'table'], insights: ['bars', 'table', 'calendar'], studio: ['checks', 'table', 'bars']
  };
  var DEFAULT_TEMPLATES = ['table', 'bars', 'checks'];
  function templateFor(group, i) { var l = TEMPLATES[group] || DEFAULT_TEMPLATES; return l[i % l.length]; }

  function unesc(s) { return String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"); }
  // groups and apps as listed on the home page: [{ id, name, desc, apps: [{ id, name, href }] }]
  function parseHome(html) {
    var out = [];
    String(html).split('<section class="group"').slice(1).forEach(function (chunk) {
      var id = /data-group="([^"]+)"/.exec(chunk), name = /<h2[^>]*>([^<]+)<\/h2>/.exec(chunk), desc = /class="ghead"[\s\S]*?<p>([^<]*)<\/p>/.exec(chunk);
      if (!id || !name) return;
      var g = { id: id[1], name: unesc(name[1]).trim(), desc: desc ? unesc(desc[1]).trim() : '', apps: [] };
      chunk.split('<article class="card"').slice(1).forEach(function (card) {
        var a = /data-app="([^"]+)"/.exec(card), o = /<a class="open" href="([^"]+)">([^<]+)<\/a>/.exec(card);
        if (a && o) g.apps.push({ id: a[1], name: unesc(o[2]).trim(), href: o[1] });
      });
      out.push(g);
    });
    return out;
  }
  function firstSentence(t, max) {
    t = String(t || '').replace(/\s+/g, ' ').trim();
    var m = /^(.+?[.!?])(\s|$)/.exec(t), s = m ? m[1] : t;
    if (s.length > max) { s = s.slice(0, max); s = s.slice(0, s.lastIndexOf(' ')).replace(/[,;:\s]+$/, '') + '…'; }
    return s;
  }
  function adjustScene(adjust, caption) {
    return { id: 'adjust', kind: 'adjust', dur: 5, title: adjust.title, items: adjust.items.map(function (i) { return { name: i[0], text: i[1] }; }),
      newsLabel: adjust.newsLabel, news: adjust.news, caption: caption || adjust.items.map(function (i) { return i[0]; }).join(', ') };
  }

  function buildScenes(sheet, adjust, meta) {
    var g = meta.group || '', f = (sheet.features || []).slice(0, 3), name = meta.name || meta.id;
    var sc = [
      { id: 'intro', kind: 'intro', dur: 2.5, title: name, text: sheet.short, caption: name + ' · ' + sheet.short },
      { id: 'problem', kind: 'problem', dur: 4, label: 'The problem', text: sheet.problem, caption: sheet.problem },
      { id: 'what', kind: 'what', dur: 4.5, label: 'What it does', text: firstSentence(sheet.what, 170), caption: 'What ' + name + ' does' },
      { id: 'who', kind: 'who', dur: 3.5, label: 'Who it’s for', text: sheet.who, caption: 'Who it’s for: ' + sheet.short }
    ];
    f.forEach(function (t, i) {
      sc.push({ id: 'feature-' + (i + 1), kind: 'feature', dur: 4.2, label: 'Key feature ' + (i + 1) + ' of ' + f.length, text: t, template: templateFor(g, i), index: i, caption: t });
    });
    sc.push({ id: 'pitch', kind: 'pitch', dur: 4, label: 'The pitch', text: sheet.pitch, caption: sheet.pitch });
    sc.push(adjustScene(adjust));
    sc.push({ id: 'cta', kind: 'cta', dur: 4, title: 'Want to see it with your own data?', book: BOOKING_URL, bookLabel: 'Book 20 minutes', openLabel: 'Open the app', openHref: meta.href || ('/' + meta.id + '/'), caption: 'Book 20 minutes, or open the app and try it' });
    return sc;
  }

  var PROMISE = 'Every tool your company runs on, in one place.';
  // each point has a small animated proof (drawn by pitch.js): devices, lock, table, swatch
  var DIFFS = [
    ['Browser apps', 'Nothing to install. Open a link on the phone or the computer.', 'devices'],
    ['Private cloud copy', 'The same data on every device, behind your own sign-in.', 'lock'],
    ['Demos with realistic data', 'Try every screen with believable numbers before you decide.', 'table'],
    ['Adjustable per company', 'Your branding, fields, workflows and language.', 'swatch']
  ];
  // demo company for the live re-brand scene (sample data only); the five things it shows come from ADJUST
  var REBRAND = { from: { name: 'Your logo', mark: 'B' }, company: 'Alpina Trade', mark: 'A', accent: '#1F7A5C',
    nav: [['Dashboard', 'Nadzorna plošča'], ['Invoices', 'Računi'], ['Customers', 'Stranke'], ['Leave', 'Dopust']], extraField: 'Cost centre', extraFieldSl: 'Stroškovno mesto' };
  function buildAllScenes(groups, adjust) {
    var n = groups.reduce(function (s, g) { return s + g.apps.length; }, 0);
    var sc = [{ id: 'intro', kind: 'allintro', dur: 7.5, title: 'Business Apps', promise: PROMISE, total: n,
      groups: groups.map(function (g) { return { id: g.id, name: g.name, count: g.apps.length, apps: g.apps.map(function (a) { return a.id; }) }; }),
      caption: PROMISE + ' ' + n + ' apps in ' + groups.length + ' groups.' }];
    groups.forEach(function (g) {
      sc.push({ id: 'group-' + g.id, kind: 'group', dur: 3.2, title: g.name, text: g.desc, count: g.apps.length, mock: g.id,
        apps: g.apps.map(function (a) { return { id: a.id, name: a.name }; }), highlight: g.apps.slice(0, 3).map(function (a) { return a.id; }), caption: g.name + ': ' + g.desc });
    });
    sc.push({ id: 'different', kind: 'different', dur: 5.5, title: 'What makes them different', items: DIFFS.map(function (d) { return { name: d[0], text: d[1], visual: d[2] }; }), caption: DIFFS.map(function (d) { return d[0]; }).join(' · ') });
    var ad = adjustScene(adjust, 'Re-branded live: logo, colours, language, company news');
    ad.dur = 6.5; ad.rebrand = REBRAND;
    sc.push(ad);
    sc.push({ id: 'cta', kind: 'cta', dur: 3.5, title: 'See it with your own company’s look', book: BOOKING_URL, bookLabel: 'Book 20 minutes', openLabel: 'Open Business Apps', openHref: '/', caption: 'Book 20 minutes, or open the apps and try them' });
    return sc;
  }

  function total(scenes) { return scenes.reduce(function (s, x) { return s + x.dur; }, 0); }
  // which scene a moment (seconds) falls in, and how far into it
  function sceneAt(scenes, t) {
    var acc = 0;
    for (var i = 0; i < scenes.length; i++) { if (t < acc + scenes[i].dur) return { index: i, local: t - acc }; acc += scenes[i].dur; }
    return { index: scenes.length - 1, local: scenes[scenes.length - 1].dur };
  }
  function startOf(scenes, i) { var s = 0; for (var k = 0; k < i; k++) s += scenes[k].dur; return s; }

  var API = { BOOKING_URL: BOOKING_URL, parseHome: parseHome, buildScenes: buildScenes, buildAllScenes: buildAllScenes, total: total, sceneAt: sceneAt, startOf: startOf, templateFor: templateFor, firstSentence: firstSentence };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.PitchScenes = API;
})(typeof window !== 'undefined' ? window : this);
