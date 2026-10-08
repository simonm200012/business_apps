/* ERP demo app: storage, indexes, mutations, router, pages, bus, sync. One IIFE, no dependencies. */
(function () {
  'use strict';
  const D = window.ERPData, U = D.U, VAT = D.VAT, LOC = D.LOCATIONS, CATS = D.CATEGORIES;
  const TODAY = U.ymd(new Date()), USD_EUR = 0.92, PS = 15, TAB = Math.random().toString(36).slice(2);
  const $ = (s, r) => (r || document).querySelector(s), $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const r2 = U.r2, fmtE = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }), fmtU = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  const eur = n => fmtE.format(n || 0), num = n => new Intl.NumberFormat('en-IE').format(n || 0);
  const money = (n, cur) => cur === 'USD' ? fmtU.format(n || 0) : eur(n);
  let db = null, IX = {}, cache = {}, ui = {}, pending = false, saveT = null, pubT = null, writeQ = Promise.resolve(), sync = null, curForm = null, inboxBusy = false, memOnly = false;
  const posS = { loc: 'SI-KOM', cart: [], cust: '', method: 'card', q: '' };
  const LISTS = {};
  const bc = (() => { try { return new BroadcastChannel('adrial-erp'); } catch (e) { return null; } })();
  try { ui = JSON.parse(localStorage.getItem('adrial-erp-ui') || '{}') || {}; } catch (e) { ui = {}; }
  const saveUi = () => { try { localStorage.setItem('adrial-erp-ui', JSON.stringify(ui)); } catch (e) { } };

  /* ---------- storage ---------- */
  function idbTx(mode, fn) {
    return new Promise((res, rej) => {
      if (!window.indexedDB) return rej(new Error('IndexedDB unavailable'));
      const r = indexedDB.open('adrial-erp', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onerror = r.onblocked = () => rej(r.error || new Error('blocked'));
      r.onsuccess = () => {
        const d = r.result, t = d.transaction('kv', mode); let out;
        try { out = fn(t.objectStore('kv')); } catch (e) { d.close(); return rej(e); }
        t.oncomplete = () => { d.close(); res(out && out.result); };
        t.onerror = t.onabort = () => { d.close(); rej(t.error); };
      };
    });
  }
  const idbGet = () => idbTx('readonly', s => s.get('db')), idbPut = d => idbTx('readwrite', s => s.put(d, 'db'));
  const idbReset = d => idbTx('readwrite', s => { s.clear(); return s.put(d, 'db'); });
  const validDb = d => !!d && d.version === D.VERSION && Array.isArray(d.products) && Array.isArray(d.sos) && !!d.stock;
  function save() { pending = true; clearTimeout(saveT); saveT = setTimeout(flush, 250); }
  function flush() {
    if (!pending) return writeQ;
    pending = false; clearTimeout(saveT);
    const snap = db;
    writeQ = writeQ.then(() => memOnly ? null : idbPut(snap)).then(() => { if (bc) bc.postMessage({ type: 'changed', id: TAB }); if (sync) sync.changed(); }).catch(() => { memOnly = true; toast('Could not save to this browser; changes stay in memory.'); });
    return writeQ;
  }
  addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
  if (bc) bc.onmessage = e => {
    if (!e.data || e.data.type !== 'changed' || e.data.id === TAB || pending || !db) return;
    idbGet().then(d => { if (validDb(d) && !pending) { db = d; ensureSchema(); reindex(); render(true); } }).catch(() => { });
  };

  /* ---------- indexes and schema ---------- */
  const nextId = () => db.nextId++;
  const docNo = (kind, date) => D.docNo(db.seq, kind, date || TODAY);
  function map(list) { const m = {}; list.forEach(x => { m[x.id] = x; }); return m; }
  function reindex() {
    IX = { p: map(db.products), c: map(db.customers), s: map(db.suppliers), so: map(db.sos), po: map(db.pos), inv: map(db.invoices), tr: map(db.transfers), q: map(db.quotes), cn: map(db.creditNotes), cnt: map(db.counts), loc: map(LOC), sku: {} };
    db.products.forEach(p => { IX.sku[p.sku.toLowerCase()] = p; });
    cache = {};
  }
  function ensureSchema() {
    ['suppliers', 'products', 'customers', 'sos', 'pos', 'invoices', 'movements', 'creditNotes', 'damaged', 'quotes', 'counts', 'transfers'].forEach(k => { if (!Array.isArray(db[k])) db[k] = []; });
    db.stock = db.stock || {}; db.seq = db.seq || {}; db.nextId = db.nextId || 1000000;
    db.transfersMigrated = true;
    if (!db.supplierPrices || !Object.keys(db.supplierPrices).length) seedPrices();
    if (!db.priceHistory) db.priceHistory = {};
    if (!db.minmax) deriveMinMax();
  }
  function seedPrices() {
    const R = D.rng(4242), pick = a => a[Math.floor(R() * a.length)];
    db.supplierPrices = {}; db.priceHistory = {};
    let us = db.suppliers.find(s => s.currency === 'USD');
    if (!us) { us = { id: nextId(), name: 'Pacific Lens Supply Inc.', country: 'US', leadDays: 21, currency: 'USD', email: 'sales@pacificlens.example.com' }; db.suppliers.push(us); }
    db.suppliers.forEach(s => { db.supplierPrices[s.id] = {}; });
    db.products.forEach(p => {
      db.supplierPrices[p.supplierId][p.id] = { price: p.cost, cur: 'EUR' };
      const others = db.suppliers.filter(s => s.id !== p.supplierId && s.currency !== 'USD');
      for (let k = 0; k < 2; k++) { const s = pick(others); if (!db.supplierPrices[s.id][p.id]) db.supplierPrices[s.id][p.id] = { price: r2(p.cost * (0.92 + R() * 0.2)), cur: 'EUR' }; }
      if (['contacts', 'solutions', 'lenses'].includes(p.cat)) db.supplierPrices[us.id][p.id] = { price: r2(p.cost / USD_EUR * (0.93 + R() * 0.1)), cur: 'USD' };
      db.priceHistory[p.id] = [{ date: U.add(TODAY, -D.DAYS), price: r2(p.price * 0.95), cost: r2(p.cost * 0.96) }, { date: U.add(TODAY, -120), price: p.price, cost: p.cost }];
    });
  }
  function deriveMinMax() {
    const from = U.add(TODAY, -90), dem = {};
    db.movements.forEach(m => {
      if (m.date < from || !(m.type === 'sale' || (m.type === 'transfer_out' && m.loc === 'WH'))) return;
      const o = dem[m.pid] || (dem[m.pid] = {}); o[m.loc] = (o[m.loc] || 0) - m.qty;
    });
    db.minmax = {};
    db.products.forEach(p => {
      const o = db.minmax[p.id] = {};
      LOC.forEach(l => {
        const d = ((dem[p.id] || {})[l.id] || 0) / 90, wh = l.id === 'WH';
        if (d > 0) { const mn = wh ? Math.max(20, Math.ceil(d * 80)) : Math.max(4, Math.ceil(d * 28)); o[l.id] = { min: mn, max: wh ? Math.ceil(d * 160) + 30 : Math.max(mn + 5, 10) }; }
        else o[l.id] = wh ? { min: 10, max: 40 } : { min: 3, max: 8 };
      });
    });
  }

  /* ---------- stock, money, status maths ---------- */
  const onHand = (pid, l) => { const s = db.stock[pid] || {}; return l ? (s[l] || 0) : Object.values(s).reduce((a, b) => a + b, 0); };
  function resMap() {
    if (cache.res) return cache.res;
    const m = {};
    db.sos.forEach(so => { if (so.status === 'confirmed') so.lines.forEach(l => { const o = m[l.pid] || (m[l.pid] = {}); o[so.loc] = (o[so.loc] || 0) + l.qty; }); });
    return (cache.res = m);
  }
  const reserved = (pid, l) => { const r = resMap()[pid] || {}; return l ? (r[l] || 0) : Object.values(r).reduce((a, b) => a + b, 0); };
  const avail = (pid, l) => onHand(pid, l) - reserved(pid, l);
  const mm = (pid, l) => ((db.minmax[pid] || {})[l]) || null;
  const isLow = pid => LOC.some(l => { const m = mm(pid, l.id); return m && m.min > 0 && onHand(pid, l.id) < m.min; });
  function incoming(pid, l) { let n = 0; db.transfers.forEach(t => { if (t.to === l && (t.status === 'shipped' || t.status === 'draft')) t.lines.forEach(x => { if (x.pid === pid) n += x.qty; }); }); return n; }
  function openPOQty(pid) { let n = 0; db.pos.forEach(p => { if (p.status === 'ordered' || p.status === 'partial') p.lines.forEach(l => { if (l.pid === pid) n += l.qty - (l.recv || 0); }); }); return n; }
  function changeStock(pid, l, delta, type, ref) {
    const s = db.stock[pid] || (db.stock[pid] = {}), n = (s[l] || 0) + delta;
    if (n < 0) throw new Error(`Not enough stock: ${IX.p[pid].sku} at ${locName(l)} (${s[l] || 0} on hand)`);
    s[l] = n; db.movements.push({ id: nextId(), date: TODAY, pid, loc: l, qty: delta, type, ref: ref || '' });
  }
  const tot = (lines, country) => { let net = 0; lines.forEach(l => { net += l.qty * l.price; }); net = r2(net); const vat = r2(net * (VAT[country] || 0) / 100); return { net, vat, total: r2(net + vat) }; };
  const soTot = so => tot(so.lines, so.country);
  const paidAmt = inv => r2(inv.payments.reduce((a, p) => a + p.amount, 0));
  const credited = inv => r2(db.creditNotes.filter(c => c.invoiceId === inv.id).reduce((a, c) => a + c.total, 0));
  const balance = inv => r2(inv.total - paidAmt(inv) - credited(inv));
  function invStatus(inv) {
    const b = balance(inv);
    if (credited(inv) >= inv.total - 0.005) return 'credited';
    if (b <= 0.005) return 'paid';
    if (inv.due < TODAY) return 'overdue';
    return paidAmt(inv) > 0 ? 'partial' : 'open';
  }
  const locName = id => (IX.loc[id] || { name: id }).name;
  const cName = id => (IX.c[id] || { name: '?' }).name;
  const pLabel = p => p ? `${p.sku} · ${p.name}` : '?';
  const catName = id => (CATS.find(c => c.id === id) || { name: id }).name;
  const supCur = id => (IX.s[id] || {}).currency || 'EUR';

  /* ---------- UI helpers ---------- */
  let toastT = null;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 3200); }
  const badge = s => `<span class="badge s-${esc(s)}">${esc(s)}</span>`;
  const link = (href, text) => `<a href="${esc(href)}">${esc(text)}</a>`;
  const opts = (list, sel) => list.map(([v, t]) => `<option value="${esc(v)}"${String(v) === String(sel) ? ' selected' : ''}>${esc(t)}</option>`).join('');
  const locOpts = (sel, filter) => opts(LOC.filter(filter || (() => true)).map(l => [l.id, l.name]), sel);
  const custOpts = (sel, f) => opts(db.customers.filter(f || (c => c.type !== 'walkin')).map(c => [c.id, c.name]), sel);
  const kpi = (label, val, sub) => `<div class="kpi"><span>${esc(label)}</span><b>${val}</b>${sub ? `<span>${sub}</span>` : ''}</div>`;
  const empty = t => `<div class="empty">${esc(t)}</div>`;
  const notFound = (what, back) => `<p class="empty">${esc(what)} not found. <a href="${back}">Back to list</a></p>`;
  const ICONS = {
    home: 'M3 11l9-8 9 8v10H3zM9 21v-7h6v7', box: 'M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10', refresh: 'M4 12a8 8 0 0 1 14-5l2-2v6h-6M20 12a8 8 0 0 1-14 5l-2 2v-6h6', truck: 'M2 6h11v10H2zM13 10h5l3 3v3h-8M6 19a2 2 0 1 0 0 .1M17 19a2 2 0 1 0 0 .1',
    clip: 'M8 4h8v3H8zM6 5H5v16h14V5h-1M9 12h6M9 16h6', list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01', cart: 'M3 4h2l2 12h11l2-8H6M9 20a1 1 0 1 0 0 .1M17 20a1 1 0 1 0 0 .1', factory: 'M3 21V9l6 4V9l6 4V4h6v17zM7 17h2M13 17h2',
    till: 'M5 3h14v6H5zM3 9h18v12H3zM8 14h2M12 14h2M16 14h.01', file: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h7', bag: 'M5 8h14l-1 13H6zM9 8V6a3 3 0 0 1 6 0v2', users: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M3 20a6 6 0 0 1 12 0M17 11a2.5 2.5 0 1 0 0-5M18 14a5 5 0 0 1 4 6', receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6'
  };
  const icon = n => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[n] || ICONS.list}"/></svg>`;

  /* ---------- generic list ---------- */
  const lst = key => { const s = ui[key] || (ui[key] = {}); if (s.q == null) s.q = ''; if (!s.f) s.f = {}; if (s.page == null) s.page = 0; if (s.dir == null) s.dir = 1; return s; };
  function listHtml(key, cfg) {
    LISTS[key] = cfg; const s = lst(key);
    return `<div class="toolbar"><input type="search" data-inp="q" data-key="${key}" value="${esc(s.q)}" placeholder="Search…" aria-label="Search">` +
      (cfg.filters || []).map(f => `<select data-chg="flt" data-key="${key}" data-name="${f.name}" aria-label="${esc(f.label)}"><option value="">${esc(f.label)}: all</option>${opts(f.opts, s.f[f.name])}</select>`).join('') +
      `<span class="sp"></span>${cfg.extra || ''}<button class="btn sm" data-act="csv" data-key="${key}">Export CSV</button></div><div id="list-${key}">${tableHtml(key)}</div>`;
  }
  function tableHtml(key) {
    const c = LISTS[key], s = lst(key); let rows = c.rows();
    const q = s.q.trim().toLowerCase();
    if (q) rows = rows.filter(r => c.search(r).toLowerCase().includes(q));
    (c.filters || []).forEach(f => { const v = s.f[f.name]; if (v) rows = rows.filter(r => f.test(r, v)); });
    const col = s.sort != null ? c.cols[s.sort] : null;
    if (col && col.sort) rows = rows.slice().sort((a, b) => { const x = col.sort(a), y = col.sort(b); return (x > y ? 1 : x < y ? -1 : 0) * s.dir; });
    else if (c.order) rows = rows.slice().sort(c.order);
    c._rows = rows;
    const pages = Math.max(1, Math.ceil(rows.length / PS)); if (s.page >= pages) s.page = pages - 1;
    const view = rows.slice(s.page * PS, s.page * PS + PS);
    const head = c.cols.map((x, i) => `<th class="${x.cls || ''}"${s.sort === i ? ` aria-sort="${s.dir > 0 ? 'ascending' : 'descending'}"` : ''}>${x.sort ? `<button class="th" data-act="sort" data-key="${key}" data-i="${i}">${esc(x.h)}${s.sort === i ? (s.dir > 0 ? ' ▲' : ' ▼') : ''}</button>` : esc(x.h)}</th>`).join('');
    const body = view.map(r => `<tr>${c.cols.map(x => `<td class="${x.cls || ''}">${x.f(r)}</td>`).join('')}</tr>`).join('');
    return `<div class="tablewrap"><table><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${c.cols.length}">${empty('Nothing to show')}</td></tr>`}</tbody></table></div>` +
      `<div class="pager"><span>${rows.length} row${rows.length === 1 ? '' : 's'}</span><button class="btn sm" data-act="page" data-key="${key}" data-d="-1"${s.page ? '' : ' disabled'}>Prev</button><span>${s.page + 1} / ${pages}</span><button class="btn sm" data-act="page" data-key="${key}" data-d="1"${s.page < pages - 1 ? '' : ' disabled'}>Next</button></div>`;
  }
  function download(name, text, type) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: type || 'text/csv' })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function csvOf(header, rows) { const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; return [header].concat(rows).map(r => r.map(q).join(',')).join('\r\n'); }
  function csvExport(key) {
    const c = LISTS[key]; tableHtml(key); const tmp = document.createElement('div'); const txt = h => { tmp.innerHTML = h; return tmp.textContent.trim(); };
    download(`erp-${key}-${TODAY}.csv`, csvOf(c.cols.map(x => x.h), c._rows.map(r => c.cols.map(x => txt(x.f(r))))));
  }

  /* ---------- layers ---------- */
  function modal(title, body, submitLabel, onSubmit) {
    curForm = onSubmit;
    $('#modalSlot').innerHTML = `<div class="layer modal" data-act="bg"><form class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="sheeth"><h2>${esc(title)}</h2><button type="button" class="x" data-act="closeModal" aria-label="Close">×</button></div><div class="sheetb">${body}</div><div class="sheetf"><button type="button" class="btn" data-act="closeModal">Cancel</button><button class="btn pri">${esc(submitLabel)}</button></div></form></div>`;
    const f = $('#modalSlot input:not([type=hidden]),#modalSlot select'); if (f) f.focus();
  }
  const closeModal = () => { $('#modalSlot').innerHTML = ''; curForm = null; };
  function drawer(title, body) {
    $('#drawerSlot').innerHTML = `<div class="layer drawer" data-act="bgDrawer"><aside class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="sheeth"><h2>${esc(title)}</h2><button class="x" data-act="closeDrawer" aria-label="Close">×</button></div><div class="sheetb">${body}</div></aside></div>`;
  }
  const closeDrawerSlot = () => { $('#drawerSlot').innerHTML = ''; };
  function closeDrawer() { const r = parseHash(); closeDrawerSlot(); location.hash = '#/' + r.base; }
  const dl = (a, b) => `<div><span>${esc(a)}</span>${b}</div>`;
  const linesEditor = (price, rows) => `<div id="lines"><div class="muted small">Product (SKU), quantity${price ? ', unit price (blank = list price)' : ''}</div>${(rows || [{}, {}]).map(r => lineRow(price, r)).join('')}</div><button type="button" class="btn sm" data-act="addLine" data-price="${price ? 1 : ''}">+ Add line</button><datalist id="plist">${db.products.map(p => `<option value="${esc(p.sku)}">${esc(p.name)}</option>`).join('')}</datalist>`;
  const lineRow = (price, r) => `<div class="lrow"><input name="sku" list="plist" value="${esc(r.sku || '')}" placeholder="SKU" autocomplete="off" aria-label="SKU"><input name="qty" type="number" min="1" step="1" value="${esc(r.qty || '')}" placeholder="Qty" aria-label="Quantity">${price ? `<input name="price" type="number" min="0" step="0.01" value="${esc(r.price || '')}" placeholder="Price" aria-label="Unit price">` : ''}<button type="button" class="x" data-act="rmLine" aria-label="Remove line">×</button></div>`;
  function readLines(form, priceFn) {
    const out = {};
    $$('.lrow', form).forEach(r => {
      const sku = $('[name=sku]', r).value.trim(), q = +$('[name=qty]', r).value, pe = $('[name=price]', r);
      if (!sku && !q) return;
      const p = IX.sku[sku.toLowerCase()] || db.products.find(x => x.name.toLowerCase() === sku.toLowerCase());
      if (!p) throw new Error('Unknown product: ' + sku);
      if (!(q >= 1) || q !== Math.floor(q)) throw new Error('Enter a whole quantity for ' + p.sku);
      const pr = pe && pe.value !== '' ? +pe.value : priceFn(p);
      if (out[p.id]) out[p.id].qty += q; else out[p.id] = { pid: p.id, qty: q, price: r2(pr) };
    });
    const l = Object.values(out); if (!l.length) throw new Error('Add at least one line');
    return l;
  }
  function linesTable(lines, country, o) {
    o = o || {}; const f = o.f || eur, t = tot(lines, country);
    return `<div class="tablewrap"><table><thead><tr><th>SKU</th><th>Product</th><th class="r">Qty</th><th class="r">${o.cost ? 'Cost' : 'Price'}</th><th class="r">Net</th>${o.recv ? '<th class="r">Received</th>' : ''}</tr></thead><tbody>` +
      lines.map(l => { const p = IX.p[l.pid]; return `<tr><td>${link('#/products/' + l.pid, p.sku)}</td><td>${esc(p.name)}</td><td class="r">${l.qty}</td><td class="r">${f(l.price != null ? l.price : l.cost)}</td><td class="r">${f(r2(l.qty * (l.price != null ? l.price : l.cost)))}</td>${o.recv ? `<td class="r">${l.recv || 0}</td>` : ''}</tr>`; }).join('') +
      (o.noTotals ? '' : `<tr class="tot"><td colspan="4" class="r">Net</td><td class="r">${f(t.net)}</td>${o.recv ? '<td></td>' : ''}</tr><tr class="tot"><td colspan="4" class="r">VAT ${VAT[country] || 0}%</td><td class="r">${f(t.vat)}</td>${o.recv ? '<td></td>' : ''}</tr><tr class="tot"><td colspan="4" class="r">Total</td><td class="r">${f(t.total)}</td>${o.recv ? '<td></td>' : ''}</tr>`) + '</tbody></table></div>';
  }
  function detail(o) {
    return `<a class="back" href="${o.back}">&larr; ${esc(o.backLabel)}</a><div class="detailh"><h1>${esc(o.title)}</h1>${o.badge || ''}<span class="sp"></span><div class="actions">${o.actions || ''}</div></div>` +
      `<div class="card"><div class="meta">${o.meta.map(([a, b]) => dl(a, b)).join('')}</div></div>${o.body}`;
  }

  /* ---------- sales order lifecycle ---------- */
  function newSO(o) {
    const cu = IX.c[o.custId]; if (!cu) throw new Error('Choose a customer');
    const l = IX.loc[o.loc] || LOC[0], so = { id: nextId(), no: docNo('SO'), date: TODAY, custId: cu.id, loc: l.id, channel: o.channel || 'b2b', status: 'draft', country: o.channel === 'store' ? l.country : cu.country, lines: o.lines };
    if (o.source) so.source = o.source; if (o.note) so.note = o.note; if (o.quoteId) so.quoteId = o.quoteId;
    db.sos.push(so); return so;
  }
  function needAvail(lines, l, own) { lines.forEach(x => { const have = own ? onHand(x.pid, l) : avail(x.pid, l); if (have < x.qty) throw new Error(`Not enough stock for ${IX.p[x.pid].sku} at ${locName(l)}: ${have} available, ${x.qty} needed`); }); }
  function doConfirmSO(id) { const so = IX.so[id]; if (so.status !== 'draft') return; needAvail(so.lines, so.loc); so.status = 'confirmed'; commit(`${so.no} confirmed, stock reserved`); }
  function doShipSO(id) { const so = IX.so[id]; if (so.status !== 'confirmed') return; needAvail(so.lines, so.loc, true); so.lines.forEach(x => changeStock(x.pid, so.loc, -x.qty, 'sale', so.no)); so.status = 'shipped'; so.shippedAt = TODAY; commit(`${so.no} shipped`); }
  function makeInvoice(so) {
    const cu = IX.c[so.custId], t = soTot(so);
    return { id: nextId(), no: docNo('INV'), date: TODAY, due: U.add(TODAY, cu.terms || 0), soId: so.id, custId: so.custId, loc: so.loc, country: so.country, lines: so.lines.map(l => ({ pid: l.pid, qty: l.qty, price: l.price })), net: t.net, vat: t.vat, total: t.total, payments: [] };
  }
  function doInvoiceSO(id) { const so = IX.so[id]; if (so.status !== 'shipped') return; const inv = makeInvoice(so); db.invoices.push(inv); so.invoiceId = inv.id; so.status = 'invoiced'; commit(`Invoice ${inv.no} created`); location.hash = '#/invoices/' + inv.id; }
  function doCancelSO(id) { const so = IX.so[id]; if (!['draft', 'confirmed'].includes(so.status)) return; if (!confirm(`Cancel ${so.no}?`)) return; so.status = 'cancelled'; commit(`${so.no} cancelled`); }
  function doPayment(id, amount, method) {
    const inv = IX.inv[id], b = balance(inv);
    if (!(amount > 0)) throw new Error('Enter an amount'); if (amount > b + 0.005) throw new Error('Amount is more than the open balance (' + eur(b) + ')');
    inv.payments.push({ date: TODAY, amount: r2(amount), method }); commit(`Payment of ${eur(amount)} recorded`);
  }
  function returnable(inv) {
    const used = {}; db.creditNotes.filter(c => c.invoiceId === inv.id).forEach(c => c.lines.forEach(l => { used[l.pid] = (used[l.pid] || 0) + l.qty; }));
    return inv.lines.map(l => ({ pid: l.pid, price: l.price, max: l.qty - (used[l.pid] || 0), qty: l.qty })).filter(l => l.max > 0);
  }
  function doReturn(invId, qtys, restock, reason) {
    const inv = IX.inv[invId], rem = returnable(inv), lines = [];
    rem.forEach(l => { const q = Math.min(l.max, Math.max(0, +qtys[l.pid] || 0)); if (q > 0) lines.push({ pid: l.pid, qty: q, price: l.price }); });
    if (!lines.length) throw new Error('Choose at least one item to return');
    const t = tot(lines, inv.country), cn = { id: nextId(), no: docNo('CN'), date: TODAY, invoiceId: inv.id, custId: inv.custId, loc: inv.loc, country: inv.country, reason: reason || 'Customer return', lines, net: t.net, vat: t.vat, total: t.total, restock: !!restock };
    if (restock) lines.forEach(l => changeStock(l.pid, inv.loc, l.qty, 'return', cn.no));
    db.creditNotes.push(cn); IX.cn[cn.id] = cn;
    const refund = Math.min(cn.total, Math.max(0, paidAmt(inv) - (inv.total - credited(inv))));
    if (refund > 0.004) inv.payments.push({ date: TODAY, amount: -r2(refund), method: 'refund' });
    commit(`Credit note ${cn.no} created`); return cn;
  }
  function doPosSale() {
    const s = posS; if (!s.cart.length) throw new Error('The cart is empty');
    const l = IX.loc[s.loc]; needAvail(s.cart, s.loc);
    const cust = s.cust ? IX.c[s.cust] : db.customers.find(c => c.type === 'walkin' && c.country === l.country) || db.customers[0];
    const lines = s.cart.map(c => ({ pid: c.pid, qty: c.qty, price: IX.p[c.pid].price }));
    const so = { id: nextId(), no: docNo('SO'), date: TODAY, custId: cust.id, loc: s.loc, channel: 'store', status: 'invoiced', country: l.country, lines };
    lines.forEach(x => changeStock(x.pid, s.loc, -x.qty, 'sale', so.no));
    const inv = makeInvoice(so); inv.due = TODAY; inv.payments.push({ date: TODAY, amount: inv.total, method: s.method });
    so.invoiceId = inv.id; db.sos.push(so); db.invoices.push(inv); s.cart = [];
    commit(`Sale ${so.no} completed`); location.hash = '#/pos/receipt/' + so.id;
  }

  /* ---------- purchasing, transfers, counts, quotes ---------- */
  function supplierPrice(sid, pid) { const o = (db.supplierPrices[sid] || {})[pid]; return o ? o.price : IX.p[pid].cost; }
  function bestSupplier(pid) {
    let best = null;
    db.suppliers.forEach(s => { const o = (db.supplierPrices[s.id] || {})[pid]; if (!o) return; const e = o.cur === 'USD' ? o.price * USD_EUR : o.price; if (!best || e < best.eur) best = { sid: s.id, price: o.price, cur: o.cur, eur: e }; });
    return best;
  }
  function suggestions() {
    const rows = [];
    db.products.forEach(p => {
      const m = mm(p.id, 'WH'); if (!m) return;
      const pos = onHand(p.id, 'WH') + openPOQty(p.id) - reserved(p.id, 'WH');
      if (pos < m.min) { const b = bestSupplier(p.id); if (b) rows.push({ pid: p.id, sid: b.sid, price: b.price, cur: b.cur, qty: Math.max(1, m.max - pos), pos, min: m.min }); }
    });
    return rows;
  }
  function createPO(sid, lines) {
    const po = { id: nextId(), no: docNo('PO'), date: TODAY, supplierId: sid, status: 'draft', cur: supCur(sid), lines: lines.map(l => ({ pid: l.pid, qty: l.qty, cost: l.cost != null ? l.cost : l.price, recv: 0 })) };
    db.pos.push(po); return po;
  }
  const poTotal = po => r2(po.lines.reduce((a, l) => a + l.qty * l.cost, 0));
  function doOrderPO(id) { const po = IX.po[id]; if (po.status !== 'draft') return; po.status = 'ordered'; po.orderedAt = TODAY; commit(`${po.no} sent to supplier`); }
  function doReceivePO(id, qtys) {
    const po = IX.po[id]; let any = false;
    po.lines.forEach((l, i) => { const q = Math.min(l.qty - (l.recv || 0), Math.max(0, +qtys[i] || 0)); if (q > 0) { changeStock(l.pid, 'WH', q, 'receipt', po.no); l.recv = (l.recv || 0) + q; any = true; } });
    if (!any) throw new Error('Enter a quantity to receive');
    po.status = po.lines.every(l => l.recv >= l.qty) ? 'received' : 'partial'; commit(`Goods received on ${po.no}`);
  }
  function replenishmentPlan() {
    if (cache.plan) return cache.plan;
    const rows = [];
    db.products.forEach(p => {
      let wh = avail(p.id, 'WH') - ((mm(p.id, 'WH') || {}).min || 0);
      LOC.filter(l => l.id !== 'WH').forEach(l => {
        const m = mm(p.id, l.id); if (!m) return;
        const oh = onHand(p.id, l.id), inc = incoming(p.id, l.id), pos = oh + inc;
        if (pos < m.min) { const need = m.max - pos, q = Math.min(need, Math.max(0, wh)); wh -= q; rows.push({ pid: p.id, to: l.id, oh, inc, min: m.min, max: m.max, need, qty: q, short: need - q }); }
      });
    });
    return (cache.plan = rows);
  }
  function doTransferFromPlan() {
    const by = {}; replenishmentPlan().forEach(r => { if (r.qty > 0) (by[r.to] = by[r.to] || []).push({ pid: r.pid, qty: r.qty }); });
    const ks = Object.keys(by); if (!ks.length) throw new Error('Nothing to replenish');
    ks.forEach(to => db.transfers.push({ id: nextId(), no: docNo('TR'), date: TODAY, from: 'WH', to, status: 'draft', lines: by[to] }));
    commit(`${ks.length} draft transfer${ks.length > 1 ? 's' : ''} created`); location.hash = '#/transfers';
  }
  function doShipTransfer(id) { const t = IX.tr[id]; if (t.status !== 'draft') return; needAvail(t.lines, t.from); t.lines.forEach(l => changeStock(l.pid, t.from, -l.qty, 'transfer_out', t.no)); t.status = 'shipped'; t.shippedAt = TODAY; commit(`${t.no} shipped, now in transit`); }
  function doReceiveTransfer(id) { const t = IX.tr[id]; if (t.status !== 'shipped') return; t.lines.forEach(l => changeStock(l.pid, t.to, l.qty, 'transfer_in', t.no)); t.status = 'received'; t.receivedAt = TODAY; commit(`${t.no} received`); }
  function doPostCount(id) {
    const c = IX.cnt[id]; let n = 0;
    c.lines.forEach(l => { if (l.counted == null) return; const d = l.counted - onHand(l.pid, c.loc); if (d) { changeStock(l.pid, c.loc, d, 'count', c.no); n++; } });
    c.status = 'posted'; c.postedAt = TODAY; commit(`${c.no} posted, ${n} adjustment${n === 1 ? '' : 's'}`);
  }
  const quoteStatus = q => (q.status === 'sent' && q.valid < TODAY) ? 'expired' : q.status;
  function doConvertQuote(id) {
    const q = IX.q[id], so = newSO({ custId: q.custId, loc: 'WH', channel: 'b2b', lines: q.lines.map(l => ({ pid: l.pid, qty: l.qty, price: l.price })), quoteId: q.id });
    q.status = 'converted'; q.soId = so.id; commit(`Sales order ${so.no} created`); location.hash = '#/sales/' + so.id;
  }

  /* ---------- derived reports ---------- */
  function monthly() {
    if (cache.mon) return cache.mon;
    const ms = []; let y = +TODAY.slice(0, 4), m = +TODAY.slice(5, 7);
    for (let i = 0; i < 12; i++) { ms.unshift(y + '-' + String(m).padStart(2, '0')); if (--m < 1) { m = 12; y--; } }
    const o = {}; ms.forEach(k => { o[k] = { m: k, revenue: 0, cost: 0 }; });
    const add = (d, lines, net, sign) => { const r = o[d.slice(0, 7)]; if (!r) return; r.revenue += sign * net; lines.forEach(l => { r.cost += sign * l.qty * IX.p[l.pid].cost; }); };
    db.invoices.forEach(v => add(v.date, v.lines, v.net, 1)); db.creditNotes.forEach(c => add(c.date, c.lines, c.net, -1));
    return (cache.mon = ms.map(k => ({ m: k, revenue: r2(o[k].revenue), cost: r2(o[k].cost) })));
  }
  function kpis() {
    if (cache.k) return cache.k;
    const k = { rev30: 0, recv: 0, overdue: 0, stockValue: 0, low: 0, openPO: 0, openSO: 0, age: [0, 0, 0, 0, 0], byLoc: {} }, from = U.add(TODAY, -30);
    db.invoices.forEach(v => {
      if (v.date >= from) k.rev30 += v.net; const b = balance(v);
      if (b > 0.005) { k.recv += b; const d = U.diff(TODAY, v.due); if (d > 0) k.overdue += b; k.age[d <= 0 ? 0 : d <= 30 ? 1 : d <= 60 ? 2 : d <= 90 ? 3 : 4] += b; }
    });
    db.creditNotes.forEach(c => { if (c.date >= from) k.rev30 -= c.net; });
    db.products.forEach(p => { Object.entries(db.stock[p.id] || {}).forEach(([l, q]) => { k.stockValue += q * p.cost; k.byLoc[l] = (k.byLoc[l] || 0) + q * p.cost; }); });
    k.low = lowRows().length; k.openPO = db.pos.filter(p => ['ordered', 'partial'].includes(p.status)).length; k.openSO = db.sos.filter(s => ['draft', 'confirmed', 'shipped'].includes(s.status)).length;
    return (cache.k = k);
  }
  function lowRows() {
    if (cache.low) return cache.low;
    const rows = [];
    db.products.forEach(p => LOC.forEach(l => { const m = mm(p.id, l.id), oh = onHand(p.id, l.id); if (m && m.min > 0 && oh < m.min) rows.push({ pid: p.id, loc: l.id, oh, min: m.min, ratio: oh / m.min }); }));
    return (cache.low = rows.sort((a, b) => a.ratio - b.ratio));
  }
  function balMap() { if (cache.bal) return cache.bal; const m = {}; db.invoices.forEach(v => { const b = balance(v); if (b > 0.005) m[v.custId] = (m[v.custId] || 0) + b; }); return (cache.bal = m); }

  /* ---------- charts ---------- */
  function barChart(labels, series, fmt) {
    const W = 640, H = 230, pl = 52, pb = 26, pt = 10, pr = 8, max = Math.max(1, ...series.flatMap(s => s.vals));
    const mag = Math.pow(10, Math.floor(Math.log10(max))), nice = [1, 2, 4, 8, 10].map(x => x * mag).find(x => x >= max);
    const bw = (W - pl - pr) / labels.length, gw = bw * 0.72, sw = gw / series.length, short = v => v >= 1000 ? Math.round(v / 1000) + 'k' : Math.round(v);
    let g = '';
    for (let i = 0; i <= 4; i++) { const y = pt + (H - pt - pb) * (1 - i / 4); g += `<line class="grid" x1="${pl}" x2="${W - pr}" y1="${y}" y2="${y}"/><text class="ax" x="${pl - 6}" y="${y + 4}" text-anchor="end">${short(nice * i / 4)}</text>`; }
    labels.forEach((l, i) => {
      series.forEach((s, j) => { const h = (H - pt - pb) * s.vals[i] / nice, x = pl + i * bw + (bw - gw) / 2 + j * sw; g += `<rect class="b${j}" x="${x.toFixed(1)}" y="${(H - pb - h).toFixed(1)}" width="${(sw - 2).toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" rx="2"><title>${esc(l)} ${esc(s.name)}: ${esc(fmt(s.vals[i]))}</title></rect>`; });
      g += `<text class="ax" x="${(pl + i * bw + bw / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle">${esc(l.slice(2))}</text>`;
    });
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(series.map(s => s.name).join(' vs '))} by month">${g}</svg><div class="legend">${series.map((s, j) => `<span><i style="background:var(--c${j + 1})"></i>${esc(s.name)}</span>`).join('')}</div>`;
  }
  const hbars = (rows, fmt) => { const max = Math.max(1, ...rows.map(r => r[1])); return rows.map(([n, v]) => `<div class="hbar"><span>${esc(n)}</span><div class="t"><i style="width:${(v / max * 100).toFixed(1)}%"></i></div><span class="r">${fmt(v)}</span></div>`).join(''); };

  /* ---------- pages ---------- */
  function pageOverview() {
    const k = kpis(), ms = monthly();
    const chart = ui.ovTable
      ? `<div class="tablewrap"><table><thead><tr><th>Month</th><th class="r">Revenue</th><th class="r">Cost</th><th class="r">Margin</th></tr></thead><tbody>${ms.map(m => `<tr><td>${m.m}</td><td class="r">${eur(m.revenue)}</td><td class="r">${eur(m.cost)}</td><td class="r">${eur(m.revenue - m.cost)}</td></tr>`).join('')}</tbody></table></div>`
      : barChart(ms.map(m => m.m), [{ name: 'Revenue (net)', vals: ms.map(m => m.revenue) }, { name: 'Cost of goods', vals: ms.map(m => m.cost) }], eur);
    const low = lowRows().slice(0, 8);
    const docs = [].concat(
      db.sos.slice(-8).map(x => ({ d: x.date, id: x.id, t: 'Sales order', no: x.no, h: '#/sales/' + x.id, who: cName(x.custId), amt: soTot(x).total })),
      db.invoices.slice(-8).map(x => ({ d: x.date, id: x.id, t: 'Invoice', no: x.no, h: '#/invoices/' + x.id, who: cName(x.custId), amt: x.total })),
      db.pos.slice(-5).map(x => ({ d: x.date, id: x.id, t: 'Purchase order', no: x.no, h: '#/purchasing/' + x.id, who: (IX.s[x.supplierId] || {}).name, amt: poTotal(x), cur: x.cur })),
      db.transfers.slice(-5).map(x => ({ d: x.date, id: x.id, t: 'Transfer', no: x.no, h: '#/transfers/' + x.id, who: locName(x.to), amt: null }))
    ).sort((a, b) => a.d < b.d ? 1 : a.d > b.d ? -1 : b.id - a.id).slice(0, 9);
    return `<h1>Overview</h1><div class="kpis">${kpi('Revenue, last 30 days', eur(k.rev30), 'net of credit notes')}${kpi('Open receivables', eur(k.recv), `<a href="#/invoices">${eur(k.overdue)} overdue</a>`)}${kpi('Stock value (cost)', eur(k.stockValue))}${kpi('Low stock lines', num(k.low), '<a href="#/replenishment">Replenishment</a>')}${kpi('Open purchase orders', k.openPO, '<a href="#/purchasing">Purchasing</a>')}${kpi('Open sales orders', k.openSO, '<a href="#/sales">Sales</a>')}</div>` +
      `<section class="card"><div class="cardh"><h2>Revenue vs cost, last 12 months</h2><button class="btn sm" data-act="ovTable">${ui.ovTable ? 'Show chart' : 'Show as table'}</button></div>${chart}</section>` +
      `<div class="grid2"><section class="card"><h2>Low stock</h2>${low.length ? `<div class="tablewrap"><table><thead><tr><th>Product</th><th>Location</th><th class="r">On hand</th><th class="r">Min</th></tr></thead><tbody>${low.map(r => `<tr><td>${link('#/products/' + r.pid, IX.p[r.pid].sku)} ${esc(IX.p[r.pid].name)}</td><td>${esc(locName(r.loc))}</td><td class="r">${r.oh}</td><td class="r">${r.min}</td></tr>`).join('')}</tbody></table></div>` : empty('Nothing below minimum')}</section>` +
      `<section class="card"><h2>Receivables ageing</h2>${hbars([['Not due', k.age[0]], ['1-30 days', k.age[1]], ['31-60 days', k.age[2]], ['61-90 days', k.age[3]], ['Over 90 days', k.age[4]]], eur)}</section></div><div style="height:14px"></div>` +
      `<div class="grid2"><section class="card"><h2>Stock value by location</h2>${hbars(LOC.map(l => [l.name, k.byLoc[l.id] || 0]), eur)}</section>` +
      `<section class="card"><h2>Recent documents</h2><div class="tablewrap"><table><tbody>${docs.map(x => `<tr><td class="nowrap">${x.d}</td><td>${esc(x.t)}</td><td>${link(x.h, x.no)}</td><td>${esc(x.who || '')}</td><td class="r">${x.amt == null ? '' : money(x.amt, x.cur)}</td></tr>`).join('')}</tbody></table></div></section></div>`;
  }
  function pageProducts() {
    return `<h1>Products</h1>` + listHtml('p', {
      rows: () => db.products, search: p => `${p.sku} ${p.name} ${catName(p.cat)}`, order: (a, b) => a.id - b.id,
      filters: [{ name: 'cat', label: 'Category', opts: CATS.map(c => [c.id, c.name]), test: (p, v) => p.cat === v }, { name: 'low', label: 'Stock', opts: [['low', 'Below minimum'], ['out', 'Out of stock (all)']], test: (p, v) => v === 'low' ? isLow(p.id) : onHand(p.id) === 0 }],
      cols: [{ h: 'SKU', f: p => link('#/products/' + p.id, p.sku), sort: p => p.sku }, { h: 'Name', f: p => esc(p.name), sort: p => p.name }, { h: 'Category', f: p => esc(catName(p.cat)), sort: p => p.cat },
        { h: 'Price', f: p => eur(p.price), cls: 'r', sort: p => p.price }, { h: 'Cost', f: p => eur(p.cost), cls: 'r', sort: p => p.cost }, { h: 'On hand', f: p => num(onHand(p.id)), cls: 'r', sort: p => onHand(p.id) },
        { h: 'Reserved', f: p => num(reserved(p.id)), cls: 'r', sort: p => reserved(p.id) }, { h: 'Status', f: p => isLow(p.id) ? badge('low') : badge('ok') }]
    });
  }
  function openProductDrawer(id) {
    const p = IX.p[id]; if (!p) { closeDrawerSlot(); return; }
    const hist = (db.priceHistory[id] || []).slice().reverse(), sp = db.suppliers.filter(s => (db.supplierPrices[s.id] || {})[id]);
    const mv = db.movements.filter(m => m.pid === id).slice(-8).reverse();
    drawer(p.sku, `<h3 style="margin-top:0">${esc(p.name)}</h3><div class="meta">${dl('Category', esc(catName(p.cat)))}${dl('Supplier', link('#/suppliers/' + p.supplierId, (IX.s[p.supplierId] || {}).name))}${dl('List price (net)', eur(p.price))}${dl('Cost', eur(p.cost))}${dl('Margin', Math.round((p.price - p.cost) / p.price * 100) + '%')}${dl('Total on hand', num(onHand(id)))}</div><div class="actions"><button class="btn sm" data-act="editProd" data-id="${id}">Edit prices</button></div>` +
      `<h3>Stock by location</h3><div class="tablewrap"><table><thead><tr><th>Location</th><th class="r">On hand</th><th class="r">Reserved</th><th class="r">Incoming</th><th class="r">Min</th><th class="r">Max</th></tr></thead><tbody>${LOC.map(l => { const m = mm(id, l.id) || { min: 0, max: 0 }; return `<tr><td>${esc(l.name)}</td><td class="r">${onHand(id, l.id)}</td><td class="r">${reserved(id, l.id)}</td><td class="r">${incoming(id, l.id)}</td>` + ['min', 'max'].map(f => `<td class="r"><input type="number" min="0" class="cnt-in" data-chg="mm" data-pid="${id}" data-loc="${l.id}" data-f="${f}" value="${m[f]}" aria-label="${f} at ${esc(l.name)}"></td>`).join('') + '</tr>'; }).join('')}</tbody></table></div>` +
      `<h3>Supplier prices</h3>${sp.length ? `<div class="tablewrap"><table><tbody>${sp.map(s => { const o = db.supplierPrices[s.id][id]; return `<tr><td>${link('#/suppliers/' + s.id, s.name)}</td><td class="r">${money(o.price, o.cur)}</td><td class="r muted">${o.cur === 'USD' ? eur(o.price * USD_EUR) : ''}</td></tr>`; }).join('')}</tbody></table></div>` : empty('No supplier prices')}` +
      `<h3>Price history</h3><div class="tablewrap"><table><thead><tr><th>Since</th><th class="r">Price</th><th class="r">Cost</th></tr></thead><tbody>${hist.map(h => `<tr><td>${h.date}</td><td class="r">${eur(h.price)}</td><td class="r">${eur(h.cost)}</td></tr>`).join('')}</tbody></table></div>` +
      `<h3>Recent movements</h3><div class="tablewrap"><table><tbody>${mv.map(m => `<tr><td>${m.date}</td><td>${esc(locName(m.loc))}</td><td class="r">${m.qty > 0 ? '+' : ''}${m.qty}</td><td>${esc(m.type)}</td><td>${esc(m.ref)}</td></tr>`).join('')}</tbody></table></div>`);
  }
  function pageReplenishment() {
    const rows = replenishmentPlan(), n = rows.filter(r => r.qty > 0).length;
    return `<h1>Replenishment</h1><p class="muted">Min/max plan for stores and the e-shop. Quantities are limited by what the warehouse can spare above its own minimum; stock already in transit is counted.</p>` + listHtml('rp', {
      rows: () => replenishmentPlan(), search: r => `${IX.p[r.pid].sku} ${IX.p[r.pid].name} ${locName(r.to)}`, order: (a, b) => a.to < b.to ? -1 : a.to > b.to ? 1 : a.pid - b.pid,
      extra: `<button class="btn pri sm" data-act="trFromPlan"${n ? '' : ' disabled'}>Create ${n} transfer line${n === 1 ? '' : 's'}</button>`,
      filters: [{ name: 'loc', label: 'Location', opts: LOC.filter(l => l.id !== 'WH').map(l => [l.id, l.name]), test: (r, v) => r.to === v }, { name: 'short', label: 'Warehouse', opts: [['short', 'Short at warehouse']], test: r => r.short > 0 }],
      cols: [{ h: 'Product', f: r => link('#/products/' + r.pid, IX.p[r.pid].sku) + ' ' + esc(IX.p[r.pid].name), sort: r => IX.p[r.pid].sku }, { h: 'To', f: r => esc(locName(r.to)), sort: r => r.to }, { h: 'On hand', f: r => r.oh, cls: 'r', sort: r => r.oh }, { h: 'Incoming', f: r => r.inc, cls: 'r' },
        { h: 'Min', f: r => r.min, cls: 'r' }, { h: 'Max', f: r => r.max, cls: 'r' }, { h: 'Suggested', f: r => `<b>${r.qty}</b>`, cls: 'r', sort: r => r.qty }, { h: 'Short', f: r => r.short ? badge('short') + ' ' + r.short : '', cls: 'r' }]
    });
  }
  function pageTransfers() {
    return `<h1>Transfers</h1>` + listHtml('tr', {
      rows: () => db.transfers, search: t => `${t.no} ${locName(t.from)} ${locName(t.to)} ${t.status}`, order: (a, b) => b.id - a.id,
      extra: '<button class="btn pri sm" data-act="newTr">New transfer</button>',
      filters: [{ name: 'st', label: 'Status', opts: [['draft', 'Draft'], ['shipped', 'In transit'], ['received', 'Received']], test: (t, v) => t.status === v }],
      cols: [{ h: 'No.', f: t => link('#/transfers/' + t.id, t.no), sort: t => t.no }, { h: 'Date', f: t => t.date, sort: t => t.date }, { h: 'From', f: t => esc(locName(t.from)) }, { h: 'To', f: t => esc(locName(t.to)), sort: t => t.to }, { h: 'Lines', f: t => t.lines.length, cls: 'r' }, { h: 'Units', f: t => t.lines.reduce((a, l) => a + l.qty, 0), cls: 'r' }, { h: 'Status', f: t => badge(t.status), sort: t => t.status }]
    });
  }
  function pageTransfer(id) {
    const t = IX.tr[id]; if (!t) return notFound('Transfer', '#/transfers');
    const stage = ['draft', 'shipped', 'received'].map(s => `<span class="badge${s === t.status ? ' s-' + s : ''}">${s === 'shipped' ? 'in transit' : s}</span>`).join(' → ');
    return detail({
      back: '#/transfers', backLabel: 'Transfers', title: t.no, badge: badge(t.status),
      actions: (t.status === 'draft' ? `<button class="btn pri" data-act="trShip" data-id="${id}">Ship</button><button class="btn danger" data-act="trDel" data-id="${id}">Delete</button>` : '') + (t.status === 'shipped' ? `<button class="btn pri" data-act="trReceive" data-id="${id}">Receive</button>` : ''),
      meta: [['From', esc(locName(t.from))], ['To', esc(locName(t.to))], ['Created', t.date], ['Shipped', t.shippedAt || '-'], ['Received', t.receivedAt || '-'], ['Stage', stage]],
      body: `<div class="tablewrap"><table><thead><tr><th>SKU</th><th>Product</th><th class="r">Qty</th><th class="r">Available at ${esc(locName(t.from))}</th></tr></thead><tbody>${t.lines.map(l => `<tr><td>${link('#/products/' + l.pid, IX.p[l.pid].sku)}</td><td>${esc(IX.p[l.pid].name)}</td><td class="r">${l.qty}</td><td class="r">${t.status === 'draft' ? avail(l.pid, t.from) : ''}</td></tr>`).join('')}</tbody></table></div>`
    });
  }
  function pageCounts() {
    return `<h1>Stock counts</h1>` + listHtml('cnt', {
      rows: () => db.counts, search: c => `${c.no} ${locName(c.loc)}`, order: (a, b) => b.id - a.id, extra: '<button class="btn pri sm" data-act="newCount">New count</button>',
      cols: [{ h: 'No.', f: c => link('#/counts/' + c.id, c.no), sort: c => c.no }, { h: 'Date', f: c => c.date, sort: c => c.date }, { h: 'Location', f: c => esc(locName(c.loc)) }, { h: 'Scope', f: c => esc(c.scope || 'All') }, { h: 'Lines', f: c => c.lines.length, cls: 'r' }, { h: 'Status', f: c => badge(c.status) }]
    });
  }
  function pageCount(id) {
    const c = IX.cnt[id]; if (!c) return notFound('Count', '#/counts');
    const open = c.status === 'open', diffs = c.lines.filter(l => l.counted != null && l.counted !== l.expected).length;
    return detail({
      back: '#/counts', backLabel: 'Stock counts', title: c.no, badge: badge(c.status),
      actions: open ? `<button class="btn pri" data-act="cntPost" data-id="${id}">Post differences</button><button class="btn danger" data-act="cntDel" data-id="${id}">Delete</button>` : '',
      meta: [['Location', esc(locName(c.loc))], ['Scope', esc(c.scope || 'All')], ['Date', c.date], ['Lines counted', `<span id="cntDone">${c.lines.filter(l => l.counted != null).length}</span> / ${c.lines.length}`], ['Differences', `<span id="cntDiff">${diffs}</span>`]],
      body: `<div class="tablewrap"><table><thead><tr><th>SKU</th><th>Product</th><th class="r">Expected</th><th class="r">Counted</th><th class="r">Difference</th></tr></thead><tbody>${c.lines.map((l, i) => `<tr><td>${link('#/products/' + l.pid, IX.p[l.pid].sku)}</td><td>${esc(IX.p[l.pid].name)}</td><td class="r">${l.expected}</td><td class="r">${open ? `<input class="cnt-in" type="number" min="0" data-chg="cntq" data-id="${id}" data-i="${i}" value="${l.counted == null ? '' : l.counted}" aria-label="Counted ${esc(IX.p[l.pid].sku)}">` : (l.counted == null ? '' : l.counted)}</td><td class="r" id="cd-${i}">${l.counted == null ? '' : l.counted - l.expected}</td></tr>`).join('')}</tbody></table></div>`
    });
  }
  function pageMovements() {
    const types = [...new Set(db.movements.map(m => m.type))].sort();
    return `<h1>Stock movements</h1><p class="muted">Every stock change is recorded here.</p>` + listHtml('m', {
      rows: () => db.movements, search: m => `${IX.p[m.pid].sku} ${IX.p[m.pid].name} ${m.ref} ${m.type}`, order: (a, b) => b.id - a.id,
      filters: [{ name: 'type', label: 'Type', opts: types.map(t => [t, t]), test: (m, v) => m.type === v }, { name: 'loc', label: 'Location', opts: LOC.map(l => [l.id, l.name]), test: (m, v) => m.loc === v }],
      cols: [{ h: 'Date', f: m => m.date, sort: m => m.id }, { h: 'SKU', f: m => link('#/products/' + m.pid, IX.p[m.pid].sku), sort: m => IX.p[m.pid].sku }, { h: 'Product', f: m => esc(IX.p[m.pid].name) }, { h: 'Location', f: m => esc(locName(m.loc)), sort: m => m.loc }, { h: 'Qty', f: m => (m.qty > 0 ? '+' : '') + m.qty, cls: 'r', sort: m => m.qty }, { h: 'Type', f: m => esc(m.type), sort: m => m.type }, { h: 'Reference', f: m => esc(m.ref) }]
    });
  }
  function pagePurchasing() {
    return `<h1>Purchasing</h1>` + listHtml('po', {
      rows: () => db.pos, search: p => `${p.no} ${(IX.s[p.supplierId] || {}).name} ${p.status}`, order: (a, b) => b.id - a.id,
      extra: '<a class="btn sm" href="#/purchasing/suggest">Reorder suggestions</a><button class="btn pri sm" data-act="newPO">New PO</button>',
      filters: [{ name: 'st', label: 'Status', opts: ['draft', 'ordered', 'partial', 'received'].map(s => [s, s]), test: (p, v) => p.status === v }, { name: 'sup', label: 'Supplier', opts: db.suppliers.map(s => [s.id, s.name]), test: (p, v) => String(p.supplierId) === v }],
      cols: [{ h: 'No.', f: p => link('#/purchasing/' + p.id, p.no), sort: p => p.no }, { h: 'Date', f: p => p.date, sort: p => p.date }, { h: 'Supplier', f: p => esc((IX.s[p.supplierId] || {}).name), sort: p => p.supplierId }, { h: 'Lines', f: p => p.lines.length, cls: 'r' }, { h: 'Total', f: p => money(poTotal(p), p.cur), cls: 'r', sort: p => poTotal(p) }, { h: 'Status', f: p => badge(p.status), sort: p => p.status }]
    });
  }
  function pageSuggest() {
    const rows = suggestions(), by = {}; rows.forEach(r => (by[r.sid] = by[r.sid] || []).push(r));
    return `<a class="back" href="#/purchasing">&larr; Purchasing</a><h1>Reorder suggestions</h1><p class="muted">Warehouse stock plus open orders is below the minimum. Each product is offered at its cheapest supplier price (USD converted at ${USD_EUR}).</p>` +
      (Object.keys(by).length ? Object.keys(by).map(sid => { const s = IX.s[sid]; return `<section class="card"><div class="cardh"><h2>${link('#/suppliers/' + sid, s.name)}</h2><button class="btn pri sm" data-act="poFromSug" data-sid="${sid}">Create draft PO</button></div><div class="tablewrap"><table><thead><tr><th>Product</th><th class="r">Position</th><th class="r">Min</th><th class="r">Order</th><th class="r">Unit price</th></tr></thead><tbody>${by[sid].map(r => `<tr><td>${link('#/products/' + r.pid, IX.p[r.pid].sku)} ${esc(IX.p[r.pid].name)}</td><td class="r">${r.pos}</td><td class="r">${r.min}</td><td class="r">${r.qty}</td><td class="r">${money(r.price, r.cur)}</td></tr>`).join('')}</tbody></table></div></section>`; }).join('') : `<div class="card">${empty('No reorder suggestions right now')}</div>`);
  }
  function pagePO(id) {
    const po = IX.po[id]; if (!po) return notFound('Purchase order', '#/purchasing');
    const s = IX.s[po.supplierId] || {};
    return detail({
      back: '#/purchasing', backLabel: 'Purchasing', title: po.no, badge: badge(po.status),
      actions: (po.status === 'draft' ? `<button class="btn pri" data-act="poOrder" data-id="${id}">Order</button><button class="btn danger" data-act="poDel" data-id="${id}">Delete</button>` : '') + (['ordered', 'partial'].includes(po.status) ? `<button class="btn pri" data-act="poReceive" data-id="${id}">Receive goods</button>` : ''),
      meta: [['Supplier', link('#/suppliers/' + po.supplierId, s.name || '?')], ['Date', po.date], ['Currency', po.cur], ['Lead time', (s.leadDays || '-') + ' days'], ['Total', money(poTotal(po), po.cur)]],
      body: linesTable(po.lines, 'SI', { f: v => money(v, po.cur), cost: true, recv: true, noTotals: true }) + `<p class="right muted">Total ${money(poTotal(po), po.cur)} (excl. import VAT)</p>`
    });
  }
  function pageSuppliers() {
    return `<h1>Suppliers</h1>` + listHtml('s', {
      rows: () => db.suppliers, search: s => `${s.name} ${s.country}`, order: (a, b) => a.id - b.id,
      cols: [{ h: 'Name', f: s => link('#/suppliers/' + s.id, s.name), sort: s => s.name }, { h: 'Country', f: s => esc(s.country), sort: s => s.country }, { h: 'Currency', f: s => esc(s.currency) }, { h: 'Lead time', f: s => s.leadDays + ' d', cls: 'r', sort: s => s.leadDays }, { h: 'Products', f: s => Object.keys(db.supplierPrices[s.id] || {}).length, cls: 'r' }, { h: 'Open POs', f: s => db.pos.filter(p => p.supplierId === s.id && ['ordered', 'partial'].includes(p.status)).length, cls: 'r' }]
    });
  }
  function openSupplierDrawer(id) {
    const s = IX.s[id]; if (!s) { closeDrawerSlot(); return; }
    const prices = Object.entries(db.supplierPrices[id] || {}), pos = db.pos.filter(p => p.supplierId === s.id).slice(-6).reverse();
    drawer(s.name, `<div class="meta">${dl('Country', esc(s.country))}${dl('Currency', esc(s.currency))}${dl('Lead time', s.leadDays + ' days')}${dl('E-mail', esc(s.email))}</div><div class="actions"><button class="btn sm" data-act="newPO" data-sid="${id}">New PO</button></div>` +
      `<h3>Price list (${prices.length})</h3><div class="tablewrap"><table><thead><tr><th>Product</th><th class="r">Price</th></tr></thead><tbody>${prices.slice(0, 60).map(([pid, o]) => `<tr><td>${link('#/products/' + pid, IX.p[pid].sku)} ${esc(IX.p[pid].name)}</td><td class="r">${money(o.price, o.cur)}</td></tr>`).join('')}</tbody></table></div>` +
      `<h3>Recent purchase orders</h3><div class="tablewrap"><table><tbody>${pos.map(p => `<tr><td>${link('#/purchasing/' + p.id, p.no)}</td><td>${p.date}</td><td>${badge(p.status)}</td><td class="r">${money(poTotal(p), p.cur)}</td></tr>`).join('')}</tbody></table></div>`);
  }
  /* point of sale */
  function posCartHtml() {
    const l = IX.loc[posS.loc], lines = posS.cart.map(c => ({ pid: c.pid, qty: c.qty, price: IX.p[c.pid].price })), t = tot(lines, l.country);
    return (posS.cart.length ? `<div class="tablewrap"><table><tbody>${posS.cart.map((c, i) => `<tr><td>${esc(IX.p[c.pid].name)}<div class="muted small">${esc(IX.p[c.pid].sku)} · ${eur(IX.p[c.pid].price)}</div></td><td class="nowrap"><button class="btn sm" data-act="posInc" data-i="${i}" data-d="-1" aria-label="Less">-</button> ${c.qty} <button class="btn sm" data-act="posInc" data-i="${i}" data-d="1" aria-label="More">+</button></td><td class="r">${eur(r2(c.qty * IX.p[c.pid].price))}</td></tr>`).join('')}</tbody></table></div>` : empty('Cart is empty. Tap a product.')) +
      `<p>Net ${eur(t.net)} · VAT ${VAT[l.country]}% ${eur(t.vat)}<br><b style="font-size:18px">Total ${eur(t.total)}</b></p><label class="f">Payment<select data-chg="posMethod">${opts([['card', 'Card'], ['cash', 'Cash'], ['voucher', 'Voucher']], posS.method)}</select></label><div class="actions"><button class="btn pri" data-act="posPay"${posS.cart.length ? '' : ' disabled'}>Charge ${eur(t.total)}</button><button class="btn" data-act="posClear">Clear</button></div>`;
  }
  function posGridHtml() {
    const q = posS.q.trim().toLowerCase(), list = db.products.filter(p => !q || (p.sku + ' ' + p.name).toLowerCase().includes(q)).slice(0, 18);
    return list.map(p => `<button data-act="posAdd" data-id="${p.id}"${avail(p.id, posS.loc) < 1 ? ' disabled' : ''}><b>${esc(p.name)}</b><div class="muted small">${esc(p.sku)}</div>${eur(p.price)} · <span class="muted">${avail(p.id, posS.loc)} in stock</span></button>`).join('') || empty('No products match');
  }
  function pagePos() {
    return `<h1>Point of sale</h1><div class="toolbar"><label>Store <select data-chg="posLoc">${locOpts(posS.loc, l => l.type === 'store')}</select></label><label>Customer <select data-chg="posCust"><option value="">Walk-in</option>${custOpts(posS.cust, c => c.type === 'B2C')}</select></label><a class="btn sm" href="#/invoices">Past sales &amp; returns</a></div>` +
      `<div class="pos"><section class="card"><input type="search" data-inp="posq" value="${esc(posS.q)}" placeholder="Search SKU or name" aria-label="Search products" style="width:100%"><div class="pgrid" id="posGrid">${posGridHtml()}</div></section><section class="card"><h2>Cart</h2><div id="posCart">${posCartHtml()}</div></section></div>`;
  }
  function pageReceipt(id) {
    const so = IX.so[id]; if (!so) return notFound('Receipt', '#/pos'); const inv = IX.inv[so.invoiceId], t = soTot(so);
    return `<a class="back" href="#/pos">&larr; Point of sale</a><div class="card receipt"><h2>Adrial Optics</h2><div>${esc(locName(so.loc))}<br>${so.date} · ${esc(so.no)}<br>Invoice ${inv ? esc(inv.no) : '-'}</div><hr>` +
      so.lines.map(l => `<div>${l.qty} x ${esc(IX.p[l.pid].name)}<span style="float:right">${eur(r2(l.qty * l.price))}</span></div>`).join('') + `<hr><div>Net<span style="float:right">${eur(t.net)}</span></div><div>VAT ${VAT[so.country]}%<span style="float:right">${eur(t.vat)}</span></div><div><b>Total<span style="float:right">${eur(t.total)}</span></b></div>` +
      (inv ? `<div class="muted">Paid ${eur(paidAmt(inv))} (${esc((inv.payments[0] || {}).method || '')})</div>` : '') + `</div><div class="actions">${inv && returnable(inv).length ? `<button class="btn" data-act="retInv" data-id="${inv.id}">Return items</button>` : ''}<a class="btn pri" href="#/pos">New sale</a>${inv ? `<a class="btn" href="#/invoices/${inv.id}">Open invoice</a>` : ''}</div>`;
  }
  function pageQuotes() {
    return `<h1>Quotes</h1>` + listHtml('q', {
      rows: () => db.quotes, search: q => `${q.no} ${cName(q.custId)}`, order: (a, b) => b.id - a.id, extra: '<button class="btn pri sm" data-act="newQuote">New quote</button>',
      filters: [{ name: 'st', label: 'Status', opts: ['draft', 'sent', 'accepted', 'rejected', 'expired', 'converted'].map(s => [s, s]), test: (q, v) => quoteStatus(q) === v }],
      cols: [{ h: 'No.', f: q => link('#/quotes/' + q.id, q.no), sort: q => q.no }, { h: 'Date', f: q => q.date, sort: q => q.date }, { h: 'Valid until', f: q => q.valid }, { h: 'Customer', f: q => esc(cName(q.custId)), sort: q => cName(q.custId) }, { h: 'Total', f: q => eur(tot(q.lines, q.country).total), cls: 'r', sort: q => tot(q.lines, q.country).total }, { h: 'Status', f: q => badge(quoteStatus(q)) }]
    });
  }
  function pageQuote(id) {
    const q = IX.q[id]; if (!q) return notFound('Quote', '#/quotes'); const st = quoteStatus(q);
    return detail({
      back: '#/quotes', backLabel: 'Quotes', title: q.no, badge: badge(st),
      actions: (st === 'draft' ? `<button class="btn pri" data-act="qSend" data-id="${id}">Mark as sent</button>` : '') + (st === 'sent' ? `<button class="btn pri" data-act="qAccept" data-id="${id}">Customer accepted</button><button class="btn danger" data-act="qReject" data-id="${id}">Rejected</button>` : '') + (st === 'accepted' ? `<button class="btn pri" data-act="qConvert" data-id="${id}">Convert to sales order</button>` : ''),
      meta: [['Customer', link('#/customers/' + q.custId, cName(q.custId))], ['Date', q.date], ['Valid until', q.valid], ['Sales order', q.soId && IX.so[q.soId] ? link('#/sales/' + q.soId, IX.so[q.soId].no) : '-']], body: linesTable(q.lines, q.country)
    });
  }
  function pageSales() {
    return `<h1>Sales orders</h1>` + listHtml('so', {
      rows: () => db.sos, search: s => `${s.no} ${cName(s.custId)} ${s.status}`, order: (a, b) => b.id - a.id, extra: '<button class="btn pri sm" data-act="newSO">New order</button>',
      filters: [{ name: 'st', label: 'Status', opts: ['draft', 'confirmed', 'shipped', 'invoiced', 'cancelled'].map(s => [s, s]), test: (s, v) => s.status === v }, { name: 'ch', label: 'Channel', opts: [['b2b', 'B2B'], ['store', 'Store'], ['eshop', 'E-shop']], test: (s, v) => s.channel === v }, { name: 'src', label: 'Source', opts: [['crm', 'From CRM']], test: s => !!s.source }],
      cols: [{ h: 'No.', f: s => link('#/sales/' + s.id, s.no) + (s.source ? ' <span class="badge s-info">CRM</span>' : ''), sort: s => s.no }, { h: 'Date', f: s => s.date, sort: s => s.date }, { h: 'Customer', f: s => esc(cName(s.custId)), sort: s => cName(s.custId) }, { h: 'Location', f: s => esc(locName(s.loc)) }, { h: 'Channel', f: s => esc(s.channel) }, { h: 'Total', f: s => eur(soTot(s).total), cls: 'r', sort: s => soTot(s).total }, { h: 'Status', f: s => badge(s.status), sort: s => s.status }]
    });
  }
  function pageSO(id) {
    const so = IX.so[id]; if (!so) return notFound('Sales order', '#/sales'); const inv = so.invoiceId ? IX.inv[so.invoiceId] : null;
    const stock = so.status === 'draft' || so.status === 'confirmed' ? so.lines.filter(l => (so.status === 'draft' ? avail(l.pid, so.loc) : onHand(l.pid, so.loc)) < l.qty).map(l => IX.p[l.pid].sku) : [];
    return detail({
      back: '#/sales', backLabel: 'Sales orders', title: so.no, badge: badge(so.status),
      actions: (so.status === 'draft' ? `<button class="btn pri" data-act="soConfirm" data-id="${id}">Confirm</button>` : '') + (so.status === 'confirmed' ? `<button class="btn pri" data-act="soShip" data-id="${id}">Ship</button>` : '') + (so.status === 'shipped' ? `<button class="btn pri" data-act="soInvoice" data-id="${id}">Create invoice</button>` : '') + (['draft', 'confirmed'].includes(so.status) ? `<button class="btn danger" data-act="soCancel" data-id="${id}">Cancel</button>` : ''),
      meta: [['Customer', link('#/customers/' + so.custId, cName(so.custId))], ['Date', so.date], ['Ships from', esc(locName(so.loc))], ['Channel', esc(so.channel)], ['Invoice', inv ? link('#/invoices/' + inv.id, inv.no) : '-'], ...(so.source ? [['Source', `CRM deal ${esc(so.source.dealId || '')}`]] : []), ...(so.quoteId && IX.q[so.quoteId] ? [['Quote', link('#/quotes/' + so.quoteId, IX.q[so.quoteId].no)]] : [])],
      body: (stock.length ? `<p class="card s-short">Not enough stock for: ${esc(stock.join(', '))}</p>` : '') + (so.note ? `<p class="muted">${esc(so.note)}</p>` : '') + linesTable(so.lines, so.country)
    });
  }
  function pageCustomers() {
    return `<h1>Customers</h1>` + listHtml('c', {
      rows: () => db.customers, search: c => `${c.name} ${c.vatId} ${c.email} ${c.city}`, order: (a, b) => a.id - b.id, extra: '<button class="btn pri sm" data-act="newCust">New customer</button>',
      filters: [{ name: 'type', label: 'Type', opts: [['B2B', 'B2B'], ['B2C', 'B2C'], ['walkin', 'Walk-in']], test: (c, v) => c.type === v }, { name: 'bal', label: 'Balance', opts: [['open', 'Owes money']], test: c => (balMap()[c.id] || 0) > 0 }],
      cols: [{ h: 'Name', f: c => link('#/customers/' + c.id, c.name), sort: c => c.name }, { h: 'Type', f: c => esc(c.type), sort: c => c.type }, { h: 'Country', f: c => esc(c.country) }, { h: 'City', f: c => esc(c.city) }, { h: 'VAT ID', f: c => esc(c.vatId) }, { h: 'Open balance', f: c => balMap()[c.id] ? eur(balMap()[c.id]) : '', cls: 'r', sort: c => balMap()[c.id] || 0 }]
    });
  }
  function openCustomerDrawer(id) {
    const c = IX.c[id]; if (!c) { closeDrawerSlot(); return; }
    const sos = db.sos.filter(s => s.custId === c.id).slice(-6).reverse(), invs = db.invoices.filter(v => v.custId === c.id).slice(-6).reverse();
    drawer(c.name, `<div class="meta">${dl('Type', esc(c.type))}${dl('Country', esc(c.country))}${dl('City', esc(c.city || '-'))}${dl('VAT ID', esc(c.vatId || '-'))}${dl('E-mail', esc(c.email || '-'))}${dl('Payment terms', (c.terms || 0) + ' days')}${dl('Open balance', eur(balMap()[c.id] || 0))}</div>` +
      `<div class="actions"><button class="btn sm" data-act="editCust" data-id="${id}">Edit</button>${c.type !== 'walkin' ? `<button class="btn sm" data-act="newSO" data-cid="${id}">New order</button><button class="btn sm" data-act="newQuote" data-cid="${id}">New quote</button>` : ''}</div>` +
      `<h3>Recent orders</h3><div class="tablewrap"><table><tbody>${sos.map(s => `<tr><td>${link('#/sales/' + s.id, s.no)}</td><td>${s.date}</td><td>${badge(s.status)}</td><td class="r">${eur(soTot(s).total)}</td></tr>`).join('')}</tbody></table></div>` +
      `<h3>Recent invoices</h3><div class="tablewrap"><table><tbody>${invs.map(v => `<tr><td>${link('#/invoices/' + v.id, v.no)}</td><td>${v.date}</td><td>${badge(invStatus(v))}</td><td class="r">${eur(v.total)}</td></tr>`).join('')}</tbody></table></div>`);
  }
  const invTabs = cur => `<div class="tabs"><a href="#/invoices"${cur === 'inv' ? ' aria-current="page"' : ''}>Invoices</a><a href="#/invoices/cn"${cur === 'cn' ? ' aria-current="page"' : ''}>Credit notes</a></div>`;
  function pageInvoices() {
    return `<h1>Invoices</h1>${invTabs('inv')}` + listHtml('inv', {
      rows: () => db.invoices, search: v => `${v.no} ${cName(v.custId)}`, order: (a, b) => b.id - a.id,
      filters: [{ name: 'st', label: 'Status', opts: ['open', 'partial', 'overdue', 'paid', 'credited'].map(s => [s, s]), test: (v, s) => invStatus(v) === s }, { name: 'ty', label: 'Customer', opts: [['B2B', 'B2B'], ['other', 'Retail']], test: (v, t) => (IX.c[v.custId].type === 'B2B') === (t === 'B2B') }],
      cols: [{ h: 'No.', f: v => link('#/invoices/' + v.id, v.no), sort: v => v.no }, { h: 'Date', f: v => v.date, sort: v => v.date }, { h: 'Due', f: v => v.due, sort: v => v.due }, { h: 'Customer', f: v => esc(cName(v.custId)), sort: v => cName(v.custId) }, { h: 'Total', f: v => eur(v.total), cls: 'r', sort: v => v.total }, { h: 'Balance', f: v => balance(v) > 0.005 ? eur(balance(v)) : '', cls: 'r', sort: v => balance(v) }, { h: 'Status', f: v => badge(invStatus(v)) }]
    });
  }
  function pageInvoice(id) {
    const v = IX.inv[id]; if (!v) return notFound('Invoice', '#/invoices'); const b = balance(v), st = invStatus(v), cns = db.creditNotes.filter(c => c.invoiceId === v.id), so = IX.so[v.soId];
    return detail({
      back: '#/invoices', backLabel: 'Invoices', title: 'Invoice ' + v.no, badge: badge(st),
      actions: (b > 0.005 ? `<button class="btn pri" data-act="payInv" data-id="${id}">Record payment</button>` : '') + (returnable(v).length ? `<button class="btn" data-act="retInv" data-id="${id}">Credit note / return</button>` : '') + '<button class="btn" onclick="window.print()">Print</button>',
      meta: [['Customer', link('#/customers/' + v.custId, cName(v.custId))], ['Date', v.date], ['Due', v.due], ['Sales order', so ? link('#/sales/' + so.id, so.no) : '-'], ['Paid', eur(paidAmt(v))], ['Credited', eur(credited(v))], ['Open balance', `<b>${eur(Math.max(0, b))}</b>`]],
      body: linesTable(v.lines, v.country) + `<section class="card" style="margin-top:14px"><h2>Payments</h2>${v.payments.length ? `<div class="tablewrap"><table><tbody>${v.payments.map(p => `<tr><td>${p.date}</td><td>${esc(p.method)}</td><td class="r">${eur(p.amount)}</td></tr>`).join('')}</tbody></table></div>` : empty('No payments yet')}</section>` +
        (cns.length ? `<section class="card"><h2>Credit notes</h2><div class="tablewrap"><table><tbody>${cns.map(c => `<tr><td>${link('#/invoices/cn/' + c.id, c.no)}</td><td>${c.date}</td><td class="r">${eur(c.total)}</td></tr>`).join('')}</tbody></table></div></section>` : '')
    });
  }
  function pageCreditNotes() {
    return `<h1>Invoices</h1>${invTabs('cn')}` + listHtml('cn', {
      rows: () => db.creditNotes, search: c => `${c.no} ${cName(c.custId)} ${(IX.inv[c.invoiceId] || {}).no}`, order: (a, b) => b.id - a.id,
      cols: [{ h: 'No.', f: c => link('#/invoices/cn/' + c.id, c.no), sort: c => c.no }, { h: 'Date', f: c => c.date, sort: c => c.date }, { h: 'Invoice', f: c => IX.inv[c.invoiceId] ? link('#/invoices/' + c.invoiceId, IX.inv[c.invoiceId].no) : '' }, { h: 'Customer', f: c => esc(cName(c.custId)) }, { h: 'Reason', f: c => esc(c.reason) }, { h: 'Total', f: c => eur(c.total), cls: 'r', sort: c => c.total }]
    });
  }
  function pageCreditNote(id) {
    const c = IX.cn[id]; if (!c) return notFound('Credit note', '#/invoices/cn');
    return detail({ back: '#/invoices/cn', backLabel: 'Credit notes', title: 'Credit note ' + c.no, badge: '', actions: '<button class="btn" onclick="window.print()">Print</button>', meta: [['Invoice', IX.inv[c.invoiceId] ? link('#/invoices/' + c.invoiceId, IX.inv[c.invoiceId].no) : '-'], ['Customer', esc(cName(c.custId))], ['Date', c.date], ['Reason', esc(c.reason)], ['Restocked', c.restock ? 'Yes, at ' + esc(locName(c.loc)) : 'No']], body: linesTable(c.lines, c.country) });
  }

  /* ---------- forms ---------- */
  function formNewSO(o) {
    o = o || {};
    modal('New sales order', `<label class="f">Customer<select name="cust" required>${custOpts(o.cid)}</select></label><label class="f">Ships from<select name="loc">${locOpts('WH', l => l.type !== 'store')}</select></label>${linesEditor(true)}`, 'Create draft order', fd => {
      const lines = readLines($('#modalSlot form'), p => p.price), so = newSO({ custId: +fd.get('cust'), loc: fd.get('loc'), channel: 'b2b', lines }); closeModal(); commit(`${so.no} created`); location.hash = '#/sales/' + so.id;
    });
  }
  function formNewQuote(o) {
    o = o || {};
    modal('New quote', `<label class="f">Customer<select name="cust" required>${custOpts(o.cid, c => c.type === 'B2B')}</select></label><label class="f">Valid for (days)<input name="days" type="number" value="30" min="1"></label>${linesEditor(true)}`, 'Create quote', fd => {
      const cu = IX.c[+fd.get('cust')], lines = readLines($('#modalSlot form'), p => r2(p.price * 0.9));
      const q = { id: nextId(), no: docNo('QT'), date: TODAY, valid: U.add(TODAY, +fd.get('days') || 30), custId: cu.id, status: 'draft', lines, country: cu.country };
      db.quotes.push(q); closeModal(); commit(`${q.no} created`); location.hash = '#/quotes/' + q.id;
    });
  }
  function formNewPO(sid) {
    modal('New purchase order', `<label class="f">Supplier<select name="sup">${opts(db.suppliers.map(s => [s.id, s.name + ' (' + s.currency + ')']), sid)}</select></label>${linesEditor(true)}`, 'Create draft PO', fd => {
      const s = +fd.get('sup'), lines = readLines($('#modalSlot form'), p => supplierPrice(s, p.id)); const po = createPO(s, lines); closeModal(); commit(`${po.no} created`); location.hash = '#/purchasing/' + po.id;
    });
  }
  function formReceivePO(id) {
    const po = IX.po[id];
    modal('Receive goods ' + po.no, `<p class="muted">Quantities are added to the central warehouse.</p>` + po.lines.map((l, i) => `<label class="f">${esc(pLabel(IX.p[l.pid]))} (ordered ${l.qty}, received ${l.recv || 0})<input name="q${i}" type="number" min="0" max="${l.qty - (l.recv || 0)}" value="${l.qty - (l.recv || 0)}"></label>`).join(''), 'Receive', fd => {
      const q = po.lines.map((l, i) => fd.get('q' + i)); closeModal(); doReceivePO(id, q);
    });
  }
  function formNewTransfer() {
    modal('New transfer', `<div class="toolbar"><label class="f">From<select name="from">${locOpts('WH')}</select></label><label class="f">To<select name="to">${locOpts('SI-KOM', l => l.id !== 'WH')}</select></label></div>${linesEditor(false)}`, 'Create draft', fd => {
      if (fd.get('from') === fd.get('to')) throw new Error('Choose two different locations');
      const lines = readLines($('#modalSlot form'), () => 0).map(l => ({ pid: l.pid, qty: l.qty })), t = { id: nextId(), no: docNo('TR'), date: TODAY, from: fd.get('from'), to: fd.get('to'), status: 'draft', lines };
      db.transfers.push(t); closeModal(); commit(`${t.no} created`); location.hash = '#/transfers/' + t.id;
    });
  }
  function formNewCount() {
    modal('New stock count', `<label class="f">Location<select name="loc">${locOpts('SI-KOM')}</select></label><label class="f">Category<select name="cat"><option value="">All categories</option>${opts(CATS.map(c => [c.id, c.name]))}</select></label>`, 'Start count', fd => {
      const l = fd.get('loc'), cat = fd.get('cat'), lines = db.products.filter(p => !cat || p.cat === cat).map(p => ({ pid: p.id, expected: onHand(p.id, l), counted: null }));
      const c = { id: nextId(), no: docNo('CNT'), date: TODAY, loc: l, scope: cat ? catName(cat) : 'All', status: 'open', lines }; db.counts.push(c); closeModal(); commit(`${c.no} started`); location.hash = '#/counts/' + c.id;
    });
  }
  function formPayment(id) {
    const v = IX.inv[id], b = balance(v);
    modal('Record payment', `<p>${esc(v.no)} · open balance <b>${eur(b)}</b></p><label class="f">Amount<input name="amt" type="number" step="0.01" min="0.01" max="${b}" value="${b}"></label><label class="f">Method<select name="method">${opts([['bank', 'Bank transfer'], ['card', 'Card'], ['cash', 'Cash']])}</select></label>`, 'Record', fd => { closeModal(); doPayment(id, +fd.get('amt'), fd.get('method')); });
  }
  function formReturn(id) {
    const v = IX.inv[id], rem = returnable(v);
    modal('Credit note / return', `<p class="muted">Invoice ${esc(v.no)}. Choose the quantities to credit.</p>` + rem.map(l => `<label class="f">${esc(pLabel(IX.p[l.pid]))} at ${eur(l.price)} (max ${l.max})<input name="r${l.pid}" type="number" min="0" max="${l.max}" value="0"></label>`).join('') +
      `<label class="f">Reason<input name="reason" value="Customer return"></label><label class="f" style="flex-direction:row;gap:8px;align-items:center"><input type="checkbox" name="restock" checked style="width:auto"> Return items to stock at ${esc(locName(v.loc))}</label>`, 'Create credit note', fd => {
      const q = {}; rem.forEach(l => { q[l.pid] = fd.get('r' + l.pid); }); closeModal(); const cn = doReturn(id, q, fd.get('restock'), fd.get('reason')); location.hash = '#/invoices/cn/' + cn.id;
    });
  }
  function formCustomer(id) {
    const c = id ? IX.c[id] : { type: 'B2B', country: 'SI', terms: 30 };
    modal(id ? 'Edit customer' : 'New customer', `<label class="f">Name<input name="name" required value="${esc(c.name || '')}"></label><label class="f">Type<select name="type">${opts([['B2B', 'B2B'], ['B2C', 'B2C']], c.type)}</select></label><label class="f">Country<select name="country">${opts([['SI', 'Slovenia'], ['HR', 'Croatia']], c.country)}</select></label><label class="f">VAT ID<input name="vatId" value="${esc(c.vatId || '')}"></label><label class="f">E-mail<input name="email" type="email" value="${esc(c.email || '')}"></label><label class="f">City<input name="city" value="${esc(c.city || '')}"></label><label class="f">Payment terms (days)<input name="terms" type="number" min="0" value="${c.terms || 0}"></label>`, 'Save', fd => {
      const o = id ? c : { id: nextId() }; Object.assign(o, { name: fd.get('name').trim(), type: fd.get('type'), country: fd.get('country'), vatId: fd.get('vatId').trim(), email: fd.get('email').trim(), city: fd.get('city').trim(), terms: +fd.get('terms') || 0 });
      if (!o.name) throw new Error('Name is required'); if (!id) db.customers.push(o); closeModal(); commit('Customer saved'); if (!id) location.hash = '#/customers/' + o.id;
    });
  }
  function formProduct(id) {
    const p = IX.p[id];
    modal('Edit prices · ' + p.sku, `<label class="f">List price (net, EUR)<input name="price" type="number" step="0.01" min="0" value="${p.price}"></label><label class="f">Cost (EUR)<input name="cost" type="number" step="0.01" min="0" value="${p.cost}"></label>`, 'Save', fd => {
      const price = +fd.get('price'), cost = +fd.get('cost'); if (!(price > 0) || !(cost >= 0)) throw new Error('Enter valid prices');
      if (price !== p.price || cost !== p.cost) { p.price = price; p.cost = cost; (db.priceHistory[id] = db.priceHistory[id] || []).push({ date: TODAY, price, cost }); }
      closeModal(); commit('Prices updated');
    });
  }

  /* ---------- actions ---------- */
  const goto = h => { location.hash = h; };
  const ACT = {
    sort(el) { const s = lst(el.dataset.key), i = +el.dataset.i; if (s.sort === i) s.dir = -s.dir; else { s.sort = i; s.dir = 1; } s.page = 0; saveUi(); $('#list-' + el.dataset.key).innerHTML = tableHtml(el.dataset.key); },
    page(el) { const s = lst(el.dataset.key); s.page = Math.max(0, s.page + +el.dataset.d); saveUi(); $('#list-' + el.dataset.key).innerHTML = tableHtml(el.dataset.key); },
    csv(el) { csvExport(el.dataset.key); }, ovTable() { ui.ovTable = !ui.ovTable; saveUi(); render(true); },
    closeModal, closeDrawer, bg(el, e) { if (e.target === el) closeModal(); }, bgDrawer(el, e) { if (e.target === el) closeDrawer(); },
    addLine(el) { $('#lines').insertAdjacentHTML('beforeend', lineRow(!!el.dataset.price, {})); },
    rmLine(el) { const rows = $$('.lrow'); if (rows.length > 1) el.closest('.lrow').remove(); else $$('input', el.closest('.lrow')).forEach(i => { i.value = ''; }); },
    newSO(el) { formNewSO({ cid: el.dataset.cid }); }, soConfirm(el) { doConfirmSO(+el.dataset.id); }, soShip(el) { doShipSO(+el.dataset.id); }, soInvoice(el) { doInvoiceSO(+el.dataset.id); }, soCancel(el) { doCancelSO(+el.dataset.id); },
    payInv(el) { formPayment(+el.dataset.id); }, retInv(el) { formReturn(+el.dataset.id); },
    newPO(el) { formNewPO(+el.dataset.sid || undefined); }, poOrder(el) { doOrderPO(+el.dataset.id); }, poReceive(el) { formReceivePO(+el.dataset.id); },
    poDel(el) { if (!confirm('Delete this draft purchase order?')) return; db.pos.splice(db.pos.indexOf(IX.po[el.dataset.id]), 1); commit('Draft PO deleted'); goto('#/purchasing'); },
    poFromSug(el) { const sid = +el.dataset.sid, po = createPO(sid, suggestions().filter(r => r.sid === sid).map(r => ({ pid: r.pid, qty: r.qty, cost: r.price }))); commit(`${po.no} created`); goto('#/purchasing/' + po.id); },
    newTr() { formNewTransfer(); }, trShip(el) { doShipTransfer(+el.dataset.id); }, trReceive(el) { doReceiveTransfer(+el.dataset.id); }, trFromPlan() { doTransferFromPlan(); },
    trDel(el) { if (!confirm('Delete this draft transfer?')) return; db.transfers.splice(db.transfers.indexOf(IX.tr[el.dataset.id]), 1); commit('Draft transfer deleted'); goto('#/transfers'); },
    newCount() { formNewCount(); }, cntPost(el) { if (confirm('Post the count differences to stock?')) doPostCount(+el.dataset.id); },
    cntDel(el) { if (!confirm('Delete this count?')) return; db.counts.splice(db.counts.indexOf(IX.cnt[el.dataset.id]), 1); commit('Count deleted'); goto('#/counts'); },
    newQuote(el) { formNewQuote({ cid: el.dataset.cid }); },
    qSend(el) { IX.q[el.dataset.id].status = 'sent'; commit('Quote marked as sent'); }, qAccept(el) { IX.q[el.dataset.id].status = 'accepted'; commit('Quote accepted'); },
    qReject(el) { IX.q[el.dataset.id].status = 'rejected'; commit('Quote rejected'); }, qConvert(el) { doConvertQuote(+el.dataset.id); },
    newCust() { formCustomer(); }, editCust(el) { formCustomer(+el.dataset.id); }, editProd(el) { formProduct(+el.dataset.id); },
    posAdd(el) { const pid = +el.dataset.id, c = posS.cart.find(x => x.pid === pid); if ((c ? c.qty : 0) + 1 > avail(pid, posS.loc)) return toast('No more stock at this store'); if (c) c.qty++; else posS.cart.push({ pid, qty: 1 }); $('#posCart').innerHTML = posCartHtml(); },
    posInc(el) { const c = posS.cart[+el.dataset.i], q = c.qty + +el.dataset.d; if (q > avail(c.pid, posS.loc)) return toast('No more stock at this store'); if (q < 1) posS.cart.splice(+el.dataset.i, 1); else c.qty = q; $('#posCart').innerHTML = posCartHtml(); },
    posClear() { posS.cart = []; $('#posCart').innerHTML = posCartHtml(); }, posPay() { doPosSale(); },
    menu() { const o = document.body.classList.toggle('menu-open'); $('#menuBtn').setAttribute('aria-expanded', o); }
  };
  const CHG = {
    flt(el) { const s = lst(el.dataset.key); s.f[el.dataset.name] = el.value; s.page = 0; saveUi(); $('#list-' + el.dataset.key).innerHTML = tableHtml(el.dataset.key); },
    posLoc(el) { posS.loc = el.value; posS.cart = []; render(true); }, posCust(el) { posS.cust = el.value; }, posMethod(el) { posS.method = el.value; },
    mm(el) { const o = (db.minmax[el.dataset.pid] = db.minmax[el.dataset.pid] || {}), m = (o[el.dataset.loc] = o[el.dataset.loc] || { min: 0, max: 0 }); m[el.dataset.f] = Math.max(0, +el.value || 0); if (m.max < m.min) m.max = m.min; commit('Min/max updated'); },
    cntq(el) {
      const c = IX.cnt[el.dataset.id], l = c.lines[+el.dataset.i]; l.counted = el.value === '' ? null : Math.max(0, Math.floor(+el.value)); save();
      $('#cd-' + el.dataset.i).textContent = l.counted == null ? '' : l.counted - l.expected; $('#cntDone').textContent = c.lines.filter(x => x.counted != null).length; $('#cntDiff').textContent = c.lines.filter(x => x.counted != null && x.counted !== x.expected).length;
    }
  };
  const INP = {
    q(el) { const s = lst(el.dataset.key); s.q = el.value; s.page = 0; saveUi(); $('#list-' + el.dataset.key).innerHTML = tableHtml(el.dataset.key); },
    posq(el) { posS.q = el.value; $('#posGrid').innerHTML = posGridHtml(); }
  };
  const guard = fn => (...a) => { try { fn(...a); } catch (e) { toast(e.message || String(e)); } };
  document.addEventListener('click', guard(e => { const el = e.target.closest('[data-act]'); if (!el || !ACT[el.dataset.act]) return; ACT[el.dataset.act](el, e); }));
  document.addEventListener('change', guard(e => { const el = e.target.closest('[data-chg]'); if (el && CHG[el.dataset.chg]) CHG[el.dataset.chg](el, e); }));
  document.addEventListener('input', guard(e => { const el = e.target.closest('[data-inp]'); if (el && INP[el.dataset.inp]) INP[el.dataset.inp](el, e); }));
  document.addEventListener('submit', guard(e => { e.preventDefault(); if (curForm) curForm(new FormData(e.target), e.target); }));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { if ($('#modalSlot').firstChild) closeModal(); else if ($('#drawerSlot').firstChild) closeDrawer(); else document.body.classList.remove('menu-open'); } });
  $('#menuBtn').addEventListener('click', () => ACT.menu());

  /* ---------- router ---------- */
  const NAV = [['Overview', '', 'home'], ['Products', 'products', 'box', () => db.products.length], ['Replenishment', 'replenishment', 'refresh', () => replenishmentPlan().filter(r => r.qty > 0).length], ['Transfers', 'transfers', 'truck', () => db.transfers.filter(t => t.status !== 'received').length],
    ['Stock counts', 'counts', 'clip', () => db.counts.filter(c => c.status === 'open').length], ['Movements', 'movements', 'list'], ['Purchasing', 'purchasing', 'cart', () => db.pos.filter(p => p.status !== 'received').length], ['Suppliers', 'suppliers', 'factory', () => db.suppliers.length],
    ['Point of sale', 'pos', 'till'], ['Quotes', 'quotes', 'file', () => db.quotes.filter(q => ['draft', 'sent'].includes(quoteStatus(q))).length], ['Sales orders', 'sales', 'bag', () => db.sos.filter(s => ['draft', 'confirmed', 'shipped'].includes(s.status)).length],
    ['Customers', 'customers', 'users', () => db.customers.length], ['Invoices', 'invoices', 'receipt', () => db.invoices.filter(v => invStatus(v) === 'overdue').length]];
  const PAGES = {
    '': pageOverview, products: pageProducts, replenishment: pageReplenishment, transfers: id => id ? pageTransfer(id) : pageTransfers(), counts: id => id ? pageCount(id) : pageCounts(), movements: pageMovements,
    purchasing: id => id === 'suggest' ? pageSuggest() : id ? pagePO(id) : pagePurchasing(), suppliers: pageSuppliers, pos: (id, sub) => id === 'receipt' ? pageReceipt(sub) : pagePos(), quotes: id => id ? pageQuote(id) : pageQuotes(),
    sales: id => id ? pageSO(id) : pageSales(), customers: pageCustomers, invoices: (id, sub) => id === 'cn' ? (sub ? pageCreditNote(sub) : pageCreditNotes()) : id ? pageInvoice(id) : pageInvoices()
  };
  const DRAWER_ROUTES = { products: openProductDrawer, suppliers: openSupplierDrawer, customers: openCustomerDrawer };
  const TITLES = { '': 'Overview', products: 'Products', replenishment: 'Replenishment', transfers: 'Transfers', counts: 'Stock counts', movements: 'Movements', purchasing: 'Purchasing', suppliers: 'Suppliers', pos: 'Point of sale', quotes: 'Quotes', sales: 'Sales orders', customers: 'Customers', invoices: 'Invoices' };
  function parseHash() { const p = location.hash.replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean).map(decodeURIComponent); return { base: p[0] || '', id: p[1], sub: p[2] }; }
  let rendering = false, again = false;
  function render(keep) {
    if (!db) return;
    if (rendering) { again = true; return; }
    rendering = true;
    try { renderNow(keep); } finally { rendering = false; }
    if (again) { again = false; render(true); }
  }
  function renderNow(keep) {
    const r = parseHash(), fn = PAGES[r.base];
    if (!fn) { location.replace('#/'); return; }
    const y = window.scrollY, active = document.activeElement && document.activeElement.id;
    $('#main').innerHTML = fn(r.id, r.sub) || '';
    document.title = (TITLES[r.base] || 'ERP') + ' · ERP · Adrial Apps';
    const dr = DRAWER_ROUTES[r.base]; if (dr && r.id) dr(+r.id); else closeDrawerSlot();
    $('#nav').innerHTML = NAV.map(([label, key, ic, cnt]) => { const n = cnt ? cnt() : 0; return `<a href="#/${key}"${r.base === key ? ' aria-current="page"' : ''}>${icon(ic)}<span>${label}</span>${n ? `<span class="cnt">${num(n)}</span>` : ''}</a>`; }).join('');
    if (keep) { window.scrollTo(0, y); if (active) { const a = document.getElementById(active); if (a) a.focus(); } }
  }
  function onRoute() { document.body.classList.remove('menu-open'); render(false); window.scrollTo(0, 0); }
  addEventListener('hashchange', onRoute);
  function commit(msg) { reindex(); crmStatusSync(); save(); schedulePublish(); render(true); if (msg) toast(msg); }

  /* ---------- bus ---------- */
  function buildCatalog() { return { updatedAt: Date.now(), locations: LOC.map(l => ({ id: l.id, name: l.name })), categories: CATS.map(c => ({ id: c.id, name: c.name })), products: db.products.map(p => ({ id: p.id, sku: p.sku, name: p.name, category: p.cat, price: p.price, cost: p.cost, stock: onHand(p.id), available: avail(p.id), warehouse: avail(p.id, 'WH') })) }; }
  function buildCustomers() { return { updatedAt: Date.now(), customers: db.customers.filter(c => c.type !== 'walkin').map(c => ({ id: c.id, name: c.name, type: c.type, country: c.country, vatId: c.vatId, email: c.email, city: c.city, openBalance: r2(balMap()[c.id] || 0) })) }; }
  function buildSummary() {
    const k = kpis(), ms = monthly(), sold = {}, from = U.add(TODAY, -90);
    db.invoices.forEach(v => { if (v.date >= from) v.lines.forEach(l => { sold[l.pid] = (sold[l.pid] || 0) + l.qty * l.price; }); });
    return { updatedAt: Date.now(), today: TODAY, revenue30: r2(k.rev30), revenue12m: r2(ms.reduce((a, m) => a + m.revenue, 0)), months: ms, receivables: r2(k.recv), overdue: r2(k.overdue), stockValue: r2(k.stockValue), lowStockLines: k.low, openPurchaseOrders: k.openPO, openSalesOrders: k.openSO, ageing: k.age.map(r2), topProducts: Object.entries(sold).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([pid, v]) => ({ sku: IX.p[pid].sku, name: IX.p[pid].name, revenue: r2(v) })) };
  }
  function schedulePublish() { clearTimeout(pubT); pubT = setTimeout(publishAll, 1500); }
  function publishAll() { if (!window.AdrialBus || !db) return; AdrialBus.publish('erp.catalog', buildCatalog()); AdrialBus.publish('erp.customers', buildCustomers()); AdrialBus.publish('erp.summary', buildSummary()); }
  function handleCrmOrder(p, msgId) {
    const vat = String(p.vatId || (p.customer && p.customer.vatId) || '').trim(), name = String(p.company || p.customerName || (p.customer && p.customer.name) || '').trim();
    const lines = (p.lines || p.items || []).map(l => {
      const pr = (l.sku && IX.sku[String(l.sku).toLowerCase()]) || IX.p[l.productId] || IX.p[l.pid]; if (!pr) throw new Error('Unknown product ' + (l.sku || l.productId || l.name || '?'));
      const q = Math.floor(+l.qty || +l.quantity || 0); if (q < 1) throw new Error('Bad quantity for ' + pr.sku);
      return { pid: pr.id, qty: q, price: r2(l.price != null ? +l.price : l.unitPrice != null ? +l.unitPrice : pr.price) };
    });
    if (!lines.length) throw new Error('Order has no lines');
    let cu = (vat && db.customers.find(c => c.vatId && c.vatId.toLowerCase() === vat.toLowerCase())) || (name && db.customers.find(c => c.name.toLowerCase() === name.toLowerCase()));
    if (!cu) { if (!name) throw new Error('Order has no company name'); cu = { id: nextId(), name, type: 'B2B', country: vat.slice(0, 2).toUpperCase() === 'HR' ? 'HR' : 'SI', vatId: vat, email: p.email || '', city: p.city || '', terms: 30 }; db.customers.push(cu); IX.c[cu.id] = cu; }
    const so = newSO({ custId: cu.id, loc: 'WH', channel: 'b2b', lines, source: { app: 'crm', dealId: p.dealId != null ? p.dealId : p.id, msgId, company: name }, note: p.note || '' });
    commit('Order from CRM: ' + so.no); return so;
  }
  function crmStatusSync() {
    let ch = false;
    db.sos.forEach(so => {
      const s = so.source; if (!s || s.app !== 'crm') return;
      const inv = so.invoiceId ? IX.inv[so.invoiceId] : null, label = so.status + (inv ? ':' + invStatus(inv) : '');
      if (s.sent === label) return; s.sent = label; ch = true;
      if (window.AdrialBus) AdrialBus.send('crm', 'erp.orderStatus', { dealId: s.dealId, orderId: so.id, orderNo: so.no, status: so.status, invoiceNo: inv ? inv.no : null, invoiceStatus: inv ? invStatus(inv) : null, total: soTot(so).total });
    });
    return ch;
  }
  function processInbox() {
    if (inboxBusy || !window.AdrialBus) return;
    const run = async () => {
      const msgs = await AdrialBus.inbox('erp'); if (!msgs.length) return;
      if (!pending) { try { const d = await idbGet(); if (validDb(d)) { db = d; ensureSchema(); reindex(); } } catch (e) { } }
      for (const m of msgs) {
        if (m.type !== 'crm.order') { await AdrialBus.fail(m.id, 'Unknown message type'); continue; }
        try { const so = db.sos.find(s => s.source && s.source.msgId === m.id) || handleCrmOrder(m.payload || {}, m.id); await AdrialBus.done(m.id, { orderNo: so.no, orderId: so.id }); } catch (err) { await AdrialBus.fail(m.id, String(err.message || err)); }
      }
      await flush();
    };
    inboxBusy = true;
    (navigator.locks ? navigator.locks.request('adrial-erp-inbox', run) : run()).catch(() => { }).then(() => { inboxBusy = false; });
  }
  function busStart() {
    if (!window.AdrialBus) return;
    AdrialBus.on(e => { if (e && e.kind === 'message' && e.to === 'erp') processInbox(); });
    publishAll(); processInbox();
  }
  function syncStart() {
    if (!window.AdrialSync) return;
    sync = AdrialSync.attach({ app: 'erp', label: 'ERP data', getSnapshot: () => Promise.resolve(db), applySnapshot: snap => { if (!validDb(snap)) return; db = snap; ensureSchema(); reindex(); idbPut(db).catch(() => { }); render(true); } });
    sync.mountPanel($('#syncPanel'));
  }

  /* ---------- boot and reset ---------- */
  async function boot() {
    let d = null;
    try { d = await idbGet(); } catch (e) { memOnly = true; }
    if (!validDb(d)) {
      d = null;
      try { const l = JSON.parse(localStorage.getItem('adrial-erp-db') || 'null'); if (validDb(l)) { d = l; localStorage.removeItem('adrial-erp-db'); } } catch (e) { }
      if (!d) d = D.generate(TODAY);
      db = d; ensureSchema();
      if (!memOnly) try { await idbPut(db); } catch (e) { memOnly = true; }
      if (memOnly) toast('IndexedDB is unavailable; data is kept in memory only.'); else setTimeout(() => toast('Demo data generated'), 300);
    } else { db = d; ensureSchema(); }
    reindex();
    if (crmStatusSync()) save();
    if (!location.hash) history.replaceState(null, '', '#/');
    onRoute(); busStart(); syncStart();
  }
  $('#resetBtn').addEventListener('click', async () => {
    if (!confirm('Reset all ERP demo data? Your changes in this browser will be lost.')) return;
    db = D.generate(TODAY); ensureSchema();
    try { await idbReset(db); memOnly = false; } catch (e) { memOnly = true; }
    reindex(); resetUiState(); publishAll(); if (bc) bc.postMessage({ type: 'changed', id: TAB }); location.hash = '#/'; render(false); toast('Demo data reset');
  });
  function resetUiState() { Object.keys(ui).forEach(k => { if (ui[k] && typeof ui[k] === 'object') ui[k].page = 0; }); saveUi(); posS.cart = []; posS.q = ''; }
  addEventListener('adrial-theme', () => render(true));
  boot().catch(e => { $('#main').innerHTML = `<p class="empty">Could not start the ERP: ${esc(e.message)}</p>`; console.error(e); });
})();
