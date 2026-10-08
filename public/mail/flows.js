/* Flows: list, visual builder, flow-email editor route */
(function () {
  const AM = window.AM = window.AM || {}, U = AM.U, E = AM.E, M = AM.Email, UI = AM.UI, C = AM.C, esc = U.esc;
  const App = () => AM.App;
  const EV = [['cart', 'adds to cart'], ['checkout', 'starts checkout'], ['order', 'places an order'], ['view', 'views a product'], ['form', 'submits a form']];
  const DATEP = [['birthday', 'Birthday'], ['exam', 'Last eye exam'], ['refill', 'Lens refill date']];
  const STEPS = [['email', 'Send email', '✉'], ['sms', 'Send SMS', '✆'], ['delay', 'Time delay', '⏱'], ['cond', 'Conditional split', '⑂'], ['wait', 'Trigger split (wait for event)', '⌛'], ['prop', 'Update profile property', '✎'], ['hook', 'Webhook (skipped in demo)', '⇢']];
  const trigText = t => {
    if (!t) return '';
    if (t.type === 'event') return 'Profile ' + (EV.find(x => x[0] === t.ev) || [0, t.ev])[1];
    if (t.type === 'list') return 'Joins list: ' + ((E.listById(t.list) || {}).name || '?');
    if (t.type === 'segment') return 'Enters segment: ' + ((E.segById(t.seg) || {}).name || '?');
    if (t.type === 'date') return (DATEP.find(x => x[0] === t.prop) || [0, t.prop])[1] + (t.offset ? (t.offset > 0 ? ' + ' : ' − ') + Math.abs(t.offset) + ' days' : ' (on the day)');
    return '';
  };
  AM.flowTrigText = trigText;
  const sumStep = s => {
    switch (s.type) {
      case 'delay': return 'Wait ' + [s.d ? s.d + ' d' : '', s.h ? s.h + ' h' : '', s.m ? s.m + ' min' : ''].filter(Boolean).join(' ') || 'Wait 0';
      case 'email': return (s.name || 'Email') + ' · ' + (s.subject || '(no subject)');
      case 'sms': return (s.name || 'SMS') + ' · ' + String(s.text || '').slice(0, 50);
      case 'cond': return 'If ' + ((s.cond.rows || []).map(c => E.describeCond(c)).join(s.cond.mode === 'any' ? ' OR ' : ' AND ') || '(no condition)');
      case 'wait': return 'Wait up to ' + (s.days || 1) + ' d for: ' + ((EV.find(x => x[0] === s.ev) || [0, s.ev])[1]);
      case 'prop': return 'Set ' + s.key + ' = ' + s.val;
      default: return 'Call a webhook (not executed in this demo)';
    }
  };
  const newStep = type => {
    const id = 's' + U.uid('').slice(-5), b = { id, type, next: null };
    switch (type) {
      case 'email': return Object.assign(b, { name: 'New email', subject: 'Subject', preview: '', design: M.newDesign() });
      case 'sms': return Object.assign(b, { name: 'New SMS', text: 'Lumina: your message here. Reply STOP to opt out' });
      case 'delay': return Object.assign(b, { d: 1, h: 0, m: 0 });
      case 'cond': return { id, type, cond: { mode: 'all', rows: [{ t: 'pred', f: 'orders', op: 'gte', v: 1 }] }, yes: null, no: null };
      case 'wait': return { id, type, ev: 'order', days: 1, yes: null, no: null };
      case 'prop': return Object.assign(b, { key: 'vip', val: true });
      default: return Object.assign(b, { url: 'https://example.com/hook' });
    }
  };
  const emailIssues = f => { const out = []; f.steps.forEach(s => { if (s.type === 'email') Ed().checks(s.design, { subject: s.subject, preview: s.preview, products: E.db.products }).filter(c => c.level === 'error').forEach(c => out.push((s.name || 'Email') + ': ' + c.text)); }); return out; };
  const Ed = () => AM.Editor;

  /* ---------- list ---------- */
  AM.route(/^\/flows$/, page => {
    App().title = 'Flows';
    const draw = () => {
      const fl = E.db.flows, stats = fl.map(f => ({ f, s: E.flowStat(f) }));
      page.innerHTML = UI.head('Flows', 'Automated journeys that run on triggers. ' + fl.filter(f => f.status === 'live').length + ' of ' + fl.length + ' are live.', '<button class="btn primary" data-new>+ New flow</button>') +
        '<div class="card tscroll"><table class="tbl"><thead><tr><th>Flow</th><th>Status</th><th>Trigger</th><th class="r">Entered</th><th class="r">Active</th><th class="r">Sent</th><th class="r">Open</th><th class="r">Revenue</th><th></th></tr></thead><tbody>' +
        stats.map(({ f, s }) => '<tr><td><a href="#/flows/' + f.id + '"><b>' + esc(f.name) + '</b></a></td><td>' + UI.status(f.status) + '</td><td>' + esc(trigText(f.trigger)) + '</td><td class="r">' + U.num(s.entered) + '</td><td class="r">' + U.num(s.active) + '</td><td class="r">' + U.num(s.sent) + '</td><td class="r">' + U.pct(s.openRate) + '</td><td class="r">' + U.eur(s.rev) + '</td><td class="r nowrap"><button class="btn ghost sm" data-dup="' + f.id + '">Duplicate</button><button class="btn ghost sm" data-del="' + f.id + '">Delete</button></td></tr>').join('') + '</tbody></table></div>' +
        C.hbar({ title: 'Attributed revenue by flow', rows: stats.filter(x => x.s.rev > 0).sort((a, b) => b.s.rev - a.s.rev).map(x => ({ label: x.f.name, value: Math.round(x.s.rev) })), fmt: U.eur });
    };
    draw();
    page.onclick = async e => {
      const t = e.target;
      if (t.closest('[data-new]')) {
        const d = U.dialog('<form><label class="fld"><span>Name</span><input name="n" value="New flow" required></label><label class="fld"><span>Trigger</span><select name="t">' + U.opts([['list', 'Profile joins a list'], ['segment', 'Profile enters a segment'], ['event', 'Profile does something'], ['date', 'Date property']], 'list') + '</select></label><div class="row end"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Create</button></div></form>', { title: 'New flow' });
        d.q('form').onsubmit = ev => {
          ev.preventDefault(); const fd = new FormData(ev.target), t0 = fd.get('t');
          const trig = t0 === 'list' ? { type: 'list', list: E.db.lists[0].id } : t0 === 'segment' ? { type: 'segment', seg: E.db.segments[0].id } : t0 === 'event' ? { type: 'event', ev: 'cart' } : { type: 'date', prop: 'birthday', offset: 0 };
          const st = newStep('email'); st.id = 's1';
          const f = { id: 'fl_' + U.uid('').slice(-6), name: fd.get('n') || 'New flow', status: 'draft', trigger: trig, steps: [st], start: 's1', last: {}, stats: { entered: 0, completed: 0 }, cool: 30, created: E.now() };
          E.db.flows.push(f); App().save(['flows']); d.close(); App().go('#/flows/' + f.id);
        };
      }
      const dp = t.closest('[data-dup]'); if (dp) { const f = U.copy(E.flowById(dp.dataset.dup)); f.id = 'fl_' + U.uid('').slice(-6); f.name += ' (copy)'; f.status = 'draft'; f.last = {}; f.stats = { entered: 0, completed: 0 }; f.created = E.now(); E.db.flows.push(f); App().save(['flows']); draw(); U.toast('Flow duplicated'); }
      const dl = t.closest('[data-del]'); if (dl && await U.confirm('Delete this flow and stop all active runs?', 'Delete', true)) { const id = dl.dataset.del; E.db.flows = E.db.flows.filter(f => f.id !== id); E.db.runs = E.db.runs.filter(r => r.fid !== id); App().save(['flows', 'runs']); draw(); }
    };
  }, 'flows');

  /* ---------- builder ---------- */
  AM.route(/^\/flows\/([^/]+)$/, (page, m) => {
    const f = E.flowById(m[1]); if (!f) { page.innerHTML = UI.empty('Flow not found.', '<a class="btn" href="#/flows">Back to flows</a>'); return; }
    App().title = f.name;
    let sel = null, condEd = null;
    const save = () => App().save(['flows']);
    const card = (s, from, slot) => {
      const info = AM.E.step ? STEPS.find(x => x[0] === s.type) : null;
      let st = '';
      if (s.type === 'email' || s.type === 'sms') { const x = E.stat('f:' + f.id + ':' + s.id); st = '<div class="sstat muted">' + U.num(x.sent) + ' sent · ' + U.pct(x.openRate, 0) + ' open · ' + U.pct(x.clickRate) + ' click' + (x.rev ? ' · ' + U.eur(x.rev) : '') + '</div>'; }
      return '<button type="button" class="step ' + s.type + (sel === s.id ? ' on' : '') + '" data-sel="' + s.id + '"><span class="ic">' + (info ? info[2] : '?') + '</span><span class="tx"><b>' + esc(info ? info[1] : s.type) + '</b><span>' + esc(sumStep(s)) + '</span>' + st + '</span></button>';
    };
    const add = (from, slot) => '<button type="button" class="addstep" data-add="' + (from || '') + '" data-slot="' + slot + '" aria-label="Add step">+</button>';
    const chain = (id, from, slot, seen) => {
      let h = '';
      if (!id) return h + add(from, slot) + '<div class="endcap">End</div>';
      const s = E.step(f, id); if (!s || seen.indexOf(id) >= 0) return h + '<div class="endcap">End</div>';
      seen = seen.concat(id);
      h += add(from, slot) + card(s, from, slot);
      if (s.type === 'cond' || s.type === 'wait') h += '<div class="branches"><div class="br"><div class="brl">' + (s.type === 'cond' ? 'Yes' : 'Event happened') + '</div>' + chain(s.yes, s.id, 'yes', seen) + '</div><div class="br"><div class="brl">' + (s.type === 'cond' ? 'No' : 'Did not happen') + '</div>' + chain(s.no, s.id, 'no', seen) + '</div></div>';
      else h += chain(s.next, s.id, 'next', seen);
      return h;
    };
    const stats = () => { const s = E.flowStat(f); return '<div class="kpis">' + UI.kpi('Entered', U.num(s.entered)) + UI.kpi('Active now', U.num(s.active)) + UI.kpi('Completed', U.num(s.completed)) + UI.kpi('Messages sent', U.num(s.sent), U.pct(s.openRate) + ' open') + UI.kpi('Attributed revenue', U.eur(s.rev), U.num(s.orders) + ' orders') + '</div>'; };
    const trigForm = () => {
      const t = f.trigger; let h = '<label class="fld"><span>Trigger type</span><select data-t="type">' + U.opts([['list', 'Joins a list'], ['segment', 'Enters a segment'], ['event', 'Event'], ['date', 'Date property']], t.type) + '</select></label>';
      if (t.type === 'list') h += '<label class="fld"><span>List</span><select data-t="list">' + U.opts(E.db.lists.map(l => [l.id, l.name]), t.list) + '</select></label>';
      if (t.type === 'segment') h += '<label class="fld"><span>Segment</span><select data-t="seg">' + U.opts(E.db.segments.map(l => [l.id, l.name]), t.seg) + '</select></label>';
      if (t.type === 'event') h += '<label class="fld"><span>When a profile…</span><select data-t="ev">' + U.opts(EV, t.ev) + '</select></label>';
      if (t.type === 'date') h += '<label class="fld"><span>Date</span><select data-t="prop">' + U.opts(DATEP, t.prop) + '</select></label><label class="fld"><span>Offset in days (negative = before)</span><input type="number" data-t="offset" value="' + (t.offset || 0) + '"></label>';
      h += '<label class="fld"><span>Re-entry: minimum days between entries</span><input type="number" min="0" data-f="cool" value="' + (f.cool == null ? 30 : f.cool) + '"></label>';
      h += '<div class="fld"><span>Entry filter (optional)</span><div id="filt"></div></div>';
      return h;
    };
    const inspector = () => {
      if (sel === 'trigger') return '<h3>Trigger</h3>' + trigForm();
      const s = E.step(f, sel); if (!s) return '<p class="muted">Select a step to edit it. Click the trigger card to change when profiles enter.</p>';
      const inp = (k, l, t, w) => '<label class="fld"><span>' + l + '</span><input data-s="' + k + '" type="' + (t || 'text') + '" value="' + esc(s[k] == null ? '' : s[k]) + '"' + (w ? ' style="max-width:' + w + 'px"' : '') + '></label>';
      let h = '<h3>' + esc((STEPS.find(x => x[0] === s.type) || [0, s.type])[1]) + '</h3>';
      switch (s.type) {
        case 'delay': h += '<div class="row gap">' + inp('d', 'Days', 'number', 90) + inp('h', 'Hours', 'number', 90) + inp('m', 'Minutes', 'number', 90) + '</div>'; break;
        case 'email': h += inp('name', 'Step name') + inp('subject', 'Subject') + inp('preview', 'Preview text') + '<a class="btn primary" href="#/flows/' + f.id + '/email/' + s.id + '">Edit content</a>'; break;
        case 'sms': { const i = U.smsInfo(s.text); h += inp('name', 'Step name') + '<label class="fld"><span>Message</span><textarea data-s="text" rows="4">' + esc(s.text) + '</textarea></label><p class="muted">' + i.chars + ' characters · ' + i.segments + ' segment(s) · ' + i.enc + '</p>'; break; }
        case 'cond': h += '<p class="muted">Profiles that match go down “Yes”, everyone else down “No”.</p><div id="cond"></div>'; break;
        case 'wait': h += '<label class="fld"><span>Wait for this event</span><select data-s="ev">' + U.opts(EV, s.ev) + '</select></label>' + inp('days', 'Wait up to (days)', 'number', 120); break;
        case 'prop': h += inp('key', 'Property name') + inp('val', 'Value'); break;
        default: h += inp('url', 'URL') + '<p class="muted">Webhooks are skipped by the demo runner.</p>';
      }
      return h + '<div class="row gap" style="margin-top:12px"><button class="btn danger sm" data-rm="' + s.id + '">Delete step</button></div>';
    };
    const toggleBtns = () => f.status === 'live' ? '<button class="btn" data-st="paused">Pause</button>' : '<button class="btn primary" data-st="live">Set live</button>' + (f.status === 'paused' ? '<button class="btn" data-st="draft">Back to draft</button>' : '');
    const draw = () => {
      page.innerHTML = '<div class="crumb"><a href="#/flows">Flows</a> › <span>' + esc(f.name) + '</span></div>' + UI.head(f.name, UI.status(f.status) + ' &nbsp;' + esc(trigText(f.trigger)), '<button class="btn" data-rename>Rename</button>' + toggleBtns()) + stats() +
        '<div class="fgrid"><div class="fcanvas card"><button type="button" class="step trig' + (sel === 'trigger' ? ' on' : '') + '" data-sel="trigger"><span class="ic">⚡</span><span class="tx"><b>Trigger</b><span>' + esc(trigText(f.trigger)) + '</span></span></button>' + chain(f.start, null, 'start', []) + '</div><aside class="finsp card" id="finsp">' + inspector() + '</aside></div>';
      mountInner();
    };
    const mountInner = () => {
      const c = page.querySelector('#cond'); if (c) { const s = E.step(f, sel); condEd = UI.condEditor(c, s.cond, { onChange: () => { save(); refreshCard(); } }); }
      const fl = page.querySelector('#filt'); if (fl) { f.filter = f.filter || { mode: 'all', rows: [] }; UI.condEditor(fl, f.filter, { onChange: save }); }
    };
    const refreshCard = () => { const b = page.querySelector('.step.on'); if (b && sel !== 'trigger') { const s = E.step(f, sel); if (s) b.querySelector('.tx span').textContent = sumStep(s); } };
    const link = (from, slot, id) => { if (slot === 'start') f.start = id; else E.step(f, from)[slot] = id; };
    page.onclick = async e => {
      const t = e.target;
      const sl = t.closest('[data-sel]'); if (sl) { sel = sl.dataset.sel; return draw(); }
      const ad = t.closest('[data-add]');
      if (ad) {
        const d = U.dialog('<div class="plist">' + STEPS.map(x => '<button type="button" class="prow" data-type="' + x[0] + '"><span class="ic">' + x[2] + '</span><b>' + x[1] + '</b></button>').join('') + '</div>', { title: 'Add a step' });
        d.q('.plist').onclick = ev => {
          const b = ev.target.closest('[data-type]'); if (!b) return;
          const s = newStep(b.dataset.type), from = ad.dataset.add || null, slot = ad.dataset.slot;
          const cur = slot === 'start' ? f.start : E.step(f, from)[slot];
          if (s.type === 'cond' || s.type === 'wait') s.yes = null, s.no = cur; else s.next = cur;
          f.steps.push(s); link(from, slot, s.id); sel = s.id; save(); d.close(); draw();
        };
        return;
      }
      const rm = t.closest('[data-rm]'); if (rm) {
        if (!await U.confirm('Delete this step?', 'Delete', true)) return;
        const s = E.step(f, rm.dataset.rm), repl = (s.type === 'cond' || s.type === 'wait') ? null : s.next;
        if (f.start === s.id) f.start = repl;
        f.steps.forEach(x => { ['next', 'yes', 'no'].forEach(k => { if (x[k] === s.id) x[k] = repl; }); });
        f.steps = f.steps.filter(x => x.id !== s.id); sel = null; save(); return draw();
      }
      const st = t.closest('[data-st]'); if (st) {
        if (st.dataset.st === 'live') {
          if (!f.start) { U.toast('Add at least one step first', 'warn'); return; }
          const iss = emailIssues(f); if (iss.length) { U.dialog('<p>Fix these before going live:</p><ul class="checks">' + iss.map(x => '<li class="error"><b>✕</b> ' + esc(x) + '</li>').join('') + '</ul>', { title: 'Cannot set live' }); return; }
        }
        f.status = st.dataset.st; save(); U.toast('Flow ' + f.status); return draw();
      }
      if (t.closest('[data-rename]')) { const n = await U.prompt('Rename flow', 'Name', f.name); if (n) { f.name = n; save(); draw(); } }
    };
    page.onchange = e => {
      const t = e.target;
      if (t.dataset.t) {
        const k = t.dataset.t; if (k === 'type') { f.trigger = t.value === 'list' ? { type: 'list', list: E.db.lists[0].id } : t.value === 'segment' ? { type: 'segment', seg: E.db.segments[0].id } : t.value === 'event' ? { type: 'event', ev: 'cart' } : { type: 'date', prop: 'birthday', offset: 0 }; } else f.trigger[k] = k === 'offset' ? +t.value : t.value;
        save(); return draw();
      }
      if (t.dataset.f) { f[t.dataset.f] = +t.value; return save(); }
      if (t.dataset.s) { const s = E.step(f, sel); if (!s) return; let v = t.type === 'number' ? +t.value : t.value; if (t.dataset.s === 'val') v = v === 'true' ? true : v === 'false' ? false : isNaN(v) || v === '' ? v : +v; s[t.dataset.s] = v; save(); draw(); }
    };
    draw();
  }, 'flows');

  /* ---------- flow email editor ---------- */
  AM.route(/^\/flows\/([^/]+)\/email\/([^/]+)$/, (page, m) => {
    const f = E.flowById(m[1]), s = f && E.step(f, m[2]);
    if (!s || s.type !== 'email') { page.innerHTML = UI.empty('Email step not found.', '<a class="btn" href="#/flows">Back to flows</a>'); return; }
    App().title = s.name || 'Flow email';
    const pid = U.pref('previewP'), prof = pid ? E.P.get(pid) : null;
    page.innerHTML = '<div class="crumb"><a href="#/flows">Flows</a> › <a href="#/flows/' + f.id + '">' + esc(f.name) + '</a> › <span>' + esc(s.name || 'Email') + '</span></div>' + UI.head(s.name || 'Email', 'Content of a flow email. Changes are saved automatically.', '<a class="btn" href="#/flows/' + f.id + '">Done</a>') +
      '<div class="card pad"><div class="grid2"><label class="fld"><span>Subject</span><input id="fe-sub" value="' + esc(s.subject) + '"></label><label class="fld"><span>Preview text</span><input id="fe-pre" value="' + esc(s.preview) + '"></label></div></div><div id="fe-ed"></div><div class="card pad"><h3>Pre-send checks</h3><div id="fe-chk"></div></div>';
    const chk = () => { page.querySelector('#fe-chk').innerHTML = AM.Editor.checksHtml(AM.Editor.checks(s.design, { subject: s.subject, preview: s.preview, products: E.db.products })); };
    const save = U.debounce(() => { App().save(['flows']); chk(); }, 400);
    const ed = AM.Editor.mount(page.querySelector('#fe-ed'), s.design, { products: E.db.products, profile: prof, subject: () => s.subject, previewText: () => s.preview, onChange: d => { s.design = d; save(); } });
    page.querySelector('#fe-sub').oninput = e => { s.subject = e.target.value; save(); };
    page.querySelector('#fe-pre').oninput = e => { s.preview = e.target.value; save(); };
    page.querySelector('#fe-sub').onchange = page.querySelector('#fe-pre').onchange = () => ed.refresh();
    chk();
  }, 'flows');
})();
