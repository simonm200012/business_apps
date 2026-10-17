/* Animated pitch player (/pitch/?app=<id> or /pitch/?all). Scenes come from scenes.js (pure data); this file draws them.
   Every animation is a Web Animation that is paused and driven by ONE clock (state.local), so play, pause, restart, jumping
   to a scene and freezing a frame for screenshots are all the same thing: set the time.
   Query: app=<id>|all, all, t=<seconds> (freeze at that moment), scene=<n> (freeze, 0-based, once the scene has settled),
   reduce=1 (static slides, same as prefers-reduced-motion). Keys: Space play/pause, arrows scene, R restart, F full screen. */
(function () {
  'use strict';
  var PS = window.PitchScenes, doc = document, $ = function (id) { return doc.getElementById(id); };
  var q = new URLSearchParams(location.search);
  var reduced = q.get('reduce') === '1' || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  var appId = q.has('all') || q.get('app') === 'all' ? 'all' : (q.get('app') || '');
  var stage = $('stage'), frame = $('frame'), wrap = $('wrap');
  var S = 1, portrait = false, scenes = [], meta = null;
  var st = { i: 0, local: 0, playing: false, anims: [], frozen: false, ended: false };
  var SETTLE = 450;   // ms before a scene's end: its fade-out has not started yet

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function icon(id) { return '/icons/apps/' + encodeURIComponent(id) + '.png'; }
  function rng(seed) { var h = 2166136261; String(seed).split('').forEach(function (c) { h = Math.imul(h ^ c.charCodeAt(0), 16777619); }); var a = h >>> 0;
    return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  // text that reveals word by word
  function words(text, d0, step) {
    return String(text).split(/\s+/).filter(Boolean).map(function (w, k) { return '<span class="w" data-a="up" data-d="' + (d0 + k * (step || 55)) + '" data-t="450">' + esc(w) + ' </span>'; }).join('');
  }
  function a(kind, d, t) { return ' data-a="' + kind + '" data-d="' + d + '"' + (t ? ' data-t="' + t + '"' : ''); }

  // ── scene drawings ────────────────────────────────────────────────────────────────────────────────────────
  function badge() { return meta.id === 'all' ? '' : '<div class="badge"' + a('fade', 150) + '><img src="' + icon(meta.id) + '" alt=""><span>' + esc(meta.name) + '</span></div>'; }
  function shell(sc, inner, cls, noBadge) {
    return '<section class="sc k-' + sc.kind + (cls ? ' ' + cls : '') + '" data-root>' + (noBadge ? '' : badge()) + inner +
      '<div class="cap"><span' + a('up', 250, 500) + '>' + esc(sc.caption) + '</span></div></section>';
  }
  function person(k) {
    return '<svg viewBox="0 0 64 64" class="p' + k + '"' + a('pop', 700 + k * 220, 450) + ' aria-hidden="true"><circle cx="32" cy="21" r="11" fill="currentColor"/><path d="M10 58c0-13 9-21 22-21s22 8 22 21z" fill="currentColor" opacity=".85"/></svg>';
  }
  function mock(t, text, idx) {
    var r = rng(text + idx), h = '', k, b0 = 650;
    if (t === 'bars') {
      var n = 7, hs = [];
      for (k = 0; k < n; k++) hs.push(Math.round(28 + r() * 40 + k * 4));
      hs[n - 1] = Math.max(hs[n - 1], 92);
      for (k = 0; k < n; k++) { h += '<i class="' + (k === n - 1 ? 'hi' : '') + '" style="height:' + hs[k] + '%"' + a('gy', b0 + k * 110, 600) + '></i>'; }
      return '<div class="chart">' + h + '</div><span class="tot"' + a('pop', b0 + n * 110 + 700, 400) + '>+' + (8 + Math.round(r() * 24)) + '%</span>';
    }
    if (t === 'table') {
      h = '<div class="trow h">' + [60, 50, 40, 0].map(function (w) { return w ? '<span class="sk" style="width:' + w + '%"></span>' : '<span></span>'; }).join('') + '</div>';
      var hl = 2 + Math.floor(r() * 2);
      for (k = 0; k < 5; k++) {
        h += '<div class="trow' + (k === hl ? ' hl' : '') + '"' + a('left', b0 + k * 170, 500) + '><span class="sk d" style="width:' + Math.round(55 + r() * 40) + '%"></span><span class="sk" style="width:' + Math.round(45 + r() * 45) + '%"></span><span class="sk" style="width:' + Math.round(40 + r() * 40) + '%"></span><span class="pill' + (k === hl || r() > .6 ? ' on' : '') + '">' + (k === hl || r() > .6 ? 'Done' : 'Open') + '</span></div>';
      }
      return h;
    }
    if (t === 'checks') {
      for (k = 0; k < 5; k++) {
        h += '<div class="ck"' + a('up', b0 + k * 200, 450) + '><svg viewBox="0 0 38 38"><rect class="bx" x="3" y="3" width="32" height="32" rx="8"/><path class="tick" pathLength="1" d="M10 20l6 6 12-14"' + a('draw', b0 + 450 + k * 200, 500) + '/></svg><span class="sk' + (k % 2 ? '' : ' d') + '" style="max-width:' + Math.round(55 + r() * 40) + '%"></span></div>';
      }
      return h;
    }
    // calendar
    var ev = {}; for (k = 0; k < 5; k++) ev[Math.floor(r() * 28)] = k % 2 ? 'l' : '';
    for (k = 0; k < 28; k++) h += '<div class="cd"' + a('fade', 350 + k * 18, 300) + '>' + (ev[k] !== undefined ? '<i class="ev ' + ev[k] + '"' + a('pop', b0 + 400 + k * 40, 400) + '></i>' : '') + '</div>';
    return '<div class="cal">' + h + '</div>';
  }
  var R = {
    intro: function (sc) {
      return shell(sc, '<div class="center" style="display:flex;flex-direction:column;align-items:center;gap:20px"><div class="icw" id="movable"' + a('move', Math.round(sc.dur * 1000) - 1000, 600) + '><img src="' + icon(meta.id) + '" alt=""' + a('pop', 100, 500) + '></div>' +
        '<h2 class="big">' + words(sc.title, 450, 80) + '</h2><p class="mid">' + words(sc.text, 800, 35) + '</p></div>', 'center', true);
    },
    problem: function (sc) {
      var d = '', pos = [[2, 6, -9], [34, 2, 5], [58, 22, -4], [14, 40, 7], [44, 48, -7], [70, 56, 4]];
      pos.forEach(function (p, k) {
        d += '<div class="doc" style="left:' + p[0] + '%;top:' + p[1] + '%;transform:rotate(' + p[2] + 'deg)"' + a('pop', 700 + k * 130, 400) + '><div class="docin"' + a('float', 0, 2400 + k * 330) + '><i></i><i></i><i style="width:80%"></i><i style="width:45%"></i>' + (k % 3 === 0 ? '<b>?</b>' : '') + '</div></div>';
      });
      return shell(sc, '<div class="two"><div class="txt"><div class="lab"' + a('up', 100) + '>' + esc(sc.label) + '</div><h2 class="big">' + words(sc.text, 300, 60) + '</h2></div><div class="vis"><div class="chaos">' + d + '</div></div></div>');
    },
    what: function (sc) {
      return shell(sc, '<div class="two"><div class="vis"><img class="ic" src="' + icon(meta.id) + '" alt=""' + a('pop', 250, 500) + '><span class="nm"' + a('up', 500) + '>' + esc(meta.name) + '</span></div>' +
        '<div class="txt"><div class="lab"' + a('up', 100) + '>' + esc(sc.label) + '</div><div class="rule"' + a('gx', 300, 500) + '></div><p class="mid">' + words(sc.text, 550, 45) + '</p></div></div>', '', true);
    },
    who: function (sc) {
      return shell(sc, '<div class="lab"' + a('up', 100) + '>' + esc(sc.label) + '</div><h2 class="big">' + words(sc.text, 300, 60) + '</h2><div class="people">' + person(0) + person(1) + person(2) + '</div>');
    },
    feature: function (sc) {
      var pips = ''; for (var k = 0; k < 3; k++) pips += '<i class="' + (k <= sc.index ? 'on' : '') + '"></i>';
      return shell(sc, '<div class="two"><div class="txt"><div class="lab"' + a('up', 100) + '>' + esc(sc.label) + '</div><div class="pips"' + a('fade', 200) + '>' + pips + '</div><p class="mid">' + words(sc.text, 300, 60) + '</p></div>' +
        '<div class="vis"><div class="win"' + a('pop', 350, 500) + '><div class="wbar"><b></b><b></b><b></b><i></i></div><div class="wbody">' + mock(sc.template, sc.text, sc.index) + '</div></div></div></div>');
    },
    pitch: function (sc) {
      return shell(sc, '<div class="lab"' + a('up', 100) + '>' + esc(sc.label) + '</div><div class="quote"><div class="bar2"' + a('gy2', 250, 600) + '></div><h2 class="big">' + words(sc.text, 450, 70) + '</h2></div>');
    },
    adjust: function (sc) {
      var cards = sc.items.map(function (it, k) { return '<div class="card"' + a('pop', 500 + k * 230, 450) + '><b><i class="dot"></i>' + esc(it.name) + '</b><span>' + esc(it.text) + '</span></div>'; }).join('');
      cards += '<div class="card news"' + a('pop', 500 + sc.items.length * 230, 450) + '><b>' + esc(sc.newsLabel) + '</b><span>' + esc(sc.news) + '</span></div>';
      return shell(sc, '<h2 class="big">' + words(sc.title, 150, 55) + '</h2><div class="grid3">' + cards + '</div>');
    },
    cta: function (sc) {
      var url = sc.book.replace(/^https?:\/\//, '');
      return shell(sc, (meta.id === 'all' ? '' : '<img class="ic" src="' + icon(meta.id) + '" alt=""' + a('pop', 100, 400) + '>') + '<h2 class="big">' + words(sc.title, 250, 60) + '</h2>' +
        '<div class="actions"' + a('up', 900) + '><a class="btn pri cb" href="' + esc(sc.book) + '" target="_blank" rel="noopener">' + esc(sc.bookLabel) + '</a><a class="btn cb" href="' + esc(sc.openHref) + '">' + esc(sc.openLabel) + '</a></div>' +
        '<p class="url"' + a('fade', 1300) + '>' + esc(url) + '</p>', '', true);
    },
    allintro: function (sc) {
      var im = sc.icons.map(function (id, k) { return '<img src="' + icon(id) + '" alt=""' + a('pop', 150 + k * 70, 400) + '>'; }).join('');
      var ch = sc.groups.map(function (g, k) { return '<span' + a('up', 1100 + k * 90, 400) + '>' + esc(g) + '</span>'; }).join('');
      return shell(sc, '<div class="icons">' + im + '</div><h2 class="big" style="text-align:center">' + words(sc.title, 700, 70) + '</h2><div class="gchips">' + ch + '</div>', 'center', true);
    },
    group: function (sc) {
      var max = portrait ? 12 : 12, shown = sc.apps.slice(0, max), more = sc.apps.length - shown.length;
      var g = shown.map(function (x, k) { return '<div' + a('pop', 500 + k * 90, 400) + '><img src="' + icon(x.id) + '" alt=""><span>' + esc(x.name) + '</span></div>'; }).join('');
      if (more > 0) g += '<div' + a('pop', 500 + shown.length * 90, 400) + '><span class="count">+' + more + ' more</span></div>';
      return shell(sc, '<div class="lab"' + a('up', 100) + '>' + sc.count + ' apps</div><h2 class="big">' + words(sc.title, 250, 80) + '</h2><p class="mid" style="font-size:32px;line-height:44px;font-weight:500;color:var(--ink2)">' + words(sc.text, 450, 40) + '</p><div class="agrid">' + g + '</div>', '', true);
    },
    different: function (sc) {
      var c = sc.items.map(function (it, k) { return '<div class="card"' + a('pop', 500 + k * 450, 450) + '><b><i class="dot"></i>' + esc(it.name) + '</b><span>' + esc(it.text) + '</span></div>'; }).join('');
      return shell(sc, '<h2 class="big">' + words(sc.title, 150, 70) + '</h2><div class="grid2">' + c + '</div>', '', true);
    }
  };

  // ── animations ────────────────────────────────────────────────────────────────────────────────────────────
  var EASE = 'cubic-bezier(.2,.7,.2,1)';
  var KF = {
    up: [{ opacity: 0, transform: 'translateY(18px)' }, { opacity: 1, transform: 'none' }],
    fade: [{ opacity: 0 }, { opacity: 1 }],
    pop: [{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'none' }],
    left: [{ opacity: 0, transform: 'translateX(-36px)' }, { opacity: 1, transform: 'none' }],
    gx: [{ transform: 'scaleX(0)' }, { transform: 'none' }],
    gy: [{ transform: 'scaleY(0)' }, { transform: 'none' }],
    gy2: [{ transform: 'scaleY(0)' }, { transform: 'none' }],
    draw: [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }]
  };
  function arm(root) {
    var list = [];
    [].forEach.call(root.querySelectorAll('[data-a]'), function (el) {
      var kind = el.getAttribute('data-a'), d = +el.getAttribute('data-d') || 0, t = +el.getAttribute('data-t') || 600, an;
      if (kind === 'float') {
        an = el.animate([{ transform: 'translate(0,0) rotate(-3deg)' }, { transform: 'translate(10px,-14px) rotate(3deg)' }], { duration: t, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out', fill: 'both' });
      } else if (kind === 'move') {
        var r = el.getBoundingClientRect(), s = r.width / el.offsetWidth || S, sr = stage.getBoundingClientRect();
        var cx = (r.left + r.width / 2 - sr.left) / S, cy = (r.top + r.height / 2 - sr.top) / S, k = 40 / el.offsetWidth;
        an = el.animate([{ transform: 'none' }, { transform: 'translate(' + (76 - cx) + 'px,' + (60 - cy) + 'px) scale(' + k + ')' }], { delay: d, duration: t, easing: 'cubic-bezier(.6,0,.2,1)', fill: 'both' });
      } else {
        an = el.animate(KF[kind] || KF.fade, { delay: d, duration: t, easing: EASE, fill: 'both' });
      }
      an.pause(); list.push(an);
    });
    return list;
  }
  function show(i) {
    var sc = scenes[i], dur = sc.dur * 1000;
    st.i = i;
    stage.innerHTML = R[sc.kind](sc);
    var root = stage.firstChild;
    var last = i === scenes.length - 1, o = [{ opacity: 0, offset: 0 }, { opacity: 1, offset: Math.min(.4, 350 / dur) }];
    if (!last) { o.push({ opacity: 1, offset: 1 - 400 / dur }); o.push({ opacity: 0, offset: 1 }); } else o.push({ opacity: 1, offset: 1 });
    var fade = root.animate(o, { duration: dur, fill: 'both' }); fade.pause();
    st.anims = arm(root); st.anims.push(fade);
    [].forEach.call($('dots').children, function (b, k) { if (k === i) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); });
    $('prev').disabled = i === 0; $('next').disabled = i === scenes.length - 1;
  }
  function apply() { var t = st.local; st.anims.forEach(function (an) { an.currentTime = t; }); ui(); }
  function settle(i) { return Math.max(0, scenes[i].dur * 1000 - SETTLE); }
  function go(i, local) { i = Math.max(0, Math.min(scenes.length - 1, i)); show(i); st.local = local == null ? (reduced ? settle(i) : 0) : local; st.ended = false; apply(); }
  function fmt(s) { s = Math.floor(s); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
  function ui() {
    var tot = PS.total(scenes), now = PS.startOf(scenes, st.i) + st.local / 1000;
    $('progFill').style.transform = 'scaleX(' + Math.min(1, reduced ? (st.i + 1) / scenes.length : now / tot) + ')';
    $('clock').textContent = reduced ? (st.i + 1) + ' / ' + scenes.length : fmt(now) + ' / ' + fmt(tot);
    var pp = $('pp'), lab = st.playing ? 'Pause' : (st.ended ? 'Replay' : 'Play');
    pp.textContent = lab; pp.setAttribute('aria-label', lab);
  }
  var last = 0;
  function tick(ts) {
    requestAnimationFrame(tick);
    var dt = Math.min(100, ts - last); last = ts;
    if (!st.playing) return;
    st.local += dt;
    var dur = scenes[st.i].dur * 1000;
    if (st.local >= dur) {
      if (st.i < scenes.length - 1) { show(st.i + 1); st.local = st.local - dur; }
      else { st.local = dur; st.playing = false; st.ended = true; }
    }
    apply();
  }
  function play() { if (reduced) return; if (st.ended) go(0, 0); st.playing = true; ui(); }
  function pause() { st.playing = false; ui(); }
  function toggle() { if (st.playing) pause(); else play(); }
  function restart() { go(0, 0); if (!reduced) st.playing = true; ui(); }
  function jump(i) { var was = st.playing || st.ended; go(i); if (!reduced && was) st.playing = true; ui(); }

  // ── layout ────────────────────────────────────────────────────────────────────────────────────────────────
  function fit() {
    var aw = wrap.clientWidth - 24, ah = wrap.clientHeight - 4, p = aw < ah, W = p ? 720 : 1280, H = p ? 1280 : 720;
    S = Math.max(.05, Math.min(aw / W, ah / H));
    frame.style.width = Math.floor(W * S) + 'px'; frame.style.height = Math.floor(H * S) + 'px';
    stage.style.transform = 'scale(' + S + ')';
    if (p !== portrait) { portrait = p; stage.classList.toggle('portrait', p); if (scenes.length) { var l = st.local, pl = st.playing; show(st.i); st.local = l; st.playing = pl; apply(); } }
  }

  // ── start ─────────────────────────────────────────────────────────────────────────────────────────────────
  function picker(groups) {
    $('ttl').textContent = 'Pitch';
    $('wrap').innerHTML = '<div class="picker"><h2>Choose a pitch</h2><a class="btn pri" href="/pitch/?all">Business Apps in 40 seconds</a><ul>' +
      groups.reduce(function (l, g) { return l.concat(g.apps); }, []).map(function (x) { return '<li><a href="/pitch/?app=' + esc(x.id) + '">' + esc(x.name) + '</a></li>'; }).join('') + '</ul></div>';
    $('prog').hidden = true; doc.querySelector('.row').hidden = true;
  }
  function start(groups) {
    var adjust = window.AppSheetPanel.ADJUST, SH = window.APP_SHEETS || {};
    if (appId === 'all') { meta = { id: 'all', name: 'Business Apps' }; scenes = PS.buildAllScenes(groups, adjust); $('ttl').textContent = 'Business Apps in 40 seconds'; }
    else {
      var found = null;
      groups.forEach(function (g) { g.apps.forEach(function (x) { if (x.id === appId) found = { id: x.id, name: x.name, group: g.id, href: new URL(x.href, location.origin + '/').pathname }; }); });
      if (!SH[appId]) return picker(groups);
      meta = found || { id: appId, name: appId, group: '', href: '/' + appId + '/' };
      scenes = PS.buildScenes(SH[appId], adjust, meta); $('ttl').textContent = meta.name + ' · pitch';
    }
    doc.title = $('ttl').textContent + ' — Business Apps';
    var dots = $('dots');
    scenes.forEach(function (sc, k) { var b = doc.createElement('button'); b.type = 'button'; b.setAttribute('aria-label', 'Scene ' + (k + 1) + ' of ' + scenes.length + ': ' + (sc.label || sc.title || sc.id)); b.addEventListener('click', function () { jump(k); }); dots.appendChild(b); });
    $('prev').hidden = $('next').hidden = !reduced; $('pp').hidden = reduced;
    fit();
    var t = q.get('t'), sn = q.get('scene');
    if (t !== null && t !== '' && !isNaN(+t)) { var at = PS.sceneAt(scenes, +t); go(at.index, at.local * 1000); st.frozen = true; }
    else if (sn !== null && sn !== '' && !isNaN(+sn)) { var n = Math.max(0, Math.min(scenes.length - 1, +sn)); go(n, settle(n)); st.frozen = true; }
    else { go(0); if (!reduced) st.playing = true; }
    ui(); requestAnimationFrame(function (ts) { last = ts; tick(ts); });
  }

  $('pp').addEventListener('click', toggle);
  $('rs').addEventListener('click', function () { st.frozen = false; restart(); });
  $('prev').addEventListener('click', function () { go(st.i - 1); });
  $('next').addEventListener('click', function () { go(st.i + 1); });
  $('back').addEventListener('click', function (e) {
    try { if (history.length > 1 && doc.referrer && new URL(doc.referrer).origin === location.origin) { e.preventDefault(); history.back(); } } catch (x) {}
  });
  var fsOk = doc.fullscreenEnabled || doc.webkitFullscreenEnabled;
  function fsToggle() {
    if (doc.fullscreenElement || doc.webkitFullscreenElement) (doc.exitFullscreen || doc.webkitExitFullscreen).call(doc);
    else { var el = $('app'); (el.requestFullscreen || el.webkitRequestFullscreen).call(el); }
  }
  if (!fsOk) $('fs').hidden = true; else $('fs').addEventListener('click', fsToggle);
  doc.addEventListener('fullscreenchange', function () { setTimeout(fit, 50); });
  doc.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey || !scenes.length) return;
    var tag = (e.target.tagName || '').toLowerCase();
    if (e.key === ' ' && (tag === 'button' || tag === 'a')) { if (tag === 'a') return; }
    if (e.key === ' ' || e.key === 'k') { e.preventDefault(); if (reduced) go(st.i + 1); else toggle(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); jump(st.i + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); jump(st.i - 1); }
    else if (e.key === 'r' || e.key === 'R') { st.frozen = false; restart(); }
    else if ((e.key === 'f' || e.key === 'F') && fsOk) fsToggle();
    else if (e.key === 'Escape' && !(doc.fullscreenElement || doc.webkitFullscreenElement)) $('back').click();
  });
  doc.addEventListener('visibilitychange', function () { if (doc.hidden && st.playing) pause(); });
  window.addEventListener('resize', fit);

  fetch('/', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.text() : ''; }).catch(function () { return ''; })
    .then(function (html) { start(PS.parseHome(html)); });
})();
