/* Client portal projection: the ONLY part of a Billing client's data that is ever published to the portal. Pure, no DOM.
 * Loaded by Billing (browser) and by the Node tests and tools/portal-publish.mjs.
 *
 * buildProjection(state, billingClientId, { today, pdfs, documents }) builds the whitelist from scratch (nothing is copied
 * by "delete the secret fields"): what is on the printed documents (invoice numbers, dates, totals, quote lines and note)
 * and what the client is owed. Never included: payments and their notes, the work log, contracts, settings, the audit chain,
 * other clients, the client's internal fields. The Worker (worker/portal-schema.js) applies the same whitelist again.
 * Money is in cents (as in Billing); unitPrice is in euros as printed on the quote.
 */
(function (root) {
  'use strict';
  const C = root.BillingCore || (typeof require === 'function' ? require('./core.js') : null);
  const text = (v, max) => String(v == null ? '' : v).slice(0, max);

  function invoiceRow(state, inv, today, pdfs) {
    const status = C.statusOf(state, inv, today);
    const snap = inv.snapshot;
    const credit = inv.kind === 'credit_note';
    return {
      id: String(inv.id), number: snap.number, kind: credit ? 'credit_note' : 'invoice', issueDate: snap.issueDate,
      dueDate: credit ? null : (inv.dueDate || snap.dueDate || null), total: snap.totals.total,
      amountDue: credit ? 0 : C.outstandingCents(state, inv), status: credit ? 'issued' : status,
      paidOn: !credit && status === 'paid' ? C.lastPaymentDate(inv) : null, reference: credit ? '' : text(snap.reference, 40),
      title: text((snap.lines[0] || {}).description, 120), pdf: pdfs[inv.id] || null,
    };
  }
  function quoteRow(state, q, today, pdfs) {
    const snap = q.snapshot;
    return {
      id: String(q.id), number: snap.number, kind: snap.kind === 'proforma' ? 'proforma' : 'quote', issueDate: snap.issueDate,
      validUntil: snap.validUntil || null, status: C.quoteStatus(state, q, today),
      totals: { net: snap.totals.net, vat: snap.totals.vat, total: snap.totals.total },
      lines: snap.lines.map((l) => ({ description: text(l.description, 300), qty: Number(l.qty), unit: text(l.unit, 20),
        unitPrice: Number(l.unitPrice), discountPct: Number(l.discountPct) || 0, rate: Number(l.rate) || 0, net: l.net })),
      note: text(snap.note, 2000), pdf: pdfs[q.id] || null,
    };
  }

  function buildProjection(state, billingClientId, opts = {}) {
    const today = opts.today || C.todayIso(), pdfs = opts.pdfs || {};
    const client = (state.clients || []).find((c) => c.id === billingClientId);
    if (!client) throw new Error('Unknown client.');
    const invoices = (state.invoices || []).filter((i) => i.clientId === billingClientId && i.number && i.snapshot)
      .map((i) => invoiceRow(state, i, today, pdfs)).filter((r) => r.status !== 'draft')
      .sort((a, b) => (a.issueDate < b.issueDate ? 1 : a.issueDate > b.issueDate ? -1 : a.number < b.number ? 1 : -1));
    const quotes = (state.quotes || []).filter((q) => q.clientId === billingClientId && q.number && q.snapshot)
      .map((q) => quoteRow(state, q, today, pdfs)).filter((r) => r.status !== 'draft')
      .sort((a, b) => (a.issueDate < b.issueDate ? 1 : -1));
    const documents = (opts.documents || []).map((d) => ({ id: d.id, name: text(d.name, 200), size: Number(d.size) || 0, type: text(d.type, 100), sharedAt: d.sharedAt }));
    return { v: 1, client: { name: text(client.name, 120) }, invoices, quotes, documents };
  }

  const api = { buildProjection };
  root.PortalProjection = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
