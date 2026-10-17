/* Quotes (Business Apps). Static app: quotes live in this browser (IndexedDB `stratum-quotes`) and, with sync on, in
 * the private cloud copy. Maths in core.js, Billing hand-off in billing-link.js, client page in accept.html. */
(function () {
  'use strict';
  const Q = window.QuotesCore, BL = window.QuotesBilling;
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`);
  const DDT = window.DemoDates || null, DDOPTS = { ignore: ['updatedAt'] };
  const INBOX = 'stratum-quotes-inbox';

  // ---------- storage ----------
  const DB = 'stratum-quotes', STORE = 'kv';
  let dbp = null;
  const idb = () => dbp || (dbp = new Promise((res, rej) => {
    const q = indexedDB.open(DB, 1);
    q.onupgradeneeded = () => q.result.createObjectStore(STORE);
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  }));
  async function readState() {
    const db = await idb();
    return new Promise((res, rej) => { const r = db.transaction(STORE).objectStore(STORE).get('state'); r.onsuccess = () => res(r.result || null); r.onerror = () => rej(r.error); });
  }
  async function writeState(s) {
    const db = await idb();
    return new Promise((res, rej) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(s, 'state'); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
  }
  const channel = 'BroadcastChannel' in window ? new BroadcastChannel('stratum-quotes') : null;
  let sync = null;

  let state = null;
  let staleDays = 0;
  let route = { page: 'list', id: null };
  let tab = 'all';
  let pane = 'edit';
  let saveTimer = null;
  const lsGet = (k, d) => { try { return localStorage.getItem(k) || d; } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* kept for this visit only */ } };

  const isValidState = (s) => s && typeof s === 'object' && Array.isArray(s.quotes) && s.company && typeof s.company === 'object';
  function freshDemo() {
    const s = { version: 1, company: { ...Q.COMPANY }, quotes: Q.seedQuotes(), meta: { createdAt: new Date().toISOString(), sample: true } };
    if (DDT) DDT.stamp(s, DDOPTS);
    return s;
  }
  async function persist() {
    clearTimeout(saveTimer); saveTimer = null;
    await writeState(state);
    if (channel) channel.postMessage('changed');
    if (sync) sync.changed();
  }
  function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(() => { persist().catch(() => toast('Could not save in this browser')); }, 350); }
  async function flush() { if (saveTimer) await persist(); }
  async function applyCloud(data) {
    if (!isValidState(data)) throw new Error('The cloud copy is not Quotes data.');
    await writeState(data); state = data; if (channel) channel.postMessage('changed'); render();
  }

  // ---------- helpers ----------
  const byId = (id) => state.quotes.find((q) => q.id === id);
  const today = () => Q.todayIso();
  const T = (q) => Q.totals(q);
  const stOf = (q) => Q.statusOf(q, today());
  const badge = (st) => `<span class="bd s-${st}">${Q.STATUS_LABEL[st]}</span>`;
  const clientName = (q) => q.client.name || 'No client yet';
  function parseNum(s) {
    let t = String(s == null ? '' : s).trim().replace(/\s/g, '');
    if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
    const n = Number(t);
    return Number.isFinite(n) ? n : 0;
  }
  const showNum = (n) => (n === 0 ? '' : String(n).replace('.', ','));
  const money = (c) => Q.eur(c);
  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast'); el.textContent = msg; el.classList.add('on');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('on'), 2800);
  }
  function openDialog(title, body, foot) {
    const d = $('#dlg');
    d.innerHTML = `<div class="dlg-h"><h2>${esc(title)}</h2><button class="btn sm" data-act="close" aria-label="Close">×</button></div><div class="dlg-b">${body}</div><div class="dlg-f">${foot || '<button class="btn p" data-act="close">OK</button>'}</div>`;
    if (!d.open) d.showModal();
  }
  const closeDialog = () => { const d = $('#dlg'); if (d.open) d.close(); };
  function acceptUrl(q) {
    return `${new URL('accept.html', location.href).href.split('#')[0]}#q=${Q.encodeShare(q, state.company)}`;
  }

  // ---------- the document (live preview, print) ----------
  function paperHtml(q, t = T(q)) {
    const rows = t.lines.map((l) => `<tr><td>${esc(l.description) || '<span class="m">(no description)</span>'}${l.note ? `<span class="nt">${esc(l.note)}</span>` : ''}</td><td class="r">${esc(String(l.qty).replace('.', ','))}</td><td class="r">${Q.eur(Q.cents(l.unitPrice), { plain: true })}</td><td class="r">${l.discountPct ? esc(String(l.discountPct).replace('.', ',')) + ' %' : ''}</td><td class="r">${Q.eur(l.amount, { plain: true })}</td></tr>`).join('');
    const co = state.company;
    return `<div class="paper"><div class="top"><div><h4>Quote</h4><div class="m">${esc(q.number)} · ${esc(Q.dmy(q.issueDate))}</div></div>
      <div style="text-align:right"><b>${esc(co.name)}</b><div class="m">${esc(co.address)}<br>${esc(co.city)}</div></div></div>
      <div style="margin:12px 0"><div class="m">Prepared for</div><b>${esc(q.client.name) || '—'}</b><br>${esc(q.client.address)}${q.client.address && q.client.city ? ', ' : ''}${esc(q.client.city)}</div>
      ${q.subject ? `<div><span class="m">Subject:</span> ${esc(q.subject)}</div>` : ''}
      <table><tr><th>Description</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Disc.</th><th class="r">Amount</th></tr>${rows}</table>
      <div class="tt"><div><span>Subtotal</span><span>${money(t.subtotal)}</span></div>${t.discount ? `<div><span>Discount ${esc(Q.pct(q.discountPct))}</span><span>${money(-t.discount)}</span></div><div><span>Net</span><span>${money(t.net)}</span></div>` : ''}<div><span>VAT ${esc(Q.pct(q.vatPct))}</span><span>${money(t.vat)}</span></div><div class="g"><span>Total</span><span>${money(t.total)}</span></div></div>
      <div class="foot">Valid until ${esc(Q.dmy(q.validUntil))}.${q.terms ? ` ${esc(q.terms)}` : ''}</div></div>`;
  }
  function totalsHtml(q, t) {
    return `<div><span>Subtotal</span><span>${money(t.subtotal)}</span></div>${t.discount ? `<div><span>Discount <span class="hint">${esc(Q.pct(q.discountPct))}</span></span><span>${money(-t.discount)}</span></div><div><span>Net</span><span>${money(t.net)}</span></div>` : ''}<div><span>VAT ${esc(Q.pct(q.vatPct))}</span><span>${money(t.vat)}</span></div><div class="g"><span>Total</span><span>${money(t.total)}</span></div>`;
  }

  // ---------- list ----------
  function visibleQuotes() {
    const list = [...state.quotes].sort((a, b) => b.seq - a.seq || b.year - a.year);
    return tab === 'all' ? list : list.filter((q) => stOf(q) === tab);
  }
  function invoiceCell(q) {
    if (stOf(q) === 'accepted' && !q.invoice) return `<button class="btn sm" data-act="create-invoice" data-id="${esc(q.id)}">Create invoice</button>`;
    if (q.invoice) return '<span class="hint">Invoiced</span>';
    return '';
  }
  function pageList() {
    const k = Q.kpis(state.quotes, today()), c = Q.counts(state.quotes, today());
    const rows = visibleQuotes();
    const tabs = ['all', ...Q.STATUSES].map((s) => `<button role="tab" id="tab-${s}" aria-selected="${tab === s}" data-act="tab" data-tab="${s}">${s === 'all' ? 'All' : Q.STATUS_LABEL[s]}<span class="n">${c[s]}</span></button>`).join('');
    const body = rows.map((q) => {
      const t = T(q), st = stOf(q);
      return `<tr data-open="${esc(q.id)}"><td><a href="#/q/${esc(q.id)}">${esc(q.number)}</a></td><td>${esc(clientName(q))}</td><td>${esc(q.subject) || '<span class="hint">—</span>'}</td><td>${st === 'draft' ? '—' : esc(Q.dmy(q.validUntil))}</td><td>${badge(st)}</td><td class="r">${money(t.total)}</td><td>${invoiceCell(q)}</td></tr>`;
    }).join('');
    const cards = rows.map((q) => {
      const t = T(q), st = stOf(q);
      return `<a class="pi" href="#/q/${esc(q.id)}"><div class="a"><span>${esc(clientName(q))}</span><span>${money(t.total)}</span></div><div class="b"><span>${esc(q.number)}${q.subject ? ' · ' + esc(q.subject) : ''}</span>${badge(st)}</div></a>`;
    }).join('');
    const none = '<p class="empty">No quotes here yet.</p>';
    return `<div class="hd"><span class="lg-i phone-only"></span><h1>Quotes</h1><span class="sp"></span><button class="btn desk-only" data-act="export">Export</button><button class="btn p" data-act="new">+ New quote</button></div>
      <div id="demoNote"></div>
      <div class="tabs" role="tablist" aria-label="Filter by status">${tabs}</div>
      <div class="kp"><div><span class="hint">Open (sent)</span><b>${money(k.open)}</b></div><div><span class="hint">Accepted this month</span><b>${money(k.accepted)}</b></div><div><span class="hint">Acceptance rate</span><b>${k.rate == null ? '—' : k.rate + ' %'}</b></div></div>
      ${rows.length ? `<table class="t"><thead><tr><th>Number</th><th>Client</th><th>Subject</th><th>Valid until</th><th>Status</th><th class="r">Total (incl. VAT)</th><th><span class="sr">Actions</span></th></tr></thead><tbody>${body}</tbody></table><div class="pi-list">${cards}</div>` : none}
      <section class="datacard"><h3>Your data</h3><p class="hint" style="margin:0">Quotes are saved in this browser${'' }. Demo company and clients are made up.</p><div id="syncPanel"></div>
      <div class="row"><button class="btn sm" data-act="reset">Reset demo data</button></div></section>`;
  }

  // ---------- editor ----------
  const FIELD = (q, locked, name, label, val, attrs = '') => `<div><label class="lbl" for="f-${name}">${label}</label><input class="inp" id="f-${name}" data-f="${name}" value="${esc(val)}" ${locked ? 'disabled' : ''} ${attrs}></div>`;
  function lineRow(q, l, i, locked) {
    const dis = locked ? 'disabled' : '';
    return `<div class="li" data-line="${i}">
      <div class="desc"><label class="sr" for="l${i}-d">Description</label><input class="inp" id="l${i}-d" data-k="description" value="${esc(l.description)}" placeholder="Description" ${dis}>
        <label class="sr" for="l${i}-n">Details</label><input class="inp note" id="l${i}-n" data-k="note" value="${esc(l.note)}" placeholder="Details (optional)" ${dis}></div>
      <div><span class="mlbl">Qty</span><input class="inp num" inputmode="decimal" aria-label="Quantity" data-k="qty" value="${esc(showNum(l.qty))}" ${dis}></div>
      <div><span class="mlbl">Unit price</span><input class="inp num" inputmode="decimal" aria-label="Unit price" data-k="unitPrice" value="${esc(showNum(l.unitPrice))}" ${dis}></div>
      <div><span class="mlbl">Disc. %</span><input class="inp num" inputmode="decimal" aria-label="Line discount percent" data-k="discountPct" value="${esc(showNum(l.discountPct))}" placeholder="0" ${dis}></div>
      <div class="am" data-amount>${Q.eur(Q.lineAmount(l))}</div>
      ${locked ? '<span></span>' : `<button class="rm" data-act="del-line" data-i="${i}" aria-label="Remove item ${i + 1}">×</button>`}</div>`;
  }
  function invoiceBox(q) {
    const st = stOf(q);
    if (q.invoice) return `<div class="callout ok" id="invBox"><span class="t1"><b>Invoice in Billing:</b> <span id="invState" class="hint">checking…</span></span><a class="btn p" id="invOpen" href="/billing/#doc/${esc(q.invoice.id)}">Open in Billing</a></div>`;
    if (st === 'accepted') return `<div class="callout" id="invBox"><span class="t1">Accepted. Make the invoice draft in Billing with the same items, discount and VAT.</span><button class="btn p" data-act="create-invoice" data-id="${esc(q.id)}">Accepted → Create invoice in Billing</button></div>`;
    return `<div class="callout" id="invBox"><span class="t1 hint">When the client accepts, create the invoice in Billing in one click.</span><button class="btn p" disabled aria-disabled="true">Accepted → Create invoice in Billing</button></div>`;
  }
  function statusBox(q) {
    const st = stOf(q), dec = q.decision;
    let h = '';
    if (dec) h += `<div class="dec"><b>${dec.kind === 'accepted' ? 'Accepted' : 'Declined'}</b> on ${esc(Q.dmy(dec.at))}${dec.name ? ` by ${esc(dec.name)}` : ''}${dec.note ? `<br><span class="hint">“${esc(dec.note)}”</span>` : ''}</div>`;
    const b = [];
    if (st === 'draft') b.push('<button class="btn p" data-act="send">Send quote</button>');
    if (st === 'sent') b.push('<button class="btn" data-act="mark-accepted">Mark accepted</button>', '<button class="btn" data-act="mark-declined">Mark declined</button>');
    if (st !== 'draft') b.push('<button class="btn" data-act="reopen">Back to draft to edit</button>');
    b.push('<button class="btn" data-act="duplicate">Duplicate</button>');
    if (st === 'draft') b.push('<button class="btn danger" data-act="delete">Delete draft</button>');
    return `${h}<div class="actions">${b.join('')}</div>`;
  }
  function pageEditor(q) {
    const locked = q.status !== 'draft', st = stOf(q);
    const t = T(q);
    const lines = q.lines.map((l, i) => lineRow(q, l, i, locked)).join('');
    const link = q.status === 'sent' ? '<button class="btn" data-act="copy-link">Copy accept link</button>' : '';
    const acts = `${link}<button class="btn" data-act="print">PDF / Print</button>${st === 'draft' ? '<button class="btn p" data-act="send">Send quote</button>' : ''}`;
    return `<div class="hd doc"><a class="back" href="#/">Quotes ›</a><h2>${esc(q.number)}</h2>${badge(st)}<span class="sp"></span><span class="acts">${acts}</span></div>
      <div class="seg" role="tablist" aria-label="Edit or preview"><button role="tab" aria-selected="${pane === 'edit'}" data-act="pane" data-pane="edit">Edit</button><button role="tab" aria-selected="${pane === 'preview'}" data-act="pane" data-pane="preview">Preview</button></div>
      <div class="edit"><div class="form">
        ${locked ? `<p class="hint" style="margin:0 0 14px">${st === 'sent' || st === 'expired' ? 'This quote is out with the client, so the items are locked. You can still change the valid-until date.' : 'This quote is closed, so it is locked. Duplicate it to start a new one.'}</p>` : ''}
        <div class="fgrid"><div class="full">${FIELD(q, locked, 'client.name', 'Client', q.client.name, 'autocomplete="off"')}</div>
          <div class="full">${FIELD(q, locked, 'subject', 'Subject', q.subject, 'placeholder="What the quote is for"')}</div></div>
        <div class="fgrid c2" style="margin-top:14px">${FIELD(q, locked, 'client.address', 'Client address', q.client.address)}${FIELD(q, locked, 'client.city', 'Postcode and city', q.client.city)}</div>
        <div class="fgrid c2" style="margin-top:14px"><div><label class="lbl" for="f-validUntil">Valid until</label><input class="inp" type="date" id="f-validUntil" data-f="validUntil" value="${esc(q.validUntil)}" ${q.status === 'sent' || q.status === 'draft' ? '' : 'disabled'}></div>
          <div><label class="lbl" for="f-vatPct">VAT %</label><input class="inp" id="f-vatPct" data-f="vatPct" inputmode="decimal" value="${esc(showNum(q.vatPct))}" ${locked ? 'disabled' : ''}></div></div>
        <h3>Line items</h3>
        <div class="li head" aria-hidden="true"><span>Description</span><span>Qty</span><span>Unit price</span><span>Disc.</span><span style="text-align:right">Amount</span><span></span></div>
        <div id="lines">${lines}</div>
        ${locked ? '' : '<button class="add" data-act="add-line">+ Add item</button>'}
        <div class="sumrow"><div><label class="lbl" for="f-discountPct">Overall discount %</label><input class="inp" style="width:120px" id="f-discountPct" data-f="discountPct" inputmode="decimal" value="${esc(showNum(q.discountPct))}" placeholder="0" ${locked ? 'disabled' : ''}></div>
          <div class="tot" id="totals" aria-live="polite">${totalsHtml(q, t)}</div></div>
        <div style="margin-top:14px"><label class="lbl" for="f-terms">Terms</label><textarea class="inp" id="f-terms" data-f="terms" ${locked ? 'disabled' : ''}>${esc(q.terms)}</textarea></div>
        <div id="statusBox">${statusBox(q)}</div>
        ${invoiceBox(q)}
      </div>
      <div class="pv"><div class="lbl">Preview · updates as you type</div><div id="preview">${paperHtml(q, t)}</div></div></div>
      <div class="pbar"><button class="btn" data-act="print">PDF / Print</button>${st === 'draft' ? '<button class="btn p" data-act="send">Send quote</button>' : q.status === 'sent' ? '<button class="btn p" data-act="copy-link">Copy accept link</button>' : ''}</div>`;
  }

  // live updates while typing: only the numbers, the preview and the print copy change, so focus is never lost
  function refreshLive(q) {
    const t = T(q);
    const tot = $('#totals'); if (tot) tot.innerHTML = totalsHtml(q, t);
    document.querySelectorAll('[data-line]').forEach((row) => { const l = q.lines[Number(row.dataset.line)]; const a = $('[data-amount]', row); if (l && a) a.textContent = Q.eur(Q.lineAmount(l)); });
    const html = paperHtml(q, t);
    const pv = $('#preview'); if (pv) pv.innerHTML = html;
    $('#printArea').innerHTML = html;
  }

  // ---------- render ----------
  function parseRoute() {
    const h = location.hash.replace(/^#\/?/, '');
    const m = /^q\/(.+)$/.exec(h);
    route = m ? { page: 'q', id: decodeURIComponent(m[1]) } : { page: 'list', id: null };
  }
  async function render() {
    if (!state) return;
    $('#coName').textContent = state.company.name;
    const q = route.page === 'q' ? byId(route.id) : null;
    if (route.page === 'q' && !q) { location.hash = '#/'; return; }
    const main = $('#main');
    if (q) {
      document.body.dataset.pane = pane;
      main.innerHTML = pageEditor(q);
      $('#printArea').innerHTML = paperHtml(q);
      document.title = `${q.number} · Quotes · Business Apps`;
      if (q.invoice) checkInvoice(q);
    } else {
      delete document.body.dataset.pane;
      main.innerHTML = pageList();
      $('#printArea').innerHTML = '';
      document.title = 'Quotes · Business Apps';
      if (staleDays && DDT) { const n = DDT.notice(staleDays, async () => { DDT.bringUp(state, DDOPTS); staleDays = 0; await persist(); render(); toast('Demo dates brought up to today'); }, 'your edits stay as they are'); $('#demoNote').replaceWith(n); }
      if (sync) { try { sync.mountPanel($('#syncPanel')); } catch (e) { /* no panel */ } }
    }
  }
  async function checkInvoice(q) {
    const r = await BL.lookup(q.invoice.id);
    const el = $('#invState'); if (!el || route.id !== q.id) return;
    if (r.state === 'issued') el.textContent = r.number;
    else if (r.state === 'draft') el.textContent = 'draft, not numbered yet (Billing numbers it when you issue it)';
    else if (r.state === 'missing') {
      el.textContent = 'the draft is no longer in Billing.';
      $('#invOpen').outerHTML = `<button class="btn p" data-act="relink" data-id="${esc(q.id)}">Create it again</button>`;
    } else el.textContent = 'could not be checked here';
  }

  // ---------- actions ----------
  function newQuote(from) {
    const year = Number(today().slice(0, 4)), n = Q.nextNumber(state.quotes, year);
    const q = {
      id: uid(), ...n, subject: from ? from.subject : '', status: 'draft', issueDate: today(), validUntil: Q.addDays(today(), 30),
      client: from ? { ...from.client } : { name: '', address: '', city: '' }, vatPct: from ? from.vatPct : 22, discountPct: from ? from.discountPct : 0,
      lines: from ? from.lines.map((l) => ({ ...l })) : [{ description: '', note: '', qty: 1, unitPrice: 0, discountPct: 0 }],
      terms: from ? from.terms : 'Payment within 15 days of the invoice. Prices in EUR.',
    };
    state.quotes.push(q);
    return q;
  }
  function sendProblems(q) {
    const p = [];
    if (!q.client.name.trim()) p.push('Add the client.');
    if (!q.lines.length || q.lines.some((l) => !String(l.description).trim())) p.push('Give every item a description.');
    if (q.lines.some((l) => !(Number(l.qty) > 0))) p.push('Every item needs a quantity above zero.');
    if (T(q).total <= 0) p.push('The total must be above zero.');
    if (!Q.isIso(q.validUntil) || q.validUntil < today()) p.push('Set a valid-until date that is not in the past.');
    return p;
  }
  function shareDialog(q) {
    const url = acceptUrl(q);
    openDialog(`${q.number} is ready to send`,
      `<p>Send the client this link. They see the quote and can accept or decline it.</p><div class="linkbox"><input class="inp" id="shareUrl" readonly value="${esc(url)}" aria-label="Accept link"><button class="btn" data-act="copy-url">Copy</button></div>
       <p class="hint">Demo: nothing is e-mailed. The page works from the link alone and answers in this browser; if you open the quote on another device, the client's answer comes back as a reply link you open here.</p>`,
      `<a class="btn" href="${esc(url)}" target="_blank" rel="noopener">Open accept page</a><button class="btn p" data-act="close">Done</button>`);
  }
  async function act(a, el) {
    const q = route.page === 'q' ? byId(route.id) : null;
    switch (a) {
      case 'close': return closeDialog();
      case 'tab': tab = el.dataset.tab; lsSet('stratum-quotes-tab', tab); return render();
      case 'pane': pane = el.dataset.pane; return render();
      case 'new': { const n = newQuote(); await persist(); location.hash = `#/q/${n.id}`; return; }
      case 'export': return exportCsv();
      case 'reset': {
        if (!confirm('Reset to the demo quotes? Your changes in Quotes are removed. Invoices already made in Billing stay there.')) return;
        state = freshDemo(); staleDays = 0; await persist(); location.hash = '#/'; return render();
      }
      case 'add-line': if (q) { q.lines.push({ description: '', note: '', qty: 1, unitPrice: 0, discountPct: 0 }); saveSoon(); await render(); const rows = document.querySelectorAll('[data-line]'); const last = rows[rows.length - 1]; if (last) $('[data-k="description"]', last).focus(); } return;
      case 'del-line': if (q) { q.lines.splice(Number(el.dataset.i), 1); saveSoon(); return render(); } return;
      case 'print': if (q) { $('#printArea').innerHTML = paperHtml(q); window.print(); } return;
      case 'send': {
        if (!q) return;
        const p = sendProblems(q);
        if (p.length) return openDialog('Not ready to send', `<p>${p.map(esc).join('</p><p>')}</p>`);
        q.status = 'sent'; q.sentAt = today(); await persist(); await render(); return shareDialog(q);
      }
      case 'copy-link': if (q) return copyText(acceptUrl(q), 'Accept link copied');
      case 'copy-url': return copyText($('#shareUrl').value, 'Accept link copied');
      case 'mark-accepted': case 'mark-declined': {
        if (!q) return;
        const kind = a === 'mark-accepted' ? 'accepted' : 'declined';
        const r = Q.applyDecision(q, { kind, name: '', note: 'Recorded by you', at: today() }, today());
        if (!r.ok) return openDialog('Not changed', `<p>${esc(r.reason)}</p>`);
        await persist(); return render();
      }
      case 'reopen': if (q) { if (q.invoice && !confirm('An invoice was already made from this quote. Reopen it anyway? The invoice in Billing stays as it is.')) return; q.status = 'draft'; delete q.decision; await persist(); return render(); } return;
      case 'duplicate': if (q) { const n = newQuote(q); await persist(); location.hash = `#/q/${n.id}`; toast(`Copied to ${n.number}`); } return;
      case 'delete': if (q && q.status === 'draft' && confirm(`Delete draft ${q.number}?`)) { state.quotes = state.quotes.filter((x) => x.id !== q.id); await persist(); location.hash = '#/'; } return;
      case 'create-invoice': return createInvoice(byId(el.dataset.id));
      case 'relink': { const t = byId(el.dataset.id); if (t) { delete t.invoice; await persist(); return createInvoice(t); } return; }
    }
  }
  async function createInvoice(q) {
    if (!q || stOf(q) !== 'accepted') return;
    if (q.invoice) return openDialog('Already invoiced', '<p>An invoice was already made from this quote.</p>');
    try {
      const r = await BL.createInvoice(q, state.company, today());
      q.invoice = { id: r.id, createdAt: new Date().toISOString() };
      await persist();
      toast(r.existed ? 'Linked to the invoice already in Billing' : 'Invoice draft made in Billing');
      if (route.page === 'q') render(); else { render(); }
    } catch (e) {
      openDialog('Invoice not made', `<p>${esc(e.message || e)}</p>`);
    }
  }
  async function copyText(text, msg) {
    try { await navigator.clipboard.writeText(text); toast(msg); } catch (e) {
      const i = $('#shareUrl'); if (i) { i.select(); toast('Select and copy the link'); } else openDialog('Copy the link', `<input class="inp" readonly value="${esc(text)}" aria-label="Link">`);
    }
  }
  function exportCsv() {
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [['Number', 'Client', 'Subject', 'Issued', 'Valid until', 'Status', 'Net', 'VAT', 'Total']];
    for (const q of visibleQuotes()) { const t = T(q); rows.push([q.number, q.client.name, q.subject, q.issueDate, q.validUntil, stOf(q), Q.eur(t.net, { plain: true }), Q.eur(t.vat, { plain: true }), Q.eur(t.total, { plain: true })]); }
    const url = URL.createObjectURL(new Blob(['﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n')], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = 'quotes.csv'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---------- the client's answer (accept.html) ----------
  // Same browser: accept.html leaves the answer in localStorage and tells this app. Another device: the client page shows
  // a reply link (#reply=...) that the quote's owner opens here. Either way the answer is applied only to a quote that is
  // still out for decision and not expired (Q.applyDecision), and the text is length-limited and escaped when shown.
  async function takeReply(r) {
    const q = r && byId(r.id);
    if (!q) return false;
    const res = Q.applyDecision(q, r, today());
    if (res.ok) { await persist(); toast(`${q.number} ${r.kind === 'accepted' ? 'accepted' : 'declined'} by the client`); }
    return res.ok;
  }
  async function drainInbox() {
    let list = [];
    try { list = JSON.parse(lsGet(INBOX, '[]')); } catch (e) { list = []; }
    if (!Array.isArray(list) || !list.length) return;
    try { localStorage.removeItem(INBOX); } catch (e) { /* ignore */ }
    let any = false;
    for (const raw of list) { const r = Q.decodeReply(Q.encodeReply(raw)); if (r && await takeReply(r)) any = true; }
    if (any) render();
  }

  // ---------- events ----------
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (el) { e.preventDefault(); act(el.dataset.act, el); return; }
    const row = e.target.closest('tr[data-open]');
    if (row && !e.target.closest('a,button')) location.hash = `#/q/${row.dataset.open}`;
  });
  document.addEventListener('input', (e) => {
    const el = e.target; const q = route.page === 'q' ? byId(route.id) : null;
    if (!q || q.status === 'accepted' || q.status === 'declined' || !(el.dataset.f || el.dataset.k)) return;
    if (el.dataset.k) {
      const l = q.lines[Number(el.closest('[data-line]').dataset.line)]; const k = el.dataset.k;
      l[k] = (k === 'description' || k === 'note') ? el.value : parseNum(el.value);
    } else {
      const f = el.dataset.f, v = el.value;
      if (f.startsWith('client.')) q.client[f.slice(7)] = v;
      else if (f === 'vatPct' || f === 'discountPct') q[f] = Math.min(100, Math.max(0, parseNum(v)));
      else q[f] = v;
    }
    q.updatedAt = new Date().toISOString();
    refreshLive(q); saveSoon();
  });
  window.addEventListener('hashchange', async () => { await flush(); parseRoute(); render(); window.scrollTo(0, 0); });
  window.addEventListener('beforeunload', () => { if (saveTimer) persist(); });
  window.addEventListener('storage', (e) => { if (e.key === INBOX) drainInbox(); });
  window.addEventListener('focus', drainInbox);
  if (channel) channel.onmessage = async (e) => {
    if (e.data === 'inbox') return drainInbox();
    if (saveTimer) return; // this tab has unsaved typing; it wins
    const s = await readState(); if (isValidState(s)) { state = s; render(); }
  };

  // ---------- start ----------
  (async function init() {
    tab = lsGet('stratum-quotes-tab', 'all'); if (!['all', ...Q.STATUSES].includes(tab)) tab = 'all';
    try { state = await readState(); } catch (e) {
      $('#main').innerHTML = '<p class="empty"><b>Storage unavailable.</b> This browser blocks local storage (private window?). Quotes needs it to keep your data.</p>'; return;
    }
    let dirty = false;
    if (!isValidState(state)) { state = freshDemo(); dirty = true; }
    else if (DDT) {
      const r = DDT.refresh(state, DDOPTS);
      if (r.action === 'shifted') dirty = true; else if (r.action === 'stale') staleDays = r.days;
    }
    if (dirty) await writeState(state);
    const rep = /^#reply=(.+)$/.exec(location.hash);
    if (rep) { const r = Q.decodeReply(rep[1]); if (r) { const ok = await takeReply(r); history.replaceState(null, '', ok ? `#/q/${r.id}` : '#/'); if (!ok) toast('That answer could not be applied (the quote is not open any more).'); } else history.replaceState(null, '', '#/'); }
    parseRoute();
    if (window.StratumSync) {
      try {
        sync = StratumSync.attach({ app: 'quotes', label: 'Quotes', getSnapshot: async () => (await readState()) || state, applySnapshot: applyCloud,
          isEmpty: async () => { const s = await readState(); return !s || !s.quotes.length || !!(s.meta && s.meta.sample && !(DDT && DDT.status(s, DDOPTS).edited)); } });
        StratumSync.ready.then(() => { if (route.page === 'list') render(); });
      } catch (e) { sync = null; }
    }
    await drainInbox();
    render();
  })();
})();
