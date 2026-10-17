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
  // ── overview building blocks ──────────────────────────────────────────────────────────────────────────────
  function cnt(to, d, t, pre, suf) { return '<span data-a="count" data-d="' + d + '" data-t="' + (t || 900) + '" data-to="' + to + '" data-pre="' + (pre || '') + '" data-suf="' + (suf || '') + '">' + (pre || '') + to + (suf || '') + '</span>'; }
  function swap(from, to, d) { return '<span class="sw"><span' + a('out', d, 300) + '>' + esc(from) + '</span><span' + a('in', d + 120, 400) + '>' + esc(to) + '</span></span>'; }
  function rc(props, to, d, t) { return ' data-a="rc" data-p="' + props + '" data-to="' + to + '" data-d="' + d + '" data-t="' + (t || 500) + '"'; }
  function win(inner, d) { return '<div class="win"' + a('pop', d == null ? 300 : d, 500) + '><div class="wbar"><b></b><b></b><b></b><i></i></div><div class="wbody">' + inner + '</div></div>'; }
  function allIntro(sc) {
    var P = portrait, W = P ? 720 : 1280, ico = P ? 56 : 60, gap = P ? 10 : 12, pitch = ico + gap, ccols = P ? 2 : 3, pad = P ? 56 : 80;
    var top = P ? 250 : 168, bottom = P ? 1130 : 616, cw = (W - 2 * pad) / ccols, crow = Math.ceil(sc.groups.length / ccols), ch = (bottom - top) / crow;
    var per = Math.max(1, Math.floor(cw / pitch)), gcols = P ? 6 : 10, gp = P ? 96 : 84, gscale = P ? 1.5 : 1.3;
    var flat = [], items = '', labels = '', r = rng('montage');
    sc.groups.forEach(function (g, gi) { g.apps.forEach(function (id) { flat.push({ id: id, g: gi, k: g.apps.indexOf(id) }); }); });
    var rows = Math.ceil(flat.length / gcols), gx0 = (W - gcols * gp) / 2 + (gp - ico) / 2, gy0 = top + ((bottom - top) - rows * gp) / 2 + (gp - ico) / 2 + 10;
    flat.forEach(function (x, n) {
      var cx = pad + (x.g % ccols) * cw, cy = top + Math.floor(x.g / ccols) * ch, fx = cx + (x.k % per) * pitch, fy = cy + 44 + Math.floor(x.k / per) * pitch;
      var tx = gx0 + (n % gcols) * gp, ty = gy0 + Math.floor(n / gcols) * gp, ang = r() * 6.283, rad = 600 + r() * 300;
      items += '<img class="fly" src="' + icon(x.id) + '" alt="" style="left:' + fx + 'px;top:' + fy + 'px;width:' + ico + 'px;height:' + ico + 'px"' +
        ' data-a="fly" data-d="' + (2900 + n * 26) + '" data-t="2700" data-sx="' + Math.round(Math.cos(ang) * rad) + '" data-sy="' + Math.round(Math.sin(ang) * rad) + '" data-gx="' + Math.round(tx - fx) + '" data-gy="' + Math.round(ty - fy) + '" data-gs="' + gscale + '">';
    });
    sc.groups.forEach(function (g, gi) {
      var cx = pad + (gi % ccols) * cw, cy = top + Math.floor(gi / ccols) * ch;
      labels += '<div class="glab" style="left:' + cx + 'px;top:' + cy + 'px;width:' + (cw - 16) + 'px"' + a('up', 5500 + gi * 100, 500) + '><span>' + esc(g.name) + '</span>' + cnt(g.count, 5600 + gi * 100, 700) + '</div>';
    });
    return shell(sc, '<div class="hero"' + a('fadeout', 3100, 500) + '><img class="mark" src="/icons/icon.svg" alt=""' + a('pop', 150, 600) + '><div class="wm"' + a('up', 450, 500) + '>' + esc(sc.title) + '</div><h2 class="big prom">' + words(sc.promise, 900, 150) + '</h2></div>' +
      '<div class="mh"' + a('up', 3400, 600) + '>' + cnt(sc.total, 3500, 1200) + ' apps in ' + sc.groups.length + ' groups</div><div class="mont">' + items + labels + '</div>', 'allintro', true);
  }
  function groupScene(sc) {
    var chips = sc.highlight.map(function (id, k) {
      var ap = sc.apps.filter(function (x) { return x.id === id; })[0];
      return '<span class="hchip"' + a('left', 650 + k * 160, 500) + '><img src="' + icon(id) + '" alt="">' + esc(ap ? ap.name : id) + '</span>';
    }).join('');
    var rest = sc.apps.filter(function (x) { return sc.highlight.indexOf(x.id) < 0; }).map(function (x, k) { return '<img src="' + icon(x.id) + '" alt="" title="' + esc(x.name) + '"' + a('pop', 1100 + k * 60, 350) + '>'; }).join('');
    return shell(sc, '<div class="two gtwo"><div class="txt"><div class="lab"' + a('up', 100) + '>' + cnt(sc.count, 150, 700) + ' apps</div><h2 class="big">' + words(sc.title, 200, 80) + '</h2>' +
      '<p class="gdesc">' + words(sc.text, 400, 35) + '</p><div class="hchips">' + chips + '</div><div class="rest">' + rest + '</div></div>' +
      '<div class="vis gvis">' + win(gmock(sc.mock), 250) + '</div></div>', '', true);
  }
  function gmock(id) {
    var h = '', k;
    if (id === 'finance') {
      var pill = function (d) { return '<span class="pill">' + swap('Open', 'Paid', d) + '</span>'; };
      var rows = ''; for (k = 0; k < 3; k++) rows += '<div class="irow"' + a('left', 700 + k * 150, 450) + '><i class="av"></i><span class="sk d" style="width:' + (62 - k * 9) + '%"></span><span class="sk" style="width:' + (60 - k * 6) + '%"></span><span class="pill' + (k ? ' on' : '') + '">' + (k ? 'Paid' : swap('Open', 'Paid', 1700)) + '</span></div>';
      return '<div class="fin"><div class="lcw"><svg viewBox="0 0 440 120" preserveAspectRatio="none"><path class="gl" d="M0 30H440M0 70H440M0 110H440"/><path class="ar"' + a('fade', 1500, 600) + ' d="M0 100C40 92 70 96 110 78S180 70 220 56 300 62 340 36 410 24 440 14V120H0Z"/><path class="ln" pathLength="1"' + a('draw', 500, 1300) + ' d="M0 100C40 92 70 96 110 78S180 70 220 56 300 62 340 36 410 24 440 14"/></svg><span class="tot">' + cnt(12, 1500, 800, '+', '%') + '</span></div>' + rows + '</div>';
    }
    if (id === 'sales') {
      var kc = function (cls, d, extra) { return '<div class="kc ' + cls + '"' + (extra || a('pop', d, 400)) + '><i class="av"></i><span class="sk d" style="width:70%"></span><span class="sk" style="width:48%"></span></div>'; };
      return '<div class="board"><div class="bcol"><span class="sk h"></span>' + kc('', 450) + kc('mv1', 600, ' data-a="mv" data-x="calc(100% + 36px)" data-d="1000" data-t="700"') + kc('', 750) + '</div>' +
        '<div class="bcol"><span class="sk h"></span>' + kc('mv2', 650, ' data-a="mv" data-x="calc(100% + 36px)" data-d="1500" data-t="700"') + '</div>' +
        '<div class="bcol"><span class="sk h"></span><span class="won"' + a('pop', 2000, 400) + '>Won</span></div></div>';
    }
    if (id === 'operations') {
      for (k = 0; k < 4; k++) h += '<div class="ck"' + a('up', 450 + k * 180, 400) + '><svg viewBox="0 0 38 38"><rect class="bx" x="3" y="3" width="32" height="32" rx="8"/><path class="tick" pathLength="1" d="M10 20l6 6 12-14"' + a('draw', 900 + k * 420, 450) + '/></svg><span class="sk' + (k % 2 ? '' : ' d') + '" style="max-width:' + (60 + k * 8) + '%"></span></div>';
      return '<div class="ops"><div class="oc">' + h + '</div><div class="map"' + a('fade', 400, 500) + '><svg viewBox="0 0 200 260" preserveAspectRatio="none"><path d="M0 70C60 60 90 110 200 90M40 0C50 80 30 160 60 260M120 0C110 90 150 170 140 260M0 190C80 180 120 210 200 170" /></svg>' +
        '<i class="pin" style="left:78%;top:18%"' + a('pop', 700, 400) + '></i><i class="pin" style="left:22%;top:70%"' + a('pop', 850, 400) + '></i><i class="pin hi" style="left:68%;top:78%"' + a('pop', 1000, 400) + '></i>' +
        '<i class="pk" style="left:20%;top:20%"' + ' data-a="mv" data-x="130px" data-y="70px" data-d="1300" data-t="1500"></i><i class="pk" style="left:12%;top:66%"' + ' data-a="mv" data-x="90px" data-y="12px" data-d="1700" data-t="1300"></i></div></div>';
    }
    if (id === 'people') {
      var bl = [[[10, 30, 0], [62, 24, 1]], [[34, 36, 1]], [[0, 22, 0], [48, 30, 0]], [[20, 28, 1], [74, 18, 0]]], ppl = '';
      for (k = 0; k < 4; k++) {
        ppl += '<div class="prow"' + a('left', 350 + k * 120, 450) + '><i class="av"></i><div class="trk">' + bl[k].map(function (b, j) { return '<i class="lv' + (b[2] ? ' l' : '') + '" style="left:' + b[0] + '%;width:' + b[1] + '%"' + a('gx', 900 + k * 260 + j * 200, 600) + '></i>'; }).join('') + '</div></div>';
      }
      var days = ''; for (k = 0; k < 10; k++) days += '<span class="sk"></span>';
      return '<div class="ppl"><div class="days">' + days + '</div>' + ppl + '<div class="leg"' + a('up', 2300, 400) + '><i></i> approved <i class="l"></i> waiting</div></div>';
    }
    if (id === 'insights') {
      var kp = [[128, '', '', 600], [94, '', '%', 760], [38, '€', 'k', 920]].map(function (x) { return '<div class="kpi"' + a('up', x[3], 450) + '><b>' + cnt(x[0], x[3] + 100, 1100, x[1], x[2]) + '</b><span class="sk"></span></div>'; }).join('');
      var bars = ''; [38, 52, 44, 66, 58, 80, 94].forEach(function (v, j) { bars += '<i class="' + (j === 6 ? 'hi' : '') + '" style="height:' + v + '%"' + a('gy', 900 + j * 90, 600) + '></i>'; });
      return '<div class="ins"><div class="kpis">' + kp + '</div><div class="ibot"><div class="chart ibars">' + bars + '</div><svg class="donut" viewBox="0 0 100 100"><circle class="trk0" cx="50" cy="50" r="38"/><circle class="arc" cx="50" cy="50" r="38" pathLength="100" stroke-dasharray="68 100"' + a('ring', 1400, 1200) + ' data-len="68"/><circle class="arc b" cx="50" cy="50" r="38" pathLength="100" stroke-dasharray="20 100" transform="rotate(245 50 50)"' + a('ring', 1900, 800) + ' data-len="20"/></svg></div></div>';
    }
    // studio: a small website
    return '<div class="site"><div class="snav"><i class="lg"' + a('pop', 350, 400) + '></i><span class="sk"></span><span class="sk"></span><span class="sk"></span><b class="pub"' + a('pop', 2000, 450) + '>Published</b></div>' +
      '<div class="hero2"><div class="ht"><span class="sk d hb"' + a('gx', 600, 600) + '></span><span class="sk d hb s"' + a('gx', 800, 600) + '></span><span class="sk"' + a('gx', 1100, 500) + ' style="width:80%"></span><span class="sk"' + a('gx', 1200, 500) + ' style="width:60%"></span><i class="cta"' + a('pop', 1600, 450) + '></i></div>' +
      '<div class="himg"' + a('left', 700, 700) + '><svg viewBox="0 0 120 90"><path d="M0 90L34 40l22 28 20-30 44 52z"/><circle cx="92" cy="20" r="9"/></svg></div></div>' +
      '<div class="scards">' + [0, 1, 2].map(function (j) { return '<i' + a('up', 1900 + j * 160, 450) + '></i>'; }).join('') + '</div></div>';
  }
  function proof(kind, d) {
    var h = '', k;
    if (kind === 'devices') {
      var bars = function (o) { var s = ''; [46, 70, 56, 88].forEach(function (v, j) { s += '<i class="' + (j === 3 ? 'hi' : '') + '" style="height:' + v + '%"' + a('gy', d + o + j * 140, 500) + '></i>'; }); return s; };
      return '<div class="dev"><div class="lap"><div class="scr">' + bars(0) + '</div></div><div class="pho"><div class="scr">' + bars(260) + '</div></div></div>';
    }
    if (kind === 'lock') {
      return '<svg class="lockv" viewBox="0 0 120 100"><path class="shk" d="M43 46V32a17 17 0 0 1 34 0v14"' + a('lock', d, 700) + '/><rect class="lb" x="32" y="46" width="56" height="42" rx="9"/><circle class="lk" cx="60" cy="64" r="5.5"/><path class="lk" d="M60 66v10" stroke-width="5" stroke-linecap="round"/></svg>' +
        '<span class="dots3"' + a('fade', d + 800, 300) + '><i></i><i></i><i></i><i></i></span>';
    }
    if (kind === 'table') {
      for (k = 0; k < 4; k++) h += '<div class="tr3"' + a('left', d + k * 220, 400) + '><span class="sk d" style="width:' + (62 - k * 7) + '%"></span><b>' + cnt([1240, 860, 2310, 590][k], d + k * 220 + 100, 800, '€') + '</b></div>';
      return '<div class="tb3">' + h + '</div>';
    }
    return '<div class="sws"><i class="sa"' + rc('backgroundColor', '#1F7A5C', d, 500) + '></i><i class="sb"' + rc('backgroundColor', '#B5532B', d + 500, 500) + '></i><i class="sc2"' + rc('backgroundColor', '#6C4DF0', d + 1000, 500) + '></i></div>';
  }
  function rebrand(sc) {
    var rb = sc.rebrand, T = { brand: 1500, fields: 2300, flow: 3000, lang: 3700, news: 4600 };
    var order = ['brand', 'fields', 'flow', 'lang', 'news'];
    var chips = sc.items.map(function (it, k) {
      return '<span class="rchip"' + a('left', 300 + k * 110, 450) + '><i class="chk"' + rc('backgroundColor,borderColor', 'var(--acc)', T[order[k]], 400) + '></i>' + esc(it.name) + '</span>';
    }).join('');
    var nav = rb.nav.map(function (n, k) { return '<div class="nv' + (k === 1 ? ' on' : '') + '"' + a('left', 600 + k * 90, 400) + '>' + (k === 1 ? '<u' + rc('backgroundColor', rb.accent, T.brand, 500) + '></u>' : '') + swap(n[0], n[1], T.lang) + '</div>'; }).join('');
    var rows = ''; for (var k = 0; k < 3; k++) {
      rows += '<div class="rrow"' + a('left', 900 + k * 130, 400) + '><span class="sk d" style="width:' + (66 - k * 8) + '%"></span><span class="sk" style="width:50%"></span><span class="cc"' + a('fade', T.fields, 400) + '>CC-' + (14 + k) + '</span><span class="pill on"' + rc('borderColor,color', rb.accent, T.brand, 500) + '>' + swap('Open', 'Approved', T.flow) + '</span></div>';
    }
    var win2 = '<div class="win rb"' + a('pop', 350, 500) + '><div class="wbar"><b></b><b></b><b></b><i></i></div><div class="rbody"><aside><div class="brand"><span class="mk"' + rc('backgroundColor', rb.accent, T.brand, 500) + '><span class="sw"><span' + a('out', T.brand, 300) + '>' + esc(rb.from.mark) + '</span><span' + a('in', T.brand + 120, 400) + '>' + esc(rb.mark) + '</span></span></span><span class="bn">' + swap(rb.from.name, rb.company, T.brand) + '</span></div>' + nav + '</aside>' +
      '<section><div class="rhead"><span class="sk d" style="width:34%"></span><i class="rbtn"' + rc('backgroundColor', rb.accent, T.brand, 500) + '></i></div><div class="rcols"><span class="sk"></span><span class="sk"></span><span class="ccl"' + a('fade', T.fields, 400) + '>' + swap(rb.extraField, rb.extraFieldSl, T.lang) + '</span><span class="sk"></span></div>' + rows +
      '<div class="rnews"' + ' data-a="slideup" data-d="' + T.news + '" data-t="650"><b' + rc('color', rb.accent, T.brand, 500) + '>' + esc(sc.newsLabel) + '</b><span>' + esc(sc.news) + '</span></div></section></div></div>';
    return shell(sc, '<div class="two rtwo"><div class="txt"><h2 class="big">' + words(sc.title, 150, 55) + '</h2><div class="rchips">' + chips + '</div></div><div class="vis">' + win2 + '</div></div>', '', true);
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
    allintro: function (sc) { return allIntro(sc); },
    group: function (sc) { return groupScene(sc); },
    different: function (sc) {
      var c = sc.items.map(function (it, k) {
        return '<div class="card pc"' + a('pop', 450 + k * 380, 450) + '><div class="pv">' + proof(it.visual, 450 + k * 380 + 300) + '</div><div class="pt"><b>' + esc(it.name) + '</b><span>' + esc(it.text) + '</span></div></div>';
      }).join('');
      return shell(sc, '<h2 class="big">' + words(sc.title, 150, 70) + '</h2><div class="grid2">' + c + '</div>', '', true);
    }
  };
  // the adjust scene of the overview is the live re-brand
  var adjustPlain = R.adjust;
  R.adjust = function (sc) { return sc.rebrand ? rebrand(sc) : adjustPlain(sc); };

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
    draw: [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }],
    out: [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-8px)' }],
    in: [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }],
    fadeout: [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-14px)' }],
    slideup: [{ opacity: 0, transform: 'translateY(60px)' }, { opacity: 1, transform: 'none' }],
    lock: [{ transform: 'translateY(-9px)' }, { transform: 'none' }]
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
      } else if (kind === 'fly') {
        var g = el.getAttribute.bind(el), sx = +g('data-sx'), sy = +g('data-sy'), gx = +g('data-gx'), gy = +g('data-gy'), gs = +g('data-gs');
        an = el.animate([
          { offset: 0, opacity: 0, transform: 'translate(' + sx + 'px,' + sy + 'px) scale(.35)', easing: 'cubic-bezier(.15,.7,.2,1)' },
          { offset: .05, opacity: 1, transform: 'translate(' + sx * .95 + 'px,' + sy * .95 + 'px) scale(.4)', easing: 'cubic-bezier(.15,.7,.2,1)' },
          { offset: .45, opacity: 1, transform: 'translate(' + gx + 'px,' + gy + 'px) scale(' + gs + ')', easing: 'linear' },
          { offset: .6, opacity: 1, transform: 'translate(' + gx + 'px,' + gy + 'px) scale(' + gs + ')', easing: 'cubic-bezier(.6,0,.2,1)' },
          { offset: 1, opacity: 1, transform: 'none' }], { delay: d, duration: t, fill: 'both' });
      } else if (kind === 'mv') {
        var mx = el.getAttribute('data-x') || '0px', my = el.getAttribute('data-y') || '0px';
        an = el.animate([{ transform: 'none' }, { transform: 'translate(' + mx + ',' + my + ')' }], { delay: d, duration: t, easing: 'cubic-bezier(.5,0,.2,1)', fill: 'both' });
      } else if (kind === 'rc') {
        var to = el.getAttribute('data-to'), kfs = [{}, {}];
        el.getAttribute('data-p').split(',').forEach(function (pr) { kfs[0][pr] = getComputedStyle(el)[pr]; kfs[1][pr] = to; });
        an = el.animate(kfs, { delay: d, duration: t, easing: 'ease-in-out', fill: 'both' });
      } else if (kind === 'ring') {
        var len = +el.getAttribute('data-len');
        an = el.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { delay: d, duration: t, easing: 'cubic-bezier(.3,.6,.2,1)', fill: 'both' });
      } else if (kind === 'count') {
        an = el.animate([{ opacity: 1 }, { opacity: 1 }], { delay: d, duration: t, fill: 'both' });
        an.cnt = { el: el, d: d, t: t, to: +el.getAttribute('data-to'), pre: el.getAttribute('data-pre') || '', suf: el.getAttribute('data-suf') || '' };
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
    var last = i === scenes.length - 1, o = [{ opacity: 0, transform: 'translateX(40px)', offset: 0, easing: EASE }, { opacity: 1, transform: 'none', offset: Math.min(.4, 450 / dur) }];
    if (!last) { o.push({ opacity: 1, transform: 'none', offset: 1 - 450 / dur, easing: 'ease-in' }); o.push({ opacity: 0, transform: 'translateX(-40px)', offset: 1 }); } else o.push({ opacity: 1, transform: 'none', offset: 1 });
    st.anims = arm(root);
    var fade = root.animate(o, { duration: dur, fill: 'both' }); fade.pause(); st.anims.push(fade);
    [].forEach.call($('dots').children, function (b, k) { if (k === i) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); });
    $('prev').disabled = i === 0; $('next').disabled = i === scenes.length - 1;
  }
  function apply() {
    var t = st.local;
    st.anims.forEach(function (an) {
      an.currentTime = t;
      var c = an.cnt; if (c) { var p = Math.max(0, Math.min(1, (t - c.d) / c.t)); p = 1 - Math.pow(1 - p, 3); c.el.textContent = c.pre + Math.round(c.to * p) + c.suf; }
    });
    ui();
  }
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
