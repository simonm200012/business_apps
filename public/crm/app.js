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
    db = d;
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
    commit(stage === 'won' ? 'Deal won 🎉 You can now send it to the ERP' : 'Moved to ' + STAGE[stage].name);
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
