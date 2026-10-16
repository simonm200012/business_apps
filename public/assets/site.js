/* Clearfigure public site: menu, the Slovenian countdown, the calculator, the contact form. No cookies, no trackers.
 * Texts come from the page (<script type="application/json" id="siteText">), so this file has no words of its own.
 * The contact form posts JSON to /api/contact (public/worker.js); when that is not reachable it offers a mailto: link.
 * Input is only ever put on the page with textContent, never as HTML. */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var T = {};
  try { T = JSON.parse(($('#siteText') || {}).textContent || '{}'); } catch (e) { T = {}; }
  var lang = T.lang || document.documentElement.lang || 'sl';
  try { localStorage.setItem('stratum-site-lang', lang); } catch (e) { /* storage blocked: the demos fall back to the browser language */ }

  // ── formats (same rules as public/src/format.mjs) ──
  function num(n, d) {
    d = d === undefined ? (Number.isInteger(n) ? 0 : 2) : d;
    var s = Math.abs(n).toFixed(d).split('.'), g = lang === 'en' ? ',' : '.', dec = lang === 'en' ? '.' : ',';
    return (n < 0 ? '−' : '') + s[0].replace(/\B(?=(\d{3})+(?!\d))/g, g) + (s[1] ? dec + s[1] : '');
  }
  function eur(n) { return lang === 'en' ? '€' + num(n) : num(n) + ' €'; }
  function pct(n) { return lang === 'en' ? n + '%' : n + ' %'; }
  function fill(s, v) { return String(s).replace(/\{(\w+)\}/g, function (m, k) { return v[k] !== undefined ? v[k] : m; }); }

  // ── nav ──
  var nav = $('#nav');
  if (nav) { var onScroll = function () { nav.classList.toggle('scrolled', window.scrollY > 8); }; window.addEventListener('scroll', onScroll, { passive: true }); onScroll(); }
  var mb = $('#menuBtn'), mn = $('#mnav');
  if (mb && mn) {
    var setMenu = function (open) { mb.setAttribute('aria-expanded', open ? 'true' : 'false'); mn.hidden = !open; };
    mb.addEventListener('click', function () { setMenu(mn.hidden); });
    mn.addEventListener('click', function (e) { if (e.target.closest('a')) setMenu(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !mn.hidden) { setMenu(false); mb.focus(); } });
  }

  // ── days until Slovenian e-invoices (the build wrote the number for the build day; this keeps it current) ──
  var si = $('#siDays');
  if (si && T.siDate && T.siStatus) {
    var now = new Date(), a = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    var b = Date.UTC(+T.siDate.slice(0, 4), +T.siDate.slice(5, 7) - 1, +T.siDate.slice(8, 10));
    var days = Math.max(0, Math.round((b - a) / 864e5)), f = T.siStatus, form;
    if (lang === 'sl') { var h = days % 100; form = h === 1 ? f[0] : h === 2 ? f[1] : h === 3 || h === 4 ? f[2] : f[3]; }
    else if (lang === 'hr') { var t1 = days % 10, h2 = days % 100; form = t1 === 1 && h2 !== 11 ? f[0] : t1 >= 2 && t1 <= 4 && (h2 < 12 || h2 > 14) ? f[1] : f[2]; }
    else form = days === 1 ? f[0] : f[1];
    if (days > 0) si.textContent = form.replace('{n}', num(days));
  }

  // ── "Ask about it" buttons choose the product in the form ──
  var prodSel = $('#fProduct');
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('[data-product]');
    if (a && prodSel) prodSel.value = a.getAttribute('data-product');
  });

  // ── savings calculator (from the showcase): 40-hour week, 1.800 working hours a year (45 weeks) ──
  var WEEK = 40, FTE = 1800, WEEKS = FTE / WEEK;
  var cIn = { people: $('#cPeople'), hours: $('#cHours'), rate: $('#cRate'), share: $('#cShare') };
  function calcValues() {
    var P = +cIn.people.value, H = +cIn.hours.value, R = +cIn.rate.value, S = +cIn.share.value / 100;
    var now = P * H * WEEKS, saved = now * S;
    return { P: P, H: H, R: R, S: S, now: now, saved: saved, value: Math.round((saved * R) / 100) * 100 };
  }
  function tenth(x) { return x > 0 && x < 0.05 ? '< ' + num(0.1, 1) : num(x, 1); }
  function calcRun() {
    var v = calcValues();
    $('#oPeople').textContent = v.P; $('#oHours').textContent = v.H + ' h'; $('#oRate').textContent = eur(v.R); $('#oShare').textContent = pct(Math.round(v.S * 100));
    $('#rValue').textContent = eur(v.value);
    $('#rHours').textContent = fill(T.calc.hoursLine, { saved: num(Math.round(v.saved)), now: num(Math.round(v.now)) });
    $('#hNow').textContent = num(Math.round(v.now)) + ' h'; $('#hNew').textContent = num(Math.round(v.now - v.saved)) + ' h';
    $('#barNow').style.width = '100%'; $('#barNew').style.width = Math.max(2, (1 - v.S) * 100) + '%';
    $('#rFte').textContent = tenth(v.saved / FTE); $('#rWeeks').textContent = tenth(v.saved / v.P / WEEK);
  }
  if (cIn.people && T.calc) {
    Object.keys(cIn).forEach(function (k) { cIn[k].addEventListener('input', calcRun); });
    $('#calc').addEventListener('submit', function (e) { e.preventDefault(); });
    calcRun();
    $('#calcUse').addEventListener('click', function () {
      var v = calcValues(), msg = $('#fMessage');
      var line = fill(T.calc.line, { p: v.P, h: v.H, now: num(Math.round(v.now)), s: pct(Math.round(v.S * 100)), saved: num(Math.round(v.saved)), value: eur(v.value) });
      var keep = msg.value.split('\n').filter(function (l) { return l && l.indexOf(T.calc.line.split('{')[0]) !== 0; }).join('\n');
      msg.value = (keep ? keep + '\n' : '') + line;
      if (prodSel) prodSel.value = 'custom';
      var st = $('#calcStatus'); st.textContent = T.calc.used;
      $('#contact').scrollIntoView({ block: 'start' });
      setTimeout(function () { st.textContent = ''; }, 6000);
    });
  }

  // ── contact form ──
  var form = $('#contactForm');
  if (!form) return;
  var started = Date.now(), MIN_MS = 3000, busy = false;
  var btn = $('#fSubmit'), status = $('#fStatus');
  var tsKey = form.getAttribute('data-turnstile');
  if (tsKey) { // optional Cloudflare Turnstile (public/README.md)
    var box = $('#tsBox'), w = document.createElement('div');
    w.className = 'cf-turnstile'; w.setAttribute('data-sitekey', tsKey); w.setAttribute('data-language', lang); box.appendChild(w);
    var s = document.createElement('script'); s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js'; s.async = true; s.defer = true; document.head.appendChild(s);
  }
  // the same limits as public/worker.js
  var EMAIL = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
  var PHONE = /^[0-9+()\/.\- ]{6,40}$/;
  function val(n) { var el = form.elements[n]; return el ? String(el.value || '').trim() : ''; }
  function check() {
    var bad = {};
    var name = val('name'), email = val('email'), phone = val('phone'), msg = val('message'), co = val('company');
    if (name.length < 2 || name.length > 100) bad.name = 1;
    if (co.length > 120) bad.company = 1;
    if (email.length > 254 || !EMAIL.test(email)) bad.email = 1;
    if (phone && !PHONE.test(phone)) bad.phone = 1;
    if (msg.length < 10 || msg.length > 4000) bad.message = 1;
    return bad;
  }
  function showErrors(bad) {
    ['name', 'company', 'email', 'phone', 'message'].forEach(function (n) {
      var el = form.elements[n], e = $('#e' + n.charAt(0).toUpperCase() + n.slice(1));
      if (!el || !e) return;
      if (bad[n]) { el.setAttribute('aria-invalid', 'true'); e.textContent = T.msg[n]; } else { el.removeAttribute('aria-invalid'); e.textContent = ''; }
    });
    var first = ['name', 'company', 'email', 'phone', 'message'].filter(function (n) { return bad[n]; })[0];
    if (first) form.elements[first].focus();
  }
  function mailtoHref() {
    var body = [val('name'), val('company'), val('email'), val('phone'), '', val('message')].filter(function (x, i) { return x || i === 4; }).join('\n');
    return 'mailto:' + T.email + '?subject=' + encodeURIComponent(T.mailSubject) + '&body=' + encodeURIComponent(body);
  }
  function say(kind, text, withMail) {
    status.className = 'form-status ' + kind;
    status.textContent = text;
    if (withMail) {
      status.appendChild(document.createTextNode(' '));
      var a = document.createElement('a'); a.href = mailtoHref(); a.textContent = T.msg.mailto + ' (' + T.email + ')';
      status.appendChild(a);
    }
    status.focus();
  }
  function setBusy(on) { busy = on; btn.disabled = on; btn.textContent = on ? T.sending : T.submit; }
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (busy) return;
    var bad = check();
    showErrors(bad);
    if (Object.keys(bad).length) { say('bad', T.msg.invalid); return; }
    if (Date.now() - started < MIN_MS) { say('bad', T.msg.tooFast); return; }
    var data = {
      name: val('name'), company: val('company'), email: val('email'), phone: val('phone'), product: val('product') || 'other',
      message: val('message'), lang: lang, website: val('website'), elapsedMs: Date.now() - started, page: location.pathname
    };
    var tsInput = form.querySelector('[name="cf-turnstile-response"]');
    if (tsInput) data.turnstileToken = tsInput.value;
    setBusy(true);
    var ctl = window.AbortController ? new AbortController() : null, timer = setTimeout(function () { if (ctl) ctl.abort(); }, 12000);
    fetch('/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(data), signal: ctl ? ctl.signal : undefined, credentials: 'omit' })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, j: j }; }); })
      .then(function (res) {
        clearTimeout(timer); setBusy(false);
        if (res.status === 200 && res.j && res.j.ok) { form.reset(); started = Date.now(); say('ok', T.msg.ok); return; }
        if (res.status === 400 && res.j && res.j.error === 'invalid') { var b = {}; (res.j.fields || []).forEach(function (f) { b[f] = 1; }); showErrors(b); say('bad', T.msg.invalid); return; }
        if (res.status === 400 && res.j && res.j.error === 'too_fast') { say('bad', T.msg.tooFast); return; }
        if (res.status === 429) { say('bad', T.msg.rate, true); return; }
        say('bad', T.msg.fail, true);
      }, function () { clearTimeout(timer); setBusy(false); say('bad', T.msg.fail, true); });
  });
})();
