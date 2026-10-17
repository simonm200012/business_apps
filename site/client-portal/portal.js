/* Client portal front-end. No inline script or style (CSP), and no HTML strings anywhere: every piece of text the company staff
   wrote (company name, descriptions, news, file names) is put on the page with textContent, so it can only ever be text.
   Branding (name, accent colour, logo) comes from /api/view, so each company renders in its own look.
   Demo mode (<body data-demo="1">, used by the sample page in the Business Apps site) reads demo-view.json instead of the API. */
(function () {
  'use strict';
  const DEMO = document.body.getAttribute('data-demo') === '1';
  const $ = (id) => document.getElementById(id);
  const app = $('app');
  let me = null, data = null, pending = null, busy = false, flash = null;

  // ── tiny DOM builder: text only, no style attribute, only internal links ─────────────────────────────────────────────
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
      else if (k === 'href') el.setAttribute('href', /^(#\/|\/api\/files\/[a-f0-9]{32}$)/.test(v) ? v : '#/overview');
      else if (/^(type|disabled|aria-[a-z]+|role|rows|maxlength|for|id|name|download|rel|title|value|placeholder)$/.test(k)) el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
    return el;
  }
  const NS = 'http://www.w3.org/2000/svg';
  function icon(d) {
    const s = document.createElementNS(NS, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); s.appendChild(p); return s;
  }
  const ICONS = { overview: 'M4 11 12 4l8 7v9H4z', invoices: 'M6 3h12v18l-3-2-3 2-3-2-3 2z', documents: 'M6 3h8l4 4v14H6zM14 3v4h4', quotes: 'M5 4h14v12H9l-4 4z', news: 'M5 5h14M5 12h14M5 19h9' };
  const SECTIONS = [['overview', 'Overview', 'Home'], ['invoices', 'Invoices', 'Invoices'], ['documents', 'Documents', 'Files'], ['quotes', 'Quotes', 'Quotes'], ['news', 'News', 'News']];

  // ── formatting ───────────────────────────────────────────────────────────────────────────────────────────────────────
  const money = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' });
  const eur = (cents) => money.format(cents / 100);
  const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const dmy = (iso) => (iso ? dateFmt.format(new Date(iso + 'T12:00:00Z')) : '');
  const dmShort = (iso) => (iso ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(iso + 'T12:00:00Z')) : '');
  const days = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5);
  const size = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
  const EXT = { 'application/pdf': 'PDF', 'image/png': 'PNG', 'image/jpeg': 'JPG', 'text/csv': 'CSV', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOC', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLS' };
  const qty = (n) => String(Math.round(n * 10000) / 10000);

  // ── data ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
  async function api(path, opts) {
    if (DEMO) {
      if (path === '/api/view') return fetch('demo-view.json', { credentials: 'same-origin' }).then((r) => r.json());
      if (path === '/api/me') return { name: 'Elena', client: 'Lindgren Café' };
      if (path === '/api/logout') return { ok: true, redirect: '' };
      return { ok: true };
    }
    let res;
    try { res = await fetch(path, { credentials: 'same-origin', ...opts, headers: { Accept: 'application/json', ...((opts && opts.headers) || {}) } }); }
    catch { throw Object.assign(new Error('No connection. Check your internet and try again.'), { status: 0 }); }
    let body = null; try { body = await res.json(); } catch { /* not JSON */ }
    if (!res.ok) throw Object.assign(new Error((body && body.error) || 'Something went wrong.'), { status: res.status });
    return body;
  }
  function tint(hex) { // the accent mixed 90% with white, for badges and icon backgrounds
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return '#' + c.map((v) => Math.round(v * 0.1 + 255 * 0.9).toString(16).padStart(2, '0')).join('');
  }
  function applyBrand(b) {
    if (/^#[0-9a-f]{6}$/.test(b.accent || '')) { document.documentElement.style.setProperty('--brand', b.accent); document.documentElement.style.setProperty('--brandT', tint(b.accent)); }
    document.title = b.name + ' · Client portal';
    $('brandName').textContent = b.name; $('footName').textContent = b.name;
    const mark = $('mark'), img = $('markImg');
    if (b.logo) { img.src = DEMO ? 'demo-logo.png' : '/api/brand/logo'; img.hidden = false; mark.hidden = true; }
    else { mark.textContent = (b.name.match(/[A-Za-z0-9À-ɏ]/) || ['?'])[0].toUpperCase(); mark.hidden = false; img.hidden = true; }
  }
  const initials = (s) => (String(s).trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('') || '?').toUpperCase();

  // ── small parts ──────────────────────────────────────────────────────────────────────────────────────────────────────
  function invBadge(i) {
    const t = data.today;
    if (i.kind === 'credit_note') return h('span', { class: 'badge mute', text: 'Credit note' });
    if (i.status === 'paid') return h('span', { class: 'badge paid', text: 'Paid' });
    if (i.status === 'credited') return h('span', { class: 'badge mute', text: 'Credited' });
    if (i.status === 'refund_due') return h('span', { class: 'badge info', text: 'Refund due' });
    if (i.status === 'overdue') { const d = days(i.dueDate, t); return h('span', { class: 'badge over', text: 'Overdue' + (d > 0 ? ' ' + d + (d === 1 ? ' day' : ' days') : '') }); }
    if (i.dueDate && days(t, i.dueDate) <= 7) return h('span', { class: 'badge due', text: 'Due soon' });
    return h('span', { class: 'badge info', text: i.status === 'partly_paid' ? 'Part paid' : 'Open' });
  }
  function quoteBadge(q) {
    if (q.response) return h('span', { class: 'badge due', text: (q.response.decision === 'accept' ? 'Accepted' : 'Declined') + ', awaiting confirmation' });
    if (q.status === 'accepted') return h('span', { class: 'badge paid', text: 'Accepted' });
    if (q.status === 'declined') return h('span', { class: 'badge mute', text: 'Declined' });
    if (q.status === 'invoiced') return h('span', { class: 'badge info', text: 'Invoiced' });
    if (q.status === 'expired') return h('span', { class: 'badge mute', text: 'Expired' });
    if (q.kind === 'proforma') return h('span', { class: 'badge info', text: 'Proforma' });
    return h('span', { class: 'badge due', text: 'Awaiting your answer' });
  }
  function download(fid, label, cls) {
    if (!fid) return null;
    if (DEMO) return h('button', { class: cls || 'btn o', type: 'button', text: label, on: { click: () => flashMsg('This is a sample portal: files are not included.') } });
    return h('a', { class: cls || 'btn o', href: '/api/files/' + fid, rel: 'noopener', text: label });
  }
  function flashMsg(text, bad) { flash = { text, bad: !!bad }; render(); }
  const card = (title, link, ...body) => h('section', { class: 'card' }, h('h2', null, title, link ? h('a', { href: link[1], text: link[0] }) : null), ...body);

  function invoiceRow(i, compact) {
    const sub = i.kind === 'credit_note' ? 'Credit note · ' + dmy(i.issueDate)
      : (i.title ? i.title + ' · ' : '') + (i.status === 'paid' && i.paidOn ? 'paid ' + dmy(i.paidOn) : 'due ' + dmy(i.dueDate));
    return h('div', { class: 'row' }, h('div', { class: 'g' }, h('b', { text: i.number }), h('div', { class: 'sub', text: compact ? (i.status === 'paid' && i.paidOn ? 'Paid ' + dmShort(i.paidOn) : 'Due ' + dmShort(i.dueDate)) : sub })),
      invBadge(i), h('div', { class: 'amt', text: eur(i.total) }), download(i.pdf, 'PDF'));
  }
  function docRow(d) {
    return h('div', { class: 'row' }, h('div', { class: 'ico', text: EXT[d.type] || 'FILE' }), h('div', { class: 'g' }, h('b', { text: d.name }), h('div', { class: 'sub', text: 'Shared ' + dmShort(d.sharedAt) + ' · ' + size(d.size) })),
      download(d.id, 'Download', 'btn o'));
  }
  function newsRow(n) { return h('div', { class: 'row' }, h('div', null, h('div', { class: 'd', text: dmy(n.date) }), h('b', { text: n.title }), n.body ? h('p', { class: 'sub t', text: n.body }) : null)); }
  function quoteRow(q) {
    return h('div', { class: 'row' }, h('div', { class: 'g' }, h('b', null, h('a', { href: '#/quotes/' + q.id, text: q.number })), h('div', { class: 'sub', text: (q.kind === 'proforma' ? 'Proforma invoice' : 'Quote') + ' · ' + dmy(q.issueDate) + (q.validUntil ? ' · valid until ' + dmy(q.validUntil) : '') })),
      quoteBadge(q), h('div', { class: 'amt', text: eur(q.totals.total) }));
  }

  // ── pages ────────────────────────────────────────────────────────────────────────────────────────────────────────────
  function greeting() {
    const hr = new Date().getHours(), part = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
    return me.name ? part + ', ' + me.name : 'Welcome';
  }
  function totals() {
    const inv = data.invoices.filter((i) => i.kind === 'invoice');
    const sum = (f) => inv.filter(f).reduce((a, i) => a + i.amountDue, 0);
    const year = data.today.slice(0, 4);
    return { outstanding: sum(() => true), overdue: sum((i) => i.status === 'overdue'), paid: inv.filter((i) => i.status === 'paid' && (i.paidOn || '').slice(0, 4) === year).reduce((a, i) => a + i.total, 0) };
  }
  function overview() {
    const t = totals(), open = data.quotes.find((q) => q.canDecide) || null;
    const quoteCard = open
      ? card('Open quote', null, h('div', { class: 'quote' }, quoteBadge(open), h('div', { class: 'big', text: eur(open.totals.total) }), h('p', null, h('b', { text: open.number })),
        h('p', { class: 'sub', text: (open.validUntil ? 'Valid until ' + dmy(open.validUntil) + ' · ' : '') + open.lines.length + (open.lines.length === 1 ? ' item' : ' items') }),
        h('div', { class: 'acts' }, h('a', { class: 'btn', href: '#/quotes/' + open.id, text: 'Review and answer' }))))
      : card('Quotes', ['View all', '#/quotes'], h('p', { class: 'empty', text: 'Nothing is waiting for your answer.' }));
    return [
      h('h1', { text: greeting() }), h('p', { class: 'sub', text: 'Here is what is going on with your projects at ' + data.brand.name + '.' }),
      h('div', { class: 'kpis' },
        h('div', { class: 'card kpi' }, h('div', { class: 'l', text: 'Outstanding balance' }), h('div', { class: 'v', text: eur(t.outstanding) }), t.overdue ? h('div', { class: 'sub', text: eur(t.overdue) + ' of it is overdue' }) : null),
        h('div', { class: 'card kpi secondary' }, h('div', { class: 'l', text: 'Overdue' }), h('div', { class: 'v' + (t.overdue ? ' bad' : ''), text: eur(t.overdue) })),
        h('div', { class: 'card kpi secondary' }, h('div', { class: 'l', text: 'Paid this year' }), h('div', { class: 'v', text: eur(t.paid) }))),
      h('div', { class: 'cols' },
        h('div', { class: 'stack' },
          card('Invoices', ['View all', '#/invoices'], ...(data.invoices.slice(0, 4).map((i) => invoiceRow(i, false))), data.invoices.length ? null : h('p', { class: 'empty', text: 'No invoices yet.' })),
          card('Shared documents', ['View all', '#/documents'], ...(data.documents.slice(0, 3).map(docRow)), data.documents.length ? null : h('p', { class: 'empty', text: 'No documents have been shared yet.' }))),
        h('div', { class: 'stack' }, quoteCard,
          h('div', { class: 'news' }, card('News from ' + data.brand.name, ['All news', '#/news'], ...(data.news.slice(0, 3).map(newsRow)), data.news.length ? null : h('p', { class: 'empty', text: 'No news.' }))))),
    ];
  }
  const pageHead = (title, sub) => [h('div', { class: 'head' }, h('div', null, h('h1', { text: title }), sub ? h('p', { class: 'sub', text: sub }) : null))];
  function invoices() {
    return [...pageHead('Invoices', data.invoices.length + (data.invoices.length === 1 ? ' invoice' : ' invoices')),
      card('All invoices', null, ...(data.invoices.map((i) => invoiceRow(i, false))), data.invoices.length ? null : h('p', { class: 'empty', text: 'No invoices yet.' }))];
  }
  function documents() {
    return [...pageHead('Documents', 'Files ' + data.brand.name + ' has shared with you.'),
      card('Shared documents', null, ...(data.documents.map(docRow)), data.documents.length ? null : h('p', { class: 'empty', text: 'No documents have been shared yet.' }))];
  }
  function news() {
    return [...pageHead('News', 'From ' + data.brand.name), h('div', { class: 'news' }, card('News', null, ...(data.news.map(newsRow)), data.news.length ? null : h('p', { class: 'empty', text: 'No news.' })))];
  }
  function quotes() {
    return [...pageHead('Quotes', 'Quotes and proforma invoices from ' + data.brand.name + '.'),
      card('All quotes', null, ...(data.quotes.map(quoteRow)), data.quotes.length ? null : h('p', { class: 'empty', text: 'No quotes yet.' }))];
  }
  function quoteDetail(id) {
    const q = data.quotes.find((x) => x.id === id);
    if (!q) return [h('p', null, h('a', { class: 'back', href: '#/quotes', text: '← All quotes' })), h('div', { class: 'state' }, h('h2', { text: 'Quote not found' }), h('p', { text: 'It may have been withdrawn.' }))];
    const hasVat = q.totals.vat !== 0;
    const lines = h('table', { class: 'lines' },
      h('thead', null, h('tr', null, h('th', { text: 'Description' }), h('th', { class: 'n hide-s', text: 'Qty' }), h('th', { class: 'n hide-s', text: 'Unit price' }), h('th', { class: 'n', text: 'Amount' }))),
      h('tbody', null, ...q.lines.map((l) => h('tr', null, h('td', null, l.description, h('div', { class: 'sub', text: qty(l.qty) + (l.unit ? ' ' + l.unit : '') + (l.discountPct ? ' · ' + l.discountPct + '% discount' : '') })),
        h('td', { class: 'n hide-s', text: qty(l.qty) }), h('td', { class: 'n hide-s', text: money.format(l.unitPrice) }), h('td', { class: 'n', text: eur(l.net) })))),
      h('tfoot', null, hasVat ? h('tr', null, h('td', { text: 'Net' }), h('td', { class: 'hide-s' }), h('td', { class: 'hide-s' }), h('td', { class: 'n', text: eur(q.totals.net) })) : null,
        hasVat ? h('tr', null, h('td', { text: 'VAT' }), h('td', { class: 'hide-s' }), h('td', { class: 'hide-s' }), h('td', { class: 'n', text: eur(q.totals.vat) })) : null,
        h('tr', null, h('td', { text: 'Total' }), h('td', { class: 'hide-s' }), h('td', { class: 'hide-s' }), h('td', { class: 'n', text: eur(q.totals.total) }))));
    let answer;
    if (q.response) {
      const acc = q.response.decision === 'accept';
      answer = h('div', { class: 'answer' }, h('div', { class: 'msg', text: (acc ? 'You accepted this quote' : 'You declined this quote') + ' on ' + dmy(q.response.at.slice(0, 10)) + '. ' + data.brand.name + ' will confirm it.' }));
    } else if (q.canDecide) {
      if (!pending) answer = h('div', { class: 'answer' }, h('p', { class: 'sub', text: 'Valid until ' + dmy(q.validUntil) + '. Your answer is sent to ' + data.brand.name + ', who confirm it.' }),
        h('div', { class: 'acts' }, h('button', { class: 'btn', type: 'button', text: 'Accept quote', on: { click: () => { pending = 'accept'; render(); } } }), h('button', { class: 'btn o', type: 'button', text: 'Decline', on: { click: () => { pending = 'decline'; render(); } } })));
      else {
        const acc = pending === 'accept', box = h('textarea', { id: 'cmt', rows: 3, maxlength: 500 });
        answer = h('div', { class: 'answer' }, h('b', { text: (acc ? 'Accept ' : 'Decline ') + q.number + ' for ' + eur(q.totals.total) + '?' }),
          h('label', { for: 'cmt', text: 'Add a message (optional)' }), box,
          h('div', { class: 'acts' }, h('button', { class: 'btn', type: 'button', disabled: busy, text: busy ? 'Sending...' : (acc ? 'Yes, accept' : 'Yes, decline'), on: { click: () => decide(q, pending, box.value) } }),
            h('button', { class: 'btn o', type: 'button', disabled: busy, text: 'Cancel', on: { click: () => { pending = null; render(); } } })));
      }
    } else answer = h('div', { class: 'answer' }, h('p', { class: 'sub', text: q.kind === 'proforma' ? 'This is a proforma invoice and does not need an answer.' : q.status === 'expired' ? 'This quote has expired. Contact ' + data.brand.name + ' for a new one.' : 'This quote can no longer be answered online.' }));
    return [h('a', { class: 'back', href: '#/quotes', text: '← All quotes' }),
      h('div', { class: 'head' }, h('div', null, h('h1', { text: q.number }), h('p', { class: 'sub', text: (q.kind === 'proforma' ? 'Proforma invoice' : 'Quote') + ' · ' + dmy(q.issueDate) + (q.validUntil ? ' · valid until ' + dmy(q.validUntil) : '') })), h('div', null, quoteBadge(q), ' ', download(q.pdf, 'PDF'))),
      h('div', { class: 'stack' }, h('section', { class: 'card' }, lines, q.note ? h('div', { class: 'notebox', text: q.note }) : null), h('section', { class: 'card' }, answer))];
  }
  async function decide(q, decision, comment) {
    if (busy) return;
    busy = true; render();
    try {
      const r = DEMO ? { decision, at: new Date().toISOString() } : await api('/api/quotes/' + q.id + '/decision', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Portal': '1' }, body: JSON.stringify({ decision, quoteHash: q.hash, comment: String(comment || '').slice(0, 500) }) });
      q.response = { decision: r.decision, at: r.at }; q.canDecide = false; pending = null; busy = false;
      flash = { text: 'Thank you. Your answer was sent to ' + data.brand.name + '.', bad: false };
    } catch (e) {
      busy = false; pending = null;
      flash = { text: e.message, bad: true };
      if (e.status === 409) { try { await load(); } catch { /* keep what we have */ } }
    }
    render();
  }

  // ── shell ────────────────────────────────────────────────────────────────────────────────────────────────────────────
  function route() { const m = (location.hash || '').match(/^#\/([a-z]+)(?:\/([0-9a-f-]{36}))?$/); return m ? { page: m[1], id: m[2] || null } : { page: 'overview', id: null }; }
  function nav(page) {
    const mk = (cls, withIcon) => SECTIONS.map(([key, label, short]) => { const a = h('a', { href: '#/' + key, 'aria-current': page === key || (key === 'quotes' && page === 'quotes') ? 'page' : null }, withIcon ? icon(ICONS[key]) : null, withIcon ? short : label); return a; });
    const n = $('nav'), t = $('tabs'); n.replaceChildren(...mk('', false)); t.replaceChildren(...mk('', true));
  }
  function render() {
    if (!data) return;
    const r = route(), pages = { overview, invoices, documents, quotes, news };
    nav(pages[r.page] ? r.page : 'overview');
    const out = r.page === 'quotes' && r.id ? quoteDetail(r.id) : (pages[r.page] || overview)();
    if (flash) out.unshift(h('div', { class: 'msg' + (flash.bad ? ' bad' : ''), role: 'status', text: flash.text }));
    app.replaceChildren(...out);
    window.scrollTo(0, 0);
  }
  function fail(e) {
    $('top').hidden = true; $('tabs').hidden = true; $('foot').hidden = true;
    const msg = e.status === 403 ? ['No access', 'This e-mail address has no access to the client portal. Ask your contact at the company to add it.']
      : e.status === 401 ? ['Signed out', 'Your sign-in has expired. Reload the page to sign in again.']
      : e.status === 404 ? ['Nothing here yet', 'Nothing has been published for you yet. Please check back soon.']
      : e.status === 503 ? ['Not available', 'The client portal is not available right now. Please try again later.'] : ['Something went wrong', e.message];
    app.replaceChildren(h('div', { class: 'state' }, h('h2', { text: msg[0] }), h('p', { text: msg[1] })));
  }
  async function load() {
    const [m, v] = await Promise.all([api('/api/me'), api('/api/view')]);
    me = m; data = v;
  }
  async function start() {
    try { await load(); } catch (e) { fail(e); return; }
    applyBrand(data.brand);
    $('whoName').textContent = data.client.name; $('av').textContent = initials(me.name || data.client.name);
    $('top').hidden = false; $('tabs').hidden = false; $('foot').hidden = false; $('footDemo').hidden = !DEMO;
    $('signOut').addEventListener('click', async () => {
      try { const r = await api('/api/logout', { method: 'POST', headers: { 'X-Portal': '1' } }); if (typeof r.redirect === 'string' && r.redirect.startsWith('/cdn-cgi/access/')) location.assign(r.redirect); } catch { /* stay */ }
    });
    window.addEventListener('hashchange', () => { pending = null; flash = null; render(); });
    render();
  }
  start();
})();
