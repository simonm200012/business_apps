/* Adrial Mail — Flows: list, visual builder (canvas with zoom, branches, drag & drop + button/keyboard
 * alternatives), trigger / filters / re-entry settings, per-step stats, flow email editor route. */
(function () {
  'use strict';
  var AM = window.AM, U = AM.U, E = AM.E, UI = AM.UI, M = AM.Email, C = AM.C, esc = U.esc, ic = U.ic, I = U.I, DAY = U.DAY;
  var App = function () { return AM.App; };
  var TONE = { email: 'violet', sms: 'clay', delay: 'grey', split: 'blue', tsplit: 'blue', update: 'teal', webhook: 'grey' };
  var DATE_PROPS = [['birthday', 'Birthday'], ['props.next_eye_exam', 'Next eye exam'], ['props.lens_refill_date', 'Lens refill date']];

  function stepSummary(s) {
    switch (s.type) {
      case 'email': return [s.name || 'Email', s.subject || 'No subject'];
      case 'sms': return [s.name || 'SMS', String(s.body || '').slice(0, 60) + (String(s.body || '').length > 60 ? '…' : '')];
      case 'delay': return ['Wait ' + U.dur(+s.amount || 0, s.unit || 'days'), ''];
      case 'split': return ['Conditional split', E.condText(s.cond)];
      case 'tsplit': return ['Trigger split', E.trigCondText(s.cond)];
      case 'update': return ['Update profile', 'Set ' + s.key + ' = ' + s.value];
      case 'webhook': return ['Webhook (disabled)', s.url || ''];
    }
    return [s.type, ''];
  }
  function normalize(list) {
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (s.yes) { if (i < list.length - 1) { s.yes = s.yes.concat(list.splice(i + 1)); } normalize(s.yes); normalize(s.no); break; }
    }
    return list;
  }
  function listAt(f, path) {
    if (!path) return f.steps;
    var a = path.split('|'), loc = E.findStep(f.steps, a[0]);
    return loc ? loc.step[a[1]] : null;
  }
  function contains(step, id) { var found = false; E.walk([step], function (x) { if (x.id === id) found = true; }); return found; }
  function cloneStep(s) { var c = U.clone(s); E.walk([c], function (x) { x.id = 's' + U.uid(); x.st = {}; if (x.design) x.design = M.reid(x.design); }); return c; }

  // ── Flows list ────────────────────────────────────────────────────────
  AM.route(/^\/flows$/, function (page) {
    App().title = 'Flows';
    var db = E.db(), now = E.now(), from = now - 30 * DAY, f1 = U.ymd(from);
    var rev30 = {}; E.attr().list.forEach(function (a) { if (a.ref && a.ref.charAt(0) === 'f' && a.ts >= from) { var k = a.ref.split(':')[1]; rev30[k] = (rev30[k] || 0) + a.v; } });
    page.innerHTML = UI.head({ title: 'Flows', dot: true, sub: 'Automated messages triggered by what people do. Live flows react to new events (try the <a href="#/simulator">Event simulator</a>); nothing is actually sent.', actions: '<button type="button" class="btn pri" id="fNew">' + ic(I.plus) + 'Create flow</button>' }) +
      '<section class="card"><div class="tablewrap"><table class="tbl"><thead><tr><th>Flow</th><th>Status</th><th class="r">Entered 30 d</th><th class="r hide-sm">Waiting now</th><th class="r hide-md">Open rate</th><th class="r hide-md">Click rate</th><th class="r">Revenue 30 d</th><th class="r hide-sm">All-time revenue</th><th><span class="sr">Actions</span></th></tr></thead><tbody>' +
      db.flows.map(function (f) {
        var s = E.flowStats(f), e30 = 0; Object.keys((f.st && f.st.d) || {}).forEach(function (d) { if (d >= f1) e30 += f.st.d[d]; });
        return '<tr><td><a class="t1" href="#/flows/' + f.id + '">' + esc(f.name) + '</a><small>' + ic(I.zap) + ' ' + esc(E.triggerText(f.trigger)) + '</small></td><td>' + UI.status(f.status) + '</td><td class="r num">' + U.n(e30) + '</td><td class="r num hide-sm">' + U.n(s.waiting) + '</td><td class="r num hide-md">' + U.pct(s.openRate) + '</td><td class="r num hide-md">' + U.pct(s.clickRate, 2) + '</td><td class="r num">' + U.money(rev30[f.id] || 0) + '</td><td class="r num hide-sm">' + U.money(s.revenue) + '</td><td class="r"><button type="button" class="btn xs icon ghost" data-fm="' + f.id + '" aria-label="Actions for ' + esc(f.name) + '" aria-haspopup="menu">' + ic(I.more) + '</button></td></tr>';
      }).join('') + '</tbody></table></div></section>';
    page.addEventListener('click', function (e) {
      var b;
      if (e.target.closest('#fNew')) createFlow();
      if ((b = e.target.closest('[data-fm]'))) flowMenu(b, E.flow(b.dataset.fm), true);
    });
  }, 'flows');

  function createFlow() {
    var db = E.db();
    var host = U.modal({ title: 'Create flow', body: '<div class="field"><label for="nfN">Flow name</label><input class="in" id="nfN" placeholder="e.g. Price-drop alert"></div>' +
      '<div class="field"><label for="nfT">Start from</label><select class="in" id="nfT"><optgroup label="New flow with trigger">' + E.TRIGGERS.map(function (t) { return '<option value="t:' + t[0] + '">' + esc(t[1]) + '</option>'; }).join('') + '</optgroup><optgroup label="Copy a prebuilt flow">' + db.flows.map(function (f) { return '<option value="f:' + f.id + '">' + esc(f.name) + '</option>'; }).join('') + '</optgroup></select></div><p class="hint" style="margin:0">New flows start as Draft — set them Live when ready.</p>',
      foot: '<button type="button" class="btn" data-close>Cancel</button><button type="button" class="btn pri" id="nfGo">Create</button>' });
    host.querySelector('#nfGo').addEventListener('click', function () {
      var v = host.querySelector('#nfT').value, name = host.querySelector('#nfN').value.trim(), now = E.now(), f;
      if (v.indexOf('f:') === 0) { var src = E.flow(v.slice(2)); f = U.clone(src); f.steps = f.steps.map(cloneStep); f.name = name || src.name + ' (copy)'; }
      else {
        var t = v.slice(2);
        f = { name: name || 'New flow', desc: '', filters: [], reentry: { mode: 'days', days: 30 }, steps: [E.newStep('delay'), E.newStep('email')] };
        f.trigger = t === 'list' ? { type: 'list', lists: [db.lists[0].id] } : t === 'date' ? { type: 'date', prop: 'birthday', offset: 0, annual: true } : { type: 'event', ev: t };
        if (t === 'checkout' || t === 'view' || t === 'cart' || t === 'price_drop' || t === 'bis') f.filters = [{ kind: 'event', ev: 'order', op: 'zero', n: 0, win: { type: 'since' } }];
      }
      f.id = E.nextId('flow'); f.status = 'draft'; f.created = f.updated = now; f.st = {};
      db.flows.push(f); App().save(['flows', 'meta']); U.close(host); location.hash = '#/flows/' + f.id;
    });
  }
  function flowMenu(anchor, f, list) {
    var db = E.db();
    U.menu(anchor, [{ label: 'Open builder', act: 'open' }, { sep: true }, { label: 'Set Live', act: 'live', disabled: f.status === 'live' }, { label: 'Set Manual (queue, don\'t send)', act: 'manual', disabled: f.status === 'manual' }, { label: 'Set Draft (stop)', act: 'draft', disabled: f.status === 'draft' }, { sep: true }, { label: 'Duplicate', act: 'dup', icon: I.copy }, { label: 'Delete', act: 'del', icon: I.trash, danger: true }], function (a) {
      if (a === 'open') location.hash = '#/flows/' + f.id;
      if (a === 'live' || a === 'manual' || a === 'draft') { setStatus(f, a); if (list) App().render(true); }
      if (a === 'dup') { var n = U.clone(f); n.id = E.nextId('flow'); n.name = f.name + ' (copy)'; n.status = 'draft'; n.steps = f.steps.map(cloneStep); n.st = {}; n.created = n.updated = E.now(); db.flows.push(n); App().save(['flows', 'meta']); U.toast('Flow duplicated as draft.'); location.hash = '#/flows/' + n.id; }
      if (a === 'del') U.confirm({ title: 'Delete flow "' + f.name + '"?', text: 'Profiles waiting in it leave the flow. Opens and clicks stay on their profiles.', ok: 'Delete flow', danger: true }).then(function (ok) { if (!ok) return; db.flows = db.flows.filter(function (x) { return x !== f; }); db.runs = db.runs.filter(function (r) { return r.f !== f.id; }); E.touch(); App().save(['flows', 'runs']); U.toast('Flow deleted.'); location.hash = '#/flows'; App().render(); });
    }, 'Flow actions');
  }
  function setStatus(f, s) {
    f.status = s; f.updated = E.now();
    if (s === 'draft') { var n = 0; E.db().runs.forEach(function (r) { if (r.f === f.id && !r.done) { r.done = 'stopped'; n++; } }); E.db().runs = E.db().runs.filter(function (r) { return !r.done; }); if (n) U.toast(U.plural(n, 'waiting profile') + ' removed from the flow.'); }
    App().save(['flows', 'runs']); U.toast('"' + f.name + '" is now ' + s + '.');
  }

  // ── Builder ───────────────────────────────────────────────────────────
  AM.route(/^\/flows\/(\d+)$/, function (page, m) {
    var f = E.flow(m[1]); if (!f) { page.innerHTML = '<div class="empty box">Flow not found. <a href="#/flows">All flows</a></div>'; return; }
    App().title = f.name;
    var db = E.db(), st = AM.App.state;
    if (st.flowSel && st.flowSel.f !== f.id) st.flowSel = null;
    var sel = st.flowSel ? st.flowSel.id : 'trigger';
    var zoom = U.pref('flowZoom') || 1;
    var save = U.debounce(function () { f.updated = E.now(); App().save(['flows']); }, 250);
    var waitAt = {}; db.runs.forEach(function (r) { if (r.f === f.id && !r.done && r.sid) waitAt[r.sid] = (waitAt[r.sid] || 0) + 1; });
    var fs = E.flowStats(f);
    page.innerHTML = UI.head({ crumb: { href: '#/flows', label: 'Flows' }, title: f.name, sub: UI.status(f.status) + '<span>' + U.n(fs.entered) + ' entered · ' + U.n(fs.waiting) + ' waiting · ' + U.money(fs.revenue) + ' attributed</span><span>Autosaved</span>',
      actions: '<label class="sr" for="flSt">Flow status</label><select class="select" id="flSt"><option value="draft"' + (f.status === 'draft' ? ' selected' : '') + '>Draft</option><option value="manual"' + (f.status === 'manual' ? ' selected' : '') + '>Manual</option><option value="live"' + (f.status === 'live' ? ' selected' : '') + '>Live</option></select><button type="button" class="btn" id="flMore" aria-haspopup="menu">' + ic(I.more) + 'More</button>' }) +
      '<div class="fb"><div class="fb-canvas" id="fbc" aria-label="Flow canvas"><div class="fb-zoom" role="group" aria-label="Zoom"><button type="button" class="btn xs icon ghost" data-zoom="-1" aria-label="Zoom out">' + ic(I.zoomout) + '</button><span id="zv">' + Math.round(zoom * 100) + '%</span><button type="button" class="btn xs icon ghost" data-zoom="1" aria-label="Zoom in">' + ic(I.zoomin) + '</button><button type="button" class="btn xs ghost" data-zoom="0">Reset</button></div><div class="fb-inner" id="fbi"></div></div><aside class="fb-side" id="fbs" aria-label="Step settings"></aside></div>';
    var $ = function (s) { return page.querySelector(s); };

    function nodeStats(s) {
      var x = E.stepStats(f, s), w = waitAt[s.id] ? '<span>⏳ <b>' + U.n(waitAt[s.id]) + '</b> waiting</span>' : '';
      if (s.type === 'email') return '<span>Sent <b>' + U.n(x.sent) + '</b></span><span>Open <b>' + U.pct(x.openRate, 0) + '</b></span><span>Click <b>' + U.pct(x.clickRate, 1) + '</b></span><span><b>' + U.money(x.revenue) + '</b></span>' + w;
      if (s.type === 'sms') return '<span>Sent <b>' + U.n(x.sent) + '</b></span><span>Click <b>' + U.pct(x.clickRate, 1) + '</b></span><span><b>' + U.money(x.revenue) + '</b></span>' + w;
      if (s.type === 'split' || s.type === 'tsplit') return '<span>Yes <b>' + U.n(x.yes) + '</b></span><span>No <b>' + U.n(x.no) + '</b></span>' + w;
      return '<span>Entered <b>' + U.n(x.entered) + '</b></span>' + w;
    }
    function node(s, path, i, n) {
      var sm = stepSummary(s);
      return '<div class="fconn"></div><div class="fnode tone-' + TONE[s.type] + (sel === s.id ? ' sel' : '') + '" data-sid="' + esc(s.id) + '" tabindex="0" draggable="true" role="group" aria-label="' + esc(E.STEPS[s.type].label + ': ' + sm[0]) + '. Press Enter to edit.">' +
        '<div class="fh"><span class="ico">' + ic(E.STEPS[s.type].icon) + '</span>' + esc(E.STEPS[s.type].label) + '</div><div class="ft">' + esc(sm[0]) + '</div>' + (sm[1] ? '<div class="fs">' + esc(sm[1]) + '</div>' : '') + '<div class="fstats">' + nodeStats(s) + '</div>' +
        '<div class="ftools"><button type="button" class="btn xs icon ghost" data-st="up" aria-label="Move up"' + (i === 0 ? ' disabled' : '') + '>' + ic(I.up) + '</button><button type="button" class="btn xs icon ghost" data-st="down" aria-label="Move down"' + (i === n - 1 ? ' disabled' : '') + '>' + ic(I.down) + '</button><button type="button" class="btn xs icon ghost" data-st="dup" aria-label="Duplicate step">' + ic(I.copy) + '</button><button type="button" class="btn xs icon ghost" data-st="del" aria-label="Delete step">' + ic(I.trash) + '</button></div></div>';
    }
    function slot(path, i) { return '<div class="fadd" data-slot="' + esc(path) + '#' + i + '"><div class="fconn"></div><button type="button" class="btn" data-addat="' + esc(path) + '#' + i + '" aria-label="Add a step here" aria-haspopup="menu">' + ic(I.plus) + '</button></div>'; }
    function list(steps, path) {
      var h = '<div class="fl">' + slot(path, 0);
      steps.forEach(function (s, i) {
        h += node(s, path, i, steps.length);
        if (s.yes) h += '<div class="fconn"></div><div class="fbranch"><div class="fl"><span class="fblab yes">Yes</span>' + list(s.yes, s.id + '|yes') + '</div><div class="fl"><span class="fblab no">No</span>' + list(s.no, s.id + '|no') + '</div></div>';
        else h += slot(path, i + 1);
      });
      if (!steps.length || !steps[steps.length - 1].yes) h += '<div class="fconn"></div><div class="fnode exit">Exit</div>';
      return h + '</div>';
    }
    function drawCanvas() {
      var t = f.trigger || {};
      $('#fbi').style.zoom = zoom;
      $('#fbi').innerHTML = '<div class="fl"><div class="fnode trigger' + (sel === 'trigger' ? ' sel' : '') + '" data-sid="trigger" tabindex="0" role="group" aria-label="Trigger: ' + esc(E.triggerText(t)) + '. Press Enter to edit."><div class="fh"><span class="ico tone-violet">' + ic(I.zap) + '</span>Trigger</div><div class="ft">' + esc(E.triggerText(t)) + '</div>' +
        ((f.filters || []).length ? '<div class="fs">' + ic(I.filter) + ' ' + esc(f.filters.map(E.condText).join(' AND ')) + '</div>' : '') + '<div class="fstats"><span>Entered <b>' + U.n(fs.entered) + '</b></span><span>Re-entry <b>' + esc(reText(f.reentry)) + '</b></span></div></div>' + list(f.steps, '') + '</div>';
    }
    function reText(r) { r = r || { mode: 'once' }; return r.mode === 'once' ? 'once' : r.mode === 'always' ? 'always' : 'every ' + r.days + ' d'; }

    // ── Side panel ──────────────────────────────────────────────────
    function palette() { return '<div class="field"><span class="lab">Add steps — drag onto a + on the canvas, or use the + buttons</span><div class="fpal">' + Object.keys(E.STEPS).map(function (k) { return '<button type="button" draggable="true" data-pal="' + k + '" title="Drag onto a + connector">' + ic(E.STEPS[k].icon) + esc(E.STEPS[k].label) + '</button>'; }).join('') + '</div></div>'; }
    function drawSide() {
      var box = $('#fbs'), h;
      if (sel === 'trigger' || !E.findStep(f.steps, sel)) {
        sel = 'trigger';
        var t = f.trigger || (f.trigger = { type: 'event', ev: 'order' }), tkey = t.type === 'event' ? t.ev : t.type;
        h = '<div class="ph"><span class="label">Flow settings</span><h3 style="margin:2px 0 0;font-size:17px">Trigger &amp; filters</h3></div><div class="pb">' +
          '<div class="field"><label for="trT">Trigger</label><select class="in" id="trT">' + E.TRIGGERS.map(function (x) { return '<option value="' + x[0] + '"' + (x[0] === tkey ? ' selected' : '') + '>' + esc(x[1]) + '</option>'; }).join('') + '</select></div>';
        if (t.type === 'list') h += '<div class="field"><span class="lab">When added to any of these lists</span>' + db.lists.map(function (l) { return '<label class="check"><input type="checkbox" class="chk" data-trl="' + l.id + '"' + ((t.lists || []).indexOf(l.id) >= 0 ? ' checked' : '') + '> ' + esc(l.name) + '</label>'; }).join('') + '</div>';
        else if (t.type === 'date') h += '<div class="field"><label for="trP">Date property</label><select class="in" id="trP">' + DATE_PROPS.map(function (x) { return '<option value="' + x[0] + '"' + (t.prop === x[0] ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select></div><div class="row2"><div class="field"><label for="trO">Offset (days, negative = before)</label><input class="in" type="number" id="trO" value="' + (+t.offset || 0) + '" min="-60" max="60"></div><label class="check" style="margin-top:24px"><input type="checkbox" class="chk" id="trA"' + (t.annual ? ' checked' : '') + '> Repeat every year</label></div><p class="hint" style="margin:0">Checked daily at 09:00 on the demo clock.</p>';
        else if (t.ev === 'form') h += '<div class="field"><label for="trF">Form</label><select class="in" id="trF"><option value="">Any form</option>' + db.forms.map(function (x) { return '<option value="' + x.id + '"' + (+t.form === x.id ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') + '</select></div>';
        else {
          var w = t.where || {};
          h += '<div class="field"><label for="trW">Trigger filter</label><select class="in" id="trW"><option value="">No filter</option><option value="category"' + (w.field === 'category' ? ' selected' : '') + '>Product category is…</option>' + (t.ev === 'order' || t.ev === 'checkout' || t.ev === 'cart' ? '<option value="value"' + (w.field === 'value' ? ' selected' : '') + '>Value at least…</option>' : '') + '</select></div>' +
            (w.field === 'category' ? '<div class="field"><label for="trWV">Category</label><select class="in" id="trWV">' + E.CATEGORIES.map(function (c) { return '<option' + (w.value === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select></div>' : '') +
            (w.field === 'value' ? '<div class="field"><label for="trWV">Minimum value (€)</label><input class="in" type="number" id="trWV" min="0" value="' + esc(w.value) + '"></div>' : '');
        }
        h += '<div class="field"><span class="lab">Flow filters — checked before every step</span><div id="flF" class="stack" style="gap:8px">' + (f.filters || []).map(function (c, i) { return UI.condRow(c, 'f' + i, { since: true }); }).join('') + '</div><div class="actions"><button type="button" class="btn sm" id="flFAdd">' + ic(I.plus) + 'Add filter</button><button type="button" class="btn sm ghost" id="flFNo">+ Has not placed order since starting</button></div></div>' +
          '<div class="field"><label for="reM">Re-entry</label><div class="row2"><select class="in" id="reM"><option value="once"' + (f.reentry.mode === 'once' ? ' selected' : '') + '>Only once per profile</option><option value="days"' + (f.reentry.mode === 'days' ? ' selected' : '') + '>Again after N days</option><option value="always"' + (f.reentry.mode === 'always' ? ' selected' : '') + '>Every time</option></select>' + (f.reentry.mode === 'days' ? '<input class="in" type="number" id="reD" min="1" value="' + (+f.reentry.days || 30) + '" aria-label="Days before re-entry">' : '<span></span>') + '</div></div>' +
          '<div class="field"><label for="flDesc">Description</label><textarea class="in" id="flDesc" rows="2" style="min-height:60px">' + esc(f.desc || '') + '</textarea></div>' +
          palette() + '<div class="tiles" style="padding:0"><div class="tile"><span class="label">Entered</span><div class="v">' + U.n(fs.entered) + '</div></div><div class="tile"><span class="label">Completed</span><div class="v">' + U.n(fs.completed) + '</div></div><div class="tile"><span class="label">Left (filter)</span><div class="v">' + U.n(fs.exited) + '</div></div><div class="tile"><span class="label">Revenue</span><div class="v">' + U.money(fs.revenue) + '</div></div></div>' +
          '<p class="hint" style="margin:0"><b style="font-weight:500">Live</b> sends (simulated) · <b style="font-weight:500">Manual</b> queues messages without sending · <b style="font-weight:500">Draft</b> stops the flow.</p></div>';
        box.innerHTML = h;
        UI.wireConds(box.querySelector('#flF'), function (k) { return f.filters[+k.slice(1)]; }, function () { save(); drawCanvas(); }, { since: true });
        return;
      }
      var loc = E.findStep(f.steps, sel), s = loc.step, x = E.stepStats(f, s);
      h = '<div class="ph"><span class="label">' + esc(E.STEPS[s.type].label) + '</span><h3 style="margin:2px 0 0;font-size:17px">' + esc(stepSummary(s)[0]) + '</h3></div><div class="pb">';
      if (s.type === 'email') {
        h += '<div class="field"><label for="seN">Step name</label><input class="in" id="seN" data-sp="name" value="' + esc(s.name) + '"></div><div class="field"><label for="seS">Subject</label><input class="in" id="seS" data-sp="subject" value="' + esc(s.subject) + '"></div><div class="field"><label for="seP">Preview text</label><input class="in" id="seP" data-sp="preview" value="' + esc(s.preview || '') + '"></div>' +
          '<div class="actions"><a class="btn pri" href="#/flows/' + f.id + '/email/' + esc(s.id) + '">' + ic(I.edit) + 'Edit email content</a><label class="sr" for="seT">Replace with template</label><select class="select" id="seT"><option value="">Replace with template…</option>' + db.templates.map(function (t) { return '<option value="' + t.id + '">' + esc(t.name) + '</option>'; }).join('') + '</select></div>' +
          '<div class="tiles" style="padding:0"><div class="tile"><span class="label">Sent</span><div class="v">' + U.n(x.sent) + '</div><small>' + U.n(x.skipped) + ' skipped</small></div><div class="tile"><span class="label">Open rate</span><div class="v">' + U.pct(x.openRate) + '</div></div><div class="tile"><span class="label">Click rate</span><div class="v">' + U.pct(x.clickRate, 2) + '</div></div><div class="tile"><span class="label">Converted</span><div class="v">' + U.n(x.orders) + '</div><small>' + U.money(x.revenue) + '</small></div></div>' +
          UI.frame(UI.emailHtml(s.design, { profile: E.profile(U.pref('previewP') || 1), subject: s.subject, preview: s.preview }), { title: 'Email preview', cls: 'small' });
      } else if (s.type === 'sms') {
        var info = U.smsInfo(s.body);
        h += '<div class="field"><label for="seN">Step name</label><input class="in" id="seN" data-sp="name" value="' + esc(s.name) + '"></div><div class="field"><label for="seB">Message</label><textarea class="in" id="seB" data-sp="body" rows="4">' + esc(s.body) + '</textarea><span class="counter" id="seC">' + info.chars + ' chars · ' + esc(info.encoding) + ' · ' + info.segments + ' segment(s)</span></div><p class="hint" style="margin:0">Only profiles with SMS consent and a phone number receive it (simulated).</p>' +
          '<div class="tiles" style="padding:0"><div class="tile"><span class="label">Sent</span><div class="v">' + U.n(x.sent) + '</div><small>' + U.n(x.skipped) + ' skipped</small></div><div class="tile"><span class="label">Click rate</span><div class="v">' + U.pct(x.clickRate, 1) + '</div></div><div class="tile"><span class="label">Revenue</span><div class="v">' + U.money(x.revenue) + '</div></div></div>';
      } else if (s.type === 'delay') {
        h += '<div class="row2"><div class="field"><label for="seA">Wait</label><input class="in" type="number" min="0" id="seA" data-sp="amount" value="' + (+s.amount || 0) + '"></div><div class="field"><label for="seU">Unit</label><select class="in" id="seU" data-sp="unit">' + ['minutes', 'hours', 'days', 'weeks'].map(function (u) { return '<option' + (s.unit === u ? ' selected' : '') + '>' + u + '</option>'; }).join('') + '</select></div></div><p class="hint" style="margin:0">' + U.n(waitAt[(loc.list[loc.i + 1] || {}).id] || 0) + ' profiles are waiting after this delay right now. Fast-forward in the Event simulator.</p>';
      } else if (s.type === 'split') {
        h += '<div class="field"><span class="lab">Profiles go down YES if</span><div id="seCond">' + UI.condRow(s.cond, 'c', { since: true, removable: false }) + '</div></div><div class="tiles" style="padding:0"><div class="tile"><span class="label">Yes</span><div class="v">' + U.n(x.yes) + '</div></div><div class="tile"><span class="label">No</span><div class="v">' + U.n(x.no) + '</div></div></div><p class="hint" style="margin:0">Steps placed after a split are moved into its YES branch — paths never merge.</p>';
      } else if (s.type === 'tsplit') {
        var c = s.cond;
        h += '<p class="hint" style="margin:0">Splits on the event that triggered the flow.</p><div class="row3"><div class="field"><label for="tsF">Field</label><select class="in" id="tsF"><option value="value"' + (c.field === 'value' ? ' selected' : '') + '>Value (€)</option><option value="category"' + (c.field === 'category' ? ' selected' : '') + '>Category</option></select></div><div class="field"><label for="tsO">Operator</label><select class="in" id="tsO">' + (c.field === 'value' ? [['gt', '>'], ['lt', '<'], ['eq', '=']] : [['eq', 'is'], ['neq', 'is not']]).map(function (o) { return '<option value="' + o[0] + '"' + (c.op === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div><div class="field"><label for="tsV">Value</label>' + (c.field === 'value' ? '<input class="in" type="number" id="tsV" value="' + esc(c.value) + '">' : '<select class="in" id="tsV">' + E.CATEGORIES.map(function (k) { return '<option' + (c.value === k ? ' selected' : '') + '>' + esc(k) + '</option>'; }).join('') + '</select>') + '</div></div><div class="tiles" style="padding:0"><div class="tile"><span class="label">Yes</span><div class="v">' + U.n(x.yes) + '</div></div><div class="tile"><span class="label">No</span><div class="v">' + U.n(x.no) + '</div></div></div>';
      } else if (s.type === 'update') {
        h += '<div class="row2"><div class="field"><label for="seK">Property</label><input class="in" id="seK" data-sp="key" value="' + esc(s.key) + '"></div><div class="field"><label for="seV">Value</label><input class="in" id="seV" data-sp="value" value="' + esc(s.value) + '"></div></div><p class="hint" style="margin:0">Updated ' + U.n(x.entered) + ' times. Usable in segments as a custom property.</p>';
      } else {
        h += '<div class="banner warn">' + ic(I.hook) + '<span>Webhooks are disabled in this demo — no request is ever made. The step is recorded as skipped.</span></div><div class="field"><label for="seW">URL</label><input class="in" id="seW" data-sp="url" value="' + esc(s.url) + '"></div>';
      }
      h += '<div class="actions" style="border-top:1px solid var(--hair);padding-top:12px"><button type="button" class="btn sm" data-st="up" data-for="' + esc(s.id) + '">' + ic(I.up) + 'Up</button><button type="button" class="btn sm" data-st="down" data-for="' + esc(s.id) + '">' + ic(I.down) + 'Down</button><button type="button" class="btn sm" data-st="dup" data-for="' + esc(s.id) + '">' + ic(I.copy) + 'Duplicate</button><button type="button" class="btn sm danger-ghost" data-st="del" data-for="' + esc(s.id) + '">' + ic(I.trash) + 'Delete</button><button type="button" class="btn sm ghost" id="toTrig">Flow settings</button></div>' + palette() + '</div>';
      box.innerHTML = h;
      if (s.type === 'split') UI.wireConds(box.querySelector('#seCond'), function () { return s.cond; }, function () { save(); refreshNode(s); }, { since: true, removable: false });
    }
    function refreshNode(s) { var el = page.querySelector('.fnode[data-sid="' + s.id + '"]'); if (!el) return; var sm = stepSummary(s); el.querySelector('.ft').textContent = sm[0]; var fsd = el.querySelector('.fs'); if (fsd) fsd.textContent = sm[1]; }
    function select(id, focus) {
      sel = id; st.flowSel = { f: f.id, id: id };
      U.$$('.fnode[data-sid]', page).forEach(function (n) { n.classList.toggle('sel', n.dataset.sid === id); });
      drawSide();
      if (focus) { var el = page.querySelector('.fnode[data-sid="' + id + '"]'); if (el) el.focus(); }
      if (window.innerWidth < 1100) $('#fbs').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    function redraw(focusId) { normalize(f.steps); save(); drawCanvas(); drawSide(); if (focusId) { var el = page.querySelector('.fnode[data-sid="' + focusId + '"]'); if (el) { el.focus({ preventScroll: true }); el.scrollIntoView({ block: 'nearest', inline: 'center' }); } } }
    function insertAt(slotKey, step) {
      var a = slotKey.split('#'), lst = listAt(f, a[0]); if (!lst) return;
      lst.splice(+a[1], 0, step); sel = step.id; st.flowSel = { f: f.id, id: step.id };
      redraw(step.id); U.toast(E.STEPS[step.type].label + ' added' + (step.yes && lst.indexOf(step) < lst.length - 1 ? ' — following steps moved into its YES branch' : '') + '.');
    }
    function moveTo(id, slotKey) {
      var loc = E.findStep(f.steps, id); if (!loc) return;
      var a = slotKey.split('#'), target = listAt(f, a[0]); if (!target) return;
      if (a[0] && contains(loc.step, a[0].split('|')[0])) { U.toast('A split cannot be moved into its own branch.'); return; }
      var idx = +a[1];
      if (target === loc.list && loc.i < idx) idx--;
      loc.list.splice(loc.i, 1); target.splice(idx, 0, loc.step); redraw(id);
    }
    function stepAct(act, id) {
      var loc = E.findStep(f.steps, id); if (!loc) return;
      if (act === 'up' && loc.i > 0) { loc.list.splice(loc.i, 1); loc.list.splice(loc.i - 1, 0, loc.step); redraw(id); }
      else if (act === 'down' && loc.i < loc.list.length - 1) { loc.list.splice(loc.i, 1); loc.list.splice(loc.i + 1, 0, loc.step); redraw(id); }
      else if (act === 'dup') { var c = cloneStep(loc.step); loc.list.splice(loc.i + 1, 0, c); sel = c.id; st.flowSel = { f: f.id, id: c.id }; redraw(c.id); }
      else if (act === 'del') {
        var has = loc.step.yes && (loc.step.yes.length || loc.step.no.length);
        var go = function () { loc.list.splice(loc.i, 1); var nxt = loc.list[loc.i] || loc.list[loc.i - 1]; sel = nxt ? nxt.id : 'trigger'; st.flowSel = { f: f.id, id: sel }; redraw(nxt ? nxt.id : null); U.toast('Step deleted. Profiles waiting for it leave the flow when it is their turn.'); };
        if (has) U.confirm({ title: 'Delete this split and both branches?', text: 'All steps in its YES and NO paths are removed too.', ok: 'Delete', danger: true }).then(function (ok) { if (ok) go(); }); else go();
      }
    }
    drawCanvas(); drawSide();
    (function center() { var cv = $('#fbc'); cv.scrollLeft = Math.max(0, (cv.scrollWidth - cv.clientWidth) / 2); })();

    // ── Events ──────────────────────────────────────────────────────
    $('#flSt').addEventListener('change', function (e) { setStatus(f, e.target.value); App().render(true); });
    $('#flMore').addEventListener('click', function (e) { flowMenu(e.currentTarget, f); });
    page.addEventListener('click', function (e) {
      var b;
      if ((b = e.target.closest('[data-zoom]'))) { var d = +b.dataset.zoom; zoom = d === 0 ? 1 : U.clamp(Math.round((zoom + d * 0.1) * 10) / 10, 0.4, 1.4); U.pref('flowZoom', zoom); $('#fbi').style.zoom = zoom; $('#zv').textContent = Math.round(zoom * 100) + '%'; var cv = $('#fbc'); cv.scrollLeft = Math.max(0, (cv.scrollWidth - cv.clientWidth) / 2); return; }
      if ((b = e.target.closest('[data-st]'))) { var n = b.closest('.fnode'); stepAct(b.dataset.st, b.dataset.for || (n && n.dataset.sid)); return; }
      if ((b = e.target.closest('[data-addat]'))) { var key = b.dataset.addat; U.menu(b, Object.keys(E.STEPS).map(function (k) { return { label: E.STEPS[k].label, act: k, icon: E.STEPS[k].icon }; }), function (k) { insertAt(key, E.newStep(k)); }, 'Add step'); return; }
      if ((b = e.target.closest('[data-pal]'))) { U.toast('Drag "' + E.STEPS[b.dataset.pal].label + '" onto a + on the canvas, or press a + button.'); return; }
      if (e.target.closest('#toTrig')) { select('trigger'); return; }
      if (e.target.closest('#flFAdd')) { f.filters = f.filters || []; f.filters.push(UI.condDefault('event')); save(); drawSide(); drawCanvas(); return; }
      if (e.target.closest('#flFNo')) { f.filters = f.filters || []; f.filters.push({ kind: 'event', ev: 'order', op: 'zero', n: 0, win: { type: 'since' } }); save(); drawSide(); drawCanvas(); return; }
      if ((b = e.target.closest('[data-cond-rm]')) && b.dataset.condRm.charAt(0) === 'f') { f.filters.splice(+b.dataset.condRm.slice(1), 1); save(); drawSide(); drawCanvas(); return; }
      if ((b = e.target.closest('.fnode[data-sid]'))) select(b.dataset.sid);
    });
    page.addEventListener('keydown', function (e) {
      var n = e.target.closest && e.target.closest('.fnode[data-sid]'); if (!n || e.target !== n) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(n.dataset.sid); var first = $('#fbs').querySelector('input,select,textarea'); if (first) first.focus(); }
      if (n.dataset.sid !== 'trigger' && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); stepAct(e.key === 'ArrowUp' ? 'up' : 'down', n.dataset.sid); }
      if (n.dataset.sid !== 'trigger' && e.key === 'Delete') { e.preventDefault(); stepAct('del', n.dataset.sid); }
    });
    page.addEventListener('input', function (e) {
      var t = e.target, loc = sel !== 'trigger' ? E.findStep(f.steps, sel) : null;
      if (t.id === 'flDesc') { f.desc = t.value; save(); return; }
      if (t.id === 'reD') { f.reentry.days = +t.value || 1; save(); return; }
      if (t.id === 'trO') { f.trigger.offset = +t.value || 0; save(); drawCanvas(); return; }
      if (t.id === 'trWV' && t.type === 'number') { f.trigger.where.value = +t.value; save(); drawCanvas(); return; }
      if (loc && t.dataset.sp && t.tagName !== 'SELECT') {
        loc.step[t.dataset.sp] = t.type === 'number' ? +t.value : t.value; save(); refreshNode(loc.step);
        if (t.dataset.sp === 'body') { var info = U.smsInfo(t.value); $('#seC').textContent = info.chars + ' chars · ' + info.encoding + ' · ' + info.segments + ' segment(s)'; }
      }
      if (loc && t.id === 'tsV' && t.type === 'number') { loc.step.cond.value = +t.value; save(); refreshNode(loc.step); }
    });
    page.addEventListener('change', function (e) {
      var t = e.target, tr = f.trigger, loc = sel !== 'trigger' ? E.findStep(f.steps, sel) : null;
      if (t.id === 'trT') { var v = t.value; f.trigger = v === 'list' ? { type: 'list', lists: [db.lists[0].id] } : v === 'date' ? { type: 'date', prop: 'birthday', offset: 0, annual: true } : { type: 'event', ev: v }; save(); drawCanvas(); drawSide(); }
      if (t.dataset.trl) { var id = +t.dataset.trl; tr.lists = (tr.lists || []).filter(function (x) { return x !== id; }); if (t.checked) tr.lists.push(id); save(); drawCanvas(); }
      if (t.id === 'trP') { tr.prop = t.value; tr.annual = t.value === 'birthday'; save(); drawCanvas(); drawSide(); }
      if (t.id === 'trA') { tr.annual = t.checked; save(); drawCanvas(); }
      if (t.id === 'trF') { tr.form = t.value ? +t.value : null; save(); drawCanvas(); }
      if (t.id === 'trW') { tr.where = t.value ? { field: t.value, value: t.value === 'category' ? E.CATEGORIES[0] : 100, op: 'gte' } : null; save(); drawCanvas(); drawSide(); }
      if (t.id === 'trWV' && t.tagName === 'SELECT') { tr.where.value = t.value; save(); drawCanvas(); }
      if (t.id === 'reM') { f.reentry = { mode: t.value, days: f.reentry.days || 30 }; save(); drawCanvas(); drawSide(); }
      if (loc && t.dataset.sp && t.tagName === 'SELECT') { loc.step[t.dataset.sp] = t.value; save(); refreshNode(loc.step); }
      if (loc && t.id === 'seT' && t.value) { var tp = E.template(t.value); U.confirm({ title: 'Replace this email with "' + tp.name + '"?', text: 'Its content and subject are replaced. Stats stay with the step.', ok: 'Replace' }).then(function (ok) { if (ok) { loc.step.design = M.reid(tp.design); loc.step.subject = tp.subject; loc.step.preview = tp.preview; save(); drawCanvas(); drawSide(); } else t.value = ''; }); }
      if (loc && t.id === 'tsF') { loc.step.cond = t.value === 'value' ? { field: 'value', op: 'gt', value: 100 } : { field: 'category', op: 'eq', value: E.CATEGORIES[0] }; save(); refreshNode(loc.step); drawSide(); }
      if (loc && t.id === 'tsO') { loc.step.cond.op = t.value; save(); refreshNode(loc.step); }
      if (loc && t.id === 'tsV' && t.tagName === 'SELECT') { loc.step.cond.value = t.value; save(); refreshNode(loc.step); }
    });
    // Drag & drop: palette items and nodes onto + connectors
    var drag = null;
    page.addEventListener('dragstart', function (e) {
      var p = e.target.closest && e.target.closest('[data-pal]'), n = e.target.closest && e.target.closest('.fnode[data-sid]');
      if (p) drag = { add: p.dataset.pal }; else if (n && n.dataset.sid !== 'trigger') { drag = { move: n.dataset.sid }; n.classList.add('dragging'); } else return;
      e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', drag.add || drag.move); } catch (x) {}
    });
    page.addEventListener('dragend', function () { drag = null; U.$$('.fadd.over,.fnode.dragging', page).forEach(function (x) { x.classList.remove('over', 'dragging'); }); });
    page.addEventListener('dragover', function (e) { var s = drag && e.target.closest('[data-slot]'); if (!s) return; e.preventDefault(); U.$$('.fadd.over', page).forEach(function (x) { if (x !== s) x.classList.remove('over'); }); s.classList.add('over'); });
    page.addEventListener('dragleave', function (e) { var s = e.target.closest && e.target.closest('[data-slot]'); if (s && !s.contains(e.relatedTarget)) s.classList.remove('over'); });
    page.addEventListener('drop', function (e) {
      var s = drag && e.target.closest('[data-slot]'); if (!s) return; e.preventDefault();
      if (drag.add) insertAt(s.dataset.slot, E.newStep(drag.add)); else moveTo(drag.move, s.dataset.slot);
      drag = null;
    });
  }, 'flows');

  // Flow email editor
  AM.route(/^\/flows\/(\d+)\/email\/([\w-]+)$/, function (page, m) {
    var f = E.flow(m[1]), loc = f && E.findStep(f.steps, m[2]);
    if (!loc || loc.step.type !== 'email') { page.innerHTML = '<div class="empty box">Email step not found. <a href="#/flows' + (f ? '/' + f.id : '') + '">Back</a></div>'; return; }
    var s = loc.step; App().title = s.name + ' — ' + f.name;
    AM.App.state.flowSel = { f: f.id, id: s.id };
    page.innerHTML = UI.head({ crumb: { href: '#/flows/' + f.id, label: f.name }, title: s.name || 'Flow email', sub: 'Flow email · changes save automatically' + (f.status === 'live' ? ' and apply to the next profiles that reach this step' : '') }) +
      '<section class="card" style="margin-bottom:14px"><div class="card-b row2" style="padding-top:16px"><div class="field"><label for="feS">Subject</label><input class="in" id="feS" value="' + esc(s.subject) + '"></div><div class="field"><label for="feP">Preview text</label><input class="in" id="feP" value="' + esc(s.preview || '') + '"></div></div></section><div id="edHost"></div>';
    var save = U.debounce(function () { f.updated = E.now(); App().save(['flows']); }, 300);
    page.querySelector('#feS').addEventListener('input', function (e) { s.subject = e.target.value; save(); });
    page.querySelector('#feP').addEventListener('input', function (e) { s.preview = e.target.value; save(); });
    AM.Editor.mount(page.querySelector('#edHost'), { design: s.design, title: s.name, fileName: 'flow-' + f.id + '-' + s.id, subject: function () { return s.subject; }, preview: function () { return s.preview; }, onChange: save });
  }, 'flows');
})();
