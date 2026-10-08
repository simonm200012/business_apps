/* CRM app: storage, router, views, forms, board drag, bus, quotes, scoring, templates, digest, sync. */
(function () {
  'use strict';
  const D = window.CRMDATA, OWNERS = D.OWNERS, STAGES = D.STAGES, SEGMENTS = D.SEGMENTS, ACT_TYPES = D.ACT_TYPES, CPRODUCTS = D.PRODUCTS;
  const STAGE = {}, OWNER = {}, PRODUCT = {}, ACT_TYPE = {}, SEG = {};
  STAGES.forEach(s => STAGE[s.id] = s); OWNERS.forEach(o => OWNER[o.id] = o); CPRODUCTS.forEach(p => PRODUCT[p.id] = p); ACT_TYPES.forEach(a => ACT_TYPE[a.id] = a); SEGMENTS.forEach(s => SEG[s.id] = s);
  const OPEN = ['lead', 'qualified', 'proposal', 'negotiation'];
  const $ = (s, r) => (r || document).querySelector(s), $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const main = $('#main'), layer = $('#layer');
  const TAB_ID = Math.random().toString(36).slice(2);
  let db = null, ready = false, dirty = false, writing = false, writeP = null, saveT = 0, cache = null, silentNext = false, sync = null, pubT = 0, dupCache = null;
  let BUS = { catalog: [], customers: [], at: 0, ok: false }, modal = null, bc = null;

  /* ---------- helpers ---------- */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Math.round(n || 0));
  const money2 = n => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n || 0);
  const kfmt = n => Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : Math.abs(n) >= 1e3 ? Math.round(n / 1e3) + 'k' : String(Math.round(n));
  const p2 = n => (n < 10 ? '0' : '') + n;
  const iso = D.iso, pd = D.pd;
  const todayIso = () => iso(new Date());
  const addDays = (s, n) => { const d = pd(s); d.setDate(d.getDate() + n); return iso(d); };
  const fdate = s => { if (!s) return '–'; const a = String(s).slice(0, 10).split('-'); return a[2] + '.' + a[1] + '.' + a[0]; };
  const fts = ms => { const d = new Date(ms); return fdate(iso(d)) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()); };
  const diffDays = (a, b) => Math.round((pd(b) - pd(a)) / 864e5);
  const mondayOf = s => { const d = pd(s), w = (d.getDay() + 6) % 7; d.setDate(d.getDate() - w); return iso(d); };
  const monthOf = s => String(s).slice(0, 7);
  const monthLabel = m => ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m.slice(5, 7) - 1] + ' ' + m.slice(2, 4);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const toast = (m, ms) => { const t = $('#toast'), e = document.createElement('div'); e.textContent = m; t.appendChild(e); setTimeout(() => e.remove(), ms || 2800); };
  const tag = (t, tone) => '<span class="tag tone-' + (tone || 'gray') + '">' + esc(t) + '</span>';
  const stageTag = id => STAGE[id] ? tag(STAGE[id].name, STAGE[id].tone) : '';
  const segTag = id => SEG[id] ? tag(SEG[id].name, SEG[id].tone) : tag(id || '–');
  const ownerAv = id => OWNER[id] ? '<span class="av tone-' + OWNER[id].tone + '" title="' + esc(OWNER[id].name) + '">' + OWNER[id].initials + '</span>' : '';
  const ownerOpts = sel => OWNERS.map(o => '<option value="' + o.id + '"' + (o.id === sel ? ' selected' : '') + '>' + esc(o.name) + '</option>').join('');
  const uid = p => p + Math.random().toString(36).slice(2, 8);
  const nextId = () => ++db.seq;
  function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: type || 'text/csv' })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
  const csvCell = v => { v = v == null ? '' : String(v); return /[",\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const toCsv = (rows, cols) => cols.join(',') + '\n' + rows.map(r => cols.map(c => csvCell(r[c])).join(',')).join('\n');
  function parseCsv(t) {
    const rows = []; let row = [], cell = '', q = false; t = t.replace(/^﻿/, '');
    const sep = (t.split('\n')[0].match(/;/g) || []).length > (t.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (q) { if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
      else if (c === '"') q = true; else if (c === sep) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some(x => x !== '')) rows.push(row); row = []; }
      else cell += c;
    }
    row.push(cell); if (row.some(x => x !== '')) rows.push(row);
    if (!rows.length) return [];
    const h = rows[0].map(x => x.trim().toLowerCase());
    return rows.slice(1).map(r => { const o = {}; h.forEach((k, i) => o[k] = (r[i] || '').trim()); return o; });
  }

  /* ---------- UI prefs ---------- */
  const UIDEF = { me: '', co: { q: '', seg: '', own: '' }, ct: { q: '' }, dl: { q: '', stage: '', sort: 'updated', dir: -1 }, board: { q: '' }, act: { show: 'open', type: '', limit: 40 }, week: { offset: 0 }, tpl: { id: 0 }, digest: { offset: 0 } };
  let ui = JSON.parse(JSON.stringify(UIDEF));
  function loadUi() {
    try {
      const s = JSON.parse(localStorage.getItem('adrial-crm-ui') || '{}');
      Object.keys(UIDEF).forEach(k => {
        if (typeof s[k] !== typeof UIDEF[k]) return;
        if (typeof UIDEF[k] === 'object') Object.keys(UIDEF[k]).forEach(j => { if (typeof s[k][j] === typeof UIDEF[k][j]) ui[k][j] = s[k][j]; }); else ui[k] = s[k];
      });
    } catch (e) {}
    ui.act.limit = 40; ui.week.offset = 0; ui.digest.offset = 0;
  }
  function saveUi() { try { localStorage.setItem('adrial-crm-ui', JSON.stringify(ui)); } catch (e) {} }

  /* ---------- IndexedDB ---------- */
  function idb() {
    return new Promise(res => {
      if (!window.indexedDB) return res(null);
      const r = indexedDB.open('adrial-crm', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result); r.onerror = r.onblocked = () => res(null);
    });
  }
  const idbOp = (mode, fn) => idb().then(h => !h ? null : new Promise(res => {
    try { const t = h.transaction('kv', mode), rq = fn(t.objectStore('kv')); t.oncomplete = () => { h.close(); res(rq && rq.result !== undefined ? rq.result : true); }; t.onerror = t.onabort = () => { h.close(); res(null); }; } catch (e) { res(null); }
  }));
  const idbGet = () => idbOp('readonly', s => s.get('data')), idbPut = d => idbOp('readwrite', s => s.put(d, 'data')), idbClear = () => idbOp('readwrite', s => s.clear());
  const validDb = d => d && d.version === 1 && Array.isArray(d.companies) && Array.isArray(d.contacts) && Array.isArray(d.deals) && Array.isArray(d.activities);
  async function loadDb() {
    let d = await idbGet();
    if (!validDb(d)) {
      d = null;
      try { const l = JSON.parse(localStorage.getItem('adrial-crm-data') || 'null'); if (validDb(l)) { d = l; localStorage.removeItem('adrial-crm-data'); } } catch (e) {}
      if (!d) d = D.generate(Date.now());
      db = d; migrate(db); silentNext = true; save(); return;
    }
    const needs = !d.quotes || !d.templates || !d.targets; db = migrate(d); if (needs) { silentNext = true; save(); }
  }
  function migrate(d) {
    d.notes = d.notes || []; d.dupIgnore = d.dupIgnore || []; d.seq = d.seq || 1000;
    const prng = D.mulberry32;
    if (!d.templates) d.templates = [
      { id: 1, name: 'Introduction', subject: 'Introduction: {{company}} and Adrial', body: 'Hello {{contact}},\n\nI am {{owner}} from Adrial. We help opticians and clinics run their practice and ordering in one place. I would like to show you how this could work for {{company}}.\n\nWould a 20-minute call this week suit you?\n\nBest regards,\n{{owner}}' },
      { id: 2, name: 'Follow-up after meeting', subject: 'Follow-up: {{deal}}', body: 'Hello {{contact}},\n\nThank you for your time. As agreed, I will send the proposal for "{{deal}}" (about {{value}}) shortly.\n\nPlease tell me if anything is missing.\n\nBest regards,\n{{owner}}' },
      { id: 3, name: 'Quote sent', subject: 'Your quote: {{deal}}', body: 'Hello {{contact}},\n\nattached is our quote for {{deal}}, total {{value}}. It is valid for 30 days.\n\nI am happy to walk you through the details.\n\nBest regards,\n{{owner}}' },
      { id: 4, name: 'Welcome (deal won)', subject: 'Welcome on board, {{company}}', body: 'Hello {{contact}},\n\nthank you for choosing Adrial. We will contact you about the kick-off for "{{deal}}" within two working days.\n\nBest regards,\n{{owner}}' },
      { id: 5, name: 'Re-activation', subject: 'Still interested, {{company}}?', body: 'Hello {{contact}},\n\nwe talked a while ago about "{{deal}}". Things may have changed, so I wanted to check whether this is still relevant for {{company}}.\n\nBest regards,\n{{owner}}' }];
    if (!d.targets) {
      d.targets = {}; const cm = monthOf(todayIso());
      OWNERS.forEach(o => { let sum = 0; d.deals.forEach(x => { if (x.ownerId !== o.id) return; const w = x.history.filter(h => h.stage === 'won')[0]; if (w && diffDays(w.date, todayIso()) <= 365 && monthOf(w.date) !== cm) sum += dealValue(x); }); d.targets[o.id] = Math.max(5000, Math.round(sum / 12 * 1.1 / 100) * 100); });
    }
    d.deals.forEach(x => { if (x.changes == null) x.changes = Math.floor(prng(x.id * 7919 + 13)() * 5); });
    if (!d.quotes) {
      d.quotes = [];
      d.deals.forEach(x => {
        if (['proposal', 'negotiation', 'won'].indexOf(x.stage) < 0) return;
        const r = prng(x.id * 104729 + 7)(); if (r > 0.55) return;
        const h = x.history.filter(y => y.stage === 'proposal' || y.stage === 'negotiation')[0] || x.history[x.history.length - 1];
        d.quotes.push({ id: d.quotes.length + 1 + 500000, dealId: x.id, no: 'Q-' + h.date.slice(0, 4) + '-' + p2(d.quotes.length + 1) + '-' + x.id, date: h.date, validUntil: addDays(h.date, 30), status: x.stage === 'won' ? 'Accepted' : 'Sent', discount: 0, note: '', lines: JSON.parse(JSON.stringify(x.lines)) });
      });
    }
    d.companies.forEach(c => { if (!c.tags) c.tags = []; });
    return d;
  }

  /* ---------- derived data cache ---------- */
  function M() {
    if (cache) return cache;
    const m = { co: new Map(), ct: new Map(), dl: new Map(), act: new Map(), note: new Map(), dealsByCo: {}, ctsByCo: {}, actsByDeal: {}, actsByCo: {}, actsByCt: {}, notesByDeal: {}, quotesByDeal: {} };
    const push = (o, k, v) => { if (k != null) (o[k] = o[k] || []).push(v); };
    db.companies.forEach(c => m.co.set(c.id, c)); db.contacts.forEach(c => { m.ct.set(c.id, c); push(m.ctsByCo, c.companyId, c); });
    db.deals.forEach(d => { m.dl.set(d.id, d); push(m.dealsByCo, d.companyId, d); });
    db.activities.forEach(a => { m.act.set(a.id, a); push(m.actsByDeal, a.dealId, a); push(m.actsByCo, a.companyId, a); push(m.actsByCt, a.contactId, a); });
    db.notes.forEach(n => { m.note.set(n.id, n); push(m.notesByDeal, n.dealId, n); });
    db.quotes.forEach(q => push(m.quotesByDeal, q.dealId, q));
    return cache = m;
  }
  const coName = id => { const c = M().co.get(id); return c ? c.name : '–'; };
  const ctName = id => { const c = M().ct.get(id); return c ? c.first + ' ' + c.last : '–'; };
  const mineOk = o => !ui.me || o.ownerId === ui.me;
  const isOpen = d => OPEN.indexOf(d.stage) >= 0;
  const lineTotal = l => (+l.qty || 0) * (+l.price || 0) * (1 - (+l.disc || 0) / 100);
  const dealValue = d => (d.lines || []).reduce((s, l) => s + lineTotal(l), 0);
  const weighted = d => dealValue(d) * STAGE[d.stage].prob / 100;
  const wonDate = d => { const h = d.history.filter(x => x.stage === 'won')[0]; return h ? h.date : null; };
  function actState(a) { if (a.done) return 'done'; const t = todayIso(); return a.due < t ? 'overdue' : a.due === t ? 'today' : 'upcoming'; }
  function dealScore(d) {
    if (!isOpen(d)) return 0; const acts = M().actsByDeal[d.id] || [], t = todayIso(); let s = STAGE[d.stage].prob * 0.45;
    s += Math.min(20, dealValue(d) / 1500); if (acts.some(a => !a.done && a.due >= t)) s += 12; if (acts.some(a => !a.done && a.due < t)) s -= 8;
    const age = (Date.now() - (d.updated || 0)) / 864e5; s += age <= 14 ? 15 : age <= 45 ? 7 : 0; if (d.contactId) s += 4; s += Math.min(8, (d.changes || 0) * 2);
    return clamp(Math.round(s), 0, 100);
  }
  function companyScore(c) {
    const ds = M().dealsByCo[c.id] || [], op = ds.filter(isOpen).map(dealScore), won = ds.filter(d => d.stage === 'won').reduce((s, d) => s + dealValue(d), 0);
    return clamp(Math.round((op.length ? Math.max.apply(null, op) * 0.75 : 10) + Math.min(25, won / 4000)), 0, 100);
  }
  const scoreTag = s => tag(s >= 70 ? 'Hot ' + s : s >= 45 ? 'Warm ' + s : 'Cold ' + s, s >= 70 ? 'red' : s >= 45 ? 'amber' : 'gray');

  /* ---------- save / commit ---------- */
  function save() { dirty = true; cache = null; dupCache = null; clearTimeout(saveT); saveT = setTimeout(flush, 250); }
  function flush() {
    if (!dirty) return writeP || Promise.resolve();
    if (writing) return writeP;
    dirty = false; writing = true; const silent = silentNext; silentNext = false;
    writeP = idbPut(db).then(ok => {
      writing = false;
      if (ok && !silent) { try { bc && bc.postMessage({ type: 'changed', from: TAB_ID }); } catch (e) {} sync && sync.changed && sync.changed(); }
      if (dirty) return flush();
    });
    return writeP;
  }
  const flushNow = () => { clearTimeout(saveT); return flush(); };
  function commit(msg) { save(); publishSoon(1500); if (msg) toast(msg); updateNav(); refresh(); }
  async function syncFromIdb() {
    if (dirty || writing || modal) { setTimeout(syncFromIdb, 1200); return; }
    const d = await idbGet(); if (!validDb(d)) return; db = migrate(d); cache = null; dupCache = null; updateNav(); refresh();
  }
  async function resetDemo() {
    if (!confirm('Reset demo data? All changes in this browser will be lost.')) return;
    try { localStorage.removeItem('adrial-crm-ui'); localStorage.removeItem('adrial-crm-data'); } catch (e) {}
    clearTimeout(saveT); dirty = false; if (writeP) await writeP; await idbClear();
    db = migrate(D.generate(Date.now())); cache = null; dupCache = null; ui.me = ''; save(); await flushNow();
    try { await AdrialBus.reset('crm'); } catch (e) {} publishSoon(300); updateNav(); fillMe(); toast('Demo data reset'); if (location.hash !== '#/') location.hash = '#/'; else route(false);
  }

  /* ---------- bus ---------- */
  const normCat = raw => { const a = Array.isArray(raw) ? raw : raw && (raw.products || raw.items || raw.catalog) || []; return a.map(p => ({ sku: String(p.sku || p.code || p.id || ''), name: p.name || p.title || '', price: +(p.price != null ? p.price : p.sellPrice != null ? p.sellPrice : p.unitPrice) || 0, stock: typeof p.stock === 'object' && p.stock ? Object.keys(p.stock).reduce((s, k) => s + (+p.stock[k] || 0), 0) : +(p.stock != null ? p.stock : p.onHand != null ? p.onHand : p.qty != null ? p.qty : p.available) || 0 })).filter(p => p.sku); };
  const normCust = raw => { const a = Array.isArray(raw) ? raw : raw && (raw.customers || raw.items) || []; return a.map(c => ({ id: c.id, name: c.name || c.company || '', vat: String(c.vat || c.vatId || c.vat_id || c.taxId || '').replace(/\s/g, '').toUpperCase() })); };
  async function busLoad() {
    try {
      const [c, u] = await Promise.all([AdrialBus.read('erp.catalog'), AdrialBus.read('erp.customers')]);
      BUS.catalog = c ? normCat(c.data) : []; BUS.customers = u ? normCust(u.data) : []; BUS.at = c ? c.updatedAt : 0; BUS.ok = !!c;
    } catch (e) {}
  }
  const erpCustomer = co => { if (!co || !BUS.customers.length) return null; const v = (co.vat || '').replace(/\s/g, '').toUpperCase(), n = (co.name || '').toLowerCase(); return BUS.customers.filter(c => (v && c.vat === v) || (c.name && c.name.toLowerCase() === n))[0] || null; };
  async function busSync() {
    if (!db) return;
    let ch = false;
    try {
      const sent = await AdrialBus.history(m => m.type === 'crm.order' && m.from === 'crm');
      sent.forEach(m => {
        const d = M().dl.get(m.payload && m.payload.dealId); if (!d || !d.erp || d.erp.msgId !== m.id) return;
        const st = m.status === 'done' ? 'created' : m.status === 'failed' ? 'failed' : 'sent';
        const no = m.result && m.result.orderNo; if (d.erp.status !== st || (no && d.erp.orderNo !== no)) { d.erp.status = st; if (no) { d.erp.orderNo = no; d.erp.orderId = m.result.orderId; } if (st === 'failed') d.erp.error = String(m.result || ''); ch = true; }
      });
      const inbox = await AdrialBus.inbox('crm');
      for (const m of inbox) {
        if (m.type !== 'erp.orderStatus') continue; const p = m.payload || {}, d = M().dl.get(p.dealId);
        if (d) { d.fulfilment = { status: p.status || p.state || '', orderNo: p.orderNo || '', at: Date.now(), invoiced: p.invoiced || '' }; ch = true; }
        await AdrialBus.done(m.id, { ok: true });
      }
    } catch (e) {}
    if (ch) { save(); refresh(); }
  }
  function crmSummary() {
    const t = todayIso(), cm = monthOf(t), deals = db.deals, op = deals.filter(isOpen);
    const won = deals.filter(d => d.stage === 'won'), lost = deals.filter(d => d.stage === 'lost');
    const months = []; for (let i = 11; i >= 0; i--) { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i); months.push(d.getFullYear() + '-' + p2(d.getMonth() + 1)); }
    const wm = {}; months.forEach(m => wm[m] = 0); won.forEach(d => { const w = wonDate(d); if (w && wm[monthOf(w)] != null) wm[monthOf(w)] += dealValue(d); });
    const y = deals.filter(d => d.stage === 'won' || d.stage === 'lost').filter(d => diffDays(d.history[d.history.length - 1].date, t) <= 365), yw = y.filter(d => d.stage === 'won').length;
    return {
      updatedAt: Date.now(), companies: db.companies.length, contacts: db.contacts.length, openDeals: op.length, pipelineValue: Math.round(op.reduce((s, d) => s + dealValue(d), 0)), weightedValue: Math.round(op.reduce((s, d) => s + weighted(d), 0)),
      wonThisMonth: Math.round(won.filter(d => monthOf(wonDate(d) || '') === cm).reduce((s, d) => s + dealValue(d), 0)), wonCountThisMonth: won.filter(d => monthOf(wonDate(d) || '') === cm).length,
      winRate12m: y.length ? Math.round(yw / y.length * 100) : 0, lostCount: lost.length, overdueTasks: db.activities.filter(a => actState(a) === 'overdue').length, tasksToday: db.activities.filter(a => actState(a) === 'today').length,
      byStage: STAGES.map(s => { const l = deals.filter(d => d.stage === s.id); return { stage: s.id, name: s.name, count: l.length, value: Math.round(l.reduce((a, d) => a + dealValue(d), 0)) }; }),
      wonByMonth: months.map(m => ({ month: m, value: Math.round(wm[m]) })),
      owners: OWNERS.map(o => ({ id: o.id, name: o.name, wonThisMonth: Math.round(won.filter(d => d.ownerId === o.id && monthOf(wonDate(d) || '') === cm).reduce((s, d) => s + dealValue(d), 0)), target: db.targets[o.id] || 0, openValue: Math.round(op.filter(d => d.ownerId === o.id).reduce((s, d) => s + dealValue(d), 0)) })),
      sentToErp: deals.filter(d => d.erp).length
    };
  }
  function publishSoon(ms) { clearTimeout(pubT); pubT = setTimeout(() => { if (db) AdrialBus.publish('crm.summary', crmSummary()); }, ms == null ? 1500 : ms); }

  /* ---------- modal + form helpers ---------- */
  let lastFocus = null;
  function openModal(o) {
    modal = o; lastFocus = document.activeElement;
    layer.innerHTML = '<div class="back" data-act="modal-bg"><form class="modal' + (o.wide ? ' wide' : '') + '" role="dialog" aria-modal="true" aria-label="' + esc(o.title) + '"><header><h2>' + esc(o.title) + '</h2><button class="btn sm ghost" type="button" data-act="modal-close" aria-label="Close">✕</button></header><div class="mb">' + o.body + '</div><footer>' + (o.foot || '') + (o.ok === null ? '' : '<button class="btn" type="button" data-act="modal-close">Cancel</button><button class="btn primary" type="submit">' + esc(o.ok || 'Save') + '</button>') + '</footer></form></div>';
    const f = $('input:not([type=hidden]),select,textarea', layer); if (f && !o.noFocus) f.focus(); else { const b = $('.modal button.primary', layer); b && b.focus(); }
  }
  function closeModal() { modal = null; layer.innerHTML = ''; if (lastFocus && document.contains(lastFocus)) try { lastFocus.focus(); } catch (e) {} }
  const fd = form => { const o = {}; new FormData(form).forEach((v, k) => { o[k] = typeof v === 'string' ? v.trim() : v; }); return o; };
  const fld = (label, name, val, o) => {
    o = o || {};
    return '<label class="' + (o.full ? 'full' : '') + '">' + esc(label) + (o.sel != null ? '<select name="' + name + '"' + (o.chg ? ' data-chg="' + o.chg + '"' : '') + '>' + o.sel + '</select>' : o.area ? '<textarea name="' + name + '" rows="' + (o.rows || 4) + '">' + esc(val) + '</textarea>' : '<input name="' + name + '" type="' + (o.type || 'text') + '" value="' + esc(val) + '"' + (o.req ? ' required' : '') + (o.attr || '') + '>') + '</label>';
  };
  const opts = (list, sel, blank) => (blank != null ? '<option value="">' + esc(blank) + '</option>' : '') + list.map(x => '<option value="' + esc(x.v) + '"' + (String(x.v) === String(sel) ? ' selected' : '') + '>' + esc(x.t) + '</option>').join('');
  const coOpts = (sel, blank) => opts(db.companies.slice().sort((a, b) => a.name.localeCompare(b.name)).map(c => ({ v: c.id, t: c.name })), sel, blank);
  const ctOpts = (coId, sel, blank) => opts(db.contacts.filter(c => !coId || c.companyId === +coId || c.id === +sel).map(c => ({ v: c.id, t: c.first + ' ' + c.last })), sel, blank);
  const dlOpts = (sel, blank) => opts(db.deals.filter(d => isOpen(d) || d.id === +sel).map(d => ({ v: d.id, t: d.title })), sel, blank);

  /* lines editor (CRM programmes + ERP products) */
  function lineRow(l) {
    const code = l.sku ? 's:' + l.sku : l.productId ? 'p:' + l.productId : '';
    const pick = '<option value="">Custom line</option><optgroup label="Programmes">' + CPRODUCTS.map(p => '<option value="p:' + p.id + '"' + (code === 'p:' + p.id ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('') + '</optgroup>' +
      (BUS.catalog.length ? '<optgroup label="ERP catalogue">' + BUS.catalog.slice(0, 400).map(p => '<option value="s:' + esc(p.sku) + '"' + (code === 's:' + p.sku ? ' selected' : '') + '>' + esc(p.sku + ' · ' + p.name + ' (stock ' + p.stock + ')') + '</option>').join('') + '</optgroup>' : '');
    return '<tr class="lrow"><td><select class="pick" aria-label="Product" data-chg="linepick">' + pick + '</select><input type="hidden" name="lpid" value="' + esc(l.productId || '') + '"><input type="hidden" name="lsku" value="' + esc(l.sku || '') + '"></td>' +
      '<td><input name="lname" aria-label="Description" value="' + esc(l.name || '') + '"><small class="stk">' + stockWarn(l) + '</small></td><td><input name="lqty" aria-label="Quantity" type="number" min="0" step="any" value="' + esc(l.qty == null ? 1 : l.qty) + '" data-inp="lineqty" style="width:64px"></td>' +
      '<td><input name="lprice" aria-label="Unit price" type="number" min="0" step="any" value="' + esc(l.price || 0) + '" style="width:84px"></td><td><input name="ldisc" aria-label="Discount %" type="number" min="0" max="100" step="any" value="' + esc(l.disc || 0) + '" style="width:60px"></td><td><button class="btn sm ghost" type="button" data-act="line-del" aria-label="Remove line">✕</button></td></tr>';
  }
  function stockWarn(l) { if (!l.sku) return ''; const p = BUS.catalog.filter(x => x.sku === l.sku)[0]; if (!p) return 'Not in ERP catalogue'; return +l.qty > p.stock ? '⚠ only ' + p.stock + ' in stock' : 'In stock: ' + p.stock; }
  const linesEditor = lines => '<div class="scroll"><table class="tbl lines"><thead><tr><th>Product</th><th>Description</th><th>Qty</th><th>Unit €</th><th>Disc %</th><th></th></tr></thead><tbody id="lbody">' + lines.map(lineRow).join('') + '</tbody></table></div><button class="btn sm" type="button" data-act="line-add">+ Add line</button>';
  function readLines(root) {
    return $$('.lrow', root).map(r => { const g = n => $('[name=' + n + ']', r).value; return { productId: g('lpid') || undefined, sku: g('lsku') || undefined, name: g('lname').trim(), qty: +g('lqty') || 0, price: +g('lprice') || 0, disc: +g('ldisc') || 0 }; }).filter(l => l.name);
  }

  /* ---------- entity forms ---------- */
  function dealForm(id, pre) {
    const d = id ? M().dl.get(id) : null, v = d || Object.assign({ title: '', companyId: '', contactId: '', ownerId: ui.me || 'u1', stage: 'lead', expected: addDays(todayIso(), 30), source: 'Website', lines: [{ productId: 'p1', name: CPRODUCTS[0].name, qty: 1, price: CPRODUCTS[0].price, disc: 0 }] }, pre || {});
    openModal({
      title: d ? 'Edit deal' : 'New deal', wide: true, ok: d ? 'Save' : 'Create deal',
      body: '<div class="frm">' + fld('Title', 'title', v.title, { req: 1, full: 1 }) + fld('Company', 'companyId', '', { sel: coOpts(v.companyId, '– choose –'), chg: 'dealco' }) + fld('Contact', 'contactId', '', { sel: ctOpts(v.companyId, v.contactId, '– none –') }) +
        fld('Owner', 'ownerId', '', { sel: ownerOpts(v.ownerId) }) + (d ? '' : fld('Stage', 'stage', '', { sel: opts(OPEN.map(s => ({ v: s, t: STAGE[s].name })), v.stage) })) + fld('Expected close', 'expected', v.expected, { type: 'date' }) + fld('Source', 'source', '', { sel: opts(D.SOURCES.map(s => ({ v: s, t: s })), v.source) }) + '</div><h3 style="margin:14px 0 6px">Lines</h3>' + linesEditor(v.lines),
      onOk(f) {
        const o = fd(f); if (!o.companyId) { toast('Choose a company'); return false; } const lines = readLines(f);
        if (d) { const before = dealValue(d); Object.assign(d, { title: o.title, companyId: +o.companyId, contactId: o.contactId ? +o.contactId : null, ownerId: o.ownerId, expected: o.expected, source: o.source, lines: lines, updated: Date.now() }); if (Math.abs(dealValue(d) - before) > 0.5) d.changes = (d.changes || 0) + 1; commit('Deal saved'); }
        else { const nd = { id: nextId(), title: o.title, companyId: +o.companyId, contactId: o.contactId ? +o.contactId : null, ownerId: o.ownerId, stage: o.stage, created: todayIso(), expected: o.expected, lines: lines, source: o.source, lostReason: '', history: [{ stage: o.stage, date: todayIso() }], updated: Date.now(), changes: 0 }; db.deals.push(nd); commit('Deal created'); location.hash = '#/deals/' + nd.id; }
      }
    });
  }
  const CO_FIELDS = ['segment', 'country', 'city', 'vat', 'email', 'phone', 'website', 'source'];
  function companyForm(id) {
    const c = id ? M().co.get(id) : null, v = c || { name: '', segment: 'Optician', country: 'SI', city: '', vat: '', email: '', phone: '', website: '', ownerId: ui.me || 'u1', source: 'Website' };
    openModal({
      title: c ? 'Edit company' : 'New company', ok: c ? 'Save' : 'Create company',
      body: '<div class="frm">' + fld('Name', 'name', v.name, { req: 1, full: 1 }) + fld('Segment', 'segment', '', { sel: opts(SEGMENTS.map(s => ({ v: s.id, t: s.name })), v.segment) }) + fld('Country', 'country', '', { sel: opts(D.COUNTRIES.map(s => ({ v: s.id, t: s.name })), v.country) }) + fld('City', 'city', v.city) + fld('VAT ID', 'vat', v.vat) + fld('E-mail', 'email', v.email, { type: 'email' }) + fld('Phone', 'phone', v.phone) + fld('Website', 'website', v.website) + fld('Owner', 'ownerId', '', { sel: ownerOpts(v.ownerId) }) + fld('Source', 'source', '', { sel: opts(D.SOURCES.map(s => ({ v: s, t: s })), v.source) }) + '</div>',
      onOk(f) { const o = fd(f); if (c) { Object.assign(c, o); commit('Company saved'); } else { const n = Object.assign({ id: nextId(), created: todayIso(), tags: [] }, o); db.companies.push(n); commit('Company created'); location.hash = '#/companies/' + n.id; } }
    });
  }
  function contactForm(id, coId) {
    const c = id ? M().ct.get(id) : null, v = c || { first: '', last: '', companyId: coId || '', role: '', email: '', phone: '', ownerId: ui.me || 'u1' };
    openModal({
      title: c ? 'Edit contact' : 'New contact', ok: c ? 'Save' : 'Create contact',
      body: '<div class="frm">' + fld('First name', 'first', v.first, { req: 1 }) + fld('Last name', 'last', v.last, { req: 1 }) + fld('Company', 'companyId', '', { sel: coOpts(v.companyId, '– none –'), full: 1 }) + fld('Role', 'role', v.role) + fld('Owner', 'ownerId', '', { sel: ownerOpts(v.ownerId) }) + fld('E-mail', 'email', v.email, { type: 'email' }) + fld('Phone', 'phone', v.phone) + '</div>',
      onOk(f) { const o = fd(f); o.companyId = o.companyId ? +o.companyId : null; if (c) { Object.assign(c, o); commit('Contact saved'); } else { const n = Object.assign({ id: nextId() }, o); db.contacts.push(n); commit('Contact created'); location.hash = '#/contacts/' + n.id; } }
    });
  }
  function activityForm(id, pre) {
    const a = id ? M().act.get(id) : null, v = a || Object.assign({ type: 'call', title: '', due: todayIso(), ownerId: ui.me || 'u1', dealId: '', companyId: '', contactId: '', done: false }, pre || {});
    openModal({
      title: a ? 'Edit activity' : 'New activity', ok: a ? 'Save' : 'Add activity',
      body: '<div class="frm">' + fld('Type', 'type', '', { sel: opts(ACT_TYPES.map(t => ({ v: t.id, t: t.name })), v.type) }) + fld('Due', 'due', v.due, { type: 'date', req: 1 }) + fld('Title', 'title', v.title, { req: 1, full: 1 }) + fld('Owner', 'ownerId', '', { sel: ownerOpts(v.ownerId) }) + fld('Deal', 'dealId', '', { sel: dlOpts(v.dealId, '– none –') }) + fld('Company', 'companyId', '', { sel: coOpts(v.companyId, '– none –') }) + fld('Contact', 'contactId', '', { sel: ctOpts(v.companyId, v.contactId, '– none –') }) +
        '<label class="full" style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" name="done"' + (v.done ? ' checked' : '') + '> Done</label></div>',
      onOk(f) {
        const o = fd(f), dl = o.dealId ? M().dl.get(+o.dealId) : null; if (dl) { o.companyId = o.companyId || dl.companyId; o.contactId = o.contactId || dl.contactId || ''; }
        const r = { type: o.type, title: o.title, due: o.due, ownerId: o.ownerId, dealId: o.dealId ? +o.dealId : null, companyId: o.companyId ? +o.companyId : null, contactId: o.contactId ? +o.contactId : null, done: !!o.done };
        if (a) { Object.assign(a, r); a.doneAt = r.done ? (a.doneAt || todayIso()) : null; } else { r.id = nextId(); r.doneAt = r.done ? todayIso() : null; db.activities.push(r); }
        if (dl) dl.updated = Date.now(); commit('Activity saved');
      }
    });
  }
  function noteForm(ref) {
    openModal({ title: 'Add note', ok: 'Add note', body: '<div class="frm">' + fld('Note', 'text', '', { area: 1, full: 1, rows: 5 }) + '</div>', onOk(f) { const o = fd(f); if (!o.text) return false; db.notes.push({ id: nextId(), dealId: ref.dealId || null, companyId: ref.companyId || null, text: o.text, at: Date.now(), ownerId: ui.me || 'u1' }); const d = ref.dealId && M().dl.get(ref.dealId); if (d) d.updated = Date.now(); commit('Note added'); } });
  }
  function lostDialog(id) {
    openModal({ title: 'Mark deal as lost', ok: 'Mark as lost', body: '<div class="frm">' + fld('Reason', 'reason', '', { sel: opts(D.LOST_REASONS.map(r => ({ v: r, t: r })), ''), full: 1 }) + '</div>', onOk(f) { applyMove(id, 'lost', fd(f).reason); } });
  }
  function requestMove(id, stage) { const d = M().dl.get(id); if (!d || d.stage === stage) return; if (stage === 'lost') lostDialog(id); else applyMove(id, stage); }
  function applyMove(id, stage, reason) {
    const d = M().dl.get(id); if (!d) return; d.stage = stage; d.history.push({ stage: stage, date: todayIso() }); d.updated = Date.now(); d.lostReason = stage === 'lost' ? (reason || '') : ''; d.changes = (d.changes || 0) + 1;
    commit(stage === 'won' ? 'Deal won. You can now send it to the ERP' : 'Moved to ' + STAGE[stage].name);
  }
  function deleteDeal(id) {
    const d = M().dl.get(id); if (!d || !confirm('Delete deal "' + d.title + '" with its activities, notes and quotes?')) return;
    db.deals = db.deals.filter(x => x.id !== id); db.activities = db.activities.filter(a => a.dealId !== id); db.notes = db.notes.filter(n => n.dealId !== id); db.quotes = db.quotes.filter(q => q.dealId !== id); commit('Deal deleted'); location.hash = '#/deals';
  }
  function deleteCompany(id) {
    const c = M().co.get(id); if (!c) return; const nd = (M().dealsByCo[id] || []).length;
    if (!confirm('Delete "' + c.name + '" and its ' + nd + ' deal(s)? Contacts are kept without a company.')) return;
    const ids = (M().dealsByCo[id] || []).map(d => d.id); db.deals = db.deals.filter(d => ids.indexOf(d.id) < 0); db.activities = db.activities.filter(a => ids.indexOf(a.dealId) < 0 && a.companyId !== id); db.notes = db.notes.filter(n => ids.indexOf(n.dealId) < 0 && n.companyId !== id); db.quotes = db.quotes.filter(q => ids.indexOf(q.dealId) < 0);
    db.contacts.forEach(x => { if (x.companyId === id) x.companyId = null; }); db.companies = db.companies.filter(x => x.id !== id); commit('Company deleted'); location.hash = '#/companies';
  }
  function deleteContact(id) {
    const c = M().ct.get(id); if (!c || !confirm('Delete contact ' + c.first + ' ' + c.last + '?')) return;
    db.deals.forEach(d => { if (d.contactId === id) d.contactId = null; }); db.activities.forEach(a => { if (a.contactId === id) a.contactId = null; }); db.contacts = db.contacts.filter(x => x.id !== id); commit('Contact deleted'); location.hash = '#/contacts';
  }

  /* ---------- quotes ---------- */
  function quoteStatus(q) { return (q.status === 'Draft' || q.status === 'Sent') && q.validUntil < todayIso() ? 'Expired' : q.status; }
  const quoteTone = s => ({ Draft: 'gray', Sent: 'blue', Accepted: 'green', Declined: 'red', Expired: 'amber' }[s] || 'gray');
  const quoteNet = q => q.lines.reduce((s, l) => s + lineTotal(l), 0) * (1 - (+q.discount || 0) / 100);
  function quoteForm(dealId) {
    const d = M().dl.get(dealId); if (!d) return;
    openModal({
      title: 'New quote', ok: 'Create quote',
      body: '<p class="mut">Lines are copied from the deal (' + d.lines.length + ' lines, ' + money(dealValue(d)) + ').</p><div class="frm">' + fld('Date', 'date', todayIso(), { type: 'date' }) + fld('Valid until', 'validUntil', addDays(todayIso(), 30), { type: 'date' }) + fld('Extra discount %', 'discount', 0, { type: 'number', attr: ' min="0" max="100" step="any"' }) + fld('Note on the quote', 'note', '', { area: 1, full: 1, rows: 3 }) + '</div>',
      onOk(f) {
        const o = fd(f), yr = o.date.slice(0, 4), n = db.quotes.filter(q => q.date.slice(0, 4) === yr).length + 1;
        const q = { id: nextId(), dealId: dealId, no: 'Q-' + yr + '-' + p2(n) + '-' + dealId, date: o.date, validUntil: o.validUntil, status: 'Draft', discount: +o.discount || 0, note: o.note, lines: JSON.parse(JSON.stringify(d.lines)) };
        db.quotes.push(q); d.updated = Date.now(); commit('Quote created'); location.hash = '#/quotes/' + q.id;
      }
    });
  }
  function setQuoteStatus(id, st) {
    const q = db.quotes.filter(x => x.id === id)[0]; if (!q) return; q.status = st; const d = M().dl.get(q.dealId); if (d) d.updated = Date.now();
    if (st === 'Accepted' && d && isOpen(d)) { commit('Quote accepted'); if (confirm('Quote accepted. Move the deal to Won?')) applyMove(d.id, 'won'); } else commit('Quote ' + st.toLowerCase());
  }

  /* ---------- send to ERP ---------- */
  function erpEligible(d) { const qs = M().quotesByDeal[d.id] || []; return d.stage === 'won' || qs.some(q => q.status === 'Accepted'); }
  function sendToErpDialog(id) {
    const d = M().dl.get(id); if (!d) return; const co = M().co.get(d.companyId), ct = M().ct.get(d.contactId), lines = d.lines.filter(l => l.sku);
    if (!AdrialBus.available) { toast('The bus is not available in this browser'); return; }
    if (!erpEligible(d)) { toast('Only won deals (or deals with an accepted quote) can be sent'); return; }
    if (!lines.length) { toast('No ERP catalogue lines on this deal. Add a product from the ERP catalogue first.', 4200); return; }
    const cust = erpCustomer(co), warn = lines.filter(l => { const p = BUS.catalog.filter(x => x.sku === l.sku)[0]; return !p || +l.qty > p.stock; });
    openModal({
      title: 'Send to ERP as draft sales order', ok: d.erp && d.erp.status !== 'failed' ? 'Send again' : 'Send to ERP',
      body: '<p><b>' + esc(co ? co.name : '') + '</b>' + (cust ? ' ' + tag('ERP customer', 'green') : ' ' + tag('New in ERP', 'amber')) + '</p><div class="scroll"><table class="tbl"><thead><tr><th>SKU</th><th>Product</th><th class="right">Qty</th><th class="right">Price</th></tr></thead><tbody>' +
        lines.map(l => '<tr><td>' + esc(l.sku) + '</td><td>' + esc(l.name) + '</td><td class="right">' + l.qty + '</td><td class="right">' + money2(l.price) + '</td></tr>').join('') + '</tbody></table></div>' +
        (warn.length ? '<p class="small" style="color:var(--t-amber)">⚠ Stock warning: ' + warn.map(l => esc(l.sku)).join(', ') + ' may not be fully available.</p>' : '') + (d.lines.length > lines.length ? '<p class="small mut">' + (d.lines.length - lines.length) + ' CRM programme line(s) are not sent.</p>' : '') +
        (d.erp && d.erp.status !== 'failed' ? '<p class="small mut">Already sent on ' + fts(d.erp.sentAt) + '. Sending again creates another draft order.</p>' : ''),
      async onOk() {
        const payload = { dealId: d.id, dealTitle: d.title, ownerName: OWNER[d.ownerId].name, currency: 'EUR', sentAt: Date.now(), company: { name: co.name, vatId: co.vat, email: co.email, phone: co.phone, city: co.city, country: co.country }, contact: ct ? { name: ct.first + ' ' + ct.last, email: ct.email, phone: ct.phone } : null, lines: lines.map(l => ({ sku: l.sku, name: l.name, qty: +l.qty, price: +l.price, discount: +l.disc || 0 })) };
        const mid = await AdrialBus.send('erp', 'crm.order', payload); d.erp = { msgId: mid, sentAt: Date.now(), status: 'sent' }; d.updated = Date.now(); commit('Sent to ERP (draft order). Open the ERP to process it.', 4200);
      }
    });
  }

  /* ---------- charts (hand-written SVG) ---------- */
  const tblView = {};
  function chartCard(key, title, svg, head, rows, extra) {
    const t = tblView[key];
    return '<section class="card"><div class="chead"><h2>' + esc(title) + '</h2><button class="btn sm ghost" type="button" data-act="tbl" data-k="' + key + '" aria-pressed="' + !!t + '">' + (t ? 'Show chart' : 'Show as table') + '</button></div>' + (extra || '') +
      (t ? '<div class="scroll"><table class="tbl"><thead><tr>' + head.map((h, i) => '<th' + (i ? ' class="right"' : '') + '>' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' + rows.map(r => '<tr>' + r.map((c, i) => '<td' + (i ? ' class="right num"' : '') + '>' + esc(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>' : svg) + '</section>';
  }
  function hbars(items) {
    const W = 600, rh = 40, H = items.length * rh + 8, max = Math.max(1, ...items.map(i => Math.max(i.value, i.value2 || 0))), x0 = 112, bw = W - x0 - 70;
    return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Bar chart: pipeline value by stage" style="width:100%;height:auto">' + items.map((it, i) => {
      const y = 4 + i * rh, w1 = Math.max(it.value ? 2 : 0, it.value / max * bw), w2 = (it.value2 || 0) / max * bw;
      return '<text x="0" y="' + (y + 16) + '" style="fill:var(--ink);font-size:14px">' + esc(it.label) + '</text><text x="0" y="' + (y + 31) + '">' + it.count + ' deals</text>' +
        '<rect x="' + x0 + '" y="' + (y + 4) + '" width="' + w1.toFixed(1) + '" height="14" rx="3" style="fill:var(--chart1)"><title>' + esc(it.label + ': ' + money(it.value)) + '</title></rect>' +
        (it.value2 != null ? '<rect x="' + x0 + '" y="' + (y + 21) + '" width="' + Math.max(it.value2 ? 2 : 0, w2).toFixed(1) + '" height="10" rx="3" style="fill:var(--chart2)"><title>' + esc('Weighted: ' + money(it.value2)) + '</title></rect>' : '') +
        '<text x="' + (x0 + w1 + 6).toFixed(1) + '" y="' + (y + 16) + '">' + kfmt(it.value) + '</text>';
    }).join('') + '</svg><p class="small mut" style="margin:4px 0 0"><span style="color:var(--chart1)">■</span> Value &nbsp; <span style="color:var(--chart2)">■</span> Weighted</p>';
  }
  function cols(items, target) {
    const W = 600, H = 210, pl = 40, pb = 26, pt = 10, n = items.length, max = Math.max(1, target || 0, ...items.map(i => i.value)) * 1.1, bw = (W - pl) / n, ch = H - pb - pt;
    let g = ''; for (let i = 0; i <= 4; i++) { const y = pt + ch - ch * i / 4; g += '<line x1="' + pl + '" x2="' + W + '" y1="' + y + '" y2="' + y + '" style="stroke:var(--line)"/><text x="' + (pl - 5) + '" y="' + (y + 4) + '" text-anchor="end">' + kfmt(max * i / 4) + '</text>'; }
    return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Column chart: won value by month" style="width:100%;height:auto">' + g + items.map((it, i) => {
      const h = it.value / max * ch, x = pl + i * bw + bw * 0.16; return '<rect x="' + x.toFixed(1) + '" y="' + (pt + ch - h).toFixed(1) + '" width="' + (bw * 0.68).toFixed(1) + '" height="' + h.toFixed(1) + '" rx="3" style="fill:var(--chart1)"><title>' + esc(it.label + ': ' + money(it.value)) + '</title></rect><text x="' + (x + bw * 0.34).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(it.label.slice(0, 3)) + '</text>';
    }).join('') + (target ? '<line x1="' + pl + '" x2="' + W + '" y1="' + (pt + ch - target / max * ch) + '" y2="' + (pt + ch - target / max * ch) + '" stroke-dasharray="5 4" style="stroke:var(--chart4);stroke-width:1.5"/>' : '') + '</svg>';
  }
  function wonByMonth(owner) {
    const months = []; for (let i = 11; i >= 0; i--) { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i); months.push(d.getFullYear() + '-' + p2(d.getMonth() + 1)); }
    const m = {}; months.forEach(x => m[x] = 0); db.deals.forEach(d => { if (d.stage !== 'won' || (owner && d.ownerId !== owner)) return; const w = wonDate(d); if (w && m[monthOf(w)] != null) m[monthOf(w)] += dealValue(d); });
    return months.map(x => ({ key: x, label: monthLabel(x), value: Math.round(m[x]) }));
  }
  const wonInMonth = (owner, mo) => db.deals.filter(d => d.stage === 'won' && (!owner || d.ownerId === owner) && monthOf(wonDate(d) || '') === mo).reduce((s, d) => s + dealValue(d), 0);

  /* ---------- shared view pieces ---------- */
  const dealRow = d => '<tr><td><a href="#/deals/' + d.id + '">' + esc(d.title) + '</a></td><td><a href="#/companies/' + d.companyId + '">' + esc(coName(d.companyId)) + '</a></td><td>' + stageTag(d.stage) + '</td><td class="right num">' + money(dealValue(d)) + '</td><td>' + ownerAv(d.ownerId) + '</td><td class="num">' + fdate(d.expected) + '</td></tr>';
  const dealTable = (list, empty) => list.length ? '<div class="scroll"><table class="tbl"><thead><tr><th>Deal</th><th>Company</th><th>Stage</th><th class="right">Value</th><th>Owner</th><th>Close</th></tr></thead><tbody>' + list.map(dealRow).join('') + '</tbody></table></div>' : '<p class="empty">' + (empty || 'No deals') + '</p>';
  function actItem(a) {
    const st = actState(a), t = ACT_TYPE[a.type] || ACT_TYPES[4];
    return '<li><label style="display:flex;gap:8px;align-items:flex-start;flex:1"><input type="checkbox" data-chg="act-toggle" data-id="' + a.id + '"' + (a.done ? ' checked' : '') + ' aria-label="Done"><span><span aria-hidden="true">' + t.icon + '</span> ' + (a.done ? '<s>' + esc(a.title) + '</s>' : esc(a.title)) + '<br><span class="small mut">' + (a.dealId ? '<a href="#/deals/' + a.dealId + '">' + esc((M().dl.get(a.dealId) || {}).title || '') + '</a> · ' : '') + fdate(a.due) + '</span></span></label><span>' + (st === 'overdue' ? tag('Overdue', 'red') : st === 'today' ? tag('Today', 'amber') : '') + ' ' + ownerAv(a.ownerId) + ' <button class="btn sm ghost" data-act="edit-act" data-id="' + a.id + '" aria-label="Edit activity">✎</button></span></li>';
  }
  const kpi = (l, v, s) => '<div class="card kpi"><div class="l">' + esc(l) + '</div><div class="v">' + v + '</div><div class="s">' + (s || '&nbsp;') + '</div></div>';
  const head = (t, sub, actions) => '<div class="pagehead"><h1>' + esc(t) + '</h1>' + (sub ? '<span class="sub">' + sub + '</span>' : '') + '<span class="grow"></span>' + (actions || '') + '</div>';
  const myDeals = () => db.deals.filter(mineOk);

  /* ---------- views ---------- */
  function viewHome() {
    const t = todayIso(), cm = monthOf(t), deals = myDeals(), op = deals.filter(isOpen), pipe = op.reduce((s, d) => s + dealValue(d), 0), wtd = op.reduce((s, d) => s + weighted(d), 0);
    const won = deals.filter(d => d.stage === 'won' && monthOf(wonDate(d) || '') === cm), wonV = won.reduce((s, d) => s + dealValue(d), 0);
    const fin = deals.filter(d => (d.stage === 'won' || d.stage === 'lost') && diffDays(d.history[d.history.length - 1].date, t) <= 365), wr = fin.length ? Math.round(fin.filter(d => d.stage === 'won').length / fin.length * 100) : 0;
    const acts = db.activities.filter(mineOk), od = acts.filter(a => actState(a) === 'overdue'), td = acts.filter(a => actState(a) === 'today');
    const stg = OPEN.map(s => { const l = op.filter(d => d.stage === s); return { label: STAGE[s].name, count: l.length, value: l.reduce((a, d) => a + dealValue(d), 0), value2: l.reduce((a, d) => a + weighted(d), 0) }; });
    const wm = wonByMonth(ui.me), tgtSum = ui.me ? db.targets[ui.me] : OWNERS.reduce((s, o) => s + (db.targets[o.id] || 0), 0);
    const hot = op.map(d => [d, dealScore(d)]).sort((a, b) => b[1] - a[1]).slice(0, 6), recent = deals.slice().sort((a, b) => b.updated - a.updated).slice(0, 6);
    main.innerHTML = head('Sales overview', fdate(t) + (ui.me ? ' · ' + esc(OWNER[ui.me].name) : ' · whole team'), '<a class="btn" href="#/deals">Open board</a>') +
      '<div class="grid g4" style="margin-bottom:12px">' + kpi('Open pipeline', money(pipe), op.length + ' open deals') + kpi('Weighted forecast', money(wtd), 'by stage probability') + kpi('Won this month', money(wonV), won.length + ' deals · target ' + money(tgtSum)) + kpi('Win rate (12 months)', wr + ' %', od.length ? '<span style="color:var(--danger)">' + od.length + ' overdue activities</span>' : 'No overdue activities') + '</div>' +
      '<div class="grid g2" style="margin-bottom:12px">' + chartCard('pipe', 'Pipeline by stage', hbars(stg), ['Stage', 'Deals', 'Value', 'Weighted'], stg.map(s => [s.label, s.count, money(s.value), money(s.value2)])) +
      '<section class="card"><div class="chead"><h2>Tasks today</h2><a href="#/activities">All activities</a></div>' + (td.length ? '<ul class="list">' + td.slice(0, 8).map(actItem).join('') + '</ul>' : '<p class="empty">Nothing due today</p>') + (od.length ? '<p class="small" style="color:var(--danger)">' + od.length + ' overdue · <a href="#/activities">review</a></p>' : '') + '</section></div>' +
      '<div class="grid g2" style="margin-bottom:12px">' + chartCard('won', 'Won by month (last 12 months)', cols(wm, ui.me ? 0 : 0), ['Month', 'Won value'], wm.map(m => [m.label, money(m.value)])) +
      '<section class="card"><div class="chead"><h2>Targets, ' + monthLabel(cm) + '</h2><a href="#/team">Team</a></div>' + OWNERS.filter(o => !ui.me || o.id === ui.me).map(o => { const w = wonInMonth(o.id, cm), tg = db.targets[o.id] || 1, pc = Math.round(w / tg * 100); return '<div style="margin-bottom:10px"><div style="display:flex;gap:6px;align-items:center">' + ownerAv(o.id) + ' <span style="flex:1">' + esc(o.name) + '</span><span class="num small">' + money(w) + ' / ' + money(tg) + '</span></div><div class="bar ok" role="progressbar" aria-valuenow="' + pc + '" aria-valuemin="0" aria-valuemax="100" aria-label="' + esc(o.name) + ' target"><i style="width:' + clamp(pc, 0, 100) + '%"></i></div></div>'; }).join('') + '</section></div>' +
      '<div class="grid g2"><section class="card"><h2>Hot leads</h2>' + (hot.length ? '<ul class="list">' + hot.map(h => '<li><span><a href="#/deals/' + h[0].id + '">' + esc(h[0].title) + '</a><br><span class="small mut">' + esc(coName(h[0].companyId)) + ' · ' + money(dealValue(h[0])) + '</span></span><span>' + scoreTag(h[1]) + '</span></li>').join('') + '</ul>' : '<p class="empty">No open deals</p>') + '</section>' +
      '<section class="card"><h2>Recently updated</h2><ul class="list">' + recent.map(d => '<li><span><a href="#/deals/' + d.id + '">' + esc(d.title) + '</a><br><span class="small mut">' + fts(d.updated) + '</span></span><span>' + stageTag(d.stage) + '</span></li>').join('') + '</ul></section></div>';
  }

  function viewBoard() {
    const q = ui.board.q.toLowerCase(), deals = myDeals().filter(d => !q || (d.title + ' ' + coName(d.companyId)).toLowerCase().indexOf(q) >= 0);
    main.innerHTML = head('Deals', 'Drag cards between stages, or focus a card and press ← / →', '<button class="btn primary" data-act="new-deal">+ New deal</button>') +
      '<div class="filters"><div class="tabs"><a class="on" href="#/deals">Board</a><a href="#/deals/list">List</a></div><input id="boardQ" type="search" placeholder="Filter deals…" value="' + esc(ui.board.q) + '" data-inp="board-q" aria-label="Filter deals"></div>' +
      '<div class="board">' + STAGES.map(s => {
        let list = deals.filter(d => d.stage === s.id); if (s.id === 'won' || s.id === 'lost') list = list.filter(d => diffDays(d.history[d.history.length - 1].date, todayIso()) <= 90);
        list.sort((a, b) => b.updated - a.updated); const sum = list.reduce((a, d) => a + dealValue(d), 0);
        return '<div class="col-b" data-stage="' + s.id + '"><h3>' + stageTag(s.id) + '<span>' + list.length + ' · ' + money(sum) + '</span></h3>' + (list.slice(0, 40).map(d => {
          const od = isOpen(d) && d.expected < todayIso();
          return '<div class="dcard" id="dc-' + d.id + '" data-deal="' + d.id + '" tabindex="0" aria-label="' + esc(d.title) + '"><a href="#/deals/' + d.id + '">' + esc(d.title) + '</a><div class="small mut">' + esc(coName(d.companyId)) + '</div><div style="display:flex;justify-content:space-between;align-items:center;margin-top:5px"><b class="num">' + money(dealValue(d)) + '</b>' + (isOpen(d) ? scoreTag(dealScore(d)) : '') + ownerAv(d.ownerId) + '</div>' + (od ? '<div class="small" style="color:var(--danger)">Close date ' + fdate(d.expected) + ' passed</div>' : '') + '</div>';
        }).join('') || '<p class="empty small">Empty</p>') + (list.length > 40 ? '<p class="small mut">+' + (list.length - 40) + ' more, see list</p>' : '') + (s.id === 'won' || s.id === 'lost' ? '<p class="small mut">Last 90 days</p>' : '') + '</div>';
      }).join('') + '</div>';
  }
  let drag = null, suppressClick = false;
  function dragStart(e) { const c = e.target.closest('.dcard'); if (!c || e.button > 0 || !main.contains(c)) return; drag = { id: +c.dataset.deal, el: c, x: e.clientX, y: e.clientY, on: false, ghost: null, over: null }; }
  function dragMove(e) {
    if (!drag) return;
    if (!drag.on) { if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 7) return; drag.on = true; drag.el.classList.add('drag'); const g = drag.el.cloneNode(true); g.removeAttribute('id'); g.classList.remove('drag'); g.classList.add('ghost-card'); document.body.appendChild(g); drag.ghost = g; }
    e.preventDefault(); drag.ghost.style.left = (e.clientX - 100) + 'px'; drag.ghost.style.top = (e.clientY - 20) + 'px';
    const el = document.elementFromPoint(e.clientX, e.clientY), col = el && el.closest('.col-b'); $$('.col-b.over').forEach(x => x.classList.remove('over')); if (col) col.classList.add('over'); drag.over = col ? col.dataset.stage : null;
    const bd = $('.board'); if (bd) { const r = bd.getBoundingClientRect(); if (e.clientX > r.right - 40) bd.scrollLeft += 14; else if (e.clientX < r.left + 40) bd.scrollLeft -= 14; }
  }
  function dragEnd() {
    if (!drag) return; const d = drag; drag = null; $$('.col-b.over').forEach(x => x.classList.remove('over'));
    if (d.on) { d.ghost && d.ghost.remove(); d.el.classList.remove('drag'); suppressClick = true; setTimeout(() => suppressClick = false, 50); if (d.over) requestMove(d.id, d.over); }
  }

  const DL_COLS = [['title', 'Deal'], ['company', 'Company'], ['stage', 'Stage'], ['value', 'Value'], ['weighted', 'Weighted'], ['owner', 'Owner'], ['expected', 'Close'], ['score', 'Score'], ['updated', 'Updated']];
  function dealSortVal(d, k) { return k === 'title' ? d.title.toLowerCase() : k === 'company' ? coName(d.companyId).toLowerCase() : k === 'stage' ? STAGES.indexOf(STAGE[d.stage]) : k === 'value' ? dealValue(d) : k === 'weighted' ? weighted(d) : k === 'owner' ? d.ownerId : k === 'expected' ? d.expected : k === 'score' ? dealScore(d) : d.updated; }
  function viewDealList() {
    const q = ui.dl.q.toLowerCase(), k = ui.dl.sort, dir = ui.dl.dir;
    const list = myDeals().filter(d => (!ui.dl.stage || d.stage === ui.dl.stage) && (!q || (d.title + ' ' + coName(d.companyId)).toLowerCase().indexOf(q) >= 0)).sort((a, b) => { const x = dealSortVal(a, k), y = dealSortVal(b, k); return (x < y ? -1 : x > y ? 1 : 0) * dir; });
    main.innerHTML = head('Deals', list.length + ' deals · ' + money(list.reduce((s, d) => s + dealValue(d), 0)), '<button class="btn" data-act="export" data-k="deals">Export CSV</button> <button class="btn primary" data-act="new-deal">+ New deal</button>') +
      '<div class="filters"><div class="tabs"><a href="#/deals">Board</a><a class="on" href="#/deals/list">List</a></div><input id="dlQ" type="search" placeholder="Search deals…" value="' + esc(ui.dl.q) + '" data-inp="dl-q" aria-label="Search deals"><select data-chg="dl-stage" aria-label="Stage">' + opts(STAGES.map(s => ({ v: s.id, t: s.name })), ui.dl.stage, 'All stages') + '</select></div>' +
      '<div class="card scroll"><table class="tbl"><thead><tr>' + DL_COLS.map(c => '<th aria-sort="' + (k === c[0] ? (dir > 0 ? 'ascending' : 'descending') : 'none') + '"><button data-act="dl-sort" data-k="' + c[0] + '">' + c[1] + (k === c[0] ? (dir > 0 ? ' ▲' : ' ▼') : '') + '</button></th>').join('') + '</tr></thead><tbody>' +
      list.slice(0, 200).map(d => '<tr><td><a href="#/deals/' + d.id + '">' + esc(d.title) + '</a></td><td><a href="#/companies/' + d.companyId + '">' + esc(coName(d.companyId)) + '</a></td><td>' + stageTag(d.stage) + '</td><td class="num right">' + money(dealValue(d)) + '</td><td class="num right">' + money(weighted(d)) + '</td><td>' + ownerAv(d.ownerId) + '</td><td class="num">' + fdate(d.expected) + '</td><td>' + (isOpen(d) ? scoreTag(dealScore(d)) : '–') + '</td><td class="num">' + fdate(iso(new Date(d.updated))) + '</td></tr>').join('') + '</tbody></table>' + (list.length ? '' : '<p class="empty">No deals match</p>') + (list.length > 200 ? '<p class="small mut">Showing 200 of ' + list.length + '</p>' : '') + '</div>';
  }

  function viewDeal(id) {
    const d = M().dl.get(+id); if (!d) return viewMissing('Deal not found');
    const co = M().co.get(d.companyId), ct = M().ct.get(d.contactId), acts = (M().actsByDeal[d.id] || []).slice().sort((a, b) => b.due.localeCompare(a.due)), notes = M().notesByDeal[d.id] || [], qs = M().quotesByDeal[d.id] || [];
    const tl = [];
    d.history.forEach(h => tl.push({ at: h.date + 'T00', html: 'Moved to ' + stageTag(h.stage) }));
    acts.forEach(a => tl.push({ at: a.due + 'T12', html: (ACT_TYPE[a.type] || {}).icon + ' ' + esc(a.title) + ' ' + (a.done ? tag('done', 'green') : actState(a) === 'overdue' ? tag('overdue', 'red') : tag('open', 'gray')) }));
    notes.forEach(n => tl.push({ at: iso(new Date(n.at)) + 'T18', html: '<b>Note:</b> ' + esc(n.text) + ' <button class="btn sm ghost" data-act="del-note" data-id="' + n.id + '" aria-label="Delete note">✕</button>' }));
    tl.sort((a, b) => b.at.localeCompare(a.at));
    const ful = d.fulfilment, erp = d.erp, canSend = erpEligible(d), skuLines = d.lines.filter(l => l.sku).length, score = dealScore(d);
    main.innerHTML = '<p class="small"><a href="#/deals">← Deals</a></p>' + head(d.title, stageTag(d.stage) + ' ' + (isOpen(d) ? scoreTag(score) : ''), '<button class="btn" data-act="edit-deal" data-id="' + d.id + '">Edit</button> <button class="btn danger" data-act="del-deal" data-id="' + d.id + '">Delete</button>') +
      '<div class="card" style="margin-bottom:12px"><div class="chead"><b>Move to stage</b><span class="small mut">' + (d.stage === 'lost' && d.lostReason ? 'Lost: ' + esc(d.lostReason) : '') + '</span></div><div class="tabs">' + STAGES.map(s => '<button type="button" class="' + (s.id === d.stage ? 'on' : '') + '" data-act="move" data-id="' + d.id + '" data-s="' + s.id + '"' + (s.id === d.stage ? ' aria-current="true"' : '') + '>' + s.name + '</button>').join('') + '</div></div>' +
      '<div class="grid g21" style="margin-bottom:12px"><div class="grid" style="align-content:start">' +
      '<section class="card"><h2>Details</h2><div class="grid g2 small"><div><span class="mut">Company</span><br>' + (co ? '<a href="#/companies/' + co.id + '">' + esc(co.name) + '</a>' + (erpCustomer(co) ? ' ' + tag('ERP customer', 'green') : '') : '–') + '</div><div><span class="mut">Contact</span><br>' + (ct ? '<a href="#/contacts/' + ct.id + '">' + esc(ct.first + ' ' + ct.last) + '</a>' : '–') + '</div><div><span class="mut">Owner</span><br>' + ownerAv(d.ownerId) + ' ' + esc(OWNER[d.ownerId].name) + '</div><div><span class="mut">Source</span><br>' + esc(d.source) + '</div><div><span class="mut">Created</span><br>' + fdate(d.created) + '</div><div><span class="mut">Expected close</span><br>' + fdate(d.expected) + '</div></div></section>' +
      '<section class="card"><div class="chead"><h2>Lines</h2><span class="num"><b>' + money2(dealValue(d)) + '</b> · weighted ' + money(weighted(d)) + '</span></div><div class="scroll"><table class="tbl"><thead><tr><th>Item</th><th class="right">Qty</th><th class="right">Price</th><th class="right">Disc</th><th class="right">Total</th></tr></thead><tbody>' +
      d.lines.map(l => '<tr><td>' + esc(l.name) + (l.sku ? ' ' + tag('ERP ' + l.sku, 'teal') : '') + '</td><td class="right">' + l.qty + '</td><td class="right num">' + money2(l.price) + '</td><td class="right">' + (l.disc ? l.disc + ' %' : '–') + '</td><td class="right num">' + money2(lineTotal(l)) + '</td></tr>').join('') + '</tbody></table></div></section>' +
      '<section class="card"><div class="chead"><h2>Timeline</h2><span><button class="btn sm" data-act="new-activity" data-deal="' + d.id + '">+ Activity</button> <button class="btn sm" data-act="new-note" data-deal="' + d.id + '">+ Note</button></span></div><div class="tl">' + tl.map(t => '<div><span class="small mut">' + fdate(t.at.slice(0, 10)) + '</span><br>' + t.html + '</div>').join('') + '</div></section></div>' +
      '<div class="grid" style="align-content:start"><section class="card"><div class="chead"><h2>ERP</h2>' + (erp ? tag(erp.status === 'created' ? 'Order created' : erp.status === 'failed' ? 'Failed' : 'Waiting for ERP', erp.status === 'created' ? 'green' : erp.status === 'failed' ? 'red' : 'amber') : '') + '</div>' +
      (erp ? '<p class="small">Sent ' + fts(erp.sentAt) + (erp.orderNo ? '<br>Sales order <b>' + esc(erp.orderNo) + '</b>' : '') + (erp.error ? '<br><span style="color:var(--danger)">' + esc(erp.error) + '</span>' : '') + '</p>' : '<p class="small mut">' + (canSend ? (skuLines ? 'Ready to send as a draft sales order.' : 'Add ERP catalogue lines to send this deal.') : 'Available once the deal is won or a quote is accepted.') + '</p>') +
      (ful ? '<p class="small">Fulfilment: <b>' + esc(ful.status || 'update received') + '</b>' + (ful.invoiced ? ' · invoice ' + esc(ful.invoiced) : '') + '<br><span class="mut">' + fts(ful.at) + '</span></p>' : '') +
      '<button class="btn primary sm" data-act="send-erp" data-id="' + d.id + '"' + (canSend && skuLines ? '' : ' disabled') + '>' + (erp && erp.status !== 'failed' ? 'Send again' : 'Send to ERP') + '</button>' + (BUS.ok ? '' : '<p class="small mut">ERP catalogue not found. Open the ERP app once.</p>') + '</section>' +
      '<section class="card"><div class="chead"><h2>Quotes</h2><button class="btn sm" data-act="new-quote" data-id="' + d.id + '">+ Quote</button></div>' + (qs.length ? '<ul class="list">' + qs.map(q => '<li><span><a href="#/quotes/' + q.id + '">' + esc(q.no) + '</a><br><span class="small mut">valid until ' + fdate(q.validUntil) + '</span></span><span class="right">' + tag(quoteStatus(q), quoteTone(quoteStatus(q))) + '<br><span class="small num">' + money(quoteNet(q)) + '</span></span></li>').join('') + '</ul>' : '<p class="empty small">No quotes yet</p>') + '</section>' +
      '<section class="card"><h2>History</h2><ul class="list">' + d.history.map((h, i) => '<li><span>' + stageTag(h.stage) + '</span><span class="small mut">' + fdate(h.date) + (i ? ' · ' + diffDays(d.history[i - 1].date, h.date) + ' d' : '') + '</span></li>').join('') + '</ul></section></div></div>';
  }

  function viewQuote(id) {
    const q = db.quotes.filter(x => x.id === +id)[0]; if (!q) return viewMissing('Quote not found');
    const d = M().dl.get(q.dealId), co = d && M().co.get(d.companyId), ct = d && M().ct.get(d.contactId), st = quoteStatus(q), gross = q.lines.reduce((s, l) => s + lineTotal(l), 0), net = quoteNet(q), vatR = co && co.country === 'HR' ? 0.25 : 0.22;
    main.innerHTML = '<div class="noprint"><p class="small"><a href="#/deals/' + q.dealId + '">← Back to deal</a></p>' + head(q.no, tag(st, quoteTone(st)), '<button class="btn" data-act="print">Print / PDF</button>') +
      '<div class="tabs" style="margin-bottom:12px">' + ['Draft', 'Sent', 'Accepted', 'Declined'].map(s => '<button class="' + (q.status === s ? 'on' : '') + '" data-act="quote-status" data-id="' + q.id + '" data-s="' + s + '">' + s + '</button>').join('') + '<button class="danger btn sm" data-act="del-quote" data-id="' + q.id + '">Delete quote</button></div></div>' +
      '<article class="quote"><div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap"><div><h2 style="font-size:1.4rem">Quote ' + esc(q.no) + '</h2><div>Date: ' + fdate(q.date) + '<br>Valid until: ' + fdate(q.validUntil) + '</div></div><div class="right"><b>Adrial d.o.o.</b><br>Dunajska cesta 1<br>1000 Ljubljana<br>' + (d ? esc(OWNER[d.ownerId].name) : '') + '</div></div>' +
      '<p><b>' + esc(co ? co.name : '') + '</b><br>' + (ct ? esc(ct.first + ' ' + ct.last) + '<br>' : '') + esc(co ? co.city + ', ' + co.country : '') + '<br>' + esc(co ? co.vat : '') + '</p>' +
      '<table><thead><tr><th>Item</th><th class="right">Qty</th><th class="right">Unit</th><th class="right">Disc</th><th class="right">Total</th></tr></thead><tbody>' + q.lines.map(l => '<tr><td>' + esc(l.name) + '</td><td class="right">' + l.qty + '</td><td class="right">' + money2(l.price) + '</td><td class="right">' + (l.disc ? l.disc + ' %' : '') + '</td><td class="right">' + money2(lineTotal(l)) + '</td></tr>').join('') + '</tbody></table>' +
      '<p class="right">Subtotal ' + money2(gross) + '<br>' + (q.discount ? 'Extra discount ' + q.discount + ' %: −' + money2(gross - net) + '<br>' : '') + 'Net ' + money2(net) + '<br>VAT ' + Math.round(vatR * 100) + ' % ' + money2(net * vatR) + '<br><b style="font-size:1.15rem">Total ' + money2(net * (1 + vatR)) + '</b></p>' + (q.note ? '<p>' + esc(q.note).replace(/\n/g, '<br>') + '</p>' : '') + '<p style="color:#555;font-size:.85rem">Payment: 30 days net. Prices in EUR.</p></article>';
  }

  function viewMissing(msg) { main.innerHTML = head(msg || 'Page not found') + '<div class="card"><p>Nothing here. <a href="#/">Back to the overview</a></p></div>'; }
  const notesBlock = (list, ref) => '<section class="card"><div class="chead"><h2>Notes</h2><button class="btn sm" data-act="new-note" data-co="' + (ref.companyId || '') + '">+ Note</button></div>' + (list.length ? '<ul class="list">' + list.sort((a, b) => b.at - a.at).map(n => '<li><span>' + esc(n.text) + '<br><span class="small mut">' + fts(n.at) + ' · ' + esc((OWNER[n.ownerId] || {}).name || '') + (n.dealId ? ' · <a href="#/deals/' + n.dealId + '">deal</a>' : '') + '</span></span><button class="btn sm ghost" data-act="del-note" data-id="' + n.id + '" aria-label="Delete note">✕</button></li>').join('') + '</ul>' : '<p class="empty small">No notes</p>') + '</section>';

  function viewCompanies() {
    const q = ui.co.q.toLowerCase(), f = ui.co;
    const list = db.companies.filter(c => mineOk(c) && (!f.seg || c.segment === f.seg) && (!f.own || c.ownerId === f.own) && (!q || (c.name + ' ' + c.city + ' ' + c.vat).toLowerCase().indexOf(q) >= 0)).sort((a, b) => a.name.localeCompare(b.name));
    main.innerHTML = head('Companies', list.length + ' of ' + db.companies.length, '<button class="btn" data-act="export" data-k="companies">Export CSV</button> <button class="btn primary" data-act="new-company">+ New company</button>') +
      '<div class="filters"><input id="coQ" type="search" placeholder="Search name, city, VAT…" value="' + esc(f.q) + '" data-inp="co-q" aria-label="Search companies"><select data-chg="co-seg" aria-label="Segment">' + opts(SEGMENTS.map(s => ({ v: s.id, t: s.name })), f.seg, 'All segments') + '</select><select data-chg="co-own" aria-label="Owner">' + opts(OWNERS.map(o => ({ v: o.id, t: o.name })), f.own, 'All owners') + '</select></div>' +
      '<div class="card scroll"><table class="tbl"><thead><tr><th>Company</th><th>Segment</th><th>Location</th><th>Owner</th><th class="right">Open deals</th><th class="right">Open value</th><th>Score</th></tr></thead><tbody>' +
      list.slice(0, 150).map(c => { const ds = (M().dealsByCo[c.id] || []).filter(isOpen); return '<tr><td><a href="#/companies/' + c.id + '">' + esc(c.name) + '</a>' + (erpCustomer(c) ? ' ' + tag('ERP', 'green') : '') + '</td><td>' + segTag(c.segment) + '</td><td>' + esc(c.city) + ', ' + esc(c.country) + '</td><td>' + ownerAv(c.ownerId) + '</td><td class="right">' + ds.length + '</td><td class="right num">' + money(ds.reduce((s, d) => s + dealValue(d), 0)) + '</td><td>' + scoreTag(companyScore(c)) + '</td></tr>'; }).join('') + '</tbody></table>' + (list.length ? '' : '<p class="empty">No companies match</p>') + (list.length > 150 ? '<p class="small mut">Showing 150 of ' + list.length + '. Narrow the search.</p>' : '') + '</div>';
  }
  function viewCompany(id) {
    const c = M().co.get(+id); if (!c) return viewMissing('Company not found');
    const ds = (M().dealsByCo[c.id] || []).slice().sort((a, b) => b.updated - a.updated), cts = M().ctsByCo[c.id] || [], acts = (M().actsByCo[c.id] || []).slice().sort((a, b) => b.due.localeCompare(a.due)).slice(0, 8), notes = db.notes.filter(n => n.companyId === c.id), ec = erpCustomer(c);
    const wonV = ds.filter(d => d.stage === 'won').reduce((s, d) => s + dealValue(d), 0);
    main.innerHTML = '<p class="small"><a href="#/companies">← Companies</a></p>' + head(c.name, segTag(c.segment) + ' ' + scoreTag(companyScore(c)) + (ec ? ' ' + tag('ERP customer', 'green') : ''), '<button class="btn" data-act="edit-company" data-id="' + c.id + '">Edit</button> <button class="btn danger" data-act="del-company" data-id="' + c.id + '">Delete</button>') +
      '<div class="grid g21" style="margin-bottom:12px"><div class="grid" style="align-content:start"><section class="card"><h2>Details</h2><div class="grid g2 small"><div><span class="mut">Location</span><br>' + esc(c.city) + ', ' + esc(c.country) + '</div><div><span class="mut">VAT ID</span><br>' + esc(c.vat || '–') + '</div><div><span class="mut">E-mail</span><br>' + (c.email ? '<a href="mailto:' + esc(c.email) + '">' + esc(c.email) + '</a>' : '–') + '</div><div><span class="mut">Phone</span><br>' + esc(c.phone || '–') + '</div><div><span class="mut">Website</span><br>' + esc(c.website || '–') + '</div><div><span class="mut">Owner</span><br>' + ownerAv(c.ownerId) + ' ' + esc((OWNER[c.ownerId] || {}).name) + '</div><div><span class="mut">Customer since</span><br>' + fdate(c.created) + '</div><div><span class="mut">Won value</span><br><b>' + money(wonV) + '</b></div></div></section>' +
      '<section class="card"><div class="chead"><h2>Deals (' + ds.length + ')</h2><button class="btn sm" data-act="new-deal" data-co="' + c.id + '">+ Deal</button></div>' + dealTable(ds) + '</section></div>' +
      '<div class="grid" style="align-content:start"><section class="card"><div class="chead"><h2>Contacts (' + cts.length + ')</h2><button class="btn sm" data-act="new-contact" data-co="' + c.id + '">+ Contact</button></div>' + (cts.length ? '<ul class="list">' + cts.map(x => '<li><span><a href="#/contacts/' + x.id + '">' + esc(x.first + ' ' + x.last) + '</a><br><span class="small mut">' + esc(x.role || '') + '</span></span><span class="small">' + esc(x.email) + '</span></li>').join('') + '</ul>' : '<p class="empty small">No contacts</p>') + '</section>' +
      '<section class="card"><div class="chead"><h2>Activities</h2><button class="btn sm" data-act="new-activity" data-co="' + c.id + '">+ Activity</button></div>' + (acts.length ? '<ul class="list">' + acts.map(actItem).join('') + '</ul>' : '<p class="empty small">No activities</p>') + '</section>' + notesBlock(notes, { companyId: c.id }) + '</div></div>';
  }

  function viewContacts() {
    const q = ui.ct.q.toLowerCase(), list = db.contacts.filter(c => mineOk(c) && (!q || (c.first + ' ' + c.last + ' ' + c.email + ' ' + coName(c.companyId)).toLowerCase().indexOf(q) >= 0)).sort((a, b) => (a.last + a.first).localeCompare(b.last + b.first));
    main.innerHTML = head('Contacts', list.length + ' of ' + db.contacts.length, '<button class="btn" data-act="export" data-k="contacts">Export CSV</button> <button class="btn primary" data-act="new-contact">+ New contact</button>') + '<div class="filters"><input id="ctQ" type="search" placeholder="Search name, e-mail, company…" value="' + esc(ui.ct.q) + '" data-inp="ct-q" aria-label="Search contacts"></div>' +
      '<div class="card scroll"><table class="tbl"><thead><tr><th>Name</th><th>Company</th><th>Role</th><th>E-mail</th><th>Phone</th><th>Owner</th></tr></thead><tbody>' + list.slice(0, 200).map(c => '<tr><td><a href="#/contacts/' + c.id + '">' + esc(c.first + ' ' + c.last) + '</a></td><td>' + (c.companyId ? '<a href="#/companies/' + c.companyId + '">' + esc(coName(c.companyId)) + '</a>' : '<span class="mut">none</span>') + '</td><td>' + esc(c.role) + '</td><td>' + esc(c.email) + '</td><td>' + esc(c.phone) + '</td><td>' + ownerAv(c.ownerId) + '</td></tr>').join('') + '</tbody></table>' + (list.length ? '' : '<p class="empty">No contacts match</p>') + (list.length > 200 ? '<p class="small mut">Showing 200 of ' + list.length + '</p>' : '') + '</div>';
  }
  function viewContact(id) {
    const c = M().ct.get(+id); if (!c) return viewMissing('Contact not found');
    const ds = (db.deals.filter(d => d.contactId === c.id)).sort((a, b) => b.updated - a.updated), acts = (M().actsByCt[c.id] || []).slice().sort((a, b) => b.due.localeCompare(a.due)).slice(0, 10);
    main.innerHTML = '<p class="small"><a href="#/contacts">← Contacts</a></p>' + head(c.first + ' ' + c.last, esc(c.role || ''), '<button class="btn" data-act="compose" data-id="' + c.id + '">Write e-mail</button> <button class="btn" data-act="edit-contact" data-id="' + c.id + '">Edit</button> <button class="btn danger" data-act="del-contact" data-id="' + c.id + '">Delete</button>') +
      '<div class="grid g2"><div class="grid" style="align-content:start"><section class="card"><h2>Details</h2><div class="grid g2 small"><div><span class="mut">Company</span><br>' + (c.companyId ? '<a href="#/companies/' + c.companyId + '">' + esc(coName(c.companyId)) + '</a>' : '–') + '</div><div><span class="mut">Owner</span><br>' + ownerAv(c.ownerId) + ' ' + esc((OWNER[c.ownerId] || {}).name || '') + '</div><div><span class="mut">E-mail</span><br>' + (c.email ? '<a href="mailto:' + esc(c.email) + '">' + esc(c.email) + '</a>' : '–') + '</div><div><span class="mut">Phone</span><br>' + esc(c.phone || '–') + '</div></div></section>' +
      '<section class="card"><h2>Deals</h2>' + dealTable(ds, 'No deals with this contact') + '</section></div><section class="card"><div class="chead"><h2>Activities</h2><button class="btn sm" data-act="new-activity" data-ct="' + c.id + '">+ Activity</button></div>' + (acts.length ? '<ul class="list">' + acts.map(actItem).join('') + '</ul>' : '<p class="empty small">No activities</p>') + '</section></div>';
  }

  function viewActivities() {
    const f = ui.act, all = db.activities.filter(a => mineOk(a) && (!f.type || a.type === f.type) && (f.show === 'all' || (f.show === 'open' ? !a.done : f.show === 'done' ? a.done : actState(a) === f.show)));
    all.sort((a, b) => f.show === 'done' || f.show === 'all' ? b.due.localeCompare(a.due) : a.due.localeCompare(b.due));
    const cnt = k => db.activities.filter(a => mineOk(a) && (k === 'open' ? !a.done : actState(a) === k)).length;
    main.innerHTML = head('Activities', all.length + ' shown', '<a class="btn" href="#/activities/week">Week view</a> <button class="btn primary" data-act="new-activity">+ New activity</button>') +
      '<div class="filters"><div class="tabs"><a class="on" href="#/activities">List</a><a href="#/activities/week">Week</a></div><div class="tabs">' + [['open', 'Open (' + cnt('open') + ')'], ['overdue', 'Overdue (' + cnt('overdue') + ')'], ['today', 'Today (' + cnt('today') + ')'], ['upcoming', 'Upcoming'], ['done', 'Done'], ['all', 'All']].map(t => '<button class="' + (f.show === t[0] ? 'on' : '') + '" data-act="act-show" data-k="' + t[0] + '">' + t[1] + '</button>').join('') + '</div><select data-chg="act-type" aria-label="Type">' + opts(ACT_TYPES.map(t => ({ v: t.id, t: t.name })), f.type, 'All types') + '</select></div>' +
      '<div class="card">' + (all.length ? '<ul class="list">' + all.slice(0, f.limit).map(actItem).join('') + '</ul>' + (all.length > f.limit ? '<p style="text-align:center"><button class="btn" data-act="act-more">Show more (' + (all.length - f.limit) + ')</button></p>' : '') : '<p class="empty">No activities</p>') + '</div>';
  }
  function viewWeek() {
    const off = ui.week.offset, start = addDays(mondayOf(todayIso()), off * 7), days = []; for (let i = 0; i < 7; i++) days.push(addDays(start, i));
    const t = todayIso(), names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    main.innerHTML = head('Week ' + fdate(days[0]).slice(0, 5) + ' – ' + fdate(days[6]).slice(0, 5), '', '<button class="btn primary" data-act="new-activity">+ New activity</button>') +
      '<div class="filters"><div class="tabs"><a href="#/activities">List</a><a class="on" href="#/activities/week">Week</a></div><button class="btn" data-act="week-nav" data-k="-1">← Previous</button><button class="btn" data-act="week-nav" data-k="0">This week</button><button class="btn" data-act="week-nav" data-k="1">Next →</button></div>' +
      '<div class="week">' + days.map((d, i) => { const l = db.activities.filter(a => mineOk(a) && a.due === d).sort((a, b) => a.done - b.done); return '<div class="day' + (d === t ? ' today' : '') + '"><b>' + names[i] + ' ' + fdate(d).slice(0, 5) + '</b> <button class="btn sm ghost" data-act="new-activity" data-due="' + d + '" aria-label="Add activity on ' + d + '">+</button>' +
        l.map(a => '<div class="act' + (a.done ? ' done' : actState(a) === 'overdue' ? ' over' : '') + '"><input type="checkbox" data-chg="act-toggle" data-id="' + a.id + '"' + (a.done ? ' checked' : '') + ' aria-label="Done"><a href="#" data-act="edit-act" data-id="' + a.id + '" style="color:inherit;text-decoration:none">' + (ACT_TYPE[a.type] || {}).icon + ' ' + esc(a.title) + '</a></div>').join('') + '</div>'; }).join('') + '</div>';
  }

  function digestData(off) {
    const from = addDays(mondayOf(todayIso()), off * 7), to = addDays(from, 6), t = todayIso(), inR = s => s >= from && s <= to, deals = myDeals();
    const ev = st => deals.filter(d => d.history.some(h => h.stage === st && inR(h.date) && (st !== 'lead' || h === d.history[0])));
    return {
      from: from, to: to, won: ev('won'), lost: ev('lost'), created: deals.filter(d => inR(d.created)),
      done: db.activities.filter(a => mineOk(a) && a.done && inR(a.doneAt || a.due)), overdue: db.activities.filter(a => mineOk(a) && actState(a) === 'overdue'),
      next: db.activities.filter(a => mineOk(a) && !a.done && a.due >= addDays(to, 1) && a.due <= addDays(to, 7)), closing: deals.filter(d => isOpen(d) && d.expected >= addDays(to, 1) && d.expected <= addDays(to, 14))
    };
  }
  function viewDigest() {
    const g = digestData(ui.digest.offset), wonV = g.won.reduce((s, d) => s + dealValue(d), 0), lostV = g.lost.reduce((s, d) => s + dealValue(d), 0);
    const li = (arr, fn, empty) => arr.length ? '<ul class="list">' + arr.slice(0, 8).map(fn).join('') + '</ul>' + (arr.length > 8 ? '<p class="small mut">+' + (arr.length - 8) + ' more</p>' : '') : '<p class="empty small">' + empty + '</p>';
    const dl = d => '<li><span><a href="#/deals/' + d.id + '">' + esc(d.title) + '</a><br><span class="small mut">' + esc(coName(d.companyId)) + '</span></span><b class="num">' + money(dealValue(d)) + '</b></li>';
    main.innerHTML = head('Weekly digest', fdate(g.from) + ' – ' + fdate(g.to), '<button class="btn" data-act="digest-copy">Copy as text</button>') + '<div class="filters"><button class="btn" data-act="digest-nav" data-k="-1">← Previous week</button><button class="btn" data-act="digest-nav" data-k="0">This week</button><button class="btn" data-act="digest-nav" data-k="1">Next week →</button></div>' +
      '<div class="grid g4" style="margin-bottom:12px">' + kpi('Won', money(wonV), g.won.length + ' deals') + kpi('Lost', money(lostV), g.lost.length + ' deals') + kpi('New deals', g.created.length, money(g.created.reduce((s, d) => s + dealValue(d), 0))) + kpi('Activities done', g.done.length, g.overdue.length + ' overdue now') + '</div>' +
      '<div class="grid g2"><section class="card"><h2>Won</h2>' + li(g.won, dl, 'No deals won this week') + '</section><section class="card"><h2>Lost</h2>' + li(g.lost, d => '<li><span><a href="#/deals/' + d.id + '">' + esc(d.title) + '</a><br><span class="small mut">' + esc(d.lostReason) + '</span></span><b class="num">' + money(dealValue(d)) + '</b></li>', 'No deals lost this week') + '</section>' +
      '<section class="card"><h2>Closing in the next two weeks</h2>' + li(g.closing, dl, 'Nothing expected to close') + '</section><section class="card"><h2>Planned next week</h2>' + li(g.next, a => '<li><span>' + esc(a.title) + '<br><span class="small mut">' + fdate(a.due) + '</span></span>' + ownerAv(a.ownerId) + '</li>', 'No activities planned') + '</section></div>';
  }
  function digestText() {
    const g = digestData(ui.digest.offset), l = (t, a, f) => t + ' (' + a.length + ')\n' + (a.slice(0, 8).map(f).join('\n') || '  –');
    return 'Weekly digest ' + fdate(g.from) + ' - ' + fdate(g.to) + '\n\n' + l('Won', g.won, d => '  ' + d.title + ' ' + money(dealValue(d))) + '\n\n' + l('Lost', g.lost, d => '  ' + d.title + ' (' + d.lostReason + ')') + '\n\n' + l('New deals', g.created, d => '  ' + d.title) + '\n\n' + l('Planned next week', g.next, a => '  ' + fdate(a.due) + ' ' + a.title) + '\n\nOverdue activities: ' + g.overdue.length;
  }
  async function copyText(t, msg) { try { await navigator.clipboard.writeText(t); toast(msg || 'Copied'); } catch (e) { const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); toast(msg || 'Copied'); } catch (e2) { toast('Copy failed'); } ta.remove(); } }

  /* e-mail templates */
  function fillT(s, ctx) { return String(s).replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => ctx[k] != null ? ctx[k] : m); }
  function ctxFor(ct, d) { const co = ct && ct.companyId ? M().co.get(ct.companyId) : d && M().co.get(d.companyId); return { contact: ct ? ct.first : 'there', fullname: ct ? ct.first + ' ' + ct.last : '', company: co ? co.name : '', deal: d ? d.title : 'our proposal', value: d ? money(dealValue(d)) : '', owner: OWNER[(d && d.ownerId) || (ct && ct.ownerId) || ui.me || 'u1'].name }; }
  function composeEmail(ctId, tplId, dealId) {
    const ct = M().ct.get(ctId), ds = ct ? db.deals.filter(d => d.contactId === ct.id || d.companyId === ct.companyId) : db.deals, d = dealId ? M().dl.get(dealId) : ds[0], tpl = db.templates.filter(t => t.id === tplId)[0] || db.templates[0];
    const ctx = ctxFor(ct, d), subj = fillT(tpl.subject, ctx), body = fillT(tpl.body, ctx);
    openModal({
      title: 'Write e-mail', wide: true, ok: null, foot: '<button class="btn" type="button" data-act="mail-copy">Copy text</button><a class="btn primary" id="mailLink" href="mailto:' + esc(ct ? ct.email : '') + '?subject=' + encodeURIComponent(subj) + '&body=' + encodeURIComponent(body) + '">Open in mail app</a><button class="btn" type="button" data-act="modal-close">Close</button>',
      body: '<div class="frm"><label>Template<select data-chg="mail-tpl" data-ct="' + (ct ? ct.id : '') + '" data-deal="' + (d ? d.id : '') + '">' + opts(db.templates.map(t => ({ v: t.id, t: t.name })), tpl.id) + '</select></label><label>Deal<select data-chg="mail-deal" data-ct="' + (ct ? ct.id : '') + '" data-tpl="' + tpl.id + '">' + opts(ds.map(x => ({ v: x.id, t: x.title })), d ? d.id : '', '– none –') + '</select></label><label class="full">To<input readonly value="' + esc(ct ? ct.email : '') + '"></label><label class="full">Subject<input readonly id="mailSubj" value="' + esc(subj) + '"></label><label class="full">Message<textarea readonly id="mailBody" rows="10">' + esc(body) + '</textarea></label></div>'
    });
  }
  function viewTemplates() {
    const sel = db.templates.filter(t => t.id === ui.tpl.id)[0] || db.templates[0];
    main.innerHTML = head('E-mail templates', 'Placeholders: {{contact}} {{fullname}} {{company}} {{deal}} {{value}} {{owner}}', '<button class="btn primary" data-act="tpl-new">+ New template</button>') +
      '<div class="grid g21"><section class="card"><h2>Edit template</h2>' + (sel ? '<form id="tplForm" data-id="' + sel.id + '"><div class="frm">' + fld('Name', 'name', sel.name, { req: 1, full: 1 }) + fld('Subject', 'subject', sel.subject, { full: 1 }) + fld('Body', 'body', sel.body, { area: 1, full: 1, rows: 12 }) + '</div><p><button class="btn primary" type="submit">Save template</button> <button class="btn" type="button" data-act="tpl-use" data-id="' + sel.id + '">Preview with a contact</button> <button class="btn danger" type="button" data-act="tpl-del" data-id="' + sel.id + '">Delete</button></p></form>' : '<p class="empty">No templates</p>') + '</section>' +
      '<section class="card"><h2>Templates</h2><ul class="list">' + db.templates.map(t => '<li><a href="#" data-act="tpl-pick" data-id="' + t.id + '"' + (sel && t.id === sel.id ? ' style="font-weight:700"' : '') + '>' + esc(t.name) + '</a></li>').join('') + '</ul></section></div>';
  }

  function viewTeam() {
    const cm = monthOf(todayIso()), tot = OWNERS.reduce((s, o) => s + wonInMonth(o.id, cm), 0), tt = OWNERS.reduce((s, o) => s + (db.targets[o.id] || 0), 0);
    const rows = OWNERS.map(o => { const w = wonInMonth(o.id, cm), tg = db.targets[o.id] || 0, op = db.deals.filter(d => d.ownerId === o.id && isOpen(d)); return { o: o, w: w, tg: tg, pc: tg ? Math.round(w / tg * 100) : 0, open: op.reduce((s, d) => s + dealValue(d), 0), n: op.length, y: wonByMonth(o.id).reduce((s, m) => s + m.value, 0) }; });
    main.innerHTML = head('Team targets', monthLabel(cm) + ' · ' + money(tot) + ' of ' + money(tt), '') +
      '<div class="card scroll"><table class="tbl"><thead><tr><th>Owner</th><th class="right">Monthly target (€)</th><th class="right">Won this month</th><th style="min-width:160px">Progress</th><th class="right">Open pipeline</th><th class="right">Won, 12 months</th></tr></thead><tbody>' +
      rows.map(r => '<tr><td>' + ownerAv(r.o.id) + ' ' + esc(r.o.name) + '</td><td class="right"><input type="number" min="0" step="100" value="' + r.tg + '" data-chg="target" data-id="' + r.o.id + '" aria-label="Target for ' + esc(r.o.name) + '" style="width:110px"></td><td class="right num">' + money(r.w) + '</td><td><div class="bar ok" role="progressbar" aria-valuenow="' + r.pc + '" aria-valuemin="0" aria-valuemax="100" aria-label="Progress"><i style="width:' + clamp(r.pc, 0, 100) + '%"></i></div><span class="small mut">' + r.pc + ' %</span></td><td class="right num">' + money(r.open) + ' <span class="small mut">(' + r.n + ')</span></td><td class="right num">' + money(r.y) + '</td></tr>').join('') + '</tbody></table></div>' +
      '<div class="grid g2" style="margin-top:12px">' + chartCard('teamwon', 'Team: won by month', cols(wonByMonth(''), tt), ['Month', 'Won'], wonByMonth('').map(m => [m.label, money(m.value)]), '<p class="small mut">Dashed line: total monthly target.</p>') +
      '<section class="card"><h2>Default targets</h2><p class="small mut">Targets start at 110 % of each person\'s average monthly won value over the last 12 months (minimum 5,000 €). Edit the values above to override them.</p><button class="btn" data-act="targets-reset">Recalculate defaults</button></section></div>';
  }

  /* duplicates */
  const normName = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\(.*?\)/g, '').replace(/d\.?o\.?o\.?|d\.?d\.?|gmbh/g, '').replace(/[^a-z0-9]/g, '');
  function findDuplicates() {
    if (dupCache) return dupCache;
    const ign = db.dupIgnore, key = (t, a, b) => t + ':' + Math.min(a, b) + '-' + Math.max(a, b), co = [], ct = [];
    const byVat = {}, byName = {}, byMail = {}, byNm = {};
    db.companies.forEach(c => { if (c.vat) (byVat[c.vat] = byVat[c.vat] || []).push(c); (byName[normName(c.name)] = byName[normName(c.name)] || []).push(c); });
    const seen = {}; const addC = (a, b, why) => { const k = key('c', a.id, b.id); if (seen[k] || ign.indexOf(k) >= 0) return; seen[k] = 1; co.push({ a: a, b: b, why: why, key: k }); };
    Object.keys(byVat).forEach(k => { const l = byVat[k]; for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) addC(l[i], l[j], 'Same VAT ID'); });
    Object.keys(byName).forEach(k => { const l = byName[k]; for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) addC(l[i], l[j], 'Similar name'); });
    db.contacts.forEach(c => { if (c.email) (byMail[c.email.toLowerCase()] = byMail[c.email.toLowerCase()] || []).push(c); const n = (c.first + c.last).toLowerCase() + '|' + (c.companyId || ''); (byNm[n] = byNm[n] || []).push(c); });
    const seen2 = {}; const addP = (a, b, why) => { const k = key('p', a.id, b.id); if (seen2[k] || ign.indexOf(k) >= 0) return; seen2[k] = 1; ct.push({ a: a, b: b, why: why, key: k }); };
    Object.keys(byMail).forEach(k => { const l = byMail[k]; for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) addP(l[i], l[j], 'Same e-mail'); });
    Object.keys(byNm).forEach(k => { const l = byNm[k]; for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) addP(l[i], l[j], 'Same name and company'); });
    return dupCache = { companies: co, contacts: ct };
  }
  function mergeCompanies(keepId, dropId) {
    const k = M().co.get(keepId), x = M().co.get(dropId); if (!k || !x) return; CO_FIELDS.forEach(f => { if (!k[f] && x[f]) k[f] = x[f]; }); k.tags = Array.from(new Set((k.tags || []).concat(x.tags || [])));
    db.contacts.forEach(c => { if (c.companyId === dropId) c.companyId = keepId; }); db.deals.forEach(d => { if (d.companyId === dropId) d.companyId = keepId; }); db.activities.forEach(a => { if (a.companyId === dropId) a.companyId = keepId; }); db.notes.forEach(n => { if (n.companyId === dropId) n.companyId = keepId; });
    db.companies = db.companies.filter(c => c.id !== dropId); commit('Companies merged');
  }
  function mergeContacts(keepId, dropId) {
    const k = M().ct.get(keepId), x = M().ct.get(dropId); if (!k || !x) return; ['role', 'email', 'phone'].forEach(f => { if (!k[f] && x[f]) k[f] = x[f]; });
    db.deals.forEach(d => { if (d.contactId === dropId) d.contactId = keepId; }); db.activities.forEach(a => { if (a.contactId === dropId) a.contactId = keepId; }); db.contacts = db.contacts.filter(c => c.id !== dropId); commit('Contacts merged');
  }
  function viewDuplicates() {
    const f = findDuplicates(), cc = c => '<b>' + esc(c.name) + '</b><br><span class="small mut">' + esc(c.city) + ' · ' + esc(c.vat || 'no VAT') + ' · ' + (M().dealsByCo[c.id] || []).length + ' deals · ' + (M().ctsByCo[c.id] || []).length + ' contacts</span>';
    const pc = c => '<b>' + esc(c.first + ' ' + c.last) + '</b><br><span class="small mut">' + esc(coName(c.companyId)) + ' · ' + esc(c.email) + '</span>';
    const row = (p, kind, fn) => '<tr><td>' + fn(p.a) + '</td><td>' + fn(p.b) + '</td><td>' + tag(p.why, 'amber') + '</td><td style="white-space:nowrap"><button class="btn sm" data-act="merge" data-t="' + kind + '" data-keep="' + p.a.id + '" data-drop="' + p.b.id + '">Keep left</button> <button class="btn sm" data-act="merge" data-t="' + kind + '" data-keep="' + p.b.id + '" data-drop="' + p.a.id + '">Keep right</button> <button class="btn sm ghost" data-act="dup-ignore" data-k="' + p.key + '">Not a duplicate</button></td></tr>';
    const tbl = (l, kind, fn) => l.length ? '<div class="scroll"><table class="tbl"><thead><tr><th>Record A</th><th>Record B</th><th>Why</th><th></th></tr></thead><tbody>' + l.map(p => row(p, kind, fn)).join('') + '</tbody></table></div>' : '<p class="empty">No duplicates found</p>';
    main.innerHTML = head('Duplicates', f.companies.length + ' company pairs · ' + f.contacts.length + ' contact pairs') + '<section class="card" style="margin-bottom:12px"><h2>Companies</h2>' + tbl(f.companies, 'co', cc) + '</section><section class="card"><h2>Contacts</h2>' + tbl(f.contacts, 'ct', pc) + '</section><p class="small mut">Merging moves contacts, deals, activities and notes to the kept record and fills empty fields from the other one.</p>';
  }

  /* data page: CSV import/export, sync, reset */
  const EXPORTS = {
    companies: [() => db.companies, ['id', 'name', 'segment', 'country', 'city', 'vat', 'email', 'phone', 'website', 'ownerId', 'source']],
    contacts: [() => db.contacts.map(c => Object.assign({}, c, { company: coName(c.companyId) })), ['id', 'first', 'last', 'company', 'role', 'email', 'phone', 'ownerId']],
    deals: [() => db.deals.map(d => ({ id: d.id, title: d.title, company: coName(d.companyId), stage: d.stage, value: Math.round(dealValue(d)), owner: OWNER[d.ownerId].name, created: d.created, expected: d.expected, lostReason: d.lostReason })), ['id', 'title', 'company', 'stage', 'value', 'owner', 'created', 'expected', 'lostReason']],
    activities: [() => db.activities.map(a => ({ id: a.id, type: a.type, title: a.title, due: a.due, done: a.done, owner: OWNER[a.ownerId].name, deal: (M().dl.get(a.dealId) || {}).title || '' })), ['id', 'type', 'title', 'due', 'done', 'owner', 'deal']]
  };
  function exportData(k) { const e = EXPORTS[k]; download('crm-' + k + '-' + todayIso() + '.csv', toCsv(e[0](), e[1])); }
  function impRun(text, kind) {
    const rows = parseCsv(text); if (!rows.length) { toast('No rows found. The first line must be a header.'); return; } let added = 0, skipped = 0;
    if (kind === 'companies') rows.forEach(r => {
      if (!r.name) { skipped++; return; } if (db.companies.some(c => (r.vat && c.vat === r.vat) || c.name.toLowerCase() === r.name.toLowerCase())) { skipped++; return; }
      db.companies.push({ id: nextId(), name: r.name, segment: SEG[r.segment] ? r.segment : 'Optician', country: r.country === 'HR' ? 'HR' : 'SI', city: r.city || '', vat: r.vat || '', email: r.email || '', phone: r.phone || '', website: r.website || '', ownerId: OWNER[r.ownerid] ? r.ownerid : ui.me || 'u1', source: r.source || 'Import', created: todayIso(), tags: [] }); added++; cache = null;
    });
    else rows.forEach(r => {
      if (!r.first && !r.last) { skipped++; return; } const co = db.companies.filter(c => c.name.toLowerCase() === (r.company || '').toLowerCase())[0];
      if (r.email && db.contacts.some(c => c.email.toLowerCase() === r.email.toLowerCase())) { skipped++; return; } db.contacts.push({ id: nextId(), first: r.first || '', last: r.last || '', companyId: co ? co.id : null, role: r.role || '', email: r.email || '', phone: r.phone || '', ownerId: co ? co.ownerId : ui.me || 'u1' }); added++;
    });
    commit('Imported ' + added + ', skipped ' + skipped);
  }
  function viewData() {
    const bytes = JSON.stringify(db).length;
    main.innerHTML = head('Data & sync', 'Everything is stored in this browser (IndexedDB)') + '<div class="grid g2"><section class="card"><h2>Export</h2><p class="small mut">Download CSV files (UTF-8, comma separated).</p><p>' + Object.keys(EXPORTS).map(k => '<button class="btn" data-act="export" data-k="' + k + '">' + k + '</button> ').join('') + '</p><h2 style="margin-top:16px">Import</h2><p class="small mut">Paste CSV or choose a file. Companies: name, segment, country, city, vat, email, phone, website. Contacts: first, last, company, role, email, phone. Existing VAT IDs, names or e-mails are skipped.</p>' +
      '<div class="frm"><label>Type<select id="impKind"><option value="companies">Companies</option><option value="contacts">Contacts</option></select></label><label>File<input id="impFile" type="file" accept=".csv,text/csv" data-chg="imp-file"></label><label class="full">or paste CSV<textarea id="impText" rows="5" placeholder="name,segment,country,city,vat\nOptika Example,Optician,SI,Ljubljana,SI11111111"></textarea></label></div><p><button class="btn primary" data-act="imp-run">Import</button></p></section>' +
      '<div class="grid" style="align-content:start"><section class="card"><h2>Cloud copy</h2><div id="syncCard"></div></section><section class="card"><h2>Cross-app link</h2><p class="small">' + (BUS.ok ? 'ERP catalogue: <b>' + BUS.catalog.length + '</b> products, <b>' + BUS.customers.length + '</b> customers (updated ' + fts(BUS.at) + ').' : 'No ERP data found yet. Open the <a href="/erp/">ERP</a> once to share its catalogue.') + '</p><p class="small mut">CRM publishes a summary for Analytics after each change.</p></section>' +
      '<section class="card"><h2>Demo data</h2><p class="small">' + db.companies.length + ' companies · ' + db.contacts.length + ' contacts · ' + db.deals.length + ' deals · ' + db.activities.length + ' activities · ~' + Math.round(bytes / 1024) + ' kB</p><button class="btn danger" data-act="reset">Reset demo data</button></section></div></div>';
    mountSyncPanel();
  }

  /* quick search */
  function quickSearch() {
    openModal({ title: 'Search', ok: null, foot: '<button class="btn" type="button" data-act="modal-close">Close</button>', body: '<input id="qsIn" type="search" placeholder="Companies, contacts, deals…" style="width:100%" autocomplete="off" aria-label="Search"><div class="search-r" id="qsOut" style="margin-top:8px"></div>' });
    const inp = $('#qsIn'), out = $('#qsOut'); let items = [], sel = 0;
    const draw = () => { out.innerHTML = items.length ? items.map((i, n) => '<a href="' + i.h + '" class="' + (n === sel ? 'sel' : '') + '"><span>' + esc(i.t) + '</span><span class="small mut">' + esc(i.k) + '</span></a>').join('') : inp.value ? '<p class="empty">No results</p>' : '<p class="empty small">Type to search</p>'; };
    inp.addEventListener('input', () => {
      const q = inp.value.toLowerCase().trim(); items = []; sel = 0;
      if (q) { db.companies.forEach(c => { if (c.name.toLowerCase().indexOf(q) >= 0 || (c.vat || '').toLowerCase() === q) items.push({ t: c.name, k: 'Company', h: '#/companies/' + c.id }); }); db.contacts.forEach(c => { if ((c.first + ' ' + c.last + ' ' + c.email).toLowerCase().indexOf(q) >= 0) items.push({ t: c.first + ' ' + c.last, k: 'Contact', h: '#/contacts/' + c.id }); }); db.deals.forEach(d => { if (d.title.toLowerCase().indexOf(q) >= 0) items.push({ t: d.title, k: 'Deal · ' + STAGE[d.stage].name, h: '#/deals/' + d.id }); }); items = items.slice(0, 14); }
      draw();
    });
    inp.addEventListener('keydown', e => { if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); draw(); e.preventDefault(); } else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); } else if (e.key === 'Enter' && items[sel]) { location.hash = items[sel].h; closeModal(); } });
    out.addEventListener('click', () => setTimeout(closeModal, 0)); draw();
  }

  /* ---------- sync (optional) ---------- */
  function attachSync() {
    try {
      sync = AdrialSync.attach({ app: 'crm', label: 'CRM data', getSnapshot: () => Promise.resolve(db), applySnapshot: async snap => { if (!validDb(snap)) return; db = migrate(snap); cache = null; silentNext = true; save(); await flushNow(); updateNav(); refresh(); } });
    } catch (e) { sync = null; }
  }
  function mountSyncPanel() { if (!sync || !sync.mountPanel) return; ['#syncSide', '#syncCard'].forEach(s => { const el = $(s); if (el) sync.mountPanel(el); }); }

  /* ---------- router + render ---------- */
  function parseHash() { const p = (location.hash || '#/').replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean); return { a: p[0] || '', b: p[1] || '', c: p[2] || '' }; }
  function render() {
    const h = parseHash(), a = h.a, b = h.b, navKey = a === 'quotes' ? 'deals' : a || 'home';
    $$('#nav a').forEach(x => { const on = x.dataset.nav === navKey; x.classList.toggle('on', on); if (on) x.setAttribute('aria-current', 'page'); else x.removeAttribute('aria-current'); });
    switch (a) {
      case '': viewHome(); break;
      case 'deals': b === 'list' ? viewDealList() : b ? viewDeal(b) : viewBoard(); break;
      case 'companies': b ? viewCompany(b) : viewCompanies(); break;
      case 'contacts': b ? viewContact(b) : viewContacts(); break;
      case 'activities': b === 'week' ? viewWeek() : viewActivities(); break;
      case 'quotes': b ? viewQuote(b) : viewMissing(); break;
      case 'digest': viewDigest(); break;
      case 'templates': viewTemplates(); break;
      case 'data': viewData(); break;
      case 'team': viewTeam(); break;
      case 'duplicates': viewDuplicates(); break;
      default: viewMissing();
    }
    document.title = (main.querySelector('h1') ? main.querySelector('h1').textContent + ' · ' : '') + 'CRM · Adrial Apps';
  }
  function route(keep) { if (!ready) return; render(); if (keep === false) window.scrollTo(0, 0); }
  function refresh() {
    if (!ready) return; const y = window.scrollY, f = document.activeElement, id = f && f.id && main.contains(f) ? f.id : '', ss = id && f.selectionStart != null ? [f.selectionStart, f.selectionEnd] : null;
    render(); window.scrollTo(0, y); if (id) { const e = document.getElementById(id); if (e) { e.focus(); if (ss) try { e.setSelectionRange(ss[0], ss[1]); } catch (x) {} } }
  }
  function updateNav() {
    if (!db) return; const set = (k, v) => { const e = $('[data-count="' + k + '"]'); if (e) e.textContent = v ? v : ''; };
    set('deals', myDeals().filter(isOpen).length); set('companies', db.companies.length); set('contacts', db.contacts.length);
    set('activities', db.activities.filter(a => mineOk(a) && actState(a) === 'overdue').length); const f = findDuplicates(); set('duplicates', f.companies.length + f.contacts.length);
  }
  function fillMe() { $('#meSel').innerHTML = '<option value="">Whole team</option>' + OWNERS.map(o => '<option value="' + o.id + '"' + (ui.me === o.id ? ' selected' : '') + '>' + esc(o.name) + '</option>').join(''); }

  /* ---------- delegated handlers ---------- */
  const ACT = {
    'modal-close'() { closeModal(); }, 'modal-bg'(el, e) { if (e.target === el) closeModal(); },
    'new-deal'(el) { const co = el.dataset.co ? M().co.get(+el.dataset.co) : null; dealForm(null, co ? { companyId: co.id, ownerId: co.ownerId, title: '' } : null); },
    'new-company'() { companyForm(); }, 'new-contact'(el) { contactForm(null, +el.dataset.co || ''); },
    'new-activity'(el) {
      const d = el.dataset, pre = {}; if (d.deal) { const dl = M().dl.get(+d.deal); Object.assign(pre, { dealId: dl.id, companyId: dl.companyId, contactId: dl.contactId || '', ownerId: dl.ownerId }); } if (d.co) pre.companyId = +d.co; if (d.ct) { const c = M().ct.get(+d.ct); pre.contactId = c.id; pre.companyId = c.companyId || ''; } if (d.due) pre.due = d.due; activityForm(null, pre);
    },
    'edit-act'(el) { activityForm(+el.dataset.id); }, 'edit-deal'(el) { dealForm(+el.dataset.id); }, 'edit-company'(el) { companyForm(+el.dataset.id); }, 'edit-contact'(el) { contactForm(+el.dataset.id); },
    'del-deal'(el) { deleteDeal(+el.dataset.id); }, 'del-company'(el) { deleteCompany(+el.dataset.id); }, 'del-contact'(el) { deleteContact(+el.dataset.id); },
    'new-note'(el) { noteForm({ dealId: +el.dataset.deal || null, companyId: +el.dataset.co || null }); },
    'del-note'(el) { db.notes = db.notes.filter(n => n.id !== +el.dataset.id); commit('Note deleted'); },
    'move'(el) { requestMove(+el.dataset.id, el.dataset.s); }, 'send-erp'(el) { sendToErpDialog(+el.dataset.id); },
    'new-quote'(el) { quoteForm(+el.dataset.id); }, 'quote-status'(el) { setQuoteStatus(+el.dataset.id, el.dataset.s); }, 'print'() { window.print(); },
    'del-quote'(el) { if (!confirm('Delete this quote?')) return; const q = db.quotes.filter(x => x.id === +el.dataset.id)[0]; db.quotes = db.quotes.filter(x => x !== q); commit('Quote deleted'); location.hash = '#/deals/' + q.dealId; },
    'tbl'(el) { tblView[el.dataset.k] = !tblView[el.dataset.k]; refresh(); }, 'export'(el) { exportData(el.dataset.k); },
    'dl-sort'(el) { const k = el.dataset.k; if (ui.dl.sort === k) ui.dl.dir = -ui.dl.dir; else { ui.dl.sort = k; ui.dl.dir = k === 'title' || k === 'company' ? 1 : -1; } saveUi(); refresh(); },
    'act-show'(el) { ui.act.show = el.dataset.k; ui.act.limit = 40; saveUi(); refresh(); }, 'act-more'() { ui.act.limit += 40; refresh(); },
    'week-nav'(el) { ui.week.offset = +el.dataset.k === 0 ? 0 : ui.week.offset + +el.dataset.k; refresh(); },
    'digest-nav'(el) { ui.digest.offset = +el.dataset.k === 0 ? 0 : ui.digest.offset + +el.dataset.k; refresh(); }, 'digest-copy'() { copyText(digestText(), 'Digest copied'); },
    'compose'(el) { composeEmail(+el.dataset.id); },
    'mail-copy'() { copyText($('#mailSubj').value + '\n\n' + $('#mailBody').value, 'E-mail text copied'); },
    'tpl-pick'(el) { ui.tpl.id = +el.dataset.id; saveUi(); refresh(); },
    'tpl-new'() { const id = nextId(); db.templates.push({ id: id, name: 'New template', subject: 'Subject', body: 'Hello {{contact}},\n\n' }); ui.tpl.id = id; saveUi(); commit('Template added'); },
    'tpl-del'(el) { if (!confirm('Delete this template?')) return; db.templates = db.templates.filter(t => t.id !== +el.dataset.id); ui.tpl.id = 0; saveUi(); commit('Template deleted'); },
    'tpl-use'(el) { composeEmail(db.contacts[0] ? db.contacts[0].id : 0, +el.dataset.id); },
    'targets-reset'() { delete db.targets; migrate(db); commit('Targets recalculated'); },
    'merge'(el) { const d = el.dataset; if (!confirm('Merge the two records? This cannot be undone.')) return; d.t === 'co' ? mergeCompanies(+d.keep, +d.drop) : mergeContacts(+d.keep, +d.drop); },
    'dup-ignore'(el) { db.dupIgnore.push(el.dataset.k); commit('Marked as not a duplicate'); },
    'imp-run'() { const t = $('#impText').value; if (!t.trim()) { toast('Paste CSV or choose a file first'); return; } impRun(t, $('#impKind').value); },
    'reset'() { resetDemo(); },
    'line-add'() { $('#lbody').insertAdjacentHTML('beforeend', lineRow({ name: '', qty: 1, price: 0, disc: 0 })); const r = $$('#lbody .lrow'); r[r.length - 1].querySelector('select').focus(); },
    'line-del'(el) { el.closest('.lrow').remove(); }
  };
  const CHG = {
    'dealco'(el) { const f = el.form, c = f.elements.contactId; c.innerHTML = ctOpts(el.value, '', '– none –'); const co = M().co.get(+el.value); if (co && f.elements.ownerId) f.elements.ownerId.value = co.ownerId; },
    'linepick'(el) {
      const row = el.closest('.lrow'), v = el.value, set = (n, x) => { $('[name=' + n + ']', row).value = x; };
      if (v.indexOf('p:') === 0) { const p = PRODUCT_BY(v.slice(2)); set('lpid', p.id); set('lsku', ''); set('lname', p.name); set('lprice', p.price); }
      else if (v.indexOf('s:') === 0) { const p = BUS.catalog.filter(x => x.sku === v.slice(2))[0]; set('lpid', ''); set('lsku', p.sku); set('lname', p.name); set('lprice', p.price); } else { set('lpid', ''); set('lsku', ''); }
      INP.lineqty($('[name=lqty]', row));
    },
    'act-toggle'(el) { const a = M().act.get(+el.dataset.id); if (!a) return; a.done = el.checked; a.doneAt = a.done ? todayIso() : null; const d = a.dealId && M().dl.get(a.dealId); if (d) d.updated = Date.now(); commit(a.done ? 'Activity done' : null); },
    'dl-stage'(el) { ui.dl.stage = el.value; saveUi(); refresh(); }, 'co-seg'(el) { ui.co.seg = el.value; saveUi(); refresh(); }, 'co-own'(el) { ui.co.own = el.value; saveUi(); refresh(); }, 'act-type'(el) { ui.act.type = el.value; saveUi(); refresh(); },
    'mail-tpl'(el) { composeEmail(+el.dataset.ct, +el.value, +el.dataset.deal); }, 'mail-deal'(el) { composeEmail(+el.dataset.ct, +el.dataset.tpl, +el.value); },
    'target'(el) { db.targets[el.dataset.id] = Math.max(0, +el.value || 0); commit('Target saved'); },
    'imp-file'(el) { const f = el.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => { $('#impText').value = r.result; toast('File loaded. Press Import.'); }; r.readAsText(f); }
  };
  const PRODUCT_BY = id => CPRODUCTS.filter(p => p.id === id)[0];
  const INP = {
    'board-q'(el) { ui.board.q = el.value; saveUi(); refresh(); }, 'dl-q'(el) { ui.dl.q = el.value; saveUi(); refresh(); }, 'co-q'(el) { ui.co.q = el.value; saveUi(); refresh(); }, 'ct-q'(el) { ui.ct.q = el.value; saveUi(); refresh(); },
    'lineqty'(el) { const row = el.closest('.lrow'), sku = $('[name=lsku]', row).value, w = $('.stk', row); if (!w) return; w.textContent = stockWarn({ sku: sku, qty: +el.value }); }
  };

  document.addEventListener('click', e => {
    if (suppressClick) { e.preventDefault(); e.stopPropagation(); return; }
    const m = $('#newMenu'); if (m && !m.hidden && !e.target.closest('.newmenu')) m.hidden = true;
    const b = e.target.closest('[data-act]'); if (!b) return; const f = ACT[b.dataset.act]; if (!f) return; if (b.tagName === 'A') e.preventDefault(); if (m) m.hidden = true; f(b, e);
  }, true);
  document.addEventListener('change', e => { const b = e.target.closest('[data-chg]'); if (b && CHG[b.dataset.chg]) CHG[b.dataset.chg](b, e); });
  document.addEventListener('input', e => { const b = e.target.closest('[data-inp]'); if (b && INP[b.dataset.inp]) INP[b.dataset.inp](b, e); });
  document.addEventListener('submit', e => {
    e.preventDefault(); const f = e.target;
    if (f.id === 'tplForm') { const t = db.templates.filter(x => x.id === +f.dataset.id)[0], o = fd(f); if (t) { t.name = o.name; t.subject = o.subject; t.body = o.body; commit('Template saved'); } return; }
    if (modal && modal.onOk) { const r = modal.onOk(f); if (r !== false) closeModal(); }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { if (modal) closeModal(); const m = $('#newMenu'); if (m) m.hidden = true; return; }
    const tg = e.target, typing = /^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName);
    if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') || (e.key === '/' && !typing)) { e.preventDefault(); if (ready && !modal) quickSearch(); return; }
    if (tg.classList && tg.classList.contains('dcard') && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      const d = M().dl.get(+tg.dataset.deal), i = STAGES.indexOf(STAGE[d.stage]) + (e.key === 'ArrowRight' ? 1 : -1); if (i >= 0 && i < STAGES.length) { e.preventDefault(); requestMove(d.id, STAGES[i].id); setTimeout(() => { const n = document.getElementById('dc-' + d.id); n && n.focus(); }, 30); }
    }
  });
  main.addEventListener('pointerdown', dragStart);
  main.addEventListener('dragstart', e => { if (e.target.closest && e.target.closest('.dcard')) e.preventDefault(); });
  document.addEventListener('pointermove', dragMove, { passive: false });
  document.addEventListener('pointerup', dragEnd);
  document.addEventListener('pointercancel', () => { if (drag) { drag.ghost && drag.ghost.remove(); drag.el.classList.remove('drag'); drag = null; $$('.col-b.over').forEach(x => x.classList.remove('over')); } });
  $('#newBtn').addEventListener('click', e => { e.stopPropagation(); const m = $('#newMenu'); m.hidden = !m.hidden; });
  $('#searchBtn').addEventListener('click', () => ready && quickSearch());
  $('#meSel').addEventListener('change', e => { ui.me = e.target.value; saveUi(); updateNav(); refresh(); });
  window.addEventListener('hashchange', () => { if (modal) closeModal(); route(false); });
  window.addEventListener('adrial-theme', () => refresh());
  window.addEventListener('pagehide', flushNow); document.addEventListener('visibilitychange', () => { if (document.hidden) flushNow(); });

  /* ---------- boot ---------- */
  loadUi(); fillMe();
  try { bc = new BroadcastChannel('adrial-crm'); bc.onmessage = e => { if (e.data && e.data.type === 'changed' && e.data.from !== TAB_ID) syncFromIdb(); }; } catch (e) {}
  Promise.all([loadDb(), busLoad()]).catch(() => { db = migrate(D.generate(Date.now())); setTimeout(() => toast('Storage is not available. Changes will not be saved.', 5000), 300); }).then(() => {
    ready = true; updateNav(); route(false); busSync(); publishSoon(400); attachSync(); mountSyncPanel();
    AdrialBus.on(evt => {
      if (!evt) return;
      if (evt.kind === 'snapshot' && /^erp\./.test(evt.key || '')) busLoad().then(() => { if (!modal && /^#\/(deals\/\d|data|companies)/.test(location.hash)) refresh(); });
      if (evt.kind === 'message') busSync();
    });
  });
})();
