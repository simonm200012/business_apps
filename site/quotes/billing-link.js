/* Quotes -> Billing: puts an invoice DRAFT into Billing's own data (same browser, IndexedDB `stratum-billing`).
 *
 * Billing keeps everything in one record (`kv` / `state`) and every change in a SHA-256 hash chain. This file follows
 * the same rules as billing/app.js so Billing's integrity check stays green: one writer at a time (the same Web Lock),
 * re-read before writing, an audit entry chained to the previous one, a BroadcastChannel message so an open Billing tab
 * redraws. The invoice is a draft without a number: Billing numbers and freezes an invoice only when you issue it there,
 * and then it needs the company details in Billing's Settings.
 *
 * Cloud copy: Billing uploads its data when Billing itself changes it. Quotes cannot do that from here, so it posts
 * 'external' on the channel (an open Billing tab uploads at once) and leaves a flag in localStorage that Billing
 * checks on its next start. Until then the cloud copy of Billing does not have the new draft.
 */
(function (root) {
  'use strict';
  const C = root.BillingCore, Q = root.QuotesCore;
  const DB = 'stratum-billing', STORE = 'kv', LOCK = 'stratum-billing', FLAG = 'stratum-billing-external-change';
  const uid = () => (root.crypto && crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`);

  function idb() {
    return new Promise((res, rej) => {
      const q = indexedDB.open(DB, 1);
      q.onupgradeneeded = () => q.result.createObjectStore(STORE);
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
  }
  async function read() {
    const db = await idb();
    return new Promise((res, rej) => { const r = db.transaction(STORE).objectStore(STORE).get('state'); r.onsuccess = () => res(r.result || null); r.onerror = () => rej(r.error); });
  }
  async function write(s) {
    const db = await idb();
    return new Promise((res, rej) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(s, 'state'); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
  }
  const withLock = (fn) => (navigator.locks ? navigator.locks.request(LOCK, fn) : fn());
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
  // Billing's empty state (billing/app.js emptyState + DEFAULT_SETTINGS), used only when Billing has no data yet.
  function emptyBilling(company) {
    return {
      version: 1,
      settings: { companyName: company.name, address: company.address, postalCity: company.city, vatRegistered: true, vatId: '', taxNumber: '',
        registrationNumber: '', court: '', shareCapital: '', iban: '', bic: '', bank: '', email: '', phone: '', web: '',
        numberPrefix: '', quotePrefix: 'PR-', paymentDays: 15, defaultVatRate: 22, lang: 'en', footer: '' },
      counters: {}, clients: [], contracts: [], work: [], invoices: [], runs: [], audit: [], quotes: [], quoteCounters: {},
      meta: { createdAt: new Date().toISOString(), lastBackupAt: null, sample: false },
    };
  }

  /** What Billing says about an invoice: { state: 'draft'|'issued'|'missing'|'unknown', number }. Never writes. */
  async function lookup(invoiceId) {
    try {
      const s = await read();
      if (!s || !Array.isArray(s.invoices)) return { state: 'missing', number: '' };
      const inv = s.invoices.find((i) => i.id === invoiceId);
      if (!inv) return { state: 'missing', number: '' };
      return inv.number ? { state: 'issued', number: inv.number } : { state: 'draft', number: '' };
    } catch (e) { return { state: 'unknown', number: '' }; }
  }

  /**
   * Creates the draft invoice for an accepted quote. Returns { id, existed } where `existed` means Billing already had
   * a draft/invoice made from this very quote (so it is linked, never created twice). Throws a readable Error.
   */
  async function createInvoice(quote, company, today = Q.todayIso()) {
    if (!(root.indexedDB && crypto.subtle)) throw new Error('This browser cannot reach Billing\'s data.');
    return withLock(async () => {
      const s = (await read()) || emptyBilling(company);
      for (const k of ['invoices', 'clients', 'audit']) if (!Array.isArray(s[k])) throw new Error('Billing\'s data looks damaged, so nothing was added.');
      const already = s.invoices.find((i) => i.fromQuote === quote.id);
      if (already) return { id: already.id, existed: true };

      let client = s.clients.find((c) => String(c.name || '').trim().toLowerCase() === quote.client.name.trim().toLowerCase());
      if (!client) {
        client = { id: uid(), name: quote.client.name, address: quote.client.address, postalCity: quote.client.city, country: 'SI', vatId: '', taxNumber: '',
          email: '', treatment: 'domestic', lang: 'en', paymentDays: 15, createdAt: new Date().toISOString() };
        s.clients.push(client);
        await appendAudit(s, 'client.create', `Added client ${client.name} (from quote ${quote.number})`, {});
      }
      const draft = {
        id: uid(), ...Q.invoiceDraftFromQuote(quote, { today }), clientId: client.id,
        treatment: client.treatment || 'domestic', lang: client.lang || 'en', payments: [], createdAt: new Date().toISOString(),
      };
      draft.lines = draft.lines.map((l) => ({ ...l, unit: l.unit || C.unitFor('piece', draft.lang) }));
      s.invoices.push(draft);
      await appendAudit(s, 'document.draft', `Invoice draft made from quote ${quote.number}`, { id: draft.id, kind: draft.kind, quoteNumber: quote.number });
      await write(s);
      try { localStorage.setItem(FLAG, '1'); } catch (e) { /* private window: the cloud copy catches up on the next change in Billing */ }
      if ('BroadcastChannel' in root) { const ch = new BroadcastChannel('stratum-billing'); ch.postMessage('external'); ch.close(); }
      return { id: draft.id, existed: false };
    });
  }

  root.QuotesBilling = { lookup, createInvoice, read, FLAG };
})(window);
