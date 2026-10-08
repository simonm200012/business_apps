/* Adrial Mail — Profiles (list, detail, edit, consent), Lists & segments (segment builder). */
(function () {
  'use strict';
  var AM = window.AM, U = AM.U, E = AM.E, UI = AM.UI, C = AM.C, esc = U.esc, ic = U.ic, I = U.I, DAY = U.DAY;
  var App = function () { return AM.App; };
  var LANG = { sl: 'Slovenian', hr: 'Croatian', en: 'English' }, COUNTRY = { SI: 'Slovenia', HR: 'Croatia' };

  // ── Profiles list ─────────────────────────────────────────────────────
  AM.route(/^\/profiles$/, function (page) {
    App().title = 'Profiles';
    var db = E.db(), st = AM.App.state;
    var f = st.pf || (st.pf = { country: '', lang: '', em: '', list: '', seg: '', sort: 'created', dir: -1 });
    st.profilePage = st.profilePage || 0;
    var opt = function (v, l, cur) { return '<option value="' + esc(v) + '"' + (String(v) === String(cur) ? ' selected' : '') + '>' + esc(l) + '</option>'; };
    page.innerHTML = UI.head({ title: 'Profiles', dot: true, sub: '<b>' + U.n(db.profiles.length) + '</b> fictional subscribers · emails @example.si / .hr / .com, fake phone numbers', actions: '<button type="button" class="btn" id="pCsv">' + ic(I.download) + 'Export CSV</button><button type="button" class="btn pri" id="pAdd">' + ic(I.plus) + 'Add profile</button>' }) +
      '<section class="card"><div class="card-h"><div class="toolbar" style="margin:0;width:100%">' +
      '<label class="sr" for="pQ">Search profiles</label><input class="search" id="pQ" type="search" placeholder="Name, email, phone or city…" value="' + esc(st.profileQ || '') + '">' +
      '<label class="sr" for="fCountry">Country</label><select class="select" id="fCountry" data-f="country">' + opt('', 'All countries', f.country) + opt('SI', 'Slovenia', f.country) + opt('HR', 'Croatia', f.country) + '</select>' +
      '<label class="sr" for="fLang">Language</label><select class="select" id="fLang" data-f="lang">' + opt('', 'All languages', f.lang) + opt('sl', 'Slovenian', f.lang) + opt('hr', 'Croatian', f.lang) + opt('en', 'English', f.lang) + '</select>' +
      '<label class="sr" for="fEm">Email consent</label><select class="select" id="fEm" data-f="em">' + opt('', 'Any email consent', f.em) + opt('subscribed', 'Subscribed', f.em) + opt('unsubscribed', 'Unsubscribed', f.em) + opt('never', 'Never consented', f.em) + opt('suppressed', 'Suppressed', f.em) + '</select>' +
      '<label class="sr" for="fList">List</label><select class="select" id="fList" data-f="list">' + opt('', 'Any list', f.list) + db.lists.map(function (l) { return opt(l.id, l.name, f.list); }).join('') + '</select>' +
      '<label class="sr" for="fSeg">Segment</label><select class="select" id="fSeg" data-f="seg">' + opt('', 'Any segment', f.seg) + db.segments.map(function (s) { return opt(s.id, s.name, f.seg); }).join('') + '</select>' +
      '</div></div><div class="tablewrap" id="pTbl"></div><div id="pPager"></div></section>';
    var filtered = [];
    var draw = function () {
      var q = (st.profileQ || '').trim(), seg = f.seg ? E.segSet(E.segment(f.seg)) : null;
      filtered = db.profiles.filter(function (p) {
        if (f.country && p.country !== f.country) return false;
        if (f.lang && p.lang !== f.lang) return false;
        if (f.em === 'suppressed' ? !p.sup : f.em && (p.em.s !== f.em || p.sup)) return false;
        if (f.list && !E.inList(f.list, p.id)) return false;
        if (seg && !seg.has(p.id)) return false;
        return !q || U.matchQ(q, p.first + ' ' + p.last + ' ' + p.email + ' ' + p.phone + ' ' + p.city);
      });
      var key = f.sort, dir = f.dir;
      var val = function (p) { return key === 'name' ? (p.last + p.first).toLowerCase() : key === 'clv' ? E.pred(p).clv : key === 'orders' ? E.pred(p).orders : p.created; };
      filtered.sort(function (a, b) { var x = val(a), y = val(b); return (x > y ? 1 : x < y ? -1 : 0) * dir; });
      var size = 50, pg = Math.min(st.profilePage, Math.max(0, Math.ceil(filtered.length / size) - 1)); st.profilePage = pg;
      var th = function (k, l, r) { return '<th' + (r ? ' class="r"' : '') + ' aria-sort="' + (f.sort === k ? (f.dir > 0 ? 'ascending' : 'descending') : 'none') + '"><button type="button" class="sortbtn" data-sort="' + k + '">' + l + (f.sort === k ? '<i>' + (f.dir > 0 ? '↑' : '↓') + '</i>' : '') + '</button></th>'; };
      page.querySelector('#pTbl').innerHTML = filtered.length ? '<table class="tbl"><thead><tr>' + th('name', 'Profile') + '<th class="hide-sm">Location</th><th>Email</th><th class="hide-md">SMS</th>' + th('orders', 'Orders', 1) + th('clv', 'Pred. CLV', 1) + th('created', 'Created') + '</tr></thead><tbody>' +
        filtered.slice(pg * size, pg * size + size).map(function (p) { var pr = E.pred(p); return '<tr><td>' + UI.who(p) + '</td><td class="hide-sm">' + esc(p.city) + '<small>' + esc(p.country + ' · ' + LANG[p.lang]) + '</small></td><td>' + UI.consent(p, 'email') + '</td><td class="hide-md">' + UI.consent(p, 'sms') + '</td><td class="r num">' + pr.orders + '</td><td class="r num">' + U.money(pr.clv) + '</td><td class="num">' + esc(U.date(p.created)) + '</td></tr>'; }).join('') + '</tbody></table>' : '<div class="empty">No profiles match these filters.</div>';
      page.querySelector('#pPager').innerHTML = UI.pager(filtered.length, pg, size);
    };
    draw();
    page.querySelector('#pQ').addEventListener('input', U.debounce(function (e) { st.profileQ = e.target.value; st.profilePage = 0; draw(); }, 160));
    page.addEventListener('change', function (e) { var k = e.target.dataset.f; if (k) { f[k] = e.target.value; st.profilePage = 0; draw(); } });
    page.addEventListener('click', function (e) {
      var s = e.target.closest('[data-sort]'); if (s) { if (f.sort === s.dataset.sort) f.dir *= -1; else { f.sort = s.dataset.sort; f.dir = s.dataset.sort === 'name' ? 1 : -1; } draw(); }
      var pgb = e.target.closest('[data-page]'); if (pgb && !pgb.disabled) { st.profilePage = +pgb.dataset.page; draw(); page.querySelector('#pTbl').scrollIntoView({ block: 'start' }); }
      if (e.target.closest('#pCsv')) { U.download('adrial-mail-profiles.csv', App().profilesCsv(filtered.map(function (p) { return p.id; }))); U.toast(U.plural(filtered.length, 'profile') + ' exported (generated locally).'); }
      if (e.target.closest('#pAdd')) addProfile();
    });
  }, 'profiles');

  function addProfile() {
    var db = E.db();
    var host = U.modal({ title: 'Add profile', sub: 'Fictional data only — use an @example.* address.', body:
      '<div class="row2"><div class="field"><label for="apF">First name</label><input class="in" id="apF" required></div><div class="field"><label for="apL">Last name</label><input class="in" id="apL"></div></div>' +
      '<div class="row2"><div class="field"><label for="apE">Email</label><input class="in" id="apE" type="email" placeholder="name@example.si" required></div><div class="field"><label for="apP">Phone (optional)</label><input class="in" id="apP" type="tel" placeholder="+386 00 5…"></div></div>' +
      '<div class="row2"><div class="field"><label for="apC">Country</label><select class="in" id="apC"><option value="SI">Slovenia</option><option value="HR">Croatia</option></select></div><div class="field"><label for="apLang">Language</label><select class="in" id="apLang"><option value="sl">Slovenian</option><option value="hr">Croatian</option><option value="en">English</option></select></div></div>' +
      '<div class="field"><label for="apList">Add to list (fires "Added to list" flows)</label><select class="in" id="apList"><option value="">— none —</option>' + db.lists.map(function (l) { return '<option value="' + l.id + '">' + esc(l.name) + '</option>'; }).join('') + '</select></div>' +
      '<label class="check"><input type="checkbox" class="chk" id="apEm" checked> Email marketing consent</label><label class="check"><input type="checkbox" class="chk" id="apSms"> SMS marketing consent</label><div id="apErr"></div>',
      foot: '<button type="button" class="btn" data-close>Cancel</button><button type="button" class="btn pri" id="apSave">Add profile</button>' });
    host.querySelector('#apSave').addEventListener('click', function () {
      var v = function (id) { return host.querySelector('#' + id).value.trim(); };
      var email = v('apE');
      if (!v('apF') || !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) { host.querySelector('#apErr').innerHTML = '<div class="banner bad">Enter a first name and a valid email address.</div>'; return; }
      if (db.profiles.some(function (p) { return p.email.toLowerCase() === email.toLowerCase(); })) { host.querySelector('#apErr').innerHTML = '<div class="banner bad">A profile with this email already exists.</div>'; return; }
      var p = E.createProfile({ first: v('apF'), last: v('apL'), email: email, phone: v('apP'), country: v('apC'), lang: v('apLang'), source: 'Manual', emailConsent: host.querySelector('#apEm').checked, smsConsent: host.querySelector('#apSms').checked && !!v('apP') });
      var flows = v('apList') ? E.addToList(+v('apList'), p.id, { live: true }) : [];
      App().save(['profiles', 'events', 'lists', 'runs', 'flows']);
      U.close(host); U.toast('Profile added' + (flows.length ? ' · entered ' + flows.filter(function (x) { return x.run; }).map(function (x) { return x.flow.name; }).join(', ') : '') + '.');
      location.hash = '#/profiles/' + p.id;
    });
  }

  // ── Profile detail ────────────────────────────────────────────────────
  AM.route(/^\/profiles\/(\d+)$/, function (page, m) {
    var p = E.profile(m[1]); if (!p) { page.innerHTML = '<div class="empty box">Profile not found. <a href="#/profiles">All profiles</a></div>'; return; }
    App().title = E.fullName(p);
    var db = E.db(), st = AM.App.state, pr = E.pred(p), now = E.now();
    var actions = '<a class="btn" href="#/simulator" id="toSim">' + ic(I.zap) + 'Fire events</a><button type="button" class="btn" id="pEdit">' + ic(I.edit) + 'Edit</button><button type="button" class="btn" id="pMore" aria-haspopup="menu">' + ic(I.more) + 'Consent</button>';
    var lists = E.profileLists(p.id), segs = E.profileSegments(p), runs = db.runs.filter(function (r) { return r.p === p.id && !r.done; });
    var custom = Object.keys(p.props || {});
    var h = UI.head({ crumb: { href: '#/profiles', label: 'Profiles' }, title: E.fullName(p), sub: UI.avatar(p) + ' <span>' + esc(p.email) + '</span>' + (p.phone ? '<span>' + esc(p.phone) + '</span>' : '') + '<span>' + esc(COUNTRY[p.country] + ' · ' + LANG[p.lang]) + '</span>' + (p.sup ? '<span class="chip bad">Suppressed: ' + esc(p.sup.r) + '</span>' : ''), actions: actions });
    h += '<div class="grid2"><div class="stack">';
    h += '<section class="card"><div class="card-h"><div><span class="label">Simulated predictions</span><h2>Predictive analytics</h2></div></div><div class="tiles"><div class="tile"><span class="label">Predicted CLV</span><div class="v">' + U.money(pr.clv) + '</div><small>' + U.money(pr.spent) + ' historic + ' + U.money(Math.max(0, pr.clv - pr.spent)) + ' predicted</small></div>' +
      '<div class="tile"><span class="label">Churn risk</span><div class="v" style="text-transform:capitalize">' + pr.churn + '</div><div class="meter" style="margin-top:6px"><i style="width:' + Math.round(pr.churnScore * 100) + '%;background:' + (pr.churn === 'high' ? 'var(--bad-dot)' : pr.churn === 'medium' ? 'var(--c-clay)' : 'var(--good-dot)') + '"></i></div></div>' +
      '<div class="tile"><span class="label">Next order</span><div class="v">' + (pr.next ? esc(U.dateShort(pr.next)) : '—') + '</div><small>' + (pr.nextDays == null ? 'not enough history' : pr.nextDays < 0 ? Math.abs(pr.nextDays) + ' days overdue' : 'in ' + pr.nextDays + ' days') + '</small></div>' +
      '<div class="tile"><span class="label">Orders</span><div class="v">' + pr.orders + '</div><small>AOV ' + U.money2(pr.aov) + (pr.sinceDays != null ? ' · last ' + pr.sinceDays + ' d ago' : '') + '</small></div></div></section>';
    h += '<section class="card"><div class="card-h"><h2>Properties</h2><button type="button" class="btn sm" id="pEdit2">' + ic(I.edit) + 'Edit</button></div><div class="kv">' +
      [['First name', p.first], ['Last name', p.last], ['Email', p.email], ['Phone', p.phone || '—'], ['Country', COUNTRY[p.country]], ['Language', LANG[p.lang]], ['City', p.city || '—'], ['Signup source', p.source], ['Created', U.dateTime(p.created)], ['Birthday', p.birthday || '—']].map(function (x) { return '<div><span class="k">' + x[0] + '</span><p>' + esc(x[1]) + '</p></div>'; }).join('') +
      custom.map(function (k) { return '<div><span class="k">' + esc(k) + '</span><p>' + esc(p.props[k]) + '</p></div>'; }).join('') + '</div></section>';
    h += '<section class="card"><div class="card-h"><h2>Consent</h2></div><div class="kv">' +
      '<div><span class="k">Email marketing</span><p>' + UI.consent(p, 'email') + '</p><small class="muted">since ' + esc(U.dateTime(p.em.at)) + '</small></div>' +
      '<div><span class="k">SMS marketing</span><p>' + UI.consent(p, 'sms') + '</p><small class="muted">' + (p.phone ? 'since ' + esc(U.dateTime(p.sms.at)) : 'no phone number') + '</small></div>' +
      '<div><span class="k">Suppression</span><p>' + (p.sup ? esc(p.sup.r) + ' · ' + esc(U.date(p.sup.at)) : 'Not suppressed') + '</p></div></div></section>';
    h += '<section class="card"><div class="card-h"><h2>Lists</h2><div class="actions"><label class="sr" for="addList">Add to list</label><select class="select" id="addList"><option value="">Add to list…</option>' + db.lists.filter(function (l) { return lists.indexOf(l) < 0; }).map(function (l) { return '<option value="' + l.id + '">' + esc(l.name) + '</option>'; }).join('') + '</select></div></div><ul class="rows">' +
      (lists.map(function (l) { return '<li><div class="main"><a href="#/lists/' + l.id + '">' + esc(l.name) + '</a></div><div class="end"><button type="button" class="btn xs ghost" data-rmlist="' + l.id + '">Remove</button></div></li>'; }).join('') || '<li><div class="main muted">Not in any list.</div></li>') + '</ul></section>';
    h += '<section class="card"><div class="card-h"><div><span class="label">Evaluated live</span><h2>Segments</h2></div></div><div class="card-b actions">' + (segs.map(function (s) { return '<a class="chip tone tone-violet" href="#/segments/' + s.id + '">' + esc(s.name) + '</a>'; }).join('') || '<span class="muted">No segment matches right now.</span>') + '</div></section>';
    h += '<section class="card"><div class="card-h"><h2>Flows in progress</h2></div><ul class="rows">' + (runs.map(function (r) { var f = E.flow(r.f), loc = f && E.findStep(f.steps, r.sid); return '<li><div class="main"><a href="#/flows/' + r.f + '">' + esc(f ? f.name : 'Flow') + '</a><div class="meta">Next: ' + esc(loc ? loc.step.name || E.STEPS[loc.step.type].label : '—') + (r.wake ? ' · ' + esc(U.ago(r.wake, now)) : '') + '</div></div></li>'; }).join('') || '<li><div class="main muted">Not waiting in any flow.</div></li>') + '</ul></section>';
    h += '</div><div class="stack"><section class="card"><div class="card-h"><h2>Activity</h2><label class="sr" for="tlF">Filter activity</label><select class="select" id="tlF"><option value="">All activity</option><option value="shop">Shopping</option><option value="msg">Email &amp; SMS</option><option value="sub">Lists, forms, consent</option></select></div><ul class="tl" id="tl"></ul><div class="more" id="tlMore" style="display:flex;justify-content:center;padding:0 0 14px"></div></section></div></div>';
    page.innerHTML = h;
    var limit = 40;
    var drawTl = function () {
      var flt = page.querySelector('#tlF').value, groups = { shop: ['view', 'cart', 'checkout', 'order', 'price_drop', 'bis'], msg: ['open', 'click', 'sms_click', 'bounce', 'spam', 'flow'], sub: ['sub', 'unsub', 'form', 'prop'] };
      var evs = E.events(p.id).filter(function (e) { return !flt || groups[flt].indexOf(e.t) >= 0; }).slice().reverse();
      page.querySelector('#tl').innerHTML = evs.slice(0, limit).map(function (e) { return '<li>' + UI.evIcon(e.t) + '<div><div class="what">' + UI.evText(e) + '</div><div class="when">' + esc(U.dateTime(e.ts)) + ' · ' + esc(U.ago(e.ts, now)) + '</div></div></li>'; }).join('') || '<li><span></span><div class="muted">No activity.</div></li>';
      page.querySelector('#tlMore').innerHTML = evs.length > limit ? '<button type="button" class="btn sm" id="tlM">Show more (' + U.n(evs.length - limit) + ')</button>' : '';
    };
    drawTl();
    page.querySelector('#tlF').addEventListener('change', function () { limit = 40; drawTl(); });
    page.querySelector('#addList').addEventListener('change', function (e) {
      if (!e.target.value) return;
      var res = E.addToList(+e.target.value, p.id, { live: true });
      App().save(['lists', 'events', 'runs', 'flows', 'profiles']);
      U.toast('Added to ' + E.list(+e.target.value).name + (res.filter(function (x) { return x.run; }).length ? ' · entered ' + res.filter(function (x) { return x.run; }).map(function (x) { return x.flow.name; }).join(', ') : '') + '.');
      App().render(true);
    });
    page.addEventListener('click', function (e) {
      if (e.target.closest('#tlM')) { limit += 60; drawTl(); }
      var rl = e.target.closest('[data-rmlist]'); if (rl) { E.removeFromList(+rl.dataset.rmlist, p.id); App().save(['lists']); U.toast('Removed from list.'); App().render(true); }
      if (e.target.closest('#toSim')) AM.App.state.simP = p.id;
      if (e.target.closest('#pEdit') || e.target.closest('#pEdit2')) editProfile(p);
      var mb = e.target.closest('#pMore');
      if (mb) U.menu(mb, [
        { head: 'Email' }, { label: p.em.s === 'subscribed' ? 'Unsubscribe from email' : 'Resubscribe to email (consent given)', act: 'em' },
        { head: 'SMS' }, { label: p.sms.s === 'subscribed' ? 'Unsubscribe from SMS' : 'Subscribe to SMS (consent given)', act: 'sms', disabled: !p.phone },
        { sep: true }, { label: p.sup ? 'Remove suppression' : 'Suppress profile (never message)', act: 'sup', danger: !p.sup }
      ], function (act) {
        var now2 = E.now();
        if (act === 'em') { if (p.em.s === 'subscribed') E.addEvent({ p: p.id, t: 'unsub', ts: now2, x: 'email' }); else { p.em = { s: 'subscribed', at: now2 }; E.addEvent({ p: p.id, t: 'prop', ts: now2, x: 'email consent = subscribed' }); } }
        if (act === 'sms') { if (p.sms.s === 'subscribed') E.addEvent({ p: p.id, t: 'unsub', ts: now2, x: 'sms' }); else { p.sms = { s: 'subscribed', at: now2 }; E.addEvent({ p: p.id, t: 'prop', ts: now2, x: 'SMS consent = subscribed' }); } }
        if (act === 'sup') { if (p.sup) { p.sup = null; E.addEvent({ p: p.id, t: 'prop', ts: now2, x: 'suppression removed' }); } else { p.sup = { r: 'Manually suppressed', at: now2 }; E.addEvent({ p: p.id, t: 'prop', ts: now2, x: 'manually suppressed' }); } }
        App().save(['profiles', 'events']); U.toast('Consent updated.'); App().render(true);
      }, 'Consent actions');
    });
  }, 'profiles');

  function editProfile(p) {
    var props = Object.keys(p.props || {}).map(function (k) { return [k, p.props[k]]; });
    var row = function (k, v, i) { return '<div class="row2" data-prow="' + i + '"><div class="field"><label for="pk' + i + '">Property name</label><input class="in" id="pk' + i + '" value="' + esc(k) + '"></div><div class="field"><label for="pv' + i + '">Value</label><input class="in" id="pv' + i + '" value="' + esc(v) + '"></div></div>'; };
    var host = U.drawer({ eyebrow: 'Edit profile', title: E.fullName(p), body:
      '<div class="row2"><div class="field"><label for="epF">First name</label><input class="in" id="epF" value="' + esc(p.first) + '"></div><div class="field"><label for="epL">Last name</label><input class="in" id="epL" value="' + esc(p.last) + '"></div></div>' +
      '<div class="field"><label for="epE">Email</label><input class="in" id="epE" type="email" value="' + esc(p.email) + '"></div>' +
      '<div class="row2"><div class="field"><label for="epP">Phone</label><input class="in" id="epP" type="tel" value="' + esc(p.phone) + '"></div><div class="field"><label for="epCity">City</label><input class="in" id="epCity" value="' + esc(p.city) + '"></div></div>' +
      '<div class="row2"><div class="field"><label for="epC">Country</label><select class="in" id="epC"><option value="SI"' + (p.country === 'SI' ? ' selected' : '') + '>Slovenia</option><option value="HR"' + (p.country === 'HR' ? ' selected' : '') + '>Croatia</option></select></div><div class="field"><label for="epLang">Language</label><select class="in" id="epLang">' + ['sl', 'hr', 'en'].map(function (l) { return '<option value="' + l + '"' + (p.lang === l ? ' selected' : '') + '>' + LANG[l] + '</option>'; }).join('') + '</select></div></div>' +
      '<div class="field"><label for="epB">Birthday</label><input class="in" id="epB" type="date" value="' + esc(p.birthday) + '"></div>' +
      '<p class="label" style="margin:6px 0 0">Custom properties</p><div id="epProps" class="stack" style="gap:10px">' + props.map(function (x, i) { return row(x[0], x[1], i); }).join('') + '</div><button type="button" class="btn sm" id="epAdd">' + ic(I.plus) + 'Add property</button><p class="hint" style="margin:0">Clear a property name to delete it. Dates as YYYY-MM-DD.</p>',
      foot: '<button type="button" class="btn" data-close>Cancel</button><button type="button" class="btn pri" id="epSave">Save</button>' });
    var n = props.length;
    host.querySelector('#epAdd').addEventListener('click', function () { host.querySelector('#epProps').insertAdjacentHTML('beforeend', row('', '', n++)); host.querySelector('#pk' + (n - 1)).focus(); });
    host.querySelector('#epSave').addEventListener('click', function () {
      var v = function (id) { return host.querySelector('#' + id).value.trim(); };
      if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(v('epE'))) { U.toast('Enter a valid email address.'); return; }
      var changed = [];
      [['first', 'epF'], ['last', 'epL'], ['email', 'epE'], ['phone', 'epP'], ['city', 'epCity'], ['country', 'epC'], ['lang', 'epLang'], ['birthday', 'epB']].forEach(function (x) { if (String(p[x[0]] || '') !== v(x[1])) { changed.push(x[0]); p[x[0]] = v(x[1]); } });
      var np = {};
      U.$$('[data-prow]', host).forEach(function (r) { var i = r.dataset.prow, k = v('pk' + i).replace(/[^\w-]/g, '_'), val = v('pv' + i); if (k) np[k] = /^\d+$/.test(val) ? +val : val; });
      if (JSON.stringify(np) !== JSON.stringify(p.props)) changed.push('custom properties');
      p.props = np;
      if (changed.length) E.addEvent({ p: p.id, t: 'prop', ts: E.now(), x: changed.join(', ') + ' edited' });
      E.touch(); App().save(['profiles', 'events']); U.close(host); U.toast(changed.length ? 'Profile saved.' : 'No changes.'); App().render(true);
    });
  }

  // ── Lists & segments ──────────────────────────────────────────────────
  AM.route(/^\/(lists|segments)$/, function (page, m) {
    var tab = m[1]; App().title = 'Lists & segments';
    var db = E.db(), now = E.now();
    page.innerHTML = UI.head({ title: 'Lists & segments', dot: true, sub: 'Lists are static (people join them). Segments are dynamic and re-evaluated on every change.', actions: tab === 'lists' ? '<button type="button" class="btn pri" id="newList">' + ic(I.plus) + 'Create list</button>' : '<a class="btn pri" href="#/segments/new">' + ic(I.plus) + 'Create segment</a>' }) +
      '<nav class="seg" aria-label="Lists or segments" style="margin-bottom:16px"><a href="#/lists"' + (tab === 'lists' ? ' aria-current="page"' : '') + '>Lists (' + db.lists.length + ')</a><a href="#/segments"' + (tab === 'segments' ? ' aria-current="page"' : '') + '>Segments (' + db.segments.length + ')</a></nav><section class="card"><div class="tablewrap" id="lsT"></div></section>';
    var box = page.querySelector('#lsT');
    if (tab === 'lists') {
      var growth = {}; db.events.forEach(function (e) { if (e.t === 'sub' && e.ts > now - 30 * DAY) growth[e.r] = (growth[e.r] || 0) + 1; });
      box.innerHTML = '<table class="tbl"><thead><tr><th>List</th><th class="r">Members</th><th class="r hide-sm">Email-reachable</th><th class="r hide-sm">SMS-reachable</th><th class="r">New (30 d)</th><th class="hide-md">Opt-in</th></tr></thead><tbody>' +
        db.lists.map(function (l) { var em = 0, sm = 0; l.members.forEach(function (id) { var p = E.profile(id); if (E.canEmail(p)) em++; if (E.canSms(p)) sm++; }); return '<tr><td><a class="t1" href="#/lists/' + l.id + '">' + esc(l.name) + '</a><small>' + esc(l.desc || '') + '</small></td><td class="r num">' + U.n(l.members.length) + '</td><td class="r num hide-sm">' + U.n(em) + '</td><td class="r num hide-sm">' + U.n(sm) + '</td><td class="r num">+' + U.n(growth[l.id] || 0) + '</td><td class="hide-md">' + (l.optin === 'double' ? 'Double opt-in' : 'Single opt-in') + '</td></tr>'; }).join('') + '</tbody></table>';
      page.querySelector('#newList').addEventListener('click', function () { listDialog(null); });
    } else {
      box.innerHTML = '<table class="tbl"><thead><tr><th>Segment</th><th class="hide-md">Definition</th><th class="r">Profiles</th><th class="r hide-sm">Email-reachable</th><th class="hide-sm">Updated</th></tr></thead><tbody>' +
        db.segments.map(function (s) { var set = E.segSet(s), em = 0; set.forEach(function (id) { if (E.canEmail(E.profile(id))) em++; }); return '<tr><td><a class="t1" href="#/segments/' + s.id + '">' + esc(s.name) + '</a><small>' + esc(s.desc || '') + '</small></td><td class="hide-md"><small style="color:var(--ink2)">' + esc(E.defText(s.def)) + '</small></td><td class="r num">' + U.n(set.size) + '</td><td class="r num hide-sm">' + U.n(em) + '</td><td class="num hide-sm">' + esc(U.date(s.updated)) + '</td></tr>'; }).join('') + '</tbody></table>';
    }
  }, 'lists');

  function listDialog(l) {
    var host = U.modal({ title: l ? 'Edit list' : 'Create list', body: '<div class="field"><label for="lN">Name</label><input class="in" id="lN" value="' + esc(l ? l.name : '') + '"></div><div class="field"><label for="lD">Description</label><input class="in" id="lD" value="' + esc(l ? l.desc : '') + '"></div><div class="field"><span class="lab">Opt-in process</span><div class="radios"><label><input type="radio" name="lO" value="single"' + (!l || l.optin !== 'double' ? ' checked' : '') + '> Single opt-in</label><label><input type="radio" name="lO" value="double"' + (l && l.optin === 'double' ? ' checked' : '') + '> Double opt-in (confirmation email simulated)</label></div></div>',
      foot: '<button type="button" class="btn" data-close>Cancel</button><button type="button" class="btn pri" id="lSave">' + (l ? 'Save' : 'Create list') + '</button>' });
    host.querySelector('#lSave').addEventListener('click', function () {
      var name = host.querySelector('#lN').value.trim(); if (!name) { host.querySelector('#lN').setAttribute('aria-invalid', 'true'); host.querySelector('#lN').focus(); return; }
      var db = E.db(), optin = host.querySelector('input[name="lO"]:checked').value;
      if (l) { l.name = name; l.desc = host.querySelector('#lD').value.trim(); l.optin = optin; }
      else { l = { id: E.nextId('list'), name: name, desc: host.querySelector('#lD').value.trim(), optin: optin, created: E.now(), members: [] }; db.lists.push(l); E.addListIndex(l); }
      App().save(['lists']); U.close(host); U.toast('List saved.'); location.hash = '#/lists/' + l.id; App().render(true);
    });
  }

  AM.route(/^\/lists\/(\d+)$/, function (page, m) {
    var db = E.db(), l = E.list(m[1]), st = AM.App.state;
    if (!l) { page.innerHTML = '<div class="empty box">List not found. <a href="#/lists">All lists</a></div>'; return; }
    App().title = l.name;
    var q = '', pg = 0, size = 40;
    var usedBy = db.flows.filter(function (f) { return f.trigger && f.trigger.type === 'list' && (f.trigger.lists || []).indexOf(l.id) >= 0; }).map(function (f) { return '<a href="#/flows/' + f.id + '">' + esc(f.name) + '</a>'; }).concat(db.forms.filter(function (f) { return f.list === l.id; }).map(function (f) { return '<a href="#/forms/' + f.id + '">' + esc(f.name) + '</a>'; }));
    page.innerHTML = UI.head({ crumb: { href: '#/lists', label: 'Lists & segments' }, title: l.name, sub: '<b>' + U.n(l.members.length) + '</b> members · ' + (l.optin === 'double' ? 'double' : 'single') + ' opt-in' + (usedBy.length ? ' · used by ' + usedBy.join(', ') : ''), actions: '<button type="button" class="btn" id="lEdit">' + ic(I.edit) + 'Edit</button><button type="button" class="btn" id="lCsv">' + ic(I.download) + 'Export CSV</button><button type="button" class="btn danger-ghost" id="lDel">' + ic(I.trash) + 'Delete</button>' }) +
      '<div class="grid2"><section class="card"><div class="card-h"><div class="toolbar" style="margin:0;flex:1"><label class="sr" for="lmQ">Search members</label><input class="search" id="lmQ" type="search" placeholder="Search members…"></div></div><div class="tablewrap" id="lmT"></div><div id="lmP"></div></section>' +
      '<div class="stack"><section class="card"><div class="card-h"><h2>Add a profile</h2></div><div class="card-b">' + UI.picker('lAdd', 'Profile to add (fires "Added to list" flows)') + '</div></section><section class="card"><div class="card-h"><div><span class="label">Last 12 months</span><h2>New members per month</h2></div></div><div class="chart" id="lGrow"></div></section></div></div>';
    var draw = function () {
      var rows = l.members.map(E.profile).filter(function (p) { return p && (!q || U.matchQ(q, p.first + ' ' + p.last + ' ' + p.email)); }).reverse();
      pg = Math.min(pg, Math.max(0, Math.ceil(rows.length / size) - 1));
      page.querySelector('#lmT').innerHTML = rows.length ? '<table class="tbl"><thead><tr><th>Profile</th><th>Email</th><th class="hide-sm">SMS</th><th class="r"><span class="sr">Actions</span></th></tr></thead><tbody>' + rows.slice(pg * size, pg * size + size).map(function (p) { return '<tr><td>' + UI.who(p) + '</td><td>' + UI.consent(p, 'email') + '</td><td class="hide-sm">' + UI.consent(p, 'sms') + '</td><td class="r"><button type="button" class="btn xs ghost" data-rm="' + p.id + '" aria-label="Remove ' + esc(E.fullName(p)) + ' from list">Remove</button></td></tr>'; }).join('') + '</tbody></table>' : '<div class="empty">No members' + (q ? ' match' : ' yet') + '.</div>';
      page.querySelector('#lmP').innerHTML = UI.pager(rows.length, pg, size);
    };
    draw();
    var ms = []; for (var i = 11; i >= 0; i--) ms.push(U.ym(U.addMonths(U.monthStart(E.now()), -i)));
    var cnt = {}; db.events.forEach(function (e) { if (e.t === 'sub' && e.r === l.id) { var k = U.ym(e.ts); cnt[k] = (cnt[k] || 0) + 1; } });
    C.bars(page.querySelector('#lGrow'), { labels: ms.map(U.ymLabel), height: 180, aria: 'New list members per month', series: [{ name: 'New members', color: 'var(--accent)', values: ms.map(function (k) { return cnt[k] || 0; }) }] });
    page.querySelector('#lmQ').addEventListener('input', U.debounce(function (e) { q = e.target.value; pg = 0; draw(); }, 150));
    UI.wirePicker(page, 'lAdd', function (p) {
      if (E.inList(l.id, p.id)) { U.toast('Already a member.'); return; }
      var res = E.addToList(l.id, p.id, { live: true }); App().save(['lists', 'events', 'runs', 'flows', 'profiles']);
      U.toast(E.fullName(p) + ' added' + (res.filter(function (x) { return x.run; }).length ? ' · entered ' + res.filter(function (x) { return x.run; }).map(function (x) { return x.flow.name; }).join(', ') : '') + '.');
      App().render(true);
    });
    page.addEventListener('click', function (e) {
      var rm = e.target.closest('[data-rm]'); if (rm) { E.removeFromList(l.id, +rm.dataset.rm); App().save(['lists']); draw(); U.toast('Removed from list.'); }
      var pgb = e.target.closest('[data-page]'); if (pgb && !pgb.disabled) { pg = +pgb.dataset.page; draw(); }
      if (e.target.closest('#lEdit')) listDialog(l);
      if (e.target.closest('#lCsv')) { U.download('adrial-mail-list-' + l.id + '.csv', App().profilesCsv(l.members)); U.toast('List exported.'); }
      if (e.target.closest('#lDel')) U.confirm({ title: 'Delete list "' + l.name + '"?', text: 'Profiles stay in the system. Campaigns, flows and forms that use this list lose it as an audience/target.', ok: 'Delete list', danger: true }).then(function (ok) {
        if (!ok) return; db.lists = db.lists.filter(function (x) { return x !== l; });
        db.campaigns.forEach(function (c) { if (c.audience) ['include', 'exclude'].forEach(function (k) { c.audience[k] = c.audience[k].filter(function (r) { return !(r.type === 'list' && r.id === l.id); }); }); });
        db.flows.forEach(function (f) { if (f.trigger && f.trigger.lists) f.trigger.lists = f.trigger.lists.filter(function (x) { return x !== l.id; }); });
        E.init(db); App().save(['lists', 'campaigns', 'flows']); U.toast('List deleted.'); location.hash = '#/lists';
      });
    });
  }, 'lists');

  // ── Segment builder ───────────────────────────────────────────────────
  AM.route(/^\/segments\/(new|\d+)$/, function (page, m) {
    var db = E.db(), st = AM.App.state, isNew = m[1] === 'new';
    var seg = isNew ? null : E.segment(m[1]);
    if (!isNew && !seg) { page.innerHTML = '<div class="empty box">Segment not found. <a href="#/segments">All segments</a></div>'; return; }
    var key = 'seg:' + m[1];
    if (!st.segDraft || st.segDraft.key !== key) st.segDraft = { key: key, d: seg ? U.clone(seg) : { name: '', desc: '', def: { match: 'all', groups: [{ match: 'all', conds: [UI.condDefault('event')] }] } } };
    var d = st.segDraft.d;
    App().title = d.name || 'New segment';
    page.innerHTML = UI.head({ crumb: { href: '#/segments', label: 'Lists & segments' }, title: d.name || 'New segment', sub: isNew ? 'Build conditions — the count updates live.' : 'Updated ' + esc(U.dateTime(seg.updated)), actions: (isNew ? '' : '<button type="button" class="btn" id="sDup">' + ic(I.copy) + 'Duplicate</button><button type="button" class="btn" id="sCsv">' + ic(I.download) + 'Export CSV</button><button type="button" class="btn danger-ghost" id="sDel">' + ic(I.trash) + 'Delete</button>') + '<button type="button" class="btn pri" id="sSave">' + ic(I.check) + 'Save segment</button>' }) +
      '<div class="grid2"><section class="card"><div class="card-h"><h2>Definition</h2></div><div class="card-b stack" style="gap:12px"><div class="row2"><div class="field"><label for="sName">Name</label><input class="in" id="sName" value="' + esc(d.name) + '" placeholder="e.g. Sunglasses fans in Croatia"></div><div class="field"><label for="sDesc">Description</label><input class="in" id="sDesc" value="' + esc(d.desc || '') + '"></div></div><div id="sGroups"></div></div></section>' +
      '<div class="stack"><section class="card"><div class="countbox"><span class="label">Matching profiles (live)</span><span class="v" id="sCount">…</span><span class="hint" id="sPct"></span></div><div class="card-b" id="sBreak"></div></section><section class="card"><div class="card-h"><h2>In words</h2></div><div class="card-b"><p style="margin:0;color:var(--ink2)" id="sText"></p></div></section><section class="card"><div class="card-h"><h2>Sample</h2></div><ul class="rows" id="sSample"></ul></section></div></div>';
    var gbox = page.querySelector('#sGroups');
    var drawGroups = function () {
      var def = d.def;
      gbox.innerHTML = '<div class="sb-groups">' + def.groups.map(function (g, gi) {
        return (gi ? '<div class="sb-join"><div class="seg" role="group" aria-label="How groups combine"><button type="button" data-top="all" aria-pressed="' + (def.match !== 'any') + '">AND</button><button type="button" data-top="any" aria-pressed="' + (def.match === 'any') + '">OR</button></div></div>' : '') +
          '<div class="sb-group"><div class="sb-ghead"><span class="label">Group ' + (gi + 1) + ' · profile matches</span><div class="actions"><div class="seg sm" role="group" aria-label="Match all or any condition in group ' + (gi + 1) + '"><button type="button" data-gm="' + gi + ':all" aria-pressed="' + (g.match !== 'any') + '">all (AND)</button><button type="button" data-gm="' + gi + ':any" aria-pressed="' + (g.match === 'any') + '">any (OR)</button></div>' + (def.groups.length > 1 ? '<button type="button" class="btn xs ghost" data-gdel="' + gi + '">Remove group</button>' : '') + '</div></div>' +
          g.conds.map(function (c, ci) { return (ci ? '<span class="cond-sep">' + (g.match === 'any' ? 'or' : 'and') + '</span>' : '') + UI.condRow(c, gi + '.' + ci, { selfSeg: seg ? seg.id : null, removable: g.conds.length > 1 || def.groups.length > 1 }); }).join('') +
          '<div><button type="button" class="btn sm" data-cadd="' + gi + '">' + ic(I.plus) + 'Add condition</button></div></div>';
      }).join('') + '</div><div style="margin-top:12px"><button type="button" class="btn sm" id="gAdd">' + ic(I.plus) + 'Add condition group</button></div>';
    };
    var count = U.debounce(function () {
      var t0 = performance.now(), ids = E.members(d.def), total = db.profiles.length;
      var ms = Math.round(performance.now() - t0);
      page.querySelector('#sCount').textContent = U.n(ids.length);
      page.querySelector('#sPct').textContent = U.pct(ids.length / total) + ' of ' + U.n(total) + ' profiles · evaluated in ' + ms + ' ms';
      var si = 0, em = 0, sm = 0; ids.forEach(function (id) { var p = E.profile(id); if (p.country === 'SI') si++; if (E.canEmail(p)) em++; if (E.canSms(p)) sm++; });
      page.querySelector('#sBreak').innerHTML = '<div class="counter"><span>SI <b>' + U.n(si) + '</b></span><span>HR <b>' + U.n(ids.length - si) + '</b></span><span>Email-reachable <b>' + U.n(em) + '</b></span><span>SMS-reachable <b>' + U.n(sm) + '</b></span></div>';
      page.querySelector('#sText').textContent = E.defText(d.def);
      page.querySelector('#sSample').innerHTML = ids.slice(0, 8).map(function (id) { var p = E.profile(id); return '<li><div class="main">' + UI.who(p) + '</div><div class="end">' + UI.consent(p, 'email') + '</div></li>'; }).join('') || '<li><div class="main muted">No profile matches.</div></li>';
    }, 180);
    drawGroups(); count();
    var lookup = function (k) { var a = k.split('.'); return d.def.groups[+a[0]] && d.def.groups[+a[0]].conds[+a[1]]; };
    UI.wireConds(gbox, lookup, function () { count(); }, function () { return { selfSeg: seg ? seg.id : null }; });
    page.querySelector('#sName').addEventListener('input', function (e) { d.name = e.target.value; });
    page.querySelector('#sDesc').addEventListener('input', function (e) { d.desc = e.target.value; });
    page.addEventListener('click', function (e) {
      var b;
      if ((b = e.target.closest('[data-top]'))) { d.def.match = b.dataset.top; drawGroups(); count(); }
      if ((b = e.target.closest('[data-gm]'))) { var a = b.dataset.gm.split(':'); d.def.groups[+a[0]].match = a[1]; drawGroups(); count(); }
      if ((b = e.target.closest('[data-gdel]'))) { d.def.groups.splice(+b.dataset.gdel, 1); drawGroups(); count(); }
      if ((b = e.target.closest('[data-cadd]'))) { var g = d.def.groups[+b.dataset.cadd]; g.conds.push(UI.condDefault('prop')); drawGroups(); count(); var rows = gbox.querySelectorAll('[data-cond^="' + b.dataset.cadd + '."] select'); if (rows.length) gbox.querySelector('[data-cond="' + b.dataset.cadd + '.' + (g.conds.length - 1) + '"] select').focus(); }
      if ((b = e.target.closest('[data-cond-rm]'))) { var k = b.dataset.condRm.split('.'), gr = d.def.groups[+k[0]]; gr.conds.splice(+k[1], 1); if (!gr.conds.length) d.def.groups.splice(+k[0], 1); if (!d.def.groups.length) d.def.groups.push({ match: 'all', conds: [UI.condDefault('event')] }); drawGroups(); count(); }
      if (e.target.closest('#gAdd')) { d.def.groups.push({ match: 'all', conds: [UI.condDefault('prop')] }); drawGroups(); count(); }
      if (e.target.closest('#sSave')) {
        if (!d.name.trim()) { var n = page.querySelector('#sName'); n.setAttribute('aria-invalid', 'true'); n.focus(); U.toast('Give the segment a name.'); return; }
        var now = E.now();
        if (isNew) { var ns = { id: E.nextId('segment'), name: d.name.trim(), desc: d.desc || '', def: U.clone(d.def), created: now, updated: now }; db.segments.push(ns); st.segDraft = null; App().save(['segments']); U.toast('Segment created.'); location.hash = '#/segments/' + ns.id; }
        else { seg.name = d.name.trim(); seg.desc = d.desc || ''; seg.def = U.clone(d.def); seg.updated = now; E.touch(); App().save(['segments']); st.segDraft = null; U.toast('Segment saved.'); App().render(true); }
      }
      if (e.target.closest('#sDup')) { var cp = { id: E.nextId('segment'), name: seg.name + ' (copy)', desc: seg.desc, def: U.clone(d.def), created: E.now(), updated: E.now() }; db.segments.push(cp); App().save(['segments']); U.toast('Segment duplicated.'); location.hash = '#/segments/' + cp.id; }
      if (e.target.closest('#sCsv')) { var ids = E.members(d.def); U.download('adrial-mail-segment-' + seg.id + '.csv', App().profilesCsv(ids)); U.toast(U.plural(ids.length, 'profile') + ' exported.'); }
      if (e.target.closest('#sDel')) {
        var used = db.campaigns.filter(function (c) { return c.audience && (c.audience.include.concat(c.audience.exclude)).some(function (r) { return r.type === 'segment' && r.id === seg.id; }); });
        U.confirm({ title: 'Delete segment "' + seg.name + '"?', text: used.length ? 'It is used as an audience in ' + U.plural(used.length, 'campaign') + '; it will be removed from them.' : 'Profiles are not affected.', ok: 'Delete segment', danger: true }).then(function (ok) {
          if (!ok) return; db.segments = db.segments.filter(function (x) { return x !== seg; });
          db.campaigns.forEach(function (c) { if (c.audience) ['include', 'exclude'].forEach(function (k) { c.audience[k] = c.audience[k].filter(function (r) { return !(r.type === 'segment' && r.id === seg.id); }); }); });
          E.touch(); App().save(['segments', 'campaigns']); st.segDraft = null; U.toast('Segment deleted.'); location.hash = '#/segments';
        });
      }
    });
  }, 'lists');
})();
