/* Branded demo editor (Studio > Branded demo). A list of the personal demo links, and a split-screen editor: settings on the
   left, the live preview on the right, drawn by the same renderer the prospect's page uses (_shared/demo-render.js).
   Talks only to the private API /api/demos (worker/demos.js, owner only). The logo is checked and shrunk here (PNG, JPEG or
   WebP in, PNG of at most 256 px out), so the server only ever stores PNG. No libraries. */
(function () {
  'use strict';
  var CAT = window.DEMO_CATALOG, STR = window.DEMO_STRINGS, R = window.DemoRender, L = window.DemoBuilderLib;
  var MAX_LOGO = 300 * 1024, DEFAULT_ACCENT = '#0f6cbd';
  var LANG_NAMES = { en: 'EN', sl: 'SL', hr: 'HR', de: 'DE' };
  var SAMPLES = {
    en: ['Opening hours over the holidays', 'We are open as usual until 23 December and again from 2 January. Urgent requests: call the service line.'],
    sl: ['Delovni čas čez praznike', 'Redno delamo do 23. decembra in spet od 2. januarja. Nujne zadeve: pokličite servisno številko.'],
    hr: ['Radno vrijeme tijekom blagdana', 'Radimo kao i obično do 23. prosinca i opet od 2. siječnja. Hitne upite uputite na servisni broj.'],
    de: ['Öffnungszeiten über die Feiertage', 'Wir sind bis zum 23. Dezember wie gewohnt da und ab dem 2. Januar wieder. Dringende Fälle: Service-Hotline.']
  };
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } return null; }

  var S = { slug: '', saved: null, dirty: false, logo: undefined, logoUrl: '', suggested: [], touchedColour: false, base: store('demo-builder-base') || '', defaults: { bookingUrl: '', days: 60 }, views: null, expired: false, busy: false, created: false };

  // ── server ──────────────────────────────────────────────────────────────────────────────────────────────
  function api(method, path, body) {
    var o = { method: method, headers: { Accept: 'application/json' }, credentials: 'same-origin' };
    if (method !== 'GET') { o.headers['X-Stratum-Apps'] = '1'; }
    if (body !== undefined) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(body); }
    return fetch(path, o).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.ok) return j;
        var e = new Error(r.status === 403 ? (j.viewer ? 'This tool is not available with view-only access.' : 'Owner access required.') : r.status === 401 ? 'Your sign-in has expired. Reload the page to sign in again.' :
          j.error === 'invalid' ? 'Please check: ' + (j.fields || []).map(function (f) { return ({ name: 'name', lang: 'language', accent: 'main colour', accent2: 'second colour', apps: 'apps', news: 'company news', booking: 'booking link', expires: 'expiry date', logo: 'logo' })[f] || f; }).join(', ') + '.' : (j.error || 'Something went wrong. Try again.'));
        e.status = r.status; throw e;
      });
    });
  }

  // ── list of demos ───────────────────────────────────────────────────────────────────────────────────────
  function fmtDay(iso) { try { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); } catch (e) { return String(iso).slice(0, 10); } }
  function linkOf(slug, quiet) { return (S.base || '') + '/d/' + slug + (quiet ? '?p=1' : ''); }
  var items = [];
  function showList() {
    $('vEdit').hidden = true; $('vList').hidden = false; $('listErr').hidden = true;
    document.title = 'Branded demo — Business Apps';
    return api('GET', '/api/demos').then(function (j) {
      items = j.demos || []; if (j.base && !S.base) S.base = j.base; S.defaults = j.defaults || S.defaults; if (j.base) S.serverBase = j.base;
      drawList();
    }, function (e) { $('list').innerHTML = ''; $('listErr').textContent = e.message; $('listErr').hidden = false; });
  }
  function drawList() {
    var el = $('list');
    if (!items.length) { el.innerHTML = '<p class="empty">No demos yet. Make one for the next prospect with “New demo”.</p>'; return; }
    el.innerHTML = items.map(function (d) {
      return '<article class="item" data-slug="' + esc(d.slug) + '"><div class="row w"><h2><a href="#' + esc(d.slug) + '">' + esc(d.name) + '</a></h2><span class="badge ' + (d.expired ? 'bd' : 'ok') + '">' + (d.expired ? 'Expired' : 'Live') + '</span></div>' +
        '<div class="meta"><span>' + esc(LANG_NAMES[d.lang] || d.lang) + ' · ' + d.apps + ' app' + (d.apps === 1 ? '' : 's') + '</span><span>' + (d.expired ? 'expired ' : 'expires ') + esc(fmtDay(d.expires)) + '</span><span>' + esc(L.viewsText(d.views)) + '</span></div>' +
        '<div class="acts"><a class="btn sm" href="#' + esc(d.slug) + '">Edit</a><button type="button" class="btn sm" data-a="copy">Copy link</button><button type="button" class="btn sm" data-a="extend">Extend 30 days</button>' +
        (d.expired ? '' : '<button type="button" class="btn sm" data-a="expire">Expire now</button>') + '<button type="button" class="btn sm bad" data-a="delete">Delete</button></div></article>';
    }).join('');
  }
  $('list').addEventListener('click', function (e) {
    var b = e.target.closest('[data-a]'); if (!b) return;
    var slug = b.closest('.item').getAttribute('data-slug'), d = items.filter(function (x) { return x.slug === slug; })[0], a = b.getAttribute('data-a');
    if (a === 'copy') return copy(linkOf(slug), b);
    if (a === 'delete') { if (!confirm('Delete the demo for “' + d.name + '”? Its link stops working and the view counter is removed.')) return; return api('DELETE', '/api/demos/' + slug).then(showList, fail('listErr')); }
    if (a === 'expire') { if (!confirm('Expire the link for “' + d.name + '” now?')) return; return api('PATCH', '/api/demos/' + slug, { expireNow: true }).then(showList, fail('listErr')); }
    if (a === 'extend') { var from = Math.max(Date.now(), Date.parse(d.expires) || 0); return api('PATCH', '/api/demos/' + slug, { expires: L.expiryIn(from, 30) }).then(showList, fail('listErr')); }
  });
  function fail(id) { return function (e) { var n = $(id); n.textContent = e.message; n.hidden = false; n.scrollIntoView({ block: 'nearest' }); }; }
  function copy(text, btn) {
    var ok = function () { var t = btn.textContent; btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = t; }, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, function () { window.prompt('Copy this link', text); });
    else window.prompt('Copy this link', text);
  }

  // ── the form ────────────────────────────────────────────────────────────────────────────────────────────
  var lang = 'en', preview = null, pvTheme = '';
  function blank() {
    return { name: '', lang: 'en', accent: DEFAULT_ACCENT, accent2: DEFAULT_ACCENT, apps: CAT.ids(), news: null, booking: S.defaults.bookingUrl || '', expires: L.expiryIn(Date.now(), S.defaults.days || 60) };
  }
  function buildStatic() {
    $('langs').innerHTML = CAT.LANGS.map(function (l) { return '<button type="button" role="radio" data-lang="' + l + '" aria-checked="false">' + LANG_NAMES[l] + '</button>'; }).join('');
    $('chips').innerHTML = CAT.offered().map(function (a) { return '<label class="chip"><input type="checkbox" value="' + esc(a.id) + '"><img src="/icons/apps/' + esc(a.id) + '.png" alt="" width="18" height="18">' + esc(a.name) + '</label>'; }).join('');
  }
  function setLang(l) { lang = l; [].forEach.call($('langs').children, function (b) { b.setAttribute('aria-checked', String(b.getAttribute('data-lang') === l)); }); }
  function setApps(list) { [].forEach.call($('chips').querySelectorAll('input'), function (i) { i.checked = list.indexOf(i.value) >= 0; }); }
  function getApps() { return [].filter.call($('chips').querySelectorAll('input'), function (i) { return i.checked; }).map(function (i) { return i.value; }); }
  function fill(c) {
    $('fName').value = c.name || ''; setLang(c.lang || 'en'); $('fAccent').value = c.accent || DEFAULT_ACCENT; $('fAccent2').value = c.accent2 || c.accent || DEFAULT_ACCENT; setApps(c.apps || []);
    $('fNT').value = c.news ? c.news.title : ''; $('fNX').value = c.news ? c.news.text : ''; $('fExp').value = String(c.expires || '').slice(0, 10); $('fBook').value = c.booking || '';
    $('fBase').value = S.base || '';
  }
  function current() {
    var t = $('fNT').value.trim(), x = $('fNX').value.trim();
    return { name: $('fName').value.trim(), lang: lang, accent: $('fAccent').value, accent2: $('fAccent2').value, apps: getApps(), news: t || x ? { title: t, text: x } : null,
      booking: $('fBook').value.trim(), expires: $('fExp').value };
  }

  // logo: checked and shrunk here
  function b64(blob) { return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(String(r.result).split(',')[1]); }; r.onerror = rej; r.readAsDataURL(blob); }); }
  function toPng(bmp, max) {
    var d = L.fit(bmp.width, bmp.height, max), c = document.createElement('canvas'); c.width = d.w; c.height = d.h;
    var x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(bmp, 0, 0, d.w, d.h);
    return new Promise(function (res) { c.toBlob(function (b) { res({ blob: b, ctx: x, w: d.w, h: d.h }); }, 'image/png'); });
  }
  function takeLogo(file) {
    var msg = $('logoMsg'); msg.textContent = ''; msg.classList.remove('err');
    if (!file) return;
    if (file.size > MAX_LOGO) { msg.textContent = 'This file is larger than 300 KB. Use a smaller logo.'; return; }
    file.arrayBuffer().then(function (buf) {
      var kind = L.sniff(new Uint8Array(buf));
      if (!kind) { msg.textContent = 'Only PNG, JPEG or WebP logos work (no SVG).'; return; }
      return createImageBitmap(new Blob([buf], { type: 'image/' + kind })).then(function (bmp) {
        return toPng(bmp, 256).then(function (r) { return r.blob.size > MAX_LOGO ? toPng(bmp, 128) : r; }).then(function (r) {
          if (r.blob.size > MAX_LOGO) { msg.textContent = 'This logo is too detailed. Use a simpler image.'; return; }
          var px = r.ctx.getImageData(0, 0, r.w, r.h).data;
          return b64(r.blob).then(function (data) {
            S.logo = data; S.logoUrl = 'data:image/png;base64,' + data; S.suggested = L.dominant(px, 5);
            msg.textContent = file.name + ' · ' + r.w + '×' + r.h + ' px, ' + Math.round(r.blob.size / 1024) + ' KB'; logoView();
            if (!S.touchedColour && S.suggested.length) { applySuggestion(0, 1); }
            touch();
          });
        });
      });
    }).catch(function () { msg.textContent = 'This image could not be read.'; });
  }
  function logoView() {
    var has = !!S.logoUrl;
    $('logoImg').hidden = !has; if (has) $('logoImg').src = S.logoUrl; $('logoRm').hidden = !has; $('bSuggest').disabled = !has;
    $('logoT').firstChild.textContent = has ? 'Logo ready. Drop another or ' : 'Drop a logo here or '; $('vLogo').textContent = has ? 'added' : '';
    drawSwatches();
  }
  function drawSwatches() {
    $('sws').innerHTML = S.suggested.map(function (c, i) { return '<button type="button" class="sw' + (c === $('fAccent').value ? ' on' : '') + '" data-i="' + i + '" style="background:' + esc(c) + '" aria-label="Use ' + esc(c) + ' as main colour" title="' + esc(c) + '"></button>'; }).join('');
  }
  function applySuggestion(i, j) { var a = S.suggested[i]; if (a) $('fAccent').value = a; var b = S.suggested[j === undefined ? 1 : j]; $('fAccent2').value = b || a || $('fAccent2').value; fixContrast(); }
  // text on the accent must be readable: darken the colour until white on it is at least 4.5:1
  function fixContrast() {
    var el = $('fAccent'), c = el.value, ratio = R.contrast(c, '#ffffff'), m = $('cMsg');
    if (ratio < 4.5) { var d = R.darkenTo(c, '#ffffff', 4.5); m.textContent = 'Darkened from ' + c + ' to ' + d + ' so white text on it is readable (' + R.contrast(d, '#ffffff').toFixed(1) + ':1).'; el.value = d; }
    else m.textContent = 'White text on the main colour: ' + ratio.toFixed(1) + ':1 (needs 4.5:1). OK.';
  }
  // the right-hand preview
  function theme() { var m = document.documentElement.getAttribute('data-stratum-mode'); return m === 'dark' ? 'dark' : 'light'; }
  function pvConfig() {
    var c = current(), n = c.news, name = c.name;
    return { name: name, lang: c.lang, accent: c.accent, accent2: c.accent2, apps: c.apps, news: n && n.title ? { title: n.title, text: n.text, date: new Date().toISOString().slice(0, 10) } : null,
      booking: /^https:\/\//.test(c.booking) ? c.booking : '', expires: c.expires ? c.expires + 'T23:59:59Z' : '', logo: !!S.logoUrl };
  }
  function drawPreview() {
    var c = pvConfig(), has = !!c.name;
    $('pvEmpty').hidden = has; $('pvHost').hidden = !has;
    $('vName').textContent = c.name; $('vLang').textContent = LANG_NAMES[c.lang]; $('vApps').textContent = c.apps.length + ' of ' + CAT.ids().length; $('vNews').textContent = c.news ? 'added' : 'none';
    $('vCol').textContent = c.accent; $('vLink').textContent = c.expires ? 'until ' + fmtDay(c.expires) : '';
    $('nCount').textContent = $('fNX').value.length + ' / 600';
    $('pvUrl').textContent = S.slug ? linkOf(S.slug).replace(/^https?:\/\//, '') : 'your link appears here once it is created';
    if (!has) return;
    if (!preview) {
      var root = $('pvHost').attachShadow({ mode: 'open' }), link = document.createElement('link'); link.rel = 'stylesheet'; link.href = '/_shared/demo-view.css?v=1'; root.appendChild(link);
      preview = R.mount(root, c, { preview: true, theme: theme(), logoUrl: S.logoUrl });
      return;
    }
    preview.set(c, { logoUrl: S.logoUrl });
  }
  window.addEventListener('stratum-theme', function () { if (preview) preview.theme(theme()); });

  function state() {
    var e = $('eState');
    if (!S.slug) { e.className = 'badge wn'; e.textContent = 'Draft'; return; }
    if (S.dirty) { e.className = 'badge wn'; e.textContent = 'Unsaved changes'; } else if (S.expired) { e.className = 'badge bd'; e.textContent = 'Expired'; } else { e.className = 'badge ok'; e.textContent = 'Saved'; }
    $('bSave').textContent = 'Save changes';
  }
  function linkView() {
    var has = !!S.slug;
    $('linkbox').hidden = !has; if (has) $('linkTx').textContent = linkOf(S.slug);
    $('bOpen').hidden = !has || !S.base; if (has && S.base) $('bOpen').href = linkOf(S.slug, true);
    $('vViews').textContent = has ? (S.expired ? 'Expired. ' : '') + L.viewsText(S.views) : 'The link is made when you create the demo.';
  }
  function touch() { S.dirty = true; $('editErr').hidden = true; drawPreview(); state(); }

  // opening and saving
  function openEditor(slug) {
    $('vList').hidden = true; $('vEdit').hidden = false; $('editErr').hidden = true; window.scrollTo(0, 0);
    S.slug = ''; S.logo = undefined; S.logoUrl = ''; S.suggested = []; S.touchedColour = false; S.dirty = false; S.views = null; S.expired = false; $('logoMsg').textContent = '';
    if (preview) { preview = null; $('pvHost').innerHTML = ''; }
    var go = function (c) { fill(c); logoView(); fixContrastQuiet(); $('eTitle').textContent = slug ? c.name : 'New demo'; document.title = (slug ? c.name : 'New demo') + ' — Branded demo'; drawPreview(); linkView(); state(); $('bSave').textContent = slug ? 'Save changes' : 'Create link'; };
    if (!slug) return Promise.resolve().then(function () { return S.defaults.bookingUrl ? null : api('GET', '/api/demos').then(function (j) { S.defaults = j.defaults || S.defaults; }).catch(function () {}); }).then(function () { go(blank()); });
    return api('GET', '/api/demos/' + slug).then(function (j) {
      S.slug = slug; S.views = j.views; S.expired = j.expired; S.touchedColour = true;
      if (j.config.logo) S.logoUrl = '/api/demos/' + slug + '/logo.png?t=' + Date.now();
      go(j.config); $('bSave').textContent = 'Save changes';
    }, function (e) { location.hash = ''; $('listErr').textContent = e.message; $('listErr').hidden = false; });
  }
  function fixContrastQuiet() { var c = $('fAccent').value; if (R.contrast(c, '#ffffff') < 4.5) { $('fAccent').value = R.darkenTo(c, '#ffffff', 4.5); } $('cMsg').textContent = ''; }
  function save() {
    if (S.busy) return;
    var c = current(), body = { name: c.name, lang: c.lang, accent: c.accent, accent2: c.accent2, apps: c.apps, news: c.news || null, booking: c.booking, expires: c.expires };
    if (!c.name) return fail('editErr')(new Error('Enter the company name first.'));
    if (!c.apps.length) return fail('editErr')(new Error('Choose at least one app.'));
    if (S.logo !== undefined) body.logo = S.logo;
    if (!S.slug && !body.expires) delete body.expires;
    S.busy = true; $('bSave').disabled = true;
    var p = S.slug ? api('PATCH', '/api/demos/' + S.slug, body) : api('POST', '/api/demos', body);
    return p.then(function (j) {
      S.slug = j.slug; S.views = j.views; S.expired = !!j.expired || Date.parse(j.config.expires) < Date.now(); S.dirty = false; S.logo = undefined; S.touchedColour = true;
      if (j.config.logo && !S.logoUrl) S.logoUrl = '/api/demos/' + j.slug + '/logo.png?t=' + Date.now();
      $('eTitle').textContent = j.config.name; if (location.hash !== '#' + j.slug) history.replaceState(null, '', '#' + j.slug);
      fill(j.config); drawPreview(); linkView(); state();
    }, fail('editErr')).then(function () { S.busy = false; $('bSave').disabled = false; });
  }

  // ── events ──────────────────────────────────────────────────────────────────────────────────────────────
  buildStatic();
  $('bNew').addEventListener('click', function () { location.hash = 'new'; });
  $('bBack').addEventListener('click', function () { if (S.dirty && !confirm('Leave without saving your changes?')) return; location.hash = ''; });
  $('bSave').addEventListener('click', save);
  $('form').addEventListener('input', function (e) {
    if (e.target.id === 'fAccent' || e.target.id === 'fAccent2') S.touchedColour = true;
    if (e.target.id === 'fBase') { S.base = e.target.value.trim().replace(/\/+$/, ''); store('demo-builder-base', S.base); linkView(); }
    if (e.target.id === 'fBase') return drawPreview();
    touch();
  });
  $('fAccent').addEventListener('change', function () { fixContrast(); drawSwatches(); touch(); });
  $('langs').addEventListener('click', function (e) { var b = e.target.closest('[data-lang]'); if (b) { setLang(b.getAttribute('data-lang')); touch(); } });
  $('sws').addEventListener('click', function (e) { var b = e.target.closest('[data-i]'); if (!b) return; S.touchedColour = true; $('fAccent').value = S.suggested[+b.getAttribute('data-i')]; fixContrast(); drawSwatches(); touch(); });
  $('bSuggest').addEventListener('click', function () { S.touchedColour = true; applySuggestion(0, 1); drawSwatches(); touch(); });
  $('chips').addEventListener('change', touch);
  $('appsAll').addEventListener('click', function () { setApps(CAT.ids()); touch(); });
  $('appsNone').addEventListener('click', function () { setApps([]); touch(); });
  $('bSample').addEventListener('click', function () { var s = SAMPLES[lang] || SAMPLES.en; $('fNT').value = s[0]; $('fNX').value = s[1]; touch(); });
  $('bCopy').addEventListener('click', function (e) { copy(linkOf(S.slug), e.currentTarget); });
  $('pvDesk').addEventListener('click', function () { $('frame').classList.remove('phone'); $('pvDesk').setAttribute('aria-pressed', 'true'); $('pvPhone').setAttribute('aria-pressed', 'false'); });
  $('pvPhone').addEventListener('click', function () { $('frame').classList.add('phone'); $('pvPhone').setAttribute('aria-pressed', 'true'); $('pvDesk').setAttribute('aria-pressed', 'false'); });
  // logo: choose, drop, remove
  $('logoFile').addEventListener('change', function (e) { takeLogo(e.target.files[0]); e.target.value = ''; });
  $('logoBrowse').addEventListener('click', function () { $('logoFile').click(); });
  $('logoBrowse').addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('logoFile').click(); } });
  ['dragenter', 'dragover'].forEach(function (n) { $('drop').addEventListener(n, function (e) { e.preventDefault(); $('drop').classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (n) { $('drop').addEventListener(n, function (e) { e.preventDefault(); $('drop').classList.remove('over'); }); });
  $('drop').addEventListener('drop', function (e) { takeLogo(e.dataTransfer.files[0]); });
  $('logoRm').addEventListener('click', function () { S.logo = null; S.logoUrl = ''; S.suggested = []; $('logoMsg').textContent = ''; logoView(); touch(); });
  window.addEventListener('beforeunload', function (e) { if (S.dirty && !$('vEdit').hidden) { e.preventDefault(); e.returnValue = ''; } });

  function route() {
    var h = decodeURIComponent(location.hash.slice(1));
    if (h === 'new') openEditor(null); else if (/^[a-z0-9-]+$/.test(h)) openEditor(h); else showList();
  }
  window.addEventListener('hashchange', route);
  // the public site's address and the default booking link come with the list; ask once, then show the page
  api('GET', '/api/demos').then(function (j) { if (j.base && !S.base) S.base = j.base; S.defaults = j.defaults || S.defaults; }, function () {}).then(route);
})();
