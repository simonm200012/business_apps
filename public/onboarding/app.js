/* Joiners & leavers: storage, router, pages, dialogs, case and asset logic. Demo mode only. */
(function () {
  'use strict';
  var J = window.JLData, TODAY = J.todayLj();
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var db = null, IX = {}, memOnly = false, pending = false, saveTimer = 0, chain = Promise.resolve(), dlgFn = null;
  var UIKEY = 'adrial-onboarding-ui';
  var UIDEF = { cases: { q: '', type: '', state: '', co: '', sort: 'date', dir: 1 }, tasks: { tab: 'overdue', sel: {} }, assets: { q: '', type: '', status: '' }, case: { group: 'team' }, cal: { m: '' }, tpl: {}, actor: 'HR', team: '' };
  var ui = loadUi();
  function loadUi() { var o = {}; try { o = JSON.parse(localStorage.getItem(UIKEY) || '{}') || {}; } catch (e) {} var r = {}; Object.keys(UIDEF).forEach(function (k) { r[k] = (typeof UIDEF[k] === 'object') ? Object.assign({}, UIDEF[k], o[k] || {}) : (o[k] != null ? o[k] : UIDEF[k]); }); return r; }
  function saveUi() { try { localStorage.setItem(UIKEY, JSON.stringify(ui)); } catch (e) {} }
  var bc = null; try { bc = new BroadcastChannel('adrial-onboarding'); } catch (e) {}

  /* ---------- IndexedDB ---------- */
  var dbh = null;
  function open() { return dbh || (dbh = new Promise(function (res, rej) { var r = indexedDB.open('adrial-onboarding', 1); r.onupgradeneeded = function () { r.result.createObjectStore('kv'); }; r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; })); }
  function tx(mode, fn) { return open().then(function (d) { return new Promise(function (res, rej) { var t = d.transaction('kv', mode), rq = fn(t.objectStore('kv')); t.oncomplete = function () { res(rq && rq.result); }; t.onerror = t.onabort = function () { rej(t.error); }; }); }); }
  var idbGet = function () { return tx('readonly', function (s) { return s.get('db'); }); };
  var idbPut = function (v) { return tx('readwrite', function (s) { return s.put(v, 'db'); }); };
  var idbReset = function () { return tx('readwrite', function (s) { return s.clear(); }); };
  function validDb(d) { return d && d.version === J.VERSION && Array.isArray(d.people) && Array.isArray(d.cases) && Array.isArray(d.assets) && Array.isArray(d.templates) && d.seq; }
  function save() { pending = true; clearTimeout(saveTimer); saveTimer = setTimeout(flush, 250); }
  function flush() {
    clearTimeout(saveTimer);
    if (memOnly) { pending = false; return Promise.resolve(); }
    chain = chain.then(function () { return idbPut(JSON.parse(JSON.stringify(db))); }).then(function () { announce(); }).catch(storageFailed).then(function () { if (!saveTimer) pending = false; });
    return chain;
  }
  function announce() { try { bc && bc.postMessage({ type: 'changed' }); } catch (e) {} }
  function storageFailed() { if (!memOnly) { memOnly = true; toast('Browser storage is unavailable: changes are kept in memory only.'); } }
  if (bc) bc.onmessage = function (e) {
    if (!e.data || e.data.type !== 'changed' || pending || memOnly) return;
    idbGet().then(function (d) { if (validDb(d)) { db = d; ensureSchema(); reindex(); rerender(); } });
  };

  /* ---------- helpers ---------- */
  var fmtD = function (s) { if (!s) return ''; var p = s.slice(0, 10).split('-'); return +p[2] + '.' + +p[1] + '.' + p[0]; };
  var fmtDT = function (s) { return s ? fmtD(s) + ' ' + (s.slice(11, 16) || '') : ''; };
  var nowIso = function () { return TODAY + 'T' + new Date().toTimeString().slice(0, 5); };
  var actor = function () { return actorName(ui.actor); };
  function actorName(k) { return J.ACTOR_BY_TEAM[k] || k; }
  function toast(m) { var t = $('#toast'); t.textContent = m; t.className = 'show'; clearTimeout(toast.t); toast.t = setTimeout(function () { t.className = ''; }, 3200); }
  var TYPE = { joiner: 'Joiner', leaver: 'Leaver', change: 'Change' };
  var teamName = function (id) { return (J.TEAMS.filter(function (t) { return t.id === id; })[0] || { name: id }).name; };
  var locName = function (id) { return (J.locOf(id) || { name: id }).name; };
  var coName = function (id) { return (J.COMPANIES.filter(function (c) { return c.id === id; })[0] || { name: id }).name; };
  function ensureSchema() {
    db.cases.forEach(function (c) { c.log = c.log || []; c.tasks = c.tasks || []; });
    db.assets.forEach(function (a) { a.log = a.log || []; });
    db.people.forEach(function (p) { p.licences = p.licences || []; });
  }
  function reindex() {
    IX = { p: {}, c: {}, a: {}, tpl: {}, openCase: {}, held: {} };
    db.people.forEach(function (p) { IX.p[p.id] = p; });
    db.cases.forEach(function (c) { IX.c[c.id] = c; if (c.status === 'open') IX.openCase[c.pid] = c; });
    db.assets.forEach(function (a) { IX.a[a.id] = a; if (a.status === 'issued' && a.holder) (IX.held[a.holder] = IX.held[a.holder] || []).push(a); });
    db.templates.forEach(function (t) { IX.tpl[t.id] = t; });
  }
  var held = function (pid) { return IX.held[pid] || []; };
  var person = function (c) { return IX.p[c.pid] || { name: '(unknown)' }; };
  function stats(c) {
    var s = { total: 0, done: 0, open: 0, reqOpen: 0, overdue: 0 };
    c.tasks.forEach(function (t) { if (t.status === 'na') return; s.total++; if (t.status === 'done') s.done++; else { s.open++; if (t.required) s.reqOpen++; if (t.due < TODAY) s.overdue++; } });
    s.pct = s.total ? Math.round(100 * s.done / s.total) : 100; return s;
  }
  function blockers(c) {
    var b = { tasks: c.tasks.filter(function (t) { return t.required && t.status === 'open'; }), assets: c.type === 'leaver' ? held(c.pid) : [] };
    b.n = b.tasks.length + b.assets.length; return b;
  }
  /* open, overdue, blocked, ready, closed, override */
  function caseState(c) {
    if (c.status === 'closed') return c.override ? 'override' : 'closed';
    if (c.type === 'leaver' && c.date < TODAY && (held(c.pid).length || c.tasks.some(function (t) { return t.required && t.status === 'open' && t.due <= TODAY; }))) return 'blocked';
    if (c.tasks.some(function (t) { return t.required && t.status === 'open' && t.due < TODAY; })) return 'overdue';
    if (!c.tasks.some(function (t) { return t.required && t.status === 'open'; })) return 'ready';
    return 'open';
  }
  var STATE_LBL = { open: 'Open', overdue: 'Overdue', blocked: 'Blocked', ready: 'Ready to close', closed: 'Closed', override: 'Closed (override)' };
  var pill = function (cls, t) { return '<span class="pill ' + cls + '">' + esc(t) + '</span>'; };
  var statePill = function (c) { var s = caseState(c); return pill(s, STATE_LBL[s]); };
  var link = function (h, t, cls) { return '<a href="#/' + h + '"' + (cls ? ' class="' + cls + '"' : '') + '>' + esc(t) + '</a>'; };
  var caseLink = function (c) { return link('cases/' + c.id, c.no); };
  function collectList() { return db.cases.filter(function (c) { return c.type === 'leaver' && c.status === 'open' && held(c.pid).length; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; }); }
  function commit(msg) { reindex(); save(); rerender(); if (msg) toast(msg); }
  function log(c, msg) { c.log.push({ at: nowIso(), by: actor(), msg: msg }); }
  function csv(rows, name) {
    var s = rows.map(function (r) { return r.map(function (v) { v = String(v == null ? '' : v); return /[",\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(','); }).join('\r\n');
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + s], { type: 'text/csv' })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  /* ---------- case logic ---------- */
  function applyDone(c, t, extra) {
    t.status = 'done'; t.by = actor(); t.at = nowIso();
    var l = t.licence, p = IX.p[c.pid], m = l && l.match(/^(assign|remove|change):(.+)$/);
    if (m && p) {
      if (m[1] === 'remove') { log(c, 'Licences removed: ' + (p.licences.join(', ') || 'none') + '.'); p.licences = []; }
      else if (p.licences.indexOf(m[2]) < 0) { p.licences.push(m[2]); log(c, 'Licence ' + (m[1] === 'assign' ? 'assigned' : 'changed') + ': ' + m[2] + '.'); }
    }
    log(c, 'Done: ' + t.title + (extra ? ' (' + extra + ')' : '') + '.');
  }
  function applyReopen(c, t) { t.status = 'open'; t.by = ''; t.at = ''; log(c, 'Reopened: ' + t.title + '. Equipment records are not reverted.'); }
  function tick(c, t) {
    if (c.status === 'closed') return toast('Reopen the case to change tasks.');
    if (t.status === 'done') { applyReopen(c, t); return commit(); }
    if (t.collect) return collectDialog(c, t);
    if (t.asset) return issueDialog(c, t);
    applyDone(c, t); commit();
  }
  function createCase(o) {
    var tpl = IX.tpl[o.tpl], p;
    if (o.type === 'joiner') {
      var loc = J.locOf(o.loc);
      p = { id: 'P' + String(++db.seq.p).padStart(3, '0'), name: o.name, email: o.name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, '').trim().replace(/ +/g, '.') + '@example.com', co: loc.co, loc: o.loc, role: o.role, start: o.date, status: o.date > TODAY ? 'pending' : 'active', contract: o.contract, licences: [], mgr: o.mgr || db.mgrs[o.loc] };
      db.people.push(p);
    } else p = IX.p[o.pid];
    var yr = o.date.slice(0, 4); db.seq.c[yr] = (db.seq.c[yr] || 0) + 1;
    var c = { id: 'c' + (db.cases.length + 1) + '-' + Date.now().toString(36), no: 'JL-' + yr + '-' + String(db.seq.c[yr]).padStart(3, '0'), type: o.type, pid: p.id, date: o.date, status: 'open', created: nowIso(), closedAt: '', override: null, to: o.type === 'change' ? { role: o.toRole || p.role, loc: o.toLoc || p.loc } : null, tasks: [], log: [], prev: null, co: p.co, loc: p.loc, role: p.role, contract: p.contract, tpl: tpl.id, mgr: p.mgr || db.mgrs[p.loc] };
    c.tasks = J.buildTasks(tpl, o.date, { role: p.role, contract: p.contract });
    log(c, 'Case created from template "' + tpl.name + '".');
    c.tasks.forEach(function (t) { if (t.status === 'na') c.log.push({ at: nowIso(), by: 'Template rule', msg: 'Task "' + t.title + '" marked not needed. ' + t.why }); });
    db.cases.push(c); return c;
  }
  function doClose(c, override) {
    var p = IX.p[c.pid]; c.prev = { status: p.status, role: p.role, loc: p.loc, co: p.co, left: p.left || '' };
    if (c.type === 'leaver') { p.status = 'left'; p.left = c.date; held(p.id).forEach(function (a) { J.returnAsset(db, a, TODAY, actor(), 'Closed with override'); }); }
    else { p.status = 'active'; if (c.type === 'change' && c.to) { p.role = c.to.role; p.loc = c.to.loc; p.co = J.locOf(p.loc).co; } }
    c.status = 'closed'; c.closedAt = nowIso(); c.override = override || null;
    log(c, override ? 'Case closed with override: ' + override.reason : 'Case closed.');
  }
  function closeCase(c) { var b = blockers(c); if (b.n) return overrideDialog(c, b); doClose(c); commit('Case closed.'); }
  function reopenCase(c) {
    var p = IX.p[c.pid]; if (c.prev) { p.status = c.prev.status; p.role = c.prev.role; p.loc = c.prev.loc; p.co = c.prev.co; p.left = c.prev.left; }
    c.status = 'open'; c.override = null; c.closedAt = ''; log(c, 'Case reopened.'); commit('Case reopened.');
  }

  /* ---------- dialogs ---------- */
  function dlg(title, body, onSubmit, opts) {
    opts = opts || {};
    $('#layers').innerHTML = '<div class="back" data-act="dlgback"><form class="dlg" role="dialog" aria-modal="true" aria-label="' + esc(title) + '" data-act="dlgform"><h2>' + esc(title) + '</h2>' + body + '<div class="row" style="justify-content:flex-end;margin-top:12px"><button type="button" class="btn" data-act="dlgclose">Cancel</button>' + (opts.noSubmit ? '' : '<button class="btn pri" type="submit">' + esc(opts.ok || 'Save') + '</button>') + '</div></form></div>';
    dlgFn = onSubmit; var f = $('#layers input:not([type=checkbox]),#layers select,#layers textarea,#layers .btn.pri'); if (f) f.focus();
  }
  function closeDlg() { $('#layers').innerHTML = ''; dlgFn = null; }
  function opt(v, t, sel) { return '<option value="' + esc(v) + '"' + (sel ? ' selected' : '') + '>' + esc(t) + '</option>'; }
  function issueDialog(c, t) {
    var p = IX.p[c.pid], T = J.typeOf(t.asset), loc = (c.to && c.to.loc) || p.loc;
    var stock = db.assets.filter(function (a) { return a.type === t.asset && a.status === 'stock' && (t.asset !== 'key' || a.loc === loc); });
    dlg('Issue ' + T.name.toLowerCase() + ' to ' + p.name,
      '<label class="f">Item<select name="item">' + stock.map(function (a) { return opt(a.id, a.tag + ' · ' + a.model); }).join('') + opt('new', 'New item (tag ' + J.nextTag(db, t.asset, loc) + ')', !stock.length) + '</select></label>' +
      '<label class="row small"><input type="checkbox" name="none"> No equipment needed for this person</label>',
      function (f) {
        if (f.none) { applyDone(c, t, 'no equipment needed'); }
        else { var id = f.item === 'new' ? J.addAsset(db, t.asset, loc, TODAY, 'stock', actor()).id : f.item, a = J.issueAsset(db, p.id, t.asset, loc, TODAY, actor(), id); applyDone(c, t, a.tag + ' issued'); }
        closeDlg(); commit();
      }, { ok: 'Issue and mark done' });
    if (!stock.length) { var s = $('#layers select[name=item]'); if (s) s.value = 'new'; }
  }
  function collectDialog(c, t) {
    var items = held(c.pid).filter(function (a) { return t.collect.indexOf(a.type) >= 0; });
    if (!items.length) { applyDone(c, t, 'nothing to collect'); return commit(); }
    dlg('Collect equipment from ' + person(c).name,
      '<p class="small mute">Tick every item that has been handed back. The task is marked done only when all are returned.</p>' + items.map(function (a) { return '<label class="row"><input type="checkbox" name="r_' + a.id + '"> ' + esc(a.tag + ' · ' + J.typeOf(a.type).name + ' · ' + a.model) + '</label>'; }).join(''),
      function (f) {
        var ret = items.filter(function (a) { return f['r_' + a.id]; });
        ret.forEach(function (a) { J.returnAsset(db, a, TODAY, actor(), 'Task: ' + t.title); });
        if (ret.length === items.length) { applyDone(c, t, ret.length + ' returned'); closeDlg(); commit('All items returned.'); }
        else if (ret.length) { log(c, ret.length + ' item(s) returned for "' + t.title + '", ' + (items.length - ret.length) + ' still outstanding.'); closeDlg(); commit('Partly returned: task stays open.'); }
        else toast('Tick at least one returned item.');
      }, { ok: 'Save' });
  }
  function overrideDialog(c, b) {
    dlg('Close case with open items?',
      '<p>These items still block closing:</p><ul>' + b.tasks.map(function (t) { return '<li>' + esc(t.title) + ' <span class="mute">(' + esc(teamName(t.team)) + ', due ' + fmtD(t.due) + ')</span></li>'; }).join('') + b.assets.map(function (a) { return '<li>Still held: ' + esc(a.tag) + ' (' + esc(J.typeOf(a.type).name) + ')</li>'; }).join('') + '</ul><label class="f">Reason for the override (at least 5 characters)<textarea name="reason" required minlength="5"></textarea></label>',
      function (f) { var r = (f.reason || '').trim(); if (r.length < 5) return toast('Please give a reason of at least 5 characters.'); doClose(c, { reason: r, by: actor(), at: nowIso() }); closeDlg(); commit('Case closed with override.'); }, { ok: 'Close with override' });
  }
  function newCaseDialog(type, st) {
    st = st || {}; type = type || 'joiner';
    var pe = db.people.filter(function (p) { return p.status === 'active' && !IX.openCase[p.id]; }).sort(function (a, b) { return a.name < b.name ? -1 : 1; });
    var sel = st.pid || (pe[0] && pe[0].id), sp = IX.p[sel], loc = st.loc || (sp && sp.loc) || 'LJ-BTC', kind = (J.locOf(loc) || {}).kind;
    var tpls = db.templates.filter(function (t) { return t.type === type; }), tplSel = st.tpl && IX.tpl[st.tpl] && IX.tpl[st.tpl].type === type ? st.tpl : (type === 'joiner' ? (tpls.filter(function (t) { return t.kind === kind; })[0] || tpls[0]).id : tpls[0].id);
    var body = '<label class="f">Type<select name="type" data-chg="nctype">' + Object.keys(TYPE).map(function (k) { return opt(k, TYPE[k], k === type); }).join('') + '</select></label>';
    if (type === 'joiner') body += '<label class="f">Full name<input name="name" required value="' + esc(st.name || '') + '"></label><label class="f">Role<select name="role">' + J.ROLES.map(function (r) { return opt(r.id, r.id, r.id === (st.role || 'Optician')); }).join('') + '</select></label><label class="f">Location<select name="loc" data-chg="ncloc">' + J.LOCATIONS.map(function (l) { return opt(l.id, l.name, l.id === loc); }).join('') + '</select></label><label class="f">Contract<select name="contract">' + J.CONTRACTS.map(function (k) { return opt(k.id, k.name, k.id === st.contract); }).join('') + '</select></label>';
    else {
      body += '<label class="f">Person<select name="pid" data-chg="ncperson">' + pe.map(function (p) { return opt(p.id, p.name + ' · ' + p.role + ', ' + locName(p.loc), p.id === sel); }).join('') + '</select></label>';
      if (type === 'change') body += '<label class="f">New role<select name="toRole">' + J.ROLES.map(function (r) { return opt(r.id, r.id, r.id === (st.toRole || (sp && sp.role))); }).join('') + '</select></label><label class="f">New location<select name="toLoc">' + J.LOCATIONS.map(function (l) { return opt(l.id, l.name, l.id === (st.toLoc || loc)); }).join('') + '</select></label>';
    }
    body += '<label class="f">' + (type === 'joiner' ? 'Start date' : type === 'leaver' ? 'Last working day' : 'Effective date') + '<input type="date" name="date" required value="' + esc(st.date || J.workday(J.addDays(TODAY, 14), 1)) + '"></label><label class="f">Checklist template<select name="tpl">' + tpls.map(function (t) { return opt(t.id, t.name, t.id === tplSel); }).join('') + '</select></label>';
    dlg('New case', body, function (f) {
      if (f.type === 'joiner' && !(f.name || '').trim()) return toast('Name is required.');
      if (!/^\d{4}-\d\d-\d\d$/.test(f.date || '')) return toast('Pick a date.');
      if (f.type !== 'joiner' && !f.pid) return toast('No person available.');
      var c = createCase({ type: f.type, name: (f.name || '').trim(), role: f.role, loc: f.loc, contract: f.contract, pid: f.pid, date: f.date, tpl: f.tpl, toRole: f.toRole, toLoc: f.toLoc });
      closeDlg(); commit('Case ' + c.no + ' created.'); location.hash = '#/cases/' + c.id;
    }, { ok: 'Create case' });
  }
  function dateDialog(c) {
    dlg('Change case date', '<label class="f">New date<input type="date" name="date" required value="' + c.date + '"></label><label class="row"><input type="checkbox" name="move" checked> Move the due dates of open tasks</label><p class="small mute">Unticked: the offsets are recalculated and task dates stay where they are.</p>',
      function (f) {
        if (!/^\d{4}-\d\d-\d\d$/.test(f.date || '')) return toast('Pick a date.');
        var old = c.date; c.date = f.date;
        c.tasks.forEach(function (t) { if (f.move) { if (t.status !== 'done') t.due = J.dueFor(c.date, t.offset); } else t.offset = J.diffDays(t.due, c.date); });
        log(c, 'Case date changed from ' + fmtD(old) + ' to ' + fmtD(c.date) + (f.move ? '; open due dates moved.' : '; due dates kept.')); closeDlg(); commit('Date changed.');
      });
  }
  function assetIssueDialog(a) {
    var pe = db.people.filter(function (p) { return p.status !== 'left'; }).sort(function (x, y) { return x.name < y.name ? -1 : 1; });
    dlg('Issue ' + a.tag, '<label class="f">Person<select name="pid">' + pe.map(function (p) { return opt(p.id, p.name + ' · ' + locName(p.loc)); }).join('') + '</select></label>', function (f) {
      J.issueAsset(db, f.pid, a.type, a.loc, TODAY, actor(), a.id); closeDlg(); commit(a.tag + ' issued.');
    }, { ok: 'Issue' });
  }
  function formData(form) { var o = {}; $$('input,select,textarea', form).forEach(function (el) { if (!el.name) return; o[el.name] = el.type === 'checkbox' ? el.checked : el.value; }); return o; }

  /* ---------- charts ---------- */
  function timeline() {
    var from = J.addDays(TODAY, -6), cs = db.cases.filter(function (c) { return c.status === 'open' && c.date >= from && c.date <= J.addDays(from, 27); }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var W = 700, dw = W / 28, rh = 22, H = 40 + Math.max(cs.length, 1) * rh, s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Case dates over the next four weeks" width="100%">';
    for (var i = 0; i < 28; i++) { var d = J.addDays(from, i), w = J.dow(d); if (w >= 5) s += '<rect x="' + i * dw + '" y="24" width="' + dw + '" height="' + (H - 24) + '" fill="var(--line)" opacity=".35"/>'; if (i % 7 === 0) s += '<text x="' + (i * dw + 2) + '" y="12" class="mute">' + fmtD(d).slice(0, -5) + '</text>'; }
    var tx = (diff(TODAY, from) + .5) * dw; s += '<line x1="' + tx + '" x2="' + tx + '" y1="18" y2="' + H + '" stroke="var(--accent)" stroke-dasharray="3 3"/><text x="' + (tx + 3) + '" y="34" style="fill:var(--accent)">today</text>';
    cs.forEach(function (c, k) { var x = (diff(c.date, from) + .5) * dw, y = 46 + k * rh, col = 'var(--c-' + c.type + ')'; s += '<a href="#/cases/' + c.id + '"><circle cx="' + x + '" cy="' + y + '" r="6" fill="' + col + '"/><text x="' + (x + (x > W * .65 ? -10 : 10)) + '" y="' + (y + 4) + '" text-anchor="' + (x > W * .65 ? 'end' : 'start') + '">' + esc(person(c).name + ' · ' + TYPE[c.type]) + '</text></a>'; });
    if (!cs.length) s += '<text x="10" y="56" class="mute">No case dates in this window.</text>';
    return s + '</svg>';
  }
  var diff = function (a, b) { return J.diffDays(a, b); };
  function monthChart() {
    var months = [], y = +TODAY.slice(0, 4), m = +TODAY.slice(5, 7);
    for (var i = 11; i >= 0; i--) { var mm = m - i, yy = y; while (mm < 1) { mm += 12; yy--; } months.push(yy + '-' + String(mm).padStart(2, '0')); }
    var data = months.map(function (k) { var o = { k: k, joiner: 0, leaver: 0, change: 0 }; db.cases.forEach(function (c) { if (c.date.slice(0, 7) === k) o[c.type]++; }); return o; });
    var mx = Math.max.apply(null, data.map(function (o) { return o.joiner + o.leaver + o.change; }).concat(4)), W = 700, H = 200, bw = W / 12;
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Cases per month" width="100%"><line class="ax" x1="0" x2="' + W + '" y1="170" y2="170"/>';
    data.forEach(function (o, i) { var yb = 170; ['joiner', 'leaver', 'change'].forEach(function (t) { var h = o[t] / mx * 140; yb -= h; if (h) s += '<rect x="' + (i * bw + 8) + '" y="' + yb + '" width="' + (bw - 16) + '" height="' + h + '" fill="var(--c-' + t + ')"><title>' + o.k + ' ' + TYPE[t] + ': ' + o[t] + '</title></rect>'; }); s += '<text x="' + (i * bw + bw / 2) + '" y="186" text-anchor="middle" class="mute">' + o.k.slice(5) + '/' + o.k.slice(2, 4) + '</text>'; });
    s += '</svg><div class="small row"><span class="t-joiner">&#9632; Joiners</span><span class="t-leaver">&#9632; Leavers</span><span class="t-change">&#9632; Changes</span></div>';
    return s + '<details class="tblv"><summary>Show as table</summary><div class="scroll"><table class="tbl"><tr><th>Month</th><th>Joiners</th><th>Leavers</th><th>Changes</th></tr>' + data.map(function (o) { return '<tr><td>' + o.k + '</td><td>' + o.joiner + '</td><td>' + o.leaver + '</td><td>' + o.change + '</td></tr>'; }).join('') + '</table></div></details>';
  }

  /* ---------- pages ---------- */
  var NAV = [['', 'Overview'], ['cases', 'Cases'], ['tasks', 'Tasks'], ['assets', 'Assets'], ['templates', 'Templates'], ['calendar', 'Calendar']];
  function newBtn() { return '<button class="btn pri" data-act="newcase" type="button">New case</button>'; }
  function openTasks() { var r = []; db.cases.forEach(function (c) { if (c.status === 'open') c.tasks.forEach(function (t) { if (t.status === 'open') r.push({ c: c, t: t }); }); }); return r; }
  function pageOverview() {
    var oc = db.cases.filter(function (c) { return c.status === 'open'; }), ot = openTasks(), od = ot.filter(function (x) { return x.t.due < TODAY; });
    var blocked = oc.filter(function (c) { return caseState(c) === 'blocked'; }), col = collectList(), soon = oc.filter(function (c) { return c.type === 'joiner' && c.date >= TODAY && c.date <= J.addDays(TODAY, 14); });
    var byTeam = J.TEAMS.map(function (t) { return { t: t, n: od.filter(function (x) { return x.t.team === t.id; }).length }; });
    var mx = Math.max.apply(null, byTeam.map(function (x) { return x.n; }).concat(1));
    return '<div class="head"><div><h1>Overview</h1><p class="sub">Today is ' + fmtD(TODAY) + '. Three group companies, ' + db.people.length + ' people.</p></div>' + newBtn() + '</div>' +
      '<div class="grid g4"><a class="card kpi" href="#/cases"><b>' + oc.length + '</b><span>Open cases</span></a><a class="card kpi ' + (od.length ? 'bad' : '') + '" href="#/tasks"><b>' + od.length + '</b><span>Overdue tasks</span></a><a class="card kpi ' + (blocked.length ? 'bad' : '') + '" href="#/cases"><b>' + blocked.length + '</b><span>Blocked leavers</span></a><a class="card kpi ' + (col.length ? 'warn' : '') + '" href="#/assets/collect"><b>' + col.length + '</b><span>Leavers holding equipment</span></a><a class="card kpi" href="#/calendar"><b>' + soon.length + '</b><span>Joiners in the next 14 days</span></a></div>' +
      '<div class="card" style="margin-top:12px"><h2>Next four weeks</h2>' + timeline() + '</div>' +
      '<div class="grid g2" style="margin-top:12px"><div class="card"><h2>Overdue tasks by team</h2>' + byTeam.map(function (x) { return '<div class="row" style="margin:5px 0"><a style="width:90px" href="#/tasks/' + x.t.id + '">' + esc(x.t.name) + '</a><div class="bar" style="flex:1"><i style="width:' + x.n / mx * 100 + '%;background:var(--bad)"></i></div><b>' + x.n + '</b></div>'; }).join('') + '</div>' +
      '<div class="card"><h2>Assets to collect</h2>' + (col.length ? col.slice(0, 8).map(function (c) { return '<div style="margin:5px 0">' + caseLink(c) + ' ' + esc(person(c).name) + ' <span class="mute">(' + held(c.pid).map(function (a) { return a.tag; }).join(', ') + ')</span> ' + (c.date < TODAY ? pill('bad', 'left ' + fmtD(c.date)) : pill('', 'leaves ' + fmtD(c.date))) + '</div>'; }).join('') : '<p class="mute">Nothing outstanding.</p>') + '</div></div>' +
      '<div class="card" style="margin-top:12px"><h2>Cases per month</h2>' + monthChart() + '</div>';
  }
  function filteredCases() {
    var f = ui.cases, q = f.q.toLowerCase();
    var list = db.cases.filter(function (c) { return (!f.type || c.type === f.type) && (!f.state || (f.state === 'active' ? c.status === 'open' : caseState(c) === f.state)) && (!f.co || c.co === f.co) && (!q || (c.no + ' ' + person(c).name + ' ' + locName(c.loc) + ' ' + c.role).toLowerCase().indexOf(q) >= 0); });
    var key = { date: function (c) { return c.date; }, no: function (c) { return c.no; }, name: function (c) { return person(c).name; }, type: function (c) { return c.type; }, loc: function (c) { return locName(c.loc); }, pct: function (c) { return stats(c).pct; }, state: function (c) { return caseState(c); } }[f.sort] || function (c) { return c.date; };
    return list.sort(function (a, b) { var x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * f.dir; });
  }
  function pageCases() {
    var f = ui.cases, list = filteredCases(), th = function (k, t) { return '<th><button data-act="sortc" data-k="' + k + '">' + t + (f.sort === k ? (f.dir > 0 ? ' ▲' : ' ▼') : '') + '</button></th>'; };
    return '<div class="head"><div><h1>Cases</h1><p class="sub">' + list.length + ' of ' + db.cases.length + ' cases</p></div><div class="row"><button class="btn" data-act="csvcases" type="button">Export CSV</button>' + newBtn() + '</div></div>' +
      '<div class="row card" style="margin-bottom:12px"><input type="search" placeholder="Search name, number, location" aria-label="Search" value="' + esc(f.q) + '" data-inp="cq"><select aria-label="Type" data-chg="cf" data-k="type">' + opt('', 'All types') + Object.keys(TYPE).map(function (k) { return opt(k, TYPE[k], f.type === k); }).join('') + '</select><select aria-label="State" data-chg="cf" data-k="state">' + opt('', 'Any state') + opt('active', 'All open', f.state === 'active') + Object.keys(STATE_LBL).map(function (k) { return opt(k, STATE_LBL[k], f.state === k); }).join('') + '</select><select aria-label="Company" data-chg="cf" data-k="co">' + opt('', 'All companies') + J.COMPANIES.map(function (k) { return opt(k.id, k.name, f.co === k.id); }).join('') + '</select></div>' +
      '<div class="card scroll"><table class="tbl"><thead><tr>' + th('no', 'Case') + th('name', 'Person') + th('type', 'Type') + th('date', 'Date') + th('loc', 'Location') + th('pct', 'Progress') + th('state', 'State') + '</tr></thead><tbody>' +
      list.slice(0, 200).map(function (c) { var s = stats(c); return '<tr><td>' + caseLink(c) + '</td><td>' + esc(person(c).name) + '<div class="small mute">' + esc(c.role) + '</div></td><td class="t-' + c.type + '">' + TYPE[c.type] + '</td><td>' + fmtD(c.date) + '</td><td>' + esc(locName(c.loc)) + '</td><td><div class="bar"><i style="width:' + s.pct + '%"></i></div><span class="small mute">' + s.done + '/' + s.total + '</span></td><td>' + statePill(c) + '</td></tr>'; }).join('') + (list.length ? '' : '<tr><td colspan="7" class="mute">No cases match.</td></tr>') + '</tbody></table></div>';
  }
  function taskRow(c, t, showCase) {
    var od = t.status === 'open' && t.due < TODAY, dis = c.status === 'closed';
    return '<div class="task ' + t.status + '"><button class="chk ' + (t.status === 'done' ? 'on' : '') + '" data-act="tick" data-c="' + c.id + '" data-t="' + t.id + '" aria-label="' + (t.status === 'done' ? 'Reopen' : 'Mark done') + ': ' + esc(t.title) + '" aria-pressed="' + (t.status === 'done') + '"' + (t.status === 'na' || dis ? ' disabled' : '') + '>' + (t.status === 'done' ? '✓' : '') + '</button>' +
      '<div><div class="ttl">' + esc(t.title) + (t.required ? '' : ' <span class="small mute">(optional)</span>') + (t.asset ? ' ' + pill('', 'issues ' + t.asset) : '') + (t.collect ? ' ' + pill('warn', 'collects equipment') : '') + '</div><div class="small mute">' + (showCase ? caseLink(c) + ' ' + esc(person(c).name) + ' · ' : '') + esc(teamName(t.team)) + ' · due <span class="' + (od ? 'od' : '') + '">' + fmtD(t.due) + '</span>' + (t.text ? ' · ' + esc(t.text) : '') + (t.status === 'done' && t.by ? ' · ' + esc(t.by) + ' ' + fmtDT(t.at) : '') + (t.status === 'na' ? ' · ' + esc(t.why || 'Not needed') : '') + '</div></div>' +
      '<div class="tact">' + (t.status === 'open' && !dis ? '<button class="btn small ghost" data-act="na" data-c="' + c.id + '" data-t="' + t.id + '">Not needed</button>' : t.status === 'na' && !dis ? '<button class="btn small ghost" data-act="unna" data-c="' + c.id + '" data-t="' + t.id + '">Needed</button>' : '') + '</div></div>';
  }
  function pageCase(parts) {
    var c = IX.c[parts[1]]; if (!c) return '<h1>Case not found</h1><p><a href="#/cases">Back to cases</a></p>';
    var p = person(c), s = stats(c), g = ui.case.group, groups = {}, order = [];
    c.tasks.slice().sort(function (a, b) { return a.due < b.due ? -1 : a.due > b.due ? 1 : 0; }).forEach(function (t) { var k = g === 'team' ? teamName(t.team) : fmtD(t.due); if (!groups[k]) { groups[k] = []; order.push(k); } groups[k].push(t); });
    if (g === 'team') order.sort(function (a, b) { return J.TEAMS.map(function (t) { return t.name; }).indexOf(a) - J.TEAMS.map(function (t) { return t.name; }).indexOf(b); });
    var eq = held(c.pid);
    return '<p class="small"><a href="#/cases">&larr; Cases</a></p><div class="head"><div><h1>' + esc(p.name) + ' <span class="t-' + c.type + '">· ' + TYPE[c.type] + '</span></h1><p class="sub">' + esc(c.no) + ' · ' + esc(c.role) + ' · ' + esc(locName(c.loc)) + ' (' + esc(coName(c.co)) + ') · ' + fmtD(c.date) + ' · ' + esc(p.email) + '</p>' + (c.to ? '<p class="sub">Moves to ' + esc(c.to.role) + ', ' + esc(locName(c.to.loc)) + '</p>' : '') + '</div><div class="row">' + statePill(c) + (c.status === 'open' ? '<button class="btn" data-act="cdate" data-c="' + c.id + '">Change date</button><button class="btn pri" data-act="close" data-c="' + c.id + '">Close case</button>' : '<button class="btn" data-act="reopen" data-c="' + c.id + '">Reopen case</button>') + '<button class="btn" data-act="print">Print checklist</button></div></div>' +
      (c.override ? '<div class="card" style="background:var(--warnbg);margin-bottom:12px"><b>Closed with override</b> by ' + esc(c.override.by) + ': ' + esc(c.override.reason) + '</div>' : '') +
      '<div class="card" style="margin-bottom:12px"><div class="row" style="justify-content:space-between"><b>' + s.done + ' of ' + s.total + ' tasks done</b><span class="row">Group by <button class="btn small ' + (g === 'team' ? 'pri' : '') + '" data-act="group" data-g="team">Team</button><button class="btn small ' + (g === 'date' ? 'pri' : '') + '" data-act="group" data-g="date">Date</button></span></div><div class="bar" style="margin-top:6px"><i style="width:' + s.pct + '%"></i></div></div>' +
      '<div class="grid g2"><div class="card"><h2>Checklist</h2>' + order.map(function (k) { return '<h3>' + esc(k) + '</h3>' + groups[k].map(function (t) { return taskRow(c, t); }).join(''); }).join('') + '</div><div><div class="card"><h2>Equipment held</h2>' + (eq.length ? eq.map(function (a) { return '<div class="row" style="justify-content:space-between;margin:4px 0"><span>' + esc(a.tag) + ' <span class="mute small">' + esc(J.typeOf(a.type).name + ' · ' + a.model) + '</span></span>' + (c.status === 'open' ? '<button class="btn small" data-act="aret" data-a="' + a.id + '">Return</button>' : '') + '</div>'; }).join('') : '<p class="mute">Nothing issued.</p>') + '</div><div class="card" style="margin-top:12px"><h2>Activity log</h2>' + c.log.slice().reverse().map(function (l) { return '<div class="small" style="margin:5px 0"><span class="mute">' + fmtDT(l.at) + ' · ' + esc(l.by) + '</span><br>' + esc(l.msg) + '</div>'; }).join('') + '</div></div></div>' + printSheet(c);
  }
  function printSheet(c) {
    return '<div class="print-sheet"><h1>' + esc(c.no + ' · ' + TYPE[c.type] + ': ' + person(c).name) + '</h1><p>' + esc(c.role + ', ' + locName(c.loc)) + ' · date ' + fmtD(c.date) + '</p><table><tr><th>Done</th><th>Task</th><th>Team</th><th>Due</th><th>Signature</th></tr>' + c.tasks.filter(function (t) { return t.status !== 'na'; }).map(function (t) { return '<tr><td>' + (t.status === 'done' ? '&#10003;' : '&#9744;') + '</td><td>' + esc(t.title) + '</td><td>' + esc(teamName(t.team)) + '</td><td>' + fmtD(t.due) + '</td><td></td></tr>'; }).join('') + '</table></div>';
  }
  function pageTasks(parts) {
    var team = parts[1] || '', tab = ui.tasks.tab, all = openTasks().filter(function (x) { return !team || x.t.team === team; });
    var done = []; db.cases.forEach(function (c) { if (c.status === 'open') c.tasks.forEach(function (t) { if (t.status === 'done' && (!team || t.team === team)) done.push({ c: c, t: t }); }); });
    var sets = { overdue: all.filter(function (x) { return x.t.due < TODAY; }), week: all.filter(function (x) { return x.t.due >= TODAY && x.t.due <= J.addDays(TODAY, 7); }), all: all, done: done.sort(function (a, b) { return a.t.at < b.t.at ? 1 : -1; }).slice(0, 100) };
    var list = sets[tab].slice().sort(function (a, b) { return a.t.due < b.t.due ? -1 : 1; }).slice(0, 150), sel = ui.tasks.sel;
    var TL = [['overdue', 'Overdue'], ['week', 'Next 7 days'], ['all', 'All open'], ['done', 'Done']];
    return '<div class="head"><div><h1>Tasks' + (team ? ': ' + esc(teamName(team)) : '') + '</h1><p class="sub">Tasks of open cases, grouped by who has to do them.</p></div></div>' +
      '<div class="tabs"><a href="#/tasks"' + (!team ? ' aria-current="page"' : '') + '>All teams</a>' + J.TEAMS.map(function (t) { return '<a href="#/tasks/' + t.id + '"' + (team === t.id ? ' aria-current="page"' : '') + '>' + esc(t.name) + '</a>'; }).join('') + '</div>' +
      '<div class="tabs">' + TL.map(function (x) { return '<a href="#/tasks' + (team ? '/' + team : '') + '" data-act="ttab" data-k="' + x[0] + '"' + (tab === x[0] ? ' aria-current="page"' : '') + '>' + x[1] + ' (' + sets[x[0]].length + ')</a>'; }).join('') + '</div>' +
      (tab !== 'done' ? '<div class="row" style="margin-bottom:8px"><button class="btn small" data-act="bulk">Mark selected done</button><span class="small mute">Equipment tasks are skipped in bulk.</span></div>' : '') +
      '<div class="card">' + (list.length ? list.map(function (x) { return '<div class="row" style="align-items:flex-start;flex-wrap:nowrap">' + (tab !== 'done' ? '<input type="checkbox" style="margin-top:12px" aria-label="Select" data-chg="tsel" data-c="' + x.c.id + '" data-t="' + x.t.id + '"' + (sel[x.c.id + '/' + x.t.id] ? ' checked' : '') + '>' : '') + '<div style="flex:1;min-width:0">' + taskRow(x.c, x.t, true) + '</div></div>'; }).join('') : '<p class="mute">Nothing here.</p>') + '</div>';
  }
  function pageAssets(parts) {
    var sub = parts[1] || 'register', f = ui.assets;
    var tabs = '<div class="tabs">' + [['register', 'Register'], ['collect', 'To collect'], ['history', 'History']].map(function (x) { return '<a href="#/assets/' + x[0] + '"' + (sub === x[0] ? ' aria-current="page"' : '') + '>' + x[1] + '</a>'; }).join('') + '</div>';
    var body = '';
    if (sub === 'collect') {
      var col = collectList();
      body = '<div class="card">' + (col.length ? col.map(function (c) { return '<div style="margin:8px 0">' + caseLink(c) + ' <b>' + esc(person(c).name) + '</b> ' + (c.date < TODAY ? pill('bad', 'left ' + fmtD(c.date)) : pill('', 'leaves ' + fmtD(c.date))) + '<div class="small">' + held(c.pid).map(function (a) { return esc(a.tag + ' (' + J.typeOf(a.type).name + ')'); }).join(', ') + '</div></div>'; }).join('') : '<p class="mute">No leaver holds equipment.</p>') + '</div>';
    } else if (sub === 'history') {
      var ev = []; db.assets.forEach(function (a) { a.log.forEach(function (l) { ev.push({ a: a, l: l }); }); }); ev.sort(function (x, y) { return x.l.at < y.l.at ? 1 : -1; });
      body = '<div class="card scroll"><table class="tbl"><tr><th>When</th><th>Item</th><th>Event</th><th>Person</th><th>By</th></tr>' + ev.slice(0, 150).map(function (x) { return '<tr><td>' + fmtDT(x.l.at) + '</td><td>' + esc(x.a.tag) + '</td><td>' + esc(x.l.ev) + '</td><td>' + esc(x.l.who && IX.p[x.l.who] ? IX.p[x.l.who].name : '') + '</td><td>' + esc(x.l.by) + '</td></tr>'; }).join('') + '</table></div>';
    } else {
      var q = f.q.toLowerCase(), list = db.assets.filter(function (a) { var p = IX.p[a.holder]; return (!f.type || a.type === f.type) && (!f.status || a.status === f.status) && (!q || (a.tag + ' ' + a.model + ' ' + (p ? p.name : '')).toLowerCase().indexOf(q) >= 0); });
      body = '<div class="row card" style="margin-bottom:12px"><input type="search" placeholder="Search tag, model, holder" aria-label="Search" value="' + esc(f.q) + '" data-inp="aq"><select aria-label="Type" data-chg="af" data-k="type">' + opt('', 'All types') + J.ASSET_TYPES.map(function (t) { return opt(t.id, t.name, f.type === t.id); }).join('') + '</select><select aria-label="Status" data-chg="af" data-k="status">' + opt('', 'Any status') + ['issued', 'stock', 'retired'].map(function (s) { return opt(s, s, f.status === s); }).join('') + '</select><button class="btn" data-act="csvassets">Export CSV</button></div><div class="card scroll"><table class="tbl"><tr><th>Tag</th><th>Type</th><th>Model</th><th>Status</th><th>Holder</th><th></th></tr>' + list.slice(0, 200).map(function (a) { var p = IX.p[a.holder]; return '<tr><td>' + esc(a.tag) + '</td><td>' + esc(J.typeOf(a.type).name) + '</td><td>' + esc(a.model) + '</td><td>' + pill(a.status === 'issued' ? '' : a.status === 'stock' ? 'ok' : 'na', a.status) + '</td><td>' + esc(p ? p.name : '') + (p && p.status === 'left' ? ' ' + pill('bad', 'left') : '') + '</td><td>' + (a.status === 'issued' ? '<button class="btn small" data-act="aret" data-a="' + a.id + '">Return</button>' : a.status === 'stock' ? '<button class="btn small" data-act="aiss" data-a="' + a.id + '">Issue</button>' : '') + '</td></tr>'; }).join('') + '</table></div><p class="small mute">' + list.length + ' items</p>';
    }
    return '<div class="head"><div><h1>Assets</h1><p class="sub">Laptops, phones, tablets, scanners, cards and keys.</p></div></div>' + tabs + body;
  }
  function pageTemplates(parts) {
    var cur = IX.tpl[parts[1]] || null;
    var list = '<div class="tabs">' + db.templates.map(function (t) { return '<a href="#/templates/' + t.id + '"' + (cur && cur.id === t.id ? ' aria-current="page"' : '') + '>' + esc(t.name) + '</a>'; }).join('') + '</div>';
    if (!cur) return '<div class="head"><div><h1>Templates</h1><p class="sub">Checklists copied into each new case. Editing a template only affects new cases.</p></div></div>' + list + '<p class="mute">Pick a template to edit.</p>';
    var anchor = ui.tpl.anchor || J.workday(J.addDays(TODAY, 14), 1);
    return '<div class="head"><div><h1>' + esc(cur.name) + '</h1><p class="sub">Offsets are calendar days from the case date; weekend due dates move to the nearest working day.</p></div><div class="row"><label class="row small">Preview date <input type="date" value="' + anchor + '" data-chg="tplanchor"></label><button class="btn" data-act="tpladd" data-id="' + cur.id + '">Add item</button></div></div>' + list +
      '<div class="card scroll"><table class="tbl"><tr><th>Title</th><th>Team</th><th>Offset</th><th>Req.</th><th>Rules</th><th>Due (preview)</th><th></th></tr>' + cur.items.map(function (it, i) { return '<tr><td><input value="' + esc(it.title) + '" aria-label="Title" data-chg="tpl" data-id="' + cur.id + '" data-i="' + i + '" data-k="title" style="width:100%;min-width:180px"></td><td><select aria-label="Team" data-chg="tpl" data-id="' + cur.id + '" data-i="' + i + '" data-k="team">' + J.TEAMS.map(function (t) { return opt(t.id, t.name, t.id === it.team); }).join('') + '</select></td><td><input type="number" style="width:70px" aria-label="Offset" value="' + it.offset + '" data-chg="tpl" data-id="' + cur.id + '" data-i="' + i + '" data-k="offset"></td><td><input type="checkbox" aria-label="Required"' + (it.required ? ' checked' : '') + ' data-chg="tpl" data-id="' + cur.id + '" data-i="' + i + '" data-k="required"></td><td class="small mute">' + [it.onlyRoles ? 'only ' + it.onlyRoles.join('/') : '', it.skipFor ? 'skip ' + it.skipFor.join('/') : '', it.asset ? 'issues ' + it.asset : '', it.collect ? 'collects' : ''].filter(Boolean).join('; ') + '</td><td>' + fmtD(J.dueFor(anchor, it.offset)) + ' <span class="small mute">' + ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][J.dow(J.dueFor(anchor, it.offset))] + '</span></td><td><button class="btn small danger" data-act="tpldel" data-id="' + cur.id + '" data-i="' + i + '" aria-label="Remove item">&times;</button></td></tr>'; }).join('') + '</table></div>';
  }
  function pageCalendar() {
    var m = ui.cal.m || TODAY.slice(0, 7), y = +m.slice(0, 4), mo = +m.slice(5, 7), first = m + '-01', start = J.addDays(first, -J.dow(first)), pm = mo === 1 ? (y - 1) + '-12' : y + '-' + String(mo - 1).padStart(2, '0'), nm = mo === 12 ? (y + 1) + '-01' : y + '-' + String(mo + 1).padStart(2, '0');
    var ev = {}; db.cases.forEach(function (c) { (ev[c.date] = ev[c.date] || []).push('<a class="t-' + c.type + '" href="#/cases/' + c.id + '">' + esc(person(c).name) + '</a>'); if (c.status === 'open') c.tasks.forEach(function (t) { if (t.key && t.status === 'open') (ev[t.due] = ev[t.due] || []).push('<a class="mute" href="#/cases/' + c.id + '" title="' + esc(t.title) + '">◦ ' + esc(t.title) + '</a>'); }); });
    var cells = ''; for (var i = 0; i < 42; i++) { var d = J.addDays(start, i), out = d.slice(0, 7) !== m; if (i >= 35 && out) break; cells += '<div class="day' + (out ? ' out' : '') + (d === TODAY ? ' today' : '') + '"><b>' + +d.slice(8) + '</b>' + (ev[d] || []).slice(0, 4).join('') + ((ev[d] || []).length > 4 ? '<span class="mute">+' + (ev[d].length - 4) + ' more</span>' : '') + '</div>'; }
    return '<div class="head"><div><h1>Calendar</h1><p class="sub">Case dates and key tasks still open.</p></div><div class="row"><a class="btn" href="#/calendar" data-act="cal" data-m="' + pm + '">&larr;</a><b>' + m + '</b><a class="btn" href="#/calendar" data-act="cal" data-m="' + nm + '">&rarr;</a><a class="btn" href="#/calendar" data-act="cal" data-m="' + TODAY.slice(0, 7) + '">Today</a></div></div><div class="cal">' + ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(function (d) { return '<div class="dh">' + d + '</div>'; }).join('') + cells + '</div>';
  }
  var PAGES = { '': pageOverview, cases: pageCases, tasks: pageTasks, assets: pageAssets, templates: pageTemplates, calendar: pageCalendar };

  /* ---------- router ---------- */
  function route() { var h = location.hash.replace(/^#\/?/, ''); return h ? h.split('/') : ['']; }
  function rerender() {
    var parts = route(), seg = parts[0];
    if (!(seg in PAGES)) { location.replace('#/'); return; }
    $('#nav').innerHTML = NAV.map(function (n) { return '<a href="#/' + n[0] + '"' + (n[0] === seg ? ' aria-current="page"' : '') + '>' + n[1] + '</a>'; }).join('');
    var m = $('#main'), y = window.scrollY, ae = document.activeElement, id = ae && ae.dataset && ae.dataset.inp, pos = ae && ae.selectionStart;
    m.innerHTML = PAGES[seg](parts);
    if (id) { var el = $('[data-inp="' + id + '"]'); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (e) {} } }
    window.scrollTo(0, y);
    document.title = 'Joiners & leavers';
  }
  function onRoute() { rerender(); window.scrollTo(0, 0); }

  /* ---------- events ---------- */
  var ACT = {
    newcase: function () { newCaseDialog('joiner'); },
    dlgclose: closeDlg,
    dlgback: function (el, e) { if (e.target === el) closeDlg(); },
    tick: function (el) { var c = IX.c[el.dataset.c]; tick(c, c.tasks.filter(function (t) { return t.id === el.dataset.t; })[0]); },
    na: function (el) { var c = IX.c[el.dataset.c], t = c.tasks.filter(function (t) { return t.id === el.dataset.t; })[0]; t.status = 'na'; t.by = actor(); t.why = 'Marked not needed by ' + actor() + '.'; log(c, 'Not needed: ' + t.title + '.'); commit(); },
    unna: function (el) { var c = IX.c[el.dataset.c], t = c.tasks.filter(function (t) { return t.id === el.dataset.t; })[0]; t.status = 'open'; t.by = ''; log(c, 'Needed again: ' + t.title + '.'); commit(); },
    close: function (el) { closeCase(IX.c[el.dataset.c]); },
    reopen: function (el) { reopenCase(IX.c[el.dataset.c]); },
    cdate: function (el) { dateDialog(IX.c[el.dataset.c]); },
    group: function (el) { ui.case.group = el.dataset.g; saveUi(); rerender(); },
    print: function () { window.print(); },
    sortc: function (el) { var f = ui.cases; if (f.sort === el.dataset.k) f.dir = -f.dir; else { f.sort = el.dataset.k; f.dir = 1; } saveUi(); rerender(); },
    csvcases: function () { csv([['Case', 'Person', 'Type', 'Date', 'Location', 'Company', 'Progress %', 'State']].concat(filteredCases().map(function (c) { return [c.no, person(c).name, TYPE[c.type], c.date, locName(c.loc), coName(c.co), stats(c).pct, STATE_LBL[caseState(c)]]; })), 'cases.csv'); },
    csvassets: function () { csv([['Tag', 'Type', 'Model', 'Status', 'Holder']].concat(db.assets.map(function (a) { return [a.tag, a.type, a.model, a.status, IX.p[a.holder] ? IX.p[a.holder].name : '']; })), 'assets.csv'); },
    ttab: function (el) { ui.tasks.tab = el.dataset.k; saveUi(); rerender(); },
    bulk: function () {
      var n = 0, skipped = 0; Object.keys(ui.tasks.sel).forEach(function (k) { var p = k.split('/'), c = IX.c[p[0]], t = c && c.tasks.filter(function (t) { return t.id === p[1]; })[0]; if (!t || t.status !== 'open') return; if (t.asset || t.collect) { skipped++; return; } applyDone(c, t); n++; });
      ui.tasks.sel = {}; saveUi(); commit(n + ' task(s) marked done' + (skipped ? ', ' + skipped + ' equipment task(s) skipped' : '') + '.');
    },
    aret: function (el) { var a = IX.a[el.dataset.a]; J.returnAsset(db, a, TODAY, actor(), 'Manual return'); var c = IX.openCase[a.holder]; commit(a.tag + ' returned.'); },
    aiss: function (el) { assetIssueDialog(IX.a[el.dataset.a]); },
    tpladd: function (el) { var t = IX.tpl[el.dataset.id]; t.items.push({ team: 'HR', offset: 0, required: false, title: 'New task', text: '' }); commit('Item added. Only new cases use it.'); },
    tpldel: function (el) { var t = IX.tpl[el.dataset.id]; t.items.splice(+el.dataset.i, 1); commit('Item removed.'); },
    cal: function (el) { ui.cal.m = el.dataset.m; saveUi(); rerender(); }
  };
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]'); if (!el || el.tagName === 'FORM') return;
    var f = ACT[el.dataset.act]; if (f) { if (el.tagName !== 'A') e.preventDefault(); f(el, e); }
  });
  document.addEventListener('submit', function (e) { if (e.target.dataset && e.target.dataset.act === 'dlgform') { e.preventDefault(); if (dlgFn) dlgFn(formData(e.target)); } });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && dlgFn) closeDlg(); });
  document.addEventListener('change', function (e) {
    var el = e.target, k = el.dataset && el.dataset.chg; if (!k) return;
    if (k === 'actor') { ui.actor = el.value; saveUi(); }
    else if (k === 'cf') { ui.cases[el.dataset.k] = el.value; saveUi(); rerender(); }
    else if (k === 'af') { ui.assets[el.dataset.k] = el.value; saveUi(); rerender(); }
    else if (k === 'tsel') { var key = el.dataset.c + '/' + el.dataset.t; if (el.checked) ui.tasks.sel[key] = 1; else delete ui.tasks.sel[key]; saveUi(); }
    else if (k === 'tplanchor') { ui.tpl.anchor = el.value; saveUi(); rerender(); }
    else if (k === 'tpl') { var t = IX.tpl[el.dataset.id], it = t.items[+el.dataset.i], kk = el.dataset.k; it[kk] = kk === 'offset' ? (parseInt(el.value, 10) || 0) : kk === 'required' ? el.checked : el.value; commit(); }
    else if (k === 'nctype' || k === 'ncloc' || k === 'ncperson') { var f = formData(el.form); newCaseDialog(f.type, { name: f.name, role: f.role, loc: k === 'ncperson' ? '' : f.loc, contract: f.contract, pid: f.pid, date: f.date, toRole: f.toRole, toLoc: f.toLoc }); }
  });
  document.addEventListener('input', function (e) {
    var k = e.target.dataset && e.target.dataset.inp; if (!k) return;
    if (k === 'cq') { ui.cases.q = e.target.value; saveUi(); rerender(); } else if (k === 'aq') { ui.assets.q = e.target.value; saveUi(); rerender(); }
  });
  $('#resetBtn').addEventListener('click', function () {
    dlg('Reset demo data?', '<p>This deletes every change you made in this browser and regenerates the demo company for today.</p>', function () {
      db = J.generate(TODAY); ensureSchema(); reindex(); closeDlg();
      (memOnly ? Promise.resolve() : idbReset().then(function () { return idbPut(db); })).then(announce).catch(storageFailed); rerender(); toast('Demo data reset.');
    }, { ok: 'Reset' });
  });

  /* ---------- boot ---------- */
  function fillActors() { $('#actorSel').innerHTML = Object.keys(J.ACTOR_BY_TEAM).map(function (k) { return opt(k, J.ACTOR_BY_TEAM[k] + '', k === ui.actor); }).join(''); }
  function boot() {
    fillActors();
    var sync = window.AdrialSync && AdrialSync.attach({ app: 'onboarding', getSnapshot: function () { return db; }, applySnapshot: function () {} });
    if (sync && sync.mountPanel) sync.mountPanel($('#syncPanel'));
    idbGet().catch(function () { storageFailed(); return null; }).then(function (d) {
      if (validDb(d)) db = d; else { db = J.generate(TODAY); if (!memOnly) idbPut(db).catch(storageFailed); }
      ensureSchema(); reindex(); window.addEventListener('hashchange', onRoute); onRoute();
      setInterval(function () { var t = J.todayLj(); if (t !== TODAY) location.reload(); }, 60000);
    });
  }
  boot();
})();
