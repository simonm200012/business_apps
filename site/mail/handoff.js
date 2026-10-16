/* Tokovi Mail — segments handed over from other apps on this site (today: Refill & win-back).
 * The sending app writes one message to localStorage "stratum-handoff:mail" and opens /mail/#/handoff.
 * Refill only knows counts per market / action / runout window (no customer names or e-mails), so the
 * handover carries the segment *definition*; Tokovi Mail rebuilds it as a live segment on its own profiles
 * (country + lens refill date + orders + predicted value), creates a draft campaign for it and excludes a
 * 10% hold-out list so Refill's A/B read stays fair. The message is removed once used or dismissed.
 * segmentDef() is pure and tested in tools/tests/mail-import.test.js. */
(function (root) {
  'use strict';
  var H = {};
  H.KEY = 'stratum-handoff:mail';
  H.MAX_AGE = 2 * 3600e3; // a handover older than 2 hours is stale (the Refill numbers move every morning)
  var COUNTRY = { SI: 'SI', HR: 'HR', CRO: 'HR' };
  var BUCKET_NEXT = { '1 0-7': 7, '2 8-14': 14, '3 15-30': 30, '4 31-60': 60 };
  H.ACTIONS = ['Refill reminder', 'Reminder + small incentive', 'Win-back offer', 'Low-cost win-back (email only)'];
  H.valid = function (h, now) {
    if (!h || h.v !== 1 || h.from !== 'refill' || typeof h.at !== 'number') return 'This handover is not from Refill & win-back.';
    if (now - h.at > H.MAX_AGE) return 'This handover is older than 2 hours. Send the segment again from Refill & win-back.';
    if (!COUNTRY[h.market]) return 'Tokovi Mail has subscribers in Slovenia and Croatia only' + (h.market ? ' — there are no ' + h.market + ' profiles to match.' : '.');
    if (H.ACTIONS.indexOf(h.action) < 0) return '"' + (h.action || 'No action') + '" customers are not contacted.';
    return '';
  };
  // Refill's market × suggested action × runout window → a Tokovi Mail segment definition
  H.segmentDef = function (h) {
    var conds = [{ kind: 'prop', field: 'country', op: 'eq', value: COUNTRY[h.market] }, { kind: 'consent', channel: 'email', value: 'can' }];
    var groups = [{ match: 'all', conds: conds }];
    var lens = { kind: 'event', ev: 'order', op: 'atleast', n: 1, win: { type: 'all' }, where: { field: 'category', value: 'Contact lenses' } };
    var lapsed = [lens, { kind: 'event', ev: 'order', op: 'zero', n: 0, win: { type: 'last', days: 120 } }];
    if (h.action === 'Refill reminder') {
      if (BUCKET_NEXT[h.bucket]) conds.push({ kind: 'prop', field: 'props.lens_refill_date', op: 'next', value: BUCKET_NEXT[h.bucket] });
      else if (h.bucket === '0 overdue') conds.push({ kind: 'prop', field: 'props.lens_refill_date', op: 'last', value: 14 });
      else groups.push({ match: 'any', conds: [{ kind: 'prop', field: 'props.lens_refill_date', op: 'next', value: 14 }, { kind: 'prop', field: 'props.lens_refill_date', op: 'last', value: 7 }] });
    } else if (h.action === 'Reminder + small incentive') {
      conds.push({ kind: 'prop', field: 'props.lens_refill_date', op: 'last', value: 90 });
    } else if (h.action === 'Win-back offer') {
      groups.push({ match: 'all', conds: lapsed.concat([{ kind: 'pred', field: 'clv', op: 'gt', value: 400 }]) });
    } else {
      groups.push({ match: 'all', conds: lapsed.concat([{ kind: 'pred', field: 'clv', op: 'lt', value: 400 }]) });
    }
    return { match: 'all', groups: groups };
  };
  H.COPY = {
    'Refill reminder': { SI: ['Vaše kontaktne leče bodo kmalu pošle', 'Naročite novo zalogo v enem kliku.'], HR: ['Vaše kontaktne leće uskoro će ponestati', 'Naručite novu zalihu jednim klikom.'] },
    'Reminder + small incentive': { SI: ['Zaloga leč je pošla? −10 % na naslednje naročilo', 'Koda velja 7 dni.'], HR: ['Ponestalo vam je leća? −10 % na sljedeću narudžbu', 'Kod vrijedi 7 dana.'] },
    'Win-back offer': { SI: ['Pogrešamo vas: −15 % na kontaktne leče', 'In brezplačna dostava do konca meseca.'], HR: ['Nedostajete nam: −15 % na kontaktne leće', 'I besplatna dostava do kraja mjeseca.'] },
    'Low-cost win-back (email only)': { SI: ['Nove leče z dostavo na dom', 'Vaša številka leč je shranjena — naročite v minuti.'], HR: ['Nove leće s dostavom na kućnu adresu', 'Vaša dioptrija je spremljena — naručite u minuti.'] }
  };
  H.title = function (h) { return h.action + ' · ' + (COUNTRY[h.market] === 'HR' ? 'Croatia' : 'Slovenia') + (h.bucketLabel ? ' · runs out ' + h.bucketLabel.toLowerCase() : ''); };
  root.AM = root.AM || {};
  root.AM.Handoff = H;
  if (typeof module !== 'undefined' && module.exports) module.exports = H;

  // ── the page (browser only) ──────────────────────────────────────────
  if (typeof document === 'undefined' || !root.AM.route) return;
  var AM = root.AM, U = AM.U, E = AM.E, UI = AM.UI, esc = U.esc, ic = U.ic, I = U.I;
  var App = function () { return AM.App; };
  function read() { try { return JSON.parse(localStorage.getItem(H.KEY) || 'null'); } catch (e) { return null; } }
  function drop() { try { localStorage.removeItem(H.KEY); } catch (e) {} }
  var HOLD = 'Refill hold-out (10%, never mailed)';
  AM.route(/^\/handoff$/, function (page) {
    App().title = 'From Refill & win-back';
    var h = read(), now = Date.now(), err = h ? H.valid(h, now) : 'Nothing was handed over. Open Refill & win-back → Segments and press "Send with Tokovi Mail" on a row.';
    var head = UI.head({ crumb: { href: '#/campaigns', label: 'Campaigns' }, title: 'From Refill & win-back' });
    if (err) {
      page.innerHTML = head + '<section class="card"><div class="card-b stack" style="gap:12px;padding-top:18px"><div class="banner warn">' + esc(err) + '</div><div class="actions"><a class="btn" href="/refill/#/segments">Open Refill segments</a>' + (h ? '<button type="button" class="btn ghost" id="hoDrop">Dismiss</button>' : '') + '</div></div></section>';
      var d = page.querySelector('#hoDrop'); if (d) d.addEventListener('click', function () { drop(); App().go('#/campaigns'); });
      return;
    }
    var def = H.segmentDef(h), country = COUNTRY[h.market], ids = E.members(def);
    var hold = ids.filter(function (id) { return id % 10 === 0; }).length;
    page.innerHTML = head +
      '<div class="grid2"><section class="card"><div class="card-h"><div><span class="label">Handed over ' + esc(U.dateTime(h.at)) + '</span><h2>' + esc(H.title(h)) + '</h2></div></div><div class="card-b stack" style="gap:12px">' +
      '<div class="tiles" style="padding:0"><div class="tile"><span class="label">In Refill</span><div class="v">' + U.n(h.customers) + '</div><small>' + U.n(h.emailable) + ' e-mailable' + (/^\d{4}-\d{2}-\d{2}$/.test(h.scoredOn || '') ? ' · scored ' + esc(+h.scoredOn.slice(8) + '. ' + +h.scoredOn.slice(5, 7) + '. ' + h.scoredOn.slice(0, 4)) : '') + '</small></div>' +
      '<div class="tile"><span class="label">Matched here</span><div class="v">' + U.n(ids.length - hold) + '</div><small>can receive email · ' + U.n(hold) + ' kept back as hold-out</small></div></div>' +
      '<p class="hint" style="margin:0">Refill shares counts only, never names or addresses, so Tokovi Mail rebuilds the segment on its own subscribers: <b style="font-weight:500">' + esc(E.defText(def)) + '</b>. The numbers differ because the two apps use different demo customers.</p>' +
      '<p class="hint" style="margin:0">To keep Refill\'s A/B read fair, the campaign excludes the list "' + esc(HOLD) + '" (every tenth profile) — the stand-in for Refill\'s 10% hold-out hash.</p></div></section>' +
      '<section class="card"><div class="card-h"><h2>What happens</h2></div><ul class="rows">' +
      '<li><span class="typeic">' + ic(I.filter) + '</span><div class="main">A live segment "From Refill: ' + esc(H.title(h)) + '"</div></li>' +
      '<li><span class="typeic">' + ic(I.mail) + '</span><div class="main">A draft email campaign from the lens-reminder template, in ' + (country === 'HR' ? 'Croatian' : 'Slovenian') + '<div class="meta">Subject: ' + esc(H.COPY[h.action][country][0]) + '</div></div></li>' +
      '<li><span class="typeic">' + ic(I.send) + '</span><div class="main">Nothing is sent: you check the content and schedule it yourself (simulated).</div></li></ul>' +
      '<div class="card-b actions" style="padding-top:14px"><button type="button" class="btn pri" id="hoGo">' + ic(I.plus) + 'Create segment and draft</button><button type="button" class="btn" id="hoDrop">Dismiss</button></div></section></div>';
    page.querySelector('#hoDrop').addEventListener('click', function () { drop(); U.toast('Handover dismissed.'); App().go('#/campaigns'); });
    page.querySelector('#hoGo').addEventListener('click', function () {
      var db = E.db(), t = E.now(), name = 'From Refill: ' + H.title(h);
      var seg = { id: E.nextId('segment'), name: name, desc: 'Handed over from Refill & win-back on ' + U.date(h.at) + ': ' + U.n(h.customers) + ' customers there (' + U.n(h.emailable) + ' e-mailable). Rebuilt here on country, lens refill date, lens orders and predicted value.', def: def, created: t, updated: t };
      db.segments.push(seg);
      var hl = db.lists.filter(function (l) { return l.name === HOLD; })[0];
      if (!hl) { hl = { id: E.nextId('list'), key: 'holdout', name: HOLD, desc: 'Every tenth profile (id ending in 0): the stand-in for Refill & win-back\'s 10% hold-out. Exclude it from refill and win-back sends.', optin: 'single', created: t, members: db.profiles.filter(function (p) { return p.id % 10 === 0; }).map(function (p) { return p.id; }) }; db.lists.push(hl); E.addListIndex(hl); }
      var tpl = db.templates.filter(function (x) { return x.key === 'lens'; })[0];
      var c = App().newCampaign({ tpl: tpl ? tpl.id : null, name: 'Refill: ' + H.title(h), include: [{ type: 'segment', id: seg.id }] });
      var copy = H.COPY[h.action][country];
      c.subject = copy[0]; c.preview = copy[1];
      c.audience.exclude = [{ type: 'list', id: hl.id }];
      if (country === 'HR') c.fromEmail = 'novosti@example.hr';
      c.from = { app: 'refill', at: h.at, market: h.market, action: h.action, bucket: h.bucket || '' };
      E.touch(); drop();
      App().save(['segments', 'lists', 'campaigns', 'meta']);
      U.toast('Segment and draft campaign created — check the content, then schedule it.');
      location.hash = '#/campaigns/' + c.id;
    });
  }, 'campaigns');
})(typeof window !== 'undefined' ? window : globalThis);
