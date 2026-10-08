/* Contracts: shared state, storage, helpers and derived values. Attaches everything to window.CA. */
(function () {
  'use strict';
  var X = window.ContractsData, D = window.ContractDates, CA = window.CA = { X: X, D: D };
  CA.TODAY = X.todayLj(); CA.db = null; CA.memOnly = false; CA.pending = false;
  CA.$ = function (s, r) { return (r || document).querySelector(s); };
  CA.$$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  CA.esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var esc = CA.esc, TODAY = CA.TODAY;
  CA.fmtD = function (s) { if (!s) return ''; var p = s.slice(0, 10).split('-'); return +p[2] + '.' + +p[1] + '.' + p[0]; };
  CA.money = function (n, cur) { try { return new Intl.NumberFormat('en-GB', { style: 'currency', currency: cur || 'EUR', maximumFractionDigits: n >= 1000 ? 0 : 2 }).format(n); } catch (e) { return Math.round(n) + ' ' + cur; } };
  CA.eur = function (n) { return CA.money(n, 'EUR'); };
  CA.opt = function (v, t, sel) { return '<option value="' + esc(v) + '"' + (sel ? ' selected' : '') + '>' + esc(t) + '</option>'; };
  CA.toast = function (m) { var t = CA.$('#toast'); t.textContent = m; t.className = 'show'; clearTimeout(CA.toast.t); CA.toast.t = setTimeout(function () { t.className = ''; }, 3200); };
  CA.catName = function (id) { var c = X.CATEGORIES.filter(function (k) { return k.id === id; })[0]; return c ? c.name : id; };
  CA.pill = function (cls, t) { return '<span class="pill ' + cls + '">' + esc(t) + '</span>'; };

  /* ---------- UI prefs ---------- */
  var UIKEY = 'adrial-contracts-ui', UIDEF = { list: { q: '', cat: '', status: '', decision: '', company: '', due: '', sort: 'deadline', dir: 1, page: 0 }, cal: { m: '', types: {} }, spend: { by: 'category' }, notify: false };
  CA.ui = (function () { var o = {}; try { o = JSON.parse(localStorage.getItem(UIKEY) || '{}') || {}; } catch (e) {} var r = {}; Object.keys(UIDEF).forEach(function (k) { r[k] = typeof UIDEF[k] === 'object' ? Object.assign({}, UIDEF[k], o[k] || {}) : (o[k] != null ? o[k] : UIDEF[k]); }); return r; })();
  CA.saveUi = function () { try { localStorage.setItem(UIKEY, JSON.stringify(CA.ui)); } catch (e) {} };

  /* ---------- IndexedDB: kv + files ---------- */
  var h = null;
  function open() { return h || (h = new Promise(function (res, rej) { var r = indexedDB.open('adrial-contracts', 1); r.onupgradeneeded = function () { var d = r.result; d.createObjectStore('kv'); d.createObjectStore('files', { keyPath: 'hash' }); }; r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; })); }
  function tx(store, mode, fn) { return open().then(function (d) { return new Promise(function (res, rej) { var t = d.transaction(store, mode), rq = fn(t.objectStore(store)); t.oncomplete = function () { res(rq && rq.result); }; t.onerror = t.onabort = function () { rej(t.error); }; }); }); }
  CA.kvGet = function () { return tx('kv', 'readonly', function (s) { return s.get('db'); }); };
  CA.kvPut = function (v) { return tx('kv', 'readwrite', function (s) { return s.put(v, 'db'); }); };
  CA.fileGet = function (hash) { return tx('files', 'readonly', function (s) { return s.get(hash); }); };
  CA.filePut = function (f) { return tx('files', 'readwrite', function (s) { return s.put(f); }); };
  CA.fileKeys = function () { return tx('files', 'readonly', function (s) { return s.getAllKeys(); }); };
  CA.fileDel = function (k) { return tx('files', 'readwrite', function (s) { return s.delete(k); }); };
  CA.fileClear = function () { return tx('files', 'readwrite', function (s) { return s.clear(); }); };
  CA.validDb = function (d) { return d && d.version === X.VERSION && Array.isArray(d.contracts) && d.settings; };
  var bc = null, timer = 0, chain = Promise.resolve(); try { bc = new BroadcastChannel('adrial-contracts'); } catch (e) {}
  CA.announce = function () { try { bc && bc.postMessage({ type: 'changed' }); } catch (e) {} };
  CA.storageFailed = function () { if (!CA.memOnly) { CA.memOnly = true; CA.toast('Browser storage is unavailable: changes are kept in memory only.'); } };
  CA.save = function () { CA.pending = true; clearTimeout(timer); timer = setTimeout(CA.flush, 250); };
  CA.flush = function () {
    clearTimeout(timer); timer = 0;
    if (CA.memOnly) { CA.pending = false; return Promise.resolve(); }
    chain = chain.then(function () { return CA.kvPut(JSON.parse(JSON.stringify(CA.db))); }).then(CA.announce).catch(CA.storageFailed).then(function () { if (!timer) CA.pending = false; });
    return chain;
  };
  if (bc) bc.onmessage = function (e) { if (!e.data || e.data.type !== 'changed' || CA.pending || CA.memOnly) return; CA.kvGet().then(function (d) { if (CA.validDb(d)) { CA.db = d; CA.reindex(); CA.rerender && CA.rerender(); } }); };

  /* ---------- schema, index, derived values ---------- */
  var cache = {};
  CA.reindex = function () { cache = {}; CA.IX = {}; CA.db.contracts.forEach(function (c) { CA.IX[c.id] = c; }); };
  CA.ensureSchema = function () {
    var S = CA.db.settings, changed = false;
    S.remind = S.remind || {}; S.handled = S.handled || {}; S.cpi = S.cpi == null ? 2.5 : S.cpi; S.me = S.me || 'Maja Novak';
    X.CATEGORIES.forEach(function (c) { if (S.remind[c.id] == null) { S.remind[c.id] = c.remind; changed = true; } });
    CA.db.contracts.forEach(function (c) {
      c.docs = c.docs || []; c.history = c.history || []; c.priceChanges = c.priceChanges || []; c.milestones = c.milestones || []; c.index = c.index || { mode: 'none' };
      while (c.priceChanges.length && c.priceChanges[0].date <= TODAY) { var p = c.priceChanges.shift(); c.history.push({ date: p.date, kind: 'price', text: 'Price step applied: ' + CA.money(c.amount, c.currency) + ' to ' + CA.money(p.amount, c.currency) + '.' }); c.amount = p.amount; changed = true; }
      if (c.status === 'ending' && c.endsOn && c.endsOn < TODAY) { c.status = 'ended'; c.history.push({ date: c.endsOn, kind: 'end', text: 'Contract ended.' }); changed = true; }
    });
    if (changed) CA.save();
  };
  var PER = { month: 12, quarter: 4, year: 1, once: 0 };
  CA.annualOf = function (amount, c) { return amount * (X.CURRENCIES[c.currency] || 1) * (PER[c.period] || 0); };
  CA.openWanted = function (c) { return c.type === 'open' && c.noticeEom && (c.decision === 'cancel' || c.decision === 'renegotiate'); };
  CA.info = function (c) {
    if (cache[c.id]) return cache[c.id];
    var nd = D.nextDeadline(c, TODAY), act = nd && (nd.kind !== 'open' || CA.openWanted(c)) ? nd : null;
    var next = null; (c.priceChanges || []).forEach(function (p) { if (!next || p.date < next.date) next = p; });
    var ix = D.indexDates(c, D.addDays(TODAY, 1), D.addDays(TODAY, 400), TODAY)[0];
    var np = next && (!ix || next.date <= ix) ? { date: next.date, amount: next.amount } : ix ? { date: ix, amount: null } : null;
    return (cache[c.id] = { nd: nd, act: act, nr: D.nextRenewal(c, TODAY), end: D.effectiveEnd(c, TODAY), annual: c.status === 'ended' || c.status === 'draft' ? 0 : CA.annualOf(c.amount, c), nextPrice: np });
  };
  CA.daysTo = function (d) { return D.daysBetween(TODAY, d); };
  CA.rel = function (d) { var n = CA.daysTo(d); return n === 0 ? 'today' : n === 1 ? 'tomorrow' : n > 0 ? 'in ' + n + ' days' : -n + ' days ago'; };
  CA.deadlineText = function (c, nd) {
    var s = CA.fmtD;
    if (!nd) return c.status === 'ending' ? 'Notice given: the contract ends on ' + s(c.endsOn) + '.' : c.status === 'ended' ? 'The contract has ended.' : c.status === 'draft' ? 'Draft: no deadline yet.' : c.noticeN === 0 ? 'No notice period: the contract renews automatically.' : 'No deadline left: the fixed term runs to ' + s(c.end) + ' and the decision date has passed.';
    var party = c.party;
    if (nd.kind === 'decide') return 'Decide by ' + s(nd.deadline) + ' (' + CA.rel(nd.deadline) + ') whether to extend or exit; the term ends on ' + s(nd.termEnd) + '.';
    if (nd.kind === 'open') return 'Open-ended: notice given today ends the contract on ' + s(nd.termEnd) + ' (deadline ' + s(nd.deadline) + ').';
    var l = nd.locked ? 'The deadline ' + s(nd.locked.deadline) + ' for the term ending ' + s(nd.locked.termEnd) + ' has passed, so it renews. ' : '';
    return l + 'Notice must reach ' + party + ' by ' + s(nd.deadline) + ' (' + CA.rel(nd.deadline) + ') to end the term on ' + s(nd.termEnd) + '.';
  };
  /* ---------- reminders ---------- */
  CA.reminders = function () {
    var out = [], S = CA.db.settings;
    CA.db.contracts.forEach(function (c) {
      if (c.status === 'ended' || c.status === 'draft') return;
      var i = CA.info(c), win = S.remind[c.category] || 60;
      if (i.act && i.act.deadline >= TODAY && CA.daysTo(i.act.deadline) <= win) out.push({ key: c.id + '|n|' + i.act.deadline, c: c, kind: 'notice', date: i.act.deadline, text: (i.act.kind === 'decide' ? 'Decide on extending ' : 'Notice deadline for ') + c.name });
      if (c.decisionBy && c.decisionBy >= TODAY && CA.daysTo(c.decisionBy) <= 7 && c.decision !== 'cancel') out.push({ key: c.id + '|d|' + c.decisionBy, c: c, kind: 'decision', date: c.decisionBy, text: 'Decision due: ' + c.name });
      c.milestones.forEach(function (m, k) { if (m.date >= TODAY && CA.daysTo(m.date) <= 7) out.push({ key: c.id + '|m' + k + '|' + m.date, c: c, kind: 'milestone', date: m.date, text: m.title + ': ' + c.name }); });
    });
    return out.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  };
  CA.dueReminders = function () { var H = CA.db.settings.handled; return CA.reminders().filter(function (r) { return !H[r.key]; }); };
  /* ---------- spend ---------- */
  CA.expectedEnd = function (c) {
    if (c.status === 'ended') return c.end || c.endsOn || '';
    if (c.status === 'ending') return c.endsOn;
    if (c.decision === 'cancel') { var nd = D.nextDeadline(c, TODAY); if (c.type === 'open') return D.earliestOpenEnd(c, TODAY).end; return nd && nd.locked ? nd.locked.termEnd : (D.effectiveEnd(c, TODAY) || ''); }
    return '';
  };
  CA.amountAt = function (c, date) {
    var a = c.amount; (c.priceChanges || []).forEach(function (p) { if (p.date <= date) a = p.amount; });
    if (c.index && c.index.mode === 'cpi') { var n = D.indexDates(Object.assign({}, c, { endsOn: '' }), D.addDays(TODAY, 1), date, TODAY).length; a *= Math.pow(1 + CA.db.settings.cpi / 100, n); }
    return a;
  };
  CA.projectYear = function (c, y) {
    if (c.status === 'draft' && c.start > y + '-12-31') return 0;
    var from = y + '-01-01', to = y + '-12-31', s = c.start > from ? c.start : from, e = CA.expectedEnd(c), eEnd = e && e < to ? e : to;
    if (eEnd < s) return 0;
    var frac = (D.daysBetween(s, eEnd) + 1) / (D.daysBetween(from, to) + 1);
    return CA.annualOf(CA.amountAt(c, y + '-06-30'), c) * frac;
  };
  /* ---------- commit / log ---------- */
  CA.commit = function (msg) { CA.reindex(); CA.save(); CA.rerender && CA.rerender(); if (msg) CA.toast(msg); };
  CA.csv = function (rows, name) {
    var s = rows.map(function (r) { return r.map(function (v) { v = String(v == null ? '' : v); return /[",\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(','); }).join('\r\n');
    CA.download(new Blob(['﻿' + s], { type: 'text/csv' }), name);
  };
  CA.download = function (blob, name) { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500); };
  /* ---------- modal ---------- */
  CA.dlgFn = null;
  CA.dlg = function (title, body, onSubmit, opts) {
    opts = opts || {};
    CA.$('#layers').innerHTML = '<div class="back" data-act="dlgback"><form class="dlg' + (opts.wide ? ' wide' : '') + '" role="dialog" aria-modal="true" aria-label="' + esc(title) + '" data-act="dlgform"><h2>' + esc(title) + '</h2>' + body + '<div class="row end"><button type="button" class="btn" data-act="dlgclose">' + (opts.noSubmit ? 'Close' : 'Cancel') + '</button>' + (opts.noSubmit ? '' : '<button class="btn pri" type="submit">' + esc(opts.ok || 'Save') + '</button>') + '</div></form></div>';
    CA.dlgFn = onSubmit; var f = CA.$('#layers input:not([type=checkbox]),#layers select,#layers textarea,#layers .btn'); if (f) f.focus();
  };
  CA.closeDlg = function () { CA.$('#layers').innerHTML = ''; CA.dlgFn = null; };
  CA.formData = function (form) { var o = {}; CA.$$('input,select,textarea', form).forEach(function (el) { if (el.name) o[el.name] = el.type === 'checkbox' ? el.checked : el.value; }); return o; };
})();
