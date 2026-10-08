/* Billing (Adrial Apps). Static app: all data lives in this browser (IndexedDB).
 * Issued documents are frozen snapshots; every change is appended to a SHA-256 hash chain. */
(function () {
  'use strict';
  const C = window.BillingCore;
  const VERSION = '1.0';
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`);
  const clone = (v) => JSON.parse(JSON.stringify(v));

  const DEFAULT_SETTINGS = {
    companyName: '', address: '', postalCity: '', vatRegistered: true, vatId: '', taxNumber: '',
    registrationNumber: '', court: '', shareCapital: '', iban: '', bic: '', bank: '', email: '', phone: '', web: '',
    numberPrefix: '', paymentDays: 15, defaultVatRate: 22, lang: 'sl', footer: '',
  };
  const emptyState = () => ({
    version: 1, settings: { ...DEFAULT_SETTINGS }, counters: {}, clients: [], contracts: [], work: [], invoices: [], runs: [], audit: [],
    meta: { createdAt: new Date().toISOString(), lastBackupAt: null, sample: false },
  });

  // ---------- storage ----------
  const DB = 'adrial-billing', STORE = 'kv';
  let dbp = null;
  function idb() {
    if (!dbp) dbp = new Promise((res, rej) => {
      const q = indexedDB.open(DB, 1);
      q.onupgradeneeded = () => q.result.createObjectStore(STORE);
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
    return dbp;
  }
  async function readState() {
    const db = await idb();
    return new Promise((res, rej) => { const r = db.transaction(STORE).objectStore(STORE).get('state'); r.onsuccess = () => res(r.result || null); r.onerror = () => rej(r.error); });
  }
  async function writeState(s) {
    const db = await idb();
    return new Promise((res, rej) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(s, 'state'); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
  }
  // One writer at a time across tabs, so two tabs can never take the same invoice number.
  const withLock = (fn) => (navigator.locks ? navigator.locks.request('adrial-billing', fn) : fn());
  const channel = 'BroadcastChannel' in window ? new BroadcastChannel('adrial-billing') : null;

  async function sha256(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  async function appendAudit(s, type, summary, data) {
    const prev = s.audit.length ? s.audit[s.audit.length - 1].hash : 'GENESIS';
    const ev = { seq: s.audit.length + 1, at: new Date().toISOString(), type, summary, data: data || {}, prev };
    ev.hash = await sha256(prev + C.canonical(ev));
    s.audit.push(ev);
  }
  // Every change goes through here: lock, re-read, apply, log, write, broadcast.
  async function mutate(type, summary, fn, { audit = true } = {}) {
    return withLock(async () => {
      const s = (await readState()) || emptyState();
      const r = (await fn(s)) || {};
      if (audit) await appendAudit(s, type, r.summary || summary, r.audit || {});
      await writeState(s);
      state = s;
      if (channel) channel.postMessage('changed');
      render();
      return r;
    });
  }
  async function verifyIntegrity(s) {
    const problems = [];
    let prev = 'GENESIS';
    for (const ev of s.audit) {
      const { hash, ...rest } = ev;
      if (rest.prev !== prev) problems.push(`Log entry ${ev.seq}: the chain is broken`);
      if ((await sha256(rest.prev + C.canonical(rest))) !== hash) problems.push(`Log entry ${ev.seq} (${ev.type}) was changed after it was written`);
      prev = hash;
    }
    const issued = s.invoices.filter((i) => i.number);
    for (const inv of issued) {
      const ev = s.audit.find((e) => e.type === 'document.issue' && e.data && e.data.id === inv.id);
      if (!ev) problems.push(`${inv.number}: no issue entry in the log`);
      else if (ev.data.snapshotHash !== (await sha256(C.canonical(inv.snapshot)))) problems.push(`${inv.number}: content differs from what was issued`);
    }
    const byYear = {};
    for (const i of issued) (byYear[i.year] = byYear[i.year] || []).push(i.seq);
    for (const [y, seqs] of Object.entries(byYear)) {
      seqs.sort((a, b) => a - b);
      for (let k = 1; k <= seqs[seqs.length - 1]; k++) if (!seqs.includes(k)) problems.push(`${y}: number ${k} is missing`);
      if (new Set(seqs).size !== seqs.length) problems.push(`${y}: a number is used twice`);
      if ((s.counters[y] || 0) !== seqs[seqs.length - 1]) problems.push(`${y}: counter ${s.counters[y]} differs from the last number ${seqs[seqs.length - 1]}`);
    }
    return { problems, events: s.audit.length, documents: issued.length };
  }

  // ---------- state & helpers ----------
  let state = emptyState();
  let route = { page: 'overview', id: null };
  let editing = null; // { doc, dirty }
  let invoiceFilter = 'all';
  let kirRange = 'last_month';
  let kirCustom = { from: '', to: '' };
  let rpoMonth = C.prevMonth(C.todayIso().slice(0, 7));
  let runPeriod = C.todayIso().slice(0, 7);
  let workFilter = 'unbilled';
  let searchQ = '';
  let integrityProblems = [];

  const client = (id) => state.clients.find((c) => c.id === id);
  const docById = (id) => state.invoices.find((i) => i.id === id);
  const statusOf = (inv) => C.statusOf(state, inv);
  const STATUS_LABEL = { draft: 'Draft', issued: 'Issued', partly_paid: 'Partly paid', paid: 'Paid', overdue: 'Overdue', credited: 'Credited' };
  const docTotal = (inv) => (inv.number ? inv.snapshot.totals.total : C.computeTotals(inv, state.settings).total);
  const docLabel = (inv) => (inv.kind === 'credit_note' ? 'Credit note' : 'Invoice');
  const docName = (inv) => inv.number || `${docLabel(inv)} draft`;
  const settingsComplete = () => {
    const s = state.settings;
    return !!(s.companyName && s.address && s.postalCity && (s.vatRegistered ? C.vatIdLooksValid(s.vatId) : C.siTaxNumberValid(s.taxNumber)) && C.ibanValid(s.iban));
  };

  function toast(msg) {
    const el = document.createElement('div');
    el.className = 'toast'; el.setAttribute('role', 'status'); el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }
  function download(name, data, type) {
    const blob = data instanceof Blob ? data : new Blob([data], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }
  async function guard(fn) {
    try { return await fn(); } catch (e) { console.error(e); alertBox('That did not work', String(e.message || e)); }
  }

  // ---------- icons ----------
  const ICON = {
    receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
    play: '<circle cx="12" cy="12" r="9"/><path d="M10 9l5 3-5 3z"/>',
    users: '<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 4a3 3 0 0 1 0 6M21 20a6 6 0 0 0-4-5.6"/>',
    doc: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1c.6.5 1.3.9 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    download: '<path d="M12 4v12M7 11l5 5 5-5M5 20h14"/>',
  };
  const icon = (name, size = 20) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;

  // ---------- sidebar ----------
  function renderSide() {
    const s = state.settings;
    const drafts = state.invoices.filter((i) => !i.number).length;
    const overdue = state.invoices.filter((i) => statusOf(i) === 'overdue').length;
    const unbilled = state.work.filter((w) => w.billable && !w.invoiceId).length;
    const initials = (s.companyName || 'Billing').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
    const cur = (p) => (route.page === p || (p === 'invoices' && route.page === 'doc') ? ' aria-current="page"' : '');
    const item = (p, ic, label, extra = '') => `<a class="navitem" href="#${p}"${cur(p)}>${icon(ic)}<span class="grow">${label}</span>${extra}</a>`;
    $('#side').innerHTML = `
      <div class="brand"><div class="brand-tile">${icon('receipt', 22)}</div>
        <div><b>Billing</b><span class="mono">${esc(s.companyName || 'Set up your company')}</span></div></div>
      <button type="button" class="chip-user" data-act="go" data-to="settings">
        <span class="avatar">${esc(initials || 'B')}</span>
        <span style="min-width:0"><b>${esc(s.companyName || 'Your company')}</b><span class="mono">${esc(s.vatRegistered ? (s.vatId || 'VAT ID missing') : `Davčna št. ${s.taxNumber || '—'}`)}</span></span>
      </button>
      <nav class="main" aria-label="Main">
        <div class="navgroup">
          ${item('overview', 'grid', 'Overview')}
          ${item('invoices', 'file', 'Invoices', overdue ? `<span class="pill-tag bad mono">${overdue} overdue</span>` : drafts ? `<span class="pill-tag mono">${drafts} draft${drafts > 1 ? 's' : ''}</span>` : '')}
          ${item('run', 'play', 'Billing run', '<span class="pill-tag mono">Monthly</span>')}
        </div>
        <div class="navgroup"><span class="navlabel mono">Clients</span>
          ${item('clients', 'users', 'Clients', `<span class="count mono">${state.clients.length}</span>`)}
          ${item('contracts', 'doc', 'Contracts', `<span class="count mono">${state.contracts.length}</span>`)}
          ${item('work', 'clock', 'Work log', unbilled ? `<span class="count mono">${unbilled}</span>` : '')}
        </div>
        <div class="navgroup"><span class="navlabel mono">Reports</span>
          ${item('kir', 'book', 'VAT ledger')}
          ${item('rpo', 'globe', 'EU summary')}
        </div>
        <div class="navgroup"><span class="navlabel mono">Account</span>
          ${item('settings', 'gear', 'Settings')}
          ${item('audit', 'list', 'Audit log', `<span class="count mono">${state.audit.length}</span>`)}
          ${item('compliance', 'shield', 'Compliance', '<span class="pill-tag mono">SI</span>')}
        </div>
      </nav>
      <div class="side-foot mono"><span>Stored in this browser only</span><span>v${VERSION} · Billing</span></div>`;
  }

  // ---------- shared fragments ----------
  const statusPill = (st) => `<span class="status ${st}">${STATUS_LABEL[st] || st}</span>`;
  function topbar(actions = '') {
    return `<div class="topbar">
      <div class="search">${icon('search', 18)}<label class="mono" for="q" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">Search invoices and clients</label>
        <input id="q" type="search" autocomplete="off" placeholder="Search invoices, clients" value="${esc(searchQ)}">
        <div id="qres"></div></div>
      <div class="top-actions">${actions}</div></div>`;
  }
  function searchResults() {
    const q = searchQ.trim().toLowerCase();
    if (!q) return '';
    const docs = state.invoices.filter((i) => (i.number || '').toLowerCase().includes(q) || (client(i.clientId)?.name || '').toLowerCase().includes(q)).slice(0, 6);
    const cl = state.clients.filter((c) => c.name.toLowerCase().includes(q) || (c.vatId || '').toLowerCase().includes(q)).slice(0, 4);
    if (!docs.length && !cl.length) return '<div class="search-results"><div class="empty small">No matches</div></div>';
    return `<div class="search-results" role="listbox">
      ${docs.map((d) => `<button type="button" data-act="go" data-to="doc/${d.id}">${icon('file', 18)}<span class="grow">${esc(docName(d))} · ${esc(client(d.clientId)?.name || '')}</span><span class="mono small muted">${C.eur(docTotal(d))}</span></button>`).join('')}
      ${cl.map((c) => `<button type="button" data-act="edit-client" data-id="${c.id}">${icon('users', 18)}<span class="grow">${esc(c.name)}</span><span class="mono small muted">${esc(c.vatId || c.country)}</span></button>`).join('')}
    </div>`;
  }
  function banners() {
    const out = [];
    if (integrityProblems.length) out.push(['bad', 'Integrity problem', `Data in this browser no longer matches its log (${integrityProblems.length} issue${integrityProblems.length === 1 ? '' : 's'}). Don't issue new invoices; restore your last good backup.`, '<button class="btn small" data-act="verify">Details</button>']);
    if (state.meta.sample) out.push(['warn', 'Sample data', 'This is a fictional company with sample clients and invoices. Delete everything in Settings before issuing real invoices.', '<button class="btn small" data-act="go" data-to="settings">Settings</button>']);
    if (!settingsComplete() && !state.meta.sample) out.push(['bad', 'Company details missing', 'Add your company name, address, VAT ID or tax number and IBAN before issuing invoices.', '<button class="btn small" data-act="go" data-to="settings">Add details</button>']);
    const issued = state.invoices.some((i) => i.number);
    const last = state.meta.lastBackupAt;
    if (issued && (!last || Date.now() - new Date(last).getTime() > 30 * 864e5)) out.push(['warn', 'Back up your invoices', `Invoices are kept only in this browser and must be kept for 10 years. ${last ? `Last backup ${C.dmy(last.slice(0, 10))}.` : 'No backup yet.'}`, '<button class="btn small" data-act="backup">Download backup</button>']);
    return out.map(([k, t, m, a]) => `<div class="banner ${k}"><span class="dot"></span><b>${t}</b><span class="mono grow">${m}</span>${a}</div>`).join('');
  }
  const pageHead = (title, lede, actions = '') => `<div class="head-row"><div style="flex:1 1 420px"><h1 class="title">${esc(title)}<i>.</i></h1>${lede ? `<p class="lede">${lede}</p>` : ''}</div>${actions ? `<div class="top-actions">${actions}</div>` : ''}</div>`;

  // ---------- Overview ----------
  function pageOverview() {
    const today = C.todayIso();
    const W = (c) => C.eur(c, { whole: true });
    const ym = today.slice(0, 7);
    const year = Number(today.slice(0, 4));
    const issued = state.invoices.filter((i) => i.number);
    const inYear = issued.filter((i) => i.year === year);
    const invoiced = inYear.filter((i) => i.kind !== 'credit_note').reduce((a, i) => a + i.snapshot.totals.total, 0);
    const credited = -inYear.filter((i) => i.kind === 'credit_note').reduce((a, i) => a + i.snapshot.totals.total, 0);
    let notDue = 0, overdue = 0, overdueN = 0;
    for (const i of issued) {
      const o = C.outstandingCents(state, i);
      if (!o) continue;
      if (statusOf(i) === 'overdue') { overdue += o; overdueN++; } else notDue += o;
    }
    const monthDocs = issued.filter((i) => C.monthOf(i.issueDate) === ym);
    const mBase = monthDocs.reduce((a, i) => a + i.snapshot.totals.net, 0);
    const mVat = monthDocs.reduce((a, i) => a + i.snapshot.totals.vat, 0);
    const unbilled = state.work.filter((w) => w.billable && !w.invoiceId);
    const uHours = unbilled.filter((w) => w.mode !== 'fixed').reduce((a, w) => a + C.cents((Number(w.hours) || 0) * (Number(w.rate) || 0)), 0);
    const uFixed = unbilled.filter((w) => w.mode === 'fixed').reduce((a, w) => a + C.cents(w.amount), 0);

    const months = [];
    let m = ym;
    for (let k = 0; k < 12; k++) { months.unshift(m); m = C.prevMonth(m); }
    const inv = months.map((mm) => issued.filter((i) => C.monthOf(i.issueDate) === mm).reduce((a, i) => a + i.snapshot.totals.total, 0));
    const paid = months.map((mm) => state.invoices.reduce((a, i) => a + (i.payments || []).filter((p) => C.monthOf(p.date) === mm).reduce((b, p) => b + p.amount, 0), 0));
    const max = Math.max(1, ...inv, ...paid);
    const bars = months.map((mm, k) => `<div class="col" title="${mm}: invoiced ${C.eur(inv[k])}, paid ${C.eur(paid[k])}"><div class="stack"><div class="b" style="height:${Math.max(2, inv[k] / max * 150)}px"></div><div class="b paid" style="height:${Math.max(2, paid[k] / max * 150)}px"></div></div><span class="m mono">${mm.slice(5)}</span></div>`).join('');

    const card = (title, sub, a, opA, b, opB, total) => `<div class="card"><h3>${title}</h3><div class="sub mono">${sub}</div>
      <div class="tiles"><div class="tile"><span class="k mono">${a[0]}</span><span class="v">${a[1]}</span>${a[2] ? `<span class="s mono">${a[2]}</span>` : ''}</div><span class="op mono">${opA}</span>
      <div class="tile"><span class="k mono">${b[0]}</span><span class="v">${b[1]}</span>${b[2] ? `<span class="s mono">${b[2]}</span>` : ''}</div><span class="op mono">${opB}</span>
      <div class="tile inv"><span class="k mono">${total[0]}</span><span class="v">${total[1]}</span></div></div></div>`;

    const attention = [];
    for (const i of issued.filter((x) => statusOf(x) === 'overdue').slice(0, 5)) attention.push(`<tr class="click" data-act="go" data-to="doc/${i.id}"><td>${statusPill('overdue')}</td><td>${esc(i.number)} · ${esc(client(i.clientId)?.name || i.snapshot.customer.name)}</td><td class="num">${C.eur(C.outstandingCents(state, i))}</td><td class="mono small muted">due ${C.dmy(i.dueDate)}</td></tr>`);
    const day = Number(today.slice(8, 10));
    for (const d of state.invoices.filter((x) => !x.number)) {
      const t = C.TREATMENTS[d.treatment];
      const late = t && t.by15th && d.supplyTo && C.monthOf(d.supplyTo || d.supplyFrom) < ym;
      attention.push(`<tr class="click" data-act="go" data-to="doc/${d.id}"><td>${statusPill('draft')}</td><td>${esc(docName(d))} · ${esc(client(d.clientId)?.name || 'No client')}</td><td class="num">${C.eur(docTotal(d))}</td><td class="mono small ${late && day >= 10 ? '' : 'muted'}" style="${late && day >= 10 ? 'color:var(--bad)' : ''}">${late ? 'EU supply: issue by the 15th' : 'not issued'}</td></tr>`);
    }

    return `${topbar('<button class="btn primary" data-act="new-invoice">' + icon('plus', 18) + 'New invoice</button>')}
      ${banners()}
      ${pageHead('Overview', `Invoicing for ${esc(state.settings.companyName || 'your company')}: what you've invoiced, what's still owed and what needs your attention.`)}
      <div class="grid2">
        ${card('Receivables', 'Issued, not yet paid', ['Not yet due', W(notDue)], '+', ['Overdue', W(overdue), `${overdueN} invoice${overdueN === 1 ? '' : 's'}`], '=', ['Outstanding', W(notDue + overdue)])}
        ${card(`Invoiced in ${year}`, 'Totals incl. VAT, by issue date', ['Invoices', W(invoiced)], '−', ['Credit notes', W(credited)], '=', ['Net invoiced', W(invoiced - credited)])}
        ${card(`This month · ${ym}`, 'Documents issued this month', ['Base', W(mBase)], '+', ['Output VAT', W(mVat)], '=', ['Total', W(mBase + mVat)])}
        ${card('Ready to bill', 'Unbilled entries in the work log', ['Hours', W(uHours)], '+', ['Fixed', W(uFixed)], '=', ['Unbilled', W(uHours + uFixed)])}
      </div>
      <div class="grid2">
        <div class="card"><h3>Last 12 months</h3><div class="sub mono">Invoiced (incl. VAT) vs. paid</div><div class="bars">${bars}</div><div class="legend mono"><span><i></i>Invoiced</span><span><i class="paid"></i>Paid</span></div></div>
        <div class="card table-card"><div class="table-head"><h3>Needs attention</h3></div>
          ${attention.length ? `<div class="tw"><table><tbody>${attention.join('')}</tbody></table></div>` : '<div class="empty">Nothing overdue and no drafts waiting.</div>'}</div>
      </div>`;
  }

  // ---------- Invoices ----------
  function pageInvoices() {
    const all = [...state.invoices].sort((a, b) => (b.issueDate || '9999').localeCompare(a.issueDate || '9999') || (b.seq || 0) - (a.seq || 0));
    const f = {
      all: () => true, draft: (i) => !i.number, open: (i) => ['issued', 'partly_paid', 'overdue'].includes(statusOf(i)) && i.kind !== 'credit_note',
      overdue: (i) => statusOf(i) === 'overdue', paid: (i) => statusOf(i) === 'paid', credit: (i) => i.kind === 'credit_note',
    }[invoiceFilter];
    const rows = all.filter(f);
    const segs = [['all', 'All'], ['draft', 'Drafts'], ['open', 'Open'], ['overdue', 'Overdue'], ['paid', 'Paid'], ['credit', 'Credit notes']]
      .map(([k, l]) => `<button type="button" aria-pressed="${invoiceFilter === k}" data-act="inv-filter" data-v="${k}">${l}</button>`).join('');
    return `${topbar('<button class="btn primary" data-act="new-invoice">' + icon('plus', 18) + 'New invoice</button>')}
      ${pageHead('Invoices', 'Drafts can be changed or deleted. Issued documents are locked: correct them with a credit note.')}
      <div class="card table-card"><div class="table-head"><h3>${rows.length} document${rows.length === 1 ? '' : 's'}</h3><div class="seg" role="group" aria-label="Filter">${segs}</div></div>
      ${rows.length ? `<div class="tw"><table><thead><tr><th>Number</th><th>Client</th><th>Issued</th><th>Due</th><th class="num">Total</th><th class="num">Outstanding</th><th>Status</th></tr></thead><tbody>
        ${rows.map((i) => `<tr class="click" data-act="go" data-to="doc/${i.id}"><td class="mono">${esc(i.number || '—')}${i.kind === 'credit_note' ? ' <span class="pill-tag">credit</span>' : ''}</td><td>${esc(client(i.clientId)?.name || i.snapshot?.customer.name || '—')}</td><td class="mono small">${C.dmy(i.issueDate)}</td><td class="mono small">${C.dmy(i.dueDate)}</td><td class="num">${C.eur(docTotal(i))}</td><td class="num">${i.number && i.kind !== 'credit_note' ? C.eur(C.outstandingCents(state, i)) : ''}</td><td>${statusPill(statusOf(i))}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">No documents here yet.</div>'}</div>`;
  }

  function newDraft(clientId, extra = {}) {
    const c = client(clientId);
    return {
      id: uid(), kind: 'invoice', clientId: clientId || '', treatment: c?.treatment || 'domestic', lang: c?.lang || state.settings.lang || 'sl',
      supplyFrom: C.todayIso(), supplyTo: '', paymentDays: Number(c?.paymentDays || state.settings.paymentDays || 15), note: '',
      lines: [{ description: '', qty: 1, unit: 'kos', unitPrice: 0, discountPct: 0, vatRate: Number(state.settings.defaultVatRate) }],
      payments: [], createdAt: new Date().toISOString(), ...extra,
    };
  }
  async function createDraft(doc, summary) {
    await mutate('document.draft', summary, (s) => { s.invoices.push(doc); return { audit: { id: doc.id, kind: doc.kind } }; });
    location.hash = `doc/${doc.id}`;
  }

  function pageDoc() {
    const doc = docById(route.id);
    if (!doc) return `${topbar()}<div class="empty">This document no longer exists. <a href="#invoices">Back to invoices</a></div>`;
    return doc.number ? viewIssued(doc) : viewDraft(doc);
  }

  // Draft editor. Edits live in `editing` until saved; totals update without re-rendering inputs.
  function viewDraft(doc) {
    if (!editing || editing.doc.id !== doc.id) editing = { doc: clone(doc), dirty: false };
    const d = editing.doc;
    const s = state.settings;
    const credit = d.kind === 'credit_note';
    const orig = credit ? docById(d.creditOf) : null;
    const vatOn = s.vatRegistered && (C.TREATMENTS[d.treatment] || {}).vat;
    const opt = (v, l, cur) => `<option value="${esc(v)}"${String(v) === String(cur) ? ' selected' : ''}>${esc(l)}</option>`;
    const lineRows = d.lines.map((l, k) => `<tr>
      <td style="min-width:240px"><input data-line="${k}" data-lf="description" value="${esc(l.description)}" placeholder="Service or goods" aria-label="Description"></td>
      <td style="width:90px"><input data-line="${k}" data-lf="qty" type="number" step="any" value="${esc(l.qty)}" aria-label="Quantity"></td>
      <td style="width:80px"><input data-line="${k}" data-lf="unit" value="${esc(l.unit || '')}" aria-label="Unit"></td>
      <td style="width:120px"><input data-line="${k}" data-lf="unitPrice" type="number" step="0.01" value="${esc(l.unitPrice)}" aria-label="Unit price excl. VAT"></td>
      <td style="width:80px"><input data-line="${k}" data-lf="discountPct" type="number" step="any" min="0" max="100" value="${esc(l.discountPct || 0)}" aria-label="Discount %"></td>
      <td style="width:96px"><select data-line="${k}" data-lf="vatRate" aria-label="VAT rate"${vatOn ? '' : ' disabled'}>${C.VAT_RATES.map((r) => opt(r, `${String(r).replace('.', ',')} %`, l.vatRate)).join('')}</select></td>
      <td class="num" data-amount="${k}" style="width:120px"></td>
      <td style="width:44px"><button class="btn small" type="button" data-act="del-line" data-k="${k}" aria-label="Remove line">×</button></td></tr>`).join('');
    return `${topbar()}
      ${pageHead(credit ? 'Credit note draft' : 'Invoice draft', credit
        ? `Credit note for invoice <b>${esc(orig?.number || '?')}</b> of ${C.dmy(orig?.issueDate)}. Use negative quantities for what you are crediting.`
        : 'Fill in the client, the supply date and the lines. Nothing is numbered until you issue it.',
        `<button class="btn danger" data-act="delete-draft">Delete draft</button><button class="btn" data-act="preview-pdf">${icon('download', 18)}Preview PDF</button><button class="btn" data-act="save-draft">Save draft</button><button class="btn primary" data-act="issue-dialog">Issue…</button>`)}
      <div class="card"><div class="form">
        <div class="field"><label for="f-client">Client</label><select id="f-client" data-f="clientId"${credit ? ' disabled' : ''}><option value="">Choose a client…</option>${state.clients.map((c) => opt(c.id, c.name, d.clientId)).join('')}</select>
          ${state.clients.length ? '' : '<span class="hint">Add a client first (Clients → New client).</span>'}</div>
        <div class="field"><label for="f-treat">VAT treatment</label><select id="f-treat" data-f="treatment"${credit ? ' disabled' : ''}>${Object.entries(C.TREATMENTS).map(([k, t]) => opt(k, t.label, d.treatment)).join('')}</select>
          <span class="hint">${s.vatRegistered ? esc(C.TREATMENTS[d.treatment]?.clause.sl || 'Slovenian VAT is charged on every line.') : esc(C.SMALL_TAXPAYER_CLAUSE.sl)}</span></div>
        <div class="field"><label for="f-lang">Invoice language</label><select id="f-lang" data-f="lang">${opt('sl', 'Slovenščina', d.lang)}${opt('en', 'English', d.lang)}</select></div>
        <div class="field"><label for="f-sf">Date of supply / service from</label><input id="f-sf" type="date" data-f="supplyFrom" value="${esc(d.supplyFrom || '')}"></div>
        <div class="field"><label for="f-st">Service period to (optional)</label><input id="f-st" type="date" data-f="supplyTo" value="${esc(d.supplyTo || '')}"></div>
        ${credit ? '' : `<div class="field"><label for="f-pd">Payment terms (days)</label><input id="f-pd" type="number" min="0" data-f="paymentDays" value="${esc(d.paymentDays)}"><span class="hint">Due date = issue date + days.</span></div>`}
        <div class="field wide"><label for="f-note">Note on the invoice (optional)</label><textarea id="f-note" data-f="note">${esc(d.note || '')}</textarea></div>
      </div></div>
      <div class="card table-card"><div class="table-head"><h3>Lines</h3><button class="btn small" data-act="add-line">${icon('plus', 16)}Add line</button></div>
        <div class="tw"><table class="lines"><thead><tr><th>Description</th><th>Qty</th><th>Unit</th><th>Unit price (€)</th><th>Disc. %</th><th>VAT</th><th class="num">Amount</th><th></th></tr></thead><tbody>${lineRows}</tbody></table></div>
        <div style="padding:16px 20px"><div class="totals" id="totals"></div></div></div>`;
  }
  function updateDraftTotals() {
    if (!editing) return;
    const t = C.computeTotals(editing.doc, state.settings);
    t.lines.forEach((l, k) => { const el = document.querySelector(`[data-amount="${k}"]`); if (el) el.textContent = C.eur(l.net); });
    const box = $('#totals');
    if (!box) return;
    const rows = [];
    for (const r of t.byRate) {
      rows.push(`<span class="muted">Base ${t.chargesVat ? `${String(r.rate).replace('.', ',')} %` : '(no VAT)'}</span><span class="num">${C.eur(r.base)}</span>`);
      if (t.chargesVat) rows.push(`<span class="muted">VAT ${String(r.rate).replace('.', ',')} %</span><span class="num">${C.eur(r.vat)}</span>`);
    }
    rows.push(`<span class="grand">Total</span><span class="grand num">${C.eur(t.total)}</span>`);
    box.innerHTML = rows.join('');
  }
  async function saveDraft({ quiet = false } = {}) {
    if (!editing) return;
    const d = clone(editing.doc);
    await mutate('document.draft.save', `Saved ${docName(d)}`, (s) => {
      const i = s.invoices.findIndex((x) => x.id === d.id);
      if (i < 0 || s.invoices[i].number) throw new Error('This draft was issued or deleted in another tab.');
      s.invoices[i] = { ...s.invoices[i], ...d };
    }, { audit: false });
    editing.dirty = false;
    if (!quiet) toast('Draft saved');
  }
  function previewSnapshot(doc) {
    const today = C.todayIso();
    const fake = { ...doc, dueDate: doc.kind === 'credit_note' ? null : C.addDays(today, doc.paymentDays || 0) };
    const snap = C.buildSnapshot(state, fake, { issueDate: today, seq: C.nextSeq(state, Number(today.slice(0, 4))) });
    snap.number = null; snap.reference = null;
    return snap;
  }

  function issueDialog() {
    const d = editing.doc;
    const today = C.todayIso();
    openDialog(`Issue ${d.kind === 'credit_note' ? 'credit note' : 'invoice'}`, `
      <div class="field"><label for="i-date">Issue date</label><input id="i-date" type="date" value="${today}" max="${today}"></div>
      <div id="i-check"></div>
      <p class="small muted">After issuing, the document gets the next number and is locked. It can't be changed or deleted; corrections are made with a credit note (ZDDV-1, ZDavP-2 Art. 38).</p>`,
      `<button class="btn" data-act="close">Cancel</button><button class="btn primary" id="i-go" data-act="issue">Issue</button>`);
    const refresh = () => {
      const date = $('#i-date').value;
      const year = Number(date.slice(0, 4));
      const probs = C.issueProblems(state, d, date);
      const num = C.formatNumber(state.settings.numberPrefix, year, C.nextSeq(state, year));
      $('#i-check').innerHTML = probs.length
        ? `<p class="small">Still needed before issuing:</p><ul class="problems">${probs.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>`
        : `<div class="okline">Ready. Number <b class="mono">${esc(num)}</b>${d.kind === 'credit_note' ? '' : `, due <b>${C.dmy(C.addDays(date, d.paymentDays || 0))}</b>`}, total <b>${C.eur(C.computeTotals(d, state.settings).total)}</b>.</div>`;
      $('#i-go').disabled = probs.length > 0;
      $('#i-go').textContent = probs.length ? 'Issue' : `Issue ${num}`;
    };
    $('#i-date').addEventListener('input', refresh);
    refresh();
  }
  async function issue() {
    const date = $('#i-date').value;
    const d = clone(editing.doc);
    await mutate('document.issue', '', async (s) => {
      const i = s.invoices.findIndex((x) => x.id === d.id);
      if (i < 0 || s.invoices[i].number) throw new Error('This draft was already issued or deleted.');
      const doc = { ...s.invoices[i], ...d };
      const probs = C.issueProblems(s, doc, date);
      if (probs.length) throw new Error(probs.join('\n'));
      const year = Number(date.slice(0, 4));
      const seq = C.nextSeq(s, year);
      if (doc.kind !== 'credit_note') doc.dueDate = C.addDays(date, doc.paymentDays || 0);
      const snap = C.buildSnapshot(s, doc, { issueDate: date, seq });
      Object.assign(doc, { number: snap.number, year, seq, issueDate: date, reference: snap.reference, snapshot: snap, issuedAt: new Date().toISOString() });
      s.invoices[i] = doc;
      s.counters[String(year)] = seq;
      return { summary: `Issued ${docLabel(doc).toLowerCase()} ${snap.number} (${C.eur(snap.totals.total)})`,
        audit: { id: doc.id, number: snap.number, total: snap.totals.total, snapshotHash: await sha256(C.canonical(snap)) } };
    });
    editing = null;
    closeDialog();
    toast(`Issued ${docById(d.id).number}`);
  }

  function viewIssued(doc) {
    editing = null;
    const snap = doc.snapshot;
    const st = statusOf(doc);
    const credit = doc.kind === 'credit_note';
    const out = C.outstandingCents(state, doc);
    const credits = state.invoices.filter((c) => c.kind === 'credit_note' && c.creditOf === doc.id);
    const history = state.audit.filter((e) => e.data && (e.data.id === doc.id || e.data.invoiceId === doc.id)).slice().reverse();
    const orig = credit ? docById(doc.creditOf) : null;
    const actions = [
      `<button class="btn" data-act="pdf">${icon('download', 18)}PDF</button>`,
      `<button class="btn" data-act="email">Email client</button>`,
      !credit && out > 0 ? '<button class="btn primary" data-act="payment-dialog">Record payment</button>' : '',
      !credit && C.outstandingCreditable(state, doc) > 0 ? '<button class="btn" data-act="credit-note">Credit note</button>' : '',
      '<button class="btn" data-act="duplicate">Duplicate</button>',
    ].join('');
    return `${topbar()}
      ${pageHead(`${credit ? 'Credit note' : 'Invoice'} ${snap.number}`, `${statusPill(st)} <span class="mono small">${esc(snap.customer.name)} · issued ${C.dmy(snap.issueDate)}${snap.dueDate ? ` · due ${C.dmy(snap.dueDate)}` : ''}</span>`, actions)}
      <div class="grid2">
        <div class="card"><h3>Summary</h3><div class="sub mono">Locked since ${esc((doc.issuedAt || '').replace('T', ' ').slice(0, 16))} UTC</div>
          <dl class="kv">
            <dt>Client</dt><dd>${esc(snap.customer.name)}<br><span class="small muted">${esc(snap.customer.address)}, ${esc(snap.customer.postalCity)}${snap.customer.vatId ? ` · ${esc(snap.customer.vatId)}` : ''}</span></dd>
            <dt>${snap.supplyTo && snap.supplyTo !== snap.supplyFrom ? 'Service period' : 'Date of supply'}</dt><dd>${C.dmy(snap.supplyFrom)}${snap.supplyTo && snap.supplyTo !== snap.supplyFrom ? ` – ${C.dmy(snap.supplyTo)}` : ''}</dd>
            ${snap.reference ? `<dt>Reference</dt><dd class="mono">${esc(snap.reference)}</dd>` : ''}
            ${orig ? `<dt>Credits invoice</dt><dd><a href="#doc/${orig.id}">${esc(orig.number)}</a> of ${C.dmy(orig.issueDate)}</dd>` : ''}
            <dt>Treatment</dt><dd>${esc(C.TREATMENTS[snap.treatment]?.label || snap.treatment)}</dd>
            <dt>Total</dt><dd><b>${C.eur(snap.totals.total)}</b>${snap.totals.vat ? ` <span class="small muted">incl. VAT ${C.eur(snap.totals.vat)}</span>` : ''}</dd>
            ${credit ? '' : `<dt>Paid</dt><dd>${C.eur(C.paidCents(doc))}</dd><dt>Credited</dt><dd>${C.eur(-C.creditedCents(state, doc))}</dd><dt>Outstanding</dt><dd><b>${C.eur(out)}</b></dd>`}
          </dl>
          ${snap.clauses.map((c) => `<p class="clause">${esc(c)}</p>`).join('')}</div>
        <div class="card table-card"><div class="table-head"><h3>History</h3><span class="mono small muted">hash-chained</span></div>
          <div class="tw"><table><tbody>${history.map((e) => `<tr><td class="mono small muted">${esc(e.at.replace('T', ' ').slice(0, 16))}</td><td>${esc(e.summary)}</td></tr>`).join('') || '<tr><td class="empty">No entries</td></tr>'}</tbody></table></div></div>
      </div>
      <div class="card table-card"><div class="table-head"><h3>Lines</h3></div><div class="tw"><table><thead><tr><th>Description</th><th class="num">Qty</th><th>Unit</th><th class="num">Unit price</th><th class="num">Disc.</th><th class="num">VAT</th><th class="num">Amount</th></tr></thead><tbody>
        ${snap.lines.map((l) => `<tr><td>${esc(l.description)}</td><td class="num">${esc(String(l.qty).replace('.', ','))}</td><td>${esc(l.unit)}</td><td class="num">${C.eur(C.cents(l.unitPrice))}</td><td class="num">${l.discountPct ? `${l.discountPct} %` : ''}</td><td class="num">${snap.issuer.vatRegistered && l.rate ? `${String(l.rate).replace('.', ',')} %` : '–'}</td><td class="num">${C.eur(l.net)}</td></tr>`).join('')}
        ${snap.totals.byRate.map((r) => `<tr class="total"><td colspan="6">${r.rate ? `Base ${String(r.rate).replace('.', ',')} % · VAT ${C.eur(r.vat)}` : 'Base without VAT'}</td><td class="num">${C.eur(r.base)}</td></tr>`).join('')}
        <tr class="total"><td colspan="6">Total</td><td class="num">${C.eur(snap.totals.total)}</td></tr></tbody></table></div></div>
      ${credit ? '' : `<div class="grid2">
        <div class="card table-card"><div class="table-head"><h3>Payments</h3><span class="mono small muted">bank transfer only</span></div>
          ${(doc.payments || []).length ? `<div class="tw"><table><tbody>${doc.payments.map((p) => `<tr><td class="mono small">${C.dmy(p.date)}</td><td>${esc(p.note || 'Bank transfer')}</td><td class="num">${C.eur(p.amount)}</td><td><button class="btn small" data-act="undo-payment" data-pid="${p.id}">Undo</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No payments recorded.</div>'}</div>
        <div class="card table-card"><div class="table-head"><h3>Credit notes</h3></div>
          ${credits.length ? `<div class="tw"><table><tbody>${credits.map((c) => `<tr class="click" data-act="go" data-to="doc/${c.id}"><td class="mono">${esc(c.number || 'Draft')}</td><td class="mono small">${C.dmy(c.issueDate)}</td><td class="num">${C.eur(docTotal(c))}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">None.</div>'}</div>
      </div>`}`;
  }

  async function downloadPdf(doc) {
    toast('Preparing PDF…');
    const snap = doc.number ? doc.snapshot : previewSnapshot(doc);
    const blob = await window.BillingPdf.blob(snap, { draft: !doc.number, amountDue: doc.number && doc.kind !== 'credit_note' ? C.outstandingCents(state, doc) || snap.totals.total : undefined });
    download(`${doc.number ? doc.number : 'osnutek'}.pdf`, blob);
  }
  async function emailClient(doc) {
    const snap = doc.snapshot;
    const c = client(doc.clientId);
    const sl = snap.lang === 'sl';
    const iban = snap.issuer.iban.replace(/(.{4})(?=.)/g, '$1 ');
    const subject = sl ? `${doc.kind === 'credit_note' ? 'Dobropis' : 'Račun'} ${snap.number} – ${snap.issuer.name}` : `${doc.kind === 'credit_note' ? 'Credit note' : 'Invoice'} ${snap.number} – ${snap.issuer.name}`;
    const body = sl
      ? `Pozdravljeni,\n\nv prilogi vam pošiljamo ${doc.kind === 'credit_note' ? 'dobropis' : 'račun'} št. ${snap.number} z dne ${C.dmy(snap.issueDate)} v znesku ${C.eur(snap.totals.total)}.${doc.kind === 'credit_note' ? '' : `\n\nRok plačila: ${C.dmy(snap.dueDate)}\nIBAN: ${iban}\nSklic: ${snap.reference}`}\n\nLep pozdrav,\n${snap.issuer.name}`
      : `Hello,\n\nplease find attached ${doc.kind === 'credit_note' ? 'credit note' : 'invoice'} ${snap.number} of ${C.dmy(snap.issueDate)} for ${C.eur(snap.totals.total)}.${doc.kind === 'credit_note' ? '' : `\n\nDue date: ${C.dmy(snap.dueDate)}\nIBAN: ${iban}\nReference: ${snap.reference}`}\n\nKind regards,\n${snap.issuer.name}`;
    await downloadPdf(doc);
    location.href = `mailto:${encodeURIComponent(c?.email || snap.customer.email || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    await mutate('document.email', `Opened an email for ${snap.number} (PDF downloaded to attach)`, () => ({ audit: { id: doc.id } }));
  }

  function paymentDialog(doc) {
    const out = C.outstandingCents(state, doc);
    openDialog(`Record payment · ${doc.number}`, `
      <div class="form">
        <div class="field"><label for="p-date">Date received (bank statement)</label><input id="p-date" type="date" value="${C.todayIso()}" min="${doc.issueDate}" max="${C.todayIso()}"></div>
        <div class="field"><label for="p-amt">Amount (€)</label><input id="p-amt" type="number" step="0.01" min="0.01" value="${(out / 100).toFixed(2)}"></div>
        <div class="field wide"><label for="p-note">Note (optional)</label><input id="p-note" placeholder="e.g. statement 2026/41"></div>
      </div>
      <p class="small muted">Only bank transfers to your account (TRR) are recorded here. Card or cash payments are "cash business" under ZDavPR and need fiscal verification at a FURS-certified till, which this app doesn't do.</p>`,
      `<button class="btn" data-act="close">Cancel</button><button class="btn primary" data-act="save-payment" data-id="${doc.id}">Record payment</button>`);
  }
  async function savePayment(id) {
    const date = $('#p-date').value, amount = C.cents($('#p-amt').value), note = $('#p-note').value.trim();
    await mutate('payment.record', '', (s) => {
      const doc = s.invoices.find((x) => x.id === id);
      const out = C.outstandingCents(s, doc);
      if (!date || date < doc.issueDate || date > C.todayIso()) throw new Error('Choose a date between the issue date and today.');
      if (!(amount > 0) || amount > out) throw new Error(`Enter an amount between 0,01 € and ${C.eur(out)}.`);
      const p = { id: uid(), date, amount, method: 'bank_transfer', note, recordedAt: new Date().toISOString() };
      doc.payments = [...(doc.payments || []), p];
      return { summary: `Payment ${C.eur(amount)} on ${C.dmy(date)} for ${doc.number}`, audit: { id: doc.id, paymentId: p.id, amount, date } };
    });
    closeDialog();
  }
  async function undoPayment(doc, pid) {
    if (!confirm('Remove this payment? The removal is kept in the audit log.')) return;
    await mutate('payment.undo', '', (s) => {
      const d = s.invoices.find((x) => x.id === doc.id);
      const p = (d.payments || []).find((x) => x.id === pid);
      d.payments = d.payments.filter((x) => x.id !== pid);
      return { summary: `Removed payment ${C.eur(p.amount)} of ${C.dmy(p.date)} from ${d.number}`, audit: { id: d.id, paymentId: pid, amount: p.amount, date: p.date } };
    });
  }
  async function creditNote(orig) {
    const snap = orig.snapshot;
    const lines = snap.lines.map((l) => ({ description: l.description, qty: -Number(l.qty), unit: l.unit, unitPrice: l.unitPrice, discountPct: l.discountPct, vatRate: l.rate || Number(state.settings.defaultVatRate) }));
    await createDraft(newDraft(orig.clientId, { kind: 'credit_note', creditOf: orig.id, treatment: snap.treatment, lang: snap.lang, supplyFrom: snap.supplyFrom, supplyTo: snap.supplyTo, lines, paymentDays: 0 }), `Credit note draft for ${orig.number}`);
  }
  async function duplicate(doc) {
    const src = doc.number ? doc.snapshot : doc;
    const lines = (src.lines || []).map((l) => ({ description: l.description, qty: Math.abs(Number(l.qty)), unit: l.unit, unitPrice: l.unitPrice, discountPct: l.discountPct || 0, vatRate: l.rate || l.vatRate || Number(state.settings.defaultVatRate) }));
    await createDraft(newDraft(doc.clientId, { treatment: src.treatment, lang: src.lang, lines }), `Draft copied from ${docName(doc)}`);
  }
  async function deleteDraft(doc) {
    if (!confirm('Delete this draft? Work entries on it become billable again.')) return;
    await mutate('document.draft.delete', `Deleted ${docName(doc)} for ${client(doc.clientId)?.name || 'no client'}`, (s) => {
      const d = s.invoices.find((x) => x.id === doc.id);
      if (!d || d.number) throw new Error('Issued documents cannot be deleted.');
      s.invoices = s.invoices.filter((x) => x.id !== doc.id);
      s.work.forEach((w) => { if (w.invoiceId === doc.id) w.invoiceId = null; });
      s.runs = s.runs.filter((r) => r.invoiceId !== doc.id);
      return { audit: { id: doc.id } };
    });
    editing = null;
    location.hash = 'invoices';
  }

  // ---------- Billing run ----------
  function pageRun() {
    const plans = C.planRun(state, runPeriod);
    const todo = plans.filter((p) => !p.done);
    return `${topbar()}
      ${pageHead('Billing run', `Makes one draft per client for <b>${esc(runPeriod)}</b>: each contract's monthly retainer (in advance for this month, or in arrears for the previous one) plus unbilled work up to the end of the previous month. Nothing is issued automatically.`,
        `<label class="mono small muted" for="run-p">Period</label><input id="run-p" class="btn" type="month" value="${esc(runPeriod)}" data-act-input="run-period"><button class="btn primary" data-act="run-create"${todo.length ? '' : ' disabled'}>Create ${todo.length} draft${todo.length === 1 ? '' : 's'}</button>`)}
      ${plans.length ? plans.map((p) => {
        const t = C.computeTotals({ lines: p.lines, treatment: p.client.treatment }, state.settings);
        return `<div class="card table-card"><div class="table-head"><h3>${esc(p.client.name)}</h3>${p.done ? '<span class="status paid">Draft already made</span>' : `<span class="status">${C.eur(t.total)}</span>`}</div>
          <div class="tw"><table><tbody>${p.lines.map((l) => `<tr><td>${esc(l.description)}</td><td class="num">${esc(String(l.qty).replace('.', ','))} ${esc(l.unit)}</td><td class="num">${C.eur(C.cents(l.unitPrice))}</td><td class="num">${C.eur(C.cents(l.qty * l.unitPrice))}</td></tr>`).join('')}</tbody></table></div></div>`;
      }).join('') : '<div class="card empty">Nothing to bill for this period. Add contracts or work entries first.</div>'}`;
  }
  async function runCreate() {
    const made = await mutate('run.create', '', (s) => {
      const plans = C.planRun(s, runPeriod).filter((p) => !p.done);
      const ids = [];
      for (const p of plans) {
        const contract = s.contracts.find((k) => p.contractIds.includes(k.id));
        const dates = [];
        for (const l of p.lines) {
          if (l.source.month) dates.push(`${l.source.month}-01`, C.lastDayOfMonth(l.source.month));
          if (l.source.workId) dates.push(s.work.find((w) => w.id === l.source.workId).date);
        }
        dates.sort();
        const draft = {
          id: uid(), kind: 'invoice', clientId: p.client.id, treatment: p.client.treatment || 'domestic', lang: p.client.lang || s.settings.lang || 'sl',
          supplyFrom: dates[0], supplyTo: dates[dates.length - 1], paymentDays: Number(contract?.paymentDays || p.client.paymentDays || s.settings.paymentDays || 15),
          note: contract?.reference ? `Pogodba / contract: ${contract.reference}` : '', lines: p.lines.map(({ source, ...l }) => l), payments: [], createdAt: new Date().toISOString(), runPeriod,
        };
        s.invoices.push(draft);
        for (const l of p.lines) if (l.source.workId) s.work.find((w) => w.id === l.source.workId).invoiceId = draft.id;
        s.runs.push({ id: uid(), clientId: p.client.id, period: runPeriod, invoiceId: draft.id, createdAt: new Date().toISOString() });
        ids.push(draft.id);
      }
      return { summary: `Billing run ${runPeriod}: ${ids.length} draft${ids.length === 1 ? '' : 's'}`, audit: { period: runPeriod, drafts: ids }, ids };
    });
    toast(`${made.ids.length} draft${made.ids.length === 1 ? '' : 's'} created`);
    invoiceFilter = 'draft';
    location.hash = 'invoices';
  }

  // ---------- Clients / Contracts / Work ----------
  const COUNTRIES = ['SI', 'HR', 'AT', 'IT', 'DE', 'HU', 'CZ', 'SK', 'PL', 'FR', 'NL', 'BE', 'IE', 'ES', 'PT', 'SE', 'DK', 'FI', 'LU', 'RO', 'BG', 'GR', 'CY', 'MT', 'EE', 'LV', 'LT',
    'GB', 'CH', 'NO', 'RS', 'BA', 'ME', 'MK', 'AL', 'US', 'CA', 'AU'];
  function pageClients() {
    return `${topbar('<button class="btn primary" data-act="edit-client">' + icon('plus', 18) + 'New client</button>')}
      ${pageHead('Clients', 'Who you invoice. The VAT treatment and language set here become each new invoice\'s defaults.')}
      <div class="card table-card">${state.clients.length ? `<div class="tw"><table><thead><tr><th>Name</th><th>Country</th><th>VAT ID / tax no.</th><th>Treatment</th><th class="num">Outstanding</th></tr></thead><tbody>
        ${state.clients.map((c) => {
          const out = state.invoices.filter((i) => i.clientId === c.id).reduce((a, i) => a + C.outstandingCents(state, i), 0);
          return `<tr class="click" data-act="edit-client" data-id="${c.id}"><td>${esc(c.name)}</td><td class="mono">${esc(c.country)}</td><td class="mono small">${esc(c.vatId || c.taxNumber || '—')}</td><td class="small">${esc(C.TREATMENTS[c.treatment]?.label || '')}</td><td class="num">${C.eur(out)}</td></tr>`;
        }).join('')}</tbody></table></div>` : '<div class="empty">No clients yet.</div>'}</div>`;
  }
  function clientDialog(id) {
    const c = id ? client(id) : { country: 'SI', lang: 'sl', treatment: 'domestic', paymentDays: state.settings.paymentDays || 15 };
    const opt = (v, l, cur) => `<option value="${esc(v)}"${String(v) === String(cur) ? ' selected' : ''}>${esc(l)}</option>`;
    openDialog(id ? 'Edit client' : 'New client', `<div class="form">
      <div class="field wide"><label for="c-name">Name (full legal name)</label><input id="c-name" value="${esc(c.name || '')}"></div>
      <div class="field"><label for="c-addr">Street and number</label><input id="c-addr" value="${esc(c.address || '')}"></div>
      <div class="field"><label for="c-pc">Postcode and city</label><input id="c-pc" value="${esc(c.postalCity || '')}"></div>
      <div class="field"><label for="c-country">Country</label><select id="c-country">${COUNTRIES.map((k) => opt(k, k, c.country)).join('')}</select></div>
      <div class="field"><label for="c-vat">VAT ID (e.g. SI12345678, ATU12345678)</label><input id="c-vat" value="${esc(c.vatId || '')}"><span class="hint">Required for reverse-charge and EU supplies. Check it in VIES.</span></div>
      <div class="field"><label for="c-tax">Tax number (if not VAT registered)</label><input id="c-tax" value="${esc(c.taxNumber || '')}"></div>
      <div class="field"><label for="c-email">Billing email</label><input id="c-email" type="email" value="${esc(c.email || '')}"></div>
      <div class="field"><label for="c-treat">Default VAT treatment</label><select id="c-treat">${Object.entries(C.TREATMENTS).map(([k, t]) => opt(k, t.label, c.treatment)).join('')}</select></div>
      <div class="field"><label for="c-lang">Invoice language</label><select id="c-lang">${opt('sl', 'Slovenščina', c.lang)}${opt('en', 'English', c.lang)}</select></div>
      <div class="field"><label for="c-days">Payment terms (days)</label><input id="c-days" type="number" min="0" value="${esc(c.paymentDays ?? 15)}"></div>
    </div>`, `${id ? '<button class="btn danger" data-act="delete-client" data-id="' + id + '">Delete</button>' : ''}<button class="btn" data-act="close">Cancel</button><button class="btn primary" data-act="save-client" data-id="${id || ''}">Save client</button>`);
    $('#c-country').addEventListener('change', (e) => {
      const k = e.target.value;
      $('#c-treat').value = k === 'SI' ? 'domestic' : C.EU.has(k) ? 'eu_services' : 'export_services';
      $('#c-lang').value = k === 'SI' ? 'sl' : 'en';
    });
  }
  async function saveClient(id) {
    const v = (sel) => $(sel).value.trim();
    const data = { name: v('#c-name'), address: v('#c-addr'), postalCity: v('#c-pc'), country: v('#c-country'), vatId: C.normVatId(v('#c-vat')),
      taxNumber: v('#c-tax'), email: v('#c-email'), treatment: v('#c-treat'), lang: v('#c-lang'), paymentDays: Number(v('#c-days') || 0) };
    if (!data.name) return alertBox('Name is required', 'Enter the client\'s full legal name.');
    if (data.vatId && !C.vatIdLooksValid(data.vatId)) return alertBox('VAT ID looks wrong', 'Use the country prefix and number, e.g. SI12345678. Slovenian numbers are checked with the FURS check digit.');
    await mutate(id ? 'client.update' : 'client.create', `${id ? 'Updated' : 'Added'} client ${data.name}`, (s) => {
      if (id) Object.assign(s.clients.find((c) => c.id === id), data);
      else s.clients.push({ id: uid(), ...data, createdAt: new Date().toISOString() });
    });
    closeDialog();
  }
  async function deleteClient(id) {
    if (state.invoices.some((i) => i.clientId === id) || state.contracts.some((k) => k.clientId === id) || state.work.some((w) => w.clientId === id)) {
      return alertBox('Client is in use', 'This client has documents, contracts or work entries, so it can\'t be deleted. Issued invoices must stay with their client.');
    }
    if (!confirm('Delete this client?')) return;
    await mutate('client.delete', `Deleted client ${client(id).name}`, (s) => { s.clients = s.clients.filter((c) => c.id !== id); });
    closeDialog();
  }

  function pageContracts() {
    return `${topbar('<button class="btn primary" data-act="edit-contract"' + (state.clients.length ? '' : ' disabled') + '>' + icon('plus', 18) + 'New contract</button>')}
      ${pageHead('Contracts', 'Monthly retainers and hourly rates. The billing run turns active contracts into drafts.')}
      <div class="card table-card">${state.contracts.length ? `<div class="tw"><table><thead><tr><th>Client</th><th>Contract</th><th class="num">Monthly fee</th><th class="num">Hourly rate</th><th>Billed</th><th>Valid</th></tr></thead><tbody>
        ${state.contracts.map((k) => `<tr class="click" data-act="edit-contract" data-id="${k.id}"><td>${esc(client(k.clientId)?.name || '—')}</td><td>${esc(k.title || '')}${k.reference ? ` <span class="mono small muted">${esc(k.reference)}</span>` : ''}</td><td class="num">${C.eur(C.cents(k.monthlyFee))}</td><td class="num">${k.hourlyRate ? C.eur(C.cents(k.hourlyRate)) : '—'}</td><td class="small">${k.timing === 'arrears' ? 'In arrears' : 'In advance'}</td><td class="mono small">${C.dmy(k.start)}${k.end ? ` – ${C.dmy(k.end)}` : ' –'}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">No contracts yet.</div>'}</div>`;
  }
  function contractDialog(id) {
    const k = id ? state.contracts.find((x) => x.id === id) : { timing: 'advance', start: `${C.todayIso().slice(0, 7)}-01` };
    const opt = (v, l, cur) => `<option value="${esc(v)}"${String(v) === String(cur) ? ' selected' : ''}>${esc(l)}</option>`;
    openDialog(id ? 'Edit contract' : 'New contract', `<div class="form">
      <div class="field"><label for="k-client">Client</label><select id="k-client">${state.clients.map((c) => opt(c.id, c.name, k.clientId)).join('')}</select></div>
      <div class="field"><label for="k-title">Title on the invoice</label><input id="k-title" value="${esc(k.title || 'Mesečni pavšal')}"></div>
      <div class="field"><label for="k-ref">Contract number (optional)</label><input id="k-ref" value="${esc(k.reference || '')}"></div>
      <div class="field"><label for="k-fee">Monthly fee excl. VAT (€)</label><input id="k-fee" type="number" step="0.01" min="0" value="${esc(k.monthlyFee ?? '')}"></div>
      <div class="field"><label for="k-rate">Hourly rate excl. VAT (€)</label><input id="k-rate" type="number" step="0.01" min="0" value="${esc(k.hourlyRate ?? '')}"></div>
      <div class="field"><label for="k-timing">Retainer billed</label><select id="k-timing">${opt('advance', 'In advance (this month)', k.timing)}${opt('arrears', 'In arrears (previous month)', k.timing)}</select></div>
      <div class="field"><label for="k-start">Start</label><input id="k-start" type="date" value="${esc(k.start || '')}"></div>
      <div class="field"><label for="k-end">End (optional)</label><input id="k-end" type="date" value="${esc(k.end || '')}"></div>
      <div class="field"><label for="k-days">Payment terms (days, optional)</label><input id="k-days" type="number" min="0" value="${esc(k.paymentDays ?? '')}"></div>
    </div>`, `${id ? '<button class="btn danger" data-act="delete-contract" data-id="' + id + '">Delete</button>' : ''}<button class="btn" data-act="close">Cancel</button><button class="btn primary" data-act="save-contract" data-id="${id || ''}">Save contract</button>`);
  }
  async function saveContract(id) {
    const v = (sel) => $(sel).value.trim();
    const data = { clientId: v('#k-client'), title: v('#k-title'), reference: v('#k-ref'), monthlyFee: Number(v('#k-fee') || 0), hourlyRate: Number(v('#k-rate') || 0),
      timing: v('#k-timing'), start: v('#k-start'), end: v('#k-end'), paymentDays: v('#k-days') === '' ? null : Number(v('#k-days')) };
    if (!data.clientId) return alertBox('Choose a client', 'A contract belongs to a client.');
    await mutate(id ? 'contract.update' : 'contract.create', `${id ? 'Updated' : 'Added'} contract for ${client(data.clientId)?.name}`, (s) => {
      if (id) Object.assign(s.contracts.find((k) => k.id === id), data);
      else s.contracts.push({ id: uid(), ...data });
    });
    closeDialog();
  }
  async function deleteContract(id) {
    if (!confirm('Delete this contract? Invoices already made from it are not affected.')) return;
    await mutate('contract.delete', 'Deleted a contract', (s) => { s.contracts = s.contracts.filter((k) => k.id !== id); });
    closeDialog();
  }

  function pageWork() {
    const rows = state.work.filter((w) => workFilter === 'all' || (workFilter === 'unbilled' ? w.billable && !w.invoiceId : !!w.invoiceId))
      .sort((a, b) => b.date.localeCompare(a.date));
    const segs = [['unbilled', 'Unbilled'], ['billed', 'On an invoice'], ['all', 'All']].map(([k, l]) => `<button type="button" aria-pressed="${workFilter === k}" data-act="work-filter" data-v="${k}">${l}</button>`).join('');
    return `${topbar('<button class="btn primary" data-act="edit-work"' + (state.clients.length ? '' : ' disabled') + '>' + icon('plus', 18) + 'Log work</button>')}
      ${pageHead('Work log', 'Extra work at an hourly rate or a fixed price. Unbilled entries are picked up by the next billing run.')}
      <div class="card table-card"><div class="table-head"><h3>${rows.length} entr${rows.length === 1 ? 'y' : 'ies'}</h3><div class="seg" role="group" aria-label="Filter">${segs}</div></div>
      ${rows.length ? `<div class="tw"><table><thead><tr><th>Date</th><th>Client</th><th>Description</th><th class="num">Quantity</th><th class="num">Amount</th><th>Invoice</th></tr></thead><tbody>
        ${rows.map((w) => { const inv = w.invoiceId ? docById(w.invoiceId) : null; const amt = w.mode === 'fixed' ? C.cents(w.amount) : C.cents(w.hours * w.rate);
          return `<tr class="click" data-act="edit-work" data-id="${w.id}"><td class="mono small">${C.dmy(w.date)}</td><td>${esc(client(w.clientId)?.name || '—')}</td><td>${esc(w.description)}${w.billable ? '' : ' <span class="pill-tag">not billable</span>'}</td><td class="num">${w.mode === 'fixed' ? 'fixed' : `${String(w.hours).replace('.', ',')} h × ${C.eur(C.cents(w.rate))}`}</td><td class="num">${C.eur(amt)}</td><td class="mono small">${inv ? esc(docName(inv)) : ''}</td></tr>`; }).join('')}
      </tbody></table></div>` : '<div class="empty">No entries.</div>'}</div>`;
  }
  function workDialog(id) {
    const w = id ? state.work.find((x) => x.id === id) : { date: C.todayIso(), mode: 'hours', billable: true, clientId: state.clients[0]?.id };
    if (w.invoiceId && docById(w.invoiceId)?.number) return alertBox('Already invoiced', `This entry is on ${docById(w.invoiceId).number} and can't be changed.`);
    const rateFor = (cid) => state.contracts.find((k) => k.clientId === cid && k.hourlyRate)?.hourlyRate || '';
    const opt = (v, l, cur) => `<option value="${esc(v)}"${String(v) === String(cur) ? ' selected' : ''}>${esc(l)}</option>`;
    openDialog(id ? 'Edit work' : 'Log work', `<div class="form">
      <div class="field"><label for="w-client">Client</label><select id="w-client">${state.clients.map((c) => opt(c.id, c.name, w.clientId)).join('')}</select></div>
      <div class="field"><label for="w-date">Date</label><input id="w-date" type="date" value="${esc(w.date)}"></div>
      <div class="field wide"><label for="w-desc">Description (appears on the invoice)</label><input id="w-desc" value="${esc(w.description || '')}"></div>
      <div class="field"><label for="w-mode">Charged</label><select id="w-mode">${opt('hours', 'By the hour', w.mode)}${opt('fixed', 'Fixed price', w.mode)}</select></div>
      <div class="field"><label for="w-hours">Hours</label><input id="w-hours" type="number" step="0.25" min="0" value="${esc(w.hours ?? '')}"></div>
      <div class="field"><label for="w-rate">Rate excl. VAT (€/h)</label><input id="w-rate" type="number" step="0.01" min="0" value="${esc(w.rate ?? rateFor(w.clientId))}"></div>
      <div class="field"><label for="w-amt">Fixed amount excl. VAT (€)</label><input id="w-amt" type="number" step="0.01" min="0" value="${esc(w.amount ?? '')}"></div>
      <div class="field"><span class="lbl">Billable</span><label class="row"><input id="w-bill" type="checkbox"${w.billable ? ' checked' : ''}> Bill this to the client</label></div>
    </div>`, `${id && !w.invoiceId ? '<button class="btn danger" data-act="delete-work" data-id="' + id + '">Delete</button>' : ''}<button class="btn" data-act="close">Cancel</button><button class="btn primary" data-act="save-work" data-id="${id || ''}">Save</button>`);
    $('#w-client').addEventListener('change', (e) => { if (!$('#w-rate').value) $('#w-rate').value = rateFor(e.target.value); });
  }
  async function saveWork(id) {
    const v = (sel) => $(sel).value.trim();
    const data = { clientId: v('#w-client'), date: v('#w-date'), description: v('#w-desc'), mode: v('#w-mode'), hours: Number(v('#w-hours') || 0),
      rate: Number(v('#w-rate') || 0), amount: Number(v('#w-amt') || 0), billable: $('#w-bill').checked };
    if (!data.clientId || !data.date || !data.description) return alertBox('Missing details', 'Client, date and description are required.');
    if (data.mode === 'hours' && !(data.hours > 0 && data.rate > 0)) return alertBox('Hours and rate', 'Enter the hours and the hourly rate.');
    if (data.mode === 'fixed' && !(data.amount > 0)) return alertBox('Fixed amount', 'Enter the fixed amount.');
    await mutate(id ? 'work.update' : 'work.create', `${id ? 'Updated' : 'Logged'} work for ${client(data.clientId)?.name}: ${data.description}`, (s) => {
      if (id) Object.assign(s.work.find((w) => w.id === id), data);
      else s.work.push({ id: uid(), invoiceId: null, ...data });
    });
    closeDialog();
  }
  async function deleteWork(id) {
    if (!confirm('Delete this entry?')) return;
    await mutate('work.delete', 'Deleted a work entry', (s) => { s.work = s.work.filter((w) => w.id !== id); });
    closeDialog();
  }

  // ---------- Reports ----------
  function kirPeriod() {
    const t = C.todayIso();
    const ym = t.slice(0, 7);
    const y = Number(t.slice(0, 4)), m = Number(t.slice(5, 7));
    const q = Math.floor((m - 1) / 3);
    const qStart = (yy, qq) => `${yy}-${C.pad(qq * 3 + 1, 2)}-01`;
    const qEnd = (yy, qq) => C.lastDayOfMonth(`${yy}-${C.pad(qq * 3 + 3, 2)}`);
    switch (kirRange) {
      case 'this_month': return [`${ym}-01`, C.lastDayOfMonth(ym)];
      case 'last_month': { const p = C.prevMonth(ym); return [`${p}-01`, C.lastDayOfMonth(p)]; }
      case 'this_quarter': return [qStart(y, q), qEnd(y, q)];
      case 'last_quarter': return q === 0 ? [qStart(y - 1, 3), qEnd(y - 1, 3)] : [qStart(y, q - 1), qEnd(y, q - 1)];
      case 'this_year': return [`${y}-01-01`, `${y}-12-31`];
      default: return [kirCustom.from || `${y}-01-01`, kirCustom.to || t];
    }
  }
  function pageKir() {
    const [from, to] = kirPeriod();
    const rows = C.kirRows(state, from, to);
    const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
    const noVat = (r) => r.euGoods + r.euServices + r.exportGoods + r.outsideSi + r.domesticRc + r.notRegistered;
    const segs = [['this_month', 'This month'], ['last_month', 'Last month'], ['this_quarter', 'This quarter'], ['last_quarter', 'Last quarter'], ['this_year', 'This year'], ['custom', 'Custom']]
      .map(([k, l]) => `<button type="button" aria-pressed="${kirRange === k}" data-act="kir-range" data-v="${k}">${l}</button>`).join('');
    return `${topbar(`<button class="btn" data-act="kir-csv"${rows.length ? '' : ' disabled'}>${icon('download', 18)}Download CSV</button>`)}
      ${pageHead('VAT ledger', 'Issued documents for the period, split by VAT rate and treatment, the data behind the ledger of issued invoices (evidenca obračunanega DDV).')}
      <div class="banner"><span class="dot"></span><b>Submitting to FURS</b><span class="mono grow">For tax periods from 1 July 2025, VAT-registered businesses submit this ledger to FURS electronically by the VAT return deadline, via eDavki or accounting software. Give this CSV to your accountant or import it there.</span></div>
      <div class="row"><div class="seg" role="group" aria-label="Period">${segs}</div>
        ${kirRange === 'custom' ? `<input class="btn" type="date" value="${esc(from)}" data-act-input="kir-from" aria-label="From"><input class="btn" type="date" value="${esc(to)}" data-act-input="kir-to" aria-label="To">` : `<span class="mono small muted">${C.dmy(from)} – ${C.dmy(to)}</span>`}</div>
      <div class="grid2">
        <div class="card"><h3>Output VAT</h3><div class="sub mono">Totals for the period</div><dl class="kv">
          <dt>Base 22 %</dt><dd>${C.eur(sum('base22'))} · VAT ${C.eur(sum('vat22'))}</dd>
          <dt>Base 9,5 %</dt><dd>${C.eur(sum('base95'))} · VAT ${C.eur(sum('vat95'))}</dd>
          <dt>Base 5 %</dt><dd>${C.eur(sum('base5'))} · VAT ${C.eur(sum('vat5'))}</dd>
          <dt>Output VAT</dt><dd><b>${C.eur(sum('vat22') + sum('vat95') + sum('vat5'))}</b></dd></dl></div>
        <div class="card"><h3>Supplies without Slovenian VAT</h3><div class="sub mono">Exempt, reverse charge or outside Slovenia</div><dl class="kv">
          <dt>EU goods (Art. 46)</dt><dd>${C.eur(sum('euGoods'))}</dd><dt>EU services (reverse charge)</dt><dd>${C.eur(sum('euServices'))}</dd>
          <dt>Export goods (Art. 52)</dt><dd>${C.eur(sum('exportGoods'))}</dd><dt>Services outside SI</dt><dd>${C.eur(sum('outsideSi'))}</dd>
          <dt>Domestic reverse charge</dt><dd>${C.eur(sum('domesticRc'))}</dd>${sum('notRegistered') ? `<dt>Not VAT registered</dt><dd>${C.eur(sum('notRegistered'))}</dd>` : ''}</dl></div>
      </div>
      <div class="card table-card">${rows.length ? `<div class="tw"><table><thead><tr><th>Number</th><th>Type</th><th>Issued</th><th>Customer</th><th>VAT ID</th><th class="num">Base 22 %</th><th class="num">VAT 22 %</th><th class="num">Base 9,5 %</th><th class="num">VAT 9,5 %</th><th class="num">Base 5 %</th><th class="num">VAT 5 %</th><th class="num">No SI VAT</th><th class="num">Total</th></tr></thead><tbody>
        ${rows.map((r) => `<tr><td class="mono">${esc(r.number)}</td><td class="small">${esc(r.kind)}${r.creditOf ? ` → ${esc(r.creditOf)}` : ''}</td><td class="mono small">${C.dmy(r.issueDate)}</td><td>${esc(r.customer)}</td><td class="mono small">${esc(r.vatId)}</td><td class="num">${C.eur(r.base22)}</td><td class="num">${C.eur(r.vat22)}</td><td class="num">${C.eur(r.base95)}</td><td class="num">${C.eur(r.vat95)}</td><td class="num">${C.eur(r.base5)}</td><td class="num">${C.eur(r.vat5)}</td><td class="num">${C.eur(noVat(r))}</td><td class="num">${C.eur(r.total)}</td></tr>`).join('')}
        <tr class="total"><td colspan="5">Total · ${rows.length} document${rows.length === 1 ? '' : 's'}</td><td class="num">${C.eur(sum('base22'))}</td><td class="num">${C.eur(sum('vat22'))}</td><td class="num">${C.eur(sum('base95'))}</td><td class="num">${C.eur(sum('vat95'))}</td><td class="num">${C.eur(sum('base5'))}</td><td class="num">${C.eur(sum('vat5'))}</td><td class="num">${C.eur(rows.reduce((a, r) => a + noVat(r), 0))}</td><td class="num">${C.eur(sum('total'))}</td></tr>
      </tbody></table></div>` : '<div class="empty">No documents issued in this period.</div>'}</div>`;
  }
  function pageRpo() {
    const rows = C.rpoRows(state, rpoMonth);
    const [y, m] = rpoMonth.split('-').map(Number);
    const due = `${m === 12 ? y + 1 : y}-${C.pad(m === 12 ? 1 : m + 1, 2)}-20`;
    return `${topbar(`<button class="btn" data-act="rpo-csv"${rows.length ? '' : ' disabled'}>${icon('download', 18)}Download CSV</button>`)}
      ${pageHead('EU summary', 'Supplies to VAT-registered customers in other EU countries, per customer VAT ID: the data for the recapitulative statement (RP-O).',
        `<label class="mono small muted" for="rpo-m">Month</label><input id="rpo-m" class="btn" type="month" value="${esc(rpoMonth)}" data-act-input="rpo-month">`)}
      <div class="banner"><span class="dot"></span><b>RP-O for ${esc(rpoMonth)}</b><span class="mono grow">${rows.length ? `File in eDavki by ${C.dmy(due)} (the 20th of the following month).` : 'No EU supplies this month, so no RP-O is needed for it.'} Check each customer's VAT ID in VIES before you file.</span></div>
      <div class="card table-card">${rows.length ? `<div class="tw"><table><thead><tr><th>Country</th><th>Customer VAT ID</th><th>Customer</th><th>Type</th><th class="num">Value (€)</th></tr></thead><tbody>
        ${rows.map((r) => `<tr><td class="mono">${esc(r.country)}</td><td class="mono">${esc(r.vatId)}</td><td>${esc(r.customer)}</td><td>${esc(r.type)}</td><td class="num">${C.eur(r.amount)}</td></tr>`).join('')}
        <tr class="total"><td colspan="4">Total</td><td class="num">${C.eur(rows.reduce((a, r) => a + r.amount, 0))}</td></tr></tbody></table></div>` : '<div class="empty">Nothing to report.</div>'}</div>`;
  }

  // ---------- Settings ----------
  function pageSettings() {
    const s = state.settings;
    const f = (id, label, val, extra = '', hint = '') => `<div class="field"><label for="s-${id}">${label}</label><input id="s-${id}" value="${esc(val ?? '')}" ${extra}>${hint ? `<span class="hint">${hint}</span>` : ''}</div>`;
    const issuedAny = state.invoices.some((i) => i.number);
    const empty = !state.clients.length && !state.invoices.length;
    return `${topbar()}
      ${pageHead('Settings', 'Your company details are printed on every invoice. Issued invoices keep the details they were issued with.', '<button class="btn primary" data-act="save-settings">Save settings</button>')}
      <div class="card"><h3>Company</h3><div class="sub mono">Issuer on every invoice</div><div class="form">
        ${f('name', 'Company name (as registered)', s.companyName)}
        ${f('addr', 'Street and number', s.address)}
        ${f('pc', 'Postcode and city', s.postalCity)}
        <div class="field wide"><span class="lbl">VAT status</span><div class="radio-row">
          <label><input type="radio" name="s-vatreg" value="1"${s.vatRegistered ? ' checked' : ''}> Registered for VAT (ID za DDV)</label>
          <label><input type="radio" name="s-vatreg" value="0"${s.vatRegistered ? '' : ' checked'}> Not registered (small taxpayer, Art. 94 ZDDV-1)</label></div></div>
        ${f('vat', 'VAT ID', s.vatId, 'placeholder="SI12345678"', 'Printed when you are VAT registered.')}
        ${f('tax', 'Tax number (davčna številka)', s.taxNumber, 'placeholder="12345678"', 'Printed when you are not VAT registered.')}
        ${f('reg', 'Registration number (matična številka)', s.registrationNumber)}
        ${f('court', 'Registry court (d.o.o., d.d.)', s.court, 'placeholder="Okrožno sodišče v Ljubljani"')}
        ${f('cap', 'Share capital (d.o.o., d.d.)', s.shareCapital, 'placeholder="7.500,00 EUR"', 'Companies show these on business documents (ZGD-1 Art. 32).')}
        ${f('email', 'Email', s.email, 'type="email"')}
        ${f('phone', 'Phone', s.phone)}
        ${f('web', 'Website', s.web)}
      </div></div>
      <div class="card"><h3>Payment and numbering</h3><div class="sub mono">Bank transfer details and document numbers</div><div class="form">
        ${f('iban', 'IBAN', s.iban, 'placeholder="SI56 …"')}
        ${f('bic', 'BIC / SWIFT', s.bic)}
        ${f('bank', 'Bank', s.bank)}
        ${f('prefix', 'Number prefix (optional)', s.numberPrefix, issuedAny ? 'disabled' : '', issuedAny ? 'Fixed once documents are issued, so the series stays consistent.' : `Numbers look like ${esc(C.formatNumber(s.numberPrefix, new Date().getFullYear(), 1))} and restart every year.`)}
        ${f('days', 'Default payment terms (days)', s.paymentDays, 'type="number" min="0"')}
        <div class="field"><label for="s-rate">Default VAT rate</label><select id="s-rate">${C.VAT_RATES.map((r) => `<option value="${r}"${Number(s.defaultVatRate) === r ? ' selected' : ''}>${String(r).replace('.', ',')} %</option>`).join('')}</select></div>
        <div class="field"><label for="s-lang">Default invoice language</label><select id="s-lang"><option value="sl"${s.lang === 'sl' ? ' selected' : ''}>Slovenščina</option><option value="en"${s.lang === 'en' ? ' selected' : ''}>English</option></select></div>
        <div class="field wide"><label for="s-footer">Footer text (optional)</label><textarea id="s-footer">${esc(s.footer || '')}</textarea></div>
      </div></div>
      <div class="card"><h3>Data</h3><div class="sub mono">Everything is stored only in this browser</div>
        <p class="small">Issued invoices must be kept for 10 years (ZDDV-1). Clearing this browser's data deletes them, so download a backup regularly and keep the yearly archive somewhere safe.</p>
        <div class="row">
          <button class="btn" data-act="backup">${icon('download', 18)}Backup (JSON)</button>
          <button class="btn" data-act="archive">${icon('download', 18)}Archive: PDFs + ledger (ZIP)</button>
          <button class="btn" data-act="verify">Check integrity</button>
          <label class="btn">Restore backup<input type="file" accept="application/json,.json" data-act-file="restore" hidden></label>
          ${empty ? '<button class="btn" data-act="sample">Load sample data</button>' : ''}
          <button class="btn danger" data-act="wipe">Delete everything</button>
        </div>
        <p class="mono small muted">Last backup: ${state.meta.lastBackupAt ? esc(state.meta.lastBackupAt.replace('T', ' ').slice(0, 16)) + ' UTC' : 'never'}</p>
      </div>`;
  }
  async function saveSettings() {
    const v = (id) => ($(`#s-${id}`) ? $(`#s-${id}`).value.trim() : '');
    const vatRegistered = document.querySelector('input[name="s-vatreg"]:checked').value === '1';
    const data = { companyName: v('name'), address: v('addr'), postalCity: v('pc'), vatRegistered, vatId: C.normVatId(v('vat')), taxNumber: v('tax').replace(/\s+/g, ''),
      registrationNumber: v('reg'), court: v('court'), shareCapital: v('cap'), email: v('email'), phone: v('phone'), web: v('web'),
      iban: v('iban').replace(/\s+/g, '').toUpperCase(), bic: v('bic').toUpperCase(), bank: v('bank'), paymentDays: Number(v('days') || 0),
      defaultVatRate: Number(v('rate')), lang: v('lang'), footer: v('footer') };
    if (!$('#s-prefix').disabled) data.numberPrefix = v('prefix');
    const warn = [];
    if (data.vatRegistered && data.vatId && !C.vatIdLooksValid(data.vatId)) warn.push('The VAT ID does not pass the FURS check digit.');
    if (data.taxNumber && !C.siTaxNumberValid(data.taxNumber)) warn.push('The tax number does not pass the FURS check digit.');
    if (data.iban && !C.ibanValid(data.iban)) warn.push('The IBAN checksum is wrong.');
    await mutate('settings.update', 'Updated company settings', (s) => { Object.assign(s.settings, data); return { audit: { fields: Object.keys(data) } }; });
    toast(warn.length ? `Saved. ${warn.join(' ')}` : 'Settings saved');
  }
  async function backup() {
    const s = await readState();
    download(`billing-backup-${C.todayIso()}.json`, JSON.stringify(s, null, 1), 'application/json');
    await mutate('data.backup', 'Downloaded a backup', (st) => { st.meta.lastBackupAt = new Date().toISOString(); });
  }
  async function archive() {
    if (!window.JSZip) await new Promise((res, rej) => { const el = document.createElement('script'); el.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'; el.onload = res; el.onerror = rej; document.head.appendChild(el); });
    toast('Building the archive…');
    const zip = new window.JSZip();
    const issued = state.invoices.filter((i) => i.number);
    for (const inv of issued) zip.file(`${inv.year}/${inv.number}.pdf`, await window.BillingPdf.blob(inv.snapshot, { amountDue: inv.kind === 'credit_note' ? undefined : inv.snapshot.totals.total }));
    const years = [...new Set(issued.map((i) => i.year))];
    for (const y of years) zip.file(`${y}/evidenca-izdanih-${y}.csv`, C.toCsv(C.KIR_COLUMNS, C.kirRows(state, `${y}-01-01`, `${y}-12-31`), C.MONEY_KEYS));
    zip.file('backup.json', JSON.stringify(await readState(), null, 1));
    const check = await verifyIntegrity(state);
    zip.file('README.txt', `Billing archive for ${state.settings.companyName}\nCreated ${new Date().toISOString()}\n${issued.length} issued documents, ${state.audit.length} log entries.\nIntegrity check: ${check.problems.length ? check.problems.join('; ') : 'OK'}\nKeep this archive for 10 years after the end of each year (ZDDV-1).\n`);
    download(`billing-archive-${C.todayIso()}.zip`, await zip.generateAsync({ type: 'blob' }));
    await mutate('data.archive', `Downloaded an archive of ${issued.length} documents`, (st) => { st.meta.lastBackupAt = new Date().toISOString(); });
  }
  async function checkIntegrity() {
    try {
      const r = await verifyIntegrity(state);
      const changed = r.problems.join('|') !== integrityProblems.join('|');
      integrityProblems = r.problems;
      if (changed) render();
    } catch (e) { console.error(e); }
  }
  async function verify() {
    const r = await verifyIntegrity(state);
    integrityProblems = r.problems;
    alertBox(r.problems.length ? 'Integrity problems found' : 'Integrity check passed',
      r.problems.length ? `<ul class="problems">${r.problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>`
        : `<div class="okline">${r.events} log entries form an unbroken hash chain, all ${r.documents} issued documents match what was issued, and numbering has no gaps or duplicates.</div>`, true);
  }
  async function restore(file) {
    const text = await file.text();
    let data;
    try { data = JSON.parse(text); } catch { return alertBox('Not a backup', 'This file is not valid JSON.'); }
    if (!data || !Array.isArray(data.invoices) || !Array.isArray(data.audit) || !data.settings) return alertBox('Not a backup', 'This file is not a Billing backup.');
    const check = await verifyIntegrity(data);
    if (check.problems.length) return alertBox('Backup failed the integrity check', `<ul class="problems">${check.problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul><p class="small">It was not restored.</p>`, true);
    if (state.invoices.some((i) => i.number) && prompt('This replaces all data in this browser, including issued invoices. Type REPLACE to continue.') !== 'REPLACE') return;
    await withLock(async () => { await writeState(data); state = data; });
    if (channel) channel.postMessage('changed');
    integrityProblems = [];
    render();
    toast(`Restored ${data.invoices.filter((i) => i.number).length} issued documents`);
  }
  async function wipe() {
    const issued = state.invoices.filter((i) => i.number).length;
    const msg = issued && !state.meta.sample
      ? `This permanently deletes ${issued} issued invoices from this browser. You must still keep them for 10 years, so download the archive first. Type DELETE to continue.`
      : 'Delete all data in this browser? Type DELETE to continue.';
    if (prompt(msg) !== 'DELETE') return;
    await withLock(async () => { await writeState(emptyState()); state = emptyState(); });
    integrityProblems = [];
    if (channel) channel.postMessage('changed');
    editing = null;
    location.hash = 'overview';
    render();
    toast('Everything was deleted');
  }

  // ---------- Audit log & Compliance ----------
  function pageAudit() {
    const rows = state.audit.slice().reverse();
    return `${topbar('<button class="btn" data-act="verify">Check integrity</button>')}
      ${pageHead('Audit log', 'Every change, oldest first in the chain. Each entry stores the SHA-256 hash of the one before it, so an edited or removed entry breaks the chain (ZDavP-2 Art. 38).')}
      <div class="card table-card">${rows.length ? `<div class="tw"><table><thead><tr><th>#</th><th>When (UTC)</th><th>Event</th><th>What</th><th>Hash</th></tr></thead><tbody>
        ${rows.map((e) => `<tr><td class="mono small">${e.seq}</td><td class="mono small">${esc(e.at.replace('T', ' ').slice(0, 19))}</td><td class="mono small">${esc(e.type)}</td><td>${esc(e.summary)}</td><td class="mono small muted" title="${esc(e.hash)}">${esc(e.hash.slice(0, 12))}…</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">No entries yet.</div>'}</div>`;
  }
  const CHECKS = [
    ['ok', 'All mandatory invoice data', 'Issue date, sequential number, your VAT ID (or tax number if not VAT registered), the customer\'s VAT ID where they pay the VAT, both names and addresses, quantity and type of supply, date of supply or service period, base per rate, unit price excl. VAT, discounts, VAT rate and VAT amount.', 'ZDDV-1 Art. 82'],
    ['ok', 'Required clauses', '"Obrnjena davčna obveznost" for reverse charge, the exemption article for EU and export supplies, and "DDV ni obračunan na podlagi prvega odstavka 94. člena ZDDV-1" when you are not VAT registered. Printed automatically from the treatment.', 'ZDDV-1 Art. 82, 94'],
    ['ok', 'VAT in euros', 'Documents are issued in EUR, so the VAT amount is always in euros and cents.', 'ZDDV-1 Art. 82; FURS "Računi" §3.0'],
    ['ok', 'Sequential numbering without gaps', 'A number is assigned only when you issue, in a locked step shared by all open tabs. One series per year, and issue dates can\'t go backwards within the series.', 'ZDDV-1 Art. 82(2)'],
    ['ok', 'Issued documents can\'t be changed or deleted', 'Issuing freezes everything printed on the document. Corrections are credit notes that reference the original invoice\'s number and date.', 'ZDavP-2 Art. 38(8); ZDDV-1 Art. 82'],
    ['ok', 'Every change is traceable', 'All actions are kept in a SHA-256 hash chain, and issued documents are checked against the hash taken when they were issued. The check runs every time the app opens; a changed or removed entry shows a red warning.', 'ZDavP-2 Art. 38(8)'],
    ['you', 'Keep copies off this device', 'The log makes tampering visible but can\'t stop someone with full access to this browser rewriting all of its data. Your downloaded archives and backups, stored elsewhere, are what proves the original invoices.', 'ZDDV-1 Art. 84; ZDavP-2 Art. 38'],
    ['ok', 'EU invoices by the 15th', 'Drafts for intra-EU supplies and reverse-charge services from a past month are flagged, because they must be issued by the 15th of the following month.', 'ZDDV-1 Art. 81'],
    ['ok', 'Data for the VAT ledgers and RP-O', 'The VAT ledger and EU summary pages export the issued-document data per period for your accountant or eDavki.', 'ZDDV-1 Art. 85.a; RP-O'],
    ['you', 'Keep invoices for 10 years', 'Data lives only in this browser. Download the backup and the yearly archive (PDFs + ledger) and keep them safely for 10 years after the end of the year (20 years for real estate).', 'ZDDV-1 Art. 84–87'],
    ['you', 'Submit the VAT ledgers and RP-O', 'From tax periods starting 1 July 2025, VAT-registered businesses submit the ledgers with each VAT return. File the RP-O in eDavki by the 20th of the following month. This app prepares the data; it doesn\'t file anything.', 'FURS evidence DDV; RP-O'],
    ['you', 'Check customer VAT IDs in VIES', 'The app checks the format and the Slovenian check digit but can\'t query VIES from a static page. Check EU customers before using reverse charge.', 'ZDDV-1 Art. 25, 46'],
    ['you', 'Choose the right VAT treatment', 'The treatments and clause wording follow FURS guidance, but special cases (travel agencies, margin schemes, new vehicles, real estate) are not covered. Ask your accountant when unsure.', 'ZDDV-1 Art. 82'],
    ['no', 'Card or cash payments', 'Card, cash and cheque payments are "cash business" and need fiscal verification at a FURS-certified till (ZOI/EOR codes, registered business premises). This app records bank transfers to your TRR only.', 'ZDavPR Art. 2–3'],
    ['no', 'Structured e-invoices (e-SLOG / UBL)', 'Invoices to the public sector must already be e-SLOG through UJP. Domestic B2B e-invoices become mandatory on 1 January 2028; PDFs will not qualify. This app makes PDFs only.', 'ZOPSPU-1; B2B e-invoicing law (Oct 2025)'],
  ];
  function pageCompliance() {
    const icons = { ok: '✓', you: '!', no: '×' };
    const titles = { ok: 'Built into the app', you: 'Your responsibility', no: 'Not supported' };
    const group = (k) => `<div class="card"><h3>${titles[k]}</h3><div class="sub mono">${CHECKS.filter((c) => c[0] === k).length} items</div>
      ${CHECKS.filter((c) => c[0] === k).map(([, t, d, r]) => `<div class="check"><span class="ic ${k}">${icons[k]}</span><div><b>${esc(t)}</b><p>${esc(d)}</p><span class="ref mono">${esc(r)}</span></div></div>`).join('')}</div>`;
    return `${topbar()}
      ${pageHead('Compliance', 'What Slovenian law requires of an invoicing tool, and how this app meets it. This is a summary of FURS guidance as of October 2026, not tax advice.')}
      ${group('ok')}${group('you')}${group('no')}
      <div class="card"><h3>Sources</h3><div class="sub mono">Financial Administration (FURS) and Ministry of Finance</div><ul class="small">
        <li><a href="https://www.fu.gov.si/fileadmin/Internet/Davki_in_druge_dajatve/Podrocja/Davek_na_dodano_vrednost/Opis/Racuni.doc" target="_blank" rel="noopener">FURS – Podrobnejši opis: Računi (ZDDV-1 Art. 81–87)</a></li>
        <li><a href="https://www.fu.gov.si/fileadmin/Internet/Nadzor/Podrocja/Davcne_blagajne_in_VKR/Opis/Davcne_blagajne_-_zavezanec_po_Zakonu_o_davcnem_potrjevanju_racunov_ZDavPR.pdf" target="_blank" rel="noopener">FURS – Davčne blagajne: zavezanec po ZDavPR</a></li>
        <li><a href="https://www.gov.si/novice/2025-05-05-pravocasna-priprava-na-predlozitev-evidence-obracunanega-ddv-in-evidence-odbitka-ddv/" target="_blank" rel="noopener">gov.si – Predložitev evidence obračunanega DDV in odbitka DDV</a></li>
        <li><a href="https://www.racunovodstvo.net/zakonodaja/zdavp/38-clen" target="_blank" rel="noopener">ZDavP-2, Article 38</a></li>
        <li><a href="https://kpmg.com/us/en/taxnewsflash/news/2025/10/slovenia-mandatory-e-invoicing-b2b-transactions.html" target="_blank" rel="noopener">KPMG – Slovenia: mandatory B2B e-invoicing from 2028</a></li>
      </ul></div>`;
  }

  // ---------- dialogs ----------
  function openDialog(title, body, foot) {
    const d = $('#dlg');
    d.innerHTML = `<div class="dlg-head"><h2>${esc(title)}</h2><button class="btn small" data-act="close" aria-label="Close">×</button></div><div class="dlg-body">${body}</div><div class="dlg-foot">${foot}</div>`;
    if (!d.open) d.showModal();
  }
  const closeDialog = () => { const d = $('#dlg'); if (d.open) d.close(); };
  function alertBox(title, msg, html = false) {
    openDialog(title, html ? msg : `<p>${esc(msg).replace(/\n/g, '<br>')}</p>`, '<button class="btn primary" data-act="close">OK</button>');
  }

  // ---------- sample data ----------
  async function loadSample() {
    const s = emptyState();
    s.meta.sample = true;
    Object.assign(s.settings, { companyName: 'Vzorec d.o.o.', address: 'Dunajska cesta 5', postalCity: '1000 Ljubljana', vatRegistered: true, vatId: 'SI12345679',
      taxNumber: '12345679', registrationNumber: '1234567000', court: 'Okrožno sodišče v Ljubljani', shareCapital: '7.500,00 EUR', iban: 'SI56191000000123438',
      bic: 'BSLJSI2X', bank: 'Vzorčna banka d.d.', email: 'racuni@vzorec.example', numberPrefix: 'VZ-', paymentDays: 15, defaultVatRate: 22, lang: 'sl',
      footer: 'Vzorčni podatki – to ni pravi račun.' });
    const cl = (name, address, postalCity, country, vatId, treatment, lang, email) => { const c = { id: uid(), name, address, postalCity, country, vatId, taxNumber: '', email, treatment, lang, paymentDays: 15 }; s.clients.push(c); return c; };
    const lipa = cl('Studio Lipa d.o.o.', 'Trubarjeva cesta 12', '1000 Ljubljana', 'SI', 'SI23456787', 'domestic', 'sl', 'racuni@studio-lipa.example');
    const bright = cl('Brightline Analytics GmbH', 'Mariahilfer Straße 1', '1060 Wien', 'AT', 'ATU99999999', 'eu_services', 'en', 'ap@brightline.example');
    const nimbus = cl('Nimbus Cloud, Inc.', '500 Market Street', 'San Francisco, CA 94105', 'US', '', 'export_services', 'en', 'billing@nimbus.example');
    const kav = cl('Kavarna Center d.o.o.', 'Glavni trg 3', '2000 Maribor', 'SI', 'SI34567895', 'domestic', 'sl', 'info@kavarna.example');
    const ym = C.todayIso().slice(0, 7);
    const m1 = C.prevMonth(ym), m2 = C.prevMonth(m1), m3 = C.prevMonth(m2);
    s.contracts.push({ id: uid(), clientId: lipa.id, title: 'Mesečni pavšal – vzdrževanje spletne strani', reference: 'P-2026-01', monthlyFee: 1200, hourlyRate: 60, timing: 'advance', start: `${m3}-01`, end: '', paymentDays: 15 });
    s.contracts.push({ id: uid(), clientId: bright.id, title: 'Monthly analytics retainer', reference: 'C-2026-04', monthlyFee: 2500, hourlyRate: 85, timing: 'arrears', start: `${m3}-01`, end: '', paymentDays: 30 });
    await appendAudit(s, 'data.sample', 'Loaded sample data', {});
    const issueAt = async (doc, date, paid) => {
      s.invoices.push(doc);
      const year = Number(date.slice(0, 4));
      const seq = C.nextSeq(s, year);
      if (doc.kind !== 'credit_note') doc.dueDate = C.addDays(date, doc.paymentDays);
      const snap = C.buildSnapshot(s, doc, { issueDate: date, seq });
      Object.assign(doc, { number: snap.number, year, seq, issueDate: date, reference: snap.reference, snapshot: snap, issuedAt: `${date}T09:00:00.000Z` });
      s.counters[String(year)] = seq;
      await appendAudit(s, 'document.issue', `Issued ${docLabel(doc).toLowerCase()} ${snap.number} (${C.eur(snap.totals.total)})`, { id: doc.id, number: snap.number, total: snap.totals.total, snapshotHash: await sha256(C.canonical(snap)) });
      if (paid) {
        const p = { id: uid(), date: paid, amount: snap.totals.total, method: 'bank_transfer', note: 'Bank transfer', recordedAt: `${paid}T10:00:00.000Z` };
        doc.payments.push(p);
        await appendAudit(s, 'payment.record', `Payment ${C.eur(p.amount)} on ${C.dmy(paid)} for ${snap.number}`, { id: doc.id, paymentId: p.id, amount: p.amount, date: paid });
      }
      return doc;
    };
    const mk = (c, lines, extra = {}) => ({ id: uid(), kind: 'invoice', clientId: c.id, treatment: c.treatment, lang: c.lang, supplyFrom: extra.supplyFrom, supplyTo: extra.supplyTo || '', paymentDays: extra.paymentDays || 15, note: '', lines, payments: [], createdAt: new Date().toISOString(), ...extra });
    const L = (description, qty, unit, unitPrice) => ({ description, qty, unit, unitPrice, discountPct: 0, vatRate: 22 });
    const all = [];
    const inYear = () => true; // numbering restarts each year, so earlier-year samples are fine
    if (inYear(m3)) all.push([mk(lipa, [L(`Mesečni pavšal – ${m3}`, 1, 'mes.', 1200)], { supplyFrom: `${m3}-01`, supplyTo: C.lastDayOfMonth(m3) }), `${m3}-02`, `${m3}-12`]);
    if (inYear(m3)) all.push([mk(kav, [L('Izdelava menija in tiskovin', 1, 'kos', 450), L('Fotografiranje jedi', 4, 'ur', 55)], { supplyFrom: `${m3}-18` }), `${m3}-20`, `${C.addDays(`${m3}-20`, 12)}`]);
    if (inYear(m2)) all.push([mk(lipa, [L(`Mesečni pavšal – ${m2}`, 1, 'mes.', 1200), L('Dodatna dela: nov obrazec', 3.5, 'ur', 60)], { supplyFrom: `${m2}-01`, supplyTo: C.lastDayOfMonth(m2) }), `${m2}-01`, `${m2}-14`]);
    if (inYear(m2)) all.push([mk(bright, [L(`Analytics retainer – ${m3}`, 1, 'month', 2500)], { supplyFrom: `${m3}-01`, supplyTo: C.lastDayOfMonth(m3), paymentDays: 30 }), `${m2}-03`, `${m2}-28`]);
    if (inYear(m2)) all.push([mk(nimbus, [L('Data pipeline audit', 1, 'project', 3200)], { supplyFrom: `${m2}-10`, supplyTo: `${m2}-21` }), `${m2}-22`, null]);
    if (inYear(m1)) all.push([mk(lipa, [L(`Mesečni pavšal – ${m1}`, 1, 'mes.', 1200)], { supplyFrom: `${m1}-01`, supplyTo: C.lastDayOfMonth(m1) }), `${m1}-01`, null]);
    if (inYear(m1)) all.push([mk(bright, [L(`Analytics retainer – ${m2}`, 1, 'month', 2500), L('Dashboard redesign', 12, 'h', 85)], { supplyFrom: `${m2}-01`, supplyTo: C.lastDayOfMonth(m2), paymentDays: 30 }), `${m1}-02`, null]);
    // Credit note for the Kavarna invoice, issued in date order with the rest (numbers follow dates).
    all.push([() => {
      const kavInv = s.invoices.find((i) => i.clientId === kav.id && i.kind === 'invoice');
      return mk(kav, [L('Fotografiranje jedi – popravek ur', -1, 'ur', 55)], { kind: 'credit_note', creditOf: kavInv.id, supplyFrom: kavInv.snapshot.supplyFrom, paymentDays: 0 });
    }, `${m2}-05`, null]);
    all.sort((a, b) => a[1].localeCompare(b[1]));
    for (const [d, date, paid] of all) await issueAt(typeof d === 'function' ? d() : d, date, paid && paid <= C.todayIso() ? paid : null);
    s.work.push({ id: uid(), clientId: lipa.id, date: `${m1}-14`, description: 'Posodobitev vtičnikov in varnostni pregled', mode: 'hours', hours: 2.5, rate: 60, amount: 0, billable: true, invoiceId: null });
    s.work.push({ id: uid(), clientId: bright.id, date: `${m1}-20`, description: 'Ad-hoc churn analysis', mode: 'hours', hours: 6, rate: 85, amount: 0, billable: true, invoiceId: null });
    s.work.push({ id: uid(), clientId: kav.id, date: `${ym}-02`, description: 'Nalepke za izložbo', mode: 'fixed', hours: 0, rate: 0, amount: 180, billable: true, invoiceId: null });
    await withLock(async () => { await writeState(s); state = s; });
    if (channel) channel.postMessage('changed');
    location.hash = 'overview';
    render();
    toast('Sample data loaded');
  }

  // ---------- router & render ----------
  function parseRoute() {
    const h = location.hash.replace(/^#/, '') || 'overview';
    const [page, id] = h.split('/');
    route = { page: page || 'overview', id: id || null };
  }
  const PAGES = { overview: pageOverview, invoices: pageInvoices, doc: pageDoc, run: pageRun, clients: pageClients, contracts: pageContracts, work: pageWork, kir: pageKir, rpo: pageRpo, settings: pageSettings, audit: pageAudit, compliance: pageCompliance };
  function render() {
    renderSide();
    const fn = PAGES[route.page] || pageOverview;
    const focusedId = document.activeElement && document.activeElement.id;
    $('#main').innerHTML = fn();
    if (route.page === 'doc') updateDraftTotals();
    if (focusedId === 'q') { const q = $('#q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); $('#qres').innerHTML = searchResults(); }
    const titles = { overview: 'Overview', invoices: 'Invoices', doc: 'Document', run: 'Billing run', clients: 'Clients', contracts: 'Contracts', work: 'Work log', kir: 'VAT ledger', rpo: 'EU summary', settings: 'Settings', audit: 'Audit log', compliance: 'Compliance' };
    document.title = `${titles[route.page] || 'Billing'} · Billing · Adrial Apps`;
  }

  // ---------- events ----------
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) { if (!e.target.closest('.search')) { const r = $('#qres'); if (r) r.innerHTML = ''; } return; }
    const act = el.dataset.act;
    const doc = route.page === 'doc' ? docById(route.id) : null;
    const handlers = {
      go: () => { location.hash = el.dataset.to; searchQ = ''; },
      close: () => closeDialog(),
      'new-invoice': () => guard(() => createDraft(newDraft(state.clients[0]?.id), 'New invoice draft')),
      'inv-filter': () => { invoiceFilter = el.dataset.v; render(); },
      'work-filter': () => { workFilter = el.dataset.v; render(); },
      'kir-range': () => { kirRange = el.dataset.v; render(); },
      'add-line': () => { editing.doc.lines.push({ description: '', qty: 1, unit: 'kos', unitPrice: 0, discountPct: 0, vatRate: Number(state.settings.defaultVatRate) }); editing.dirty = true; render(); },
      'del-line': () => { editing.doc.lines.splice(Number(el.dataset.k), 1); editing.dirty = true; render(); },
      'save-draft': () => guard(() => saveDraft()),
      'preview-pdf': () => guard(async () => { if (!editing.doc.clientId) throw new Error('Choose a client first.'); await saveDraft({ quiet: true }); await downloadPdf(editing.doc); }),
      'issue-dialog': () => guard(async () => { await saveDraft({ quiet: true }); issueDialog(); }),
      issue: () => guard(issue),
      'delete-draft': () => guard(() => deleteDraft(doc)),
      pdf: () => guard(() => downloadPdf(doc)),
      email: () => guard(() => emailClient(doc)),
      'payment-dialog': () => paymentDialog(doc),
      'save-payment': () => guard(() => savePayment(el.dataset.id)),
      'undo-payment': () => guard(() => undoPayment(doc, el.dataset.pid)),
      'credit-note': () => guard(() => creditNote(doc)),
      duplicate: () => guard(() => duplicate(doc)),
      'run-create': () => guard(runCreate),
      'edit-client': () => { e.stopPropagation(); clientDialog(el.dataset.id); },
      'save-client': () => guard(() => saveClient(el.dataset.id)),
      'delete-client': () => guard(() => deleteClient(el.dataset.id)),
      'edit-contract': () => contractDialog(el.dataset.id),
      'save-contract': () => guard(() => saveContract(el.dataset.id)),
      'delete-contract': () => guard(() => deleteContract(el.dataset.id)),
      'edit-work': () => workDialog(el.dataset.id),
      'save-work': () => guard(() => saveWork(el.dataset.id)),
      'delete-work': () => guard(() => deleteWork(el.dataset.id)),
      'kir-csv': () => { const [f, t] = kirPeriod(); download(`evidenca-izdanih-${f}_${t}.csv`, C.toCsv(C.KIR_COLUMNS, C.kirRows(state, f, t), C.MONEY_KEYS), 'text/csv'); },
      'rpo-csv': () => download(`rp-o-${rpoMonth}.csv`, C.toCsv([['country', 'Država'], ['vatId', 'ID za DDV'], ['customer', 'Kupec'], ['type', 'Vrsta'], ['amount', 'Vrednost']], C.rpoRows(state, rpoMonth), new Set(['amount'])), 'text/csv'),
      'save-settings': () => guard(saveSettings),
      backup: () => guard(backup),
      archive: () => guard(archive),
      verify: () => guard(verify),
      sample: () => guard(loadSample),
      wipe: () => guard(wipe),
    };
    if (handlers[act]) { e.preventDefault(); handlers[act](); }
  });
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'q') { searchQ = t.value; $('#qres').innerHTML = searchResults(); return; }
    if (t.dataset.actInput === 'run-period' && t.value) { runPeriod = t.value; render(); return; }
    if (t.dataset.actInput === 'rpo-month' && t.value) { rpoMonth = t.value; render(); return; }
    if (t.dataset.actInput === 'kir-from') { kirCustom.from = t.value; render(); return; }
    if (t.dataset.actInput === 'kir-to') { kirCustom.to = t.value; render(); return; }
    if (!editing) return;
    if (t.dataset.f) {
      const f = t.dataset.f;
      editing.doc[f] = f === 'paymentDays' ? Number(t.value || 0) : t.value;
      editing.dirty = true;
      if (f === 'clientId') {
        const c = client(t.value);
        if (c) Object.assign(editing.doc, { treatment: c.treatment, lang: c.lang, paymentDays: Number(c.paymentDays ?? state.settings.paymentDays) });
        render();
      } else if (f === 'treatment') render();
    } else if (t.dataset.line != null) {
      const l = editing.doc.lines[Number(t.dataset.line)];
      const f = t.dataset.lf;
      l[f] = ['qty', 'unitPrice', 'discountPct', 'vatRate'].includes(f) ? Number(t.value) : t.value;
      editing.dirty = true;
      updateDraftTotals();
    }
  });
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.actFile === 'restore' && t.files[0]) guard(() => restore(t.files[0]));
    if (editing && t.tagName === 'SELECT' && t.dataset.line != null) { editing.doc.lines[Number(t.dataset.line)].vatRate = Number(t.value); updateDraftTotals(); }
  });
  let currentHash = location.hash;
  window.addEventListener('hashchange', () => {
    // Cancelling restores the old address without firing another hashchange.
    if (editing && editing.dirty && !confirm('Leave without saving the draft?')) { history.replaceState(null, '', currentHash || '#overview'); return; }
    currentHash = location.hash;
    if (!(route.page === 'doc' && location.hash.includes(route.id))) editing = null;
    parseRoute();
    render();
    $('#main').focus({ preventScroll: true });
    window.scrollTo(0, 0);
  });
  window.addEventListener('beforeunload', (e) => { if (editing && editing.dirty) { e.preventDefault(); e.returnValue = ''; } });
  if (channel) channel.onmessage = async () => { state = (await readState()) || emptyState(); if (!(editing && editing.dirty)) render(); checkIntegrity(); };

  (async function init() {
    parseRoute();
    try {
      state = (await readState()) || emptyState();
    } catch (err) {
      $('#main').innerHTML = `<div class="banner bad"><span class="dot"></span><b>Storage unavailable</b><span class="mono grow">This browser blocks local storage (private window?). Billing needs it to keep your data.</span></div>`;
      return;
    }
    checkIntegrity();
    if (!state.clients.length && !state.invoices.length && route.page === 'overview') {
      renderSide();
      $('#main').innerHTML = `${topbar()}${pageHead('Billing', 'Invoices, credit notes and monthly billing runs for a Slovenian business, with the data FURS asks for. Everything is stored in this browser only.')}
        <div class="grid2"><div class="card"><h3>Start with your company</h3><div class="sub mono">Name, address, VAT ID, IBAN</div><p class="small">Then add clients and issue your first invoice.</p><button class="btn primary" data-act="go" data-to="settings">Set up</button></div>
        <div class="card"><h3>Or look around first</h3><div class="sub mono">A fictional company with sample clients and invoices</div><p class="small">Delete it in Settings before you issue real invoices.</p><button class="btn" data-act="sample">Load sample data</button></div></div>`;
      return;
    }
    render();
  })();
})();
