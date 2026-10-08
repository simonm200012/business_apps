/* Adrial Mail — Campaigns (list, wizard, A/B, schedule, simulated send, report + click map), SMS
 * campaigns (composer with segment counter + consent checks, report), Templates, Sign-up forms. */
(function () {
  'use strict';
  var AM = window.AM, U = AM.U, E = AM.E, UI = AM.UI, C = AM.C, M = AM.Email, esc = U.esc, ic = U.ic, I = U.I, DAY = U.DAY, HOUR = U.HOUR;
  var App = function () { return AM.App; };
  var SENDERS = ['novice@example.si', 'novosti@example.hr', 'news@example.com'];

  function newCampaign(o) {
    var db = E.db(), now = E.now(), t = o.tpl ? E.template(o.tpl) : null;
    var c = { id: E.nextId('campaign'), name: o.name || 'Untitled campaign', channel: o.channel || 'email', status: 'draft', created: now, updated: now,
      audience: { include: o.include || [{ type: 'list', id: db.lists[0].id }], exclude: [] }, schedule: { type: 'now' } };
    if (c.channel === 'email') Object.assign(c, { subject: t ? t.subject : '', preview: t ? t.preview : '', fromName: db.settings.senderName, fromEmail: db.settings.senderEmail, replyTo: db.settings.replyTo, design: t ? M.reid(t.design) : M.newDesign(), tpl: t ? t.key : '', utm: true, ab: { on: false, type: 'subject', variants: [{ subject: '' }, { subject: '' }], testPct: 20, metric: 'open', wait: 4 } });
    else Object.assign(c, { body: 'Adrial: {{ first_name|default:"Pozdravljeni" }}, ... https://ex.am/x Odjava: STOP', sender: db.settings.smsSender, stop: true, audience: { include: [{ type: 'list', id: (db.lists.filter(function (l) { return /SMS/.test(l.name); })[0] || db.lists[0]).id }], exclude: [] } });
    db.campaigns.push(c); App().save(['campaigns', 'meta']);
    return c;
  }
  function chosenTplDialog(cb) {
    var db = E.db();
    var host = U.modal({ title: 'Create email campaign', wide: true, body: '<div class="field"><label for="ncN">Campaign name</label><input class="in" id="ncN" placeholder="e.g. Autumn newsletter SI"></div><span class="label">Start from a template</span><div class="cards" style="grid-template-columns:repeat(auto-fill,minmax(min(100%,180px),1fr))">' +
      '<button type="button" class="card tcard" data-tp="" style="cursor:pointer;text-align:left;font:inherit"><div class="thumb" style="height:90px;align-items:center;color:var(--ink3)">Blank</div><div class="tb"><b>Blank email</b><small>Header, text, button, footer</small></div></button>' +
      db.templates.map(function (t) { return '<button type="button" class="card tcard" data-tp="' + t.id + '" style="cursor:pointer;text-align:left;font:inherit"><div class="thumb" style="height:90px">' + thumb(t.design, 90) + '</div><div class="tb"><b>' + esc(t.name) + '</b><small>' + esc(t.category) + '</small></div></button>'; }).join('') + '</div>' });
    host.addEventListener('click', function (e) { var b = e.target.closest('[data-tp]'); if (!b) return; var name = host.querySelector('#ncN').value.trim(); U.close(host); cb(b.dataset.tp ? +b.dataset.tp : null, name); });
  }
  function thumb(design, h) {
    var img = (design.blocks || []).filter(function (b) { return b.type === 'image'; })[0];
    var s = M.styles(design);
    return '<div style="width:86%;margin-top:10px;background:' + s.content + ';border-radius:8px 8px 0 0;box-shadow:var(--shadow);overflow:hidden"><div style="background:' + s.head + ';color:' + s.headText + ';font:13px Georgia,serif;text-align:center;padding:6px">Adrial</div>' + (img ? '<img alt="" style="display:block;width:100%" src="' + M.art(img.art, 400, 170, { headline: img.headline }) + '">' : '<div style="height:' + (h - 30) + 'px"></div>') + '</div>';
  }
  App.newCampaignFlow = function () { chosenTplDialog(function (tid, name) { var t = tid ? E.template(tid) : null; var c = newCampaign({ tpl: tid, name: name || (t ? t.name + ' campaign' : 'Untitled campaign') }); location.hash = '#/campaigns/' + c.id + '/edit/1'; }); };

  // ── Campaign list ─────────────────────────────────────────────────────
  AM.route(/^\/campaigns$/, function (page) {
    App().title = 'Campaigns';
    var db = E.db(), st = AM.App.state, flt = st.cf || 'all', q = st.cq || '';
    page.innerHTML = UI.head({ title: 'Campaigns', dot: true, sub: 'One-off email sends to lists and segments. Sending is simulated — nothing leaves this browser. SMS campaigns live under <a href="#/sms">SMS</a>.', actions: '<button type="button" class="btn pri" id="cNew">' + ic(I.plus) + 'Create campaign</button>' }) +
      '<section class="card"><div class="card-h"><div class="toolbar" style="margin:0"><label class="sr" for="cQ">Search campaigns</label><input class="search" id="cQ" type="search" placeholder="Search by name or subject…" value="' + esc(q) + '"><div class="seg" role="group" aria-label="Status">' + [['all', 'All'], ['draft', 'Drafts'], ['scheduled', 'Scheduled'], ['sent', 'Sent']].map(function (s) { return '<button type="button" data-cf="' + s[0] + '" aria-pressed="' + (flt === s[0]) + '">' + s[1] + '</button>'; }).join('') + '</div></div></div><div class="tablewrap" id="cT"></div></section>';
    var draw = function () {
      var rows = db.campaigns.filter(function (c) { return c.channel === 'email' && (flt === 'all' || c.status === flt || (flt === 'scheduled' && c.status === 'sending')) && U.matchQ(q, c.name + ' ' + c.subject); })
        .sort(function (a, b) { var r = { sending: 0, scheduled: 1, draft: 2, sent: 3 }; return r[a.status] - r[b.status] || (b.sentAt || E.sendTime(b)) - (a.sentAt || E.sendTime(a)); });
      page.querySelector('#cT').innerHTML = rows.length ? '<table class="tbl"><thead><tr><th>Campaign</th><th>Status</th><th class="hide-md">Audience</th><th>Date</th><th class="r">Recipients</th><th class="r hide-sm">Open</th><th class="r hide-sm">Click</th><th class="r">Revenue</th><th><span class="sr">Actions</span></th></tr></thead><tbody>' +
        rows.map(function (c) { var s = c.status === 'sent' ? E.cStats(c) : null, est = c.status !== 'sent' ? E.audience(c).ids.length : 0; return '<tr><td><a class="t1" href="#/campaigns/' + c.id + '">' + esc(c.name) + '</a><small>' + esc(c.subject || 'No subject yet') + (c.ab && c.ab.on ? ' · A/B' : '') + '</small></td><td>' + UI.status(c.status) + '</td><td class="hide-md"><small style="color:var(--ink2)">' + esc(UI.audienceText(c)) + '</small></td><td class="num">' + (c.status === 'sent' ? esc(U.date(c.sentAt)) : c.status === 'scheduled' ? esc(U.dateTime(E.sendTime(c))) : '—') + '</td><td class="r num">' + (s ? U.n(s.recipients) : '<span class="muted">~' + U.n(est) + '</span>') + '</td><td class="r num hide-sm">' + (s ? U.pct(s.openRate) : '—') + '</td><td class="r num hide-sm">' + (s ? U.pct(s.clickRate, 2) : '—') + '</td><td class="r num">' + (s ? U.money(s.revenue) : '—') + '</td><td class="r"><button type="button" class="btn xs icon ghost" data-cm="' + c.id + '" aria-label="Actions for ' + esc(c.name) + '" aria-haspopup="menu">' + ic(I.more) + '</button></td></tr>'; }).join('') + '</tbody></table>' : '<div class="empty">No campaigns match.</div>';
    };
    draw();
    page.querySelector('#cQ').addEventListener('input', U.debounce(function (e) { st.cq = q = e.target.value; draw(); }, 150));
    page.addEventListener('click', function (e) {
      var b;
      if ((b = e.target.closest('[data-cf]'))) { st.cf = flt = b.dataset.cf; U.$$('[data-cf]', page).forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); draw(); }
      if (e.target.closest('#cNew')) App().newCampaignFlow();
      if ((b = e.target.closest('[data-cm]'))) { var c = E.campaign(b.dataset.cm); campaignMenu(b, c, draw); }
    });
  }, 'campaigns');
  function campaignMenu(anchor, c, after) {
    var db = E.db(), base = c.channel === 'sms' ? '#/sms/' : '#/campaigns/';
    U.menu(anchor, [{ label: c.status === 'sent' ? 'View report' : 'Open', act: 'open' }, { label: 'Duplicate', act: 'dup', icon: I.copy }, { label: 'Delete', act: 'del', icon: I.trash, danger: true, disabled: c.status === 'sending' }], function (a) {
      if (a === 'open') location.hash = base + c.id;
      if (a === 'dup') { var n = U.clone(c); n.id = E.nextId('campaign'); n.name = c.name + ' (copy)'; n.status = 'draft'; delete n.sentAt; delete n.st; n.created = n.updated = E.now(); n.schedule = { type: 'now' }; if (n.design) n.design = M.reid(n.design); db.campaigns.push(n); App().save(['campaigns', 'meta']); U.toast('Duplicated as draft.'); location.hash = base + n.id; }
      if (a === 'del') U.confirm({ title: 'Delete "' + c.name + '"?', text: c.status === 'sent' ? 'The report disappears; recipients\' opens and clicks stay on their profiles.' : 'This draft will be removed.', ok: 'Delete', danger: true }).then(function (ok) { if (!ok) return; db.campaigns = db.campaigns.filter(function (x) { return x !== c; }); E.touch(); App().save(['campaigns']); U.toast('Deleted.'); if (after) after(); else location.hash = c.channel === 'sms' ? '#/sms' : '#/campaigns'; });
    }, 'Campaign actions');
  }

  // ── Audience picker (email + SMS) ─────────────────────────────────────
  function audiencePicker(c) {
    var db = E.db(), inc = c.audience.include, exc = c.audience.exclude;
    var has = function (arr, t, id) { return arr.some(function (r) { return r.type === t && r.id === id; }); };
    var col = function (kind, arr, title) {
      return '<fieldset class="card" style="padding:12px 14px;box-shadow:none"><legend class="label" style="padding:0 6px">' + title + '</legend><p class="label" style="margin:4px 0">Lists</p>' +
        db.lists.map(function (l) { return '<label class="check" style="padding:3px 0"><input type="checkbox" class="chk" data-aud="' + kind + ':list:' + l.id + '"' + (has(arr, 'list', l.id) ? ' checked' : '') + '> <span>' + esc(l.name) + ' <span class="muted num">' + U.n(l.members.length) + '</span></span></label>'; }).join('') +
        '<p class="label" style="margin:10px 0 4px">Segments</p>' + db.segments.map(function (s) { return '<label class="check" style="padding:3px 0"><input type="checkbox" class="chk" data-aud="' + kind + ':segment:' + s.id + '"' + (has(arr, 'segment', s.id) ? ' checked' : '') + '> <span>' + esc(s.name) + ' <span class="muted num">' + U.n(E.segSet(s).size) + '</span></span></label>'; }).join('') + '</fieldset>';
    };
    return '<div class="row2">' + col('include', inc, 'Send to') + col('exclude', exc, "Don't send to") + '</div>';
  }
  function audienceEstimate(c) {
    var a = E.audience(c), sms = c.channel === 'sms';
    return '<div class="countbox" style="padding:0"><span class="label">Estimated recipients</span><span class="v">' + U.n(a.ids.length) + '</span></div><div class="counter" style="margin-top:8px"><span>In audience <b>' + U.n(a.total) + '</b></span><span>Excluded <b>' + U.n(a.excluded) + '</b></span><span>No ' + (sms ? 'SMS' : 'email') + ' consent <b>' + U.n(a.noConsent) + '</b></span>' + (sms ? '<span>No phone <b>' + U.n(a.noAddress) + '</b></span>' : '') + '<span>Suppressed <b>' + U.n(a.suppressed) + '</b></span></div><p class="hint" style="margin:8px 0 0">Only profiles with ' + (sms ? 'SMS' : 'email') + ' consent who are not suppressed are counted; anyone in both lists receives one message.</p>';
  }
  function wireAudience(root, c, onChange) {
    root.addEventListener('change', function (e) {
      var t = e.target; if (!t.dataset.aud) return;
      var a = t.dataset.aud.split(':'), arr = c.audience[a[0]], id = +a[2];
      c.audience[a[0]] = arr.filter(function (r) { return !(r.type === a[1] && r.id === id); });
      if (t.checked) c.audience[a[0]].push({ type: a[1], id: id });
      c.updated = E.now(); App().save(['campaigns']); onChange();
    });
  }

  // ── Campaign: detail router (draft → wizard, scheduled, sending, sent → report) ──
  AM.route(/^\/campaigns\/(\d+)(?:\/(edit)(?:\/(\d))?)?$/, function (page, m) {
    var c = E.campaign(m[1]);
    if (!c || c.channel !== 'email') { page.innerHTML = '<div class="empty box">Campaign not found. <a href="#/campaigns">All campaigns</a></div>'; return; }
    App().title = c.name;
    if (c.status === 'sent') return report(page, c);
    if (c.status === 'sending') return sendingView(page, c, '#/campaigns');
    if (c.status === 'scheduled' && !m[2]) return scheduledView(page, c);
    wizard(page, c, +(m[3] || 1));
  }, 'campaigns');

  function sendingView(page, c, back) {
    var job = AM.App.jobs[c.id];
    page.innerHTML = UI.head({ crumb: { href: back, label: back === '#/sms' ? 'SMS' : 'Campaigns' }, title: c.name, sub: UI.status('sending') + ' Simulated delivery in progress — nothing is actually sent.' }) +
      '<section class="card"><div class="card-b" style="padding-top:18px"><div class="progress"><b style="font-weight:500">Sending (simulation)</b><div class="bar" data-progress="' + c.id + '"><i style="width:' + ((job ? job.p : 0) * 100) + '%"></i></div><small data-phase>' + esc(job ? job.phase : 'Starting…') + '</small></div><p class="hint">The report opens automatically when delivery finishes.</p></div></section>';
  }
  function scheduledView(page, c) {
    var t = E.sendTime(c), a = E.audience(c);
    page.innerHTML = UI.head({ crumb: { href: '#/campaigns', label: 'Campaigns' }, title: c.name, sub: UI.status('scheduled') + ' <span>' + (c.schedule.type === 'smart' ? 'Smart send time · ' : '') + esc(U.dateTime(t)) + ' (' + esc(U.ago(t, E.now())) + ')</span>', actions: '<button type="button" class="btn" id="unsch">' + ic(I.edit) + 'Unschedule &amp; edit</button><button type="button" class="btn pri" id="sendNow">' + ic(I.send) + 'Send now (simulated)</button>' }) +
      '<div class="grid2"><section class="card"><div class="card-h"><h2>Email</h2></div><div class="card-b">' + UI.frame(UI.emailHtml(c.design, { profile: E.profile(U.pref('previewP') || 1), subject: c.subject, preview: c.preview }), {}) + '</div></section><div class="stack"><section class="card"><div class="card-h"><h2>Summary</h2></div><div class="kv">' +
      [['Subject', c.subject], ['Preview text', c.preview || '—'], ['From', c.fromName + ' <' + c.fromEmail + '>'], ['Audience', UI.audienceText(c)], ['Estimated recipients', U.n(a.ids.length)], ['A/B test', c.ab && c.ab.on ? c.ab.variants.length + ' ' + c.ab.type + ' variants, ' + c.ab.testPct + '% test' : 'Off']].map(function (x) { return '<div><span class="k">' + x[0] + '</span><p>' + esc(x[1]) + '</p></div>'; }).join('') + '</div></section>' +
      '<div class="banner demo">' + ic(I.clock) + '<span>Scheduled campaigns send automatically when the demo clock passes the send time. You can fast-forward the clock in the <a href="#/simulator">Event simulator</a>.</span></div></div></div>';
    page.querySelector('#unsch').addEventListener('click', function () { c.status = 'draft'; App().save(['campaigns']); location.hash = '#/campaigns/' + c.id + '/edit/5'; });
    page.querySelector('#sendNow').addEventListener('click', function () { confirmSend(c); });
  }
  function confirmSend(c) {
    var a = E.audience(c);
    if (!a.ids.length) { U.toast('No eligible recipients — check the audience.'); return; }
    U.confirm({ title: 'Send "' + c.name + '"?', html: 'This simulates delivery to <b style="font-weight:500">' + U.n(a.ids.length) + '</b> recipients' + (c.ab && c.ab.on ? ' with an A/B test' : '') + '. <b style="font-weight:500">Nothing is actually sent</b> — opens, clicks and orders are generated for the demo.', ok: 'Send (simulated)' }).then(function (ok) {
      if (!ok) return;
      c.schedule = { type: 'now' }; AM.App.sendCampaign(c); location.hash = (c.channel === 'sms' ? '#/sms/' : '#/campaigns/') + c.id; AM.App.render();
    });
  }

  // ── Wizard ────────────────────────────────────────────────────────────
  var STEPS = ['Audience', 'Message', 'Content', 'A/B test', 'Schedule & review'];
  function wizard(page, c, step) {
    var save = U.debounce(function () { c.updated = E.now(); App().save(['campaigns']); }, 300);
    page.innerHTML = UI.head({ crumb: { href: '#/campaigns', label: 'Campaigns' }, title: c.name, sub: UI.status(c.status) + ' <span>Autosaved · last change ' + esc(U.ago(c.updated, E.now())) + '</span>', actions: '<button type="button" class="btn" id="wMenu" aria-haspopup="menu">' + ic(I.more) + 'More</button>' }) +
      '<nav class="steps" aria-label="Campaign steps" style="margin-bottom:16px">' + STEPS.map(function (s, i) { return '<a href="#/campaigns/' + c.id + '/edit/' + (i + 1) + '" class="' + (step === i + 1 ? 'on' : '') + '"' + (step === i + 1 ? ' aria-current="step"' : '') + '>' + (i + 1) + ' · ' + s + '</a>'; }).join('') + '</nav><div id="wz"></div>' +
      '<div class="actions" style="justify-content:space-between;margin-top:16px">' + (step > 1 ? '<a class="btn" href="#/campaigns/' + c.id + '/edit/' + (step - 1) + '">' + ic(I.back) + 'Back</a>' : '<span></span>') + (step < 5 ? '<a class="btn pri" href="#/campaigns/' + c.id + '/edit/' + (step + 1) + '">Next: ' + STEPS[step] + '</a>' : '') + '</div>';
    page.querySelector('#wMenu').addEventListener('click', function (e) { campaignMenu(e.currentTarget, c); });
    var box = page.querySelector('#wz');
    if (step === 1) {
      box.innerHTML = '<div class="grid2"><section class="card"><div class="card-h"><h2>Who receives it</h2></div><div class="card-b stack" style="gap:12px"><div class="field"><label for="wName">Campaign name (internal)</label><input class="in" id="wName" value="' + esc(c.name) + '"></div>' + audiencePicker(c) + '</div></section><section class="card"><div class="card-b" style="padding-top:18px" id="wEst">' + audienceEstimate(c) + '</div></section></div>';
      wireAudience(box, c, function () { box.querySelector('#wEst').innerHTML = audienceEstimate(c); });
      box.querySelector('#wName').addEventListener('input', function (e) { c.name = e.target.value; save(); });
    } else if (step === 2) {
      var tagSel = function (id) { return '<label class="sr" for="' + id + '">Insert tag</label><select class="in sm" id="' + id + '" style="width:auto"><option value="">+ Personalization tag</option>' + M.TAGS.filter(function (t) { return t[0] !== 'unsubscribe_url'; }).map(function (t) { return '<option value="' + t[0] + '">' + esc(t[1]) + '</option>'; }).join('') + '</select>'; };
      box.innerHTML = '<div class="grid2"><section class="card"><div class="card-h"><h2>Subject &amp; sender</h2></div><div class="card-b stack" style="gap:12px">' +
        '<div class="field"><label for="wSub">Subject line</label><input class="in" id="wSub" value="' + esc(c.subject) + '" maxlength="150"><div class="actions" style="justify-content:space-between">' + tagSel('wSubTag') + '<span class="hint" id="wSubN"></span></div></div>' +
        '<div class="field"><label for="wPre">Preview text</label><input class="in" id="wPre" value="' + esc(c.preview) + '" maxlength="150" placeholder="Shown after the subject in most inboxes"><div class="actions">' + tagSel('wPreTag') + '</div></div>' +
        '<div class="row2"><div class="field"><label for="wFn">Sender name</label><input class="in" id="wFn" value="' + esc(c.fromName) + '"></div><div class="field"><label for="wFe">Sender email</label><select class="in" id="wFe">' + SENDERS.map(function (s) { return '<option' + (c.fromEmail === s ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></div></div>' +
        '<div class="field"><label for="wRt">Reply-to</label><input class="in" id="wRt" type="email" value="' + esc(c.replyTo) + '"></div><label class="check"><input type="checkbox" class="chk" id="wUtm"' + (c.utm ? ' checked' : '') + '> Add UTM tracking parameters to links</label>' +
        '<p class="hint" style="margin:0">Syntax: {{ first_name|default:"there" }} — the default is used when the profile has no value.</p></div></section>' +
        '<section class="card"><div class="card-h"><h2>Inbox preview</h2></div><div class="card-b stack" style="gap:12px">' + UI.picker('wPP', 'Preview for profile', U.pref('previewP') || 1) + '<div id="wInbox"></div></div></section></div>';
      var inbox = function () {
        var p = E.profile(U.pref('previewP') || 1) || E.db().profiles[0];
        var bad = M.badTags(c.subject + ' ' + c.preview);
        box.querySelector('#wSubN').textContent = c.subject.length + ' characters' + (c.subject.length > 60 ? ' — consider shortening for mobile' : '');
        box.querySelector('#wInbox').innerHTML = '<div style="border:1px solid var(--line);border-radius:14px;overflow:hidden"><div style="padding:8px 14px;background:var(--sunken);font:400 11px var(--mono);color:var(--ink3)">INBOX · ' + esc(p.email) + '</div><div style="padding:12px 14px;display:flex;gap:12px"><span class="av tone-teal">AD</span><div style="min-width:0"><div style="display:flex;justify-content:space-between;gap:8px"><b style="font-weight:500">' + esc(c.fromName) + '</b><small class="muted">10:00</small></div><div style="font-weight:500;overflow-wrap:anywhere">' + esc(M.resolve(c.subject, p) || '(no subject)') + '</div><div class="muted" style="font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(M.resolve(c.preview, p)) + '</div></div></div></div>' +
          (bad.length ? '<div class="banner bad">Malformed tag: ' + esc(bad[0]) + '</div>' : '') + '<p class="hint" style="margin:0">Resolved for ' + esc(E.fullName(p)) + '. Tags: ' + esc(M.tagsIn(c.subject + c.preview).join(', ') || 'none') + '.</p>';
      };
      inbox();
      UI.wirePicker(box, 'wPP', function (p) { U.pref('previewP', p.id); inbox(); });
      var bind = function (id, k) { box.querySelector('#' + id).addEventListener('input', function (e) { c[k] = e.target.value; save(); inbox(); }); };
      bind('wSub', 'subject'); bind('wPre', 'preview'); bind('wFn', 'fromName'); bind('wRt', 'replyTo');
      box.querySelector('#wFe').addEventListener('change', function (e) { c.fromEmail = e.target.value; save(); });
      box.querySelector('#wUtm').addEventListener('change', function (e) { c.utm = e.target.checked; save(); });
      ['wSubTag', 'wPreTag'].forEach(function (id) { box.querySelector('#' + id).addEventListener('change', function (e) { var t = e.target.value; if (!t) return; e.target.value = ''; var inp = box.querySelector(id === 'wSubTag' ? '#wSub' : '#wPre'); var tag = '{{ ' + t + (t === 'first_name' ? '|default:"there"' : '') + ' }}'; var pos = inp.selectionStart != null ? inp.selectionStart : inp.value.length; inp.value = inp.value.slice(0, pos) + tag + inp.value.slice(pos); inp.dispatchEvent(new Event('input')); inp.focus(); }); });
    } else if (step === 3) {
      box.innerHTML = '<div class="grid2"><section class="card"><div class="card-h"><h2>Email content</h2><div class="actions"><button type="button" class="btn" id="wTpl">Replace with template…</button><a class="btn pri" href="#/campaigns/' + c.id + '/content">' + ic(I.edit) + 'Open email editor</a></div></div><div class="card-b">' + UI.frame(UI.emailHtml(c.design, { profile: E.profile(U.pref('previewP') || 1), subject: c.subject, preview: c.preview }), {}) + '</div></section>' +
        '<section class="card"><div class="card-h"><h2>Checks</h2></div><div class="card-b">' + AM.Editor.checksHtml(AM.Editor.checks(c.design, c.subject, c.preview)) + '</div></section></div>';
      box.querySelector('#wTpl').addEventListener('click', function () { chosenTplDialog(function (tid) { U.confirm({ title: 'Replace the content?', text: 'The current design will be replaced by the template.', ok: 'Replace' }).then(function (ok) { if (!ok) return; var t = tid ? E.template(tid) : null; c.design = t ? M.reid(t.design) : M.newDesign(); c.tpl = t ? t.key : ''; save(); AM.App.render(true); }); }); });
    } else if (step === 4) {
      var ab = c.ab;
      var draw4 = function () {
        var a = E.audience(c), n = a.ids.length, test = Math.round(n * ab.testPct / 100);
        box.innerHTML = '<div class="grid2"><section class="card"><div class="card-h"><h2>A/B test</h2><label class="check"><input type="checkbox" class="chk" id="abOn"' + (ab.on ? ' checked' : '') + '> Run an A/B test</label></div><div class="card-b stack" style="gap:12px"' + (ab.on ? '' : ' hidden') + '>' +
          '<div class="field"><span class="lab">What to test</span><div class="radios"><label><input type="radio" name="abT" value="subject"' + (ab.type === 'subject' ? ' checked' : '') + '> Subject line</label><label><input type="radio" name="abT" value="content"' + (ab.type === 'content' ? ' checked' : '') + '> Content</label></div></div>' +
          ab.variants.map(function (v, i) { var k = String.fromCharCode(65 + i); return ab.type === 'subject' ? '<div class="field"><label for="abS' + i + '">Variant ' + k + ' subject' + (i === 0 ? ' (from step 2)' : '') + '</label><input class="in" id="abS' + i + '" data-abs="' + i + '" value="' + esc(i === 0 ? c.subject : v.subject) + '"' + (i === 0 ? ' disabled' : '') + '></div>' : '<div class="actions" style="justify-content:space-between;border:1px solid var(--hair);border-radius:14px;padding:10px 12px"><span>Variant ' + k + ' — ' + (i === 0 ? 'main design' : v.design ? U.plural(v.design.blocks.length, 'block') : 'copy of A') + '</span><a class="btn sm" href="#/campaigns/' + c.id + '/content' + (i ? '/' + i : '') + '">' + ic(I.edit) + 'Edit content ' + k + '</a></div>'; }).join('') +
          '<div class="actions">' + (ab.variants.length < 4 ? '<button type="button" class="btn sm" id="abAdd">' + ic(I.plus) + 'Add variant</button>' : '') + (ab.variants.length > 2 ? '<button type="button" class="btn sm ghost" id="abRm">Remove last variant</button>' : '') + '</div>' +
          '<div class="field"><label for="abPct">Test group: ' + ab.testPct + '% of recipients</label><input type="range" id="abPct" min="10" max="50" step="5" value="' + ab.testPct + '"></div>' +
          '<div class="row2"><div class="field"><label for="abM">Winner metric</label><select class="in" id="abM"><option value="open"' + (ab.metric === 'open' ? ' selected' : '') + '>Open rate</option><option value="click"' + (ab.metric === 'click' ? ' selected' : '') + '>Click rate</option><option value="revenue"' + (ab.metric === 'revenue' ? ' selected' : '') + '>Revenue per recipient</option></select></div><div class="field"><label for="abW">Wait before choosing</label><select class="in" id="abW">' + [1, 2, 4, 6, 12, 24].map(function (h) { return '<option value="' + h + '"' + (+ab.wait === h ? ' selected' : '') + '>' + h + ' hours</option>'; }).join('') + '</select></div></div></div></section>' +
          '<section class="card"><div class="card-h"><h2>How it will run</h2></div><div class="card-b">' + (ab.on ? '<ol style="margin:0;padding-left:18px;color:var(--ink2);display:flex;flex-direction:column;gap:6px"><li><b style="font-weight:500;color:var(--ink)">' + U.n(test) + '</b> recipients (' + ab.testPct + '%) are split evenly: ~' + U.n(Math.floor(test / ab.variants.length)) + ' per variant.</li><li>After <b style="font-weight:500;color:var(--ink)">' + ab.wait + ' h</b> the variant with the best <b style="font-weight:500;color:var(--ink)">' + { open: 'open rate', click: 'click rate', revenue: 'revenue per recipient' }[ab.metric] + '</b> wins.</li><li>The winner goes to the remaining <b style="font-weight:500;color:var(--ink)">' + U.n(n - test) + '</b> recipients.</li></ol><p class="hint">In the demo the wait is fast-forwarded during the simulated send.</p>' : '<p class="muted" style="margin:0">No test — everyone receives the same email.</p>') + '</div></section></div>';
      };
      draw4();
      box.addEventListener('change', function (e) {
        var t = e.target;
        if (t.id === 'abOn') { ab.on = t.checked; if (ab.on && ab.type === 'subject' && !ab.variants[1].subject) ab.variants[1].subject = c.subject ? c.subject + ' — last chance' : ''; }
        if (t.name === 'abT') { ab.type = t.value; if (ab.type === 'content') ab.variants.forEach(function (v, i) { if (i && !v.design) v.design = M.reid(c.design); }); }
        if (t.id === 'abM') ab.metric = t.value; if (t.id === 'abW') ab.wait = +t.value;
        save(); if (t.id !== 'abPct') draw4();
      });
      box.addEventListener('input', function (e) { var t = e.target; if (t.dataset.abs) { ab.variants[+t.dataset.abs].subject = t.value; save(); } if (t.id === 'abPct') { ab.testPct = +t.value; save(); draw4(); box.querySelector('#abPct').focus(); } });
      box.addEventListener('click', function (e) { if (e.target.closest('#abAdd')) { ab.variants.push({ subject: c.subject, design: ab.type === 'content' ? M.reid(c.design) : null }); save(); draw4(); } if (e.target.closest('#abRm')) { ab.variants.pop(); save(); draw4(); } });
    } else {
      var sc = c.schedule || (c.schedule = { type: 'now' });
      var draw5 = function () {
        var a = E.audience(c), checks = AM.Editor.checks(c.design, c.subject, c.preview);
        if (!a.ids.length) checks.unshift({ ok: false, t: 'No eligible recipients in the audience' }); else checks.unshift({ ok: true, t: U.n(a.ids.length) + ' eligible recipients' });
        if (c.ab.on && c.ab.type === 'subject' && c.ab.variants.slice(1).some(function (v) { return !String(v.subject || '').trim(); })) checks.push({ ok: false, t: 'A/B variant subject is empty' });
        var blocking = checks.some(function (x) { return !x.ok && !x.warn; });
        var hour = E.bestHour();
        box.innerHTML = '<div class="grid2"><section class="card"><div class="card-h"><h2>When to send</h2></div><div class="card-b stack" style="gap:12px"><div class="radios" role="radiogroup" aria-label="Send time"><label><input type="radio" name="sc" value="now"' + (sc.type === 'now' ? ' checked' : '') + '> Send now</label><label><input type="radio" name="sc" value="at"' + (sc.type === 'at' ? ' checked' : '') + '> Schedule</label><label><input type="radio" name="sc" value="smart"' + (sc.type === 'smart' ? ' checked' : '') + '> Smart send time</label></div>' +
          (sc.type === 'at' ? '<div class="field"><label for="scAt">Date and time (demo clock)</label><input class="in" type="datetime-local" id="scAt" value="' + U.localInput(sc.at || E.now() + DAY) + '"></div>' : '') +
          (sc.type === 'smart' ? '<div class="field"><label for="scDay">Day</label><input class="in" type="date" id="scDay" value="' + esc(sc.day || U.ymd(E.now() + DAY)) + '"></div><p class="hint" style="margin:0">Smart send picks the hour when your subscribers open most: <b style="font-weight:500;color:var(--ink)">' + U.p2(hour) + ':00</b> (from opens in the last 120 days).</p>' : '') +
          '<p class="hint" style="margin:0">Demo clock: ' + esc(U.dateTime(E.now())) + '. Scheduled sends happen when the clock passes the time (fast-forward in the Event simulator).</p></div></section>' +
          '<section class="card"><div class="card-h"><h2>Review</h2></div><div class="kv">' + [['Audience', UI.audienceText(c)], ['Subject', c.subject || '—'], ['From', c.fromName + ' <' + c.fromEmail + '>'], ['A/B test', c.ab.on ? c.ab.variants.length + ' ' + (c.ab.type === 'subject' ? 'subject' : 'content') + ' variants · ' + c.ab.testPct + '% · ' + c.ab.metric : 'Off'], ['Send', sc.type === 'now' ? 'Immediately' : U.dateTime(E.sendTime(c))]].map(function (x) { return '<div><span class="k">' + x[0] + '</span><p>' + esc(x[1]) + '</p></div>'; }).join('') + '</div><div class="card-b">' + AM.Editor.checksHtml(checks) +
          '<div class="actions" style="margin-top:12px">' + (sc.type === 'now' ? '<button type="button" class="btn pri" id="goSend"' + (blocking ? ' disabled' : '') + '>' + ic(I.send) + 'Send now (simulated)</button>' : '<button type="button" class="btn pri" id="goSched"' + (blocking ? ' disabled' : '') + '>' + ic(I.clock) + 'Schedule</button>') + '</div>' + (blocking ? '<p class="hint">Fix the red checks to send.</p>' : '') + '</div></section></div>';
      };
      draw5();
      box.addEventListener('change', function (e) {
        var t = e.target;
        if (t.name === 'sc') { sc.type = t.value; if (t.value === 'at' && !sc.at) sc.at = U.dayStart(E.now() + DAY) + 10 * HOUR; if (t.value === 'smart' && !sc.day) sc.day = U.ymd(E.now() + DAY); }
        if (t.id === 'scAt') { var v = new Date(t.value).getTime(); if (isFinite(v)) sc.at = v; }
        if (t.id === 'scDay') sc.day = t.value;
        save(); draw5();
      });
      box.addEventListener('click', function (e) {
        if (e.target.closest('#goSend')) confirmSend(c);
        if (e.target.closest('#goSched')) {
          var when = E.sendTime(c);
          if (when <= E.now()) { U.toast('Pick a time after the demo clock (' + U.dateTime(E.now()) + ').'); return; }
          c.status = 'scheduled'; c.updated = E.now(); App().save(['campaigns']); U.toast('Scheduled for ' + U.dateTime(when) + ' (simulated send).'); location.hash = '#/campaigns/' + c.id;
        }
      });
    }
  }

  // Content editor for campaigns (variant 0 = main design)
  AM.route(/^\/campaigns\/(\d+)\/content(?:\/(\d))?$/, function (page, m) {
    var c = E.campaign(m[1]); if (!c) { page.innerHTML = '<div class="empty box">Campaign not found.</div>'; return; }
    var vi = +(m[2] || 0), v = vi ? c.ab.variants[vi] : null;
    if (vi && !v) { location.hash = '#/campaigns/' + c.id + '/edit/4'; return; }
    if (v && !v.design) v.design = M.reid(c.design);
    var design = v ? v.design : c.design, locked = c.status === 'sent' || c.status === 'sending';
    App().title = 'Edit email — ' + c.name;
    page.innerHTML = UI.head({ crumb: { href: '#/campaigns/' + c.id + (locked ? '' : '/edit/3'), label: c.name }, title: (vi ? 'Variant ' + String.fromCharCode(65 + vi) + ' content' : 'Email content'), sub: locked ? 'This campaign was sent — editing is disabled; this is a read-only copy.' : 'Changes save automatically.' }) + '<div id="edHost"></div>';
    AM.Editor.mount(page.querySelector('#edHost'), { design: locked ? U.clone(design) : design, title: c.name, fileName: 'campaign-' + c.id, subject: function () { return c.subject; }, preview: function () { return c.preview; }, onChange: function () { if (!locked) { c.updated = E.now(); App().save(['campaigns']); } } });
  }, 'campaigns');

  // ── Campaign report ───────────────────────────────────────────────────
  function report(page, c) {
    var s = E.cStats(c), now = E.now(), sms = c.channel === 'sms', base = sms ? '#/sms' : '#/campaigns';
    var hours = 72, ser = E.series('c:' + c.id, c.sentAt, hours);
    var h = UI.head({ crumb: { href: base, label: sms ? 'SMS' : 'Campaigns' }, title: c.name, sub: UI.status('sent') + ' <span>' + esc(U.dateTime(c.sentAt)) + '</span><span>' + esc(UI.audienceText(c)) + '</span>', actions: '<button type="button" class="btn" id="rDup">' + ic(I.copy) + 'Duplicate</button><button type="button" class="btn" id="rCsv">' + ic(I.download) + 'Export CSV</button>' + (sms ? '' : '<a class="btn" href="#/campaigns/' + c.id + '/content">' + ic(I.eye) + 'View email</a>') });
    h += '<div class="kpis">' + UI.kpi('Recipients', U.n(s.recipients), U.n(s.delivered) + ' delivered' + (sms ? '' : ' · ' + U.n(s.bounce) + ' bounced')) +
      (sms ? '' : UI.kpi('Opens', U.pct(s.openRate), U.n(s.open) + ' unique opens')) +
      UI.kpi('Clicks', U.pct(s.clickRate, 2), U.n(s.click) + ' unique · ' + U.n(s.clickTotal) + ' total' + (sms ? '' : ' · CTOR ' + U.pct(s.ctor))) +
      UI.kpi('Revenue', U.money(s.revenue), U.n(s.orders) + ' orders · ' + U.pct(s.convRate, 2) + ' conversion · ' + U.money2(s.rpr) + ' / recipient', 'hero') +
      UI.kpi('Unsubscribes', U.n(s.unsub), U.pct(s.unsubRate, 2) + (sms ? ' replied STOP' : '')) + (sms ? UI.kpi('Segments & cost', U.n(c.st.segments || 0), 'simulated cost ' + U.money2(c.st.cost || 0)) : UI.kpi('Spam complaints', U.n(s.spam), U.pct(s.spamRate, 3))) + '</div>';
    h += '<section class="card"><div class="card-h"><div><span class="label">First 72 hours after sending</span><h2>Performance over time</h2></div></div>' + (c.sentAt > now - 72 * HOUR ? '<div class="card-b" style="padding-bottom:0"><p class="hint" style="margin:0">Sent recently: the simulation generates the whole 72-hour engagement up-front; the dashboard counts it as the demo clock passes each hour.</p></div>' : '') + '<div class="chart" id="rTime"></div></section>';
    if (c.st && c.st.ab) {
      var ab = c.st.ab, keys = Object.keys(ab.counts);
      h += '<section class="card mt"><div class="card-h"><div><span class="label">A/B test · ' + esc({ open: 'open rate', click: 'click rate', revenue: 'revenue per recipient' }[ab.metric]) + ' decides</span><h2>Variant ' + esc(ab.winner) + ' won</h2></div></div><div class="tablewrap"><table class="tbl"><thead><tr><th>Variant</th><th class="r">Test group</th><th class="r">Test open rate</th><th class="r">Test click rate</th><th class="r">Test rev / recipient</th><th class="r">Total recipients</th><th class="r">Revenue (all)</th></tr></thead><tbody>' +
        keys.map(function (k, i) { var t = ab.test[k], vs = E.variantStats(c, k), v = c.ab.variants[i] || {}; return '<tr><td><b style="font-weight:500">' + k + '</b> ' + (k === ab.winner ? '<span class="chip win">Winner</span>' : '') + '<small>' + esc(c.ab.type === 'content' ? (i ? 'Content variant' : 'Main content') : (i === 0 ? c.subject : v.subject)) + '</small></td><td class="r num">' + U.n(t.n) + '</td><td class="r num">' + U.pct(t.n ? t.open / t.n : 0) + '</td><td class="r num">' + U.pct(t.n ? t.click / t.n : 0, 2) + '</td><td class="r num">' + U.money2(t.n ? t.revenue / t.n : 0) + '</td><td class="r num">' + U.n(ab.counts[k]) + '</td><td class="r num">' + U.money(vs.revenue) + '</td></tr>'; }).join('') + '</tbody></table></div><div class="card-b"><p class="hint" style="margin:0">' + U.n(ab.testN) + ' recipients in the test; after ' + ab.wait + ' h the winner went to the remaining ' + U.n(ab.restN) + '.</p></div></section>';
    }
    if (!sms) {
      h += '<div class="grid2 mt"><section class="card"><div class="card-h"><div><span class="label">Clicks per link block</span><h2>Click map</h2></div></div><div class="card-b" id="rMap"></div></section><section class="card"><div class="card-h"><h2>Heatmap</h2></div><div class="card-b" id="rHeat"></div></section></div>';
    } else {
      h += '<div class="grid2 mt"><section class="card"><div class="card-h"><h2>Message</h2></div><div class="card-b"><div class="phone"><div class="bubble">' + esc(M.resolve(c.body, E.profile(1))) + '</div></div></div></section><section class="card"><div class="card-h"><h2>Delivery</h2></div><div class="kv">' + [['Sender ID', c.sender], ['Excluded — no SMS consent', U.n(c.st.noConsent || 0)], ['Excluded — no phone', U.n(c.st.noAddress || 0)], ['Suppressed', U.n(c.st.suppressed || 0)], ['Encoding', c.st.encoding || '—'], ['Segments per message', c.st.perMsg || '—']].map(function (x) { return '<div><span class="k">' + x[0] + '</span><p>' + esc(x[1]) + '</p></div>'; }).join('') + '</div></section></div>';
    }
    h += '<div class="grid2 even mt"><section class="card"><div class="card-h"><h2>Attributed orders</h2></div><ul class="rows" id="rOrders"></ul></section><section class="card"><div class="card-h"><h2>Delivery &amp; deliverability</h2></div><div class="tiles" style="padding-top:6px">' +
      '<div class="tile"><span class="label">Bounced</span><div class="v">' + U.n(s.bounce) + '</div><small>' + U.n(s.hard) + ' hard · ' + U.n(s.bounce - s.hard) + ' soft · ' + U.pct(s.bounceRate, 2) + '</small></div><div class="tile"><span class="label">Unsubscribed</span><div class="v">' + U.n(s.unsub) + '</div><small>' + U.pct(s.unsubRate, 2) + '</small></div><div class="tile"><span class="label">Spam</span><div class="v">' + U.n(s.spam) + '</div><small>' + U.pct(s.spamRate, 3) + '</small></div>' +
      '<div class="tile"><span class="label">Excluded</span><div class="v">' + U.n((c.st.noConsent || 0) + (c.st.suppressed || 0) + (c.st.excluded || 0)) + '</div><small>no consent / suppressed / excluded</small></div></div></section></div>';
    page.innerHTML = h;
    var lab = []; for (var i = 0; i < hours; i++) lab.push('+' + i + 'h');
    C.line(page.querySelector('#rTime'), { labels: lab, aria: 'Opens and clicks per hour after sending', series: (sms ? [] : [{ name: 'Opens', color: 'var(--accent)', values: ser.opens, area: true }]).concat([{ name: 'Clicks', color: 'var(--c-teal)', values: ser.clicks }]) });
    var orderRef = E.attr().orderRef, orders = [];
    orderRef.forEach(function (ref, ev) { if (ref === 'c:' + c.id || ref.indexOf('c:' + c.id + ':') === 0) orders.push(ev); });
    orders.sort(function (a, b) { return b.v - a.v; });
    page.querySelector('#rOrders').innerHTML = orders.slice(0, 10).map(function (o) { var p = E.profile(o.p), pr = E.product(o.s); return '<li><div class="main">' + UI.who(p) + '</div><div class="end"><span class="small" style="display:block;text-align:right">' + esc(pr ? pr.name : '') + '<br>' + esc(U.dateTime(o.ts)) + '</span><b class="num" style="font-weight:500">' + U.money2(o.v) + '</b></div></li>'; }).join('') || '<li><div class="main muted">No attributed orders.</div></li>';
    if (!sms) {
      var blocks = M.linkBlocks(c.design), tot = s.clickTotal || 0;
      page.querySelector('#rMap').innerHTML = blocks.length ? C.hbars(blocks.map(function (b) { var lbl = M.BLOCKS[b.type].label + (b.label ? ': ' + b.label : b.headline ? ': ' + b.headline : b.title ? ': ' + b.title : ''); return { label: lbl, sub: tot ? U.pct((s.links[b.id] || 0) / tot) + ' of clicks' : '', v: s.links[b.id] || 0 }; })) + '<p class="hint">Total clicks ' + U.n(tot) + ' (unique ' + U.n(s.click) + ').</p>' : '<div class="empty">No links in this email.</div>';
      page.querySelector('#rHeat').innerHTML = UI.frame(UI.emailHtml(c.design, { profile: E.profile(1), subject: c.subject, preview: c.preview, heat: s.links, heatTotal: tot }), { title: 'Click heatmap' });
    }
    page.querySelector('#rDup').addEventListener('click', function (e) { campaignMenu(e.currentTarget, c); });
    page.querySelector('#rCsv').addEventListener('click', function () {
      var rows = [['metric', 'value']].concat([['campaign', c.name], ['sent_at', new Date(c.sentAt).toISOString()], ['recipients', s.recipients], ['delivered', s.delivered], ['bounces', s.bounce], ['unique_opens', s.open], ['open_rate', s.openRate.toFixed(4)], ['unique_clicks', s.click], ['click_rate', s.clickRate.toFixed(4)], ['unsubscribes', s.unsub], ['spam', s.spam], ['orders', s.orders], ['revenue_eur', s.revenue.toFixed(2)]]);
      Object.keys(s.links).forEach(function (k) { rows.push(['clicks_block_' + k, s.links[k]]); });
      U.download('adrial-mail-' + (sms ? 'sms' : 'campaign') + '-' + c.id + '-report.csv', U.csv(rows)); U.toast('Report exported.');
    });
  }

  // ── SMS ───────────────────────────────────────────────────────────────
  AM.route(/^\/sms$/, function (page) {
    App().title = 'SMS';
    var db = E.db(), rows = db.campaigns.filter(function (c) { return c.channel === 'sms'; }).sort(function (a, b) { return (b.sentAt || b.updated) - (a.sentAt || a.updated); });
    var reach = db.profiles.filter(E.canSms).length;
    page.innerHTML = UI.head({ title: 'SMS', dot: true, sub: 'Simulated SMS campaigns — <b>' + U.n(reach) + '</b> profiles with SMS consent. No message is ever sent; numbers are fake.', actions: '<button type="button" class="btn pri" id="sNew">' + ic(I.plus) + 'Create SMS campaign</button>' }) +
      '<section class="card"><div class="tablewrap"><table class="tbl"><thead><tr><th>SMS campaign</th><th>Status</th><th>Date</th><th class="r">Recipients</th><th class="r">Click rate</th><th class="r">Opt-outs</th><th class="r">Revenue</th><th><span class="sr">Actions</span></th></tr></thead><tbody>' +
      rows.map(function (c) { var s = c.status === 'sent' ? E.cStats(c) : null; return '<tr><td><a class="t1" href="#/sms/' + c.id + '">' + esc(c.name) + '</a><small>' + esc(String(c.body).slice(0, 70)) + '…</small></td><td>' + UI.status(c.status) + '</td><td class="num">' + (c.sentAt ? esc(U.date(c.sentAt)) : c.status === 'scheduled' ? esc(U.dateTime(E.sendTime(c))) : '—') + '</td><td class="r num">' + (s ? U.n(s.recipients) : '~' + U.n(E.audience(c).ids.length)) + '</td><td class="r num">' + (s ? U.pct(s.clickRate) : '—') + '</td><td class="r num">' + (s ? U.n(s.unsub) : '—') + '</td><td class="r num">' + (s ? U.money(s.revenue) : '—') + '</td><td class="r"><button type="button" class="btn xs icon ghost" data-cm="' + c.id + '" aria-label="Actions for ' + esc(c.name) + '" aria-haspopup="menu">' + ic(I.more) + '</button></td></tr>'; }).join('') + '</tbody></table></div></section>';
    page.addEventListener('click', function (e) {
      if (e.target.closest('#sNew')) { var c = newCampaign({ channel: 'sms', name: 'New SMS campaign' }); location.hash = '#/sms/' + c.id; }
      var b = e.target.closest('[data-cm]'); if (b) campaignMenu(b, E.campaign(b.dataset.cm), function () { AM.App.render(true); });
    });
  }, 'sms');

  AM.route(/^\/sms\/(\d+)$/, function (page, m) {
    var c = E.campaign(m[1]);
    if (!c || c.channel !== 'sms') { page.innerHTML = '<div class="empty box">SMS campaign not found. <a href="#/sms">All SMS</a></div>'; return; }
    App().title = c.name;
    if (c.status === 'sent') return report(page, c);
    if (c.status === 'sending') return sendingView(page, c, '#/sms');
    var save = U.debounce(function () { c.updated = E.now(); App().save(['campaigns']); }, 300);
    var db = E.db();
    page.innerHTML = UI.head({ crumb: { href: '#/sms', label: 'SMS' }, title: c.name, sub: UI.status(c.status) + ' <span>Autosaved</span>' + (c.status === 'scheduled' ? '<span>Sends ' + esc(U.dateTime(E.sendTime(c))) + '</span>' : '') }) +
      '<div class="grid2"><div class="stack"><section class="card"><div class="card-h"><h2>Message</h2></div><div class="card-b stack" style="gap:12px"><div class="row2"><div class="field"><label for="smN">Campaign name</label><input class="in" id="smN" value="' + esc(c.name) + '"></div><div class="field"><label for="smS">Sender ID (max 11)</label><input class="in" id="smS" maxlength="11" value="' + esc(c.sender) + '"></div></div>' +
      '<div class="field"><label for="smB">Text</label><textarea class="in" id="smB" rows="5">' + esc(c.body) + '</textarea><div class="actions" style="justify-content:space-between"><label class="sr" for="smTag">Insert tag</label><select class="in sm" id="smTag" style="width:auto"><option value="">+ Personalization tag</option><option value="first_name">First name</option><option value="city">City</option><option value="properties.preferred_store">Preferred store</option></select><span class="counter" id="smCnt"></span></div></div>' +
      '<label class="check"><input type="checkbox" class="chk" id="smStop"' + (c.stop ? ' checked' : '') + '> Require opt-out instructions (STOP)</label><div id="smWarn"></div></div></section>' +
      '<section class="card"><div class="card-h"><h2>Audience</h2></div><div class="card-b">' + audiencePicker(c) + '</div></section></div>' +
      '<div class="stack"><section class="card"><div class="card-h"><h2>Phone preview</h2></div><div class="card-b stack" style="gap:12px">' + UI.picker('smPP', 'Preview for profile', U.pref('previewP') || 1) + '<div class="phone"><div class="bubble" id="smBub"></div></div></div></section>' +
      '<section class="card"><div class="card-b" style="padding-top:18px" id="smEst"></div></section>' +
      '<section class="card"><div class="card-h"><h2>Send</h2></div><div class="card-b stack" style="gap:10px"><div class="radios"><label><input type="radio" name="smW" value="now"' + (c.schedule.type !== 'at' ? ' checked' : '') + '> Now</label><label><input type="radio" name="smW" value="at"' + (c.schedule.type === 'at' ? ' checked' : '') + '> Schedule</label></div><div id="smAt"></div><div id="smGo"></div></div></section></div></div>';
    var $ = function (s) { return page.querySelector(s); };
    var draw = function () {
      var info = U.smsInfo(c.body), a = E.audience(c), p = E.profile(U.pref('previewP') || 1) || db.profiles[0];
      var resolved = M.resolve(c.body, p), rinfo = U.smsInfo(resolved);
      $('#smCnt').innerHTML = '<span><b>' + info.chars + '</b> chars</span><span>' + esc(info.encoding) + '</span><span><b>' + info.segments + '</b> segment' + (info.segments === 1 ? '' : 's') + '</span><span>' + info.left + ' left in segment</span>';
      var warn = [];
      if (info.nonGsm.length) warn.push('Characters ' + info.nonGsm.map(function (x) { return '"' + x + '"'; }).join(' ') + ' switch the message to Unicode (70 chars per segment). Replace č/š/ž with c/s/z to save segments.');
      if (c.stop && !/STOP/i.test(c.body)) warn.push('Add opt-out text such as "Odjava: STOP" — required for marketing SMS.');
      if (M.badTags(c.body).length) warn.push('Malformed tag: ' + M.badTags(c.body)[0]);
      $('#smWarn').innerHTML = warn.map(function (w) { return '<div class="banner warn" style="margin-top:6px">' + esc(w) + '</div>'; }).join('');
      $('#smBub').textContent = resolved || '(empty)';
      var segs = rinfo.segments || info.segments;
      $('#smEst').innerHTML = audienceEstimate(c) + '<div class="counter" style="margin-top:10px"><span>Segments <b>' + U.n(a.ids.length * segs) + '</b></span><span>Est. cost <b>' + U.money2(a.ids.length * segs * db.settings.smsCost) + '</b> (simulated, ' + U.money2(db.settings.smsCost) + '/segment)</span></div>';
      if (c.schedule.type === 'at') { $('#smAt').innerHTML = '<div class="field"><label for="smAtI">Date and time</label><input class="in" type="datetime-local" id="smAtI" value="' + U.localInput(c.schedule.at || E.now() + DAY) + '"></div>' + (function () { var hr = new Date(c.schedule.at || 0).getHours(); return hr >= 21 || hr < 8 ? '<div class="banner warn" style="margin-top:8px">Quiet hours: marketing SMS should not be sent between 21:00 and 08:00.</div>' : ''; })(); } else $('#smAt').innerHTML = '';
      var block = !a.ids.length || !c.body.trim() || (c.stop && !/STOP/i.test(c.body)) || M.badTags(c.body).length;
      $('#smGo').innerHTML = (c.status === 'scheduled' ? '<button type="button" class="btn" id="smUn">Unschedule</button> ' : '') + '<button type="button" class="btn pri" id="smSend"' + (block ? ' disabled' : '') + '>' + ic(c.schedule.type === 'at' ? I.clock : I.send) + (c.schedule.type === 'at' ? 'Schedule (simulated)' : 'Send now (simulated)') + '</button>' + (block ? '<p class="hint">Needs recipients, text and opt-out instructions.</p>' : '');
    };
    draw();
    wireAudience(page, c, draw);
    UI.wirePicker(page, 'smPP', function (p) { U.pref('previewP', p.id); draw(); });
    page.addEventListener('input', function (e) {
      var t = e.target;
      if (t.id === 'smN') { c.name = t.value; save(); }
      if (t.id === 'smS') { c.sender = t.value.replace(/[^A-Za-z0-9 ]/g, '').slice(0, 11); save(); }
      if (t.id === 'smB') { c.body = t.value; save(); draw(); }
    });
    page.addEventListener('change', function (e) {
      var t = e.target;
      if (t.id === 'smStop') { c.stop = t.checked; save(); draw(); }
      if (t.name === 'smW') { c.schedule = t.value === 'at' ? { type: 'at', at: U.dayStart(E.now() + DAY) + 17 * HOUR } : { type: 'now' }; save(); draw(); }
      if (t.id === 'smAtI') { var v = new Date(t.value).getTime(); if (isFinite(v)) c.schedule.at = v; save(); draw(); }
      if (t.id === 'smTag' && t.value) { var b = $('#smB'), pos = b.selectionStart || b.value.length, tag = '{{ ' + t.value + (t.value === 'first_name' ? '|default:"Pozdravljeni"' : '') + ' }}'; b.value = b.value.slice(0, pos) + tag + b.value.slice(pos); t.value = ''; c.body = b.value; save(); draw(); b.focus(); }
    });
    page.addEventListener('click', function (e) {
      if (e.target.closest('#smUn')) { c.status = 'draft'; save(); AM.App.render(true); }
      if (e.target.closest('#smSend')) {
        var info = U.smsInfo(c.body); c.st = c.st || {};
        if (c.schedule.type === 'at') { if (E.sendTime(c) <= E.now()) { U.toast('Pick a time after the demo clock.'); return; } c.status = 'scheduled'; App().save(['campaigns']); U.toast('SMS scheduled (simulated).'); AM.App.render(true); return; }
        var a = E.audience(c);
        U.confirm({ title: 'Send SMS to ' + U.n(a.ids.length) + ' recipients?', html: 'Simulated — <b style="font-weight:500">no SMS is sent</b>. ' + U.n(a.ids.length * info.segments) + ' segments, estimated cost ' + U.money2(a.ids.length * info.segments * db.settings.smsCost) + ' (not charged).', ok: 'Send (simulated)' }).then(function (ok) {
          if (!ok) return;
          AM.App.sendCampaign(c); c.st.segments = a.ids.length * info.segments; AM.App.render(true);
        });
      }
    });
  }, 'sms');
  // Fill SMS-specific numbers once a send commits (segments, cost, encoding).
  var origCommit = E.commitSend;
  E.commitSend = function (c, res, ts) {
    origCommit(c, res, ts);
    if (c.channel === 'sms') { var info = U.smsInfo(c.body); c.st.encoding = info.encoding; c.st.perMsg = info.segments; c.st.segments = c.st.recipients * info.segments; c.st.cost = Math.round(c.st.segments * (E.db().settings.smsCost || 0.045) * 100) / 100; }
  };

  // ── Templates ─────────────────────────────────────────────────────────
  AM.route(/^\/templates$/, function (page) {
    App().title = 'Templates';
    var db = E.db();
    page.innerHTML = UI.head({ title: 'Templates', dot: true, sub: 'Ready-made designs for campaigns and flows. Edit them, or save any email as a new template from the editor.', actions: '<button type="button" class="btn pri" id="tNew">' + ic(I.plus) + 'New blank template</button>' }) +
      '<div class="cards">' + db.templates.map(function (t) {
        return '<article class="card tcard"><div class="thumb">' + thumb(t.design, 150) + '</div><div class="tb"><b>' + esc(t.name) + '</b><small>' + esc(t.category) + (t.builtin ? ' · built-in' : ' · custom') + '</small><small>' + esc(t.subject || '') + '</small><div class="ta"><a class="btn sm" href="#/templates/' + t.id + '">' + ic(I.edit) + 'Edit</a><button type="button" class="btn sm" data-tprev="' + t.id + '">' + ic(I.eye) + 'Preview</button><button type="button" class="btn sm pri" data-tuse="' + t.id + '">Use in campaign</button><button type="button" class="btn sm icon ghost" data-tmenu="' + t.id + '" aria-label="More actions for ' + esc(t.name) + '" aria-haspopup="menu">' + ic(I.more) + '</button></div></div></article>';
      }).join('') + '</div>';
    page.addEventListener('click', function (e) {
      var b;
      if (e.target.closest('#tNew')) { var now = E.now(), t = { id: E.nextId('template'), key: 'custom', name: 'Untitled template', category: 'Custom', subject: '', preview: '', builtin: false, created: now, updated: now, design: M.newDesign() }; db.templates.push(t); App().save(['templates', 'meta']); location.hash = '#/templates/' + t.id; }
      if ((b = e.target.closest('[data-tprev]'))) { var tp = E.template(b.dataset.tprev); U.modal({ title: tp.name, wide: true, body: UI.frame(UI.emailHtml(tp.design, { profile: E.profile(U.pref('previewP') || 1), subject: tp.subject, preview: tp.preview }), {}) }); }
      if ((b = e.target.closest('[data-tuse]'))) { var tu = E.template(b.dataset.tuse), c = newCampaign({ tpl: tu.id, name: tu.name + ' campaign' }); U.toast('Draft campaign created from "' + tu.name + '".'); location.hash = '#/campaigns/' + c.id + '/edit/1'; }
      if ((b = e.target.closest('[data-tmenu]'))) {
        var tm = E.template(b.dataset.tmenu);
        U.menu(b, [{ label: 'Duplicate', act: 'dup', icon: I.copy }, { label: 'Delete', act: 'del', icon: I.trash, danger: true, disabled: tm.builtin }], function (a) {
          if (a === 'dup') { var n = U.clone(tm); n.id = E.nextId('template'); n.name = tm.name + ' (copy)'; n.builtin = false; n.design = M.reid(tm.design); n.created = n.updated = E.now(); db.templates.push(n); App().save(['templates', 'meta']); U.toast('Template duplicated.'); AM.App.render(true); }
          if (a === 'del') U.confirm({ title: 'Delete template "' + tm.name + '"?', text: 'Campaigns already using it keep their own copy.', ok: 'Delete', danger: true }).then(function (ok) { if (ok) { db.templates = db.templates.filter(function (x) { return x !== tm; }); App().save(['templates']); AM.App.render(true); } });
        }, 'Template actions');
      }
    });
  }, 'templates');
  AM.route(/^\/templates\/(\d+)$/, function (page, m) {
    var t = E.template(m[1]); if (!t) { page.innerHTML = '<div class="empty box">Template not found. <a href="#/templates">All templates</a></div>'; return; }
    App().title = t.name;
    var save = U.debounce(function () { t.updated = E.now(); App().save(['templates']); }, 300);
    page.innerHTML = UI.head({ crumb: { href: '#/templates', label: 'Templates' }, title: t.name, sub: esc(t.category) + (t.builtin ? ' · built-in template (your edits are kept until you reset the demo)' : '') }) +
      '<section class="card" style="margin-bottom:14px"><div class="card-b row3" style="padding-top:16px"><div class="field"><label for="tN">Name</label><input class="in" id="tN" value="' + esc(t.name) + '"></div><div class="field"><label for="tS">Default subject</label><input class="in" id="tS" value="' + esc(t.subject) + '"></div><div class="field"><label for="tP">Default preview text</label><input class="in" id="tP" value="' + esc(t.preview) + '"></div></div></section><div id="edHost"></div>';
    page.querySelector('#tN').addEventListener('input', function (e) { t.name = e.target.value; save(); });
    page.querySelector('#tS').addEventListener('input', function (e) { t.subject = e.target.value; save(); });
    page.querySelector('#tP').addEventListener('input', function (e) { t.preview = e.target.value; save(); });
    AM.Editor.mount(page.querySelector('#edHost'), { design: t.design, title: t.name, fileName: 'template-' + t.id, saveAsTemplate: false, subject: function () { return t.subject; }, preview: function () { return t.preview; }, onChange: save });
  }, 'templates');

  // ── Sign-up forms ─────────────────────────────────────────────────────
  var FIELDS = [['email', 'Email (required)'], ['first_name', 'First name'], ['last_name', 'Last name'], ['phone', 'Phone (for SMS)'], ['birthday', 'Birthday'], ['country', 'Country']];
  function formRate(f) {
    var base = f.type === 'popup' ? 0.032 : f.type === 'flyout' ? 0.021 : 0.009;
    if (f.rules.trigger === 'exit') base *= 1.2; if (f.rules.trigger === 'delay' && +f.rules.delay < 3) base *= 0.85; if (f.rules.trigger === 'scroll') base *= 0.95;
    base *= Math.pow(0.86, Math.max(0, f.fields.length - 2)); if (f.img) base *= 1.1; if (/%|popust|off|−|-\d/i.test(f.title)) base *= 1.25;
    return Math.min(0.12, base);
  }
  function formHtml(f, device) {
    var s = f.style, col = function (k, d) { return U.color(s[k], d); };
    var fields = f.fields.map(function (k) { var lab = { email: 'E-mail', first_name: 'Ime / First name', last_name: 'Priimek / Last name', phone: 'Telefon', birthday: 'Rojstni dan', country: 'Država' }[k]; return '<input aria-label="' + esc(lab) + '" placeholder="' + esc(lab) + '" style="width:100%;box-sizing:border-box;padding:12px 14px;margin:0 0 8px;border:1px solid #cfcfcf;border-radius:8px;font:15px Helvetica,Arial,sans-serif">'; }).join('');
    var card = '<div style="background:' + col('bg', '#FFFFFF') + ';color:' + col('text', '#1E2A2E') + ';border-radius:16px;overflow:hidden;box-shadow:0 30px 80px -20px rgba(0,0,0,.45);' + (f.type === 'embedded' ? 'box-shadow:none;border-radius:0' : '') + '">' +
      (f.img && f.type !== 'embedded' ? '<img alt="" src="' + M.art(f.img, 520, 200) + '" style="display:block;width:100%">' : '') +
      '<div style="padding:22px 24px 20px;font-family:Helvetica,Arial,sans-serif">' + (f.type !== 'embedded' ? '<div style="text-align:right;margin:-8px -8px 0 0;font-size:20px;opacity:.6">×</div>' : '') +
      '<div style="font-size:22px;font-weight:700;margin-bottom:6px">' + esc(f.title) + '</div><div style="font-size:14.5px;opacity:.85;margin-bottom:14px">' + esc(f.body) + '</div>' + fields +
      '<label style="display:flex;gap:8px;align-items:flex-start;font-size:12px;opacity:.85;margin:4px 0 12px"><input type="checkbox"> <span>' + esc(f.consent) + '</span></label>' +
      '<button type="button" style="width:100%;padding:13px;border:0;border-radius:999px;background:' + col('btn', '#0E5A63') + ';color:' + col('btnText', '#FFFFFF') + ';font:700 15px Helvetica,Arial,sans-serif">' + esc(f.button) + '</button></div></div>';
    var site = '<div style="background:#fff;font-family:Helvetica,Arial,sans-serif;min-height:100%"><div style="display:flex;justify-content:space-between;align-items:center;padding:14px 20px;border-bottom:1px solid #eee"><b style="font-family:Georgia,serif;font-size:20px;color:#0E5A63">Adrial</b><span style="font-size:12px;color:#888">moje-lece.si · demo page</span></div><div style="padding:20px;display:grid;grid-template-columns:repeat(' + (device === 'mobile' ? 2 : 4) + ',1fr);gap:14px">' + E.db().products.slice(0, device === 'mobile' ? 4 : 8).map(function (p) { return '<div><img alt="" src="' + M.productArt(p, 160) + '" style="width:100%;border-radius:10px"><div style="font-size:12px;margin-top:6px">' + esc(p.name) + '</div><div style="font-size:12px;color:#888">' + esc(U.money2(p.price)) + '</div></div>'; }).join('') + '</div>';
    var css = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'"><style>body{margin:0;background:#f4f4f4}</style>';
    if (f.type === 'embedded') return '<!doctype html><html><head><meta charset="utf-8">' + css + '</head><body>' + site + '<div style="background:' + col('bg', '#F3EFE8') + ';padding:20px;border-top:1px solid #eee"><div style="max-width:420px;margin:0 auto">' + card + '</div></div></div></body></html>';
    if (f.type === 'flyout') return '<!doctype html><html><head><meta charset="utf-8">' + css + '</head><body>' + site + '</div><div style="position:fixed;right:16px;bottom:16px;width:' + (device === 'mobile' ? 'calc(100% - 32px)' : '340px') + '">' + card + '</div></body></html>';
    return '<!doctype html><html><head><meta charset="utf-8">' + css + '</head><body>' + site + '</div><div style="position:fixed;inset:0;background:' + col('overlay', '#0B1E22') + ';opacity:.55"></div><div style="position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:' + (device === 'mobile' ? 'calc(100% - 28px)' : '420px') + '">' + card + '</div></body></html>';
  }
  function formStats(f, months) {
    var now = E.now(), v = 0, s = 0;
    for (var i = 0; i < months; i++) { var k = U.ym(U.addMonths(U.monthStart(now), -i)); v += f.st.views[k] || 0; s += f.st.subs[k] || 0; }
    return { views: v, subs: s, rate: v ? s / v : 0 };
  }
  AM.route(/^\/forms$/, function (page) {
    App().title = 'Sign-up forms';
    var db = E.db();
    page.innerHTML = UI.head({ title: 'Sign-up forms', dot: true, sub: 'Popups, flyouts and embedded forms that grow your lists. Views and submissions are simulated.', actions: '<button type="button" class="btn pri" id="fNew">' + ic(I.plus) + 'Create form</button>' }) +
      '<section class="card"><div class="tablewrap"><table class="tbl"><thead><tr><th>Form</th><th>Status</th><th class="hide-sm">Type</th><th class="hide-md">Adds to list</th><th class="r">Views (30 d)</th><th class="r">Submits (30 d)</th><th class="r">Conversion</th><th class="r hide-sm">Trend</th></tr></thead><tbody>' +
      db.forms.map(function (f) { var st = formStats(f, 1), l = E.list(f.list), series = []; for (var i = 11; i >= 0; i--) series.push(f.st.subs[U.ym(U.addMonths(U.monthStart(E.now()), -i))] || 0); return '<tr><td><a class="t1" href="#/forms/' + f.id + '">' + esc(f.name) + '</a><small>' + esc(f.title) + '</small></td><td>' + UI.status(f.status) + '</td><td class="hide-sm" style="text-transform:capitalize">' + esc(f.type) + '</td><td class="hide-md">' + esc(l ? l.name : '—') + '</td><td class="r num">' + U.n(st.views) + '</td><td class="r num">' + U.n(st.subs) + '</td><td class="r num">' + U.pct(st.rate, 2) + '</td><td class="r hide-sm">' + C.spark(series) + '</td></tr>'; }).join('') + '</tbody></table></div></section>';
    page.querySelector('#fNew').addEventListener('click', function () {
      var now = E.now(), f = { id: E.nextId('form'), name: 'New sign-up form', type: 'popup', status: 'draft', list: db.lists[0].id, title: 'Get 10% off your first order', body: 'Join our newsletter for offers and eye-care tips.', button: 'Subscribe', consent: 'I agree to receive marketing emails. Unsubscribe anytime.', success: 'Thanks! Check your inbox.', fields: ['email', 'first_name'], rules: { trigger: 'delay', delay: 6, scroll: 40, device: 'all', freq: 7, pages: 'all' }, style: { bg: '#FFFFFF', text: '#1E2A2E', btn: '#0E5A63', btnText: '#FFFFFF', overlay: '#0B1E22' }, img: 'frames', created: now, st: { views: {}, subs: {} } };
      db.forms.push(f); App().save(['forms', 'meta']); location.hash = '#/forms/' + f.id;
    });
  }, 'forms');

  AM.route(/^\/forms\/(\d+)$/, function (page, m) {
    var f = E.form(m[1]); if (!f) { page.innerHTML = '<div class="empty box">Form not found. <a href="#/forms">All forms</a></div>'; return; }
    App().title = f.name;
    var db = E.db(), st = AM.App.state, tab = st.formTab || 'content', dev = U.pref('formDev') || 'desktop';
    var save = U.debounce(function () { App().save(['forms']); }, 300);
    page.innerHTML = UI.head({ crumb: { href: '#/forms', label: 'Sign-up forms' }, title: f.name, sub: UI.status(f.status) + ' <span>Predicted conversion with these settings: <b id="fRate"></b></span>', actions: '<label class="sr" for="fStatus">Status</label><select class="select" id="fStatus"><option value="draft"' + (f.status === 'draft' ? ' selected' : '') + '>Draft</option><option value="live"' + (f.status === 'live' ? ' selected' : '') + '>Live</option></select><button type="button" class="btn danger-ghost" id="fDel">' + ic(I.trash) + 'Delete</button>' }) +
      '<div class="grid2 even"><div class="stack"><nav class="seg" aria-label="Form settings">' + [['content', 'Content'], ['style', 'Style'], ['behaviour', 'Behaviour'], ['stats', 'Results']].map(function (t) { return '<button type="button" data-ft="' + t[0] + '" aria-pressed="' + (tab === t[0]) + '">' + t[1] + '</button>'; }).join('') + '</nav><section class="card"><div class="card-b stack" style="gap:12px;padding-top:16px" id="fPanel"></div></section></div>' +
      '<section class="card"><div class="card-h"><h2>Live preview</h2><div class="seg" role="group" aria-label="Device"><button type="button" data-fd="desktop" aria-pressed="' + (dev === 'desktop') + '">Desktop</button><button type="button" data-fd="mobile" aria-pressed="' + (dev === 'mobile') + '">Mobile</button></div></div><div class="card-b" id="fPrev"></div></section></div>';
    var $ = function (s) { return page.querySelector(s); };
    var preview = function () { $('#fPrev').innerHTML = UI.frame(formHtml(f, dev), { mobile: dev === 'mobile', cls: 'form', title: 'Form preview' }); $('#fRate').textContent = U.pct(formRate(f), 1); };
    var inp = function (id, k, label, v, ta) { return '<div class="field"><label for="' + id + '">' + label + '</label>' + (ta ? '<textarea class="in" id="' + id + '" data-fk="' + k + '" rows="2" style="min-height:64px">' + esc(v) + '</textarea>' : '<input class="in" id="' + id + '" data-fk="' + k + '" value="' + esc(v) + '">') + '</div>'; };
    var panel = function () {
      var box = $('#fPanel'), h = '';
      if (tab === 'content') {
        h = inp('fName', 'name', 'Internal name', f.name) + inp('fTitle', 'title', 'Headline', f.title) + inp('fBody', 'body', 'Body text', f.body, 1) + '<div class="row2">' + inp('fBtn', 'button', 'Button text', f.button) + inp('fOk', 'success', 'Success message', f.success) + '</div>' +
          '<div class="field"><span class="lab">Fields</span>' + FIELDS.map(function (x) { return '<label class="check"><input type="checkbox" class="chk" data-ff="' + x[0] + '"' + (f.fields.indexOf(x[0]) >= 0 ? ' checked' : '') + (x[0] === 'email' ? ' disabled' : '') + '> ' + esc(x[1]) + '</label>'; }).join('') + '</div>' + inp('fCons', 'consent', 'Consent checkbox text', f.consent, 1) +
          '<div class="field"><label for="fImg">Image</label><select class="in" id="fImg" data-fk="img"><option value="">No image</option>' + M.ARTS.map(function (a) { return '<option value="' + a[0] + '"' + (f.img === a[0] ? ' selected' : '') + '>' + esc(a[1]) + '</option>'; }).join('') + '</select></div>';
      } else if (tab === 'style') {
        h = '<div class="field"><span class="lab">Form type</span><div class="radios">' + [['popup', 'Popup'], ['flyout', 'Flyout (corner)'], ['embedded', 'Embedded']].map(function (t) { return '<label><input type="radio" name="fType" value="' + t[0] + '"' + (f.type === t[0] ? ' checked' : '') + '> ' + t[1] + '</label>'; }).join('') + '</div></div>' +
          [['bg', 'Background'], ['text', 'Text'], ['btn', 'Button'], ['btnText', 'Button text'], ['overlay', 'Overlay (popup)']].map(function (c) { return '<label class="colorrow" for="fc_' + c[0] + '"><span>' + c[1] + '</span><input class="in" type="color" id="fc_' + c[0] + '" data-fc="' + c[0] + '" value="' + U.color(f.style[c[0]], '#FFFFFF') + '"></label>'; }).join('');
      } else if (tab === 'behaviour') {
        var r = f.rules;
        h = '<div class="field"><label for="fList">Add subscribers to list</label><select class="in" id="fList">' + db.lists.map(function (l) { return '<option value="' + l.id + '"' + (f.list === l.id ? ' selected' : '') + '>' + esc(l.name) + (l.optin === 'double' ? ' (double opt-in)' : '') + '</option>'; }).join('') + '</select></div>' +
          '<div class="field"><label for="fTrig">Show when</label><select class="in" id="fTrig" data-fr="trigger">' + [['delay', 'After a delay'], ['scroll', 'After scrolling'], ['exit', 'On exit intent (desktop)'], ['always', 'Always visible (embedded)']].map(function (t) { return '<option value="' + t[0] + '"' + (r.trigger === t[0] ? ' selected' : '') + '>' + t[1] + '</option>'; }).join('') + '</select></div>' +
          (r.trigger === 'delay' ? '<div class="field"><label for="fDelay">Delay: ' + r.delay + ' seconds</label><input type="range" id="fDelay" data-fr="delay" min="0" max="60" value="' + r.delay + '"></div>' : '') +
          (r.trigger === 'scroll' ? '<div class="field"><label for="fScroll">Scrolled: ' + r.scroll + '% of the page</label><input type="range" id="fScroll" data-fr="scroll" min="10" max="90" step="5" value="' + r.scroll + '"></div>' : '') +
          '<div class="row2"><div class="field"><label for="fDev">Devices</label><select class="in" id="fDev" data-fr="device">' + [['all', 'Desktop and mobile'], ['desktop', 'Desktop only'], ['mobile', 'Mobile only']].map(function (t) { return '<option value="' + t[0] + '"' + (r.device === t[0] ? ' selected' : '') + '>' + t[1] + '</option>'; }).join('') + '</select></div><div class="field"><label for="fFreq">After closing, hide for</label><select class="in" id="fFreq" data-fr="freq">' + [0, 1, 7, 14, 30].map(function (d) { return '<option value="' + d + '"' + (+r.freq === d ? ' selected' : '') + '>' + (d ? d + ' days' : 'show every visit') + '</option>'; }).join('') + '</select></div></div>' +
          '<div class="field"><label for="fPages">Show on pages</label><select class="in" id="fPages" data-fr="pages"><option value="all">All pages</option>' + E.CATEGORIES.map(function (cn) { return '<option' + (r.pages === cn ? ' selected' : '') + '>' + esc(cn) + '</option>'; }).join('') + '</select></div><label class="check"><input type="checkbox" class="chk" checked disabled> Never show to existing subscribers (always on)</label>';
      } else {
        var s30 = formStats(f, 1), s12 = formStats(f, 12);
        h = '<div class="tiles" style="padding:0"><div class="tile"><span class="label">Views 30 d</span><div class="v">' + U.n(s30.views) + '</div></div><div class="tile"><span class="label">Submits 30 d</span><div class="v">' + U.n(s30.subs) + '</div></div><div class="tile"><span class="label">Conversion 12 mo</span><div class="v">' + U.pct(s12.rate, 2) + '</div></div></div><div class="chart" id="fChart" style="padding:0"></div>' +
          '<div class="actions"><button type="button" class="btn pri" id="fSim">' + ic(I.play) + 'Simulate 200 visitors</button></div><p class="hint" style="margin:0">Each simulated submission creates a fictional profile (@example.*) and adds it to "' + esc((E.list(f.list) || {}).name || '—') + '" — live "Added to list" flows react.</p>' +
          '<div style="border-top:1px solid var(--hair);padding-top:12px" class="stack"><span class="label">Test submission</span><div class="row2"><div class="field"><label for="tsE">Email</label><input class="in" id="tsE" type="email" placeholder="test@example.si"></div><div class="field"><label for="tsF">First name</label><input class="in" id="tsF"></div></div><label class="check"><input type="checkbox" class="chk" id="tsC"> ' + esc(f.consent) + '</label><button type="button" class="btn" id="tsGo">Submit test (local only)</button></div>';
      }
      box.innerHTML = h;
      if (tab === 'stats') {
        var ms = []; for (var i = 11; i >= 0; i--) ms.push(U.ym(U.addMonths(U.monthStart(E.now()), -i)));
        C.bars(box.querySelector('#fChart'), { labels: ms.map(U.ymLabel), height: 180, aria: 'Form submissions per month', series: [{ name: 'Submissions', color: 'var(--accent)', values: ms.map(function (k) { return f.st.subs[k] || 0; }) }] });
      }
    };
    panel(); preview();
    $('#fStatus').addEventListener('change', function (e) { f.status = e.target.value; save(); U.toast('Form is now ' + f.status + '.'); });
    page.addEventListener('input', function (e) {
      var t = e.target;
      if (t.dataset.fk && t.tagName !== 'SELECT') { f[t.dataset.fk] = t.value; save(); preview(); }
      if (t.dataset.fc) { f.style[t.dataset.fc] = t.value; save(); preview(); }
      if (t.dataset.fr && t.type === 'range') { f.rules[t.dataset.fr] = +t.value; var lb = page.querySelector('label[for="' + t.id + '"]'); if (lb) lb.textContent = lb.textContent.replace(/\d+/, t.value); save(); $('#fRate').textContent = U.pct(formRate(f), 1); }
    });
    page.addEventListener('change', function (e) {
      var t = e.target;
      if (t.dataset.ff) { f.fields = FIELDS.map(function (x) { return x[0]; }).filter(function (k) { var c = page.querySelector('[data-ff="' + k + '"]'); return k === 'email' || (c && c.checked); }); save(); preview(); }
      if (t.dataset.fk && t.tagName === 'SELECT') { f[t.dataset.fk] = t.value; save(); preview(); }
      if (t.name === 'fType') { f.type = t.value; if (t.value === 'embedded') f.rules.trigger = 'always'; save(); preview(); }
      if (t.id === 'fList') { f.list = +t.value; save(); }
      if (t.dataset.fr && t.tagName === 'SELECT') { f.rules[t.dataset.fr] = /^\d+$/.test(t.value) ? +t.value : t.value; save(); panel(); preview(); }
    });
    page.addEventListener('click', function (e) {
      var b;
      if ((b = e.target.closest('[data-ft]'))) { st.formTab = tab = b.dataset.ft; U.$$('[data-ft]', page).forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); panel(); }
      if ((b = e.target.closest('[data-fd]'))) { dev = U.pref('formDev', b.dataset.fd); U.$$('[data-fd]', page).forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); preview(); }
      if (e.target.closest('#fDel')) U.confirm({ title: 'Delete form "' + f.name + '"?', text: 'Subscribers it collected stay in their lists.', ok: 'Delete', danger: true }).then(function (ok) { if (ok) { db.forms = db.forms.filter(function (x) { return x !== f; }); App().save(['forms']); location.hash = '#/forms'; } });
      if (e.target.closest('#fSim')) {
        if (f.status !== 'live') { U.toast('Set the form to Live first — draft forms are not shown to visitors.'); return; }
        var k = U.ym(E.now()), rate = formRate(f), n = 0, entered = 0, r = Math.random;
        f.st.views[k] = (f.st.views[k] || 0) + 200;
        for (var i = 0; i < 200; i++) if (r() < rate) n++;
        var l = E.list(f.list), si = !l || !/HR/.test(l.name);
        for (var j = 0; j < n; j++) {
          var F = si ? ['Ana', 'Nina', 'Luka', 'Rok', 'Maja', 'Tilen', 'Eva'] : ['Ivana', 'Marko', 'Lucija', 'Josip', 'Ema', 'Filip', 'Mia'], L = si ? ['Novak', 'Kos', 'Zupan', 'Golob', 'Turk'] : ['Horvat', 'Babić', 'Marić', 'Jurić', 'Tomić'];
          var first = U.pick(r, F), last = U.pick(r, L);
          var p = E.createProfile({ first: first, last: last, email: U.deaccent(first + '.' + last).toLowerCase() + Math.floor(r() * 9000 + 1000) + (si ? '@example.si' : '@example.hr'), country: si ? 'SI' : 'HR', lang: si ? 'sl' : 'hr', city: si ? 'Ljubljana' : 'Zagreb', source: f.type === 'embedded' ? 'Footer form' : 'Popup form', eng: 0.3 + r() * 0.6 });
          E.addEvent({ p: p.id, t: 'form', ts: E.now(), r: f.id }, { live: true });
          entered += (E.addToList(f.list, p.id, { live: true }) || []).filter(function (x) { return x.run; }).length;
        }
        f.st.subs[k] = (f.st.subs[k] || 0) + n;
        App().save(['forms', 'profiles', 'events', 'lists', 'runs', 'flows', 'meta']); panel();
        U.toast('200 simulated visitors → ' + n + ' sign-ups (' + U.pct(n / 200) + ')' + (entered ? ' · ' + entered + ' flow entries' : '') + '.');
      }
      if (e.target.closest('#tsGo')) {
        var em = $('#tsE').value.trim();
        if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(em)) { U.toast('Enter a valid email address.'); return; }
        if (!$('#tsC').checked) { U.toast('The consent checkbox must be ticked to subscribe.'); return; }
        var ex = db.profiles.filter(function (x) { return x.email.toLowerCase() === em.toLowerCase(); })[0];
        var pp = ex || E.createProfile({ first: $('#tsF').value.trim() || 'Test', last: 'Submission', email: em, source: 'Popup form' });
        if (ex) { ex.em = { s: 'subscribed', at: E.now() }; }
        E.addEvent({ p: pp.id, t: 'form', ts: E.now(), r: f.id }, { live: true });
        var res = E.addToList(f.list, pp.id, { live: true }) || [];
        var kk = U.ym(E.now()); f.st.subs[kk] = (f.st.subs[kk] || 0) + 1; f.st.views[kk] = (f.st.views[kk] || 0) + 1;
        App().save(['forms', 'profiles', 'events', 'lists', 'runs', 'flows', 'meta']);
        U.toast('"' + f.success + '" — ' + (ex ? 'existing' : 'new') + ' profile ' + (res.length ? 'added to the list' : 'already in the list') + (res.filter(function (x) { return x.run; }).length ? ', entered ' + res.filter(function (x) { return x.run; }).map(function (x) { return x.flow.name; }).join(', ') : '') + '. Nothing was sent.');
      }
    });
  }, 'forms');
})();
