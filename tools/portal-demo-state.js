// Fictional Billing states for the client-portal demo and tests (no real people, firms or e-mail addresses; example.com only).
// buildDemoState(company, { sentinel }) → a Billing state made with the real rules in site/billing/core.js. With sentinel: true
// every field the portal must never publish also carries the text "SENTINEL-..." so tests can prove it does not leak.
'use strict';
const C = require('../site/billing/core.js');

const COMPANIES = {
  alder: { name: 'Alder & Finch Studio', accent: '#1f6b4f', iban: 'SI56191000000123438', prefix: 'INV-', qprefix: 'Q-',
    clients: [{ id: 'cl-lindgren', name: 'Lindgren Café', person: 'Elena Lindgren', email: 'elena@example.com' }, { id: 'cl-birch', name: 'Birch Bakery', person: 'Jonas Birch', email: 'jonas@example.net' }] },
  harbor: { name: 'Harbor Light Studio', accent: '#1d4e89', iban: 'SI56191000000123438', prefix: 'HL-', qprefix: 'HQ-',
    clients: [{ id: 'cl-north', name: 'Northwind Outfitters', person: 'Mara Quill', email: 'mara@example.org' }] },
};
let seq = 0;
const uuid = (tag) => { const h = (n) => (++seq * 2654435761 % 4294967296).toString(16).padStart(8, '0'); return h() + '-' + h().slice(0, 4) + '-4' + h().slice(0, 3) + '-a' + h().slice(0, 3) + '-' + h() + h().slice(0, 4); };

function buildDemoState(company = 'alder', { sentinel = false } = {}) {
  const co = COMPANIES[company], S = (t) => (sentinel ? ' SENTINEL-' + t : '');
  const state = {
    version: 1, counters: {}, quoteCounters: {}, contracts: [], work: [], invoices: [], quotes: [], runs: [], audit: [], meta: {},
    settings: { companyName: co.name, address: 'Example Street 1', postalCity: '1000 Ljubljana', vatRegistered: false, vatId: '', taxNumber: '12345679', registrationNumber: '', court: '', shareCapital: '',
      iban: co.iban, bic: '', bank: '', email: 'hello@example.com', phone: '', web: '', numberPrefix: co.prefix, quotePrefix: co.qprefix, paymentDays: 15, defaultVatRate: 22, lang: 'en', footer: '' + S('settings-footer'),
      internalNote: S('settings-extra') },
    clients: co.clients.map((c) => ({ id: c.id, name: c.name, address: 'Sample Road 7', postalCity: '1000 Ljubljana', country: 'SI', vatId: '', treatment: 'domestic', lang: 'en',
      email: c.email, internalNotes: S('client-internal'), creditLimit: S('client-limit'), contactPerson: c.person })),
  };
  const line = (description, qty, unitPrice) => ({ description, qty, unit: 'pc', unitPrice, discountPct: 0, vatRate: 22 });
  const first = state.clients[0], second = state.clients[1] || null;
  const invoice = (client, desc, price, issue, days, extra = {}) => {
    const d = { id: uuid(), kind: 'invoice', clientId: client.id, treatment: 'domestic', lang: 'en', supplyFrom: issue, supplyTo: '', paymentDays: days, note: extra.note || '', lines: [line(desc, 1, price)], payments: [] };
    state.invoices.push(d);
    const p = C.issueProblems(state, d, issue); if (p.length) throw new Error('demo invoice: ' + p.join('; '));
    C.issueDoc(state, d, issue, issue + 'T09:00:00.000Z');
    return d;
  };
  const quote = (client, desc, qty, price, issue, validDays, note, kind = 'quote') => {
    const q = { id: uuid(), kind, clientId: client.id, treatment: 'domestic', lang: 'en', supplyFrom: '', supplyTo: '', validDays, paymentDays: 8, note, lines: Array.isArray(desc) ? desc : [line(desc, qty, price)] };
    state.quotes.push(q);
    const p = C.quoteProblems(state, q, issue); if (p.length) throw new Error('demo quote: ' + p.join('; '));
    C.issueQuote(state, q, issue, issue + 'T09:00:00.000Z');
    return q;
  };
  const pay = (d, amount, date) => d.payments.push({ id: uuid(), date, amount, method: 'bank_transfer', note: 'bank ref 77' + S('payment-note') });
  if (company === 'alder') {
    const i27 = invoice(first, 'Photography day', 640, '2026-08-01', 13); pay(i27, 64000, '2026-08-14');
    const i32 = invoice(first, 'Brand refresh, phase 1', 2150, '2026-08-20', 13); pay(i32, 215000, '2026-09-02');
    invoice(first, 'Menu and signage design', 860, '2026-09-26', 15);
    invoice(second, 'Packaging labels', 520, '2026-10-02', 15, { note: 'Thank you.' });
    invoice(first, 'Brand refresh, phase 2', 1240, '2026-10-09', 15);
    const q = quote(first, [line('Discovery and content plan', 1, 1200), line('Design of 8 pages', 1, 2400), line('Build and launch', 1, 1200)], 0, 0, '2026-10-05', 26, 'Prices in euro. VAT not charged (small taxpayer).');
    quote(second, 'Seasonal menu cards', 1, 900, '2026-10-06', 30, 'Printing excluded.');
    quote(first, 'Window decals (proforma)', 1, 300, '2026-10-08', 10, '', 'proforma');
    quote(first, 'Old logo variants', 1, 250, '2026-07-01', 30, '');
    state.quotes.push({ id: uuid(), kind: 'quote', clientId: first.id, treatment: 'domestic', lang: 'en', lines: [line('Unissued draft' + S('draft'), 1, 1)], note: 'draft note' + S('draft-note') });
    state.invoices.push({ id: uuid(), kind: 'invoice', clientId: first.id, treatment: 'domestic', lang: 'en', lines: [line('Unissued invoice draft' + S('draft-inv'), 1, 99)], payments: [], note: '' });
    state.work.push({ id: uuid(), clientId: first.id, date: '2026-10-01', hours: 3, note: 'worked on logo' + S('worklog') });
    state.contracts.push({ id: uuid(), clientId: first.id, name: 'Retainer' + S('contract'), amount: 99900, note: S('contract-note') });
    state.audit.push({ seq: 1, type: 'x', msg: S('audit') });
    state._quoteId = q.id; // convenience for tests: the open quote of the first client
  } else {
    const i1 = invoice(first, 'Catalogue photography', 1800, '2026-09-15', 15); pay(i1, 180000, '2026-09-30');
    invoice(first, 'Spring lookbook layout', 2600, '2026-10-10', 15);
    quote(first, 'Autumn campaign', 1, 5400, '2026-10-12', 30, 'Delivery in four weeks.');
  }
  return state;
}

module.exports = { COMPANIES, buildDemoState };
